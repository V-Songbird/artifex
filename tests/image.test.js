'use strict';

// core/image.js: the decoded bytes a solve hands out, the readers sample, tone,
// toneField and fit, and show, which puts the pixels on a raster surface once
// per solve and canvas, refuses on a vector surface and skips a stand-in.

const test = require('node:test');
const assert = require('node:assert/strict');
const { solved, describe, sample, tone, toneField, fit, show } = require('../core/image.js');
const { VectorSurface } = require('../core/surface-vector.js');

/** A declared image whose bytes are `bytes`, row by row. */
const declared = (w, h, channels, bytes) => ({ w, h, channels, pixels: Buffer.from(bytes).toString('base64'), source: 'made from code', rights: 'the tests\'' });
/** That image as a solve hands it out. */
const solvedOf = (w, h, channels, bytes) => solved({ img: declared(w, h, channels, bytes) }).img;

test('the bytes a solve hands out are the base64 text decoded, as Buffer decodes it', () => {
  // Every byte value, in a length whose text needs padding, and a large image.
  for (const length of [256 * 3 + 1, 300 * 200 * 3]) {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 131 + (i >> 8)) % 256);
    const w = length % 3 ? length : length / 3, channels = length % 3 ? 1 : 3;
    const img = declared(w, length / channels / w, channels, bytes);
    const data = solved({ img }).img.data;
    const want = Buffer.from(img.pixels, 'base64');
    assert.equal(data.length, want.length);
    let at = -1;
    for (let i = 0; i < want.length && at < 0; i++) if (data[i] !== want[i]) at = i;
    assert.equal(at, -1, `the first differing byte of ${length}`);
  }
  // describe reads the same bytes: its digest changes with one of them.
  const a = describe({ img: declared(2, 1, 1, [1, 2]) }).img.digest;
  assert.notEqual(describe({ img: declared(2, 1, 1, [1, 3]) }).img.digest, a);
  assert.equal(describe({ img: declared(2, 1, 1, [1, 2]) }).img.digest, a);
});

test('sample reads bilinearly between pixel centres, in R, G, B, A order, and holds the edge outside', () => {
  // Two by two RGBA: each pixel's channels apart, so an order swap shows.
  const img = solvedOf(2, 2, 4, [
    10, 20, 30, 255, 50, 60, 70, 255,
    90, 100, 110, 255, 130, 140, 150, 155,
  ]);
  assert.deepEqual(sample(img, 0.25, 0.25), [10, 20, 30, 255], 'a pixel centre is the pixel');
  assert.deepEqual(sample(img, 0.75, 0.75), [130, 140, 150, 155]);
  assert.deepEqual(sample(img, 0, 0), [10, 20, 30, 255], 'a corner holds its pixel');
  assert.deepEqual(sample(img, -3, 9), [90, 100, 110, 255], 'outside is clamped to the edge');
  assert.deepEqual(sample(img, 0.5, 0.5), [70, 80, 90, 230], 'the centre averages the four');
  assert.deepEqual(sample(img, 0.5, 0.25), [30, 40, 50, 255], 'halfway along the top row');
  const rgb = solvedOf(2, 1, 3, [200, 100, 0, 0, 100, 200]);
  assert.deepEqual(sample(rgb, 0.25, 0.5), [200, 100, 0, 255], 'no alpha channel reads opaque');
  const grey = solvedOf(1, 1, 1, [77]);
  assert.deepEqual(sample(grey, 0.5, 0.5), [77, 77, 77, 255], 'grey reads as three equal channels');
  assert.throws(() => sample(img, NaN, 0), /^RangeError: sample: u and v must be finite numbers, got NaN, 0$/);
  assert.throws(() => sample(declared(1, 1, 1, [0]), 0, 0), /^TypeError: sample: takes an image of the solved state, such as state\.images\.photo$/);
});

test('tone is Rec. 709 luma in [0, 1], and toneField lays it on a rectangle in design units', () => {
  const near = (got, want, why) => assert.ok(Math.abs(got - want) < 1e-9, `${why || ''}: ${got}, not ${want}`);
  const img = solvedOf(3, 1, 3, [255, 0, 0, 0, 255, 0, 255, 255, 255]);
  near(tone(img, 1 / 6, 0.5), 0.2126, 'red');
  near(tone(img, 0.5, 0.5), 0.7152, 'green');
  near(tone(img, 5 / 6, 0.5), 1, 'white');
  assert.ok(tone(img, 5 / 6, 0.5) <= 1, 'white is never a hair above 1');
  assert.equal(tone(solvedOf(1, 1, 1, [51]), 0.5, 0.5), 0.2);
  const field = toneField(img, [100, 0, 300, 10]);
  near(field(150, 5), 0.2126, 'design x 150 is a sixth of the way across a rectangle from 100 to 400');
  near(field(250, 5), 0.7152, 'the middle');
  near(field(0, 5), 0.2126, 'left of the rectangle holds its edge');
  near(toneField(img)(0.5, 0.5), 0.7152, 'by default the rectangle is the unit square');
});

test('fit covers a box, cut on one axis, or sits whole inside it, centred', () => {
  const img = { w: 200, h: 100 };
  assert.deepEqual(fit(img, [0, 0, 100, 100]), [-50, 0, 200, 100], 'cover is the default');
  assert.deepEqual(fit(img, [0, 0, 100, 100], 'contain'), [0, 25, 100, 50]);
  assert.deepEqual(fit(img, [10, 20, 400, 200], 'cover'), [10, 20, 400, 200], 'the same aspect fills the box either way');
  assert.throws(() => fit(img, [0, 0, 1, 1], 'stretch'), /^TypeError: fit: mode must be 'cover' or 'contain', got "stretch"$/);
  assert.throws(() => fit(img, [0, 0, 0, 1]), /^RangeError: fit: box must be \[x, y, w, h\] with a positive size$/);
  // A misspelt name, such as state.images.phot0, is refused, not placed at NaN.
  for (const bad of [undefined, {}, { w: 0, h: 1 }]) {
    assert.throws(() => fit(bad, [0, 0, 1, 1]), /^TypeError: fit: takes an image of the solved state, such as state\.images\.photo, or a declared one$/);
  }
});

/** A raster stand-in: a context whose canvas makes canvases through its document, counting what each is given. */
function raster() {
  const log = { made: 0, puts: [], draws: [], smoothing: [] };
  const context = () => ({
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: (data) => log.puts.push(Array.from(data.data)),
  });
  const document = { createElement: () => { log.made++; const c = { width: 0, height: 0, getContext: context }; return c; } };
  const g = {
    canvas: { width: 10, height: 10, ownerDocument: document },
    imageSmoothingEnabled: false, imageSmoothingQuality: 'low', saved: [],
    save() { this.saved.push([this.imageSmoothingEnabled, this.imageSmoothingQuality]); },
    restore() { [this.imageSmoothingEnabled, this.imageSmoothingQuality] = this.saved.pop(); },
    drawImage(c, ...at) { log.draws.push([c, ...at]); log.smoothing.push([this.imageSmoothingEnabled, this.imageSmoothingQuality]); },
  };
  return { g, log };
}

test('show puts the pixels once per solve and canvas, as RGBA, and draws them smoothed where asked', () => {
  const { g, log } = raster();
  const img = solvedOf(2, 1, 1, [5, 250]);
  show(g, img, 1, 2, 30, 40);
  show(g, img, 0, 0, 10, 10);
  assert.equal(log.made, 1, 'one canvas for the image on this canvas');
  assert.deepEqual(log.puts, [[5, 5, 5, 255, 250, 250, 250, 255]], 'grey widened to opaque RGBA, put once');
  assert.deepEqual(log.draws.map((d) => d.slice(1)), [[1, 2, 30, 40], [0, 0, 10, 10]]);
  assert.equal(log.draws[0][0], log.draws[1][0], 'both draws use the one copy');
  assert.deepEqual(log.smoothing, [[true, 'high'], [true, 'high']]);
  assert.deepEqual([g.imageSmoothingEnabled, g.imageSmoothingQuality], [false, 'low'], 'the caller\'s smoothing comes back');
  // A build that changed its copy of the bytes shows them changed, and another solve is put anew.
  const edited = solvedOf(2, 1, 1, [5, 250]);
  edited.data[1] = 0;
  show(g, edited, 0, 0, 1, 1);
  assert.deepEqual(log.puts[1], [5, 5, 5, 255, 0, 0, 0, 255]);
  // Another canvas gets its own copy.
  const other = raster();
  show(other.g, img, 0, 0, 1, 1);
  assert.equal(other.log.made, 1);
  const rgba = raster();
  show(rgba.g, solvedOf(1, 1, 4, [1, 2, 3, 4]), 0, 0, 1, 1);
  assert.deepEqual(rgba.log.puts, [[1, 2, 3, 4]]);
});

test('show refuses on a vector surface by name, and draws nothing on a stand-in without a canvas', () => {
  const img = solvedOf(1, 1, 3, [1, 2, 3]);
  assert.throws(() => show(new VectorSurface({ w: 10, h: 10 }), img, 0, 0, 10, 10),
    /^Error: show: a vector surface has no pixels, so it cannot show an image\. Call show under if \(g\.canvas\) so the SVG keeps the marks alone, or declare outputs: \["raster"\]$/);
  const calls = [];
  show({ fillRect: () => calls.push('fillRect') }, img, 0, 0, 10, 10);
  assert.deepEqual(calls, []);
  assert.throws(() => show(raster().g, img, 0, 0, Infinity, 1), /^RangeError: show: x, y, w and h must be finite numbers, got 0, 0, Infinity, 1$/);
});

test('show is one drawImage mark on the surface layerSwaps records, so a raster-only piece can be checked', () => {
  const { recordMarks } = require('../tools/contact-sheet.js');
  const img = solvedOf(4, 2, 1, [0, 1, 2, 3, 4, 5, 6, 7]);
  const marks = recordMarks({ w: 100, h: 100 }, (g) => {
    show(g, img, 10, 20, 40, 20);
    g.fillRect(15, 25, 5, 5);
  });
  assert.deepEqual(marks.map((m) => [m.op, m.box]), [['drawImage', [10, 20, 50, 40]], ['fillRect', [15, 25, 20, 30]]]);
});

test('npm run image writes a file name with a line break in it escaped, so the header comment runs no code', () => {
  const vm = require('node:vm');
  const { imageModule } = require('../tools/image.js');
  const options = { width: null, channels: null, source: 's', rights: 'r' };
  for (const end of ['\n', '\r', String.fromCharCode(0x2028), String.fromCharCode(0x2029)]) {
    const { text } = imageModule({ w: 1, h: 1, rgba: Uint8Array.of(1, 2, 3, 255) }, options, 'a' + end + 'globalThis.INJECTED = 1;//.png');
    const context = vm.createContext({ module: { exports: {} } });
    vm.runInContext(text, context);
    assert.equal(context.INJECTED, undefined, JSON.stringify(end));
    assert.equal(context.module.exports.w, 1);
    assert.match(text.split('\n')[0], /^\/\/ a\\u000[ad]|^\/\/ a\\u202[89]/);
  }
});
