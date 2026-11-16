// Seam 5 to 6, the box closes into an envelope. It begins on the box shot's
// last frame, at the box the visitor has: the framed box on the table, the
// pile at rest in it. The backing paper slides out from under the frame, a
// side at a time, and folds up and over it: the two long sides, the foot with
// the label on its outer face, then the pointed flap at the head. Closed, it
// is an envelope lying on the table, and the camera begins to draw back (see
// envelope.js).
//
// Beats, in seconds:
//   0.0-0.5   the pile at rest, as the box shot left it
//   0.5-2.9   the two long sides slide out and fold over
//   2.6-4.1   the foot slides out and folds up, the label on it
//   3.8-5.3   the pointed flap slides out and folds down
//   4.9-7.0   the camera draws back, still moving at the last frame
//
// Looks to leave out:
// - a flap that appears or fades in: each comes out from under the frame's edge;
// - a cut from box to envelope: the frame is under the paper, and stays there;
// - a still ending: the camera and the light move to the last frame.

'use strict';

const P = require('./paper.js');
const En = require('./envelope.js');

module.exports = {
  name: 'site-close',
  size: { w: P.W, h: P.H },
  boxes: { w: [400, 2400], h: [400, 2800] },
  seed: 1,
  time: { duration: En.CLOSE, hz: 30 },
  build: En.BUILD,
  draw(g, s, t, clock) {
    En.frame(g, s, clock.seconds);
  },
  // Heard: the paper sliding out, folding over and landing, a side at a time (see envelope.js).
  sound: En.heard(0, En.CLOSE, 4.7),
};
