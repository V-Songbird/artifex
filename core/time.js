// Authored time: where a moment sits in a window, how a move gets there, and
// which shot a frame belongs to.
//
// The playhead is a piece's only clock, and nothing here knows what moves. A
// span places a moment inside a window, a rate shapes how a move accelerates, a
// tween fuses the two into one value, and a shot list puts every cut on a whole
// frame of the piece's own grid. A spring and a follower give a move weight:
// seconds since a cue in, a damped response out. A key track strings many
// values on one line with holds and breakdowns, stopping on each key or
// flowing through them, and a gait counts strides that
// the picture and the footsteps read alike. A beat grid puts bars and beats of
// a tempo on seconds and on the frames shots cut on, with the off-beats swung.
// Transitions between shots are not here.

'use strict';

const { clamp01, unlerp, smoothstep, lerp } = require('./num.js');

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
 * The last index i with at[i] <= x, or -1 before the first. `at` never falls,
 * so of several equal entries the last one wins: the later key, the step that
 * starts there.
 */
function lastAtOrBefore(at, x) {
  let lo = -1;
  let hi = at.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (at[mid] <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * A key track: `keys([[at, value, rate], ...])(x)` passes through every value
 * at its `at` and moves between neighbours at the rate the earlier key names
 * (`ease.linear` when it names none), so each key carries the spacing chart to
 * the next.
 *
 * `at` shares a unit with `x`, frames or seconds, and never falls. Two keys
 * with one value are a hold. Two keys at one `at` are a cut: the earlier value
 * before it, the later from it on. The track holds its first value before the
 * first key and its last after the last. Each value is exact on its key.
 */
function keys(list) {
  if (!Array.isArray(list) || list.length === 0) throw new TypeError('keys: needs a non-empty list of [at, value] or [at, value, rate]');
  const at = [];
  const value = [];
  const rate = [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (!Array.isArray(item) || item.length < 2 || item.length > 3) {
      throw new TypeError(`keys: entry ${i} must be [at, value] or [at, value, rate]`);
    }
    const [x, v, r = ease.linear] = item;
    if (!Number.isFinite(x)) throw new TypeError(`keys: entry ${i} needs a finite time, got ${x}`);
    if (i > 0 && x < at[i - 1]) throw new RangeError(`keys: entry ${i} at ${x} comes before entry ${i - 1} at ${at[i - 1]}; list keys in time order`);
    if (!Number.isFinite(v)) throw new TypeError(`keys: entry ${i} needs a finite value, got ${v}`);
    if (typeof r !== 'function') throw new TypeError(`keys: entry ${i}'s rate must be a function of [0, 1], such as ease.out`);
    at.push(x); value.push(v); rate.push(r);
  }
  const last = at.length - 1;
  return Object.freeze((x) => {
    if (!Number.isFinite(x)) throw new TypeError(`keys: the moment must be a finite number, got ${x}`);
    const i = lastAtOrBefore(at, x);
    if (i < 0) return value[0];
    if (i === last) return value[last];
    // at[i] <= x < at[i + 1], so the window is never a cut here.
    return lerp(value[i], value[i + 1], rate[i]((x - at[i]) / (at[i + 1] - at[i])));
  });
}

/**
 * A key track that passes through its keys: `flow([[at, value], ...])(x)` is a
 * monotone cubic through every value, so a chain of poses reads as one move
 * that slows and speeds up across its keys instead of stopping on each.
 *
 * The slope at a key is the weighted harmonic mean of the straight slopes on
 * either side, the nearer key weighing more, and 0 where they differ in sign
 * or either is 0, so the track never passes outside its two neighbouring
 * values: no overshoot, and a hold stays still. It starts and ends at rest, as
 * does each side of a cut. With two keys it is `ease.smooth`.
 *
 * `at` and `value` are as for `keys`: one unit with `x`, never falling, each
 * value exact on its key, two keys at one `at` a cut. The track holds its first
 * value before the first key and its last after the last.
 */
function flow(list) {
  if (!Array.isArray(list) || list.length === 0) throw new TypeError('flow: needs a non-empty list of [at, value]');
  const at = [];
  const value = [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (!Array.isArray(item) || item.length !== 2) throw new TypeError(`flow: entry ${i} must be [at, value]; flow sets its own spacing, so a key takes no rate`);
    const [x, v] = item;
    if (!Number.isFinite(x)) throw new TypeError(`flow: entry ${i} needs a finite time, got ${x}`);
    if (i && x < at[i - 1]) throw new RangeError(`flow: entry ${i} at ${x} comes before entry ${i - 1} at ${at[i - 1]}; list keys in time order`);
    if (!Number.isFinite(v)) throw new TypeError(`flow: entry ${i} needs a finite value, got ${v}`);
    at.push(x); value.push(v);
  }
  const last = at.length - 1;
  // The straight slope of each segment; a cut has none and ends both its sides.
  const slope = [];
  for (let i = 0; i < last; i++) slope.push(at[i + 1] > at[i] ? (value[i + 1] - value[i]) / (at[i + 1] - at[i]) : null);
  const tangent = value.map((_, i) => {
    const a = slope[i - 1];
    const b = slope[i];
    if (a == null || b == null || a * b <= 0) return 0;
    const ha = at[i] - at[i - 1];
    const hb = at[i + 1] - at[i];
    const wa = 2 * hb + ha;
    const wb = hb + 2 * ha;
    return (wa + wb) / (wa / a + wb / b);
  });
  return Object.freeze((x) => {
    if (!Number.isFinite(x)) throw new TypeError(`flow: the moment must be a finite number, got ${x}`);
    const i = lastAtOrBefore(at, x);
    if (i < 0) return value[0];
    if (i >= last) return value[last];
    // at[i] <= x < at[i + 1], so the segment is never a cut here.
    const h = at[i + 1] - at[i];
    const u = (x - at[i]) / h;
    const u2 = u * u;
    const u3 = u2 * u;
    const y = value[i] + (value[i + 1] - value[i]) * (3 * u2 - 2 * u3)
      + h * (tangent[i] * (u3 - 2 * u2 + u) + tangent[i + 1] * (u3 - u2));
    // The cubic stays between its two keys; this only removes rounding.
    return Math.min(Math.max(y, Math.min(value[i], value[i + 1])), Math.max(value[i], value[i + 1]));
  });
}

/**
 * A gait: `gait(start, lengths)(x)` counts strides. The whole part is the step
 * under way, from 0, and the fraction is how far through it the stride has got,
 * straight in time; each step begins on its contact. Before `start` it is 0 and
 * after the last step `lengths.length`: standing on a contact.
 *
 * `start` and each step's length share a unit with `x`, frames or seconds, and
 * lengths may differ, as when steps quicken. `contacts` is every contact in that
 * unit, `start` first and the end of the last step last, so the picture reads
 * the stride and the soundtrack puts a footfall on each contact from one list.
 */
function gait(start, lengths) {
  if (!Number.isFinite(start)) throw new TypeError(`gait: the start must be a finite number, got ${start}`);
  if (!Array.isArray(lengths) || lengths.length === 0) throw new TypeError('gait: needs a non-empty list of step lengths');
  const contacts = [start];
  for (let i = 0; i < lengths.length; i++) {
    const n = lengths[i];
    if (!Number.isFinite(n) || n <= 0) throw new RangeError(`gait: step ${i} must last a positive, finite time, got ${n}`);
    contacts.push(contacts[i] + n);
  }
  const steps = lengths.length;
  const stride = (x) => {
    if (!Number.isFinite(x)) throw new TypeError(`gait: the moment must be a finite number, got ${x}`);
    const i = lastAtOrBefore(contacts, x);
    if (i < 0) return 0;
    if (i >= steps) return steps;
    return i + (x - contacts[i]) / (contacts[i + 1] - contacts[i]);
  };
  stride.contacts = Object.freeze(contacts);
  return Object.freeze(stride);
}

/**
 * The drawing a frame shows when each drawing is held for `n` frames, 2 on
 * twos and 3 on threes: `{ seconds, index }`, the hold's first-frame time and
 * the drawing's count from 0. `clock` is the clock `draw` receives, or any
 * `{ frame, hz }`; a fractional frame, such as seconds times the rate, works too.
 * A still's clock, hz 0 at frame 0, shows the first drawing.
 */
function drawingAt(clock, n = 2) {
  const { frame, hz } = clock || {};
  if (!Number.isFinite(frame)) throw new TypeError(`drawingAt: needs a clock with a finite frame, got ${frame}`);
  if (!Number.isSafeInteger(n) || n < 1) throw new RangeError(`drawingAt: hold each drawing for a whole number of frames >= 1, got ${n}`);
  if (hz === 0 && frame === 0) return { seconds: 0, index: 0 };
  if (!Number.isFinite(hz) || hz <= 0) throw new RangeError(`drawingAt: needs a clock with a positive hz, or a still's (hz 0 at frame 0), got ${hz}`);
  // The nudge keeps a frame computed from seconds, 49.999999 for 50, in its hold.
  const index = Math.floor((frame + 1e-9) / n);
  return { seconds: (index * n) / hz, index };
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
    // A name finds its shot, in cue tables and strips, so two shots cannot share one.
    if (out.some((shot) => shot.name === name)) throw new RangeError(`shots: "${name}" names two shots; give each shot its own name`);
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
  Object.freeze(out);
  shotStarts.set(out, out.map((shot) => shot.start));
  return out;
}

// The starts of each list shots() returned, read once: that list and its
// shots are frozen, so they cannot change under shotAt.
const shotStarts = new WeakMap();

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
  const starts = shotStarts.get(list) || list.map((shot) => shot.start);
  return list[lastAtOrBefore(starts, frame)];
}

/**
 * A beat grid: `bars({ bpm, beats, start, swing })` places bars and beats of
 * one tempo in seconds and on frames. `bpm` is beats a minute, `beats` the
 * beats a bar (default 4), `start` the second bar 0 beat 0 sits at (default
 * 0) and `swing`, from 0 to 1, how far each off-beat is delayed: at 0 the
 * grid is straight, at 1 the off-beat sits two thirds through its beat, a
 * triplet swing. On-beats never move.
 *
 * `seconds(bar, beat)` is the second a bar and beat sit at; `beat` may be a
 * fraction (0.5 is the off-beat, 0.25 a sixteenth) and may pass the bar (bar 0
 * beat 5 at 4 beats a bar is bar 1 beat 1). `frame(bar, beat, hz)` is the
 * nearest whole frame at `hz`, rounded as `shots` rounds a cut, so a cut on a
 * bar line and a beat on it share one frame. The grid is frozen and carries
 * its four values, so `draw` and `sound` read one tempo.
 */
function bars(opts) {
  const { bpm, beats = 4, start = 0, swing = 0 } = opts || {};
  if (!Number.isFinite(bpm) || bpm <= 0) throw new RangeError(`bars: bpm must be a positive, finite number of beats a minute, got ${bpm}`);
  if (!Number.isSafeInteger(beats) || beats < 1) throw new RangeError(`bars: beats must be a whole number of beats a bar, 1 or more, got ${beats}`);
  if (!Number.isFinite(start) || start < 0) throw new RangeError(`bars: start must be a finite number of seconds, 0 or more, got ${start}`);
  if (!Number.isFinite(swing) || swing < 0 || swing > 1) throw new RangeError(`bars: swing must be from 0 to 1, got ${swing}`);
  // Where the off-beat sits in its beat: 0.5 straight, 2/3 at full swing.
  const half = 0.5 + swing / 6;
  const seconds = (bar, beat = 0) => {
    if (!Number.isFinite(bar) || !Number.isFinite(beat)) throw new TypeError(`bars: the bar and beat must be finite numbers, got ${bar}, ${beat}`);
    const n = bar * beats + beat;
    const whole = Math.floor(n);
    const f = n - whole;
    const swung = f <= 0.5 ? f * (half / 0.5) : half + (f - 0.5) * ((1 - half) / 0.5);
    return start + (whole + swung) * (60 / bpm);
  };
  const frame = (bar, beat, hz) => {
    if (!Number.isFinite(hz) || hz <= 0) throw new RangeError(`bars: hz must be a positive, finite frame rate, got ${hz}`);
    return Math.round(seconds(bar, beat) * hz);
  };
  return Object.freeze({ bpm, beats, start, swing, seconds, frame });
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

module.exports = { span, ease, tween, keys, flow, gait, drawingAt, bars, shots, shotAt, spring, follow };
