---
type: knowledge
summary: "How an Artifex piece takes an image the user gives as data: drawn over it, from it or after it, declared in images with its source and rights, and read through core/image.js; read with the core skill before a piece uses an image."
related_files: ["skills/artifex/SKILL.md", "core/image.js", "core/piece.js", "docs/apis/piece-api.md", "docs/knowledge/command-line-tools.md"]
---

# Images in


An image the user gives is data, like a seed or a parameter. A piece can use
it in three ways, alone or together:

- **Over.** Show the image, then draw marks on it. The image stays visible
  and the marks answer it.
- **From.** Marks follow the image's pixels: where each mark goes, how wide,
  how dense, what colour or which way it runs. The image itself need not be
  shown.
- **After.** Take measures that keep no positions, such as its palette or the
  spread of its values, and compose the piece freely. The image's composition
  stays behind. Read these before choosing a mark: they say how light and
  dark the picture is and which colours carry it.

**Make the module.** From the piece's folder, run
`npm --prefix "<library root>" run image -- "./photo.jpg" --source "<where it came from>" --rights "<whose it is, and on what terms>"`
([turning an image into a module](../../../docs/knowledge/command-line-tools.md#turning-an-image-into-a-module-a-piece-declares)).
Write the source and rights as the user gave them; the library grants no
rights, and the tool refuses to run without both. It writes `photo.image.js`
beside the image, with both in its header comment. Then declare it:
`images: { photo: require('./photo.image.js') }`.

**Read it** with `require('artifex/core/image.js')`, from `state.images.photo`
in a build stage or in `draw`:

- `tone(img, u, v)` gives 0 (black) to 1 (white), and `sample(img, u, v)`
  gives `[r, g, b, a]` from 0 to 255, with `u` and `v` from 0 to 1 across the
  image.
- `fit(img, [x, y, w, h])` places the image to cover a box, or with
  `'contain'` to sit whole inside it, and returns the image's own
  `[x, y, w, h]`. Map a design point to `u, v` through that rectangle.
- `toneField(img, rect)` is the tone as a field over design units, which the
  functions of `core/field.js` take: `sampleGrid` then `isolines` for contours
  along its tones, `gradient` for the direction its tones change fastest, and
  `streamlines` for strokes that follow a direction field made from it.
- `show(g, img, ...fit(img, box))` draws the image's pixels.
- `palette(img, k)` gives its dominant colours, largest first, as
  `[{ colour, share }]`, and `values(img)` its lightness at 5%, 25%, 50%, 75%
  and 95% of the pixels from dark to light. Neither keeps a position, so they
  are what a piece drawn after an image takes: its colours and their
  proportions, its value range and its middle value.
- `structureField(img, rect)` is the way its structure runs, as a field of
  vectors along its edges, grain and folds, with a length from 0 (runs every
  way, or flat) to 1 (runs one way). It is an orientation, so walk it with
  `axial: true`: `evenStreamlines(field, bounds, { separation, axial: true })`
  lays long lines that part round whatever the structure parts round, as
  grain does round a knot. Strokes laid along it follow the form; laid
  across it, they cut it. It reads a neighbourhood, `opt.smooth` of the
  image's longer side (default 0.015): a feature smaller than that is
  averaged into what surrounds it, so lower `smooth` for a small feature
  and give the image enough pixels to hold it.
- `regions(img, n)` cuts it into about `n` blocks of like colour, each with
  its `colour`, `share`, `centre` and `box`, and `at(u, v)` names the block at
  a point. Few blocks give the big shapes of light and dark to block in
  first; many give facets.
- `img.data` is the raw bytes, for any other measure: `img.w` x
  `img.h` pixels, row by row from the top left, `img.channels` bytes each
  (1 grey, 3 RGB, 4 RGBA), from 0 to 255.

Read the image in a build stage when the marks do not move with the
playhead, so `draw` does not read it again on every frame.

**Size.** An image you show needs about the pixels it fills in the export:
for a 1920 x 1080 film, about 1920 pixels wide. An image read only for tones
is usually enough at 256 to 512 pixels wide, in grey (`--width 384 --channels 1`).
The module holds the decoded pixels as text, so a larger image makes a larger
piece and a slower page: 960 x 540 in RGB is about 2 MB, 1920 x 1080 about 8 MB.

**SVG.** An SVG has no pixels. In a piece that also declares `'vector'`, call
`show` under `if (g.canvas)`; the SVG then holds the marks alone. On the
benchmark's surface, which has no canvas, `show` draws nothing, and on the
surface `layerSwaps` records, it is one mark the size of the image.

**Credit.** The comment at the top of the piece names each image it declares,
with its source and rights as the user gave them. Every saved file's manifest
names each image with its source, rights and a digest of its pixels, and
replay refuses a file drawn with another image. Say the source and rights to
the user when you hand over the piece. The image and its module stay in the user's project, never in the
library.
