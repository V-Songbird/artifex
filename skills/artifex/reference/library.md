---
type: knowledge
summary: "Notes on the Artifex library helpers a piece calls: which colour mix to use, draining chroma, tone-mapping a density, turning a heading, spreading values, stroke lettering, raster checks, cached ground layers and sprites; read before mixing colours, setting text or saving a still from a shell."
related_files: ["skills/artifex/SKILL.md", "core/colour.js", "core/num.js", "core/stroke-font.js", "core/layer.js", "tools/still-cli.js"]
---

# Library notes

Read this with [the core skill](../SKILL.md), whose
[library section](../SKILL.md#what-the-library-gives-you) lists every module
and its exports. These are the notes on the helpers a piece calls.

## Noise

**`noise2` is value noise and `gradient2` is gradient noise.** The derivative of
`noise2` normal to a lattice line is zero on that line. Use `gradient2` for fields
whose gradients drive curls or hatch angles.

## Colour and tone

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

## Angles and spread

**`turn(from, to)` is a trap, not a convenience.** Steering a heading with a raw
subtraction sends a mark the long way round exactly when the angle crosses π,
which is invisible on most frames. For a mark with no direction — a hatch, a
grain, a line with no arrowhead — use `turn(from, to, Math.PI)`.

**`centred(u, v)` takes two values.** Averaging n independent uniforms reduces
their standard deviation by 1/√n. Adding more samples concentrates results near
the centre and reduces variation between seeds.

## Lettering

**Letters are strokes, so they survive the SVG.** `text(g, str, x, y, size,
opts)` sets one line in `opts.face`, one of `font.faces`: `mono`, the default
and the only face with Spanish letters, or the Hershey faces `sans`, `serif`,
`italic`, `bold`, `script` and `gothic`, which have printable ASCII only, so
check a string with `font.missing(str, { face })`. `width(str, size, opts)` is
exactly where `text()` ends, so measure a line before you centre or fit it.
`display()` draws a filled word: fill over outline over an offset shadow, all
strokes. What lettering in a frame needs, beside
[text in the frame](making.md#text-in-the-frame):

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

## Stills, checks and layers

```shell
npm --prefix "<library root>" run still -- "./my-piece.cjs" --scale 8
npm --prefix "<library root>" run still -- "./my-piece.cjs" --out "./my-piece.svg"
npm --prefix "<library root>" run replay -- "./my-piece.png" --piece "./my-piece.cjs"
```

`npm run still` resolves paths as [Start here](../SKILL.md#start-here) says. The replay
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
the nearest older one. Read [sprites](films.md#sprites).
