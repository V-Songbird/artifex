---
type: knowledge
summary: "How to draw a print in separations with the functions in print-plate.js (a plate per ink, overprints, knockouts, dot screens and register), and how such prints are composed, coloured and moved; read before making a piece that should read as a risograph, a screen print or a halftone."
related_files: ["skills/artifex/styles/print-plate.js", "core/layer.js"]
---

# Print plates

## Contents

- [What makes it read as a print](#what-makes-it-read-as-a-print)
- [Marks](#marks)
- [Creative direction](#creative-direction)
- [Palette](#palette)
- [Pitfalls](#pitfalls)

A picture printed in separations: each ink laid from its own plate, one
over another, on paper. Risograph, screen print, letterpress colour and
newspaper halftone all work this way.

## What makes it read as a print

- Two to four inks and the paper. Every other colour is two inks printed over each other.
- White is paper left bare, never white ink.
- Tone is a screen of dots, each ink's at its own angle; a solid is a little thin, so paper shows through.
- Each ink sits a hair out of register, so a thin line of paper or of overprint runs along one side of a form.
- Flat shapes with firm edges. No gradient, glow or blur that a plate could not hold.

## Marks

A piece draws each ink's plate alone, then prints them. Order: `job`, a
`plate` per ink, `knockout` for the whites, `print`.

- `job(g, w, h, inks)` starts a print over the design box. `inks` is `[{ name, colour, offset, density }]` in printing order, lightest first as a press runs them. `offset` is `[dx, dy]` in design units; `density` is how much of a solid's ink lands, default 0.92.
- `register(R, name, i, reach)` gives ink `i` a seeded offset of up to `reach` design units. A reach of two to four pixels of the film, about 1/400 of the frame's shorter side, reads as print; more reads as a misprint, which is a look of its own.
- `plate(J, name, draw)` draws on one ink's plate. `draw(p)` paints with the fill and stroke it is given, already the ink's colour: every shape of the picture that this ink takes part in, including the areas where it only lies under another. An alpha below 1 prints thinner ink.
- `knockout(J, shape, grow)` cuts a white: `shape(p)` builds a path and it is erased from every plate, grown past the furthest offset so no plate prints a sliver inside it. Highlights, lettering reversed out of a solid, and a paper gap between two forms are knockouts.
- `screen(p, R, name, tone, box, { pitch, angle, voids })` turns tone into dots inside a plate's `draw`: `tone(x, y)` from 0 to 1, a lattice `pitch` units apart at `angle` degrees. `ANGLES`, 15, 75, 45 and 0, keeps up to four screens from beating into a coarse pattern. A pitch near 1/160 of the shorter side reads as a magazine; 1/60 reads as a poster or a newspaper seen close. `voids` drops a dot now and then; each ink takes its own `name`, since two plates that lose the same dot leave a white pinhole.
- `print(J, paper)` lays the paper colour, then each plate multiplied over the last at its offset.

Give every measure as a share of the frame's shorter side, so a larger
export prints the same picture. On an SVG the plates draw straight on the
surface in order and each knockout is paper laid on top; the dots and the
overprints hold, the register of a knockout does not.

## Creative direction

**Where it comes from.** Colour printing before process colour was cheap:
posters, comics, packaging, zines and textbooks printed in two or three spot
inks because each ink cost a run through the press. The stencil duplicator
and the screen-print studio kept the look alive, and its limits became its
character.

**What it shows.** Anything that reads as flat shapes: figures, objects,
lettering, maps, diagrams. It rarely shows deep atmosphere or soft skin,
because a plate holds an edge better than a haze; a soft subject carried by
a coarse screen is where the medium surprises.

**Composition.** The inks are planned before the picture. Decide what each
plate carries: often one ink for the main mass, one for shadow and line,
one for an accent, with the overlap of the first two as the darkest tone.
Large flat areas and bare paper give the eye rest; the overprint is used
where the picture needs weight. A shape that exists only as an overprint,
with neither ink's own edge showing, reads as a third colour and is the
medium's best trick.

**Value, colour and light.** Count the tones before drawing: paper, each
ink, each pair overprinted, all together. With two inks that is four
tones; with three, eight. Light is paper, so the lit side of a form is
left bare or screened thin, and shadow is a second ink over the first.
A screen's tone steps from flat to flat: three or four levels of dot read
better than a smooth ramp.

**Motion and time.** A print holds still, so a film in this style moves as
a stack of printed sheets does: drawings held for several frames
([only the drawing holds](../reference/films.md#pace)), with the register
and the voids of each drawing reseeded so the plates jitter from sheet to
sheet. The screen stays fixed to the sheet, not to the moving form: dots
that travel with a form read as a texture on it. A form may change plate
to change colour, and a transition native to the medium is one plate
arriving before the others.

**Drawing order.** Lightest ink first, darkest last, as a press runs
them, each plate complete before the next
([draw the drawing](../reference/films.md#draw-the-drawing)).

**Sound.** The press itself: a drum turning, paper feeding, a squeegee
pull; or nothing, as a poster on a wall.

**Study**

- Two- and three-colour children's books of the 1950s and 1960s, for pictures planned as overprints.
- Polish and Cuban film posters of the 1960s, for flat shapes, bare paper and one loud ink.
- Newspaper comics seen close, for dot screens at angles and their register.
- Contemporary stencil-duplicator zines, for bright inks, thin solids and visible misregister.

**Levers**

- Inks: two read graphic and cheap; four read rich and near full colour.
- Screen pitch: fine reads as tone; coarse reads as dots, a pattern in its own right.
- Register: tight reads careful and commercial; loose reads handmade.
- Density: thin, uneven solids read as stencil ink; full ones as screen print.
- Share of bare paper: much reads airy and modern; little reads heavy.

## Palette

The inks are the palette, and the picture decides them; none is the
default. What holds for any set:

| Role | What it needs |
| --- | --- |
| paper | off-white or a pale tint; it is the lightest tone and every white |
| inks | two to four, each clean and strong alone, spread in lightness so their order is plain |
| overprints | check each pair multiplied before drawing: two mid inks should give a dark that reads as a colour, not as mud |

Inks close in lightness give overprints that separate by hue only and
read weakly in a film; one light, one mid and one dark ink give the most
tones.

## Pitfalls

- A colour mixed on the palette and painted in is not a print; a colour reached by two plates overlapping is.
- White painted over ink reads as paint. A knockout is paper.
- A knockout no wider than the register offset fills with a sliver of the shifted plate; `knockout` grows it for that reason, and a hand-made one needs the same margin.
- The same angle on two screens makes the dots land on each other or beat into blotches; each ink takes its own angle.
- One void pattern for every plate punches white pinholes through the whole print.
- A canvas gradient on a plate prints as a smooth ramp no press makes; `screen` gives the tone.
- Offsets in pixels change with the export size; offsets as a share of the frame do not.
