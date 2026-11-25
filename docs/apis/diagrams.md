---
type: api_spec
summary: "Defines core/diagram.js: a radar, a timeline, a layered graph (flow chart or state diagram) and a sankey laid out from data as geometry only, with text measured by the caller; read when a piece draws one of these diagrams in any style."
related_files: ["core/diagram.js", "tests/diagram.test.js", "skills/artifex/reference/data-images.md"]
---

# Diagrams

Import helpers from `core/diagram.js`.

Each function lays a diagram out from its data and returns geometry: points, boxes and polylines in design units. None draws. The piece draws that geometry with its own marks, so one layout serves a pencil sketch, a print or a film where the diagram builds on screen. The data comes from the piece, never from the seed: the same rows give the same layout on every run.

Text is measured by the caller. Pass `measure(label)`, returning `[width, height]` in design units for the lettering the piece draws: with the stroke font, `(label) => [font.width(label, size), size]`. Boxes then fit their labels and labels keep clear of one another.

Bad input throws `RangeError`, naming the diagram and the value.

| Function | Returns |
| --- | --- |
| `radar(values, { centre, radius, max, gap })` | Three or more values, numbers or `{ name, value }`, one spoke each from `centre`, the first pointing up and the rest clockwise. `max` (default the largest value) reaches `radius`. Returns `spokes`, each `{ name, value, angle, tip, at, label }` with `tip` at the radius, `at` the value's point and `label` a point `gap` (default a tenth of the radius) past the tip; `shape`, the closed polygon through every `at`; and `ring(k)`, the polygon at share `k` of the radius, for the grid. |
| `timeline(events, { from, to, t0, t1, measure, gap, lane })` | `{ t, label }` rows along the line `from` to `to`, which holds the times `t0` to `t1` (default the first and last event). Each label starts at its event and takes the nearest lane where it stays `gap` (default 8) clear of the label before it; lanes alternate sides of the line, further out as they fill. Returns `axis`, `[from, to]`; `events`, each `{ t, label, at, lane, side, anchor, size }`, with `at` on the line, `side` 1 or -1, `anchor` the label's place `lane + 1` steps of `lane` (default 1.6 label heights) off the line; and `tick(t)`, the point of any time. The line may slant. |
| `layered(nodes, edges, { measure, direction, pad, gap })` | A flow chart or a state diagram. `nodes` are `{ id, label }`, or `{ id, w, h }` for a size of their own; `edges` are `{ from, to, label }` by id. Nodes are ranked so edges run one way, `direction` `'down'` (default) or `'right'`, and ordered within a rank to cut crossings. A box is its measured label plus `pad` (default 12) all round; `gap` is `[between ranks, between boxes]` (default `[48, 28]`). An edge that closes a cycle runs back round the far side in a lane of its own, and an edge from a node to itself loops there. Returns `nodes`, each `{ id, label, x, y, w, h, rank }` by its top left corner from (0, 0); `edges`, each `{ from, to, label, path, at, back }`, with `path` a polyline of level and plumb runs from the source's edge to the target's and `at` its middle, for the edge's label; and `size`, the layout's extent. |
| `sankey(nodes, flows, { box, nodeWidth, gap, samples })` | `flows` are `{ from, to, value }` between `nodes` `{ id, label }`, laid in `box`, `[x, y, w, h]`. A node stands in the column its longest chain of flows reaches, `nodeWidth` (default 14) wide and as tall as the larger of what enters and what leaves it, `gap` (default 10) from the next; one scale serves every column. Returns `nodes`, each `{ id, label, x, y, w, h, value, column }`; `ribbons`, each `{ from, to, value, outline, spine, width }`, with `outline` the closed band from the source's right edge to the target's left, `spine` its centre line and `width` its thickness, for a style that strokes rather than fills; and `scale`, design units per unit of value. A flow that closes a cycle is refused. |

`layered` returns a layout from (0, 0): place it with a translate, and make it smaller by measuring and drawing smaller text, not by scaling the canvas, which would thin the style's lines.

What these layouts do not do: an edge that spans several ranks runs straight through the ranks between and can pass behind a box there; a sankey does not reorder columns to shorten ribbons beyond four sweeps; a radar has one series, so a second series is a second call with the same `max`. A piece that needs more draws its own geometry.

Run `node --test tests/diagram.test.js` for the spokes and rings of a radar, the lanes of a timeline, the ranks, boxes, paths and way back of a layered graph, and the heights, widths and stacking of a sankey, with each refusal.
