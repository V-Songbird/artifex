---
type: knowledge
summary: "How to draw star atlas's marks with the functions in star-atlas.js, and how work in star atlas is composed, lit, coloured and moved; read before making a piece in star atlas."
related_files: ["skills/artifex/styles/star-atlas.js", "skills/artifex/styles/kit.js"]
---

# Star atlas

## Contents

- [What makes it read as a star atlas](#what-makes-it-read-as-a-star-atlas)
- [Marks](#marks)
- [Creative direction](#creative-direction)
- [Palette](#palette)
- [Pitfalls](#pitfalls)

A printed celestial chart: stars as discs sized by brightness on a deep blue
sky, a projected coordinate grid, constellations as thin lines between bright
stars, and, in the older atlases, engraved figures drawn faintly under them.

## What makes it read as a star atlas

- Stars are flat discs whose size is their magnitude, with a gap of sky round
  the larger ones where lines stop. Faint stars far outnumber bright ones.
- A coordinate grid that is projected, not square: declination as shallow
  arcs round a pole off the sheet, hours as rays converging on it.
- Constellations are thin straight lines between bright stars, over a faint
  engraved figure in the manner of old atlases.
- It is printed: flat colour and fine lines, no photographic glow except a
  small halo on the brightest stars.
- When the piece is a chart sheet: labels where the grid meets the edge, a
  graduated border, chart symbols for deep-sky objects and a legend. These
  say "chart", not "sky"; they are format, not the signature.

## Marks

Coordinates are design units. Layer the marks in this order: sky, Milky Way,
grid, ecliptic and other great circles, engraved figure, constellation lines,
boundaries, field stars, the constellation's own stars, star numbers and
symbols, then edge labels, legend and border outside the sky's clip.

**Sky.** Fill the sheet with `#081228`, clip to the chart area, then
`sky(g, inner, outer, r0, r1, box)` lays a radial gradient from `#13274c` in
the middle to `#0d1b39` at the edge.

**Milky Way.** `milkyWay(g, R, name, { from, to, normal, offset, area })`
lays seven soft radial glows of radius 230 from `from` to `to`, then about
42000 candidate dots kept where a Gaussian band times a clumping noise beats
a random number. The band is the set of points whose distance along `normal`
is near `offset`, 150 wide, bent up to 90 by noise; the clumps split it with
dark lanes. Dots are 0.5 to 1.3 units at alpha 0.25 to 0.7. The band runs
across the frame at a slant rather than centred and level.

**Grid.** `graticule(g, pole, radii, angles)` draws declination arcs round a
pole and hour rays from it, `rgba(120, 146, 196, 0.42)` at 1.2 wide. Put the
pole far off the sheet (1700 units above a 1000-unit sheet) so the arcs are
shallow and the rays converge slowly; arcs about 170 apart, rays 0.075
radians apart. `rayX(pole, a, y)` and `arcY(pole, r, x)` find where a line
meets an edge, for labels: `label(g, '8H', x, y, 11)` for hours and
`decLabel(g, 40, x, y)` for signed declinations, whose plus sign is drawn
as strokes because the stroke font has none.

**Great circles.** `ecliptic(g, pts)` draws a dashed [10, 7] line, 1.6 wide,
gold `#d6b25a` at 0.75, along a gentle curve across the grid; label it small
in the same gold.

**Field stars.** `starField(R, name, box, n)` scatters n stars, about 1100
for a full sheet, with `magnitude(u)` giving each magnitude about three times
the stars of the one brighter, and tints `#f8f5ea`, `#dfe9ff`, `#fff0cf`,
`#ffd9a8`. `star(g, x, y, mag, tint)` draws each: radius `5.4 - 0.82 mag`,
at least 0.55; a gap of sky 2.2 wider for radii over 1.6; a halo to 4.5
times the radius under magnitude 2.4. Draw stars after the lines so the gaps
cut them.

**Figure.** `figure(g, outlines, engrave)` strokes a form's closed outlines
in `rgba(176, 196, 236, 0.7)`, 1.3 wide, then runs `engrave()` with the pen
at 0.9 for interior detail: `hatchAlong(g, pts, [dx, dy])` for an engraver's
row of short parallel strokes along an edge (about 14 long), plus open paths
for feature lines. Keep it faint; the figure tells the viewer what the stars
are, the stars carry the picture.

**Constellation.** Choose twelve to twenty points that carry a form's outline
and its one or two inner features. `constellation(g, links)` joins them in
`#e6d49a` at 0.85, 1.8 wide, in the fewest lines that still describe the
form. Then put a star on each point, magnitude 1.4 to 3.8, the brightest on
the points that matter most; a small feature can be a double star, two
discs of different size a few units apart. Star numbers in `label` at 9
sit beside the brightest.

**Boundary.** `boundary(g, pole, steps)` draws a dotted [3, 5] outline in
`rgba(214, 178, 90, 0.55)` stepped along the grid: each step an arc round the
pole joined to the next along an hour ray, as charts bound constellations.

**Deep-sky symbols.** `galaxy(g, x, y, rx, ry, a)` is an ellipse `#e0907a`,
`cluster(g, x, y, r)` a dotted circle `#e8cf6a`, `nebula(g, x, y, r)` a square
`#7fc7a4`, all 1.4 wide and small (radius 5 to 16).

**Chart furniture.** Use these when the piece is a chart sheet, and leave
them out when it is a sky. `legend(g, x, y, w, h)` boxes the magnitude scale
0 to 5 and the three symbols with their names (250 by 128 fits); it explains
the marks, so it belongs where the viewer is meant to read the chart.
`border(g, [x0, y0, x1, y1])` draws rules at 0, 7 and 16 outside the chart
area, with 23-unit segments alternately filled `#c9d4ec` between the first
two; it marks the sheet as a printed plate and frames the projection.

## Creative direction

**Where it comes from.** Printed celestial atlases from the seventeenth
century onward: copperplate engravings of mythological figures over plotted
stars, then, from the nineteenth century, bare charts with coordinate grids,
graded star discs and symbols for deep-sky objects.

**What it depicts.** The constellations, their figures, the band of the
Milky Way, and the coordinates that pin them down. Old atlases drew heroes,
animals and instruments; any figure can become a constellation, and a modern
or everyday one reads as a new myth. A chart's sky shows no ground, weather or
horizon; adding one turns it into a view, not a chart.

**Composition and framing.**
- A chart is a window on a projection: the grid, not the frame, sets the
  orientation, and figures sit at whatever angle the sky gives them.
- A constellation's figure is large, often filling most of a plate, and
  crosses the grid freely.
- The pole off the sheet makes the grid converge and gives the chart a
  direction; a pole on the sheet makes a polar chart, a circle of rays.
- Crop: a full plate with border reads as a page; a single constellation
  with no border reads as the sky itself; a field of stars with no lines
  reads as observation before naming.
- Leave sky: crowded figures and labels erase the darkness the stars need.

**Value, colour and light.** A deep blue or near-black ground, stars in
warm and cool whites, lines in pale gold, grid in a muted blue. The only
light is the stars', and it does not spread: a halo only on the brightest.
Brightness is size, not glow. Old atlases also print black on white paper;
keep one scheme per piece.

**Motion and time.**
- The sky turns about the pole: the whole chart, grid and stars rotate
  together, slowly and at a constant rate. Nothing drifts on its own.
- In a planetarium show, constellation lines draw from star to star, then
  the figure fades in under them and fades out again, leaving the stars.
- A slow pan along the Milky Way or a slow push toward one constellation
  suits the medium; fast cuts and shaky cameras do not.
- Stars may twinkle slightly in a sky; on a printed chart they hold still.
- Transitions native to the medium: the grid fading up over the sky, one
  figure dissolving into the next as the chart turns, a page of the atlas
  turning.
- What breaks it: stars that move independently, lines that bend, glowing
  bloom on every star, a square grid.

**Drawing order.** Engraved as a plate: grid and great circles, then stars by
magnitude, brightest first, then the figure, constellation lines and labels
([draw the drawing](../reference/films.md#draw-the-drawing)). The figure and
lines go in after the stars, though they layer under them. A star is placed
whole; a `figure` grows its outlines inside a clip to their grown band, then
its engraving inside a swept band, and a `constellation` link grows from `p`
toward `q`
([grow a mark by length](../reference/films.md#draw-the-drawing)).

**Study.**
- Johann Bayer, *Uranometria* (1603): for engraved figures over plotted
  stars, and stars lettered by brightness.
- Johannes Hevelius, *Firmamentum Sobiescianum* (1690): for figures drawn as
  seen on a globe, from outside the sky.
- John Flamsteed, *Atlas Coelestis* (1729): for figures engraved over stars
  plotted from telescope measurements.
- *Urania's Mirror* (1824): for constellation cards pierced so the stars
  shine through.
- Wil Tirion, *Sky Atlas 2000.0*: for the modern chart's graded discs,
  boundaries and deep-sky symbols.

**Levers.**
- Figure strength: a strong engraved figure reads as myth; lines alone read
  as navigation; stars alone read as observation.
- Star count: a sparse field makes the constellation stand out; a dense one
  hides it until the lines appear.
- Projection: a distant pole gives gentle converging lines; a near pole
  makes a polar wheel.
- Furniture: border, legend and labels make a document; none makes a sky.
- Milky Way: a strong band gives the chart a diagonal and depth; none makes
  it quiet and sparse.
- Rotation over time: a turning sky reads as hours passing; a held chart
  reads as a page.

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

- Too many bright stars bury the constellation; a steep magnitude
  distribution, with the constellation's stars among the brightest, lifts it.
- A square grid reads as graph paper; a pole off the sheet makes the lines
  converge.
- Without the engraved figure, a constellation of any form is an abstract
  stick figure; the figure is what tells the viewer what it is.
- A wide checkered border reads as film stock; a narrow graduated band
  between two rules reads as an atlas.
- Lines drawn after the stars run through them; lines drawn first stop at
  each star's gap.
