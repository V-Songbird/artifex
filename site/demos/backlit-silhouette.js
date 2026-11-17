// The showcase site's demo of Backlit silhouettes: the songbird staged in one
// scene, drawn with the marks of skills/artifex/styles/backlit-silhouette.js.
// Site-only, never a starting point for a piece. A lit screen with the lamp
// behind the bird: tissue clouds and two ranges of hills in gel, leaves of
// gel on a card branch, the bird cut from card with its wing and eye pierced,
// a stained-glass gel behind the wing, and black grass along the bottom.

'use strict';

const { rng } = require('../../core/rand.js');
const { chaikin } = require('../../core/geom.js');
const font = require('../../core/stroke-font.js');
const { bird } = require('./subject.js');
const { ellipse, caption } = require('../../skills/artifex/styles/kit.js');
const { screen, gel, card } = require('../../skills/artifex/styles/backlit-silhouette.js');

const W = 1000; const H = 1000;

// Warm screens with cool gels, or the reverse; each card leans to its screen.
const LOOKS = [
  { light: '#f6d9a0', cloud: '#eaa6b4', far: '#b8b0e6', near: '#6aa6bc', leaf: '#94c46e', wing: '#e8503c', ink: '#17100a' },
  { light: '#d4ebf2', cloud: '#f4c8a4', far: '#f2b48a', near: '#d0786c', leaf: '#e6c24e', wing: '#3c8ee0', ink: '#0b1013' },
  { light: '#f2ecb4', cloud: '#a8d8c8', far: '#9ccfb0', near: '#5a9a88', leaf: '#eebc54', wing: '#7058d8', ink: '#12110a' },
];

// A closed band around an open line, `w0` wide at its start and `w1` at its end.
function strip(line, w0, w1) {
  const n = line.length; const left = []; const right = [];
  for (let i = 0; i < n; i++) {
    const a = line[Math.max(0, i - 1)]; const b = line[Math.min(n - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const h = (w0 + (w1 - w0) * (i / (n - 1))) / 2;
    left.push([line[i][0] - ((b[1] - a[1]) / l) * h, line[i][1] + ((b[0] - a[0]) / l) * h]);
    right.push([line[i][0] + ((b[1] - a[1]) / l) * h, line[i][1] - ((b[0] - a[0]) / l) * h]);
  }
  return left.concat(right.reverse());
}

// A pointed slit from a to b, `w` wide at its middle.
function lens(a, b, w, n = 10) {
  const line = [];
  for (let i = 0; i <= n; i++) line.push([a[0] + (b[0] - a[0]) * (i / n), a[1] + (b[1] - a[1]) * (i / n)]);
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]); const nx = -(b[1] - a[1]) / l; const ny = (b[0] - a[0]) / l;
  const half = (i) => (w / 2) * Math.sin(Math.PI * (i / n));
  return line.map(([x, y], i) => [x + nx * half(i), y + ny * half(i)])
    .concat(line.map(([x, y], i) => [x - nx * half(i), y - ny * half(i)]).reverse().slice(1, -1));
}

// A range of hills: its ridge waves about `top`, and it runs off the bottom.
function hills(R, name, top, amp, waves) {
  const ph = R(name, 'phase', 0) * 6.28;
  const out = [[-20, H + 20]];
  for (let x = -20; x <= W + 20; x += 20) {
    out.push([x, top + amp * Math.sin(ph + (x / W) * waves * Math.PI) + amp * 0.35 * Math.sin(ph * 2 + (x / W) * waves * 2.7 * Math.PI)]);
  }
  out.push([W + 20, H + 20]);
  return out;
}

// A cloud cut from tissue: a scalloped top over a flat base, `w` by `h`.
function cloud(R, i, cx, cy, w, h) {
  const ph = R('look', 'puff', i) * 3; const out = [];
  for (let k = 0; k <= 32; k++) {
    const t = k / 32;
    out.push([cx + w * (t - 0.5), cy - h * Math.sin(Math.PI * t) ** 0.7 * (0.55 + 0.45 * Math.abs(Math.sin(ph + t * Math.PI * 3.5)))]);
  }
  return out.concat([[cx + w * 0.44, cy + h * 0.12], [cx - w * 0.44, cy + h * 0.12]]);
}

// A leaf with its midrib cut out, from its stem at (x, y) along angle a.
function leaf(x, y, a, len) {
  const c = Math.cos(a); const k = Math.sin(a);
  const at = (u, v) => [x + u * c - v * k, y + u * k + v * c];
  const blade = ellipse(0, 0, len / 2, len * 0.2, 28).map(([u, v]) => at(u + len / 2, v));
  return [blade, lens(at(len * 0.12, 0), at(len * 0.86, 0), len * 0.035, 8)];
}

function draw(g, s) {
  const R = rng(s.seed);
  const density = (s.params && s.params.density) ?? 0.8;
  const fall = (s.params && s.params.fall) ?? 0.45;
  const look = LOOKS[Math.floor(R('look', 'i', 0) * LOOKS.length)];
  const lean = (R('pose', 'lean', 0) - 0.5) * 0.16;

  // The bird on its perch; the lamp sits just behind its head.
  const b = bird(470, 476, 240, lean);
  const feet = b.legs.map((l) => l[1]);
  const perch = [(feet[0][0] + feet[1][0]) / 2, Math.max(feet[0][1], feet[1][1]) + 10];
  screen(g, R, W, H, { light: look.light, lamp: [b.eye[0] + 40 + (R('pose', 'lamp', 0) - 0.5) * 120, b.eye[1] - 20], reach: 740, fall });

  // Far sheets first: two tissue clouds, the left one held off the screen,
  // then two ranges of hills.
  for (let i = 0; i < 2; i++) {
    const cx = (i ? 740 : 250) + (R('look', 'cloudX', i) - 0.5) * 160; const cy = 230 + i * 120 + R('look', 'cloudY', i) * 40;
    gel(g, cloud(R, i, cx, cy, i ? 440 : 520, i ? 80 : 100), look.cloud, { density: density * 0.5, lift: i ? 0 : 10 });
  }
  gel(g, hills(R, 'far', 690, 46, 3), look.far, { density: density * 0.6 });
  gel(g, hills(R, 'near', 790, 34, 2.2), look.near, { density: Math.min(1, density * 0.95) });

  // The branch runs in from the left, under the bird's feet, and forks.
  const branch = [[-20, perch[1] + 60], [perch[0] - 220, perch[1] + 30], perch.map((v, i) => v + (i ? 14 : 0)),
    [perch[0] + 200, perch[1] - 6], [perch[0] + 330, perch[1] - 34], [perch[0] + 390, perch[1] - 60]];
  const twig = [[perch[0] + 230, perch[1] - 10], [perch[0] + 290, perch[1] - 80], [perch[0] + 320, perch[1] - 150]];
  const spots = [[...twig[2], -1.3], [...twig[1], -0.4], [...branch[5], -0.2], [...branch[4], 0.9], [perch[0] + 120, perch[1] + 4, 1.6], [perch[0] - 160, perch[1] + 36, 2.2]];
  spots.forEach(([x, y, a], i) => gel(g, leaf(x, y, a + (R('pose', 'leaf', i) - 0.5) * 0.5, 120 + R('pose', 'size', i) * 50), look.leaf, { density: Math.min(1, density * 1.1) }));
  card(g, strip(branch, 30, 8), { colour: look.ink });
  card(g, strip(twig, 10, 4), { colour: look.ink });

  // The bird: tail, body and beak as separate cards, since one sheet with
  // overlapping rings would open where they cross. Legs stand on the branch.
  for (const [top, foot] of b.legs) {
    card(g, strip([top, [foot[0], perch[1]]], 9, 7), { colour: look.ink });
    card(g, strip([[foot[0] - 4, perch[1] - 2], [foot[0] + 22, perch[1] + 4]], 7, 4), { colour: look.ink });
  }
  card(g, b.tail, { colour: look.ink });
  // The wing is cut out of the body, a little inside its outline, and held by
  // card struts left between its feathers.
  const wing = b.at(chaikin([[0.22, -0.16], [0.06, -0.3], [-0.2, -0.22], [-0.46, -0.08], [-0.28, 0.02], [0, 0.1], [0.2, 0.04]], 2, true));
  const struts = [[[0.18, -0.16], [-0.36, -0.12]], [[0.18, -0.06], [-0.24, 0.0]]];
  const eye = ellipse(b.eye[0], b.eye[1], 0.055 * b.s, 0.055 * b.s, 20);
  const dots = [[0.56, -0.12], [0.5, 0.0], [0.42, 0.1], [0.32, 0.18]].map(([u, v]) => ellipse(...b.at([[u, v]])[0], 0.022 * b.s, 0.022 * b.s, 12));
  card(g, [b.body, wing, eye, ...dots], { colour: look.ink });
  card(g, struts.map(([p, q]) => lens(...b.at([p, q]), 0.05 * b.s)), { colour: look.ink });
  card(g, b.beak, { colour: look.ink });
  gel(g, wing, look.wing, { density: Math.min(1, density * 1.05) });

  // Grass along the bottom, the nearest sheet.
  const grass = [[-20, H + 20]];
  for (let i = 0; i <= 42; i++) {
    const x = -20 + i * 25;
    grass.push([x, 912 + R('look', 'root', i) * 14]);
    grass.push([x + 12 + (R('look', 'bend', i) - 0.5) * 30, 900 - 30 - R('look', 'blade', i) * 80]);
  }
  grass.push([W + 20, H + 20]);
  card(g, grass, { colour: look.ink });

  caption(g, 'BACKLIT SILHOUETTES', font, look.light);
}

const params = {
  density: { min: 0.25, max: 1, value: 0.8, meaning: 'How much colour each gel holds: low reads as thin tissue on a bright screen, high as dense glass' },
  fall: { min: 0.1, max: 0.9, value: 0.45, meaning: "Light left at the screen's edges: low is one hot lamp in a dark room, high an even glow" },
};

module.exports = { name: 'backlit-silhouette', size: { w: 1000, h: 1000 }, seed: 2026, params, draw };
