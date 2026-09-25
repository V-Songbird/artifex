'use strict';

// The folded reflections in site/pieces/inversion.js, on stand-in canvases
// that keep what `reflect` puts down. Its smooth path is written out channel
// by channel for speed; these hashes were taken from the version before that,
// which made a function per pixel, so a faster fold that changed a pixel fails
// here. How the folded image is laid on a real canvas needs installed Edge.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const INVERSION = require.resolve('../pieces/inversion.js');

/** Every image `reflect` puts down in `run(I, g)`, hashed, on a stand-in canvas of w x h. */
function folded(w, h, run) {
  const saved = { OffscreenCanvas: globalThis.OffscreenCanvas, ImageData: globalThis.ImageData };
  const hash = crypto.createHash('sha256');
  globalThis.ImageData = class { constructor(iw, ih) { this.width = iw; this.height = ih; this.data = new Uint8ClampedArray(iw * ih * 4); } };
  globalThis.OffscreenCanvas = class {
    constructor(cw, ch) { this.width = cw; this.height = ch; }
    getContext() { return { putImageData: (img) => hash.update(img.data) }; }
  };
  try {
    delete require.cache[INVERSION];
    const I = require(INVERSION);
    let m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    const g = { canvas: { width: w, height: h }, getTransform: () => m, save() {}, restore() {}, setTransform() {}, drawImage() {} };
    run(I, g, (z, tx, ty) => { const k = w / 1200; m = { a: z * k, b: 0, c: 0, d: z * k, e: tx * z * k, f: ty * z * k }; });
  } finally {
    Object.assign(globalThis, saved);
  }
  return hash.digest('hex').slice(0, 16);
}

// The portal's triangle, a scene of seeded noise and its mean tone.
const s = { triangle: [[435, 495], [765, 495], [600, 209.2]], params: { side: 330 } };
const tex = { w: 600, h: 400, data: new Uint32Array(600 * 400), mean: [120.3, 110.7, 100.1] };
for (let i = 0, r = 1; i < tex.data.length; i++) { r = (r * 1103515245 + 12345) >>> 0; tex.data[i] = 0xff000000 | (r >>> 8); }

test('inversion: the fold, the hole and the smooth path lay the same pixels as before', () => {
  const at = (I, turn) => I.circles(s, 0.4, turn);
  assert.equal(folded(1200, 800, (I, g, view) => {
    for (let k = 0; k < 4; k++) {
      view(1, 0, 0);
      I.reflect(g, at(I, 0.1 * k), 0.1, tex);
      I.reflect(g, at(I, 0.1 * k), 0.1, tex, false, 2, 0.3);
      view(4, -500, -300);
      I.reflect(g, at(I, 0.1 * k), 0.1, tex, true, 2, 0.1);
      view(9, -560, -330);
      I.reflect(g, at(I, 0.1 * k), 0.1, tex, true, 2, 0);
    }
  }), '289d32370cfd5d7a');
});

test('inversion: at a lowered scale and while the mirrors bow, the same pixels as before', () => {
  assert.equal(folded(900, 600, (I, g, view) => {
    for (let k = 0; k < 4; k++) {
      view(1 + k, -60 * k, -40 * k);
      I.reflect(g, I.circles(s, 0.1 * (k + 1), 0.05 * k), 0.025 * (k + 1), tex, k > 1);
    }
  }), '41cd8d9434d20b78');
});
