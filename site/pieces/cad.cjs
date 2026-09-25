// Shot 3a, the CAD sheet. It begins where the print ends: the wet blueprint,
// the bird in white on Prussian blue. The camera draws back to the whole
// sheet, squaring it up, while the water dries off it: its printed frame, the
// brushed edge of the coat. Then the plotter from the intro comes back, seen
// by its shadow, and lays the rest of the CAD drawing over the print a pen at
// a time: the top view and the section in white, hatching, construction and
// centre lines, hidden and fold lines, the cutting plane, dimensions, text.
// It starts at its own pace and speeds up as a time-lapse, then parks.
//
// Beats, in seconds:
//   0.0-2.3   the camera draws back to the whole sheet and squares it; the
//             water dries (to 4)
//   2.0-2.4   the plotter's gantry comes in from the left
//   2.4-11.6  the plot: the plotter's pace for 1.2 s, then quicker, as a
//             time-lapse, by 2.4 s in
//   11.6-12   the gantry heads home to the left, on into the next seam
//
// WHAT STAYS IS KEPT. Dry, the sheet no longer changes: it is drawn once and
// kept, at the print's last view and at the whole sheet's, the water drying
// over it. Drawing back, the whole copy is laid and the close one, sharp,
// over it, going out over the last part of the move. The plot is kept too:
// each mark the pen finishes is added to a copy of the sheet, and only the
// mark under the pen is drawn on the frame.
//
// Looks to leave out: those of the print (see print.cjs), and
// - lines that fade in: every mark is drawn at the pen;
// - a plot that appears all at once, or all in one colour: it is laid a pen,
//   a layer, at a time.

'use strict';

const { span, ease } = require('../../core/time.js');
const P = require('./paper.js');
const E = require('./enter.js');
const Dr = require('./draft.js');
const Bp = require('./blueprint.js');
const Cs = require('./cadsheet.js');

const BACK = [0, 2.3];                           // the camera draws back
const WHOLE = { c: [600, 400], z: 0.93, turn: 0 };  // the whole sheet, inside the coat's brushed edge
const DRY = 4;                                   // the water has dried off by this second
/** Where the camera starts: the print's last view. */
const START = (s) => Bp.printed(s, Bp.PRINTED);

// Canvases that have met every kind of mark this shot makes.
const primed = new WeakSet();

// Each kept plot's count of the marks laid on it.
const laid = new WeakMap();

/** The kept plot `plot` brought to the marks finished by `u`: those since its last count added, or all of them laid again on the dry sheet `dried` when fewer. */
function lay(s, plot, dried, u) {
  const done = Cs.finished(s, u), cg = plot.copy.getContext('2d');
  let n = laid.get(plot.copy);
  if (n === undefined || done < n) {
    cg.setTransform(1, 0, 0, 1, 0, 0);
    cg.drawImage(dried.copy, 0, 0);
    n = 0;
  }
  if (done > n) {
    const m = plot.m;
    cg.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    Cs.drawPlot(cg, s, u, n, done);
  }
  laid.set(plot.copy, done);
  return done;
}

function draw(g, s, t, clock) {
  const sec = clock.seconds, pull = ease.inOut(span(BACK[0], BACK[1], sec));
  const m = Dr.shot(Dr.towards(START(s), WHOLE, pull)), u = sec > Cs.PLOT[0] ? Cs.plotted(s, sec) : 0;
  // The dry sheet kept where the camera will hold it and where it starts, and
  // a copy of it for the plot, all from the first frame on, which is drawn
  // before the shot is on screen.
  const dry = (cg, cs) => Bp.drawSheet(cg, cs, 1, 1, Bp.PRINTED + DRY, 1);
  const kept = [Dr.copyAt(g, s, 'blueprint', WHOLE, dry), Dr.copyAt(g, s, 'blueprint close', START(s), dry), Dr.copyAt(g, s, 'plot', WHOLE, dry)];
  const [whole, close, plot] = kept;
  g.save();
  g.transform(m.a, m.b, -m.b, m.a, m.x, m.y);
  // Once per canvas, before the sheet covers them: every layer's marks, the plotter's shadows and the kept copies.
  if (g.canvas && typeof g.canvas === 'object' && !primed.has(g.canvas)) {
    primed.add(g.canvas);
    Cs.drawPlot(g, s, s.plot.length);
    Cs.drawPlotter(g, s, (Cs.PLOT[0] + Cs.PLOT[1]) / 2);
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    for (const { copy } of kept) if (copy) g.drawImage(copy, 0, 0, 1, 1, 0, 0, 1, 1);
    g.restore();
  }
  let from = 0;
  if (!whole.copy || !close.copy || !plot.copy) Bp.drawSheet(g, s, 1, 1, Bp.PRINTED + sec, span(0, DRY, sec));
  else {
    if (pull < 1) {
      Dr.put(g, whole);
      g.save();
      g.globalAlpha = 1 - ease.inOut(span(0.7, 1, pull));
      Dr.put(g, close);
      g.restore();
    } else {
      from = lay(s, plot, whole, u);
      Dr.put(g, plot);
    }
    if (sec < DRY) Bp.drawWater(g, Bp.frontAt(s, 1, Bp.PRINTED + sec), Bp.PRINTED + sec, 1 - span(0, DRY, sec));
  }
  if (u > 0) Cs.drawPlot(g, s, u, from);
  if (sec > Cs.PLOT[0] - 0.5) Cs.drawPlotter(g, s, sec);
  g.restore();
}

module.exports = {
  name: 'site-cad',
  size: { w: P.W, h: P.H },
  seed: 1,
  time: { duration: 12, hz: 30 },
  params: E.PARAMS,
  build: [...E.BUILD, ['draft the front view', Dr.draft], ['coat the paper', Bp.coat], ['lay out the sheet', Cs.plot]],
  draw,
};
