// Shared polyline drawing and rectangular clipping operations.
// Use clipping when the design box is a window onto a larger tiling, map or crop.
//
// Nothing here knows what kind of art a piece makes.

'use strict';

/**
 * Draw a polyline. Does NOT paint: the caller decides fill, stroke or both,
 * because a shape and its treatment are separate decisions.
 *
 * `close` joins the last point to the first. Two-point runs are preserved;
 * filtering them by length would remove valid strokes such as letter crossbars.
 */
function poly(g, pts, close = false) {
  if (!pts || pts.length === 0) return g;
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  if (close) g.closePath();
  return g;
}

/** Stroke a polyline. */
function stroke(g, pts, close = false) {
  poly(g, pts, close);
  g.stroke();
  return g;
}

/** Fill a polyline. */
function fill(g, pts) {
  poly(g, pts, true);
  g.fill();
  return g;
}

/**
 * Clip one segment to an axis-aligned box, by Liang-Barsky.
 * Returns the surviving segment, or null.
 */
function clipSegment(a, b, box) {
  const [x0, y0, x1, y1] = box;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  const q0 = a[0] - x0;
  const q1 = x1 - a[0];
  const q2 = a[1] - y0;
  const q3 = y1 - a[1];
  {
    const p = -dx; const q = q0;
    if (p === 0) {
      if (q < 0) return null;                  // parallel and outside
    } else {
      const r = q / p;
      if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
      else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
  }
  {
    const p = dx; const q = q1;
    if (p === 0) {
      if (q < 0) return null;                  // parallel and outside
    } else {
      const r = q / p;
      if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
      else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
  }
  {
    const p = -dy; const q = q2;
    if (p === 0) {
      if (q < 0) return null;                  // parallel and outside
    } else {
      const r = q / p;
      if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
      else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
  }
  {
    const p = dy; const q = q3;
    if (p === 0) {
      if (q < 0) return null;                  // parallel and outside
    } else {
      const r = q / p;
      if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
      else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
  }
  return [
    [a[0] + t0 * dx, a[1] + t0 * dy],
    [a[0] + t1 * dx, a[1] + t1 * dy],
  ];
}

/**
 * Clip a polyline to a box, returning the RUNS that survive.
 *
 * Runs, not one polyline: a line that leaves the box and comes back is two
 * marks, and joining them would draw a stroke across the middle of the picture
 * that the piece never asked for. A plotter would draw it too.
 *
 * `box` is [x0, y0, x1, y1]. `boxOf(size)` makes one from a piece's own size.
 */
function clipPolyline(pts, box, close = false) {
  const src = close && pts.length > 2 ? [...pts, pts[0]] : pts;
  if (src.length < 2) {
    return src.length === 1 && inside(src[0], box) ? [[src[0]]] : [];
  }
  const runs = [];
  let run = null;
  for (let i = 0; i < src.length - 1; i++) {
    const seg = clipSegment(src[i], src[i + 1], box);
    if (!seg) { run = null; continue; }
    if (run && same(run[run.length - 1], seg[0])) run.push(seg[1]);
    else { run = [seg[0], seg[1]]; runs.push(run); }
  }
  // A segment that only grazes a corner clips to a single point. That is a pen
  // down and a pen up with nothing between them -- a lift, not a mark.
  return runs.filter((r) => r.some((q) => !same(q, r[0])));
}

/** The box of a piece's design size, as [x0, y0, x1, y1]. */
function boxOf(size, inset = 0) {
  return [inset, inset, size.w - inset, size.h - inset];
}

function inside(p, box) {
  return p[0] >= box[0] && p[0] <= box[2] && p[1] >= box[1] && p[1] <= box[3];
}

// Points on a shared boundary are computed from the same inputs by the same
// expression, so they are bit-identical and can be matched exactly. The fix is
// never a tolerance -- but a clipped endpoint arrives from two different
// segments, so this one compares within the printable resolution rather than
// pretending otherwise.
function same(a, b) {
  return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
}

module.exports = { poly, stroke, fill, clipSegment, clipPolyline, boxOf };
