// Seam 0 to 1: a wide brush of clean water passes across the sheet, low enough
// to leave the wordmark dry and wet the last line while its ink is still
// fresh. The ink blooms out of the line into the water along its current, and
// that current is the flow field the next shot's brush paints in.
//
// It begins where the intro ends: the same paper, the same wordmark, one frame
// later in the ink's own time, the plotter parked off the sheet.
//
// WHAT STAYS IS KEPT. The paper and the letters no longer change here, and once
// the brush has gone neither does the wet paper; each is drawn once per canvas
// and put back (see held.js), so a frame draws only what moves: the brush, the
// line giving up its ink, the sheen on the water and the ink blooming in it.
//
// Looks to leave out: those of the intro (see intro.cjs), and
// - water drawn as a blue shape: water shows only by darker paper, a tide line
//   and the light it reflects;
// - ink that fades up in place: every plume runs out of the line and arrives;
// - a lull: some of the line holds its ink a moment longer, so blooms keep
//   breaking out while the first ones spread.

'use strict';

const { rng } = require('../../core/rand.js');
const { hold } = require('./held.js');
const P = require('./paper.js');
const M = require('./wordmark.js');
const Wt = require('./water.js');
const Sd = require('./sounds.js');

/**
 * Heard: the wide brush's bristles dragging water across the paper, a wet
 * swish of overlapping strokes left to right with it, heaviest mid-sheet,
 * with the water's fine crackle at its tips; the sheet of water it leaves;
 * and each plume of ink letting go into the water as a soft dark swell of
 * water, placed where it lets go and as full as its load, the late ones
 * further off. No pitch: water and paper have none.
 */
function sound(ctx, s) {
  const R = rng(s.seed), end = ctx.length / ctx.sampleRate;
  const press = (u) => Math.max(0, Math.sin(Math.PI * u)) ** 0.7;
  const brush = Sd.along(Wt.SWEEP_AT, Wt.SWEEP_AT + Wt.SWEEP, 40, (u) => u, (u, speed, j) => ({
    ...Sd.breath(520 + 1300 * R('swish', 'colour', j), 0.03, 0.09 + 0.1 * R('swish', 'length', j), 0.16),
    velocity: 0.15 + 0.85 * press(u) * (0.55 + 0.45 * R('swish', 'level', j)), vary: 0.7, pan: Sd.panX(Wt.head(Wt.SWEEP_AT + u * Wt.SWEEP)),
  }));
  const tips = Sd.along(Wt.SWEEP_AT, Wt.SWEEP_AT + Wt.SWEEP, 70, (u) => u, (u, speed, j) => ({
    ...Sd.snap(1600 + 2600 * R('tip', 'colour', j), 0.003 + 0.006 * R('tip', 'length', j), 0.3),
    velocity: 0.1 + 0.6 * press(u) * R('tip', 'level', j) ** 1.5, vary: 0.7, pan: Sd.panX(Wt.head(Wt.SWEEP_AT + u * Wt.SWEEP)), distance: 0.2 * R('tip', 'far', j),
  }));
  const wash = Sd.swell(R, 'wash', Wt.SWEEP_AT, 1.4, (u) => 600 + 1400 * Math.sin(Math.PI * u), 0.05, 0.35);
  // Each plume a slow dark swell of water, opening as it lets go and closing as it spreads.
  // The heaviest plumes full and near, the lightest a breath: their loads span about 20 dB.
  // Each opens quickly and closes slowly; the late ones, alone after the brush, a little nearer.
  const blooms = s.plumes.flatMap((p, i) => Sd.placed(Sd.swell(R, 'bloom ' + i, p.touch, 0.3 + 0.4 * p.load, (u) => (200 + 160 * R('bloom', 'colour', i)) * (1 + 1.5 * Math.min(1, p.load) * Math.sin(Math.PI * u)),
    0.1 * Math.max(0.1, (p.load - 0.5) / 0.5) ** 1.5, 0.15 + 0.15 * p.spread), { sweep: [[0, 1400]], pan: Sd.panX(p.pts[0][0]), distance: (p.touch > Wt.SWEPT ? 0.05 : 0.25) + 0.45 * R('bloom', 'far', i) }));
  Sd.mix(ctx, R, [...Sd.place(ctx, R, 'bristle', brush, end), ...Sd.place(ctx, R, 'tip', tips, end), ...Sd.place(ctx, R, 'wash', wash, end), ...Sd.place(ctx, R, 'bloom', blooms, end)], { level: 3.8 });
}

/**
 * While the shot is scrolled: the wet sheet settling, a fine crackle of
 * water in the paper here and there, a drop letting go now and then, and
 * at times a slow dark swell where the ink spreads further, far off.
 */
sound.ambience = Sd.ambience('bloom air', (R, loop) => [
  ...Sd.scatter(R, 'soak', loop, 0.45, (j, swell) => ({
    ...Sd.snap(1500 + 2500 * R('soak', 'colour', j), 0.003 + 0.005 * R('soak', 'length', j), 0.16),
    velocity: swell * (0.15 + 0.85 * R('soak', 'level', j) ** 2), vary: 0.8, pan: 1.6 * (R('soak', 'pan', j) - 0.5), distance: 0.2 + 0.7 * R('soak', 'far', j),
  })),
  ...Sd.scatter(R, 'drop', loop, 2.2, (j, swell) => ({
    ...Sd.drop(900 + 900 * R('drop', 'pitch', j), 0.03, 500, 0.06), velocity: swell * (0.3 + 0.7 * R('drop', 'level', j)), vary: 0.6, pan: 1.4 * (R('drop', 'pan', j) - 0.5), distance: 0.4 + 0.5 * R('drop', 'far', j),
  })),
  ...Sd.scatter(R, 'spread', loop, 4.5, (j, swell) => swell).flatMap(([at, swell], j) => Sd.placed(
    Sd.swell(R, 'spread ' + j, at, 1.6, (u) => (240 + 160 * R('spread', 'colour', j)) * (1 + 1.6 * Math.sin(Math.PI * u)), 0.035 * swell * (0.4 + 0.6 * R('spread', 'level', j))),
    { pan: 1.2 * (R('spread', 'pan', j) - 0.5), distance: 0.5 })),
]);

const letters = (s) => s.lines.slice(0, -1);

/** The paper and the finished letters. */
function sheet(g, s) {
  P.ground(g, s);
  M.drawWord(g, s, M.DURATION, letters(s));
}

/** The same once the brush has gone: the wet paper and the line's halo in it. */
function soaked(g, s) {
  sheet(g, s);
  Wt.drawWet(g, s, Wt.SWEPT);
}

/** Every kind of mark the seam makes, drawn once where the kept sheet covers it. */
function prime(g, s) {
  const sec = 0.9;
  Wt.drawWet(g, s, sec);
  Wt.drawSheen(g, s, sec);
  Wt.drawLine(g, s, sec, M.DURATION + sec);
  Wt.drawPlumes(g, s, sec);
  Wt.drawBrush(g, s, sec);
}

module.exports = {
  name: 'site-bloom',
  size: { w: P.W, h: P.H },
  seed: 1,
  time: { duration: 3.5, hz: 30 },
  build: [
    ['lay the paper', P.lay],
    ['plot the wordmark', M.plot],
    ['wet the sheet', Wt.soak],
  ],
  draw(g, s, t, clock) {
    const sec = clock.seconds;
    // Both kept sheets are made on the first frame a canvas draws.
    hold(g, s, 'soaked', soaked, prime);
    if (sec < Wt.SWEPT) {
      hold(g, s, 'sheet', sheet);
      Wt.drawWet(g, s, sec);
    }
    Wt.drawLine(g, s, sec, M.DURATION + sec);
    Wt.drawPlumes(g, s, sec);
    // The water's surface reflects the light over the ink in it.
    Wt.drawSheen(g, s, sec);
    Wt.drawBrush(g, s, sec);
  },
  sound,
};
