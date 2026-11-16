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

const { rng } = require('../../core/rand.js');
const { hold, upTo } = require('./held.js');
const Sd = require('./sounds.js');
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

/**
 * Heard: the drying sheet crackling faintly as it shrinks, more often as it
 * dries, then each tear as it opens: a rip of paper, its fibres giving in a
 * crackle from its flaw outwards, fast at first, over the rasp of the sheet
 * parting. The first generations are long, dark and near, with a dull give
 * of the sheet under them; the later ones short, bright and further off.
 */
function sound(ctx, s) {
  const R = rng(s.seed), end = ctx.length / ctx.sampleRate, pairs = [];
  for (let j = 0; j < 22; j++) {
    const at = 0.25 + (D.DRY + 0.3) * Math.sqrt((j + R('tick', 'at', j)) / 22);
    pairs.push([at, { ...Sd.snap(1800 + 3000 * R('tick', 'colour', j), 0.002 + 0.005 * R('tick', 'length', j), 0.18), velocity: 0.15 + 0.75 * R('tick', 'level', j) ** 2, vary: 0.7, pan: (R('tick', 'pan', j) - 0.5) * 1.4, distance: 0.3 + 0.6 * R('tick', 'far', j) }]);
  }
  s.tears.forEach((t, i) => {
    const pts = t.pts, len = pts.reduce((a, p, k) => k ? a + Math.hypot(p[0] - pts[k - 1][0], p[1] - pts[k - 1][1]) : a, 0);
    const n = Math.max(6, Math.min(60, Math.round(len / 8))), weight = 0.86 ** t.d, far = Math.min(0.8, t.d * 0.18);
    const pan = Sd.panX(pts[Math.round(t.origin * (pts.length - 1))][0]);
    for (let k = 0; k < n; k++) {
      // From the flaw outwards, both ways, fast at first: a fibre k of n gives at this share of the opening.
      const u = k / n, side = k % 2 ? -1 : 1, where = Math.max(0, Math.min(pts.length - 1, Math.round((t.origin + side * u * 0.5) * (pts.length - 1))));
      pairs.push([t.at + D.OPENS * 0.45 * u ** 1.6, {
        ...Sd.snap((900 + 700 * t.d) * (0.6 + 0.8 * R('fibre', 'colour', i * 64 + k)), 0.003 + 0.008 * weight * R('fibre', 'length', i * 64 + k), 0.5),
        velocity: weight * (0.25 + 0.75 * R('fibre', 'level', i * 64 + k) ** 1.5) * (1 - 0.5 * u), vary: 0.7, pan: Sd.panX(pts[where][0]), distance: far,
      }]);
    }
    // The rasp of the sheet parting under the fibres, as long as the tear opens fast.
    pairs.push([t.at, { ...Sd.breath(700 + 500 * t.d, 0.02, D.OPENS * 0.35, 0.07), sweep: [[0, 2600], [D.OPENS * 0.35, 900]], velocity: weight, vary: 0.6, pan, distance: far }]);
    if (t.d < 2) pairs.push([t.at, { ...Sd.knock(380, Sd.hertz(40 + 3 * t.d), 0.1), velocity: weight, vary: 0.5, pan }]);
  });
  Sd.mix(ctx, R, Sd.place(ctx, R, 'crack', pairs, end), { level: 3.2 });
}

/**
 * While the shot is scrolled: the dry torn sheet still settling, a faint
 * crackle here and there, now and then a few fibres giving at once, far
 * off, and seldom a dull give of the paper.
 */
sound.ambience = Sd.ambience('crack air', (R, loop) => [
  ...Sd.scatter(R, 'settle', loop, 0.6, (j, swell) => ({
    ...Sd.snap(1800 + 3200 * R('settle', 'colour', j), 0.002 + 0.004 * R('settle', 'length', j), 0.16),
    velocity: swell * (0.1 + 0.9 * R('settle', 'level', j) ** 2), vary: 0.8, pan: 1.6 * (R('settle', 'pan', j) - 0.5), distance: 0.3 + 0.6 * R('settle', 'far', j),
  })),
  ...Sd.scatter(R, 'give', loop, 3, (j, swell) => ({
    ...Sd.breath(900 + 900 * R('give', 'colour', j), 0.01, 0.12 + 0.15 * R('give', 'length', j), 0.06),
    velocity: swell * (0.3 + 0.7 * R('give', 'level', j)), vary: 0.6, pan: 1.4 * (R('give', 'pan', j) - 0.5), distance: 0.5 + 0.4 * R('give', 'far', j),
  })),
  ...Sd.scatter(R, 'sag', loop, 5, (j, swell) => ({
    ...Sd.knock(350, Sd.hertz(41 + 4 * R('sag', 'note', j)), 0.05), velocity: swell * (0.3 + 0.5 * R('sag', 'level', j)), vary: 0.6, pan: 1.2 * (R('sag', 'pan', j) - 0.5), distance: 0.6,
  })),
]);

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
  sound,
};
