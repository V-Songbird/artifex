---
type: knowledge
summary: "How to draw Kandinsky's marks with the functions in kandinsky.js, and how work in Kandinsky's manner is composed, lit, coloured and moved; read before making a piece in Kandinsky's manner."
related_files: ["skills/artifex/styles/kandinsky.js", "skills/artifex/styles/kit.js"]
---

# Kandinsky

## Contents

- [What makes it read as Kandinsky](#what-makes-it-read-as-kandinsky)
- [Marks](#marks)
- [Creative direction](#creative-direction)
- [Palette](#palette)
- [Pitfalls](#pitfalls)

Geometric abstraction in the manner of Wassily Kandinsky's Bauhaus years:
circles, lines and planes placed like notes in a composition, glazed colour
on warm paper.

## What makes it read as Kandinsky

- Circles with soft halos, and concentric rings.
- Triangles, half discs, rainbow arcs, heavy bars, chequer strips and small
  grids.
- Thin black lines and long arcs crossing the whole composition and running
  past the forms.
- Overlapping colour multiplies like glazes: `globalCompositeOperation =
  'multiply'`.
- Warm paper with a slight vignette and grain.
- Anything figurative is assembled from these forms rather than drawn as
  an outline.
- Diagonal tension: forms lean, float and pull against each other; nothing
  rests on a level ground.

## Marks

Layer them in this order: paper, halos, long crossing lines, the large
colour planes in a `glaze` block, the black lines, rings and bars over them,
small floating forms, then grain (`kit.grain`, about 6000 specks per million
square units).

- `paper(g, w, h)`: paper `#efe8d8` with a radial vignette to
  `rgba(120, 95, 60, 0.16)`.
- `halo(g, x, y, r0, r1, rgb, alpha)`: a radial wash of `'r, g, b'` from
  `alpha` 0.14 to 0.35 at `r0` to nothing at `r1`, about twice the radius of
  the form it sits under. Lay halos first, as washes.
- `glaze(g, paint)`: runs `paint()` under multiply, so the planes inside it
  darken where they overlap, like transparent colour.
- `disc(g, x, y, r, fill)`: a circle; `fill` may be a radial gradient with
  its centre offset toward a light for a graded, glowing circle.
- `half(g, x, y, r, from, fill)`: a half disc, its straight edge starting at
  angle `from`; tilt it off the level.
- `shape(g, points, fill)`: a filled polygon, usually a sharp triangle.
- `rainbow(g, x, y, r, width, a0, a1, colours)`: concentric arc bands
  `width` wide from radius `r`, one per colour, butt-capped; six bands of 15
  through the spectrum.
- `arc(g, x, y, r, width, colour, a0, a1)`: a stroked arc, or a whole ring
  by default. Long arcs of radius 500 to 700 at width 3 cross the frame;
  rings of width 8 to 11 round a dot; rings inside rings make an eye-like
  target (light disc, coloured ring, black core, a small light glint).
- `line(g, a, b, width, colour, cap)`: a straight line, 2 to 3 for crossing
  lines, 7 for a heavy one, 24 for a bar.
- `chequer(g, x, y, angle, cols, rows, size)`: a black and light chequer
  strip of 14-unit squares along `angle`, outlined; lay it along a bar.
- `grid(g, x0, y0, x1, y1, step, count, width)`: a small grid of thin lines,
  five each way 22 apart.
- `ruler(g, a, b, options)`: a line with ticks every 16 along part of it, a
  measured line.
- `crescent(g, w, h, disc, bite, fill)`: a disc with a second disc cut out
  of it by an even-odd clip.

To assemble a figure, map each part to a form: a round part to a graded
circle with a halo, a pointed part to a triangle, a mass to a half disc with
a glazed circle across it, a fan of parts to rainbow arcs or fanned lines, a
long part to a bar with a chequer strip, a looking part to rings inside
rings. Let the forms overlap and the lines run on past them.

## Creative direction

**Where it comes from.** Kandinsky moved from the lyrical, loose
abstractions of his Munich years to the geometric work of his Bauhaus
teaching (1922 to 1933), where he set out a grammar of point, line and plane
and of what each colour and form does.

**What it tends to show.** Nothing in particular: the picture is the
subject, a composition in the musical sense. Titles are musical or plain
(Composition, Improvisation, Several Circles). Figurative work in this
manner is rare, which leaves room for a surprise: a recognisable thing
built only of his forms, which reads as a riddle the eye solves.

**Composition and framing.** A light ground with forms scattered across it
in balanced tension, off any grid and asymmetric. Diagonals carry
energy; horizontals rest; a circle is the calmest, most self-contained form;
a triangle points and drives. A large form is balanced by several small ones
across the frame. Lines start and stop in space, cross forms and run off the
edge. There is no horizon, no ground and no single viewpoint.

**Value, colour and light.** Colour has character: yellow is sharp and
advances, blue is deep and recedes, red is warm and firm, black is silence.
He paired colours with forms, yellow with the triangle, red with the square,
blue with the circle, though his own pictures break the rule freely. Bright
primaries and their neighbours against black lines and a warm light ground;
or, as in *Several Circles*, glowing circles on a dark ground. Light comes
from the colours themselves: halos and graded circles glow, nothing casts a
shadow.

**Motion and time.** Animation in this manner is visual music: forms enter,
grow, pulse and move on the beat and phrase of a sound, rather than
travelling through a space. Circles expand from a point, lines draw
themselves across the frame, a triangle snaps in on an accent, and a held
chord is a held composition. Timing follows the music: sharp forms and
yellow on attacks, circles and blue on long, low notes. A camera rarely
moves; the frame is the canvas. What breaks it: perspective, a ground or
horizon, forms that bounce like physical objects with weight, and smooth,
even easing on everything, which loses the rhythm.

**Drawing order.** The large colour planes first, then the long crossing
lines, then black lines, rings and bars, with small floating forms last
([draw the drawing](../reference/films.md#draw-the-drawing)). The crossing
lines go in after the planes, though they layer under them. A `line` grows
by moving its end `b` from `a`, and an `arc` by moving `a1` from `a0`; a
`shape` or `disc` plane fills inside a swept band
([grow a mark by length](../reference/films.md#draw-the-drawing)).

**Sound.** Kandinsky heard colour as sound: in *Concerning the Spiritual in
Art* yellow is a trumpet's blare, and blue deepens from a flute to a cello to
an organ. Visual music films sync forms to the score, a form for each
instrument or phrase.

**Study.**

- *Composition VIII* (1923) for a light ground, crossing lines, circles and
  triangles held in diagonal tension.
- *Several Circles* (1926) for glowing, overlapping circles with halos on a
  dark ground.
- *Point and Line to Plane* (1926), Kandinsky's Bauhaus book, for what each
  element does in a composition.
- Oskar Fischinger's *An Optical Poem* (1938) for circles and forms moving
  in time with music.
- Hans Richter's *Rhythmus 21* (1921) for rectangles growing and shrinking
  as pure rhythm in an animated frame.

**Levers.**

- Density: a few large forms read as calm and monumental; many small ones
  read as busy, playful, musical.
- Ground: warm light paper reads as daylight and clarity; a dark ground
  makes circles glow like planets.
- Line weight: many thin crossing lines read as tension and speed; a few
  heavy bars read as weight and structure.
- Glazing: heavy overlaps under multiply read as transparent depth; forms
  kept apart read as cut paper.
- Diagonal: steep diagonals read as energy and fall; near-level ones read
  as rest.
- Colour temperature: yellow and red forms advance and shout; blue and
  violet recede and hum.

## Palette

| Role | Colours |
| --- | --- |
| paper | `#efe8d8` |
| line, accents | black `#1b1b1f`, light `#fbf7ee` |
| warm planes | red `#d8412f`, vermilion `#e0452b`, orange `#ec8a2f`, yellow `#f2c14e`, ochre `#d9a441`, pink `#e98aa6` |
| cool planes | blue `#2f5fa7`, deep blue `#23407a`, teal `#3fa9a2`, green `#5a9e5a`, violet `#7b5ea7` |
| halos | any plane colour at alpha 0.14 to 0.35 |

Give each piece one scheme: decide which colour plays which role (the main
circle, the glaze, the accents, the halos) and keep it, so a seed can swap
schemes without the picture losing its balance.

## Pitfalls

- Without multiply, overlaps look like cut paper, not glazes.
- Symmetry stills it; diagonals, and lines running past the forms, keep the
  tension.
- An outline traced round a figure reads as a cartoon; separate forms that
  overlap build it instead.
- Every form the same size reads as a pattern; strong changes of scale read
  as a composition.
- Lines that stop exactly at a form's edge look fitted; lines that start and
  end in open space look free.
