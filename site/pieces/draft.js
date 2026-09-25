// The draftsman's sheet: the drafting film laid over the portal's doodle, the
// catalog's bird inked on it square, and the frame printed on it. The seams
// after the portal draw it through a camera onto the frame; the sheet has its
// own units, SW by SH, laid out as the CAD style lays a drawing out (see
// skills/artifex/styles/cad.md), the front view at FRONT, SCALE units to one of
// the bird's.
//
// SQUARE, NOT FREEHAND. The doodle's every line is two wobbling passes; the
// film's is one line of drawing ink, the bird's own outline without a wobble,
// each part cut where a part in front of it hides it, as a CAD front view
// hides them, and the branch ruled straight along a T-square.
//
// THE PEN IS THERE BY ITS SHADOW, as the plotter was in the intro: its nib on
// the line, the barrel's shadow cast away from the light and the hand's
// following it a moment late. The T-square is there itself: a clear blade
// across the sheet, with its shadow and its scale.

'use strict';

const { lengthOf, pointInPoly, resample, chaikin } = require('../../core/geom.js');
const { spring, follow } = require('../../core/time.js');
const { keep } = require('./held.js');
const { bird } = require('../../skills/artifex/styles/subject.js');
const E = require('./enter.js');
const I = require('./inversion.js');
const Pg = require('./page.js');

const SW = 1200, SH = 800;        // the sheet, in its own units
const SCALE = 165;                // sheet units to one of the bird's
const FRONT = [330, 482];         // where the front view's bird sits
const PERCH = 0.69;               // the ruled branch, in the bird's units below its middle
const PAGE_BIRD = 40;             // page.js draws the bird at this scale
const PAGE_TURN = -0.04;          // and turned this much

const INK = 'rgba(20, 20, 26, 0.92)';
const LINE = 2.2;                 // the pen's line, in sheet units
const FROST = 'rgba(233, 237, 240, 0.52)';

/** A similarity { a, b, x, y }: p -> [x + a px - b py, y + b px + a py]. */
const apply = (m, p) => [m.x + m.a * p[0] - m.b * p[1], m.y + m.b * p[0] + m.a * p[1]];
const then = (m, n) => ({ a: m.a * n.a - m.b * n.b, b: m.a * n.b + m.b * n.a, x: apply(m, [n.x, n.y])[0], y: apply(m, [n.x, n.y])[1] });
const inverse = (m) => { const d = m.a * m.a + m.b * m.b, a = m.a / d, b = -m.b / d; return { a, b, x: -(a * m.x - b * m.y), y: -(b * m.x + a * m.y) }; };
const scaleOf = (m) => Math.hypot(m.a, m.b);

/** A camera { c, z, turn }: the sheet point `c` at the frame's middle, `z` frame units to a sheet unit, turned by `turn`. As a similarity. */
function shot(v) {
  const a = v.z * Math.cos(v.turn), b = v.z * Math.sin(v.turn);
  return { a, b, x: 600 - (a * v.c[0] - b * v.c[1]), y: 400 - (b * v.c[0] + a * v.c[1]) };
}

/** The camera a similarity `m` is. */
const look = (m) => ({ c: apply(inverse(m), [600, 400]), z: scaleOf(m), turn: Math.atan2(m.b, m.a) });

/** The camera `u` of the way from `p` to `q`, zooming evenly in scale. */
const towards = (p, q, u) => ({ c: [p.c[0] + (q.c[0] - p.c[0]) * u, p.c[1] + (q.c[1] - p.c[1]) * u], z: p.z * (q.z / p.z) ** u, turn: p.turn + (q.turn - p.turn) * u });

/**
 * `paint(g, s)`, in sheet units and opaque over the frame, kept at camera `v`
 * (and the device's own transform): { copy, m }, the copy null on a surface
 * that keeps none (see held.js keep).
 */
function copyAt(g, s, key, v, paint) {
  const w = shot(v);
  g.save();
  g.transform(w.a, w.b, -w.b, w.a, w.x, w.y);
  const m = g.getTransform(), copy = keep(g, s, key, paint);
  g.restore();
  return { copy, m };
}

/** Lay a copy kept by `copyAt` under the current transform, as if it were painted there. */
function put(g, { copy, m }) {
  const t = g.getTransform().multiply(m.inverse());
  g.save();
  g.setTransform(t.a, t.b, t.c, t.d, t.e, t.f);
  g.drawImage(copy, 0, 0);
  g.restore();
}

/** The least-squares similarity taking points `src` to `dst`. */
function fit(src, dst) {
  const n = src.length;
  let mx = 0, my = 0, nx = 0, ny = 0;
  src.forEach((q, i) => { mx += q[0]; my += q[1]; nx += dst[i][0]; ny += dst[i][1]; });
  mx /= n; my /= n; nx /= n; ny /= n;
  let sa = 0, sb = 0, ss = 0;
  src.forEach((q, i) => {
    const x = q[0] - mx, y = q[1] - my, X = dst[i][0] - nx, Y = dst[i][1] - ny;
    sa += x * X + y * Y; sb += x * Y - y * X; ss += x * x + y * y;
  });
  const a = sa / ss, b = sb / ss;
  return { a, b, x: nx - (a * mx - b * my), y: ny - (b * mx + a * my) };
}

/** The parts of closed or open polyline `pts` outside every polygon in `over`, as runs. */
function outside(pts, over, close) {
  const even = resample(pts, 0.004, close);
  const runs = [];
  let run = null;
  for (const p of even) {
    if (over.some((poly) => pointInPoly(p, poly))) { run = null; continue; }
    if (!run) runs.push(run = []);
    run.push(p);
  }
  // A closed outline cut nowhere is one run; one cut somewhere joins its two ends.
  if (close && runs.length > 1 && !over.some((poly) => pointInPoly(even[0], poly)) && !over.some((poly) => pointInPoly(even[even.length - 1], poly))) {
    runs[0] = runs.pop().concat(runs[0]);
  }
  return runs.filter((r) => r.length > 1);
}

/**
 * Build stage, after the portal's: the camera the seams begin with, the
 * similarity that lays the page flat, and the front view's lines in the
 * order and at the times the pen inks them.
 */
function draft(s) {
  // Where the doodled bird lies in the portal's last frame, and the page laid flat under it.
  const cam = E.camera(s, E.END);
  const toSheet = (p) => I.invert(cam.portal, cam.map(p));
  const unit = bird(0, 0, 1), paged = bird(0, 0, PAGE_BIRD, PAGE_TURN);
  const parts = ['body', 'wing', 'tail', 'beak'];
  s.flat = fit(parts.flatMap((k) => paged[k]), parts.flatMap((k) => paged[k].map(toSheet)));
  // The film's units to the frame: the front view's bird lands on the doodled one.
  const lens = { a: cam.z, b: 0, x: cam.tx, y: cam.ty };
  const page = { a: PAGE_BIRD * Math.cos(PAGE_TURN), b: PAGE_BIRD * Math.sin(PAGE_TURN), x: 0, y: 0 };
  const front = { a: 1 / SCALE, b: 0, x: -FRONT[0] / SCALE, y: -FRONT[1] / SCALE };
  s.traced = then(lens, then(s.flat, then(page, front)));
  // The film slides in from beyond the frame's far edge.
  const back = inverse(s.traced);
  // The page, laid flat, in the sheet's units.
  s.pageSheet = then(back, then(lens, s.flat));
  s.filmFrom = Math.max(...[[0, 0], [1200, 0], [0, 800], [1200, 800]].map((p) => apply(back, p)[0])) + 30;
  // The pen leaves past the frame's top right corner.
  s.penAway = apply(back, [1320, -140]);
  // The T-square comes up from just below the frame.
  s.bladeFrom = Math.max(...[[0, 0], [1200, 0], [0, 800], [1200, 800]].map((p) => apply(back, p)[1])) + 12;
  // The set square comes in along the T-square from beyond the frame's right
  // edge and leaves up past its top right; the template comes in from below.
  const right = Math.max(...[[0, 0], [1200, 0], [0, 800], [1200, 800]].map((p) => apply(back, p)[0]));
  s.squareFrom = { x: right + 40, y: FRONT[1] + PERCH * SCALE, turn: -Math.PI / 2, side: -1 };
  s.squareAway = { x: right + 180, y: apply(back, [1200, -300])[1], turn: -Math.PI / 2 - 0.6, side: -1 };
  s.templateFrom = [apply(back, [700, 1000])[0], s.bladeFrom + 60];
  s.templateAway = [apply(back, [1300, 950])[0], s.bladeFrom + 60];

  // The front view, back to front: each part cut where a part laid after it
  // covers it. Every straight line is ruled against an instrument: the branch
  // along the T-square, the legs along a set square standing on it, the beak's
  // sides along the set square alone; the eye is inked round a template's
  // hole; the curves freehand.
  const F = (p) => [FRONT[0] + p[0] * SCALE, FRONT[1] + p[1] * SCALE];
  const eye = [];
  for (let i = 0; i <= 48; i++) { const a = -Math.PI / 2 + (i / 48) * Math.PI * 2; eye.push([unit.eye[0] + Math.cos(a) * EYE, unit.eye[1] + Math.sin(a) * EYE]); }
  const tail = chaikin(unit.tail, 2, true);
  const [ba, bb, bc] = unit.beak;
  const legs = unit.legs.map((leg) => outside([[leg[0][0], PERCH], [leg[0][0], leg[0][1] - 0.1]], [unit.body], false)[0]).reverse();
  const steps = [
    { name: 'perch', pts: [F([-1.02, PERCH]), F([1.28, PERCH])], tool: 'blade' },
    ...legs.map((pts, i) => ({ name: 'leg' + i, pts: pts.map(F), tool: 'square' })),
    { name: 'beak', pts: [F(ba), F(bb)], tool: 'square' },
    { name: 'beak', pts: [F(bb), F(bc)], tool: 'square' },
    { name: 'beak', pts: [F(bc), F(ba)], tool: 'square' },
    { name: 'eye', pts: eye.map(F), tool: 'template' },
  ];
  // Then the curves, each from the end of the last, the nearest next, either way round.
  const left = [];
  for (const [name, pts, over] of [['tail', tail, [unit.body]], ['body', unit.body, [unit.wing, unit.beak]], ['wing', unit.wing, []]]) {
    for (const run of outside(pts, over, true)) left.push({ name, pts: run.map(F), tool: null });
  }
  while (left.length) {
    const last = steps[steps.length - 1].pts, at = last[last.length - 1];
    let best = 0, flip = false, d = Infinity;
    left.forEach((r, i) => {
      for (const [p, f] of [[r.pts[0], false], [r.pts[r.pts.length - 1], true]]) {
        const e = Math.hypot(p[0] - at[0], p[1] - at[1]);
        if (e < d) { d = e; best = i; flip = f; }
      }
    });
    const r = left.splice(best, 1)[0];
    steps.push(flip ? { ...r, pts: r.pts.slice().reverse() } : r);
  }
  // The pen's pace, and the instruments': each is set before its line is ruled.
  // The set square lies away from what it rules: the body for a leg, the beak for its sides.
  const centre = F([0, 0]), beak = F([(ba[0] + bb[0] + bc[0]) / 3, (ba[1] + bb[1] + bc[1]) / 3]);
  let t = INK_FROM, at = steps[0].pts[0], tool = 'blade';
  s.square = [];
  s.template = [];
  s.ink = steps.map((r, i) => {
    const len = lengthOf(r.pts);
    let t0 = t + Math.hypot(r.pts[0][0] - at[0], r.pts[0][1] - at[1]) / 1500 + 0.06;
    if (r.tool === 'square') {
      s.square.push({ at: t + 0.02, pose: along(r.pts[0], r.pts[1], r.name === 'beak' ? beak : centre, r.name.startsWith('leg')) });
      t0 = Math.max(t0, t + (s.square.length === 1 ? 0.62 : 0.42));
    }
    if (r.tool === 'template') {
      s.template.push({ at: t - 0.1, pose: [r.pts[0][0], r.pts[0][1] + EYE * SCALE] });
      t0 = Math.max(t0, t + 0.45);
    }
    if (tool === 'template' && r.tool !== 'template') s.template.push({ at: t + 0.05, pose: s.templateAway });
    if (tool === 'square' && r.tool !== 'square') s.square.push({ at: t + 0.05, pose: s.squareAway });
    tool = r.tool;
    t = t0 + len / (r.tool ? 620 : 600) + 0.04;
    at = r.pts[r.pts.length - 1];
    const cum = [0];
    for (let j = 1; j < r.pts.length; j++) cum.push(cum[j - 1] + Math.hypot(r.pts[j][0] - r.pts[j - 1][0], r.pts[j][1] - r.pts[j - 1][1]));
    return { ...r, ruled: !!r.tool, len, cum, t0, t1: t };
  });
  // The T-square leaves once the legs are ruled.
  s.bladeOff = s.ink.filter((r) => r.name.startsWith('leg')).pop().t1 + 0.05;
  s.inked = s.ink[s.ink.length - 1].t1;
}

const INK_FROM = 2.45;            // the pen comes down on the branch
const EYE = 0.05;                 // the eye's radius, in the bird's units
const SQUARE = 150;               // the set square's legs, in sheet units
const LEAVE = 1.6;                // the pen takes this long to leave the frame after its last line (on into the print)

/**
 * The set square laid to rule from `a` to `b`: its working edge along the
 * line from a little before `a`, its body on the side away from `centre`
 * (a leg's: standing on the T-square, its base along it).
 */
function along(a, b, centre, standing) {
  const turn = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const ux = Math.cos(turn), uy = Math.sin(turn);
  const side = (centre[0] - a[0]) * -uy + (centre[1] - a[1]) * ux > 0 ? 1 : -1;
  const back = standing ? 0 : 24;
  return { x: a[0] - ux * back, y: a[1] - uy * back, turn, side };
}

/** Share of a run inked after `u` of its time: the pen speeds up, runs, slows. */
function travel(u) {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  return u * u * (3 - 2 * u) * 0.35 + u * 0.65;
}

/** The point at arc length `a` along a run, found by halving. */
function pointAt(run, a) {
  const { pts, cum } = run;
  let lo = 1, hi = pts.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < a) lo = mid + 1; else hi = mid; }
  const j = lo;
  const u = cum[j] === cum[j - 1] ? 0 : Math.max(0, Math.min(1, (a - cum[j - 1]) / (cum[j] - cum[j - 1])));
  return [pts[j - 1][0] + (pts[j][0] - pts[j - 1][0]) * u, pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * u];
}

/** Run `run` from its start to arc length `a1`, into the current path. */
function trace(g, run, a1) {
  if (a1 <= 0) return;
  const { pts, cum } = run;
  g.moveTo(pts[0][0], pts[0][1]);
  for (let j = 1; j < pts.length && cum[j] < a1; j++) g.lineTo(pts[j][0], pts[j][1]);
  const [x, y] = pointAt(run, a1);
  g.lineTo(x, y);
}

/** How far into each run the pen has inked by second `sec`. */
const inked = (run, sec) => run.len * travel((sec - run.t0) / (run.t1 - run.t0));

/** Where the nib is at second `sec`, in sheet units, and whether it is on the film. */
function nib(s, sec) {
  const runs = s.ink;
  const enter = [FRONT[0] + 520, FRONT[1] + 260], leave = s.penAway;
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    if (sec < r.t0) {
      const from = i ? runs[i - 1].pts[runs[i - 1].pts.length - 1] : enter;
      const t0 = i ? runs[i - 1].t1 : r.t0 - 0.7;
      const u = Math.max(0, Math.min(1, (sec - t0) / (r.t0 - 0.03 - t0)));
      const e = u * u * (3 - 2 * u);
      return { p: [from[0] + (r.pts[0][0] - from[0]) * e, from[1] + (r.pts[0][1] - from[1]) * e], down: false, lift: Math.sin(Math.PI * e) };
    }
    if (sec <= r.t1) return { p: pointAt(r, inked(r, sec)), down: true, lift: 0 };
  }
  const last = runs[runs.length - 1], a = last.pts[last.pts.length - 1];
  // Lifting off, then away out of the frame, quicker as it goes.
  const u = Math.min(1, (sec - last.t1) / LEAVE), e = u * u;
  return { p: [a[0] + (leave[0] - a[0]) * e, a[1] + (leave[1] - a[1]) * e], down: false, lift: Math.min(1, u * 3) };
}

/** The ink on the film at second `sec`, and the nib on the run it is inking. In sheet units. */
function drawInk(g, s, sec) {
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = INK;
  g.lineWidth = LINE;
  g.beginPath();
  for (const r of s.ink) if (sec > r.t0) trace(g, r, inked(r, sec));
  g.stroke();
  const n = nib(s, sec);
  if (n.down) {
    g.fillStyle = INK;
    g.beginPath();
    g.arc(n.p[0], n.p[1], LINE * 0.75, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

/**
 * The pen's shadow, cast away from the light across the film: the barrel from
 * the nib, and the hand behind it, which trails the nib and passes it when it
 * stops. Drawn in the frame's units, the nib at `at` (sheet units) through `m`.
 */
function drawPen(g, s, sec, m) {
  // The hand trails the nib on a spring and passes it when the nib stops.
  const cue = INK_FROM - 0.8, x = Math.max(0, sec - cue);
  const opts = { stiffness: 110, damping: 0.75 };
  const h = apply(m, [follow((u) => nib(s, cue + u).p[0], opts)(x), follow((u) => nib(s, cue + u).p[1], opts)(x)]);
  const n = nib(s, sec);
  const lx = -Math.cos(s.light), ly = -Math.sin(s.light);
  const tip = apply(m, n.p);
  const k = scaleOf(m), up = 1 + n.lift * 0.6;
  g.save();
  g.lineCap = 'round';
  // The barrel: from just off the nib (further, the higher it is) away from the light, towards the hand.
  const b0 = [tip[0] + lx * 3 * k * up, tip[1] + ly * 3 * k * up];
  const b1 = [h[0] + lx * 62 * k * up, h[1] + ly * 62 * k * up];
  for (const [w, a] of [[8, 0.045], [4.5, 0.06], [2.2, 0.08]]) {
    g.strokeStyle = `rgba(40, 42, 60, ${a / up})`;
    g.lineWidth = w * k * up;
    g.beginPath();
    g.moveTo(b0[0], b0[1]);
    g.lineTo(b1[0], b1[1]);
    g.stroke();
  }
  // The hand holding it: a broad soft shadow beyond the barrel's end.
  const hx = h[0] + lx * 95 * k * up, hy = h[1] + ly * 95 * k * up, r = 62 * k * up;
  const blob = g.createRadialGradient(hx, hy, 0, hx, hy, r);
  blob.addColorStop(0, `rgba(40, 42, 60, ${0.09 / up})`);
  blob.addColorStop(0.6, `rgba(40, 42, 60, ${0.045 / up})`);
  blob.addColorStop(1, 'rgba(40, 42, 60, 0)');
  g.fillStyle = blob;
  g.fillRect(hx - r, hy - r, r * 2, r * 2);
  g.restore();
}

// The T-square: in from below the sheet, up to the branch, and away again.
const BLADE = 38;                 // the blade's width, in sheet units
const bladeUp = spring({ stiffness: 70, damping: 0.8 });
const bladeDown = spring({ stiffness: 45, damping: 1 });

/** Where the T-square blade's working edge lies at second `sec`, in sheet units down the sheet. */
function bladeAt(s, sec) {
  const perch = s.ink[0], rest = FRONT[1] + PERCH * SCALE, away = s.bladeFrom;
  const up = bladeUp(sec - (perch.t0 - 0.75)), down = bladeDown(sec - s.bladeOff);
  return away + (rest - away) * up + (away - rest) * down;
}

/** The T-square's clear blade and its shadow, in sheet units: its working edge at `y`. */
function drawBlade(g, s, y) {
  if (y > s.bladeFrom) return;
  const lx = -Math.cos(s.light) * 7, ly = -Math.sin(s.light) * 7;
  g.save();
  // Its shadow on the film, soft at the far edge.
  g.fillStyle = 'rgba(30, 36, 50, 0.08)';
  g.fillRect(-200 + lx, y + ly + 2, SW + 400, BLADE);
  g.fillStyle = 'rgba(30, 36, 50, 0.06)';
  g.fillRect(-200 + lx, y + ly + 5, SW + 400, BLADE - 6);
  // The acrylic, a shade darker and cooler than what lies under it.
  g.fillStyle = 'rgba(170, 196, 204, 0.16)';
  g.fillRect(-200, y, SW + 400, BLADE);
  // Its edges: the working one bevelled and catching the light, the far one plain.
  g.fillStyle = 'rgba(255, 255, 255, 0.55)';
  g.fillRect(-200, y, SW + 400, 1.2);
  g.fillStyle = 'rgba(60, 80, 90, 0.35)';
  g.fillRect(-200, y + 1.2, SW + 400, 0.8);
  g.fillRect(-200, y + BLADE - 0.8, SW + 400, 0.8);
  // Its scale: a tick every 4 units, longer every 20 and every 40.
  g.strokeStyle = 'rgba(30, 40, 50, 0.45)';
  g.lineWidth = 0.6;
  g.beginPath();
  for (let x = -200; x <= SW + 200; x += 4) {
    const l = x % 40 === 0 ? 9 : x % 20 === 0 ? 6 : 3.5;
    g.moveTo(x, y + 2);
    g.lineTo(x, y + 2 + l);
  }
  g.stroke();
  g.restore();
}

const setting = spring({ stiffness: 130, damping: 0.78 });

/**
 * Where an instrument lies at second `sec`: from `from`, it moves to each
 * key's pose from the key's second on, with weight, starting from wherever
 * the move before had got it to. `mix` blends two poses.
 */
function posed(keys, from, sec, mix) {
  let pose = from;
  for (let i = 0; i < keys.length && sec >= keys[i].at; i++) {
    const start = i ? posed(keys.slice(0, i), from, keys[i].at, mix) : from;
    pose = mix(start, keys[i].pose, setting(sec - keys[i].at));
  }
  return pose;
}

const mixSquare = (p, q, u) => ({ x: p.x + (q.x - p.x) * u, y: p.y + (q.y - p.y) * u, turn: p.turn + (q.turn - p.turn) * u, side: u < 0.5 ? p.side : q.side });
const mixPoint = (p, q, u) => [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u];

/** The set square's pose at second `sec`, or null while it is off the sheet. */
function squareAt(s, sec) {
  if (!s.square.length || sec < s.square[0].at) return null;
  return posed(s.square, s.squareFrom, sec, mixSquare);
}

/** The template's pose at second `sec` (the eye's hole's centre), or null while it is off the sheet. */
function templateAt(s, sec) {
  if (!s.template.length || sec < s.template[0].at) return null;
  return posed(s.template, s.templateFrom, sec, mixPoint);
}

/** Clear acrylic in `path`: its shadow cast away from the light, its tint, its edges. */
function acrylic(g, s, path, tint, lift = 6) {
  const lx = -Math.cos(s.light) * lift, ly = -Math.sin(s.light) * lift;
  g.save();
  g.translate(lx, ly);
  path();
  g.fillStyle = 'rgba(30, 36, 50, 0.09)';
  g.fill('evenodd');
  g.restore();
  path();
  g.fillStyle = tint;
  g.fill('evenodd');
  g.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  g.lineWidth = 1.2;
  g.stroke();
  g.strokeStyle = 'rgba(50, 70, 80, 0.3)';
  g.lineWidth = 0.6;
  g.stroke();
}

/** The set square at `pose`: a clear 45-degree triangle, its working edge along the pose, a hole in its middle and a scale on its edge. */
function drawSquare(g, s, pose) {
  if (!pose) return;
  const L = SQUARE, k = pose.side;
  g.save();
  g.translate(pose.x, pose.y);
  g.rotate(pose.turn);
  acrylic(g, s, () => {
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(L, 0);
    g.lineTo(0, -L * k);
    g.closePath();
    g.moveTo(L * 0.28 + 16, -L * 0.28 * k);
    g.arc(L * 0.28, -L * 0.28 * k, 16, 0, Math.PI * 2);
  }, 'rgba(170, 196, 204, 0.18)');
  g.strokeStyle = 'rgba(30, 40, 50, 0.45)';
  g.lineWidth = 0.6;
  g.beginPath();
  for (let x = 6; x < L - 12; x += 4) {
    const l = x % 20 === 2 ? 7 : 3.5;
    g.moveTo(x, -2 * k);
    g.lineTo(x, -(2 + l) * k);
  }
  g.stroke();
  g.restore();
}

// The circle template's holes, in sheet units from its left end: the eye's is the middle one.
const HOLES = [[26, 3.5], [50, 5.5], [80, EYE * SCALE], [114, 11.5], [152, 15.5]];

/** The circle template, its eye-sized hole at `at`: a clear green plate with holes of five sizes. */
function drawTemplate(g, s, at) {
  if (!at) return;
  g.save();
  g.translate(at[0] - HOLES[2][0], at[1]);
  acrylic(g, s, () => {
    g.beginPath();
    g.roundRect(0, -30, 180, 60, 8);
    for (const [x, r] of HOLES) { g.moveTo(x + r, 0); g.arc(x, 0, r, 0, Math.PI * 2); }
  }, 'rgba(110, 190, 140, 0.22)', 5);
  g.strokeStyle = 'rgba(30, 60, 40, 0.5)';
  g.lineWidth = 0.6;
  g.beginPath();
  for (const [x, r] of HOLES) { g.moveTo(x, -r - 3); g.lineTo(x, -r - 8); g.moveTo(x, r + 3); g.lineTo(x, r + 8); g.moveTo(x - r - 3, 0); g.lineTo(x - r - 8, 0); }
  g.stroke();
  g.restore();
}

/**
 * The film, laid in the sheet's units shifted `dx` along it: its frosted face
 * over whatever lies under it, the light moving on it, its edge and its
 * shadow, and the frame printed on it.
 */
function drawFilm(g, s, dx, sec, lift = 0) {
  const lx = -Math.cos(s.light), ly = -Math.sin(s.light);
  g.save();
  g.translate(dx, 0);
  // The shadow its edges cast on what lies under it: close while it lies on
  // it, further off and softer as it is lifted.
  if (lift > 0) {
    const d = 3 + lift * 60;
    for (let k = 0; k < 4; k++) {
      const grow = k * (4 + lift * 16);
      g.fillStyle = `rgba(20, 24, 40, ${0.07 * Math.min(1, lift * 4)})`;
      g.fillRect(lx * d - grow, ly * d - grow, SW + grow * 2, SH + grow * 2);
    }
  }
  g.strokeStyle = 'rgba(40, 44, 60, 0.10)';
  g.lineWidth = 5;
  g.strokeRect(lx * 2.5, ly * 2.5, SW, SH);
  g.strokeStyle = 'rgba(40, 44, 60, 0.16)';
  g.lineWidth = 1.6;
  g.strokeRect(lx * 1.2, ly * 1.2, SW, SH);
  g.fillStyle = FROST;
  g.fillRect(0, 0, SW, SH);
  // The light on its matte face: a broad soft band drifting as the air moves it.
  const drift = Math.sin(sec * 0.45) * 60 + sec * 14;
  const cx = FRONT[0] + 80 + drift, cy = FRONT[1] - 120;
  const band = g.createLinearGradient(cx - 260 * ly, cy + 260 * lx, cx + 260 * ly, cy - 260 * lx);
  band.addColorStop(0, 'rgba(255, 255, 255, 0)');
  band.addColorStop(0.45, 'rgba(255, 255, 255, 0.09)');
  band.addColorStop(0.55, 'rgba(255, 255, 255, 0.09)');
  band.addColorStop(1, 'rgba(255, 255, 255, 0)');
  g.fillStyle = band;
  g.fillRect(0, 0, SW, SH);
  // Its cut edge catches the light.
  g.strokeStyle = 'rgba(255, 255, 255, 0.7)';
  g.lineWidth = 1;
  g.strokeRect(0.5, 0.5, SW - 1, SH - 1);
  drawBorder(g, INK);
  g.restore();
}

/** The frame printed on the drafting film in `colour`: border and zones. */
function drawBorder(g, colour) {
  g.save();
  g.strokeStyle = colour;
  g.lineWidth = 1.1;
  g.strokeRect(15, 15, SW - 30, SH - 30);
  g.lineWidth = 2.4;
  g.strokeRect(35, 35, SW - 70, SH - 70);
  g.lineWidth = 1.1;
  g.beginPath();
  for (let k = 1; k < 6; k++) { const x = 35 + (k * (SW - 70)) / 6; g.moveTo(x, 15); g.lineTo(x, 35); g.moveTo(x, SH - 35); g.lineTo(x, SH - 15); }
  for (let k = 1; k < 4; k++) { const y = 35 + (k * (SH - 70)) / 4; g.moveTo(15, y); g.lineTo(35, y); g.moveTo(SW - 35, y); g.lineTo(SW - 15, y); }
  g.stroke();
  g.restore();
}

/** Every line on the film, inked whole, in `colour` at `k` times its width: what the film prints. In sheet units. */
function drawLines(g, s, colour, k = 1) {
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = colour;
  g.lineWidth = LINE * k;
  g.beginPath();
  for (const r of s.ink) trace(g, r, r.len);
  g.stroke();
  g.restore();
  drawBorder(g, colour);
}

/** The notebook page, laid flat and moved `dx` along the sheet, in sheet units; only its lines in the frame are drawn. */
function drawPage(g, s, dx) {
  const m = s.pageSheet;
  g.save();
  g.translate(dx, 0);
  g.transform(m.a, m.b, -m.b, m.a, m.x, m.y);
  const back = g.getTransform().inverse(), c = g.canvas;
  const corners = c && typeof c.width === 'number' ? [[0, 0], [c.width, 0], [0, c.height], [c.width, c.height]].map(([x, y]) => back.transformPoint({ x, y })) : null;
  // A margin, so no cap or join of a line just outside reaches in.
  const view = corners && [Math.min(...corners.map((p) => p.x)) - 10, Math.min(...corners.map((p) => p.y)) - 10, Math.max(...corners.map((p) => p.x)) + 10, Math.max(...corners.map((p) => p.y)) + 10];
  // The ruled lines and the margin cross the frame end to end: drawn whole.
  Pg.drawPage(g, s, (p) => p, 1, 0, view, (pg, a, b) => { pg.moveTo(a[0], a[1]); pg.lineTo(b[0], b[1]); });
  g.restore();
}

/** Whether the page, moved `dx` along the sheet, covers the whole frame seen through camera `m`. */
function covers(s, m, dx) {
  const back = inverse(then(m, then({ a: 1, b: 0, x: dx, y: 0 }, s.pageSheet)));
  return [[0, 0], [SW, 0], [0, SH], [SW, SH]].every((p) => pointInPoly(apply(back, p), s.page.marks[0].pts));
}

// Canvases that have met every kind of mark the film makes.
const primed = new WeakSet();

/**
 * Every kind of mark the film, the ink, the T-square and the pen make, drawn
 * once on a canvas that has not met them, before the frame covers them: a
 * GPU-backed canvas pays 25 to 40 ms the first time it meets a kind of mark
 * (see held.js), and the first frame is drawn before the shot is on screen.
 */
function prime(g, s) {
  const c = g.canvas;
  if (!c || typeof c !== 'object' || primed.has(c)) return;
  primed.add(c);
  const m = s.traced;
  g.save();
  g.transform(m.a, m.b, -m.b, m.a, m.x, m.y);
  drawFilm(g, s, 0, 3);
  drawInk(g, s, 4.5);
  drawBlade(g, s, FRONT[1]);
  drawSquare(g, s, { x: FRONT[0], y: FRONT[1], turn: 0.3, side: 1 });
  drawTemplate(g, s, FRONT);
  g.restore();
  drawPen(g, s, 4.5, m);
}

module.exports = { shot, look, towards, copyAt, put, draft, prime, drawLines, drawPage, covers, nib, LEAVE, TRACED: 299 / 30, INK_FROM, drawInk, drawSquare, drawTemplate, squareAt, templateAt, drawPen, drawBlade, bladeAt, drawFilm, apply, then, inverse, scaleOf, SW, SH, FRONT, SCALE };
