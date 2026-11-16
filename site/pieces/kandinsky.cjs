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
const Sd = require('./sounds.js');
const { rng } = require('../../core/rand.js');

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
    // The first step of every kind: a drag or a sweep, of the background or the bird, a halo, one that
    // clears to the ground, an edge, with dabs to smear or none, with a form under it or none. A browser
    // meets each kind's marks for the first time here and not on a frame the visitor sees.
    const kindOf = (st, j) => [st.kind, !!st.bg, !!st.wash, !!st.clear, !!st.edge, st.dabs.length > 0, s.shapes.some((f) => f.at === j)].join();
    const met = new Set(), kinds = [];
    s.steps.forEach((st, j) => { const kind = kindOf(st, j); if (!met.has(kind)) { met.add(kind); kinds.push(j); } });
    if (!kinds.includes(s.steps.length - 1)) kinds.push(s.steps.length - 1);
    at(() => {
      for (const j of kinds) { Sc.drawStep(g, s, j, 0.5, ground); Sc.drawKnife(g, s, (s.steps[j].t0 + s.steps[j].t1) / 2); }
    })(g, s);
    if (sink) sink.drawImage(g.canvas, 0, 0, 1, 1, 0, 0, 1, 1);
    // Every other step has a form or a stroke of its own, which a browser also meets once: each is
    // drawn off screen in an idle period, in the knife's order, before the knife reaches it.
    if (sink && typeof requestIdleCallback === 'function') {
      const d = g.getTransform(), off = new OffscreenCanvas(g.canvas.width, g.canvas.height).getContext('2d');
      const todo = s.steps.map((st, j) => j).filter((j) => !kinds.includes(j));
      const next = () => {
        // The ground given up with its solve: the frames meet the rest as they come.
        if (!todo.length || (ground && !ground.copy.width)) return;
        const j = todo.shift();
        off.setTransform(d);
        at(() => Sc.drawStep(off, s, j, 0.5, ground))(off, s);
        sink.drawImage(off.canvas, 0, 0, 1, 1, 0, 0, 1, 1);
        sink.getImageData(0, 0, 1, 1);
        requestIdleCallback(next);
      };
      requestIdleCallback(next);
    }
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

/**
 * Heard: the palette knife. Each step is one scrape, a dry rasp of grit that
 * rises as the blade presses and thins as it lifts: long and low across the
 * background, short and bright for an edge or a small form, with a soft
 * breath of the blade under the wide ones. No two alike.
 */
function sound(ctx, s) {
  const R = rng(s.seed), end = ctx.length / ctx.sampleRate, pairs = [];
  const pan = (x) => Math.max(-0.8, Math.min(0.8, (x - Im.CLOSE.c[0]) / 360));
  s.steps.forEach((st, i) => {
    const len = st.t1 - st.t0, heavy = Math.min(1, st.dabs.length / 250), wide = st.kind === 'drag' ? Math.min(1, st.w / 60) : Math.min(1, st.r / 110);
    const at = (u) => (st.kind === 'drag' ? st.a[0] + (st.b[0] - st.a[0]) * u : st.c[0] + st.r * Math.cos(st.a0 + (st.a1 - st.a0) * u));
    const far = st.bg ? 0.25 : 0.05 + 0.15 * R('step', 'far', i);
    // Few enough that the stage builds the whole soundtrack between two frames while the film plays.
    pairs.push(...Sd.along(st.t0, st.t1, Math.round(2 + 6 * Math.max(heavy, 0.6 * wide)), (u) => u * u * (3 - 2 * u), (u, speed, j) => ({
      ...Sd.snap((st.edge ? 2600 : 700 + 900 * (1 - wide)) * (0.7 + 0.6 * R('rasp', 'colour', i * 100 + j)), 0.01 + 0.025 * wide, 0.22),
      velocity: Math.min(1, 0.25 + 0.5 * speed) * (0.35 + 0.65 * Math.max(heavy, wide)) * (0.5 + 0.5 * R('rasp', 'level', i * 100 + j)) * Math.sin(Math.PI * Math.min(1, 0.15 + 0.85 * u)),
      vary: 0.7, pan: pan(at(u)), distance: far,
    })));
    if (wide > 0.5 && len > 0.2) pairs.push([st.t0, { ...Sd.breath(st.wash ? 500 : 340, 0.15, len, 0.05 * wide), sweep: [[0, 280], [len / 2, 900], [len, 320]], velocity: 0.8, pan: pan(at(0.5)), distance: far }]);
  });
  Sd.mix(ctx, R, Sd.place(ctx, R, 'knife', pairs, end), { level: 3.1 });
}

/**
 * While the shot is scrolled: scraped paint drying. A flake lifts with a
 * fine tick, a ridge of paste settles with a soft low tap, and at times a
 * slow dark swell, far off.
 */
sound.ambience = Sd.ambience('scraped air', (R, loop) => [
  ...Sd.scatter(R, 'flake', loop, 0.65, (j, swell) => ({
    ...Sd.snap(2000 + 3000 * R('flake', 'colour', j), 0.002 + 0.004 * R('flake', 'length', j), 0.1),
    velocity: swell * (0.15 + 0.85 * R('flake', 'level', j) ** 2), vary: 0.8, pan: 1.6 * (R('flake', 'pan', j) - 0.5), distance: 0.3 + 0.6 * R('flake', 'far', j),
  })),
  ...Sd.scatter(R, 'ridge', loop, 2.2, (j, swell) => ({
    ...Sd.snap(300 + 360 * R('ridge', 'colour', j), 0.025 + 0.03 * R('ridge', 'length', j), 0.22),
    velocity: swell * (0.3 + 0.7 * R('ridge', 'level', j)), vary: 0.6, pan: 1.4 * (R('ridge', 'pan', j) - 0.5), distance: 0.3 + 0.5 * R('ridge', 'far', j),
  })),
  ...Sd.scatter(R, 'give', loop, 5, (j, swell) => swell).flatMap(([at, swell], j) => Sd.placed(
    Sd.swell(R, 'give ' + j, at, 1.6, (u) => (200 + 140 * R('give', 'colour', j)) * (1 + 1.2 * Math.sin(Math.PI * u)), 0.035 * swell * (0.4 + 0.6 * R('give', 'level', j))),
    { pan: 1.2 * (R('give', 'pan', j) - 0.5), distance: 0.5 })),
], { level: 5 });

module.exports = {
  name: 'site-kandinsky',
  size: { w: P.W, h: P.H },
  seed: 1,
  time: { duration: 12, hz: 30 },
  build: [['lay the paper', P.lay], ['cut it', Pc.cut], ['spread the ground', Im.coat], ['lay the dabs', Im.dabs], ['outline the bird', Sc.hull], ['lay out the forms', Sc.forms]],
  draw,
  sound,
};
