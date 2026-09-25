// The plot cut out and folded into papercraft layers (see
// skills/artifex/styles/papercraft.md): a craft knife cuts the bird out of the
// blueprint part by part, tail, body with its legs, beak and wing, cut clean
// as scissors cut; the parts rise off the sheet onto their own layers, each
// casting its shadow on the one beneath, the wing on top; the wing's edge
// folds over along the plot's phantom fold line and shows the paper's white
// back; then the sheet itself is torn across twice and its strips part and
// stack, their torn edges showing the paper's white core.
//
// ONE SHEET, CUT. Every piece is the plotted blueprint itself, kept once as a
// copy and laid through the piece's own shape and lift; where a piece has
// risen, its hole in the sheet shows the table.
//
// All in the sheet's units (see draft.js).

'use strict';

const { rng, noise2 } = require('../../core/rand.js');
const { lengthOf, pointInPoly, resample } = require('../../core/geom.js');
const { spring } = require('../../core/time.js');
const { bird } = require('../../skills/artifex/styles/subject.js');
const { soft } = require('./held.js');
const Dr = require('./draft.js');
const Bp = require('./blueprint.js');
const Dy = require('./dry.js');

const S = Dr.SCALE;
const F = (p) => [Dr.FRONT[0] + p[0] * S, Dr.FRONT[1] + p[1] * S];
const CORE = '#eee8dc';                  // the paper's core and its back
const SHADE = 'rgba(3, 5, 25, 0.55)';    // a layer's shadow on the one beneath
const PERCH = 0.69;

// The parts, back to front, with how high each rises (sheet units) and when after LIFT.
const PARTS = [
  { name: 'tail', high: 5, delay: 0 },
  { name: 'body', high: 8, delay: 0.08 },
  { name: 'beak', high: 10, delay: 0.16 },
  { name: 'wing', high: 14, delay: 0.24 },
];

const clockwise = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a < 0 ? pts : pts.slice().reverse();
};

/** Build stage: the parts' shapes, the knife's path and the sheet's two tears. */
function cut(s) {
  const U = bird(0, 0, 1), R = rng(s.seed);
  const body = clockwise(U.body.map(F)), wing = clockwise(U.wing.map(F)), tail = clockwise(U.tail.map(F)), beak = clockwise(U.beak.map(F));
  // The legs, as narrow strips down to the branch, cut with the body.
  const legs = U.legs.map((leg) => {
    const x = F(leg[0])[0], y0 = F(leg[0])[1] - 12, y1 = F([0, PERCH])[1] + 2;
    return clockwise([[x - 3.2, y0], [x + 3.2, y0], [x + 3.2, y1], [x - 3.2, y1]]);
  });
  s.parts = {
    tail: { shapes: [tail], without: [body] },
    body: { shapes: [body, ...legs], without: [wing, beak] },
    beak: { shapes: [beak], without: [] },
    wing: { shapes: [wing], without: [] },
  };
  s.centre = F([0, 0]);
  // Where the knife goes: each part's outline, where it is not inside another part it is cut from.
  const inside = (p, polys) => polys.some((q) => pointInPoly(p, q));
  const runs = [];
  const add = (pts, keepOut) => {
    let run = null;
    for (const p of resample([...pts, pts[0]], 2)) {
      if (inside(p, keepOut)) { run = null; continue; }
      if (!run) runs.push(run = []);
      run.push(p);
    }
  };
  add(tail, [body]);
  add(body, [...legs, wing, beak]);
  for (const leg of legs) add(leg, [body]);
  add(beak, []);
  add(wing, []);
  // In order, each from the end of the last, the nearest next, either way round; stretched over CUT.
  const left = runs.filter((r) => r.length > 1), order = [];
  let at = left[0][0];
  while (left.length) {
    let best = 0, flip = false, d = Infinity;
    left.forEach((r, i) => { for (const [p, f] of [[r[0], false], [r[r.length - 1], true]]) { const e = Math.hypot(p[0] - at[0], p[1] - at[1]); if (e < d) { d = e; best = i; flip = f; } } });
    const r = left.splice(best, 1)[0], pts = flip ? r.reverse() : r;
    order.push(pts);
    at = pts[pts.length - 1];
  }
  let t = 0;
  at = order[0][0];
  const raw = order.map((pts) => {
    t += Math.hypot(pts[0][0] - at[0], pts[0][1] - at[1]) / 1400 + 0.05;
    const t0 = t, len = lengthOf(pts);
    t += len / 620;
    at = pts[pts.length - 1];
    const cum = [0];
    for (let j = 1; j < pts.length; j++) cum.push(cum[j - 1] + Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]));
    return { pts, len, cum, t0, t1: t };
  });
  const k = (CUT[1] - CUT[0]) / t;
  s.cuts = raw.map((c) => ({ ...c, t0: CUT[0] + c.t0 * k, t1: CUT[0] + c.t1 * k }));
  // The wing's fold: along the plot's phantom line, its upper edge folding down over it.
  const f0 = F([0.2, -0.08]), f1 = F([-0.58, -0.22]), l = Math.hypot(f1[0] - f0[0], f1[1] - f0[1]);
  const dir = [(f1[0] - f0[0]) / l, (f1[1] - f0[1]) / l];
  let n = [-dir[1], dir[0]];
  if ((F([0, -0.3])[0] - f0[0]) * n[0] + (F([0, -0.3])[1] - f0[1]) * n[1] < 0) n = [-n[0], -n[1]];
  s.fold = { at: f0, n };
  // The sheet's two tears, across it above and below the bird.
  s.tears = [318, 648].map((y0, j) => {
    const edge = [];
    for (let i = 0; i <= 160; i++) {
      const x = Bp.PAPER[0] - 20 + ((Bp.PAPER[2] - Bp.PAPER[0] + 40) * i) / 160;
      const wave = (noise2(R, x / 260, 0.5 + j, 'tearwave') - 0.5) * 48, jag = (noise2(R, x / 14, 3.5 + j, 'tearjag') - 0.5) * 12 + (R('tear', 'j' + j, i) - 0.5) * 6;
      edge.push([x, y0 + wave + jag, 3 + noise2(R, i * 0.35, 9.1 + j, 'rim') * 9]);
    }
    return edge;
  });
}

const CUT = [1.5, 4.1];                  // the knife's first cut and its last
const LIFT = 4.2;                        // the parts rise from here
const FOLD = 5.1;                        // the wing's edge folds over
const TEARS = [[5.6, 6.3], [6.0, 6.7]];  // each tear runs across the sheet, left to right
const SPREAD = 6.7;                      // the strips part
const rise = spring({ stiffness: 60, damping: 0.55 });
const folding = spring({ stiffness: 40, damping: 0.62 });
const parting = spring({ stiffness: 30, damping: 0.7 });

function path(g, pts) {
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
}

/** The whole plane but the paths `polys`: a clip with holes (even-odd). */
function without(g, polys) {
  g.beginPath();
  g.rect(-3000, -3000, 8000, 8000);
  for (const p of polys) path(g, p);
  g.clip('evenodd');
}

/** How high a part has risen at second `sec`. */
const height = (part, sec) => part.high * rise(sec - LIFT - part.delay);

/** A lifted layer's transform about the bird: seen from above, a little larger the higher it is. */
function lifted(h, centre) {
  const k = 1 + h * 0.003;
  return [k, 0, 0, k, centre[0] * (1 - k), centre[1] * (1 - k)];
}

/** A soft shadow of `shapes` cast `h` units below, away from the light at angle `light`. */
function shadow(g, shapes, h, light, alpha = 1) {
  if (h <= 0.05) return;
  const lx = -Math.cos(light) * h * 1.1, ly = -Math.sin(light) * h * 1.1;
  soft(g, 4, (sg) => {
    sg.save();
    sg.translate(lx, ly);
    sg.globalAlpha = Math.min(1, h / 3) * alpha;
    sg.fillStyle = SHADE;
    sg.strokeStyle = SHADE;
    sg.lineJoin = 'round';
    sg.lineWidth = 2 + h * 0.8;
    sg.beginPath();
    for (const p of shapes) path(sg, p);
    sg.fill();
    sg.stroke();
    sg.restore();
  });
}

/**
 * The seam at second `sec`: the table, the sheet in its strips with the
 * holes the parts left, the parts on their layers, the knife and its cut.
 * `sheet(g, clip)` lays the plotted sheet through `clip` (in sheet units);
 * `light` is the light's angle.
 */
function drawCut(g, s, sec, sheet, light) {
  g.save();
  g.fillStyle = Dy.TABLE;
  g.beginPath();
  g.rect(Bp.PAPER[0] - 900, Bp.PAPER[1] - 700, Bp.PAPER[2] - Bp.PAPER[0] + 1800, Bp.PAPER[3] - Bp.PAPER[1] + 1400);
  g.fill();
  drawStrips(g, s, sec, sheet, light);
  // The parts on their layers, back to front.
  for (const part of PARTS) drawPart(g, s, part, sec, sheet, light);
  drawKnife(g, s, sec, light);
  g.restore();
}

/** The strips of the sheet: parted after the tears, the top one highest; the bird's holes in the middle one. */
function drawStrips(g, s, sec, sheet, light) {
  const [a, b] = s.tears;
  const part = parting(sec - SPREAD);
  const bands = [
    { edge: [b, null], dy: 30 * part, h: 0 },          // below the lower tear
    { edge: [a, b], dy: 0, h: 4 * part },              // between them
    { edge: [null, a], dy: -26 * part, h: 9 * part },  // above the upper tear
  ];
  const torn = (i, x) => sec >= TEARS[i][1] || (sec > TEARS[i][0] && x < Bp.PAPER[0] + ((sec - TEARS[i][0]) / (TEARS[i][1] - TEARS[i][0])) * (Bp.PAPER[2] - Bp.PAPER[0]));
  const outline = (band) => {
    const [top, bottom] = band.edge;
    const pts = [];
    if (top) for (const [x, y] of top) pts.push([x, y]);
    else pts.push([Bp.PAPER[0], Bp.PAPER[1]], [Bp.PAPER[2], Bp.PAPER[1]]);
    if (bottom) for (let i = bottom.length - 1; i >= 0; i--) pts.push([bottom[i][0], bottom[i][1]]);
    else pts.push([Bp.PAPER[2], Bp.PAPER[3]], [Bp.PAPER[0], Bp.PAPER[3]]);
    return pts;
  };
  const holes = (sec2) => PARTS.filter((p) => height(p, sec2) > 0.02).flatMap((p) => s.parts[p.name].shapes);
  if (sec < TEARS[0][0]) {
    // One sheet still: with the parts' holes, where they have risen.
    sheet(g, () => {});
    drawHoles(g, holes(sec));
  } else {
    bands.forEach((band, i) => {
      const pts = outline(band);
      g.save();
      g.translate(0, band.dy);
      // Its shadow on what lies beneath, and the core showing along its lower torn edge.
      if (band.h > 0) shadow(g, [pts], band.h, light, 0.8);
      if (band.edge[1] && part > 0) {
        g.fillStyle = CORE;
        g.beginPath();
        const e = band.edge[1];
        g.moveTo(e[0][0], e[0][1] - 20);
        for (const [x, y, r] of e) g.lineTo(x, y + r * Math.min(1, part * 3));
        g.lineTo(e[e.length - 1][0], e[e.length - 1][1] - 20);
        g.closePath();
        g.fill();
      }
      sheet(g, () => { g.beginPath(); path(g, pts); g.clip(); });
      if (i === 1) drawHoles(g, holes(sec));
      g.restore();
    });
    // The tears running across: a white fibrous line where the sheet is parting.
    for (let i = 0; i < 2; i++) {
      if (sec < TEARS[i][0] || part > 0.3) continue;
      g.save();
      g.strokeStyle = CORE;
      g.lineWidth = 2.2;
      g.lineJoin = 'round';
      g.beginPath();
      let pen = false;
      for (const [x, y] of s.tears[i]) { if (!torn(i, x)) break; if (!pen) { g.moveTo(x, y); pen = true; } else g.lineTo(x, y); }
      g.stroke();
      g.restore();
    }
  }
}

/** The holes the parts left in the sheet: the table, darker at the hole's far edge. */
function drawHoles(g, shapes) {
  if (!shapes.length) return;
  g.save();
  g.fillStyle = Dy.TABLE;
  g.beginPath();
  for (const p of shapes) path(g, p);
  g.fill();
  g.restore();
}

/** A part on its layer: its shadow, the white of its cut edge, the part, and the wing's fold. */
function drawPart(g, s, part, sec, sheet, light) {
  const h = height(part, sec), { shapes, without: minus } = s.parts[part.name];
  if (h <= 0.02) return;
  const t = lifted(h, s.centre);
  g.save();
  g.transform(...t);
  shadow(g, shapes, h, light);
  // The cut edge, clean, a hair of white on the side away from the light.
  g.save();
  g.translate(-Math.cos(light) * 0.9, -Math.sin(light) * 0.9);
  g.fillStyle = CORE;
  g.beginPath();
  for (const p of shapes) path(g, p);
  g.fill();
  g.restore();
  const clipTo = () => {
    g.beginPath();
    for (const p of shapes) path(g, p);
    g.clip();
    if (minus.length) without(g, minus);
  };
  if (part.name !== 'wing') sheet(g, clipTo);
  else drawWing(g, s, sec, sheet, light, shapes[0]);
  g.restore();
}

/** The wing, its upper edge folding down over it along the fold line: the white back shows once it has turned past upright. */
function drawWing(g, s, sec, sheet, light, wing) {
  const { at, n } = s.fold;
  const turn = Math.PI * 0.72 * folding(sec - FOLD);
  const half = (sign) => { g.beginPath(); g.rect(-3000, -3000, 8000, 8000); g.clip(); g.beginPath(); const far = 4000; const d = [-n[1], n[0]]; g.moveTo(at[0] - d[0] * far, at[1] - d[1] * far); g.lineTo(at[0] + d[0] * far, at[1] + d[1] * far); g.lineTo(at[0] + d[0] * far + n[0] * far * sign, at[1] + d[1] * far + n[1] * far * sign); g.lineTo(at[0] - d[0] * far + n[0] * far * sign, at[1] - d[1] * far + n[1] * far * sign); g.closePath(); g.clip(); };
  // The part of the wing that stays.
  sheet(g, () => { g.beginPath(); path(g, wing); g.clip(); half(-1); });
  if (turn <= 0) {
    sheet(g, () => { g.beginPath(); path(g, wing); g.clip(); half(1); });
    return;
  }
  // The flap, squashed towards the fold as it turns: its face while it faces up, its back after.
  const c = Math.cos(turn);
  const A = [1 + (c - 1) * n[0] * n[0], (c - 1) * n[0] * n[1], (c - 1) * n[0] * n[1], 1 + (c - 1) * n[1] * n[1]];
  const e = at[0] - (A[0] * at[0] + A[2] * at[1]), f = at[1] - (A[1] * at[0] + A[3] * at[1]);
  g.save();
  g.transform(A[0], A[1], A[2], A[3], e, f);
  const flap = () => { g.beginPath(); path(g, wing); g.clip(); half(1); };
  if (c > 0) {
    sheet(g, flap);
    g.save();
    flap();
    g.fillStyle = `rgba(0, 0, 10, ${0.3 * Math.sin(turn)})`;
    g.fillRect(-3000, -3000, 8000, 8000);
    g.restore();
  } else {
    g.save();
    flap();
    g.fillStyle = CORE;
    g.fillRect(-3000, -3000, 8000, 8000);
    g.fillStyle = `rgba(80, 60, 40, ${0.22 * Math.sin(turn)})`;
    g.fillRect(-3000, -3000, 8000, 8000);
    g.restore();
  }
  g.restore();
  // Its crease.
  g.save();
  g.beginPath();
  path(g, wing);
  g.clip();
  g.strokeStyle = `rgba(255, 255, 255, ${0.5 * Math.min(1, turn)})`;
  g.lineWidth = 1.2;
  const d = [-n[1], n[0]];
  g.beginPath();
  g.moveTo(at[0] - d[0] * 300, at[1] - d[1] * 300);
  g.lineTo(at[0] + d[0] * 300, at[1] + d[1] * 300);
  g.stroke();
  g.restore();
}

/** Where the knife's point is at second `sec`, and whether it is in the sheet. */
function knifeAt(s, sec) {
  const cs = s.cuts;
  if (sec < cs[0].t0) { const u = Math.max(0, (sec - cs[0].t0 + 0.6) / 0.6); return { p: [cs[0].pts[0][0] + 500 * (1 - u), cs[0].pts[0][1] - 300 * (1 - u)], down: false, on: u > 0 }; }
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (sec <= c.t1 && sec >= c.t0) return { p: pointAt(c, ((sec - c.t0) / (c.t1 - c.t0)) * c.len), down: true, on: true };
    const next = cs[i + 1];
    if (next && sec < next.t0) { const a = c.pts[c.pts.length - 1], u = (sec - c.t1) / (next.t0 - c.t1); return { p: [a[0] + (next.pts[0][0] - a[0]) * u, a[1] + (next.pts[0][1] - a[1]) * u], down: false, on: true }; }
  }
  const last = cs[cs.length - 1].pts, a = last[last.length - 1], u = Math.min(1, (sec - cs[cs.length - 1].t1) / 0.6);
  return { p: [a[0] + 600 * u * u, a[1] - 400 * u * u], down: false, on: u < 1 };
}

function pointAt(c, a) {
  const { pts, cum } = c;
  let lo = 1, hi = pts.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < a) lo = mid + 1; else hi = mid; }
  const u = cum[lo] === cum[lo - 1] ? 0 : Math.max(0, Math.min(1, (a - cum[lo - 1]) / (cum[lo] - cum[lo - 1])));
  return [pts[lo - 1][0] + (pts[lo][0] - pts[lo - 1][0]) * u, pts[lo - 1][1] + (pts[lo][1] - pts[lo - 1][1]) * u];
}

/** The cut so far, a dark slit with a lit lip, until the parts rise; and the knife: its blade and its shadow. */
function drawKnife(g, s, sec, light) {
  if (sec < CUT[0] - 0.6 || sec > LIFT + 0.2) return;
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  for (const c of s.cuts) {
    if (sec < c.t0) break;
    const a1 = Math.min(c.len, ((sec - c.t0) / (c.t1 - c.t0)) * c.len);
    g.moveTo(c.pts[0][0], c.pts[0][1]);
    for (let j = 1; j < c.pts.length && c.cum[j] < a1; j++) g.lineTo(c.pts[j][0], c.pts[j][1]);
    const [x, y] = pointAt(c, a1);
    g.lineTo(x, y);
  }
  g.strokeStyle = 'rgba(6, 10, 20, 0.85)';
  g.lineWidth = 1.3;
  g.stroke();
  g.strokeStyle = 'rgba(255, 255, 255, 0.28)';
  g.lineWidth = 0.6;
  g.translate(Math.cos(light) * 0.7, Math.sin(light) * 0.7);
  g.stroke();
  g.restore();
  const k = knifeAt(s, sec);
  if (!k.on) return;
  const lx = -Math.cos(light), ly = -Math.sin(light), up = k.down ? 0 : 1;
  g.save();
  g.lineCap = 'round';
  // The handle's shadow, then the blade: a steel point along the handle's line.
  const hx = k.p[0] + lx * (8 + up * 10), hy = k.p[1] + ly * (8 + up * 10);
  for (const [w, a] of [[9, 0.12], [5, 0.16]]) {
    g.strokeStyle = `rgba(0, 4, 16, ${a})`;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(hx, hy);
    g.lineTo(hx + 90 + lx * 40, hy - 60 + ly * 40);
    g.stroke();
  }
  g.strokeStyle = 'rgba(220, 226, 232, 0.95)';
  g.lineWidth = 2.4;
  g.beginPath();
  g.moveTo(k.p[0], k.p[1] - up * 4);
  g.lineTo(k.p[0] + 16, k.p[1] - 11 - up * 4);
  g.stroke();
  g.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  g.lineWidth = 0.8;
  g.stroke();
  g.restore();
}

module.exports = { cut, drawCut, CUT, LIFT, FOLD, TEARS, SPREAD };
