// Shot 2, structure is the subject: the torn pieces lift off the table, three
// mirrors stand on the sheet round a triangle of it, and the light between
// them fills the frame with its reflections: the triangle repeated by the
// wallpaper group the three mirrors make, *333, ring by ring out of the
// mirrors, until the frame is a wallpaper made of the torn painting.
//
// It begins where the tearing ends: the same dry sheet, torn, on its table.
//
// WHAT STAYS IS KEPT. The torn sheet with its gaps cut out is one kept copy,
// cut into its pieces as they lift; once they have lifted, the whole lifted
// sheet is another, and every reflection is that copy, reflected and clipped
// to its cell.
//
// Looks to leave out: those of the ink shot and the tearing (see ink.cjs and
// crack.cjs), and
// - a reflection that fades or pops into place: each opens out of the mirror
//   it is a reflection in;
// - a swatch: the symmetry is exact, but what it repeats is a torn, painted
//   sheet with a focus, not a motif drawn to be repeated.

'use strict';

const { keep, soft } = require('./held.js');
const P = require('./paper.js');
const M = require('./wordmark.js');
const Wt = require('./water.js');
const B = require('./brush.js');
const D = require('./dry.js');
const K = require('./kaleido.js');
const Sd = require('./sounds.js');
const { rng } = require('../../core/rand.js');

/**
 * Heard: the torn pieces lifting off the table, a dry flutter of paper,
 * the big early ones fuller; each mirror sliding in over the sheet, a long
 * hiss of glass on paper that slows, and standing with a small bright
 * click of glass and a dull one of its foot; then the reflections coming
 * out of the mirrors, ring by ring, each a fine glassy tick where it
 * opens, fainter and further off the further out its ring.
 */
function sound(ctx, s) {
  const R = rng(s.seed), end = ctx.length / ctx.sampleRate, pairs = [];
  // Few enough of each that the stage builds the whole soundtrack between two frames while the film plays.
  const some = (list, most) => list.filter((x, i) => Math.floor(i * most / list.length) !== Math.floor((i - 1) * most / list.length) || list.length <= most);
  const mid = (pts) => pts.reduce((a, p) => a + p[0], 0) / pts.length;
  some(s.tiles.map((t, i) => [t, s.lifts[i], i]), 36).forEach(([t, l, i]) => {
    pairs.push([l.at + 0.25 * (K.LIFT - l.at), {
      ...Sd.snap(1500 + 2200 * R('lift', 'colour', i), 0.006 + 0.014 * l.height * R('lift', 'length', i), 0.2),
      velocity: (0.25 + 0.75 * l.height * R('lift', 'level', i)) * 0.8 ** t.d, vary: 0.7, pan: Sd.panX(mid(t.poly)), distance: 0.1 + 0.4 * R('lift', 'far', i),
    }]);
  });
  s.mirrors.forEach((mr, i) => {
    const x = (mr.a[0] + mr.b[0]) / 2, len = mr.t1 - mr.t0;
    pairs.push([mr.t0, { ...Sd.breath(1800 + 600 * R('slide', 'colour', i), 0.04, len, 0.09), sweep: [[0, 5200], [len, 1400]], velocity: 0.9, vary: 0.5, pan: Sd.panX(x + mr.from * 500), distance: 0.15 }]);
    pairs.push([mr.t1 - 0.03, { ...Sd.snap(4200 + 1400 * R('stand', 'colour', i), 0.004, 0.35), velocity: 0.7 + 0.3 * R('stand', 'level', i), vary: 0.5, pan: Sd.panX(x), distance: 0.05 }]);
    pairs.push([mr.t1 - 0.02, { ...Sd.snap(360 + 120 * R('foot', 'colour', i), 0.02, 0.3), velocity: 0.8, vary: 0.5, pan: Sd.panX(x), distance: 0.05 }]);
  });
  some(s.cells.slice(1).map((c, i) => [c, i]), 60).forEach(([c, i]) => {
    pairs.push([c.start + 0.1 * s.unfold, {
      ...Sd.snap(3000 + 3000 * R('open', 'colour', i), 0.002 + 0.004 * R('open', 'length', i), 0.3),
      velocity: (0.3 + 0.7 * R('open', 'level', i) ** 1.5) * 0.82 ** (c.ring - 1), vary: 0.7, pan: Sd.panX(mid(c.tri)), distance: Math.min(0.8, 0.12 * c.ring + 0.1 * R('open', 'far', i)),
    }]);
  });
  Sd.mix(ctx, R, Sd.place(ctx, R, 'mirror', pairs, end), { level: 4 });
}

/**
 * While the shot is scrolled: glass standing on paper in a quiet room. A
 * glint ticks along a mirror here and there, a lifted piece settles with a
 * soft dry tap, and at times a slow dark breath of the room, far off.
 */
sound.ambience = Sd.ambience('mirror air', (R, loop) => [
  ...Sd.scatter(R, 'glint', loop, 0.7, (j, swell) => ({
    ...Sd.snap(3400 + 3200 * R('glint', 'colour', j), 0.002 + 0.003 * R('glint', 'length', j), 0.12),
    velocity: swell * (0.15 + 0.85 * R('glint', 'level', j) ** 2), vary: 0.8, pan: 1.6 * (R('glint', 'pan', j) - 0.5), distance: 0.3 + 0.6 * R('glint', 'far', j),
  })),
  ...Sd.scatter(R, 'piece', loop, 2.4, (j, swell) => ({
    ...Sd.snap(500 + 500 * R('piece', 'colour', j), 0.02 + 0.03 * R('piece', 'length', j), 0.2),
    velocity: swell * (0.3 + 0.7 * R('piece', 'level', j)), vary: 0.6, pan: 1.4 * (R('piece', 'pan', j) - 0.5), distance: 0.3 + 0.5 * R('piece', 'far', j),
  })),
  ...Sd.scatter(R, 'hall', loop, 5, (j, swell) => swell).flatMap(([at, swell], j) => Sd.placed(
    Sd.swell(R, 'hall ' + j, at, 1.6, (u) => (260 + 160 * R('hall', 'colour', j)) * (1 + 1.2 * Math.sin(Math.PI * u)), 0.035 * swell * (0.4 + 0.6 * R('hall', 'level', j))),
    { pan: 1.2 * (R('hall', 'pan', j) - 0.5), distance: 0.5 })),
], { level: 4.7 });

function frame(g, s, sec) {
  // Made on the first frame, and primed with a frame of the lift and one of
  // the wallpaper, so every copy and every kind of mark is ready.
  const sheet = keep(g, s, 'torn', K.torn, (pg, ps) => { frame(pg, ps, 0.8); frame(pg, ps, 5); });
  if (!sheet) {
    // A surface that keeps no copies: the torn sheet as it lies, and the mirrors.
    D.dried(g, s);
    D.drawTears(g, s, Infinity, s.tearOrder);
    K.drawMirrors(g, s, sec, soft);
    return;
  }
  if (sec < K.LIFT) {
    K.pieces(g, s, sec, sheet);
  } else {
    // Lifted: the whole scene is one kept copy, which every reflection repeats.
    const scene = K.scene(g, s, sheet);
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(scene, 0, 0);
    g.restore();
    K.drawReflections(g, s, sec, scene);
  }
  K.drawMirrors(g, s, sec, soft);
}

module.exports = {
  name: 'site-mirror',
  size: { w: P.W, h: P.H },
  seed: 1,
  time: { duration: 7, hz: 30 },
  params: {
    // The painting's own knobs, so the sheet that tore is the one the brush drew.
    strokes: { min: 12, max: 44, value: 30, meaning: 'how many strokes the brush laid' },
    reach: { min: 160, max: 620, value: 380, meaning: 'how far a stroke travelled along the current, in design units' },
    load: { min: 0.5, max: 1.3, value: 1, meaning: 'how dark the ink was: under 1 the brush was let down with water' },
    side: { min: 220, max: 460, value: 330, meaning: 'the length of each mirror: the side of the triangle the wallpaper repeats' },
  },
  build: [
    ['lay the paper', P.lay],
    ['plot the wordmark', M.plot],
    ['wet the sheet', Wt.soak],
    ['paint', B.paint],
    ['tear', D.tear],
    ['stand the mirrors', K.place],
  ],
  draw(g, s, t, clock) {
    frame(g, s, clock.seconds);
  },
  sound,
};
