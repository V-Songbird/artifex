---
type: knowledge
summary: "How to draw the voxel style: Minecraft-like isometric blocks with 16 x 16 texel faces, face shading, culling and painter's order; read before making or adapting a voxel piece."
related_files: ["skills/artifex/styles/voxel.js"]
---

# Voxel

3D made of cubes, as in Minecraft. Gallery `style` 6.

## What makes it read as voxels

- Isometric boxes whose faces carry coarse textures, 16 x 16 texels per block face.
- Light comes only from face orientation: top 1.0, left 0.8, right 0.63, as an sRGB multiply.
- Hard texel edges; no smooth shading and no outlines.
- Blocks sit on a grid; a floating island is the classic stage.

## Recipe

1. Projection with block size S = 75: A = 0.866 S, B = 0.5 S, C = S; a point maps to (ox + (x - y) A, oy + (x + y) B - z C).
2. Everything is a box `{ x, y, z, w, d, h, mat }`. World blocks are unit cubes recorded in a set of occupied cells.
3. Visible faces are the top, the left (+y) and the right (+x). Skip a world block's face when the neighbouring cell is filled.
4. Painter's order: sort by (x + w/2) + (y + d/2) + 0.9 (z + h/2).
5. Texture a face with one affine `transform` that maps texel (u, v) onto it, then one `fillRect(u, v, 1.06, 1.06)` per texel; the overlap hides seams.
6. A texel's colour: 0.65 x value noise at texel scale plus 0.35 x a hash, picking from a palette sorted dark to light. Offset the noise per block so repeats do not show.
7. Materials: grass tops from greens; grass sides with a jagged green lip 3 to 5 texels deep over dirt; dirt with rare grey pebbles; logs with vertical bark stripes and ringed tops; blossom leaves from pinks.
8. Background: open daylight, a vertical gradient from `#6f9fe0` through `#b3d1f1` to `#e2eefa`. Clouds are flat, untextured slabs 0.35 of a block tall, drawn with the same projection: tops white, left faces `#e3ecf7`, right faces `#cfdcee`. Far islands use the same box routine at a smaller block size, their texels mixed 55% to 65% toward the haze `#c9def4`.
9. Characters are boxes too: body, head with eye texels painted on its faces, a small beak box, flat wing boxes.

## Palette

| Material | Colours, dark to light |
| --- | --- |
| grass | `#4f8a2e` `#5c9a36` `#69a83e` `#77b548` `#86c154` |
| dirt, stone | `#5b3a21` `#6a4527` `#79502e` `#885c36` `#96683f`, `#7d7d7d` `#939393` |
| bark, rings | `#43301c` `#523a22` `#61452a` `#704f31`, `#8a6a40` `#a07d4f` `#b38f5d` |
| blossom | `#d8699c` `#e27aa8` `#ec8fb9` `#f3a2c6` `#f8b8d4` `#fbcde1` |
| sky, clouds, haze | `#6f9fe0` `#b3d1f1` `#e2eefa`; `#ffffff` `#e3ecf7` `#cfdcee`; `#c9def4` |

## Pitfalls

- Cull hidden faces: drawing them costs thousands of fills and they can show at seams.
- Sorting by centre can fail for boxes of very different sizes that overlap; keep such clusters small, as one character.
- Blocks drawn as flat 2D pixel sprites read as pixel art; the texels must lie on the box faces.

## Any subject

Voxelise the subject: fill a grid with material ids, or build it from a few
boxes, and draw it with the same box routine.

## Reference

[`voxel.js`](voxel.js) draws gallery `style` 6; see the [catalog](catalog.md)
for the commands.
