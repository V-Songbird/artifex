// The piece contract. ONE source of truth.
//
// The engine this project imports from stated its contract in four places that
// disagreed -- a prose paragraph said "four things", the runtime header said
// twelve required and thirteen optional, the suite required fifteen members of a
// thirty-three member object, and the builder enforced two of them with a regex.
// All four were correct about different readers, and an author could satisfy
// every one of them and still be wrong in a way no check could see. One subject
// shipped for months carrying a style block with the wrong keys.
//
// So: this file is the contract. The validator reads FIELDS, the documentation
// quotes FIELDS, and nothing else states it. Unknown keys are refused, because a
// misspelled key is the exact fault that got through last time.
//
// Nothing here knows what kind of art a piece makes. That is deliberate and it
// is the project's governing rule -- see docs/subject-neutrality.md.

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
    doc: 'draw(surface, state, t). Pure in (state, t). Must not read a wall '
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
      // A STILL IS A LEGAL PIECE. A poster, a plotter drawing and a data plate
      // have no timeline, and the engine this imports from made one mandatory --
      // its suite failed any piece whose last frame did not carry more marks
      // than its first. See docs/subject-neutrality.md, N6.
      if (v === null) return null;
      if (!v || typeof v !== 'object') return 'must be null (a still) or { duration, hz, hold? }';
      if (!Number.isFinite(v.duration) || v.duration <= 0) return 'time.duration must be a positive finite number of seconds';
      if (!Number.isFinite(v.hz) || v.hz <= 0) return 'time.hz must be a positive finite draw rate';
      if (v.hold !== undefined && (!Number.isFinite(v.hold) || v.hold < 0)) return 'time.hold must be a non-negative number of seconds';
      const known = ['duration', 'hz', 'hold'];
      const extra = Object.keys(v).filter((k) => !known.includes(k));
      if (extra.length) return `unknown key(s) in time: ${extra.join(', ')}`;
      return null;
    },
    doc: 'null for a still, or { duration, hz, hold? }. The playhead is the only '
       + 'clock; nothing may read a wall clock.',
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
      if (!v || typeof v !== 'object' || Array.isArray(v)) return 'must be an object of { name: {min, max, value} }';
      for (const [k, p] of Object.entries(v)) {
        if (!p || typeof p !== 'object') return `params.${k} must be { min, max, value }`;
        for (const f of ['min', 'max', 'value']) {
          if (!Number.isFinite(p[f])) return `params.${k}.${f} must be a finite number`;
        }
        if (!(p.min < p.max)) return `params.${k}: min must be less than max`;
        if (p.value < p.min || p.value > p.max) return `params.${k}.value must lie in [min, max]`;
      }
      return null;
    },
    doc: 'Declared parameters an outside caller may sweep. Every one of them '
       + 'must move the output, checked at three pins and not two -- a cyclic '
       + 'parameter has the same value at both ends of [0,1].',
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
  return out;
}

/**
 * The drawn-frame grid. A piece is drawn at held playheads, never at continuous
 * ones: advancing a simulation continuously under a stepped drawing makes the
 * motion slide. A still quantises to 0.
 */
function frameT(piece, t) {
  const tt = Math.min(1, Math.max(0, t));
  if (!piece.time) return 0;
  const n = piece.time.duration * piece.time.hz;
  return Math.min(1, Math.round(tt * n) / n);
}

/** Number of distinct drawn frames. 1 for a still. */
function frameCount(piece) {
  if (!piece.time) return 1;
  return Math.max(1, Math.round(piece.time.duration * piece.time.hz));
}

/**
 * Run the build stages, reporting every stage that was DECLARED -- not only the
 * ones that finished. A build that reports `ms.length > 0` can hide a stage it
 * skipped; the count has to match.
 */
function solve(piece, seed, params) {
  const sd = seed === undefined ? piece.seed : seed >>> 0;
  const state = piece.state();
  state.seed = sd;
  // Declared parameters reach the build as VALUES. A `params` block that never
  // arrives anywhere is a declaration that cannot fail, which is the disease
  // this project catalogued 23 cases of.
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
    } catch (e) {
      error = { stage: name, at: ms.length, of: piece.build.length, message: String(e && e.message || e) };
      break;
    }
  }
  return { state, seed: sd, stages: { ms, of: piece.build.length, error } };
}

module.exports = { FIELDS, OUTPUTS, PieceError, validate, frameT, frameCount, solve };
