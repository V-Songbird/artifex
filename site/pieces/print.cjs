// Seam 3a, the tracing is printed. It begins where the trace ends: the film
// inked square over the doodle. The camera draws back; the notebook page is
// pulled out from under the film, and under it lies a sheet brushed with
// cyanotype. A lamp beyond the frame comes on and the coat turns grey green
// wherever the film's ink does not shade it. The film is lifted away, its
// ink with it, and the drawing is there in the coat. Water poured across the
// sheet washes it: the coat turns Prussian blue behind the water and the
// lines wash out white. The film's drawing is a blueprint.
//
// Beats, in seconds:
//   0.0-1.7   the camera draws back; the page is pulled out to the left
//             (0.35-1.6), tugging the film, which settles
//   1.8-3.4   the lamp: its light rises, holds and falls; the coat exposes
//   3.3-4.4   the film is lifted and carried away up and to the right
//   3.9-7.3   the water crosses the sheet from the top, evenly
//   7.3-8     the wet sheet glistens; the camera still drawing back
//
// Looks to leave out: those of the trace (see trace.cjs), and
// - a print that dissolves in: the coat changes where the light and then the
//   water reach it, and the lines keep the film's shadow;
// - the page or the film leaving by fading: each is moved out of the frame.

'use strict';

const { span, ease, spring } = require('../../core/time.js');
const { rng } = require('../../core/rand.js');
const Sd = require('./sounds.js');
const P = require('./paper.js');
const E = require('./enter.js');
const Dr = require('./draft.js');
const Bp = require('./blueprint.js');

const PULL = [0.35, 1.6];                    // the page is pulled out
const LAMP = [1.8, 2.2, 3.0, 3.4];           // the lamp: up, full, down, off
const LIFT = [3.3, 4.4];                     // the film lifted away
const WASH = [3.9, 7.3];                     // the water crosses
const tug = spring({ stiffness: 60, damping: 0.35 });

/** How much light has reached the coat by second `sec`, 0 to 1. */
function exposure(sec) {
  const [a, b, c, d] = LAMP;
  // The lamp's light over time, integrated: ramps up, holds, ramps down.
  const up = Math.min(Math.max(sec - a, 0), b - a), full = Math.min(Math.max(sec - b, 0), c - b), down = Math.min(Math.max(sec - c, 0), d - c);
  const got = (up * up) / (2 * (b - a)) + full + down - (down * down) / (2 * (d - c));
  const all = (b - a) / 2 + (c - b) + (d - c) / 2;
  return got / all;
}

// Canvases that have met every kind of mark this seam makes.
const primed = new WeakSet();

/** The lamp's light, the water, the lifted film's shadow and the kept sheets, drawn once where the page then covers them (see draft.js prime). */
function prime(g, s, kept) {
  if (!g.canvas || typeof g.canvas !== 'object' || primed.has(g.canvas)) return;
  primed.add(g.canvas);
  Bp.drawSheet(g, s, 0.5, 0.5, 5);
  Dr.drawFilm(g, s, 0, 9, 0.5);
  lamp(g, 1);
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  for (const { copy } of kept) if (copy) g.drawImage(copy, 0, 0, 1, 1, 0, 0, 1, 1);
  g.restore();
}

/** The lamp's light across the whole frame, from beyond its top left, at `on` of its full. */
function lamp(g, on) {
  const glow = g.createRadialGradient(-150, -250, 0, -150, -250, 1500);
  glow.addColorStop(0, `rgba(236, 240, 255, ${0.5 * on})`);
  glow.addColorStop(0.5, `rgba(236, 240, 255, ${0.22 * on})`);
  glow.addColorStop(1, `rgba(236, 240, 255, ${0.08 * on})`);
  g.fillStyle = glow;
  g.fillRect(0, 0, P.W, P.H);
}

/**
 * The sheet exposed by `lit` and washed to `wash`, laid from its three kept
 * states: the dry coat, the coat exposed and the sheet washed, each kept at
 * the seam's last view, which holds every earlier one. Exposed, the coat is
 * the dry one and the exposed one mixed; washing, the washed sheet is kept
 * only where the water has turned it and the rest laid under it. On a surface
 * that keeps no copies it is drawn.
 */
function sheet(g, s, lit, wash, sec, [dry, exposed, washed]) {
  if (!dry.copy || !exposed.copy || !washed.copy) { Bp.drawSheet(g, s, lit, wash, sec); return; }
  if (wash >= 1) Dr.put(g, washed);
  else {
    // The coat from the bottom up: dry, then exposed as far as it is lit.
    const layers = [];
    if (lit < 1) layers.push([dry, 1]);
    if (lit > 0) layers.push([exposed, lit]);
    g.save();
    if (wash > 0) {
      // The washed sheet, kept where the water has turned it, and the coat laid under it.
      Dr.put(g, washed);
      g.globalCompositeOperation = 'destination-in';
      Bp.soak(g, s, wash, sec);
      g.globalCompositeOperation = 'destination-over';
      layers.reverse();
    }
    for (const [copy, a] of layers) { g.globalAlpha = a; Dr.put(g, copy); }
    g.restore();
  }
  if (wash > 0) Bp.drawWater(g, Bp.frontAt(s, wash, sec), sec, 1);
}

function draw(g, s, t, clock) {
  const sec = clock.seconds, traced = Dr.TRACED + sec;
  const m = Dr.shot(Bp.printed(s, sec));
  const pulled = ease.in(span(PULL[0], PULL[1], sec));
  const lift = ease.inOut(span(LIFT[0], LIFT[1], sec));
  // The page drags the film a little as it goes, and the film springs back.
  const drag = sec < PULL[0] ? 0 : -14 * (tug(sec - PULL[0]) - tug(sec - PULL[0] - 0.5));
  const last = Bp.printed(s, Bp.PRINTED);
  const kept = [
    Dr.copyAt(g, s, 'coat', last, (cg, cs) => Bp.drawSheet(cg, cs, 0, 0, 0)),
    Dr.copyAt(g, s, 'exposed', last, (cg, cs) => Bp.drawSheet(cg, cs, 1, 0, 0)),
    Dr.copyAt(g, s, 'washed', last, (cg, cs) => Bp.drawSheet(cg, cs, 1, 1, 0, 1)),
  ];
  g.save();
  g.transform(m.a, m.b, -m.b, m.a, m.x, m.y);
  // Nothing under the page is drawn while it covers the whole frame.
  if (pulled >= 1 || !Dr.covers(s, m, -pulled * s.pullTo)) sheet(g, s, exposure(sec), span(WASH[0], WASH[1], sec), sec, kept);
  // Once per canvas, after the table's opaque fill and under the page.
  if (pulled === 0) prime(g, s, kept);
  if (pulled < 1) Dr.drawPage(g, s, -pulled * s.pullTo);
  if (lift < 1) {
    // Lifted, the film's shadow falls further off and softer; then it is carried away.
    g.save();
    g.translate(drag + lift * 1500, -lift * 900);
    Dr.drawFilm(g, s, 0, traced, lift);
    Dr.drawInk(g, s, Infinity);
    g.restore();
  }
  g.restore();
  // The lamp's light across the whole frame, from beyond its top left.
  const [a, b, c, d] = LAMP;
  const on = Math.min(span(a, b, sec), 1 - span(c, d, sec));
  if (on > 0) lamp(g, on);
  // The pen's shadow, still leaving the frame as the trace left it.
  if (traced < s.inked + Dr.LEAVE + 0.5) Dr.drawPen(g, s, traced, m);
}

/**
 * Heard: the page pulled out to the left from under the film, a dry hiss of
 * paper quickening, and the film flapping back; the lamp's switch clicked
 * on and, once its light has fallen, off, and its housing ticking as it
 * cools; the film peeled off the coat in a fine crackle and carried away;
 * then the water poured across the sheet, a running wash that swells and
 * thins as the sheet fills, small bubbles breaking in it, and a few drops
 * as it glistens.
 */
function sound(ctx, s) {
  const R = rng(s.seed), end = ctx.length / ctx.sampleRate, pairs = [];
  pairs.push(...Sd.along(PULL[0], PULL[1], 44, ease.in, (u, speed, j) => ({
    ...Sd.breath(1200 + 1600 * R('pull', 'colour', j), 0.02, 0.07 + 0.07 * R('pull', 'length', j), 0.16), velocity: Math.min(1, 0.15 + 0.45 * speed) * (0.55 + 0.45 * R('pull', 'level', j)), vary: 0.7, pan: -0.8 * u,
  })));
  pairs.push([PULL[0] + 0.12, { ...Sd.breath(2800, 0.03, 0.3, 0.035), velocity: 0.7, pan: 0.2 }]);
  const [a, , , d] = LAMP, click = (at, colour) => [at, { ...Sd.knock(colour, 1300, 0.08), velocity: 0.8, vary: 0.4, pan: -0.6 }];
  pairs.push(click(a - 0.03, 3400), click(d, 3000));
  // The lamp's warmth while it is on: a faint breath of air over the sheet, rising and falling with its light.
  pairs.push(...Sd.placed(Sd.swell(R, 'warmth', a, d - a, (u) => 380 + 300 * Math.sin(Math.PI * u), 0.015, 0.5), { pan: -0.5, distance: 0.6 }));
  for (let j = 0; j < 3; j++) pairs.push([d + 0.5 + 0.9 * j + 0.3 * R('cool', 'at', j), { ...Sd.snap(2500 + 2000 * R('cool', 'colour', j), 0.004, 0.06), velocity: 0.3 + 0.4 * R('cool', 'level', j), vary: 0.6, pan: -0.6, distance: 0.6 }]);
  for (let j = 0; j < 40; j++) {
    const at = LIFT[0] + 0.5 * ((j + R('peel', 'at', j)) / 40) ** 1.3;
    pairs.push([at, { ...Sd.snap(2200 + 3500 * R('peel', 'colour', j), 0.003 + 0.004 * R('peel', 'length', j), 0.16), velocity: (0.25 + 0.75 * R('peel', 'level', j) ** 1.5) * (1 - 0.5 * j / 40), vary: 0.7, pan: 0.3 * (j / 40) }]);
  }
  pairs.push(...Sd.placed(Sd.swell(R, 'carry', LIFT[0] + 0.2, LIFT[1] - LIFT[0], (u) => 900 + 1500 * Math.sin(Math.PI * u), 0.025, 0.4), { pan: 0.6 }));
  // The water running across the sheet: a wash that rises as the pour reaches it and thins as it fills.
  const poured = WASH[1] - WASH[0];
  pairs.push(...Sd.placed(Sd.swell(R, 'pour', WASH[0], poured + 0.3, (u) => 500 + 900 * Math.sin(Math.PI * Math.min(1, 1.6 * u)) ** 2, 0.05, 0.2), { distance: 0.15 }));
  for (let j = 0; j < 4; j++) {
    const at = WASH[1] + 0.1 + 0.55 * ((j + R('drop', 'at', j)) / 4);
    pairs.push([at, { ...Sd.drop(750 + 500 * R('drop', 'pitch', j), 0.035, 700, 0.05), velocity: 0.4 + 0.5 * R('drop', 'level', j), vary: 0.5, pan: (R('drop', 'pan', j) - 0.5) * 1.2, distance: 0.3 }]);
  }
  for (let j = 0; j < 60; j++) {
    const u = ((j + R('bubble', 'at', j)) / 60) ** 1.3;
    pairs.push([WASH[0] + poured * u, {
      ...Sd.drop(900 + 1700 * R('bubble', 'pitch', j), 0.02 + 0.025 * R('bubble', 'decay', j), 400, 0.05), velocity: (0.2 + 0.7 * R('bubble', 'level', j) ** 1.5) * (1 - 0.5 * u), vary: 0.7, pan: (R('bubble', 'pan', j) - 0.5) * 1.4, distance: 0.3 + 0.6 * R('bubble', 'far', j),
    }]);
  }
  Sd.mix(ctx, R, Sd.place(ctx, R, 'print', pairs, end), { level: 3.5 });
}

/**
 * While the shot is scrolled: the wet print lying in a film of water, a
 * bubble breaking in it here and there, now and then a drop running off the
 * sheet, and at times a slow trickle somewhere along its edge.
 */
sound.ambience = Sd.ambience('print air', (R, loop) => [
  ...Sd.scatter(R, 'bubble', loop, 0.55, (j, swell) => ({
    ...Sd.drop(900 + 1800 * R('bubble', 'pitch', j), 0.02 + 0.03 * R('bubble', 'decay', j), 400, 0.035), velocity: swell * (0.1 + 0.9 * R('bubble', 'level', j) ** 2), vary: 0.7, pan: 1.6 * (R('bubble', 'pan', j) - 0.5), distance: 0.3 + 0.6 * R('bubble', 'far', j),
  })),
  ...Sd.scatter(R, 'drip', loop, 3, (j, swell) => ({
    ...Sd.drop(650 + 500 * R('drip', 'pitch', j), 0.04, 700, 0.04), velocity: swell * (0.4 + 0.6 * R('drip', 'level', j)), vary: 0.6, pan: 1.4 * (R('drip', 'pan', j) - 0.5), distance: 0.4 + 0.4 * R('drip', 'far', j),
  })),
  ...Sd.scatter(R, 'trickle', loop, 5, (j, swell) => swell).flatMap(([at, swell], j) => Sd.placed(
    Sd.swell(R, 'trickle ' + j, at, 1.5, (u) => (700 + 500 * R('trickle', 'colour', j)) * (1 + Math.sin(Math.PI * u)), 0.02 * swell * (0.4 + 0.6 * R('trickle', 'level', j))),
    { pan: 1.2 * (R('trickle', 'pan', j) - 0.5), distance: 0.6 })),
]);

/** Build stage: how far the page must be pulled to leave the frame drawn back. */
function reach(s) {
  const m = s.pageSheet, far = Math.max(...[[-200, -300], [400, -300], [-200, 300], [400, 300]].map((p) => Dr.apply(m, p)[0]));
  s.pullTo = far - (Bp.CLOSE.c[0] - 600 / Bp.CLOSE.z) + 80;
}

module.exports = {
  name: 'site-print',
  size: { w: P.W, h: P.H },
  seed: 1,
  time: { duration: 8, hz: 30 },
  params: E.PARAMS,
  build: [...E.BUILD, ['draft the front view', Dr.draft], ['coat the paper', Bp.coat], ['reach', reach]],
  draw,
  sound,
};
