// Watercolour: transparent washes on cold-press paper. Each wash is one shape
// painted as dozens of faint, slightly different layers, so its edge is soft
// in some places and ragged in others; washes glaze over each other by
// multiplying, pigment gathers at their rims and settles in the paper's
// tooth, and the white of the paper is the only white.
//
// A parts bin: functions that draw the style's marks on any path, outline or
// area you give them. Nothing here picks a subject, a scene or a layout.

'use strict';

const { fbm } = require('../../../core/rand.js');
const { pointInPoly, bbox, centroid, chaikin, resample, lengthOf } = require('../../../core/geom.js');
const { path, sub, wobble } = require('./kit.js');

// One Chaikin pass over a closed outline: corners round and a long edge
// swells instead of spiking. Returns [x, y] points, so it comes after the
// last deform of an outline, never before one.
const soft = (pts) => chaikin(pts, 1, true);

// Transparent pigments, and the paper that is the only white.
const PIGMENTS = {
  paper: '#f8f4ea',
  cerulean: '#5b9fcc',
  ultramarine: '#3e55a8',
  rose: '#dc6f86',
  peach: '#f2b27a',
  ochre: '#dcaa4a',
  sienna: '#b9602f',
  umber: '#5e3d27',
  sap: '#7aa13f',
  hooker: '#3b7650',
  payne: '#2d3642',
  graphite: 'rgba(80, 76, 72, 0.4)',
};

function gauss(R, name, i) {
  const u = Math.max(1e-9, R(name, 'u', i));
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * R(name, 'v', i));
}

// A wet edge: midpoint displacement of a closed outline of [x, y, roughness]
// points, `depth` times by `amount` of each edge's length, each push held
// within 0.3 of that length. Each point hands its roughness on to the points
// made beside it, so one stretch stays crisp while another frays.
function deform(pts, R, name, depth, amount) {
  let cur = pts;
  let n = 0;
  for (let d = 0; d < depth; d++) {
    const out = [];
    for (let i = 0; i < cur.length; i++) {
      const a = cur[i]; const b = cur[(i + 1) % cur.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const r = (a[2] + b[2]) / 2;
      const push = (key) => Math.max(-0.3, Math.min(0.3, gauss(R, name + key, n) * amount * r)) * len;
      out.push(a, [
        (a[0] + b[0]) / 2 + push('x'),
        (a[1] + b[1]) / 2 + push('y'),
        Math.min(1.6, Math.max(0.2, r * (0.65 + 0.7 * R(name, 'r', n)))),
      ]);
      n++;
    }
    cur = out;
  }
  return cur;
}

// A sheet of `g`'s pixels under the design box (x, y, w, h) with `g`'s own
// transform, or null where `g` has no canvas to make one from: `clear()`
// empties it and returns its context, `lay()` draws it onto `g` in place.
function scratch(g, x, y, w, h) {
  if (!g.canvas || typeof g.getTransform !== 'function' || typeof g.drawImage !== 'function') return null;
  const doc = g.canvas.ownerDocument;
  const m = g.getTransform();
  const xs = []; const ys = [];
  for (const [u, v] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
    xs.push(m.a * u + m.c * v + m.e);
    ys.push(m.b * u + m.d * v + m.f);
  }
  const dx = Math.floor(Math.min(...xs)); const dy = Math.floor(Math.min(...ys));
  const dw = Math.max(1, Math.ceil(Math.max(...xs)) - dx); const dh = Math.max(1, Math.ceil(Math.max(...ys)) - dy);
  const c = doc ? Object.assign(doc.createElement('canvas'), { width: dw, height: dh })
    : typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(dw, dh) : null;
  if (!c) return null;
  const cg = c.getContext('2d');
  return {
    clear() {
      cg.setTransform(1, 0, 0, 1, 0, 0);
      cg.clearRect(0, 0, dw, dh);
      cg.globalCompositeOperation = 'source-over';
      cg.setTransform(m.a, m.b, m.c, m.d, m.e - dx, m.f - dy);
      return cg;
    },
    lay() {
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(c, dx, dy);
      g.restore();
    },
  };
}

// One transparent wash: `layers` faint deformed copies of an outline glazed
// under multiply. The first `floor` share of the layers covers the whole
// outline, so the wash lands wherever it is asked; the rest pool where a
// noise field is high, as soft irregular blobs clipped to their own layer,
// `mottle` setting how much they pool. `wet` feathers every layer's edge by
// that many design units. `second` flows a second colour into `share` of
// the layers, `rim` darkens the dried edge, and an `outline` given as a
// function of the layer (0 to 1) grades the wash. Returns the wash's edge.
function wash(g, R, name, outline, colour, opts = {}) {
  const { layers = 24, alpha = 0.03, rough = 1, spread = 0.12, rim = 0.05, second = null, share = 0.35, mottle = 0.6, floor = 0.5, wet = 0 } = opts;
  const graded = typeof outline === 'function';
  const pooled = mottle > 0 ? layers - Math.round(layers * floor) : 0;
  const first = layers - pooled;
  // A graded outline is evaluated once per layer. The wash's size, cell and
  // pools span every pooled layer.
  const outs = [];
  const at = (k) => outs[k] || (outs[k] = outline(k / Math.max(1, layers - 1)));
  const [x0, y0, x1, y1] = bbox(graded ? Array.from({ length: Math.max(1, pooled) }, (_, i) => at(layers - 1 - i)).flat() : outline);
  const size = Math.max(x1 - x0, y1 - y0, 1);
  const cell = Math.max(6, Math.min(26, size / 16));
  // A canvas filter blurs in output pixels whatever the transform, so the
  // feather is scaled by it and keeps its size at every output size.
  const m = typeof g.getTransform === 'function' && g.getTransform();
  const blur = (units) => 'blur(' + units * (m ? Math.hypot(m.a, m.b) : 1) + 'px)';
  // Edges longer than a cell are split into even steps before deforming, so
  // a frame-wide wash's edge wanders by the wash's grain, not by how few
  // points it was given: a push is a share of its edge's length. An edge of
  // length 0 keeps its one point.
  const split = (pts) => pts.flatMap((a, i) => {
    const b = pts[(i + 1) % pts.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / cell));
    return Array.from({ length: n }, (_, k) => [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  });
  // deform() keeps the points it is given, so an outline sampled closer than
  // a cell would be pinched at each of them, an even tooth the same in every
  // layer. After the two deforms, each given or split point (every fourth)
  // is pushed off the line through its neighbours by a Gaussian share of
  // `spread` times its roughness of four times its shorter edge, about its
  // given edge, held within 0.75 of the shorter edge. The points deform
  // added stay put, so a thin strip strays no further past its sides than
  // they already take it. Where the outline turns the point moves less, and
  // not at all at a right angle or sharper, so corners and tips stay put.
  const unpin = (pts, key) => pts.map((p, i) => {
    if (i % 4) return p;
    const o = pts[(i || pts.length) - 1]; const q = pts[(i + 1) % pts.length];
    const lo = Math.hypot(p[0] - o[0], p[1] - o[1]); const lq = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const across = Math.hypot(q[0] - o[0], q[1] - o[1]);
    if (!lo || !lq || !across) return p;
    const straight = Math.max(0, ((p[0] - o[0]) * (q[0] - p[0]) + (p[1] - o[1]) * (q[1] - p[1])) / (lo * lq));
    const push = (Math.max(-0.75, Math.min(0.75, gauss(R, name + 'n' + key, i) * spread * 4 * p[2])) * Math.min(lo, lq) * straight) / across;
    return [p[0] + (o[1] - q[1]) * push, p[1] + (q[0] - o[0]) * push, p[2]];
  });
  const prep = (pts, key) => unpin(deform(split(pts).map((p, i) => [p[0], p[1], rough * (0.3 + 1.4 * R(name, 'rough' + key, i))]), R, name + 'b' + key, 2, spread), key);
  const fixed = graded ? null : prep(outline, '');
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.lineJoin = 'round';
  // A wet wash's pools are masked by their layer on a sheet of their own, so
  // the mask's edge feathers too; a dry wash, or a surface with no canvas to
  // make another from, clips them instead.
  let sheet = null;
  for (let k = 0; k < layers; k++) {
    const base = fixed || prep(at(k), k);
    const layer = soft(deform(base, R, name + 'l' + k, 3, spread * 0.45));
    const ink = second && R(name, 'mix', k) < share ? second : colour;
    g.save();
    g.fillStyle = ink;
    if (k < first) {
      if (wet > 0) g.filter = blur(wet);
      g.globalAlpha = alpha;
      path(g, layer);
      g.fill();
    } else {
      const level = 0.5 + mottle * 0.6 * ((k - first) / Math.max(1, pooled - 1) - 0.5);
      if (wet > 0) sheet = sheet || scratch(g, x0 - cell * 2, y0 - cell * 2, x1 - x0 + cell * 4, y1 - y0 + cell * 4);
      const c = sheet ? sheet.clear() : g;
      if (!sheet) {
        path(g, layer);
        g.clip();
      }
      g.globalAlpha = alpha * (1 + mottle);
      c.fillStyle = ink;
      c.filter = blur(Math.max(wet, cell * 0.3));
      c.beginPath();
      for (let y = y0 - cell; y < y1 + cell; y += cell) {
        for (let x = x0 - cell; x < x1 + cell; x += cell) {
          const jx = x + (R(name, 'jx' + k, Math.round(x * 7 + y)) - 0.5) * cell;
          const jy = y + (R(name, 'jy' + k, Math.round(x * 7 + y)) - 0.5) * cell;
          const v = fbm(R, jx / (size * 0.45), jy / (size * 0.45), 3, name + 'pool');
          if (v < level) continue;
          const r = cell * (0.55 + 0.9 * Math.min(1, (v - level) / 0.2));
          for (let i = 0; i < 7; i++) {
            const a = (Math.PI * 2 * i) / 7;
            const d = r * (0.75 + 0.5 * R(name, 'blob' + k, Math.round(x * 7 + y) * 8 + i));
            if (i) c.lineTo(jx + Math.cos(a) * d, jy + Math.sin(a) * d); else c.moveTo(jx + d, jy);
          }
          c.closePath();
        }
      }
      c.fill();
      if (sheet) {
        c.globalCompositeOperation = 'destination-in';
        c.filter = blur(wet);
        path(c, layer);
        c.fill();
        sheet.lay();
      }
    }
    g.restore();
  }
  const edge = soft(fixed || prep(at(0), 'r'));
  if (rim > 0 && (fixed || opts.rim)) {
    g.save();
    path(g, edge);
    g.clip();
    g.strokeStyle = colour;
    g.globalAlpha = rim;
    g.lineWidth = 7;
    path(g, edge);
    g.stroke();
    g.globalAlpha = rim * 1.6;
    g.lineWidth = 2;
    path(g, edge);
    g.stroke();
    g.restore();
  }
  g.restore();
  return edge;
}

// Paint dropped into a wet shape: `paint()` runs clipped to the outline, so
// its washes stop at the shape's one edge. With `outside` [w, h], it runs on
// the sheet outside the outline instead. `soften` { R, name, points, spread }
// redraws the outline with `points` evenly spaced points, or more where an
// edge would pass 26 units (the largest wash cell), deforms it by `spread`
// of each edge and smooths it, so a reserved light is no vector ellipse
// however finely it was drawn, and a large one wanders no further than a
// frame-wide wash. An outline too short to keep 3 points stays as given.
function confine(g, outline, paint, outside = null, soften = null) {
  let shape = outline;
  if (soften) {
    const { R, name, points = 10, spread = 0.2 } = soften;
    const few = resample(outline, Math.max(1e-6, Math.min(26, lengthOf(outline, true) / points)), true).slice(0, -1);
    if (few.length > 2) shape = soft(deform(few.map((p) => [p[0], p[1], 1]), R, name, 3, spread));
  }
  g.save();
  if (outside) {
    g.beginPath();
    g.rect(0, 0, outside[0], outside[1]);
    sub(g, shape);
    g.clip('evenodd');
  } else {
    path(g, shape);
    g.clip();
  }
  paint();
  g.restore();
}

// Pigment lifted with a damp brush: twelve passes of paper colour, each a
// little smaller, so the paper shows again most at the middle. `strength`
// 0.4 to 0.6 reads as a lifted light.
function lift(g, R, name, outline, strength = 0.5, paper = PIGMENTS.paper) {
  const [cx, cy] = centroid(outline);
  g.save();
  g.fillStyle = paper;
  for (let k = 0; k < 12; k++) {
    const s = 1.35 - (0.8 * k) / 11;
    const pts = outline.map(([x, y]) => [cx + (x - cx) * s, cy + (y - cy) * s, 1]);
    g.globalAlpha = strength / 12;
    path(g, soft(deform(pts, R, name + 'l' + k, 3, 0.1)));
    g.fill();
  }
  g.restore();
}

// A bloom (backrun): water crept back into a drying wash, pushed the pigment
// out and left a ragged dark edge round a paler middle. Returns its edge.
function bloom(g, R, name, outline, colour, strength = 0.45) {
  const edge = deform(outline.map((p) => [p[0], p[1], 1.3]), R, name, 3, 0.16);
  lift(g, R, name + 'lift', edge, strength);
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.strokeStyle = colour;
  g.lineJoin = 'round';
  for (let k = 0; k < 3; k++) {
    g.globalAlpha = 0.1;
    g.lineWidth = 1 + k * 0.6;
    path(g, soft(deform(edge, R, name + 'edge' + k, 2, 0.06)));
    g.stroke();
  }
  g.restore();
  return soft(edge);
}

// Granulation: pigment settled in the paper's tooth, `count` specks of about
// `size` clumped by a noise field, inside a shape.
function granulate(g, R, name, shape, colour, count, size = 1.5) {
  const [x0, y0, x1, y1] = bbox(shape);
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = colour;
  for (let i = 0; i < count; i++) {
    const x = x0 + R(name, 'gx', i) * (x1 - x0); const y = y0 + R(name, 'gy', i) * (y1 - y0);
    if (fbm(R, x / 30, y / 30, 3, name + 'clump') < 0.55 || !pointInPoly([x, y], shape)) continue;
    g.globalAlpha = 0.12 + 0.22 * R(name, 'ga', i);
    const r = size * (0.5 + R(name, 'gr', i));
    g.fillRect(x - r / 2, y - r / 2, r, r);
  }
  g.restore();
}

// Flicked paint: `n` drops of 1 to 6 units scattered within `spread` of a point.
function splatter(g, R, name, x, y, spread, colour, n) {
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = colour;
  for (let i = 0; i < n; i++) {
    const a = R(name, 'a', i) * Math.PI * 2; const d = spread * Math.sqrt(R(name, 'd', i));
    const r = 1 + 5 * R(name, 'r', i) ** 3;
    g.globalAlpha = 0.25 + 0.3 * R(name, 'k', i);
    g.beginPath();
    g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.7, r, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

// The underdrawing: a loose graphite line along a path that lifts now and then.
function pencil(g, R, name, pts, close = false) {
  g.save();
  g.strokeStyle = PIGMENTS.graphite;
  g.lineWidth = 1.2;
  g.lineCap = 'round';
  const line = wobble(pts, R, name, 1.4, 9, close);
  g.beginPath();
  let pen = false;
  for (let i = 0; i < line.length; i++) {
    const gap = R(name, 'gap', i) < 0.06;
    if (gap || !pen) g.moveTo(line[i][0], line[i][1]); else g.lineTo(line[i][0], line[i][1]);
    pen = !gap;
  }
  g.stroke();
  g.restore();
}

// Strokes of the brush's point along open lines: wobbled, round-capped, glazed.
// `width` and `alpha` are numbers, or functions of the line's index for a set
// of strokes that thin out one after another.
function tips(g, R, name, lines, colour, opts = {}) {
  const { width = 3, alpha = 0.5, amp = 1.2, step = 10 } = opts;
  const each = typeof width === 'function' || typeof alpha === 'function';
  const at = (v, k) => (typeof v === 'function' ? v(k) : v);
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.strokeStyle = colour;
  g.lineCap = 'round';
  if (!each) {
    g.globalAlpha = alpha;
    g.lineWidth = width;
  }
  lines.forEach((line, k) => {
    if (each) {
      g.globalAlpha = at(alpha, k);
      g.lineWidth = at(width, k);
    }
    path(g, wobble(line, R, name + k, amp, step), false);
    g.stroke();
  });
  g.restore();
}

// Dry brush dragged along a spine: `count` broken lines `gap` apart, each
// skipping about `skip` of its segments where the brush missed the paper.
function drybrush(g, R, name, spine, colour, opts = {}) {
  const { count = 3, gap = 4, width = 2.2, alpha = 0.35, skip = 0.35 } = opts;
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.strokeStyle = colour;
  g.lineCap = 'round';
  for (let k = 0; k < count; k++) {
    g.globalAlpha = alpha;
    g.lineWidth = width;
    const off = (k - (count - 1) / 2) * gap;
    const line = wobble(spine.map(([x, y]) => [x, y + off]), R, name + k, 1.2, 8);
    g.beginPath();
    for (let i = 1; i < line.length; i++) {
      if (R(name + k, 'skip', i) < skip) continue;
      g.moveTo(line[i - 1][0], line[i - 1][1]);
      g.lineTo(line[i][0], line[i][1]);
    }
    g.stroke();
  }
  g.restore();
}

// Flicks: `n` pressed strokes lifting off the paper, wide at the root and a
// point at the tip, rooted along a band `w` wide and `depth` deep from (x, y),
// as grass, fur or reeds. Colours are picked 60/40 from `colours`.
function flicks(g, R, name, n, x, y, w, depth, colours, opts = {}) {
  const { len = 30, reach = 60, lean = 40, width = 2, swell = 2.5 } = opts;
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const bx = x + R(name, 'x', i) * w; const by = y + (R(name, 'y', i) - 0.5) * depth;
    const h = len + reach * R(name, 'h', i); const tilt = (R(name, 'l', i) - 0.4) * lean;
    const thick = width + swell * R(name, 'w', i);
    const left = []; const right = [];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      const px = bx + tilt * t * t; const py = by - h * t; const half = (thick / 2) * (1 - t);
      left.push([px - half, py]);
      right.push([px + half, py]);
    }
    g.fillStyle = R(name, 'c', i) < 0.6 ? colours[0] : colours[1];
    g.globalAlpha = 0.3 + 0.35 * R(name, 'a', i);
    path(g, [...left, ...right.reverse()]);
    g.fill();
  }
  g.restore();
}

// The paper's tooth over everything: `count` specks over a `w` x `h` sheet.
// Light specks dodge, so they lighten bare paper and thin washes and leave
// dark ones alone; pigment specks burn, so they darken in proportion to the
// pigment already there, in the hollows under washes, and vanish on bare
// paper.
function tooth(g, R, name, w, h, count = 9000) {
  g.save();
  for (let i = 0; i < count; i++) {
    const x = R(name, 'x', i) * w; const y = R(name, 'y', i) * h;
    const k = 0.6 + R(name, 'k', i) * 1.2;
    const light = R(name, 'tone', i) < 0.55;
    g.globalCompositeOperation = light ? 'color-dodge' : 'color-burn';
    g.fillStyle = light ? 'rgba(40, 40, 36, 0.35)' : 'rgba(215, 200, 180, 0.35)';
    g.fillRect(x, y, k, k);
  }
  g.restore();
}

module.exports = { PIGMENTS, deform, wash, confine, lift, bloom, granulate, splatter, pencil, tips, drybrush, flicks, tooth };
