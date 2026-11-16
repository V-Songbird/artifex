---
type: knowledge
summary: "How to draw flat sheets in front of a lit screen with the functions in backlit-silhouette.js (the screen, translucent gels that darken where they overlap, opaque cards that read as black), and how such pictures are composed, coloured and moved; read before making a piece that should read as a shadow play, a light-table cut-out or stained light."
related_files: ["skills/artifex/styles/backlit-silhouette.js", "skills/artifex/styles/kit.js"]
---

# Backlit silhouettes

## Contents

- [What makes it read as backlit](#what-makes-it-read-as-backlit)
- [Marks](#marks)
- [Creative direction](#creative-direction)
- [Palette](#palette)
- [Pitfalls](#pitfalls)

Flat sheets in front of a lit screen, seen from the far side of the light:
the picture of a shadow play, of cut-outs animated on a light table, of
tissue and gel held to a window. The light comes through the picture, not
onto it.

## What makes it read as backlit

- The brightest thing in the frame is the bare screen. Everything else is that light with something taken away.
- A translucent sheet tints the light and never hides it: the screen's falloff shows through every colour.
- Where two sheets overlap the overlap is darker than either, and its colour is the two colours multiplied.
- An opaque sheet is black, or near it, whatever its own colour would be. An opening cut in it is as bright as what is behind.
- No sheet casts a shadow and none shows an edge, a thickness or a texture of its own. A sheet is only its outline and what it does to the light.
- Edges are cut edges: firm, and soft only when the sheet is held off the screen.

## Marks

Order: `screen` first, then the sheets from the farthest to the nearest.
Gels multiply, so two gels give the same overlap in either order; a `card`
hides what was drawn before it and is tinted by any gel drawn after it.

- `screen(g, R, w, h, { light, lamp, reach, fall, fibre })`: the lit screen. `light` (`#f6d9a0`) is its colour at mid distance; in front of the `lamp`, a point `[x, y]` (the centre by default), it is 60% of the way to white, and at `reach` (by default the far corner) it has fallen to `fall` (0.45) of the light. `fibre` (3000 per million square units) lays faint specks, the cloth or paper of the screen, which also keep the falloff from banding.
- `gel(g, shape, colour, { density, lift })`: a translucent sheet. `shape` is one outline or a list of outlines filled even-odd, so an outline inside another is an opening. `colour` is a colour, or a canvas gradient for a sheet dyed unevenly. `density` (0.85) is how much of its colour one sheet holds: 0.3 to 0.5 for tissue and far layers, 0.7 to 0.9 for a strong gel. The same shape laid twice is that gel two sheets deep.
- `card(g, shape, { colour, lift })`: an opaque sheet, `#14100c` by default, a warm near-black. Openings in `shape` show the screen and the gels behind: slits, pierced patterns and eyes are cut this way, never painted on in a light colour.
- `lift`, on either sheet, holds it off the screen by that many design units. Its edge softens over about that distance, up to five pixels of the output, and its tone stays. It is the style's one cue for depth besides overlap.

Multiply needs pixels, so a piece in this style is raster: declare
`outputs: ['raster']`. Give sizes as shares of the frame, so a larger export
shows the same picture.

## Creative direction

**Where it comes from.** Shadow theatre, in which flat figures of oiled
hide or card are pressed to a cloth screen with a lamp behind; the
silhouette films cut from black card and animated on a glass table over a
light, with backgrounds built from layers of tissue; and stained glass and
paper lanterns, where colour is light that passed through something.

**What it shows.** Anything that reads by its outline: figures in profile,
plants, buildings, animals, lettering cut as openings. It rarely shows a
face from the front, a texture or a surface, because a sheet has no inside
to draw on; the inside of a form is told by openings cut in it. A subject
with no clear profile, carried by colour layers alone, is where the medium
surprises.

**Composition.** The picture is planned as a stack. Far things are pale
gels, few sheets deep; near things are denser gels or opaque cards; the
nearest are black. Depth comes from that order and from `lift`, never from
perspective lines or shading. Profiles are chosen so that limbs and parts
separate: two opaque shapes that overlap merge into one, so a gap of light
is left wherever two forms must read apart. The lamp is part of the
composition: the eye goes to the hot part of the screen, so the main
silhouette stands in front of it or beside it.

**Value, colour and light.** Count from the top down: bare screen, one
gel, two gels, three, black. Three or four steps are enough, and the gap
between black and the darkest gel should stay wide, so the cards read
first. Colour is subtractive: two gels give the colour of both multiplied,
so plan the overlaps as colours of their own. Warm screens with cool gels,
or the reverse, keep the layers apart. The vignette is the lamp's
falloff, not a filter laid on top: it is under the gels, so they dim with
it.

**Motion and time.** Cut-outs are moved by hand under a camera, a frame at
a time, so motion is held on twos or threes
([only the drawing holds](../reference/films.md#pace)) and a figure moves
as rigid parts turning about pinned joints: where two parts of one gel
overlap at a joint the overlap darkens, which shows the joint, and where
two cards overlap nothing shows. Parts slide, turn and swap for another
cut; they do not stretch. A sheet coming toward the screen sharpens, and
one drawn away softens and can leave that way. The lamp may breathe, drift
or dim, and a gel slid across the whole screen changes the hour. What
breaks it: soft shading inside a form, a shape that squashes like rubber,
a drop shadow, and motion blur.

**Drawing order.** Screen, far gels, near gels, cards, in the order the
sheets are stacked from the screen
([draw the drawing](../reference/films.md#draw-the-drawing)).

**Sound.** A small dark room: the cloth, a lamp's hum, sheets tapped on
glass, or music from one side.

**Study**

- Lotte Reiniger's *The Adventures of Prince Achmed* (1926), for black cut figures over layered translucent grounds and for depth from layers alone.
- Javanese wayang kulit and Chinese shadow theatre, for pierced figures, coloured translucent hide and what distance from the screen does to an edge.
- Michel Ocelot's *Princes et Princesses* (2000), for profiles posed so that every part reads, on grounds of a few glowing colours.
- Gothic stained glass seen from inside, for colour as transmitted light held by a black line.

**Levers**

- Share of black: mostly card reads as night and drama; mostly gel reads as glass and day.
- Density: thin gels read as tissue and air; dense ones as glass.
- Sheets deep: one or two reads graphic; five or six reads as deep space.
- Lamp: centred and wide reads calm; off to one side or low, with a short `reach`, reads as a single source and pulls the eye.
- Lift: everything on the screen reads as a cut-paper film; a far layer lifted reads as depth of field.
- Openings: none reads as a plain shape; many small ones read as lace.

## Palette

The screen and the gels are the palette, and the picture decides them;
none is the default. What holds for any set:

| Role | What it needs |
| --- | --- |
| screen | a light, warm or cool, well above mid value; it is every highlight |
| gels | two to four, each clear and mid to light alone, since every overlap is darker |
| overlaps | each pair multiplied should give a colour, not a mud; check them before drawing |
| cards | one near-black, a little toward the screen's hue |

Two gels of opposite hue multiply toward grey-brown; neighbours on the
colour wheel give a deeper colour of the same family.

## Pitfalls

- A gel painted in plain alpha over the screen goes milky and lightens what is behind it; light through a sheet only darkens, which is `multiply`.
- A drop shadow or a lit edge on a sheet turns the picture into paper lit from the front.
- A pure black card on a cool screen reads as a hole; a near-black leaning toward the screen's hue reads as card.
- A light detail painted on a card reads as paint. An opening shows the screen.
- A dark gel next to a card merges with it; keep the darkest gel well above the black.
- Two cards that overlap become one shape. Leave a sliver of light between parts that must read apart, or pose the profile so they do not cross.
- A vignette laid over the finished picture greys the blacks; the falloff belongs to the screen, under the sheets.
- A gradient inside a gel reads as airbrush unless it is slow and slight, as a dyed sheet is.
