---
type: knowledge
summary: "How to draw the papercraft style: torn strips with white cores and soft shadows, printed papers, cut subjects; read before making or adapting a papercraft piece."
related_files: ["skills/artifex/styles/papercraft.js", "skills/artifex/styles/kit.js"]
---

# Papercraft

A layered paper collage: torn strips, cut shapes and printed papers, each
sheet under a soft shadow. Gallery `style` 0.

## What makes it read as paper

- Torn edges show the paper's white core as an irregular rim, 3 to 12 units wide.
- Every sheet casts a soft shadow onto the one beneath. Without shadows it reads as flat vector art.
- Scenery is torn; the subject is cut clean, as with scissors.
- Some sheets carry print: newsprint word bars, rows of cursive loops.
- Colour is flat inside a sheet. Texture comes only from faint mottle and grain.

## Recipe, back to front

1. Ground: one flat colour, `#34418a`.
2. Sky strips hang from the top edge, each torn along its lower edge (`tornStrip`). The edge has 141 points: a wave of noise at x/240 times 4 x amplitude, plus a jag of noise at x/14 times the amplitude and hashed jitter at half of it.
3. Draw each strip twice: first the white core (`#eee8dc`) with the edge lowered 3 to 12 units by noise, under a shadow of rgba(4, 6, 24, 0.55), blur 18, offset (0, 7); then the coloured sheet with the unlowered edge.
4. Stack three strips from the lowest and lightest to the highest and darkest: `#28337a` at y 640, `#212b66` at 430, `#1a2253` at 210, amplitudes 16, 14 and 12.
5. Mottle each strip inside its own clip: 40 circles of radius 30 to 90, white at alpha 0.016 or navy at 0.03.
6. Printed shapes: a newsprint crescent made by an even-odd clip of the canvas minus an offset circle, filled with rows of word bars 2.2 units high at alpha 0.35.
7. Small cut shapes: five-point stars, inner radius 0.45, radius 7 to 16, `#f3d27c`, shadow blur 6 at (0, 3); thin cream crosses as sparkles.
8. Motion: a dashed line, dash 14 and gap 13, width 3.5, cream, ending at the subject.
9. Subject: fill each part with its own shadow, rgba(3, 5, 25, 0.55), blur 16, offset (8, 11), back to front, so parts shadow each other. Add 60 short fibre curves at alpha 0.1 clipped to the body, a fold line on the wing, the blush and the eye with a white glint.
10. Foreground sheets: houses as cut polygons with shadow blur 14 at (5, 5), cursive rows at alpha 0.08 clipped inside, a darker roof strip, lit windows `#f5c24c` with dark cross bars.
11. Grain: 7000 specks, white at alpha 0.05 or navy at 0.08.

## Palette

| Role | Colours |
| --- | --- |
| ground and strips | `#34418a` `#28337a` `#212b66` `#1a2253` |
| paper core, newsprint | `#eee8dc` `#efe5c8` |
| stars, windows | `#f3d27c` `#f5c24c` |
| houses | `#3a2f6d` `#2b2a5e` `#45337a` `#262a58` `#3d3272` |
| subject | cream `#f6f1e6`, coral `#e9806e`, tail `#d8634b`, beak `#f0a442`, eye `#2a2238` |

## Pitfalls

- Set shadows through `shadow()` from `kit.js`; raw `shadowBlur` stays the same size at every export scale.
- Mottle stronger than alpha 0.03 reads as bokeh, not paper.
- An even-odd clip needs both shapes in one path: `g.rect` then `g.arc`, or `sub()`; `path()` starts a new path.

## Any subject

Give each part of the subject its own polygon and fill it with the shadowed
fill in back-to-front order. Keep torn edges for scenery. Choose one dark ground
and three strip tones stepping toward it.

## Reference

[`papercraft.js`](papercraft.js) draws gallery `style` 0; see the
[catalog](catalog.md) for the commands.
