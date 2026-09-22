---
type: api_spec
summary: "Defines field sampling, derivative and composition helpers, isoline topology, and fixed-step flow paths; read when turning scalar or vector fields into drawing geometry."
related_files: ["core/field.js", "core/rand.js", "core/geom.js", "examples/contours.js", "examples/drift.js", "tests/field.test.js", "tests/negative.js"]
---

# Fields and paths

Import helpers from `core/field.js`. A scalar field is a pure function `(x, y) => number`; a vector field returns a finite two-element `[dx, dy]` array. Coordinates and finite-difference distances use the field's own units. No helper chooses a noise source, seed, palette, or drawing surface.

## Grid sampling

`sampleGrid(field, cols, rows, bounds = [0, 0, 1, 1])` samples all `(cols + 1) * (rows + 1)` vertices, including the bounds. `cols` and `rows` count cells, must be positive integers, and must yield a safe integer sample count. Samples are stored in row order at `j * (cols + 1) + i`.

Bounds are finite `[x0, y0, x1, y1]` with positive, finite extents. The first sample determines whether the result is a scalar `Float64Array` or an array of copied vector pairs. Every later sample must have the same type. Reusing one array inside a vector callback is safe: sampling copies its values.

```js
const { sampleGrid, isolines } = require('./core/field.js');
const values = sampleGrid((x, y) => x * x + y * y, 80, 60, [-2, -1.5, 2, 1.5]);
const { paths } = isolines(values, 80, 60, [0.25, 1, 2]);
// Convert grid coordinates into a 1000 by 750 drawing domain.
const drawing = paths.map((pts) => pts.map(([x, y]) => [x / 80 * 1000, y / 60 * 750]));
```

## Derivatives and composition

| Helper | Returned field |
| --- | --- |
| `gradient(field, epsilon = 1e-4)` | Vector `[df/dx, df/dy]`, using symmetric samples at `x +/- epsilon` and `y +/- epsilon`. |
| `curl(field, epsilon = 1e-4)` | Vector `[df/dy, -df/dx]` from a scalar potential, tangent to that potential's contours. This is not the scalar vorticity of a vector field. |
| `warp(field, displacement, amount = 1)` | `field(x + amount * dx, y + amount * dy)`, with `[dx, dy]` sampled once at the original coordinates. Scalar or vector output is passed through. |
| `threshold(field, level = 0.5)` | `1` when the scalar value is greater than or equal to the level; otherwise `0`. |

Gradient and curl sample outside the queried point and have no boundary policy. The caller must define the field there. Epsilon must be positive and finite, its doubled value must remain finite, and adding or subtracting it must change each queried coordinate without overflowing. This check rejects a step that rounds to zero; it cannot prevent cancellation or guarantee derivative accuracy. Choose epsilon for the field's scale and normalize extreme coordinate ranges before differentiating. Callback values and resulting derivative components must be finite.

For a noisy potential, `gradient2` from `core/rand.js` avoids the zero normal derivative of value noise on its own lattice lines. The derivative helpers do not inject or replace a noise source.

## Isolines

`isolines(values, cols, rows, levels)` accepts a row-ordered scalar grid with exactly `(cols + 1) * (rows + 1)` finite samples. `levels` is one finite number or an array of them; an empty list returns no paths.

The result is `{ segments, paths }`. `segments` holds the marching-squares two-point segments, in input level and row order. `paths` joins matching endpoints through `chain` from `core/geom.js`. Both use **grid coordinates**, with bounds `[0, 0, cols, rows]`; the sampling domain is not inferred from the values. Map into drawing coordinates after chaining, as `examples/contours.js` does. `segments` and `paths` may share returned point arrays; neither changes the input samples.

Corners strictly greater than a level are on the high side. Equal corners belong to the low side. Crossings use linear edge interpolation. The two ambiguous saddle orientations compare the arithmetic mean of the four corners with the level; equality takes the low branch. Flat cells emit nothing. A contour touching a vertex can produce a zero-length segment; tracing preserves it. There is no smoothing, tolerance welding, plateau-boundary extraction, or asymptotic saddle decider. Ordinary double arithmetic can lose accuracy at extreme value ranges; normalize those inputs. Only emitted edges are used, so flat unused edges do not create nonfinite path points for ordinary finite ranges.

## Streamlines

`streamline(field, start, options)` returns one polyline. Its direction callback returns an angle in radians or a vector. Vector magnitude is ignored; `[0, 0]` stops the walk. This is fixed-distance direction integration, not velocity integration over time.

| Option | Default | Meaning |
| --- | --- | --- |
| `steps` | `100` | Maximum recorded points, a nonnegative safe integer. |
| `step` | `1` | Positive finite distance travelled after each sample. |
| `turn` | `1` | Steering fraction in `[0, 1]`: `1` follows the current direction immediately; `0` preserves the initial heading. |
| `heading` | Initial field direction | Initial angle in radians. |
| `bounds` | Unbounded | Finite `[x0, y0, x1, y1]` with positive extents. Boundaries are inclusive. |

Each iteration records the current point, reads the direction, steers along the shortest angular difference, and advances by `step`. A final advanced point is not appended. Therefore an uninterrupted walk with `steps: n` contains `n` points and `n - 1` visible segments. A zero-vector sample remains the last recorded point. Zero steps or a start outside bounds returns `[]`; a stationary start with positive steps returns `[start]`. Returned points are independent copies.

If an advance leaves the bounds, it is discarded and the walk ends; the path is not interpolated to the boundary. A finite step count is always required even without bounds, and loops are not detected. Fixed-step integration is approximate; smaller steps improve curved flow accuracy while increasing point count. `turn` below `1` deliberately adds directional inertia, as in `examples/drift.js`.

`streamlines(field, seeds, options)` applies the same options independently to each seed and returns one polyline per seed in the original order. Empty walks remain empty entries; paths are never joined across seeds.

```js
const { curl, streamlines } = require('./core/field.js');
const flow = curl((x, y) => (x * x + y * y) / 2);
const paths = streamlines(flow, [[1, 0], [2, 0]], { step: 0.02, steps: 200 });
```

Run `node --test tests/field.test.js` for analytic derivatives, saddle topology, chaining, bounded walks, steering, and numerical-input checks. These tests do not establish visual quality or cross-engine byte identity.
