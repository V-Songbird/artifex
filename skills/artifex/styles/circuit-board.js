// Circuit board: a green printed circuit board seen from above. Copper under
// the solder mask shows as a lighter green with a raised edge, exposed pads
// are gold, the legend is white silkscreen, and every run is horizontal,
// vertical or at 45 degrees. Parts sit on their lands and cast short shadows.
//
// A parts bin: functions that draw the style's marks on any path, outline or
// area you give them. Nothing here picks a subject, a scene or a layout.

'use strict';

const { offsetPolyline, centroid, resample, closestPointOnSegment } = require('../../../core/geom.js');
const font = require('../../../core/stroke-font.js');
const { fill, outline } = require('../../../core/path.js');
const { path, shadow } = require('./kit.js');

const PALETTE = {
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
const C = PALETTE;

// The corner joining p to q by one straight run and one 45-degree run.
function bend(p, q, diagonalFirst) {
  const dx = q[0] - p[0]; const dy = q[1] - p[1];
  const d = Math.min(Math.abs(dx), Math.abs(dy));
  const run = [Math.sign(dx) * d, Math.sign(dy) * d];
  return diagonalFirst ? [p[0] + run[0], p[1] + run[1]] : [q[0] - run[0], q[1] - run[1]];
}

// An open route through waypoints, every leg one straight run and one
// 45-degree run; `diagonalFirst` puts the diagonal at the start of each leg.
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

// Any closed outline redrawn as copper art in 45-degree runs: simplified to
// within `tol` (6 to 8 units keeps a silhouette), each edge bent outward
// into one straight and one diagonal run, runs that continue merged.
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

// Copper under the mask: `draw(ink)` is called three times, the trough
// offset (1.6, 1.8), the crest offset (-1, -1), then the copper itself, so
// the mask pools on one side of every edge and thins over the other.
function copper(g, draw, colour = C.copper) {
  g.save();
  g.translate(1.6, 1.8);
  draw(C.trough);
  g.translate(-2.6, -2.8);
  draw(C.crest);
  g.restore();
  draw(colour);
}

// A copper trace under the mask along pts, `w` wide (signal 6 to 9, power 14 to 20).
function trace(g, pts, w, colour, close = false) {
  copper(g, (ink) => {
    g.strokeStyle = ink;
    g.lineWidth = w;
    path(g, pts, close);
    g.stroke();
  }, colour);
}

// A filled copper area under the mask, such as a pour or a plane.
function area(g, pts, colour) {
  copper(g, (ink) => {
    g.fillStyle = ink;
    path(g, pts);
    g.fill();
  }, colour);
}

// A mask opening: `shape()` traces the path; bare laminate is stroked 4 wide
// round it, then it is filled gold lit from the box's first corner [x0, y0, x1, y1].
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

// An exposed gold track along a closed outline, `w` wide, over a rim of bare
// laminate, lit along the box [x0, y0, x1, y1].
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

// A rectangular gold land centred at (x, y), w by h, corners rounded 0.18 of the short side.
function padRect(g, x, y, w, h) {
  exposed(g, () => { g.beginPath(); g.roundRect(x - w / 2, y - h / 2, w, h, Math.min(w, h) * 0.18); }, [x - w / 2, y - h / 2, x + w / 2, y + h / 2]);
}

// A round gold pad of radius r; `drill` > 0 makes it a plated hole.
function padRound(g, x, y, r, drill = 0) {
  exposed(g, () => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); }, [x - r, y - r, x + r, y + r]);
  if (drill) {
    g.fillStyle = C.hole;
    g.beginPath();
    g.arc(x, y, drill, 0, Math.PI * 2);
    g.fill();
  }
}

// A tented via: a copper ring of radius r under the mask round a dark drill 0.42 of it.
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

// Set the pen to white silkscreen, `w` wide, with round caps and joins.
function silk(g, w = 2.2) {
  g.strokeStyle = C.silk;
  g.fillStyle = C.silk;
  g.lineWidth = w;
  g.lineCap = 'round';
  g.lineJoin = 'round';
}

// A silkscreen designator or legend in the stroke font, its top left at (x, y).
function label(g, text, x, y, size = 11) {
  g.save();
  silk(g, Math.max(1.6, size * 0.16));
  font.text(g, text, x, y, size);
  g.restore();
}

// A silkscreen plus sign centred at (x, y), arms `s` long; the stroke font has none.
function plus(g, x, y, s = 7, w = 2.2) {
  g.save();
  silk(g, w);
  g.beginPath();
  g.moveTo(x - s, y); g.lineTo(x + s, y);
  g.moveTo(x, y - s); g.lineTo(x, y + s);
  g.stroke();
  g.restore();
}

// A bus: n parallel routes `pitch` apart, offset from one centre route, so
// their corners stay parallel. Returns the routes; draw each with `trace`.
function bus(centre, n, pitch) {
  const out = [];
  for (let k = 0; k < n; k++) out.push(offsetPolyline(centre, (k - (n - 1) / 2) * pitch, 4));
  return out;
}

// Draw a part's body under a short shadow: `blur` 5 for a chip part, 10 to 12
// for a package, 30 for the board itself.
function part(g, blur, draw) {
  g.save();
  shadow(g, 'rgba(0, 0, 0, 0.55)', blur, blur * 0.3, blur * 0.5);
  draw();
  g.restore();
}

// A linear gradient from (x0, y0) to (x1, y1) through evenly spaced colour stops.
function metal(g, x0, y0, x1, y1, stops) {
  const grad = g.createLinearGradient(x0, y0, x1, y1);
  stops.forEach((c, i) => grad.addColorStop(i / (stops.length - 1), c));
  return grad;
}

// A gull-wing package from above: `per` gold lands a side at `pitch`, tinned
// leads, a moulded body `size` square with a pin-one dimple and its marking.
// Returns the leads as { side, i, x, y } so traces can start at them.
function qfp(g, cx, cy, size, per, pitch, marking = ['MCU', '32F4']) {
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
  font.text(g, marking[0], cx - 22, cy - 12, 14);
  font.text(g, marking[1], cx - 22, cy - 12 + 14 * font.leading, 10);
  g.restore();
  return leads;
}

// A two-terminal chip part (resistor, capacitor) `len` long and `wide`
// across: gold lands, a `body` colour between tinned ends.
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

// An additive radial glow of radius r: a lit lamp, a pulse of current.
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

// A chip lamp: a `lens` colour on a pale body; `lit` (a colour with alpha)
// adds a white hot centre and a glow of radius 42.
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

// A shielded power inductor 72 square on two lands, with a three-character
// value code such as '4R7'.
function inductor(g, x, y, value = '4R7') {
  padRect(g, x - 30, y, 18, 40);
  padRect(g, x + 30, y, 18, 40);
  part(g, 12, () => {
    g.fillStyle = metal(g, x - 36, y - 36, x + 36, y + 36, ['#4a4d53', '#2c2e33', '#1c1d21']);
    g.beginPath();
    g.roundRect(x - 36, y - 36, 72, 72, 10);
    g.fill();
  });
  g.save();
  g.strokeStyle = 'rgba(210, 212, 218, 0.55)';
  g.lineWidth = 1.8;
  font.text(g, value, x - 12, y - 6, 11);
  g.restore();
}

// A crystal in a low metal can, 96 by 36, on two lands 72 apart.
function crystal(g, x, y) {
  padRect(g, x - 36, y, 28, 40);
  padRect(g, x + 36, y, 28, 40);
  part(g, 8, () => {
    g.fillStyle = metal(g, x - 50, y - 20, x + 50, y + 20, ['#f4f5f7', '#b9bec6', '#8b919b']);
    g.beginPath();
    g.roundRect(x - 48, y - 18, 96, 36, 18);
    g.fill();
  });
}

// An electrolytic can of radius r from above: a lit aluminium top, the dark
// polarity band `band` deep on its left, and the scored vent cross `vent` long.
function electrolytic(g, x, y, r, { band = 13, vent = 22 } = {}) {
  part(g, 12, () => {
    const cap = g.createRadialGradient(x - 16, y - 18, 6, x, y, r + 2);
    cap.addColorStop(0, '#f7f8fa');
    cap.addColorStop(0.6, '#b7bcc4');
    cap.addColorStop(1, '#7c828c');
    g.fillStyle = cap;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  });
  g.fillStyle = '#20252e';
  g.beginPath();
  g.arc(x, y, r, Math.PI * 0.62, Math.PI * 1.38);
  g.arc(x, y, r - band, Math.PI * 1.38, Math.PI * 0.62, true);
  g.fill();
  g.strokeStyle = 'rgba(60, 64, 72, 0.7)';
  g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(x - vent, y); g.lineTo(x + vent, y);
  g.moveTo(x, y - vent); g.lineTo(x, y + vent);
  g.stroke();
}

// A pin header's plastic body at x from top to bottom, with a gold square pin at each height in `ys`.
function header(g, x, top, bottom, ys) {
  part(g, 8, () => {
    g.fillStyle = '#18181a';
    g.fillRect(x - 18, top, 36, bottom - top);
  });
  for (const y of ys) {
    g.fillStyle = metal(g, x - 8, y - 8, x + 8, y + 8, [C.gold[1], C.gold[0], C.gold[2]]);
    g.fillRect(x - 7, y - 7, 14, 14);
  }
}

// A plated mounting hole: a gold ring of radius r round a `drill`, and a silkscreen keep-out circle at `ring`.
function mountingHole(g, x, y, r = 22, drill = 13, ring = 30) {
  padRound(g, x, y, r, drill);
  g.save();
  silk(g, 2);
  g.beginPath();
  g.arc(x, y, ring, 0, Math.PI * 2);
  g.stroke();
  g.restore();
}

// A fiducial: a small gold dot of radius r in a clear disc of bare laminate.
function fiducial(g, x, y, r = 5, clear = 12) {
  g.fillStyle = C.bare;
  g.beginPath();
  g.arc(x, y, clear, 0, Math.PI * 2);
  g.fill();
  padRound(g, x, y, r);
}

// A plated hole with its own clearance: mask cleared to `clear`, then a gold pad of radius r and a drill.
function platedHole(g, x, y, r, drill, clear) {
  g.fillStyle = C.mask;
  g.beginPath();
  g.arc(x, y, clear, 0, Math.PI * 2);
  g.fill();
  padRound(g, x, y, r, drill);
}

// The board: a shadowed routed edge, a rounded rectangle [x, y, w, h] of
// `radius`, then a clip 3 inside it filled with solder mask over `sheet`
// (the board's box by default). Leaves the clip open: call g.restore() when
// everything on the board is drawn.
function board(g, [x, y, w, h], { radius = 30, sheet = [x, y, w, h] } = {}) {
  part(g, 30, () => {
    g.fillStyle = C.edge;
    g.beginPath();
    g.roundRect(x, y, w, h, radius);
    g.fill();
  });
  g.save();
  g.beginPath();
  g.roundRect(x + 3, y + 3, w - 6, h - 6, radius - 3);
  g.clip();
  g.fillStyle = C.mask;
  g.fillRect(...sheet);
}

// A ground pour over a closed `outline`, cleared in mask colour round every
// trace ({ pts, w }) by `gap`, round every closed shape by `ring` (stroked
// and filled), and round every part box [cx, cy, half w, half h] by `margin`.
function pour(g, outline, { traces = [], shapes = [], boxes = [], gap = 11, ring = 23, margin = 10 } = {}) {
  area(g, outline, C.pour);
  g.fillStyle = C.mask;
  g.strokeStyle = C.mask;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const t of traces) {
    g.lineWidth = t.w + 2 * gap;
    path(g, t.pts, false);
    g.stroke();
  }
  for (const shape of shapes) {
    g.lineWidth = 2 * ring;
    path(g, shape);
    g.stroke();
    path(g, shape);
    g.fill();
  }
  for (const [x, y, w, h] of boxes) {
    g.beginPath();
    g.roundRect(x - w - margin, y - h - margin, 2 * w + 2 * margin, 2 * h + 2 * margin, 14);
    g.fill();
  }
}

// Stitching vias: a grid `step` apart over [x0, y0, x1, y1], each point
// jittered by up to `jitter`/2, kept with chance `keep` where `room(p)` allows.
function stitch(g, R, name, [x0, y0, x1, y1], room, { step = 44, jitter = 12, keep = 0.5, r = 5 } = {}) {
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const p = [x + (R(name, 'x', x * 31 + y) - 0.5) * jitter, y + (R(name, 'y', x * 31 + y) - 0.5) * jitter];
      if (R(name, 'keep', x * 31 + y) < keep && room(p)) via(g, p[0], p[1], r);
    }
  }
}

// A closed area filled with copper crosshatch: mask inside `poly`, then
// crossing 45-degree traces `pitch` apart and `width` wide, centred on c.
function copperHatch(g, poly, c, { pitch = 14, width = 3.6, reach = 500, span = 700 } = {}) {
  g.save();
  path(g, poly);
  g.clip();
  g.fillStyle = C.mask;
  path(g, poly);
  g.fill();
  for (let k = -span; k < span; k += pitch) {
    trace(g, [[c[0] + k - reach, c[1] - reach], [c[0] + k + reach, c[1] + reach]], width);
    trace(g, [[c[0] + k + reach, c[1] - reach], [c[0] + k - reach, c[1] + reach]], width);
  }
  g.restore();
}

// A ring of mask `w` wide along a closed outline, to part an exposed shape from the copper round it.
function clearRing(g, pts, w) {
  g.save();
  g.strokeStyle = C.mask;
  g.lineWidth = w;
  g.lineJoin = 'round';
  path(g, pts);
  g.stroke();
  g.restore();
}

// Slots etched through exposed metal: each open path in `lines` stroked in
// bare laminate `w` wide, clipped to `poly`.
function etch(g, poly, lines, w = 4) {
  g.save();
  path(g, poly);
  g.clip();
  g.strokeStyle = C.bare;
  g.lineWidth = w;
  g.lineCap = 'round';
  for (const line of lines) {
    path(g, line, false);
    g.stroke();
  }
  g.restore();
}

// The laminate's glass weave, faint through the mask: lines `pitch` apart
// both ways, from `a` to `b` on both axes, each running from ends[0] to ends[1].
function weave(g, a, b, pitch = 7, ends = [a, b]) {
  g.save();
  g.strokeStyle = 'rgba(0, 20, 8, 0.05)';
  g.lineWidth = 1.4;
  g.beginPath();
  for (let k = a; k < b; k += pitch) {
    g.moveTo(k, ends[0]); g.lineTo(k, ends[1]);
    g.moveTo(ends[0], k); g.lineTo(ends[1], k);
  }
  g.stroke();
  g.restore();
}

// The comet tail on trace t from path distance s0 to the head at s1, inside
// the ribbon already clipped: each straight run of the trace filled once
// between mitre cuts, with a gradient along that run, so alpha falls as the
// square of the distance along the trace however tightly it bends.
function shadeRuns(g, t, s0, s1, span) {
  const run = [];
  let s = 0;
  for (let i = 1; i < t.length && s < s1; i++) {
    const [ax, ay] = t[i - 1]; const [bx, by] = t[i];
    const d = Math.hypot(bx - ax, by - ay);
    const at =(q) => [ax + ((bx - ax) * (q - s)) / d, ay + ((by - ay) * (q - s)) / d, q];
    if (d > 0 && s + d > s0 && s < s1) {
      if (!run.length) run.push(at(Math.max(s, s0)));
      // Summed lengths can drift a hair past s1: skip a run too short to have a direction.
      const q = Math.min(s + d, s1);
      if (q - run[run.length - 1][2] > 1e-6) run.push(at(q));
    }
    s += d;
  }
  // A single point has no direction to shade along (a run under 1e-6 long).
  if (run.length < 2) return;
  // A head on the trace's last point sits at its end, short of a whole step.
  const end = Math.min(s1, s);
  const alpha = (q) => { const v = 1 - (end - q) / span; return (0.8 * v * v).toFixed(3); };
  const dir = run.slice(1).map((p, j) => { const d = Math.hypot(p[0] - run[j][0], p[1] - run[j][1]); return [(p[0] - run[j][0]) / d, (p[1] - run[j][1]) / d]; });
  // Each cut: the point and its offset to the piece's edge, 4 out (past the
  // widest tail); the ends reach 3 past the tail so the clip shapes its caps.
  const cut = run.map((p, j) => {
    const a = dir[Math.max(0, j - 1)]; const b = dir[Math.min(dir.length - 1, j)];
    const k = 4 / Math.max(0.1, 1 + a[0] * b[0] + a[1] * b[1]);
    const e = j === 0 ? -3 : j === run.length - 1 ? 3 : 0;
    return [p[0] + e * b[0], p[1] + e * b[1], -(a[1] + b[1]) * k, (a[0] + b[0]) * k];
  });
  for (let j = 0; j < dir.length; j++) {
    const [p, q] = [run[j], run[j + 1]];
    const grad = g.createLinearGradient(p[0], p[1], q[0], q[1]);
    for (let f = 0; f <= 4; f++) grad.addColorStop(f / 4, 'rgba(190, 255, 230, ' + alpha(p[2] + (f / 4) * (q[2] - p[2])) + ')');
    g.fillStyle = grad;
    const [c, n] = [cut[j], cut[j + 1]];
    fill(g, [[c[0] + c[2], c[1] + c[3]], [n[0] + n[2], n[1] + n[3]], [n[0] - n[2], n[1] - n[3]], [c[0] - c[2], c[1] - c[3]]]);
  }
}

// Current on its way: along each trace a comet, its head at fraction at[k]
// of the trace, a tail of `len` points `step` apart that narrows and whose
// alpha falls as the square of the distance along the trace, and an additive
// glow of radius 16 at the head. The tail's ribbon is a clip that each
// straight run fills once, so no joint is painted twice.
function current(g, traces, at, { len = 22, step = 3 } = {}) {
  g.save();
  g.globalCompositeOperation = 'lighter';
  traces.forEach((t, k) => {
    const pts = resample(t, step);
    const head = Math.floor(at[k] * (pts.length - 1));
    const tail = pts.slice(Math.max(0, head - len + 1), head + 1);
    if (tail.length > 1) {
      // u is 1 at the head and falls by 1 / len per point toward the tail end.
      const u = (i) => 1 - (tail.length - 1 - i) / len;
      g.save();
      path(g, outline(tail, tail.map((_, i) => 1.5 + 2.5 * u(i))));
      g.clip();
      shadeRuns(g, t, (head - tail.length + 1) * step, head * step, len * step);
      g.restore();
    }
    glow(g, pts[head][0], pts[head][1], 16, 'rgba(160, 255, 220, 0.8)');
  });
  g.restore();
}

// A soft sheen over [x, y, w, h]: a diagonal gradient from white at 0.07 to black at 0.12.
function sheen(g, x, y, w, h) {
  const grad = g.createLinearGradient(x, y, x + w, y + h);
  grad.addColorStop(0, 'rgba(255, 255, 255, 0.07)');
  grad.addColorStop(0.45, 'rgba(255, 255, 255, 0)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0.12)');
  g.fillStyle = grad;
  g.fillRect(x, y, w, h);
}

module.exports = {
  PALETTE, bend, route, octagonal, copper, trace, area, exposed, goldLine, padRect, padRound, via, silk, label, plus,
  bus, part, metal, qfp, chipPart, glow, led, inductor, crystal, electrolytic, header, mountingHole, fiducial,
  platedHole, board, pour, stitch, copperHatch, clearRing, etch, weave, current, sheen,
};
