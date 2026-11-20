---
name: artifex
description: Make art out of code — a piece whose every mark comes from code rather than a traced reference, rendered from one source to an interactive page, a frame-exact MP4 film with its own soundtrack, a print-resolution still or a plotter-ready SVG, with checks that can actually fail. Use when asked to create generative, algorithmic or procedural art; a poster, plate, pattern, diagram-as-art, type specimen, data piece, abstract composition, illustration, creature, scene or object built out of code; an animated or growing piece, or an animated short with sound; a seeded artwork that can be re-rolled; an SVG for a pen plotter; or to debug, optimise or art-direct an existing piece. Not for chart libraries, dashboards, UI mockups, or image generation from a prompt.
argument-hint: "<what to make — optional seed, size, output or style name>"
license: MIT
compatibility: Requires Node 22 or later and the whole Artifex plugin, not this skill folder alone — the piece contract, the core modules and the npm scripts named here ship with the plugin or a clone of the repository. PNG contact sheets and time strips (--png), npm run film, a PNG from npm run still, npm run browser and replay of a PNG or film also need installed Microsoft Edge, or Chrome or Chromium where Edge is absent. Nothing here needs network access or a dependency install.
metadata:
  version: "0.1.0"
---

# Artifex

A piece is **solved, not traced**: every mark comes out of code you wrote -- a
mechanism that finds it, or motion you author over the playhead, such as an
eased move, a blink or a cut on a frame. An image the user gives is data like
any other: a piece may draw **over** it (the image shown, marks on top), **from**
it (marks whose place, width, density, colour or direction follow its pixels)
or **after** it (measures that keep no positions, such as its palette or its
spread of tones), and it names the image's source and rights
([images in](reference/images-in.md)). A **replica**, a piece made to match one image,
stays a named study ([replica mode](#replica-mode)). Either way the frame is a
function of the seed, the playhead and the declared data, and so is the sound.

## The one property everything rests on

> **For a fixed piece, data, parameters, output configuration and execution
> environment, the same seed and playhead always produce the same frame —
> forwards, backwards, or after a scrub.**

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
contract has seeded drawing, declared parameters, an optional timeline and
optional [play](#play), pointer and key input stepped on fixed ticks; it does
not define network streams or an asset-loading lifecycle.
See [subject neutrality](../../docs/knowledge/subject-neutrality.md).

**2. Randomness is addressed, never sequential.** `core/rand.js`:
`const R = rng(seed)`, then `R(entity, property, index)` hashes its arguments:
two strings and a whole number.
There is no stream. Adding one element must not move another, because on a
generic piece people edit constantly. `noise2(R, x, y, name)` and
`fbm(R, x, y, octaves, name)` are built on it, and the **name** is what keeps
two fields independent — one field serving every irregularity is why generative
work looks generated.

**3. The playhead is the only clock.** No `Date.now()`, no `performance.now()`,
no `requestAnimationFrame` timestamp reaching a mark. A still has no advancing
timeline. A soundtrack schedules on its offline context, whose seconds are the
film's seconds: frame `i` sits at `i / hz`, the `clock.seconds` that `draw` sees.
A piece with `play` counts ticks instead: real time only decides how fast they
pass, and what a person did reaches the state only through `play.step`.

**4. A still is a legal piece.** `time: null`. Do not invent a fake reveal to
satisfy a timeline.

**5. Never cut in a way that weakens 1–4.** A wall clock, sequential draw or GPU
path must not decide reference geometry or export behavior. An explicitly
authored approximate pixel preview may coexist with the required CPU reference;
its float32 results are not portable output identity.

## Start here

Every file path inside the library (`core/…`, `examples/…`) and the
repository's own scripts are relative to the **library
root**: the nearest folder above this file that holds
`core/piece.js`. If no folder above this file holds `core/piece.js`, this skill
was copied without its library and nothing here can run: stop and install the
whole plugin from `https://github.com/V-Songbird/artifex`, whose README gives
each host's command. In a clone the library root is the repository root. In an installed plugin
it is the plugin's own folder, a full copy of the library: `require` it by
absolute path, and run a script from anywhere with
`npm --prefix "<library root>" run check`. Every relative file path you pass to
an npm script (a piece, a replay PNG or film, `--out`, `--compare`,
`--reference`, for example) resolves from the directory where you run npm, not
from the library root; this skill writes those as `./name`.

Run this example from your own project folder so `out/first.svg` lands there. Replace
`<library root>` with the absolute library directory, written with forward
slashes: a Windows backslash inside the quoted `require` becomes a JavaScript
escape. In a clone, run it from the repository root and require `./core/render.js`.

```bash
node -e "
const { renderVector } = require('<library root>/core/render.js');
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
const fs = require('fs');
fs.mkdirSync('out', { recursive: true });
fs.writeFileSync('out/first.svg', r.svg);
"
```

Then run `npm --prefix "<library root>" run check` (lint, then the tests).
When a check or a contract key changes, run
`npm --prefix "<library root>" run negative`: it deliberately mutates the
library and verifies that the intended check rejects each mutation. Runtime
depends on the machine.

`npm --prefix "<library root>" run page` builds `out/index.html` in the folder
you run it from — every example, a seed field, a transport, PNG at 1x/4x/8x and SVG
export, in one self-contained file. No command writes into an installed plugin:
a registered example's film, still and sheets go to your folder's `out/` too.
Run from inside a clone, they go to the clone's own `out/`.
To render your own piece without editing the plugin, export it with
`module.exports` from a `.cjs` file. From the user's project, run
`npm --prefix "<library root>" run page -- "./my-piece.cjs"`.
This writes `my-piece-page.html` beside the piece. Replace `<library root>`
with the absolute library directory; relative paths follow [Start here](#start-here).

## Read the reference your piece needs

This file holds the core; every piece also goes through the first two rows. Open a reference when the piece needs it:

| when | read |
|---|---|
| every piece, before and while making it | [making a piece](reference/making.md): find the idea, look at nine seeds, depth order and contacts, vary with intention, ask which looks to leave out, read an example, text in the frame |
| every piece, before writing its fields | [the contract](reference/contract.md): the playhead `t`, motion with `core/time.js`, declared parameters, loops and boxes |
| a piece that mixes colours, tone-maps a density, steers a heading, sets text, caches a ground or a sprite, or is saved as a still from a shell | [library notes](reference/library.md): value and gradient noise, `mix` in linear light, `mixOklch`, `mixPigment`, `mixSpectral`, draining chroma, `toneMap`, `turn`, `centred`, lettering with `core/stroke-font.js`, the `still` flags and replay, a raster check in its own canvas, `layer` and `sprite` |
| a piece that blends, caches a layer, simulates, limits a motion, addresses filtered output, times a frame, declares a parameter or walks a flow field | [traps](reference/traps.md) |
| a copy, replica or faithful study of one image | [replica mode](reference/replica.md), whole |
| a style asked for by name | [named styles](reference/named-styles.md) |
| a piece that takes an image the user gives | [images in](reference/images-in.md): drawing over, from or after it, and naming its source and rights |
| a still, the focal preset for any piece, or any piece in a painted style | [stills](reference/stills.md): its looks to leave out, focal composition and placement, shape language, [painting in masses, value groups, edges, temperature and few strokes](reference/stills.md#paint-in-masses-values-and-edges), [line weight](reference/stills.md#line-weight), [marks that model form](reference/stills.md#marks-that-model-form), scaling to print |
| a piece delivered as a film | [the film route](reference/film-route.md), whole: the short map from a brief to the saved film, each line linked to its section of [films](reference/films.md), the full reference |
| a piece with a timeline that should sound | [sound](reference/sound.md): the soundtrack contract, recorded tracks, voices, a place and a room, loudness |
| a film the music tells, a music video, a dance or a loop, or a score under a film's sounds | [music](reference/music.md): when music leads and when it sits under caused sounds, form, tempo and metre, the beat grid cuts and motion land on, [the picture on the beat](reference/music.md#the-picture-on-the-beat) (key hits on the grid over patterns that keep turning, one parameter for each part, effect strength by section, one event list for notes and picture), harmony by mood, a hook, swing, an arrangement that enters part by part, instruments by genre, a score that loops |
| a figure that acts, in a film or a still | [figures that read](reference/films.md#figures-that-read): volumes, proportions in heads, silhouette, line of action, a face that acts, hands and feet, the smallest size at which it acts and how to measure it; a person or creature is [painted over a hidden mannequin](reference/films.md#paint-over-a-hidden-mannequin), as tapered brush strokes, posed in depth with `pose` and `reach` and checked with [`--armature`](../../docs/knowledge/command-line-tools.md#armature-overlay); an object that acts takes its traits, feet and one way of moving from [what it already is](reference/films.md#an-object-that-acts); choose [one body physics](reference/films.md#one-body-physics) for every figure in the film |
| a face or head large enough to show its features, or a face on an object at any size, down to two dots, in a still or a film | [faces](reference/faces.md): [a face on an object](reference/faces.md#a-face-on-an-object), found on its own parts; head units placed by one transform, proportions as ratios and how a style shifts them, measuring a reference, asymmetry and a slight turn, eyes, brows, nose, mouth, hairline and hair, jaw, neck, collarbones, skin, hands towards the camera; ears, cast shadows under overhangs, the far-side shade mass, the hair shadow and a contained blush |
| a plotter or print SVG | [vector and plotter output](reference/vector.md) |
| a GPU pixel preview | [WebGPU preview](reference/webgpu.md) |
| clipping, offsets, resampling or fields | [geometry and fields](reference/geometry-fields.md) |
| real-looking surfaces, light, sky, air or water | [materials and light](reference/materials.md): [one light plan](reference/materials.md#one-light-plan) (its white-source rule, where one source reads as white and every other sits on a warm-to-cool scale of kinds; gains capped at 10, a clipping check, kinds told apart by 20 degrees of hue or 0.04 of chroma), light roles (key, fill, kicker, backlight, eye, material, background), key placement and what each placement reads as, falloff, smoky glow, narrow-band lamps, shadow colour, texture, the cast-shadow rules in [form: tones, ratio, occlusion](reference/materials.md#form-tones-ratio-occlusion), translucency, specular, catchlights, sheen, sparkle, mirrors, the [rim and highlight check at 100%](reference/materials.md#check-rims-and-highlights-at-100), wear on a built place, one palette family for a place, believable nature, iridescence, glow, greys, sky, distance, [rain, snow, fog and dust](reference/materials.md#rain-snow-fog-and-dust), dappled light, [time of day, weather and night](reference/materials.md#time-of-day-weather-and-night), water and foam |
| a chart, map, timeline or diagram meant to be read for its data | [data images](reference/data-images.md): what the data decides, a frame that reads alone and its fresh-reader test, the form that fits the data, colour steps and how many categories |

Add new guidance as one line per rule, in the file and section that already
hold its topic, merged into any rule it repeats or overlaps rather than set
beside it.

## What the library gives you

Small on purpose — nothing here assumes a subject. Everything else you write.

A piece or a style pack requires a core module as `artifex/core/<file>.js`, as
below; a plain Node script requires it by path, as `<library root>/core/<file>.js`,
like the first-run sample above and `render.js` at the end of this list.
In a piece the path is one literal string: the tools read each `require`
without running the piece, so a path built from a variable or joined from
parts is refused.

```js
require('artifex/core/rand.js')    // rng(seed) -> R(entity, property, index), noise2, gradient2, fbm,
  // periodic2 (seamless tiles), turbulence, worley2 (cells, cracks)
require('artifex/core/num.js')     // clamp, clamp01, lerp, unlerp, remap, smoothstep,
  // turn, pick, chance, centred
require('artifex/core/colour.js')  // rgb, hex, mix, mixOklch, mixPigment, mixSpectral, oklch,
  // oklabOfLinear, luma, contrast, readableOn, toLinear, toSRGB, reinhard, toneMap
require('artifex/core/path.js')    // poly, stroke, fill, outline (variable-width
  // stroke as a shape to fill), crossContours (arcs
  // round a projected segment's sections),
  // clipPolyline, clipSegment, clipPolygon (a ring
  // cut to a box, to fill), grow (a path drawn
  // up to a length, with its tip and heading), boxOf
require('artifex/core/geom.js')    // lengthOf, bbox, centroid, pointInPoly, resample,
  // chaikin, catmullRom, chain, ring, ribbon,
  // bezier, spline (curves sampled at a spacing),
  // fitBezier (a sampled stroke as few clean curves),
  // closestPointOnSegment, segmentIntersection,
  // offsetPolyline, keyOutline, keyFaults
  // (step through key outlines)
require('artifex/core/mesh.js')    // triangulate, delaunay, voronoi (meshes
  // and cells on points)
require('artifex/core/spatial.js') // pointIndex (points within a radius), innerCircle
  // (largest circle in a shape), poissonDisk (even scatter from R)
require('artifex/core/clip.js')    // union, intersection, difference, xor, offset
  // (polygon booleans; outlines that never cross)
require('artifex/core/armature.js') // pose, reach, project, fabrik (jointed
  // segments in depth, foreshortened to the picture)
require('artifex/core/field.js')   // sampleGrid, gradient, curl, warp, threshold,
  // isolines, streamline, streamlines,
  // evenStreamlines (long lines that fill a box)
require('artifex/core/grow.js')    // stipple (tone as dots), colonise (lines that
  // branch towards attractors)
require('artifex/core/diagram.js') // radar, timeline, layered, sankey (diagrams laid
  // out as geometry for the piece to draw)
require('artifex/core/deform.js')  // shapeMesh, deformer, riders, squashStretch (a filled outline
  // bent by a few pins; marks that ride it)
require('artifex/core/solid.js')   // box, prism, cylinder, loft, place, camera,
  // outlines (model once, draw its lines from
  // any angle, hidden parts cut away),
  // ellipsoid, hullOutline (the exact outline
  // of rounded parts and the hull of several),
  // bvh (rays: hits, shadows, open sky)
require('artifex/core/maps.js')    // fill, noise, cells, warp, levels, steps, blur,
  // slopeBlur, combine, shade, relief, toImage, over
  // (a material built as maps: height, then light,
  // then colour)
require('artifex/core/image.js')   // sample, tone, toneField, fit, show (read and show
  // state.images.<name>), palette, values,
  // structureField, regions (read it whole), check,
  // solved, describe, digest, clusters, MAX_PIXELS
  // (the contract's own; see images in)
require('artifex/core/time.js')    // span, ease, tween, keys, flow, gait, drawingAt, bars,
  // shots, shotAt, spring, follow
require('artifex/core/instruments.js') // recipe, play, INSTRUMENTS (acoustic
  // voices by name, each from its physics)
require('artifex/core/score.js')   // euclid, tones, shift, lead, barCuts, extendChord, scale, express (rhythms,
  // chord moves and voicings chosen by rule)
require('artifex/core/layer.js')   // layer, sibling, sprite, held,
  // BUDGET, MAX_SCALE, MAX_BAKE (sprite limits),
  // partFrames, framePoint (a tree of attached parts)
require('artifex/core/sim.js')     // simulate, chain, ring, grid, fluid
require('artifex/core/medium.js')  // medium, pigment (a sheet that watercolour and
  // body paint act on over time: wash, stroke,
  // tilt, dry, paint, knife; raster only)
require('artifex/core/sound.js')   // sumInto, voice, ambience, room, pluck, impact, shaker, ducking, duck, hertz
require('artifex/core/play.js')    // session, rerun, checkSession, digest, film,
  // cueNode, renderCues, MAX_EVENTS, MAX_TICKS (sessions of play)
require('artifex/core/stroke-font.js') // text, width, display, metrics, glyph, missing,
  // runCount, faces, KERN, GLYPHS, ascent, descent, leading
  // (polyline lettering in seven faces)
require('<library root>/core/render.js') // drawFrame, renderVector, playheads, renderSound
  // (draw or hear a piece from a script or test,
  // with piece.js's validate and solve)
```

The other core modules run the contract, the page and its exports, not a
piece: `piece.js` validates and solves, `surface-vector.js` serves
`renderVector`, `finish.js` draws a declared `finish`, `webgpu-preview.js`
serves the [WebGPU preview](reference/webgpu.md), `film.js` and `export.js` save
films and stills, `flash.js` counts flashes in an exported film's frames for
the export's warning, and vendored third-party code sits behind five modules:
`robust-predicates.js` behind `geom.js`, `earcut.js`, `delaunator.js` and
`d3-delaunay.js` behind `mesh.js`, `kdbush.js`, `polylabel.js`, `tinyqueue.js`
and `poisson-disk.js` behind `spatial.js`, `clipper2.js` behind `clip.js`, and
`planck.js` behind `sim.js`.

These modules provide subject-independent arithmetic, path and colour operations.
If a reusable operation needed across pieces is missing, report the gap.
Before clipping, offsetting or walking a field, read
[geometry and fields](reference/geometry-fields.md): `clipPolyline` returns
runs, not one line.

Before calling these helpers, read [library notes](reference/library.md).

## Named styles

When someone asks for a style by name, read [named styles](reference/named-styles.md).

## Images in

Before a piece takes an image the user gives, read [images in](reference/images-in.md).

## Replica mode

A replica is a piece made to match one reference image, to copy an artwork or
to study a style. It is a named study, entered only on an explicit request,
drawn from shapes you write and scored against the reference. Before making
one, read [replica mode](reference/replica.md), whole.

## The contract

`core/piece.js` defines the authoritative contract through `FIELDS`. Consult its
validator and field documentation when changing a piece or the contract.

Required: `name`, `size`, `draw`.
Optional: `state`, `build`, `seed`, `time`, `outputs`, `params`, `sound`,
`preview`, `boxes`, `reframe`, `finish`, `images`, `play`.
**Unknown keys are refused by name.** This catches misspelled or unsupported
contract fields.

```js
{
  name: 'kebab-case',
  size: { w, h },                 // the DESIGN BOX. It never changes unless `boxes` says so.
  state: () => ({}),              // a fresh object per solve
  build: [['stage name', fn]],    // pure in seed, data and params; named for errors
  draw(surface, state, t, clock), // pure in (state, t). t is NORMALISED, [0,1]
  seed: 1,                        // zero is a seed
  time: null,                     // or { duration (seconds), hz, loop? }
  outputs: ['raster'],            // add 'vector' to claim plotter/print output
  params: {},                     // { name: { value, min, max, meaning } }, each of which must move the output
  sound: null,                    // or sound(ctx, state, timeline); needs a timeline
  preview: null,                  // optional explicit webgpu-pixels descriptor
  boxes: null,                    // or { w: [min, max], h: [min, max] }: it recomposes to its box
  reframe: null,                  // or [{ t, w, h }, ...]: a box timeline; needs boxes and time, size is the largest box
  finish: null,                   // or a film's finish: grain, weave, flicker (<= 0.025), vignette, grade (ends, tone, per-channel toe/mid/shoulder curves, shadow and highlight tints), bloom and halation (light on dark only); never flash large-area brightness or saturated red more than 3 times a second (the film export warns, report `flashes`)
  images: null,                   // or { name: require('./photo.image.js') }: decoded pixels with source and rights (see images in)
  play: null,                     // or { hz, inputs, step(state, inputs, tick, R), describe }: interactive, no time
}
```

Before writing a piece's fields, read [the contract](reference/contract.md):
the playhead and the clock, authored motion, build stages, declared
parameters, boxes and reframing, and the WebGPU preview.

## The four outputs

| you want | how |
|---|---|
| an interactive page | pass a real `CanvasRenderingContext2D` to `drawFrame` |
| a print-resolution still | same, at `scale: 8` or higher. **Not capped.** From a shell, `npm --prefix "<library root>" run still -- "./my-piece.cjs" --scale 8` saves the PNG beside the piece. Read [scaling to print](reference/stills.md#scaling-to-print) |
| a film | walk `playheads(piece)`; the frames are a property of the piece, never of how fast the machine is. The built page's **MP4** export, or `npm --prefix "<library root>" run film -- "./my-piece.cjs"` from a shell, saves it frame-exact with its soundtrack; do not write your own browser driver. Read [look, then export](reference/film-route.md#look-then-export) |
| a plotter / print SVG | `renderVector(piece)`, or `npm --prefix "<library root>" run still -- "./my-piece.cjs" --out "./my-piece.svg"` from a shell — declare `outputs: ['raster','vector']` first, then read [vector and plotter output](reference/vector.md) |

Before saving a still from a shell, checking a raster or drawing a ground or
a cutout once, read [stills, checks and layers](reference/library.md#stills-checks-and-layers).

The surface is **Canvas2D-shaped** in all four, so one `draw` reaches all of
them unchanged, except that a vector surface refuses raster operations by name.

## Play

A piece that answers a person declares `play` instead of `time`; a session is
a pure function of seed, parameters and input log, and `film` or `still` with
`--session` make its files. Read [interactive pieces](reference/interactive.md) first.

## Sound

A piece with a timeline may declare `sound(ctx, state, timeline)`. Before a
film gets a soundtrack, read [sound](reference/sound.md): the soundtrack
contract, voices, a place and a room, loudness and how to check what you hear.

## Traps

Each trap breaks a piece without an error: read [traps](reference/traps.md).

## What this cannot do

The checks and measurements here report mechanical properties and differences
from a reference; nothing in them establishes artistic quality. The picture is
judged by the painter's own look at the rendered seeds and by the review tools
above ([nine seeds](reference/making.md#look-at-nine-seeds), the contact strip in
[depth order and contacts](reference/making.md#depth-order-and-contacts), the
[fresh-eyes review](reference/films.md#fresh-eyes-review)), each reached for
when its question is open.
