// Shot 0, the intro: on a bare sheet of drawing paper, a plotter pen writes the
// name one line at a time, then draws one last line under it. That line is
// still wet when the next shot begins.
//
// Looks to leave out (the skill's defaults, then the owner's):
// - one noise family at every scale: the paper's formation, its tooth and the
//   ink's feathers each have their own address;
// - a grain pass over the finished frame: texture belongs to the paper and the ink;
// - a line that fades up: the pen travels, and arc length is what grows;
// - a flow field around a focus that turns botanical;
// - ink that reads as flat single-tone ribbons with a dark outline, hues picked
//   anywhere on the wheel, blunt square touchdowns, white stripes for gloss, no
//   bleed into the ground;
// - a dead background: the light spans the sheet and the ink keeps moving in it.

'use strict';

const { hold } = require('./held.js');
const P = require('./paper.js');
const M = require('./wordmark.js');

module.exports = {
  name: 'site-intro',
  size: { w: P.W, h: P.H },
  seed: 1,
  time: { duration: M.DURATION, hz: 30 },
  build: [
    ['lay the paper', P.lay],
    ['plot the wordmark', M.plot],
  ],
  draw(g, s, t, clock) {
    // Primed with a frame near the end, where every kind of mark is on the sheet.
    hold(g, s, 'paper', P.ground, (pg, ps) => M.drawWord(pg, ps, M.FINISH - 0.2));
    M.drawWord(g, s, clock.seconds);
  },
};
