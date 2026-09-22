---
type: api_spec
summary: "Shows a runnable custom Artifex piece and the public validation, solving, and rendering entry points."
related_files: ["core/piece.js", "core/render.js", "core/surface-vector.js", "tests/piece.test.js", "tests/render.test.js"]
---

# Piece API

[`FIELDS` in core/piece.js](../../core/piece.js) is the authoritative contract, including defaults and validation messages. A piece declares `name`, `size`, and `draw`; optional fields add state, build stages, parameters, outputs, a seed, and a timeline.

## Render a custom piece

From the repository root with Node.js 20 or later:

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
