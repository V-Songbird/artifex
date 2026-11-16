---
type: api_spec
summary: "Defines core/solid.js: solids modelled once, a camera, the outline, crease and boundary lines a drawing shows with hidden parts cut away, and the exact outline of ellipsoids and their convex hulls; read when a piece must draw an object from a chosen angle."
related_files: ["core/solid.js", "core/mesh.js", "core/geom.js", "core/clip.js", "core/delaunator.js", "tests/solid.test.js", "skills/artifex/reference/geometry-fields.md"]
---

# Solids drawn as lines

Import helpers from `core/solid.js`. A piece models an object once, in a space where z is up, picks a camera, and gets back paths in the picture for its own marks to draw: a pen, a pencil, ink, any style. Turn the camera and the same model gives another drawing. Nothing is filled or shaded here; for pixels lit by rays, see the `render-3d` style.

## Solids

| Function | Returns |
| --- | --- |
| `box(size, at)` | A box of `size` `[w, d, h]` whose low corner is `at` (default the origin). |
| `prism(ring, z0, z1)` | A ring of `[x, y]` points raised from `z0` to `z1`; with one height, from 0 to it. Any outline, hollows in its edge included. |
| `cylinder(r, h, opt)` | A cylinder standing on `opt.at` (default the origin), or a cone cut short when `opt.top` (default `r`) differs from `r`. `opt.sides` (default 24, from 3 to 720) flat faces count as one curved surface. |
| `loft(rings, opt)` | A solid from sections: rings of `[x, y, z]` points, each with the same number of points, joined in order, the first and last ring as its ends. Wind every ring counter-clockwise seen from the last ring's side. `opt.smooth: true` marks the sides as one curved surface. |
| `place(solid, opt)` | The solid turned by `opt.turn` radians about the z axis through `opt.about`, then moved by `opt.move`. A new solid. |

A solid is `{ points, faces }`: plain data, so a piece may build one of its own, each face a ring of point indices wound counter-clockwise seen from outside.

## Camera

`camera({ eye, target, lens, frame })` looks from `eye` at `target`, z up. `lens` (default 50) is the focal length for a frame 36 wide: 24 is wide, 100 is long. `frame` is `[x, y, w, h]` in design units; the target lands on its middle. It returns `{ eye, project, matrix }`; `project(p)` gives `[x, y, depth]`, with depth the distance in front of the eye, and `matrix` is the same projection as three rows of four, so that `matrix` times `[p, 1]` is `[x * depth, y * depth, depth]`. A camera cannot look straight up or down.

## Lines

`outlines(solids, cam, opt)` returns the lines a drawing shows, as paths `{ kind, points, depth, hidden }`:

| Kind | Where |
| --- | --- |
| `'silhouette'` | Where a surface turns away from the eye: an object's outline, and the two sides of a cylinder. |
| `'crease'` | Where two faces that both show meet at more than `opt.crease` degrees (default 20). The facets of a curved surface never crease among themselves. |
| `'boundary'` | Where a surface ends, on a solid that is not closed. |

`points` are `[x, y]` in the picture, joined end to end where lines of one kind meet. `depth` is the path's mean distance from the eye, so a piece can draw nearer lines heavier. Each line is cut where a nearer face hides it: it is tested every `opt.step` design units (default 2), which is also the least a hidden stretch can be. With `opt.hidden: true` the hidden stretches come back too, marked `hidden: true`, for a drawing that dashes them.

Limits: where two solids pass through each other, the line they meet along is not found, so let solids touch or stand apart. The work grows with the number of faces times the length of the lines over `step`; a model of a few hundred faces is quick, and a still or a build stage is the place for a larger one.

```js
const { box, cylinder, camera, outlines } = require('artifex/core/solid.js');
const solids = [box([4, 2, 1]), cylinder(0.4, 2, { at: [1, 1, 1] })];
const cam = camera({ eye: [9, -7, 5], target: [2, 1, 1], frame: [0, 0, 1200, 800] });
for (const path of outlines(solids, cam)) {
  g.lineWidth = path.kind === 'silhouette' ? 3 : 1.5;
  g.beginPath();
  path.points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.stroke();
}
```

## Smooth parts

Faceted solids show their facets' turns; a rounded form needs its exact outline instead. `ellipsoid(at, axes)` is the points `at + A s` with `|s| = 1`, where the columns of `A` are `axes`: three lengths `[a, b, c]` along x, y and z, or three `[x, y, z]` semi-axes, which need not be at right angles but must not lie in one plane. A sphere is `[r, r, r]`. It returns plain data, `{ at, axes }`, with `axes` as three vectors; it is not a solid for `outlines`.

`hullOutline(parts, cam, opt)` returns the outline in the picture of the smallest convex body that holds every ellipsoid in `parts`. One ellipsoid gives its own outline. Two spheres give the outline of both and the surface between them, a cone with rounded ends; more parts give the hull of all. The outline is exact up to sampling: each ellipsoid's outline comes from its dual conic through `cam.matrix`, so a sphere off the axis comes out as the ellipse a perspective camera sees, not a circle. Its points lie on the true outline, no further apart than `opt.step` design units (default 2) round each ellipsoid, and at most 4096 for one. It returns a ring of `[x, y]` points, the closing point not repeated, wound as `union` from `core/clip.js` winds its outer rings. It returns `null` when any part reaches the eye's plane or behind it, the eye inside included, because the outline is then no closed curve.

A form made of several parts is several hulls united: `union(rings)` merges them into one outline, since they all wind one way and their overlaps add rather than cancel. `offset(offset(merged, k, { join: 'round' }), -k, { join: 'round' })` rounds the creases where parts meet into fillets of radius about `k`.

Limits: nothing here hides or is hidden. A part behind another, or behind a solid from `outlines`, is still drawn whole, and a part's lines inside the united outline are the piece's to draw or leave out. The hull is convex, so a form that narrows between two wider ends is two hulls united, not one.

```js
const { ellipsoid, hullOutline, camera } = require('artifex/core/solid.js');
const { union, offset } = require('artifex/core/clip.js');
const cam = camera({ eye: [8, -10, 4], target: [0, 0, 1], frame: [0, 0, 1200, 800] });
const a = ellipsoid([0, 0, 1], [1, 1, 1]), b = ellipsoid([2.5, 0, 1.5], [0.5, 0.5, 0.5]);
const c = ellipsoid([-1.5, 0, 0.6], [[0.8, 0, 0.3], [0, 0.6, 0], [-0.2, 0, 0.5]]);
const rings = [hullOutline([a, b], cam), hullOutline([c], cam)].filter(Boolean);
const shape = offset(offset(union(rings), 6, { join: 'round' }), -6, { join: 'round' });
```

Run `node --test tests/solid.test.js` for the camera, the edge kinds, hiding, the smooth outlines against analytic circles and ellipses and against sampled surfaces, and the refusals. The tests do not establish that a drawing reads well.
