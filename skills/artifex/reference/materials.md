---
type: knowledge
summary: "How light behaves on materials and through air, as knowledge a piece can code: one light plan with falloff, one source that reads as white and every other on a warm-to-cool scale of kinds (gains capped at 10, a clipping check, kinds told apart by 20 degrees of hue or 0.04 of chroma), light roles and where the key goes, with the reading of each placement, light that decides what exists (pools, caught edges, silhouettes on a lighter ground, night by its signs), smoky glow and narrow-band lamps, sun shadows against lamp shadows, the form's tones and lighting ratio, cast shadows that place things (rooted at the contact with a contact ellipse, simplified from the caster, edges in the form's shape class, one value per flat face under a far light, apart from anything airborne, climbing neighbours, banded under overhangs), dark or backlit faces kept readable, shadow colour by facing, texture in the half-light, texture scale against the size a form is meant to seem, transmitted and subsurface light, specular as its own pass, polished surfaces drawn by what they mirror, catchlights on featured eyes and glossy focal points, sheen on living surfaces, a few sparkles on the key's path, highlights that slide on moving things and a flash on struck ones, one spark that gives a flat style its top value, a mirror as a second space, a 100% check for stray bright fragments on rims, wear where a built place is touched, one palette family through a place's props and figures, natural forms kept near real scale while built things and figures take the caricature, colour that varies within a form for a cause, foliage as a mix of ages, iridescence within each element's own hue range, glow, greys, sky, aerial perspective, rain, snow, fog and dust lit to read, lightning as a brief back or cross light, weather that arrives and leaves, dappled light, cloud shadows, shadows of unseen occluders, small flames and low lights, time of day, weather and night as a light plan (the window patch by the hour, a sunlit patch's dark edge, day and night windows, moonlight, day-for-night, afterglow, light that keeps changing, long low-sun shadows), and water; read when a piece should show real-looking surfaces, light or air."
related_files: ["skills/artifex/SKILL.md", "skills/artifex/reference/films.md", "core/colour.js", "core/rand.js", "core/layer.js", "core/finish.js"]
---

# Materials and light

## Contents

- [One light plan](#one-light-plan)
- [Light decides what exists](#light-decides-what-exists)
- [Form: tones, ratio, occlusion](#form-tones-ratio-occlusion)
- [Shadow colour by facing](#shadow-colour-by-facing)
- [Texture in the half-light](#texture-in-the-half-light)
- [Texture scale against apparent size](#texture-scale-against-apparent-size)
- [A surface built as maps](#a-surface-built-as-maps)
- [Materials](#materials)
- [Wear on a built place](#wear-on-a-built-place)
- [One palette family for a place](#one-palette-family-for-a-place)
- [Check wear and palette at 100%](#check-wear-and-palette-at-100)
- [Believable nature in a stylised piece](#believable-nature-in-a-stylised-piece)
- [Iridescence around the local pigment](#iridescence-around-the-local-pigment)
- [Check nature and iridescence at 100%](#check-nature-and-iridescence-at-100)
- [Glow and peak chroma](#glow-and-peak-chroma)
- [Greys from the accents](#greys-from-the-accents)
- [Sky](#sky)
- [Aerial perspective](#aerial-perspective)
- [Rain, snow, fog and dust](#rain-snow-fog-and-dust)
- [Light through gaps and clouds](#light-through-gaps-and-clouds)
- [Time of day, weather and night](#time-of-day-weather-and-night)
- [Water](#water)

Read this with [the core skill](../SKILL.md) when a piece shows surfaces under a
light, or space seen through air or water. Nothing here picks a palette: every
colour below is the piece's own choice, and what follows says how light changes it.
For the palette itself outside a named style, see
[the palette for a still](stills.md#art-direction-preset-focal-composition).
Do the arithmetic in linear light with `core/colour.js`: `mix` for blends,
`oklch(c)` to read lightness, chroma and hue.

## One light plan

- **Name the lights by role before drawing**, each with its direction, size
  and colour, and only the roles the piece uses. Of the lights added to model
  the subject, the *key* alone casts shadows; every source shown in the scene,
  such as a lamp or a window, still casts its own. A style whose medium fixes
  the shadow, such as a cut-paper drop shadow or a printed register, may keep
  one direction for every source: a weaker source then lightens the shadows on
  its side instead of adding a second one. The sky and the light
  bounced off lit things come from the key and stay under it. The *fill* comes from near the view, casts no shadow and
  lifts the shadow side just until its form and reflected light read, well
  under the key: a common fault is fill light so strong the shadows stop
  reading as shadow. A *kicker* and a *backlight* catch edges as a
  [band](#texture-in-the-half-light). Where the subject has eyes, an *eye
  light* lights the eyes alone. A *material light* serves a surface the key
  cannot, such as a glass or a specular that needs its own source. A
  *background light* separates the ground from the subject. In a film, keep
  [one key light per scene](films.md#continuity).
- **Keep the key off the line of view, on the side the subject faces or moves
  towards.** A key from the camera lights the form flat: the terminator and the
  texture in the half-light vanish. Check a frame: the terminator crosses the
  subject and its cast shadow falls to one side. Outdoors in sun, the subject
  may take the sun behind it and to one side as a rim, with its front filled by a warm bounce
  from the lit ground.
- **Place every kicker, eye light and material light on the key's side of the
  subject**, so shadows and highlights agree on one direction. Check a frame:
  every cast shadow points away from the key's side. The backlight stays
  behind, and [two coloured lights](#shadow-colour-by-facing) are a deliberate
  exception.
- **Find the key before adding any other light.** Declare a parameter for its
  direction, such as `key` from 0 to 0.875 for its angle around the subject
  as a fraction of a turn, with 0 at the camera and 0.5 behind the subject,
  turning counterclockwise seen from above, so 0.25 is on the right of the
  frame, and sweep it in 8 cells with
  `npm --prefix "<library root>" run seeds -- "./my-piece.cjs" 8 0.5 --param key`: 8 angles 45 degrees
  apart. A sweep includes both ends, so a range of 0 to 1 draws its first and
  last cell at one angle. The runnable example, `tests/fixtures/key-lift.cjs` in
  the library root, declares `key` from 0 to 1 and `lift` from -0.25 to 0.25, so
  sweep its `key` with a count of 9, not 8:
  `npm --prefix "<library root>" run seeds -- "<library root>/tests/fixtures/key-lift.cjs" 9 0.5 --param key`
  (45 degrees apart, the first and last one angle). To reach the high and low rows of the table below,
  declare a second parameter such as `lift` from -0.25 to 0.25, a quarter turn
  below to a quarter turn above, set `key`'s `value` to the chosen angle, and
  sweep it with `npm --prefix "<library root>" run seeds -- "./my-piece.cjs" 5 0.5 --param lift`: 5
  heights 45 degrees apart. `--param key,lift` draws both in one grid, `key`
  across and `lift` down, each from its minimum to its maximum in one shared
  count, so the count must suit both ranges: with `key` from 0 to 1 and `lift`
  from -0.25 to 0.25, a count of 9 gives key columns 45 degrees apart (the
  first and last are one angle) and lift rows 22.5 degrees apart, level and
  45 degrees above and below included. Sweep them one at a time when you need
  other steps. Sweep on the piece's own subject or, before that is drawn, a textured sphere. Pick the
  cell where the form, the texture in the half-light and the reading in the
  table below agree. On a sphere, a key from the view draws a flat disc, one
  at 90 degrees loses half the form in shade, and one about 45 degrees off the
  view shows both the round form and the texture.

| Key placement | Reads as |
| --- | --- |
| High overhead and bare, no fill | aged, worn; the hollows under every overhang go dark |
| Slightly above the subject's middle, to one side | neutral, flattering; the usual choice |
| Below, with a hard side light | threatening; keep it for a low source in the scene, such as a fire, a lamp on the ground or a screen, or a [light for an inner state](films.md#colour-across-the-film) |
| On the eyes alone, the rest dark, where the subject has eyes | menace |
| Full high key, little shadow | comic, light |
| Hard, from behind and to one side | sculpted: edges and texture lead |

- **Where the piece has a focal feature, it takes the subject's brightest
  value.** Where the emphasis is meant to be equal, skip this. Hold the
  subject's broad planes and the planes that stick out towards the key a step
  below it, by toning the key down on them or flagging it off them. Check a
  frame: the subject's brightest region sits on the focal feature. The
  frame-level version is in
  [the focal preset](stills.md#art-direction-preset-focal-composition).
- **A subject that turns or deforms over a film takes soft, broad light**, so
  its shading changes smoothly. Check `--at` frames across the turn: no hard
  shadow edge jumps across the subject between neighbouring frames.
- **Around a central source, rim what stands between the source and the view,
  and light full what stands beyond it.** Figures or objects in front of the
  source face away from it and catch it only on their edges; those across it
  face both the source and the view.
- **In profile, set the lighter background ahead of the subject and the darker
  behind it.** Reverse the two when the threat comes from behind.
- **A small source is hard, a wide one soft.** Hard light gives sharp shadows,
  crisp texture and speculars; soft light turns from light to shade gradually.
  Every cast shadow softens with distance from what casts it; two side-by-side
  sources cast two shadows.
- **Sun shadows run parallel; a lamp's fan out from the point under it.** Check
  a frame: under the sun every upright's shadow points one way; under a lamp
  each points away from the floor point below the lamp, longer and wider the
  further its caster stands from that point.
- **Cast a complex thing's shadow as the union of its simple solids' shadows**:
  a box, a cylinder, a ball each, joined into one shape on the ground.
- **A point light falls off with the square of distance**: a quarter as bright
  at twice the distance, a ninth at three times. Apply the fall to linear
  light and encode at the end: a quarter of the light shows at about half the
  display value, so the fall looks steepest right beside the light and gentle
  further out.
- **Near a flame in smoky or dusty air, nothing is deep black; the air around
  it glows.** Make the haze thickest in a round halo centred on the flame,
  and add the light along each view ray by the haze it crosses; a halo
  stretched upward into a column reads as bloom standing in for smoke, so the
  rising [smoke](#smoke) is its own layer. The glow
  then lifts the darks beside the flame and fades into the far corners. An even
  haze lifts the whole room alike and reads as fog, not as a glow. The lit walls
  and floor also bounce the flame's warm light into every shadow; without that
  light the shadows facing the viewer stay black, however thick the smoke.
- **A narrow-band lamp removes hue.** A sodium street lamp gives nearly one
  wavelength, so a surface under it returns one amount of that one colour: model
  it as the lamp's colour times a single value per surface, taken from how much
  red and green the surface reflects. Every colour then becomes a lighter or
  darker orange, and blues go dark. A mercury lamp gives blue and green
  with almost no red: multiply the local colour by a light with a weak red
  channel, and reds go dark and dull while warm skin turns grey-green.
- **One source per scene reads as white; every other shows its kind's colour
  against it.** The eye and the camera take one light as neutral and see the
  rest through it. Name that source in the light plan, beside the roles.
  Place every other source on one scale of kinds, from warm to cool: flame,
  household lamp, low sun, noon sun, overcast, open shade, clear sky,
  moonlight. Moonlight is reflected sunlight, but at night the eye sees it
  blue, so it sits at the cool end whenever another source is the white; as
  the only source it can be the white ([moonlight](#time-of-day-weather-and-night)). A kind
  warmer than the white shows orange against it, a cooler one blue, more
  strongly the further apart the two sit on the scale. A night scene by a lamp
  makes the lamp white and the moonlit window blue; a day scene by the window
  makes daylight white and the same lamp orange. Each source keeps the
  piece's own colour: divide every light per channel, in linear light, by the
  white source's colour, then multiply by the white's `luma` (relative
  luminance from `core/colour.js`, weights 0.2126, 0.7152 and 0.0722), so the
  white draws as a grey of its own brightness. Cap each gain at 10: a channel
  near zero gives a huge gain, such as about 260 on blue for a flame
  `#ff8a05` as the white. A narrow-band lamp, or any source with a channel
  under a tenth of its `luma`, cannot read fully neutral; with the cap a
  flame white draws a yellow cast, so name it in the plan.

```js
const { rgb, hex, toLinear, toSRGB, luma, mix, oklch } = require('artifex/core/colour.js');
// Per-channel gains, in linear light, that turn `white` neutral at its own luminance, capped at 10.
const against = (white) => rgb(white).slice(0, 3).map((c) => Math.min(10, luma(white) / toLinear(c)));
// A surface of colour `local` lit by `source` at strength `k`, seen through `gains`.
const under = (local, source, k, gains) => hex(rgb(local).slice(0, 3).map((c, i) =>
  toSRGB(Math.min(1, toLinear(c) * k * toLinear(rgb(source)[i]) * gains[i]))));

const lamp = '#ffb46b', moon = '#cdd9ff', card = '#b0b0b0';   // the piece's own choices
const byLamp = against(lamp);                         // night by the lamp: the lamp is white
const lampOnCard = under(card, lamp, 1, byLamp);      // grey, chroma 0
const moonOnCard = under(card, moon, 0.3, byLamp);    // blue, chroma about 0.15
const warmRoom = against(mix(lamp, '#ffffff', 0.5));  // keeps half the lamp's warmth as a cast
const [L, C, h] = oklch(moonOnCard);                  // the check reads C and C * Math.sin(h)
```

  With the [Form sample](#form-tones-ratio-occlusion), multiply the summed
  light by the gains before `lit`. Keep a cast where it carries the mood:
  take the gains against a colour between the white source and white, as
  `warmRoom` does for a room that should stay warm, and write the cast into
  the plan. Check a still: a neutral surface lit by the white source alone
  draws with OKLCh chroma under 0.02, unless the plan names a cast. Judge the
  other sources against the colour the gains were taken against: the white
  source, or the cast colour where the plan names one. The same surface under
  each source of another kind alone has chroma 0.02 or more; its OKLab b
  (chroma times the sine of the hue) is positive for a kind warmer than that
  colour and negative for a cooler one, and any two kinds differ by at least
  20 degrees of OKLCh hue (0.35, since `oklch` returns radians), taken the
  short way around the circle (350 and 10 differ by 20), or 0.04 of
  chroma. A second
  source of the white's own kind is exempt; with no cast it draws neutral. These are the
  colours the piece draws, before any film finish or grain.
- **`under` clips each channel at 1, and a clipped channel shifts the hue**
  towards the channels still under it. A gain above 1 makes this easy: the
  moon above at strength 1 instead of 0.3 reaches about 1.6 on blue. The
  sample clips already: with `byLamp` gains of about 0.55, 1.20 and 3.74, its
  moon at 0.3 drives a white surface (`#ffffff`) to about 1.12 on blue, while
  the `card` stays under 0.5; lower the moon to 0.25 (about 0.93) for a white
  surface, or keep 0.3 only where every surface's blue stays under about 0.89
  linear (sRGB 0xf2), as the card's does. Check
  the product before `Math.min`: every channel of every lit surface stays at
  1 or under. Where one does not, lower that source's strength or scale every
  gain by one factor below 1; scaling only the clipped channel shifts the hue
  the cap was meant to keep.

## Light decides what exists

What the light does not reach, the viewer does not see, so the light plan is
also the crop.

- **Crop with light.** Leave out of the light whatever the picture does not
  need; it then needs no drawing beyond a dark mass.
- **A low key is a few pools, each from one named source.** A lamp, a lit
  window, a door ajar. The one exception is a film's
  [light for an inner state](films.md#colour-across-the-film), which belongs to
  what the subject feels and may have no source. The dark between pools keeps
  a faint texture or a few dim signs, which read as space; a flat fill reads
  as a hole.
- **Name an object by the one edge the light catches.** A dark silhouette with
  a single lit edge on the side facing the source reads more surely than the
  same form lit all over. The edge is a band, as in
  [edge light](#texture-in-the-half-light). A silhouette with no lit edge
  lives on its outline: keep the ground two value steps lighter all round it,
  and let no other dark touch its edge. Check on `--values`: the silhouette
  sits in the darkest level and the ground round it in the lightest.
- **Let darkness hide the world's edges.** Darken towards the frame's edges
  and away from the pools, so the world seems to go on past what is shown.
- **Night reads by its signs, not by its darkness.** Lit windows, a lamp
  with its pool, a few stars: a day scene darkened all over reads as a dim,
  muddy day, and its subject is lost with everything else. Give each kind of
  lamp its own hue against [the source that reads as white](#one-light-plan). Where land meets sky, late dusk keeps the night readable:
  a deep blue sky lighter than the land under it, unless the ground is the
  lighter of the two, as moonlit snow is. Check a frame: lamps of different
  kinds show different hues, and where a skyline shows, sky and land part by
  at least one value step along all of it.

## Form: tones, ratio, occlusion

- **A lit form has a fixed order of tones**: highlight, centre light, halftones,
  the terminator where light grazes the surface, the core of the shadow just past
  it, reflected light in the shadow, the cast shadow, and the occlusion shadow
  where forms touch or nearly touch, the darkest accent. A form that meets what
  holds it with no occlusion shadow [floats](films.md#what-every-scene-holds).
- **Root every ground shadow at its caster's contact**, as
  [everything stands on something](films.md#what-every-scene-holds) asks, and
  give small clutter, such as pebbles or crumbs, a short shadow of its own.
  Under a standing thing, lay a contact ellipse a little wider than its feet
  or base. Check at 100%: no gap between a standing thing's base and its
  shadow.
- **A cast shadow simplifies its caster.** Small parts, thin gaps and inner
  detail fill in under the shadow's softness, so a soft shadow, or one far
  from its caster, is the caster's outer shape only. A hard shadow close to
  its caster keeps every gap wider than its blur, as [light through
  gaps](#light-through-gaps-and-clouds) uses.
- **A shadow edge takes the form's shape class.** On a round form the
  terminator and the shadow's edge curve; on a boxy one they break on
  straight lines at its edges ([shape language](stills.md#shape-language)).
- **Under one far light, each flat face takes one value.** Sun or a distant
  key lights a flat plane evenly; only a near lamp or a bounce grades it.
  Check on `--values`: outside cast, overhang and occlusion shadows, each flat
  face of a built thing sits in one level.
- **Anything in the air casts its ground shadow apart from it**, by a gap that
  grows with its height and closes on landing; the shadow shrinks and softens
  as the gap grows. Check a time strip of a jump or a drop: the gap is widest
  at the top and zero on the landing frame.
- **A shadow climbs onto whatever stands in its path**: past a wall's or a
  neighbour's foot it turns up that surface instead of running under it.
- **Every eave, sill, brim or ledge drops a band of shadow below it**, as wide
  as the overhang's depth seen along the light. Check a frame: each overhang
  in the light has its band.
- **Unless it is meant as a silhouette, a dark or backlit subject keeps its
  features readable**: where it has a face, its eyes and mouth read, and a dark
  surface such as clothing gets a lighter edge against a dark ground. Check at
  thumbnail size: on a subject meant to be read, the features still read.
- **In full sun the lit side and the shadow side sit about five steps apart on
  a ten-step value scale**, roughly 0.4 to 0.5 of OKLCh lightness. Haze, high
  cloud or a pale ground narrows the gap. Take a shadow's value from the light,
  not from the local colour: a white sheet in shadow is darker than black cloth
  in sun.
- **Under an overcast sky there is no terminator.** Planes lighten as they face
  up, local colours read purer than in sun, and the shapes simplify.
- **A surface's colour is its local colour times the light it receives, summed
  over every source.** Multiply per channel in linear light:

```js
const { rgb, hex, toLinear, toSRGB } = require('artifex/core/colour.js');
// The light a plane receives: [colour, strength] pairs summed in linear light.
const light = (...sources) => [0, 1, 2].map((i) =>
  sources.reduce((sum, [c, k]) => sum + k * toLinear(rgb(c)[i]), 0));
// A surface of colour `local` under that light, back to a display colour.
const lit = (local, L) => hex(rgb(local).slice(0, 3).map((c, i) =>
  toSRGB(Math.min(1, toLinear(c) * L[i]))));

const sun = '#fff1dc', sky = '#8fb4ff', ground = '#b07a4a';   // the piece's own choices
const local = '#c8c0b0';
const sunlit = lit(local, light([sun, 1], [sky, 0.2]));
const shadeUp = lit(local, light([sky, 0.2]));                    // faces the open sky
const shadeDown = lit(local, light([ground, 0.12], [sky, 0.04]));  // faces the lit ground
```

  With these values the sunlit side sits about 0.45 to 0.5 of OKLCh lightness above
  both shadows, the upward shadow turns blue and the downward one warm. The sun
  is the source that reads as white, and its warmth is a kept cast: the sample
  applies no gains, which equals gains taken `against('#ffffff')`. Write the
  cast into the [light plan](#one-light-plan).

## Shadow colour by facing

- **Shadow planes that face up take the sky's colour; those that face down take
  the colour of the lit ground below; vertical ones take both.** Bounced light
  fades fast away from what bounces it, unless that is large, such as a lawn
  or a wall. A shadow's colour is the sum of everything that still reaches it.
- **A cast shadow is lit by whatever it faces.** Under a clear sky it is blue;
  under a partly cloudy sky, greyer; beside a bright coloured wall, that wall's
  colour.
- **Two coloured lights: each one's shadow takes the other's colour**, and
  where both reach, their sum is lighter than either (additive, not a paint
  mix). Adding light needs `'lighter'` or `'screen'`, raster only; a vector
  surface refuses both, so draw the overlap as its own shape in its own colour.
- **The shadow's colour changes how the lit side reads**: a green-tinged shadow
  makes a neutral lit side look warmer. Judge colours against their neighbours.

## Texture in the half-light

- **Texture shows most in the half-light, the darker halftone just before the
  terminator, where light rakes the surface.** It flattens in light that faces
  the surface squarely and nearly vanishes in shadow: there it is the relief
  fading, not the lit texture darkened. Weight each mark's relief by how the
  surface faces the key:

```js
const { smoothstep } = require('artifex/core/num.js');
// f: the cosine between the surface normal and the direction to the key, -1..1.
const rake = (f) => 0.15 + (f <= 0 ? 0 :
  0.85 * smoothstep(0, 0.2, f) * (1 - smoothstep(0.35, 0.9, f)));
```

- **Group planes before detail**: tops, lit sides, darker sides, shadow. State
  the form as light and shadow first; texture rides on that.
- **Edge light is a band, not an outline.** A light from behind catches the
  planes that turn towards it, widest where the turning plane is largest, in a
  lighter version of the local colour, against a darker ground. Against a
  bright ground the light eats the edges, colours lose chroma and shadows
  stretch towards the viewer; keep a little colour in the bright haze instead
  of white.

## Texture scale against apparent size

The size of a texture tells the viewer how big the thing under it is. The eye
measures a form by how many repeats of its grain, weave, pitting or stitching
cross it: few large repeats make it small and handmade, many fine ones make it
large or far, and none at all make it moulded plastic.

- **Scale texture inversely to the size a form is meant to seem.** Decide how
  large each form is to read, then set how many repeats cross it from that: a
  form meant to seem huge carries many fine repeats, one meant to seem small
  carries few large ones. Write the repeat's size as a share of the form's size
  on screen, as [line weight](stills.md#line-weight) does with width; a fixed
  pixel count changes the form's apparent size with the export scale.
- **For a handmade or miniature look, enlarge and thicken everything small on
  the surface together.** Give texture, trims (a piped edge, a row of
  stitches, a bead along a rim) and imperfections (a dent, a wobble in an edge,
  an uneven gap) fewer, thicker repeats and a larger wobble, so the form looks
  made by hand at a small size. Scale all three by the same factor: a chunky
  weave beside a hairline trim reads as two scales pasted together.
- **Stop before the texture becomes a material of its own.** While several
  repeats fit across the smallest part a texture crosses, such as a rim, a
  corner or a seam, they read as one surface. When only one or two fit, each
  repeat reads as a lump or a cord of its own, the surface turns to sacking or
  gravel, and it eats the part's outline. Keep at least three repeats across
  that part as a starting ceiling, and judge it in the crop below.
- **What is meant to read huge keeps fine texture and air, even in a chunky
  world.** A far ridge, a tall wall or a vast sky form keeps its texture fine
  for its size and lets [aerial perspective](#aerial-perspective) lighten and
  soften it. Chunky texture on it shrinks it to a model on a table. Chunky near
  forms and fine, hazy far ones keep both readings: made by hand up close, and
  large in the distance.
- **Give every surface some texture at its own scale.** A smooth form with no
  texture at any scale reads as moulded plastic, however well it is lit.

Derive each texture's repeat from the form and a `chunk` parameter, capped at
the ceiling; thicken each mark by the same share, so a larger repeat is also a
heavier one:

```js
// form: the form's size on screen; repeats: how many repeats would cross it at
// its natural scale, larger for a form that must seem bigger; chunk: 1 for a
// natural look, above 1 for a handmade one; part: the smallest part it crosses.
const period = (form, repeats, chunk, part) => Math.min(form * chunk / repeats, part / 3);
const markWidth = (p) => 0.2 * p;   // the mark's width, as a share of its repeat
```

  At a 20-unit repeat, `markWidth` is 4 units.

  With a 240-unit form, 24 natural repeats and a 60-unit rim, `chunk` 1 gives
  a 10-unit repeat and `chunk` 2 a 20-unit one; at `chunk` 3 the rim's ceiling
  holds it at 20. A form 960 units wide that is meant to seem four times larger takes
  96 natural repeats and `chunk` 1 whatever the piece's `chunk`, so it keeps a
  fine 10-unit repeat across its whole width.

### Check texture scale

Sweep `chunk` at the piece's own seed, so every cell differs only in the
texture's scale:

```shell
npm --prefix "<library root>" run seeds -- "./my-piece.cjs" 5 --param chunk
```

Pick the value that gives the look the piece chose: 1 for a natural surface,
the smallest value that reads as handmade for a handmade one. Go higher only
while every form still reads as one surface and the largest form still reads
as large. Set it as the parameter's default, then
look at the smallest part a texture crosses at 100%:

```shell
npm --prefix "<library root>" run seeds -- "./my-piece.cjs" --at 0 --loupe x,y --png
```

Use `--at 0` for a still, which refuses any other time; for a film, give
seconds separated by commas. In the crop, count the repeats across that part and point to its outline. If
the outline is lost in the texture, or a repeat reads as an object of its own,
lower `chunk`. Then look at the whole frame: a form meant to seem huge that
looks like a model on a table needs finer texture or more air.

## A surface built as maps

A material painted mark by mark reads as marks: loose lines look like
scratches, dabs like beads or fur. A surface reads as a material when every
tone on it has one cause, its relief under one light. Build it as maps, grids
of numbers composed in this order, with `core/maps.js`:

- **A height first.** Say what the surface is as relief: layers that end,
  fibres, pits, crumbs, pores. Make it from noises (`noise`), stretched one
  way for a grain (`scale: [across, down]`), bent (`warp`), or thresholded
  into pits and lumps (`levels`). Bend every part
  with the same two maps, so the parts sway together as one body.
- **Where it breaks is a pattern of its own.** A noise cut into levels
  breaks along its level lines: closed loops, one inside the next, every
  riser alike, which reads as the contours of a map. Cut the surface into
  cells instead (`cells`) and give each its own level and its own tilt: a
  tilted plate stands high at one edge and lies flush at the other, so one
  side breaks and the other does not. Let some plates barely tilt and their
  borders vanish, so break lines end instead of closing into a net.
- **Wear is uneven.** A break is sharp where it snapped and eaten where it
  weathered, more on one side than the other. Drag the height down the
  slopes of a second, rough map (`slopeBlur`, `mode: 'min'`) and an edge
  chips more in one place than the next; a ramp as that second map drags
  everything one way.
- **Light and wear derived from it, never drawn.** `shade(height)` is the
  light each slope takes from the piece's key; `relief(height, sigma)` is
  over 0 on what stands out, where wear and light catch, and under 0 in the
  hollows, where dirt and shadow sit. An edge is then where the height
  changes, lit on one side and dark on the other, with no line drawn.
- **Tone as a sum.** Broad patches, the relief's light, its hollows and a
  grain, added with `combine`. Set the range from the reference before the
  detail: most surfaces are a narrow band of tone with few true darks.
- **Colour last.** Read the tone through a ramp of the material's own
  colours (`toImage`), then lay each other colour through a mask (`over`):
  a stain, a bloom, bare metal. A mask comes from the same maps, so colour
  changes where the surface does.
- **Masks vary everything.** Multiply a part of the height by a broad soft
  mask and it fades in and out across the surface; a surface that is the
  same everywhere reads as a pattern. Keep a mask on a height soft: a hard
  one cuts a cliff along its own outline.
- **Grain at the size of a pixel is its own map.** A noise is flat at a
  scale near one cell; one value per cell,
  `fill(w, h, (x, y) => R('grain', 'cell', (x << 16) | y))`, gives the
  crisp speckle that keeps a surface from looking blurred.

Build the image once, in a build stage, and draw it with `show`; the
[map helpers](../../../docs/apis/maps.md) list every function. Then judge it
as any material: beside the reference, at 100%.

## Materials

The tone order above is for opaque matte forms. Other materials break it:

- **Transmitted light is the most chromatic colour in the scene.** A thin
  translucent sheet lit from behind (a leaf, a sail, a balloon, a membrane)
  glows in a deeper, purer version of its colour; the same sheet lit from the
  front reflects a duller one. Backlit foliage shows four groups at any scale:
  transmitted (the most chromatic), toplit (lightest, most textured, low chroma
  from its waxy sheen), shadow facing up (cooled by the sky) and shadow facing
  down (darkest).
- **Subsurface light glows where the form is thin.** In a translucent volume
  (flesh, wax, fruit, milk, snow) light enters, spreads and leaves elsewhere,
  brightest at thin edges and small forms lit from behind, in the colour the
  material keeps (red in flesh, blue-green in snow). It lightens the terminator
  and softens small shadow edges. Scale the glow as `Math.exp(-thickness /
  depth)`, with `depth` the material's own scattering length.
- **Clouds, foliage and hair are volumes, not plaster.** A cloud carries light
  into its shadow side from within; near the sun a cloud has a dark centre and
  bright edges, away from it lit tops and darker bases, and small clouds are
  greyer. Draw a fibre mass as a few large masses with soft edges where it meets
  what grows it; its highlight runs across the strands, like a ribbon's.
- **Specular is a separate pass over the diffuse modelling.** Model the form as
  matte, then add the reflection on top. The highlight is the light source
  mirrored: it sits where the normal bisects the directions to the light and
  to the eye, in the source's colour tinted by the surface, not pure white. Each
  source makes its own set of highlights. A soft light-to-dark gradient alone
  models a matte form; gloss reads from a small, hard-edged highlight inside
  it. The highlight belongs to the light, not the surface: as a glossy form
  turns, or passes close to a source, its highlight and its rim stay on the
  side facing the light and slide over the form, which is what reads as
  shine. A form that only travels under a far light keeps its highlight in
  place. A highlight painted into a turning form's own colours turns with it
  and reads as a printed spot.
  The more mirror-like the surface, the
  wider its range of values; a convex mirror holds a small, bent view of its
  whole surroundings, beyond the frame too. Draw a polished surface (chrome,
  lacquer, glass, still liquid) by what it mirrors: keep its diffuse modelling
  dark and paint no direct light on it. Move its highlight, by the
  [material light](#one-light-plan) or the surface's tilt, until it falls off
  the content that matters, such as a face or a label; a glossy focal feature
  keeps only its own catchlight, below. Check a frame: no other highlight
  crosses the content that matters.
- **Every featured eye or glossy focal point carries a small reflection of the
  key.** Where the subject has eyes, or the focal feature is glossy, give each
  one a small catchlight: the key, or the [eye light](#one-light-plan),
  mirrored as the specular above is placed, in that light's colour and on the
  same side of every eye alike. For the iris around it, see
  [eyes](faces.md#eyes-and-brows). An eye with no catchlight reads as dead,
  aged or blank, so leave it out only when the piece means that. Check a
  frame: every featured eye or glossy focal point shows its reflection, all
  on the key's side, unless the piece means its absence.
- **A living surface has a sheen; a chalky one reads as dead.** Where a surface
  is meant to read alive or fresh, such as skin, a leaf, a cut fruit or a wet stone,
  add a soft, broad specular over its matte modelling. The same surface left
  fully matte reads as dead, dry or dusty. A built surface tells age by the
  highlight's size instead: small and sharp when new, broad and dim or none
  when old, as in [wear on a built place](#wear-on-a-built-place). Check a frame:
  each surface meant to read alive shows a sheen on the key's side.
- **A few small glossy things on the key's path give a scene its sparkle.**
  Place a handful of small glossy elements, three to seven as a starting
  count, where the key's reflection reaches the eye, such as a drop, a rivet,
  a bead, a wet pebble or a glass rim. Each takes one small, sharp highlight.
  None at all leaves the scene dull; sparkle spread evenly over everything
  reads as glitter noise. In a film, a sparkle that blinks as its element or
  the view moves stays within the [flash limit](films.md#what-every-scene-holds).
  Check a frame: count the sparkles and point to the key's side of each.
- **A struck thing lights up for a few frames.** Where two parts meet hard, a
  pale [core and halo](#glow-and-peak-chroma) at the point of contact fades
  over a few frames, a few small sharp sparks fly off it along the rebound,
  and the struck edge catches a rim that fades with the core. The flash lights
  the near faces of whatever sits beside the contact, falling off with
  distance, so the hit belongs to the scene's light. A hit shown only as a
  colour change or an outline ring reads as a diagram of a hit, not as
  energy. Time the flash to the contact frame, as in
  [takes and accents](films.md#takes-and-accents). Hits recur, and
  large-area flashes more often than three a second break the
  [flash limit](films.md#what-every-scene-holds), so keep each flash small.
- **A flat, clean style still gains one spark where the picture needs a peak.**
  With no modelling, nothing in a flat picture is brighter than its fills, so
  the frame has no top value and reads level, however good its colours. One
  small, hard-edged shine on the focal glossy thing, or a brief one on a hit,
  gives the eye that top value; drawn as a flat shape in the style's own mark,
  as a cartoon's white shine or a sketch's bare paper is, it keeps the style flat.
  More than a few read as glitter. A style whose guide leaves highlights out,
  or a piece meant to feel dull or matte, takes its peak from value, colour or
  a change of shape instead.
- **A mirror in the frame is a second, brighter space.** A mirror, a window at
  night or a still pool seen face-on holds its own view of the scene, from
  its own position and reversed; a copy of the frame reads as a picture on
  the wall. Light and compose that view as a second space, lighter or cleaner
  than the dim surround it sits in, so it reads as a mirror. Each
  thing it shows still stays a little darker than the thing itself, as on
  [water](#water); on a wet floor, [each source is a
  streak](#rain-snow-fog-and-dust). Check a frame: the mirror's view differs
  from the frame's own and reads lighter than the wall around it.
- **Fine strands catch the light in rings.** Scratches, twigs, threads or wires
  light up only where they lie across the direction to the light's image, so
  the lit ones form circles centred on it: weight a strand by the sine of the
  angle between its direction and the line to that point.
- **Caustics are bright networks where curved glass or rippled water focuses
  light**: inside a glass's cast shadow, on the top surfaces of forms in
  sunlit water no deeper than about 6 to 9 m, and reflected up onto
  surfaces that face down over water. `worley2(R, x, y, name)`'s `f2 - f1` near
  zero draws such a network; warp its input with a slow noise that moves with
  the playhead.
- **Wet darkens a surface except its highlights.**
- **Motion blurs along the path, in proportion to speed**, and only the edges
  across the motion soften; edges along it stay sharp. A moving glossy thing's
  highlight streaks along the path as a thin line that stays bright along its
  length, while the body's own blur thins.

### Check rims and highlights at 100%

Put `x,y` on a rim-lit edge, in design units, with `--at 0` for a still:

```shell
npm --prefix "<library root>" run seeds -- "./my-piece.cjs" --at <seconds> --loupe x,y --png
```

In the crop, follow the rim's [band](#texture-in-the-half-light) along its
length. A bright speck or sliver off the band, or a band broken into
fragments, is a stray highlight: remove it or join it to the band. Then put
`x,y` on each catchlight and sparkle and check that it sits on the key's side.

## Wear on a built place

A built place looks lived in when its surfaces show where they are used. Grime
spread evenly over a whole wall reads as a dirty texture; wear where a body or
the weather reaches tells how the place is used, with nobody in the frame.

- **Age a surface where it is touched, not all over.** Hands darken and smooth
  a patch at hand height beside a door, a latch or a rail. Feet scuff the
  bottom of a wall at kick height and wear a hollow into the middle of a step.
  Edges and corners lighten and round where things brush past them. Water
  streaks down from under a sill or a ledge. For example, an invented counter
  is pale along its front edge, dark where a hand rests, and clean at the far
  end.
- **Let a top coat wear through to the colour under it.** Paint, glaze or
  plaster over another colour thins first on raised edges and at the touch
  points, so the under-colour shows there in broken patches. Draw the
  under-colour, then the top coat cut back by a wear mask, so the edge between
  them stays ragged. A top coat made uniformly lighter reads as a different
  paint, not a worn one.
- **Old surfaces are matte, rough and warm; new ones hard, glossy and cool.**
  Give an old surface a broad, dim highlight or none, more texture in
  [the half-light](#texture-in-the-half-light) and a warmer colour; give a new
  one a small, sharp [specular](#materials) and a cleaner, cooler colour. Set
  side by side, the two tell age at a glance.
- **Aged, not ruined.** Keep the form whole and the wear where use would put
  it: chips and cracks scattered everywhere read as a ruin or as noise. Draw
  wear as loose patches and strokes at the size of the piece's other marks;
  grime finer than everything else in the picture looks pasted on.

A wear mask from the touch points and a kick band, broken up by noise; above
the threshold the under-colour shows:

```js
const { mix } = require('artifex/core/colour.js');
const { smoothstep } = require('artifex/core/num.js');
const { fbm } = require('artifex/core/rand.js');
// touches: [{ x, y, r }] where hands rest; floor: the floor's y; kick: the band's height.
function wear(R, x, y, touches, floor, kick) {
  let w = 0.7 * (1 - smoothstep(0, kick, floor - y));
  for (const t of touches) w = Math.max(w, 1 - smoothstep(0, t.r, Math.hypot(x - t.x, y - t.y)));
  return smoothstep(0.45, 0.6, w * (0.4 + 1.2 * fbm(R, x / 24, y / 24, 3, 'wear')));
}
const under = '#8a6a48', top = '#5f7f74';   // the piece's own choices
const at = (R, x, y, touches, floor, kick) => mix(top, under, wear(R, x, y, touches, floor, kick));
```

  The narrow threshold keeps the edge between the coats sharp and ragged; a
  wide one fades the top coat into a smear. A wall that does not change draws
  once per scale with `layer`.

## One palette family for a place

A place reads as one place when everything in it is coloured from the same few
hues and values.

- **Run the place's palette through its props and figures.** Choose the place's
  hues and values first, then colour each prop and figure from them. A prop in
  a hue the place does not hold looks pasted in from another picture, however
  well it is lit. Pull such a colour part of the way towards the place's
  nearest hue, so it keeps its identity and still belongs: in an invented room
  of rust and olive, a teal box turns towards green.

```js
const { mixOklch, oklch } = require('artifex/core/colour.js');
const T = 2 * Math.PI;
const apart = (a, b) => Math.abs(((a - b) % T + 1.5 * T) % T - Math.PI);   // hue distance, radians
// Pull a colour a share u of the way to the place's nearest hue; near-greys have no hue to offer,
// so an all-grey palette leaves the colour as it is.
function belong(colour, place, u = 0.4) {
  const h = oklch(colour)[2];
  const hued = place.filter((c) => oklch(c)[1] > 0.03);
  if (!hued.length) return colour;
  const near = hued.reduce((m, c) => (apart(oklch(c)[2], h) < apart(oklch(m)[2], h) ? c : m));
  return mixOklch(colour, near, u);
}
belong('#2a8f8a', ['#a0522d', '#6b7a3a', '#2f2a26']);
```

  With these colours the teal lands on `#418a69`, a greener teal: the
  olive (70 degrees away, the rust 146) is its nearest hue and the near-black
  is skipped. `mixOklch` turns the
  hue round the colour wheel instead of greying it through the middle, as
  `mix` would. The hue is read in radians.
- **A figure meant to blend in takes the place's colours; a figure meant to be
  found keeps one that differs.** A figure that hides, waits in the background
  or belongs to the place wears the place's hues and values, so the eye passes
  over it. The figure the viewer is meant to find gets the
  [one strong accent](#greys-from-the-accents) or a value step from its
  surround. Decide which each figure is before colouring it: two figures that
  both stand out split the attention.

## Check wear and palette at 100%

Wear that reads in a small sheet can turn into a smear, or vanish, at the
export size. Look at a 100% crop over a touch point and an edge:

```shell
npm --prefix "<library root>" run seeds -- "./my-piece.cjs" --at <seconds> --loupe x,y --png
```

Use `--at 0` for a still; `x,y` is the point in design units. In the crop,
point to the under-colour, the ragged edge between the coats and the clean
surface beside them. If you cannot find one of them, the wear is too fine, too
even or too faint. Then look at the whole frame at the strip's size: a prop
that jumps out there, and is not the one the viewer is meant to find, is outside the
place's palette.

## Believable nature in a stylised piece

A stylised piece bends shapes on purpose, and the viewer judges how far by the
forms they know best. Rocks, water and plants are seen everywhere and at every
size, so they work as the yardstick. Kept near real, they make the bent forms
around them read as a choice and the place as somewhere that could exist. Bent
as hard as everything else, they leave nothing to measure against, and the
place reads as a stage set.

- **Keep natural forms near their real proportion and scale; spend the
  caricature on built things and figures.** Push the shapes of buildings,
  tools, furniture and characters as far as the style wants. Keep a rock's
  weight, a stream's width against its banks, and a leaf's size against its
  stem and against a figure's hand close to real. The style still draws
  natural forms with its own marks and simplifies their outlines; it does not
  stretch their proportions. For example, in an invented piece where a cottage
  leans and a figure's head is a third of its height, the boulders by the path
  still look heavy and the leaves on the hedge stay smaller than the figure's
  hand. A tree no taller than a door turns the door into a toy.
- **Vary colour within one form, and give each change a cause.** A form in one
  flat colour reads as a cut-out, and the same form speckled with random hues
  reads as noise. Start from the form's local colour and move it for reasons
  the viewer could name: warmer and lighter on the side facing the sun, cooler
  where the shadow faces the sky
  ([shadow colour by facing](#shadow-colour-by-facing)), darker and greener low
  down where damp collects, paler on top where the sun has bleached it. For
  example, an invented boulder is warm and light on its sunlit top, blue-grey
  on its shaded side, and dark and mossy at its foot. Run each change across
  the form as a gradient or a few patches, and give every form of the same
  kind the same causes in the same places.
- **Grow foliage as a mix of ages.** Leaves all of one age, colour and size
  read as plastic, or as one stamp repeated. A living plant carries buds,
  mature leaves, dying leaves and fallen ones at once, and each age has its own
  colour, curl and size:
  - buds: small, pale yellow-green and tightly curled;
  - mature leaves: full size, the plant's deepest local colour, open and flat;
  - dying leaves: nearly full size, turning yellow, brown or red from the edge
    or the tip inwards, curling at the edges;
  - fallen leaves: on the ground under the plant, browner and flatter,
    overlapping, gathered where wind or water would leave them, such as against
    a step or in a hollow.

  Put the young ages at the growing tips and the old ones near the base, with a
  seeded scatter, so each stem reads from young to old. Most leaves are mature;
  the season decides how many are buds or dying.

An age per leaf from its place on the stem and a seeded scatter, then colour,
size and curl from the age:

```js
const { mixOklch } = require('artifex/core/colour.js');
const { smoothstep } = require('artifex/core/num.js');
// s: 0 at the growing tip, 1 at the base. Past 1 the leaf has fallen: draw it on the ground.
const age = (R, s, i) => 0.15 + 0.8 * s + 0.4 * (R('leaf', 'age', i) - 0.5);
function leaf(a, { bud, mature, dying, fallen }) { // the piece's own four colours
  if (a >= 1) return { colour: fallen, size: 0.8, curl: 0.15 };  // browner and flatter
  return {
    colour: a < 0.3 ? mixOklch(bud, mature, smoothstep(0, 0.3, a))
                    : mixOklch(mature, dying, smoothstep(0.7, 1, a)),
    size: 0.4 + 0.6 * smoothstep(0, 0.3, a) - 0.15 * smoothstep(0.8, 1, a),  // share of a full leaf
    curl: Math.max(1 - smoothstep(0, 0.25, a), smoothstep(0.75, 1, a)),     // 0 open, 1 rolled
  };
}
```

  Over a stem of 40 leaves at seeds 1, 2, 3 and 7, this gives 6 to 9 buds, 23
  mature leaves, 7 to 10 dying ones and 0 to 2 fallen ones. Scatter more
  fallen leaves on the ground than the stems drop, since the ground keeps
  them from earlier days.

## Iridescence around the local pigment

A surface made of thin layers or fine ridges, such as a beetle's shell, a
feather, a fish scale, a soap film or an oil sheen, changes colour as the
angle between it, the light and the eye changes. The change stays near the
material's own colour: a green shell runs through blue-greens, a copper one
through reds. That keeps it reading as one material catching the light, not as
a coloured filter laid over the picture.

- **Shift the hue within each element's own range.** Give each element two
  colours either side of its pigment, about 40
  to 70 degrees of hue apart, and move between them. A full spectrum swept
  across the frame, the same for every element, reads as a holographic sticker
  or a screen effect: it ignores the forms, and two elements of different
  colours turn into the same rainbow and lose their identity.
- **Drive the shift by the angle, and along the element's axis.** Most of the
  shift comes from the angle: where the surface faces the half-way direction
  between the light and the eye, it shows one end of its range, and as it turns
  to a grazing angle it moves towards the other end. Add a smaller drift along
  the element's own axis, such as from the root of a feather to its tip, so
  neighbours that face the same way still differ along their length. In a
  film, the shift follows a turn of the element, the light or the camera. A hue
  that cycles with the playhead on an element that does not turn reads as a
  colour-cycling effect.
- **Keep backlit shadows saturated.** With the light behind, the side facing
  the viewer is lit by light passing through the material or bouncing inside
  it, and [transmitted light is the most chromatic colour in the
  scene](#materials). Darken that side by scaling its light down, which keeps
  its chroma in step with its lightness. Mixing it towards a grey or the sky's
  colour turns it into a dull cut-out against its own glowing edge. The same
  holds for any thin element lit from behind, such as a leaf or a membrane.

```js
const { mix, mixOklch } = require('artifex/core/colour.js');
const { clamp01 } = require('artifex/core/num.js');
// range: the element's own two colours, either side of its pigment.
// c: the cosine between the surface normal and the half-way direction between light and eye, 0..1.
// s: the position along the element's axis, 0 at its root, 1 at its tip.
const sheen = (range, c, s) => mixOklch(range[0], range[1], clamp01(0.75 * (1 - c) + 0.25 * s));
const green = ['#2f9a4a', '#1a8a9a'], copper = ['#c0702a', '#b03a5a'];   // the piece's own choices
const backlitShade = (colour, k) => mix(colour, '#000000', k);   // scales the light; never mix towards grey
```

  With these ranges the green element turns from hue 148 to 210 degrees,
  passing `#009380` half way, and the copper one from 58 to 8 degrees, passing
  `#be533e`, so the two share no hue. Darkened by 0.7, the green keeps
  its chroma at a quarter of its lightness, as when lit; mixed 0.7 towards the
  dark grey `#3a3a3a` it falls to a sixth.

## Check nature and iridescence at 100%

Look at the whole frame first, then at 100% crops:

```shell
npm --prefix "<library root>" run seeds -- "./my-piece.cjs" --at <seconds> --loupe x,y --png
```

Put `x,y` on a natural form beside a figure or a built thing, then on a plant,
then on an iridescent element. In each crop, point to:

- the natural form's size against the figure or the built thing beside it. A
  leaf larger than a hand, or a rock that looks light, means the caricature
  has spread to nature.
- each colour change on one form, and its cause: the sun side, the shade side,
  the damp foot. A change with no cause you can name is noise; a form with no
  change is a cut-out.
- each age on a plant: a bud, a mature leaf, a dying one and a fallen one on
  the ground. If one is missing, or every leaf has the same size, the plant
  reads as plastic.
- the two ends of an iridescent element's hue range, then a neighbour's of
  another colour. If both run through the same hues, or one band of rainbow
  crosses them both, the shift is global. On a backlit element, point to a
  shadow that still holds its colour.

For a film, give `--at` several seconds across a turn of the iridescent
element, separated by commas, and check that its hue moves with the turn and
stays inside its range.

## Glow and peak chroma

- **Each hue is most saturated at its own lightness.** In sRGB, `oklch` puts
  the most saturated yellow at lightness 0.97, green at 0.87, red at 0.63 and
  blue at 0.45. Lightening blue or darkening yellow spends chroma.
- **No display colour is both near-white and saturated, so a glow is a pale core
  inside a mid-value halo.** Tint the core with the hue, surround it with the
  hue near its own peak lightness, and let the halo fall off into the dark and
  lift the forms around it, as a bright source's corona does:

```js
const { mix } = require('artifex/core/colour.js');
function glow(g, x, y, r, hue) {            // hue: '#rrggbb', saturated
  const halo = g.createRadialGradient(x, y, 0, x, y, r);
  halo.addColorStop(0, mix(hue, '#ffffff', 0.8));   // pale core, still the hue
  halo.addColorStop(0.12, hue);                      // the hue at its own lightness
  halo.addColorStop(1, hue + '00');                  // falls off into the dark
  g.fillStyle = halo;
  g.beginPath(); g.arc(x, y, r, 0, 2 * Math.PI); g.fill();
}
```

  Draw the scene dark first and the glows last. On a film, the
  [finish's bloom](films.md#film-finish) adds where many lights pile up; the
  piece still draws each light's own glow.
- **A glow spills past the outline.** A gradient that stops at a thing's edge
  reads as a lit matte object, not as a light. Decide for each bright moving
  thing which it is: glossy, with a small sharp
  [specular](#materials), or a source, with a core and a halo that lifts what
  is near it.

## Greys from the accents

- **Mix a scheme's greys from its own accents**, not from black and white, so
  every grey holds a trace of them and the accents sit in it. A pair of opposite
  accents mixed at the right amount reaches a near grey; vary a grey's hue and
  value across a large area rather than filling it flat.

```js
const { mix, oklch } = require('artifex/core/colour.js');
const [a, b] = ['#d2502a', '#2aa0b0'];     // two of the piece's accents
let u = 0, low = Infinity;
for (let k = 0; k <= 100; k++) {
  const c = oklch(mix(a, b, k / 100))[1];
  if (c < low) { low = c; u = k / 100; }
}
const grey = mix(a, b, u);                 // lighten or darken with mix toward the piece's light and dark
```

  This pair lands on `#8b8990` at chroma 0.011; a pair that is not opposite
  lands on a dull third hue instead, which also belongs to the scheme.
- **One strong accent against many greys reads stronger than many strong
  colours.** Small areas look less saturated than large ones of the same colour.
  To make one hue dominate, drain the chroma from everything around it rather
  than pushing the hue itself: a moderate red among near-greys leads the frame,
  while a full red among other full hues is one more colour. Chroma alone
  disappears in greyscale, so give the dominant hue a value step from its
  surround too.

## Sky

- **A clear sky is two gradients at once.** It lightens towards the horizon,
  where the eye looks through more air, and lightens and warms towards the sun;
  a faint lift sits opposite the sun too. Away from the sun the blue is deeper
  and leans violet; near it, greyer. The deepest blue lies about 65 degrees from
  the sun by day and at the zenith when the sun is on the horizon:

```js
const { mix } = require('artifex/core/colour.js');
const { clamp01 } = require('artifex/core/num.js');
// e: height above the horizon, 0..1 (1 at the zenith); a: angle from the sun, radians.
function sky(e, a, { zenith, horizon, glare }) {
  const body = mix(horizon, zenith, Math.sqrt(clamp01(e)));                   // horizon glow
  const lift = 0.9 * Math.exp(-a / 0.5) + 0.12 * Math.exp((a - Math.PI) / 0.6); // solar glare, antisolar lift
  return mix(body, glare, lift);
}
```

  With `zenith: '#3f6fc4', horizon: '#c9d6df', glare: '#fff6e2'`, the darkest
  point lands 62 degrees from a sun 45 degrees up, and at the zenith for a sun on
  the horizon. A sky that does not change draws once per scale with `layer`.
- **At a low sun**, light is weaker and orange, the sky above deepens, shadows
  turn bluer, and the horizon runs from blue through pale yellow to dull red,
  brightest near the sun. Higher clouds stay whiter, lower ones redder. After
  sunset a grey band, the earth's shadow, rises opposite the sun.
- **A rainbow is an angle, not a place**: centred on the point opposite the sun,
  where every shadow points; the primary at 42 degrees, red outside; a fainter
  secondary at 50 with its colours reversed; the sky between them darker. It is
  always lighter than what lies behind it, since its light adds.

## Aerial perspective

- **Distance works on darks first**: they lighten and take the air's colour.
  Lit warm colours grey and cool; the contrast between lit and shadow sides
  shrinks until a far form is a flat, pale silhouette close to the horizon sky,
  and its edges and detail soften. White things warm and dim instead, and stay
  visible longest.
- **One model gives all three**: a colour seen through distance `d` keeps
  `T = exp(-beta * d)` of itself per channel, blue lost fastest, and gains the
  air's colour for the rest:

```js
const { rgb, hex, toLinear, toSRGB } = require('artifex/core/colour.js');
function through(colour, d, air, beta) {    // beta: extinction per distance unit, [r, g, b]
  const c = rgb(colour), A = rgb(air);
  return hex([0, 1, 2].map((i) => {
    const T = Math.exp(-beta[i] * d);
    return toSRGB(toLinear(c[i]) * T + toLinear(A[i]) * (1 - T));
  }));
}
const far = through('#141a14', 2, '#9aaabb', [0.15, 0.35, 0.8]);
```

  With that air and `beta`, over two units a near-black turns a mid blue
  (lightness 0.21 to 0.58), an orange loses over half its chroma, and white
  warms slightly while it dims (0.94 to 0.90 lightness at one and two units).
  Raise `beta` for haze or fog. A far form at one distance may take one
  hazed value, as `far` does; a layer that spans depth, such as a ground or a
  road running into the distance, takes `through` per point at that point's
  own distance, since one flat tint across it reads as a cardboard cutout.
  Check a frame: a ground that runs into the distance lightens smoothly along
  its length, with no step at a layer's edge. To soften a far layer's edges
  too, or lay a band of valley mist, one way is to paint it through `soft`
  from `artifex/styles/kit.js` at a scale near 0.2; the soft buffer only
  spreads edges, so the value change still comes from `through`.
- **Only lit air does this.** Behind a cloud shadow the far forms stay darker;
  sunlit mist lightens and warms, shaded mist less.
- **Looking towards a low sun through dust or mist, the distance warms**
  instead: rare, so it reads as strange.

## Rain, snow, fog and dust

Falling and floating matter reads only where the light picks it out; drawn at
one brightness everywhere, it looks like a texture laid over the frame.

- **Light rain and spray from behind, snow from the front, and show both
  against a dark ground.** Drops scatter light forward, so rain shows only
  where a light lies beyond it and the view looks towards that light; lit from
  the view's side it vanishes. Flakes reflect, so snow needs light from the
  view's side. Over a bright ground both disappear. Check a frame: rain is
  brightest where it crosses a light behind it, snow on its lit side, and
  neither shows over a bright sky or a lit wall.
- **A rainy night has no key, only local sources.** No light casts the key's
  shadows; the lamps, signs and windows in the scene each light their own
  [pool](#light-decides-what-exists), with a soft light from no source between
  them. Check a frame: every cast shadow traces to a source in the scene.
- **Wet ground mirrors each source as a streak**: a vertical band of the
  source's colour below it, stretched and broken as ripples break a reflection
  on [water](#water), while [wet darkens](#materials) the ground around it.
  Check a frame: each bright source in view has its streak on the ground
  beneath it, and any nearer form that overlaps the streak in the frame is
  drawn over it.
- **Fog is thinner near the view and thickens with depth.** Use `through` from
  [aerial perspective](#aerial-perspective) with a large `beta` nearly equal
  across the three channels, such as `[2, 2, 2.2]`, and a pale grey air; the
  chromatic `beta` above would tint the middle distance instead. Contrast then
  drops within a short distance, light comes from all round, colour drops out
  and only the nearest accents keep theirs. Near forms stand dark against the
  bright haze; far ones go first. An even fog over the frame has no depth and
  reads as a filter. Check a frame: the haze grows lighter with
  depth, and the nearest form is darker than the haze behind it.
- **Every lamp in fog wears a halo**: its [glow](#glow-and-peak-chroma) spread
  by the fog, lifting the haze around it as
  [a flame lifts smoky air](#one-light-plan). Check a frame: every lamp in
  view has a halo.
- **Backlit fog is a glowing ground for silhouettes.** With a light beyond the
  fog, the haze is the brightest plane, and what stands before it reads as a
  dark shape with a [caught edge](#light-decides-what-exists). Check a frame:
  the haze around the subject is lighter than the subject.
- **A fast mover's trail of dust or spray, lit from behind, reads from far
  away**: grains of several sizes, each lit on the side towards the light, mark
  its path when the mover itself is too small to read. Thin the trail as the
  view closes, so it leaves the detail that matters clear. Check a frame: on a
  wide frame the trail reads at thumbnail size; on a close frame the mover's
  detail reads through it.
- **Lightning is a brief back or cross light.** For a frame
  or two the sky beyond or beside the subject is the brightest plane: forms go
  dark with a [caught edge](#light-decides-what-exists) on the bolt's side,
  cast shadows fall towards the view or across it, and rain flares against the
  lit sky; a flash from the view's side lights the faces towards it and loses
  the silhouette. Stay within the [flash limit](films.md#what-every-scene-holds).
  Check a strip with `--at` on the [frame middles](films.md#look-at-a-film)
  around the flash: on the flash frame the faces towards the view stay dark
  and only edges on the bolt's side are lit; two frames later the scene is
  back at its own dark.
- **Weather arrives and leaves over a beat**: a band of distant rain draws
  near, a cloud rains itself out, fog lifts. Its amount rises or falls over
  seconds instead of holding one density for the whole film. Check a time
  strip with `--frames 9`: the amount of rain, snow, fog or dust in the middle
  cell differs from the first or the last, and no two neighbouring cells jump
  from none to full.

### Smoke

- **A light's glow stays a round halo on its source; smoke is its own layer.**
  A glow stretched upward to stand for smoke reads as bloom. Draw the smoke
  as separate marks over the halo. Check
  at 100%: the halo reaches as far above the source as beside it.
- **Smoke from a small steady source rises as a few soft ribbons.** From a
  wick, incense or an ember, the smoke is hair-thin only just above the source
  and widens as it rises into a few translucent ribbons, each with a brighter
  core and feathered edges. Each leaves as a short straight stem; its sway
  grows with height into curls and eddies. Each ribbon is a sheet that twists
  about its path: its seen width is its width times `|cos twist|`, so it shows
  a wide face, turns edge-on as a brighter line, and opens again. Keep at
  least about a twelfth of the width edge-on, and raise its alpha by
  `1 / |cos twist|`, at most about 2.4 times, so the edge-on line comes out
  brighter instead of leaving a gap. Key the twist
  on the emission time, as the drift below, so each turn rises with the smoke.
  The ribbons overlap, fold and part, and spread and thin out before they
  fade, fainter where wider. At its widest face a ribbon is about a third of
  the halo's radius across; a sixth reads as a thread, two thirds as haze. A
  fire, a chimney or an explosion billows as a lit volume instead. Check at
  100%: the stem is thinnest just above the source; higher up each ribbon is
  several times the stem's width, with a core and soft edges you can follow;
  at least one ribbon turns from face to edge-on, and at least two cross or
  fold; the top is wider and fainter than the middle.
- **Build a ribbon from nested filled bands.** Fill a quad between each pair
  of neighbouring path points, and repeat it for about eight bands, widest and
  faintest first, each added with `'lighter'`; five bands show stepped
  contours. Cap each half-width at the radius of the path's bend there, or a
  tight turn folds its inner edge into straight-edged fans. Where the seen
  path doubles back, keep the side direction it had, or the quad crosses
  itself. Check the tightest curl at 200%, a `--loupe` crop enlarged twice: no
  straight-edged wedges, and no band edges you can count.
- **Every kink travels up with the smoke.** Place each point of a stream by
  the time it left the source: a point emitted at `tau` has age `a = t - tau`,
  its height grows with `a`, and its sideways drift is a function of `tau` and
  `a`. A drift keyed on `t` alone sways the whole stream in place while the
  smoke seems to flow through fixed curls. Check an `--at` strip on
  consecutive [frame middles](films.md#look-at-a-film), 1/24 s apart at 24 Hz;
  a second on a frame boundary can land on one frame twice. A curl moves up
  from cell to cell, and no kink holds its screen position.
- **Smoke takes its light from the source.** It is warm and brighter near the
  source, and cools to a dim grey and fades as it rises, its light falling off
  as a [point light's](#one-light-plan) does. The hot gas just above a flame is
  clear, so start the smoke a little above the tip. Check a frame: the smoke is
  warmest and brightest just above the source.
- **Lit smoke adds light.** Draw the light it scatters additively
  (`globalCompositeOperation = 'lighter'`), and keep any darkening it casts
  faint and away from the light; a grey stream painted over the halo with plain
  alpha cuts a dark line through the glow. Where the alpha changes from segment
  to segment, stroke with `lineCap = 'butt'`: round caps overlap at every joint
  and bead the line. Check at 100%: along the smoke inside the halo, the luma
  stays at or above the halo's beside it.
- **Burning things hand off: flame to smoke, a spark to a streak.** A puff of
  flame cools as it rises, so its colour runs down the fire's ramp with its
  age, fast at first (about the age to the power 0.6), and it shrinks as it
  goes; where it dies, smoke starts with part of its motion, a little over
  half, and not from the flame's base. A puff of smoke grows as it ages, and
  while young it carries a paler cap on the side toward the light, which is
  what makes it a volume and not a grey disc. A spark is drawn as a streak
  along its motion, longer the faster it flies, brightest at its head; it
  falls with less than full
  gravity, loses about half its speed at a bounce, and a still spark is a
  dot. These are a game engine's values, read from its source and not
  measured against footage.
- **Keep the source emitting to the last frame.** A stream that runs out
  leaves the last frames nearly still, and a film whose last frames barely
  change fails replay.

## Light through gaps and clouds

- **Dappled light is images of the sun**, one through each gap in a canopy:
  round spots about the canopy's height divided by 108 across (the sun spans
  0.53 degrees), larger and softer under a higher canopy, stretched on a
  surface the light strikes at a slant, the long axis pointing back towards the
  light. They move as whole spots in the wind and all vanish when a cloud
  covers the sun. Address each spot by its gap, `R('dapple', 'x', i)`.
- **Small gaps in foliage show darker than the sky beyond**, since twigs and
  leaves still cross them; give them ragged edges and several sizes, and give
  neighbouring canopies different densities.
- **Sunbeams need three things**: a screen that blocks most light with a few
  openings, dusty or moist air, and a view towards the light. They are parallel
  and converge in perspective on the sun, with uneven cross-sections, and lift
  the shadows they cross more than the lit parts. Use them sparingly.
- **Cloud shadows are soft-edged patches that match the clouds overhead** in
  size and spacing, and drift with them in a film. They are darker and cooler
  than sunlit ground but less blue than a clear day's cast shadows, and they
  place attention: light the part that matters.
- **An unseen occluder's shadow names the place.** Bars, a window frame, blinds
  or curtains between an out-of-frame source and a wall or floor cast their
  pattern there: sharp near the occluder, softer farther from it, stretched
  where the light strikes at a slant. In a film the pattern slides slowly with
  its source or occluder; a jump there reads as a cut.
- **A small flame lights only what is beside it.** Its light falls off fast
  with distance, as in [one light plan](#one-light-plan): the face or thing
  beside it is bright and warm, a step away is dark. Its flicker moves its pool
  and the shadows it casts together.
- **A low light throws a looming shadow.** A source near the floor, such as a
  fire, a lamp on the ground or a screen, casts what stands before it upward on
  the wall behind, larger than the thing, growing as the thing nears the light;
  for how it reads, see the key placement table in
  [one light plan](#one-light-plan).
- **Snow is whiter than cloud and takes the sky's colour in shadow**: blue under
  a clear sky, grey under cloud. Its small shadow edges are soft and light,
  hollows go blue-green, old snow is darker and shinier, and water beside it
  looks almost black.

## Time of day, weather and night

Name the hour and the weather before lighting a scene; the key, its colour and
its shadows then follow from a light that exists.

- **Indoors, the window's patch of sun tells the hour.** Before dawn there is
  no hard shadow, only soft sky light from the window. At a low sun a long
  patch, carrying the window frame's pattern as
  [an unseen occluder's shadow](#light-through-gaps-and-clouds) does, crosses
  the floor and climbs the wall opposite. Near noon the patch is small and lies
  on the floor near the window. As the sun sets it rises up the opposite wall
  and leaves it; after that, lamps light [their own pools](#light-decides-what-exists)
  and the window turns blue, since the lamps now
  [read as white](#one-light-plan). Check a time strip across the hours: the patch's
  length and position differ from cell to cell, longest and highest where the
  sun is lowest.
- **A sunlit patch reads strong, its darkest step at its edge**: the shade
  just outside it is darker than the shade further off, and the patch burns
  out the lines and texture it covers. Check at 100%: the shade is darkest
  along the patch's border, and inside the patch fine lines fade.
- **By day the window outshines the room; at night the room outshines the
  window.** At night the panes turn into dark mirrors that hold the lit room,
  as [a mirror in the frame](#materials) does. Check a frame: by day the window
  is the lightest large area; at night every lamp-lit wall is lighter than the
  pane, and the pane shows the room's lamps.
- **Moonlight is daylight from one hard, cool source.** Shadows are opaque and
  fall one way, longer than a high sun's because the moon sits low, and each
  lamp or lit window differs in hue from it. Under the moon alone it reads as
  white or keeps a cool cast for the mood; seen from a lamp-lit room, with the
  lamp as the white, it reads blue ([one source reads as white](#one-light-plan)). Late dusk keeps the sky lighter
  than the land, as [night by its signs](#light-decides-what-exists) asks;
  under a moon the sky is darker than the lit ground. Check a frame: one
  shadow direction, cast shadows longer than the height of what casts them,
  with the sky in view the moonlit ground at least one value step lighter than
  the sky, and each lamp a different hue from the moonlit areas.
- **A day-for-night grade holds only when every window and lamp stays a
  source.** A day frame graded darker and bluer reads as a dim day unless each
  window and lamp keeps its own glow and pool and is left out of the grade.
  Check a frame: every window and lamp in view is lighter than the graded frame
  around it.
- **The afterglow is a soft front key.** After sunset the light is broad, low
  and warm to violet, from the sunset side, with no hard shadows, while
  [the earth's shadow](#sky) rises opposite; clouds near the horizon are lit
  from below. Check a frame: no cast shadow has a hard edge, the faces turned
  towards the sunset side are the lightest, and low clouds are lightest on
  their undersides.
- **Daylight and weather keep changing after their cause has gone.** After the
  sun drops below the horizon the sky, the afterglow and a room's light keep
  changing for a while; after a storm the light keeps clearing. A switched
  lamp is not such a change: it still reaches everything it lights on the same
  frame, as [every scene holds](films.md#what-every-scene-holds). Check a time
  strip with `--frames 9`: the cells after the sun has set or the rain has
  stopped still differ from each other.
- **Long low-sun shadows can compose an empty place.** Where a scene shows a
  place with nothing moving in it, the long shadows of what stands there, or of
  something out of frame, carry its lines and its depth. Between two scenes in
  one place, a change in shadow length and angle tells the time that passed.
  Each long shadow fades as it runs from its caster, so it ends before the
  frame's edge. Check a frame: the longest shadows lead to the focal area and
  fade before the edge, and two scenes in one place at different hours differ
  in shadow length and angle.

## Water

- **Water mirrors at a grazing angle and shows its depth when seen from
  above.** Reflectance is about `0.02 + 0.98 * (1 - cos θ) ** 5`, with θ from
  the vertical: 0.02 looking straight down, 0.3 near 78 degrees, most of the
  sky at the horizon. So the near water shows its bottom or its dark body and
  the far water shows the sky.
- **A reflection of something light is darker than the thing**; in silty, lit
  water, dark reflections lighten and turn brown. Ripples stretch reflections
  downward, keep verticals and break horizontals; minor detail drops out and
  strong edges break up.
- **Clear deep water takes no cast shadow**; silty water takes a soft-edged one.
- **Shallow bottoms show darker, warmer versions of their colours**; deeper,
  they turn blue and blur. Draw foam last, over the surface.
- **Foam below a rapid rides in rings of bubbles around each boil of rising
  water**, and the rings widen and thin as the water carries them away. Draw
  each ring around the centre of a cell from `worley2`, keep rings on only some
  cells, and break them into clumps with two scales of noise. The edges of the
  cells alone, drawn at one width, read as crazed glaze or tile grout, not
  foam.
- **Underwater, red goes first**, mostly within about 3 m, then orange and
  yellow by about 8 m, leaving blue. The loss runs along the whole path, down
  from the surface and across to the eye, so a far red thing in shallow water is
  as dull as a near one deep down. Use `through` with the water's colour and a
  `beta` largest in red, such as `[0.6, 0.12, 0.05]` per metre; silt browns the
  water and algae greens it. A light carried underwater restores warm colours
  only close to it.
