// The envelope the box closes into, for the close seam and the shot after it
// (see close.cjs and home.cjs). It begins on the box shot's last frame, at the
// box the visitor has: the framed box on the table, the pile at rest in it.
//
// THE BACKING PAPER IS THE ENVELOPE. A framed work has a sheet of paper
// behind it. That sheet slides out from under the frame, a side at a time,
// and each side folds up and over the frame: the two long sides first, then
// the foot, then the pointed flap at the head. Nothing appears: each flap
// comes out from under the frame's own edge and turns about that edge.
//
// A flap turning is drawn as it projects: its length across the fold goes
// with the cosine of its angle, it is lit by how it faces the light, and its
// shadow falls as far from it as it stands high.
//
// THE LABEL IS WRITTEN, NOT PRINTED. On the foot flap's outer face is a
// label. Once the envelope lies closed, the plotter from the intro comes
// back, seen by its shadow, and writes the recipe on it: the name, the seed
// and the box. The recipe is the state's own, so the label is true.

'use strict';

const { span, ease } = require('../../core/time.js');
const { glyph } = require('../../core/stroke-font.js');
const { soft } = require('./held.js');
const P = require('./paper.js');
const Dr = require('./draft.js');
const Hg = require('./hang.js');
const Sk = require('./score.js');
const Bx = require('./boxed.js');
const Sd = require('./sounds.js');
const { rng } = require('../../core/rand.js');

const LAST = Bx.DUR - 1 / 30;      // the box shot's last frame, this clock's zero
const CLOSE = 7;                   // the close seam's length
const HOME = 8;                    // and the home shot's, which begins on the seam's last frame
const RIM = 6;                     // the paper shows this far beyond the frame
const BACK = [1.6, 8.4];          // the camera draws back as the long sides close, and on past the last flap
const FAR = 0.72;                  // to this share of its size, the label still large enough to read

// The paper's own surface, laid once per seed: its light, its formation and its tooth (see paper.js).
const sheets = new Map();
function sheet(s) {
  if (typeof OffscreenCanvas !== 'function' || !s.tooth) return null;
  let c = sheets.get(s.seed);
  if (!c) {
    c = new OffscreenCanvas(P.W, P.H);
    P.ground(c.getContext('2d'), s);
    sheets.clear();
    sheets.set(s.seed, c);
  }
  return c;
}
const INSIDE = '#e6dfd0';          // the paper's inner face, a shade under the outer one
const WRITE = [8.8, 12.6];         // the pen's first mark on the label and its last
const PARK = 0.7;                  // seconds the gantry takes to come and to leave

// Each flap: the side it turns about, when it slides out from under the
// frame and when it folds over, its length as a share of the envelope across
// the fold, and its outline's free end as shares of its hinge.
const FLAPS = [
  { side: 'left', out: [0.5, 1.5], over: [1.4, 2.5], long: 0.56, end: [0.05, 0.95] },
  { side: 'right', out: [0.8, 1.8], over: [1.8, 2.9], long: 0.56, end: [0.05, 0.95] },
  { side: 'foot', out: [2.6, 3.3], over: [3.2, 4.1], long: 0.62, end: [0.36, 0.64] },
  { side: 'head', out: [3.8, 4.4], over: [4.3, 5.3], long: 0.6, end: [0.5, 0.5] },
];

/** The envelope's rectangle in the sheet's units: the box's frame as the shot left it, and a rim of paper. */
function rect(s) {
  const w = Hg.windowOf(s.hang.k);
  return Hg.grow([w[0] + s.target, w[1], w[2] - s.target, w[3]], Hg.MAT + Hg.MOULD + RIM);
}

/** A flap's hinge: its start, the unit vector along it, the unit vector out of the envelope, its length, and the flap's own. */
function hinge(r, f) {
  const w = r[2] - r[0], h = r[3] - r[1];
  if (f.side === 'left') return { o: [r[0], r[1]], along: [0, 1], out: [-1, 0], span: h, long: w * f.long };
  if (f.side === 'right') return { o: [r[2], r[1]], along: [0, 1], out: [1, 0], span: h, long: w * f.long };
  if (f.side === 'foot') return { o: [r[0], r[3]], along: [1, 0], out: [0, 1], span: w, long: h * f.long };
  return { o: [r[0], r[1]], along: [1, 0], out: [0, -1], span: w, long: h * f.long };
}

/** Build stage: the label on the foot flap's outer face, and the lines the pen writes on it, each with its seconds. */
function address(s) {
  const r = rect(s), foot = hinge(r, FLAPS[2]);
  // The label, as the flap lies folded: across the envelope's middle, on the flap's flat part.
  const lw = Math.min(foot.span * 0.42, (foot.long * 0.6) / 0.42), lh = lw * 0.42, cx = (r[0] + r[2]) / 2, cy = r[3] - foot.long * 0.42;
  const box = [cx - lw / 2, cy - lh / 2, cx + lw / 2, cy + lh / 2];
  const rows = ['ARTIFEX', 'SEED ' + s.seed, 'BOX ' + s.box.w + ' X ' + s.box.h];
  const cap = lh * 0.17, k = cap / 7, step = 5.4 * k, pitch = lh * 0.29;
  const lines = [];
  rows.forEach((row, n) => {
    let pen = cx - (row.length * step - 1.4 * k) / 2;
    const y = box[1] + lh * 0.13 + n * pitch;
    for (const ch of row) {
      for (const run of glyph(ch)) lines.push(run.map(([u, v]) => [pen + u * k, y + v * k]));
      pen += step;
    }
  });
  // The pen's own schedule, stretched to lift off its last line at WRITE's end.
  let t = 0, at = lines[0][0];
  const raw = lines.map((pts) => {
    const cum = [0];
    for (let j = 1; j < pts.length; j++) cum.push(cum[j - 1] + Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]));
    const len = cum[cum.length - 1];
    t += Math.hypot(pts[0][0] - at[0], pts[0][1] - at[1]) / (60 * cap) + 0.04;
    const t0 = t;
    t += len / (22 * cap) + 0.03;
    at = pts[pts.length - 1];
    return { pts, cum, len, t0, t1: t };
  });
  const time = (x) => WRITE[0] + (x / t) * (WRITE[1] - WRITE[0]);
  s.label = { box, cap, lines: raw.map((l) => ({ ...l, t0: time(l.t0), t1: time(l.t1) })) };
}

/** The camera at second `e` of this clock: the box shot's, going on, drawn back once the envelope is closed. */
function camera(s, e) {
  const v = Bx.camera(s, LAST + e), k = 1 - (1 - FAR) * ease.inOut(span(BACK[0], BACK[1], e));
  return { ...v, z: v.z * k };
}

/** A flap's outline at distance `d` from its hinge as it stands: [x, y] of the point `a` along the hinge and `d` across. */
const at = (h, a, d) => [h.o[0] + h.along[0] * a + h.out[0] * d, h.o[1] + h.along[1] * a + h.out[1] * d];

/** Where the foot flap carries the label's `py` as it turns: folded flat (k = -1) where address put it, its distance from the hinge going with `k`. */
const carried = (s, k) => { const foot = rect(s)[3]; return (py) => foot + (foot - py) * k; };

/**
 * The flaps at second `e`, over the frame: each slid out from under its
 * edge, turning about it or lying folded, with its shadow, lit from
 * (lx, ly). In the sheet's units.
 */
function drawFlaps(g, s, e, lx, ly) {
  const r = rect(s), paper = sheet(s);
  for (const f of FLAPS) {
    const h = hinge(r, f), slid = ease.inOut(span(f.out[0], f.out[1], e));
    if (slid <= 0) continue;
    const turn = Math.PI * ease.inOut(span(f.over[0], f.over[1], e)), k = Math.cos(turn), up = Math.sin(turn);
    const [e0, e1] = f.end, L = h.long;
    // Sliding out, the flap's free end leads: what has passed the frame's edge shows, the rest is still under it.
    const hid = L * (1 - slid), far = (L - hid) * k;
    const pts = [at(h, h.span * e0 * (hid / L), 0), at(h, h.span * (1 - (1 - e1) * (hid / L)), 0), at(h, h.span * e1, far), at(h, h.span * e0, far)];
    const path = (cg, dx = 0, dy = 0) => {
      cg.beginPath();
      cg.moveTo(pts[0][0] + dx, pts[0][1] + dy);
      for (let i = 1; i < pts.length; i++) cg.lineTo(pts[i][0] + dx, pts[i][1] + dy);
      cg.closePath();
    };
    // Its shadow: as far from it as it stands high, and under a folded flap the thickness of the paper.
    const high = 0.45 * L * slid * up + 3;
    soft(g, 4, (sg) => {
      sg.fillStyle = `rgba(12, 9, 6, ${(0.2 + 0.25 * up).toFixed(3)})`;
      path(sg, -lx * high, -ly * high);
      sg.fill();
    });
    const outer = k < 0;
    g.fillStyle = outer ? P.PAPER : INSIDE;
    path(g);
    g.fill();
    if (paper) {
      // The sheet's own surface, the same sheet across every flap; its inner face a shade under.
      g.save();
      path(g);
      g.clip();
      g.globalAlpha = outer ? 1 : 0.8;
      g.drawImage(paper, r[0], r[1], r[2] - r[0], r[3] - r[1]);
      g.restore();
    }
    // Lit by how it faces the light: its upper face leans in as it rises, its outer face leans out as it comes down.
    const lean = (outer ? 1 : -1) * (h.out[0] * lx + h.out[1] * ly) * up;
    g.fillStyle = lean > 0 ? `rgba(255, 252, 244, ${(0.45 * lean).toFixed(3)})` : `rgba(24, 18, 12, ${(-0.3 * lean).toFixed(3)})`;
    path(g);
    g.fill();
    g.strokeStyle = 'rgba(40, 32, 22, 0.22)';
    g.lineWidth = 1.2;
    path(g);
    g.stroke();
    if (f.side === 'foot' && outer) drawLabel(g, s, e, carried(s, k));
  }
}

/** The label on the foot flap's outer face, and what the pen has written on it by second `e`. */
function drawLabel(g, s, e, on) {
  const { box, cap, lines } = s.label, y0 = on(box[3]), y1 = on(box[1]);
  g.fillStyle = '#fbf8f1';
  g.fillRect(box[0], Math.min(y0, y1), box[2] - box[0], Math.abs(y1 - y0));
  g.strokeStyle = 'rgba(40, 32, 22, 0.25)';
  g.lineWidth = 1;
  g.strokeRect(box[0], Math.min(y0, y1), box[2] - box[0], Math.abs(y1 - y0));
  const live = lines.filter((l) => e >= l.t0);
  if (!live.length) return;
  const reach = (l, sec) => l.len * Math.max(0, Math.min(1, (sec - l.t0) / (l.t1 - l.t0)));
  const trace = (l, a0, a1) => {
    if (a1 <= a0) return;
    let started = false;
    for (let j = 0; j < l.pts.length; j++) {
      if (l.cum[j] < a0) continue;
      if (l.cum[j] > a1) break;
      if (!started) { g.moveTo(l.pts[j][0], on(l.pts[j][1])); started = true; }
      else g.lineTo(l.pts[j][0], on(l.pts[j][1]));
    }
    const j = l.cum.findIndex((c) => c >= a1);
    if (j > 0) {
      const u = (a1 - l.cum[j - 1]) / Math.max(1e-6, l.cum[j] - l.cum[j - 1]), p = l.pts[j - 1], q = l.pts[j];
      const x = p[0] + (q[0] - p[0]) * u, y = on(p[1] + (q[1] - p[1]) * u);
      if (started) g.lineTo(x, y); else g.moveTo(x, y);
    }
  };
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = cap / 6;
  g.strokeStyle = P.wash(0.88);
  g.beginPath();
  for (const l of live) trace(l, 0, reach(l, e));
  g.stroke();
  // A fresh line lies darker until it soaks in.
  g.strokeStyle = P.wash(0.4);
  g.beginPath();
  for (const l of live) trace(l, reach(l, e - 0.45), reach(l, e));
  g.stroke();
  g.restore();
}

/** Where the pen is at second `e`: parked off the sheet's left, on the label, or leaving. */
function penAt(s, e) {
  const { lines, box } = s.label, r = rect(s), park = [r[0] - 2.2 * (r[2] - r[0]), box[1]];
  const first = lines[0].pts[0], last = lines[lines.length - 1];
  if (e < WRITE[0]) { const u = ease.inOut(span(WRITE[0] - PARK, WRITE[0], e)); return [park[0] + (first[0] - park[0]) * u, first[1]]; }
  if (e > WRITE[1]) { const u = ease.inOut(span(WRITE[1], WRITE[1] + PARK, e)), p = last.pts[last.pts.length - 1]; return [p[0] + (park[0] - p[0]) * u, p[1]]; }
  let l = lines[0];
  for (const one of lines) if (one.t0 <= e) l = one;
  const a = l.len * Math.max(0, Math.min(1, (e - l.t0) / (l.t1 - l.t0))), j = Math.max(1, l.cum.findIndex((c) => c >= a));
  const u = (a - l.cum[j - 1]) / Math.max(1e-6, l.cum[j] - l.cum[j - 1]), p = l.pts[j - 1], q = l.pts[j] || p;
  return [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u];
}

/** The plotter over the envelope, seen by the light it blocks, as in the intro: the gantry at the pen's x and the carriage over the nib. */
function drawPlotter(g, s, e, lx, ly) {
  if (e < WRITE[0] - PARK || e > WRITE[1] + PARK) return;
  const [x, y] = penAt(s, e), r = rect(s), wide = (r[2] - r[0]) * 0.07, gx = x - lx * wide * 0.4;
  const band = g.createLinearGradient(gx - wide, 0, gx + wide, 0);
  band.addColorStop(0, 'rgba(70, 56, 38, 0)');
  band.addColorStop(0.4, 'rgba(70, 56, 38, 0.08)');
  band.addColorStop(0.6, 'rgba(70, 56, 38, 0.08)');
  band.addColorStop(1, 'rgba(70, 56, 38, 0)');
  g.fillStyle = band;
  g.fillRect(gx - wide, r[1] - 3 * (r[3] - r[1]), 2 * wide, 7 * (r[3] - r[1]));
  const cx = x - lx * wide * 0.35, cy = y - ly * wide * 0.35, blob = g.createRadialGradient(cx, cy, 0, cx, cy, wide * 0.45);
  blob.addColorStop(0, 'rgba(60, 48, 32, 0.16)');
  blob.addColorStop(1, 'rgba(60, 48, 32, 0)');
  g.fillStyle = blob;
  g.fillRect(cx - wide, cy - wide, 2 * wide, 2 * wide);
}

/** A frame at second `e` of this clock: the box as the shot left it, the flaps over it, the label and the plotter. */
function frame(g, s, e) {
  const d = g.getTransform ? g.getTransform() : null, dev = d ? Math.hypot(d.a, d.b) : 1, v = camera(s, e), m = Dr.shot(v);
  // The old picture in the middle of the box, on whole device pixels, as the box shot lays it.
  const snap = (x) => (Math.round((x * dev) / 4) * 4) / dev, ox = snap((s.box.w - P.W) / 2), oy = snap((s.box.h - P.H) / 2);
  const whole = Math.round(dev * P.W) / (dev * P.W), a = s.light + (0.35 * (Sk.WALL + Bx.START + LAST + e)) / Hg.WALL_SECONDS;
  g.save();
  g.translate(ox, oy);
  g.scale(whole, whole);
  Sk.draw(g, s, Bx.START + LAST + e, v, 1, Bx.sides(s, Bx.START + LAST + e));
  g.transform(m.a, m.b, -m.b, m.a, m.x, m.y);
  drawFlaps(g, s, e, Math.cos(a), Math.sin(a));
  drawPlotter(g, s, e, Math.cos(a), Math.sin(a));
  g.restore();
}

/**
 * Heard, from second `from` of this clock for `seconds`, mixed at `level`: each side of the
 * backing paper sliding out from under the frame, a long dry hiss; its fold
 * over, a soft sweep of paper through the air, and its landing, a flat pat
 * and the crease giving in a few fine ticks; then the gantry's breath as it
 * comes and goes, and the pen on the label, a tap and a scratch a letter.
 */
function sound(from, seconds, level) {
  return (ctx, s) => {
    const R = rng(s.seed), end = ctx.length / ctx.sampleRate, pairs = [], r = rect(s);
    const put = (e, spec) => { if (e >= from && e < from + seconds) pairs.push([e - from, spec]); };
    FLAPS.forEach((f, i) => {
      const h = hinge(r, f), pan = Sd.panX(600 + 500 * h.out[0]), slide = f.out[1] - f.out[0], turn = f.over[1] - f.over[0];
      put(f.out[0], { ...Sd.breath(2200 + 500 * R('slide', 'colour', i), 0.08, slide, 0.07), sweep: [[0, 3800], [slide, 1800]], velocity: 0.8, vary: 0.5, pan, distance: 0.15 });
      put(f.over[0] + 0.1 * turn, { ...Sd.breath(900, 0.2, 0.7 * turn, 0.06), sweep: [[0, 500], [0.35 * turn, 1700], [0.7 * turn, 600]], velocity: 0.8, vary: 0.5, pan: pan * 0.5, distance: 0.1 });
      const land = f.over[0] + 0.86 * turn;
      put(land, { ...Sd.snap(480 + 160 * R('pat', 'colour', i), 0.03, 0.3), velocity: 0.9, vary: 0.5, pan: pan * 0.3, distance: 0.05 });
      for (let j = 0; j < 5; j++) {
        put(land + 0.03 + 0.05 * j * (1 + 0.5 * R('crease', 'at', i * 8 + j)), { ...Sd.snap(2600 + 2600 * R('crease', 'colour', i * 8 + j), 0.003, 0.25), velocity: 0.55 * 0.75 ** j * (0.5 + 0.5 * R('crease', 'level', i * 8 + j)), vary: 0.7, pan: pan * (0.2 + 0.6 * R('crease', 'pan', i * 8 + j)), distance: 0.1 });
      }
    });
    for (const [e, a, b] of [[WRITE[0] - PARK, 300, 700], [WRITE[1], 700, 280]]) put(e, { ...Sd.breath(380, 0.1, PARK, 0.05), sweep: [[0, a], [PARK, b]], velocity: 0.7, pan: -0.6, distance: 0.4 });
    // One mark in three: few enough that the stage builds the soundtrack between two frames while the film plays.
    s.label.lines.forEach((l, i) => {
      if (i % 3) return;
      put(l.t0 - 0.02, { ...Sd.snap(420 * (0.8 + 0.4 * R('down', 'colour', i)), 0.012, 0.3), velocity: 0.45 + 0.3 * R('down', 'level', i), vary: 0.6, pan: 0, distance: 0.1 });
      put(l.t0, { ...Sd.snap(2600 + 2400 * R('nib', 'colour', i), 0.004 + 0.01 * R('nib', 'length', i), 0.2), velocity: 0.35 + 0.5 * R('nib', 'level', i), vary: 0.7, pan: 0, distance: 0.1 });
    });
    Sd.mix(ctx, R, Sd.place(ctx, R, 'envelope', pairs, end), { level });
  };
}

/**
 * While either shot is scrolled: an envelope lying on a table in a quiet
 * room. Its paper ticks as a fold relaxes, the table gives a soft low tap,
 * and at times a slow dark breath of the room, far off.
 */
const air = Sd.ambience('envelope air', (R, loop) => [
  ...Sd.scatter(R, 'fold', loop, 0.8, (j, swell) => ({
    ...Sd.snap(2400 + 2800 * R('fold', 'colour', j), 0.002 + 0.004 * R('fold', 'length', j), 0.12),
    velocity: swell * (0.15 + 0.85 * R('fold', 'level', j) ** 2), vary: 0.8, pan: 1.6 * (R('fold', 'pan', j) - 0.5), distance: 0.3 + 0.6 * R('fold', 'far', j),
  })),
  ...Sd.scatter(R, 'table', loop, 2.6, (j, swell) => ({
    ...Sd.snap(280 + 280 * R('table', 'colour', j), 0.03 + 0.03 * R('table', 'length', j), 0.24),
    velocity: swell * (0.3 + 0.7 * R('table', 'level', j)), vary: 0.6, pan: 1.4 * (R('table', 'pan', j) - 0.5), distance: 0.3 + 0.5 * R('table', 'far', j),
  })),
  ...Sd.scatter(R, 'room', loop, 5, (j, swell) => swell).flatMap(([at, swell], j) => Sd.placed(
    Sd.swell(R, 'room ' + j, at, 1.6, (u) => (200 + 130 * R('room', 'colour', j)) * (1 + 1.1 * Math.sin(Math.PI * u)), 0.035 * swell * (0.4 + 0.6 * R('room', 'level', j))),
    { pan: 1.2 * (R('room', 'pan', j) - 0.5), distance: 0.5 })),
], { level: 1.3 });

/** The soundtrack of the shot that shows this clock from `from` for `seconds`, mixed at `level`, with the ambience both shots share. */
const heard = (from, seconds, level) => Object.assign(sound(from, seconds, level), { ambience: air });

module.exports = { CLOSE, HOME, heard, BUILD: [['the score, as the contain seam left it', Bx.score], ['fit the box', Bx.refit], ['address the envelope', address]], frame };
