---
type: knowledge
summary: "How to draw mid-century gouache's marks with the functions in gouache.js, and how work in that tradition is composed, lit, coloured and moved; read before making a piece in mid-century gouache."
related_files: ["skills/artifex/styles/gouache.js", "skills/artifex/styles/kit.js"]
---

# Mid-century gouache

## Contents

- [What makes it read as mid-century gouache](#what-makes-it-read-as-mid-century-gouache)
- [Marks](#marks)
- [Creative direction](#creative-direction)
- [Palette](#palette)
- [Pitfalls](#pitfalls)

Opaque, matte water-based paint on illustration board, used the way
mid-twentieth-century illustrators and background painters used it: every
form cut down to a few flat shapes, a handful of colours to a scene, and the
brush left visible only where it ran dry.

## What makes it read as mid-century gouache

- Every shape is one opaque, matte colour. A lighter shape can sit on a
  darker one, because gouache covers what is under it. Nothing glazes or
  shows through.
- Edges are mostly crisp. Here and there an edge breaks into short streaks
  where the brush ran out of paint, which is the main sign that a hand
  painted the shape.
- Texture comes from a few marks laid over the flats: dry-brush drags, a
  little spatter, faint brush marks inside a flat. A flat without any of
  them reads as vector art.
- Forms are simplified into geometry: cones, columns, discs, bands and
  wedges, often tall and stacked, rarely modelled.
- Each scene keeps to four to six colours, often surprising ones, such as a
  pink ground or a turquoise mass, held together by one dominant hue.
- Value sits in planes: dark, almost black shapes nearest the viewer, a lit
  opening behind them where the eye lands, and pale haze beyond.
- The sky is the only gradient, in two or three colours, or a few flat
  bands.

## Marks

Layer them in this order: the board, the sky, the planes from the farthest to
the nearest, the lit opening and what stands in it, the dark front planes,
then dry brush and spatter over the flats they texture, and last a light
grain (`grain` from [`kit.js`](kit.js), about 4000 specks per million square
units at alpha 0.06). Paint covers, so the order decides what hides what.

- The ground is a fill of `PAINT.board` (`#efe6d2`), cream illustration
  board.
- `flat(g, R, name, outline, colour, options)`: one opaque flat with a dry
  edge. It wobbles the closed `outline` by `amp` (1.2) and fills it solid,
  with the paint's edge wandering in and out of the rim within a band `edge`
  wide (8, held to a sixth of the shape's smaller side). Returns the wobbled
  outline.
  - `dry` (0.5) is how far the paint wanders in and out of the rim and how
    much it breaks into bristle lines: 0 is a crisp cut edge; up to 0.2 the
    edge wanders smoothly, with no broken hairs; above 0.2 the hairs break in
    patches shared by neighbouring hairs, and each break tapers to a fine
    tip. 0.3 to 0.6 is a brushed edge, 0.8 to 1 a ragged one for a shape
    painted fast.
  - `streak` (0.06) is the alpha of faint brush marks across the flat,
    alternately a shade lighter and darker, laid at `angle` (0,
    horizontal). Run them along the form's long axis. Above 0.1 they read
    as wood grain.
- `drybrush(g, R, name, spine, colour, options)`: a stroke of a dry brush
  along an open spine, `width` (14) wide, as `bristles` (about 1.2 per unit
  of width) hairs, each at 75 to 100% of the stroke's `alpha` (1). The hairs
  come from `bristles` in [`kit.js`](kit.js): each breaks in long streaks
  where its paint and the board's tooth give out, at its own places, so the
  breaks never line up across the stroke. `dry` (0.5) sets how much breaks,
  more toward the stroke's sides and its end: 0.2 or less lays an almost
  solid band, 0.5 leaves about half of each hair in the last tenth, and 1
  runs most hairs out before the end. The stroke narrows as it lifts. Drag
  it over a flat in a colour one or two value steps away, for a rough
  surface, a highlight caught on an edge, or a shadow scumbled into a lit
  plane.
- `sky(g, R, name, x, y, w, h, colours, options)`: a vertical gradient
  through `colours`, top first, over the box. With `bands` it is that many
  flat bands instead, each meeting the next along a dry-brushed seam. A
  `streak` of 0.04 lays faint horizontal brush marks over it.
- `spatter(g, R, name, outline, colour, options)`: opaque drops flicked from
  a stiff brush inside a closed outline, flicked at `density` (0.004) per
  square unit of the outline's bounding box. Most drops are small, about 0.4
  of `size` (1) in radius, and about one in ten is larger than 1.5 times it,
  up to 2.75 times. Each drop is stretched along `angle`, the flick
  direction in radians (seeded when not given), the small drops most; pass
  the angle of the nearby brushwork to align them. Drops that land in low
  noise, or outside the outline, are dropped, and `clump` (0.5) raises the
  noise level needed. Measured over three seeds in a box that flicks 4000 drops,
  about 3600 to 3750 are kept at `clump` 0, 2370 to 2590 at 0.5 and 960 to
  1110 at 1, before the outline culls more, so `density` is a rate, not a
  count per unit of area. Use it on one or two flats, in a colour close to the flat's own.
- `tone(colour, depth, options)`: the colour of a plane at `depth`, 0
  nearest to 1 farthest. In front of the `clearing` depth (0.5) the paint
  darkens fast toward `PAINT.night`, about 92% dark at depth 0. At the
  clearing it is the paint lit toward `PAINT.sun` by `light` (0.3). Beyond,
  it mixes toward `PAINT.haze` by up to `fog` (0.6). Use one `tone` call per
  plane, so the planes step in value by depth. In one paint the opening is
  always lighter than the planes in front of it. Across paints, a front plane
  past depth 0.25 can outshine an opening in a darker paint, so keep front
  planes nearer than that or check them in value. The haze is paler than
  most paints lit, so the distance can be lighter than the opening. For an
  opening that is the lightest plane, `fog` 0 or a `haze` no paler than the
  opening keeps it so.
- `mix(a, b, t)` mixes two paints, and `ramp(colours, t)` reads a colour
  along a list of them. The marks and these helpers read a paint written as
  `#rgb`, `#rrggbb` or `#rrggbbaa` and throw on any other colour, such as a
  name or `rgb(...)`.

A tall form, such as a column or a cone: one `flat` with `streak` along its
height and `dry` 0.3 to 0.6, then one `drybrush` down its lit side in a paler
mix. A ground plane: one `flat` per band, wider than the frame, with dry
edges along its top. A small round form: one `flat` with `dry` 0.2 or less,
since a dry edge eats a small shape.

## Creative direction

**Where it comes from.** Gouache was the working paint of commercial art
from the 1940s to the 1960s: picture books, magazine and travel
illustration, posters, and the concept and background paintings of
animation studios. It dries matte and fast and covers in one coat, so a
painter could work in flat, opaque shapes and correct by painting over. In
those decades illustrators took flat colour and simplified geometry from
modern painting and design, and turned away from rendered realism.

**What it tends to show.** Places more than things: forests, towns,
interiors, gardens, skies at a given hour, the world of a picture book or a
travel poster. Its flat planes suit scenes that a camera moves through,
because each plane can slide on its own. It rarely shows gloss, glass,
machinery in detail, or anything photographic, which leaves room for a
surprise: a hard, technical subject reduced to a few warm, painted flats.

**Composition and framing.** Reduce every form to a few shapes, and repeat
them with variation, such as a row of columns at different heights or a band
of wedges. Stack the frame in planes: front, middle and far, each one flat.
Frame the centre of interest with dark front shapes at the edges of the frame
so that the eye goes through them to the lit opening. Tall verticals and
strong diagonals carry the design; a slight tilt keeps it lively. A frame
should read when it is the size of a thumbnail, by its silhouettes alone.

**Value, colour and light.** Plan value by planes first, then colour. Three
steps carry a scene: a near-black front, the lit opening, and a hazy
distance, paler and lower in contrast. The opening is the focus, so nothing
in front of it is lighter, and the distance behind it stays small or close
to it in value. Light is a flat shape of a
lighter colour rather than a gradient across a form, and shadow is a flat shape
of a cooler or darker colour. Choose a palette per scene: one dominant hue,
two or three that support it, and one small accent of its complement. Across
a sequence, give each scene its own key colour, so the colour itself tells
the viewer where and when they are.

**Motion and time.** A painted flat keeps its own dry edge and streaks as it
moves, as a sheet on a multiplane camera stand does; only the board's grain
stays fixed to the frame. Backgrounds hold still or pan, and planes slide at
speeds set by their depth, so the dark front planes pass fastest. Moving
shapes animate on twos, 12 drawings a second, while pans and sliding planes
stay on ones ([twos under a moving camera](../reference/films.md#pace)).
Time of day is a change of key: shift every plane's paint toward a new light and sky together, slowly,
as the sun or the weather would. Transitions native to the medium: a dark
front plane crossing the frame as the camera moves, uncovering the next
scene behind it; a scene re-keyed from one palette to another; a flat
painted over by the next colour. What breaks it: soft airbrushed shading on
forms, rendered highlights, textures that slide across the shapes they belong
to, and too many colours in one scene.

**Drawing order.** Painted in the layer order, a big brush before a small one:
sky, planes far to near, the lit opening, the dark front planes, then dry
brush and spatter, with the smallest lights last
([draw the drawing](../reference/films.md#draw-the-drawing)). Call `sky` and
each `flat` plane whole inside the band of a broad sweep across it, and a
`drybrush` stroke on its whole spine inside a clip to the grown band, so the
streaks and dry breaks stay put
([grow a mark by length](../reference/films.md#draw-the-drawing)).

**Study.**

- Mary Blair's concept paintings for flat shapes in unexpected colours and a
  new colour key for each scene.
- Eyvind Earle's landscape paintings for tall, stylized forms, decorative
  repetition and textured flats.
- Alice and Martin Provensen's picture books for flat gouache shapes with
  dry-brush texture and a restrained palette.
- Miroslav Šašek's illustrated city guides for loose, opaque flats and a
  quick dry line over them.
- Charley Harper's prints for reducing any form to a few geometric shapes.

**Levers.**

- Planes: two planes read as a graphic poster; four or five read as deep
  space a camera can travel through.
- Palette size: three colours read bold and stylized; six read rich and
  painterly. Past six the scene loses its key.
- Dryness: crisp edges everywhere read as print or design; dry, broken edges
  read as quick, hand-painted work.
- Front value: near-black silhouettes read as dusk, mystery or a frame
  around the subject; coloured dark planes read as a bright day.
- Geometry: hard cones and columns read as stylized and modern; softer,
  lumpier shapes read as warm and naive.
- Texture: a little dry brush and spatter reads as finished illustration;
  none reads as flat vector art; a lot reads as a rough sketch.
- Rewetting: dry gouache softens again under a wet brush, so a flat painted
  over another lifts a little of it. A drybrush stroke whose first stretch is
  `mixPigment(own, under, 0.2)` from `core/colour.js` reads as paint worked
  in one sitting; a clean colour over every flat reads as each layer left to
  dry.

## Palette

| Paint | Colour | Role |
| --- | --- | --- |
| board | `#efe6d2` | the ground, and the white where it shows |
| night | `#16181f` | the darkest front planes, slightly blue |
| haze | `#cfd8cf` | what far planes mix toward |
| sun | `#fff0c4` | what the lit opening mixes toward |
| turquoise | `#3f9c99` | a cool key colour |
| teal | `#1f5c63` | cool darks, middle planes |
| olive | `#7f8f3a` | ground, a muted green |
| chartreuse | `#c4c64c` | lit ground, a bright accent |
| mustard | `#d9a43a` | warm light, a warm key |
| coral | `#e2694c` | warm key colour, sky at dusk |
| vermilion | `#cf412c` | the small accent of a cool scene |
| pink | `#e9a7a1` | warm skies, an unexpected ground |
| violet | `#66578a` | shadow, dusk |
| ultramarine | `#2e4787` | night sky, deep shadow |
| sand | `#e2c48e` | pale warm ground |
| umber | `#57392a` | warm darks |

Pick four to six paints for a scene, and let `tone` derive each plane's
value from them.

## Pitfalls

- A gradient on a form reads as digital airbrush; gouache keeps gradients for
  the sky and lights a form with a second flat shape.
- The same dry edge on every shape reads as a filter; most edges crisp
  (`dry` 0.2 or less, which lays no broken hairs) and a few ragged ones read
  as a brush.
- `dry` above about 0.3 on a small shape makes its rim ragged, and the ragged
  ring is a big share of it. The band is held to a sixth of the smaller side
  of the shape's box, and the solid fill stops at most 0.7 of a band inside
  the rim, so the ring takes up to about 23% of the smaller side and a solid
  core of at least about 77% stays. Small shapes read best crisp.
- Front planes that are not dark enough merge with the opening behind them;
  a lit opening lighter than every plane in front of it holds them apart.
- A broad, pale distance outshines the opening and pulls the eye past it; a
  small one, or a lower `fog`, stays near the opening's value.
- Too many colours lose the scene's key; a seventh colour mixed from the
  scene's paints with `mix` keeps it.
- Spatter or dry brush over everything turns texture into noise; on one or
  two flats in a scene it reads as texture.
- Outlines around every shape read as a cartoon; gouache separates shapes by
  value and colour and keeps a dry line for a few accents.
