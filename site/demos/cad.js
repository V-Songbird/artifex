// The showcase site's demo of CAD: the songbird staged in one scene, drawn
// with the marks of skills/artifex/styles/cad.js. Site-only, never a starting
// point for a piece.
//
// One sheet in model space: third-angle top and front views, a hatched
// section A-A, a 2:1 detail B, linear, angular, radius and diameter
// dimensions, centre, hidden and phantom lines, notes, zones and a title block.

'use strict';

const { chaikin } = require('../../core/geom.js');
const { rng } = require('../../core/rand.js');
const { bird } = require('./subject.js');
const { path, ellipse } = require('../../skills/artifex/styles/kit.js');
const {
  GROUNDS, layer, seg, txt, dimH, dimV, dimAngle, leader, centreLines, spanAt, solid: solidOn,
  sectionFill, beyond, cuttingPlane, detailCallout, detailView, viewLabel, notes, sheetFrame, titleBlock, titleCell,
} = require('../../skills/artifex/styles/cad.js');

const W = 1000; const H = 1000;

const TOP_HALF = [[1.0, 0], [0.72, 0.075], [0.66, 0.16], [0.52, 0.235], [0.38, 0.22], [0.22, 0.27],
  [0.0, 0.32], [-0.3, 0.29], [-0.52, 0.18], [-0.58, 0.1], [-1.02, 0.17], [-1.08, 0.08], [-1.08, 0]];
const WING_TOP = [[0.26, 0.1], [0.12, 0.26], [-0.12, 0.34], [-0.4, 0.3], [-0.66, 0.14], [-0.5, 0.08], [-0.1, 0.06], [0.18, 0.05]];

// What the seed picks: the model-space background, how far the wings spread
// in plan, the section's hatch pattern and where section A-A cuts. The bird
// itself stands as drawn, so the front view, the top view and the section
// line up by construction. The seed takes the grounds in turn, so any four
// consecutive seeds show all four; seed 1 and the default seed 2026 keep the
// dark green and the grey they had.
function draw(g, s) {
  const R = rng(s.seed);
  const hatch = (s.params && s.params.hatch) ?? 9;
  const BG = GROUNDS[(s.seed + 1) % GROUNDS.length];
  const solid = (pts) => solidOn(g, pts, BG);
  // From folded (1.0) to wide (1.4): from 1.0 up, the wing reaches past the
  // top outline wherever A-A may cut, so the section's shells can bulge out
  // to its edge; at 1.4 the top view's label and wingspan still clear it.
  const spread = 1.0 + R('pose', 'spread') * 0.4;
  // The section's hatch: ANSI 31 lines, or the ANSI 37 crosshatch.
  const cross = R('look', 'hatch') < 0.5;
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

  sheetFrame(g, 15, 15, 970, 970);

  // Front view.
  const legs = U.legs.map(([a, b]) => [[a[0] - 0.014, a[1]], [b[0] - 0.014, b[1]], [b[0] + 0.014, b[1]], [a[0] + 0.014, a[1]]]);
  for (const leg of legs) solid(leg.map(F));
  layer(g, 'object');
  for (const [, b] of U.legs) {
    seg(g, F([b[0] - 0.07, b[1]]), F([b[0] + 0.09, b[1]]));
  }
  solid(U.tail.map(F));
  solid(U.body.map(F));
  layer(g, 'hidden');
  path(g, U.wing.map(([x, y]) => F([x + 0.06, y - 0.05])));
  g.stroke();
  solid(U.wing.map(F));
  solid(U.beak.map(F));
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
  layer(g, 'center');
  seg(g, F([-0.72, 0.04]), F([0.72, 0.04]));

  // Cutting plane A-A, looking toward the head. Over this range the wing lies
  // within the body's depth, so the section keeps its shells on the body's
  // flanks, and the arrows and the lower label end left of the left leg and
  // its foot line, which starts at x 282.
  const CUT = -0.24 + R('pose', 'cut') * 0.04;
  const bodySpan = spanAt(U.body, CUT);
  const wingSpan = spanAt(U.wing, CUT);
  const cutX = F([CUT, 0])[0];
  const cutTop = F([0, bodySpan[0]])[1] - 32; const cutBot = F([0, bodySpan[1]])[1] + 32;
  cuttingPlane(g, cutX, cutTop, cutBot, 'A');

  // Detail callout B around beak and eye.
  detailCallout(g, F([0.72, -0.4]), 0.2875 * S, 'B');

  // Front view dimensions.
  const tailTip = F([-1.08, -0.3]); const beakTip = F([1.0, -0.34]);
  let top = U.body[0]; for (const p of U.body) if (p[1] < top[1]) top = p;
  const foot = F([U.legs[0][1][0], U.legs[0][1][1]]);
  dimH(g, tailTip, beakTip, 700, mm(1.0 + 1.08));
  dimV(g, F(top), foot, 58, mm(U.legs[0][1][1] - top[1]));
  dimH(g, eye, beakTip, 338, mm(1.0 - U.eye[0]));
  const rimR = [headC[0] + Math.cos(-2.2) * 0.3 * S, headC[1] + Math.sin(-2.2) * 0.3 * S];
  leader(g, rimR, [rimR[0] - 24, rimR[1] - 26], 'R' + mm(0.3), { left: true });
  viewLabel(g, 'FRONT VIEW', 'SCALE 1:1', 300, 742);

  // Top view. The beak stays sharp, so its tip lines up with the front view's.
  const topOutline = [TOP_HALF[0], ...chaikin([...TOP_HALF.slice(1), ...TOP_HALF.slice(1, -1).reverse().map(([x, z]) => [x, -z])], 2)];
  layer(g, 'center');
  seg(g, [60, 205], [540, 205]);
  solid(topOutline.map(T));
  const wingR = chaikin(WING_TOP.map(([x, z]) => [x, z * spread]), 2, true);
  const wingL = wingR.map(([x, z]) => [x, -z]);
  solid(wingR.map(T));
  solid(wingL.map(T));
  layer(g, 'phantom');
  for (const s of [1, -1]) { path(g, [[0.18, 0.12 * s], [-0.2, 0.2 * s], [-0.58, 0.12 * s]].map(([x, z]) => T([x, z * spread])), false); g.stroke(); }
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
  viewLabel(g, 'TOP VIEW', null, 300, Math.max(300, T([0, span])[1] + 14));

  // Section A-A, as seen from the cut toward the head. Its width is the top
  // view's at the cut: the body's half width, and the wings' outer edge.
  const cy = (bodySpan[0] + bodySpan[1]) / 2; const ry = (bodySpan[1] - bodySpan[0]) / 2;
  const rz = spanAt(topOutline, CUT)[1]; const wingOut = spanAt(wingR, CUT)[1];
  const section = ellipse(0, cy, rz, ry, 72).map(X);
  layer(g, 'center');
  seg(g, [740, 372], [740, 668]);
  seg(g, [X([-wingOut, cy])[0] - 12, X([0, cy])[1]], [X([wingOut, cy])[0] + 12, X([0, cy])[1]]);
  beyond(g, [560, 300, 400, 420], section, () => {
    const headE = ellipse(0, -0.42, 0.24, 0.3, 72).map(X);
    layer(g, 'object');
    path(g, headE);
    g.stroke();
    for (const s of [1, -1]) {
      const e = X([0.2 * s, U.eye[1]]);
      g.beginPath();
      g.arc(e[0], e[1], 0.05 * S, 0, Math.PI * 2);
      g.stroke();
    }
    layer(g, 'hidden');
    path(g, ellipse(0, -0.345, 0.085, 0.095, 36).map(X));
    g.stroke();
  });
  // The wing's shell lies on the body's flank over the wing's height at the cut,
  // and bulges just enough that its widest point is the wing's outer edge.
  const shellTop = Math.max(wingSpan[0], bodySpan[0]); const shellBot = Math.min(wingSpan[1], bodySpan[1]);
  const shellY = []; const shellZ = []; const arch = [];
  for (let i = 0; i <= 16; i++) {
    shellY.push(shellTop + ((shellBot - shellTop) * i) / 16);
    shellZ.push(rz * Math.sqrt(Math.max(0, 1 - ((shellY[i] - cy) / ry) ** 2)));
    arch.push(Math.sin((Math.PI * i) / 16));
  }
  let bulge = Infinity; for (let i = 1; i < 16; i++) bulge = Math.min(bulge, (wingOut - shellZ[i] - 0.012) / arch[i]);
  bulge = Math.max(0, bulge);
  for (const s of [1, -1]) {
    const inner = []; const outer = [];
    for (let i = 0; i <= 16; i++) {
      inner.push([s * shellZ[i], shellY[i]]);
      outer.push([s * (shellZ[i] + 0.012 + bulge * arch[i]), shellY[i]]);
    }
    const shell = [...inner, ...outer.reverse()].map(X);
    sectionFill(g, shell, BG, -Math.PI / 4, 6);
  }
  sectionFill(g, section, BG, Math.PI / 4, hatch, cross);
  for (const s of [1, -1]) {
    const x = X([s * 0.08, 0])[0];
    solid([[x - 3, X([0, bodySpan[1]])[1]], [x + 3, X([0, bodySpan[1]])[1]], [x + 3, foot[1]], [x - 3, foot[1]]]);
    layer(g, 'object');
    seg(g, [x - 9, foot[1]], [x + 9, foot[1]]);
  }
  dimH(g, X([-rz, cy]), X([rz, cy]), 690, mm(rz * 2));
  dimV(g, X([0, bodySpan[0]]), X([0, bodySpan[1]]), 870, mm(bodySpan[1] - bodySpan[0]));
  viewLabel(g, 'SECTION A-A', 'SCALE 1:1', 740, 742);

  // Detail B at 2:1.
  const de = D(U.eye);
  detailView(g, [780, 190], 115, () => {
    solid(U.body.map(D));
    solid(U.wing.map(D));
    solid(U.beak.map(D));
    layer(g, 'object');
    g.beginPath();
    g.arc(de[0], de[1], 0.05 * 400, 0, Math.PI * 2);
    g.stroke();
    centreLines(g, de, 0.05 * 400);
  });
  const [bu, bt, bl] = U.beak;
  dimH(g, D(bu), D(bt), 128, mm(bt[0] - bu[0]));
  dimV(g, D(bu), D(bl), 742, mm(bl[1] - bu[1]));
  const tip = D(bt);
  const aUp = Math.atan2(D(bu)[1] - tip[1], D(bu)[0] - tip[0]);
  const aLo = Math.atan2(D(bl)[1] - tip[1], D(bl)[0] - tip[0]);
  const upper = aUp < 0 ? aUp + Math.PI * 2 : aUp;
  dimAngle(g, tip, 46, aLo, upper, String(Math.round(((upper - aLo) * 180) / Math.PI)), [tip[0] - 76, tip[1] + 2]);
  leader(g, [de[0] - 14, de[1] - 14], [650, 118], mm(0.1), { left: true, dia: true });
  viewLabel(g, 'DETAIL B', 'SCALE 2:1', 780, 322, 18);

  // Notes; the sheet states the seed it was drawn at.
  const seed = String(s.seed);
  notes(g, ['NOTES:', '1. ALL DIMENSIONS IN MM.', '2. DO NOT SCALE DRAWING.', '3. HIDDEN EDGES SHOWN DASHED.',
    '4. FOLD LINES SHOWN AS PHANTOM LINES.', '5. THIRD ANGLE PROJECTION.', `6. GENERATED BY ARTIFEX, SEED ${seed}.`], 60, 800);

  // Title block. A value shrinks to fit its cell, so a ten-digit seed stays inside the lines.
  titleBlock(g, 540, 790, 425, 175, [835, 880, 922], [[880, 790, 835], [700, 880, 965], [800, 880, 965], [620, 922, 965]]);
  txt(g, 'ARTIFEX', 556, 812, 22);
  titleCell(g, 880, 790, 'MASS', '4 G');
  titleCell(g, 540, 835, 'TITLE', 'BIRD - GENERAL ARRANGEMENT', 13);
  titleCell(g, 540, 880, 'DWG NO.', `ART-${seed}-001`, 12, 160);
  titleCell(g, 700, 880, 'REV', 'A');
  titleCell(g, 800, 880, 'SHEET', '1 OF 1');
  titleCell(g, 540, 922, 'SCALE', '1:1');
  titleCell(g, 620, 922, 'UNITS', 'MM');
  titleCell(g, 700, 922, 'SEED', seed, 12, 100);
  titleCell(g, 800, 922, 'MATERIAL', 'PAPER 120 GSM', 11);
}

module.exports = {
  name: 'cad', size: { w: 1000, h: 1000 }, seed: 2026,
  params: { hatch: { min: 4, max: 20, value: 9, meaning: 'Spacing of section A-A\'s hatch lines: low packs the cut face dense and dark, high spreads a few wide lines' } },
  draw,
};
