---
type: knowledge
summary: "How to draw CAD's marks with the functions in cad.js, and how work in CAD is composed, lit, coloured and moved; read before making a piece in CAD."
related_files: ["skills/artifex/styles/cad.js", "skills/artifex/styles/kit.js"]
---

# CAD drawing

## Contents

- [What makes it read as CAD](#what-makes-it-read-as-cad)
- [Marks](#marks)
- [Creative direction](#creative-direction)
- [Palette](#palette)
- [Pitfalls](#pitfalls)

A technical drawing as a CAD package shows it in model space, with no
interface: line work in layer colours on a dark ground, measured, projected
and annotated in a stroke font. It descends from drafting on paper, where
every line type and every number has one meaning.

## What makes it read as CAD

- A dark model ground, such as grey-blue `#212830`, black, dark green or grey,
  and one saturated colour per layer: white objects, yellow hidden edges, red
  centre lines, magenta phantoms, cyan dimensions.
- Lines rather than fills: an outline is a stroke of fixed width. A visible
  outline hides what lies behind it, because it is filled with the ground
  before it is stroked.
- Line type carries meaning: solid for what is seen, dashed for what is
  hidden, long-short dashes for centres and axes, long-short-short for
  alternate positions.
- Orthographic geometry: what is drawn is measured, not seen. No perspective,
  no light, no shading.
- Dimensions computed from the geometry, with filled arrowheads and extension
  lines that leave a small gap at the object.
- Stroke-font text, like a CAD package's SHX fonts: single-line capitals.
- Paper texture, halftone or collage read as illustration.

## Marks

Coordinates are design units. Set the pen with `layer(g, name, width)`
before each mark; the table below is the `LAYER` constant.

| Layer | Colour | Width | Dash |
| --- | --- | --- | --- |
| `object` | `#ffffff` | 2.4 | solid |
| `hidden` | `#ffff00` | 1.4 | 9 5 |
| `center` | `#ff0000` | 1.2 | 26 5 5 5 |
| `phantom` | `#ff00ff` | 1.3 | 26 5 5 5 5 5 |
| `dim` | `#00ffff` | 1.2 | solid |
| `hatch` | `#808080` | 1 | solid |
| `cut` | `#00ff00` | 2.8 | 30 6 6 6 |
| `construct` | `#7d8996` | 1 | 4 4 |
| `frame` | `#ffffff` | 1.4 | solid |
| `text` | `#ffff00` | 1.4 | solid |
| `label` | `#b8c0c8` | 1.1 | solid |

Layer the marks in this order: ground, construction lines, hidden edges of
parts that something will cover, visible outlines back to front, centre and
phantom lines, sections, dimensions and leaders, then labels.

**Outlines.** `solid(g, pts, ground)` fills a closed outline with the ground
colour, then strokes it in the object layer. Draw parts back to front: each
one hides what it covers, with no boolean geometry. Draw a hidden edge
(`layer(g, 'hidden')`, then a path) before the part that passes in front of
it. `seg(g, a, b)` draws one straight line in the current pen; use it for
edges, axes and short strokes such as a foot line.

**Centre and construction lines.** `centreLines(g, c, rx, ry)` crosses a
round feature with two centre lines that run 12 past its edge; every hole and
circle gets them. A single centre line marks an axis of symmetry. The
`construct` layer draws faint dashed circles and lines a form was built on;
leave a few in, as a drafter's working lines. The `phantom` layer draws a
part's other positions, a fold line or a path of travel.

**Sections.** A section shows a cut face. `spanAt(poly, x)` finds where a
closed outline crosses a vertical cutting line, which gives the extent of the
cut. `sectionFill(g, poly, ground, angle, spacing, cross)` draws the cut face:
a solid outline, hatching at `angle` (45 degrees, spacing 9 is ANSI 31),
crossed at the opposite angle when `cross` (ANSI 37), and the outline again
on top. Hatch adjacent cut parts at opposite angles or a different spacing (6
against 9) so they read as separate pieces. `hatch(g, poly, angle, spacing)`
draws the hatching alone. `beyond(g, box, poly, inside)` draws what lies past
the cut through an even-odd clip that excludes the cut face, so it shows
round the section but not through it.

**Cutting plane.** `cuttingPlane(g, x, top, bottom, letter, dir)` draws the
dashed green cut line with thick 18-unit ends, 30-unit arrows in the viewing
direction and the section's letter at both ends. Run it 32 past the object at
each end. It is vertical; rotate the canvas for another angle.

**Dimensions.** `dimH(g, a, b, y, label)` and `dimV(g, a, b, x, label)` draw
linear dimensions: extension lines start 4 from the object and run 6 past the
dimension line, arrowheads 12 long and 3.2 half-wide, text 13 high and 11 off
the line; vertical text reads bottom to top. `dimAngle(g, c, r, a0, a1,
label, at)` dimensions an angle with an arc. `leader(g, tip, knee, label, o)`
points at a radius (`R30`), a diameter (`{ dia: true }`) or a note; `{ left:
true }` turns its shoulder left. `dimText` draws the degree and diameter signs
the stroke font lacks. Compute every value from the geometry it measures, and
stack parallel dimensions about 30 apart, the shortest nearest the object.

**Detail.** `detailCallout(g, c, r, letter)` circles a small region on a view
with a thin circle, a short leader and a letter. `detailView(g, c, r,
inside)` draws the same geometry enlarged, at 2:1 or 4:1, clipped to a circle,
with its own dimensions.

**Text.** `txt(g, str, x, y, size, layer, align, rot)` sets stroke-font text
centred on `y`. `viewLabel(g, title, scale, x, y)` puts a view's name under it
at 14 with its scale at 10 below. `notes(g, lines, x, y)` lists numbered notes
at 11, 22 apart.

**Sheet furniture.** These belong to a piece that is a whole drawing sheet,
and only then. `sheetFrame(g, x, y, w, h, { margin, cols, rows })` draws an
outer rule, a heavy inner border and zone ticks, numbered across and
lettered down, so a feature can be found by zone. `titleBlock(g, x, y, w, h,
rows, cols)` rules a title block; `titleCell(g, x, y, label, value, size, w)`
fills one cell with a 7-unit grey label and a value that shrinks to fit. The
title block names the drawing, its number, scale and units: use it when the
piece is presented as a document, leave it out when the drawing itself is
the subject.

## Creative direction

**Where it comes from.** Orthographic projection was set down as descriptive
geometry in the late eighteenth century and became the language of
engineering drawing. CAD packages moved it onto screens from the 1960s on;
the dark model space and colour-coded layers are the screen's habits, not
paper's.

**What it depicts.** Machine parts, buildings, assemblies, mechanisms:
things that are made to measure. It rarely shows living things,
weather, feelings or anything soft, so a drawing of something unmeasurable,
dimensioned with full seriousness, reads as wit or tenderness. Use that as
context, not a rule.

**Composition and framing.**
- Views line up. In third-angle projection the top view sits above the
  front view and the right side view to its right; first-angle swaps them.
  Aligned views let the eye project features across.
- The object sits in its view with generous empty field round it, for
  dimensions. Space between views is even.
- One view filling the frame reads as a study of one form; several aligned
  views read as a full description; a detail circle enlarging one feature
  directs the eye like a close-up.
- An isometric or exploded view is CAD's one pictorial view. Perspective in an
  orthographic view breaks its measure.
- Crop freely: a sheet, one view, a corner where three dimensions meet. The
  furniture is optional.

**Value, colour and light.** There is no light. Hierarchy comes from line
weight and layer colour: the object layer is the widest and brightest, hatch
grey recedes, dimensions sit in a cool cyan beside the white geometry. Keep
the colours flat and saturated; they are codes, not paint. The ground is one
dark tone with no gradient.

**Motion and time.** CAD moves like a machine rather than a hand.
- Lines appear as they are drafted: a line pulled from a point to a snap, a
  circle swept round its centre, dimensions placed after the geometry, text
  last. Or as a pen plotter draws them, in pen order and travel moves.
- Cameras orbit at a constant rate (a turntable), zoom to extents, or pan
  view to view. Moves are linear or gently eased, with holds at each view.
- Exploded views: parts slide apart along their axes, one at a time, then
  hold. Phantom lines can show the path a part travels.
- Kinematics: a linkage turns and its dimensions update live. A section plane
  sweeps through a model and the hatching follows the cut.
- Cuts are hard; transitions native to the medium are a zoom into a detail
  circle, or a layer switching on or off.
- What breaks it: wobble, squash and stretch, brushy or tapered lines, a
  dimension whose value does not change when the geometry does, motion blur.

**Drawing order.** Drafted on screen, at a plotter's even speed: construction
lines, outlines big to small, hidden and centre lines, sections, dimensions,
then labels ([draw the drawing](../reference/films.md#draw-the-drawing)).
Hidden edges go in after the outlines, though they layer under them. A `seg`
is a plain line, so it grows as a `seg` from `a` to a point moving toward
`b`, its dashes keeping their place from `a`; a `hatch` grows inside a swept
band ([grow a mark by length](../reference/films.md#draw-the-drawing)).

**Study.**
- Gaspard Monge, *Géométrie descriptive* (1799): for how orthographic views
  are derived from one object.
- Leonardo da Vinci's machine drawings in the Codex Atlanticus: for showing
  how a mechanism works by drawing its parts apart.
- Ivan Sutherland's Sketchpad (1963): for lines drawn live on a vector
  display, snapping and constrained.
- AutoCAD's model space and its indexed layer colours: for the dark ground
  and one colour per layer.
- Haynes workshop manuals: for exploded views and numbered callouts.
- ISO 128 and ASME Y14.5: for line types, weights and dimensioning rules.

**Levers.**
- Scope: one feature dimensioned in full reads as obsession; a full sheet of
  views reads as a complete account of a thing.
- Annotation density: a bare outline reads as form; dense dimensions and
  notes read as scrutiny.
- Hidden lines: none shows only the surface; many reveal an inside the
  viewer cannot see.
- Projection: orthographic views read as a specification; an isometric view
  reads as the object itself.
- Ground: black is the stark default; grey-blue or dark green feel like a
  particular package, warmer and older.
- Build order over time: drawing a form line by line, then measuring it,
  turns the act of describing into the subject.

## Palette

| Role | Colours |
| --- | --- |
| model grounds (`GROUNDS`) | `#212830` `#000000` `#163a24` `#2b2b2b` |
| object, frame | `#ffffff` |
| hidden, text | `#ffff00` |
| centre | `#ff0000` |
| phantom | `#ff00ff` |
| dimension | `#00ffff` |
| cutting plane | `#00ff00` |
| hatch, construction, label | `#808080` `#7d8996` `#b8c0c8` |

## Pitfalls

- `path()` starts a new path; build an even-odd clip from `g.rect` and
  `sub()`, as `beyond` does.
- Text that crosses geometry hides the edge under it; drafters move the
  cutting plane, leader or label into clear field.
- Values computed from the geometry stay true; typed numbers drift.
- Views that do not line up read as separate pictures, not one object.
- Fills, gradients or shading read as an illustration, not a drawing.
- Too many layers in one small area turn into noise; drafters set dimensions
  outside the outline where they fit.
