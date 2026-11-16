'use strict';

// core/finish.js: a declared film finish, applied by drawFrame. Node has no
// canvas, so these checks run on a stand-in context that applies transforms for
// real and records every fill and image drawn with its composite operation,
// alpha and paint, and on stand-in canvases that keep the bytes put on them and
// average the bytes of a frame drawn into them. How the passes look, and what
// they cost, is checked in a browser.

const test = require('node:test');
const assert = require('node:assert');
const { validate, solve } = require('../core/piece.js');
const { drawFrame, renderVector } = require('../core/render.js');
const { gate, glow, halo, curve, FLICKER } = require('../core/finish.js');
const { rgb, toLinear } = require('../core/colour.js');

// Each block of a w x h grid over n samples: its first and one past its last.
const block = (i, n, of) => [Math.floor((i * n) / of), Math.max(Math.floor((i * n) / of) + 1, Math.floor(((i + 1) * n) / of))];

const DOCUMENT = {
  made: [],
  createElement() {
    const c = { width: 0, height: 0 };
    const ctx = {
      createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      putImageData(img) { c.bytes = img.data; },
      getImageData: (x, y, w, h) => ({ width: w, height: h, data: c.bytes || new Uint8ClampedArray(w * h * 4) }),
      // The mean of each source block: halving a frame averages 2 x 2 blocks.
      drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh) {
        c.bytes = new Uint8ClampedArray(c.width * c.height * 4);
        c.from = [sx, sy, sw, sh, dx, dy, dw, dh];
        DOCUMENT.read = c;
        if (!src.bytes) return;
        for (let y = 0; y < dh; y++) {
          const [y0, y1] = block(y, sh, dh);
          for (let x = 0; x < dw; x++) {
            const [x0, x1] = block(x, sw, dw);
            for (let q = 0; q < 4; q++) {
              let v = 0;
              for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) v += src.bytes[4 * ((sy + yy) * src.width + sx + xx) + q];
              c.bytes[4 * (y * c.width + x) + q] = v / ((y1 - y0) * (x1 - x0));
            }
          }
        }
      },
    };
    c.getContext = (type, opt) => { c.opt = opt; return ctx; };
    this.made.push(c);
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
    this.imageSmoothingEnabled = true;
    this.imageSmoothingQuality = 'low';
  }

  get state() { return [this.m, this.globalAlpha, this.globalCompositeOperation, this.fillStyle, this.imageSmoothingEnabled, this.imageSmoothingQuality]; }

  set state(s) { [this.m, this.globalAlpha, this.globalCompositeOperation, this.fillStyle, this.imageSmoothingEnabled, this.imageSmoothingQuality] = s; }

  save() { this.stack.push(this.state); }

  restore() {
    const s = this.stack.pop();
    if (s) this.state = s;
  }

  getTransform() { const [a, b, c, d, e, f] = this.m; return { a, b, c, d, e, f }; }

  setTransform(...m) { this.m = m; }

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

  drawImage(image, x, y, w, h) {
    this.fills.push({ op: this.globalCompositeOperation, alpha: this.globalAlpha, image, bytes: Buffer.from(image.bytes), m: this.getTransform(), rect: [x, y, w, h] });
  }

  beginPath() {}

  rect(x, y, w, h) { this.path = { m: this.getTransform(), rect: [x, y, w, h] }; }

  clip() { this.clipped = this.path; }

  createPattern(image, repetition) { return { image, repetition }; }

  createRadialGradient(...circles) {
    return { circles, stops: [], addColorStop(at, colour) { this.stops.push([at, colour]); } };
  }
}

const W = 160;
const H = 90;
const FULL = { grain: 0.4, weave: 2, flicker: 0.025, vignette: 0.5, grade: { black: '#201810', white: '#f0e8d8', tone: '#8a6a45', toning: 0.3 } };

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
    [{ grain: 0.2, grainSize: 0.2 }, /finish\.grainSize must be a number in \[0\.5, 6\]/],
    [{ grain: 0.2, grainSize: '2' }, /finish\.grainSize must be a number in \[0\.5, 6\]/],
    [{ flicker: '0.1' }, /finish\.flicker must be a number in \[0, 0\.025\]/],
    [{ vignette: -0.1 }, /finish\.vignette must be a number in \[0, 1\]/],
    [{ bloom: 1.2 }, /finish\.bloom must be a number in \[0, 1\]/],
    [{ bloom: true }, /finish\.bloom must be a number in \[0, 1\]/],
    [{ weave: -1 }, /finish\.weave must be a non-negative number of design units/],
    [{ halation: 2 }, /finish\.halation must be a number in \[0, 1\]/],
    [{ grade: '#fff' }, /finish\.grade must be \{ black, white, tone, toning, red, green, blue, shadows, highlights \}/],
    [{ grade: { red: 0.5 } }, /finish\.grade\.red must be \{ toe, mid, shoulder \}/],
    [{ grade: { green: { knee: 0.5 } } }, /unknown key\(s\) in finish\.grade\.green: knee; known: toe, mid, shoulder/],
    [{ grade: { blue: { toe: 1.5 } } }, /finish\.grade\.blue\.toe must be a number in \[0, 1\]/],
    [{ grade: { red: { shoulder: -0.1 } } }, /finish\.grade\.red\.shoulder must be a number in \[0, 1\]/],
    [{ grade: { red: { mid: 0 } } }, /finish\.grade\.red\.mid must be a number between 0 and 1, not either end/],
    [{ grade: { red: { mid: 1 } } }, /finish\.grade\.red\.mid must be a number between 0 and 1, not either end/],
    [{ grade: { shadows: '#203040' } }, /finish\.grade\.shadows must be \{ tint, amount \}/],
    [{ grade: { shadows: { tint: '#203040', amount: 0.2, at: 0.3 } } }, /unknown key\(s\) in finish\.grade\.shadows: at; known: tint, amount/],
    [{ grade: { highlights: { amount: 0.2 } } }, /finish\.grade\.highlights\.tint must be a #rrggbb colour/],
    [{ grade: { highlights: { tint: '#ffa040', amount: 2 } } }, /finish\.grade\.highlights\.amount must be a number in \[0, 1\]/],
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
  const bloom = piece({ bloom: 0.5 });
  assert.equal(renderVector(bloom, { t: 0.5 }).svg, renderVector(plain, { t: 0.5 }).svg, 'an SVG keeps the marks without a bloom');
  const bare = new Surface(W, H);
  delete bare.canvas;
  assert.deepEqual(frame(bloom, solve(bloom, 1), 5, 1, bare).map((x) => x.op), ['source-over'], 'no canvas, no bloom');
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

test('a declared grain size scales the grain and nothing else; size 1 is the grain as it was', () => {
  const m = (finish) => { const p = piece(finish); return grainOf(frame(p, solve(p, 5), 3)).m; };
  const plain = m({ grain: 0.3 });
  assert.deepEqual(m({ grain: 0.3, grainSize: 1 }), plain, 'size 1 draws the same grain');
  const coarse = m({ grain: 0.3, grainSize: 3 });
  assert.ok(Math.abs(coarse.a / plain.a - 3) < 1e-9 && Math.abs(coarse.d / plain.d - 3) < 1e-9, 'three times the grain');
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
  const p = piece({ flicker: FLICKER });
  const dips = [];
  for (let seed = 1; seed <= 8; seed++) {
    const solved = solve(p, seed);
    for (let f = 0; f < 24; f++) dips.push(frame(p, solved, f).find((x) => x.paint === '#000000').alpha);
  }
  assert.ok(dips.every((x) => x >= 0 && x <= FLICKER), 'a dip within its amount, so neighbouring frames differ by at most FLICKER');
  assert.ok(Math.max(...dips) > FLICKER / 2 && new Set(dips).size > 180, 'the exposure changes from frame to frame');
});

test('the deepest flicker cannot flash any picture', () => {
  const lin = (level) => toLinear(level / 255);
  // Black at alpha FLICKER over every level, rounded and then one level darker
  // still. A pixel's luminance is a weighted mean of its channels and an area's
  // is the mean of its pixels, so no area can dip by the 0.1 a general flash
  // needs. A red's (R - G - B) x 320 falls by at most its R channel's fall
  // x 320, so it stays within the 20 of WCAG 2.0's red flash; the dip keeps
  // a colour's chromaticity almost exactly, so it makes none by WCAG 2.2's.
  for (let v = 0; v < 256; v++) {
    const dipped = Math.max(0, Math.round(v * (1 - FLICKER)) - 1);
    assert.ok(lin(v) - lin(dipped) < 0.1, `level ${v} dips to ${dipped}: a general flash`);
    assert.ok(320 * (lin(v) - lin(dipped)) <= 20, `level ${v} dips to ${dipped}: a red flash`);
  }
  assert.equal(piece({ flicker: FLICKER }).finish.flicker, FLICKER);
  assert.throws(() => piece({ flicker: FLICKER + 0.001 }), /finish\.flicker must be a number in \[0, 0\.025\]: a deeper dip can flash the whole frame/);
});

test('the finish leaves the surface as it found it', () => {
  const graded = { ...FULL, bloom: 0.5, halation: 0.4, grade: { ...FULL.grade, red: { mid: 0.6 }, shadows: { tint: '#405070', amount: 0.3 } } };
  for (const finish of [FULL, { ...FULL, bloom: 0.5 }, graded]) {
    const p = piece(finish);
    const g = new Surface(W * 3, H * 3);
    g.canvas.bytes = pixels(W * 3, H * 3, () => [20, 20, 30]);
    drawFrame(g, p, solve(p, 1), 0.5, { scale: 3 });
    assert.deepEqual(g.getTransform(), { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    assert.deepEqual([g.globalAlpha, g.globalCompositeOperation, g.imageSmoothingQuality, g.stack.length], [1, 'source-over', 'low', 0]);
  }
});

/** A w x h RGBA frame: `at(x, y)` gives each pixel's [r, g, b]. */
function pixels(w, h, at) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      d.set([...at(x, y), 255], 4 * (y * w + x));
    }
  }
  return d;
}

/** The cw x ch glow of a sw x sh frame, as rows of [r, g, b]. */
function glowOf(src, sw, sh, cw, ch) {
  const out = new Uint8ClampedArray(cw * ch * 4);
  glow(src, sw, sh, out, cw, ch);
  return Array.from({ length: ch }, (_, y) => Array.from({ length: cw }, (_, x) => [...out.slice(4 * (y * cw + x), 4 * (y * cw + x) + 3)]));
}

const DARK = [20, 20, 30];
const glowsOf = (fills) => fills.filter((x) => x.image);

test('a finish without bloom reads no pixels', () => {
  for (const finish of [FULL, { ...FULL, bloom: 0, halation: 0 }]) {
    const p = piece(finish);
    const g = new Surface(W, H);
    g.canvas.bytes = pixels(W, H, () => [255, 255, 255]);
    const made = DOCUMENT.made.length;
    frame(p, solve(p, 1), 3, 1, g);
    assert.deepEqual(glowsOf(g.fills), [], JSON.stringify(finish.bloom));
    assert.ok(DOCUMENT.made.slice(made).every((c) => c.width === 512), 'only the grain tile is made');
  }
});

test('the bloom comes first: its glow added over the whole frame before the grain', () => {
  const p = piece({ ...FULL, bloom: 0.4 });
  const g = new Surface(W * 2, H * 2);
  g.canvas.bytes = pixels(W * 2, H * 2, (x, y) => (Math.hypot(x - W, y - H) < 12 ? [255, 250, 240] : DARK));
  const fills = frame(p, solve(p, 1), 4, 2, g);
  assert.deepEqual(fills.map((x) => x.op), ['source-over', 'lighter', 'soft-light', 'color', 'multiply', 'screen', 'source-over', 'source-over']);
  const [, bloom] = fills;
  assert.equal(bloom.alpha, 0.4);
  const { m, rect } = bloom;
  assert.deepEqual([m.a * rect[0] + m.e, m.d * rect[1] + m.f, m.a * rect[2], m.d * rect[3]], [0, 0, W * 2, H * 2], 'the glow covers the frame');
  const half = DOCUMENT.made.find((c) => c.width === W && c.height === H && c.opt && c.opt.willReadFrequently);
  assert.ok(half, 'the frame is read at half size from a canvas kept for reading');
  const { width: cw, height: ch } = bloom.image;
  const lit = (x, y) => bloom.bytes[4 * (y * cw + x)];
  assert.ok(lit(cw / 2, ch / 2) > 40 && lit(0, 0) === 0, `the glow sits on the light: ${lit(cw / 2, ch / 2)} there, ${lit(0, 0)} in a corner`);
});

test('the bloom keeps only the light above its knee, growing from nothing at the knee', () => {
  const level = (v) => glowOf(pixels(8, 8, () => [v, v, v]), 8, 8, 4, 4)[2][2][0];
  assert.deepEqual([0, 100, 127, 128].map(level), [0, 0, 0, 0], 'light at or below the knee does not bloom');
  assert.ok(level(129) <= 2, `just past the knee the glow is ${level(129)}: a light brightening past it must not pop on`);
  const up = [140, 180, 220, 255].map(level);
  assert.ok(up.every((v, i) => i === 0 || v > up[i - 1]) && up[3] === 255, `brighter light, more glow: ${up}`);
  // A light on a ground just under the knee glows as it does on black: the
  // ground neither blooms nor takes glow away.
  const spot = (ground) => glowOf(pixels(40, 40, (x, y) => (x === 20 && y === 20 ? [255, 255, 255] : ground)), 40, 40, 20, 20);
  assert.deepEqual(spot([120, 120, 120]), spot([0, 0, 0]));
  // Its bytes are unpremultiplied: white at alpha 0.05 is faint light, not white.
  const faint = pixels(8, 8, () => [255, 255, 255]);
  for (let i = 3; i < faint.length; i += 4) faint[i] = 13;
  assert.equal(glowOf(faint, 8, 8, 4, 4)[2][2][0], 0, 'a faint pixel is as dark as its light');
  // Opaque pixels take a quicker path: a light just short of opaque glows as it nearly does.
  for (const v of [140, 200, 255]) {
    const near = pixels(8, 8, () => [v, v, v]);
    for (let i = 3; i < near.length; i += 4) near[i] = 254;
    const [a, b] = [level(v), glowOf(near, 8, 8, 4, 4)[2][2][0]];
    assert.ok(b <= a && a - b <= 4, `at ${v}, opaque glows ${a} and alpha 254 glows ${b}`);
  }
});

test('the bloom spreads light evenly: round, and out to the frame\'s edges', () => {
  const rows = glowOf(pixels(42, 42, (x, y) => (x >= 20 && x < 22 && y >= 20 && y < 22 ? [255, 255, 255] : [0, 0, 0])), 42, 42, 21, 21);
  const at = (x, y) => rows[y][x][0];
  assert.ok(at(10, 10) > 0, 'the light glows where it is');
  for (let d = 1; d <= 3; d++) {
    assert.ok(at(10 + d, 10) > 0 && at(10 + d, 10) === at(10, 10 + d) && at(10 - d, 10) === at(10, 10 - d), `as far across as down at ${d}`);
    assert.ok(at(10 + d, 10) <= at(10 + d - 1, 10), `falling off with distance at ${d}`);
  }
  assert.equal(at(0, 0), 0, 'the glow ends');
  const full = glowOf(pixels(16, 10, () => [255, 255, 255]), 16, 10, 8, 5).flat();
  assert.ok(full.every(([r, g, b]) => r === 255 && g === 255 && b === 255), 'a frame lit all over glows all over, to its edges and corners');
});

test('the bloom is the same share of the frame at any scale', () => {
  const p = piece({ bloom: 0.5 });
  const solved = solve(p, 1);
  const sizes = [];
  for (const k of [1, 3, 2]) {
    const g = new Surface(W * k, H * k);
    g.canvas.bytes = pixels(W * k, H * k, (x, y) => (Math.abs(x / k - W / 2) < 6 && Math.abs(y / k - H / 2) < 6 ? [255, 255, 255] : DARK));
    const [bloom] = glowsOf(frame(p, solved, 0, k, g));
    sizes.push([bloom.image.width, bloom.image.height]);
    assert.deepEqual([DOCUMENT.read.width, DOCUMENT.read.height], [W * k / 2, H * k / 2], `scale ${k}: the frame is read at half its ${W * k} x ${H * k}`);
    const { width: cw, height: ch } = bloom.image;
    assert.ok(bloom.bytes[4 * ((ch / 2) * cw + cw / 2)] > 0, `scale ${k}: the light blooms, read from ${W * k / 2} x ${H * k / 2} into ${cw} x ${ch}`);
  }
  assert.deepEqual(sizes, [sizes[0], sizes[0], sizes[0]], 'one copy size whatever the scale');
});

test('the bloom is a function of the frame\'s pixels alone', () => {
  const p = piece({ bloom: 0.5 });
  const bytes = pixels(W, H, (x, y) => ((x * 7 + y * 3) % 23 < 4 ? [255, 230, 200] : DARK));
  const glowAt = (seed, f, g = new Surface(W, H)) => {
    g.canvas.bytes = bytes;
    return glowsOf(frame(p, solve(p, seed), f, 1, g))[0].bytes;
  };
  const g = new Surface(W, H);
  const fresh = glowAt(5, 7);
  for (const [seed, f] of [[5, 7], [5, 0], [6, 7], [5, 3]]) assert.ok(glowAt(seed, f, g).equals(fresh), `seed ${seed}, frame ${f}`);
});

test('a surface that cannot make a canvas refuses the bloom by name', () => {
  const p = piece({ bloom: 0.5 });
  const g = new Surface(W, H);
  delete g.canvas.ownerDocument;
  assert.throws(() => frame(p, solve(p, 1), 0, 1, g), /finish: this surface has a canvas but no way to make another, so its bloom cannot be drawn/);
  for (const [finish, part] of [[{ halation: 0.5 }, 'halation'], [{ grade: { red: { mid: 0.6 } } }, 'grade']]) {
    const q = piece(finish);
    const bare = new Surface(W, H);
    delete bare.canvas.ownerDocument;
    assert.throws(() => frame(q, solve(q, 1), 0, 1, bare), new RegExp(`no way to make another, so its ${part} cannot be drawn`));
  }
});

const Y = ([r, g, b]) => (54 * r + 183 * g + 19 * b) / 256;

test('a tone curve is straight at its defaults, never turns back, and lands its ends', () => {
  for (const c of [curve(), curve({})]) assert.ok(c.every((v, i) => Math.round(v) === i), 'the defaults are the straight line');
  for (const toe of [0, 0.5, 1]) {
    for (const mid of [0.05, 0.2, 0.5, 0.8, 0.95]) {
      for (const shoulder of [0, 0.5, 1]) {
        const c = curve({ toe, mid, shoulder });
        const turn = c.findIndex((v, i) => i > 0 && v < c[i - 1]);
        assert.equal(turn, -1, `toe ${toe}, mid ${mid}, shoulder ${shoulder}: falls at level ${turn}`);
        assert.ok(c[0] === 0 && Math.abs(c[255] - 255) < 1e-9, `toe ${toe}, mid ${mid}, shoulder ${shoulder}: black and white stay put`);
      }
    }
  }
  const middle = (c) => (c[127] + c[128]) / 2;
  assert.ok(Math.abs(middle(curve({ mid: 0.7 })) - 0.7 * 255) < 2, `mid lands the middle input: ${middle(curve({ mid: 0.7 }))}`);
  assert.ok(curve({ toe: 1 })[40] < 36, `a toe presses the shadows down: level 40 to ${curve({ toe: 1 })[40]}`);
  assert.ok(curve({ shoulder: 1 })[215] > 219, `a shoulder rolls the highlights up into white: level 215 to ${curve({ shoulder: 1 })[215]}`);
});

/** The frame the grade draws back, from a W x H frame `at(x, y)` gives the pixels of, as rows of [r, g, b]. */
function graded(grade, at, scale = 1, seed = 1, f = 0) {
  const p = piece({ grade });
  const g = new Surface(W * scale, H * scale);
  g.canvas.bytes = pixels(W * scale, H * scale, at);
  const fills = frame(p, solve(p, seed), f, scale, g);
  const back = fills.find((x) => x.op === 'copy');
  return { fills, back, at: (x, y) => [...back.bytes.slice(4 * (y * W * scale + x), 4 * (y * W * scale + x) + 3)] };
}

test('the grade curves and tints the frame read 1:1, between its tone and its ends', () => {
  const grade = { tone: '#8a6a45', toning: 0.2, black: '#101010', red: { mid: 0.7 }, shadows: { tint: '#4060a0', amount: 0.5 } };
  const { fills, back, at } = graded(grade, () => [128, 128, 128], 2);
  assert.deepEqual(fills.map((x) => x.op), ['source-over', 'color', 'copy', 'multiply', 'screen']);
  assert.deepEqual([DOCUMENT.read.width, DOCUMENT.read.height, DOCUMENT.read.opt.willReadFrequently], [W * 2, H * 2, true], 'read at the frame\'s own size, from a canvas kept for reading');
  const { m, rect } = back;
  assert.deepEqual([m.a * rect[0] + m.e, m.d * rect[1] + m.f, m.a * rect[2], m.d * rect[3]], [0, 0, W * 2, H * 2], 'drawn back over the frame');
  assert.equal(back.alpha, 1);
  assert.ok(at(W, H)[2] > at(W, H)[1], `the shadow tint is laid: ${at(W, H)}`);
  const [r, g, b] = graded({ red: { mid: 0.7 } }, () => [128, 128, 128]).at(W / 2, H / 2);
  assert.ok(Math.abs(r - 178) <= 2 && g === 128 && b === 128, `the red curve moves red alone: ${[r, g, b]}`);
  const again = (seed, f) => graded(grade, () => [128, 128, 128], 2, seed, f).back.bytes;
  assert.ok([[1, 5], [7, 0]].every(([seed, f]) => again(seed, f).equals(back.bytes)), 'the same pixels on every seed and frame');
});

test('the grade reads and draws back whole pixels at a scale that does not divide the frame', () => {
  for (const scale of [1.37, 1.63]) {
    const [pw, ph] = [Math.round(W * scale), Math.round(H * scale)];
    const p = piece({ grade: { red: {} } });
    const g = new Surface(pw, ph);
    g.canvas.bytes = pixels(pw, ph, (x, y) => [x % 256, y % 256, (x + y) % 256]);
    const back = frame(p, solve(p, 1), 0, scale, g).find((x) => x.op === 'copy');
    const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    assert.deepEqual(DOCUMENT.read.from, [0, 0, pw, ph, 0, 0, pw, ph], `scale ${scale}: the ${pw} x ${ph} canvas read 1:1`);
    assert.deepEqual([back.m, back.rect], [identity, [0, 0, pw, ph]], `scale ${scale}: drawn back on the same pixels`);
    assert.deepEqual([g.clipped.m, g.clipped.rect], [identity, [0, 0, pw, ph]], `scale ${scale}: clipped to whole pixels, so 'copy' clears no edge`);
    const moved = back.bytes.findIndex((v, i) => v !== g.canvas.bytes[i]);
    assert.equal(moved, -1, `scale ${scale}: an identity grade gives back the frame's pixels, first change at byte ${moved}`);
  }
});

test('split tints change the hue of shadows and highlights, not their lightness', () => {
  const grade = { shadows: { tint: '#4060a0', amount: 0.5 }, highlights: { tint: '#ffa040', amount: 0.5 } };
  const { at } = graded(grade, (x) => {
    const v = Math.round((255 * x) / (W - 1));
    return [v, v, v];
  });
  const [black, white] = [at(0, 0), at(W - 1, 0)];
  assert.ok(black[2] > black[0] && black[0] === 0, `the shadows take the cool tint: black to ${black}`);
  assert.ok(white[0] >= white[1] && white[1] > white[2], `the highlights take the warm tint: white to ${white}`);
  for (let x = 40; x < 120; x++) {
    const v = Math.round((255 * x) / (W - 1));
    const out = at(x, 0);
    assert.ok(Math.abs(Y(out) - v) <= 1, `level ${v} keeps its lightness: ${out}`);
  }
  const [mid] = [at(40, 0)];
  assert.ok(mid[2] > mid[0], `a dark middle tone leans to the shadow tint: ${mid}`);
});

/** The cw x ch halation of a sw x sh frame, as rows of [r, g, b]. */
function haloOf(src, sw, sh, cw, ch) {
  const out = new Uint8ClampedArray(cw * ch * 4);
  halo(src, sw, sh, out, cw, ch);
  return Array.from({ length: ch }, (_, y) => Array.from({ length: cw }, (_, x) => [...out.slice(4 * (y * cw + x), 4 * (y * cw + x) + 3)]));
}

test('the halation fringes only past the edges of light above the bloom knee', () => {
  const square = (light) => haloOf(pixels(80, 80, (x, y) => (x >= 20 && x < 60 && y >= 20 && y < 60 ? light : DARK)), 80, 80, 40, 40);
  const rows = square([255, 255, 255]);
  const inside = [], outside = [];
  for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) (x >= 10 && x < 30 && y >= 10 && y < 30 ? inside : outside).push(rows[y][x]);
  assert.ok(inside.every((p) => p.every((v) => v === 0)), 'none on the light itself');
  const [r, g, b] = rows[20][9];
  assert.ok(r > 40 && r > g && g > b, `a red-orange fringe just past the edge: ${[r, g, b]}`);
  assert.ok(rows[20][6].every((v) => v === 0) && rows[2][2].every((v) => v === 0), 'and none further out');
  assert.ok(outside.some((p) => p[0] > 0), 'the fringe is outside the light');
  assert.ok(square([120, 120, 120]).flat().every((p) => p.every((v) => v === 0)), 'light under the knee casts none');
});

test('the halation adds its fringe after the bloom, from the same read, leaving the glow as it was', () => {
  const bytes = pixels(W, H, (x, y) => (Math.abs(x - W / 2) < 20 && Math.abs(y - H / 2) < 12 ? [255, 250, 240] : DARK));
  const drawn = (finish) => {
    const p = piece(finish);
    const g = new Surface(W, H);
    g.canvas.bytes = bytes;
    return frame(p, solve(p, 1), 0, 1, g);
  };
  const plain = drawn({ bloom: 0.5 });
  const both = drawn({ bloom: 0.5, halation: 0.3, grain: 0.2 });
  assert.deepEqual(both.map((x) => x.op), ['source-over', 'lighter', 'lighter', 'soft-light']);
  assert.ok(both[1].bytes.equals(plain[1].bytes), 'the bloom\'s glow is the same with a halation');
  assert.equal(both[2].alpha, 0.3);
  const alone = drawn({ halation: 0.3 });
  assert.deepEqual(alone.map((x) => x.op), ['source-over', 'lighter']);
  assert.ok(alone[1].bytes.equals(both[2].bytes), 'the fringe is the same with or without a bloom');
  assert.ok(alone[1].bytes.some((v, i) => i % 4 === 0 && v > 0), 'the fringe is lit');
});
