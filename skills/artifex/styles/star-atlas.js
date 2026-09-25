// Star atlas: a printed celestial chart. A projected grid of right ascension
// and declination curves across a deep blue sky inside a graduated border;
// stars are discs sized by magnitude, the Milky Way a band of fine dots, and
// the subject a constellation: bright stars on its outline, joined by thin
// lines over a faint engraved figure, with a legend of symbols in a corner.

'use strict';

const { rng, fbm } = require('../../../core/rand.js');
const font = require('../../../core/stroke-font.js');
const { bird } = require('./subject.js');
const { path, caption } = require('./kit.js');

const W = 1000; const H = 1000;
const C = {
  sky: '#0d1b39',
  deep: '#081228',
  grid: 'rgba(120, 146, 196, 0.42)',
  frame: '#c9d4ec',
  label: 'rgba(201, 212, 236, 0.85)',
  figure: 'rgba(176, 196, 236, 0.7)',
  line: '#e6d49a',
  ecliptic: '#d6b25a',
  star: ['#f8f5ea', '#dfe9ff', '#fff0cf', '#ffd9a8'],
  galaxy: '#e0907a',
  cluster: '#e8cf6a',
  nebula: '#7fc7a4',
};
const FRAME = [40, 40, 960, 960];
// The chart's pole sits far above the sheet, so declination circles cross
// it as shallow arcs and hour lines as converging rays.
const POLE = [470, -1700];
const HOUR = 0.075;

function label(g, text, x, y, size, colour = C.label) {
  g.save();
  g.strokeStyle = colour;
  g.lineWidth = Math.max(1.1, size * 0.14);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  font.text(g, text, x - font.width(text, size) / 2, y, size);
  g.restore();
}

// A star by magnitude: a disc, a gap of sky round it where lines stop, and
// a soft glow for the brightest.
function star(g, x, y, mag, tint = C.star[0]) {
  const r = Math.max(0.55, 5.4 - mag * 0.82);
  if (mag < 2.4) {
    const halo = g.createRadialGradient(x, y, r, x, y, r * 4.5);
    halo.addColorStop(0, 'rgba(220, 230, 255, 0.28)');
    halo.addColorStop(1, 'rgba(220, 230, 255, 0)');
    g.fillStyle = halo;
    g.fillRect(x - r * 4.5, y - r * 4.5, r * 9, r * 9);
  }
  if (r > 1.6) {
    g.fillStyle = C.sky;
    g.beginPath();
    g.arc(x, y, r + 2.2, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = tint;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

function inFrame(x, y, m = 0) {
  return x > FRAME[0] + m && x < FRAME[2] - m && y > FRAME[1] + m && y < FRAME[3] - m;
}

function draw(g, s) {
  const R = rng(s.seed);

  g.fillStyle = C.deep;
  g.fillRect(0, 0, W, H);
  g.save();
  g.beginPath();
  g.rect(FRAME[0], FRAME[1], FRAME[2] - FRAME[0], FRAME[3] - FRAME[1]);
  g.clip();
  const glow = g.createRadialGradient(480, 470, 80, 500, 500, 720);
  glow.addColorStop(0, '#13274c');
  glow.addColorStop(1, C.sky);
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);

  // The Milky Way: a band of fine dots, clumped and split by dark lanes.
  const band = (x, y) => {
    const d = x * 0.6 + y * 0.8 - 720 + 90 * (fbm(R, x / 300, y / 300, 2, 'bend') - 0.5);
    return Math.exp(-((d / 150) ** 2));
  };
  for (let i = 0; i < 7; i++) {
    const t = i / 6; const x = 60 + t * 900; const y = 900 - t * 720;
    const soft = g.createRadialGradient(x, y, 10, x, y, 230);
    soft.addColorStop(0, 'rgba(150, 170, 220, 0.09)');
    soft.addColorStop(1, 'rgba(150, 170, 220, 0)');
    g.fillStyle = soft;
    g.fillRect(x - 230, y - 230, 460, 460);
  }
  for (let i = 0; i < 42000; i++) {
    const x = R('milk', 'x', i) * W; const y = R('milk', 'y', i) * H;
    const k = band(x, y) * (fbm(R, x / 70, y / 70, 3, 'clump') - 0.25) * 1.6;
    if (R('milk', 'keep', i) > k) continue;
    g.fillStyle = 'rgba(205, 215, 245, ' + (0.25 + 0.45 * R('milk', 'a', i)).toFixed(2) + ')';
    const r = 0.5 + 0.8 * R('milk', 'r', i);
    g.fillRect(x - r / 2, y - r / 2, r, r);
  }

  // The grid: declination arcs round the pole, hour rays from it.
  g.strokeStyle = C.grid;
  g.lineWidth = 1.2;
  const decs = [];
  for (let k = 0; k < 7; k++) {
    const r = 1780 + k * 170;
    decs.push(r);
    g.beginPath();
    g.arc(POLE[0], POLE[1], r, Math.PI / 2 - 0.5, Math.PI / 2 + 0.5);
    g.stroke();
  }
  const hours = [];
  for (let k = -3; k <= 3; k++) {
    const a = Math.PI / 2 + k * HOUR;
    hours.push(a);
    g.beginPath();
    g.moveTo(POLE[0] + Math.cos(a) * 1600, POLE[1] + Math.sin(a) * 1600);
    g.lineTo(POLE[0] + Math.cos(a) * 3200, POLE[1] + Math.sin(a) * 3200);
    g.stroke();
  }
  // The ecliptic, dashed, crossing the grid at a slant.
  g.save();
  g.strokeStyle = C.ecliptic;
  g.globalAlpha = 0.75;
  g.lineWidth = 1.6;
  g.setLineDash([10, 7]);
  g.beginPath();
  for (let x = 20; x <= 980; x += 10) {
    const y = 180 + x * 0.34 + 0.00022 * (x - 500) ** 2;
    if (x === 20) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.stroke();
  g.restore();
  label(g, 'ECLIPTIC', 150, 208, 9, 'rgba(214, 178, 90, 0.85)');

  // The field: faint stars in their hundreds, a few bright ones.
  const field = [];
  for (let i = 0; i < 1100; i++) {
    const x = FRAME[0] + R('field', 'x', i) * (FRAME[2] - FRAME[0]);
    const y = FRAME[1] + R('field', 'y', i) * (FRAME[3] - FRAME[1]);
    // Each magnitude holds about three times the stars of the one brighter.
    const mag = 1.5 + Math.log(1 + R('field', 'm', i) * 242) / Math.log(3);
    field.push([x, y, mag, C.star[Math.floor(R('field', 't', i) * 4)]]);
  }

  // The constellation: the subject's outline carried by named points.
  const b = bird(470, 470, 262, -0.04);
  g.save();
  g.strokeStyle = C.figure;
  g.lineWidth = 1.3;
  g.lineJoin = 'round';
  for (const part of [b.body, b.wing, b.tail, b.beak]) {
    path(g, part);
    g.stroke();
  }
  // Engraved detail, as old atlases drew their figures: hatching along the
  // underside, the wing's feathers, the tail's quills and an eye.
  g.lineWidth = 0.9;
  const engrave = (pts) => { path(g, b.at(pts), false); g.stroke(); };
  for (let k = 0; k < 26; k++) {
    const [x, y] = b.at([[-0.46 + k * 0.042, 0.2 + 0.2 * Math.sin((k / 25) * Math.PI)]])[0];
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + 6, y - 14);
    g.stroke();
  }
  for (let k = 0; k < 4; k++) engrave([[0.16 - k * 0.1, -0.12 + k * 0.05], [-0.58 + k * 0.1, -0.24 + k * 0.07]]);
  for (let k = 0; k < 3; k++) engrave([[-0.58, -0.04 + k * 0.03], [-1.02 - k * 0.02, -0.4 + k * 0.12]]);
  engrave([[0.46, -0.52], [0.5, -0.5], [0.54, -0.46], [0.5, -0.42], [0.46, -0.46]]);
  g.restore();
  const P = {
    beak: [1.0, -0.34], brow: [0.7, -0.44], crown: [0.42, -0.68], nape: [0.1, -0.44], back: [-0.3, -0.24],
    rump: [-0.58, -0.04], tailA: [-1.0, -0.44], tailB: [-1.08, -0.28], tailC: [-1.04, -0.14], throat: [0.72, -0.16],
    breast: [0.52, 0.2], belly: [0.02, 0.45], vent: [-0.38, 0.32], shoulder: [0.2, -0.08], tip: [-0.62, -0.24],
    footA: [0.0, 0.68], footB: [0.22, 0.68],
  };
  const at = (k) => b.at([P[k]])[0];
  const links = [['beak', 'brow'], ['brow', 'crown'], ['crown', 'nape'], ['nape', 'back'], ['back', 'rump'], ['rump', 'tailA'], ['rump', 'tailB'],
    ['rump', 'tailC'], ['brow', 'throat'], ['throat', 'breast'], ['breast', 'belly'], ['belly', 'vent'], ['vent', 'rump'],
    ['nape', 'shoulder'], ['shoulder', 'tip'], ['belly', 'footA'], ['breast', 'footB']];
  g.save();
  g.strokeStyle = C.line;
  g.globalAlpha = 0.85;
  g.lineWidth = 1.8;
  g.lineCap = 'round';
  for (const [a, c] of links) {
    const p = at(a); const q = at(c);
    g.beginPath();
    g.moveTo(p[0], p[1]);
    g.lineTo(q[0], q[1]);
    g.stroke();
  }
  g.restore();
  // Its boundary, stepped along the grid as charts draw them.
  g.save();
  g.strokeStyle = 'rgba(214, 178, 90, 0.55)';
  g.lineWidth = 1.2;
  g.setLineDash([3, 5]);
  const ray = (a, r) => [POLE[0] + Math.cos(a) * r, POLE[1] + Math.sin(a) * r];
  const inner = decs[1] - 30; const mid = decs[2] + 60; const outer = decs[3] + 110;
  const aW = Math.PI / 2 + 2.35 * HOUR; const aS = Math.PI / 2 + 1.5 * HOUR; const aE = Math.PI / 2 - 1.75 * HOUR;
  g.beginPath();
  g.arc(POLE[0], POLE[1], inner, aE, aW);
  g.lineTo(...ray(aW, mid));
  g.arc(POLE[0], POLE[1], mid, aW, aS, true);
  g.lineTo(...ray(aS, outer));
  g.arc(POLE[0], POLE[1], outer, aS, aE, true);
  g.closePath();
  g.stroke();
  g.restore();

  for (const [x, y, mag, tint] of field) star(g, x, y, mag, tint);
  const mags = { beak: 2.6, brow: 2.2, crown: 1.6, nape: 2.8, back: 2.1, rump: 2.5, tailA: 3.2, tailB: 1.9, tailC: 3.4, throat: 2.9,
    breast: 2.3, belly: 1.4, vent: 3.1, shoulder: 2.7, tip: 1.8, footA: 3.6, footB: 3.8 };
  const tints = { crown: 1, belly: 3, tailB: 2, tip: 1, back: 2 };
  for (const k of Object.keys(P)) star(g, ...at(k), mags[k], C.star[tints[k] || 0]);
  // The eye: a double star.
  star(g, b.eye[0] - 4, b.eye[1], 2.4, C.star[1]);
  star(g, b.eye[0] + 6, b.eye[1] - 3, 4.2, C.star[2]);
  // Catalogue numbers beside the brightest.
  const numbers = [['crown', '12'], ['belly', '7'], ['tailB', '31'], ['tip', '24'], ['back', '18']];
  for (const [k, n] of numbers) {
    const [x, y] = at(k);
    label(g, n, x + 16, y - 18, 9);
  }

  // Objects beyond the stars, by their chart symbols.
  const galaxy = (x, y, rx, ry, a) => {
    g.save();
    g.strokeStyle = C.galaxy;
    g.lineWidth = 1.4;
    g.beginPath();
    g.ellipse(x, y, rx, ry, a, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  };
  const cluster = (x, y, r) => {
    g.save();
    g.strokeStyle = C.cluster;
    g.lineWidth = 1.4;
    g.setLineDash([2, 3]);
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  };
  const nebula = (x, y, r) => {
    g.save();
    g.strokeStyle = C.nebula;
    g.lineWidth = 1.4;
    g.strokeRect(x - r, y - r, 2 * r, 2 * r);
    g.restore();
  };
  galaxy(820, 250, 16, 7, -0.5);
  galaxy(190, 720, 11, 5, 0.3);
  cluster(760, 640, 14);
  cluster(270, 170, 11);
  nebula(880, 520, 8);
  nebula(150, 400, 7);
  g.restore();

  // Hour and declination labels where the grid meets the frame.
  hours.forEach((a, k) => {
    const t = (FRAME[1] + 30 - POLE[1]) / Math.sin(a);
    const x = POLE[0] + Math.cos(a) * t;
    if (inFrame(x, FRAME[1] + 30, 10)) label(g, (8 - k) + 'H', x, FRAME[1] + 12, 11);
  });
  decs.forEach((r, k) => {
    const dy = Math.sqrt(Math.max(0, r * r - (FRAME[2] - 20 - POLE[0]) ** 2));
    const y = POLE[1] + dy;
    if (y < FRAME[1] + 20 || y > FRAME[3] - 20) return;
    // The stroke font has no plus sign: it is drawn as two strokes.
    const x = FRAME[2] - 30;
    label(g, String(60 - k * 10), x + 2, y - 5, 10);
    g.save();
    g.strokeStyle = C.label;
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(x - 17, y); g.lineTo(x - 9, y);
    g.moveTo(x - 13, y - 4); g.lineTo(x - 13, y + 4);
    g.stroke();
    g.restore();
  });

  // The legend.
  const L = [690, 800, 250, 128];
  g.fillStyle = C.deep;
  g.fillRect(L[0], L[1], L[2], L[3]);
  g.strokeStyle = C.frame;
  g.lineWidth = 1.2;
  g.strokeRect(L[0], L[1], L[2], L[3]);
  label(g, 'MAGNITUDES', L[0] + L[2] / 2, L[1] + 12, 9);
  for (let m = 0; m <= 5; m++) {
    const x = L[0] + 30 + m * 38; const y = L[1] + 46;
    star(g, x, y, m + 0.2);
    label(g, String(m), x, y + 14, 8);
  }
  [[galaxy, 'GALAXY'], [cluster, 'CLUSTER'], [nebula, 'NEBULA']].forEach(([mark, name], k) => {
    const x = L[0] + 22 + k * 80; const y = L[1] + 100;
    if (mark === galaxy) mark(x, y, 10, 5, -0.3); else mark(x, y, mark === nebula ? 5 : 7);
    label(g, name, x + 14 + font.width(name, 7) / 2, y - 4, 7);
  });

  // The graduated border: two rules and a band of alternating ticks.
  g.strokeStyle = C.frame;
  g.lineWidth = 1.6;
  g.strokeRect(FRAME[0], FRAME[1], FRAME[2] - FRAME[0], FRAME[3] - FRAME[1]);
  g.lineWidth = 1;
  g.strokeRect(FRAME[0] - 7, FRAME[1] - 7, FRAME[2] - FRAME[0] + 14, FRAME[3] - FRAME[1] + 14);
  g.strokeRect(FRAME[0] - 16, FRAME[1] - 16, FRAME[2] - FRAME[0] + 32, FRAME[3] - FRAME[1] + 32);
  g.fillStyle = C.frame;
  const seg = 23;
  for (let k = 0; k * seg < FRAME[2] - FRAME[0]; k += 2) {
    const a = FRAME[0] + k * seg; const len = Math.min(seg, FRAME[2] - a);
    g.fillRect(a, FRAME[1] - 7, len, 7);
    g.fillRect(a, FRAME[3], len, 7);
    g.fillRect(FRAME[0] - 7, a, 7, len);
    g.fillRect(FRAME[2], a, 7, len);
  }

  caption(g, 'STAR ATLAS', font, C.label, 62, 930);
}

module.exports = { draw };
