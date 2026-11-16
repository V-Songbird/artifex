---
name: artifex
description: Make art out of code — a piece whose every mark comes from code rather than a traced reference, rendered from one source to an interactive page, a frame-exact MP4 film with its own soundtrack, a print-resolution still or a plotter-ready SVG, with checks that can actually fail. Use when asked to create generative, algorithmic or procedural art; a poster, plate, pattern, diagram-as-art, type specimen, data piece, abstract composition, illustration, creature, scene or object built out of code; an animated or growing piece, or an animated short with sound; a seeded artwork that can be re-rolled; an SVG for a pen plotter; or to debug, optimise or art-direct an existing piece. Not for chart libraries, dashboards, UI mockups, or image generation from a prompt.
argument-hint: "<what to make — optional seed, size, output or style name>"
license: MIT
compatibility: Requires Node 22 or later and the artifex library on disk — the piece contract, the core modules and the npm scripts named here ship with the repository or the plugin. PNG contact sheets and time strips (--png), npm run film, a PNG from npm run still, npm run browser and replay of a PNG or film also need installed Microsoft Edge. Nothing here needs network access or a dependency install.
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
contract has seeded drawing, declared parameters and an optional timeline; it
does not define live interaction, network streams or an asset-loading lifecycle.
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
`core/piece.js`. In a clone that is the repository root. In an installed plugin
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

`npm --prefix "<library root>" run page` builds
`<library root>/out/index.html` (in the library's own `out/`, not your
project's) — every example, a seed field, a transport, PNG at 1x/4x/8x and SVG
export, in one self-contained file.
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
require('artifex/core/armature.js') // pose, reach, project (jointed
                                   // segments in depth, foreshortened to the picture)
require('artifex/core/field.js')   // sampleGrid, gradient, curl, warp, threshold,
                                   // isolines, streamline, streamlines,
                                   // evenStreamlines (long lines that fill a box)
require('artifex/core/grow.js')    // stipple (tone as dots), colonise (lines that
                                   // branch towards attractors)
require('artifex/core/diagram.js') // radar, timeline, layered, sankey (diagrams laid
                                   // out as geometry for the piece to draw)
require('artifex/core/deform.js')  // shapeMesh, deformer, riders (a filled outline
                                   // bent by a few pins; marks that ride it)
require('artifex/core/solid.js')   // box, prism, cylinder, loft, place, camera,
                                   // outlines (model once, draw its lines from
                                   // any angle, hidden parts cut away),
                                   // ellipsoid, hullOutline (the exact outline
                                   // of rounded parts and the hull of several)
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
require('artifex/core/score.js')   // euclid, tones, shift, lead, barCuts (rhythms,
                                   // chord moves and voicings chosen by rule)
require('artifex/core/layer.js')   // layer, sibling, sprite, held,
                                   // BUDGET, MAX_SCALE, MAX_BAKE (sprite limits),
                                   // partFrames, framePoint (a tree of attached parts)
require('artifex/core/sim.js')     // simulate, chain, ring, grid, fluid
require('artifex/core/medium.js')  // medium, pigment (a sheet that watercolour and
                                   // body paint act on over time: wash, stroke,
                                   // tilt, dry, paint, knife; raster only)
require('artifex/core/sound.js')   // sumInto, voice, ambience, room, pluck, impact, shaker, ducking, duck, hertz
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

**`noise2` is value noise and `gradient2` is gradient noise.** The derivative of
`noise2` normal to a lattice line is zero on that line. Use `gradient2` for fields
whose gradients drive curls or hatch angles.

These modules provide subject-independent arithmetic, path and colour operations.
If a reusable operation needed across pieces is missing, report the gap.
Before clipping, offsetting or walking a field, read
[geometry and fields](reference/geometry-fields.md): `clipPolyline` returns
runs, not one line.

**`mix` works in linear light.** `mix('#000','#fff',0.5)` is `#bcbcbc`, not
`#808080`: the first represents half the light; averaging the encoded sRGB values
produces a darker midpoint.

**`mixOklch` keeps a dissolve's colour; `mix` stays the default.** Between
complementary colours, `mix`'s straight line through the light crosses grey:
yellow to blue passes through khaki. `mixOklch(a, b, u)` moves OKLCh lightness
and chroma evenly and turns the hue the short way round, so yellow to blue
passes through green, a hue neither end has. Choose it by eye for a piece. A
grey takes the other colour's hue; where the turn leaves sRGB, chroma gives way,
not lightness or hue. `oklch(colour)` returns `[L, C, h]`, with `h` in radians.

**`mixPigment` mixes as paint does.** Each pigment absorbs light, so the mix
keeps only what both reflect: `mixPigment('#f2c200', '#1f4fb8', 0.5)` is olive
green `#5d7d29`, darker than either light mix. Use it where paints meet wet:
wet into wet, a stroke dragged through wet paint, a glaze mixed on the palette.
Pure sRGB primaries reflect nothing in common, so yellow `#ffff00` and blue
`#0000ff` make dark grey; real paint colours are never that pure.

**`mixSpectral` mixes paint across the spectrum.** It turns each colour into a
reflectance curve and mixes the curves by Kubelka and Munk's theory, so the mix
stays cleaner and lighter than `mixPigment`'s:
`mixSpectral('#f2c200', '#1f4fb8', 0.5)` is green `#66983a`, and red `#e02020`
let down with white is pink `#fe5f68` where `mix` greys to `#f0bdbd`. A painter
reaches for it for tints, glazes and overprints that should keep their colour,
and for `mixPigment` where the mix should sink and dull. A call costs two to
four times one of `mixPigment`, so build a ramp once instead of mixing per
pixel.

**To drain chroma alone, mix towards the colour's own grey.** A mid grey such as
`#808080` also pulls lightness to the middle: `mixOklch('#ffff00', '#808080', 0.6)`
takes yellow's OKLCh lightness from 0.968 to 0.747, so the greyed area changes
value too and can merge with a neighbour in grey. Mix towards the grey of the
colour's own lightness instead; lightness and hue then stay, and `u` takes that
share of the chroma away:

```js
const { hex, mixOklch, oklch, rgb, toSRGB } = require('artifex/core/colour.js');
// OKLab lightness cubed is linear grey; the grey keeps the colour's alpha.
const greyOf = (c) => { const v = toSRGB(oklch(c)[0] ** 3); return hex([v, v, v, rgb(c)[3]]); };
const drain = (c, u) => mixOklch(c, greyOf(c), u); // u 0.6 keeps 40% of the chroma
```

Use `mixOklch` here, not `mix`: towards the same grey, `mix` keeps lightness
but turns the hue on the way, pure red from 29° to 21° at `u` 0.6.

**A density that clips its peak loses its structure there.** For an
accumulated field (counts, summed light), `toneMap(values)` returns a curve to
[0, 1]: exposure from the mean of the non-zero values, then Extended Reinhard
whitened at the peak, so nothing clips. It returns linear light; pass it
through `toSRGB` before using it as a position on a ramp chosen by eye.

**`toneMap` is a light meter: it brings whatever it reads to one middle
grey.** Every seed then ends at the same mean brightness, a sparse seed lifts
to grey and a hot core darkens the rest. Set `key` from the subject, higher for
a high-key one and lower for a dark one. To expose every seed alike, measure
the mean of the non-zero values once at a reference seed, `REF`, and pass
`exposure: mean / REF` with this seed's own mean, so a calmer seed looks
calmer. On a sheet where every cell has the same mean brightness, the meter is
deciding the picture.

**`turn(from, to)` is a trap, not a convenience.** Steering a heading with a raw
subtraction sends a mark the long way round exactly when the angle crosses π,
which is invisible on most frames. For a mark with no direction — a hatch, a
grain, a line with no arrowhead — use `turn(from, to, Math.PI)`.

**`centred(u, v)` takes two values.** Averaging n independent uniforms reduces
their standard deviation by 1/√n. Adding more samples concentrates results near
the centre and reduces variation between seeds.

**Letters are strokes, so they survive the SVG.** `text(g, str, x, y, size,
opts)` sets one line in `opts.face`, one of `font.faces`: `mono`, the default
and the only face with Spanish letters, or the Hershey faces `sans`, `serif`,
`italic`, `bold`, `script` and `gothic`, which have printable ASCII only, so
check a string with `font.missing(str, { face })`. `width(str, size, opts)` is
exactly where `text()` ends, so measure a line before you centre or fit it.
`display()` draws a filled word: fill over outline over an offset shadow, all
strokes. What lettering in a frame needs, beside
[text in the frame](reference/making.md#text-in-the-frame):

- **Stack lines at the face's own leading.** `font.leading` is the default
  face's; a Hershey face's descenders hang deeper and its brackets rise above
  the cap line, so at that leading its lines touch or overlap. Step lines by
  `size * font.metrics(face).leading` plus the pen's `lineWidth`; for
  `display()`, by `size * (font.metrics(face).leading + weight + 2 * line +
  shadow.y)`.
- **Kern a title.** At display sizes the gap in `AV`, `To` or `Y.` shows as a
  hole in the word; `kern: true` closes the listed pairs, never nearer than
  half the face's own `HH` gap.
- **One face carries the voice, a second at most.** Each extra face reads as
  another speaker: pair a `script` or `gothic` title with a `sans` label.
- **Fill parallel-stroke faces with a heavier pen.** `bold` and `gothic` draw
  a stem as parallel strokes, so a pen under about 0.05 of the cap height
  shows them as hatching.
- **Wobble what a hand painted.** `wobble` 0.02 reads as a steady hand and
  0.07 as a quick one; a caption over the picture stays steady, because it is
  not part of the scene. Wobble, weight and tight kerning merge the pairs a
  reader already confuses: r and n into m, c and l into d, I, l and 1, O and
  0. A word holding one of them is read back at its drawn size before it is
  kept.
- **Lettering in the scene belongs to its surface.** A sign, a label or a word
  painted on a wall takes the surface's angle, light, wear and place in the
  depth order; letters that ignore them read as pasted on top.
- **A sound word is drawn, not set.** Bold, filled, kerned tight and slightly
  turned, near its source, on the frame of its sound, so it reads as the
  sound itself rather than a caption.

## Named styles

When someone asks for a style by name, read [named styles](reference/named-styles.md).

## Images in

Before a piece takes an image the user gives, read [images in](reference/images-in.md).

## Replica mode

A replica is a piece made to match one reference image, to copy an artwork or
to study a style. It is a named study, and it is drawn from shapes you write
and scored against the reference. To draw over, from or after an image, which
is a different thing, see [images in](reference/images-in.md).

1. **Enter it only on an explicit request.** The user asks for a copy, a
   replica or a faithful study of that image, or to make a style from it. A
   reference given for mood, a material or a style to draw in is not one: take
   its technique, never its composition, as [named styles](reference/named-styles.md) says.
   For a style made from it, the replica only calibrates the marks (step 3 of
   making a style there), and its composition never enters the style. When
   the request is unclear, ask.
2. **Name the source; the rights stay the user's.** The comment at the top of
   the piece says it is a replica and names the work, its maker and where the
   image came from, as the user gave them. The library grants no rights. A
   replica stays in the user's project, never in the library's `examples/` or
   `site/`.
3. **Measure the reference.** Save it as PNG and run
   `npm --prefix "<library root>" run measure -- "./ref.png" --out "./ref.json"`
   from the piece's folder; relative paths follow [Start here](#start-here)
   ([measuring a reference image](../../docs/knowledge/command-line-tools.md#measuring-a-reference-image)).
   Set the piece's `size` to the report's `size`, so one design unit is one
   reference pixel. Raise `--tolerance` until the largest outlines keep few
   points. Paint by containment, not by `share`: draw a region before every
   region inside it, so the backdrop goes first and a shape inside a ring goes
   after the ring. An outline marked `hole: true` is the edge of what lies
   inside the region, never a shape to fill in that region's colour: fill the
   region's outer outline, then draw what sits in the hole on top of it. To
   fit a shape that sits on a ground, use the shape's own outer outline, not the
   ground's hole around it; fit the hole only when the shape's colour has no
   outline of its own. A hole holding only transparent pixels stays unpainted:
   cut it out of the region's fill (both loops in one path, filled or clipped
   even-odd) ([holes](../../docs/knowledge/command-line-tools.md#holes)).
4. **Fit few-point shapes.** Type a few named points per region into the source
   from the report, and draw each region through them with
   `fill(g, spline(pts, 1, { corners, close: true }))`, listing a sharp point's
   index in `corners`, or with `bezier(path, 1, true)` for a shape known as
   curves ([geometry and fields](reference/geometry-fields.md)). Use `fill` on
   the points, not `outline(..., { closed: true })`, which paints a ring. Keep
   each shape to 12 points or fewer; split a larger region into named parts.
   For a region with a transparent hole, `fill` cannot help: it starts a new
   path for each loop. Call `g.beginPath()`, trace the outer loop and each
   hole loop (each a `spline(...)` result) with `moveTo`, `lineTo` and
   `closePath`, then `g.fill('evenodd')`. To clip the region's marks instead,
   call `g.save()` before `beginPath`, `g.clip('evenodd')` after the loops and
   `g.restore()` after the marks, or the clip cuts every region drawn later in
   the frame, including what sits in the hole. Check: run
   `npm --prefix "<library root>" run measure` on the step 5 still as in
   step 3; the region's colour again lists a
   `hole: true` outline there, `transparent` is above 0, and no colour has an
   outline inside that hole's `bbox` unless the reference has one.
5. **Score it.** Save the render at the reference's exact size with
   `npm --prefix "<library root>" run still -- "./replica.cjs" --out "./replica.png"`,
   then run
   `npm --prefix "<library root>" run seeds -- --compare "./replica.png" "./ref.png" --json`
   ([comparing a render with a reference](../../docs/knowledge/command-line-tools.md#comparing-a-render-with-a-reference)).
   Change the shape inside the `worst` region next.
6. **Stop when `off` stops falling.** Keep a change only when it lowers `off`.
   Stop after two rounds in a row that each lower `off` by less than a tenth
   of its value, or when `off` meets a limit the user set. Then look at the
   render and the reference side by side at 100% (`--loupe`).
7. **Keep the reference out of the replica.** Do not declare it in `images`,
   and do not copy the measure report or any shape over the 12 points of
   step 4, even when an outline's `points` list holds more. A replica that
   shows or samples its reference scores the image, not your shapes, and
   calibrates nothing. If what the user wants is the image itself under or
   inside the marks, make that piece instead ([images in](reference/images-in.md)) and
   name it as one.

## The contract

`core/piece.js` defines the authoritative contract through `FIELDS`. Consult its
validator and field documentation when changing a piece or the contract.

Required: `name`, `size`, `draw`.
Optional: `state`, `build`, `seed`, `time`, `outputs`, `params`, `sound`,
`preview`, `boxes`, `reframe`, `finish`, `images`.
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

```shell
npm --prefix "<library root>" run still -- "./my-piece.cjs" --scale 8
npm --prefix "<library root>" run still -- "./my-piece.cjs" --out "./my-piece.svg"
npm --prefix "<library root>" run replay -- "./my-piece.png" --piece "./my-piece.cjs"
```

`npm run still` resolves paths as [Start here](#start-here) says. The replay
command it prints names the library root and quotes each path, so it runs as
printed from your folder. `still` also takes `--seed` and `--at` (seconds);
with `--seed 7` and no `--out`, the file is `my-piece-seed7.png`.
Replay checks one file per run: the PNG with the command below, the SVG by
naming `./my-piece.svg` instead.
`npm --prefix "<library root>" run replay -- "./my-piece.png" --piece "./my-piece.cjs"`.

**A raster check must render into its own canvas** created with
`willReadFrequently: true`. Canvas rasterization and anti-aliasing can vary with
the rendering backend; comparing measurements from differently configured
canvases can introduce differences unrelated to the piece.

**A frame's unchanging ground can be drawn once per scale.** Called first in
`draw`, `layer(g, s, 'ground', [0, 0, W, H], paintGround)` from `core/layer.js`
copies the layer on a raster canvas from its second frame on and runs
`paintGround(g, s)` everywhere else, so an SVG keeps its paths. `paintGround`
reads the solved state and never the playhead, and the layer must be opaque;
otherwise it is drawn every time. It pays where frames are rasterized on the
CPU. `drift`, `growth` and `readout` use it.

**A cutout or a growing sheet is a sprite.** `sprite(g, s, name, box, paint,
{ key, at })` from `core/layer.js` bakes a picture once per canvas, solve and
device scale and draws it with any transform `at`; a `key` grows a copy from
the nearest older one. Read [sprites](reference/films.md#sprites).

The surface is **Canvas2D-shaped** in all four, so one `draw` reaches all of
them unchanged, except that a vector surface refuses raster operations by name.

## Sound

A piece with a timeline may declare `sound(ctx, state, timeline)`. Before a
film gets a soundtrack, read [sound](reference/sound.md): the soundtrack
contract, voices, a place and a room, loudness and how to check what you hear.

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
  advanced continuously under a stepped drawing slides. For bodies that push,
  bounce, hang or pile, `simulate` from `core/sim.js` does this: hand it the
  piece's frame count and rate, read `at(clock.frame, i)`, and schedule sound
  from its `contacts` log (see [films](reference/films.md#parts-coupled-in-space)).
  Boxes and shapes that turn, topple and stack are its `bodies`, read with
  `pose(clock.frame, k)`. For a medium that flows, such as smoke, mist, dye
  or a current behind the action, `fluid` from `core/sim.js` bakes a coarse
  grid the same way: give it sources that add density and a push, read
  `density(clock.frame)` in draw, and paint it as soft cells or as
  `isolines` contours. A grid of 48 by 27 is enough for a background; draw
  it large and soft, and let `sample(frame, x, y)` carry small marks along.
- **Display values are not linear light.** Passing linear-light values directly
  to `round(v*255)`, without sRGB encoding, produces an incorrectly dark display
  result.
- **A limiter that binds throughout a simulation can determine the animation.**
  With a falling displacement ceiling, the ceiling may dictate motion magnitude
  while the forces only choose direction. Measure how often the clamp binds
  across frames and seeds.
- **Address stable entities, not output positions.** `R('dither', 'f', facets.length)`
  changes its address whenever an earlier facet is removed. Use an entity index
  that remains stable when other output is filtered or reordered.
- **A check whose pass condition is "no difference" is satisfied by nothing
  happening.** Pair every bound with a floor that must be non-zero.
- **A clock read after the drawing calls return measures their submission.**
  A browser canvas defers rasterization; force it, for example with a one-pixel
  `getImageData`, before timing a frame.
- **A declared parameter must affect the output.** Sweep each parameter at min,
  value and max: cyclic parameters may produce the same output at both endpoints.
  Check that the build or draw actually reads its validated value.
- **A flow field plus starts around a focus defaults to looking botanical.**
  If `f` changes little along a stroke, integrating `(f - 0.5)` into its heading
  produces an approximately circular arc. To avoid that default, steer *towards*
  the field with inertia and let the focus modulate size and density rather
  than position.

## What this cannot do

The checks and measurements here report mechanical properties and differences
from a reference; nothing in them establishes artistic quality. The picture is
judged by the painter's own look at the rendered seeds and by the review tools
above ([nine seeds](reference/making.md#look-at-nine-seeds), the contact strip in
[depth order and contacts](reference/making.md#depth-order-and-contacts), the
[fresh-eyes review](reference/films.md#fresh-eyes-review)), each reached for
when its question is open.
