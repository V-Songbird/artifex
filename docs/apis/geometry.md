---
type: api_spec
summary: "Defines segment queries and open-polyline offsets, their degenerate cases, numerical limits, and example consumers."
related_files: ["core/geom.js", "examples/pattern.js", "examples/packing.js", "tests/geom.test.js", "tests/geometry-consumers.test.js", "tests/negative.js"]
---

# Segment queries and open offsets

Import these subject-independent helpers from `core/geom.js`. Points are finite two-element `[x, y]` arrays. Inputs are not mutated and returned points are independent arrays. Invalid points throw `TypeError`; coordinate-difference, length, distance or output overflow throws `RangeError`.

These operations use JavaScript double arithmetic. Segment calculations avoid squaring unscaled lengths, so uniformly tiny or large geometry is supported, but these are not exact predicates. No snapping tolerance is applied. Near-collinear data, extreme ratios of coordinate magnitudes, or detail smaller than the precision at its coordinate origin can lose accuracy. Normalize such data before using it; do not treat this API as a robust polygon-boolean kernel.

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

`offsetPolyline(points, distance, miterLimit = 4)` returns a single open point array. Positive distance follows the left normal `(-dy, dx)` of travel; negative distance follows the right. In canvas coordinates, positive y points downward, so a rightward horizontal line offsets downward for positive distance.

- Ends are butt ends: shifted along the first/last segment's normal, without extension or a closing cap.
- Interior joins use the intersection of adjacent offset lines (miter). If the vertex-to-join distance would exceed `abs(distance) * miterLimit`, the output emits the two shifted endpoints (bevel).
- `miterLimit` must be finite and at least 1; `distance` must be finite.
- Exact consecutive duplicate points collapse before offsetting, including for zero distance.
- Empty input returns `[]`. One unique point returns its copy unchanged because no direction exists. Zero distance returns a copy of the deduplicated input.
- Straight runs retain their shifted vertex. An exact reversal emits a bevel between the opposite normals; no infinite miter is produced.
- All joins obey the same rule on both sides, including concave turns. Self-intersections and folds remain in the result. No polygon union, trimming, closed-ring offset or topology repair is performed. Repeating the first point at the end still describes an open run with separate butt ends.

```js
offsetPolyline([[0, 0], [10, 0], [10, 10]], 2);
// approximately [[0, 2], [8, 2], [8, 10]]
```

`examples/pattern.js` constructs both borders of a bowed arm with equal signed offsets, before applying the lattice transform. Border segments stay at constant perpendicular distance from the sampled centre line in lattice coordinates. Sheared lattice transforms also shear this width; screen-space width is not promised.

## Verification

`node --test tests/geom.test.js tests/geometry-consumers.test.js` covers the query contracts, input ownership, scales, degenerate cases, offset bounds, and the consumers' geometric effects. `npm run negative` checks named assertions against mutations of clamping, parallel/collinear/contact/degenerate handling, normal direction, repeated vertices and the miter limit. `npm run examples` emits SVGs; inspect actual renders of `pattern` and `packing` for composition. Numerical checks alone do not establish artistic quality.
