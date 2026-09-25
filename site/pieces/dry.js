// The painted sheet drying, and the tears it dries into.
//
// DRYING. The water goes first from the edges of the wet band, which shrinks
// towards its middle and takes its sheen with it; the last strokes lose their
// gloss; and the ink as a whole dries a shade lighter than it went down.
//
// TEARING. Paper soaked and then held taut shrinks as it dries, and gives way
// in generations: a first tear runs right across, and every later one runs
// between tears already there and meets them nearly square, because a tear
// relieves the pull across it and the next gives way along it. So the tears
// cut the sheet the way `partition` cuts its box, recursively, more finely
// near the focus of the painting. Each tear starts at a weak place, runs both
// ways, and opens as the pieces pull apart: the table shows in the gap, and
// the torn edges show the paper's white core and its fibres. The pieces are
// kept as polygons whose sides are the tears themselves, for the next shot.

'use strict';

const { rng, noise2 } = require('../../core/rand.js');
const P = require('./paper.js');
const Wt = require('./water.js');
const M = require('./wordmark.js');
const B = require('./brush.js');
const { soft, hold } = require('./held.js');

// The clocks the drying continues: the ink shot lasted 6 s, after the bloom's 3.5 s.
const INK = 6;
const WATER = 3.5 + INK;
const WORD = M.DURATION + WATER;
// The second the sheet is dry: from then on only the tears change.
const DRY = 1.6;

/** The paper, the letters and the tide line the water left. */
function sheet(g, s) {
  P.ground(g, s);
  M.drawWord(g, s, WORD, s.lines.slice(0, -1));
  Wt.drawTide(g, s);
}

/**
 * Every mark of ink that had soaked in when the drying begins, on its own: the
 * line's halo, the line, the ink in the water, and the strokes one by one, as
 * the ink shot kept them.
 */
function inked(g, s) {
  Wt.drawHalo(g, s, Wt.SWEPT);
  Wt.drawLine(g, s, 3.5, M.DURATION + 3.5);
  Wt.drawPlumes(g, s, 3.5);
  for (let i = 0; i < B.settled(s, INK); i++) B.drawStrokes(g, s, [i], Infinity);
}

/** The strokes still wet when the drying begins: drawn as the ink shot draws them, until they too have soaked in. */
const wet = (s) => s.strokes.map((_, i) => i).slice(B.settled(s, INK));

/**
 * Everything over the paper as it dries at second `sec`: the water left, the
 * ink (kept, or with `direct` drawn, for a copy of its own), the last strokes
 * still wet, the ink drying lighter, the gloss and the sheen going, and the
 * brush leaving.
 */
function drying(g, s, sec, direct = false) {
  drawWater(g, s, sec, WATER + sec, false);
  if (direct) inked(g, s); else hold(g, s, 'ink', inked);
  const fresh = wet(s);
  B.drawStrokes(g, s, fresh, INK + sec);
  drawLighter(g, sec);
  if (fresh.length) B.drawGloss(g, s, fresh, INK + sec, Wt.sheenOf(g, s, WATER + sec, 2.2));
  drawWater(g, s, sec, WATER + sec, true);
  B.drawBrushShadow(g, s, INK + sec);
}

/** The dry sheet: paper, letters, tide line, ink, a shade lighter. */
function dried(g, s) {
  sheet(g, s);
  drying(g, s, DRY, true);
}

const FIRST = 1.05;        // seam second the first tear opens
const DEPTH = 5;           // generations at most
const STEP = 3.5;          // points along a tear, design units apart

/** Build stage: the tears, generation by generation, and the pieces of paper they leave. */
function tear(s) {
  const R = rng(s.seed);
  const [fx, fy] = s.focus;
  s.tears = [];
  s.tiles = [];
  const split = (poly, d, addr, from) => {
    const [x0, y0, x1, y1] = bounds(poly);
    const w = x1 - x0, h = y1 - y0;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    // Two causes, kept apart: where detail belongs (the painting's focus) and
    // how the drying sheet happens to be pulled (its own field).
    const want = Math.max(0, 1 - Math.hypot((cx - fx) / P.W, (cy - fy) / P.H) * 1.9);
    const stress = noise2(R, cx / 190, cy / 190, 'stress');
    if (d >= DEPTH || w < 70 || h < 70 || (d >= 2 && want * 0.9 + stress * 0.35 < 0.4)) {
      s.tiles.push({ poly, d, addr });
      return;
    }
    // Across the long side, never at the middle (halves read as a grid), and
    // never quite square to it.
    const r = 0.36 + R('tear', addr) * 0.28;
    const across = w >= h;
    const tilt = (R('tear', addr + '/tilt') - 0.5) * 0.9;
    const p = across ? [x0 + w * r, cy] : [cx, y0 + h * r];
    const dir = across ? [Math.sin(tilt), Math.cos(tilt)] : [Math.cos(tilt), Math.sin(tilt)];
    const hit = crossing(poly, p, dir);
    if (!hit) { s.tiles.push({ poly, d, addr }); return; }
    const [[ia, a], [ib, b]] = hit;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    // The line the paper tears along: exactly on the tears at its ends, and
    // between them wandering at three scales, as paper fibres give way.
    const n = Math.max(2, Math.round(len / STEP));
    const nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
    const bow = (R('tear', addr + '/bow') - 0.5) * len * 0.18;
    const pts = [], widths = [];
    const bands = [[], []], jags = [[], []];
    // A tear strips the surface off one piece more than the other: that side
    // bares a wide band of the paper's white core, the other a narrow one.
    const peeled = R('tear', addr + '/peeled') < 0.5 ? 0 : 1;
    const deepest = 2.5 + 6 * Math.pow(0.84, d);
    for (let i = 0; i <= n; i++) {
      const u = i / n, env = Math.pow(Math.sin(Math.PI * u), 0.7);
      // Paper tears in a curve, not a ruled line: the whole tear bows one way.
      const off = bow * Math.sin(Math.PI * u) + ((noise2(R, u * len / 80, d * 13.1 + addr.length, 'wander') - 0.5) * 34
        + (noise2(R, u * len / 16, d * 5.3 + addr.length, 'ragged') - 0.5) * 6
        + (R('tear', addr + '/jag', i) - 0.5) * 1.6) * env;
      pts.push([a[0] + (b[0] - a[0]) * u + nx * off, a[1] + (b[1] - a[1]) * u + ny * off]);
      widths.push(0.4 + 0.6 * Math.pow(Math.sin(Math.PI * u), 0.5) * (0.7 + noise2(R, u * len / 30, d * 7.7, 'gape') * 0.6));
      for (const k of [0, 1]) {
        const tag = addr + k;
        // The bared core: wide and narrow by turns along the tear, lumpy at a
        // smaller scale, and toothed at the smallest.
        const band = deepest * (k === peeled ? 1 : 0.45)
          * (0.2 + 1.4 * noise2(R, u * len / 55, d * 9.1 + k * 31, 'core'))
          * (0.5 + 0.9 * noise2(R, u * len / 16, d * 4.3 + k * 17, 'lumps'))
          + (noise2(R, u * len / 9, d * 6.1 + k * 23, 'tooth') - 0.5) * 1.6;
        bands[k].push(Math.max(0.25, band));
        // The torn edge itself: lumpy where tufts of fibre came away.
        jags[k].push((noise2(R, u * len / 10, d * 2.9 + k * 5, 'deckle') - 0.5) * 2.2);
      }
    }
    // The core's texture: fibres lying across the bared band, some catching
    // light, some in the shadow of the ones over them.
    const grain = [];
    for (let i = 0; i <= n; i++) {
      for (const k of [0, 1]) {
        for (let j = 0; j < 2; j++) {
          if (R('grain', addr + k + j, i) < 0.35) continue;
          grain.push([i, k, R('grain', addr + k + j + 'd', i), (R('grain', addr + k + j + 'a', i) - 0.5) * 1.4, 0.35 + R('grain', addr + k + j + 'l', i) * 0.8, R('grain', addr + k + j + 't', i) < 0.3 ? 1 : 0]);
        }
      }
    }
    // Fibres pulled out across the gap from both edges, and whiskers where the
    // core frays back under the inked surface.
    const fibres = [], whiskers = [];
    for (let i = 1; i < n; i++) {
      for (const k of [0, 1]) {
        for (let j = 0; j < 2; j++) {
          if (R('fibre', addr + k + j, i) < 0.4) fibres.push([i + R('fibre', addr + k + j + 'at', i) - 0.5, k, (R('fibre', addr + k + j + 'a', i) - 0.5) * 1.5, 0.4 + Math.pow(R('fibre', addr + k + j + 'l', i), 2) * 3.2]);
          if (R('whisker', addr + k + j, i) < 0.35) whiskers.push([i + R('whisker', addr + k + j + 'at', i) - 0.5, k, (R('whisker', addr + k + j + 'a', i) - 0.5) * 1.6, 0.4 + Math.pow(R('whisker', addr + k + j + 'l', i), 2) * 1.2]);
        }
      }
    }
    const at = from + 0.08 + R('tear', addr + '/at') * 0.22;
    const run = 0.16 + len / 2200;
    s.tears.push({ pts, widths, bands, jags, grain, fibres, whiskers, d, at, run, origin: 0.25 + R('tear', addr + '/flaw') * 0.5, width: Math.max(1.8, 8.5 * Math.pow(0.76, d)) });
    // The two pieces, each bounded by the tear on one side.
    const inner = pts.slice(1, -1);
    const one = [a, ...walk(poly, ia, ib), b, ...inner.slice().reverse()];
    const two = [b, ...walk(poly, ib, ia), a, ...inner];
    const done = at + run;
    split(one, d + 1, addr + 'a', done);
    split(two, d + 1, addr + 'b', done);
  };
  split([[0, 0], [P.W, 0], [P.W, P.H], [0, P.H]], 0, 'r', FIRST - 0.1);
  // The order the tears open in, which is the order they finish opening.
  s.tearOrder = s.tears.map((_, i) => i).sort((a, b) => s.tears[a].at - s.tears[b].at);
  // Where the water's edge lags as it dries, either side of the band.
  s.drying = s.water.top.map((_, i) => [noise2(R, i / 9, 1.5, 'drying') - 0.5, noise2(R, i / 9, 4.5, 'drying') - 0.5]);
}

function bounds(poly) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
}

/**
 * Where the line through `p` along `dir` leaves a polygon on either side of p:
 * [[edge index, point] behind, [edge index, point] ahead], or null.
 */
function crossing(poly, p, dir) {
  const side = (q) => (q[0] - p[0]) * dir[1] - (q[1] - p[1]) * dir[0];
  let back = null, ahead = null;
  for (let i = 0; i < poly.length; i++) {
    const q = poly[i], r = poly[(i + 1) % poly.length];
    const sq = side(q), sr = side(r);
    if ((sq >= 0) === (sr >= 0)) continue;
    const u = sq / (sq - sr);
    const x = [q[0] + (r[0] - q[0]) * u, q[1] + (r[1] - q[1]) * u];
    const t = (x[0] - p[0]) * dir[0] + (x[1] - p[1]) * dir[1];
    if (t < 0 && (!back || t > back[2])) back = [i, x, t];
    if (t > 0 && (!ahead || t < ahead[2])) ahead = [i, x, t];
  }
  return back && ahead ? [[back[0], back[1]], [ahead[0], ahead[1]]] : null;
}

/** The polygon's corners from just after edge `from` round to the end of edge `to`. */
function walk(poly, from, to) {
  const out = [];
  for (let i = (from + 1) % poly.length; ; i = (i + 1) % poly.length) {
    out.push(poly[i]);
    if (i === to) break;
  }
  return out;
}

/** How dry the sheet is at the seam's second `sec`, 0 to 1. */
function dryness(sec) {
  const u = Math.max(0, Math.min(1, (sec - 0.1) / 1.5));
  return u * u * (3 - 2 * u);
}

/**
 * The water left on the sheet at second `sec`: the wet band shrinking towards
 * its middle as it dries from its edges. With `sheen`, the light's reflection
 * on it, fading with it (drawn over the ink); without, the darker paper under it.
 */
function drawWater(g, s, sec, waterSec, sheen) {
  const left = 1 - dryness(sec);
  if (left <= 0) return;
  const { top, bottom } = s.water;
  const inset = (1 - left) * 0.5;
  g.save();
  g.beginPath();
  const x0 = -170, step = 8;
  for (let i = 0; i < top.length; i++) {
    const t = top[i], b = bottom[i], ragged = s.drying[i][0] * 40 * (1 - left);
    g.lineTo(x0 + i * step, t + (b - t) * inset + ragged);
  }
  for (let i = top.length - 1; i >= 0; i--) {
    const t = top[i], b = bottom[i], ragged = s.drying[i][1] * 40 * (1 - left);
    g.lineTo(x0 + i * step, b - (b - t) * inset + ragged);
  }
  g.closePath();
  g.fillStyle = sheen ? Wt.sheenOf(g, s, waterSec, left) : `rgba(104, 90, 66, ${(0.055 * Math.min(1, left * 1.5)).toFixed(4)})`;
  g.fill();
  g.restore();
}

/** The ink drying a shade lighter than it went down: the paper's own colour, laid thin over everything. */
function drawLighter(g, sec) {
  const a = 0.07 * dryness(sec);
  if (a <= 0) return;
  g.save();
  g.fillStyle = P.PAPER;
  g.globalAlpha = a;
  g.fillRect(0, 0, P.W, P.H);
  g.restore();
}

/**
 * The tears in `list` (indices) at second `sec` (Infinity: fully open): each
 * from its flaw both ways, as far as it has run, the two pieces pulled apart as
 * far as the drying sheet has shrunk, widest where it opened first. In the gap
 * the dark table under the sheet, and the shadow of the torn edges on it;
 * along both sides the paper's bared core, whiter than its inked surface, wide
 * and narrow by turns with a lumpy edge, soft, textured with fibres and fraying
 * back under the surface; and fibres pulled out across the gap. `mode`
 * 'cut' leaves the gaps empty and draws only the part of the shadow that falls
 * on the sheet, for a sheet lifted off it; 'shade' draws only the table in the
 * gaps with the shadows on it. A sheet cut and laid over its table shaded,
 * tear by tear in both, is the sheet drawn whole.
 */
function drawTears(g, s, sec, list, mode = 'all') {
  const open = [];
  for (const i of list) {
    const t = s.tears[i];
    if (sec <= t.at) continue;
    const grown = Math.min(1, (sec - t.at) / t.run);
    const o = Math.min(1, (sec - t.at) / OPENS);
    const e = o * o * (3 - 2 * o);
    open.push(frames(t, grown, t.width * (0.25 + 0.75 * e), 0.3 + 0.7 * e));
  }
  if (!open.length) return;
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // The gap: the table seen through it, or, cut out of the sheet, nothing.
  g.fillStyle = TABLE;
  if (mode === 'cut') g.globalCompositeOperation = 'destination-out';
  g.beginPath();
  for (const f of open) ring(g, f, (q) => q.e0, (q) => -q.e1);
  g.fill();
  // The torn edges' shadow on the table, reaching a little over the edge; cut, only that little.
  g.globalCompositeOperation = mode === 'cut' ? 'source-atop' : 'source-over';
  g.strokeStyle = SHADE;
  g.lineWidth = 1.3;
  g.beginPath();
  for (const f of open) { line(g, f, (q) => Math.max(0.1, q.e0 - 0.4)); line(g, f, (q) => -Math.max(0.1, q.e1 - 0.4)); }
  g.stroke();
  g.globalCompositeOperation = 'source-over';
  if (mode === 'shade') { g.restore(); return; }
  // The bared core, soft-edged: laid at half the resolution and smoothed back up.
  soft(g, 2, (sg) => {
    sg.fillStyle = CORE;
    sg.beginPath();
    for (const f of open) { ring(sg, f, (q) => q.e0, (q) => q.e0 + q.b0); ring(sg, f, (q) => -q.e1, (q) => -q.e1 - q.b1); }
    sg.fill();
    // Where the inked surface overhangs the core, its edge's thin shadow.
    sg.strokeStyle = LIP;
    sg.lineWidth = 1.1;
    sg.beginPath();
    for (const f of open) { line(sg, f, (q) => q.e0 + q.b0); line(sg, f, (q) => -q.e1 - q.b1); }
    sg.stroke();
  });
  // Its fibres, lit and shaded, then the whiskers where it frays under the
  // surface and the fibres pulled across the gap: fine enough to read as fuzz.
  const hairs = [[LIT, 0.45, grainOf(0)], [DIM, 0.4, grainOf(1)], [FRAY, 0.4, whiskerOf], [LIT, 0.4, fibreOf]];
  for (const [colour, lw, each] of hairs) {
    g.strokeStyle = colour;
    g.lineWidth = lw;
    g.beginPath();
    for (const f of open) each(g, f);
    g.stroke();
  }
  g.restore();
}

const OPENS = 1.2;                              // seconds a tear takes to open fully
const TABLE = '#2c2620';                        // what the sheet lies on
const SHADE = 'rgba(14, 11, 8, 0.55)';          // the torn edges' shadow on it
const CORE = '#f8f5ed';                         // the paper's core, whiter than its surface
const LIT = 'rgba(255, 254, 250, 0.85)';        // core fibres catching the light
const DIM = 'rgba(150, 132, 104, 0.32)';        // and in the shadow of those over them
const FRAY = 'rgba(252, 250, 244, 0.6)';        // the core fraying back under the surface
const LIP = 'rgba(118, 104, 84, 0.28)';         // the inked surface's edge, overhanging the core

/**
 * One tear as it stands, station by station, worked out once for every pass
 * that draws it: the point, its normal, the distance from the tear's line to
 * the torn edge on either side (e0 along the normal, e1 against it) and the
 * width of core bared behind each. A running tip closes to a point.
 */
function frames(t, grown, w, bare) {
  const n = t.pts.length - 1;
  const lo = t.origin * (1 - grown) * n, hi = (t.origin + (1 - t.origin) * grown) * n;
  const first = Math.ceil(lo), list = [];
  const at = (f) => {
    const i = Math.min(n - 1, Math.floor(f)), u = f - i;
    const lerp = (arr) => arr[i] + (arr[i + 1] - arr[i]) * u;
    const dx = t.pts[i + 1][0] - t.pts[i][0], dy = t.pts[i + 1][1] - t.pts[i][1], len = Math.hypot(dx, dy) || 1;
    const tip = Math.min(lo > 0 ? Math.min(1, (f - lo) / 3) : 1, hi < n ? Math.min(1, (hi - f) / 3) : 1);
    const half = w * lerp(t.widths) * 0.5 * tip, jag = tip * Math.min(1, w / 3);
    return {
      x: t.pts[i][0] + dx * u, y: t.pts[i][1] + dy * u, nx: -dy / len, ny: dx / len,
      e0: Math.max(0.15, half + lerp(t.jags[0]) * jag), e1: Math.max(0.15, half + lerp(t.jags[1]) * jag),
      b0: lerp(t.bands[0]) * bare * tip, b1: lerp(t.bands[1]) * bare * tip,
    };
  };
  if (first > lo) list.push(at(lo));
  for (let i = first; i <= Math.floor(hi); i++) list.push(at(i));
  if (hi > Math.floor(hi)) list.push(at(hi));
  return { t, list, first, lo, hi, station: (i) => list[i - first + (first > lo ? 1 : 0)] };
}

/** A closed band between two offsets from the tear's line, a(q) out and b(q) back. */
function ring(g, f, a, b) {
  const L = f.list;
  g.moveTo(L[0].x + L[0].nx * a(L[0]), L[0].y + L[0].ny * a(L[0]));
  for (let i = 1; i < L.length; i++) g.lineTo(L[i].x + L[i].nx * a(L[i]), L[i].y + L[i].ny * a(L[i]));
  for (let i = L.length - 1; i >= 0; i--) g.lineTo(L[i].x + L[i].nx * b(L[i]), L[i].y + L[i].ny * b(L[i]));
  g.closePath();
}

/** A line at offset d(q) from the tear's line. */
function line(g, f, d) {
  const L = f.list;
  g.moveTo(L[0].x + L[0].nx * d(L[0]), L[0].y + L[0].ny * d(L[0]));
  for (let i = 1; i < L.length; i++) g.lineTo(L[i].x + L[i].nx * d(L[i]), L[i].y + L[i].ny * d(L[i]));
}

/** A hair from offset `from` at station q, turned `turn` from the direction `sign` along the normal, `len` long. */
function hair(g, q, from, sign, turn, len) {
  const bx = q.x + q.nx * from, by = q.y + q.ny * from;
  const c = Math.cos(turn), s = Math.sin(turn);
  g.moveTo(bx, by);
  g.lineTo(bx + sign * (q.nx * c - q.ny * s) * len, by + sign * (q.nx * s + q.ny * c) * len);
}

/** The core's fibres of one tone: lying across the band, from somewhere in it towards the edge. */
const grainOf = (tone) => (g, f) => {
  for (const [i, k, depth, turn, length, dark] of f.t.grain) {
    if (dark !== tone || i < f.first || i > f.hi) continue;
    const q = f.station(i);
    if (!q) continue;
    const band = k ? q.b1 : q.b0;
    if (band < 0.8) continue;
    const sign = k ? -1 : 1, e = k ? q.e1 : q.e0;
    hair(g, q, sign * (e + band * depth), -sign, turn, band * length * depth + 0.4);
  }
};

/** The whiskers at the core's inner edge, fraying back under the inked surface. */
function whiskerOf(g, f) {
  for (const [at, k, turn, len] of f.t.whiskers) {
    const i = Math.round(at);
    if (i < f.first || i > f.hi) continue;
    const q = f.station(i);
    if (!q) continue;
    const band = k ? q.b1 : q.b0;
    if (band < 0.5) continue;
    const sign = k ? -1 : 1, e = k ? q.e1 : q.e0;
    hair(g, q, sign * (e + band), sign, turn, len * Math.min(1, band / 2));
  }
}

/** The fibres pulled out of both edges across the gap, as long as the gap lets them be. */
function fibreOf(g, f) {
  for (const [at, k, turn, len] of f.t.fibres) {
    const i = Math.round(at);
    if (i < f.first || i > f.hi) continue;
    const q = f.station(i);
    if (!q) continue;
    const e = k ? q.e1 : q.e0;
    if (e < 0.8) continue;
    const sign = k ? -1 : 1;
    hair(g, q, sign * e, -sign, turn, Math.min(len, e * 1.7));
  }
}

module.exports = { tear, dryness, sheet, drying, dried, drawWater, drawLighter, drawTears, FIRST, OPENS, TABLE, DRY };
