'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sampleGrid, gradient, curl, warp, threshold, isolines, streamline, streamlines, evenStreamlines } = require('../core/field.js');
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

const flowSeeds = () => {
  const seeds = [];
  for (let j = 0; j <= 12; j++) for (let i = 0; i <= 12; i++) seeds.push([i * 0.5, j * 0.5]);
  return seeds;
};
const flowRand = rng(7);
const flow = curl((x, y) => gradient2(flowRand, x, y));
const flowOptions = { steps: 80, step: 0.05, bounds: [0, 0, 6, 6], separation: 0.3 };

test('streamlines with a separation keep every point at least that far from every earlier trace', () => {
  const paths = streamlines(flow, flowSeeds(), flowOptions);
  const kept = paths.filter((pts) => pts.length > 0);
  assert.ok(kept.length > 10 && kept.length < paths.length, `${kept.length} of ${paths.length} seeds start`);
  assert.ok(kept.some((pts) => pts.length < flowOptions.steps), 'some trace ends against an earlier one');
  const limit = flowOptions.separation ** 2 * (1 - 1e-12);
  for (let a = 0; a < kept.length; a++) {
    for (let b = a + 1; b < kept.length; b++) {
      for (const [x, y] of kept[a]) {
        for (const [u, v] of kept[b]) assert.ok((x - u) ** 2 + (y - v) ** 2 >= limit, `traces ${a} and ${b} meet near ${x}, ${y}`);
      }
    }
  }
  const [first, second] = streamlines(() => [1, 0], [[5, 0], [0, 0.5]], { steps: 10, separation: 1 });
  assert.equal(first.length, 10);
  assert.deepEqual(second, [[0, 0.5], [1, 0.5], [2, 0.5], [3, 0.5], [4, 0.5]], 'the later trace ends before the point that comes too close');
});

test('streamlines with a separation are deterministic and keep one entry per seed in seed order', () => {
  const seeds = flowSeeds();
  const once = streamlines(flow, seeds, flowOptions);
  assert.equal(once.length, seeds.length);
  assert.deepEqual(streamlines(flow, seeds, flowOptions), once);
  assert.deepEqual(once[0][0], seeds[0], 'the first seed always starts');
  for (const [index, pts] of once.entries()) if (pts.length) assert.deepEqual(pts[0], seeds[index]);
  assert.ok(once.some((pts) => pts.length === 0), 'a refused seed stays as an empty entry');
  const reversed = streamlines(flow, [...seeds].reverse(), flowOptions).reverse();
  assert.notDeepEqual(reversed, once, 'seed order decides which trace keeps a contested space');
});

test('streamlines with a separation stop at the seed cap and report refused seeds as empty entries', () => {
  let calls = 0;
  const field = () => { calls++; return [0, 1]; };
  const seeds = [[0, 0], [0, 0.1], [0.05, 3], [2, 0]];
  const paths = streamlines(field, seeds, { steps: 5, separation: 0.5 });
  assert.deepEqual(paths.map((pts) => pts.length), [5, 0, 0, 5], 'seeds on an earlier trace never start');
  assert.ok(calls <= seeds.length * (5 + 1), `${calls} field reads for ${seeds.length} seeds of 5 steps`);
  for (const pts of streamlines(flow, flowSeeds(), flowOptions)) assert.ok(pts.length <= flowOptions.steps);
  assert.throws(() => streamlines(field, seeds, { separation: 0 }), /separation must be positive and finite/);
  assert.throws(() => streamlines(field, seeds, { separation: Infinity }), /separation must be positive and finite/);
});

test('streamlines drop traces shorter than minLength and leave their space free', () => {
  const bounds = [0, -1, 4, 1];
  const seeds = [[3.5, 0], [0, 0.2], [1, 0.9]];
  const paths = streamlines(() => [1, 0], seeds, { steps: 10, bounds, minLength: 2 });
  assert.deepEqual(paths.map((pts) => pts.length), [0, 5, 4]);
  const spaced = streamlines(() => [1, 0], [[3.5, 0], [0, 0.2]], { steps: 10, bounds, minLength: 2, separation: 1 });
  assert.deepEqual(spaced.map((pts) => pts.length), [0, 5], 'a dropped trace does not block a later seed');
  assert.deepEqual(streamlines(() => [1, 0], [[0, 0]], { steps: 3, minLength: 2 }), [[[0, 0], [1, 0], [2, 0]]], 'a trace exactly minLength long is kept');
  assert.throws(() => streamlines(() => [1, 0], seeds, { minLength: -1 }), /minLength must be nonnegative and finite/);
});

test('evenStreamlines fills its bounds with lines walked both ways from their seeds, neighbours first', () => {
  const lines = evenStreamlines(() => [1, 0], [0, 0, 10, 4], { separation: 1 });
  assert.equal(lines.length, 4);
  for (const pts of lines) {
    const xs = pts.map((p) => p[0]);
    assert.ok(pts.every((p) => Math.abs(p[1] - pts[0][1]) < 1e-9), 'a line along a constant field is straight');
    assert.ok(Math.min(...xs) < 0.21 && Math.max(...xs) > 9.79, `a line runs to both ends, got ${Math.min(...xs)} to ${Math.max(...xs)}`);
    for (let k = 1; k < xs.length; k++) assert.ok(xs[k] > xs[k - 1], 'the two halves join into one run');
  }
  assert.deepEqual(lines.map((pts) => pts[0][1]), [1.5, 2.5, 0.5, 3.5], 'the middle first, then each side of a line laid');
  assert.deepEqual(evenStreamlines(() => Math.PI, [0, 0, 10, 4], { separation: 1 }).length, 4, 'an angle walks both ways too');
  assert.deepEqual(evenStreamlines(() => [1, 0], [0, 0, 10, 4], { separation: 1, seeds: [] }), []);
  assert.deepEqual(evenStreamlines(() => [0, 0], [0, 0, 10, 4], { separation: 1 }), [], 'a still field lays nothing');
  const one = evenStreamlines(() => [1, 0], [0, 0, 10, 4], { separation: 1, seeds: [[20, 20], [5, 3.9]] });
  assert.deepEqual(one.map((pts) => Math.round(pts[0][1] * 10) / 10), [3.9, 2.9, 1.9, 0.9], 'a seed outside is passed over and one inside spreads to the rest');
});

test('evenStreamlines keeps lines gap apart, covers the bounds and is deterministic', () => {
  const bounds = [0, 0, 6, 6], separation = 0.3;
  const lines = evenStreamlines(flow, bounds, { separation });
  assert.deepEqual(evenStreamlines(flow, bounds, { separation }), lines);
  const limit = (separation / 2) ** 2 * (1 - 1e-12);
  let close = 0;
  for (let a = 0; a < lines.length; a++) {
    for (let b = a + 1; b < lines.length; b++) {
      for (const [x, y] of lines[a]) for (const [u, v] of lines[b]) if ((x - u) ** 2 + (y - v) ** 2 < limit) close++;
    }
  }
  assert.equal(close, 0, 'pairs of points on two lines nearer than gap');
  const points = lines.flat();
  let bare = 0;
  for (let j = 0; j < 20; j++) {
    for (let i = 0; i < 20; i++) {
      const x = (i + 0.5) * 0.3, y = (j + 0.5) * 0.3;
      if (!points.some(([u, v]) => (x - u) ** 2 + (y - v) ** 2 <= separation ** 2)) bare++;
    }
  }
  assert.equal(bare, 0, 'lattice points with no line within separation');
  const oneWay = streamlines(flow, flowSeeds(), { ...flowOptions, steps: 1000 }).filter((pts) => pts.length > 1);
  const mean = (list) => list.reduce((sum, pts) => sum + lengthOf(pts), 0) / list.length;
  assert.ok(mean(lines) > mean(oneWay) * 1.3,`lines run longer than one-way traces: ${mean(lines)} against ${mean(oneWay)}`);
  const long = evenStreamlines(flow, bounds, { separation, minLength: 1 });
  assert.ok(long.length < lines.length && long.every((pts) => lengthOf(pts) >= 1), 'minLength drops the short ones');
});

test('evenStreamlines ends a ring where it meets itself and walks an orientation with axial', () => {
  const rings = evenStreamlines((x, y) => [-y, x], [-2, -2, 2, 2], { separation: 0.4, step: 0.02 });
  assert.ok(rings.length >= 3, `${rings.length} rings`);
  for (const pts of rings) {
    const radius = Math.max(...pts.map(([x, y]) => Math.hypot(x, y)));
    assert.ok(lengthOf(pts) < 2 * Math.PI * radius * 1.02, `a ring of radius ${radius} is ${lengthOf(pts)} long, more than once round`);
  }
  // A line named by a vector at one point and its opposite at the next.
  const grain = (x) => (Math.floor(x * 3) % 2 === 0 ? [1, 0.25] : [-1, -0.25]);
  const along = evenStreamlines(grain, [0, 0, 8, 4], { separation: 0.5, axial: true });
  const plain = evenStreamlines(grain, [0, 0, 8, 4], { separation: 0.5 });
  const widest = (list) => Math.max(...list.map((pts) => Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]))));
  assert.ok(widest(along) > 7.5, `an axial line crosses the bounds, got ${widest(along)}`);
  assert.ok(widest(plain) < 1, `a plain walk turns back at each flip, got ${widest(plain)}`);
});

test('evenStreamlines refuses a spacing it cannot keep', () => {
  const field = () => [1, 0], bounds = [0, 0, 4, 4];
  assert.throws(() => evenStreamlines(field, bounds), /evenStreamlines: separation must be positive and finite/);
  assert.throws(() => evenStreamlines(field, bounds, { separation: 1, gap: 2 }), /evenStreamlines: gap must be positive and at most separation/);
  assert.throws(() => evenStreamlines(field, bounds, { separation: 1, step: 0.8 }), /evenStreamlines: step must be positive and at most gap/);
  assert.throws(() => evenStreamlines(field, bounds, { separation: 1, minLength: -1 }), /evenStreamlines: minLength must be nonnegative and finite/);
  assert.throws(() => evenStreamlines(field, bounds, { separation: 1, seeds: 4 }), /evenStreamlines: seeds must be a list of \[x, y\] points/);
  assert.throws(() => evenStreamlines(field, bounds, { separation: 1, seeds: [[0, NaN]] }), /expected a finite \[x, y\] vector/);
  assert.throws(() => evenStreamlines(field, bounds, { separation: 1e-4 }), /evenStreamlines: bounds hold 40000 x 40000 cells of separation, over the 4194304 one call may lay/);
  assert.throws(() => evenStreamlines(field, [0, 0, 0, 1], { separation: 1 }), /bounds must be finite/);
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
