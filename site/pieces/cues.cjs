// Shot 4a, authored motion. It begins where the forms came unstuck: every
// form loose on the painting, the long lines sliding into a staff. On written
// cues the rest take their places round it, the big forms as a band that plays
// a phrase, each heard as it lands, hops or turns, and the small round forms
// line up under the staff as the notes the reading will call (see score.js).
// Nothing here is simulated: every move is a cue someone wrote, and the
// picture and the sound read the one table.
//
// Beats, in seconds:
//   0.0-1.2    the last lines slide into the staff, each a low string
//   0.7-4.2    the band takes its places, two by two on the beat; the rainbow comes as one
//   3.6-6.0    the band's phrase: drums, mallets, the rainbow rocking
//   6.0-8.0    the notes line up under the staff
//
// Looks to leave out:
// - a form that jumps: each slides, eased, and lands;
// - a still ending: the notes and the light move to the last frame.

'use strict';

const P = require('./paper.js');
const Sk = require('./score.js');
const V = require('./voices.js');

const DUR = 8, START = Sk.starts(7 * 30)[1];    // this shot's place in the score: on the seam's last frame

function draw(g, s, t, clock) {
  Sk.draw(g, s, START + clock.seconds, Sk.camera(s, START + clock.seconds));
}

/** Heard: every form as it lands, hops or turns on its cue (see voices.js). */
function sound(ctx, s) {
  V.play(ctx, s, Sk.events(s), START, DUR - 1 / 30, Sk.stage(s).c[0]);
}

module.exports = {
  name: 'site-cues',
  size: { w: P.W, h: P.H },
  seed: 1,
  time: { duration: DUR, hz: 30 },
  build: Sk.build,
  draw,
  sound,
};
