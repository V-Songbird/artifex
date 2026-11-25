---
type: knowledge
summary: "Artifex's geometry, path and field helpers and their traps: clipping runs, variable-width stroke outlines, segment queries, offsets, polygon booleans, even scatters, point neighbours and inner circles, isolines, streamlines, resampling, Bézier and corner-spline sampling, height-field shading and capped placement loops, creased and tiling noise; read before a piece clips, offsets, resamples, places marks, draws a line that varies in width or draws a field."
related_files: ["skills/artifex/SKILL.md", "core/geom.js", "core/mesh.js", "core/spatial.js", "core/clip.js", "core/path.js", "core/field.js", "core/rand.js", "docs/apis/geometry.md", "docs/apis/fields.md"]
---

# Geometry and fields

## Contents

- [Variable-width strokes](#variable-width-strokes)
- [Traps](#traps)

Read this with [the core skill](../SKILL.md) when a piece uses `core/geom.js`,
`core/path.js` or `core/field.js`.

**`clipPolyline` returns RUNS, not one line.** A line that leaves the design box
and comes back is two marks; joining them draws a stroke across the middle of
the picture that you never asked for, and a plotter draws it too.

For segment query results and bounded open offsets, read the
[geometry API](../../../docs/apis/geometry.md). Intersections distinguish a single
point from a collinear overlap. `offsetPolyline` keeps self-intersections and
uses limited miter joins with bevel fallback.

**Booleans and outlines at a distance** come from `core/clip.js`. `union`,
`intersection`, `difference` and `xor` combine closed shapes. `offset` draws
the outline round a shape, or the band round a line with `closed: false`, and
merges it where its parts meet, so it never crosses itself: use it for a halo,
an inset border or a line thickened into a shape, and `offsetPolyline` only
for one side of a line, point for point. Results are rings, holes wound the
other way: fill all of a result's rings as one path. Grown by `k` and shrunk
by `k` again with round joins, `offset(offset(rings, k, { join: 'round' }), -k, { join: 'round' })`,
a union fills each inside corner with an arc of radius `k` and keeps its
convex edges where they were: the outline a smooth union gives in a distance
field. Coordinates are rounded
to 1/1000 of a design unit by default; see
[polygon booleans and offsets](../../../docs/apis/piece-api.md#polygon-booleans-and-offsets).

**Meshes and cells** come from `core/mesh.js`. `triangulate(outer, holes)` cuts a shape into triangles
that cover it exactly, so a fill can shade per triangle or a picture can bend
with a mesh. `delaunay(points)` joins scattered points into the fattest
triangles they allow: the net behind cracked glaze, a low-poly surface, or the
links of a network. `voronoi(points, bounds)` gives each point the region
nearest to it: cells, stones, scales, territories, a stained-glass lead. Lloyd
relaxation, moving each point to its cell's `centroid` and asking again, evens
a clumpy scatter into an organic one; three or four rounds are usually enough.

**Even scatters, neighbours and inner circles** come from `core/spatial.js`.
`poissonDisk(R, name, bounds, radius)` scatters points no closer than `radius`
with no grid in them, already even without Lloyd rounds; the radius, not a
count, sets how many come out, about 0.9 × area / radius². `pointIndex(points).within(p, r)`
finds the points within `r` of `p` without testing each one: neighbour links,
marks that react to those nearby, spacing checks over thousands of marks.
`innerCircle(outer, holes)` gives the largest circle inside a shape: where a
mark sits clear of the edges, and how large it can be, even when the shape's
`centroid` falls outside it. See the
[geometry API](../../../docs/apis/geometry.md#point-index-inner-circle-and-poisson-disk-scatter).

For fields that end in drawing paths, read the [field API](../../../docs/apis/fields.md).
`isolines` returns raw segments and chained paths in grid coordinates;
`streamline` walks scalar angles or vector directions with a fixed spatial step.
`gradient` and `curl` differentiate a caller-supplied scalar field with a finite
difference step in that field's coordinate units.

## Variable-width strokes

A canvas stroke and an SVG stroke each have one width, so a line that swells
and tapers is drawn as a filled outline. `outline(pts, width, options)` from
`core/path.js` returns that outline as one closed polygon; pass it to `fill`.

```js
const { fill, outline } = require('artifex/core/path.js');
const { resample } = require('artifex/core/geom.js');
// Widest in the middle of the arc, 0 at both ends.
fill(g, outline(resample(pts, 2), (u) => 6 * 4 * u * (1 - u)));
```

- **`width`** is the full width, in design units. Give it as a function of
  `u`, the share of the line's length from the first point (0) to the last
  (1), or as an array with one width per point. `u` is measured along the
  length, so a swell stays where you put it even where the points bunch.
- **The width changes in straight steps between points.** Resample a long or
  sparse line first, as above, or a swell shows as facets.
- **Ends.** `cap: 'round'` (the default) adds half a circle at each end;
  `cap: 'butt'` stops square at the end point. A width of 0 at an end closes
  the outline to a point there, which is a tapered end, and no cap is added.
- **Corners.** Each segment is a band whose width runs straight from one
  point to the next, and the outline joins the bands' edges. The outside of a
  turn mitres, and is cut flat beyond `miterLimit` (default 4) times the
  half-width, as `offsetPolyline` does. The inside is cut where the edges cross
  when both bands cover that corner; otherwise the outline folds back through
  the point and overlaps itself. That happens at a sharp turn on short
  segments and all along a curl tighter than the half-width, such as a swell
  round a small loop. Fill with the default nonzero rule and every band is
  covered; `'evenodd'` leaves holes where the outline overlaps itself. Draw
  the outline with `fill`, not `stroke`: its edge runs into the folds.
- **Closed shapes.** `closed: true` draws round a loop: the last point joins
  the first like any other corner, so no cap, taper or seam marks where the
  loop starts, and `cap` is ignored. `u` runs from 0 at the first point round
  to 1 back at it, so give a width whose value at 0 equals its value at 1. The
  result is a ring: `fill` paints the band and leaves the inside empty, and a
  band wider than the shape fills its middle too. A
  closed outline needs three distinct points; a repeated first point at the
  end is dropped.
- **Refusals.** Fewer than two distinct points, a negative or non-finite
  width, an array of the wrong length or an unknown `cap` throws. Repeated
  points collapse to one, which keeps the first point's width; in a per-point
  array, the width of a point that collapses into an earlier one is never
  read, so a bad value there is not refused. Draw a dot as a circle.

`ribbon(pts, widthAt)` in `core/geom.js` does less than `outline`.
Use `outline` for a variable-width mark, open or closed. Use `ribbon` when
you need the offset sides point for point or build the ends yourself: its
result is the left side, one point per input point in order, then the right
side reversed, so `ribbon(pts, w).slice(0, pts.length)` is a line offset
beside `pts`, and you add whatever end a nib, brush or cut edge needs.

- **Straight runs match.** `ribbon` takes a half-width per point index,
  `widthAt(i, n)`, and adds no caps. Along a straight run it returns the same
  polygon as `outline` with `cap: 'butt'` and a per-point array of twice those
  half-widths.
- **Turns differ.** `ribbon` moves each point along the normal of the line
  between its two neighbours, so the band thins at a turn. With evenly spaced
  points, as after `resample`, a right angle leaves about 0.71 of the
  half-width; uneven spacing thins it further, measured from the shorter segment.
  `outline` mitres the outside and keeps the full width.
- **`ribbon` checks only the point count.** Fewer than two points throws; a
  negative width swaps the two sides instead of throwing, and it has no
  closed form.

## Traps

- **Wind every ring of one operand the same way before a union.** Under the
  default `nonzero` fill, rings passed together in one argument add their
  windings, so where a clockwise ring overlaps a counter-clockwise one the sum
  is zero and the overlap comes back as a hole. Rings built by different
  routes, such as an ellipse sampled by angle and a hull built by its own rule,
  often wind opposite ways. Reverse each ring whose signed area is negative
  first, or pass the shapes as separate arguments, since `union(a, b)` fills
  each operand on its own: two overlapping 10-unit squares, one reversed, give
  150 square units through `union([a, b])` and 175 through `union(a, b)`.
- **Preserve straight runs when resampling.** Curvature-based resampling can drop
  a two-point stroke below a station minimum, removing a letter's crossbar or
  another straight feature. Retain its endpoints.
- **Smooth through the points when marks sit on them.** `core/geom.js` has two
  smoothers, and they treat the input points differently:
  - `chaikin(pts, passes, close)` cuts every corner. The line moves about a
    quarter of the way inside each turn and never leaves the hull of the
    points. Use it for an outline or a traced contour, where no mark sits on
    the points.
  - `catmullRom(pts, samples, close)` passes through every input point: input
    `i` is output `i * samples`. Use it for a line drawn through seeded turns
    with masses or marks placed at them. It swings outward past every turn,
    even when all spans are equal. The swing is largest at a right-angle turn,
    up to about an eighth of a span, and smaller at gentler or sharper turns.
    Very uneven span lengths can also make it loop or cusp. For a line that
    stays inside the hull, `chaikin` guarantees it; with `catmullRom`, check
    the swing in rendered output.
  - `catmullRom(pts, samples, close, { alpha: 0.5 })` is the centripetal
    curve through the same points. It never loops or cusps inside a span,
    however uneven the spans, and swings out less where a long span meets a
    short one. Use it for points a hand, a tracer or a simulation placed
    unevenly. `alpha: 0`, the default, is the uniform curve above, and evenly
    spaced points give the same curve at any `alpha`.

  Both keep an open line's first and last points. For `catmullRom`, an open
  line through `n` points gives `(n - 1) * samples + 1` points, and a closed
  ring gives `n * samples` points and does not repeat its first point.
- **Mix sharp corners and curves in one line with `spline` or `bezier`.**
  `catmullRom` rounds every point, so a shape with one sharp point among smooth
  turns would otherwise be split by hand. Both helpers in `core/geom.js` return
  points about `spacing` apart, ready for `outline` and `fill`:
  - `spline(pts, spacing, { corners, close })` is the `catmullRom` curve
    through `pts`, except at the indices listed in `corners`. At a corner each
    span takes its direction from itself alone, so the line turns sharply there.
    `alpha: 0.5` makes it the centripetal curve, for unevenly spaced points.
  - `bezier(path, spacing, close)` samples a start point followed by segments
    that take the same points as the canvas calls: `[end]` for a line,
    `[control, end]` for a quadratic, `[control1, control2, end]` for a cubic.

  Both copy every input point (`spline`) or segment end (`bezier`) exactly, and
  cut each span into the fewest equal steps that fit within `spacing`, so no
  short step sits just before a corner. Steps are measured on a finer polyline,
  so one can run a small fraction of a percent over `spacing`; treat it as a
  target, not a hard limit. `close: true` joins the end back to the
  start without repeating the first point, as `outline(pts, width, { closed:
  true })` expects.

  ```js
  const { spline } = require('artifex/core/geom.js');
  const { fill, outline } = require('artifex/core/path.js');
  const pts = spline([[0, 0], [40, -10], [60, 0], [40, 10]], 1, { corners: [2], close: true });
  fill(g, outline(pts, () => 3, { closed: true })); // inked ring, inside empty
  // Alternative to the ring: fill(g, pts) draws a solid region instead.
  ```
- **Clean a sampled stroke with `fitBezier`, not by dropping points.** A
  stroke that was traced, recorded or simulated carries the jitter of its
  samples. Dropping points leaves straight runs with a bend at each kept
  point. `fitBezier(pts, tolerance, { corners })` in `core/geom.js` returns
  the few cubic curves that pass within `tolerance` of every point, as a path
  `bezier` takes, smooth at each join and exact at both ends. Set `tolerance`
  near the jitter: 200 samples of a wave with half a pixel of jitter fit in 4
  or 5 curves at 2 to 4 pixels, turning no more than the wave itself. List a
  sharp turn's index in `corners`, or the fit rounds it.

  ```js
  const { fitBezier, bezier } = require('artifex/core/geom.js');
  const clean = bezier(fitBezier(samples, 2), 1); // points 1 apart, for outline or fill
  ```
- **Curvature is not occlusion.** A Laplacian measures local curvature rather
  than visibility and can produce bright centres and dark rings unrelated to
  blocked light. When estimating ambient occlusion from a height field, use
  visibility information, such as a horizon sweep.
- **A fixed attempt cap keeps a placement loop finite and its shortfall
  visible.** A loop that retries on overlap until the count is met spins
  forever once the space is full; one that stops quietly leaves a thinner
  picture than its parameters promise. Propose a fixed number of
  candidates, each from `R` addressed by its index, as `examples/packing.js`
  proposes `TRIES`, and keep in state how many were asked for and how many were
  placed, so a contact sheet or a test can see the shortfall.
- **An orientation is walked with `axial: true`.** A field that names a line,
  not a way along it, may give a vector at one point and its opposite at the
  next: the [structure of an image](images-in.md) is one, and so is any grain.
  A plain walk turns back at each flip. With `axial: true` it keeps the way
  it is heading, and `heading` picks which of the two ways it starts.
- **`separation` keeps streamlines apart from each other.** Hatching,
  fur, grain and plotter line fields call
  `streamlines(field, seeds, { separation, minLength })`, not a loop of
  `streamline`: seeds run in order, a seed near an earlier trace does not
  start, a trace stops before it comes within `separation` of an earlier one,
  and one shorter than `minLength` is dropped. The seed list is the attempt
  cap: make it a fixed grid or `R`-addressed list, and keep the count of empty
  entries in state as the shortfall. Keep `step` under half of `separation`,
  because only points are spaced: segments can come `step` closer. A trace is
  not kept apart from itself, so a closed or spiralling flow can bring one
  back near its own earlier points.
- **`evenStreamlines` lays lines that are the picture.** Seeded traces end
  wherever a flow narrows, so grain, hair or hatching round a form comes out
  as short dashes. `evenStreamlines(field, bounds, { separation })` walks
  each line both ways from its seed, ends it only at half of `separation`
  from another, and seeds each line's neighbours first: the lines run long
  and part round an obstacle as one family. It needs no seed list and no
  random source; `minLength` drops the stubs.
- **Tone can be dots, and a branching form can be grown.** `stipple` of
  `core/grow.js` turns any tone into dots that crowd where it is dark and
  sit evenly apart, for shading that survives as an SVG. `colonise` grows
  lines from roots towards attractors the piece places, and gives each
  piece a width that adds up from the tips, so the form follows where the
  attractors lie and never looks drawn branch by branch. See
  [growth by rule](../../../docs/apis/grow.md).
- **A painted shape bends along its length, not at a hinge.** A leaf, a
  sleeve, a tail or a body drawn as one outline that only turns at joints
  reads as a cut-out. Mesh the outline once (`shapeMesh` of
  `core/deform.js`), pin a few of its points and move the pins by the
  playhead: `deformer` moves the rest so every small piece keeps its size
  and form. Plant two pins close together where the shape is held, so it
  keeps a direction there, and never drag one lone pin far. See
  [shapes bent by pins](../../../docs/apis/deform.md).
- **An object seen from a chosen angle is modelled, not guessed.** Drawing
  a building, a vehicle or a piece of furniture in perspective point by
  point goes wrong at the first hidden edge. Build it once from `box`,
  `prism`, `cylinder` and `loft` of `core/solid.js`, set a `camera`, and
  `outlines` returns its outline, crease and boundary lines as paths with
  the hidden parts cut away, each with its depth. The style's own marks
  then draw them: heavier for the outline and for what is near, dashed or
  left out for what is hidden. A rounded form is built from `ellipsoid`
  parts instead: `hullOutline` gives the exact outline of one, or of the
  smooth hull round several, as a ring that `union` merges with the rest.
  To tone or shadow the same solids, `bvh` casts rays at them: the face a
  ray meets, whether a light reaches a point, how open the sky is above it.
  See [solids drawn as lines](../../../docs/apis/solids.md).
- **`worley2` and `turbulence` have creases by design.** `f1`, `f2` and each
  folded octave change slope abruptly along cell edges and fold lines, so
  `gradient`, `curl` or `streamline` read off them turn sharply there. Feed a
  flow field from `gradient2`, and keep the creased noises for values: cells,
  cracks, veins, masks.
- **A seamless tile is a whole number of lattice cells.** `periodic2` repeats
  over `px` and `py` lattice units, not design units. For a tile `T` units wide
  with `n` features across, sample at `x * n / T` with period `n`; a tile whose
  width is not a whole number of periods at the sampling scale shows a seam.
