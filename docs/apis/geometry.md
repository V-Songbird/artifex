---
type: api_spec
summary: "Defines segment queries, open-polyline offsets, triangulation, Delaunay and Voronoi, the point index, inner circle and Poisson-disk scatter, their degenerate cases, numerical limits, and example consumers."
related_files: ["core/geom.js", "core/mesh.js", "core/spatial.js", "examples/pattern.js", "examples/packing.js", "tests/geom.test.js", "tests/geometry-consumers.test.js", "tests/negative.js"]
---

# Segment queries, offsets, meshes and spatial helpers

Import these subject-independent helpers from `core/geom.js`. Points are finite two-element `[x, y]` arrays. Inputs are not mutated and returned points are independent arrays. Invalid points throw `TypeError`; coordinate-difference, length, distance or output overflow throws `RangeError`.

These operations use JavaScript double arithmetic. Segment calculations avoid squaring unscaled lengths, so uniformly tiny or large geometry is supported. No snapping tolerance is applied.

`segmentIntersection` and `pointInPoly` decide with exact orientation predicates (Shewchuk's adaptive method, vendored from robust-predicates in `core/robust-predicates.js`). Whether two segments meet, touch or overlap, and which side of an edge a point lies on, is correct even one ulp from a degenerate case. A crossing point that is not an input endpoint is still computed in doubles. The other operations are not exact: near-collinear data, extreme ratios of coordinate magnitudes, or detail smaller than the precision at its coordinate origin can lose accuracy there. Do not treat this API as a robust polygon-boolean kernel.

## Closest point and distance

`closestPointOnSegment(p, a, b)` returns `{ point, t, distance }` for the **closed segment** from `a` to `b`.

- `t` is the projection parameter clamped to `[0, 1]`.
- `point` is `a` at `t = 0`, `b` at `t = 1`, or their interpolated point.
- `distance` is the Euclidean distance from `p` to that returned point, including when the projection lies beyond an endpoint.
- If `a` equals `b`, the result is a copy of `a`, `t: 0`, and distance to `a`.

```js
closestPointOnSegment([6, 3], [0, 0], [4, 0]);
// { point: [4, 0], t: 1, distance: Math.sqrt(13) }
```

`examples/packing.js` uses distance to every polygon edge, including the closing edge, to size each interior dot from actual boundary clearance instead of the form's outer growth budget. Its target radius is 14% of clearance with a 1.1-unit minimum, capped at 80% of clearance. Dots narrower than a radius of 0.5 design units are omitted. Testing only the centre with `pointInPoly` would not ensure the entire disc stays inside a concavity.

## Segment intersection

`segmentIntersection(a, b, c, d)` includes both segments' endpoints and returns:

| Result | Meaning |
| --- | --- |
| `null` | Disjoint, including parallel separated segments and disjoint collinear segments. |
| `{ type: 'point', point: [x, y] }` | One crossing, shared endpoint, T junction, collinear touch, or zero-length segment lying on the other. |
| `{ type: 'overlap', points: [[x0, y0], [x1, y1]] }` | A positive-length collinear overlap, with its two endpoints ordered in the direction from `a` to `b`. |

An overlap retains input endpoint coordinates. Reversing the first segment reverses overlap order. Two zero-length segments intersect only if their points coincide; a zero-length segment outside the other segment does not intersect it. Returned points do not alias any input.

```js
segmentIntersection([0, 0], [6, 0], [8, 0], [2, 0]);
// { type: 'overlap', points: [[2, 0], [6, 0]] }
```

`examples/pattern.js` pins each of its existing hot-node accents to the nearest crossing of two visible heavy-ink paths within one fifth of a cell. Overlaps are not single crossing anchors. Without a local crossing it retains the node position. `state.accentCentres` records the positions used to draw the beads. The wallpaper group and motif stamping remain unchanged.

## Open-polyline offset

`offsetPolyline(points, distance, miterLimit = 4)` returns a single open point array. The third argument may also be `{ miterLimit, clean }`: where the line bends tighter than the offset on its inner side, the offset runs backwards and draws a loop, and `clean: true` drops every offset point that steps against the way the source runs there, so the bend gives a plain corner. Both end points are always kept, and without `clean` the result is unchanged. Positive distance follows the left normal `(-dy, dx)` of travel; negative distance follows the right. In canvas coordinates, positive y points downward, so a rightward horizontal line offsets downward for positive distance.

- Ends are butt ends: shifted along the first/last segment's normal, without extension or a closing cap.
- Interior joins use the intersection of adjacent offset lines (miter). If the vertex-to-join distance would exceed `abs(distance) * miterLimit`, the output emits the two shifted endpoints (bevel).
- `miterLimit` must be finite and at least 1, `distance` must be finite, and `clean` must be `true` or `false`.
- Exact consecutive duplicate points collapse before offsetting, including for zero distance.
- Empty input returns `[]`. One unique point returns its copy unchanged because no direction exists. Zero distance returns a copy of the deduplicated input.
- Straight runs retain their shifted vertex. An exact reversal emits a bevel between the opposite normals; no infinite miter is produced.
- All joins obey the same rule on both sides, including concave turns. Self-intersections and folds remain in the result. No polygon union, trimming, closed-ring offset or topology repair is performed. Repeating the first point at the end still describes an open run with separate butt ends.

```js
offsetPolyline([[0, 0], [10, 0], [10, 10]], 2);
// approximately [[0, 2], [8, 2], [8, 10]]
```

For a closed-shape offset, or a band round a line that merges where it meets itself, use `offset` from `core/clip.js`: see [polygon booleans and offsets](piece-api.md#polygon-booleans-and-offsets).

`examples/pattern.js` constructs both borders of a bowed arm with equal signed offsets, before applying the lattice transform. Border segments stay at constant perpendicular distance from the sampled centre line in lattice coordinates. Sheared lattice transforms also shear this width; screen-space width is not promised.

## Triangles, Delaunay and Voronoi

Import these three from `core/mesh.js`, kept apart so a page that never uses them does not carry them. They come from vendored libraries, kept as published in `core/` with their licences beside them: earcut 3.2.4, Delaunator 5.1.0 (on the exact predicates above) and d3-delaunay 6.0.4, all ISC. Rings are arrays of `[x, y]` points with the closing point not repeated.

| Function | Returns |
| --- | --- |
| `triangulate(outer, holes = [])` | `[a, b, c]` point triples covering `outer` minus each hole exactly, copies of the input points. No point is added. |
| `delaunay(points)` | `{ triangles, hull }`: index triples into `points` with no point inside any triangle's circumcircle, and the convex hull's indices in order. A repeated point is in no triangle; fewer than three points, or all on one line, give no triangles. |
| `voronoi(points, bounds)` | One ring per point, clipped to `bounds` `[x0, y0, x1, y1]`: the region nearer that point than any other. A repeated point's ring is empty. |

Triangle winding is not promised. Too few points or a bad `bounds` throws `TypeError` naming the function; a non-finite point throws the same `geometry:` error as `core/geom.js`.

```js
triangulate([[0, 0], [10, 0], [10, 10], [0, 10]], [[[3, 3], [7, 3], [7, 7], [3, 7]]]).length;
// 8
voronoi([[2, 2], [8, 8]], [0, 0, 10, 10]);
// [[[0, 0], [10, 0], [5, 5], [0, 10]], [[10, 10], [0, 10], [5, 5], [10, 0]]]
```

## Point index, inner circle and Poisson-disk scatter

Import these three from `core/spatial.js`, kept apart from `core/geom.js` like `core/mesh.js`. They come from vendored libraries, kept in `core/` with their licences beside them: kdbush 4.1.0 and polylabel 2.1.0 with its queue tinyqueue 3.0.0, all ISC, and fast-2d-poisson-disk-sampling 1.0.3, MIT. The scatter's one change from the published code: it must be given a random source, and has no fallback to `Math.random`.

| Function | Returns |
| --- | --- |
| `pointIndex(points)` | An index built once over `points`. Its `within(p, r)` returns the indices into `points` of every point at distance `r` or less from `p`, in ascending order: the same list as testing each point. |
| `innerCircle(outer, holes = [], precision = 1)` | `{ centre, radius }`: the largest circle inside `outer` and outside each hole, found by polylabel. `radius` is the distance from `centre` to the nearest edge, within `precision` design units of the largest possible. |
| `poissonDisk(R, name, bounds, radius)` | Points inside `bounds` `[x0, y0, x1, y1]`, no two closer than `radius`, added until no tried candidate fits; a small gap can remain, mostly at the edges. |

- `within` costs about the number of points it returns, not the number of points in the index. In one measurement over 100,000 points, 2,000 queries of radius 10 took 17 ms through the index and 1,206 ms as a scan of every point.
- `innerCircle` takes rings with the closing point not repeated; their winding does not matter. Its centre suits a mark that must stay clear of the edges, even in a bent shape whose `centroid` falls outside it. When the narrower side of the outer ring's box is no wider than `precision`, it returns the box's top-left corner with radius 0.
- `poissonDisk` uses Bridson's method. Every random number it uses is `R(name, 'poissonDisk', i)`, for `i` counting from 0, so the same seed and `name` give the same points in the same order. The closest pair is `radius` apart, to within rounding. The number of points follows from the bounds and the radius: about 0.9 × width × height / radius². A radius so small that (width / radius) × (height / radius) passes about 2 million throws `RangeError`.

Too few points, a bad `bounds` or a bad `R` or `name` throws `TypeError` naming the function; a non-finite point throws the same `geometry:` error as `core/geom.js`; a bad radius or precision throws `RangeError` naming the function.

The sample requires `artifex/core/...`, which the Artifex tools resolve for a piece they load; a plain Node `require` does not, so load such a piece with `loadExternal` ([external pieces](../knowledge/command-line-tools.md#external-pieces)).

```js
const { rng } = require('artifex/core/rand.js');
const { pointIndex, innerCircle, poissonDisk } = require('artifex/core/spatial.js');
const pts = poissonDisk(rng(3), 'seeds', [0, 0, 200, 100], 8);
const near = pointIndex(pts).within(pts[0], 20); // 0, pts[0] itself, and its neighbours' indices
innerCircle([[0, 0], [100, 0], [100, 60], [0, 60]], [[[20, 10], [50, 10], [50, 50], [20, 50]]], 0.01);
// { centre: about [75, 29], radius: about 25 }: in the 50-wide band right of the hole
```

## Verification

`node --test tests/geom.test.js tests/geometry-consumers.test.js` covers the query contracts, triangulation area and containment, the empty-circle and hull properties, Voronoi tiling and nearness, point-index queries against a scan, the inner circle against a grid search, the scatter's spacing, fill and seed, input ownership, scales, degenerate cases, offset bounds, and the consumers' geometric effects. `npm run negative` checks named assertions against mutations of clamping, parallel/collinear/contact/degenerate handling, normal direction, repeated vertices and the miter limit. `npm run examples` emits SVGs; inspect actual renders of `pattern` and `packing` for composition. Numerical checks alone do not establish artistic quality.
