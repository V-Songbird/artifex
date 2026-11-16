// The showcase site's demo of Circuit board: the songbird staged in one
// scene, drawn with the marks of skills/artifex/styles/circuit-board.js.
// Site-only, never a starting point for a piece.
//
// One board seen flat from above: the bird laid out as copper art in its
// middle, wired into the parts round it.

'use strict';

const { rng } = require('../../core/rand.js');
const { closestPointOnSegment, pointInPoly } = require('../../core/geom.js');
const font = require('../../core/stroke-font.js');
const { bird } = require('./subject.js');
const { path, caption } = require('../../skills/artifex/styles/kit.js');
const {
  PALETTE: C, route, octagonal, trace, exposed, goldLine, padRect, padRound, via, silk, label, plus, bus, qfp,
  chipPart, led, inductor, crystal, electrolytic, header, mountingHole, fiducial, platedHole, board, pour, stitch,
  copperHatch, clearRing, etch, weave, current, sheen,
} = require('../../skills/artifex/styles/circuit-board.js');

function draw(g, s) {
  const R = rng(s.seed);
  const W = 1000; const H = 1000;
  const B = [26, 26, 948, 948];

  g.fillStyle = C.bench;
  g.fillRect(0, 0, W, H);
  board(g, B, { sheet: [0, 0, W, H] });

  // The subject as copper art in 45-degree runs.
  const b = bird(420, 372, 262, -0.03);
  const body = octagonal(b.body, 7);
  const wing = octagonal(b.wing, 6);
  const snap = (v) => Math.round(v / 10) * 10;
  // The beak: a wedge whose two faces run at 45 degrees to its tip.
  const [top, , low] = b.beak;
  const mid = (top[1] + low[1]) / 2; const half = (low[1] - top[1]) / 2;
  const beak = [[top[0] - 14, mid - half], [top[0] + half, mid - half], [top[0] + 2 * half, mid], [top[0] + half, mid + half], [top[0] - 14, mid + half]];
  const tailRoot = b.at([[-0.5, -0.03]])[0].map(snap);
  const tail = [[-1.02, -0.42], [-1.09, -0.28], [-1.04, -0.13]].map((tip, k) => route([
    [tailRoot[0], tailRoot[1] + (k - 1) * 20], b.at([tip])[0].map(snap),
  ], true));
  const railY = 600;
  const feet = b.legs.map(([top]) => snap(top[0]));
  const legs = feet.map((x) => [[x, b.body.reduce((m, p) => (Math.abs(p[0] - x) < 20 ? Math.max(m, p[1]) : m), 0) - 16], [x, railY]]);

  // Traces: centre routes with a width.
  const U = [700, 790];
  const L = [600, railY];
  const traces = [];
  const add = (pts, w = 7) => { traces.push({ pts, w }); return pts; };
  add([[96, railY], [L[0] - 30, railY]], 20);
  add(route([[L[0] + 30, railY], [L[0] + 70, railY + 40], [L[0] + 70, U[1] - 84]]), 14);
  for (const leg of legs) add(leg, 9);
  for (const t of tail) add(t, 8);
  const west = bus(route([[U[0] - 84, U[1] - 20], [480, U[1] - 20], [400, 860], [200, 860]], true), 5, 17);
  west.forEach((t) => add(t));
  const north = bus(route([[U[0] + 40, U[1] - 84], [U[0] + 40, 680], [908, 472], [908, 200], [848, 140], [730, 140]]), 4, 22);
  north.forEach((t) => add(t));
  const east = [
    add(route([[U[0] + 84, U[1] + 30], [860, U[1] + 30], [880, 840], [880, 870]])),
    add(route([[U[0] + 84, U[1] + 50], [840, U[1] + 50], [840, 900]])),
  ];
  const south = add(route([[U[0] - 30, U[1] + 84], [U[0] - 30, 912], [560, 912]]));
  for (let k = 0; k < 3; k++) {
    add([[300 + k * 40, 686], [300 + k * 40, 660]], 6);
    add([[300 + k * 40, 714], [300 + k * 40, 740]], 6);
  }
  const crystalPads = [[792, 330], [808, 330]];
  add(route([[crystalPads[0][0] - 20, 330], [760, 330], [760, 386]]));
  add(route([[crystalPads[1][0] + 72, 330], [868, 330], [868, 386]]));

  // Parts that the pour keeps clear of: [x, y, half width, half height].
  const Y = [830, 330]; const CAP = [792, 474, 48];
  const boxes = [[U[0], U[1], 112, 112], [L[0], L[1], 40, 40], [Y[0], Y[1], 62, 30], [CAP[0], CAP[1], 60, 60],
    [160, 843, 40, 56], [96, railY, 34, 26], [710, 140, 30, 50], [340, 700, 50, 44]];

  // Ground pour everywhere but a clearance round every trace, part and the art.
  pour(g, [[B[0] + 26, B[1] + 26], [B[0] + B[2] - 26, B[1] + 26], [B[0] + B[2] - 26, B[1] + B[3] - 26], [B[0] + 26, B[1] + B[3] - 26]],
    { traces, shapes: [body, wing, beak], boxes });

  // Stitching vias wherever the open pour has room.
  const segs = [];
  for (const t of traces) for (let i = 1; i < t.pts.length; i++) segs.push([t.pts[i - 1], t.pts[i], t.w / 2 + 11 + 12]);
  const room = (p) => {
    if (p[0] < 90 || p[0] > 910 || p[1] < 90 || p[1] > 910) return false;
    for (const [a, c, r] of segs) if (closestPointOnSegment(p, a, c).distance < r) return false;
    for (const [x, y, w, h] of boxes) if (Math.abs(p[0] - x) < w + 26 && Math.abs(p[1] - y) < h + 26) return false;
    if (pointInPoly(p, body)) return false;
    for (const q of [...body, ...wing]) if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 48) return false;
    for (const [x, y] of [[70, 70], [930, 70], [930, 930], [70, 930]]) if (Math.hypot(p[0] - x, p[1] - y) < 60) return false;
    return true;
  };
  stitch(g, R, 'via', [70, 70, 940, 940], room);

  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const t of traces) trace(g, t.pts, t.w);

  // The subject's body: a hatched pour inside a gold rim.
  copperHatch(g, body, b.eye);
  const [bx0, by0] = b.at([[0.3, -0.7]])[0]; const [bx1, by1] = b.at([[-0.3, 0.5]])[0];
  goldLine(g, body, 11, [bx0, by0, bx1, by1]);
  clearRing(g, wing, 14);
  // Wing: exposed gold with etched feather slots.
  const [wx0, wy0] = b.at([[0.25, -0.3]])[0]; const [wx1, wy1] = b.at([[-0.6, 0.1]])[0];
  exposed(g, () => path(g, wing), [wx0, wy0, wx1, wy1]);
  const slots = [];
  for (let k = 0; k < 3; k++) {
    const a = b.at([[0.1 - k * 0.12, -0.1 + k * 0.07]])[0].map(snap);
    slots.push(route([a, [a[0] - 110 + k * 16, a[1] - 22 + k * 4]], false));
  }
  etch(g, wing, slots);
  exposed(g, () => path(g, beak), [beak[0][0], beak[0][1], beak[2][0], beak[3][1]]);
  // Eye: a plated hole with its own clearance.
  platedHole(g, b.eye[0], b.eye[1], 16, 7.5, 24);
  for (const t of tail) padRound(g, t[t.length - 1][0], t[t.length - 1][1], 11, 4.5);
  for (const x of feet) {
    padRect(g, x - 11, railY, 18, 28);
    padRect(g, x + 11, railY, 18, 28);
  }

  weave(g, 30, 980, 7, [30, 970]);

  // Parts.
  const leads = qfp(g, U[0], U[1], 140, 8, 15);
  for (const l of leads) {
    if (l.side !== 3 || l.i % 3 !== 1) continue;
    via(g, l.x, l.y - 26, 5);
  }
  // Power in: two big lands and a shrouded inductor.
  padRect(g, 80, railY, 34, 44);
  label(g, 'VIN', 64, railY - 52, 11);
  inductor(g, L[0], L[1]);
  // The header west of the pour.
  const pins = west.map((t) => t[t.length - 1]);
  const [hx, hy0, hy1] = [pins[0][0] - 42, pins[pins.length - 1][1] - 17, pins[0][1] + 17];
  header(g, hx, hy0, hy1, pins.map(([, y]) => y));
  for (const p of pins) padRound(g, p[0], p[1], 9);
  // Lamp row fed by the north bus.
  const lamps = north.map((t) => t[t.length - 1]);
  const lens = ['#9dffb0', '#ffd35a', '#ff6a5a', '#8ab8ff'];
  lamps.forEach(([x, y], k) => led(g, x - 24, y, lens[k], k === 1 || k === 2 ? lens[k] + 'b0' : null));
  // Crystal and electrolytic.
  crystal(g, Y[0], Y[1]);
  for (const x of [760, 868]) via(g, x, 386, 6);
  electrolytic(g, CAP[0], CAP[1], CAP[2]);
  // Passives round the chip, test points, mounting holes, fiducials.
  for (let k = 0; k < 3; k++) chipPart(g, U[0] + 110, U[1] - 40 + k * 34, 28, 15, k === 1 ? '#1d1d1f' : '#b58e59');
  for (let k = 0; k < 3; k++) {
    chipPart(g, 300 + k * 40, 700, 28, 15, k === 1 ? '#1d1d1f' : '#b58e59', true);
    via(g, 300 + k * 40, 660, 5);
    via(g, 300 + k * 40, 740, 5);
  }
  for (const t of [...east, south]) padRound(g, t[t.length - 1][0], t[t.length - 1][1], 11);
  for (const [x, y] of [[70, 70], [930, 70], [930, 930], [70, 930]]) mountingHole(g, x, y);
  for (const [x, y] of [[190, 120], [470, 930]]) fiducial(g, x, y);

  // Silkscreen legend.
  g.save();
  silk(g, 2);
  g.strokeRect(U[0] - 90, U[1] - 90, 180, 180);
  g.beginPath();
  g.arc(U[0] - 98, U[1] - 98, 3.5, 0, Math.PI * 2);
  g.fill();
  g.strokeRect(hx - 26, hy0 - 8, 52, hy1 - hy0 + 16);
  g.strokeRect(L[0] - 48, L[1] - 48, 96, 96);
  g.beginPath();
  g.arc(CAP[0], CAP[1], CAP[2] + 8, 0, Math.PI * 2);
  g.stroke();
  g.strokeRect(Y[0] - 60, Y[1] - 28, 120, 56);
  g.beginPath();
  for (const [x, y] of lamps) { g.moveTo(x - 42, y - 9); g.lineTo(x - 42, y + 9); }
  g.stroke();
  g.restore();
  label(g, 'U1', U[0] - 90, U[1] - 114);
  label(g, 'J1', hx - 26, hy0 - 30);
  label(g, 'L1', L[0] - 48, L[1] - 72);
  label(g, 'C1', CAP[0] - 70, CAP[1] - 66);
  plus(g, CAP[0] + 51, CAP[1] - 54);
  label(g, 'Y1', Y[0] - 60, Y[1] - 52);
  lamps.forEach(([x, y], k) => label(g, 'D' + (k + 1), x - 76, y - 5, 10));
  label(g, 'R1', U[0] + 130, U[1] - 48, 9);
  label(g, 'C2', 254, 694, 9);
  label(g, 'TP1', 862, 896, 9);
  label(g, 'TP2', 822, 926, 9);
  caption(g, 'CIRCUIT BOARD', font, C.silk, 118, 948, 14);

  // Current on its way along a few traces.
  const flows = [...north, west[1], west[3], traces[0].pts];
  current(g, flows, flows.map((t, k) => 0.2 + 0.6 * R('pulse', 'at', k)));

  sheen(g, 0, 0, W, H);
  g.restore();
}

module.exports = { name: 'circuit-board', size: { w: 1000, h: 1000 }, seed: 2026, draw };
