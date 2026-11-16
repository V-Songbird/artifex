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

// --- sprites -------------------------------------------------------------------

const { sprite, held, sibling, MAX_BAKE } = require('../core/layer.js');

// A cutout: a shadow, an opaque body and a translucent rim, inside [-3, -2, 6, 4].
const cutout = (g) => {
  g.fillStyle = '#20202060'; g.fillRect(-2, -1, 5, 3);
  g.fillStyle = '#d0a060'; g.fillRect(-3, -2, 5, 3);
  g.fillStyle = '#ffffff80'; g.fillRect(-3, -2, 5, 1);
};

// A sheet that gains a translucent mark per key, so the order of marks shows in its pixels.
const marks = (g, s, from, to) => {
  for (let i = from === null ? 0 : from; i < to; i++) {
    g.fillStyle = i % 2 ? '#3050a080' : '#a0403080';
    g.fillRect(i % 7, Math.floor(i / 7) % 5, 3, 2);
  }
};

/** One frame: a ground, `draw(g, t)` at a plain scale, then a mark that moves with t. */
function sheet(g, t, draw, scale = 1) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, g.canvas.width, g.canvas.height);
  g.save();
  g.setTransform(scale, 0, 0, scale, 0, 0);
  g.fillStyle = '#e8e0d0'; g.fillRect(0, 0, 12, 8);
  draw(g, t);
  g.fillStyle = '#20306080'; g.fillRect(t % 12, 6, 2, 1);
  g.restore();
  return Array.from(g.getImageData(0, 0, g.canvas.width, g.canvas.height).data);
}

/** The same frame on a fresh canvas with nothing kept. */
function unkept(t, draw, scale = 1) {
  return sheet(canvas(12 * scale, 8 * scale).getContext('2d'), t, (g, tt) => draw(g, tt, 0), scale);
}

test('a sprite is baked once per solve and device scale, and every frame equals baking it afresh', () => {
  const paint = counted(cutout);
  const g = canvas(24, 16).getContext('2d');
  const state = {};
  const draw = (sg, t, budget) => {
    for (const [x, y] of [[3, 2], [8, 3], [5, 6]]) {
      sprite(sg, state, 'cutout', [-3, -2, 6, 4], budget === 0 ? cutout : paint, { at: [1, 0, 0, 1, x + (t % 2), y], budget });
    }
  };
  for (const t of [0, 1, 2, 3, 4]) assert.deepEqual(sheet(g, t, draw, 2), unkept(t, draw, 2), `frame ${t} differs from baking afresh`);
  assert.equal(paint.calls, 1, 'one bake serves every placement of every frame');
  assert.deepEqual(held(g.canvas), { copies: 1, pixels: 12 * 8 });
});

test('a keyed sprite grows each copy from the nearest older one', () => {
  const calls = [];
  const paint = (sg, s, from, to) => { calls.push([from, to]); marks(sg, s, from, to); };
  const g = canvas(12, 8).getContext('2d');
  const state = {};
  const keyAt = [2, 5, 5, 9, 4, 6, 12];
  const draw = (sg, t, budget) => sprite(sg, state, 'sheet', [0, 0, 12, 8], budget === 0 ? marks : paint, { key: keyAt[t], budget });
  for (const t of keyAt.keys()) assert.deepEqual(sheet(g, t, draw), unkept(t, draw), `frame ${t} at key ${keyAt[t]}`);
  // 2 grew into 5 and 5 into 9, so 4 has no older copy; 12 grows from 9, not 6.
  assert.deepEqual(calls, [[null, 2], [2, 5], [5, 9], [null, 4], [4, 6], [9, 12]], 'each copy paints only what lies between it and the nearest older copy');
});

test('a keyed sprite grows one canvas in place, and an older key drawn again is baked again', () => {
  const calls = [];
  const paint = (sg, s, from, to) => { calls.push([from, to]); marks(sg, s, from, to); };
  const g = canvas(12, 8).getContext('2d');
  const state = {};
  const draw = (sg, t, budget) => sprite(sg, state, 'sheet', [0, 0, 12, 8], budget === 0 ? marks : paint, { key: t, budget });
  const create = DOCUMENT.createElement;
  let made = 0;
  const canvases = [];
  DOCUMENT.createElement = () => { made++; return create(); };
  try {
    for (const t of [3, 4, 5, 6, 7, 5, 6, 8]) {
      const before = made;
      const frame = sheet(g, t, draw);
      canvases.push(made - before);
      assert.deepEqual(frame, unkept(t, draw), `key ${t}`);
      if (canvases.length === 5) assert.deepEqual(held(g.canvas), { copies: 1, pixels: 12 * 8 }, 'keys 3 to 7 held on one canvas');
    }
  } finally {
    DOCUMENT.createElement = create;
  }
  assert.deepEqual(canvases, [1, 0, 0, 0, 0, 1, 0, 0], 'a canvas is made only where no older copy is kept');
  // 5, drawn again after 7, is baked whole; 6 grows from it, and 8 from 7.
  assert.deepEqual(calls, [[null, 3], [3, 4], [4, 5], [5, 6], [6, 7], [null, 5], [5, 6], [7, 8]]);
  assert.deepEqual(held(g.canvas), { copies: 2, pixels: 2 * 12 * 8 });
});

test('a sprite grown in place paints each span from the default drawing state', () => {
  // Leaving the alpha at a half after the last mark changes nothing on a new canvas.
  const paint = (sg, s, from, to) => { marks(sg, s, from, to); sg.globalAlpha = 0.5; };
  const g = canvas(12, 8).getContext('2d');
  const state = {};
  const draw = (sg, t, budget) => sprite(sg, state, 'sheet', [0, 0, 12, 8], paint, { key: t, budget });
  for (const t of [2, 4, 6]) assert.deepEqual(sheet(g, t, draw), unkept(t, draw), `key ${t}`);
});

test('a sprite grown in place starts each span with an empty path', () => {
  // The stand-in canvas has no paths, so the copies get the least a canvas
  // keeps: rect adds to the current path, fill paints every rect in it, and
  // beginPath empties it. A new canvas starts with an empty path.
  const create = DOCUMENT.createElement;
  DOCUMENT.createElement = () => {
    const c = create();
    Object.assign(c.getContext('2d'), {
      path: [],
      beginPath() { this.path = []; },
      rect(...r) { this.path.push(r); },
      fill() { for (const r of this.path) this.fillRect(...r); },
    });
    return c;
  };
  try {
    // One translucent cell per key, filled once at the end without a beginPath.
    const paint = (sg, s, from, to) => {
      for (let i = from === null ? 0 : from; i < to; i++) sg.rect(i % 12, Math.floor(i / 12), 1, 1);
      sg.fillStyle = '#3050a080';
      sg.fill();
    };
    const g = canvas(12, 8).getContext('2d');
    const state = {};
    const draw = (sg, t, budget) => sprite(sg, state, 'sheet', [0, 0, 12, 8], paint, { key: t, budget });
    for (const t of [2, 4, 6]) assert.deepEqual(sheet(g, t, draw), unkept(t, draw), `key ${t}`);
  } finally {
    DOCUMENT.createElement = create;
  }
});

test('a sprite whose paint throws as it grows keeps no half-grown copy', () => {
  const paint = (sg, s, from, to) => { marks(sg, s, from, to); if (to === 6) throw new Error('paint failed'); };
  const g = canvas(12, 8).getContext('2d');
  const state = {};
  const draw = (sg, t, budget) => sprite(sg, state, 'sheet', [0, 0, 12, 8], budget === 0 ? marks : paint, { key: t, budget });
  sheet(g, 4, draw);
  assert.throws(() => draw(g, 6), /paint failed/);
  assert.deepEqual(held(g.canvas), { copies: 0, pixels: 0 }, 'the copy that took part of the span is dropped');
  assert.deepEqual(sheet(g, 4, draw), unkept(4, draw), 'and key 4 is baked again without it');
});

test('each device scale keeps its own sprite copy', () => {
  const paint = counted(cutout);
  const state = {};
  const draw = (budget) => (sg) => sprite(sg, state, 'cutout', [-3, -2, 6, 4], budget === 0 ? cutout : paint, { at: [1, 0, 0, 1, 4, 3], budget });
  const g = canvas(24, 16).getContext('2d');
  for (const [t, scale] of [[0, 1], [1, 2], [2, 1], [3, 2]]) {
    assert.deepEqual(sheet(g, t, draw(), scale), sheet(canvas(24, 16).getContext('2d'), t, draw(0), scale), `frame ${t} at ${scale}x`);
  }
  assert.equal(paint.calls, 2, 'one bake per scale');
  assert.deepEqual(held(g.canvas), { copies: 2, pixels: 6 * 4 + 12 * 8 });
});

test('sprite copies stay within their budget, dropping the least recently drawn', () => {
  const calls = [];
  const paint = (sg, s, from, to) => { calls.push([from, to]); marks(sg, s, from, to); };
  const g = canvas(12, 8).getContext('2d');
  const state = {};
  const budget = 2 * 12 * 8;
  const keyAt = [5, 3, 5, 1, 3, 6];
  const draw = (sg, t, b) => sprite(sg, state, 'sheet', [0, 0, 12, 8], b === 0 ? marks : paint, { key: keyAt[t], budget: b === 0 ? 0 : budget });
  for (const t of keyAt.keys()) {
    assert.deepEqual(sheet(g, t, draw), unkept(t, draw), `frame ${t}`);
    assert.ok(held(g.canvas).pixels <= budget, `frame ${t} holds ${held(g.canvas).pixels} pixels`);
  }
  // Room for two: 5 and 3 are kept and 5 is drawn again, so 1, baked whole,
  // drops 3; 3 grows again from 1 and 6 from 5, in place, dropping nothing.
  assert.deepEqual(calls, [[null, 5], [null, 3], [null, 1], [1, 3], [5, 6]]);
  const none = canvas(12, 8).getContext('2d');
  sprite(none, state, 'sheet', [0, 0, 12, 8], marks, { key: 3, budget: 0 });
  assert.deepEqual(held(none.canvas), { copies: 0, pixels: 0 }, 'a budget of 0 keeps nothing');
});

test('a sprite copy grown under a smaller budget than kept it stays within that budget', () => {
  const calls = [];
  const paint = (sg, s, from, to) => { calls.push([from, to]); marks(sg, s, from, to); };
  const g = canvas(12, 8).getContext('2d');
  const state = {};
  const size = 12 * 8;
  let budget;
  const draw = (sg, key, b) => {
    sprite(sg, state, 'other', [0, 0, 12, 8], b === 0 ? marks : paint, { key: 1, budget: b === 0 ? 0 : budget });
    sprite(sg, state, 'sheet', [0, 0, 12, 8], b === 0 ? marks : paint, { key, budget: b === 0 ? 0 : budget });
  };
  // Kept under room for both: the other sprite and the sheet at 4.
  budget = 2 * size;
  assert.deepEqual(sheet(g, 4, draw), unkept(4, draw), 'key 4');
  assert.deepEqual(held(g.canvas), { copies: 2, pixels: 2 * size });
  // Room for one: 4 grows into 6 in place, and the other sprite, drawn first
  // and so least recently, makes way for it.
  budget = size;
  assert.deepEqual(sheet(g, 6, draw), unkept(6, draw), 'key 6 under room for one');
  assert.deepEqual(held(g.canvas), { copies: 1, pixels: size });
  // Less than one copy: 6 still grows into 8, and nothing is kept.
  budget = size - 1;
  assert.deepEqual(sheet(g, 8, draw), unkept(8, draw), 'key 8 under less than one copy');
  assert.deepEqual(held(g.canvas), { copies: 0, pixels: 0 });
  // So 8, drawn again with room, is baked whole.
  budget = 2 * size;
  assert.deepEqual(sheet(g, 8, draw), unkept(8, draw), 'key 8 again');
  assert.deepEqual(calls.filter(([, to]) => to !== 1), [[null, 4], [4, 6], [6, 8], [null, 8]]);
});

test('a sprite copy belongs to its canvas and its solve', () => {
  const paint = counted(cutout);
  const a = canvas(12, 8).getContext('2d');
  const state = {};
  for (let i = 0; i < 2; i++) sprite(a, state, 'cutout', [-3, -2, 6, 4], paint);
  assert.equal(paint.calls, 1);
  sprite(canvas(12, 8).getContext('2d'), state, 'cutout', [-3, -2, 6, 4], paint);
  assert.equal(paint.calls, 2, 'another canvas bakes again');
  sprite(a, {}, 'cutout', [-3, -2, 6, 4], paint);
  assert.equal(paint.calls, 3, 'and so does another solve');
  assert.deepEqual(held(a.canvas), { copies: 1, pixels: 24 }, 'which drops the copies of the solve before it');
});

test('a sprite is drawn with any transform exactly as baking it afresh draws it', () => {
  // The stand-in canvas cannot paint a turned image, so each drawImage is
  // recorded instead: the transform it lands under and the pixels it carries.
  const state = {};
  const turn = (r, k, x, y) => [k * Math.cos(r), k * Math.sin(r), -k * Math.sin(r), k * Math.cos(r), x, y];
  const frames = (budget) => {
    const g = canvas(24, 16).getContext('2d');
    const log = [];
    g.drawImage = function (src, ...args) {
      const { a, b, c, d, e, f } = this.getTransform();
      log.push([[a, b, c, d, e, f], Array.from(src.pixels), args]);
    };
    for (const t of [0, 1, 2]) {
      g.setTransform(2, 0, 0, 2, 0, 0);
      for (const [r, k] of [[0.4 * t, 1], [-0.3, 1.5 + t / 4]]) {
        sprite(g, state, 'cutout', [-3, -2, 6, 4], cutout, { at: turn(r, k, 5 + t, 4), budget });
      }
    }
    return log;
  };
  const kept = frames(undefined);
  assert.equal(kept.length, 6);
  assert.deepEqual(kept, frames(0));
  // The copy's corner is the box's, [-3, -2], under the device scale and `at`,
  // and one of its pixels is one device pixel along each of `at`'s axes.
  const [a, b, c, d, e, f] = turn(-0.3, 1.5, 5, 4);
  const want = [a, b, c, d, 2 * (e - 3 * a - 2 * c), 2 * (f - 3 * b - 2 * d)];
  kept[1][0].forEach((v, i) => assert.ok(Math.abs(v - want[i]) < 1e-9, `transform ${kept[1][0]} is not ${want}`));
});

test('vector and null surfaces paint a sprite directly under its transform', () => {
  const lines = (g, s, from, to) => { g.beginPath(); g.moveTo(0, 0); g.lineTo(from === null ? to : -1, 2); g.stroke(); };
  const at = [0, 1, -1, 0, 5, 3];
  const svg = (use) => {
    const g = new VectorSurface({ w: 12, h: 8 });
    if (use) sprite(g, {}, 'mark', [-1, -1, 8, 4], lines, { key: 4, at });
    else { g.save(); g.transform(...at); lines(g, {}, null, 4); g.restore(); }
    return g.toSVG();
  };
  assert.equal(svg(true), svg(false), 'the document is the one drawing it writes');
  assert.doesNotMatch(svg(true), /<image/, 'and it holds no bitmap');
  const n = nullSurface({ w: 12, h: 8 });
  const paint = counted(cutout);
  for (let i = 0; i < 3; i++) sprite(n, {}, 'cutout', [-3, -2, 6, 4], paint);
  assert.equal(paint.calls, 3, 'the null surface paints on every draw');
});

test('a sprite refuses a paint, key, box, transform or smoothing it cannot use, by name', () => {
  const g = canvas(12, 8).getContext('2d');
  assert.throws(() => sprite(g, {}, 'fox', [0, 0, 2, 2], null), /sprite "fox": paint must be a function/);
  assert.throws(() => sprite(g, {}, 'fox', [0, 0, 2, 2], cutout, { key: NaN }), /sprite "fox": key must be a finite number/);
  assert.throws(() => sprite(g, {}, 'fox', [0, 0, 0, 2], cutout), /sprite "fox": box must be \[x, y, w, h\] with a positive size/);
  assert.throws(() => sprite(g, {}, 'fox', [0, 0, 2, 2], cutout, { at: [1, 0, 0, 1] }), /sprite "fox": at must be six finite numbers/);
  for (const [smoothing, shown] of [[true, 'true'], ['nearest', "'nearest'"], ['High', "'High'"], [null, 'null'], [0, '0'], [Object.create(null), 'an object']]) {
    assert.throws(() => sprite(g, {}, 'fox', [0, 0, 2, 2], cutout, { smoothing }), (e) => e instanceof TypeError
      && e.message === `sprite "fox": smoothing must be 'high', 'medium', 'low' or false, not ${shown}`, shown);
  }
});

test('a sprite on a turning surface is baked once', () => {
  // The device scale of a turned surface drifts by a rounding error from frame to frame.
  const paint = counted(cutout);
  const g = canvas(24, 16).getContext('2d');
  const state = {};
  for (let i = 0; i < 96; i++) {
    const a = i * 0.037;
    g.setTransform(2 * Math.cos(a), 2 * Math.sin(a), -2 * Math.sin(a), 2 * Math.cos(a), 12, 8);
    g.drawImage = () => {};
    sprite(g, state, 'cutout', [-3, -2, 6, 4], paint);
    // Checked on every frame, so a scale that runs away fails at once.
    assert.equal(paint.calls, 1, `baked again on frame ${i}`);
  }
});

test('a sprite refuses a bake past MAX_BAKE pixels by name, before making its canvas', () => {
  assert.equal(MAX_BAKE, 2 ** 28);
  const g = canvas(12, 8).getContext('2d');
  g.drawImage = () => {};
  const made = [];
  const at = (w, h) => sprite(g, {}, 'sheet', [0, 0, w, h], () => made.push([w, h]), { budget: 0 });
  at(16384, 16384);
  assert.throws(() => at(16384, 16385), (e) => e instanceof RangeError
    && e.message === 'sprite "sheet": a bake of 16384 x 16385 pixels is more than the 268435456 pixels a canvas holds');
  g.setTransform(Infinity, 0, 0, Infinity, 0, 0);
  assert.throws(() => at(1, 1), /sprite "sheet": a bake of Infinity x Infinity pixels/);
  assert.deepEqual(made, [[16384, 16384]], 'only the bake within the limit was painted');
});

test('a sprite baked at a larger scale holds that many more pixels and is drawn back at size', () => {
  const paint = counted(cutout);
  const g = canvas(24, 16).getContext('2d');
  const state = {};
  const log = [];
  g.drawImage = function (src) { const { a, d } = this.getTransform(); log.push([src.width, src.height, a, d]); };
  g.setTransform(2, 0, 0, 2, 0, 0);
  sprite(g, state, 'cutout', [-3, -2, 6, 4], paint, { scale: 3 });
  sprite(g, state, 'cutout', [-3, -2, 6, 4], paint, { scale: 3 });
  assert.deepEqual(log[0], [36, 24, 1 / 3, 1 / 3], 'six units at 2 x 3 pixels each, drawn back at a third');
  assert.equal(paint.calls, 1, 'and kept at that scale');
  sprite(g, state, 'cutout', [-3, -2, 6, 4], paint);
  assert.equal(paint.calls, 2, 'another scale is another copy');
  assert.deepEqual(held(g.canvas), { copies: 2, pixels: 36 * 24 + 12 * 8 });
  for (const scale of [0, -1, NaN, 8.5, Infinity]) {
    assert.throws(() => sprite(g, state, 'fox', [0, 0, 2, 2], cutout, { scale }), /sprite "fox": scale must be a number above 0 and at most 8/, String(scale));
  }
});

test('a sprite is drawn at its own smoothing, high by default, whatever the caller set', () => {
  // Each smoothing is drawn from a kept copy and from one baked afresh.
  const draws = (smoothing, enabled, quality) => {
    const g = canvas(24, 16).getContext('2d');
    const seen = [];
    g.drawImage = function () { seen.push([this.imageSmoothingEnabled, this.imageSmoothingQuality]); };
    g.imageSmoothingEnabled = enabled;
    g.imageSmoothingQuality = quality;
    for (const budget of [undefined, 0]) sprite(g, {}, 'cutout', [-3, -2, 6, 4], cutout, { at: [0.6, 0, 0, 0.6, 8, 8], budget, smoothing });
    assert.equal(g.imageSmoothingEnabled, enabled, "the caller's setting comes back");
    return seen;
  };
  assert.deepEqual(draws(undefined, false, 'low'), [[true, 'high'], [true, 'high']], 'high by default');
  for (const q of ['high', 'medium', 'low']) assert.deepEqual(draws(q, false, q === 'high' ? 'low' : 'high'), [[true, q], [true, q]], q);
  assert.deepEqual(draws(false, true, 'high').map(([on]) => on), [false, false], 'false draws nearest neighbour');
});

test('a sprite shares its copy between smoothings', () => {
  const paint = counted(cutout);
  const g = canvas(24, 16).getContext('2d');
  const state = {};
  for (const smoothing of ['high', 'medium', 'low', false]) sprite(g, state, 'cutout', [-3, -2, 6, 4], paint, { smoothing });
  assert.equal(paint.calls, 1, 'smoothing changes how the copy is drawn, not what it holds');
});

test('sibling returns null for a surface with no canvas, and a canvas of its own kind otherwise', t => {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'OffscreenCanvas');
  const old = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } };
  t.after(() => { if (had) globalThis.OffscreenCanvas = old; else delete globalThis.OffscreenCanvas; });
  assert.equal(sibling(new VectorSurface({ w: 10, h: 6 }).canvas, 4, 3), null, 'a vector surface has no canvas');
  assert.equal(sibling(nullSurface({ w: 10, h: 6 }).canvas, 4, 3), null, 'nor does a null surface');
  assert.equal(sibling(undefined, 4, 3), null);
  const c = sibling(canvas(10, 6), 4, 3);
  assert.deepEqual([c.width, c.height], [4, 3], 'a canvas with a document makes one there');
});

// A tree of attached parts: each part's whole transform, its parent's followed by its own.

test('partFrames carries a parent\'s move, turn and squash to every part below it, as nested canvas transforms do', () => {
  const { partFrames, framePoint } = require('../core/layer.js');
  const close = (got, want, what) => got.forEach((v, i) => assert.ok(Math.abs(v - want[i]) < 1e-12, `${what}: ${got} is not ${want}`));
  const tree = { name: 'body', at: [100, 50], turn: Math.PI / 2, kids: [
    { name: 'arm', at: [10, 0], turn: -Math.PI / 2, scale: [2, 0.5], kids: [{ name: 'hand', at: [5, 4] }] },
    { name: 'tail', at: [0, -20], scale: 3 }] };
  const frames = partFrames(tree);
  assert.deepEqual([...frames.keys()], ['body', 'arm', 'hand', 'tail'], 'parents before their children, in the tree\'s order');
  close(frames.get('body'), [0, 1, -1, 0, 100, 50], 'the root, moved and turned a quarter');
  // The arm's origin is 10 along the body's x, which now points down the frame.
  close(framePoint(frames.get('arm'), [0, 0]), [100, 60], 'the arm\'s joint');
  close(frames.get('arm'), [2, 0, 0, 0.5, 100, 60], 'turned back level and squashed');
  close(framePoint(frames.get('hand'), [0, 0]), [110, 62], 'the hand rides the arm\'s squash: 5 doubled, 4 halved');
  close(frames.get('hand'), [2, 0, 0, 0.5, 110, 62], 'and is squashed with it');
  close(frames.get('tail'), [0, 3, -3, 0, 120, 50], 'a second child of the body');

  // The same numbers a canvas reaches by nesting save, translate, rotate and scale.
  const mul = (p, l) => [p[0] * l[0] + p[2] * l[1], p[1] * l[0] + p[3] * l[1], p[0] * l[2] + p[2] * l[3], p[1] * l[2] + p[3] * l[3], p[0] * l[4] + p[2] * l[5] + p[4], p[1] * l[4] + p[3] * l[5] + p[5]];
  const nested = (part, m, out) => {
    const [x, y] = part.at || [0, 0], t = part.turn || 0, [sx, sy] = Array.isArray(part.scale) ? part.scale : [part.scale ?? 1, part.scale ?? 1];
    m = mul(mul(mul(m, [1, 0, 0, 1, x, y]), [Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), 0, 0]), [sx, 0, 0, sy, 0, 0]);
    out.set(part.name, m);
    for (const k of part.kids || []) nested(k, m, out);
    return out;
  };
  const camera = [1.5, 0, 0, 1.5, -40, 7];
  const rig = { name: 'a', at: [3, 4], turn: 0.7, scale: [1.2, 0.8], kids: [{ name: 'b', at: [9, -2], turn: -1.9, kids: [{ name: 'c', at: [1, 1], turn: 0.3, scale: 0.5 }] }] };
  const want = nested(rig, camera, new Map());
  for (const [name, m] of partFrames(rig, camera)) close(m, want.get(name), name);

  // A part alone sits at its own origin; a joint holds whatever the parent does.
  assert.deepEqual(partFrames({ name: 'one' }).get('one'), [1, 0, 0, 1, 0, 0]);
  for (const turn of [-2, 0, 0.4, 3]) {
    const f = partFrames({ name: 'p', at: [7, 7], turn, scale: [1, 0.3], kids: [{ name: 'k', at: [10, 0], turn: turn * 2 }] });
    close(framePoint(f.get('k'), [0, 0]), framePoint(f.get('p'), [10, 0]), `the joint at a turn of ${turn}`);
  }

  for (const [root, at, message] of [
    [{ at: [0, 0] }, undefined, /^TypeError: partFrames: a part under the root has no name$/],
    [{ name: 'a', kids: [{ name: '' }] }, undefined, /^TypeError: partFrames: a part under "a" has no name$/],
    [{ name: 'a', kids: [null] }, undefined, /^TypeError: partFrames: a part under "a" has no name$/],
    [{ name: 'a', kids: [{ name: 'b' }, { name: 'b' }] }, undefined, /^RangeError: partFrames: part "b" is named twice$/],
    [{ name: 'a', turn: NaN }, undefined, /^RangeError: partFrames: part "a": at, turn and scale must be finite numbers$/],
    [{ name: 'a', scale: [1, Infinity] }, undefined, /^RangeError: partFrames: part "a": at, turn and scale must be finite numbers$/],
    [{ name: 'a', at: null }, undefined, /^RangeError: partFrames: part "a": at, turn and scale must be finite numbers$/],
    [{ name: 'a', at: 5 }, undefined, /^RangeError: partFrames: part "a": at, turn and scale must be finite numbers$/],
    [{ name: 'a', kids: {} }, undefined, /^TypeError: partFrames: part "a": kids must be a list of parts$/],
    [{ name: 'a' }, [1, 0, 0, 1, 0], /^RangeError: partFrames: at must be six finite numbers$/],
  ]) assert.throws(() => partFrames(root, at), message);
});
