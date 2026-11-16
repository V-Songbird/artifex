---
type: knowledge
summary: "How to draw voxel's marks with the functions in voxel.js, and how work in voxel is composed, lit, coloured and moved; read before making a piece in voxel."
related_files: ["skills/artifex/styles/voxel.js", "skills/artifex/styles/kit.js"]
---

# Voxel

## Contents

- [What makes it read as voxels](#what-makes-it-read-as-voxels)
- [Marks](#marks)
- [Creative direction](#creative-direction)
- [Palette](#palette)
- [Pitfalls](#pitfalls)

3D made of cubes, as in Minecraft: a world of blocks on a grid, each face
painted with a coarse texture and drawn in isometric view.

## What makes it read as voxels

- Isometric boxes whose faces carry coarse textures, 16 x 16 texels per block face.
- Light comes only from face orientation: top 1.0, left 0.8, right 0.63, as an sRGB multiply.
- Hard texel edges; no smooth shading, no gradients on a face and no outlines.
- Blocks sit on one grid; characters and props are built from a few boxes.
- Distance shows as haze, the texels mixed toward the sky's colour.

## Marks

Order: a sky behind everything, then flat slabs and far, hazed blocks, then
the near world and any free boxes, sorted together, then small loose flakes.

- `iso(S, ox, oy)` returns the projection for block size S with the origin at (ox, oy). A point (x, y, z) maps to (ox + (x - y) 0.866 S, oy + (x + y) 0.5 S - z S): x runs to the lower right, y to the lower left, z up. S 60 to 90 on a 1000-unit frame shows a small diorama; 15 to 25 shows a far landscape.
- `world()` returns `{ boxes, cell, block }`. `block(x, y, z, mat)` adds a unit cube and records its cell, so faces between neighbours are culled. Any box is `{ x, y, z, w, d, h, mat }`. Mark a box `free: true` when it is off the grid, such as a character's part, so its faces are always drawn.
- `drawBoxes(g, boxes, cell, at, tex, { haze, hazeColour, base, texels })` sorts boxes back to front by `depth`, (x + w/2) + (y + d/2) + 0.9 (z + h/2), then moves each box after every box it overlaps on screen and lies in front of, so a long box is painted before a small box resting on it. Of two boxes that cut into each other, the one of lower depth is painted first unless a chain of boxes, each behind the next or an intersecting pair already ordered, puts the other first. The on-screen overlap test assumes `iso()` proportions; with another `at`, boxes can come out in the wrong order where they overlap. It draws only the visible faces, top, left (+y) and right (+x), and skips a face whose neighbouring cell is filled. A face gets `texels` (16) texels per block side, so a box half a block wide has 8. `tex[mat](face, u, v, id)` colours a texel; a box's `decal(face, u, v, nu, nv)` can paint over it, as with eyes, a window or a sign. `haze` 0.55 to 0.65 mixes every texel toward `hazeColour` for far blocks. It leaves `boxes` in your order. A box's id is its `key` when you give it one, else `base` plus its index in `boxes`; give a key to each box that must keep its texture while boxes before it in the list come and go. A key is a whole number of 0 or more, used as it is without `base`; keep it clear of every other box's id in this group and in other groups, since the built-in textures fail on any other key and two boxes with one id share a texture. A change in paint order never changes a texture, even when one list is drawn on every frame, and a second group with its own `base` and its own keys does not repeat the first's textures.
- `face(g, o, pu, pv, nu, nv, colourAt)` textures one parallelogram: one affine `transform` maps texel (u, v) onto it, and each texel is a `fillRect(u, v, 1.06, 1.06)`. The overlap hides seams.
- `shaded(hex, k)` and `hazed(hex, k, haze)` multiply a colour by a face's light and mix it toward a haze; both are cached.
- Textures each return `(face, u, v, id) => colour`. A texel's value is `texel(R, name, id, u, v, scale)`: 0.65 value noise at `scale` texels plus 0.35 hash, offset per block id. `pick(pal, n)` turns that value into a colour from a palette sorted dark to light.
  - `grassTexture(R)` gives a speckled green top and dirt sides under a jagged green lip 3 to 5 texels deep, with stone pebbles in about 3.5% of texels.
  - `dirtTexture(R)` is mottled brown with pebbles in 4% of texels.
  - `logTexture(R)` has vertical bark stripes on the sides and square growth rings on top.
  - `speckle(R, name, pal, scale)` uses one palette for leaves, blossom, wool, sand or plain stone. A scale of 2 to 2.5 is busy, like leaves; 4 is calm, like wool.
  - `bands(R, name, pal, scale, every)` darkens every `every`-th texel column, for feathers, planks and cloth.
- `slab(g, { S, x, y, rows, height, colours })` draws flat untextured blocks, one cell per `'1'` in `rows`, 0.35 of a block tall. Faces are `[top, left, right]`, white `#ffffff`, `#e3ecf7` and `#cfdcee` by default. Use it for clouds, water surfaces and shadows.
- Background: a vertical sky gradient with three stops, at 0, 0.6 and 1. Loose flakes, such as petals, leaves or snow, are small rectangles twice as wide as tall, about two texels by one, snapped to a grid of one texel.

## Creative direction

**Where it comes from.** Video games. Minecraft (2011) made the textured
block the look of a whole family of building games, and its 16 x 16 face
textures are pixel art laid on cubes.

**What it shows.** Landscapes of terrain in layers, floating islands, small
buildings, trees, animals and characters with box heads and limbs, dioramas
and cut-away worlds. Blocks invite building, digging and growing. Curves,
faces with expression, soft materials and water in motion are hard here, so
any of them is a surprise worth solving.

**Composition.** A diorama seen from the fixed isometric angle, often a chunk
of world cut out and floating, which shows the layers of ground in section.
The isometric view has no vanishing point, so scale comes from the block size
and from familiar objects. Keep the near group large and textured, and far
groups small and hazed for depth. A character among blocks should be two to
three blocks tall, or about one block for a small animal.

**Value, colour and light.** Light comes only from the three face
orientations, so value differences come from the material palettes. Keep each
palette in 4 to 6 close steps, sorted dark to light. Daylight skies are open
blues with clouds as flat white slabs. Time of day changes the sky and the
haze, not the face light. Saturated materials such as blossom, autumn leaves or
wool are the accents against grass and dirt.

**Motion and time.** World blocks appear and vanish whole, one at a time.
Building or decay happens block by block, often in rhythm. Characters swing
box limbs on hinges in a simple sine, without bending. Movement on the grid
hops from cell to cell. Clouds drift as whole slabs. The camera keeps its
isometric angle and pans; a smooth turn breaks the painter's order unless the
whole scene is redrawn. Things that break the illusion: a face with a smooth
gradient, a world block off the grid, texels of different sizes on
neighbouring blocks, and outlines.

**Drawing order.** Built block by block, bottom up and back to front, each
block placed whole ([draw the drawing](../reference/films.md#draw-the-drawing)).

**Study**

- *Minecraft* (Mojang, 2011), for 16 x 16 textures, face shading and how terrain is layered.
- *Fez* (Polytron, 2012), for a block world with pixel-art faces and its turns of view.
- *Crossy Road* (Hipster Whale, 2014), for chunky block characters and motion that hops cell to cell.
- *3D Dot Game Heroes* (2009), for characters built from blocks and their animation.

**Levers**

- Block size: large blocks read as a toy diorama; small blocks read as a landscape.
- Texture: 16-texel faces read classic and crafted; 4 to 8 texels read bolder and more abstract; plain faces read like clay.
- Haze: strong haze on far groups reads as vast and airy; none reads as a closed tabletop.
- Palette contrast: close steps read calm; one saturated material among muted ones draws the eye.
- Rhythm: blocks placed one per beat read as building; whole groups appearing at once read as magic.
- Island cut: a world cut to show its layers reads as a specimen; terrain running off the frame reads as a world.

## Palette

| Material | Colours, dark to light |
| --- | --- |
| grass | `#4f8a2e` `#5c9a36` `#69a83e` `#77b548` `#86c154` |
| dirt, stone | `#5b3a21` `#6a4527` `#79502e` `#885c36` `#96683f`, `#7d7d7d` `#939393` |
| bark, rings | `#43301c` `#523a22` `#61452a` `#704f31`, `#8a6a40` `#a07d4f` `#b38f5d` |
| blossom | `#d8699c` `#e27aa8` `#ec8fb9` `#f3a2c6` `#f8b8d4` `#fbcde1` |
| snow white | `#c9d0d6` `#d8dde1` `#e4e8eb` `#eef1f3` `#f6f8f9` `#ffffff` |
| autumn | `#c4511e` `#d4652a` `#e07a33` `#ea9140` `#f2a94f` `#f7c066` |
| wisteria | `#8d6cc4` `#9c7dd0` `#ab8fdb` `#bba2e4` `#cbb6ec` `#dccbf3` |
| leaf | `#3f7a2a` `#4a8a31` `#56993a` `#63a845` `#72b551` `#84c262` |
| cream, coral | `#e7ddcb` `#efe6d6` `#f6efe3` `#fbf7ef`, `#c95641` `#dd6a50` `#ec8064` `#f39479` |

| Hour | Sky stops | Haze |
| --- | --- | --- |
| noon | `#6f9fe0` `#b3d1f1` `#e2eefa` | `#c9def4` |
| pale morning | `#86b2ea` `#d3e2f2` `#fbe6d2` | `#dee4ee` |
| dusk | `#5b6cb6` `#d79ab3` `#fbd3a6` | `#debac4` |

Cloud slabs: tops `#ffffff`, left faces `#e3ecf7`, right faces `#cfdcee`.

## Pitfalls

- Hidden faces drawn cost thousands of fills and can show at seams; culling them saves both.
- No paint order is right for three or more boxes that each lie in front of the next where they overlap, as long boxes can when they interlock. `drawBoxes` paints such a cycle from its box of lowest depth, so one overlap comes out wrong; boxes outside the cycle still keep their order. One of the cycle's boxes split into cell-sized boxes breaks the cycle.
- Boxes that cut into each other have no right order: `drawBoxes` paints the one of lower depth first, but outside a cycle every box that lies behind or in front of another keeps that order. A third box behind the lower-depth one and in front of the other is painted between them, the higher-depth one first, so where the pair overlaps the lower-depth one shows on top. Small clusters, as one character, kept apart from other boxes, limit the wrong overlap. Between frames, two boxes that start or stop overlapping on screen can swap which one is in front without their depths crossing, since only overlapping pairs are ordered; see [paint order](../../../docs/knowledge/command-line-tools.md#paint-order) to measure it.
- Blocks drawn as flat 2D pixel sprites read as pixel art; texels on the box faces read as voxels.
- The same texture on every block shows a repeat; an id per block, a `base` per group, and for each keyed box a key no other box or group uses break it.
- A world block placed above air floats; a block that rests on another, down to the ground, reads as built.
