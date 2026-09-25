// Seam 3a, the doodle is traced square. It begins where the portal ends: the
// camera deep in one mirror's reflection of the notebook page, its ruled lines
// bent by the mirror. The mirror lets go of its bow and springs flat, so the
// page it shows straightens; a sheet of drafting film slides in over the
// doodle and settles; a T-square comes up to the branch and the pen rules it
// straight; then the pen inks the bird's outline in one clean line over the
// doodle's two wobbling ones, part by part, and lifts away.
//
// Beats, in seconds:
//   0.00-0.25  the portal's last view, held
//   0.25-1.8   the mirror springs flat: the rules straighten, pass straight and
//              settle; the mirror's rim swings out of the frame
//   0.9-2.4    the film slides in from the right and settles
//   1.8-2.6    the T-square comes up to the branch; the pen comes in
//   2.55-6.9   the branch ruled, the T-square leaves, the outline inked
//   6.9-8      the pen lifts and leaves, quicker as it goes, on into the print
//
// WHAT STAYS IS KEPT. Once the mirror has settled the page no longer moves: it
// is drawn once and put back. The film, the ink, the blade and the pen are a
// few paths a frame.
//
// Looks to leave out: those of the portal (see portal.cjs), and
// - a trace that fades in, or appears whole: every line is inked at the pen;
// - a film that is only a tint: it has an edge, a shadow and light on it;
// - the tracing wobbling like the doodle: one line, square.

'use strict';

const { keep } = require('./held.js');
const { spring } = require('../../core/time.js');
const P = require('./paper.js');
const E = require('./enter.js');
const Dr = require('./draft.js');

const PAPER = '#fbfaf4';                                  // the notebook page's (page.js)
const LET_GO = 0.25;                                       // the mirror lets go of its bow
const release = spring({ stiffness: 90, damping: 0.5 });
const FILM = 0.9;                                           // the film is slid in
const slide = spring({ stiffness: 16, damping: 0.78 });

function draw(g, s, t, clock) {
  const sec = clock.seconds;
  const flat = (p) => Dr.apply(s.flat, p), k = Dr.scaleOf(s.flat);
  // Under it all, the paper; over it, once per canvas, every kind of mark to
  // come, which the page then covers (after the fill: a browser may drop what
  // an opaque fill of the whole canvas covers before drawing it).
  g.fillStyle = PAPER;
  g.fillRect(0, 0, P.W, P.H);
  Dr.prime(g, s);
  // The page, in the mirror letting go, then at rest: kept from the first
  // frame, which is drawn before the shot is on screen.
  const rest = keep(g, s, 'flat', (cg, cs) => E.released(cg, cs, 1, (p) => Dr.apply(cs.flat, p), Dr.scaleOf(cs.flat)));
  if (rest && sec - LET_GO >= release.settle) {
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(rest, 0, 0);
    g.restore();
  } else {
    E.released(g, s, sec > LET_GO ? release(sec - LET_GO) : 0, flat, k);
  }
  if (sec < FILM) return;
  const m = s.traced;
  g.save();
  g.transform(m.a, m.b, -m.b, m.a, m.x, m.y);
  Dr.drawFilm(g, s, s.filmFrom * (1 - slide(sec - FILM)), sec);
  Dr.drawInk(g, s, sec);
  Dr.drawBlade(g, s, Dr.bladeAt(s, sec));
  Dr.drawSquare(g, s, Dr.squareAt(s, sec));
  Dr.drawTemplate(g, s, Dr.templateAt(s, sec));
  g.restore();
  if (sec > Dr.INK_FROM - 0.9) Dr.drawPen(g, s, sec, m);
}

module.exports = {
  name: 'site-trace',
  size: { w: P.W, h: P.H },
  seed: 1,
  time: { duration: 10, hz: 30 },
  params: E.PARAMS,
  build: [...E.BUILD, ['draft the front view', Dr.draft]],
  draw,
};
