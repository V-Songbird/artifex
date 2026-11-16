---
type: api_spec
summary: "Defines the map helpers of core/maps.js: grids of numbers composed into a surface, a height first, light and wear derived from it, colour read last; read when a piece builds a material from formulas instead of marks."
related_files: ["core/maps.js", "core/image.js", "core/rand.js", "tests/maps.test.js", "skills/artifex/reference/materials.md"]
---

# Surfaces as maps

Import helpers from `core/maps.js`. A map is `{ w, h, data }`: `data` is a `Float32Array` of `w * h` numbers, row by row from the top left. Every helper returns a new map and changes none it is given, so maps compose like nodes of a graph: generators make them, filters change them, and the last step turns one into an image. Sizes and distances are in cells; a piece decides how many cells cover its design units. One map may hold at most 2^24 cells.

The order that works for a material: a **height** first, built from noises that are bent, stretched and cut; then the maps **derived** from that height, light and standing; then **tone**, a sum of those; and **colour** last, read through a ramp and laid by masks. [Materials and light](../../skills/artifex/reference/materials.md#a-surface-built-as-maps) explains why.

## Generators

| Function | Returns |
| --- | --- |
| `fill(w, h, value)` | A map holding `value`: a number (default 0), or a function `(x, y)` of each cell's column and row. |
| `noise(R, w, h, opt)` | Gradient noise about 0.5, in `[0, 1)`, from the piece's `R`. `opt.scale` (default 64) is the size in cells of its largest features: one number, or `[across, down]` for a grain that runs one way. `opt.octaves` (default 1, at most 12) adds finer copies, each half the size and `opt.gain` (default 0.5) the strength of the one before; an octave finer than a cell is not added. `opt.name` (default `'map'`) separates one noise from another. |

| `cells(R, w, h, opt)` | The surface cut into cells round the points of a jittered lattice, as four maps: `value`, one number in `[0, 1)` for the whole cell; `edge`, how far a place lies from the cell's nearest border, in map cells, 0 on the border; `x` and `y`, where a place lies from its cell's point, in units of `opt.scale`, about -0.5 to 0.5 across a cell. `opt.scale` (default 64) is the cell's size in map cells, one number or `[across, down]` for long cells; `opt.jitter` (default 1, from 0 to 1) is how far a point strays from its lattice place; `opt.name` (default `'cells'`) separates one cutting from another. |

`noise` is a window on one endless field: a larger map with the same `R`, name and scale holds the smaller one in its top left corner. It is 0.5 at every lattice point, so a `scale` near one cell gives almost nothing. Grain at the size of a cell is one value per cell: `fill(w, h, (x, y) => R('grain', 'cell', (x << 16) | y))`.

Other shapes come from `fill` with any function: a ramp, or a groove at a distance from a line.

## Filters

| Function | Returns |
| --- | --- |
| `warp(m, dx, dy, reach)` | `m` read through a bend: each cell takes the value `reach * (dx - 0.5)` cells across and `reach * (dy - 0.5)` cells down, so a noise bends evenly both ways and 0.5 leaves a cell alone. Read between cells; past an edge the map is read mirrored. |
| `levels(m, lo, hi, gamma)` | `m` with `lo` moved to 0 and `hi` to 1, held between them, then raised to `gamma` (default 1). A `hi` under `lo` turns it over. `lo` and `hi` close together make a mask. |
| `steps(m, n, soft)` | `m` cut into `n` flat steps to a unit of height. `soft` (default 0.1, from 0 to 1) is the share of a step its riser takes; 0 makes a wall. |
| `blur(m, sigma)` | `m` blurred by about a Gaussian of `sigma` cells, as three running means, so the cost does not grow with `sigma`. Edges are held. |
| `slopeBlur(m, slope, opt)` | `m` dragged down the slopes of another map: each cell takes the fold of the values found from it up the slope of `slope`, at `opt.samples` places (default 16, at most 64) along a line `opt.reach` cells long (default 8) where that slope is an average one, shorter where it is gentle and at most twice as long where it is steep. `opt.mode` is the fold: `'mean'` (default) smears, `'min'` eats what is high away, `'max'` spreads it. A flat `slope` leaves `m` as it is. |
| `combine(fn, ...maps)` | A map whose every cell is `fn` of the same cell of each map given: `combine((a, b) => a * b, height, mask)`. The maps must have one size. |

Bend several maps with the same `dx` and `dy` and they stay one material: neighbours that share a sway read as grown or split together.

## Break lines and uneven wear

A noise cut into levels by `steps` breaks along its own level lines: closed loops, one inside the next, every riser alike. That reads as the contours of a map, not as a material. Where a surface breaks is a pattern of its own, and `cells` gives it:

- **A level for each cell.** `value` is one number per cell, so neighbours sit at different heights and the border between them is a break line that follows no contour.
- **A tilt for each cell.** `x` and `y` run across the cell, so `combine((v, x, y) => x * Math.cos(a(v)) + y * Math.sin(a(v)), c.value, c.x, c.y)` is a ramp per cell, turned by an angle made from its `value`. A tilted cell stands high at one edge and lies flush at the other: one side breaks and the other does not. The lowest of several such ramps is a faceted cell.
- **A bevel from the border.** `levels(c.edge, 0, width)` rises from 0 on the border to 1 `width` cells inside it.

Bend the four maps with one `warp` and the straight borders turn organic together. Then make the wear uneven with `slopeBlur`: a rough noise as its `slope` with `mode: 'min'` chips an edge more in one place than another; a ramp as its `slope` drags everything one way. Vary how far each cell tilts, from another number made from its `value`, and some borders vanish: the break lines end instead of closing into a net.

```js
const c = cells(R, n, n, { scale: [400, 70], name: 'plates' });
const tilt = combine((v, y) => 0.1 * v + 0.9 * ((v * 13.7) % 1) ** 2 * y, c.value, c.y);
const worn = slopeBlur(tilt, noise(R, n, n, { scale: 20, octaves: 3, name: 'chip' }), { reach: 4, mode: 'min' });
```

## Maps derived from a height

| Function | Returns |
| --- | --- |
| `shade(height, opt)` | The light the height takes, 0 to 1: the cosine between each cell's facing and `opt.light`, `[x, y, z]` towards the lamp with y down the map and z out of it (default `[-1, -1, 1]`, the upper left). `opt.scale` (default 1) is how many cells one unit of height stands; larger is a deeper relief. A flat cell takes the lamp's own height, about 0.58 by default. |
| `relief(height, sigma)` | How far each cell stands above its surroundings, `sigma` cells wide: over 0 on what stands out, where wear and light catch, and under 0 in the hollows, where dirt and shadow sit. |

Where a height drops, `shade` gives a lit riser facing the lamp and a dark one facing away; `relief` then darkens the foot of each and lightens its lip.

## Colour

| Function | Returns |
| --- | --- |
| `toImage(m, stops)` | The map as an image, `{ w, h, channels: 3, data }`: each value, held to 0..1, read through `stops`, a list of colours from the one at 0 to the one at 1, evenly spaced and mixed in linear light. |
| `over(img, colour, mask)` | The image with `colour` laid over it by `mask`: 0 leaves a pixel, 1 replaces it. A new image. |

`show(g, img, x, y, w, h)` of `core/image.js` draws the image in one call. It keeps a canvas per image, so build the image once: in a build stage for a film, not in `draw`.

```js
const { noise, warp, levels, steps, combine, shade, relief, toImage } = require('artifex/core/maps.js');
const { show } = require('artifex/core/image.js');

function surface(R, n) {
  const bend = noise(R, n, n, { scale: 90, name: 'bend' });
  const layers = steps(levels(warp(noise(R, n, n, { scale: [200, 50], octaves: 4, name: 'layers' }), bend, bend, 40), 0.3, 0.7), 4);
  const lit = shade(layers, { scale: 30 }), stood = relief(layers, 4);
  const tone = combine((l, s) => 0.45 + 0.8 * (l - 0.577) + s, lit, stood);
  return toImage(tone, ['#3a413e', '#7c847d', '#e0e4dd']);
}
// in draw, with the image built once: show(g, image, 0, 0, 800, 800);
```

Run `node --test tests/maps.test.js` for the generators, the filters, the derived maps and the image. These tests do not establish that a surface looks like its material.
