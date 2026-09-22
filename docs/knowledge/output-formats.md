---
type: knowledge
summary: "Explains Artifex's page, PNG, SVG, and WebM outputs and the checks and limitations of each format."
related_files: ["core/render.js", "core/webgpu-preview.js", "core/surface-vector.js", "examples/inversion.js", "examples/pixel-field.js", "tools/build-page.js", "tools/piece-input.js", "tools/contact-sheet.js", "tools/render-examples.js", "tests/examples.test.js", "tests/external-piece.test.js", "tests/page-build-errors.test.js", "tests/page-preview.test.js"]
---

# Output formats

A piece keeps one design box and one drawing function. [`core/render.js`](../../core/render.js) applies the selected playhead and scale without changing that design box.

## Interactive page and PNG

`npm run page` bundles the registered examples into `out/index.html`. The page provides example selection, seed and parameter controls, playback, and PNG export at 1x, 4x, and 8x. PNG export redraws into an offscreen canvas at the requested resolution.

`npm run page -- ./piece.cjs` instead selects one external CommonJS piece and writes `piece-page.html` beside its source. It provides the same controls and exports. `npm run seeds -- ./piece.cjs 9 0.5` writes `piece-seeds.html` beside the source for comparison. See [external pieces](development.md#external-pieces) for invocation from another project, bundled dependency limits and parameter sweeps.

A failed build has no renderable frame or export recipe. The page clears stale artwork, keeps the original error visible, and disables playback and exports until the piece rebuilds successfully or another valid piece is selected. It does not export partially built geometry.

The rendering API accepts any positive finite scale, subject to the destination surface's resource limits. Higher resolution should preserve the composition. Increase only the detail whose purpose depends on output resolution.

The page defaults to **CPU reference**. Raster-only pieces with an explicit
`webgpu-pixels` preview descriptor also expose **GPU preview**, an approximate
opaque pixel renderer. PNG, WebM, contact sheets and reference recipes always
use the original CPU `draw`; GPU mode does not change exported pixels or SVG
eligibility. Native browser support and an eligible hardware adapter are required.
Unavailable adapters, software adapters, insufficient limits, shader errors,
timeouts and device loss fall back to the current CPU frame. The status explains
the fallback and the renderer control can retry it.

GPU preview is capped at 4096 pixels per axis and 8,294,400 pixels total. It uses
a separate GPU canvas and includes the copy to the visible canvas in preview
timing. Those limits apply to preview only. See the [piece API](../apis/piece-api.md#optional-webgpu-pixel-preview)
for the supported authoring ABI, lifetime and measurement limits.

The `pixel-field` example evaluates seeded value noise, domain warp and advection
per output pixel. Its CPU renderer allocates ImageData at the destination raster
size; increasing export resolution increases CPU work and allocation. Its shader
implements the same field with float32 arithmetic. This example has no vector
output and its eight-second timeline is not a seamless loop.

## SVG

`renderVector(piece, options)` requires the piece to declare vector output. The vector surface supports path geometry and refuses unsupported raster operations by name. A raster-only piece remains a valid piece.

`npm run examples` writes SVG files for registered vector examples. The browser page also exposes SVG export when the selected piece declares it. The API renderer embeds a replay manifest; the page's SVG button currently serializes a separate vector surface without attaching that manifest.

Ellipses and circles use native SVG `A` commands under a nonzero similarity transform: uniform scale with rotation or reflection. Reflection reverses the sweep; full circles use two arcs. Nonuniform scale, shear, singular transforms and radii that are zero or serialize as zero retain the cubic approximation. Coordinates and ellipse-axis rotation are rounded to four decimal places; nearly complete turns whose serialized endpoints coincide are split to keep them visible.

Identical input angles produce an empty sweep. Unequal whole-turn angles that normalize to zero retain a full traversal, matching the installed Edge comparison. SVG and Canvas antialiasing can differ for transformed ellipses. Stroke widths still use `sqrt(abs(det))`.

### Resolution-dependent detail in the inversion example

[`inversion.js`](../../examples/inversion.js) reflects circles in three disjoint circular mirrors using closed-form centers and radii, then emits arcs. Its depth-first traversal stops before drawing a circle whose diameter is below 1.4 output pixels. On native Canvas, it reads the current transform to account for PNG export scale; shared circles keep identical design coordinates and stroke widths as finer circles appear.

`VectorSurface.getTransform()` and the benchmark null surface return detached numeric `{a,b,c,d,e,f}` snapshots of the current affine transform. The snapshots are mutable, but editing one cannot change the surface; they have no `DOMMatrix` methods. Inversion uses this portable scale reader to add smaller circles at higher output scale without changing shared geometry. Surfaces without a reader use scale 1.

Ordinary SVG export uses the identity transform and retains the design-resolution cutoff. Enlarging that saved SVG preserves its geometry rather than regenerating detail. All outputs also stop after twelve reflections per root circle, bounding the traversal to 24,573 circles and thirteen live recursion levels even at extreme output scales.

## WebM

The page offers WebM export for animated pieces. The implementation requires `MediaStreamTrackGenerator`, `VideoFrame`, and `MediaRecorder` with VP8 WebM support. Availability must be checked in the browser used for delivery.

The exporter walks the piece's frame grid and paces frames at its declared rate. Rendering and encoding are measured separately. Before returning a result, it parses the recorded WebM blocks and validates frame count and spacing. A rejected export displays an error instead of downloading a result.

A timeline with one frame still requires exactly one recorded frame, but has no spacing interval to validate. Its report uses zero for the gap statistics and `1 / hz` seconds for the frame's declared interval. This reported duration does not independently measure playback duration in a video player.

`window.__artifex.video()` returns the export report and blob without saving a file. The page's video button downloads that result. A still has no video timeline and cannot use this exporter.

A completed build or Node suite does not verify the browser's encoder, download behavior, or how the saved video looks. Validate those in the target browser using the saved file.

## Inspection and reproducibility

The page exposes `window.__artifex` for selecting examples, reading current state, inspecting named build stages, and retrieving replay metadata. `inspect(stage)` returns a summary instead of copying raw typed arrays or geometry.

The replay manifest records the library version, piece name, seed, parameters, dimensions, declared outputs, and quantized playhead. It contains neither the timeline definition nor a copy of the piece source. Replaying it requires the corresponding code, input data, and execution environment.

Review multiple seeds in rendered output. SVG equality, frame counts, and pixel statistics establish different properties; none establishes artistic quality by itself.
