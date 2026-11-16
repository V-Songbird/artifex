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
  resample, chaikin, catmullRom, bezier, spline, fitBezier, chain,
  ring, ribbon, keyOutline, keyFaults,
} = require('../core/geom.js');
const { fill, outline, crossContours, grow } = require('../core/path.js');
const { pose, project } = require('../core/armature.js');
const { rng } = require('../core/rand.js');

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

test('catmullRom passes through every point, where chaikin cuts inside the turn', () => {
  // Uneven spans and a sharp turn: the case a corner-cutter misses.
  const src = [[0, 0], [10, 0], [12, 9], [30, 4], [31, 20]];
  const out = catmullRom(src, 6);
  assert.equal(out.length, (src.length - 1) * 6 + 1);
  src.forEach((p, i) => assert.deepEqual(out[i * 6], p, `point ${i} is not on the curve`));
  assert.deepEqual(out[out.length - 1], src[src.length - 1]);
  assert.ok(!chaikin(src, 2).some((p) => p[0] === 10 && p[1] === 0), 'chaikin kept the turn');

  // Between the points it curves: not every sample sits on the straight spans.
  assert.ok(out.some((p) => p[1] !== 0 && p[0] < 10), 'the first span stayed straight');
  // The basis at t = 0.25, where its weights are asymmetric, so swapping p1 and p2 fails.
  const quarter = catmullRom(src, 4)[5];
  const w = [-0.0703125, 0.8671875, 0.2265625, -0.0234375];
  [0, 1].forEach((k) => assert.ok(near(quarter[k], w.reduce((s, x, i) => s + x * src[i][k], 0)), `quarter axis ${k}`));

  // A ring: n spans, no repeated seam point, still through every point.
  const ringOut = catmullRom(SQUARE, 4, true);
  assert.equal(ringOut.length, SQUARE.length * 4);
  SQUARE.forEach((p, i) => assert.deepEqual(ringOut[i * 4], p));
  assert.notDeepEqual(ringOut[ringOut.length - 1], SQUARE[0]);
  // The ring wraps: the first span leans on the last point, the closing span runs back to the first.
  [0, 1].forEach((k) => {
    assert.ok(near(ringOut[1][k], w.reduce((s, x, i) => s + x * SQUARE[(i + 3) % 4][k], 0)), `first span axis ${k}`);
    const mid = (-SQUARE[2][k] + 9 * SQUARE[3][k] + 9 * SQUARE[0][k] - SQUARE[1][k]) / 16;
    assert.ok(near(ringOut[ringOut.length - 2][k], mid), `closing span axis ${k}`);
  });

  // Two points stay a straight line; fewer points come back as copies.
  for (const p of catmullRom([[0, 0], [8, 4]], 4)) assert.ok(near(p[1], p[0] / 2));
  assert.deepEqual(catmullRom([[3, 4]], 4), [[3, 4]]);
  assert.deepEqual(catmullRom([], 4), []);
  assert.deepEqual(catmullRom([[0, 0], [1, 1]], 4, true), [[0, 0], [1, 1]]);
  assert.match(grab(() => catmullRom(src, 0)).message, /positive integer/);
  assert.match(grab(() => catmullRom(src, 2.5)).message, /positive integer/);
});

test('catmullRom and spline at alpha 0.5 pass through every point and never loop inside a span, where the uniform curve does', () => {
  // How many times a polyline crosses itself, counting only steps that do not touch.
  const crossings = (line) => {
    const side = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    let count = 0;
    for (let i = 0; i + 1 < line.length; i++) {
      for (let j = i + 2; j + 1 < line.length; j++) {
        const [a, b, c, d] = [line[i], line[i + 1], line[j], line[j + 1]];
        if (side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0) count++;
      }
    }
    return count;
  };
  // A short span between two long ones that rise and fall: the uniform curve loops in it.
  const tight = [[0, 0], [100, 10], [101, 10], [201, 0]];
  const span = (alpha) => catmullRom(tight, 64, false, { alpha }).slice(64, 129);
  assert.ok(crossings(span(0)) > 0, 'the uniform curve loops in the short span');
  assert.equal(crossings(span(0.5)), 0, 'the centripetal curve does not');
  // Seeded lines of very uneven spans: no span of the centripetal curve crosses itself.
  let seed = 7;
  const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  let uniformLoops = 0;
  for (let line = 0; line < 40; line++) {
    const pts = [[0, 0]];
    for (let i = 1; i < 8; i++) {
      const [turn, step] = [next() * 2 * Math.PI, 10 ** (next() * 3)];
      pts.push([pts[i - 1][0] + step * Math.cos(turn), pts[i - 1][1] + step * Math.sin(turn)]);
    }
    const [even, centred] = [catmullRom(pts, 32), catmullRom(pts, 32, false, { alpha: 0.5 })];
    assert.equal(centred.length, even.length);
    pts.forEach((p, i) => assert.deepEqual(centred[i * 32], p, `line ${line}: point ${i} is on the curve`));
    for (let s = 0; s < 7; s++) {
      uniformLoops += crossings(even.slice(s * 32, s * 32 + 33));
      assert.equal(crossings(centred.slice(s * 32, s * 32 + 33)), 0, `line ${line}: span ${s} loops`);
    }
  }
  assert.ok(uniformLoops > 0, 'these lines are uneven enough to loop the uniform curve');

  // Even spans give the same curve at any alpha, and alpha 0 is the default bit for bit.
  const evenly = [[0, 0], [10, 0], [10, 10], [20, 10]];
  const [plain, half] = [catmullRom(evenly, 8), catmullRom(evenly, 8, false, { alpha: 0.5 })];
  plain.forEach((p, i) => assert.ok(Math.hypot(p[0] - half[i][0], p[1] - half[i][1]) < 1e-9, `point ${i}`));
  assert.deepEqual(catmullRom(tight, 8, false, { alpha: 0 }), catmullRom(tight, 8));
  const ring = catmullRom(SQUARE, 4, true, { alpha: 0.5 });
  assert.equal(ring.length, 16);
  SQUARE.forEach((p, i) => assert.deepEqual(ring[i * 4], p));
  // Points that coincide stay finite.
  for (const p of catmullRom([[0, 0], [0, 0], [5, 5], [5, 5], [9, 0]], 4, false, { alpha: 0.5 })) assert.ok(Number.isFinite(p[0]) && Number.isFinite(p[1]));

  // spline takes the same knots: the same curve as catmullRom, corners still sharp.
  const fine = catmullRom(tight, 400, false, { alpha: 0.5 });
  const drawn = spline(tight, 0.5, { alpha: 0.5 });
  for (const p of drawn) {
    const d = Math.min(...fine.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])));
    assert.ok(d < 0.2, `${p} is ${d} off the centripetal curve`);
  }
  for (const p of tight) assert.ok(drawn.some((q) => q[0] === p[0] && q[1] === p[1]), `${p} is copied`);
  assert.equal(crossings(drawn), 0);
  assert.deepEqual(spline(tight, 1, { alpha: 0 }), spline(tight, 1));
  const cornered = spline([[0, 0], [10, 0], [10, 10]], 0.5, { corners: [1], alpha: 0.5 });
  assert.ok(cornered.every((p) => (p[1] === 0 && p[0] <= 10) || Math.abs(p[0] - 10) < 1e-9), 'two straight runs meet at the corner');
  for (const bad of [-0.1, 1.5, '0.5', NaN]) {
    assert.match(grab(() => catmullRom(tight, 8, false, { alpha: bad })).message, /^catmullRom: alpha must be from 0 to 1, got /);
    assert.match(grab(() => spline(tight, 1, { alpha: bad })).message, /^spline: alpha must be from 0 to 1, got /);
  }
});

// ---------------------------------------------------------------------------
// bezier and spline: curves sampled at a spacing, corners kept
// ---------------------------------------------------------------------------

const chords = (pts) => pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
const turn = (a, b, c) => {
  const t = Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]);
  return Math.abs(Math.atan2(Math.sin(t), Math.cos(t)));
};
const indexOf = (pts, q) => pts.findIndex((p) => p[0] === q[0] && p[1] === q[1]);

test('bezier keeps every segment end and cuts each segment into equal steps within the spacing', () => {
  // A line meeting a quadratic at a right angle, then a cubic joining it smoothly.
  const k = 0.5522847498;
  const path = [[20, -15], [[20, 0]], [[30, 0], [30, 10]], [[30, 10 + 10 * k], [20 + 10 * k, 20], [20, 20]]];
  const out = bezier(path, 1.5);
  assert.deepEqual(out[0], [20, -15]);
  assert.deepEqual(out[out.length - 1], [20, 20]);
  const ends = [[20, -15], [20, 0], [30, 10], [20, 20]].map((q) => indexOf(out, q));
  assert.ok(ends.every((i, n) => i >= 0 && (n === 0 || i > ends[n - 1])), `segment ends kept in order: ${ends}`);
  const steps = chords(out);
  assert.ok(Math.max(...steps) <= 1.5 + 1e-9, `longest step ${Math.max(...steps)}`);
  // The fewest equal steps: no stub before a corner.
  for (let n = 1; n < ends.length; n++) {
    const part = steps.slice(ends[n - 1], ends[n]);
    assert.ok(Math.min(...part) > 0.97 * Math.max(...part), `segment ${n} steps ${Math.min(...part)}..${Math.max(...part)}`);
    assert.ok(Math.max(...part) > 1.5 * 0.75, `segment ${n} used more steps than needed`);
  }
  // A straight segment stays on its line; the cubic quarter circle stays on its radius.
  for (const p of out.slice(0, ends[1] + 1)) assert.equal(p[0], 20);
  for (const p of out.slice(ends[2])) assert.ok(Math.abs(Math.hypot(p[0] - 20, p[1] - 10) - 10) < 0.003, `${p} off the arc`);
  // The quadratic is x = 20 + 20t - 10t^2, y = 10t^2.
  for (const p of out.slice(ends[1], ends[2] + 1)) {
    const t = Math.sqrt(p[1] / 10);
    assert.ok(near(p[0], 20 + 20 * t - 10 * t * t, 1e-9), `${p} off the quadratic`);
  }
  assert.ok(turn(out[ends[1] - 1], out[ends[1]], out[ends[1] + 1]) > 0.5, 'the corner between line and curve was rounded');
});

test('on general curves, bezier and spline steps stay within half a percent of the spacing', () => {
  // Steps are measured on a finer polyline, so a step may run a fraction of a percent over.
  let s = 7;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const P = () => [rnd() * 100, rnd() * 100];
  let worst = 0;
  for (let k = 0; k < 3000; k++) {
    const sp = 0.2 + rnd() * 20;
    const seg = k % 3 === 0 ? [P(), P()] : k % 3 === 1 ? [P(), P(), P()] : (() => { const b = P(); return [[b[0] + 1, b[1] - 1], P(), b]; })();
    worst = Math.max(worst, ...chords(bezier([P(), seg], sp)).map((c) => c / sp));
  }
  for (let k = 0; k < 300; k++) {
    const pts = Array.from({ length: 3 + Math.floor(rnd() * 6) }, P);
    const sp = 0.2 + rnd() * 20;
    const corners = pts.map((_, i) => i).filter(() => rnd() < 0.3);
    worst = Math.max(worst, ...chords(spline(pts, sp, { corners, close: rnd() < 0.5 })).map((c) => c / sp));
  }
  assert.ok(worst <= 1.005, `a step ran ${worst} times the spacing`);
  assert.ok(worst > 0.9, `steps ran short of the spacing: longest ${worst}`);
});

test('a closed bezier path does not repeat its start, and its output feeds outline and fill', () => {
  const sq = bezier([[0, 0], [[10, 0]], [[10, 10]], [[0, 10]]], 2, true);
  assert.deepEqual(sq[0], [0, 0]);
  assert.notDeepEqual(sq[sq.length - 1], [0, 0]);
  assert.equal(sq.length, 20);
  for (const q of [[10, 0], [10, 10], [0, 10]]) assert.ok(indexOf(sq, q) >= 0, `corner ${q} lost`);
  // A path already ending on its start is not given a closing segment.
  assert.equal(bezier([[0, 0], [[10, 0]], [[10, 10]], [[0, 10]], [[0, 0]]], 2, true).length, 20);

  const ring = outline(sq, () => 1, { closed: true });
  assert.ok(ring.length > sq.length && ring.every((p) => p.every(Number.isFinite)));
  const calls = [];
  const g = { beginPath() {}, moveTo(...a) { calls.push(a); }, lineTo(...a) { calls.push(a); }, closePath() {}, fill() {} };
  fill(g, outline(bezier([[0, 0], [[5, 8], [10, 0]]], 0.5), (u) => 4 * u * (1 - u)));
  assert.ok(calls.length > 20 && calls.every((p) => p.every(Number.isFinite)));

  assert.deepEqual(bezier([], 1), []);
  assert.deepEqual(bezier([[2, 3]], 1, true), [[2, 3]]);
  assert.deepEqual(bezier([[2, 3], [[2, 3], [2, 3]], [[4, 3]]], 1), [[2, 3], [3, 3], [4, 3]]);
  assert.match(grab(() => bezier([[0, 0], [[1, 1]]], 0)).message, /bezier: spacing must be positive/);
  assert.match(grab(() => bezier([[0, 0], []], 1)).message, /segment 1 must hold 1 to 3 points/);
  assert.equal(grab(() => bezier([[0, 0], [[NaN, 1]]], 1)).name, 'TypeError');
});

test('fitBezier passes within its tolerance of every sampled point with few curves, smooth at each join and sharp at a corner', () => {
  // How far `p` is from the fitted path, sampled finely.
  const off = (drawn, p) => Math.min(...drawn.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])));
  const turn = (a, b) => Math.abs(Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]));

  // Points taken from one cubic come back as one curve on it.
  const known = [[0, 0], [[30, 60], [90, -40], [120, 20]]];
  const sampled = bezier(known, 3);
  const one = fitBezier(sampled, 1);
  assert.equal(one.length, 2, `one curve, got ${one.length - 1}`);
  assert.deepEqual([one[0], one[1][2]], [[0, 0], [120, 20]]);
  for (const p of bezier(known, 1)) assert.ok(off(bezier(one, 0.25), p) < 1.1, `${p} is off the fit`);

  // A jittered wave: every sample within the tolerance, far fewer curves than samples, no bend at a join.
  let seed = 3;
  const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const wave = Array.from({ length: 200 }, (_, i) => [i * 3, 80 * Math.sin(i / 18) + (next() - 0.5)]);
  const loose = fitBezier(wave, 4), tight = fitBezier(wave, 1);
  assert.ok(loose.length - 1 <= 12, `a wave of 200 samples takes ${loose.length - 1} curves at 4`);
  assert.ok(tight.length >= loose.length, 'a smaller tolerance never takes fewer curves');
  for (const [path, tolerance] of [[loose, 4], [tight, 1]]) {
    const drawn = bezier(path, 0.25);
    const far = Math.max(...wave.map((p) => off(drawn, p)));
    assert.ok(far <= tolerance + 0.13, `the farthest sample is ${far} from the fit at ${tolerance}`);
    assert.deepEqual([path[0], path[path.length - 1][2]], [wave[0], wave[199]], 'the ends are copied');
    for (let k = 1; k + 1 < path.length; k++) {
      const [into, out] = [[path[k][2][0] - path[k][1][0], path[k][2][1] - path[k][1][1]], [path[k + 1][0][0] - path[k][2][0], path[k + 1][0][1] - path[k][2][1]]];
      assert.ok(turn(into, out) < 1e-6, `join ${k} bends by ${turn(into, out)}`);
    }
  }
  // The fit is cleaner than the samples: its sampled line turns less in total.
  const turning = (line) => line.slice(2).reduce((sum, p, i) => sum + turn([line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]], [p[0] - line[i + 1][0], p[1] - line[i + 1][1]]), 0);
  // Measured: 20.7 radians for the samples, 6.9 for the wave under them and 7.0 for the fit.
  assert.ok(turning(bezier(loose, 3)) < turning(wave) / 2.5, 'the jitter is gone');

  // A straight run is one straight curve; a corner stays a corner only when it is named.
  const straight = fitBezier([[0, 0], [3, 3], [5, 5], [9, 9]], 0.1);
  assert.equal(straight.length, 2);
  for (const p of straight[1]) assert.ok(Math.abs(p[0] - p[1]) < 1e-9);
  const elbow = [...Array.from({ length: 11 }, (_, i) => [i * 4, 0]), ...Array.from({ length: 10 }, (_, i) => [40, (i + 1) * 4])];
  const sharp = fitBezier(elbow, 0.5, { corners: [10] });
  assert.equal(sharp.length, 3, 'one curve to the corner and one from it');
  assert.deepEqual(sharp[1][2], [40, 0]);
  assert.ok(bezier(sharp, 0.5).every((p) => Math.abs(p[1]) < 1e-9 || Math.abs(p[0] - 40) < 1e-9), 'both runs stay straight');
  for (const p of elbow) assert.ok(off(bezier(fitBezier(elbow, 0.5), 0.1), p) <= 0.6, `${p} is off the unnamed fit`);

  // Short and repeated inputs.
  assert.deepEqual(fitBezier([], 1), []);
  assert.deepEqual(fitBezier([[2, 3]], 1), [[2, 3]]);
  assert.deepEqual(fitBezier([[0, 0], [9, 0]], 1), [[0, 0], [[3, 0], [6, 0], [9, 0]]]);
  for (const path of [fitBezier([[0, 0], [0, 0], [5, 5], [5, 5], [5, 5], [9, 0], [9, 0]], 0.2), fitBezier([[1, 1], [1, 1], [1, 1]], 1), fitBezier([[0, 0], [5, 0], [0, 0], [5, 0], [0, 0]], 0.1)]) {
    assert.ok(path.flat(2).every(Number.isFinite), 'every coordinate is finite');
  }
  // A line cut one point at a time: 20,000 points of a growing zigzag once overflowed the stack.
  const zigzag = Array.from({ length: 20000 }, (_, i) => [i, (i % 2 ? 1 : -1) * Math.exp((i * 8) / 20000)]);
  const many = fitBezier(zigzag, 1e-3);
  assert.deepEqual([many[0], many[many.length - 1][2]], [zigzag[0], zigzag[19999]]);
  assert.match(grab(() => fitBezier(wave, 0)).message, /^fitBezier: tolerance must be positive, got 0$/);
  assert.match(grab(() => fitBezier(wave, 1, { corners: [200] })).message, /^fitBezier: corner 200 is not an index of the 200 points$/);
  assert.throws(() => fitBezier([[0, 0], [NaN, 1]], 1), /expected a finite \[x, y\] point/);
});

test('spline is catmullRom without corners, and a tagged corner turns sharply', () => {
  const src = [[0, 0], [10, 0], [12, 9], [30, 4], [31, 20]];
  const smooth = spline(src, 0.4);
  const fine = catmullRom(src, 400);
  for (const p of smooth) {
    const d = Math.min(...fine.slice(1).map((q, i) => closestPointOnSegment(p, fine[i], q).distance));
    assert.ok(d < 1e-3, `${p} is ${d} off the catmullRom curve`);
  }
  for (const p of src) assert.ok(indexOf(smooth, p) >= 0, `input ${p} not kept`);
  assert.ok(Math.max(...chords(smooth)) <= 0.4 + 1e-9);

  const L = [[0, 0], [10, 0], [10, 10], [20, 10]];
  const round = spline(L, 0.25);
  const sharp = spline(L, 0.25, { corners: [1] });
  const at = (pts) => { const i = indexOf(pts, [10, 0]); return turn(pts[i - 1], pts[i], pts[i + 1]); };
  assert.ok(at(round) < 0.2, `untagged point turned ${at(round)}`);
  assert.ok(at(sharp) > 1.4, `tagged corner turned ${at(sharp)}`);
  // Both spans meeting a corner leave it along their own chord.
  assert.ok(sharp.slice(0, indexOf(sharp, [10, 0]) + 1).every((p) => p[1] === 0));
  // The untagged point after the corner still turns smoothly.
  const j = indexOf(sharp, [10, 10]);
  assert.ok(turn(sharp[j - 1], sharp[j], sharp[j + 1]) < 0.2, 'an untagged point turned sharply');

  // A closed spline with a corner at the start: no repeated first point, and outline closes it.
  const loop = spline([[0, 0], [10, 0], [10, 10], [0, 10]], 0.5, { corners: [0], close: true });
  assert.deepEqual(loop[0], [0, 0]);
  assert.notDeepEqual(loop[loop.length - 1], [0, 0]);
  assert.ok(turn(loop[loop.length - 1], loop[0], loop[1]) > 1.2, 'the tagged start was rounded');
  assert.ok(outline(loop, () => 2, { closed: true }).every((p) => p.every(Number.isFinite)));

  assert.deepEqual(spline([[3, 4]], 1), [[3, 4]]);
  assert.deepEqual(spline([[0, 0], [1, 1]], 1, { close: true }), [[0, 0], [1, 1]]);
  assert.match(grab(() => spline(L, -1)).message, /spline: spacing must be positive/);
  assert.match(grab(() => spline(L, 1, { corners: [4] })).message, /corner 4 is not an index of the 4 points/);
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

// ---------------------------------------------------------------------------
// key outlines
// ---------------------------------------------------------------------------

const KEY0 = [[0, 0], [4, 0], [4, 4], [0, 4]];
const KEY1 = [[0, 0], [8, 0], [8, 8], [0, 8]];
const KEY2 = [[2, 2], [8, 4], [6, 10], [-2, 8]];

test('keyOutline returns each key exactly on its value and holds the ends', () => {
  const keys = [KEY0, KEY1, KEY2];
  assert.deepStrictEqual(keyOutline(keys, 0), KEY0);
  assert.deepStrictEqual(keyOutline(keys, 1), KEY1);
  assert.deepStrictEqual(keyOutline(keys, 2), KEY2);
  assert.deepStrictEqual(keyOutline(keys, -1), KEY0);
  assert.deepStrictEqual(keyOutline(keys, 5), KEY2);
  const out = keyOutline(keys, 0);
  out[0][0] = 99;
  assert.deepStrictEqual(KEY0[0], [0, 0], 'the result shares points with a key');
});

test('keyOutline steps through more than two keys: the floor picks the pair, the fraction blends it', () => {
  const keys = [KEY0, KEY1, KEY2];
  const blend = (a, b, u) => a.map((p, i) => [p[0] * (1 - u) + b[i][0] * u, p[1] * (1 - u) + b[i][1] * u]);
  assert.deepStrictEqual(keyOutline(keys, 1.25), blend(KEY1, KEY2, 0.25));
  assert.deepStrictEqual(keyOutline(keys, 0.5), [[0, 0], [6, 0], [6, 6], [0, 6]]);
});

test('per-point weights give each point its own track value', () => {
  const out = keyOutline([KEY0, KEY1], [0, 1], [[1, 0], [1, 1], [0, 1], [3, 1]]);
  assert.deepStrictEqual(out, [[0, 0], [6, 0], [8, 8], [0, 5]]);
});

test('keyOutline refuses mismatched keys, values and weights by name', () => {
  const keys = [KEY0, KEY1];
  const refusals = [
    [() => keyOutline([KEY0], 0), /^keyOutline: needs at least two key outlines, got 1/],
    [() => keyOutline([KEY0, KEY1.slice(1)], 0), /^keyOutline: key 1 has 3 points, key 0 has 4/],
    [() => keyOutline([KEY0, [[0, 0], [1, NaN], [1, 1], [0, 1]]], 0), /^keyOutline: key 1 point 1 must be a finite \[x, y\], got \[1, NaN\]/],
    [() => keyOutline([KEY0, [[0, 0], [1, 0, 2], [1, 1], [0, 1]]], 0), /^keyOutline: key 1 point 1 must be a finite \[x, y\], got \[1, 0, 2\]/],
    [() => keyOutline(keys, NaN), /^keyOutline: v must be a finite number, got NaN/],
    [() => keyOutline(keys, [0, 1]), /^keyOutline: an array of track values needs weights/],
    [() => keyOutline(keys, 0.5, [[1], [1], [1], [1]]), /^keyOutline: with weights, v must be an array/],
    [() => keyOutline(keys, [0], [[1], [1], [1]]), /^keyOutline: weights has 3 rows for 4 points/],
    [() => keyOutline(keys, [0, 1], [[1, 0], [-1, 2], [0, 1], [0, 1]]), /^keyOutline: weights row 1 must hold 2 non-negative numbers/],
    [() => keyOutline(keys, [0, 1], [[1, 0], [1, 0], [0, 0], [0, 1]]), /^keyOutline: weights row 2 .* with a positive sum/],
  ];
  for (const [fn, message] of refusals) assert.match(grab(fn).message, message);
});

test('keyFaults reports an outline that folds through itself at a blend middle', () => {
  const a = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const b = [[10, 0], [0, 0], [0, 10], [10, 10]];   // mirrored in x, same index order
  const crosses = keyFaults([a, b], { ratio: 100 }).filter((f) => f.type === 'cross');
  assert.deepStrictEqual(crosses, [{ type: 'cross', at: 0.5, spans: [1, 3], point: [5, 0] }]);
  assert.deepStrictEqual(keyFaults([a, b], { ratio: 100, steps: 1 }).filter((f) => f.type === 'cross'), []);
  assert.deepStrictEqual(keyFaults([a, a], { ratio: 1.01 }), []);
});

test('keyFaults reports a span that stretches past the ratio between keys', () => {
  const a = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const b = [[0, 0], [20, 0], [10, 10], [0, 10]];   // span 1 grows by the square root of 2 only
  assert.deepStrictEqual(keyFaults([a, b], { ratio: 1.5 }), [{ type: 'stretch', at: [0, 1], span: 0, ratio: 2 }]);
  assert.match(grab(() => keyFaults([a, b])).message, /^keyFaults: ratio must be a finite number above 1, got undefined/);
  assert.match(grab(() => keyFaults([a, b], { ratio: 1 })).message, /^keyFaults: ratio must be/);
  assert.match(grab(() => keyFaults([a, b], { ratio: 2, steps: 0 })).message, /^keyFaults: steps must be a positive integer, got 0/);

  // The only crossing uses the closing span, so an open line reports nothing.
  const hook = [[0, 0], [10, 0], [10, 10], [12, 5]];
  assert.deepStrictEqual(keyFaults([hook, hook], { ratio: 2 }).map((f) => [f.at, f.spans]),
    [[0, [1, 3]], [0.5, [1, 3]], [1, [1, 3]]]);
  assert.deepStrictEqual(keyFaults([hook, hook], { ratio: 2, close: false }), []);
});

// One tapered segment from the origin down the picture, bent out of it by `bend`.
const DOWN = { forward: [0, 1, 0], side: [1, 0, 0] };
const tube = (bend, radius = [12, 8], length = 100) => project(pose([0, 0, 0], DOWN, [{ length, radius, bend }])).segments[0];
const centreAt = (seg, t) => [seg.a[0] + (seg.b[0] - seg.a[0]) * t, seg.a[1] + (seg.b[1] - seg.a[1]) * t];
const majorAt = (seg, t) => seg.sections[0].major + (seg.sections[1].major - seg.sections[0].major) * t;
const dot2 = (p, q) => p[0] * q[0] + p[1] * q[1];
const off = (p, c) => [p[0] - c[0], p[1] - c[1]];

test('cross-contours run over the visible half of each section, from the shade side toward the light', () => {
  const seg = tube(Math.PI / 4);
  const nv = seg.sections[0].near;
  assert.ok(near(nv[0], 0) && near(nv[1], -1), `near [${nv}]`);
  const light = [1, 0];
  const marks = crossContours(seg, rng(1), 'tube', { light, spacing: 10 });
  assert.ok(marks.length >= 5, `${marks.length} marks`);
  let bad = 0;
  for (const m of marks) {
    const c = centreAt(seg, m.at);
    bad += m.points.filter((p) => dot2(off(p, c), nv) < -1e-9).length;
    assert.ok(dot2(off(m.points[m.points.length >> 1], c), nv) > 0, `mark at ${m.at}: middle point not on near's side`);
    const first = dot2(off(m.points[0], c), light);
    assert.ok(first < 0, `mark at ${m.at}: starts on the light side`);
    assert.ok(dot2(off(m.points[m.points.length - 1], c), light) > first, `mark at ${m.at}: does not run toward the light`);
  }
  assert.strictEqual(bad, 0, 'points on the far half');
  const flipped = crossContours(seg, rng(1), 'tube', { light: [-1, 0], spacing: 10 });
  assert.ok(flipped.every((m) => m.points[0][0] > centreAt(seg, m.at)[0]), 'light from -x: marks start on +x');

  // An oblique segment and view: every point still lies on near's side.
  const g = pose([1, 2, 3], { forward: [0.3, 1, 0.2], side: [1, 0, 0.4] }, [{ length: 4, radius: [2, 2], bend: 0.7, twist: 0.4 }]);
  const [o] = project(g, { view: [0.2, -0.1, 1], up: [0.1, -1, 0] }).segments;
  const on = o.sections[0].near;
  assert.ok(near(Math.hypot(...on), 1), `oblique near [${on}]`);
  const oblique = crossContours(o, rng(2), 'oblique', { spacing: 0.5 });
  assert.ok(oblique.length >= 3, `${oblique.length} oblique marks`);
  const far = oblique.reduce((n, m) => n + m.points.filter((p) => dot2(off(p, centreAt(o, m.at)), on) < -1e-9).length, 0);
  assert.strictEqual(far, 0, 'oblique points on the far half');

  const calls = [];
  const gc = { beginPath() {}, moveTo(...p) { calls.push(p); }, lineTo(...p) { calls.push(p); }, closePath() {}, fill() {} };
  for (const m of [...marks, ...oblique, ...crossContours(tube(0), rng(1), 'flat'), ...crossContours(tube(Math.PI / 2), rng(1), 'end')]) {
    fill(gc, outline(m.points, m.width));
  }
  assert.ok(calls.length > 0 && calls.every((p) => p.every(Number.isFinite)), 'outline fills every mark');
});

// Andrew's monotone chain.
function hull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const turn = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const h = [];
    for (const q of list) {
      while (h.length >= 2 && turn(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop();
      h.push(q);
    }
    h.pop();
    return h;
  };
  return [...half(p), ...half(p.slice().reverse())];
}

test('cross-contours stay inside the segment\'s outline', () => {
  const N = 720;
  const grow = 1 / Math.cos(Math.PI / N);   // the sampled polygon then holds the ellipse
  let fails = 0, checked = 0, filled = 0, worst = '';
  for (const [radius, length] of [[[12, 8], 100], [[6, 10], 100], [[12, 12], 100], [[10, 4], 12]]) {
    for (const bend of [0, 0.4, Math.PI / 4, 1.2, Math.PI / 2]) {
      const seg = tube(bend, radius, length);
      const rim = [];
      for (const s of seg.sections) {
        const u = [Math.cos(s.angle), Math.sin(s.angle)];
        const v = Math.hypot(...s.near) > 0 ? s.near : [-u[1], u[0]];
        for (let i = 0; i < N; i++) {
          const th = (2 * Math.PI * i) / N;
          // 1e-9 more holds a filled mark that touches a flat end's line exactly.
          const x = (grow * s.major + 1e-9) * Math.cos(th); const y = (grow * s.minor + 1e-9) * Math.sin(th);
          rim.push([s.centre[0] + x * u[0] + y * v[0], s.centre[1] + x * u[1] + y * v[1]]);
        }
      }
      const shape = hull(rim);
      const marks = crossContours(seg, rng(3), `tube ${bend}`, { spacing: 8 });
      for (const m of marks) {
        for (const p of m.points) { checked++; if (!pointInPoly(p, shape)) fails++; }
        const c = centreAt(seg, m.at);
        const out = [c[0] + 1.05 * majorAt(seg, m.at) * Math.cos(seg.sections[0].angle), c[1] + 1.05 * majorAt(seg, m.at) * Math.sin(seg.sections[0].angle)];
        // End-on, or on a short sharp taper, the widest end holds the other sections.
        if (bend < Math.PI / 2 && length === 100) assert.ok(!pointInPoly(out, shape), `bend ${bend}, radius [${radius}]: a point past the rim reads as inside`);
      }
      // The filled mark, round cap and joins included, stays inside too; the
      // outline is convex, so its polygon's corners inside mean all of it is.
      for (const [width, at] of [[2], [4], [9], [4, [0, 0.01, 0.5, 0.99, 1]]]) {
        for (const m of crossContours(seg, rng(3), `wide ${bend}`, { spacing: 8, width, at })) {
          for (const p of outline(m.points, m.width)) {
            filled++;
            if (!pointInPoly(p, shape) && !worst) worst = `width ${width}, bend ${bend}, radius [${radius}], at ${m.at}: [${p}]`;
          }
        }
      }
    }
  }
  assert.ok(checked > 500, `${checked} points checked`);
  assert.strictEqual(fails, 0, `${fails} of ${checked} points outside the outline`);
  assert.ok(filled > 5000, `${filled} filled points checked`);
  assert.strictEqual(worst, '', `a filled mark leaves the outline: ${worst}`);
  // Only where the form cannot hold the width is it cut.
  const [wide] = crossContours(tube(Math.PI / 4), rng(3), 'cut', { at: [0.5], width: 4 });
  assert.strictEqual(wide.width(0), 4);
  const [end] = crossContours(tube(Math.PI / 4), rng(3), 'cut', { at: [0], width: 4 });
  assert.strictEqual(end.width(0), 0);
});

test('a segment seen end-on returns near-circular arcs', () => {
  const end = tube(Math.PI / 2);
  const marks = crossContours(end, rng(4), 'end');
  assert.ok(marks.length >= 1, 'no mark end-on');
  // Each arc is drawn in from the rim by half its width (default 2), a little
  // more for its joins.
  let bad = 0;
  for (const m of marks) {
    const c = centreAt(end, m.at); const M = majorAt(end, m.at);
    const r0 = Math.hypot(...off(m.points[0], c));
    assert.ok(r0 <= M - 1 && r0 > M - 1.1, `end-on arc radius ${r0} for section radius ${M}`);
    bad += m.points.filter((p) => Math.abs(Math.hypot(...off(p, c)) - r0) > 1e-9 * M).length;
  }
  assert.strictEqual(bad, 0, 'end-on points off the circle');
  // The whole circle shows end-on, so each mark starts at the rim point straight
  // away from the light and ends well round on the light's side.
  for (const light of [[0, 1], [0, -1], [1, 0], [-1, 1]]) {
    const l = Math.hypot(...light);
    for (const m of crossContours(end, rng(4), 'end', { light })) {
      const c = centreAt(end, m.at);
      const along = (p) => dot2(off(p, c), light) / l / Math.hypot(...off(p, c));
      const first = along(m.points[0]); const last = along(m.points[m.points.length - 1]);
      assert.ok(first < -0.98 && last > 0.5, `light [${light}], mark at ${m.at}: first ${first.toFixed(3)}, last ${last.toFixed(3)} along the light`);
    }
  }
  const almost = tube(Math.PI / 2 - 0.05);
  let wide = 0;
  for (const m of crossContours(almost, rng(4), 'almost', { spacing: 1 })) {
    const c = centreAt(almost, m.at); const M = majorAt(almost, m.at);
    const r = m.points.map((p) => Math.hypot(...off(p, c)));
    wide += r.filter((x) => x < 0.99 * Math.max(...r) || x > M).length;
  }
  assert.strictEqual(wide, 0, 'nearly end-on points outside 0.99 of the widest to M');
});

test('turning toward end-on, a cross-contour\'s first point moves smoothly into the end-on start', () => {
  // The angle of the first point and the turn from it to the middle point, round
  // the mark's centre.
  const shape = (seg, light) => {
    const [m] = crossContours(seg, rng(8), 'sweep', { light, at: [0.5] });
    const c = centreAt(seg, 0.5);
    const p = off(m.points[0], c), q = off(m.points[m.points.length >> 1], c);
    return { first: Math.atan2(p[1], p[0]), sense: Math.sign(p[0] * q[1] - p[1] * q[0]), m, c };
  };
  // Light from below the tube bent toward the viewer, and from above the one
  // bent away: either way the visible half faces away from the light. Under an
  // oblique light the open arc runs toward the major axis's end nearer the
  // light, so it turns the end-on arc's way only where [-light[1], light[0]],
  // where that arc heads, lies on the visible half; otherwise it turns the other
  // way, and the seeded start, up to 5 percent of a half turn, flips with it.
  // Within a tilt of 0.2 of end-on the start turns on to the darkest point,
  // onto the far half if it lies there, and an arc turning the other way
  // shrinks into its start and grows back the end-on arc's way.
  for (const [light, sign] of [[[0, 1], 1], [[0, -1], -1], [[-1, 1], 1], [[1, 1], 1]]) {
    const end = shape(tube(Math.PI / 2), light);
    const nv = tube(sign).sections[0].near;
    const same = dot2([-light[1], light[0]], nv) >= 0;
    let prev = null, worst = 0, at = '', far = 0;
    for (let bend = 1.2; bend < Math.PI / 2; bend += 0.01) {
      const seg = tube(sign * bend);
      const now = shape(seg, light);
      const step = prev === null ? 0 : Math.abs(Math.atan2(Math.sin(now.first - prev), Math.cos(now.first - prev)));
      if (step > worst) { worst = step; at = bend.toFixed(2); }
      prev = now.first;
      if (Math.cos(bend) < 0.2) continue;
      far += now.m.points.filter((p) => dot2(off(p, now.c), seg.sections[0].near) < -1e-9).length;
      assert.strictEqual(now.sense, same ? end.sense : -end.sense, `light [${light}], bend ${sign * bend}: turns ${same ? 'against' : 'with'} the end-on arc`);
    }
    const last = shape(tube(sign * (Math.PI / 2 - 1e-4)), light);
    const jump = Math.abs(Math.atan2(Math.sin(end.first - last.first), Math.cos(end.first - last.first)));
    assert.ok(worst < 0.1, `light [${light}]: the first point jumps ${worst.toFixed(3)} rad at bend ${at}`);
    assert.ok(jump < 1e-3, `light [${light}]: the first point jumps ${jump.toExponential(3)} rad into end-on`);
    assert.strictEqual(last.sense, end.sense, `light [${light}]: turns against the end-on arc next to end-on`);
    assert.strictEqual(far, 0, `light [${light}]: points on the far half`);
  }
  // Where the visible half faces the light, the start stays where the major
  // axis meets the rim, and a straight mark under a light along its segment
  // starts at +x, toward [light[1], -light[0]].
  for (const [seg, light] of [[tube(Math.PI / 4), [0, -1]], [tube(-Math.PI / 4), [0, 1]], [tube(0), [0, 1]]]) {
    const { first } = shape(seg, light);
    assert.ok(Math.cos(first) > 0.98 || Math.cos(first) < -0.98, `light [${light}]: first point at ${first.toFixed(3)} rad, off the major axis`);
  }
  assert.ok(Math.cos(shape(tube(0), [0, 1]).first) > 0.98, 'a straight mark under a light along its segment does not start at +x');
  // A light along the segment, level or upright, with rounding in its product
  // with the major axis or none: the mark's heavy end, its first point, stays
  // at the end toward [light[1], -light[0]] as the segment turns through the
  // picture plane, and where the visible half faces away from the light the
  // arc turns the end-on arc's way.
  const level = (forward) => (bend) => project(pose([0, 0, 0], { forward, side: [0, 1, 0] }, [{ length: 100, radius: [12, 8], bend }])).segments[0];
  for (const [make, light] of [[level([1, 0, 0]), [1, 0]], [level([-1, 0, 0]), [-1, 0]], [tube, [0, 1]], [tube, [0, -1]]]) {
    const heavy = [light[1], -light[0]];
    for (const bend of [-0.01, 0, 0.01]) {
      const { m, c } = shape(make(bend), light);
      const p = off(m.points[0], c);
      const toward = dot2(p, heavy) / Math.hypot(...p);
      assert.ok(toward > 0.98, `light [${light}], bend ${bend}: the first point lies ${toward.toFixed(3)} toward [${heavy}]`);
    }
    const end = shape(make(Math.PI / 2), light).sense;
    const away = [1.2, -1.2].filter((bend) => dot2(make(bend).sections[0].near, light) < 0);
    assert.strictEqual(away.length, 1, `light [${light}]: ${away.length} of bends 1.2 and -1.2 face away from the light`);
    assert.strictEqual(shape(make(away[0]), light).sense, end, `light [${light}], bend ${away[0]}: turns against the end-on arc`);
  }
});

test('with stop, every cross-contour ends on the shade side of its cutoff, and without it nothing changes', () => {
  const [low, high] = [0.05, 0.55];
  const eps = 1e-6;
  // The light on the section's surface under a point of a mark drawn at width
  // 0, on the rim: its normal against the unit light, in the picture plane. A
  // section is a circle round the axis, so that normal is the point's offset
  // from the centre over the radius, and its picture part the drawn offset over
  // the major, whatever the mark's opening.
  const lightAt = (seg, m, p, light) => dot2(off(p, centreAt(seg, m.at)), light) / Math.hypot(...light) / majorAt(seg, m.at);
  // The angle round the section of a point of a mark drawn at width 0, up to a
  // reflection that keeps the span's size, from the major axis, or from the
  // light where the segment is seen end-on.
  const angleAt = (seg, m, p, light) => {
    const s = seg.sections[0];
    const u = 1 - (Math.min(1, s.minor / s.major)) ** 2 < 1e-12 ? light.map((x) => x / Math.hypot(...light)) : [Math.cos(s.angle), Math.sin(s.angle)];
    const x = dot2(off(p, centreAt(seg, m.at)), u) / majorAt(seg, m.at);
    return Math.atan2(Math.sqrt(Math.max(0, 1 - x * x)), x);
  };
  const span = (seg, m, light) => Math.abs(angleAt(seg, m, m.points[m.points.length - 1], light) - angleAt(seg, m, m.points[0], light));
  // The brightest light anywhere round the mark's section, past its arc too:
  // the light at angle th is a cos th + b sin th, with a the part across the
  // major axis and b read off the arc point farthest from that axis.
  const peak = (seg, m, light) => {
    const p = m.points.reduce((q, r) => (Math.abs(angleAt(seg, m, r, light) - Math.PI / 2) < Math.abs(angleAt(seg, m, q, light) - Math.PI / 2) ? r : q));
    const th = angleAt(seg, m, p, light), s = seg.sections[0];
    const u = 1 - (Math.min(1, s.minor / s.major)) ** 2 < 1e-12 ? light.map((x) => x / Math.hypot(...light)) : [Math.cos(s.angle), Math.sin(s.angle)];
    const a = dot2(u, light) / Math.hypot(...light);
    return Math.hypot(a, (lightAt(seg, m, p, light) - a * Math.cos(th)) / Math.sin(th));
  };
  // Each mark's level is seeded on its own: R('stop', 'stop', i), i its index.
  const seeded = (i) => low + (high - low) * rng(11)('stop', 'stop', i);
  let checked = 0, pastHigh = 0, endsOutside = 0, offLevel = 0, eased = 0, uncut = 0, droppedLit = 0, oldPastHigh = 0;
  const ends = new Set();
  // A light along the segment drops marks whose first point is already lit.
  let dropped = 0;
  // A cut mark at width 2 keeps the share of its width that it keeps of its
  // span; `thin` counts the cut marks left under half their span.
  let widths = 0, wrongWidth = 0, thin = 0, overShare = 0;
  // With an eye each mark opens on its own, and so reaches its level elsewhere.
  for (const eye of [undefined, { at: [0, -200], focal: 150 }]) {
    for (const light of [[1, 0], [-1, -1], [0, -1]]) {
      let shortened = 0;
      for (const bend of [0, 0.3, 0.4, Math.PI / 4, 1.2, -Math.PI / 4, Math.PI / 2]) {
        const seg = tube(bend);
        const opts = { light, spacing: 6, width: 0, eye };
        const all = crossContours(seg, rng(11), 'stop', opts);
        const index = new Map(all.map((m, i) => [m.at, i]));
        const twins = new Map(all.map((m) => [m.at, m]));
        const levels = (m) => m.points.map((p) => lightAt(seg, m, p, light));
        for (const twin of twins.values()) {
          if (!eye && light[1] === 0 && bend === Math.PI / 4 && Math.max(...levels(twin)) > high + eps) oldPastHigh++;
        }
        const stopped = crossContours(seg, rng(11), 'stop', { ...opts, stop: [low, high] });
        const wide = new Map(crossContours(seg, rng(11), 'stop', { ...opts, width: 2 }).map((m) => [m.at, m]));
        const wideStopped = new Map(crossContours(seg, rng(11), 'stop', { ...opts, width: 2, stop: [low, high] }).map((m) => [m.at, m]));
        for (const m of stopped) {
          checked++;
          const twin = twins.get(m.at);
          const lv = levels(m), tw = levels(twin), own = seeded(index.get(m.at));
          // Where the section's light peaks less than 0.2 past the mark's level,
          // the cut eases in from the seeded end, and where the first point is
          // less than 0.2 short of it, the mark keeps only a share, so it may
          // end off the level, but never 0.2 past it.
          const full = peak(seg, twin, light) >= own + 0.2 + eps && tw[0] <= own - 0.2 - eps;
          pastHigh += lv.filter((x) => x > (full ? high : own + 0.2) + eps).length;
          const cut = m.points[m.points.length - 1].some((x, k) => Math.abs(x - twin.points[twin.points.length - 1][k]) > 1e-9);
          if (cut) shortened++;
          if (cut && !full && Math.abs(lv[lv.length - 1] - own) > eps) eased++;
          if (cut && full && (lv[lv.length - 1] < low - eps || lv[lv.length - 1] > high + eps)) endsOutside++;
          if (cut && full && Math.abs(lv[lv.length - 1] - own) > eps) offLevel++;
          if (cut) ends.add(lv[lv.length - 1].toFixed(3));
          if (!cut && Math.max(...tw) > high + eps) uncut++;
          // A cut mark is at most `width` times the share of its span it keeps
          // wide, and exactly that where the form holds the full width uncut.
          const share = span(seg, m, light) / span(seg, twin, light);
          if (wideStopped.get(m.at).width(0) > 2 * share + 1e-6) overShare++;
          if (wide.get(m.at).width(0) === 2) {
            widths++;
            if (cut && share < 0.5) thin++;
            if (Math.abs(wideStopped.get(m.at).width(0) - 2 * share) > 1e-6) wrongWidth++;
          }
          twins.delete(m.at);
        }
        // A mark dropped with stop was already lit to its own level at its first point.
        for (const twin of twins.values()) {
          dropped++;
          if (levels(twin)[0] < seeded(index.get(twin.at)) - eps) droppedLit++;
        }
      }
      assert.ok(shortened > 0, `light [${light}]${eye ? ' with an eye' : ''}: stop shortens no mark`);
    }
  }
  assert.ok(checked > 80, `${checked} stopped marks checked`);
  assert.ok(dropped > 0, 'stop drops no mark, so the drop rule goes unchecked');
  assert.ok(widths > 40 && thin > 0, `${widths} widths checked, ${thin} of them on marks cut under half their span`);
  assert.strictEqual(wrongWidth, 0, `${wrongWidth} of ${widths} cut marks keep a width other than their share of it`);
  assert.strictEqual(overShare, 0, `${overShare} of ${checked} stopped marks are wider than their share of the width`);
  assert.ok(oldPastHigh > 0, 'without stop, no mark under light [1, 0] reaches past the cutoff');
  assert.strictEqual(pastHigh, 0, `${pastHigh} points lit past ${high}`);
  assert.strictEqual(endsOutside, 0, `${endsOutside} cut marks end outside [${low}, ${high}]`);
  assert.strictEqual(offLevel, 0, `${offLevel} cut marks end off their seeded level`);
  assert.ok(eased > 0, 'no cut mark eases in, so the easing goes unchecked');
  assert.ok(ends.size > 5, `cut marks end at ${ends.size} levels, not one seeded per mark`);
  assert.strictEqual(uncut, 0, `${uncut} marks keep a seeded end that reaches past ${high}`);
  assert.strictEqual(droppedLit, 0, `${droppedLit} dropped marks start below ${low}`);
  // The default is unchanged, and stopped marks are seeded.
  const seg = tube(0.4);
  assert.strictEqual(JSON.stringify(crossContours(seg, rng(12), 'd').map((m) => m.points)),
    JSON.stringify(crossContours(seg, rng(12), 'd', { stop: undefined }).map((m) => m.points)), 'stop undefined changes the marks');
  assert.strictEqual(JSON.stringify(crossContours(seg, rng(12), 'd', { stop: [low, high] }).map((m) => m.points)),
    JSON.stringify(crossContours(seg, rng(12), 'd', { stop: [low, high] }).map((m) => m.points)), 'same R and name give other stopped marks');
});

test('a mark changes width, length and end point a little per step of a slow bend, through end-on too, with stop or without', () => {
  // Every step counts, the ones swinging the segment through end-on, where the
  // visible half flips sides, among them; a mark that would turn against the
  // end-on arc there shrinks into its start and grows back, so its end point
  // never jumps to its mirror image about the darkest point; a high range eases its cuts over
  // less light. A mark that appears or vanishes counts as a step from or to
  // nothing, and the last bends land exactly end-on, inside the 1e-6 tilt that
  // counts as end-on, beside ones just outside it. The `crossing` eye's level
  // crosses the segment within a tilt of 0.2 of end-on, where each mark's near
  // half flips sides, while its opening eases from there to the view's over
  // that tilt, so it changes fast but smoothly: it is swept in steps of
  // 0.0005 near end-on, where a flip still jumps and a smooth change does not.
  // A twisted joint bends the segment past end-on, within a tilt of 0.03 or
  // 0.08, so its picture direction swings round fast and through the light's,
  // where a mark's start end flips and it eases into its mirror image; those
  // passes are swept in steps of 0.0005 too. Twists of 0.15 and 0.18 pass by
  // the end-on zone's rim: they cross light [-1, -1] at a tilt of about 0.21
  // and light [1, 0] at about 0.18, just outside it and just inside.
  const at = Array.from({ length: 9 }, (_, k) => 0.1 + 0.1 * k);
  const length = (m) => (m ? m.points.reduce((s, p, k) => s + (k ? Math.hypot(p[0] - m.points[k - 1][0], p[1] - m.points[k - 1][1]) : 0), 0) : 0);
  const wide = (m) => (m ? m.width(0) : 0);
  const exact = [Math.PI / 2 - 3e-6, Math.PI / 2 - 1e-7, Math.PI / 2, Math.PI / 2 + 1e-7, Math.PI / 2 + 3e-6];
  const crossing = { at: [0, -1500], focal: 60 };
  const tip = (m) => m.points[m.points.length - 1];
  let steps = 0, endOn = 0, flips = 0, popped = 0, jumps = 0, worst = '', moves = 0, moved = '';
  for (const stop of [undefined, [0, 0.5], [0.85, 1]]) {
    for (const eye of [undefined, { at: [0, -200], focal: 150 }, crossing]) {
      for (const light of [[1, 0], [-1, -1], [0, -1], [0, 1]]) {
        for (const seed of [3, 7, 12]) {
          const runs = eye === crossing ? [-1, 1].map((side) => [0, Array.from({ length: 1001 }, (_, k) => side * Math.PI / 2 - 0.25 + 0.0005 * k)])
            : [[0, Array.from({ length: 1551 }, (_, k) => -3.1 + 0.004 * k)]];
          for (const twist of [0.03, -0.08, 0.15, 0.18]) for (const side of [-1, 1]) runs.push([twist, Array.from({ length: 801 }, (_, k) => side * Math.PI / 2 - 0.2 + 0.0005 * k)]);
          for (const [twist, run] of [...runs, [0, exact]]) {
            let prev = null, prevBend = 0;
            for (const bend of run) {
              const seg = twist ? project(pose([0, 0, 0], DOWN, [{ length: 100, radius: [12, 8], bend, twist }])).segments[0] : tube(bend);
              const now = new Map(crossContours(seg, rng(seed), 'x', { light, at, width: 3, eye, stop }).map((m) => [m.at, m]));
              if (prev) {
                for (const t of at) {
                  const p = prev.get(t), c = now.get(t);
                  if (!p && !c) continue;
                  steps++;
                  if (!p || !c) popped++;
                  if (Math.abs(Math.abs(bend) - Math.PI / 2) < 0.1) endOn++;
                  if (Math.sign(Math.abs(prevBend) - Math.PI / 2) !== Math.sign(Math.abs(bend) - Math.PI / 2)) flips++;
                  const dw = Math.abs(wide(p) - wide(c)), dl = Math.abs(length(p) - length(c));
                  if (dw > 0.3 || dl > 2) {
                    jumps++;
                    if (!worst) worst = `width ${wide(p).toFixed(3)} -> ${wide(c).toFixed(3)}, length ${length(p).toFixed(2)} -> ${length(c).toFixed(2)} at bend ${bend.toFixed(7)}, stop [${stop}], light [${light}], seed ${seed}, at ${t}${eye ? `, eye ${JSON.stringify(eye)}` : ''}`;
                  }
                  const de = p && c ? Math.hypot(tip(p)[0] - tip(c)[0], tip(p)[1] - tip(c)[1]) : 0;
                  if (de > 2.5) {
                    moves++;
                    if (!moved) moved = `${de.toFixed(2)} px at bend ${bend.toFixed(7)}, stop [${stop}], light [${light}], seed ${seed}, at ${t}${eye ? `, eye ${JSON.stringify(eye)}` : ''}`;
                  }
                }
              }
              prev = now;
              prevBend = bend;
            }
          }
        }
      }
    }
  }
  assert.ok(steps > 60000 && endOn > 3000 && flips > 50 && popped > 20, `${steps} steps checked, ${endOn} of them within 0.1 of end-on, ${flips} through it, ${popped} from or to nothing`);
  assert.strictEqual(jumps, 0, `${jumps} of ${steps} steps jump over 0.3 px wide or 2 px long, first ${worst}`);
  assert.strictEqual(moves, 0, `${moves} of ${steps} steps move a mark's end point over 2.5 px, first ${moved}`);
});

test('at a tilt of 0.2 or more, a mark easing into its mirror image keeps to the visible half', () => {
  // A still limb whose picture direction lies near the light's, either way
  // round and facing the light or away from it, with stop or without.
  const at = [0.1, 0.3, 0.5, 0.7, 0.9];
  let marks = 0, far = 0, first = '';
  for (let k = 0; k <= 15; k++) {
    for (const sign of [-1, 1]) {
      const seg = tube(sign * Math.acos(0.2 + 0.05 * k));
      for (let e = -15; e <= 15; e++) {
        for (const light of [[e / 100, 1], [e / 100, -1]]) {
          for (const stop of [undefined, [0, 0.5]]) {
            for (const m of crossContours(seg, rng(7), 'x', { light, at, width: 3, stop })) {
              marks++;
              const n = m.points.filter((p) => dot2(off(p, centreAt(seg, m.at)), seg.sections[0].near) < -1e-9).length;
              if (n && !first) first = `tilt ${(0.2 + 0.05 * k).toFixed(2)}, bend sign ${sign}, light [${light}], stop [${stop}], at ${m.at}`;
              far += n;
            }
          }
        }
      }
    }
  }
  assert.ok(marks > 15000, `${marks} marks checked`);
  assert.strictEqual(far, 0, `${far} points of ${marks} marks lie on the far half, first ${first}`);
});

test('with stop, a level above 0.8 still cuts its mark there at full light', () => {
  // Lying in the picture plane across the light, the section is fully lit at
  // the end of its major axis toward the light, and each mark's light runs
  // -cos th along its arc, so a cut mark ends on its own seeded level.
  const seg = tube(0);
  const at = Array.from({ length: 40 }, (_, k) => (k + 0.5) / 40);
  const free = crossContours(seg, rng(4), 'h', { light: [1, 0], at, width: 0 });
  const cutAt = crossContours(seg, rng(4), 'h', { light: [1, 0], at, width: 0, stop: [0.9, 1] });
  assert.strictEqual(cutAt.length, free.length, 'a mark with a level above 0.9 is dropped');
  let cut = 0, offLevel = 0;
  cutAt.forEach((m, k) => {
    const end = m.points[m.points.length - 1], twin = free[k].points[free[k].points.length - 1];
    if (Math.abs(end[0] - twin[0]) + Math.abs(end[1] - twin[1]) < 1e-9) return;
    cut++;
    const c = centreAt(seg, m.at);
    if (Math.abs((end[0] - c[0]) / majorAt(seg, m.at) - (0.9 + 0.1 * rng(4)('h', 'stop', k))) > 1e-6) offLevel++;
  });
  assert.ok(cut > 3, `${cut} of ${cutAt.length} marks cut`);
  assert.strictEqual(offLevel, 0, `${offLevel} of ${cut} cut marks end off their level`);
});

test('with an eye, cross-contours open with their distance from eye level and face the other way across it', () => {
  const at = [0.1, 0.3, 0.5, 0.7, 0.9];
  const eye = { at: [0, 50], focal: 200 };
  // The signed opening: the farthest point from the mark's centre along the
  // segment's picture direction, [0, 1] for these upright tubes.
  const openings = (seg, options) => crossContours(seg, rng(9), 'eye', { at, ...options }).map((m) => {
    const c = centreAt(seg, m.at);
    return m.points.map((p) => off(p, c)[1]).reduce((x, y) => (Math.abs(y) > Math.abs(x) ? y : x), 0);
  });
  const firstDiff = (x, y) => x.findIndex((v, i) => Math.abs(v - y[i]) > 1e-9);
  const distinct = (xs) => new Set(xs.map((x) => Math.round(x * 1e6))).size;

  // In the picture plane: straight without an eye, turning with one.
  const flat = tube(0, [12, 12]);
  const plain = openings(flat);
  assert.strictEqual(plain.filter((o) => Math.abs(o) > 1e-9).length, 0, `openings without an eye [${plain}]`);
  const o = openings(flat, { eye });
  assert.ok(Math.abs(o[2]) <= 1e-9, `the mark level with the eye opens ${o[2]}`);
  assert.ok(o[0] < 0 && o[1] < 0 && o[3] > 0 && o[4] > 0, `openings [${o}] do not face up above eye level and down below it`);
  assert.ok(Math.abs(o[0]) > Math.abs(o[1]), `openings [${o}] do not grow away from eye level`);
  assert.ok(distinct(o) >= 3, `${distinct(o)} distinct openings, first difference at ${firstDiff(o, o.map(() => o[0]))}`);

  // Tilted: without an eye every mark is the same ellipse for its size, as an
  // orthographic view shows a straight part; with one they differ. The ratio
  // of minor to major comes from two points of the arc, x² / A² + y² / B² = 1.
  const ratios = (seg, options) => crossContours(seg, rng(9), 'eye', { at, ...options }).map((m) => {
    const c = centreAt(seg, m.at);
    const [[x1, y1], [x2, y2]] = [m.points[0], m.points[m.points.length >> 1]].map((p) => off(p, c).map((v) => v * v));
    return Math.sqrt((y2 - y1) / (x1 - x2));
  });
  const tilted = tube(0.4, [12, 8]);
  const per = ratios(tilted);
  assert.strictEqual(distinct(per), 1, `${distinct(per)} distinct ratios without an eye, first difference at ${firstDiff(per, per.map(() => per[0]))}`);
  assert.ok(Math.abs(per[0] - Math.sin(0.4)) < 1e-6, `ratio ${per[0]} without an eye, not sin 0.4`);
  const seen = ratios(tilted, { eye });
  assert.ok(distinct(seen) >= 4, `${distinct(seen)} distinct ratios with an eye, first difference at ${firstDiff(seen, seen.map(() => seen[0]))}`);

  // Every point lies within its own section, of minor the mark's opening, on
  // the side that faces the eye.
  let bad = 0;
  for (const seg of [flat, tilted, tube(-0.4, [12, 8])]) {
    for (const m of crossContours(seg, rng(9), 'eye', { at, eye, width: 3 })) {
      const c = centreAt(seg, m.at), M = majorAt(seg, m.at);
      const w = [c[0] - eye.at[0], c[1] - eye.at[1], eye.focal];
      const n = Math.hypot(...seg.sections[0].near) > 0 ? Math.sign(seg.sections[0].near[1]) : 0;
      const f = [0, Math.hypot(...off(seg.b, seg.a)) > 0 ? Math.sqrt(Math.max(0, 1 - (seg.sections[0].minor / seg.sections[0].major) ** 2)) : 0, n * seg.sections[0].minor / seg.sections[0].major];
      const sw = (f[1] * w[1] + f[2] * w[2]) / Math.hypot(...w);
      const r = Math.min(1, Math.abs(sw));
      for (const p of m.points) {
        const [x, y] = off(p, c);
        if ((x / M) ** 2 + (r > 0 ? (y / (M * r)) ** 2 : 0) > 1 + 1e-9 || (r === 0 ? Math.abs(y) > 1e-9 : y * Math.sign(sw) < -1e-9)) bad++;
      }
    }
  }
  assert.strictEqual(bad, 0, `${bad} points outside their section or on its far half`);

  // Seen end-on, an eye changes nothing.
  const end = tube(Math.PI / 2);
  assert.strictEqual(JSON.stringify(crossContours(end, rng(9), 'e', { eye }).map((m) => m.points)),
    JSON.stringify(crossContours(end, rng(9), 'e').map((m) => m.points)), 'end-on marks change with an eye');
});

test('the cross-contour count scales with the segment\'s screen size and the marks are seeded', () => {
  assert.strictEqual(crossContours(tube(0, [3, 3], 20), rng(5), 'short', { spacing: 10 }).length, 2);
  assert.strictEqual(crossContours(tube(0, [3, 3], 200), rng(5), 'long', { spacing: 10 }).length, 20);
  const seg = tube(0.5);
  const firstDiff = (x, y) => {
    if (x.length !== y.length) return `counts ${x.length} and ${y.length}`;
    return x.findIndex((m, i) => JSON.stringify(m.points) !== JSON.stringify(y[i].points));
  };
  assert.strictEqual(firstDiff(crossContours(seg, rng(6), 'a'), crossContours(seg, rng(6), 'a')), -1, 'same R and name differ');
  assert.notStrictEqual(firstDiff(crossContours(seg, rng(6), 'a'), crossContours(seg, rng(6), 'b')), -1, 'another name gives the same marks');
  const one = crossContours(seg, rng(6), 'a', { at: [0.5] });
  assert.strictEqual(one.length, 1);
  assert.strictEqual(one[0].at, 0.5);
  assert.strictEqual(one[0].width(0), 2);
  assert.strictEqual(one[0].width(1), 0);
  for (const m of crossContours(seg, rng(6), 'a')) assert.ok(m.at > 0 && m.at < 1, `at ${m.at} not inside the segment`);
});

test('crossContours refuses bad input by name', () => {
  const seg = tube(0.5);
  const R = rng(7);
  for (const [what, fn] of [
    ['non-function R', () => crossContours(seg, 7, 'x')],
    ['empty at', () => crossContours(seg, R, 'x', { at: [] })],
    ['at 1.5', () => crossContours(seg, R, 'x', { at: [1.5] })],
    ['zero light', () => crossContours(seg, R, 'x', { light: [0, 0] })],
    ['spacing 0', () => crossContours(seg, R, 'x', { spacing: 0 })],
    ['negative width', () => crossContours(seg, R, 'x', { width: -1 })],
    ['no sections', () => crossContours({ a: [0, 0], b: [1, 1] }, R, 'x')],
    ['name not a string', () => crossContours(seg, R, 3)],
    ['bad eye', () => crossContours(seg, R, 'x', { eye: { at: [0, 0], focal: 0 } })],
    ['eye without at', () => crossContours(seg, R, 'x', { eye: { focal: 100 } })],
    ['eye not an object', () => crossContours(seg, R, 'x', { eye: 5 })],
    ['stop reversed', () => crossContours(seg, R, 'x', { stop: [0.6, 0.2] })],
    ['stop above 1', () => crossContours(seg, R, 'x', { stop: [0, 2] })],
    ['stop not a pair', () => crossContours(seg, R, 'x', { stop: 0.3 })],
  ]) {
    assert.match(grab(fn).message, /^crossContours: /, what);
  }
});

// --- growing a path ----------------------------------------------------------

const ELL = [[0, 0], [10, 0], [10, 10]];
const samePts = (got, want) => got.length === want.length
  && got.every((p, i) => near(p[0], want[i][0]) && near(p[1], want[i][1]));

test('grow cuts the path at a length and reports the tip and its heading', () => {
  const g = grow(ELL, 15);
  assert.ok(samePts(g.points, [[0, 0], [10, 0], [10, 5]]), JSON.stringify(g.points));
  assert.ok(samePts([g.tip], [[10, 5]]));
  assert.ok(near(g.heading, Math.PI / 2));
  assert.strictEqual(g.total, 20);
});

test('grow at 0 and on a point adds no duplicate, and clamps outside the path', () => {
  const zero = grow(ELL, 0);
  assert.ok(samePts(zero.points, [[0, 0]]));
  assert.strictEqual(zero.heading, 0);
  const vertex = grow(ELL, 10);
  assert.ok(samePts(vertex.points, [[0, 0], [10, 0]]), JSON.stringify(vertex.points));
  assert.strictEqual(vertex.heading, 0, 'on a point, the heading of the segment that arrives there');
  assert.deepStrictEqual(grow(ELL, -5), zero);
  for (const length of [999, Infinity]) {
    const all = grow(ELL, length);
    assert.ok(samePts(all.points, ELL), String(length));
    assert.ok(samePts([all.tip], [[10, 10]]));
    assert.ok(near(all.heading, Math.PI / 2));
  }
  assert.ok(near(grow([[0, 0], [0, 10]], 0).heading, Math.PI / 2), 'at 0, the first segment');
  // A length too small to move off a point in floating point adds no copy of it.
  assert.strictEqual(grow([[500, 500], [600, 500]], 1e-14).points.length, 1);
  assert.strictEqual(grow([[1000, 1000], [1001, 1000], [1001, 1100]], 1 + 1e-14).points.length, 2);
});

test('grow returns the clamped length, so the documented width recipe survives a finished stroke', () => {
  const line = [[0, 0], [40, 0], [40, 30]];
  const width = (d) => 1 + 2 * Math.sin(Math.PI * d / 70);
  assert.strictEqual(grow(line, 55).length, 55);
  assert.strictEqual(grow(line, -5).length, 0);
  for (const drawn of [100, Infinity]) {
    const { points, length, total } = grow(line, drawn);
    assert.strictEqual(length, 70, String(drawn));
    assert.strictEqual(total, 70);
    assert.ok(outline(points, (u) => width(u * length)).length > 0, String(drawn));
  }
});

test('grow with close walks the closing edge too', () => {
  const g = grow(SQUARE, 14, true);
  assert.ok(samePts([g.tip], [[0, 2]]), JSON.stringify(g.tip));
  assert.ok(near(g.heading, -Math.PI / 2));
  assert.strictEqual(g.total, 16);
  assert.strictEqual(grow(SQUARE, 14).total, 12);
});

test('grow skips zero-length segments and never returns NaN', () => {
  const g = grow([[0, 0], [0, 0], [5, 0]], 0);
  assert.strictEqual(g.heading, 0);
  const one = grow([[1, 1]], 3);
  assert.ok(samePts(one.points, [[1, 1]]));
  assert.strictEqual(one.heading, 0);
  assert.strictEqual(one.total, 0);
  for (const r of [g, one, grow([[2, 2], [2, 2]], 1)]) {
    assert.ok([...r.points.flat(), ...r.tip, r.heading, r.total].every(Number.isFinite));
  }
});

test('a grown path is a prefix: the part already drawn does not move', () => {
  const curve = resample(catmullRom([[0, 0], [30, 40], [70, -10], [100, 30]]), 1.7);
  const total = lengthOf(curve);
  for (const [a, b] of [[0, 5], [3.3, 50], [40, total - 0.1], [12, Infinity]]) {
    const short = grow(curve, a).points; const long = grow(curve, b).points;
    assert.ok(short.length <= long.length, `${a} vs ${b}`);
    const bad = short.slice(0, -1).findIndex((p, i) => p[0] !== long[i][0] || p[1] !== long[i][1]);
    assert.strictEqual(bad, -1, `${a} vs ${b}: first differing point ${bad}`);
  }
});

test('grow returns new arrays and leaves its input alone', () => {
  const pts = ELL.map((p) => [...p]);
  const g = grow(pts, 15);
  g.points[0][0] = 99; g.points[1][1] = 99; g.tip[0] = 99;
  assert.deepStrictEqual(pts, ELL);
  const all = grow(pts, Infinity);
  assert.ok(all.points.every((p, i) => p !== pts[i]));
});

test('grow refuses bad input by name', () => {
  for (const [what, fn] of [
    ['no points', () => grow([], 1)],
    ['missing points', () => grow(undefined, 1)],
    ['NaN length', () => grow(ELL, NaN)],
    ['string length', () => grow(ELL, '3')],
  ]) {
    assert.match(grab(fn).message, /^grow: /, what);
  }
});

// Shewchuk's experiment: points one ulp apart near a degenerate case, answered
// against exact BigInt arithmetic. Plain double predicates got 2,841 of 16,384
// segment answers and 21 of 16,256 point answers wrong on this grid.
test('near-degenerate segments and points get the exact answer', () => {
  const P = (p) => p.map((x) => BigInt(x * 2 ** 53));
  const sign = (v) => (v > 0n ? 1 : v < 0n ? -1 : 0);
  const orient = (a, b, c) => sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  const between = (u, v, w) => (u <= w ? u <= v && v <= w : w <= v && v <= u);
  const onSeg = (a, b, p) => between(a[0], p[0], b[0]) && between(a[1], p[1], b[1]);
  const meets = (a, b, c, d) => {
    [a, b, c, d] = [a, b, c, d].map(P);
    const o1 = orient(a, b, c); const o2 = orient(a, b, d); const o3 = orient(c, d, a); const o4 = orient(c, d, b);
    return (o1 * o2 < 0 && o3 * o4 < 0) || (o1 === 0 && onSeg(a, b, c)) || (o2 === 0 && onSeg(a, b, d))
      || (o3 === 0 && onSeg(c, d, a)) || (o4 === 0 && onSeg(c, d, b));
  };
  const ulp = 2 ** -53;
  const N = 128;
  const tri = [[0.5, 0.5], [24, 24], [24, 0.5]];
  const [ta, tb] = [P(tri[0]), P(tri[1])];
  let segWrong = 0; let polyWrong = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const p = [0.5 + i * ulp, 0.5 + j * ulp];
      if ((segmentIntersection(p, [24, 24], [12, 12], [13, 11]) !== null) !== meets(p, [24, 24], [12, 12], [13, 11])) segWrong++;
      const q = [12 + (i - N / 2) * 16 * ulp, 12 + (j - N / 2) * 16 * ulp];
      const side = orient(ta, tb, P(q));
      // Inside the triangle near its diagonal means right of it; on it, no promise.
      if (side !== 0 && pointInPoly(q, tri) !== (side < 0)) polyWrong++;
    }
  }
  assert.equal(segWrong, 0, 'segmentIntersection answers wrong');
  assert.equal(polyWrong, 0, 'pointInPoly answers wrong');
});

const { triangulate, delaunay, voronoi } = require('../core/mesh.js');
const areaOf = (pts) => {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return a / 2;
};
const seeded = (n, seed) => {
  const R = rng(seed);
  return Array.from({ length: n }, (_, i) => [R('point', 'x', i) * 100, R('point', 'y', i) * 100]);
};

// An L with a square hole: a triangulation that ignores the hole, or spills
// past the notch, gets the area wrong or puts a triangle outside the shape.
test('triangulate covers a concave polygon with a hole exactly, and nothing else', () => {
  const outer = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]];
  const hole = [[1, 1], [3, 1], [3, 3], [1, 3]];
  const tris = triangulate(outer, [hole]);
  const total = tris.reduce((s, t) => s + Math.abs(areaOf(t)), 0);
  assert.equal(total, Math.abs(areaOf(outer)) - Math.abs(areaOf(hole)));
  for (const t of tris) {
    const c = [(t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3];
    assert.ok(pointInPoly(c, outer) && !pointInPoly(c, hole), `triangle at ${c} is outside the shape`);
  }
  tris[0][0][0] = 99;
  assert.ok(outer.every((p) => p[0] !== 99) && hole.every((p) => p[0] !== 99), 'triangles alias the input');
});

test('delaunay: no point inside any circumcircle, the hull in order, repeats and lines left out', () => {
  const pts = seeded(400, 3);
  const { triangles, hull } = delaunay(pts);
  // Euler: a triangulation of n points with h on the hull has 2n - h - 2 triangles.
  assert.equal(triangles.length, 2 * pts.length - hull.length - 2);
  let bad = 0;
  for (const [i, j, k] of triangles) {
    const [a, b, c] = [pts[i], pts[j], pts[k]];
    const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
    const ux = ((a[0] ** 2 + a[1] ** 2) * (b[1] - c[1]) + (b[0] ** 2 + b[1] ** 2) * (c[1] - a[1]) + (c[0] ** 2 + c[1] ** 2) * (a[1] - b[1])) / d;
    const uy = ((a[0] ** 2 + a[1] ** 2) * (c[0] - b[0]) + (b[0] ** 2 + b[1] ** 2) * (a[0] - c[0]) + (c[0] ** 2 + c[1] ** 2) * (b[0] - a[0])) / d;
    const r = Math.hypot(a[0] - ux, a[1] - uy);
    for (let m = 0; m < pts.length; m++) {
      if (m !== i && m !== j && m !== k && Math.hypot(pts[m][0] - ux, pts[m][1] - uy) < r * (1 - 1e-9)) bad++;
    }
  }
  assert.equal(bad, 0, 'points inside a circumcircle');
  for (let h = 0; h < hull.length; h++) {
    const [p, q] = [pts[hull[h]], pts[hull[(h + 1) % hull.length]]];
    assert.ok(pts.every((s) => (q[0] - p[0]) * (s[1] - p[1]) - (q[1] - p[1]) * (s[0] - p[0]) <= 1e-9), 'a point lies outside a hull edge');
  }
  const twice = delaunay([[0, 0], [4, 0], [0, 4], [0, 0]]);
  assert.ok(twice.triangles.every((t) => !(t.includes(0) && t.includes(3))), 'a repeated point is used twice');
  assert.deepEqual(delaunay([[0, 0], [1, 1], [2, 2]]).triangles, []);
  assert.deepEqual(delaunay([]), { triangles: [], hull: [] });
});

test('voronoi cells tile the bounds, hold their own point, and are nearest to it', () => {
  const pts = seeded(60, 5);
  const cells = voronoi(pts, [0, 0, 100, 100]);
  assert.equal(cells.length, pts.length);
  let area = 0;
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const [f, l] = [cell[0], cell[cell.length - 1]];
    assert.ok(f[0] !== l[0] || f[1] !== l[1], 'the closing point is repeated');
    assert.ok(pointInPoly(pts[i], cell), `cell ${i} does not hold its point`);
    const c = centroid(cell);
    const near = pts.reduce((b, p, m) => (Math.hypot(p[0] - c[0], p[1] - c[1]) < Math.hypot(pts[b][0] - c[0], pts[b][1] - c[1]) ? m : b), 0);
    assert.equal(near, i, `cell ${i} is nearer another point`);
    area += Math.abs(areaOf(cell));
  }
  assert.ok(Math.abs(area - 10000) < 1e-6, `cells cover ${area} of 10000`);
  assert.deepEqual(voronoi([[5, 5], [5, 5], [8, 1]], [0, 0, 10, 10])[1], []);
});

test('triangulate, delaunay and voronoi refuse bad input by name', () => {
  for (const [fn, re] of [
    [() => triangulate([[0, 0], [1, 0]]), /^triangulate: /],
    [() => triangulate([[0, 0], [1, 0], [0, NaN]]), /^geometry: /],
    [() => triangulate([[0, 0], [1, 0], [0, 1]], 'hole'), /^triangulate: /],
    [() => delaunay('points'), /^delaunay: /],
    [() => voronoi([[0, 0]], [0, 0, 0, 1]), /^voronoi: /],
    [() => voronoi([[0, 0]]), /^voronoi: /],
  ]) assert.throws(fn, (e) => re.test(e.message));
});

const clip = require('../core/clip.js');
const totalArea = (rings) => rings.reduce((s, r) => s + areaOf(r), 0);
const seededStar = (seed, cx, cy) => {
  const R = rng(seed);
  const k = 5 + Math.floor(R('star', 'points') * 4);
  return Array.from({ length: 2 * k }, (_, i) => {
    const r = i % 2 ? 15 + R('star', 'inner', i) * 10 : 40 + R('star', 'outer', i) * 15;
    const a = (i * Math.PI) / k + R('star', 'turn') * 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
};

const { pointIndex, innerCircle, poissonDisk } = require('../core/spatial.js');
// Index of the first place two index lists differ, or -1: a failure stays one line.
const firstDiff = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return i;
  return -1;
};

test('pointIndex: within(p, r) matches a scan of every point, edge distance included', () => {
  const pts = seeded(3000, 11);
  // Lattice points too, so some lie at exactly r: 3-4-5 from the query below.
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) pts.push([i * 10, j * 10]);
  const index = pointIndex(pts);
  const R = rng(12);
  const queries = Array.from({ length: 300 }, (_, i) => [[R('q', 'x', i) * 120 - 10, R('q', 'y', i) * 120 - 10], R('q', 'r', i) * 20]);
  queries.push([[20, 10], 50], [[50, 50], 0], [[-500, -500], 3]);
  let wrong = 0;
  let first = '';
  for (const [p, r] of queries) {
    const got = index.within(p, r);
    const want = [];
    pts.forEach((s, i) => { if ((s[0] - p[0]) ** 2 + (s[1] - p[1]) ** 2 <= r * r) want.push(i); });
    const at = firstDiff(got, want);
    if (at !== -1 && !wrong++) first = `[${p}] r ${r}: ${got.length} found, ${want.length} expected, first differs at ${at}`;
  }
  assert.equal(wrong, 0, first);
  assert.ok(index.within([20, 10], 50).includes(pts.length - 121 + 5 * 11 + 5), 'a point at exactly r is left out');
  assert.deepEqual(pointIndex([]).within([0, 0], 10), []);
});

// The largest inner circle by brute force: the best signed edge distance over
// a fine grid. The true best lies within half a grid diagonal above it.
const clearance = (p, rings) => {
  let d = Infinity;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) d = Math.min(d, closestPointOnSegment(p, ring[i], ring[(i + 1) % ring.length]).distance);
  }
  const inside = pointInPoly(p, rings[0]) && !rings.slice(1).some((h) => pointInPoly(p, h));
  return inside ? d : -d;
};
const bestOnGrid = (rings, step) => {
  const [x0, y0, x1, y1] = bbox(rings[0]);
  let best = -Infinity;
  for (let x = x0; x <= x1; x += step) for (let y = y0; y <= y1; y += step) best = Math.max(best, clearance([x, y], rings));
  return best;
};

test('innerCircle finds the largest circle inside a seeded star and a shape with a hole, within its precision', () => {
  const step = 0.25;
  const slack = (step * Math.SQRT2) / 2;
  for (const [outer, holes] of [
    [seededStar(4, 60, 60), []],
    [seededStar(9, 0, 0), []],
    [[[0, 0], [100, 0], [100, 60], [0, 60]], [[[20, 10], [50, 10], [50, 50], [20, 50]]]],
  ]) {
    const precision = 0.5;
    const { centre, radius } = innerCircle(outer, holes, precision);
    const best = bestOnGrid([outer, ...holes], step);
    assert.ok(Math.abs(clearance(centre, [outer, ...holes]) - radius) < 1e-9, `radius ${radius} is not the centre's clearance`);
    assert.ok(radius >= best - precision, `radius ${radius} falls short of the grid's best ${best}`);
    assert.ok(radius <= best + slack, `radius ${radius} beats the largest possible, about ${best}`);
  }
  // The hole's right side leaves a 50-wide band: the circle sits in it, radius 25.
  const { centre, radius } = innerCircle([[0, 0], [100, 0], [100, 60], [0, 60]], [[[20, 10], [50, 10], [50, 50], [20, 50]]], 0.01);
  assert.ok(Math.abs(radius - 25) <= 0.01 && centre[0] > 50, `circle at [${centre}] radius ${radius}`);
});

test('poissonDisk: the same seed gives the same points, spaced exactly radius apart at least, all inside', () => {
  const bounds = [10, -20, 210, 130];
  const a = poissonDisk(rng(5), 'dots', bounds, 8);
  const b = poissonDisk(rng(5), 'dots', bounds, 8);
  const flat = (pts) => pts.flat();
  assert.ok(a.length > 300, `${a.length} points`);
  assert.equal(firstDiff(flat(a), flat(b)), -1, 'the same seed gave different points');
  assert.notEqual(firstDiff(flat(a), flat(poissonDisk(rng(6), 'dots', bounds, 8))), -1, 'another seed gave the same points');
  assert.notEqual(firstDiff(flat(a), flat(poissonDisk(rng(5), 'other', bounds, 8))), -1, 'another name gave the same points');
  let min = Infinity;
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) min = Math.min(min, Math.hypot(a[i][0] - a[j][0], a[i][1] - a[j][1]));
  assert.ok(min >= 8 * (1 - 1e-12) && min < 8 * (1 + 1e-9), `closest pair ${min} apart, radius 8`);
  const out = a.filter(([x, y]) => !(x >= 10 && x <= 210 && y >= -20 && y <= 130)).length;
  assert.equal(out, 0, 'points outside the bounds');
  // Filled: no spot in the bounds is 2 radii from every point.
  const index = pointIndex(a);
  let gaps = 0;
  for (let x = 10; x < 210; x += 2) for (let y = -20; y < 130; y += 2) if (index.within([x, y], 16).length === 0) gaps++;
  assert.equal(gaps, 0, 'a spot 2 radii from every point');
});

test('poissonDisk draws only from R(name, poissonDisk, i), i counting from 0', () => {
  const R = rng(1);
  const seen = [];
  const pts = poissonDisk((e, p, i) => { seen.push([e, p, i]); return R(e, p, i); }, 'grain', [0, 0, 50, 50], 5);
  assert.ok(pts.length > 20);
  assert.ok(seen.every(([e, p, i], k) => e === 'grain' && p === 'poissonDisk' && i === k), 'a draw from another address');
});

test('pointIndex, innerCircle and poissonDisk refuse bad input by name', () => {
  const R = rng(1);
  for (const [fn, re] of [
    [() => pointIndex('points'), /^pointIndex: /],
    [() => pointIndex([[0, NaN]]), /^geometry: /],
    [() => pointIndex([[0, 0]]).within([0, 0], -1), /^pointIndex: /],
    [() => pointIndex([[0, 0]]).within([0], 1), /^geometry: /],
    [() => innerCircle([[0, 0], [1, 0]]), /^innerCircle: /],
    [() => innerCircle([[0, 0], [1, 0], [0, 1]], 'hole'), /^innerCircle: /],
    [() => innerCircle([[0, 0], [1, 0], [0, 1]], [], 0), /^innerCircle: /],
    [() => poissonDisk(null, 'a', [0, 0, 1, 1], 1), /^poissonDisk: /],
    [() => poissonDisk(R, 7, [0, 0, 1, 1], 1), /^poissonDisk: /],
    [() => poissonDisk(R, 'a', [0, 0, 0, 1], 1), /^poissonDisk: /],
    [() => poissonDisk(R, 'a', [0, 0, 1, 1], 0), /^poissonDisk: /],
    [() => poissonDisk(R, 'a', [0, 0, 1e4, 1e4], 1), /^poissonDisk: radius .*too small/],
  ]) assert.throws(fn, (e) => re.test(e.message));
});
// Proper crossings between a ring's own edges; edges that share a vertex are skipped.
const selfCrossings = (pts, closed) => {
  const n = pts.length; const m = closed ? n : n - 1;
  let k = 0;
  for (let i = 0; i < m; i++) {
    for (let j = i + 2; j < m; j++) {
      if (closed && i === 0 && j === n - 1) continue;
      if (segmentIntersection(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) k++;
    }
  }
  return k;
};
const distanceTo = (p, pts, closed) => {
  let d = Infinity;
  const m = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < m; i++) d = Math.min(d, closestPointOnSegment(p, pts[i], pts[(i + 1) % pts.length]).distance);
  return d;
};

// Areas measured on the 1/1000 grid: the only error left is the rounding of
// each vertex, well under a thousandth of the stars' area.
test('union, intersection, difference and xor of two seeded stars keep the area identities', () => {
  for (const seed of [1, 2, 3]) {
    const a = seededStar(seed, 60, 60); const b = seededStar(seed + 100, 85, 70);
    const [A, B] = [areaOf(a), areaOf(b)];
    const u = totalArea(clip.union(a, b)); const i = totalArea(clip.intersection(a, b));
    const d = totalArea(clip.difference(a, b)); const x = totalArea(clip.xor(a, b));
    assert.ok(i > 50 && i < Math.min(A, B) - 50, `seed ${seed}: the stars must overlap in part, got ${i}`);
    const tol = (A + B) * 1e-5;
    assert.ok(Math.abs(u - (A + B - i)) < tol, `seed ${seed}: union ${u} vs ${A + B - i}`);
    assert.ok(Math.abs(d - (A - i)) < tol, `seed ${seed}: difference ${d} vs ${A - i}`);
    assert.ok(Math.abs(x - (u - i)) < tol, `seed ${seed}: xor ${x} vs ${u - i}`);
  }
});

test('a difference that cuts a hole returns the hole wound the other way, and fill picks the regions', () => {
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const hole = [[3, 3], [7, 3], [7, 7], [3, 7]];
  const ring = clip.difference(square, hole);
  assert.deepEqual(ring.map(areaOf).sort((p, q) => p - q), [-16, 100]);
  const right = [[5, 0], [15, 0], [15, 10], [5, 10]];
  assert.equal(totalArea(clip.union([square, right])), 150);
  assert.equal(totalArea(clip.union([square, right], [], { fill: 'evenodd' })), 100);
  assert.equal(totalArea(clip.intersection(square, right, { scale: 1 })), 50);
  assert.deepEqual(clip.intersection(square, [[20, 20], [30, 20], [30, 30]]), []);
  assert.deepEqual(clip.union([]), []);
});

test('boolean results repeat no point, even from input that repeats its points', () => {
  const twice = [[0, 0], [0, 0], [10, 0], [10, 10], [10, 10], [0, 10], [0, 0]];
  const results = [clip.union(twice), clip.difference(twice, [[3, 3], [7, 3], [7, 7], [3, 7]]), clip.offset(twice, -2), clip.offset(twice, 2)];
  assert.deepEqual(results.map(totalArea), [100, 84, 36, 196]);
  // A repeated point would be read as an edge of no length and bend the joins.
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const sameArea = (a, b, what) => assert.ok(near(totalArea(a), totalArea(b), 1e-6), `${what}: ${totalArea(a)} vs ${totalArea(b)}`);
  for (const join of ['miter', 'square', 'bevel']) sameArea(clip.offset([...square, [0, 0]], 1, { join }), clip.offset(square, 1, { join }), `closing point repeated, ${join}`);
  for (const [join, end] of [['miter', 'butt'], ['round', 'round'], ['square', 'square']]) {
    const opts = { closed: false, join, end };
    sameArea(clip.offset([[0, 0], [10, 0], [10, 0], [10, 10]], 1, opts), clip.offset([[0, 0], [10, 0], [10, 10]], 1, opts), `open line, ${join}/${end}`);
  }
  let repeats = 0;
  for (const rings of results) {
    for (const r of rings) r.forEach((p, i) => { const q = r[(i + 1) % r.length]; if (p[0] === q[0] && p[1] === q[1]) repeats++; });
  }
  assert.equal(repeats, 0, 'consecutive repeated points');
});

test('closed offsets grow, shrink and round a shape by the distance', () => {
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.equal(totalArea(clip.offset(square, 1)), 144);
  assert.equal(totalArea(clip.offset(square, -1)), 64);
  assert.ok(near(totalArea(clip.offset(square, 1, { join: 'round' })), 140 + Math.PI, 0.01));
  assert.deepEqual(clip.offset(square, -6), [], 'a shape thinner than twice the distance disappears');
  const star = seededStar(4, 0, 0);
  for (const d of [3, -3]) {
    const out = clip.offset(star, d, { join: 'round' });
    assert.equal(out.length, 1);
    let off = 0;
    for (const p of out[0]) if (Math.abs(distanceTo(p, star, true) - Math.abs(d)) > 0.01 || pointInPoly(p, star) !== d < 0) off++;
    assert.equal(off, 0, `distance ${d}: points not ${Math.abs(d)} away on the right side`);
    assert.equal(selfCrossings(out[0], true), 0);
  }
});

test('closed offsets merge their rings by fill first, so winding does not matter', () => {
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const sorted = (rings) => rings.map(areaOf).sort((p, q) => p - q);
  assert.deepEqual(sorted(clip.offset([...square].reverse(), 1)), [144]);
  assert.deepEqual(sorted(clip.offset([square, [[50, 50], [60, 50], [60, 60], [50, 60]].reverse()], 1)), [144, 144]);
  assert.deepEqual(sorted(clip.offset([...square].reverse(), 0)), [100], 'distance 0 returns the merged outline');
  const outer = [[0, 0], [20, 0], [20, 20], [0, 20]]; const hole = [[7, 7], [13, 7], [13, 13], [7, 13]];
  assert.deepEqual(sorted(clip.offset([outer, hole], 1, { fill: 'evenodd' })), [-16, 484], 'a hole wound like its outer ring');
  assert.deepEqual(sorted(clip.offset([outer, hole], 1)), [484]);
});

// The zigzag turns tighter than the distance, so offsetPolyline's one-sided
// offset folds through itself; the band round it merges into one clean outline.
test('the band round a tight zigzag has no self-crossings where offsetPolyline folds', () => {
  const zig = Array.from({ length: 21 }, (_, i) => [10 + i * 6, i % 2 ? 40 : 10]);
  for (const d of [4, 8]) {
    assert.ok(selfCrossings(offsetPolyline(zig, d), false) > 5, `distance ${d}: the one-sided offset should fold`);
    for (const [join, end] of [['miter', 'butt'], ['round', 'round'], ['square', 'square']]) {
      const band = clip.offset(zig, d, { closed: false, join, end });
      assert.equal(band.length, 1, `${d} ${join}/${end}: one outline`);
      assert.equal(selfCrossings(band[0], true), 0, `${d} ${join}/${end}: self-crossings`);
      // A butt end runs through the end points, so only the inner points are tested.
      assert.ok(zig.slice(1, -1).every((p) => pointInPoly(p, band[0])), `${d} ${join}/${end}: the line leaves its band`);
    }
  }
  const round = clip.offset(zig, 4, { closed: false, join: 'round', end: 'round' })[0];
  const off = round.filter((p) => Math.abs(distanceTo(p, zig, false) - 4) > 0.01).length;
  assert.equal(off, 0, 'every point of a round band lies the distance from the line');
  assert.deepEqual(clip.offset(zig, 0, { closed: false }), []);
});

test('a one-point line offsets to a square twice the distance across, or a round dot', () => {
  for (const end of ['butt', 'square']) {
    const out = clip.offset([[5, 5]], 2, { closed: false, end });
    assert.equal(out.length, 1, end);
    assert.deepEqual(bbox(out[0]), [3, 3, 7, 7], end);
    assert.equal(Math.abs(areaOf(out[0])), 16, end);
  }
  assert.ok(near(Math.abs(totalArea(clip.offset([[5, 5]], 2, { closed: false, end: 'round' }))), 4 * Math.PI, 0.01));
});

// C#'s Clipper2 compares points by value; on this pair, comparing output points
// by object identity, as the JavaScript port did, gave an area of 1.5.
test('booleans compare output points by their coordinates, so an equal point is not added twice', () => {
  const a = [[5, 4], [7, 1], [8, 5], [9, 3], [7, 2], [3, 5], [1, 7]];
  const b = [[3, 4], [3, 9], [5, 5], [0, 3], [6, 2], [4, 4], [5, 7], [2, 4], [0, 1], [0, 7], [1, 1], [4, 7], [6, 3], [3, 3]];
  assert.equal(totalArea(clip.intersection(a, b, { scale: 1 })), 2);
});

test('booleans and offsets refuse bad input by name', () => {
  const sq = [[0, 0], [1, 0], [1, 1]];
  for (const [fn, re] of [
    [() => clip.union('rings'), /^union: /],
    [() => clip.union(sq, sq, { scale: 0 }), /^union: scale/],
    [() => clip.intersection(sq, sq, { fill: 'odd' }), /^intersection: fill/],
    [() => clip.difference([[0, 0], [1, NaN], [0, 1]], sq), /^geometry: /],
    [() => clip.xor([[0, 0], [1e5, 0], [0, 1]], sq), /^xor: .*smaller scale/],
    [() => clip.offset(sq, NaN), /^offset: distance/],
    [() => clip.offset(sq, 1e5), /^offset: distance .*smaller scale/],
    [() => clip.offset(sq, 1, { miterLimit: 1e5 }), /^offset: distance .*smaller scale/],
    [() => clip.offset(sq, 1, { join: 'arc' }), /^offset: join/],
    [() => clip.offset(sq, 1, { closed: false, end: 'cap' }), /^offset: end/],
    [() => clip.offset(sq, -1, { closed: false }), /^offset: distance/],
    [() => clip.offset(sq, 1, { miterLimit: 0.5 }), /^offset: miterLimit/],
    [() => clip.offset(sq, 1, { fill: 'odd' }), /^offset: fill/],
  ]) assert.throws(fn, (e) => re.test(e.message));
});

test('offsetPolyline with clean drops the loop a tight bend draws and keeps both ends', () => {
  // A half turn of radius 5, offset by 12 to its inner side: wider than the bend.
  const arc = Array.from({ length: 25 }, (_, i) => { const a = Math.PI * i / 24; return [5 * Math.cos(a), 5 * Math.sin(a)]; });
  const line = [[5, -30], ...arc, [-5, -30]];
  const loop = offsetPolyline(line, 12), clean = offsetPolyline(line, 12, { clean: true });
  const backward = (pts) => {
    let n = 0;
    for (let k = 1; k < pts.length; k++) {
      // Against the way the source runs there: up the first leg, round, down the second.
      const dy = pts[k][1] - pts[k - 1][1];
      if (k < pts.length / 3 && dy < -1e-9) n++;
    }
    return n;
  };
  assert.ok(loop.length > clean.length + 5, `the plain offset keeps ${loop.length} points, the clean one ${clean.length}`);
  assert.deepEqual(clean[0], loop[0]);
  assert.deepEqual(clean[clean.length - 1], loop[loop.length - 1]);
  assert.equal(backward(clean), 0, 'no step runs back down the first leg');
  const outer = offsetPolyline(line, -12);
  assert.deepEqual(offsetPolyline(line, -12, { clean: true }), outer, 'the outer side of a bend has no loop to drop');
  assert.deepEqual(offsetPolyline(line, 12, { miterLimit: 4 }), loop, 'the default is unchanged');
  assert.deepEqual(offsetPolyline(line, 12, 4), loop);
  assert.throws(() => offsetPolyline(line, 12, { clean: 1 }), /offsetPolyline: clean must be true or false/);
});
