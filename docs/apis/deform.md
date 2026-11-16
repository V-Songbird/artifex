---
type: api_spec
summary: "Defines core/deform.js: a filled outline meshed once and bent each frame by a few pins, every small piece keeping its form; read when a drawn shape must bend, sway or squash without bones."
related_files: ["core/deform.js", "core/mesh.js", "core/geom.js", "tests/deform.test.js", "skills/artifex/reference/geometry-fields.md"]
---

# Shapes bent by pins

Import helpers from `core/deform.js`. A hinged figure bends only at its joints. A painted shape, such as a leaf, a sleeve, a tail or a whole body drawn as one outline, should bend along its length. Mesh the outline once, pin a few of its points, move the pins by the playhead, and the rest of the shape follows: each small piece turns as it must but keeps its size and form as nearly as it can, after Sorkine and Alexa (2007).

| Function | Returns |
| --- | --- |
| `shapeMesh(outline, spacing)` | A mesh for a filled outline, a ring of `[x, y]` points with the closing point not repeated: `{ points, triangles, outline }`. The edge is resampled every `spacing` units and points `spacing` apart fill the inside. `outline` lists the indices of the edge points in order. |
| `deformer(mesh)` | A function `bend(pins, opt)` for that mesh. |
| `riders(mesh, places)` | A function `ride(bent)` that ties `places`, `[x, y]` points on the rest shape, to the mesh: for each place it gives `{ x, y, turn, scale }` on the bent mesh, where it now lies, how far its piece of the shape has turned, in radians, and how much that piece has grown or shrunk. A place outside every triangle rides the nearest one. |

`bend(pins, opt)` takes `pins`, a list of `[index, [x, y]]` that puts mesh point `index` at `[x, y]`, and returns every point's new place in the mesh's order. `opt.rounds` (default 8, from 1 to 200) is how many times the pieces are turned and the points moved; a large bend needs more. Pins are held exactly. With no pin the rest shape comes back; with one, the shape moves whole.

It is frame-pure: each call starts from the rest shape, so a frame depends on its own pins alone and a film replays exactly. The bent outline is `mesh.outline.map((i) => bent[i])`, to fill and stroke as any path, on a canvas or in an SVG. The triangles carry anything else that must ride the shape: a texture, a pattern, marks placed inside it.

```js
const { shapeMesh, deformer } = require('artifex/core/deform.js');
// in a build stage: the mesh and its deformer, made once
s.mesh = shapeMesh(outline, 12);
s.bend = deformer(s.mesh);
// in draw: pins from the playhead
const bent = s.bend([[s.foot, s.mesh.points[s.foot]], [s.tip, [tipX(t), tipY(t)]]]);
g.beginPath();
s.mesh.outline.forEach((i, k) => (k ? g.lineTo(...bent[i]) : g.moveTo(...bent[i])));
g.closePath();
g.fill();
```

Marks painted on the shape ride it through `riders`: place each mark once on the rest shape, give it its length, lean and colour from `R` by its index, and in every frame draw it at `ride(bent)[i]`, turned by `turn` and sized by `scale`. The mark keeps its spot on the thing, so a painted film neither swims nor is painted afresh each frame.

Pick a pin's index as the mesh point nearest a place on the rest shape. Two pins close together hold a direction as well as a place, as a foot planted on the ground does. A single pin dragged far crumples the mesh beside it; pin a second point near it, or spread the pull over two pins.

The cost of one bend grows with the points times `rounds`. A smaller `spacing` bends more smoothly and costs more.

Run `node --test tests/deform.test.js` for the mesh, rest, whole moves, turns, bends and refusals.
