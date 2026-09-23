---
type: knowledge
summary: "How to draw the doodle style: ballpoint pen on a ruled notebook page with double-pass lines, hatching, bubble letters and margin doodles; read before making or adapting a doodle piece."
related_files: ["skills/artifex/styles/doodle.js", "skills/artifex/styles/kit.js"]
---

# Doodle

Ballpoint sketches on a school notebook page. Gallery `style` 7.

## What makes it read as a doodle

- Ruled paper, a red margin and punched holes.
- One ballpoint colour, a second pen for accents, a highlighter swipe.
- Every line drawn twice with independent wobble, as a hand goes over it.
- Shade by hatching, never by fills.
- Classic margin doodles: one-stroke stars, a spiral, a hatched cube, a sun with a face, a cloud with rain, a bolt, an arrow with a word, bubble letters.
- Thick bright marker fills on a dark page read as embroidery instead.

## Recipe

1. Page `#fbfaf4`. Ruled lines from y 118 every 34, rgba(120, 165, 220, 0.55), width 1.6. Margin at x 112, rgba(225, 120, 130, 0.8), width 2.2. Holes of radius 17 at x 52, filled `#dcd8cc` with a small shadow.
2. `pen(pts)`: two passes, widths w and 0.7 w, wobble amplitude 1.3 then 2.2, step 7. Ink rgba(31, 58, 147, 0.88); accents in rgba(200, 45, 60, 0.85).
3. `hatch(region, angle, spacing)`: parallel lines clipped to the region, each wobbled with amplitude 1.2 and step 14, width 1.6.
4. Bubble letters: stroke-font text at width 30 in ink offset (5, 5) for depth, again at width 30 in place, then at width 24 in the paper colour.
5. Highlighter: one round stroke 64 wide in rgba(255, 232, 60, 0.55), under the letters.
6. Subject: outline with `pen`; hatch the belly twice at crossing angles and the tail once; fill the wing with paper colour before outlining it, then add scallops; a dot eye with a paper-coloured glint; blush in the second pen.
7. Doodles around it, each with `pen`: sound arcs and notes at the beak, a word in stroke-font lettering, a sun with zigzag rays, a scalloped cloud with rain dashes, pentagram stars, plus signs, hearts, a spiral, a cube with a hatched side, a hatched bolt, an arrow with a word, a squiggle.

## Pitfalls

- Single, perfectly smooth lines look plotted, not drawn; keep both wobble passes.
- Dense marker fills turn the page into another style; leave paper showing through hatching.

## Any subject

Outline the subject's parts with `pen`, hatch where it is shaded, and fill the
margins with doodles related to it.

## Reference

[`doodle.js`](doodle.js) draws gallery `style` 7; see the [catalog](catalog.md)
for the commands.
