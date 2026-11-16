// Flat cartoon: flat, opaque fills inside a closed ink line that swells and
// tapers and sits heavier on the side away from the light, at most one
// hard-edged cel shade per part in a darker tone of its fill, blush and white
// shines as accents, and hand-lettered sound effects that belong to the
// picture.
//
// A parts bin: functions that draw the style's marks on any path, outline or
// area you give them. Nothing here picks a subject, a scene or a layout.

'use strict';

const { outline } = require('../../../core/path.js');
const { resample, bbox } = require('../../../core/geom.js');
const { fbm } = require('../../../core/rand.js');
const font = require('../../../core/stroke-font.js');
const { path, ellipse } = require('./kit.js');
const { rgb, hex, oklch, toLinear, toSRGB } = require('../../../core/colour.js');

// A warm near-black, never pure black, and a warm white ground.
const INK = '#1d1414';
const PAPER = '#fffaf3';

// A starting palette of flat fills, named by role. Pick a few per piece.
const PAINT = {
  sky: '#83bde9',
  blue: '#4f86c6',
  coral: '#e8828a',
  red: '#d9524f',
  peach: '#f6c4ae',
  tan: '#e8b17a',
  yellow: '#ffd45c',
  green: '#7cc47f',
  brown: '#7b5241',
  grey: '#9aa0a8',
  blush: '#e0606a',
  white: '#ffffff',
};

// The cel-shade violet in linear light, its departure from the grey of its
// own luminance (Rec. 709 weights), and that departure's direction.
const LUM = [0.2126, 0.7152, 0.0722];
const VIOLET = rgb('#3a2340').slice(0, 3).map(toLinear);
const VIOLET_TINT = VIOLET.map((v) => v - VIOLET.reduce((s, w, i) => s + w * LUM[i], 0));
const VIOLET_LEAN = VIOLET_TINT.map((v) => v / Math.hypot(...VIOLET_TINT));
// Above this OKLCh lightness a fill's shade is darker than the fill at k 0.1
// and over; below k 0.1, byte rounding can leave it about 0.001 lighter.
const DARK = 0.32;

// The one cel-shade tone of a fill: `k` (clamped to 0..0.8) of the way toward
// the dark violet in linear light, so the shade is darker and stays near the
// fill's own hue, never black. The cap keeps a fifth of the fill at full
// strength: at 1 every fill would shade to the violet itself. That mix alone leaves white and pale greys
// grey. So where its tint (its departure from the grey of the same luminance)
// is under a floor of half of `k` times that luminance, a lean toward the
// violet is added, the floor at no tint and shrinking to none at a third of
// the floor, and the sum is stretched toward the floor, at most 2 times, at
// the same luminance. White and near greys shade to lavender, a pale warm
// fill to a deeper tone of its own warmth, and fills a byte apart to close
// colours. A lean that keeps fills a byte apart close must pass through grey
// somewhere: here that is green greys a little greener than neutral, whose
// tint points away from the violet, such as #7c827a, which shade nearly grey.
// Takes #rgb, #rrggbb and #rrggbbaa as core/colour.js does,
// throws on any other colour, and keeps the fill's alpha.
function shade(colour, k = 0.35) {
  const u = Math.min(0.8, Math.max(0, k));
  const c = rgb(colour);
  const [r, g, b] = c.slice(0, 3).map(toLinear);
  const lin = [r, g, b].map((v, i) => v * (1 - u) + VIOLET[i] * u);
  const y = lin.reduce((s, v, i) => s + v * LUM[i], 0);
  let tint = lin.map((v) => v - y);
  const floor = 0.5 * u * y;
  const size = Math.hypot(...tint);
  if (size < floor) {
    const lean = floor * Math.max(0, 1 - (3 * size) / floor);
    tint = tint.map((v, i) => v + VIOLET_LEAN[i] * lean);
    const scale = floor / Math.max(Math.hypot(...tint), floor / 2);
    tint = tint.map((v) => v * scale);
  }
  let out = hex([...tint.map((v) => toSRGB(y + v)), c[3]]);
  // A dark fill (OKLCh lightness at most DARK) can come out lighter than
  // itself: dim the tone in linear light, which keeps its hue, until the
  // rounded colour is no lighter than the fill. Lighter fills are left as
  // they are, so their OKLCh lightness, the same sum oklch() makes, is read
  // from the linear fill and the rounded tone is never read back.
  const Lf = 0.2104542553 * Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    + 0.7936177850 * Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    - 0.0040720468 * Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  if (Lf > DARK) return out;
  const [Ls] = oklch(out);
  if (Ls > Lf) {
    const lit = tint.map((v) => Math.min(1, Math.max(0, y + v)));
    for (let dim = (Lf / Ls) ** 3; oklch(out)[0] > Lf; dim *= 0.97) out = hex([...lit.map((v) => toSRGB(v * dim)), c[3]]);
  }
  return out;
}

// The distance along `pts` at each point, and the whole length (round the
// loop when `closed`).
function runs(pts, closed) {
  const at = [0];
  for (let i = 1; i < pts.length; i++) at.push(at[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const last = pts[pts.length - 1];
  const total = at[at.length - 1] + (closed ? Math.hypot(pts[0][0] - last[0], pts[0][1] - last[1]) : 0);
  return { at, total };
}

// The ink line along `pts`, a filled outline, never a stroke. An open line
// enters and leaves thin (`taper` raised to the power 0.7, times `w`, at its
// ends: about 0.32 of `w` by default) and swells to `w` in its middle. A
// `closed` line goes round the form with no seam, and is heavier on
// the side facing away from `light` (an angle, toward the upper left by
// default): by `weight`, it thins to 1 - weight of `w` where it faces the
// light. `wobble` varies the nib by a slow noise read along the path, so the
// line looks the same however many points it has; `step` is the spacing the
// path is resampled to.
function ink(g, R, name, pts, opts = {}) {
  const { w = 4, closed = false, taper = 0.2, light = -Math.PI * 3 / 4, weight = 0.5, wobble = 0.08, step = 2, colour = INK } = opts;
  const line = resample(pts, step, closed);
  if (closed && line.length > 1) {
    const a = line[0]; const z = line[line.length - 1];
    if (a[0] === z[0] && a[1] === z[1]) line.pop();
  }
  if (line.length < (closed ? 3 : 2)) return;
  const { at, total } = runs(line, closed);
  if (!(total > 0)) return;
  // A closed line reads the noise round a circle as long as the loop, so the
  // nib comes back to where it started and the loop has no seam.
  const r = total / (2 * Math.PI);
  const nib = (s) => 1 + wobble * 2 * (fbm(R, closed ? r * Math.cos(s / r) / 40 : s / 40, closed ? r * Math.sin(s / r) / 40 : 0.5, 2, name + 'nib') - 0.5);
  const n = line.length;
  let widths;
  if (closed) {
    let area = 0;
    for (let i = 0; i < n; i++) { const p = line[i]; const q = line[(i + 1) % n]; area += p[0] * q[1] - q[0] * p[1]; }
    const out = area > 0 ? 1 : -1;
    const lx = Math.cos(light); const ly = Math.sin(light);
    widths = line.map((p, i) => {
      const a = line[(i - 1 + n) % n]; const b = line[(i + 1) % n];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const facing = (out * ((b[1] - a[1]) * lx - (b[0] - a[0]) * ly)) / l;
      return w * (1 - weight * 0.5 * (1 + facing)) * nib(at[i]);
    });
  } else {
    widths = line.map((p, i) => w * (taper + (1 - taper) * Math.sin(Math.PI * (at[i] / total))) ** 0.7 * nib(at[i]));
  }
  g.save();
  g.fillStyle = colour;
  path(g, outline(line, widths, { closed }));
  g.fill();
  g.restore();
}

// One flat fill of a closed outline: no stroke, no gradient, no texture.
function flat(g, pts, colour) {
  g.save();
  g.fillStyle = colour;
  path(g, pts);
  g.fill();
  g.restore();
}

// A part's fill with its one cel shade, in place of `flat`: the part in
// `tone`, then the part again in `colour` moved toward `light` by `depth` of
// its bounding box's smaller side, inside a clip to the part. A hard-edged
// crescent of shade stays on the side away from the light. Once per part.
function cel(g, pts, colour, opts = {}) {
  const { light = -Math.PI * 3 / 4, depth = 0.14, tone = shade(colour) } = opts;
  const [x0, y0, x1, y1] = bbox(pts);
  const d = depth * Math.min(x1 - x0, y1 - y0);
  g.save();
  path(g, pts);
  g.clip();
  g.fillStyle = tone;
  path(g, pts);
  g.fill();
  g.fillStyle = colour;
  path(g, pts.map(([x, y]) => [x + Math.cos(light) * d, y + Math.sin(light) * d]));
  g.fill();
  g.restore();
}

// A blush: a flat oval at (cx, cy), radii rx and ry, turned by `rot`, in
// `colour` at `alpha`. `lines` above 0 lays that many short diagonal ink
// ticks across it, the hatched variant.
function blush(g, cx, cy, rx, ry, opts = {}) {
  const { colour = PAINT.blush, alpha = 0.55, lines = 0, rot = 0 } = opts;
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = colour;
  path(g, ellipse(cx, cy, rx, ry, 48, rot));
  g.fill();
  if (lines > 0) {
    const c = Math.cos(rot); const s = Math.sin(rot);
    const turn = (u, v) => [cx + u * c - v * s, cy + u * s + v * c];
    g.globalAlpha = 0.7;
    g.strokeStyle = INK;
    g.lineWidth = ry * 0.18;
    g.lineCap = 'round';
    for (let k = 0; k < lines; k++) {
      const u = lines === 1 ? 0 : rx * 0.6 * (2 * k / (lines - 1) - 1);
      path(g, [turn(u - ry * 0.25, ry * 0.4), turn(u + ry * 0.25, -ry * 0.4)], false);
      g.stroke();
    }
  }
  g.restore();
}

// A white shine: a crescent from `a` through control point `c` to `b`, pointed
// at both ends and `w` wide in its middle, in `colour` at `alpha`. `dot` above
// 0 adds a round glint of that radius just past `b`.
function shine(g, a, c, b, opts = {}) {
  const { w = 6, colour = PAINT.white, alpha = 1, dot = 0 } = opts;
  const pts = [];
  for (let k = 0; k <= 16; k++) {
    const t = k / 16; const u = 1 - t;
    pts.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = colour;
  path(g, outline(pts, (t) => w * Math.sin(Math.PI * t)));
  g.fill();
  if (dot > 0) {
    const l = Math.hypot(b[0] - c[0], b[1] - c[1]) || 1;
    const k = dot * 2.5 / l;
    g.beginPath();
    g.arc(b[0] + (b[0] - c[0]) * k, b[1] + (b[1] - c[1]) * k, dot, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

// Sound-effect lettering: `text` in the stroke font with its cap line at `y`
// and its left edge at `x`, `size` the cap height. The baseline runs at angle
// `rot`; each letter is turned a little more and bounced up or down by
// `bounce` of the size, both seeded by `name`, and spaced `spread` times the
// font's advance. Every letter is drawn in `line` with a drop shadow, then in
// `fill` at `weight` over all of them. Throws when the font lacks a glyph.
function sfx(g, R, name, text, x, y, size, opts = {}) {
  const { fill = PAINT.yellow, line = INK, weight = size * 0.22, rot = -0.12, bounce = 0.12, spread = 1.1 } = opts;
  const lost = font.missing(text);
  if (lost.length) throw new Error('sfx: the stroke font has no glyph for ' + lost.join(' '));
  const k = size / 7;
  const advance = (font.width('MM', size) - font.width('M', size)) * spread;
  const letters = [...text];
  const place = (i, dx, dy) => {
    const d = i * advance + 2 * k;
    const lift = (R(name, 'y', i) - 0.5) * bounce * size;
    g.translate(x + Math.cos(rot) * d + Math.sin(rot) * lift + dx, y + 3.5 * k + Math.sin(rot) * d - Math.cos(rot) * lift + dy);
    g.rotate(rot + (R(name, 'rot', i) - 0.5) * 0.3);
  };
  const pass = (colour, width, dx, dy) => {
    g.strokeStyle = colour;
    g.lineWidth = width;
    letters.forEach((ch, i) => {
      g.save();
      place(i, dx, dy);
      font.text(g, ch, -2 * k, -3.5 * k, size);
      g.restore();
    });
  };
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  pass(line, weight + size * 0.12, size * 0.06, size * 0.06);
  pass(line, weight + size * 0.12, 0, 0);
  pass(fill, weight, 0, 0);
  g.restore();
}

module.exports = { INK, PAPER, PAINT, shade, ink, flat, cel, blush, shine, sfx };
