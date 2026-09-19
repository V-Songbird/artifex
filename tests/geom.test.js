'use strict';

// The geometry every author writes and nobody ships. Licensed by three
// independent populations rather than by our own examples -- see the note at
// the head of core/geom.js and ../Docs/Artifex/peer-implementation-scan.md.
//
// Each check here is chosen by a fault's own structure, not by a tolerance: the
// centroid test uses a polygon whose vertices are deliberately bunched on one
// edge, the chain test uses segments in scrambled order and mixed direction, and
// the resample test uses a length that is NOT a whole number of steps.

const test = require('node:test');
const assert = require('node:assert');

const {
  lengthOf, bbox, centroid, pointInPoly,
  resample, chaikin, chain,
  ring, ribbon,
} = require('../core/geom.js');

const SQUARE = [[0, 0], [4, 0], [4, 4], [0, 4]];
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

function grab(fn) {
  try { fn(); } catch (e) { return e; }
  throw new Error('expected a throw, and none happened');
}

// ---------------------------------------------------------------------------
// measurement
// ---------------------------------------------------------------------------

test('lengthOf measures the line, and the closing edge only when asked', () => {
  assert.equal(lengthOf([[0, 0], [3, 4]]), 5);
  assert.equal(lengthOf(SQUARE), 12);
  assert.equal(lengthOf(SQUARE, true), 16);
});

test('bbox bounds the set, and an empty set is refused by name', () => {
  assert.deepEqual(bbox([[1, 5], [-2, 3], [4, 9]]), [-2, 3, 4, 9]);
  assert.deepEqual(bbox([[7, 7]]), [7, 7, 7, 7]);
  assert.match(grab(() => bbox([])).message, /at least one point/);
});

test('THE CENTROID IS OF THE AREA, NOT OF THE VERTEX LIST', () => {
  assert.deepEqual(centroid(SQUARE), [2, 2]);

  // The fault this exists to catch: a hundred extra vertices along the bottom
  // edge. Every polygon out of a resampler, a contour tracer or a smoothing
  // pass has points bunched somewhere, and averaging them drags the answer.
  const crowded = [];
  for (let i = 0; i < 100; i++) crowded.push([(i / 100) * 4, 0]);
  crowded.push([4, 0], [4, 4], [0, 4]);
  const c = centroid(crowded);
  assert.ok(near(c[0], 2, 1e-9) && near(c[1], 2, 1e-9), `area centroid moved to ${c}`);

  // And the vertex mean, on the same polygon, is demonstrably somewhere else.
  const mean = crowded.reduce((a, p) => [a[0] + p[0] / crowded.length, a[1] + p[1] / crowded.length], [0, 0]);
  assert.ok(Math.abs(mean[1] - 2) > 1,
    'the vertex mean should be far from the area centroid here, or this test proves nothing');

  // A zero-area polygon has no area centroid, and must not hand back NaN.
  const flat = centroid([[0, 0], [2, 0], [4, 0]]);
  assert.ok(Number.isFinite(flat[0]) && Number.isFinite(flat[1]), `degenerate gave ${flat}`);
});

test('pointInPoly answers inside and outside, including a concave notch', () => {
  assert.equal(pointInPoly([2, 2], SQUARE), true);
  assert.equal(pointInPoly([9, 2], SQUARE), false);
  assert.equal(pointInPoly([2, -1], SQUARE), false);

  // An L: the point sits inside the bounding box and outside the shape, which
  // is the case a bbox test gets wrong and a winding test gets right.
  const L = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]];
  assert.equal(pointInPoly([0.5, 0.5], L), true);
  assert.equal(pointInPoly([3, 3], L), false);
});

// ---------------------------------------------------------------------------
// resample and smooth
// ---------------------------------------------------------------------------

test('resample spaces points along the LENGTH, not along the index', () => {
  const even = resample([[0, 0], [10, 0]], 2.5);
  assert.deepEqual(even, [[0, 0], [2.5, 0], [5, 0], [7.5, 0], [10, 0]]);

  // Points bunched at one end: the output must not inherit the bunching.
  const lumpy = resample([[0, 0], [0.5, 0], [1, 0], [1.5, 0], [10, 0]], 2.5);
  for (let i = 1; i < lumpy.length - 1; i++) {
    assert.ok(near(lumpy[i][0] - lumpy[i - 1][0], 2.5, 1e-9),
      `step ${i} was ${lumpy[i][0] - lumpy[i - 1][0]}, not 2.5`);
  }
});

test('THE LAST POINT SURVIVES A LENGTH THAT IS NOT A WHOLE NUMBER OF STEPS', () => {
  // 7 is not a multiple of 2.5. Dropping the tail shortens the mark, and a row
  // of marks each shortened by a different fraction of a step reads as a ragged
  // edge nothing in the piece asked for.
  const r = resample([[0, 0], [7, 0]], 2.5);
  assert.deepEqual(r[r.length - 1], [7, 0]);
  assert.deepEqual(r[0], [0, 0]);
});

test('a two-point run resamples to a straight run and keeps both ends', () => {
  // The crossbar again: a T's bar is two points and no curvature. A resampler
  // that decides by curvature deletes it, and nothing throws.
  const bar = resample([[0, 0], [30, 0]], 1000);
  assert.deepEqual(bar, [[0, 0], [30, 0]]);
  assert.match(grab(() => resample([[0, 0], [1, 0]], 0)).message, /positive/);
});

test('chaikin cuts corners, and an OPEN line keeps both of its ends exactly', () => {
  const src = [[0, 0], [10, 0], [10, 10]];
  const out = chaikin(src, 1);
  assert.deepEqual(out[0], [0, 0]);
  assert.deepEqual(out[out.length - 1], [10, 10]);
  assert.ok(out.length > src.length);

  // The corner must actually be gone: no output point sits on the old vertex.
  assert.ok(!out.some((p) => p[0] === 10 && p[1] === 0), 'the corner survived the cut');

  // Closed rings have no ends to preserve, and must not grow a seam.
  const ringOut = chaikin(SQUARE, 2, true);
  assert.equal(ringOut.length, SQUARE.length * 4);
});

// ---------------------------------------------------------------------------
// chaining: what a plotter pays for
// ---------------------------------------------------------------------------

test('scrambled, mixed-direction segments chain into ONE closed ring', () => {
  const segs = [
    [[0, 0], [10, 0]],
    [[10, 10], [10, 0]],      // backwards
    [[10, 10], [0, 10]],
    [[0, 10], [0, 0]],
  ];
  const out = chain(segs);
  assert.equal(out.length, 1, `four edges of one square gave ${out.length} paths`);
  assert.equal(out[0].length, 5);
  assert.deepEqual(out[0][0], out[0][out[0].length - 1]);
});

test('a chain extends BACKWARDS as well as forwards', () => {
  // The first segment handed in is the last one along the line, so a chainer
  // that only walks forwards returns three paths instead of one.
  const segs = [[[2, 0], [3, 0]], [[1, 0], [2, 0]], [[0, 0], [1, 0]]];
  const out = chain(segs);
  assert.equal(out.length, 1, `one line in three pieces gave ${out.length} paths`);
  assert.deepEqual(out[0], [[0, 0], [1, 0], [2, 0], [3, 0]]);
});

test('segments that do not touch stay separate', () => {
  assert.equal(chain([[[0, 0], [1, 0]], [[5, 5], [6, 5]]]).length, 2);
  assert.equal(chain([]).length, 0);
});

test('chaining loses no points, and cuts the pen lifts', () => {
  const segs = [];
  for (let i = 0; i < 40; i++) segs.push([[i, 0], [i + 1, 0]]);
  for (let i = 0; i < 40; i++) segs.push([[i, 9], [i + 1, 9]]);
  const out = chain(segs);
  assert.equal(out.length, 2, 'two lines in eighty pieces should chain to two paths');
  assert.equal(out.reduce((n, p) => n + p.length, 0), 82);
});

test('-0 and 0 are the same endpoint, because a Map says so', () => {
  // The hole this replaced: keys built with toFixed render -0 as "-0.000000"
  // and 0 as "0.000000", and two identical points stop matching. On a
  // tessellation that cut sixteen strands dead in the middle of the sheet with
  // nothing thrown. A Map compares by SameValueZero and has no such hole.
  const out = chain([[[-0, -0], [1, 0]], [[1, 0], [2, 0]], [[0, 0], [-1, 0]]]);
  assert.equal(out.length, 1, `-0 split the chain into ${out.length} paths`);
});

// ---------------------------------------------------------------------------
// shape
// ---------------------------------------------------------------------------

test('ring is a constructor, not a look: a constant radius is a circle', () => {
  const circle = ring(0, 0, 64, () => 5);
  for (const p of circle) assert.ok(near(Math.hypot(p[0], p[1]), 5, 1e-9));

  // Handed a step function it is a gear; handed a field it is a blob. Same code.
  const gear = ring(0, 0, 8, (a, i) => (i % 2 ? 3 : 5));
  assert.equal(new Set(gear.map((p) => +Math.hypot(p[0], p[1]).toFixed(9))).size, 2);
});

test('ribbon turns a varying weight into a shape a single-width pen can draw', () => {
  const spine = [[0, 0], [10, 0], [20, 0]];
  const out = ribbon(spine, () => 2);
  assert.equal(out.length, spine.length * 2);

  // Up one side and back down the other: the first half is offset one way and
  // the second half the other, or it is not an outline.
  assert.deepEqual(out[0], [0, 2]);
  assert.deepEqual(out[out.length - 1], [0, -2]);

  const taper = ribbon(spine, (i, n) => (i / (n - 1)) * 4);
  assert.ok(Math.abs(taper[0][1]) < Math.abs(taper[2][1]), 'the taper did not taper');
  assert.match(grab(() => ribbon([[0, 0]], () => 1)).message, /two points/);
});
