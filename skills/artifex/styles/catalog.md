---
type: knowledge
summary: "Lists the named styles Artifex knows, each a guide of its marks and creative direction plus a module of functions that draw those marks; read when someone asks which styles exist or names one."
related_files: ["skills/artifex/styles/builtin.json", "skills/artifex/styles/kit.js", "skills/artifex/SKILL.md", "tools/styles.js"]
---

# Style catalog

## Contents

- [Use a style](#use-a-style)
- [Variable-width marks](#variable-width-marks)
- [Installed style packs](#installed-style-packs)
- [Reference photos](#reference-photos)

Artifex can draw any subject in the styles below. Each style is knowledge in
two files, never a picture to copy:

- **The guide** (`<name>.md`): what makes the style read as itself, how each
  mark is made, and its creative direction, meaning how work in that
  tradition is composed, lit, coloured, moved and timed, with works to study
  and levers to push. Then its palette and pitfalls.
- **The marks** (`<name>.js`): functions that draw the style's marks on any
  path, outline or area a piece gives them. The module draws nothing by
  itself and holds no subject, scene or layout.

| `name` | Style | Its marks | Guide | Marks |
| --- | --- | --- | --- | --- |
| `papercraft` | Papercraft | torn and cut paper layers under soft shadows | [papercraft.md](papercraft.md) | [papercraft.js](papercraft.js) |
| `render-3d` | 3D render | raymarched lit forms with soft shadows and specular | [render-3d.md](render-3d.md) | [render-3d.js](render-3d.js) |
| `cad` | CAD drawing | aligned views, layer colours, dimensions, sections | [cad.md](cad.md) | [cad.js](cad.js) |
| `pixel-art` | Pixel art | a coarse pixel grid, limited palettes, dithering, outlined sprites | [pixel-art.md](pixel-art.md) | [pixel-art.js](pixel-art.js) |
| `embroidery` | Embroidery | satin and fill stitches, thread with an edge and a sheen | [embroidery.md](embroidery.md) | [embroidery.js](embroidery.js) |
| `sticker` | Sticker | die-cut vinyl: a bold outline, a white border, a shadow and a peel | [sticker.md](sticker.md) | [sticker.js](sticker.js) |
| `voxel` | Voxel | isometric blocks with 16 x 16 texel faces | [voxel.md](voxel.md) | [voxel.js](voxel.js) |
| `doodle` | Doodle | ballpoint lines in double passes, hatching, on ruled paper | [doodle.md](doodle.md) | [doodle.js](doodle.js) |
| `kandinsky` | Kandinsky | circles, rings, arcs and bars in glazed colour | [kandinsky.md](kandinsky.md) | [kandinsky.js](kandinsky.js) |
| `impasto` | Impasto | thick flow-aligned dabs with lit and dark ridges | [impasto.md](impasto.md) | [impasto.js](impasto.js) |
| `circuit-board` | Circuit board | 45-degree copper under solder mask, gold pads, silkscreen | [circuit-board.md](circuit-board.md) | [circuit-board.js](circuit-board.js) |
| `watercolour` | Watercolour | transparent deformed washes, pooled pigment, dried rims | [watercolour.md](watercolour.md) | [watercolour.js](watercolour.js) |
| `sumi-e` | Sumi-e | pressed brush strokes that run dry, tones of one ink, reserved white | [sumi-e.md](sumi-e.md) | [sumi-e.js](sumi-e.js) |
| `star-atlas` | Star atlas | projected graticule, stars by magnitude, engraved lines | [star-atlas.md](star-atlas.md) | [star-atlas.js](star-atlas.js) |
| `light-painting` | Light painting | additive light trails with white cores, sparks | [light-painting.md](light-painting.md) | [light-painting.js](light-painting.js) |
| `pen-and-pencil` | Pen and pencil | ballpoint pressure strokes, toothed coloured-pencil hatching and a loose scribble fill | [pen-and-pencil.md](pen-and-pencil.md) | [pen-and-pencil.js](pen-and-pencil.js) |
| `manga` | Manga | pressure pen lines, screentone dots, hatching, speed and focus lines, drawings held on twos ([twos under a moving camera](../reference/films.md#pace)) | [manga.md](manga.md) | [manga.js](manga.js) |
| `gouache` | Mid-century gouache | opaque flats with dry-brushed edges, dry brush and spatter, simple skies, dark planes round a lit opening | [gouache.md](gouache.md) | [gouache.js](gouache.js) |
| `flat-cartoon` | Flat cartoon | closed tapered ink, flat fills, one cel shade, blush and shines, sound-effect lettering | [flat-cartoon.md](flat-cartoon.md) | [flat-cartoon.js](flat-cartoon.js) |
| `print-plate` | Print plates | a plate per ink, colours as overprints, paper whites, dot screens at angles, inks out of register | [print-plate.md](print-plate.md) | [print-plate.js](print-plate.js) |
| `backlit-silhouette` | Backlit silhouettes | a lit screen, translucent gels that darken where they overlap, opaque cards that read as black, openings cut through | [backlit-silhouette.md](backlit-silhouette.md) | [backlit-silhouette.js](backlit-silhouette.js) |

## Use a style

1. Find your piece's idea first, before you open the style. See
   [Named styles](../SKILL.md#named-styles).
2. Read the style's guide whole: the signature, the marks, the creative
   direction.
3. Direct your piece from the creative direction, for your idea: framing,
   scale, value, motion and timing.
4. Require the style's module as `require('artifex/styles/<name>.js')`, from
   any folder, as you require `artifex/core/...`, and call its functions with
   your own geometry.
5. Check the marks in 100% crops (`--loupe`) against the guide's signature.

Shared helpers live in [`kit.js`](kit.js). Use its `shadow` for every canvas
shadow: it scales blur and offset by the current transform, which the canvas
does not apply to shadows. Use its `soft(g, x, y, w, h, scale, draw)` for a
lost edge, haze or an out-of-focus plane: it paints the box into a small
buffer and lays it back smoothed, and on an SVG it draws the box sharp.

`bristles(R, name, spine, options)` in `kit.js` is the dry mark the styles
share: it splits a stroke along a path into hairs, the bristles of a brush or
the grain of a pencil or charcoal. Each hair stays one unbroken run while it
holds ink, then breaks into streaks where the paper's tooth takes none. It
returns the hairs as polylines and draws nothing, so each style lays them in
its own paint. Each hair comes back as `{ side, w, runs }`: `side` its place
across the stroke from -1 to 1, `w` its own line width, and `runs` its
unbroken polylines. `width` and `press(t)` set the stroke's width along its
length, `count` the number of hairs, `dryFrom` the share of the stroke after
which they start to run dry, `dry` how much breaks, and `tooth(x, y)` the
paper's field. `dryFrom` defaults to 1, which never runs dry: set it below 1
for a dry stroke, 0 to break from the start. Gouache `drybrush` and
pen-and-pencil `drag` are built on it. Sumi-e keeps its own hairs in `brush`:
it fills each lane of hairs as a ribbon whose width follows the brush's
wobbling edges and ends a wet body raggedly, which fixed-width polylines do
not give.

`npm --prefix "<library root>" run styles -- check <name>` checks a built-in style: its module exports
mark functions and no piece, and its guide has every section.

## Variable-width marks

A mark whose width changes along its path reads as one stroke when filled as
one ribbon per run, its edges set half the local width each side: `outline(pts, width)`
from `artifex/core/path.js` (`../../../core/path.js` in a built-in module here) ([variable-width strokes](../reference/geometry-fields.md#variable-width-strokes) says why over `ribbon`) builds it,
as `brush()` in [sumi-e.js](sumi-e.js) fills its bristles by hand. A stroke split wherever the width
changes leaves seams across the mark, darkens its joints in translucent ink
and mottles widths under 1 px.

## Installed style packs

Style packs add styles beyond this table, installed in `~/.artifex/styles/`
(or under `ARTIFEX_HOME`). A pack is the same two files as a built-in style,
a guide and a module of mark functions, plus a proof that each function draws
the same twice inside a box; it holds no piece or picture. `npm --prefix "<library root>" run styles`
is the catalog of every style, built in and installed: each style's name, its
signature in words, the names of its mark functions and the paths of its
guide and module, with each pack's version and whether it is trusted; see
[style packs](../../../docs/apis/style-packs.md). For a style in neither,
follow [Named styles](../SKILL.md#named-styles): name its signature, read the
nearest guides, calibrate its line, fill and accent marks on a replica when
the user gave a reference, keep only the guide and the mark module, and check
each part on frames of a piece with a different subject.

## Reference photos

A reference photo shows the real material a style imitates, such as torn
paper or thread. A style's guide lists its photos under **Reference photos**.
Today only [papercraft](papercraft.md#reference-photos) has one. Outside
[replica mode](../reference/replica.md), take the material from a photo,
never its composition, subject or backdrop.

A photo belongs in `references/<style>/` only when all of these hold. The test
`tests/style-references.test.js` checks each rule:

- The repository's owner took the photo, or it is public domain or CC0. No
  other licence.
- It is a WebP file of 150 KiB (153,600 bytes) or less.
- A `.json` record of the same name sits beside it, with `author`, `licence`
  (`owner`, `CC0-1.0` or `public-domain`) and, unless the repository's owner took it, the
  `source` page it came from.
- The style's guide names the photo's path.

To find a CC0 or public-domain photo, search Openverse with the licence filter
`license=cc0,pdm`, such as
[`https://openverse.org/search/image?q=torn%20paper&license=cc0,pdm`](https://openverse.org/search/image?q=torn%20paper&license=cc0,pdm)
for torn paper. Then open the photo's source page and confirm the licence there
before you use it.

To compare a piece with a photo at the same pixel scale, add `--reference` to a
time strip with `--loupe`. The photo's centre is shown at 100%, cut to the size
of each 100% crop, as the strip's first cell. Add `@x,y` after the photo's path
to cut around that point in its pixels, and `--reference-scale k` to show each
photo pixel k pixels wide; [how to choose k](../../../docs/knowledge/command-line-tools.md#time-strips)
gives the formula. The caption names the photo pixels the cell shows,
which can be fewer than the cell holds when the photo is smaller or k does not
divide the cell. Only the crop is embedded in the sheet. This command writes
`my-piece-at-loupe-reference.png` beside the piece:

```shell
npm --prefix "<library root>" run seeds -- "./my-piece.cjs" --at 0 --loupe 300,420 --reference "<library root>/skills/artifex/styles/references/papercraft/torn-paper.webp" --png
```
