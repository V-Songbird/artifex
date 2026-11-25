---
type: knowledge
summary: "Says what a named style is in Artifex, a guide of its marks and creative direction plus a module of functions that draw those marks, where installed styles are listed, and what the shared helpers in kit.js do; read when someone asks which styles exist or names one."
related_files: ["skills/artifex/styles/builtin.json", "skills/artifex/styles/kit.js", "skills/artifex/SKILL.md", "tools/styles.js"]
---

# Style catalog

## Contents

- [Use a style](#use-a-style)
- [Shared helpers](#shared-helpers)
- [Variable-width marks](#variable-width-marks)
- [Installed style packs](#installed-style-packs)
- [Reference photos](#reference-photos)

Artifex can draw any subject in a named style. Each style is knowledge in two
files, never a picture to copy:

- **The guide** (`<name>.md`): what makes the style read as itself, how each
  mark is made, and its creative direction, meaning how work in that
  tradition is composed, lit, coloured, moved and timed, with works to study
  and levers to push. Then its palette and pitfalls.
- **The marks** (`<name>.js`): functions that draw the style's marks on any
  path, outline or area a piece gives them. The module draws nothing by
  itself and holds no subject, scene or layout.

The open library ships no named styles of its own (`builtin.json` is empty).
Styles come as [style packs](#installed-style-packs), and
`npm --prefix "<library root>" run styles` lists every one installed.

## Use a style

1. Find your piece's idea first, before you open the style. See
   [Named styles](../SKILL.md#named-styles).
2. Read the style's guide whole: the signature, the marks, the creative
   direction.
3. Direct your piece from the creative direction, for your idea: framing,
   scale, value, motion and timing.
4. Copy the pack's module into your project, require it from the piece, and
   call its functions with your own geometry.
5. Check the marks in 100% crops (`--loupe`) against the guide's signature.

## Shared helpers

Shared helpers live in [`kit.js`](kit.js), which any piece or pack can
require as `artifex/styles/kit.js`. Use its `shadow` for every canvas
shadow: it scales blur and offset by the current transform, which the canvas
does not apply to shadows. Use its `soft(g, x, y, w, h, scale, draw)` for a
lost edge, haze or an out-of-focus plane: it paints the box into a small
buffer and lays it back smoothed, and on an SVG it draws the box sharp.
`grain(g, R, name, w, h, n, light, dark)` lays `n` square specks of 0.8 to
2.4 units over the box from the origin, about half in `light` and half in
`dark`. It takes no alpha: put it in the two colours, or set `globalAlpha`
round the call.

`bristles(R, name, spine, options)` in `kit.js` is a dry mark for any style:
it splits a stroke along a path into hairs, the bristles of a brush or the
grain of a pencil or charcoal. Each hair stays one unbroken run while it
holds ink, then breaks into streaks where the paper's tooth takes none. It
returns the hairs as polylines and draws nothing, so each style lays them in
its own paint. Each hair comes back as `{ side, w, runs }`: `side` its place
across the stroke from -1 to 1, `w` its own line width, and `runs` its
unbroken polylines, each point `[x, y, i]` with `i` its station on the
spine. `width` and `press(t)` set the stroke's width along its
length, `count` the number of hairs, `dryFrom` the share of the stroke after
which they start to run dry, `dry` how much breaks, and `tooth(x, y)` the
paper's field. `dryFrom` defaults to 1, which never runs dry: set it below 1
for a dry stroke, 0 to break from the start. A brush whose width follows its
wobbling edges is better filled lane by lane as ribbons, which fixed-width
polylines do not give.

`upTo(lines, share, label)` in `kit.js` is the walk behind a line mark's
`grow` option: given the polylines a mark really draws, in drawing order, it
returns how far the mark is drawn at `share` (0 to 1) of their summed length
as `{ line, at, points, tip, heading }`. A mark of your own that takes `grow`
cuts by it, so it reveals the whole mark's geometry.

`kit.js` also has three optional colour tools, in OKLab lightness, for a
piece that wants to plan its values before its marks; none is needed to use a
style. `valueKey(colour, key)` moves a colour into a value key (`'high'`,
`'mid'`, `'low'` or `'chiaroscuro'`, which leaves the middle values empty),
keeping its hue, alpha and as much chroma as sRGB allows.
`perceptualPalette({ hue, harmony, key, count, chroma, ground, minContrast })`
returns `count` swatches `{ hex, linear, oklch, notan }` stepping dark to light
through the key, their hues spread from `hue` (radians, as `oklch` gives it) by
`harmony`: `'monochrome'`, `'analogous'`, `'complementary'`,
`'split-complementary'`, `'triadic'` or `'tetradic'`. With `ground` and
`minContrast` a swatch short of that WCAG contrast is moved away from the
ground's lightness until it reaches it, or as far as sRGB allows, so check a
demanding target. `notan(samples, { low, high })` sorts hex colours or linear
`[r, g, b]` into dark (OKLab lightness under `low`, default 0.35), light (from
`high` up, default 0.7) and mid, and returns `{ bins, darkShare, midShare,
lightShare, meanLuma, minL, maxL, contrastSpan }`; `low` equal to `high` gives
two values, and `meanLuma` is linear luminance, not OKLab lightness. Sampled
from a drawn frame, it says how the picture's masses divide, for the painter
to judge.

## Variable-width marks

A mark whose width changes along its path reads as one stroke when filled as
one ribbon per run, its edges set half the local width each side: `outline(pts, width)`
from `artifex/core/path.js` ([variable-width strokes](../reference/geometry-fields.md#variable-width-strokes) says why over `ribbon`) builds it.
A stroke split wherever the width
changes leaves seams across the mark, darkens its joints in translucent ink
and mottles widths under 1 px.

## Installed style packs

Style packs are installed in `~/.artifex/styles/` (or under `ARTIFEX_HOME`).
A pack is a guide and a module of mark functions, plus a proof that each
function draws the same twice inside a box; it holds no piece or picture.
`npm --prefix "<library root>" run styles` is the catalog of every installed
style: each style's name, its signature in words, the names of its mark
functions and the paths of its guide and module, with each pack's version and
whether it is trusted; see [style packs](../../../docs/apis/style-packs.md).
For a style not installed, follow [Named styles](../SKILL.md#named-styles):
name its signature, read the nearest guides, calibrate its line, fill and
accent marks on a replica when the user gave a reference, keep only the guide
and the mark module, and check each part on frames of a piece with a
different subject.

## Reference photos

A reference photo shows the real material a style imitates, such as torn
paper or thread. A style's guide may list its photos under **Reference
photos**. Outside [replica mode](../reference/replica.md), take the material
from a photo, never its composition, subject or backdrop.

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
npm --prefix "<library root>" run seeds -- "./my-piece.cjs" --at 0 --loupe 300,420 --reference "./torn-paper.webp" --png
```
