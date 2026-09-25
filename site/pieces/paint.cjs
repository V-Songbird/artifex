// Seam 3a to 3b, the papercraft is painted over as impasto. It begins where
// the fold ends: the papercraft bird on its layers between the torn strips.
// A wide painting knife spreads a thick cream ground across it all in three
// sweeps, the middle one first, over the bird; the blue paper soaks up the
// oil, a dark stain spreading from each sweep's edge, and the layers show
// through the ground as relief. Then a brush lays the paint on thick in short
// dabs (see impasto.js): a dab at a time at first, then as a time-lapse; the
// swirling background, patch by patch round the bird's relief, then the bird
// part by part on top.
//
// Beats, in seconds:
//   0.0-0.4   the knife comes in, loaded
//   0.35-2.9  it spreads the ground: across the bird, above it, below it
//   2.4-3.0   the brush comes in
//   3.0-4.1   it lays the first dabs, one at a time
//   4.1-9.45  the time-lapse: the background patch by patch, then from about 8 s the bird
//   9.45-10   the brush leaves
//
// WHAT STAYS IS KEPT. The fold's last frame is drawn once and kept, with each
// sweep of the ground as it is laid; the dabs are kept in copies a batch at a
// time (see held.js upTo), so a frame draws only the sweep being laid, or the
// dabs laid since the last batch.
//
// Looks to leave out: those of the fold (see fold.cjs), and
// - paint that appears: the ground is spread by the knife, every dab by the brush;
// - flat fills: the ground carries its knife marks and ridges, and the dabs cover it;
// - a bird lost under the ground: its layers stay raised through it;
// - strokes that sit apart: each drags a little of the paint laid beside it.

'use strict';

const { upTo } = require('./held.js');
const P = require('./paper.js');
const Dr = require('./draft.js');
const Im = require('./impasto.js');
const E = require('./enter.js');
const Fd = require('./folded.js');

const FOLDED = 299 / 30;                              // the fold's last frame

// Canvases that have met every kind of mark this seam makes, and a pixel to copy one into.
const primed = new WeakSet();
const sink = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1).getContext('2d') : null;

function draw(g, s, t, clock) {
  const sec = clock.seconds, m = Dr.shot(Im.CLOSE);
  const at = (fn) => (cg, cs, ...rest) => { cg.save(); cg.transform(m.a, m.b, -m.b, m.a, m.x, m.y); fn(cg, cs, ...rest); cg.restore(); };
  // Once per canvas, where the kept copies then cover it, every kind of mark
  // the seam makes; then a pixel of the canvas copied, so it is drawn now.
  if (g.canvas && typeof g.canvas === 'object' && !primed.has(g.canvas)) {
    primed.add(g.canvas);
    const d = s.dabs[40];
    at(() => {
      Im.drawSweep(g, s, 1, 1.4);
      Im.drawKnife(g, s, 1.4);
      Im.drawDabs(g, s, 0, 60);
      Im.drawDabs(g, s, 60, 70, d.t + 0.02);
      Im.drawBrush(g, s, d.t + 0.05);
    })(g, s);
    if (sink) sink.drawImage(g.canvas, 0, 0, 1, 1, 0, 0, 1, 1);
  }
  if (sec < Im.DABS[0]) {
    // The ground, a sweep at a time over the fold's last frame, kept as each is laid.
    const k = Im.sweepsBy(s, sec);
    upTo(g, s, 'grounded', k, (cg, cs) => Fd.frame(cg, cs, 1, { seconds: FOLDED }), at((cg, cs, i) => Im.drawSweep(cg, cs, i, Infinity)), null, s.sweeps.length);
    g.save();
    g.transform(m.a, m.b, -m.b, m.a, m.x, m.y);
    if (k < s.sweeps.length) Im.drawSweep(g, s, k, sec);
    Im.drawKnife(g, s, sec);
    Im.drawBrush(g, s, sec);
    g.restore();
    return;
  }
  const k = Im.batchesBy(s, sec), done = k ? s.batches[k - 1][1] : 0;
  upTo(g, s, 'painted', k, at(Im.drawGround), at((cg, cs, i) => Im.drawDabs(cg, cs, cs.batches[i][0], cs.batches[i][1])), null, s.batches.length);
  g.save();
  g.transform(m.a, m.b, -m.b, m.a, m.x, m.y);
  Im.drawDabs(g, s, done, Im.laid(s, sec), sec);
  Im.drawBrush(g, s, sec);
  g.restore();
}

module.exports = {
  name: 'site-paint',
  size: { w: P.W, h: P.H },
  seed: 1,
  time: { duration: 10, hz: 30 },
  params: E.PARAMS,
  build: [...Fd.BUILD, ['spread the ground', Im.coat], ['lay the dabs', Im.dabs]],
  draw,
};
