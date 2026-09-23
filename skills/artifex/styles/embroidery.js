// Embroidery: bright thread on a dark cloth. Every line wobbles like a hand's,
// fills are stitched back and forth, and each strand carries a dark edge and
// a streaky sheen, the way satin stitches catch light.

'use strict';

const { rng } = require('../../../core/rand.js');
const { chaikin } = require('../../../core/geom.js');
const font = require('../../../core/stroke-font.js');
const { bird } = require('./subject.js');
const { path, wobble, ellipse, shadow, caption } = require('./kit.js');

const W = 1000; const H = 1000;
const C = {
  purple: ['#8a4fd8', '#4b2a86', '#c6a3f7'],
  red: ['#ef4a3c', '#9e2a22', '#ff9a86'],
  yellow: ['#f7c52b', '#a47a0c', '#fff0a8'],
  green: ['#3dbb58', '#1f7a35', '#9be8aa'],
  blue: ['#2e8ee6', '#1a5494', '#9fd0fa'],
  orange: ['#f6892a', '#a4520f', '#ffd0a0'],
  brown: ['#8a5a3c', '#4f3122', '#c69a78'],
};

function marker(g, pts, ink, width, close = false) {
  const [body, dark, light] = ink;
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.translate(2, 2.5);
  g.strokeStyle = dark;
  g.lineWidth = width;
  path(g, pts, close);
  g.stroke();
  g.restore();
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = body;
  g.lineWidth = width * 0.78;
  path(g, pts, close);
  g.stroke();
  g.globalAlpha = 0.7;
  g.strokeStyle = light;
  g.lineWidth = Math.max(1.5, width * 0.13);
  g.setLineDash([width * 2.4, width * 0.8]);
  g.translate(-width * 0.15, -width * 0.15);
  path(g, pts, close);
  g.stroke();
  g.restore();
}

function zigzag(poly, angle, spacing) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const cx = (x0 + x1) / 2; const cy = (y0 + y1) / 2; const r = Math.hypot(x1 - x0, y1 - y0) / 2 + 8;
  const ux = Math.cos(angle); const uy = Math.sin(angle);
  const out = [];
  let flip = false;
  for (let k = -r; k <= r; k += spacing) {
    const a = [cx - ux * r - uy * k, cy - uy * r + ux * k];
    const b = [cx + ux * r - uy * k, cy + uy * r + ux * k];
    out.push(...(flip ? [b, a] : [a, b]));
    flip = !flip;
  }
  return out;
}

function scribble(g, R, name, poly, ink, spacing, width, angle) {
  const [body, dark, light] = ink;
  g.save();
  path(g, poly);
  g.clip();
  g.globalAlpha = 0.45;
  g.fillStyle = dark;
  path(g, poly);
  g.fill();
  g.globalAlpha = 1;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = body;
  g.lineWidth = width;
  path(g, wobble(zigzag(poly, angle, spacing), R, name, 2.4, 12), false);
  g.stroke();
  g.globalAlpha = 0.35;
  g.strokeStyle = light;
  g.lineWidth = width * 0.35;
  path(g, wobble(zigzag(poly, angle + 0.55, spacing * 1.7), R, name + 'x', 2.4, 12), false);
  g.stroke();
  g.restore();
}

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

function sparkle(g, x, y, r) {
  const k = r * 0.2;
  g.save();
  shadow(g, 'rgba(255, 255, 255, 0.85)', 12);
  g.fillStyle = '#ffffff';
  path(g, [[x - r, y], [x - k, y - k], [x, y - r], [x + k, y - k], [x + r, y], [x + k, y + k], [x, y + r], [x - k, y + k]]);
  g.fill();
  g.restore();
}

function note(g, R, name, x, y, size, ink, tilt) {
  const head = ellipse(x, y, size * 0.34, size * 0.24, 24, -0.45);
  g.save();
  g.fillStyle = ink[0];
  path(g, head);
  g.fill();
  g.restore();
  marker(g, wobble(head, R, name + 'h', 1.2, 8, true), ink, 7, true);
  const top = [x + size * 0.3 + tilt, y - size * 1.25];
  marker(g, wobble([[x + size * 0.3, y - size * 0.08], top], R, name + 's', 1.5, 10), ink, 7);
  marker(g, wobble(chaikin([top, [top[0] + size * 0.45, top[1] + size * 0.3], [top[0] + size * 0.3, top[1] + size * 0.75]], 2), R, name + 'f', 1.5, 10), ink, 7);
}

function draw(g, s) {
  const R = rng(s.seed);

  g.fillStyle = '#10153a';
  g.fillRect(0, 0, W, H);
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(170, 180, 255, 0.07)';
  g.lineWidth = 2.2;
  for (let i = 0; i < 340; i++) {
    const x = R('dash', 'x', i) * W; const y = R('dash', 'y', i) * H;
    const a = -1.15 + (R('dash', 'a', i) - 0.5) * 0.25; const l = 8 + R('dash', 'l', i) * 8;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  g.strokeStyle = 'rgba(220, 225, 255, 0.16)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(0, 470);
  g.lineTo(W, 470);
  g.stroke();
  for (let x = 60; x < W; x += 130) {
    g.beginPath();
    g.moveTo(x, 28);
    g.lineTo(x, 44);
    g.stroke();
  }

  // Branch and leaves.
  const branch = wobble(chaikin([[40, 745], [250, 712], [450, 694], [650, 682], [820, 664], [960, 640]], 2), R, 'branch', 3, 12);
  marker(g, branch, C.brown, 24);
  marker(g, wobble([[800, 668], [868, 610], [905, 590]], R, 'twig', 2, 10), C.brown, 14);
  const leaves = [[150, 700, -0.5], [330, 730, 0.5], [560, 660, -0.4], [700, 700, 0.6], [880, 575, -0.9], [930, 670, 0.3]];
  leaves.forEach(([x, y, a], i) => {
    const shape = leaf(x, y, 92, 26, a);
    scribble(g, R, 'leaf' + i, shape, C.green, 9, 6, a + 0.9);
    marker(g, wobble(shape, R, 'leafo' + i, 1.5, 10, true), C.green, 6, true);
    marker(g, wobble([leaf(x, y, 92, 0, a)[0], leaf(x, y, 92, 0, a)[16]], R, 'vein' + i, 1, 10), C.green, 3);
  });
  for (let i = 0; i < 4; i++) {
    const x = 240 + i * 170 + R('berry', 'x', i) * 40; const y = 712 - i * 10 + 22;
    g.fillStyle = C.red[0];
    g.beginPath();
    g.arc(x, y, 9, 0, Math.PI * 2);
    g.fill();
  }

  const b = bird(470, 500, 250, -0.05);
  const perch = (x) => 745 - ((x - 40) / 920) * 105;
  for (const [i, leg] of b.legs.entries()) {
    marker(g, wobble([leg[0], [leg[1][0], perch(leg[1][0]) - 8]], R, 'leg' + i, 1.5, 10), C.yellow, 8);
  }
  for (const [i, tip] of [[-1.05, -0.44], [-1.12, -0.29], [-1.07, -0.13]].entries()) {
    marker(g, wobble(b.at([[-0.5, -0.02], tip]), R, 'tail' + i, 2, 12), C.red, 22);
  }
  scribble(g, R, 'body', b.body, C.purple, 11, 8, 0.5);
  marker(g, wobble(b.body, R, 'bodyo', 2.2, 10, true), C.purple, 10, true);
  scribble(g, R, 'wing', b.wing, C.orange, 10, 7, -0.4);
  marker(g, wobble(b.wing, R, 'wingo', 2, 10, true), C.orange, 9, true);
  for (let k = 0; k < 3; k++) {
    marker(g, wobble(b.at([[0.1 - k * 0.04, -0.1 + k * 0.06], [-0.45 + k * 0.08, -0.2 + k * 0.07]]), R, 'feather' + k, 1.5, 10), C.orange, 4);
  }
  g.fillStyle = C.yellow[0];
  path(g, b.beak);
  g.fill();
  marker(g, wobble(b.beak, R, 'beak', 1.2, 8, true), C.yellow, 7, true);
  scribble(g, R, 'cheek', ellipse(b.cheek[0], b.cheek[1], 17, 13), C.red, 6, 4, 0.3);
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(b.eye[0], b.eye[1], 22, 0, Math.PI * 2);
  g.fill();
  marker(g, wobble(ellipse(b.eye[0], b.eye[1], 22, 22, 28), R, 'eye', 1, 8, true), ['#1c1640', '#0a0820', '#6a62a8'], 5, true);
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
    marker(g, wobble(arc, R, 'arc' + k, 1.2, 8), ['#f4f2ff', '#8a86b8', '#ffffff'], 5);
  }
  note(g, R, 'n1', 790, 330, 64, C.yellow, 4);
  note(g, R, 'n2', 880, 205, 52, C.green, -3);
  note(g, R, 'n3', 690, 175, 46, C.blue, 2);
  const heart = [];
  for (let i = 0; i < 40; i++) {
    const t = (i / 40) * Math.PI * 2;
    heart.push([170 + 16 * Math.sin(t) ** 3 * 2.6, 250 - (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * 2.6]);
  }
  marker(g, wobble(heart, R, 'heart', 1.5, 8, true), C.red, 8, true);
  for (let i = 0; i < 8; i++) {
    const x = 80 + R('spark', 'x', i) * 840; const y = 70 + R('spark', 'y', i) * 360;
    if (Math.hypot(x - 470, y - 420) < 190) continue;
    sparkle(g, x, y, 10 + R('spark', 'r', i) * 16);
  }

  caption(g, 'EMBROIDERY', font, 'rgba(240, 240, 255, 0.85)');
}

module.exports = { draw };
