// The brush of the ink shot: strokes of the one ink, walked through the
// water's current, laid light to dark by one brush that is seen only by its
// shadow.
//
// WHAT MAKES A STROKE READ AS INK, and what each part below is for:
//
// - A TOUCHDOWN, NOT A CUT. The tip meets the paper first and the stroke
//   swells as the brush presses, so every stroke starts in a point or a small
//   rounded bud; it thins again as the brush lifts.
// - BRISTLES. A stroke is a dozen tracks side by side, one per bundle of
//   hairs, over a thinner film of ink between them. Each track carries its own
//   ink; the brush can be loaded darker on one side than the other, so one
//   stroke holds the ink and its dilution at once.
// - DRY BRUSH. Towards the end the tracks run out of ink one by one, and the
//   paper's tooth breaks them into streaks with the paper showing between.
// - BLEED. Ink spreads into the paper around a stroke: a little on dry paper,
//   a soft wide halo where the water still lies.
// - GLOSS. Fresh ink is wet, and wet ink reflects the light the water does:
//   the same band of light that lies across the wet paper lies brighter across
//   a fresh stroke, and goes as the ink soaks in. It is a reflection, drawn
//   where the light falls, never a stripe painted on each stroke.
//
// ONE INK, LIGHT TO DARK. The first strokes are wide, pale washes; later ones
// are narrower and darker, as a painter works. The first few come straight out
// of the blooming ink, at the fronts of the longest plumes.

'use strict';

const { rng, noise2 } = require('../../core/rand.js');
const P = require('./paper.js');
const Wt = require('./water.js');
const { soft } = require('./held.js');

const STEP = 5;            // stations along a stroke, design units apart
const SETTLE = 0.4;        // seconds after the lift until a stroke has soaked in: no gloss, bleed spread
const START = 0.2;         // the brush's first touchdown, seconds into the shot
const END = 5.92;          // its last lift, as the shot ends: the brush is still on the paper in its last frames
const TONES = 20;          // concentrations are laid in this many steps, one path each

// The painter's three kinds of stroke, in the order they are laid: share of
// the strokes, width, concentration, length (times `reach`), how far a stroke
// may turn off the current, and how widely they spread about the focus.
const KINDS = [
  { share: 0.27, width: [110, 170], tone: [0.07, 0.16], length: [0.9, 1.5], aim: 0.35, spread: null },
  { share: 0.43, width: [38, 90], tone: [0.2, 0.45], length: [0.6, 1.1], aim: 0.8, spread: 0.3 },
  { share: 0.3, width: [10, 34], tone: [0.55, 1], length: [0.5, 1.2], aim: 1.3, spread: 0.2 },
];

// The washes that start at the fronts of the longest plumes, in the water.
const LEAD = 2;

/** Build stage: where every stroke goes, how wide and dark it is, its bristles and when the brush lays it. */
function paint(s) {
  const R = rng(s.seed);
  const current = Wt.currentOf(s);
  const n = Math.round(s.params.strokes);
  const reach = s.params.reach;
  const load = s.params.load;
  s.focus = [P.W * (0.3 + R('focus', 'x') * 0.4), (Wt.edge(s.water.top, P.W / 2) + Wt.edge(s.water.bottom, P.W / 2)) / 2 + (R('focus', 'y') - 0.5) * 80];

  // How many of each kind: the washes first, which block in the sheet, then
  // the middle strokes, then the dark accents, which gather at the focus.
  const counts = KINDS.map((k) => Math.round(k.share * n));
  counts[2] = n - counts[0] - counts[1];
  const plan = [];
  let i = 0;
  KINDS.forEach((kind, kk) => {
    for (let c = 0; c < counts[kk]; c++, i++) {
      let x, y;
      if (!kind.spread) {
        // Washes across the whole sheet, one in each cell of a loose grid so
        // they cover it; the first ones start in the water instead (below).
        const cells = Math.max(1, counts[kk] - LEAD), cc = Math.max(0, c - LEAD);
        const cols = Math.max(1, Math.ceil(Math.sqrt(cells * 1.5)));
        const rows = Math.max(1, Math.ceil(cells / cols));
        x = ((cc % cols) + R('start', 'x', i)) / cols * P.W * 1.1 - P.W * 0.15;
        y = (Math.floor(cc / cols) + 0.15 + R('start', 'y', i) * 0.7) / rows * P.H;
      } else {
        // The rest about the focus, closer for the finer strokes.
        const a = R('start', 'a', i) * Math.PI * 2, r = Math.sqrt(-2 * Math.log(1 - R('start', 'r', i) * 0.98)) * kind.spread;
        x = s.focus[0] + Math.cos(a) * r * P.W;
        y = s.focus[1] + Math.sin(a) * r * P.H;
      }
      plan.push({ i, kind, x: Math.max(-40, Math.min(P.W + 40, x)), y: Math.max(-40, Math.min(P.H + 40, y)) });
    }
  });
  // The first washes come out of the ink already in the water, at the fronts of the longest plumes.
  const fronts = s.plumes.slice().sort((a, b) => b.pts.length - a.pts.length).slice(0, Math.min(LEAD, counts[0]));
  fronts.forEach((p, k) => { const e = p.pts[p.pts.length - 1]; plan[k].x = e[0]; plan[k].y = e[1]; });

  const span = (range, u) => range[0] + (range[1] - range[0]) * u;
  const raw = plan.map(({ i: j, kind, x: x0, y: y0 }) => {
    const width = span(kind.width, R('stroke', 'width', j));
    const length = reach * span(kind.length, R('stroke', 'length', j));
    const tone = Math.min(1, span(kind.tone, R('stroke', 'tone', j)) * load);
    // Walk the current with inertia, from a heading a little off it.
    let heading = current(x0, y0) + (R('stroke', 'aim', j) - 0.5) * 2 * kind.aim;
    const bend = (0.02 + R('stroke', 'bend', j) * 0.08) * (kind.spread ? 1 : 0.5);
    const pts = [[x0, y0]];
    let x = x0, y = y0;
    for (let d = 0; d < length; d += STEP) {
      let turn = (current(x, y) - heading) % (Math.PI * 2);
      if (turn > Math.PI) turn -= Math.PI * 2;
      if (turn < -Math.PI) turn += Math.PI * 2;
      heading += turn * bend;
      x += Math.cos(heading) * STEP;
      y += Math.sin(heading) * STEP;
      if (x < -120 || x > P.W + 120 || y < -120 || y > P.H + 120) break;
      pts.push([x, y]);
    }
    return { j, pts, width, tone };
  }).filter((r) => r.pts.length > 4);

  // The brush's schedule: one stroke at a time, slower for the wide washes,
  // then stretched to fit between START and END.
  let t = 0;
  const times = raw.map((r) => {
    const len = (r.pts.length - 1) * STEP;
    const t0 = t;
    t += Math.min(0.4, Math.max(0.1, len / (1300 + 1200 * r.tone)));
    const t1 = t;
    t += 0.04 + R('stroke', 'air', r.j) * 0.06;
    return [t0, t1];
  });
  const stretch = (END - START) / (times[times.length - 1][1]);

  s.strokes = raw.map((r, k) => stroke(R, s, r, START + times[k][0] * stretch, START + times[k][1] * stretch));
}

/** One stroke's pressure, bristles and bleed, from its walked path. */
function stroke(R, s, { j, pts, width, tone }, t0, t1) {
  const n = pts.length;
  const normals = pts.map((p, k) => {
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(n - 1, k + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
  });
  // How the brush leaves the paper: flicked off to a point, dragged on until
  // it splits dry, or pressed and lifted straight up, round.
  const e = R('stroke', 'end', j);
  // Flicked ends are the fewest: a sheet of strokes tapered at both ends reads as leaves or fish.
  const end = e < 0.2 ? 'flick' : e < 0.72 ? 'split' : 'round';
  // Pressure spreads the bristles: the brush bears down hardest at one place
  // and eases either side.
  const down = 0.06 + R('stroke', 'down', j) * 0.08;
  const pressAt = 0.2 + R('stroke', 'pressAt', j) * 0.45;
  const tip = 0.15 + R('stroke', 'tip', j) * 0.2;
  const lift = end === 'flick' ? 0.5 + R('stroke', 'lift', j) * 0.25 : end === 'round' ? 0.88 : 0.8;
  const floor = end === 'flick' ? 0.05 : end === 'round' ? 0.5 : 0.7;
  const w = pts.map((_, k) => {
    const u = k / (n - 1);
    const press = 0.62 + 0.38 * Math.exp(-(((u - pressAt) / 0.32) ** 2));
    // The tip meets the paper first, and the stroke swells from it.
    const inn = u < down ? tip + (1 - tip) * Math.pow(Math.sin((u / down) * Math.PI / 2), 0.8) : 1;
    const wander = 0.9 + 0.1 * noise2(R, u * 4, j * 1.7, 'press');
    const out = u > lift ? floor + (1 - floor) * Math.pow(1 - (u - lift) / (1 - lift), 0.9) : 1;
    return width * press * wander * inn * out;
  });
  // Where the brush starts to run dry.
  const dry = end === 'split' ? 0.4 + R('stroke', 'dryAt', j) * 0.25 : end === 'flick' ? 0.6 + R('stroke', 'dryAt', j) * 0.3 : 2;
  // The brush loaded darker on one side than the other.
  // On a thin stroke a strong difference reads as an outline along one edge, so it is milder there.
  const side = (R('stroke', 'side', j) - 0.5) * (width < 40 ? 0.7 : 1.3);
  const count = Math.max(10, Math.min(28, Math.round(width / 3)));
  const bristles = [];
  for (let b = 0; b < count; b++) {
    const o = ((b + 0.5) / count) * 2 - 1 + (R('bristle', 'o' + j, b) - 0.5) * (1.6 / count);
    const edge = Math.min(1, Math.abs(o));
    // The outer hairs reach the paper after the tip and, on a flick, leave it
    // before the tip does: that is the taper at both ends.
    const from = down * (0.15 + 0.85 * edge ** 1.5) * (0.8 + R('bristle', 'from' + j, b) * 0.4);
    const to = end === 'flick' ? 1 - (1 - lift) * edge ** 0.8 * (0.8 + R('bristle', 'to' + j, b) * 0.4) : 1 - R('bristle', 'to' + j, b) * 0.03;
    const dryAt = dry * (0.75 + R('bristle', 'dry' + j, b) * 0.5);
    // Its own ink: darker on the loaded side, and at the very edges, where ink gathers.
    const c = tone * (0.6 - 0.55 * (1 - tone)) * (1 + side * o) * (0.7 + R('bristle', 'tone' + j, b) * 0.6) * (1 + 0.12 * edge ** 4);
    // The path of this hair: its place across the stroke, and a slow wander of its own.
    const line = pts.map(([x, y], k) => {
      const off = o * w[k] * 0.5 + (noise2(R, k * STEP / 30, b * 1.3 + j * 7, 'wobble') - 0.5) * w[k] * 0.07;
      return [x + normals[k][0] * off, y + normals[k][1] * off];
    });
    // Its runs: unbroken while it has ink; once it runs dry, the paper's tooth
    // breaks it into long streaks that thin out towards the end.
    const runs = [];
    let at = -1;
    const k0 = Math.round(from * (n - 1)), k1 = Math.round(to * (n - 1));
    for (let k = k0; k <= k1; k++) {
      const u = k / (n - 1);
      const left = 1 - Math.max(0, u - dryAt) / 0.4;
      const ink = u <= dryAt || left > 0.05 + 0.95 * noise2(R, k * STEP / 26, b * 5.3 + j * 3, 'tooth');
      if (ink && at < 0) at = k;
      if ((!ink || k === k1) && at >= 0) {
        const stop = ink ? k : k - 1;
        if (stop > at) runs.push([at, stop, at / (n - 1) > dryAt ? 0.75 : 1]);
        at = -1;
      }
    }
    // A wet, pale brush leaves no hair marks: its hairs are all film.
    if (c < 0.025) continue;
    bristles.push({ line, runs, c: Math.min(1, c), lw: Math.max(0.6, (width / count) * (1.1 + R('bristle', 'w' + j, b) * 0.9)) });
  }
  // The film of ink between the hairs, while the brush is wet.
  const body = Math.min(n - 1, Math.round(Math.min(1, dry + 0.04) * (n - 1)));
  // Which stations lie in the water: there the ink bleeds wide.
  const inside = (x, y) => y > Wt.edge(s.water.top, x) && y < Wt.edge(s.water.bottom, x);
  const wet = pts.map(([x, y]) => inside(x, y));
  // Puffs: where the brush is wet the ink lies as the bloom's did, soft and
  // mottled with a lacy edge. The more water the brush carries, the more of
  // the stroke is puffs rather than film and hairs; in the water every stroke
  // breaks out into it.
  const blooms = [];
  const wash = Math.max(0, 1 - tone * 1.7);
  for (let k = 0, i = 0; k < n; i++) {
    const inWater = wet[k];
    const share = inWater ? Math.max(wash, 0.45) : wash;
    const r = Math.min(inWater ? 34 : 60, w[k] * 0.5) * (0.8 + R('bloom', 'r' + j, i) * 0.4);
    if (share > 0 && k / (n - 1) < Math.min(1, dry + 0.1) && r > 2) {
      const turn = Math.atan2(-normals[k][0], normals[k][1]) + (R('bloom', 'turn' + j, i) - 0.5) * 0.5;
      blooms.push({ k, r, spreads: inWater, shift: (R('bloom', 'shift' + j, i) - 0.5) * w[k] * (inWater ? 0.6 : 0.3), cos: Math.cos(turn), sin: Math.sin(turn),
        alpha: Math.min(0.7, tone * share * 1.5 * (0.7 + R('bloom', 'a' + j, i) * 0.6)), variant: Math.floor(R('bloom', 'v' + j, i) * Wt.VARIANTS) });
    }
    k += Math.max(1, Math.round(Math.max(6, r * (inWater ? 0.9 : 0.6)) / STEP));
  }
  // The film's edge, each side on its own, fixed so it does not boil from frame to frame.
  const rag = pts.map((_, k) => [0.9 + 0.2 * noise2(R, k * STEP / 16, j * 2.3, 'rag'), 0.9 + 0.2 * noise2(R, k * STEP / 16, j * 2.3 + 50, 'rag')]);
  return { j, pts, normals, w, bristles, body, down, wet, blooms, rag, tone, end, t0, t1 };
}

/** How far along a stroke the brush has got at second `sec`, in stations: it eases in and out. */
function head(st, sec) {
  const u = Math.max(0, Math.min(1, (sec - st.t0) / (st.t1 - st.t0)));
  return (st.pts.length - 1) * u * u * (3 - 2 * u);
}

/** The strokes that have soaked in by second `sec`: the brush lays them in order, so it is a count. */
function settled(s, sec) {
  let k = 0;
  while (k < s.strokes.length && s.strokes[k].t1 + SETTLE <= sec) k++;
  return k;
}

/**
 * Draw the strokes in `list` as they stand at second `sec` (Infinity: soaked
 * in). Every stroke's bleed goes in one soft layer; then the film under the
 * hairs; then the hairs, one path for each concentration and width.
 */
function drawStrokes(g, s, list, sec) {
  const parts = list.map((i) => {
    const st = s.strokes[i];
    return { st, h: sec === Infinity ? st.pts.length - 1 : head(st, sec), age: sec - st.t1 };
  }).filter((p) => p.h > 0);
  if (!parts.length) return;
  // The puffs: in the water they spread as the stroke soaks, as the line's did.
  const img = Wt.puffSprite();
  const m = typeof g.getTransform === 'function' ? g.getTransform() : null;
  if (img && m) {
    g.save();
    for (const { st, h, age } of parts) {
      const grow = Math.min(1, Math.max(0, (age + 0.4) / SETTLE));
      for (const q of st.blooms) {
        if (q.k > h) break;
        const [x, y] = st.pts[q.k], [nx, ny] = st.normals[q.k];
        Wt.stamp(g, m, img, q, x + nx * q.shift, y + ny * q.shift, q.r * (q.spreads ? 0.7 + 0.9 * grow : 1));
      }
    }
    g.restore();
  }
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // The film under the hairs.
  const films = new Map();
  for (const { st, h } of parts) {
    const c = Math.round(st.tone * (0.35 + 0.3 * (1 - st.tone)) * TONES) / TONES;
    if (!films.has(c)) films.set(c, []);
    films.get(c).push([st, Math.min(h, st.body)]);
  }
  // Laid at half the resolution and smoothed back up: the paper takes the
  // film in, and its edge is soft where the hairs' edges are not.
  soft(g, 2, (sg) => {
    for (const [c, list2] of films) {
      sg.fillStyle = P.wash(c);
      sg.beginPath();
      for (const [st, h] of list2) {
        const k0 = Math.round(st.down * 0.6 * (st.pts.length - 1));
        const k1 = st.body, fade = Math.max(1, (k1 - k0) * 0.25);
        band(sg, st.pts, st.normals, k0, h, (q) => st.w[q] * 0.45 * Math.min(1, (k1 - q) / fade + 0.08), st.rag);
      }
      sg.fill();
    }
  });
  // The hairs, grouped by concentration and width.
  const groups = new Map();
  for (const { st, h } of parts) {
    for (const br of st.bristles) {
      for (const [a, b, fade] of br.runs) {
        if (a >= h) continue;
        const c = Math.round(br.c * fade * 10) / 10;
        const lw = Math.max(0.6, Math.round(br.lw));
        const key = c + '|' + lw;
        if (!groups.has(key)) groups.set(key, { c, lw, runs: [] });
        groups.get(key).runs.push([br.line, a, Math.min(b, h)]);
      }
    }
  }
  for (const { c, lw, runs } of groups.values()) {
    g.strokeStyle = P.wash(c);
    g.lineWidth = lw;
    g.beginPath();
    for (const [line, a, b] of runs) polyline(g, line, a, b);
    g.stroke();
  }
  g.restore();
}

/** A polyline from station a to station b (fractional). */
function polyline(g, line, a, b) {
  g.moveTo(line[a][0], line[a][1]);
  const last = Math.floor(b);
  for (let k = a + 1; k <= last; k++) g.lineTo(line[k][0], line[k][1]);
  if (b > last && last + 1 < line.length) {
    const u = b - last, p = line[last], q = line[last + 1];
    g.lineTo(p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u);
  }
}

/** A closed band around a path from station a to b (fractional), at half-width hw(k), rounded at both ends. */
function band(g, pts, normals, a, b, hw, rag = null) {
  if (!(b > a)) return;
  const left = [], right = [];
  const at = (k, u) => {
    const k1 = Math.min(pts.length - 1, k + 1);
    const x = pts[k][0] + (pts[k1][0] - pts[k][0]) * u, y = pts[k][1] + (pts[k1][1] - pts[k][1]) * u;
    const nx = normals[k][0], ny = normals[k][1], w = hw(k) + (hw(k1) - hw(k)) * u;
    // A ragged edge, each side on its own: where the paper let the ink in further, or less.
    const l = rag ? w * rag[k][0] : w, r = rag ? w * rag[k][1] : w;
    left.push([x + nx * l, y + ny * l]);
    right.push([x - nx * r, y - ny * r]);
  };
  const last = Math.floor(b);
  for (let k = a; k <= last; k++) at(k, 0);
  if (b > last) at(last, b - last);
  if (left.length < 2) return;
  const cap = (from, to, r, cx, cy, dir) => {
    // Half a circle from one edge to the other, bulging towards dir.
    const t0 = Math.atan2(from[1] - cy, from[0] - cx);
    const sweep = Math.cos(t0 - Math.PI / 2) * dir[0] + Math.sin(t0 - Math.PI / 2) * dir[1] >= 0 ? 1 : -1;
    for (let i = 1; i < 6; i++) { const th = t0 - sweep * (i / 6) * Math.PI; g.lineTo(cx + Math.cos(th) * r, cy + Math.sin(th) * r); }
    g.lineTo(to[0], to[1]);
  };
  const e = left.length - 1;
  const mid = (i) => [(left[i][0] + right[i][0]) / 2, (left[i][1] + right[i][1]) / 2];
  const rad = (i) => Math.hypot(left[i][0] - right[i][0], left[i][1] - right[i][1]) / 2;
  g.moveTo(left[0][0], left[0][1]);
  for (let i = 1; i <= e; i++) g.lineTo(left[i][0], left[i][1]);
  const [ex, ey] = mid(e), [px, py] = mid(Math.max(0, e - 1));
  cap(left[e], right[e], rad(e), ex, ey, [ex - px, ey - py]);
  for (let i = e - 1; i >= 0; i--) g.lineTo(right[i][0], right[i][1]);
  const [sx, sy] = mid(0), [qx, qy] = mid(Math.min(e, 1));
  cap(right[0], left[0], rad(0), sx, sy, [sx - qx, sy - qy]);
  g.closePath();
}

/**
 * Gloss: the light's band across the sheet, brighter on ink that is still wet.
 * `sheen` is the water's gradient for this second; each fresh stroke's film
 * takes it at a strength that falls as the stroke soaks in.
 */
function drawGloss(g, s, list, sec, sheen) {
  g.save();
  g.fillStyle = sheen;
  for (const i of list) {
    const st = s.strokes[i];
    const h = head(st, sec);
    const wet = 1 - Math.max(0, sec - st.t1) / SETTLE;
    if (h <= 0 || wet <= 0) continue;
    // Thick ink shines most: the dark strokes, not the pale washes.
    g.globalAlpha = wet * (0.5 + 0.9 * st.tone);
    g.beginPath();
    band(g, st.pts, st.normals, Math.round(st.down * 0.6 * (st.pts.length - 1)), Math.min(h, st.body), (k) => st.w[k] * 0.38);
    g.fill();
  }
  g.restore();
}

/** Where the brush is at second `sec`: on a stroke, or in the air between two, or off the sheet. */
function brushAt(s, sec) {
  const list = s.strokes;
  for (let i = 0; i < list.length; i++) {
    const st = list[i];
    if (sec < st.t0) {
      const from = i ? list[i - 1] : null;
      const a = from ? from.pts[from.pts.length - 1] : [-200, st.pts[0][1] - 150];
      const t0 = from ? from.t1 : 0;
      const u = Math.max(0, Math.min(1, (sec - t0) / (st.t0 - t0)));
      const e = u * u * (3 - 2 * u);
      return { x: a[0] + (st.pts[0][0] - a[0]) * e, y: a[1] + (st.pts[0][1] - a[1]) * e, down: false };
    }
    if (sec <= st.t1) {
      const h = head(st, sec), k = Math.min(st.pts.length - 1, Math.floor(h));
      return { x: st.pts[k][0], y: st.pts[k][1], down: true };
    }
  }
  const last = list[list.length - 1], e = last.pts[last.pts.length - 1];
  const u = Math.min(1, (sec - last.t1) / 0.6), k = u * u * (3 - 2 * u);
  return { x: e[0] + (P.W + 260 - e[0]) * k, y: e[1] + (-160 - e[1]) * k, down: false };
}

/** The brush and the hand over the sheet, seen by the light they block: nearer and sharper when the brush is down. */
function drawBrushShadow(g, s, sec) {
  const b = brushAt(s, sec);
  const lx = Math.cos(s.light), ly = Math.sin(s.light);
  const off = b.down ? 26 : 60;
  const cx = b.x - lx * off, cy = b.y - ly * off, r = b.down ? 70 : 110;
  const shade = g.createRadialGradient(cx, cy, 0, cx, cy, r);
  shade.addColorStop(0, `rgba(60, 48, 32, ${b.down ? 0.13 : 0.08})`);
  shade.addColorStop(1, 'rgba(60, 48, 32, 0)');
  g.fillStyle = shade;
  g.fillRect(cx - r, cy - r, 2 * r, 2 * r);
}

module.exports = { paint, drawStrokes, drawGloss, drawBrushShadow, settled, SETTLE, START, END };
