---
type: knowledge
summary: "How to draw the sticker style: die-cut vinyl borders that follow the art, one soft shadow per sticker, bold outlines and a peeling label; read before making or adapting a sticker piece."
related_files: ["skills/artifex/styles/sticker.js", "skills/artifex/styles/kit.js"]
---

# Sticker

Die-cut vinyl stickers lying on a cutting mat. Gallery `style` 5.

## What makes it read as a sticker

- A white vinyl border, 16 to 26 units, that follows the art's own outline.
- One soft shadow under each whole sticker, and a faint rim at the border's edge.
- Bold dark outlines, flat fills, a cel shade, a white highlight; eyes with two highlights.
- A surface for context, here a cutting-mat grid, and one sticker peeling to show its backing.

## Recipe

1. Mat `#e8e3f4`; grid lines every 50 at alpha 0.14 and every 250 at alpha 0.26; ruler ticks along the top; light grain.
2. `dieCut(parts, border)`: stroke the union of all parts once, at width 2 x border, in white under the shadow rgba(52, 36, 92, 0.30), blur 22, offset (5, 12). Then stroke a rim at 2 x border + 3 in rgba(60, 40, 110, 0.13), the white border again, and fill every part white.
3. `inked(parts, fill, w)`: stroke every part at 2w in the line colour `#2b2340`, then fill every part. Only the group's outer edge keeps a line.
4. Art on the main sticker: flat fills; a darker ellipse clipped to the body as the cel shade; a pale belly patch; a narrow gloss band at alpha 0.13; a white highlight arc, width 10 at alpha 0.85; outline width 7.
5. Eyes: a dark ellipse 0.068 by 0.085 of the subject's scale, with white highlights of radius 0.028 and 0.013.
6. Small stickers around it: a star with a face, a musical note, a speech bubble with thick stroke-font text (size 40, width 7).
7. Peel: split the sticker by a fold line. `cutBy` keeps the part on one side; draw that normally inside a clip. Mirror the removed part across the fold (`mirror`) and fill it with a gradient from `#f6f3fb` to `#cfc7e2` under a small shadow.

## Palette

| Role | Colours |
| --- | --- |
| mat, line | `#e8e3f4`, `#2b2340` |
| main sticker | body `#ffcf5c`, belly `#fff0bf`, wing and tail `#ff7a59`, beak `#ff9f1c`, blush rgba(255, 143, 163, 0.9) |
| small stickers | star `#ffd23f`, note `#2ec4b6`, bubble `#8fdcf0`, label `#ff6b8b` |

## Pitfalls

- Two shadowed draws, such as a fill and a stroke, darken where they overlap: cast each sticker's shadow from one stroke of the union.
- A stroke is not a fill: fill every part white as well, or large parts show mat through the border.
- Thin text vanishes against the border; use stroke widths of 7 to 8 at size 40.

## Any subject

Pass the subject's parts as the union for `dieCut`, then draw its art inside.
The border, shadow, mat and peel are generic.

## Reference

[`sticker.js`](sticker.js) draws gallery `style` 5; see the
[catalog](catalog.md) for the commands.
