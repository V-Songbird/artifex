// Seam 2 to 3, the mirror is the portal. A page torn out of a school
// notebook, the catalog's bird doodled on it in blue ballpoint (see page.js),
// is slid in under a mirror, between the three bowed mirrors, and the
// kaleidoscope carries it into every reflection, as a kaleidoscope turns
// whatever is put in it into its pattern. Then the camera goes into one of the
// mirrors, past its glass, to that mirror's reflection of the page, until the
// doodle fills the frame: the ballpoint doodle the next shot begins with.
//
// It begins where the bend ends: the hyperbolic kaleidoscope, turning; the
// turn dies away.
//
// The picture is drawn by enter.js, which the shots after this one share to
// begin on its last frame.
//
// Looks to leave out: those of the bend (see bend.cjs), and
// - a doodle that appears: the page is slid in, and every reflection of it
//   comes in with it;
// - a zoom into a flat picture: the reflection the camera goes into is in a
//   curved mirror, and its ruled lines bend.

'use strict';

const P = require('./paper.js');
const E = require('./enter.js');

module.exports = {
  name: 'site-portal',
  size: { w: P.W, h: P.H },
  seed: 1,
  time: { duration: 7, hz: 30 },
  params: E.PARAMS,
  build: E.BUILD,
  draw(g, s, t, clock) {
    E.frame(g, s, clock.seconds);
  },
};
