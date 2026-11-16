// The fold's picture (see fold.cjs), drawn here so that the paint seam can
// begin on its last frame: the cut, the layers, the fold and the tears over
// the plotted sheet kept at the CAD shot's camera and at the close one.

'use strict';

const { span, ease } = require('../../core/time.js');
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
  // The sheet kept twice: whole, as the CAD shot left it, and close, where the
  // camera goes; once the camera is in, only the close one is needed (and the
  // paint seam, which keeps the fold's last frame, makes only that one).
  const close = Dr.copyAt(g, s, 'plotted close', CLOSE, plotted), whole = push < 1 ? Dr.copyAt(g, s, 'plotted', WHOLE, plotted) : close;
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

/** The fold's build stages. */
const BUILD = [...E.BUILD, ['draft the front view', Dr.draft], ['coat the paper', Bp.coat], ['lay out the sheet', Cs.plot], ['cut it', Pc.cut]];

module.exports = { frame: draw, BUILD };
