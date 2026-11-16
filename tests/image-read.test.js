'use strict';

// An image read as a whole, for a piece drawn after it: palette, values, the
// way its structure runs (structureField) and its blocks of colour (regions),
// and the axial walk that follows an orientation.

const test = require('node:test');
const assert = require('node:assert/strict');
const { palette, values, structureField, regions } = require('../core/image.js');
const { oklch } = require('../core/colour.js');
const { streamline } = require('../core/field.js');

/** A solved image of w x h pixels, each from `at(x, y)` as [r, g, b] or [r, g, b, a]. */
function image(w, h, at, channels = 3) {
  const data = new Uint8Array(w * h * channels);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) data.set(at(x, y).slice(0, channels), (y * w + x) * channels);
  }
  return { w, h, channels, data, source: 'made by the test', rights: 'none needed' };
}

const QUADS = [[200, 40, 40], [40, 160, 60], [40, 60, 200], [230, 210, 60]];
const quadrants = (size) => image(size, size, (x, y) => QUADS[(y < size / 2 ? 0 : 2) + (x < size / 2 ? 0 : 1)]);
/** Stripes whose lines run at `angle`, so the tone changes only across them. */
const stripes = (angle, w = 96, h = 96) => image(w, h, (x, y) => {
  const v = Math.round(127.5 + 110 * Math.sin((-x * Math.sin(angle) + y * Math.cos(angle)) * 0.7));
  return [v, v, v];
});

test('palette gives the dominant colours largest first, with shares that add up to 1 and no position', () => {
  const img = image(4, 2, (x) => (x < 3 ? [255, 0, 0] : [0, 0, 255]));
  assert.deepEqual(palette(img), [{ colour: '#ff0000', share: 0.75 }, { colour: '#0000ff', share: 0.25 }]);
  const moved = image(4, 2, (x) => (x > 0 ? [255, 0, 0] : [0, 0, 255]));
  assert.deepEqual(palette(moved), palette(img), 'the same colours in other places give the same palette');
  assert.deepEqual(palette(img, 1).length, 1, 'k bounds the count');
  const grey = image(2, 1, (x) => [x ? 200 : 40], 1);
  assert.deepEqual(palette(grey).map((c) => c.colour).sort(), ['#282828', '#c8c8c8'], 'a grey image reads as grey colours');
  const holed = image(2, 1, (x) => (x ? [0, 255, 0, 255] : [255, 0, 0, 10]), 4);
  assert.deepEqual(palette(holed), [{ colour: '#00ff00', share: 1 }], 'a transparent pixel is not a colour');
  assert.deepEqual(palette(image(1, 1, () => [0, 0, 0, 0], 4)), []);
  assert.throws(() => palette(img, 0), /palette: k must be a whole number from 1 to 64, got 0/);
  assert.throws(() => palette({ w: 1, h: 1 }), /palette: takes an image of the solved state/);
});

test('values reads OKLab lightness at shares of the pixels sorted dark to light', () => {
  const halves = image(10, 10, (x) => (x < 5 ? [0, 0, 0] : [255, 255, 255]));
  const [dark, light] = values(halves, [0.25, 0.75]);
  assert.ok(Math.abs(dark) < 1e-6 && Math.abs(light - 1) < 1e-3, `black then white, got ${dark}, ${light}`);
  const flat = image(3, 3, () => [119, 119, 119]);
  assert.ok(Math.abs(values(flat, [0.5])[0] - oklch('#777777')[0]) < 1e-6, 'the lightness is OKLab L, as oklch reads it');
  const ramp = values(image(256, 1, (x) => [x, x, x]));
  assert.equal(ramp.length, 5);
  assert.ok(ramp.every((v, i) => i === 0 || v > ramp[i - 1]), 'the default shares rise from dark to light');
  const big = image(1200, 600, (x) => (x < 600 ? [0, 0, 0] : [255, 255, 255]));
  assert.ok(Math.abs(values(big, [0.5])[0] - 0.5) < 0.01, 'an image over 2^18 pixels is read on an even grid');
  assert.throws(() => values(flat, [1.5]), /values: at must be a list of shares from 0 to 1/);
  assert.throws(() => values(image(1, 1, () => [0, 0, 0, 0], 4)), /values: the image has no opaque pixel to read/);
});

test('structureField lies along the stripes, with a length near 1, and is zero on a flat image', () => {
  for (const angle of [0, 0.5, 1.2, Math.PI / 2, 2.4]) {
    const [vx, vy] = structureField(stripes(angle))(0.5, 0.5), length = Math.hypot(vx, vy);
    const cross = Math.abs(vx * Math.sin(angle) - vy * Math.cos(angle)) / length;
    assert.ok(length > 0.9 && length <= 1 + 1e-6, `coherence at angle ${angle} is ${length}`);
    assert.ok(cross < 0.06, `the vector lies along stripes at ${angle}, off by ${cross}`);
  }
  assert.deepEqual(structureField(image(40, 40, () => [90, 120, 60]))(0.3, 0.7), [0, 0]);
  const noise = image(96, 96, (x, y) => { const v = (x * 7919 + y * 104729 + x * y * 31) % 251; return [v, v, v]; });
  const [nx, ny] = structureField(noise)(0.5, 0.5);
  assert.ok(Math.hypot(nx, ny) < 0.3, `a neighbourhood that runs every way has low coherence, got ${Math.hypot(nx, ny)}`);
});

test('structureField is laid on a rectangle in design units and keeps the direction on a stretched one', () => {
  const img = stripes(Math.PI / 4);
  const square = structureField(img, [100, 200, 400, 400])(300, 400);
  assert.ok(Math.abs(Math.abs(square[0]) - Math.abs(square[1])) < 0.08, 'a 45 degree structure on a square rectangle');
  const wide = structureField(img, [0, 0, 800, 400])(400, 200);
  assert.ok(Math.abs(Math.abs(wide[0] / wide[1]) - 2) < 0.2, `stretched twice as wide, the line leans twice as flat, got ${wide}`);
  assert.throws(() => structureField(img, [0, 0, 1, 1], { smooth: 0.2 }), /structureField: smooth must be a share from 0 to 0.1/);
  assert.throws(() => structureField(img, [0, 0, 1, 1], { size: 8 }), /structureField: size must be a whole number of cells from 16 to 512, got 8/);
  assert.throws(() => structureField(img, [0, 0, 0, 1]), /structureField: rect must be \[x, y, w, h\] with a positive size/);
});

test('structureField never passes a length of 1, reads RGBA, and keeps one answer per size and smooth', () => {
  let longest = 0;
  for (let k = 0; k < 40; k++) {
    for (const smooth of [0, 0.01, 0.03]) longest = Math.max(longest, Math.hypot(...structureField(stripes(k * 0.079), [0, 0, 1, 1], { smooth })(0.5, 0.5)));
  }
  assert.ok(longest <= 1, `the coherence is at most 1, got ${longest}`);
  const rgb = stripes(0.5), rgba = image(96, 96, (x, y) => [...rgb.data.slice((y * 96 + x) * 3, (y * 96 + x) * 3 + 3), 7], 4);
  assert.deepEqual(structureField(rgba)(0.4, 0.6), structureField(rgb)(0.4, 0.6), 'alpha is not read');

  // Two halves whose lines run 90 degrees apart: near the seam the answer depends on the neighbourhood.
  const halves = () => image(96, 96, (x, y) => { const v = Math.round(127.5 + 110 * Math.sin((x < 48 ? x : y) * 0.7)); return [v, v, v]; });
  const one = halves(), tight = structureField(one, [0, 0, 1, 1], { smooth: 0 })(0.47, 0.5), wide = structureField(one, [0, 0, 1, 1], { smooth: 0.1 })(0.47, 0.5);
  assert.notDeepEqual(wide, tight, 'a second smooth on the same image is worked out, not read from the first');
  assert.deepEqual(structureField(halves(), [0, 0, 1, 1], { smooth: 0.1 })(0.47, 0.5), wide, 'and equals the answer of an image asked only for it');
  assert.deepEqual(structureField(one, [0, 0, 1, 1], { smooth: 0 })(0.47, 0.5), tight, 'the first answer is still the first');
  const img = quadrants(64);
  assert.equal(regions(img, 4).cols, 64);
  assert.equal(regions(img, 4, { size: 16 }).cols, 16, 'a second size on the same image is its own grid');
});

test('values reads from the middle of each step of its grid and interpolates between ranks', () => {
  // 1024 x 512 is read every second pixel, from pixel 1: only the odd ones, which are white here.
  const odd = image(1024, 512, (x, y) => (x % 2 && y % 2 ? [255, 255, 255] : [0, 0, 0]));
  assert.ok(Math.abs(values(odd, [0.5])[0] - 1) < 1e-3, 'the grid starts half a step in');
  const pair = image(2, 1, (x) => (x ? [255, 255, 255] : [0, 0, 0]));
  assert.ok(Math.abs(values(pair, [0.5])[0] - 0.5) < 1e-3, 'halfway between two ranks is halfway between their values');
});

test('regions gives about n blocks on a long image, exactly 1 for n = 1, and at most one a cell', () => {
  const long = (w, h) => image(w, h, (x, y) => [(x * 5) % 256, (y * 9) % 256, 90]);
  assert.equal(regions(long(300, 100), 1).regions.length, 1);
  assert.equal(regions(long(1000, 10), 64).regions.length, 64);
  assert.equal(regions(long(400, 100), 8).regions.length, 8);
  assert.equal(regions(long(192, 10), 16).regions.length, 16);
  const small = regions(long(16, 16), 4096);
  assert.equal(small.regions.length, 256, 'a 16 x 16 image holds at most 256 blocks');
  assert.ok(small.regions.every((r) => r.share > 0), 'and no block is empty');
});

test('an axial walk follows an orientation whose sign flips, and a plain walk turns back', () => {
  // The same horizontal line everywhere, named by a vector whose sign alternates with x.
  const field = (x) => (Math.floor(x) % 2 ? [-1, 0] : [1, 0]);
  const axial = streamline(field, [0.5, 0], { steps: 8, step: 1, axial: true });
  assert.deepEqual(axial.map((p) => Math.round(p[0] * 10) / 10), [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5]);
  const plain = streamline(field, [0.5, 0], { steps: 8, step: 1 });
  assert.ok(Math.max(...plain.map((p) => p[0])) < 2, 'without axial the walk turns back at the first flip');
  assert.throws(() => streamline(field, [0, 0], { axial: 1 }), /streamline: axial must be true or false/);
  const img = stripes(0.5), line = streamline(structureField(img, [0, 0, 96, 96]), [20, 48], { steps: 30, step: 1, axial: true, heading: 0.5 });
  const end = line[line.length - 1], run = Math.atan2(end[1] - 48, end[0] - 20);
  assert.ok(line.length === 30 && Math.abs(run - 0.5) < 0.06, `a walk along stripes at 0.5 rad runs at ${run}`);
});

test('regions cuts the image into blocks of like colour and is the same on every run', () => {
  const img = quadrants(64), four = regions(img, 4);
  assert.equal(four.regions.length, 4);
  assert.deepEqual(four.regions.map((r) => r.colour), ['#c82828', '#28a03c', '#283cc8', '#e6d23c'], 'each block holds one quadrant, in seed order');
  for (const r of four.regions) assert.ok(Math.abs(r.share - 0.25) < 1e-9, `share ${r.share}`);
  assert.deepEqual(four.regions[0].centre, [0.25, 0.25]);
  assert.deepEqual(four.regions[3].box, [0.5, 0.5, 1, 1]);
  assert.equal(four.at(0.1, 0.1), 0);
  assert.equal(four.at(0.9, 0.9), 3);
  assert.equal(four.label.length, four.cols * four.rows);

  const many = regions(img, 36), pure = new Set(four.regions.map((r) => r.colour));
  assert.equal(many.regions.length, 36);
  const mixed = many.regions.filter((r) => !pure.has(r.colour)).length;
  assert.equal(mixed, 0, 'no block straddles two quadrants');
  assert.ok(Math.abs(many.regions.reduce((s, r) => s + r.share, 0) - 1) < 1e-9, 'the blocks cover the image');
  const again = regions(quadrants(64), 36);
  let differ = -1;
  for (let i = 0; i < many.label.length && differ < 0; i++) if (many.label[i] !== again.label[i]) differ = i;
  assert.equal(differ, -1, 'the same image gives the same blocks');
  assert.throws(() => regions(img, 0), /regions: n must be a whole number from 1 to 4096, got 0/);
  assert.throws(() => regions(img, 4, { compactness: 0 }), /regions: compactness must be positive and finite/);
});

test('regions follows the colour more as compactness falls', () => {
  // A diagonal split: square blocks straddle it, loose ones follow it.
  const img = image(64, 64, (x, y) => (x + y < 64 ? [220, 60, 40] : [40, 70, 210]));
  const pure = new Set(['#dc3c28', '#2846d2']);
  const straddling = (compactness) => regions(img, 16, { compactness }).regions.filter((r) => !pure.has(r.colour)).length;
  assert.ok(straddling(0.02) < straddling(5), `loose ${straddling(0.02)}, square ${straddling(5)}`);
});
