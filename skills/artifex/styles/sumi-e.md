---
type: knowledge
summary: "How to draw the sumi-e style: black ink brush painting on rice paper, with pressed and lifted strokes that run dry into streaks, pale washes, reserved white and much empty space; read before making or adapting a sumi-e piece."
related_files: ["skills/artifex/styles/sumi-e.js", "skills/artifex/styles/kit.js"]
---

# Sumi-e

Black ink brush painting on rice paper: few strokes, every tone from pale
wash to black, and much empty paper. Gallery `style` 12.

## What makes it read as sumi-e

- Each mark is one brush stroke with a pressure: it enters round, swells or
  holds, and lifts to a point or stops blunt. Outlines drawn at one width
  read as a pen drawing.
- The brush runs dry: late in a stroke the ink breaks into streaks of bare
  paper along the hairs ("flying white").
- One colour only. Depth comes from tone: black for the nearest, most
  important marks, grey washes behind.
- Whites are reserved, never painted: the moon, the eye, the belly are bare
  paper.
- Most of the sheet is empty. The subject sits off centre on a diagonal.

## Recipe

1. Paper `#f1eadb`; a radial shade from `rgba(255, 252, 244, 0.25)` in the
   middle to `rgba(150, 125, 85, 0.14)` at the edges; 520 fibres, curves 6
   to 30 long, light at 0.5 or brown at 0.16, 0.6 to 1.4 wide.
2. `brush(spine, options)`: smooth the spine with three Chaikin passes,
   resample it every 2 units and give each point a half width
   `w / 2 x press(t)`. The edges wobble by 14% of that with a slow `fbm`.
3. The wet body: a polygon along both edges up to `1 - dry` of the length,
   closed by a ragged end whose nine points reach up to 24 samples further,
   and by a half circle behind the first point, so the stroke enters round.
   Fill it with ink at `tone x (0.8 - 0.3 grade)`.
4. Bristles (`bristles`, 6 to 56): lines across the brush, each with its own
   thickness, load and point where it starts to run dry, from `1 - dry` to
   `1 - 0.15 dry` of the length. A bristle is drawn where `fbm` along it
   exceeds 0.25 plus half of how far past that point it is, so gaps grow
   toward the end. Its ink is `tone x (0.5 - 0.35 grade x side)` times its
   load, paler toward one side of the brush.
5. `bleed`: four strokes of the body's outline at `tone x 0.06`, 1.5, 3, 4.5
   and 6 times `bleed` wide, before the fill: thin ink creeping into fibres.
6. Pressures: `swell` 0.55 rising to 1 mid-stroke; `taper` lifted to a point;
   `blunt` 0.85 to 1, stopped; `press` pressed in over the first quarter and
   eased at the end.
7. A night wash with the moon reserved: an even-odd clip of the sheet minus
   a circle of radius 92, then 36 ellipses, radius 110 to 360, their edges
   pushed by `fbm`, each filled at ink 0.0075; three faint rings at the
   moon's rim.
8. The branch: one heavy stroke, width 62, tone 0.95, dry 0.4, grade 0.65,
   `press`; a narrower dark stroke over its base; twigs 12 to 22 wide with
   `taper`, leaving the limb at angles; black dots at the joints.
9. Plum blossoms: five petal circles, radius 0.52 of the flower's, washed at
   ink 0.045, their outer arcs drawn 1.3 to 2.3 wide at ink 0.7, a paler
   middle, seven stamens with dark dots. Buds are single dots.
10. The subject in few strokes: a grey mass along the back (width 104, tone
    0.5, bleed 3), a black cap over the head (width 76, `press`), four wing
    strokes from the shoulder back, each shorter, paler and drier, two tail
    strokes, two fine beak strokes, the belly as one 5-wide line, the eye a
    paper disc of radius 11 round a black pupil.

## Palette

| Role | Colour |
| --- | --- |
| rice paper | `#f1eadb` |
| ink | `rgb(22, 19, 17)` at alpha 0.0075 to 1 |

## Pitfalls

- A stroke whose wet body stops with a straight cut reads as a vector shape.
  End it raggedly and let the bristles carry on.
- A stroke that runs dry too early loses the thing it was painting: keep
  `dry` near 0.3 for a branch the subject stands on.
- Separate discs drawn for the stroke's start show as darker circles where
  they overlap the body. Build the start into the body's polygon.
- Grey everywhere flattens the picture. Keep the blacks for the few marks
  that matter and leave most of the sheet bare.
- The reference leaves out the red seal and the calligraphy that often sign
  such paintings; add them only when the piece asks for them.

## Any subject

Find the three or four masses of the subject and give each one stroke, the
darkest where the eye should go first. Follow each mass's length with the
stroke, not its outline, and leave its light side as paper.

## Reference

[`sumi-e.js`](sumi-e.js) draws gallery `style` 12; see the
[catalog](catalog.md) for the commands.
