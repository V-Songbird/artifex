'use strict';

// The example set is infrastructure, not decoration.
//
// The project's governing rule says the examples ARE the real
// specification: a library that has only ever drawn the art it was built for has
// no evidence it generalises, and the gaps show up as missing primitives rather
// than as failing tests. So the set itself is checked -- that it spans idioms
// that break each other, that each one reaches what it declares, and that
// nothing in it is decorative.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { validate, solve, frameT, frameCount, frameDen, clockAt } = require('../core/piece.js');
const { renderVector, drawFrame, playheads } = require('../core/render.js');
const { show } = require('../core/image.js');
const { VectorSurface } = require('../core/surface-vector.js');
const { nullSurface } = require('../tools/bench.js');
const { blank } = require('../tools/js-comments.js');
const { fakeCanvas } = require('./fake-media.js');
const font = require('../examples/stroke-font.js');
const EXAMPLES = require('../examples/index.js');

const NAMES = Object.keys(EXAMPLES);
const DASH = new VectorSurface({ w: 1, h: 1 });

function grab(fn) {
  try { fn(); } catch (e) { return e; }
  throw new Error('expected a throw, and none happened');
}

// ---------------------------------------------------------------------------
// A recording surface. Canvas2D-shaped, records what it was asked to do.
//
// It exists because Node has no canvas, so without it a raster piece's `draw`
// could only be claimed to work. It records STYLE as well as geometry, because
// the difference between a line arriving and a finished line fading in lives
// entirely in the style.
//
// It implements the whole drawing surface, and a test below enforces that.
// Missing recorder methods must not prevent pieces from using supported curves,
// clipping, gradients or transforms.
// ---------------------------------------------------------------------------
class Recorder {
  constructor(size) {
    this.ops = [];
    this.arcs = [];
    this._initState();
    this._box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const key of Object.keys(this._s)) {
      Object.defineProperty(this, key, {
        get: () => this._s[key],
        set: (v) => { this._s[key] = v; this.ops.push(`${key}=${v}`); },
      });
    }
    if (size) {
      // Auxiliary canvases keep uploaded pixels AND vector marks. The stand-in
      // does not rasterize every path, so its bytes alone cannot judge a sprite.
      const document = {
        createElement() {
          const canvas = { width: 0, height: 0, ownerDocument: document };
          return fakeCanvas(canvas, () => (canvas.recording = new Recorder()));
        },
      };
      this.canvas = { width: size.w, height: size.h, ownerDocument: document };
    }
  }

  _initState() {
    this._s = {
      fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1,
      lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, lineDashOffset: 0,
      globalCompositeOperation: 'source-over', filter: 'none', shadowBlur: 0,
      shadowColor: 'rgba(0, 0, 0, 0)', shadowOffsetX: 0, shadowOffsetY: 0,
    };
    this._dash = [];
    this._stack = [];
    // A REAL transform. Recording `scale` without applying it would make the
    // 1x/8x check measure this class instead of the piece, and it would pass
    // for the wrong reason -- which is the failure mode this whole project is
    // organised against.
    this._m = [1, 0, 0, 1, 0, 0];
  }

  // ---- state ----
  // A canvas reset(): save stack, transform, styles and dash back to defaults.
  reset() { this._initState(); this.ops.push('reset'); }

  save() { this._stack.push({ ...this._s, m: this._m, dash: this._dash }); this.ops.push('save'); }

  restore() {
    const p = this._stack.pop();
    if (p) { this._m = p.m; this._dash = p.dash; delete p.m; delete p.dash; this._s = p; }
    this.ops.push('restore');
  }

  // ---- transform ----
  transform(a, b, c, d, e, f) { this._mul([a, b, c, d, e, f]); this.ops.push('transform'); }

  setTransform(a, b, c, d, e, f) { this._m = [a, b, c, d, e, f]; this.ops.push('setTransform'); }

  resetTransform() { this._m = [1, 0, 0, 1, 0, 0]; this.ops.push('resetTransform'); }

  getTransform() {
    const [a, b, c, d, e, f] = this._m;
    return { a, b, c, d, e, f };
  }

  translate(x, y) { this._mul([1, 0, 0, 1, x, y]); this.ops.push('translate'); }

  scale(x, y) { this._mul([x, 0, 0, y, 0, 0]); this.ops.push(`scale(${x},${y})`); }

  rotate(a) { this._mul([Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]); this.ops.push('rotate'); }

  _mul(m) {
    const o = this._m;
    this._m = [
      o[0] * m[0] + o[2] * m[1], o[1] * m[0] + o[3] * m[1],
      o[0] * m[2] + o[2] * m[3], o[1] * m[2] + o[3] * m[3],
      o[0] * m[4] + o[2] * m[5] + o[4], o[1] * m[4] + o[3] * m[5] + o[5],
    ];
  }

  /** Uniform scale of the current transform, as the vector surface computes it. */
  get _k() { return Math.sqrt(Math.abs(this._m[0] * this._m[3] - this._m[1] * this._m[2])); }

  _x(x, y) { return this._m[0] * x + this._m[2] * y + this._m[4]; }

  _y(x, y) { return this._m[1] * x + this._m[3] * y + this._m[5]; }

  /** Record a point as GEOMETRY. Digits scraped back out of an op string can
   *  come from a colour: "#16161a" once reported itself as the picture's
   *  width, and the 1x/8x check passed on it. */
  _pt(x, y) {
    const px = this._x(x, y);
    const py = this._y(x, y);
    if (px < this._box[0]) this._box[0] = px;
    if (py < this._box[1]) this._box[1] = py;
    if (px > this._box[2]) this._box[2] = px;
    if (py > this._box[3]) this._box[3] = py;
    return [r(px), r(py)];
  }

  /** Extend the box by a radius around a point, in device units. */
  _rad(x, y, rad) {
    const k = rad * this._k;
    this._pt(x, y);
    const cx = this._x(x, y);
    const cy = this._y(x, y);
    this._box[0] = Math.min(this._box[0], cx - k);
    this._box[1] = Math.min(this._box[1], cy - k);
    this._box[2] = Math.max(this._box[2], cx + k);
    this._box[3] = Math.max(this._box[3], cy + k);
    return k;
  }

  get bbox() { return this._box; }

  // ---- path ----
  beginPath() { this.ops.push('beginPath'); }

  closePath() { this.ops.push('closePath'); }

  moveTo(x, y) { this.ops.push(`M${this._pt(x, y).join(',')}`); }

  lineTo(x, y) { this.ops.push(`L${this._pt(x, y).join(',')}`); }

  bezierCurveTo(a, b, c, d, e, f) {
    this.ops.push(`C${this._pt(a, b).join(',')},${this._pt(c, d).join(',')},${this._pt(e, f).join(',')}`);
  }

  quadraticCurveTo(a, b, c, d) {
    this.ops.push(`Q${this._pt(a, b).join(',')},${this._pt(c, d).join(',')}`);
  }

  arcTo(x1, y1, x2, y2, rad) {
    this.ops.push(`T${this._pt(x1, y1).join(',')},${this._pt(x2, y2).join(',')},${r(rad * this._k)}`);
  }

  rect(x, y, w, h) {
    const a = this._pt(x, y);
    this._pt(x + w, y + h);
    this.ops.push(`R${a.join(',')},${r(w * this._k)},${r(h * this._k)}`);
  }

  roundRect(x, y, w, h, radii = 0) {
    const a = this._pt(x, y);
    this._pt(x + w, y + h);
    this.ops.push(`RR${a.join(',')},${r(w * this._k)},${r(h * this._k)},${JSON.stringify(radii)}`);
  }

  arc(x, y, rad, a, b, ccw = false) {
    // The RADIUS reaches the bounding box and the ANGLES reach the digest.
    // They used to reach neither: a piece made entirely of discs passed the
    // 1x/8x check with radii that never scaled, and a change of arc phase or
    // sweep was invisible to every determinism check in this file.
    const k = this._rad(x, y, rad);
    const key = `A${r(this._x(x, y))},${r(this._y(x, y))},${r(k)},${r(a)},${r(b)},${ccw ? 1 : 0}`
      + `:${paint(this._s.fillStyle)}:${r(this._s.globalAlpha)}`;
    this.ops.push(key);
    this.arcs.push(key);
  }

  ellipse(x, y, rx, ry, rot, a, b, ccw = false) {
    this._rad(x, y, Math.max(rx, ry));
    this.ops.push(`E${r(this._x(x, y))},${r(this._y(x, y))},${r(rx * this._k)},${r(ry * this._k)},${r(rot)},${r(a)},${r(b)},${ccw ? 1 : 0}`);
  }

  // ---- paint ----
  fill(rule) { this.ops.push(`fill:${paint(this._s.fillStyle)}:${r(this._s.globalAlpha)}${rule ? ':' + rule : ''}`); }

  stroke() { this.ops.push(`stroke:${paint(this._s.strokeStyle)}:${r(this._s.lineWidth * this._k)}`); }

  clip(rule) { this.ops.push(`clip${rule ? ':' + rule : ''}`); }

  fillRect(x, y, w, h) {
    const a = this._pt(x, y);
    this._pt(x + w, y + h);
    this.ops.push(`FR${a.join(',')},${r(w * this._k)},${r(h * this._k)}:${paint(this._s.fillStyle)}`);
  }

  strokeRect(x, y, w, h) {
    const a = this._pt(x, y);
    this._pt(x + w, y + h);
    this.ops.push(`SR${a.join(',')},${r(w * this._k)},${r(h * this._k)}:${paint(this._s.strokeStyle)}:${r(this._s.lineWidth * this._k)}`);
  }

  clearRect(x, y, w, h) {
    const a = this._pt(x, y);
    this._pt(x + w, y + h);
    this.ops.push(`XR${a.join(',')},${r(w * this._k)},${r(h * this._k)}`);
  }

  // ---- dashes ----
  // VectorSurface's canvas rule: a list with a negative or non-finite entry is ignored, an odd-length list doubled.
  setLineDash(a) { this._dash = DASH.setLineDash(this._dash).setLineDash(a).getLineDash(); this.ops.push(`dash=[${this._dash.join(',')}]`); }

  getLineDash() { return this._dash.slice(); }

  // ---- paint servers ----
  createLinearGradient(x0, y0, x1, y1) { return new RecordedGradient(this, `lg(${r(x0)},${r(y0)},${r(x1)},${r(y1)})`); }

  createRadialGradient(x0, y0, r0, x1, y1, r1) {
    return new RecordedGradient(this, `rg(${r(x0)},${r(y0)},${r(r0)},${r(x1)},${r(y1)},${r(r1)})`);
  }

  createImageData(width, height) {
    return { width, height, data: new Uint8ClampedArray(width * height * 4) };
  }

  putImageData(image, x, y) {
    // ImageData is already in device pixels and ignores the current transform.
    this._box[0] = Math.min(this._box[0], x);
    this._box[1] = Math.min(this._box[1], y);
    this._box[2] = Math.max(this._box[2], x + image.width);
    this._box[3] = Math.max(this._box[3], y + image.height);
    const hash = crypto.createHash('sha256');
    hash.update(image.data);
    this.ops.push(`PX${x},${y},${image.width},${image.height}:${hash.digest('hex')}`);
  }

  drawImage(source, ...box) {
    const pixels = source && source.pixels;
    if (!ArrayBuffer.isView(pixels) || pixels.BYTES_PER_ELEMENT !== 1
      || !Number.isInteger(source.width) || source.width <= 0 || !Number.isInteger(source.height) || source.height <= 0
      || pixels.length !== source.width * source.height * 4) {
      throw new Error('Recorder.drawImage needs actual RGBA bytes');
    }
    if (box.length === 2) box.push(source.width, source.height);
    if (box.length !== 4) throw new Error('Recorder.drawImage supports a whole image at a point or in a destination rectangle');
    if (!box.every(Number.isFinite)) throw new Error('Recorder.drawImage needs finite destination coordinates');
    const [x, y, w, h] = box;
    if (w === 0 || h === 0) return;
    const corners = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([u, v]) => this._pt(u, v));
    const hash = crypto.createHash('sha256').update(pixels).update(source.recording ? source.recording.digest : '').digest('hex');
    this.ops.push(`IM${source.width},${source.height}:${hash}:${corners.flat().join(',')}:${this.globalAlpha}:${this.globalCompositeOperation}`);
  }

  get markCount() { return this.ops.filter((o) => /^(fill|stroke:|FR|SR|PX|IM)/.test(o)).length; }

  get digest() { return this.ops.join('|'); }
}

class RecordedGradient {
  constructor(rec, head) { this.rec = rec; this.stops = []; this.head = head; }

  addColorStop(offset, color) { this.stops.push(`${r(offset)}:${color}`); return this; }

  toString() { return `${this.head}{${this.stops.join(';')}}`; }
}

const r = (v) => (Number.isFinite(v) ? Math.round(v * 1e3) / 1e3 : String(v));

/** Resolve a paint for the digest. A gradient reaches it as its stops, not as
 *  "[object Object]" -- otherwise two different gradients record identically
 *  and the determinism checks cannot tell them apart. */
const paint = (style) => (style instanceof RecordedGradient ? style.toString() : String(style));

// A caller drawing many frames of one solve passes it as `solved`, as the page
// and the film export do, so a costly build stage runs once and not per frame.
function record(raw, seed, t, params, solved) {
  const p = validate(raw);
  // Pixel-family invariants sample real bytes at 64 pixels wide. Every declared
  // frame, seed and parameter pin still runs; native full-resolution equality
  // and dedicated pixel checks cover the raster path separately.
  const scale = p.preview ? Math.min(1, 64 / p.size.w) : 1;
  const g = new Recorder({ w: Math.ceil(p.size.w * scale), h: Math.ceil(p.size.h * scale) });
  // These invariants have always measured marks without the film finish.
  // A changing grain tile must not make a static picture count as animation.
  drawFrame(g, { ...p, finish: null }, solved || solve(p, seed === undefined ? p.seed : seed, params), t === undefined ? 1 : t, { scale });
  return g;
}

test('the recorder measures raster bytes and device-space image bounds', () => {
  const a = new Recorder(), b = new Recorder();
  const image = a.createImageData(2, 1);
  image.data.set([40, 70, 80, 255, 100, 120, 130, 255]);
  a.scale(8, 8); a.putImageData(image, 3, 4);
  image.data[0] = 41;
  b.scale(8, 8); b.putImageData(image, 3, 4);
  assert.notEqual(a.digest, b.digest, 'one changed pixel reaches the digest');
  assert.deepEqual(a.bbox, [3, 4, 5, 5], 'putImageData ignores the transform');
  assert.equal(a.markCount, 1);
});

test('the recorder measures shown image bytes, dimensions, alpha and composition', () => {
  const image = { w: 2, h: 1, channels: 4, data: new Uint8Array([40, 70, 80, 255, 100, 120, 130, 255]) };
  const capture = (img, alpha = 1, mode = 'source-over') => {
    const g = new Recorder({ w: 8, h: 4 });
    g.globalAlpha = alpha;
    g.globalCompositeOperation = mode;
    show(g, img, 0, 0, 8, 4);
    return g;
  };
  const a = capture(image), changed = { ...image, data: new Uint8Array(image.data) };
  changed.data[0]++;
  assert.notEqual(a.digest, capture(changed).digest, 'one changed byte reaches the image digest');
  assert.notEqual(a.digest, capture({ ...image, w: 1, h: 2 }).digest, 'source dimensions reach the digest');
  assert.notEqual(a.digest, capture(image, 0.5).digest, 'alpha reaches the digest');
  assert.notEqual(a.digest, capture(image, 1, 'multiply').digest, 'composition reaches the digest');
  assert.equal(a.markCount, 1);
  assert.throws(() => a.drawImage({ width: 1, height: 1 }, 0, 0), /actual RGBA bytes/);
  assert.throws(() => a.drawImage({ width: 1, height: 1, pixels: new Uint8Array(4) }, 0, 0, 1, 1, 0, 0, 1, 1), /whole image/);
});

test('the recorder measures all four transformed image corners', () => {
  const image = { w: 1, h: 1, channels: 4, data: new Uint8Array([40, 70, 80, 255]) };
  for (const [name, matrix, expected] of [
    ['translation and enlargement', [2, 0, 0, 3, 10, 20], [18, 35, 30, 59]],
    ['rotation', [0, 1, -1, 0, 10, 20], [-3, 24, 5, 30]],
    ['skew', [2, 1, -1, 3, 10, 20], [5, 39, 25, 69]],
  ]) {
    const g = new Recorder({ w: 80, h: 80 });
    g.setTransform(...matrix);
    show(g, image, 4, 5, 6, 8);
    assert.deepEqual(g.bbox, expected, name);
  }
});

test('the generic recorder does not let an animated finish hide a static image', () => {
  const image = { w: 2, h: 1, channels: 4, data: new Uint8Array([40, 70, 80, 255, 100, 120, 130, 255]) };
  const piece = {
    name: 'static-image', size: { w: 2, h: 1 }, time: { duration: 1, hz: 3 },
    outputs: ['raster'], finish: { grain: 1, weave: 1 },
    draw(g) { show(g, image, 0, 0, 2, 1); },
  };
  const first = record(piece, 7, 0);
  assert.equal(first.markCount, 1, 'the image itself is recorded');
  assert.equal(first.digest, record(piece, 7, 1).digest, 'finish animation cannot satisfy the timeline check');
  assert.equal(first.digest, record({ ...piece, finish: null }, 7, 0).digest, 'mark-only coverage is unchanged');
  const moving = { ...piece, draw(g, s, t) { show(g, image, t, 0, 2, 1); } };
  assert.notEqual(record(moving, 7, 0).digest, record(moving, 7, 1).digest, 'real image motion remains visible');
});

test('the generic recorder sees vector changes inside an auxiliary sprite', () => {
  const { sprite } = require('../core/layer.js');
  const piece = {
    name: 'sprite-vector', size: { w: 4, h: 4 }, outputs: ['raster'],
    params: { tip: { min: 1, max: 3, value: 2, meaning: 'Horizontal position of the line tip' } },
    draw(g, s) {
      sprite(g, s, 'line', [0, 0, 4, 4], (cg, state) => {
        cg.beginPath(); cg.moveTo(0, 0); cg.lineTo(state.params.tip, 4); cg.stroke();
      });
    },
  };
  // fakeCanvas does not rasterize this path. Its recorded operations must
  // distinguish the two lines even when the auxiliary RGBA bytes are equal.
  assert.notEqual(record(piece, 7, 0, { tip: 1 }).digest, record(piece, 7, 0, { tip: 3 }).digest);
});

test('the recorder and the style-proof surface read the dash back as a canvas and VectorSurface do', () => {
  const { proofSurface } = require('../tools/styles.js');
  for (const [name, g] of [['recorder', new Recorder()], ['proof surface', proofSurface([0, 0, 1, 1]).g], ['VectorSurface', new VectorSurface({ w: 1, h: 1 })]]) {
    g.setLineDash([1]);
    assert.deepEqual(g.getLineDash(), [1, 1], name + ' stores an odd-length dash doubled');
    g.setLineDash([-1, 2]);
    assert.deepEqual(g.getLineDash(), [1, 1], name + ' ignores a dash with a negative entry');
    g.setLineDash([2, Infinity]);
    assert.deepEqual(g.getLineDash(), [1, 1], name + ' ignores a dash with a non-finite entry');
  }
});

// ---------------------------------------------------------------------------
// The set
// ---------------------------------------------------------------------------

test('THE RECORDER IMPLEMENTS THE WHOLE SURFACE, so the suite cannot narrow the art', () => {
  // Keep the recorder vocabulary aligned with the supported drawing surface.
  //
  // The exclusions are the members no draw() ever calls -- the ones a CALLER
  // uses to configure the surface or to read its result. `toSVG` reads the
  // document out; `setManifest` writes the recipe into it. Neither is part of
  // the drawing vocabulary a piece is entitled to, so neither belongs in the
  // harness. Everything else does, and this list stays this short on purpose.
  const NOT_DRAWN_WITH = new Set(['toSVG', 'setManifest']);
  const surface = Object.getOwnPropertyNames(VectorSurface.prototype)
    .filter((k) => k !== 'constructor' && !k.startsWith('_') && !NOT_DRAWN_WITH.has(k));
  const rec = new Recorder();

  const missing = surface.filter((k) => !(k in rec));
  assert.deepEqual(missing, [],
    `the test harness is missing ${missing.length} member(s) of the surface it stands in for: `
    + `${missing.join(', ')}. A piece using one of these works in a browser and in SVG, and `
    + 'fails npm test with a bare TypeError.');

  // And prove it behaviourally: every drawing call in the vocabulary must run
  // on BOTH surfaces without throwing. A stub that exists and does nothing
  // would pass the check above.
  const calls = [
    ['beginPath'], ['moveTo', 1, 2], ['lineTo', 3, 4], ['closePath'],
    ['bezierCurveTo', 1, 2, 3, 4, 5, 6], ['quadraticCurveTo', 1, 2, 3, 4],
    ['arcTo', 1, 2, 3, 4, 1], ['rect', 0, 0, 5, 5], ['roundRect', 0, 0, 5, 5, 1],
    ['arc', 5, 5, 3, 0, 1], ['ellipse', 5, 5, 3, 2, 0, 0, 1],
    ['fill'], ['stroke'], ['clip'], ['fillRect', 0, 0, 2, 2],
    ['strokeRect', 0, 0, 2, 2],
    ['save'], ['translate', 1, 1], ['rotate', 0.1], ['scale', 2, 2],
    ['transform', 1, 0, 0, 1, 1, 1], ['setTransform', 1, 0, 0, 1, 0, 0],
    ['resetTransform'], ['restore'], ['reset'],
    ['setLineDash', [2, 1]], ['getLineDash'],
    ['createLinearGradient', 0, 0, 1, 1], ['createRadialGradient', 0, 0, 0, 1, 1, 1],
  ];
  for (const [name, ...args] of calls) {
    for (const g of [new Recorder(), new VectorSurface({ w: 10, h: 10 })]) {
      assert.doesNotThrow(() => g[name](...args), `${g.constructor.name}.${name}()`);
    }
  }

  // `clearRect` is the one op the two surfaces are MEANT to disagree about: a
  // raster piece may erase, and SVG has no eraser. The recorder takes it, the
  // vector surface refuses it BY NAME, and that difference is exactly what
  // declaring an output is for.
  assert.doesNotThrow(() => new Recorder().clearRect(0, 0, 1, 1));
  assert.throws(() => new VectorSurface({ w: 10, h: 10 }).clearRect(0, 0, 1, 1),
    /clearRect\(\) cannot erase/);

  // Every style property must be settable and readable on both.
  for (const [k, v] of [['fillStyle', '#123'], ['strokeStyle', '#456'], ['lineWidth', 2],
    ['globalAlpha', 0.5], ['lineCap', 'round'], ['lineJoin', 'bevel'],
    ['miterLimit', 3], ['lineDashOffset', 1], ['shadowColor', '#789'],
    // Settable on the vector surface only at the value that draws nothing else.
    ['globalCompositeOperation', 'source-over'], ['filter', 'none'], ['shadowBlur', 0],
    ['shadowOffsetX', 0], ['shadowOffsetY', 0]]) {
    for (const g of [new Recorder(), new VectorSurface({ w: 10, h: 10 })]) {
      g[k] = v;
      assert.equal(g[k], v, `${g.constructor.name}.${k}`);
    }
  }
});

test('there is never exactly one example', () => {
  // One example is a template, and a template is a scope.
  assert.ok(NAMES.length >= 2, `the set holds ${NAMES.length}`);
});

test('the set spans idioms that break each other', () => {
  const p = NAMES.map((n) => validate(EXAMPLES[n]));
  const has = (f) => p.filter(f).map((x) => x.name);
  assert.ok(has((x) => x.play).length, 'a piece that answers a person');

  const stills = has((x) => x.time === null);
  const timelines = has((x) => x.time !== null);
  const rasterOnly = has((x) => !x.outputs.includes('vector'));
  const vector = has((x) => x.outputs.includes('vector'));

  assert.ok(stills.length, 'a still with no timeline');
  assert.ok(timelines.length, 'a piece with a timeline');
  // The one that matters most: if EVERY example could go to vector, the set
  // would be quietly claiming that every piece can, and nothing would ever
  // exercise the refusal path.
  assert.ok(rasterOnly.length, 'a piece that declares raster only, and means it');
  assert.ok(vector.length, 'a piece that reaches a plotter');

  // Shapes drawn: a set in which everything is a stroke, or everything a fill,
  // is one idiom wearing five names.
  const drawn = NAMES.map((n) => {
    const g = record(EXAMPLES[n], undefined, 1);
    return {
      name: n,
      arcs: g.ops.filter((o) => o[0] === 'A').length,
      lines: g.ops.filter((o) => o[0] === 'L').length,
      rects: g.ops.filter((o) => o[0] === 'R').length,
    };
  });
  assert.ok(drawn.some((d) => d.arcs > 100), 'something is built from soft round marks');
  assert.ok(drawn.some((d) => d.lines > 100 && d.arcs === 0), 'something is built from polylines alone');
  assert.ok(drawn.some((d) => d.rects > 50), 'something is built from areas');
});

test('every example validates against the contract, unchanged', () => {
  for (const n of NAMES) {
    const p = validate(EXAMPLES[n]);
    assert.equal(p.name, n, `${n} is filed under its own name`);
    assert.ok(p.size.w > 0 && p.size.h > 0);
  }
});

// ---------------------------------------------------------------------------
// The one property everything rests on
// ---------------------------------------------------------------------------

test('the same seed and playhead give the same frame, for every example', () => {
  for (const n of NAMES) {
    const t = validate(EXAMPLES[n]).time ? 0.5 : 0;
    assert.equal(record(EXAMPLES[n], 3, t).digest, record(EXAMPLES[n], 3, t).digest, n);
  }
});

test('a scrub lands where a forward play lands', () => {
  // Scrubbing backwards then forwards must give the frame that playing straight
  // through would have given. Nothing may carry over between frames.
  for (const n of NAMES) {
    const p = validate(EXAMPLES[n]);
    if (!p.time) continue;
    const straight = [0.2, 0.5, 0.8].map((t) => record(EXAMPLES[n], 3, t).digest);
    const scrubbed = [0.8, 0.5, 0.2].map((t) => record(EXAMPLES[n], 3, t).digest).reverse();
    assert.deepEqual(scrubbed, straight, n);
  }
});

test('a different seed gives a different frame', () => {
  for (const n of NAMES) {
    const t = validate(EXAMPLES[n]).time ? 0.6 : 0;
    assert.notEqual(record(EXAMPLES[n], 1, t).digest, record(EXAMPLES[n], 2, t).digest, n);
  }
});

test('a still ignores the playhead completely', () => {
  for (const n of NAMES) {
    // A piece with play has no timeline either, but its t is the session's time.
    if (validate(EXAMPLES[n]).time || validate(EXAMPLES[n]).play) continue;
    assert.equal(record(EXAMPLES[n], 5, 0).digest, record(EXAMPLES[n], 5, 1).digest, n);
    assert.deepEqual(playheads(EXAMPLES[n]), [0], n);
  }
});

test('a timeline does not, and every drawn frame is distinct enough to be worth drawing', () => {
  for (const n of NAMES) {
    const p = validate(EXAMPLES[n]);
    if (!p.time) continue;
    const solved = solve(p, 5);
    const seen = new Set(playheads(p).map((t) => record(EXAMPLES[n], 5, t, undefined, solved).digest));
    const frames = frameCount(p);
    // Not every frame need differ -- a hold is legitimate -- but a timeline in
    // which most frames are identical is a still that costs 240x as much.
    assert.ok(seen.size > frames * 0.5, `${n}: ${seen.size} distinct frames out of ${frames}`);
  }
});

// ---------------------------------------------------------------------------
// Declared, not assumed
// ---------------------------------------------------------------------------

test('every piece that declares vector actually reaches it', () => {
  for (const n of NAMES) {
    const p = validate(EXAMPLES[n]);
    if (!p.outputs.includes('vector')) continue;
    const out = renderVector(EXAMPLES[n], { t: 1 });
    assert.ok(out.marks > 0, `${n} declared vector and drew nothing`);
    assert.match(out.svg, /^<svg xmlns/, n);
    assert.equal(out.svg, renderVector(EXAMPLES[n], { t: 1 }).svg, `${n} is byte-identical on a re-render`);
  }
});

test('a piece that declares raster only is REFUSED for vector, by name', () => {
  const raster = NAMES.filter((n) => !validate(EXAMPLES[n]).outputs.includes('vector'));
  assert.ok(raster.length, 'the set must contain one, or this check cannot fail');
  for (const n of raster) {
    const e = grab(() => renderVector(EXAMPLES[n]));
    assert.match(e.message, /has not declared vector output/, n);
    assert.match(e.message, new RegExp(`"${n}"`), 'and it is named');
  }
});

test('EVERY DECLARED PARAMETER MOVES THE OUTPUT, at three pins and not two', () => {
  // Two pins is not enough: a cyclic parameter has the same value at both ends
  // of its range, and a parameter read nowhere has the same value everywhere.
  let checked = 0;
  for (const n of NAMES) {
    const p = validate(EXAMPLES[n]);
    const t = p.time ? 0.5 : 0;
    for (const [k, d] of Object.entries(p.params)) {
      const seen = new Set([d.min, d.value, d.max].map((v) => record(EXAMPLES[n], 7, t, { [k]: v }).digest));
      assert.ok(seen.size >= 2, `${n}.${k} is declared but the output does not move with it`);
      checked++;
    }
  }
  assert.ok(checked >= 5, `only ${checked} parameters were checked`);
});

test('EVERY DECLARED PARAMETER SAYS WHAT IT DOES, in its own words', () => {
  // validate() already refuses a missing `meaning`, so presence is not what is
  // at risk here -- the risk is the field being filled to get past the
  // validator. Two ways that happens, and both are checked: restating the
  // parameter's own name, and pasting one knob's line onto the next. Either
  // leaves metadata that validates structurally but does not explain the knob.
  let checked = 0;
  for (const n of NAMES) {
    const p = validate(EXAMPLES[n]);
    const seen = new Map();
    for (const [k, d] of Object.entries(p.params)) {
      const m = d.meaning.trim();
      assert.ok(m.split(/\s+/).length >= 4,
        `${n}.${k}: "${m}" is not a sentence about the picture`);
      assert.notEqual(m.toLowerCase(), k.toLowerCase(), `${n}.${k} restates its own name`);
      const twin = seen.get(m);
      assert.equal(twin, undefined, `${n}.${k} and ${n}.${twin} carry the same meaning`);
      seen.set(m, k);
      checked++;
    }
  }
  assert.ok(checked >= 5, `only ${checked} parameters were checked`);
});

test('ALL SEVENTEEN WALLPAPER SIGNATURES ARE ACTUALLY GROUPS', () => {
  // examples/pattern.js keeps its own symmetry table, because nothing in core
  // knows what a lattice is and N4 says a capability waits for a second reader.
  // A table like that is exactly where a wrong entry hides: a missing coset
  // still tiles, still looks deliberate, and is simply not the group it claims.
  // So every one of the seventeen is checked against the group axioms rather
  // than spot-checked -- the piece publishes its cosets on the state, so this
  // needs no extra export.
  const p = validate(EXAMPLES.pattern);
  const g = p.params.group;
  const n = Math.round(g.max - g.min) + 1;
  assert.equal(n, 17, `the group knob spans ${n} values, and there are 17 wallpaper groups`);

  // Compose two lattice transforms, then wrap the translation back into one
  // cell: a wallpaper group is a group MODULO its lattice.
  const comp = (a, b) => [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
  const key = (m) => [m[0], m[1], m[2], m[3], ((m[4] % 1) + 1) % 1, ((m[5] % 1) + 1) % 1]
    .map((v) => Math.round(v * 1e6) / 1e6).join(',');
  const IDENTITY = key([1, 0, 0, 1, 0, 0]);

  const seen = new Set();
  for (let i = 0; i < n; i++) {
    const s = solve(p, 7, { group: i }).state;
    const set = new Set(s.cosets.map(key));

    assert.equal(set.size, s.cosets.length, `${s.sig} lists the same coset twice`);
    assert.equal(s.cosets.length, s.order, `${s.sig} claims order ${s.order} and carries ${s.cosets.length}`);
    assert.ok(set.has(IDENTITY), `${s.sig} has no identity, so it is not a group`);
    for (const a of s.cosets) {
      for (const b of s.cosets) {
        assert.ok(set.has(key(comp(a, b))),
          `${s.sig} is not closed: composing two of its cosets leaves the group`);
      }
    }
    assert.equal(seen.has(s.sig), false, `${s.sig} appears twice in the table`);
    seen.add(s.sig);
  }
  assert.equal(seen.size, 17, `the table names ${seen.size} distinct signatures`);
});

// The libm calls whose last bit ECMAScript does not pin, in the code of `src`
// (null for none). Comments, strings, templates and regular expressions are
// blanked first; the code in `${…}` stays.
const bannedMath = (src) => blank(src).match(/Math\.(sin|cos|tan|asin|acos|atan2?|exp|expm1|pow|hypot|cbrt)\b/g);
// Code holds `**` only as the power operator, whatever its operand or `**=`.
const usesPower = (src) => blank(src).includes('**');

test('the determinism check still sees a banned call after a // inside a string', () => {
  const src = "const ns = 'http://example.test/ns'; const y = Math.sin(1); // Math.cos(1)\n/* Math.exp(1) */";
  assert.deepEqual(bannedMath(src), ['Math.sin']);
});

test('the determinism check reads no call or ** inside a string', () => {
  const src = "const a = 'Math.sin(1)', b = \"2 ** 3\", c = `Math.cos(x) ${Math.exp(1)} y ** 2`;";
  assert.deepEqual(bannedMath(src), ['Math.exp']);
  assert.equal(usesPower(src), false);
  assert.equal(usesPower('const d = x ** 2;'), true);
});

test('the determinism check sees ** with a signed or decimal operand, and **=', () => {
  for (const src of ['y = x ** -1;', 'y = x ** .5;', 'x **= 2;', 'y = x ** +z;', 'y = (a) ** -b;']) assert.equal(usesPower(src), true, src);
  assert.equal(usesPower('/** a doc comment */ function* g() { yield* h(); }'), false);
});

test("the attractor's orbit is arithmetic, because a chaotic orbit amplifies a last bit", () => {
  // ECMAScript does not pin the last bit of sin, cos, exp, pow or hypot, so two
  // engines may disagree by one ulp. On an orbit separating at 0.2 nats a step
  // that is not a rounding difference, it is a different picture -- and the
  // determinism contract is the thing this whole library rests on.
  const src = fs.readFileSync(path.join(__dirname, '..', 'examples', 'attractor.js'), 'utf8');
  const banned = bannedMath(src);
  assert.deepEqual(banned, null,
    `the attractor calls ${banned && [...new Set(banned)].join(', ')} outside a comment`);
  assert.equal(usesPower(src), false, 'and it uses no ** operator either');

  // And the orbit is bit-identical when run twice, which is the property all of
  // that is FOR.
  const p = validate(EXAMPLES.attractor);
  const a = solve(p, 7).state;
  const b = solve(p, 7).state;
  assert.deepEqual(a.coef, b.coef, 'the same seed picked a different map the second time');
  assert.equal(a.lyapunov, b.lyapunov);
  assert.equal(a.peak, b.peak, 'and the density landed differently');
});

test('the attractor refuses an orbit that is not strange, and says which verdict it got', () => {
  // About 1.7% of coefficient sets in this family are strange, so a piece that
  // assumed instead of measuring would draw a dot, a loop or nothing at all
  // almost every time. The search is the evidence that the refusal path runs.
  const p = validate(EXAMPLES.attractor);
  for (const seed of [1, 7, 99]) {
    const s = solve(p, seed).state;
    assert.equal(s.verdict, 'STRANGE', `seed ${seed} drew a ${s.verdict}`);
    const refused = Object.values(s.refused).reduce((x, y) => x + y, 0);
    assert.ok(refused > 0,
      `seed ${seed} accepted its first candidate, so nothing exercised the refusal`);
    assert.ok(s.refused.UNBOUNDED > 0 && s.refused['FIXED POINT'] > 0,
      `seed ${seed} never saw the two commonest verdicts: ${JSON.stringify(s.refused)}`);
    assert.ok(s.lyapunov > 0, `a strange orbit separates, and this one gave ${s.lyapunov}`);
  }

  // EVERY VALUE THE KNOB CAN TAKE must still be strange, not only its three
  // pins. The knob is notched for exactly this reason: a finite set can be
  // checked exhaustively and an interval cannot.
  const d = p.params.twist;
  for (let i = 0; i <= 10; i++) {
    const v = d.min + (d.max - d.min) * (i / 10);
    const r = solve(p, 7, { twist: v });
    assert.equal(r.stages.error, null,
      `twist ${v.toFixed(3)} threw: ${r.stages.error && r.stages.error.message}`);
    assert.equal(r.state.verdict, 'STRANGE');
  }
});

test('the attractor keeps its densest folds apart when highlights is raised, and moves nothing at 0', () => {
  // The logarithm clips at a high percentile, so every cell above it prints as
  // the one top tone. The tone curve whitens at the peak instead.
  const p = validate(EXAMPLES.attractor);
  const topTones = (s) => {
    const seen = new Set();
    for (let i = 0; i < s.runs.length; i += 4) {
      const row = s.runs[i + 1] * 792 + s.runs[i];       // 792 cells a row: 900 less two margins
      for (let k = 0; k < s.runs[i + 2]; k++) if (s.cells[row + k] >= s.ink.full) seen.add(s.runs[i + 3]);
    }
    return seen.size;
  };
  const log = solve(p, 7, { tones: 20 }).state;
  const curve = solve(p, 7, { tones: 20, highlights: 1 }).state;
  assert.equal(topTones(log), 1, 'the logarithm was expected to clip its densest cells to one tone');
  assert.ok(topTones(curve) > 1, 'at highlights 1 the densest cells still share one tone');
  assert.deepEqual(solve(p, 7, { highlights: 0 }).state.runs, solve(p, 7).state.runs);
});

test('an undeclared parameter is refused by name', () => {
  const e = grab(() => solve(validate(EXAMPLES.contours), 1, { nope: 1 }));
  assert.match(e.message, /unknown param: nope/);
  const e2 = grab(() => solve(validate(EXAMPLES.contours), 1, { wells: 99 }));
  assert.match(e2.message, /params\.wells must be a finite number in \[1, 6\]/);
});

test('every build stage is declared and every declared stage runs', () => {
  for (const n of NAMES) {
    const p = validate(EXAMPLES[n]);
    const s = solve(p, p.seed);
    assert.equal(s.stages.error, null, `${n}: ${JSON.stringify(s.stages.error)}`);
    assert.equal(s.stages.ms.length, p.build.length, n);
    assert.equal(s.stages.of, p.build.length, n);
    assert.ok(p.build.length >= 1, `${n} does all its work in draw, and nothing is reportable`);
  }
});

// ---------------------------------------------------------------------------
// N4 -- nothing in the core may be reachable from one kind of art only
// ---------------------------------------------------------------------------

test('every core module is reached by at least one example, and none by only one', () => {
  const root = path.join(__dirname, '..');
  const core = fs.readdirSync(path.join(root, 'core')).filter((f) => f.endsWith('.js'));
  const reach = Object.fromEntries(core.map((f) => [f, []]));

  for (const n of NAMES) {
    const src = fs.readFileSync(path.join(root, 'examples', `${n}.js`), 'utf8');
    // Follow one hop: an example that reaches core through a local helper still
    // reaches it.
    const local = [...src.matchAll(/require\('\.\/([\w-]+\.js)'\)/g)].map((m) => m[1]);
    const seen = new Set();
    for (const file of [`${n}.js`, ...local]) {
      const s = fs.readFileSync(path.join(root, 'examples', file), 'utf8');
      for (const m of s.matchAll(/require\('\.\.\/core\/([\w-]+\.js)'\)/g)) seen.add(m[1]);
    }
    for (const f of seen) reach[f].push(n);
  }

  // DERIVED, not listed. This used to name one module by hand, so the rule it
  // was written to enforce -- move a module into core when a second piece needs
  // it -- had no teeth for any module added afterwards.
  //
  // A core module is example-facing if any example imports it. Those must be
  // reached by at least TWO, or they are a preset wearing a core module's
  // clothes. The contract, the renderer and the surface are reached through the
  // harness rather than by an import, because a piece does not require its own
  // contract; they are reported rather than counted.
  const facing = core.filter((f) => reach[f].length > 0);
  assert.ok(facing.length >= 3, `only ${facing.length} core module(s) are reached by any example`);

  for (const f of facing) {
    assert.ok(reach[f].length >= 2,
      `core/${f} is reached by exactly one example (${reach[f].join(', ')}). `
      + 'A core module reached by one kind of art is a preset wearing a core '
      + "module's clothes -- either a second piece needs it, or it belongs beside "
      + 'the one piece that does.');
  }

  // Published, so the numbers are visible on every run rather than assumed.
  const report = core.map((f) => `${f}: ${reach[f].length ? reach[f].join(' ') : '(via the harness)'}`);
  assert.ok(report.length, report.join(' | '));
});

// ---------------------------------------------------------------------------
// What each example was put in the set to prove
// ---------------------------------------------------------------------------

test('drift: THE LINE ARRIVES -- a pen travels, it does not fade up', () => {
  // The difference is most of what makes a drawing read as drawn, and no
  // general check catches it, so the piece that depends on it carries the test.
  //
  // A dab already laid must be UNCHANGED at a later playhead, colour and alpha
  // included. `globalAlpha = progress` would change every one of them; a
  // fade-in would leave the count flat. Only a moving pen grows the count while
  // leaving the marks behind it alone.
  const p = validate(EXAMPLES.drift);
  const strokes = solve(p, p.seed).state.strokes.length;

  const early = record(EXAMPLES.drift, undefined, 0.35);
  const late = record(EXAMPLES.drift, undefined, 0.85);

  assert.ok(late.arcs.length > early.arcs.length * 1.2,
    `${early.arcs.length} dabs at t=0.35 and ${late.arcs.length} at t=0.85`);

  const there = new Set(late.arcs);
  const missing = early.arcs.filter((a) => !there.has(a));
  // Exactly one dab per stroke is allowed to move: the tip, which is the pen.
  assert.ok(missing.length <= strokes,
    `${missing.length} earlier dabs changed, and only ${strokes} tips may. e.g. ${missing[0]}`);
});

test('drift: the five causes are addressed separately', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'examples', 'drift.js'), 'utf8');
  const entities = new Set([...src.matchAll(/R\('([a-z]+)',/g)].map((m) => m[1]));
  assert.ok(entities.size >= 5,
    `only ${entities.size} addresses (${[...entities].join(', ')}). One noise family at all `
    + 'five scales produces recognisable algorithmic self-similarity.');
});

test('drift: every stroke is finished on the last frame', () => {
  // The last frame is the finished picture. A late stroke whose window runs past
  // the end of the film stops short there, its tip still showing. Drawn at a
  // moment past the end, when every window has closed, the same state must look
  // exactly like the last frame.
  const p = validate(EXAMPLES.drift);
  const heads = playheads(p);
  // Digests compared as booleans: a failed equality would print both frames.
  const drawn = (state, t) => { const g = new Recorder(); p.draw(g, state, t); return g.digest; };
  // The declared seed and four more, each with strokes arriving on the last frame.
  for (const seed of [p.seed, 5, 9, 11, 14]) {
    const { state } = solve(p, seed);
    const last = drawn(state, heads[heads.length - 1]);
    assert.ok(last === drawn(state, 2), `seed ${seed}: a stroke is unfinished on the last frame`);
    assert.ok(last !== drawn(state, heads[heads.length - 2]),
      `seed ${seed}: no stroke arrives on the last frame, so none here could arrive late`);
  }
});

test("drift: a stroke's body reaches its tip on every frame", () => {
  // The tip is the pen, and it must sit on the stroke it is drawing. A taper
  // that reaches nothing before the path ends leaves the tip travelling over
  // points no dab will ever cover. On every frame, each point a stroke has
  // passed, from its second to the pen's, carries a dab, and on the last frame
  // the finished end stays a fraction of the stroke's widest dab.
  const p = validate(EXAMPLES.drift);
  const heads = playheads(p);
  for (const seed of [p.seed, 5, 11]) {
    const solved = solve(p, seed);
    const { strokes } = solved.state;
    const where = new Map();
    strokes.forEach((st, s) => st.pts.forEach(([x, y], k) => where.set(`${x},${y}`, [s, k])));
    heads.forEach((t, frame) => {
      // The path points each stroke dabs on this frame, with their widest radius.
      const laid = strokes.map(() => new Map());
      drawFrame({
        fillRect() {}, beginPath() {}, fill() {},
        arc(x, y, r) {
          const at = where.get(`${x},${y}`);
          if (at) laid[at[0]].set(at[1], Math.max(r, laid[at[0]].get(at[1]) || 0));
        },
      }, p, solved, t);
      laid.forEach((dabs, s) => {
        const pen = Math.max(-1, ...dabs.keys());
        for (let k = 1; k <= pen; k++) {
          assert.ok(dabs.has(k), `seed ${seed}, frame ${frame}: stroke ${strokes[s].i} has no body at point ${k} of ${pen}`);
        }
        // A path the bounds cut short leaves the picture before it can taper.
        if (frame === heads.length - 1 && strokes[s].pts.length >= 40) {
          assert.ok(dabs.get(pen) < Math.max(...dabs.values()) / 3,
            `seed ${seed}: stroke ${strokes[s].i} ends without a taper`);
        }
      });
    });
  }
});

/**
 * A Recorder on the shared stand-in canvas, which core/layer.js treats as a
 * raster surface: fakeCanvas paints and reads back its pixels, so layer.js
 * judges a layer's opacity and copies its region as it would on a browser
 * canvas, and the Recorder keeps the marks. A copy of a region carries the
 * marks the canvas showed since it was last cleared, and putting the copy back
 * records them again, so a frame whose layer was copied can be compared, mark
 * for mark, with the frame drawn directly.
 */
class MarkRecorder extends Recorder {
  constructor() {
    super();
    Object.assign(this, { cleared: 0, held: [], copies: 0 });
  }

  clearRect(x, y, w, h) {
    super.clearRect(x, y, w, h);
    this.cleared = this.ops.length;
  }

  /** What the canvas shows: every mark since it was last cleared, in device units. */
  picture() {
    return this.ops.slice(this.cleared).filter((o) => /^(?:[AEMLCQTR]-?[\d.]|RR|FR|SR|PX|fill:|stroke:|clip)/.test(o));
  }

  drawImage(src, ...args) {
    if (args.length === 8) { this.held = src.getContext('2d').picture(); return; }
    assert.deepEqual(args, [0, 0], 'a whole-frame layer lands at the origin');
    this.copies++;
    this.ops.push(...src.getContext('2d').held);
  }
}

function rasterCanvas(width, height) {
  return fakeCanvas({ width, height, ownerDocument: { createElement: () => rasterCanvas(0, 0) } }, () => new MarkRecorder());
}

test('layers: a frame whose static layer was copied holds the marks drawing it would', () => {
  // drift and readout keep their paper and ground as one static layer. On a raster
  // surface it is copied from the layer's second frame on, and every copied frame
  // must hold exactly the marks of drawing it. A layer whose paint read the
  // playhead would freeze on the copied frame and fail here.
  for (const name of ['drift', 'readout']) {
    const p = validate(EXAMPLES[name]);
    const heads = playheads(p);
    const solved = solve(p, p.seed);
    for (const scale of [1, 2]) {
      const [w, h] = [p.size.w * scale, p.size.h * scale];
      const kept = rasterCanvas(w, h).getContext('2d');
      const picks = [0, 1, 2, Math.floor(heads.length / 2), heads.length - 1];
      for (const f of picks) {
        const fresh = rasterCanvas(w, h).getContext('2d');
        for (const g of [kept, fresh]) {
          g.clearRect(0, 0, w, h);
          drawFrame(g, p, solved, heads[f], { scale });
        }
        assert.ok(kept.picture().join('|') === fresh.picture().join('|'), `${name} ${scale}x frame ${f}: the copied frame differs from drawing it`);
      }
      assert.equal(kept.copies, picks.length - 2, `${name} ${scale}x: the layer is copied from its third frame on`);
    }
  }
  // A vector document keeps the layer as paths.
  for (const t of [0, 0.5, 1]) assert.doesNotMatch(renderVector(EXAMPLES.readout, { t }).svg, /<image/);
});

test('specimen: every run of every glyph survives being drawn', () => {
  // THE CROSSBAR. A curvature-based resampler dropped a two-point straight run,
  // the T lost its crossbar and the E lost two of three bars, and the page read
  // as a broken font rather than as a caller error. Nothing threw.
  const two = Object.keys(font.GLYPHS).filter((c) => font.glyph(c).some((run) => run.length === 2));
  assert.ok(two.length >= 8, `only ${two.length} glyphs contain a two-point run`);

  for (const ch of ['T', 'E', 'H', 'I', 'A', '-']) {
    const g = new VectorSurface({ w: 200, h: 100 });
    font.text(g, ch, 10, 10, 60);
    assert.equal(g.markCount, font.glyph(ch).length, `${ch} lost a run`);
  }

  const word = 'THE QUICK BROWN FOX';
  const g = new VectorSurface({ w: 2000, h: 200 });
  font.text(g, word, 10, 10, 40);
  assert.equal(g.markCount, font.runCount(word), 'a whole line lost a run');
});

test('specimen: an unknown character is a gap, never a substituted glyph', () => {
  assert.deepEqual(font.glyph('§'), [], 'a character the font lacks draws nothing');
  assert.deepEqual(font.glyph(' '), [], 'and a space is a space');
  assert.ok(font.glyph('a').length > 0 && JSON.stringify(font.glyph('a')) !== JSON.stringify(font.glyph('A')), 'lower case has forms of its own');
  const drawn = [];
  const text = font.text;
  font.text = (g, str, ...rest) => { drawn.push(str); return text(g, str, ...rest); };
  try { const p = validate(EXAMPLES.specimen); p.draw(new VectorSurface(p.size), solve(p, p.seed).state); } finally { font.text = text; }
  const shown = new Set(drawn.join(''));
  const absent = [...'abcdefghijklmnopqrstuvwxyzáéíóúüñÁÉÍÓÚÜÑ¿¡'].filter((ch) => !shown.has(ch) || !font.glyph(ch).length);
  assert.deepEqual(absent, [], 'the specimen shows lower case and the Spanish set');
});

test('specimen: no line of text overlaps another', () => {
  // TWO LINES AT ONE PLACE. The measured panel's last fact ran into the caption
  // under TEH, and a glance read it as one smudged line. Each text call is
  // boxed by its glyphs' real extents, the comma's descender included.
  const p = validate(EXAMPLES.specimen);
  assert.equal(p.boxes, undefined, 'specimen declares boxes; check each of them too');
  const draw = font.text;
  for (let sample = p.params.sample.min; sample <= p.params.sample.max; sample++) {
    const boxes = [];
    font.text = (g, str, x, y, size) => {
      const ys = [...str].flatMap((ch) => font.glyph(ch).flat().map((q) => q[1]));
      const k = size / 7;
      if (ys.length) boxes.push({ str, x0: x, x1: x + font.width(str, size), y0: y + Math.min(...ys) * k, y1: y + Math.max(...ys) * k });
      return draw(g, str, x, y, size);
    };
    try {
      p.draw(new VectorSurface(p.size), solve(p, p.seed, { sample }).state);
    } finally {
      font.text = draw;
    }
    assert.ok(boxes.length > 10, `sample ${sample}: only ${boxes.length} lines of text were drawn`);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i], boxes[j]];
        const hit = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
        assert.ok(!hit, `sample ${sample}: "${a.str}" (y ${a.y0.toFixed(1)}-${a.y1.toFixed(1)}) overlaps "${b.str}" (y ${b.y0.toFixed(1)}-${b.y1.toFixed(1)})`);
      }
    }
  }
});

test('readout: the DATA is not seeded, and the presentation is', () => {
  // The example exists to prove the seed is not required to be the only input.
  const p = validate(EXAMPLES.readout);
  const a = solve(p, 1).state;
  const b = solve(p, 99999).state;

  assert.deepEqual(a.cells.map((c) => c.digit), b.cells.map((c) => c.digit),
    'a re-roll changed the data, which would make the piece say something else');
  assert.equal(a.cells.map((c) => c.digit).join('').slice(0, 12), '141592653589', 'and the data is what it claims');

  assert.notDeepEqual(a.cells.map((c) => c.jx), b.cells.map((c) => c.jx), 'the presentation is seeded');
  assert.notEqual(a.accent, b.accent);
});

test('readout: the soundtrack reads the data, and the seed only chooses its voice', async () => {
  const { renderSound } = require('../core/render.js');
  const { fakeAudio } = require('./fake-media.js');
  const p = validate(EXAMPLES.readout);
  const listen = async (seed, params) => {
    const audio = fakeAudio();
    await renderSound(p, solve(p, seed, params), { OfflineAudioContext: audio.Context });
    const notes = audio.record.oscillators.slice().sort((a, b) => a.at - b.at || a.frequency.value - b.frequency.value);
    return { at: notes.map((o) => o.at), hz: notes.map((o) => o.frequency.value), voice: notes.map((o) => o.type).join() };
  };
  // Seeds 1 and 99999 choose different accents, so different voices.
  const a = await listen(1);
  const b = await listen(99999);
  assert.ok(a.hz.length >= 96, 'every digit is heard');
  assert.deepEqual(a.hz, b.hz, 'a re-roll changed the melody, which would make the piece say something else');
  assert.deepEqual(a.at, b.at, 'or when it says it');
  assert.notEqual(a.voice, b.voice, 'the voice is presentation, so the seed moves it');

  // Every note starts on a drawn frame, and the scan's lead moves them all.
  const hz = p.time.hz;
  assert.ok(a.at.every((s) => Math.abs(s * hz - Math.round(s * hz)) < 1e-9), 'notes sit on the frame grid');
  const late = await listen(1, { lead: p.params.lead.max });
  assert.notDeepEqual(late.at, a.at, 'a longer lead reaches each cell later');
});

test('readout: the reading keeps its pace, then rests on the finished reading', () => {
  // Two shots on whole frames: six seconds of reading, then a second of rest.
  // The reading's own last frame is the finished reading and the rest holds
  // it, so the result stays on screen long enough to be read.
  const p = validate(EXAMPLES.readout);
  const heads = playheads(p);
  assert.equal(heads.length, 168, 'seven seconds at 24 Hz');
  const s = solve(p, p.seed).state;
  const slots = s.cells.reduce((sum, c) => sum + c.digit, 0);
  const at = (i) => record(EXAMPLES.readout, undefined, heads[i]);
  const filled = (g) => g.ops.filter((o) => o.startsWith('fill:')).length;
  const scanning = (g) => g.ops.includes(`stroke:${s.accent}:2`);

  const before = at(142);
  assert.ok(scanning(before) && filled(before) < slots, 'one frame before the end of the reading, the scan is still reading');
  const done = at(143);
  assert.equal(filled(done), slots, 'the reading ends on its 144th frame, with every slot filled');
  assert.equal(scanning(done), false, 'and the scan gone');
  for (const i of [144, 155, 167]) assert.equal(at(i).digest, done.digest, `rest frame ${i} holds the finished reading`);
});

test('readout: keeps its shot list in state, where --shots reads it', () => {
  const p = validate(EXAMPLES.readout);
  const film = solve(p, p.seed).state.cues.shots;
  assert.deepEqual(film.map((s) => [s.name, s.start, s.end]), [['read', 0, 144], ['rest', 144, 168]],
    'six seconds of reading and one of rest, cut on whole frames of the 168');
});

test('readout: every digit is heard on the frame that first shows it', async () => {
  // Picture and sound resolve the same shots, so the notes are checked against
  // the drawing itself rather than against a copy of its arithmetic. A cell
  // showing a slot sets one fill colour; each digit sounds as two oscillators,
  // after the row's own low note on its first column.
  const { renderSound } = require('../core/render.js');
  const { fakeAudio } = require('./fake-media.js');
  const p = validate(EXAMPLES.readout);
  const solved = solve(p, p.seed);
  const audio = fakeAudio();
  await renderSound(p, solved, { OfflineAudioContext: audio.Context });
  const osc = audio.record.oscillators;
  const heard = [];
  let i = 0;
  for (const c of solved.state.cells) {
    if (c.col === 0) i++;
    // A zero fills no slot, so it is heard and never shown.
    if (c.digit > 0) heard.push(Math.round(osc[i].at * p.time.hz));
    i += 2;
  }
  assert.equal(i, osc.length, 'every oscillator belongs to a row or a digit');
  const shown = playheads(p).map((t) => record(EXAMPLES.readout, undefined, t, undefined, solved).ops.filter((o) => o.startsWith('fillStyle=')).length - 1);
  assert.ok(shown[0] === 0 && shown[shown.length - 1] > 80, `the cells shown run from ${shown[0]} to ${shown[shown.length - 1]}`);
  for (let f = 0; f < shown.length; f++) {
    assert.equal(heard.filter((h) => h <= f).length, shown[f], `frame ${f}: the cells shown and the digits heard disagree`);
  }
});

test('readout: the reading is heard as one phrase, with its accents standing out', async () => {
  // Each note's envelope rises to its level 6 ms after it starts. The row's low
  // note comes before the digit on a row's first column, as the oscillators do.
  const { renderSound } = require('../core/render.js');
  const { fakeAudio } = require('./fake-media.js');
  const p = validate(EXAMPLES.readout);
  const solved = solve(p, p.seed);
  const audio = fakeAudio();
  await renderSound(p, solved, { OfflineAudioContext: audio.Context });
  const peaks = audio.record.nodes.filter((n) => n.kind === 'gain' && n.gain.events.length === 3)
    .map((n) => n.gain.events[1][1]);
  const cells = solved.state.cells;
  const level = [];
  let i = 0;
  for (const c of cells) {
    if (c.col === 0) i++;
    level.push(peaks[i++]);
  }
  assert.equal(i, peaks.length, 'every envelope belongs to a row or a digit');
  const mean = (row) => {
    const own = cells.filter((c) => c.row === row).map((c) => level[c.k]);
    return own.reduce((a, b) => a + b, 0) / own.length;
  };
  const [first, , , last] = [0, 1, 2, 3].map(mean);
  const middle = (mean(1) + mean(2)) / 2;
  assert.ok(middle > 1.3 * first && middle > 1.3 * last,
    `the middle rows (${middle.toFixed(3)}) do not swell above the first (${first.toFixed(3)}) and last (${last.toFixed(3)})`);
  const tail = level.slice(-6).reduce((a, b) => a + b, 0) / 6;
  assert.ok(tail < 0.6 * middle, `the last notes (${tail.toFixed(3)}) do not ease away from the middle (${middle.toFixed(3)})`);
  // An accent-coloured digit is louder than a plain neighbour beside it.
  let accents = 0;
  let quiet = 0;
  for (const c of cells) {
    if (c.digit < 7) continue;
    for (const n of [cells[c.k - 1], cells[c.k + 1]]) {
      if (!n || n.digit >= 7) continue;
      accents++;
      if (level[c.k] < 1.25 * level[n.k]) quiet++;
    }
  }
  assert.ok(accents > 20, `only ${accents} accent-beside-plain pairs`);
  assert.equal(quiet, 0, `${quiet} of ${accents} accents are not a quarter louder than the plain digit beside them`);
});

test('readout: the scan line never runs back at the end of the reading', () => {
  // Past the last cell the scan still runs `lead` cells ahead of the fill. A
  // column taken modulo the grid sent it back to the start of the last row on
  // the reading's final frames. Frame by frame it may only move on, right along
  // a row or down to the next, never past the last column, and it ends on the
  // last cell.
  const p = validate(EXAMPLES.readout);
  const heads = playheads(p);
  const d = p.params.lead;
  for (const lead of [d.min, d.value, 4, d.max]) {
    const solved = solve(p, p.seed, { lead });
    const mark = `stroke:${solved.state.accent}:2`;
    // Each scan line is beginPath, moveTo, lineTo and a stroke in the accent:
    // the vertical one gives the column, the horizontal one the row.
    const start = (ops, i) => ops[i - 2].slice(1).split(',').map(Number);
    const seen = [];
    heads.forEach((t, frame) => {
      const g = new Recorder();
      drawFrame(g, p, solved, t);
      const i = g.ops.indexOf(mark);
      if (i >= 0) seen.push({ frame, x: start(g.ops, i)[0], y: start(g.ops, g.ops.indexOf(mark, i + 1))[1] });
    });
    const lastRow = Math.max(...seen.map((s) => s.y));
    const lastColumn = Math.max(...seen.filter((s) => s.y < lastRow).map((s) => s.x));
    for (let n = 1; n < seen.length; n++) {
      const [a, b] = [seen[n - 1], seen[n]];
      assert.ok(b.y > a.y || (b.y === a.y && b.x >= a.x),
        `lead ${lead}, frame ${b.frame}: the scan ran back from x ${a.x} to x ${b.x}`);
      assert.ok(b.x <= lastColumn, `lead ${lead}, frame ${b.frame}: the scan ran past the last column`);
    }
    const end = seen[seen.length - 1];
    assert.ok(end.y === lastRow && end.x === lastColumn,
      `lead ${lead}: the scan ends on frame ${end.frame} at x ${end.x}, not on the last cell`);
  }
});

/** Settle's edges as the first frame draws them: each is one line between two
 *  node centres, read back as `a-b`, the pair of nodes it joins, sorted. */
function settleEdges(p, solved) {
  const s = solved.state;
  const node = new Map(s.nodes.map((_, i) => [`${s.traj[i * 2]},${s.traj[i * 2 + 1]}`, i]));
  const g = new Recorder();
  const edges = [];
  let line = [];
  g.beginPath = () => { line = []; };
  g.moveTo = (x, y) => { line.push(node.get(`${x},${y}`)); };
  g.lineTo = (x, y) => { line.push(node.get(`${x},${y}`)); };
  g.stroke = () => {
    if (line.length === 2 && line.every((i) => i !== undefined)) edges.push(line.sort((a, b) => a - b).join('-'));
  };
  drawFrame(g, p, solved, 0);
  return edges.sort();
}

test('settle: every sound is an event the picture shows, and the picture moves to its last frame', async () => {
  // What this replaced: a chord of one voice per node held from the first
  // frame, under a graph at rest by 2.3 s whose last 3.5 s barely changed. Now
  // every sound starts on the frame that shows its cause -- an edge yanked
  // taut, two discs meeting, a node plucked -- and the plucks keep the settled
  // graph moving to the end.
  const { renderSound } = require('../core/render.js');
  const { fakeAudio } = require('./fake-media.js');
  const p = validate(EXAMPLES.settle);
  const heads = playheads(p);
  const hz = p.time.hz;
  const LAST = heads.length - 1;
  const ROOT = 98;
  // The piece's own bars: an edge's rest length, the stretch per frame that
  // is heard as a snap, the most snaps on one frame, the frames before an
  // edge can snap again, the solver's substeps per frame and how far off a
  // sound at the rim of the field stands. Its containment ellipse and each
  // event's level are read off the state, so the bars below measure the wall
  // the solver pushes from and the levels the soundtrack plays.
  const [REST, SNAP, BUSY, QUIET, SUB, FAR] = [52, 4, 2, 4, 2, 0.7];
  // Every snap's and knock's level before and from the first pluck, and the
  // softest knock's, over every run inspected.
  const levels = { softest: Infinity, 'snaps before': [], 'snaps after': [], 'knocks before': [], 'knocks after': [] };

  // What the solved state alone shows, for any seed and params: the picture
  // moves from the first pluck to its last frame, every event's cause is on
  // its frame, and the events are phrased. Cheap, so it sweeps seeds and a
  // grid of the parameters.
  const inspect = (solved, who) => {
    const s = solved.state;
    const N = s.nodes.length;
    const pos = (f, i) => [s.traj[(f * N + i) * 2], s.traj[(f * N + i) * 2 + 1]];
    const apart = (f, i, j) => Math.hypot(pos(f, j)[0] - pos(f, i)[0], pos(f, j)[1] - pos(f, i)[1]);
    // A disc's radius as the piece draws it, from the node's degree and grain.
    const radius = (i) => 2 + 1.35 * s.nodes[i].deg + s.nodes[i].grain;
    const gap = (f, i, j) => apart(f, i, j) - radius(i) - radius(j);
    const step = (f, i) => [pos(f, i)[0] - pos(f - 1, i)[0], pos(f, i)[1] - pos(f - 1, i)[1]];
    const travel = (f, i) => Math.hypot(...step(f, i));
    const moved = (f) => Math.max(...s.nodes.map((_, i) => travel(f, i)));
    const { cx: CX, cy: CY, rx: EX, ry: EY } = s.ellipse;
    const q = (f, i) => Math.hypot((pos(f, i)[0] - CX) / EX, (pos(f, i)[1] - CY) / EY);
    const edges = settleEdges(p, solved).map((e) => e.split('-').map(Number));
    const ev = s.events;
    const plucks = [...s.plucks].sort((a, b) => a.frame - b.frame);
    const first = plucks[0].frame;
    assert.ok(first > 2 * hz && first < LAST - 8, `${who}: the first pluck comes on frame ${first}`);

    // The picture: from the first pluck on it is still moving on every frame,
    // and on the last, which spans one frame of time like every other. The
    // energy trace holds each frame's mean speed a substep, over the nodes
    // and the substeps the frame spans, and each substep moves a node by that
    // speed at most, so a frame's mean displacement over the nodes is at most
    // SUB times its energy; a frame that spanned two frames of time would
    // move the nodes about twice that. Once, the last stored snapshot sat two
    // frames of time after the one before it.
    for (let f = first; f <= LAST; f++) assert.ok(moved(f) >= 0.25, `${who}: frame ${f} moves no node a quarter of a unit`);
    assert.ok(moved(LAST) >= 1, `${who}: the last frame moves no node a whole unit, a held frame`);
    for (let f = 1; f <= LAST; f++) {
      const mean = s.nodes.reduce((sum, _, i) => sum + travel(f, i), 0) / N;
      assert.ok(mean <= SUB * s.energy[f] * (1 + 1e-9), `${who}: frame ${f} moves the nodes ${mean.toFixed(3)} on average, over ${SUB} substeps at ${s.energy[f].toFixed(3)}, so it spans more than one frame of time`);
    }

    // The containment is a safety, not a frame: on the frame before the first
    // pluck, where the collapse has found its arrangement, at most one node
    // rests on the ellipse. With the charge range open to 2600 half the graph
    // rested against it, and the composition was the ellipse's shape.
    const past = s.nodes.filter((_, i) => q(first - 1, i) >= 1).length;
    assert.ok(past <= 1, `${who}: ${past} nodes rest on the containment on the frame before the first pluck`);

    // Each event's cause is on its frame in the picture. An edge is due to
    // snap on a frame when it is past its rest length and its stretch reaches
    // SNAP a frame on that frame and not the frame before, QUIET frames or
    // more since it was last heard; the frame hears the BUSY fastest of them,
    // and all of them when there are fewer. A frame holds one knock at most,
    // and a pluck sets its node going on its own frame.
    assert.deepEqual([...new Set(ev.map((e) => e.kind))].sort(), ['knock', 'pluck', 'snap'], `${who}: the kinds of event`);
    for (const e of ev) assert.ok(Number.isInteger(e.frame) && e.frame >= 1 && e.frame <= LAST, `${who}: an event off the frames at ${e.frame}`);
    const heard = new Map();
    for (let f = 1; f <= LAST; f++) {
      const on = ev.filter((e) => e.frame === f);
      const pull = ([a, b]) => apart(f, a, b) - apart(f - 1, a, b);
      const due = edges.filter(([a, b]) => apart(f, a, b) > REST && pull([a, b]) >= SNAP
        && (f < 2 || apart(f - 1, a, b) - apart(f - 2, a, b) < SNAP) && !(heard.has(`${a}-${b}`) && f - heard.get(`${a}-${b}`) <= QUIET));
      const snaps = on.filter((e) => e.kind === 'snap');
      for (const e of snaps) {
        const key = [...e.nodes].sort((a, b) => a - b).join('-');
        assert.ok(due.some((d) => d.join('-') === key), `${who}: edge ${e.nodes} snaps on frame ${f} without its cause in the picture`);
        assert.equal(e.speed, pull(e.nodes), `${who}: edge ${e.nodes} snaps on frame ${f} at another speed than its stretch`);
        heard.set(key, f);
      }
      assert.equal(snaps.length, Math.min(BUSY, due.length), `${who}: frame ${f} hears ${snaps.length} of the ${due.length} edges due to snap`);
      const slowest = Math.min(...snaps.map((e) => e.speed));
      for (const d of due) {
        if (heard.get(d.join('-')) === f) continue;
        assert.ok(pull(d) <= slowest, `${who}: frame ${f} leaves edge ${d} unheard at ${pull(d).toFixed(2)} and hears one at ${slowest.toFixed(2)}`);
      }
      // Two discs meet on the frame their edges first touch: apart on the frame
      // before, touching or through each other on this one. The frame hears
      // the hardest meeting and no other. Once, a knock a few units before
      // contact passed, because only the discs' closing was checked.
      const knocks = on.filter((e) => e.kind === 'knock');
      const meetings = [];
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          const was = gap(f - 1, i, j);
          const now = gap(f, i, j);
          if (was > 0 && now <= 0) meetings.push({ nodes: [i, j], speed: was - now });
        }
      }
      assert.equal(knocks.length, Math.min(1, meetings.length), `${who}: frame ${f} holds ${knocks.length} knocks for ${meetings.length} discs meeting`);
      for (const e of knocks) {
        assert.ok(gap(f - 1, ...e.nodes) > 0 && gap(f, ...e.nodes) <= 0, `${who}: discs ${e.nodes} knock on frame ${f} with a gap of ${gap(f - 1, ...e.nodes).toFixed(2)} before and ${gap(f, ...e.nodes).toFixed(2)} on it`);
        assert.equal(e.speed, Math.max(...meetings.map((m) => m.speed)), `${who}: frame ${f} hears discs ${e.nodes} closing at ${e.speed.toFixed(2)}, not its hardest meeting`);
      }
      for (const e of on.filter((x) => x.kind === 'pluck')) {
        const [dx, dy] = step(f, e.node);
        const [ex, ey] = step(f - 1, e.node);
        assert.ok(travel(f, e.node) > 3 && Math.hypot(dx - ex, dy - ey) >= 5,
          `${who}: node ${e.node} is plucked on frame ${f} but its motion changes there by ${Math.hypot(dx - ex, dy - ey).toFixed(2)}`);
      }
    }
    assert.deepEqual(ev.filter((e) => e.kind === 'pluck').map((e) => [e.node, e.frame]), plucks.map((k) => [k.node, k.frame]), `${who}: the plucks heard`);
    // Each event is as hard as its motion: a level above 0 and at most 1, and
    // within a kind a faster snap or knock never softer than a slower one.
    // How the levels spread is counted over every run, below.
    for (const e of ev) assert.ok(e.velocity > 0 && e.velocity <= 1, `${who}: a ${e.kind} on frame ${e.frame} at level ${e.velocity}`);
    for (const kind of ['snap', 'knock']) {
      const bySpeed = ev.filter((e) => e.kind === kind).sort((a, b) => a.speed - b.speed);
      bySpeed.forEach((e, k) => {
        if (k > 0) assert.ok(e.velocity >= bySpeed[k - 1].velocity, `${who}: a ${kind} at ${e.speed.toFixed(2)} sounds softer than one at ${bySpeed[k - 1].speed.toFixed(2)}`);
      });
    }
    for (const e of ev) {
      if (e.kind === 'knock') levels.softest = Math.min(levels.softest, e.velocity);
      if (e.kind !== 'pluck') levels[`${e.kind}s ${e.frame >= first ? 'after' : 'before'}`].push(e.velocity);
    }

    // Phrased: a rattle while the graph collapses, thinned to a quiet before
    // the first pluck -- the second before it holds at most an eighth of the
    // opening second's events and fewer than the second from it -- with the
    // first second the busiest and half as busy again as any second from the
    // plucks on; then each pluck and the snaps it sets off, something heard in
    // every second to the end, and more heard in the frames right after a
    // pluck than in those before the next. Measured on seeds 1 to 300 at the
    // corners, midpoints and default of the parameters, 3000 solves, the
    // second before the first pluck held 6 events at the most, none in 2292
    // of them, against 45 or more in the opening second and 4 or more in the
    // second from the first pluck.
    const perSecond = Array.from({ length: Math.ceil(heads.length / hz) }, (_, k) => ev.filter((e) => Math.floor(e.frame / hz) === k).length);
    const between = (a, b) => ev.filter((e) => e.frame >= a && e.frame < b).length;
    const quiet = between(first - hz, first);
    assert.ok(8 * quiet <= between(0, hz), `${who}: ${quiet} events in the second before the first pluck, against ${between(0, hz)} in the first`);
    assert.ok(quiet < between(first, first + hz), `${who}: ${quiet} events in the second before the first pluck, ${between(first, first + hz)} in the second from it`);
    assert.ok(perSecond[0] > Math.max(...perSecond.slice(1)), `${who}: the first second is not the busiest, ${perSecond}`);
    assert.ok(perSecond[0] >= 1.5 * Math.max(...perSecond.slice(Math.floor(first / hz))), `${who}: the opening is not half as busy again as the plucks, ${perSecond}`);
    assert.ok(perSecond.slice(Math.floor(first / hz)).every((c) => c > 0), `${who}: a silent second after the first pluck, events per second ${perSecond}`);
    let loud = 0, tail = 0;
    plucks.forEach((k, n) => {
      const next = n + 1 < plucks.length ? plucks[n + 1].frame : LAST + 1;
      loud += between(k.frame, k.frame + 4);
      tail += between(Math.max(k.frame + 4, next - 4), next);
    });
    assert.ok(loud > tail, `${who}: the four frames from each pluck hold ${loud} events in all, the four before the next ${tail}`);
  };

  const { charge, tension } = p.params;
  const grid = [{}];
  for (const c of [charge.min, (charge.min + charge.max) / 2, charge.max]) {
    for (const t of [tension.min, (tension.min + tension.max) / 2, tension.max]) grid.push({ charge: c, tension: t });
  }
  for (let seed = 1; seed <= 24; seed++) {
    for (const c of grid) inspect(solve(p, seed, c), `seed ${seed} ${JSON.stringify(c)}`);
  }
  // The levels keep their range: the knocks from the first pluck on are not
  // mostly at the softest knock's level, nor the opening rattle's snaps and
  // knocks mostly at full level. Measured on seeds 1 to 300 at the corners,
  // midpoints and default of the parameters, 3000 solves, when one range
  // served both kinds, 4312 of the 6071 knocks from the first pluck sounded
  // at the softest level, and 37209 of the 196980 snaps and 26112 of the
  // 88940 knocks before it at full level.
  const share = (key, at) => levels[key].filter(at).length / levels[key].length;
  const floored = share('knocks after', (v) => v <= levels.softest);
  assert.ok(floored < 0.25, `${(100 * floored).toFixed(0)}% of the knocks from the first pluck sound at the softest knock's level`);
  for (const key of ['snaps before', 'knocks before']) {
    const full = share(key, (v) => v >= 1);
    assert.ok(full < 0.05, `${(100 * full).toFixed(0)}% of the ${key} the first pluck sound at full level`);
  }
  // The plucks' snaps sound softer than the rattle's loudest: over those 3000
  // solves none from the first pluck stretched faster than 26.3 a frame, a
  // level of 0.69, and on this grid the loudest sounded at 0.68.
  const loudest = Math.max(...levels['snaps after']);
  assert.ok(loudest < 0.75, `a snap from the first pluck sounds at level ${loudest.toFixed(2)}, as loud as the opening rattle`);

  const listen = async (seed, params) => {
    const solved = solve(p, seed, params);
    const audio = fakeAudio();
    await renderSound(p, solved, { OfflineAudioContext: audio.Context });
    return { seed, solved, s: solved.state, record: audio.record };
  };
  const runs = [await listen(p.seed), await listen(p.seed, { tension: p.params.tension.max }), await listen(1)];
  // Spearman's rank correlation, ties broken by order.
  const ranks = (xs) => { const r = []; xs.map((x, i) => [x, i]).sort((u, v) => u[0] - v[0]).forEach(([, i], k) => { r[i] = k; }); return r; };
  const spearman = (xs, ys) => {
    const [rx, ry] = [ranks(xs), ranks(ys)];
    const n = xs.length;
    return 1 - (6 * rx.reduce((sum, r, i) => sum + (r - ry[i]) ** 2, 0)) / (n * (n * n - 1));
  };

  const flights = [];
  const knocked = [];
  for (const { seed, solved, s, record } of runs) {
    const who = `seed ${seed} tension ${s.params.tension}`;
    inspect(solved, who);
    const ev = s.events;

    // The sound: nothing but those events. No noise, no voice held from the
    // start, nothing that rings for more than three seconds, and every
    // oscillator starts on an event's frame, every event on its own.
    assert.equal(record.nodes.filter((n) => n.kind === 'bufferSource').length, 0, `${who}: a noise source`);
    const oscs = record.oscillators;
    const startFrames = new Set();
    for (const o of oscs) {
      const f = Math.round(o.at * hz);
      assert.ok(Math.abs(o.at * hz - f) < 1e-9, `${who}: an oscillator starts off the frame grid at ${o.at} s`);
      assert.ok(o.end !== null && o.end - o.at < 3, `${who}: an oscillator from ${o.at} s rings to ${o.end} s, a drone`);
      startFrames.add(f);
    }
    assert.deepEqual([...startFrames].sort((x, y) => x - y), [...new Set(ev.map((e) => e.frame))],
      `${who}: the oscillators start on other frames than the events`);
    // Every pitch is a whole harmonic of the root: the lowest partial started
    // on a frame is one.
    for (const f of startFrames) {
      const low = Math.min(...oscs.filter((o) => Math.round(o.at * hz) === f).map((o) => o.frequency.value));
      assert.ok(Math.abs(low / ROOT - Math.round(low / ROOT)) < 1e-9, `${who}: frame ${f} sounds ${low} Hz, off the harmonics`);
    }

    // Placed where it stands: one panner per event, in order, to the side of
    // the field its cause is on, and the sounds reach both sides.
    const panners = record.nodes.filter((n) => n.kind === 'stereoPanner');
    assert.equal(panners.length, ev.length, `${who}: one panner per event`);
    ev.forEach((e, n) => {
      if (Math.abs(e.x - p.size.w / 2) > 20) {
        assert.equal(Math.sign(panners[n].pan.value), Math.sign(e.x - p.size.w / 2), `${who}: event ${n} at x ${e.x.toFixed(0)} is heard on the other side`);
      }
    });
    const pans = panners.map((n) => n.pan.value);
    assert.ok(Math.min(...pans) < -0.3 && Math.max(...pans) > 0.3, `${who}: the sounds stay in the middle`);

    // As hard as the motion that made it: each event's loudest partial peaks
    // higher the faster its snap, or the farther its plucked node flies on
    // its frame, and the soundtrack's peaks span 20 dB.
    const peak = new Array(ev.length).fill(0);
    for (const g of record.nodes) {
      const [first, rise] = g.kind === 'gain' ? g.gain.events : [];
      if (!(first && rise && first[0] === 'setValueAtTime' && first[1] === 0 && rise[0] === 'linearRampToValueAtTime')) continue;
      let n = g;
      while (n && n.kind !== 'stereoPanner') n = n.to[0];
      peak[panners.indexOf(n)] = Math.max(peak[panners.indexOf(n)], rise[1]);
    }
    assert.ok(peak.every((v) => v > 0), `${who}: an event without a voice`);
    assert.ok(Math.max(...peak) > 10 * Math.min(...peak), `${who}: the envelope peaks the voices ramp to span under 20 dB`);
    const snaps = ev.map((e, n) => [e, n]).filter(([e]) => e.kind === 'snap');
    const rho = spearman(snaps.map(([e]) => e.speed), snaps.map(([, n]) => peak[n]));
    assert.ok(rho > 0.5, `${who}: a snap's level follows its speed only by rank correlation ${rho.toFixed(2)}`);
    // The plucks are few in one run, so theirs are pooled over the runs below,
    // each with its distance taken back out: a voice at the rim of the field
    // is 0.75 * FAR decades quieter, more than the plucks' own range. Once,
    // a pluck sounded as hard as its kick, and a heavier node or one sent
    // along the wall flew slower than a lighter one kicked less hard.
    const { cx, cy, rx, ry } = s.ellipse;
    const near = (e) => 10 ** (-0.75 * FAR * Math.min(1, Math.hypot((e.x - cx) / rx, (e.y - cy) / ry)));
    for (const [e, n] of ev.map((e, n) => [e, n]).filter(([e]) => e.kind === 'pluck')) flights.push([e.speed, peak[n] / near(e)]);
    // The knocks too, pooled the same way. And each voice plays its event's
    // level: with its distance taken back out, every voice of a kind peaks at
    // its level times one gain, within the 5 dB a voice's own variation spans.
    for (const [e, n] of ev.map((e, n) => [e, n]).filter(([e]) => e.kind === 'knock')) knocked.push([e.speed, peak[n] / near(e)]);
    for (const kind of ['snap', 'knock', 'pluck']) {
      const gains = ev.map((e, n) => [e, n]).filter(([e]) => e.kind === kind).map(([e, n]) => peak[n] / near(e) / e.velocity);
      assert.ok(Math.max(...gains) <= 10 ** 0.26 * Math.min(...gains), `${who}: the ${kind}s' voices peak ${(20 * Math.log10(Math.max(...gains) / Math.min(...gains))).toFixed(1)} dB apart at one level`);
    }
  }
  const flew = spearman(flights.map(([speed]) => speed), flights.map(([, level]) => level));
  assert.ok(flights.length >= 16 && flew > 0.5, `a pluck's level follows how far its node flies only by rank correlation ${flew.toFixed(2)} over ${flights.length} plucks`);
  const closed = spearman(knocked.map(([speed]) => speed), knocked.map(([, level]) => level));
  assert.ok(knocked.length >= 30 && closed > 0.5, `a knock's level follows how fast its discs close only by rank correlation ${closed.toFixed(2)} over ${knocked.length} knocks`);

  // The seed moves the events.
  const frames = (run) => run.s.events.map((e) => e.frame).join();
  assert.notEqual(frames(runs[2]), frames(runs[0]), 'another seed sounds the same events');
});

test('a soundtrack of seeded noise renders in the audio fake, and its record reaches every node', async () => {
  // The runtime skill says noise comes from the seed: a buffer filled from
  // rng(seed) and played by a buffer source. A piece that does that, through a
  // delay line with feedback, a convolver and a compressor, has to render in
  // these tests, and the fake's record has to follow every node it made, through
  // a connection to a param as well, to the speakers.
  const { renderSound } = require('../core/render.js');
  const { fakeAudio } = require('./fake-media.js');
  const { rng } = require('../core/rand.js');
  const noise = (ctx, R, seconds, name) => {
    const buffer = ctx.createBuffer(1, Math.round(seconds * ctx.sampleRate), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = R(name, 'sample', i) * 2 - 1;
    return buffer;
  };
  const p = validate({
    name: 'hiss', size: { w: 10, h: 10 }, time: { duration: 2, hz: 12 }, draw() {},
    sound(ctx, s, timeline) {
      const R = rng(s.seed);
      const hiss = ctx.createBufferSource();
      hiss.buffer = noise(ctx, R, 0.5, 'hiss');
      hiss.loop = true;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      const wobble = ctx.createOscillator();
      const depth = ctx.createGain();
      depth.gain.value = 300;
      const echo = ctx.createDelay(1);
      echo.delayTime.setValueAtTime(0.25, 0);
      const back = ctx.createGain();
      back.gain.value = 0.4;
      const room = ctx.createConvolver();
      room.buffer = noise(ctx, R, 0.1, 'room');
      const glue = ctx.createDynamicsCompressor();
      wobble.connect(depth);
      depth.connect(band.frequency);
      hiss.connect(band);
      band.connect(echo);
      echo.connect(back);
      back.connect(echo);
      band.connect(glue);
      echo.connect(room);
      room.connect(glue);
      glue.connect(ctx.destination);
      hiss.start(0);
      hiss.stop(timeline.duration);
      wobble.start(0);
    },
  });
  const listen = async (seed) => {
    const audio = fakeAudio();
    await renderSound(p, solve(p, seed), { OfflineAudioContext: audio.Context });
    return audio.record;
  };
  const a = await listen(3);
  const [hiss, band, wobble, depth, echo, back, room, glue] = a.nodes;
  assert.deepEqual(a.nodes.map((n) => n.kind),
    ['bufferSource', 'biquadFilter', 'oscillator', 'gain', 'delay', 'gain', 'convolver', 'dynamicsCompressor'],
    'every node the soundtrack made, in the order it made them');
  const speakers = a.contexts[0].destination;
  const reaches = (n, seen = new Set()) => {
    if (n === speakers) return true;
    if (seen.has(n)) return false;
    seen.add(n);
    return n.to.some((t) => reaches(t.kind === 'param' ? t.owner : t, seen));
  };
  for (const n of a.nodes) assert.ok(reaches(n), `the ${n.kind} never reaches the speakers`);
  assert.deepEqual(depth.to, [band.frequency], 'a connection to a param names the param');
  assert.ok(echo.to.includes(back) && back.to.includes(echo), 'and a feedback loop is recorded both ways');
  assert.deepEqual([hiss.at, hiss.end, hiss.loop, wobble.at], [0, 2, true, 0], 'sources keep when they play');
  assert.deepEqual([echo.delayTime.events, room.buffer.duration, glue.threshold.value], [[['setValueAtTime', 0.25, 0]], 0.1, -24]);

  // The noise is the seed's: the same seed fills the same samples, another seed others.
  const samples = (record) => Array.from(record.nodes[0].buffer.getChannelData(0));
  assert.ok(samples(a).every((v) => v >= -1 && v <= 1) && new Set(samples(a)).size > 1000, 'the buffer holds noise');
  assert.deepEqual(samples(await listen(3)), samples(a), 'one seed, one noise');
  assert.notDeepEqual(samples(await listen(4)), samples(a), 'another seed, other noise');
});

test('every soundtrack builds the same graph each time it renders one solved state', async () => {
  // A browser can render the same samples twice only from the same graph.
  // Everything on the piece's side must repeat exactly: the nodes, their
  // settings, every scheduled value and every connection.
  const { renderSound } = require('../core/render.js');
  const { fakeAudio } = require('./fake-media.js');
  const graph = (record) => {
    const where = (t) => (t.kind === 'destination' ? 'out'
      : t.kind === 'param' ? `${record.nodes.indexOf(t.owner)}.${Object.keys(t.owner).find((k) => t.owner[k] === t)}`
        : record.nodes.indexOf(t));
    const field = ([k, v]) => [k, k === 'to' ? v.map(where)
      : v && v.kind === 'param' ? { value: v.value, events: v.events }
        : v && typeof v.getChannelData === 'function' ? Array.from({ length: v.numberOfChannels }, (_, c) => Array.from(v.getChannelData(c)))
          : typeof v === 'function' ? 'fn' : v];
    return record.nodes.map((n) => Object.fromEntries(Object.entries(n).map(field)));
  };
  const sounding = NAMES.filter((name) => validate(EXAMPLES[name]).sound);
  assert.ok(sounding.length >= 2, `only ${sounding.join(', ')} declares sound`);
  for (const name of sounding) {
    const p = validate(EXAMPLES[name]);
    const solved = solve(p, p.seed);
    const renders = [];
    for (let k = 0; k < 2; k++) {
      const audio = fakeAudio();
      await renderSound(p, solved, { OfflineAudioContext: audio.Context });
      renders.push(graph(audio.record));
    }
    assert.ok(renders[0].length > 0, `${name} builds a graph`);
    assert.ok(JSON.stringify(renders[1]) === JSON.stringify(renders[0]), `${name}: a second render of one solved state built another graph`);
  }
});

test('no node or param in an example soundtrack takes more than two inputs', async () => {
  // Installed Edge adds up three or more inputs in an order that changes between
  // renders, so the same graph renders other last bits each time; two add up the
  // same either way round. The examples sum their voices two at a time, and one
  // browser renders each of their soundtracks to the same bytes every time.
  const { renderSound } = require('../core/render.js');
  const { fakeAudio } = require('./fake-media.js');
  const sounding = NAMES.filter((name) => validate(EXAMPLES[name]).sound);
  assert.ok(sounding.length >= 3, `only ${sounding.join(', ')} declares sound`);
  for (const name of sounding) {
    const p = validate(EXAMPLES[name]);
    const audio = fakeAudio();
    await renderSound(p, solve(p, p.seed), { OfflineAudioContext: audio.Context });
    const arrive = new Map();
    for (const n of audio.record.nodes) for (const t of n.to) arrive.set(t, (arrive.get(t) || 0) + 1);
    for (const [t, k] of arrive) assert.ok(k <= 2, `${name}: a ${t.kind} takes ${k} inputs`);
  }
});

/** Which stored settle snapshot each drawn frame shows, read back from the node
 *  discs it draws, or -1 where they match none. */
function settleSnapshots(p, solved) {
  const s = solved.state;
  const N = s.nodes.length;
  return playheads(p).map((t) => {
    const g = new Recorder();
    const centres = [];
    const arc = g.arc.bind(g);
    g.arc = (x, y, ...rest) => {
      // A hub's ring repeats its disc's centre.
      const last = centres[centres.length - 1];
      if (!last || last[0] !== x || last[1] !== y) centres.push([x, y]);
      arc(x, y, ...rest);
    };
    drawFrame(g, p, solved, t);
    assert.equal(centres.length, N, 'one disc per node');
    for (let j = 0; j < s.traj.length / (N * 2); j++) {
      if (centres.every(([x, y], i) => x === s.traj[(j * N + i) * 2] && y === s.traj[(j * N + i) * 2 + 1])) return j;
    }
    return -1;
  });
}

test('settle: frame k draws the snapshot stored for frame k, so each is drawn once', () => {
  // The build stores one snapshot per drawn frame and draw reads clock.frame.
  // Looking a playhead up among one snapshot more than there are frames drew
  // snapshot 71 and then 73: the motion jumped two steps halfway through.
  const p = validate(EXAMPLES.settle);
  const heads = playheads(p);
  for (const [seed, params] of [[p.seed, {}], [1, {}], [p.seed, { tension: p.params.tension.min }]]) {
    const solved = solve(p, seed, params);
    const s = solved.state;
    assert.equal(s.traj.length, heads.length * s.nodes.length * 2, 'one snapshot per drawn frame');
    assert.equal(s.energy.length, heads.length, 'and one point of the energy trace');
    assert.deepEqual(settleSnapshots(p, solved), heads.map((_, k) => k),
      `seed ${seed} ${JSON.stringify(params)}: a frame shows another frame's snapshot`);
  }
});

test('settle: the seed moves where the graph starts, never what it connects', () => {
  // The header's promise, and it can fail: at any seed the same edge table and
  // degrees, and a different start, so a different trajectory.
  const p = validate(EXAMPLES.settle);
  const runs = [p.seed, 1, 2, 99999].map((seed) => {
    const solved = solve(p, seed);
    return { seed, s: solved.state, edges: settleEdges(p, solved) };
  });
  const [a] = runs;
  const N = a.s.nodes.length;
  const degrees = a.s.nodes.map((nd) => nd.deg);
  a.s.nodes.forEach((_, i) => assert.equal(a.edges.filter((e) => e.split('-').includes(String(i))).length, degrees[i],
    `node ${i} is drawn with as many edges as its degree`));
  for (const run of runs.slice(1)) {
    assert.deepEqual(run.s.nodes.map((nd) => nd.deg), degrees, `seed ${run.seed} changed a node's degree`);
    assert.deepEqual(run.edges, a.edges, `seed ${run.seed} changed what is connected to what`);
  }
  // Everything else is the seed's: under another seed every node starts
  // somewhere else, and the graph ends in another arrangement.
  const start = (run, i) => [run.s.traj[i * 2], run.s.traj[i * 2 + 1]];
  const end = (run) => Array.from(run.s.traj.slice(run.s.traj.length - N * 2));
  runs.forEach((x, j) => runs.slice(j + 1).forEach((y) => {
    for (let i = 0; i < N; i++) {
      assert.notDeepEqual(start(x, i), start(y, i), `node ${i} starts in one place at seeds ${x.seed} and ${y.seed}`);
    }
    assert.notDeepEqual(end(x), end(y), `seeds ${x.seed} and ${y.seed} end in one arrangement`);
  }));
});

/**
 * Every frame of `cues`, read part by part from the drawing. Each part is drawn
 * in its own top-level save/restore, in the order `state.cues.parts` lists them:
 * its first translate, rotate and scale are its pose, and the last fill colour
 * set inside it is its colour.
 */
function cueFrames(p, solved) {
  return playheads(p).map((t) => {
    const parts = [];
    let depth = 0;
    const top = () => parts[parts.length - 1];
    const on = {
      save() { if (depth++ === 0) parts.push({ at: null, turn: null, scale: null, colour: null }); },
      restore() { depth--; },
      translate(x, y) { if (depth === 1 && !top().at) top().at = [x, y]; },
      rotate(a) { if (depth === 1) top().turn = a; },
      scale(x, y) { if (depth === 1) top().scale = [x, y]; },
    };
    const g = new Proxy({}, {
      get: (_, k) => on[k] || (() => {}),
      set: (_, k, v) => { if (k === 'fillStyle' && depth > 0) top().colour = v; return true; },
    });
    p.draw(g, solved.state, t, clockAt(p, t));
    return parts.map(({ at, turn, scale, colour }) => ({ pose: JSON.stringify([at, turn, scale]), colour }));
  });
}

/** The first frame after each scene boundary on which each part shows its turn. */
function cueTurns(frames, cues) {
  const bounds = cues.shots.slice(1).map((s) => s.start);
  return bounds.map((B, k) => {
    const next = k + 1 < bounds.length ? bounds[k + 1] : frames.length;
    return cues.parts.map((_, i) => {
      let f = B;
      while (f < next && frames[f][i].colour === frames[B - 1][i].colour) f++;
      return f;
    });
  });
}

test('cues: every move starts and arrives on the frames its cue declares', () => {
  // A move is at rest on the frame before it and on its first frame, moving on
  // the next, still moving into its last frame and at rest from there on.
  const p = validate(EXAMPLES.cues);
  const solved = solve(p, p.seed);
  const { cues } = solved.state;
  const frames = cueFrames(p, solved);
  assert.equal(frames[0].length, cues.parts.length, 'one drawn part for each part the cues name');
  assert.ok(new Set(cues.moves.map((m) => m.rate)).size >= 4, 'the moves are timed at several named rates');
  const pose = (f, part) => frames[f][cues.parts.indexOf(part)].pose;
  for (const m of cues.moves) {
    const cue = `${m.part} ${m.prop} ${m.a}-${m.b}`;
    assert.ok(pose(m.a, m.part) === pose(m.a - 1, m.part), `${cue} moved before its first frame`);
    assert.ok(pose(m.a + 1, m.part) !== pose(m.a, m.part), `${cue} did not start on frame ${m.a}`);
    assert.ok(pose(m.b, m.part) !== pose(m.b - 1, m.part), `${cue} arrived before frame ${m.b}`);
    assert.ok(pose(m.b + 1, m.part) === pose(m.b, m.part), `${cue} was still moving after frame ${m.b}`);
  }
});

test('cues: the blink closes on its middle frame, and every bump peaks there', () => {
  // ease.bump rests at both ends of its window and is fully out at the middle,
  // so a bump over an even number of frames peaks on one whole frame. A squash
  // reads as the part's vertical scale and a height as its y: both are least at
  // the peak, and mirror each other either side of it.
  const p = validate(EXAMPLES.cues);
  const solved = solve(p, p.seed);
  const { cues } = solved.state;
  const frames = cueFrames(p, solved);
  assert.ok(cues.bumps.some((b) => b.name === 'blink'), 'there is a blink');
  for (const b of cues.bumps) {
    const cue = `${b.name} ${b.a}-${b.b}`;
    const mid = (b.a + b.b) / 2;
    assert.ok(Number.isInteger(mid), `${cue} has no middle frame`);
    const read = (f) => {
      const [at, , scale] = JSON.parse(frames[f][cues.parts.indexOf(b.part)].pose);
      return b.prop === 'squash' ? scale[1] : at[1];
    };
    assert.ok(read(b.a - 1) === read(b.a) && read(b.b + 1) === read(b.b), `${cue} runs outside its window`);
    for (let f = b.a; f <= b.b; f++) {
      if (f !== mid) assert.ok(read(f) > read(mid), `${cue}: frame ${f} is further out than the middle frame ${mid}`);
      assert.ok(Math.abs(read(f) - read(2 * mid - f)) < 1e-9, `${cue}: frames ${f} and ${2 * mid - f} do not mirror`);
    }
  }
});

test('cues: each scene change starts on its boundary and reaches the parts one by one', () => {
  // A change blends, but it is anchored: nothing turns on the frame before a
  // boundary, the first part turns on the boundary, the parts turn in order,
  // and every turn is over within the blend. At blend 0 it is a hard cut.
  const p = validate(EXAMPLES.cues);
  const d = p.params.blend;
  for (const blend of [d.min, d.value, d.max]) {
    const solved = solve(p, p.seed, { blend });
    const { cues } = solved.state;
    const frames = cueFrames(p, solved);
    const bounds = cues.shots.slice(1).map((s) => s.start);
    const within = Math.max(1, Math.round(blend * p.time.hz));
    for (let f = 1; f < frames.length; f++) {
      if (frames[f].every((q, i) => q.colour === frames[f - 1][i].colour)) continue;
      const B = bounds.filter((b) => b <= f).pop();
      assert.ok(B !== undefined && f < B + within, `blend ${blend}: a part turned on frame ${f}, outside every change`);
    }
    cueTurns(frames, cues).forEach((turns, k) => {
      const B = bounds[k];
      assert.equal(Math.min(...turns), B, `blend ${blend}: the change at frame ${B} first shows on frame ${Math.min(...turns)}`);
      assert.deepEqual(turns, [...turns].sort((a, b) => a - b), `blend ${blend}: the parts at frame ${B} turn out of order`);
      const apart = new Set(turns).size;
      assert.ok(blend === d.min ? apart === 1 : apart > 1,
        `blend ${blend}: the change at frame ${B} turns its parts on ${apart} different frame(s)`);
    });
  }
});

test('cues: each note sounds on the frame that first shows its part turning', async () => {
  // One note per part per change, scheduled from the same cue table the picture
  // reads, so a change and its note cannot land on different frames.
  const { renderSound } = require('../core/render.js');
  const { fakeAudio } = require('./fake-media.js');
  const p = validate(EXAMPLES.cues);
  const d = p.params.blend;
  for (const blend of [d.min, d.value, d.max]) {
    const solved = solve(p, p.seed, { blend });
    const audio = fakeAudio();
    await renderSound(p, solved, { OfflineAudioContext: audio.Context });
    // The changes' notes are the triangles; the motion's voices are sines.
    const heard = audio.record.oscillators.filter((o) => o.type === 'triangle').map((o) => o.at * p.time.hz);
    assert.ok(heard.every((f) => Math.abs(f - Math.round(f)) < 1e-9), `blend ${blend}: a note falls between frames`);
    const shown = cueTurns(cueFrames(p, solved), solved.state.cues).flat();
    const sorted = (a) => a.map(Math.round).sort((x, y) => x - y);
    assert.deepEqual(sorted(heard), sorted(shown), `blend ${blend}: the notes and the frames that show each part turning disagree`);
    // The chords build to the lift and fall away: each change's loudest note differs.
    const peak = (o) => o.to[0].gain.events.find((e) => e[0] === 'linearRampToValueAtTime')[1];
    const chords = solved.state.cues.shots.slice(1).map((sh) => Math.max(...audio.record.oscillators
      .filter((o) => o.type === 'triangle' && Math.round(o.at * p.time.hz) >= sh.start && Math.round(o.at * p.time.hz) < sh.end).map(peak)));
    assert.ok(chords[1] > chords[0] && chords[0] > chords[2], `blend ${blend}: the chords do not build and fall: ${chords.map((c) => c.toFixed(3))}`);
  }
});

test('cues: at every seed the chords build to the lift and fall to rest, each led by its first part', async () => {
  // The seeded spread of each note is narrower than the steps between chords
  // and than the lead's margin, so neither order depends on the seed.
  const { renderSound } = require('../core/render.js');
  const { fakeAudio } = require('./fake-media.js');
  const p = validate(EXAMPLES.cues);
  const peak = (o) => o.to[0].gain.events.find((e) => e[0] === 'linearRampToValueAtTime')[1];
  for (let seed = 0; seed < 40; seed++) {
    const solved = solve(p, seed);
    const audio = fakeAudio();
    await renderSound(p, solved, { OfflineAudioContext: audio.Context });
    const notes = audio.record.oscillators.filter((o) => o.type === 'triangle');
    const chords = solved.state.cues.shots.slice(1).map((sh) => notes.filter((o) => {
      const f = Math.round(o.at * p.time.hz);
      return f >= sh.start && f < sh.end;
    }));
    const loudest = chords.map((c) => Math.max(...c.map(peak)));
    assert.ok(loudest[1] > loudest[0] && loudest[0] > loudest[2], `seed ${seed}: the chords do not build and fall: ${loudest.map((c) => c.toFixed(3))}`);
    chords.forEach((c, k) => {
      const first = c.reduce((a, o) => (o.frequency.value < a.frequency.value ? o : a));
      assert.equal(peak(first), loudest[k], `seed ${seed}: chord ${k} is not led by its first part`);
    });
  }
});

test('cues: the motion sounds on the frames that show it, as hard as its cue, no two hits alike', async () => {
  // The arrive shot is heard: the disc's slide, the bar's landing and the dot's
  // hop each start a voice on the frame the picture shows them, read from the
  // same cue table, a bigger bump harder.
  const { renderSound } = require('../core/render.js');
  const { fakeAudio } = require('./fake-media.js');
  const p = validate(EXAMPLES.cues);
  const solved = solve(p, p.seed);
  const { cues } = solved.state;
  const named = (name) => cues.hits.filter((h) => h.name === name);
  const arrive = cues.shots[0];
  for (const name of ['slide', 'land', 'hop']) {
    assert.ok(named(name).some((h) => h.frame >= arrive.start && h.frame < arrive.end), `nothing sounds the ${name} in the arrive shot`);
  }
  const fall = cues.moves.find((m) => m.part === 'bar' && m.prop === 'h');
  assert.equal(named('land')[0].frame, fall.b, 'the landing is not heard on the frame the bar reaches the floor');
  const hops = cues.bumps.filter((b) => b.name === 'hop');
  assert.deepEqual(named('hop').map((h) => h.frame), hops.map((b) => b.b), 'a hop is not heard on the frame the dot comes down');
  const blink = cues.bumps.find((b) => b.name === 'blink');
  assert.equal(named('blink')[0].frame, (blink.a + blink.b) / 2, 'the blink is not heard on the frame it shuts');
  const [low, high] = named('hop');
  assert.ok(high.velocity > low.velocity, 'the high hop comes down no harder than the low one');
  // A bump's hit is as hard as the bump is large against the largest of its property.
  const full = (prop) => Math.max(...cues.bumps.filter((b) => b.prop === prop).map((b) => Math.abs(b.size)));
  for (const name of ['land', 'hop', 'blink']) {
    const caused = cues.bumps.filter((b) => b.name === name);
    assert.deepEqual(named(name).map((h) => h.velocity), caused.map((b) => 0.25 + 0.75 * (Math.abs(b.size) / full(b.prop))),
      `the ${name} is not as hard as its bump is large`);
  }
  assert.ok(new Set(cues.hits.map((h) => h.velocity)).size >= 4, 'the hits barely vary in how hard they land');
  // The slide starts with its move, the settle is heard on the first frame that
  // draws the disc within half a pixel of rest, and the rock on the first frame
  // at or past flat, before its overshoot peaks.
  const moveOf = (part, prop, start) => cues.moves.find((m) => m.part === part && m.prop === prop && m.a >= start);
  assert.equal(named('slide')[0].frame, moveOf('disc', 'x', arrive.start).a, 'the slide is not heard as the disc starts in');
  const rest = cues.shots[cues.shots.length - 1];
  const frames = cueFrames(p, solved);
  const disc = cues.parts.indexOf('disc');
  const sink = moveOf('disc', 'h', rest.start);
  const y = (f) => JSON.parse(frames[f][disc].pose)[0][1];
  let still = sink.a;
  while (Math.abs(y(still) - y(sink.b)) > 0.5) still++;
  assert.ok(still < sink.b, 'the disc does not look down before its move ends');
  assert.equal(named('settle')[0].frame, still, 'the settle is not heard on the first frame that shows the disc at rest');
  const bar = cues.parts.indexOf('bar');
  let flat = rest.start;
  while (JSON.parse(frames[flat][bar].pose)[1] < Math.PI) flat++;
  assert.equal(named('rock')[0].frame, flat, 'the rock is not heard on the first frame at or past flat');

  const audio = fakeAudio();
  await renderSound(p, solved, { OfflineAudioContext: audio.Context });
  const sines = audio.record.oscillators.filter((o) => o.type === 'sine' && o.frequency.value > 30);
  for (const h of cues.hits) {
    assert.ok(sines.some((o) => o.at === h.frame / p.time.hz), `nothing sounds the ${h.name} on frame ${h.frame}`);
  }
  // The two hops are one voice, but no two strokes are alike.
  const tuned = (h) => sines.find((o) => o.at === h.frame / p.time.hz).detune.value;
  assert.notEqual(tuned(low), tuned(high), 'the two hops sound exactly alike');
  // A hit's velocity reaches its voice: at the piece's seed, the high hop's
  // first partial peaks well above the low one's. `vary` alone can move it
  // about as far at another seed, so the margin holds only at this one.
  const level = (h) => sines.find((o) => o.at === h.frame / p.time.hz && o.frequency.value === sines
    .filter((s) => s.at === o.at).reduce((a, s) => Math.min(a, s.frequency.value), Infinity))
    .to[0].gain.events.find((e) => e[0] === 'linearRampToValueAtTime')[1];
  assert.ok(level(high) > 1.5 * level(low), `the high hop is not heard harder: ${level(high).toFixed(3)} against ${level(low).toFixed(3)}`);
});

test('cues: the planned contacts are the touches, each at the drawn form\'s lowest point', () => {
  // A contact strip crops each touch at its point: the landings, hops and rock
  // on the floor line, the settle on the dot's top, each under its form.
  const p = validate(EXAMPLES.cues);
  const solved = solve(p, p.seed);
  const { cues } = solved.state;
  const frames = cueFrames(p, solved);
  const touches = cues.hits.filter((h) => ['land', 'hop', 'rock', 'settle'].includes(h.name));
  assert.deepEqual(cues.contacts.map((c) => [c.name, c.part, c.frame]), touches.map((h) => [h.name, h.part, h.frame]), 'one contact for each touch, on its hit\'s frame');
  assert.ok(touches.length >= 5 && touches.length < cues.hits.length, 'the slide and the blink are not contacts');
  const dot = solved.state.forms.dot.half[1];
  for (const c of cues.contacts) {
    assert.equal(c.x, JSON.parse(frames[c.frame][cues.parts.indexOf(c.part)].pose)[0][0], `the ${c.name} on frame ${c.frame} is not under its form`);
    const ground = c.name === 'settle' ? 420 - 2 * dot : 420;
    assert.ok(Math.abs(c.y - ground) <= 0.5, `the ${c.name} on frame ${c.frame} touches at y ${c.y}, not ${ground}`);
  }
});

test('cues: the slide sounds one or two frames before the disc shows, still deep under its swell', async () => {
  // The slide starts with the disc's move, off the left edge; its voice swells
  // in linearly, so by the first frame that draws any of the disc (its shadow
  // reaches 4 units past its edge) it is at most an eighth of its peak, 18 dB down.
  const { renderSound } = require('../core/render.js');
  const { fakeAudio } = require('./fake-media.js');
  const { tween, ease } = require('../core/time.js');
  const p = validate(EXAMPLES.cues);
  const shows = (state) => {
    const m = state.cues.moves.find((q) => q.part === 'disc' && q.prop === 'x');
    let f = m.a;
    while (m.from + (m.to - m.from) * tween(m.a, m.b, ease[m.rate])(f) + state.forms.disc.half[0] + 4 <= 0) f++;
    return f;
  };
  for (let seed = 0; seed < 40; seed++) {
    const { state } = solve(p, seed);
    const lead = shows(state) - state.cues.hits.find((h) => h.name === 'slide').frame;
    assert.ok(lead >= 1 && lead <= 2, `seed ${seed}: the slide sounds ${lead} frames before the disc shows`);
  }
  const solved = solve(p, p.seed);
  const slide = solved.state.cues.hits.find((h) => h.name === 'slide');
  const audio = fakeAudio();
  await renderSound(p, solved, { OfflineAudioContext: audio.Context });
  const voice = audio.record.oscillators.find((o) => o.type === 'sine' && o.at === slide.frame / p.time.hz);
  const swell = voice.to[0].gain.events.find((e) => e[0] === 'linearRampToValueAtTime')[2] - voice.at;
  assert.ok((shows(solved.state) - slide.frame) / p.time.hz / swell <= 1 / 8, `the slide's ${swell.toFixed(2)} s swell is past an eighth when the disc shows`);
});

test('the film scaffold keeps its planned contacts on whole frames with their points, for a contact strip', (t) => {
  // Filled, its CONTACTS table becomes s.cues.contacts, which --contacts
  // cues.contacts reads with a point for every crop; a contact with no cause on
  // screen, no point or no second in the film is refused.
  const os = require('node:os');
  const { loadExternal } = require('../tools/piece-input.js');
  const { contactList } = require('../tools/contact-sheet.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-scaffold-contacts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const scaffold = (contacts, i, camera = '[]', elements = "[{ name: 'a', enter: 0.5, exit: 3 }]") => {
    let src = fs.readFileSync(path.join(__dirname, '..', 'skills', 'artifex', 'film-scaffold.cjs'), 'utf8');
    for (const [slot, value] of [['ELEMENTS', elements], ['CONTACTS', contacts], ['CAMERA', camera]]) {
      const re = new RegExp(`^const ${slot} = .*;$`, 'm');
      assert.match(src, re, `the scaffold lost its ${slot} slot`);
      src = src.replace(re, `const ${slot} = ${value};`);
    }
    fs.writeFileSync(path.join(dir, `film-${i}.cjs`), src);
    return validate(loadExternal(`./film-${i}.cjs`, dir).piece);
  };
  const p = scaffold("[{ at: 1.25, cause: 'a', x: 512, y: 600 }, { at: 2, cause: 'a', x: 700, y: 610 }]", 0);
  const solved = solve(p, p.seed);
  assert.equal(solved.stages.error, null);
  assert.deepEqual(solved.state.cues.contacts.map((c) => c.frame), [30, 48]);
  assert.deepEqual(contactList(p, 'cues.contacts'), [{ frame: 30, count: 1, point: { x: 512, y: 600 } }, { frame: 48, count: 1, point: { x: 700, y: 610 } }]);
  // Once the camera moves, the strip crops where the frame shows the touch: the
  // design point through the view on its frame, at its cause's depth.
  const moving = "[{ at: 1, x: 640, y: 360, zoom: 1 }, { at: 2.5, x: 820, y: 330, zoom: 1.6 }]";
  const filmed = scaffold("[{ at: 2.5, cause: 'a', x: 900, y: 400 }, { at: 2.5, cause: 'far', x: 900, y: 400 }]", 9, moving,
    "[{ name: 'a', enter: 0.5, exit: 3 }, { name: 'far', enter: 0, exit: 3, depth: 0.5 }]");
  assert.deepEqual(contactList(filmed, 'cues.contacts'), [{ frame: 60, count: 2, point: { x: 768, y: 472 } }]);
  const [near, far] = solve(filmed, filmed.seed).state.cues.contacts;
  assert.deepEqual([near.x, near.y, near.design], [768, 472, [900, 400]]);
  assert.deepEqual([far.x, far.y], [640 + 1.6 * (900 - 730), 360 + 1.6 * (400 - 345)], 'a cause at depth 0.5 travels half the camera\'s way');
  for (const [i, [bad, message]] of [
    ["[{ at: 3.5, cause: 'a', x: 1, y: 1 }]", /the contact at 3.5 s has no cause on screen: a/],
    ["[{ at: 1, cause: 'a', x: 1 }]", /the contact at 1 s needs a second within the film and a design point x, y/],
    ["[{ at: 4, cause: 'a', x: 1, y: 1 }]", /the contact at 4 s needs a second within the film/],
  ].entries()) {
    assert.match(solve(scaffold(bad, i + 1)).stages.error.message, message);
  }
});

test("the film scaffold's TEMPO scales one shot's cues from its start and shifts every later cue by the change in its length", async (t) => {
  // Shots a, b and c of 2 s each at 24 fps: b starts on frame 48. A factor k on
  // b leaves a's cues alone, moves a cue s seconds into b to 2 + k s, and moves
  // every cue in c by 2 (k - 1) s.
  const os = require('node:os');
  const { loadExternal } = require('../tools/piece-input.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-scaffold-tempo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fill = {
    SHOTS: "[['a', 2], ['b', 2], ['c', 2]]",
    ELEMENTS: "[{ name: 'x', enter: 0, exit: DUR, keys: { arm: [[12, 0], [60, 1], [132, 0]] } }, { name: 'y', enter: 2.3, exit: 3.5 }]",
    BEATS: "[{ at: 1, intensity: 0.2, element: 'x', changes: 'shown' }, { at: 3, intensity: 1, element: 'y', changes: 'turns' }, { at: 5, intensity: 0.4, element: 'x', changes: 'rests' }]",
    CAMERA: "[{ at: 2.5, x: 640, y: 360, zoom: 1 }, { at: 3.5, x: 700, y: 360, zoom: 1.2 }]",
    // The voice leads y's entry by 0.4 s, a lead that must stretch with b. The
    // second ambience keeps the default fade of 1 s, which a shortened length
    // under 2 s cannot hold twice, so b under 1 must shorten its fade too.
    SOUNDS: "[{ at: 1.9, cause: 'y', lead: 0.4, voice: { pitch: 220 } }, { at: 2, cause: 'b', ambience: { length: 2, fade: 0.5 } }, { at: 2, cause: 'b', ambience: { length: 2, level: 0.02 } }]",
    CONTACTS: "[{ at: 3.2, cause: 'y', x: 600, y: 400 }]",
  };
  let n = 0;
  const scaffold = (tempo, slots = fill) => {
    let src = fs.readFileSync(path.join(__dirname, '..', 'skills', 'artifex', 'film-scaffold.cjs'), 'utf8');
    for (const [slot, value] of Object.entries({ ...slots, TEMPO: tempo })) {
      const re = new RegExp(`^const ${slot} = .*;$`, 'm');
      assert.match(src, re, `the scaffold lost its ${slot} slot`);
      src = src.replace(re, `const ${slot} = ${value};`);
    }
    fs.writeFileSync(path.join(dir, `film-${++n}.cjs`), src);
    return validate(loadExternal(`./film-${n}.cjs`, dir).piece);
  };
  const { renderSound } = require('../core/render.js');
  const { fakeAudio } = require('./fake-media.js');
  const cues = async (tempo) => {
    const p = scaffold(tempo);
    const solved = solve(p, p.seed);
    assert.equal(solved.stages.error, null, `TEMPO ${tempo}`);
    // The retimed sounds must still render: core refuses an ambience shorter than twice its fade.
    await renderSound(p, solved, { OfflineAudioContext: fakeAudio().Context });
    const c = solved.state.cues;
    return {
      duration: p.time.duration,
      shots: c.shots.map((s) => [s.start, s.end]),
      elements: c.elements.map((e) => [e.enter, e.exit]),
      keys: c.elements[0].keys.arm.map(([f]) => f),
      beats: c.beats.map((b) => b.frame),
      camera: c.camera.map((k) => k.frame),
      sounds: c.sounds.map((s) => s.frame),
      ambience: c.sounds.slice(1).map((s) => [s.ambience.length, s.ambience.fade]),
      contacts: c.contacts.map((x) => x.frame),
    };
  };
  const plain = {
    duration: 6, shots: [[0, 48], [48, 96], [96, 144]], elements: [[0, 144], [55, 84]], keys: [12, 60, 132],
    beats: [24, 72, 120], camera: [60, 84], sounds: [46, 48, 48], ambience: [[2, 0.5], [2, undefined]], contacts: [77],
  };
  assert.deepEqual(await cues('{}'), plain, 'an empty TEMPO leaves every cue where its table puts it');
  assert.deepEqual(await cues('{ b: 0.75 }'), {
    duration: 5.5, shots: [[0, 48], [48, 84], [84, 132]], elements: [[0, 132], [53, 75]], keys: [12, 57, 120],
    beats: [24, 66, 108], camera: [57, 75], sounds: [46, 48, 48], ambience: [[1.5, 0.5], [1.5, 0.75]], contacts: [70],
  }, 'b at 0.75: its cues close up toward its start, and c\'s move 12 frames earlier; a default fade shortens to half the length');
  assert.deepEqual(await cues('{ b: 1.5 }'), {
    duration: 7, shots: [[0, 48], [48, 120], [120, 168]], elements: [[0, 168], [59, 102]], keys: [12, 66, 156],
    beats: [24, 84, 144], camera: [66, 102], sounds: [46, 48, 48], ambience: [[3, 0.5], [3, undefined]], contacts: [91],
  }, 'b at 1.5: its cues spread from its start, and c\'s move 24 frames later');
  // A scaled boundary on a half frame: s0 to s4 last 7.9375 s once scaled, frame
  // 190.5, which shots() rounds to 191 from its running sum of scaled lengths.
  // The timeline and every cue on that boundary must round to the same frame.
  const halves = '{ s0: 0.5, s1: 0.75, s2: 0.75, s3: 1.25, s4: 1.25 }';
  const five = "['s0', 1], ['s1', 2], ['s2', 3], ['s3', 1.7], ['s4', 1.25]";
  for (const [cut, slots, rows] of [
    ["the film's end", { SHOTS: `[${five}]`, ELEMENTS: "[{ name: 'x', enter: 0, exit: DUR }]" }, [[0, 191]]],
    ['the cut to s5', { SHOTS: `[${five}, ['s5', 1]]`, ELEMENTS: "[{ name: 'x', enter: 0, exit: 8.95 }, { name: 'y', enter: 8.95, exit: DUR }]" }, [[0, 191], [191, 215]]],
  ]) {
    const p = scaffold(halves, slots);
    const solved = solve(p, p.seed);
    assert.equal(solved.stages.error?.message, undefined, `a TEMPO that puts ${cut} on a half frame`);
    const { shots: film, elements } = solved.state.cues;
    assert.equal(film[4].end, 191, `s4 ends on frame 191, the rounded running sum of scaled lengths, at ${cut}`);
    assert.equal(Math.round(p.time.duration * p.time.hz), film[film.length - 1].end, `the timeline holds the shots' own frames, at ${cut}`);
    assert.deepEqual(elements.map((e) => [e.enter, e.exit]), rows, `a row that exits or enters at s4's end, second 8.95 of the tables, lands on ${cut}`);
  }
  // Two camera keys a table frame apart, on frames 62 and 63 as written, land
  // on one frame once b plays at 0.75; a cut takes two keys at one second.
  const camera = (keys) => solve(scaffold('{ b: 0.75 }', { ...fill, CAMERA: keys })).stages.error?.message;
  assert.match(camera("[{ at: 2.6, x: 640, y: 360, zoom: 1 }, { at: 2.625, x: 700, y: 360, zoom: 1.2 }]"),
    /camera keys 0 and 1 land on one frame, got 2\.6 s and 2\.625 s on frame 59: that cuts the framing; move them a frame or more apart on the retimed film, or give both one second to cut on purpose$/);
  // Frame 0 counts no cut, so the message neither says the keys cut nor offers one second; an empty TEMPO retimes nothing.
  const bare = (keys) => solve(scaffold('{}', { ...fill, CAMERA: keys })).stages.error?.message;
  assert.match(bare("[{ at: 0, x: 640, y: 360, zoom: 1 }, { at: 0.01, x: 700, y: 360, zoom: 1.2 }]"),
    /camera keys 0 and 1 land on one frame, got 0 s and 0\.01 s on frame 0: no cut is counted on frame 0, so only one of them shows; move them a frame or more apart$/);
  assert.match(bare("[{ at: 2.58, x: 640, y: 360, zoom: 1 }, { at: 2.6, x: 700, y: 360, zoom: 1.2 }]"),
    /on frame 62: that cuts the framing; move them a frame or more apart, or give both one second to cut on purpose$/);
  assert.equal(camera("[{ at: 2.6, x: 640, y: 360, zoom: 1 }, { at: 2.6, x: 700, y: 360, zoom: 1.2 }]"), undefined, 'two keys at one second still cut the framing');
  for (const [tempo, message] of [
    ['{ z: 0.75 }', /the TEMPO names a shot the film does not have, got "z": name one of a, b, c/],
    ['{ b: 0 }', /the TEMPO for b is not a positive finite number, got 0: give a factor such as 0.75 or 1.3/],
    ['{ b: -1.3 }', /the TEMPO for b is not a positive finite number, got -1.3/],
    ["{ b: '1.3' }", /the TEMPO for b is not a positive finite number, got "1.3"/],
    ['{ b: Infinity }', /the TEMPO for b is not a positive finite number, got Infinity/],
  ]) {
    await t.test(`refuses TEMPO ${tempo}`, () => assert.throws(() => scaffold(tempo), message));
  }
});

test('stride: a planted foot does not slide, one foot is always down, and every bone keeps its length', () => {
  // While a foot bears weight it turns about its heel as it lands and about its
  // toe as it leaves; whichever it turns about stays where it touched the ground.
  const p = validate(EXAMPLES.stride);
  for (const pace of [p.params.pace.min, p.params.pace.value, p.params.pace.max]) {
    const { poses } = solve(p, p.seed, { pace, weight: 1 }).state;
    const ground = Math.max(...poses[0].feet.map((ft) => ft.heel[1]));
    const bone = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const [thigh, shin] = [bone(poses[0].hip, poses[0].feet[0].knee), bone(poses[0].feet[0].knee, poses[0].feet[0].ankle)];
    poses.forEach((q, f) => {
      assert.ok(q.feet.some((ft) => ft.planted), `pace ${pace}: both feet are off the ground on frame ${f}`);
      for (const [j, ft] of q.feet.entries()) {
        assert.ok(Math.abs(bone(q.hip, ft.knee) - thigh) < 1e-9 && Math.abs(bone(ft.knee, ft.ankle) - shin) < 1e-9,
          `pace ${pace}: leg ${j} stretches on frame ${f}`);
        assert.ok(Math.max(ft.heel[1], ft.toe[1]) <= ground + 1e-9, `pace ${pace}: foot ${j} is in the ground on frame ${f}`);
        const was = f > 0 ? poses[f - 1].feet[j] : null;
        if (!ft.planted || !was || !was.planted || was.contact !== ft.contact) continue;
        const pivot = ft.angle <= 0 && was.angle <= 0 ? 'heel' : ft.angle >= 0 && was.angle >= 0 ? 'toe' : null;
        if (!pivot) continue;
        assert.ok(bone(ft[pivot], was[pivot]) < 1e-9 && Math.abs(ft[pivot][1] - ground) < 1e-9,
          `pace ${pace}: foot ${j}'s ${pivot} slides from frame ${f - 1} to ${f}`);
      }
    });
  }
});

test('stride: the camera eases across contacts, and the chest, head, forearms and hands overlap the keyed walk', () => {
  // The camera used to keep each step's own speed and change it on the
  // contact, by 0.56 to 1.44 units a frame; the upper body was keyed with the
  // legs, so nothing lagged or carried on. A nod clamped hard at 0.12 rad
  // then waggled the head between its stops.
  const p = validate(EXAMPLES.stride);
  const ang = (a, b) => Math.atan2(b[0] - a[0], b[1] - a[1]);   // from straight down, forward positive
  const bone = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const runs = [[p.seed, {}], [1, {}], [2, {}], [3, {}], [p.seed, { pace: 10, weight: 1 }], [p.seed, { pace: 16, weight: 0 }]];
  for (const [seed, params] of runs) {
    const run = `seed ${seed}${params.pace ? `, pace ${params.pace}, weight ${params.weight}` : ''}`;
    const { poses, walk } = solve(p, seed, params).state;
    const step = poses.slice(1).map((q, f) => q.cam - poses[f].cam);
    const change = Math.max(...step.slice(1).map((d, f) => Math.abs(d - step[f])));
    assert.ok(change < 0.2, `${run}: the camera changes speed by ${change.toFixed(3)} units a frame from one frame to the next`);
    const off = Math.max(...poses.map((q) => Math.abs(q.hip[0] - q.cam)));
    assert.ok(off < 8, `${run}: the hips stray ${off.toFixed(1)} units from the camera`);

    const lean = poses.map((q) => Math.atan2(q.shoulder[0] - q.hip[0], q.hip[1] - q.shoulder[1]));
    const carry = Math.max(...poses.map((q, f) => Math.abs(lean[f] - q.lean)));
    assert.ok(carry > 0.03 && carry < 0.15, `${run}: the chest carries ${carry.toFixed(3)} rad off its keyed lean`);
    let drag = 0;
    let trail = 0;
    let socket = 0;
    const wrist = { back: 0, on: 0 };
    poses.forEach((q, f) => q.arms.forEach((a, j) => {
      assert.ok(Math.abs(bone(a.socket, a.elbow) - bone(poses[0].arms[0].socket, poses[0].arms[0].elbow)) < 1e-9 &&
        Math.abs(bone(a.elbow, a.hand) - bone(poses[0].arms[0].elbow, poses[0].arms[0].hand)) < 1e-9, `${run}: arm ${j} stretches on frame ${f}`);
      const fore = ang(a.elbow, a.hand);
      assert.ok(fore >= ang(a.socket, a.elbow) - 1e-9, `${run}: elbow ${j} bends backwards on frame ${f}`);
      // The shoulders turn against the hips: each socket leaves the shoulder.
      socket = Math.max(socket, bone(a.socket, q.shoulder));
      // A hand trails its forearm both ways, bending back only a little.
      const flex = ang(a.hand, a.tip) - fore;
      assert.ok(flex > -0.3, `${run}: hand ${j} bends back ${flex.toFixed(3)} rad on frame ${f}`);
      if (flex < -0.01) wrist.back++;
      if (Math.abs(flex) <= 0.01) wrist.on++;
      if (!f) return;
      // Behind the keyed forearm while the arm swings forward, ahead of it back.
      drag += (fore - q.reach[j]) * (q.swing[j] - poses[f - 1].swing[j]);
      trail += Math.abs(fore - q.reach[j]) / (2 * (poses.length - 1));
    }));
    assert.ok(drag < 0 && trail > 0.1, `${run}: the forearms do not drag: ${drag.toFixed(3)}, ${trail.toFixed(3)} rad off their keys`);
    assert.ok(socket > 2, `${run}: the shoulder sockets stay within ${socket.toFixed(2)} units of the shoulder`);
    const arms = 2 * poses.length;
    assert.ok(wrist.back > 0.2 * arms && wrist.on < 0.2 * arms,
      `${run}: of ${arms} hands, ${wrist.back} bend back from their forearms and ${wrist.on} lie along them`);
    // The head nods on after the body lands, furthest a few frames into each
    // step, and settles: well inside its limit, with no sudden change of speed.
    const neck = poses.map((q, f) => Math.atan2(q.head[0] - q.shoulder[0], q.shoulder[1] - q.head[1]) - lean[f]);
    assert.ok(Math.max(...neck) - Math.min(...neck) > 0.03, `${run}: the head holds still on the neck`);
    const nod = Math.max(...neck.map(Math.abs));
    assert.ok(nod < 0.11, `${run}: the head nods ${nod.toFixed(3)} rad`);
    let jerk = 0;
    for (let f = 2; f < neck.length; f++) jerk = Math.max(jerk, Math.abs(neck[f] - 2 * neck[f - 1] + neck[f - 2]));
    assert.ok(jerk < 0.06, `${run}: the nod changes speed by ${jerk.toFixed(3)} rad a frame from one frame to the next`);
    const contacts = walk.contacts.filter((c) => c < poses.length);
    for (let k = 1; k + 1 < contacts.length; k++) {
      let most = contacts[k];
      for (let f = contacts[k]; f < contacts[k + 1]; f++) if (neck[f] > neck[most]) most = f;
      assert.ok(most - contacts[k] >= 2, `${run}: the head nods furthest on frame ${most}, with the contact on ${contacts[k]}`);
    }
  }
});

test('stride: each footfall sounds on the frame that shows its heel landing, and no two land alike', async () => {
  // The gait's contacts are the score: the heel lands on the contact frame,
  // toe up, having been in the air the frame before, and its voice starts then.
  const { renderSound } = require('../core/render.js');
  const { fakeAudio } = require('./fake-media.js');
  const p = validate(EXAMPLES.stride);
  const solved = solve(p, p.seed);
  const { falls, poses, walk } = solved.state;
  const within = walk.contacts.slice(1).filter((c) => c < frameCount(p));
  assert.deepEqual(falls.map((x) => x.frame), within, 'one footfall for each contact in the film after the first');
  for (const fall of falls) {
    const ft = poses[fall.frame].feet[fall.foot];
    assert.ok(ft.planted && ft.angle < 0 && !poses[fall.frame - 1].feet[fall.foot].planted,
      `the heel of foot ${fall.foot} does not land on frame ${fall.frame}`);
    const screen = [ft.heel[0] - poses[fall.frame].cam + 400, ft.heel[1]];
    assert.deepEqual([fall.x, fall.y], screen, `fall on frame ${fall.frame} is not at its heel in the frame`);
  }
  const audio = fakeAudio();
  await renderSound(p, solved, { OfflineAudioContext: audio.Context });
  const starts = new Set(audio.record.oscillators.map((o) => o.at));
  for (const fall of falls) assert.ok(starts.has(fall.frame / p.time.hz), `nothing sounds on frame ${fall.frame}`);
  const weights = falls.map((x) => x.weight);
  assert.equal(new Set(weights).size, falls.length, 'two footfalls land with the same weight');
  assert.ok(Math.max(...weights) - Math.min(...weights) > 0.2, `the footfalls barely vary: ${weights.map((w) => w.toFixed(2)).join(' ')}`);
});

test('stride: a footfall on hard ground is a short low knock under a crunch of grit and a scuff, under the air, dry, and no two alike', async () => {
  // The owner heard the old heels as a loud thud on carpet: a long knock whose
  // first partial stood 25 to 36 dB over the air. Then, with the knock short
  // and the step mostly grit, as a crack of noise starting on the contact and
  // a scuff starting 30 ms before the back toe's lift, the steps still stood
  // in the foreground, as if the camera were on the feet, and each hung in an
  // echo: the heel and the grit were sent to the room, and the crack stood 30
  // dB over the air. The frame shows the whole figure in its land, so the
  // steps are a detail under the air: the knock's first partial at most 3 dB
  // over the air's, even at full weight, the crack's sample peak, a noise
  // crest, at most 20 dB over it and the loudest of the walk at least 6, so
  // the steps stay present, and nothing of a step reaches the room, only the
  // air does.
  const { renderSound } = require('../core/render.js');
  const { fakeAudio } = require('./fake-media.js');
  const p = validate(EXAMPLES.stride);
  const db = (x) => 20 * Math.log10(x);
  const peak = (o) => o.to[0].gain.events.find((e) => e[0] === 'linearRampToValueAtTime')[1];
  const heavy = { pace: 10, weight: 1 };
  for (const [seed, params] of [[p.seed], [1], [2], [3], [9], [3, heavy], [4, heavy]]) {
    const solved = solve(p, seed, params);
    const { falls } = solved.state;
    const audio = fakeAudio();
    await renderSound(p, solved, { OfflineAudioContext: audio.Context });
    const sr = audio.record.contexts[0].sampleRate;
    const air = solved.state.world.air;
    // What reaches the room: every node with a path to the convolver.
    const hall = audio.record.nodes.filter((n) => n.kind === 'convolver');
    assert.equal(hall.length, 1, 'one room');
    const wet = new Set(hall);
    for (let grew = true; grew;) {
      grew = false;
      for (const n of audio.record.nodes) if (!wet.has(n) && n.to.some((t) => wet.has(t))) { wet.add(n); grew = true; }
    }
    const sources = audio.record.nodes.filter((n) => n.kind === 'oscillator' || n.kind === 'bufferSource');
    const heard = sources.filter((n) => wet.has(n));
    // The air is a few gusts of noise at seeded times, none of them a step's grit, and no tone is held.
    const gusts = Math.max(3, Math.round(p.time.duration / 3));
    assert.ok(heard.length === gusts && heard.every((n) => n.kind === 'bufferSource' && !n.grit) && new Set(heard.map((n) => n.at)).size === gusts,
      `seed ${seed}: the room hears ${heard.length} sources at ${heard.map((n) => n.at.toFixed(2))} s, not the air's ${gusts} gusts alone: a step echoes`);
    assert.equal(audio.record.oscillators.filter((o) => wet.has(o)).length, 0, `seed ${seed}: a held tone reaches the room`);
    const grits = audio.record.nodes.filter((n) => n.kind === 'bufferSource' && n.grit).map((n) => {
      const d = n.buffer.getChannelData(0);
      // flips: sign changes per second of sound, weighted by power, so a
      // brighter grit flips faster however many bursts it has.
      let first = Infinity, top = 0, flips = 0, weight = 0;
      for (let i = 0; i < d.length; i++) {
        if (d[i] !== 0) first = Math.min(first, i);
        top = Math.max(top, Math.abs(d[i]));
        const w = d[i] * d[i];
        weight += w;
        if (i && d[i] * d[i - 1] < 0) flips += w;
      }
      return { grit: n.grit, at: n.at, from: n.at + first / sr, top, flips: (flips / weight) * sr };
    });
    const steps = falls.map((fall, i) => {
      const at = fall.frame / p.time.hz;
      const lows = audio.record.oscillators.filter((o) => o.at === at);
      const thump = lows.reduce((a, o) => (o.frequency.value < a.frequency.value ? o : a));
      const crunch = grits.find((g) => g.grit === `crunch ${i}`);
      const scuff = grits.find((g) => g.grit === `scuff ${i}`);
      const decay = thump.to[0].gain.events.find((e) => e[0] === 'exponentialRampToValueAtTime')[2] - at;
      return { at, frame: fall.frame, foot: fall.foot, thump: db(peak(thump) / air), decay, crunch, scuff };
    });
    // The heavy runs read apart from the same seed at the piece's own params.
    const run = `seed ${seed}${params ? `, pace ${params.pace}, weight ${params.weight}` : ''}`;
    const loudest = Math.max(...steps.map((st) => st.thump));
    assert.ok(loudest <= 3, `${run}: a heel's thump stands ${loudest.toFixed(1)} dB over the air, over 3: in the foreground`);
    assert.ok(steps.every((st) => st.decay < 0.12), `${run}: a thump rings ${Math.max(...steps.map((st) => st.decay)).toFixed(2)} s, a thud not a step on hard ground`);
    for (const [i, { at, frame, crunch, scuff }] of steps.entries()) {
      assert.ok(crunch && scuff, `${run}: the fall on frame ${frame} has no ${crunch ? 'scuff' : 'crunch'}`);
      assert.ok(crunch.from >= at && crunch.from < at + 0.01, `${run}: the crunch on frame ${frame} starts ${(1000 * (crunch.from - at)).toFixed(1)} ms off its contact`);
      const off = scuff.at + 0.03 - falls[i].push / p.time.hz;
      assert.ok(Math.abs(off) <= 0.0101, `${run}: the scuff of the fall on frame ${frame} starts ${(1000 * off).toFixed(1)} ms off 30 ms before its lift`);
    }
    const grit = steps.map((st) => db(st.crunch.top / air));
    assert.ok(Math.max(...grit) <= 20, `${run}: a crunch peaks ${Math.max(...grit).toFixed(1)} dB over the air, over 20: in the foreground`);
    assert.ok(Math.max(...grit) >= 6, `${run}: the loudest crunch peaks ${Math.max(...grit).toFixed(1)} dB over the air, under 6: the steps are lost`);
    // Each step its own: crunches 6 dB apart or more over the walk, each
    // scuff at its own moment, and the far foot darker and quieter.
    assert.ok(Math.max(...grit) - Math.min(...grit) > 6, `${run}: the crunches barely vary: ${grit.map((g) => g.toFixed(1)).join(' ')}`);
    const lifts = steps.map((st, i) => st.scuff.at - falls[i].push / p.time.hz);
    assert.equal(new Set(lifts.map((x) => x.toFixed(6))).size, steps.length, `${run}: two scuffs lift at the same moment`);
    const mean = (foot, f) => { const of = steps.filter((st) => st.foot === foot); return of.reduce((a, st) => a + f(st), 0) / of.length; };
    assert.ok(mean(0, (st) => st.crunch.flips) > 1.15 * mean(1, (st) => st.crunch.flips), `${run}: the far foot's crunch is not darker`);
    assert.ok(mean(0, (st) => st.thump) > mean(1, (st) => st.thump), `${run}: the far foot's thump is not quieter`);
  }
});

test('stride: a step on hard ground is a dry crack and a brief rasp whose bands read as noise, so its film replays', async () => {
  // Scuffs of sparse 8 to 14 ms grains held a few narrow tones in a block, so
  // AAC coded them as tones: the seed-2 film failed replay at 5.227 s, the
  // upper edge of a scuff's band kept at 11.4 dB of its level, under 12, and
  // the seed-7 film's scuff bands as tones 24.4 dB from the render, under 25.
  // Dense short swept grains fixed that but read as wet mud, and short unswept
  // ones still as squished slime at each step's end: a decaying sine ping, at
  // any rate or length, is what a drop or a bubble is made of. The owner asked
  // for dry steps on hard ground. So no footstep voice is a sine but the heel's
  // knock, every grit buffer is seeded noise whose bands read as noise, as the
  // replay measures a block: 1024 samples on the film's grid, Hann-windowed,
  // the flatness of each 750 Hz band holding -25 dB of the block or more, in
  // the blocks within 30 dB of the grit's loudest, tail included, at a median
  // of 0.58 or more over a seed's grits and a tenth percentile of 0.26 or
  // more; and no 5 ms frame of a grit holds a pitch, its best normalised
  // autocorrelation over 0.8 to 8 kHz under 0.6 in all but one frame in 50.
  // And the step is dry: the heel's knock does not slide in pitch, a crunch's
  // next 70 ms hold under -8 dB of its first 30, a few ticks and no ring, and
  // a scuff is a rasp of 80 ms at most. And the crack is no click: with its
  // 5 ms rise the first 4 ms of a crack hold under half of its first 30 on
  // average over a seed's cracks (0.31 to 0.38 at seeds 1 to 4 and 9), where
  // a 2 ms rise held 0.60 to 0.66; the owner's reference recording's steps
  // take 5 to 16 ms, 11 in the median, from 20 dB under their peak to it.
  // The rise does not buy replay margin: the AAC film's block holding a
  // crack's onset codes at 24 to 30 dB by how much of the crack it holds,
  // either side of replay's 25 dB floor whatever the rise (lowest over the
  // floor 25.9 dB at 2 ms and 25.7 at 5, seeds 1 to 12 each; 25.2 at 10 ms,
  // seeds 4, 6, 9, 11 and 12), and a block under it passes the noise rules
  // by 9.8 dB or more.
  const { renderSound } = require('../core/render.js');
  const { fakeAudio } = require('./fake-media.js');
  const p = validate(EXAMPLES.stride);
  const B = 1024, rate = 48000;
  const hann = Float64Array.from({ length: B }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / B));
  const power = (x) => {
    const re = Float64Array.from(x), im = new Float64Array(B);
    for (let i = 1, j = 0; i < B; i++) {
      let bit = B >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; }
    }
    for (let len = 2; len <= B; len <<= 1) {
      for (let i = 0; i < B; i += len) {
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2, c = Math.cos((-2 * Math.PI * k) / len), s = Math.sin((-2 * Math.PI * k) / len);
          const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        }
      }
    }
    return Array.from({ length: B / 2 + 1 }, (_, k) => re[k] ** 2 + im[k] ** 2);
  };
  // At pace 10 and weight 1 a plant's rustle can start within 15 ms of where a
  // scuff would, 30 ms before a lift: only the voices' tags tell them apart.
  for (const [n, params] of [[p.seed], [1], [2], [3], [2, { pace: 10, weight: 1 }], [2, { pace: 16 }]]) {
    const seed = params ? `${n} at pace ${params.pace}${params.weight === undefined ? '' : `, weight ${params.weight}`}` : n;
    const solved = solve(p, n, params);
    const contacts = new Set(solved.state.falls.map((f) => f.frame / p.time.hz));
    const audio = fakeAudio();
    await renderSound(p, solved, { OfflineAudioContext: audio.Context, sampleRate: rate, channels: 2 });
    const flat = [], periodic = [], onsets = [];
    for (const o of audio.record.oscillators) {
      if (contacts.has(o.at)) assert.equal(o.detune.events.length, 0, `seed ${seed}: the heel at ${o.at.toFixed(3)} s slides in pitch, a drop into water`);
      else assert.ok(o.at === 0 || o.at === 1.2, `seed ${seed}: a sine at ${o.frequency.value} Hz starts at ${o.at.toFixed(3)} s, neither a heel's knock nor the air`);
    }
    // Each grit buffer is tagged with its voice where it is made: a crunch, a
    // scuff or a plant's rustle. All of them must read as noise.
    const grits = audio.record.nodes.filter((n) => n.kind === 'bufferSource' && n.grit);
    const of = (kind) => grits.filter((n) => String(n.grit).startsWith(`${kind} `));
    const crunches = of('crunch'), scuffs = of('scuff'), rustles = of('rustle');
    assert.equal(crunches.length + scuffs.length + rustles.length, grits.length, `seed ${seed}: a grit buffer is no crunch, scuff or rustle`);
    assert.equal(crunches.length, contacts.size, `seed ${seed}: one crunch for each footfall`);
    assert.equal(scuffs.length, contacts.size, `seed ${seed}: one scuff for each footfall`);
    assert.equal(rustles.length, solved.state.brushes.length, `seed ${seed}: one rustle for each plant a foot touches`);
    for (const n of grits) {
      const off = Math.round(n.at * rate);
      const d = n.buffer.getChannelData(0);
      const pw = Float64Array.from(d, (v) => v * v);
      const within = (from, to) => pw.subarray(Math.round(from * rate), Math.round(to * rate)).reduce((a, v) => a + v, 0);
      if (crunches.includes(n)) {
        const crack = within(0, 0.03), after = within(0.03, 0.1);
        assert.ok(after <= 10 ** -0.8 * crack, `seed ${seed}: the crunch at ${n.at.toFixed(3)} s still holds ${(10 * Math.log10(after / crack)).toFixed(1)} dB of its crack 30 to 100 ms on, a smear, not a dry crack`);
        onsets.push(within(0, 0.004) / crack);
      } else if (scuffs.includes(n)) {
        const total = within(0, n.buffer.duration);
        let sum = 0, first = -1, last = -1;
        pw.forEach((v, i) => { sum += v; if (first < 0 && sum >= 0.005 * total) first = i; if (last < 0 && sum >= 0.995 * total) last = i; });
        assert.ok((last - first) / rate <= 0.08, `seed ${seed}: the scuff at ${n.at.toFixed(3)} s brushes for ${((last - first) / rate).toFixed(3)} s, over 0.08`);
      }
      const blocks = [];
      for (let s = Math.floor(off / B) * B; s < off + n.buffer.length; s += B) {
        blocks.push(Float64Array.from({ length: B }, (_, i) => d[s - off + i] || 0));
      }
      const energy = blocks.map((b) => b.reduce((a, v) => a + v * v, 0));
      const loud = Math.max(...energy);
      blocks.forEach((b, i) => {
        if (energy[i] < 1e-3 * loud) return;
        const shape = power(b.map((v, j) => v * hann[j]));
        const total = shape.reduce((a, v) => a + v, 0);
        for (let band = 0; band < 20; band++) {
          const bins = shape.slice(Math.max(1, 16 * band), 16 * band + 16);
          const sum = bins.reduce((a, v) => a + v, 0);
          if (sum < total * 10 ** -2.5) continue;
          flat.push(Math.exp(bins.reduce((a, v) => a + Math.log(v), 0) / bins.length) / (sum / bins.length));
        }
      });
      // Pitch: the best normalised autocorrelation of each 256-sample frame
      // holding -30 dB of the loudest block or more, at lags of 6 to 60.
      for (let s = 0; s + 256 <= d.length; s += 128) {
        const frame = d.subarray(s, s + 256);
        let e0 = 0;
        for (const v of frame) e0 += v * v;
        if (e0 < 1e-3 * loud / 4) continue;
        let best = 0;
        for (let lag = 6; lag <= 60; lag++) {
          let c = 0, e1 = 0;
          for (let i = lag; i < 256; i++) { c += frame[i] * frame[i - lag]; e1 += frame[i - lag] ** 2; }
          best = Math.max(best, c / Math.sqrt(e0 * e1));
        }
        periodic.push(best);
      }
    }
    flat.sort((a, b) => a - b);
    const tenth = flat[Math.floor(0.1 * (flat.length - 1))], median = flat[Math.floor(0.5 * (flat.length - 1))];
    assert.ok(median >= 0.58 && tenth >= 0.26,
      `seed ${seed}: the grit's ${flat.length} bands are tonal, not noise: flatness median ${median.toFixed(2)}, tenth ${tenth.toFixed(2)}, under 0.58 and 0.26`);
    const tonal = periodic.filter((v) => v >= 0.6).length;
    assert.ok(tonal * 50 <= periodic.length, `seed ${seed}: ${tonal} of the grit's ${periodic.length} frames hold a pitch, pings in the step's tail, not grit`);
    const onset = onsets.reduce((a, v) => a + v, 0) / onsets.length;
    assert.ok(onset < 0.5, `seed ${seed}: the first 4 ms of a crack hold ${(100 * onset).toFixed(0)}% of its first 30 on average, a click, not the 5 to 16 ms rise of a step in the reference recording`);
  }
});

test('stride: the background lives and changes with the seed: birds far off, plants of four kinds, trees on both ridges', () => {
  // The owner found the backdrop still: nothing flew, and every tuft was the
  // same grass in the same few greens.
  const p = validate(EXAMPLES.stride);
  const W = p.size.w;
  const looks = [];
  for (const seed of [p.seed, 1, 2, 3]) {
    const { world, birds, poses } = solve(p, seed).state;
    const { tufts, groves } = world;
    const kinds = new Set(tufts.map((t) => t.kind));
    assert.equal(kinds.size, 4, `seed ${seed}: the plants come in ${[...kinds].join(', ')}`);
    const heights = tufts.map((t) => t.h);
    assert.ok(Math.max(...heights) > 3 * Math.min(...heights), `seed ${seed}: the plants barely vary in height`);
    assert.ok(new Set(tufts.map((t) => t.colour)).size > tufts.length / 2, `seed ${seed}: the plants share a few colours`);
    // In front of the walker, rooted at or below the sole's underside 4 units
    // under the ground line, stalks and shrubs grow right up to it and rise
    // over its feet and shins, painted over them: none is turned to grass or
    // a bloom there. None reaches the lowest a knee goes, a stalk's seed head
    // included, which reaches 5.4 units past its tip (centred 2 past it, 3.4
    // long each way).
    const ground = Math.max(...poses[0].feet.map((ft) => ft.heel[1]));
    const top = (t) => t.y - t.h * (1 + (t.y - ground) / 120) - (t.kind === 'stalk' ? 5.4 : 0);
    const near = tufts.filter((t) => t.y >= ground + 4 && t.y < ground + 20 && (t.kind === 'stalk' || t.kind === 'shrub') && top(t) < ground);
    assert.ok(near.length >= 4, `seed ${seed}: ${near.length} stalks and shrubs rooted within 16 units in front of the walker rise over its feet`);
    const knee = Math.max(...poses.flatMap((q) => q.feet.map((ft) => ft.knee[1])));
    const tall = tufts.find((t) => t.y >= ground + 4 && top(t) <= knee);
    assert.ok(!tall, `seed ${seed}: a ${tall && tall.kind} in front rises to ${tall && (ground - top(tall)).toFixed(1)}, past the knees at ${(ground - knee).toFixed(1)}`);
    for (const name of ['far', 'mid']) assert.ok(groves[name].length >= 4, `seed ${seed}: ${groves[name].length} trees on the ${name} ridge`);

    assert.ok(birds.length >= 4 && birds.length <= 8, `seed ${seed}: ${birds.length} birds`);
    let seen = 0;
    for (const [j, b] of birds.entries()) {
      assert.equal(b.path.length, poses.length, `seed ${seed}: bird ${j} is not placed on every frame`);
      // High in the sky over the far ridge, slow enough to read, wings moving.
      const low = Math.max(...b.path.map((q) => q.y + b.span));
      assert.ok(low < 268, `seed ${seed}: bird ${j} drops to ${low.toFixed(0)}, onto the far ridge`);
      const fast = Math.max(...b.path.slice(1).map((q, f) => Math.hypot(q.x - b.path[f].x, q.y - b.path[f].y)));
      assert.ok(fast < 4, `seed ${seed}: bird ${j} moves ${fast.toFixed(2)} units a frame`);
      const wing = b.path.map((q) => q.wing);
      assert.ok(Math.max(...wing) - Math.min(...wing) > 0.5, `seed ${seed}: bird ${j} holds its wings still`);
    }
    for (let f = 0; f < poses.length; f++) if (birds.some((b) => b.path[f].x > 0 && b.path[f].x < W)) seen++;
    assert.ok(seen > 0.8 * poses.length, `seed ${seed}: a bird is in the frame on ${seen} of ${poses.length} frames`);
    looks.push(JSON.stringify([birds.length, birds[0].path[0], tufts.slice(0, 20).map((t) => t.kind), groves.mid.length]));
  }
  assert.equal(new Set(looks).size, looks.length, 'two seeds lay out the same birds, plants and trees');
});

test('stride: the field\'s cover runs over the ground\'s whole depth, larger, darker and fewer as it nears, the nearest cut by the frame\'s foot', () => {
  // The ground was a sparse band of tufts near the walker over bare earth:
  // nothing grew in the nearest fifth of its depth.
  const { oklch } = require('../core/colour.js');
  const p = validate(EXAMPLES.stride);
  const { w: W, h: H } = p.size;
  const mean = (list, f) => list.reduce((n, t) => n + f(t), 0) / list.length;
  for (const seed of [p.seed, 1, 2, 3]) {
    const { world, poses } = solve(p, seed).state;
    const ground = Math.max(...poses[0].feet.map((ft) => ft.heel[1]));
    const left = poses[0].cam - 400;
    const seen = world.tufts.filter((t) => t.x >= left && t.x <= left + W);
    const tall = (t) => t.h * (1 + (t.y - ground) / 120);
    const fifths = [0, 1, 2, 3, 4].map((k) => seen.filter((t) => t.y >= ground + (k * (H - ground)) / 5 && t.y < ground + ((k + 1) * (H - ground)) / 5));
    fifths.forEach((list, k) => assert.ok(list.length >= 12, `seed ${seed}: fifth ${k + 1} of the ground's depth holds ${list.length} plants`));
    const [far, near] = [fifths[0], fifths[4]];
    // Each plant's own height is seeded, so the means differ by more than the
    // drawing scale alone; at seeds 1 to 12 the ratio runs 1.34 to 1.76.
    const grown = mean(near, tall) / mean(far, tall);
    assert.ok(grown >= 1.25, `seed ${seed}: the nearest fifth's plants stand ${grown.toFixed(2)} times the farthest's`);
    const most = Math.max(...fifths.map((list) => list.length));
    assert.ok(near.length < most / 2, `seed ${seed}: the nearest fifth holds ${near.length} plants, the most crowded ${most}`);
    const [dark, light] = [mean(near, (t) => oklch(t.colour)[0]), mean(far, (t) => oklch(t.colour)[0])];
    assert.ok(dark < light, `seed ${seed}: the nearest fifth's plants are ${dark.toFixed(3)} light, the farthest's ${light.toFixed(3)}`);
    const bladed = (list) => list.filter((t) => t.kind !== 'shrub');
    const [fine, coarse] = [mean(bladed(near), (t) => t.blades), mean(bladed(far), (t) => t.blades)];
    assert.ok(fine >= coarse + 1, `seed ${seed}: the nearest fifth's plants draw ${fine.toFixed(2)} blades, the farthest's ${coarse.toFixed(2)}`);
    const cut = seen.filter((t) => t.y >= H && t.y - tall(t) < H).length;
    assert.ok(cut >= 3, `seed ${seed}: ${cut} plants rooted under the frame's foot rise into it`);
  }
});

test('stride: the birds and the trees are drawn, and with the camera held the crowns and the plants still sway', () => {
  const { mix } = require('../core/colour.js');
  const p = validate(EXAMPLES.stride);
  const W = p.size.w;
  const heads = playheads(p);
  const solved = solve(p);
  const { world, birds, poses } = solved.state;
  // The colours stride.js draws in, read from its build: the birds, and each ridge's three tree tones and depth.
  const { bird: BIRD, ridges } = world.colours;
  const tones = { far: ridges.far.tones, mid: ridges.mid.tones };
  const depth = { far: ridges.far.depth, mid: ridges.mid.depth };
  assert.ok(tones.far.length === 3 && tones.mid.length === 3 && depth.far > 0 && depth.far < depth.mid && /^#[0-9a-f]{6}$/.test(BIRD), 'stride names its ridges\' tones and depths and its birds\' colour');
  // Every paint op with the path ops since its beginPath.
  const painted = (g) => {
    const out = [];
    let path = [];
    for (const op of g.ops) {
      if (op === 'beginPath') path = [];
      else if (/^[MLQCE]-?\d/.test(op)) path.push(op);
      else if (op.startsWith('fill:') || op.startsWith('stroke:')) out.push({ paint: op, path });
    }
    return out;
  };
  const nums = (op) => op.slice(1).split(',').map(Number);
  // Holding every pose at the first leaves only what moves in time.
  const held = { ...solved, state: { ...solved.state, poses: poses.map(() => poses[0]) } };
  const frame = (f, s = solved) => { const g = new Recorder(); drawFrame(g, p, s, heads[f]); return painted(g); };

  for (const f of [0, 60, 150]) {
    const marks = frame(f);
    const wings = marks.filter((m) => m.paint === `stroke:${BIRD}:1.5`);
    assert.equal(wings.length, 1, `frame ${f}: ${wings.length} bird strokes`);
    const flying = birds.filter((b) => b.path[f].x >= -b.span && b.path[f].x <= W + b.span).length;
    assert.ok(flying > 0, `frame ${f}: no bird in the frame`);
    assert.equal(wings[0].path.filter((op) => op[0] === 'Q').length, 2 * flying, `frame ${f}: the wings drawn are not ${flying} birds'`);
    for (const name of ['far', 'mid']) {
      const off = poses[f].cam * depth[name];
      const standing = world.groves[name].filter((t) => t.u - off > -20 && t.u - off < W + 20).length;
      const crowns = marks.filter((m) => tones[name].some((c) => m.paint === `fill:${c}:1`))
        .reduce((n, m) => n + m.path.filter((op) => op[0] === 'E').length, 0);
      assert.equal(crowns, standing, `frame ${f}: ${crowns} crowns drawn on the ${name} ridge, ${standing} trees stand there`);
    }
  }

  // The camera and the walker held still, a second later the crowns and the
  // plant tips have moved in the wind.
  const [a, b] = [frame(0, held), frame(24, held)];
  const crownsOf = (marks) => marks.filter((m) => [...tones.far, ...tones.mid].some((c) => m.paint === `fill:${c}:1`))
    .flatMap((m) => m.path.filter((op) => op[0] === 'E').map((op) => nums(op).slice(0, 2)));
  const tipsOf = (marks) => marks.filter((m) => m.paint.startsWith('stroke:') && m.paint !== `stroke:${BIRD}:1.5`)
    .flatMap((m) => m.path.filter((op) => op[0] === 'Q').map((op) => nums(op).slice(2, 4)));
  const moved = (from, to) => {
    assert.equal(from.length, to.length, 'the held frames draw different counts');
    assert.ok(from.length > 0, 'nothing to compare');
    return Math.max(...from.map(([x, y], i) => Math.hypot(to[i][0] - x, to[i][1] - y)));
  };
  const crowns = moved(crownsOf(a), crownsOf(b));
  assert.ok(crowns > 0.3, `the tree crowns move at most ${crowns.toFixed(3)} units in a second`);
  const tips = moved(tipsOf(a), tipsOf(b));
  assert.ok(tips > 1, `the plant tips move at most ${tips.toFixed(3)} units in a second`);
});

test('stride: every limb is lit from the low sun, a light line on its sun side, the far limbs dimmer with a dark rim on the shade side, and its long shadow stays one flat colour', () => {
  const { mix } = require('../core/colour.js');
  const p = validate(EXAMPLES.stride);
  // The colours stride.js draws in, read from its build.
  const { wood: WOOD, woodFar: WOOD_FAR, sun: SUN, ink: INK, ground: GROUND } = solve(p).state.world.colours;
  const NEAR = mix(WOOD, SUN, 0.4);
  const FAR = mix(WOOD_FAR, SUN, 0.3);
  const RIM = mix(WOOD_FAR, INK, 0.3);
  const SHADOW = mix(GROUND, INK, 0.28);
  const painted = (g) => {
    const out = [];
    let path = [];
    for (const op of g.ops) {
      if (op === 'beginPath') path = [];
      else if (/^[MLQCE]-?\d/.test(op)) path.push(op);
      else if (op.startsWith('fill:') || op.startsWith('stroke:')) out.push({ paint: op, path });
    }
    return out;
  };
  const x0 = (m) => Number(m.path[0].slice(1).split(',')[0]);
  for (const seed of [4, 1, 2]) {
    const solved = solve(p, seed);
    for (const f of [0, 14, 60, 150]) {
      const g = new Recorder();
      drawFrame(g, p, solved, playheads(p)[f]);
      const marks = painted(g);
      const of = (c) => marks.filter((m) => m.paint.startsWith(`stroke:${c}:`));
      const [near, far, rim] = [of(NEAR), of(FAR), of(RIM)];
      assert.equal(near.length, 2, `seed ${seed}, frame ${f}: ${near.length} near light lines`);
      assert.equal(far.length, 2, `seed ${seed}, frame ${f}: ${far.length} far light lines`);
      assert.equal(rim.length, 2, `seed ${seed}, frame ${f}: ${rim.length} far shade rims`);
      // The sun stands to the left: each far light line starts left of its rim.
      for (const i of [0, 1]) {
        assert.ok(x0(far[i]) < x0(rim[i]), `seed ${seed}, frame ${f}: far limb ${i} has its light at x ${x0(far[i])}, its rim at x ${x0(rim[i])}`);
      }
      const t = g.ops.indexOf('transform');
      assert.ok(t >= 0, `seed ${seed}, frame ${f}: no shadow transform`);
      const shadow = g.ops.slice(t, g.ops.indexOf('restore', t)).filter((op) => op.startsWith('stroke:'));
      const other = shadow.filter((op) => !op.startsWith(`stroke:${SHADOW}:`)).length;
      assert.equal(other, 0, `seed ${seed}, frame ${f}: ${other} of ${shadow.length} shadow strokes not in the shadow colour`);
      assert.ok(shadow.length > 10, `seed ${seed}, frame ${f}: the shadow draws ${shadow.length} strokes`);
    }
  }
});

test('stride: every plant keeps one side of the walker, a foot flattens the plant under it, pins it under the ball until the toe leaves, and it springs back, and each first touch rustles under the air', async () => {
  // The owner saw, in the seed-4 film at 0.58 to 1.21 s, a reed stem drawn
  // under the far foot's sole and over it. It was the stalk rooted at x 147.7,
  // 11.8 units below the ground line: every tuft rooted within 18 was painted
  // behind the walker, but the sole's underside is 4 below the line, so the
  // stem showed under the sole and vanished into it. A foot landing on a
  // plant pressed only tufts rooted within 8, by distance from the heel,
  // which that stalk was not; a pressed tuft stood up again the frame the
  // foot left; and no touch made a sound. Then the sprung press followed the
  // foot's instead of being let go from it: a plant a sole brushed for a
  // frame or two popped up the frame the foot left and bent down again with
  // no foot on it.
  const { renderSound } = require('../core/render.js');
  const { fakeAudio } = require('./fake-media.js');
  const p = validate(EXAMPLES.stride);
  const heads = playheads(p);
  const WOOD = (({ wood, woodFar }) => [wood, woodFar])(solve(p).state.world.colours);
  const num = (op, i) => Number(op.slice(1).split(',')[i]);
  const painted = (g) => {
    const out = [];
    let path = [];
    for (const op of g.ops) {
      if (op === 'beginPath') path = [];
      else if (/^[MLQCE]-?\d/.test(op)) path.push(op);
      else if (op.startsWith('fill:') || op.startsWith('stroke:')) out.push({ paint: op, path });
    }
    return out;
  };
  const db = (x) => 20 * Math.log10(x);
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const looks = [];
  const pins = [];
  for (const seed of seeds) {
    const solved = solve(p, seed);
    const { world, poses, brushes, plants } = solved.state;
    const ground = Math.max(...poses[0].feet.map((ft) => ft.heel[1]));
    // The paint order, on the owner's frame 14 and three more: every plant
    // stroke rooted above the sole's underside comes before the figure, every
    // one rooted at or below it after.
    for (const f of [0, 14, 60, 150]) {
      const g = new Recorder();
      drawFrame(g, p, solved, heads[f]);
      const marks = painted(g);
      const figure = marks.map((m, i) => (WOOD.some((c) => m.paint.startsWith(`stroke:${c}:`)) ? i : -1)).filter((i) => i >= 0);
      const [first, last] = [Math.min(...figure), Math.max(...figure)];
      let plants = 0;
      marks.forEach((m, i) => {
        if (!/^stroke:#[0-9a-f]{6}:1\.[36]$/.test(m.paint)) return;
        const root = Math.max(...m.path.filter((op) => op[0] === 'M').map((op) => num(op, 1)));
        plants++;
        if (root < ground + 4) assert.ok(i < first, `seed ${seed}, frame ${f}: a plant rooted ${(root - ground).toFixed(1)} under the ground line, above the sole's underside, is painted over the walker`);
        else assert.ok(i > last, `seed ${seed}, frame ${f}: a plant rooted ${(root - ground).toFixed(1)} under the ground line, below the sole's underside, is painted behind the walker`);
      });
      assert.ok(plants > 20, `seed ${seed}, frame ${f}: ${plants} plant strokes`);
    }
    // Each touch, from the poses alone: a sole runs from the heel to the toe
    // (2 units past each), its underside 4 below that line, and a plant
    // rooted within 12 of the ground line whose free height reaches over the
    // underside is pressed that far, to 1. The build's press track must hold
    // the plant exactly there on every frame a foot is over it, flat under a
    // foot that stands on it. From the frame the foot leaves it rises every
    // frame, taking three or more to pass upright, swings past upright by a
    // fifth of the press it was let go from or more within a second, never
    // beyond two fifths of it, and 30 frames on bends under a twentieth.
    // A planted foot pins a plant rooted from 2 units behind its ball, 21
    // from the heel it landed on, at its deepest press until the frame its
    // toe leaves, and the lifting foot does not press it again.
    const grow = (t) => t.h * (1 + (t.y - ground) / 120);
    const under = (t, ft) => {
      if (t.x < ft.heel[0] - 2 || t.x > ft.toe[0] + 2) return 0;
      const sole = ft.heel[1] + ((ft.toe[1] - ft.heel[1]) * (t.x - ft.heel[0])) / (ft.toe[0] - ft.heel[0]) + 4;
      return Math.min(1, 1 - (t.y - sole) / grow(t));
    };
    const ball = (t, ft) => t.x >= plants[ft.contact + 1] + 19;
    const pinned = (t) => {
      const pin = [];
      return poses.map((q) => q.feet.reduce((most, ft, j) => {
        let press = under(t, ft);
        const held = pin[j] && pin[j][0] === ft.contact;
        if (held && !ft.planted) press = 0;
        else if (ft.planted && (held || (press > 0 && ball(t, ft)))) {
          press = Math.max(press, held ? pin[j][1] : 0);
          pin[j] = [ft.contact, press];
        }
        return Math.max(most, press);
      }, 0));
    };
    // Each toe leaving, from the poses: the foot, the frame and its contact.
    const offs = [];
    for (let f = 1; f < poses.length; f++) {
      poses[f].feet.forEach((ft, j) => {
        const was = poses[f - 1].feet[j];
        if (was.planted && !ft.planted) offs.push({ f, j, contact: was.contact });
      });
    }
    const touches = [];
    for (const t of world.tufts) {
      const name = `seed ${seed}: the ${t.kind} at ${t.x.toFixed(1)}`;
      assert.equal(!!t.press, t.y < ground + 12, `${name}, rooted ${(t.y - ground).toFixed(1)} under the ground line, ${t.press ? 'carries' : 'has no'} press track`);
      if (!t.press) continue;
      const raw = pinned(t);
      const press = Array.from(t.press);
      // The pin, from the poses alone: on the frame a toe leaves a plant
      // under its ball, the plant is let go from the deepest press that
      // foot's sole gave it while planted on that contact, and rises.
      for (const o of offs) {
        let deepest = 0, g = o.f - 1;
        for (; g >= 0 && poses[g].feet[o.j].planted && poses[g].feet[o.j].contact === o.contact; g--) deepest = Math.max(deepest, under(t, poses[g].feet[o.j]));
        if (deepest <= 0 || !ball(t, poses[o.f - 1].feet[o.j])) continue;
        pins.push(deepest);
        assert.ok(Math.abs(press[o.f - 1] - deepest) < 1e-9, `${name}, under the ball of foot ${o.j}, is let go on frame ${o.f} from ${press[o.f - 1].toFixed(3)}, not from its deepest press, ${deepest.toFixed(3)}`);
        if (raw[o.f] === 0) assert.ok(press[o.f] < press[o.f - 1], `${name}, under the ball of foot ${o.j}, does not rise the frame its toe leaves, ${o.f}`);
      }
      raw.forEach((r, f) => {
        if (r > 0) assert.ok(Math.abs(press[f] - r) < 1e-9, `${name} is pressed ${press[f].toFixed(3)} on frame ${f}, the sole over it ${r.toFixed(3)}`);
      });
      for (let f = 1; f < raw.length; f++) {
        if (raw[f] > 0 && raw[f - 1] === 0) {
          let peak = 0, leaves = f;
          for (; leaves < raw.length && raw[leaves] > 0; leaves++) peak = Math.max(peak, raw[leaves]);
          touches.push({ frame: f, x: t.x, kind: t.kind, peak, leaves, t });
        }
        if (!(raw[f] === 0 && raw[f - 1] > 0)) continue;
        // Let go on frame f from press[f - 1], free until the next touch.
        const from = press[f - 1];
        let next = f;
        while (next < raw.length && raw[next] === 0) next++;
        let down = -1;
        for (let g = f; g < next; g++) {
          if (down < 0 && press[g] > 0) assert.ok(press[g] < press[g - 1], `${name}, let go on frame ${f}, bends from ${press[g - 1].toFixed(3)} to ${press[g].toFixed(3)} on frame ${g} with no foot on it`);
          if (down < 0 && press[g] <= 0) down = g;
          if (down >= 0) assert.ok(Math.abs(press[g]) <= 0.4 * from + 1e-9, `${name}, let go from ${from.toFixed(3)} on frame ${f}, swings to ${press[g].toFixed(3)} on frame ${g}`);
        }
        if (down >= 0) assert.ok(down - f >= 2, `${name}, let go from ${from.toFixed(3)} on frame ${f}, passes upright on frame ${down}: it snaps up`);
        if (next - f >= 24) assert.ok(Math.min(...press.slice(f, f + 24)) < -0.2 * from, `${name}, let go from ${from.toFixed(3)} on frame ${f}, rises to ${Math.min(...press.slice(f, f + 24)).toFixed(3)} without swinging past upright`);
        if (next - f > 30) assert.ok(Math.abs(press[f + 30]) < 0.05 * from, `${name}, let go from ${from.toFixed(3)} on frame ${f}, still bends ${press[f + 30].toFixed(3)} 30 frames on`);
      }
    }
    touches.sort((a, b) => a.frame - b.frame || a.x - b.x);
    // The build's brushes are those touches pressing 0.15 or more, each with its press.
    const heard = touches.filter((o) => o.peak >= 0.15);
    assert.ok(heard.length >= 4, `seed ${seed}: a foot touches ${heard.length} plants over the walk`);
    assert.deepEqual(brushes.map((b) => `${b.frame} ${b.x.toFixed(1)} ${b.kind} ${b.peak.toFixed(6)}`), heard.map((o) => `${o.frame} ${o.x.toFixed(1)} ${o.kind} ${o.peak.toFixed(6)}`),
      `seed ${seed}: the brushes are not the touches the poses make`);
    // Drawn so, for a plant of blades (a shrub is lumps) a foot stands on:
    // on the frame it is flattest its blades end within a tenth of its free
    // height over the root at a full press, or within what nine tenths of a
    // lesser press leaves of it, and 30 frames after the foot leaves over half.
    for (const o of heard) {
      const { t } = o;
      const until = heard.find((q) => q.t === t && q.frame > o.frame);
      if (o.kind === 'shrub' || o.peak < 0.9 || (until ? until.frame : poses.length) - o.leaves <= 30) continue;
      let top = o.frame;
      for (let f = o.frame; f < o.leaves; f++) if (t.press[f] >= t.press[top]) top = f;
      const tips = (f) => {
        const g = new Recorder();
        drawFrame(g, p, solved, heads[f]);
        const cam = poses[f].cam;
        const mark = painted(g).find((m) => m.path.some((op) => op[0] === 'M' && Math.abs(num(op, 0) - (o.x - cam + 400)) < 3 && Math.abs(num(op, 1) - t.y) < 1e-3));
        assert.ok(mark, `seed ${seed}: the ${o.kind} at ${o.x.toFixed(1)} is not drawn on frame ${f}`);
        return Math.max(...mark.path.filter((op) => op[0] === 'Q').map((op) => t.y - num(op, 3)));
      };
      assert.ok(tips(top) < (1 - 0.9 * o.peak) * grow(t) + 0.5, `seed ${seed}: the ${o.kind} at ${o.x.toFixed(1)} stands ${tips(top).toFixed(1)} of ${grow(t).toFixed(1)} under a press of ${o.peak.toFixed(2)} on frame ${top}`);
      assert.ok(tips(o.leaves + 30) > 0.5 * grow(t), `seed ${seed}: the ${o.kind} at ${o.x.toFixed(1)} stands ${tips(o.leaves + 30).toFixed(1)} of ${grow(t).toFixed(1)} a second and a quarter after the foot leaves`);
    }
    // Heard: one dry rustle starting on each touch's frame, sent nowhere near
    // the room, its peak at most 3 dB over the air's low tone and at least 6
    // under the loudest crack, over within 150 ms, and no two alike.
    const audio = fakeAudio();
    await renderSound(p, solved, { OfflineAudioContext: audio.Context });
    const sr = audio.record.contexts[0].sampleRate;
    const peak = (o) => o.to[0].gain.events.find((e) => e[0] === 'linearRampToValueAtTime')[1];
    const air = solved.state.world.air;
    const wet = new Set(audio.record.nodes.filter((n) => n.kind === 'convolver'));
    for (let grew = true; grew;) {
      grew = false;
      for (const n of audio.record.nodes) if (!wet.has(n) && n.to.some((q) => wet.has(q))) { wet.add(n); grew = true; }
    }
    const cracks = [], rustles = [];
    for (const n of audio.record.nodes.filter((q) => q.kind === 'bufferSource')) {
      const d = n.buffer.getChannelData(0);
      let top = 0, sum = 0;
      for (let i = 0; i < d.length; i++) { top = Math.max(top, Math.abs(d[i])); sum += d[i] * d[i]; }
      let first = -1, last = -1, run = 0;
      for (let i = 0; i < d.length; i++) { run += d[i] * d[i]; if (first < 0 && run >= 0.005 * sum) first = i; if (last < 0 && run >= 0.995 * sum) last = i; }
      const hit = { at: n.at, top, span: (last - first) / sr, wet: wet.has(n) };
      if (String(n.grit).startsWith('crunch ')) cracks.push(hit);
      else if (String(n.grit).startsWith('rustle ')) rustles.push(hit);
    }
    assert.deepEqual(rustles.map((h) => h.at), brushes.map((b) => b.frame / p.time.hz), `seed ${seed}: the rustles do not start on the touches' frames`);
    const loudest = Math.max(...cracks.map((h) => h.top));
    for (const [i, h] of rustles.entries()) {
      const b = brushes[i];
      assert.ok(!h.wet, `seed ${seed}: the rustle at ${h.at.toFixed(3)} s reaches the room`);
      assert.ok(db(h.top / air) <= 3, `seed ${seed}: the rustle of the ${b.kind} at ${h.at.toFixed(3)} s peaks ${db(h.top / air).toFixed(1)} dB over the air, over 3: not under it`);
      assert.ok(db(h.top / loudest) <= -6, `seed ${seed}: the rustle of the ${b.kind} at ${h.at.toFixed(3)} s peaks ${db(h.top / loudest).toFixed(1)} dB from the loudest crack, over -6: as loud as a step`);
      assert.ok(h.span <= 0.15, `seed ${seed}: the rustle at ${h.at.toFixed(3)} s lasts ${h.span.toFixed(3)} s, over 0.15`);
    }
    assert.equal(new Set(rustles.map((h) => h.top.toPrecision(6))).size, rustles.length, `seed ${seed}: two rustles peak alike`);
    looks.push(brushes.map((b) => `${b.frame}:${b.x.toFixed(1)}`).join(' '));
  }
  assert.equal(new Set(looks).size, seeds.length, 'two seeds touch the same plants on the same frames');
  // Before the pin, 2 of 214 plants let go over these seeds sprang from a
  // press of 0.9 or more: the foot rolled off them first. With it, 44 are
  // pinned, 30 of those from 0.9 or more.
  const full = pins.filter((v) => v >= 0.9).length;
  assert.ok(pins.length >= 36 && full >= 24, `over seeds 1 to 12, ${pins.length} plants are pinned under a ball until the toe leaves, ${full} of them from 0.9 or more`);
});

test('refit: a narrower box holds fewer of the same things, each inside it and clear of the rest', () => {
  const { atBox } = require('../core/piece.js');
  const p = validate(EXAMPLES.refit);
  assert.ok(p.boxes, 'refit declares the boxes it accepts');
  const piles = [1280, 960, 720, 405].map((w) => {
    const s = solve(atBox(p, { w, h: 720 }), p.seed).state;
    const things = refitHeld(s, s.frames.length - 1);
    refitLoses(s, things, `${w} wide`);
    return { w, things };
  });
  const counts = piles.map((s) => s.things.length);
  for (let k = 1; k < counts.length; k++) assert.ok(counts[k] < counts[k - 1], `holds ${counts.join(', ')} as the box narrows`);

  // Thing i is thing i at every box: only where it rests may differ.
  const wide = new Map(piles[0].things.map((th) => [th.i, th]));
  for (const th of piles[3].things) {
    const same = wide.get(th.i);
    if (same) for (const k of ['r', 'kind', 'fill', 'spin']) assert.equal(th[k], same[k], `thing ${th.i}.${k}`);
  }
  assert.ok(piles[3].things.filter((th) => wide.has(th.i)).length > piles[3].things.length * 0.8, 'the narrow pile is mostly the wide one\'s things');

  for (const s of piles) refitSettled(s.things, s.w, 720);
});

/**
 * The fill of a still box stops when the container is full, so nothing lands
 * over the rim and vanishes: nothing falls in only to vanish.
 */
function refitLoses(s, things, label) {
  const gone = s.things.filter((th) => th.gone < Infinity);
  assert.equal(gone.length, 0, `${gone.length} things vanish at ${label}, ${gone.slice(0, 5).map((th) => `${th.i} at frame ${th.gone}`).join(', ')}: the fill overfilled the container`);
}

/** The things refit holds at frame f, released and not gone, each with where it stands. */
function refitHeld(s, f) {
  const snap = s.frames[f];
  return s.things.flatMap((th, k) => (th.born <= f && th.gone > f ? [{ ...th, x: snap[3 * k], y: snap[3 * k + 1] }] : []));
}

/**
 * Every thing refit holds at the end of a still box w by h has landed inside
 * the walls, clear of the rest: no two overlap by more than `slack`. The
 * walls are lines that move with the box, and a solved pile keeps a hair of
 * overlap, more at the floor of a deep pile: both well
 * under the ink.
 */
function refitSettled(things, w, h, slack = 4) {
  const c = { x0: 40, x1: w - 40, rim: 100, floor: h - 76 };
  for (const [n, a] of things.entries()) {
    assert.ok(a.landed < Infinity, `thing ${a.i} is still falling when the film ends at ${w} x ${h}`);
    assert.ok(a.x - a.r >= c.x0 - 2 && a.x + a.r <= c.x1 + 2, `thing ${a.i} crosses a wall at ${w} x ${h}`);
    assert.ok(a.y >= c.rim && a.y + a.r <= c.floor + 2, `thing ${a.i} is above the rim or below the floor at ${w} x ${h}`);
    for (const b of things.slice(n + 1)) {
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r - slack, `things ${a.i} and ${b.i} overlap at ${w} x ${h}`);
    }
  }
}

/**
 * The factor refit scales its things by at a box: the root of the ratio of
 * its container's room to the default box's, times the fourth root of the
 * ratio of its height to the default's, never under one.
 */
const refitScale = ({ w, h }) => Math.max(1, Math.sqrt((w - 80) * (h - 176) / ((1280 - 80) * (720 - 176)) * Math.sqrt((h - 176) / (720 - 176))));

test('refit: a roomier or taller box scales its things up by one continuous factor, its largest holding about half as many, its tallest narrow one fewer than at their size; a short roomy box keeps them at their size; its default box at its smallest grain holds many more; and each fills within the film and comes to rest', () => {
  const { atBox } = require('../core/piece.js');
  const p = validate(EXAMPLES.refit);
  const plain = solve(atBox(p, { w: 1280, h: 720 })).state;
  const alone = refitHeld(plain, plain.frames.length - 1).length;
  const big = { w: p.boxes.w[1], h: p.boxes.h[1] };
  // The largest box's container has this much more room than the default
  // one's and is this much taller; its things are scaled by the root of the
  // one and the fourth root of the other, so that the fewer, bigger things,
  // falling and settling through a taller box, cost the solve about what
  // the default pile does. The tallest narrow box has less room but is
  // taller, so the factor comes to a quarter more; a short roomy box's
  // factor would come to less than one, so its things keep their size.
  assert.ok(refitScale(big) > 2.9 && refitScale({ w: 405, h: 1920 }) > 1.2 && refitScale({ w: 405, h: 1920 }) < 1.3 && refitScale({ w: 1920, h: 540 }) === 1, 'the boxes exercise the factor above one, between one and the largest, and at one');
  for (const [label, box, params] of [['the largest box', big, undefined], ['the tallest narrow box', { w: 405, h: 1920 }, undefined], ['a short roomy box', { w: 1920, h: 540 }, undefined], ['grain 0.6', { w: 1280, h: 720 }, { grain: 0.6 }]]) {
    const s = solve(atBox(p, box), p.seed, params).state;
    const last = s.frames.length - 1;
    const things = refitHeld(s, last);
    if (params) assert.ok(things.length > 2.2 * alone, `${label} holds ${things.length} things, the default box ${alone}`);
    else if (box === big) assert.ok(things.length > 0.4 * alone && things.length < 0.75 * alone, `${label} holds ${things.length} things, the default box ${alone}`);
    else if (box.h === 1920) assert.ok(things.length < 0.85 * alone * (box.w - 80) * (box.h - 176) / ((1280 - 80) * (720 - 176)), `${label} holds ${things.length} things, the default box ${alone}: its things were not scaled up`);
    if (!params) for (const th of things.slice(0, 20)) assert.ok(Math.abs(th.r - plain.things[th.i].r * refitScale(box)) < 1e-9, `thing ${th.i} is ${th.r} wide at ${label}, ${plain.things[th.i].r} at the default box, for a factor of ${refitScale(box)}`);
    const released = Math.max(...s.things.map((th) => th.born));
    assert.ok(released < 0.8 * last, `${label} is still taking things at frame ${released} of ${last}`);
    refitLoses(s, things, label);
    // A pile this deep presses the small things at its floor together by a
    // few units more than the default box's pile does.
    refitSettled(things, box.w, box.h, 8);
  }
  // The factor changes with the box without a jump: two tall boxes ten units
  // apart in width, one with a hair less room than the default box and one
  // with a hair more, scale their things within two percent of each other.
  const [under, over] = [450, 460].map((w) => { const th = solve(atBox(p, { w, h: 1920 }), p.seed).state.things[0]; return th.r / plain.things[th.i].r; });
  assert.ok(under > 1.2 && over / under < 1.02 && over / under > 1, `the things are scaled ${under} times at 450 x 1920 and ${over} times at 460 x 1920`);
});

test('refit: a film whose timeline visits a box far smaller than its frame scales its things only as far as that box still takes the smallest of them, takes nothing out of the air as the box closes, and ends with some held', () => {
  // The largest box would scale the things up almost threefold, too big
  // for the smallest box's container, 160 by 64, to hold any; at grain 1.6
  // the scale is cut to what fits one of the smallest things with its
  // clearance in it, and the solve is cheap. The box closes eightfold in a
  // seventh of the film, heaving the whole pile up: what it throws out
  // goes at the rim, and what is still falling in lands.
  const keys = [{ t: 0, w: 1920, h: 1920 }, { t: 0.3, w: 1920, h: 1920 }, { t: 0.45, w: 240, h: 240 }, { t: 1, w: 240, h: 240 }];
  const { solved, frames } = refitTravels(keys, { grain: 1.6 });
  const s = solved.state;
  const last = frames.length - 1;
  const fit = (64 - 16) / (2 * 14 * 1.6);
  assert.ok(fit > 1 && fit < 1.1, `the smallest box fits a scale of ${fit}`);
  for (const th of s.things) assert.ok(th.r <= 44 * 1.6 * fit + 1e-9, `thing ${th.i} is ${th.r} wide, scaled past what the smallest box takes`);
  // The smallest box stands centred in the frame.
  const things = refitHeld(s, last).map((th) => ({ ...th, x: th.x - 840, y: th.y - 840 }));
  assert.ok(things.length >= 1 && things.length <= 6, `the smallest box ends holding ${things.length} things`);
  refitSettled(things, 240, 240, 8);
});

test('refit: a box that closes fast under a tall box stops the rain in time to land before the walls move, so nothing is jammed into a column above the rim or taken in one flash', () => {
  // The largest box closes eightfold in a seventh of the film, a pile of
  // hundreds of things into a container that will hold four. The rain
  // stops a second and a half before the walls move, when its last drop
  // can still land; left falling, it jammed between the closing walls into
  // a column above the rim, sixty things deep and crushed into each other,
  // and went in one frame when the rising pile reached it.
  const keys = [{ t: 0, w: 1920, h: 1920 }, { t: 0.3, w: 1920, h: 1920 }, { t: 0.45, w: 240, h: 240 }, { t: 1, w: 240, h: 240 }];
  const { frames, frame } = refitTravels(keys);
  let column = 0;
  let flash = 0;
  for (let f = frame(0.3) + 1; f <= frame(0.45); f++) {
    const { at, box } = frames[f];
    const above = [...at].filter(([, q]) => q.scale === 1 && q.y < box.rim).length;
    const going = [...at].filter(([id, q]) => q.scale < 1 && frames[f - 1].at.get(id)?.scale === 1).length;
    column = Math.max(column, above);
    flash = Math.max(flash, going);
  }
  assert.ok(column <= 35, `${column} things stand above the rim in one frame as the box closes`);
  assert.ok(flash <= 40, `${flash} things start to vanish in one frame as the box closes`);
});

test('refit: a box that narrows before the first thing could land releases nothing until it stops, then fills, and nothing vanishes', () => {
  // The default box loses a third of its width in a tenth of the film,
  // from the twentieth frame, before a thing released on the first could
  // land: the rain waits for the walls to stop, since a thing falling in
  // beside a closing wall would be pushed or squeezed, and then fills the
  // narrower box. Nothing vanishes.
  const keys = [{ t: 0, w: 1280, h: 720 }, { t: 0.08, w: 1280, h: 720 }, { t: 0.2, w: 800, h: 720 }, { t: 1, w: 800, h: 720 }];
  const { solved, frames, frame } = refitTravels(keys);
  const vanished = new Set();
  for (const { at } of frames) for (const [id, q] of at) if (q.scale < 1) vanished.add(id);
  assert.equal(vanished.size, 0, `${[...vanished].join(', ')} vanish while the box narrows early`);
  const first = Math.min(...solved.state.things.map((th) => th.born));
  assert.ok(first >= frame(0.2) && first <= frame(0.2) + 2, `the first thing is released at frame ${first}, the box narrowing from ${frame(0.08) + 1} to ${frame(0.2)}`);
  const held = (f) => [...frames[f].at].filter(([, q]) => q.scale === 1 && q.y >= frames[f].box.rim).length;
  assert.ok(held(frames.length - 1) > 150, `it holds ${held(frames.length - 1)} things at the end`);
});

test('refit: a film that starts in a box the fit bound scales its smallest things exactly to fills that box, whatever rounding the bound leaves', () => {
  // A container 87 tall at grain 1.21 scales the smallest things to 48 high
  // less a hair of rounding, exactly the room less a release's clearance:
  // a release check that asked for the room to the last bit took nothing
  // for the whole of the small box.
  const { atBox } = require('../core/piece.js');
  const p = validate(EXAMPLES.refit);
  const keys = [{ t: 0, w: 600, h: 263 }, { t: 0.5, w: 600, h: 263 }, { t: 1, w: 1920, h: 1920 }];
  for (const grain of [1, 1.21]) {
    const s = solve(atBox(p, keys), p.seed, { grain }).state;
    // The smallest thing is about 12 wide at grain 1; a release asks for the
    // room of one 14 wide, the smallest fourth, plus 16 of clearance.
    const scale = Math.min(...s.things.map((th) => th.r)) / 12;
    assert.ok(Math.abs(2 * 14 * scale + 16 - 87) < 0.1, `the things are scaled ${scale} times at grain ${grain}, not to the small box's room`);
    const held = refitHeld(s, Math.round(0.48 * (s.frames.length - 1))).length;
    assert.ok(held >= 5, `the small box holds ${held} things at grain ${grain} before the box grows`);
  }
});

test('refit: a film scales its things for the roomiest box its timeline visits, never for its frame, so one between a short box and a tall one scales them for the tall one and holds about as many as those boxes do', () => {
  // The frame, 1920 by 1920, has five times the default box's room and
  // would scale the things more than threefold; the tall box the timeline
  // visits has less room than the default and scales them by a quarter.
  const { atBox } = require('../core/piece.js');
  const p = validate(EXAMPLES.refit);
  const keys = [{ t: 0, w: 1920, h: 300 }, { t: 0.3, w: 1920, h: 300 }, { t: 0.5, w: 405, h: 1920 }, { t: 1, w: 405, h: 1920 }];
  const s = solve(atBox(p, keys), p.seed).state;
  const last = s.frames.length - 1;
  const scale = refitScale({ w: 405, h: 1920 });
  for (const th of s.things) assert.ok(th.r <= 44 * scale + 1e-9 && th.r >= 12 * scale - 1e-9, `thing ${th.i} is ${th.r} wide on the timeline, scaled for its frame`);
  // The short box's rain stops in time to land before the box narrows, a
  // second and a half before, so it holds over half of what the still box,
  // whose things are at their size, holds of things this much bigger.
  const short = refitHeld(s, Math.round(0.3 * last)).length;
  const tall = refitHeld(s, last).length;
  const still = solve(atBox(p, { w: 1920, h: 300 }), p.seed).state;
  const alone = refitHeld(still, still.frames.length - 1).length;
  assert.ok(short > 0.5 * alone / (scale * scale) && tall > 120, `the film holds ${short} things in the short box, which alone holds ${alone} at their size, and ${tall} in the tall one`);
});

test('refit: the things waiting to fall in stand no higher over the frame than the container is tall and a half, so nothing enters the frame faster than a fall from there', () => {
  // A film scaled for the largest box that opens in a narrow tall one and
  // widens to the largest while its first fill still rains: its big things
  // queue over the container faster than they fall in, and the queue
  // reaches the height the rule allows, where the rest wait. Each thing is
  // kept from the frame it is released on, a frame of fall below where it
  // was released.
  const { atBox } = require('../core/piece.js');
  const p = validate(EXAMPLES.refit);
  const keys = [{ t: 0, w: 405, h: 1920 }, { t: 0.1, w: 1920, h: 1920 }, { t: 1, w: 1920, h: 1920 }];
  const s = solve(atBox(p, keys), p.seed, { grain: 1.6 }).state;
  const height = 1920 - 100 - 76;
  const released = s.things.map((th, k) => ({ th, y: s.frames[th.born][3 * k + 1] }));
  const highest = Math.min(...released.map((q) => q.y));
  assert.ok(highest < -1.2 * height, `the highest release stands ${-highest / height} container heights over the frame: the queue never reaches the rule`);
  for (const { th, y } of released) assert.ok(y >= -1.5 * height, `thing ${th.i} is released ${-y / height} container heights over the frame`);
  // Entering the frame, a thing moves no further in a frame than a fall
  // from that height brings it to.
  const fastest = Math.sqrt(2 * 3200 * (1.5 * height + 2 * 44 * 1.6)) / 30;
  s.things.forEach((th, k) => {
    for (let f = th.born + 1; f < s.frames.length && th.gone > f; f++) {
      if (s.frames[f][3 * k + 1] + th.r <= 0) continue;
      const step = s.frames[f][3 * k + 1] - s.frames[f - 1][3 * k + 1];
      assert.ok(step <= fastest + 1, `thing ${th.i} enters the frame at ${step} units a frame at frame ${f}`);
      break;
    }
  });
});

test('refit: while its box moves it releases at most one thing a frame, none while the box narrows, and loses none of those', () => {
  const { atBox, clockAt } = require('../core/piece.js');
  const { playheads } = require('../core/render.js');
  const p0 = validate(EXAMPLES.refit);
  // Its own film widens after the first fill, where nothing is released:
  // things grow in place, as many a frame as find a place, since they come
  // from nothing; a box that widens from the start, while the container
  // first fills, rains.
  const filling = [{ t: 0, w: 405, h: 720 }, { t: 0.25, w: 1280, h: 720 }, { t: 1, w: 1280, h: 720 }];
  for (const keys of [null, filling]) {
    const p = keys ? atBox(p0, keys) : p0;
    const s = solve(p, p0.seed).state;
    const boxes = playheads(p).map((t) => clockAt(p, t).box);
    const moving = boxes.map((b, f) => f > 0 && (b.w !== boxes[f - 1].w || b.h !== boxes[f - 1].h));
    const narrowing = boxes.map((b, f) => f > 0 && (b.w < boxes[f - 1].w || b.h < boxes[f - 1].h));
    const born = new Map();
    for (const th of s.things) born.set(th.born, [...(born.get(th.born) || []), th]);
    let rained = 0;
    for (let f = 1; f < boxes.length; f++) {
      const came = born.get(f) || [];
      const released = came.filter((th) => !th.grows);
      if (moving[f]) rained += released.length;
      if (moving[f]) assert.ok(released.length <= 1, `${released.length} things are released at frame ${f} while the box moves`);
      if (narrowing[f]) assert.equal(came.length, 0, `${came.length} things come at frame ${f} while the box narrows, to be squeezed out`);
    }
    const moved = moving.filter(Boolean).length;
    const narrowed = narrowing.filter(Boolean).length;
    assert.ok(keys ? rained > 30 : moved > 60 && narrowed > 20, `the box moves on ${moved} frames and narrows on ${narrowed}, and ${rained} things are released while it moves`);
    // What arrives while the box widens lands and stays.
    const came = s.things.filter((th) => moving[th.born]);
    const lost = came.filter((th) => th.gone < Infinity);
    assert.ok(came.length > 30, `${came.length} things arrive while the box widens`);
    assert.equal(lost.length, 0, `${lost.map((th) => th.i).join(', ')} of the ${came.length} things that arrive while the box widens are lost`);
  }
});

test('refit: its shortest, smallest, lowest and narrowest declared boxes each fill early in the film with the things that fit them, at every grain, the narrow tall ones at the strongest grip too', () => {
  const { atBox } = require('../core/piece.js');
  const p = validate(EXAMPLES.refit);
  for (const grain of [0.6, 1, 1.6]) {
    for (const [w, h] of [[1920, 240], [240, 240], [1280, 300], [240, 1920], [405, 1920]]) {
      // A channel a few of its biggest things wide packs loosest at the
      // strongest grip, where things heap up its walls: counted on at the
      // packing of a wide box, its fill landed four things over the rim.
      for (const grip of h > 1000 ? [undefined, 1.2] : [undefined]) {
        const label = `${w} x ${h} at grain ${grain}${grip ? ` and grip ${grip}` : ''}`;
        const s = solve(atBox(p, { w, h }), p.seed, { grain, ...(grip ? { grip } : {}) }).state;
        const last = s.frames.length - 1;
        const things = refitHeld(s, last);
        // Well over one thing per column as wide as the widest thing: a
        // thing too tall for the room is passed over, not waited for, and
        // the room beside a thing narrower than the column takes another.
        assert.ok(things.length > 1.5 * (w - 80) / (88 * grain), `${label} holds ${things.length} things`);
        const released = Math.max(...s.things.map((th) => th.born));
        const landed = Math.max(...things.map((th) => th.landed));
        assert.ok(released < 0.5 * last && landed < 0.7 * last, `${label} takes its last thing at frame ${released} and the last lands at ${landed}, of ${last}`);
        refitLoses(s, things, label);
        refitSettled(things, w, h, 8);
      }
    }
  }
});

test('refit: a full container in a still box takes nothing more as its pile packs closer, even at its strongest grip, where it heaps', () => {
  const { atBox } = require('../core/piece.js');
  const p = validate(EXAMPLES.refit);
  // A wide, short box of small things at the strongest grip: the heaped pile
  // settles slowly, opening room for a small thing every few frames, which a
  // rain that followed that room would fill until the film's end, at the
  // cost of solving the whole pile for every drop.
  const s = solve(atBox(p, { w: 1920, h: 720 }), p.seed, { grain: 0.6, grip: 1.2 }).state;
  const last = s.frames.length - 1;
  const things = refitHeld(s, last);
  const released = Math.max(...s.things.map((th) => th.born));
  assert.ok(released < 0.55 * last, `the full container takes its last thing at frame ${released} of ${last}`);
  refitLoses(s, things, 'a wide box at the strongest grip');
  refitSettled(things, 1920, 720, 8);
});

test('refit: a still box holds its pile only once nothing in it moves a unit a frame, which comes within two seconds and a half of the last thing landing even for a heap at the strongest grip', () => {
  // Tall boxes of small things at the strongest grip: once every thing has
  // landed the heap goes on slipping for a while, a few things a unit or
  // more a frame, and a thing deep in the largest box's pile pops a few
  // units now and then for two seconds. Solved to the end of the film it
  // would cost more than any other box; held a second after the last
  // landing, as it once was, it froze things still moving three units a
  // frame.
  const { atBox } = require('../core/piece.js');
  const p = validate(EXAMPLES.refit);
  for (const box of [{ w: 720, h: 1200 }, { w: 1920, h: 1920 }]) {
    const s = solve(atBox(p, box), p.seed, { grain: 0.6, grip: 1.2 }).state;
    const last = s.frames.length - 1;
    const landed = Math.max(...s.things.map((th) => th.landed).filter(Number.isFinite));
    assert.ok(landed > 60 && landed < last - 70, `the last thing lands at frame ${landed} of ${last} in ${box.w} x ${box.h}`);
    // The last frame the pile moved on, and the furthest any thing moved
    // over that frame: counts and a maximum, never the frames themselves.
    const differs = (f) => { let n = 0; for (let i = 0; i < s.frames[f].length; i++) if (s.frames[f][i] !== s.frames[f - 1][i] && !(Number.isNaN(s.frames[f][i]) && Number.isNaN(s.frames[f - 1][i]))) n++; return n; };
    const furthest = (f) => { let m = 0; for (let k = 0; k < s.things.length; k++) m = Math.max(m, Math.hypot(s.frames[f][3 * k] - s.frames[f - 1][3 * k], s.frames[f][3 * k + 1] - s.frames[f - 1][3 * k + 1]) || 0); return m; };
    let moved = last;
    while (moved > 0 && !differs(moved)) moved--;
    assert.ok(moved > landed && moved <= landed + 76, `the pile moves until frame ${moved}, the last thing having landed at ${landed}, in ${box.w} x ${box.h}`);
    assert.ok(furthest(moved) < 1, `the pile is held at frame ${moved} with a thing still moving ${furthest(moved)} a frame in ${box.w} x ${box.h}`);
  }
});

test('refit: an SVG drawn at another box is that box, and its recipe names it', () => {
  const { atBox } = require('../core/piece.js');
  const out = renderVector(atBox(validate(EXAMPLES.refit), { w: 405, h: 720 }), { t: 1 });
  assert.match(out.svg, /^<svg xmlns="[^"]+" width="405" height="720" viewBox="0 0 405 720"/);
  assert.deepEqual(out.manifest.size, { w: 405, h: 720 });
});

test('refit: its film casts the box\'s soft shadow down and to the right on the frame around a smaller box', () => {
  const p = validate(EXAMPLES.refit);
  const solved = solve(p, p.seed);
  const t = playheads(p)[150];
  const box = clockAt(p, t).box;
  assert.ok(box.w < p.size.w, `frame 150 shows a box ${box.w} wide inside the ${p.size.w}-wide frame`);
  const shadow = [];
  const g = new Proxy({ globalAlpha: 1 }, {
    get: (o, k) => (k in o ? o[k] : k === 'fillRect' ? (...r) => { if (o.globalAlpha < 1) shadow.push(r); } : () => {}),
  });
  drawFrame(g, p, solved, t);
  assert.ok(shadow.length >= 2, `${shadow.length} translucent layers under the box`);
  for (const [x, y, w, h] of shadow) {
    assert.ok(x > box.x && y > box.y && x - box.x < 30 && y - box.y < 30 && w === box.w && h === box.h, `a shadow layer ${w} x ${h} at ${x}, ${y} for a box at ${box.x}, ${box.y}`);
  }
});

/**
 * Every frame of refit along a box timeline, its own unless `keys` names
 * another, at its own params unless `params` sets some: where each thing,
 * named by its fill, is drawn, at what scale (1, or shrinking away as it
 * vanishes or growing in), and the box of the frame with its walls, rim and
 * floor in the frame; `landed` holds the frame each thing came to rest on,
 * and `growing(id, f)` whether thing `id` is growing in at frame f, having
 * appeared after the first fill.
 */
function refitFrames(keys, params) {
  const { atBox } = require('../core/piece.js');
  const p = keys ? atBox(validate(EXAMPLES.refit), keys) : validate(EXAMPLES.refit);
  assert.ok(p.reframe, 'refit plays a box timeline');
  const solved = solve(p, p.seed, params);
  const radius = new Map();
  const landed = new Map();
  const grown = new Map();
  for (const th of solved.state.things) { th.fill = 'id' + th.i; radius.set(th.fill, th.r); landed.set(th.fill, th.landed); if (th.grows) grown.set(th.fill, th.born); }
  const growing = (id, f) => grown.has(id) && f < grown.get(id) + 5;
  const frames = playheads(p).map((t) => {
    const at = new Map();
    let last = null;
    let scale = 1;
    const g = new Proxy({}, {
      get: (o, k) => (k in o ? o[k] : k === 'translate' ? (x, y) => { last = { x, y }; } : k === 'scale' ? (s) => { scale = s; } : () => {}),
      set: (o, k, v) => {
        if (k === 'fillStyle' && String(v).startsWith('id') && last) { at.set(v, { ...last, scale }); last = null; scale = 1; }
        o[k] = v;
        return true;
      },
    });
    drawFrame(g, p, solved, t);
    const box = clockAt(p, t).box;
    return { t, at, box: { ...box, left: box.x + 40, right: box.x + box.w - 40, rim: box.y + 100, floor: box.y + box.h - 76 } };
  });
  // The things drawn whole in the container at frame f.
  const held = (f) => [...frames[f].at].filter(([, q]) => q.scale === 1 && q.y >= frames[f].box.rim).map(([id]) => id);
  return { p, solved, radius, landed, grown, growing, frames, held, frame: (t) => Math.round(t * (frames.length - 1)) };
}

/**
 * Along a box timeline every thing stays inside the walls of the moment, once
 * landed never stands with its centre over the rim, and travels between
 * frames: it comes in falling from above the frame in the first fill, or
 * after it appears growing whole inside the container, and leaves only by
 * shrinking away where the walls squeezed it over the rim, having landed
 * first and touching what reaches the floor or a wall, never in mid-air;
 * and the rain stops in
 * time to land before the walls close, so nothing is in the air when they
 * move.
 */
function refitTravels(keys, params) {
  const drawn = refitFrames(keys, params);
  const { solved, radius, landed, growing, frames } = drawn;
  const widest = Math.max(...radius.values());
  // Whether thing `id`'s contact reaches the floor or a wall at frame f, as
  // the solve has them: it is under 2 from one, or from a thing that is, and
  // so on, chained through every thing there at that frame, a thing taken
  // that frame included, one taken before not. A wall is touched only where
  // it is drawn, from the floor to 14 over the rim: above that a thing
  // beside the wall line is in the air. Two things flung up together touch
  // each other and nothing else, so neither is grounded.
  const { things, frames: solvedFrames } = solved.state;
  const index = new Map(things.map((th, k) => [th.fill, k]));
  const groundedSets = new Map();
  const grounded = (id, f) => {
    if (!groundedSets.has(f)) {
      const { box } = frames[f];
      const fr = solvedFrames[f];
      const present = things.map((th, k) => k).filter((k) => !Number.isNaN(fr[3 * k + 1]));
      const set = new Set(present.filter((k) => {
        const r = things[k].r;
        const up = Math.max(0, box.rim - 14 - fr[3 * k + 1]);
        return Math.min(box.floor - fr[3 * k + 1] - r, Math.hypot(fr[3 * k] - box.left, up) - r, Math.hypot(box.right - fr[3 * k], up) - r) < 2;
      }));
      const stack = [...set];
      while (stack.length) {
        const k = stack.pop();
        for (const j of present) if (!set.has(j) && Math.hypot(fr[3 * j] - fr[3 * k], fr[3 * j + 1] - fr[3 * k + 1]) - things[k].r - things[j].r < 2) { set.add(j); stack.push(j); }
      }
      groundedSets.set(f, set);
    }
    return groundedSets.get(f).has(index.get(id));
  };
  for (const [f, { t, at, box }] of frames.entries()) {
    for (const [id, { x, y, scale }] of at) {
      // A thing growing in or shrinking away is drawn at its scale, from
      // its contact: its drawn disc is what stays inside the walls.
      const r = radius.get(id) * scale;
      // The walls are lines that move with the box: a thing the pile presses
      // against one sits a hair into it. A thing shrinking away goes from
      // the top of the pile, within two of the widest things of the rim,
      // and is drawn touching its lowest contact, the floor, a wall or a
      // thing's drawn disc, kept inside the walls and the box as they go
      // on moving; it had landed by the frame it went, never falling in
      // through the air, alone, beside another falling thing, beside a wall
      // or bouncing off the pile, unless the bounce flings it up out of the
      // frame, where it goes as it leaves; and it goes touching what reaches
      // the floor or a wall, never in mid-air: a landed thing a squeeze
      // flings up, alone or with others it touches, flies on, whole, until
      // it touches the pile or a wall again.
      if (scale < 1 && !growing(id, f)) {
        assert.ok(y - r < box.rim + 88, `${id} vanishes at y ${y} at t ${t}, deep in the pile, not squeezed out at its top`);
        // Taken inside the box, it stays inside the box as the top comes
        // down; taken above it, flung out, it stays where it was taken.
        // Which it was is where the solve took it, whole.
        const g = things[index.get(id)].gone;
        const inside = solvedFrames[g][3 * index.get(id) + 1] - radius.get(id) >= frames[g].box.y;
        if (inside) assert.ok(y - r >= box.y - 2, `${id} shrinks away at y ${y} at t ${t}, above its box's top at ${box.y}`);
        // It shrinks from its lowest contact, so on every frame it shrinks
        // its drawn disc touches, within 2, the floor, a wall where it is
        // drawn, a drawn thing, whole or itself shrinking, or the box's top
        // that came down on it: it never floats off what held it. One the
        // solve took above the frame shrinks out of sight.
        // What it shrinks from, recorded as `from`, is of what it touched
        // within 2 as it went the one whose contact point is lowest: the
        // floor (-1), a wall where it is drawn, level with its centre or at
        // its lip for one over the lip (-2 left, -3 right), or a thing;
        // another it touched is taken only when that lowest is a thing
        // going on the same frame that shrinks, directly or through others,
        // from it, so that following `from` from thing to thing never leads
        // back to it: two that go together never each shrink from the
        // other, tied to nothing else.
        const k = index.get(id);
        const tied = (o) => {
          for (let c = things[o].from, n = 0; c >= 0 && n < things.length; c = things[c].from, n++) if (c === k) return true;
          return false;
        };
        if (f === g && grounded(id, g)) {
          const fr = solvedFrames[g];
          const [wx, wy, wr] = [fr[3 * k], fr[3 * k + 1], radius.get(id)];
          const lip = Math.max(0, frames[g].box.rim - 14 - wy);
          const contacts = [[-1, frames[g].box.floor - wy - wr, wy + wr], [-2, Math.hypot(wx - frames[g].box.left, lip) - wr, wy + lip], [-3, Math.hypot(frames[g].box.right - wx, lip) - wr, wy + lip]];
          things.forEach((o, j) => {
            const d = Math.hypot(fr[3 * j] - wx, fr[3 * j + 1] - wy);
            if (j !== k && !Number.isNaN(fr[3 * j])) contacts.push([j, d - wr - o.r, wy + wr * (fr[3 * j + 1] - wy) / d]);
          });
          const touching = contacts.filter(([, gap]) => gap < 2);
          const lowest = touching.reduce((m, c) => (c[2] > m[2] ? c : m), [undefined, 0, -Infinity]);
          if (lowest[0] >= 0 && tied(lowest[0])) assert.ok(touching.some(([j]) => j === things[k].from), `${id} goes at t ${t} shrinking from ${things[k].from}, which it does not touch`);
          else assert.equal(things[k].from, lowest[0], `${id} goes at t ${t} shrinking from ${things[k].from}, not from its lowest contact ${lowest[0]}, which does not shrink from it`);
          assert.ok(!(things[k].from >= 0) || !tied(things[k].from), `${id} goes at t ${t} shrinking from ${things[k].from}, which shrinks from it in turn`);
        }
        if (solvedFrames[g][3 * index.get(id) + 1] + radius.get(id) >= 0) {
          const up = Math.max(0, box.rim - 14 - y);
          let touch = Math.min(box.floor - y - r, Math.hypot(x - box.left, up) - r, Math.hypot(box.right - x, up) - r, inside ? y - r - box.y : Infinity);
          // A thing that shrinks from it, directly or through others, is
          // placed by it, so touching one does not hold it.
          for (const [o, q] of at) if (o !== id && !(things[index.get(o)].gone <= f && tied(index.get(o))))touch = Math.min(touch, Math.hypot(q.x - x, q.y - y) - r - radius.get(o) * q.scale);
          assert.ok(touch < 2, `${id} shrinks away ${f - g} frames after it goes at ${x.toFixed(1)}, ${y.toFixed(1)} at t ${t}, ${touch.toFixed(1)} from everything drawn: it floats off what held it`);
        }
        if (f && frames[f - 1].at.get(id)?.scale === 1) {
          assert.ok(landed.get(id) <= f || y + r < 0, `${id} vanishes in mid-air at ${x}, ${y} at t ${t}, never having landed`);
          if (y + r >= 0) assert.ok(grounded(id, f), `${id} vanishes in mid-air at ${x}, ${y} at t ${t}, touching nothing that reaches the floor or a wall`);
        }
      }
      assert.ok(x - r >= box.left - 2 && x + r <= box.right + 2 && y + r <= box.floor + 2, `${id} is outside the walls at t ${t}`);
      if (scale === 1 && landed.get(id) <= f && y < box.rim) assert.ok(!grounded(id, f), `${id} landed at frame ${landed.get(id)} and stands at y ${y}, over the rim at ${box.rim}, at t ${t}, touching what reaches the floor or a wall`);
    }
    if (!f) continue;
    const before = frames[f - 1].at;
    for (const [id, q] of at) {
      const o = before.get(id);
      if (!o && growing(id, f)) { assert.ok(q.y - radius.get(id) >= box.rim - 1e-9 && q.scale < 0.2, `${id} appears at y ${q.y} at scale ${q.scale} at t ${t}, not growing from nothing under the rim`); continue; }
      if (!o) { assert.ok(q.y - radius.get(id) < 80, `${id} appears at y ${q.y} at t ${t}, not from above the frame`); continue; }
      // A fast squeeze pops a thing up by about a widest thing and a half
      // in one frame, never further.
      assert.ok(Math.abs(q.x - o.x) <= 2 * widest && Math.hypot(q.x - o.x, q.y - o.y) <= 3 * widest, `${id} jumps from ${o.x}, ${o.y} to ${q.x}, ${q.y} at t ${t}`);
    }
    for (const [id, o] of before) {
      if (!at.has(id)) assert.ok(o.scale < 1, `${id} is cut out at t ${t} instead of shrinking away`);
    }
  }
  // The rain stops in time for its last drop to land before the walls
  // close, and no more than two seconds and a third before, the margin a
  // fall through the tallest box takes: at every frame on which the box
  // narrows, every thing released has landed.
  const narrowing = frames.map(({ box }, f) => f > 0 && (box.w < frames[f - 1].box.w || box.h < frames[f - 1].box.h));
  for (const [f, narrows] of narrowing.entries()) {
    if (!narrows) continue;
    const released = solved.state.things.filter((th) => th.born < f);
    const air = released.filter((th) => th.landed >= f);
    assert.equal(air.length, 0, `${air.length} of the ${released.length} things released are still in the air at t ${frames[f].t}, as the box narrows: ${air.slice(0, 5).map((th) => `${th.fill} released at frame ${th.born}`).join(', ')}`);
    if (!narrowing[f - 1] && released.length) assert.ok(Math.max(...released.map((th) => th.born)) >= f - 70, `the rain stops at frame ${Math.max(...released.map((th) => th.born))}, long before the box narrows at ${f}`);
  }
  return drawn;
}

test('refit: along its box timeline every thing stays inside the walls, falls in from above and leaves only by vanishing over the rim', () => {
  refitTravels();
});

test('refit: at its strongest grip, where the pile heaps, nothing rests over the rim along its box timeline', () => {
  refitTravels(null, { grip: 1.2 });
});

test('refit: at every corner of its params, the smallest and the biggest things at the loosest and the strongest grip, every thing stays inside the walls, falls in from above and leaves only by vanishing over the rim along its box timeline', () => {
  // The smallest things at no grip rain in densest and roll furthest
  // beside the closing walls, where a thing falling in touches a wall above
  // the rim without standing on anything.
  for (const grain of [0.6, 1.6]) for (const grip of [0, 1.2]) refitTravels(null, { grain, grip });
});

test('refit: a box that widens while the container is still filling loses nothing, keeps taking things and ends as full as a box of that size', () => {
  const { atBox } = require('../core/piece.js');
  const p = validate(EXAMPLES.refit);
  const keys = [{ t: 0, w: 405, h: 720 }, { t: 0.1, w: 405, h: 720 }, { t: 0.3, w: 1280, h: 720 }, { t: 1, w: 1280, h: 720 }];
  const { solved, frames } = refitTravels(keys);
  const last = frames.length - 1;
  const held = (f) => [...frames[f].at].filter(([, q]) => q.scale === 1 && q.y >= frames[f].box.rim).length;
  // Its first fill is not over until the box stands still and is full, so
  // it rains on after the box widens and nothing grows in place.
  const { things } = solved.state;
  const grew = things.filter((th) => th.grows).length;
  const stops = Math.round(0.3 * last);
  const rained = things.filter((th) => !th.grows && th.born > stops).length;
  assert.ok(grew === 0 && rained > 100, `widened while filling, ${grew} things grow in place and ${rained} rain in after the box stops`);
  // The box only grew, so nothing is squeezed out, and nothing falls in
  // only to vanish.
  const vanished = new Set();
  for (const { at } of frames) for (const [id, q] of at) if (q.scale < 1) vanished.add(id);
  assert.equal(vanished.size, 0, `${[...vanished].join(', ')} vanish while the box only grows`);
  const start = Math.round(0.1 * last);
  assert.ok(held(Math.round(0.3 * last)) > held(start) && held(last) > held(Math.round(0.3 * last)), `it holds ${held(start)}, ${held(Math.round(0.3 * last))} and ${held(last)} things as the box widens`);
  const plain = solve(atBox(p, { w: 1280, h: 720 })).state;
  const alone = refitHeld(plain, plain.frames.length - 1).length;
  assert.ok(Math.abs(held(last) - alone) <= 0.25 * alone, `widened while filling it holds ${held(last)} things, filled at that size ${alone}`);
});

test('refit: the first fill is over the first time a still box is full, even while its last drops still fall: a box that then widens releases nothing more, and nothing grows until they have landed', () => {
  // A tall narrow box is full within its first second, counting the things
  // still falling into it, and widens while they fall, then stands still
  // and widens again; and a wide box whose rain is cut short by a narrowing
  // fills on once the walls stop, is full with its last drops in the air,
  // and widens while they fall.
  const twice = [{ t: 0, w: 405, h: 1080 }, { t: 0.1, w: 405, h: 1080 }, { t: 0.3, w: 1280, h: 1080 }, { t: 0.6, w: 1280, h: 1080 }, { t: 0.8, w: 1920, h: 1080 }, { t: 1, w: 1920, h: 1080 }];
  const cut = [{ t: 0, w: 1280, h: 720 }, { t: 0.3, w: 1280, h: 720 }, { t: 0.4, w: 600, h: 720 }, { t: 0.46, w: 600, h: 720 }, { t: 0.66, w: 1280, h: 720 }, { t: 1, w: 1280, h: 720 }];
  for (const [keys, params, label] of [[twice, { grain: 1.3 }, 'widened twice'], [cut, undefined, 'cut short, then widened']]) {
    const { solved, frames } = refitTravels(keys, params);
    const { things, frames: at } = solved.state;
    const widens = frames.findIndex(({ box }, f) => f > 0 && (box.w > frames[f - 1].box.w || box.h > frames[f - 1].box.h));
    const rained = things.filter((th) => !th.grows);
    const landed = Math.max(...rained.map((th) => th.landed));
    assert.ok(landed >= widens && landed < Infinity, `${label}: the rain has landed by frame ${landed}, before the box widens at ${widens}: the timeline misses the case`);
    const late = rained.filter((th) => th.born >= widens);
    assert.equal(late.length, 0, `${label}: ${late.length} things are released from frame ${late[0]?.born} on, after the box widens at ${widens}`);
    const grown = things.map((th, k) => ({ th, k })).filter(({ th }) => th.grows);
    const early = grown.filter(({ th }) => th.born <= landed);
    assert.ok(grown.length > 100 && early.length === 0, `${label}: ${early.length} of the ${grown.length} things that grow in come before the rain has landed at frame ${landed}, the first at frame ${early[0]?.th.born}`);
    // Each comes clear of every thing there.
    for (const { th, k } of grown) {
      const f = th.born;
      for (let j = 0; j < things.length; j++) {
        if (j === k || 3 * j >= at[f].length || Number.isNaN(at[f][3 * j])) continue;
        const gap = Math.hypot(at[f][3 * j] - at[f][3 * k], at[f][3 * j + 1] - at[f][3 * k + 1]) - th.r - things[j].r;
        assert.ok(gap > -2, `${label}: thing ${th.i} comes into thing ${things[j].i} by ${(-gap).toFixed(1)} at frame ${f}`);
      }
    }
  }
});

test('refit: a channel barely wider than its biggest things counts its falling train by area, so a tall narrow box widened to the largest, its first fill declared full with every drop still in the air, lands within one small release of the rim', () => {
  // A tall narrow box held still, then widened to the largest box, scales
  // its things for the largest: the column, 325 wide, is barely wider than
  // its biggest things, 261 wide. Each falling thing covers more columns
  // than its own width; counted whole over every one of them, as a wide
  // box counts it, the train declared the column full with 20 drops in the
  // air, which landed a fifth of the column under the rim, 292 units of
  // 1744. Counted by its area, the drops land within the room a release of
  // one of the smallest fourth needs, its height and 16, under the rim.
  const { atBox } = require('../core/piece.js');
  const p = validate(EXAMPLES.refit);
  const keys = [{ t: 0, w: 405, h: 1920 }, { t: 0.3, w: 405, h: 1920 }, { t: 0.6, w: 1920, h: 1920 }, { t: 1, w: 1920, h: 1920 }];
  const s = solve(atBox(p, keys), p.seed).state;
  const moves = Math.round(0.3 * (s.frames.length - 1)) + 1;
  const rained = s.things.map((th, k) => ({ th, k })).filter(({ th }) => !th.grows);
  const released = Math.max(...rained.map(({ th }) => th.born));
  const landed = Math.max(...rained.map(({ th }) => th.landed));
  const first = Math.min(...rained.map(({ th }) => th.landed));
  assert.ok(released < first && landed < moves, `the rain is released by frame ${released}, lands from ${first} to ${landed}, and the box moves at ${moves}: the timeline misses the case`);
  const before = s.frames[landed];
  const top = Math.min(...rained.map(({ th, k }) => before[3 * k + 1] - th.r));
  // The box is as tall as the frame, so its rim stands 100 under the top.
  const rim = 100;
  const small = 14 * refitScale({ w: 1920, h: 1920 });
  assert.ok(top - rim < 2 * small + 16, `the column's ${rained.length} drops land with their top ${(top - rim).toFixed(0)} under the rim of 1744, room for one more ${(2 * small + 16).toFixed(0)} high`);
  refitLoses(s, refitHeld(s, s.frames.length - 1), 'the tall narrow box widened to the largest');
});

test('refit: a narrow still box of things that grip hard counts its falling train whole, since they heap up its walls, so nothing lands over the rim', () => {
  // Counted by area at the strongest grip, each of these fills landed one
  // to three of its last drops over the rim.
  const { atBox } = require('../core/piece.js');
  const p = validate(EXAMPLES.refit);
  for (const [w, h, grain] of [[480, 1920, 1.6], [520, 1920, 1.6], [320, 1200, 1.3], [240, 1920, 1.3]]) {
    const s = solve(atBox(p, { w, h }), p.seed, { grain, grip: 1.2 }).state;
    refitLoses(s, refitHeld(s, s.frames.length - 1), `${w} x ${h} at grain ${grain} and grip 1.2`);
  }
});

test('refit: the container fills once; a narrower box only rearranges the pile and loses what is squeezed out, a wider one relaxes it and takes more', () => {
  const { p, frames, held, growing, frame } = refitFrames();
  const [, wide, narrow, hold] = p.reframe.map((k) => frame(k.t));
  const last = frames.length - 1;
  const ids = (f) => new Set(held(f));
  // The opening fill: nothing vanishes before the box first moves.
  for (let f = 0; f <= wide; f++) for (const [id, q] of frames[f].at) assert.equal(q.scale, 1, `${id} vanishes at t ${frames[f].t}, before the box moves`);
  // Narrowing: what the portrait box holds was in the wide pile, nothing
  // fell in meanwhile, over half of the wide pile was squeezed out, and the
  // pile was never emptied on the way.
  const atWide = ids(wide);
  const atNarrow = ids(narrow);
  assert.ok(atWide.size > 2 * atNarrow.size, `the wide box holds ${atWide.size} and the portrait box ${atNarrow.size}`);
  let gone = 0;
  for (let f = wide + 1; f <= narrow; f++) {
    gone += [...frames[f].at].filter(([id, q]) => q.scale < 1 && frames[f - 1].at.get(id)?.scale === 1).length;
    assert.ok(ids(f).size >= 0.85 * atNarrow.size, `the container drops to ${ids(f).size} things at t ${frames[f].t}, emptied rather than rearranged`);
  }
  assert.ok(gone > 0.45 * atWide.size, `only ${gone} of the wide box's ${atWide.size} things were squeezed out`);
  const kept = [...atNarrow].filter((id) => atWide.has(id)).length;
  assert.ok(kept > 0.8 * atNarrow.size, `the portrait pile keeps only ${kept} of the wide pile's things`);
  // Widening: nothing leaves, and new things grow in until the end.
  const atHold = ids(hold);
  const atEnd = ids(last);
  for (let f = hold + 1; f <= last; f++) for (const [id, q] of frames[f].at) if (!growing(id, f)) assert.equal(q.scale, 1, `${id} vanishes at t ${frames[f].t} while the box widens`);
  const fresh = [...atEnd].filter((id) => !atHold.has(id)).length;
  assert.ok(fresh > 20 && atEnd.size > atHold.size, `${fresh} things arrived as the box widened, ${atHold.size} to ${atEnd.size}`);
  for (let f = last - 29; f <= last; f++) {
    const moved = [...frames[f].at].some(([id, q]) => { const o = frames[f - 1].at.get(id); return o && Math.abs(q.y - o.y) > 1; });
    assert.ok(moved, `nothing moves at t ${frames[f].t}: the film goes still before its end`);
  }
});

// The growth timelines. Its own film widens from portrait to square after
// the fill, at its own grain and at a coarser one; a portrait box that fills
// and then widens to the default box opens far more room; a square box that
// grows both wider and taller, fast, opens floor while the floor descends,
// so things are born on a floor that moves; a tall narrow box that widens to
// the largest box slumps its column into a heap that keeps flowing to the
// end of the film, so things grow on a pile that moves; and a box that
// widens, narrows and then holds still squeezes the heap its widening
// filled, and fills what the squeeze leaves open.
const REFIT_GROWTH = {
  own: [null, undefined, 'its own film'],
  coarse: [null, { grain: 1.3 }, 'its own film at grain 1.3'],
  widen: [[{ t: 0, w: 405, h: 720 }, { t: 0.3, w: 405, h: 720 }, { t: 0.5, w: 1280, h: 720 }, { t: 1, w: 1280, h: 720 }], undefined, 'portrait to wide'],
  taller: [[{ t: 0, w: 720, h: 720 }, { t: 0.35, w: 720, h: 720 }, { t: 0.47, w: 1920, h: 1080 }, { t: 1, w: 1920, h: 1080 }], undefined, 'square to wide and taller'],
  tall: [[{ t: 0, w: 405, h: 1920 }, { t: 0.3, w: 405, h: 1920 }, { t: 0.6, w: 1920, h: 1920 }, { t: 1, w: 1920, h: 1920 }], undefined, 'tall narrow to largest'],
  squeeze: [[{ t: 0, w: 405, h: 720 }, { t: 0.3, w: 405, h: 720 }, { t: 0.45, w: 1280, h: 720 }, { t: 0.55, w: 720, h: 720 }, { t: 1, w: 720, h: 720 }], undefined, 'widened, narrowed and held'],
};

// How many things refit holds at the end of a still box w by h, filled at
// that size from the start, and their area, solved once per box and params
// for every growth test that ends there.
const refitAlone = new Map();
function refitHeldAlone(w, h, params) {
  const key = JSON.stringify([w, h, params]);
  if (!refitAlone.has(key)) {
    const { atBox } = require('../core/piece.js');
    const p = validate(EXAMPLES.refit);
    const plain = solve(atBox(p, { w, h }), p.seed, params).state;
    const held = refitHeld(plain, plain.frames.length - 1);
    refitAlone.set(key, { count: held.length, area: held.reduce((sum, th) => sum + Math.PI * th.r ** 2, 0) });
  }
  return refitAlone.get(key);
}

/**
 * After the first fill nothing falls in again along growth timeline `name`:
 * a box that widens fills its new room with the next things, each appearing
 * where it rests, clear of the rest, and growing from nothing there.
 */
function refitGrowth(name) {
  const p = validate(EXAMPLES.refit);
  const [keys, params, label] = REFIT_GROWTH[name];
  {
    const { solved, frames, growing, radius } = refitTravels(keys, params);
    const { things, frames: at } = solved.state;
    // The first fill is over before the box first moves.
    const moves = frames.findIndex(({ box }, f) => f > 0 && (box.w !== frames[f - 1].box.w || box.h !== frames[f - 1].box.h));
    assert.ok(Math.max(...things.filter((th) => th.born < moves).map((th) => th.born)) < moves - 10, `${label}: the first fill is still raining when the box moves at frame ${moves}`);
    const late = things.map((th, k) => ({ th, k })).filter(({ th }) => th.born > moves);
    assert.ok(late.length > (keys ? 80 : 40), `${label}: ${late.length} things come after the first fill`);
    const drops = [];
    let onMovingFloor = 0;
    for (const { th, k } of late) {
      const { box } = frames[th.born];
      assert.ok(at[th.born][3 * k + 1] - th.r >= box.rim - 1, `${label}: thing ${th.i} comes at y ${at[th.born][3 * k + 1].toFixed(1)} at frame ${th.born}, not whole under the rim at ${box.rim}`);
      // Over the five frames it grows, how far it sinks below the things
      // under it as it comes, whichever of them sinks most, or below the
      // floor it comes on, which descends while the box grows taller: it
      // moves with the pile it rests on, as the pile slumps, and does not
      // roll off it. A thing against a wall is held by the holder it
      // records there whether that holder's centre is below its own or
      // above: `spot` puts a wall-held thing's centre above its holder's,
      // so the holder counts here only when the birth frame's sim step
      // lifts it, which none of these timelines does; the clause guards
      // the measure, and changes no drop on them.
      const x0 = at[th.born][3 * k];
      const y0 = at[th.born][3 * k + 1];
      const end = Math.min(th.born + 5, frames.length - 1);
      const floor0 = frames[th.born].box.floor;
      const onFloor = Math.abs(y0 + th.r - floor0) < 2;
      const onWall = x0 - th.r - box.left < 2 || box.right - x0 - th.r < 2;
      if (onFloor && floor0 !== frames[th.born - 1].box.floor) onMovingFloor++;
      let under = onFloor ? frames[end].box.floor - floor0 : -Infinity;
      for (let j = 0; j < things.length; j++) {
        if (j === k || 3 * j >= at[th.born].length || Number.isNaN(at[th.born][3 * j]) || Number.isNaN(at[end][3 * j]) || (at[th.born][3 * j + 1] <= y0 && !(onWall && th.on?.includes(j)))) continue;
        if (Math.hypot(at[th.born][3 * j] - at[th.born][3 * k], at[th.born][3 * j + 1] - y0) - th.r - things[j].r < 2) under = Math.max(under, at[end][3 * j + 1] - at[th.born][3 * j + 1]);
      }
      const drop = at[end][3 * k + 1] - y0 - (under === -Infinity ? 0 : under);
      // A slumping pile is chaotic, so a thing that appears on it may
      // settle too, but never as far as a fall.
      assert.ok(drop < 20, `${label}: thing ${th.i}, come at frame ${th.born}, sinks ${drop.toFixed(1)} below what it rests on while it grows`);
      drops.push(drop);
      // It comes clear of every other thing there, and, while it grows,
      // touches the floor, a wall or a thing on every frame.
      for (let f = th.born; f < Math.min(th.born + 6, frames.length); f++) {
        const x = at[f][3 * k];
        const y = at[f][3 * k + 1];
        const b = frames[f].box;
        let touch = Math.min(b.floor - y - th.r, x - th.r - b.left, b.right - x - th.r);
        for (let j = 0; j < things.length; j++) {
          if (j === k || 3 * j >= at[f].length || Number.isNaN(at[f][3 * j])) continue;
          const gap = Math.hypot(at[f][3 * j] - x, at[f][3 * j + 1] - y) - th.r - things[j].r;
          if (f === th.born) assert.ok(gap > -2, `${label}: thing ${th.i} comes into thing ${things[j].i} by ${(-gap).toFixed(1)} at frame ${f}`);
          touch = Math.min(touch, gap);
        }
        assert.ok(touch < 2, `${label}: thing ${th.i}, come at frame ${th.born}, stands ${touch.toFixed(1)} from everything at frame ${f}, in the air`);
      }
      // It grows from nothing to its size over five frames. It records
      // what holds it, things that were there before it, none for a floor
      // place, whose neighbour only stands beside it. One on the floor
      // grows up from its lowest point, so it stands on the floor at every
      // size. One held by things grows from its contact with the last-born
      // of them not shrinking away, whole or itself still growing, measured
      // here on its own as the drawn gap between the two drawn discs: in
      // every frame it grows, it stands as far from that holder as its
      // whole disc stands from it whole, within a unit. No timeline stops
      // that growth short, and a stop would fail here. It is never nearer
      // any holder than whole, never into anything drawn, and never
      // through the floor. So
      // it neither hangs over a holder drawn small, nor over the gap of a
      // cradle, nor sinks into what holds it.
      assert.ok(Array.isArray(th.on) && th.on.every((j) => j < k && things[j].born < th.born), `${label}: thing ${th.i} records ${th.on ? th.on.map((j) => things[j].i).join(', ') : 'nothing'} as what holds it`);
      assert.ok(onFloor || th.on.length, `${label}: thing ${th.i} comes at frame ${th.born} on nothing, off the floor`);
      const drawn = frames.slice(th.born, th.born + 6).map((q) => q.at.get('id' + th.i));
      drawn.forEach((q, n) => {
        const f = th.born + n;
        assert.ok(Math.abs(q.scale - Math.min(1, (n + 1) / 6)) < 1e-9, `${label}: thing ${th.i} is drawn at scale ${q.scale} ${n} frames after it comes`);
        const me = { x: q.x, y: q.y, r: th.r * q.scale };
        const plain = { x: at[f][3 * k], y: at[f][3 * k + 1] + th.r * (1 - q.scale) };
        if (!th.on.length) assert.ok(Math.abs(me.x - plain.x) < 1e-6 && Math.abs(me.y - plain.y) < 1e-6, `${label}: thing ${th.i}, on the floor, is drawn ${n} frames after it comes at ${me.x.toFixed(1)}, ${me.y.toFixed(1)}, not up from its lowest point at ${plain.x.toFixed(1)}, ${plain.y.toFixed(1)}`);
        const gapTo = (id, o) => Math.hypot(o.x - me.x, o.y - me.y) - me.r - radius.get(id) * o.scale;
        const holders = th.on.map((j) => {
          const id = 'id' + things[j].i;
          const o = frames[f].at.get(id);
          const whole = Math.hypot(at[f][3 * j] - at[f][3 * k], at[f][3 * j + 1] - at[f][3 * k + 1]) - th.r - things[j].r;
          return { i: things[j].i, gap: gapTo(id, o), over: gapTo(id, o) - whole, grows: growing(id, f), gone: things[j].gone <= f };
        });
        for (const h of holders) assert.ok(h.over > -1e-6, `${label}: thing ${th.i} is drawn ${n} frames after it comes ${(-h.over).toFixed(1)} nearer thing ${h.i} than it stands from it whole`);
        assert.ok(me.y + me.r <= frames[f].box.floor + 1e-6, `${label}: thing ${th.i} is drawn ${n} frames after it comes ${(me.y + me.r - frames[f].box.floor).toFixed(1)} through the floor`);
        let touch = frames[f].box.floor - me.y - me.r;
        for (const [id, o] of frames[f].at) {
          if (id === 'id' + th.i) continue;
          const gap = gapTo(id, o);
          assert.ok(gap > -1, `${label}: thing ${th.i} is drawn ${n} frames after it comes ${(-gap).toFixed(1)} into ${id}`);
          touch = Math.min(touch, gap);
        }
        if (q.scale >= 1 || !th.on.length) return;
        // It grows from its contact with the last-born of its holders not
        // shrinking away, whichever other holder it touches; with none left,
        // it grows alone and touches something drawn.
        const last = holders.filter((h) => !h.gone).at(-1);
        const rests = last ? Math.abs(last.over) < 1 : touch < 1;
        assert.ok(rests, `${label}: thing ${th.i} is drawn ${n} frames after it comes ${holders.map((h) => `${h.gap.toFixed(1)} from thing ${h.i}${h.grows ? ' (growing)' : ''}${h.gone ? ' (gone)' : ''}, ${h.over.toFixed(1)} farther than whole`).join(', ')}, ${touch.toFixed(1)} from everything drawn: not grown from its last-born holder`);
      });
    }
    // The box that grows taller has things born on the floor while it
    // descends: each starts with the floor's motion, so it stands on the
    // floor at every size, as the touch check above saw.
    if (name === 'taller') assert.ok(onMovingFloor >= 5, `${label}: only ${onMovingFloor} things are born on the floor while it descends: the timeline misses the case`);
    // Nine in ten stay within 2 units of what they rest on.
    const settled = drops.filter((d) => d < 2).length;
    assert.ok(settled >= 0.9 * drops.length, `${label}: only ${settled} of the ${drops.length} things that come after the first fill stay within 2 units of what they rest on`);
    // Its own film lands: the box widens into the square by 0.9 of the
    // film and holds it still over the last tenth, so the opened room fills
    // before the end. A film that widens until its last frame fails here.
    const last = frames.length - 1;
    if (!keys) {
      const end = frames[last].box;
      const from = Math.ceil(0.9 * last);
      const moved = frames.findIndex(({ box }, f) => f >= from && (box.w !== end.w || box.h !== end.h));
      assert.ok(moved < 0, `${label}: the box is ${frames[Math.max(moved, 0)].box.w}x${frames[Math.max(moved, 0)].box.h} at frame ${moved} of ${last}, not yet the ${end.w}x${end.h} it ends at: it does not hold still over the last tenth of the film`);
    }
    // The room fills, measured by the area of the whole things it holds,
    // since a count rewards a heap of small things: the widened box ends
    // holding at least nine tenths of the area one filled at its size holds,
    // on its own film (0.96 at grain 1, 1.09 at grain 1.3) as on the
    // timelines that stand still at the end (0.96 to 1.04); its own film
    // when it widened until its last frame ended with 0.86 at grain 1 and
    // 0.85 at grain 1.3. The tall column, which slumps into a heap that
    // keeps flowing, ended with 0.6 of it when a thing no place took was
    // passed over for good: its heap of small things stood half as high as
    // a fill at that size.
    const held = [...frames[last].at].filter(([, q]) => q.scale === 1 && q.y >= frames[last].box.rim);
    const area = held.reduce((sum, [id]) => sum + Math.PI * radius.get(id) ** 2, 0);
    const { w, h } = (keys || p.reframe).at(-1);
    const alone = refitHeldAlone(w, h, params);
    const bar = 0.9;
    assert.ok(area >= bar * alone.area, `${label}: it ends holding ${held.length} whole things over ${(area / alone.area).toFixed(2)} of the area of the ${alone.count} a box filled at that size holds, under ${bar}`);
  }
}

for (const name of Object.keys(REFIT_GROWTH)) {
  test(`refit: after the first fill nothing falls in again: a box that widens fills its new room with the next things, each appearing where it rests, clear of the rest, and growing from nothing there, ${REFIT_GROWTH[name][2]}`, () => refitGrowth(name));
}

test('refit: a thing shrinking off a thing still growing on a holder follows where that thing is drawn as it slides along its holder, so it never floats off it, and does not hold back the slide', () => {
  // No box timeline probed reaches this: the build passes over a place in
  // the path of a thing coming down on it. So the state is built by hand,
  // as the solve records it, and drawn as `draw` draws it: a holder on the
  // floor, a thing growing on it from frame 10, its whole disc touching
  // the holder at 40 degrees from upright, and a third thing resting on
  // the growing one, from above or from its side, that goes over the rim
  // at frame 11 shrinking from it, with a fourth on top of that one, going
  // with it and shrinking from it. The growing thing slides from where it
  // would grow alone, straight down from its whole place, to where its
  // drawn disc touches the holder, over the four frames it grows on after
  // that; each shrinking thing stays as far from the drawn disc it went
  // from as when it went, half a unit, on every one of them, the fourth
  // too, which shrinks from the growing thing only through the third.
  const r = { hold: 30, grow: 30, top: 20, cap: 12 };
  const tilt = (40 * Math.PI) / 180;
  const hold = { x: 600, y: 644 - r.hold };
  const grow = { x: hold.x + 60.5 * Math.sin(tilt), y: hold.y - 60.5 * Math.cos(tilt) };
  for (const side of [0, 60]) {
    const a = (side * Math.PI) / 180;
    const top = { x: grow.x + 50.5 * Math.sin(a), y: grow.y - 50.5 * Math.cos(a) };
    const cap = { x: top.x + 32.5 * Math.sin(a), y: top.y - 32.5 * Math.cos(a) };
    const frames = [];
    for (let f = 0; f < 20; f++) {
      const at = new Float64Array(12).fill(NaN);
      at.set([hold.x, hold.y, 0], 0);
      if (f >= 10) at.set([grow.x, grow.y, 0], 3);
      if (f <= 11) at.set([top.x, top.y, 0, cap.x, cap.y, 0], 6);
      frames.push(at);
    }
    const base = { kind: 0, spin: 0, landed: 0, slow: 0, near: true, born: 0, gone: Infinity };
    const s = {
      box: { w: 1280, h: 720 }, seed: 5, params: {}, frames,
      things: [
        { ...base, i: 0, r: r.hold, fill: 'id0' },
        { ...base, i: 1, r: r.grow, fill: 'id1', born: 10, landed: 10, grows: true, on: [0] },
        { ...base, i: 2, r: r.top, fill: 'id2', gone: 11, from: 1 },
        { ...base, i: 3, r: r.cap, fill: 'id3', gone: 11, from: 2 },
      ],
    };
    for (let f = 11; f < 15; f++) {
      const at = new Map();
      let last = null;
      let scale = 1;
      const g = new Proxy({}, {
        get: (o, k) => (k in o ? o[k] : k === 'translate' ? (x, y) => { last = { x, y }; } : k === 'scale' ? (q) => { scale = q; } : () => {}),
        set: (o, k, v) => {
          if (k === 'fillStyle' && String(v).startsWith('id') && last) { at.set(v, { ...last, scale }); last = null; scale = 1; }
          o[k] = v;
          return true;
        },
      });
      EXAMPLES.refit.draw(g, s, f / 30, { frame: f });
      const gap = (p, rp, q, rq) => Math.hypot(p.x - q.x, p.y - q.y) - rp * p.scale - rq * q.scale;
      const [h, m, t, c] = ['id0', 'id1', 'id2', 'id3'].map((id) => at.get(id));
      assert.ok(m.scale < 1 && t.scale < 1 && c.scale < 1, `at frame ${f} the middle thing is drawn at scale ${m.scale}, the top ones at ${t.scale} and ${c.scale}: the case is missed`);
      assert.ok(Math.abs(gap(m, r.grow, h, r.hold) - 0.5) < 1e-6, `the thing growing at frame ${f} is drawn ${gap(m, r.grow, h, r.hold).toFixed(2)} from its holder, not as far as whole: its slide was held back`);
      assert.ok(Math.abs(gap(t, r.top, m, r.grow) - 0.5) < 1e-6, `the thing shrinking off it from ${side} degrees at frame ${f} is drawn ${gap(t, r.top, m, r.grow).toFixed(2)} from its drawn disc, not as far as when it went: it floats off it`);
      assert.ok(Math.abs(gap(c, r.cap, t, r.top) - 0.5) < 1e-6, `the thing shrinking off that one from ${side} degrees at frame ${f} is drawn ${gap(c, r.cap, t, r.top).toFixed(2)} from its drawn disc, not as far as when it went: it does not go with it`);
    }
  }
});

test('refit: growth waits for a coming narrowing, as the rain does, so nothing born just before one is squeezed out while it grows and pops', () => {
  // A square box widens to the largest width after its fill, holds for a
  // frame and closes again in a fiftieth of the film, too fast for the
  // travel checks: a thing born in the last five frames of the widening
  // would be squeezed out while it grows, and the shrink that follows
  // starts from its full size, so it would pop. Growth stops five frames
  // before the walls move, and goes on once they stop.
  const { atBox, clockAt } = require('../core/piece.js');
  const { playheads } = require('../core/render.js');
  const p0 = validate(EXAMPLES.refit);
  const keys = [{ t: 0, w: 720, h: 720 }, { t: 0.3, w: 720, h: 720 }, { t: 0.5, w: 1920, h: 720 }, { t: 0.504, w: 1920, h: 720 }, { t: 0.524, w: 720, h: 720 }, { t: 1, w: 720, h: 720 }];
  const p = atBox(p0, keys);
  const { things } = solve(p, p0.seed).state;
  const boxes = playheads(p).map((t) => clockAt(p, t).box);
  const narrows = boxes.findIndex((b, f) => f > 0 && b.w < boxes[f - 1].w);
  const grown = things.filter((th) => th.grows);
  assert.ok(grown.length > 100 && grown.some((th) => th.born >= narrows - 20 && th.born < narrows) && grown.some((th) => th.born > narrows), `${grown.length} things grow in, the box narrowing from frame ${narrows}: the timeline misses the case`);
  for (const th of grown) {
    assert.ok(th.born + 5 < narrows || th.born > narrows, `thing ${th.i} is born at frame ${th.born}, within five frames of the narrowing at ${narrows}`);
    assert.ok(th.gone >= th.born + 5, `thing ${th.i}, born at frame ${th.born}, is squeezed out at frame ${th.gone}, before it is whole`);
  }
});

test('refit: a squeezed thing climbs over its neighbours to the nearest place that holds it, and a widened pile relaxes towards the walls that moved, keeping its order', () => {
  const { p, frames, held, frame } = refitFrames();
  const [, wide, narrow, hold] = p.reframe.map((k) => frame(k.t));
  const last = frames.length - 1;
  // The things held at both frames, each with where it stood at each.
  const kept = (a, b) => held(b).filter((id) => frames[a].at.has(id)).map((id) => ({ id, from: frames[a].at.get(id), to: frames[b].at.get(id) }));
  // How many pairs changed left-to-right order between the two frames.
  const shuffled = (list) => {
    let out = 0;
    for (const [m, a] of list.entries()) for (const b of list.slice(m + 1)) if (Math.sign(a.from.x - b.from.x) * Math.sign(a.to.x - b.to.x) < 0) out++;
    return out / (list.length * (list.length - 1) / 2);
  };
  // Narrowing: what stays climbs, and climbs to the nearest place, so the
  // pile keeps most of its order.
  const squeezed = kept(wide, narrow);
  const rose = squeezed.filter((q) => q.to.y < q.from.y - 1).length;
  assert.ok(squeezed.length > 40 && rose > 0.7 * squeezed.length, `${rose} of the ${squeezed.length} things kept through the squeeze climbed`);
  assert.ok(shuffled(squeezed) < 0.3, `the squeeze shuffles ${(100 * shuffled(squeezed)).toFixed(0)}% of its pairs`);
  // Widening: nothing climbs, the pile spreads towards both walls, which
  // both move, and keeps its order. A thing a moving wall carries rises a
  // unit or two as the pile beside it spreads, never a quarter of the
  // smallest thing.
  const relaxed = kept(hold, last);
  const climbed = relaxed.filter((q) => q.to.y < q.from.y - 3).length;
  assert.ok(relaxed.length > 40 && climbed < 0.05 * relaxed.length, `${climbed} of the ${relaxed.length} things kept through the widening climbed`);
  const xs = relaxed.map((q) => q.from.x).sort((a, b) => a - b);
  const left = relaxed.filter((q) => q.from.x < xs[Math.floor(xs.length / 3)]);
  const right = relaxed.filter((q) => q.from.x > xs[Math.floor(2 * xs.length / 3)]);
  const moved = (list, dir) => list.filter((q) => (q.to.x - q.from.x) * dir > 1).length;
  assert.ok(moved(left, -1) > 0.6 * left.length && moved(right, 1) > 0.6 * right.length, `${moved(left, -1)} of ${left.length} things on the left relax left and ${moved(right, 1)} of ${right.length} on the right relax right`);
  assert.ok(shuffled(relaxed) < 0.2, `the widening shuffles ${(100 * shuffled(relaxed)).toFixed(0)}% of its pairs`);
});

test('refit: a box that narrows fast midway through the rain stops the rain in time to land, and squeezes out only things that had landed', () => {
  // The walls close from wide to portrait in a twentieth of the film, with
  // the container half full: the rain stops while its last drop can still
  // land, the pile they heave up to the rim is all landed things, and what
  // they squeeze out had landed.
  const keys = [{ t: 0, w: 1280, h: 720 }, { t: 0.3, w: 1280, h: 720 }, { t: 0.37, w: 405, h: 720 }, { t: 1, w: 405, h: 720 }];
  const { frames } = refitTravels(keys);
  const vanished = new Set();
  for (const { at } of frames) for (const [id, q] of at) if (q.scale < 1) vanished.add(id);
  assert.ok(vanished.size > 10, `${vanished.size} things vanish in the squeeze`);
});

test('refit: a box that narrows while the container is still filling fills once, as full as a box of that size', () => {
  const { atBox } = require('../core/piece.js');
  const p = validate(EXAMPLES.refit);
  const keys = [{ t: 0, w: 1280, h: 720 }, { t: 0.1, w: 1280, h: 720 }, { t: 0.3, w: 405, h: 720 }, { t: 1, w: 405, h: 720 }];
  const { frames } = refitTravels(keys);
  const last = frames.length - 1;
  const held = [...frames[last].at].filter(([, q]) => q.scale === 1 && q.y >= frames[last].box.rim).length;
  const plain = solve(atBox(p, { w: 405, h: 720 })).state;
  const alone = refitHeld(plain, plain.frames.length - 1).length;
  assert.ok(Math.abs(held - alone) <= 0.25 * alone, `narrowed while filling it holds ${held} things, filled at that size ${alone}`);
  // The rain waits for the walls to stop, since nothing released before
  // could land in time, then fills the narrow box within a second and a
  // half, and takes nothing more after.
  for (let f = Math.round(0.5 * last); f < last; f++) assert.equal(frames[f].at.size, frames[f + 1].at.size, `a thing comes or goes at t ${frames[f].t}, after the box has settled`);
});

// The two cellular automata. Each check drives the piece's own build stage and
// compares it with an oracle written here, with different arithmetic, so a
// shared mistake cannot pass on both sides.

/** The build stage called `name` of a validated piece. */
const stageOf = (p, name) => p.build.find(([n]) => n === name)[1];

/** One elementary-CA step: neighbourhood (l, c, r) is the number 4l + 2c + r,
 *  and its outcome is that bit of the rule, least significant first. */
function wolframStep(row, rule, edge) {
  const n = row.length;
  const at = (i) => (i >= 0 && i < n ? row[i] : edge === 'wrap' ? row[(i + n) % n] : 0);
  return Array.from(row, (_, i) => Math.floor(rule / 2 ** (at(i - 1) * 4 + at(i) * 2 + at(i + 1))) % 2);
}

/** One Life-like step for a rule named like 'B3/S23'. */
function lifeStep(grid, cols, rows, name, edge) {
  const [, b, s] = /^B(\d*)\/S(\d*)$/.exec(name);
  const out = new Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let count = 0;
      for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) {
        let nx = x + dx;
        let ny = y + dy;
        if (edge === 'wrap') { nx = (nx + cols) % cols; ny = (ny + rows) % rows; } else if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        count += grid[ny * cols + nx];
      }
      out[y * cols + x] = (grid[y * cols + x] ? s : b).includes(String(count)) ? 1 : 0;
    }
  }
  return out;
}

test('automaton: rule 30 counts its neighbourhood bits in Wolfram order, checked by hand', () => {
  // Rule 30 is asymmetric, so a reversed bit order (4r + 2c + l) draws its
  // mirror, rule 86, and the rows below come out reflected. Rule 90 is
  // symmetric and could not tell the two apart.
  const p = validate(EXAMPLES.automaton);
  const run = (rule, first, edge = 'wrap') => {
    const s = { gens: first.length, edge, first: Uint8Array.from(first), params: { rule } };
    stageOf(p, 'run the rule')(s);
    return Array.from({ length: s.gens }, (_, g) => Array.from(s.rows.subarray(g * first.length, (g + 1) * first.length)).join(''));
  };
  const one = '000000010000000'.split('').map(Number);  // a single live cell at 7
  assert.deepEqual(run(30, one).slice(0, 4), [
    '000000010000000',
    '000000111000000',   // 001, 010 and 100 each give 1
    '000001100100000',   // 011 -> 1, 111 -> 0, 110 -> 0, 100 -> 1
    '000011011110000',
  ]);
  assert.deepEqual(run(90, one).slice(0, 4), [
    '000000010000000',
    '000000101000000',
    '000001000100000',
    '000010101010000',   // Pascal's triangle mod 2
  ]);
});

test('automaton: the edge is the declared one, a ring, and "dead" reaches no further than the row', () => {
  const p = validate(EXAMPLES.automaton);
  assert.equal(solve(p, p.seed).state.edge, 'wrap', 'automaton declares a ring');
  const step = (edge) => {
    const s = { gens: 2, edge, first: Uint8Array.from([1, 0, 0, 0, 0, 0]), params: { rule: 90 } };
    stageOf(p, 'run the rule')(s);
    return Array.from(s.rows.subarray(6)).join('');
  };
  // Rule 90 is left XOR right: a live first cell lights both its neighbours,
  // and on a ring the last cell is one of them.
  assert.equal(step('wrap'), '010001');
  assert.equal(step('dead'), '010000');
});

test('automaton: every generation follows from the one above it alone, never from one half-written', () => {
  // Updating the row in place reads a left neighbour that has already moved on,
  // and the history drifts from the rule after the first generation.
  const p = validate(EXAMPLES.automaton);
  for (const rule of [30, 90, 110, 184]) {
    for (const seed of [1, 30]) {
      const s = solve(p, seed, { rule }).state;
      const n = s.first.length;
      for (let g = 1; g < s.gens; g++) {
        assert.deepEqual(Array.from(s.rows.subarray(g * n, (g + 1) * n)),
          wolframStep(Array.from(s.rows.subarray((g - 1) * n, g * n)), rule, s.edge),
          `rule ${rule}, seed ${seed}: generation ${g} is not the rule applied to generation ${g - 1}`);
      }
    }
  }
});

test('growth: a blinker turns on B3/S23, and the edge is dead unless it wraps', () => {
  const p = validate(EXAMPLES.growth);
  const life = [...Array(5).keys()].find((r) => solve(p, 1, { rule: r }).state.rule === 'B3/S23');
  assert.notEqual(life, undefined, 'the rule table holds B3/S23');
  const run = (cells, edge, gens = 3) => {
    const s = { cols: 7, rows: 7, gens, edge, first: new Uint8Array(49), params: { rule: life } };
    for (const [x, y] of cells) s.first[y * 7 + x] = 1;
    stageOf(p, 'run the rule')(s);
    return Array.from({ length: gens }, (_, g) => Array.from(s.cells.subarray(g * 49, (g + 1) * 49))
      .flatMap((v, i) => (v ? [[i % 7, Math.floor(i / 7)]] : [])));
  };
  // In the open, the blinker turns and turns back: only a step that reads the
  // whole old generation does this.
  assert.deepEqual(run([[2, 3], [3, 3], [4, 3]], 'dead'), [
    [[2, 3], [3, 3], [4, 3]], [[3, 2], [3, 3], [3, 4]], [[2, 3], [3, 3], [4, 3]],
  ]);
  // Across the left edge it is whole only on a ring.
  assert.deepEqual(run([[6, 3], [0, 3], [1, 3]], 'wrap', 2)[1], [[0, 2], [0, 3], [0, 4]]);
  assert.deepEqual(run([[6, 3], [0, 3], [1, 3]], 'dead', 2)[1], []);
  assert.equal(solve(p, p.seed).state.edge, 'dead', 'growth declares a dead edge');
});

test('growth: every generation follows from the one before by its rule, and a living cell keeps its birth colour', () => {
  const p = validate(EXAMPLES.growth);
  for (const rule of [0, 1, 3]) {
    const s = solve(p, 5, { rule }).state;
    const n = s.cols * s.rows;
    let moved = 0;
    for (let g = 1; g < s.gens; g++) {
      const before = Array.from(s.cells.subarray((g - 1) * n, g * n));
      const now = Array.from(s.cells.subarray(g * n, (g + 1) * n));
      assert.deepEqual(now, lifeStep(before, s.cols, s.rows, s.rule, s.edge),
        `${s.rule}: generation ${g} is not the rule applied to generation ${g - 1}`);
      for (let i = 0; i < n; i++) {
        if (before[i] !== now[i]) moved++;
        if (before[i] && now[i]) assert.equal(s.mark[g * n + i], s.mark[(g - 1) * n + i], 'a living cell changed colour');
      }
    }
    assert.ok(moved > s.gens * 20, `${s.rule}: only ${moved} cell changes in the whole film`);
  }
});

test('contours: chaining collapses the segments into few pen-down paths', () => {
  // A plotter lifts between paths, and lifting is the slow, ugly part. Stated
  // as a RATIO the piece publishes, so it is measured rather than assumed.
  const p = validate(EXAMPLES.contours);
  const s = solve(p, p.seed).state;
  assert.ok(s.segments > 2000, `only ${s.segments} segments`);
  assert.ok(s.segments / s.penLifts > 20,
    `${s.segments} segments became ${s.penLifts} paths -- ${(s.segments / s.penLifts).toFixed(1)}x`);
  for (const pts of s.paths) assert.ok(pts.length >= 2, 'a path with fewer than two points is a pen lift and nothing else');
});

test('contours: adding a well does not move the wells that were already there', () => {
  // The argument for addressed randomness, made visible on a piece.
  const p = validate(EXAMPLES.contours);
  const four = solve(p, 2026, { wells: 4 }).state.wells;
  const six = solve(p, 2026, { wells: 6 }).state.wells;
  assert.deepEqual(six.slice(0, 4), four, 'the first four moved when a fifth was added');
});

test('partition: detail falls away from the focus rather than filling the sheet', () => {
  // Everything receiving the same algorithmic attention is the most common
  // generative tell there is.
  const p = validate(EXAMPLES.partition);
  for (const seed of [11, 1, 2, 3, 4, 5, 6, 7, 8]) {
    const s = solve(p, seed).state;
    assert.ok(s.cells.length > 30, `seed ${seed} subdivided into only ${s.cells.length} cells`);
    // Thirds of the piece's own attention gradient, so the bands are never
    // empty for a seed that happened to put its focus near the middle.
    const rank = [...s.cells].sort((a, b) => b.want - a.want);
    const third = Math.floor(rank.length / 3);
    const near = rank.slice(0, third);
    const far = rank.slice(-third);
    assert.ok(near.length && far.length, `seed ${seed} has no range of attention`);
    // AREA, not depth. Depth saturates at the declared maximum, so a piece that
    // subdivided uniformly to the cap would pass a depth check while looking
    // exactly like the thing this test exists to forbid.
    const area = (set) => set.reduce((a, c) => a + c.w * c.h, 0) / set.length;
    const an = area(near);
    const af = area(far);
    assert.ok(af > an * 1.8,
      `seed ${seed}: mean cell ${an.toFixed(0)} sq near the focus vs ${af.toFixed(0)} away from it`);
  }
});

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

// Capture the unrounded design-space circles as well as the regular recorder
// output. A background bounding box alone cannot prove detail is preserved.
function inversionCircles(seed, gap, scale = 1) {
  const p = validate(EXAMPLES.inversion);
  const solved = solve(p, seed, { gap });
  assert.equal(solved.stages.error, null);
  const g = new Recorder();
  const circles = [];
  const arc = g.arc.bind(g);
  g.arc = (x, y, radius, start, end) => {
    assert.ok([x, y, radius].every(Number.isFinite) && radius > 0);
    circles.push({ x, y, r: radius });
    arc(x, y, radius, start, end);
  };
  drawFrame(g, p, solved, 0, { scale });
  return { circles, solved, g };
}

test('inversion: reflected circles agree with independently inverted boundary points', () => {
  for (const gap of [0.02, 0.10, 0.42]) {
    const { circles, solved } = inversionCircles(19, gap);
    const [source, mirror] = solved.state.mirrors;
    // The first DFS edge reflects mirror zero in mirror one. Check boundary
    // points against the result, rather than copying the circle formula here.
    assert.deepEqual(circles[0], source);
    const image = circles[1];
    for (let i = 0; i < 16; i++) {
      const angle = i * Math.PI / 8;
      const x = source.x + source.r * Math.cos(angle) - mirror.x;
      const y = source.y + source.r * Math.sin(angle) - mirror.y;
      const factor = mirror.r ** 2 / (x * x + y * y);
      const px = mirror.x + factor * x;
      const py = mirror.y + factor * y;
      assert.ok(Math.abs(Math.hypot(px - image.x, py - image.y) - image.r) < 1e-9);
      // Reflect the point again: inversion is an involution.
      const dx = px - mirror.x, dy = py - mirror.y;
      const back = mirror.r ** 2 / (dx * dx + dy * dy);
      assert.ok(Math.abs(dx * back - x) < 1e-9 && Math.abs(dy * back - y) < 1e-9);
    }
  }
});

test('inversion: disjoint mirrors contain all descendants and bound the word tree', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 19]) {
    for (const gap of [0.01, 0.02, 0.10, 0.42]) {
      const { circles, solved } = inversionCircles(seed, gap, 8);
      const mirrors = solved.state.mirrors;
      for (const m of mirrors) {
        assert.ok(m.r > 0 && m.x - m.r >= 0 && m.x + m.r <= 900 && m.y - m.r >= 0 && m.y + m.r <= 900,
          `seed ${seed}, gap ${gap}: a mirror leaves the sheet`);
      }
      // The mirrors fill the sheet to its 36-unit margin on one axis, centred.
      const x0 = Math.min(...mirrors.map((m) => m.x - m.r)), x1 = Math.max(...mirrors.map((m) => m.x + m.r));
      const y0 = Math.min(...mirrors.map((m) => m.y - m.r)), y1 = Math.max(...mirrors.map((m) => m.y + m.r));
      assert.ok(Math.abs(Math.max(x1 - x0, y1 - y0) - (900 - 2 * 36)) < 1e-9,
        `seed ${seed}, gap ${gap}: the mirrors span ${Math.max(x1 - x0, y1 - y0)}, not the sheet less its margin`);
      assert.ok(Math.abs((x0 + x1) / 2 - 450) < 1e-9 && Math.abs((y0 + y1) / 2 - 450) < 1e-9,
        `seed ${seed}, gap ${gap}: the mirrors are not centred`);
      for (let i = 0; i < mirrors.length; i++) {
        for (let j = i + 1; j < mirrors.length; j++) {
          assert.ok(Math.hypot(mirrors[i].x - mirrors[j].x, mirrors[i].y - mirrors[j].y)
            > mirrors[i].r + mirrors[j].r);
        }
      }
      assert.ok(circles.length > 30 && circles.length <= 3 * (2 ** 13 - 1));
      for (const c of circles) {
        assert.ok(mirrors.some((m) => Math.hypot(c.x - m.x, c.y - m.y) + c.r <= m.r + 1e-8),
          'every word stays in one of the three large disks');
      }
    }
  }
  // At a deliberately excessive scale the circle budget, not the pixel cutoff,
  // must bound the tree, and the radius floor fills that budget. The harness
  // stores no rendered ops for this case.
  const p = validate(EXAMPLES.inversion);
  const solved = solve(p);
  let arcs = 0;
  p.draw({ getTransform: () => ({ a: 1e30, b: 0, c: 0, d: 1e30 }),
    fillRect() {}, beginPath() {}, stroke() {}, arc() { arcs++; } }, solved.state);
  assert.ok(arcs <= 3 * (2 ** 13 - 1) && arcs > 0.9 * 3 * (2 ** 13 - 1), `${arcs} circles at scale 1e30`);
});

test('inversion: once the budget binds, a higher scale still keeps every circle scale 1 draws', () => {
  // These scales fill the circle budget; a whole-level depth limit dropped
  // circles here that scale 1 draws.
  for (const [seed, gap, scale] of [[19, 0.02, 95], [5, 0.01, 49], [3, 0.01, 53]]) {
    const a = inversionCircles(seed, gap).circles;
    const b = inversionCircles(seed, gap, scale).circles;
    assert.ok(b.length > 20000 && b.length <= 3 * (2 ** 13 - 1), `seed ${seed}: ${b.length} circles`);
    const kept = b.filter((c) => c.r >= 0.7);
    assert.equal(kept.length, a.length, `seed ${seed}, gap ${gap} at scale ${scale} drops circles scale 1 draws`);
    const differs = a.findIndex((c, i) => c.x !== kept[i].x || c.y !== kept[i].y || c.r !== kept[i].r);
    assert.equal(differs, -1, `seed ${seed}: circle ${differs} moved`);
  }
});

test('inversion: at the default gap the pixel cutoff, not a depth cap, ends every chain', () => {
  // Near contact a chain runs deeper than any small fixed cap. Walk the word
  // tree here without a depth limit and count the circles above the cutoff:
  // the piece must draw every one of them.
  const invert = (c, m) => {
    const dx = c.x - m.x, dy = c.y - m.y;
    const k = m.r * m.r / (dx * dx + dy * dy - c.r * c.r);
    return { x: m.x + k * dx, y: m.y + k * dy, r: k * c.r };
  };
  for (const scale of [1, 2]) {
    const cutoff = 1.4 / (2 * scale);
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 19]) {
      const { circles, solved } = inversionCircles(seed, EXAMPLES.inversion.params.gap.value, scale);
      const mirrors = solved.state.mirrors;
      let above = 0;
      const walk = (c, last) => {
        if (c.r < cutoff) return;
        above++;
        for (let k = 0; k < 3; k++) if (k !== last) walk(invert(c, mirrors[k]), k);
      };
      mirrors.forEach((m, i) => walk(m, i));
      assert.equal(circles.length, above, `seed ${seed} at scale ${scale} drops circles above the cutoff`);
    }
  }
});

test('inversion: the seed changes the mirrors\' sizes, not only their turn', () => {
  // Turning the sheet keeps the sorted radii; a seed that only rotated would
  // give every seed the same three numbers.
  const p = validate(EXAMPLES.inversion);
  const shapes = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9].map((seed) =>
    solve(p, seed).state.mirrors.map((m) => Math.round(m.r / 10)).sort((a, b) => a - b).join()));
  assert.ok(shapes.size >= 7, `nine seeds gave only ${shapes.size} sets of mirror sizes`);
});

test('inversion: higher output resolution adds only smaller circles without changing shared geometry', () => {
  const a = inversionCircles(19, 0.02);
  const b = inversionCircles(19, 0.02, 8);
  assert.ok(b.circles.length > a.circles.length * 2, 'the cutoff must respond to output resolution');
  assert.deepEqual(b.circles.filter((c) => c.r >= 0.7), a.circles,
    'the common circles retain their exact geometry and DFS order');
  assert.ok(a.circles.every((c) => c.r >= 0.7));
  assert.ok(b.circles.every((c) => c.r >= 0.7 / 8));
  const before = JSON.stringify(a.solved.state);
  drawFrame(new Recorder(), validate(EXAMPLES.inversion), a.solved, 0, { scale: 8 });
  assert.equal(JSON.stringify(a.solved.state), before, 'drawing must not mutate build state');
  assert.equal(inversionCircles(19, 0.02, 8).g.digest, b.g.digest);
  assert.equal(EXAMPLES.inversion.params.gap.value, 0.02, 'the comparison below draws the default gap');
  assert.equal(renderVector(EXAMPLES.inversion).marks, a.circles.length + 1,
    'ordinary SVG export has identity scale plus its background');
});

test('inversion: vector and null transform readers preserve shared circles at higher output scale', () => {
  const p = validate(EXAMPLES.inversion);
  const solved = solve(p, 19, { gap: 0.10 });
  const original = JSON.stringify(solved.state);
  for (const create of [() => new VectorSurface(p.size), () => nullSurface(p.size)]) {
    const capture = (scale) => {
      const g = create();
      const circles = [];
      const arc = g.arc.bind(g);
      g.arc = (x, y, r, start, end) => { circles.push({ x, y, r }); arc(x, y, r, start, end); };
      drawFrame(g, p, solved, 0, { scale });
      assert.deepEqual(g.getTransform(), { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, 'drawFrame restores its scale');
      return circles;
    };
    const standard = capture(1), print = capture(8);
    assert.deepEqual(standard, inversionCircles(19, 0.10).circles);
    assert.ok(print.length > standard.length * 2);
    assert.deepEqual(print.filter((circle) => circle.r >= 0.7), standard);
    assert.ok(print.every((circle) => circle.r >= 0.7 / 8));
  }
  assert.equal(JSON.stringify(solved.state), original);
});

test('N7 -- macro geometry is preserved from 1x to 8x', () => {
  // The design box is the piece; the resolution is a render-time choice. A
  // piece whose composition moves with the scale cannot be printed.
  for (const n of NAMES) {
    const p = validate(EXAMPLES[n]);
    const s = solve(p, p.seed);
    const t = p.time ? 1 : 0;
    const sampleScale = p.preview ? Math.min(1, 64 / p.size.w) : 1;
    const box = (k) => {
      const scale = k * sampleScale;
      const g = new Recorder({ w: Math.ceil(p.size.w * scale), h: Math.ceil(p.size.h * scale) });
      // Measure authored geometry, as record() does, independently of film finish.
      drawFrame(g, { ...p, finish: null }, s, t, { scale });
      return g.bbox;
    };
    const a = box(1);
    const b = box(8);
    for (const i of [0, 1, 2, 3]) {
      assert.ok(Math.abs(b[i] - a[i] * 8) < 1e-6,
        `${n}: at 8x the composition moved (${a[i]} * 8 is not ${b[i]})`);
    }
    assert.ok(a[2] - a[0] > p.size.w * sampleScale * 0.5 && a[3] - a[1] > p.size.h * sampleScale * 0.5,
      `${n} only covers ${(a[2] - a[0]).toFixed(0)} x ${(a[3] - a[1]).toFixed(0)} of its design box`);
  }
});

test('the playhead is quantised to the drawn-frame grid for every timeline', () => {
  for (const n of NAMES) {
    const p = validate(EXAMPLES[n]);
    if (!p.time) continue;
    // Against the lattice the piece actually has, not against duration*hz --
    // those were two different numbers whenever the product was not an integer.
    const den = frameDen(p);
    for (const t of [0.013, 0.37, 0.61, 0.999]) {
      const q = frameT(p, t);
      assert.ok(Math.abs(q * den - Math.round(q * den)) < 1e-9, `${p.name}: ${t} -> ${q} is off the grid`);
    }
  }
});

// ---- the instrument, and the delivery tool ---------------------------------

test('the recorder sees an arc as an area, not as a point', () => {
  // The 1x/8x check reads the recorder's bounding box. It used to take only the
  // arc's CENTRE, so a piece made entirely of discs would have passed with radii
  // that never scaled at all. `drift` is such a piece and passed only because of
  // its full-bleed background.
  const g = new Recorder();
  g.arc(50, 50, 20, 0, Math.PI * 2);
  assert.deepEqual(g.bbox, [30, 30, 70, 70], 'the radius must reach the box');

  const big = new Recorder();
  big.scale(4, 4);
  big.arc(50, 50, 20, 0, Math.PI * 2);
  assert.deepEqual(big.bbox, [120, 120, 280, 280], 'and it must scale with the transform');
});

test('the recorder sees an arc sweep, so a change of phase cannot hide', () => {
  // The angles used to be discarded, which made a change of arc phase or sweep
  // invisible to the determinism, frame-distinctness and seed-difference checks.
  const a = new Recorder();
  a.arc(10, 10, 5, 0, Math.PI);
  const b = new Recorder();
  b.arc(10, 10, 5, Math.PI, Math.PI * 2);
  assert.notEqual(a.digest, b.digest, 'two different sweeps recorded identically');

  const ccw = new Recorder();
  ccw.arc(10, 10, 5, 0, Math.PI, true);
  assert.notEqual(a.digest, ccw.digest, 'and direction is part of the mark');
});

test('the page builder refuses to write a bundle with a hole in it', () => {
  // The delivery tool used to exit 0 over a page that threw on load and rendered
  // nothing -- every example, not just the new one -- while every other check
  // stayed green.
  const { modules, checkResolvable } = require('../tools/build-page.js');
  const real = modules();

  assert.ok(real.includes('examples/index.js'), 'the index is bundled');
  assert.equal(real[real.length - 1], 'examples/index.js', 'and it comes last, because it requires the others');
  for (const n of NAMES) assert.ok(real.includes(`examples/${n}.js`), `${n} is discovered, not listed`);
  assert.doesNotThrow(() => checkResolvable(real));

  const e = grab(() => checkResolvable(real.filter((m) => m !== 'core/rand.js')));
  assert.match(e.message, /would throw on load and render nothing/);
  assert.match(e.message, /core\/rand\.js, which is not bundled/);
});

test('a bundle of a module list holds what the list reaches, and refuses a list with a hole by name', () => {
  // The site bundles only the library modules its shots require; the page, every one.
  const { bundle, reach, MODULES } = require('../tools/build-page.js');
  const defined = (source) => [...source.matchAll(/^__def\("([^"]+)"/gm)].map((m) => m[1]);
  assert.deepEqual(defined(bundle()), MODULES, 'the default bundle is the whole library, in order');
  assert.equal(bundle(), bundle(null, MODULES));
  assert.deepEqual(reach(MODULES), MODULES);

  const render = reach(['core/render.js']);
  assert.ok(render.length > 1 && render.every((id) => id.startsWith('core/')), 'render reaches core modules and no example');
  assert.deepEqual(defined(bundle(null, render)), render);
  const left = render.find((id) => id !== 'core/render.js');
  const e = grab(() => bundle(null, render.filter((id) => id !== left)));
  assert.match(e.message, new RegExp(left.replace(/[./]/g, '\\$&') + ', which is not bundled'));
  assert.match(grab(() => bundle(null, reach(['core/nope.js']))).message, /core\/nope\.js is asked for, but it is not a module/);
});

test('the page builder refuses to write a page that does not parse', () => {
  // checkResolvable proves the MODULES can find each other and looks at nothing
  // else. The page body around them is one template literal in build-page.js,
  // and a fault in THAT wrote a 146 kB file, printed a success line and exited 0
  // over a page that died on load. The one that bought this check was a regex
  // written /^\?/ inside the literal: the backslash is eaten before the browser
  // sees it, so the page got /^?/ -- "Nothing to repeat" -- and rendered blank.
  const { checkParses, modules, bundle, html } = require('../tools/build-page.js');

  assert.equal(checkParses(html(bundle())), true, 'the page this build would ship parses');
  assert.ok(modules().length > 0);

  const broken = grab(() => checkParses('<script>var q = String(x).replace(/^?/, "");</script>'));
  assert.match(broken.message, /does not parse/);
  assert.match(broken.message, /Nothing to repeat/, "and it carries the engine's own words");

  // A truncated page is the other shape this catches: a stray backtick ends the
  // literal early and what gets written is half a script.
  assert.match(grab(() => checkParses('<script>function f() { var a = 1;</script>')).message, /does not parse/);
  assert.match(grab(() => checkParses('<p>no script here</p>')).message, /has no script block/);
});

test('a film is read from the blocks its FILE holds, by walking it rather than scanning it', () => {
  // MediaRecorder cannot be asked what it received and stamps frames by the wall
  // clock, so the written file is the only honest witness. This is the smallest
  // file with every shape a recorder writes: a header to step over, a Segment and
  // Clusters of UNKNOWN size to step into, a Block inside a BlockGroup, and a
  // payload byte that looks exactly like a block id.
  const { webmBlockTimes } = require('../core/export.js');
  const webm = (scale) => Uint8Array.from([
    0x1A, 0x45, 0xDF, 0xA3, 0x83, 0xA3, 0xA3, 0xA3,
    0x18, 0x53, 0x80, 0x67, 0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
    0x15, 0x49, 0xA9, 0x66, 0x87, 0x2A, 0xD7, 0xB1, 0x83, ...scale,
    0x1F, 0x43, 0xB6, 0x75, 0xFF, 0xE7, 0x81, 0x00,
    0xA3, 0x85, 0x81, 0x00, 0x00, 0x80, 0xA3,
    0xA3, 0x85, 0x81, 0x00, 0x21, 0x00, 0xA3,
    0xA3, 0x85, 0x81, 0x00, 0x43, 0x00, 0xA3,
    0x1F, 0x43, 0xB6, 0x75, 0xFF, 0xE7, 0x81, 0x64,
    0xA3, 0x85, 0x81, 0x00, 0x00, 0x80, 0xA3,
    0xA0, 0x87, 0xA1, 0x85, 0x81, 0x00, 0x21, 0x00, 0xA3,
  ]);

  assert.deepEqual(webmBlockTimes(webm([0x0F, 0x42, 0x40])), [0, 33, 67, 100, 133],
    'five blocks at the cluster time plus their own, and no sixth from a payload byte');
  assert.deepEqual(webmBlockTimes(webm([0x1E, 0x84, 0x80])), [0, 66, 134, 200, 266],
    'in the units the file declares, not the ones a recorder usually picks');
  assert.deepEqual(webmBlockTimes(new Uint8Array(0)), []);
});

test('a recorded WebM is saved with its length, and every other byte as recorded', () => {
  // The shape Edge's recorder writes: a Segment of unknown size, a Void, and an
  // Info whose Duration is one TimecodeScale unit, which players show as 0.001 s.
  const { webmWithDuration, webmBlockTimes } = require('../core/export.js');
  const cluster = [0x1F, 0x43, 0xB6, 0x75, 0xFF, 0xE7, 0x81, 0x00,
    0xA3, 0x85, 0x81, 0x00, 0x00, 0x80, 0xA3, 0xA3, 0x85, 0x81, 0x00, 0x2A, 0x80, 0xA3];
  const film = (info, known) => {
    const body = [0xEC, 0x83, 0, 0, 0, 0x15, 0x49, 0xA9, 0x66, 0x80 | info.length, ...info, ...cluster];
    const size = known ? [0x01, 0, 0, 0, 0, 0, 0, body.length] : [0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF];
    return Uint8Array.from([0x1A, 0x45, 0xDF, 0xA3, 0x83, 0xA3, 0xA3, 0xA3, 0x18, 0x53, 0x80, 0x67, ...size, ...body]);
  };
  const scale = (ns) => [0x2A, 0xD7, 0xB1, 0x83, (ns >> 16) & 255, (ns >> 8) & 255, ns & 255];
  const app = [0x4D, 0x80, 0x86, ...Array.from('Chrome', (ch) => ch.charCodeAt(0))];
  const changed = (a, b) => [...a.keys()].filter((i) => a[i] !== b[i]);
  const view = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // The recorder's one-unit Duration is overwritten where it stands: 168 frames at
  // 24 Hz last 7 s, which is 7000 units of 1 ms, or 14000 of 0.5 ms.
  for (const [ns, units] of [[1000000, 7000], [500000, 14000]]) {
    const recorded = film([...scale(ns), 0x44, 0x89, 0x84, 0x3F, 0x80, 0x00, 0x00, ...app], false);
    const saved = webmWithDuration(recorded, 168 / 24);
    assert.equal(saved.length, recorded.length);
    assert.equal(view(saved).getFloat32(40), units, 'the Duration is the film\'s length in the file\'s own units');
    assert.deepEqual(changed(saved, recorded).filter((i) => i < 40 || i > 43), [], 'and nothing else changes');
    assert.deepEqual(webmBlockTimes(saved), webmBlockTimes(recorded), 'every frame is where the recorder put it');
  }

  // Where the recorder wrote none, one is added at the end of Info, and Info and
  // a Segment of known size grow by exactly its eleven bytes.
  const bare = film([...scale(1000000), ...app], true);
  const saved = webmWithDuration(bare, 8);
  const end = 30 + 16;
  assert.equal(saved.length, bare.length + 11);
  assert.deepEqual([...saved.subarray(end, end + 3)], [0x44, 0x89, 0x88]);
  assert.equal(view(saved).getFloat64(end + 3), 8000);
  const rest = Uint8Array.from([...saved.subarray(0, end), ...saved.subarray(end + 11)]);
  assert.deepEqual(changed(rest, bare), [19, 29], 'only the Segment and Info sizes differ');
  assert.equal(saved[19], bare[19] + 11);
  assert.equal(saved[29], bare[29] + 11);
  assert.deepEqual(webmBlockTimes(saved), webmBlockTimes(bare));

  assert.throws(() => webmWithDuration(Uint8Array.from(cluster), 1), /no Segment Info/);
});

test('a WebM carries its recipe in one Tags element before the first Cluster, and every other byte as saved', () => {
  const { webmWithDuration, webmWithManifest, webmManifest, webmBlockTimes } = require('../core/export.js');
  const cluster = [0x1F, 0x43, 0xB6, 0x75, 0xFF, 0xE7, 0x81, 0x00,
    0xA3, 0x85, 0x81, 0x00, 0x00, 0x80, 0xA3, 0xA3, 0x85, 0x81, 0x00, 0x2A, 0x80, 0xA3];
  const info = [0x15, 0x49, 0xA9, 0x66, 0x8E, 0x2A, 0xD7, 0xB1, 0x83, 0x0F, 0x42, 0x40, 0x44, 0x89, 0x84, 0x3F, 0x80, 0x00, 0x00];
  const film = (known) => {
    const body = [0xEC, 0x83, 0, 0, 0, ...info, ...cluster];
    const size = known ? [0x01, 0, 0, 0, 0, 0, 0, body.length] : [0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF];
    return Uint8Array.from([0x1A, 0x45, 0xDF, 0xA3, 0x83, 0xA3, 0xA3, 0xA3, 0x18, 0x53, 0x80, 0x67, ...size, ...body]);
  };
  const manifest = { piece: 'café ☕', seed: 7, film: { frames: 2, hz: 24, loop: false, scale: 1 } };
  const at = 20 + 5 + info.length;
  for (const known of [false, true]) {
    const dated = webmWithDuration(film(known), 2 / 24);
    const saved = webmWithManifest(dated, manifest);
    assert.deepEqual(webmManifest(saved), manifest, 'the tag reads back, non-ASCII names included');
    const length = saved.length - dated.length;
    assert.deepEqual([...saved.subarray(at, at + 4)], [0x12, 0x54, 0xC3, 0x67], 'a Tags element sits where the first Cluster was');
    assert.deepEqual([...saved.subarray(at + length)], [...dated.subarray(at)], 'every Cluster and Block after it as saved');
    const rest = Uint8Array.from([...saved.subarray(0, at), ...saved.subarray(at + length)]);
    const moved = [...rest.keys()].filter((i) => rest[i] !== dated[i]);
    assert.deepEqual(moved, known ? [19] : [], 'without it, the saved film, Duration included; a known Segment size grows');
    if (known) assert.equal(dated[19] + length, saved[19]);
    assert.deepEqual(webmBlockTimes(saved), webmBlockTimes(dated));
    assert.equal(webmManifest(dated), null);
  }
  assert.throws(() => webmWithManifest(film(false).subarray(0, 44), manifest), /no Cluster/);
  const cut = webmWithManifest(webmWithDuration(film(false), 2 / 24), manifest);
  assert.throws(() => webmManifest(cut.subarray(0, at + 40)), /ends inside its Tags element/);
});

test('every EBML size is read exactly, at every length up to 8 bytes', () => {
  const { ebmlHead, webmBlockTimes } = require('../core/export.js');
  // A Void element whose size is written in `len` bytes.
  const sized = (len, size) => {
    const bytes = [];
    for (let i = len - 1, v = size; i >= 0; i--, v = Math.floor(v / 256)) bytes[i] = v % 256;
    bytes[0] |= 0x80 >> (len - 1);
    return Uint8Array.from([0xEC, ...bytes]);
  };
  for (let len = 1; len <= 8; len++) {
    const largest = Math.min(2 ** (7 * len) - 2, Number.MAX_SAFE_INTEGER);
    for (const size of [0, 5, 1866906 % (largest + 1), largest]) {
      const head = ebmlHead(sized(len, size), 0);
      assert.deepEqual([head.id, head.sizeLen, head.size, head.unknown, head.body], [0xEC, len, size, false, 1 + len], len + '-byte size ' + size);
    }
    // All value bits set is "unknown"; one bit fewer is a size.
    const ones = [0xFF >> (len - 1), ...Array(len - 1).fill(0xFF)];
    assert.equal(ebmlHead(Uint8Array.from([0xEC, ...ones]), 0).unknown, true, len + '-byte unknown size');
    ones[len - 1] ^= 1;
    assert.equal(ebmlHead(Uint8Array.from([0xEC, ...ones]), 0).unknown, false);
  }

  // In the recorder's live shape, a Void with an 8-byte size holds five bytes
  // that look like a block. The walk skips exactly those five and finds the one
  // real block after them; a size read off by a few bytes lands inside them.
  const film = Uint8Array.from([
    0x18, 0x53, 0x80, 0x67, 0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
    0x15, 0x49, 0xA9, 0x66, 0x87, 0x2A, 0xD7, 0xB1, 0x83, 0x0F, 0x42, 0x40,
    0xEC, 0x01, 0, 0, 0, 0, 0, 0, 0x05, 0xA3, 0x83, 0x81, 0x00, 0x00,
    0x1F, 0x43, 0xB6, 0x75, 0xFF, 0xE7, 0x81, 0x00,
    0xA3, 0x85, 0x81, 0x00, 0x21, 0x80, 0xA3,
  ]);
  assert.deepEqual(webmBlockTimes(film), [33]);
});

test('a single-frame film needs exactly one frame and no spacing interval', () => {
  const { filmVerdict } = require('../core/export.js');
  assert.throws(() => filmVerdict(1, 30, []), /holds 0 of 1 frames/);
  assert.throws(() => filmVerdict(1, 30, [0, 33]), /holds 2 of 1 frames/);
  assert.throws(() => filmVerdict(2, 30, [0]), /holds 1 of 2 frames/);
  assert.throws(() => filmVerdict(2, 30, [0, 1000]), /spacing is uneven/);

  for (const hz of [1, 30]) {
    const p = validate({
      name: 'one-frame-film', size: { w: 64, h: 64 },
      time: { duration: 1 / hz, hz }, draw() {},
    });
    const heads = playheads(p);
    assert.deepEqual(heads, [0], 'a valid timeline can contain one frame');
    const v = filmVerdict(heads.length, hz, [125]);
    assert.equal(v.frames, 1);
    assert.equal(v.expected, 1);
    assert.equal(v.seconds, 1 / hz, 'the report includes one declared frame interval');
    assert.equal(v.medianGapMs, 0);
    assert.equal(v.p95GapMs, 0);
    assert.equal(v.maxGapMs, 0);
  }
});

test('a film too slow to record in real time says so, and names the export that can', () => {
  const { filmVerdict } = require('../core/export.js');
  const even = Array.from({ length: 300 }, (_, i) => Math.round((i * 1000) / 30));
  // The same holes, told apart by how far the loop fell behind its schedule.
  const lost = grab(() => filmVerdict(300, 30, even.slice(1), { worstLagMs: 4 })).message;
  assert.match(lost, /missing pictures rather than slow/);
  const slow = grab(() => filmVerdict(300, 30, even.slice(1), { worstLagMs: 640 })).message;
  assert.match(slow, /holds 299 of 300 frames\. The export fell 640 ms behind/);
  assert.match(slow, /draws slower than real time/);
  assert.match(slow, /Export MP4 from a browser that encodes H\.264/);
  assert.doesNotMatch(slow, /rather than slow/);
  // Late because the recorder stalled, not because a frame drew slowly.
  const stalled = grab(() => filmVerdict(300, 30, even.slice(1), { worstLagMs: 56, worstDrawMs: 0.2, worstWriteMs: 56 })).message;
  assert.match(stalled, /fell 56 ms behind its schedule .*: the recorder took up to 56 ms to accept a frame while no frame took more than 0\.2 ms to draw and read back/);
  assert.doesNotMatch(stalled, /draws slower than real time/);
  assert.match(grab(() => filmVerdict(300, 30, even.slice(1), { worstLagMs: 90, worstDrawMs: 40, worstWriteMs: 56 })).message,
    /draws slower than real time/, 'a frame that draws past its budget is blamed however long a write took');
  const bursts = even.map((_, i) => Math.floor(i / 30) * 1000 + (i % 30) * 1.3);
  assert.match(grab(() => filmVerdict(300, 30, bursts, { worstLagMs: 900 })).message, /spacing is uneven.*draws slower than real time/);
  assert.equal(filmVerdict(300, 30, even, { worstLagMs: 900 }).frames, 300, 'a complete, even film passes however it was paced');
});

test('a film with every frame and uneven spacing is refused, and so is one missing a frame', () => {
  // Frames written, frames received and duration ALL passed on a film that
  // played in bursts. Spacing was the one thing nobody measured.
  const { filmVerdict } = require('../core/export.js');
  const even = Array.from({ length: 300 }, (_, i) => Math.round((i * 1000) / 30));

  const v = filmVerdict(300, 30, even);
  assert.equal(v.frames, 300);
  assert.ok(Math.abs(v.seconds - 10) < 0.01, 'ten seconds, read from the file');
  assert.ok(v.medianGapMs >= 33 && v.maxGapMs <= 34);

  // The film that bought this check: thirty frames at once, then a freeze.
  const bursts = even.map((_, i) => Math.floor(i / 30) * 1000 + (i % 30) * 1.3);
  assert.equal(bursts.length, 300, 'every frame is there');
  assert.ok(Math.abs((bursts[299] - bursts[0]) / 1000 - 10) < 1, 'and so is the duration, near enough');
  assert.match(grab(() => filmVerdict(300, 30, bursts)).message, /spacing is uneven: median 1\.3 ms/);

  // One freeze in an otherwise even film leaves the median and the p95 alone.
  const frozen = even.map((ms, i) => (i > 150 ? ms + 1000 : ms));
  assert.match(grab(() => filmVerdict(300, 30, frozen)).message, /spacing is uneven.*max 10\d\d\.0 ms/);

  // A missing frame says WHERE it went, because the gaps already know: the first
  // export that lost one lost it at the end, and nothing in the message said so.
  assert.match(grab(() => filmVerdict(300, 30, even.slice(1))).message, /holds 299 of 300 frames, and the gaps are even, so they went missing at an end/);
  assert.match(grab(() => filmVerdict(300, 30, even.filter((_, i) => i !== 150))).message, /holds 299 of 300 frames, and the widest gap is 6\d\.0 ms.*mid-film/);
  assert.match(grab(() => filmVerdict(300, 30, [])).message, /holds 0 of 300 frames, and that is too few to say/);
});
