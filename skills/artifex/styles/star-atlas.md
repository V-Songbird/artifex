---
type: knowledge
summary: "How to draw the star-atlas style: a printed celestial chart with a projected coordinate grid, a graduated border, stars sized by magnitude, a dotted Milky Way, chart symbols and a legend, and the subject as a constellation over a faint engraved figure; read before making or adapting a star-atlas piece."
related_files: ["skills/artifex/styles/star-atlas.js", "skills/artifex/styles/kit.js"]
---

# Star atlas

A printed celestial chart: a deep blue sky crossed by a projected grid,
inside a graduated border, with the subject as a constellation. Gallery
`style` 13.

## What makes it read as a star atlas

- A coordinate grid that is projected, not square: declination as shallow
  arcs round a pole off the sheet, hours as rays converging on it, labelled
  where they meet the frame (`3H`, `+40`).
- Stars are flat discs whose size is their magnitude, with a gap of sky round
  the larger ones where lines stop. Faint stars far outnumber bright ones.
- The subject is a constellation: bright stars at its key points, thin lines
  between them, over a faint engraved figure in the manner of old atlases.
- Chart furniture: a graduated border of alternating light and dark
  segments, a dashed ecliptic, a dotted constellation boundary stepped along
  the grid, symbols for galaxies, clusters and nebulae, and a legend.
- It is printed: flat colour, no photographic glow except a small halo on
  the brightest stars.

## Recipe

1. Sheet `#081228`; inside the frame [40, 40, 960, 960] a radial gradient
   from `#13274c` at the middle to `#0d1b39`.
2. The Milky Way: seven soft radial gradients of radius 230 along the band,
   then 42000 candidate dots kept where a Gaussian band
   (`0.6x + 0.8y - 720`, width 150, bent by `fbm`) times a clumping `fbm`
   at scale 70 beats a random number; each dot 0.5 to 1.3 units at alpha
   0.25 to 0.7.
3. The grid: the pole at (470, -1700). Declination arcs of radius 1780 plus
   multiples of 170; hour rays every 0.075 radians. `rgba(120, 146, 196,
   0.42)`, 1.2 wide.
4. The ecliptic: dashed [10, 7], 1.6 wide, `#d6b25a` at 0.75, a gentle curve
   across the sheet, labelled.
5. The field: 1100 stars placed at random. Magnitude
   `1.5 + log3(1 + 242u)` for uniform `u`, so each magnitude holds about
   three times the stars of the one brighter. Radius `max(0.55, 5.4 - 0.82
   mag)`; a gap of sky 2.2 wider for radii over 1.6; a halo to 4.5 times the
   radius under magnitude 2.4. Tints `#f8f5ea`, `#dfe9ff`, `#fff0cf`,
   `#ffd9a8`.
6. The figure: the subject's outlines in `rgba(176, 196, 236, 0.7)`, 1.3
   wide, with engraved detail 0.9 wide: hatching along the underside,
   feather lines on the wing, quills on the tail, an eye.
7. The constellation: named points on the subject's outline (beak, brow,
   crown, nape, back, rump, three tail tips, throat, breast, belly, vent,
   shoulder, wing tip, feet), lines between them in `#e6d49a` at 0.85, 1.8
   wide, then a star on each point at magnitude 1.4 to 3.8, the eye as a
   double star, catalogue numbers beside the five brightest.
8. The boundary: dotted [3, 5] in `rgba(214, 178, 90, 0.55)`, along an inner
   and an outer declination arc and the hour rays between, with one step.
9. Symbols: galaxy an ellipse `#e0907a`; cluster a dotted circle `#e8cf6a`;
   nebula a square `#7fc7a4`; all 1.4 wide.
10. Labels in the stroke font, centred, `rgba(201, 212, 236, 0.85)`. It has
    no plus sign: draw it as two strokes.
11. The legend: a box of `#081228` with a rule, magnitudes 0 to 5 as stars
    with their numbers, and the three symbols named.
12. The border: rules at 0, 7 and 16 outside the frame; between the first
    two, segments 23 long, alternately filled `#c9d4ec`.

## Palette

| Role | Colours |
| --- | --- |
| sheet, sky, sky middle | `#081228` `#0d1b39` `#13274c` |
| grid, figure | `rgba(120, 146, 196, 0.42)` `rgba(176, 196, 236, 0.7)` |
| constellation lines, ecliptic | `#e6d49a` `#d6b25a` |
| stars | `#f8f5ea` `#dfe9ff` `#fff0cf` `#ffd9a8` |
| galaxy, cluster, nebula | `#e0907a` `#e8cf6a` `#7fc7a4` |
| border, labels | `#c9d4ec` `rgba(201, 212, 236, 0.85)` |

## Pitfalls

- Too many bright stars bury the constellation. Keep the magnitude
  distribution steep and the constellation's stars among the brightest.
- A square grid reads as graph paper. The pole must sit off the sheet so the
  lines converge.
- Without the engraved figure a constellation of any subject is an abstract
  stick figure; the figure is what tells the viewer what it is.
- A wide checkered border reads as film stock. Keep the graduated band
  narrow, between two rules.

## Any subject

Choose twelve to twenty points that carry the subject's outline and its one
or two inner features, join them in the fewest lines that still describe it,
and give the points that matter most the brightest stars. Draw the full
outline faintly underneath.

## Reference

[`star-atlas.js`](star-atlas.js) draws gallery `style` 13; see the
[catalog](catalog.md) for the commands.
