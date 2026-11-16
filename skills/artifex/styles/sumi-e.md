---
type: knowledge
summary: "How to draw sumi-e's marks with the functions in sumi-e.js, and how work in sumi-e is composed, lit, coloured and moved; read before making a piece in sumi-e."
related_files: ["skills/artifex/styles/sumi-e.js", "skills/artifex/styles/kit.js"]
---

# Sumi-e

## Contents

- [What makes it read as sumi-e](#what-makes-it-read-as-sumi-e)
- [Marks](#marks)
- [Creative direction](#creative-direction)
- [Palette](#palette)
- [Pitfalls](#pitfalls)

Black ink brush painting on rice paper, from the ink painting of China and
Japan: few strokes, every tone from pale wash to black from one brush and one
ink, and much empty paper.

## What makes it read as sumi-e

- Each mark is one brush stroke with a pressure: it enters round or on the
  point, swells or holds, and lifts to a point or stops blunt. Outlines
  drawn at one width read as a pen drawing.
- The brush runs dry: late in a stroke the ink breaks into streaks of bare
  paper along the hairs ("flying white").
- One colour only. Depth comes from tone: black for the nearest, most
  important marks, grey washes behind.
- Whites are reserved rather than painted: a light form is bare paper, defined by
  the ink round it or by one fine line.
- A stroke follows a form's length or growth, not its outline.
- Most of the sheet is empty, and the emptiness is part of the picture.
- Thin ink bleeds a soft, uneven halo into the paper; dense ink stays sharp.

## Marks

Layer them in this order: paper, edgeless washes (with any reserved
whites), the large pale masses, the heavy structural strokes, the dark
accents and fine lines, dots last. Ink is laid, not covered, so a later
stroke darkens what it crosses.

- `paper(g, R, name, w, h, fibres)`: rice paper `#f1eadb`, a radial shade
  from `rgba(255, 252, 244, 0.25)` to `rgba(150, 125, 85, 0.14)` toward the
  edges, and about 520 fibres per million square units, curves 6 to 30
  long, light at 0.5 or brown at 0.16, 0.6 to 1.4 wide. It leaves the line
  cap round.
- `ink(a)`: the one ink `rgb(22, 19, 17)` at a darkness from 0 to 1. Every
  tone in a piece comes from it.
- `brush(g, R, name, spine, options)`: one stroke along a spine of 2 to 7
  points. The spine is smoothed with three Chaikin passes, resampled every 2
  units, and each point gets a half width `w / 2 x press(t)`, its edges
  wobbled by 14% with a slow `fbm`.
  - The wet body is solid up to about `1 - dry` of the length and ends
    raggedly. The brush is split across its width into 8 to 28 lanes of
    uneven width, about one per 3 units, and each lane holds ink to its own
    reach, spread over up to 29 samples round `1 - dry`, neighbours in loose
    clumps. Its start is the round of the pressed tip, flattening as the
    entry pressure falls from 0.5 to 0.2, so a stroke entered at full width
    enters round and a fine entry ends flat at its point, with no paler
    nub.
  - The ink is one fill of the wet body and every hair at
    `tone x (1 - 0.45 grade)`, then thin layers from the darker side, one
    per two levels of 8-bit grey between the sides, so the darker side
    reaches `tone` (at most 0.985) and the stroke shades across its width
    in an even ramp with no visible bands. A fill does not
    darken where its own parts overlap, so the body, its round start and the
    hairs inside it read as one solid tone.
  - `bristles` (6 to 56, about one per 1.2 units of width) show only where
    the wet body has ended. Each hair starts inside the body at the body's
    tone, runs dry at its own point and skips more toward the end, streaking
    the dry part with bare paper. A skip cuts a run short; a hair's last run
    draws out to a long point, and late in the stroke the hairs splay a
    little. No hair is wider than twice its share of the local width, so a
    fine entry or lift stays fine. The outer hairs are finer, down to half
    width at the edge, and stay inside the brush's edge, so the edge of a
    dry sweep breaks into fine streaks, not separate pods.
  - `dry` 0.1 for crisp small marks, 0.2 to 0.3 for structure that stays
    solid, 0.4 to 0.6 for fast strokes, feathers, grasses and old wood.
  - `grade` 0.1 to 0.65: one side of the brush loaded paler, so a wide
    stroke models a round form in one pass; 0 lays one flat tone.
  - `bleed` 2 to 4 on pale, wide strokes only: four layers of thin ink at
    `tone x 0.045` round the wet body before the fill, layer `k` reaching
    `0.75 x k x bleed` past the edge on average, from about a seventh of
    that to about twice it. Their reach follows the paper's thirst, one
    noise field over the whole sheet, and a finer noise along the edge, so
    the halo widens, thins and frays along the stroke, and strokes over the
    same patch of paper bleed alike. A few wicks of ink run out along single
    fibres. The dry hairs do not bleed.
- `PRESS`: the pressure over a stroke.
  - `press`: entered at 0.5 and pressed in on one smooth curve, to about
    0.92 by a quarter of the length, eased at the end, so a heavy stroke
    swells without a corner. Heavy structural strokes: a trunk, a limb, a
    dark cap of a form.
  - `blunt`: 0.85 to 1, stopped. A second, narrower stroke over a heavy one's
    base, a stone's edge.
  - `taper`: entered fine at 0.2, pressed to about 0.93 within the first
    tenth, lifted to a point. Offshoots, twigs, stems that leave a heavier stroke at
    an angle; the fine entry keeps a round root from showing where the
    heavier stroke is thin or dry.
  - `swell`: 0.55 rising to 1 mid-stroke. Broad pale masses.
  - `sweep`: entered fine at 0.2, swelling to 1, lifted fine. Leaves,
    feathers, petals, the fine line that bounds a reserved white.
  - `flick`: entered on the point, pressed to about 0.86 within the first
    fifth, lifted to a point. Short sharp accents, claws, thorns, grass tips.
- `dot(g, x, y, r, tone)`: a disc of `r` inside a halo of thin ink. Knots
  where an offshoot leaves a stroke, buds, moss, the darkest accent.
- `wash(g, R, name, x, y, options)`: an edgeless wash of 36 ink patches,
  radius 110 to 360, scattered by `spread`, their edges pushed by `fbm`,
  each at ink 0.0075. Many faint layers rather than one darker one, so it has no
  edge: mist, night, water, distance.
- `reserve(g, w, h, [x, y, r], paint)`: runs `paint()` with a circle left as
  bare paper, then three faint rings at its rim where the wash crept to the
  paper's edge. A white round form made of the ink round it.

Build any form from three or four masses and give each one stroke: a wide
pale `swell` for the bulk with `bleed`, a black `press` for the darkest part,
a few `sweep` strokes that overlap like folded layers, each shorter, paler
and drier than the last, and `flick` accents. Leave the lit side as paper
with one fine `sweep` along it. A heavy structural stroke is one `press`
stroke 50 to 70 wide, `dry` 0.4, `grade` 0.65, then `taper` offshoots 12 to
22 wide that leave it at angles, with a `dot` at each joint.

## Creative direction

**Where it comes from.** Ink painting came to Japan from China with Zen
Buddhism in the thirteenth and fourteenth centuries and grew out of the scholar painting of
the Song and Yuan dynasties, where painting, calligraphy and poetry share one
brush. A stroke is practised for years and then made once, without
correction.

**What it tends to show.** The "four gentlemen" (plum, orchid, bamboo and
chrysanthemum), landscapes of mountain and mist, water, animals and small
creatures, fruit, figures of hermits and monks. The subjects carry meaning:
bamboo bends without breaking, plum flowers in snow. It rarely shows
crowds, interiors or machines, which leaves room for a surprise: a modern
object painted with the same reverence as a branch.

**Composition and framing.** Asymmetry and a strong diagonal. The subject
sits off centre, often entering from an edge, cropped by the frame so it
continues beyond it. Empty paper is space, sky, water or mist; it is not
filled. Scale is set by the empty space round a form, not by detail. Tall
hanging scrolls stack near, middle and far from bottom to top, the far
distance higher and paler; handscrolls unroll from right to left.

**Value, colour and light.** Ink has "five colours", from dense black to the
palest wash, and that range does the work of colour. There is no cast light
and no shadow: tone means nearness and importance. Keep black for the few
marks that matter and the first place the eye should go. A red seal and a
column of calligraphy often sign the painting and balance its empty side;
add them only when the piece asks for them.

**Motion and time.** A stroke is a gesture in time: in a film it should
appear along its length at the speed of the hand, quick and accelerating for
offshoots and flicks, slow and pressed for heavy strokes, with the dry
bristles trailing at the end. Thin ink spreads after it
lands, its halo growing and slowing over a second or two. Native transitions:
ink spreading through wet paper into the next scene, a form dissolving into
mist, a wash flooding the sheet and drying back. Chinese ink-wash animation
moves soft forms slowly, holds long, and lets mountains and water change by
diffusion rather than cuts. What breaks it: a stroke that fades in all at
once, a stroke that grows from both ends, ink that moves after it has dried,
textures that slide with a moving form, a camera that pans fast over empty
paper.

**Drawing order.** Painted in the layer order: pale masses, then structural
strokes, each one unbroken gesture, then dark accents, with dots last, and
nothing gone back over ([draw the drawing](../reference/films.md#draw-the-drawing)).
Call each `brush` stroke on its whole spine every frame inside a clip to the
grown band, wide enough for its `w` and bleed, so its swell and dry run stay
where the whole gesture puts them. `brush` draws along `chaikin(spine, 3)`
when the spine has more than two points, so grow the band along those
points, not the raw spine, and call it unclipped once the stroke is whole.
A `dot` lands whole
([grow a mark by length](../reference/films.md#draw-the-drawing)).

**Sound.** Ink-wash films usually score sparsely with solo traditional
instruments and long silences, such as the guqin in *Feeling from Mountain
and Water*.

**Study.**

- Muqi's *Six Persimmons* for the full range of tone in six simple forms on
  empty ground.
- Hasegawa Tōhaku's *Pine Trees* screens for mist made of empty paper and
  wet, receding tone.
- Sesshū Tōyō's *Splashed-ink Landscape* for speed, broken ink and a
  landscape made of a few wet masses.
- Qi Baishi's shrimp paintings for translucent bodies in a few pressured
  strokes and fine dark accents.
- Te Wei's *Feeling from Mountain and Water* (Shanghai Animation Film
  Studio, 1988) for ink-wash animation: soft forms, slow change, long holds.

**Levers.**

- Emptiness: most of the sheet bare reads as calm and distance; a crowded
  sheet reads as storm or abundance.
- Dryness: wet, bleeding strokes read as rain, mist and softness; dry,
  broken strokes read as age, wind and strength.
- Tone range: one dark accent among pale washes reads as quiet; many blacks
  read as force.
- Scale: one stroke filling the frame reads as gesture and calligraphy; a
  small form in a wide empty sheet reads as distance.
- Speed: slow, pressed strokes read as weight; fast flicked ones read as
  life and wind.
- Cropping: a form entering from an edge reads as a glimpse of something
  larger; a form whole in the middle reads as a specimen.

## Palette

| Role | Colour |
| --- | --- |
| rice paper | `#f1eadb` |
| ink, washes | `rgb(22, 19, 17)` at alpha 0.0075 to 0.1 |
| ink, masses | the same ink at 0.3 to 0.6 |
| ink, accents | the same ink at 0.9 to 1 |
| seal, when used | a single small vermilion mark |

## Pitfalls

- A stroke whose wet body stops with a straight cut reads as a vector shape;
  one that ends raggedly, the bristles carrying on, reads as a brush.
- A stroke that runs dry too early loses the form it was painting; `dry`
  near 0.3 keeps structure that holds something up solid.
- Separate discs drawn for a stroke's start show as darker circles where
  they overlap the body; a start built into the body's polygon has none.
- Hairs streaked along the whole wet body read as corrugated stripes, many
  strokes where there was one. A loaded brush leaves solid ink; the hairs
  show where the ink gives out.
- Dry hairs that all end round and parallel read as a comb; hairs that draw
  out to points, at different lengths and splaying a little, read as a
  brush lifting off.
- A halo of even width reads as an outer glow; one that varies with the
  paper reads as ink drawn into fibres.
- Grey everywhere flattens the picture; blacks kept for the few marks that
  matter, with most of the sheet bare, give it depth.
- Outlining a form and filling it reads as a colouring book; sumi-e paints
  its mass with one stroke along its length instead.
- A wash with an edge reads as a shape; many faint layers read as mist.
