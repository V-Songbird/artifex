// Geometry on polylines: measurement, intersections, offsets and construction.
// Segment and point-in-polygon decisions use exact orientation predicates.
// Triangulation, Delaunay and Voronoi live in mesh.js; polygon booleans and
// offsets that merge where they meet live in clip.js.
//
// Nothing here knows what kind of art a piece makes.

'use strict';

const { orient2d } = require('./robust-predicates.js');

/**
 * Exact orientation of c against the directed line a -> b: its sign is never
 * wrong, however close to collinear the points are. Coordinates past 2^500 are
 * first divided by one power of two, which is exact, so the products cannot overflow.
 */
function orient(a, b, c) {
  const big = Math.max(Math.abs(a[0]), Math.abs(a[1]), Math.abs(b[0]), Math.abs(b[1]), Math.abs(c[0]), Math.abs(c[1]));
  if (big <= 2 ** 500) return orient2d(a[0], a[1], b[0], b[1], c[0], c[1]);
  const k = 2 ** 524;
  return orient2d(a[0] / k, a[1] / k, b[0] / k, b[1] / k, c[0] / k, c[1] / k);
}

function finitePoint(p) {
  if (!Array.isArray(p) || p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
    throw new TypeError('geometry: expected a finite [x, y] point');
  }
}

function difference(a, b) {
  const v = [a[0] - b[0], a[1] - b[1]];
  if (!v.every(Number.isFinite)) throw new RangeError('geometry: coordinate difference overflow');
  return v;
}

/** Closest point on the CLOSED segment a-b, its parameter t in [0, 1], and distance. */
function closestPointOnSegment(p, a, b) {
  for (const q of [p, a, b]) finitePoint(q);
  const [dx, dy] = difference(b, a);
  const [px, py] = difference(p, a);
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len)) throw new RangeError('geometry: segment length overflow');
  // Scale the two vectors separately before dot products. This also preserves
  // direction for subnormal segments whose hypot cannot represent their length.
  const scale = Math.max(Math.abs(dx), Math.abs(dy));
  const pScale = Math.max(Math.abs(px), Math.abs(py));
  const vx = scale === 0 ? 0 : dx / scale; const vy = scale === 0 ? 0 : dy / scale;
  const dot = pScale === 0 ? 0 : (px / pScale) * vx + (py / pScale) * vy;
  const ratio = pScale / scale;
  const projection = dot === 0 ? 0 : Number.isFinite(ratio)
    ? (dot / (vx * vx + vy * vy)) * ratio
    : ((dot * pScale) / scale) / (vx * vx + vy * vy);
  const t = Math.max(0, Math.min(1, projection));
  const point = t === 0 ? [...a] : t === 1 ? [...b]
    : [a[0] * (1 - t) + b[0] * t, a[1] * (1 - t) + b[1] * t];
  const distance = Math.hypot(p[0] - point[0], p[1] - point[1]);
  if (!Number.isFinite(distance)) throw new RangeError('geometry: distance overflow');
  return { point, t, distance };
}

/**
 * Closed segment intersection: null, { type: 'point', point }, or
 * { type: 'overlap', points: [start, end] }, ordered along a-b.
 * Endpoints and zero-length segments count. No snapping tolerance is applied.
 * Whether the segments meet, touch or overlap is decided by exact predicates;
 * an endpoint lying on the other segment is returned as that endpoint, and only
 * a proper crossing's point is computed in double arithmetic.
 */
function segmentIntersection(a, b, c, d) {
  for (const p of [a, b, c, d]) finitePoint(p);
  const r = difference(b, a);
  const s = difference(d, c);
  const q = difference(c, a);
  const magnitude = Math.max(...r.map(Math.abs), ...s.map(Math.abs), ...q.map(Math.abs));
  const hit = (point) => ({ type: 'point', point: [...point] });
  if (magnitude === 0) return hit(a);
  // A binary scale preserves representable differences. Dividing by an
  // arbitrary length can turn exactly collinear integer vectors into a cross.
  const scale = 2 ** Math.min(1023, Math.floor(Math.log2(magnitude)));
  const [rx, ry] = r.map((v) => v / scale);
  const [sx, sy] = s.map((v) => v / scale);
  const [qx, qy] = q.map((v) => v / scale);
  const cross = (x, y, u, v) => x * v - y * u;
  const within = (p, u, v) => p[0] >= Math.min(u[0], v[0]) && p[0] <= Math.max(u[0], v[0])
    && p[1] >= Math.min(u[1], v[1]) && p[1] <= Math.max(u[1], v[1]);
  if (r[0] === 0 && r[1] === 0) {
    return orient(c, d, a) === 0 && within(a, c, d) ? hit(a) : null;
  }
  if (s[0] === 0 && s[1] === 0) {
    return orient(a, b, c) === 0 && within(c, a, b) ? hit(c) : null;
  }
  const oc = orient(a, b, c);
  const od = orient(a, b, d);
  const oa = orient(c, d, a);
  const ob = orient(c, d, b);
  if (oc === 0 && od === 0) {
    // Overlap boundaries are input endpoints, so preserve their coordinates.
    const axis = Math.abs(r[0]) >= Math.abs(r[1]) ? 0 : 1;
    const ends = [a, b, c, d].filter((p) => within(p, a, b) && within(p, c, d))
      .sort((p, v) => r[axis] > 0 ? p[axis] - v[axis] : v[axis] - p[axis]);
    if (!ends.length) return null;
    const start = ends[0]; const end = ends[ends.length - 1];
    if (start[0] === end[0] && start[1] === end[1]) return hit(start);
    return { type: 'overlap', points: [[...start], [...end]] };
  }
  if ((oc > 0 && od > 0) || (oc < 0 && od < 0) || (oa > 0 && ob > 0) || (oa < 0 && ob < 0)) return null;
  // They meet. An endpoint on the other segment is the meeting point exactly.
  if (oa === 0) return hit(a);
  if (ob === 0) return hit(b);
  if (oc === 0) return hit(c);
  if (od === 0) return hit(d);
  // A proper crossing: rounding may put t a hair outside [0, 1], never more.
  const t = Math.max(0, Math.min(1, cross(qx, qy, sx, sy) / cross(rx, ry, sx, sy)));
  return hit([a[0] * (1 - t) + b[0] * t, a[1] * (1 - t) + b[1] * t]);
}

/**
 * Offset an OPEN polyline along its left normal (-dy, dx).
 * Miter joins fall back to bevels beyond miterLimit * abs(distance); butt ends.
 * Consecutive duplicate points collapse. Empty/singleton inputs are copied.
 * Reversals bevel; self-intersections are retained, not trimmed into polygons.
 * For an outline that merges where it meets, use offset in core/clip.js.
 *
 * The third argument is `miterLimit`, or `{ miterLimit, clean }`. Where the
 * line bends tighter than the offset on its inner side, the offset runs
 * backwards and draws a loop. `clean: true` drops every offset point that
 * steps against the way the source runs there, so such a bend gives a plain
 * corner; the two end points are always kept.
 */
function offsetPolyline(pts, distance, limit = 4) {
  const { miterLimit = 4, clean = false } = typeof limit === 'object' && limit !== null ? limit : { miterLimit: limit };
  if (typeof clean !== 'boolean') throw new TypeError('offsetPolyline: clean must be true or false');
  if (!Number.isFinite(distance)) throw new TypeError('offsetPolyline: distance must be finite');
  if (!Number.isFinite(miterLimit) || miterLimit < 1) throw new RangeError('offsetPolyline: miterLimit must be finite and at least 1');
  const src = [];
  for (const p of pts) {
    finitePoint(p);
    const prev = src[src.length - 1];
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) src.push([...p]);
  }
  if (src.length < 2 || distance === 0) return src;
  const normals = [];
  for (let i = 1; i < src.length; i++) {
    const [dx, dy] = difference(src[i], src[i - 1]);
    const scale = Math.max(Math.abs(dx), Math.abs(dy));
    const ux = dx / scale; const uy = dy / scale;
    const len = Math.hypot(ux, uy);
    normals.push([-uy / len, ux / len]);
  }
  const out = [], runs = [];
  let segment = 0;
  const append = (p, nx, ny, amount) => {
    const v = [p[0] + nx * amount, p[1] + ny * amount];
    if (!v.every(Number.isFinite)) throw new RangeError('offsetPolyline: offset overflow');
    out.push(v);
    runs.push(segment);
  };
  append(src[0], ...normals[0], distance);
  for (let i = 1; i < src.length - 1; i++) {
    segment = i - 1;
    const a = normals[i - 1]; const b = normals[i];
    const mx = a[0] + b[0]; const my = a[1] + b[1];
    const len = Math.hypot(mx, my);
    // |n0+n1| = 2*cos(turn/2), stable even near a reversal.
    const ratio = len === 0 ? Infinity : 2 / len;
    if (ratio <= miterLimit) {
      append(src[i], mx / len, my / len, distance * ratio);
    } else {
      append(src[i], ...a, distance);
      append(src[i], ...b, distance);
    }
  }
  segment = normals.length - 1;
  append(src[src.length - 1], ...normals[normals.length - 1], distance);
  if (!clean) return out;
  // A normal turned a quarter back is the way its source segment runs.
  const kept = [out[0]];
  for (let k = 1; k < out.length - 1; k++) {
    const [nx, ny] = normals[runs[k]], last = kept[kept.length - 1];
    if ((out[k][0] - last[0]) * ny - (out[k][1] - last[1]) * nx > 0) kept.push(out[k]);
  }
  kept.push(out[out.length - 1]);
  return kept;
}

/** Arc length of a polyline. `close` counts the closing edge. */
function lengthOf(pts, close = false) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (close && pts.length > 2) {
    d += Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]);
  }
  return d;
}

/** Axis-aligned bounds of a point set, as [x0, y0, x1, y1]. Empty set throws. */
function bbox(pts) {
  if (!pts || pts.length === 0) throw new Error('bbox: needs at least one point');
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  }
  return [x0, y0, x1, y1];
}

/**
 * The AREA centroid of a closed polygon.
 *
 * A TRAP, NOT A CONVENIENCE. Averaging the vertices is not the centroid of the
 * shape, it is the centroid of the vertex list -- so a run of closely-spaced
 * points along one edge drags the answer towards that edge. Every polygon that
 * came out of a resampler, a contour tracer or a smoothing pass has exactly that
 * property, which is to say: almost every polygon in generative work.
 *
 * Falls back to the vertex mean only when the area is zero, because a degenerate
 * polygon has no area centroid and returning NaN would propagate silently.
 */
function centroid(pts) {
  if (!pts || pts.length === 0) throw new Error('centroid: needs at least one point');
  let a = 0; let cx = 0; let cy = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const w = pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    a += w;
    cx += (pts[j][0] + pts[i][0]) * w;
    cy += (pts[j][1] + pts[i][1]) * w;
  }
  if (a === 0) {
    let mx = 0; let my = 0;
    for (const p of pts) { mx += p[0]; my += p[1]; }
    return [mx / pts.length, my / pts.length];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/**
 * Is a point inside a closed polygon? Ray crossing, odd winding. Which side of
 * an edge the point lies on is decided exactly, so a point a few ulps off an
 * edge gets the right answer.
 *
 * Points exactly on the boundary are not promised either answer -- a boundary
 * test wants a distance, not a predicate, and pretending otherwise is how a
 * tiling grows a one-pixel seam that only shows up in print.
 */
function pointInPoly(p, pts) {
  const y = p[1];
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const yi = pts[i][1];
    const yj = pts[j][1];
    if ((yi > y) !== (yj > y)) {
      // Left of the edge walked upward is left of where it crosses the ray's row.
      const [lo, up] = yi > y ? [pts[j], pts[i]] : [pts[i], pts[j]];
      if (orient(lo, up, p) < 0) hit = !hit;
    }
  }
  return hit;
}

/**
 * Resample a polyline to points spaced `spacing` apart along its own length.
 *
 * Even spacing is what lets a per-point effect -- a jitter, a taper, a dotted
 * treatment, a pen pressure -- be even on the paper rather than even in the
 * index. A flow line integrated with a fixed step is already even; a letter from
 * a stroke font, a traced contour, or anything a human placed is not, and
 * applying a per-point effect to it clumps the effect wherever the points clump.
 *
 * The LAST POINT IS ALWAYS KEPT, even when it falls short of a full spacing.
 * Dropping it shortens the mark, and a run of marks all shortened by a different
 * fraction of one step reads as a ragged edge that nothing in the piece asked
 * for. Straight runs are preserved exactly, because a two-point run resamples to
 * its own two endpoints and no curvature test is applied -- a T lost its
 * crossbar to a curvature-based resampler once, in this project.
 */
function resample(pts, spacing, close = false) {
  if (!(spacing > 0)) throw new Error(`resample: spacing must be positive, got ${spacing}`);
  const src = close && pts.length > 2 ? [...pts, pts[0]] : pts;
  if (src.length < 2) return src.map((p) => [p[0], p[1]]);
  const out = [[src[0][0], src[0][1]]];
  let carry = 0;
  for (let i = 1; i < src.length; i++) {
    const ax = src[i - 1][0]; const ay = src[i - 1][1];
    const bx = src[i][0]; const by = src[i][1];
    const seg = Math.hypot(bx - ax, by - ay);
    if (seg === 0) continue;
    let d = spacing - carry;
    while (d <= seg) {
      const t = d / seg;
      out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
      d += spacing;
    }
    carry = seg - (d - spacing);
  }
  const last = src[src.length - 1];
  const tail = out[out.length - 1];
  if (tail[0] !== last[0] || tail[1] !== last[1]) out.push([last[0], last[1]]);
  return out;
}

/**
 * Chaikin corner cutting. Each pass replaces every corner with two points at
 * 1/4 and 3/4 of its edges, so the polyline converges on a quadratic B-spline.
 *
 * Why this and not a spline fit: it needs no tangents, no parameterisation and
 * no special case at the ends, it cannot overshoot the hull the points make, and
 * it is the same operation on an open line and a closed ring. `n` passes
 * multiply the point count by roughly 2^n, so two or three is the useful range.
 *
 * An OPEN line keeps its first and last points exactly. That is what makes it
 * safe on anything that has to meet something else -- a contour clipped to a
 * box, a letter that joins the next letter, a road that reaches the edge.
 */
function chaikin(pts, passes = 1, close = false) {
  let cur = pts;
  for (let k = 0; k < passes; k++) {
    if (cur.length < 3) return cur.map((p) => [p[0], p[1]]);
    const out = [];
    if (!close) out.push([cur[0][0], cur[0][1]]);
    const n = close ? cur.length : cur.length - 1;
    for (let i = 0; i < n; i++) {
      const a = cur[i];
      const b = cur[(i + 1) % cur.length];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (!close) out.push([cur[cur.length - 1][0], cur[cur.length - 1][1]]);
    cur = out;
  }
  return cur;
}

/**
 * A uniform Catmull-Rom spline THROUGH the points, `samples` points per span.
 *
 * Why this and not chaikin: chaikin cuts every corner, so the smoothed line
 * passes about a quarter of the way inside each turn and misses anything seated
 * at it. This curve passes through every input point exactly -- input `i` is
 * output `i * samples`, copied, not computed -- so marks placed at the points
 * stay on the line. The price is that it swings outward past every turn, so it
 * leaves the hull of the points even when all spans are equal: most at a
 * right-angle turn, up to about an eighth of a span, and less at gentler or
 * sharper turns. Very uneven
 * span lengths can also make it loop or cusp. Use chaikin when the line must
 * stay inside the hull.
 *
 * `alpha` spaces the curve's knots by each span's length to that power: 0, the
 * default, is the uniform curve above; 0.5 is the centripetal one, which never
 * loops or cusps inside a span however uneven the spans are, and swings out
 * less past a turn between a long span and a short one; 1 follows the chord
 * lengths. Use 0.5 for points a hand, a tracer or a simulation placed unevenly.
 *
 * An OPEN line ends on its first and last points, with the end tangent taken
 * from the end span alone, and returns `(n - 1) * samples + 1` points. A CLOSED
 * ring returns `n * samples` points and does not repeat its first point at the
 * end. Fewer than two points (three for a ring) come back as a copy.
 */
function catmullRom(pts, samples = 8, close = false, { alpha = 0 } = {}) {
  if (!Number.isInteger(samples) || samples < 1) {
    throw new Error(`catmullRom: samples must be a positive integer, got ${samples}`);
  }
  knotPower('catmullRom', alpha);
  const n = pts.length;
  if (n < (close ? 3 : 2)) return pts.map((p) => [p[0], p[1]]);
  const at = close
    ? (i) => pts[(i + n) % n]
    : (i) => pts[Math.min(n - 1, Math.max(0, i))];
  const spans = close ? n : n - 1;
  const out = [];
  for (let i = 0; i < spans; i++) {
    const p0 = at(i - 1); const p1 = at(i); const p2 = at(i + 1); const p3 = at(i + 2);
    out.push([p1[0], p1[1]]);
    const [b1, b2] = alpha === 0 ? [] : spanControls(p0, p1, p2, p3, alpha);
    for (let k = 1; k < samples; k++) {
      const t = k / samples; const t2 = t * t; const t3 = t2 * t;
      if (alpha !== 0) {
        // The span as the cubic Bézier it equals, from p1 to p2.
        const u = 1 - t; const a = u * u * u; const b = 3 * u * u * t; const c = 3 * u * t2;
        out.push([a * p1[0] + b * b1[0] + c * b2[0] + t3 * p2[0], a * p1[1] + b * b1[1] + c * b2[1] + t3 * p2[1]]);
        continue;
      }
      const a = (-t3 + 2 * t2 - t) / 2;
      const b = (3 * t3 - 5 * t2 + 2) / 2;
      const c = (-3 * t3 + 4 * t2 + t) / 2;
      const d = (t3 - t2) / 2;
      out.push([
        a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
        a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
      ]);
    }
  }
  if (!close) out.push([pts[n - 1][0], pts[n - 1][1]]);
  return out;
}

/**
 * Bézier segments sampled into a polyline whose steps are about `spacing`
 * long, ready for `outline` and `fill` in core/path.js.
 *
 * `path` is a start point followed by segments. Each segment holds the points a
 * canvas call takes after the pen: `[end]` is a straight line, `[control, end]`
 * a quadratic and `[control1, control2, end]` a cubic. Every segment's end is
 * copied exactly into the result, so where two segments meet at an angle the
 * corner stays sharp. Between its ends a segment is cut into the fewest equal
 * steps along its length that keep each step within `spacing`, so no short
 * stub is left before a corner. Step lengths are measured on a polyline eight
 * times finer than `spacing`, which runs slightly shorter than the curve, so a
 * step can come out a small fraction of a percent over `spacing`; the points
 * themselves lie on the curve.
 *
 * `close` adds a straight segment back to the start when the last segment ends
 * elsewhere, and the result does not repeat its first point, which is how
 * `outline(pts, width, { closed: true })` takes a loop. A segment of zero length
 * adds nothing. An empty path returns an empty array.
 */
function bezier(path, spacing, close = false) {
  if (!(spacing > 0)) throw new Error(`bezier: spacing must be positive, got ${spacing}`);
  if (!path.length) return [];
  finitePoint(path[0]);
  const segs = path.slice(1);
  segs.forEach((s, i) => {
    if (!Array.isArray(s) || s.length < 1 || s.length > 3) {
      throw new TypeError(`bezier: segment ${i + 1} must hold 1 to 3 points: end, control and end, or two controls and end`);
    }
    s.forEach(finitePoint);
  });
  const start = path[0];
  const out = [[start[0], start[1]]];
  if (close && segs.length) {
    const end = segs[segs.length - 1][segs[segs.length - 1].length - 1];
    if (end[0] !== start[0] || end[1] !== start[1]) segs.push([start]);
  }
  let from = start;
  for (const s of segs) {
    const c = [from, ...s];
    from = s[s.length - 1];
    // A quadratic as the cubic it equals, so one formula samples both curves.
    // A line is interpolated directly, so a straight run stays exactly straight.
    const [p0, p1, p2, p3] = c.length === 3
      ? [c[0], lerp2(c[0], c[1], 2 / 3), lerp2(c[2], c[1], 2 / 3), c[2]]
      : [c[0], c[1], c[2], c[c.length - 1]];
    const at = c.length === 2 ? (t) => lerp2(p0, p3, t) : (t) => {
      const u = 1 - t; const a = u * u * u; const b = 3 * u * u * t; const d = 3 * u * t * t; const e = t * t * t;
      return [a * p0[0] + b * p1[0] + d * p2[0] + e * p3[0], a * p0[1] + b * p1[1] + d * p2[1] + e * p3[1]];
    };
    // The control polygon is never shorter than the curve, so this bounds every fine step.
    let hull = 0;
    for (let i = 1; i < c.length; i++) hull += Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]);
    if (!Number.isFinite(hull)) throw new RangeError('bezier: segment length overflow');
    if (hull === 0) continue;
    const m = c.length === 2 ? 1 : Math.max(16, Math.ceil((8 * hull) / spacing));
    const run = [0];
    let prev = p0;
    for (let k = 1; k <= m; k++) {
      const q = k === m ? p3 : at(k / m);
      run.push(run[k - 1] + Math.hypot(q[0] - prev[0], q[1] - prev[1]));
      prev = q;
    }
    const total = run[m];
    if (total === 0) continue;
    const steps = Math.ceil(total / spacing);
    for (let k = 1, j = 0; k < steps; k++) {
      const target = (total * k) / steps;
      while (run[j + 1] < target) j++;
      out.push(at((j + (target - run[j]) / (run[j + 1] - run[j])) / m));
    }
    out.push([p3[0], p3[1]]);
  }
  const last = out[out.length - 1];
  if (close && out.length > 1 && last[0] === start[0] && last[1] === start[1]) out.pop();
  return out;
}

function lerp2(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function knotPower(who, alpha) {
  if (!(typeof alpha === 'number' && alpha >= 0 && alpha <= 1)) throw new RangeError(`${who}: alpha must be from 0 to 1, got ${alpha}`);
}

// The two inner Bézier controls of the Catmull-Rom span from p1 to p2 whose
// knots are spaced by each chord's length to the power `alpha`. A neighbour
// that sits on its end of the span, as at an open line's end or a corner,
// takes the span's own spacing, so the tangent there comes from the span alone.
function spanControls(p0, p1, p2, p3, alpha) {
  const gap = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]) ** alpha;
  const d2 = gap(p1, p2);
  if (!(d2 > 0)) return [[p1[0], p1[1]], [p2[0], p2[1]]];
  // The control beside `b` on its span to `c`, with `a` the neighbour past `b`, `da` away.
  const beside = (a, b, c, da) => {
    const k = 3 * da * (da + d2);
    return [0, 1].map((i) => (da * da * c[i] - d2 * d2 * a[i] + (2 * da * da + 3 * da * d2 + d2 * d2) * b[i]) / k);
  };
  return [beside(p0, p1, p2, gap(p0, p1) || d2), beside(p3, p2, p1, gap(p2, p3) || d2)];
}

/**
 * A Catmull-Rom spline through `pts` with chosen points left as corners,
 * sampled as `bezier` samples, every step about `spacing` long.
 *
 * `corners` lists indices of points where the line turns sharply instead of
 * rounding. A span that leaves or reaches a corner takes its tangent there from
 * itself alone, as `catmullRom` does at an open line's two ends, so one list of
 * points can hold both smooth turns and sharp ones. Without corners the curve is
 * the one `catmullRom` draws through the same points. Every input point is
 * copied exactly into the result; a span is cut into the fewest equal steps that
 * keep each within `spacing`, measured as `bezier` measures them.
 *
 * `close` joins the last point back to the first with one more span, and the
 * result does not repeat its first point. Fewer than two points (three for a
 * ring) come back as a copy. `alpha` spaces the knots as `catmullRom`'s does:
 * 0.5 keeps unevenly spaced points from looping or cusping.
 */
function spline(pts, spacing, { corners = [], close = false, alpha = 0 } = {}) {
  if (!(spacing > 0)) throw new Error(`spline: spacing must be positive, got ${spacing}`);
  knotPower('spline', alpha);
  pts.forEach(finitePoint);
  const n = pts.length;
  const sharp = new Set();
  for (const i of corners) {
    if (!Number.isInteger(i) || i < 0 || i >= n) throw new RangeError(`spline: corner ${i} is not an index of the ${n} points`);
    sharp.add(i);
  }
  if (n < (close ? 3 : 2)) return pts.map((p) => [p[0], p[1]]);
  const at = (i) => pts[(i + n) % n];
  const path = [pts[0]];
  for (let i = 0; i < (close ? n : n - 1); i++) {
    const p1 = at(i); const p2 = at(i + 1);
    const p0 = sharp.has(i) || (!close && i === 0) ? p1 : at(i - 1);
    const p3 = sharp.has((i + 1) % n) || (!close && i === n - 2) ? p2 : at(i + 2);
    if (alpha !== 0) { path.push([...spanControls(p0, p1, p2, p3, alpha), p2]); continue; }
    path.push([
      [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6],
      [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6],
      p2,
    ]);
  }
  return bezier(path, spacing, close);
}

/**
 * The few cubic Béziers that pass within `tolerance` of every point of a
 * sampled line, as a path `bezier` takes: a start point, then one
 * `[control1, control2, end]` per curve. A stroke that was traced, recorded or
 * simulated carries the jitter of its samples; dropping points leaves a line of
 * straight runs with a bend at each kept point, while this keeps the stroke
 * smooth through all of them and `bezier(fitBezier(pts, tolerance), spacing)`
 * draws it clean at any step.
 *
 * Each curve is a least-squares fit to its run of points, placed along it by
 * chord length and moved a few times to where the curve passes nearest; a run
 * the curve still misses by more than `tolerance` is cut at its worst point and
 * each half fitted again, the two sharing their direction at the cut so the
 * join stays smooth. A larger tolerance gives fewer, smoother curves, and one
 * near the samples' jitter gives the cleanest line. `corners` lists indices of
 * points where the line turns sharply: the curves on each side end there
 * exactly, each with its own direction.
 *
 * The path starts on the first point and ends on the last, exactly. One point
 * comes back as a path of that point, and no points as an empty path.
 */
function fitBezier(pts, tolerance, { corners = [] } = {}) {
  if (!(tolerance > 0)) throw new Error(`fitBezier: tolerance must be positive, got ${tolerance}`);
  pts.forEach(finitePoint);
  const n = pts.length;
  const cuts = new Set([0, n - 1]);
  for (const i of corners) {
    if (!Number.isInteger(i) || i < 0 || i >= n) throw new RangeError(`fitBezier: corner ${i} is not an index of the ${n} points`);
    cuts.add(i);
  }
  if (n === 0) return [];
  const path = [[pts[0][0], pts[0][1]]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  const unit = (v) => { const l = Math.hypot(v[0], v[1]); return l > 0 ? [v[0] / l, v[1] / l] : [0, 0]; };
  // The direction the line leaves point `i` in, towards `step`: to the nearest point that is not on it.
  const leaving = (i, step, stop) => {
    for (let j = i + step; j !== stop + step; j += step) if (pts[j][0] !== pts[i][0] || pts[j][1] !== pts[i][1]) return unit(sub(pts[j], pts[i]));
    return [0, 0];
  };
  const curve = (c, t) => {
    const u = 1 - t; const k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    return [k[0] * c[0][0] + k[1] * c[1][0] + k[2] * c[2][0] + k[3] * c[3][0], k[0] * c[0][1] + k[1] * c[1][1] + k[2] * c[2][1] + k[3] * c[3][1]];
  };
  const fit = (first, last, t1, t2) => {
    const [p0, p3] = [pts[first], pts[last]];
    const chord = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
    const thirds = () => [p0, [p0[0] + (t1[0] * chord) / 3, p0[1] + (t1[1] * chord) / 3], [p3[0] + (t2[0] * chord) / 3, p3[1] + (t2[1] * chord) / 3], p3];
    const done = (c) => path.push([c[1], c[2], [p3[0], p3[1]]]);
    if (last - first === 1) return done(thirds());
    // Where each point sits along the run, by chord length, 0 to 1.
    let u = [0];
    for (let i = first + 1; i <= last; i++) u.push(u[u.length - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = u[u.length - 1];
    if (total === 0) return done(thirds());
    u = u.map((v) => v / total);
    // The control distances along the two end directions that bring the curve nearest the points.
    const solve = () => {
      let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
      u.forEach((t, i) => {
        const s = 1 - t; const b1 = 3 * s * s * t; const b2 = 3 * s * t * t;
        const [a1, a2] = [[t1[0] * b1, t1[1] * b1], [t2[0] * b2, t2[1] * b2]];
        const near = s * s * s + b1; const far = b2 + t * t * t;
        const rest = [pts[first + i][0] - (p0[0] * near + p3[0] * far), pts[first + i][1] - (p0[1] * near + p3[1] * far)];
        c00 += dot(a1, a1); c01 += dot(a1, a2); c11 += dot(a2, a2); x0 += dot(a1, rest); x1 += dot(a2, rest);
      });
      const det = c00 * c11 - c01 * c01;
      const [l, r] = det === 0 ? [0, 0] : [(x0 * c11 - x1 * c01) / det, (c00 * x1 - c01 * x0) / det];
      // A distance at or under zero would turn the curve back on its end: use a third of the chord.
      if (!(l > 1e-6 * chord && r > 1e-6 * chord)) return thirds();
      return [p0, [p0[0] + t1[0] * l, p0[1] + t1[1] * l], [p3[0] + t2[0] * r, p3[1] + t2[1] * r], p3];
    };
    const worst = (c) => {
      let far = 0, at = Math.floor((last - first + 1) / 2);
      u.forEach((t, i) => {
        const q = curve(c, t); const d = (q[0] - pts[first + i][0]) ** 2 + (q[1] - pts[first + i][1]) ** 2;
        if (d > far) { far = d; at = i; }
      });
      return { far, at: first + Math.min(Math.max(at, 1), last - first - 1) };
    };
    let c = solve();
    let miss = worst(c);
    // Close enough to be worth moving the points along the curve: one Newton step each, up to four times.
    for (let pass = 0; pass < 4 && miss.far > tolerance * tolerance && miss.far < 16 * tolerance * tolerance; pass++) {
      const d1 = [0, 1, 2].map((k) => [3 * (c[k + 1][0] - c[k][0]), 3 * (c[k + 1][1] - c[k][1])]);
      const d2 = [0, 1].map((k) => [2 * (d1[k + 1][0] - d1[k][0]), 2 * (d1[k + 1][1] - d1[k][1])]);
      u = u.map((t, i) => {
        const s = 1 - t;
        const off = sub(curve(c, t), pts[first + i]);
        const v = [s * s * d1[0][0] + 2 * s * t * d1[1][0] + t * t * d1[2][0], s * s * d1[0][1] + 2 * s * t * d1[1][1] + t * t * d1[2][1]];
        const a = [s * d2[0][0] + t * d2[1][0], s * d2[0][1] + t * d2[1][1]];
        const under = dot(v, v) + dot(off, a);
        return under === 0 ? t : Math.min(1, Math.max(0, t - dot(off, v) / under));
      });
      c = solve();
      miss = worst(c);
    }
    if (miss.far <= tolerance * tolerance) return done(c);
    // Cut at the worst point; both halves leave it along one line, so the join is smooth.
    let through = unit(sub(pts[miss.at - 1], pts[miss.at + 1]));
    if (through[0] === 0 && through[1] === 0) through = leaving(miss.at, -1, first);
    // The later half waits under the earlier one, so the curves come out in order.
    return todo.push([miss.at, last, [-through[0], -through[1]], t2], [first, miss.at, t1, through]);
  };
  // A list of runs still to fit, not a function that calls itself: a line that
  // is cut one point at a time would otherwise nest as deep as it is long.
  const todo = [];
  const ends = [...cuts].sort((a, b) => a - b);
  for (let k = ends.length - 1; k > 0; k--) todo.push([ends[k - 1], ends[k], leaving(ends[k - 1], 1, ends[k]), leaving(ends[k], -1, ends[k - 1])]);
  while (todo.length) fit(...todo.pop());
  return path;
}

/**
 * Join loose segments end to end into as few polylines as possible.
 *
 * THIS IS WHAT A PLOTTER PAYS FOR. Lifting the pen, travelling and putting it
 * down again is the slow, noisy, inaccurate part of a plot, and a contour tracer
 * or a boundary walk hands back its output as thousands of unordered two-point
 * segments. Chaining them is the difference between a plot that takes four
 * minutes and one that takes forty.
 *
 * MATCHED EXACTLY, NOT WITHIN A TOLERANCE. Two segments that share a cell edge
 * have that endpoint computed from the same inputs by the same expression, so
 * the two copies are bit-identical. The index is therefore keyed on the
 * coordinate itself: a Map compares keys by SameValueZero, which makes -0 and 0
 * the same key without anyone having to remember that they are not the same
 * string. Rounding the key to six places, as this project did while the code
 * lived in an example, is a tolerance in disguise -- it cannot separate two
 * genuinely distinct endpoints a millionth apart, and it cost a `toFixed` on
 * every coordinate to do it.
 *
 * Keyed two levels deep rather than on `x + ',' + y`, because building that key
 * allocates a string per lookup, and there are two lookups per segment per pass.
 */
function chain(segs) {
  const at = new Map();
  const used = new Array(segs.length).fill(false);

  const bucket = (p) => {
    let inner = at.get(p[0]);
    if (inner === undefined) { inner = new Map(); at.set(p[0], inner); }
    let list = inner.get(p[1]);
    if (list === undefined) { list = []; inner.set(p[1], list); }
    return list;
  };
  const lookup = (p) => {
    const inner = at.get(p[0]);
    return inner === undefined ? undefined : inner.get(p[1]);
  };
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];

  for (let i = 0; i < segs.length; i++) {
    bucket(segs[i][0]).push(i);
    bucket(segs[i][segs[i].length - 1]).push(i);
  }

  // The next unused segment touching `p`, returned as the point it leads to.
  const step = (p) => {
    const list = lookup(p);
    if (list === undefined) return null;
    for (const i of list) {
      if (used[i]) continue;
      const s = segs[i];
      const head = same(s[0], p);
      if (!head && !same(s[s.length - 1], p)) continue;
      used[i] = true;
      return head ? s.slice(1) : s.slice(0, -1).reverse();
    }
    return null;
  };

  const paths = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const pts = segs[i].slice();

    for (let more = step(pts[pts.length - 1]); more; more = step(pts[pts.length - 1])) {
      for (const q of more) pts.push(q);
      if (same(pts[pts.length - 1], pts[0])) break;              // closed
    }

    // Growing backwards with unshift is O(n) per point and O(n^2) per path, and
    // a traced contour is thousands of points. The far end is collected
    // forwards, then reversed and joined once.
    if (!same(pts[0], pts[pts.length - 1])) {
      const front = [];
      let head = pts[0];
      for (let more = step(head); more; more = step(head)) {
        for (const q of more) front.push(q);
        head = more[more.length - 1];
        if (same(head, pts[pts.length - 1])) break;              // closed the long way
      }
      if (front.length) { front.reverse(); paths.push(front.concat(pts)); continue; }
    }
    paths.push(pts);
  }
  return paths;
}

/**
 * A closed irregular ring: a circle whose radius is modulated by a function of
 * the angle. `radiusAt(angle, i, n)` returns the radius for that spoke.
 *
 * This constructor takes its shape from the radius function: a noise field
 * makes an organic blob,
 * hand it a step function and it is a gear, hand it a constant and it is a
 * circle drawn the slow way.
 */
function ring(cx, cy, n, radiusAt, rot = 0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    const r = radiusAt(a, i, n);
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

/**
 * A closed outline around a polyline, at a half-width given per point.
 *
 * Up one side on the left normal and back down the other, which is how a stroke
 * of varying weight becomes a FILLABLE SHAPE. A plotter cannot vary a pen's
 * width and a vector file has one stroke-width per path, so a tapered mark has
 * to be an outline or it is not a tapered mark.
 *
 * `widthAt(i, n)` is the half-width at point `i`. Ends are not capped: the
 * caller decides, because a nib, a brush and a cut edge end differently.
 *
 * It thins a line at a sharp turn; use `outline()` in `core/path.js` for a plain
 * variable-width fill (see `skills/artifex/reference/geometry-fields.md`).
 */
function ribbon(pts, widthAt) {
  if (pts.length < 2) throw new Error('ribbon: needs at least two points');
  const left = [];
  const right = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const w = widthAt(i, pts.length);
    const nx = (-dy / len) * w;
    const ny = (dx / len) * w;
    left.push([pts[i][0] + nx, pts[i][1] + ny]);
    right.push([pts[i][0] - nx, pts[i][1] - ny]);
  }
  right.reverse();
  return left.concat(right);
}

// Two or more key outlines, every one with the same point count; returns it.
function keyList(name, keys, least) {
  if (!Array.isArray(keys) || keys.length < 2) {
    throw new TypeError(`${name}: needs at least two key outlines, got ${Array.isArray(keys) ? keys.length : keys}`);
  }
  const n = Array.isArray(keys[0]) ? keys[0].length : 0;
  if (n < least) throw new RangeError(`${name}: needs at least ${least} points in each key, got ${n}`);
  keys.forEach((key, k) => {
    const len = Array.isArray(key) ? key.length : 'no';
    if (len !== n) throw new RangeError(`${name}: key ${k} has ${len} points, key 0 has ${n}; trace every key with the same points in the same order`);
    key.forEach((p, i) => {
      if (!Array.isArray(p) || p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
        throw new TypeError(`${name}: key ${k} point ${i} must be a finite [x, y], got ${Array.isArray(p) ? `[${p.join(', ')}]` : p}`);
      }
    });
  });
  return n;
}

/**
 * The outline at track value `v` between key outlines traced with the same
 * points in the same order: the floor of the value picks the pair of keys, the
 * fraction blends them point by point. Each key comes back exactly on its whole
 * value, and a value outside 0 .. keys.length - 1 holds the nearer end key.
 *
 * With `weights`, `v` is an array of track values and `weights` holds one row
 * per point, one non-negative number per track value with a positive sum: point
 * `i` reads the weighted mean of the values. Rows that ease from one track to
 * the next across neighbouring points keep the outline from kinking there.
 * Returns new points; the keys are not changed.
 */
function keyOutline(keys, v, weights) {
  const n = keyList('keyOutline', keys, 1);
  let values = null;
  if (weights === undefined) {
    if (!Number.isFinite(v)) {
      throw new TypeError(Array.isArray(v) ? 'keyOutline: an array of track values needs weights, one row per point'
        : `keyOutline: v must be a finite number, got ${v}`);
    }
  } else {
    if (!Array.isArray(v) || !v.length || !v.every(Number.isFinite)) {
      throw new TypeError(`keyOutline: with weights, v must be an array of finite track values, got ${v}`);
    }
    if (!Array.isArray(weights) || weights.length !== n) {
      throw new RangeError(`keyOutline: weights has ${Array.isArray(weights) ? weights.length : weights} rows for ${n} points`);
    }
    values = weights.map((row, i) => {
      const fine = Array.isArray(row) && row.length === v.length && row.every((w) => Number.isFinite(w) && w >= 0);
      const sum = fine ? row.reduce((s, w) => s + w, 0) : 0;
      if (!(sum > 0) || !Number.isFinite(sum)) {
        throw new RangeError(`keyOutline: weights row ${i} must hold ${v.length} non-negative numbers with a positive sum`);
      }
      return row.reduce((s, w, j) => s + w * v[j], 0) / sum;
    });
  }
  const last = keys.length - 1;
  return keys[0].map((_, i) => {
    const value = Math.max(0, Math.min(last, values ? values[i] : v));
    const k = Math.min(Math.floor(value), last - 1);
    const u = value - k;
    const a = keys[k][i]; const b = keys[k + 1][i];
    return [a[0] * (1 - u) + b[0] * u, a[1] * (1 - u) + b[1] * u];
  });
}

/**
 * Faults in moving through key outlines: an outline that crosses itself, and a
 * span that stretches or shrinks past `ratio` between two keys.
 *
 * Samples `keyOutline(keys, s / steps)` for every s from 0 to
 * (keys.length - 1) * steps, so the default of 2 looks at each key and each
 * blend's middle. Span `i` joins point `i` to the next; `close` adds the span
 * from the last point to the first. Returns, in sample order, every
 * `{ type: 'cross', at, spans: [i, j], point }` where two spans that share no
 * point meet, then every `{ type: 'stretch', at: [k, k + 1], span, ratio }`
 * whose longest length over the samples of keys k to k + 1 is above `ratio`
 * times its shortest; [] when there are none. A crossing between samples is
 * missed: raise `steps` to look finer. The cost is O(points^2) per sample, so
 * run it in a test or a build stage, never in draw.
 */
function keyFaults(keys, { ratio, steps = 2, close = true } = {}) {
  if (!Number.isFinite(ratio) || ratio <= 1) throw new RangeError(`keyFaults: ratio must be a finite number above 1, got ${ratio}`);
  if (!Number.isInteger(steps) || steps < 1) throw new RangeError(`keyFaults: steps must be a positive integer, got ${steps}`);
  const n = keyList('keyFaults', keys, close ? 3 : 2);
  const spans = close ? n : n - 1;
  const crosses = []; const lengths = [];
  for (let s = 0; s <= (keys.length - 1) * steps; s++) {
    const at = s / steps;
    const pts = keyOutline(keys, at);
    const tip = (i) => pts[(i + 1) % n];
    lengths.push(pts.slice(0, spans).map((p, i) => Math.hypot(tip(i)[0] - p[0], tip(i)[1] - p[1])));
    for (let i = 0; i < spans; i++) {
      for (let j = i + 2; j < spans; j++) {
        if (close && i === 0 && j === n - 1) continue;
        const meet = segmentIntersection(pts[i], tip(i), pts[j], tip(j));
        if (meet) crosses.push({ type: 'cross', at, spans: [i, j], point: meet.point || meet.points[0] });
      }
    }
  }
  const stretches = [];
  for (let k = 0; k < keys.length - 1; k++) {
    const run = lengths.slice(k * steps, (k + 1) * steps + 1);
    for (let i = 0; i < spans; i++) {
      const most = Math.max(...run.map((l) => l[i])); const least = Math.min(...run.map((l) => l[i]));
      if (most > ratio * least) stretches.push({ type: 'stretch', at: [k, k + 1], span: i, ratio: most / least });
    }
  }
  return crosses.concat(stretches);
}

module.exports = {
  closestPointOnSegment, segmentIntersection, offsetPolyline,
  lengthOf, bbox, centroid, pointInPoly,
  resample, chaikin, catmullRom, bezier, spline, fitBezier, chain,
  ring, ribbon, keyOutline, keyFaults,
};
