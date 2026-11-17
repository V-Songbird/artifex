// The piece contract. ONE source of truth.
//
// FIELDS defines the schema consumed by the validator and documented by the
// skill. Unknown keys are refused so misspelled options cannot pass silently.
//
// Nothing here knows what kind of art a piece makes. That is deliberate and it
// is the project's governing rule.

'use strict';

const finish = require('./finish.js');
const image = require('./image.js');
const { clamp01 } = require('./num.js');
const { ease } = require('./time.js');

/**
 * A piece is a plain object. `draw` is a pure function of (state, t); `build`
 * stages are pure in the seed. Those two properties are the whole of what makes
 * a piece renderable to a page, a video, a print and a plotter from one source.
 */
const FIELDS = {
  name: {
    required: true,
    check: (v) => (typeof v === 'string' && /^[a-z][a-z0-9-]*$/.test(v)
      ? null
      : 'must be a lowercase kebab-case string'),
    doc: 'Identifier. Used for output filenames and in error messages.',
  },

  size: {
    required: true,
    check: (v) => {
      if (!v || typeof v !== 'object') return 'must be { w, h }';
      for (const k of ['w', 'h']) {
        if (!Number.isFinite(v[k]) || v[k] <= 0) return `size.${k} must be a positive finite number`;
      }
      const extra = Object.keys(v).filter((k) => k !== 'w' && k !== 'h');
      if (extra.length) return `unknown key(s) in size: ${extra.join(', ')}`;
      return null;
    },
    doc: 'The DESIGN BOX, in design units. It never changes unless the piece '
       + 'declares `boxes`. Aspect ratio, device scale and output medium are '
       + 'render-time choices, so one piece serves a page, a video, a print and '
       + 'a plotter.',
  },

  draw: {
    required: true,
    check: (v) => (typeof v === 'function' ? null : 'must be a function (surface, state, t)'),
    doc: 'draw(surface, state, t, clock). Pure in (state, t). Must not read a wall '
       + 'clock, must not mutate state in a way a later call can see, and must '
       + 'produce the same marks for the same (seed, t).',
  },

  state: {
    required: false,
    default: () => () => ({}),
    check: (v) => (typeof v === 'function' ? null : 'must be a function () => object'),
    doc: 'Returns a fresh state object for a solve. Build stages mutate it.',
  },

  build: {
    required: false,
    default: () => [],
    check: (v) => {
      if (!Array.isArray(v)) return 'must be an array of [name, fn] pairs';
      for (let i = 0; i < v.length; i++) {
        const s = v[i];
        if (!Array.isArray(s) || s.length !== 2) return `build[${i}] must be [name, fn]`;
        if (typeof s[0] !== 'string' || !s[0]) return `build[${i}][0] must be a non-empty name`;
        if (typeof s[1] !== 'function') return `build[${i}][1] must be a function (state)`;
      }
      return null;
    },
    doc: 'Named stages, run in order, each mutating the state object. Named '
       + 'because a stage that throws must be reportable BY NAME, and because a '
       + 'build that reports only the stages it finished can hide one it skipped.',
  },

  seed: {
    required: false,
    default: () => 1,
    check: (v) => (Number.isInteger(v) && v >= 0 && v <= 0xffffffff
      ? null
      : 'must be an integer in [0, 2^32-1]'),
    doc: 'Default seed. Zero is a seed.',
  },

  time: {
    required: false,
    default: () => null,
    check: (v) => {
      // Stills are valid pieces and do not need a timeline or increasing marks.
      if (v === null) return null;
      if (!v || typeof v !== 'object') return 'must be null (a still) or { duration (seconds), hz (frames per second), loop? }';
      if (!Number.isFinite(v.duration) || v.duration <= 0) return 'time.duration must be a positive finite number of seconds';
      if (!Number.isFinite(v.hz) || v.hz <= 0) return 'time.hz must be a positive finite draw rate';
      if (v.loop !== undefined && typeof v.loop !== 'boolean') return 'time.loop must be true or false';
      const known = ['duration', 'hz', 'loop'];
      const extra = Object.keys(v).filter((k) => !known.includes(k));
      if (extra.length) return `unknown key(s) in time: ${extra.join(', ')}`;
      return null;
    },
    doc: 'null for a still, or { duration, hz, loop? }: duration in seconds (not '
       + 'frames), hz in frames per second. The playhead is the only '
       + 'clock; nothing may read a wall clock. `loop` decides where the frames '
       + 'sit: a looping piece has n frames at i/n and t=1 is t=0 again, so it '
       + 'can repeat seamlessly; a piece that does not loop has n frames at '
       + 'i/(n-1) and its last frame is the completed one. Not being able to say '
       + 'which is how a video export came to drop its middle frame.',
  },

  outputs: {
    required: false,
    default: () => ['raster'],
    check: (v) => {
      if (!Array.isArray(v) || v.length === 0) return `must be a non-empty array from: ${OUTPUTS.join(', ')}`;
      for (const o of v) if (!OUTPUTS.includes(o)) return `unknown output ${JSON.stringify(o)}; known: ${OUTPUTS.join(', ')}`;
      if (!v.includes('raster')) return "must include 'raster'; every piece can be rasterised";
      return null;
    },
    doc: 'What this piece claims it can be rendered to. "raster" is always true. '
       + '"vector" is a CLAIM: the piece promises to use only path geometry, so '
       + 'it can go to SVG, a plotter or print. A vector surface refuses raster '
       + 'operations BY NAME rather than emitting a silently wrong file.',
  },

  params: {
    required: false,
    default: () => ({}),
    check: (v) => {
      if (!v || typeof v !== 'object' || Array.isArray(v)) {
        return 'must be an object of { name: {min, max, value, meaning} }';
      }
      const KNOWN = ['min', 'max', 'value', 'meaning'];
      for (const [k, p] of Object.entries(v)) {
        if (!p || typeof p !== 'object') return `params.${k} must be { min, max, value, meaning }`;
        const extra = Object.keys(p).filter((f) => !KNOWN.includes(f));
        if (extra.length) return `unknown key(s) in params.${k}: ${extra.join(', ')}; known: ${KNOWN.join(', ')}`;
        for (const f of ['min', 'max', 'value']) {
          if (!Number.isFinite(p[f])) return `params.${k}.${f} must be a finite number`;
        }
        if (!(p.min < p.max)) return `params.${k}: min must be less than max`;
        if (p.value < p.min || p.value > p.max) return `params.${k}.value must lie in [min, max]`;
        // Require a visual meaning so parameter controls and agent callers can
        // explain what a sweep changes without reading the piece source.
        if (typeof p.meaning !== 'string' || !p.meaning.trim()) {
          return `params.${k}.meaning must be a non-empty string saying what this knob does to the picture`;
        }
        if (p.meaning.length > 120) return `params.${k}.meaning must be at most 120 characters`;
      }
      return null;
    },
    doc: 'Declared parameters an outside caller may sweep, as '
       + '{ min, max, value, meaning }. Every one of them must move the output, '
       + 'checked at three pins and not two -- a cyclic parameter has the same '
       + 'value at both ends of [0,1]. `meaning` says what the knob does to the '
       + 'PICTURE, in one line, for a reader that cannot see the source.',
  },

  sound: {
    required: false,
    default: () => null,
    check: (v) => (v === null || typeof v === 'function'
      ? null
      : 'must be null or a function (ctx, state, timeline)'),
    doc: 'sound(ctx, state, timeline) builds a Web Audio graph on an '
       + 'OfflineAudioContext exactly as long as the film; it may be async, for a piece that '
       + 'decodes recorded audio first. Pure in (seed, state): '
       + 'schedule on the context clock, take noise from the seeded source, never '
       + 'an unseeded generator or a wall clock. A second of sound is the second clock.seconds '
       + 'names, so picture and sound come from one solved state.',
  },

  preview: {
    required: false,
    default: () => null,
    check: (v) => {
      if (v === null) { return null; }
      if (!v || typeof v !== 'object' || Array.isArray(v)) return 'must be null or { kind, wgsl, uniforms }';
      const extra = Object.keys(v).filter((key) => !['kind', 'wgsl', 'uniforms'].includes(key));
      if (extra.length) return `unknown key(s) in preview: ${extra.join(', ')}`;
      if (v.kind !== 'webgpu-pixels') return 'preview.kind must be webgpu-pixels';
      if (typeof v.wgsl !== 'string' || !v.wgsl.trim() || v.wgsl.length > 65536) {
        return 'preview.wgsl must be non-empty WGSL with at most 65536 characters';
      }
      if (typeof v.uniforms !== 'function') return 'preview.uniforms must be a function (state, t, clock)';
      return null;
    },
    doc: 'Optional approximate opaque WebGPU pixel preview for raster-only pieces. '
       + 'An explicit shader and up to 16 float uniforms; draw remains the CPU '
       + 'reference and every export uses it. This never translates JavaScript.',
  },

  boxes: {
    required: false,
    default: () => null,
    check: (v) => {
      if (!v || typeof v !== 'object' || Array.isArray(v)) {
        return v === null ? null : 'must be null (one fixed box) or { w: [min, max], h: [min, max] }';
      }
      const extra = Object.keys(v).filter((k) => k !== 'w' && k !== 'h');
      if (extra.length) return `unknown key(s) in boxes: ${extra.join(', ')}`;
      for (const k of ['w', 'h']) {
        const r = v[k];
        if (!Array.isArray(r) || r.length !== 2 || !r.every((x) => Number.isFinite(x) && x > 0)) {
          return `boxes.${k} must be [min, max], two positive finite numbers`;
        }
        if (r[0] > r[1]) return `boxes.${k}: min must not exceed max`;
      }
      return null;
    },
    doc: 'null: the piece draws only at `size`. { w: [min, max], h: [min, max] }: '
       + 'the design boxes it accepts, in design units, with `size` among them as '
       + 'the box it draws at when nobody chooses one. A caller picks another with '
       + 'atBox; build stages and draw read the box they were solved for from '
       + 'state.box, so the piece recomposes to it rather than being stretched.',
  },

  reframe: {
    required: false,
    default: () => null,
    check: checkReframe,
    doc: 'null, or a box timeline: [{ t, w, h }, ...], two or more boxes at '
       + 'strictly increasing playheads in [0, 1]. Needs `boxes` and `time`, and '
       + '`size` must be the largest box, max w by max h, which stays the '
       + 'frame. The box holds before the first and after the last, and moves '
       + 'rest to rest between two. state.reframe holds the boxes, so a build '
       + 'lays out at each; draw reads clock.box and moves each element from '
       + 'its place in one layout to its place in the next.',
  },

  finish: {
    required: false,
    default: () => null,
    check: finish.check,
    doc: 'null, or a film finish drawFrame applies to every raster frame: '
       + '{ grain, grainSize, weave, flicker, vignette, grade, bloom, halation }, each off unless declared; '
       + 'grade takes { black, white, tone, toning, red, green, blue, shadows, highlights }. '
       + 'Pure in (seed, frame), so replay reproduces it. Films only: a still '
       + 'keeps its texture on its marks, and an SVG has no pixels to finish.',
  },

  images: {
    required: false,
    default: () => null,
    check: image.check,
    doc: 'null, or named images the piece draws over, from or after: '
       + '{ name: { w, h, channels, pixels, source, rights } }. `pixels` is base64 '
       + 'of w x h x channels bytes, row by row, 8 bits per channel (1 grey, 3 RGB, '
       + '4 RGBA, sRGB), as npm run image writes it; `source` and `rights` name where '
       + 'it came from and whose it is. solve hands every build a fresh copy as '
       + 'state.images.<name>.data, and the manifest records each image\'s size, '
       + 'digest, source and rights, so replay refuses another image. Only a surface '
       + 'with pixels can show it: an SVG holds the marks alone.',
  },

  play: {
    required: false,
    default: () => null,
    check: checkPlay,
    doc: 'null, or an interactive piece: { hz, inputs, step, describe }. step(state, '
       + 'inputs, tick, R) advances one tick and is the only code that may change the '
       + 'state after the build; inputs are { kind: down | move | up, x, y } in design '
       + 'units or { kind: key, key, down }; R is the addressed source of the seed. hz, '
       + 'ticks a second, defaults to 60; inputs lists pointer, key or both, both by '
       + 'default; describe(state) returns one sentence of the state for a screen '
       + 'reader. draw gets the session time in seconds, tick / hz plus the part of a tick '
       + 'already passed in the live page, tick / hz in an export. A session is a pure '
       + 'function of seed, parameters and the input log it records, so a saved session '
       + 'makes its film and stills again. Takes no time, sound, preview or boxes.',
  },
};

const OUTPUTS = ['raster', 'vector'];
// What a piece with play may listen to.
const INPUTS = ['pointer', 'key'];

/** Why a value is not a play declaration, or null when it is one. */
function checkPlay(v) {
  if (v === null) return null;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'must be null or { hz, inputs, step, describe }';
  const extra = Object.keys(v).filter((k) => !['hz', 'inputs', 'step', 'describe'].includes(k));
  if (extra.length) return `unknown key(s) in play: ${extra.join(', ')}`;
  if (v.hz !== undefined && !(Number.isInteger(v.hz) && v.hz >= 1 && v.hz <= 240)) {
    return 'play.hz must be a whole number of ticks a second from 1 to 240';
  }
  const listed = v.inputs === undefined || (Array.isArray(v.inputs) && v.inputs.length > 0
    && v.inputs.every((k) => INPUTS.includes(k)) && new Set(v.inputs).size === v.inputs.length);
  if (!listed) return `play.inputs must list one or both of ${INPUTS.join(', ')}, each once`;
  if (typeof v.step !== 'function') return 'play.step must be a function (state, inputs, tick, R)';
  if (v.describe != null && typeof v.describe !== 'function') return 'play.describe must be a function (state) returning one sentence';
  return null;
}

// Where a session's film keeps what its manifest records of the session, on
// the state its own state() returns: { hz, ticks, digest, file }. A symbol, so
// no piece's own state key can be read as one. Set by core/play.js film().
const SESSION = Symbol('artifex session');

class PieceError extends Error {
  constructor(msg) { super(msg); this.name = 'PieceError'; }
}

/**
 * Validate a piece and return a normalised copy with defaults applied.
 * Throws PieceError naming the offending field. Unknown top-level keys are
 * refused: a misspelled key is how a wrong contract passed every check before.
 */
function validate(piece) {
  if (!piece || typeof piece !== 'object' || Array.isArray(piece)) {
    throw new PieceError('a piece must be an object');
  }

  const unknown = Object.keys(piece).filter((k) => !(k in FIELDS));
  if (unknown.length) {
    throw new PieceError(
      `unknown key(s): ${unknown.join(', ')}. Known keys: ${Object.keys(FIELDS).join(', ')}; `
      + 'spell a misspelled key as listed, and keep the piece\'s own values and helpers in state(), a build stage or the piece\'s module, outside the piece object',
    );
  }

  const out = {};
  for (const [name, f] of Object.entries(FIELDS)) {
    const present = Object.prototype.hasOwnProperty.call(piece, name);
    if (!present) {
      if (f.required) throw new PieceError(`missing required key: ${name} -- ${f.doc}`);
      out[name] = f.default();
      continue;
    }
    const why = f.check(piece[name]);
    if (why) throw new PieceError(`${name}: ${why}`);
    out[name] = piece[name];
  }
  if (out.preview && out.outputs.includes('vector')) {
    throw new PieceError('preview: webgpu-pixels requires raster-only outputs');
  }
  if (out.play) {
    const p = out.play;
    out.play = { hz: p.hz === undefined ? 60 : p.hz, inputs: (p.inputs || INPUTS).slice(), step: p.step, describe: p.describe || null };
    // A session is as long as somebody plays it, and one draw serves the live page and every export.
    if (out.time) throw new PieceError('play: an interactive piece runs as long as its session, so it takes no time; drop time, or drop play for a film');
    if (out.sound) throw new PieceError('sound: a piece with play has no fixed length for a soundtrack to fill; drop sound');
    if (out.preview) throw new PieceError('preview: a piece with play draws live and in its exports with one draw, so it takes no GPU preview; drop preview');
    // A session replays at the box it was played at, and a box chosen mid-game would restart it.
    if (out.boxes) throw new PieceError('boxes: a piece with play draws at its own size, so every session replays at the box it was played at; drop boxes');
  }
  // A soundtrack is as long as the film, and a still has no film.
  if (out.sound && !out.time) {
    throw new PieceError('sound: a soundtrack needs a timeline; declare time: { duration, hz }');
  }
  // A finish models a film's process; a still keeps its texture on its marks.
  if (out.finish && !out.time) {
    throw new PieceError('finish: a film finish needs a timeline; a still keeps its texture on its marks');
  }
  const off = out.boxes && outside(out.boxes, out.size);
  if (off) throw new PieceError(`boxes: size ${off}`);
  if (out.reframe) {
    const why = reframeFits(out, out.reframe);
    if (why) throw new PieceError(`reframe: ${why}`);
    const f = frameOf(out.reframe);
    if (f.w !== out.size.w || f.h !== out.size.h) {
      throw new PieceError(`reframe: size must be the largest box, ${f.w} x ${f.h}, which stays the film's frame; got ${out.size.w} x ${out.size.h}`);
    }
  }
  return out;
}

/** Why a value is not a box timeline, or null when it is one. */
function checkReframe(v) {
  if (v === null) return null;
  if (!Array.isArray(v) || v.length < 2) return 'must be null or [{ t, w, h }, ...] with two or more boxes';
  for (let i = 0; i < v.length; i++) {
    const k = v[i];
    if (!k || typeof k !== 'object') return `reframe[${i}] must be { t, w, h }`;
    const extra = Object.keys(k).filter((x) => !['t', 'w', 'h'].includes(x));
    if (extra.length) return `unknown key(s) in reframe[${i}]: ${extra.join(', ')}`;
    if (!(Number.isFinite(k.t) && k.t >= 0 && k.t <= 1)) return `reframe[${i}].t must be a playhead in [0, 1]`;
    for (const d of ['w', 'h']) {
      if (!Number.isFinite(k[d]) || k[d] <= 0) return `reframe[${i}].${d} must be a positive finite number`;
    }
    // Two boxes at one playhead would be a cut; the box only ever moves.
    if (i && !(k.t > v[i - 1].t)) return `reframe[${i}].t must come after reframe[${i - 1}].t: the box moves, it never cuts`;
  }
  return null;
}

/** Why a timeline does not fit a piece, or null when every box is one it draws at. */
function reframeFits(piece, keys) {
  if (!piece.boxes) return `${piece.name} declares no boxes, so it draws only at ${piece.size.w} x ${piece.size.h}`;
  if (!piece.time) return 'a box timeline needs a timeline; declare time: { duration, hz }';
  for (let i = 0; i < keys.length; i++) {
    const off = outside(piece.boxes, keys[i]);
    if (off) return `box ${i}, ${keys[i].w} x ${keys[i].h}: ${off}`;
  }
  return null;
}

/** A copy of one box of a timeline. */
const keyOf = (k) => ({ t: k.t, w: k.w, h: k.h });

/** The frame a timeline plays in: its widest width by its tallest height. */
function frameOf(keys) {
  return { w: Math.max(...keys.map((k) => k.w)), h: Math.max(...keys.map((k) => k.h)) };
}

/**
 * Where the box stands at a quantized playhead: its size, its corner centred in
 * the frame, the boxes it moves between and how far, u from 0 to 1, linear in
 * the playhead. The box itself moves by ease.smooth(u), rest to rest.
 */
function boxAt(piece, t) {
  const keys = piece.reframe;
  let from = 0;
  while (from < keys.length - 1 && t >= keys[from + 1].t) from++;
  const to = Math.min(from + 1, keys.length - 1);
  const u = to === from ? 0 : clamp01((t - keys[from].t) / (keys[to].t - keys[from].t));
  const e = ease.smooth(u);
  const w = keys[from].w + (keys[to].w - keys[from].w) * e;
  const h = keys[from].h + (keys[to].h - keys[from].h) * e;
  return { w, h, x: (piece.size.w - w) / 2, y: (piece.size.h - h) / 2, from, to, u };
}

/** Why a box lies outside declared ranges, or null when it lies inside. */
function outside(boxes, box) {
  for (const k of ['w', 'h']) {
    const [lo, hi] = boxes[k];
    if (!(box[k] >= lo && box[k] <= hi)) return `${k} ${box[k]} is outside the declared [${lo}, ${hi}]`;
  }
  return null;
}

/**
 * A validated piece at another design box.
 *
 * Returns a copy whose `size` is `box`, so everything that reads `size` -- the
 * page's canvas, a film, a PNG, an SVG, the replay manifest -- takes the box
 * without being told it changed. A piece that declares no `boxes` draws only at
 * its own size; any other box, or one outside the declared ranges, is refused
 * by name rather than stretched.
 *
 * Given a box timeline, [{ t, w, h }, ...], instead of one box, it returns a
 * copy that plays it: its `size` is the timeline's frame and its `reframe` the
 * timeline. One box replaces any timeline, even at the piece's own size.
 */
function atBox(piece, box) {
  if (Array.isArray(box)) {
    const why = checkReframe(box) || reframeFits(piece, box);
    if (why) throw new PieceError(`atBox: ${piece.name} cannot play that box timeline: ${why}`);
    return { ...piece, size: frameOf(box), reframe: box.map(keyOf) };
  }
  if (!box || !Number.isFinite(box.w) || !Number.isFinite(box.h)) {
    throw new PieceError(`atBox: a box is { w, h } in design units, got ${JSON.stringify(box)}`);
  }
  if (box.w === piece.size.w && box.h === piece.size.h) return piece.reframe ? { ...piece, reframe: null } : piece;
  if (!piece.boxes) {
    throw new PieceError(`atBox: ${piece.name} declares no boxes, so it draws only at ${piece.size.w} x ${piece.size.h}`);
  }
  const off = outside(piece.boxes, box);
  const { w, h } = piece.boxes;
  if (off) throw new PieceError(`atBox: ${piece.name} cannot draw at ${box.w} x ${box.h}: ${off}; it takes widths ${w[0]} to ${w[1]} and heights ${h[0]} to ${h[1]}`);
  return { ...piece, size: { w: box.w, h: box.h }, reframe: null };
}

/**
 * A box timeline written as text, `t:WxH,t:WxH,...`, as the page's `reframe`
 * parameter and the `--reframe` options take it: 0:1280x720,0.5:405x720.
 * Only the writing is read here; atBox refuses by name a timeline the piece
 * cannot play.
 */
function parseReframe(text) {
  return String(text).split(',').map((part, i) => {
    const m = /^([^:]+):([^x]+)x(.+)$/.exec(part.trim());
    if (!m) throw new PieceError(`reframe: box ${i}, ${JSON.stringify(part)}, must be t:WIDTHxHEIGHT, such as 0.5:405x720`);
    return { t: Number(m[1]), w: Number(m[2]), h: Number(m[3]) };
  });
}

/** Number of distinct drawn frames. 1 for a still. */
function frameCount(piece) {
  if (!piece.time) return 1;
  return Math.max(1, Math.round(piece.time.duration * piece.time.hz));
}

/**
 * The denominator of the drawn-frame lattice.
 *
 * Drawing and export share the rounded frame count and loop convention.
 * Looping timelines exclude the repeated endpoint; non-looping timelines
 * include both endpoints. A single frame uses denominator one.
 */
function frameDen(piece) {
  const n = frameCount(piece);
  if (n === 1) return 1;
  return piece.time.loop ? n : n - 1;
}

/** Which drawn frame a playhead falls on. 0 for a still. */
function frameIndex(piece, t) {
  if (!piece.time) return 0;
  const n = frameCount(piece);
  if (n === 1) return 0;
  if (piece.time.loop) {
    const tt = t - Math.floor(t);            // wraps, so t=1 is t=0 again
    return Math.round(tt * n) % n;
  }
  return Math.round(Math.min(1, Math.max(0, t)) * (n - 1));
}

/**
 * The drawn-frame grid. A piece is drawn at held playheads, never at continuous
 * ones: advancing a simulation continuously under a stepped drawing makes the
 * motion slide. A still quantises to 0.
 */
function frameT(piece, t) {
  // A piece with play is drawn at its session time in seconds, between ticks too.
  if (piece.play) return t;
  if (!piece.time) return 0;
  return frameIndex(piece, t) / frameDen(piece);
}

/**
 * Everything a piece may know about where it is in its own timeline.
 *
 * Derive frame indices and timing from the validated timeline so simulations
 * do not need a second copy of its duration or draw rate.
 */
function clockAt(piece, t) {
  // A session's clock: the tick its time falls in, and the tick rate.
  if (piece.play) {
    const tick = Math.floor(t * piece.play.hz + 1e-9);
    return { frame: tick, tick, seconds: t, hz: piece.play.hz };
  }
  const frames = frameCount(piece);
  const frame = frameIndex(piece, t);
  const clock = {
    frame,
    frames,
    seconds: piece.time ? frame / piece.time.hz : 0,
    duration: piece.time ? piece.time.duration : 0,
    hz: piece.time ? piece.time.hz : 0,
    loop: piece.time ? !!piece.time.loop : false,
  };
  // Only a piece playing a box timeline is told where its box stands.
  if (piece.reframe) clock.box = boxAt(piece, frameT(piece, t));
  return clock;
}

/**
 * Run the build stages, reporting every stage that was DECLARED -- not only the
 * ones that finished. A build that reports `ms.length > 0` can hide a stage it
 * skipped; the count has to match.
 */
function solve(piece, seed, params, opt) {
  // `until` stops the build AFTER a named stage, so a caller outside the piece
  // can look at what it had made by then. An unknown name is refused rather
  // than quietly meaning "run everything": the finished state would come back
  // looking exactly like a stage that had produced all of it, which is the one
  // answer a reader inspecting an intermediate step must never be given.
  const until = (opt && opt.until) || null;
  if (until !== null && !piece.build.some(([n]) => n === until)) {
    throw new PieceError(
      `solve: no build stage called ${JSON.stringify(until)}. `
      + `Declared: ${piece.build.map(([n]) => n).join(', ') || '(none)'}`,
    );
  }
  const sd = seed === undefined ? piece.seed : seed >>> 0;
  // A state() that throws, or returns no object, is reported as a failed stage called state(), before
  // the first declared one, so a caller names it as it names any failed build.
  let state, error = null;
  try {
    state = piece.state();
    if (state === null || typeof state !== 'object') throw new Error('state() returned no object');
  } catch (e) {
    state = {};
    error = { stage: 'state()', at: -1, of: piece.build.length, message: String(e && e.message || e) };
  }
  state.seed = sd;
  // Only a piece that declares boxes is told its box; any other keeps the state
  // it always had.
  if (piece.boxes) state.box = { w: piece.size.w, h: piece.size.h };
  if (piece.reframe) state.reframe = piece.reframe.map(keyOf);
  // Each solve gets its own copy of every image's bytes, so a build that
  // writes into one cannot change the next solve.
  if (piece.images) state.images = image.solved(piece.images);
  // Resolve every declared parameter to its value before running build stages.
  state.params = {};
  for (const [k, p] of Object.entries(piece.params)) state.params[k] = p.value;
  for (const [k, v] of Object.entries(params || {})) {
    if (!(k in piece.params)) {
      throw new PieceError(`unknown param: ${k}. Declared: ${Object.keys(piece.params).join(', ') || '(none)'}`);
    }
    const d = piece.params[k];
    if (!Number.isFinite(v) || v < d.min || v > d.max) {
      throw new PieceError(`params.${k} must be a finite number in [${d.min}, ${d.max}], got ${v}`);
    }
    state.params[k] = v;
  }
  const ms = [];
  for (const [name, fn] of error ? [] : piece.build) {
    const t0 = Date.now();
    try {
      fn(state);
      ms.push([name, Date.now() - t0]);
      if (name === until) break;
    } catch (e) {
      error = { stage: name, at: ms.length, of: piece.build.length, message: String(e && e.message || e) };
      break;
    }
  }
  const out = { state, seed: sd, stages: { ms, of: piece.build.length, error } };
  out.manifest = manifest(piece, out);
  return out;
}

// The library version a manifest records. A literal rather than a require of
// package.json, because core/ is bundled into a single page file by
// tools/build-page.js and that bundler carries .js modules only. A test holds
// the two equal, so the literal cannot drift without failing.
const VERSION = '0.1.0';

/**
 * Resolved render inputs to use with the matching piece source and input data.
 *
 * The solve records the piece, seed, and resolved parameters. It has no
 * playhead; the caller that draws a frame adds the quantized `t`.
 *
 * EVERY DECLARED PARAMETER APPEARS, resolved to the value actually used, not
 * only the ones an outside caller overrode. A recipe that lists the overrides
 * and trusts the defaults stops reproducing the picture the moment a default
 * changes, which is exactly when a recipe has to work.
 */
function manifest(piece, solved) {
  const m = {
    artifex: VERSION,
    piece: piece.name,
    seed: solved.seed,
    size: { w: piece.size.w, h: piece.size.h },
    outputs: piece.outputs.slice(),
    params: { ...solved.state.params },
  };
  // A box timeline is part of what was drawn; a recipe without one has no key.
  if (piece.reframe) m.reframe = piece.reframe.map(keyOf);
  // So is every image it was drawn with, named by digest and never by pixels.
  if (piece.images) m.images = image.describe(piece.images);
  // And a session's film names the session it was played from, by its log's digest.
  if (solved.state[SESSION]) m.session = { ...solved.state[SESSION] };
  return m;
}

/**
 * One value, described rather than copied.
 *
 * Numbers, strings and booleans come back as themselves. A list -- an array or
 * a typed array -- comes back as its length, its kind, and, when every element
 * is a finite number, the range it spans; when the elements are objects, the
 * shape of the FIRST one, because "4,812 things" does not answer what is in the
 * list. Anything else object-shaped reports its keys and is not descended into.
 */
function shape(v) {
  if (v === null || ['number', 'string', 'boolean'].includes(typeof v)) return v;
  if (typeof v !== 'object') return String(v);
  if (Array.isArray(v) || ArrayBuffer.isView(v)) {
    const d = { length: v.length, kind: ArrayBuffer.isView(v) ? v.constructor.name : 'array' };
    let lo = Infinity;
    let hi = -Infinity;
    let numeric = true;
    for (let i = 0; i < v.length; i++) {
      if (typeof v[i] !== 'number' || !Number.isFinite(v[i])) { numeric = false; break; }
      if (v[i] < lo) lo = v[i];
      if (v[i] > hi) hi = v[i];
    }
    if (numeric && v.length) { d.min = lo; d.max = hi; }
    if (!numeric && v.length) d.of = shape(v[0]);
    return d;
  }
  return { keys: Object.keys(v) };
}

/**
 * A JSON-safe look at a build state: which keys, how long, over what range.
 *
 * Raw state is what a BUILD needs -- typed arrays, nested polylines, closures --
 * and JSON.stringify of that is either wrong (a typed array becomes an object
 * of indices) or enormous. A reader outside the build wants the SHAPE of what a
 * stage produced, so this describes one level and names the rest.
 */
function summarise(state) {
  const out = {};
  for (const [k, v] of Object.entries(state)) out[k] = shape(v);
  return out;
}

module.exports = {
  FIELDS, OUTPUTS, INPUTS, SESSION, VERSION, PieceError, validate, atBox, parseReframe,
  frameT, frameCount, frameDen, frameIndex, clockAt, solve, summarise, manifest,
};
