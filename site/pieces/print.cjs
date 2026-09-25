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
};
