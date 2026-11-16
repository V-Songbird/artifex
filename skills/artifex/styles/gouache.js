// Mid-century gouache: opaque, matte flats of a few colours, each shape one
// colour with a crisp edge that breaks into bristle streaks where the brush
// ran dry. Dry-brush drags and spatter give the flats their texture, skies
// are the only gradients, and value sits in planes: dark shapes in front, a
// lit opening behind them, pale haze beyond.
//
// A parts bin: functions that draw the style's marks on any path, outline or
// area you give them. Nothing here picks a subject, a scene or a layout.

'use strict';

const { fbm } = require('../../../core/rand.js');
const { rgb: parse } = require('../../../core/colour.js');
const { bbox, pointInPoly } = require('../../../core/geom.js');
const { path, wobble, bristles } = require('./kit.js');

// Opaque paints on cream illustration board. Pick four to six for a scene.
const PAINT = {
  board: '#efe6d2',
  night: '#16181f',
  haze: '#cfd8cf',
  sun: '#fff0c4',
  turquoise: '#3f9c99',
  teal: '#1f5c63',
  olive: '#7f8f3a',
  chartreuse: '#c4c64c',
  mustard: '#d9a43a',
  coral: '#e2694c',
  vermilion: '#cf412c',
  pink: '#e9a7a1',
  violet: '#66578a',
  ultramarine: '#2e4787',
  sand: '#e2c48e',
  umber: '#57392a',
};

const clamp = (v) => Math.max(0, Math.min(1, v));
// A paint's red, green and blue as whole numbers from 0 to 255, read by
// core/colour.js: '#rgb', '#rrggbb' or '#rrggbbaa' (the alpha is dropped);
// any other colour throws.
const rgb = (c) => parse(c).slice(0, 3).map((v) => Math.round(v * 255));

// Two paints mixed, as '#rrggbb': `t` 0 is `a`, 1 is `b`. Each is '#rgb',
// '#rrggbb' or '#rrggbbaa'; the mix is opaque.
function mix(a, b, t) {
  const p = rgb(a); const q = rgb(b); const k = clamp(t);
  return '#' + p.map((v, i) => Math.round(v + (q[i] - v) * k).toString(16).padStart(2, '0')).join('');
}

// The colour at `t` (0 to 1) along a list of paints, mixed evenly between them.
function ramp(colours, t) {
  const at = clamp(t) * (colours.length - 1);
  const i = Math.min(colours.length - 2, Math.floor(at));
  return colours.length < 2 ? colours[0] : mix(colours[i], colours[i + 1], at - i);
}

// A plane's colour by its depth, 0 nearest to 1 farthest: near-black in
// front, the paint itself lit toward `sun` by `light` at the `clearing`
// depth, and mixed toward `haze` by up to `fog` beyond it. Planes in front of
// the clearing darken fast, so in one paint the opening is lighter than
// everything in front of it; across paints, keep front planes nearer than
// depth 0.25 or check them in value. The haze is paler than most paints lit, so the distance can
// outshine the opening; `fog` 0 or a darker `haze` keeps the opening lightest.
function tone(colour, depth, opts = {}) {
  const { clearing = 0.5, light = 0.3, fog = 0.6, dark = PAINT.night, haze = PAINT.haze, sun = PAINT.sun } = opts;
  const lit = mix(colour, sun, light);
  if (depth <= clearing) return mix(lit, dark, 0.92 * (1 - clamp(depth / Math.max(1e-6, clearing))) ** 0.6);
  return mix(lit, haze, fog * clamp((depth - clearing) / Math.max(1e-6, 1 - clearing)));
}

// Faint brush marks inside a flat: wobbly parallel strokes at `angle`, a
// shade lighter or darker than `colour`, at `alpha`, clipped to `outline`.
function streaks(g, R, name, outline, colour, alpha, angle = 0, gap = 9) {
  const [x0, y0, x1, y1] = bbox(outline);
  const cx = (x0 + x1) / 2; const cy = (y0 + y1) / 2;
  const reach = Math.hypot(x1 - x0, y1 - y0) / 2 + gap;
  const c = Math.cos(angle); const s = Math.sin(angle);
  g.save();
  path(g, outline);
  g.clip();
  g.lineCap = 'round';
  let k = 0;
  for (let d = -reach; d <= reach; d += gap, k++) {
    const line = [[cx - c * reach - s * d, cy - s * reach + c * d], [cx + c * reach - s * d, cy + s * reach + c * d]];
    g.strokeStyle = R(name, 'tone', k) < 0.5 ? mix(colour, '#ffffff', 0.18) : mix(colour, '#000000', 0.14);
    g.globalAlpha = alpha * (0.4 + 0.6 * R(name, 'load', k));
    g.lineWidth = gap * (0.6 + 0.8 * R(name, 'width', k));
    path(g, wobble(line, R, name + k, gap * 0.25, 12), false);
    g.stroke();
  }
  g.restore();
}

// One opaque flat with a dry edge. The outline is wobbled by `amp`, and the
// paint's edge wanders in and out of it within a band `edge` wide (at most a
// sixth of the shape's smaller side). With `dry` 0 the paint stops at the
// rim, a crisp edge; up to 0.2 the edge wanders smoothly; above 0.2 it breaks
// into bristle lines along the rim whose breaks feather across neighbouring
// hairs and whose ends run out in fine tips. `streak` is the alpha of faint
// brush marks across the flat at `angle`. Returns the wobbled outline.
function flat(g, R, name, outline, colour, opts = {}) {
  const { dry = 0.5, edge = 8, amp = 1.2, step = 4, streak = 0.06, angle = 0 } = opts;
  const rim = wobble(outline, R, name, amp, step, true);
  const [x0, y0, x1, y1] = bbox(rim);
  const band = Math.min(edge, Math.min(x1 - x0, y1 - y0) / 6);
  let area = 0;
  for (let i = 0; i < rim.length; i++) {
    const a = rim[i]; const b = rim[(i + 1) % rim.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  const inward = area > 0 ? 1 : -1;
  const normal = rim.map((p, i) => {
    const a = rim[(i - 1 + rim.length) % rim.length]; const b = rim[(i + 1) % rim.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(-(b[1] - a[1]) / l) * inward, ((b[0] - a[0]) / l) * inward];
  });
  const at = (o) => rim.map((p, i) => [p[0] + normal[i][0] * o, p[1] + normal[i][1] * o]);
  const n = rim.length;
  // u runs from the solid inside (0) through the rim (0.625) to past it (1).
  const off = (u) => band * (1 - 1.6 * u);
  const line = (o) => rim.map((p, i) => [p[0] + normal[i][0] * o[i], p[1] + normal[i][1] * o[i]]);
  // How far the paint reaches at each rim point: the rim on a crisp edge, in
  // and out along it as the brush ran dry. Above `dry` 0.2 it is solid only to
  // a little short of that and broken beyond; the solid never stops deeper
  // than 0.1875 (0.7 of a band inside the rim).
  const rough = clamp((dry - 0.2) / 0.8);
  const reach = rim.map((p, k) => 0.625 + (fbm(R, k * 0.2, 0.5, 3, name + 'reach') - 0.5) * 1.6 * dry);
  const solid = reach.map((r) => Math.max(0.1875, r - 0.3 * rough));
  g.save();
  g.fillStyle = colour;
  g.strokeStyle = colour;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // The solid paint is one smooth contour wandering in and out of the rim,
  // clipped to the rim pushed out where it passes it: where the shape is
  // narrower than the band, as at a cone's tip, an inset crosses the far side.
  g.save();
  path(g, line(solid.map((u) => Math.min(0, off(u)))));
  g.clip();
  path(g, line(solid.map(off)));
  g.fill();
  g.restore();
  const hairs = Math.max(4, Math.round(band * 1.6));
  const lw = Math.max(0.8, (band * 1.6 / hairs) * 1.5);
  const top = Math.max(...reach); const low = Math.min(...solid);
  g.lineWidth = lw;
  for (let j = 0; rough > 0 && j < hairs; j++) {
    // The broken hairs between the solid and the reach. Each ends a little
    // early or late, its breaks are shared with its neighbours so they
    // feather across them, and every end runs out in a fine tip.
    const u = (j + 0.5) / hairs;
    const ue = u + (R(name, 'stagger', j) - 0.5) * (0.6 / hairs);
    if (ue >= top || u < low) continue;
    const o = off(u);
    const pts = line(rim.map(() => o));
    const f = rim.map((p, k) => Math.min(reach[k] - ue, Math.max(solid[k] - u, fbm(R, k * 0.25, j * 0.35, 2, name + 'dry') - 0.42)));
    const body = []; const tips = [];
    let run = null;
    const tip = (a, b, t, k, dir) => {
      const x = a[0] + (b[0] - a[0]) * t; const y = a[1] + (b[1] - a[1]) * t;
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const len = lw * (1.5 + 1.5 * R(name, 'tip', j * 65536 + k)) * dir;
      tips.push([[x, y], [x + ((b[0] - a[0]) / l) * len, y + ((b[1] - a[1]) / l) * len]]);
      return [x, y];
    };
    for (let i = 0; i <= n; i++) {
      const k = i % n; const p = pts[k];
      if (f[k] > 0) {
        if (!run) { run = [p]; body.push(run); } else run.push(p);
      }
      if (i === n) break;
      const k1 = (i + 1) % n;
      if ((f[k] > 0) === (f[k1] > 0)) continue;
      const t = f[k] / (f[k] - f[k1]);
      if (f[k] > 0) { run.push(tip(p, pts[k1], t, k, 1)); run = null; } else { run = [tip(p, pts[k1], t, k, -1)]; body.push(run); }
    }
    // Inside the rim the hairs are clipped to it, as the solid is; past the
    // rim they lay the dry streaks outside it.
    if (o >= 0) { g.save(); path(g, rim); g.clip(); }
    g.beginPath();
    for (const r of body) {
      if (r.length < 2) continue;
      g.moveTo(r[0][0], r[0][1]);
      for (let q = 1; q < r.length; q++) g.lineTo(r[q][0], r[q][1]);
    }
    g.stroke();
    g.lineWidth = lw * 0.45;
    g.beginPath();
    for (const [a, b] of tips) { g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
    g.stroke();
    g.lineWidth = lw;
    if (o >= 0) g.restore();
  }
  if (streak > 0) {
    path(g, rim);
    g.clip();
    streaks(g, R, name + 'streak', at(band * 0.4), colour, streak, angle);
  }
  g.restore();
  return rim;
}

// A stroke of a dry brush along an open `spine`, `width` wide: `bristles`
// hairs from kit's `bristles`, each at 75 to 100% of `alpha`, that break in
// long streaks on the board's tooth, at a different place on each hair and
// more toward the stroke's sides and its end, by `dry` (0 a loaded brush that
// lays a solid band, 1 a nearly empty one that runs out before the end). It
// lifts toward the end.
function drybrush(g, R, name, spine, colour, opts = {}) {
  const { width = 14, bristles: count = Math.max(8, Math.round(width * 1.2)), dry = 0.5, alpha = 1 } = opts;
  const press = (t) => (0.75 + 0.25 * Math.sin(Math.PI * Math.min(1, t * 3) / 2)) * (1 - 0.35 * t);
  g.save();
  g.strokeStyle = colour;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  bristles(R, name, spine, { width, count, press, dry, dryFrom: 0 }).forEach((hair, j) => {
    g.globalAlpha = alpha * (0.75 + 0.25 * R(name, 'load', j));
    g.lineWidth = hair.w;
    g.beginPath();
    for (const run of hair.runs) {
      g.moveTo(run[0][0], run[0][1]);
      for (let i = 1; i < run.length; i++) g.lineTo(run[i][0], run[i][1]);
    }
    g.stroke();
  });
  g.restore();
}

// A sky over the box (x, y, w, h): a smooth vertical gradient through
// `colours`, top first. With `bands` it is that many flat bands instead,
// each meeting the next along a dry-brushed seam. `streak` lays faint
// horizontal brush marks over it.
function sky(g, R, name, x, y, w, h, colours, opts = {}) {
  const { bands = 0, dry = 0.6, streak = 0.04 } = opts;
  const box = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  g.save();
  if (bands > 0) {
    const bh = h / bands;
    for (let k = 0; k < bands; k++) {
      g.fillStyle = ramp(colours, bands === 1 ? 0 : k / (bands - 1));
      g.fillRect(x, y + k * bh, w, k === bands - 1 ? h - k * bh : bh + 1);
    }
    // The seams run past the box so their ends do not show; the clip keeps
    // them from painting outside it.
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    for (let k = 1; k < bands; k++) {
      const seam = [[x - 10, y + k * bh], [x + w + 10, y + k * bh]];
      drybrush(g, R, name + 'seam' + k, seam, ramp(colours, (k - 1) / (bands - 1)), { width: bh * 0.3, bristles: 22, dry });
    }
  } else {
    const fill = g.createLinearGradient(0, y, 0, y + h);
    colours.forEach((c, i) => fill.addColorStop(colours.length < 2 ? 0 : i / (colours.length - 1), c));
    g.fillStyle = fill;
    g.fillRect(x, y, w, h);
  }
  g.restore();
  if (streak > 0) streaks(g, R, name + 'streak', box, ramp(colours, 0.5), streak, 0, 14);
}

// Spatter flicked from a stiff brush: opaque drops inside `outline`, flicked
// at `density` per square unit of its bounding box and then culled: drops in
// low noise (more of them as `clump` rises) or outside the outline are
// dropped, so fewer remain. Most drops are small, about 0.4 of `size` in
// radius, and a few reach up to 2.75 times it; each is stretched along the
// flick direction `angle` (seeded when not given), the small ones most.
// Texture on a flat, never a fill.
function spatter(g, R, name, outline, colour, opts = {}) {
  const { density = 0.004, size = 1, clump = 0.5, angle = R(name, 'flick', 0) * 2 * Math.PI } = opts;
  const [x0, y0, x1, y1] = bbox(outline);
  const count = Math.round((x1 - x0) * (y1 - y0) * density);
  g.save();
  g.fillStyle = colour;
  for (let i = 0; i < count; i++) {
    const px = x0 + R(name, 'x', i) * (x1 - x0); const py = y0 + R(name, 'y', i) * (y1 - y0);
    if (fbm(R, px / 40, py / 40, 3, name + 'clump') < 0.3 + 0.3 * clump || !pointInPoly([px, py], outline)) continue;
    // Mostly small drops and a few large ones; the small ones stretch most
    // along the flick.
    const r = size * (0.35 + 2.4 * R(name, 'r', i) ** 6);
    const e = Math.sqrt(1 + 2.5 * R(name, 'stretch', i) * (1 - Math.min(0.7, r / (4 * size))));
    g.beginPath();
    g.ellipse(px, py, r * e, r / e, angle + (R(name, 'turn', i) - 0.5) * 0.4, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

module.exports = { PAINT, mix, ramp, tone, flat, drybrush, sky, spatter };
