// Shot 6, take it home. It begins on the close seam's last frame: the
// envelope closed on the table, the camera drawing back. The camera comes to
// rest with the envelope whole among the framed works, and the plotter from
// the intro comes back, seen by its shadow, and writes the recipe on the
// label: the name, the seed and the box. What it writes is the state's own
// (see envelope.js), so the label names the piece the visitor takes away.
//
// Beats, in seconds:
//   0.0-1.4   the camera finishes drawing back
//   1.1-1.8   the gantry comes in from the left
//   1.8-5.6   the pen writes the three lines of the recipe
//   5.6-6.3   the gantry leaves to the left
//   6.3-8.0   the envelope at rest, the light still turning
//
// Looks to leave out:
// - text that fades in or is set in type: every letter is drawn at the pen;
// - a recipe that is not the piece's: the label reads the solved state.

'use strict';

const P = require('./paper.js');
const En = require('./envelope.js');

module.exports = {
  name: 'site-home',
  size: { w: P.W, h: P.H },
  boxes: { w: [400, 2400], h: [400, 2800] },
  seed: 1,
  time: { duration: En.HOME, hz: 30 },
  build: En.BUILD,
  draw(g, s, t, clock) {
    En.frame(g, s, En.CLOSE - 1 / 30 + clock.seconds);
  },
  // Heard: the gantry's breath and the pen on the label (see envelope.js).
  sound: En.heard(En.CLOSE - 1 / 30, En.HOME, 8.6),
};
