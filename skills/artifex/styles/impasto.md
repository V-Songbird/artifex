---
type: knowledge
summary: "How to draw the impasto style: thick paint dabs with lit and dark ridges following a swirling flow, wrapping the subject's form under one light; read before making or adapting an impasto piece."
related_files: ["skills/artifex/styles/impasto.js", "skills/artifex/styles/kit.js"]
---

# Impasto

Thick paint laid in short dabs. Gallery `style` 9.

## What makes it read as impasto

- The whole canvas is dabs; nothing is a flat fill.
- Each dab has relief: a body, a lit ridge on the side that faces the light and a dark ridge on the other.
- Dabs follow a flow: swirling vortices and a rising drift in the background; inside the subject they wrap its form.
- One light over the whole subject. Lighting parts separately leaves seams, such as a cool band across a neck.
- Cool blue-grey shadows against warm lights, with dark accents along the underside.

## Recipe

1. Canvas `#f3ead8`.
2. `dab(x, y, angle, length, width, colour)`: an ellipse; a lit ridge 42% toward white at alpha 0.75, offset to the side facing the light (-0.6, -0.8); a dark ridge 38% toward `#3a2a1e` at alpha 0.55 on the other side.
3. Background: a 56 x 56 grid, spacing 19, jitter 18, drawn in a shuffled order. Dab length 17 to 27, width 6 to 9.
4. Flow angle: drift (0.55, -0.8) plus four vortices of strength plus or minus 1, each adding gain 180 over d^2 + 9000, plus fbm noise at scale 260 times 2.2 radians.
5. Colour: fbm at scale 230, domain-warped at scale 420, plus a Gaussian lift of 0.14 within about 250 of the subject, mapped through thresholds 0.36, 0.43, 0.5, 0.56 and 0.62 to `#c8412a` `#e0612a` `#f08a3c` `#f7b267` `#f4dcb8` `#fbf3e6`; 1.5% of dabs gold `#e9b949`.
6. Subject: a jittered grid, spacing 9, over its bounding box, shuffled. Each sample finds its part by point-in-polygon. Body dabs turn around the body's or the head's centre; wing, tail and beak dabs follow each part's axis. Length 11 to 16, width 4.2 to 6.
7. Shade by position against one light: 0.5 + ((x - cx)(-0.5) + (y - cy)(-0.85)) / r, picking from a palette sorted dark to light.
8. Accents: navy `#27365e` dabs along the lower contour, gold along the wing's edge, dark eye dabs with a pale glint, pink blush dabs; then grain.

## Palette

| Role | Colours, dark to light |
| --- | --- |
| body | `#8e98bf` `#c9b8b9` `#e6d3c1` `#f6ebd9` `#fffaf1` |
| wing | `#b8352a` `#d6452f` `#ea6a45` `#f39a6b` |
| tail | `#b8352a` `#c8412a` `#e0573a` `#f08a3c` |
| beak | `#d99a2b` `#e9b949` `#f2c94c` |

## Pitfalls

- Dabs shorter than about 11 units at a 1000-unit canvas read as fine hatching, not paint.
- Too much white loses the fire; these thresholds keep roughly half the background warm.

## Any subject

Replace the parts and their axes; keep the flow background, the single light
and the dab relief.

## Reference

[`impasto.js`](impasto.js) draws gallery `style` 9; see the
[catalog](catalog.md) for the commands.
