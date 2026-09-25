// The notebook page slid between the mirrors: a page torn out of a school
// notebook, ruled, with its red margin and punched holes, and on it the
// catalog's demo subject doodled in blue ballpoint, as the doodle style draws
// it (see skills/artifex/styles/doodle.md): every line drawn twice with its own
// wobble, shading by hatching, the wing and beak laid over the body.
//
// AS LINES, FOR ANY MAP. The page is built once as polylines and polygons in
// its own units, the bird at the origin, so it can be drawn through any map
// of the plane: laid on the sheet, or seen in a circle mirror, where every
// ruled line bends. Hatching is cut to its regions as segments, not clipped
// on the canvas, for the same reason.
//
// The bird is small enough to lie inside the region between the bowed
// mirrors, so every reflection holds all of it.

'use strict';

const { rng } = require('../../core/rand.js');
const { chaikin } = require('../../core/geom.js');
const { bird } = require('../../skills/artifex/styles/subject.js');
const { wobble, ellipse } = require('../../skills/artifex/styles/kit.js');

const PAPER = '#fbfaf4';
const BLUE = 'rgba(31, 58, 147, 0.88)';
const RED = 'rgba(200, 45, 60, 0.85)';
const RULE = 'rgba(120, 165, 220, 0.55)';
const MARGIN = 'rgba(225, 120, 130, 0.8)';
const HOLE = '#dcd8cc';

const SIZE = 40;              // the bird's scale: about 2.1 of these long
const K = SIZE / 215;         // the doodle style's page, where the bird's scale is 215, to this one
const PW = 470, PH = 420;     // the page, wide enough to cover the region between the mirrors turned any way
const LEFT = -PW * 0.34, TOP = -PH * 0.52;   // its top left corner, from the bird

/** Build stage: the page and its doodle, as marks in the page's units. */
function page(s) {
  const R = rng(s.seed);
  const marks = [];
  const line = (pts, ink, width, close = false, straight = false) => marks.push({ pts, ink, width, close, straight });
  const fill = (pts, colour) => marks.push({ pts, fill: colour });
  // A pen line: twice, with independent wobble, as a hand goes over it.
  const pen = (name, pts, close = false, ink = BLUE, width = 2.6, passes = 2) => {
    for (let k = 0; k < passes; k++) line(wobble(pts, R, name + k, (k ? 2.2 : 1.3) * K, 7 * K, close), ink, width * K * (k ? 0.7 : 1), close);
  };
  const hatch = (name, region, angle, spacing, within = null) => {
    for (const [i, seg] of cut(region, angle, spacing * K, within).entries()) line(wobble(seg, R, name + i, 1.2 * K, 14 * K), BLUE, 1.6 * K);
  };

  // The sheet: its edges a little uneven, the torn one ragged.
  const edge = [];
  const side = (a, b, n, rag) => {
    for (let i = 0; i < n; i++) {
      const u = i / n, x = a[0] + (b[0] - a[0]) * u, y = a[1] + (b[1] - a[1]) * u;
      const nx = -(b[1] - a[1]), ny = b[0] - a[0], l = Math.hypot(nx, ny);
      const d = (R('page', 'edge', edge.length) - 0.5) * rag;
      edge.push([x + (nx / l) * d, y + (ny / l) * d]);
    }
  };
  const tl = [LEFT, TOP], tr = [LEFT + PW, TOP], br = [LEFT + PW, TOP + PH], bl = [LEFT, TOP + PH];
  side(tl, tr, 60, 0.8);
  side(tr, br, 60, 3.2);
  side(br, bl, 60, 0.8);
  side(bl, tl, 60, 0.8);
  fill(edge, PAPER);
  // Ruled lines, the margin and the punched holes.
  const gap = 34 * K;
  for (let y = TOP + 118 * K; y < TOP + PH - 4; y += gap) line([[LEFT + 1, y], [LEFT + PW - 3, y]], RULE, 1.6 * K, false, true);
  line([[LEFT + 112 * K, TOP + 1], [LEFT + 112 * K, TOP + PH - 1]], MARGIN, 2.2 * K, false, true);
  for (let y = TOP + 190 * K; y < TOP + PH - 10 * K; y += 310 * K) fill(ellipse(LEFT + 52 * K, y, 17 * K, 17 * K, 20), HOLE);

  // The bird on a branch, in the doodle's order.
  const b = bird(0, 0, SIZE, -0.04);
  const branch = chaikin([[-1.0, 0.79], [-0.5, 0.72], [0.2, 0.7], [0.8, 0.62], [1.25, 0.52]].map(([u, v]) => [u * SIZE, v * SIZE]), 2);
  pen('branch', branch, false, BLUE, 3.4);
  pen('branch2', branch.map(([x, y]) => [x + 6 * K, y + 12 * K]), false, BLUE, 2.2, 1);
  const leaf = ellipse(1.1 * SIZE, 0.44 * SIZE, 22 * K, 9 * K, 16, 0.5);
  pen('leaf', leaf, true, BLUE, 2.2);
  hatch('leafh', leaf, 1.7, 7);
  for (const [i, leg] of b.legs.entries()) pen('leg' + i, [leg[0], [leg[1][0], 0.7 * SIZE]], false, BLUE, 3);
  pen('tail', b.tail, true);
  hatch('tailh', b.tail, 0.9, 9);
  pen('body', b.body, true);
  hatch('belly', b.at(ellipse(-0.1, 0.36, 0.7, 0.3)), 0.7, 10, b.body);
  hatch('belly2', b.at(ellipse(-0.3, 0.42, 0.45, 0.16)), -0.7, 10, b.body);
  fill(b.wing, PAPER);
  pen('wing', b.wing, true);
  for (let k = 0; k < 4; k++) pen('scallop' + k, chaikin(b.at([[0.12 - k * 0.2, -0.04], [0.02 - k * 0.2, 0.06], [-0.1 - k * 0.2, -0.02]]), 2), false, BLUE, 2);
  fill(b.beak, PAPER);
  pen('beak', b.beak, true);
  fill(ellipse(b.eye[0], b.eye[1], 11 * K, 11 * K, 16), BLUE);
  fill(ellipse(b.eye[0] + 3.5 * K, b.eye[1] - 3.5 * K, 3.5 * K, 3.5 * K, 10), PAPER);
  pen('cheek', ellipse(b.cheek[0] + 4 * K, b.cheek[1] + 6 * K, 14 * K, 9 * K), true, RED, 2);
  // What it sings.
  const tip = b.at([[1.03, -0.34]])[0];
  for (let k = 1; k <= 3; k++) {
    const arc = [];
    for (let i = 0; i <= 8; i++) { const a = -0.55 + (i / 8) * 1.1; arc.push([tip[0] + 6 * K + Math.cos(a) * k * 20 * K, tip[1] + Math.sin(a) * k * 20 * K]); }
    pen('wave' + k, arc, false, BLUE, 2, 1);
  }
  s.page = { marks };
}

/**
 * Parallel lines across `region` at `angle`, `spacing` apart, cut to the
 * region (and to `within` too, when given), as straight segments.
 */
function cut(region, angle, spacing, within) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of region) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, r = Math.hypot(x1 - x0, y1 - y0) / 2;
  const ux = Math.cos(angle), uy = Math.sin(angle);
  const out = [];
  for (let k = -r; k <= r; k += spacing) {
    const a = [cx - ux * r - uy * k, cy - uy * r + ux * k], b = [cx + ux * r - uy * k, cy + uy * r + ux * k];
    let spans = inside(a, b, region);
    if (within) spans = spans.flatMap(([t0, t1]) => inside(a, b, within).map(([u0, u1]) => [Math.max(t0, u0), Math.min(t1, u1)]).filter(([p, q]) => q - p > 1e-6));
    for (const [t0, t1] of spans) out.push([[a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0], [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1]]);
  }
  return out;
}

/** The parts of segment ab inside polygon `poly`, as parameter spans [t0, t1] along it. */
function inside(a, b, poly) {
  const ts = [];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (let j = 0; j < poly.length; j++) {
    const p = poly[j], q = poly[(j + 1) % poly.length];
    const ex = q[0] - p[0], ey = q[1] - p[1], den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((p[0] - a[0]) * ey - (p[1] - a[1]) * ex) / den, u = ((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u < 1) ts.push(t);
  }
  ts.sort((x, y) => x - y);
  const spans = [];
  for (let m = 0; m + 1 < ts.length; m += 2) spans.push([ts[m], ts[m + 1]]);
  return spans;
}

/**
 * Draw the page through `map` (a point in the page's units to one on the
 * surface), its line widths multiplied by `scale`: the paper, then every mark
 * in order. For a map that bends lines, `step` splits every segment longer
 * than that, in the page's units, before it is mapped. With `view`, [x0, y0,
 * x1, y1] after the map, a line is drawn only where it comes into that
 * rectangle: a canvas still works through every part of a path it is given,
 * however far outside it. Lines of one ink and width that follow one another
 * are stroked together, as one path. With `straight`, a function that adds
 * the image of a straight segment (its two ends in the page's units) to the
 * path, the ruled lines and the margin are drawn by it, whole.
 */
function drawPage(g, s, map, scale = 1, step = 0, view = null, straight = null) {
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const out = (p) => view && (p[0] < view[0] || p[0] > view[2] || p[1] < view[1] || p[1] > view[3]);
  let style = null;
  const flush = () => { if (style !== null) g.stroke(); style = null; };
  for (const mark of s.page.marks) {
    if (straight && mark.straight) {
      const key = mark.ink + ' ' + mark.width;
      if (style !== key) { flush(); g.beginPath(); g.strokeStyle = mark.ink; g.lineWidth = mark.width * scale; style = key; }
      straight(g, mark.pts[0], mark.pts[1]);
      continue;
    }
    const pts = (step ? split(mark.pts, step, mark.fill || mark.close) : mark.pts).map(map);
    if (mark.fill) {
      flush();
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.closePath();
      g.fillStyle = mark.fill;
      g.fill();
      continue;
    }
    const key = mark.ink + ' ' + mark.width;
    if (style !== key) {
      flush();
      g.beginPath();
      g.strokeStyle = mark.ink;
      g.lineWidth = mark.width * scale;
      style = key;
    }
    if (!view) {
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      if (mark.close) g.closePath();
    } else {
      // Only the segments with an end in view.
      let pen = false;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        if (out(a) && out(b)) { pen = false; continue; }
        if (!pen) { g.moveTo(a[0], a[1]); pen = true; }
        g.lineTo(b[0], b[1]);
      }
      if (mark.close && !(out(pts[pts.length - 1]) && out(pts[0]))) { g.moveTo(pts[pts.length - 1][0], pts[pts.length - 1][1]); g.lineTo(pts[0][0], pts[0][1]); }
    }
  }
  flush();
  g.restore();
}

/** The polyline with every segment longer than `step` split evenly, the closing one too when `closed`. */
function split(pts, step, closed) {
  const out = [];
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let j = 0; j < k; j++) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
  }
  if (!closed) out.push(pts[pts.length - 1]);
  return out;
}

module.exports = { page, drawPage };
