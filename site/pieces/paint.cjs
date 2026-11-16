// Seam 3a to 3b, the papercraft is painted over as impasto. It begins where
// the fold ends: the papercraft bird on its layers between the torn strips.
// A wide painting knife spreads a thick cream ground across it all in three
// sweeps, the middle one first, over the bird; the blue paper soaks up the
// oil, a dark stain spreading from each sweep's edge, and the layers show
// through the ground as relief. Then a brush lays the paint on thick in short
// dabs (see impasto.js): a dab at a time at first, then as a time-lapse; the
// swirling background, patch by patch round the bird's relief, then the bird
// part by part on top.
//
// Beats, in seconds:
//   0.0-0.4   the knife comes in, loaded
//   0.35-2.9  it spreads the ground: across the bird, above it, below it
//   2.4-3.0   the brush comes in
//   3.0-4.1   it lays the first dabs, one at a time
//   4.1-9.45  the time-lapse: the background patch by patch, then from about 8 s the bird
//   9.45-10   the brush leaves
//
// WHAT STAYS IS KEPT. The fold's last frame is drawn once and kept, with each
// sweep of the ground as it is laid; the dabs are kept in copies a batch at a
// time (see held.js upTo), so a frame draws only the sweep being laid, or the
// dabs laid since the last batch.
//
// Looks to leave out: those of the fold (see fold.cjs), and
// - paint that appears: the ground is spread by the knife, every dab by the brush;
// - flat fills: the ground carries its knife marks and ridges, and the dabs cover it;
// - a bird lost under the ground: its layers stay raised through it;
// - strokes that sit apart: each drags a little of the paint laid beside it.

'use strict';

const { upTo } = require('./held.js');
const { rng } = require('../../core/rand.js');
const Sd = require('./sounds.js');
const P = require('./paper.js');
const Dr = require('./draft.js');
const Im = require('./impasto.js');
const E = require('./enter.js');
const Fd = require('./folded.js');

const FOLDED = 299 / 30;                              // the fold's last frame

// Canvases that have met every kind of mark this seam makes, and a pixel to copy one into.
const primed = new WeakSet();
const sink = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1).getContext('2d') : null;

/**
 * Heard: the knife loaded with thick paste, spreading the ground in three
 * sweeps, each a low, wet scrape that presses in, carries and lifts, heard
 * the way it goes; then the brush, each of its first dabs a soft wet press
 * and drag, and the time-lapse a quickening patter of dabs, the background
 * lower and the bird's, at the end, brighter.
 */
function sound(ctx, s) {
  const R = rng(s.seed), end = ctx.length / ctx.sampleRate, pairs = [];
  const span = (Im.COAT[1] - Im.COAT[0]) / s.sweeps.length;
  s.sweeps.forEach((sw, i) => {
    const a = Im.COAT[0] + i * span, dir = i % 2 ? -1 : 1;
    pairs.push(...Sd.along(a, a + span, 70, (u) => u * u * (3 - 2 * u), (u, speed, j) => ({
      ...Sd.snap(480 + 620 * R('paste', 'colour', i * 100 + j), 0.035, 0.22), velocity: Math.min(1, 0.25 + 0.5 * speed) * (0.65 + 0.35 * R('paste', 'level', i * 100 + j)), vary: 0.6, pan: dir * (-0.7 + 1.4 * u),
    })));
    pairs.push([a, { ...Sd.breath(420, 0.2, span, 0.06), sweep: [[0, 300], [span / 2, 1100], [span, 350]], velocity: 0.9, pan: 0 }]);
  });
  // The first dabs, each heard; the time-lapse thinned to about forty a second.
  const slow = s.dabs.findIndex((d) => d.dur < 0.1), fast = s.dabs.length - slow, every = Math.max(1, Math.ceil(fast / (40 * (Im.DABS[1] - s.dabs[slow].t))));
  s.dabs.forEach((d, j) => {
    if (j >= slow && (j - slow) % every) return;
    const lapse = j >= slow, late = lapse ? (j - slow) / fast : 0;
    const pan = Math.max(-0.8, Math.min(0.8, (d.x - Im.CLOSE.c[0]) / 360));
    // Each dab is its material and no pitch: a press of noise, darker for the background and brighter as the bird is reached.
    pairs.push([d.t, {
      ...Sd.snap((lapse ? 900 + 1400 * late : 700) * (0.8 + 0.4 * R('dab', 'colour', j)), lapse ? 0.025 : 0.05, lapse ? 0.22 : 0.3), vary: 0.6,
      // A painter's phrasing: the patter swells and eases patch by patch, and grows as the bird is reached.
      velocity: (0.45 + 0.35 * R('dab', 'level', j)) * (lapse ? 0.7 + 0.3 * Math.sin((2 * Math.PI * (d.t - s.dabs[slow].t)) / 1.3) + 0.25 * late : 1),
      pan, distance: lapse ? 0.2 : 0,
    }]);
    // The first dabs drag: a breath of the brush for as long as each is laid.
    if (!lapse) pairs.push([d.t, { ...Sd.breath(800, 0.01, d.dur + 0.05, 0.15), velocity: 0.45 + 0.35 * R('dab', 'level', j), pan }]);
  });
  Sd.mix(ctx, R, Sd.place(ctx, R, 'paint', pairs, end), { level: 2.8 });
}

function draw(g, s, t, clock) {
  const sec = clock.seconds, m = Dr.shot(Im.CLOSE);
  const at = (fn) => (cg, cs, ...rest) => { cg.save(); cg.transform(m.a, m.b, -m.b, m.a, m.x, m.y); fn(cg, cs, ...rest); cg.restore(); };
  // Once per canvas, where the kept copies then cover it, every kind of mark
  // the seam makes; then a pixel of the canvas copied, so it is drawn now.
  if (g.canvas && typeof g.canvas === 'object' && !primed.has(g.canvas)) {
    primed.add(g.canvas);
    const d = s.dabs[40];
    at(() => {
      Im.drawSweep(g, s, 1, 1.4);
      Im.drawKnife(g, s, 1.4);
      Im.drawDabs(g, s, 0, 60);
      Im.drawDabs(g, s, 60, 70, d.t + 0.02);
      Im.drawBrush(g, s, d.t + 0.05);
    })(g, s);
    if (sink) sink.drawImage(g.canvas, 0, 0, 1, 1, 0, 0, 1, 1);
  }
  if (sec < Im.DABS[0]) {
    // The ground, a sweep at a time over the fold's last frame, kept as each is laid.
    const k = Im.sweepsBy(s, sec);
    upTo(g, s, 'grounded', k, (cg, cs) => Fd.frame(cg, cs, 1, { seconds: FOLDED }), at((cg, cs, i) => Im.drawSweep(cg, cs, i, Infinity)), null, s.sweeps.length);
    g.save();
    g.transform(m.a, m.b, -m.b, m.a, m.x, m.y);
    if (k < s.sweeps.length) Im.drawSweep(g, s, k, sec);
    Im.drawKnife(g, s, sec);
    Im.drawBrush(g, s, sec);
    g.restore();
    return;
  }
  const k = Im.batchesBy(s, sec), done = k ? s.batches[k - 1][1] : 0;
  upTo(g, s, 'painted', k, at(Im.drawGround), at((cg, cs, i) => Im.drawDabs(cg, cs, cs.batches[i][0], cs.batches[i][1])), null, s.batches.length);
  g.save();
  g.transform(m.a, m.b, -m.b, m.a, m.x, m.y);
  Im.drawDabs(g, s, done, Im.laid(s, sec), sec);
  Im.drawBrush(g, s, sec);
  g.restore();
}

/**
 * While the shot is scrolled: thick paint at rest. A dab settles here and
 * there with a soft low tap, a bristle lets go of the sheet with a fine tick,
 * and at times a slow dark swell, the paint giving under its own weight.
 */
sound.ambience = Sd.ambience('paint air', (R, loop) => [
  ...Sd.scatter(R, 'bristle', loop, 0.7, (j, swell) => ({
    ...Sd.snap(1800 + 2600 * R('bristle', 'colour', j), 0.003 + 0.004 * R('bristle', 'length', j), 0.1),
    velocity: swell * (0.15 + 0.85 * R('bristle', 'level', j) ** 2), vary: 0.8, pan: 1.6 * (R('bristle', 'pan', j) - 0.5), distance: 0.3 + 0.6 * R('bristle', 'far', j),
  })),
  ...Sd.scatter(R, 'dab', loop, 1.8, (j, swell) => ({
    ...Sd.snap(320 + 380 * R('dab', 'colour', j), 0.025 + 0.03 * R('dab', 'length', j), 0.22),
    velocity: swell * (0.3 + 0.7 * R('dab', 'level', j)), vary: 0.6, pan: 1.4 * (R('dab', 'pan', j) - 0.5), distance: 0.3 + 0.5 * R('dab', 'far', j),
  })),
  ...Sd.scatter(R, 'give', loop, 4.5, (j, swell) => swell).flatMap(([at, swell], j) => Sd.placed(
    Sd.swell(R, 'give ' + j, at, 1.6, (u) => (200 + 140 * R('give', 'colour', j)) * (1 + 1.2 * Math.sin(Math.PI * u)), 0.035 * swell * (0.4 + 0.6 * R('give', 'level', j))),
    { pan: 1.2 * (R('give', 'pan', j) - 0.5), distance: 0.5 })),
], { level: 9 });

module.exports = {
  name: 'site-paint',
  size: { w: P.W, h: P.H },
  seed: 1,
  time: { duration: 10, hz: 30 },
  params: E.PARAMS,
  build: [...Fd.BUILD, ['spread the ground', Im.coat], ['lay the dabs', Im.dabs]],
  draw,
  sound,
};
