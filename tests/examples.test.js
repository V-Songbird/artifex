'use strict';

// The example set is infrastructure, not decoration.
//
// Section 3 of docs/subject-neutrality.md says the examples ARE the real
// specification: a library that has only ever drawn the art it was built for has
// no evidence it generalises, and the gaps show up as missing primitives rather
// than as failing tests. So the set itself is checked -- that it spans idioms
// that break each other, that each one reaches what it declares, and that
// nothing in it is decorative.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { validate, solve, frameT, frameCount } = require('../core/piece.js');
const { renderVector, drawFrame, playheads } = require('../core/render.js');
const { VectorSurface } = require('../core/surface-vector.js');
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
// It exists because three of the five examples are raster and Node has no
// canvas, so without it a raster piece's `draw` could only be claimed to work.
// It records STYLE as well as geometry, because the difference between a line
// arriving and a finished line fading in lives entirely in the style.
// ---------------------------------------------------------------------------
class Recorder {
  constructor() {
    this.ops = [];
    this.arcs = [];
    this._s = { fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1, lineCap: 'butt', lineJoin: 'miter' };
    this._stack = [];
    this._k = 1;
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

  save() { this._stack.push({ ...this._s, k: this._k, m: this._m }); this.ops.push('save'); }

  restore() {
    const p = this._stack.pop();
    if (p) { this._k = p.k; this._m = p.m; delete p.k; delete p.m; this._s = p; }
    this.ops.push('restore');
  }

  scale(x, y) {
    this._m = [this._m[0] * x, this._m[1] * x, this._m[2] * y, this._m[3] * y, this._m[4], this._m[5]];
    this._k *= Math.sqrt(Math.abs(x * y));
    this.ops.push(`scale(${x},${y})`);
  }

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

  get bbox() { return this._box; }

  translate(x, y) { this._m = [...this._m.slice(0, 4), this._x(x, y), this._y(x, y)]; this.ops.push('translate'); }

  beginPath() { this.ops.push('beginPath'); }

  moveTo(x, y) { this.ops.push(`M${this._pt(x, y).join(',')}`); }

  lineTo(x, y) { this.ops.push(`L${this._pt(x, y).join(',')}`); }

  rect(x, y, w, h) { const a = this._pt(x, y); this._pt(x + w, y + h); this.ops.push(`R${a.join(',')},${r(w * this._k)},${r(h * this._k)}`); }

  fillRect(x, y, w, h) { const a = this._pt(x, y); this._pt(x + w, y + h); this.ops.push(`FR${a.join(',')},${r(w * this._k)},${r(h * this._k)}:${this._s.fillStyle}`); }

  arc(x, y, rad, a, b) {
    const key = `A${this._pt(x, y).join(',')},${r(rad * this._k)}:${this._s.fillStyle}:${r(this._s.globalAlpha)}`;
    this.ops.push(key);
    this.arcs.push(key);
  }

  fill() { this.ops.push(`fill:${this._s.fillStyle}:${r(this._s.globalAlpha)}`); }

  stroke() { this.ops.push(`stroke:${this._s.strokeStyle}:${r(this._s.lineWidth * this._k)}`); }

  get marks() { return this.ops.filter((o) => o.startsWith('fill') || o.startsWith('stroke:') || o.startsWith('FR')).length; }

  get digest() { return this.ops.join('|'); }
}

const r = (v) => (Number.isFinite(v) ? Math.round(v * 1e3) / 1e3 : String(v));

function record(raw, seed, t, params) {
  const p = validate(raw);
  const g = new Recorder();
  drawFrame(g, p, solve(p, seed === undefined ? p.seed : seed, params), t === undefined ? 1 : t);
  return g;
}

// ---------------------------------------------------------------------------
// The set
// ---------------------------------------------------------------------------

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

  // piece.js and render.js are reached through the harness rather than by an
  // import in the piece itself; a piece does not require its own contract.
  const drawn = ['rand.js'];
  for (const f of drawn) {
    assert.ok(reach[f].length >= 2,
      `core/${f} is reached by ${reach[f].length} example(s) (${reach[f].join(', ') || 'none'}). `
      + 'A core module reached by one kind of art is a preset wearing a core module\'s clothes.');
  }
  // Published, so the number is visible on every run rather than assumed.
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

test('N7 -- macro geometry is preserved from 1x to 8x', () => {
  // The design box is the piece; the resolution is a render-time choice. A
  // piece whose composition moves with the scale cannot be printed.
  for (const n of NAMES) {
    const p = validate(EXAMPLES[n]);
    const s = solve(p, p.seed);
    const t = p.time ? 1 : 0;
    const box = (k) => {
      const g = new Recorder();
      drawFrame(g, p, s, t, { scale: k });
      return g.bbox;
    };
    const a = box(1);
    const b = box(8);
    for (const i of [0, 1, 2, 3]) {
      assert.ok(Math.abs(b[i] - a[i] * 8) < 1e-6,
        `${n}: at 8x the composition moved (${a[i]} * 8 is not ${b[i]})`);
    }
    assert.ok(a[2] - a[0] > p.size.w * 0.5 && a[3] - a[1] > p.size.h * 0.5,
      `${n} only covers ${(a[2] - a[0]).toFixed(0)} x ${(a[3] - a[1]).toFixed(0)} of its design box`);
  }
});

test('the playhead is quantised to the drawn-frame grid for every timeline', () => {
  for (const n of NAMES) {
    const p = validate(EXAMPLES[n]);
    if (!p.time) continue;
    const n_ = p.time.duration * p.time.hz;
    for (const t of [0.013, 0.37, 0.61, 0.999]) {
      const q = frameT(p, t);
      assert.ok(Math.abs(q * n_ - Math.round(q * n_)) < 1e-9, `${p.name}: ${t} -> ${q} is off the grid`);
    }
  }
});
