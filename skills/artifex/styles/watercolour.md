---
type: knowledge
summary: "How to draw the watercolour style: transparent washes built from many faint deformed layers, glazed by multiplying, with pooled pigment, dark dried rims, granulation, lifted lights and a pencil underdrawing on bare paper; read before making or adapting a watercolour piece."
related_files: ["skills/artifex/styles/watercolour.js", "skills/artifex/styles/kit.js"]
---

# Watercolour

Transparent washes on cold-press paper, loose round the edges, with the
paper's white left as the only white. Gallery `style` 11.

## What makes it read as watercolour

- Every wash is transparent: overlaps darken, as glazes do. Nothing opaque
  covers anything, and there is no white paint.
- Edges vary along their length: soft where the paper was wet, crisp and a
  little darker where the wash dried.
- Tone varies inside a wash: pigment pools in some places and thins in
  others; a second colour flows into the first while both are wet.
- Granulation: fine specks of pigment settled in the paper's tooth.
- The painting fades out into bare paper before the edge of the sheet.
- Traces of the process: a pencil underdrawing, a lifted highlight, a bloom
  where water crept back into drying paint, a few flicks of paint.

## Recipe

1. Paper `#f8f4ea`.
2. `deform(points, depth, amount)`: midpoint displacement of a closed outline.
   Each new point moves by a Gaussian times the edge's length times
   `amount` times a roughness carried by each point, handed on to the new
   point with a factor in [0.65, 1.35] and held in [0.2, 1.6]. Large washes
   start from 20 to 30 points, so no single displacement is large.
3. `wash(outline, colour, options)`: deform the outline twice with `spread`
   (default 0.12), then paint `layers` variations of it, each deformed three
   more times with `spread` x 0.45, filled at `alpha` under `multiply`.
4. Pooling (`mottle`, default 0.6): each layer passes only through circles of
   a grid over the wash, cell size its size / 16 held in [6, 26], jittered
   by a cell, kept where `fbm` at scale 0.45 x size exceeds a level that
   rises from layer to layer by 0.6 x `mottle` round 0.5. Tone then follows
   the noise field. Alpha is raised by 1 + `mottle` to make up the gaps.
5. Wet into wet (`second`, `share`): that share of the layers is painted in
   the second colour.
6. The dried rim (`rim`): stroke the outline inside a clip of itself, 7 wide
   at `rim` and 2 wide at 1.6 x `rim`.
7. Graded washes pass `outline` as a function of the layer's place, 0 to 1,
   so every layer reaches a different depth and the colour thins away. The
   sky is an ellipse whose lower edge moves down from layer to layer, 30
   layers at 0.022, `mottle` 0.
8. Wet shapes: paint the subject's body with a pale wash, clip to that wash's
   outline, and drop graded washes into it from the top (cerulean) and from
   below (sienna into rose), so both stop at the body's one edge. Then add
   its rim.
9. Glazes over dry paint: wing and tail in ultramarine with sienna or
   Payne's grey flowing in, their own rims, hard edges.
10. `lift`: twelve passes of paper colour at `strength` / 12, each a little
    smaller, so the lift is strongest at its middle.
11. `granulate`: specks of 0.5 to 1.5 x `size` in a shape's box, kept inside
    it where `fbm` at scale 30 exceeds 0.55, alpha 0.12 to 0.34 under
    `multiply`.
12. Pencil: the outlines wobbled by 1.4 at a step of 9, 1.2 wide in
    `rgba(80, 76, 72, 0.4)`, lifting at about one point in sixteen.
13. Grass and legs: tapered strokes, wide at the root, a point at the tip.
14. Tooth over everything: 9000 specks 0.6 to 1.8 units, light at 0.28 or
    brown at 0.05.

## Palette

| Pigment | Colour |
| --- | --- |
| paper | `#f8f4ea` |
| cerulean | `#5b9fcc` |
| ultramarine | `#3e55a8` |
| rose | `#dc6f86` |
| peach | `#f2b27a` |
| yellow ochre | `#dcaa4a` |
| burnt sienna | `#b9602f` |
| burnt umber | `#5e3d27` |
| sap green | `#7aa13f` |
| hooker's green | `#3b7650` |
| Payne's grey | `#2d3642` |

## Pitfalls

- High alpha per layer turns washes into opaque vector shapes. Keep one layer
  under 0.1 and build tone with more layers.
- Large deformation on long edges throws spikes. Give outlines more points
  rather than more `spread`.
- Pooling circles that are large for the wash show as round bubbles.
- Complementary glazes multiply into mud: keep warm and cool washes apart or
  let the paper separate them.
- A background wash behind the subject in the subject's own hue swallows it.
  Grade the background to paper near the subject, or change its temperature.

## Any subject

Give each part of the subject a light wash first, then the darker washes
dropped into it or glazed over it once dry. Keep one clear light, lifted or
left as paper, and let the scene round the subject fade into bare paper.

## Reference

[`watercolour.js`](watercolour.js) draws gallery `style` 11; see the
[catalog](catalog.md) for the commands.
