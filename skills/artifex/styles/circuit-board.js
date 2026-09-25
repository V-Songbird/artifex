// Circuit board: a green printed circuit board seen from above. Copper under
// the solder mask shows as a lighter green with a raised edge, exposed pads
// are gold, the legend is white silkscreen, and every run is horizontal,
// vertical or at 45 degrees. The subject is laid out as copper art on the
// board, wired into the parts around it.

'use strict';

const { rng } = require('../../../core/rand.js');
const { offsetPolyline, centroid, resample, closestPointOnSegment, pointInPoly } = require('../../../core/geom.js');
const font = require('../../../core/stroke-font.js');
const { bird } = require('./subject.js');
const { path, shadow, caption } = require('./kit.js');

const C = {
  bench: '#16191d',
  edge: '#c9c08c',
  mask: '#0d4a29',
  pour: '#17683a',
  copper: '#23804a',
  crest: '#4bab6d',
  trough: '#06301a',
  bare: '#3a4424',
  gold: ['#d9b35e', '#f4dc98', '#a8822f'],
  silk: '#eeefe4',
  tin: ['#c7cbd1', '#f2f4f6', '#8a9099'],
  chip: ['#1b1c1f', '#2a2b2f'],
  hole: '#0a0d0b',
};

// The corner joining p to q by one straight run and one 45-degree run.
function bend(p, q, diagonalFirst) {
  const dx = q[0] - p[0]; const dy = q[1] - p[1];
  const d = Math.min(Math.abs(dx), Math.abs(dy));
  const run = [Math.sign(dx) * d, Math.sign(dy) * d];
  return diagonalFirst ? [p[0] + run[0], p[1] + run[1]] : [q[0] - run[0], q[1] - run[1]];
}

// An open route through waypoints, every leg straight or at 45 degrees.
function route(pts, diagonalFirst = false) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const c = bend(pts[i - 1], pts[i], diagonalFirst);
    const last = out[out.length - 1];
    if (Math.hypot(c[0] - last[0], c[1] - last[1]) > 0.5 && Math.hypot(c[0] - pts[i][0], c[1] - pts[i][1]) > 0.5) out.push(c);
    out.push(pts[i]);
  }
  return out;
}

// The fewest points of an open polyline that stay within `tol` of it.
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  let far = 0; let at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = closestPointOnSegment(pts[i], pts[0], pts[pts.length - 1]).distance;
    if (d > far) { far = d; at = i; }
  }
  if (far <= tol) return [pts[0], pts[pts.length - 1]];
  return [...simplify(pts.slice(0, at + 1), tol).slice(0, -1), ...simplify(pts.slice(at), tol)];
}

// A closed outline redrawn in 45-degree runs: simplified to within `tol`,
// each edge bent outward, away from the centre, and runs that continue in
// the same direction merged.
function octagonal(poly, tol) {
  let far = 0;
  for (let i = 1; i < poly.length; i++) if (Math.hypot(poly[i][0] - poly[0][0], poly[i][1] - poly[0][1]) > Math.hypot(poly[far][0] - poly[0][0], poly[far][1] - poly[0][1])) far = i;
  const loop = [...poly, poly[0]];
  const pts = [...simplify(loop.slice(0, far + 1), tol).slice(0, -1), ...simplify(loop.slice(far), tol).slice(0, -1)];
  const [cx, cy] = centroid(poly);
  const raw = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]; const q = pts[(i + 1) % pts.length];
    const a = bend(p, q, true); const b = bend(p, q, false);
    raw.push(p, Math.hypot(a[0] - cx, a[1] - cy) > Math.hypot(b[0] - cx, b[1] - cy) ? a : b);
  }
  const dir = (p, q) => Math.round(Math.atan2(q[1] - p[1], q[0] - p[0]) / (Math.PI / 4));
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const p = raw[(i + raw.length - 1) % raw.length]; const q = raw[i]; const r = raw[(i + 1) % raw.length];
    if (Math.hypot(r[0] - q[0], r[1] - q[1]) < 0.5) continue;
    if (Math.hypot(q[0] - p[0], q[1] - p[1]) > 0.5 && dir(p, q) === dir(q, r)) continue;
    out.push(q);
  }
  return out;
}

// Copper under the mask: the mask pools on the low side of every edge and
// thins over the crest, so each feature is drawn three times.
function copper(g, draw, colour = C.copper) {
  g.save();
  g.translate(1.6, 1.8);
  draw(C.trough);
  g.translate(-2.6, -2.8);
  draw(C.crest);
  g.restore();
  draw(colour);
}

function trace(g, pts, w, colour, close = false) {
  copper(g, (ink) => {
    g.strokeStyle = ink;
    g.lineWidth = w;
    path(g, pts, close);
    g.stroke();
  }, colour);
}

function area(g, pts, colour) {
  copper(g, (ink) => {
    g.fillStyle = ink;
    path(g, pts);
    g.fill();
  }, colour);
}

// A mask opening: bare laminate round the pad, then gold lit from the top left.
function exposed(g, shape, [x0, y0, x1, y1]) {
  g.save();
  g.strokeStyle = C.bare;
  g.lineWidth = 4;
  g.lineJoin = 'round';
  shape();
  g.stroke();
  const grad = g.createLinearGradient(x0, y0, x1, y1);
  grad.addColorStop(0, C.gold[1]);
  grad.addColorStop(0.45, C.gold[0]);
  grad.addColorStop(1, C.gold[2]);
  g.fillStyle = grad;
  shape();
  g.fill();
  g.restore();
}

// An exposed track: a closed outline stroked in gold.
function goldLine(g, pts, w, [x0, y0, x1, y1]) {
  g.save();
  g.lineJoin = 'round';
  g.strokeStyle = C.bare;
  g.lineWidth = w + 4;
  path(g, pts);
  g.stroke();
  const grad = g.createLinearGradient(x0, y0, x1, y1);
  grad.addColorStop(0, C.gold[1]);
  grad.addColorStop(0.45, C.gold[0]);
  grad.addColorStop(1, C.gold[2]);
  g.strokeStyle = grad;
  g.lineWidth = w;
  path(g, pts);
  g.stroke();
  g.restore();
}

function padRect(g, x, y, w, h) {
  exposed(g, () => { g.beginPath(); g.roundRect(x - w / 2, y - h / 2, w, h, Math.min(w, h) * 0.18); }, [x - w / 2, y - h / 2, x + w / 2, y + h / 2]);
}

function padRound(g, x, y, r, drill = 0) {
  exposed(g, () => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); }, [x - r, y - r, x + r, y + r]);
  if (drill) {
    g.fillStyle = C.hole;
    g.beginPath();
    g.arc(x, y, drill, 0, Math.PI * 2);
    g.fill();
  }
}

// A tented via: a copper ring under the mask round a dark drill.
function via(g, x, y, r = 6) {
  copper(g, (ink) => {
    g.fillStyle = ink;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  });
  g.fillStyle = C.hole;
  g.beginPath();
  g.arc(x, y, r * 0.42, 0, Math.PI * 2);
  g.fill();
}

function silk(g, w = 2.2) {
  g.strokeStyle = C.silk;
  g.fillStyle = C.silk;
  g.lineWidth = w;
  g.lineCap = 'round';
  g.lineJoin = 'round';
}

function label(g, text, x, y, size = 11) {
  g.save();
  silk(g, Math.max(1.6, size * 0.16));
  font.text(g, text, x, y, size);
  g.restore();
}

// A bus: n parallel traces offset from one centre route.
function bus(centre, n, pitch) {
  const out = [];
  for (let k = 0; k < n; k++) out.push(offsetPolyline(centre, (k - (n - 1) / 2) * pitch, 4));
  return out;
}

function part(g, blur, draw) {
  g.save();
  shadow(g, 'rgba(0, 0, 0, 0.55)', blur, blur * 0.3, blur * 0.5);
  draw();
  g.restore();
}

function metal(g, x0, y0, x1, y1, stops) {
  const grad = g.createLinearGradient(x0, y0, x1, y1);
  stops.forEach((c, i) => grad.addColorStop(i / (stops.length - 1), c));
  return grad;
}

// A gull-wing package from above: gold lands, tinned leads, a moulded body.
function qfp(g, cx, cy, size, per, pitch) {
  const half = size / 2;
  const leads = [];
  for (let side = 0; side < 4; side++) {
    for (let i = 0; i < per; i++) {
      const u = (i - (per - 1) / 2) * pitch;
      const c = [[u, -half - 14], [half + 14, u], [-u, half + 14], [-half - 14, -u]][side];
      leads.push({ side, i, x: cx + c[0], y: cy + c[1] });
    }
  }
  for (const l of leads) {
    const along = l.side % 2 === 0;
    padRect(g, l.x, l.y, along ? 6 : 22, along ? 22 : 6);
  }
  part(g, 10, () => {
    g.fillStyle = C.chip[0];
    g.fillRect(cx - half, cy - half, size, size);
  });
  for (const l of leads) {
    const along = l.side % 2 === 0;
    const dx = along ? 0 : Math.sign(l.x - cx); const dy = along ? Math.sign(l.y - cy) : 0;
    const x = l.x - dx * 4; const y = l.y - dy * 4;
    g.fillStyle = metal(g, x - 3, y - 3, x + 3, y + 3, [C.tin[1], C.tin[2]]);
    g.fillRect(x - (along ? 2.2 : 9), y - (along ? 9 : 2.2), along ? 4.4 : 18, along ? 18 : 4.4);
  }
  g.fillStyle = C.chip[1];
  g.fillRect(cx - half + 6, cy - half + 6, size - 12, size - 12);
  g.fillStyle = '#121315';
  g.beginPath();
  g.arc(cx - half + 20, cy - half + 20, 6, 0, Math.PI * 2);
  g.fill();
  g.save();
  g.strokeStyle = 'rgba(200, 200, 205, 0.5)';
  g.lineWidth = 1.8;
  g.lineCap = 'round';
  font.text(g, 'MCU', cx - 22, cy - 12, 14);
  font.text(g, '32F4', cx - 22, cy + 10, 10);
  g.restore();
  return leads;
}

// A two-terminal chip part: tinned ends on gold lands, a body between.
function chipPart(g, x, y, len, wide, body, vertical = false) {
  const [dx, dy] = vertical ? [0, len / 2] : [len / 2, 0];
  const [w, h] = vertical ? [wide, len * 0.34] : [len * 0.34, wide];
  padRect(g, x - dx, y - dy, w + 4, h + 4);
  padRect(g, x + dx, y + dy, w + 4, h + 4);
  const [bw, bh] = vertical ? [wide, len] : [len, wide];
  part(g, 5, () => {
    g.fillStyle = body;
    g.fillRect(x - bw / 2, y - bh / 2, bw, bh);
  });
  g.fillStyle = C.tin[0];
  if (vertical) {
    g.fillRect(x - wide / 2, y - len / 2, wide, len * 0.2);
    g.fillRect(x - wide / 2, y + len * 0.3, wide, len * 0.2);
  } else {
    g.fillRect(x - len / 2, y - wide / 2, len * 0.2, wide);
    g.fillRect(x + len * 0.3, y - wide / 2, len * 0.2, wide);
  }
}

function glow(g, x, y, r, colour) {
  g.save();
  g.globalCompositeOperation = 'lighter';
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, colour);
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  g.fillStyle = grad;
  g.fillRect(x - r, y - r, 2 * r, 2 * r);
  g.restore();
}

function led(g, x, y, lens, lit) {
  chipPart(g, x, y, 24, 13, '#ebe6d8');
  g.fillStyle = lens;
  g.fillRect(x - 4.5, y - 4.5, 9, 9);
  if (lit) {
    glow(g, x, y, 42, lit);
    g.fillStyle = 'rgba(255, 255, 255, 0.95)';
    g.fillRect(x - 2.5, y - 2.5, 5, 5);
  }
}

function draw(g, s) {
  const R = rng(s.seed);
  const W = 1000; const H = 1000;
  const B = [26, 26, 948, 948];

  g.fillStyle = C.bench;
  g.fillRect(0, 0, W, H);
  part(g, 30, () => {
    g.fillStyle = C.edge;
    g.beginPath();
    g.roundRect(B[0], B[1], B[2], B[3], 30);
    g.fill();
  });
  g.save();
  g.beginPath();
  g.roundRect(B[0] + 3, B[1] + 3, B[2] - 6, B[3] - 6, 27);
  g.clip();
  g.fillStyle = C.mask;
  g.fillRect(0, 0, W, H);

  // The subject as copper art in 45-degree runs.
  const b = bird(420, 372, 262, -0.03);
  const body = octagonal(b.body, 7);
  const wing = octagonal(b.wing, 6);
  const snap = (v) => Math.round(v / 10) * 10;
  // The beak: a wedge whose two faces run at 45 degrees to its tip.
  const [top, , low] = b.beak;
  const mid = (top[1] + low[1]) / 2; const half = (low[1] - top[1]) / 2;
  const beak = [[top[0] - 14, mid - half], [top[0] + half, mid - half], [top[0] + 2 * half, mid], [top[0] + half, mid + half], [top[0] - 14, mid + half]];
  const tailRoot = b.at([[-0.5, -0.03]])[0].map(snap);
  const tail = [[-1.02, -0.42], [-1.09, -0.28], [-1.04, -0.13]].map((tip, k) => route([
    [tailRoot[0], tailRoot[1] + (k - 1) * 20], b.at([tip])[0].map(snap),
  ], true));
  const railY = 600;
  const feet = b.legs.map(([top]) => snap(top[0]));
  const legs = feet.map((x) => [[x, b.body.reduce((m, p) => (Math.abs(p[0] - x) < 20 ? Math.max(m, p[1]) : m), 0) - 16], [x, railY]]);

  // Traces: centre routes with a width.
  const U = [700, 790];
  const L = [600, railY];
  const traces = [];
  const add = (pts, w = 7) => { traces.push({ pts, w }); return pts; };
  add([[96, railY], [L[0] - 30, railY]], 20);
  add(route([[L[0] + 30, railY], [L[0] + 70, railY + 40], [L[0] + 70, U[1] - 84]]), 14);
  for (const leg of legs) add(leg, 9);
  for (const t of tail) add(t, 8);
  const west = bus(route([[U[0] - 84, U[1] - 20], [480, U[1] - 20], [400, 860], [200, 860]], true), 5, 17);
  west.forEach((t) => add(t));
  const north = bus(route([[U[0] + 40, U[1] - 84], [U[0] + 40, 680], [908, 472], [908, 200], [848, 140], [730, 140]]), 4, 22);
  north.forEach((t) => add(t));
  const east = [
    add(route([[U[0] + 84, U[1] + 30], [860, U[1] + 30], [880, 840], [880, 870]])),
    add(route([[U[0] + 84, U[1] + 50], [840, U[1] + 50], [840, 900]])),
  ];
  const south = add(route([[U[0] - 30, U[1] + 84], [U[0] - 30, 912], [560, 912]]));
  for (let k = 0; k < 3; k++) {
    add([[300 + k * 40, 686], [300 + k * 40, 660]], 6);
    add([[300 + k * 40, 714], [300 + k * 40, 740]], 6);
  }
  const crystal = [[792, 330], [808, 330]];
  add(route([[crystal[0][0] - 20, 330], [760, 330], [760, 386]]));
  add(route([[crystal[1][0] + 72, 330], [868, 330], [868, 386]]));

  // Parts that the pour keeps clear of: [x, y, half width, half height].
  const Y = [830, 330]; const CAP = [792, 474, 48];
  const boxes = [[U[0], U[1], 112, 112], [L[0], L[1], 40, 40], [Y[0], Y[1], 62, 30], [CAP[0], CAP[1], 60, 60],
    [160, 843, 40, 56], [96, railY, 34, 26], [710, 140, 30, 50], [340, 700, 50, 44]];

  // Ground pour everywhere but a clearance round every trace, part and the art.
  area(g, [[B[0] + 26, B[1] + 26], [B[0] + B[2] - 26, B[1] + 26], [B[0] + B[2] - 26, B[1] + B[3] - 26], [B[0] + 26, B[1] + B[3] - 26]], C.pour);
  g.fillStyle = C.mask;
  g.strokeStyle = C.mask;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const t of traces) {
    g.lineWidth = t.w + 22;
    path(g, t.pts, false);
    g.stroke();
  }
  for (const shape of [body, wing, beak]) {
    g.lineWidth = 46;
    path(g, shape);
    g.stroke();
    path(g, shape);
    g.fill();
  }
  for (const [x, y, w, h] of boxes) {
    g.beginPath();
    g.roundRect(x - w - 10, y - h - 10, 2 * w + 20, 2 * h + 20, 14);
    g.fill();
  }

  // Stitching vias wherever the open pour has room.
  const segs = [];
  for (const t of traces) for (let i = 1; i < t.pts.length; i++) segs.push([t.pts[i - 1], t.pts[i], t.w / 2 + 11 + 12]);
  const room = (p) => {
    if (p[0] < 90 || p[0] > 910 || p[1] < 90 || p[1] > 910) return false;
    for (const [a, c, r] of segs) if (closestPointOnSegment(p, a, c).distance < r) return false;
    for (const [x, y, w, h] of boxes) if (Math.abs(p[0] - x) < w + 26 && Math.abs(p[1] - y) < h + 26) return false;
    if (pointInPoly(p, body)) return false;
    for (const q of [...body, ...wing]) if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 48) return false;
    for (const [x, y] of [[70, 70], [930, 70], [930, 930], [70, 930]]) if (Math.hypot(p[0] - x, p[1] - y) < 60) return false;
    return true;
  };
  for (let y = 70; y < 940; y += 44) {
    for (let x = 70; x < 940; x += 44) {
      const p = [x + (R('via', 'x', x * 31 + y) - 0.5) * 12, y + (R('via', 'y', x * 31 + y) - 0.5) * 12];
      if (R('via', 'keep', x * 31 + y) < 0.5 && room(p)) via(g, p[0], p[1], 5);
    }
  }

  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const t of traces) trace(g, t.pts, t.w);

  // The subject's body: a hatched pour inside a gold rim.
  g.save();
  path(g, body);
  g.clip();
  g.fillStyle = C.mask;
  path(g, body);
  g.fill();
  for (let k = -700; k < 700; k += 14) {
    trace(g, [[b.eye[0] + k - 500, b.eye[1] - 500], [b.eye[0] + k + 500, b.eye[1] + 500]], 3.6);
    trace(g, [[b.eye[0] + k + 500, b.eye[1] - 500], [b.eye[0] + k - 500, b.eye[1] + 500]], 3.6);
  }
  g.restore();
  const [bx0, by0] = b.at([[0.3, -0.7]])[0]; const [bx1, by1] = b.at([[-0.3, 0.5]])[0];
  goldLine(g, body, 11, [bx0, by0, bx1, by1]);
  g.save();
  g.strokeStyle = C.mask;
  g.lineWidth = 14;
  g.lineJoin = 'round';
  path(g, wing);
  g.stroke();
  g.restore();
  // Wing: exposed gold with etched feather slots.
  const [wx0, wy0] = b.at([[0.25, -0.3]])[0]; const [wx1, wy1] = b.at([[-0.6, 0.1]])[0];
  exposed(g, () => path(g, wing), [wx0, wy0, wx1, wy1]);
  g.save();
  path(g, wing);
  g.clip();
  g.strokeStyle = C.bare;
  g.lineWidth = 4;
  g.lineCap = 'round';
  for (let k = 0; k < 3; k++) {
    const a = b.at([[0.1 - k * 0.12, -0.1 + k * 0.07]])[0].map(snap);
    path(g, route([a, [a[0] - 110 + k * 16, a[1] - 22 + k * 4]], false), false);
    g.stroke();
  }
  g.restore();
  exposed(g, () => path(g, beak), [beak[0][0], beak[0][1], beak[2][0], beak[3][1]]);
  // Eye: a plated hole with its own clearance.
  g.fillStyle = C.mask;
  g.beginPath();
  g.arc(b.eye[0], b.eye[1], 24, 0, Math.PI * 2);
  g.fill();
  padRound(g, b.eye[0], b.eye[1], 16, 7.5);
  for (const t of tail) padRound(g, t[t.length - 1][0], t[t.length - 1][1], 11, 4.5);
  for (const x of feet) {
    padRect(g, x - 11, railY, 18, 28);
    padRect(g, x + 11, railY, 18, 28);
  }

  // The glass weave of the laminate, faint through the mask.
  g.save();
  g.strokeStyle = 'rgba(0, 20, 8, 0.05)';
  g.lineWidth = 1.4;
  g.beginPath();
  for (let k = 30; k < 980; k += 7) {
    g.moveTo(k, 30); g.lineTo(k, 970);
    g.moveTo(30, k); g.lineTo(970, k);
  }
  g.stroke();
  g.restore();

  // Parts.
  const leads = qfp(g, U[0], U[1], 140, 8, 15);
  for (const l of leads) {
    if (l.side !== 3 || l.i % 3 !== 1) continue;
    via(g, l.x, l.y - 26, 5);
  }
  // Power in: two big lands and a shrouded inductor.
  padRect(g, 80, railY, 34, 44);
  label(g, 'VIN', 64, railY - 52, 11);
  padRect(g, L[0] - 30, L[1], 18, 40);
  padRect(g, L[0] + 30, L[1], 18, 40);
  part(g, 12, () => {
    g.fillStyle = metal(g, L[0] - 36, L[1] - 36, L[0] + 36, L[1] + 36, ['#4a4d53', '#2c2e33', '#1c1d21']);
    g.beginPath();
    g.roundRect(L[0] - 36, L[1] - 36, 72, 72, 10);
    g.fill();
  });
  g.save();
  g.strokeStyle = 'rgba(210, 212, 218, 0.55)';
  g.lineWidth = 1.8;
  font.text(g, '4R7', L[0] - 12, L[1] - 6, 11);
  g.restore();
  // The header west of the pour.
  const pins = west.map((t) => t[t.length - 1]);
  const [hx, hy0, hy1] = [pins[0][0] - 42, pins[pins.length - 1][1] - 17, pins[0][1] + 17];
  part(g, 8, () => {
    g.fillStyle = '#18181a';
    g.fillRect(hx - 18, hy0, 36, hy1 - hy0);
  });
  for (const [, y] of pins) {
    g.fillStyle = metal(g, hx - 8, y - 8, hx + 8, y + 8, [C.gold[1], C.gold[0], C.gold[2]]);
    g.fillRect(hx - 7, y - 7, 14, 14);
  }
  for (const p of pins) padRound(g, p[0], p[1], 9);
  // Lamp row fed by the north bus.
  const lamps = north.map((t) => t[t.length - 1]);
  const lens = ['#9dffb0', '#ffd35a', '#ff6a5a', '#8ab8ff'];
  lamps.forEach(([x, y], k) => led(g, x - 24, y, lens[k], k === 1 || k === 2 ? lens[k] + 'b0' : null));
  // Crystal and electrolytic.
  padRect(g, Y[0] - 36, Y[1], 28, 40);
  padRect(g, Y[0] + 36, Y[1], 28, 40);
  part(g, 8, () => {
    g.fillStyle = metal(g, Y[0] - 50, Y[1] - 20, Y[0] + 50, Y[1] + 20, ['#f4f5f7', '#b9bec6', '#8b919b']);
    g.beginPath();
    g.roundRect(Y[0] - 48, Y[1] - 18, 96, 36, 18);
    g.fill();
  });
  for (const x of [760, 868]) via(g, x, 386, 6);
  part(g, 12, () => {
    const cap = g.createRadialGradient(CAP[0] - 16, CAP[1] - 18, 6, CAP[0], CAP[1], CAP[2] + 2);
    cap.addColorStop(0, '#f7f8fa');
    cap.addColorStop(0.6, '#b7bcc4');
    cap.addColorStop(1, '#7c828c');
    g.fillStyle = cap;
    g.beginPath();
    g.arc(CAP[0], CAP[1], CAP[2], 0, Math.PI * 2);
    g.fill();
  });
  g.fillStyle = '#20252e';
  g.beginPath();
  g.arc(CAP[0], CAP[1], CAP[2], Math.PI * 0.62, Math.PI * 1.38);
  g.arc(CAP[0], CAP[1], CAP[2] - 13, Math.PI * 1.38, Math.PI * 0.62, true);
  g.fill();
  g.strokeStyle = 'rgba(60, 64, 72, 0.7)';
  g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(CAP[0] - 22, CAP[1]); g.lineTo(CAP[0] + 22, CAP[1]);
  g.moveTo(CAP[0], CAP[1] - 22); g.lineTo(CAP[0], CAP[1] + 22);
  g.stroke();
  // Passives round the chip, test points, mounting holes, fiducials.
  for (let k = 0; k < 3; k++) chipPart(g, U[0] + 110, U[1] - 40 + k * 34, 28, 15, k === 1 ? '#1d1d1f' : '#b58e59');
  for (let k = 0; k < 3; k++) {
    chipPart(g, 300 + k * 40, 700, 28, 15, k === 1 ? '#1d1d1f' : '#b58e59', true);
    via(g, 300 + k * 40, 660, 5);
    via(g, 300 + k * 40, 740, 5);
  }
  for (const t of [...east, south]) padRound(g, t[t.length - 1][0], t[t.length - 1][1], 11);
  for (const [x, y] of [[70, 70], [930, 70], [930, 930], [70, 930]]) {
    padRound(g, x, y, 22, 13);
    g.save();
    silk(g, 2);
    g.beginPath();
    g.arc(x, y, 30, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }
  for (const [x, y] of [[190, 120], [470, 930]]) {
    g.fillStyle = C.bare;
    g.beginPath();
    g.arc(x, y, 12, 0, Math.PI * 2);
    g.fill();
    padRound(g, x, y, 5);
  }

  // Silkscreen legend.
  g.save();
  silk(g, 2);
  g.strokeRect(U[0] - 90, U[1] - 90, 180, 180);
  g.beginPath();
  g.arc(U[0] - 98, U[1] - 98, 3.5, 0, Math.PI * 2);
  g.fill();
  g.strokeRect(hx - 26, hy0 - 8, 52, hy1 - hy0 + 16);
  g.strokeRect(L[0] - 48, L[1] - 48, 96, 96);
  g.beginPath();
  g.arc(CAP[0], CAP[1], CAP[2] + 8, 0, Math.PI * 2);
  g.stroke();
  g.strokeRect(Y[0] - 60, Y[1] - 28, 120, 56);
  g.beginPath();
  for (const [x, y] of lamps) { g.moveTo(x - 42, y - 9); g.lineTo(x - 42, y + 9); }
  g.stroke();
  g.restore();
  label(g, 'U1', U[0] - 90, U[1] - 114);
  label(g, 'J1', hx - 26, hy0 - 30);
  label(g, 'L1', L[0] - 48, L[1] - 72);
  label(g, 'C1', CAP[0] - 70, CAP[1] - 66);
  // The stroke font has no plus sign: the polarity mark is two strokes.
  g.save();
  silk(g, 2.2);
  g.beginPath();
  g.moveTo(CAP[0] + 44, CAP[1] - 54); g.lineTo(CAP[0] + 58, CAP[1] - 54);
  g.moveTo(CAP[0] + 51, CAP[1] - 61); g.lineTo(CAP[0] + 51, CAP[1] - 47);
  g.stroke();
  g.restore();
  label(g, 'Y1', Y[0] - 60, Y[1] - 52);
  lamps.forEach(([x, y], k) => label(g, 'D' + (k + 1), x - 76, y - 5, 10));
  label(g, 'R1', U[0] + 130, U[1] - 48, 9);
  label(g, 'C2', 254, 694, 9);
  label(g, 'TP1', 862, 896, 9);
  label(g, 'TP2', 822, 926, 9);
  caption(g, 'CIRCUIT BOARD', font, C.silk, 118, 948, 14);

  // Current on its way: a bright head with a fading tail along a trace.
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.lineCap = 'round';
  const flows = [...north, west[1], west[3], traces[0].pts];
  flows.forEach((t, k) => {
    const pts = resample(t, 3);
    const head = Math.floor((0.2 + 0.6 * R('pulse', 'at', k)) * (pts.length - 1));
    const len = 22;
    for (let i = 1; i < len && head - i >= 0; i++) {
      const u = 1 - i / len;
      g.strokeStyle = 'rgba(190, 255, 230, ' + (0.8 * u * u).toFixed(3) + ')';
      g.lineWidth = 1.5 + 2.5 * u;
      path(g, [pts[head - i], pts[head - i + 1]], false);
      g.stroke();
    }
    glow(g, pts[head][0], pts[head][1], 16, 'rgba(160, 255, 220, 0.8)');
  });
  g.restore();

  // A soft sheen across the mask.
  const sheen = g.createLinearGradient(0, 0, W, H);
  sheen.addColorStop(0, 'rgba(255, 255, 255, 0.07)');
  sheen.addColorStop(0.45, 'rgba(255, 255, 255, 0)');
  sheen.addColorStop(1, 'rgba(0, 0, 0, 0.12)');
  g.fillStyle = sheen;
  g.fillRect(0, 0, W, H);
  g.restore();
}

module.exports = { name: 'circuit-board', size: { w: 1000, h: 1000 }, seed: 2026, draw };
