// A surface built as maps (core/maps.js): generators, filters, the maps
// derived from a height, and the image a map becomes.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fill, noise, cells, warp, levels, steps, blur, slopeBlur, combine, shade, relief, toImage, over } = require('../core/maps.js');
const { rng } = require('../core/rand.js');

const near = (a, b, eps = 1e-5) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);
const range = (m) => [Math.min(...m.data), Math.max(...m.data)];
const mean = (m) => m.data.reduce((s, v) => s + v, 0) / m.data.length;

test('fill holds a number or a function of the column and row, and refuses a size it cannot hold', () => {
  assert.deepEqual([...fill(3, 2, 0.5).data], [0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
  assert.deepEqual([...fill(3, 2, (x, y) => x + 10 * y).data], [0, 1, 2, 10, 11, 12]);
  assert.throws(() => fill(0, 4), /fill: w and h must be whole numbers of cells, 1 or more, with at most 16777216 cells in all, got 0 x 4/);
  assert.throws(() => fill(5000, 5000), /fill: w and h must be whole numbers/);
  assert.throws(() => fill(2, 2, 'red'), /fill: value must be a finite number, got red/);
});

test('noise stays in [0, 1), follows its seed and name, and is a window on one field', () => {
  const R = rng(3), a = noise(R, 96, 64, { scale: 16, octaves: 4 });
  const [lo, hi] = range(a);
  assert.ok(lo >= 0 && hi < 1 && hi - lo > 0.35, `range ${lo} to ${hi}`);
  assert.ok(Math.abs(mean(a) - 0.5) < 0.05, `it lies about 0.5, mean ${mean(a)}`);
  assert.deepEqual(noise(rng(3), 96, 64, { scale: 16, octaves: 4 }), a);
  assert.notDeepEqual(noise(rng(4), 96, 64, { scale: 16, octaves: 4 }).data, a.data);
  assert.notDeepEqual(noise(R, 96, 64, { scale: 16, octaves: 4, name: 'other' }).data, a.data);
  const big = noise(R, 128, 100, { scale: 16, octaves: 4 });
  let off = 0;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 96; x++) if (big.data[y * 128 + x] !== a.data[y * 96 + x]) off++;
  assert.equal(off, 0, 'cells of the larger map that differ from the smaller one');
});

test('noise scale sets the size of its features, each way on its own', () => {
  const R = rng(1), change = (m, dx, dy) => {
    let sum = 0, n = 0;
    for (let y = 0; y < m.h - dy; y++) for (let x = 0; x < m.w - dx; x++, n++) sum += Math.abs(m.data[(y + dy) * m.w + x + dx] - m.data[y * m.w + x]);
    return sum / n;
  };
  const coarse = noise(R, 128, 128, { scale: 64 }), fine = noise(R, 128, 128, { scale: 8 }), grain = noise(R, 128, 128, { scale: [4, 64] });
  assert.ok(change(fine, 1, 0) > change(coarse, 1, 0) * 4, 'a smaller scale changes faster');
  assert.ok(change(grain, 1, 0) > change(grain, 0, 1) * 6, 'a grain that runs down changes faster across');
  const rough = (m) => change(m, 1, 0) / change(m, 16, 0);
  assert.ok(rough(noise(R, 128, 128, { scale: 64, octaves: 5 })) > rough(coarse) * 1.5, 'octaves add finer change to the same broad one');
  assert.throws(() => noise(R, 8, 8, { scale: 0 }), /noise: scale must be a positive size in cells, or \[across, down\], got 0/);
  assert.throws(() => noise(R, 8, 8, { octaves: 0 }), /noise: octaves must be a whole number from 1 to 12, got 0/);
  assert.throws(() => noise(R, 8, 8, { gain: 2 }), /noise: gain must be over 0 and at most 1, got 2/);
});

test('warp reads a map through a bend and leaves it alone where the bend is 0.5', () => {
  const ramp = fill(8, 4, (x) => x), still = fill(8, 4, 0.5);
  assert.deepEqual(warp(ramp, still, still, 5), ramp);
  assert.deepEqual([...warp(ramp, fill(8, 4, 1), still, 4).data.slice(0, 8)], [2, 3, 4, 5, 6, 7, 6, 5], 'two cells to the right, mirrored past the edge');
  assert.deepEqual([...warp(ramp, fill(8, 4, 0), still, 4).data.slice(0, 4)], [2, 1, 0, 1], 'and past the near edge');
  near(warp(ramp, fill(8, 4, 0.75), still, 2).data[1], 1.5);
  assert.throws(() => warp(ramp, fill(4, 4), still, 1), /warp: its maps must have one size, got 8 x 4 and 4 x 4/);
  assert.throws(() => warp(ramp, still, still), /warp: reach must be a finite number/);
});

test('levels stretches, turns over and bends; steps cuts flat layers with a riser', () => {
  const ramp = fill(5, 1, (x) => x / 4);
  assert.deepEqual([...levels(ramp, 0.25, 0.75).data], [0, 0, 0.5, 1, 1]);
  assert.deepEqual([...levels(ramp, 1, 0).data], [1, 0.75, 0.5, 0.25, 0]);
  near(levels(ramp, 0, 1, 2).data[2], 0.25);
  assert.throws(() => levels(ramp, 0.5, 0.5), /levels: lo and hi must be two different finite numbers, got 0.5 and 0.5/);
  const slope = fill(100, 1, (x) => x / 100), cut = steps(slope, 4, 0);
  assert.deepEqual([...new Set(cut.data)], [0, 0.25, 0.5, 0.75]);
  const soft = steps(slope, 4, 0.2);
  assert.equal(soft.data[10], 0, 'the tread is flat');
  assert.ok(soft.data[23] > 0 && soft.data[23] < 0.25, `the riser climbs, got ${soft.data[23]}`);
  for (let x = 1; x < 100; x++) assert.ok(soft.data[x] >= soft.data[x - 1], 'steps never fall on a rising map');
  assert.throws(() => steps(slope, 0), /steps: n must be a positive number of steps, got 0/);
  assert.throws(() => steps(slope, 4, 2), /steps: soft must be a share from 0 to 1, got 2/);
});

test('blur keeps the mean, spreads a point about as a Gaussian of its sigma, and holds the edges', () => {
  const point = fill(101, 101, (x, y) => (x === 50 && y === 50 ? 1 : 0)), soft = blur(point, 6);
  near(mean(soft), mean(point), 1e-6);
  let spread = 0;
  for (let x = 0; x < 101; x++) spread += soft.data[50 * 101 + x] * (x - 50) ** 2;
  let row = 0;
  for (let x = 0; x < 101; x++) row += soft.data[50 * 101 + x];
  assert.ok(Math.abs(Math.sqrt(spread / row) - 6) < 0.4, `the spread is ${Math.sqrt(spread / row)} cells`);
  assert.deepEqual(blur(fill(9, 9, 0.3), 4), fill(9, 9, 0.3), 'a flat map stays flat to its edges');
  assert.deepEqual(blur(point, 0), point);
  assert.notEqual(blur(point, 0).data, point.data, 'a new map even when nothing moves');
  assert.throws(() => blur(point, -1), /blur: sigma must be a finite number of cells, 0 or more, got -1/);
});

test('cells cuts the map into cells with one value each, a distance to the border and a place in the cell', () => {
  const R = rng(5), c = cells(R, 160, 120, { scale: 40 });
  const seen = new Set(c.value.data);
  assert.ok(seen.size >= 9 && seen.size <= 40, `${seen.size} cells on a map of twelve lattice cells`);
  let inside = 0, mixed = 0, border = 0;
  for (let y = 1; y < 119; y++) {
    for (let x = 1; x < 159; x++) {
      const p = y * 160 + x, same = c.value.data[p] === c.value.data[p + 1] && c.value.data[p] === c.value.data[p + 160];
      if (c.edge.data[p] > 1.5) { inside++; if (!same) mixed++; } else if (!same) border++;
    }
  }
  assert.ok(inside > 10000 && mixed === 0, `${mixed} of ${inside} places well inside a cell touch another cell`);
  assert.ok(border > 200, `the borders lie where the distance is small, ${border} places`);
  assert.ok(Math.min(...c.edge.data) >= 0, 'the distance to a border is never under 0');
  // Within one cell, a step across moves x by one over the scale and leaves y alone.
  const p = 60 * 160 + 80;
  if (c.value.data[p] === c.value.data[p + 1]) {
    near(c.x.data[p + 1] - c.x.data[p], 1 / 40);
    near(c.y.data[p + 1] - c.y.data[p], 0);
  }
  assert.ok(Math.max(...c.x.data.map(Math.abs)) < 2 && Math.max(...c.y.data.map(Math.abs)) < 2, 'a place lies near its own point');
  assert.deepEqual(cells(rng(5), 160, 120, { scale: 40 }), c);
  assert.notDeepEqual(cells(R, 160, 120, { scale: 40, name: 'other' }).value.data, c.value.data);
  const big = cells(R, 200, 150, { scale: 40 });
  let off = 0;
  for (let y = 0; y < 120; y++) for (let x = 0; x < 160; x++) if (big.value.data[y * 200 + x] !== c.value.data[y * 160 + x]) off++;
  assert.equal(off, 0, 'cells of the larger map that differ from the smaller one');
  const square = cells(R, 80, 80, { scale: 20, jitter: 0 });
  assert.equal(square.value.data[81], square.value.data[18 * 80 + 18], 'without jitter a lattice cell is one cell');
  assert.notEqual(square.value.data[81], square.value.data[80 + 22], 'and the next one is another');
  near(square.edge.data[10 * 80 + 10], 10);
  // Long cells: along a row the cell changes far less often than down a column.
  const long = cells(R, 240, 240, { scale: [120, 12] }).value.data;
  let across = 0, down = 0;
  for (let k = 0; k < 239; k++) { if (long[120 * 240 + k] !== long[120 * 240 + k + 1]) across++; if (long[k * 240 + 120] !== long[(k + 1) * 240 + 120]) down++; }
  assert.ok(down > across * 4, `a scale each way gives long cells: ${across} borders across, ${down} down`);
  assert.throws(() => cells(R, 8, 8, { scale: 0 }), /cells: scale must be a positive size in cells, or \[across, down\], got 0/);
  assert.throws(() => cells(R, 8, 8, { jitter: 2 }), /cells: jitter must be a share from 0 to 1, got 2/);
});

test('slopeBlur drags a map down the slopes of another: one side of a block wears, the other holds', () => {
  const block = fill(60, 20, (x) => (x >= 20 && x < 40 ? 1 : 0)), ramp = fill(60, 20, (x) => x / 60), row = 10 * 60;
  assert.deepEqual(slopeBlur(block, fill(60, 20, 0.5)), block, 'a flat slope moves nothing');
  const eaten = slopeBlur(block, ramp, { reach: 6, mode: 'min' });
  assert.equal(eaten.data[row + 20], 1, 'the side that looks up the slope into the block holds');
  assert.equal(eaten.data[row + 36], 0, 'the side that looks up the slope out of the block is eaten');
  assert.equal(eaten.data[row + 30], 1);
  const spread = slopeBlur(block, ramp, { reach: 6, mode: 'max' });
  assert.equal(spread.data[row + 16], 1, 'max spreads the block down the slope');
  assert.equal(spread.data[row + 42], 0, 'and not up it');
  const smeared = slopeBlur(block, ramp, { reach: 6 });
  assert.ok(smeared.data[row + 17] > 0 && smeared.data[row + 17] < 1 && smeared.data[row + 37] < 1 && smeared.data[row + 37] > 0, 'mean smears both edges');
  assert.ok(Math.abs(mean(smeared) - mean(block)) < 0.01, 'and keeps the mean');
  assert.deepEqual(slopeBlur(block, ramp, { reach: 0 }), block);
  assert.throws(() => slopeBlur(block, fill(10, 10)), /slopeBlur: its maps must have one size/);
  assert.throws(() => slopeBlur(block, ramp, { samples: 0 }), /slopeBlur: samples must be a whole number from 1 to 64, got 0/);
  assert.throws(() => slopeBlur(block, ramp, { mode: 'median' }), /slopeBlur: mode must be 'mean', 'min' or 'max', got "median"/);
});

test('combine applies a function cell by cell to maps of one size', () => {
  const a = fill(2, 2, (x, y) => x + 2 * y), b = fill(2, 2, 10);
  assert.deepEqual([...combine((v) => v * 2, a).data], [0, 2, 4, 6]);
  assert.deepEqual([...combine((u, v) => u + v, a, b).data], [10, 11, 12, 13]);
  assert.deepEqual([...combine((u, v, t) => u + v + t, a, b, b).data], [20, 21, 22, 23]);
  assert.deepEqual([...combine((u, v, t, s) => u + v + t + s, a, b, b, b).data], [30, 31, 32, 33]);
  assert.throws(() => combine((u) => u), /combine: takes a function, then one map or more/);
  assert.throws(() => combine((u, v) => u + v, a, fill(3, 2)), /combine: its maps must have one size/);
  assert.throws(() => combine((u) => u, { w: 2, h: 2, data: [0, 0, 0, 0] }), /combine: takes a map, such as fill\(w, h, 0\)/);
});

test('shade lights the slopes that face the lamp, and relief is over 0 on what stands out', () => {
  near(shade(fill(5, 5, 0.7)).data[12], 1 / Math.sqrt(3), 1e-6);
  const bump = fill(41, 41, (x, y) => 6 * Math.exp(-((x - 20) ** 2 + (y - 20) ** 2) / 60)), lit = shade(bump);
  assert.ok(lit.data[16 * 41 + 16] > 0.75, `the upper left slope faces the lamp, got ${lit.data[16 * 41 + 16]}`);
  assert.ok(lit.data[24 * 41 + 24] < 0.3, `the lower right slope faces away, got ${lit.data[24 * 41 + 24]}`);
  assert.ok(shade(bump, { light: [1, 1, 1] }).data[24 * 41 + 24] > 0.75, 'a lamp at the lower right lights the other slope');
  assert.ok(shade(bump, { scale: 3 }).data[24 * 41 + 24] < lit.data[24 * 41 + 24], 'a deeper relief is darker away from the lamp');
  assert.throws(() => shade(bump, { light: [0, 0, 0] }), /shade: light must be \[x, y, z\] towards the lamp, not all zero/);
  const stood = relief(bump, 8);
  assert.ok(stood.data[20 * 41 + 20] > 1 && stood.data[20 * 41 + 8] < 0, 'the top stands out and its foot lies in a hollow');
  near(mean(relief(fill(9, 9, 0.4), 3)), 0, 1e-6);
});

test('toImage reads a map through colour stops in linear light, and over lays a colour by a mask', () => {
  const img = toImage(fill(3, 1, (x) => x / 2), ['#000000', '#ffffff']);
  assert.deepEqual([img.w, img.h, img.channels], [3, 1, 3]);
  assert.ok(img.data instanceof Uint8Array);
  assert.deepEqual([...img.data], [0, 0, 0, 188, 188, 188, 255, 255, 255], 'half the light is #bcbcbc');
  assert.deepEqual([...toImage(fill(3, 1, (x) => x - 0.5), ['#ff0000', '#00ff00', '#0000ff']).data], [255, 0, 0, 0, 255, 0, 0, 0, 255], 'held to its ends, the middle stop at one half');
  assert.deepEqual([...toImage(fill(2, 1, 0.3), ['#336699']).data], [0x33, 0x66, 0x99, 0x33, 0x66, 0x99]);
  const laid = over(img, '#ff0000', fill(3, 1, (x) => x / 2));
  assert.deepEqual([...laid.data.slice(0, 3)], [0, 0, 0], 'a mask of 0 leaves the pixel');
  assert.deepEqual([...laid.data.slice(6)], [255, 0, 0], 'a mask of 1 replaces it');
  assert.ok(laid.data[3] > 188 && laid.data[4] < 188 && laid.data[4] > 100, `half way between, got ${[...laid.data.slice(3, 6)]}`);
  assert.deepEqual([...img.data.slice(3, 6)], [188, 188, 188], 'the image given is not changed');
  assert.throws(() => toImage(fill(2, 2), []), /toImage: stops must be a list of one colour or more/);
  assert.throws(() => over(img, '#fff', fill(2, 2)), /over: takes an RGB image from toImage and a mask of its size/);
});
