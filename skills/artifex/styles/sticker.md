---
type: knowledge
summary: "How to draw sticker's marks with the functions in sticker.js, and how work in sticker is composed, lit, coloured and moved; read before making a piece in sticker."
related_files: ["skills/artifex/styles/sticker.js", "skills/artifex/styles/kit.js", "core/stroke-font.js"]
---

# Sticker

## Contents

- [What makes it read as a sticker](#what-makes-it-read-as-a-sticker)
- [Marks](#marks)
- [Creative direction](#creative-direction)
- [Palette](#palette)
- [Pitfalls](#pitfalls)

Die-cut vinyl stickers: flat, glossy art printed on white vinyl and cut
around its own outline, lying on a surface or stuck to one. Each sticker is
a thin object with an edge, a shadow and a shine.

## What makes it read as a sticker

- A white vinyl border, 16 to 26 units wide, that follows the art's own
  outline, round at every corner.
- One soft shadow under each whole sticker, offset down, and a faint rim at
  the border's edge, so the sticker lies a little above the surface.
- Bold dark outlines around the art's outer edge, flat fills, a cel shade
  in a darker tone of the fill, and a white gloss streak.
- Characters, when the piece has them, have dark oval eyes with two white
  highlights, one large and one small, and a pink blush.
- A sticker can peel: its corner folds back along a straight line to show
  pale backing.

## Marks

Layer each sticker in this order: the die-cut, then the art's outline and
fills, then shades and gloss inside a clip to each part, then the part's
outline again, then eyes, blush and lettering. Draw stickers one after
another; a later one lies over an earlier one.

- `mat(g, R, w, h, { colour, cell, major, tick })`: a self-healing cutting
  mat, a surface to lay stickers on: `#e8e3f4`, grid lines every `cell`
  (50) at `rgba(95, 80, 150, 0.14)`, heavier lines every `major` (250) at
  0.26, ruler ticks every `tick` (10) along the top, and light grain. Any
  surface works: a flat colour, a texture or another drawing.
- `dieCut(g, parts, border, { cast, blur, dx, dy, rim, vinyl })`: the white
  vinyl. One stroke of the union of all `parts`, `border` wide on each side
  (2 x border in all), casts the one shadow: `rgba(52, 36, 92, 0.30)`,
  blur 22, offset (5, 12). Then a rim at 2 x border + 3 in
  `rgba(60, 40, 110, 0.13)`, the white border again, and every part filled
  white. Border 16 for a small sticker, 26 for a large one. Pass every part
  of one sticker in one call, so its border is one outline.
- `inked(g, parts, fill, width, line)`: flat art with a bold outline. Every
  part is stroked at 2 x `width` (6) in `LINE`, then every part filled, so
  only the group's outer edge keeps its line. Width 3.5 to 7.
- `gloss(g, a, c, b, width, colour)`: the gloss streak, one curved white
  stroke from `a` through control point `c` to `b`, 10 wide at alpha 0.85.
  Drawn inside a clip to the part, on the upper side of a round form,
  before the part's outline, it stays on the vinyl.
- `eye(g, x, y, s, line)`: a sticker eye for a character of size `s`: a dark
  oval 0.068 s by 0.085 s with white highlights of radius 0.028 s and
  0.013 s, the large one up and to the side, the small one opposite.
- `lettering(g, text, cx, cy, size, width, colour)`: bold stroke-font
  lettering centred on a point. Width 7 to 8 at size 40 to 44, so it holds
  against the vinyl. Dark on a light fill, white on a dark one.
- `peel(g, { outer, a, b, keep, w, h }, art)`: a sticker peeling along the
  fold from `a` to `b`. `art()` draws the whole sticker (die-cut and art);
  only the side of the fold holding the point `keep` stays. The flap is the
  sticker's `outer` border beyond the fold, mirrored over it and filled
  with a gradient from `#f6f3fb` to `#cfc7e2` under a small shadow
  (`rgba(40, 30, 70, 0.35)`, blur 12, offset (-4, 6)). Put the fold across
  one corner, about a third of the way along each side.
- `roundRect(x, y, w, h, r)`, `cutBy(poly, a, b, sign)` and
  `mirror(p, a, b)`: a rounded rectangle as points (a label, a bubble), the
  part of a polygon on one side of a line, and a point mirrored across a
  line, for shapes and folds of your own.
- `LINE` is the outline colour, `#2b2340`.

To build a form: draw the art's parts as polygons. Inside a clip to the
main part, fill a pale patch where it faces the light, a darker ellipse at
alpha 0.35 on its shadow side as the cel shade, a narrow white band at alpha
0.13 across it as a second gloss, then `gloss`. Outline each part at 7 in
`LINE` after its shading. A blush is a pink ellipse about 0.085 by 0.055 of
the character's size, under the eye.

## Creative direction

**Where it comes from.** Printed vinyl stickers: kawaii stationery, brand
and band stickers, stickers on laptops, bottles and lamp posts. The art is
made for print: flat colour, a heavy outline, a shine that says plastic.

**What it tends to show.** Characters with faces, food, animals, plants,
stars, hearts, speech bubbles, words and logos: single, closed shapes that
can be cut out. Stickers say who owns the thing they are on. They rarely
show landscapes, crowds or anything without an outline, so a sticker of a
storm or of a quiet room can surprise.

**Composition.** Each sticker is a closed shape with white around it.
Stickers are laid on a surface or stuck on top of each other, slightly
turned, so a sheet of them reads as collected rather than designed. One
large sticker among small ones reads as the favourite; stickers packed
edge to edge and overlapping read as a laptop lid or a bomb on a sign.
The view is flat, straight down onto the surface.

**Value, colour and light.** The art is bright, saturated and flat, with
one cel shade per part in a darker tone of its fill, not black. The
outline is a dark violet, not pure black. The white border is the
brightest thing in the frame after the gloss. Light comes from the upper
side: the gloss sits there and the shadow falls down and away.

**Motion and time.** Stickers move as flat, rigid objects: stop-motion or
cut-out animation, often at 12 frames a second, its moves stepping from
place to place on each hold while the camera stays smooth ([stop-motion
under a moving camera](../reference/films.md#pace)); a camera locked onto a
stepping sticker makes each step jump back and forth on screen, so a fixed, panning or drifting one frames it. A sticker is slapped down
(it appears with its shadow already short) or peeled up, its corner
lifting first and the flap growing along the fold. As a sticker lifts, its
shadow grows softer and further from it; laid flat, the shadow is short.
The peel (corner lift, flap and shadow) and the slap-down step on the hold
like any other move, because a hand moves the vinyl between shots; a peel
on ones reads as a smooth tween and breaks the look.
Art inside a sticker can change between drawings, as a new sticker over
the old. Native transitions are a sticker peeled away to show what is
under it, a new sticker slapped over the frame, and a whole sheet peeled
off its backing. What breaks it: squash and stretch of the vinyl, which
does not bend except along a fold; a shadow that stays fixed while the
sticker moves; and a border that changes width.

**Drawing order.** Made on screen: the art first, line then fills, shades and
gloss, then the die-cut border round it, with the shadow and any peel last
([draw the drawing](../reference/films.md#draw-the-drawing)). The border is
cut after the art, though it layers under it. An `inked` part's line is a
plain stroke, so grow it first as a round-joined (`lineJoin` `'round'`)
`LINE` stroke twice `width` wide along
`grow(part, d, true).points`, kept under the part, then call `inked` whole
inside a band swept across the part to lay the fill
([grow a mark by length](../reference/films.md#draw-the-drawing)).

**Study.**

- Takashi Murakami's smiling flowers, for flat colour, a heavy outline and
  a cute face repeated across a surface.
- Shepard Fairey's OBEY Giant sticker campaign, for a sticker as a mark
  left on the street, repeated and layered.
- Sanrio's characters, for how few marks a round character needs to read.
- *Paper Mario: Sticker Star* (2012), for stickers peeled from a world and
  slapped down again as motion.

**Levers.**

- Border: 16 reads as a small decal; 26 or more reads as a chunky, cheap
  sticker.
- Shadow: short and soft reads as stuck down; long and blurred reads as
  lifted or loose.
- Overlap: stickers apart read as a collection; stickers overlapping read
  as years of use.
- Gloss: a strong streak reads as glossy vinyl; none reads as matte paper.
- Turn: stickers at small random angles read as placed by hand; aligned
  ones read as a printed sheet.
- Outline: a heavy outline reads as cute and loud; a thin one reads as
  quieter, more like a label.
- Peel: one sticker peeling reads as a moment in time; none reads as a
  still arrangement.

## Palette

| Role | Colours |
| --- | --- |
| vinyl, outline | `#ffffff`, `#2b2340` |
| surface | mat `#e8e3f4`, grid rgba(95, 80, 150, 0.14) and 0.26 |
| warm art | sun `#ffcf5c`, cream `#fff0bf`, coral `#ff7a59`, orange `#ff9f1c`, yellow `#ffd23f`, pink `#ff6b8b` |
| cool art | teal `#2ec4b6`, sky `#8fdcf0` |
| shades | warm rgba(232, 140, 40, 0.35), coral rgba(200, 70, 40, 0.35) |
| blush, gloss | rgba(255, 143, 163, 0.9), white at 0.85 and 0.13 |
| shadow, backing | rgba(52, 36, 92, 0.30), `#f6f3fb` to `#cfc7e2` |

## Pitfalls

- Two shadowed draws, such as a fill and a stroke, darken where they
  overlap; `dieCut` casts each sticker's shadow from one stroke of the
  union.
- A stroke is not a fill: large parts that are not also filled white show
  the surface through the border.
- Thin text vanishes against the border; stroke widths of 7 to 8 at size 40
  hold.
- A gloss streak drawn after the outline, or outside a clip, runs off the
  vinyl onto the surface.
- Parts of one sticker passed to separate `dieCut` calls each get a border
  and a shadow, and the sticker reads as several.
- A cel shade in black or grey reads as dirt; a darker tone of the fill reads as shade.
