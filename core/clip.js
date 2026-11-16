// Polygon booleans and offsets: union, intersection, difference and xor of
// closed shapes, and the outline at a distance round closed shapes or open
// lines, from Clipper2 (vendored in core/clipper2.js). Kept apart from geom.js
// so a site shot that never requires clip.js does not load it.
//
// Clipper2 works on integers: every coordinate is multiplied by `scale`
// (default 1000) and rounded, so results sit on a grid of 1 / scale design
// units, and divided back on the way out.
//
// Nothing here knows what kind of art a piece makes.

'use strict';

const { Clipper, ClipperOffset, ClipType, Paths64, Path64, Point64, FillRule, JoinType, EndType } = require('./clipper2.js');

// Past 2^25 grid units, Clipper2's products of coordinates leave the integers
// a double holds exactly. The bound holds for inputs and, in offset, for the
// farthest an outline can reach: a coordinate plus the distance times the
// larger of miterLimit and 2.
const LIMIT = 2 ** 25;
const FILLS = { nonzero: FillRule.NonZero, evenodd: FillRule.EvenOdd };
const JOINS = { miter: JoinType.Miter, round: JoinType.Round, square: JoinType.Square, bevel: JoinType.Bevel };
const ENDS = { butt: EndType.Butt, round: EndType.Round, square: EndType.Square };

function pick(name, key, table, value) {
  if (!Object.hasOwn(table, value)) throw new RangeError(`${name}: ${key} must be ${Object.keys(table).join(', ')}`);
  return table[value];
}

function scaleOf(name, scale) {
  if (!Number.isFinite(scale) || scale <= 0) throw new RangeError(`${name}: scale must be a finite number above 0`);
  return scale;
}

// One ring or line of [x, y] points, or an array of them, onto the grid.
function toPaths(name, shapes, scale) {
  if (!Array.isArray(shapes)) throw new TypeError(`${name}: expected a ring or an array of rings of [x, y] points`);
  const one = Array.isArray(shapes[0]) && typeof shapes[0][0] === 'number';
  const out = new Paths64();
  for (const ring of one ? [shapes] : shapes) {
    if (!Array.isArray(ring)) throw new TypeError(`${name}: expected a ring or an array of rings of [x, y] points`);
    const path = new Path64();
    for (const p of ring) {
      if (!Array.isArray(p) || p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
        throw new TypeError('geometry: expected a finite [x, y] point');
      }
      const q = new Point64(p[0] * scale, p[1] * scale);
      if (!(Math.abs(q.x) <= LIMIT && Math.abs(q.y) <= LIMIT)) {
        throw new RangeError(`${name}: [${p}] at scale ${scale} is past ${LIMIT} grid units; use a smaller scale`);
      }
      path.push(q);
    }
    out.push(path);
  }
  return out;
}

const fromPaths = (paths, scale) => Array.from(paths, (path) => Array.from(path, (q) => [q.x / scale, q.y / scale]));

function boolean(name, type, a, b, { scale = 1000, fill = 'nonzero' } = {}) {
  scaleOf(name, scale);
  const rule = pick(name, 'fill', FILLS, fill);
  return fromPaths(Clipper.BooleanOp(type, toPaths(name, a, scale), toPaths(name, b, scale), rule), scale);
}

/**
 * Booleans of closed shapes. `a` and `b` are each one ring of [x, y] points,
 * the closing point not repeated, or an array of rings; `fill` ('nonzero', the
 * default, or 'evenodd') says which areas the rings of each enclose. Returns an
 * array of rings: outer rings, and holes that wind the other way from the ring
 * round them, so filling all of them as one path with the nonzero rule leaves
 * the holes open. Ring order and starting points are not promised.
 *
 * `union(a)` alone merges a's own overlaps into one outline. Each argument's
 * rings are filled together, so under 'nonzero' a clockwise and a
 * counter-clockwise ring of the same argument cancel where they overlap, and
 * the overlap comes back as a hole; wind them one way first, or pass them as
 * separate arguments.
 */
const union = (a, b = [], options) => boolean('union', ClipType.Union, a, b, options);
const intersection = (a, b = [], options) => boolean('intersection', ClipType.Intersection, a, b, options);
const difference = (a, b = [], options) => boolean('difference', ClipType.Difference, a, b, options);
const xor = (a, b = [], options) => boolean('xor', ClipType.Xor, a, b, options);

/**
 * The outline `distance` away from closed shapes or open lines, as an array of
 * rings, holes included, with no self-crossings: where parts of the offset
 * meet, they merge.
 *
 * Closed (the default): a positive distance grows each shape, a negative one
 * shrinks it, and a part thinner than twice the distance disappears. The rings
 * are first merged as `union` merges them, by `fill`, so distance 0 returns
 * that merged outline. A ring's direction does not matter on its own, but
 * overlapping rings wound opposite ways cancel there as in `union`. Open
 * (`closed: false`): each line becomes the band round it, `distance` (at least
 * 0) from its centre line on both sides, ended by `end`: 'butt' (the default),
 * 'square' or 'round'.
 *
 * `join` is 'miter' (the default), 'round', 'square' or 'bevel'. A miter
 * reaching past `miterLimit` (default 4) times the distance is squared off.
 */
function offset(shapes, distance, { closed = true, join = 'miter', end = 'butt', miterLimit = 4, scale = 1000, fill = 'nonzero' } = {}) {
  if (!Number.isFinite(distance)) throw new TypeError('offset: distance must be finite');
  if (!Number.isFinite(miterLimit) || miterLimit < 1) throw new RangeError('offset: miterLimit must be finite and at least 1');
  if (!closed && distance < 0) throw new RangeError('offset: distance must be at least 0 for open lines');
  scaleOf('offset', scale);
  const joinType = pick('offset', 'join', JOINS, join);
  const endType = closed ? EndType.Polygon : pick('offset', 'end', ENDS, end);
  const rule = pick('offset', 'fill', FILLS, fill);
  let paths = toPaths('offset', shapes, scale);
  let far = 0;
  for (const path of paths) for (const q of path) far = Math.max(far, Math.abs(q.x), Math.abs(q.y));
  if (far + Math.abs(distance * scale) * Math.max(miterLimit, 2) > LIMIT) {
    throw new RangeError(`offset: distance ${distance} at scale ${scale} reaches past ${LIMIT} grid units; use a smaller scale`);
  }
  if (!closed && distance * scale < 0.25) return [];
  // Clipper2 reads every ring's winding from the lowest one, so rings wound
  // otherwise would be lost; merged rings wind as the booleans' results do.
  if (closed) paths = Clipper.BooleanOp(ClipType.Union, paths, new Paths64(), rule);
  const co = new ClipperOffset(miterLimit);
  co.addPaths(paths, joinType, endType);
  const out = new Paths64();
  // Clipper2 takes an open line's delta as the band's full width.
  co.execute(distance * scale * (closed ? 1 : 2), out);
  return fromPaths(out, scale);
}

module.exports = { union, intersection, difference, xor, offset };
