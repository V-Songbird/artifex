// Geometry on polylines. The operations every author writes and nobody ships.
//
// WHY THIS EXISTS, AND WHY THE EVIDENCE IS NOT OUR OWN EXAMPLES. N4 says a core
// module reached by one kind of art is a preset wearing a core module's clothes,
// and it derives "one kind of art" from the five examples in this repository --
// which were written to demonstrate five idioms and therefore reach exactly as
// far as we had already imagined. That population is too narrow to license a
// module and too narrow to refuse one.
//
// The population that licensed this file is in docs/knowledge/imported-sources.md §7:
// a 1.1 MB body of finished work by someone who has never seen this project
// defines, before it draws anything at all, `resample chaikin bbox pip centroid
// blob rotPts arcPts polyPts starPts ribbon`. Five field-test authors handed
// this library cold each wrote a subset of the same list. And
// docs/tasks/field-test-findings.md §10 has carried "offsetting, intersections,
// point-in-polygon, area" as an open gap since the field test.
//
// Three independent populations, one list. That is the evidence.
//
// WHAT IS NOT HERE. Boolean operations and true polygon offsetting: both need a
// robust intersection kernel, both are large, and neither has been asked for by
// any of the three populations. When one asks, it gets written properly rather
// than approximated here.
//
// ONE HAS NOW ASKED. `Code as Creative Medium` (Levin & Brain, MIT Press 2021)
// collects the assignments of hundreds of educators across thirty years, and its
// Geometry exercises name a polyline offset by a fixed distance, the
// intersection of two line segments, and the shortest distance from a point to a
// line. That is a fourth population, and the third to name offsetting. See
// docs/knowledge/imported-sources.md §12.1. The paragraph above stands as the standard
// -- written properly, not approximated -- but it is no longer waiting.
//
// WHAT WAS CUT, AND WHY. A first pass also shipped `area`, `polyPts`,
// `starPts`, `arcPts` and `rotPts`. Nothing outside the tests reached any of
// them, and two of the five -- the n-gon and the star -- are `ring` with a
// constant radius and `ring` with an alternating one, which is one capability
// wearing three names. They were deleted rather than kept for later. This
// project has already paid for shipping code nothing reads; see commit d92a703
// and docs/knowledge/verification-culture.md §11. When a piece needs an arc, it arrives
// with the piece that needs it.
//
// Nothing here knows what kind of art a piece makes.

'use strict';

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
 * Is a point inside a closed polygon? Ray crossing, odd winding.
 *
 * Points exactly on the boundary are not promised either answer -- a boundary
 * test wants a distance, not a predicate, and pretending otherwise is how a
 * tiling grows a one-pixel seam that only shows up in print.
 */
function pointInPoly(p, pts) {
  const x = p[0];
  const y = p[1];
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const yi = pts[i][1];
    const yj = pts[j][1];
    if ((yi > y) !== (yj > y)) {
      const t = (y - yi) / (yj - yi);
      if (x < pts[i][0] + t * (pts[j][0] - pts[i][0])) hit = !hit;
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
 * The generic form of the thing five authors wrote as `blob`. It is a ring
 * constructor, not a look -- hand it a noise field and it is an organic blob,
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

module.exports = {
  lengthOf, bbox, centroid, pointInPoly,
  resample, chaikin, chain,
  ring, ribbon,
};
