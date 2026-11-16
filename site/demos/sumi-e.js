// The showcase site's demo of Sumi-e: the songbird staged in one scene, drawn
// with the marks of skills/artifex/styles/sumi-e.js. Site-only, never a
// starting point for a piece. The bird sits on a flowering plum branch under
// a moon reserved as bare paper in a pale night wash.

'use strict';

const { rng } = require('../../core/rand.js');
const font = require('../../core/stroke-font.js');
const { bird } = require('./subject.js');
const { caption } = require('../../skills/artifex/styles/kit.js');
const { PAPER, ink, PRESS, brush, dot, paper, wash, reserve } = require('../../skills/artifex/styles/sumi-e.js');

const W = 1000; const H = 1000;

// A plum blossom in outline: five round petals in a fine line over a pale
// wash, a dark calyx and stamens that end in dots.
function blossom(g, R, name, x, y, r, turn) {
  g.save();
  const petals = [];
  for (let k = 0; k < 5; k++) {
    const a = turn + (k / 5) * Math.PI * 2;
    petals.push([x + Math.cos(a) * r * 0.58, y + Math.sin(a) * r * 0.58, a]);
  }
  g.fillStyle = ink(0.045);
  for (const [px, py] of petals) {
    g.beginPath();
    g.arc(px, py, r * 0.52, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = PAPER;
  g.globalAlpha = 0.55;
  g.beginPath();
  g.arc(x, y, r * 0.5, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;
  g.strokeStyle = ink(0.7);
  g.lineCap = 'round';
  for (const [k, [px, py, a]] of petals.entries()) {
    // Each petal is the outer part of a circle, broken where it meets the next.
    const from = a - 1.35 + (R(name, 'a', k) - 0.5) * 0.3;
    g.lineWidth = 1.3 + R(name, 'w', k);
    g.beginPath();
    g.arc(px, py, r * 0.52, from, from + 2.7 + R(name, 'b', k) * 0.3);
    g.stroke();
  }
  for (let k = 0; k < 7; k++) {
    const a = turn + k * 0.9 + R(name, 'sa', k) * 0.3;
    const l = r * (0.32 + 0.25 * R(name, 's', k));
    g.strokeStyle = ink(0.55);
    g.lineWidth = 0.9;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
    dot(g, x + Math.cos(a) * l, y + Math.sin(a) * l, 1.7, 0.9);
  }
  g.restore();
}

function draw(g, s) {
  const R = rng(s.seed);

  paper(g, R, 'fibre', W, H);

  // A pale night wash with the moon left as bare paper.
  const moon = [262, 250, 92];
  reserve(g, W, H, moon, () => wash(g, R, 'haze', moon[0] + 30, moon[1]));

  // The plum: an old limb in one dry, heavy stroke, angular young twigs in
  // quick dark ones, knots where they leave the wood.
  const limb = [[10, 1000], [110, 900], [230, 820], [330, 742], [470, 688], [610, 650], [720, 624]];
  brush(g, R, 'limb', limb, { w: 62, tone: 0.95, dry: 0.4, grade: 0.65, press: PRESS.press, bristles: 56 });
  brush(g, R, 'limbhi', [[60, 960], [200, 850], [330, 760]], { w: 26, tone: 0.95, dry: 0.45, grade: 0.1, press: PRESS.blunt, bristles: 20 });
  const twigs = [
    [[700, 628], [800, 596], [880, 560], [990, 548]],
    [[330, 748], [318, 660], [270, 590], [262, 500]],
    [[800, 598], [826, 520], [818, 456]],
    [[880, 562], [912, 500], [958, 470]],
    [[270, 596], [216, 560], [180, 548]],
    [[470, 690], [520, 740], [590, 768]],
  ];
  twigs.forEach((t, i) => brush(g, R, 'twig' + i, t, { w: i === 0 ? 22 : 12, tone: 0.95, dry: 0.25, grade: 0.15, press: PRESS.taper, bristles: 16 }));
  for (const [x, y, r] of [[330, 748, 7], [470, 690, 6], [800, 598, 5], [880, 562, 5], [270, 596, 5], [150, 870, 8]]) dot(g, x, y - r * 0.8, r, 1);
  const flowers = [[262, 490, 30], [176, 540, 22], [818, 446, 28], [962, 462, 22], [896, 548, 18], [596, 770, 24], [304, 646, 20], [736, 586, 22]];
  flowers.forEach(([x, y, r], i) => blossom(g, R, 'fl' + i, x, y, r, R('fl', 'turn', i) * 6.3));
  for (const [x, y, r] of [[286, 560, 6], [830, 500, 5], [938, 492, 5], [210, 552, 4], [548, 750, 5], [990, 530, 4]]) dot(g, x, y, r, 0.9);

  // The subject in few strokes: a grey mass for the back, a black cap,
  // dry-brush wings and tail over them, and the belly left as paper with
  // one fine line.
  const b = bird(560, 452, 236, -0.08);
  const at = (pts) => b.at(pts);
  brush(g, R, 'back', at([[0.46, -0.5], [0.16, -0.4], [-0.16, -0.26], [-0.46, -0.08], [-0.6, 0.04]]), { w: 104, tone: 0.5, dry: 0.3, grade: 0.55, bleed: 3, press: PRESS.swell, bristles: 48 });
  brush(g, R, 'belly', at([[0.72, -0.2], [0.6, 0.1], [0.36, 0.36], [0.04, 0.46]]), { w: 15, tone: 0.8, dry: 0.35, grade: 0.3, press: PRESS.sweep, bristles: 12 });
  brush(g, R, 'belly2', at([[-0.08, 0.46], [-0.36, 0.34], [-0.56, 0.14]]), { w: 10, tone: 0.6, dry: 0.5, grade: 0.3, press: PRESS.sweep, bristles: 10 });
  brush(g, R, 'head', at([[0.7, -0.36], [0.62, -0.56], [0.44, -0.64], [0.24, -0.56], [0.14, -0.44]]), { w: 76, tone: 0.97, dry: 0.2, grade: 0.25, press: PRESS.press, bristles: 44 });
  for (let k = 0; k < 4; k++) {
    brush(g, R, 'wing' + k, at([[0.24 - k * 0.04, -0.22 + k * 0.045], [-0.08 - k * 0.02, -0.2 + k * 0.05], [-0.5 + k * 0.1, -0.2 + k * 0.07]]),
      { w: 40 - k * 5, tone: 0.9 - k * 0.08, dry: 0.55 + k * 0.08, grade: 0.4, press: PRESS.sweep, bristles: 30 });
  }
  for (const [k, tip] of [[-1.02, -0.4], [-1.08, -0.24]].entries()) {
    brush(g, R, 'tail' + k, at([[-0.48, -0.06 + k * 0.05], [-0.74, -0.18 + k * 0.06], tip]), { w: 32, tone: 0.92, dry: 0.5, grade: 0.35, press: PRESS.sweep, bristles: 26 });
  }
  brush(g, R, 'beak1', at([[0.7, -0.44], [0.86, -0.4], [1.0, -0.35]]), { w: 11, tone: 1, dry: 0.1, press: PRESS.flick, bristles: 8 });
  brush(g, R, 'beak2', at([[0.72, -0.28], [0.86, -0.31], [0.96, -0.33]]), { w: 8, tone: 1, dry: 0.1, press: PRESS.flick, bristles: 8 });
  // The eye: paper kept round a dark pupil inside the black cap.
  g.fillStyle = PAPER;
  g.beginPath();
  g.arc(b.eye[0], b.eye[1], 11, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = ink(0.5);
  g.lineWidth = 1.2;
  g.stroke();
  dot(g, b.eye[0] + 1.5, b.eye[1] + 1, 6, 1);
  for (const [i, leg] of b.legs.entries()) {
    const foot = [leg[1][0] + 4, 650 - i * 4];
    brush(g, R, 'leg' + i, [leg[0], foot], { w: 10, tone: 0.95, dry: 0.2, press: PRESS.flick, bristles: 8 });
    brush(g, R, 'toe' + i, [[foot[0] - 2, foot[1] - 3], [foot[0] + 16, foot[1] - 1], [foot[0] + 24, foot[1] + 6]], { w: 7, tone: 0.95, dry: 0.2, press: PRESS.flick, bristles: 6 });
    brush(g, R, 'heel' + i, [[foot[0] + 2, foot[1] - 3], [foot[0] - 8, foot[1]], [foot[0] - 11, foot[1] + 5]], { w: 5, tone: 0.9, dry: 0.25, press: PRESS.flick, bristles: 6 });
  }

  caption(g, 'SUMI-E', font, ink(0.7), 880, 950);
}

module.exports = { name: 'sumi-e', size: { w: 1000, h: 1000 }, seed: 2026, draw };
