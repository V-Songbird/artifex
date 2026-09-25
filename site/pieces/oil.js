// Oil paint as a material: a dab laid by a brush and a smear dragged by a
// knife. A dab is a small height field lit by the one light, as thick paint
// catches it: paint pushed into a ridge along each side, furrowed by the
// bristles between them, each bristle's streak a little lighter or darker,
// thicker where the brush touched down, crested where it lifted, its dry end
// breaking into strands, glossy on its ridges and casting a short shadow on
// what lies beneath. A smear is paint dragged thin, grained along its length.
//
// ONCE PER SCALE. A dab's body and its light are drawn once into sprites per
// solve and device scale -- a body per colour and shape, a light per shape and
// per sixteenth of a turn against the light -- and every dab after is two
// copies from them, turned and stretched to it. On a surface with no canvas
// the dabs are drawn as plain ellipses with a lit and a dark ridge.
//
// All in the sheet's units.

'use strict';

const { mix } = require('../../core/colour.js');

const TAU = Math.PI * 2;
const SHAPES = 6;                 // kinds of dab
const TURNS = 16;                 // lights per kind, a sixteenth of a turn apart
const PX = 1.2, PY = 1.8;         // a dab's cell, in its own length and width either way
const LIFT = Math.PI * 0.26;      // the light's height over the canvas
const SMEARS = 3;                 // kinds of smear

const hash = (a, b, c) => {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Smooth value noise in [0, 1], `seed` choosing the field. */
function vnoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed), c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const rgbOf = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * A dab of shape `k` at (x, y) in its own units (along -1..1 from touchdown to
 * lift, across -1..1): its height, its cover and the tint of the bristle that
 * laid it. The brush pushes paint to the stroke's sides, so it stands in two
 * low ridges either side of a furrowed plateau, thickest where it touched
 * down, crested where it lifted, its dry end breaking into strands.
 */
function dabField(k, x, y) {
  const bend = (hash(k, 1, 7) - 0.5) * 0.24, c = bend * (x * x - 0.3);
  const end = Math.abs(x) - 0.45;
  const w = end <= 0 ? 1 : Math.sqrt(Math.max(0, 1 - (end / 0.55) ** 2)) * (x > 0 ? 1 - 0.15 * end : 1);
  const d = Math.abs(y - c);
  if (w <= 0 || d >= w) return [0, 0, 0];
  const q = d / w;
  const across = 0.55 + 0.4 * Math.exp(-(((1 - q) / 0.16) ** 2)) - 0.25 * q ** 8;
  const along = 0.8 + 0.35 * Math.exp(-(((x + 0.6) / 0.35) ** 2)) + 0.45 * Math.exp(-(((x - (0.62 + 0.12 * hash(k, 3, 7))) / 0.09) ** 2)) * (1 - q * q);
  const bristles = 10 + (k % 4), at = ((y - c) / w + 1) * 0.5 * bristles + 0.3 * Math.sin(2.3 * x + k);
  const which = Math.floor(at), groove = 0.5 - 0.5 * Math.cos(TAU * (at - which));
  const depth = (0.08 + 0.2 * smooth(0.1, 1, x)) * (0.6 + 0.8 * hash(which, k, 9));
  const h = across * along * (1 - depth * groove);
  let cover = Math.min(1, (w - d) * 6);
  // The strands the dry end breaks into.
  if (x > 0.55 && hash(which, k, 13) < smooth(0.55, 1, x) * 0.8) cover *= 0.1;
  return [cover > 0 ? h : 0, cover, hash(which, k, 17) - 0.5];
}

/** A smear of kind `k` at (x, y): along 0..1 from where the paint was to where the knife took it, across -1..1: its cover and its grain. */
function smearField(k, x, y) {
  if (x < 0 || x > 1) return [0, 0];
  const w = (1 - 0.7 * x) * (0.85 + 0.15 * Math.sin(x * 5 + k));
  const d = Math.abs(y);
  if (d > w) return [0, 0];
  // Grained along its length, as the knife's edge drags the paint thin.
  const streak = smooth(0.3, 0.8, vnoise(x * 1.5, (y / w) * 9 + k * 13, 21));
  const edge = smooth(0, 0.5, (w - d) / w);
  const thin = smooth(0, 0.1, x) * (1 - x) ** 1.6 * (0.25 + 0.75 * streak);
  return [thin * edge, streak];
}

function canvasFor(w, h) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
  if (typeof document === 'object' && document && typeof document.createElement === 'function') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return null;
}

// Sprites per solve and scale.
const kept = new WeakMap();

/** The oil's sprites for surface `g` at its current transform, or null where none can be kept. */
function sprites(g, s) {
  if (!g.canvas || typeof g.drawImage !== 'function' || typeof g.getTransform !== 'function') return null;
  const m = g.getTransform(), k = Math.round(Math.hypot(m.a, m.b) * 64) / 64;
  let bySolve = kept.get(s);
  if (!bySolve) kept.set(s, bySolve = new Map());
  let sp = bySolve.get(k);
  if (sp === undefined) {
    sp = make(s, k);
    bySolve.set(k, sp);
  }
  return sp;
}

function make(s, k) {
  const o = s.oil, cw = Math.ceil(2 * PX * o.len * k), ch = Math.ceil(2 * PY * o.wide * k);
  const cols = o.colours.length;
  const body = canvasFor(cw * SHAPES, ch * cols), light = canvasFor(cw * SHAPES, ch * TURNS);
  const sw = Math.ceil(o.smear * k), sh = Math.ceil(2 * o.wide * 1.3 * k), smear = canvasFor(sw * SMEARS, sh * cols);
  if (!body || !light || !smear) return null;
  const hpx = o.wide * k * 0.4;                  // a dab's height, in pixels
  const L = o.light;
  const bi = body.getContext('2d').createImageData(cw * SHAPES, ch * cols);
  const li = light.getContext('2d').createImageData(cw * SHAPES, ch * TURNS);
  const rgbs = o.colours.map(rgbOf);
  for (let v = 0; v < SHAPES; v++) {
    const H = new Float32Array(cw * ch), C = new Float32Array(cw * ch), G = new Float32Array(cw * ch), T = new Float32Array(cw * ch);
    for (let py = 0; py < ch; py++) {
      for (let px = 0; px < cw; px++) {
        const x = ((px + 0.5) / cw) * 2 * PX - PX, y = ((py + 0.5) / ch) * 2 * PY - PY;
        const [h, cov, tint] = dabField(v, x, y);
        H[py * cw + px] = h * hpx;
        C[py * cw + px] = cov;
        G[py * cw + px] = h;
        T[py * cw + px] = tint;
      }
    }
    // Bodies: the colour, each bristle's streak a little lighter or darker, as mixed paint lays it.
    for (let ci = 0; ci < cols; ci++) {
      const [r, gr, b] = rgbs[ci];
      for (let py = 0; py < ch; py++) {
        for (let px = 0; px < cw; px++) {
          const i = py * cw + px, cov = C[i];
          if (cov <= 0) continue;
          const f = 0.94 + 0.06 * Math.min(1, G[i]) + 0.14 * T[i];
          const o4 = ((ci * ch + py) * cw * SHAPES + v * cw + px) * 4;
          bi.data[o4] = Math.min(255, r * f);
          bi.data[o4 + 1] = Math.min(255, gr * f);
          bi.data[o4 + 2] = Math.min(255, b * f);
          bi.data[o4 + 3] = cov * 255;
        }
      }
    }
    // Lights: each sixteenth of a turn, the furrows and ridges lit, a gloss on their tops, a short shadow beyond.
    for (let t = 0; t < TURNS; t++) {
      const a = (t / TURNS) * TAU, lx = Math.cos(a) * Math.cos(LIFT), ly = Math.sin(a) * Math.cos(LIFT), lz = Math.sin(LIFT);
      const hl = Math.hypot(lx, ly, lz + 1), hx = lx / hl, hy = ly / hl, hz = (lz + 1) / hl;
      const sd = o.wide * k * 0.45, sx = -Math.cos(a) * sd, sy = -Math.sin(a) * sd;
      for (let py = 0; py < ch; py++) {
        for (let px = 0; px < cw; px++) {
          const i = py * cw + px, cov = C[i];
          const o4 = ((t * ch + py) * cw * SHAPES + v * cw + px) * 4;
          if (cov > 0.5) {
            const l = px > 0 ? H[i - 1] : 0, r = px < cw - 1 ? H[i + 1] : 0, u = py > 0 ? H[i - cw] : 0, d = py < ch - 1 ? H[i + cw] : 0;
            let nx = -(r - l) / 2, ny = -(d - u) / 2, nz = 1;
            const nl = Math.hypot(nx, ny, nz);
            nx /= nl; ny /= nl; nz /= nl;
            const lum = (nx * lx + ny * ly + nz * lz - lz) * 1.25 + 0.45 * Math.max(0, nx * hx + ny * hy + nz * hz) ** 60;
            const white = lum >= 0;
            li.data[o4] = li.data[o4 + 1] = li.data[o4 + 2] = white ? 255 : 20;
            li.data[o4 + 3] = cov * 255 * (white ? Math.min(0.85, lum) : Math.min(0.4, -lum * 0.7));
          } else {
            // The shadow the dab casts on what is beneath, softened.
            let sh = 0;
            for (let j = 1; j <= 4; j++) {
              const qx = Math.round(px - (sx * j) / 4), qy = Math.round(py - (sy * j) / 4);
              if (qx >= 0 && qy >= 0 && qx < cw && qy < ch) sh += C[qy * cw + qx];
            }
            const alpha = (1 - cov) * (sh / 4) * 0.11;
            if (alpha <= 0) continue;
            li.data[o4] = li.data[o4 + 1] = li.data[o4 + 2] = 20;
            li.data[o4 + 3] = alpha * 255;
          }
        }
      }
    }
  }
  body.getContext('2d').putImageData(bi, 0, 0);
  light.getContext('2d').putImageData(li, 0, 0);
  // Smears: thin paint dragged out along the knife, grained.
  const si = smear.getContext('2d').createImageData(sw * SMEARS, sh * cols);
  for (let v = 0; v < SMEARS; v++) {
    for (let py = 0; py < sh; py++) {
      for (let px = 0; px < sw; px++) {
        const [a, grain] = smearField(v, (px + 0.5) / sw, ((py + 0.5) / sh) * 2 - 1);
        if (a <= 0) continue;
        for (let ci = 0; ci < cols; ci++) {
          const [r, gr, b] = rgbs[ci], f = 0.92 + 0.12 * grain;
          const o4 = ((ci * sh + py) * sw * SMEARS + v * sw + px) * 4;
          si.data[o4] = Math.min(255, r * f);
          si.data[o4 + 1] = Math.min(255, gr * f);
          si.data[o4 + 2] = Math.min(255, b * f);
          si.data[o4 + 3] = Math.min(1, a) * 255;
        }
      }
    }
  }
  smear.getContext('2d').putImageData(si, 0, 0);
  return { body, light, smear, cw, ch, sw, sh };
}

/**
 * Build step: the oil's palette and sizes, for `dabs` of { x, y, a, len, wide, colour }.
 * Each dab gains its colour's index `ci` and its shape `k`; `extra` colours are kept for smears and heaps.
 */
function palette(s, dabs, extra, light) {
  const colours = [...new Set([...dabs.map((d) => d.colour), ...extra])];
  const index = new Map(colours.map((c, i) => [c, i]));
  let len = 0, wide = 0;
  dabs.forEach((d, i) => {
    d.ci = index.get(d.colour);
    d.k = Math.floor(hash(i, 5, s.seed) * SHAPES);
    len = Math.max(len, d.len);
    wide = Math.max(wide, d.wide);
  });
  s.oil = { colours, index, len, wide, smear: len * 4, light };
}

/** Build step: more colours for smears and heaps, kept with the palette. */
function add(s, colours) {
  for (const c of colours) if (!s.oil.index.has(c)) { s.oil.index.set(c, s.oil.colours.length); s.oil.colours.push(c); }
}

/** The sprite cell of turn `t` for a dab at angle `a`, against the light at angle `la`. */
const turnOf = (a, la) => ((Math.round(((la - a) / TAU) * TURNS) % TURNS) + TURNS) % TURNS;

/**
 * Dabs `list` (in order), each laid as far as `laidOf(d)` of its length from
 * its touchdown (1 when whole). Two sprite copies each, or plain ellipses on a
 * surface that keeps none.
 */
function drawDabs(g, s, list, laidOf = null) {
  const sp = sprites(g, s);
  if (!sp) { for (const d of list) plain(g, s, d); return; }
  const m = g.getTransform(), la = Math.atan2(s.oil.light[1], s.oil.light[0]);
  g.save();
  g.imageSmoothingEnabled = true;
  for (const d of list) {
    const p = laidOf ? laidOf(d) : 1;
    if (p <= 0) continue;
    const c = Math.cos(d.a), sn = Math.sin(d.a);
    const t0 = d.len * c, t1 = d.len * sn, t2 = -d.wide * sn, t3 = d.wide * c;
    g.setTransform(m.a * t0 + m.c * t1, m.b * t0 + m.d * t1, m.a * t2 + m.c * t3, m.b * t2 + m.d * t3, m.a * d.x + m.c * d.y + m.e, m.b * d.x + m.d * d.y + m.f);
    // Laid from its touchdown: the part of the cell up to where the brush is.
    const u = p >= 1 ? 1 : (PX - 1 + 2 * p) / (2 * PX), cwp = Math.max(1, sp.cw * u), wx = 2 * PX * u;
    g.drawImage(sp.body, d.k * sp.cw, d.ci * sp.ch, cwp, sp.ch, -PX, -PY, wx, 2 * PY);
    if (d.under !== undefined && p >= 1) {
      // The neighbour's paint it dragged, streaked through its tail.
      g.globalAlpha = 0.5;
      g.drawImage(sp.smear, (d.k % SMEARS) * sp.sw, s.oil.index.get(d.under) * sp.sh, sp.sw, sp.sh, -0.4, -0.62, 1.5, 1.24);
      g.globalAlpha = 1;
    }
    g.drawImage(sp.light, d.k * sp.cw, turnOf(d.a, la) * sp.ch, cwp, sp.ch, -PX, -PY, wx, 2 * PY);
  }
  g.restore();
}

/** A dab as the style draws it, where no sprites are kept: a body, a lit ridge and a dark ridge. */
function plain(g, s, d) {
  const L = s.oil.light, sd = -L[0] * Math.sin(d.a) + L[1] * Math.cos(d.a) > 0 ? 1 : -1;
  const c = Math.cos(d.a), sn = Math.sin(d.a), at = (u, v) => [d.x + u * c - v * sn, d.y + u * sn + v * c];
  const ell = (p, rx, ry, fill) => { g.fillStyle = fill; g.beginPath(); g.ellipse(p[0], p[1], rx, ry, d.a, 0, TAU); g.fill(); };
  ell([d.x, d.y], d.len, d.wide, d.colour);
  ell(at(-d.len * 0.1, sd * d.wide * 0.42), d.len * 0.72, d.wide * 0.3, mix(d.colour, '#ffffff', 0.42));
  ell(at(d.len * 0.12, -sd * d.wide * 0.58), d.len * 0.78, d.wide * 0.24, mix(d.colour, '#3a2a1e', 0.38));
}

/**
 * Smears of paint dragged by a knife: each { x, y, a, len, wide, ci, k, alpha },
 * from (x, y) along angle `a` for `len`. Plain translucent strokes where no sprites are kept.
 */
function drawSmears(g, s, list) {
  const sp = sprites(g, s);
  if (!sp) {
    g.save();
    g.lineCap = 'round';
    for (const d of list) {
      g.globalAlpha = 0.3 * d.alpha;
      g.strokeStyle = s.oil.colours[d.ci];
      g.lineWidth = d.wide;
      g.beginPath();
      g.moveTo(d.x, d.y);
      g.lineTo(d.x + Math.cos(d.a) * d.len, d.y + Math.sin(d.a) * d.len);
      g.stroke();
    }
    g.restore();
    return;
  }
  const m = g.getTransform();
  g.save();
  g.imageSmoothingEnabled = true;
  for (const d of list) {
    if (d.len <= 0.5) continue;
    const c = Math.cos(d.a), sn = Math.sin(d.a), w = d.wide * 1.3;
    const t0 = d.len * c, t1 = d.len * sn, t2 = -w * sn, t3 = w * c;
    g.setTransform(m.a * t0 + m.c * t1, m.b * t0 + m.d * t1, m.a * t2 + m.c * t3, m.b * t2 + m.d * t3, m.a * d.x + m.c * d.y + m.e, m.b * d.x + m.d * d.y + m.f);
    g.globalAlpha = d.alpha;
    g.drawImage(sp.smear, (d.k % SMEARS) * sp.sw, d.ci * sp.sh, sp.sw, sp.sh, 0, -1, 1, 2);
  }
  g.restore();
}

module.exports = { palette, add, sprites, drawDabs, drawSmears, vnoise, hash, SHAPES };
