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

const { hold } = require('./held.js');
const P = require('./paper.js');
const M = require('./wordmark.js');
const Wt = require('./water.js');

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
};
