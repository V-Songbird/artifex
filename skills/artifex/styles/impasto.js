// Impasto: thick paint. Thousands of short dabs follow a swirling flow, each
// a loaded head dragged out to a thin ragged end, with bristle grooves, a
// broken lit ridge and a dark ridge, so the paint seems to stand off the
// canvas; inside a form the dabs wrap it under one light, sized from its mass.
//
// A parts bin: functions that draw the style's marks on any path, outline or
// area you give them. Nothing here picks a subject, a scene or a layout.

'use strict';

const { fbm } = require('../../../core/rand.js');
const { pointInPoly } = require('../../../core/geom.js');
const { mix } = require('../../../core/colour.js');

// The direction the light comes from, up and to the left.
const LIGHT = [-0.6, -0.8];
// A fire-and-cloud ramp for `ramp`: [upper edge, colour], dark red to cream.
const FIRE = [[0.36, '#c8412a'], [0.43, '#e0612a'], [0.5, '#f08a3c'], [0.56, '#f7b267'], [0.62, '#f4dcb8'], [9, '#fbf3e6']];

const ridges = new Map();
function ridge(colour) {
  let r = ridges.get(colour);
  if (!r) {
    r = [mix(colour, '#ffffff', 0.42), mix(colour, '#3a2a1e', 0.38)];
    ridges.set(colour, r);
  }
  return r;
}

// One dab of thick paint centred at (x, y) along angle `a`, `len` by `wide`
// (half sizes): a loaded head at the start, an ellipse `len` * 0.6 long,
// dragged out along `a` to a thinner, ragged end `len` past (x, y); three to five bristle grooves along it in the dark ridge
// colour (38% toward brown), converging into the end; a lit ridge 42% toward
// white broken into two to four dashes on the side facing `light`; a thin
// dark ridge on the other. A hash of (x, y, a) varies each stroke, so one
// call always draws the same stroke.
function dab(g, x, y, a, len, wide, colour, light = LIGHT) {
  const [lit, dark] = ridge(colour);
  const ly = -light[0] * Math.sin(a) + light[1] * Math.cos(a);
  const side = ly > 0 ? 1 : -1;
  const h = (k) => { const s = Math.sin(x * 12.9898 + y * 78.233 + a * 37.719 + k * 4.581) * 43758.5453; return s - Math.floor(s); };
  const head = len * 0.6; const end = len * 1.4;
  const tip = wide * (0.25 + 0.2 * h(2));
  // The half-width at u along the stroke: the head's ellipse behind its
  // centre, then a straight taper to the tip.
  const half = (u) => (u <= 0 ? wide * Math.sqrt(Math.max(0, 1 - (u / head) ** 2)) : wide + ((tip - wide) * Math.min(u, end)) / end);
  // A line from u0 to u1 at `f` of the half-width across, as a few points.
  const line = (u0, u1, f) => {
    for (let k = 0; k <= 4; k++) {
      const u = u0 + ((u1 - u0) * k) / 4;
      g[k ? 'lineTo' : 'moveTo'](u, f * half(u));
    }
  };
  g.save();
  // The stroke spans `len` either side of (x, y), so the head sits behind it.
  g.translate(x - Math.cos(a) * len * 0.4, y - Math.sin(a) * len * 0.4);
  g.rotate(a);
  // The body: the head and the dragged tail, both wound clockwise, one fill.
  g.fillStyle = colour;
  g.beginPath();
  g.ellipse(0, 0, head, wide, 0, 0, Math.PI * 2);
  g.moveTo(0, -wide);
  g.quadraticCurveTo(end * 0.5, -wide * 0.9, end, -tip);
  g.lineTo(end * (0.92 + 0.08 * h(1)), 0);
  g.lineTo(end, tip);
  g.quadraticCurveTo(end * 0.5, wide * 0.9, 0, wide);
  g.closePath();
  g.fill();
  g.lineCap = 'round';
  // Grooves the bristles leave.
  const n = 3 + Math.floor(h(3) * 3);
  g.beginPath();
  for (let k = 0; k < n; k++) line(-head * 0.8, end * (0.7 + 0.25 * h(4 + k)), -0.7 + (1.4 * (k + 0.5)) / n + (h(10 + k) - 0.5) * 0.16);
  g.globalAlpha = 0.3 + 0.2 * h(9);
  g.strokeStyle = dark;
  g.lineWidth = wide * 0.1;
  g.stroke();
  // The lit ridge, broken where the bristles skipped.
  const m = 2 + Math.floor(h(20) * 3);
  g.beginPath();
  for (let k = 0; k < m; k++) {
    const u0 = -head * 0.8 + h(21 + k) * end * 0.8;
    line(u0, Math.min(end * 0.9, u0 + len * (0.2 + 0.35 * h(25 + k))), side * (0.5 + 0.15 * h(29 + k)));
  }
  g.globalAlpha = 0.45 + 0.3 * h(34);
  g.strokeStyle = lit;
  g.lineWidth = wide * (0.18 + 0.12 * h(35));
  g.stroke();
  // The dark ridge on the far side.
  g.beginPath();
  line(-head * 0.8, end * (0.5 + 0.4 * h(30)), -side * 0.7);
  g.globalAlpha = 0.45;
  g.strokeStyle = dark;
  g.lineWidth = wide * 0.22;
  g.stroke();
  g.restore();
}

// The angle of a swirling flow at (x, y): a `drift` plus [cx, cy, ±1]
// vortices each adding `gain` / (d² + `soft`), turned by up to `turn` / 2
// radians of noise at `scale`.
function flow(R, name, x, y, vortices, opts = {}) {
  const { drift = [0.55, -0.8], gain = 180, soft = 9000, scale = 260, turn = 2.2 } = opts;
  let vx = drift[0]; let vy = drift[1];
  for (const [cx, cy, s] of vortices) {
    const dx = x - cx; const dy = y - cy; const d2 = dx * dx + dy * dy + soft;
    vx += (-dy * s * gain) / d2;
    vy += (dx * s * gain) / d2;
  }
  return Math.atan2(vy, vx) + (fbm(R, x / scale, y / scale, 3, name) - 0.5) * turn;
}

// Where dabs go: a grid of `step` from (x0, y0) up to (x1, y1), each point
// jittered by up to `jitter`, in a shuffled order so no row lies on top.
// Returns [x, y, i] with `i` the point's index for its own random draws.
function scatter(R, name, x0, y0, x1, y1, step, jitter) {
  const cells = [];
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const i = cells.length;
      cells.push([x + R(name, 'x', i) * jitter, y + R(name, 'y', i) * jitter, i, R(name, 'order', i)]);
    }
  }
  cells.sort((p, q) => p[3] - q[3]);
  return cells.map(([x, y, i]) => [x, y, i]);
}

// A value in [0, 1) mapped through [upper edge, colour] stops, such as FIRE.
function ramp(stops, v) {
  return stops.find(([edge]) => v < edge)[1];
}

// How lit a point is on a form centred at `c` of size `r`, under light from
// `from`. By default a flat plane: about 0.5 at the centre, rising toward the
// light. With `form` 'round' (a ball of radius `r`) or 'long' (a cylinder of
// half-width `r` whose axis runs at angle `axis`), light and shade split at
// the terminator: lit points fall in [0.6, 1], shaded ones in [0, 0.4), so
// `pick` on a four- or five-step palette never puts both on one step.
function shade(x, y, c, r, from = [-0.5, -0.85], opts = {}) {
  const { form, axis = 0 } = opts;
  if (!form) return 0.5 + ((x - c[0]) * from[0] + (y - c[1]) * from[1]) / r;
  let n;
  if (form === 'long') {
    const s = Math.sin(axis); const k = Math.cos(axis);
    const p = Math.max(-1, Math.min(1, (-(x - c[0]) * s + (y - c[1]) * k) / r));
    n = [-s * p, k * p, Math.sqrt(1 - p * p)];
  } else {
    const d0 = (x - c[0]) / r; const d1 = (y - c[1]) / r;
    n = [d0, d1, Math.sqrt(Math.max(0, 1 - d0 * d0 - d1 * d1))];
  }
  const l = Math.hypot(from[0], from[1], 0.6);
  const lam = (n[0] * from[0] + n[1] * from[1] + n[2] * 0.6) / l;
  return lam >= 0 ? 0.6 + 0.4 * lam : 0.4 * (1 + lam);
}

// An angle function for `model`'s `angle`: strokes along the cross-contours
// of a ball centred at `c` of radius `r`, cut by planes square to an axis
// that leans from the picture direction `axis` (default toward the light)
// out toward the viewer, so each section shows as an ellipse of minor/major
// `tilt`. The sections bow away from `axis` and run along the outline at the
// rim.
function across(c, r, axis = LIGHT, tilt = 0.45) {
  const al = Math.hypot(axis[0], axis[1]);
  const v = [axis[0] / al, axis[1] / al]; const u = [-v[1], v[0]];
  const lean = Math.sqrt(1 - tilt * tilt);
  return (x, y) => {
    const dx = x - c[0]; const dy = y - c[1];
    const pu = (dx * u[0] + dy * u[1]) / r; const pv = (dx * v[0] + dy * v[1]) / r;
    // The depth, squared so strokes near the rim turn with the outline
    // instead of sticking out of it.
    const pz = Math.max(0, 1 - pu * pu - pv * pv);
    const tu = lean * pz - tilt * pv; const tv = tilt * pu;
    return Math.atan2(tu * u[1] + tv * v[1], tu * u[0] + tv * v[0]);
  };
}

// The colour at t in [0, 1] of a palette sorted dark to light.
function pick(pal, t) {
  return pal[Math.max(0, Math.min(pal.length - 1, Math.floor(t * pal.length)))];
}

// Dabs that model forms: at each cell from `scatter`, the first part whose
// `shape` holds it paints a dab along `angle(x, y)` in `colour(x, y)`, turned
// by up to `wobble` / 2. Dabs are 11 to 16 long and 4.2 to 6 wide, times the
// part's size: its `size` if given, else the square root of its area over
// `mass`, held to [0.75, 2.2]; with a `focus` [x, y] they grow again with
// distance from it, up to `far` larger at `reach`. A part's `scale` scales
// the length only, such as 0.8 for a small hard part.
function model(g, R, name, cells, parts, opts = {}) {
  const { len: l0 = 11, longer = 5, wide: w0 = 4.2, wider = 1.8, wobble = 0.5, mass = 160, focus = null, far = 0.6, reach = 450 } = opts;
  const area = (pts) => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
  const sizes = new Map(parts.map((q) => [q, q.size !== undefined ? q.size : Math.max(0.75, Math.min(2.2, Math.sqrt(area(q.shape)) / mass))]));
  for (const [x, y, i] of cells) {
    const p = [x, y];
    const wob = (R(name, 'a', i) - 0.5) * wobble;
    const len = l0 + R(name, 'l', i) * longer; const wide = w0 + R(name, 'w', i) * wider;
    const part = parts.find((q) => pointInPoly(p, q.shape));
    if (!part) continue;
    const m = sizes.get(part) * (focus ? 1 + far * Math.min(1, Math.hypot(x - focus[0], y - focus[1]) / reach) : 1);
    dab(g, x, y, part.angle(x, y) + wob, len * m * (part.scale === undefined ? 1 : part.scale), wide * m, part.colour(x, y));
  }
}

// Dabs laid along an outline, on every `every`th point where `keep(p)`
// allows, each turned along the outline: an accent of dark or bright paint
// on a contour.
function contour(g, pts, colour, opts = {}) {
  const { every = 3, len = 11, wide = 3.6, keep = () => true } = opts;
  pts.forEach((p, i) => {
    if (!keep(p) || i % every) return;
    const q = pts[(i + 1) % pts.length];
    dab(g, p[0], p[1], Math.atan2(q[1] - p[1], q[0] - p[0]), len, wide, colour);
  });
}

module.exports = { LIGHT, FIRE, dab, flow, scatter, ramp, shade, across, pick, model, contour };
