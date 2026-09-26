// Shot 4b, a data reading. It begins where the band's phrase ended: the
// notes waiting in a row under the staff, the cursor raised at its start. The
// cursor runs along the staff, and as it reaches each place the next note
// hops up onto the staff at the height its digit gives: the first nineteen
// digits of pi, each heard as its degree of the scale (see score.js). The
// data decides the melody; the seed decides only which form plays which
// note. The reading ends on the staff's chord, its lines trembling.
//
// Beats, in seconds:
//   0.0-0.6    the cursor comes down onto the staff
//   0.6-5.7    the reading: nineteen notes, one on each digit
//   5.7-7.0    the cursor knocks the end bar; the staff's chord, its lines trembling
//
// Looks to leave out:
// - a note that appears: each hops up from the row where it waited;
// - a still ending: the lines tremble to the last frame.

'use strict';

const P = require('./paper.js');
const Sk = require('./score.js');
const V = require('./voices.js');

const DUR = 7, START = Sk.starts(7 * 30, 8 * 30)[2];    // this shot's place in the score: on the last frame of the one before

function draw(g, s, t, clock) {
  Sk.draw(g, s, START + clock.seconds, Sk.camera(s, START + clock.seconds));
}

/** Heard: each digit as its note, the cursor's knock and the staff's chord (see voices.js). */
function sound(ctx, s) {
  V.play(ctx, s, Sk.events(s), START, DUR - 1 / 30, Sk.stage(s).c[0]);
}

module.exports = {
  name: 'site-readout',
  size: { w: P.W, h: P.H },
  seed: 1,
  time: { duration: DUR, hz: 30 },
  build: Sk.build,
  draw,
  sound,
};
