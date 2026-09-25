---
type: api_spec
summary: "Shows a runnable custom Artifex piece and the public validation, responsive-box, solving, rendering, static-layer, colour-dissolve and soundtrack entry points."
related_files: ["core/piece.js", "core/render.js", "core/time.js", "core/film.js", "core/webgpu-preview.js", "core/surface-vector.js", "examples/pixel-field.js", "examples/refit.js", "examples/readout.js", "examples/drift.js", "examples/settle.js", "examples/cues.js", "core/layer.js", "core/sound.js", "core/colour.js", "tests/layer.test.js", "tests/toolkit.test.js", "tests/piece.test.js", "tests/render.test.js", "tests/time.test.js", "tests/sound.test.js", "tests/film.test.js", "tests/webgpu-preview.test.js"]
---

# Piece API

[`FIELDS` in core/piece.js](../../core/piece.js) is the authoritative contract, including defaults and validation messages. A piece declares `name`, `size`, and `draw`; optional fields add state, build stages, parameters, outputs, a seed, a timeline, a soundtrack, an explicitly authored GPU pixel preview, and the range of boxes it recomposes to.

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
| `atBox(validatedPiece, { w, h })` | Returns the piece at another design box it declares in `boxes`, or itself at its own size; throws `PieceError` naming the box and the range it falls outside. See [responsive boxes](#responsive-boxes). |
| `solve(validatedPiece, seed, params, options)` | Creates state, applies parameter overrides, and runs named build stages; stage errors are returned in `stages.error`. |
| `drawFrame(surface, validatedPiece, solved, t, options)` | Draws onto a Canvas2D-shaped surface at a quantized playhead; `options.scale` controls output scale. |
| `renderVector(piece, options)` | Validates, solves, and renders SVG, returning `svg`, `marks`, `seed`, `t`, `stages`, and `manifest`. |
| `playheads(piece)` | Returns the playheads of every distinct drawn frame, or `[0]` for a still. |
| `renderSound(validatedPiece, solved, options)` | Renders a declared soundtrack on an `OfflineAudioContext`, exactly `frames / hz` seconds long; resolves to the `AudioBuffer`, or `null` without `sound`. |

Import validation and solving from `core/piece.js`; import the rendering functions from `core/render.js`. `renderVector` accepts seed, parameter, playhead, and background options. It throws when a build stage fails or vector output is unsupported. `renderSound` takes `OfflineAudioContext`, `sampleRate` (48000) and `channels` (2) options; Node has no Web Audio, so a caller outside a browser supplies the context. [`core/film.js`](../../core/film.js) exports films; see [output formats](../knowledge/output-formats.md#mp4).

## State and time

Parameters declare `{ min, max, value, meaning }`. Validated values reach drawing code through `state.params`. The short `meaning` describes the parameter's visual effect; each declared parameter should affect the output.

`draw(surface, state, t, clock)` receives a normalized, quantized playhead. Use `clock.frame` for frame-indexed simulation snapshots instead of advancing state inside `draw`. `clock` also exposes `frames`, `seconds`, `hz`, and `loop`.

For more than one frame, a looping timeline uses `i/n` and a non-looping timeline uses `i/(n-1)`. A single-frame timeline uses playhead zero. The same helpers define both drawing and export grids.

For fixed source, input data, parameters, output configuration, and execution environment, repeated seed/playhead pairs should produce the same frame. Use addressed randomness from [`core/rand.js`](../../core/rand.js); do not make drawing depend on prior calls or wall-clock time.

## Responsive boxes

`size` is the design box a piece draws at. A piece that declares `boxes: { w: [min, max], h: [min, max] }`, in design units, accepts any box in those ranges and lays itself out for it; `size` must lie in them and is the box used when nobody chooses one. `boxes` defaults to `null`: such a piece draws only at `size`, as before, and its state gets no box.

`atBox(piece, { w, h })` returns a copy of the validated piece whose `size` is that box. Everything that reads `size` then takes the box: `solve`, `drawFrame`, `renderVector`, the page's canvas and its PNG, SVG and film exports, and the manifest, which records it as `size`. `solve` sets `state.box = { w, h }` before the build stages run, so stages and `draw` compose for the box rather than stretching one composition. A box outside the ranges, or any box but its own size for a piece without `boxes`, is refused by name.

```js
const { validate, atBox } = require('./core/piece.js');
const { renderVector } = require('./core/render.js');

const piece = validate(require('./examples/refit.js'));
const tall = renderVector(atBox(piece, { w: 405, h: 720 }), { t: 1 });
tall.manifest.size;   // { w: 405, h: 720 }
```

The box is chosen per export: a film is drawn at one box, because its frame size cannot change while it plays. The built page shows width and height sliders for a piece that declares `boxes`, rebuilds as they move and keeps the box in its address bar as `box=WxH`; `__artifex.setBox(w, h)` does the same from a script. The page's live player, `?player=1`, shows the piece alone, fitted to the window: a piece with `boxes` takes the window's box, held inside its ranges, and recomposes on every resize without stopping playback; any other piece is scaled whole. It starts playing at once unless the piece has a soundtrack, which waits for a click or key because a browser starts sound only inside a gesture. The player was checked by hand on one Android phone: it recomposed on rotation without stretching and kept playing, paused and resumed on a tap, and started a soundtrack on the first tap. It has not been checked on iOS. `npm run seeds -- <piece> [count] [playhead] --box WxH` draws a contact sheet at a box, and `npm run replay` draws a file again at the box its manifest names.

[`examples/refit.js`](../../examples/refit.js) keeps its things at their size in design units and fills a container that takes the box less a fixed margin, so a narrower box holds fewer of the same things. Run `node --test tests/piece.test.js` for the `boxes`, `atBox` and `state.box` contracts, and `node --test tests/examples.test.js tests/replay.test.js tests/contact-sheet.test.js` for refit, replay at a box and `--box`.

## Authored time

[`core/time.js`](../../core/time.js) shapes motion over the playhead without knowing what moves.

| Helper | Contract |
| --- | --- |
| `span(a, b, x)` | Where `x` sits in the window `[a, b]`, as `[0, 1]`, held at both ends. The three values share one unit: playhead, seconds or frames. A zero-length window is a cut: `0` before `a`, `1` from `a` on. A window with `b < a` or a non-finite value throws. A window reaches `1` only if it closes by the last frame's playhead, which is `1` on a timeline that does not loop and `(n - 1) / n` on one that loops, where `n` is `clock.frames`; close it by then, as [`examples/drift.js`](../../examples/drift.js) does with `span(st.birth, Math.min(st.birth + st.span, 1), t)`, or count in frames and close it by `clock.frames - 1`. |
| `ease.<name>(u)` | A rate curve: how far a move has got after `u` of its time. `linear`; cubic `in`, `out` and `inOut`; `smooth`, the smoothstep; `back`, which passes its mark by about 10% and settles; and `bump`, which rises to `1` at the middle and returns to `0`. Outside `(0, 1)` each returns its end value exactly. The table is frozen. |
| `tween(a, b, rate)` | The function `x => rate(span(a, b, x))`, so a timed move is one value that `draw` and `sound` can both read. Any function of `[0, 1]` can be the rate. |
| `shots(list, timeline)` | Resolves `[[name, seconds], ...]` onto the whole frames of a `clock` or a sound `timeline`. Returns frozen `{ name, index, start, end }` objects; `end` is exclusive. |
| `shotAt(film, frame)` | The resolved shot that holds a whole frame, found by integer comparison. |

Each cut lands on the frame nearest its time, `round(hz * elapsed)`, and shots are compared as integers. A boundary summed in seconds can land a float either side of a frame: `0.1 + 0.2` is not `0.3`. The frame at `start` is the cut into a shot. The list must fill the timeline exactly, and each shot must hold at least one frame. A still has no shots. Each violation throws `RangeError` by name. Names may repeat, so a piece can cut back to an earlier shot. Resolve the same list with `clock` in `draw` and with `timeline` in `sound`, and picture and sound cut on the same frame.

Within a shot, `span(shot.start, shot.end - 1, clock.frame)` runs from `0` on its first frame to `1` on its last. `(clock.frame - shot.start) / (shot.end - shot.start)` is the fraction of the shot's time instead; it reaches `1` only at the next cut. A cut is always a hard cut: the module has no transitions.

```js
const { ease, tween, shots, shotAt } = require('./core/time.js');

const SCORE = [['wide', 2], ['close', 1.5]];   // fills the 3.5-second timeline
const rise = tween(0.25, 1.25, ease.out);      // timed in seconds

const piece = {
  name: 'two-shots',
  size: { w: 400, h: 300 },
  outputs: ['raster', 'vector'],
  time: { duration: 3.5, hz: 24 },
  draw(g, state, t, clock) {
    const shot = shotAt(shots(SCORE, clock), clock.frame);
    g.fillStyle = '#f4f1e8';
    g.fillRect(0, 0, 400, 300);
    g.translate(200, 150);
    if (shot.name === 'close') g.scale(2, 2);   // the cut changes the framing
    g.fillStyle = '#1b1b1b';
    g.beginPath();
    g.arc(0, 60 - 120 * rise(clock.seconds), 20, 0, Math.PI * 2);
    g.fill();
  },
};
```

[`examples/readout.js`](../../examples/readout.js) cuts a reading and a one-second rest on whole frames, and schedules its notes from the same shots. [`examples/drift.js`](../../examples/drift.js) times each stroke with `span`. [`examples/cues.js`](../../examples/cues.js) writes its moves (`tween` at named rates), its bumps (`ease.bump`, including a blink) and its scene changes into one cue table in its build; `draw` and `sound` read only that table. Each scene change starts on its `shots` boundary and turns the parts one after another over a short blend, or all at once at `blend: 0`. Run `node --test tests/time.test.js` for the span, rate, tween and shot contracts.

## Colour dissolves

[`core/colour.js`](../../core/colour.js) offers two mixes of two hex colours at `u` in [0, 1], clamped, returning hex. The two ends come back exactly, and alpha mixes linearly in both.

| Function | Contract |
| --- | --- |
| `mix(a, b, u)` | The default. Mixes in linear light; between complementary colours the midpoint is close to grey. |
| `mixOklch(a, b, u)` | Moves OKLCh lightness and chroma linearly and turns the hue the short way round, so the midpoint keeps the ends' chroma but may show a hue neither end has. A colour with chroma under 1e-4 counts as grey and takes the other colour's hue. Where the arc leaves sRGB, chroma is reduced at the same lightness and hue. |
| `oklch(colour)` | `[L, C, h]`: OKLab lightness in [0, 1], chroma, and hue in radians in (-π, π]. |

The OKLab matrices are those Björn Ottosson published with the space. Switching a piece from `mix` to `mixOklch` changes its frames, so it is an art decision made with before and after frames. [`examples/cues.js`](../../examples/cues.js) turns its palette changes with `mixOklch` and keeps `mix` for its shadows. Run `node --test tests/toolkit.test.js` for the colour contracts.

## Static layers

`layer(surface, state, key, box, paint)` in [`core/layer.js`](../../core/layer.js) draws the part of a frame that never changes, such as a ground or a grid, once per canvas and device scale. `paint(surface, state)` draws it inside `box`, `[x, y, w, h]` in the surface's current units. It reads only the solved state, never the playhead; a paint that declares a third parameter is refused by name.

On a raster canvas the layer is drawn directly on its first frame at a scale. On its second it is drawn again and copied from the canvas right after; later frames put the copy back instead of drawing it. The copy is kept only when the layer alone is opaque across its box and the box lands on whole device pixels under a plain scale, so a copied frame holds exactly the pixels drawing it would. Otherwise, past 2^25 kept pixels per canvas and solve, and on vector and null surfaces, `paint` runs on every frame, and an SVG keeps every path. The copies live per canvas and solve and are released with either. Call `layer` first in `draw`, from the default drawing state.

A browser may move a GPU-backed canvas that is read back often to CPU rasterization, which changes its antialiasing; a copy keeps the layer as that canvas drew it before the move. Read pixels back from a canvas created with `willReadFrequently: true`, as the checks and the CPU film route do. The copy saves drawing time where a canvas is rasterized on the CPU; where the GPU rasterizes it, the layer may already be cheap.

[`examples/drift.js`](../../examples/drift.js) keeps its paper and ground as a layer, and [`examples/readout.js`](../../examples/readout.js) its paper and slot grid. Run `node --test tests/layer.test.js` for the copy rules.

## Soundtrack

A piece with a timeline may declare `sound(ctx, state, timeline)`. It builds a Web Audio graph on an `OfflineAudioContext` whose length is the film's: `timeline` holds `duration` (`frames / hz` seconds), `frames`, `hz` and `loop`. The graph is rendered offline, faster than real time, and muxed with the film.

```js
sound(ctx, state, timeline) {
  const tone = ctx.createOscillator();
  const level = ctx.createGain();
  level.gain.setValueAtTime(0.2, 0);
  level.gain.linearRampToValueAtTime(0, timeline.duration);
  tone.connect(level);
  level.connect(ctx.destination);
  tone.start(0);
  tone.stop(timeline.duration);
},
```

A second of sound is the second `clock.seconds` names in `draw`, so schedule each sound at the second its picture appears and derive both from the same solved state. Take noise from the seeded source rather than an unseeded generator, and schedule only on the context clock. A still cannot declare `sound`; validation refuses it by name. `sound` must build the same graph every time it renders one solved state. Installed Edge adds up three or more connections into one input in an order that changes between renders, so such a graph repeats its samples only to their last bits: in Edge 153 two renders of one in one page differed in a third to four fifths of their samples, by less than 1e-7, and two films of it in their audio bytes. Two connections add up the same either way round. `sumInto(ctx, nodes, into)` in [`core/sound.js`](../../core/sound.js) connects any number of nodes to `into` through a balanced tree of gain nodes at unity, one for each node past the second, so no input takes more than two; `into` must take no other connection. `readout`, `settle` and `cues` sum their voices with it, and in Edge 153 two renders of each soundtrack and two MP4 exports of each film, in one page and across page loads, were identical byte for byte. Compare a soundtrack with a wider sum by measurement. `npm run browser` requires two renders of each example to hold the same bits in every sample. Other browsers can differ further, like pixels. [`examples/readout.js`](../../examples/readout.js) sounds each digit on the frame that first shows it, and [`examples/cues.js`](../../examples/cues.js) each part of a scene change on the frame that first shows it turning. [`examples/settle.js`](../../examples/settle.js) sets every voice's detune, pan and level on every drawn frame from the snapshot that frame draws, ramping linearly between frames.

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
