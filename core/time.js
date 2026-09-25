// Authored time: where a moment sits in a window, how a move gets there, and
// which shot a frame belongs to.
//
// The playhead is a piece's only clock, and nothing here knows what moves. A
// span places a moment inside a window, a rate shapes how a move accelerates, a
// tween fuses the two into one value, and a shot list puts every cut on a whole
// frame of the piece's own grid. A spring and a follower give a move weight:
// seconds since a cue in, a damped response out. Transitions between shots are
// not here.

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

// A spring has settled once it stays within this fraction of its travel.
const SETTLE = 1e-3;
// Steps a second that `follow` takes from its cue, reading its driver once each.
const FOLLOW_HZ = 240;

/** Stiffness in 1/s², damping as a ratio (1 is critical), delay in seconds. */
function checkSpring(who, opts) {
  const { stiffness, damping, delay = 0 } = opts || {};
  if (!Number.isFinite(stiffness) || stiffness <= 0) {
    throw new RangeError(`${who}: stiffness must be a positive, finite number, got ${stiffness}`);
  }
  if (!Number.isFinite(damping) || damping <= 0) {
    throw new RangeError(`${who}: damping must be a positive, finite ratio, got ${damping}; 1 is critical`);
  }
  if (!Number.isFinite(delay) || delay < 0) {
    throw new RangeError(`${who}: delay must be a finite number of seconds >= 0, got ${delay}`);
  }
  return { w: Math.sqrt(stiffness), z: damping, delay };
}

/**
 * How a free damped oscillator, f'' + 2zw f' + w² f = 0, carries its offset f
 * and velocity g over `dt` seconds: out = [f from f, f from g, g from f, g from g].
 * Once the decay underflows every entry is exactly 0, so a large time cannot
 * meet a cosine of an overflowed angle and answer NaN.
 */
function carry(w, z, dt, out) {
  if (z < 1) {
    const s = z * w;
    const d = w * Math.sqrt(1 - z * z);
    const e = Math.exp(-s * dt);
    const c = Math.cos(d * dt);
    const n = Math.sin(d * dt) / d;
    out[0] = e * (c + s * n); out[1] = e * n; out[2] = -e * w * w * n; out[3] = e * (c - s * n);
  } else if (z === 1) {
    const e = Math.exp(-w * dt);
    out[0] = e * (1 + w * dt); out[1] = e * dt; out[2] = -e * w * w * dt; out[3] = e * (1 - w * dt);
  } else {
    // The slow root as w² over the fast one: -zw + q would cancel at high damping.
    const k = z + Math.sqrt(z * z - 1);
    const r1 = -w / k;
    const r2 = -w * k;
    const e1 = Math.exp(r1 * dt);
    const e2 = Math.exp(r2 * dt);
    out[0] = (r2 * e1 - r1 * e2) / (r2 - r1); out[1] = (e2 - e1) / (r2 - r1);
    out[2] = r1 * r2 * (e1 - e2) / (r2 - r1); out[3] = (r2 * e2 - r1 * e1) / (r2 - r1);
  }
  if (!(Math.abs(out[0]) + Math.abs(out[1]) + Math.abs(out[3]) > 0)) out.fill(0);
}

/**
 * A damped spring released at a cue: `spring(opts)(s)` is how far a part has
 * got towards its mark `s` seconds after the cue, from 0 at rest to 1.
 *
 * Under-damped (damping < 1) passes the mark and rings; critical (1) arrives
 * soonest without passing it; over-damped (> 1) creeps in. 0 before the cue and
 * through its delay. `settle` is the time since the cue from which the value
 * stays within 0.1% of the mark. `s < 0 ? 0 : 1 - spring(opts)(s)` is a part
 * kicked off its mark at the cue coming back to rest, a recoil.
 */
function spring(opts) {
  const { w, z, delay } = checkSpring('spring', opts);
  const m = new Float64Array(4);
  const at = (u) => { carry(w, z, u, m); return 1 - m[0]; };
  // The last time |1 - x| is SETTLE, found by bisection where it falls through
  // it once: from the last swing that reaches it to the next crossing of the
  // mark when the spring rings, otherwise from the release.
  let lo = 0;
  let hi = 1 / w;
  if (z < 1) {
    const d = w * Math.sqrt(1 - z * z);
    const swing = Math.floor(Math.log(1 / SETTLE) * d / (z * w * Math.PI));
    lo = swing * Math.PI / d;
    hi = lo + (Math.PI - Math.atan2(d, z * w)) / d;
  } else {
    while (1 - at(hi) > SETTLE) hi *= 2;
  }
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    if (Math.abs(1 - at(mid)) > SETTLE) lo = mid;
    else hi = mid;
  }
  const move = (s) => {
    if (!Number.isFinite(s)) throw new TypeError(`spring: the time since the cue must be a finite number, got ${s}`);
    return s <= delay ? 0 : at(s - delay);
  };
  move.settle = delay + hi;
  return Object.freeze(move);
}

/**
 * A part that follows a driver: `follow(driver, opts)(s)` is where a part hung
 * on a spring behind `driver`, read `delay` seconds late, sits `s` seconds after
 * the cue. It trails a moving driver, passes it when the driver stops and
 * settles on it.
 *
 * The part is at rest on its driver at the cue and sits on it before. Each call
 * steps from the cue at FOLLOW_HZ, taking the driver as straight between steps
 * and carrying the spring exactly across each, so its work grows with `s`.
 */
function follow(driver, opts) {
  if (typeof driver !== 'function') {
    throw new TypeError('follow: the driver must be a function of seconds since the cue, such as a tween or a spring');
  }
  const { w, z, delay } = checkSpring('follow', opts);
  const h = 1 / FOLLOW_HZ;
  const step = new Float64Array(4);
  const rest = new Float64Array(4);
  carry(w, z, h, step);
  return (s) => {
    if (!Number.isFinite(s)) throw new TypeError(`follow: the time since the cue must be a finite number, got ${s}`);
    if (s <= 0) return driver(s - delay);
    const n = Math.floor(s / h);
    const r = s - n * h;
    if (r > 0) carry(w, z, r, rest);
    let a = driver(-delay);
    let y = a;
    let v = 0;
    for (let i = 1; i <= (r > 0 ? n + 1 : n); i++) {
      const full = i <= n;
      const m = full ? step : rest;
      const next = driver((full ? i * h : s) - delay);
      const slope = (next - a) / (full ? h : r);
      // Drag holds a part moving at `slope` 2z/w seconds of travel behind.
      const lag = -2 * z * slope / w;
      const f = y - a - lag;
      const g = v - slope;
      y = next + lag + m[0] * f + m[1] * g;
      v = slope + m[2] * f + m[3] * g;
      a = next;
    }
    return y;
  };
}

module.exports = { span, ease, tween, shots, shotAt, spring, follow };
