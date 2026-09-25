// Seam 1 to 2: the painting dries and the sheet tears, and the tears are
// recursive cuts. The water leaves the sheet from the edges of the wet band,
// the last strokes lose their gloss, the ink dries a shade lighter, and then
// the soaked paper, shrinking as it dries, tears in generations, each tear
// running between tears already there, finer near the painting's focus, until
// the sheet is a partition of torn pieces.
//
// It begins where the ink shot ends: the same painting, the last stroke just
// lifted and still wet, the brush leaving the sheet.
//
// WHAT STAYS IS KEPT. The paper with its letters and tide line is one kept
// copy, and every mark of ink on it another, laid over it; while the sheet
// dries a frame draws the water that is left, the drying and the gloss that is
// going. Once it is dry the dry sheet is kept, and each tear that has opened
// fully is laid on copies of it one at a time (see held.js `upTo`); a frame
// draws only the tears still opening.
//
// Looks to leave out: those of the ink shot (see ink.cjs), and
// - a grid: a tear never cuts a piece in half, and depth follows the focus;
// - a glazed tile's crackle (the owner's note): the sheet tears like paper,
//   with a white fibrous edge and the table showing through;
// - a fade from painting to partition: nothing is replaced, the sheet tears.

'use strict';

const { hold, upTo } = require('./held.js');
const P = require('./paper.js');
const M = require('./wordmark.js');
const Wt = require('./water.js');
const B = require('./brush.js');
const D = require('./dry.js');

/** Tears that have opened fully by second `sec`, in the order they do: a count. */
const opened = (s, sec) => {
  let k = 0;
  while (k < s.tearOrder.length && s.tears[s.tearOrder[k]].at + D.OPENS <= sec) k++;
  return k;
};

function over(g, s, sec) {
  if (sec < D.DRY) {
    hold(g, s, 'sheet', D.sheet);
    D.drying(g, s, sec);
    D.drawTears(g, s, sec, s.tearOrder);
    return;
  }
  // Dry: the tears that have opened are kept on copies of the dry sheet, one
  // count at a time, and only those still opening are drawn.
  const k = opened(s, sec);
  upTo(g, s, 'torn', k, D.dried, (cg, cs, i) => D.drawTears(cg, cs, Infinity, [cs.tearOrder[i]]), null, s.tears.length);
  D.drawTears(g, s, sec, s.tearOrder.slice(k));
}

module.exports = {
  name: 'site-crack',
  size: { w: P.W, h: P.H },
  seed: 1,
  time: { duration: 5, hz: 30 },
  // The ink shot's own knobs, so the painting that cracks is the one it drew.
  params: {
    strokes: { min: 12, max: 44, value: 30, meaning: 'how many strokes the brush laid' },
    reach: { min: 160, max: 620, value: 380, meaning: 'how far a stroke travelled along the current, in design units' },
    load: { min: 0.5, max: 1.3, value: 1, meaning: 'how dark the ink was: under 1 the brush was let down with water' },
  },
  build: [
    ['lay the paper', P.lay],
    ['plot the wordmark', M.plot],
    ['wet the sheet', Wt.soak],
    ['paint', B.paint],
    ['tear', D.tear],
  ],
  draw(g, s, t, clock) {
    // Primed with frames from the drying and from the tearing, where every
    // kind of mark is on the sheet, and every kept copy made.
    hold(g, s, 'sheet', D.sheet, (pg, ps) => { over(pg, ps, 0.9); over(pg, ps, 3); });
    over(g, s, clock.seconds);
  },
};
