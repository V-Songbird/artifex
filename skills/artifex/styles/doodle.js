// Doodle: ballpoint sketches in a school notebook. Ruled paper, a red margin
// and punched holes; the bird drawn in blue pen with sketchy double strokes
// and hatching, surrounded by the doodles a bored hand makes: bubble letters
// over a highlighter swipe, stars, a spiral, a hatched cube, a sun, notes.

'use strict';

const { rng } = require('../../../core/rand.js');
const { chaikin } = require('../../../core/geom.js');
const font = require('../../../core/stroke-font.js');
const { bird } = require('./subject.js');
const { path, wobble, ellipse, grain, shadow, caption } = require('./kit.js');

const W = 1000; const H = 1000;
const PAPER = '#fbfaf4';
const BLUE = 'rgba(31, 58, 147, 0.88)';
const RED = 'rgba(200, 45, 60, 0.85)';

// A pen line: drawn twice with independent wobble, like a hand going over it.
function pen(g, R, name, pts, close = false, ink = BLUE, width = 2.6, passes = 2) {
  g.save();
  g.strokeStyle = ink;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (let k = 0; k < passes; k++) {
    g.lineWidth = width * (k ? 0.7 : 1);
    path(g, wobble(pts, R, name + k, k ? 2.2 : 1.3, 7, close), close);
    g.stroke();
  }
  g.restore();
}

function hatch(g, R, name, region, angle, spacing, ink = BLUE) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const [x, y] of region) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const cx = (x0 + x1) / 2; const cy = (y0 + y1) / 2; const r = Math.hypot(x1 - x0, y1 - y0) / 2;
  const ux = Math.cos(angle); const uy = Math.sin(angle);
  g.save();
  path(g, region);
  g.clip();
  g.strokeStyle = ink;
  g.lineWidth = 1.6;
  g.lineCap = 'round';
  let i = 0;
  for (let k = -r; k <= r; k += spacing, i++) {
    const a = [cx - ux * r - uy * k, cy - uy * r + ux * k]; const b = [cx + ux * r - uy * k, cy + uy * r + ux * k];
    path(g, wobble([a, b], R, name + i, 1.2, 14), false);
    g.stroke();
  }
  g.restore();
}

function starPath(cx, cy, r, rot = -Math.PI / 2) {
  const pts = [];
  for (let k = 0; k <= 5; k++) {
    const a = rot + (k * 4 * Math.PI) / 5;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

function heart(cx, cy, s) {
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const t = (i / 40) * Math.PI * 2;
    pts.push([cx + 16 * Math.sin(t) ** 3 * s, cy - (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * s]);
  }
  return pts;
}

function note(g, R, name, x, y, size) {
  const head = ellipse(x, y, size * 0.32, size * 0.22, 20, -0.45);
  g.fillStyle = BLUE;
  path(g, head);
  g.fill();
  pen(g, R, name + 's', [[x + size * 0.28, y - size * 0.05], [x + size * 0.3, y - size * 1.2]]);
  pen(g, R, name + 'f', chaikin([[x + size * 0.3, y - size * 1.2], [x + size * 0.72, y - size * 0.92], [x + size * 0.6, y - size * 0.55]], 2));
}

function draw(g, s) {
  const R = rng(s.seed);

  // Notebook page.
  g.fillStyle = PAPER;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(120, 165, 220, 0.55)';
  g.lineWidth = 1.6;
  for (let y = 118; y < H; y += 34) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  g.strokeStyle = 'rgba(225, 120, 130, 0.8)';
  g.lineWidth = 2.2;
  g.beginPath(); g.moveTo(112, 0); g.lineTo(112, H); g.stroke();
  for (const y of [190, 500, 810]) {
    g.save();
    shadow(g, 'rgba(0, 0, 0, 0.18)', 4, 1, 2);
    g.fillStyle = '#dcd8cc';
    g.beginPath(); g.arc(52, y, 17, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  grain(g, R, 'grain', W, H, 2500, 'rgba(255,255,255,0.5)', 'rgba(90,80,60,0.05)');

  // Bubble letters over a highlighter swipe.
  g.save();
  g.strokeStyle = 'rgba(255, 232, 60, 0.55)';
  g.lineWidth = 64;
  g.lineCap = 'round';
  path(g, wobble([[300, 112], [740, 102]], R, 'hl', 3, 30), false);
  g.stroke();
  g.restore();
  const word = 'ARTIFEX'; const size = 76; const x0 = 520 - font.width(word, size) / 2;
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = BLUE;
  g.lineWidth = 30;
  font.text(g, word, x0 + 5, 72 + 5, size);
  g.strokeStyle = BLUE;
  g.lineWidth = 30;
  font.text(g, word, x0, 72, size);
  g.strokeStyle = PAPER;
  g.lineWidth = 24;
  font.text(g, word, x0, 72, size);
  g.restore();

  // The bird on a branch.
  const b = bird(440, 520, 215, -0.04);
  const branch = chaikin([[150, 690], [330, 672], [520, 668], [700, 650], [820, 628]], 2);
  pen(g, R, 'branch', branch, false, BLUE, 3.4);
  pen(g, R, 'branch2', branch.map(([x, y]) => [x + 6, y + 12]), false, BLUE, 2.2, 1);
  for (const [i, [x, y, a]] of [[200, 684, -0.6], [610, 660, 0.5], [760, 640, -0.5]].entries()) {
    const leaf = ellipse(x, y - 14, 22, 9, 16, a);
    pen(g, R, 'leaf' + i, leaf, true, BLUE, 2.2);
    hatch(g, R, 'leafh' + i, leaf, a + 1.2, 7);
  }
  for (const [i, leg] of b.legs.entries()) pen(g, R, 'leg' + i, [leg[0], [leg[1][0], 668]], false, BLUE, 3);
  pen(g, R, 'tail', b.tail, true);
  hatch(g, R, 'tailh', b.tail, 0.9, 9);
  pen(g, R, 'body', b.body, true);
  g.save();
  path(g, b.body);
  g.clip();
  const shade = b.at(ellipse(-0.1, 0.36, 0.7, 0.3));
  hatch(g, R, 'belly', shade, 0.7, 10);
  hatch(g, R, 'belly2', b.at(ellipse(-0.3, 0.42, 0.45, 0.16)), -0.7, 10);
  g.restore();
  g.fillStyle = PAPER;
  path(g, b.wing);
  g.fill();
  pen(g, R, 'wing', b.wing, true);
  for (let k = 0; k < 4; k++) {
    const arc = b.at([[0.12 - k * 0.2, -0.04], [0.02 - k * 0.2, 0.06], [-0.1 - k * 0.2, -0.02]]);
    pen(g, R, 'scallop' + k, chaikin(arc, 2), false, BLUE, 2);
  }
  g.fillStyle = PAPER;
  path(g, b.beak);
  g.fill();
  pen(g, R, 'beak', b.beak, true);
  g.fillStyle = BLUE;
  g.beginPath(); g.arc(b.eye[0], b.eye[1], 11, 0, Math.PI * 2); g.fill();
  g.fillStyle = PAPER;
  g.beginPath(); g.arc(b.eye[0] + 3.5, b.eye[1] - 3.5, 3.5, 0, Math.PI * 2); g.fill();
  pen(g, R, 'cheek', ellipse(b.cheek[0] + 4, b.cheek[1] + 6, 14, 9), true, RED, 2);

  // What it sings.
  const beak = b.at([[1.03, -0.34]])[0];
  for (let k = 1; k <= 3; k++) {
    const arc = [];
    for (let i = 0; i <= 8; i++) { const a = -0.55 + (i / 8) * 1.1; arc.push([beak[0] + 6 + Math.cos(a) * k * 20, beak[1] + Math.sin(a) * k * 20]); }
    pen(g, R, 'wave' + k, arc, false, BLUE, 2, 1);
  }
  note(g, R, 'n1', 760, 380, 60);
  note(g, R, 'n2', 860, 300, 46);
  g.save();
  g.strokeStyle = BLUE;
  g.lineWidth = 2.4;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.translate(700, 250);
  g.rotate(-0.12);
  font.text(g, 'TWEET!', 0, 0, 26);
  g.restore();

  // The margins fill up.
  const sun = [860, 130];
  pen(g, R, 'sun', ellipse(sun[0], sun[1], 38, 38, 32), true);
  const rays = [];
  for (let k = 0; k <= 24; k++) { const a = (k / 24) * Math.PI * 2; const r = k % 2 ? 50 : 72; rays.push([sun[0] + Math.cos(a) * r, sun[1] + Math.sin(a) * r]); }
  pen(g, R, 'rays', rays, true, BLUE, 2.2, 1);
  g.fillStyle = BLUE;
  for (const dx of [-12, 12]) { g.beginPath(); g.arc(sun[0] + dx, sun[1] - 8, 4, 0, Math.PI * 2); g.fill(); }
  const smile = []; for (let i = 0; i <= 8; i++) { const a = 0.3 + (i / 8) * (Math.PI - 0.6); smile.push([sun[0] + Math.cos(a) * 18, sun[1] + 2 + Math.sin(a) * 14]); }
  pen(g, R, 'smile', smile, false, BLUE, 2.4, 1);

  const cloud = [];
  for (const [cx, cy, r, a0, a1] of [[200, 320, 26, Math.PI * 0.9, Math.PI * 1.9], [240, 300, 32, Math.PI * 1.1, Math.PI * 1.95], [282, 318, 24, Math.PI * 1.3, Math.PI * 2.3]]) {
    for (let i = 0; i <= 8; i++) { const a = a0 + ((a1 - a0) * i) / 8; cloud.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  }
  cloud.push([286, 342], [196, 342]);
  pen(g, R, 'cloud', cloud, true);
  for (let i = 0; i < 6; i++) pen(g, R, 'rain' + i, [[200 + i * 16, 356], [192 + i * 16, 376]], false, BLUE, 2, 1);

  for (const [i, [x, y, r]] of [[180, 230, 20], [720, 560, 16], [560, 870, 24], [930, 420, 14], [420, 210, 12]].entries()) {
    pen(g, R, 'star' + i, starPath(x, y, r), false, BLUE, 2.2, 1);
  }
  for (const [i, [x, y]] of [[640, 210], [300, 780], [930, 560]].entries()) {
    pen(g, R, 'plus' + i, [[x - 9, y], [x + 9, y]], false, BLUE, 2, 1);
    pen(g, R, 'plusv' + i, [[x, y - 9], [x, y + 9]], false, BLUE, 2, 1);
  }
  pen(g, R, 'heart1', heart(318, 220, 1.3), true, RED, 2.6);
  pen(g, R, 'heart2', heart(905, 680, 1.1), true, RED, 2.4);

  const spiral = [];
  for (let i = 0; i <= 120; i++) { const a = (i / 120) * Math.PI * 7; const r = 3 + a * 4.2; spiral.push([230 + Math.cos(a) * r, 860 + Math.sin(a) * r]); }
  pen(g, R, 'spiral', spiral, false, BLUE, 2.4, 1);

  const cube = [[770, 780], [850, 780], [850, 860], [770, 860]];
  const back = cube.map(([x, y]) => [x + 36, y - 30]);
  pen(g, R, 'cubeF', cube, true);
  pen(g, R, 'cubeB', back, true, BLUE, 2, 1);
  for (let k = 0; k < 4; k++) pen(g, R, 'cubeE' + k, [cube[k], back[k]], false, BLUE, 2, 1);
  hatch(g, R, 'cubeS', [cube[1], back[1], back[2], cube[2]], 1.1, 8);

  const bolt = [[630, 760], [668, 760], [648, 800], [678, 800], [616, 872], [636, 818], [606, 818]];
  pen(g, R, 'bolt', bolt, true);
  hatch(g, R, 'bolth', bolt, -0.8, 7);

  const arrow = chaikin([[170, 760], [210, 700], [290, 680], [330, 640]], 3);
  pen(g, R, 'arrow', arrow, false, BLUE, 2.4, 1);
  pen(g, R, 'arrowA', [[304, 638], [330, 640], [318, 664]], false, BLUE, 2.4, 1);
  g.save();
  g.strokeStyle = BLUE;
  g.lineWidth = 2.2;
  g.lineCap = 'round';
  font.text(g, 'ME!', 136, 770, 22);
  g.restore();

  const squiggle = [];
  for (let i = 0; i <= 60; i++) squiggle.push([380 + i * 6, 940 + Math.sin(i * 0.9) * 8]);
  pen(g, R, 'squiggle', squiggle, false, BLUE, 2.2, 1);

  caption(g, 'DOODLE', font, BLUE, 128, 952, 14);
}

module.exports = { draw };
