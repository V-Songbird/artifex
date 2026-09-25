'use strict';

// core/finish.js: a declared film finish, applied by drawFrame. Node has no
// canvas, so these checks run on a stand-in context that applies transforms for
// real and records every fill with its composite operation, alpha and paint,
// and on stand-in tile canvases that keep the bytes put on them. How the passes
// look, and what they cost, is checked in a browser.

const test = require('node:test');
const assert = require('node:assert');
const { validate, solve } = require('../core/piece.js');
const { drawFrame, renderVector } = require('../core/render.js');
const { gate } = require('../core/finish.js');
const { rgb } = require('../core/colour.js');

const DOCUMENT = {
  createElement: () => {
    const c = { width: 0, height: 0 };
    c.getContext = () => ({
      createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      putImageData(img) { c.bytes = img.data; },
    });
    return c;
  },
};

/** A context stand-in with a canvas: real transforms, and a record of every fill. */
class Surface {
  constructor(w, h) {
    this.canvas = { width: w, height: h, ownerDocument: DOCUMENT };
    this.m = [1, 0, 0, 1, 0, 0];
    this.stack = [];
    this.fills = [];
    this.seen = [];
    this.globalAlpha = 1;
    this.globalCompositeOperation = 'source-over';
    this.fillStyle = '#000000';
  }

  save() { this.stack.push([this.m, this.globalAlpha, this.globalCompositeOperation, this.fillStyle]); }

  restore() {
    const s = this.stack.pop();
    if (s) [this.m, this.globalAlpha, this.globalCompositeOperation, this.fillStyle] = s;
  }

  getTransform() { const [a, b, c, d, e, f] = this.m; return { a, b, c, d, e, f }; }

  translate(x, y) { this.mul([1, 0, 0, 1, x, y]); }

  scale(x, y) { this.mul([x, 0, 0, y, 0, 0]); }

  mul(n) {
    const o = this.m;
    this.m = [
      o[0] * n[0] + o[2] * n[1], o[1] * n[0] + o[3] * n[1],
      o[0] * n[2] + o[2] * n[3], o[1] * n[2] + o[3] * n[3],
      o[0] * n[4] + o[2] * n[5] + o[4], o[1] * n[4] + o[3] * n[5] + o[5],
    ];
  }

  fillRect(x, y, w, h) {
    this.fills.push({ op: this.globalCompositeOperation, alpha: this.globalAlpha, paint: this.fillStyle, m: this.getTransform(), rect: [x, y, w, h] });
  }

  createPattern(image, repetition) { return { image, repetition }; }

  createRadialGradient(...circles) {
    return { circles, stops: [], addColorStop(at, colour) { this.stops.push([at, colour]); } };
  }
}

const W = 160;
const H = 90;
const FULL = { grain: 0.4, weave: 2, flicker: 0.1, vignette: 0.5, grade: { black: '#201810', white: '#f0e8d8', tone: '#8a6a45', toning: 0.3 } };

function piece(finish, extra = {}) {
  return validate({
    name: 'plate',
    size: { w: W, h: H },
    time: { duration: 2, hz: 12 },
    outputs: ['raster', 'vector'],
    draw(g) {
      if (g.seen) g.seen.push(g.getTransform());
      g.fillStyle = '#808080';
      g.fillRect(0, 0, W, H);
    },
    ...(finish === undefined ? {} : { finish }),
    ...extra,
  });
}

/** The fills one frame makes on a fresh surface, at a scale. */
function frame(p, solved, f, scale = 1, g = new Surface(W * scale, H * scale)) {
  const from = g.fills.length;
  drawFrame(g, p, solved, f / 23, { scale });
  return g.fills.slice(from);
}

const grainOf = (fills) => fills.find((x) => x.op === 'soft-light');

test('a finish is validated by name', () => {
  assert.equal(validate(piece(undefined)).finish, null, 'a piece has no finish unless it declares one');
  assert.deepEqual(validate(piece(FULL)).finish, FULL);
  const bad = [
    [[], /finish: must be null or/],
    [{ grain: 0.2, dust: 1 }, /unknown key\(s\) in finish: dust/],
    [{ grain: 1.5 }, /finish\.grain must be a number in \[0, 1\]/],
    [{ flicker: '0.1' }, /finish\.flicker must be a number in \[0, 1\]/],
    [{ vignette: -0.1 }, /finish\.vignette must be a number in \[0, 1\]/],
    [{ weave: -1 }, /finish\.weave must be a non-negative number of design units/],
    [{ grade: '#fff' }, /finish\.grade must be \{ black, white, tone, toning \}/],
    [{ grade: { lift: '#000000' } }, /unknown key\(s\) in finish\.grade: lift/],
    [{ grade: { black: '#000' } }, /finish\.grade\.black must be a #rrggbb colour/],
    [{ grade: { tone: '#8a6a45' } }, /tone and toning come together/],
    [{ grade: { tone: '#8a6a45', toning: 2 } }, /finish\.grade\.toning must be a number in \[0, 1\]/],
    [{ grade: { black: '#808080', white: '#f0f07f' } }, /white must be lighter than finish\.grade\.black in every channel/],
  ];
  for (const [finish, why] of bad) assert.throws(() => piece(finish), why, JSON.stringify(finish));
});

test('a still refuses a finish', () => {
  assert.throws(() => piece({ grain: 0.3 }, { time: null }), /finish: a film finish needs a timeline/);
});

test('a finish is drawn only where there are pixels', () => {
  const plain = piece(undefined);
  const film = piece(FULL);
  assert.equal(renderVector(film, { t: 0.5 }).svg, renderVector(plain, { t: 0.5 }).svg, 'an SVG keeps the marks');
  const g = new Surface(W, H);
  delete g.canvas;
  assert.deepEqual(frame(film, solve(film, 1), 5, 1, g).map((x) => x.op), ['source-over'], 'no canvas, no finish');
  assert.ok(frame(film, solve(film, 1), 5).length > 1, 'a canvas gets the finish');
});

test('the passes run in print order: grain, grade, flicker, vignette', () => {
  const p = piece(FULL);
  const fills = frame(p, solve(p, 1), 4);
  assert.deepEqual(fills.map((x) => x.op), ['source-over', 'soft-light', 'color', 'multiply', 'screen', 'source-over', 'source-over']);
  const [, grain, tone, , , , vignette] = fills;
  assert.equal(grain.alpha, 0.4);
  assert.equal(grain.paint.repetition, 'repeat');
  assert.deepEqual([tone.alpha, tone.paint], [0.3, '#8a6a45']);
  assert.equal(vignette.alpha, 0.5);
  assert.deepEqual(vignette.paint.stops, [[0, 'rgba(0,0,0,0)'], [1, '#000000']], 'clear in the middle, darkest in the corners');
  const { m, rect } = vignette;
  const corner = [m.a * rect[0] + m.e, m.d * rect[1] + m.f];
  assert.deepEqual(corner, [0, 0], 'the vignette covers the frame');
});

test('the grade maps black and white where the print holds them', () => {
  const p = piece({ grade: { black: '#201810', white: '#f0e8d8' } });
  const fills = frame(p, solve(p, 1), 0);
  const M = rgb(fills.find((x) => x.op === 'multiply').paint);
  const B = rgb(fills.find((x) => x.op === 'screen').paint);
  const print = (c, i) => 1 - (1 - c * M[i]) * (1 - B[i]);
  const [black, white] = [rgb('#201810'), rgb('#f0e8d8')];
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(print(0, i) - black[i]) < 1e-9, `channel ${i}: black lands on black`);
    assert.ok(Math.abs(print(1, i) - white[i]) <= 1 / 255, `channel ${i}: white lands on white`);
  }
  assert.ok(!fills.some((x) => x.op === 'color'), 'no tone unless declared');
});

test('grain is a function of the seed and the frame', () => {
  const p = piece({ grain: 0.3 });
  const tileOf = (seed) => grainOf(frame(p, solve(p, seed), 0)).paint.image.bytes;
  assert.ok(Buffer.from(tileOf(5)).equals(Buffer.from(tileOf(5))), 'one seed, one grain');
  assert.ok(!Buffer.from(tileOf(5)).equals(Buffer.from(tileOf(6))), 'another seed, other grain');
  const bytes = tileOf(5);
  let lo = 255, hi = 0;
  for (let i = 0; i < bytes.length; i += 4) { lo = Math.min(lo, bytes[i]); hi = Math.max(hi, bytes[i]); }
  assert.ok(lo < 40 && hi > 215, `grain spreads about mid-grey, got ${lo} to ${hi}`);

  // Drawn out of order on one surface, each frame is the frame drawn fresh.
  const solved = solve(p, 5);
  const g = new Surface(W, H);
  const at = (f) => JSON.stringify(grainOf(frame(p, solved, f, 1, g)).m);
  const fresh = (f) => JSON.stringify(grainOf(frame(p, solve(p, 5), f)).m);
  assert.deepEqual([7, 0, 7, 3].map(at), [7, 0, 7, 3].map(fresh));
});

test('the grain boils: a new offset on every frame', () => {
  const p = piece({ grain: 0.3 });
  const solved = solve(p, 2);
  const offsets = new Set();
  for (let f = 0; f < 24; f++) offsets.add(JSON.stringify(grainOf(frame(p, solved, f)).m));
  assert.ok(offsets.size >= 20, `${offsets.size} distinct offsets in 24 frames`);
});

test('the weave never uncovers an edge', () => {
  for (const [w, h, a] of [[160, 90, 2], [90, 160, 2], [160, 90, 12]]) {
    const p = validate({ ...piece({ weave: a }), size: { w, h } });
    const solved = solve(p, 3);
    let reach = 0;
    for (let f = 0; f < 24; f++) {
      const g = new Surface(w * 2, h * 2);
      drawFrame(g, p, solved, f / 23, { scale: 2 });
      const { a: k, d, e, f: y } = g.seen[0];
      assert.ok(e <= 0 && y <= 0 && k * w + e >= w * 2 && d * h + y >= h * 2, `${w} x ${h}, weave ${a}, frame ${f}: an edge shows`);
      reach = Math.max(reach, Math.abs(e + (k - 2) * w / 2) / 2);
    }
    assert.ok(reach > 0.3 * a, `${w} x ${h}: the gate moved at most ${reach} of ${a}`);
  }
  const R = require('../core/rand.js').rng(9);
  for (let f = 0; f < 500; f++) {
    const [dx, dy] = gate(R, 3, f);
    assert.ok(Math.abs(dx) <= 3 && Math.abs(dy) <= 1.5, `frame ${f}: the weave passed its amplitude`);
  }
});

test('flicker dims a frame by at most its amount', () => {
  const p = piece({ flicker: 0.1 });
  const solved = solve(p, 4);
  const dips = [];
  for (let f = 0; f < 24; f++) dips.push(frame(p, solved, f).find((x) => x.paint === '#000000').alpha);
  assert.ok(dips.every((x) => x >= 0 && x <= 0.1), 'a dip within its amount');
  assert.ok(Math.max(...dips) > 0.05 && new Set(dips).size > 20, 'the exposure changes from frame to frame');
});

test('the finish leaves the surface as it found it', () => {
  const p = piece(FULL);
  const g = new Surface(W * 3, H * 3);
  drawFrame(g, p, solve(p, 1), 0.5, { scale: 3 });
  assert.deepEqual(g.getTransform(), { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  assert.deepEqual([g.globalAlpha, g.globalCompositeOperation, g.stack.length], [1, 'source-over', 0]);
});
