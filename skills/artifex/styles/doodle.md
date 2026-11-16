---
type: knowledge
summary: "How to draw doodle's marks with the functions in doodle.js, and how work in doodle is composed, lit, coloured and moved; read before making a piece in doodle."
related_files: ["skills/artifex/styles/doodle.js", "skills/artifex/styles/kit.js", "core/stroke-font.js"]
---

# Doodle

## Contents

- [What makes it read as a doodle](#what-makes-it-read-as-a-doodle)
- [Marks](#marks)
- [Creative direction](#creative-direction)
- [Palette](#palette)
- [Pitfalls](#pitfalls)

Ballpoint sketches made in a school notebook while the mind is elsewhere:
one pen, lines gone over twice, shading by hatching, bubble letters and a
highlighter swipe. It is the drawing everyone has done, quick and
unfinished on purpose.

## What makes it read as a doodle

- One ballpoint colour does almost everything: blue most often, or black or
  violet. A second pen, red, adds accents.
- Every line is drawn twice with independent wobble, as a hand goes over
  it: a firm pass and a looser, thinner one beside it.
- Shading is hatching rather than a fill: parallel wobbly strokes clipped to the
  shape, crossed at a second angle where it is darker.
- Paper shows everywhere. A shape that hides what is behind it is
  filled with the paper colour, not with ink.
- Lettering is hand-written, either thin words in the pen or fat bubble
  letters, hollow, with a drop to one side; a translucent highlighter swipe
  may sit under it.
- When the piece is a notebook page: ruled blue lines, a red margin line
  and punched holes, and the drawing ignores the rules.
- Thick bright marker fills on a dark page read as embroidery instead.

## Marks

Layer in this order: the page, then highlighter swipes, then bubble letters
and pen outlines, then hatching inside the outlines, then small words and
accents.

- `page(g, R, w, h, { paper, top, rule, margin, holeX, holes, specks })`:
  the paper, `#fbfaf4`, with blue rules (`rgba(120, 165, 220, 0.55)`, 1.6
  wide) every `rule` (34, or null for none) from `top` (118), a red margin line
  (`rgba(225, 120, 130, 0.8)`, 2.2 wide) at `margin` (112, or null for
  none), punched holes of radius 17 at `holeX` (52) and each y in `holes`,
  each with a small shadow, and 2500 grain specks per million square
  units. For plain sketch paper, pass `rule: null` and `margin: null`.
- `pen(g, R, name, pts, { close, ink, width, passes })`: a pen line in
  `passes` (2) passes, each wobbled on its own at a step of 7: the first at
  `width` (2.6) with amplitude 1.3, the second at 0.7 of the width with
  amplitude 2.2. Use 2.6 for outlines, 3 to 3.4 for a heavy stroke, 2 to
  2.2 with one pass for small doodles, rays and waves. A thick form, such
  as a branch or a limb, is a heavy pen stroke with a second, thinner
  single-pass stroke offset beside it.
- `hatch(g, R, name, region, { angle, spacing, ink, width })`: parallel
  lines across the region at `angle`, `spacing` (8) apart, each wobbled
  with amplitude 1.2 at a step of 14, 1.6 wide, clipped to the region.
  Spacing 7 to 10. Two calls at angles about 1.4 apart make a darker
  cross-hatch; one call on a side of a box or under a form gives it its
  shadow side. A clip to the outer outline first keeps the shade inside
  it.
- `highlight(g, R, name, pts, colour, width)`: a highlighter swipe, one
  round translucent stroke `width` (64) wide along `pts`, wobbled by 3 at a
  step of 30. Lay it before the ink it sits under. Colours in `MARKERS`.
- `bubble(g, text, x, y, size, { ink, paper, weight, inner, depth })`:
  bubble letters from the stroke font. The text is stroked `weight` wide
  (about 0.4 of the size) in ink, offset by `depth` (about a fifteenth of
  the size) for a drop, again in place, then hollowed with an `inner`
  stroke (0.8 of the weight) in the paper colour. At size 76: weight 30,
  inner 24, depth 5.
- `write(g, text, x, y, size, { ink, rot, mirror, width })`: words in the
  pen, 2.2 wide under size 24 and 2.4 above, turned by `rot` (a tilt of
  0.1 or so reads as written in a hurry). Set `mirror` when drawing inside
  a horizontally mirrored transform, so the words still read.
- `PAPER`, `BLUE`, `INKS`, `RED` and `MARKERS` hold the palette below.

To build a form: outline each part with `pen`, then hatch where it turns
away from the light. Fill a part that overlaps another with `PAPER` before
outlining it, so the lines behind it stop at its edge. Keep one hatching
`angle` for every shadow on the page, and ring round parts with
cross-contours that open with depth ([marks that model
form](../reference/stills.md#marks-that-model-form)). An eye is a solid
ink dot with a small paper-coloured glint; a blush is a small ellipse in
the red pen.

## Creative direction

**Where it comes from.** Margin drawings in school notebooks, on phone
pads and in meeting notes: made with whatever pen is at hand, without a
plan, to pass the time. Cartoonists and animators have used the same look
on purpose for its candour.

**What it tends to show.** Stock doodles a hand knows by heart: stars drawn
in one stroke, spirals, boxes in perspective, hearts, arrows, suns with
faces, clouds with rain, lightning, names in bubble letters, faces, and
whatever is in front of the drawer. Doodles are funny, private and a
little defiant. They rarely show careful observation, depth or atmosphere,
so a doodle that turns serious, or one that slowly becomes an exact
drawing, can surprise.

**Composition.** Doodles accrete: one drawing, then another in the space
left, until the page fills. They grow from the margins and around words,
at different sizes, with no shared ground or horizon. A doodle that crosses
a ruled line or the margin reads as made by a bored hand; one that fills a
page reads as an obsession. Viewpoints are flat: front, side or a box in
simple oblique perspective.

**Value, colour and light.** The page is the light. Value comes only from
how dense the hatching is and how often a line is gone over: one pass is
light, two passes and cross-hatching are dark. Colour is the pen's one
colour, a second pen for accents, and one highlighter. Light is a
convention, not a source: hatching sits on the side away from an imagined
light, and highlights are paper left bare.

**Motion and time.** The native motion is the flipbook in a notebook's
corner and the line animated on paper: drawn on twos or threes ([twos under a moving
camera](../reference/films.md#pace)), every drawing new, so lines boil. To get it, change the random names of `pen`
and `hatch` per drawing and hold them for two or three frames. Marks can
appear as they are drawn: a line growing along its path in a few frames,
hatching added stroke by stroke, a word written letter by letter. The
page, its rules and its holes stay still while the drawing moves; a camera
that moves pans over the page as a whole. Transitions native to the
medium: a page turned, a drawing scribbled out, a line that grows into the
next drawing, the page crumpled. What breaks it: tweened smooth motion
with fixed lines, hatching that slides inside a moving shape, filled
colour, and a line with one even pass.

**Drawing order.** Pen outlines and bubble letters first, each in its double
pass, then hatching inside them, then highlighter swipes, then small words and
accents ([draw the drawing](../reference/films.md#draw-the-drawing)). The
highlighter goes on after the pen, though it layers under it. Call `pen` and
`highlight` on the whole path every frame inside a clip to the grown band, so
the wobble stays put: `pen` with `passes: 1` for the first pass, then again
with both passes in a second band for the hand going over it, and `hatch`
inside a swept band
([grow a mark by length](../reference/films.md#draw-the-drawing)).

**Study.**

- Osvaldo Cavandoli's *La Linea*, for a single line that is both the
  character and the ground, and the animator's hand that draws in what it
  needs.
- Don Hertzfeldt's *Rejected* (2000), for pen-on-paper animation that
  boils, and a paper world that crumples and tears.
- Crockett Johnson's *Harold and the Purple Crayon*, for a line that
  invents the world as it goes.
- Saul Steinberg's drawings, for wit carried by a plain pen line.
- Jeff Kinney's *Diary of a Wimpy Kid*, for cartoons and handwriting on a
  ruled page read as one voice.

**Levers.**

- Passes: one pass reads as confident; two passes with loose wobble read as
  a hesitant, bored hand.
- Hatching density: one spacing-10 pass reads as a light shade; two
  crossing passes at 7 read as night or a hole.
- Accretion: one drawing on a bare page reads as a thought; a page filled
  to every edge reads as an obsession.
- Scale: doodles of one size read as a pattern; one large among many small
  reads as the thing on the drawer's mind.
- Ink: blue reads as school; black reads as an office pad; violet reads as
  a personal pen.
- Lettering: thin words read as notes to self; fat bubble letters over a
  highlighter read as a name being shown off.
- Boil: names changed every two frames read as a flipbook; held names read
  as a still page.

## Palette

| Role | Colours |
| --- | --- |
| page | `#fbfaf4`, holes `#dcd8cc` |
| rules | blue lines rgba(120, 165, 220, 0.55), margin rgba(225, 120, 130, 0.8) |
| pen, one per piece | blue rgba(31, 58, 147, 0.88), black rgba(30, 30, 38, 0.88), violet rgba(88, 44, 150, 0.88) |
| accent pen | red rgba(200, 45, 60, 0.85) |
| highlighter | yellow rgba(255, 232, 60, 0.55), pink rgba(255, 120, 185, 0.42), green rgba(110, 235, 130, 0.48) |

## Pitfalls

- Single, perfectly smooth lines look plotted, not drawn; the two wobbly
  passes are what reads as a hand.
- Dense marker fills turn the page into another style; paper showing through
  hatching keeps it a doodle.
- Hatching that is not clipped to its shape spills over the outline and
  reads as a mistake rather than a style; `hatch` clips to the shape it gets.
- Several pen colours at once read as a set of gel pens; a doodle is one pen
  and one accent.
- Mirrored text reads as a mistake; inside a mirrored transform, `write`
  with `mirror` keeps words readable.
- A highlighter laid over the ink dulls the ink; laid first, it sits under.
