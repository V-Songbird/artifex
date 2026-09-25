// The CAD sheet the plotter lays over the blueprint: the drawing the CAD style
// makes (see skills/artifex/styles/cad.md and cad.js), laid out on this
// landscape sheet round the front view the film printed. Top view above it,
// section A-A beside it, detail B at 2:1, dimensions computed from the
// geometry, centre, hidden, phantom and construction lines, the cutting
// plane, notes, zones and the title block, each layer in its colour.
//
// AS MARKS, IN THE ORDER A PLOTTER DRAWS THEM. Every line, arrowhead and
// letter is a polyline in the sheet's units with its layer; the plotter draws
// them a pen, that is a layer, at a time, each mark from the end of the last
// the nearest next. Nothing here reads the playhead: `drawPlot` draws what
// the plotter has laid by a second of its schedule.

'use strict';

const { chaikin, lengthOf, pointInPoly } = require('../../core/geom.js');
const { glyph } = require('../../core/stroke-font.js');
const { bird } = require('../../skills/artifex/styles/subject.js');
const { span, ease } = require('../../core/time.js');
const Dr = require('./draft.js');

const S = Dr.SCALE;
const K = S / 200;                         // cad.js's sheet to this one, for dashes and arrowheads
const THIN = 1.5;                          // no line finer: finer shimmers and blurs at the site's size, and in a film
const F = (p) => [Dr.FRONT[0] + p[0] * S, Dr.FRONT[1] + p[1] * S];
const T = ([x, z]) => [Dr.FRONT[0] + x * S, 205 + z * S];      // top view: depth downwards
const X = ([z, y]) => [735 + z * S, Dr.FRONT[1] + y * S];       // section A-A: depth to the right
const DC = [968, 208], DR = 100;                                 // detail B's circle
const D = ([x, y]) => [DC[0] + (x - 0.72) * 2 * S, DC[1] + (y + 0.4) * 2 * S];

// Layers from cad.md: colour, width, dash. The colours are the style's,
// lightened to pencil tints over the blue: a film keeps colour at half the
// resolution of light, and the pure colours in fine lines on the blue lost so
// much of theirs that a film of the plot no longer matched its own frames.
const LAYER = {
  object: ['#ffffff', 2.4, []],
  hidden: ['#f6ec8a', 1.4, [9, 5]],
  center: ['#ff9a8f', 1.2, [26, 5, 5, 5]],
  phantom: ['#f4a6f0', 1.3, [26, 5, 5, 5, 5, 5]],
  dim: ['#9eeef4', 1.2, []],
  hatch: ['#9aa3ad', 1, []],
  cut: ['#a6f0a0', 2.8, [30, 6, 6, 6]],
  construct: ['#8e9aa8', 1, [4, 4]],
  text: ['#f6ec8a', 1.4, []],
  label: ['#c4ccd4', 1.1, []],
};
// The order the plotter takes its pens in.
const PENS = ['object', 'hatch', 'construct', 'center', 'hidden', 'phantom', 'cut', 'dim', 'text', 'label'];

// The top view's half outline and wing, as cad.js has them.
const TOP_HALF = [[1.0, 0], [0.72, 0.075], [0.66, 0.16], [0.52, 0.235], [0.38, 0.22], [0.22, 0.27],
  [0.0, 0.32], [-0.3, 0.29], [-0.52, 0.18], [-0.58, 0.1], [-1.02, 0.17], [-1.08, 0.08], [-1.08, 0]];
const WING_TOP = [[0.26, 0.1], [0.12, 0.26], [-0.12, 0.34], [-0.4, 0.3], [-0.66, 0.14], [-0.5, 0.08], [-0.1, 0.06], [0.18, 0.05]];

function ellipse(cx, cy, rx, ry, n = 60) {
  const out = [];
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); }
  return out;
}

/** Where closed polygon `poly` crosses the vertical line x: [top, bottom]. */
function spanAt(poly, x) {
  const ys = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if ((a[0] - x) * (b[0] - x) <= 0 && a[0] !== b[0]) ys.push(a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]));
  }
  return [Math.min(...ys), Math.max(...ys)];
}

/** The parts of polyline `pts` kept by `keep(point)`, as runs, finely resampled. */
function runsWhere(pts, keep, step = 1.5) {
  const runs = [];
  let run = null;
  const visit = (p) => {
    if (!keep(p)) { run = null; return; }
    if (!run) runs.push(run = []);
    run.push(p);
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let j = 0; j < n; j++) visit([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
  }
  visit(pts[pts.length - 1]);
  return runs.filter((r) => r.length > 1);
}

/** Parallel lines across `poly` at `angle`, `spacing` apart, cut to it, as segments. */
function hatchLines(poly, angle, spacing) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, r = Math.hypot(x1 - x0, y1 - y0) / 2;
  const ux = Math.cos(angle), uy = Math.sin(angle), out = [];
  for (let k = -r + spacing / 2; k <= r; k += spacing) {
    const a = [cx - ux * r - uy * k, cy - uy * r + ux * k], b = [cx + ux * r - uy * k, cy + uy * r + ux * k];
    const ex0 = b[0] - a[0], ey0 = b[1] - a[1], ts = [];
    for (let j = 0; j < poly.length; j++) {
      const p = poly[j], q = poly[(j + 1) % poly.length];
      const ex = q[0] - p[0], ey = q[1] - p[1], den = ex0 * ey - ey0 * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((p[0] - a[0]) * ey - (p[1] - a[1]) * ex) / den, u = ((p[0] - a[0]) * ey0 - (p[1] - a[1]) * ex0) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u < 1) ts.push(t);
    }
    ts.sort((m, n) => m - n);
    for (let m = 0; m + 1 < ts.length; m += 2) out.push([[a[0] + ex0 * ts[m], a[1] + ey0 * ts[m]], [a[0] + ex0 * ts[m + 1], a[1] + ey0 * ts[m + 1]]]);
  }
  return out;
}

/** Build stage: the sheet's marks and the plotter's schedule. */
function plot(s) {
  const U = bird(0, 0, 1);
  const marks = [];
  const line = (layer, pts, close = false, width = 0) => { if (pts.length > 1) marks.push({ layer, pts: close ? [...pts, pts[0]] : pts, width }); };
  const fill = (layer, pts) => marks.push({ layer, pts: [...pts, pts[0]], fill: true });
  const seg = (layer, a, b, width = 0) => line(layer, [a, b], false, width);
  const circle = (layer, c, r, n = 36) => line(layer, ellipse(c[0], c[1], r, r, n));
  const mm = (u) => String(Math.round(u * 100));

  // Stroke-font text, vertically centred on y, as marks.
  const text = (str, x, y, size, layer = 'text', align = 'left') => {
    const k = size / 7, w = (str.length * 5.4 - 1.4) * k;
    let pen = x + (align === 'center' ? -w / 2 : align === 'right' ? -w : 0);
    for (const ch of str) {
      for (const run of glyph(ch)) line(layer, run.map(([u, v]) => [pen + u * k, y - size / 2 + v * k]));
      pen += 5.4 * k;
    }
  };
  const arrow = (tip, from) => {
    const d = Math.hypot(tip[0] - from[0], tip[1] - from[1]) || 1, ux = (tip[0] - from[0]) / d, uy = (tip[1] - from[1]) / d, l = 12 * K, h = 3.2 * K;
    fill('dim', [tip, [tip[0] - ux * l - uy * h, tip[1] - uy * l + ux * h], [tip[0] - ux * l + uy * h, tip[1] - uy * l - ux * h]]);
  };
  // Dimension text: the font has no degree or diameter sign, so both are drawn.
  const dimText = (str, x, y, rot = 0, o = {}) => {
    const size = o.size || 12, k = size / 7;
    const w = (str.length * 5.4 - 1.4) * k + (o.dia ? size * 0.95 : 0) + (o.deg ? size * 0.5 : 0);
    const c = Math.cos(rot), sn = Math.sin(rot);
    const at = (px, py) => [x + px * c - py * sn, y + px * sn + py * c];
    let pen = o.align === 'right' ? -w : o.align === 'left' ? 0 : -w / 2;
    if (o.dia) {
      line('dim', ellipse(pen + size * 0.36, 0, size * 0.33, size * 0.33, 20).map(([u, v]) => at(u, v)));
      line('dim', [at(pen, size * 0.48), at(pen + size * 0.72, -size * 0.48)]);
      pen += size * 0.95;
    }
    for (const ch of str) {
      for (const run of glyph(ch)) line('dim', run.map(([u, v]) => at(pen + u * k, -size / 2 + v * k)));
      pen += 5.4 * k;
    }
    if (o.deg) line('dim', ellipse(pen - 1.4 * k + size * 0.24, -size * 0.36, size * 0.13, size * 0.13, 12).map(([u, v]) => at(u, v)));
  };
  const dimH = (a, b, y, label, o) => {
    for (const p of [a, b]) { const sg = Math.sign(y - p[1]) || 1; seg('dim', [p[0], p[1] + sg * 4], [p[0], y + sg * 6]); }
    seg('dim', [a[0], y], [b[0], y]);
    arrow([a[0], y], [b[0], y]);
    arrow([b[0], y], [a[0], y]);
    dimText(label, (a[0] + b[0]) / 2, y - 10, 0, o);
  };
  const dimV = (a, b, x, label, o) => {
    for (const p of [a, b]) { const sg = Math.sign(x - p[0]) || 1; seg('dim', [p[0] + sg * 4, p[1]], [x + sg * 6, p[1]]); }
    seg('dim', [x, a[1]], [x, b[1]]);
    arrow([x, a[1]], [x, b[1]]);
    arrow([x, b[1]], [x, a[1]]);
    dimText(label, x - 10, (a[1] + b[1]) / 2, -Math.PI / 2, o);
  };
  const leader = (tip, knee, label, o = {}) => {
    const dir = o.left ? -1 : 1, end = [knee[0] + dir * 14, knee[1]];
    line('dim', [tip, knee, end]);
    arrow(tip, knee);
    dimText(label, end[0] + dir * 5, end[1], 0, { ...o, align: o.left ? 'right' : 'left' });
  };
  const centreLines = (c, rx, ry = rx) => {
    seg('center', [c[0] - rx - 10, c[1]], [c[0] + rx + 10, c[1]]);
    seg('center', [c[0], c[1] - ry - 10], [c[0], c[1] + ry + 10]);
  };

  // The front view: the film printed its outline; the plotter adds the rest.
  const eye = F(U.eye), headC = F([0.42, -0.42]);
  const hiddenWing = U.wing.map(([x, y]) => F([x + 0.06, y - 0.05]));
  for (const run of runsWhere([...hiddenWing, hiddenWing[0]], (p) => !pointInPoly(p, U.wing.map(F)) && pointInPoly(p, U.body.map(F)))) line('hidden', run);
  line('phantom', [[0.2, -0.08], [-0.2, -0.13], [-0.58, -0.22]].map(F));
  line('construct', ellipse(headC[0], headC[1], 0.3 * S, 0.3 * S, 72));
  centreLines(eye, 0.05 * S);
  centreLines(headC, 0.3 * S);
  const bodyC = F([0, 0.04]);
  seg('center', [bodyC[0] - 0.72 * S, bodyC[1]], [bodyC[0] + 0.72 * S, bodyC[1]]);
  // Cutting plane A-A, looking towards the head.
  const CUT = -0.2, bodySpan = spanAt(U.body, CUT), wingSpan = spanAt(U.wing, CUT);
  const cutX = F([CUT, 0])[0], cutTop = F([0, bodySpan[0]])[1] - 28, cutBot = F([0, 0.69])[1] + 26;
  seg('cut', [cutX, cutTop], [cutX, cutBot]);
  seg('cut', [cutX, cutTop], [cutX, cutTop + 16], 4);
  seg('cut', [cutX, cutBot - 16], [cutX, cutBot], 4);
  for (const y of [cutTop, cutBot]) { seg('dim', [cutX, y], [cutX + 26, y]); arrow([cutX + 26, y], [cutX, y]); }
  // Its letters at the arrows' tips, clear of the dimensions below.
  text('A', cutX + 40, cutTop, 13, 'text', 'center');
  text('A', cutX + 40, cutBot, 13, 'text', 'center');
  // Detail callout B round the beak and eye.
  const bc = F([0.72, -0.4]), br = 0.2875 * S;
  line('object', ellipse(bc[0], bc[1], br, br, 60), false, 1.2);
  const bEdge = [bc[0] + Math.cos(-0.6) * br, bc[1] + Math.sin(-0.6) * br];
  seg('dim', bEdge, [bEdge[0] + 22, bEdge[1] - 18]);
  text('B', bEdge[0] + 32, bEdge[1] - 22, 13, 'text', 'center');
  // Its dimensions.
  const tailTip = F([-1.08, -0.3]), beakTip = F([1.0, -0.34]);
  let top = U.body[0]; for (const p of U.body) if (p[1] < top[1]) top = p;
  const foot = F([U.legs[0][0][0], 0.69]);
  dimH(tailTip, beakTip, foot[1] + 56, mm(2.08));
  dimV(F(top), foot, tailTip[0] - 44, mm(0.69 - top[1]));
  dimH(eye, beakTip, F(top)[1] - 24, mm(1.0 - U.eye[0]));
  const rim = [headC[0] + Math.cos(-2.3) * 0.3 * S, headC[1] + Math.sin(-2.3) * 0.3 * S];
  leader(rim, [rim[0] - 20, rim[1] - 22], 'R' + mm(0.3), { left: true });
  text('FRONT VIEW', Dr.FRONT[0], foot[1] + 74, 14, 'text', 'center');
  text('SCALE 1:1', Dr.FRONT[0], foot[1] + 88, 10, 'label', 'center');

  // The top view.
  const topOutline = chaikin([...TOP_HALF, ...TOP_HALF.slice(1, -1).reverse().map(([x, z]) => [x, -z])], 2, true);
  seg('center', T([-1.3, 0]), T([1.25, 0]));
  const wingR = chaikin(WING_TOP, 2, true), wingL = wingR.map(([x, z]) => [x, -z]);
  // The body's outline where no wing lies over it, then the wings.
  const inWing = (p) => pointInPoly(p, wingR.map(T)) || pointInPoly(p, wingL.map(T));
  for (const run of runsWhere([...topOutline, topOutline[0]].map(T), (p) => !inWing(p))) line('object', run);
  line('object', wingR.map(T), true);
  line('object', wingL.map(T), true);
  for (const sg of [1, -1]) line('phantom', [[0.18, 0.12 * sg], [-0.2, 0.2 * sg], [-0.58, 0.12 * sg]].map(T));
  seg('object', T([0.72, -0.07]), T([0.72, 0.07]));
  for (const sg of [1, -1]) circle('object', T([0.52, 0.2 * sg]), 0.04 * S, 24);
  for (const [x, z] of [[0.02, -0.08], [0.2, 0.08]]) circle('hidden', T([x, z]), 0.03 * S, 20);
  let span = 0; for (const [, z] of wingR) span = Math.max(span, z);
  let headW = 0; for (const [x, z] of topOutline) if (x > 0.4 && x < 0.62) headW = Math.max(headW, Math.abs(z));
  const wingX = wingR.reduce((a, p) => (p[1] > a[1] ? p : a))[0];
  dimV(T([wingX, -span]), T([wingX, span]), tailTip[0] - 44, mm(span * 2));
  dimV(T([0.52, -headW]), T([0.52, headW]), T([1.0, 0])[0] + 40, mm(headW * 2));
  text('TOP VIEW', Dr.FRONT[0], T([0, span])[1] + 30, 14, 'text', 'center');
  // Projection lines from the front view up to the top view.
  for (const x of [-1.08, 1.0, 0.52]) seg('construct', [F([x, 0])[0], F([0, top[1]])[1] - 34], [F([x, 0])[0], T([0, span])[1] + 8]);

  // Section A-A, as seen from the cut towards the head.
  const cy = (bodySpan[0] + bodySpan[1]) / 2, ry = (bodySpan[1] - bodySpan[0]) / 2, rz = 0.32;
  const section = ellipse(0, cy, rz, ry, 72).map(X);
  seg('center', X([0, bodySpan[0] - 0.18]), X([0, 0.69 + 0.12]));
  seg('center', X([-rz - 0.18, cy]), X([rz + 0.18, cy]));
  const inSection = (p) => pointInPoly(p, section);
  // Beyond the cut: the head, its eyes and, hidden, the inside of the head.
  for (const run of runsWhere(ellipse(0, -0.42, 0.24, 0.3, 72).map(X), (p) => !inSection(p))) line('object', run);
  for (const sg of [1, -1]) for (const run of runsWhere(ellipse(0.2 * sg, -0.46, 0.05, 0.05, 24).map(X), (p) => !inSection(p))) line('object', run);
  for (const run of runsWhere(ellipse(0, -0.345, 0.085, 0.095, 36).map(X), (p) => !inSection(p))) line('hidden', run);
  // The wing's shells either side, and the body's section, hatched.
  for (const sg of [1, -1]) {
    const inner = [], outer = [];
    for (let i = 0; i <= 16; i++) {
      const y = wingSpan[0] + ((wingSpan[1] - wingSpan[0]) * i) / 16;
      const k = Math.max(0, 1 - ((y - cy) / ry) ** 2), z = rz * Math.sqrt(k), bulge = 0.055 * Math.sin((Math.PI * i) / 16);
      inner.push([sg * z, y]);
      outer.push([sg * (z + 0.012 + bulge), y]);
    }
    const shell = [...inner, ...outer.reverse()].map(X);
    line('object', shell, true);
    for (const [a, b] of hatchLines(shell, -Math.PI / 4, 5)) seg('hatch', a, b);
  }
  line('object', section);
  for (const [a, b] of hatchLines(section, Math.PI / 4, 7.4)) seg('hatch', a, b);
  for (const sg of [1, -1]) {
    const x = X([sg * 0.08, 0])[0], y0 = X([0, bodySpan[1]])[1], y1 = X([0, 0.69])[1];
    line('object', [[x - 2.5, y0], [x - 2.5, y1], [x + 2.5, y1], [x + 2.5, y0]]);
    seg('object', [x - 8, y1], [x + 8, y1]);
  }
  dimH(X([-rz, cy]), X([rz, cy]), X([0, 0.69])[1] + 38, mm(rz * 2));
  dimV(X([0, bodySpan[0]]), X([0, bodySpan[1]]), X([rz, 0])[0] + 46, mm(bodySpan[1] - bodySpan[0]));
  text('SECTION A-A', X([0, 0])[0], X([0, 0.69])[1] + 74, 14, 'text', 'center');
  text('SCALE 1:1', X([0, 0])[0], X([0, 0.69])[1] + 88, 10, 'label', 'center');

  // Detail B at 2:1, cut to its circle.
  const inDetail = (p) => Math.hypot(p[0] - DC[0], p[1] - DC[1]) < DR - 1;
  const over = (pts, polys) => runsWhere(pts, (p) => inDetail(p) && !polys.some((q) => pointInPoly(p, q)));
  for (const run of over([...U.body, U.body[0]].map(D), [U.wing.map(D), U.beak.map(D)])) line('object', run);
  for (const run of over([...U.wing, U.wing[0]].map(D), [])) line('object', run);
  for (const run of over([...U.beak, U.beak[0]].map(D), [])) line('object', run);
  const de = D(U.eye);
  circle('object', de, 0.05 * 2 * S, 30);
  centreLines(de, 0.05 * 2 * S);
  line('object', ellipse(DC[0], DC[1], DR, DR, 90), false, 1.2);
  const [bu, bt, bl] = U.beak;
  dimH(D(bu), D(bt), D([0, bu[1]])[1] - 30, mm(bt[0] - bu[0]));
  const tip = D(bt), aUp = Math.atan2(D(bu)[1] - tip[1], D(bu)[0] - tip[0]), aLo = Math.atan2(D(bl)[1] - tip[1], D(bl)[0] - tip[0]);
  const upper = aUp < 0 ? aUp + Math.PI * 2 : aUp;
  const arc = [];
  for (let i = 0; i <= 24; i++) { const a = aLo + ((upper - aLo) * i) / 24; arc.push([tip[0] + Math.cos(a) * 40, tip[1] + Math.sin(a) * 40]); }
  line('dim', arc);
  arrow(arc[0], arc[1]);
  arrow(arc[arc.length - 1], arc[arc.length - 2]);
  dimText(String(Math.round(((upper - aLo) * 180) / Math.PI)), tip[0] - 62, tip[1] + 2, 0, { deg: true });
  leader([de[0] + 14, de[1] - 14], [DC[0] + 78, DC[1] - 96], mm(0.1), { dia: true });
  text('DETAIL B', DC[0], DC[1] + DR + 18, 14, 'text', 'center');
  text('SCALE 2:1', DC[0], DC[1] + DR + 34, 10, 'label', 'center');

  // Zones, notes and the title block.
  for (let k = 0; k < 6; k++) { const x = 35 + ((k + 0.5) * (Dr.SW - 70)) / 6; text(String(k + 1), x, 25, 10, 'label', 'center'); text(String(k + 1), x, Dr.SH - 25, 10, 'label', 'center'); }
  for (let k = 0; k < 4; k++) { const y = 35 + ((k + 0.5) * (Dr.SH - 70)) / 4; text('ABCD'[k], 25, y, 10, 'label', 'center'); text('ABCD'[k], Dr.SW - 25, y, 10, 'label', 'center'); }
  ['NOTES:', '1. ALL DIMENSIONS IN MM.', '2. FOLD LINES SHOWN AS PHANTOM LINES.', '3. THIRD ANGLE PROJECTION.'].forEach((n, i) => text(n, 60, 700 + i * 15, 10));
  const [bx0, by0, bx1, by1] = [812, 632, 1165, 765];
  line('object', [[bx0, by1], [bx0, by0], [bx1, by0]], false, 2);
  for (const y of [668, 704, 734]) seg('object', [bx0, y], [bx1, y], 1.1);
  seg('object', [1090, by0], [1090, 668], 1.1);
  for (const x of [960, 1045]) seg('object', [x, 704], [x, by1], 1.1);
  seg('object', [880, 734], [880, by1], 1.1);
  text('ARTIFEX', bx0 + 12, 650, 20);
  const cell = (x, y, label, value, size = 11) => { text(label, x + 6, y + 8, 6.5, 'label'); text(value, x + 6, y + 23, size); };
  cell(1090, by0, 'MASS', '4 G');
  cell(bx0, 668, 'TITLE', 'BIRD - GENERAL ARRANGEMENT', 12);
  cell(bx0, 704, 'DWG NO.', 'ART-3A-001');
  cell(960, 704, 'REV', 'A');
  cell(1045, 704, 'SHEET', '3 OF 10');
  cell(bx0, 734, 'SCALE', '1:1');
  cell(880, 734, 'UNITS', 'MM');
  cell(960, 734, 'SEED', String(s.seed));
  cell(1045, 734, 'PAPER', 'CYANOTYPE', 10);

  s.plot = schedule(marks);
}

const DOWN = 1500, UP = 5000, LIFT = 0.012, CHANGE = 0.3;   // pen speeds in sheet units a second, and the seconds a lift and a pen change take

/** The marks in the plotter's order, each with its seconds on the plotter's own clock, from 0. */
function schedule(marks) {
  const out = [];
  let t = 0, at = [0, 0];
  for (const pen of PENS) {
    const left = marks.filter((m) => m.layer === pen);
    if (!left.length) continue;
    if (out.length) t += CHANGE;
    while (left.length) {
      let best = 0, flip = false, d = Infinity;
      left.forEach((m, i) => {
        for (const [p, f] of [[m.pts[0], false], [m.pts[m.pts.length - 1], true]]) {
          const e = Math.hypot(p[0] - at[0], p[1] - at[1]);
          if (e < d) { d = e; best = i; flip = f && !m.fill; }
        }
      });
      const m = left.splice(best, 1)[0];
      const pts = flip ? m.pts.slice().reverse() : m.pts;
      t += Math.hypot(pts[0][0] - at[0], pts[0][1] - at[1]) / UP + LIFT;
      const len = lengthOf(pts), cum = [0];
      for (let j = 1; j < pts.length; j++) cum.push(cum[j - 1] + Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]));
      out.push({ ...m, pts, len, cum, t0: t, t1: t + len / DOWN });
      t += len / DOWN;
      at = pts[pts.length - 1];
    }
  }
  return { marks: out, length: t };
}

/** The point at arc length `a` along mark `m`. */
function pointAt(m, a) {
  const { pts, cum } = m;
  let lo = 1, hi = pts.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < a) lo = mid + 1; else hi = mid; }
  const u = cum[lo] === cum[lo - 1] ? 0 : Math.max(0, Math.min(1, (a - cum[lo - 1]) / (cum[lo] - cum[lo - 1])));
  return [pts[lo - 1][0] + (pts[lo][0] - pts[lo - 1][0]) * u, pts[lo - 1][1] + (pts[lo][1] - pts[lo - 1][1]) * u];
}

/** Where the pen is at `u` on the plotter's clock (0 to its length), and whether it is down. */
function penAt(s, u) {
  const ms = s.plot.marks;
  let lo = 0, hi = ms.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ms[mid].t0 <= u) lo = mid; else hi = mid - 1; }
  const m = ms[lo];
  if (u < m.t0) return { p: m.pts[0], down: false };
  if (u <= m.t1) return { p: pointAt(m, (u - m.t0) * DOWN), down: true, layer: m.layer };
  const next = ms[lo + 1];
  if (!next) return { p: m.pts[m.pts.length - 1], down: false };
  const e = Math.min(1, (u - m.t1) / Math.max(1e-6, next.t0 - m.t1));
  const a = m.pts[m.pts.length - 1];
  return { p: [a[0] + (next.pts[0][0] - a[0]) * e, a[1] + (next.pts[0][1] - a[1]) * e], down: false, layer: next.layer };
}

function trace(g, m, a1) {
  if (a1 <= 0) return;
  const { pts, cum } = m;
  g.moveTo(pts[0][0], pts[0][1]);
  for (let j = 1; j < pts.length && cum[j] < a1; j++) g.lineTo(pts[j][0], pts[j][1]);
  const [x, y] = pointAt(m, a1);
  g.lineTo(x, y);
}

/** Everything the plotter has laid by `u` on its clock, of the marks `from` to before `to` in its order, a layer at a time. In sheet units. */
function drawPlot(g, s, u, from = 0, to = Infinity) {
  const marks = s.plot.marks.slice(from, to);
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const pen of PENS) {
    const [colour, width, dash] = LAYER[pen];
    g.strokeStyle = colour;
    g.fillStyle = colour;
    g.setLineDash(dash.map((d) => d * K));
    // Lines of the layer's own width in one path; the heavier or lighter ones each on their own.
    g.lineWidth = Math.max(THIN, width);
    g.beginPath();
    let any = false;
    for (const m of marks) {
      if (m.layer !== pen || m.t0 > u || m.fill || m.width) continue;
      any = true;
      trace(g, m, Math.min(m.len, (u - m.t0) * DOWN));
    }
    if (any) g.stroke();
    for (const m of marks) {
      if (m.layer !== pen || m.t0 > u || m.fill || !m.width) continue;
      g.lineWidth = Math.max(THIN, m.width);
      if (m.width >= 4) g.setLineDash([]);
      g.beginPath();
      trace(g, m, Math.min(m.len, (u - m.t0) * DOWN));
      g.stroke();
      g.setLineDash(dash.map((d) => d * K));
    }
    // Arrowheads fill once the pen has gone round them.
    g.beginPath();
    any = false;
    for (const m of marks) {
      if (m.layer !== pen || !m.fill || m.t1 > u) continue;
      any = true;
      g.moveTo(m.pts[0][0], m.pts[0][1]);
      for (let j = 1; j < m.pts.length; j++) g.lineTo(m.pts[j][0], m.pts[j][1]);
      g.closePath();
    }
    if (any) g.fill();
  }
  g.restore();
}

// The plot on the CAD shot's clock (see cad.cjs), for it and the seam after it.
const PLOT = [2.4, 11.6];                        // the pen's first mark and its last
const PARKED = 13.6;                             // the gantry goes home past the sheet's left edge, on into the next seam
const PACE = 1.2, RAMP = 1.2;                    // the plotter's own pace, then how long it takes to speed up

/** How many marks the plotter has finished by `u` on its clock. */
function finished(s, u) {
  const ms = s.plot.marks;
  let lo = 0, hi = ms.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (ms[mid].t1 <= u) lo = mid + 1; else hi = mid; }
  return lo;
}

/** Seconds on the plotter's own clock at second `sec`: its pace, then a time-lapse `fast` times quicker. */
function plotted(s, sec) {
  const d = PLOT[1] - PLOT[0], fast = (s.plot.length - PACE - RAMP / 2) / (RAMP / 2 + d - PACE - RAMP);
  const x = Math.max(0, Math.min(d, sec - PLOT[0]));
  if (x <= PACE) return x;
  if (x <= PACE + RAMP) { const y = x - PACE; return PACE + y + ((fast - 1) * y * y) / (2 * RAMP); }
  return PACE + RAMP * (1 + fast) / 2 + (x - PACE - RAMP) * fast;
}

/**
 * The plotter over the sheet, seen by its shadow as in the intro: the gantry
 * spanning the sheet at the pen's x and the carriage over the pen, cast away
 * from the light, fainter the faster it goes. In sheet units.
 */
function drawPlotter(g, s, sec) {
  let x, y, speed = 1;
  if (sec < PLOT[0]) {
    const e = ease.out(span(PLOT[0] - 0.5, PLOT[0], sec)), first = s.plot.marks[0].pts[0];
    x = -400 + (first[0] + 400) * e; y = first[1];
  } else if (sec <= PLOT[1]) {
    const u = plotted(s, sec), p = penAt(s, u).p;
    x = p[0]; y = p[1];
    speed = (plotted(s, sec + 1 / 30) - u) * 30;
  } else {
    const p = penAt(s, s.plot.length).p, e = span(PLOT[1], PARKED, sec);
    x = p[0] + (-420 - p[0]) * e; y = p[1];
  }
  const ox = -Math.cos(s.light) * 34, oy = -Math.sin(s.light) * 34, a = 1 / Math.sqrt(Math.max(1, speed));
  const gx = x + ox;
  const band = g.createLinearGradient(gx - 80, 0, gx + 80, 0);
  band.addColorStop(0, 'rgba(0, 4, 16, 0)');
  band.addColorStop(0.36, `rgba(0, 4, 16, ${0.08 * a})`);
  band.addColorStop(0.5, `rgba(0, 4, 16, ${0.16 * a})`);
  band.addColorStop(0.64, `rgba(0, 4, 16, ${0.08 * a})`);
  band.addColorStop(1, 'rgba(0, 4, 16, 0)');
  g.fillStyle = band;
  g.fillRect(gx - 80, -300, 160, Dr.SH + 600);
  const cx = x + ox * 0.9, cy = y + oy * 0.9;
  const blob = g.createRadialGradient(cx, cy, 0, cx, cy, 44);
  blob.addColorStop(0, `rgba(0, 4, 16, ${0.26 * a})`);
  blob.addColorStop(1, 'rgba(0, 4, 16, 0)');
  g.fillStyle = blob;
  g.fillRect(cx - 44, cy - 44, 88, 88);
}


module.exports = { plot, drawPlot, finished, penAt, plotted, drawPlotter, PLOT, PARKED, LAYER };
