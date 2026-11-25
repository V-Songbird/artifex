---
type: api_spec
summary: "Defines core/solid.js: solids modelled once, a camera, the outline, crease and boundary lines a drawing shows with hidden parts cut away, and the exact outline of ellipsoids and their convex hulls, and rays cast at the solids for shadows and occlusion; read when a piece must draw an object from a chosen angle."
related_files: ["core/solid.js", "core/mesh.js", "core/geom.js", "core/clip.js", "core/delaunator.js", "tests/solid.test.js", "skills/artifex/reference/geometry-fields.md"]
---

# Solids drawn as lines

Import helpers from `core/solid.js`. A piece models an object once, in a space where z is up, picks a camera, and gets back paths in the picture for its own marks to draw: a pen, a pencil, ink, any style. Turn the camera and the same model gives another drawing. Nothing is filled or shaded here, but [rays](#rays) cast at the same solids tell a piece how much light or sky reaches a point, for it to tone as it likes; for pixels lit by rays through signed distances, see the `render-3d` style.

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

## Rays

`bvh(solids)` sorts the faces of `solids` into a tree of boxes, once, so that each ray tests the few faces near its path, not all of them. Build it again when the solids move. It returns `{ bounds, intersect, occluded, ao, softShadow }`; `bounds` is `{ min, max }` round every face, or `null` for no faces.

| Function | Returns |
| --- | --- |
| `intersect(origin, dir, near, far)` | The first face the ray from `origin` along `dir` meets between `near` (default `1e-6`) and `far` (default `Infinity`), as `{ t, point, normal, solid, face }`, or `null`. `t` is the distance along `dir`, made unit length; `normal` is the face's flat outward normal; `solid` and `face` are indices into `solids` and its `faces`. |
| `occluded(origin, dir, near, far)` | Whether any face lies on the ray between `near` and `far`: quicker than `intersect` when the answer is all a piece needs, such as whether a point sees the sun. |
| `ao(point, normal, R, id, opt)` | How open the sky is over `point` on a surface facing `normal`, from 0 (closed in) to 1 (nothing above within `opt.radius`, default 1): the share of `opt.samples` rays (default 16, from 1 to 64), spread over the half sphere as light falls on a matt surface, that reach `opt.radius` without meeting a face. |
| `softShadow(point, normal, toLight, R, id, opt)` | How much of a light in direction `toLight` reaches `point`, from 0 to 1: the share of `opt.samples` rays (default 8, from 1 to 64), aimed within `opt.spread` (default 0.05, about the tangent of the light's angular radius) of it, that meet no face before `opt.far` (default `Infinity`). A `spread` of 0 is a hard shadow. |

`ao` and `softShadow` take their directions from `R`, the piece's random source, under the entity names `'bvh-ao'` and `'bvh-shadow'`, and `id`, a whole number from 0 to 2^25 - 1 that keeps each point's directions its own: give each point you sample its own `id`, and the same seed gives the same tone. Both nudge `point` `1e-4` along `normal` so that the surface does not shadow itself; `near`, `far`, `radius` and the nudge are in the model's own units, so a model far larger or smaller than a few units wide should set them to match.

A face counts from either side: a ray from inside a solid meets the face it leaves by. A face's normal is the flat one of its plane, the same for every point on it, even on a cylinder's curved side. A face of more than four points is cut along its own outline, so the hollow of a prism's ring is open, as in `outlines`; a face of four points is split along one diagonal, so keep four-point faces convex.

The camera gives no ray through a pixel, so cast from the points a piece already has: a face's middle, the points along an outline, the eye.

```js
const { box, cylinder, bvh } = require('artifex/core/solid.js');
const { rng } = require('artifex/core/rand.js');
const solids = [box([10, 10, 0.2], [-5, -5, -0.2]), box([2, 2, 3]), cylinder(0.6, 2, { at: [4, 3, 0] })];
const rays = bvh(solids), sun = [-0.4, -0.6, 0.7], R = rng(7);
// The ground's tone at a point: dark in a shadow, darker where the sky is closed in.
const tone = (p, i) => 0.3 + 0.7 * rays.softShadow(p, [0, 0, 1], sun, R, i) * rays.ao(p, [0, 0, 1], R, i, { radius: 3 });
```

Limits: everything here is a test of whole rays against flat faces; nothing is lit, coloured or drawn. The tones come from samples, so they are noisy at a few samples and smooth only at many: average neighbouring points or take more samples for a still.

Run `node --test tests/solid.test.js` for the camera, the edge kinds, hiding, the smooth outlines against analytic circles and ellipses and against sampled surfaces, rays against a test of every face, open sky against an open floor, a wall and a closed box, and the refusals. The tests do not establish that a drawing reads well.
