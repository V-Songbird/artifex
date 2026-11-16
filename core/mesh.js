// Meshes and cells on point sets: triangulation, Delaunay and Voronoi, from
// vendored libraries. Kept apart from geom.js so a piece that never asks for
// them does not carry them in its page.
//
// Nothing here knows what kind of art a piece makes.

'use strict';

const { earcut } = require('./earcut.js');
const { Delaunator } = require('./delaunator.js');
const { Delaunay } = require('./d3-delaunay.js');

function ringOf(name, pts, min) {
  if (!Array.isArray(pts) || pts.length < min) {
    throw new TypeError(`${name}: needs an array of ${min ? `at least ${min} ` : ''}[x, y] points`);
  }
  for (const p of pts) {
    if (!Array.isArray(p) || p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
      throw new TypeError('geometry: expected a finite [x, y] point');
    }
  }
}

/**
 * Cut a polygon, holes allowed, into triangles that cover it exactly: earcut
 * (vendored in core/earcut.js). `outer` and each hole are closed rings of
 * [x, y] points, the closing point not repeated. Returns [a, b, c] point
 * triples, copies of the input points; no point is added.
 *
 * What it is for: filling a shape with a gradient per triangle, a mesh to bend
 * a picture with, or any area that must be measured or shaded in pieces.
 */
function triangulate(outer, holes = []) {
  ringOf('triangulate', outer, 3);
  if (!Array.isArray(holes)) throw new TypeError('triangulate: holes must be an array of rings');
  const pts = [...outer];
  const starts = [];
  for (const hole of holes) {
    ringOf('triangulate', hole, 3);
    starts.push(pts.length);
    pts.push(...hole);
  }
  const index = earcut(pts.flat(), starts);
  const out = [];
  for (let i = 0; i < index.length; i += 3) {
    out.push([[...pts[index[i]]], [...pts[index[i + 1]]], [...pts[index[i + 2]]]]);
  }
  return out;
}

/**
 * Delaunay triangulation of a point set: Delaunator (vendored in
 * core/delaunator.js), decided with exact predicates. No triangle's circumcircle
 * holds another point, so the triangles are as fat as the points allow.
 * Returns { triangles, hull }: index triples into `points`, and the convex
 * hull as indices in order. A repeated point appears in no triangle; fewer
 * than three points, or all on one line, give no triangles.
 */
function delaunay(points) {
  ringOf('delaunay', points, 0);
  const d = new Delaunator(points.flat());
  const triangles = [];
  for (let i = 0; i < d.triangles.length; i += 3) triangles.push([d.triangles[i], d.triangles[i + 1], d.triangles[i + 2]]);
  return { triangles, hull: [...d.hull] };
}

/**
 * Voronoi cells of a point set, clipped to `bounds` [x0, y0, x1, y1]:
 * d3-delaunay (vendored in core/d3-delaunay.js). Cell i is the region nearer
 * to points[i] than to any other point, a closed ring with its closing point
 * not repeated; a repeated point's cell is empty.
 */
function voronoi(points, bounds) {
  ringOf('voronoi', points, 0);
  if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite)
    || !(bounds[2] > bounds[0]) || !(bounds[3] > bounds[1])) {
    throw new TypeError('voronoi: bounds must be finite [x0, y0, x1, y1] with x1 > x0 and y1 > y0');
  }
  if (points.length === 0) return [];
  const cells = Delaunay.from(points).voronoi(bounds);
  return points.map((_, i) => {
    const cell = cells.cellPolygon(i);
    return cell ? cell.slice(0, -1) : [];
  });
}

module.exports = { triangulate, delaunay, voronoi };
