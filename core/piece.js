// The piece contract. ONE source of truth.
//
// FIELDS defines the schema consumed by the validator and documented by the
// skill. Unknown keys are refused so misspelled options cannot pass silently.
//
// Nothing here knows what kind of art a piece makes. That is deliberate and it
// is the project's governing rule.

'use strict';

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
    doc: 'The DESIGN BOX, in design units. It never changes. Aspect ratio, '
       + 'device scale and output medium are render-time choices, so one piece '
       + 'serves a page, a video, a print and a plotter.',
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
      if (!v || typeof v !== 'object') return 'must be null (a still) or { duration, hz, loop? }';
      if (!Number.isFinite(v.duration) || v.duration <= 0) return 'time.duration must be a positive finite number of seconds';
      if (!Number.isFinite(v.hz) || v.hz <= 0) return 'time.hz must be a positive finite draw rate';
      if (v.loop !== undefined && typeof v.loop !== 'boolean') return 'time.loop must be true or false';
      const known = ['duration', 'hz', 'loop'];
      const extra = Object.keys(v).filter((k) => !known.includes(k));
      if (extra.length) return `unknown key(s) in time: ${extra.join(', ')}`;
      return null;
    },
    doc: 'null for a still, or { duration, hz, loop? }. The playhead is the only '
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
};

const OUTPUTS = ['raster', 'vector'];

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
      `unknown key(s): ${unknown.join(', ')}. Known keys: ${Object.keys(FIELDS).join(', ')}`,
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
  return out;
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
  const frames = frameCount(piece);
  const frame = frameIndex(piece, t);
  return {
    frame,
    frames,
    seconds: piece.time ? frame / piece.time.hz : 0,
    duration: piece.time ? piece.time.duration : 0,
    hz: piece.time ? piece.time.hz : 0,
    loop: piece.time ? !!piece.time.loop : false,
  };
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
  const state = piece.state();
  state.seed = sd;
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
  let error = null;
  for (const [name, fn] of piece.build) {
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
  return {
    artifex: VERSION,
    piece: piece.name,
    seed: solved.seed,
    size: { w: piece.size.w, h: piece.size.h },
    outputs: piece.outputs.slice(),
    params: { ...solved.state.params },
  };
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
  FIELDS, OUTPUTS, VERSION, PieceError, validate,
  frameT, frameCount, frameDen, frameIndex, clockAt, solve, summarise, manifest,
};
