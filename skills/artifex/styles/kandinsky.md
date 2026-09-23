---
type: knowledge
summary: "How to draw the Kandinsky style: a subject assembled from haloed circles, rings, triangles, half discs, rainbow arcs, bars and crossing lines, glazed with multiply on warm paper; read before making or adapting a Kandinsky piece."
related_files: ["skills/artifex/styles/kandinsky.js", "skills/artifex/styles/kit.js"]
---

# Kandinsky

Geometric abstraction in the manner of Kandinsky. Gallery `style` 8.

## What makes it read as Kandinsky

- Circles with soft halos, and concentric rings.
- Triangles, half discs, rainbow arcs, heavy bars, chequer strips and small grids.
- Thin black lines and long arcs crossing the whole composition.
- Overlapping colour multiplies like glazes: `globalCompositeOperation = 'multiply'`.
- Warm paper with a slight vignette and grain.
- The subject is assembled from these forms, never drawn as an outline.

## How the demo subject maps to forms

| Part | Form |
| --- | --- |
| head | a circle with a radial gradient and a halo |
| eye | rings: white, a red ring, a black core, a glint |
| beak | a triangle, then a thin line ending in a small ring |
| body | a half disc with a linear gradient, glazed by a pink circle |
| wing | six concentric arcs, violet to red |
| tail | a heavy bar, three fanned lines, a chequer strip |
| legs and perch | lines ending in dots, a ruler with ticks |

## Recipe

1. Paper `#efe8d8` with a radial vignette to rgba(120, 95, 60, 0.16).
2. Halos first, as washes: radial gradients from a colour at alpha 0.14 to 0.35 down to transparent.
3. Long lines: one wide arc of radius 700, a heavy line of width 7, thin lines of width 2.5.
4. Inside a multiply block: the body's half disc, the glaze circle, the rainbow arcs (width 15, radii 72 + 15 i), the head circle, the beak triangle.
5. Back to normal compositing: a thin black arc beside the head, the eye rings, the tail bar (width 24), fanned lines (width 3), the chequer strip (14-unit squares, rotated along the bar), legs, the ruler perch with ticks every 16.
6. Floating forms: a red circle with a black dot, a teal triangle and a yellow half disc under multiply, a green crescent by an even-odd clip, a 4 x 4 line grid, a blue ring around a red dot, a few black dots.
7. Grain: 6000 specks.

## Palette

`#1b1b1f` black, `#d8412f` red, `#e0452b` vermilion, `#f2c14e` yellow,
`#d9a441` ochre, `#2f5fa7` blue, `#23407a` deep blue, `#3fa9a2` teal,
`#e98aa6` pink, `#5a9e5a` green, `#7b5ea7` violet, `#ec8a2f` orange, paper
`#efe8d8`.

## Pitfalls

- Without multiply, overlaps look like cut paper, not glazes.
- Symmetry kills it; lean the composition on diagonals and let lines run past the subject.

## Any subject

Map each part of the subject to one of the forms above, keep the halos and
crossing lines, and let the forms overlap.

## Reference

[`kandinsky.js`](kandinsky.js) draws gallery `style` 8; see the
[catalog](catalog.md) for the commands.
