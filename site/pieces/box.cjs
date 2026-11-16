// Shot 5, any box. It begins on the contain seam's last frame: the frame's two
// sides closing in on the pile, the table showing either side. The sides come
// to rest; then the box takes the shape of the visitor's window, or of the
// container they drag: its sides slide out, or on in, until the window of the
// box has the box's proportions, the pile slumps into the room it is given or
// rises in the room it is left, and the camera draws back until the whole
// frame sits in the box, a strip of the table and the hang round it. A wide
// box ends on a low, open chord; a narrow one on a high, close one.
//
// The box is the piece's own (`boxes`, through atBox): the stage solves it
// for the box it shows, so a box is a recipe like a seed. What lies beyond
// the old picture's edges in a box of another shape is the table, and the
// page's own margins, which framed the picture until then, slide off it.
//
// Beats, in seconds:
//   0.0-0.6    the sides finish closing, as the contain seam left them
//   0.8-2.0    the page's margins slide off the table to the window's edges
//   0.9-3.2    the camera draws back to the whole frame
//   1.0-2.8    the sides move to the box's proportions; the pile slumps or rises
//   3.3-6.0    it comes to rest, and its chord rises, voiced by the box's width
//
// Heard: what the contain seam left ringing, the sides' creak as they move,
// the pile's strikes as it slumps, the box's hollow ring as the sides stop,
// and the chord.
//
// Looks to leave out:
// - a jump at the join: the first frame is the seam's last, the old picture's
//   margins included;
// - a form pushed through another or left standing in air: the sides are
//   walls of the fall, and every form wakes as they begin to move;
// - a still ending: the camera and the light move to the last frame.

'use strict';

const P = require('./paper.js');
const Sk = require('./score.js');
const V = require('./voices.js');
const Bx = require('./boxed.js');

const { START, DUR, OPEN, CHORD, CLOSED, WIDEST, NARROWEST, ROOT, DEGREES } = Bx;

/**
 * Heard: what the contain seam left ringing, the sides' creak as they move to
 * the box, the pile's strikes as it slumps or rises, the box's hollow ring as
 * the sides stop, and the chord of the pile at rest, low and open in a wide
 * box, high and close in a narrow one (see voices.js). It fades at its end:
 * the shot after it is silent.
 */
function sound(ctx, s) {
  const board = s.skins[0], more = [], move = Math.abs(s.target - CLOSED);
  if (move > 4) {
    for (let j = 0; j < 14; j++) {
      const u = (j + 0.5) / 14;
      more.push({ at: START + OPEN[0] + (OPEN[1] - OPEN[0]) * u, kind: 'creak', skin: board, note: 38 + (j * 5) % 4, velocity: Math.min(1, 0.2 + move / 250) * (0.3 + 0.7 * Math.sin(Math.PI * u)), pan: j % 2 ? 0.6 : -0.6 });
    }
    more.push({ at: START + OPEN[1] - 0.1, kind: 'hollow', skin: board, note: s.target < CLOSED ? 43 : 50, velocity: 0.6 });
  }
  const wide = (NARROWEST - s.target) / (NARROWEST - WIDEST), spread = 1 + Math.round(2 * wide), base = wide < 0.5 ? ROOT : ROOT - 12;
  [0, 1, 2, 3].forEach((j) => more.push({ at: START + CHORD + j * 0.18, kind: 'rest', skin: board, note: base + DEGREES[j * spread], velocity: 0.55 - j * 0.05 }));
  const events = Sk.events(s).concat(more).sort((a, b) => a.at - b.at);
  V.play(ctx, s, events, START, DUR, Sk.stage(s).c[0], 0.25);
}

// Scrolled, the shot sounds the table the painting lies on (see voices.js air).
sound.ambience = V.air;

module.exports = {
  name: 'site-box',
  size: { w: P.W, h: P.H },
  boxes: { w: [400, 2400], h: [400, 2800] },
  seed: 1,
  time: { duration: DUR, hz: 30 },
  build: [['the score, as the contain seam left it', Bx.score], ['fit the box', Bx.refit]],
  draw: Bx.draw,
  sound,
};
