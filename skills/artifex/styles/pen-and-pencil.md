---
type: knowledge
summary: "How to draw pen and pencil's marks with the functions in pen-and-pencil.js, and how work in pen and pencil is composed, lit, coloured and moved; read before making a piece in pen and pencil."
related_files: ["skills/artifex/styles/pen-and-pencil.js", "skills/artifex/styles/kit.js", "core/stroke-font.js"]
---

# Pen and pencil

## Contents

- [What makes it read as pen and pencil](#what-makes-it-read-as-pen-and-pencil)
- [Marks](#marks)
- [Creative direction](#creative-direction)
- [Palette](#palette)
- [Pitfalls](#pitfalls)

A sepia ballpoint and a tin of coloured pencils on a sheet of cream paper
that was folded and smoothed out again. It is the drawing of a sketchbook, a
letter or a children's picture book: a light pen line that carries the form,
pencil colour laid under it in strokes, and lettering in the same pen.

## What makes it read as pen and pencil

- The pen line is light and changes weight along its length: it swells
  where the hand pressed and fades where it eased, between a third and all
  of its full width, a little heavier at each corner and thin where it
  started. Where the ball ran fast it skips for a few units, tapering into
  and out of the gap. Ink pools into a dot only where the ball was set down,
  paused at a sharp corner or, now and then, lifted. A line of one width
  reads as a plotter; a heavy line with a dot at every skip reads as felt-tip.
- Colour is coloured pencil: parallel strokes that overshoot the outline a
  little, broken by the paper's tooth so flecks of bare paper show through
  every fill. Fills stay uneven and below full strength. A looser hand
  scribbles instead: one wide zigzag across the form that leaves most of
  it bare.
- The paper is cream, mottled, and creased: each fold is a soft shadow on
  one side, a soft light on the other, and a thin dark line.
- Characters, when the piece has them, are round, with two big dark eyes
  with a glint, a pink blush under each and a small mouth; some sleep, with
  closed eyes.
- Lettering is the same pen, one letter at a time, each a little off the
  line and turned.
- Everything is drawn in code; no image is pasted in.

## Marks

Layer in this order: the paper, then pencil fills, then soft shades, then
the pen outline over them, then faces and details, then lettering. A pencil
fill does not hide what is under it, so a shape that sits over another is
filled with `PAPER` first.

- `paper(g, R, w, h, { colour, folds })`: the sheet. Seventy soft radial
  patches per million square units, white or `rgb(90, 70, 40)` at alpha
  0.05, radius 60 to 240, mottle it. With `folds` (true) a vertical fold
  between 30% and 70% of the width and a horizontal one between 32% and 68%
  of the height split it; the left part is darkened by 0.025 and the lower
  part lightened by 0.05; a diagonal fold and two short creases add to them.
  Last comes the tooth's grain: 6000 specks per million square units, white
  at 0.3 and `rgb(90, 70, 40)` at 0.05.
- `crease(g, R, name, a, b)`: one fold, wobbled by 5 at a step of 60. Eight
  strokes 40 down to 5 wide, each shifted further from the line, build the
  shadow (`rgb(60, 40, 20)` at alpha 0.009) on one side and the light
  (white at 0.022) on the other; then the line itself, 1.2 wide at 0.07.
- `tooth(R, x, y)`: the paper's tooth, a value-noise field at a lattice of
  2.3 units. Every pencil stroke reads it, so all strokes break on the same
  peaks. Read it too for any mark of your own that should catch on the paper.
- `pen(g, R, name, pts, { ink, w, close, tone, skip, wob })`: one ballpoint
  line. `w` (2) is the width at full pressure: 2.2 to 2.4 for a main
  outline, 2 to 2.2 for most others, 1.1 to 1.8 for details such as veins,
  barbs and hairs. `tone` (0.78) is the ink's strength; 0.55 to 0.65 for a
  line that sits back. `skip` (0.1) is the share of the line the ball leaves
  bare: 0 for a short sure stroke, 0.3 for steam or a faint line, about 0.6
  for a dotted path of something that moved. `wob` (1.1) is the hand's
  wobble. `ink` is `brown`, `blue`, `red` or an rgb triple. Each run of ink
  is one filled `outline`, never a stroked polyline, so it has no beads at
  joints and keeps its width round a sharp turn.
- `dot(g, x, y, r, ink, tone)`: a dot of ink, for a pupil, a spot or a full
  stop.
- `pencil(g, R, name, region, colour, { angle, spacing, w, tone, over,
  cross, within })`: a coloured-pencil fill. Strokes at `angle` (-0.95),
  `spacing` 3.3 apart (varied by a fifth), `w` 2.1 wide, overshooting each
  end by up to `over` (5). Each stroke is 2-unit pieces jittered by 1.4, at
  `tone` times a pressure of 0.7 to 1.3, and left out where the tooth is
  under 0.3. `tone` 0.3 to 0.5 for most fills, up to 0.6 at most. `cross`
  adds a second pass turned 0.55 at 0.6 of the tone, for a darker or
  rougher surface. `within` keeps the strokes inside a second outline, for
  a patch of colour kept inside a body. A turned angle between neighbouring
  shapes makes each read as its own fill.
- `drag(g, R, name, pts, colour, { width, tone, dry, count })`: one pencil
  stroke along an open path, `width` (4) wide, its lead's grain drawn as
  `count` (1.5 per unit of width) fine lines from `bristles` in
  [`kit.js`](kit.js). The lines break where the paper's `tooth` takes no
  pigment, each at its own places, more toward the stroke's edges and its
  lift. `dry` (0.6) sets how much breaks: 0.25 lays a nearly solid band,
  0.6 a grainy stroke that thins out toward its end, 1 a lead that gives
  out before the end. `tone` (0.5) is the strength, under 0.6 as for a
  fill. Use it where one stroke should show, rather than a fill: a quick
  shading stroke, a stem, a rough edge, a mark laid with charcoal or a
  soft lead. A wide `drag` with a low `dry` reads as fine parallel
  striations; a higher `dry` breaks them up.
- `scribble(g, R, name, region, colour, { angle, gap, width, tone, over })`:
  a loose scribble fill, for colour put down fast: one zigzag that leaves
  half of the area or more bare. The line travels along `angle`, by default
  the region's long axis, and swings across it, a swing every `gap` (24,
  from half of it to half as much again). Each turn lands within `over` (6)
  of the outline, more often past it than short, and one in four stops up
  to a third of the way in, so the scribble takes the form's shape without
  tracing it. Where the form narrows to nothing or parts in two the hand
  lifts, and each part gets a line of its own. The line is `width` (13)
  wide and laid as the pencil fill's own 2-unit pieces side by side, so its
  grain is the same `tooth`: full down the middle and under a pressing
  hand, bare on more peaks toward the edges and where the hand eased.
  `tone` (0.5) is the strength of one piece; the pieces overlap, so the
  line is denser than a `pencil` fill of that tone. A `width` near half of
  `gap` keeps half the area bare. A form that bends takes one scribble per
  straight part, each with its own `angle` along that part.
- `shade(g, R, name, region, colour, tone)`: the pencil on its side, with no
  outline: spacing 2.6, width 3, `tone` 0.2 to 0.5. Use it for a blush, a
  highlight in a lighter colour, or a shadow in a darker one, inside a
  shape.
- `face(g, R, name, x, y, s, mood, gap, mouth)`: a character's face at size
  `s`: dark eyes 0.085 s by 0.105 s, `gap` s apart (0.3 to 0.4), each with a
  white glint; a pink `shade` blush under each. `mood` is `happy` (a smile),
  `sleep` (closed arcs), `oh` (a small ring), `cat` (a zigzag) or anything
  else for a flat line. Pass `mouth` false for a face with a beak or a
  muzzle of its own.
- `letter(g, R, name, text, x, y, size, inks, w)`: hand lettering from the
  stroke font. Each character's strokes go through `pen` at `w` (2.2),
  wobble 0.8 and skip 0.06, turned by up to 0.08 radians and set up to a
  twentieth of the size off the line. `inks` alternates per letter: one ink
  for a note, two for a title. Returns the x where the text ends.
- `PAPER`, `INK` and `PENCIL` hold the palette below; `rgba(rgb, a)` turns
  an ink into a CSS colour.

To build a form: a main shape gets a pencil fill in its colour, a shade of a
darker or neighbouring colour kept `within` it, and the pen outline over
both at 2.2 to 2.4. A thin part such as a limb, a stalk or a branch is an
[`outline`](../reference/geometry-fields.md#variable-width-strokes) that
thins toward its tip, filled in pencil at
a low tone and outlined, with a few short pen strokes along it for texture.
A turned fill angle parts shapes. `shade` picks its own angle per name,
between -0.6 and -0.2, so shadows that share one angle use `pencil`
with one explicit `angle` across the sheet, set from the side the shade
falls on, since the style has no cast light. Put texture strokes at the outline and
in a few patches ([marks that model
form](../reference/stills.md#marks-that-model-form)).
Marks under about 15 units across, such as a small ring or zigzag, are too
small for `pen`'s wobble step; stroke them plain at 1.8 wide in the ink, as
`face` does for its small mouths.

## Creative direction

**Where it comes from.** The ballpoint and the coloured pencil are the
everyday tools of school, letters and sketchbooks, and of picture books
drawn in line and crayon. The style borrows their informality: nothing is
ruled, and every mark shows the hand.

**What it shows.** Small, warm, near things: characters, pets, food, plants,
objects on a table, a day out, often with a word or two. The tools suit a
personal register, a note to someone. It rarely shows the grand or the
violent, the night, or large spaces, so a vast landscape or a dark subject
in light ballpoint and pastel pencil can surprise.

**Composition.** A sketchbook page is often a scatter: one main drawing and
smaller ones around it, each with paper around it, none crossing another.
A single drawing with a lot of bare paper reads as a study. Drawings sit on
the paper with no frame or horizon; a ground line, if any, is a short pen
stroke under the subject. Viewpoints are frontal or side-on, with little
perspective. Words share the page with pictures, at the size of a hand.

**Value, colour and light.** The paper is the light: there are no white
highlights except a glint in an eye. Values stay high; the darkest mark is
the pen, and pencil tones stay under about 0.6, so shadows are a second
pencil colour or a cross-hatch, not black. Colour is local and pastel:
each shape takes one pencil, with a neighbouring colour for its shade.
There is no cast light; form comes from the outline and the shade's
direction.

**Motion and time.** Hand-drawn animation in pencil is drawn on twos or
threes (12 or 8 drawings a second; [twos under a moving
camera](../reference/films.md#pace)) and every drawing is new, so lines and
pencil strokes shimmer, or boil, from drawing to drawing. To get it, change
the random names of `pen` and `pencil` per drawing (for example with the
drawing's index) and hold them for two or three frames; a held pose keeps
its names and goes still. Marks can appear as they are drawn: a line
growing along its path, a fill hatched in stroke by stroke, letters written
one at a time. The paper and its creases stay fixed while drawings move or
are redrawn; the camera, if it moves, slides over the sheet as one. Natural
transitions are a new sheet laid over the old, a page turned, a drawing
rubbed out, a crease folding the sheet away. What breaks it: smooth motion
at the full frame rate with lines that stay the same, pencil strokes that
slide inside a moving outline instead of moving with it or being redrawn,
paper grain that moves with a character, and fills that turn solid.

**Drawing order.** Light pencil placement first, then the pen line, big forms
before small, then pencil fills hatched in, soft shades, faces and details,
with lettering last ([draw the drawing](../reference/films.md#draw-the-drawing)).
The fills are hatched after the pen line, though they layer under it. To show
a line being drawn, call `pen` or `drag` on its whole path every frame inside
a clip to the grown band, and `pencil` or `shade` inside the band of a
hatching sweep ([grow a mark by length](../reference/films.md#draw-the-drawing)),
so each mark keeps its pressure, skips and tooth.

**Study.**

- Frédéric Back's *The Man Who Planted Trees* (1987), for coloured pencil
  in motion: strokes redrawn on every drawing, and scenes that dissolve
  into one another through the strokes.
- *The Snowman* (1982), the animated film of Raymond Briggs's book, for
  pencil and crayon texture kept through animation, and for a story told
  without words.
- Bill Plympton's films, for a pencil line that boils on every drawing and
  for transformations drawn rather than cut.
- Quentin Blake's illustrations, for a quick, scratchy line that carries a
  character's whole attitude in a few strokes.
- Jean-Jacques Sempé's drawings, for small figures in a lot of bare paper.
- Il Lee's ballpoint drawings, for how dense and dark a ballpoint alone can
  build when it is laid stroke over stroke.

**Levers.**

- Line weight: `w` near 1.5 everywhere reads as a quick note; 2.4 outlines
  with 1.2 details read as a finished drawing.
- Skip: 0 reads as a careful hand; 0.2 and above reads as hurried or old
  ink.
- Pencil tone: 0.2 reads as a faint wash of colour; 0.5 with `cross` reads
  as worked and saturated.
- Fill: `pencil` reads as careful hatching, every stroke parallel and the
  area covered; `scribble` reads as colour put down in a hurry or by a
  small hand, with more paper than colour inside the outline. One sheet
  can hold both: hatching where the eye should rest, scribble for what is
  only noted.
- Density: one drawing in a bare sheet reads as a study; a page filled edge
  to edge with small drawings reads as a diary.
- Paper: folds and creases read as a letter that was carried; a flat sheet
  reads as a sketchbook page.
- Ink: brown reads as warm and old; blue reads as school and everyday; two
  inks per letter read as play.
- Boil: names changed every two frames read as hand-drawn animation; held
  names read as a still drawing that moves.

## Palette

| Role | Colours |
| --- | --- |
| paper | `#ece6d9` |
| inks | brown `rgb(70, 46, 30)`, blue `rgb(40, 58, 150)`, red `rgb(186, 46, 50)` |
| warm pencils | red `#d8504a`, orange `#ea9552`, yellow `#e9c23c`, pink `#e89aae`, brown `#9c6c46`, cream `#f2d9a0` |
| cool pencils | green `#5c9a48`, blue `#4f73c8`, sky `#7fa6d8`, lilac `#8f7fc6`, grey `#8d8880` |
| blush | pink `#e89aae` at tone 0.5 |

Most drawing is the brown ink. Blue suits words and small marks beside it,
red a heart or an accent. A shape's shade is a neighbouring pencil: yellow
over orange, sky over blue, a darker neighbour on the underside of a body.

## Pitfalls

- A stroked polyline with round caps and varying width shows a dark bead at
  every joint where the caps overlap; one filled `outline` per run, as `pen`
  draws it, has none, and `ribbon` thins the line at each turn.
- A disc painted over each run's end to round it darkens the end, because
  the ink is laid twice there, and the line reads as felt-tip with a dot at
  every skip. A width tapered into the skip reads as ballpoint, with pools
  only at the set-down, sharp corners and the lift.
- A pencil shade laid on a body as a plain ellipse spills past the outline
  where the body curves in; the outline passed as `within` holds it.
- Hatching clipped to the outline reads as a printed fill; strokes that
  overshoot, with the tooth's peaks bare, read as drawn.
- A scribble at one fixed angle for every shape reads as a pattern laid
  over the drawing; a zigzag that travels along each form and turns at its
  outline reads as that form coloured in.
- A wide scribble line broken into a few strands by a coarse test of the
  tooth comes out in blocks, like pixels; many fine pieces side by side,
  each tested against the tooth, give grain.
- Creases drawn as sharp white ridges read as embossed plastic; a light band
  under a fifth of alpha in total where its strokes overlap, a shadow under a
  tenth and a faint line read as a fold.
- Pencil tones above about 0.6 turn into marker; with paper showing through
  every fill, it stays pencil.
- A face with a beak or a muzzle and a smile has two mouths; `mouth = false`
  leaves one.
- A mark under about 15 units through `pen` comes out as two or three
  points after the wobble's step of 5: a ring becomes a dash, a zigzag a
  flat line. A plain stroke keeps such a mark.
- Lines two units wide drawn at a sixth of the size fade to a pale wash; pen
  and pencil at one device pixel or more hold their tone, and both functions
  read the surface's transform for this.
- Lettering with every letter upright on one baseline reads as a stencil;
  `letter` turns and lifts each one.
- A pencil fill does not hide what is under it, so a shape that sits on
  another is filled with the paper colour first.
- Things scattered over one sheet that cross read as a tangle. A disc of room
  for each, skipping a place that is taken, keeps them apart; a thing that
  reaches past its body, such as a trail or a line of words, needs room for
  each part it reaches with.
