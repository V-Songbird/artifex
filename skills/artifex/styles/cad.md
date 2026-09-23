---
type: knowledge
summary: "How to draw the CAD style: a model-space technical drawing with aligned views, layer colours, dimensions, a section, a detail and a title block; read before making or adapting a CAD piece."
related_files: ["skills/artifex/styles/cad.js"]
---

# CAD drawing

A technical drawing as a CAD package shows it in model space, with no interface
at all. Gallery `style` 2.

## What makes it read as CAD

- A dark model background, `#212830`, and one colour per layer.
- Orthographic views that line up: third-angle top view above the front view, a section beside it.
- Real dimensions computed from the geometry, with filled arrowheads and extension lines that leave a gap at the object.
- Stroke-font text, like a CAD package's SHX fonts; a sheet frame with zones; a title block.
- Nothing else: no paper texture, halftone or collage.

## Layers

| Layer | Colour | Width | Dash |
| --- | --- | --- | --- |
| object | `#ffffff` | 2.4 | solid |
| hidden | `#ffff00` | 1.4 | 9 5 |
| centre | `#ff0000` | 1.2 | 26 5 5 5 |
| phantom | `#ff00ff` | 1.3 | 26 5 5 5 5 5 |
| dimension | `#00ffff` | 1.2 | solid |
| hatch | `#808080` | 1 | solid |
| cutting plane | `#00ff00` | 2.8 | 30 6 6 6 |
| construction | `#7d8996` | 1 | 4 4 |
| text | `#ffff00` | 1.4 | solid |

## Recipe

1. Frame: outer rectangle 15 to 985, inner 35 to 965 at width 2.6, zone ticks every 232.5 with numbers 1 to 4 and letters A to D.
2. All views share one mapping, 200 units per subject unit: front at (300, 510); top at (300, 205) with depth downward; section at (740, 510) with depth to the right; detail at (780, 190) at 2:1.
3. Visible outlines: fill with the background colour, then stroke, back to front, so what lies behind is hidden. Draw hidden edges after the parts they pass behind.
4. Section: find where the cutting plane crosses the body (`spanAt`), draw that span as an ellipse and hatch it at 45 degrees, spacing 9. Hatch other parts at -45 degrees, spacing 6. Show what lies beyond through an even-odd clip that excludes the section.
5. Cutting plane: the dashed green line, thick 18-unit ends, arrows in the viewing direction, a letter at each end, placed clear of other geometry.
6. Detail: a thin circle on the front view with a leader and a letter; the same geometry at 2:1 inside a clipped circle, with its own dimensions.
7. Dimensions (`dimH`, `dimV`, `dimAngle`, `leader`): extension lines start 4 units from the object and run 6 past the dimension line; arrowheads 12 long and 3.2 half-wide; text 13 high, 11 units off the line; vertical text reads bottom to top.
8. Symbols the stroke font lacks: draw the degree sign as a small circle and the diameter sign as a circle with a slash.
9. Notes in the text layer at size 11; title block with 7-unit grey labels and 12-unit yellow values.

## Pitfalls

- `path()` starts a new path; build an even-odd clip from `g.rect` and `sub()`.
- Keep annotations off the object: move a cutting plane or a label before text crosses geometry.
- Compute every value from the geometry; typed numbers drift from the drawing.

## Any subject

Supply a side outline, a top outline and the section at the cut. The layers,
dimensions, frame, notes and title block are generic.

## Reference

[`cad.js`](cad.js) draws gallery `style` 2; see the [catalog](catalog.md) for
the commands.
