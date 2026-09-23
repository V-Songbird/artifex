---
type: knowledge
summary: "How to draw the 3D render style: a signed-distance subject raymarched per pixel with soft shadows, occlusion and specular light; read before making or adapting a 3D piece."
related_files: ["skills/artifex/styles/render-3d.js"]
---

# 3D render

A soft-lit render of a smooth toy-like subject on a pedestal, raymarched per
pixel. Gallery `style` 1.

## What makes it read as 3D

- Smooth shading across curved surfaces. Flat-shaded low-poly facets read as folded paper instead.
- Specular highlights, a rim of light, and soft contact shadows.
- A pedestal or ground that the subject shadows, fading into a gradient backdrop.

## Recipe

1. Geometry as signed distances: ellipsoids with the bound k0(k0 - 1)/k1, spheres, capsules and a rounded-cylinder pedestal. Blend soft parts with a polynomial smooth minimum: k 0.2 for body and head, 0.08 for the tail, 0.03 for the wings. Keep crisp parts with plain `min`: beak, eyes, legs.
2. Rotate a part by transforming the sample point with the inverse rotation.
3. Camera at (2.25, 1.55, 3.45) looking at (0.05, 0.62, 0), focal length 3.4; right is forward x up.
4. Per pixel, intersect the ground plane analytically and a bounding sphere, centre (0.02, 0.62, 0) and radius 1.32. March only inside the sphere: up to 180 steps of 0.9 x distance, hit when the distance is below 0.0006 x (1 + t).
5. Normal by the tetrahedron technique, epsilon 0.0015. The material is the part with the smallest distance at the hit.
6. Key light from (-0.45, 0.85, 0.55), colour (1.35, 1.27, 1.16). Soft shadow marched toward it: factor 9, 64 steps, step clamped to 0.008 to 0.15, then smoothstep.
7. Occlusion: five samples along the normal at 0.015 + 0.05 i, weights falling by 0.75, result 1 - 1.6 x occlusion with a floor of 0.3.
8. Ambient between a warm bounce (0.36, 0.3, 0.26) and sky (0.42, 0.55, 0.7) by the normal's height. Rim light from (-0.55, 0.35, -0.75), squared, times 0.35. Blinn-Phong specular per material. Fresnel to the fifth power times 0.3 of the sky.
9. Ground fog: mix toward the backdrop by 1 - exp(-0.12 x max(0, t - 4)).
10. Tone map 1 - exp(-1.1 c), then convert linear light to sRGB.
11. Silhouettes: after one pass, re-shoot every pixel whose material differs from a four-neighbour with four rotated-grid samples.
12. Write pixels with `putImageData` at the canvas's own size, then draw vector overlays.

## Materials

| Part | Albedo | Shininess | Specular |
| --- | --- | --- | --- |
| ground | `#efe3d6` | none | none |
| pedestal | `#8fd0c3` | 25 | 0.2 |
| body | `#f6eddf` | 40 | 0.35 |
| wings and tail | `#ef6f55` | 30 | 0.3 |
| beak | `#f4a13a` | 60 | 0.45 |
| eyes | `#17131c` | 220 | 1.3 |
| legs | `#ea8a36` | 30 | 0.3 |

A blush, `#f3a0a0`, fades into the body within 0.11 of each cheek. The
backdrop runs from `#a9d4e8` at the top to `#f9e7d7`.

## Pitfalls

- Occlusion without a floor turns contact creases black.
- Ellipsoid distances are bounds, not exact: step 0.9 of the distance.
- `putImageData` ignores the transform; size the image from `g.canvas`.
- Cost follows pixel count: about 0.85 s at 480 pixels in Edge, four times that at 960.

## Any subject

Build the subject from primitives with smooth unions, keep it inside one
bounding sphere, and give each part a material id. Lighting, pedestal and
backdrop carry over unchanged.

## Reference

[`render-3d.js`](render-3d.js) draws gallery `style` 1; see the
[catalog](catalog.md) for the commands.
