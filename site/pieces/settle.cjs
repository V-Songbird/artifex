// Shot 4c, a system of forces. It begins where the reading ended: the staff's
// chord, its lines trembling. The trembling shakes the forms loose: they let go
// of the painting, the staff's lines first, then the notes, then the band,
// and fall to the foot of the frame, where they strike, slide and pile, and
// come to rest (see fall.js). Nothing here is written: the fall is solved
// once, in the build, and a frame is a lookup into it, so scrolling back
// replays the same fall.
//
// Beats, in seconds:
//   0.0-0.25   the lines still tremble
//   0.25-0.8   the forms let go, one after another
//   0.4-4.5    they fall, strike and pile at the foot of the frame
//   4.5-6.0    the last settle
//
// Heard: each strike as its knock and a note, the smaller form's, as hard as it struck.
//
// Looks to leave out:
// - a form that passes through another: each is a body of capsules along its paint;
// - a still ending: the light turns and the last forms settle to the last frame.

'use strict';

const P = require('./paper.js');
const Sk = require('./score.js');
const Fl = require('./fall.js');
const V = require('./voices.js');

const DUR = 6, START = Sk.starts(7 * 30, 8 * 30, 7 * 30)[3];    // this shot's place in the score: on the last frame of the one before

function draw(g, s, t, clock) {
  Sk.draw(g, s, START + clock.seconds, Sk.camera(s, START + clock.seconds));
}

/** Heard: every strike of the fall (see voices.js). */
function sound(ctx, s) {
  V.play(ctx, s, Sk.events(s), START, DUR - 1 / 30, Sk.stage(s).c[0]);
}

module.exports = {
  name: 'site-settle',
  size: { w: P.W, h: P.H },
  seed: 1,
  time: { duration: DUR, hz: 30 },
  build: [...Sk.build, ['let them fall', (s) => Fl.fall(s, START + DUR)]],
  draw,
  sound,
};
