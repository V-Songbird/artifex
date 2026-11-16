---
type: knowledge
summary: "How to draw light painting's marks with the functions in light-painting.js, and how work in light painting is composed, lit, coloured and moved; read before making a piece in light painting."
related_files: ["skills/artifex/styles/light-painting.js", "skills/artifex/styles/kit.js"]
---

# Light painting

## Contents

- [What makes it read as light painting](#what-makes-it-read-as-light-painting)
- [Marks](#marks)
- [Creative direction](#creative-direction)
- [Palette](#palette)
- [Pitfalls](#pitfalls)

A long exposure at night: hand-held lights move through the dark while the
shutter is open, and the camera records every path they took as a line of
light over a scene that is almost black.

## What makes it read as light painting

- All light adds (`globalCompositeOperation = 'lighter'`): where trails
  cross they only get brighter, and nothing covers anything.
- A trail has a wide faint glow, a narrower brighter one and a core that is
  nearly white, whatever the light's colour. The glow falls off smoothly
  from the core, with no edge; only the core is sharp.
- A trail is a hand's path: slightly unsteady, brighter where the hand moved
  slowly, its colour drifting along its length.
- The light is switched off between separate marks, so separate parts float
  with dark gaps between them.
- The scene round the light is almost black and still: faint stars, a
  silhouette, a horizon, at most dimly lit.
- Where a light was held still it burns into a white spot.

## Marks

Layer them in this order: night ground, stars and silhouette, then every
light (they add, so their order does not matter), the reflection in wet
ground, `L.add()` for the glows, and a fade at the frame's bottom last.

- `night(g, w, h, horizon)`: a sky graded `#04050b`, `#0b0d1c` at 0.75,
  `#1b1726` at the horizon, and ground `#0c0b12` to `#040407` below.
- `stars(g, R, name, w, h, n)`: about 160 specks of 1.4 units at 0.15 to
  0.65, most of them faint.
- `skyline(g, R, name, w, horizon, options)`: a `#07070d` silhouette
  `rise` to `rise + tall` above the horizon from `fbm`, and a thin glow on
  the horizon itself.
- `lights(g, w, h, scale)`: returns `L`, where cores go on the picture
  (`L.core`) and glows on a canvas of their own at half resolution
  (`L.glow`), added over the picture once by `L.add()`. A blur there costs
  the same at any output size. With no canvas to make one from, glows go
  straight onto the picture.
- `trail(L, points, width, hue, bright)`: one line of light, coloured by
  `hue(t)` along its length.
  - The glow: two blurred shadows of a stroke drawn 4000 units out of sight,
    2.4 x `width` with blur 4 x `width` at alpha 0.7 and 1.2 x `width` with
    blur 1.2 x `width` at 0.5, butt caps, its colour changed every 12
    points. Its alpha follows the hand's changing speed.
  - The core: 0.5 x `width` wide at alpha 0.9, mixed 70% toward white, in
    pieces of six points with round caps under `lighten`, so joints show no
    bead.
  - `width` 2 to 6 at a 1000-unit frame; `bright` 0.3 to 1.
- `glow(g, lines, width, colour, bright)` and `core(g, points, width, hue,
  bright)`: the two halves of a trail, for lights drawn another way.
- `hand(R, name, points, options)`: a hand's path through points, resampled
  every 3 units and wobbled by `amp` (2.2) at a `step` of 14. A closed loop
  is rounded once first. Trace each separate part as its own loop.
- `spot(g, x, y, r)`: a light held still, a radial burn of radius `r` (about
  34), white at the centre, warm at a quarter, fading out.
- `spiral(x, y, options)`: the path of a light swung in widening loops while
  walking: `half` half-turns, radius `r` growing by `grow`, moving by
  `dx, dy`. Pass it through `kit.wobble` and `trail` it.
- `sparks(g, R, name, cx, cy, r, n, dim, mirror)`: spun steel wool, about
  380 sparks along arcs that bend and fall as they cool, 2.8 wide fading to
  0.6, a fifth white-hot `#fff2c0`, two fifths `#ffb347`, the rest
  `#ff7a2a`.
- `orb(L, R, name, cx, cy, r, hue, dim, mirror)`: a light swung on a string,
  16 rings at every tilt round the vertical, cores 1.6 wide under one glow.
- Reflection in wet ground: `within(L, [x, y, w, h], paint)` clips both the
  picture and the glow canvas to the ground; inside it, draw each trail again
  through `ripple(R, name, reflect(points, horizon))` at about a third of its
  brightness, and pass `mirrorY(horizon)` to `sparks` and `orb`. `reflect`
  squashes toward the waterline to 0.42 of the height, a stylistic
  shortening that keeps a tall reflection in frame; flat water would keep
  the full height. `ripple` pushes each point sideways by up to 7.
- `fade(g, w, y0, y1, h)`: the ground drying toward the camera, so no
  reflection is cut by the frame's edge.

## Creative direction

**Where it comes from.** Light painting began in early twentieth-century
motion studies, where lights on workers' hands recorded their paths, and
became an art form when photographers handed artists a penlight in a dark
room. It is photographic: one open shutter, one accumulated picture.

**What it tends to show.** Gestures, signatures and words written in the
air, figures and creatures drawn in one continuous line, the path of a
dancer or a vehicle, orbs and tunnels of light in empty places. The light
is the subject; the place is a stage for it. It rarely shows anything solid
lit from outside, which leaves room for a surprise: a person or object half
revealed by the light that passes over it.

**Composition and framing.** A locked camera on a tripod and a wide, dark
frame. One drawing or a few, floating in the dark, with space round them.
A horizon or a silhouette gives scale and place; wet ground or water below
doubles the light. Sparks and other lights sit where the main drawing is
not: every light adds, so nothing stands in front of anything else.

**Value, colour and light.** The background is near black, darker than any
shadow in daylight work. Light has three levels: the white-hot core, the
coloured glow round it, and the dark. Colour lives in the glow and drifts
as the light moves; complementary pairs (warm rose and amber against cyan
and violet) separate drawings. Brightness means time: where the light
lingered, crossed itself or was held, it burns toward white.

**Motion and time.** A film of a light painting is the exposure building:
draw each trail only up to the playhead, the moving light at its head as a
bright spot, and leave everything already drawn in place. The hand's speed
sets the brightness and the spacing, slow for bright, deliberate marks,
fast for faint, sweeping ones. Separate marks appear one after another with
the light off between them. Light-painting animation is often stop motion,
one finished exposure per frame, so each drawing is redrawn and boils
slightly from frame to frame; keep the boil on twos or threes ([twos under a moving
camera](../reference/films.md#pace)). A slow
fade of all trails at once reads as the shutter closing; a flash of white
reads as a new exposure. What breaks it: trails whose wobble is reseeded
every frame, cores at the light's own colour (neon tubing), a lit
background, glows that darken what they cross, and a moving camera, which
would smear the whole scene.

**Drawing order.** The trail is the drawing in time: the ground and stars are
there first, then each mark in the order its light swept it, with nothing
erased ([draw the drawing](../reference/films.md#draw-the-drawing)). Build
each path once with `hand`, then call `trail` on the whole path every frame
inside a clip to the grown band, set on both `L.core` and `L.glow` and wide
enough for the glow: a `trail` takes its colour and brightness from the
points it is given, so one drawn on the grown points flickers
([grow a mark by length](../reference/films.md#draw-the-drawing)).

**Study.**

- Gjon Mili's 1949 photographs of Picasso drawing with light for the single
  continuous line, a figure made of one gesture.
- Frank and Lillian Gilbreth's chronocyclegraphs for light trails as a
  record of a hand's motion and speed.
- Hiroshi Sugimoto's *Theaters* for a long exposure that accumulates light
  until it burns to white.

**Levers.**

- Continuity: one unbroken line reads as a single gesture; many separate
  loops with gaps read as a constructed drawing.
- Speed: slow, bright, even trails read as deliberate; fast, faint, jittery
  ones read as energy.
- Colour drift: one colour per mark reads as clean signage; colour drifting
  along a trail reads as a hand switching gels in the dark.
- Ground: a black void reads as abstract; a horizon, silhouette and wet
  reflection read as a real place at night.
- Accumulation: a sparse exposure reads as quiet; dense overlapping trails
  that burn to white read as frenzy.
- Scale: a drawing filling the frame reads as intimate; a small light far
  off in a wide dark landscape reads as solitude.

## Palette

| Role | Colours |
| --- | --- |
| sky, horizon, ground | `#04050b` `#0b0d1c` `#1b1726` `#0c0b12` `#040407` |
| silhouette | `#07070d` |
| warm lights | `#ff3d7f` `#ffb13d` `#ff5ad1` `#ffd23d` `#ff8a3d` |
| cool lights | `#40e0ff` `#6f7bff` `#4fd1ff` `#b77dff` `#6effc8` |
| sparks | `#fff2c0` `#ffb347` `#ff7a2a` |
| stars | `rgba(210, 220, 255, 0.15 to 0.65)` |

## Pitfalls

- One continuous path through separate parts draws straight lines across
  them where the hand moved between them; switching the light off leaves the
  gaps dark.
- A core at the light's own colour reads as neon tubing; a core toward white
  reads as a light.
- A glow built from solid strokes of a few widths ends each stroke in a
  visible step, and pieces with round caps add a blotch at every joint; a
  blurred glow with butted pieces is smooth.
- A trail thinner than a pixel at the output size vanishes into a dark disk;
  a core at least a pixel wide stays.
- Sparks overlapping the main drawing bury it: every light adds, so nothing
  can stand in front of anything else.
- A lit scene behind the lights is a photograph with effects, not a long
  exposure; a near-black ground and sky read as one.
