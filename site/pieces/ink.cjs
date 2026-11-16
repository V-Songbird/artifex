// Shot 1, solved, not traced: the brush takes up the ink blooming in the water
// and lays strokes of that one ink along the water's current, wide pale washes
// first and narrow dark strokes last. Every stroke is walked through the same
// field the plumes follow; nothing is traced.
//
// It begins where the bloom seam ends: the same sheet, the ink in the water as
// it stood, and the brush coming down at the fronts of the longest plumes.
//
// WHAT STAYS IS KEPT. Once a stroke has soaked in it no longer changes, so the
// soaked strokes are drawn onto kept copies of the sheet, one count at a time
// (see held.js `upTo`), and a frame draws the sheet, the strokes still wet, the
// light on the water and on the wet ink, and the brush's shadow.
//
// Looks to leave out: those of the intro and the bloom, above all the ink ones:
// flat single-tone ribbons with a dark outline, hues anywhere on the wheel,
// blunt square touchdowns, white stripes for gloss, no bleed into the ground;
// and, from the skill, a flow field around a focus that turns botanical: the
// strokes follow a current with inertia, and the focus sets only their size.

'use strict';

const { upTo } = require('./held.js');
const P = require('./paper.js');
const M = require('./wordmark.js');
const Wt = require('./water.js');
const B = require('./brush.js');
const Sd = require('./sounds.js');
const { rng } = require('../../core/rand.js');

// The water's own clock: this shot starts where the bloom seam, 3.5 s long, ends.
const WATER = 3.5;
const WORD = M.DURATION + WATER;

/** The sheet as the bloom seam left it: paper, letters, wet paper, the pale line and the ink in the water. */
function sheet(g, s) {
  P.ground(g, s);
  M.drawWord(g, s, WORD, s.lines.slice(0, -1));
  Wt.drawWet(g, s, Wt.SWEPT);
  Wt.drawLine(g, s, WATER, WORD);
  Wt.drawPlumes(g, s, WATER);
}

/** Every kind of mark the shot makes, drawn once where the kept sheet covers it. */
function prime(g, s) {
  const sec = (s.strokes[0].t0 + s.strokes[0].t1) / 2;
  B.drawStrokes(g, s, [0, s.strokes.length - 1], sec);
  B.drawStrokes(g, s, [s.strokes.length - 1], Infinity);
  B.drawGloss(g, s, [0], sec, Wt.sheenOf(g, s, WATER + sec, 2.2));
  Wt.drawSheen(g, s, WATER + sec);
  B.drawBrushShadow(g, s, sec);
}

/**
 * Heard: the brush laying each stroke. It touches down with a soft press and
 * drags its bristles along the current, coarse and low while the washes are
 * wide, fine and bright as the strokes narrow and darken, and under each wide
 * wash the water takes the ink with a slow dark swell. No two strokes alike.
 */
function sound(ctx, s) {
  const R = rng(s.seed), end = ctx.length / ctx.sampleRate, pairs = [];
  const widest = Math.max(...s.strokes.map((k) => Math.max(...k.w)));
  s.strokes.forEach((k, i) => {
    const wide = Math.max(...k.w) / widest, x0 = k.pts[0][0], x1 = k.pts[k.pts.length - 1][0];
    const far = 0.05 + 0.3 * R('stroke', 'far', i);
    // The touchdown: a soft press, lower and fuller the wider the brush is spread.
    pairs.push([k.t0, {
      ...Sd.snap(300 + 500 * (1 - wide) + 200 * R('touch', 'colour', i), 0.02 + 0.03 * wide, 0.3),
      velocity: 0.35 + 0.55 * wide * R('touch', 'level', i), vary: 0.6, pan: Sd.panX(x0), distance: far,
    }]);
    // The bristles along the stroke, thick while it moves fast.
    // Few enough that the stage builds the whole soundtrack between two frames while the film plays.
    pairs.push(...Sd.along(k.t0, k.t1, Math.round(4 + 7 * wide), (u) => u * u * (3 - 2 * u), (u, speed, j) => ({
      ...Sd.snap((1400 + 2400 * (1 - wide)) * (0.7 + 0.6 * R('bristle', 'colour', i * 100 + j)), 0.003 + 0.006 * R('bristle', 'length', i * 100 + j), 0.22),
      velocity: Math.min(1, 0.2 + 0.5 * speed) * (0.3 + 0.7 * wide) * (0.5 + 0.5 * R('bristle', 'level', i * 100 + j)), vary: 0.7, pan: Sd.panX(x0 + (x1 - x0) * u), distance: far,
    })));
    // Under a wide wash the water takes the ink.
    if (wide > 0.45) {
      pairs.push(...Sd.placed(Sd.swell(R, 'take ' + i, k.t0, Math.min(1.2, k.t1 - k.t0 + 0.5), (u) => (220 + 140 * R('take', 'colour', i)) * (1 + 1.2 * Math.sin(Math.PI * u)), 0.06 * wide),
        { pan: Sd.panX((x0 + x1) / 2), distance: 0.3 + far }));
    }
  });
  Sd.mix(ctx, R, Sd.place(ctx, R, 'ink', pairs, end), { level: 6 });
}

/**
 * While the shot is scrolled: wet ink on wet paper. A fine tick where a
 * stroke's edge dries, a drop letting go now and then, and at times a slow
 * dark swell where the ink still spreads, far off.
 */
sound.ambience = Sd.ambience('ink air', (R, loop) => [
  ...Sd.scatter(R, 'dry', loop, 0.6, (j, swell) => ({
    ...Sd.snap(1700 + 2300 * R('dry', 'colour', j), 0.003 + 0.004 * R('dry', 'length', j), 0.14),
    velocity: swell * (0.15 + 0.85 * R('dry', 'level', j) ** 2), vary: 0.8, pan: 1.6 * (R('dry', 'pan', j) - 0.5), distance: 0.2 + 0.7 * R('dry', 'far', j),
  })),
  ...Sd.scatter(R, 'bead', loop, 2.8, (j, swell) => ({
    ...Sd.drop(700 + 700 * R('bead', 'pitch', j), 0.03, 500, 0.05), velocity: swell * (0.3 + 0.7 * R('bead', 'level', j)), vary: 0.6, pan: 1.4 * (R('bead', 'pan', j) - 0.5), distance: 0.4 + 0.5 * R('bead', 'far', j),
  })),
  ...Sd.scatter(R, 'creep', loop, 5, (j, swell) => swell).flatMap(([at, swell], j) => Sd.placed(
    Sd.swell(R, 'creep ' + j, at, 1.6, (u) => (210 + 150 * R('creep', 'colour', j)) * (1 + 1.4 * Math.sin(Math.PI * u)), 0.035 * swell * (0.4 + 0.6 * R('creep', 'level', j))),
    { pan: 1.2 * (R('creep', 'pan', j) - 0.5), distance: 0.5 })),
]);

module.exports = {
  name: 'site-ink',
  size: { w: P.W, h: P.H },
  seed: 1,
  time: { duration: 6, hz: 30 },
  params: {
    strokes: { min: 12, max: 44, value: 30, meaning: 'how many strokes the brush lays' },
    reach: { min: 160, max: 620, value: 380, meaning: 'how far a stroke travels along the current, in design units' },
    load: { min: 0.5, max: 1.3, value: 1, meaning: 'how dark the ink is: under 1 the brush is let down with water' },
  },
  build: [
    ['lay the paper', P.lay],
    ['plot the wordmark', M.plot],
    ['wet the sheet', Wt.soak],
    ['paint', B.paint],
  ],
  sound,
  draw(g, s, t, clock) {
    const sec = clock.seconds;
    const k = B.settled(s, sec);
    upTo(g, s, 'ink', k, sheet, (cg, cs, i) => B.drawStrokes(cg, cs, [i], Infinity), prime, s.strokes.length);
    const wet = [];
    for (let i = k; i < s.strokes.length && s.strokes[i].t0 <= sec; i++) wet.push(i);
    B.drawStrokes(g, s, wet, sec);
    // The light on the water, then brighter on the ink still wet.
    Wt.drawSheen(g, s, WATER + sec);
    B.drawGloss(g, s, wet, sec, Wt.sheenOf(g, s, WATER + sec, 2.2));
    B.drawBrushShadow(g, s, sec);
  },
};

