---
type: knowledge
summary: "How to draw watercolour's marks with the functions in watercolour.js, and how work in watercolour is composed, lit, coloured and moved; read before making a piece in watercolour."
related_files: ["skills/artifex/styles/watercolour.js", "skills/artifex/styles/kit.js"]
---

# Watercolour

## Contents

- [What makes it read as watercolour](#what-makes-it-read-as-watercolour)
- [Marks](#marks)
- [Creative direction](#creative-direction)
- [Palette](#palette)
- [Pitfalls](#pitfalls)

Transparent pigment carried by water onto cold-press paper. Washes are laid
light to dark, each one a glaze over the last, and the white of the paper is
the only white.

## What makes it read as watercolour

- Every wash is transparent: overlaps darken, as glazes do. Nothing opaque
  covers anything, and there is no white paint.
- Edges vary along their length: soft where the paper was wet, crisp and a
  little darker where the wash dried.
- Tone varies inside a wash: pigment pools in some places and thins in
  others; a second colour flows into the first while both are wet.
- Granulation: fine specks of pigment settled in the paper's tooth.
- Lights are paper, kept or lifted back. A highlight is left, not painted on.
- The painting often fades out into bare paper before the edge of the sheet.
- Traces of the process: a pencil underdrawing, a lifted light, a bloom where
  water crept back into drying paint, a few flicks of paint.

## Marks

Layer them in this order: paper, pencil, the palest washes, darker glazes
over dry paint, washes dropped into wet ones, granulation, lifts and
blooms, brush-point strokes and dry brush, splatter, then the tooth over
everything. Every mark multiplies, so the order of glazes changes their
colour only where they overlap, and a watercolour piece is raster only: the
[vector surface](../reference/vector.md) refuses multiply.

- The ground is a fill of `PIGMENTS.paper` (`#f8f4ea`).
- `deform(points, R, name, depth, amount)`: midpoint displacement of a closed
  outline of `[x, y, roughness]` points. Each new point moves by a Gaussian
  times the edge's length times `amount` times its roughness, held within
  0.3 of the edge's length; the roughness is handed on to the new point
  with a factor in [0.65, 1.35] and held in [0.2, 1.6]. Every deformed
  outline is drawn through one Chaikin pass, so corners round and a long
  edge swells instead of spiking.
- `wash(g, R, name, outline, colour, options)`: splits every edge longer
  than the wash's cell (its size / 16, held in [6, 26]) into even steps,
  keeping the given points, deforms the outline twice by `spread` (default
  0.12), then paints `layers` copies, each deformed three more times by
  `spread` x 0.45 and smoothed, at `alpha` under multiply. So a frame-wide
  wash's edge wanders by its grain, not by how few points it was given:
  about 0.7 of a unit on average and half a cell at the worst, at 1000
  across. Returns its edge, as smoothed `[x, y]` points.
  - After the two deforms, each given or split point moves off the line
    through its neighbours by a Gaussian times four times its shorter edge
    times `spread` times its roughness, held within 0.75 of that edge. It
    moves less where the outline turns, and not at all at a right angle or
    sharper. So evenly spaced points closer than a cell no longer pin the
    edge at each point, and the even tooth they gave is softened, not gone.
    A thin shape strays no further, and corners and tips stay where they
    were.
  - `layers` 8 to 30, `alpha` 0.02 to 0.14. Keep one layer under 0.1 and
    build tone with more layers; small dark accents can go to 0.2.
  - `floor` (default 0.5): that share of the layers covers the whole outline
    at `alpha`, so the wash lands wherever it is asked. The rest pool: each
    is kept inside its own outline and filled with soft irregular blobs
    where `fbm` at 0.45 x the wash's size is above a level that rises, from
    the first pooled layer to the last, from 0.5 - 0.3 x `mottle` to 0.5 +
    0.3 x `mottle`, at `alpha` x (1 + `mottle`). The blobs sit on a jittered
    grid of cells, blurred by 0.3 x cell or `wet`, whichever is larger; each
    has a radius of 0.55 to 1.45 x cell with its seven vertices at 0.75 to
    1.25 of it, bigger where the noise is further above the level, so a pool
    thins at its rim.
  - `mottle` (default 0.6): how strongly the pooled layers pool. Use 0 for
    flat skies and small round accents, which paints every layer over the
    whole outline; 0.6 to 0.8 for foliage and earth.
  - `wet` (design units, default 0): feathers every layer's edge by that
    much, pools included, so the wash grades into its neighbour over several
    pixels instead of drying to an edge; the rim stays crisp either way.
    2 to 4 feathers a shade side; 0 keeps a dried edge. The feather scales
    with the output, as the marks do. On a surface with no canvas to make
    another from, the pooled layers keep a hard edge.
  - `second` and `share`: that share of the layers is painted in a second
    colour, as wet paint dropped into a wet wash.
  - `rim` (0.05 to 0.3): the dried edge, a stroke of the outline inside its
    own clip, 7 wide at `rim` and 2 wide at 1.6 x `rim`. Use 0 for a wash
    that stays wet into its neighbours.
  - Graded wash: pass `outline` as a function of the layer's place, 0 to 1,
    so every layer reaches a different depth and the colour thins to paper.
    The wash's size, its cell and its pools span every pooled layer, however
    the outline grows or shrinks. A layer whose outline collapses to one
    point paints nothing.
- `confine(g, outline, paint, outside, soften)`: runs `paint()` clipped to a
  wet shape, so washes dropped into it stop at its one edge. With `outside`
  `[w, h]` it clips to the sheet outside the shape. To make a form bleed
  into another, paint it twice: outside the other shape with its own rim,
  then inside it graded and with no rim. `soften` `{ R, name, points,
  spread }` redraws the shape with `points` evenly spaced points (default
  10), or more where an edge would be longer than 26 units, deforms it by
  `spread` of each edge (default 0.2) and smooths it, so a reserved light
  is no vector ellipse however finely it was drawn, and a large one wanders
  no further than a frame-wide wash. A reserve whose corners matter, such
  as a glint, keeps them with more points. A shape too small to keep three
  points is used as given.
- `lift(g, R, name, outline, strength)`: twelve smoothed passes of paper
  colour at `strength` / 12, each a little smaller, so the light is
  strongest at its middle. 0.45 to 0.55 for a lifted light; a thin outline
  lifted at 0.55 reads as a vein or a glint.
- `bloom(g, R, name, outline, colour, strength)`: a backrun, a paler middle
  lifted at `strength` inside three faint ragged, smoothed edges in
  `colour`. One per painting is plenty.
- `granulate(g, R, name, shape, colour, count, size)`: specks of 0.5 to 1.5
  x `size` inside a shape, clumped where `fbm` at scale 30 is above 0.55,
  alpha 0.12 to 0.34. About one speck per 30 square units of the shape.
  Ultramarine, sienna and earth colours granulate; rose and sap green do not.
- `pencil(g, R, name, points, close)`: the underdrawing, 1.2 wide in
  `rgba(80, 76, 72, 0.4)`, wobbled by 1.4, lifting at about one point in
  sixteen. Draw it before the washes so they glaze over it.
- `tips(g, R, name, lines, colour, options)`: strokes of the brush's point
  along open lines, wobbled by `amp`, round-capped. `width` and `alpha` may
  be functions of the line's index, for strokes that thin one after another.
  2 to 4 wide at 0.4 to 0.7 for accents, thin limbs and creases.
- `drybrush(g, R, name, spine, colour, options)`: `count` broken lines `gap`
  apart along a spine, each skipping about `skip` of its segments, 2.2 wide
  at 0.35. Lay it over a wash for bark, rock or rough cloth.
- `flicks(g, R, name, n, x, y, w, depth, colours, options)`: pressed strokes
  that lift off to a point, rooted along a band, 30 to 90 long, leaning up
  to 40. Grass, fur, reeds, spray.
- `splatter(g, R, name, x, y, spread, colour, n)`: 8 to 16 drops of 1 to 6
  units within `spread`, in a colour already used nearby.
- `tooth(g, R, name, w, h, count)`: about 9000 specks per million square
  units, over everything. Light specks dodge (`color-dodge`, dark grey at
  0.35), so they lighten bare paper and thin washes by up to about 0.05 of
  lightness and leave dark washes alone. Pigment specks burn (`color-burn`,
  warm pale at 0.35), so they darken in proportion to the pigment already
  there: they sit in the hollows under washes and vanish on bare paper.

A heavy form such as a limb, a hull or a trunk: a pencil line along its
spine, one wash over a tapering outline with a darker `second` and a rim,
then drybrush along the spine. A small round form: a wash at high alpha with
`mottle` 0 and a strong rim, with a speck of paper reserved for its light
through `confine` with `soften`.

## Creative direction

**Where it comes from.** Transparent watercolour grew from the topographical
and travel sketch of eighteenth-century Britain into a medium of its own, and
from the brush painting of East Asia, which shares its paper and its water.
It is a field medium: light, fast, made on the spot.

**What it tends to show.** Weather, sky, water, light on a place, plants and
flowers, travel, children's book worlds. Things that change fast suit a
medium that is painted fast. It rarely shows heavy darkness, dense
interiors or hard machinery, which leaves room for a surprise: a machine
painted as loosely as a cloud.

**Composition and framing.** One clear centre of interest painted to its
finest edge, and the rest loosening toward the sheet's edge, often a
vignette that dissolves into bare paper instead of a full rectangle. Leave
large areas of paper; the eye fills them as light or air. Lost and found
edges guide the eye: a hard edge where you want attention, a soft one where
a form turns away.

**Value, colour and light.** Plan the whites first, because they cannot be
added back. Work light to dark: the first washes are the palest and largest,
the last are small and dark. Three or four values carry a painting. Light
reads by contrast with a dark placed against a reserved white. Mix optically
by glazing rather than on the palette: a blue glaze over a dried yellow is a
cleaner green than a mixed one. Warm and cool washes side by side make light
vibrate; laid over each other they make mud.

**Motion and time.** Paper and its texture hold still: the tooth,
granulation and the paper's white stay fixed to the sheet while what is
painted on it changes. A wash spreads outward from where the brush touched,
creeping fast at first and slowing as the paper
drinks it, with its edge darkening as it dries. Transitions native to the
medium: a wash flooding across the sheet, a colour bleeding into the next
scene through wet paper, water lifting a form back to white. Hand-painted
animation often holds a painted background still and moves only a few
loose shapes, or repaints every frame so edges boil gently; keep any boil
on twos (12 drawings a second; [twos under a moving
camera](../reference/films.md#pace)) with seeds that change per drawing, not per
frame. What breaks it: washes sliding over the paper as rigid shapes, the
tooth moving with a subject, opaque fills, a uniform fade instead of a
spreading wash.

**Drawing order.** Pencil, then the palest washes with colour dropped into
them while they are wet, then darker glazes on dry paint, then darks,
brush-point strokes and dry brush, with splatter last
([draw the drawing](../reference/films.md#draw-the-drawing)). The wet drops go
in before the glazes, though the layer order lists them after. Call `pencil`
and `drybrush` on the whole path every frame inside a clip to the grown band,
so the lifts and dry breaks stay put, and each `wash` whole inside the band
of a brush sweeping across it
([grow a mark by length](../reference/films.md#draw-the-drawing)).

**Study.**

- J. M. W. Turner's late watercolours, such as *The Blue Rigi, Sunrise*,
  for wet-into-wet colour dissolving into light and paper.
- John Singer Sargent's Venice watercolours for economy: reserved whites,
  few strokes, crisp darks placed last.
- Winslow Homer's Caribbean watercolours for bold glazes, saturated water
  and lights scraped or lifted back.
- Isao Takahata's *The Tale of the Princess Kaguya* for animation that keeps
  the paper, unfinished edges and washes that stop short of their lines.
- *Ernest & Celestine* (2012) for watercolour backgrounds left loose and
  unfinished around the action, with characters drawn as line and wash.

**Levers.**

- Wetness: wet-into-wet everywhere reads as mist and mood; mostly dry glazes
  with hard rims reads as clear daylight.
- Finish: a sheet painted edge to edge reads as a picture; a vignette fading
  into paper reads as a sketch from life.
- Number of glazes: two or three keep it fresh; many make it rich and dark,
  and past six it turns muddy.
- Granulation: heavy reads as earth, stone and age; none reads as silk, sky
  and flowers.
- Paper left: much white reads as glare, snow or air; little reads as dusk
  or a full, saturated world.
- Process traces: visible pencil, blooms and splatter read as a quick study;
  none reads as a careful botanical or architectural plate.

## Palette

| Pigment | Colour | Role |
| --- | --- | --- |
| paper | `#f8f4ea` | the only white |
| cerulean | `#5b9fcc` | skies, cool lights |
| ultramarine | `#3e55a8` | shadows, granulating darks |
| rose | `#dc6f86` | warm accents, flowers, flesh |
| peach | `#f2b27a` | pale warm first washes |
| yellow ochre | `#dcaa4a` | sunlight, earth, a second colour in greens |
| burnt sienna | `#b9602f` | warm shadows, wood, earth |
| burnt umber | `#5e3d27` | darkest warm accents, dry brush |
| sap green | `#7aa13f` | foliage |
| hooker's green | `#3b7650` | foliage shadows |
| Payne's grey | `#2d3642` | the darkest darks, used sparingly |
| graphite | `rgba(80, 76, 72, 0.4)` | the underdrawing |

Pick two or three pigments for a painting and let glazes make the rest.

## Pitfalls

- High alpha per layer turns washes into opaque vector shapes; a layer under
  0.1, with tone built from more layers, stays transparent.
- Large `spread` throws spikes. The cap on each push and the split at the
  wash's cell limit them, and points closer than a cell still give a calmer
  edge than more `spread`.
- Two washes meant to meet, such as a wall and a ground at a horizon, leave
  slivers of paper between them where both edges draw back; an overlap of
  about one cell of the larger wash (its size / 16, at most 26), or the
  second painted confined to the first's edge, closes them.
- `floor` under 0.4 lets a pooled wash miss whole areas; 0.5 covers them
  unless the holes are planned.
- `wet` above 6 reads as a blurred shape, not water; 2 to 4 feathers a shade
  side.
- Complementary glazes multiply into mud; warm and cool washes kept apart,
  or with paper between them, stay clean.
- A background wash in the same hue as the form before it swallows the form;
  one graded to paper near the form, or of another temperature, frees it.
- White painted on top reads as gouache; watercolour reserves or lifts every
  light.
- An edge that is the same all the way round reads as a cut-out; some
  stretches left wet into the neighbouring wash read as painted.
