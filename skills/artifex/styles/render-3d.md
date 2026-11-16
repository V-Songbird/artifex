---
type: knowledge
summary: "How to draw 3D render's marks with the functions in render-3d.js, and how work in 3D render is composed, lit, coloured and moved; read before making a piece in 3D render."
related_files: ["skills/artifex/styles/render-3d.js", "skills/artifex/styles/kit.js"]
---

# 3D render

## Contents

- [What makes it read as a 3D render](#what-makes-it-read-as-a-3d-render)
- [Marks](#marks)
- [Creative direction](#creative-direction)
- [Palette](#palette)
- [Pitfalls](#pitfalls)

A soft-lit computer render of smooth solid forms, the look of CG animation
and toy product shots. Here every pixel is raymarched through signed-distance
geometry and lit by a small studio rig.

## What makes it read as a 3D render

- Smooth shading across curved surfaces. Flat-shaded low-poly facets read as folded paper instead.
- Forms blend into each other with soft fillets, like moulded plastic or clay.
- Specular highlights sized by each material's gloss, and a cool rim of light on the far edges.
- Soft contact shadows and darkened creases wherever forms touch or nearly touch.
- Distance fades into the backdrop's colour; edges are clean and anti-aliased.

## Marks

Order: build the geometry as one distance function, set a camera, then per
pixel march the ray, find the normal and material, light it, fog it, tone map
it, and write the image with `raster`. Draw vector overlays last.

**Geometry.** Write `sdf(x, y, z)`, y up, from the primitives. Move a part by
subtracting its position from the point, and turn it by applying the inverse
rotation to the point.

- `sphere(x, y, z, r)`, `ellipsoid(x, y, z, a, b, c)`, `capsule(x, y, z, ax, ay, az, bx, by, bz, r)` and `roundCylinder(x, y, z, r, h, k)` give the distance to one primitive at the origin. Ellipsoids are bounds, not exact distances, so march them at 0.9 of the distance. Capsules make limbs, stems and rods; a rounded cylinder makes a disc, a plinth or a button.
- `smin(a, b, k)` is a polynomial smooth union. Use k 0.2 to merge soft masses into one form, and 0.03 to 0.08 to join a small part with a fillet. Plain `Math.min` keeps a crisp seam, for parts that are separate pieces, such as a bead or a button.
- Give each part a material id. At a hit, the material is the part with the smallest distance.

**Rays.**

- `camera(ro, ta, focal)` aims a pinhole camera from `ro` at `ta`. A focal of 3.4 is a long lens with gentle perspective; 1.5 to 2 is wide and dramatic. `ray(cam, sx, sy)` gives the direction through screen point (sx, sy), both -1 to 1 across the width.
- `span(ox, oy, oz, dx, dy, dz, bound)` clips a ray to a bounding sphere `[cx, cy, cz, r]`. Keep the whole subject inside one sphere and march only inside it. Intersect a flat ground plane analytically: t = -oy / dy.
- `march(sdf, ox, oy, oz, dx, dy, dz, near, far, { steps, relax, eps })` sphere-traces: up to 180 steps of 0.9 x distance, a hit when the distance falls under 0.0006 x (1 + t). It returns t, or Infinity on a miss.
- `normal(sdf, x, y, z, e)` takes the normal by the tetrahedron technique, e = 0.0015.

**Light.** Work in linear light: convert colours with `lin(hex)`.

- `softShadow(sdf, px, py, pz, l, bound, opts)` marches toward the light from a point nudged 0.004 along the normal. The penumbra factor `k` is 9: higher is harder, about 4 is very soft. It takes 64 steps clamped to 0.008 to 0.15 and ends with a smoothstep. March it only when the surface faces the light, and use the sdf without the ground.
- `occlusion(sdf, px, py, pz, nx, ny, nz, { strength, floor })` takes five samples along the normal at 0.015 + 0.05 i, each weighted 0.75 of the last. It returns 1 - 1.6 x occlusion, floored at 0.3. Pass the sdf with the ground, so contacts darken.
- `lit(n, v, albedo, mat, shadow, ao, rig)` combines a Lambert key times its soft shadow, a hemisphere ambient from a warm ground bounce up to the sky colour, a squared rim and Blinn-Phong specular. With `mat.fresnel` it adds a fifth-power Fresnel sheen of the sky; use that on objects, not on the ground. `v` points from the surface to the eye; `mat` is `{ spec, shine, fresnel }`.
- `STUDIO` is the default rig. Its key comes from (-0.45, 0.85, 0.55), colour (1.35, 1.27, 1.16). Its sky fill is (0.42, 0.55, 0.7) over a bounce of (0.36, 0.3, 0.26), times 0.9. Its rim comes from (-0.55, 0.35, -0.75), colour (0.55, 0.65, 0.85), times 0.35, and its Fresnel is 0.3. Copy it and change the colours for another mood: a warmer key and a cooler fill read as late sun.
- `fog(col, sky, t, { start, density })` mixes toward the backdrop by 1 - exp(-0.12 x max(0, t - 4)). Use it on the ground so the floor melts into the backdrop.
- `backdrop(top, low, v, power)` gives a vertical gradient by screen height, with a power of 0.8.
- Clay, wax and soft plastic let light in past the terminator. Add a warm wrap term to `lit`'s result: the albedo times a warm tint, such as (1, 0.45, 0.3), times about 0.35 × (max(0, (n·L + 0.45) / 1.45) − max(0, n·L) × shadow) × occlusion. It warms the edge of the shadow without lifting it.

**Pixels.**

- `encode(c, exposure)` tone maps 1 - exp(-1.1 c) and converts linear light to an sRGB byte.
- `pixelSize(g, w, h)` gives the canvas's real pixel size, because `putImageData` ignores the transform.
- `raster(g, width, height, shoot)` calls `shoot(px, py, out)` once per pixel centre. `shoot` returns sRGB bytes and sets `out.id` to the material it saw. Then `raster` shoots every pixel whose id differs from a four-neighbour again, at four rotated-grid points, and averages them. That anti-aliases every silhouette and material edge without shooting every pixel four times.
- A background out of focus behind a sharp subject: march the background alone at a sixth of the canvas size, blur it with two passes of a 5-wide box across and down, and return a bilinear sample of it from `shoot` wherever the ray misses the subject's bound or the subject, with `out.id` 0. The subject's silhouette is still anti-aliased against it, and the background costs about a thirtieth of a full-size march.

**Materials** by kind, as shininess and specular strength for `lit`:

| Kind | Shininess | Specular |
| --- | --- | --- |
| matte floor, paper, felt | 1 | 0 |
| satin plastic, painted wood | 25 to 40 | 0.2 to 0.35 |
| glossy plastic, glaze | 60 | 0.45 |
| wet or glass bead | 220 | 1.3 |

## Creative direction

**Where it comes from.** Computer-generated imagery: the soft-lit, smoothly
modelled look of 3D animated films since the mid-1990s, and of toy and product
renders. Signed-distance raymarching comes from real-time shader art, where
a whole scene is a few formulas.

**What it shows.** Toys, characters, stylised animals, food, small worlds on
a tabletop and objects as products. Smooth, moulded forms show off the light.
It rarely shows rough natural texture, hair, cloth folds or large crowds, all
costly or unconvincing here, so any of them is a surprise worth the effort.

**Composition.** Think as a photographer of small things: a long lens, a low
camera near the subject's eye height and a clear silhouette against an
uncluttered backdrop. One subject with a contact shadow beneath it grounds the
picture. A ground plane that fades into the backdrop gives an endless studio
sweep. A wide lens close to the subject exaggerates its forms and feels playful.

**Value, colour and light.** Three-point lighting: a warm key from above and
to one side makes the form, a cool fill from the sky lifts the shadows, and a
rim from behind separates the silhouette. Keep saturated colour in the
albedos and let the light stay near white. Soft shadows and occlusion carry
the sense of weight. Pastel backdrops with soft plastic albedos read as toys;
dark backdrops with one hard key read as drama.

**Motion and time.** Animation follows the principles Disney's animators set
down: ease in and out, anticipation, squash and stretch, follow-through and
overlap. A smooth distance field can squash and stretch for free by scaling
the point. Film runs at 24 frames a second, games at 30 or 60. The camera can
orbit, dolly and rack focus, but keep its moves slow and eased. Each frame
renders the same way, so nothing flickers. Things that break the illusion:
forms passing through each other, a subject without a contact shadow
(floating), perfectly linear motion and a light that jumps between shots.
Raymarching costs per pixel, so a film at full size is slow: preview small.

**Drawing order.** Shown being made: blocked-in forms, then the light, then a
progressive render that clears from noise to a clean image
([draw the drawing](../reference/films.md#draw-the-drawing)).

**Study**

- Pixar, *Luxo Jr.* (1986), for one key light, contact shadows and character told by motion alone.
- Pixar, *Toy Story* (1995), for plastic and painted materials and the toy-sized camera.
- Inigo Quilez's articles on distance functions and his Shadertoy work, for smooth unions, soft shadows and lighting with signed distances.
- Frank Thomas and Ollie Johnston, *The Illusion of Life: Disney Animation* (1981), for the principles of timing and weight.

**Levers**

- Blend: wide smooth unions read soft and toylike; crisp unions read machined.
- Gloss: matte albedos read as clay or felt; high shininess reads as glazed or plastic.
- Penumbra: a low shadow factor reads as overcast and gentle; a high one reads as sun.
- Lens: long and low reads as a product shot; wide and close reads as a caricature.
- Rig colour: warm key and cool fill read as day; one cold key on a dark backdrop reads as night or theatre.
- Fog: a short fog distance gives a dreamy, endless sweep; none gives a hard-edged set.

## Palette

| Role | Colours |
| --- | --- |
| backdrop pairs, top to low | `#a9d4e8` to `#f9e7d7`; `#d8cbef` to `#fbeedd`; `#f3cdbd` to `#fdf1e6`; `#bfe0d2` to `#f8efe0` |
| warm studio floor | `#efe3d6` |
| soft plastics | `#8fd0c3` `#c7b6ea` `#f4c3a6` `#f2b3b8` `#86b6e6` `#f6d65a` |
| saturated accents | `#ef6f55` `#f08a2c` `#3e6fc2` `#5f9a5c` `#f4a13a` `#ea8a36` |
| creams and darks | `#f6eddf` `#f3ece0`, near-black `#17131c` for small glossy details |

Pick one backdrop pair, one soft plastic for the largest form and one accent.
A blush or tint fades into an albedo over a small radius rather than ending
at a hard line.

## Pitfalls

- Occlusion without a floor turns contact creases black.
- Ellipsoid distances are bounds, not exact: a step of 0.9 of the distance keeps the march from overshooting and showing holes.
- `putImageData` ignores the transform; `pixelSize` sizes the image.
- Cost follows pixel count: about 0.85 s for a 480-pixel square in Edge, four times that at 960. The film export drew a 1280 × 720 design at 1920 × 1080, and a figure of about fifteen blended primitives with soft shadows and occlusion took about 6 s a frame in Chromium: 14 minutes for 6 s at 24 fps, past the export's ten-minute deadline. Raise it with `npm --prefix "<library root>" run film -- --timeout-ms` (up to an hour), or film at a smaller `--scale`.
- Anti-aliasing follows material ids: `raster` shoots again only pixels whose id differs from a four-neighbour, so a part drawn over another part of the same id keeps a stair-stepped edge. Give every part that can overlap another its own id, even when both share a colour.
- A backdrop goes through `encode`'s tone curve like everything lit, so a hex chosen by eye shows darker: `#a9d4e8` from the palette below shows as `#a0beca`, and `#e483bb` as `#c781ae`. For a colour that must show as picked, pass `-Math.log(1 - v) / exposure` of each linear channel `v` instead of `lin(hex)`.
- A model checked only through the shot's camera can be built for one side. Before the export, render a frozen pose with the camera orbiting the subject: a missing far eye, a part floating off its body or a mark that does not turn with its surface shows at once.
- Doing the light in sRGB instead of linear light makes the shading muddy and the highlights grey.
- A shadow ray that includes the ground plane shadows the ground itself; shadows marched against the objects only keep it lit.
