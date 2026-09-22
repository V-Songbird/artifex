'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validate, solve, clockAt, frameCount } = require('../core/piece.js');
const { drawFrame, renderVector } = require('../core/render.js');
const { uniformData } = require('../core/webgpu-preview.js');
const pixelField = require('../examples/pixel-field.js');

const piece = validate(pixelField);

// Capture the real RGBA bytes supplied to putImageData. No browser, GPU or
// private artifact is needed to exercise the CPU reference's pixel behavior.
function rasterSurface(canvas) {
  let transform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const stack = [];
  return {
    canvas,
    images: [],
    save() { stack.push({ ...transform }); },
    restore() { transform = stack.pop(); },
    scale(x, y) { transform.a *= x; transform.d *= y; },
    getTransform() { return { ...transform }; },
    createImageData(width, height) {
      assert.ok(Number.isInteger(width) && width > 0);
      assert.ok(Number.isInteger(height) && height > 0);
      return { width, height, data: new Uint8ClampedArray(width * height * 4) };
    },
    putImageData(image, x, y) {
      assert.deepEqual([x, y], [0, 0]);
      this.images.push(image);
    },
  };
}

function render(seed = 1, t = 0.5, params, scale = 1 / 15, canvas) {
  const solved = solve(piece, seed, params);
  assert.equal(solved.stages.error, null);
  const surface = rasterSurface(canvas);
  drawFrame(surface, piece, solved, t, { scale });
  assert.equal(surface.images.length, 1);
  assert.deepEqual(surface.getTransform(), { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  return surface.images[0];
}

function difference(a, b) {
  assert.equal(a.data.length, b.data.length);
  let sum = 0, max = 0, changed = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    let pixel = 0;
    for (let c = 0; c < 3; c++) {
      const delta = Math.abs(a.data[i + c] - b.data[i + c]);
      sum += delta; max = Math.max(max, delta); pixel += delta;
    }
    if (pixel) changed++;
  }
  return { mean: sum / (a.width * a.height * 3), max, fraction: changed / (a.width * a.height) };
}

function assertMeaningfulChange(a, b, label) {
  const d = difference(a, b);
  assert.ok(d.mean > 2, label + ': mean RGB difference must exceed two byte levels');
  assert.ok(d.max > 20, label + ': some structure must move substantially');
  assert.ok(d.fraction > 0.75, label + ': response must cover most of the field');
}

test('pixel-field declares a raster reference and authored optional preview', () => {
  assert.equal(piece.name, 'pixel-field');
  assert.deepEqual(piece.size, { w: 960, h: 540 });
  assert.deepEqual(piece.outputs, ['raster']);
  assert.equal(piece.time.duration, 8);
  assert.equal(piece.time.hz, 30);
  assert.equal(piece.time.loop, false);
  assert.equal(frameCount(piece), 240);
  assert.equal(piece.preview.kind, 'webgpu-pixels');
  assert.throws(() => renderVector(piece), /has not declared vector output/);
});

test('pixel-field prepares inspectable immutable octaves shared by CPU drawing and GPU uniforms', () => {
  const solved = solve(piece, 1, undefined, { until: 'prepare field octaves' });
  assert.equal(solved.stages.error, null);
  assert.deepEqual(solved.stages.ms.map(([name]) => name), ['prepare field octaves']);
  assert.deepEqual(solved.state.field, {
    weights: [0.5, 0.25, 0.125, 0.0625], frequencies: [1, 2, 4, 8], normalization: 0.9375,
  });
  assert.ok(Object.isFrozen(solved.state.field));
  assert.ok(Object.isFrozen(solved.state.field.weights));
  assert.ok(Object.isFrozen(solved.state.field.frequencies));
  const normal = rasterSurface(), changed = rasterSurface();
  drawFrame(normal, piece, solved, 0.5, { scale: 1 / 15 });
  const altered = { ...solved, state: { ...solved.state, field: {
    weights: [0.5, 0, 0, 0], frequencies: [1, 2, 4, 8], normalization: 0.5,
  } } };
  drawFrame(changed, piece, altered, 0.5, { scale: 1 / 15 });
  assertMeaningfulChange(normal.images[0], changed.images[0], 'prepared octave spectrum');
  assert.deepEqual(piece.preview.uniforms(altered.state).slice(2), [0.5, 0, 0.5, 0, 0, 0, 1, 2, 4, 8]);
});

test('pixel-field repeats exact pixels after arbitrary playhead visits without changing solved state', () => {
  const solved = solve(piece, 27, { frequency: 7.25, warp: 1.3 });
  const before = structuredClone(solved.state);
  Object.freeze(solved.state.params);
  Object.freeze(solved.state);
  const surface = rasterSurface();
  for (const t of [0.5, 0, 1, 0.25, 0.5]) drawFrame(surface, piece, solved, t, { scale: 1 / 15 });
  assert.deepEqual(surface.images[0], surface.images[4]);
  assert.notStrictEqual(surface.images[0].data, surface.images[4].data);
  assert.deepEqual(solved.state, before);
  assert.deepEqual(render(27, 0.5, before.params), surface.images[0]);
});

test('pixel-field quantizes time and visibly responds to different drawn frames', () => {
  assert.deepEqual(render(1, 0), render(1, 0.0001));
  assertMeaningfulChange(render(1, 0), render(1, 0.5), 'animation');
  assertMeaningfulChange(render(1, 0.5), render(1, 1), 'animation endpoint');
});

test('pixel-field is opaque, spatially varied and seed-sensitive across nine seeds', () => {
  const frames = [];
  for (let seed = 1; seed <= 9; seed++) {
    const image = render(seed);
    const red = new Set();
    let low = 255, high = 0;
    for (let i = 0; i < image.data.length; i += 4) {
      assert.equal(image.data[i + 3], 255);
      low = Math.min(low, image.data[i]); high = Math.max(high, image.data[i]);
      red.add(image.data[i]);
    }
    assert.ok(high - low > 100, 'seed ' + seed + ' needs substantial spatial contrast');
    assert.ok(red.size > 64, 'seed ' + seed + ' needs a continuous, nonempty color field');
    if (frames.length) assertMeaningfulChange(frames[0], image, 'seed ' + seed);
    frames.push(image);
  }
});

test('pixel-field frequency and warp each affect pixels throughout their declared ranges', () => {
  for (const [name, control] of Object.entries(piece.params)) {
    const frames = [control.min, control.value, control.max].map((value) => render(13, 0.5, { [name]: value }));
    assertMeaningfulChange(frames[0], frames[1], name + ' min/default');
    assertMeaningfulChange(frames[1], frames[2], name + ' default/max');
    assertMeaningfulChange(frames[0], frames[2], name + ' min/max');
  }
});

test('pixel-field preserves shared pixel-center composition across raster scales', () => {
  for (const seed of [0, 0xffffffff]) {
    const low = render(seed, 0.75);
    const high = render(seed, 0.75, undefined, 3 / 15);
    assert.deepEqual([low.width, low.height, high.width, high.height], [64, 36, 192, 108]);
    let lowRed = 255, highRed = 0;
    for (let y = 0; y < low.height; y++) for (let x = 0; x < low.width; x++) {
      const i = (y * low.width + x) * 4;
      const j = ((y * 3 + 1) * high.width + x * 3 + 1) * 4;
      assert.deepEqual(low.data.subarray(i, i + 4), high.data.subarray(j, j + 4));
      lowRed = Math.min(lowRed, low.data[i]); highRed = Math.max(highRed, low.data[i]);
    }
    assert.ok(highRed - lowRed > 100, 'shared samples must contain a meaningful field');
  }
});

test('pixel-field fills actual backing dimensions when rounding differs from surface scale', () => {
  const image = render(1, 0.5, undefined, 1 / 15, { width: 65, height: 37 });
  assert.deepEqual([image.width, image.height, image.data.length], [65, 37, 65 * 37 * 4]);
  assert.equal(image.data[3], 255);
  assert.equal(image.data[image.data.length - 1], 255);
  const repeated = render(1, 0.5, undefined, 1 / 15, { width: 65, height: 37 });
  assert.deepEqual(image, repeated);
});

test('pixel-field uses the same normalized seeds and controls as the GPU uniform ABI', () => {
  for (const seed of [0, 1, 0x80000000, 0xffffffff, -1, 2 ** 32, 7.75]) {
    const solved = solve(piece, seed, { frequency: 7.25, warp: 1.3 });
    const inputs = uniformData(piece, solved, 0.456, 64, 36);
    const uints = new Uint32Array(inputs.data), floats = new Float32Array(inputs.data);
    assert.equal(uints[2], seed >>> 0);
    assert.equal(uints[2], solved.state.seed);
    assert.equal(uints[3], clockAt(piece, 0.456).frame);
    assert.equal(floats[5], Math.fround(clockAt(piece, 0.456).seconds));
    assert.deepEqual(Array.from(floats.subarray(8, 20)),
      [Math.fround(7.25), Math.fround(1.3), 0.9375, 0, 0.5, 0.25, 0.125, 0.0625, 1, 2, 4, 8]);
    assert.ok(floats.subarray(20).every((value) => value === 0));
    assert.deepEqual(render(seed, 0.456, solved.state.params), render(seed >>> 0, 0.456, solved.state.params));
  }
  assertMeaningfulChange(render(0), render(0xffffffff), 'unsigned edge seeds');
});
