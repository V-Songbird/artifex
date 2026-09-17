---
name: artifex
description: Make art out of code — a piece whose every mark is solved rather than placed, rendered from one source to an interactive page, a video, a print-resolution still or a plotter-ready SVG, with checks that can actually fail. Use when asked to create generative, algorithmic or procedural art; a poster, plate, pattern, diagram-as-art, type specimen, data piece, abstract composition, illustration, creature, scene or object built out of code; an animated or growing piece; a seeded artwork that can be re-rolled; an SVG for a pen plotter; or to debug, optimise or art-direct an existing piece. Not for chart libraries, dashboards, UI mockups, or image generation from a prompt.
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
defect — report it. The full charter is `docs/subject-neutrality.md`, and it
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

Then `npm test` and `npm run negative`. The second one breaks the library on
purpose and checks that the **right** test notices; a suite that has never been
red is not evidence.

`npm run page` builds `out/index.html` — every example, a seed field, a
transport, PNG at 1x/4x/8x and SVG export, in one self-contained file.

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

Two of them keep general mathematics *out* of the core on purpose — a stroke
font and marching squares — because only one example reaches each, and a core
module reached by one kind of art is a preset in disguise. Move them when a
second piece needs them, not before.

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
  draw(surface, state, t),        // pure in (state, t)
  seed: 1,                        // zero is a seed
  time: null,                     // or { duration, hz, hold? }
  outputs: ['raster'],            // add 'vector' to claim plotter/print output
  params: {},                     // declared knobs, each of which must move the output
}
```

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
paths and lifting is the slow, ugly part; `contours` turns 6021 segments into 47
pen-down paths, and it matches endpoints exactly rather than within a tolerance,
because points computed by the same expression from the same inputs are
bit-identical.

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
- **Quantise the whole frame, not just the reveal.** Advance a simulation to the
  drawn playhead and draw *there*, or the motion slides under the stepped drawing.
- **A straight run can vanish.** Curvature-based resampling can drop a two-point
  stroke below a station minimum. A letter lost its crossbar that way, and the
  page read as a broken font rather than a caller error.
- **Display values are not linear light.** `round(v*255)` with no sRGB encode
  renders a table fitted in linear light a stop dark.
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
