// The showcase site's demo of Embroidery: the songbird staged in one scene,
// drawn with the marks of skills/artifex/styles/embroidery.js. Site-only,
// never a starting point for a piece. The bird stands on a stitched branch
// with leaves and berries, singing notes and arcs, with a heart and sparkles.

'use strict';

const { rng } = require('../../core/rand.js');
const { chaikin } = require('../../core/geom.js');
const font = require('../../core/stroke-font.js');
const { bird } = require('./subject.js');
const { path, wobble, ellipse, caption } = require('../../skills/artifex/styles/kit.js');
const { THREADS: C, cloth, strand, satin, knot, sparkle } = require('../../skills/artifex/styles/embroidery.js');

const W = 1000; const H = 1000;

function leaf(cx, cy, len, wide, angle) {
  const pts = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16; const x = (t - 0.5) * len; const y = Math.sin(t * Math.PI) * wide;
    pts.push([x, y]);
  }
  for (let i = 15; i > 0; i--) pts.push([pts[i][0], -pts[i][1]]);
  const c = Math.cos(angle); const s = Math.sin(angle);
  return pts.map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
}

function note(g, R, name, x, y, size, ink, tilt) {
  const head = ellipse(x, y, size * 0.34, size * 0.24, 24, -0.45);
  g.save();
  g.fillStyle = ink[0];
  path(g, head);
  g.fill();
  g.restore();
  strand(g, wobble(head, R, name + 'h', 1.2, 8, true), ink, 7, true);
  const top = [x + size * 0.3 + tilt, y - size * 1.25];
  strand(g, wobble([[x + size * 0.3, y - size * 0.08], top], R, name + 's', 1.5, 10), ink, 7);
  strand(g, wobble(chaikin([top, [top[0] + size * 0.45, top[1] + size * 0.3], [top[0] + size * 0.3, top[1] + size * 0.75]], 2), R, name + 'f', 1.5, 10), ink, 7);
}

function draw(g, s) {
  const R = rng(s.seed);

  cloth(g, R, W, H);
  g.strokeStyle = 'rgba(220, 225, 255, 0.16)';
  g.lineWidth = 1.5;
  for (let x = 60; x < W; x += 130) {
    g.beginPath();
    g.moveTo(x, 28);
    g.lineTo(x, 44);
    g.stroke();
  }

  // Branch and leaves.
  const branch = wobble(chaikin([[40, 745], [250, 712], [450, 694], [650, 682], [820, 664], [960, 640]], 2), R, 'branch', 3, 12);
  strand(g, branch, C.brown, 24);
  strand(g, wobble([[800, 668], [868, 610], [905, 590]], R, 'twig', 2, 10), C.brown, 14);
  const leaves = [[150, 700, -0.5], [330, 730, 0.5], [560, 660, -0.4], [700, 700, 0.6], [880, 575, -0.9], [930, 670, 0.3]];
  leaves.forEach(([x, y, a], i) => {
    const shape = leaf(x, y, 92, 26, a);
    satin(g, R, 'leaf' + i, shape, C.green, 9, 6, a + 0.9);
    strand(g, wobble(shape, R, 'leafo' + i, 1.5, 10, true), C.green, 6, true);
    strand(g, wobble([leaf(x, y, 92, 0, a)[0], leaf(x, y, 92, 0, a)[16]], R, 'vein' + i, 1, 10), C.green, 3);
  });
  for (let i = 0; i < 4; i++) {
    const x = 240 + i * 170 + R('berry', 'x', i) * 40; const y = 712 - i * 10 + 22;
    knot(g, x, y, 9, C.red);
  }

  const b = bird(470, 500, 250, -0.05);
  const perch = (x) => 745 - ((x - 40) / 920) * 105;
  for (const [i, leg] of b.legs.entries()) {
    strand(g, wobble([leg[0], [leg[1][0], perch(leg[1][0]) - 8]], R, 'leg' + i, 1.5, 10), C.yellow, 8);
  }
  for (const [i, tip] of [[-1.05, -0.44], [-1.12, -0.29], [-1.07, -0.13]].entries()) {
    strand(g, wobble(b.at([[-0.5, -0.02], tip]), R, 'tail' + i, 2, 12), C.red, 22);
  }
  satin(g, R, 'body', b.body, C.purple, 11, 8, 0.5);
  strand(g, wobble(b.body, R, 'bodyo', 2.2, 10, true), C.purple, 10, true);
  satin(g, R, 'wing', b.wing, C.orange, 10, 7, -0.4);
  strand(g, wobble(b.wing, R, 'wingo', 2, 10, true), C.orange, 9, true);
  for (let k = 0; k < 3; k++) {
    strand(g, wobble(b.at([[0.1 - k * 0.04, -0.1 + k * 0.06], [-0.45 + k * 0.08, -0.2 + k * 0.07]]), R, 'feather' + k, 1.5, 10), C.orange, 4);
  }
  g.fillStyle = C.yellow[0];
  path(g, b.beak);
  g.fill();
  strand(g, wobble(b.beak, R, 'beak', 1.2, 8, true), C.yellow, 7, true);
  satin(g, R, 'cheek', ellipse(b.cheek[0], b.cheek[1], 17, 13), C.red, 6, 4, 0.3);
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(b.eye[0], b.eye[1], 22, 0, Math.PI * 2);
  g.fill();
  strand(g, wobble(ellipse(b.eye[0], b.eye[1], 22, 22, 28), R, 'eye', 1, 8, true), ['#1c1640', '#0a0820', '#6a62a8'], 5, true);
  g.fillStyle = '#1c1640';
  g.beginPath();
  g.arc(b.eye[0] + 7, b.eye[1] + 2, 10, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(b.eye[0] + 10, b.eye[1] - 2, 3.5, 0, Math.PI * 2);
  g.fill();

  // The song, doodled.
  const beak = b.at([[1.02, -0.34]])[0];
  for (let k = 1; k <= 3; k++) {
    const arc = [];
    for (let i = 0; i <= 10; i++) {
      const a = -0.6 + (i / 10) * 1.2;
      arc.push([beak[0] + 8 + Math.cos(a) * k * 24, beak[1] + Math.sin(a) * k * 24]);
    }
    strand(g, wobble(arc, R, 'arc' + k, 1.2, 8), ['#f4f2ff', '#8a86b8', '#ffffff'], 5);
  }
  note(g, R, 'n1', 790, 330, 64, C.yellow, 4);
  note(g, R, 'n2', 880, 205, 52, C.green, -3);
  note(g, R, 'n3', 690, 175, 46, C.blue, 2);
  const heart = [];
  for (let i = 0; i < 40; i++) {
    const t = (i / 40) * Math.PI * 2;
    heart.push([170 + 16 * Math.sin(t) ** 3 * 2.6, 250 - (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * 2.6]);
  }
  strand(g, wobble(heart, R, 'heart', 1.5, 8, true), C.red, 8, true);
  for (let i = 0; i < 8; i++) {
    const x = 80 + R('spark', 'x', i) * 840; const y = 70 + R('spark', 'y', i) * 360;
    if (Math.hypot(x - 470, y - 420) < 190) continue;
    sparkle(g, x, y, 10 + R('spark', 'r', i) * 16);
  }

  caption(g, 'EMBROIDERY', font, 'rgba(240, 240, 255, 0.85)');
}

module.exports = { name: 'embroidery', size: { w: 1000, h: 1000 }, seed: 2026, draw };
