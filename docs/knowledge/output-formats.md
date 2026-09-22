---
type: knowledge
summary: "Explains Artifex's page, PNG, SVG, MP4 and WebM outputs, soundtracks, and the checks and limitations of each format."
related_files: ["core/render.js", "core/film.js", "core/webgpu-preview.js", "core/surface-vector.js", "examples/inversion.js", "examples/pixel-field.js", "examples/readout.js", "tools/build-page.js", "tools/check-browser.js", "tools/piece-input.js", "tools/contact-sheet.js", "tools/render-examples.js", "tests/examples.test.js", "tests/external-piece.test.js", "tests/film.test.js", "tests/page-build-errors.test.js", "tests/page-preview.test.js"]
---

# Output formats

A piece keeps one design box and one drawing function. [`core/render.js`](../../core/render.js) applies the selected playhead and scale without changing that design box.

## Interactive page and PNG

`npm run page` bundles the registered examples into `out/index.html`. The page provides example selection, seed and parameter controls, playback, PNG export at 1x, 4x, and 8x, and a film: MP4 export at 1x and 2x, or WebM export where the browser cannot encode the MP4 film. PNG and MP4 export redraw into an offscreen canvas at the requested resolution.

`npm run page -- ./piece.cjs` instead selects one external CommonJS piece and writes `piece-page.html` beside its source. It provides the same controls and exports. `npm run seeds -- ./piece.cjs 9 0.5` writes `piece-seeds.html` beside the source for comparison. See [external pieces](development.md#external-pieces) for invocation from another project, bundled dependency limits and parameter sweeps.

A failed build has no renderable frame or export recipe. The page clears stale artwork, keeps the original error visible, and disables playback and exports until the piece rebuilds successfully or another valid piece is selected. It does not export partially built geometry.

The rendering API accepts any positive finite scale, subject to the destination surface's resource limits. Higher resolution should preserve the composition. Increase only the detail whose purpose depends on output resolution.

The page defaults to **CPU reference**. Raster-only pieces with an explicit
`webgpu-pixels` preview descriptor also expose **GPU preview**, an approximate
opaque pixel renderer. PNG, MP4, WebM, contact sheets and reference recipes always
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

## MP4

The page offers MP4 export for animated pieces at 1x and 2x of the design box. [`core/film.js`](../../core/film.js) draws every frame of `playheads(piece)` into an offscreen canvas and hands it to a WebCodecs `VideoEncoder` with the timestamp `i / hz`. Nothing is paced by the wall clock: a piece that draws slower than its frame rate takes longer to export and still keeps every frame at its declared time. When the piece declares `sound`, its soundtrack is rendered offline and encoded as AAC, or as Opus where the browser's `AudioEncoder` refuses AAC. The file is H.264 video in an MP4 container, with the soundtrack as a second track.

The exporter requires `VideoEncoder` and `VideoFrame`, and for a piece with sound `AudioEncoder`, `AudioData` and `OfflineAudioContext` with AAC or Opus encoding. A piece that declares sound in a browser that encodes neither is refused rather than exported silent. It declares the lowest H.264 level that fits the frame size and rate, trying High then Main profile, and rounds each side up to an even pixel count because 4:2:0 video needs one.

AAC is tried first because more MP4 players play it. An Opus soundtrack follows the Opus-in-ISOBMFF encapsulation: an `Opus` sample entry at 48 kHz holding a `dOps` box converted from the encoder's OpusHead description (RFC 7845). The conversion keeps every field, including the pre-skip, writes them big-endian where OpusHead is little-endian, and sets the version to 0. Each packet's duration is read from its TOC byte. The pre-skip is recorded only in `dOps`; the film has no edit list. A decoder that reads `dOps` drops the pre-skip samples, which are the encoder warming up; installed Edge does. A player that ignores it starts the sound `pre-skip / 48000` seconds late, 6.5 ms for the 312 samples Edge's encoder reports. An encoder that describes no OpusHead is refused before any frame is drawn, because nothing else records the pre-skip. A player without Opus-in-MP4 support cannot play the soundtrack; check the player the film is delivered to.

Every film is limited-range BT.709. An encoder handed a canvas converts it to video colour its own way, and its choice of range can change between exports; platforms that re-encode uploads may mishandle a full-range tag. So the exporter converts each drawn frame to BT.709 limited-range NV12 before the encoder sees it: luma in 16 to 235 and chroma in 16 to 240, BT.709 primaries, transfer and matrix, the canvas's sRGB-encoded values taken as BT.709's R'G'B', one chroma pair per 2x2 block from the block's average, and translucent pixels composited over black. The `colr` box always says primaries 1, transfer 1, matrix 1, full range off. The H.264 stream carries no range of its own, and limited range is also H.264's default for a player that ignores the tag.

Where WebGL2 is available, a shader converts a texture copy of the drawn frame and one readback returns both planes. Before an export uses it, it must reproduce the CPU conversion on a test pattern within one level; otherwise, or without WebGL2, the CPU converts each frame read back from a canvas kept in memory for the whole export, so the browser never switches that canvas's rasterizer part-way through a film. `report.conversion` names the route, `gpu` or `cpu`, and `report.convertMs` its time, which includes waiting for each frame to finish drawing. Reading every frame back costs time: in installed Edge the GPU route took 2.5 to 8.5 ms per frame at 1x and 2x.

Every film carries its replay manifest, so a saved film names the piece, seed and parameters that made it. The manifest is the solve's, as an SVG carries it, with `film: { frames, hz, loop, scale }` where an SVG has the playhead `t`: the number of frames drawn, the frame rate, whether the timeline loops, which puts frame `i` at playhead `i / frames` rather than `i / (frames - 1)`, and the export scale, because a piece may draw finer detail at a higher scale. It is stored in `moov/udta`, the user-data box, as a `uuid` box with extended type `8b2fd966-e923-4330-a28e-6d82587d1ec9`: the box header, the 16-byte extended type, then the manifest as JSON to the end of the box. The JSON is ASCII; any other character is written as a `\uXXXX` escape, so the bytes are also valid UTF-8. ISO/IEC 14496-12 reserves `uuid` for private box types and requires readers to skip box types they do not know, so a player ignores it; installed Edge decodes films that carry it. The box sits in `moov`, before the media data: it moves the chunk offsets and leaves every sample byte unchanged. The readout example's film spends 209 bytes on it. Tag editors and remuxing tools may drop it. `readMp4` returns it as `manifest`, or `null` for a file without one.

Before returning a result, the exporter reads the finished bytes back: exactly one H.264 track, every declared frame, uniform frame durations on the frame grid, the requested size, a first keyframe, the limited-range BT.709 colour tag, every sample inside the media data, the replay manifest equal to the one the export drew with, and, with sound, one AAC track or one Opus track with its `dOps`, within one audio packet of the film's length. An Opus track's pre-skip does not count toward that length. A failed check displays an error and nothing is saved. `window.__artifex.film({ scale })` returns the report and blob without saving a file; the report includes draw, conversion, encode, soundtrack and total times and the ratio to real time, `report.sound.codec` names the soundtrack's sample entry, `mp4a` or `Opus`, and `report.manifest` is the manifest read from the file.

`npm run browser` exports a film this way in installed Edge for every example that declares sound, or for the first with a timeline when none does. For each film it requires the page to offer MP4 and hide WebM, decodes the film, requires the first, middle and last decoded frames to resemble their own drawn frames at least as closely as their neighbours (a held frame ties with an identical neighbour), and requires a declared soundtrack to decode to sound as long as the film. It finds the manifest in the film's bytes with its own scan rather than `readMp4`, and requires it to equal the page's `manifest()` with the frame grid in place of the playhead. It exercises the soundtrack codec the browser chooses, which is AAC wherever AAC encodes, as in installed Edge, and the colour conversion the browser supports, which is the GPU route there. The Opus path and the CPU conversion are checked in Node against controlled encoders. Decoded frames and sound are compared within the tested browser; they are not byte-identical to the drawing.

### Which film the page offers

For an animated piece, the page asks `VideoEncoder.isConfigSupported` about the H.264 configuration the export uses at 1x. `filmConfig(piece, VideoEncoder, { scale })` in [`core/film.js`](../../core/film.js) makes that choice for both the question and the export. The page asks once per design size and frame rate. It starts and draws without waiting for the answer, and shows the MP4 controls until the answer arrives. Where the encoder accepts no configuration, or the browser has no `VideoEncoder` or `VideoFrame`, the page hides the MP4 controls and offers the WebM export instead. A still offers no film. Either film control stays disabled until the piece has a valid build.

`window.__artifex.filmFormat()` resolves to `'mp4'`, `'webm'` or `null` (a still) once the page has applied the answer for the selected piece. The scripted exports do not follow the controls: `film()` still refuses by name where H.264 cannot encode the film, and `video()` still records wherever its recorder APIs exist, so existing scripts keep working. A 2x MP4 can still be refused where 1x encodes; its error names the size and asks for a smaller scale.

## WebM

WebM is the fallback film: the page offers it only for an animated piece whose MP4 this browser cannot encode (see [which film the page offers](#which-film-the-page-offers)). The implementation requires `MediaStreamTrackGenerator`, `VideoFrame`, and `MediaRecorder` with VP8 WebM support. Availability must be checked in the browser used for delivery. It carries no soundtrack, even for a piece that declares one.

The exporter walks the piece's frame grid and paces frames at its declared rate, because `MediaRecorder` stamps frames by the wall clock. A piece whose frames take longer than their budget to draw and encode therefore cannot be recorded; the export measures how far it fell behind its schedule and says so, naming MP4 from a browser that encodes H.264 as the export that keeps every frame. Other work on the same machine can make a light piece miss its schedule too. Rendering and encoding are measured separately. Before returning a result, it parses the recorded WebM blocks and validates frame count and spacing. A rejected export displays an error instead of downloading a result.

A timeline with one frame still requires exactly one recorded frame, but has no spacing interval to validate. Its report uses zero for the gap statistics and `1 / hz` seconds for the frame's declared interval. This reported duration does not independently measure playback duration in a video player.

`window.__artifex.video()` returns the export report and blob without saving a file, whichever film the page offers. The page's video button downloads that result. A still has no video timeline and cannot use this exporter.

The Node page tests cover both offers with stand-in encoders. `npm run browser` exercises only the MP4 offer, because installed Edge encodes H.264. A completed build or Node suite does not verify the browser's encoder, download behavior, or how the saved video looks. Validate those in the target browser using the saved file.

## Inspection and reproducibility

The page exposes `window.__artifex` for selecting examples, reading current state, inspecting named build stages, and retrieving replay metadata. `inspect(stage)` returns a summary instead of copying raw typed arrays or geometry.

The replay manifest records the library version, piece name, seed, parameters, dimensions and declared outputs. An SVG and the page's `manifest()` add the quantized playhead `t`; an MP4 film adds its frame grid and scale in `film`. It contains neither the timeline definition nor a copy of the piece source. Replaying it requires the corresponding code, input data, and execution environment.

Review multiple seeds in rendered output. SVG equality, frame counts, and pixel statistics establish different properties; none establishes artistic quality by itself.
