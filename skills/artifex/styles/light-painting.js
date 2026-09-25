// Light painting: a long exposure at night. A hand-held light traces the
// subject part by part, its colour drifting as it moves; where it slowed or
// crossed itself the trail burns brighter, towards white. Spun steel wool
// throws arcs of sparks, a light swung on a string leaves an orb, and wet
// ground below mirrors everything, dimmer and broken by ripples. All light
// adds: nothing covers.

'use strict';

const { rng, fbm } = require('../../../core/rand.js');
const { chaikin, resample } = require('../../../core/geom.js');
const font = require('../../../core/stroke-font.js');
const { mix } = require('../../../core/colour.js');
const { bird } = require('./subject.js');
const { wobble, caption } = require('./kit.js');

const W = 1000; const H = 1000;
const GROUND = 720;

// A trail of light: a wide faint glow, a narrower brighter one and a hot
// core, each added to what is there. Colour follows `hue(t)` along it.
function trail(g, pts, width, hue, bright = 1) {
  const n = pts.length;
  const passes = [[width * 7, 0.035], [width * 3.2, 0.09], [width * 1.4, 0.35], [width * 0.5, 0.9]];
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const step = 6;
  for (const [w, a] of passes) {
    g.lineWidth = w;
    for (let i = 0; i < n - 1; i += step) {
      const t = i / (n - 1);
      const core = w === width * 0.5;
      g.strokeStyle = core ? mix(hue(t), '#ffffff', 0.7) : hue(t);
      // The hand's speed varies: slower stretches burn brighter.
      const pace = 0.72 + 0.28 * Math.sin(i * 0.031 + pts.length) * Math.sin(i * 0.013 + 1.7);
      g.globalAlpha = Math.min(1, a * bright * (core ? 1 : pace + 0.2));
      g.beginPath();
      g.moveTo(pts[i][0], pts[i][1]);
      for (let k = i + 1; k <= Math.min(n - 1, i + step); k++) g.lineTo(pts[k][0], pts[k][1]);
      g.stroke();
    }
  }
  g.restore();
}

// Reflection in wet ground: the scene flipped about the waterline, dimmer,
// each row pushed sideways by ripples.
function reflect(pts) {
  return pts.map(([x, y]) => [x, 2 * GROUND - y]);
}

function ripple(R, pts) {
  return pts.map(([x, y]) => [x + 14 * (fbm(R, x / 90, y / 8, 2, 'ripple') - 0.5), y]);
}

// Spun steel wool: burning fibres flung out along arcs, each a short curved
// streak that fades as it cools.
function sparks(g, R, cx, cy, r, n, dim = 1, mirror = false) {
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const a = R('spark', 'a', i) * Math.PI * 2;
    const reach = r * (0.35 + 0.9 * R('spark', 'r', i) ** 0.7);
    const bend = (R('spark', 'b', i) - 0.5) * 0.9 + 0.35;
    const pts = [];
    for (let k = 0; k <= 12; k++) {
      const t = k / 12;
      const d = reach * t; const ang = a + bend * t * t;
      const drop = 90 * t * t * R('spark', 'g', i);
      const x = cx + Math.cos(ang) * d; let y = cy + Math.sin(ang) * d * 0.9 + drop;
      if (mirror) y = 2 * GROUND - y;
      pts.push([x, y]);
    }
    const heat = R('spark', 'h', i);
    for (let k = 1; k < pts.length; k++) {
      const t = k / (pts.length - 1);
      g.strokeStyle = heat > 0.8 ? '#fff2c0' : heat > 0.4 ? '#ffb347' : '#ff7a2a';
      g.globalAlpha = dim * (0.55 * (1 - t) + 0.08);
      g.lineWidth = 2.2 * (1 - t) + 0.6;
      g.beginPath();
      g.moveTo(pts[k - 1][0], pts[k - 1][1]);
      g.lineTo(pts[k][0], pts[k][1]);
      g.stroke();
    }
  }
  g.restore();
}

// A light swung round on a string: rings of trails at every tilt.
function orb(g, R, cx, cy, r, hue, dim = 1, mirror = false) {
  for (let k = 0; k < 16; k++) {
    const tilt = (k / 16) * Math.PI;
    const pts = [];
    for (let i = 0; i <= 90; i++) {
      const a = (i / 90) * Math.PI * 2;
      const x = cx + Math.cos(a) * r * Math.cos(tilt);
      let y = cy + Math.sin(a) * r * 0.96 + Math.cos(a) * r * Math.sin(tilt) * 0.12;
      if (mirror) y = 2 * GROUND - y;
      pts.push([x, y]);
    }
    trail(g, mirror ? ripple(R, pts) : pts, 1.6, () => hue, 0.5 * dim);
  }
}

function draw(g, s) {
  const R = rng(s.seed);

  // Night: faint stars, a little glow at the horizon, a tree line; wet
  // ground below, darker.
  const sky = g.createLinearGradient(0, 0, 0, GROUND);
  sky.addColorStop(0, '#04050b');
  sky.addColorStop(0.75, '#0b0d1c');
  sky.addColorStop(1, '#1b1726');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, GROUND);
  const ground = g.createLinearGradient(0, GROUND, 0, H);
  ground.addColorStop(0, '#0c0b12');
  ground.addColorStop(1, '#040407');
  g.fillStyle = ground;
  g.fillRect(0, GROUND, W, H - GROUND);
  for (let i = 0; i < 160; i++) {
    const x = R('star', 'x', i) * W; const y = R('star', 'y', i) * (GROUND - 160);
    g.fillStyle = 'rgba(210, 220, 255, ' + (0.15 + 0.5 * R('star', 'a', i) ** 3).toFixed(2) + ')';
    g.fillRect(x, y, 1.4, 1.4);
  }
  g.fillStyle = '#07070d';
  g.beginPath();
  g.moveTo(0, GROUND);
  for (let x = 0; x <= W; x += 20) g.lineTo(x, GROUND - 40 - 60 * fbm(R, x / 120, 0, 3, 'trees'));
  g.lineTo(W, GROUND);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(160, 150, 190, 0.05)';
  g.fillRect(0, GROUND - 2, W, 4);

  // Steel wool in the far corner, and an orb on the right.
  const WOOL = [175, 205, 165];
  const ORB = [838, 574, 96];
  sparks(g, R, ...WOOL, 380);
  orb(g, R, ...ORB, '#4fd1ff');

  // The subject, traced with a hand light: each part one closed loop, the
  // light switched off between parts so no stray line joins them.
  const b = bird(548, 420, 258, -0.06);
  const trace = (pts, name) => wobble(resample(chaikin(pts, 1, true), 3, true), R, name, 2.2, 14, true);
  const hue = (t) => mix(mix('#ff3d7f', '#ffb13d', Math.min(1, t * 2)), '#ff5ad1', Math.max(0, t * 2 - 1));
  const parts = [
    [trace(b.body, 'body'), hue],
    [trace(b.beak, 'beak'), () => '#ffb13d'],
    [trace(b.wing, 'wing'), (t) => mix('#ffd23d', '#ff8a3d', t)],
    [trace(b.tail, 'tail'), (t) => mix('#40e0ff', '#6f7bff', t)],
  ];
  for (const [line, colour] of parts) trail(g, line, 5, colour);
  // Where the light was held still it burns into a spot: the eye.
  g.save();
  g.globalCompositeOperation = 'lighter';
  const eye = g.createRadialGradient(b.eye[0], b.eye[1], 0, b.eye[0], b.eye[1], 34);
  eye.addColorStop(0, 'rgba(255, 255, 255, 1)');
  eye.addColorStop(0.25, 'rgba(255, 220, 160, 0.8)');
  eye.addColorStop(1, 'rgba(255, 120, 60, 0)');
  g.fillStyle = eye;
  g.fillRect(b.eye[0] - 34, b.eye[1] - 34, 68, 68);
  g.restore();
  // Legs to the ground, where the light touched down.
  const legs = b.legs.map((leg, i) => wobble(resample([leg[0], [leg[1][0] + 10 * i, GROUND - 4]], 3), R, 'leg' + i, 1.5, 12));
  for (const leg of legs) trail(g, leg, 3, () => '#40e0ff', 0.8);
  // Song: a second light from the beak, rising in widening loops.
  const beak = b.at([[1.04, -0.34]])[0];
  const song = [];
  for (let i = 0; i <= 240; i++) {
    const t = i / 240; const r = 10 + 34 * t;
    song.push([beak[0] + 14 + t * 70 + r * Math.cos(t * Math.PI * 7), beak[1] - 20 - t * 230 - r * Math.sin(t * Math.PI * 7)]);
  }
  const songHue = (t) => mix('#b77dff', '#6effc8', t);
  const songLine = wobble(song, R, 'song', 1.6, 8);
  trail(g, songLine, 2.4, songHue, 0.9);

  // The wet ground: everything above, mirrored, dimmer and rippled.
  g.save();
  g.beginPath();
  g.rect(0, GROUND, W, H - GROUND);
  g.clip();
  for (const [line, colour] of parts) trail(g, ripple(R, reflect(line)), 5, colour, 0.35);
  for (const leg of legs) trail(g, ripple(R, reflect(leg)), 3, () => '#40e0ff', 0.3);
  trail(g, ripple(R, reflect(songLine)), 2.4, songHue, 0.3);
  sparks(g, R, ...WOOL, 380, 0.3, true);
  orb(g, R, ...ORB, '#4fd1ff', 0.4, true);
  g.restore();

  caption(g, 'LIGHT PAINTING', font, 'rgba(230, 230, 255, 0.7)');
}

module.exports = { name: 'light-painting', size: { w: 1000, h: 1000 }, seed: 2026, draw };
