// Seam 4 to 5, the container. It begins where the fall ends: the forms at
// rest in a pile at the foot of the frame. The mat's bevelled edge deepens,
// its four sides running back into the walls of a box, and the painting sinks
// to the box's back with everything lying on it, so the pile rests on the
// box's floor. Then the frame's two sides, moulding, mat and wall together,
// close in on the pile, which makes room as they push it, rising in the
// narrower box, and the table shows beyond them on either side, where the
// next shot's box can grow and shrink. The camera holds.
//
// Beats, in seconds:
//   0.0-0.4    the last forms settle
//   0.3-3.2    the bevel deepens into the box's walls; the painting sinks back
//   2.4-6.0    the sides close in and the pile makes room, still closing at the last frame
//
// Heard: the board creaking as it deepens, the box's hollow ringing, low, then
// the sides' creak on either side and the pile's strikes as it is pushed.
//
// Looks to leave out:
// - walls that appear: they grow out of the mat's bevel, from the window's edge;
// - a form pushed through another: the sides are walls of the fall (see fall.js);
// - a still ending: the sides and the light move to the last frame.

'use strict';

const { span, ease } = require('../../core/time.js');
const P = require('./paper.js');
const Sk = require('./score.js');
const Fl = require('./fall.js');
const V = require('./voices.js');

const DUR = 6, START = Sk.starts(7 * 30, 8 * 30, 7 * 30, 6 * 30)[4];    // this seam's place in the score: on the last frame of the one before
const DEEPEN = Sk.T.box.map((t) => t - START);

function draw(g, s, t, clock) {
  const sec = clock.seconds;
  Sk.draw(g, s, START + sec, Sk.camera(s, START + sec), ease.inOut(span(DEEPEN[0], DEEPEN[1], sec)));
}

/** Heard: the fall's last strikes, the board creaking as the box deepens and its hollow ring, then the sides closing and the pile pushed (see voices.js). */
function sound(ctx, s) {
  V.play(ctx, s, Sk.events(s), START, DUR, Sk.stage(s).c[0]);
}

module.exports = {
  name: 'site-contain',
  size: { w: P.W, h: P.H },
  seed: 1,
  time: { duration: DUR, hz: 30 },
  build: [...Sk.build, ['let them fall and make room', (s) => Fl.fall(s, START + DUR)]],
  draw,
  sound,
};
