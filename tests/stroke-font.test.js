'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const font = require('../core/stroke-font.js');
const legacy = require('../examples/stroke-font.js');
const { bundle } = require('../tools/build-page.js');

test('the legacy stroke-font path preserves the canonical module and glyph data identity', () => {
  assert.equal(legacy, font);
  assert.equal(legacy.GLYPHS, font.GLYPHS);
  assert.deepEqual(font.glyph('T'), [[[0, 0], [4, 0]], [[2, 0], [2, 7]]]);
  assert.deepEqual(font.glyph('t'), font.glyph('T'));
  assert.deepEqual(font.glyph('§'), []);
  assert.deepEqual(font.glyph(' '), []);
});

test('the shared stroke font preserves cap-height geometry and independent pen strokes', () => {
  const ops = [];
  const surface = {
    beginPath() { ops.push(['begin']); },
    moveTo(...point) { ops.push(['move', ...point]); },
    lineTo(...point) { ops.push(['line', ...point]); },
    stroke() { ops.push(['stroke']); },
  };
  assert.equal(font.text(surface, 'T', 10, 20, 14), 18);
  assert.equal(font.width('T', 14), 8);
  assert.equal(font.width('', 14), 0);
  assert.equal(font.runCount('T T'), 4);
  assert.deepEqual(ops, [
    ['begin'], ['move', 10, 20], ['line', 18, 20], ['stroke'],
    ['begin'], ['move', 14, 20], ['line', 14, 34], ['stroke'],
  ]);
});

test('the browser bundle resolves both font paths to one module for its example consumers', () => {
  const context = {};
  vm.runInNewContext(bundle(), context);
  const load = context.__require('');
  const canonical = load('core/stroke-font.js');
  assert.equal(load('examples/stroke-font.js'), canonical);
  assert.equal(JSON.stringify(canonical.glyph('T')), JSON.stringify(font.glyph('T')));
  const examples = load('examples/index.js');
  for (const name of ['specimen', 'attractor', 'cover']) assert.equal(examples[name].name, name);
});
