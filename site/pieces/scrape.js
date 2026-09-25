// The impasto scraped into a Kandinsky (see skills/artifex/styles/kandinsky.md).
// A palette knife drags the background's dabs off the ground in long strokes,
// round the bird, leaving the cream ground with a thin smear of their colours;
// it swirls thin paint into soft halos; then it pivots, drags and presses the
// bird's own dabs into the style's forms, part by part: the tail into a heavy
// bar, fanned lines and a chequer strip, the body into a half disc under a
// glaze, the wing into a rainbow of arcs, the head into a haloed circle with
// the eye in rings, the beak into a triangle; the legs and the perch are
// pressed with its edge. Last come the long lines across the whole
// composition and the small floating forms.
//
// WHAT THE KNIFE HAS DONE IS A REGION. Each step clears a region of the
// impasto -- a band, a sector, a strip -- to the scraped ground, and shows
// there every form laid so far, in the style's order: the forms are drawn
// whole, and where they show is where the knife has been. Glazes multiply
// over what is beneath them, as the style asks. Each step is laid over the
// last through its own simple clip: a clip of every region at once, redrawn
// whenever one is added, cost the browser up to 150 ms a time.
//
// The style's forms are laid out in its own units (a 1000-unit square, the
// bird about 370 to one of its units) and placed on the bird as the sheet
// holds it; the composition is widened to the frame's own proportions.

'use strict';

const { rng } = require('../../core/rand.js');
const { pointInPoly } = require('../../core/geom.js');
const Dr = require('./draft.js');
const Im = require('./impasto.js');
const Oil = require('./oil.js');

const Q = Dr.SCALE / 370;
const G = (x, y) => [Dr.FRONT[0] + (x - 465) * Q, Dr.FRONT[1] + (y - 525) * Q];
const TAU = Math.PI * 2;
const K = {
  black: '#1b1b1f', red: '#d8412f', vermilion: '#e0452b', yellow: '#f2c14e', blue: '#2f5fa7',
  teal: '#3fa9a2', pink: '#e98aa6', green: '#5a9e5a', violet: '#7b5ea7', orange: '#ec8a2f', white: '#fbf7ee',
};
const DRAG = -0.45;                         // the background's strokes run up and to the right
const PAINTED = 299 / 30;                   // the paint seam's last frame
const ENDS = 11.66;                         // the knife's last step ends, so it has left by the last frame

// Regions, in sheet units: closed polygons, all turning the same way, so a path
// of several is their union. Every one has many edges, even a thin sliver: a
// browser clips to a convex polygon of a few edges another way, and each new
// way it meets costs it up to 100 ms the first time.
function turned(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a < 0 ? pts.slice().reverse() : pts;
}

function sector(c, r, a0, a1, inner = 0) {
  const n = Math.max(16, Math.ceil(Math.abs(a1 - a0) / 0.06)), out = [];
  for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); }
  if (inner > 0) for (let i = n; i >= 0; i--) { const a = a0 + ((a1 - a0) * i) / n; out.push([c[0] + inner * Math.cos(a), c[1] + inner * Math.sin(a)]); }
  else out.push(c);
  return turned(out);
}

function strip(a, b, w) {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, n = [(-(b[1] - a[1]) / l) * w / 2, ((b[0] - a[0]) / l) * w / 2];
  const out = [];
  for (let i = 0; i <= 8; i++) out.push([a[0] + n[0] + ((b[0] - a[0]) * i) / 8, a[1] + n[1] + ((b[1] - a[1]) * i) / 8]);
  for (let i = 8; i >= 0; i--) out.push([a[0] - n[0] + ((b[0] - a[0]) * i) / 8, a[1] - n[1] + ((b[1] - a[1]) * i) / 8]);
  return turned(out);
}

/** A step's region at progress `u` in (0, 1]. */
function region(st, u) {
  if (st.kind === 'drag') return strip(st.a, [st.a[0] + (st.b[0] - st.a[0]) * u, st.a[1] + (st.b[1] - st.a[1]) * u], st.w);
  return sector(st.c, st.r, st.a0, st.a0 + (st.a1 - st.a0) * u, st.inner);
}

function trace(g, pts) {
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
}

/** A polygon grown by `d` along its vertices' normals. */
function grown(pts, d) {
  const p = turned(pts), n = p.length;
  return p.map((q, i) => {
    const a = p[(i + n - 1) % n], b = p[(i + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [q[0] + ((b[1] - a[1]) / l) * d, q[1] - ((b[0] - a[0]) / l) * d];
  });
}

// Drawing the style's forms, in sheet units.
function disc(g, c, r, fill) { g.fillStyle = fill; g.beginPath(); g.arc(c[0], c[1], r, 0, TAU); g.fill(); }
function line(g, a, b, w, colour = K.black) { g.strokeStyle = colour; g.lineWidth = w; g.lineCap = 'butt'; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
function halo(g, c, r0, r1, rgb, alpha) {
  const h = g.createRadialGradient(c[0], c[1], r0, c[0], c[1], r1);
  h.addColorStop(0, `rgba(${rgb}, ${alpha})`);
  h.addColorStop(1, `rgba(${rgb}, 0)`);
  g.fillStyle = h;
  g.beginPath();
  g.arc(c[0], c[1], r1, 0, TAU);
  g.fill();
}
const multiply = (draw) => (g) => { g.save(); g.globalCompositeOperation = 'multiply'; draw(g); g.restore(); };

/** Build stage: the knife's steps and the forms each one leaves. */
function forms(s) {
  const R = rng(s.seed);
  const steps = [], shapes = [];
  let t = 0.45;
  // A step: `kind` drag (a to b, `w` wide) or sweep (about c, radius r, angles a0 to a1), lasting `d` seconds.
  const step = (o, d, gap = 0.03) => { const st = { ...o, t0: t, t1: t + d }; t += d + gap; steps.push(st); return steps.length - 1; };
  const drag = (a, b, w, d, more) => step({ kind: 'drag', a: G(...a), b: G(...b), w: w * Q, ...more }, d);
  const sweep = (c, r, a0, a1, d, more) => step({ kind: 'sweep', c: G(...c), r: r * Q, a0, a1, inner: 0, ...more }, d);
  // A form, in the style's order `z`, shown once step `at` has reached it; `paint`, the colour the knife lays it in.
  const form = (at, z, draw, paint = K.black) => { shapes.push({ at, z, draw }); steps[at].paint = steps[at].paint || paint; };

  // The background, in long strokes across the view, back and forth, round the bird.
  const dir = [Math.cos(DRAG), Math.sin(DRAG)], nor = [-dir[1], dir[0]];
  const [vx0, vy0, vx1, vy1] = Im.VIEW, corners = [[vx0, vy0], [vx1, vy0], [vx0, vy1], [vx1, vy1]];
  const across = corners.map(([x, y]) => x * nor[0] + y * nor[1]), along = corners.map(([x, y]) => x * dir[0] + y * dir[1]);
  const lo = Math.min(...across), hi = Math.max(...across), a0 = Math.min(...along) - 40, a1 = Math.max(...along) + 40;
  const BAND = 128, count = Math.ceil((hi - lo - BAND) / (BAND - 26)) + 1, pitch = (hi - lo - BAND) / (count - 1);
  for (let i = 0; i < count; i++) {
    const c = lo + BAND / 2 + i * pitch, from = i % 2 ? a1 : a0, to = i % 2 ? a0 : a1;
    const at = (v) => [nor[0] * c + dir[0] * v, nor[1] * c + dir[1] * v];
    steps.push({ kind: 'drag', a: at(from), b: at(to), w: BAND, bg: true, t0: t, t1: t + 0.3 });
    t += 0.35;
  }
  // Thin paint swirled into halos.
  form(sweep([620, 370], 250, -1.2, -1.2 + TAU, 0.3, { wash: true }), 0, (g) => halo(g, G(620, 370), 60 * Q, 250 * Q, '242, 193, 78', 0.35), K.yellow);
  form(sweep([60, 170], 95, 0.5, 0.5 + TAU, 0.22, { wash: true }), 1, (g) => halo(g, G(60, 170), 20 * Q, 95 * Q, '216, 65, 47', 0.35), K.red);
  form(sweep([430, 600], 260, 2.2, 2.2 + TAU, 0.3, { wash: true }), 2, (g) => halo(g, G(430, 600), 80 * Q, 260 * Q, '47, 95, 167', 0.14), K.blue);
  t += 0.08;

  // The tail: a heavy bar dragged out of its dabs, fanned lines pressed with the edge, a chequer strip stamped.
  const tailAt = drag([335, 525], [85, 380], 150, 0.42, { clear: true });
  form(tailAt, 40, (g) => line(g, G(292, 500), G(118, 398), 24 * Q));
  for (const end of [[108, 470], [118, 522], [150, 578]]) form(drag([300, 522], end, 10, 0.07, { edge: true }), 41, (g) => line(g, G(300, 522), G(...end), 3 * Q));
  const ang = Math.atan2(398 - 500, 118 - 292), ca = Math.cos(ang), sa = Math.sin(ang);
  const chq = (u, v) => [250 + u * ca - v * sa, 520 + u * sa + v * ca];
  form(drag(chq(-4, 14), chq(130, 14), 40, 0.3), 42, (g) => {
    g.save();
    const o = G(250, 520);
    g.translate(o[0], o[1]);
    g.rotate(ang);
    const k = 14 * Q;
    for (let i = 0; i < 9; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? K.black : K.white; g.fillRect(i * k, j * k, k, k); }
    g.strokeStyle = K.black;
    g.lineWidth = 2 * Q;
    g.strokeRect(0, 0, 9 * k, 2 * k);
    g.restore();
  });
  t += 0.06;
  // The body: a half disc pivoted out of it, and a pink glaze circle over that.
  form(sweep([460, 560], 205, -0.35, Math.PI - 0.35, 0.55, { clear: true }), 10, multiply((g) => {
    const c = G(460, 560), grad = g.createLinearGradient(...G(330, 480), ...G(560, 740));
    grad.addColorStop(0, '#5b86c5');
    grad.addColorStop(1, K.blue);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(c[0], c[1], 190 * Q, -0.35, Math.PI - 0.35);
    g.closePath();
    g.fill();
  }), K.blue);
  form(sweep([395, 615], 124, 3.4, 3.4 + TAU, 0.34, { clear: true }), 11, multiply((g) => disc(g, G(395, 615), 118 * Q, 'rgba(233, 138, 166, 0.85)')), K.pink);
  // The wing: a rainbow of arcs, each swept round the same pivot.
  [K.violet, K.blue, K.green, K.yellow, K.orange, K.red].forEach((c, i) => {
    form(sweep([420, 560], 80 + i * 15, Math.PI + 0.22, TAU - 0.4, 0.13, { inner: i ? (64 + i * 15) * Q : 0, clear: true }), 12 + i, multiply((g) => {
      const o = G(420, 560);
      g.strokeStyle = c;
      g.lineWidth = 15 * Q;
      g.lineCap = 'butt';
      g.beginPath();
      g.arc(o[0], o[1], (72 + i * 15) * Q, Math.PI + 0.22, TAU - 0.4);
      g.stroke();
    }), c);
  });
  t += 0.05;
  // The head: a circle graded like light, the black arc beside it, the eye in rings.
  form(sweep([620, 370], 132, -1.9, -1.9 + TAU, 0.5, { clear: true }), 20, multiply((g) => {
    const c = G(620, 370), h = g.createRadialGradient(...G(585, 335), 10 * Q, c[0], c[1], 118 * Q);
    h.addColorStop(0, '#fbe3a0');
    h.addColorStop(0.6, K.yellow);
    h.addColorStop(1, '#e0a93a');
    disc(g, c, 116 * Q, h);
  }), K.yellow);
  form(sweep([620, 370], 133, -1.25, 1.55, 0.14, { inner: 123 * Q, edge: true }), 30, (g) => {
    const c = G(620, 370);
    g.strokeStyle = K.black;
    g.lineWidth = 3 * Q;
    g.beginPath();
    g.arc(c[0], c[1], 128 * Q, -1.25, 1.55);
    g.stroke();
  });
  form(sweep([655, 345], 46, 0, TAU, 0.14), 31, (g) => disc(g, G(655, 345), 44 * Q, K.white), K.white);
  form(sweep([655, 345], 38, 1, 1 + TAU, 0.1), 32, (g) => { const c = G(655, 345); g.strokeStyle = K.red; g.lineWidth = 11 * Q; g.beginPath(); g.arc(c[0], c[1], 31 * Q, 0, TAU); g.stroke(); }, K.red);
  form(sweep([655, 345], 18, 2, 2 + TAU, 0.07), 33, (g) => disc(g, G(655, 345), 16 * Q, K.black));
  form(sweep([661, 339], 7, 0, TAU, 0.04), 34, (g) => disc(g, G(661, 339), 5 * Q, K.white), K.white);
  // The beak, dragged to its point, and the song out of it.
  form(drag([700, 395], [890, 402], 76, 0.26, { clear: true }), 21, multiply((g) => { g.fillStyle = K.vermilion; g.beginPath(); trace(g, [G(712, 362), G(884, 402), G(718, 428)]); g.fill(); }), K.vermilion);
  form(drag([884, 402], [948, 418], 10, 0.07, { edge: true }), 35, (g) => line(g, G(884, 402), G(948, 418), 3 * Q));
  form(sweep([956, 420], 12, 3.1, 3.1 + TAU, 0.06, { inner: 4 * Q }), 36, (g) => { const c = G(956, 420); g.strokeStyle = K.black; g.lineWidth = 3 * Q; g.beginPath(); g.arc(c[0], c[1], 8 * Q, 0, TAU); g.stroke(); });
  t += 0.04;
  // Legs, feet and the ruled perch, with the knife's edge and its tip.
  form(drag([442, 742], [422, 866], 12, 0.09, { edge: true }), 50, (g) => line(g, G(442, 742), G(422, 866), 4 * Q));
  form(drag([522, 738], [532, 866], 12, 0.09, { edge: true }), 51, (g) => line(g, G(522, 738), G(532, 866), 4 * Q));
  form(sweep([422, 868], 12, 0, TAU, 0.05), 52, (g) => disc(g, G(422, 868), 9 * Q, K.black));
  form(sweep([532, 868], 12, 0, TAU, 0.05), 53, (g) => disc(g, G(532, 868), 9 * Q, K.black));
  form(drag([150, 880], [890, 850], 12, 0.26, { edge: true }), 54, (g) => line(g, G(150, 880), G(890, 850), 3 * Q));
  form(drag([612, 870], [888, 848], 30, 0.16), 55, (g) => { for (let x = 620; x <= 880; x += 16) { const y = 880 - ((x - 150) / 740) * 30; line(g, G(x, y - 9), G(x, y + 9), 2 * Q); } });
  // What is left of the bird's dabs, wiped off round it.
  sweep([465, 525], 450, -2.6, -2.6 + TAU, 0.5, { clear: true });
  // The long lines across the whole composition.
  form(drag([-150, 432], [380, 140], 16, 0.2, { edge: true }), 5, (g) => line(g, G(-150, 432), G(380, 140), 7 * Q));
  form(sweep([520, 900], 704, -2.9, -0.45, 0.34, { inner: 696 * Q, edge: true }), 6, (g) => { const c = G(520, 900); g.strokeStyle = K.black; g.lineWidth = 3 * Q; g.beginPath(); g.arc(c[0], c[1], 700 * Q, -2.9, -0.45); g.stroke(); });
  form(drag([690, 610], [1250, 409], 10, 0.15, { edge: true }), 7, (g) => line(g, G(690, 610), G(1250, 409), 2.5 * Q));
  form(drag([70, 930], [300, 700], 10, 0.1, { edge: true }), 8, (g) => line(g, G(70, 930), G(300, 700), 2.5 * Q));
  form(drag([980, 40], [1280, 470], 10, 0.12, { edge: true }), 9, (g) => line(g, G(980, 40), G(1280, 470), 2.5 * Q));
  // The small floating forms.
  form(sweep([60, 170], 38, 0, TAU, 0.1), 60, (g) => disc(g, G(60, 170), 34 * Q, K.red), K.red);
  form(sweep([70, 162], 12, 0, TAU, 0.04), 61, (g) => disc(g, G(70, 162), 9 * Q, K.black));
  form(drag([1016, 180], [1140, 176], 130, 0.12), 62, multiply((g) => { g.fillStyle = K.teal; g.beginPath(); trace(g, [G(1026, 214), G(1122, 116), G(1134, 236)]); g.fill(); }), K.teal);
  form(sweep([250, 326], 46, 2.5, 2.5 + TAU, 0.1), 63, (g) => {
    g.save();
    g.beginPath();
    g.rect(-3000, -3000, 8000, 8000);
    const h = G(268, 318);
    g.moveTo(h[0] + 38 * Q, h[1]);
    g.arc(h[0], h[1], 38 * Q, 0, TAU);
    g.clip('evenodd');
    disc(g, G(250, 326), 42 * Q, K.green);
    g.restore();
  }, K.green);
  form(sweep([-40, 680], 42, 4, 4 + TAU, 0.09, { inner: 20 * Q }), 64, (g) => { const c = G(-40, 680); g.strokeStyle = K.blue; g.lineWidth = 8 * Q; g.beginPath(); g.arc(c[0], c[1], 30 * Q, 0, TAU); g.stroke(); }, K.blue);
  form(sweep([-40, 680], 15, 0, TAU, 0.04), 65, (g) => disc(g, G(-40, 680), 12 * Q, K.red), K.red);
  form(drag([994, 654], [1098, 654], 104, 0.12), 66, (g) => { for (let k = 0; k <= 4; k++) { line(g, G(1000 + k * 22, 610), G(1000 + k * 22, 698), 2 * Q); line(g, G(1000, 610 + k * 22), G(1088, 610 + k * 22), 2 * Q); } });
  form(sweep([1150, 820], 64, Math.PI, TAU, 0.09), 67, multiply((g) => { const c = G(1150, 820); g.fillStyle = 'rgba(242, 193, 78, 0.9)'; g.beginPath(); g.arc(c[0], c[1], 58 * Q, Math.PI, TAU); g.closePath(); g.fill(); }), K.yellow);
  for (let i = 0; i < 7; i++) {
    const c = [-150 + R('dot', 'x', i) * 1420, 60 + R('dot', 'y', i) * 880], r = 3 + R('dot', 'r', i) * 5;
    form(sweep(c, r + 3, 0, TAU, 0.035, {}), 70 + i, (g) => disc(g, G(...c), r * Q, K.black));
  }
  // Everything after the background, fitted to end as the shot does.
  const from = steps.find((st) => !st.bg).t0, k = (ENDS - from) / (t - 0.03 - from);
  for (const st of steps) if (!st.bg) { st.t0 = from + (st.t0 - from) * k; st.t1 = from + (st.t1 - from) * k; }
  // The dabs each step drags away: the background's round the bird, then the bird's, each once, in the order the knife meets them.
  Oil.add(s, Object.values(K));
  const left = new Set(s.dabs.keys());
  const inHull = (d) => s.hull.some((p) => pointInPoly([d.x, d.y], p));
  steps.forEach((st, j) => {
    st.dabs = [];
    if (!st.bg && !st.clear) return;
    const poly = region(st, 1), xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    for (const i of left) {
      const d = s.dabs[i];
      if (d.x < x0 || d.x > x1 || d.y < y0 || d.y > y1 || !pointInPoly([d.x, d.y], poly) || (st.bg && inHull(d))) continue;
      st.dabs.push(dragged(st, d, i, R));
    }
    for (const e of st.dabs) left.delete(e.i);
    st.dabs.sort((p, q) => p.p - q.p);
  });
  shapes.sort((p, q) => p.z - q.z);
  // Steps kept five at a time.
  s.groups = [];
  for (let j = 0; j < steps.length; j += 5) s.groups.push([j, Math.min(steps.length, j + 5)]);
  s.steps = steps;
  s.shapes = shapes;
}

/** How step `st` drags dab `d` (index `i`): when it meets it, which way, how far the smear runs at most, and over how far the knife goes. */
function dragged(st, d, i, R) {
  let p, a, span;
  if (st.kind === 'drag') {
    const v = [st.b[0] - st.a[0], st.b[1] - st.a[1]], l2 = v[0] * v[0] + v[1] * v[1];
    p = Math.max(0, Math.min(1, ((d.x - st.a[0]) * v[0] + (d.y - st.a[1]) * v[1]) / l2));
    a = Math.atan2(v[1], v[0]);
    span = Math.sqrt(l2);
  } else {
    const turn = Math.sign(st.a1 - st.a0) || 1, at = Math.atan2(d.y - st.c[1], d.x - st.c[0]);
    p = Math.max(0, Math.min(1, ((((at - st.a0) * turn) % TAU) + TAU) % TAU / Math.abs(st.a1 - st.a0)));
    a = at + (turn * Math.PI) / 2;
    span = Math.hypot(d.x - st.c[0], d.y - st.c[1]) * Math.abs(st.a1 - st.a0);
  }
  return { i, p, a, span, len: 30 + R('smear', 'len', i) * 50, k: Math.floor(R('smear', 'kind', i) * 3) };
}

/** Where the knife is in its steps at second `sec`: the step, and the progress in it. */
function stepAt(s, sec) {
  const st = s.steps;
  for (let i = 0; i < st.length; i++) if (sec < st[i].t1) return { i, u: Math.max(0, (sec - st[i].t0) / (st[i].t1 - st[i].t0)) };
  return { i: st.length, u: 0 };
}

/** The knife's pose in step `st` at progress `u`: the middle of its edge, the edge's direction, its half length. */
function pose(st, u) {
  if (st.kind === 'drag') {
    const p = [st.a[0] + (st.b[0] - st.a[0]) * u, st.a[1] + (st.b[1] - st.a[1]) * u];
    const l = Math.hypot(st.b[0] - st.a[0], st.b[1] - st.a[1]) || 1, d = [(st.b[0] - st.a[0]) / l, (st.b[1] - st.a[1]) / l];
    return st.edge ? { p, e: d, h: 26, f: [-d[1], d[0]] } : { p, e: [-d[1], d[0]], h: Math.min(70, st.w / 2), f: d };
  }
  const a = st.a0 + (st.a1 - st.a0) * u, e = [Math.cos(a), Math.sin(a)], reach = Math.min(st.r, 62);
  const turn = Math.sign(st.a1 - st.a0) || 1;
  return { p: [st.c[0] + e[0] * (st.r - reach / 2), st.c[1] + e[1] * (st.r - reach / 2)], e, h: Math.max(8, reach / 2), f: [-e[1] * turn, e[0] * turn] };
}

// Lay one of the kept pictures, or paint it where nothing is kept.
const lay = (g, s, kept, paint) => (kept ? Dr.put(g, kept) : paint(g, s));

function clipTo(g, polys) {
  g.beginPath();
  for (const p of polys) trace(g, p);
  g.clip();
}

/**
 * Step `j` at progress `u`, in sheet units, over what the steps before it
 * left. The knife drags the dabs it meets: where it has been, the scraped
 * ground (`ground`, kept by copyAt in draft.js, or null to paint it) shows,
 * each dab smeared out from where it lay towards the knife (see paintGround),
 * marked with the knife's streaks. A background stroke and a halo go
 * round the bird's dabs; a step that clears the bird lays, on the bird, the
 * scraped ground and every form laid by then in the style's order, and
 * beyond it only its own forms; any other step lays only its own forms.
 */
function drawStep(g, s, j, u, ground) {
  const st = s.steps[j];
  if (u <= 0) return;
  const own = (f) => f.at === j;
  g.save();
  clipTo(g, [region(st, u)]);
  if (st.bg || st.wash) {
    outside(g, s);
    if (st.bg) lay(g, s, ground, paintGround);
    for (const f of s.shapes) if (own(f)) f.draw(g);
  } else if (st.clear) {
    g.save();
    clipTo(g, s.hull);
    lay(g, s, ground, paintGround);
    for (const f of s.shapes) if (f.at <= j) f.draw(g);
    g.restore();
    // Beyond the bird the knife carries what it gathers in its heap, and lays only its own forms.
    g.save();
    outside(g, s);
    for (const f of s.shapes) if (own(f)) f.draw(g);
    g.restore();
  } else {
    for (const f of s.shapes) if (own(f)) f.draw(g);
  }
  if (!st.edge && !st.wash) drawMarks(g, st, u);
  g.restore();
}

/** Clip to everywhere but the bird's dabs. */
function outside(g, s) {
  for (const p of s.hull) { g.beginPath(); g.rect(-3000, -3000, 8000, 8000); trace(g, p); g.clip('evenodd'); }
}

/** The dabs each step has met by its progress, for pairs [step, progress], each smeared from where it lay as far as the knife has taken it, at `alpha`. */
function drawSmears(g, s, pairs, alpha) {
  const list = [];
  for (const [st, u] of pairs) {
    for (const e of st.dabs) {
      if (e.p >= u) break;
      const d = s.dabs[e.i];
      list.push({ x: d.x, y: d.y, a: e.a, len: Math.min(e.len, (u - e.p) * e.span + d.len), wide: d.wide, ci: d.ci, k: e.k, alpha });
    }
  }
  Oil.drawSmears(g, s, list);
}

/** The knife's streaks where it has been: along a drag, round a sweep, lighter and darker by turns. */
function drawMarks(g, st, u) {
  g.save();
  g.lineWidth = 0.9;
  if (st.kind === 'drag') {
    const b = [st.a[0] + (st.b[0] - st.a[0]) * u, st.a[1] + (st.b[1] - st.a[1]) * u];
    const l = Math.hypot(st.b[0] - st.a[0], st.b[1] - st.a[1]) || 1, n = [-(st.b[1] - st.a[1]) / l, (st.b[0] - st.a[0]) / l];
    for (let v = -st.w / 2 + 2, k = 0; v < st.w / 2; v += 2.4 + 2.4 * Oil.hash(k, 1, 4), k++) {
      const h = Oil.hash(k, st.w | 0, 3);
      if (h < 0.35) continue;
      g.strokeStyle = h > 0.7 ? 'rgba(255, 252, 245, 0.1)' : 'rgba(90, 70, 50, 0.045)';
      g.beginPath();
      g.moveTo(st.a[0] + n[0] * v, st.a[1] + n[1] * v);
      g.lineTo(b[0] + n[0] * v, b[1] + n[1] * v);
      g.stroke();
    }
  } else {
    const a1 = st.a0 + (st.a1 - st.a0) * u, ccw = st.a1 < st.a0;
    for (let r = Math.max(2, st.inner), k = 0; r < st.r; r += 2.4 + 2.4 * Oil.hash(k, 2, 6), k++) {
      const h = Oil.hash(k, st.r | 0, 5);
      if (h < 0.35) continue;
      g.strokeStyle = h > 0.7 ? 'rgba(255, 252, 245, 0.1)' : 'rgba(90, 70, 50, 0.045)';
      g.beginPath();
      g.arc(st.c[0], st.c[1], r, st.a0, a1, ccw);
      g.stroke();
    }
  }
  g.restore();
}

/** Whole groups of steps done by second `sec`, and the step the knife is in with its progress. */
function scraped(s, sec) {
  const { i, u } = stepAt(s, sec);
  let k = 0;
  while (k < s.groups.length && s.groups[k][1] <= i) k++;
  return { k, i, u };
}

/** The steps done since the last whole group, and the one the knife is in, over the kept groups. */
function drawLive(g, s, sec, ground) {
  const { k, i, u } = scraped(s, sec), from = k ? s.groups[k - 1][1] : 0;
  for (let j = from; j < i; j++) drawStep(g, s, j, 1, ground);
  if (i < s.steps.length && u > 0) drawStep(g, s, i, u, ground);
}

/** The whole impasto, as the paint seam leaves it. */
function paintImpasto(g, s) {
  Im.drawGround(g, s);
  Im.drawDabs(g, s, 0, s.dabs.length);
}

/**
 * The ground the knife scrapes down to, as it leaves it: smoothed, every dab
 * smeared out from where it lay along the knife's stroke (the bird's only on
 * the bird's place), the style's vignette and grain. Where a step shows it,
 * the smears run up to the knife's edge, as the paint it drags does.
 */
function paintGround(g, s) {
  Im.drawGround(g, s, 0.2, 0.08);
  const R = rng(s.seed);
  // Every dab as the knife leaves it, smeared out along its stroke: the background's, then the bird's on the bird's place.
  drawSmears(g, s, s.steps.filter((o) => o.bg).map((o) => [o, 1]), 0.3);
  g.save();
  clipTo(g, s.hull);
  drawSmears(g, s, s.steps.filter((o) => o.clear).map((o) => [o, 1]), 0.2);
  g.restore();
  const [x0, y0, x1, y1] = Im.VIEW, c = Im.CLOSE.c;
  const v = g.createRadialGradient(c[0], c[1], 170, c[0], c[1], 440);
  v.addColorStop(0, 'rgba(120, 95, 60, 0)');
  v.addColorStop(1, 'rgba(120, 95, 60, 0.16)');
  g.fillStyle = v;
  g.fillRect(x0, y0, x1 - x0, y1 - y0);
  for (const [colour, key] of [['rgba(255, 255, 250, 0.12)', 'light'], ['rgba(90, 70, 40, 0.07)', 'dark']]) {
    g.fillStyle = colour;
    g.beginPath();
    for (let j = 0; j < 4700; j++) g.rect(x0 + R('grain', key + 'x', j) * (x1 - x0), y0 + R('grain', key + 'y', j) * (y1 - y0), 0.7, 0.7);
    g.fill();
  }
}

/** The palette knife at second `sec`: a trowel blade on the paint, the paint heaped before its edge, its crank and handle by their shadows. */
function drawKnife(g, s, sec) {
  const steps = s.steps, { i, u } = stepAt(s, sec), L = Im.lightOf(s);
  let k, down = true, heap = 0;
  if (i >= steps.length) {
    const last = pose(steps[steps.length - 1], 1), v = Math.min(1, (sec - steps[steps.length - 1].t1) / 0.3);
    k = { ...last, p: [last.p[0] + 420 * v * v, last.p[1] - 300 * v * v] };
    down = false;
    if (v >= 1) return;
  } else if (sec < steps[i].t0) {
    const next = pose(steps[i], 0), prev = i ? pose(steps[i - 1], 1) : { ...next, p: [next.p[0] - 380, next.p[1] - 260] };
    const from = i ? steps[i - 1].t1 : 0, v = Math.max(0, Math.min(1, (sec - from) / (steps[i].t0 - from)));
    const w = v * v * (3 - 2 * v), ang = (a) => Math.atan2(a.e[1], a.e[0]);
    let a0 = ang(prev), a1 = ang(next);
    if (a1 - a0 > Math.PI) a1 -= TAU;
    if (a0 - a1 > Math.PI) a1 += TAU;
    const a = a0 + (a1 - a0) * w;
    k = { p: [prev.p[0] + (next.p[0] - prev.p[0]) * w, prev.p[1] + (next.p[1] - prev.p[1]) * w], e: [Math.cos(a), Math.sin(a)], h: prev.h + (next.h - prev.h) * w, f: w < 0.5 ? prev.f : next.f };
    down = false;
  } else {
    const st = steps[i];
    k = pose(st, u);
    if (st.bg && s.hull.some((p) => pointInPoly(k.p, p))) down = false;
    heap = st.bg || st.clear || (st.paint && !st.edge) ? Math.min(1, u * 4) : 0;
  }
  const up = down ? 0 : 1, sx = -L[0] * (3 + up * 14), sy = -L[1] * (3 + up * 14), b = [-k.f[0], -k.f[1]];
  // The trowel: its straight edge on the paint, its back curving to the heel, where the crank rises.
  const at = (ox, oy, v, w) => [k.p[0] + ox + k.e[0] * v + b[0] * w, k.p[1] + oy + k.e[1] * v + b[1] * w];
  const blade = (ox, oy) => {
    g.beginPath();
    const q = [at(ox, oy, k.h, 0), at(ox, oy, -k.h, 0), at(ox, oy, -k.h * 0.96, 16), at(ox, oy, -k.h * 0.55, 24), at(ox, oy, 0, 18), at(ox, oy, k.h * 0.6, 8)];
    trace(g, q);
  };
  g.save();
  if (heap > 0 && down) drawHeap(g, s, steps[i], u, k, heap, at);
  g.fillStyle = 'rgba(30, 20, 10, 0.2)';
  blade(sx, sy);
  g.fill();
  const heel = at(sx * 2, sy * 2, -k.h * 0.7, 22);
  g.lineCap = 'round';
  for (const [w, a] of [[14, 0.09], [8, 0.13]]) {
    g.strokeStyle = `rgba(30, 20, 10, ${a})`;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(heel[0], heel[1]);
    g.lineTo(heel[0] + b[0] * 150 - L[0] * 50, heel[1] + b[1] * 150 - L[1] * 50);
    g.stroke();
  }
  const steel = g.createLinearGradient(...at(0, 0, k.h, 0), ...at(0, 0, -k.h, 20));
  steel.addColorStop(0, '#aeb5bb');
  steel.addColorStop(0.5, '#eef1f2');
  steel.addColorStop(1, '#949ca4');
  g.fillStyle = steel;
  blade(0, -up * 3);
  g.fill();
  g.strokeStyle = 'rgba(60, 64, 70, 0.6)';
  g.lineWidth = 0.8;
  g.stroke();
  g.restore();
}

/** Build stage: the bird's outline as the dabs left it, a little grown, which the background strokes go round. */
function hull(s) {
  s.hull = ['body', 'wing', 'tail', 'beak'].map((n) => grown(s.risen[n][0], 3));
}

/**
 * The paint the knife pushes, heaped along the front of its edge: the dabs it
 * has just met, and the colour it is laying, rolled into a ridge that grows as
 * it gathers them. `at(ox, oy, v, w)` places a point along the edge (`v`) and
 * behind it (`w`).
 */
function drawHeap(g, s, st, u, k, heap, at) {
  const recent = [];
  for (const e of st.dabs) { if (e.p >= u) break; if (e.p > u - 0.25) recent.push(s.dabs[e.i].colour); }
  const colours = [...(st.paint ? [st.paint, st.paint] : []), ...recent.slice(-6)];
  if (!colours.length) return;
  const gathered = st.dabs.filter((e) => e.p < u).length, size = Math.min(1, 0.35 + gathered / 120) * heap;
  const n = Math.max(3, Math.round(k.h / 4)), a = Math.atan2(k.e[1], k.e[0]), list = [], seed = (st.t0 * 1000) | 0;
  for (let row = 0; row < 3; row++) {
    for (let j = 0; j < n; j++) {
      const h = Oil.hash(j, row, seed), h2 = Oil.hash(j, row + 7, seed);
      const v = -k.h * 0.94 + ((j + 0.5 + row * 0.33 + (h2 - 0.5) * 0.6) / n) * 1.88 * k.h;
      const c = at(0, 0, v, -(1 + (1.5 + row * 2.4 + h * 1.5) * size * 1.6));
      const colour = colours[Math.floor(h2 * 997 + row) % colours.length];
      list.push({ x: c[0], y: c[1], a: a + (h - 0.5) * 0.9, len: (k.h / n) * (1.3 + h2) + 2, wide: (1.8 + 3.2 * size) * (0.7 + 0.6 * h), colour, ci: s.oil.index.get(colour), k: Math.floor(h * Oil.SHAPES) });
    }
  }
  list.reverse();
  Oil.drawDabs(g, s, list);
}

module.exports = { forms, hull, drawStep, drawLive, scraped, drawKnife, paintImpasto, paintGround, PAINTED };
