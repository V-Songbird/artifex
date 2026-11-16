---
type: knowledge
summary: "How to draw impasto's marks with the functions in impasto.js, and how work in impasto is composed, lit, coloured and moved; read before making a piece in impasto."
related_files: ["skills/artifex/styles/impasto.js", "skills/artifex/styles/kit.js"]
---

# Impasto

## Contents

- [What makes it read as impasto](#what-makes-it-read-as-impasto)
- [Marks](#marks)
- [Creative direction](#creative-direction)
- [Palette](#palette)
- [Pitfalls](#pitfalls)

Oil paint laid so thick that each stroke keeps its shape and stands off the
canvas, catching the light on one ridge and casting a small shadow on the
other.

## What makes it read as impasto

- The whole surface is strokes; nothing is a flat fill.
- Each stroke has relief: a loaded start dragged out to a thin end, bristle
  grooves along it, a broken lit ridge on the side that faces the light and
  a dark ridge on the other.
- Strokes follow a flow: across open ground they swirl and drift; inside a
  form they wrap it, along its cross-contours or along its axis.
- Strokes are sized from their mass: broad on big planes and away from the
  focus, small at the focus and on small parts.
- One light over everything. Lighting parts separately leaves seams, such as
  a cool band where two parts meet.
- Cool blue-grey shadows against warm lights, with dark accents along the
  undersides of forms.
- Each stroke is one mixed colour. Blending happens between strokes, by
  placing them side by side.

## Marks

Layer them in this order:

1. A ground colour.
2. A block-in: fill each background area and each form's mass once at its
   value group's colour (`kit.path`, then one `fill`). Strokes cover it, so
   it is not the finish, but no canvas shows between them and the dark
   areas read dark in the value view.
3. The background strokes, in a shuffled order.
4. The strokes that model each form.
5. Contour accents.
6. The smallest dark and bright accents.
7. Grain (`kit.grain`, about 4000 specks per million square units).

- `dab(g, x, y, angle, len, wide, colour, light)`: one stroke centred at
  (x, y), `len` by `wide` half sizes. A loaded head at its start drags out
  along `angle` to a thinner, ragged end. Three to five bristle grooves run
  along it in the dark ridge colour (38% toward `#3a2a1e`). A lit ridge 42%
  toward white, broken into two to four dashes, sits on the side facing
  `light` (default `LIGHT`, from the upper left), and a thin dark ridge on
  the other. The grooves and dashes change from stroke to stroke, but under
  one `light` the lit ridge is always on the same side. Background strokes
  17 to 27 long and 6 to 9 wide, form strokes 11 to 16 by 4.2 to 6 before
  `model` sizes them, accents 4 to 9 by 2 to 5, at a 1000-unit canvas.
- `scatter(R, name, x0, y0, x1, y1, step, jitter)`: where strokes go, a grid
  of `step` jittered by up to `jitter`, returned shuffled so no row sits on
  top. Step 19 and jitter 18 for a background, step 9 and jitter 8 inside
  forms, so strokes overlap by about half.
- `flow(R, name, x, y, vortices, options)`: the angle of a swirling field:
  a `drift` (default rising to the right) plus vortices `[cx, cy, ±1]` each
  adding `gain` / (d² + `soft`), turned by `fbm` at `scale` 260 times
  `turn` 2.2 radians. Two to four vortices of alternating spin fill a
  square frame; none gives a steady wind.
- `ramp(stops, v)` with `FIRE`: a value mapped through thresholds 0.36,
  0.43, 0.5, 0.56 and 0.62 to `#c8412a` `#e0612a` `#f08a3c` `#f7b267`
  `#f4dcb8` `#fbf3e6`. Feed it `fbm` at scale 230, domain-warped at scale
  420, for a ground of flame and cloud; scatter about 1.5% of strokes in an
  accent such as gold `#e9b949`.
- `shade(x, y, centre, r, from, options)`: how lit a point is on a form of
  size `r`. By default a flat plane: about 0.5 at its centre, rising toward
  the light. With `form: 'round'` (a ball of radius `r`) or `form: 'long'`
  (a cylinder of half-width `r` whose axis runs at angle `axis`), light and
  shade split at the terminator: lit points fall in 0.6 to 1, shaded ones
  below 0.4, so a column turns from light to shade across its width, not
  top to bottom. Use one light, and one centre per round form, for the
  whole of a form.
- `across(centre, r, axis, tilt)`: an `angle` for `model` that lays a round
  mass's strokes along its cross-contours, sections that bow away from
  `axis` (default `LIGHT`, so they run with the terminator) and flatten to
  `tilt` (default 0.45).
- `pick(palette, t)`: the colour at `t` of a palette sorted dark to light,
  four or five steps from a cool shadow to a warm light. The shade steps of
  every form's palette shift toward a cool, not only darker.
- `model(g, R, name, cells, parts, options)`: strokes that model forms. Each
  cell takes the first part whose `shape` holds it and lays a stroke along
  `angle(x, y)` (plus up to ±0.25 of wobble) in `colour(x, y)`. A round mass
  takes `across(centre, r)`; a long or flat part runs its strokes along its
  axis. Each part's strokes are scaled in width and length by its `size`,
  or by default by the square root of its area over `mass` (default 160),
  held to 0.75 to 2.2. With `focus: [x, y]` they grow again with distance
  from it, up to `far` (default 0.6) larger at `reach` (default 450). A
  part's `scale` scales the length only: a small hard part takes `scale`
  0.8.
- `contour(g, points, colour, options)`: strokes laid along an outline on
  every `every`th point where `keep(p)` allows: a dark accent along a
  form's underside (every third point, 11 by 3.6) or a bright edge where
  the light catches it (every fourth, 9 by 3).

Size a stroke from its mass: big planes take broad strokes and small hard
parts narrow ones, and strokes grow again away from the focus, so the
smallest strokes sit where the eye should land. `model` does this from each
part's area and its `focus` option; size background strokes the same way.

Separate a form from the ground in value, not by an outline: pull the ground
near each part toward a value that differs from that part, paler beside a
dark part, darker beside a pale one, blended by distance (a Gaussian of
sigma about 160 units).

## Creative direction

**Where it comes from.** Oil painting, where thick paint was first used for
the brightest lights over thin shadows, as in Rembrandt's late work, and
then over whole canvases by Van Gogh and the Expressionists, and later by
painters who build a picture up layer on layer.

**What it tends to show.** Faces and heads, landscapes in wind and
weather, night skies, flowers, still lifes: subjects where energy and
touch matter more than detail. It rarely shows fine machinery or crisp
text, which leaves room for a surprise: a precise object rendered as a
storm of strokes.

**Composition and framing.** Strong, simple masses that hold up under heavy
texture. Forms large in the frame, often cropped close, since thick strokes
eat small detail. The direction of the strokes is half the composition:
let the flow lead the eye toward the main form and wrap it, and let the
strokes change direction where the form turns.

**Value, colour and light.** The classical convention is thick lights and
thin darks: impasto catches real light on its ridges, so it goes where the
picture is brightest. Colour is laid in separate strokes of pure mixed
colour, with complementary pairs side by side (orange against blue, red
against green) so the eye mixes them. Shadows go cool, lights warm. Keep
one light direction for every ridge in the picture.

**Motion and time.** The paint itself holds still: once laid, a stroke
stays put on the canvas. Painted
animation repaints every frame, so strokes boil and shimmer; keep the boil
at about 12 drawings a second ([twos under a moving
camera](../reference/films.md#pace)) and let the background boil less than the
moving forms. Native transitions: a palette knife scraping one picture into
the next, wet paint smeared across the frame, new strokes laid over the old
image until it becomes another. What breaks it: strokes moving as rigid
stickers over a still ground, ridges whose light turns with each stroke
instead of staying fixed in the world, flat fills between the strokes.

**Drawing order.** Shown being made, strokes go on one at a time in the layer
order: ground, block-in, background strokes, modelling strokes, then accents,
with the thickest, brightest lights last, speeding up into a time-lapse
([draw the drawing](../reference/films.md#draw-the-drawing)). Each `dab` goes
on whole, one stroke at a time; a `contour` grows dab by dab when called on
its whole outline with a `keep` that admits only the points the hand has
reached, so each dab keeps its heading.

**Study.**

- Vincent van Gogh's *The Starry Night* for strokes that follow a swirling
  flow and turn the whole sky into movement.
- Rembrandt's late self-portraits for thick paint only in the lights and
  thin, dark shadows.
- Frank Auerbach's portrait heads for forms built from paint piled and
  scraped back until it holds.
- *Loving Vincent* (2017), painted frame by frame in oil, for how painted
  strokes move and boil in a film.

**Levers.**

- Stroke size: large strokes read as gesture and speed; small, dense ones
  read as patience and texture.
- Flow: one steady drift reads as wind; vortices read as turmoil or a
  starry night; strokes that only follow form read as stillness.
- Relief: deep ridges with strong dark sides read as heavy, sculpted paint;
  shallow ridges read as a thinner, more painterly surface.
- Temperature: warm ground with cool forms makes them advance; the reverse
  makes them sink into the light.
- Colour separation: complementary strokes side by side read as vibrating
  light; close-valued strokes read as calm.
- Ground coverage: strokes everywhere read as a finished canvas; bare
  ground showing between strokes reads as a sketch.
- Wet into wet: a stroke dragged through wet paint picks up the colour it
  crosses and carries it along, clearing back to its own colour over its
  length. Starting each such stroke at `mixPigment(own, under, 0.3)` from
  `core/colour.js` and stepping back to `own` reads as paint worked fast
  and wet; strokes that keep one colour read as paint laid on a dry layer.

## Palette

| Role | Colours, dark to light |
| --- | --- |
| cool form, shadow to light | `#8e98bf` `#c9b8b9` `#e6d3c1` `#f6ebd9` `#fffaf1` |
| hot form, its two shade steps cooled toward `#4a5a9c` | `#a03b75` `#c64166` `#ea6a45` `#f39a6b` |
| fire and cloud ground (`FIRE`) | `#c8412a` `#e0612a` `#f08a3c` `#f7b267` `#f4dcb8` `#fbf3e6` |
| gold accents | `#d99a2b` `#e9b949` `#f2c94c` |
| dark accent | `#27365e` `#1f2a4a` |
| canvas | `#f3ead8` |

## Pitfalls

- Strokes shorter than about 11 units at a 1000-unit canvas read as fine
  hatching, not paint.
- Too much white in a fire ramp loses the fire; the `FIRE` thresholds keep
  roughly half a ground warm.
- One shift of the whole ground round a form merges it with some part: a
  paler ground swallows a pale part, a redder one swallows a red part. A
  ground pulled away from each part's own value keeps them apart.
- Strokes laid in rows show the grid; shuffled, they read as paint.
- Shading the parts of one round mass from separate centres leaves a seam
  where they meet, such as a cool band across a join; one centre per mass
  hides the join.
- Strokes turned round a ball's centre read as a whorl, not a form; laid
  along its cross-contours with `across`, they turn it.
- A shade step that is the light colour darkened at the same hue reads as
  dirty; shade steps shifted toward a cool, such as with `mixOklch` from
  `core/colour.js`, stay clean.
- The same stroke size on every plane reads as shag pile; strokes sized
  from their mass read as form.
