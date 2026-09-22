'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sampleGrid, gradient, curl, warp, threshold, isolines, streamline, streamlines } = require('../core/field.js');
const { rng, gradient2 } = require('../core/rand.js');
const { lengthOf } = require('../core/geom.js');

const near = (a, b, epsilon = 1e-9) => assert.ok(Math.abs(a - b) < epsilon, `${a} differs from ${b}`);

test('sampleGrid covers every vertex in row order in the requested domain', () => {
  const visits = [];
  const grid = sampleGrid((x, y) => { visits.push([x, y]); return 2 * x - y; }, 2, 1, [-2, 3, 4, 5]);
  assert.ok(grid instanceof Float64Array);
  assert.deepEqual(visits, [[-2, 3], [1, 3], [4, 3], [-2, 5], [1, 5], [4, 5]]);
  assert.deepEqual([...grid], [-7, -1, 5, -9, -3, 3]);
  const endpoint = sampleGrid((x, y) => [x, y], 1, 1, [-1e16, -1e16, 1, 2]);
  assert.deepEqual(endpoint.at(-1), [1, 2], 'the stated upper bound is sampled even when addition loses it');
});

test('sampleGrid snapshots vector values without aliasing reused field storage', () => {
  const pair = [0, 0];
  const grid = sampleGrid((x, y) => { pair[0] = x; pair[1] = y; return pair; }, 1, 1);
  assert.deepEqual(grid, [[0, 0], [1, 0], [0, 1], [1, 1]]);
  pair[0] = 99;
  grid[0][1] = 88;
  assert.deepEqual(grid.slice(1), [[1, 0], [0, 1], [1, 1]]);
});

test('field vectors require both finite components even in sparse arrays', () => {
  for (const vector of [new Array(2), [, 1], [1, ,]]) {
    assert.throws(() => sampleGrid(() => vector, 1, 1), /finite \[x, y\] vector/);
    assert.throws(() => streamline(() => vector, [0, 0]), /finite \[x, y\] vector/);
    assert.throws(() => streamline(() => 0, vector, { steps: 0 }), /finite \[x, y\] vector/);
    assert.throws(() => warp(() => 0, () => vector)(0, 0), /finite \[x, y\] vector/);
  }
});

test('gradient recovers analytic derivatives with independent axes and coordinate units', () => {
  const derivative = gradient((x, y) => x * x + 3 * y * y + x * y, 0.025);
  for (const [x, y] of [[0, 0], [1, 2], [-3, 0.5], [7, -4]]) {
    const [dx, dy] = derivative(x, y);
    near(dx, 2 * x + y);
    near(dy, 6 * y + x);
  }
  assert.deepEqual(gradient(() => 7)(2, 3), [0, 0]);
});

test('curl is tangent to potential contours and has zero divergence', () => {
  const velocity = curl((x, y) => x * x + 3 * y * y + x * y, 0.01);
  for (const [x, y] of [[1, 2], [-3, 0.5], [7, -4]]) {
    const [vx, vy] = velocity(x, y);
    near(vx, 6 * y + x);
    near(vy, -(2 * x + y));
    near(vx * (2 * x + y) + vy * (6 * y + x), 0);
    const h = 0.1;
    const divergence = (velocity(x + h, y)[0] - velocity(x - h, y)[0]
      + velocity(x, y + h)[1] - velocity(x, y - h)[1]) / (2 * h);
    near(divergence, 0);
  }
});

test('gradient and curl compose with addressed gradient noise at lattice points', () => {
  const R = rng(41);
  const field = (x, y) => gradient2(R, x, y, 'potential');
  const grad = gradient(field);
  const flow = curl(field);
  for (const [x, y] of [[0, 0], [1, 2], [-3, 4]]) {
    const [dx, dy] = grad(x, y);
    near(Math.hypot(dx, dy), 0.5, 1e-6);
    assert.deepEqual(flow(x, y), [dy, -dx]);
  }
});

test('warp displaces the domain once and preserves scalar or vector results', () => {
  const calls = [];
  const displacement = (x, y) => { calls.push([x, y]); return [x + 1, y - 2]; };
  const warped = warp((x, y) => 3 * x - y, displacement, -2);
  assert.equal(warped(2, 5), -11);
  assert.deepEqual(calls, [[2, 5]]);
  assert.deepEqual(warp((x, y) => [y, x], () => [2, -3])(4, 8), [5, 6]);
  assert.equal(warp((x, y) => x + y, () => [8, 9], 0)(4, 8), 12);
});

test('threshold places equality on the high side without changing field coordinates', () => {
  const cut = threshold((x, y) => x - 2 * y, 3);
  assert.equal(cut(4.9, 1), 0);
  assert.equal(cut(5, 1), 1);
  assert.equal(cut(5.1, 1), 1);
  assert.equal(threshold((x) => x)(0.5), 1);
});

test('isolines interpolate a linear field and chain cell edges into one path per level', () => {
  const grid = sampleGrid((x) => x, 4, 3);
  const copy = grid.slice();
  const { segments, paths } = isolines(grid, 4, 3, [0.125, 0.625]);
  assert.equal(segments.length, 6);
  assert.equal(paths.length, 2);
  for (const [index, pts] of paths.entries()) {
    assert.equal(pts.length, 4);
    assert.ok(pts.every(([x]) => x === [0.5, 2.5][index]));
    assert.deepEqual(pts.map((p) => p[1]).sort((a, b) => a - b), [0, 1, 2, 3]);
    near(lengthOf(pts), 3);
  }
  assert.deepEqual(grid, copy);
});

test('isolines close an interior peak and leave flat fields empty', () => {
  const { segments, paths } = isolines([0, 0, 0, 0, 1, 0, 0, 0, 0], 2, 2, 0.5);
  assert.equal(segments.length, 4);
  assert.equal(paths.length, 1);
  assert.equal(paths[0].length, 5);
  assert.deepEqual(paths[0][0], paths[0].at(-1));
  assert.deepEqual(new Set(paths[0].map((p) => p.join(','))), new Set(['0.5,1', '1,0.5', '1.5,1', '1,1.5']));
  assert.deepEqual(isolines([1, 1, 1, 1], 1, 1, [0, 1, 2]), { segments: [], paths: [] });
  assert.deepEqual(isolines([0, 1, 0, 1], 1, 1, []), { segments: [], paths: [] });
});

test('isolines resolve both saddle orientations using the centre value', () => {
  const edges = (grid) => isolines(grid, 1, 1, 0).segments.map((segment) => segment.map(([x, y]) => {
    if (y === 0) return 'T';
    if (x === 1) return 'R';
    if (y === 1) return 'B';
    return 'L';
  }).join(''));
  assert.deepEqual(edges([-1, 3, 3, -1]), ['LT', 'BR']);
  assert.deepEqual(edges([-3, 1, 1, -3]), ['TR', 'LB']);
  assert.deepEqual(edges([3, -1, -1, 3]), ['TR', 'LB']);
  assert.deepEqual(edges([1, -3, -3, 1]), ['LT', 'BR']);
  assert.deepEqual(edges([-1, 1, 1, -1]), ['TR', 'LB'], 'a centre exactly on the level follows the low branch');
});

test('isolines retain finite endpoints when a level lands exactly on grid vertices', () => {
  const { paths } = isolines(sampleGrid((x, y) => x + y, 2, 2), 2, 2, 1);
  assert.ok(paths.length > 0);
  for (const point of paths.flat()) {
    assert.ok(point.every(Number.isFinite));
    near(point[0] + point[1], 2);
  }
});

test('streamlines follow a constant vector with fixed physical step and independent seeds', () => {
  const seeds = [[0, 0], [2, -1]];
  const paths = streamlines(() => [30, 40], seeds, { steps: 4, step: 2 });
  for (const [index, pts] of paths.entries()) {
    assert.equal(pts.length, 4);
    for (const [k, [x, y]] of pts.entries()) {
      near(x, seeds[index][0] + k * 1.2);
      near(y, seeds[index][1] + k * 1.6);
    }
    near(lengthOf(pts), 6);
  }
  paths[0][0][0] = 99;
  assert.deepEqual(seeds, [[0, 0], [2, -1]]);
  assert.deepEqual(paths[1][0], [2, -1]);
  assert.deepEqual(streamlines(() => [1, 0], []), []);
});

test('streamline steering takes the short turn across both sides of pi', () => {
  for (const sign of [-1, 1]) {
    const target = sign * (-Math.PI + 0.2);
    const heading = sign * (Math.PI - 0.2);
    const pts = streamline(() => target, [0, 0], { steps: 3, step: 2, turn: 0.5, heading });
    near(pts[1][0], -2);
    near(pts[1][1], 0);
    near(pts[2][0] - pts[1][0], -2 * Math.cos(0.1));
    near(pts[2][1] - pts[1][1], -sign * 2 * Math.sin(0.1));
  }
  assert.deepEqual(streamline(() => Math.PI / 2, [0, 0], { steps: 3, heading: 0, turn: 0 }), [[0, 0], [1, 0], [2, 0]]);
});

test('streamline records bounded starts and stops before an outside point or zero vector', () => {
  const bounds = [0, 0, 2, 2];
  assert.deepEqual(streamline(() => 0, [0, 1], { steps: 10, step: 1, bounds }), [[0, 1], [1, 1], [2, 1]]);
  assert.deepEqual(streamline(() => 0, [-1, 1], { bounds }), []);
  assert.deepEqual(streamline(() => 0, [0, 0], { steps: 0 }), []);
  assert.deepEqual(streamline(() => 0, [0, 0], { steps: 1 }), [[0, 0]]);
  assert.deepEqual(streamline(() => [0, 0], [2, 3]), [[2, 3]]);
  assert.deepEqual(streamline((x) => x >= 2 ? [0, 0] : [1, 0], [0, 0]), [[0, 0], [1, 0], [2, 0]]);
});

test('streamline converges to a circular flow as the step is refined', () => {
  const radialError = (step) => {
    const pts = streamline((x, y) => [-y, x], [1, 0], { step, steps: Math.round(1 / step) + 1 });
    const [x, y] = pts.at(-1);
    return Math.hypot(x - Math.cos(1), y - Math.sin(1));
  };
  assert.ok(radialError(0.01) < radialError(0.04) / 3, 'fixed-step direction integration converges on the unit circle');
});

test('field primitives refuse invalid dimensions, samples and unbounded walks', () => {
  for (const cols of [0, -1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => sampleGrid(() => 0, cols, 1), /grid/);
  }
  for (const bounds of [[0, 0, 0, 1], [1, 0, 0, 1], [0, 0, Infinity, 1], [-1e308, 0, 1e308, 1]]) {
    assert.throws(() => sampleGrid(() => 0, 1, 1, bounds), /bounds/);
    assert.throws(() => streamline(() => 0, [0, 0], { bounds }), /bounds/);
  }
  assert.throws(() => sampleGrid((x) => x === 0 ? 0 : [1, 2], 1, 1), /scalar/);
  assert.throws(() => sampleGrid(() => [1, Infinity], 1, 1), /vector/);
  assert.throws(() => isolines([0, 1], 1, 1, 0.5), /sample count/);
  assert.throws(() => isolines([0, NaN, 0, 1], 1, 1, 0.5), /scalar/);
  assert.throws(() => isolines([0, 1, 0, 1], 1, 1, Infinity), /scalar/);
  for (const epsilon of [0, -1, Infinity, NaN, 1e308, '0.1']) assert.throws(() => gradient(() => 0, epsilon), /epsilon/);
  assert.throws(() => gradient((x) => x)(1e20, 0), /representable/);
  assert.throws(() => gradient(() => NaN)(0, 0), /scalar/);
  assert.throws(() => warp(() => 0, () => [1, NaN])(0, 0), /vector/);
  assert.throws(() => threshold(() => Infinity)(0, 0), /scalar/);
  for (const steps of [-1, 0.5, Infinity, NaN, 2 ** 53]) assert.throws(() => streamline(() => 0, [0, 0], { steps }), /steps/);
  for (const step of [0, -1, Infinity, NaN]) assert.throws(() => streamline(() => 0, [0, 0], { step }), /step/);
  for (const turn of [-0.1, 1.1, NaN]) assert.throws(() => streamline(() => 0, [0, 0], { turn }), /turn/);
  assert.throws(() => streamline(() => [1, NaN], [0, 0]), /vector/);
  assert.throws(() => streamline(() => Infinity, [0, 0]), /scalar/);
});
