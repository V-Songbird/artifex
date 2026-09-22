'use strict';

// Regression checks for polyline geometry.
//
// Each check here is chosen by a fault's own structure, not by a tolerance: the
// centroid test uses a polygon whose vertices are deliberately bunched on one
// edge, the chain test uses segments in scrambled order and mixed direction, and
// the resample test uses a length that is NOT a whole number of steps.

const test = require('node:test');
const assert = require('node:assert');

const {
  closestPointOnSegment, segmentIntersection, offsetPolyline,
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

test('closest point clamps to the segment and measures from the returned point', () => {
  const a = [2, 3]; const b = [8, 11];
  for (const [p, t, point, distance] of [
    [[1, 10], 0.5, [5, 7], 5],
    [[-1, -1], 0, a, 5],
    [[11, 15], 1, b, 5],
  ]) {
    const got = closestPointOnSegment(p, a, b);
    assert.ok(near(got.t, t));
    assert.ok(got.point.every((v, i) => near(v, point[i])));
    assert.ok(near(got.distance, distance));
    assert.equal(got.distance, Math.hypot(p[0] - got.point[0], p[1] - got.point[1]));
  }
  assert.deepEqual(closestPointOnSegment([8, 11], a, a), { point: a, t: 0, distance: 10 });
});

test('intersection separates parallel segments and detects an interior crossing', () => {
  assert.equal(segmentIntersection([0, 0], [4, 4], [0, 1], [4, 5]), null);
  assert.equal(segmentIntersection([0, 0], [1, 1], [2, 0], [2, 3]), null);
  assert.deepEqual(segmentIntersection([0, 0], [4, 4], [0, 4], [4, 0]),
    { type: 'point', point: [2, 2] });
  // A shallow crossing must not disappear behind a fixed parallel tolerance.
  assert.deepEqual(segmentIntersection([0, 0], [1, 1e-12], [0, 1e-12], [1, 0]),
    { type: 'point', point: [0.5, 5e-13] });
});

test('collinear overlap keeps both ends in the first segment direction', () => {
  assert.deepEqual(segmentIntersection([0, 0], [6, 3], [8, 4], [2, 1]),
    { type: 'overlap', points: [[2, 1], [6, 3]] });
  assert.deepEqual(segmentIntersection([6, 3], [0, 0], [8, 4], [2, 1]),
    { type: 'overlap', points: [[6, 3], [2, 1]] });
  assert.deepEqual(segmentIntersection([2, 8], [2, 0], [2, 3], [2, 6]),
    { type: 'overlap', points: [[2, 6], [2, 3]] });
  assert.deepEqual(segmentIntersection([1, 1], [3, 3], [3, 3], [1, 1]),
    { type: 'overlap', points: [[1, 1], [3, 3]] });
  assert.equal(segmentIntersection([0, 0], [1, 1], [2, 2], [3, 3]), null);
  for (const d of [[6, 18], [12, 36]]) {
    assert.deepEqual(segmentIntersection([0, 0], [3, 9], [1, 3], d),
      { type: 'overlap', points: [[1, 3], [3, 9]] });
    assert.deepEqual(segmentIntersection([3, 9], [0, 0], d, [1, 3]),
      { type: 'overlap', points: [[3, 9], [1, 3]] });
  }
});

test('touching segment ends and T junctions are single point intersections', () => {
  const cases = [
    [[0, 0], [2, 0], [2, 0], [2, 3], [2, 0]],
    [[0, 0], [2, 0], [2, 0], [4, 0], [2, 0]],
    [[0, 0], [4, 0], [2, 0], [2, 3], [2, 0]],
  ];
  for (const [a, b, c, d, point] of cases) {
    for (const args of [[a, b, c, d], [b, a, c, d], [c, d, a, b], [d, c, b, a]]) {
      assert.deepEqual(segmentIntersection(...args), { type: 'point', point });
    }
  }
});

test('zero-length segments intersect only when their point belongs to the other segment', () => {
  const p = [2, 2]; const point = { type: 'point', point: p };
  assert.deepEqual(segmentIntersection(p, p, [0, 0], [4, 4]), point);
  assert.deepEqual(segmentIntersection([0, 0], [4, 4], p, p), point);
  assert.deepEqual(segmentIntersection(p, p, p, p), point);
  assert.equal(segmentIntersection(p, p, [3, 3], [3, 3]), null);
  assert.equal(segmentIntersection([2, 1], [2, 1], [0, 0], [4, 4]), null);
  assert.equal(segmentIntersection([5, 5], [5, 5], [0, 0], [4, 4]), null);
});

test('segment geometry works at small and large scales without squared-length overflow', () => {
  for (const scale of [1e-150, 1e150]) {
    const pt = (x, y) => [x * scale, y * scale];
    const closest = closestPointOnSegment(pt(2, 3), pt(0, 0), pt(4, 0));
    assert.equal(closest.t, 0.5);
    assert.ok(near(closest.distance / scale, 3));
    const hit = segmentIntersection(pt(0, 0), pt(4, 4), pt(0, 4), pt(4, 0));
    assert.equal(hit.type, 'point');
    assert.ok(near(hit.point[0] / scale, 2) && near(hit.point[1] / scale, 2));
  }
  const huge = segmentIntersection([0, 0], [Number.MAX_VALUE, 0],
    [Number.MAX_VALUE / 2, -1], [Number.MAX_VALUE / 2, 1]);
  assert.equal(huge.type, 'point');
  assert.ok(near(huge.point[0] / Number.MAX_VALUE, 0.5));
  assert.equal(huge.point[1], 0);
  const tiny = Number.MIN_VALUE;
  assert.ok(near(closestPointOnSegment([0.25, 1e308], [0, 0], [0.5, 0]).t, 0.5),
    'a huge perpendicular distance must not overflow a representable projection');
  assert.equal(closestPointOnSegment([tiny, 0], [0, 0], [tiny, tiny]).t, 0.5);
  const offset = offsetPolyline([[0, 0], [tiny, tiny]], 1);
  assert.ok(near(Math.hypot(...offset[0]), 1), 'a subnormal segment still has a unit normal');
});

test('open offsets use signed perpendicular distance, miter corners and butt ends', () => {
  const src = [[0, 0], [10, 0], [10, 10]];
  const left = offsetPolyline(src, 2);
  const right = offsetPolyline(src, -2);
  for (const [got, expected] of [[left, [[0, 2], [8, 2], [8, 10]]],
    [right, [[0, -2], [12, -2], [12, 10]]]]) {
    got.forEach((p, i) => p.forEach((v, j) => assert.ok(near(v, expected[i][j]))));
  }
  const reverse = offsetPolyline([...src].reverse(), -2).reverse();
  left.forEach((p, i) => p.forEach((v, j) => assert.ok(near(v, reverse[i][j]))));
  assert.deepEqual(offsetPolyline([[0, 0], [5, 0], [10, 0]], 1), [[0, 1], [5, 1], [10, 1]]);
});

test('offset miter limit bevels sharp corners and reversals instead of growing spikes', () => {
  const sharp = [[0, 0], [10, 0], [0, 1]];
  const out = offsetPolyline(sharp, 2, 2);
  assert.equal(out.length, 4, 'the over-limit corner needs two bevel points');
  for (const p of out.slice(1, -1)) assert.ok(near(Math.hypot(p[0] - 10, p[1]), 2));
  assert.equal(offsetPolyline(sharp, 2, 30).length, 3, 'a larger limit permits the miter');
  assert.deepEqual(offsetPolyline([[0, 0], [10, 0], [0, 0]], 1),
    [[0, 1], [10, 1], [10, -1], [0, -1]]);
  assert.equal(offsetPolyline([[0, 0], [1, 0], [1, 1]], 1, 1).length, 4);
});

test('offset collapses repeated vertices and copies empty or directionless input', () => {
  assert.deepEqual(offsetPolyline([], 2), []);
  const src = [[3, 4], [3, 4]];
  const result = offsetPolyline(src, 2);
  assert.deepEqual(result, [[3, 4]]);
  result[0][0] = 99;
  assert.deepEqual(src, [[3, 4], [3, 4]]);
  assert.deepEqual(offsetPolyline([[0, 0], [0, 0], [4, 0], [4, 0]], 1), [[0, 1], [4, 1]]);
  assert.deepEqual(offsetPolyline([[0, 0], [0, 0], [4, 0]], 0), [[0, 0], [4, 0]]);
  const frozen = Object.freeze([Object.freeze([0, 0]), Object.freeze([5, 0])]);
  assert.doesNotThrow(() => offsetPolyline(frozen, 1));
});

test('geometry rejects nonfinite coordinates and overflow rather than leaking NaN', () => {
  for (const p of [[NaN, 0], [0, Infinity], [1], Array(2), 'point']) {
    assert.throws(() => closestPointOnSegment(p, [0, 0], [1, 0]), /finite/);
    assert.throws(() => segmentIntersection([0, 0], [1, 1], p, [2, 2]), /finite/);
    assert.throws(() => offsetPolyline([[0, 0], p], 1), /finite/);
  }
  assert.throws(() => closestPointOnSegment([0, 0], [-1e308, 0], [1e308, 0]), /overflow/);
  assert.throws(() => segmentIntersection([-1e308, 0], [1e308, 0], [0, 0], [1, 1]), /overflow/);
  assert.throws(() => offsetPolyline([[0, 0], [1, 0]], Infinity), /finite/);
  for (const limit of [0, 0.9, NaN, Infinity]) {
    assert.throws(() => offsetPolyline([[0, 0], [1, 0]], 1, limit), /miterLimit/);
  }
});

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
