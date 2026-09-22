// Authored time: where a moment sits in a window, how a move gets there, and
// which shot a frame belongs to.
//
// The playhead is a piece's only clock, and nothing here knows what moves. A
// span places a moment inside a window, a rate shapes how a move accelerates, a
// tween fuses the two into one value, and a shot list puts every cut on a whole
// frame of the piece's own grid. Transitions between shots are not here.

'use strict';

const { clamp01, unlerp, smoothstep } = require('./num.js');

/** A window runs forwards between finite ends. Equal ends are one instant. */
function checkWindow(who, a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) {
    throw new RangeError(`${who}: a window needs finite ends with start <= end, got [${a}, ${b}]`);
  }
}

/**
 * Where x sits in the window [a, b], as [0, 1], held at both ends.
 *
 * Any unit works when all three share it: playhead, seconds or frames. A
 * ZERO-LENGTH WINDOW IS A CUT: 0 before `a` and 1 from `a` on. `unlerp` answers
 * 0 there, which for time would be a change that never happens.
 */
function span(a, b, x) {
  checkWindow('span', a, b);
  if (!Number.isFinite(x)) throw new TypeError(`span: the moment must be a finite number, got ${x}`);
  if (a === b) return x < a ? 0 : 1;
  return unlerp(a, b, x);
}

// Outside (0, 1) a rate has a value rather than an extrapolation: exactly its
// start before the move and exactly its end after it, so nothing downstream
// has to clamp and the arithmetic cannot leave a move a hair short of 1.
const unit = (f) => (x) => (x <= 0 ? 0 : x >= 1 ? 1 : f(x));

// The conventional back-out constant: the move passes its mark by about 10%.
const OVERSHOOT = 1.70158;

/**
 * Named rate curves: how far a move has got for how much of its time has gone.
 * Each starts at 0 and arrives at 1, except `bump`, which goes out and comes
 * back. Frozen, because every piece in a page shares one table.
 */
const ease = Object.freeze({
  // Constant speed: a scan, a plotter, anything mechanical.
  linear: clamp01,
  // Cubic: leaves from rest and arrives at speed.
  in: unit((u) => u * u * u),
  // Cubic: leaves at speed and arrives at rest.
  out: unit((u) => { const v = 1 - u; return 1 - v * v * v; }),
  // Cubic: rest to rest, with most of the travel in the middle.
  inOut: unit((u) => { if (u < 0.5) return 4 * u * u * u; const v = 1 - u; return 1 - 4 * v * v * v; }),
  // Hermite smoothstep: a gentler rest to rest.
  smooth: (x) => smoothstep(0, 1, x),
  // Passes its mark and settles back onto it.
  back: unit((u) => { const v = u - 1; return 1 + v * v * ((OVERSHOOT + 1) * v + OVERSHOOT); }),
  // An event: out to 1 at the middle and back to 0, at rest at both ends and
  // at the peak. 0 outside the window, so it happens there and nowhere else.
  bump: (x) => {
    if (x <= 0 || x >= 1) return 0;
    const v = 1 - Math.abs(2 * x - 1);
    return v * v * (3 - 2 * v);
  },
});

/**
 * A window and a rate as one value: `tween(a, b, rate)(x)` is `rate(span(a, b, x))`.
 * The move can then sit in a table that `draw` and `sound` both read, instead
 * of being an expression written separately in each.
 */
function tween(a, b, rate) {
  checkWindow('tween', a, b);
  if (typeof rate !== 'function') throw new TypeError('tween: the rate must be a function of [0, 1], such as ease.out');
  return (x) => rate(span(a, b, x));
}

/**
 * Resolve a shot list onto a timeline's frames.
 *
 * `list` is [[name, seconds], ...] in playing order. Each cut lands on the frame
 * nearest its time, `round(hz * elapsed)`, so every boundary is a whole frame.
 * NOTHING IS COMPARED IN SECONDS: 0.1 + 0.2 is not 0.3, and a boundary summed in
 * seconds can land a float either side of a frame's time. Compared as integers,
 * a frame falls on the same side of a cut however the playhead arrived.
 *
 * `timeline` is anything with `hz` and `frames`: the clock `draw` receives or the
 * timeline `sound` receives, so picture and sound resolve the same cuts. The
 * shots must fill it exactly. Returns frozen `{ name, index, start, end }`,
 * with `end` exclusive; the frame at `start` is the cut into the shot.
 */
function shots(list, timeline) {
  if (!timeline || !Number.isFinite(timeline.hz) || timeline.hz <= 0
      || !Number.isSafeInteger(timeline.frames) || timeline.frames < 1) {
    throw new RangeError('shots: needs a timeline with a positive hz and whole frames; a still has no shots');
  }
  if (!Array.isArray(list) || list.length === 0) throw new TypeError('shots: needs a non-empty list of [name, seconds]');
  const out = [];
  let elapsed = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (!Array.isArray(item) || item.length !== 2 || typeof item[0] !== 'string' || !item[0]) {
      throw new TypeError(`shots: entry ${i} must be [name, seconds]`);
    }
    const [name, seconds] = item;
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new RangeError(`shots: "${name}" must last a positive, finite number of seconds, got ${seconds}`);
    }
    elapsed += seconds;
    const end = Math.round(elapsed * timeline.hz);
    if (end <= start) throw new RangeError(`shots: "${name}" (${seconds} s) holds no whole frame at ${timeline.hz} Hz`);
    out.push(Object.freeze({ name, index: i, start, end }));
    start = end;
  }
  if (start !== timeline.frames) {
    throw new RangeError(`shots: the list lasts ${start} frames (${elapsed} s at ${timeline.hz} Hz) and the timeline holds ${timeline.frames}`);
  }
  return Object.freeze(out);
}

/** The shot holding a whole frame, found by integer comparison. */
function shotAt(list, frame) {
  // The raw [name, seconds] list has no frames; without this it would answer
  // its first shot for every frame.
  if (!Array.isArray(list) || list.length === 0 || !Number.isInteger(list[0].start)) {
    throw new TypeError('shotAt: needs the list shots() returned');
  }
  if (!Number.isInteger(frame) || frame < list[0].start || frame >= list[list.length - 1].end) {
    throw new RangeError(`shotAt: ${frame} is not a whole frame of this shot list`);
  }
  let lo = 0;
  let hi = list.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (list[mid].start <= frame) lo = mid;
    else hi = mid - 1;
  }
  return list[lo];
}

module.exports = { span, ease, tween, shots, shotAt };
