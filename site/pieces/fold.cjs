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

const { span, ease } = require('../../core/time.js');
const P = require('./paper.js');
const E = require('./enter.js');
const Dr = require('./draft.js');
const Bp = require('./blueprint.js');
const Cs = require('./cadsheet.js');
const Pc = require('./papercut.js');

const WHOLE = { c: [600, 400], z: 0.93, turn: 0 };   // the CAD shot's camera, held
const CLOSE = { c: [Dr.FRONT[0] + 40, 470], z: 1.75, turn: 0 };   // and the bird, close
const PUSH = [0.4, 2.4];                              // the camera goes in
const CAD = 359 / 30;                                 // the CAD shot's last frame
const SWING = [7.2, 10];                              // the light swings between these seconds

/** The plotted sheet, in sheet units: the dry blueprint and every mark of the plot. */
function plotted(g, s) {
  Bp.drawSheet(g, s, 1, 1, Bp.PRINTED + 4, 1);
  Cs.drawPlot(g, s, s.plot.length);
}

// Canvases that have met every kind of mark this seam makes, and a pixel to copy one into.
const primed = new WeakSet();
const sink = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1).getContext('2d') : null;

function draw(g, s, t, clock) {
  const sec = clock.seconds, push = ease.inOut(span(PUSH[0], PUSH[1], sec));
  // The sheet kept twice: whole, as the CAD shot left it, and close, where the camera goes.
  const whole = Dr.copyAt(g, s, 'plotted', WHOLE, plotted), close = Dr.copyAt(g, s, 'plotted close', CLOSE, plotted);
  const v = Dr.towards(WHOLE, CLOSE, push), m = Dr.shot(v);
  g.save();
  g.transform(m.a, m.b, -m.b, m.a, m.x, m.y);
  let sheet;
  if (!whole.copy || !close.copy) {
    // A surface that keeps no copies: the sheet drawn again, through each clip.
    sheet = (cg, clip) => { cg.save(); clip(); plotted(cg, s); cg.restore(); };
  } else if (push < 1) {
    // Going in: the whole copy, and over it the close one, sharp, where it
    // reaches, coming in over the first part of the move.
    const w = 600 / CLOSE.z, h = 400 / CLOSE.z, [cx, cy] = CLOSE.c, over = ease.inOut(span(0, 0.3, push));
    sheet = (cg, clip) => {
      cg.save();
      clip();
      Dr.put(cg, whole);
      if (over > 0) {
        cg.beginPath();
        cg.rect(cx - w, cy - h, 2 * w, 2 * h);
        cg.clip();
        cg.globalAlpha = over;
        Dr.put(cg, close);
      }
      cg.restore();
    };
  } else {
    sheet = (cg, clip) => { cg.save(); clip(); Dr.put(cg, close); cg.restore(); };
  }
  // The light swings on to the end, so the shadows never quite stop.
  const light = s.light + 0.2 * span(SWING[0], SWING[1], sec);
  // Once per canvas, where the sheet then covers it, every kind of mark the
  // cut makes, through the close copy as the frames after the move lay it:
  // the parts rising, the wing risen, its face turning, the strips parted.
  if (g.canvas && typeof g.canvas === 'object' && !primed.has(g.canvas)) {
    primed.add(g.canvas);
    const near = close.copy ? (cg, clip) => { cg.save(); clip(); Dr.put(cg, close); cg.restore(); } : sheet;
    for (const at of [Pc.LIFT + 0.3, Pc.FOLD - 0.05, Pc.FOLD + 0.05, Pc.SPREAD + 0.5]) Pc.drawCut(g, s, at, near, light);
    // A browser drops what the kept sheet then covers whole, unless the
    // canvas is copied first: a pixel of it, so it is drawn now.
    if (sink) sink.drawImage(g.canvas, 0, 0, 1, 1, 0, 0, 1, 1);
  }
  Pc.drawCut(g, s, sec, sheet, light);
  if (CAD + sec < Cs.PARKED) Cs.drawPlotter(g, s, CAD + sec);
  g.restore();
}

module.exports = {
  name: 'site-fold',
  size: { w: P.W, h: P.H },
  seed: 1,
  time: { duration: 10, hz: 30 },
  params: E.PARAMS,
  build: [...E.BUILD, ['draft the front view', Dr.draft], ['coat the paper', Bp.coat], ['lay out the sheet', Cs.plot], ['cut it', Pc.cut]],
  draw,
};
