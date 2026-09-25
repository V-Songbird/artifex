// Shot 3b, the impasto scraped into a Kandinsky. It begins where the paint
// seam ends: the bird and its swirling background in thick dabs, the brush
// leaving. A palette knife drags the background's dabs off the ground in long
// strokes round the bird, swirls thin paint into halos, and then pivots,
// drags and presses the bird's own dabs into the style's forms, part by part;
// last come the long lines across the composition and the small floating
// forms (see scrape.js).
//
// Beats, in seconds:
//   0.0-0.45   the brush leaves; the knife comes in
//   0.45-3.2   the background, scraped in long strokes, back and forth
//   3.25-4.0   three halos swirled in thin paint
//   4.1-9.1    the tail, the body, the wing, the head, the beak, the legs and the perch
//   9.1-9.5    the last of the bird's dabs wiped off round it
//   9.5-11.66  the long lines and the floating forms; the knife leaves by the last frame
//
// WHAT STAYS IS KEPT. The ground the knife scrapes down to is drawn once and
// kept; the impasto it starts from is kept with the knife's steps over it,
// five at a time (see held.js upTo), so a frame lays only the steps since.
//
// Looks to leave out: those of the paint seam (see paint.cjs), and
// - forms that appear: each is dragged, pivoted or pressed out of the paint by the knife;
// - an outline of the bird: the style assembles it from forms, never draws it;
// - glazes that sit on top like cut paper: they multiply.

'use strict';

const { upTo } = require('./held.js');
const P = require('./paper.js');
const Dr = require('./draft.js');
const Pc = require('./papercut.js');
const Im = require('./impasto.js');
const Sc = require('./scrape.js');

// Canvases that have met every kind of mark this shot makes, and a pixel to copy one into.
const primed = new WeakSet();
const sink = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1).getContext('2d') : null;

function draw(g, s, t, clock) {
  const sec = clock.seconds, m = Dr.shot(Im.CLOSE);
  const at = (fn) => (cg, cs, ...rest) => { cg.save(); cg.transform(m.a, m.b, -m.b, m.a, m.x, m.y); fn(cg, cs, ...rest); cg.restore(); };
  let ground = Dr.copyAt(g, s, 'scraped', Im.CLOSE, Sc.paintGround);
  ground = ground.copy ? ground : null;
  // Once per canvas, where the kept copies then cover it, every kind of mark
  // the shot makes; then a pixel of the canvas copied, so it is drawn now.
  if (g.canvas && typeof g.canvas === 'object' && !primed.has(g.canvas)) {
    primed.add(g.canvas);
    at(() => {
      // A background stroke, a halo, the wipe round the bird and the last dot, with every form under it.
      const kinds = [0, s.steps.findIndex((st) => st.wash), s.steps.length - 1, s.steps.findIndex((st, j) => j && !st.bg && !st.wash && !s.shapes.some((f) => f.at === j))];
      for (const j of kinds) { Sc.drawStep(g, s, j, 0.5, ground); Sc.drawKnife(g, s, (s.steps[j].t0 + s.steps[j].t1) / 2); }
    })(g, s);
    if (sink) sink.drawImage(g.canvas, 0, 0, 1, 1, 0, 0, 1, 1);
  }
  // The impasto, and over it every group of steps the knife has finished, kept as each is done.
  const { k } = Sc.scraped(s, sec);
  upTo(g, s, 'scraped', k, at(Sc.paintImpasto), at((cg, cs, i) => { for (let j = cs.groups[i][0]; j < cs.groups[i][1]; j++) Sc.drawStep(cg, cs, j, 1, ground); }), null, s.groups.length);
  g.save();
  g.transform(m.a, m.b, -m.b, m.a, m.x, m.y);
  Sc.drawLive(g, s, sec, ground);
  Im.drawBrush(g, s, Sc.PAINTED + sec);
  Sc.drawKnife(g, s, sec);
  g.restore();
}

module.exports = {
  name: 'site-kandinsky',
  size: { w: P.W, h: P.H },
  seed: 1,
  time: { duration: 12, hz: 30 },
  build: [['lay the paper', P.lay], ['cut it', Pc.cut], ['spread the ground', Im.coat], ['lay the dabs', Im.dabs], ['outline the bird', Sc.hull], ['lay out the forms', Sc.forms]],
  draw,
};
