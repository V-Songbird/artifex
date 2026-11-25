// Spatial helpers on points and shapes: a point index for radius queries, the
// largest circle inside a shape, and a Poisson-disk scatter drawn from R, from
// vendored libraries. Kept apart from geom.js so a piece that never asks for
// them does not carry them in its page.
//
// Nothing here knows what kind of art a piece makes.

'use strict';

const { KDBush } = require('./kdbush.js');
const { polylabel } = require('./polylabel.js');
const { FastPoissonDiskSampling } = require('./poisson-disk.js');

// Past this many grid cells a scatter would take seconds and hundreds of
// megabytes; refuse it instead of stalling the page.
const MAX_CELLS = 2 ** 22;

function point(p) {
  if (!Array.isArray(p) || p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
    throw new TypeError('geometry: expected a finite [x, y] point');
  }
}

function ringOf(name, pts, min) {
  if (!Array.isArray(pts) || pts.length < min) {
    throw new TypeError(`${name}: needs an array of ${min ? `at least ${min} ` : ''}[x, y] points`);
  }
  pts.forEach(point);
}

/**
 * A point index (kdbush, vendored in core/kdbush.js) over `points`, built once.
 * `within(p, r)` returns the indices into `points` of every point at distance
 * r or less from p, in ascending order: the same answer as testing each point,
 * without visiting most of them.
 *
 * What it is for: links between near points, a mark that reacts to its
 * neighbours, or spacing checks over thousands of marks.
 */
function pointIndex(points) {
  ringOf('pointIndex', points, 0);
  const index = new KDBush(points.length);
  for (const p of points) index.add(p[0], p[1]);
  index.finish();
  return {
    within(p, r) {
      point(p);
      if (!Number.isFinite(r) || r < 0) throw new RangeError('pointIndex: within radius must be a finite number of 0 or more');
      if (points.length === 0) return [];
      return index.within(p[0], p[1], r).sort((a, b) => a - b);
    },
  };
}

/**
 * The largest circle inside a polygon, holes allowed: polylabel (vendored in
 * core/polylabel.js), its centre the pole of inaccessibility. `outer` and each
 * hole are rings of [x, y] points, the closing point not repeated. Returns
 * { centre, radius }; radius is the distance from centre to the nearest edge,
 * within `precision` design units of the largest possible.
 *
 * What it is for: where a label, an eye or a seed mark sits so it stays
 * clear of the edges, and how large it can be, even in a thin or bent shape
 * whose centroid falls outside it.
 */
function innerCircle(outer, holes = [], precision = 1) {
  ringOf('innerCircle', outer, 3);
  if (!Array.isArray(holes)) throw new TypeError('innerCircle: holes must be an array of rings');
  for (const hole of holes) ringOf('innerCircle', hole, 3);
  if (!Number.isFinite(precision) || precision <= 0) throw new RangeError('innerCircle: precision must be a finite number above 0');
  const found = polylabel([outer, ...holes], precision);
  return { centre: [found[0], found[1]], radius: found.distance };
}

/**
 * Points scattered over `bounds` [x0, y0, x1, y1] no closer than `radius` to
 * each other, added until no tried candidate fits, so a small gap can remain,
 * mostly at the edges: Bridson's Poisson-disk
 * method, from fast-2d-poisson-disk-sampling (vendored in core/poisson-disk.js),
 * with every random draw R(name, 'poissonDisk', i) for i = 0, 1, 2 and so on.
 * The same seed and name give the same points in the same order, all inside
 * bounds.
 *
 * What it is for: an even scatter with no grid in it, as seeds for marks,
 * Voronoi cells or streamlines.
 */
function poissonDisk(R, name, bounds, radius) {
  if (typeof R !== 'function') throw new TypeError('poissonDisk: R must be the function rng(seed) returns');
  if (typeof name !== 'string') throw new TypeError('poissonDisk: name must be a string');
  if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite)
    || !(bounds[2] > bounds[0]) || !(bounds[3] > bounds[1])) {
    throw new TypeError('poissonDisk: bounds must be finite [x0, y0, x1, y1] with x1 > x0 and y1 > y0');
  }
  if (!Number.isFinite(radius) || radius <= 0) throw new RangeError('poissonDisk: radius must be a finite number above 0');
  const [x0, y0, x1, y1] = bounds;
  const cell = radius * Math.SQRT1_2;
  if (Math.ceil((x1 - x0) / cell) * Math.ceil((y1 - y0) / cell) > MAX_CELLS) {
    throw new RangeError(`poissonDisk: radius ${radius} is too small for these bounds; keep (width / radius) * (height / radius) under about ${MAX_CELLS / 2}`);
  }
  let i = 0;
  const sampler = new FastPoissonDiskSampling({ shape: [x1 - x0, y1 - y0], radius }, () => R(name, 'poissonDisk', i++));
  return sampler.fill().map(([x, y]) => [x0 + x, y0 + y]);
}

module.exports = { pointIndex, innerCircle, poissonDisk };
