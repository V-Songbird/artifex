// The showcase site's demo of Print plates: the songbird staged in one scene,
// drawn with the marks of skills/artifex/styles/print-plate.js. Site-only,
// never a starting point for a piece. A three-ink print: the bird perched on a
// leafy branch before a sun, under a sky screened in steps. The light ink
// carries the body and leaves, the mid ink the sun, wing, beak and blush, the
// dark ink the sky, tail, shadow, eye and branch; every other colour is two
// of them overprinted. The seed picks the inks, which way the scene faces,
// the bird's tilt, the leaves and each plate's register.

'use strict';

const { rng } = require('../../core/rand.js');
const font = require('../../core/stroke-font.js');
const { bird } = require('./subject.js');
const { path, sub, ellipse, grain, caption } = require('../../skills/artifex/styles/kit.js');
const { ANGLES, register, job, plate, knockout, screen, print } = require('../../skills/artifex/styles/print-plate.js');

const W = 1000; const H = 1000;

// Light, mid and dark ink, with the paper they print on.
const SETS = [
  { paper: '#f4eee0', inks: ['#ffd000', '#ff48b0', '#0078bf'] },
  { paper: '#f2ecdc', inks: ['#ffe800', '#ff665e', '#00838a'] },
  { paper: '#f5efe2', inks: ['#ffe800', '#ff6c2f', '#765ba7'] },
];
const NAMES = ['light', 'mid', 'dark'];

const params = {
  register: { min: 0, max: 24, value: 5, meaning: 'How far each ink plate slips out of register: 0 prints true, high reads as a loose misprint' },
  pitch: { min: 6, max: 26, value: 13, meaning: 'Dot screen spacing in the sky, shadow, blush and leaves: low reads as smooth tone, high as big comic dots' },
};

const branchY = (x) => 815 - 0.085 * (x + 30) + 18 * Math.sin(x / 160);

function bounds(shapes) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const pts of shapes) for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1 - x0, y1 - y0];
}

// A pointed leaf from its stem at (x, y), `len` long along angle `a`.
function leaf(x, y, len, wid, a) {
  const pts = [];
  for (let k = 0; k <= 12; k++) pts.push([(k / 12) * len, -wid * Math.sin((Math.PI * k) / 12)]);
  for (let k = 11; k > 0; k--) pts.push([(k / 12) * len, 0.75 * wid * Math.sin((Math.PI * k) / 12)]);
  const c = Math.cos(a); const s = Math.sin(a);
  return pts.map(([u, v]) => [x + u * c - v * s, y + u * s + v * c]);
}

function fillAll(p, shapes) {
  p.beginPath();
  for (const pts of shapes) sub(p, pts);
  p.fill();
}

// Erases `shapes` from the plate drawn so far, so what follows sits on paper.
function erase(p, shapes) {
  p.save();
  p.globalCompositeOperation = 'destination-out';
  p.fillStyle = '#000';
  fillAll(p, shapes);
  p.restore();
}

function regMark(p, x, y) {
  p.lineWidth = 2;
  p.beginPath();
  p.arc(x, y, 13, 0, 2 * Math.PI);
  p.moveTo(x - 24, y); p.lineTo(x + 24, y);
  p.moveTo(x, y - 24); p.lineTo(x, y + 24);
  p.stroke();
}

function draw(g, s) {
  const R = rng(s.seed);
  const reach = (s.params && s.params.register) ?? params.register.value;
  const pitch = (s.params && s.params.pitch) ?? params.pitch.value;
  const set = SETS[Math.floor(R('look', 'inks') * SETS.length)];
  const flip = R('look', 'face') < 0.5;

  // The scene, faced either way; the caption is drawn after, so it reads.
  g.save();
  if (flip) { g.translate(W, 0); g.scale(-1, 1); }

  const J = job(g, W, H, set.inks.map((colour, i) => ({ name: NAMES[i], colour, offset: register(R, NAMES[i], i, reach), density: 0.9 })));
  // Each ink screens at its own angle, the palest at 0.
  const angle = { light: ANGLES[3], mid: ANGLES[0], dark: ANGLES[2] };
  const screenIn = (p, ink, shapes, tone) => {
    p.save();
    p.beginPath();
    for (const pts of shapes) sub(p, pts);
    p.clip();
    screen(p, R, ink, tone, bounds(shapes), { pitch, angle: angle[ink] });
    p.restore();
  };

  // The bird, its feet on the branch.
  const s0 = 260; const bx = 560;
  const by = branchY(bx + 0.11 * s0) - 0.68 * s0 - 2;
  const b = bird(bx, by, s0, (R('look', 'tilt') - 0.5) * 0.12);
  const front = [b.body, b.wing, b.beak];
  const whole = [b.tail, b.body, b.wing, b.beak];
  const eye = ellipse(b.eye[0], b.eye[1], 0.055 * s0, 0.055 * s0, 24);

  // Branch, a twig and leaves.
  const top = []; const bottom = [];
  for (let x = -40; x <= 1040; x += 40) {
    const hw = 15 - 0.006 * x;
    top.push([x, branchY(x) - hw]);
    bottom.unshift([x, branchY(x) + hw]);
  }
  const branch = top.concat(bottom);
  const ty = branchY(800);
  const twig = [[790, ty - 6], [930, 631], [938, 639], [818, ty + 6]];
  const leaves = [leaf(934, 635, 92, 26, -1.2), leaf(934, 635, 80, 22, 0.1)];
  for (let i = 0; i < 14; i++) {
    const x = 30 + i * 72 + (R('leaf', 'x', i) - 0.5) * 30;
    const up = R('leaf', 'up', i) < 0.5 && !(x > 320 && x < 800);
    const a = (up ? -Math.PI / 2 : Math.PI / 2) + (R('leaf', 'a', i) - 0.5) * 1.6;
    leaves.push(leaf(x, branchY(x), 64 + R('leaf', 'len', i) * 40, 18 + R('leaf', 'wid', i) * 8, a));
  }
  const berries = [];
  for (const [i, x] of [[0, 170], [1, 250], [2, 860]]) {
    for (let k = 0; k < 3; k++) {
      const u = x + (k - 1) * 22 + (R('berry', 'x', i * 3 + k) - 0.5) * 8;
      berries.push(ellipse(u, branchY(u) + 30 + (k % 2) * 14, 11, 11, 20));
    }
  }

  plate(J, 'light', (p) => {
    fillAll(p, front);
    fillAll(p, leaves);
    regMark(p, 940, 60);
  });

  plate(J, 'mid', (p) => {
    p.beginPath();
    p.arc(300, 370, 205, 0, 2 * Math.PI);
    p.fill();
    erase(p, front);
    // Wing and beak over the light ink: a colour neither ink has alone. The
    // eye takes all three inks, the print's darkest tone.
    fillAll(p, [b.wing, b.beak, eye]);
    // The breast blushes toward the front and below, in three steps.
    const tone = (x, y) => { const v = ((x - bx) * 0.6 + (y - by) * 0.8) / s0; return v > 0.3 ? 0.55 : v > 0.1 ? 0.3 : 0; };
    screenIn(p, 'mid', [b.body], tone);
    screenIn(p, 'mid', [ellipse(b.cheek[0], b.cheek[1], 0.1 * s0, 0.07 * s0, 24)], () => 0.45);
    fillAll(p, berries);
    regMark(p, 940, 60);
  });

  plate(J, 'dark', (p) => {
    // The sky in four steps, lighter toward the branch.
    screenIn(p, 'dark', [[[0, 0], [W, 0], [W, 640], [0, 640]]], (x, y) => (y < 180 ? 0.5 : y < 350 ? 0.33 : y < 510 ? 0.18 : 0.07));
    erase(p, whole);
    fillAll(p, [b.tail]);
    // Shadow on the side away from the light, upper right.
    const shade = (x, y) => { const u = (-(x - bx) * 0.55 + (y - by) * 0.84) / s0; return u > 0.32 ? 0.42 : u > 0.12 ? 0.2 : 0; };
    screenIn(p, 'dark', [b.body], shade);
    fillAll(p, [eye]);
    p.lineWidth = 0.03 * s0;
    p.lineCap = 'round';
    for (const leg of b.legs) { path(p, leg, false); p.stroke(); }
    fillAll(p, [branch, twig]);
    screenIn(p, 'dark', leaves, () => 0.5);
    regMark(p, 940, 60);
  });

  // Whites are paper: the catch light and a shine on the crown.
  // Grown by a capped margin, so a loose register does not swell them.
  const kGrow = Math.min(J.reach, 3) * 1.25;
  knockout(J, (p) => path(p, ellipse(b.eye[0] + 0.018 * s0, b.eye[1] - 0.018 * s0, 0.012 * s0, 0.012 * s0, 16)), kGrow);
  knockout(J, (p) => path(p, b.at(ellipse(0.38, -0.55, 0.08, 0.022, 24, -0.3))), kGrow);

  // Stencil ink never lies quite even: flecks of paper in every plate.
  for (const name of NAMES) {
    plate(J, name, (p) => {
      p.globalCompositeOperation = 'destination-out';
      grain(p, R, 'fleck' + name, W, H, 1200, 'rgba(0,0,0,0.45)', 'rgba(0,0,0,0.25)');
    });
  }

  print(J, set.paper);
  g.restore();

  caption(g, 'PRINT PLATES', font, set.inks[2]);
}

module.exports = { name: 'print-plate', size: { w: 1000, h: 1000 }, seed: 2026, params, draw };
