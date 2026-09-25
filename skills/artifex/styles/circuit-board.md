---
type: knowledge
summary: "How to draw the circuit-board style: a green printed circuit board from above, with 45-degree copper under the mask, gold pads, white silkscreen and parts, and the subject as copper art; read before making or adapting a circuit-board piece."
related_files: ["skills/artifex/styles/circuit-board.js", "skills/artifex/styles/kit.js"]
---

# Circuit board

A green printed circuit board seen from above, the subject laid out on it as
copper art and wired into the parts round it. Gallery `style` 10.

## What makes it read as a circuit board

- Every run of copper is horizontal, vertical or at 45 degrees. A curve reads
  as a drawing of a board, not a board.
- Two greens: copper under the solder mask is lighter than bare laminate under
  it, and each copper edge has a light crest and a dark trough where the mask
  thins and pools.
- Only openings in the mask show metal: pads, the subject's art, plated holes.
  They are gold, lit from one corner, each with a thin rim of bare laminate.
- A ground pour fills the empty board, kept clear of every trace by a gap of
  bare mask, and stitched with small vias.
- White silkscreen names parts (`U1`, `C1`, `J1`) and outlines them.
- Real parts sit on their pads and cast short shadows: a gull-wing chip, chip
  resistors, a crystal can, an electrolytic, a header, lamps.

## Recipe

1. Bench `#16191d`; the board a rounded rectangle, radius 30, under a shadow
   of blur 30; its routed edge `#c9c08c` 3 units wide; inside it the mask
   `#0d4a29`.
2. `route(waypoints)` joins each pair of points by one straight run and one
   45-degree run. `bus(route, n, pitch)` offsets one route into `n` parallel
   traces with `offsetPolyline`, so their corners stay parallel. Traces are 7
   wide, power 14 to 20, rounded caps and joins.
3. `copper(draw)` draws each copper feature three times: trough `#06301a`
   offset (1.6, 1.8), crest `#4bab6d` offset (-1, -1), then the copper
   `#23804a`.
4. Pour: fill the board inset 26 with `#17683a` through `copper`, then clear
   it in mask colour: every trace stroked 22 wider than itself, the subject
   stroked 46 wide and filled, every part's box grown by 10.
5. Stitching vias: a 44-unit grid jittered by 6, half of it kept, each point
   refused within half a trace's width plus 23 of that trace, 26 of a part's
   box, 48 of a vertex of the subject or 60 of a mounting hole. A via is a copper ring of radius 5
   round a drill of 0.42 of it in `#0a0d0b`.
6. The subject: `octagonal(outline, tolerance)` simplifies the outline to
   within the tolerance (7 units for a body, 6 for a wing), bends each edge
   outward into a straight and a 45-degree run, and merges runs that
   continue. Hatch its inside with crossing 45-degree copper lines 14 apart
   and 3.6 wide, then stroke its outline as a gold track 11 wide.
7. Details of the subject: its wing exposed gold with three etched slots
   4 wide in bare laminate `#3a4424`; its beak a wedge whose faces run at 45
   degrees; its eye a plated hole, gold radius 16, drill 7.5, cleared by a
   24-unit ring of mask; its tail three traces ending in plated pads; its
   feet pads on a 20-wide power rail.
8. Exposed gold: bare laminate stroked 4 wide round the shape, then a linear
   gradient from the top left: `#f4dc98`, `#d9b35e` at 0.45, `#a8822f`.
9. Parts, each under a shadow through `kit.shadow`: gold lands first, then
   the body. Gull-wing chip: body `#1b1c1f`, top `#2a2b2f` inset 6, tinned
   leads with a light-to-dark gradient, a pin-one dimple and grey marking.
   Chip parts: tinned ends `#c7cbd1` over lands 4 wider than them. Lamps:
   a lens colour, a white hot centre and an additive glow of radius 42.
10. The laminate's glass weave: 1.4-wide lines 7 apart both ways, at
    `rgba(0, 20, 8, 0.05)`, under the parts.
11. Silkscreen `#eeefe4`, lines 2 wide: outlines round parts, a pin-one dot,
    designators in the stroke font at 9 to 11. The font has no plus sign;
    draw polarity marks as two strokes.
12. Current: along a few traces a comet, 22 segments of 3 units whose alpha
    falls as the square of the distance from its head, and an additive glow
    of radius 16 at the head.
13. A sheen: a diagonal gradient from white at 0.07 to black at 0.12 over
    the whole board.

## Palette

| Role | Colours |
| --- | --- |
| bench, board edge | `#16191d` `#c9c08c` |
| mask, pour, copper | `#0d4a29` `#17683a` `#23804a` |
| copper crest, trough | `#4bab6d` `#06301a` |
| gold, light, dark | `#d9b35e` `#f4dc98` `#a8822f` |
| bare laminate, drill | `#3a4424` `#0a0d0b` |
| silkscreen | `#eeefe4` |
| tin, light, dark | `#c7cbd1` `#f2f4f6` `#8a9099` |
| package, top | `#1b1c1f` `#2a2b2f` |

## Pitfalls

- Traces that cross read as a drawing error. Route round, or end a trace in
  a via as if it changed layer.
- Leaving out the pour clearance merges traces into the pour; the board then
  reads as a flat green picture.
- Snapping every sampled point to a grid gives staircases of tiny steps.
  Simplify first, then bend each remaining edge once.
- A part with no trace or via at its lands reads as a sticker on the board.

## Any subject

Pass each closed part of the subject through `octagonal`. Use one gold part,
one hatched part and the rest as traces or pads, so the subject reads at a
glance, and wire its extremities into the parts round it.

## Reference

[`circuit-board.js`](circuit-board.js) draws gallery `style` 10; see the
[catalog](catalog.md) for the commands.
