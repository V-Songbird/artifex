'use strict';

// core/layer.js keeps a copy of a static layer on a raster surface. Node has no
// canvas, so these checks run on the shared stand-in canvas, fakeCanvas in
// tests/fake-media.js: fillRect by pixel centres with source-over in 8-bit
// RGBA, drawImage of whole regions, getImageData and the surface's transform.
// Antialiasing and GPU canvases are checked in a browser; these pin the rules:
// when a copy is kept, that it equals drawing, and when it is refused.

const test = require('node:test');
const assert = require('node:assert');
const { layer } = require('../core/layer.js');
const { VectorSurface } = require('../core/surface-vector.js');
const { nullSurface } = require('../tools/bench.js');
const { fakeCanvas } = require('./fake-media.js');

const DOCUMENT = { createElement: () => canvas(0, 0) };

/** A canvas that core/layer.js can copy from: it makes its copies in its own document. */
function canvas(width, height) { return fakeCanvas({ width, height, ownerDocument: DOCUMENT }, nullSurface); }

/** One frame: clear, a plain scale, the layer, then a mark that moves with t. */
function frame(g, state, t, paint, opt = {}) {
  g.clearRect(0, 0, g.canvas.width, g.canvas.height);
  g.save();
  g.setTransform(opt.scale || 1, 0, 0, opt.scale || 1, opt.dx || 0, 0);
  if (opt.rotate) g.rotate(opt.rotate);
  if (opt.before) opt.before(g, t);
  layer(g, state, 'ground', [0, 0, 10, 6], paint, opt.cap === undefined ? undefined : { cap: opt.cap });
  g.fillStyle = '#20306080';
  g.fillRect(t, 1, 3, 2);
  g.restore();
  return Array.from(g.getImageData(0, 0, g.canvas.width, g.canvas.height).data);
}

/** The same frame on a fresh canvas and a fresh solve, where nothing is kept. */
function drawn(t, paint, opt = {}) {
  const k = opt.scale || 1;
  return frame(canvas(10 * k, 6 * k).getContext('2d'), {}, t, paint, opt);
}

function counted(paint) {
  const f = (g, s) => { f.calls++; paint(g, s); };
  f.calls = 0;
  return f;
}

// An opaque ground with a translucent mark on it: static, and heavy for its size.
const ground = (g) => {
  g.fillStyle = '#e8e0d0';
  g.fillRect(0, 0, 10, 6);
  g.fillStyle = '#c0402040';
  g.fillRect(2, 2, 5, 3);
};

test('a static layer is copied from its second draw, and every frame equals drawing it', () => {
  const paint = counted(ground);
  const g = canvas(20, 12).getContext('2d');
  const state = {};
  for (const t of [0, 1, 2, 3, 4, 5]) {
    assert.deepEqual(frame(g, state, t, paint, { scale: 2 }), drawn(t, ground, { scale: 2 }), `frame ${t} differs from drawing it`);
  }
  assert.equal(paint.calls, 3, 'painted on the first frame, then on the second with its opacity check, then copied');
});

test('each device scale keeps its own copy', () => {
  const paint = counted(ground);
  const state = {};
  const one = canvas(10, 6).getContext('2d');
  const two = canvas(20, 12).getContext('2d');
  for (const t of [0, 1, 2, 3]) {
    assert.deepEqual(frame(one, state, t, paint, { scale: 1 }), drawn(t, ground, { scale: 1 }), `1x frame ${t}`);
    assert.deepEqual(frame(two, state, t, paint, { scale: 2 }), drawn(t, ground, { scale: 2 }), `2x frame ${t}`);
  }
  // Same canvas, two scales: the second scale may not reuse the first's copy.
  const g = canvas(20, 12).getContext('2d');
  for (const [t, scale] of [[0, 1], [1, 1], [2, 1], [3, 2], [4, 2], [5, 2]]) {
    const fresh = frame(canvas(20, 12).getContext('2d'), {}, t, ground, { scale });
    assert.deepEqual(frame(g, state, t, paint, { scale }), fresh, `frame ${t} at ${scale}x`);
  }
});

test('a translucent layer is drawn every time, never copied', () => {
  // A copy would carry whatever the frame drew under it when it was taken.
  const sheer = (g) => { g.fillStyle = '#ffffff80'; g.fillRect(0, 0, 10, 6); };
  const veil = counted(sheer);
  const under = (g, t) => { g.fillStyle = t % 2 ? '#102030' : '#a0b0c0'; g.fillRect(0, 0, 10, 6); };
  const g = canvas(10, 6).getContext('2d');
  const state = {};
  for (const t of [0, 1, 2, 3, 4]) {
    assert.deepEqual(frame(g, state, t, veil, { before: under }), drawn(t, sheer, { before: under }), `frame ${t}`);
  }
  assert.equal(veil.calls, 5 + 1, 'drawn on every frame, and painted once more to judge its opacity');
});

test('past the cap a layer is drawn every time', () => {
  const paint = counted(ground);
  const g = canvas(20, 12).getContext('2d');
  const state = {};
  for (const t of [0, 1, 2, 3]) {
    assert.deepEqual(frame(g, state, t, paint, { scale: 2, cap: 20 * 12 - 1 }), drawn(t, ground, { scale: 2 }), `frame ${t}`);
  }
  assert.equal(paint.calls, 4, 'one paint per frame, and no copy');
});

test('a rotated surface or a box off the pixel grid is drawn every time', () => {
  for (const opt of [{ rotate: 0.3 }, { dx: 0.5 }]) {
    const paint = counted(ground);
    const g = canvas(10, 6).getContext('2d');
    const state = {};
    for (const t of [0, 1, 2, 3]) frame(g, state, t, paint, opt);
    assert.equal(paint.calls, 4, JSON.stringify(opt));
  }
});

test('a copy belongs to its canvas and its solve', () => {
  const paint = counted(ground);
  const a = canvas(10, 6).getContext('2d');
  const b = canvas(10, 6).getContext('2d');
  const state = {};
  for (const t of [0, 1, 2]) frame(a, state, t, paint);
  assert.equal(paint.calls, 3);
  frame(b, state, 3, paint);
  assert.equal(paint.calls, 4, 'another canvas starts again');
  frame(a, {}, 4, paint);
  assert.equal(paint.calls, 5, 'and so does another solve');
});

test('a paint that takes a playhead is refused by name', () => {
  const g = canvas(10, 6).getContext('2d');
  assert.throws(() => layer(g, {}, 'ground', [0, 0, 10, 6], (s, st, t) => t), /layer "ground": paint takes the surface and the solved state, and never the playhead/);
});

test('vector and null surfaces run paint on every draw and keep every path', () => {
  const lines = (g) => { g.fillStyle = '#e8e0d0'; g.fillRect(0, 0, 10, 6); g.beginPath(); g.moveTo(1, 1); g.lineTo(9, 5); g.stroke(); };
  const paint = counted(lines);
  const svg = (use) => {
    const g = new VectorSurface({ w: 10, h: 6 });
    if (use) layer(g, {}, 'ground', [0, 0, 10, 6], paint);
    else { g.save(); lines(g); g.restore(); }
    return g.toSVG();
  };
  const state = {};
  const shared = (g) => layer(g, state, 'ground', [0, 0, 10, 6], paint);
  for (let i = 0; i < 3; i++) {
    const g = new VectorSurface({ w: 10, h: 6 });
    shared(g);
    assert.equal(g.toSVG(), svg(false), 'the document is the one drawing it writes');
    assert.doesNotMatch(g.toSVG(), /<image/, 'and it holds no bitmap');
  }
  const n = nullSurface({ w: 10, h: 6 });
  for (let i = 0; i < 3; i++) shared(n);
  assert.equal(paint.calls, 6, 'paint ran on every draw of both surfaces');
  assert.equal(svg(true), svg(false));
});

test('the shared stand-in canvas paints under transforms, globalAlpha and region copies as a canvas does', () => {
  // Every expected pixel is worked out by hand from the rule fakeCanvas states.
  const at = (g, x, y) => Array.from(g.getImageData(x, y, 1, 1).data);
  const [RED, NONE] = [[255, 0, 0, 255], [0, 0, 0, 0]];
  const c = canvas(4, 4);
  const g = c.getContext('2d');
  assert.equal(c.getContext('2d'), g, 'a canvas has one 2D context');
  assert.equal(c.getContext('webgl2'), null, 'and no context of another kind beside it');
  assert.deepEqual(g.getContextAttributes(), { alpha: true, colorSpace: 'srgb', desynchronized: false, willReadFrequently: false });

  // A scale of 2 makes a unit square cover four device pixels.
  g.fillStyle = '#ff0000';
  g.save(); g.scale(2, 2); g.fillRect(0, 0, 1, 1); g.restore();
  assert.deepEqual([at(g, 0, 0), at(g, 1, 1), at(g, 2, 0), at(g, 0, 2)], [RED, RED, NONE, NONE]);
  // A pixel centre on the rectangle's left edge is covered; one on its right edge is not.
  g.clearRect(0, 0, 4, 4);
  g.setTransform(1, 0, 0, 1, 0.5, 0); g.fillRect(0, 0, 1, 1); g.setTransform(1, 0, 0, 1, 0, 0);
  assert.deepEqual([at(g, 0, 0), at(g, 1, 0)], [RED, NONE]);
  // A quarter turn moved 4 across: user x runs down device column 3.
  g.clearRect(0, 0, 4, 4);
  g.setTransform(0, 1, -1, 0, 4, 0); g.fillRect(0, 0, 2, 1); g.setTransform(1, 0, 0, 1, 0, 0);
  assert.deepEqual([at(g, 3, 0), at(g, 3, 1), at(g, 3, 2), at(g, 2, 0)], [RED, RED, NONE, NONE]);
  // globalAlpha multiplies the colour's own alpha: 128 / 255 x 0.5 = 64 / 255.
  // Over red that leaves 255 - 64 = 191 red and 64 blue; over nothing, blue at 64.
  g.clearRect(0, 0, 4, 4);
  g.fillRect(0, 0, 1, 1);
  g.save(); g.globalAlpha = 0.5; g.fillStyle = '#0000ff80'; g.fillRect(0, 0, 2, 1); g.restore();
  assert.deepEqual([at(g, 0, 0), at(g, 1, 0)], [[191, 0, 64, 255], [0, 0, 255, 64]]);
  assert.deepEqual([g.globalAlpha, g.fillStyle], [1, '#ff0000'], 'restore brings back the alpha and the fill');
  // Colours with their own alpha: hsl with a slash, and four hex digits.
  g.clearRect(0, 0, 4, 4);
  g.fillStyle = 'hsl(120 100% 50% / 0.5)'; g.fillRect(0, 0, 1, 1);
  g.fillStyle = '#f008'; g.fillRect(1, 0, 1, 1);
  assert.deepEqual([at(g, 0, 0), at(g, 1, 0)], [[0, 255, 0, 128], [255, 0, 0, 136]]);

  // A source region lands whole; a whole image at globalAlpha 0.5 lands at half its alpha.
  const src = canvas(2, 2), s = src.getContext('2d');
  s.fillStyle = '#00ff00'; s.fillRect(1, 0, 1, 2);
  const d = canvas(4, 4).getContext('2d');
  d.drawImage(src, 1, 0, 1, 2, 2, 1, 1, 2);
  assert.deepEqual([at(d, 2, 1), at(d, 2, 2), at(d, 1, 1), at(d, 2, 0)], [[0, 255, 0, 255], [0, 255, 0, 255], NONE, NONE]);
  d.globalAlpha = 0.5; d.drawImage(src, 0, 2); d.globalAlpha = 1;
  assert.deepEqual([at(d, 1, 2), at(d, 1, 3), at(d, 0, 2)], [[0, 255, 0, 128], [0, 255, 0, 128], NONE]);
  // What it cannot paint as a browser would, it refuses.
  assert.throws(() => d.drawImage(src, 0, 0, 2, 2, 0, 0, 4, 4), /unscaled, on whole device pixels/);
  d.setTransform(1, 0, 0, 1, 0.5, 0);
  assert.throws(() => d.drawImage(src, 0, 0), /unscaled, on whole device pixels/);
  d.setTransform(1, 0, 0, 1, 0, 0);
  d.globalCompositeOperation = 'lighter';
  assert.throws(() => d.fillRect(0, 0, 1, 1), /source-over only, not lighter/);
});
