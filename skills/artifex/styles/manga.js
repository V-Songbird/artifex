// Manga: black ink on white paper, printed in one colour. Lines come from a
// dip pen whose width follows the hand's pressure, entering and leaving on the
// point. Greys are never flat: they are printed dots (screentone) or lines.
// Motion and force are drawn as lines too: speed lines, focus lines, bursts.
// Moving, the style keeps its drawings held for two or three frames.
//
// A parts bin: functions that draw the style's marks on any path, outline or
// area you give them. Nothing here picks a subject, a scene or a layout.

'use strict';

const { fbm } = require('../../../core/rand.js');
const { chaikin, resample, bbox, pointInPoly } = require('../../../core/geom.js');
const { outline: band } = require('../../../core/path.js');
const { drawingAt } = require('../../../core/time.js');
const { path, ellipse, grain } = require('./kit.js');

const INK = '#141210';
const PAPER = '#f6f4ee';

// Pressure over a pen line, t from 0 to 1. `both` enters and leaves on the
// point, the dip pen's own line; `out` starts pressed and lifts to a point, for
// hair, a flick or a trail; `in` is `out` reversed, a line that lands; `even`
// holds one width, a ruled line.
const PRESS = {
  both: (t) => Math.sin(Math.PI * Math.min(1, Math.max(0, t))) ** 0.55,
  out: (t) => (1 - Math.min(1, t)) ** 0.7 * (0.55 + 0.45 * Math.min(1, t * 6)),
  in: (t) => PRESS.out(1 - t),
  even: () => 1,
};

// Paper: flat off-white with a few printed specks. `specks` 0 leaves it clean.
function paper(g, R, w, h, { colour = PAPER, specks = 220 } = {}) {
  g.fillStyle = colour;
  g.fillRect(0, 0, w, h);
  if (specks) grain(g, R, 'paper', w, h, specks, 'rgba(255, 255, 255, 0.5)', 'rgba(20, 18, 16, 0.12)');
}

// One dip-pen line along `spine`: a filled outline whose half-width is
// `w / 2 x press(t)`, so it tapers to points. `wobble` varies the nib with a
// slow noise (0.1 is a steady hand, 0.3 a quick one); `smooth` Chaikin passes
// round the spine; `halo` first strokes a paper-coloured edge that many units
// wide, so the line reads over tone or black.
function pen(g, R, name, spine, opts = {}) {
  const { w = 3, press = PRESS.both, ink = INK, wobble = 0.12, smooth = 2, halo = 0, step = 1.5 } = opts;
  if (spine.length < 2) return;
  const pts = resample(smooth && spine.length > 2 ? chaikin(spine, smooth) : spine, step);
  if (pts.length < 2) return;
  const n = pts.length;
  const outline = band(pts, pts.map((_, i) => 2 * Math.max(0.04, (w / 2) * press(i / (n - 1))
    * (1 + wobble * 2 * (fbm(R, i * 0.07, 3.1, 2, name + 'nib') - 0.5)))), { cap: 'butt' });
  g.save();
  g.lineJoin = 'round';
  if (halo > 0) {
    g.strokeStyle = PAPER;
    g.lineWidth = halo * 2;
    path(g, outline);
    g.stroke();
  }
  g.fillStyle = ink;
  path(g, outline);
  g.fill();
  g.restore();
}

// Solid black (beta): fill each outline with ink, for hair, shadow and night.
// A white `halo` around it keeps it apart from a black behind.
function beta(g, outlines, { ink = INK, halo = 0 } = {}) {
  g.save();
  g.beginPath();
  for (const pts of outlines) { g.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) g.lineTo(p[0], p[1]); g.closePath(); }
  if (halo > 0) { g.strokeStyle = PAPER; g.lineWidth = halo * 2; g.lineJoin = 'round'; g.stroke(); }
  g.fillStyle = ink;
  g.fill();
  g.restore();
}

// Screentone: a printed grid of round dots clipped to `area` (one outline, or
// a list of them). `value` is the ink's share of the area, 0.05 a pale tint to
// 0.6 a dark grey; past about 0.75 the dots merge. `pitch` is the dot spacing
// (4 to 8 units reads as print), `angle` the screen's angle (45 degrees by
// default, the printer's). `ramp: { from: [x, y], to: [x, y], value }` grades
// the tone from `value` at `from` to `ramp.value` at `to`, the gradation tone.
function screentone(g, area, opts = {}) {
  const { value = 0.25, pitch = 6, angle = Math.PI / 4, ink = INK, ramp = null } = opts;
  const areas = Array.isArray(area[0][0]) ? area : [area];
  const [x0, y0, x1, y1] = bbox(areas.flat());
  const c = Math.cos(angle); const s = Math.sin(angle);
  const half = Math.hypot(x1 - x0, y1 - y0) / 2 + pitch;
  const mx = (x0 + x1) / 2; const my = (y0 + y1) / 2;
  const along = ramp && [ramp.to[0] - ramp.from[0], ramp.to[1] - ramp.from[1]];
  const span = along && (along[0] ** 2 + along[1] ** 2 || 1);
  const at = (x, y) => {
    if (!ramp) return value;
    const k = Math.max(0, Math.min(1, ((x - ramp.from[0]) * along[0] + (y - ramp.from[1]) * along[1]) / span));
    return value + (ramp.value - value) * k;
  };
  g.save();
  g.beginPath();
  for (const pts of areas) { g.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) g.lineTo(p[0], p[1]); g.closePath(); }
  g.clip();
  g.fillStyle = ink;
  g.beginPath();
  for (let u = -half; u <= half; u += pitch) {
    for (let v = -half; v <= half; v += pitch) {
      const x = mx + u * c - v * s; const y = my + u * s + v * c;
      if (x < x0 - pitch || x > x1 + pitch || y < y0 - pitch || y > y1 + pitch) continue;
      const r = pitch * Math.sqrt(Math.max(0, at(x, y)) / Math.PI);
      if (r < 0.15) continue;
      g.moveTo(x + r, y);
      g.arc(x, y, r, 0, Math.PI * 2);
    }
  }
  g.fill();
  g.restore();
}

// Hatching by hand (kakeami): rows of short pen strokes inside `area`, each
// tapered at both ends. `layers` 1 is parallel hatching, 2 or 3 cross it at
// `cross` radians; `pitch` is the row spacing, `len` a stroke's length, `w` its
// width. Only strokes whose ends both fall inside the area are drawn, so every
// stroke ends on its point, not on a cut.
function hatch(g, R, name, area, opts = {}) {
  const { angle = -0.6, pitch = 5, len = 26, w = 1.1, layers = 1, cross = 0.9, ink = INK, jitter = 0.12 } = opts;
  const [x0, y0, x1, y1] = bbox(area);
  const mx = (x0 + x1) / 2; const my = (y0 + y1) / 2;
  const half = Math.hypot(x1 - x0, y1 - y0) / 2;
  for (let k = 0; k < layers; k++) {
    const a = angle + k * cross; const c = Math.cos(a); const s = Math.sin(a);
    for (let row = 0, v = -half; v <= half; v += pitch, row++) {
      // Rows of strokes laid like bricks, each row half a stroke along from the last.
      const shift = (row % 2) * len * 0.55 + R(name, 'row' + k, row) * len * jitter;
      for (let i = 0, u = -half - shift; u <= half; u += len * 1.1, i++) {
        const l = len * (1 - jitter * R(name, 'len' + k + '.' + row, i));
        const off = (R(name, 'off' + k + '.' + row, i) - 0.5) * pitch * jitter;
        const ax = mx + u * c - (v + off) * s; const ay = my + u * s + (v + off) * c;
        const bx = ax + l * c; const by = ay + l * s;
        if (!pointInPoly([ax, ay], area) || !pointInPoly([bx, by], area)) continue;
        pen(g, R, name + k + '.' + row + '.' + i, [[ax, ay], [bx, by]], { w, ink, smooth: 0, wobble: 0.05, step: 2 });
      }
    }
  }
}

// Points along a line through `box` = [x0, y0, x1, y1] at angle `a` and
// perpendicular offset `v` from the box's centre, clipped to the box.
function across(box, a, v) {
  const [x0, y0, x1, y1] = box;
  const mx = (x0 + x1) / 2; const my = (y0 + y1) / 2; const half = Math.hypot(x1 - x0, y1 - y0) / 2;
  const c = Math.cos(a); const s = Math.sin(a);
  return [[mx - half * c - v * s, my - half * s + v * c], [mx + half * c - v * s, my + half * s + v * c]];
}

// Speed lines (ryusen): parallel tapered lines across `box` at `angle`, the
// direction of motion. `count` lines; each covers `reach` (a [min, max] share
// of the box's diagonal) at a seeded place along its row. `clear: [cx, cy, r]`
// leaves a round lane unlined, where the moving thing is. Behind a subject
// they say the camera follows it; over the subject, that it moves. `path`, a
// list of points along a turning motion, bends every line with it: each runs
// beside the path at its own offset, over `reach` of the path's length.
function speedLines(g, R, name, box, opts = {}) {
  const { angle = 0, count = 70, w = 2.2, reach = [0.25, 0.8], clear = null, ink = INK, path: along = null } = opts;
  const half = Math.hypot(box[2] - box[0], box[3] - box[1]) / 2;
  const c = Math.cos(angle); const s = Math.sin(angle);
  const P = along && resample(chaikin(along, 3), 2);
  g.save();
  g.beginPath();
  g.rect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
  g.clip();
  for (let i = 0; i < count; i++) {
    const v = (R(name, 'v', i) * 2 - 1) * half;
    if (P) {
      // Offset a share of the path by v along its normal and cut out the lane.
      // A line inside a turn tighter than v would fold back on itself: skip it.
      const n = P.length - 1;
      const k = Math.round(n * (reach[0] + (reach[1] - reach[0]) * R(name, 'reach', i)));
      const lo = Math.round(R(name, 'start', i) * (n - k));
      const line = P.slice(lo, lo + k + 1).map(([x, y], j) => {
        const p = P[Math.max(0, lo + j - 1)]; const q = P[Math.min(n, lo + j + 1)];
        const d = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
        return [x - ((q[1] - p[1]) / d) * v, y + ((q[0] - p[0]) / d) * v];
      });
      if (line.some((pt, j) => j > 0 && (pt[0] - line[j - 1][0]) * (P[lo + j][0] - P[lo + j - 1][0])
        + (pt[1] - line[j - 1][1]) * (P[lo + j][1] - P[lo + j - 1][1]) <= 0)) continue;
      const runs = [[]];
      for (const pt of line) {
        if (clear && Math.hypot(pt[0] - clear[0], pt[1] - clear[1]) < clear[2]) { if (runs.at(-1).length) runs.push([]); } else runs.at(-1).push(pt);
      }
      for (const [j, run] of runs.filter((r) => r.length > 3).entries()) {
        pen(g, R, name + i + '.' + j, run, { w: w * (0.5 + R(name, 'w', i)), press: PRESS.both, ink, smooth: 0, wobble: 0.04, step: 3 });
      }
      continue;
    }
    const [a] = across(box, angle, v);
    const length = 2 * half * (reach[0] + (reach[1] - reach[0]) * R(name, 'reach', i));
    const start = R(name, 'start', i) * (2 * half - length);
    let runs = [[start, start + length]];
    if (clear) {
      // Where the line passes the lane, cut it in two.
      const [cx, cy, r] = clear;
      const t = (cx - a[0]) * c + (cy - a[1]) * s;
      const d = Math.abs(-(cx - a[0]) * s + (cy - a[1]) * c);
      if (d < r) {
        const h = Math.sqrt(r * r - d * d);
        runs = runs.flatMap(([p, q]) => [[p, Math.min(q, t - h)], [Math.max(p, t + h), q]]).filter(([p, q]) => q - p > 6);
      }
    }
    for (const [k, [p, q]] of runs.entries()) {
      pen(g, R, name + i + '.' + k, [[a[0] + c * p, a[1] + s * p], [a[0] + c * q, a[1] + s * q]],
        { w: w * (0.5 + R(name, 'w', i)), press: PRESS.both, ink, smooth: 0, wobble: 0.04, step: 3 });
    }
  }
  g.restore();
}

// Focus lines (shuchusen): lines that run from outside `box` toward the point
// (cx, cy) and stop short of it, thick at the edge and pointed inside. `r` is
// the clear radius they stop at, `jitter` how unevenly (0.3 is hand-ruled),
// `count` how many, `w` their width at the edge.
function focusLines(g, R, name, cx, cy, box, opts = {}) {
  const { r = 120, count = 140, w = 5, jitter = 0.35, ink = INK } = opts;
  const far = Math.hypot(Math.max(cx - box[0], box[2] - cx), Math.max(cy - box[1], box[3] - cy)) + 10;
  g.save();
  g.beginPath();
  g.rect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
  g.clip();
  for (let i = 0; i < count; i++) {
    const a = ((i + R(name, 'a', i) * 0.8) / count) * Math.PI * 2;
    const inner = r * (1 + jitter * (R(name, 'r', i) * 2 - 1)) + (R(name, 'long', i) < 0.15 ? r * 0.3 : 0);
    const c = Math.cos(a); const s = Math.sin(a);
    pen(g, R, name + i, [[cx + c * far, cy + s * far], [cx + c * inner, cy + s * inner]],
      { w: w * (0.4 + 0.9 * R(name, 'w', i)), press: PRESS.out, ink, smooth: 0, wobble: 0.03, step: 3 });
  }
  g.restore();
}

// A burst (beta flash): black from radius `r1` outward, broken by white spikes
// that shoot from a white core of radius `r0` past `r1`. It marks a shock, a
// reveal or a shout. `spikes` many, `reach` how far past r1 the longest go.
function burst(g, R, name, cx, cy, r0, r1, opts = {}) {
  const { spikes = 48, reach = 0.6, ink = INK, out = r1 * 2.2 } = opts;
  g.save();
  g.fillStyle = ink;
  g.beginPath();
  g.arc(cx, cy, out, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = PAPER;
  for (let i = 0; i < spikes; i++) {
    const a = ((i + R(name, 'a', i) * 0.7) / spikes) * Math.PI * 2;
    const tip = r1 + (out - r1) * reach * R(name, 'tip', i) ** 1.5;
    const half = (Math.PI / spikes) * (0.35 + 0.5 * R(name, 'wide', i));
    g.beginPath();
    g.moveTo(cx + Math.cos(a - half) * r0, cy + Math.sin(a - half) * r0);
    g.lineTo(cx + Math.cos(a) * tip, cy + Math.sin(a) * tip);
    g.lineTo(cx + Math.cos(a + half) * r0, cy + Math.sin(a + half) * r0);
    g.closePath();
    g.fill();
  }
  g.beginPath();
  g.arc(cx, cy, r0 * 1.02, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

// A panel border: the outline stroked in ink at one width `w`, with mitred
// corners, after filling it with paper so it covers what lies behind.
function panel(g, outline, { w = 3, ink = INK, fill = PAPER } = {}) {
  g.save();
  if (fill) { g.fillStyle = fill; path(g, outline); g.fill(); }
  g.strokeStyle = ink;
  g.lineWidth = w;
  g.lineJoin = 'miter';
  path(g, outline);
  g.stroke();
  g.restore();
}

// A balloon round (cx, cy), radii rx and ry, its tail pointing at `tail`
// ([x, y] or null). `kind`: 'speech' an ellipse whose tail is part of its
// outline; 'shout' a jagged star; 'thought' a cloud of bumps trailing small
// circles. Filled with paper and outlined in a pen line `w` wide.
function balloon(g, R, name, cx, cy, rx, ry, opts = {}) {
  const { kind = 'speech', tail = null, w = 2, ink = INK } = opts;
  let outline;
  if (kind === 'shout') {
    const n = 22; outline = [];
    for (let i = 0; i < n * 2; i++) {
      const a = (i / (n * 2)) * Math.PI * 2;
      const k = i % 2 ? 0.78 + 0.08 * R(name, 'in', i) : 1.05 + 0.25 * R(name, 'out', i);
      outline.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
    }
  } else if (kind === 'thought') {
    const n = 11; outline = [];
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2; const a1 = ((i + 1) / n) * Math.PI * 2;
      const bump = 0.18 + 0.06 * R(name, 'bump', i);
      for (let k = 0; k <= 8; k++) {
        const a = a0 + (a1 - a0) * (k / 8);
        const out = 1 + bump * Math.sin(Math.PI * (k / 8));
        outline.push([cx + Math.cos(a) * rx * out, cy + Math.sin(a) * ry * out]);
      }
    }
  } else if (tail) {
    // The ellipse opens where it faces the tail, and its outline runs out to the tip.
    const a = Math.atan2((tail[1] - cy) / ry, (tail[0] - cx) / rx); const gap = 0.2;
    outline = [];
    for (let k = 0; k <= 64; k++) {
      const t = a + gap + (Math.PI * 2 - 2 * gap) * (k / 64);
      outline.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry]);
    }
    outline.push(tail);
  } else {
    outline = ellipse(cx, cy, rx, ry, 64);
  }
  g.save();
  g.fillStyle = PAPER;
  path(g, outline);
  g.fill();
  g.strokeStyle = ink;
  g.lineWidth = w;
  g.lineJoin = 'round';
  path(g, outline);
  g.stroke();
  if (kind === 'thought' && tail) {
    for (let k = 1; k <= 3; k++) {
      const t = 0.55 + k * 0.15;
      const x = cx + (tail[0] - cx) * t; const y = cy + (tail[1] - cy) * t;
      const rr = Math.min(rx, ry) * (0.16 - k * 0.035);
      g.fillStyle = PAPER;
      g.beginPath();
      g.arc(x, y, rr, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  }
  g.restore();
}

// An impact frame: inverts everything drawn so far, ink to paper and paper to
// ink, for one or two frames at a hit. Raster only: it composites with
// 'difference'.
function impact(g, w, h) {
  g.save();
  g.globalCompositeOperation = 'difference';
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  g.restore();
}

// Limited animation: the drawing a moment shows when each drawing is held for
// `every` frames (2 is "on twos", 3 "on threes") at `fps`. Returns the held
// time in seconds and the drawing's index; address a line's wobble by the index
// so it boils, redrawn by hand, from one drawing to the next. drawingAt in
// core/time.js does this from the clock for any style.
function held(seconds, every = 2, fps = 24) {
  return drawingAt({ frame: seconds * fps, hz: fps }, every);
}

// Camera shake for a hit: an offset [dx, dy] up to `amp` units, new on each
// drawing `index`, easing to nothing over `settle` drawings after `from`.
function shake(R, name, index, amp, from = 0, settle = 6) {
  const k = Math.max(0, 1 - (index - from) / settle);
  if (index < from || k <= 0) return [0, 0];
  return [(R(name, 'x', index) * 2 - 1) * amp * k, (R(name, 'y', index) * 2 - 1) * amp * k];
}

module.exports = { INK, PAPER, PRESS, paper, pen, beta, screentone, hatch, speedLines, focusLines, burst, panel, balloon, impact, held, shake };
