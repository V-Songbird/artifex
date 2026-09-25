// Impasto: the bird in thick paint. Thousands of short dabs follow a swirling
// flow, each laid as a body, a lit ridge and a shadowed ridge, so the paint
// seems to stand off the canvas. Orange and white swirls behind, like fire
// and cloud; inside the bird the dabs wrap its own form.

'use strict';

const { rng, fbm } = require('../../../core/rand.js');
const { pointInPoly } = require('../../../core/geom.js');
const { mix } = require('../../../core/colour.js');
const font = require('../../../core/stroke-font.js');
const { bird } = require('./subject.js');
const { grain, caption } = require('./kit.js');

const W = 1000; const H = 1000;
const LIGHT = [-0.6, -0.8];
const VORTEX = [[240, 300, 1], [800, 230, -1], [190, 810, -1], [830, 790, 1]];
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

// One dab along angle a: body, then a lit ridge on the side facing the light
// and a dark ridge on the other.
function dab(g, x, y, a, len, wide, colour) {
  const [lit, dark] = ridge(colour);
  const ly = -LIGHT[0] * Math.sin(a) + LIGHT[1] * Math.cos(a);
  const side = ly > 0 ? 1 : -1;
  g.save();
  g.translate(x, y);
  g.rotate(a);
  g.fillStyle = colour;
  g.beginPath();
  g.ellipse(0, 0, len, wide, 0, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 0.75;
  g.fillStyle = lit;
  g.beginPath();
  g.ellipse(-len * 0.1, side * wide * 0.42, len * 0.72, wide * 0.3, 0, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 0.55;
  g.fillStyle = dark;
  g.beginPath();
  g.ellipse(len * 0.12, -side * wide * 0.58, len * 0.78, wide * 0.24, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function flow(R, x, y) {
  let vx = 0.55; let vy = -0.8;
  for (const [cx, cy, s] of VORTEX) {
    const dx = x - cx; const dy = y - cy; const d2 = dx * dx + dy * dy + 9000;
    vx += (-dy * s * 180) / d2;
    vy += (dx * s * 180) / d2;
  }
  return Math.atan2(vy, vx) + (fbm(R, x / 260, y / 260, 3, 'flow') - 0.5) * 2.2;
}

function draw(g, s) {
  const R = rng(s.seed);
  g.fillStyle = '#f3ead8';
  g.fillRect(0, 0, W, H);

  const b = bird(505, 540, 290, -0.1);
  const centre = b.at([[0.05, 0.02]])[0];

  // Background swirls: a shuffled, jittered grid of dabs.
  const spots = [];
  for (let gy = 0; gy < 56; gy++) {
    for (let gx = 0; gx < 56; gx++) {
      const i = gy * 56 + gx;
      spots.push([gx * 19 - 20 + R('bg', 'x', i) * 18, gy * 19 - 20 + R('bg', 'y', i) * 18, i, R('bg', 'order', i)]);
    }
  }
  spots.sort((p, q) => p[3] - q[3]);
  for (const [x, y, i] of spots) {
    const warp = (fbm(R, x / 420, y / 420, 2, 'warp') - 0.5) * 1.6;
    const d = Math.hypot(x - centre[0], y - centre[1]);
    let v = fbm(R, x / 230 + warp, y / 230, 4, 'fire') + 0.14 * Math.exp(-(d * d) / (2 * 250 * 250)) + (R('bg', 'j', i) - 0.5) * 0.06;
    v = Math.min(v, 0.999);
    let colour = FIRE.find(([edge]) => v < edge)[1];
    if (R('bg', 'gold', i) < 0.015) colour = '#e9b949';
    dab(g, x, y, flow(R, x, y), 17 + R('bg', 'l', i) * 10, 6 + R('bg', 'w', i) * 3, colour);
  }

  // The bird: dabs sampled inside each part, turned to follow its form.
  const head = b.at([[0.42, -0.42]])[0];
  // One light over the whole body, so head and chest shade as one form.
  const light = b.at([[0.15, -0.12]])[0];
  const axis = (a, c) => { const [p, q] = b.at([a, c]); return Math.atan2(q[1] - p[1], q[0] - p[0]); };
  const wingAxis = axis([0.2, -0.08], [-0.6, -0.24]);
  const tailAxis = axis([-0.55, -0.02], [-1.05, -0.3]);
  const beakAxis = axis([0.7, -0.35], [1.0, -0.34]);
  const pick = (pal, t) => pal[Math.max(0, Math.min(pal.length - 1, Math.floor(t * pal.length)))];
  const cream = ['#8e98bf', '#c9b8b9', '#e6d3c1', '#f6ebd9', '#fffaf1'];
  const wing = ['#b8352a', '#d6452f', '#ea6a45', '#f39a6b'];
  const tail = ['#b8352a', '#c8412a', '#e0573a', '#f08a3c'];
  const beak = ['#d99a2b', '#e9b949', '#f2c94c'];
  const lit = (x, y, c, r) => 0.5 + ((x - c[0]) * -0.5 + (y - c[1]) * -0.85) / r;
  const cells = [];
  const all = [...b.body, ...b.wing, ...b.tail, ...b.beak];
  const [x0, x1] = [Math.min(...all.map((p) => p[0])), Math.max(...all.map((p) => p[0]))];
  const [y0, y1] = [Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[1]))];
  for (let y = y0 - 9; y < y1 + 9; y += 9) {
    for (let x = x0 - 9; x < x1 + 9; x += 9) {
      const i = cells.length;
      cells.push([x + R('bird', 'x', i) * 8, y + R('bird', 'y', i) * 8, i, R('bird', 'order', i)]);
    }
  }
  cells.sort((p, q) => p[3] - q[3]);
  for (const [x, y, i] of cells) {
    const p = [x, y];
    const wob = (R('bird', 'a', i) - 0.5) * 0.5;
    const len = 11 + R('bird', 'l', i) * 5; const wide = 4.2 + R('bird', 'w', i) * 1.8;
    if (pointInPoly(p, b.beak)) {
      dab(g, x, y, beakAxis + wob, len * 0.8, wide, pick(beak, lit(x, y, b.at([[0.85, -0.34]])[0], 40)));
    } else if (pointInPoly(p, b.wing)) {
      dab(g, x, y, wingAxis + wob, len, wide, pick(wing, lit(x, y, b.at([[-0.2, -0.1]])[0], 160)));
    } else if (pointInPoly(p, b.body)) {
      const nearHead = Math.hypot(x - head[0], y - head[1]) < 0.3 * b.s;
      const c = nearHead ? head : centre;
      const around = Math.atan2(y - c[1], x - c[0]) + Math.PI / 2;
      dab(g, x, y, around + wob, len, wide, pick(cream, lit(x, y, light, 250)));
    } else if (pointInPoly(p, b.tail)) {
      dab(g, x, y, tailAxis + wob, len, wide, pick(tail, lit(x, y, b.at([[-0.8, -0.2]])[0], 90)));
    }
  }

  // Accents: navy along the underside, gold on the wing edge, eye and blush.
  b.body.forEach((p, i) => {
    if (p[1] < centre[1] + 0.12 * b.s || i % 3) return;
    const q = b.body[(i + 1) % b.body.length];
    dab(g, p[0], p[1], Math.atan2(q[1] - p[1], q[0] - p[0]), 11, 3.6, '#27365e');
  });
  b.wing.forEach((p, i) => {
    if (i % 4) return;
    const q = b.wing[(i + 1) % b.wing.length];
    dab(g, p[0], p[1], Math.atan2(q[1] - p[1], q[0] - p[0]), 9, 3, '#f2c94c');
  });
  for (const [dx, dy, a] of [[-4, 0, 0.4], [4, 2, -0.3], [0, -4, 1.2]]) dab(g, b.eye[0] + dx, b.eye[1] + dy, a, 8, 5, '#1f2a4a');
  dab(g, b.eye[0] + 3, b.eye[1] - 4, 0.6, 4, 2.2, '#fffaf1');
  for (const [dx, dy] of [[-6, 2], [6, 0], [0, 6]]) dab(g, b.cheek[0] + dx, b.cheek[1] + dy, 0.2, 7, 3.5, '#f29a9a');

  grain(g, R, 'grain', W, H, 4000, 'rgba(255,255,255,0.10)', 'rgba(70,40,20,0.06)');
  caption(g, 'IMPASTO', font, 'rgba(90, 50, 30, 0.8)');
}

module.exports = { name: 'impasto', size: { w: 1000, h: 1000 }, seed: 2026, draw };
