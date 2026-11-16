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
const Sd = require('./sounds.js');
const { rng } = require('../../core/rand.js');

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

/**
 * Heard: the last of the water drying off the print in a few faint ticks,
 * the gantry coming in with a breath from the left, and then the plot. At
 * the plotter's own pace each mark is a tap of the pen and its dry scratch;
 * as the time-lapse quickens the marks run into a patter of fine ticks,
 * each pen with its own colour, a long line fuller than a short one, and
 * every change of pen a small double click. The gantry leaves to the left.
 */
function sound(ctx, s) {
  const R = rng(s.seed), end = ctx.length / ctx.sampleRate, pairs = [], marks = s.plot.marks;
  for (let j = 0; j < 7; j++) {
    pairs.push([0.2 + (DRY - 0.4) * (j + R('dry', 'at', j)) / 7, { ...Sd.snap(2000 + 2600 * R('dry', 'colour', j), 0.002 + 0.004 * R('dry', 'length', j), 0.14), velocity: 0.15 + 0.5 * R('dry', 'level', j) ** 2, vary: 0.8, pan: 1.4 * (R('dry', 'pan', j) - 0.5), distance: 0.4 + 0.4 * R('dry', 'far', j) }]);
  }
  const gantry = (at, len, from, to) => pairs.push([at, { ...Sd.breath(380, 0.1, len, 0.05), sweep: [[0, from], [len, to]], velocity: 0.7, pan: -0.7, distance: 0.4 }]);
  gantry(Cs.PLOT[0] - 0.4, 0.4, 300, 700);
  // The second on the shot's clock at which the plotter's clock reads `u`.
  const when = (u) => {
    let lo = Cs.PLOT[0], hi = Cs.PLOT[1];
    for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (Cs.plotted(s, mid) < u) lo = mid; else hi = mid; }
    return lo;
  };
  // Every mark at the plotter's pace; in the time-lapse one every ninth of a second, and the first of each pen.
  // Few enough that the stage builds the whole soundtrack between two frames while the film plays.
  let last = -1, pen = null;
  marks.forEach((m, i) => {
    const at = when(m.t0), lapse = at > Cs.PLOT[0] + 1.2, change = m.layer !== pen, x = (m.pts[0][0] + m.pts[m.pts.length - 1][0]) / 2;
    if (!change && at - last < (lapse ? 0.11 : 0.05)) return;
    const k = Object.keys(Cs.LAYER).indexOf(m.layer), long = Math.min(1, m.len / 160), far = 0.05 + 0.25 * R('mark', 'far', i);
    if (change && pen !== null) {
      for (const [d, colour] of [[-0.12, 520], [-0.05, 760]]) pairs.push([at + d, { ...Sd.snap(colour, 0.012, 0.3), velocity: 0.55 + 0.25 * R('pen', 'level', i), vary: 0.5, pan: Sd.panX(x), distance: 0.15 }]);
    }
    pen = m.layer;
    last = at;
    if (!lapse) pairs.push([at - 0.02, { ...Sd.snap(420 * (0.8 + 0.4 * R('down', 'colour', i)), 0.012, 0.3), velocity: 0.5 + 0.4 * R('down', 'level', i), vary: 0.6, pan: Sd.panX(x), distance: far }]);
    pairs.push([at, {
      ...Sd.snap((1900 + 330 * k) * (0.8 + 0.4 * R('nib', 'colour', i)), 0.003 + (lapse ? 0.006 : 0.016) * long, 0.22),
      velocity: (0.3 + 0.7 * long) * (0.45 + 0.55 * R('nib', 'level', i)), vary: 0.7, pan: Sd.panX(x), distance: far,
    }]);
  });
  gantry(Cs.PLOT[1], 0.4, 700, 280);
  Sd.mix(ctx, R, Sd.place(ctx, R, 'plot', pairs, end), { level: 4.2 });
}

/**
 * While the shot is scrolled: the plotted sheet on its bench. A fibre of
 * the dry paper ticks here and there, the bench gives a soft low tap, and
 * at times a slow dark breath of the room, far off.
 */
sound.ambience = Sd.ambience('plot air', (R, loop) => [
  ...Sd.scatter(R, 'fibre', loop, 0.75, (j, swell) => ({
    ...Sd.snap(1900 + 2800 * R('fibre', 'colour', j), 0.002 + 0.004 * R('fibre', 'length', j), 0.12),
    velocity: swell * (0.15 + 0.85 * R('fibre', 'level', j) ** 2), vary: 0.8, pan: 1.6 * (R('fibre', 'pan', j) - 0.5), distance: 0.3 + 0.6 * R('fibre', 'far', j),
  })),
  ...Sd.scatter(R, 'bench', loop, 2.8, (j, swell) => ({
    ...Sd.snap(240 + 260 * R('bench', 'colour', j), 0.03 + 0.03 * R('bench', 'length', j), 0.24),
    velocity: swell * (0.3 + 0.7 * R('bench', 'level', j)), vary: 0.6, pan: 1.4 * (R('bench', 'pan', j) - 0.5), distance: 0.3 + 0.5 * R('bench', 'far', j),
  })),
  ...Sd.scatter(R, 'room', loop, 5, (j, swell) => swell).flatMap(([at, swell], j) => Sd.placed(
    Sd.swell(R, 'room ' + j, at, 1.6, (u) => (190 + 130 * R('room', 'colour', j)) * (1 + 1.1 * Math.sin(Math.PI * u)), 0.035 * swell * (0.4 + 0.6 * R('room', 'level', j))),
    { pan: 1.2 * (R('room', 'pan', j) - 0.5), distance: 0.5 })),
], { level: 2.5 });

module.exports = {
  name: 'site-cad',
  size: { w: P.W, h: P.H },
  seed: 1,
  time: { duration: 12, hz: 30 },
  params: E.PARAMS,
  build: [...E.BUILD, ['draft the front view', Dr.draft], ['coat the paper', Bp.coat], ['lay out the sheet', Cs.plot]],
  draw,
  sound,
};
