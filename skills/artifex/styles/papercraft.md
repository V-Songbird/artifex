---
type: knowledge
summary: "How to draw papercraft's marks with the functions in papercraft.js, and how work in papercraft is composed, lit, coloured and moved; read before making a piece in papercraft."
related_files: ["skills/artifex/styles/papercraft.js", "skills/artifex/styles/kit.js"]
---

# Papercraft

## Contents

- [What makes it read as papercraft](#what-makes-it-read-as-papercraft)
- [Marks](#marks)
- [Creative direction](#creative-direction)
- [Palette](#palette)
- [Pitfalls](#pitfalls)
- [Reference photos](#reference-photos)

A layered paper collage: torn strips, cut shapes and printed papers laid one
over another, each sheet casting a soft shadow on the sheet beneath.

## What makes it read as papercraft

- Torn edges show the paper's white core as an irregular rim, 3 to 12 units wide.
- Every sheet casts a soft shadow onto the one beneath. Without shadows it reads as flat vector art.
- Cut edges are clean and smooth, as scissors leave them; torn edges are ragged.
- Colour is flat inside a sheet. Texture comes only from faint mottle, fibres and grain.
- Some sheets carry print: newsprint word bars, rows of cursive loops.
- A fold shows as a thin line a shade darker than its sheet.

## Marks

Layer them in this order: a flat ground, torn sheets from the farthest to the
nearest, print clipped inside its sheet, cut shapes back to front, details on
the cut shapes, then grain over everything. In haze, draw one sheet at a time
from the farthest: its torn sheet, its print, the cut shapes and details at
its distance, then its veil. Every sheet but the nearest gets a veil.

- `tornEdge(R, name, x0, x1, y, amp, { n, wave, jag })` returns a torn edge along `y` from `x0` to `x1`. A slow wave of 4 x `amp`, a fast jag of `amp` and hashed jitter of `amp / 2` push each of its `n + 1` points (140 by default). `amp` 12 to 16 reads as torn paper; under 6 it reads as a wobbly cut. `wave` (240) and `jag` (14) are the two noise periods in units. The edge runs along x; draw under `g.rotate` to tear at another angle.
- `tornSheet(g, R, name, edge, back, fill, opts)` draws a sheet torn along `edge`, with the torn side facing +y. `back` is the rest of its outline, from beyond the edge's first point round to beyond its last, usually off the frame. It draws the white core (`CORE`, `#eee8dc`) lowered by `rim[0] + noise x rim[1]` (3 + 0 to 9) under `TEAR_SHADOW`, rgba(2, 3, 16, 0.8), blur 22, offset (0, 10). Then it draws the coloured sheet over the core. Pass `mottle: [x, y, w, h]` to mottle the sheet inside its outline.
- `mottle(g, R, name, x, y, w, h, { n, r, light, dark })` scatters `n` (40) soft discs of radius `r[0]` to `r[0] + r[1]` (30 to 90), white at alpha 0.016 or navy at 0.03. Each disc fades to nothing at its rim, so `light` and `dark` must be `rgba()` strings. Clip to the sheet first.
- `cutSheet(g, pts, fill, { shade })` fills a cut shape under its own shadow. The default `CUT_SHADOW` is rgba(3, 5, 25, 0.55), blur 16, offset (8, 11), for a sheet lifted well off the one beneath. Use blur 12 to 14 at about (5, 5) for a sheet lying close, and blur 6 at (0, 3) for small pieces such as stars and dots. Cut a form as one polygon per part and fill the parts back to front, so each part shadows the next.
- `fibres(g, R, name, x, y, w, h, { n, colour })` draws `n` (60) short curved hairs, 22 units long, at alpha 0.1, for light papers. Clip to the sheet first.
- `fold(g, pts, { colour, width })` strokes a crease along a polyline, 2 wide at alpha 0.35, in a darker tone of the sheet's own hue.
- `script(g, R, name, x0, y0, x1, y1, colour, { width, pitch })` draws rows of cursive loops `pitch` (17) apart, with random word gaps. Use white at alpha 0.08 on dark paper. Clip to the sheet first.
- `newsprint(g, R, name, x0, y0, x1, rows, opts)` draws rows of word bars 2.2 high, 9.5 apart, words 8 to 30 long with gaps of 5, in brown ink at alpha 0.35. Clip to the sheet first.
- `grain(g, R, name, w, h, n, light, dark)` from `kit.js` lays printed-paper specks over the finished picture. About 7000 per million square units reads as paper; white at alpha 0.05 and dark at 0.08.
- Haze between sheets, for fog, mist, snow or a storm: after each sheet except the nearest, lay a veil over the whole frame, one flat `fillRect` in the pale haze colour at alpha 0.2 to 0.35, thicker across a wider depth gap. The farthest sheet then lies under every veil and the nearest under none, so the haze thickens with depth as [fog does](../reference/materials.md#rain-snow-fog-and-dust). For a whiteout, add veils until the far sheets almost match the haze; the nearest sheets keep their shapes. Check a frame: each layer is nearer the haze colour than the layer in front of it, and the nearest form is darker than the haze behind it.
- A light in haze wears a halo: on the first veil in front of the light, lay two or three flat discs in the light's colour, each smaller and lighter than the one beneath, then cut the light's pale core again on top. A light on the nearest sheet has no veil in front of it; lay its discs straight over that sheet. The next nearer sheet cuts across the halo and stands dark against it. Check a frame: every light in view has a halo lighter than the haze around it.
- A crescent or a hole is an even-odd cut: put both shapes in one path (`g.rect` then `g.arc`, or `sub()` from `kit.js`) and `clip('evenodd')`.

## Creative direction

**Where it comes from.** Cut paper is a folk craft in many places: Chinese
jianzhi, Polish wycinanki and German Scherenschnitte. In the twentieth century
it became a fine art in collage and Matisse's cut-outs. It is also a film
technique, in cut-out animation from the 1920s on, and a picture-book medium.

**What it shows.** Fables, folk tales, animals, landscapes in bands, night
skies and cities as rows of roofs. These subjects suit it because a few big
shapes carry them and depth comes from stacked sheets. Paper rarely shows
machinery, liquids, glass, crowds or fine texture, so any of these is room for
a surprise.

**Composition.** Build depth from planes, as in a toy theatre or a diorama:
each sheet is one distance. Overlap tells the order, and the shadow tells the
gap. Big simple shapes read best; a part smaller than a fingertip would be in
real paper looks fussy. The frame can act like a stage's proscenium, with
sheets entering from the sides or hanging from the top.

**Value, colour and light.** Give each layer a clear value step from the one
beneath, so every shadow has a lighter sheet to fall on. Farther layers sit
closer to the ground colour; nearer ones carry the contrast. Light shows through
shadows, and through lighter paper where a source is shown (below): keep one
direction for all the shadows, and make the shadow
softer and longer the higher a sheet stands. A backlit opaque sheet becomes a
silhouette, with no colour and a sharp outline; backlit tissue glows in the
light's colour instead (below).

**A light source and its spill.** A light shown in the scene, or plainly just
outside it, follows the films rule that
[light reaches as far as it would](../reference/films.md#what-every-scene-holds),
built from paper instead of gradients:

- Cut the source as an opening backed by a tissue sheet in the light's colour,
  with a smaller, paler sheet for its core: the
  [pale core inside a halo](../reference/materials.md#glow-and-peak-chroma),
  in flat steps. Transmitted light is the
  [most chromatic colour](../reference/materials.md#materials) in the scene.
- Lay the spill as two or three flat tissue cuts on every layer it reaches,
  each smaller, lighter and nearer the light's colour than the one beneath, so the falloff is a
  stepped value change. Draw them with `cutSheet` and a short close shadow,
  such as blur 6 at (0, 3). Check a frame: every spill cut is lighter than the
  sheet it lies on, or it reads as a stain or a mat.
- Run the spill to whatever it would light, the subject included, and give
  each near piece a lit side: a thin cut strip, lighter than its piece and
  tinted by the light, along the edge that faces the source. A piece between the source and
  the view stays a silhouette.
- Make the strongest shown source the key, and point the one shadow
  direction away from it. A weaker source adds no second shadow direction; its
  spill tissue lies over the shadows on its side and lightens them, since
  [a shadow takes away only the light that casts it](../reference/films.md#what-every-scene-holds).

**Motion and time.** Cut-out animation is usually shot on twos, 12 pictures a
second ([twos under a moving camera](../reference/films.md#pace)). Pieces turn on hinged joints and slide; they keep their cut shape.
Each turn and slide steps from place to place on the hold, since a hand
moves the piece between shots, while the camera stays on ones
([stop-motion under a moving camera](../reference/films.md#pace)); a camera
locked onto a stepping piece makes each step jump back and forth on screen, so a fixed, panning or
drifting one frames it. The sliding-sheet transition steps on the hold like any other slide; only
the camera moves on ones.
Mouths and hands are swapped as replacement pieces. Layers on a multiplane
stand move at different speeds for parallax. A little jitter between frames,
as from pieces placed by hand, keeps it handmade. Native transitions include
tearing a sheet away to show the next, sliding a sheet across the frame,
folding a sheet open and lifting a layer off. Smooth stretching, morphing
outlines, motion blur and shadows that stay put while their sheet moves all
break the illusion.

**Drawing order.** Built in the layer order: sheets torn and laid back to
front, then cut shapes, then their details, each piece placed whole by hand
rather than grown ([draw the drawing](../reference/films.md#draw-the-drawing)).

**Study**

- Lotte Reiniger, *The Adventures of Prince Achmed* (1926), for hinged silhouette figures and backlit cut-out animation.
- Henri Matisse's cut-outs, such as *The Snail* (1953) and the book *Jazz* (1947), for flat colour sheets and the scissor's own line.
- Yuri Norstein, *Hedgehog in the Fog* (1975), for cut-out layers on glass with haze between them.
- Eric Carle's picture books, such as *The Very Hungry Caterpillar*, for painted tissue papers with texture inside the shape.
- Ezra Jack Keats, *The Snowy Day* (1962), for patterned and printed papers in a simple collage.
- *Tearaway* (Media Molecule, 2013), for a whole world built and animated as folded and cut paper.

**Levers**

- Edge: torn edges read soft and handmade; cut edges read deliberate and graphic.
- Gap: a small shadow reads as a flat collage; a long, soft one reads as a deep diorama.
- Value step: wide steps between layers read graphic and theatrical; narrow steps read misty and far.
- Print: plain papers read calm; newsprint and script read as found material.
- Light: front-lit colour shows the papers; backlit silhouettes show only outlines.
- Shape count: a few large shapes read bold; many small cut pieces read intricate.
- Timing: 12 pictures a second with a little jitter reads handmade; smooth motion reads digital.

## Palette

| Role | Colours |
| --- | --- |
| night ground and receding layers, lightest to darkest | `#44529f` `#323e88` `#242d6c` `#181e4e` |
| violet card | `#3a2f6d` `#2b2a5e` `#45337a` `#262a58` `#3d3272` |
| paper core, newsprint | `#eee8dc` `#efe5c8` |
| warm accents | `#f3d27c` `#f5c24c` `#f0a442` |
| light papers | cream `#f6f1e6`, coral `#e9806e`, red `#d8634b`, ink `#2a2238` |
| shadow | deep navy, rgba(3, 5, 25, 0.55), not pure black |

## Pitfalls

- A raw `shadowBlur` stays the same size at every export scale; `shadow()` from `kit.js`, which the functions use, scales with it.
- Mottle stronger than alpha 0.03 reads as bokeh, not paper.
- A gradient inside a sheet reads as digital art; one flat colour per sheet reads as paper.
- Two neighbouring layers of the same value hide the shadow between them.
- Shadows in different directions break the single light; one offset direction holds it.
- A translucent spill sheet no lighter than the paper it covers reads as a stain, not light; see a light source and its spill under [creative direction](#creative-direction).
- One veil laid over every sheet fades the nearest form as much as the far ones and reads as a filter; a veil between each pair of sheets builds depth instead. A veil that appears at full strength in one frame reads as a flash; one whose alpha rises over seconds arrives, as [weather arrives over a beat](../reference/materials.md#rain-snow-fog-and-dust).
- An even-odd clip needs both shapes in one path: `path()` from `kit.js` starts a new path.

## Reference photos

- [`references/papercraft/torn-paper.webp`](references/papercraft/torn-paper.webp):
  torn and crumpled sheets of paper on white, by varèche, CC0. Source and
  licence are in [`torn-paper.json`](references/papercraft/torn-paper.json).

Outside [replica mode](../reference/replica.md), use the photo for the
material, never its composition. Compare these features
with your piece: the torn edge profile, the flecks of fibre, the grain scale,
and thin paper that lets the sheet beneath show through. The photo is crumpled;
this style keeps its sheets flat. See the [catalog](catalog.md#reference-photos)
for the comparison command.
