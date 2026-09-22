---
name: artifex
description: Make art out of code — a piece whose every mark comes from code rather than a traced reference, rendered from one source to an interactive page, a frame-exact MP4 film with its own soundtrack, a print-resolution still or a plotter-ready SVG, with checks that can actually fail. Use when asked to create generative, algorithmic or procedural art; a poster, plate, pattern, diagram-as-art, type specimen, data piece, abstract composition, illustration, creature, scene or object built out of code; an animated or growing piece, or an animated short with sound; a seeded artwork that can be re-rolled; an SVG for a pen plotter; or to debug, optimise or art-direct an existing piece. Not for chart libraries, dashboards, UI mockups, or image generation from a prompt.
argument-hint: "<what to make — optional seed, size or output>"
license: MIT
compatibility: Requires Node 20 or later and the artifex library on disk — the piece contract, the core modules and the npm scripts named here ship with the repository or the plugin. Nothing here needs network access or a dependency install.
metadata:
  version: "0.1.0"
---

# Artifex

A piece is **solved, not traced**. Nothing copies a reference; every quantity on
screen comes out of code you wrote -- a mechanism that finds it, or motion you
author over the playhead, such as an eased move, a blink or a cut on a frame.
Either way the frame is a function of the seed and the playhead, and so is the
sound.

## The one property everything rests on

> **For a fixed piece, data, parameters, output configuration and execution environment, the same seed
> and playhead always produce the same frame — forwards, backwards, or after a
> scrub.**

That is what makes your work reviewable (share those inputs and the reviewer sees
exactly what you saw), a video reproducible rather than recorded, a print
re-renderable at any size, and a plotter file trustworthy.

Everything else here is negotiable. This is not.

Reproducibility is scoped to the same JavaScript engine and rendering backend.
Functions such as `sin`, `cos`, `exp` and `hypot`, Canvas rasterization, and
encoding do not establish byte-identical results across engines or devices.
Read [verification limits](../../docs/knowledge/verification-culture.md) before
claiming portable output equality.

## Non-negotiables

**1. The subject can be anything, and nothing in this library may assume
otherwise.** A city, a poster, a data field, a letterform, a creature, a
pattern, something abstract nobody has named. If you find a default, a
primitive or an example that only makes sense for one kind of art, that is a
defect — report it. This rule outranks convenience, elegance and performance.

This is subject neutrality, not a promise to support every medium. The piece
contract has seeded drawing, declared parameters and an optional timeline; it
does not define live interaction, network streams or an asset-loading lifecycle.
See [subject neutrality](../../docs/knowledge/subject-neutrality.md).

**2. Randomness is addressed, never sequential.** `core/rand.js`:
`const R = rng(seed)`, then `R(entity, property, index)` hashes its arguments.
There is no stream. Adding one element must not move another, because on a
generic piece people edit constantly. `noise2(R, x, y, name)` and
`fbm(R, x, y, octaves, name)` are built on it, and the **name** is what keeps
two fields independent — one field serving every irregularity is why generative
work looks generated.

**3. The playhead is the only clock.** No `Date.now()`, no `performance.now()`,
no `requestAnimationFrame` timestamp reaching a mark. A still has no advancing
timeline. A soundtrack schedules on its offline context, whose seconds are the
film's seconds: frame `i` sits at `i / hz`, the `clock.seconds` that `draw` sees.

**4. A still is a legal piece.** `time: null`. Do not invent a fake reveal to
satisfy a timeline.

**5. Never cut in a way that weakens 1–4.** A wall clock, sequential draw or GPU
path must not decide reference geometry or export behavior. An explicitly
authored approximate pixel preview may coexist with the required CPU reference;
its float32 results are not portable output identity.

## Start here

Every path here — `./core/…`, `examples/…` and the npm scripts — is
relative to the **library root**: the nearest folder above this file that holds
`core/piece.js`. In a clone that is the repository root. In an installed plugin
it is the plugin's own folder, a full copy of the library: `require` it by
absolute path, and run a script from anywhere with
`npm --prefix <library root> run check`.

```bash
node -e "
const { renderVector } = require('./core/render.js');
const r = renderVector({
  name: 'first',
  size: { w: 400, h: 300 },
  outputs: ['raster', 'vector'],
  draw(g) {
    g.strokeStyle = '#1b1b1b';
    for (let i = 0; i < 24; i++) {
      g.beginPath();
      g.arc(200, 150, 8 + i * 5, i * 0.3, i * 0.3 + 2.2);
      g.stroke();
    }
  },
}, { seed: 1 });
console.log(r.marks, 'marks');
require('fs').writeFileSync('out.svg', r.svg);
"
```

Then run `npm run check` (lint, then the tests). When a check or a contract key
changes, run `npm run negative`: it deliberately mutates the library and verifies
that the intended check rejects each mutation. Runtime depends on the machine.

`npm run page` builds `out/index.html` — every example, a seed field, a
transport, PNG at 1x/4x/8x and SVG export, in one self-contained file.
To render your own piece without editing the plugin, export it with
`module.exports` from a `.cjs` file. From the user's project, run
`npm --prefix "<library root>" run page -- "./my-piece.cjs"`.
This writes `my-piece-page.html` beside the piece. Replace `<library root>`
with the absolute library directory; relative piece paths start where npm was invoked.

## What the library gives you

Small on purpose — nothing here assumes a subject. Everything else you write.

```js
require('./core/rand.js')    // rng(seed) -> R(entity, property, index), noise2, gradient2, fbm
require('./core/num.js')     // clamp, clamp01, lerp, unlerp, remap, smoothstep,
                             // turn, pick, chance, centred
require('./core/colour.js')  // rgb, hex, mix, luma, contrast, readableOn
require('./core/path.js')    // poly, stroke, fill, clipPolyline, clipSegment, boxOf
require('./core/geom.js')    // lengthOf, bbox, centroid, pointInPoly, resample,
                             // chaikin, chain, ring, ribbon, closestPointOnSegment,
                             // segmentIntersection, offsetPolyline
require('./core/field.js')   // sampleGrid, gradient, curl, warp, threshold,
                             // isolines, streamline, streamlines
require('./core/time.js')    // span, ease, tween, shots, shotAt
```

**`noise2` is value noise and `gradient2` is gradient noise.** The derivative of
`noise2` normal to a lattice line is zero on that line. Use `gradient2` for fields
whose gradients drive curls or hatch angles.

These modules provide subject-independent arithmetic, path and colour operations.
If a reusable operation needed across pieces is missing, report the gap.

For segment query results and bounded open offsets, read the
[geometry API](../../docs/apis/geometry.md). Intersections distinguish a single
point from a collinear overlap. Offsets keep self-intersections and use limited
miter joins with bevel fallback; they are not polygon boolean operations.

For fields that end in drawing paths, read the [field API](../../docs/apis/fields.md).
`isolines` returns raw segments and chained paths in grid coordinates;
`streamline` walks scalar angles or vector directions with a fixed spatial step.
`gradient` and `curl` differentiate a caller-supplied scalar field with a finite
difference step in that field's coordinate units.

**`mix` works in linear light.** `mix('#000','#fff',0.5)` is `#bcbcbc`, not
`#808080`: the first represents half the light; averaging the encoded sRGB values
produces a darker midpoint.

**`turn(from, to)` is a trap, not a convenience.** Steering a heading with a raw
subtraction sends a mark the long way round exactly when the angle crosses π,
which is invisible on most frames. For a mark with no direction — a hatch, a
grain, a line with no arrowhead — use `turn(from, to, Math.PI)`.

**`centred(u, v)` takes two values.** Averaging n independent uniforms reduces
their standard deviation by 1/√n. Adding more samples concentrates results near
the centre and reduces variation between seeds.

**`clipPolyline` returns RUNS, not one line.** A line that leaves the design box
and comes back is two marks; joining them draws a stroke across the middle of
the picture that you never asked for, and a plotter draws it too.

## Look at nine seeds

```bash
npm run seeds              # every example, nine seeds, one page
npm run seeds drift 16 0.5 # one piece, sixteen seeds, at a playhead
```

For a piece in the user's project, run these from that project, replacing
`<library root>` with the absolute library directory:

```shell
npm --prefix "<library root>" run seeds -- "./my-piece.cjs" 9 0.5
npm --prefix "<library root>" run seeds -- "./my-piece.cjs" 3 0.5 --param width
```

The first writes `my-piece-seeds.html` beside the piece. The second requires a
declared `width` parameter and writes `my-piece-param-width.html` with a fixed
seed. Use the piece's actual parameter name, or two names separated by a comma.
In PowerShell, use `npm.cmd` to preserve the `--` separator when forwarding
options such as `--param`.
Literal `require(...)` imports of browser-compatible CommonJS helpers and JSON
are bundled recursively. Node builtins, ESM and computed requires are unsupported.
Use unshadowed direct calls outside template interpolation; this is a restricted
CommonJS subset, not an arbitrary-module bundler.
Loading the module executes trusted local code; it is not a sandbox. Keep the
piece and its helpers in the user's project rather than modifying the plugin's examples.

Automated checks cover mechanical properties; composition also requires visual
review. The sheet uses seeds 1 through N so an identified seed can be reproduced.

## Read an example before you write a piece

**Open the one whose idiom is closest to what you are making, and none of them
is the starter.** They exist because they break each other's assumptions, and
the notes at the top of each say what it is in the set to prove.

| `examples/` | idiom | time | declares |
|---|---|---|---|
| `drift.js` | organic, painterly — dabs, opacity, a flow field | 240 frames | **raster only** |
| `specimen.js` | hard-edged, typographic — a stroke font, straight runs | a still | raster + vector |
| `readout.js` | data-driven — a fixed dataset the seed may not touch; it sounds, the data choosing the pitch; picture and sound share one shot list | 168 frames | raster + vector + sound |
| `partition.js` | recursive subdivision — area, not marks | a still | raster + vector |
| `contours.js` | plotter-native — one pen, one weight, no fills | a still | raster + vector |
| `packing.js` | closed forms grown until they touch — composition decided by refusal | a still | raster + vector |
| `pattern.js` | one motif repeated by a wallpaper group — the structure is a group | a still | raster + vector |
| `lsystem.js` | a grammar and a turtle — it computes a word, not coordinates | a still | raster + vector |
| `attractor.js` | a chaotic orbit printed as a density — arithmetic only | a still | **raster only** |
| `inversion.js` | three circle mirrors — closed-form reflections and a bounded depth-first word tree | a still | raster + vector |
| `cover.js` | a front cover — the type is set first, the picture grows around it | a still | raster + vector |
| `settle.js` | forces finding their own arrangement — state that evolves, still scrubbable; its sound follows that state on every frame | 144 frames | raster + vector + sound |
| `pixel-field.js` | seeded pixel noise, domain warp and advection; explicit optional WGSL preview | 240 frames | **raster only** |

Subject-specific algorithms stay with their examples; core helpers must remain
useful across subjects. Marching squares and flow walks live in `core/field.js`,
used by `contours` and `drift`. The shared stroke font lives in
`core/stroke-font.js`; `examples/stroke-font.js` remains a compatibility entry
point exporting the same module. Segment chaining stays in `core/geom.js` and
is used by `core/field.js` to join isoline segments.

`inversion.js` reads the surface's `getTransform()` to stop circles below a
1.4-pixel diameter. Larger PNG exports add smaller circles without moving shared
geometry. `VectorSurface` and the benchmark null surface expose detached numeric
`{a,b,c,d,e,f}` snapshots through `getTransform()`, without `DOMMatrix` methods.
Ordinary SVG export uses identity scale and retains the design-resolution cutoff;
surfaces without a reader use scale 1. The tree also stops after twelve reflections. See
[output formats](../../docs/knowledge/output-formats.md) for that limit.

## The contract

`core/piece.js` defines the authoritative contract through `FIELDS`. Consult its
validator and field documentation when changing a piece or the contract.

Required: `name`, `size`, `draw`.
Optional: `state`, `build`, `seed`, `time`, `outputs`, `params`, `sound`, `preview`.
**Unknown keys are refused by name.** This catches misspelled or unsupported
contract fields.

```js
{
  name: 'kebab-case',
  size: { w, h },                 // the DESIGN BOX. It never changes.
  state: () => ({}),              // a fresh object per solve
  build: [['stage name', fn]],    // pure in seed, data and params; named for errors
  draw(surface, state, t, clock), // pure in (state, t). t is NORMALISED, [0,1]
  seed: 1,                        // zero is a seed
  time: null,                     // or { duration, hz, loop? }
  outputs: ['raster'],            // add 'vector' to claim plotter/print output
  params: {},                     // declared knobs, each of which must move the output
  sound: null,                    // or sound(ctx, state, timeline); needs a timeline
  preview: null,                  // optional explicit webgpu-pixels descriptor
}
```

**`t` is normalised and quantised**: always in `[0, 1]`, always on the drawn-frame
grid, never seconds and never a frame number. The fourth argument is where those
live:

```js
draw(g, s, t, clock) {
  clock.frame      // which drawn frame this is, 0 .. frames-1
  clock.frames     // how many there are
  clock.seconds    // where that frame sits in the piece's own time
  clock.hz         // and the rate it was declared at
  clock.loop       // whether t=1 is t=0 again
}
```

Use `clock.frame` for fixed-step lookups and `clock.hz` for the declared rate. Do
not duplicate `duration` and `hz` as separate constants to recover a frame index.

**Author motion with `core/time.js`**, not with hand-written clamps and curves:

```js
const { ease, tween, shots, shotAt } = require('./core/time.js');
const { lerp } = require('./core/num.js');
const SCORE = [['open', 2], ['close', 4]];   // fills a six-second timeline
const lift = tween(0.5, 1.3, ease.out);      // a move, timed in seconds

draw(g, s, t, clock) {
  const shot = shotAt(shots(SCORE, clock), clock.frame);   // integers, not seconds
  const y = lerp(400, 120, lift(clock.seconds));
}
```

- **Cut on whole frames.** A cut summed in seconds can land a float either side
  of a frame: `0.1 + 0.2` is not `0.3`. `shots` puts each cut on its nearest
  frame once, and `shotAt` compares integers. Resolve the same list in `sound`
  with its `timeline`, and the soundtrack cuts on the frame the picture does.
- **A zero-length `span` is a cut**, 0 before its instant and 1 from it on.
  `unlerp` answers 0 there, which for time is a change that never happens.
- **`ease` curves hold their end values outside `[0, 1]`**, exactly. `back`
  passes its mark and settles; `bump` goes out and comes back, an event such as
  a blink. The table is frozen because every piece in a page shares it.
- **A cut is a hard cut.** The module has no transitions.

Read the [piece API](../../docs/apis/piece-api.md#authored-time) for the contracts.

**Declared parameters arrive as `state.params.<name>`**, already validated
against the range you declared. An unknown or out-of-range one is refused by
name.

**`loop` decides where the frames sit.** For n > 1, a looping piece has n frames
at `i/n` and `t=1` is `t=0` again, so it can repeat seamlessly. A piece that does
not loop has n frames at `i/(n-1)` and its last frame is the completed one, so a
reveal finishes. A one-frame timeline has the single playhead 0. Use the shared
frame helpers for drawing and export so they agree on the frame grid.

The **design box never changes**. Aspect ratio, device scale and output medium
are render-time choices — that is the whole reason one piece serves four
outputs.

For a costly opaque per-pixel field, an author may add
`preview: { kind: 'webgpu-pixels', wgsl, uniforms }` to a raster-only piece.
Read the exact [GPU pixel ABI](../../docs/apis/piece-api.md#optional-webgpu-pixel-preview)
and `examples/pixel-field.js` first. WGSL defines
`artifexPixel(position: vec2f) -> vec3f` in encoded sRGB, with fixed seed/time/size
inputs and at most sixteen float uniforms. Keep `draw` as the CPU implementation;
there is no automatic JavaScript translation or arbitrary GPU resource API.
Use the resolved state seed and shared quantized clock in both implementations.

The page starts on CPU, labels GPU output as approximate and falls back on
unavailable or software adapters, insufficient device limits, initialization or
render failure, timeout and loss. GPU preview is bounded to 4096 per axis and
8,294,400 pixels. Exports, contact sheets and replay manifests remain CPU-based.
Measure matching native CPU/GPU inputs and inspect local differences before
claiming fidelity or a speedup; Node mocks and shader timings alone do not
establish those claims. Shader arithmetic may differ across devices.

## The four outputs

| you want | how |
|---|---|
| an interactive page | pass a real `CanvasRenderingContext2D` to `drawFrame` |
| a print-resolution still | same, at `scale: 8` or higher. **Not capped.** |
| a film | walk `playheads(piece)`; the frames are a property of the piece, never of how fast the machine is. The built page does it: **MP4 1x/2x**, frame-exact at any drawing speed and carrying the declared soundtrack, or `__artifex.film({ scale })`, which saves nothing and returns the report read from the file. Only where the browser cannot encode that MP4 does the page offer **WebM video**, which records in real time, so it needs frames cheaper than their budget and has no sound |
| a plotter / print SVG | `renderVector(piece)` — declare `outputs: ['raster','vector']` first |

**Chain your segments before you draw them.** A plotter lifts its pen between
paths. `chain(segs)` in `core/geom.js` joins connected segments into longer
pen-down paths. Endpoints match exactly: generate shared endpoints with the same
arithmetic. The implementation uses numeric `Map` keys, which treat `-0` and `0`
as equal. Rounding coordinates into string keys can merge distinct endpoints and
can distinguish tiny negative values rounded to `"-0.000000"` from values rounded
to `"0.000000"`.

**A raster check must render into its own canvas** created with
`willReadFrequently: true`. Canvas rasterization and anti-aliasing can vary with
the rendering backend; comparing measurements from differently configured
canvases can introduce differences unrelated to the piece.

The surface is **Canvas2D-shaped** in all four, so one `draw` reaches all of
them unchanged.

A vector surface **refuses every raster operation by name** —
`drawImage`, `putImageData`, `fillText`, `createPattern`, `clearRect` and the
rest — and tells you what to do instead. It will never hand back a file quietly
missing half the picture.

**Scaling to print:** do not multiply every stochastic frequency by the scale.
Macro composition must be invariant under resolution; only micro-detail
bandwidth may rise with it.

## Sound

A piece with a timeline may declare `sound(ctx, state, timeline)`: build a Web
Audio graph on the `OfflineAudioContext` it is handed, as long as the film.
`timeline` holds `duration` (`frames / hz`), `frames`, `hz` and `loop`. The
MP4 export renders it offline and muxes it with the frames; `renderSound` in
`core/render.js` renders it alone. Read the [piece API](../../docs/apis/piece-api.md#soundtrack).

Sound follows the picture in two ways, and one piece may use both. An **event**
starts on the frame that shows its cause: `readout.js` sounds each digit on the
frame that fills its cell. A **control** follows a quantity the state holds on
every frame: `settle.js` detunes, pans and levels one voice per node from its
solved trajectory.

- **Schedule each event at the second its picture appears.** Frame `i` sits at
  `i / hz`. Find the frame with draw's own arithmetic rather than an estimate of
  it, and the two cannot drift. Cut the sound with the shot list the picture
  uses: `shots(list, timeline)`.
- **Set each control on every drawn frame.** At `i / hz`, give the AudioParam
  the value of the snapshot `draw` shows on frame `i`, through the lookup `draw`
  uses rather than a copy of it: `setValueAtTime` on the first frame,
  `linearRampToValueAtTime` after. The sound is continuous and still sampled
  from exactly the frames the film holds.
- **Map through the ear's scales.** Use cents for pitch and a logarithm for
  level. A quantity that falls through orders of magnitude then stays audible
  for its whole course instead of going silent after its first second. Scale it
  against a bound it cannot exceed, not one run's own peak, so a calmer run
  sounds calmer.
- **Silence can be state.** Measure a level from a threshold, the smallest
  value that is heard at all, and it reaches zero where the quantity falls below
  it. The sound then starts and ends with its cause rather than on a fade the
  clock schedules.
- **Keep the bass in the middle and centre the rest on the sound.** Let a
  voice's pan width grow with its pitch, so the lowest voices stay centred, as
  mixes keep them: a panned voice loses up to 3 dB when a phone or a mono
  speaker folds the mix to one channel. Pan the others from the middle of the
  voices that may move, weighted by power and width; panning from the middle of
  the picture lets the loudest elements lean the whole mix to one side.
- **Keep every control a function of the state.** A test can then pool
  (state, value) pairs from every frame of two different runs and require one
  curve through them; a control driven by the clock gives two answers for one
  state.
- **One solved state feeds both.** Read positions, counts and timings from
  `state`; never re-derive them in `sound` from different constants.
- **Noise comes from the seed.** Fill buffers from `rng(seed)`; an unseeded
  generator makes the soundtrack a function of when it was rendered.
- **Leave headroom.** Sum the gains you schedule; `npm run browser` reports the
  decoded peak of every film it exports.
- Web Audio rendering can differ between engines, so byte-identical sound is
  scoped to one browser, like pixels.

## Art-direction preset: focal composition

Use this optional preset when a focal relationship suits the piece. A tessellation,
textile repeat or all-over field may deliberately give elements equal attention;
review that intention without imposing a focal point. The following guidance
does not add requirements to the piece contract.

Review these compositional properties in rendered output:

**Give every irregularity a cause.** Not one noise source standing in for all of
them. Keep them separate: *morphological* (the form itself), *gestural* (how it
appears to have been made), *material* (how the medium behaves), *compositional*
(where things sit), *temporal* (when things happen). One noise family at all
five scales produces recognisable algorithmic self-similarity.

**Texture belongs to the material, not to the frame.** A global grain pass over
a finished image treats every surface as though the same particulate process
affected it. Variation attached to the *mark* is more informative than variation
attached to every pixel.

**Inspect paint order in rendered output.** Correct invariants do not establish
that layering and occlusion produce the intended image.

**Prefer five excellent marks to fifty equivalent decorative ones.** Detail and
contrast should fall away from the focal relationship. Giving every element the
same detail and contrast can weaken visual hierarchy.

**A line must arrive, not fade up.** `globalAlpha = progress` is a finished line
fading in, not a pen moving, and the difference is most of what makes a drawing
read as drawn.

**A mean can hide changes in a small mark.** A large local change may contribute
little to a frame-wide average. Pair each mean with the largest single-cell
change.

**Seed robustness is the real test.** A system is not good because it accidentally
produced one beautiful seed. Render nine and look at all of them.

## Traps

- **A blend may not read its own destination.** Writing a blend back into the
  value it read makes the result a function of how many times the page has been
  re-rolled, not of the seed.
- **A cached layer may not read the playhead.** It freezes the frame it was built
  on and the piece silently stops animating there.
- **Solve a simulation in `build`; make `draw` a lookup.** Advancing a system
  inside `draw` makes `draw` stateful, so landing on t=0.3 gives whatever the
  previous call left behind and the piece is unscrubbable. Step the whole
  trajectory once, store a snapshot per drawn frame, and have `draw` read
  `clock.frame`. Quantise the whole frame, not just the reveal: a simulation
  advanced continuously under a stepped drawing slides.
- **Preserve straight runs when resampling.** Curvature-based resampling can drop
  a two-point stroke below a station minimum, removing a letter's crossbar or
  another straight feature. Retain its endpoints.
- **Display values are not linear light.** Passing linear-light values directly
  to `round(v*255)`, without sRGB encoding, produces an incorrectly dark display
  result.
- **A limiter that binds throughout a simulation can determine the animation.**
  With a falling displacement ceiling, the ceiling may dictate motion magnitude
  while the forces only choose direction. Measure how often the clamp binds
  across frames and seeds.
- **Curvature is not occlusion.** A Laplacian measures local curvature rather
  than visibility and can produce bright centres and dark rings unrelated to
  blocked light. When estimating ambient occlusion from a height field, use
  visibility information, such as a horizon sweep.
- **Address stable entities, not output positions.** `R('dither', 'f', facets.length)`
  changes its address whenever an earlier facet is removed. Use an entity index
  that remains stable when other output is filtered or reordered.
- **A check whose pass condition is "no difference" is satisfied by nothing
  happening.** Pair every bound with a floor that must be non-zero.
- **A piece slower than real time cannot be recorded in real time.** The WebM
  recorder stamps frames by the wall clock, so frames that cost more than their
  budget are lost and the export says so. MP4 encodes every frame at its own
  time; a heavy frame makes a slower export, never a shorter film.
- **A clock read after the drawing calls return measures their submission.**
  A browser canvas defers rasterization; force it, for example with a one-pixel
  `getImageData`, before timing a frame.
- **A film whose colour tag disagrees with its samples shifts every colour.**
  Limited-range video read as full range lifts black to grey and dims white. The
  MP4 export converts every frame to limited-range BT.709 and tags it so; keep
  that range and tag through any re-encode.
- **A declared parameter must affect the output.** Sweep each parameter at min,
  value and max: cyclic parameters may produce the same output at both endpoints.
  Check that the build or draw actually reads its validated value.
- **A flow field plus starts around a focus defaults to looking botanical.**
  If `f` changes little along a stroke, integrating `(f - 0.5)` into its heading
  produces an approximately circular arc. To avoid that default, steer *towards*
  the field with inertia and let the focus modulate size and density rather
  than position.

## What this cannot do

The checks validate selected mechanical properties, and measurements quantify
selected differences from a reference. They do not establish artistic quality.
Review rendered output across nine seeds and describe any compositional problems
explicitly.
