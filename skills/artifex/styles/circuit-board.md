---
type: knowledge
summary: "How to draw circuit board's marks with the functions in circuit-board.js, and how work in circuit board is composed, lit, coloured and moved; read before making a piece in circuit board."
related_files: ["skills/artifex/styles/circuit-board.js", "skills/artifex/styles/kit.js"]
---

# Circuit board

## Contents

- [What makes it read as a circuit board](#what-makes-it-read-as-a-circuit-board)
- [Marks](#marks)
- [Creative direction](#creative-direction)
- [Palette](#palette)
- [Pitfalls](#pitfalls)

A green printed circuit board seen from above: copper tracks under a solder
mask, gold where the mask opens, white silkscreen, and parts soldered to
their lands. Its look comes from how boards are made: copper etched on glass
laminate, coated, plated and printed.

## What makes it read as a circuit board

- Every run of copper is horizontal, vertical or at 45 degrees. A curve reads
  as a drawing of a board, not a board.
- Two greens: copper under the solder mask is lighter than bare laminate
  under it, and each copper edge has a light crest and a dark trough where
  the mask thins and pools.
- Metal shows only where the mask opens: pads, exposed art, plated holes.
  They are gold, lit from one corner, each with a thin rim of bare laminate.
- Empty board is a ground pour, kept clear of every trace by a gap of bare
  mask and stitched with small vias.
- White silkscreen names parts (`U1`, `C1`, `J1`) and outlines them.
- Parts sit on their lands and cast short shadows, and every land has a trace
  or a via.

## Marks

Coordinates are design units; the numbers below suit a board about 1000
units across. Layer the marks in this order: board and mask, ground pour and
its clearances, stitching vias, traces, exposed copper art and pads, the
laminate's weave, parts, silkscreen, current, sheen.

**Board.** `board(g, [x, y, w, h], { radius })` draws the routed edge
`#c9c08c` under a shadow of blur 30, clips 3 inside it and fills the solder
mask `#0d4a29`. It leaves the clip open; call `g.restore()` when everything
on the board is drawn. Under it, a dark bench `#16191d`, or crop so the board
fills the frame.

**Routing.** `route(waypoints, diagonalFirst)` joins each pair of points by
one straight run and one 45-degree run. `bus(route, n, pitch)` offsets one
route into `n` parallel routes, so their corners stay parallel; pitch 17 to
22. `bend(p, q)` gives the single corner between two points.

**Copper.** `copper(g, draw)` draws a feature three times: trough `#06301a`
offset (1.6, 1.8), crest `#4bab6d` offset (-1, -1), then copper `#23804a`.
`trace(g, pts, w)` is a track through it: signal 6 to 9 wide, power 14 to
20, round caps and joins. `area(g, pts, colour)` is a filled copper area.

**Ground pour.** `pour(g, outline, { traces, shapes, boxes })` fills the
outline with pour copper `#17683a`, then clears it in mask colour: each
trace (`{ pts, w }`) by `gap` 11 each side, each closed shape by `ring` 23,
each part box `[cx, cy, half w, half h]` grown by `margin` 10.
`stitch(g, R, name, [x0, y0, x1, y1], room)` sprinkles vias on a 44-unit grid
jittered by 6, keeping half of them, wherever your `room(p)` says the pour is
open. A `room` that says no within half a trace's width plus 23 of a trace,
26 of a part and 60 of a mounting hole keeps vias clear.

**Vias and holes.** `via(g, x, y, r)` is a tented via: a copper ring of
radius 5 or 6 under the mask round a drill 0.42 of it in `#0a0d0b`.
`padRound(g, x, y, r, drill)` is a gold pad, plated when it has a drill.
`platedHole(g, x, y, r, drill, clear)` clears the mask round it first.
`mountingHole(g, x, y)` is a large plated hole with a silkscreen keep-out
circle; `fiducial(g, x, y)` a gold dot in a clear disc of bare laminate, the
marks a pick-and-place machine aligns to.

**Exposed gold.** `exposed(g, shape, box)` strokes bare laminate `#3a4424` 4
wide round any path, then fills it with gold lit from the box's first corner:
`#f4dc98`, `#d9b35e` at 0.45, `#a8822f`. `padRect(g, x, y, w, h)` is a
rectangular land. `goldLine(g, pts, w, box)` is an exposed gold track along a
closed outline, 11 wide for a bold rim.

**Copper art.** Any outline becomes copper art: `octagonal(outline, tol)`
simplifies it to within `tol` (6 to 8 units keeps a silhouette), bends each
edge outward into one straight and one 45-degree run, and merges runs that
continue. Give a form one treatment per part so it reads at a glance:
- a large area as `copperHatch(g, poly, centre)`, crossing 45-degree tracks
  14 apart and 3.6 wide, inside a `goldLine` rim;
- a smaller area as exposed gold, parted from the copper round it by
  `clearRing(g, pts, 14)`, with `etch(g, poly, lines, 4)` cutting slots of
  bare laminate through it for its inner lines;
- a pointed form as a wedge whose faces run at 45 degrees;
- an eye or a dot as a plated hole with its own clearance;
- thin limbs and extremities as traces ending in pads, wired into parts.

**Parts.** Each part sits on its gold lands first, then its body under a
short shadow through `part(g, blur, draw)`. `qfp(g, cx, cy, size, per,
pitch)` is a gull-wing package and returns its leads for routing.
`chipPart(g, x, y, len, wide, body, vertical)` is a resistor or capacitor
(bodies `#b58e59` or `#1d1d1f`). `led(g, x, y, lens, lit)` is a chip lamp; a
lit one adds a white hot centre and an additive `glow` of radius 42.
`inductor`, `crystal`, `electrolytic` and `header` draw a shielded inductor,
a crystal can, an electrolytic from above with its polarity band, and a pin
header. `metal(g, x0, y0, x1, y1, stops)` is the gradient for any metal body.

**Weave and sheen.** `weave(g, a, b, 7, ends)` draws the laminate's glass
weave, 1.4-wide lines 7 apart both ways at `rgba(0, 20, 8, 0.05)`, under the
parts. `sheen(g, x, y, w, h)` lays a diagonal gradient from white at 0.07 to
black at 0.12 over the whole board, last.

**Silkscreen.** `silk(g, w)` sets the pen to `#eeefe4`, 2 wide. Outline each
part a little outside its body, add a pin-one dot, and set designators with
`label(g, text, x, y, size)` at 9 to 11. The stroke font has no plus sign;
`plus(g, x, y)` draws a polarity mark.

**Current.** `current(g, traces, at)` sends a comet along each trace: its
head at fraction `at[k]`, a tail of 22 points 3 units apart clipped to one
ribbon that narrows from 4 wide at the head toward 1.5 and whose alpha falls as
the square of the distance from its head along the trace, and an additive glow
of radius 16 at the head. Each straight run of the tail is filled once inside
the ribbon, with a gradient along that run, so the tail fades evenly round a
tight bend and shows no bright beads at its joints. Move `at` with time for a pulse.

## Creative direction

**Where it comes from.** The printed circuit replaced hand wiring from the
1940s on; the green mask, gold or tinned pads and white legend became its
standard dress. Layout follows electrical rules, and the beauty is a side
effect of order: parallel buses, even clearances, repeated parts.

**What it depicts.** Boards depict themselves: function made visible. Board
designers have long hidden small drawings in copper and silkscreen, so a
figure, a landscape or a word laid out as copper art fits the tradition. It
rarely shows anything organic at full size; a soft subject forced into
45-degree runs reads as translation, one world rebuilt in the grammar of
another.

**Composition and framing.**
- The camera looks straight down. Parts sit at 0 or 90 degrees, aligned on a
  grid.
- Density clusters round chips and thins into open pour; leave quiet areas
  so the dense ones read.
- Buses carry the eye: parallel tracks turning together lead from one part
  to another across the frame.
- A whole board on a bench reads as an object; a crop where tracks run off
  every edge reads as a territory, a city seen from the air.
- Scale shifts the reading: a macro crop where a via is large reads as
  landscape; a full board reads as a device.

**Value, colour and light.** One key light from a top corner sets the
direction of every gold gradient, crest, trough and shadow; keep them all
agreeing. The greens stay close in value, so gold and white silkscreen carry
the brightest notes. Colour beyond green, gold, tin and white comes only
from lamp lenses and their glow, and is rare.

**Motion and time.**
- Current is clocked: pulses run along traces at a steady speed and in
  step; lamps switch on and off in sequence, in steps, not fades.
- Routing grows: a track extends one leg at a time and snaps at each
  45-degree corner, as an autorouter lays it; the pour floods in after and
  pulls back from every trace.
- Cameras glide low and slow over the board, or hold top-down and track
  across it like an aerial shot.
- Transitions native to the medium: a pulse leaving the frame along a trace
  and arriving in the next shot; a crop into a chip until its package fills
  the frame.
- What breaks it: tracks that curve or wobble, glow on everything, parts
  that move or drift, soft organic easing on what should switch.

**Drawing order.** A board laid out on screen goes board, parts placed, traces
routed, the pour flooded round them, then silkscreen
([draw the drawing](../reference/films.md#draw-the-drawing)). The pour comes
after the traces, though it layers under them. A `trace` has no taper or
wobble, so it grows as a `trace` along `grow(pts, d).points` of its `route`,
and the `pour` inside a band swept across the board
([grow a mark by length](../reference/films.md#draw-the-drawing)).

**Study.**
- Paul Eisler's early printed circuits: for the origin of etched copper as a
  drawing.
- Boldport kits by Saar Drimer: for boards designed as visual objects, with
  shaped outlines and silkscreen art.
- Silicon Zoo, Michael Davidson's photographs of chip art: for drawings
  hidden in the layers of electronics.
- KiCad's 3D viewer: for how a lit board reads from above, mask over copper.

**Levers.**
- Crop: the whole board reads as an object; tracks running off every edge
  read as a city or a map.
- Density: sparse tracks over open pour feel calm and precise; dense buses
  feel busy, urgent, alive.
- Exposure: more gold opened in the mask draws the eye to it; most copper
  under the mask keeps the board quiet.
- Current: no pulses is a dead board; one pulse is a message; many in step
  are a heartbeat.
- Snap: a tight `octagonal` tolerance keeps a form's likeness; a loose one
  turns it into a circuit diagram of itself.
- Light: a low key light lengthens shadows and makes parts stand up; a high
  one flattens the board into a plan.

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
| lamp lenses | `#9dffb0` `#ffd35a` `#ff6a5a` `#8ab8ff` |

## Pitfalls

- Traces that cross read as a drawing error; a board routes round, or ends a
  trace in a via as if it changed layer.
- Leaving out the pour clearance merges traces into the pour; the board then
  reads as a flat green picture.
- Snapping every sampled point to a grid gives staircases of tiny steps;
  `octagonal` simplifies first, then bends each remaining edge once.
- A part with no trace or via at its lands reads as a sticker on the board.
- Gold gradients, crests and shadows lit from different corners flatten the
  board; one light holds it.
- Every copper area hatched or every area gold loses the form; one treatment
  per part of a form keeps it.
