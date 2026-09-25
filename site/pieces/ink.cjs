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

