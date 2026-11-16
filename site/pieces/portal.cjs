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

const { rng } = require('../../core/rand.js');
const P = require('./paper.js');
const E = require('./enter.js');
const Sd = require('./sounds.js');

/**
 * Heard: the kaleidoscope's ratchet going on from the bend, slowing as the
 * turn dies away; the page drawn in over the glass and paper, a dry hiss of
 * paper thickest while it slides fastest; and, as the camera goes into the
 * mirror, the air of the glass opening round it, a near rush and a far one
 * after it, with glints of the glass passing on either side.
 */
function sound(ctx, s) {
  const R = rng(s.seed), end = ctx.length / ctx.sampleRate, pairs = [];
  // The turn's angle through the seam, and each detent it passes after where the bend left it.
  for (let k = Math.floor(E.turnAt(0) / Sd.DETENT) + 1; ; k++) {
    const target = k * Sd.DETENT;
    let lo = 0, hi = end;
    if (E.turnAt(end) < target) break;
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (E.turnAt(mid) < target) lo = mid; else hi = mid; }
    const speed = (E.turnAt(hi + 0.01) - E.turnAt(hi)) / 0.01;
    pairs.push([hi, { ...Sd.detent(speed, k, R), pan: 0.1 + 0.1 * (R('detent', 'pan', k) - 0.5) }]);
  }
  const [a, b] = E.SLIDE, smooth = (u) => u * u * (3 - 2 * u);
  pairs.push(...Sd.along(a, b, 36, smooth, (u, speed, j) => ({
    ...Sd.breath(1300 + 1600 * R('slide', 'colour', j), 0.02, 0.07 + 0.07 * R('slide', 'length', j), 0.2),
    velocity: Math.min(1, 0.15 + 0.55 * speed) * (0.55 + 0.45 * R('slide', 'level', j)), vary: 0.7, pan: 0.6 * (1 - smooth(u)),
  })));
  // The air of the glass opening round the camera: a near rush, and a far one after it, each brightening as it grows.
  const [z0, z1] = E.ZOOM, rush = (name, at, colour, level, distance) => Sd.placed(Sd.swell(R, name, at, end - at - 0.3, (u) => colour * (1 + 4 * Math.sin(0.5 * Math.PI * u) ** 2), level, 0.75), { distance });
  pairs.push(...rush('rush', z0, 300, 0.05, 0.1), ...rush('far rush', z0 + 1.4, 520, 0.035, 0.5));
  for (let j = 0; j < 16; j++) {
    const u = (j + R('glint', 'at', j)) / 16;
    pairs.push([z0 + u * (z1 - z0 - 0.3), {
      ...Sd.snap(3600 + 3000 * R('glint', 'colour', j), 0.002 + 0.004 * R('glint', 'length', j), 0.12),
      velocity: (0.2 + 0.8 * u) * R('glint', 'level', j), vary: 0.7, pan: (j % 2 ? -1 : 1) * (0.3 + 0.5 * u), distance: 0.6 - 0.4 * u,
    }]);
  }
  Sd.mix(ctx, R, Sd.place(ctx, R, 'portal', pairs, end), { size: 1.8, send: 0.4, level: 3.5 });
}

/**
 * While the shot is scrolled: the kaleidoscope barely turning, a soft click
 * of its ratchet now and then, glints of its glass far off, and at times a
 * slow breath of air in the tube, a late one shortened so that it and its
 * room have died 3.4 s past the loop, within the ring the stage folds back.
 */
sound.ambience = Sd.ambience('portal air', (R, loop) => [
  ...Sd.scatter(R, 'tick', loop, 1.4, (j, swell) => ({ ...Sd.detent(0.15 * swell, j, R), pan: 0.4 * (R('tick', 'pan', j) - 0.5), distance: 0.3 + 0.5 * R('tick', 'far', j) })),
  ...Sd.scatter(R, 'glint', loop, 0.8, (j, swell) => ({
    ...Sd.snap(3600 + 3000 * R('glint', 'colour', j), 0.002 + 0.003 * R('glint', 'length', j), 0.25),
    velocity: swell * (0.2 + 0.8 * R('glint', 'level', j) ** 2), vary: 0.7, pan: 1.6 * (R('glint', 'pan', j) - 0.5), distance: 0.4 + 0.5 * R('glint', 'far', j),
  })),
  ...Sd.scatter(R, 'air', loop, 9, (j, swell) => swell).flatMap(([at, swell], j) => Sd.placed(
    Sd.swell(R, 'air ' + j, at, Math.min(2.5, loop + 1.6 - at), (u) => (380 + 260 * R('air', 'colour', j)) * (1 + 1.5 * Math.sin(Math.PI * u)), 0.003 * swell * (0.4 + 0.6 * R('air', 'level', j))),
    { pan: 1.2 * (R('air', 'pan', j) - 0.5), distance: 0.6 })),
], { size: 1.8, level: 13 });

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
  sound,
};
