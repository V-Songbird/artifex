// The showcase site's demo of Kandinsky: the songbird staged in one scene,
// drawn with the marks of skills/artifex/styles/kandinsky.js. Site-only,
// never a starting point for a piece. A haloed circle for the head,
// concentric rings for the eye, a triangle beak, a half disc body under a
// glazed circle, a rainbow of arcs for the wing, bars, a chequer strip and
// fanned lines for the tail, thin crossing lines, a ruler perch, and small
// floating forms. The seed picks the colour scheme, the way the bird faces,
// the order of the wing's bands, the sweep of the lines and where the small
// forms float.

'use strict';

const { rng } = require('../../core/rand.js');
const font = require('../../core/stroke-font.js');
const { grain, caption } = require('../../skills/artifex/styles/kit.js');
const { COLOURS: K, paper, glaze, disc, halo, line, arc, half, shape, rainbow, chequer, grid, ruler, crescent } = require('../../skills/artifex/styles/kandinsky.js');

const W = 1000; const H = 1000;
// The seed picks one scheme: which colour plays which part. Each halo is an
// RGB triple under the head, the floating spot and the body, in that order.
const SCHEMES = [
  { head: ['#fbe3a0', K.yellow, '#e0a93a'], body: ['#5b86c5', K.blue], glaze: 'rgba(233, 138, 166, 0.85)', beak: K.vermilion,
    ring: K.red, halos: ['242, 193, 78', '216, 65, 47', '47, 95, 167'], spot: K.red, tri: K.teal, half: 'rgba(242, 193, 78, 0.9)', moon: K.green },
  { head: ['#c9ece6', K.teal, '#2c7f79'], body: ['#e8735a', K.red], glaze: 'rgba(242, 193, 78, 0.85)', beak: K.deep,
    ring: K.yellow, halos: ['63, 169, 162', '47, 95, 167', '216, 65, 47'], spot: K.blue, tri: K.red, half: 'rgba(123, 94, 167, 0.85)', moon: K.orange },
  { head: ['#f8cdd9', K.pink, '#c96b8b'], body: ['#9a80c6', K.deep], glaze: 'rgba(63, 169, 162, 0.8)', beak: K.orange,
    ring: K.blue, halos: ['233, 138, 166', '242, 193, 78', '123, 94, 167'], spot: K.yellow, tri: K.blue, half: 'rgba(216, 65, 47, 0.85)', moon: K.teal },
  { head: ['#fbd0a8', K.orange, '#c8681f'], body: ['#7fb87f', K.green], glaze: 'rgba(47, 95, 167, 0.7)', beak: K.red,
    ring: K.deep, halos: ['236, 138, 47', '123, 94, 167', '90, 158, 90'], spot: K.violet, tri: K.yellow, half: 'rgba(63, 169, 162, 0.9)', moon: K.red },
];

function draw(g, s) {
  const R = rng(s.seed);
  const P = SCHEMES[Math.floor(R('look', 'scheme') * SCHEMES.length)];
  const nudge = (name, a = 70) => [(R('place', name) - 0.5) * a, (R('place', name, 1) - 0.5) * a];
  const [sx, sy] = nudge('spot'); const [tx, ty] = nudge('tri'); const [hx, hy] = nudge('half');
  const [mx, my] = nudge('moon'); const [gx, gy] = nudge('grid'); const [rx, ry] = nudge('ring');
  const tilt = (R('look', 'tilt') - 0.5) * 0.5;

  paper(g, W, H);
  g.save();
  if (R('look', 'face') >= 0.5) { g.translate(W, 0); g.scale(-1, 1); }

  const glow = (s.params && s.params.halo) ?? 0.35;
  halo(g, 620, 370, 60, 250, P.halos[0], glow);
  halo(g, 190 + sx, 190 + sy, 20, 95, P.halos[1], glow);
  halo(g, 430, 600, 80, 260, P.halos[2], 0.14);

  // Long crossing lines.
  arc(g, 520, 900, 700, 3, K.black, -2.62 + tilt, -0.86 + tilt);
  line(g, [90, 300 + tilt * 120], [380, 140 - tilt * 120], 7);
  line(g, [690, 610], [955, 515 + tilt * 200], 2.5);
  line(g, [70, 930], [300 - tilt * 160, 700], 2.5);

  glaze(g, () => {
    // Body: a half disc, and a glaze circle across it.
    const bodyGrad = g.createLinearGradient(330, 480, 560, 740);
    bodyGrad.addColorStop(0, P.body[0]);
    bodyGrad.addColorStop(1, P.body[1]);
    half(g, 460, 560, 190, -0.35, bodyGrad);
    disc(g, 395, 615, 118, P.glaze);
    // Wing: a rainbow of arcs over the body.
    const bands = [K.violet, K.blue, K.green, K.yellow, K.orange, K.red];
    if (R('look', 'bands') < 0.5) bands.reverse();
    rainbow(g, 420, 560, 72, 15, Math.PI + 0.22, Math.PI * 2 - 0.4, bands);
    // Head: a circle graded like light on paper.
    const head = g.createRadialGradient(585, 335, 10, 620, 370, 118);
    head.addColorStop(0, P.head[0]);
    head.addColorStop(0.6, P.head[1]);
    head.addColorStop(1, P.head[2]);
    disc(g, 620, 370, 116, head);
    shape(g, [[712, 362], [884, 402], [718, 428]], P.beak);
  });

  arc(g, 620, 370, 128, 3, K.black, -1.25, 1.55);
  // Eye: rings inside rings.
  disc(g, 655, 345, 44, '#fbf7ee');
  arc(g, 655, 345, 31, 11, P.ring);
  disc(g, 655, 345, 16, K.black);
  disc(g, 661, 339, 5, '#fbf7ee');
  // The song: a line out of the beak ending in a small ring.
  line(g, [884, 402], [948, 418], 3);
  arc(g, 956, 420, 8, 3);

  // Tail: a heavy bar, fanned lines and a chequer strip.
  line(g, [292, 500], [118, 398], 24);
  for (const end of [[108, 470], [118, 522], [150, 578]]) line(g, [300, 522], end, 3);
  chequer(g, 250, 520, Math.atan2(398 - 500, 118 - 292));

  // Legs and a ruler perch.
  line(g, [442, 742], [422, 866], 4);
  line(g, [522, 738], [532, 866], 4);
  disc(g, 422, 868, 9, K.black);
  disc(g, 532, 868, 9, K.black);
  ruler(g, [150, 880], [890, 850], { from: 620, to: 880 });

  // Floating forms.
  disc(g, 190 + sx, 190 + sy, 34, P.spot);
  disc(g, 200 + sx, 182 + sy, 9, K.black);
  glaze(g, () => {
    shape(g, [[776 + tx, 214 + ty], [872 + tx, 116 + ty], [884 + tx, 236 + ty]], P.tri);
    half(g, 862 + hx, 780 + hy, 58, Math.PI, P.half);
  });
  crescent(g, W, H, [250 + mx, 326 + my, 42], [268 + mx, 318 + my, 38], P.moon);
  grid(g, 760 + gx, 620 + gy, 848 + gx, 708 + gy, 22);
  arc(g, 150 + rx, 700 + ry, 30, 8, P.ring === K.blue ? K.red : K.blue);
  disc(g, 150 + rx, 700 + ry, 12, P.spot);
  for (let i = 0; i < 7; i++) {
    disc(g, 90 + R('dot', 'x', i) * 820, 90 + R('dot', 'y', i) * 820, 3 + R('dot', 'r', i) * 5, K.black);
  }
  g.restore();

  // The caption is drawn after the mirror, so it reads the right way.
  grain(g, R, 'grain', W, H, 6000, 'rgba(255,255,250,0.12)', 'rgba(90,70,40,0.07)');
  caption(g, 'KANDINSKY', font, 'rgba(27, 27, 31, 0.8)');
}

const params = {
  halo: { min: 0.1, max: 0.6, value: 0.35, meaning: 'Strength of the soft halos round the head and the floating spot: a faint wash to a strong glow' },
};

module.exports = { name: 'kandinsky', size: { w: 1000, h: 1000 }, seed: 2026, params, draw };
