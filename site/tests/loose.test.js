'use strict';

// Shot 4's five pieces draw the same loose skins from the same build, so
// site/pieces/loose.js keeps their copies under one solve per seed: a piece
// reached after another makes none of its own. Drawn here on stand-in
// canvases that record their size; that the shared copies give the same
// pixels as a piece's own needs installed Edge.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadExternal } = require('../../tools/piece-input.js');
const P = require('../../core/piece.js');
const R = require('../../core/render.js');

const ROOT = path.join(__dirname, '..', '..');
const NAMES = ['unstick', 'cues', 'readout', 'settle', 'contain'];
const CEILING = 24e6;     // held.js: the most pixels three solves' copies may hold

/** A 2D affine matrix with the parts of DOMMatrix the pieces use. */
class Matrix {
  constructor(a = 1, b = 0, c = 0, d = 1, e = 0, f = 0) { Object.assign(this, { a, b, c, d, e, f }); }
  multiply(o) {
    const { a, b, c, d, e, f } = this;
    return new Matrix(a * o.a + c * o.b, b * o.a + d * o.b, a * o.c + c * o.d, b * o.c + d * o.d, a * o.e + c * o.f + e, b * o.e + d * o.f + f);
  }
  inverse() {
    const { a, b, c, d, e, f } = this, k = a * d - b * c;
    return new Matrix(d / k, -b / k, -c / k, a / k, (c * f - d * e) / k, (b * e - a * f) / k);
  }
  transformPoint(p) { return { x: this.a * p.x + this.c * p.y + this.e, y: this.b * p.x + this.d * p.y + this.f }; }
}

/** A stand-in canvas of w x h: its context follows the transform and draws nothing. */
function canvas(doc, width, height) {
  const c = { width, height, ownerDocument: doc };
  let m = new Matrix();
  const stack = [];
  const own = {
    canvas: c,
    getTransform: () => new Matrix(m.a, m.b, m.c, m.d, m.e, m.f),
    setTransform(a, b, cc, d, e, f) { m = typeof a === 'object' ? new Matrix(a.a, a.b, a.c, a.d, a.e, a.f) : new Matrix(a, b, cc, d, e, f); },
    transform(a, b, cc, d, e, f) { m = m.multiply(new Matrix(a, b, cc, d, e, f)); },
    translate(x, y) { m = m.multiply(new Matrix(1, 0, 0, 1, x, y)); },
    scale(x, y) { m = m.multiply(new Matrix(x, 0, 0, y, 0, 0)); },
    rotate(r) { m = m.multiply(new Matrix(Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0)); },
    save() { stack.push(m); },
    restore() { m = stack.pop() || m; },
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    measureText: () => ({ width: 0 }),
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  };
  const g = new Proxy(own, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  c.getContext = () => g;
  return c;
}

/** Shot 4's pieces, loaded as the site loads them: one module table, so one loose.js and one held.js. */
function load() {
  const doc = { createElement: () => canvas(doc, 0, 0) };
  const pieces = loadExternal(NAMES.map((n) => path.join(ROOT, 'site', 'pieces', n + '.cjs')), ROOT).pieces.map((p) => p.piece);
  return { pieces, tally: globalThis.__held, stage: (w, h) => canvas(doc, w, h).getContext('2d') };
}

test('loose: shot 4\'s pieces share one seed\'s kept skins, and their copies stay under the ceiling', (t) => {
  const saved = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = function (w, h) { return canvas(null, w, h); };
  t.after(() => { globalThis.OffscreenCanvas = saved; });
  const { pieces, tally, stage } = load();
  const g = stage(1200, 800);
  const draw = (piece, seed) => R.drawFrame(g, piece, P.solve(piece, seed, {}), 0.5);
  draw(pieces[0], 1);
  const first = { copies: tally.copies, pixels: tally.pixels };
  assert.ok(first.copies > 100, 'the first piece keeps its skins: ' + first.copies + ' copies');
  // Every other piece, solved on its own, lays the copies the first made.
  for (const piece of pieces.slice(1)) draw(piece, 1);
  assert.deepEqual({ copies: tally.copies, pixels: tally.pixels }, first, 'no piece after the first makes copies of its own');
  draw(pieces[0], 1);
  assert.equal(tally.copies, first.copies, 'going back makes none either');
  assert.ok(tally.peak <= CEILING, 'the walk peaks at ' + tally.peak + ' pixels');
  // Another seed has skins of its own, never another seed's.
  draw(pieces[1], 2);
  assert.ok(tally.copies > first.copies, 'seed 2 makes its own copies');
});

test('loose: before the first form cracks the skins are made in idle time, a few each period, and come to the copies a frame makes at once', (t) => {
  const saved = [globalThis.OffscreenCanvas, globalThis.requestIdleCallback];
  globalThis.OffscreenCanvas = function (w, h) { return canvas(null, w, h); };
  t.after(() => { [globalThis.OffscreenCanvas, globalThis.requestIdleCallback] = saved; });
  // What a frame after the first crack keeps, made at once.
  const at = (piece, g, playhead) => R.drawFrame(g, piece, P.solve(piece, 1, {}), playhead);
  const whole = load();
  const wg = whole.stage(1200, 800);
  at(whole.pieces[0], wg, 0);
  at(whole.pieces[0], wg, 0.5);
  const want = { copies: whole.tally.copies, pixels: whole.tally.pixels };
  // A fresh page with idle periods: the first frame keeps the painting alone.
  for (const k of Object.keys(require.cache)) if (k.includes(path.join('site', 'pieces'))) delete require.cache[k];
  const queue = [];
  globalThis.requestIdleCallback = (f) => queue.push(f);
  const { pieces, tally, stage } = load();
  const g = stage(1200, 800);
  at(pieces[0], g, 0);
  const first = tally.copies;
  assert.ok(first < 10 && queue.length === 1, 'the first frame keeps ' + first + ' copies and asks for ' + queue.length + ' idle period');
  at(pieces[0], g, 0);
  assert.equal(queue.length, 1, 'a second frame asks for no other');
  // Idle periods with no time left make one copy each; with time, the rest.
  for (let n = 0; n < 3; n++) queue.shift()({ timeRemaining: () => 0 });
  assert.equal(tally.copies, first + 3, 'one copy in each short idle period');
  queue.shift()({ timeRemaining: () => 50 });
  assert.equal(queue.length, 0, 'nothing is left to make');
  assert.deepEqual({ copies: tally.copies, pixels: tally.pixels }, want, 'the same copies as a frame makes at once');
  at(pieces[0], g, 0.5);
  assert.deepEqual({ copies: tally.copies, pixels: tally.pixels }, want, 'and that frame makes none');
});

test('loose: a form\'s bounds follow the arc a canvas draws, anticlockwise or ending before it starts', () => {
  const L = require('../pieces/loose.js');
  const box = (a0, a1, ccw) => L.boundsOf((g) => { g.beginPath(); g.arc(0, 0, 10, a0, a1, ccw); g.fill(); }).box.map((v) => Math.round(v));
  const q = Math.PI / 2;
  assert.deepEqual(box(0, q), [0, 0, 10, 10], 'a quarter clockwise');
  assert.deepEqual(box(0, q, true), [-10, -10, 10, 10], 'three quarters anticlockwise');
  assert.deepEqual(box(q, 0), [-10, -10, 10, 10], 'three quarters clockwise, round past a whole turn');
  assert.deepEqual(box(q, 0, true), [0, 0, 10, 10], 'a quarter anticlockwise');
  assert.deepEqual(box(0, 5 * Math.PI), [-10, -10, 10, 10], 'a whole turn at most');
});
