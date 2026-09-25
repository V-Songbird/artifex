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
};
