---
type: knowledge
summary: "How to draw the pixel-art style: a 2D scene on a coarse grid with a small palette, Bayer dithering and outlined, step-shaded sprites; read before making or adapting a pixel-art piece."
related_files: ["skills/artifex/styles/pixel-art.js"]
---

# Pixel art

A 2D scene in the manner of 16-bit games, drawn on a 100 x 100 grid and scaled
up with hard edges. Gallery `style` 3.

## What makes it read as pixel art

- A flat 2D view. Isometric textured cubes read as voxels instead.
- A small palette; gradients only through ordered dithering.
- Sprites with a one-pixel dark outline and three or four shading steps.
- No anti-aliased curves anywhere.

## Recipe

1. Draw into an array of palette colours, one per grid cell. Emit each row as horizontal runs: `fillRect(x * P, y * P, run * P + 0.6, P + 0.6)`; the overlap hides seams.
2. Sky: eleven bands from top to horizon. A cell takes the next band when its fraction x 16 exceeds the 4 x 4 Bayer value at (x % 4, y % 4).
3. Stars: single cells in two tones, and five plus-shaped twinkles.
4. Moon: a disc of radius 8, shaded where (dx + dy)/r > 0.55, three craters, and a halo three cells wide dithered with a lighter sky band.
5. Clouds: unions of circles cut flat at the bottom; top-edge cells light, bottom-edge cells dark.
6. Ridges: far mountains from triangle waves plus noise, with a lit rim and snow on high peaks; near hills from noise; pines as stacked rows with the right half lit.
7. Water: a base colour, short ripple streaks per row, the moon's glint as broken rows narrowing with depth.
8. Foreground: grass blades, flowers, reeds in one corner, fireflies with a dim four-neighbour glow.
9. Sprite: rasterise shapes at cell centres. Shade body cells by position against a light at the upper left, thresholds -0.55, 0.25 and 0.65. Light the wing's top edge and darken its bottom edge. Outline every empty cell four-adjacent to a filled one. Place the eye and blush by hand.

## Palette

| Role | Colours |
| --- | --- |
| sky | `#1a1433` `#221a44` `#2c2156` `#382868` `#473079` `#5a3a86` `#6f448f` `#875096` `#a25e9a` `#bf6e9b` `#dc849a` |
| moon, stars | `#fbeecb` `#e5cf97` `#dcc186` `#fdf0c8` `#a99ad8` |
| land and water | `#3b2f6b` `#54448f` `#2a2350` `#3b3272` `#1c1838` `#1f1942` `#332a66` `#15112b` |
| sprite | outline `#1b1026`, body `#fbf4e6` `#ffffff` `#e2d0bf` `#c4ad9c`, wing `#ee7a63` `#ff9d85` `#c65a4f`, beak `#f6a63b` `#d27f27` |

## Pitfalls

- Stroking curves at full resolution breaks the grid; rasterise every shape into cells.
- A large empty area looks unfinished at this resolution; give the foreground detail.

## Any subject

Rasterise the subject into sprite cells with the same shading and outline
pass, and keep the whole scene on one grid.

## Reference

[`pixel-art.js`](pixel-art.js) draws gallery `style` 3; see the
[catalog](catalog.md) for the commands.
