// Seam 3a to 3b, the plot is cut out and folded into papercraft layers. It
// begins where the CAD shot ends: the finished plot, the plotter's gantry
// heading home. A craft knife cuts the bird out of the blueprint part by
// part; the parts rise onto their own layers, the wing on top, and its edge
// folds over along the plot's own fold line to show the paper's white back;
// the sheet is torn across twice and its strips part and stack (see
// papercut.js). The light swings a little as it settles, and the shadows
// with it.
//
// Beats, in seconds:
//   0.0-1.6   the gantry heads home, off the sheet to the left
//   0.4-2.4   the camera goes in to the bird
//   0.9-4.1   the knife comes in and cuts: tail, body and legs, beak, wing
//   4.2-5.2   the parts rise, each on its own layer, and settle
//   5.1-6.4   the wing's edge folds up and settles, its white back showing
//   5.6-6.7   the sheet tears across, above the bird and below it
//   6.7-8.3   the strips part and stack
//   7.2-10    the light swings a little; the shadows move with it
//
// WHAT STAYS IS KEPT. The plotted sheet is drawn once and kept, at the CAD
// shot's camera and at the close one; every piece of it is that copy, laid
// through the piece's shape and lift.
//
// Looks to leave out: those of the CAD shot (see cad.cjs), and
// - parts that fade or pop up: each is cut at the knife and rises with weight;
// - a papercraft without layers: every layer casts its shadow on the next;
// - torn edges without the paper's core, and cut edges with a ragged one.

'use strict';

const { rng } = require('../../core/rand.js');
const P = require('./paper.js');
const E = require('./enter.js');
const Dr = require('./draft.js');
const Pc = require('./papercut.js');
const Fd = require('./folded.js');
const Sd = require('./sounds.js');

// Where a point of the sheet is heard once the camera has gone in to the bird.
const panOf = (p) => Math.max(-0.8, Math.min(0.8, ((p[0] - Dr.FRONT[0] - 40) / 300) * 0.7));

/**
 * Heard: the plotter's gantry rolling home, off to the left, a soft rumble
 * of its wheels with a knock as it parks; the knife, a tap as it goes in
 * and a crisp dry scoring along every cut; each part lifted off the sheet,
 * the higher the fuller; the wing's crease, a crunch over a dull fold; the
 * two tears across the sheet, left to right, a crackle of fibres over the
 * rasp of the paper, fastest in the middle; and the strips drawn apart and
 * set down on one another.
 */
function sound(ctx, s) {
  const R = rng(s.seed), end = ctx.length / ctx.sampleRate, pairs = [];
  pairs.push(...Sd.placed(Sd.swell(R, 'gantry', 0.05, 1.4, (u) => 260 - 80 * u, 0.04, 0.3), { pan: -0.45, distance: 0.5 }));
  pairs.push([1.5, { ...Sd.knock(700, 140, 0.07), velocity: 0.6, vary: 0.4, pan: -0.7, distance: 0.6 }]);
  s.cuts.forEach((c, i) => {
    pairs.push([c.t0, { ...Sd.snap(3600, 0.004, 0.14), velocity: 0.6 + 0.3 * R('stab', 'level', i), vary: 0.5, pan: panOf(c.pts[0]) }]);
    const press = 0.65 + 0.35 * R('score', 'press', i);
    pairs.push(...Sd.along(c.t0, c.t1, Math.max(3, Math.round(c.len / 3)), (u) => u, (u, speed, j) => ({
      ...Sd.snap(2600 + 2600 * R('score', 'colour', i * 1000 + j), 0.003 + 0.006 * R('score', 'length', i * 1000 + j), 0.2), velocity: press * (0.3 + 0.7 * R('score', 'level', i * 1000 + j)), vary: 0.6,
      pan: panOf(c.pts[Math.min(c.pts.length - 1, Math.round(u * (c.pts.length - 1)))]),
    })));
  });
  Pc.PARTS.forEach((p, i) => pairs.push([Pc.LIFT + p.delay, { ...Sd.breath(1500 + 600 * R('lift', 'colour', i), 0.06, 0.3, 0.08), velocity: Math.min(1, 0.35 + p.high / 22), vary: 0.5, pan: (i - 1.5) * 0.15 }]));
  for (let j = 0; j < 16; j++) pairs.push([Pc.FOLD + 0.18 * (j / 16) ** 1.4, { ...Sd.snap(1500 + 2500 * R('crease', 'colour', j), 0.003 + 0.006 * R('crease', 'length', j), 0.2), velocity: 0.3 + 0.7 * R('crease', 'level', j), vary: 0.7, pan: -0.15 }]);
  pairs.push([Pc.FOLD, { ...Sd.knock(500, 98, 0.1), velocity: 0.7, vary: 0.4, pan: -0.15 }]);
  Pc.TEARS.forEach(([a, b], k) => {
    const smooth = (u) => u * u * (3 - 2 * u);
    pairs.push(...Sd.along(a, b, 110, smooth, (u, speed, j) => ({
      ...Sd.snap((900 + 2400 * R('rip', 'colour', k * 200 + j)) * (k ? 1.15 : 1), 0.003 + 0.007 * R('rip', 'length', k * 200 + j), 0.4), velocity: Math.min(1, 0.2 + 0.5 * speed) * (0.35 + 0.65 * R('rip', 'level', k * 200 + j) ** 1.5), vary: 0.7, pan: -0.8 + 1.6 * u,
    })));
    pairs.push(...Sd.along(a, b, 14, smooth, (u, speed, j) => ({
      ...Sd.breath((800 + 600 * R('rasp', 'colour', k * 20 + j)) * (k ? 1.15 : 1), 0.02, 0.1, 0.12), velocity: Math.min(1, 0.15 + 0.5 * speed), vary: 0.6, pan: -0.8 + 1.6 * u,
    })));
  });
  pairs.push(...Sd.swell(R, 'spread', Pc.SPREAD - 0.15, 1.5, (u) => 700 + 1000 * Math.sin(Math.PI * u), 0.035, 0.45));
  for (let j = 0; j < 3; j++) pairs.push([7.85 + 0.22 * j + 0.05 * R('stack', 'at', j), { ...Sd.knock(900, Sd.hertz(50 + 2 * j), 0.08), velocity: 0.8 - 0.2 * j, vary: 0.5, pan: (j - 1) * 0.3 }]);
  Sd.mix(ctx, R, Sd.place(ctx, R, 'fold', pairs, end), { level: 3.5 });
}

/**
 * While the shot is scrolled: the cut paper at rest, its strips and layers
 * settling, a rustle now and then, a crisp tick of paper far off, and
 * seldom a soft pat of a strip settling onto another.
 */
sound.ambience = Sd.ambience('fold air', (R, loop) => [
  ...Sd.scatter(R, 'rustle', loop, 2.4, (j, swell) => ({
    ...Sd.breath(1300 + 1800 * R('rustle', 'colour', j), 0.03, 0.12 + 0.2 * R('rustle', 'length', j), 0.06),
    velocity: swell * (0.3 + 0.7 * R('rustle', 'level', j)), vary: 0.6, pan: 1.4 * (R('rustle', 'pan', j) - 0.5), distance: 0.2 + 0.5 * R('rustle', 'far', j),
  })),
  ...Sd.scatter(R, 'tick', loop, 0.8, (j, swell) => ({
    ...Sd.snap(1800 + 3200 * R('tick', 'colour', j), 0.002 + 0.005 * R('tick', 'length', j), 0.14),
    velocity: swell * (0.1 + 0.9 * R('tick', 'level', j) ** 2), vary: 0.7, pan: 1.6 * (R('tick', 'pan', j) - 0.5), distance: 0.4 + 0.5 * R('tick', 'far', j),
  })),
  ...Sd.scatter(R, 'pat', loop, 5, (j, swell) => ({
    ...Sd.knock(800 + 500 * R('pat', 'colour', j), 100 + 60 * R('pat', 'body', j), 0.05), velocity: swell * (0.3 + 0.6 * R('pat', 'level', j)), vary: 0.6, pan: 1.2 * (R('pat', 'pan', j) - 0.5), distance: 0.5,
  })),
]);

module.exports = {
  name: 'site-fold',
  size: { w: P.W, h: P.H },
  seed: 1,
  time: { duration: 10, hz: 30 },
  params: E.PARAMS,
  build: Fd.BUILD,
  draw: Fd.frame,
  sound,
};
