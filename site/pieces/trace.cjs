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
const { rng } = require('../../core/rand.js');
const Sd = require('./sounds.js');
const P = require('./paper.js');
const E = require('./enter.js');
const Dr = require('./draft.js');

const PAPER = '#fbfaf4';                                  // the notebook page's (page.js)
const LET_GO = 0.25;                                       // the mirror lets go of its bow
const release = spring({ stiffness: 90, damping: 0.5 });
const FILM = 0.9;                                           // the film is slid in
const slide = spring({ stiffness: 16, damping: 0.78 });

/**
 * Heard: the mirror springing flat, a dull flex of its glass and creaks as
 * it swings through flat and settles; the drafting film drawn in over the
 * page from the right, a plastic hiss thickest while it slides fastest; the
 * T-square knocked against the branch and slid away, the set square and the
 * template set down for each line; and the pen, a tap as it touches down and
 * a fine dry scratch along every line, even against an edge and quickening
 * and easing freehand, each line a little apart, until it lifts.
 */
function sound(ctx, s) {
  const R = rng(s.seed), end = ctx.length / ctx.sampleRate, pairs = [];
  const x = (p) => Sd.panX(Dr.apply(s.traced, p)[0]);
  pairs.push([LET_GO, { ...Sd.knock(900, 150, 0.1), velocity: 0.8, vary: 0.4, distance: 0.25 }]);
  pairs.push(...Sd.placed(Sd.swell(R, 'spring', LET_GO, 0.7, (u) => 500 + 900 * (1 - u), 0.04, 0.2), { distance: 0.3 }));
  // Creaks as the glass swings through flat and back, each softer.
  for (let j = 0; j < 5; j++) {
    pairs.push([LET_GO + 0.05 + 0.3 * j + 0.04 * R('swing', 'at', j), {
      ...Sd.snap(400 + 700 * R('swing', 'colour', j), 0.02 + 0.03 * R('swing', 'length', j), 0.3), velocity: 0.8 * 0.6 ** j, vary: 0.6, pan: 0.4 * (R('swing', 'pan', j) - 0.5), distance: 0.3,
    }]);
  }
  pairs.push(...Sd.along(FILM, FILM + 1.6, 34, (u) => Math.min(1, slide(u * 1.6)), (u, speed, j) => ({
    ...Sd.breath(2600 + 2400 * R('film', 'colour', j), 0.02, 0.08 + 0.06 * R('film', 'length', j), 0.09), velocity: Math.min(1, 0.1 + 0.45 * speed) * (0.55 + 0.45 * R('film', 'level', j)), vary: 0.7, pan: 0.7 * (1 - u),
  })));
  const perch = s.ink[0], set = (at, colour, body, pan, level) => [at, { ...Sd.knock(colour, body, level), velocity: 0.7, vary: 0.6, pan }];
  pairs.push(set(perch.t0 - 0.3, 1500, 320, 0, 0.12));
  pairs.push([s.bladeOff, { ...Sd.breath(2400, 0.04, 0.4, 0.05), pan: -0.1 }]);
  [...s.square, ...s.template].forEach((k, i) => pairs.push(set(k.at + 0.18, 2000 + 1000 * R('set', 'colour', i), 600 + 250 * R('set', 'body', i), x(Array.isArray(k.pose) ? k.pose : [k.pose.x, k.pose.y]), 0.06)));
  s.ink.forEach((r, i) => {
    pairs.push([r.t0, { ...Sd.snap(4200, 0.004, 0.12), velocity: 0.6 + 0.3 * R('tap', 'level', i), vary: 0.5, pan: x(r.pts[0]) }]);
    // Each line its own pressure: some pressed harder, some lighter.
    const n = Math.max(3, Math.round(r.len / 5)), press = 0.6 + 0.4 * R('nib', 'press', i);
    pairs.push(...Sd.along(r.t0, r.t1, n, Dr.travel, (u, speed, j) => {
      const q = r.pts[Math.min(r.pts.length - 1, Math.round(u * (r.pts.length - 1)))];
      return { ...Sd.snap((r.ruled ? 3600 : 2800) + 2400 * R('nib', 'colour', i * 1000 + j), 0.004 + 0.008 * R('nib', 'length', i * 1000 + j), 0.22),
        velocity: press * (r.ruled ? 0.7 : Math.min(1, 0.25 + 0.55 * speed)) * (0.5 + 0.5 * R('nib', 'level', i * 1000 + j)), vary: 0.6, pan: x(q) };
    }));
  });
  pairs.push([s.inked + 0.04, { ...Sd.snap(3800, 0.003, 0.08), velocity: 0.5, vary: 0.5 }]);
  Sd.mix(ctx, R, Sd.place(ctx, R, 'trace', pairs, end), { level: 3.5 });
}

/**
 * While the shot is scrolled: a drafting table at rest, the film stirring
 * on the page now and then, a pen's faint tick or scratch far off, and
 * seldom an instrument set down somewhere in the room.
 */
sound.ambience = Sd.ambience('trace air', (R, loop) => [
  ...Sd.scatter(R, 'stir', loop, 2.6, (j, swell) => ({
    ...Sd.breath(2400 + 2200 * R('stir', 'colour', j), 0.04, 0.15 + 0.25 * R('stir', 'length', j), 0.05),
    velocity: swell * (0.3 + 0.7 * R('stir', 'level', j)), vary: 0.6, pan: 1.4 * (R('stir', 'pan', j) - 0.5), distance: 0.2 + 0.5 * R('stir', 'far', j),
  })),
  ...Sd.scatter(R, 'nib', loop, 0.9, (j, swell) => ({
    ...Sd.snap(2800 + 2800 * R('nib', 'colour', j), 0.003 + 0.007 * R('nib', 'length', j), 0.12),
    velocity: swell * (0.1 + 0.9 * R('nib', 'level', j) ** 2), vary: 0.7, pan: 1.2 * (R('nib', 'pan', j) - 0.5), distance: 0.5 + 0.5 * R('nib', 'far', j),
  })),
  ...Sd.scatter(R, 'set', loop, 5.5, (j, swell) => ({
    ...Sd.knock(1500 + 1500 * R('set', 'colour', j), 280 + 400 * R('set', 'body', j), 0.06), velocity: swell * (0.3 + 0.6 * R('set', 'level', j)), vary: 0.6, pan: 1.4 * (R('set', 'pan', j) - 0.5), distance: 0.6 + 0.3 * R('set', 'far', j),
  })),
], { level: 6.5 });

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
  sound,
};
