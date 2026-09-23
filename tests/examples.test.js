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

const { validate, solve, frameT, frameCount, frameDen, frameIndex, clockAt } = require('../core/piece.js');
const { renderVector, drawFrame, playheads } = require('../core/render.js');
const { VectorSurface } = require('../core/surface-vector.js');
const { nullSurface } = require('../tools/bench.js');
const font = require('../examples/stroke-font.js');
const EXAMPLES = require('../examples/index.js');

const NAMES = Object.keys(EXAMPLES);

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
  constructor() {
    this.ops = [];
    this.arcs = [];
    this._s = {
      fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1,
      lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, lineDashOffset: 0,
    };
    this._dash = [];
    this._stack = [];
    // A REAL transform. Recording `scale` without applying it would make the
    // 1x/8x check measure this class instead of the piece, and it would pass
    // for the wrong reason -- which is the failure mode this whole project is
    // organised against.
    this._m = [1, 0, 0, 1, 0, 0];
    this._box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const key of Object.keys(this._s)) {
      Object.defineProperty(this, key, {
        get: () => this._s[key],
        set: (v) => { this._s[key] = v; this.ops.push(`${key}=${v}`); },
      });
    }
  }

  // ---- state ----
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
  setLineDash(a) { this._dash = Array.isArray(a) ? a.slice() : []; this.ops.push(`dash=[${this._dash.join(',')}]`); }

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

  get markCount() { return this.ops.filter((o) => /^(fill|stroke:|FR|SR|PX)/.test(o)).length; }

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

function record(raw, seed, t, params) {
  const p = validate(raw);
  const g = new Recorder();
  // Pixel-family invariants sample real bytes at 64 pixels wide. Every declared
  // frame, seed and parameter pin still runs; native full-resolution equality
  // and dedicated pixel checks cover the raster path separately.
  const scale = p.preview ? Math.min(1, 64 / p.size.w) : 1;
  drawFrame(g, p, solve(p, seed === undefined ? p.seed : seed, params), t === undefined ? 1 : t, { scale });
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
    ['resetTransform'], ['restore'],
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
    ['miterLimit', 3], ['lineDashOffset', 1]]) {
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
    if (validate(EXAMPLES[n]).time) continue;
    assert.equal(record(EXAMPLES[n], 5, 0).digest, record(EXAMPLES[n], 5, 1).digest, n);
    assert.deepEqual(playheads(EXAMPLES[n]), [0], n);
  }
});

test('a timeline does not, and every drawn frame is distinct enough to be worth drawing', () => {
  for (const n of NAMES) {
    const p = validate(EXAMPLES[n]);
    if (!p.time) continue;
    const seen = new Set(playheads(p).map((t) => record(EXAMPLES[n], 5, t).digest));
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

test("the attractor's orbit is arithmetic, because a chaotic orbit amplifies a last bit", () => {
  // ECMAScript does not pin the last bit of sin, cos, exp, pow or hypot, so two
  // engines may disagree by one ulp. On an orbit separating at 0.2 nats a step
  // that is not a rounding difference, it is a different picture -- and the
  // determinism contract is the thing this whole library rests on.
  const src = fs.readFileSync(path.join(__dirname, '..', 'examples', 'attractor.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')      // block comments
    .replace(/\/\/[^\n]*/g, '');            // line comments
  const banned = src.match(/Math\.(sin|cos|tan|asin|acos|atan2?|exp|expm1|pow|hypot|cbrt)\b/g);
  assert.deepEqual(banned, null,
    `the attractor calls ${banned && [...new Set(banned)].join(', ')} outside a comment`);
  assert.equal(/[\w)\]]\s*\*\*\s*[\w(]/.test(src), false, 'and it uses no ** operator either');

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
 * A Recorder that core/layer.js treats as a raster surface: it has a canvas, and
 * it reads back as opaque once an opaque fillRect has covered all of it. Copying
 * a region takes the marks the canvas shows since it was last cleared, and
 * putting a copy back records those marks again, so a frame whose layer was
 * copied can be compared, mark for mark, with the frame drawn directly.
 */
class RasterRecorder extends Recorder {
  constructor(canvas) {
    super();
    Object.assign(this, { canvas, cleared: 0, opaque: false, held: [], copies: 0 });
  }

  getContextAttributes() { return {}; }

  clearRect(x, y, w, h) {
    super.clearRect(x, y, w, h);
    Object.assign(this, { cleared: this.ops.length, opaque: false });
  }

  fillRect(x, y, w, h) {
    super.fillRect(x, y, w, h);
    const covers = this._x(x, y) <= 0 && this._y(x, y) <= 0
      && this._x(x + w, y + h) >= this.canvas.width && this._y(x + w, y + h) >= this.canvas.height;
    if (covers && this.globalAlpha === 1 && !/rgba|\/|#[0-9a-f]{8}$/i.test(String(this.fillStyle))) this.opaque = true;
  }

  getImageData(x, y, w, h) {
    const data = new Uint8ClampedArray(w * h * 4);
    if (this.opaque) for (let i = 3; i < data.length; i += 4) data[i] = 255;
    return { data };
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
  const canvas = { width, height, ownerDocument: { createElement: () => rasterCanvas(0, 0) } };
  canvas.getContext = () => canvas.ctx || (canvas.ctx = new RasterRecorder(canvas));
  return canvas;
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
  assert.ok(font.glyph('a').length > 0, 'lowercase falls back to the uppercase form');
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
  const shown = playheads(p).map((t) => record(EXAMPLES.readout, undefined, t).ops.filter((o) => o.startsWith('fillStyle=')).length - 1);
  assert.ok(shown[0] === 0 && shown[shown.length - 1] > 80, `the cells shown run from ${shown[0]} to ${shown[shown.length - 1]}`);
  for (let f = 0; f < shown.length; f++) {
    assert.equal(heard.filter((h) => h <= f).length, shown[f], `frame ${f}: the cells shown and the digits heard disagree`);
  }
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

test('settle: the soundtrack follows the system frame by frame, and comes to rest with it', async () => {
  // readout starts a sound on the frame that shows its cause. This piece holds
  // its state on every frame instead, so every control is read back at every
  // frame's second and set against the snapshot that frame draws.
  const { renderSound } = require('../core/render.js');
  const { fakeAudio } = require('./fake-media.js');
  const p = validate(EXAMPLES.settle);
  const heads = playheads(p);
  const hz = p.time.hz;

  // One value per drawn frame, at that frame's second, and nothing in between.
  const perFrame = (param) => {
    assert.equal(param.events.length, heads.length, 'a control is set once per drawn frame');
    return param.events.map(([how, value, at], k) => {
      assert.equal(how, k ? 'linearRampToValueAtTime' : 'setValueAtTime');
      assert.ok(Math.abs(at * hz - k) < 1e-9, `a control sits off the frame grid at ${at} s`);
      return value;
    });
  };

  const listen = async (seed, params) => {
    const solved = solve(p, seed, params);
    const audio = fakeAudio();
    await renderSound(p, solved, { OfflineAudioContext: audio.Context });
    const ctx = audio.record.contexts[0];
    const voices = audio.record.oscillators;   // voice i is node i's, in creation order
    const routes = voices.map((v) => {
      const route = [v];
      while (route[route.length - 1] !== ctx.destination) {
        const next = route[route.length - 1].to;
        assert.equal(next && next.length, 1, 'every voice reaches the speakers along one path');
        route.push(next[0]);
      }
      return route;
    });
    assert.equal(new Set(routes.flat()).size, audio.record.nodes.length + 1,
      'every node the soundtrack makes lies on a voice\'s way to the speakers');
    const shared = routes[0].filter((n) => routes.every((route) => route.includes(n)));
    const s = solved.state;
    const N = s.nodes.length;
    // The snapshot the picture shows on each frame, read back from its discs,
    // and the last one stored: where every node comes to rest.
    const f = settleSnapshots(p, solved);
    return {
      s, N, f, voices, rest: s.traj.length - N * 2,
      gain: routes.map((route) => route[1].gain.value),
      detune: voices.map((v) => perFrame(v.detune)),
      pan: routes.map((route) => perFrame(route.find((n) => n.pan).pan)),
      level: perFrame(shared.find((n) => n.gain).gain),
      cutoff: perFrame(shared.find((n) => n.Q).frequency),
    };
  };

  // Pool (state, sound) pairs from every voice, every frame and two different
  // trajectories: a control that followed the clock instead of the state would
  // give two answers for one state, or one answer for two. Only the floor may
  // hold one value for many states: the silence below the slowest motion heard.
  const rises = (pairs, what, strict) => {
    pairs.sort((x, y) => x[0] - y[0]);
    const floor = Math.min(...pairs.map(([, y]) => y));
    for (let j = 1; j < pairs.length; j++) {
      const [x0, y0] = pairs[j - 1];
      const [x1, y1] = pairs[j];
      const ok = (strict && x1 - x0 > 1e-9 && y0 > floor) ? y1 > y0 : y1 >= y0 - 1e-9;
      assert.ok(ok, `${what} is not a function of the state: ${y0} at ${x0}, ${y1} at ${x1}`);
    }
  };

  const a = await listen(p.seed);
  const b = await listen(p.seed, { tension: p.params.tension.max });
  const other = await listen(1);
  assert.notDeepEqual(a.s.energy, b.s.energy, 'the two trajectories must differ, or pooling proves nothing');

  // The chord is the table's: every voice is a harmonic of the lowest, counted
  // down from the busiest node by its degree, and a re-roll cannot move it.
  for (const run of [a, other]) {
    assert.equal(run.voices.length, run.N, 'one voice per node');
    const low = Math.min(...run.voices.map((v) => v.frequency.value));
    const top = Math.max(...run.s.nodes.map((nd) => nd.deg));
    run.voices.forEach((v, i) => assert.ok(Math.abs(v.frequency.value / low - (top + 1 - run.s.nodes[i].deg)) < 1e-9,
      `voice ${i} is not on the harmonic its degree gives`));
  }
  assert.deepEqual(other.voices.map((v) => v.frequency.value), a.voices.map((v) => v.frequency.value),
    'a re-roll moved the chord, which would make the graph sound like something else');
  assert.notDeepEqual(other.detune[0], a.detune[0], 'the seed moves where each voice starts');

  // Every voice at every drawn frame of both trajectories, against the
  // snapshot that frame draws.
  const lifts = [], moves = [], spreads = [];
  for (const run of [a, b]) {
    const { s, N, rest } = run;
    assert.ok(run.voices.some((v) => v.frequency.value < 250), 'there is a bass to keep in the middle');
    run.f.forEach((f, k) => {
      const bands = new Map();
      for (let i = 0; i < N; i++) {
        const o = f * N * 2 + i * 2;
        lifts.push([s.traj[rest + i * 2 + 1] - s.traj[o + 1], run.detune[i][k]]);
        const hz = run.voices[i].frequency.value;
        if (!bands.has(hz)) bands.set(hz, []);
        bands.get(hz).push([s.traj[o], run.pan[i][k]]);
      }
      // Place follows position where a voice may spread: on every frame the
      // voices on one harmonic are heard in the order their nodes stand, up to
      // the edges of the room. Below 250 Hz a voice stays in the middle, and the
      // room is centred on the sound, so the loudest voices cannot lean the mix.
      let lo = Infinity, hi = -Infinity;
      for (const [hz, pairs] of bands) {
        if (hz < 250) {
          assert.ok(pairs.every(([, v]) => v === 0), `a ${hz} Hz voice left the middle on frame ${k}`);
          continue;
        }
        rises(pairs, 'pan', false);
        for (const [, v] of pairs) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      }
      spreads.push(hi - lo);
      const power = run.gain.map((g) => g * g);
      const lean = run.pan.reduce((sum, pan, i) => sum + power[i] * pan[k], 0) / power.reduce((x, y) => x + y, 0);
      assert.ok(Math.abs(lean) < 0.01, `frame ${k} leans ${lean.toFixed(3)} to one side`);
      moves.push([s.energy[f], run.level[k], run.cutoff[k]]);
    });
    const spread = (k) => run.detune.reduce((sum, d) => sum + Math.abs(d[k]), 0) / N;
    assert.ok(spread(0) > 100, `the scattered start is only ${spread(0).toFixed(1)} cents out of tune`);
    assert.ok(run.detune.every((d) => Math.abs(d[heads.length - 1]) < 1), 'the settled graph is in tune');
    assert.equal(run.level[0], 0, 'nothing has moved yet, so nothing is heard');
    assert.ok(run.level[heads.length - 1] < 0.05, 'and the system at rest falls silent');
    assert.ok(Math.max(...run.level) > 0.95, 'the first moves are heard at full level');
  }
  // Pitch follows height: a voice is sharp by how far its node sits above the
  // place it comes to rest, flat below it, and in tune once it is there.
  rises(lifts, 'detune', true);
  assert.ok(Math.min(...spreads) > 0.3, 'on every frame the voices above the bass spread across the room');
  // Level follows the energy trace drawn at the foot of the plate, and
  // brightness follows level.
  rises(moves.map(([e, v]) => [e, v]), 'level', true);
  rises(moves.map(([, v, c]) => [v, c]), 'cutoff', true);
  const cutoffs = moves.map(([, , c]) => c);
  assert.ok(Math.max(...cutoffs) > 4 * Math.min(...cutoffs), 'and the brightness moves with it');
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
  // A browser repeats the rendered samples only to their last bits, because it
  // may add up a node's inputs in another order each time. Everything on the
  // piece's side must repeat exactly: the nodes, their settings, every scheduled
  // value and every connection.
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
  // The edges as the first frame draws them: each is one line between two node
  // centres, read back as the pair of nodes it joins.
  const drawnEdges = (solved) => {
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
  };
  const runs = [p.seed, 1, 2, 99999].map((seed) => {
    const solved = solve(p, seed);
    return { seed, s: solved.state, edges: drawnEdges(solved) };
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
  // somewhere else, and the graph comes to rest in another arrangement.
  const start = (run, i) => [run.s.traj[i * 2], run.s.traj[i * 2 + 1]];
  const rest = (run) => Array.from(run.s.traj.slice(run.s.traj.length - N * 2));
  runs.forEach((x, j) => runs.slice(j + 1).forEach((y) => {
    for (let i = 0; i < N; i++) {
      assert.notDeepEqual(start(x, i), start(y, i), `node ${i} starts in one place at seeds ${x.seed} and ${y.seed}`);
    }
    assert.notDeepEqual(rest(x), rest(y), `seeds ${x.seed} and ${y.seed} settle into one arrangement`);
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
    const heard = audio.record.oscillators.map((o) => o.at * p.time.hz);
    assert.ok(heard.every((f) => Math.abs(f - Math.round(f)) < 1e-9), `blend ${blend}: a note falls between frames`);
    const shown = cueTurns(cueFrames(p, solved), solved.state.cues).flat();
    const sorted = (a) => a.map(Math.round).sort((x, y) => x - y);
    assert.deepEqual(sorted(heard), sorted(shown), `blend ${blend}: the notes and the frames that show each part turning disagree`);
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
  for (const seed of [1, 2, 19]) {
    for (const gap of [0.02, 0.10, 0.42]) {
      const { circles, solved } = inversionCircles(seed, gap, 8);
      const mirrors = solved.state.mirrors;
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
  // At a deliberately excessive scale the depth cap, not the pixel cutoff,
  // must bound the tree. The harness stores no rendered ops for this case.
  const p = validate(EXAMPLES.inversion);
  const solved = solve(p);
  let arcs = 0;
  p.draw({ getTransform: () => ({ a: 1e30, b: 0, c: 0, d: 1e30 }),
    fillRect() {}, beginPath() {}, stroke() {}, arc() { arcs++; } }, solved.state);
  assert.equal(arcs, 3 * (2 ** 13 - 1));
});

test('inversion: higher output resolution adds only smaller circles without changing shared geometry', () => {
  const a = inversionCircles(19, 0.10);
  const b = inversionCircles(19, 0.10, 8);
  assert.ok(b.circles.length > a.circles.length * 2, 'the cutoff must respond to output resolution');
  assert.deepEqual(b.circles.filter((c) => c.r >= 0.7), a.circles,
    'the common circles retain their exact geometry and DFS order');
  assert.ok(a.circles.every((c) => c.r >= 0.7));
  assert.ok(b.circles.every((c) => c.r >= 0.7 / 8));
  const before = JSON.stringify(a.solved.state);
  drawFrame(new Recorder(), validate(EXAMPLES.inversion), a.solved, 0, { scale: 8 });
  assert.equal(JSON.stringify(a.solved.state), before, 'drawing must not mutate build state');
  assert.equal(inversionCircles(19, 0.10, 8).g.digest, b.g.digest);
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
      const g = new Recorder();
      drawFrame(g, p, s, t, { scale: k * sampleScale });
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
  const { webmBlockTimes } = require('../tools/build-page.js');
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
  const { webmWithDuration, webmBlockTimes } = require('../tools/build-page.js');
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

test('a single-frame film needs exactly one frame and no spacing interval', () => {
  const { filmVerdict } = require('../tools/build-page.js');
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
  const { filmVerdict } = require('../tools/build-page.js');
  const even = Array.from({ length: 300 }, (_, i) => Math.round((i * 1000) / 30));
  // The same holes, told apart by how far the loop fell behind its schedule.
  const lost = grab(() => filmVerdict(300, 30, even.slice(1), { worstLagMs: 4 })).message;
  assert.match(lost, /missing pictures rather than slow/);
  const slow = grab(() => filmVerdict(300, 30, even.slice(1), { worstLagMs: 640 })).message;
  assert.match(slow, /holds 299 of 300 frames\. The export fell 640 ms behind/);
  assert.match(slow, /draws slower than real time/);
  assert.match(slow, /Export MP4 from a browser that encodes H\.264/);
  assert.doesNotMatch(slow, /rather than slow/);
  const bursts = even.map((_, i) => Math.floor(i / 30) * 1000 + (i % 30) * 1.3);
  assert.match(grab(() => filmVerdict(300, 30, bursts, { worstLagMs: 900 })).message, /spacing is uneven.*draws slower than real time/);
  assert.equal(filmVerdict(300, 30, even, { worstLagMs: 900 }).frames, 300, 'a complete, even film passes however it was paced');
});

test('a film with every frame and uneven spacing is refused, and so is one missing a frame', () => {
  // Frames written, frames received and duration ALL passed on a film that
  // played in bursts. Spacing was the one thing nobody measured.
  const { filmVerdict } = require('../tools/build-page.js');
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
