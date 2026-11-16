// The wordmark a plotter pen writes in the intro: the lines, when the pen draws
// each of them, and how the ink sits in the paper once it has.
//
// A PLOTTER, NOT A HAND. The letters are the shared stroke font, drawn one
// pen-down path at a time at the pen's own speed: it speeds up and slows down
// on every line, waits a moment on the paper before it moves, and travels with
// the pen up between lines. What arrives is arc length; nothing fades up.
//
// THE INK IS IN THE PAPER. A fresh line lies on the paper darker than it will
// dry. Behind the pen the paper takes the ink in: a faint rim spreads around
// the line, and here and there a feather a millimetre or two long creeps out
// into the tooth. The last line is still wet when the next shot begins.
//
// THE PLOTTER IS THERE BY ITS SHADOW. The gantry spans the sheet at the pen's
// x and the carriage sits over the nib; neither is drawn, but the light they
// block crosses the whole frame as the pen moves, and they park off the sheet
// once the last line is down.

'use strict';

const { rng, fbm } = require('../../core/rand.js');
const { glyph, width } = require('../../core/stroke-font.js');
const { lengthOf } = require('../../core/geom.js');
const P = require('./paper.js');

const WORD = 'ARTIFEX';
const CAP = 130;          // cap height, design units
const LINE = 4.8;         // the pen's line
const START = 0.3;        // seconds of bare paper before the pen comes down
const FINISH = 3.85;      // the pen lifts off its last line at this second
const DURATION = 4.5;     // the intro's length: the next shot takes up the ink's time from here
const DWELL = 0.05;       // the pen waits this long on the paper before it moves
const WET = 0.45;         // a fresh line lies darker for this long
const SOAK = 1.1;         // the rim around a line takes this long to spread
const ACCEL = 0.18;       // share of a line's time the pen spends speeding up, and again slowing

/** Share of a line drawn after `u` of its time: the pen speeds up, runs, slows. */
function travel(u) {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const v = 1 / (1 - ACCEL);
  if (u < ACCEL) return 0.5 * v * u * u / ACCEL;
  if (u > 1 - ACCEL) return 1 - 0.5 * v * (1 - u) * (1 - u) / ACCEL;
  return 0.5 * v * ACCEL + v * (u - ACCEL);
}

/** The inverse of travel: the share of its time at which the pen reaches share `d` of a line. */
function reach(d) {
  const v = 1 / (1 - ACCEL);
  const d1 = 0.5 * v * ACCEL;
  if (d <= 0) return 0;
  if (d >= 1) return 1;
  if (d < d1) return Math.sqrt(2 * d * ACCEL / v);
  if (d > 1 - d1) return 1 - Math.sqrt(2 * (1 - d) * ACCEL / v);
  return ACCEL + (d - d1) / v;
}

/** Build stage: the lines, their times, and the feathers the ink makes along them. */
function plot(s) {
  const R = rng(s.seed);
  // Where a feather may run: a short-range field of its own, the paper's tooth at the scale of a line.
  const bleed = (x, y) => fbm(R, x / 26, y / 26, 2, 'bleed') * Math.PI * 4;
  const k = CAP / 7;
  const w = width(WORD, CAP);
  const x0 = (P.W - w) / 2;
  const y0 = 300;
  const lines = [];
  let pen = x0;
  for (const ch of WORD) {
    for (const run of glyph(ch)) lines.push(run.map(([u, v]) => [pen + u * k, y0 + v * k]));
    pen += 5.4 * k;
  }
  // The last line runs under the word: a plotter's spline, bowed and tilted a little.
  const base = y0 + CAP + 44;
  const bow = (R('under', 'bow') - 0.5) * 22;
  const tilt = (R('under', 'tilt') - 0.5) * 16;
  const under = [];
  for (let i = 0; i <= 48; i++) {
    const u = i / 48;
    under.push([x0 - 24 + u * (w + 64), base + bow * Math.sin(Math.PI * u) + tilt * (u - 0.5)]);
  }
  lines.push(under);

  // The pen's own schedule, then stretched to lift off its last line at FINISH.
  let t = START;
  let at = lines[0][0];
  const raw = lines.map((pts, i) => {
    const len = lengthOf(pts);
    t += Math.hypot(pts[0][0] - at[0], pts[0][1] - at[1]) / 3200 + (i ? 0.05 : 0) + DWELL;
    const t0 = t;
    t += len / 1150 + 0.06;
    at = pts[pts.length - 1];
    return { pts, len, t0, t1: t };
  });
  const stretch = (FINISH - START) / (t - START);
  const time = (x) => START + (x - START) * stretch;

  s.lines = raw.map((l, i) => {
    const cum = [0];
    for (let j = 1; j < l.pts.length; j++) cum.push(cum[j - 1] + Math.hypot(l.pts[j][0] - l.pts[j - 1][0], l.pts[j][1] - l.pts[j - 1][1]));
    const line = { i, pts: l.pts, cum, len: l.len, t0: time(l.t0), t1: time(l.t1) };
    // Feathers: here and there the wet line runs a millimetre or two into the
    // paper, along whatever path the tooth offers it.
    line.feathers = [];
    for (let a = 3, n = 0; a < l.len - 3; a += 6, n++) {
      if (R('feather', 'l' + i, n) > 0.3) continue;
      const [px, py] = pointAt(line, a);
      const sense = R('feather', 's' + i, n) < 0.5 ? 0 : Math.PI;
      const long = 2 + Math.pow(R('feather', 'len' + i, n), 2) * 6;
      const pts = [[px, py]];
      let hx = px, hy = py;
      for (let d = 0; d < long; d += 1.2) {
        const h = bleed(hx, hy) + sense + (R('feather', 'kink' + i, n * 16 + pts.length) - 0.5) * 1.1;
        hx += Math.cos(h) * 1.2;
        hy += Math.sin(h) * 1.2;
        pts.push([hx, hy]);
      }
      line.feathers.push({ pts, at: whenAt(line, a) + 0.08 + R('feather', 'delay' + i, n) * 0.35 });
    }
    return line;
  });
}

/** The point at arc length `a` along a line. */
function pointAt(line, a) {
  const { pts, cum } = line;
  let j = 1;
  while (j < pts.length - 1 && cum[j] < a) j++;
  const u = cum[j] === cum[j - 1] ? 0 : Math.max(0, Math.min(1, (a - cum[j - 1]) / (cum[j] - cum[j - 1])));
  return [pts[j - 1][0] + (pts[j][0] - pts[j - 1][0]) * u, pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * u];
}

/** The second at which the pen passes arc length `a` of a line. */
function whenAt(line, a) {
  return line.t0 + (line.t1 - line.t0) * reach(a / line.len);
}

/** How far along a line the pen has got by second `sec`, in arc length. */
function drawn(line, sec) {
  return line.len * travel((sec - line.t0) / (line.t1 - line.t0));
}

/** Trace a line from arc length `a0` to `a1` into the current path. */
function trace(g, line, a0, a1) {
  if (a1 <= a0) return;
  const { pts, cum } = line;
  const [sx, sy] = pointAt(line, a0);
  g.moveTo(sx, sy);
  for (let j = 1; j < pts.length; j++) {
    if (cum[j] <= a0) continue;
    if (cum[j] >= a1) break;
    g.lineTo(pts[j][0], pts[j][1]);
  }
  const [ex, ey] = pointAt(line, a1);
  g.lineTo(ex, ey);
}

// Fresh ink in four steps of age, one path each, so the rim and the wet line
// are a handful of calls however many pieces of line are fresh.
const STEPS = 4;

/**
 * The wordmark as it stands at second `sec`: every line the pen has drawn, the
 * rim the paper has taken in around it, the feathers grown so far, the fresh
 * line lying darker, and the nib on the line it is drawing. `only` limits it
 * to some of the lines.
 */
function drawWord(g, s, sec, only = s.lines) {
  const live = only.filter((l) => sec >= l.t0 - DWELL);
  // Each line: drawn so far, and the part old enough for a full rim.
  const parts = live.map((l) => ({ l, a1: drawn(l, sec), old: drawn(l, sec - SOAK) }));
  const rims = Array.from({ length: STEPS }, () => []);
  const wets = Array.from({ length: STEPS }, () => []);
  for (const { l, a1, old } of parts) {
    for (let a = old; a < a1; a += 6) {
      const b = Math.min(a1, a + 6);
      const age = sec - whenAt(l, (a + b) / 2);
      const seg = [l, a, b];
      rims[Math.min(STEPS - 1, Math.floor(Math.max(0, age) / SOAK * STEPS))].push(seg);
      if (age < WET) wets[Math.min(STEPS - 1, Math.floor((1 - age / WET) * STEPS))].push(seg);
    }
  }

  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';

  // The rim: ink the paper took in around each line, spreading as it soaks.
  g.strokeStyle = P.wash(0.08);
  g.lineWidth = LINE + 3.6;
  g.beginPath();
  for (const { l, old } of parts) trace(g, l, 0, old);
  g.stroke();
  rims.forEach((segs, b) => {
    if (!segs.length) return;
    g.lineWidth = LINE + 3.6 * (b + 0.5) / STEPS;
    g.beginPath();
    for (const [l, a, e] of segs) trace(g, l, a, e);
    g.stroke();
  });

  // Feathers, darker where they leave the line.
  g.strokeStyle = P.wash(0.3);
  g.lineWidth = 0.7;
  for (const root of [1, 0.4]) {
    g.beginPath();
    for (const l of live) for (const f of l.feathers) feather(g, f, sec, root);
    g.stroke();
  }

  // The line.
  g.strokeStyle = P.wash(0.88);
  g.lineWidth = LINE;
  g.beginPath();
  for (const { l, a1 } of parts) trace(g, l, 0, a1);
  g.stroke();

  // A fresh line lies darker until it soaks in.
  wets.forEach((segs, b) => {
    if (!segs.length) return;
    g.strokeStyle = P.wash(0.5 * (b + 0.5) / STEPS);
    g.lineWidth = LINE * 0.92;
    g.beginPath();
    for (const [l, a, e] of segs) trace(g, l, a, e);
    g.stroke();
  });

  // The nib, on the line it is drawing.
  const head = parts.find((p) => sec < p.l.t1);
  if (head) {
    g.fillStyle = P.wash(0.6);
    g.beginPath();
    circle(g, pointAt(head.l, head.a1), LINE * 0.6);
    g.fill();
  }
  g.restore();
  shadow(g, s, sec);
}

// Where the pen parks, off the sheet, before its first line and after its last.
const PARK = [-180, 60];
const HOME = [P.W + 220, 60];
const PARKED = 0.6;       // seconds the carriage takes to park after the last line

/** Where the pen is at second `sec`: on a line, travelling between lines with the pen up, or parked. */
function penAt(s, sec) {
  const lines = s.lines;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (sec < l.t0) {
      const from = i ? lines[i - 1] : null;
      const a = from ? from.pts[from.pts.length - 1] : PARK;
      const t0 = from ? from.t1 : 0;
      const u = Math.max(0, Math.min(1, (sec - t0) / (l.t0 - DWELL - t0)));
      const e = u * u * (3 - 2 * u);
      return [a[0] + (l.pts[0][0] - a[0]) * e, a[1] + (l.pts[0][1] - a[1]) * e];
    }
    if (sec <= l.t1) return pointAt(l, drawn(l, sec));
  }
  const last = lines[lines.length - 1];
  const a = last.pts[last.pts.length - 1];
  const u = Math.min(1, (sec - last.t1) / PARKED);
  const e = u * u * (3 - 2 * u);
  return [a[0] + (HOME[0] - a[0]) * e, a[1] + (HOME[1] - a[1]) * e];
}

/**
 * The plotter over the sheet, seen only by the light it blocks: the gantry
 * spanning the paper at the pen's x, and the pen carriage above the nib, each
 * a soft shadow cast away from the light.
 */
function shadow(g, s, sec) {
  const [x, y] = penAt(s, sec);
  const ox = -Math.cos(s.light) * 30;
  const oy = -Math.sin(s.light) * 30;
  // The gantry: a rail's straight shadow with a soft edge either side.
  const gx = x + ox;
  const band = g.createLinearGradient(gx - 70, 0, gx + 70, 0);
  band.addColorStop(0, 'rgba(70, 56, 38, 0)');
  band.addColorStop(0.36, 'rgba(70, 56, 38, 0.035)');
  band.addColorStop(0.44, 'rgba(70, 56, 38, 0.07)');
  band.addColorStop(0.56, 'rgba(70, 56, 38, 0.07)');
  band.addColorStop(0.64, 'rgba(70, 56, 38, 0.035)');
  band.addColorStop(1, 'rgba(70, 56, 38, 0)');
  g.fillStyle = band;
  g.fillRect(gx - 70, 0, 140, P.H);
  // The carriage over the nib, longer along the rail than across it.
  const cx = x + ox * 0.9, cy = y + oy * 0.9;
  g.save();
  g.translate(cx, cy);
  g.scale(0.7, 1.3);
  const blob = g.createRadialGradient(0, 0, 0, 0, 0, 30);
  blob.addColorStop(0, 'rgba(60, 48, 32, 0.12)');
  blob.addColorStop(1, 'rgba(60, 48, 32, 0)');
  g.fillStyle = blob;
  g.fillRect(-30, -30, 60, 60);
  g.restore();
}

function circle(g, [x, y], r) {
  g.moveTo(x + r, y);
  g.arc(x, y, r, 0, Math.PI * 2);
}

/** The first `root` share of the part of a feather the ink has reached by `sec`: it creeps quickly, then slows. */
function feather(g, f, sec, root) {
  const age = sec - f.at;
  if (age <= 0) return;
  const n = f.pts.length - 1;
  const reachN = n * (1 - Math.exp(-age / 0.5)) * root;
  const last = Math.floor(reachN);
  g.moveTo(f.pts[0][0], f.pts[0][1]);
  for (let j = 1; j <= last; j++) g.lineTo(f.pts[j][0], f.pts[j][1]);
  if (last < n) {
    const u = reachN - last;
    const a = f.pts[last], b = f.pts[last + 1];
    g.lineTo(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u);
  }
}

module.exports = { WORD, CAP, LINE, FINISH, DURATION, plot, drawWord, pointAt, whenAt, drawn, trace };
