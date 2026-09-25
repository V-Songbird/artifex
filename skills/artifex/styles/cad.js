// CAD: a technical drawing of the bird as a CAD package shows model space,
// with no interface: a dark background, layer colours, stroke-font text.
// Third-angle top and front views, a hatched section, a 2:1 detail, linear,
// angular, radius and diameter dimensions, centre, hidden and phantom lines,
// a cutting plane, notes, zones and a title block.

'use strict';

const { chaikin } = require('../../../core/geom.js');
const font = require('../../../core/stroke-font.js');
const { bird } = require('./subject.js');
const { path, sub } = require('./kit.js');

const W = 1000; const H = 1000;
const BG = '#212830';
const LAYER = {
  object: ['#ffffff', 2.4, []],
  hidden: ['#ffff00', 1.4, [9, 5]],
  center: ['#ff0000', 1.2, [26, 5, 5, 5]],
  phantom: ['#ff00ff', 1.3, [26, 5, 5, 5, 5, 5]],
  dim: ['#00ffff', 1.2, []],
  hatch: ['#808080', 1, []],
  cut: ['#00ff00', 2.8, [30, 6, 6, 6]],
  construct: ['#7d8996', 1, [4, 4]],
  frame: ['#ffffff', 1.4, []],
  text: ['#ffff00', 1.4, []],
  label: ['#b8c0c8', 1.1, []],
};

function layer(g, name, width) {
  const [colour, w, dash] = LAYER[name];
  g.strokeStyle = colour;
  g.fillStyle = colour;
  g.lineWidth = width || w;
  g.setLineDash(dash);
}

function seg(g, a, b) {
  g.beginPath();
  g.moveTo(a[0], a[1]);
  g.lineTo(b[0], b[1]);
  g.stroke();
}

// Stroke-font text, vertically centred on y.
function txt(g, str, x, y, size, name = 'text', align = 'left', rot = 0) {
  const w = font.width(str, size);
  g.save();
  layer(g, name, Math.max(1.1, size * 0.1));
  g.setLineDash([]);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.translate(x, y);
  if (rot) g.rotate(rot);
  font.text(g, str, align === 'center' ? -w / 2 : align === 'right' ? -w : 0, -size / 2, size);
  g.restore();
  return w;
}

// Dimension text: the font has no degree or diameter sign, so both are drawn.
function dimText(g, str, x, y, rot = 0, o = {}) {
  const size = o.size || 13;
  const w = font.width(str, size) + (o.dia ? size * 0.95 : 0) + (o.deg ? size * 0.5 : 0);
  g.save();
  layer(g, 'dim', 1.3);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.translate(x, y);
  if (rot) g.rotate(rot);
  let pen = o.align === 'right' ? -w : o.align === 'left' ? 0 : -w / 2;
  if (o.dia) {
    g.beginPath();
    g.arc(pen + size * 0.36, 0, size * 0.33, 0, Math.PI * 2);
    g.moveTo(pen, size * 0.48);
    g.lineTo(pen + size * 0.72, -size * 0.48);
    g.stroke();
    pen += size * 0.95;
  }
  font.text(g, str, pen, -size / 2, size);
  pen += font.width(str, size);
  if (o.deg) {
    g.beginPath();
    g.arc(pen + size * 0.24, -size * 0.36, size * 0.13, 0, Math.PI * 2);
    g.stroke();
  }
  g.restore();
}

function arrow(g, tip, from) {
  const dx = tip[0] - from[0]; const dy = tip[1] - from[1]; const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d; const uy = dy / d;
  g.beginPath();
  g.moveTo(tip[0], tip[1]);
  g.lineTo(tip[0] - ux * 12 - uy * 3.2, tip[1] - uy * 12 + ux * 3.2);
  g.lineTo(tip[0] - ux * 12 + uy * 3.2, tip[1] - uy * 12 - ux * 3.2);
  g.closePath();
  g.fill();
}

function dimH(g, a, b, y, label, o = {}) {
  layer(g, 'dim');
  for (const p of [a, b]) {
    const s = Math.sign(y - p[1]) || 1;
    seg(g, [p[0], p[1] + s * 4], [p[0], y + s * 6]);
  }
  seg(g, [a[0], y], [b[0], y]);
  arrow(g, [a[0], y], [b[0], y]);
  arrow(g, [b[0], y], [a[0], y]);
  dimText(g, label, (a[0] + b[0]) / 2, y - 11, 0, o);
}

function dimV(g, a, b, x, label, o = {}) {
  layer(g, 'dim');
  for (const p of [a, b]) {
    const s = Math.sign(x - p[0]) || 1;
    seg(g, [p[0] + s * 4, p[1]], [x + s * 6, p[1]]);
  }
  seg(g, [x, a[1]], [x, b[1]]);
  arrow(g, [x, a[1]], [x, b[1]]);
  arrow(g, [x, b[1]], [x, a[1]]);
  dimText(g, label, x - 11, (a[1] + b[1]) / 2, -Math.PI / 2, o);
}

function dimAngle(g, c, r, a0, a1, label, at) {
  layer(g, 'dim');
  g.beginPath();
  g.arc(c[0], c[1], r, a0, a1);
  g.stroke();
  const p0 = [c[0] + Math.cos(a0) * r, c[1] + Math.sin(a0) * r];
  const p1 = [c[0] + Math.cos(a1) * r, c[1] + Math.sin(a1) * r];
  arrow(g, p0, [p0[0] - Math.sin(a0) * 12, p0[1] + Math.cos(a0) * 12]);
  arrow(g, p1, [p1[0] + Math.sin(a1) * 12, p1[1] - Math.cos(a1) * 12]);
  dimText(g, label, at[0], at[1], 0, { deg: true });
}

function leader(g, tip, knee, label, o = {}) {
  layer(g, 'dim');
  const dir = o.left ? -1 : 1;
  const end = [knee[0] + dir * 16, knee[1]];
  seg(g, tip, knee);
  seg(g, knee, end);
  arrow(g, tip, knee);
  dimText(g, label, end[0] + dir * 5, end[1], 0, { ...o, align: o.left ? 'right' : 'left' });
}

function centreLines(g, c, rx, ry = rx) {
  layer(g, 'center');
  seg(g, [c[0] - rx - 12, c[1]], [c[0] + rx + 12, c[1]]);
  seg(g, [c[0], c[1] - ry - 12], [c[0], c[1] + ry + 12]);
}

function hatch(g, poly, angle, spacing) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const cx = (x0 + x1) / 2; const cy = (y0 + y1) / 2; const r = Math.hypot(x1 - x0, y1 - y0) / 2;
  const ux = Math.cos(angle); const uy = Math.sin(angle);
  g.save();
  path(g, poly);
  g.clip();
  layer(g, 'hatch');
  g.beginPath();
  for (let k = -r; k <= r; k += spacing) {
    g.moveTo(cx - ux * r - uy * k, cy - uy * r + ux * k);
    g.lineTo(cx + ux * r - uy * k, cy + uy * r + ux * k);
  }
  g.stroke();
  g.restore();
}

function ellipse(cx, cy, rx, ry, n = 72) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
}

// Where a closed polygon crosses the vertical line x: [top, bottom].
function spanAt(poly, x) {
  const ys = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]; const b = poly[(i + 1) % poly.length];
    if ((a[0] - x) * (b[0] - x) <= 0 && a[0] !== b[0]) ys.push(a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]));
  }
  return [Math.min(...ys), Math.max(...ys)];
}

// Visible outline over a background fill, so what lies behind is hidden.
function solid(g, pts) {
  g.fillStyle = BG;
  path(g, pts);
  g.fill();
  layer(g, 'object');
  path(g, pts);
  g.stroke();
}

const TOP_HALF = [[1.0, 0], [0.72, 0.075], [0.66, 0.16], [0.52, 0.235], [0.38, 0.22], [0.22, 0.27],
  [0.0, 0.32], [-0.3, 0.29], [-0.52, 0.18], [-0.58, 0.1], [-1.02, 0.17], [-1.08, 0.08], [-1.08, 0]];
const WING_TOP = [[0.26, 0.1], [0.12, 0.26], [-0.12, 0.34], [-0.4, 0.3], [-0.66, 0.14], [-0.5, 0.08], [-0.1, 0.06], [0.18, 0.05]];

function draw(g) {
  const U = bird(0, 0, 1);
  const S = 200;
  const F = ([x, y]) => [300 + x * S, 510 + y * S];
  const T = ([x, z]) => [300 + x * S, 205 + z * S];
  const X = ([z, y]) => [740 + z * S, 510 + y * S];
  const D = ([x, y]) => [780 + (x - 0.72) * 400, 190 + (y + 0.4) * 400];
  const mm = (u) => String(Math.round(u * 100));

  g.fillStyle = BG;
  g.fillRect(0, 0, W, H);
  g.lineCap = 'butt';
  g.lineJoin = 'round';

  // Sheet frame with zones.
  layer(g, 'frame', 1.2);
  g.strokeRect(15, 15, 970, 970);
  layer(g, 'frame', 2.6);
  g.strokeRect(35, 35, 930, 930);
  layer(g, 'frame', 1.2);
  for (let k = 1; k < 4; k++) {
    const v = 35 + k * 232.5;
    seg(g, [v, 15], [v, 35]); seg(g, [v, 965], [v, 985]);
    seg(g, [15, v], [35, v]); seg(g, [965, v], [985, v]);
  }
  for (let k = 0; k < 4; k++) {
    const v = 35 + (k + 0.5) * 232.5;
    for (const y of [25, 975]) txt(g, String(k + 1), v, y, 11, 'frame', 'center');
    for (const x of [25, 975]) txt(g, 'ABCD'[k], x, v, 11, 'frame', 'center');
  }

  // Front view.
  const legs = U.legs.map(([a, b]) => [[a[0] - 0.014, a[1]], [b[0] - 0.014, b[1]], [b[0] + 0.014, b[1]], [a[0] + 0.014, a[1]]]);
  for (const leg of legs) solid(g, leg.map(F));
  layer(g, 'object');
  for (const [, b] of U.legs) {
    seg(g, F([b[0] - 0.07, b[1]]), F([b[0] + 0.09, b[1]]));
  }
  solid(g, U.tail.map(F));
  solid(g, U.body.map(F));
  layer(g, 'hidden');
  path(g, U.wing.map(([x, y]) => F([x + 0.06, y - 0.05])));
  g.stroke();
  solid(g, U.wing.map(F));
  solid(g, U.beak.map(F));
  layer(g, 'object');
  const eye = F(U.eye);
  g.beginPath();
  g.arc(eye[0], eye[1], 0.05 * S, 0, Math.PI * 2);
  g.stroke();
  layer(g, 'phantom');
  path(g, [[0.2, -0.08], [-0.2, -0.13], [-0.58, -0.22]].map(F), false);
  g.stroke();
  const headC = F([0.42, -0.42]);
  layer(g, 'construct');
  g.beginPath();
  g.arc(headC[0], headC[1], 0.3 * S, 0, Math.PI * 2);
  g.stroke();
  centreLines(g, eye, 0.05 * S);
  centreLines(g, headC, 0.3 * S);
  const bodyC = F([0, 0.04]);
  layer(g, 'center');
  seg(g, [bodyC[0] - 0.72 * S, bodyC[1]], [bodyC[0] + 0.72 * S, bodyC[1]]);

  // Cutting plane A-A, looking toward the head.
  const CUT = -0.2;
  const bodySpan = spanAt(U.body, CUT);
  const wingSpan = spanAt(U.wing, CUT);
  const cutX = F([CUT, 0])[0];
  const cutTop = F([0, bodySpan[0]])[1] - 32; const cutBot = F([0, bodySpan[1]])[1] + 32;
  layer(g, 'cut');
  seg(g, [cutX, cutTop], [cutX, cutBot]);
  g.setLineDash([]);
  g.lineWidth = 4;
  seg(g, [cutX, cutTop], [cutX, cutTop + 18]);
  seg(g, [cutX, cutBot - 18], [cutX, cutBot]);
  g.lineWidth = 1.6;
  for (const y of [cutTop, cutBot]) { seg(g, [cutX, y], [cutX + 30, y]); arrow(g, [cutX + 30, y], [cutX, y]); }
  txt(g, 'A', cutX + 14, cutTop - 16, 14, 'text', 'center');
  txt(g, 'A', cutX + 14, cutBot + 16, 14, 'text', 'center');

  // Detail callout B around beak and eye.
  const bc = F([0.72, -0.4]);
  layer(g, 'object', 1.2);
  g.beginPath();
  g.arc(bc[0], bc[1], 0.2875 * S, 0, Math.PI * 2);
  g.stroke();
  const bEdge = [bc[0] + Math.cos(0.7) * 0.2875 * S, bc[1] + Math.sin(0.7) * 0.2875 * S];
  layer(g, 'dim');
  seg(g, bEdge, [bEdge[0] + 26, bEdge[1] + 22]);
  txt(g, 'B', bEdge[0] + 38, bEdge[1] + 24, 14, 'text', 'center');

  // Front view dimensions.
  const tailTip = F([-1.08, -0.3]); const beakTip = F([1.0, -0.34]);
  let top = U.body[0]; for (const p of U.body) if (p[1] < top[1]) top = p;
  const foot = F([U.legs[0][1][0], U.legs[0][1][1]]);
  dimH(g, tailTip, beakTip, 700, mm(1.0 + 1.08));
  dimV(g, F(top), foot, 58, mm(U.legs[0][1][1] - top[1]));
  dimH(g, eye, beakTip, 338, mm(1.0 - U.eye[0]));
  const rimR = [headC[0] + Math.cos(-2.2) * 0.3 * S, headC[1] + Math.sin(-2.2) * 0.3 * S];
  leader(g, rimR, [rimR[0] - 24, rimR[1] - 26], 'R' + mm(0.3), { left: true });
  txt(g, 'FRONT VIEW', 300, 742, 14, 'text', 'center');
  txt(g, 'SCALE 1:1', 300, 762, 10, 'label', 'center');

  // Top view.
  const topOutline = chaikin([...TOP_HALF, ...TOP_HALF.slice(1, -1).reverse().map(([x, z]) => [x, -z])], 2, true);
  layer(g, 'center');
  seg(g, [60, 205], [540, 205]);
  solid(g, topOutline.map(T));
  const wingR = chaikin(WING_TOP, 2, true);
  const wingL = wingR.map(([x, z]) => [x, -z]);
  solid(g, wingR.map(T));
  solid(g, wingL.map(T));
  layer(g, 'phantom');
  for (const s of [1, -1]) { path(g, [[0.18, 0.12 * s], [-0.2, 0.2 * s], [-0.58, 0.12 * s]].map(T), false); g.stroke(); }
  layer(g, 'object');
  seg(g, T([0.72, -0.07]), T([0.72, 0.07]));
  for (const s of [1, -1]) {
    const e = T([0.52, 0.2 * s]);
    g.beginPath();
    g.arc(e[0], e[1], 0.04 * S, 0, Math.PI * 2);
    g.stroke();
  }
  layer(g, 'hidden');
  for (const [x, z] of [[0.02, -0.08], [0.2, 0.08]]) {
    const p = T([x, z]);
    g.beginPath();
    g.arc(p[0], p[1], 0.03 * S, 0, Math.PI * 2);
    g.stroke();
  }
  let span = 0; for (const [, z] of wingR) span = Math.max(span, z);
  let headW = 0; for (const [x, z] of topOutline) if (x > 0.4 && x < 0.62) headW = Math.max(headW, Math.abs(z));
  const wingX = wingR.reduce((a, p) => (p[1] > a[1] ? p : a))[0];
  dimV(g, T([wingX, -span]), T([wingX, span]), 58, mm(span * 2));
  dimV(g, T([0.52, -headW]), T([0.52, headW]), 562, mm(headW * 2));
  txt(g, 'TOP VIEW', 300, 300, 14, 'text', 'center');

  // Section A-A, as seen from the cut toward the head.
  const cy = (bodySpan[0] + bodySpan[1]) / 2; const ry = (bodySpan[1] - bodySpan[0]) / 2; const rz = 0.32;
  const section = ellipse(0, cy, rz, ry).map(X);
  layer(g, 'center');
  seg(g, [740, 372], [740, 668]);
  seg(g, [648, X([0, cy])[1]], [832, X([0, cy])[1]]);
  g.save();
  g.beginPath();
  g.rect(560, 300, 400, 420);
  sub(g, section);
  g.clip('evenodd');
  const headE = ellipse(0, -0.42, 0.24, 0.3).map(X);
  layer(g, 'object');
  path(g, headE);
  g.stroke();
  for (const s of [1, -1]) {
    const e = X([0.2 * s, -0.46]);
    g.beginPath();
    g.arc(e[0], e[1], 0.05 * S, 0, Math.PI * 2);
    g.stroke();
  }
  layer(g, 'hidden');
  path(g, ellipse(0, -0.345, 0.085, 0.095, 36).map(X));
  g.stroke();
  g.restore();
  for (const s of [1, -1]) {
    const inner = []; const outer = [];
    for (let i = 0; i <= 16; i++) {
      const y = wingSpan[0] + ((wingSpan[1] - wingSpan[0]) * i) / 16;
      const k = Math.max(0, 1 - ((y - cy) / ry) ** 2);
      const z = rz * Math.sqrt(k);
      const bulge = 0.055 * Math.sin((Math.PI * i) / 16);
      inner.push([s * z, y]);
      outer.push([s * (z + 0.012 + bulge), y]);
    }
    const shell = [...inner, ...outer.reverse()].map(X);
    solid(g, shell);
    hatch(g, shell, -Math.PI / 4, 6);
    layer(g, 'object');
    path(g, shell);
    g.stroke();
  }
  solid(g, section);
  hatch(g, section, Math.PI / 4, 9);
  layer(g, 'object');
  path(g, section);
  g.stroke();
  for (const s of [1, -1]) {
    const x = X([s * 0.08, 0])[0];
    solid(g, [[x - 3, X([0, bodySpan[1]])[1]], [x + 3, X([0, bodySpan[1]])[1]], [x + 3, foot[1]], [x - 3, foot[1]]]);
    layer(g, 'object');
    seg(g, [x - 9, foot[1]], [x + 9, foot[1]]);
  }
  dimH(g, X([-rz, cy]), X([rz, cy]), 690, mm(rz * 2));
  dimV(g, X([0, bodySpan[0]]), X([0, bodySpan[1]]), 870, mm(bodySpan[1] - bodySpan[0]));
  txt(g, 'SECTION A-A', 740, 742, 14, 'text', 'center');
  txt(g, 'SCALE 1:1', 740, 762, 10, 'label', 'center');

  // Detail B at 2:1.
  g.save();
  g.beginPath();
  g.arc(780, 190, 115, 0, Math.PI * 2);
  g.clip();
  solid(g, U.body.map(D));
  solid(g, U.wing.map(D));
  solid(g, U.beak.map(D));
  layer(g, 'object');
  const de = D(U.eye);
  g.beginPath();
  g.arc(de[0], de[1], 0.05 * 400, 0, Math.PI * 2);
  g.stroke();
  centreLines(g, de, 0.05 * 400);
  g.restore();
  layer(g, 'object', 1.2);
  g.beginPath();
  g.arc(780, 190, 115, 0, Math.PI * 2);
  g.stroke();
  const [bu, bt, bl] = U.beak;
  dimH(g, D(bu), D(bt), 128, mm(bt[0] - bu[0]));
  dimV(g, D(bu), D(bl), 742, mm(bl[1] - bu[1]));
  const tip = D(bt);
  const aUp = Math.atan2(D(bu)[1] - tip[1], D(bu)[0] - tip[0]);
  const aLo = Math.atan2(D(bl)[1] - tip[1], D(bl)[0] - tip[0]);
  const upper = aUp < 0 ? aUp + Math.PI * 2 : aUp;
  dimAngle(g, tip, 46, aLo, upper, String(Math.round(((upper - aLo) * 180) / Math.PI)), [tip[0] - 76, tip[1] + 2]);
  leader(g, [de[0] - 14, de[1] - 14], [650, 118], mm(0.1), { left: true, dia: true });
  txt(g, 'DETAIL B', 780, 322, 14, 'text', 'center');
  txt(g, 'SCALE 2:1', 780, 340, 10, 'label', 'center');

  // Notes.
  const notes = ['NOTES:', '1. ALL DIMENSIONS IN MM.', '2. DO NOT SCALE DRAWING.', '3. HIDDEN EDGES SHOWN DASHED.',
    '4. FOLD LINES SHOWN AS PHANTOM LINES.', '5. THIRD ANGLE PROJECTION.', '6. GENERATED BY ARTIFEX, SEED 2026.'];
  notes.forEach((n, i) => txt(g, n, 60, 800 + i * 22, 11));

  // Title block.
  layer(g, 'frame', 2.2);
  g.strokeRect(540, 790, 425, 175);
  layer(g, 'frame', 1.2);
  for (const y of [835, 880, 922]) seg(g, [540, y], [965, y]);
  seg(g, [880, 790], [880, 835]);
  for (const x of [700, 800]) seg(g, [x, 880], [x, 965]);
  seg(g, [620, 922], [620, 965]);
  txt(g, 'ARTIFEX', 556, 812, 22);
  const cell = (x, y, label, value, size = 12) => { txt(g, label, x + 6, y + 9, 7, 'label'); txt(g, value, x + 6, y + 27, size); };
  cell(880, 790, 'MASS', '4 G');
  cell(540, 835, 'TITLE', 'BIRD - GENERAL ARRANGEMENT', 13);
  cell(540, 880, 'DWG NO.', 'ART-2026-001');
  cell(700, 880, 'REV', 'A');
  cell(800, 880, 'SHEET', '1 OF 1');
  cell(540, 922, 'SCALE', '1:1');
  cell(620, 922, 'UNITS', 'MM');
  cell(700, 922, 'SEED', '2026');
  cell(800, 922, 'MATERIAL', 'PAPER 120 GSM', 11);
}

module.exports = { name: 'cad', size: { w: 1000, h: 1000 }, seed: 2026, draw };
