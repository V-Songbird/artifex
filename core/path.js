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

/**
 * The closed outline of a stroke whose width varies along it, to `fill`.
 *
 * A canvas or SVG stroke has one width per path, so a line that swells and
 * thins has to be drawn as a filled outline. `width` is the full width, as a
 * function of the arc-length fraction u (0 at the first point, 1 at the last),
 * or as an array with one width per point. The fraction is measured along the
 * line, not counted in points, so a swell sits where the length is even when
 * the points bunch. The width is taken at the points and is straight between
 * them: `resample` a long or sparse line first for a smooth swell.
 *
 * `cap` is 'round' (the default) or 'butt'. A width of 0 at an end closes the
 * outline to a point there: that is a tapered end, and no cap is added to it.
 *
 * Each segment is a band whose width runs straight between its two points, and
 * the outline joins the bands' edges. Outside a turn the edges meet in a mitre,
 * and bevel beyond `miterLimit` times the half-width, as `offsetPolyline` in
 * core/geom.js does. Inside a turn they are cut where they cross when both
 * bands cover the corner that leaves out, and otherwise fold back through the
 * point: at a sharp turn on short segments, and along a curl tighter than the
 * half-width. Filled with the default nonzero rule, every band is covered;
 * 'evenodd' leaves holes where the outline overlaps itself. Consecutive
 * duplicate points collapse, and fewer than two distinct points throw: a dot
 * is a circle, not a line.
 *
 * `closed: true` draws round a loop: the last point joins the first like any
 * other corner, so there is no cap, taper or seam where the loop starts, and
 * `cap` is ignored. A first point repeated at the end is dropped. u runs from 0
 * at the first point round to 1 back at it, so give a width with w(0) = w(1);
 * it is called for u below 1 only. The result is one polygon tracing the
 * band's two edges in opposite directions, joined by an edge there and back,
 * so `fill` paints the ring and leaves the inside of the loop empty; a band
 * wider than the shape fills its middle too.
 */
function outline(pts, width, { cap = 'round', miterLimit = 4, closed = false } = {}) {
  if (cap !== 'round' && cap !== 'butt') throw new RangeError(`outline: cap must be 'round' or 'butt', got ${cap}`);
  if (!Number.isFinite(miterLimit) || miterLimit < 1) throw new RangeError('outline: miterLimit must be finite and at least 1');
  const perPoint = Array.isArray(width);
  if (!perPoint && typeof width !== 'function') throw new TypeError('outline: width must be a function of u or an array of widths');
  if (perPoint && width.length !== pts.length) throw new RangeError(`outline: ${width.length} widths for ${pts.length} points`);
  const src = [];
  const from = [];
  pts.forEach((p, i) => {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) throw new TypeError('outline: expected finite [x, y] points');
    const q = src[src.length - 1];
    if (!q || q[0] !== p[0] || q[1] !== p[1]) { src.push(p); from.push(i); }
  });
  if (closed) {
    // A loop given with its first point repeated at the end closes on its own.
    const z = src[src.length - 1];
    if (src.length > 1 && z[0] === src[0][0] && z[1] === src[0][1]) { src.pop(); from.pop(); }
    if (src.length < 3) throw new RangeError('outline: a closed outline needs three distinct points');
  }
  const n = src.length;
  if (n < 2) throw new RangeError('outline: needs two distinct points');

  // Unit directions and lengths of the segments, and the length run so far; a
  // closed line has one more segment, from the last point back to the first.
  const dir = [];
  const run = [0];
  for (let i = 1; i < (closed ? n + 1 : n); i++) {
    const dx = src[i % n][0] - src[i - 1][0];
    const dy = src[i % n][1] - src[i - 1][1];
    const len = Math.hypot(dx, dy);
    dir.push([dx / len, dy / len, len]);
    run.push(run[i - 1] + len);
  }
  const total = run[run.length - 1];
  if (!Number.isFinite(total)) throw new RangeError('outline: length overflow');
  const half = from.map((k, i) => {
    const w = perPoint ? width[k] : width(run[i] / total);
    if (!Number.isFinite(w) || w < 0) throw new RangeError(`outline: width must be finite and not negative, got ${w}`);
    return w / 2;
  });

  const left = [];
  const right = [];
  if (closed) {
    // Every point is an inner corner: pad the loop with its neighbours across
    // the seam, so the first point joins like the rest.
    const s = [src[n - 1], ...src, src[0]];
    const h = [half[n - 1], ...half, half[0]];
    const d = [dir[n - 1], ...dir];
    const ring = (side) => {
      const joins = [];
      for (let i = 1; i <= n; i++) joins.push(corner(s, h, d, i, side, miterLimit));
      // Each cut leaves out a corner region its two bands both cover. Round a
      // loop there are as many cuts as bands, so a point inside every cut
      // region, as in a band wider than the shape, would be left empty: there,
      // one corner folds back instead, and the rest cannot empty a point.
      const allCut = joins.every((j, k) => j.length === 1 && side * (d[k][0] * d[k + 1][1] - d[k][1] * d[k + 1][0]) > 0);
      if (allCut && sharedArea(joins.map((j, k) => [...corner(s, h, d, k + 1, side, miterLimit, true), j[0]])) > 0) {
        joins[0] = corner(s, h, d, 1, side, miterLimit, true);
      }
      return joins.flat();
    };
    left.push(...ring(1));
    right.push(...ring(-1));
    // The left ring, then the right ring the other way round, bridged by an
    // edge there and back that cancels. Meant for the default nonzero fill:
    // where the band overlaps itself, 'evenodd' leaves it empty.
    return [...left, left[0], right[0], ...right.slice(1).reverse(), right[0]];
  }
  for (let i = 0; i < n; i++) {
    const [x, y] = src[i];
    const h = half[i];
    if (i === 0 || i === n - 1) {
      const [dx, dy] = dir[i === 0 ? 0 : n - 2];
      left.push([x - dy * h, y + dx * h]);
      right.push([x + dy * h, y - dx * h]);
      continue;
    }
    left.push(...corner(src, half, dir, i, 1, miterLimit));
    right.push(...corner(src, half, dir, i, -1, miterLimit));
  }

  // Half a circle from the left side to the right, round the far side of p.
  const STEPS = 16;
  const capAt = ([x, y], h, dx, dy) => {
    const arc = [];
    if (cap === 'butt' || h === 0) return arc;
    const a0 = Math.atan2(dx, -dy);
    for (let k = 1; k < STEPS; k++) {
      const a = a0 - (Math.PI * k) / STEPS;
      arc.push([x + Math.cos(a) * h, y + Math.sin(a) * h]);
    }
    return arc;
  };
  const [ex, ey] = dir[n - 2];
  const [sx, sy] = dir[0];
  return [
    ...left,
    ...capAt(src[n - 1], half[n - 1], ex, ey),
    ...right.reverse(),
    ...capAt(src[0], half[0], -sx, -sy),
  ];
}

/**
 * Cross-contour marks round a projected segment: arcs of its section ellipses
 * that wrap any tube or limb-like form, the way a painter models a round.
 *
 * `seg` is one segment from `project` in core/armature.js: `{ a, b, sections }`.
 * Each mark sits at a fraction `at` along it, on the section there: centre,
 * major and minor run straight between the two end sections. The arc is drawn
 * in from the rim by half the mark's width, so the mark filled with
 * `outline(points, width)` stays inside the outline the two end ellipses span;
 * where the section's radius is under the width, or the mark lies within half
 * its width of an end of the form in depth, its width is cut to fit. An arc
 * covers the visible half of its section, the half on `near`'s side, starting
 * where the major axis
 * meets the rim on the side away from `light` (a picture vector toward the
 * light) and running a seeded 70 to 95 percent of the way round toward it;
 * with the light along the segment, at the end toward [light[1], -light[0]].
 * Where that half faces away from the light, the start turns into it toward
 * its darkest rim point as the section opens, and the arc shrinks to stay in
 * the half. A segment lying in the picture plane gives straight marks across
 * it; one pointing at or away from the viewer gives round ones, whose whole
 * circle shows, so each starts at the rim point straight away from `light`,
 * where the turning start arrives as the segment comes end-on, and turns from
 * there toward [-light[1], light[0]]. Within a tilt of 0.2 of end-on, where the
 * visible half flips sides, a mark's start turns on to the section's darkest
 * point, onto the far half if it lies there, and its span grows to the end-on
 * arc's; a mark that turns the other way shrinks into its start, thinning as
 * it goes, and grows back the end-on arc's way. A segment passing near end-on
 * also swings its picture direction through the light's, where a mark's start
 * end flips to the other end of the major axis; there a mark eases into its
 * mirror image about the light as the major axis's reach toward the light
 * falls under the larger of half of how far the tilt has fallen from 0.2
 * toward 0 and the opening (minor over major) times the lesser of 0.25 and
 * 0.025 over the tilt. Within a tilt of 0.1 the mark's start swings round
 * through the section's darkest point, onto the far half if it lies there;
 * from 0.1 to 0.2 that swing gives way, and from 0.2 out the mark keeps to the
 * visible half: it shrinks into its start, thinning as it goes, vanishes, and
 * grows back from its start's mirror image across the minor axis. So a mark's
 * width, length and end points change smoothly as the segment swings through
 * end-on or past it, at the rim of the 0.2 tilt too; a segment turning through
 * the light nearly in the picture plane changes its mark fast, and one lying
 * in it flips the mark to its mirror image at once. A still segment whose
 * picture direction lies that near the light's draws its marks shorter and
 * thinner than farther from it, or not at all.
 *
 * Without `eye`, every mark on a segment opens alike, as an orthographic or
 * weak-perspective view shows a straight part. `eye: { at, focal }` is the
 * picture point straight ahead of the eye (where `project` puts its `centre`)
 * and `project`'s `focal`: each mark then opens by its own section's direction
 * from the eye, and its near half faces the eye, so it is straight where that
 * direction meets the axis square and faces the other way past that point. Its
 * centre, major and width cut stay as without `eye`, so a mark near an end can
 * reach past the end ellipses, which keep the view's opening. Within a tilt of
 * 0.2 of end-on, a mark's opening, near side and light ease to the view's, so
 * it is straight where its near side flips, and the start's turn eases in as
 * the section's brightest light rises to 0.2, since where the light runs along
 * the segment that point flips across the rim as the opening passes 0. Seen
 * end-on, or with no picture length, `eye` changes nothing.
 *
 * `stop: [low, high]`, fractions of full light, ends each mark where the
 * surface under it first reaches a seeded light level between them, so it
 * starts in the shade and stops in the half-tone. The level is the section's
 * normal against `light`, both taken in the picture plane: 0 at the
 * terminator, 1 facing the light; with `eye`, each mark's own opening sets
 * it. An arc that never reaches its level keeps its seeded end, and a mark
 * already that lit at its first point gives no mark. So that a bend never
 * halves or drops a mark at once, both rules ease in over 0.2 of full light.
 * Where the section's brightest point is under 0.2 past the level, or short
 * of full light for a level above 0.8, the end lies between the seeded end
 * and where the arc reaches the level, nearer that point the brighter the
 * section, so the mark can be lit up to 0.2 past its level, past `high` too.
 * A mark whose first point is under 0.2 short of its level keeps the share
 * (level - light at its first point) / 0.2 of that span, so it thins away as
 * its first point reaches the level. A mark `stop` cuts has `width` scaled by
 * the share of its seeded span it keeps, before the form's fit, which still
 * holds where narrower, so it is at most that share of `width` wide and thins
 * to nothing as the cut nears its first point instead of ending as a
 * full-width dot.
 *
 * Without `at`, the count is the segment's picture length over `spacing`, at
 * least one, placed one to a stratum. `R` is the piece's `R(entity, property,
 * index)`; the marks read `R(name, 'at' | 'from' | 'to', i)`, and
 * `R(name, 'stop', i)` with `stop`, so give each segment its own `name`. Returns `[{ points, width, at }]` in order of `at`;
 * `width` is a function of the arc-length fraction for `outline`, the mark's
 * width at the shade end and 0 at the light end. A section with major 0 gives no mark.
 */
function crossContours(seg, R, name, { light = [-1, -1], spacing = 12, at, width = 2, eye, stop } = {}) {
  const pt = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
  if (!seg || typeof seg !== 'object' || !pt(seg.a) || !pt(seg.b)) {
    throw new TypeError('crossContours: seg must be a projected segment with finite [x, y] a and b');
  }
  const ss = seg.sections;
  if (!Array.isArray(ss) || ss.length !== 2 || !ss.every((s) => s && pt(s.centre) && pt(s.near)
    && Number.isFinite(s.major) && s.major >= 0 && Number.isFinite(s.minor) && s.minor >= 0 && Number.isFinite(s.angle))) {
    throw new TypeError('crossContours: seg sections must be two { centre, major, minor, angle, near }, with finite values and major and minor not below 0');
  }
  if (typeof R !== 'function') throw new TypeError(`crossContours: R must be the piece's R(entity, property, index), got ${R}`);
  if (typeof name !== 'string') throw new TypeError(`crossContours: name must be a string, got ${name}`);
  if (!pt(light) || !(Math.hypot(...light) > 0)) throw new RangeError(`crossContours: light must be a finite [x, y] with a length above 0, got ${light}`);
  if (!Number.isFinite(spacing) || spacing <= 0) throw new RangeError(`crossContours: spacing must be a finite number above 0, got ${spacing}`);
  if (!Number.isFinite(width) || width < 0) throw new RangeError(`crossContours: width must be a finite number not below 0, got ${width}`);
  if (at !== undefined && (!Array.isArray(at) || at.length === 0 || !at.every((t) => Number.isFinite(t) && t >= 0 && t <= 1))) {
    throw new RangeError(`crossContours: at must be a non-empty array of numbers in [0, 1], got ${Array.isArray(at) ? `[${at.join(', ')}]` : at}`);
  }
  if (eye !== undefined && !(eye && pt(eye.at) && Number.isFinite(eye.focal) && eye.focal > 0)) {
    throw new RangeError(`crossContours: eye must be { at: [x, y], focal } with a finite focal above 0, got ${eye && typeof eye === 'object' ? JSON.stringify(eye) : eye}`);
  }
  if (stop !== undefined && !(Array.isArray(stop) && stop.length === 2 && stop.every((x) => Number.isFinite(x) && x >= 0 && x <= 1) && stop[0] <= stop[1])) {
    throw new RangeError(`crossContours: stop must be [low, high] with 0 <= low <= high <= 1, got ${Array.isArray(stop) ? `[${stop.join(', ')}]` : stop}`);
  }
  const [s0, s1] = ss;
  const { a, b } = seg;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const count = Math.max(1, Math.round(len / spacing));
  // The filled stroke round each point must stay inside the form: as a ball in
  // depth, it fits when the arc sits on a section circle drawn in from the rim
  // by its radius over the cosine of the taper's half-angle, and the ball clears
  // both end caps. The sections' minor over major is the cosine of the axis's
  // angle to the view, so `tilt` is its sine and the form's length is len / tilt;
  // a tilt under 1e-6, rounding of a segment seen end-on, counts as end-on.
  const big = s0.major >= s1.major ? s0 : s1;
  const ratio = big.major > 0 ? Math.min(1, big.minor / big.major) : 1;
  const tilt = Math.sqrt(1 - ratio * ratio) < 1e-6 ? 0 : Math.sqrt(1 - ratio * ratio);
  const slope = len > 0 ? Math.hypot(1, (s1.major - s0.major) * tilt / len) : 1;
  const ts = at ? at.slice().sort((x, y) => x - y)
    : Array.from({ length: count }, (_, i) => (i + 0.2 + 0.6 * R(name, 'at', i)) / count);
  // Seen end-on the whole section circle shows, so the arc turns with the light.
  const lit = Math.hypot(...light);
  const u = tilt === 0 ? [light[0] / lit, light[1] / lit] : [Math.cos(s0.angle), Math.sin(s0.angle)];
  // The arc runs from the major axis's end away from the light. With the light
  // along the segment's axis neither end is: every mark starts at the end
  // toward [light[1], -light[0]], so its heavy end stays put as the segment
  // crosses the picture plane, and where the visible half faces away from the
  // light it turns the way an end-on arc does, from -light toward
  // [-light[1], light[0]]. A product within rounding of 0 counts as along it.
  const ul = u[0] * light[0] + u[1] * light[1];
  const sigma = Math.abs(ul) <= 1e-9 * lit ? (u[0] * light[1] - u[1] * light[0] < 0 ? -1 : 1) : ul > 0 ? -1 : 1;
  // With an eye, the axis in camera terms: across the picture by `tilt`, in
  // depth by the signed ratio, the sign read from `near`.
  const view = eye && tilt > 0 && len > 0;
  const dir = view ? [(b[0] - a[0]) / len, (b[1] - a[1]) / len] : null;
  const fz = view && Math.hypot(...s0.near) > 0 ? Math.sign(s0.near[0] * dir[0] + s0.near[1] * dir[1]) * ratio : 0;
  // The visible half flips sides at end-on, so a mark kept to it would jump
  // there: it halves, or with stop goes from one cut short from the rim to one
  // left uncut. Instead, as the tilt falls from 0.2 to 0, `endOn` rises from 0
  // to 1 and a mark eases into the end-on mark's start and span, and with an
  // eye its signed opening, and so its near side and its light, eases to the
  // view's, which the eye leaves unchanged end-on, so where its near side
  // flips it is straight. A mark that turns against the end-on arc shrinks into
  // its start and grows back the other way round, so it arrives as that arc.
  const endOn = tilt > 0 ? Math.max(0, 1 - tilt / 0.2) : 0;
  // Where the segment's picture direction crosses the light's, `sigma` flips,
  // so a mark becomes its mirror image about the line through its centre along
  // the light, and a segment passing near end-on sweeps through there fast. On
  // the side whose `sigma` differs from the light-along rule's, as the major
  // axis's reach toward the light, |ul| / lit, falls from `band` to 0,
  // `mirror` rises from 0 to 1 and the mark eases into the mirror image of the
  // other side's, so it arrives at the light-along rule's mark. `band` is
  // endOn / 2 within a tilt of about 0.1; past it, where endOn / 2 would
  // narrow to nothing at 0.2 and a pass crossing the light there would flip in
  // a step, it is 0.025 * ratio / tilt. A near pass turns the picture direction about
  // 1 / tilt per unit of bend, so the ease takes a like share of each step at
  // any tilt; it narrows with the opening, `ratio`, since the start swings to
  // its mirror image only where the reach is under the opening. So only a
  // section seen edge-on, a segment lying in the picture plane, flips at once.
  const band = Math.max(endOn, Math.min(0.5, 0.05 / tilt) * ratio) / 2;
  const mirror = sigma === (u[0] * light[1] - u[1] * light[0] < 0 ? -1 : 1) ? 0
    : Math.max(0, 1 - Math.abs(ul) / lit / band);
  // That ease swings the start round through the darkest point, which past
  // the end-on zone can lie on the far half. So as the tilt rises from 0.1 to
  // 0.2, `out` rises from 0 to 1 and the swing gives way to a hold: the mark
  // shrinks into its start, vanishes, and grows back from the start's mirror
  // image across the minor axis, which at |ul| = 0 is the light's line, so it
  // keeps to the visible half.
  const out = Math.min(1, Math.max(0, tilt / 0.1 - 1));
  const marks = [];
  ts.forEach((t, i) => {
    const M = s0.major + (s1.major - s0.major) * t;
    if (!(M > 0)) return;
    const c = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    // A section opens by the cosine of the axis's angle to the line of sight,
    // and its near half lies on the eye's side. Without an eye that line is the
    // view, alike for every section; with one it runs from the eye to `c`.
    let rt = ratio, nt = s0.near, m = s0.minor + (s1.minor - s0.minor) * t;
    if (view) {
      const w = [c[0] - eye.at[0], c[1] - eye.at[1], eye.focal];
      // Near end-on (see `endOn`), the signed opening eases to the view's, so
      // where its near half flips sides it is straight.
      let sw = (tilt * (dir[0] * w[0] + dir[1] * w[1]) + fz * w[2]) / Math.hypot(...w);
      sw += (fz - sw) * endOn;
      rt = Math.min(1, Math.abs(sw));
      nt = Math.abs(sw) <= 1e-12 ? [0, 0] : [Math.sign(sw) * dir[0], Math.sign(sw) * dir[1]];
      m = M * rt;
    }
    const opens = tilt > 0 && Math.hypot(...nt) > 0;
    const v = opens ? nt : [-u[1], u[0]];
    const vl = v[0] * light[0] + v[1] * light[1];
    // Where the visible half faces away from the light, its rim point darkest
    // under a light in the picture plane lies atan2(ratio * -vl, |ul|) round from
    // that end. The first point turns toward it as the section opens, by its
    // ratio, so it reaches the end-on rule's start, straight away from the
    // light, as the tilt reaches 0. The arc keeps to the visible half: its span
    // shrinks to fit, and its seeded offset past the start, up to 5 percent of
    // a half turn, does not, so it matches the end-on arc's.
    const dark = Math.atan2(-rt * vl, Math.abs(ul));
    let s = opens && vl < 0 ? rt * dark : 0;
    // Near end-on (see `endOn`) the start turns on to the section's darkest
    // point, onto the far half if it lies there, and the span grows to the
    // end-on arc's seeded share of a half turn. With the light along the axis
    // and an eye, that point flips across the rim as the opening passes 0,
    // where the section is unlit, so the turn eases in as its light reaches 0.2.
    if (endOn > 0) s += (dark - s) * endOn * Math.min(1, Math.hypot(ul, rt * vl) / lit / 0.2);
    // End-on, every arc turns from -light toward [-light[1], light[0]]. One
    // that turns the other way has its offset, span and width scaled by g,
    // which runs from 1 down through 0 to -1 as `endOn` rises; past 0 it is
    // drawn mirrored across the major axis (f = -1), so it turns the end-on
    // arc's way from the same start. The swing scales down with the opening
    // below 0.2, to none at 0, where the arc's turn flips as it passes
    // straight. With `mirror`, g eases to the other side's g negated, and the
    // start swings across the darkest point to its mirror image there, so the
    // mark becomes the other side's mirrored; with `out`, see below.
    const swing = endOn * Math.min(1, rt / 0.2);
    const against = sigma * (u[0] * v[1] - u[1] * v[0]) > 0;
    const own = against ? 1 - 2 * swing : 1, other = against ? 1 : 1 - 2 * swing;
    const g = own - (own + other) * mirror;
    // With `out`, the start swings about the rim point a quarter turn from the
    // major axis instead of the darkest point, and jumps where g passes 0; the
    // mark's size, |g| less `gap`, reaches 0 before that, so nothing jumps.
    const gap = 0.4 * out * mirror * (1 - mirror);
    const size = Math.max(0, Math.abs(g) - gap) / (1 - gap);
    if (!(size > 1e-6)) return;
    const f = Math.sign(g);
    const pivot = dark + ((dark < 0 ? -Math.PI : Math.PI) / 2 - dark) * out;
    const start = s + 2 * (pivot - s) * (out * (g < 0) + (1 - out) * mirror);
    const th0 = f * start + size * Math.PI * 0.05 * R(name, 'from', i);
    let th1 = f * start + size * (Math.PI - s * (1 - endOn)) * (0.7 + 0.25 * R(name, 'to', i));
    let keep = 1;
    if (stop) {
      // The light on the section's surface at th: its normal against the unit
      // light, both in the picture plane, A cos th + B sin th, with B taken at
      // this mark's own opening. It is 0 at the terminator and 1 facing the
      // light. The arc ends where it first reaches the mark's seeded level, or
      // keeps its seeded end if it never does; a mark lit past the level at its
      // start gives no mark. A cut mark's `width` is scaled by the share of its
      // seeded span it keeps, before the form's fit below, so one cut toward
      // nothing thins away rather than leaving a full-width dot. Both ends of
      // that rule would jump, so each eases in over 0.2 of full light: the lit
      // stretch opens at the peak, partway along the arc, as the peak light C
      // rises through the level, so the cut slides in from the seeded end as C
      // rises 0.2 past it, or to full light where less is left; and a mark
      // whose start is under 0.2 short of its level keeps that gap over 0.2 of
      // its span, so it is gone as its start reaches the level.
      const level = stop[0] + (stop[1] - stop[0]) * R(name, 'stop', i);
      const A = sigma * ul / lit, B = f * rt * vl / lit;
      const first = A * Math.cos(th0) + B * Math.sin(th0);
      if (first >= level) return;
      const C = Math.hypot(A, B);
      let cut = th1;
      if (C > level) {
        const phi = Math.atan2(B, A), half = Math.acos(level / C);
        const next = (b) => b + 2 * Math.PI * Math.ceil((th0 - b) / (2 * Math.PI));
        cut += (Math.min(th1, next(phi - half), next(phi + half)) - th1) * Math.min(1, (C - level) / Math.min(0.2, 1 - level));
      }
      if (level - first < 0.2) cut = th0 + (cut - th0) * (level - first) / 0.2;
      keep = (cut - th0) / (th1 - th0);
      th1 = cut;
    }
    const n = Math.min(64, Math.max(4, Math.ceil((th1 - th0) * M / 3)));
    const arc = [];
    for (let k = 0; k <= n; k++) {
      const th = th0 + (th1 - th0) * k / n;
      arc.push([sigma * M * Math.cos(th), f * m * Math.sin(th)]);
    }
    // A mitred join reaches 1 / cos(turn / 2) of the half-width from its point;
    // drawing the arc in about its centre keeps every turn.
    let turn = 0;
    for (let k = 1; k < n; k++) {
      const p = [arc[k][0] - arc[k - 1][0], arc[k][1] - arc[k - 1][1]];
      const q = [arc[k + 1][0] - arc[k][0], arc[k + 1][1] - arc[k][1]];
      turn = Math.max(turn, Math.abs(Math.atan2(p[0] * q[1] - p[1] * q[0], p[0] * q[0] + p[1] * q[1])));
    }
    const J = 1 / Math.cos(turn / 2);
    let hw = width / 2 * keep * size;
    if (tilt > 0) hw = Math.min(hw, Math.min(t, 1 - t) * len / (tilt * J));
    hw = Math.min(hw, M / (2 * J * slope));
    const k = 1 - J * slope * hw / M;
    const points = arc.map(([x, y]) => [c[0] + k * (x * u[0] + y * v[0]), c[1] + k * (x * u[1] + y * v[1])]);
    marks.push({ points, width: (q) => 2 * hw * (1 - q), at: t });
  });
  return marks;
}

// The points of `outline`'s left (side 1) or right (side -1) edge at inner
// point i. Each segment's band is a trapezoid whose half-width runs straight
// between its ends, and the outline is the edges of those bands joined at each
// point; filled under the nonzero rule it covers every band whenever each join
// adds area or takes away only area both bands at that point already cover:
// - outside a turn, the edges extend to where they cross, within `miterLimit`
//   times the half-width, or else are joined straight across (a bevel);
// - inside a turn, the edges are cut where they cross if the corner region the
//   cut leaves out lies in both bands, and otherwise fold back through the
//   point. A curl tighter than the half-width folds: its neighbouring cuts
//   would overlap, and one segment's band would lose the same region twice.
// `fold` folds an inner corner even where it could be cut.
function corner(src, half, dir, i, side, miterLimit, fold = false) {
  const [ax, ay, la] = dir[i - 1];
  const [bx, by, lb] = dir[i];
  const p = src[i - 1]; const c = src[i]; const q = src[i + 1];
  const h = half[i];
  const a0 = [p[0] - side * ay * half[i - 1], p[1] + side * ax * half[i - 1]];
  const a1 = [c[0] - side * ay * h, c[1] + side * ax * h];   // where the incoming edge ends
  const b0 = [c[0] - side * by * h, c[1] + side * bx * h];   // where the outgoing edge starts
  const b1 = [q[0] - side * by * half[i + 1], q[1] + side * bx * half[i + 1]];
  const rx = a0[0] - a1[0]; const ry = a0[1] - a1[1];
  const sx = b1[0] - b0[0]; const sy = b1[1] - b0[1];
  const wx = b0[0] - a1[0]; const wy = b0[1] - a1[1];
  const den = rx * sy - ry * sx;
  const t = (wx * sy - wy * sx) / den;     // back along the incoming edge; NaN or infinite when parallel
  const u = (wx * ry - wy * rx) / den;     // on along the outgoing edge
  const cross = [a1[0] + t * rx, a1[1] + t * ry];
  if (side * (ax * by - ay * bx) > 0) {
    const cut = t >= 0 && t <= 1 && u >= 0 && u <= 1
      && inBand(b0, p, ax, ay, la, half[i - 1], h) && inBand(a1, c, bx, by, lb, h, half[i + 1]);
    return cut && !fold ? [cross] : [a1, c, b0];
  }
  // 1 / cos(half the turn): how far a constant-width mitre reaches, in half-widths.
  const reach = 2 / Math.hypot(ay + by, ax + bx);
  const mitre = reach <= miterLimit && t <= 0 && u <= 0
    && Math.hypot(cross[0] - c[0], cross[1] - c[1]) <= miterLimit * h;
  if (mitre) return [cross];
  return a1[0] === b0[0] && a1[1] === b0[1] ? [a1] : [a1, b0];
}

// Whether c lies in the band of the segment from p along the unit direction
// (dx, dy) for length l, whose half-width runs from h0 to h1.
function inBand(c, p, dx, dy, l, h0, h1) {
  const ex = c[0] - p[0]; const ey = c[1] - p[1];
  const s = (ex * dx + ey * dy) / l;
  const tol = 1e-9 * (l + h0 + h1);
  return s >= -1e-9 && s <= 1 + 1e-9 && Math.abs(ex * dy - ey * dx) <= h0 + (h1 - h0) * s + tol;
}

// The area every one of these convex polygons covers, clipping the first by
// each in turn.
function sharedArea(polys) {
  const area = (p) => p.reduce((a, q, i) => {
    const r = p[(i + 1) % p.length];
    return a + q[0] * r[1] - r[0] * q[1];
  }, 0) / 2;
  let shared = polys[0];
  for (const clip of polys) {
    const o = Math.sign(area(clip));
    if (o === 0) return 0;
    for (let e = 0; e < clip.length && shared.length; e++) {
      const a = clip[e]; const b = clip[(e + 1) % clip.length];
      const at = (p) => o * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
      const kept = [];
      shared.forEach((p, k) => {
        const q = shared[(k + 1) % shared.length];
        const sp = at(p); const sq = at(q);
        if (sp >= 0) kept.push(p);
        if ((sp >= 0) !== (sq >= 0)) {
          const t = sp / (sp - sq);
          kept.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
        }
      });
      shared = kept;
    }
  }
  return shared.length < 3 ? 0 : Math.abs(area(shared));
}

/**
 * A path drawn up to `length` along it: the part a hand has drawn so far, and
 * where the tool is. Returns `{ points, tip, heading, length, total }`.
 *
 * `points` is the start of the path up to that length: every point passed, then
 * the tip, cut part-way along its segment. It is a prefix of the whole path, so
 * a mark built from it grows while the part already drawn stays still. `tip` is
 * its last point and `heading` the direction of travel there, in radians from
 * atan2 (canvas y runs down): along the segment the tip lies on, the one that
 * arrives when the tip sits on a point, and the first segment at length 0. Zero
 * length segments are skipped, and a path with none gives 0. `length` is the
 * length drawn, the argument clamped to 0..total, and `total` the whole path's
 * length.
 *
 * Since `length` is clamped, Infinity draws everything. `close` adds
 * the edge from the last point back to the first, as `lengthOf` does, when
 * there are more than two points. The arrays returned are new; `pts` is not
 * changed.
 *
 * Give a varying width as a function of the length along the whole path, for
 * example `outline(points, (u) => w(u * length / total))`, not of the prefix's
 * own fraction, or the line re-shapes as it grows. Use the returned `length`,
 * not the one passed in: past the end that one runs `w` out of its range, and
 * `outline` throws. At length 0, or a length so
 * small the cut rounds back onto the first point, `points` holds one point,
 * which is no line yet: skip drawing it, since `outline` throws. A cut never
 * repeats the point before it.
 */
function grow(pts, length, close = false) {
  if (!pts || pts.length === 0) throw new RangeError('grow: needs at least one point');
  if (typeof length !== 'number' || Number.isNaN(length)) throw new TypeError(`grow: length must be a number, got ${length}`);
  const src = close && pts.length > 2 ? [...pts, pts[0]] : pts;
  const segs = [];
  let total = 0;
  for (let i = 1; i < src.length; i++) {
    const d = Math.hypot(src[i][0] - src[i - 1][0], src[i][1] - src[i - 1][1]);
    if (d > 0) { segs.push(i); total += d; }
  }
  const want = Math.min(Math.max(length, 0), total);
  const points = [[src[0][0], src[0][1]]];
  let heading = 0;
  let walked = 0;
  for (let k = 0; k < segs.length; k++) {
    const a = src[segs[k] - 1]; const b = src[segs[k]];
    const dx = b[0] - a[0]; const dy = b[1] - a[1];
    const d = Math.hypot(dx, dy);
    if (k === 0 || walked < want) heading = Math.atan2(dy, dx);
    if (walked >= want) break;
    if (walked + d <= want) {
      points.push([b[0], b[1]]);
      walked += d;
    } else {
      const t = (want - walked) / d;
      const cut = [a[0] + dx * t, a[1] + dy * t];
      // A length too small to move off `a` in floating point rounds back onto it.
      if (cut[0] !== a[0] || cut[1] !== a[1]) points.push(cut);
      break;
    }
  }
  const tip = points[points.length - 1];
  return { points, tip: [tip[0], tip[1]], heading, length: want, total };
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

/**
 * Clip a closed ring to a box, for FILLING: the part of the area inside the
 * box, as closed rings (Sutherland and Hodgman 1974, one box side at a time).
 * `clipPolyline` returns runs, which are right for a stroke and wrong for a
 * fill: filling an open run closes it with a chord across the form. Returns
 * [] when nothing is inside, else one ring, its closing point not repeated;
 * a form the box cuts into several parts comes back as one ring joined along
 * the box's side, which fills as the parts do.
 */
function clipPolygon(pts, box) {
  if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)) throw new TypeError('clipPolygon: box must be [x0, y0, x1, y1]');
  const [x0, y0, x1, y1] = box;
  let ring = pts.map((p) => [p[0], p[1]]);
  // Each side: [axis, limit, keep when the coordinate is over it].
  for (const [axis, limit, over] of [[0, x0, true], [0, x1, false], [1, y0, true], [1, y1, false]]) {
    const inside = (p) => (over ? p[axis] >= limit : p[axis] <= limit), out = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], ain = inside(a), bin = inside(b);
      if (ain) out.push(a);
      if (ain !== bin) {
        const t = (limit - a[axis]) / (b[axis] - a[axis]), cut = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        cut[axis] = limit;
        out.push(cut);
      }
    }
    ring = out;
    if (ring.length === 0) return [];
  }
  return ring.length < 3 ? [] : [ring];
}

module.exports = { poly, stroke, fill, outline, crossContours, clipSegment, clipPolyline, clipPolygon, grow, boxOf };
