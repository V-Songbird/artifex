// The showcase site's demo of Star atlas: the songbird staged in one scene,
// drawn with the marks of skills/artifex/styles/star-atlas.js. Site-only,
// never a starting point for a piece.
//
// One chart sheet: the bird as a constellation, bright stars on its outline
// joined by thin lines over a faint engraved figure, inside a graduated
// border, with a dashed ecliptic, a stepped boundary, deep-sky symbols and a
// legend in a corner.

'use strict';

const { rng } = require('../../core/rand.js');
const font = require('../../core/stroke-font.js');
const { bird } = require('./subject.js');
const { path, caption } = require('../../skills/artifex/styles/kit.js');
const {
  PALETTE: C, label, decLabel, star, starField, sky, milkyWay, graticule, rayX, arcY, ecliptic, figure, hatchAlong,
  constellation, boundary, galaxy, cluster, nebula, legend, border,
} = require('../../skills/artifex/styles/star-atlas.js');

const W = 1000; const H = 1000;
const FRAME = [40, 40, 960, 960];
// The chart's pole sits far above the sheet, so declination circles cross
// it as shallow arcs and hour lines as converging rays.
const POLE = [470, -1700];
const HOUR = 0.075;

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
  sky(g, [480, 470], [500, 500], 80, 720, [0, 0, W, H]);

  milkyWay(g, R, 'milk', { from: [60, 900], to: [960, 180], normal: [0.6, 0.8], offset: 720, area: [0, 0, W, H] });

  const decs = [];
  for (let k = 0; k < 7; k++) decs.push(1780 + k * 170);
  const hours = [];
  for (let k = -3; k <= 3; k++) hours.push(Math.PI / 2 + k * HOUR);
  graticule(g, POLE, decs, hours);
  const curve = [];
  for (let x = 20; x <= 980; x += 10) curve.push([x, 180 + x * 0.34 + 0.00022 * (x - 500) ** 2]);
  ecliptic(g, curve);
  label(g, 'ECLIPTIC', 150, 208, 9, 'rgba(214, 178, 90, 0.85)');

  const field = starField(R, 'field', FRAME, (s.params && s.params.stars) ?? 1100);

  // The constellation: the subject's outline carried by named points.
  const b = bird(470, 470, 262, -0.04);
  // Engraved detail, as old atlases drew their figures: hatching along the
  // underside, the wing's feathers, the tail's quills and an eye.
  figure(g, [b.body, b.wing, b.tail, b.beak], () => {
    const engrave = (pts) => { path(g, b.at(pts), false); g.stroke(); };
    const under = [];
    for (let k = 0; k < 26; k++) under.push(b.at([[-0.46 + k * 0.042, 0.2 + 0.2 * Math.sin((k / 25) * Math.PI)]])[0]);
    hatchAlong(g, under, [6, -14]);
    for (let k = 0; k < 4; k++) engrave([[0.16 - k * 0.1, -0.12 + k * 0.05], [-0.58 + k * 0.1, -0.24 + k * 0.07]]);
    for (let k = 0; k < 3; k++) engrave([[-0.58, -0.04 + k * 0.03], [-1.02 - k * 0.02, -0.4 + k * 0.12]]);
    engrave([[0.46, -0.52], [0.5, -0.5], [0.54, -0.46], [0.5, -0.42], [0.46, -0.46]]);
  });
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
  constellation(g, links.map(([a, c]) => [at(a), at(c)]));
  // Its boundary, stepped along the grid as charts draw them.
  const inner = decs[1] - 30; const mid = decs[2] + 60; const outer = decs[3] + 110;
  const aW = Math.PI / 2 + 2.35 * HOUR; const aS = Math.PI / 2 + 1.5 * HOUR; const aE = Math.PI / 2 - 1.75 * HOUR;
  boundary(g, POLE, [[inner, aE, aW], [mid, aW, aS], [outer, aS, aE]]);

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
  galaxy(g, 820, 250, 16, 7, -0.5);
  galaxy(g, 190, 720, 11, 5, 0.3);
  cluster(g, 760, 640, 14);
  cluster(g, 270, 170, 11);
  nebula(g, 880, 520, 8);
  nebula(g, 150, 400, 7);
  g.restore();

  // Hour and declination labels where the grid meets the frame.
  hours.forEach((a, k) => {
    const x = rayX(POLE, a, FRAME[1] + 30);
    if (inFrame(x, FRAME[1] + 30, 10)) label(g, (8 - k) + 'H', x, FRAME[1] + 12, 11);
  });
  decs.forEach((r, k) => {
    const y = arcY(POLE, r, FRAME[2] - 20);
    if (y < FRAME[1] + 20 || y > FRAME[3] - 20) return;
    decLabel(g, 60 - k * 10, FRAME[2] - 30, y);
  });

  legend(g, 690, 800, 250, 128);
  border(g, FRAME);
  caption(g, 'STAR ATLAS', font, C.label, 62, 930);
}

const params = {
  stars: { min: 300, max: 1900, value: 1100, meaning: 'How many field stars fill the chart round the constellation: a sparse sky to a crowded one' },
};

module.exports = { name: 'star-atlas', size: { w: 1000, h: 1000 }, seed: 2026, params, draw };
