---
type: knowledge
summary: "How to draw flat cartoon's marks with the functions in flat-cartoon.js, and how work in that tradition is composed, lit, coloured and moved; read before making a piece in flat cartoon."
related_files: ["skills/artifex/styles/flat-cartoon.js", "skills/artifex/styles/kit.js", "core/path.js", "core/stroke-font.js"]
---

# Flat cartoon

## Contents

- [What makes it read as a flat cartoon](#what-makes-it-read-as-a-flat-cartoon)
- [Marks](#marks)
- [Creative direction](#creative-direction)
- [Palette](#palette)
- [Pitfalls](#pitfalls)

Flat-colour cartoon illustration, as in comic strips, webcomics and TV
animation: every form is a flat, opaque fill inside a closed ink line, with at
most one hard shade, a few small accents, and sound effects lettered into the
picture.

## What makes it read as a flat cartoon

- A closed ink line goes round every form. It swells and tapers like a brush
  or a pressure pen, and it is heavier on the side away from the light.
- Fills are flat and opaque: no gradient, no texture, no grain.
- Each part has at most one cel shade: a hard-edged shape in a darker tone
  of its own fill, not grey. White and most near greys shade to a cool
  lavender; a pale tinted fill shades to a deeper tone of its own tint.
  Some green greys shade nearly grey; give those a tone of your own (see
  `shade`).
- Small accents finish a form: a blush oval and a white shine.
- Sound effects are hand-lettered in thick, outlined letters, and they are
  part of the picture, not a caption over it.
- The ground is plain paper or one flat colour.

## Marks

Layer them in this order: the ground, then each part's fill (with its one cel
shade), then blush and shine, then the ink last, over the fills it rings, and
sound effects over everything. Ink laid before the fills disappears under
them.

- The ground is a fill of `PAPER` (`#fffaf3`) or one flat colour from `PAINT`.
- `flat(g, pts, colour)`: one flat fill of a closed outline, with no stroke.
- `cel(g, pts, colour, options)`: a part's fill with its one cel shade, used
  in place of `flat`. It fills the part in `tone` (`shade(colour)`), then
  fills the part again in `colour`, moved toward `light` by `depth` (0.14)
  of its bounding box's smaller side, inside a clip to the part. A hard
  crescent of shade stays on the side away from the light. Call it once per
  part.
- `shade(colour, k)`: the cel tone of a fill, mixed `k` (0.35) of the way
  toward the dark violet `#3a2340` in linear light, with `k` clamped to
  0..0.8, so even the strongest shade keeps some of the fill's own colour:
  any `k` from 0.8 up gives the same tone, and red, blue and green still
  shade to three different colours there. Where that mix is nearly grey, it leans toward the violet, more the
  greyer it is, and its tint is deepened at the same luminance, more as `k`
  grows and none at `k` 0. `#ffffff` and near greys such as `#cccccc` or
  `#f2f0ee` shade to lavender (`#ddd0e1` for white), the cream `#f5e6d3` to
  the warm `#cdbfb1`, and fills a byte apart to close colours. Some green
  greys lean away from the violet and shade nearly grey, such as `#7c827a`
  to `#6c6c6c`; pass a `tone` of your own to `cel` for such a fill. A dark
  fill, of OKLCh lightness 0.32 or less, is not shaded lighter than itself:
  where the mix would, as for black and near-black fills, it is dimmed,
  keeping its hue, until it is no lighter. `#000000` shades to `#000000` and
  `#202020` to `#251c28`, so a crescent on a very dark part barely shows.
  Lighter fills are not dimmed: from `k` 0.1 up their shade is always
  darker, and below 0.1 a byte of rounding can leave it about 0.001 lighter
  (`#58452a` at `k` 0.02 shades to `#58452b`).
- `shade`, and `cel` with its default `tone`, take `#rgb`, `#rrggbb` or
  `#rrggbbaa`, keep the fill's alpha, and throw a `colour:` error on any
  other colour. With an explicit `tone`, `cel` passes both colours to the
  canvas unchecked.
- `ink(g, R, name, pts, options)`: the ink line, a filled outline, never a
  stroke. Its width is `w` (4). The path is resampled every `step` (2) units,
  and `wobble` (0.08) varies the nib by noise read along the path's length.
  - An open line enters and leaves at `taper` (0.2) of the width, raised to
    the power 0.7 (about 0.32 of `w`), and swells to `w` in its middle. Use it
    for inner lines: a fold, a crease, a lash, a motion line.
  - `closed: true` rings a form with no seam. The line is `w` wide on the
    side facing away from `light` (an angle, -3π/4 or the upper left, by
    default) and thins by `weight` (0.5) toward the side facing it, to
    1 - weight of `w`.
  - `colour` is `INK` (`#1d1414`) by default; a darker tone of a fill draws a
    soft inner line, such as a strand inside a mass.
- `blush(g, cx, cy, rx, ry, options)`: a flat oval in `colour`
  (`PAINT.blush`, `#e0606a`) at `alpha` (0.55), turned by `rot` (0). With
  `lines` above 0, that many short diagonal ink ticks cross it at alpha 0.7,
  `ry * 0.18` wide: the hatched blush.
- `shine(g, a, c, b, options)`: a white crescent from `a` through the control
  point `c` to `b`, pointed at both ends and `w` (6) wide in its middle, in
  `colour` (white) at `alpha` (1). `dot` above 0 adds a round glint of that
  radius just past `b`. Put it on the lit side of a round or glossy part.
- `sfx(g, R, name, text, x, y, size, options)`: sound-effect lettering in the
  [stroke font](../../../core/stroke-font.js), with its cap line at `y`, its
  left edge at `x` and `size` its cap height. The baseline runs at `rot`
  (-0.12). Each letter turns up to 0.15 radians more either way and moves up or down by
  up to half of `bounce` (0.12) times the size, both seeded by `name`. Letters
  are spaced `spread` (1.1) times the font's advance. Every letter is drawn in
  `line` (`INK`) at `weight` (0.22 of the size) plus 0.12 of the size, once
  offset by 0.06 of the size as a drop and once in place, then in `fill`
  (`PAINT.yellow`) at `weight`. It throws when the font has no glyph for a
  character.

To build a form: write a few points per part and pass them through `spline`
from [core/geom.js](../../../core/geom.js), listing sharp points in `corners`.
Lay the part with `cel` (or `flat` for a part with no shade), add its blush
and shine, then ring it with `ink(..., { closed: true })`. Use one `light`
for every `cel` and every closed `ink` in the frame.

## Creative direction

**Where it comes from.** Newspaper comic strips, mid-century TV animation,
which cut drawing down to flat colour and a clean line to work on a budget,
and today's webcomics and animated series drawn in vector tools. The ink line
comes from the brush and the dip pen; the single hard shade comes from cel
painting, where each shadow is one more flat colour.

**What it tends to show.** People, animals, objects with feelings, everyday
places and small jokes: anything that reads from a silhouette and an
expression. It suits a gag, a beat of dialogue or a single reaction. It rarely
shows photographic texture, atmosphere, crowds in depth or soft light, which
leaves room for a surprise: a vast or technical subject cut down to a few
flat shapes and a line.

**Figures and faces, when the piece has them.** Design the silhouette first:
a figure or object reads first as a solid black shape. Hands stay
simple: three or four fingers in mitten shapes, posed to show the action. Faces are dot or
arc eyes, a short mouth line, a nose as a hook or left out, and a blush under
the eyes; expression comes from the eye shape and the brow. See
[faces](../reference/faces.md) for a face that acts, and
[painted figures](../reference/films.md#paint-over-a-hidden-mannequin) for
figures that move, or [hinged figures](../reference/films.md#hinged-figures)
for a cut-out look.

**Composition.** One clear action per frame, staged in profile or
three-quarter view against a plain ground, so the silhouette reads. Leave
space for the sound effect in the composition, near its source and aimed away
from it. Crop close for a reaction and wide for a gag that needs its setting.

**Value, colour and light.** One light direction sets every cel shade and
every heavy side of the ink: a shade on the wrong side breaks the form. Fills
are mid to light and saturated, so the ink is the darkest value in the frame.
Keep a few colours per piece, with one warm accent; let the blush and the
shine be the only marks lighter or warmer than their fill. One `shine` on the
focal glossy thing gives the frame its top value
([one spark](../reference/materials.md#materials)).

**Motion and time.** Animate on twos, 12 drawings a second ([twos under a moving
camera](../reference/films.md#pace)). Use squash and
stretch on soft forms, and smear frames, in which a form stretches along its
path, for fast moves. As a form turns, its heavy ink side and its cel shade
stay on the side away from the light, so recompute them from the same
`light` each drawing. A sound effect pops in with an overshoot, larger for two
or three drawings, then settles, and leaves before the next beat. What breaks
it: soft shading, gradients and motion blur.

**Drawing order.** The ink line first, then fills and cel shades laid in under
it, then blush and shine, then sound effects
([draw the drawing](../reference/films.md#draw-the-drawing)). The ink is drawn
first but still layers last, over the fills. `ink` tapers and weights itself
along the path it is given, so call it on the whole path every frame inside a
clip to the grown band, and `flat` and `cel` inside a swept band
([grow a mark by length](../reference/films.md#draw-the-drawing)).

**Study.**

- Charles Schulz's *Peanuts* for a few lines carrying a whole expression.
- UPA's *Gerald McBoing-Boing* (1950) for flat colour, plain grounds and
  sound drawn as part of the picture.
- Kate Beaton's *Hark! A Vagrant* for timing a joke across panels with simple
  faces.
- *Steven Universe* for flat fills, one hard shade per part and colour by
  scene.

**Levers.**

- Line weight: a heavy, swelling line reads as bold and cartoony; a thin,
  even one reads as quiet and graphic.
- Weight by light: a strong `weight` reads as solid and lit; 0 reads as
  flat, like a sticker or an icon.
- Cel depth: a thin crescent reads as a glossy, round form; a wide one reads
  as a strong side light.
- Palette: two or three fills read as a strip; six or more read as an
  animated series.
- Blush and shine: on every part they read as cute; on a few they read as
  accents of heat and gloss.
- Sound effects: large, tilted and bouncing read as loud and sudden; small and
  level read as a quiet noise.
- Ground: a flat paper ground reads as a strip; a flat colour ground reads as
  a poster or a title card.

## Palette

| Name | Colour | Role |
| --- | --- | --- |
| `INK` | `#1d1414` | the ink line, a warm near-black |
| `PAPER` | `#fffaf3` | the ground |
| `PAINT.sky` | `#83bde9` | a light cool fill |
| `PAINT.blue` | `#4f86c6` | a deeper cool fill |
| `PAINT.coral` | `#e8828a` | a warm light fill |
| `PAINT.red` | `#d9524f` | a warm accent fill |
| `PAINT.peach` | `#f6c4ae` | a pale warm fill |
| `PAINT.tan` | `#e8b17a` | a mid warm fill |
| `PAINT.yellow` | `#ffd45c` | sound-effect fill, a bright accent |
| `PAINT.green` | `#7cc47f` | a fresh fill |
| `PAINT.brown` | `#7b5241` | a dark warm fill |
| `PAINT.grey` | `#9aa0a8` | a neutral fill, not a shade |
| `PAINT.blush` | `#e0606a` | blush, at alpha 0.55 |
| `PAINT.white` | `#ffffff` | shine, at alpha 1 |

Cel tones come from `shade(colour)`, about a third of the way to `#3a2340`,
and a pale fill's shade is lavender for white and near greys.

## Pitfalls

- A line of one width reads as clip art; `ink` gives the line its swell.
- A gradient, or a second cel shade on one part, reads as digital painting;
  one `cel` per part keeps it flat.
- A grey or black cel shade reads as dirt; `shade` of the part's own fill
  keeps its colour. The exception is green greys a little greener than
  neutral, such as `#7c827a` or the darker `#4b5448`: `shade` turns them
  nearly grey, so `cel` with a `tone` of your own suits them.
- Near-black fills and dark greens lose most of their colour in `shade`:
  `shade('#001a00')` is the violet grey `#141217`, and `shade('#003300')` is
  the green grey `#1f2c23`. `cel` with your own `tone` keeps it.
- Ink drawn before the fills disappears under them; the style inks last.
- Thin sound-effect strokes vanish; a `weight` near 0.22 of the size holds.
- Pure black ink is harsh next to bright fills; `INK` is a warm near-black.
- Cel shades and heavy ink sides lit from different directions break the
  form; one `light` passed to every call keeps it whole.
- `cel` moves the whole part, so on a very concave or thin part the shade can
  show as odd bands; a split part or a smaller `depth` avoids them.
- `sfx` throws on a character the stroke font has no glyph for; `missing`
  from the stroke font finds them.
