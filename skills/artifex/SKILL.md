---
name: artifex
description: Make art out of code — a piece whose every mark is solved rather than placed, rendered from one source to an interactive page, a video, a print-resolution still or a plotter-ready SVG, with checks that can actually fail. Use when asked to create generative, algorithmic or procedural art; a poster, plate, pattern, diagram-as-art, type specimen, data piece, abstract composition, illustration, creature, scene or object built out of code; an animated or growing piece; a seeded artwork that can be re-rolled; an SVG for a pen plotter; or to debug, optimise or art-direct an existing piece. Not for chart libraries, dashboards, UI mockups, or image generation from a prompt.
argument-hint: "<what to make — optional seed, size or output>"
license: MIT
compatibility: Requires Node 20 or later and the artifex library on disk — the piece contract, the core modules and the npm scripts named here ship with the repository or the plugin. Nothing here needs network access or a dependency install.
metadata:
  version: "0.1.0"
---

# Artifex

A piece is **solved, not drawn**. Nothing is keyframed and nothing traces a
reference; every quantity on screen comes out of a mechanism you wrote.

## The one property everything rests on

> **The seed and the playhead are the only inputs, and the same pair always
> produces the same frame — forwards, backwards, or after a scrub.**

That is what makes your work reviewable (send back a seed and the reviewer sees
exactly what you saw), a video reproducible rather than recorded, a print
re-renderable at any size, and a plotter file trustworthy.

Everything else here is negotiable. This is not.

## Non-negotiables

**1. The subject can be anything, and nothing in this library may assume
otherwise.** A city, a poster, a data field, a letterform, a creature, a
pattern, something abstract nobody has named. If you find a default, a
primitive or an example that only makes sense for one kind of art, that is a
defect — report it. The full charter is `docs/knowledge/subject-neutrality.md`, and it
outranks convenience, elegance and performance.

**2. Randomness is addressed, never sequential.** `core/rand.js`:
`const R = rng(seed)`, then `R(entity, property, index)` hashes its arguments.
There is no stream. Adding one element must not move another, because on a
generic piece people edit constantly. `noise2(R, x, y, name)` and
`fbm(R, x, y, octaves, name)` are built on it, and the **name** is what keeps
two fields independent — one field serving every irregularity is why generative
work looks generated.

**3. The playhead is the only clock.** No `Date.now()`, no `performance.now()`,
no `requestAnimationFrame` timestamp reaching a mark. A still has no clock at
all.

**4. A still is a legal piece.** `time: null`. Do not invent a fake reveal to
satisfy a timeline.

**5. Never cut in a way that weakens 1–4.** A second renderer, a wall clock, a
sequential draw or a GPU path that decides a branch all cost more than they buy.

## Start here

Every path here — `./core/…`, `examples/…`, `docs/…` and the npm scripts — is
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

Then `npm run check` (lint, then the tests) and, when a check or a contract
key changed, `npm run negative` — about 17 minutes. That one breaks the library
on purpose and checks that the **right** test notices; a suite that has never
been red is not evidence.

`npm run page` builds `out/index.html` — every example, a seed field, a
transport, PNG at 1x/4x/8x and SVG export, in one self-contained file.

## What the library gives you

Small on purpose — nothing here assumes a subject. Everything else you write.

```js
require('./core/rand.js')    // rng(seed) -> R(entity, property, index), noise2, gradient2, fbm
require('./core/num.js')     // clamp, clamp01, lerp, unlerp, remap, smoothstep,
                             // turn, pick, chance, centred
require('./core/colour.js')  // rgb, hex, mix, luma, contrast, readableOn
require('./core/path.js')    // poly, stroke, fill, clipPolyline, clipSegment, boxOf
require('./core/geom.js')    // lengthOf, bbox, centroid, pointInPoly, resample,
                             // chaikin, chain, ring, ribbon
```

**`noise2` is value noise and `gradient2` is gradient noise.** Value noise is
flat across its own lattice lines by construction, so anything that takes a
gradient, a curl or a hatch angle out of a field must use `gradient2`.

Three of those modules exist because five people were handed this library and
asked to make five unrelated pieces, and **all five wrote `clamp` and a polyline
loop, and four wrote a colour mix.** If you find yourself writing something the
next piece would also want, that is a defect in the library — report it.

**`mix` works in linear light.** `mix('#000','#fff',0.5)` is `#bcbcbc`, not
`#808080`: the first is the colour of half the light, the second is the average
of two numbers and reads a stop dark. Three of the four authors who needed a
blend wrote the second one, because nothing was there.

**`turn(from, to)` is a trap, not a convenience.** Steering a heading with a raw
subtraction sends a mark the long way round exactly when the angle crosses π,
which is invisible on most frames. For a mark with no direction — a hatch, a
grain, a line with no arrowhead — use `turn(from, to, Math.PI)`.

**`centred(u, v)` takes two values, and two is not three.** Averaging n uniforms
shrinks the spread as 1/√n. An author reaching for a centred distribution
averaged three and got nine seeds that came out as nine siblings.

**`clipPolyline` returns RUNS, not one line.** A line that leaves the design box
and comes back is two marks; joining them draws a stroke across the middle of
the picture that you never asked for, and a plotter draws it too.

## Look at nine seeds

```bash
npm run seeds              # every example, nine seeds, one page
npm run seeds drift 16 0.5 # one piece, sixteen seeds, at a playhead
```

The checks catch roughly half the defects. The other half are compositional and
this is the only instrument for them. The seeds are the first N integers, not
random ones, so "seed 6 is the bad one" still means something tomorrow.

## Read an example before you write a piece

**Open the one whose idiom is closest to what you are making, and none of them
is the starter.** They exist because they break each other's assumptions, and
the notes at the top of each say what it is in the set to prove.

| `examples/` | idiom | time | declares |
|---|---|---|---|
| `drift.js` | organic, painterly — dabs, opacity, a flow field | 240 frames | **raster only** |
| `specimen.js` | hard-edged, typographic — a stroke font, straight runs | a still | raster + vector |
| `readout.js` | data-driven — a fixed dataset the seed may not touch | 144 frames | raster + vector |
| `partition.js` | recursive subdivision — area, not marks | a still | raster + vector |
| `contours.js` | plotter-native — one pen, one weight, no fills | a still | raster + vector |
| `packing.js` | closed forms grown until they touch — composition decided by refusal | a still | raster + vector |
| `pattern.js` | one motif repeated by a wallpaper group — the structure is a group | a still | raster + vector |
| `lsystem.js` | a grammar and a turtle — it computes a word, not coordinates | a still | raster + vector |
| `attractor.js` | a chaotic orbit printed as a density — arithmetic only | a still | **raster only** |
| `cover.js` | a front cover — the type is set first, the picture grows around it | a still | raster + vector |
| `settle.js` | forces finding their own arrangement — state that evolves, still scrubbable | 144 frames | raster + vector |

General mathematics reached by one example stays *out* of the core on purpose:
a core module reached by one kind of art is a preset in disguise. Marching
squares lives in `contours.js` for that reason. The stroke font in
`examples/stroke-font.js` is now reached by three pieces and has earned its
move; where it and `chain` belong is ROADMAP 037, undecided.

## The contract

`core/piece.js` **is** the contract. It is not described anywhere else, because
the last project to describe its contract in four places had all four disagree
and shipped a piece that was wrong in a way no check could see.

Required: `name`, `size`, `draw`.
Optional: `state`, `build`, `seed`, `time`, `outputs`, `params`.
**Unknown keys are refused by name.** A misspelled key is how a wrong contract
passed every check last time.

```js
{
  name: 'kebab-case',
  size: { w, h },                 // the DESIGN BOX. It never changes.
  state: () => ({}),              // a fresh object per solve
  build: [['stage name', fn]],    // pure in the seed; named, so a throw is reportable
  draw(surface, state, t, clock), // pure in (state, t). t is NORMALISED, [0,1]
  seed: 1,                        // zero is a seed
  time: null,                     // or { duration, hz, loop? }
  outputs: ['raster'],            // add 'vector' to claim plotter/print output
  params: {},                     // declared knobs, each of which must move the output
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

Before this existed, a piece with a fixed timestep had to restate its own
`duration` and `hz` as constants to recover a frame index — one fact in two
places, and editing the timeline without editing the constants indexed the wrong
frame in silence.

**Declared parameters arrive as `state.params.<name>`**, already validated
against the range you declared. An unknown or out-of-range one is refused by
name.

**`loop` decides where the frames sit**, and it is not cosmetic. A looping piece
has n frames at `i/n` and `t=1` is `t=0` again, so it can repeat seamlessly. A
piece that does not loop has n frames at `i/(n-1)` and its last frame is the
completed one, so a reveal finishes. Not being able to say which is how a video
export in this library came to drop its middle frame, for every timeline, for as
long as the walk existed.

The **design box never changes**. Aspect ratio, device scale and output medium
are render-time choices — that is the whole reason one piece serves four
outputs.

## The four outputs

| you want | how |
|---|---|
| an interactive page | pass a real `CanvasRenderingContext2D` to `drawFrame` |
| a print-resolution still | same, at `scale: 8` or higher. **Not capped.** |
| a video | walk `playheads(piece)`; the frames are a property of the piece, never of how fast the machine is |
| a plotter / print SVG | `renderVector(piece)` — declare `outputs: ['raster','vector']` first |

**Chain your segments before you draw them.** A plotter lifts the pen between
paths and lifting is the slow, ugly part. `chain(segs)` in `core/geom.js` turns
loose segments into as few pen-down paths as possible — 6021 segments into 47
in `contours`. It matches endpoints exactly rather than within a tolerance,
because points computed by the same expression from the same inputs are
bit-identical, and it keys on the coordinates themselves, never on a formatted
string: `String(-0)` is `"0"` but `(-0).toFixed(6)` is `"-0.000000"`, and a
key built that way once cut sixteen strands dead in the middle of a sheet with
nothing thrown.

**A raster check must render into its own canvas** created with
`willReadFrequently: true`. A displayed canvas is GPU-rasterised until the
browser decides otherwise, and its anti-aliasing changes when it switches — that
is a property of the browser, not of your piece.

The surface is **Canvas2D-shaped** in all four, so one `draw` reaches all of
them unchanged.

A vector surface **refuses every raster operation by name** —
`drawImage`, `putImageData`, `fillText`, `createPattern`, `clearRect` and the
rest — and tells you what to do instead. It will never hand back a file quietly
missing half the picture.

**Scaling to print:** do not multiply every stochastic frequency by the scale.
Macro composition must be invariant under resolution; only micro-detail
bandwidth may rise with it.

## Art direction, which is where the difficulty actually is

The mathematics is rarely the problem. These are, and each one has been paid for:

**Give every irregularity a cause.** Not one noise source standing in for all of
them. Keep them separate: *morphological* (the form itself), *gestural* (how it
appears to have been made), *material* (how the medium behaves), *compositional*
(where things sit), *temporal* (when things happen). One noise family at all
five scales produces recognisable algorithmic self-similarity.

**Texture belongs to the material, not to the frame.** A global grain pass over
a finished image treats every surface as though the same particulate process
affected it. Variation attached to the *mark* is more informative than variation
attached to every pixel.

**Paint order is the art fault no number catches.** Four iterations of a previous
project shipped wrong-looking pictures with every invariant green.

**Prefer five excellent marks to fifty equivalent decorative ones.** Detail and
contrast should fall away from the focal relationship. Everything receiving the
same algorithmic attention is the most common generative tell.

**A line must arrive, not fade up.** `globalAlpha = progress` is a finished line
fading in, not a pen moving, and the difference is most of what makes a drawing
read as drawn.

**A mean cannot see a small mark however hard it moves.** One mark covering 0.19%
of a frame moved it 98 luma, and a grid mean reported 0.19. Pair every mean with
the largest single cell.

**Seed robustness is the real test.** A system is not good because it accidentally
produced one beautiful seed. Render nine and look at all of them.

## Traps

- **A blend may not read its own destination.** Writing a blend back into the
  value it read makes the result a function of how many times the page has been
  re-rolled, not of the seed.
- **A cached layer may not read the playhead.** It freezes the frame it was built
  on and the piece silently stops animating there. One did, for four months.
- **Solve a simulation in `build`; make `draw` a lookup.** Advancing a system
  inside `draw` makes `draw` stateful, so landing on t=0.3 gives whatever the
  previous call left behind and the piece is unscrubbable. Step the whole
  trajectory once, store a snapshot per drawn frame, and have `draw` read
  `clock.frame`. Quantise the whole frame, not just the reveal: a simulation
  advanced continuously under a stepped drawing slides.
- **A straight run can vanish.** Curvature-based resampling can drop a two-point
  stroke below a station minimum. A letter lost its crossbar that way, and the
  page read as a broken font rather than a caller error.
- **Display values are not linear light.** `round(v*255)` with no sRGB encode
  renders a table fitted in linear light a stop dark.
- **A limiter that is always binding is not a limiter, it is the animation.**
  A simulation cooled by a falling ceiling on displacement had the ceiling
  binding on essentially every frame for seven of nine seeds — the motion on
  screen was the cooling curve and the physics was only choosing directions.
  Measure how often a clamp actually clamps.
- **Curvature is not occlusion.** Using the Laplacian of a height field for
  ambient occlusion brightens every hollow and darkens every apex if the sign is
  wrong — and with the sign right it still gives every mound a bright core and a
  dark ring, because a mound is negatively curved at its apex and positively
  curved around its rim. It took a horizon sweep to be right.
- **A sequential address gets written by reflex.** Keying a value on an output
  index — `R('dither', 'f', facets.length)` — reads as addressed and is not: the
  index moves whenever something ahead of it is dropped. An author who had read
  non-negotiable 2 an hour earlier wrote it anyway.
- **A check whose pass condition is "no difference" is satisfied by nothing
  happening.** Pair every bound with a floor that must be non-zero.
- **A declared parameter that the build never reads moves nothing.** Sweep every
  one of them at three pins — min, value, max — because a cyclic parameter has
  the same value at both ends. This project reproduced that defect from scratch
  within an hour of writing the rule down.
- **A flow field plus starts around a focus defaults to looking botanical.**
  Integrating `(f - 0.5)` into a heading makes every stroke an arc of a circle,
  because `f` barely changes over one stroke. Steer *towards* the field with
  inertia, and let the focus modulate size and density rather than position.

## What this cannot do

There is still no automated way to judge whether the art is good. The checks
protect the mechanism; the measurements protect the match to a reference; a
person still has to say what is wrong in words.

And the checks catch roughly half the defects. The other half are compositional,
and the only instrument for those is looking at nine seeds at once.
