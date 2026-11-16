// What the box shot and the seam after it share: the score as the contain
// seam left it, the box's sides, its camera, the page's margins and a frame
// of the shot (see box.cjs, which says what the shot is, and close.cjs).

'use strict';

const { span, ease } = require('../../core/time.js');
const P = require('./paper.js');
const Dr = require('./draft.js');
const Hg = require('./hang.js');
const Sk = require('./score.js');
const Fl = require('./fall.js');

const C = Sk.part('contain');
const START = C.start + (C.dur * 30 - 1) / 30;   // the contain seam's last frame, in the score's seconds
const DUR = 6;
const OPEN = [1.0, 2.8];      // the sides move to the box's proportions
const BACK = [0.9, 3.2];      // the camera draws back to the whole frame
const SLIDE = [0.8, 2.0];     // the page's margins slide off
const CHORD = 3.3;
const CLOSED = Sk.pinch(null, Sk.T.close[1]);   // how far in the contain seam closed each side
const WIDEST = -60;           // each side opened this far past the window, the painting still under it
const NARROWEST = 190;        // and closed this far in, the pile still inside the window
const NEARER = 0.07;          // how much closer the camera comes once it has drawn back, by the last frame
const ZOOM = 2.3;            // the camera comes no closer than this, so the kept copies are not blown up
const GROUND = '#efeae0';     // the page's ground, as site.css has it
const ROOT = 57;
const DEGREES = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22];

/** How far in each side stands in box `box`: the box's window takes the box's proportions. */
function target(s) {
  const w = Hg.windowOf(s.hang.k), wide = ((w[3] - w[1]) * s.box.w) / s.box.h;
  return Math.max(WIDEST, Math.min(NARROWEST, (w[2] - w[0] - wide) / 2));
}

/** How far in each side stands at second `sec` of the score. */
function sides(s, sec) {
  if (sec <= Sk.T.close[1]) return Sk.pinch(s, sec);
  return CLOSED + (s.target - CLOSED) * ease.inOut(span(START + OPEN[0], START + OPEN[1], sec));
}

// The score and the fall as the contain seam leaves them depend only on the
// seed and the parameters, so a new box solves only what the box changes:
// the build is kept for the last few recipes, and so is each box's fall.
const bases = new Map(), refits = new Map();
const KEEP = 3, BOXES = 8;

function remember(map, key, value, most) {
  map.delete(key);
  map.set(key, value);
  if (map.size > most) map.delete(map.keys().next().value);
  return value;
}

/** Build stage: the score, the hang and the fall to the contain seam's end, made once per recipe and shared. */
function score(s) {
  const key = s.seed + ' ' + JSON.stringify(s.params || {});
  let b = bases.get(key);
  if (!b) {
    const before = new Set(Object.keys(s));
    for (const [, stage] of Sk.build) stage(s);
    Fl.fall(s, C.start + C.dur);
    b = { from: s, keys: Object.keys(s).filter((k) => !before.has(k)), fall: s.fall };
  }
  remember(bases, key, b, KEEP);
  for (const k of b.keys) s[k] = b.from[k];
  // The fall to the seam's end, not the box's that refit puts in its place.
  s.fall = b.fall;
}

/** Build stage: the sides' place in this box, and the fall going on as they move there. */
function refit(s) {
  s.target = target(s);
  const key = s.seed + ' ' + JSON.stringify(s.params || {}) + ' ' + s.box.w + 'x' + s.box.h;
  let fall = refits.get(key);
  if (!fall) {
    Fl.onward(s, START + DUR + 0.1, (now) => sides(s, now), START + OPEN[0]);
    fall = s.fall;
  }
  s.fall = remember(refits, key, fall, BOXES);
}

/** The camera that shows the box's whole frame in the box, a strip of the table round it. */
function framed(s) {
  const w = Hg.windowOf(s.hang.k), rim = 2 * (Hg.MAT + Hg.MOULD);
  const ow = w[2] - w[0] - 2 * s.target + rim, oh = w[3] - w[1] + rim;
  return { c: [(w[0] + w[2]) / 2, (w[1] + w[3]) / 2], z: Math.min((0.9 * s.box.w) / ow, (0.88 * s.box.h) / oh, ZOOM), turn: 0 };
}

/** The camera at second `sec` of the shot: from the score's, held as a hand holds it, back to the whole frame. */
function camera(s, sec) {
  const at = START + sec, held = Sk.camera(s, at), home = Sk.stage(s), f = framed(s);
  // The hand's drift goes on over the frame, as the score's camera drifts over the painting.
  // Arrived, it goes on closing in on the pile, slowly, still moving at the last frame.
  const near = 1 + NEARER * ease.out(span(BACK[1], DUR + 1.5, sec));
  const to = { c: [f.c[0] + held.c[0] - home.c[0], f.c[1] + held.c[1] - home.c[1] + 12 * (near - 1) / NEARER], z: f.z * (held.z / home.z) * near, turn: 0 };
  const v = Dr.towards(held, to, ease.inOut(span(BACK[0], BACK[1], sec)));
  return { ...v, half: [s.box.w / 2, s.box.h / 2] };
}

/**
 * The page's margins: where the box is wider or taller than the old
 * picture, the ground that framed it, lying over the table; from SLIDE on it
 * slides off to the window's edges, its inner edge casting a soft shadow.
 */
function margins(g, s, sec, ox, oy) {
  const W = s.box.w, H = s.box.h, go = ease.in(span(SLIDE[0], SLIDE[1], sec));
  if (go >= 1 || (ox <= 0 && oy <= 0)) return;
  const lift = Math.sin(Math.PI * Math.min(1, go * 1.6)) * 0.35;
  // Each panel: [x0, y0, x1, y1] at rest, and the way it slides off.
  const panels = [];
  if (ox > 0) panels.push([0, 0, ox, H, -1, 0], [W - ox, 0, W, H, 1, 0]);
  if (oy > 0) panels.push([ox, 0, W - ox, oy, 0, -1], [ox, H - oy, W - ox, H, 0, 1]);
  for (const [x0, y0, x1, y1, nx, ny] of panels) {
    const d = go * ((nx ? x1 - x0 : y1 - y0) + 40), dx = nx * d, dy = ny * d;
    const a = [x0 + dx, y0 + dy, x1 + dx, y1 + dy];
    if (lift > 0.01) {
      // Its shadow on the table, along the edge it leaves behind.
      const e = nx < 0 ? a[2] : nx > 0 ? a[0] : ny < 0 ? a[3] : a[1], reach = 26;
      const grad = nx ? g.createLinearGradient(e, 0, e - nx * reach, 0) : g.createLinearGradient(0, e, 0, e - ny * reach);
      grad.addColorStop(0, `rgba(10, 7, 4, ${lift.toFixed(3)})`);
      grad.addColorStop(1, 'rgba(10, 7, 4, 0)');
      g.fillStyle = grad;
      if (nx) g.fillRect(Math.min(e, e - nx * reach), a[1], reach, a[3] - a[1]);
      else g.fillRect(a[0], Math.min(e, e - ny * reach), a[2] - a[0], reach);
    }
    g.fillStyle = GROUND;
    g.fillRect(a[0], a[1], a[2] - a[0], a[3] - a[1]);
  }
}

function draw(g, s, t, clock) {
  const sec = clock.seconds, at = START + sec, d = g.getTransform ? g.getTransform() : null, dev = d ? Math.hypot(d.a, d.b) : 1;
  // The old picture sits in the middle of the box, on whole multiples of four
  // device pixels, so the painting's kept copy is the contain seam's own. A
  // box whose size was rounded gives a scale a hair off the seam's (0.97497
  // against 0.975 on a phone), which keyed a second set of copies, so the
  // picture is drawn a whole number of device pixels wide, as the seam drew it.
  const snap = (x) => (Math.round((x * dev) / 4) * 4) / dev, ox = snap((s.box.w - P.W) / 2), oy = snap((s.box.h - P.H) / 2);
  const whole = Math.round(dev * P.W) / (dev * P.W);
  g.save();
  g.translate(ox, oy);
  g.scale(whole, whole);
  Sk.draw(g, s, at, camera(s, sec), 1, sides(s, at));
  g.restore();
  margins(g, s, sec, ox, oy);
}

module.exports = { START, DUR, OPEN, CHORD, CLOSED, WIDEST, NARROWEST, ROOT, DEGREES, score, refit, sides, camera, framed, draw };
