---
type: knowledge
summary: "How to draw pixel art's marks with the functions in pixel-art.js, and how work in pixel art is composed, lit, coloured and moved; read before making a piece in pixel art."
related_files: ["skills/artifex/styles/pixel-art.js", "skills/artifex/styles/kit.js"]
---

# Pixel art

## Contents

- [What makes it read as pixel art](#what-makes-it-read-as-pixel-art)
- [Marks](#marks)
- [Creative direction](#creative-direction)
- [Palette](#palette)
- [Pitfalls](#pitfalls)

2D pictures placed cell by cell on a coarse grid, in the manner of 8-bit and
16-bit games, then scaled up with hard edges.

## What makes it read as pixel art

- One grid for the whole picture, every cell the same size, scaled up without smoothing.
- A flat 2D view. Isometric textured cubes read as voxels instead.
- A small palette; a gradient appears only as bands joined by ordered dithering.
- Forms with a one-cell dark outline and three or four shading steps.
- No anti-aliased curves, no rotated or scaled cells, no blur.

## Marks

Draw everything into a grid of palette colours first, and emit it last. Order:
ground fill, background gradient, far forms, near forms, sprites, small
sparkles, then `emit`.

- `grid(w, h, fill)` makes the grid: `{ w, h, px, put, get }`. `put(x, y, colour)` ignores cells outside and empty colours. 100 x 100 cells on a 1000-unit frame is a 16-bit look; 64 cells or fewer reads 8-bit and chunky.
- `emit(g, G, cell, overlap)` writes each row as horizontal runs of one colour: `fillRect(x * cell, y * cell, run * cell + 0.6, cell + 0.6)`. The 0.6 overlap hides seams between runs.
- `dither(x, y, f)` and `BAYER` give 4 x 4 ordered dithering: a cell takes the next colour when f x 16 exceeds its Bayer value. A regular pattern reads as pixel art; random noise dithering does not.
- `ramp(G, x0, y0, x1, y1, colours)` fills a vertical gradient through colour bands, top to bottom, with each step dithered. Eleven bands over 72 rows gives a smooth sky; four bands gives a bold, retro one.
- `ball(G, cx, cy, r, light, shade, cut)` draws a sphere in two tones, shaded where (dx + dy) / r passes 0.55, so the light comes from the upper left. `disc(G, cx, cy, r, colour)` draws a flat disc, for spots, pits and holes.
- `halo(G, cx, cy, r, width, colour, fade)` draws a dithered glow `width` cells wide outside radius r, thinning outward. `colour` may be a function of (x, y), so a glow can take a lighter band of whatever lies behind it.
- Light that is soft while the colours stay hard: `lights(w, h)` makes a second grid, of light to add; `glow(L, cx, cy, radius, colour, strength)` adds a `#rrggbb` light that falls to nothing at `radius` cells as (1 - d) squared of the distance over the radius; `emitLight(g, L, cell)` adds the grid over the picture after `emit`, one flat amount per cell. The colour grid keeps its palette steps, so a lamp, a fire or a screen glows without a dithered ring. A strength near 0.3 tints; near 1 a white core burns out. An SVG has no added light: there, `halo` stands in.
- `twinkle(G, x, y, core, glow)` draws one bright cell with a dim plus around it: a star, a spark or a firefly.
- `lump(G, circles, light, mid, dark)` draws a union of circles `[cx, cy, r]`, cut flat 1.5 cells under its lowest centre. Top-edge cells are light and bottom-edge cells dark: clouds, bushes, foam, smoke.
- `ridge(G, x0, x1, top, bottom, fill, rim, { cap, capLine })` fills columns from `top(x)` down, with a one-cell lit rim, and a cap under the rim where the top rises above `capLine`. Build `top` from `tri(u)` triangle waves for peaks and `noise2` for rolling land, rounded to whole cells.
- Sprites: `mask(w, h, part)` rasterises shapes at cell centres; `part(px, py)` returns a part name or null, using `inEllipse` or `pointInPoly` from `core/geom.js`. Then `sprite(m, paint, outline)` colours each filled cell with `paint(part, x, y)` and turns every empty cell four-adjacent to a filled one into the outline colour. Place a sprite with `stamp(G, rows, x, y)`; a fifth argument, `opacity` from 0 to 1, fades it the medium's way, dropping whole cells by the Bayer threshold counted from the sprite's own corner, so the pattern travels with the sprite.
- Lines and curves: `line(x0, y0, x1, y1)` returns the cells of a straight line with runs as even as its slope allows, and `trace(pts, closed)` the cells of a path through points in cell units, one cell thick, with no elbow cell and with runs that zigzag in length traded so they change one way. `plot(G, cells, colour)` puts either on the grid. `trace` follows the points it is given: a curve sampled from its true shape, not from cell centres, gives the cleanest runs.
- Shading a sprite: for a round part, `step(light(x, y, cx, cy, rx, ry), [lit, base, shade, deep])` gives four steps from a light at the upper left, at thresholds -0.55, 0.25 and 0.65. For a flat part, `rim(m, x, y, top, mid, bottom)` lights the top edge and darkens the bottom edge. Place single cells by hand last: an eye with a one-cell highlight, a blush of two cells.
- `mirror(G)` flips the whole grid left to right; draw text and any part that must not mirror after it.
- Hand-placed details carry the style: a conifer as stacked rows that widen by one cell every two rows, with the lit half one tone lighter; water as a base colour with short streaks per row; a reflection as broken rows that narrow with depth.

## Creative direction

**Where it comes from.** Home computers and game consoles of the 1980s and
1990s drew pictures from a few colours on a grid of a few hundred cells,
placed one at a time by hand. The limit became a style, kept alive in
independent games and illustration.

**What it shows.** Game worlds: heroes, creatures, platforms, castles,
forests, night skies and towns, often seen from the side or from above.
Sprites are small icons that read at a glance. It rarely shows close-up faces,
photographic texture or soft atmosphere, so a quiet, intimate subject can be a
surprise in it.

**Composition.** Side-on scenes in horizontal bands, with sky, far ridge, near
ground and foreground, layered for parallax. Silhouettes read at sprite
size when forms have clear outlines and space around the key form. A frame
full of detail looks finished; a large empty area looks unfinished at this
resolution. Stray single cells on edges read as noise, and so do jagged steps
of uneven length on a curve.

**Lines and curves.** A line on the grid is a row of runs, each a few cells
long, and the eye reads the runs' lengths. A clean slope keeps one run
length: 1, 2, 3 or 4 cells for each cell it climbs. A slope between those
alternates two neighbouring lengths in a fixed pattern, such as 2, 1, 2, 1
or 3, 2, 3, 2, and never three lengths or a random mix. Along a curve the
runs change one way: long at the flat end, shorter to the 45-degree point,
then longer again, such as 6, 2, 1, 2, 6. A run that is longer than both its
neighbours, or shorter than both, away from that point is the jagged step.
Mending one step only moves the wobble along; the cure is the whole
stretch redrawn, usually by moving one end cell of a run onto its
neighbour, which keeps the cell count. A corner cell that can go while the
line still connects corner to corner makes an elbow thicker than the rest.
A single cell reads as a feature only where it stands alone against its
ground, as a highlight or a far light does; two forms with no cell of ground
between them fuse into one.

**Value, colour and light.** A palette of 16 to 32 colours, built as ramps
from dark to light. Shift the hue along a ramp, cooler and more violet in the
shadows and warmer in the lights, rather than only darkening it. One light
direction for every sprite, usually the upper left. Night scenes live in
violets and blues with a few warm lights; dithering stands in for soft light.
A form shaded in rings from its centre, darker toward every edge alike,
reads as a pillow and names no light: the highlight sits off-centre toward
the light and the shade is a crescent on the far side. Dither suits a large
area that holds still, such as a sky's bands or a rough ground, between two
neighbouring steps of a ramp. On a small form it reads as noise before it
reads as a tone, so there another palette colour or a flat step comes first,
and dither that has spread over most of a form is a colour missing from the
palette. One phase
runs across a whole area: two patches whose checkers meet a cell out of step
leave a doubled cell that reads as a mistake.

**Motion and time.** The game may run at 60 frames a second, but a sprite
animates in short cycles of 2 to 8 drawings, each held for several frames
([only the drawing holds](../reference/films.md#pace)).
Everything moves by whole cells: sub-cell positions, smooth rotation and
smooth scaling break the grid. Dither on a part that moves flickers from
drawing to drawing, so it stays on the layers that hold still. Colour cycling animates water, fire and
waterfalls by rotating palette entries, with no new drawings. Parallax layers
scroll at whole-cell speeds. Transitions native to the medium are fades
through palette steps, a mosaic that coarsens the grid, iris wipes and a
screen shake by whole cells.

**Drawing order.** Each form, in its layer's turn, goes cell by cell:
silhouette, flat colours, shading and dithering, then outline cleanup
([draw the drawing](../reference/films.md#draw-the-drawing)).

**Sound.** Chiptune: a few voices from simple sound chips, pulse and triangle
waves for melody and bass, a noise channel for drums, and fast arpeggios that
stand in for chords.

**Study**

- Mark Ferrari's colour-cycling scenes, for water, rain and fire animated by palette alone.
- Paul Robertson's animation, such as *Scott Pilgrim vs. the World: The Game* (2010), for fluid sprite cycles and impact frames.
- *Superbrothers: Sword & Sworcery EP* (2011), for large cells, wide empty landscapes and figures as a few cells.
- *Super Metroid* (1994), for mood from dark palettes and layered backgrounds.
- *Celeste* (2018), for small, readable characters in a dense, layered world.

**Levers**

- Grid size: 32 to 64 cells across reads iconic and chunky; 160 or more reads detailed and painterly.
- Palette size: 4 colours reads like a handheld screen; 32 reads rich and painted.
- Dither: none reads flat and graphic; wide dithered bands read atmospheric.
- Outline: dark outlines read as game sprites; coloured or absent outlines read softer and illustrative.
- Animation cycle: 2 drawings read stiff and charming; 8 or more read fluid.
- Hue shift: strong shifts along a ramp read warm and lively; plain darkening reads dull.

## Palette

| Role | Colours |
| --- | --- |
| night sky ramp, top to horizon | `#1a1433` `#221a44` `#2c2156` `#382868` `#473079` `#5a3a86` `#6f448f` `#875096` `#a25e9a` `#bf6e9b` `#dc849a` |
| dusk sky ramp | `#2a1b3d` `#3b2350` `#552c5e` `#73366a` `#944273` `#b44f73` `#d0606f` `#e5776a` `#f09366` `#f6ad66` `#fbc874` |
| cold night ramp | `#0b1630` `#14264c` `#213b69` `#345683` `#4e7398` `#7092a8` |
| land and water, far to near | `#3b2f6b` `#54448f` `#2a2350` `#3b3272` `#1c1838` `#1f1942` `#332a66` `#15112b` |
| lights | `#fbeecb` `#e5cf97` `#fdf0c8` `#a99ad8` `#fff3a0` `#f4dca0` |
| warm sprite ramp | outline `#1b1026`, `#ffffff` `#fbf4e6` `#e2d0bf` `#c4ad9c` |
| accent ramps, light to dark | coral `#ff9d85` `#ee7a63` `#c65a4f`; teal `#86dccb` `#4fb3a6` `#2f8a83`; blue `#8fb1ff` `#5b86e0` `#3a5eb0`; gold `#ffd87a` `#e8b23c` `#b8802a` |

## Pitfalls

- Stroking curves or drawing shapes at full resolution breaks the grid; shapes rasterised into cells keep it.
- Gradients drawn with canvas gradients look smooth and out of place; `ramp` and `dither` give the style's bands.
- Cells of two sizes in one picture break the grid; one cell size, text included, keeps it.
- Outlining every inner edge as well as the silhouette makes a sprite muddy; an outline only where a form meets nothing keeps it clean.
- Too many colours in one sprite lose the hand-placed look; three or four per material keep it.
- Two shades too close to tell apart cost a palette slot and read as a stain; merged, the ramp is cleaner.
- A sprite that is its own exact mirror image reads as stamped; one part off the mirror, such as a turned head, a raised limb or the light's side, reads as drawn.
- `mask` rasterises at cell centres and does not even out the runs of an outline; a large curve's outline drawn with `trace` over the filled form has clean runs.
- `emitLight` adds light, so it cannot darken and does nothing on white; it reads on dark and mid grounds.
