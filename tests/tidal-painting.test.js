'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { validate, solve } = require('../core/piece.js');
const { drawFrame } = require('../core/render.js');
const piece = validate(require('../examples/tidal-painting.js'));

const hash = (image) => createHash('sha256').update(image.data).digest('hex');

function build(seed = piece.seed, params = {}, options) {
  const result = solve(piece, seed, params, options);
  assert.equal(result.stages.error, null, JSON.stringify(result.stages.error));
  return result;
}

function checkImage(image) {
  assert.equal(image.w, 480);
  assert.equal(image.h, 360);
  assert.equal(image.channels, 4);
  assert.equal(image.data.constructor, Uint8Array, 'show receives ordinary Uint8Array pixels');
  assert.equal(image.data.length, image.w * image.h * 4);
  assert.ok(Object.isFrozen(image), 'published image metadata cannot be reassigned');
  let transparent = 0;
  for (let i = 3; i < image.data.length; i += 4) if (image.data[i] !== 255) transparent++;
  assert.equal(transparent, 0, 'the sheet is opaque');
}

test('tidal painting is a bounded raster still with validated controls', () => {
  assert.deepEqual(piece.size, { w: 720, h: 540 });
  assert.deepEqual(piece.outputs, ['raster']);
  assert.ok(!piece.time);
  assert.deepEqual(piece.build.map(([name]) => name), ['paper', 'wash', 'body paint', 'finish']);
  for (const [name, control] of Object.entries(piece.params)) {
    assert.ok(control.value >= control.min && control.value <= control.max);
    assert.throws(() => solve(piece, 14, { [name]: control.min - 1 }), new RegExp(`params.${name}`));
    assert.throws(() => solve(piece, 14, { [name]: NaN }), new RegExp(`params.${name}`));
  }
  assert.throws(() => solve(piece, 14, { humidity: 0.5 }), /unknown param/);
});

test('repeated solves are deterministic and a different seed changes the painting', () => {
  const a = build(), b = build(), c = build(piece.seed + 1);
  checkImage(a.state.image);
  assert.equal(a.stages.ms.length, piece.build.length);
  assert.notEqual(a.state.image.data, b.state.image.data, 'solves own independent snapshots');
  assert.equal(hash(a.state.image), hash(b.state.image));
  assert.notEqual(hash(a.state.image), hash(c.state.image));
  assert.ok(!('medium' in a.state), 'the finished state releases the mutable simulation');
  assert.deepEqual(a.manifest.params, { water: 1.1, load: 1, tooth: 0.25 });
});

test('each control changes a visible area between its supported endpoints', () => {
  for (const [name, control] of Object.entries(piece.params)) {
    const low = build(piece.seed, { [name]: control.min }).state.image;
    const high = build(piece.seed, { [name]: control.max }).state.image;
    checkImage(low);
    checkImage(high);
    let changed = 0;
    for (let i = 0; i < low.data.length; i += 4) {
      const difference = Math.abs(low.data[i] - high.data[i])
        + Math.abs(low.data[i + 1] - high.data[i + 1])
        + Math.abs(low.data[i + 2] - high.data[i + 2]);
      if (difference >= 6) changed++;
    }
    assert.ok(changed > low.w * low.h * 0.01, `${name}: only ${changed} pixels changed by at least six RGB levels`);
  }
});

test('later painting stages cannot modify published stage snapshots', () => {
  const partial = build(piece.seed, {}, { until: 'paper' });
  assert.equal(partial.stages.ms.length, 1);
  const retained = [];
  const remember = () => {
    checkImage(partial.state.image);
    retained.push({ image: partial.state.image, digest: hash(partial.state.image) });
  };
  remember();
  for (const [, stage] of piece.build.slice(1)) {
    stage(partial.state);
    for (const previous of retained) {
      assert.notEqual(partial.state.image.data, previous.image.data);
      assert.equal(hash(previous.image), previous.digest, 'a retained stage keeps its pixels');
    }
    remember();
  }
  assert.notEqual(retained[0].digest, retained[1].digest, 'watercolor marks change the blank paper');
  assert.notEqual(retained[1].digest, retained[2].digest, 'body paint changes the wash');
  assert.ok(!('medium' in partial.state));

  // The diagnostic recording surface checks draw behavior without pretending
  // to render native pixels. A real raster review is a separate check.
  const calls = [];
  const g = {
    kind: 'vector', save() {}, restore() {}, scale() {},
    drawImage(source, ...box) { calls.push({ width: source.width, height: source.height, box }); },
  };
  const finalImage = partial.state.image, digest = hash(finalImage);
  for (const t of [0, 1, 0.4, 0]) drawFrame(g, piece, partial, t);
  assert.equal(calls.length, 4);
  for (const call of calls) assert.deepEqual(call, { width: 480, height: 360, box: [0, 0, 720, 540] });
  assert.equal(partial.state.image, finalImage);
  assert.equal(hash(finalImage), digest, 'repeated and out-of-order draws are pure queries');
});
