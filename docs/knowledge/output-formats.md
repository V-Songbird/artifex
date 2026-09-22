---
type: knowledge
summary: "Explains Artifex's page, PNG, SVG, and WebM outputs and the checks and limitations of each format."
related_files: ["core/render.js", "core/surface-vector.js", "tools/build-page.js", "tools/render-examples.js", "tests/examples.test.js"]
---

# Output formats

A piece keeps one design box and one drawing function. [`core/render.js`](../../core/render.js) applies the selected playhead and scale without changing that design box.

## Interactive page and PNG

`npm run page` bundles the registered examples into `out/index.html`. The page provides example selection, seed and parameter controls, playback, and PNG export at 1x, 4x, and 8x. PNG export redraws into an offscreen canvas at the requested resolution.

The rendering API accepts any positive finite scale, subject to the destination surface's resource limits. Higher resolution should preserve the composition. Increase only the detail whose purpose depends on output resolution.

## SVG

`renderVector(piece, options)` requires the piece to declare vector output. The vector surface supports path geometry and refuses unsupported raster operations by name. A raster-only piece remains a valid piece.

`npm run examples` writes SVG files for registered vector examples. The browser page also exposes SVG export when the selected piece declares it. The API renderer embeds a replay manifest; the page's SVG button currently serializes a separate vector surface without attaching that manifest.

## WebM

The page offers WebM export for animated pieces. The implementation requires `MediaStreamTrackGenerator`, `VideoFrame`, and `MediaRecorder` with VP8 WebM support. Availability must be checked in the browser used for delivery.

The exporter walks the piece's frame grid and paces frames at its declared rate. Rendering and encoding are measured separately. Before returning a result, it parses the recorded WebM blocks and validates frame count and spacing. A rejected export displays an error instead of downloading a result.

`window.__artifex.video()` returns the export report and blob without saving a file. The page's video button downloads that result. A still has no video timeline and cannot use this exporter.

A completed build or Node suite does not verify the browser's encoder, download behavior, or how the saved video looks. Validate those in the target browser using the saved file.

## Inspection and reproducibility

The page exposes `window.__artifex` for selecting examples, reading current state, inspecting named build stages, and retrieving replay metadata. `inspect(stage)` returns a summary instead of copying raw typed arrays or geometry.

The replay manifest records the library version, piece name, seed, parameters, dimensions, declared outputs, and quantized playhead. It contains neither the timeline definition nor a copy of the piece source. Replaying it requires the corresponding code, input data, and execution environment.

Review multiple seeds in rendered output. SVG equality, frame counts, and pixel statistics establish different properties; none establishes artistic quality by itself.
