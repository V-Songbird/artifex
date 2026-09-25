'use strict';

// Authored time: spans, rates, tweens, shots on whole frames, springs and followers.
//
// Every one of these is arithmetic a piece otherwise writes by hand, and its
// failures do not show in a single picture: a zero-length window that never
// opens, a cut compared in seconds, a curve a hair short of its end.

const test = require('node:test');
const assert = require('node:assert');

const { span, ease, tween, shots, shotAt, spring, follow } = require('../core/time.js');
const { validate, clockAt } = require('../core/piece.js');
const { playheads, renderSound } = require('../core/render.js');
const { fakeAudio } = require('./fake-media.js');

// ---------------------------------------------------------------------------
// span and tween
// ---------------------------------------------------------------------------

test('span places a moment in its window, held at both ends', () => {
  assert.equal(span(2, 4, 3), 0.5);
  assert.equal(span(2, 4, 1), 0, 'before the window');
  assert.equal(span(2, 4, 9), 1, 'after it');
  assert.equal(span(0.1, 0.3, 0.1), 0, 'the ends are exact');
  assert.equal(span(0.1, 0.3, 0.3), 1);
  // Frames are a unit like any other: the last frame of a 144-frame reading.
  assert.equal(span(0, 143, 143), 1);
  assert.equal(span(0, 143, 71), 71 / 143);
});

test('a zero-length span is a CUT: nothing before it, everything from it on', () => {
  // unlerp answers 0 for equal ends, which for time is a change that never
  // happens: a move with no duration would never arrive.
  assert.equal(span(2, 2, 1.999), 0);
  assert.equal(span(2, 2, 2), 1, 'the instant itself is after the cut');
  assert.equal(span(2, 2, 7), 1);
});

test('span and tween refuse a window that runs backwards and a moment that is not a number', () => {
  assert.throws(() => span(4, 2, 3), /span: a window needs finite ends with start <= end, got \[4, 2\]/);
  assert.throws(() => span(0, Infinity, 1), /span: a window needs finite ends/);
  assert.throws(() => span(Number.NaN, 1, 0.5), /span: a window needs finite ends/);
  assert.throws(() => span(0, 1, Number.NaN), /span: the moment must be a finite number, got NaN/);
  assert.throws(() => tween(3, 1, ease.out), /tween: a window needs finite ends/);
  assert.throws(() => tween(0, 1, 'out'), /tween: the rate must be a function/);
});

test('tween fuses a window and a rate into one value', () => {
  const move = tween(1, 3, ease.inOut);
  assert.equal(move(0), 0);
  assert.equal(move(1), 0);
  assert.equal(move(2), 0.5);
  assert.equal(move(3), 1);
  assert.equal(move(40), 1);
  assert.equal(tween(1, 3, ease.out)(2), ease.out(0.5), 'the window is applied before the rate');
  const cut = tween(5, 5, ease.out);
  assert.deepEqual([cut(4.9), cut(5), cut(6)], [0, 1, 1], 'and an instant is still a cut');
  const blink = tween(2, 2.5, ease.bump);
  assert.deepEqual([blink(1), blink(2.25), blink(3)], [0, 1, 0], 'an event happens inside its window and nowhere else');
});

// ---------------------------------------------------------------------------
// rates
// ---------------------------------------------------------------------------

test('every rate starts at 0 and arrives at 1, exactly, and holds outside its window', () => {
  // Exactly, not nearly: a move that lands at 0.9999999999999998 leaves a mark
  // a hair short of where it was meant to be, on every frame after it arrives.
  const arrivals = Object.keys(ease).filter((name) => name !== 'bump');
  assert.deepEqual(arrivals, ['linear', 'in', 'out', 'inOut', 'smooth', 'back']);
  for (const name of arrivals) {
    const f = ease[name];
    assert.equal(f(0), 0, `${name}(0)`);
    assert.equal(f(1), 1, `${name}(1)`);
    assert.equal(f(-3), 0, `${name} before its window`);
    assert.equal(f(4), 1, `${name} after its window`);
  }
  assert.deepEqual([ease.bump(-1), ease.bump(0), ease.bump(1), ease.bump(2)], [0, 0, 0, 0],
    'bump comes back to where it started');
});

test('the rate curves keep their named shapes', () => {
  const near = (a, b, why) => assert.ok(Math.abs(a - b) < 1e-12, `${why}: ${a} is not ${b}`);
  near(ease.linear(0.3), 0.3, 'linear');
  near(ease.in(0.5), 0.125, 'in is cubic');
  near(ease.out(0.5), 0.875, 'out is cubic');
  near(ease.inOut(0.25), 0.0625, 'inOut accelerates');
  near(ease.inOut(0.5), 0.5, 'inOut is half way at half time');
  near(ease.inOut(0.75), 0.9375, 'inOut decelerates');
  near(ease.smooth(0.25), 0.15625, 'smooth is the Hermite smoothstep');
  near(ease.bump(0.5), 1, 'bump peaks in the middle');
  near(ease.bump(0.25), 0.5, 'bump is smooth on the way out');

  const samples = Array.from({ length: 1001 }, (_, i) => i / 1000);
  for (const name of ['linear', 'in', 'out', 'inOut', 'smooth']) {
    for (let i = 1; i < samples.length; i++) {
      assert.ok(ease[name](samples[i]) >= ease[name](samples[i - 1]), `${name} goes backwards at ${samples[i]}`);
    }
  }
  for (const u of samples) {
    near(ease.out(u), 1 - ease.in(1 - u), `out mirrors in at ${u}`);
    near(ease.inOut(u) + ease.inOut(1 - u), 1, `inOut is symmetric at ${u}`);
    near(ease.smooth(u) + ease.smooth(1 - u), 1, `smooth is symmetric at ${u}`);
    near(ease.bump(u), ease.bump(1 - u), `bump is symmetric at ${u}`);
  }
  // Rest at the ends: the first and last steps of an eased move are tiny.
  assert.ok(ease.in(0.01) < 1e-5 && 1 - ease.out(0.99) < 1e-5, 'in leaves from rest and out arrives at rest');
  assert.ok(ease.inOut(0.01) < 1e-5 && 1 - ease.inOut(0.99) < 1e-5, 'inOut rests at both ends');

  // Back passes its mark by about 10% and settles back onto it.
  const peak = Math.max(...samples.map(ease.back));
  assert.ok(peak > 1.09 && peak < 1.11, `back overshoots to ${peak}`);
  assert.ok(ease.back(0.95) > 1, 'and is still past the mark just before it lands');
});

test('the rate table is frozen, so one piece cannot bend another piece\'s curves', () => {
  // Every piece in a page bundle shares this object. A piece that reassigned
  // ease.out would change the motion of every other piece drawn after it.
  assert.ok(Object.isFrozen(ease));
  assert.throws(() => { ease.out = (u) => u; }, TypeError);
  assert.equal(ease.out(0.5), 0.875);
});

// ---------------------------------------------------------------------------
// shots
// ---------------------------------------------------------------------------

test('shots put every cut on the nearest whole frame of the timeline', () => {
  const film = shots([['wide', 2.8], ['close', 4.2]], { hz: 24, frames: 168 });
  assert.deepEqual(film.map((s) => [s.name, s.index, s.start, s.end]), [['wide', 0, 0, 67], ['close', 1, 67, 168]],
    '2.8 s at 24 Hz is frame 67.2, and the cut lands on 67');
  // Nearest, not earlier: 1.99 s at 24 Hz is frame 47.76.
  assert.equal(shots([['a', 1.99], ['b', 3.01]], { hz: 24, frames: 120 })[1].start, 48);
  // Each boundary is rounded from the elapsed time, so lengths that are not
  // whole frames do not accumulate their rounding across a long list.
  const thirds = shots(Array.from({ length: 9 }, (_, i) => [`s${i}`, 1 / 3]), { hz: 25, frames: 75 });
  assert.deepEqual(thirds.map((s) => s.start), [0, 8, 17, 25, 33, 42, 50, 58, 67]);
  assert.ok(Object.isFrozen(film) && Object.isFrozen(film[0]), 'the resolved list cannot be edited by a piece');
});

test('THE FRAME AT A CUT BELONGS TO THE INCOMING SHOT, found by comparing integers', () => {
  const film = shots([['wide', 2.8], ['close', 4.2]], { hz: 24, frames: 168 });
  assert.equal(shotAt(film, 0).name, 'wide');
  assert.equal(shotAt(film, 66).name, 'wide');
  assert.equal(shotAt(film, 67).name, 'close', 'the cut frame shows the new shot');
  assert.equal(shotAt(film, 167).name, 'close');
  assert.equal(shotAt(film, 67), film[1], 'and it is the resolved shot itself');

  // The trap the integers avoid: 0.1 + 0.2 is 0.30000000000000004, so frame 9
  // of a 30 Hz film, at 9/30 = 0.3 s, sits before a cut summed in seconds and
  // on the wrong side of it. On whole frames the cut is exactly frame 9.
  const tight = shots([['a', 0.1], ['b', 0.2], ['c', 0.7]], { hz: 30, frames: 30 });
  assert.ok(9 / 30 < 0.1 + 0.2, 'a comparison in seconds would keep frame 9 in b');
  assert.equal(shotAt(tight, 9).name, 'c');
  assert.equal(shotAt(tight, 8).name, 'b');

  // Every frame is in exactly one shot, and scanning either way agrees.
  const forward = Array.from({ length: 168 }, (_, f) => shotAt(film, f).index);
  const backward = Array.from({ length: 168 }, (_, f) => shotAt(film, 167 - f).index).reverse();
  assert.deepEqual(backward, forward);
  assert.equal(forward.filter((i) => i === 0).length, 67);

  for (const bad of [-1, 168, 2.5, Number.NaN]) {
    assert.throws(() => shotAt(film, bad), /shotAt: .* is not a whole frame of this shot list/, String(bad));
  }
  assert.throws(() => shotAt([], 0), /shotAt: needs the list shots\(\) returned/);
  assert.throws(() => shotAt([['wide', 2.8], ['close', 4.2]], 70), /shotAt: needs the list shots\(\) returned/,
    'the unresolved list is refused rather than answering its first shot');
});

test('shots must fill their timeline, every shot must hold a frame, and a still has none', () => {
  assert.throws(() => shots([['read', 6]], { hz: 24, frames: 168 }),
    /shots: the list lasts 144 frames \(6 s at 24 Hz\) and the timeline holds 168/);
  assert.throws(() => shots([['read', 8]], { hz: 24, frames: 168 }), /lasts 192 frames/, 'too long is refused too');
  assert.throws(() => shots([['flash', 0.01], ['rest', 6.99]], { hz: 24, frames: 168 }),
    /shots: "flash" \(0\.01 s\) holds no whole frame at 24 Hz/);
  assert.throws(() => shots([['a', 1]], { hz: 0, frames: 1 }), /a still has no shots/);
  assert.throws(() => shots([['a', 1]], clockAt(validate({ name: 'still', size: { w: 1, h: 1 }, draw() {} }), 0)),
    /a still has no shots/, 'the clock a still is drawn with');
  assert.throws(() => shots([], { hz: 24, frames: 24 }), /non-empty list of \[name, seconds\]/);
  assert.throws(() => shots([['a']], { hz: 24, frames: 24 }), /entry 0 must be \[name, seconds\]/);
  assert.throws(() => shots([[1, 1]], { hz: 24, frames: 24 }), /entry 0 must be \[name, seconds\]/);
  assert.throws(() => shots([['a', -1]], { hz: 24, frames: 24 }), /"a" must last a positive, finite number of seconds/);
});

// ---------------------------------------------------------------------------
// spring and follow
// ---------------------------------------------------------------------------

// An independent reference: y'' = k (anchor - y) - 2 z sqrt(k) y', from rest at
// `from`, integrated by fourth-order Runge-Kutta at `h`.
function integrate(stiffness, damping, anchor, T, h = 1e-4, from = anchor(0)) {
  const c = 2 * damping * Math.sqrt(stiffness);
  const acc = (t, y, v) => stiffness * (anchor(t) - y) - c * v;
  let y = from;
  let v = 0;
  const n = Math.round(T / h);
  for (let i = 0; i < n; i++) {
    const t = i * h;
    const k1y = v; const k1v = acc(t, y, v);
    const k2y = v + h / 2 * k1v; const k2v = acc(t + h / 2, y + h / 2 * k1y, k2y);
    const k3y = v + h / 2 * k2v; const k3v = acc(t + h / 2, y + h / 2 * k2y, k3y);
    const k4y = v + h * k3v; const k4v = acc(t + h, y + h * k3y, k4y);
    y += h / 6 * (k1y + 2 * k2y + 2 * k3y + k4y);
    v += h / 6 * (k1v + 2 * k2v + 2 * k3v + k4v);
  }
  return y;
}

test('a spring is 0 before its cue and through its delay, then leaves from rest', () => {
  const late = spring({ stiffness: 100, damping: 0.5, delay: 0.25 });
  const now = spring({ stiffness: 100, damping: 0.5 });
  assert.deepEqual([late(-1), late(0), late(0.1), late(0.25), now(-0.5), now(0)], [0, 0, 0, 0, 0, 0]);
  // From rest: the first ten microseconds travel about k u² / 2.
  const first = late(0.25 + 1e-5);
  assert.ok(first > 0 && first < 1e-7, `leaves from rest, got ${first}`);
  for (const u of [0.01, 0.2, 0.7, 2]) {
    assert.ok(Math.abs(late(0.25 + u) - now(u)) < 1e-12, `the delay only shifts it, at ${u}`);
  }
});

test('damping picks the spring\'s shape: under-damped rings past its mark, critical and over-damped never pass it', () => {
  // Stiffness 100 is a natural frequency of 10 rad/s.
  for (const damping of [0.3, 0.9, 1, 2.5]) {
    const s = spring({ stiffness: 100, damping });
    for (const u of [0.05, 0.2, 0.45, 1, 1.7]) {
      const want = integrate(100, damping, () => 1, u, u / Math.round(u / 1e-4), 0);
      assert.ok(Math.abs(s(u) - want) < 1e-9, `damping ${damping} at ${u}: ${s(u)} is not ${want}`);
    }
  }
  // The textbook overshoot, 1 + exp(-z pi / sqrt(1 - z²)), at the first peak.
  const ring = spring({ stiffness: 100, damping: 0.3 });
  const first = Math.PI / (10 * Math.sqrt(1 - 0.09));
  assert.ok(Math.abs(ring(first) - (1 + Math.exp(-0.3 * Math.PI / Math.sqrt(0.91)))) < 1e-12, 'first peak');
  const samples = Array.from({ length: 3001 }, (_, i) => i / 1000);
  for (const damping of [1, 2.5]) {
    const s = spring({ stiffness: 100, damping });
    for (let i = 1; i < samples.length; i++) {
      assert.ok(s(samples[i]) >= s(samples[i - 1]) && s(samples[i]) <= 1, `damping ${damping} passes or backs off at ${samples[i]}`);
    }
  }
  // Critical is the quickest arrival that does not pass the mark.
  const settle = (damping) => spring({ stiffness: 100, damping }).settle;
  assert.ok(settle(1) < settle(2.5) && settle(1) < settle(0.3), 'critical settles first');
  assert.ok(Math.abs(settle(1 - 1e-7) - settle(1)) < 1e-5 && Math.abs(settle(1 + 1e-7) - settle(1)) < 1e-5,
    'and the regimes meet at critical');
});

test('settle is the time from which a spring stays within 0.1% of its mark', () => {
  for (const damping of [0.15, 0.6, 1, 3]) {
    const s = spring({ stiffness: 60, damping, delay: 0.5 });
    assert.ok(Math.abs(1 - s(s.settle - 1e-6)) > 1e-3, `damping ${damping}: still outside just before ${s.settle}`);
    for (let u = s.settle; u < s.settle + 6; u += 1e-3) {
      assert.ok(Math.abs(1 - s(u)) <= 1e-3 + 1e-12, `damping ${damping}: back outside at ${u}`);
    }
    assert.ok(Math.abs(s.settle - 0.5 - spring({ stiffness: 60, damping }).settle) < 1e-12, 'counted from the cue');
  }
  // Stiffer is quicker: four times the stiffness halves the time.
  const soft = spring({ stiffness: 25, damping: 0.4 }).settle;
  assert.ok(Math.abs(spring({ stiffness: 100, damping: 0.4 }).settle - soft / 2) < 1e-9);
});

test('a spring holds exactly 1 long after its cue, however large the time', () => {
  for (const damping of [0.3, 1, 2]) {
    const s = spring({ stiffness: 50, damping });
    assert.deepEqual([s(1e3), s(1e9), s(1e300), s(Number.MAX_VALUE)], [1, 1, 1, 1], `damping ${damping}`);
  }
});

test('spring and follow refuse invalid inputs by name', () => {
  assert.throws(() => spring(), /spring: stiffness must be a positive, finite number, got undefined/);
  for (const stiffness of [0, -1, Infinity, Number.NaN, '100']) {
    assert.throws(() => spring({ stiffness, damping: 1 }), /spring: stiffness must be a positive, finite number/, String(stiffness));
  }
  for (const damping of [0, -0.5, Infinity, Number.NaN]) {
    assert.throws(() => spring({ stiffness: 1, damping }), /spring: damping must be a positive, finite ratio, got .*; 1 is critical/, String(damping));
  }
  for (const delay of [-0.1, Infinity, Number.NaN]) {
    assert.throws(() => spring({ stiffness: 1, damping: 1, delay }), /spring: delay must be a finite number of seconds >= 0/, String(delay));
  }
  const s = spring({ stiffness: 1, damping: 1 });
  for (const u of [Number.NaN, Infinity, -Infinity]) {
    assert.throws(() => s(u), /spring: the time since the cue must be a finite number/, String(u));
  }
  assert.throws(() => { s.settle = 0; }, TypeError, 'settle is read-only');
  assert.throws(() => follow('body', { stiffness: 1, damping: 1 }), /follow: the driver must be a function of seconds since the cue/);
  assert.throws(() => follow(s, { stiffness: 1, damping: 0 }), /follow: damping must be a positive, finite ratio/);
  assert.throws(() => follow(s, { stiffness: 1, damping: 1 })(Number.NaN), /follow: the time since the cue must be a finite number/);
});

test('follow trails a moving driver, passes it when the driver stops, and settles on it', () => {
  const body = tween(0, 1, ease.inOut);
  const tail = follow(body, { stiffness: 150, damping: 0.4 });
  assert.deepEqual([tail(-0.5), tail(0)], [0, 0], 'on its driver before the cue');
  // It catches up as the driver slows, so it trails up to the middle of the move.
  for (let u = 0.05; u < 0.6; u += 0.05) assert.ok(tail(u) < body(u), `trails while it moves, at ${u}`);
  const after = Array.from({ length: 1001 }, (_, i) => tail(1 + i / 1000));
  assert.ok(Math.max(...after) > 1.01, 'passes the driver once it stops');
  for (let u = 3; u < 5; u += 0.01) assert.ok(Math.abs(tail(u) - 1) < 1e-3, `settles on it, at ${u}`);

  // A driver at rest keeps its part on it exactly.
  assert.equal(follow(() => 0.3, { stiffness: 150, damping: 0.4 })(5), 0.3);
  // At a steady speed the part trails by 2 damping / sqrt(stiffness) seconds of travel.
  const ramp = follow((u) => 2 * Math.max(u, 0), { stiffness: 400, damping: 0.5 });
  assert.ok(Math.abs(6 - ramp(3) - 2 * (2 * 0.5 / 20)) < 1e-9, `steady lag ${6 - ramp(3)}`);
  // A delay reads the driver late, so the part arrives later still.
  const late = follow(body, { stiffness: 150, damping: 0.4, delay: 0.2 });
  assert.equal(late(0.2), 0);
  assert.ok(late(0.6) < tail(0.6), 'the delayed part is further behind');
  // Parts compose: a tail can follow a spring.
  const whip = follow(spring({ stiffness: 200, damping: 0.8 }), { stiffness: 80, damping: 0.3 });
  assert.ok(Math.abs(whip(8) - 1) < 1e-3, 'and settles where the spring does');
});

test('follow matches an independent integration of the same spring at any time asked', () => {
  const body = tween(0.1, 0.8, ease.inOut);
  for (const [stiffness, damping] of [[150, 0.4], [60, 1], [300, 2]]) {
    const tail = follow(body, { stiffness, damping });
    for (const u of [0.3337, 0.5, 0.9001, 1.61]) {
      const want = integrate(stiffness, damping, body, u, u / Math.round(u / 1e-4));
      assert.ok(Math.abs(tail(u) - want) < 1e-4, `${stiffness}/${damping} at ${u}: ${tail(u)} is not ${want}`);
    }
  }
});

test('a draw clock and a sound timeline resolve the same shots over every frame', async () => {
  const LIST = [['open', 1.25], ['hold', 0.5], ['close', 2.25]];
  for (const loop of [false, true]) {
    let heard = null;
    const p = validate({
      name: 'score', size: { w: 10, h: 10 }, time: { duration: 4, hz: 24, loop },
      draw() {}, sound(ctx, s, timeline) { heard = shots(LIST, timeline); },
    });
    const audio = fakeAudio();
    await renderSound(p, { state: {} }, { OfflineAudioContext: audio.Context });
    const seen = playheads(p).map((t) => {
      const clock = clockAt(p, t);
      return [clock.frame, shotAt(shots(LIST, clock), clock.frame).name];
    });
    assert.deepEqual(heard, shots(LIST, clockAt(p, 0)), `loop ${loop}: sound resolves the cuts draw resolves`);
    assert.deepEqual(seen.map(([f]) => f), seen.map((_, i) => i), 'every drawn frame is visited once');
    assert.deepEqual(['open', 'hold', 'close'].map((n) => seen.filter(([, s]) => s === n).length), [30, 12, 54]);
  }
});
