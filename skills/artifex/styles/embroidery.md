---
type: knowledge
summary: "How to draw the embroidery style: satin-stitch zigzag fills and thread outlines with an edge and a sheen on dark cloth; read before making or adapting an embroidery piece."
related_files: ["skills/artifex/styles/embroidery.js", "skills/artifex/styles/kit.js"]
---

# Embroidery

Bright thread on dark cloth: satin-stitch fills and couched outlines. Gallery
`style` 4.

## What makes it read as embroidery

- Fills are dense back-and-forth zigzags clipped to each shape, with a second, crossing pass of lighter thread.
- Every strand has a dark under-edge and a dashed light sheen offset toward the light.
- A dark cloth ground with a faint diagonal weave.
- A hand's wobble on every line.

## Recipe

1. Ground `#10153a`; 340 short dashes, 8 to 16 long, at -1.15 radians plus or minus 0.12, in pale blue at alpha 0.07.
2. `zigzag(poly, angle, spacing)` lays a boustrophedon across the shape's bounding circle. `wobble` it with amplitude 2.4 and step 12, clip to the shape, and stroke it 6 to 8 wide in the thread colour over a 45% underfill of the dark tone.
3. The crossing pass: angle + 0.55, spacing x 1.7, width x 0.35, the light tone at alpha 0.35.
4. `marker(pts, [body, dark, light], width)`: stroke the dark tone offset (2, 2.5) at the full width; the body at 0.78 of it; then the light tone at 0.13 of it, dashed [2.4 w, 0.8 w], offset (-0.15 w, -0.15 w), alpha 0.7.
5. Outlines: `marker` along a wobbled outline, amplitude 2 and step 10.
6. Accents in the same thread: notes, sound arcs, leaves with veins, a heart; sparkles are white stars with a glow, shadow blur 12.

## Palette

Thread triples are body, dark and light.

| Thread | Body | Dark | Light |
| --- | --- | --- | --- |
| purple | `#8a4fd8` | `#4b2a86` | `#c6a3f7` |
| red | `#ef4a3c` | `#9e2a22` | `#ff9a86` |
| yellow | `#f7c52b` | `#a47a0c` | `#fff0a8` |
| green | `#3dbb58` | `#1f7a35` | `#9be8aa` |
| blue | `#2e8ee6` | `#1a5494` | `#9fd0fa` |
| orange | `#f6892a` | `#a4520f` | `#ffd0a0` |
| brown | `#8a5a3c` | `#4f3122` | `#c69a78` |

## Pitfalls

- Thin, sparse strokes on light paper read as a doodle, not thread; keep fills dense and the ground dark.
- The sheen must sit on one side of every strand, or the thread looks flat.

## Any subject

Split the subject into shapes, give each a thread triple and a stitch angle, and
fill with `scribble` before outlining with `marker`.

## Reference

[`embroidery.js`](embroidery.js) draws gallery `style` 4; see the
[catalog](catalog.md) for the commands.
