'use strict';

// core/layer.js keeps a copy of a static layer on a raster surface. Node has no
// canvas, so these checks run on a small raster stand-in: whole-pixel fillRect
// with source-over in 8-bit RGBA, drawImage of whole regions, getImageData and
// a plain transform. Antialiasing and GPU canvases are checked in a browser;
// these pin the rules: when a copy is kept, that it equals drawing, and when it
// is refused.

const test = require('node:test');
const assert = require('node:assert');
const { layer } = require('../core/layer.js');
const { VectorSurface } = require('../core/surface-vector.js');
const { nullSurface } = require('../tools/bench.js');

const DOCUMENT = { createElement: () => new Canvas(0, 0) };

class Canvas {
  constructor(width, height) { Object.assign(this, { width, height, ownerDocument: DOCUMENT, ctx: null }); }

  getContext(kind, attrs = {}) { return this.ctx || (this.ctx = new Pixels(this, attrs)); }
}

/** A raster stand-in: fillRect covers the pixels whose centres it contains. */
class Pixels {
  constructor(canvas, attrs) {
    Object.assign(this, { canvas, attrs, m: [1, 0, 0, 1, 0, 0], stack: [], px: null });
    Object.assign(this, { fillStyle: '#000000', globalAlpha: 1, globalCompositeOperation: 'source-over', imageSmoothingEnabled: true });
  }

  data() {
    const n = this.canvas.width * this.canvas.height * 4;
    if (!this.px || this.px.length !== n) this.px = new Uint8ClampedArray(n);
    return this.px;
  }

  getContextAttributes() { return { ...this.attrs }; }

  save() { this.stack.push({ m: this.m.slice(), fillStyle: this.fillStyle, globalAlpha: this.globalAlpha }); }

  restore() { const s = this.stack.pop(); if (s) Object.assign(this, s); }

  setTransform(a, b, c, d, e, f) { this.m = [a, b, c, d, e, f]; }

  scale(x, y) { const [a, b, c, d, e, f] = this.m; this.m = [a * x, b * x, c * y, d * y, e, f]; }

  translate(x, y) { const [a, b, c, d, e, f] = this.m; this.m = [a, b, c, d, e + a * x + c * y, f + b * x + d * y]; }

  rotate(r) {
    const [a, b, c, d, e, f] = this.m;
    const cs = Math.cos(r), sn = Math.sin(r);
    this.m = [a * cs + c * sn, b * cs + d * sn, c * cs - a * sn, d * cs - b * sn, e, f];
  }

  getTransform() { const [a, b, c, d, e, f] = this.m; return { a, b, c, d, e, f }; }

  clearRect() { this.data().fill(0); }

  fillRect(x, y, w, h) {
    const [a, , , d, e, f] = this.m;
    const [x0, x1] = [a * x + e, a * (x + w) + e].sort((p, q) => p - q);
    const [y0, y1] = [d * y + f, d * (y + h) + f].sort((p, q) => p - q);
    const rgba = this.fillStyle.match(/[0-9a-f]{2}/gi).map((v) => parseInt(v, 16));
    const alpha = (rgba.length > 3 ? rgba[3] / 255 : 1) * this.globalAlpha;
    const px = this.data();
    const { width: W, height: H } = this.canvas;
    for (let j = Math.max(0, Math.ceil(y0 - 0.5)); j < Math.min(H, Math.ceil(y1 - 0.5)); j++) {
      for (let i = Math.max(0, Math.ceil(x0 - 0.5)); i < Math.min(W, Math.ceil(x1 - 0.5)); i++) blend(px, (j * W + i) * 4, rgba, alpha);
    }
  }

  drawImage(src, ...args) {
    const [sx, sy, sw, sh, dx, dy] = args.length === 2 ? [0, 0, src.width, src.height, ...args] : args;
    const from = src.getContext('2d').data();
    const px = this.data();
    for (let j = 0; j < sh; j++) {
      for (let i = 0; i < sw; i++) {
        const s = ((sy + j) * src.width + sx + i) * 4;
        blend(px, ((dy + j) * this.canvas.width + dx + i) * 4, [from[s], from[s + 1], from[s + 2]], from[s + 3] / 255);
      }
    }
  }

  getImageData(x, y, w, h) {
    const out = new Uint8ClampedArray(w * h * 4);
    const px = this.data();
    for (let j = 0; j < h; j++) out.set(px.subarray(((y + j) * this.canvas.width + x) * 4, ((y + j) * this.canvas.width + x + w) * 4), j * w * 4);
    return { data: out };
  }
}

/** Source-over in straight 8-bit RGBA, rounded once per mark, as a canvas does. */
function blend(px, at, [r, g, b], a) {
  const da = px[at + 3] / 255;
  const oa = a + da * (1 - a);
  if (oa === 0) return;
  [r, g, b].forEach((c, k) => { px[at + k] = (c * a + px[at + k] * da * (1 - a)) / oa; });
  px[at + 3] = oa * 255;
}

/** One frame: clear, a plain scale, the layer, then a mark that moves with t. */
function frame(g, state, t, paint, opt = {}) {
  g.clearRect();
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
  return frame(new Canvas(10 * k, 6 * k).getContext('2d'), {}, t, paint, opt);
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
  const g = new Canvas(20, 12).getContext('2d');
  const state = {};
  for (const t of [0, 1, 2, 3, 4, 5]) {
    assert.deepEqual(frame(g, state, t, paint, { scale: 2 }), drawn(t, ground, { scale: 2 }), `frame ${t} differs from drawing it`);
  }
  assert.equal(paint.calls, 3, 'painted on the first frame, then on the second with its opacity check, then copied');
});

test('each device scale keeps its own copy', () => {
  const paint = counted(ground);
  const state = {};
  const one = new Canvas(10, 6).getContext('2d');
  const two = new Canvas(20, 12).getContext('2d');
  for (const t of [0, 1, 2, 3]) {
    assert.deepEqual(frame(one, state, t, paint, { scale: 1 }), drawn(t, ground, { scale: 1 }), `1x frame ${t}`);
    assert.deepEqual(frame(two, state, t, paint, { scale: 2 }), drawn(t, ground, { scale: 2 }), `2x frame ${t}`);
  }
  // Same canvas, two scales: the second scale may not reuse the first's copy.
  const g = new Canvas(20, 12).getContext('2d');
  for (const [t, scale] of [[0, 1], [1, 1], [2, 1], [3, 2], [4, 2], [5, 2]]) {
    const fresh = frame(new Canvas(20, 12).getContext('2d'), {}, t, ground, { scale });
    assert.deepEqual(frame(g, state, t, paint, { scale }), fresh, `frame ${t} at ${scale}x`);
  }
});

test('a translucent layer is drawn every time, never copied', () => {
  // A copy would carry whatever the frame drew under it when it was taken.
  const sheer = (g) => { g.fillStyle = '#ffffff80'; g.fillRect(0, 0, 10, 6); };
  const veil = counted(sheer);
  const under = (g, t) => { g.fillStyle = t % 2 ? '#102030' : '#a0b0c0'; g.fillRect(0, 0, 10, 6); };
  const g = new Canvas(10, 6).getContext('2d');
  const state = {};
  for (const t of [0, 1, 2, 3, 4]) {
    assert.deepEqual(frame(g, state, t, veil, { before: under }), drawn(t, sheer, { before: under }), `frame ${t}`);
  }
  assert.equal(veil.calls, 5 + 1, 'drawn on every frame, and painted once more to judge its opacity');
});

test('past the cap a layer is drawn every time', () => {
  const paint = counted(ground);
  const g = new Canvas(20, 12).getContext('2d');
  const state = {};
  for (const t of [0, 1, 2, 3]) {
    assert.deepEqual(frame(g, state, t, paint, { scale: 2, cap: 20 * 12 - 1 }), drawn(t, ground, { scale: 2 }), `frame ${t}`);
  }
  assert.equal(paint.calls, 4, 'one paint per frame, and no copy');
});

test('a rotated surface or a box off the pixel grid is drawn every time', () => {
  for (const opt of [{ rotate: 0.3 }, { dx: 0.5 }]) {
    const paint = counted(ground);
    const g = new Canvas(10, 6).getContext('2d');
    const state = {};
    for (const t of [0, 1, 2, 3]) frame(g, state, t, paint, opt);
    assert.equal(paint.calls, 4, JSON.stringify(opt));
  }
});

test('a copy belongs to its canvas and its solve', () => {
  const paint = counted(ground);
  const a = new Canvas(10, 6).getContext('2d');
  const b = new Canvas(10, 6).getContext('2d');
  const state = {};
  for (const t of [0, 1, 2]) frame(a, state, t, paint);
  assert.equal(paint.calls, 3);
  frame(b, state, 3, paint);
  assert.equal(paint.calls, 4, 'another canvas starts again');
  frame(a, {}, 4, paint);
  assert.equal(paint.calls, 5, 'and so does another solve');
});

test('a paint that takes a playhead is refused by name', () => {
  const g = new Canvas(10, 6).getContext('2d');
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
