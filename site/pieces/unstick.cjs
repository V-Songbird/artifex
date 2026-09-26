// Seam 3 to 4, the forms come unstuck. It begins where the wall ends: the
// camera coming in onto the framed Kandinsky. The camera settles on it, and
// the paint the knife laid, dry now, comes free of the ground: each form's
// edge cracks, it lifts off with its shadow under it and lies loose where it
// fell, a pale stain of it left where it was painted, the forms on top first
// (see loose.js). By the last frame every form lies loose and the long lines
// have begun to slide into a staff, on the score's first cues (see score.js).
//
// Beats, in seconds:
//   0.0-0.6    the camera settles on the frame
//   0.9-5.4    the forms come free, a few at first and then in a rush
//   4.9-6.0    the last land
//   6.0-7.0    the first cues: the long lines slide into a staff
//
// Heard: each form's crack as it comes free, higher the smaller it is, and
// its tap as it lands, in the room of the table; then the first long lines
// laid on the staff, each a low string.
//
// Looks to leave out:
// - a form that appears or vanishes: every one is the painted form, lifted;
// - a still ending: the forms and the light move to the last frame.

'use strict';

const { span, ease } = require('../../core/time.js');
const P = require('./paper.js');
const Hg = require('./hang.js');
const Sk = require('./score.js');
const V = require('./voices.js');

const DUR = 7;

/** The wall's camera at its second `sec`, from 7.8 s on: the move onto the Kandinsky (see wall.cjs camera). */
function wallCamera(s, sec) {
  const all = Hg.whole(s), drift = { c: [all.c[0] + 60, all.c[1] - 20], z: all.z * 0.97, turn: 0 }, q = Hg.chosen(s);
  const u = ease.inOut(span(7.8, 12.6, sec)), a = 1 - (1 - u) ** 3;
  return { c: [drift.c[0] + (q.c[0] - drift.c[0]) * a, drift.c[1] + (q.c[1] - drift.c[1]) * a], z: drift.z * (q.z / drift.z) ** u, turn: 0 };
}

/**
 * The camera: it goes on from where and as fast as the wall's left it, and
 * comes in without a jolt until the painting fills the frame, a strip of the
 * mat round it, by Sk.IN (see score.js stage), and drifts there after.
 */
function camera(s, sec) {
  if (sec <= 0) return wallCamera(s, Sk.WALL);
  if (sec >= Sk.IN) return Sk.camera(s, sec);
  const e = 1e-3, a = wallCamera(s, Sk.WALL), b = wallCamera(s, Sk.WALL - e), q = Sk.stage(s);
  const from = [a.c[0], a.c[1], Math.log(a.z)], vel = [(a.c[0] - b.c[0]) / e, (a.c[1] - b.c[1]) / e, (Math.log(a.z) - Math.log(b.z)) / e], to = [q.c[0], q.c[1], Math.log(q.z)];
  // A cubic from the wall's last pose and speed to the painting, at rest.
  const u = sec / Sk.IN, h1 = 2 * u ** 3 - 3 * u ** 2 + 1, h2 = u ** 3 - 2 * u ** 2 + u, h3 = -2 * u ** 3 + 3 * u ** 2;
  const p = from.map((f, i) => h1 * f + h2 * Sk.IN * vel[i] + h3 * to[i]);
  return { c: [p[0], p[1]], z: Math.exp(p[2]), turn: 0 };
}

function draw(g, s, t, clock) {
  Sk.draw(g, s, clock.seconds, camera(s, clock.seconds));
}

/** Heard: each form's crack as it comes free and its tap as it lands, then the first lines laid on the staff (see voices.js). */
function sound(ctx, s) {
  V.play(ctx, s, Sk.events(s), 0, DUR - 1 / 30, Sk.stage(s).c[0]);
}

module.exports = {
  name: 'site-unstick',
  size: { w: P.W, h: P.H },
  seed: 1,
  time: { duration: DUR, hz: 30 },
  build: Sk.build,
  draw,
  sound,
};
