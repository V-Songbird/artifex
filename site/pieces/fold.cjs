// Seam 3a to 3b, the plot is cut out and folded into papercraft layers. It
// begins where the CAD shot ends: the finished plot, the plotter's gantry
// heading home. A craft knife cuts the bird out of the blueprint part by
// part; the parts rise onto their own layers, the wing on top, and its edge
// folds over along the plot's own fold line to show the paper's white back;
// the sheet is torn across twice and its strips part and stack (see
// papercut.js). The light swings a little as it settles, and the shadows
// with it.
//
// Beats, in seconds:
//   0.0-1.6   the gantry heads home, off the sheet to the left
//   0.4-2.4   the camera goes in to the bird
//   0.9-4.1   the knife comes in and cuts: tail, body and legs, beak, wing
//   4.2-5.2   the parts rise, each on its own layer, and settle
//   5.1-6.4   the wing's edge folds up and settles, its white back showing
//   5.6-6.7   the sheet tears across, above the bird and below it
//   6.7-8.3   the strips part and stack
//   7.2-10    the light swings a little; the shadows move with it
//
// WHAT STAYS IS KEPT. The plotted sheet is drawn once and kept, at the CAD
// shot's camera and at the close one; every piece of it is that copy, laid
// through the piece's shape and lift.
//
// Looks to leave out: those of the CAD shot (see cad.cjs), and
// - parts that fade or pop up: each is cut at the knife and rises with weight;
// - a papercraft without layers: every layer casts its shadow on the next;
// - torn edges without the paper's core, and cut edges with a ragged one.

'use strict';

const P = require('./paper.js');
const E = require('./enter.js');
const Fd = require('./folded.js');

module.exports = {
  name: 'site-fold',
  size: { w: P.W, h: P.H },
  seed: 1,
  time: { duration: 10, hz: 30 },
  params: E.PARAMS,
  build: Fd.BUILD,
  draw: Fd.frame,
};
