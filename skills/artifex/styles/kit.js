// Drawing helpers the style references share. Subject-neutral: outlines in,
// marks out. Coordinates are design units; nothing here assumes a subject.

'use strict';

const { resample, lengthOf } = require('../../../core/geom.js');
const { grow } = require('../../../core/path.js');
const { noise2 } = require('../../../core/rand.js');
const { sibling } = require('../../../core/layer.js');
const { rgb, hex, toLinear, toSRGB, oklch, oklabOfLinear, luma, contrast } = require('../../../core/colour.js');
const { clamp, clamp01, lerp } = require('../../../core/num.js');

// Place unit points at (x, y) with scale s, optional mirror and rotation.
function place(pts, x, y, s, rot = 0, flip = false) {
  const c = Math.cos(rot); const k = Math.sin(rot); const f = flip ? -1 : 1;
  return pts.map(([u, v]) => [x + (u * f * c - v * k) * s, y + (u * f * k + v * c) * s]);
}

function path(g, pts, close = true) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  if (close) g.closePath();
}

// Add a closed polygon to the current path without starting a new one, for
// unions and even-odd clips. `path` would discard what came before.
function sub(g, pts) {
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
}

// A hand's wobble: resample, then push each point by two independent noises.
function wobble(pts, R, name, amp, step, close = false) {
  const even = resample(pts, step, close);
  return even.map(([x, y], i) => [
    x + (noise2(R, i * 0.23, 1.7, name + 'x') - 0.5) * 2 * amp,
    y + (noise2(R, i * 0.23, 5.3, name + 'y') - 0.5) * 2 * amp,
  ]);
}

function ellipse(cx, cy, rx, ry, n = 48, rot = 0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const u = Math.cos(a) * rx; const v = Math.sin(a) * ry;
    out.push([cx + u * Math.cos(rot) - v * Math.sin(rot), cy + u * Math.sin(rot) + v * Math.cos(rot)]);
  }
  return out;
}

function star(cx, cy, r, points = 5, inner = 0.45, rot = -Math.PI / 2) {
  const out = [];
  for (let i = 0; i < points * 2; i++) {
    const a = rot + (i / (points * 2)) * Math.PI * 2;
    const k = i % 2 ? r * inner : r;
    out.push([cx + Math.cos(a) * k, cy + Math.sin(a) * k]);
  }
  return out;
}

// A dry mark's hairs along an open `spine`: a brush's bristles, a pencil's or
// a charcoal stick's grain. Returns `count` hairs, each { side, w, runs }:
// `side` its place across the stroke from -1 to 1, `w` its own width, `runs`
// the polylines it lays, each of two points or more, each point [x, y, i] with
// i its station on the spine resampled every `step`. The stroke is `width`
// wide at full pressure and `press(t)` (t from 0 to 1 along it) narrows it.
// Every hair is one unbroken run up to its own dry point, near `dryFrom`
// along the stroke (earlier for the outer hairs; 1 or more never dries).
// Past it the hair breaks wherever its own load, a slow noise `streak` units
// long, and the paper's `tooth(x, y)` (0 to 1, one field for every stroke on
// the sheet; by default value noise at a lattice of 3 units) fall below a
// dryness that starts at 0.4 of `dry` and grows to all of it at the end, more
// at the edges and under light pressure: `dry` 0 never breaks, 1 runs most
// hairs out before the end. Empty or collapsed spines give no hairs.
function bristles(R, name, spine, opts = {}) {
  const { width = 10, press = () => 1, count = Math.max(6, Math.round(width * 1.2)), dryFrom = 1, dry = 0.6, streak = 30, step = 2,
    tooth = (x, y) => noise2(R, x / 3, y / 3, 'tooth') } = opts;
  const pts = spine.length ? resample(spine, step) : [];
  const n = pts.length;
  if (n < 2) return [];
  const half = pts.map((p, i) => (width / 2) * press(i / (n - 1)));
  const normal = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]; const b = pts[Math.min(n - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
  });
  const hairs = [];
  for (let j = 0; j < count; j++) {
    const side = -1 + (2 * (j + 0.5)) / count + (R(name, 'side', j) - 0.5) * (1.4 / count);
    const edge = Math.min(1, Math.abs(side));
    const dryAt = dryFrom >= 1 ? Infinity : Math.max(0, dryFrom * (0.8 + 0.4 * R(name, 'dry', j)) * (1 - 0.25 * edge * edge));
    // Each hair's load has its own phase along the stroke, so no two break at
    // the same lattice and the breaks never line up across the stroke.
    const phase = R(name, 'phase', j) * 9;
    const runs = [];
    let run = null;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const o = half[i] * (side + (noise2(R, (i * step) / 30, j * 1.3, name + 'wander') - 0.5) * 0.12);
      const p = [pts[i][0] + normal[i][0] * o, pts[i][1] + normal[i][1] * o, i];
      let on = t <= dryAt;
      if (!on) {
        const need = 0.75 * dry * (0.4 + 0.6 * Math.min(1, (t - dryAt) / Math.max(0.05, 1 - dryAt))) * (1 + 0.4 * edge * edge) * (1.5 - 0.5 * Math.min(1, press(t)));
        on = 0.8 * noise2(R, (i * step) / streak + phase, j * 0.7, name + 'load') + 0.2 * tooth(p[0], p[1]) >= need;
      }
      if (!on) run = null;
      else if (run) run.push(p);
      else runs.push(run = [p]);
    }
    // Wider than its share of the stroke, so the wet part lays one band.
    hairs.push({ side, w: Math.max(0.6, (width / count) * (1.1 + 0.9 * R(name, 'w', j))), runs: runs.filter((r) => r.length > 1) });
  }
  return hairs;
}

// How far a mark is drawn at `share` (0 to 1) of its length, for a mark
// function's `grow` option. `lines` are the polylines the mark really draws,
// in drawing order, a closed one with its first point repeated at the end;
// their lengths add, so the lines before `line` are whole, `line` is drawn up
// to `at`, a point index that can fall between two points (2.25 is a quarter
// of the way from its point 2 to its point 3), and the rest are not started.
// `points`, `tip` and `heading` are core/path.js `grow` of that line: at share
// 0 one point, the first line's first. `label` names the mark function in the
// refusal of a share that is no number; a number past 0 or 1 is clamped.
function upTo(lines, share, label) {
  if (typeof share !== 'number' || Number.isNaN(share)) throw new TypeError(label + ': grow takes a number from 0 to 1, got ' + share);
  if (!lines.length || !lines[0].length) return { line: 0, at: 0, points: [], tip: null, heading: 0 };
  const lengths = lines.map((l) => lengthOf(l));
  let left = Math.min(1, Math.max(0, share)) * lengths.reduce((a, b) => a + b, 0);
  let line = 0;
  while (line < lines.length - 1 && left > lengths[line]) left -= lengths[line++];
  const pts = lines[line];
  const { points, tip, heading, total } = grow(pts, left);
  // The index `grow` stopped at, by its own walk, so `at` and `points` agree to the last point.
  let at = 0; let walked = 0;
  const want = Math.min(Math.max(left, 0), total);
  for (let i = 1; i < pts.length && walked < want; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (!(d > 0)) continue;
    if (walked + d > want) { at = i - 1 + (want - walked) / d; break; }
    walked += d; at = i;
  }
  return { line, at, points, tip, heading };
}

// Printed-paper grain: light and dark specks, addressed so every frame agrees.
function grain(g, R, name, w, h, n, light, dark) {
  for (let i = 0; i < n; i++) {
    const x = R(name, 'x', i) * w; const y = R(name, 'y', i) * h;
    const k = 0.8 + R(name, 'k', i) * 1.6;
    g.fillStyle = R(name, 'tone', i) < 0.5 ? light : dark;
    g.fillRect(x, y, k, k);
  }
}

// Canvas shadows ignore the transform, so they are scaled by it:
// a shadow keeps its size relative to the drawing at every output size.
function scaleOf(g) {
  const m = g.getTransform();
  return Math.hypot(m.a, m.b);
}

function shadow(g, colour, blur, dx = 0, dy = 0) {
  const k = scaleOf(g);
  g.shadowColor = colour;
  g.shadowBlur = blur * k;
  g.shadowOffsetX = dx * k;
  g.shadowOffsetY = dy * k;
}

// Soft paint for a lost edge, a penumbra, haze or an out-of-focus plane:
// `draw(s)` paints the design box (x, y, w, h), clipped to it, into a buffer at `scale` of
// the output's pixels (about 0.2 to 0.35), under `g`'s own transform, and the
// buffer is laid back over the box at full size with smoothing, so its every
// edge grades over about 1 / scale pixels for the price of one small raster.
// `g`'s alpha and blending apply to the lay. `draw(s, buffered)` may fade its
// own patch (`destination-in` with a gradient) so the box leaves no seam, but
// only when `buffered` is true: a surface with no canvas to make a buffer
// from, such as an SVG, hands `draw` the surface itself, clipped to the box
// and with `buffered` false, so it paints sharp and skips the fade. Scale 1
// or more blurs nothing and is refused. A box empty or off the canvas draws
// nothing.
function soft(g, x, y, w, h, scale, draw) {
  if (!(scale > 0 && scale < 1)) throw new Error('kit soft: scale takes a number above 0 and below 1, about 0.2 to 0.35, got ' + scale + '; at 1 the buffer is as sharp as the canvas, so draw on it directly');
  if (!(w > 0 && h > 0)) return;
  const sharp = () => { g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); draw(g, false); g.restore(); };
  const c0 = g.canvas;
  if (!c0 || typeof g.getTransform !== 'function' || typeof g.drawImage !== 'function') return sharp();
  const m = g.getTransform();
  const xs = []; const ys = [];
  for (const [u, v] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
    xs.push(m.a * u + m.c * v + m.e);
    ys.push(m.b * u + m.d * v + m.f);
  }
  // The buffer's pixels sit on one lattice of the canvas, 1 / scale pixels
  // apart from its corner, so a patch that moves between frames is sampled on
  // the same grid every frame and does not crawl.
  const i0 = Math.max(0, Math.floor(Math.min(...xs) * scale)); const j0 = Math.max(0, Math.floor(Math.min(...ys) * scale));
  const cw = Math.min(Math.ceil(c0.width * scale), Math.ceil(Math.max(...xs) * scale)) - i0;
  const ch = Math.min(Math.ceil(c0.height * scale), Math.ceil(Math.max(...ys) * scale)) - j0;
  if (!(cw > 0 && ch > 0)) return;
  const c = sibling(c0, cw, ch);
  if (!c) return sharp();
  // Backed as the target is: a buffer on the GPU drawn into a canvas kept in
  // memory moves that canvas to the GPU. Its alpha stays, so the buffer is
  // clear outside the patch.
  const attrs = typeof g.getContextAttributes === 'function' ? g.getContextAttributes() : {};
  const s = c.getContext('2d', { colorSpace: attrs.colorSpace, willReadFrequently: attrs.willReadFrequently });
  s.setTransform(m.a * scale, m.b * scale, m.c * scale, m.d * scale, m.e * scale - i0, m.f * scale - j0);
  // Clipped to the box as the sharp path is, so a rotated box paints no more
  // than its SVG.
  s.beginPath(); s.rect(x, y, w, h); s.clip();
  draw(s, true);
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(c, i0 / scale, j0 / scale, cw / scale, ch / scale);
  g.restore();
}

function caption(g, text, font, colour, x = 40, y = 950, size = 14) {
  g.save();
  g.strokeStyle = colour;
  g.lineWidth = 2;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  font.text(g, text, x, y, size);
  g.restore();
}

// Value keys, value-planned palettes and notan counts, in OKLCh lightness.
// Optional tools: they hand back colours and shares and decide nothing.

// [darkest, middle, lightest] OKLab lightness of each key.
const VALUE_KEYS = { high: [0.58, 0.78, 0.94], mid: [0.24, 0.56, 0.84], low: [0.12, 0.28, 0.54], chiaroscuro: [0.14, 0.48, 0.9] };
// Hue offsets in degrees from the base hue.
const HARMONIES = {
  monochrome: [0], analogous: [0, 28, -28], complementary: [0, 180],
  'split-complementary': [0, 150, 210], triadic: [0, 120, 240], tetradic: [0, 60, 180, 240],
};
const NOTAN = [0.35, 0.7];

function valueKeyOf(who, key) {
  const anchors = VALUE_KEYS[key];
  if (!anchors) throw new Error(`kit ${who}: key takes high, mid, low or chiaroscuro, got ${JSON.stringify(key)}`);
  return anchors;
}

// Lightness u (0 to 1) placed in a key; chiaroscuro leaves its middle empty.
function keyed(key, u) {
  const [lo, mid, hi] = VALUE_KEYS[key];
  if (key === 'chiaroscuro') return u < 0.5 ? lerp(lo, lo + 0.16, u * 2) : lerp(hi - 0.14, hi, (u - 0.5) * 2);
  return u < 0.5 ? lerp(lo, mid, u * 2) : lerp(mid, hi, (u - 0.5) * 2);
}

// OKLCh to linear light; the same matrices as core/colour.js, kept here so
// that file's private helper stays private.
function linearOfOklch(L, C, h) {
  const A = C * Math.cos(h); const B = C * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

// Linear light at OKLCh (L, C, h), chroma lowered until it fits sRGB.
function fitted(L, C, h) {
  const fits = (c) => c.every((v) => v > -1e-6 && v < 1 + 1e-6);
  let lin = linearOfOklch(L, C, h);
  if (!fits(lin)) {
    let lo = 0; let hi = C;
    for (let i = 0; i < 24; i++) { const c = (lo + hi) / 2; if (fits(linearOfOklch(L, c, h))) lo = c; else hi = c; }
    lin = linearOfOklch(L, lo, h);
  }
  return lin.map(clamp01);
}

const display = (lin) => hex(lin.map(toSRGB));
const notanOf = (L, lo = NOTAN[0], hi = NOTAN[1]) => (L < lo ? 'dark' : L >= hi ? 'light' : 'mid');

// A colour moved into a value key, keeping its hue, chroma where sRGB allows,
// and alpha: its OKLab lightness is mapped from 0..1 into the key's range.
function valueKey(colour, key = 'mid') {
  valueKeyOf('valueKey', key);
  const [L, C, h] = oklch(colour);
  const alpha = rgb(colour)[3];
  return hex([...fitted(keyed(key, clamp01(L)), C, h).map(toSRGB), alpha]);
}

// `count` swatches stepping dark to light through a value key, their hues
// spread by a harmony from `hue` (radians, as oklch gives it). With `ground`
// and `minContrast`, a swatch short of that WCAG contrast is moved away from
// the ground's lightness until it reaches it, or as far as sRGB goes.
function perceptualPalette(opt = {}) {
  const { hue = 0.6, harmony = 'analogous', key = 'mid', count = 5, chroma = 0.13, ground = null, minContrast = 0 } = opt;
  const offsets = HARMONIES[harmony];
  if (!offsets) throw new Error(`kit perceptualPalette: harmony takes ${Object.keys(HARMONIES).join(', ')}, got ${JSON.stringify(harmony)}`);
  valueKeyOf('perceptualPalette', key);
  if (!Number.isInteger(count) || count < 1) throw new Error(`kit perceptualPalette: count takes a whole number of 1 or more, got ${count}`);
  if (!Number.isFinite(hue)) throw new Error(`kit perceptualPalette: hue takes a finite number of radians, got ${hue}`);
  if (!Number.isFinite(chroma) || chroma < 0) throw new Error(`kit perceptualPalette: chroma takes a number of 0 or more, got ${chroma}`);
  const out = [];
  for (let i = 0; i < count; i++) {
    const L = keyed(key, count === 1 ? 0.5 : i / (count - 1));
    const C = clamp(chroma, 0, 0.28) * clamp(1 - 0.55 * (2 * (L - 0.5)) ** 2, 0.25, 1);
    const h = hue + offsets[i % offsets.length] * Math.PI / 180;
    let lin = fitted(L, C, h);
    if (ground && minContrast > 1 && contrast(display(lin), ground) < minContrast) {
      let near = L; let far = oklch(ground)[0] < 0.5 ? 0.99 : 0.02;
      let best = fitted(far, C, h);
      for (let k = 0; k < 24; k++) {
        const mid = (near + far) / 2;
        const cand = fitted(mid, C, h);
        if (contrast(display(cand), ground) >= minContrast) { best = cand; far = mid; } else near = mid;
      }
      lin = best;
    }
    const col = display(lin);
    const lch = oklch(col);
    out.push({ hex: col, linear: rgb(col).slice(0, 3).map(toLinear), oklch: lch, notan: notanOf(lch[0]) });
  }
  return out;
}

// Samples (hex strings or linear [r, g, b]) sorted into dark, mid and light by
// OKLab lightness below `low` and from `high` up; low === high gives two values.
function notan(samples, opt = {}) {
  if (!Array.isArray(samples) || samples.length === 0) throw new Error('kit notan: samples takes a non-empty array of hex colours or linear [r, g, b], got ' + JSON.stringify(samples));
  const lo = Math.min(opt.low ?? NOTAN[0], opt.high ?? NOTAN[1]);
  const hi = Math.max(opt.low ?? NOTAN[0], opt.high ?? NOTAN[1]);
  const share = { dark: 0, mid: 0, light: 0 };
  let lumaSum = 0; let minL = Infinity; let maxL = -Infinity;
  const bins = samples.map((s) => {
    const string = typeof s === 'string';
    if (!string && !(Array.isArray(s) && s.length === 3 && s.every(Number.isFinite))) throw new Error('kit notan: each sample takes a hex colour or linear [r, g, b], got ' + JSON.stringify(s));
    const lin = string ? rgb(s).slice(0, 3).map(toLinear) : s;
    const L = oklabOfLinear(lin)[0];
    minL = Math.min(minL, L); maxL = Math.max(maxL, L);
    lumaSum += string ? luma(s) : 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
    const bin = notanOf(L, lo, hi);
    share[bin]++;
    return bin;
  });
  const n = samples.length;
  return { bins, darkShare: share.dark / n, midShare: share.mid / n, lightShare: share.light / n, meanLuma: lumaSum / n, minL, maxL, contrastSpan: maxL - minL };
}

module.exports = { place, path, sub, wobble, ellipse, star, bristles, upTo, grain, shadow, soft, caption, valueKey, perceptualPalette, notan };
