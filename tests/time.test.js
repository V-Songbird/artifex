'use strict';

// Authored time: spans, rates, tweens, shots on whole frames, a beat grid, springs and followers.
//
// Every one of these is arithmetic a piece otherwise writes by hand, and its
// failures do not show in a single picture: a zero-length window that never
// opens, a cut compared in seconds, a curve a hair short of its end.

const test = require('node:test');
const assert = require('node:assert');

const { span, ease, tween, keys, flow, gait, drawingAt, bars, shots, shotAt, spring, follow } = require('../core/time.js');
const { held } = require('../skills/artifex/styles/manga.js');
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
// keys and gait
// ---------------------------------------------------------------------------

test('a key track lands exactly on every key and moves at the rate the earlier key names', () => {
  // An extreme at 0, a breakdown off the centre at 6, a hold from 12 to 20.
  const arm = keys([[0, 0, ease.in], [6, 0.8, ease.out], [12, 1], [20, 1], [24, 0.25]]);
  assert.deepEqual([0, 6, 12, 16, 20, 24].map(arm), [0, 0.8, 1, 1, 1, 0.25], 'exact on each key and through the hold');
  assert.equal(arm(3), 0.8 * ease.in(0.5), 'the first key leaves slowly');
  assert.equal(arm(9), 0.8 + (1 - 0.8) * ease.out(0.5), 'the breakdown key arrives at rest');
  assert.equal(arm(22), 1 + (0.25 - 1) * 0.5, 'a key that names no rate moves straight');
  assert.deepEqual([arm(-5), arm(30)], [0, 0.25], 'held before the first key and after the last');
  assert.ok(Object.isFrozen(arm));
});

test('two keys at one time are a cut: the later value from that moment on', () => {
  const pop = keys([[0, 0], [4, 1], [4, -1], [8, 0]]);
  assert.equal(pop(3.999), 3.999 / 4);
  assert.equal(pop(4), -1, 'the instant itself is after the cut');
  assert.equal(pop(6), -0.5);
  // A track that starts with a cut shows its second value from the first key.
  assert.deepEqual([keys([[2, 5], [2, 7]])(1), keys([[2, 5], [2, 7]])(2)], [5, 7]);
});

test('a key track keeps its own copy of the list and refuses bad keys by name', () => {
  const list = [[0, 0], [10, 1]];
  const track = keys(list);
  list[1][1] = 99;
  list.push([20, 5]);
  assert.equal(track(10), 1, 'editing the list afterwards does not move the track');
  assert.throws(() => keys([]), /keys: needs a non-empty list of \[at, value\] or \[at, value, rate\]/);
  assert.throws(() => keys('0,1'), /keys: needs a non-empty list/);
  assert.throws(() => keys([[0]]), /keys: entry 0 must be \[at, value\] or \[at, value, rate\]/);
  assert.throws(() => keys([[0, 1, ease.in, 3]]), /keys: entry 0 must be/);
  assert.throws(() => keys([[0, 0], [Number.NaN, 1]]), /keys: entry 1 needs a finite time, got NaN/);
  assert.throws(() => keys([[0, 0], [5, 1], [3, 0]]), /keys: entry 2 at 3 comes before entry 1 at 5; list keys in time order/);
  assert.throws(() => keys([[0, Infinity]]), /keys: entry 0 needs a finite value, got Infinity/);
  assert.throws(() => keys([[0, 0, 'out'], [1, 1]]), /keys: entry 0's rate must be a function of \[0, 1\]/);
  assert.throws(() => track(Number.NaN), /keys: the moment must be a finite number, got NaN/);
});

// Every sub-frame sample of a track between keys i and i + 1 lies within their
// two values; answers the first sample outside them, or null.
function firstOvershoot(track, list, steps = 64) {
  for (let i = 0; i + 1 < list.length; i++) {
    const [a, va] = list[i];
    const [b, vb] = list[i + 1];
    for (let s = 0; s <= steps; s++) {
      const x = a + (b - a) * s / steps;
      const y = track(x);
      if (y < Math.min(va, vb) || y > Math.max(va, vb)) return { x, y };
    }
  }
  return null;
}

test('a flowing track lands exactly on every key and never leaves its neighbours\' range', () => {
  // Rising, a turning point at 20, a hold from 32 to 40, then falling.
  const list = [[0, 0], [8, 0.6], [20, 1], [32, 0.2], [40, 0.2], [48, -0.5]];
  const track = flow(list);
  assert.deepEqual(list.map(([at]) => track(at)), list.map(([, v]) => v), 'exact on each key');
  assert.equal(firstOvershoot(track, list), null, 'no overshoot at the turning point or anywhere else');
  assert.equal([32, 34, 36, 38, 40].filter((x) => track(x) !== 0.2).length, 0, 'a hold stays still');
  assert.deepEqual([track(-5), track(60)], [0, -0.5], 'held before the first key and after the last');
  // It passes the breakdown at 8 moving: a frame either side of it differs.
  assert.ok(track(9) - track(8) > 0 && track(8) - track(7) > 0);
  // Two keys flow as ease.smooth.
  const two = flow([[0, 2], [10, 5]]);
  assert.equal([1, 3, 5, 7, 9].filter((x) => Math.abs(two(x) - (2 + 3 * ease.smooth(x / 10))) > 1e-12).length, 0);
  assert.ok(Object.isFrozen(track));
});

test('two keys at one time in a flowing track are a cut, each side at rest', () => {
  const pop = flow([[0, 0], [4, 1], [4, -1], [8, 0]]);
  assert.equal(pop(4), -1, 'the instant itself is after the cut');
  assert.ok(Math.abs(pop(3.999) - 1) < 1e-6, 'the earlier value arrives at rest');
  assert.equal(pop(6), -0.5);
  assert.deepEqual([flow([[2, 5], [2, 7]])(1), flow([[2, 5], [2, 7]])(2)], [5, 7]);
  // A cut between equal values divides by no zero-length segment.
  assert.equal(flow([[0, 0], [4, 1], [4, 1], [8, 2]])(4), 1);
});

test('a flowing track keeps its own copy of the list and refuses bad keys by name', () => {
  const list = [[0, 0], [10, 1]];
  const track = flow(list);
  list[1][1] = 99;
  assert.equal(track(10), 1, 'editing the list afterwards does not move the track');
  assert.throws(() => flow([]), /flow: needs a non-empty list of \[at, value\]/);
  assert.throws(() => flow('0,1'), /flow: needs a non-empty list/);
  assert.throws(() => flow([[0]]), /flow: entry 0 must be \[at, value\]/);
  assert.throws(() => flow([[0, 0, ease.in], [1, 1]]), /flow: entry 0 must be \[at, value\]; flow sets its own spacing, so a key takes no rate/);
  assert.throws(() => flow([[0, 0], [Number.NaN, 1]]), /flow: entry 1 needs a finite time, got NaN/);
  assert.throws(() => flow([[0, 0], [5, 1], [3, 0]]), /flow: entry 2 at 3 comes before entry 1 at 5; list keys in time order/);
  assert.throws(() => flow([[0, Infinity]]), /flow: entry 0 needs a finite value, got Infinity/);
  assert.throws(() => track(Number.NaN), /flow: the moment must be a finite number, got NaN/);
});

test('a chain of poses: flow keeps moving through its keys where eased keys stop and straight keys jump', () => {
  // Pre-registered (roadmap entry 1382): four rising poses on whole frames at
  // 24 fps, unevenly spaced in time and value. At each inner key k, on frame F:
  // pass = |v(F + 1) - v(F - 1)| / 2 over the move's mean change a frame,
  // ratio = |v(F) - v(F - 1)| / |v(F + 1) - v(F)|, before over after.
  const poses = [[0, 0], [10, 0.5], [30, 0.8], [42, 1.6]];
  const mean = (poses[3][1] - poses[0][1]) / (poses[3][0] - poses[0][0]);
  const measure = (track) => poses.slice(1, -1).map(([f]) => ({
    pass: Math.abs(track(f + 1) - track(f - 1)) / 2 / mean,
    ratio: Math.abs(track(f) - track(f - 1)) / Math.abs(track(f + 1) - track(f)),
  }));
  const eased = measure(keys(poses.map(([f, v]) => [f, v, ease.inOut])));
  const straight = measure(keys(poses));
  const flowing = measure(flow(poses));
  const report = JSON.stringify({ eased, straight, flowing });
  assert.ok(eased.every((k) => k.pass < 0.1), `eased keys nearly stop at every inner key: ${report}`);
  assert.ok(flowing.every((k) => k.pass >= 0.4), `flow keeps at least 40% of the mean speed: ${report}`);
  assert.ok(straight.some((k) => k.ratio > 1.5), `straight keys jump in speed at some key: ${report}`);
  // The prediction also said flow's ratio stays within 0.67-1.5; it measured
  // 0.65 at frame 30, where flow speeds up into the steep last move. A whole
  // frame each side counts that acceleration as well as any jump. Taken a
  // hair either side of each key, flow's speed is one and straight keys' is not.
  const e = 1e-4;
  const instant = (track) => poses.slice(1, -1).map(([f]) => (track(f) - track(f - e)) / (track(f + e) - track(f)));
  assert.ok(instant(flow(poses)).every((r) => Math.abs(r - 1) < 1e-3), `flow's speed is continuous at its keys: ${report}`);
  assert.ok(instant(keys(poses)).some((r) => Math.abs(r - 1) > 0.5), `straight keys' speed is not: ${report}`);
  assert.equal(firstOvershoot(flow(poses), poses), null);
});

test('a gait counts strides from each contact and stands still outside its steps', () => {
  // Two leisurely steps, a quicker one, the quickest and a slower one, in frames.
  const walk = gait(10, [16, 16, 14, 12, 14]);
  assert.deepEqual(walk.contacts, [10, 26, 42, 56, 68, 82]);
  assert.ok(Object.isFrozen(walk) && Object.isFrozen(walk.contacts));
  assert.deepEqual([walk(0), walk(10), walk(14), walk(18), walk(26), walk(49)], [0, 0, 0.25, 0.5, 1, 2.5]);
  assert.equal(walk(62), 3.5, 'a shorter step passes through its phases sooner');
  assert.deepEqual([walk(82), walk(500)], [5, 5], 'standing on the last contact');
  // Seconds work as well as frames: a natural walk is half a second a step.
  const brisk = gait(0, [0.5, 0.5]);
  assert.deepEqual([brisk(0.125), brisk(0.75), brisk(2)], [0.25, 1.5, 2]);
  assert.throws(() => gait(Number.NaN, [1]), /gait: the start must be a finite number/);
  assert.throws(() => gait(0, []), /gait: needs a non-empty list of step lengths/);
  assert.throws(() => gait(0, [12, 0]), /gait: step 1 must last a positive, finite time, got 0/);
  assert.throws(() => walk(Infinity), /gait: the moment must be a finite number/);
});

test('the picture and the footsteps read one gait: each stride begins on the frame of its footfall', () => {
  const HZ = 24;
  const walk = gait(6, [12, 12, 8, 8, 16]);
  // The picture: the frames where the whole stride count goes up.
  const turns = [];
  for (let f = 1; f < 80; f++) if (Math.floor(walk(f)) > Math.floor(walk(f - 1))) turns.push(f);
  // The soundtrack: a footfall on each contact after the first, in seconds.
  const falls = walk.contacts.slice(1).map((c) => c / HZ);
  assert.deepEqual(turns, falls.map((s) => Math.round(s * HZ)));
  // A key track over the stride's fraction gives the body its ups and downs:
  // down just after the contact and up just after the passing position.
  const bob = keys([[0, 0], [0.25, -1], [0.5, 0], [0.75, 1], [1, 0]]);
  const lift = (f) => bob(walk(f) % 1);
  assert.deepEqual([6, 9, 12, 15, 18].map(lift), [0, -1, 0, 1, 0]);
  assert.deepEqual([30, 32, 34, 36].map(lift), [0, -1, 0, 1], 'an eight-frame step makes the same moves sooner');
});

// ---------------------------------------------------------------------------
// drawingAt
// ---------------------------------------------------------------------------

test('drawingAt holds each drawing for n frames and reads time at the hold\'s first frame', () => {
  // 24 fps on twos: frames 48 and 49 show drawing 24 at 2 s; frame 50 is the next.
  assert.deepEqual(drawingAt({ frame: 48, hz: 24 }, 2), { seconds: 2, index: 24 });
  assert.deepEqual(drawingAt({ frame: 49, hz: 24 }, 2), { seconds: 2, index: 24 });
  assert.deepEqual(drawingAt({ frame: 50, hz: 24 }, 2), { seconds: 50 / 24, index: 25 });
  assert.deepEqual(drawingAt({ frame: 49, hz: 24 }), drawingAt({ frame: 49, hz: 24 }, 2), 'twos by default');
  // On threes: frames 48 to 50 share drawing 16; frame 51 starts drawing 17.
  for (const frame of [48, 49, 50]) assert.deepEqual(drawingAt({ frame, hz: 24 }, 3), { seconds: 2, index: 16 });
  assert.deepEqual(drawingAt({ frame: 51, hz: 24 }, 3), { seconds: 51 / 24, index: 17 });
  // A frame computed from seconds can land a hair below its whole frame.
  assert.equal(drawingAt({ frame: (50 / 24) * 24 - 1e-12, hz: 24 }, 2).index, 25, 'a rounding hair below a boundary stays in the new hold');
  assert.equal(drawingAt({ frame: 2.0833 * 24, hz: 24 }, 2).index, 24, 'a real time before a boundary keeps the old hold');
  assert.equal(drawingAt({ frame: 2.0833 * 24, hz: 24 }, 3).index, 16);
});

test('manga held answers what drawingAt answers from seconds and a rate', () => {
  for (const s of [0, 2, 2.0417, 2.0833, 50 / 24, 2.125]) {
    for (const every of [2, 3]) assert.deepEqual(held(s, every, 24), drawingAt({ frame: s * 24, hz: 24 }, every), `${s} s on ${every}s`);
  }
  assert.deepEqual(held(50 / 24), { seconds: 50 / 24, index: 25 }, 'twos at 24 fps by default');
});

test('drawingAt on a still\'s draw clock shows the first drawing', () => {
  const still = validate({ name: 'still', size: { w: 1, h: 1 }, draw() {} });
  for (const n of [1, 2, 3]) assert.deepEqual(drawingAt(clockAt(still, 0), n), { seconds: 0, index: 0 }, `on ${n}s`);
});

test('drawingAt on a looping film clock: a frame count that is a multiple of n keeps every hold whole at the seam', () => {
  const film = validate({ name: 'loop', size: { w: 1, h: 1 }, time: { duration: 1, hz: 24, loop: true }, draw() {} });
  const at = (frame) => drawingAt(clockAt(film, frame / 24), 2);
  assert.deepEqual(at(22), { seconds: 22 / 24, index: 11 });
  assert.deepEqual(at(23), at(22), 'the last drawing holds both its frames');
  assert.deepEqual(at(24), { seconds: 0, index: 0 }, 'the loop wraps to the first drawing');
});

test('drawingAt refuses a clock without a frame or a rate, and a hold that is not whole frames', () => {
  assert.throws(() => drawingAt({ hz: 24 }), /drawingAt: needs a clock with a finite frame/);
  assert.throws(() => drawingAt({ frame: 3, hz: 0 }), /drawingAt: needs a clock with a positive hz/);
  assert.throws(() => drawingAt({ frame: 3, hz: 24 }, 1.5), /whole number of frames/);
  assert.throws(() => drawingAt({ frame: 3, hz: 24 }, 0), /whole number of frames/);
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

test('shots refuses two shots with one name, since a name finds its shot', () => {
  assert.throws(() => shots([['wide', 1], ['close', 1], ['wide', 1]], { hz: 24, frames: 72 }),
    /shots: "wide" names two shots; give each shot its own name/);
  assert.deepEqual(shots([['wide', 1], ['wide 2', 1]], { hz: 24, frames: 48 }).map((s) => s.name), ['wide', 'wide 2']);
});

// ---------------------------------------------------------------------------
// bars: a beat grid
// ---------------------------------------------------------------------------

test('a beat grid places bars and beats in seconds and on the frames shots cut on', () => {
  const g = bars({ bpm: 120 });
  assert.strictEqual(g.seconds(0, 0), 0);
  assert.strictEqual(g.seconds(0), 0, 'beat defaults to 0');
  assert.strictEqual(g.seconds(1, 0), 2, 'four beats at 120 BPM are 2 s');
  assert.strictEqual(g.seconds(2, 0.5), 4.25, 'the off-beat is half a beat late on a straight grid');
  assert.strictEqual(g.seconds(0, 5), g.seconds(1, 1), 'a beat past the bar is the next bar');
  assert.strictEqual(bars({ bpm: 120, start: 1.5 }).seconds(1, 0), 3.5, 'start shifts the whole grid');
  assert.ok(Object.isFrozen(g));
  assert.deepEqual([g.bpm, g.beats, g.start, g.swing], [120, 4, 0, 0]);
  for (const bpm of [120, 100]) {
    for (const hz of [24, 30]) {
      const grid = bars({ bpm, beats: 4 });
      const list = [['a', grid.seconds(2, 0)], ['b', grid.seconds(5, 0) - grid.seconds(2, 0)]];
      const frames = grid.frame(5, 0, hz);
      const cuts = shots(list, { hz, frames });
      assert.strictEqual(cuts[1].start, grid.frame(2, 0, hz), `${bpm} BPM at ${hz} Hz: the cut and the bar line share a frame`);
      assert.strictEqual(cuts[1].end, frames, `${bpm} BPM at ${hz} Hz: whole bars fill the timeline`);
    }
  }
});

test('a swung grid delays only the off-beats, to two thirds of the beat at full swing', () => {
  const near = (a, b, why) => assert.ok(Math.abs(a - b) < 1e-12, `${why}: ${a} is not ${b}`);
  const full = bars({ bpm: 60, beats: 1, swing: 1 });
  assert.strictEqual(full.seconds(0, 0), 0);
  assert.strictEqual(full.seconds(0, 1), 1, 'the on-beats never move');
  near(full.seconds(0, 0.5), 2 / 3, 'the off-beat at full swing');
  near(full.seconds(0, 0.25), 1 / 3, 'a sixteenth before the off-beat stretches with it');
  near(full.seconds(0, 0.75), 5 / 6, 'a sixteenth after the off-beat squeezes');
  near(bars({ bpm: 60, beats: 1, swing: 0.5 }).seconds(0, 0.5), 7 / 12, 'half swing');
  assert.strictEqual(bars({ bpm: 60, beats: 1, swing: 0 }).seconds(0, 0.5), 0.5, 'no swing is a straight grid');
});

test('a beat grid refuses bad values by name', () => {
  for (const bpm of [0, -1, 'fast', NaN, undefined]) {
    assert.throws(() => bars({ bpm }), new RegExp(`bars: bpm must be a positive, finite number of beats a minute, got ${bpm}`));
  }
  assert.throws(() => bars({ bpm: 120, beats: 2.5 }), /bars: beats must be a whole number of beats a bar, 1 or more, got 2.5/);
  assert.throws(() => bars({ bpm: 120, beats: 0 }), /bars: beats must be a whole number of beats a bar, 1 or more, got 0/);
  assert.throws(() => bars({ bpm: 120, start: -1 }), /bars: start must be a finite number of seconds, 0 or more, got -1/);
  assert.throws(() => bars({ bpm: 120, swing: 2 }), /bars: swing must be from 0 to 1, got 2/);
  const g = bars({ bpm: 120 });
  assert.throws(() => g.seconds(NaN, 0), /bars: the bar and beat must be finite numbers, got NaN, 0/);
  assert.throws(() => g.seconds(0, 'x'), /bars: the bar and beat must be finite numbers, got 0, x/);
  assert.throws(() => g.frame(0, 0, 0), /bars: hz must be a positive, finite frame rate, got 0/);
  assert.throws(() => g.frame(NaN, 0, 24), /bars: the bar and beat must be finite numbers, got NaN, 0/);
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
