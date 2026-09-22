---
type: api_spec
summary: "Shows a runnable custom Artifex piece and the public validation, solving, and rendering entry points."
related_files: ["core/piece.js", "core/render.js", "core/webgpu-preview.js", "core/surface-vector.js", "examples/pixel-field.js", "tests/piece.test.js", "tests/render.test.js", "tests/webgpu-preview.test.js"]
---

# Piece API

[`FIELDS` in core/piece.js](../../core/piece.js) is the authoritative contract, including defaults and validation messages. A piece declares `name`, `size`, and `draw`; optional fields add state, build stages, parameters, outputs, a seed, a timeline, and an explicitly authored GPU pixel preview.

## Render a custom piece

From the repository root with the Node.js 22 runtime pinned in `.nvmrc` (the library's minimum remains Node.js 20):

```shell
node -e "const fs = require('node:fs'); const { renderVector } = require('./core/render.js'); const piece = { name: 'first', size: { w: 200, h: 100 }, outputs: ['raster', 'vector'], draw(g) { g.beginPath(); g.moveTo(20, 50); g.lineTo(180, 50); g.stroke(); } }; const result = renderVector(piece, { seed: 1 }); fs.mkdirSync('out', { recursive: true }); fs.writeFileSync('out/first.svg', result.svg); console.log(result.marks, 'mark');"
```

Expected output:

```text
1 mark
```

The command writes `out/first.svg`, containing one horizontal stroke. The piece is a still because it declares no timeline.

## Entry points

| Function | Contract |
| --- | --- |
| `validate(piece)` | Returns a normalized copy or throws `PieceError` naming invalid or unknown fields. |
| `solve(validatedPiece, seed, params, options)` | Creates state, applies parameter overrides, and runs named build stages; stage errors are returned in `stages.error`. |
| `drawFrame(surface, validatedPiece, solved, t, options)` | Draws onto a Canvas2D-shaped surface at a quantized playhead; `options.scale` controls output scale. |
| `renderVector(piece, options)` | Validates, solves, and renders SVG, returning `svg`, `marks`, `seed`, `t`, `stages`, and `manifest`. |
| `playheads(piece)` | Returns the playheads of every distinct drawn frame, or `[0]` for a still. |

Import validation and solving from `core/piece.js`; import the rendering functions from `core/render.js`. `renderVector` accepts seed, parameter, playhead, and background options. It throws when a build stage fails or vector output is unsupported.

## State and time

Parameters declare `{ min, max, value, meaning }`. Validated values reach drawing code through `state.params`. The short `meaning` describes the parameter's visual effect; each declared parameter should affect the output.

`draw(surface, state, t, clock)` receives a normalized, quantized playhead. Use `clock.frame` for frame-indexed simulation snapshots instead of advancing state inside `draw`. `clock` also exposes `frames`, `seconds`, `hz`, and `loop`.

For more than one frame, a looping timeline uses `i/n` and a non-looping timeline uses `i/(n-1)`. A single-frame timeline uses playhead zero. The same helpers define both drawing and export grids.

For fixed source, input data, parameters, output configuration, and execution environment, repeated seed/playhead pairs should produce the same frame. Use addressed randomness from [`core/rand.js`](../../core/rand.js); do not make drawing depend on prior calls or wall-clock time.

See the [runtime skill](../../skills/artifex/SKILL.md) for authoring guidance and [output formats](../knowledge/output-formats.md) for delivery limits.

## Optional WebGPU pixel preview

Raster-only pieces may declare `preview`; its default is `null`. The page starts
with the CPU renderer. The user may select **GPU preview** for an opted-in piece.
`draw` remains required and is the reference for every export and contact sheet.
The optional preview does not translate JavaScript or support vector geometry.

```js
preview: {
  kind: 'webgpu-pixels',
  wgsl: `fn artifexPixel(position: vec2f) -> vec3f {
    let uv = position / vec2f(artifex.size);
    return vec3f(uv, artifex.values[0].x);
  }`,
  uniforms(state, t, clock) { return [state.params.amount]; },
}
```

The shader is trusted author code, limited to 65,536 characters. It defines
`artifexPixel(position: vec2f) -> vec3f`; `position` holds raster pixel centers.
Return encoded sRGB channels in `[0,1]`. The wrapper clamps those channels and
sets alpha to one. Keep its color math consistent with the CPU implementation.
Only the fixed uniform binding is supplied; author-owned buffers, textures,
bindings, features and render passes are not supported.

The exact 96-byte ABI is exported as `HEADER` in
[`core/webgpu-preview.js`](../../core/webgpu-preview.js):

```wgsl
struct ArtifexInputs {
  size: vec2u,
  seed: u32,
  frame: u32,
  time: vec4f,
  values: array<vec4f, 4>,
}
@group(0) @binding(0) var<uniform> artifex: ArtifexInputs;
```

`size` is the raster resolution. `seed` is the exact resolved `solve().seed`;
explicit seed overrides retain the existing JavaScript `>>> 0` normalization,
including negative or fractional overrides. `frame` comes from `clockAt`.
`time` contains quantized playhead, clock seconds, design width and design height.
`uniforms(state, t, clock)` receives the same quantized clock as CPU drawing and
returns an Array or Float32Array containing at most sixteen finite numbers whose
float32 conversions are finite. They fill `values` in order; unused slots are
zero. Float32 rounding is expected. Frames must fit u32; playheads, dimensions
and authored floats must fit finite float32 values.

The page owns a separate GPU canvas and copies only a current completed frame to
its visible Canvas2D surface. It coalesces edits, applies playback backpressure,
and disposes sessions on selection, CPU mode, failure and page exit. A missing
or software adapter, insufficient device limits, shader/allocation failure,
operation timeout or device loss restores the current CPU frame. Select GPU
preview again to retry. Preview dimensions are limited to 4096 per axis and
8,294,400 pixels, and must also fit the requested device's limits. Each asynchronous
GPU operation has a ten-second deadline; late devices are disposed. Export
resolution retains the existing destination-dependent limits.

`window.__artifex.setPreview('cpu' | 'gpu')` selects the page renderer;
`read().preview` reports mode, status, reason when falling back, and the last
presented seed/playhead/parameters. While an edit is pending, the requested
inputs are reported separately and an obsolete completion cannot replace them.
GPU timing reports CPU-side submission, queue completion, validation, presentation
copy and total latency; it is not a hardware timestamp. The allocation proxy
counts one four-byte color surface plus the uniform buffer, not measured VRAM
or the browser's additional surfaces. `manifest()` and recipe URLs keep the
CPU/reference contract; they do not reproduce GPU-specific rounding.

See [`pixel-field.js`](../../examples/pixel-field.js) for matching JavaScript and
WGSL noise/warp implementations. Its named build stage prepares immutable octave
weights, frequencies and normalization shared by the CPU draw and GPU uniforms.
Approximate equality is measured for that
workload, not guaranteed for arbitrary shaders or other hardware.
