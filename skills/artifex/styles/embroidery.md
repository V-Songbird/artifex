---
type: knowledge
summary: "How to draw embroidery's marks with the functions in embroidery.js, and how work in embroidery is composed, lit, coloured and moved; read before making a piece in embroidery."
related_files: ["skills/artifex/styles/embroidery.js", "skills/artifex/styles/kit.js"]
---

# Embroidery

## Contents

- [What makes it read as embroidery](#what-makes-it-read-as-embroidery)
- [Marks](#marks)
- [Creative direction](#creative-direction)
- [Palette](#palette)
- [Pitfalls](#pitfalls)

Bright thread stitched into dark cloth: shapes filled with dense satin
stitch, outlined with couched strands, and dotted with knots. Each strand is
a little raised, so it has a shadowed edge and a streak of sheen where it
catches the light.

## What makes it read as embroidery

- Fills are dense back-and-forth zigzags of thread, clipped to each shape,
  over a darker underfill, with a second, sparser crossing pass of lighter
  thread.
- Every strand has a dark under-edge on one side and a dashed light sheen
  on the other, always on the same sides, so the thread reads as raised and
  lit from one direction.
- The ground is dark cloth with a faint diagonal weave.
- A hand's wobble on every line: nothing is ruled, and outlines sit a little
  off the fill's edge.
- Each shape is one thread colour. Colours sit side by side rather than
  blending.
- Thin, sparse strokes on light paper read as a doodle instead.

## Marks

Layer in this order: the cloth, then satin fills, then outlines and long
strands over them, then knots, then glints.

- `cloth(g, R, w, h, { colour, weave, angle, dashes })`: the ground,
  `#10153a`, and the weave: 340 short dashes per million square units, 8 to
  16 long and 2.2 wide, at `angle` (-1.15) plus or minus 0.12, in pale blue
  at alpha 0.07. It leaves the line cap round.
- `satin(g, R, name, poly, thread, spacing, width, angle)`: a satin-stitch
  fill. Inside a clip to `poly`, a 45% underfill of the thread's dark tone,
  then a `zigzag` across the shape at `angle` and `spacing`, wobbled with
  amplitude 2.4 at a step of 12 and stroked `width` wide in the body
  colour, then a crossing pass at angle + 0.55, spacing x 1.7 and width x
  0.35 in the light tone at alpha 0.35. Spacing 9 to 11 and width 6 to 8
  for a large shape; spacing 6 and width 4 for a small patch such as a
  cheek. Turn the angle between neighbouring shapes, about 0.9 apart, so
  each reads as its own piece of stitching.
- `zigzag(poly, angle, spacing)`: the path a satin fill follows, a
  boustrophedon across the polygon's bounding circle, for stitch paths of
  your own.
- `strand(g, pts, thread, width, close)`: one couched strand along `pts`.
  The dark tone `width` wide, offset (2, 2.5) as its under-edge; the body
  at 0.78 of the width; the light tone at 0.13 of the width, dashed
  [2.4 w, 0.8 w] and offset (-0.15 w, -0.15 w), at alpha 0.7, as the sheen.
  Wobble the path first with kit's `wobble(pts, R, name, amp, step,
  close)`: amplitude 2 to 2.2 at a step of 10 for an outline, 1 to 1.5 at a
  step of 8 to 10 for small shapes and veins. Widths: 9 to 10 to outline a
  large fill, 6 to 7 for small shapes, 3 to 5 for veins, ribs and details,
  14 to 24 for a heavy stem or a thick part laid as one strand. Several
  wide strands fanned from one point make a tuft or a spray.
- `knot(g, x, y, r, thread)`: a French knot or a bead, a solid dot in the
  body colour, radius 5 to 10.
- `sparkle(g, x, y, r)`: a glint of metallic thread or a sequin, a white
  four-pointed star of radius 10 to 26 with a glow (shadow blur 12). Keep
  them few and away from the main shape.
- `THREADS` holds the thread triples below: body, dark, light.

To build a form: split it into shapes, give each a thread and a stitch
angle, fill each with `satin`, then outline each with a wobbled `strand` in
the same thread. A part too thin to fill, such as a leg, a stem or a line of
text, is a single `strand`. A small solid part, such as a point or a tip,
can be filled flat in the body colour and outlined. An eye is a white disc
outlined with a dark strand, a dark pupil and a white glint.

## Creative direction

**Where it comes from.** Hand embroidery is one of the oldest decorative
crafts, found in folk dress, samplers, banners and tapestries across the
world; machine embroidery carries the same look onto badges, patches and
jackets. This style is closest to bright satin-stitch work and to
embroidered patches: bold colour, clear shapes, a raised surface.

**What it tends to show.** Flowers, leaves, animals, hearts, stars,
suns, initials and short words: emblems that read at a glance and repeat
well. Folk work shows its own world, its plants and its stories. It rarely
shows atmosphere, deep space, soft light or a crowded street, so a city at
night or a portrait in thread can surprise.

**Composition.** Motifs are flat and frontal, set on the cloth with space
around them: one central emblem, a symmetric arrangement, a border of
repeats, or a strip that tells a story from left to right. There is no
perspective and little overlap; size shows importance, not distance. The
cloth's edge, a hoop or a patch border can frame the work.

**Value, colour and light.** The dark cloth is the shadow; every thread is
lighter than it. Colours are saturated and stand side by side, each shape
one hue, with no gradients except what the dark under-edge and light
sheen give. Light is the sheen on each strand, from one fixed direction.
Pale thread on dark cloth reads as night or as gold work.

**Motion and time.** Embroidery moves best as stop-motion, at 12 frames a
second or less ([stop-motion under a moving camera](../reference/films.md#pace)); a camera locked onto a stepping
patch makes each step jump back and forth on screen, so a fixed, panning or drifting one frames it. Stitches are fixed to the cloth, so a shape that moves is
either a whole patch, cut out and moved over the cloth with its stitches
in steps, one place per drawing, or stitched again in its new place, the
stitches changing each drawing.
Marks can appear as they are sewn: a strand drawn along its path stitch by
stitch, a fill growing row by row. Native transitions are stitching in,
unpicking, thread pulled tight to draw a shape closed, and the cloth
gathered or turned to show its knotted back. What breaks it: smooth
scaling, which makes the stitch spacing grow and shrink; thread texture
that slides inside a moving shape; and colour that fades or blends between
shapes.

**Drawing order.** Sewn in the layer order: satin fills row by row, then
outlines and long strands, then knots, with the needle and its thread as the
tool ([draw the drawing](../reference/films.md#draw-the-drawing)). A `satin`
grows row by row, called whole inside a clip to the grown band of its own
`zigzag` path, the band a little wider than its `spacing`. A strand's path is wobbled
once, then each frame draws `strand` along `grow(path, d).points`
([grow a mark by length](../reference/films.md#draw-the-drawing)).

**Study.**

- The Bayeux Tapestry, for a long narrative in a strip, a few wool colours
  in laid and couched work, and figures set on bare cloth.
- Sashiko, the Japanese running-stitch work in white thread on indigo, for
  pale stitching on a dark ground and patterns built from one stitch.
- Tenango embroidery of the Otomi people of Mexico, for bright flat
  animals and plants, each in one colour, filling the cloth.
- Suzani textiles of Central Asia, for large suns and flowers in bold
  colour across a whole cloth.
- *Kirby's Epic Yarn* (2010), for a world drawn in yarn outlines that
  moves, pulls and unravels.

**Levers.**

- Stitch density: spacing 6 reads as tight machine satin; spacing 12 or
  more reads as loose hand stitching.
- Sheen: a strong, wide sheen reads as silk or metallic thread; little
  sheen reads as wool or cotton.
- Ground: a near-black cloth makes threads glow; a mid-tone cloth makes the
  piece quieter and more folk.
- Palette: two or three threads read as a badge or a crest; many threads
  read as folk abundance.
- Fill or line: shapes filled solid read as patches; outlines only read as
  a sketch in thread.
- Wobble: more wobble reads as handmade; almost none reads as machine.
- Symmetry: mirrored motifs read as ornament; a figure off centre reads as
  a picture.

## Palette

Thread triples are body, dark and light.

| Thread | Body | Dark | Light |
| --- | --- | --- | --- |
| purple | `#8a4fd8` | `#4b2a86` | `#c6a3f7` |
| red | `#ef4a3c` | `#9e2a22` | `#ff9a86` |
| yellow | `#f7c52b` | `#a47a0c` | `#fff0a8` |
| green | `#3dbb58` | `#1f7a35` | `#9be8aa` |
| blue | `#2e8ee6` | `#1a5494` | `#9fd0fa` |
| orange | `#f6892a` | `#a4520f` | `#ffd0a0` |
| brown | `#8a5a3c` | `#4f3122` | `#c69a78` |
| white | `#f4f2ff` | `#8a86b8` | `#ffffff` |
| black | `#1c1640` | `#0a0820` | `#6a62a8` |

The cloth is navy `#10153a` with a weave of rgba(170, 180, 255, 0.07).
Glints are white.

## Pitfalls

- Thin, sparse strokes on light paper read as a doodle; dense fills on a dark
  ground read as thread.
- Without a sheen on one side of every strand, the thread looks flat.
- A fill without the dark underfill lets the cloth show between the
  stitches, and the shape looks thin.
- Neighbouring shapes stitched at one angle merge into one; a turned angle parts them.
- A strand on an unwobbled path reads as a vector stroke; a wobbled path
  reads as thread.
- Too many sparkles read as a greeting card; a few, away from the main
  shape, read as metallic thread.
