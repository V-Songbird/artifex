---
type: knowledge
summary: "How to make an Artifex film: the looks to leave out, the film finish with a photographic process (stock, monochrome filter, trails, shutter blur, double exposure) and flare and vignette from a light and a lens, keeping per-pixel passes cheap, where the film plays (box, length and first second from the place, frame 0 as the thumbnail, a story that reads muted and at phone size, a loop with no seam in picture, and the sound tail the export cuts at a loop's seam), the story spine with what opposes the subject and what rises, a frame (genre or register) that sets the dominant transition, guiding sound and camera style, an opposition whose sides keep their own mark technique and a box that can mark another time, the beat sheet with intensity and what the viewer knows and whose scene it is, world laws that hold, a visible clock for the last stretch, a colour strip of the scenes with keys, daylight or weather conditions, contrast ranges, two grades and owned colours, the devices that move them and light for an inner state, art direction with a moving, motivated light in every dark scene and light events timed as cues, camera and framing (vertical angle, a camera carried on a spring, zip pans, impact shakes, lens by depth spread, staging in five planes, repeating backgrounds, depth of field with a near out-of-focus plane and bokeh), staging two or more subjects, when and why to cut, continuity (match cuts, one element carrying every state, staged morphs, a view that refits after each state, log-space zooms, split-edge and retargeted springs), parts coupled in space, pace, a drawing drawn on screen (order by medium, how a hand moves, the tool and its shadow, timelapse pacing), words in motion (phrase reveals, words in a physical role, captions that read muted), dissolves, openings and floods, travelling waves, figures that read (volumes, proportions in heads, silhouette, line of action, balance, attitude and graded loads, a face that acts, hands and feet, the smallest size at which a figure acts and how to measure it, an object that acts (its character from what it is and does, bends only where it really bends, a signature motion, idle life, a cast as one family)), figures painted as one silhouette over a hidden mannequin, hinged figures for machines and cut-outs, key poses, a gesture line, mood dials, breathing holds and path classes, walks, runs, takes and accents, blocking the whole film and a finished look frame before finishing scenes, regular patterns that strobe as they move, the look loop on frames and shot strips, with tone judged in sequence, the fresh-eyes review, and saving the MP4; read with the core skill for any piece delivered as a film."
related_files: ["skills/artifex/SKILL.md", "skills/artifex/film-scaffold.cjs", "core/finish.js", "core/time.js", "core/path.js", "core/stroke-font.js", "core/sim.js", "core/film.js", "core/export.js", "core/render.js", "examples/cues.js", "examples/cascade.js", "tools/build-page.js", "tools/film-cli.js", "tools/contact-sheet.js"]
---

# Films

## Contents

- [Looks to leave out](#looks-to-leave-out)
- [Film finish](#film-finish)
- [Sprites](#sprites)
- [Per-pixel passes](#per-pixel-passes)
- [Film art direction](#film-art-direction)
- [Save a film](#save-a-film)
- [Film traps](#film-traps)

Read this with [the core skill](../SKILL.md) for any piece with a timeline that
is delivered as a film. The contract, authored time and sound stay in the core.
Read [the film route](film-route.md) first: it is the short map of a film, and
each of its lines opens the section here that holds the whole of it.

## Looks to leave out

A film's list of [looks to leave out](making.md#ask-which-looks-to-leave-out),
kept in the source's header comment, is what a seed review judges a frame
against; a brief that names its looks is the list. These four start it:

- one noise family at every scale ([focal composition](stills.md#art-direction-preset-focal-composition));
- a line that fades up through `globalAlpha` instead of arriving (same);
- a flow field around a focus that turns botanical ([traps](traps.md));
- a story device a viewer names before it lands, such as spinning clock hands
  for time passing or a wilted flower that blooms again as the happy end: a
  beat sheet that names each stock device keeps it only where the film turns
  it.

A grain pass over the finished frame is not on a film's list: a film declares
it once, as its [finish](#film-finish).

## Film finish

A film may declare `finish`: one process that touched every pixel of every
frame, as developing and printing touch a film. `drawFrame` draws it after
`draw` on every raster frame, the same way on each. Read the
[piece API](../../../docs/apis/piece-api.md#film-finish) for the contract.

```js
finish: {
  grain: 0.35,     // 0..1: seeded grain that boils, a new offset every frame
  grainSize: 2,    // 0.5..6, default 1: coarser for a small or fast stock, finer for a clean one
  weave: 1.2,      // design units: the picture moving in the gate
  flicker: 0.025,  // 0..0.025: how far a frame's exposure may dip
  vignette: 0.35,  // 0..1: how dark the corners fall
  grade: { black: '#1d1812', white: '#f4ecdc', tone: '#9c7a52', toning: 0.15 },
  bloom: 0.5,      // 0..1: the brightest light spreading into a glow, light-on-dark films only
}
```

- **Reach for it when a film should read as one film.** Scenes in their own
  palettes, cutouts and parts drawn apart read as a collage of styles until one
  process passes over all of them. Grain, weave and flicker keep the whole frame
  alive where nothing in the picture moves.
- **The grade unifies the palette.** `black` and `white` are where the print's
  darkest and lightest land, so every scene shares one black and one white;
  `tone` pulls every hue toward one colour by `toning` and keeps each pixel's
  lightness. A warm tone greys a saturated blue quickly: keep `toning` low and
  let the ends do most of the work.
- **One treatment, the whole film.** One print over all lets scenes in their
  own marks and palettes read as one film; a different grain or tint baked
  into each shot or sprite reads as different styles.
- **The marks keep their own texture.** The finish is the film's material, not a
  substitute for the material on screen: paper keeps its cut edge, paint its
  stroke. [Texture belongs to the material](stills.md#art-direction-preset-focal-composition)
  still holds for every mark, and for stills, which refuse `finish`.
- **Quiet, and judged at full size.** Grain spends bitrate: at the export's
  default a film grain keeps about two thirds of its finest detail, and the rest
  softens into mottling, so it is judged on decoded frames at 100% (`replay
  --save-frames`, [look at a film](#look-at-a-film) step 5), not on the
  canvas; `bitrate` buys back what the default loses.
- **Nothing to schedule.** Each part is a function of the seed and the frame, so
  scrubs, exports and replay agree. An SVG keeps the bare marks; a PNG, a film and
  the page carry the finish. Paint an opaque ground: grain over transparency
  shows grey.
- **Bloom is for light on dark.** It spreads light above mid-grey into a soft
  glow, from the whole frame's summed light, so it finds what a mark's own glow
  cannot: where sparks pile into a hot core, where trails cross, a lamp's centre.
  On a night scene, light painting or neon it reads as a long exposure; the
  piece still draws each light's own glow. It hurts on a light ground, where
  the paper blooms over fine dark lines and text, and on printed or inked
  looks, where nothing glows, so painters keep it for light on dark. It costs
  3 to 5 ms a frame at 1920 x 1080. 100% crops with and without it (a time
  strip with `--loupe`) show what it adds.
- **Flicker never flashes.** `flicker` above 0.025 is refused: a deeper dip can
  flash a light frame, or a saturated red one, many times a second, past the
  [flash limit](#what-every-scene-holds).
- **Flare and vignette come from a light and a lens.** A flare reads on
  frames where a bright source is in or just past the frame, lined up with it;
  `vignette` matches the lens the film stands for, near 0 on a flat, painted
  or printed look. A time strip shows it: every cell with a flare shows its
  source or lies beside the edge the source is past.
- **Pick a stock and set its parts together.** A film stock moves grain,
  contrast and colour as one choice: a fine stock has little `grain`, `black`
  near true black and little `toning`; a fast stock more `grain`, a lifted
  `black`, `white` a little under paper and some `toning` to soften colour; a
  pushed stock more `grain` with a deeper `black` and a brighter `white`. Name
  the stock in the piece's header comment. Grain size is fixed (720 texels on
  the frame's shorter side), so stocks differ by amount, not grain size.
- **A monochrome film chooses its filter before its grey.** `finish` has no
  monochrome part: draw the grey in a [per-pixel pass](#per-pixel-passes) as
  `wr * R + wg * G + wb * B` in linear light (`toLinear`, then `toSRGB`),
  weights summing to 1. `luma`'s
  0.2126, 0.7152, 0.0722 is the unfiltered film; weight toward a colour to
  lighten it and darken its complement. Weights that put the areas the story
  tells apart at least a stop apart, twice the linear value, keep them apart in
  grey: a weight swept with `--param` shows each area's grey.
- **A trail's sharp mark is at the newest position.** Draw it from older to
  newer positions, fading and softening toward the old end, with the crisp head
  where the element is on this frame; a sharp mark at the oldest end reads as
  moving backwards. A time strip shows the head's place against the element's
  in each cell.
- **Blur by screen speed over one shutter.** Smear each moving mark over the
  positions it takes on screen from this frame's time to a fraction of the next
  (the shutter, such as half a frame), read from the timeline at fixed
  sub-frame offsets of `clock.seconds` and placed after the camera transform:
  motion straight at the viewer hardly smears, and a followed element stays
  sharp while the layers streak by their parallax. Lay the samples as the zip
  pan in [camera and framing](#camera-and-framing) does. What freezes is a
  choice per element; a stepped simulation cannot be re-read between frames.
  A strip shows whether each smear is as long as the mark's on-screen move
  over the shutter.
- **A double exposure is light added on black.** Draw each pass with
  `'lighter'` a little under 1/n of its level for n passes (under half for
  two): at exactly 1/n, two white passes sum to flat white. One pass's darks
  become windows where the other shows. For a motion study, draw the poses at
  equal frame intervals on a dark ground and dim them where copies overlap.
  Raster only, as [adding light](materials.md#shadow-colour-by-facing) is.
  A frame shows whether an area where passes overlap clips to white.

`examples/cues.js` declares one: four palettes under one print.

## Sprites

Textured cutouts, each with its rim, shadow and tint, moved, turned and scaled
on every frame, and sheets of marks that have settled, are drawn with
`sprite(g, s, name, box, paint, { key, at })` from `core/layer.js`. `sprite`
is the cache, so a raster cutout costs one bake.

```js
const { sprite } = require('artifex/core/layer.js');
// In draw: one cutout baked once, placed with any transform.
const at = [k * Math.cos(a), k * Math.sin(a), -k * Math.sin(a), k * Math.cos(a), x, y];
sprite(g, s, 'fox', [-40, -40, 90, 90], (sg, st) => paintFox(sg, st), { at });
// A sheet that grows: the copy at key n is grown from the nearest older copy.
sprite(g, s, 'settled', [0, 0, W, H], (sg, st, from, to) => {
  for (let i = from === null ? 0 : from; i < to; i++) paintMark(sg, st.marks[i]);
}, { key: settledBy(clock.frame) });
```

- **`paint` reads the state and the keys, never the playhead.** It draws inside
  `box` in the sprite's own units onto a transparent ground; what falls
  outside is cut off. The sprite is its baked raster: the same pixels with or
  without a kept copy.
- **Grow a sheet mark by mark.** `paint(sg, st, from, to)` draws the marks
  from `from` (or from the start when it is `null`) up to `to`, each from
  the default state, so growing a copy leaves what baking it whole would.
- **Bake at the size it is seen.** A sprite is baked at the surface's device
  scale. One that `at` enlarges past 1 is resampled up and softens: give it
  `scale`, such as `{ at, scale: 2 }` for one that grows to twice its size.
  A kept copy costs `scale` squared times the pixels, so use it only where the
  sprite grows.
- **Smoothing is high unless a preview needs less.** `smoothing` defaults to
  `'high'`, which keeps a shrunk, turning texture from shimmering. Pass
  `'low'` only when kept copies limit a CPU-bound preview (`'medium'` measured
  about as slow as `'high'`), and
  `false` for crisp pixel art placed at whole-number scales without a turn.
  It changes how the copy is drawn, not the copy, so it costs no memory.
- **One print over all of them.** Texture each cutout in its own material,
  under the film's one [finish](#film-finish).
- **Bake the material, not the light, into a sprite that turns.** A rim, a
  highlight or a cast shadow baked inside it turns with `at` and ends up facing
  away from the [key light](#continuity). Drawn per frame in scene space
  from the scene's [light plan](materials.md#one-light-plan) they stay true,
  and so does a turn small enough that they stay on one side.
- **Copies are bounded.** 64 MB of copies per canvas by default (`budget` in
  pixels); the least recently drawn go first. `held(canvas)` says what is
  kept. On an SVG, `paint` draws directly and every path stays.

## Per-pixel passes

A camera or pattern that moves every frame rules out static layers and
sprites, so a pass that computes every pixel in JavaScript is paid in full on
every frame. Make its inner loop allocate nothing per pixel: no arrays,
objects or closures, only numbers written into one reused buffer. Compute
what depends only on the cell once per run and what depends only on the frame
once per frame, both outside the pixel loop. Put costly terms behind exact
bounds that skip them without changing a pixel: since
`Math.hypot(x, y) >= Math.max(Math.abs(x), Math.abs(y))`, a point whose larger
coordinate already reaches a radius lies outside it with no square root. Time the
change with forced draws, such as a [time strip](#look-at-a-film)'s draw
times, before blaming the GPU or moving the pass there. Together these cut a
measured export's draw time by 41% with identical frames. A soft edge, a cast
shadow's penumbra, haze or an out-of-focus near plane needs no per-pixel
blur: `soft` from `artifex/styles/kit.js` paints into a buffer at a scale of
about 0.2 to 0.35 and lays it back smoothed, about 0.55 ms a call at
1920 x 1080 in headless Edge 156 even over the whole frame, where a
`filter: blur(4px)` fill of the frame took about 20 ms.

A field that moves across the whole frame, such as layered noise, a warp or
a flow of colour, need not be computed at the export's size. Build it as
[maps](../../../docs/apis/maps.md) at half the frame's width and height,
turn it into an image with `toImage`, and draw that image over the frame
with [`show`](images-in.md): a quarter of the pixels, filled by rows. A
measured export of a three-noise field written as a pixel loop took 631 ms a
frame at 1920 x 1080; a like field built as maps took 228 ms at that size and
54 ms at 960 x 540, timed in Node on a loaded machine and not in a browser.
The half-size field is softer by one scale step, which suits a field with no
hard edges; keep anything with an edge, a line or a letter as marks drawn
over it at full size. Seed and time go into the maps' arguments, so the same
seed and playhead still give the same frame.

## Film art direction

A film reads as a world, not a subject on a set. What follows is seen on
frames, not in code.

**The marks of the [focal preset](stills.md#art-direction-preset-focal-composition)
hold on every frame of a film.** Read them there:

- [give every irregularity a cause](stills.md#art-direction-preset-focal-composition):
  form, gesture, material, placement and timing each get their own, not one noise;
- [inspect paint order in rendered output](stills.md#art-direction-preset-focal-composition):
  the layering shows there, not in the invariants;
- [prefer five excellent marks to fifty equivalent decorative ones](stills.md#art-direction-preset-focal-composition),
  with [detail falling away from the subject](#detail-and-resolution).

**The focal preset's composition holds on every key frame.** Read [point the picture at
the subject](stills.md#art-direction-preset-focal-composition) there: an element
that runs uncut from edge to edge cuts the frame in two, kept for a picture
about division; masses in three sizes read as a scene; a frame within the frame
reads as being shut in. A time strip of the key frames with `--at` shows, on
each, any element that runs edge to edge, any two masses of one size, and any
opening that encloses the subject.

**A near occluder between a subject and what it looks at hides the look.** A
foreground post or wall on that line cuts the beat in two; the line stays
clear, or a form crosses it for a beat about being kept apart. The
same strip shows that line on each frame where it looks, and any near form
across it.

### Where it plays

Where the film will play sets its box, its length and its first seconds.
Written beside the spine as `Plays on:`, such as a feed that autoplays muted
on phones, a page, a screen in a room or a file sent to one viewer, the place
sets what follows.

- **The box and the length come from the place.** A phone feed is portrait,
  about 9:16 or 4:5, and gives a loop 6 to 15 s and a short under a minute; a
  page or a room screen is landscape and holds a minute or more. These figures
  are the feeds' conventions, not measured limits. Declare the
  box in `size`, or `boxes` for a piece that plays in both, and
  [fit the scope to the length](#plan-the-film). A landscape film on a phone
  shows under 400 px wide between bars, so a phone film is made portrait, not
  shrunk from a landscape one.
- **The first second decides whether it plays on.** An autoplay feed shows
  frame 0 as a still, then plays muted, and the viewer scrolls on in about a
  second, by the feeds' rule of thumb: there, the [hook](#plan-the-film) lands
  within the first second, as motion already under way on frame 1, where a
  fade up from black or a title spends it. A strip with `--at 0,0.5,1 --json`
  shows the picture moved as the second cell's `change` from the first, which
  no single cell shows; `change` matches no gain, so a fade moves it as much,
  and the cells side by side tell motion from a fade, and the third cell shows
  the hook landed.
- **Frame 0 doubles as the thumbnail.** A feed, a page and a player show frame
  0 before play, small: composed as a still with the subject whole and
  largest, the frame's strongest contrast on it and nothing kept for a later
  reveal in view, it invites; an empty, dark or flat first frame is the look
  that invites nobody.
  `npm --prefix "<library root>" run still -- "./my-piece.cjs" --at 0 --scale 0.2`
  shows whether the subject reads at that size; on a strip, `--at 0 --values`
  shows where the ring of the strongest value step falls.
- **A muted film tells its story without sound.** Where the place autoplays
  muted, a beat reads only from what the picture holds: each caused sound's
  cause and its effect in frame ([depth order and contacts](making.md#depth-order-and-contacts)),
  no beat resting on what the sound line adds, and the channel
  [dropped on purpose](#plan-the-film) being the sound, not the picture.
  Something on screen that visibly sounds in the first three seconds, a thing
  struck still shaking or a surface rippling from its source, invites the
  sound on. A sound-on badge or any other UI is a title
  ([carry a feeling in two channels](#plan-the-film)), a look most briefs
  leave out. A [fresh-eyes reviewer](#fresh-eyes-review) given the `--frames`
  strip, not the MP4, hears nothing: asked what sounds the film has and when,
  it names each caused sound it can read from the picture
  alone. The sound still starts with the picture, so a viewer who unmutes
  early hears the place, and the `--sound` strip shades no silent span at the
  start ([voices, a place and a room](sound.md#voices-a-place-and-a-room)).
- **It reads at phone size.** [Frame for a phone](#camera-and-framing) says
  what is lost small; the shot strip at about 360 px a cell, `--scale`
  equal to 360 over the box's width in design units (0.19 for a 1920-wide box,
  0.33 for 1080), with `--values`, shows what survives there: each subject,
  each beat's acting part and the depth order; a phone loses whatever is told
  apart only in the darkest level.
- **A loop's last frame leads into its first.** In a looping film the frame
  after the last is frame 0: a moving thing that crosses the seam at the speed
  it had, a cycle that fits the film a whole number of times ([pace](#pace) for
  twos, [travelling wave](#travelling-wave) for `OMEGA`), a fade that happens
  neither at 0 nor at the end, and a [seam that sits in the rest](#plan-the-film)
  hide the join. `--at <(n - 1.5) / hz>,<(n - 0.5) / hz>,<0.5 / hz>,<1.5 / hz>`,
  the middles of the last two frames then the first two, as one strip with
  `--json` shows the seam: on a clean one the step across it, the third cell's
  `change`, is about the size of the one-frame steps on either side, the
  second's and the fourth's, where a pop is a step far larger, and anything in
  one cell only shows. A cell
  whose shot differs from the cell before's shows no `change`, so a seam that
  crosses a cut is judged side by side.
- **A loop's sound tail is laid over its start.** For a looping film the
  export (`renderSound` in `core/render.js`) renders what still rings past
  the last frame, up to six seconds and never more than the film's own
  length, and adds it to the first frames: a voice ringing on the last frame
  goes on over frame 0, as it would if the loop were heard twice. So a voice
  near the end keeps its decay and its room; only what it would ring beyond
  six seconds is lost. A voice cannot start before 0 to wrap itself, and one
  that starts past the end is heard at the start. A seam meant to rest in
  sound as in picture still ends every voice early enough that its body
  (`at` plus attack, hold and decay, or `tail.rise` plus `tail.length`, with
  a fifth more decay for a voice with `vary`) plus the `size` of the room it
  plays through (1.6 s by default) is over before the film ends. The place's
  ambience already rises and falls over its `fade` at each end (1 s by
  default, on a raised cosine), so its `length` is sized to end at the film's
  end rather than given a fade of its own; the ear takes that dip as the place
  breathing when the seam is the rest. On a
  `--sound` strip, whose panel spans the whole film on one time axis, the RMS
  line shows it: at the -60 dBFS floor at the panel's first and last columns.
  A seam that rests in the place's ambience touches that floor only briefly,
  under the 0.5 s the strip shades as silent; a shaded span at either end
  means the seam rests in silence, heard as the film stopping.

### Plan the film

The plan for a film with a story or a progression: one sentence, a spine, a
beat sheet in seconds, a cue table. It finds a beat nobody can point to and a
scene that could move without changing what follows, while a fix is cheap. A
piece with no protagonist plans intensity instead; a brief that gives the
story is not asked for one: its words are the sentence. A brief of one line
gets [the treatment](#the-treatment) first, which gathers the plan below and
the choices the brief left open.

**The story before the beats.** When the brief gives none, a concept found with
[find the idea](making.md#find-the-idea), rather than the brief's first
answer, gives the film its one sentence: what it is about; parts, places and
plot may change in the making, that may not. A sentence that takes a side,
"order holds only as long as its weakest cell", carries more than one that
reports events; if it would fit any other subject, it describes the look. A
film made from a source, such as a text, a song or a data set, also writes
the one thing from it that survives, and cuts or invents the rest freely:
no scene exists only because the source has it. Then the
spine, one line each, in this order: the subject and what it wants;
what stands against it; the inner obstacle; the need; what is lost if it
fails; what it does every day; until one day...; because of that... (as many
links as the length holds); the crisis, as the crisis bullet below builds it;
until finally...; ever since. The subject can be a figure, a form, a material or a
data series: a drop that wants the sea, a grid that keeps its order until one
cell fails. What stands against it can want the opposite or not care at all,
such as wind against a kite or noise against an order. Show what would be lost
whole in an early shot, before anything threatens it. Under the first line,
what the subject does to get what it wants and why that should work in its
own eyes: a means that follows from the want reads as the subject's own, and
an absurd one reads once an earlier shot sets up why the subject trusts it; a
reviewer shown only the frames can say both when both are in the picture.
The need is what the subject lacks, which it may not know; the turn, the late
climax, crosses from the want to the need: the final image gives the need,
whether or not it gives the want.
For a form or a process with no mind, the need is the state its want works
against, such as the stillness a spreading wants to fill. The inner obstacle
is what in the subject's own body or form works against its goal, such as a weight in what
wants to rise or a gap in what holds, shown at work in the subject's first
shot: a weight that only looks heavy reads as styling until it drags.

**A piece with no protagonist plans intensity, not plot.** A field, a material
or a light still has a first state, a development and a changed last state.
The order of its states in one sentence (calm, strain, break, stillness), each
contrasting with its neighbours, and the one quantity that carries it named:
a palette that cools, a density that thins, an order that loosens. Two scenes
that swap without changing the reading hold one spare.

- **Each scene causes the next.** Scenes, and every link of the spine, linked
  by "because of that" rather than "and then": a scene that could move or go
  without changing what follows is one the film can lose.
- **One effect surfaces late.** At least once, an effect shows a while after
  its cause, inside the scene as it goes on rather than held for a cut: a
  crack spreads seconds after the knock, while the subject is busy with
  something else. In the beat sheet, the effect's beat names its cause's beat
  and falls in the same shot, at least one beat later.
- **The pattern set, then broken.** The ordinary rhythm shown long enough to
  be expected; the break is the moment it breaks, early, and distinct from the
  turn, which is the late climax. A break within the first quarter of the
  film, and within 20 s of any film, comes before the viewer settles.
- **The conflict gets worse two or three times.** Between the break and the
  turn, two or three events, each a different attempt rather than the same
  one again, with one named quantity that grows across them: size,
  speed, count, spread or loudness. The scaffold's `rise` holds it at each
  beat (the scaffold refuses one that does not grow).
- **A hold-back, then a commitment.** In a film over about a minute, the
  subject holds back once before it commits to its attempt, then a worsening
  leaves it no other choice. The beat sheet then names the hold-back beat, a
  later beat whose `rise` is higher, and the commitment after it.
- **Before the true find, one or two false ones.** When the subject searches
  for something, one or two finds that seem right and fail before the true
  one give the search its cost. Each failure shows the path it could have
  taken, such as the opening it missed still in view as it falls back; `--at`
  on each false find's failure shows whether the frame holds the path not
  taken.
- **The crisis is a choice between two wants.** Just before the turn, the
  film's own rules make two things the subject wants exclusive: getting one
  loses the other. Both in one frame before the choice, and the one given up
  lost physically, it breaks, falls, leaves or goes out; one that only stays
  behind unseen has not been lost. `--at` on the choice's frame shows both in
  it; after the choice beat, the given-up thing's cue-table row exits, or
  steps to a broken entry of its `states`, and a beat names that change.
- **The goal's distance and visibility follow the story.** Where the subject
  wants a place or a thing, each shot plans how near it is and whether it
  shows: plainer as attempts gain, farther as they fail; one size in plain
  view throughout says nothing. At the low point, the crisis, the way out is
  hidden, far or behind the subject. The turn is an act on screen, by the
  subject or the world, that brings it back; the goal's light, size or colour
  ramping with no cause in view reads as the film cheating. On a shot strip,
  the goal shows smaller, covered, out of frame or behind the subject in the
  crisis shot than in the first, and the turn's beat names the act that
  changes it.
- **Every beat changes a state**, not only a position: something is found, lost,
  joined, broken, filled or learned. A beat where a thing only moves is travel,
  which reads best short. After each event, the subject, or what stands near
  it, gets a beat to respond: in the beat sheet, a response beat follows every
  event before the next event's cue.
- **Beats name only what is seen or heard.** "The thread snaps and the bead
  rolls to the edge" is a beat; "it feels abandoned" is an inner state, which
  becomes a beat as an action, a change of shape, light or sound. A time strip
  with `--at` about 0.5 s before each beat and 1 s after it, at sheet size
  with no crop, shows whether the change the beat names can be pointed to; a
  change nobody can point to did not happen, and gets enlarged or cut.
- **The scope fits the length.** Under about a minute: one subject, one turn,
  two or three scenes. Condensing comes before cutting: one element stands for
  a crowd, its traces for many events. A story that still needs more reads
  better cut than rushed.
- **The final image comes first.** It answers what the break asked and pays
  off something planted earlier, such as the opening image changed or a
  [motif](#continuity), and holds long enough to read. Three candidates drawn
  as stills show which feels inevitable once seen but that a first viewer
  would not name in advance. A final image that holds every subject the last
  beat names, whole inside the frame and readable at sheet size, keeps what
  [find the idea](making.md#find-the-idea) asks of the logline's nouns; the
  last cell of a [time strip](#look-at-a-film) with `--frames` shows each
  subject of the last beat, or an edge that cuts one. The last frame and the
  turn's frame at their [frame middles](#look-at-a-film), the last one at the
  duration minus half a frame, with
  `npm --prefix "<library root>" run seeds -- "./my-piece.cjs" --at <last>,<turn> --png`
  (or each saved with `npm run still`), set beside the postcard and the looks
  to leave out that the plan names, show a frame that matches one, and
  whether a visible sign of each relation the logline states is in them, as
  [find the idea](making.md#find-the-idea) step 7 asks. The cause of the
  turn planted two or three times, each plainer than the last, in the
  background, in passing, in view, makes the turn earned. Beside the final
  image, the one precise feeling it leaves, such as relief or longing rather
  than only happy or sad, and what the ending cost: the first and last frames
  side by side show something the opening held that is gone or changed in the
  last. An ending that closes a question the film did not raise answers
  nobody.
- **Choose the spine's shape.** Linear runs from a start to a changed end;
  circular returns to its opening image changed, the natural shape for
  `loop: true`; parallel cuts between two lines that meet at the turn. A loop
  still rises, peaks and rests, with its seam in the rest: the first and last
  beats of the beat sheet have its lowest intensity ([where it plays](#where-it-plays)
  checks the seam in picture and sound).
- **Choose a frame, and take three choices from it.** Name the genre or
  register the film is told in, such as a chase, a fable, a lullaby, a comic
  routine or a quiet record of a process, and write it beside the spine as
  Frame. Under it, write the dominant transition, the guiding sound (a film
  the music tells takes it from [music](music.md#when-music-leads)) and the
  camera style that follow from it. A chase might take
  [zip pans](#continuity) joined at their middles, a pulse that quickens and a
  view that follows with lag; a lullaby [dissolves](#dissolve), returns to one
  slow melody in every scene and holds the view still. A comic routine plans
  each gag as [a comic beat](#a-comic-beat), and an explainer its acts as
  [a film that explains](#a-film-that-explains). Taken from one frame,
  the three agree, so the film reads as told one way; chosen one at a time, a
  still view between zip pans under a racing pulse reads as two films. One
  continuous track as the dominant transition gives up the cut's change of
  [shot scale](#camera-and-framing): the track still pushes in for each heavy
  beat and pulls back for travel. The
  frame sets how the story is told, not what it is about, under one
  [finish](#film-finish) over all. A [shot strip](#look-at-a-film) shows it:
  most scene changes between rows are the dominant transition, and each row's
  camera keeps the style except on a beat that
  [needs a break](#camera-and-framing); with `--sound`, the guiding sound's
  band runs through the spectrogram under every scene.
- **One question left open, or none, on purpose.** Written in the spine as
  Left open. Every other question a beat raises is answered by a later beat.
- **A law the film teaches holds.** Each constant of the world, such as a
  gravity, a speed or a rule of growth, kept in one named place in `build` and
  changed only at the turn, on a cue the beat sheet names, stays one law; its
  number appears once in the source.

**Seconds before code.** A beat sheet under the spine holds each scene's beats
in seconds, each beat's intensity and the state it changes, the background
action that runs under it, a sound line (what is heard, and what it adds that
the picture does not show), and for each transition the physical event that
links one scene's shape to the next. It lives in the piece's header comment
beside its [looks to leave out](#looks-to-leave-out), then becomes one cue
table in frames, as `examples/cues.js` does; `time` itself takes `duration`
in seconds and `hz`, never a frame count. The cue table has one row for
each thing that lasts on screen, a figure, a prop or a place, and none for a
pose or an action: a pose is how a figure looks at a beat. A thing that
returns across scenes also lists its states there, one per scene
([a thing that returns carries the time](#continuity)); a prop's row also
says where it is in every shot. Each beat names the
row whose state it changes. The scaffold's `BEATS` holds the beat
sheet as data, and its build checks it ([what it refuses](#build-the-film-in-order)).

**What the viewer knows at each beat**, against the subject: less, the
same or more. A cause shown before the subject meets it is suspense; kept out
of the frame until it lands, surprise, or withheld by staging: the reaction
before its cause, or the cause revealed from behind a near layer, so the
reaction's first frame comes before the cause's. A look out of the frame is a
promise: the next view shows what it sees, or a question the beat sheet
answers at a named beat. The want shows as an action in the subject's first
shot, beside the inner obstacle: a reviewer shown only that shot's frames
names both.

**A shock is two or three changes on consecutive frames, in a planned
order**: the light first, then what it reveals, then the cause, one per frame;
all on one frame, they read as one change. The beat sheet holds the order,
and `--at` at [frame middles](#look-at-a-film) on those frames shows each
differing from the frame before it only in its planned change.

**Whose scene it is.** For each scene, the beat sheet names the subject
whose point of view the film takes there, and side the view with it: its front
shows most ([two or more subjects](#two-or-more-subjects)). A piece with no
protagonist names the element each scene follows. When it is unclear whose
film it is, the spine's first line tried from two or three elements, such as
what moves, what it moves through and what it leaves, keeps the one whose
state differs most between the first and last frames.

- **A feeling carried in two channels at once**, light and palette, framing,
  the place going wrong, pace or sound, reads; one prop that stands for it
  is a symbol. Type is a thing in the world or a title; the theme spelled
  out is a caption. One channel carries a beat alone when
  another is dropped on purpose and the drop is named in the beat sheet, such
  as the subject hidden in shadow while its sound goes on, or the sound cut to
  silence while the picture moves.
- **One opposition, each side with its own mark technique.** One named
  opposition, such as enclosed and open, dense and sparse, or still and
  moving, gives each side its places, palette, bed and way of making marks,
  and the turn crosses it. One side might draw a clean outline around flat
  colour, the other a broken edge over grain and soft gradients, each
  technique held on its side for the whole film. The viewer then knows a
  frame's side from its marks alone, before the place reads, and a mark of one
  side found on the other reads as that side's reach, as an owned colour does.
  One [finish](#film-finish) over all makes them one film, while the
  techniques keep the sides apart; a side given its own grain or tint in place
  of its own marks reads as another film. A [shot strip](#look-at-a-film)
  shows it: each row's side, and the other side's technique on a row where the
  beat sheet plans no crossing.
- **A change of box can mark another time.** A piece with a `reframe` timeline
  can give a memory, a dream or another time its own box: a pillarbox, narrower
  than the frame with bars at the sides, or a letterbox, wider in shape with
  bars above and below. That box kept for every shot of that time, with the
  main box back when the film returns, says by shape alone which time is on
  screen, with no title, as [strata of time](#colour-across-the-film) do with
  saturation. The box's move sits inside the scene change into that time,
  [rest to rest](#camera-and-framing), and the frame outside the box painted
  one plain colour makes the bars read as the box's edge, not as more
  picture. A film that also [changes the box with the feeling](#camera-and-framing)
  gives each meaning its own shape, or neither reads. A shot strip shows
  whether every row of that time keeps its box and no other row has it.
- **The first two seconds as a hook**: a glimpse of the end without its
  cause, or a sound before its source, within the first second where the film
  [autoplays in a feed](#where-it-plays).
- **How each scene opens.** The beat sheet names what the viewer meets first
  in each scene, and the scene's first frame shows it:
  - The place: a wide view that holds the subject small and, in view, the
    cause of the turn, so the opening also plants it.
  - A detail: a close crop the view pulls back from. The first frame hides the
    place, and when the crop holds only part of a larger thing, what that
    part belongs to, until the pull-back shows them. A recognisable part
    still reads as itself, such as a wheel's rim and spokes.
  - The middle of an action: the first frame shows that the action began
    before it, such as the track already behind a moving subject. Without that
    sign, the first frame looks the same as a subject about to start.
  - The subject's traces before its face, such as a track, a shadow, a dent or
    something knocked over. Traces first make the opening frame a question
    that the view answers when it finds what left them.
- **Who, where, when and what, planted in each scene.** One thing in view per
  scene, listed in the beat sheet, answers each of four questions: who the
  subject is, shown by something it keeps, carries or leaves behind; where
  the scene is; when it is, as the hour, the season or how far the story has
  run; and what the subject is doing. One thing may answer two; a question
  with no planted answer stays unclear. A duration shows in things that pile
  up, such as a third mark beside two, a heap that grows or a shadow that has
  moved; a title says it without showing it. A
  [fresh-eyes reviewer](#fresh-eyes-review) shown only one scene's frames
  names all four when each answer points to a thing the beat sheet lists; on
  a time strip across a scene that shows time passing, the piled-up count
  grows from cell to cell.
- **A key subject met whole, large and held.** The first time the film shows
  a subject the spine names, after any traces that announce it, a beat of its
  own meets it: whole inside the frame, at the largest framing that still
  holds all of it, and settled in a deliberate pose held as a beat of its own,
  commonly a second or so and never under the quarter of a second, six frames
  at 24 fps, a pose needs to
  [be read](#plan-poses-before-motion). A scene that opens on a detail of it
  meets it when the view pulls back to the whole; a scene that opens on the
  place, holding it small, meets it at the first closer framing that holds it
  whole. A subject first seen only in a crowd, cut by an edge or in passing
  has not been met. On a shot strip, the row where each subject of the spine
  is met shows it uncut by an edge, with its whole extent filling most of the
  frame's limiting side; `--at` at that row's
  [frame middles](#look-at-a-film) shows its pose unchanged, apart from a
  held pose's drift, over a quarter of a second of consecutive frames.
- **The plan drawn before the shots.** For each scene, the place drawn once
  from above, where each subject stands and which way it faces, the line of
  attention (between two subjects that face each other, or along the action),
  the key light, the entrances, and a mark for each view the beat sheet
  plans, shows on one drawing, not frame by frame, whether every view of the
  scene stands on one side of the line, except a crossing the beat sheet
  names, made inside a shot or through a head-on view
  ([screen direction](#continuity)). In the scaffold, each shot's `BLOCKING`
  row holds its subjects' design points as `marks` and the line's two ends as
  `line`. `seeds --plan` draws
  them and flags in red a shot that shows the two ends in the other
  left-to-right order after an earlier shot of that line, unless its row
  names the crossing with `cross: true`. A shot whose ends are under a
  twentieth of the frame's width apart is head-on, and the next shot may take
  either side.
- **Keep the extremes for the peak.** The tightest frame, the steepest depth
  (a near plane drawn large and passing fast over a far plane drawn small and
  flat) and a roll, where the world going wrong earns one, are a budget: spent
  from the first shot, they make the peak's frames match the calm ones. A
  scene change where [a detail carries the eye to the next place](#continuity)
  and neither shot holds the peak (the first beat at the film's highest
  `intensity`, `s.cues.peak` in the scaffold; a shot holds it when the shot's
  first to last frame contains that frame) stops a framing step wider than
  the peak's frame.
- **The clock in the last stretch.** When the end races something, and in
  the last act of any film over about a minute, the deadline in the frame,
  such as a light going down, a level falling or a gap closing, lets the
  viewer feel it run out, its state differing in every cell of a time strip
  of that stretch. When the end races something, shots, motion and
  sound quicken as the clock runs out; otherwise the clock runs at the Frame's
  own pace, so a lullaby's light goes down under its still view and slow
  melody. The response beat after each event stays as the cuts quicken but
  shortens with them, down to the quarter of a second under which it is
  missed, and the last event before the end gets a full one.
- **Line and shape language turn with the story**, as
  [shape language](stills.md#shape-language) describes for stills: the line
  language follows the intensity, with diagonals kept for the peak, and each
  place's shape class is keyed at the turns of the beat sheet, so the world
  changes with the subject: blocks that soften as it opens, a ground that
  sharpens as the threat closes in. Carry the subject's own arc in one
  property of its shape, such as roundness, saturation or size, moved one step
  per scene along one curve, so any frame shows where it stands: on a
  [shot strip](#look-at-a-film), whose rows are shots, the property steps
  once between the first rows of consecutive scenes and holds within a scene.
- **A trough earns the peak.** Just before the heaviest beat, a shorter
  stretch is quieter, sparser and lower in contrast, in picture and sound
  together. After each turn, a still stretch whose look inverts what came
  before; a cut from a turn straight into more action spends the turn. At the main turn,
  the inversion can be of figure and ground (a dark subject on a light ground
  becomes a light one on a dark ground) held to the end, so the final image
  reads as the changed state even where its framing and lines return to those
  of the opening.

#### The treatment

A treatment is what a director writes before anyone builds a set: the whole
film on paper, in the header comment beside the spine, the beat sheet and the
looks to leave out. It shows a beat nobody can point to, a view with no
reason and a gap the user would have been asked about while a fix costs a
line. It is the way a brief of one line becomes a film; a complete brief,
with its own beat sheet and looks, needs none beyond its words, which are
copied into the header as written and only their gaps filled. Each part is a
line or two, and points at the section that holds its knowledge:

- **The subject**, and for a real one what happened and the moment chosen
  from it, as [find the idea](making.md#find-the-idea) reads a brief.
- **The story**: the one sentence, the spine or the order of states, and the
  beats in seconds with their intensity ([plan the film](#plan-the-film)).
- **Length and format**: the box, the seconds, the rate and whether it loops,
  from [where it plays](#where-it-plays), with the scope fitted to the length.
- **The shot list**, one row per shot: its name and seconds, whose scene it
  is, the beat it carries, the angle (front, three-quarter, profile, from
  behind, head-on), the height (level, high or low, with the horizon it
  sets), the lens (how far apart the depths spread), the movement (still,
  pan, track, push-in or pull-back, with its cause and its landing), the
  framing (extreme wide to extreme close, open or closed), what is in frame
  and what is kept out. [Camera and framing](#camera-and-framing) says what
  each choice does and when a film takes it.
- **Staging**: the plan from above per scene, each thing's place and facing,
  the line of attention and the entrances
  ([the plan drawn before the shots](#plan-the-film)).
- **Light and time of day** per scene: the condition, the key and the
  contrast range ([colour across the film](#colour-across-the-film),
  [time of day, weather and night](materials.md#time-of-day-weather-and-night)).
- **The palette**: the colour strip, each place's owned hues and the hue kept
  for the turn ([colour across the film](#colour-across-the-film)).
- **The style's marks and drawing order**: which mark draws each class of
  thing, the order laid (ground, masses, edges, lines, accents, texture) and
  the line weight ([named styles](named-styles.md),
  [line weight](stills.md#line-weight)).
- **Motion and timing**: the Frame's camera style and dominant transition
  ([plan the film](#plan-the-film)), [one body physics](#one-body-physics)
  for every figure, the [pace](#pace), and cuts on whole frames.
- **Sound and score**: the sound line per beat, each caused sound with its
  cause in frame, the ambience and the room, and any score kept under the
  caused sounds ([voices, a place and a room](sound.md#voices-a-place-and-a-room)).
- **The final image** as a still, with the feeling it leaves
  ([the final image comes first](#plan-the-film)).
- **`Chosen, not given:`** one line per choice the brief left open, what was
  chosen and what else it could have been. The report to the user repeats the
  list, so the user redirects after seeing the film.

A shot list for an invented brief, "a kite over a field at dusk", 12 s:

| shot | s | scene | beat | view | in frame | light | sound |
|---|---|---|---|---|---|---|---|
| field | 0-3 | the flier's | the kite will not rise | wide, level, wide lens, still; from behind the flier | the field, the flier small, the kite low and far; the sky a strip | low sun behind the flier, long shadows | wind in grass, the line creaking |
| line | 3-6 | the flier's | a gust takes the line | close, low, long lens, push-in on the tug; three-quarter | the hand and the line only; the kite kept out | the sun's last warmth on the hand | the line hums, the grass quieter |
| climb | 6-10 | the kite's | the kite climbs | medium, high, wide lens, pan up from the hand to the kite; profile | the kite whole against the sky; the field's edge leaving the frame | sky cooling to violet | the wind rises, the creak stops |
| held | 10-12 | the kite's | it holds as the light goes | extreme wide, level, wide lens, still; front | the kite a point, the flier a mark, the field dark | the sun gone, one warm hue kept on the kite | wind alone, fading |

#### Plan intensity with the story

Each beat gets an intensity from 0 to 1, and one line per visual component
(space, line, shape, tone, colour, motion and rhythm) says whether it is held
for the whole film, and at what; progressing, from what to what across which
scenes; or following the intensity. Most hold and one or two move. Contrast
within and between shots raises intensity and agreement lowers it, so the
peak is built from contrast and the final image from affinity: one line
direction, a narrow range of tones, related hues, little motion. Intensity says
how much, not what kind: a sad or tender turn that is not the peak can build
through growing quiet or ease, and a turn can invert it. A time strip's
`--json` with about three cells a second (`--frames` three times the film's
seconds) shows it; its `beats` gives one entry per beat: the beat with
`peak: true` (`s.cues.peak` in the scaffold) has the largest `change.max`, at
least twice the median `change` of the cells in the beats at intensity 0.4 or
less; a cell's change, from the cell before it, counts in the more intense of
the two cells' beats, the later on a tie, so the peak keeps its onset and its
drop, and a peak with no cell in it reads `null` (`--frames` raised until a
cell lands in it). The ratio is relative: a nearly still film passes it with
a peak nobody can see, so a loupe crop also shows the peak's change in
absolute terms where it happens: `--at` on the frames before and inside the
peak with `--loupe` on the part that changes, and the change reads on the
100% crop without comparing pixels. A push-in thins particles placed in the world, such
as rain, snow, dust or sparks: the scaffold scales an element by
`k = zoom * dolly ** depth`, so the frame keeps 1/k² of them, each k times
larger (depth 2 under `dolly: 1.5` keeps about a fifth). Their density holds
when the push uses `dolly` with `zoom` fixed and they sit in screen space,
such as on an element at `depth: 0`, which then neither grows nor travels
with the camera and takes its own drift; `zoom` scales every layer, `depth:
0` too. Otherwise k² times as many spawned over the part still in frame hold
it, and `--at` on the push's last frame shows whether as many particles show
there as on its first frame. With `--sound`, the loudest of `sound.profile.events` falls in the peak
beat too (its `loudestDb`), louder than every event outside it, and stands at
least 3 dB above the highest `loudestDb` of those quiet beats, where `null`
counts as -60 dB. Events miss sustained sound: a bed, drone or swell that
rises less than 12 dB is no event (one fading in from silence within about 50 ms is one; a slower fade is none), so every quiet beat's `rmsDb.max` also
sits at least 3 dB under the peak beat's `rmsDb.max` when the peak carries the sound. When the loudest
events tie, `sound.level.limited` says why: past about 4 dB the limiter is
levelling the hits ([voices, a place and a room](sound.md#voices-a-place-and-a-room)).
The range widens by making the low beats quieter and stiller rather than the
peak busier, building the peak from contrast, and
[keeping the extremes for the peak](#plan-the-film): its tightest frame and
its loudest hit.

#### A comic beat

A gag is [a pattern set, then broken](#plan-the-film) within one beat. Beside
each comic beat, three things written as what is seen or heard: the setup, the
expectation it builds and the reversal that breaks it. For example, a lid is
pressed shut three times, each push firmer (setup); it should now stay shut
(expectation); it stays, and the box's side springs open instead (reversal).
`--at` on the setup's frames shows whether a reviewer shown only those can
name the expectation, while the reversal's frame shows something else.

A gag can release a grim beat when it comes soon after and draws its pattern
from the scene's own rules, such as [a law the film teaches](#plan-the-film)
turned on itself; a joke from outside the world breaks the world. The gag's
setup frames then show the rule it breaks before the grim beat.

- **The one it happens to takes it, then holds.** After the reversal, the
  figure or thing it happens to gets a [take](#takes-and-accents), then a hold
  at least as long as the take before the next beat's cue: the response beat
  after an event, played as a take. A time strip with `--at` at
  [frame middles](#look-at-a-film) across the take and the hold, plus
  `--json`, shows it: each hold cell's `change` well below the accent cell's,
  so a breath or idle sway in the hold stays small, and the next beat's first
  move after the last hold cell.
- **Push the key pose past the natural one.** The extreme of the reversal or
  the take goes further than the motion would really carry it: a longer
  stretch, a flatter squash, a deeper bend of the
  [line of action](#silhouette-and-line-of-action), and on the fastest frame a
  smear, the part drawn stretched along its path rather than the shutter blur
  of the [finish](#film-finish). A squash or stretch keeps its volume
  ([takes and accents](#takes-and-accents)), and only a rubbery cast squashes,
  stretches or smears its parts ([one body physics](#one-body-physics)); a
  painted figure of either cast still stretches in its joint gaps
  ([takes and accents](#takes-and-accents)), and a skeletal cast
  pushes a joint's angle or the line of action instead. The rest pose and the
  extreme drawn with `--at`, once with the push and once without it, measured
  on one property, such as the stretch ratio along the move or a bend angle,
  show the push: the pushed extreme differs from the rest pose by at least
  one and a half times as much as the unpushed one does.

#### A film that explains

A film made to explain, such as a concept, how a thing works, a history or a
data set, is planned as a story whose subject is the idea: the beat sheet names
the one thing the viewer learns at each beat, and the final image holds what
the viewer now understands. Its still form, with honest scales, a frame that
reads alone and the form that fits the data, is [data images](data-images.md).

- **The act shape follows what the viewer needs.** Three shapes cover most
  explainers, and their acts become the scenes:
  - A question: a hook that asks it, a counter-intuitive point that makes the
    obvious answer wrong, then an everyday analogy that makes the right one
    familiar. A director uses it for a concept the viewer thinks they know.
  - A mechanism: the problem, the mechanism in three steps, one proof that it
    works, then its name. The name comes last, so the word lands on a thing
    already seen; used for how something works.
  - A tour: an overview, the life of one item through the whole, the core
    parts, then a real trace of it at work. The one item followed stands for
    many, as [condensing](#plan-the-film) does; used for a system, a product
    or a history.
- **One idea per shot.** A shot that carries one idea gives the viewer one
  thing to look for; a second idea in the same shot goes unseen. A short
  brings a new idea about every 1 to 2 s, the convention of feed explainers
  rather than a measured limit; a page or a room screen gives each idea
  longer, as [cut rate is thinking rate](#pace) says. That rate is faster
  than the frantic one in that section, so a short uses it for the ideas
  that read at a glance; a shot that carries a label still holds until the
  label, fully drawn, reads aloud slowly, as
  [text in the frame](making.md#text-in-the-frame) asks.
- **Reveal in the order the reasoning needs.** A part shown before the step
  that uses it is noise until then; shown at that step, it answers a question
  the viewer already holds.
- **A part gets its name and one line on what it does**, beside it, as
  [text in the frame](making.md#text-in-the-frame) sets size, place and
  hold. A name alone teaches a word; the line teaches the part. A label drawn
  on [grows like any mark](#draw-the-drawing), after the part it names.
- **Simulate a process rather than drawing it.** A flow, a spread or a
  collision run by its own rule, with [`simulate`](#parts-coupled-in-space)
  or [a law the film teaches](#plan-the-film), shows the behaviour the film
  claims, including what nobody keyed; keyed motion shows only what the
  painter expected. A simulation that bears the claim out is the proof beat.
- **Real numbers, with their uncertainty.** A figure from the user's source
  shows as given, with its range or an "about" where the source has one; a
  precise number with no source reads as fact and is not one. With no figure
  given, the film shows the relation, such as more, faster or twice, without a
  number.
- **Unit marks, one mark per fixed amount.** A quantity drawn as a count of
  like marks, each standing for one stated amount, lets the eye compare
  without reading a scale. The amount per mark, written once in the frame,
  holds for the whole film, so two shots compare.
- **A counter lands on the real value.** A number that counts while its mark
  grows makes the size felt, and ends exactly on the source's value, rounded
  to the source's precision, then holds. With `places` the decimal places the
  source gives (0 for a whole number), `(Math.round(value *
  ease.out(span(start, end, clock.seconds)) * 10 ** places) / 10 **
  places).toFixed(places)`, with `ease` and `span` from `core/time.js`,
  reaches `value` at `end`, so 2.7 lands on 2.7 and 3.45 on 3.45. A rate that overshoots, such as
  `ease.back`, shows figures the source never gave. `--at` on the landing
  frame shows the exact value.
- **The user's copy kept verbatim, and no fact invented.** Names, figures and
  lines the user gives appear as written, as
  [the treatment](#the-treatment) keeps a brief's words; its `Chosen, not
  given:` list covers looks, never facts. A fact the film needs and the brief
  lacks is asked for in the report, or the film shows the relation without it.
- **It explains with the sound off.** Where the film
  [plays muted](#where-it-plays), each idea reads from the picture and its
  labels alone. A [fresh-eyes reviewer](#fresh-eyes-review) given only the
  frames, asked what the film explains and its steps in order, names them.

#### Colour across the film

**Plan the colour as a strip of small panels, one per scene.** Draw each panel
as its few largest areas only, such as the background, the middle distance
and the subject. Give each place its own local colours and keep them for every
scene set there, then colour each area as its local colour times that scene's
light. The light then
carries most of the change from panel to panel, and the places stay
recognisable under it. Put the same white object, with one side facing the
light and one turned away, in every panel: it shows the colour of the light
more plainly than any other area. List each scene's lights (key, fill, any lamp
or screen in view) as one chord of hues that agree with each other and with
their sources, by [one light plan](materials.md#one-light-plan), and name the
one that [reads as white](materials.md#one-light-plan): the white object's two
sides then show the key's and the fill's colours, and every local colour stays
in its hue family under each light. The white object's side under the white
source stays neutral and its side under every other source shows that
source's kind on [the warm-to-cool scale](materials.md#one-light-plan), unless the panel keeps a cast for its mood. Where a panel's key puts
subject and ground at one value, also set them warm against cool, beside the
rim or darker ground [the focal preset](stills.md#art-direction-preset-focal-composition)
asks for, not in its place, so the separation still survives greyscale.

- **List the palette and delete the rest.** Viewers remember colour poorly, so
  a few hues held strictly read as a world; every stray hue weakens it.
- **Give each panel a key and a contrast range**: low (deep darks, little lit
  area) or high, and let the keys follow the intensity curve. Name each
  panel's daylight or weather condition beside its key, such as low sun, noon,
  afterglow, moonlight, overcast, fog or lamp-lit night, so the key comes from
  a light that exists ([time of day, weather and night](materials.md#time-of-day-weather-and-night)).
  Where a section changes [mark technique](#plan-the-film) from the one
  before, such as wash to hatching, note the new technique on its first
  panel, so the [tone check](#look-at-a-film) reads that step as planned.
  Check on the whole-film strip: each panel's white object shows its condition's key
  and fill colours, judged against the panel's white source, and panels of one place in one continuous time share a
  condition unless the light changes on screen between them. Beside the key, also
  write the lightness of the panel's darkest and lightest large areas, such as
  0.05 to 0.45 (OKLCh L): narrow where intensity is low and in the final image,
  as [plan intensity](#plan-intensity-with-the-story) asks, and widest on the peak, the
  heaviest beat, as keeping the extremes for the peak asks. Check on a
  whole-film strip with `--json`: each panel's `lightness.p5` and
  `lightness.p95` sit within 0.05 of the panel's two values, and the peak's
  frame has the strip's largest `p95` minus `p5`. A declared two-value film
  (below) keeps one range throughout, so its peak carries the beat by the
  area, placement or edge of its two values instead. `min`, `max` and `range`
  follow one small highlight or speck; `--values` shows where the large areas
  are. Give each panel a saturation level
  too, such as 0.6 for the open place and 0.2 for the closed one, and scale
  every colour of the scene by it; the strip then shows the steps at a glance.
  Drop the level near grey only in the turn's own panels, after the complement
  stretch below, and leave the turn's reserved hue out of it there: the
  reserved hue then
  [dominates by draining its surround](materials.md#greys-from-the-accents).
- **A frame spread over many tonal steps reads; two read flat.** Even a low-key
  frame runs from deep darks through several mids to its small lit area; two
  flat levels with nothing between read flat and tiring. An ink-and-paper style
  makes its steps from mark density (hatching, screentone, dilution), not
  fills. A film held to two values on purpose, such as flat silhouettes or a
  figure-ground inversion kept to the end, is exempt too, and adds no mid-tone
  to pass: declare it once in the beat sheet, beside the colour strip's keys,
  as `two values: <dark L>, <light L>` (OKLCh L, such as
  `two values: 0.12, 0.88`). Write it as a comment line that opens with it,
  `// two values:`, `/* two values:` or ` * two values:`; seeds reads only the
  first such line (a line still holding the `<dark L>` placeholder is passed
  over; any other value opening with `<` is passed over with a warning), and prints a `warning:` on stderr quoting each later one and any
  other line with a digit after `two values:`, such as one after code or a
  dash; prose that does not open the comment and has no digit stays silent
  ([two values](../../../docs/knowledge/command-line-tools.md#two-values)).
  Check a declared film on a whole-film strip with
  `--grey --json`: the two values differ by 0.2 or more, seeds reads the
  declaration and no cell is in `window.__sheet.flags.between`, which lists
  each frame with more than 2% of its pixels more than 0.05 from both values,
  and the grey view shows only those two greys, with mid greys only in a
  thin band along edges. Judge that on the grey view, not the value view: the
  value view blurs fine detail into a mid area and can put both values in one
  level. A frame with two flat levels and no declaration still fails the
  four-step check below. Each panel's key frame on the grey test view of
  [a distinction that survives greyscale survives every view](stills.md#art-direction-preset-focal-composition)
  shows four or more steps between its darkest and lightest areas;
  `npm --prefix "<library root>" run seeds -- "./my-piece.cjs" --at <s> --grey --values` draws that view
  and a 3-level value view under the frame. In a low key, a
  large form at the dark's value vanishes into it: give it one more step or a
  [caught edge](materials.md#light-decides-what-exists).
- **Grade twice: density, then mood.** First set each scene's light strength
  so its key frame sits at the panel's key and range: declare the strength as
  a parameter, sweep it at that frame, and keep the cell that carries the beat.
  The playhead is the frame's place in the film from 0 to 1, so second 6 of a
  16-second film is
  `npm --prefix "<library root>" run seeds -- "./my-piece.cjs" 3 0.375 --param density`. Then push each
  scene for mood, usually a step darker, through that scene's own light: its
  hue and its strength. The [finish](#film-finish) grade (`black`, `white`,
  `tone`, `toning`) is one print over every frame and keeps each pixel's
  lightness, so it sets the film-wide look, not one scene's mood; a scene lit
  for an effect keeps its unevenness, and a light that already carries its
  mood stays. [Look at a film](#look-at-a-film) says how a strip shows a
  result too light.
- **The eye eased out of a long dark.** After a low-key stretch of 5 s or
  more, a brightness raised over 2 s or more, rather than in one frame, lets
  the eye follow: the next scene opens dark and rises, or the change is a
  [dissolve](#dissolve). A [hard cut named as a full stop](#continuity) keeps
  its jump. A film that declares two values eases another way, since a
  dissolve's middle frames hold tones between them: the light value grows
  over the 2 s as an area, by a wipe or by a shape of it spreading. Either way the change stays within the
  [flash limit](#what-every-scene-holds). `--at` at frame middles 0.5 s apart
  across the return, plus `--json`, shows it: each cell's `change` from the
  one before rising and falling over four cells or more, not one spike between
  still cells, which is how a cut reads.
- **Write each panel as hue family, modifiers and medium**, such as "green,
  dark and greyed, as surface" or "orange, pale, as low light". The modifiers
  and the medium carry the panel's mood more than the hue does, as
  [colour by its modifiers and medium](stills.md#colour-by-its-modifiers-and-medium)
  explains. Decide per scene whether the mood lives in a surface or in the
  light, and write that in the panel: a scene whose mood is in the light keeps
  its places' local colours and changes only the light over them.
- **Reserve one hue for the turn** that no panel uses before it, and put the
  brightest, most saturated colour on the smallest area: the subject. The
  turn's hue is [one thing that happens only once](#continuity).
- **Hold the complement before the peak colour.** A stretch in the opposite
  hue makes the peak colour stronger when it arrives.

**Give each subject, party and place its own colour, and keep it.** Once a
hue belongs to one owner, it says that owner is present wherever it shows, so
colour can tell who reaches where without a word. Write the owners beside the
strip, one hue each, and put an owned hue on nothing else (a place's local
colours are the exception: a place may hold several, but none is another
owner's hue) unless a device
below moves it there. Give no hue a meaning brought from outside the film,
such as one colour that stands for calm: the film teaches each hue's meaning
through its owner, so on a whole-film strip each owned hue first shows on its
owner. Write in each panel the device that moves colour there,
where one applies:

- **Switch.** Two parties trade colours at the turn, so each has become what
  the other was: a cool form and a warm form exchange fills.
- **Spread.** One party's colour enters the other places as its influence
  grows, on more area in each panel: a green that starts on one tile ends on
  the walls of every room.
- **Creep.** A warning colour gains area in every scene, too little per cut to
  notice, so the threat grows on screen before any beat names it.
- **Show, then remove.** Make a colour intimate in a close shot, held long
  enough to belong to the subject, then take it away; its absence reads as
  the loss.
- **Bookends.** A colour opens and closes the film and appears nowhere between,
  so the last panel answers the first.
- **Repeat, then one full-force use.** Return a colour small and muted until
  the viewer expects it, then spend it once at full saturation and area, on
  the turn. It takes the place of a reserved hue: the turn's colour is then
  known, and only its force is new.
- **A literal colour becomes an omen.** A colour first seen as plain fact, such
  as the paint of a door, returns on the thing that brings harm, with nothing
  pointing at the link.
- **A light turns.** A light that draws the subject in, warm and soft, comes
  back from the same source hard and dark once the place has turned against
  it.
- **Strata of time.** Two times in one film each keep their own saturation,
  one drained and one saturated, so a cut between them reads as a jump in time
  with no title.
- **A small saturated thing held.** A subject in a pale, weak colour facing a
  stronger-coloured threat takes its force from one small thing in the strongest hue,
  which it holds or gathers and carries to where it meets the threat; the arc
  ends on the beat it no longer needs the thing and stands without it. The
  thing is the subject's smallest, most saturated area, so it keeps the
  brightest colour on the subject, as reserving a hue for the turn asks.

**One hue followed across a whole-film strip shows each device.** A time
strip of the finished film with `--frames` high enough that every scene has a
frame, one owned hue, and for each frame who carries it and how much area it
covers: the device reads only when that line shows its pattern. A switch
moves the two hues between owners at the turn and nowhere
else; a spread or a creep gains area frame after frame; a removed colour is
close, then gone; bookends hold it in the first and last frames only; a
full-force use is that hue's largest, most saturated frame; an omen hue sits
on its plain-fact owner early, then on the thing that brings harm, with no
frame between linking them; a turned light keeps one source whose hue and
hardness flip after the turn; strata split the frames into two saturation
levels that change only at the cuts between times; a held thing stays the
frame's most saturated small area, `saturated[0]` in the strip's `--json`
(a held thing under about two blocks across can rank below a larger form:
then `chroma.max` exceeds every listed `chroma` and the thing shows by eye),
while the subject's own colour stays pale, in every frame where the subject
faces the threat before the beat it lets the thing go, and in the frames
after that beat while the subject is still there, no area of its `hue`
remains. When the thing formed its own area before the beat, that absence
proves no area of its hue over C 0.1 remains only when `chroma.areas` is no
larger than the number of listed areas over C 0.1, so every such area is
listed; only a `saturated` list of fewer than three areas proves every area
of C 0.03 or more is listed, paler ones included. Confirm a paler trace, or any frame that fails
these counts, by eye: `chroma.max` is one pixel of any hue, so it cannot say
whether that pixel belongs to the thing.
A hue on anything its owner does not explain is a stray, and reads as one.

**Colour a place for what it means.** Where the meaning lives in a place
rather than in an owner, use one of these and write it in that place's panels:

- **Rhyme two places.** Stage the second place with the first one's light
  layout, the same sources in the same positions at the same values, and
  change only the hue family and chroma, so the second reads as an answer to
  the first: artificial secondaries in one, say, against greens and a sun's
  yellow in the other. Check on `--at` frames of both with `--values` and
  `--json`: the value views match, the sources sit in the same places, each
  frame's `lightness.p5` and `lightness.p95` sit within 0.05 of the other's,
  and the hue families differ.
- **Make a place hostile** by giving every saturated colour to the light
  sources in view (lamps, signs, screens) and none to the forms the story
  follows; the rest stays dark and low in chroma. The followed forms, the
  subject included, keep their owned hues there only as low-chroma versions
  of the same family ([light decides what exists](materials.md#light-decides-what-exists)).
  While the subject is in a hostile place, this rule outranks reserving the
  brightest colour for the subject: the subject's turn hue waits until it
  leaves, or the place stops being hostile. The one exception is a small
  saturated thing held, from the devices above: it keeps its full hue there,
  and is the only followed form that may.
  Check on `--at` frames of the place with `--json`: every `saturated` area
  with `chroma` over 0.1 sits, by its `x`, `y`, `w` and `h`, on a light source
  or the held thing, and none on another followed form. A `chroma.max` over
  0.1 with no such area can be a mark too small to fill a block, or a
  textured surface whose blocks average under 0.1: tell which by eye. When
  `chroma.areas` is larger than the number of listed areas over 0.1, the
  difference is the number of such areas left unlisted: find those by eye
  ([the chroma fields](../../../docs/knowledge/command-line-tools.md#time-strips)).
- **Push a too-perfect place one step past the honest ones.** Its hues sit
  one chroma step, OKLCh C 0.03 to 0.06, above the same hues in the film's
  honest places, and its things stand neater than use would leave them, so it
  reads as a facade before anything says so. One step; full chroma over a
  large area [tires the eye](stills.md#colour-by-its-modifiers-and-medium).
  Check on side-by-side `--at` frames of both places with `--json`: for each
  `saturated` area whose `hue` matches one in the honest place within a few
  degrees, the facade's `chroma` exceeds the honest one's by 0.03 to 0.06
  (when a shared hue is not among the listed areas, compare the C of that
  mark itself: `oklch(colour)[1]` of the colour the piece paints it with in
  each place or, when light or a grade changes the drawn colour, the `C` that
  [`--sample x,y`](../../../docs/knowledge/command-line-tools.md#pixel-samples)
  reads at points well inside the mark on each `--at` frame; `chroma.p95` mixes every hue in the
  cell and says nothing about one), and
  a [fresh-eyes reviewer](#fresh-eyes-review) calls the place too perfect.
- **Pass a row of lit openings faster as pressure rises.** A moving view
  passes a row of lit openings, such as gaps in a dark mass, at a cadence that
  quickens with the beat's intensity, and the move ends with the subject held
  in one opening, a [frame within the frame](stills.md#art-direction-preset-focal-composition).
  The row is a regular pattern, so its shift stays under a quarter of the
  spacing a frame, as [a regular pattern strobes as it moves](#detail-and-resolution)
  says. Check on pairs of consecutive [frame middles](#look-at-a-film) early,
  mid and late in the move: the shift a frame, and with it the openings
  passed a second (shift times frame rate over spacing), rises with the
  intensity line, stays under a quarter of the spacing, and the last frame
  holds the subject inside one opening.

**Light for an inner state may come from no source.** It is the one exception
to [every lit area has a source](#what-every-scene-holds): a coloured light
that belongs to what the subject feels, not to the place.

- **From no visible source.** A tint rises over a few seconds, peaks on the
  inner beat and falls away, over the subject or the whole frame, while the
  place's own light stays as it was.
- **From a shown source, past realism.** A lamp, screen or sky already in view
  floods its colour further and stronger than it could reach, until an event,
  such as a door closing or a sound, cuts it and the place's light returns.

Both stay within [the flash limit](#what-every-scene-holds): the rise and the
fall take seconds, and the cut happens once. A pulsed tint is a flash
`flashes` cannot count, a hue pulse at constant luminance: the design is its
only guard.

- **A declared dream stretch may break the light plan completely.** It is
  light for an inner state, so it falls under the same exception to
  [every lit area has a source](#what-every-scene-holds). Name its
  first and last second in the beat sheet. Inside it, sources, falloff and
  shadow direction may all go, by one rule held on every frame, such as every
  form lit from below, and the light plan returns at its end.
- **A remembered passage softens its edges**: soft or faded edges on every
  frame of the passage and nowhere else, as
  [transparent or faded reads as remembered](stills.md#colour-by-its-modifiers-and-medium),
  and it may share the passage's [box](#plan-the-film).

Check both on a shot strip: every row of the stretch keeps its one rule, and
no row outside it has it.

**Let the sound follow the colour.** A hot panel takes sharp transients and a
quicker pace; a pale, cold one soft attacks and long tails
([sound](sound.md)).

#### Build the film in order

**The [film scaffold](../film-scaffold.cjs) is the plumbing.** Copied beside
the piece, its slots take: the spine and the beat sheet, the shots,
a cue table where every element has an entry, an exit, a depth and, when it
is not seen in every shot between them, the `shots` it is seen in, a camera
track, what paints each element (layered as
[a thing in front stays in front](making.md#depth-order-and-contacts) says),
the sounds with their causes and distances (each row a `voice`, an
`ambience` or a `pluck`), the contacts (every planned touch:
its second, its cause and the design point `x, y` where the two outlines meet;
give each a reaction and a sound), the room, the ground drawn once and the
finish. In `cues.contacts` the `x, y` are frame coordinates after the camera,
at the cause's depth, and the design point given moves to `design: [x, y]`.
It holds
structure only and draws nothing but a grey ground: the subject, the look,
the voices' recipes and the finish come from the piece and the style guide. Its draw
paints an element only in the shots it is seen in.

What the scaffold's build refuses, with the rule each check enforces:

- an element with no exit ([continuity](#continuity));
- a `SHOTS`, `ELEMENTS`, `SOUNDS`, `CONTACTS`, `BEATS` or `CAMERA` table that is
  not a list (`the SOUNDS table is not a list of rows`); `SHOTS` is refused as
  the film loads, the others in the build;
- a `SHOTS` row that is null, a hole in the list or not a `[name, seconds]` pair
  (`shot 1 is not a [name, seconds] pair`), and a row whose seconds are not a
  positive finite number, such as `'4'` or `0` (`shot 1 has seconds that are not
  a positive finite number`); both are refused as the film loads;
- a `SHOTS` with no rows (`the SHOTS table has no rows`), a shot whose name is
  not a non-blank string (`shot 1 has a name that is not a non-blank string`)
  and a shot that repeats an earlier name (`shot 2 repeats the name "a" of shot
  0`); all three are refused as the film loads;
- a beat, camera key, sound or contact row that is null, a hole in the list or a
  list (`beat 1 is not an object`);
- a row of `ELEMENTS` that is not an object, a gap in the list included
  (`element 1 is not an object`); a row whose `name` is not a non-blank string
  or a Symbol (`element 1 has no name`); and a name another row already has
  (`element 2 repeats the name "door" of element 0`) when a frame shows both
  rows. Two rows of one name pass when one exits on or before the frame the
  other enters, on the whole frames that THE TEMPO and rounding give, as a
  thing that changes layer does, or when no shot shows both;
- an element whose `shots` is not a list, such as `'wide'`, or is an empty
  list, so it is never drawn, or names a shot that does not play between its
  entry and exit; a `states` that is not a list, and a state that is not an
  object, including a gap in the list; and a state whose `shots` is left out,
  is not a list, or is an empty list, so it is never shown, or that names a shot the film does not have, a shot
  outside its element's entry and exit, or a shot its element's own `shots`
  list leaves out;
- an element whose `enter` or `exit` is given and is not a finite number of
  seconds;
- a sound, contact, beat or camera key with no `at`, or whose `at` is not a
  finite number of seconds, each refused by its row and index (`sound 0 has no
  at: give the second it comes at, such as 1.5`, `beat 2 has no at`); a
  `voice`, `ambience` or `offscreen` that is given and is not an object, `0`, `''`,
  `false` and an array included (`sound 0 has an ambience that is not an object, got "rain": give
  its keys, such as { length: 3 }`); a sound whose `lead`, `trail`, ambience `length` or
  ambience `fade` is given and is not a finite number of seconds. A seconds
  value, `voice`, `ambience` or `offscreen` left as `null` counts as left out. These are checked before a sound's
  voice and role, so a sound with no `at` is refused by its row even when it
  also lacks a voice;
- a sound row's `gain` that is given and is not a list of `[seconds, gain]` keys
  (`sound 0 has a gain that is not a list of [seconds, gain] keys`); a key that
  is not a pair of two numbers of 0 or more (`sound 0 has gain key 1 that is not
  a [seconds, gain] pair`); keys out of order (`list the keys in time order, a
  frame or more apart`); and keys that land on one frame once THE TEMPO and
  rounding apply (`move them a frame or more apart`). A `null` gain counts as
  left out;
- a sound with more than one of `voice`, `ambience` and `pluck`, or with none,
  and a `pluck` that is given and is not an object; an
  `offscreen` sound that is not a voice with a `side` of `'left'` or
  `'right'` and a `distance` from 0 to 1, or that has a `lead` or `trail`;
- a sound, or a contact, whose cause is not on screen at its second, and a
  contact outside the film or without a finite `x` and `y`;
- a beat out of order, with no intensity or no state changed, naming no row
  of `ELEMENTS`, or whose row is not seen in the shot playing at its second, so
  off screen ([plan the film](#plan-the-film), [continuity](#continuity));
- a question no later beat answers, other than the one `LEFT_OPEN`, and a
  `rise` that does not grow ([plan the film](#plan-the-film));
- a beat in the first 6 frames at 24 fps, a quarter of a second at any rate,
  after a cut between shots or a cut of the framing made by two camera keys at
  one second, naming the latest cut before the beat; a `jolt` within that time
  of the last cut, and any cut, between shots or of the framing, within that
  time after a `jolt` shot starts, so a jolt shot holds at least that long;
  and a cut where the eye jumps more than a
  third of the frame, unless the later shot is marked `jolt` or motion
  carries the eye across and the cut is marked `carry`
  ([continuity](#continuity));
- a camera cut inside a shot where the eye jumps more than a third of the
  frame, unless a key of the cut after its first is marked `jump: true`, a `jump` on a
  key that is not on the frame of the key before it, and a `jump` that is not
  `true` on one that is ([continuity](#continuity));
- two keys of an element's `keys` track, written on different frames, that
  round to one frame after THE TEMPO, since that would cut the track, and two
  keys on one frame before frame 0, where the first never plays. Keys
  round to whole frames as beats and sounds do.

It warns, on the rounded keys, when an element's `keys` tracks all key on the
same frames, or two carry the same frames and values and the same rate on
every key that starts a move ([joints](#joints-that-break-in-succession)); the
rate of the last key, of a key followed by another on its frame, and of a key
that starts a hold (the next key has its value) shape nothing and are not
compared. It warns when a cut in a track (two
keys on one frame) has neither a beat on that row nor a sound the row causes
on that frame, where the row is seen on that frame and the frame before. Where
the cut's frame is the first the row is seen on, frame 0 included, it warns
that the switch is never seen. A row shown again in a later shot with a changed
value is a shot change, not warned of. It warns of a cut once per
frame. It judges each name's track as one track, each row only on the frames
it shows: within a shot, a row of a name taking over from another on the frame
it enters (a layer change) is a cut when its value there, after any cut of its
own on that frame, differs, beyond float rounding, from the value the earlier row brings to that frame, read before any
cut the earlier row has on it. It checks
rows marked `role: 'music'` or `role: 'sting'` against
[music held under the caused sounds](sound.md): it warns when a music
or sting row's loudest layer, after both rows' `gain` keys, is not quieter than
a caused voice's it plays with, so a sting stays under the hit it answers, unless
the music starts on a beat marked `forward: true` and the voice starts within
a quarter of a second of that beat, so music held loud past it still warns
over a later voice; and when more than one sting starts within a quarter of a
second of one beat. Its `DUCK` then dips those rows, dry and in the room, under
each caused voice or pluck, by what that sound's peak passes `DUCK.threshold`
and at most `DUCK.depth` dB, from just before it starts until its attack and
hold are over; a sound that starts with music on a beat marked `forward: true`
dips nothing. The dips are in `s.cues.ducks`, and `DUCK = null` leaves the
music level.

**Blocking the whole film first finds timings where a change costs a
number.** Every shot as flat grey shapes, each element of the cue table a
plain block at its place, size and depth, moving on its real cues and the
camera track, over the soundtrack at its real timings, with a plain tone of
the right length where a sound is not designed yet, saved with
`npm --prefix "<library root>" run film -- "./my-piece.cjs"` and watched end
to end, at speed, with sound, shows only the story and the rhythm: whether
each scene causes the next, the turn lands, the pace follows its curve,
nothing is held past its point or cut before it reads. When a
scene's timing is in doubt, its shot's `TEMPO` in the
[film scaffold](../film-scaffold.cjs) at 0.75, then at 1.3, each drawn as a
shot strip beside the one at 1, shows which timing reads best.

**The seed changes how each link happens; the cue table holds whether.** The
turn authored in the cue table lets the seed fill it. For each beat, what the
solve has to do and what it may not, such as which body lands in frame or
what still moves at the cut, written down and checked in `build`, lets
`build` throw for a seed that fails it, by name. The
[shot strip](#look-at-a-film) at three seeds shows what the seed changes.

**Finishing one scene over the blocked film keeps the whole film playing.**
One scene's key frame taken to its finished look sets the shared finish (the
grade's `black`, `white`, `tone` and `toning`, the stock and the mark
technique), written beside the
[strip of colour panels](#colour-across-the-film); every scene then takes
that shared finish and its own panel's key, contrast range and saturation.
One scene finished over the blocked film, [looked at](#look-at-a-film),
fixed, then the next: the scenes not yet finished stay blocked, so the whole
film still plays, and a finish that changes a scene's length or timing shows
in the whole film watched again. A long plan or source written in pieces, a
scene at a time, survives the output limit that can lose one very long write.

### What every scene holds

- **The background lives, quieter than the subject.** Give elements behind the
  subject their own cues and their own `R` names, so each keeps its own rhythm:
  something flickers, drifts, sways or switches on and off. Keep it smaller,
  slower and lower in contrast than the subject, so the eye still lands there.
- **Flash limit: three a second.** Keep whole-frame or large-area brightness
  swings, such as a lamp switching on and off or a strobe, and any flashing of
  saturated red, to three or fewer a second (WCAG 2.3.1): faster ones can
  trigger seizures. The film export counts them and warns in its note and
  report (`flashes`), but still saves the film: fix the piece when it warns.
  The count covers only changes of luminance and red flashes, so a pulse of
  constant luminance in another hue passes it unseen.
- **Background motion stays readable.** A thing that crosses the frame in
  under about half a second is a blur; slower, or on a shorter path, it
  reads. A [zip pan](#camera-and-framing) is the one exception: its
  blur says on purpose that the move is too fast to read.
- **A path of motion points like a line.** The eye follows what moves, so end
  a moving thing's path at or beside the subject, and move a group along one
  curve. A row that crosses the frame and leaves by an edge takes the eye out
  with it; see [point the picture at the subject](stills.md#art-direction-preset-focal-composition).
- **Light reaches as far as it would.** A glow or beam lights what lies around
  it: draw it as its own pass over the layers it crosses, with a blend such as
  `screen` or `lighter` and a falloff with distance, or tint each layer it
  crosses. A light cut off by a layer's edge or clip reads as a painted patch.
  Every lit area has a source, in the frame or plainly beyond it, except
  [light for an inner state](#colour-across-the-film), and what no light
  reaches stays dark: [light decides what exists](materials.md#light-decides-what-exists),
  night included. How light acts on each material
  and through air and water is in [materials and light](materials.md).
- **A dark scene keeps a light moving.** A dark shot in which at least one
  motivated light changes stays alive: its source is in the frame or plainly
  beyond it, such as headlights sweeping a ceiling, a swinging lamp, a turning
  beam or a sign switching. The light's own cue-table row, with its level or
  direction on a `keys` track, lets a sound meet each switch on the switch's
  frame through `cause` naming the light's row. Only a switch that changes the scene's state, such as the
  lights going out, is also a beat. On a `--shots` strip, or an `--at`
  strip with seconds inside the shot (more cells catch a brief switch), with
  `--json`, the shot's entry in `window.__sheet.flags.lights` shows `held`
  false where a light moves. The strip applies the 1% move, the three-quarter level and lit-region
  ratios and a `null` light as 0 itself, and starts a new run at each shot
  start when the piece keeps `state.cues.shots`; without that list a strip
  spanning a cut is one run, so keep it inside the shot. A run's move is the
  largest distance between any two of its lights, so more cells cannot hide a
  slow move and a swinging lamp reads its full swing.
  "light held" is a plain caption, not a flag: read the shot's entry.
  A camera pan, push-in or weave moves every lit area and reads as a changed
  light, so judge on cells whose framing holds
  ([camera and framing](#camera-and-framing)). The region ratio catches a
  small lamp switching beside a brighter static area, such as a window or a
  sky patch; only a lamp in the same region as that area, about 1/10 of the
  frame wide, needs a check by eye on a `--loupe` crop over it.
  The whole-frame `change` cannot tell a moving light from drift, so it says
  nothing about this
  ([`light`](../../../docs/knowledge/command-line-tools.md#time-strips)).
- **Light events keep their own timing.** The strip shows each:
  - Firelight flickers and the shadows it casts move with it: fast and jittery
    for menace, slow and swelling for intimacy.
  - A lamp switched on reaches everything it lights on the same frame, with no
    fade spreading across the room.
  - Light and shadow crossing still figures or things sell a moving vehicle:
    they cross at the vehicle's speed and keep that speed while it holds.
  - Shadows crossing a strip of light under a door land on the frame of each
    step or movement heard.
  - A change of state can be lights going out one at a time, the rim last,
    with something still stirring in the dark after.
  - A shadow takes away only the light that casts it: where another light also
    reaches, the shadow is lighter and tinted by that light.
  - Each switch is one large brightness change, so space switches and fast
    flicker within the flash limit above. A fast flicker over a large area
    keeps its swing under 0.1 relative luminance, the step the export counts.

  Shadows of unseen occluders, small flames and low lights are in
  [light through gaps and clouds](materials.md#light-through-gaps-and-clouds).
- **Everything stands on, hangs from or is joined to something.** An element
  meets what holds it with a contact shadow, an overlap or a shared edge, and a
  far form's base runs into the colour and texture of the ground under it. A
  gap of a few pixels reads as floating. A part of a larger thing stays
  attached to it at a seam, a hinge or a stem on every frame and moves with
  it, as a [hinged figure's](#hinged-figures) prop turns with its hand: a part
  drawn apart from its body, or one that drifts while its body stays still,
  reads as loose in the air. A thing that leaves what holds it, in a jump, a
  hop or a throw, leaves its contact shadow on the ground under it, smaller,
  softer and paler the higher it goes, and growing back darker as it lands:
  the shadow is what shows the height, and one that rises with the thing
  reads as stuck to it.
- **Three depths overlap where the scene has depth.** In a scene set in a
  deep space, something near, something at the middle and something behind,
  each overlapping the next; where scale matters, a thing whose size the
  viewer already knows stands at two of them. A flat or patterned scene skips
  this. Each deep scene's key frame shows the three depths and where each
  overlaps its neighbour.

### Camera and framing

The core has no camera: the view is the piece's own transform, the scaffold's
camera track or `translate` and `scale` driven by `core/time.js`.
Each scaffold camera key states the whole view: a key that leaves out `x`, `y`,
`zoom` or `dolly` takes the default (the frame's centre for `x` and `y`, 1 for
`zoom` and `dolly`), never the previous key's value. Repeat every held value on
every later key, in pans, tracks and push-ins alike.

- **Shot scale follows beat weight.** Wide to show where things are and for
  travel; closer as tension rises; the tightest frame for the heaviest beat,
  [kept for the peak](#plan-the-film). A
  beat that only carries the subject somewhere gets one plain framing; a heavy
  one earns several. Opening close and pulling out to reveal is a choice for a
  mystery, not a default. One framing all film long reads as a diagram.
  A return to a wide before the viewer loses where things are keeps the
  place: on a shot strip, three rows in a row without a wide or extreme wide
  is about where that loss begins, except through the peak, the rise into it
  and a planned close opening; a longer run is a choice the beat sheet names.
  The framing steps, widest first: extreme wide, wide, medium, close and
  extreme close; one framing step is the move to the next of these.
  The other way, each beat at intensity 0.5 or more, and each beat that needs
  the subject's look or face, reads at least one framing step closer than the
  film's travel shots, with the face at the size the face's row of
  [the smallest figure that still acts](#the-smallest-figure-that-still-acts)
  needs; a film told in one continuous track gets there by pushing in, since
  staying wide leaves the face unreadable.
- **Light follows the framing.** A wide keeps the place's mood and light and
  may leave the subject a silhouette; a wide overlit to show a face loses the
  place's mood, where a closer framing shows the face.
  As the view closes, the subject's fill and modelling rise, such as a rim,
  and its fine surface texture softens, so its form carries the close view.
  One smooth function of the subject's size on screen drives both, such as
  `smoothstep(0.15, 0.45, h)` from `core/num.js` with `h` the larger of its
  height over the frame's and its width over the frame's, where a switch at a
  key reads as a light that jumps; scaled by the place's light where it
  stands, a gap stays dark at any scale, and the [key light](#continuity)
  keeps its direction. `--shots` for wide against close, and `--at` at
  seconds along the subject's whole path, through pools and gaps, and across
  the move, show its shadow side's value against its lit side's rising with
  its size, continuous between neighbouring cells within one shot or move, and
  staying dark in a gap. A cut steps the size, and the light with it.
- **Every move has a reason and a landing.** A move promises something at its
  end: a reveal, a concealment, or a jolt on a key beat. Start it on a cause on
  screen (the subject sets off, turns to look, something enters), or make it
  the film's own narration: a slow, even drift across what the story needs, in
  a film whose camera style allows it. Land it from rest to rest on a frame
  planned in the beat sheet, with `tween(a, b, ease.inOut)` or the scaffold's
  camera keys. A reveal lands on a view already at rest: the eye cannot
  read a thing while the frame still slides, so the move settles a few frames
  before what it uncovers shows. A push-in followed at once by a pull-back to
  the same framing reads as the camera changing its mind and takes back what
  it pointed at; the closer view holds its beat, or the next move goes on to
  a new framing. Choose one camera style per film, still, gliding or handheld,
  and break it only for a beat that needs it. Where the style lets the view
  move, a push-in too slow to notice raises tension over a held beat without
  a cut, and a pull-back over the final image sums up. A push-in made as a
  dolly, not the camera's `zoom`, which grows every layer alike, keeps the
  depth ([a zoom is not a dolly](#camera-and-framing)). In the scaffold,
  `zoom` held at one value through the move and a `dolly` on the camera keys,
  the scale of the subject's plane, does it: each element grows by `dolly` to
  the power of its `depth`, so a near layer grows more than a far one and a
  sky at depth 0 holds. One key with `dolly: 1` at the move's start and one
  with `dolly: 1.15` at its end make a push-in. A pan keyed after it eases
  back out unless it repeats `dolly` (every key states the whole view, as the
  start of this section says). The shot's first and last frames then plainly
  differ in framing, and a near layer grows on screen more than a far one
  between them, while [frame middles](#look-at-a-film) 1 s apart look the
  same.
- **Draw each long move on the plan with its beats.**
  `npm --prefix "<library root>" run seeds -- "./my-piece.cjs" --plan` draws
  the scaffold's view over the place: a dot at the frame's centre on every
  frame, a ring on each beat with its view boxed, each shot's first view
  dashed, each cut crossed, and each `BLOCKING` row's marks joined by its
  line of attention. It lists each beat's view speed as a share of
  its move's peak, one move from each camera key to the next
  ([what a piece built without the scaffold keeps](../../../docs/knowledge/command-line-tools.md#what-the-piece-must-keep)).
  Along a pan, dots spaced wide are fast travel and bunched
  dots are an ease or a rest; a zoom stacks its dots on one centre, so read
  its ease from the listed beat speeds and shares, not the dot spacing. A
  dolly counts as a move at the scale of the subject's plane, depth 1, so
  pace a push-in's beats here as a zoom's.
  On the plan, each pan's dots bunch where its beats are, a beat inside a
  move sits under a third of that move's peak unless the beat sheet plans a
  drift over it, and no move passes its landing and comes back.
- **The subject can reframe the shot.** In place of a cut, the subject turns
  or moves into a closer framing, or away into a wider one, for a reason in
  its own action, such as going to what it looks at. On a shot strip, the
  row's first and last frames then sit at different
  [framing steps](#camera-and-framing), and `--at` at the move's start shows
  its cause in the subject's action.
- **A pan joins two ends that mean something.** Start it on something that
  points, such as a trace, a look or a line of motion, and end it on what that
  points to. A pan that starts or ends on empty ground has nothing to promise.
- **Say a pan's speed in frame widths per second.** `ease.inOut`, which the
  scaffold's camera keys use, peaks at three times the mean speed: a pan that
  averages 0.3 frame widths a second passes 0.9 at its middle. A regular
  pattern the subject slides past strobes past the peak shift
  [a regular pattern strobes](#detail-and-resolution) names; more time for
  the pan, or a broken regularity, keeps it under.
- **The view's speed against the subject's is what the viewer sees.** A view
  that follows the subject at its own speed holds it still in the frame, and
  its move shows only in the ground sliding behind it. Let the view lag, lead
  or stop where the subject's move matters, such as a stop, a fall or a
  rebound, so the subject crosses the frame. A pan that holds the subject at
  one place and size in the frame while nothing behind it visibly moves says
  it is still: where the story says it travels, show the travel against the
  place, as ground with marks that slide past, a change of size or height, or
  a view that stops and lets it cross. Across a follow, `--at` cells show the
  subject's place or size change, or a mark behind it shift. Speed reads against the frame:
  the same move crosses a close frame faster than a wide one. Where a scene
  cuts between the two, the scene keeps its clock when the close framing
  widens, or the move slows for the whole scene, until its speed in frame
  widths a second in the close shot is near the wide shot's; a close shot
  meant to rush keeps the difference.
- **A moving field drags a still thing the other way.** A large area sliding
  behind a small, bright thing that holds still, such as clouds past a lamp,
  makes the thing seem to drift against the field. Painters use it where the
  thing should seem to move; where it has to read as still, a fixed near
  reference beside it, such as a frame edge, a post or a sill that holds
  still too, anchors it. `--at` across the field's move shows the still thing
  keeping its place on screen and, where it reads as still, an anchor beside
  it in every cell.
- **A mover's visual beats.** A moving subject marks a beat each time it
  crosses a frame edge, passes in front of or behind an object, stops or
  turns. Those seconds listed in the beat sheet with the story's beats, and
  posts, trunks or other uprights set in its path where beats should fall,
  off a regular spacing ([a regular pattern strobes](#detail-and-resolution)),
  make the travel tell. `--at` at each listed second shows the mover at the
  edge, the object, the stop or the turn the list names.
- **A halved frame is one sequence's device.** Split the frame to show two
  places converging at once, such as the subject and what it heads for, and
  join the halves into one full frame on the beat they meet, so the meeting
  gets the whole frame. Kept all film long, the halves give the peak half a
  frame each and soon show the same picture twice.
- **A move is three shots.** A composed still start, a move whose every frame
  stands as a still, and a still end the view reaches before the subject does.
  A track of 5 to 10% of the frame's width is usually enough; keep one depth
  scale for the whole film. Each move drawn at 25, 50 and 75% with `--at`
  shows each frame as a composition.
- **Height and horizon are judgements.** The subject's own level is the
  default view, left with a purpose the beat sheet names: a high view lays
  out where several subjects stand against one another, such as before a
  chase or a meeting, and a film held at one height throughout reads flat. A
  dropped horizon lets the subject rise over it when it dominates; a raised
  horizon lets the ground fill the frame when it is overwhelmed. A camera
  lowered near the ground, held level, keeps the horizon where it was: the
  subject rises over it and reads as heroic or threatening, the ground
  squeezes into thin bands and near cover looms. Tilted up, the view also
  drops the horizon in the frame. A camera raised and tilted down lifts the
  horizon up the frame, or out of it, opens the ground so spacing and paths read,
  and leaves the subject small or exposed. A level
  horizon is the ground the viewer stands on; a rolled view says the world is
  wrong, briefly or held through the beat. On a shot strip, every row above
  or below the subject's level has its reason in the beat sheet, or reads as
  an accident. A piece codes the angle in its paint: each shot's horizon y,
  ground bands spaced tighter for a low view and wider for a high one, and
  standing things sized from that shot's horizon, since the scaffold's
  `HORIZON` is one constant for a level view. A crane is a camera key's `y`
  move, which the scaffold already applies to each element by its `depth`,
  so near layers shift more than far ones; a tilt is one shift every layer
  takes alike. THE GROUND the scaffold draws once never moves, so a ground
  the view climbs or tilts over is painted as an element, and a moving
  camera rules out static layers ([per-pixel passes](#per-pixel-passes)).
  Far planes take [aerial perspective](materials.md#aerial-perspective).
- **Things stand on the horizon's terms.** Each standing thing placed by its
  foot contact against the horizon, sized from there, with value, warmth,
  texture and size running one way in depth, as
  [the focal preset](stills.md#art-direction-preset-focal-composition) says,
  with its rules for built things: one projection, openings and blocks, and
  overlap first. In a track past a face that looks at the view, an opening's
  visible inner wall is the one on the side away from the view's centre, so it
  changes side as the opening crosses the centre; a block's visible side is
  the one towards the centre. `--at` frames across the track show it.
  In the scaffold, `HORIZON` set to the horizon's design y and a standing
  row's `foot` and `tall`: the build refuses feet on or above the horizon
  and keeps the row's `height` for its paint. The rule holds for a level view
  at rest. A tilt, or a camera move in y over layers at different depths,
  moves the horizon against the feet, so sizing from each shot's resting
  view, seen there with `--at`, holds.
- **A ground reads as a place when its cover runs its whole depth.** Growth,
  stones, debris, tiles or marks spread from its far edge to the frame's foot
  read as land that goes on past the frame; a sparse band near the far edge
  over a bare plane reads as a floor set behind the subject. The cover takes
  the same gradient as standing things: far pieces small, close together and
  low in contrast until they merge into a texture, near ones larger, farther
  apart, darker or stronger and drawn in more detail, the nearest cut by the
  frame's edge. Pieces spread evenly over the ground itself get that spacing
  from the view, which packs the far ones together
  ([texture scale](materials.md#texture-scale-against-apparent-size)). Bare
  ground is a choice the scene makes, such as a salt flat, a swept floor or
  an emptiness the film is about. A seeds sheet shows whether every part of
  the ground's depth holds cover at every seed. `examples/stride.js` spreads
  its field from just in front of the walker to past the frame's foot.
- **Each scene's space carries its meaning.** Flat and shallow for
  confinement, lit only through one small high opening whose shaft and pool
  hold the subject, while an evenly lit room reads as a room, not a cell; deep
  for release, scale withheld for a mystery until something
  of known size enters. The switch between them is one the turn earns. Size
  on screen is importance: a small subject in a wide frame reads as alone. On
  the beat the subject is shut in, a dark wall closing in from the edges
  until it stands in a small opening makes a
  [frame within the frame](stills.md#art-direction-preset-focal-composition).
- **Inside the action or outside it, per scene.** The beat sheet names the
  choice. Inside, subjects pass close to the view, the view turns or moves
  with the action, and it sides with one subject by
  [showing its front most](#two-or-more-subjects). Outside, the view holds,
  stages the subjects across the frame at a distance and sides with none.
  On a shot strip, each scene's rows show its choice: inside rows show a
  subject near enough to cross a frame edge, or a moving view; outside rows
  hold the view still with every subject whole. The cropped
  edge of an [exchange](#two-or-more-subjects) and a group's cropped subject
  belong to inside or open scenes; an outside or closed scene shows an
  exchange or a group whole in one framing, or in clean singles.
- **Open framing involves; closed framing keeps the viewer watching.** Open
  framing cuts subjects at the frame's edges and lets near things cross in
  front of them, so the world runs on past the frame. Closed framing keeps
  every subject whole and balanced inside it. Open usually goes with inside
  the action and closed with outside, and a switch between them belongs on a
  turn. A group's subject [cropped at an edge](#two-or-more-subjects) is
  open framing on that side. On each row's first, middle and last frames, an
  open framing cuts or crosses at least one subject, and a closed one shows
  every subject whole with margin on all sides.
- **A close frame cropped through a part that holds still.** Where the
  frame's edge cuts a subject across a part that stays put through the shot,
  the crop holds; across the part that acts, it slips in and out past the
  edge. `--at` across the close shot shows whether an acting part crosses the
  edge, and whether the edge cuts the subject at the same place on every
  frame.
- **The box can change with the feeling.** A piece with a `reframe` timeline
  narrows its box over a beat that confines and opens it on the release.
  The box moves from rest to rest between two entries, so it cannot cut. Each
  change on a turn in the beat sheet, with the box held still before and
  after it, reads as a beat, not a drift. A box still moving on the last
  frame has not landed: a release ends with a hold long enough for what it
  opened to fill, while something still moves.
  `examples/refit.js` holds wide while it fills, narrows as its walls squeeze
  the pile, holds, then opens into a square and holds while the new room
  fills. What each box keeps, and what it adds, is in the
  [runtime skill](contract.md).
- **Lead space.** A moving or looking subject off centre with room in front
  of its head, or of the part it looks with, has somewhere to go: the look
  leads, not the body. A view aimed at its place plus a lead along the
  direction its head faces, which is its velocity only while it looks where
  it goes, passed through `follow`, lags its start and overshoots its stop as
  an operator's would. When a threat comes from behind, the room behind the
  subject's head, left on purpose, says so. `--at` on frames where head and
  body face different ways shows the larger empty side of the frame on the
  head's side, and on frames the beat sheet plans for a threat from behind,
  behind the head.
- **A pan is not a track.** A pan turns in place: every layer slides alike.
  A track travels: near layers slide faster than far ones, and the parallax is
  what makes flat layers read as deep. Scale each layer's offset by its depth
  for a track, as the scaffold's `depth` does.
- **A zoom is not a dolly.** A zoom scales every layer alike; a dolly moves the
  view, so near layers grow faster than far ones, as the scaffold's `dolly`
  key does. The same framing from near
  deepens space and from far flattens it. A dolly-zoom holds the subject's size
  while the layers behind it swell towards it or fall away: author it as the
  world stretching, once, on a beat that earns it.
- **Motion towards the view spreads on every side, faster as it nears.** A
  thing coming at the view grows on all sides of its outline at once, and the
  growth speeds up. Its size on screen goes as one over its distance, so equal
  steps of travel give ever larger steps of size, and its texture coarsens with
  it ([texture scale](materials.md#texture-scale-against-apparent-size)).
  Scaled by `d0 / d` for its distance `d` from a start at `d0`, it comes;
  scaled along a straight key, it reads as growing in place. A thing that
  grows on one side only reads as passing, not coming. `--at` at even seconds
  of the approach shows each step of its width larger than the last.
- **Motion away from the view shrinks, sinks and goes behind.** The same
  `d0 / d` runs the other way: the thing shrinks as one whole over its
  distance, by ever smaller steps, its feet or base climb towards the horizon
  and its top moves towards it from above or below ([stand things on the horizon's terms](#camera-and-framing)),
  and nearer layers pass in front of it. A thing travelling down into a place,
  such as into a hollow, under water or through a gap, sinks against what it
  enters: the place's edge covers more of it on each step until it is gone or
  held at its new depth. `--at` at even seconds of the travel shows each
  step of its width smaller than the last, its distance to the horizon narrowing, and at least
  one cell with a nearer layer or the place's edge crossing it.
- **A move can carry time.** Pan off the subject and back, and the world it
  returns to has changed: an ellipsis without a cut.
- **Lay the story along one landscape for a lateral track.** Put each moment
  of the story on its own stretch of one continuous place, in story order
  from left to right, and track sideways across it: the viewer meets the
  moments in the order the eye reads them, so the move tells the story. Keep
  the ground, the horizon and the light running on between stretches, and let
  the place change along the way, such as its
  [shape class along the path](stills.md#shape-language), so the stretches
  read as one world, not panels set side by side. Make each stretch at least
  a frame wide, so two moments share a frame only where the story joins them.
  Land the view at rest on each moment for its beat with the scaffold's
  camera keys; the travel between is short. A still panorama works the same
  way, read left to right in one wide frame. A time strip with `--at` at each
  moment's resting second shows each cell holding one moment, in story order
  read left to right then down, with the horizon at one height and the ground
  and light continuous from cell to cell.
- **Handheld is weight, not jitter.** Drive the view with seeded slow noise
  through `follow`, which gives it inertia; a new random offset each frame reads
  as a broken film. Keep it for beats of panic or immediacy.

  ```js
  // In draw, with sec in seconds since the handheld shot's first frame; 3 sets the reach.
  const R = rng(s.seed);
  const sway = (name) => follow((x) => 3 * (gradient2(R, x * 1.2, 0, name) - 0.5) / 0.354,
    { stiffness: 60, damping: 0.6 });
  g.translate(sway('hand x')(sec), sway('hand y')(sec));
  ```

- **A camera carried on a spring lags and breathes with its subject.** An
  operator moving with a mover carries the view on a damped spring: it starts
  late, runs past a stop and settles, and dips a little on each footfall or
  other contact. It reads as following from inside the action, calmer than
  handheld and closer than a locked-off view, such as along a long walk, a
  chase seen from beside it or a slow approach. `follow(driver, { stiffness,
  damping })` from `core/time.js` gives it, with the view's x and y as the
  drivers: damping under 1 lets it breathe, lower stiffness lags more, and a
  dip driven from the subject's contact times or its height through the same
  spring stays within a few design units. In the scaffold, camera keys placed
  on the mover's beats lag only coarsely, since they ease rest to rest; a
  spring offset the piece adds to the view's x and y before the element loop
  in draw keeps each layer moving by its depth. `s.cues.views`, `--plan` and
  contact points read the camera keys only, so that offset stays small.
  Each `follow` call steps the spring from its cue up to the second asked, so
  calling it once per frame costs time that grows with the square of the
  frames: keep it for short spans, or step the spring once through all the
  frames in one pass in a build stage, as `examples/stride.js` steps its upper
  body's damped `trail`, and read that path in draw, never in a pixel loop
  ([per-pixel passes](#per-pixel-passes)). `--at` across several footfalls
  shows the subject drifting a little in the frame, ahead of centre on a start
  and behind it on a stop.
- **A zip pan whips the view, blurred most at its middle.** It crosses a frame
  width or more in a few frames, 4 to 8 at 24 frames a second, too fast to
  read anything on the way: it says the next thing matters now. Key it as two
  camera keys a few frames apart. `ease.inOut` then moves the view about a
  third or more of the way (0.29 to 0.49, by length) in the middle frame or
  frames and under a tenth in the first and last, so a blur as long as each frame's shift peaks
  at the middle and fades at the eases. Blur along the move only, as
  [motion blurs](materials.md#materials): draw the whole frame at several
  views spread across the frame's interval, each on a scratch canvas from
  `sibling` (`null` in Node, where the frame draws once, unblurred), and lay
  the `i`-th, counting from 0, over the frame at `globalAlpha` `1 / (i + 1)`,
  so the frame is their mean and edges along the move stay sharp. A filter
  blur softens every edge alike and reads as focus, not speed. For an
  overshoot, put the second key past the mark by about a tenth of the move
  and a third key back on the mark a few frames later: the view hunts back
  and lands, as a camera stopped hard by hand does. Once or twice a film, on
  a beat that jumps attention, it lands; more often it becomes the film's
  tic. The [frame middles](#look-at-a-film) from two frames before the move
  to three after it show the middle frame with no readable detail, and the
  first and last sharp.
- **An impact shakes the view along the hit, on the hit's frame.** A blow
  heavy enough to shake the view jolts it the way the force went: across for
  a body striking a side wall, up and down for a heavy drop onto the floor.
  Start it on the frame that first shows the contact, with the contact's sound
  at that second, and let it swing to the other side and back, smaller each
  time, over about 6 to 8 frames. A recoil from `spring` gives that shape:
  `s < 0 ? 0 : a * (1 - spring({ stiffness: 1400, damping: 0.25 })(s))`,
  with `s` the seconds since the hit and `a` its reach, is 1, 0.22, -0.44,
  -0.14, 0.19, 0.08 and -0.08 of the reach on the frames from the hit at 24
  frames a second, and under a tenth after that. Scale the reach by the hit's
  speed, as its sound's velocity is, and keep it small, such as 1% of the
  frame's width, so the framing holds. Apply it with `g.translate` on that
  axis before the layers, as handheld applies its sway: the view shakes, so
  every layer moves alike. A new random offset each frame reads as a rattle,
  not a blow, as under handheld, and noise on both axes says nothing about
  where the force came from. The whole recoil at the
  [frame middles](#look-at-a-film) from the frame before the hit to 8 frames
  after it shows the first swing on the hit's frame, on the hit's axis,
  decaying to nothing by the last. A contact strip with sound,
  `npm --prefix "<library root>" run seeds -- "./my-piece.cjs" --contacts cues.contacts --sound`, shows
  only a few frames round the hit, enough to see the sound start on the hit
  frame's line.
- **A lens is how far apart the depths spread.** `zoom` scales every layer
  alike, so it changes the framing and not the lens. The lens is set with the
  depths in the cue table and the sizes drawn. A wide lens spreads them:
  a near layer at a depth well above 1, drawn large, and a far one near 0,
  drawn small, so a track pulls the layers apart and space opens out. A long
  lens bunches them: every depth near 1, far things drawn nearly as large as
  near ones, so the layers slide almost together and stack up flat behind the
  subject. Choose it with the [scene's space](#camera-and-framing): wide for
  release, long for pressure or confinement, and
  [the steepest spread for the peak](#plan-the-film). A radial bend, the
  frame bowed out from its centre, reads as an altered state, such as a dizzy
  spell or a dream, not as a lens: once a film, on that beat, as a
  [per-pixel pass](#per-pixel-passes), it reads as the state; repeated, as a
  lens. A track's first and last frames with `--at` show the spread: how far
  each layer moved against the others is the lens.
- **Five planes stage a deep frame.** Sky at depth 0, which holds; a far mass
  near 0.1 to 0.3, pale and low in contrast by
  [aerial perspective](materials.md#aerial-perspective); a mid mass; the stage
  and ground at depth 1, where the subject acts, with cover over its whole
  depth; and a framing foreground above 1.3, cut by the frame's edge, often
  the out-of-focus near plane that focus, below, describes. Each plane is told from the
  next by value and overlap, and a track moves each by its depth, so the
  planes separate. A long lens, a confined scene or a flat one takes fewer.
  Each plane is one element; a far plane that changes little can be a
  [sprite](#sprites), and a moving camera rules out static layers
  ([per-pixel passes](#per-pixel-passes)). A track's first and last frames
  with `--at` show the planes as separate value bands, each moved by its depth.
- **A repeating background is at least three frame widths long, crossed at
  one speed.** On a long travel past a background that loops, such as rows of
  furrows or a wall of windows, the same shape coming back within a frame or
  two shows the loop. A loop at least three frame widths long and
  [seamless](geometry-fields.md#traps), moved at one speed whenever its join
  is in frame, hides the join: its offset driven from the seconds,
  `(speed * sec) % L` for a loop `L` long drawn there and again `L` farther
  on; driven from an eased key, a speed that changes over the join draws the
  eye to it. `--at` across the seconds the join crosses the frame shows it.
- **Focus is a timed cue.** Blur a layer by its distance from the focal plane,
  reaching farther behind the plane than in front of it. A rack from one plane
  to another is a beat in the cue table; holding the subject soft withholds it
  until the reveal. Shallow focus isolates the subject, for intimacy or a
  withheld reveal; deep focus keeps the place. A near plane out of focus, at
  a depth above 1.3 (on a track it moves 1.35 to 1.65 times as far as the
  subject's plane), frames the subject from the frame's edge, larger, softer
  and usually darker than anything in focus. Small bright points off the
  focal plane on the key light's path, such as specks in the light, glints
  on a wet surface or far lamps, become bokeh: soft discs of one shape,
  larger the farther from the focal plane, brightest where the key passes,
  at low alpha so they read as light, not things. A look parameter read only
  in draw, such as an aperture from 0 to 1, can scale the softness and the
  discs' size and alpha; the page still re-runs the build on each slider
  move. Neither needs a per-pixel blur: the near plane painted with `soft`
  from `artifex/styles/kit.js` and the discs as plain filled circles keep
  the cost of [per-pixel passes](#per-pixel-passes). Far planes lose detail
  by [aerial perspective](materials.md#aerial-perspective), not by blur.
- **Frame for a phone.** A film is often watched small, where thin lines,
  faint texture, haze steps, small bright marks and near-blacks are lost.
  Depth carried with overlap and with large steps in size and value survives
  there, and so does what the story needs when it stays out of the
  near-blacks. The shot strip at about 360 px a cell, `--scale` equal to 360
  over the box's width as [where it plays](#where-it-plays) gives it, such as
  `npm --prefix "<library root>" run seeds -- "./my-piece.cjs" --shots --scale 0.33 --values --png`
  for a 1080-wide box, shows each subject and each beat's acting part, depth
  from overlap and size, and anything the story needs told apart only inside
  the darkest level of the value view.

#### Animate an approved still

A still whose look is already approved loses that look when the film redraws
it, so the film reuses the still's own drawing.

- **Keep the still as its own piece.** The film piece `require`s it and calls
  its `draw` every frame inside the film's own camera transform, then paints
  its effects over it.
- **Pass motion through a module, not a key.** A small shared module holds
  the motion values (for example `{ t: 0, drift: 0, pulse: 0 }`, where `t` is
  the film's time):
  the still reads it, the film writes it before each call. Every value is 0
  for the still, so the still draws as before. A key on the piece is refused:
  `validate` in `core/piece.js` throws `unknown key(s): ...` for any top-level
  key outside `FIELDS`.
- **Make each hook a no-op at 0.** A phase shifted by `drift * u` (`u` is the point's position along its
  line or strand, 0 at the root, so the root stays put), a scale of
  `1 + pulse`, an offset of `drift`: at 0 each leaves the still's
  numbers unchanged. After each hook, the still's own replay shows at once
  whether the hook moves the still at 0.
- **The view stays inside the drawn frame.** A zoom just above 1, moved off
  centre, shows a blank corner past the drawn area. For a zoom of 1 or more,
  the view's centre clamped to `[w / (2 zoom), w - w / (2 zoom)]` across and
  the same down keeps the view inside the frame. Below 1 the interval is
  empty: the view is wider than the frame, so hold the centre in the middle.
  A dolly scales each layer by `zoom * dolly ** depth`, so a pull-back, a
  dolly below 1, shrinks every layer above depth 0, the subject's plane
  included, and shows THE GROUND at the frame's edges: dolly 0.85 scales a
  layer at depth 2 by about 0.72. Paint each layer above depth 0 at least `1 / (zoom * dolly ** depth)` times the frame's size, about
  1.4 times here, or keep the dolly at 1 or more.

#### Two or more subjects

A subject's front is whatever side leads it: a face, a beak, a nose cone, the
lit face of a lamp. How the fronts of two subjects turn, to each other and to
the view, says what the two are to each other before either one moves.

- **Their facing is their relation.** Fronts turned to each other oppose. Side
  by side and turned the same way, the two are allies. One front turned to the
  other while the other turns away is tension; back to back is a split. Choose
  a facing per beat, and change it when the relation changes.
- **A copied gesture states the relation.** One subject repeats the other's
  gesture a few frames later: smaller and lighter, with a lift at its end, for
  affection; matched or larger and held, for rivalry, since a smaller answer
  reads as yielding. On a time strip with `--at` at each gesture's peak, the
  answer's reach reads less than the first's for affection and at least the
  first's for rivalry. A bond also shows in
  the loose parts, such as hair, a tail, cloth or leaves, which lean towards
  the other subject, and in sound: a call from one is answered by the other
  across the gap, each voice at its own `distance`.
- **Strain shows as a shared rhythm drifting out of phase.** Give two bonded
  subjects one period for a repeated motion, such as a breath, a sway or a
  step, in phase while at ease, even when each moves at its
  [own tempo](#pace). As strain grows, the phase difference keyed up towards
  half a period, anti-phase, and not past it: phase wraps, so a larger
  difference brings the two back towards lockstep. Keyed back to 0, it is a
  reconciliation. The phase term alone moves, the `+ phase` in the
  [travelling wave's](#travelling-wave) sine, with one `OMEGA` shared by the
  pair rather than varied per instance. Over the strain beat, the phase
  difference then only grows and stays within half a period.
- **Turn at least one front towards the view.** Two pure side views facing
  each other read as a diagram. Turn one of them part of the way towards the
  view, and it becomes the one the viewer is with.
- **The front shown most leads the frame, more than size does.** A small, far
  subject with its front shown holds the eye against a large, near one seen
  from behind. Swap which front shows, and the scene changes sides.
- **The angle of a gaze sets the viewer's distance.** A front turned straight
  to the view speaks to the viewer. Turned about 40 degrees from it, the viewer
  watches from close beside the exchange; in a side view, from outside it.
- **Two views of a pair mirror each other.** When the view alternates between
  two subjects, put them on opposite thirds of the frame, at one size, each
  front turned by the same angle towards the other. With the scaffold's
  [`FOCUS`](#continuity), each row's out and in sit on its subject's eye:
  eyes exactly on opposite thirds are already a third apart, which leaves
  their heights no room to differ; a little in from the thirds, they can. A
  view
  turned nearly to profile, or moved to the other's side, shrunk and turned at
  once, reads as one subject looking past the other.
- **Who shares a frame belongs together.** Allies share framings, a framing
  of two or of the group. The one at odds with them gets framings of its own
  until the relation changes, and enters theirs on that beat. A cropped edge
  counts as sharing the frame, so before that beat an exchange with the one
  at odds cuts between clean singles, no edge of the allies in its frames
  and none of it in theirs. Naming the subjects in each row of a shot strip,
  an edge included, shows the allies sharing at least one row, and the one at
  odds sharing none with them before that beat.
- **The other's edge kept in an exchange.** While two subjects face each
  other across cuts in an inside or open scene, unless one is at odds with
  the other ([who shares a frame](#two-or-more-subjects)), each one framed on its third past a cropped edge of the
  other, near and still in the lower corner on that other's own side, darker
  or softer so it does not take the eye, keeps both in one space. A clean
  framing of one subject alone, no edge, is the cut for a beat that sets it
  apart. Within one group, a subject keeps one side between framings: the
  side it has in the wider framing, near edge included, as
  [screen direction](#continuity) keeps the line. On a shot strip, each
  subject, or its edge, sits on one side in every row of the group; with
  `--at` at each exchange row's first, middle and last frames, the edge holds
  still in one corner while the far subject acts.
- **The stronger one's eyes sit higher.** Across those cuts, set the eyes of
  the subject in control higher in its frame than the other's eyes in its own;
  at one height, the two are equals. On its own this is a quiet cue; together
  with [height and horizon](#camera-and-framing) it is a strong one.
- **Where each one is placed states who holds the place.** Before anything
  moves, the opening layout says it: the one in control takes the position
  the space itself favours, such as its highest point, its centre, or the
  spot that faces where others arrive. Two at odds face each other across
  whatever lies between them; those on one side of a matter share a side.
  The one left out is farthest from the favoured position, at the edge, or
  in a different posture from the rest. Nothing stands between the two that
  exchange the most, so a view can pass from one to the other. A subject
  whose posture differs from the others' has a cause the viewer can name:
  it has just arrived, or it is about to act. The layout holds across the
  scene's shots until a move on screen changes it, and a change of place
  then reads as a change of standing.
- **An uneven exchange gives the closer framing to the one that knows
  more.** [Two views that mirror each other](#two-or-more-subjects) at one
  size say the two are even. Where one holds what the other does not yet
  know, a tighter view of it breaks that evenness on purpose and puts the
  viewer on its side. After an act that changes things, a view held on the
  one that receives it, long enough for the change to be read there, lands
  it; cutting back at once to the one that acted spends the moment.
- **Light states the relation.** Light both alike, and they are even. Give one
  its own pool of light and leave the other in the dark, and the dark one
  reads as apart from it.
- **A group is its central pair, staged in depth.** A row of equals at one depth
  reads as a line-up in which nothing relates. Bring the central pair near and
  let it overlap; set the rest smaller and farther, and, in an inside or open
  scene, crop one at an edge.
- **Contrast their shapes.** Give two subjects different
  [shape classes](stills.md#shape-language), such as round against sharp. They
  then read apart at a glance. Draw them as one-shape glyphs first, and draw
  the subjects only once the glyphs alone tell the relationship.
- **Side views at one height make a frieze.** Two side views at one height,
  seen level, lie flat across the frame. For drama, turn them to three-quarter
  views and stagger them in depth.

### Continuity

**What a cut serves, in order.** What the viewer should feel, the state the
story changes, the rhythm, where the eye is, screen direction and the line,
then where things stand in space. When two conflict, the lower one gives way.

- **A branch, not a frame.** A shot has a few working out-points: while its
  action is still going, when it lands, and after its result has been read. A
  cut on one, chosen for what the viewer should think next, lands; one
  between two lands nowhere.
- **The eye carried across a cut.** The new focus near where the old one
  was, or the old shot's motion leading the eye there, carries it; a move
  farther than a third of the frame's width is a jolt, kept for a heavy
  beat. The exception
  that needs no jolt is shot and reverse shot of a pair, whose subjects sit on
  opposite thirds, just a third apart ([two views of a pair](#camera-and-framing)
  mirror each other). The scaffold's `FOCUS` refuses a larger jump on screen
  unless the later shot is marked `jolt`, for a heavy beat, or the cut is
  marked `carry`, for a motion that takes the eye across
  ([exit or entrance](#continuity)). It compares the written points, in design
  units, not the subjects, and counts height as well as distance across. It
  carries the out point through the `CAMERA` on the last frame before the cut,
  and the in point through the `CAMERA` on the first frame after it, both at
  depth 1, so a pan or zoom across the cut counts. A `CAMERA` cut inside a
  shot, two or more keys at one second, is one cut from the view before it to
  the last key's view, held to the same third unless a key after its first
  is marked `jump: true` (only `true`, on a key on the same frame as the
  key before it); `jolt` covers only the cut into its shot. The
  point it measures lies between the shot's in and out, as far along as the
  cut is from the shot's first frame to its last. `in` is where the subject
  is on the shot's first frame and `out` where it is on its last: for a
  subject that moves, where the move has brought it; for one that leaves,
  the last place it shows inside the frame, not off it. On `--shots --cuts`,
  every eye track then stays inside the frame.
- **The masses flipped across a cut.** The frame's large mass moved to the
  other side while the eye lands near where it was changes the balance, so
  the cut reads livelier than two frames of one weight. The same side kept
  across a cut is for a calm, unbroken read. On `--shots --cuts`
  ([cut pairs](#look-at-a-film)), a flipped cut's `mass` shares sit on
  opposite sides of 0.5 by 0.05 or more (`flipped: true`), with the `FOCUS`
  check still passing.
- **The outgoing frame's strong shapes off the incoming focus.** A strong
  edge of the last frame that lands on the next frame's focus, other than the
  shape that carries the eye, reads as a jump or a glitch. The check knows
  that shape only by the outgoing `FOCUS` point, so the point sits on it as
  it lies on the cut's last frame. On `--shots --cuts`, a cut that reports
  `stray` (an outgoing edge of 32 or more within a sixteenth of the frame's
  width of the incoming focus, edges as close to the outgoing focus left
  out) has such an edge; moving that shape or the focus clears it. When the
  flagged edge is the carrying shape itself, larger than that ring, carrying
  the cut ([exit or entrance](#continuity)) clears it if motion takes the eye
  across, or else moving the shape until its edge leaves the ring, or moving
  the outgoing point along the shape onto that edge so the ring around it
  leaves the edge out.
- **The eye lands before anything happens.** For about a quarter of a
  second after a cut, 6 frames at 24 fps, the viewer is still finding the new
  shot, so a change in those frames is missed: a lid that snaps shut on the
  cut's first frame reads as already shut. A beat started after them, or a
  cut moved earlier, is seen. A jolt in those frames jumps an eye that has
  not landed yet, so the shot before a jolt holds at least that long, whether
  the last cut was between shots or a cut of the framing (two camera keys at
  one second), and the jolt shot's own first frames hold no cut, between
  shots or of the framing. The scaffold refuses all three. Remedies: hold the shot before
  the jolt, or move the camera keys earlier, a quarter of a second or more;
  hold the jolt shot itself a quarter of a second or more; move a camera cut
  that follows a jolt a quarter of a second or more later
  ([its checks](#build-the-film-in-order)). Two camera keys at different
  seconds that round to one frame are refused, not cut: move them a frame
  apart. Two keys at one second on frame 0 are refused too, because no cut is
  counted there and only one of them would show: move them a frame apart, or
  drop one. A hole in a row's or a state's `shots` list is refused by its
  index.
- **Every cut inside a scene has a link.** The next shot follows from the
  last: the effect of a cause just shown, a part of what the wider shot showed,
  or an element the viewer has already seen in this place. An element shown
  in a wider shot before its own close shot belongs to the place; one that
  first appears in its own close shot seems to come from somewhere else. A
  near form that sweeps across the frame, such as a post the view passes, can
  hide a cut placed on the frame it covers most, which `--at` shows.
- **When two shots show one move, the cut falls while it is under way.** A
  cut after the move starts and before it ends lets the next shot pick the
  move up where the last one left it. Every shot of a scene driven from the
  scene's clock, not from the shot's own first frame, keeps that; a move that
  runs a few frames past the cut survives the cut moving in the cue table,
  where one authored to end on its shot's last frame freezes, or is skipped.
- **An exit or an entrance cut with the subject partly in frame.** The last
  shot ends with the subject part-way out of one edge, and the next starts with
  it part-way in from the opposite edge, still moving the same way. The motion
  carries the eye across, so it is no jolt: with the scaffold, the later
  shot's `FOCUS` row marked `carry: 'in'` (or the earlier one's
  `carry: 'out'`) leaves only that cut unchecked and keeps the eye check at
  the shot's other cut. A shot has one `FOCUS` row. A carry row leaves out the
  point its carry drops (`in` for `carry: 'in'`), needs a cut to carry (no
  `'in'` on the first shot, no `'out'` on the last), and may be a jolt only
  with `carry: 'out'`: a jolt is about the cut into its shot. After such a cut moves, the frames on both sides of
  it with `--at` show whether the subject is still partly in frame on each.
- **A still subject reacts through the shot beside it.** The same frames of a
  subject that does not move read differently by what the neighbouring shot
  shows: cut to it straight after an event, and it reads as a witness to that
  event. A form with no face can react this way.
- **Cut in to a small cause.** When the story turns on a detail too small to
  read in the current framing, such as a crack, a loose thread or a dial, cut
  to a close shot of that detail.
- **An extreme wide after an extreme close isolates.** Cut from the tightest
  framing of a subject straight to one where it is a speck, and it reads as
  alone in a large place; a medium shot after the close only says where it is.
  Keep this cut for a beat about being alone, lost or small.

- **Props exit when their job ends.** An element whose beat is over leaves, on
  screen or with the cut; one kept as a reminder reads as a mistake.
- **Nothing appears or vanishes without a cause.** An element enters and
  leaves through an edge, an opening that exists or from behind something.
  It takes its traces with it: its shadow, reflection, light and bounced
  colour enter and leave on its frames. A thing that falls in comes from
  something in the scene above it, seen or established, since one dropped
  from the empty top of the frame reads as falling from the sky. A thing in
  the place stays in every shot of the place that frames where it stands;
  with the scaffold, a row's
  list of the shots it is seen in is what each cut is checked against.
- **A changed state is seen.** When a thing moves from one place to another,
  breaks or fills, the viewer sees the change happen, or sees its cause and
  then its result. A thing that is somewhere else after a cut, with nothing
  shown between, reads as a mistake (the scaffold refuses a beat on a row not
  seen then). The new state stays in every later shot and beat until something
  on screen reverses it: a thing that breaks and is whole again a beat later,
  with no repair shown, undoes the event the viewer just watched.
- **Hold the place to say time passed.** Stay on the place a moment after an
  element leaves, or before it enters, to say time has passed; cut while it is
  still in frame to keep time continuous. The world is still there, so this
  is not an empty frame.
- **A character keeps its identifying features in every view.** Every view
  drawn from one set of parts, the same silhouette, markings, colours and
  proportions, keeps it one character; its views side by side show any drift.
- **A scene change is a physical event.** One scene's shape turns into the
  next: a surface breaks, a form grows into another, the view passes through an
  opening, the medium itself carries the eye over. A cut or a wipe changes
  the picture without changing the world, a blank frame mid-transition is a
  hole in it, and the next scene as a flat card the view moves into is a
  page, not a place; the hard cut below is the one exception.
  `core/time.js` only cuts; the change is authored as
  cues, as `cues.js` blends its scenes part by part, or one scene
  [dissolves](#dissolve) through the other. Named devices, each seen with
  `--at` at the [frame middles](#look-at-a-film) around its midpoint, where
  the frame stays textured and lit, not flat, empty, dark or a cross-fade
  of two pictures. With the scaffold, each device is two
  SHOTS: the shot change sits on the frame its Scaffold note names, each
  element its Scaffold note names lists both shots in its `shots` (or leaves
  `shots` out while it is on screen), and every other element lists only its
  own place's shot. Every beat, the arrival's included, comes a quarter of a
  second (6 frames at 24 fps) or more after the latest cut, the shot change or
  a camera cut, as [letting the eye land](#continuity) asks; the scaffold
  refuses an earlier one. It also refuses a `jolt` shot that starts inside
  that quarter second after a cut, or has a cut inside the quarter second
  after it starts ([what the build refuses](#build-the-film-in-order)):
  - A reflection breaks up: ripples cross a reflecting surface, the old
    scene's reflection stretches and breaks ([water](materials.md#water)), and
    the pieces settle into the next scene's reflection. Check: at the midpoint
    the surface carries broken bands in both scenes' colours. Scaffold: the
    shot change on the midpoint; the surface lists both shots, paints both
    scenes' reflections and blends them by time across the change, so neither
    switches on the midpoint.
  - A backlit cloud of particles, raised by an action on screen such as a
    fall, a stamp or a gust, crosses the frame and clears on the next place.
    Check: the raising action reads on its own frames before the cloud; at the
    midpoint grains of several sizes, each lit on the side towards the light,
    fill the frame and the next place's large shapes start to show through.
    Haze alone is a flat tone. Scaffold: the shot change on the frame where
    the cloud covers the most; the cloud lists both shots.
  - A held place passes through time: the view holds while its light moves
    across it and its matter changes, such as snow giving way to blossom, or
    lights coming on along a street. Check: at the midpoint the light and its
    shadows fall between their two positions, both states' matter is partly
    there, and the colour has not gone grey from mixing the two states.
    Scaffold: the shot change on the midpoint; the place lists both shots,
    gives one of its `states` to each, and its paint blends the two states
    and the light's two positions by time across the change, so nothing
    switches on the midpoint.
  - A detail carries the eye to the next place: the first scene closes in on
    a detail until it fills the frame, and one continuous move pulls out from
    it into the next place, whose large shapes and light grow in from the
    frame's edges while the detail holds. Choose a detail whose shape both
    places can hold. Check: no frame of either move jumps; on the frame where
    the detail fills the frame nothing else of the first place shows; and at
    the pull-out's midpoint the detail still reads while the next place's
    light and texture, not the first place's, fill the rest. A pull-out that
    stays in one place is an [opening](#plan-the-film) or a reveal, not a
    scene change. Scaffold: the shot change on the frame where the detail
    fills the frame; the detail lists both shots, and its point is the first
    shot's FOCUS `out` and the next shot's `in`. When neither shot holds the
    peak (the first beat at the film's highest `intensity`, `s.cues.peak` in
    the scaffold; a shot holds it when its first to last frame contains that
    frame, not when it overlaps the beat's span), the push-in stops a
    [framing step](#camera-and-framing) wider than the peak's, as
    [keeping the extremes](#plan-the-film) asks, so pick a detail larger than
    what the peak frames, such as a window rather than its latch; where that
    cannot hold, use another device. Check with `--at` on the frame where the
    detail fills the frame and on the peak's tightest frame: name each
    frame's framing step, and the detail's is at least one step wider, such
    as close against the peak's extreme close.
  - A subject comes forward out of backlit fog into detail, such as a figure
    walking. Check: at the midpoint its silhouette has a rim lit by the light
    behind it, and the fog grows denser with distance, hiding the far forms
    first ([the fog depth rule, with its near-neutral `beta`](materials.md#rain-snow-fog-and-dust)),
    rather than lying as a flat band. Light it as backlit fog in the same
    section: the haze is the brightest plane.
    Scaffold: the shot change on the midpoint,
    where the fog is densest; the subject and the fog both list both shots.
- **Two zip pans joined at their blurred middles change the place.** The view
  whips away from one place and whips into the next, in the same direction at
  the same speed, and the change sits in the frame where the blur is heaviest.
  The viewer reads one fast move, so it is a physical scene change, not a cut.
  With the scaffold, lay the two places side by side in design space, key one
  [zip pan](#camera-and-framing) from the first to the second, put the shot
  change on the move's middle frame, and give each place's elements a `shots`
  list naming only that place's shot. The two places' ambiences cross under
  the middle with `trail` and `lead`. `--at` at the frame middles across the
  move and `--sound` show it: the red cut line on the blurred middle frame,
  no detail of either place reading there, and the ambiences crossing at that
  line.
- **A journey across many scales zooms in log space.** Interpolate the
  zoom's logarithm, `z0 * (z1 / z0) ** e` with `e` the eased progress, so
  every doubling takes the same time; a zoom moved in value from 1 to 1000 at
  an even rate spends a thousandth of its time on the first doubling and half
  on the last,
  so it leaps then crawls. The scaffold's camera keys already move `zoom` and
  `dolly` this way. A key that also pans moves its `x`, `y` in a straight line
  on screen from where the key before shows it to the centre, so a target in
  frame at the start of a deep zoom stays in frame. Past a few doublings,
  give each scale its own detail ([detail and resolution](#detail-and-resolution))
  and a cue of scale, such as a thing of known size passing or a count of
  the steps, or the viewer loses how far they have gone. `--at` at even
  seconds through the middle shows the same size ratio from cell to cell.
- **A hard cut between scenes is a named full stop.** One sits where one idea
  is finished and the next begins, at most once or twice a film, named in the
  beat sheet. Two frames that differ strongly there, dark to light, near to
  far, still to moving or warm to cold, land the beat harder the greater the
  contrast. Contrast does not rescue a cut placed mid-idea.
- **A blend is a match.** Line the linking shape up across it, in place, size,
  direction of motion and colour, so the eye stays put while the world changes
  around it; start it on a movement that the next scene completes. Match the
  linking shape and invert everything around it. A cut lined up the same way,
  the same place, size, direction of motion and kind of shape on both sides,
  is a match cut: it reads as one thing becoming another, the
  [eye](#continuity) stays put across it, and between scenes it is still one
  of the [hard cuts](#continuity) the beat sheet names.
- **One element carries every state.** A sequence shown as one element that
  becomes each next state keeps the eye on one thing, so it reads as change,
  cause to result; removing one thing and adding the next reads as a list.
  Blend the states' outlines with `keyOutline` and check the blends with
  `keyFaults`, as [key poses](#paint-over-a-hidden-mannequin) are: trace each
  state with the same number of points, from a matching landmark such as its
  topmost point and the same way round, or the blend twists through itself.
  Match corners to corners too: points spaced round the whole outline from
  one landmark put a square's corners at a quarter, a half and three quarters
  of the way round and a triangle's at about a third and two thirds, so the
  corners slide along the edges and the morph reads smeared. Mark each
  state's corners in the same order, giving a state with fewer a point on an
  edge as its extra corner. Cut each outline at its corners into segments
  that each run from one corner to the next with both corners included, the
  last one wrapping round to the first corner (a stored outline does not
  repeat its first point, so a plain slice drops that closing edge). Place
  `per` points on each segment with
  `grow(seg, (j / per) * lengthOf(seg)).tip` for `j` from 0 to `per - 1`,
  with the same `per` for that segment in every state, and join the segments in order: each corner then has the same point
  index in every state, so it blends into the matching corner.
- **Along a path, place by length, not by point.** Outline points, marks or a
  traveller set at equal fractions of a path's length sit evenly and move at
  an even speed; set by point index, they bunch where the points bunch.
  `grow(path, u * lengthOf(path, close), close)` (`grow` from
  `core/path.js`, `lengthOf` from `core/geom.js`) gives the `tip` and
  `heading` at fraction `u`, so `n` tips at `u = i / n` on each state's
  outline give every state one point count (states with corners are spaced
  segment by segment between matched corners instead, as above); `resample` respaces a whole line
  once in build.
- **A container changes empty.** When a shape that holds things, such as a
  frame, a vessel or a panel, becomes its next state, its contents leave
  first, the container changes with nothing inside, and the next contents
  enter once it has landed, with a few frames' overlap at most. Contents
  carried through the change stretch with it or float free of it, and two
  changes at once split the eye. `--at` at the middle of the container's
  change shows it empty.
- **The view refits to each state, after it.** When a state is larger,
  smaller or another shape than the last, the view's centre and zoom follow
  its bounds, so each state fills about the same share of the frame: from
  `const [x0, y0, x1, y1] = bbox(points)` (`core/geom.js`), the box's centre
  and a zoom such as `0.7 * Math.min(W / (x1 - x0), H / (y1 - y0))`. Land
  the view a few frames after the state lands, or pass its bounds through
  `follow` as [a camera on a spring](#camera-and-framing) does: the change
  is seen, then framed. A view locked to the bounds hides the change, since
  the element never changes size on screen.
- **Screen direction carries through cuts and blends.** A subject that leaves
  moving right arrives moving right; two that will meet move towards each
  other, and a follower moves the way its lead does. The view kept on one
  side of the line the action runs along keeps looks and moves on their
  sides. A direction reversed once and on purpose turns inside a shot, or
  passes through a head-on view. Where the subject travels towards a goal, its
  direction carries that meaning, such as rightward or rising for towards,
  until the turn reverses it: on a shot strip, every row before the turn
  moves it the same way. Its distance and visibility change with the story
  too, as [plan the film](#plan-the-film) asks.
- **No jump cuts by accident.** A cut between two framings of one subject
  changes its scale by 1.5 to 2 times or turns the view around it by about 30
  degrees or more, so its visible sides and the background behind it plainly
  change; a smaller change reads as lost frames. A run of three or more cuts
  at one framing, each showing the subject's state plainly changed, is a
  deliberate ellipsis for a long time passing, such as growth, erosion or
  waiting, used on purpose, once.
- **A framing loses force each time it returns.** The same framing a third
  time unchanged is where it stops being seen.
- **One key light per scene.** Shadows, highlights and rims agree on where the
  main light comes from in every shot of a scene; it moves only with a cause on
  screen, such as a lamp carried or the sun going down. Every surface shaded
  from that plan agrees ([one light plan](materials.md#one-light-plan)). The
  scene's [white source](materials.md#one-light-plan) kept the same in every
  shot keeps a lamp from turning orange to white across a cut; it changes
  only with a cause on screen, as the key does.
- **Time passes in the world.** A jump in time shows as a changed state: the
  light, a growth, a worn or filled thing.
- **A thing that returns carries the time.** When one object comes back from
  scene to scene, its states listed in its cue table row, in order, each with
  the signs that show it, what has grown, worn, cracked, come loose or gone
  missing, such as a fence that loses a slat, then leans, then sprouts moss,
  give each scene one state, or a blend of two, whose signs its paint draws.
  A scene with no state of its own shows the object unchanged, and the viewer
  reads that no time passed. How long a state has lasted shows in the trace
  it leaves: a pale patch where a sign hung for years, a groove worn by a
  door that drags, a ring where a pot stood. A trace says "long" faster than
  any number of shots. A [shot strip](#look-at-a-film) shows it: the state
  each row should show, and its signs in that row.
- **One motif.** One shape, mark, prop, colour, sound or action returns
  through the film, changed each time, and the final image pays it off, at
  best with its meaning turned. Named in the spine, it is the one element
  kept past its beat on purpose.
- **One thing happens only once.** A shape, colour or voice that appears
  nowhere else in the film marks the turn.
- **Gags get anticipation and a hold**: wind up, land, and hold the result to
  read before the next beat ([takes and accents](#takes-and-accents)); plan
  each as [a comic beat](#a-comic-beat).
- **Whatever moves is pushed, pulled, carried or falls.** Each move has a
  cause the viewer can point to: a body's own effort, a contact, a force the
  scene shows ([an unseen force](#parts-coupled-in-space) reads through what
  it moves), or the scene's one gravity ([a law](#plan-the-film)). A thing
  that glides with nothing driving it reads as moved by an unseen hand. A
  thrown or dropped thing gains speed as it falls and slows near the top of
  its arc; each bounce rises lower and comes sooner than the last until it
  rests, and one that rebounds as high as it fell reads as weightless.
- **Motion has weight: parts overlap and follow through.** Nothing moves as one
  rigid pose. Loose parts, such as a tail, hair, cloth or a held prop, start
  after the body and arrive after it: drive them with `follow` from the body's
  own move, with a longer `delay` and softer `stiffness` the further they hang.
  A landing or a hit rings on a `spring` and holds until its `settle` before
  the next beat. A sine wobble or an instant pose reads as mechanical; a
  [wave that travels along the body](#travelling-wave) does not.
- **Two edges on two springs stretch a shape that travels.** Move its leading
  and trailing edges from one cue, each as `a + (b - a) * spring(opts)(s)`,
  the lead stiffer and the trail softer or a few hundredths of a second
  later: the shape stretches along the move as it leaves and draws back to
  its own length as the trail catches the stopped lead; a trail that rings
  past its mark squashes it on the landing.
  Scale its width by its rest length over its length so it keeps its area.
- **A target moved before it lands adds a spring.** A value sent on to a new
  target mid-move, such as a shape on to its next state, is
  `x0 + Σ (target_i - target_(i-1)) * spring(opts)(s - at_i)`, one term per
  change at second `at_i` and `target_0` the start; `spring` is 0 before its
  cue, so each term waits.
  Position and speed stay continuous at each change, where a spring
  restarted from where the value stands drops its speed to zero, a jerk.
  With one set of `opts`, the sum is one spring sent on.

### Parts coupled in space

When parts act on each other — a body knocks another, a cord drapes over a
peg, things pile — no cue table can author every contact. Solve them with
`simulate` from `core/sim.js` in a build stage, and let `draw` look the frame
up. A push that changes, such as a gust that crosses the frame, is its
`force`, a function of seconds and place; a cord that snaps or a join that
gives is a link named in `breaks`, at a second or past a stretch, and the
result's `broken` says on which frame it went, for the picture and the
sound to share:

```js
const { simulate, chain } = require('artifex/core/sim.js');
// build, with FRAMES and HZ the piece's own:
s.run = simulate({ frames: FRAMES, hz: HZ, gravity: [0, 900],
  particles, links: chain(first, count), walls, restitution: 0.4, quiet: 60 });
// draw:
const [x, y] = s.run.at(clock.frame, i);
```

- **The contact log is the score.** Every impact from `quiet` speed up is logged
  once, with its frame, point, normal speed and the two bodies. Each sound
  started on `contact.frame / hz` lands on the frame that first shows it. That
  frame already follows the impact, so it is the recoil frame
  [a hard hit](#takes-and-accents) sounds on, with no frame added for the hit
  (a far impact still takes its
  [distance delay](sound.md#voices-a-place-and-a-room)). Velocity comes
  from `speed`, pan from `x`, and each surface has its own voice. A log
  thinned so one body is heard at most every few frames keeps a settling pile
  from chattering, and a burst too dense to hear hit by hit is voiced as
  [one texture](sound.md#voices-a-place-and-a-room). The same impacts drawn, a ring that opens and thins, keep
  eye and ear agreeing.
- **Bodies let in on cue.** `hold` keeps a particle still for that many seconds,
  so releases can be timed like beats; a held particle with a `path` is a
  moving hand or a hook. Space the releases so the last frames still settle
  slowly, a roll or a slide, not a fresh burst: a film whose last frames
  barely change fails replay.
- **Things that tip over turn.** A box, a block or any convex shape that
  topples, tumbles or stacks is one of `simulate`'s
  [`bodies`](../../../docs/apis/piece-api.md#bodies-that-turn), not a cluster
  of discs: discs meet only at their edges, so a cluster's flat face sinks into
  what it lands on. Draw each from `pose(clock.frame, k)` with
  `translate(x, y)` then `rotate(angle)`, and voice its impacts from the same
  `contacts`, where a body's entry names it as `body`. A stack comes to rest
  and stops, so keep something else moving to the last frame.
- **An unseen force reads through what it moves.** A wind, a current or a
  pull shows through three or more things it moves at once, such as grass, a
  cloth edge and smoke, and at least one large part of the set, such as a
  tree's crown, a hanging sign or an awning. Each answers with its own lag and
  weight: light things answer first and swing widest, large masses later,
  less and slower, and they keep moving after the peak, as loose parts
  [follow through](#joints-that-break-in-succession). A layer that drifts,
  such as cloud or fog, speeds up with the curve and slows in the lull. One
  force curve in `build` that comes in gusts, a rise, a peak and a lull of a
  second or more rather than a steady sine, drives them all, and each thing
  delayed by its place along the force's direction makes a gust arrive from
  one side and cross the frame. A set that stays rigid at the peak makes the
  force an overlay. Anything that streams in the force, such as a tail, a
  flag or a plume, turns its axis from hanging toward the force's direction
  as the curve rises, straightening along it at the peak, and a
  [travelling wave](#travelling-wave) along that axis, its `AMP` following
  the curve, adds the flutter on top; one that hangs straight down says the
  air is still. A time strip at sheet size shows the force's direction in
  each cell, each gust's peak and three things it moves there, one a part of
  the set; `--at` frames a few tenths of a second apart as one gust arrives
  show, of things of similar weight, those nearest the side it comes from
  starting first, those on the far side later. Smoke itself is in
  [smoke](materials.md#smoke).
- **A part under tension gives way in beats.** Strain first: over the second
  before, the part straightens, thins or pales and creaks, so the viewer
  expects it. Then the break, in one or two frames, its parted ends springing
  apart fast and recoiling past rest; a free end goes slack at once, curving
  as it falls, and settles. With `simulate`, the end bead kept on the pulling
  part's `path` with `hold` set to the break second leaves at the path's
  speed under the solve's one `gravity`. Everything one event releases falls
  under the same [law](#plan-the-film): a free end standing rigid above a
  neighbour falling faster breaks it. A break staged in clear space, away
  from every other subject's outline, makes the gap opening between the
  parted ends the event, and a [cut in](#continuity) when that gap is small
  shows it. The gap and the recoil read at the film's viewing size, not at
  100%, and the break's voice sits on the first frame that shows the ends
  apart. The frames before and after it at sheet size show which part went
  where.
- **A step shorter than a body.** Discs can pass through each other when
  one moves more than its radius in a step; `substeps` raised stops it. Only particles
  collide, so beads of a cord sit closer than the peg they drape over is
  wide, or it passes between them. No body starts inside a collider: the collider pushes beads out on both
  sides, and a link laid across it stays across it.
- **Spin is drawn, not solved.** Turn a mark on each disc by the distance it
  travelled divided by its radius, and it reads as rolling.
- **Cost is paid once per solve**, but the look loop and the tests solve many
  times: `examples/cascade.js`, 32 particles over 216 frames, takes about a
  tenth of a second. Solve only the frames the film shows.

`examples/cascade.js` is the worked film: discs down three tuned ledges, a
hanging thread and a basin, each impact a ring and a note. `examples/drape.js`
is a still made the same way.

### Pace

- **Vary shot lengths.** Equal shots tick like a metronome; a long shot after
  short ones lands as an accent. End a shot when its move completes or its look
  lands, not on a grid.
- **Cut rate is thinking rate.** A calm stretch holds shots of about 10 s; a
  frantic one reaches about 25 cuts a minute. Fast cutting is earned: the
  stretch before the peak held in one continuous shot, then the peak broken
  into short shots of its parts. Repeated actions can shorten until the last lasts
  a few frames. Where the [music leads](music.md#when-music-leads), let its
  pulse set the cutting, turning irregular near the peak; in a story film
  with caused sounds the cuts follow the story. A film its music leads cuts on its
  [beat grid](music.md#the-beat-grid), each shot a whole number of bars, and
  moves on it as [the picture on the beat](music.md#the-picture-on-the-beat)
  says: key hits on beats over patterns that keep turning.
- **Shape the whole film's pace.** Plan a curve in the beat sheet: a settled
  opening, quickening towards the turn, a peak, then a rest before the final
  image. The heaviest beat may earn the longest hold. Give each figure its own
  tempo, long smooth moves for one and clipped ones for another. A rest keeps
  a slow, regular rhythm, its events and pulses at near-equal gaps, which
  calms; vary lengths everywhere else.
- **On a hard beat one big thing changes, and the rest follow.** Several
  things that each move smoothly, all starting inside the same fifth of a
  second (a size, a position, a brightness, the camera, a number), add up to
  a lurch: the frame-to-frame change of the whole picture spikes though no
  single move does. One of them takes the beat and the others start 0.1 to
  0.2 s apart after it. Two related spikes have the same cure. A term that
  switches on at a threshold jumps by its full size in one frame, so every
  term starts at 0 and rises on its own curve. An exit on a steep ease-in is
  fastest as it leaves the frame, with nothing after it: a gentler curve over
  more frames, or a constant speed, leaves without the spike. In one film
  five such changes together measured 7 to 11 times the median frame-to-frame
  change for five frames; on a film drawn on twos or threes the change is
  measured between drawings, not between repeated frames.
- **Mark the middle third.** Viewers remember the middle of a film least: in a
  film over about 30 s, the beat sheet names at least one beat between a
  third and two thirds of the length that carries a mark, such as a sudden
  stop, a framing change or a sound heard nowhere else.
- **A short folds that curve.** Under about a minute, many directors use a
  showreel arc: the [hook](#where-it-plays) inside the first half second, the
  densest stretch near two thirds of the length, then a
  [final image](#plan-the-film) that lands and holds. On a scaffold piece the
  beat with `peak: true` falls near two thirds.
- **Three strong moments beat ten average ones.** Viewers recall a few
  moments; ten at one weight level each other into texture. The beat sheet
  names the two or three that carry the film, sets them above the other beats
  in `intensity` so the rest lead into them, and keeps
  [the extremes](#plan-the-film) for the one of them that is the peak.
- **Show the source before it changes.** A transformation reads only against
  the state it starts from: the original shown whole and readable, about a
  second, or the quarter second a pose needs at least
  ([a key subject met whole](#plan-the-film)), makes the change visible; a film
  that opens mid-change shows only the result. In a feed the source can already
  stir on frame 1 while the change waits. `--at` on the last frame before the
  change shows the source whole.
- **Alternate fast and slow.** Speed reads by contrast: a burst after a slow
  stretch feels faster, and a slow stretch after a burst lets the eye read
  what happened. One speed throughout flattens, fast into noise or slow into a
  stall. A whole-film strip with `--json` at about two cells a second shows
  `change` rising and falling from section to section, not held level.
- **Neighbouring sections contrast.** Two sections side by side that share
  palette, key and mark treatment read as one long section. A short of several
  sections, such as stages of a change or stops on a tour, gives each a
  different colour, key or [mark technique](#plan-the-film) from the one
  before, planned in the [colour strip](#colour-across-the-film) so the
  [tone check](#look-at-a-film) in step 3 counts the step as planned. On a
  [shot strip](#look-at-a-film), whose
  rows are shots, the first row of each section differs from the last row of
  the section before, while shots within a section stay alike.
- **Every paused frame is a picture.** A short gets paused, scrubbed and
  captured at any frame, not only on its beats. A frame caught mid-move or
  mid-transition still holds a subject, a focus and the
  [focal composition](#film-art-direction). A `--frames` strip whose cells
  fall between the beats shows every cell as a picture: the cells sit about
  the length divided by one less than the count apart, so pick a count whose
  spacing does not divide the beats' spacing. On a 12 s film with beats on
  whole seconds, 13 cells land one a second, every cell on a beat; 12 land
  about 1.09 s apart, none of the ten between the ends on one.
- **Little frozen time.** Frames where nothing moves total about 1 s per 30 s
  of film, a rule of thumb from feed shorts. A held pose that drifts, a light
  that moves or a place that breathes is not frozen. When stillness is the
  point, such as a rest, a lullaby or the last image, the hold is planned in
  the beat sheet. On a `--frames` strip at one cell a second with `--json`,
  each cell whose `hold` stays under 2 marks about a second where no region
  moved.
- **Slow motion and time lapse are a warped clock.** Map `clock.seconds` to a
  scene time that runs slower or faster through a window, rising
  monotonically; drive every move from scene time, and place each sound at the
  film second its cause shows.
- **Trap: a simulation indexed by frame stutters when slowed.** Snapshots stored
  one per film frame hold no states between them: at quarter speed each shows
  for four frames and the motion steps. Step the simulation at least as finely
  as the slowest rate needs and index it by scene time, or interpolate between
  snapshots. `tween`, `spring`, `follow` and noise read at a time slow smoothly.
- **Twos hold the drawing; the camera stays on ones.** A style that animates
  on twos (or threes) holds each drawn subject and its marks (pose, shape, line wobble,
  texture seed) for n frames, n = 2 or 3: read their time at the hold's first frame,
  `drawingAt(clock, n).seconds` from `core/time.js`, and address a mark's seed by its `index`, so
  lines boil between drawings and stand still within one. A still's clock
  (`hz` 0 at frame 0) shows the first drawing, so the same `draw` exports a
  PNG or SVG. In a looping film, make the frame count (duration times `hz`) a
  multiple of n: otherwise the last drawing holds for fewer frames and boils
  early at the seam. A camera move,
  parallax planes, a slow light or grade change and the
  [film finish](#film-finish) still change on every frame.
- **Only the drawing holds; its place on screen moves on ones.** Every held
  subject drawn under this frame's camera transform moves with the plane it
  belongs to. When the camera follows a subject, the subject placed from the
  playhead as well, with only its pose held, stays put: a held position under
  a camera on ones jumps back and forth on screen once per drawing. A time
  strip with `--at` on the n frames of one hold and the first of the next,
  from a hold's start, `2,2.0417,2.0834` at 24 fps on twos,
  `2,2.0417,2.0834,2.125` on threes, shows every cell but the last with the
  same drawing, the last a new one, and the camera, the planes and the light
  moving in all of them.
- **In stop-motion the object's own move steps with its drawing.** A rigid
  object moved by hand (a cut-out, a sticker, a patch) reads its place on the
  set at the hold's first frame too, `drawingAt(clock, n).seconds`, so it hops from place to place; that
  stepped move is the look. The camera, and anything the camera carries,
  stays on ones. The bullet above differs in the kind of subject: a drawn
  subject holds only its pose, and its place follows the playhead and the
  camera on ones; a hand-moved rigid object holds its place on the set too.
  A fixed, panning or drifting camera frames a stepping object; one locked
  onto it makes each step jump back and forth on screen.

### Draw the drawing

When making the picture is the film, such as a reveal, a timelapse, a tutorial
or a diagram drawn as it is explained, every mark grows along its path or is
laid by a moving tool. Nothing fades in.

- **Order by medium.** Masses come before detail in every medium. Line work
  starts with light construction lines for placement, axes and masses, then
  the line itself, big forms before small, with details and accents last; ink
  comes before colour. Watercolour goes pencil, then washes light to dark, wet
  into wet before wet on dry, then darks, with brush-point details and
  splatter last. Opaque paint goes far to near or dark to light, a big brush
  before a small one, with the lights last. Lettering follows the picture it
  labels. Each [style guide](../styles/catalog.md) names its own drawing order.
- **Drawing order is time; layer order is depth.** Give each layer its own
  window on the clock, and paint the layers in the guide's layer order as
  usual: a pencil fill hatched in after its pen line still sits under it.
- **A large form is many strokes.** A hand does not round a whole shape in
  one line. It lays the outline in pieces that end at corners and turns, each
  begun near where the last ended; then the lines inside the form, such as
  the edges between its planes; then the shading, stroke by stroke. Each
  stroke has its own length, so its own time, and the hand lifts after it and
  pauses before a new part. A whole form traced as one path from end to end,
  however well eased, reads as a plotter. Nothing in `core/path.js` splits a
  path into strokes: write the form as a list of strokes, each its own point
  list (an outline's points sliced at its corners, neighbours sharing the
  corner point so the pieces still meet), and give each its own window in the
  cue table, longer for a longer stroke, with a gap for the lift. `grow` then
  reveals each stroke on its own, and the tool's tip travels from one
  stroke's end to the next one's start while it is lifted.
- **A hand slows at starts, corners and ends.** It sets the tool down slowly,
  moves fastest through the middle and slows into a corner and at the lift:
  ease each stroke's local time with `span` and `ease` from `core/time.js`
  before turning it into a length, and split a stroke at a sharp corner. A
  long line goes in sections with a lift between them. Between strokes the
  tool lifts and travels in the air, faster, on an arc. It pauses before a
  new part. A second pass lands slightly off the first. Hatching is a fast,
  steady back and forth. The next stroke starts near where the last ended.
- **Grow a mark by length.** `grow(pts, length)` from `core/path.js` returns
  the path drawn so far, its tip and its heading. Build the whole mark's
  geometry once (wobble, resampling, seeds) and grow it by length, so the
  drawn part never moves. A mark function that shapes itself by its own
  length fraction re-shapes as it grows: give widths by the length along the
  whole path, or accept the moving end as the nib's lift. A style's mark
  function that draws exactly the points it gets, such as a plain stroke,
  can take the grown points. One that wobbles, smooths or tapers the points
  it gets, such as a pen or a brush from its
  [module](../styles/catalog.md), re-shapes them, so never hand it the grown
  points or redraw its mark by hand. Call it on the whole path every frame,
  with the same `R` and `name`, inside a clip to the grown band, and wrap
  each clipped call in `g.save()` and `g.restore()` so the clip cuts no
  later mark, tool or label: `g.save()`, `poly(g, band, true)`, `g.clip()`,
  the call, `g.restore()`. Here `band = outline(grow(drawn, d).points, () => reach)`,
  where `drawn` is the points the function draws after its own smoothing
  (`chaikin(spine, passes)` from `core/geom.js` for a module that rounds its
  spine with Chaikin passes), and `reach` is a little wider than the mark
  with its wobble and blots (`grow(drawn, d, true)` for a closed outline).
  Draw none of it while the grown path has one point, and call it unclipped
  once `d` reaches the whole length. The mark keeps the style's own taper,
  breaks and blots, and its drawn part never moves. Split a path that
  crosses itself at the crossing, or the band uncovers the later pass early.
  An area grows inside the band its brush has swept: clip to
  `outline(grow(sweep, d).points, () => brushWidth)` of a back-and-forth path
  over it, inside its own `g.save()` and `g.restore()`, and draw none of the
  area until the grown sweep has two points. A style's fill function grows
  the same way, called whole inside that clip.
- **Show the tool when the hand or its pace is the story.** Leave it out when
  only the order matters. Put it at the tip, at a steady slant turned a little
  with the heading (never spun all the way round), over every layer. Its
  shadow falls away from the light, touches the tip only while drawing and
  separates on a lift. The tool leaves the frame before the end.
- **Pace a timelapse so the picture reads early.** The big shapes or the
  silhouette land in about the first fifth to a quarter, and everything the
  picture's point needs reads by about a third: the subject, and the second
  thing it turns on, such as a threat, an answer or a punchline. After that
  read the viewer already knows the picture, so the rest of the build is
  enrichment that spends their attention; a viewer who has read the subject
  and still waits for the point calls the film slow, however fine the
  drawing. Spend time on the strokes that change the read. Ambient fill that
  changes it little, such as hatching, rows of dashes, scattered dots or a
  wash, grows several marks at once or at a faster rate, beside the next
  part or after the point, never in front of it; vary the rate with a
  [warped clock](#pace). The build ends early enough to hold the finished
  drawing for a second or two. A build that is one scene of a longer film
  stays shorter than the action it sets up, and its scene is whole before
  that action needs it.
- **Something besides the tip changes while the picture assembles.** One
  growing stroke on a still page is not a [frozen frame](#pace), yet it reads
  as waiting. Marks already drawn can live: a
  [boil re-seeded every few frames](#an-object-that-acts) on whole marks only,
  while the growing mark keeps its one geometry and seed, a drawn element
  that starts to act once it is whole, or several marks growing at once so
  more of the frame changes; [fast against slow](#pace) keeps the rate
  itself moving.
- **A still shows the finished drawing.** The same `draw` delivered as a still,
  a piece with no `time` whose clock has `hz` 0, maps that clock to the end of
  the drawing. A still of the film, such as the still tool's `--at` on the
  final hold, shows the finished drawing too.
  [Frame 0 is the thumbnail](#where-it-plays): opening on the construction
  lines can show what is coming.

```js
const { grow, outline, fill } = require('artifex/core/path.js');
const { span, ease } = require('artifex/core/time.js');
// A still (no `time`, so `hz` 0) shows the finished drawing; a film, the drawing so far.
const now = clock.hz === 0 ? s.end : clock.seconds;
let tool = null;
// s.marks, built once in drawing order: points, length, start, end, width(u), ink.
for (const m of s.marks) {
  const drawn = m.length * ease.inOut(span(m.start, m.end, now));
  const { points, tip, heading, length, total } = grow(m.points, drawn);
  if (points.length < 2) continue;  // not started: no line yet
  g.fillStyle = m.ink;
  // The returned length, clamped to the path: a `drawn` past the end would push width out of range.
  fill(g, outline(points, (u) => m.width((u * length) / total)));
  if (now > m.start && now < m.end) tool = { tip, heading };
}
if (tool) drawTool(g, tool);  // over every layer
```

### Words in motion

Titles, captions, lyrics and spoken lines set in motion. The stroke font's
letters and marks, and a title's size, place and value, come from
[text in the frame](making.md#text-in-the-frame); these lines cover how
words arrive, act, change, hold and leave. The figures are conventions of motion
titling and captioning, not measured limits.

- **Reveal by phrase.** Two to four words that belong together land as one
  unit, in the rhythm the line would be spoken, and the next group follows
  when the first has been read. Letter by letter makes the viewer wait for a
  word; a whole paragraph at once makes them hunt for where to start. A
  group drawn on [grows like any mark](#draw-the-drawing): `glyph(ch)` from
  `core/stroke-font.js` gives a letter's strokes in font units, 7 to the cap
  height, ready to scale and grow by length.
- **A word can take a physical role, built from its own letters.** Its
  strokes become the thing the line names or needs, such as a rope, a step,
  a crack or a falling weight, and obey the scene's
  [laws](#plan-the-film) like any object, which makes the word
  [a thing in the world](#plan-the-film) rather than a title over it.
- **A word is legible before it changes.** It lands whole and holds readable,
  then bends, breaks or becomes its role. A word that transforms while it is
  still arriving is never read, and the change means nothing.
- **Move whole letters, not outlines between letters.** When one letter or
  word changes into another, each letter moves, turns or falls as one rigid
  glyph and stays a letter at every frame; a word becoming its physical role
  after it has been read is the exception above. Morphing one letter's
  strokes into another's passes through shapes that are no letter, and the
  stroke font's letters hold different numbers of strokes, so a morph also
  has to invent strokes. `text()` puts a letter's cap line at `y` and its
  left edge at `x`, so turn letter `i` about its centre: with `k = size / 7`
  and `advance = width('aa', size) - width('a', size)`, the font's fixed
  advance, translate to `(x + i * advance + 2 * k, y + 3.5 * k)`, turn there
  and draw `text(g, ch, -2 * k, -3.5 * k, size)`, as `sfx()` in
  `styles/flat-cartoon.js` does. Turned about its top-left corner, a letter
  swings out of its slot.
- **An old line leaves along its length.** Retract it by drawing a falling
  length with `grow`, or give the reversed path the same falling length to
  erase it from its start;
  the stroke undoes the way it came, where a fade leaves a ghost behind the
  next line.
- **A held stillness lets a resolution land.** Before the last word, the
  twist or the answer, everything stops for about 400 ms; the pause is the
  anticipation that a [take](#takes-and-accents) gives a body. Motion that
  runs straight into the resolution spends it.
- **The outgoing word can mask the incoming one.** As one word leaves, the
  area it sweeps or uncovers reveals the next, through a clip as
  [dissolve](#dissolve) does, so the change reads as one move rather than an
  exit and an entrance.
- **A caption is short and alone.** About 7 words or fewer, one text layer on
  screen at a time, so the eye never chooses between two reads. Each readable
  item, even a single word flashed on a beat, holds at least about 8 clean
  frames at 24 fps (a third of a second, so more frames at a higher rate),
  fully drawn and not moving; that floor is for a word flashed as an accent.
  A caption or title meant to be read still holds until it reads aloud
  slowly, about max(1.5, 1 + 0.3 x words) seconds: 1.5 s for one word, 3.1 s
  for seven.
- **Size and contrast are set for the box it plays in.** A caption that
  reads at full size can blur away at phone size: the strip at about 360 px a
  cell that [reads at phone size](#where-it-plays) describes shows whether
  each word still reads.
- **The meaning survives muted.** Where the film
  [plays muted](#where-it-plays), words the soundtrack carries, such as a
  sung or spoken line, appear on screen, and the words with the picture tell
  the beat alone. A [fresh-eyes reviewer](#fresh-eyes-review) given only the
  frames, asked what each line says and when, names them.
- **A second face, kerned at display size.** Hierarchy can come from a
  second face as well as size, stroke width, value and timing: the stroke
  font has `mono` and the Hershey faces, `kern: true` closes the gaps a large
  word shows, and `display()` draws a filled word (see
  [lettering in the skill](../SKILL.md)). One face carries the voice, a second
  at most.

### Dissolve

One scene burns, melts, rusts or erodes away and the next shows through, along
an edge a seeded noise field shapes, with a bright band at the front. Compute the
noise once per cell in build; each frame only compares it with a front that
sweeps over time:

```js
const CELL = 4, EDGE = 0.05;  // design units per cell; band width in noise units
// In build: one noise value per cell, and their range.
const R = rng(s.seed);
s.cells = []; s.lo = Infinity; s.hi = -Infinity;
for (let y = 0; y < H; y += CELL) for (let x = 0; x < W; x += CELL) {
  const n = fbm(R, x / 160, y / 160, 4, 'dissolve');
  s.cells.push([x, y, n]); s.lo = Math.min(s.lo, n); s.hi = Math.max(s.hi, n);
}
// In draw: B underneath, A where the noise is still above the front, the band at it.
const front = lerp(s.lo - 2 * EDGE, s.hi, span(2, 5, clock.seconds));
drawSceneB(g, s, clock);
g.save(); g.beginPath();
for (const [x, y, n] of s.cells) if (n > front + EDGE) g.rect(x, y, CELL, CELL);
g.clip(); drawSceneA(g, s, clock); g.restore();
g.beginPath();
for (const [x, y, n] of s.cells) if (n > front && n <= front + EDGE) g.rect(x, y, CELL, CELL);
g.fillStyle = '#ffd27a'; g.fill();
```

- **Sweep the measured range, in seconds.** `fbm` bunches near its middle, so a
  front swept over `[0, 1]` idles at both ends, and even over the measured range
  most of the change lands mid-window: give the window the time. `draw`'s `t`
  is the normalized playhead; a window in seconds takes `clock.seconds`.
- **The band is the cause.** Hot for a burn, pale for a thaw, rust for
  corrosion; it can [light what lies around it](#what-every-scene-holds).
  `EDGE` is its width in noise units; `fbm`'s measured range is often well
  under 1, so compare it with `s.hi - s.lo`.
- **`CELL` is the edge's grain and its cost.** Keep it [several output pixels](#detail-and-resolution);
  the noise scale (160 here) sets how large the islands are. The clip path is
  rebuilt from every cell each frame: 32,400 cells (960 by 540 at `CELL` 4)
  took about 20 to 60 ms a frame on a 640 px time strip while the front
  crossed, and the cost grows with the cell count, so give a larger box larger
  cells.

**A growth front can carry the change instead of noise.** Let a cellular
automaton grow the next scene out of seeded patches: solve every generation in a
build stage, as `examples/growth.js` does, so a scrub lands where playback does,
and keep for each cell the first generation it came alive. Map generations to
frames, such as generation `g` on frame `start + g * step`; each frame draws B
where a cell's birth frame has passed and A over the rest, as the dissolve's
clip does with its noise, with the band on the cells born in the last few
generations. Patches seeded where the linking shape stands grow the front out
of the match, and B drawn whole once the window ends covers the cells a rule
can leave untouched.

**An opening or a flood can carry the change.** B shows through a shape that
grows in the world, such as an opening, a pool of light or a fill spreading
from a point, clipped as the dissolve clips to its cells.

- **Ease an opening by area, not radius.** A radius eased directly grows the
  opening's area with the square of the ease, so little changes early and
  the change bunches later. While the opening stays inside the frame, a
  radius of `r1 * Math.sqrt(e)`, with `r1` its final radius and `e` the
  eased progress, keeps its area on the ease. An opening that runs out to
  the farthest corner, `Math.hypot(Math.max(cx, W - cx), Math.max(cy, H -
  cy))`, passes the nearer edges long before that, so `Math.sqrt(e)` then
  uncovers the frame early: about three quarters of a centred 16:9 frame by
  the window's middle, where a radius eased directly has uncovered under
  half. Ease such an opening by the share of the frame it uncovers: count
  the cells of a coarse grid inside a trial radius and bisect for the
  radius whose share equals `e`. `--at` on the window's middle frame shows
  about half the frame in B.
- **A flood runs past the corners.** Its front's last position lies beyond
  the farthest corner by its band and its edge's wobble, so no sliver of A
  stays in a corner. `--at` on the window's last frame shows all four
  corners in B.

### Travelling wave

A tail, fin, ribbon, stem, flag or cable bends as a wave that runs from its
fixed end to its free end, not as a whole-body sine. With `u` from 0 at the
fixed end to 1 at the free end, its sideways offset is
`AMP * mask(u) * sin(K * u - OMEGA * seconds + phase)`:

```js
const K = 2 * Math.PI * 1.2, OMEGA = 2 * Math.PI * 1.5, AMP = 28;
// In build, with const R = rng(s.seed): each instance out of step.
s.phase = s.bodies.map((b, i) => R('body', 'phase', i) * 2 * Math.PI);
// In draw, for body i at x, y:
const pts = [];
for (let j = 0; j <= 24; j++) {
  const u = j / 24;                                    // 0 at the head, 1 at the tail
  const side = AMP * smoothstep(0.15, 1, u) * Math.sin(K * u - OMEGA * clock.seconds + s.phase[i]);
  pts.push([x - u * len, y + side]);                   // offset across the body's axis
}
```

- **`K` bends, `OMEGA` beats.** `K / 2π` is how many waves the body holds;
  `OMEGA / 2π` how many pass per second. Minus `OMEGA` sends the crest towards
  the tail; plus sends it towards the head.
- **The mask holds the head.** It keeps the fixed end still and lets the free
  end swing most; a body with no mask wags as one piece.
- **Phase per instance.** A group sharing one phase moves in lockstep; draw it
  from `R` by the instance's index. Vary `OMEGA` slightly per instance too.
  In a looping film every `OMEGA` keeps `duration * OMEGA / 2π` whole, such
  as a different whole number of beats per instance.
- **Drive it from the body's effort.** Scale `AMP` with how hard the body
  pushes, through [`follow`](../../../docs/apis/piece-api.md#authored-time), so
  the wave dies out after it stops. Keep `OMEGA` fixed within a shot:
  `OMEGA * seconds` with an `OMEGA` that changes jumps the phase.

### Figures that read

A figure is anything with a body that acts: a person, an animal, a creature,
an object that moves as if alive, whose character comes from what it is
([an object that acts](#an-object-that-acts)). A stick figure, dots for eyes
on a person, an animal or a creature, bars for arms and a pose with both sides alike all say "diagram", not "someone". The figure
is built before it moves, in this order, each step seen at the size the film
shows it. A person, an animal or a creature is painted over a
[hidden mannequin](#paint-over-a-hidden-mannequin), laid the way a painter
lays it: brush strokes over one painted mass, not filled blocks. A machine, a
puppet or a cut-out is [hinged](#hinged-figures). A [style's guide](../styles/catalog.md)
that sets its own figure rules wins over the defaults below.

#### Build from volumes

- **Simple solids are the mannequin.** Every part has a volume: a ball, an
  egg, a box, a cylinder or a tube that tapers. The head is
  one mass; the trunk is a chest egg and a pelvis ball joined by one to three
  waist balls, so it bends and twists along its length; each limb is a tube
  thicker near the body than at its end, with a ball at each joint. The joint
  balls are sized in head widths, a head width being about 0.75 of a head's
  height ([landmarks, lengths and joints](#landmarks-lengths-and-joints)).
  These solids and their landmarks are state in `build`. On an organic figure
  they place the painted forms and stay out of the film.
- **A form is one closed silhouette, not parts and not a line of one width.**
  Each form is one filled outline. A line stroked at one width reads as a bar
  however wide it is; a style that draws a limb in one stroke, as a brush
  does, swells and thins that stroke along it. The two contours of a limb
  differ: one side curves where the other runs straighter, and the curves
  alternate along it. On a [hinged figure](#hinged-figures) each rigid part is
  its own closed shape with two contours, modelled in its own frame.
- **The turn of each volume shows.** One side lit and the other shaded from
  the scene's light, as on any solid ([materials and light](materials.md)). On
  a painted figure that modelling runs across the whole form and over its
  joints, not part by part. A part filled in one flat colour, as on a cut-out
  or a [hinged figure](#hinged-figures), still turns: a thin light line runs
  along its lit side and a darker rim along its shade side, both placed from
  the one light, so every part agrees where the light comes from. The far side
  of the figure takes both lines dimmer, never none; a far part left flat
  reads as a hole. This models a flat-colour figure and does not replace
  painting an organic one over a
  [hidden mannequin](#paint-over-a-hidden-mannequin).
  Where a near form passes in front of a far one, the near outline runs
  unbroken and cuts the far one off. A cross-contour, such as a cuff, a band or
  a fold, curves around the form and shows which way it faces
  ([marks that model form](stills.md#marks-that-model-form)).
- **The masses answer the action.** A mass that keeps one shape in every
  pose reads as a doll. Each response below is a change of the painted
  outline and its strokes: a crease is a stroke on the concave side, a bulge a
  swelling of the contour, an opening a pair of fold strokes. A separate
  shape laid over the fill, or a block swapped in, reads as a seam. The responses that follow
  the pose, the crease, armpit, shoulder cap, buttock fold, knuckle and elbow
  rows, are drawn into each key's outline and blended point by point like any
  key ([paint over a hidden mannequin](#paint-over-a-hidden-mannequin)). The
  effort and flattening rows are applied to the blended outline on each frame,
  from the figure's [effort value](#gesture-and-mood) and the support line, so
  no key outline bakes them in. On a [hinged figure](#hinged-figures) of a
  rubbery cast the same rules move its parts' outlines; a skeletal cast's
  rigid parts keep their size, so it takes none of them. The numbers are
  starting values, not measured: those of the first four rows were judged on a
  probe at film size, the others worked out.

  | Rule | Holds for | Kind | What it changes in the outline and strokes |
  | --- | --- | --- | --- |
  | Under effort the working masses shorten, round and sharpen; soft masses lift. At rest they lengthen and sag. | Any body with soft masses | Anatomy | At effort 1 the working mass's contour points between its two landmarks pull toward its middle by up to about 8% of its length and swell outward, so its area stays the same, as a [squash keeps its volume](#takes-and-accents). The contour turns tighter at its landmarks, and the soft masses' points rise. At effort 0 the same points lengthen back and drop toward the ground, the lower contour sagging a little below the mannequin's ball. |
  | A crease forms on the concave side of a bend. | Any biped | Anatomy; faint in a stylised piece | One tapered stroke at contour weight, inside the concave side at the joint landmark. It is absent while the joint is straight, appears past about 15°, and reaches full length, about the limb's width at that joint, and full weight at about 90°. A stylised piece draws it at about 0.4 of that weight or leaves it out. The convex side's long stroke stays unbroken. |
  | A soft mass flattens where it rests on a floor or a seat. | Any body | Anatomy | Contour points that would cross the support line are set on it, so the contour runs straight along the contact. The area lost there swells the contour beside it, spread over the lower half of the mass: piled just beside the contact, it reads as a lip. The contact shadow stays, as [what every scene holds](#what-every-scene-holds) says. |
  | The armpit opens as the arm rises. | Human; a humanoid takes it | Anatomy | Past about 40° of raise, as the shoulder girdle starts to lift ([landmarks, lengths and joints](#landmarks-lengths-and-joints)), the contour under the shoulder opens into a hollow between a front fold stroke and a back fold stroke. The latissimus wing swells the side contour below it toward the waist. Arm down, the folds close into one short line. |
  | The shoulder cap's point runs down the upper arm. | Human; a humanoid takes it | Anatomy | The shoulder cap's contour stroke ends on the outer upper arm about a third of the way to the elbow, and its swelling peaks above that point. |
  | The buttock fold shows only while the hip is straight. | Human | Anatomy | A short fold stroke under the buttock while the thigh is within about 15° of straight. It shortens as the hip bends and is gone past that. |
  | The knuckles rise as the hand closes. | Any hand with knuckles | Anatomy | As the fingers curl, the knuckle landmarks become the fist's top contour and swell it in a row of small bumps. Open, the back of the hand runs smooth. |
  | The elbow is a bony corner outside and a notch inside. | Any biped with an elbow | Anatomy | On a bend the outer contour turns at the elbow point as a corner, where the upper-arm stroke ends. The inner contour pinches into a notch, where the crease of the second row sits. |

  A `--loupe` crop at the rest pose, the full pose and the middle of each
  blend shows it: the crease absent at rest and growing with the bend, a resting
  soft mass meets its support in a straight run, the armpit is closed with the
  arm down and open overhead, the buttock fold is gone on a bent hip, and no
  response shows as a seam or a shape laid over the fill.

#### Paint over a hidden mannequin

The default for a person, an animal or a creature. Painted forms bend where
the figure bends, with no seam where two parts of one material meet.

- **The mannequin is hidden state.** Its joints, masses and landmarks place
  each key pose of the figure. It shows on a judging overlay, not in the film.
  `pose` and `reach` from `artifex/core/armature.js`
  ([depth armature](../../../docs/apis/piece-api.md#depth-armature)) pose its
  limbs in depth, and the outline is traced from their projected joints. The
  body is posed in its own frame, facing `-z`, and `project`'s `view` turns
  for a three-quarter view. With a short `focal` and a part aimed at the
  camera, `project`'s `perspective: 'joint'` divides each joint by its own
  depth: draw each end's width from its section's `major`, so the near end
  swells and the far end narrows; the default weak perspective gives both ends
  one width. A
  middle joint bends along the body's own forward and back axis:
  `reach(root, end, [a, b], bendDir)` puts it on `bendDir`'s side, so a knee
  takes the body's forward, `[0, 0, -1]`, and an elbow its back, `[0, 0, 1]`,
  whatever the view. So in a front or three-quarter view a bent joint shortens
  both its segments instead of swinging out sideways. A joint bent sideways
  is a pose that spreads it. `reach` refuses a bend direction parallel
  to the line from the root to the target, so a limb aimed straight along the
  body's forward axis can take neither `[0, 0, -1]` nor `[0, 0, 1]`. A bend
  direction tilted a little toward the ground on every frame, such as
  `[0, 0.2, 1]` for a joint that bends back, drops the joint a little under
  the line there, continuous from frame to frame, instead of jumping when the
  limb crosses the axis, and takes a `reasons` entry on the frames where it
  leaves the line. The tilt is a starting value judged on a proof, not
  measured. It suits a limb near that axis: on a limb reaching sideways the
  whole tilt shows in a front view, and with `[0, 0.2, 1]` a joint bent past
  about 55° leaves the line by more than 0.05 of the span, so the tilt eases
  to 0 as the limb turns away from the axis.
- **Every bend stays in depth.** In a front view, each limb's middle joint
  stays on the picture line between its two neighbours, within 0.05 of their
  span, unless the pose spreads it. The rule divides the joint's offset by
  that span, so it skips only a limb aimed exactly along the view axis, whose
  span is zero; a limb aimed nearly along it has a short span, so a joint a
  little off the line, from a tilted bend direction or a view pitched off the
  body's axis, measures as a large share of it, and takes a `reasons` entry
  on those frames. In a three-quarter view a bent knee moves toward the side
  the body faces and a bent elbow toward the side its back faces, not out
  across the body's own side, which only the eye checks. The posed chains sit
  in `state.cues.armature`, with `front: true` on chains seen from the front,
  `planted` on a limb whose end holds still and a `reasons` entry for each
  joint the pose spreads. The slide rule compares a planted end with the
  frame before, except on a frame that opens a shot in `state.cues.shots`: a
  piece that keeps its shot list keeps `planted` across a cut, and one that
  keeps none clears `planted` on the cut's first frame. A list counts only
  when every shot has its own name and whole frames
  `0 <= start < end <= frames`; any other list counts as none, and two shots
  of one name are refused.
  `npm --prefix "<library root>" run seeds -- "./my-piece.cjs" --at <times> --armature --png`
  ([armature overlay](../../../docs/knowledge/command-line-tools.md#armature-overlay))
  prints each joint fault, and `armature: no joint faults on <frames> frames`
  once none is left.
- **A bend turned off the camera reads; head-on, four cues give it depth.** A joint
  that bends toward or away from the viewer shortens both its segments, so
  the bent limb's outline is a shorter straight limb, and its cues alone
  leave it reading as one: the staging row
  [turn a bend 30-45° off the camera](#silhouette-and-line-of-action) comes
  first, so the bend shows as one side contour shortening against the other.
  When the pose stays head-on, four cues say what the outline cannot.
  The near segment's plane that faces the key catches the light while
  the far segment sits in half-tone, one value step across the joint
  ([form: tones, ratio, occlusion](materials.md#form-tones-ratio-occlusion)).
  The near segment casts its shadow onto the far one just past the joint.
  The near segment's contour runs unbroken over the far one, whose contour
  stops on it in a T ([silhouette and line of action](#silhouette-and-line-of-action)).
  The ground shadow under the limb's end stays rooted at its contact while
  the limb shortens ([everything stands on something](#what-every-scene-holds)).
  Such as a thigh over a shin in a crouch, or a forearm over an upper arm in
  a reach toward the viewer. A `--loupe` crop of the full pose shows the
  bend in the outline, or the view head-on by the plan with all four cues
  there; a head-on bend with none reads as a short straight limb, and one
  with all four still reads less than a turned one.
- **Each form of one material is one silhouette.** Filled as one painted
  mass under every stroke: a flat colour of its material, or a gradient that
  is only an underlayer for the modelling strokes, not the only modelling.
  No part has a fill or shading of its own. The fill runs
  across the joints without a seam. Two parts filled apart whose edges fall
  on one line each cover those edge pixels only in part, blended with what
  lies under them, so a pale seam shows between them; one fill of their
  outline leaves none. The contour strokes over it are separate
  marks that overlap there. A line appears only where a near form overlaps a
  far one, or where the material changes.
- **One figure is several chains posed in one body frame.** The trunk and
  each limb is a chain of its own, kept by name in `state.cues.armature`. The
  silhouette is one fill of the union of their projected forms. The marks and
  contours over it go far to near by mean depth, so a line appears only where
  a near segment passes over a far one, in the T of the bend cues above, with
  the [narrow dark band on the far form](stills.md#marks-that-model-form)
  against the near outline. No line where a limb joins the trunk at its
  root, and none between two segments of one chain unless one passes over
  the other. The root's no-line zone is a circle about the root joint that
  covers the limb's rounded cap and its blend into the trunk: about 1.8 times
  the limb's radius there. At 0.6 of that radius the cap of a limb that comes
  forward drew a U on the trunk. Where two limb roots and the trunk meet, the
  zone is one circle about the point between the two roots, about half a head
  across each way, and a closed outline smaller than a joint ball is dropped:
  three parts meeting leave a pocket whose outline reads as anatomy nobody
  painted. Between any two parts the shadows go as across a bend, and the
  darkest accent sits where they touch.
- **The gesture first.** Before any contour, the line of action comes from
  the mannequin: one curve through its main masses, from the head to
  whatever carries the weight ([line of action](#silhouette-and-line-of-action),
  [gesture](#gesture-and-mood)), hidden, like the mannequin. The longest
  contour stroke runs down the stretched side, outside the curve, unbroken
  unless that side faces the light: there the lift below wins, and the
  stroke breaks where the light falls. A time strip shows this stroke
  following the body's bend.
- **The contour is strokes, not one outline.** Each stroke starts and ends
  at a landmark, where the contour turns: a joint, a tip or a corner. It
  swells under pressure in the middle and tapers to a point at both ends. It
  runs a few samples past its landmark, so it overlaps the next stroke at a
  joint instead of meeting it end to end. It is heavier on the side away from
  the light and lifts where the light falls on the edge, so the lit contour
  breaks. Inked opaque, an overlap does not darken. A `--loupe` crop shows
  every end tapering, the lit side breaking at least once, and two strokes
  overlapping at each joint with no blob or notch. A contour with no taper
  or no break reads as an outline, not a stroke.
- **Model with strokes that wrap the form**, clipped to the silhouette, after
  the masses and value groups are set
  ([paint in masses, values and edges](stills.md#paint-in-masses-values-and-edges)).
  Each limb is a tapered cylinder; a broad form such as a trunk is modelled
  by its planes, as the next bullet says. A limb's modelling strokes are
  cross-contours: arcs of the ellipse its section shows at the view angle,
  laid across it on the half nearer the viewer (within a tilt of 0.2 of
  end-on they can ease round onto the far half), heavy on the shade side and
  thinning toward the light ([materials and light](materials.md)). They are
  nearly straight where the form lies across the view and rounder as it points
  toward or away from the viewer. A view a little above or below eye level
  opens them on upright forms; a form lying level across the view keeps
  straight marks at any height in front of the eye, and they open a little to
  either side of it ([marks that model form](stills.md#marks-that-model-form)).
  Lay them with `crossContours(seg, R, name, { light, at, width, eye, stop })` from
  `artifex/core/path.js` on each projected segment, with one `name` per
  segment, and fill each mark `m` with `fill(g, outline(m.points, m.width))`
  ([cross-contours](../../../docs/apis/piece-api.md#cross-contours)). `eye`
  is `{ at, focal }`: the picture point `project` gives its `centre`, and its
  `focal`. Each mark then opens by its own direction from the eye, so along an
  upright form the marks flip from one side of eye level to the other and lie
  straight across it; leave `eye` out only for an orthographic or flat look,
  where every mark on a segment opens alike. Each
  segment takes a fixed `at` list, seeded once from its true length over the
  spacing: without `at`, the count follows the picture length, so a segment
  that bends or foreshortens changes its count mid-motion and every mark on
  it jumps. `crossContours` runs each arc round toward the light; cut each
  mark where the surface under it turns toward the light, at a seeded place
  per mark, so every cross-contour starts in the shade and stops in the
  half-tone, before the lit side, and the lit side stays broad and quiet with
  no mark across it. One way is `stop: [low, high]`, which ends each mark
  where its section first reaches a seeded light level between the two,
  easing in over 0.2 of full light so marks shorten smoothly as a form bends;
  a mark can run up to 0.2 past its level, so set `high` 0.2 under the light
  where the lit side must stay clear. Space the marks as
  [shading marks set close but uneven](stills.md#marks-that-model-form)
  describes, drawn closer toward each segment's ends, each mark's width and
  opacity varied from seeded values. Strokes along a form go only on its contour and long
  edges: shade strokes a little inside the contour on the shade side, and
  fewer, lighter strokes in a tint of the base on the lit side. They run on
  across a joint, as the form does. A stroke lifts at a sharp corner, where
  its path inside the form would cross itself. Far forms go first. Every
  stroke placed from the mannequin and seeded values, not `Math.random`,
  holds still between frames. A `--loupe` crop shows the cross-contours on
  one limb bowing the same way and flipping only where the limb turns toward
  the viewer or, with `eye`, where it crosses eye level, the strokes reading as separate marks, at least one crossing
  each joint, no two neighbouring marks sharing a length, a width or a
  light-side end (`crossContours` starts every arc on the rim away from the
  light, and without `eye` within 9° of one point, so the shade ends line up), the shade-side marks close but unevenly
  spaced and the lit side with no bands, and a smooth gradient not the only modelling.
- **A broad form takes its modelling from its planes, and marks only where it
  turns.** A form wider than about a head, seen near eye level, shows its
  cross-contours as straight bars, and they read as scratches, not roundness.
  It carries no marks across it. Its form comes from three things: the shade
  shape, the strokes along its contour on the shade side, and its
  [inner landmarks](#starting-masses-front-and-side). The shade shape follows
  the planes, not every solid of the mannequin: the light is taken from the
  broad masses alone (on a trunk the ribcage, the waist and the pelvis), and
  the small masses that shape the outline (a chest front, a shoulder blade,
  a kneecap) are left out of it. Lit from every solid, the shade of a trunk
  built from twenty balls is one jagged blob; lit from its three broad masses
  it is a few shapes that end on plane edges: under the chest, down the side
  of the ribs, under the belly. A plane edge the broad masses do not give is
  a landmark stroke, not another solid. A cast shadow from a small form onto
  a broad one, such as a head's onto a chest, reads as a stain at film size
  unless the shot is about it. A `--loupe` crop of the trunk shows no mark
  across its lit side, at most four shade shapes, and each shade edge on a
  plane edge or a landmark. Judged on one practice set of seven poses at
  750 px, not measured.
- **The shade keeps an edge, and the half-tone carries the turn.** One blur
  over every tone paints smooth plastic: the form turns, and nothing says
  where the light stops. A painter keeps the edge of the shade shape and lets
  a wider, softer half-tone under it carry the turn. On that practice set, a
  shade shape blurred about 1 px over a half-tone blurred about 6 px, at 750
  px tall, read as painted where 2.5 px and 4 px had read as a doll. A kept
  edge also shows every shape the shade makes, so the key's height starts to
  matter: from about 50° above, every underside of a broad form went dark and
  the shapes ran down its middle like stains; from the side and the front,
  about 30° above, the shade gathered on the far side of each form. The
  contour answers the same light with a wide range: from about a tenth of
  its peak width on the lit side to more than its peak in the shade, rising
  faster than the shade does (the shade to the power 1.6), and lifted where
  the shade is under about a quarter, so the lit side breaks often. On a
  light base colour the cross-contours of a limb in the darkest colour read
  as scratches; in the shade colour, at an opacity of 0.06 to 0.36 with
  about half of them left out, they read as modelling. These amend the
  table below for a light, smooth material and were judged on that one set.
- **The marks scale to the figure's height in the saved film**, in pixels at
  `filmScale(piece)` ([the smallest figure](#the-smallest-figure-that-still-acts)).
  A piece draws in its own units and the film scales them by `filmScale(piece)`,
  so `outline()` and `crossContours()` take each width and the spacing below
  divided by `filmScale(piece)`; the height is in film pixels, as
  `figureHeight()` returns it.
  These starting values were judged on `--loupe` crops of figures 720 and 780
  pixels tall, not measured:

  | Mark | Starting value |
  | --- | --- |
  | contour peak width | clamp(height / 260, 1.5 px, 4 px) × (0.35 + shade): about 3.7 px on the shade side of a 720 px figure |
  | contour overlap and lift | 3 samples past each landmark; lifted where the shade is under 0.15 |
  | modelling stroke | the height / 60 wide, about a twelfth of the contour long, a new one every third to half a stroke length |
  | strokes across a limb segment | one for each 1.5 stroke widths of its true length, a spacing of the height / 40: about 6 on a forearm and 10 on a shin of a 7.5-head adult; drawn closer toward each end of the segment, about a quarter of them left out, each at a seeded 0.3 to 1.3 of the stroke width, which `stop` scales on a mark it cuts short by the share of its seeded span it keeps, and a seeded opacity between 0.1 and 0.6, stopping where the surface under it passes a seeded 0.05 to 0.55 of full light (`stop: [0.05, 0.55]`), or up to 0.2 past that level where the section's brightest light is less than 0.2 above it |

  The shade of a contour sample is (1 − n · L) / 2, with n the edge's outward
  unit normal there and L a unit vector toward the light: 0 where the edge
  faces the light, 1 where it faces away. The first sample below computes it.

  Below about 100 px tall the modelling strokes go: the figure reads by its
  silhouette and contour. That limit follows the posture row of that
  section's table and was not checked on a crop.
- **It moves by blending key poses.** Every key of one form has the same
  outline points: the same count, traced in the same order from the same
  landmarks. `keyOutline` from `artifex/core/geom.js` blends them point by
  point; parts turned about pivots hinge. A straight blend shortens a limb
  that turns by θ to cos(θ/2) of its length at the middle: 3% shorter at
  30°, 8% at 45° and 29% at 90°. A limb's turn between two keys kept to
  about 30°, or a breakdown, a further key outline between them
  ([plan poses](#plan-poses-before-motion)), hides it.
  With a depth armature, the joint angles or reach targets blend between
  keys and the outline is traced from the projection every frame: the limbs
  keep their length, so the cos(θ/2) loss applies only to blended outline
  points.
- **A held prop is one unit.** Placed rigidly from the blended hand's
  landmarks, moved and turned, with its points left unblended.
- **`keyFaults(KEYS, { ratio })` checks every blend's middle in a test.** It
  lists each outline that crosses itself and each span that stretches or
  shrinks past `ratio` between two keys.
- **Every joint at the middle of each blend, on a `--loupe` crop:** a line,
  a step or a notch in the fill at a joint is a seam, and a limb shorter than
  the mannequin's needs a breakdown outline.

```js
const { lerp } = require('artifex/core/num.js');
const { keys, ease } = require('artifex/core/time.js');
const { catmullRom, keyOutline } = require('artifex/core/geom.js');
const { poly, fill, outline } = require('artifex/core/path.js');
// Two key poses of one form: the same points, traced in the same order.
const KEY_A = [[0, 0], [12, -4], [30, 2], [34, 20], [18, 26], [4, 16]];
const KEY_B = [[0, 0], [14, -8], [28, -14], [38, 4], [20, 22], [4, 16]];
const move = keys([[0, 0, ease.inOut], [18, 1]]);
// In draw: 6 points * 8 samples = 48 points on the closed silhouette.
const edge = catmullRom(keyOutline([KEY_A, KEY_B], move(clock.frame)), 8, true);
g.fillStyle = BASE;
fill(g, edge);
g.save();
poly(g, edge, true);
g.clip();
// Modelling: short tapered strokes across a limb, from its shade edge inward,
// on an axis through the blended mannequin's joints (JOINTS). LIGHT is a unit
// vector toward the light; HALF is the limb's half-width, MARK the stroke width
// in piece units: height / 60 / filmScale(piece), with height in film pixels.
const taper = (size) => (u) => size * Math.pow(Math.sin(Math.PI * u), 0.7);
const axis = catmullRom(JOINTS, 6);
g.fillStyle = SHADE;
g.globalAlpha = 0.3;
for (let i = 1; i < axis.length; i += 2) {
  const [x, y] = axis[i], [px, py] = axis[i - 1];
  const len = Math.hypot(x - px, y - py) || 1;
  const tx = (x - px) / len, ty = (y - py) / len;   // along the limb
  const s = -ty * LIGHT[0] + tx * LIGHT[1] > 0 ? -1 : 1;   // flip the normal off the lit side
  const nx = -ty * s, ny = tx * s;   // across the limb, toward its shade side
  // 5 points from the shade edge to 0.3 of the half-width, bowed along the limb
  // the way the form turns: outline() reads the width at the points only.
  const mark = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const d = HALF * lerp(1, 0.3, t), bow = 0.25 * HALF * Math.sin(Math.PI * t);
    return [x + nx * d + tx * bow, y + ny * d + ty * bow];
  });
  fill(g, outline(mark, taper(MARK)));
}
g.globalAlpha = 1;
g.restore();
// Contour: one stroke per run between landmarks (indices into edge), run OVER
// samples past each end, lifted where the shade is under 0.15. PEAK is
// clamp(height / 260, 1.5, 4) film pixels / filmScale(piece), in piece units as
// outline() draws; each stroke peaks at PEAK * (0.35 + its mean shade).
const RUNS = [[0, 16], [16, 32], [32, 48]];
const OVER = 3;
const at = (i) => edge[(i + edge.length) % edge.length];
const shade = (i) => {   // (1 - n . LIGHT) / 2, n the outward normal of the clockwise edge
  const [ax, ay] = at(i - 1), [bx, by] = at(i + 1);
  const len = Math.hypot(bx - ax, by - ay) || 1;
  return (1 - ((by - ay) * LIGHT[0] - (bx - ax) * LIGHT[1]) / len) / 2;
};
g.fillStyle = INK;
for (const [a, b] of RUNS) {
  let run = [];
  const lay = () => {
    if (run.length > 2) {
      const mean = run.reduce((sum, i) => sum + shade(i), 0) / run.length;
      fill(g, outline(run.map(at), taper(PEAK * (0.35 + mean))));
    }
    run = [];
  };
  for (let i = a - OVER; i <= b + OVER; i++) {
    if (shade(i) < 0.15) lay(); else run.push(i);
  }
  lay();
}
```

With a depth armature, the next sample takes the place of the first sample's
strokes across a limb. It poses one limb in depth, measures how far its middle
joint leaves the line in a front view, and lays its cross-contours.

```js
const { reach, project } = require('artifex/core/armature.js');
const { fill, outline, crossContours } = require('artifex/core/path.js');
const { rng } = require('artifex/core/rand.js');
const R = rng(1);
// One leg of two segments from the hip to a planted ankle, in canvas units.
// The body faces -z, so the knee bends along [0, 0, -1]; an elbow takes [0, 0, 1].
const ROOT = [400, 200, 0], END = [410, 440, 0];
const LENGTHS = [130, 120];
const RADII = [[22, 15], [15, 9]];
const PITCH = 0.15;   // a view a little above eye level opens the sections
const FOCAL = 800;
const VIEW = { view: [0, Math.sin(PITCH), Math.cos(PITCH)], centre: [400, 300, 0], focal: FOCAL };
// The eye looks at `centre`'s picture point: this pitch keeps x and scales y by cos(PITCH).
const EYE = { at: [400, 300 * Math.cos(PITCH)], focal: FOCAL };
const { joint, end } = reach(ROOT, END, LENGTHS, [0, 0, -1]);
const { segments } = project([
  { start: ROOT, end: joint, radius: RADII[0] },
  { start: joint, end, radius: RADII[1] },
], VIEW);
// Front-view line check: the middle joint's distance from the line between
// the two ends, over their span, stays within 0.05.
const [a, m, b] = [segments[0].a, segments[0].b, segments[1].b];
const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
const off = Math.abs((b[0] - a[0]) * (m[1] - a[1]) - (b[1] - a[1]) * (m[0] - a[0])) / (span * span);
if (off > 0.05) throw new Error(`the middle joint leaves the line by ${off.toFixed(3)} of the span`);
// Cross-contours on each segment, far segments first, one name per segment.
const LIGHT = [-0.55, -0.83];   // a picture vector toward the light
const WIDTH = 10;               // a figure about 600 tall: its height / 60
// A fixed `at` list per segment from its true length, seeded once, so the
// count does not change as the segment foreshortens: 9 and 8 marks here.
const AT = LENGTHS.map((length, i) => {
  const n = Math.max(1, Math.round(length / (1.5 * WIDTH)));
  return Array.from({ length: n }, (_, k) => (k + 0.2 + 0.6 * R(`limb ${i}`, 'at', k)) / n);
});
const marks = segments
  .map((seg, i) => ({ seg, i, depth: seg.depth[0] + seg.depth[1] }))
  .sort((p, q) => q.depth - p.depth)
  .flatMap(({ seg, i }) => crossContours(seg, R, `limb ${i}`, { light: LIGHT, at: AT[i], width: WIDTH, eye: EYE }));
// In draw, inside the silhouette's clip, in the shade colour at a low alpha:
for (const mark of marks) fill(g, outline(mark.points, mark.width));
```

#### Proportions in heads

A figure's height counts in heads, its own head's height from crown to chin,
and its landmarks sit in that unit. The count says age and kind before
anything moves.

| Heads tall | Reads as |
| --- | --- |
| 2 to 3 | a toy-like, super-deformed figure: the face does almost all the acting |
| 4 to 5 | a small child, or a cartoon figure |
| 6 to 7 | a teenager, or a stylised adult |
| 7.5 | a realistic adult |
| 8 to 9 | a heroic or elegant figure, with a small face |

- **Landmarks of an adult at 7.5 heads.** The chin is at 1 head from the top,
  the navel at about 3 and the elbows a little above it, at about 2.8, and the
  hip joints and the wrists of hanging arms at about 4, half the height. The
  knees fall a little above halfway: about 0.43-0.45 of the way from the hip
  joints to the soles. The shoulders are about 1.6-1.7 heads wide, their line
  a third of a head under the chin; wider is heroic stylisation. The eyes sit
  halfway down the head. Segment lengths, joint ranges and couplings are in
  [landmarks, lengths and joints](#landmarks-lengths-and-joints).
- **A style moves the count, not the order of the landmarks.** Fewer heads make
  the head and the eyes larger and the limbs shorter. More heads lengthen the
  legs first. Eyes set lower than halfway
  down the head read younger.
- **A body that is not a person counts in its own unit.** Its head, or its
  largest part, with the same kinds of landmark: where each limb joins, where
  it bends, and where it meets the ground.
- **The numbers are state.** The head count and the landmarks written once in
  `build`, with every shot and every pose drawn from them, keep the figure
  one build across the film.

These landmarks place the whole figure's outline. The numbers are starting
values from drawing books, not measured on films. Each one moves contour
points or the ends of strokes, not a block.

| Rule | Holds for | Kind | What it drives in the outline |
| --- | --- | --- | --- |
| On an adult of about 6 to 8 heads, the crotch sits about 3.8-4.1 heads below the crown. | Human; a humanoid takes it | Anatomy | The two inner leg strokes start at the crotch landmark. Below about 6 heads the count no longer holds; the order of the landmarks does, as in a style. |
| The fingertips of hanging arms reach about half a head below the crotch. | Human | Anatomy | The hand's tip landmark, where the outer arm stroke turns round the hand. It sets how far down the gap beside the waist runs ([silhouette](#silhouette-and-line-of-action)). |
| The shoulder line sits a third of a head under the chin and is 1.6-1.7 heads wide; a heroic 8-head figure is about 2.5 heads wide. | Human | Anatomy; the heroic width is stylisation | The shoulder landmarks, where the neck stroke ends and the outer arm stroke starts. |
| The neck pit is the notch at the front of the neck's base, midway between the shoulders, where the collarbones meet. | Any biped with a neck | Anatomy | The neck-pit landmark, where the front neck strokes end and the trunk's centre line starts; the balance and stretch checks measure from it. |
| The trunk's widths are ratios of the shoulder width. | Any biped | Anatomy | The chest, waist and hip contour points sit at shares of the shoulders' span, so a wider frame widens them together, as the frame row of [landmarks, lengths and joints](#landmarks-lengths-and-joints) sets them. |
| Weight is girth, not length. | Any biped | Anatomy | A heavier body moves its contour points outward between the same landmarks. The landmarks keep their heights, and the strokes keep their ends. |
| Sitting and kneeling lower the crown: on a chair to about 0.75 of standing height; on the floor, knees up and upright, to about 3.5-3.9 heads, half a head lower hunched and a head lower curled; kneeling to about 0.7 of standing height. A straight sitter keeps the standing trunk: crown to seat as crown to crotch. | Human; a humanoid with human leg ratios | Anatomy | The crown landmark's height in the key, and the trunk's contour strokes, which keep their standing length on a straight sitter and shorten along the bend on a hunched one. |

#### Landmarks, lengths and joints

These numbers are the hidden mannequin's state and the keys that move it; they
drive the painted outline and the strokes that draw it
([paint over a hidden mannequin](#paint-over-a-hidden-mannequin)). They are
not the sizes of separate blocks; a [hinged figure](#hinged-figures) uses
them as its pivots.

| Rule | Holds for | Kind | What it drives in the outline |
| --- | --- | --- | --- |
| The mannequin is a chest egg, one to three waist balls and a pelvis ball, with a ball at each joint. | Any biped; the joint sizes in head widths, human only | Anatomy | Each ball sets the outline's width where it sits. A head width is about 0.75 of a head's height; a joint ball is about 0.5 head widths across at the shoulder and the knee, 0.4 at the elbow, and 0.3 at the wrist and the ankle. The trunk's widths, the waist among them, come from the shoulder width in heads ([proportions in heads](#proportions-in-heads)) and the frame ratios in the last row. The trunk contour swells over the chest egg and the pelvis ball and narrows over the waist balls. |
| Place the landmarks first, then hang each mass between two of them. | Any biped | Anatomy | Every contour stroke starts and ends at a landmark: a joint, a tip, or a bony point such as the elbow point or an ankle knob. A key pose moves the landmarks; the outline follows them. |
| The upper arm is about 1.5 heads, the forearm about 0.8 of it, and the hand about 0.75 of the forearm. | Human; a humanoid takes the ratios unless its design sets its own | Anatomy; shorter or equal segments are stylisation | With the shoulder top about 1.3 heads below the crown, a hanging arm puts the elbow near 2.8 heads and the wrist near 4. The outer arm stroke ends at the elbow point, and the forearm stroke starts there. |
| The knee sits 0.43-0.45 of the way down from the hip joint to the sole. The thigh pivots inside the pelvis, level with the pubis. | The share, human only; the pivot, any biped | Anatomy | The thigh and shin strokes overlap at the knee landmark. The hip joint is a hidden pivot, not a ball on the outline: the outer hip swells there and moves with the thigh. |
| The shoulder girdle lifts little below about 40° of arm raise, then rises to about chin level with the arm overhead. The shoulder blades slide forward on a reach and back on a draw. | Any biped with a shoulder blade | Anatomy | The shoulder's contour stroke rises with its landmark only past 40°, and the neck stroke on that side shortens. When both arms reach forward, the shoulder landmarks move in and the front width narrows; on a draw they move back. |
| The forearm rolls about an axis from the outer elbow to the knob on the little-finger side of the wrist, up to about 80-90° each way from thumb-up. | Any biped with a hand that turns | Anatomy | The elbow point and the wrist knob stay still. The thumb-side contour changes, spread along the forearm, not pinched at the wrist, and the hand turns toward edge-on. |
| The trunk bends along its length: sideways at most about 30° between chest and pelvis, forward mainly at the hip. | Any biped; the 30° limit, human only | Anatomy | A side bend turns the chest, waist and pelvis landmarks a share each, so one side contour bunches and the other stretches as one curve. A forward bend tilts the pelvis at the hip joints, keeps the trunk near straight and moves the hips back over the feet. |
| The head pivots under the skull, behind the ear. The jaw hinges in front of the ear. | The pivot, any biped; the jaw hinge, human only | Anatomy | The pivot builds each key outline: a nod or a tilt key has its head landmarks turned about the hidden pivot, so the face swings while the neck keeps its join. An open-jaw key moves only the chin and lower-face landmarks about the hinge; the back of the skull stays. The keys are then blended point by point. |
| In profile, the thigh bulges in front and the calf and heel behind. The shin's front runs straight, and the lower leg's mass sits behind the shin bone. | Any biped | Anatomy | The thigh's front stroke swells, peaking about a third of the way down; its back runs flatter. The shin's front is one straight stroke from knee to ankle. The calf stroke swells high, tapers, and swells a little again above the ankle. |
| The ankle stands over the back fifth of the foot. The outer ankle knob is lower than the inner one. The toes hinge at about 0.72 of the foot's length from the heel. | Any biped | Anatomy | In profile the heel juts behind the ankle, which sits about 0.25 of the foot's length above the sole. The toe stroke bends at the hinge: a heel-rise key has the heel and instep landmarks turned about it while the toes stay flat, and the keys are blended point by point. In front view the outer knob sits lower. |
| A man's shoulders are about 1.25-1.5 times his hips; a woman's are about 1.0-1.1 times hers, with a waist about 0.7 of her hips. | Human only | Anatomy; a narrower waist or wider shoulders than these is stylisation | Only the trunk's widths change: the shoulder landmarks, the waist and the hip contour points. The lengths, the joints and the masses stay the same. |

- **A style moves the lengths, not the couplings.** It keeps the order of the
  landmarks ([proportions in heads](#proportions-in-heads)) and every coupling
  in the table.
- **A body that is not human keeps the any-biped rows**, measured in its own
  unit.
- **Each row shows on the poses.** A front and a profile key, and a `--loupe`
  crop at the middle of each blend, show a raised shoulder rising only past
  40°, the elbow point holding still through a forearm roll, and the heel
  jutting behind the ankle.

#### A trunk that bends, and a pose table

A trunk turned as one rigid piece about the pelvis reads as a post, whatever
is painted on it: a sitter stays bolt upright, a reach is a pole, a crouch
stays half standing. The bend is spread along the spine, and a pose is one row
of numbers. Both were judged on one practice set of seven poses beside photo
frames, at 750 px, not measured.

- **The pelvis turns at the hip joints; the chest turns against the pelvis.**
  Two turns of the pelvis: `tilt`, forward about the line through the hip
  joints, and `hipRoll`, one hip up. Three of the chest against it: `lean`
  forward, `roll` sideways and `twist`. This keeps the row of
  [landmarks, lengths and joints](#landmarks-lengths-and-joints): a forward
  bend is mostly `tilt`, and `roll` stays within about 30°.
- **The chest's turn is shared by pivots down the spine.** Two to four
  pivots between the low ribs and the pelvis, a little behind the body's
  middle, each taking an equal share. A point above a pivot turns about it;
  the top pivot goes first, so each lower one carries the turns above it. A
  mass whose two ends lie on either side of a pivot bends with it, so the
  side contour bunches on one side and stretches on the other as one curve.
- **Everything on the trunk goes through the same function**: masses,
  shoulder joints, the neck's pivot, the inner landmarks. The hip joints take
  the pelvis's turn only. A shoulder placed from the unbent trunk leaves its
  arm behind.
- **A pose is one row of a table**, state in `build`, and a film blends rows:

  | Field | Sets |
  | --- | --- |
  | `pelvis` | The pelvis's move from standing: sideways over the carrying foot, down for a sit or a crouch, back as the trunk comes forward. |
  | `tilt`, `hipRoll` | The pelvis's turn at the hip joints. |
  | `lean`, `roll`, `twist` | The chest against the pelvis, shared down the spine. |
  | `head` | Nod, turn and tilt about the head's pivot under the skull. |
  | each wrist | A target for `reach`, from its shoulder or in the figure's frame, with the elbow's bend direction and the way the palm faces. |
  | each ankle | A target for `reach` in the figure's frame, with the toes' direction, and the knee's bend direction when the pose spreads it. |

  The limbs are solved after the trunk, from its bent shoulders and hips to
  the row's targets, so a planted foot or a hand on a support stays where the
  row puts it while the trunk moves.
- **What it shows.** On the `--armature` overlay of a bent key, the chest,
  waist and pelvis centres do not lie on one straight line. A sitter's spine
  is a C and the head stands in front of the hips. A reach overhead bends the
  trunk toward the free side, bends the raised elbow and puts the weight on
  one leg. A crouch brings the chest down between knees that spread.

```js
const { reach } = require('artifex/core/armature.js');
// The figure's own frame, in heads: x to its right, y down from the crown,
// facing -z. Scale and place the results for the shot before `project`.
const DEG = Math.PI / 180;
const add = (p, q) => [p[0] + q[0], p[1] + q[1], p[2] + q[2]];
const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const rotX = (p, a) => [p[0], p[1] * Math.cos(a) - p[2] * Math.sin(a), p[1] * Math.sin(a) + p[2] * Math.cos(a)];
const rotZ = (p, a) => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a), p[2]];
const rotY = (p, a) => [p[0] * Math.cos(a) + p[2] * Math.sin(a), p[1], -p[0] * Math.sin(a) + p[2] * Math.cos(a)];
// Three pivots down the spine, top first, and the hip joints' axis.
const SPINE = [[0, 2.5, 0.1], [0, 3.05, 0.1], [0, 3.5, 0.1]];
const HIPS = [0, 3.95, 0];
// One row of the pose table: a slumped sit. Angles in degrees.
const SIT = {
  pelvis: [0, 1.5, 0.15], tilt: -12, hipRoll: 0, lean: 48, roll: 0, twist: -6, head: [14, 10, 0],
  wrists: [{ at: [0.55, 5.35, -1.25], bend: [0.4, 0.2, 1] }, { at: [-0.5, 5.3, -0.95], bend: [-0.4, 0.2, 1] }],
  ankles: [{ at: [0.42, 7.3, -1.5] }, { at: [-0.5, 7.3, -1.15] }],
};
// A point of the trunk, given standing, in pose P.
function trunkPoint(h, P) {
  let q = h;
  const k = DEG / SPINE.length;
  for (const pivot of SPINE) {
    if (h[1] >= pivot[1]) continue;   // below this pivot: it does not turn the point
    q = add(pivot, rotY(rotZ(rotX(sub(q, pivot), P.lean * k), P.roll * k), P.twist * k));
  }
  return add(add(HIPS, rotZ(rotX(sub(q, HIPS), P.tilt * DEG), P.hipRoll * DEG)), P.pelvis);
}
// The limbs reach from the bent trunk to the row's targets.
const shoulder = trunkPoint([0.62, 1.5, 0.02], SIT);
const hip = trunkPoint([0.32, 3.95, 0], SIT);
const arm = reach(shoulder, SIT.wrists[0].at, [1.45, 1.2], SIT.wrists[0].bend);
const leg = reach(hip, SIT.ankles[0].at, [1.65, 1.75], [0, 0, -1]);
// The spine is a C: the neck's base stands in front of the hips.
const neck = trunkPoint([0, 1.45, 0.05], SIT);
if (!(neck[2] < hip[2] - 0.5)) throw new Error('the trunk did not come forward');
if (!arm.reached || !leg.reached) throw new Error('a limb cannot reach its target');
```

#### Starting masses, front and side

A mannequin of one tube per part paints a jointed doll. A body reads when its
masses have a width and a depth of their own, and when the forms inside the
outline are marked. The sizes below are a starting set for a 7.5-head adult
whose shoulders are 1.3 times its hips, in heads, judged on the same practice
set, not measured; another frame, age or kind moves the numbers and keeps the
list.

| Mass | Heads below the crown | Half-width, front view | Depth, side view | In the light |
| --- | --- | --- | --- | --- |
| Skull | 0.43 | 0.41 | 0.41, its centre 0.07 behind the neck | Broad |
| Neck | 0.82 to 1.42 | 0.17 to 0.2 | the same | Broad |
| Shoulder cap | 1.5, its centre 0.62 out | reaches 0.82 | 0.2 | Detail |
| Chest | 1.88 | 0.68 | 0.4 in front, 0.44 behind | Broad |
| Chest front, each side | 1.98, 0.27 out | inside the chest | reaches 0.48 in front | Detail |
| Shoulder blade, each side | 1.95, 0.3 out | inside the chest | reaches 0.46 behind | Detail |
| Low ribs | 2.45 | 0.56 | 0.36 | Broad |
| Belly | 2.4 to 3.3 | 0.3 | reaches 0.36 in front | Detail |
| Waist | 3.05 | 0.48 | 0.3 | Broad |
| Pelvis | 3.65 | 0.63 | 0.36 | Broad |
| Buttock, each side | 3.84, 0.24 out | inside the pelvis | reaches 0.45 behind | Detail |
| Upper arm | from the shoulder, 1.45 long | 0.21 to 0.155 | a fuller mass in front of the bone, 0.17 to 0.13 over its middle 0.3 to 0.7, and a flatter one behind, 0.165 to 0.12 over 0.2 to 0.6, each set about 0.05 off the axis | Broad |
| Forearm | 1.2 long | 0.17 to 0.085, fullest in its upper half | the same | Broad |
| Thigh | from 3.95, 0.32 out, 1.65 long | 0.3 to 0.2 | fuller in front; behind, a mass of 0.25 to 0.16 over its upper 0.2 to 0.7 | Broad |
| Kneecap | at the knee | 0.14 | stands 0.1 proud, on the side the knee bends to | Detail |
| Shin and calf | 1.75 long | 0.185 to 0.09 | the calf 0.215, set 0.1 behind the shin over its upper half | Broad |

- **Broad masses take the light; detail masses shape the outline and the
  depth only**, as [a broad form](#paint-over-a-hidden-mannequin) says.
- **A limb is not a tube.** One tapered rod per segment paints a pipe however
  it is shaded. The masses along a limb sit off its axis and stop short of
  its joints, so the two contours differ and the joint stays lean: full in
  front of the upper arm and flatter behind it, full behind the thigh high
  up, full behind the shin in its upper half. Each limb ends at about half
  the width it starts with. These masses take the light, unlike the trunk's
  detail masses: a limb is narrow enough that their turn is its modelling.
- **Small forms blend over a short distance.** Masses joined by a smooth
  union lose any form smaller than the blend: 0.18 of a head suits a trunk and
  swallows a nose or a thumb. Head, hand and foot forms blend over about 0.05
  to 0.07 of a head.
- **Inner landmarks are strokes laid from the mannequin.** Each is two to four
  points given on the standing figure, moved with the part they sit on
  ([the trunk's function](#a-trunk-that-bends-and-a-pose-table) for those on
  the trunk), projected, and drawn as one tapered stroke in the shade colour,
  clipped to the visible region of its part. Each carries the way its surface
  faces and shows only while that side turns to the viewer, fading in as it
  turns: a back view without them has nothing to read. Widths between the
  figure's height / 330 and / 150; opacity 0.25 to 0.55, the navel, the spine
  and the buttock fold darkest.

  | Landmark | Runs, in heads below the crown and out from the middle | Faces | Shows |
  | --- | --- | --- | --- |
  | Collarbone, each side | from the neck pit, 0.05 out at 1.52, to the shoulder, 0.56 out at 1.45 | Front | Always |
  | Breastbone and centre line | 1.62 to 2.4, then fainter to the navel | Front | Always |
  | Under the chest, each side | a shallow arc from 0.06 out at 2.3, lowest at 2.36, to 0.5 out at 2.2 | Front | Always |
  | Navel | a short upright dab at 3.0 to 3.12 | Front | Always |
  | Hip to groin, each side | from 0.42 out at 3.42 to 0.14 out at 3.98 | Front | Always |
  | Spine | 1.45 to 3.45, deepest behind the low ribs | Back | Always |
  | Shoulder blade's edge, each side | from 0.12 out at 1.72 down to 2.15, then out to 0.42 at 2.3 | Back | Always |
  | Fold under the buttock, each side | from 0.06 out at 4.17, lowest at 4.23, to 0.5 out at 4.13 | Back | While the hip is within about 15° of straight ([build from volumes](#build-from-volumes)) |
  | Kneecap's lower edge | an arc 0.24 wide, 0.1 below the joint | The side the knee bends to | Always |

- **The widths are checked against the frame, in `build`.** The masses are
  typed by hand, and the hips drift wider than the chest without anyone
  deciding it. A front-view half-width at a height is the largest reach of
  any mass there; the frame's ratios
  ([landmarks, lengths and joints](#landmarks-lengths-and-joints)) are
  ranges it must fall in.

```js
// Front-view balls of a mannequin, both sides alike: [centre out from the
// middle, heads below the crown, radius]. The frame is the figure's own.
const BALLS = [[0.62, 1.5, 0.2], [0.26, 1.88, 0.42], [0.2, 2.45, 0.36], [0.18, 3.05, 0.3], [0.27, 3.65, 0.36], [0.32, 3.95, 0.3]];
const FRAME = { shouldersOverHips: [1.25, 1.5], waistOverHips: [0.65, 0.85] };
const halfWidth = (y) => Math.max(0, ...BALLS.map(([x, cy, r]) => (Math.abs(y - cy) < r ? x + Math.sqrt(r * r - (y - cy) ** 2) : 0)));
const shoulders = halfWidth(1.5), waist = halfWidth(3.05), hips = Math.max(halfWidth(3.65), halfWidth(3.95));
for (const [name, value, [low, high]] of [
  ['shoulders over hips', shoulders / hips, FRAME.shouldersOverHips],
  ['waist over hips', waist / hips, FRAME.waistOverHips],
]) {
  if (value < low || value > high) throw new Error(`${name} is ${value.toFixed(2)}, outside ${low} to ${high}`);
}
```

#### Silhouette and line of action

- **The silhouette reads on its own.** The flat fill is the painted
  silhouette: the fill and contour strokes of each form
  ([paint over a hidden mannequin](#paint-over-a-hidden-mannequin)), not the
  mannequin and not separate blocks, in one colour on a plain ground. On it
  a viewer still sees what the figure does and which way it faces: space
  between the arms and the body, the acting hand or the profile turned
  against the ground, and the silhouette apart from other shapes. A pose
  that reads only through its inner lines needs a new pose. The strip's
  [`--figure`](../../../docs/knowledge/command-line-tools.md#figure-silhouettes)
  draws the fill under each key and measures it, at film size with
  `--scale` set to `filmScale(piece)`, such as, for a piece 960 units wide,
  `npm --prefix "<library root>" run seeds -- "./my-piece.cjs" --at 0,1,2 --scale 2 --figure body=#b07a5a+#2a2320 --png`.
  Every rule below changes the painted outline and its strokes; the last
  column names the `--figure` field that shows it. The numbers are starting
  values from drawing books, not measured on films. A robot or a humanoid
  that breaks a human-only row does so on purpose, by its design.

  | Rule | Holds for | Kind | What it changes in the outline and strokes | What the flat fill shows |
  | --- | --- | --- | --- | --- |
  | A lens of ground lies between each hanging arm and the waist. | Any biped with arms | Staging | The inner arm stroke and the waist stroke curve apart between the armpit and the hand. | An open gap beside the trunk with `widest` at least 4 film pixels, the limb thickness of [the smallest figure](#the-smallest-figure-that-still-acts). |
  | The arm gap starts about 0.3 shoulder widths under the shoulder line. | Human; a humanoid takes it | Anatomy | The inner arm stroke leaves the trunk's contour at the armpit landmark, that far down. | The top `y` of that gap. |
  | Folded arms keep the elbows outside the trunk. | Any biped with arms | Staging | The elbow's corner stands out past the trunk's side contour. | The view shows each elbow's corner past the side edge. `widths` span the arms with the trunk, so they cannot show it: look at the view. |
  | A hand on the hip closes a triangle. | Any biped with arms | Staging | The forearm stroke ends over the hip contour, so the upper arm, the forearm and the waist enclose ground. | One closed gap beside the waist. |
  | In profile, an arm that reads swings clear of the trunk's depth. | Any biped with arms | Staging | The arm's contour leaves the trunk's front or back contour. | A gap in front of or behind the trunk. |
  | Raised arms bend to frame the head. | Any biped with arms | Staging | The elbows turn outward, so each arm and the side of the head enclose ground. | A gap, closed or open, on each side of the head. |
  | Turn a bend 30-45° off the camera. | Any biped | Staging | The bend shows as one side contour shortening against the other; a bend straight at the camera hides inside the outline. | The bent key's view differs from the upright key's in its outline, not only in `box`. |
  | A change of posture shows in profile or a back three-quarter view. | Any biped | Staging | The spine's curve becomes the back contour. | The back edge of the view curves with the posture. |
  | A twist shows in the trunk's widths, since centre lines vanish in a fill. | Any biped | Staging | The shoulder and hip contour points narrow or widen against each other. | `runs` at the shoulder and hip rows, compared between the two keys at the same height. `widthStep` reads `widths`, which span the arms, so an arm swinging out raises it too. |
  | A front silhouette hides which limb is nearer, so an overlap chain or an open ellipse says it. A limb that comes toward the camera reads by its overlaps better than by its shortened length. | Any biped | Staging | The near limb's contour runs unbroken over the far one, and each far contour stops on it in a T: a hand over its forearm, the forearm over the upper arm, the upper arm over the trunk. Or a cross-contour opens as an ellipse. | Nothing: the painted cell shows it. |
  | The side contour runs convex over the ribcage, from the armpit to the waist. | Human; a humanoid takes it | Anatomy | One swelling side stroke from the armpit landmark to the waist landmark. | The view's side edge swells from the armpit to the waist. On rows where ground parts the arms from the trunk, `runs` read the trunk alone: the runs at the chest exceed those at the waist. `widths` span the arms too. |
  | On a side lean, the stretched side is one long contour stroke and the compressed side is notched. | Any biped | Anatomy | The compressed side's contour points bunch together, with the crease of [build from volumes](#build-from-volumes). | A notch on the compressed side, which can show as a small open gap. |

  The flat fill shows on the strip, not in the film.
- **The body bends along one line of action**, the
  [gesture line](#gesture-and-mood): one C or S curve through the whole
  figure; straight only for a stiff, forceful or mechanical beat. The bend
  shows on both sides of the silhouette: the stretched, convex side runs long
  ([paint over a hidden mannequin](#paint-over-a-hidden-mannequin)), and the
  concave side bunches and carries the crease of
  [build from volumes](#build-from-volumes), which grows with the bend and is
  absent while the line runs straight.
- **The weight balances.** A standing figure holds its mass above the foot or
  feet that carry it, or it reads as falling. The shoulders tilt against the
  hips, so the hip over the carrying leg rises and the shoulder above it
  drops, and the chest turns a little against the pelvis. A carried or pushed
  load joins that mass: the body leans away from it until the shared centre
  of body and load, each point weighted by its mass, lies between the
  carrying feet again.
  A load held out in front leans the trunk back; a load on one side tilts it
  to the other. A light load changes nothing, and a pose that leans for one
  reads as a mime of weight. A figure that sits or lies rests its soft masses
  on the support, and they flatten along it
  ([build from volumes](#build-from-volumes)); a seated body with no
  flattening reads as hovering. `plumb.over` from `--figure` is `true` on a
  standing key that balances.

  Balance and attitude move the hidden mannequin's landmarks, and the painted
  outline and its strokes follow them; no rule turns a part about a pivot. The
  numbers are starting values from drawing books, not measured on films. Where
  the flat fill cannot show a rule, the last column names the mannequin state
  or the painted cell.

  | Rule | Holds for | Kind | What it changes in the outline and strokes | How to check |
  | --- | --- | --- | --- | --- |
  | Upright, the ear, the shoulder joint and the hip joint stand on one vertical. Attitude is how far the shoulder leaves that line: forward reads as a slump or eagerness, back as pride. | Human; a humanoid takes it | Anatomy | On a profile key the head, shoulder and hip landmarks share one x, and the back and front contour strokes hang from them. | The mannequin state: on an upright profile key the three x values lie within about 0.1 head. The fill cannot show it. |
  | The neck pit stands over the carrying foot. The centre of mass, at about navel height, falls inside the span of every support: feet, hands, knees or seat. A resting stance puts about four fifths of the weight on the carrying leg. | Any biped | Anatomy | The carrying leg's contour runs nearly straight under the neck-pit landmark; the free leg's strokes bend at the knee and its foot rests lightly. | `plumb.over` is `true` on every standing key. With both feet down, the span of `plumb` covers both feet, and `plumb.x` is the centre of the fill, not the neck pit: the mannequin state shows whether the neck pit's x lies inside the carrying foot's span. |
  | A standing S-curve tilts the hips about 10° and the shoulders about 5° the other way. A back bend pushes the pelvis forward, under the weight of the chest. | Any biped | Anatomy | The hip and shoulder contour points tilt by those angles, and the side contours between them run as one S. On a back bend the belly contour moves forward and the chest's back contour moves back over the feet. | The angles of the hip and shoulder lines in the mannequin state, and the view. |
  | The shoulder rises with its arm, and the chest and armpit lines stay parallel to the shoulder line. | Human; a humanoid takes it | Anatomy | The chest and armpit contour points turn with the shoulder landmark, once the girdle lifts ([landmarks, lengths and joints](#landmarks-lengths-and-joints)). | The painted cell, on a `--loupe` crop of the raised key. |
  | A trunk keeps a centre line and a side line as hidden data, like the mannequin. | Any biped | Anatomy | Seam strokes and the edge of the first shade are placed from those two lines, so they turn as the trunk turns. | The painted cell: both lines vanish in a fill, as the twist row above says. |
  | Loads come in grades. A light load changes nothing; a medium one drops the shoulders; a heavy one also hunches the trunk and widens the stance to about 1.5 times. A load on one side leans the trunk 5-10° and the head 10-15° away from it. | Any biped | Anatomy | A medium load lowers the shoulder landmarks; a heavy one also lowers the crown and moves the ankle landmarks further apart. The side contours follow the leaning trunk, and the loaded arm hangs straight. | A medium load keeps the crown and the stance, so `box` and `plumb` cannot see it: the mannequin state shows the shoulder landmarks' y lower than on the unloaded key. For a heavy load, `box` height and the span of `plumb` also differ across keys of the same figure. A load painted in its own colours is outside the fill and `plumb.x`, so the shared centre of body and load is in the mannequin state. |
  | Posture drops about half a head from upright to hunched. | Human; a humanoid takes it | Anatomy | The crown landmark sits half a head lower and the back contour runs as one convex curve. In front view the hunch shows only as a shorter trunk, so it is staged in profile, as the posture row above says. | `box` height against the upright key: about a fifteenth of the upright height lower on a 7.5-head figure. This matches the floor-sit row of [proportions in heads](#proportions-in-heads). |
- **Both sides alike read as stiff.** Two arms or two legs in a mirrored pose
  are a diagram; each side with its own angle, height and bend is someone.

#### A face that acts

A face acts with four parts. On a person, an animal or a creature each one
needs more than a dot or a single line; an object may take fewer marks, as
little as two dots, as [a face on an object](faces.md#a-face-on-an-object)
says.

- **The brows** carry most of the feeling: raised, knitted, one up and one
  down.
- **The lids** say how open the eye is: alert, tired, doubting or soft. An eye
  needs at least an upper lid line over its white or its dark shape. A plain
  dot can say where the eye is, but not what it feels.
- **The gaze** says what the figure thinks about. The eyes move a few frames
  before the head turns, and a large head turn carries a blink.
- **The mouth** opens with the jaw, so the chin drops and the face stretches.
  The corners carry the feeling.

Brows, lids and mouth change together for one feeling, and the two sides of
the face differ a little. On a face turned three-quarters, the far eye is
narrower and the features follow the curved centre line of the face. How much
face an object gets, and where on it, is in
[a face on an object](faces.md#a-face-on-an-object).

#### Hands and feet

Hands and feet, or whatever a figure grips and stands with, act as much as the
face.

- **A hand is about as long as the face** from chin to hairline. Built first
  as a mitten: a palm about as long as the fingers, and a thumb set lower that
  turns against them. The fingers split when the size on screen allows.
  The fingers fan out and curve. A relaxed hand curls a little. A hand that
  holds something wraps around it, in front of it and behind it.
- **A hand states the action.** Open, closed, pointing, gripping or reaching:
  the hand's shape shows it in the silhouette.
- **A grip shows only the digits its view leaves visible.** A hand closed
  round something wraps it from two sides: the fingers over one face and the
  thumb round the opposite one. Round a bar seen from the fingers' side,
  four fingers lie pressed together across the near face and the thumb is
  usually behind the bar; seen from the back of the hand, the knuckles make
  a row and the fingertips are hidden. A thumb added on the side that hides
  it, so the hand looks complete, reads as a sixth digit.
- **Which side the thumb is on follows from the hand.** In the
  [depth armature's](../../../docs/apis/piece-api.md#depth-armature) frame,
  x to the right, y down and z away from the viewer, with the palm facing
  along N and the fingers pointing along F, a right hand's thumb is on the
  side F × N and a left hand's on N × F: a right hand held up with its palm
  to the viewer has its thumb toward the picture's right. The forearm's direction and the
  side the palm faces decide the grip, not the thing held. Written once as a
  comment beside the pose, such as "right hand, forearm from below, palm on
  the far side: thumb hidden", it stops the hand flipping between shots.
- **A hand is one skin.** Palm, fingers, thumb and the web between them are
  filled and inked as one outline in one colour, shaded through one clip; a
  darker piece is one really in shadow. Pieces filled apart show seams at
  the knuckles. The frames where a hand takes hold, holds and lets go are
  the ones to look at enlarged.
- **A foot is about one head long**, a wedge from the ankle to the toes. The
  ankle stands over the back fifth of the foot, and the toes hinge at about
  0.72 of its length from the heel
  ([landmarks, lengths and joints](#landmarks-lengths-and-joints)). A
  standing foot lies flat on what holds it, with a contact shadow
  ([everything stands on something](#what-every-scene-holds)). A leg that ends
  in a point reads as standing on nothing. A foot off the ground, in a jump,
  a fall or a body held up, hangs with its toes pointing down about 60 to 80
  degrees from level, and one knee folds more than the other: a relaxed
  ankle drops, feet held flat in the air read as standing on a floor that
  is not there, and two legs hanging alike move as
  [twins](#joints-that-break-in-succession).
- **A hand, a foot and a head are built, each in its own frame at the end of
  its limb.** One tapered rod for a hand is a spike with no thumb at 750 px;
  a rod for a foot is a bulb from the front; a ball for a head has no profile.
  Each takes a few forms placed from the mannequin, in heads. They are
  detail masses with a short blend
  ([starting masses](#starting-masses-front-and-side)). Starting values,
  judged on one practice set at 750 px, not measured:

  | Part | Its frame | Forms |
  | --- | --- | --- |
  | Hand, about 0.75 of a head | From the wrist: along the hand, across toward the thumb, out of the palm. The pose sets which way the palm faces; a hanging hand faces the body. | A flat palm: two rods side by side, from 0.03 to 0.36 along, 0.07 widening to 0.1 either side, radius 0.085 to 0.075. A finger mass: two rods from 0.36 to 0.56, then tips to 0.7 that curl 0.06 and 0.16 out of the palm, radius 0.068 to 0.045. A thumb set low on the palm's edge: from 0.06 along and 0.12 across, to 0.24 and 0.24, to 0.42 and 0.28, radius 0.075 to 0.042. |
  | Foot, about one head | Along the toes' direction and across, both from the ankle joint; heights are above the sole. The ankle joint stands 0.2 to 0.25 above the sole, over the back fifth. | A heel ball of radius 0.13, its centre 0.12 behind the ankle and 0.13 up, so it rests on the sole. An instep wedge: two rods from 0.02 along, 0.04 either side and 0.17 up, to 0.5 along, 0.11 either side and 0.09 up, radius 0.14 to 0.09, so the foot is high and narrow at the ankle and low and wide at the ball. A toe mass: two rods from 0.5 to 0.76 along, radius 0.085 to 0.06, which turns at the ball on a heel rise. |
  | Head, one head | From the head's pivot: down from the crown, out to each side, forward of the neck. | A skull ball of radius 0.41, 0.43 down and 0.07 behind. A face wedge in front of it, from 0.5 down and 0.17 forward, radius 0.24, to 0.76 down and 0.2 forward, radius 0.17. A brow bar at 0.39 down and 0.31 forward, 0.14 either side, radius 0.11. A nose from 0.46 down and 0.4 forward, radius 0.045, to its tip at 0.66 down and 0.53 forward, radius 0.07. A mouth mass of radius 0.1 at 0.76 down and 0.33 forward, and a chin of radius 0.1 at 0.9 down and 0.31 forward. A jaw rod on each side from its angle, 0.21 out at 0.76 down under the ear, to the chin. An ear 0.4 out, from 0.5 to 0.58 down. |

  In profile the head's contour then turns six times: at the brow, the nose
  bridge, the nose tip, the lips, the chin and the jaw's angle. From the front
  the foot shows an ankle narrower than the ball of the foot, and the hand a
  thumb that leaves the palm. The finger mass splits by strokes, not by
  solids: three short dark strokes along it, between the fingers, on the
  palm's side and on the back, each shown only while its side faces the
  viewer, as the [inner landmarks](#starting-masses-front-and-side) are;
  four separate rods fuse under the blend at this size. Hair is masses of another material that stop
  short of the ear: a wedge of skin left between two hair masses reads as a
  pointed ear. The features, which are marks and not masses, are laid in the
  face's frame as [faces](faces.md#build-the-face-in-head-units) says, on the
  face wedge and not on the skull ball, which sits behind it.

#### An object that acts

An object acts with what it already is. Its character is read off its shape,
its use, its history and its rules, and its face, its feet and its one way of
moving are found on it rather than added to it. A stock face pasted on a jug
and on a lock makes them one person in two costumes.

- **A trait comes from what the thing is and does.** Four questions give the
  traits: its [shape class](stills.md#shape-language), round, straight or
  sharp; its use, what it holds, pours, cuts, carries or stands on; its
  history, new, worn, chipped or mended; and its rules, how it is allowed to
  move, a game piece by its move, a letterform by its stroke order, a vessel by
  its lid and spout. Each trait becomes one feature, one posture, one tic or
  one way of moving: a round-bellied jug is slow and warm and breathes as a
  swell of its belly; a chipped brick stands square and does not flinch; a
  lock keeps its keyhole mouth shut under two rivet eyes; a worn tool leans on
  its handle. A trait the object does not have, such as a moustache on a brick,
  reads as a sticker on it.
- **Feet, hands and bends are where the object already has them.** What it
  stands on is its feet, a jug's base, a letterform's stems, a tool laid on
  its handle; what it grips with is its hand, the arms of a pair of tongs, a
  hook. The only part that bends is a part that bends on the real thing, a
  lid, a hinge, a cable, a blade on its pivot; the rest moves as one piece and
  never bends along its length. A
  one-piece thing is one painted silhouette keyed with `keyOutline` outlines
  of its own shape ([paint over a hidden mannequin](#paint-over-a-hidden-mannequin));
  a thing with a real joint is [hinged](#hinged-figures) there and nowhere
  else. The film's [one cast of body physics](#one-body-physics) is shared by
  every object in it, never a cast of its own. In a rubbery cast each object
  squashes and stretches whole, about its contact and keeping its volume
  ([a squash keeps the part's volume](#takes-and-accents)), and a stiff thing,
  such as a brick, takes a squash factor `s` nearer 1 than a soft one, such as
  a bag. In a skeletal cast nothing squashes.
- **One signature motion says what the thing can do.** Each object has one
  move taken from its use or its rule, so the viewer learns its reach from how
  it moves: a sliding thing slides with its speed lines, a jumping thing leaps
  on an arc, a stepping thing steps on its own stems, a thing that shuts
  snaps. Its path class follows its shape class, arcs for round, straight
  lines for straight, zigzags and snaps for sharp
  ([each beat has a path class](#gesture-and-mood)), and the fading-dot
  overlay there shows the path. The move is shown when the object is
  [met whole](#plan-the-film) and again at the turn, so the viewer knows the
  reach before the story tests it.
- **Idle life under a hold.** A [breath](#gesture-and-mood) sized to the
  object, a slow swell of a belly or a rise of a lid; seeded blinks; and a
  look that follows the action. Before each beat (`s.cues.beats`, the
  scaffold's `BEATS`, at each row's `frame`), every other object in frame
  turns its pupils toward the beat's `element`, at its mark in the shot's
  `BLOCKING` row or where its paint draws it, and the element looks where its
  own move goes: the turn starts about six frames before the
  beat at 24 fps and lands by two frames before it, and the pupils hold there
  until the next beat. The shot's `FOCUS` point is the target only where no
  beat or mark gives one. A face that answers turns as
  [a figure that listens](faces.md#eyes-and-brows-in-motion) says. In a drawn
  line, a boil re-seeded every three or four frames keeps a still thing
  alive, where a new wobble on every frame reads as noise; it sits under the
  film's one [finish](#film-finish). The frame middles of the frame before
  the turn starts, the frame it lands and the beat's frame, under `--loupe`,
  show every pupil turned on the landing frame and the body still until the
  beat.
- **A cast is one family.** The same marks, line weight and eye construction
  on every object, under one finish and one cast of body physics. What
  differs between members is their traits, their proportions, how much face
  each gets ([a face on an object](faces.md#a-face-on-an-object)) and the
  four [mood dials](#gesture-and-mood) of posture, tempo, amplitude and
  tremor; rank shows in size and ornament, a lid-knob on the larger jug, not
  in technique. A shot strip with the whole cast on one row shows the
  same eye construction and line weight on each; a member drawn in another
  technique reads as from another film, as
  [one opposition, each side with its own mark technique](#plan-the-film)
  says of a side's marks.

#### The smallest figure that still acts

These sizes follow from the proportions above, in pixels of the saved film at
its export scale (`filmScale(piece)` from `core/film.js`, a long edge of
1920). They were worked out, not measured on films, so each one is judged on
a 100% crop (`--loupe`).

| What must read | What it needs on screen | A 7-head figure at least |
| --- | --- | --- |
| where the figure is, and that it moves | any size | — |
| posture, gesture and hand shapes | limbs at least 4 px thick, so each shows two contours | about 100 px tall |
| the face's acting parts and separate fingers | eyes at least 6 px wide: a white, a dark centre and a lid | about 300 px tall |

A figure with larger eyes for its head, as in fewer heads, acts at a smaller
size. Below the second row, a figure is a mark in the landscape: it can travel
and be placed, but it cannot act. Small in a wide frame, it
[reads as alone](#camera-and-framing): a choice for a beat, not a default. A
beat that needs the face or the hands frames closer; a face shrunk to fit a
wide shot stops acting. In a wide shot the figure takes larger poses that
read in its silhouette.

**The height a figure has on screen** comes from the marks of a frame. This
Node script, which requires the library by its path where a piece writes
`artifex/core/`, with `isFigure` the piece's own test of the figure's marks,
such as its colours or line widths, gives it:

```js
const { loadExternal } = require('<library root>/tools/piece-input.js');
const { recordMarks } = require('<library root>/tools/contact-sheet.js');
const { drawFrame, playheads } = require('<library root>/core/render.js');
const { filmScale } = require('<library root>/core/film.js');
const { solve } = require('<library root>/core/piece.js');
const { piece } = loadExternal('./my-piece.cjs');
const solved = solve(piece, piece.seed);
function figureHeight(frame) {     // pixels in the saved film; 0 when nothing matches
  const draw = (g) => drawFrame(g, piece, solved, playheads(piece)[frame]);
  const marks = recordMarks(piece.size, draw).filter(isFigure);
  if (!marks.length) return 0;
  const top = Math.max(0, Math.min(...marks.map((m) => m.box[1])));
  const bottom = Math.min(piece.size.h, Math.max(...marks.map((m) => m.box[3])));
  return (bottom - top) * filmScale(piece);
}
```

Read on each shot's middle frame, it compares with the table. The result
is an upper bound, not the height itself: a mark's box includes the control
points of its `bezierCurveTo` and `quadraticCurveTo` curves, the points of its
`arcTo` calls, and half its stroke. An `arc` is boxed by the sweep it paints
and an `ellipse` by its sweep and rotation, so a short arc or a tilted ellipse
adds no empty corners. A brow, a lid, a flat foot or a contact shadow drawn
with curves can still add tens of units, so such marks left out of
`isFigure` tighten it, and a figure that only just clears a row has not
cleared it. A figure painted from a sprite or a static layer
still records as its own fills and strokes, as [paint
order](../../../docs/knowledge/command-line-tools.md#paint-order) explains.

### Hinged figures

A hinged figure is for a machine, a puppet, a cut-out, or a style that wants
its assembly to show. A person, an animal or a creature is
[painted over a hidden mannequin](#paint-over-a-hidden-mannequin) unless the
style asks for visible joints. Once each part is built as a volume
([figures that read](#figures-that-read)), the rig is a tree of rigid parts:
a cut-out character, a puppet, a crane or a desk lamp. Each part drawn in its
parent's frame, turned about its pivot, carries its children with it, so no
joint can drift apart:

```js
const { lerp } = require('artifex/core/num.js');
// Each part is painted with its pivot at 0,0; `pivot` places it in its parent's frame.
const FIGURE = { name: 'body', paint: body, kids: [
  { name: 'neck', pivot: [0, -33], turn: [-0.35, 0.35], paint: head, kids: [
    { name: 'hat', pivot: [0, -26], turn: [-0.3, 0.3], paint: hat }] },
  { name: 'shoulder', pivot: [14, -30], turn: [-2.4, 0.3], paint: arm, kids: [
    { name: 'wrist', pivot: [0, 36], turn: [-0.6, 0.6], paint: hand, kids: [
      { name: 'prop', pivot: [0, 4], turn: [-0.4, 0.4], paint: trumpet }] }] }] };
function drawPart(g, p, pose) {   // pose[name] in [0, 1] for every part with a pivot
  g.save();
  if (p.pivot) { g.translate(p.pivot[0], p.pivot[1]); g.rotate(lerp(p.turn[0], p.turn[1], pose[p.name])); }
  for (const k of p.kids || []) if (k.behind) drawPart(g, k, pose);
  p.paint(g);
  for (const k of p.kids || []) if (!k.behind) drawPart(g, k, pose);
  g.restore();
}
```

- **Every joint is a disc both parts cover.** The child painted round about
  its pivot, with the pivot inside the parent by that radius, is a disc
  turned about its centre: it covers itself, so no gap opens at any angle. A pivot on
  either part's edge, or a square end, opens a wedge as soon as it turns.
- **Hats and heads, hands and props share a joint.** The hat is the head's
  child and the prop the hand's, so they turn with it and cannot float off.
  In the rig above the neck part paints the head; a head that needs its own
  lean is a part of its own, as the neck's child. A face large enough to show
  its features follows [faces](faces.md).
- **Children paint over their parent** unless marked `behind: true`, as a far
  arm is. A part with a pivot and no `pose` value turns by `NaN`: the canvas
  ignores that turn and an SVG breaks, so every joint has its value.
- **`pose` comes from [authored time](../../../docs/apis/piece-api.md#authored-time)**:
  a `keys` track per joint in frames, `gait` for a walk or a run, `tween` for a
  single move, or `follow` for a part that hangs from a moving one.
- **`partFrames` gives each part's whole transform when the tree's order is
  not the depth order.** The rig above paints a child right before or after
  its parent. For a far arm behind the body and a near arm in front of a
  held thing, or a part that is a `sprite`, call
  `partFrames({ name, at, turn, scale, kids })` from `core/layer.js` once per
  frame: it returns each part's `[a, b, c, d, e, f]` by name. Draw the parts
  in any order under `g.transform(...m)`, or pass `m` as a sprite's `at`. A
  parent's squash reaches its children, so an attached part deforms with the
  thing it is attached to. `framePoint(m, [x, y])` is where a part's point
  lands on the frame: the place of a contact or of what a hand holds.
- **Every joint at 100%.** A [time strip](#look-at-a-film) with `--loupe` on
  the figure, each character with every joint at both ends of its `turn`,
  shows a gap as a sliver of ground at a joint.

### Poses and timing

These sections hold for painted figures
([paint over a hidden mannequin](#paint-over-a-hidden-mannequin)) and
[hinged figures](#hinged-figures) alike.

#### One body physics

One cast for every figure in the film, chosen once: rubbery (parts bend along
their length, squash and stretch, and hang on springs) or skeletal (rigid
parts that only turn about their joints and keep their size); a figure of the
other kind reads as from another film. A skeletal cast takes an impact in its
joints and in the view, not in a squash. In a skeletal film each part's
length stays the same on every frame, apart from a uniform scale the camera
applies to the whole view. A painted figure of either cast stretches in its
joint gaps ([takes and accents](#takes-and-accents)); a skeletal one keeps its
bones' lengths, so the check measures segments, not gaps, while a rubbery one
may also squash and stretch its parts.

#### Plan poses before motion

On a hinged figure a `keys` track drives a joint's turn. On a painted figure
each storytelling pose, extreme and breakdown is its own key outline, traced
with the same points, and the track counts through them: at value `v` it
blends outline `Math.floor(v)` into the next by the fraction `v % 1`.

First the storytelling poses, the ones a single
drawing of the scene would need. Then the extremes each move passes, such
as a foot's contact or a hand touching what it takes. Then the breakdowns
between them, and only then the spacing. `keys` holds all four on one line
per joint or per blend, in frames:

```js
const { keys, ease } = require('artifex/core/time.js');
const { keyOutline } = require('artifex/core/geom.js');
// An arm reaches: leaves the rest pose slowly, breaks down past the middle,
// cushions into the reach, holds it, then drops back.
const reach = keys([
  [0, 0, ease.in],        // rest; ease.in leaves slowly
  [10, 0.75, ease.out],   // breakdown, off the middle towards the reach
  [16, 1],                // the reach
  [28, 1, ease.inOut],    // the same value again: a hold
  [40, 0],
]);
pose.shoulder = reach(clock.frame);   // a hinged rig
// A painted figure: KEYS = [rest, breakdown, reach], one outline each, so its
// track runs 0, 1, 2 where the hinged one runs 0, 0.75, 1, and keyOutline
// blends the pair of outlines the value falls between.
const paint = keys([[0, 0, ease.in], [10, 1, ease.out], [16, 2], [28, 2, ease.inOut], [40, 0]]);
const edge = keyOutline(KEYS, paint(clock.frame));
```

- **The spacing in Artifex terms.** An animator easing *out of* a pose
  leaves it slowly: that is `ease.in` on the move away. Easing or cushioning
  *into* a pose arrives slowly: `ease.out`. Slow out and slow in is `ease.inOut`;
  a snap is a key with no rate, or a cut, two keys at one frame.
- **A chain of poses can flow.** Eased keys stop on every pose, which reads
  as a pose being shown; a run of poses meant as one gesture, such as an
  anticipation running into its action, reads as one move when it passes through them.
  `flow([[at, value], ...])` from `artifex/core/time.js` keeps the speed
  across each key, slowing where poses crowd, and never swings past them.
  Ease into the pose the move lands on and the poses that must register.
- **The breakdown makes the move.** An even middle between two extremes looks
  mechanical. Off-centre in value or time, lower or higher than the straight
  path, with parts on arcs, it reads as alive: a limb turns about its joint,
  so its tip travels a curve. On a painted figure a blend moves each point on a
  straight chord, so a value between two outlines changes only the spacing;
  a breakdown outline drawn on the arc puts the tip back on it. Most moves
  follow an arc or a figure eight; the other
  [path classes](#gesture-and-mood) are for beats that call for them.
- **A pose stays to be read.** An accent or a key pose held at least six
  frames at 24 fps registers; shorter holds only register in fast action. A
  dead stop looks frozen, so the hold drifts a little, as a
  [held pose breathes](#gesture-and-mood), and the parts arrive in it one
  after another, the trunk first and the head, the hands and anything loose
  a few frames later ([joints that break in succession](#joints-that-break-in-succession)):
  every part stopping on one frame reads as the film pausing. The commonest fault is too much
  movement in too little time: a move given twice the frames before the cut
  reads.
- **The count of drawings between two poses sets the mood.** The same two
  poses with none or one between them are a violent snap; with two to four,
  sharp and alert; with five to eight, casual; with nine or more, slow and
  heavy. Changing the mood of a move is changing that count, not redrawing
  the poses. Starting values from sprite animation, not measured on films.
- **Weight is in the hold before and the recovery after, not in the hit.**
  A heavy action is a long start, a very short action and a longer settle:
  one heavy swing in a shipped game runs about 150 ms of wind-up, 80 ms of
  swing, 170 ms held at the end and 75 ms back, which at 24 frames a second
  is about four frames, two, four and two. A hit reads heavy because its
  recovery is long. One drawing shown for a single frame is felt and not
  seen, which suits a smear or the frame of an impact and nothing that must
  be read.
- **Parts loop at different lengths.** A cycle in which every part repeats
  over the same number of drawings shows its seam: the whole pose comes back
  at once. With the step on one length, the arms on another and the loose
  parts on a third, none a multiple of another, such as 8, 12 and 20
  drawings, the whole figure repeats far less often than any part.
- **Impacts gain from a missing frame**: time each hit as
  [takes and accents](#takes-and-accents) says.
- **Step both or neither.** Motion held on pairs of frames, `2 * Math.floor(frame / 2)`,
  jitters against a camera that moves every frame.

#### Gesture and mood

What a figure feels shows less in which joints move than in the line its whole
body makes, how it carries itself, and how its moves are timed and travel.

- **Every pose bends from one gesture line.** Each pose has one curve that
  runs from the hips through the trunk and the head to the hand that leads,
  and each joint set so its part lies along that curve. Two numbers keyed
  for the figure, the line's lean at the hips and how far it turns along its
  length, give the angles of the trunk, the head and the leading limb. A
  trunk held upright reads as an arm moving on a post; bent from the line,
  the whole body reaches and curls.
- **Lean for holds, twist for action.** A held pose keys the line's lean; an
  action keys its turn. The keys of a hold differ in the trunk's lean in the
  mannequin state, and the keys of an action in `runs` at the shoulder and
  hip rows from [`--figure`](#silhouette-and-line-of-action), compared at
  the same height.
- **The head alone can change what a held body does.** Only the head
  landmarks keyed, the body's outline kept, the same stance waits, listens or
  refuses. Spread against compactness tells two figures' states apart: a
  figure wide for its height reads open, a narrow one closed. `box` width
  over height on each figure measures it.
- **A grip grades with the face.** A hand, or whatever grips, goes from open
  and loosely curled, to closed, to clenched hard with its knuckles risen
  ([build from volumes](#build-from-volumes)), and its keys move with the
  brows of [a face that acts](#a-face-that-acts) toward the same feeling. A
  `--loupe` crop shows whether the hand and the face read the same feeling.
- **A mood is four dials, not a new action.** The action stays and the dials
  turn. **Posture** is the trunk's lean and curve and the head's angle:
  upright and arched back for elation, curled forward with the head hanging
  for dejection, hunched and leaning away for fear. **Tempo** is how fast the
  move completes or repeats. **Amplitude** is how far it travels. **Tremor** is
  a small fast shake added on top. One raised hand, played with four settings,
  reads as four different people. Each figure has a degree of restraint, how
  much of a feeling reaches its posture and amplitude: a restrained figure
  keeps both small even for a large feeling, and lets it leak through one
  small part, such as a hand's tremor, a tapping foot or a held breath.
- **Effort is keyed beside posture.** Effort is a value from 0, at rest, to 1, at
  full strain, keyed per figure on a `keys` track like posture. It moves no
  joint: it drives the mass responses in [build from volumes](#build-from-volumes).
  The same raised arm reads as lifting a weight at effort 1 and as a gesture at
  effort 0. A restrained figure keeps its posture small but may let effort show
  in one mass.
- **Tempo and tremor show on consecutive frames.** Posture reads in any one
  frame, but a time strip spread over the whole film skips most of the frames
  between its cells: it cannot show how fast a move goes, and a shake does not
  show in it at all. Neighbouring [frame middles](#look-at-a-film) with
  `--loupe` on the figure show them.
- **A held pose breathes.** Under a long hold, one slow cycle of about
  3 to 4 s runs: on the breath in, the chest lifts and opens a little, and the
  shoulders, any raised arm and the hips rise with it. In a film 1920 wide, a
  breath that moves the shoulders and head 10 to 20 px, a raised hand about
  25 px and the hips a couple shows on a 100% crop. A time strip judges a
  hold region by region, so such a breath keeps the strip from naming the
  hold as held, while a pose frozen still is named. The strip compares only the
  frames it shows, so it still names the hold as held when every frame shown
  lands on the same point of the breath; `--at` at breaths in and breaths out
  across 6 s or more of the hold shows it moving. The flag only says that
  something moves: the breath itself shows on a 100% crop (`--loupe`) at a
  breath in and a breath out.
- **Each beat has a path class.** With a beat's two ends and its spacing
  kept, only the path between them changes: an arc for a natural, soft move,
  a straight line for force or a machine, a zigzag of a few sharp turns
  across the straight path for agitation. Each subject takes the usual path
  class of its [shape class](stills.md#shape-language): arcs for a round
  build, straight lines and level holds for a straight one, zigzags and snaps
  for a sharp one; the match breaks for a beat where the subject acts
  against its build. A time strip shows only scattered poses of a path; the
  moving tip's last 16 or so frames drawn as fading dots, on a judging
  overlay that stays out of the film, show the path.

#### Walks and runs

A step runs from one foot's contact to the other's, in four positions:
**contact** at phase 0, heel down, legs straight, weight not yet taken;
**down** at 0.25, the front leg bends under the weight, body lowest;
**passing** at 0.5, the free leg swings past the standing one; **up** at 0.75,
the back foot pushes off and lifts the body highest. `gait(start, lengths)`
counts the steps; its fraction is the phase, and a `keys` track over the phase
gives each part its move. It counts in frames: lengths summed in seconds can
land a contact a hair after its frame, as shots cut in seconds do.

```js
const { keys, gait, ease } = require('artifex/core/time.js');
// In build: six natural steps of 12 frames from frame 18, the last two quicker.
s.walk = gait(18, [12, 12, 12, 12, 10, 10]);
// Hips over a step: cushion into the down, speed through the passing, cushion
// into and out of the up, and pass the contact at speed.
const HIP = keys([[0, 0, ease.out], [0.25, -1, ease.inOut], [0.75, 1, ease.in], [1, 0]]);
// In draw:
const w = s.walk(clock.frame);
const step = Math.floor(w), phase = w - step;   // phase 0 contact, 0.25 down, ...
const lead = step % 2;                           // which leg steps
const hipY = 4 * HIP(phase);                     // design units, up and down
// In sound: a footfall on each contact after the first, from the same list.
for (const c of s.walk.contacts.slice(1)) footfall(c / timeline.hz);
```

`examples/stride.js` is the whole walk: key tracks over the phase for the
legs, the hips, the spine's lean and each arm's swing and reach, each planted
foot turning about its heel or toe and not sliding, the knees solved from
hip and ankle, and the walker standing tall: the standing leg nearly straight,
the hips a little lower on the down, lowered further only on a frame where a
leg could not otherwise reach. The
chest, head, forearms and hands each hang on a damped spring behind those
keys, so they lag, carry on past and settle after every contact; a hand
trails its forearm both ways, and the head's nod eases to a soft limit.
The camera follows the hips' mean pace, averaged over about two steps, so it
does not change speed on each contact. Each footfall on dry earth is three
sounds: a short low thump as the heel lands; a crunch of grit, with a second,
smaller burst as the weight rolls to the ball of the foot; and a scuff as the
back toe leaves the ground. It is the reference for posing a walk.

| Frames a step at 24 fps | Seconds | Reads as |
| --- | --- | --- |
| 4 | 0.17 | a very fast run, six steps a second |
| 6 | 0.25 | a run or a very fast walk |
| 8 | 0.33 | a slow run or a cartoon walk |
| 12 | 0.5 | a brisk, natural walk: the reference |
| 16 | 0.67 | a stroll |
| 20 | 0.83 | an old or tired walker |
| 24 | 1 | a slow step, or an average sneak |
| 32 | 1.33 | a slow sneak |

- **Tempo is character.** A walk timed against 12 frames: a little quicker or
  slower than that already says hurried, sad or cautious. Steps change
  length as the figure notices, hurries or slows; `lengths` may differ.
- **The passing position sets the walk.** Up on the passing gives a bouncy
  walk; down on the passing, with the contacts high, a comic one. The same
  contacts with a different passing position make a different figure.
- **Arms oppose the legs**, and their swing is widest on the down, not on the
  contact. Shoulders tilt against the hips; the belt line dips on the side of
  the lower leg; in front view the weight shifts over the standing foot.
- **The heel leads and the foot follows.** A standing foot stays flat and
  still while the body passes over it; the back toe stays down until the last
  moment. A lifting foot rises slowly, travels fast through the middle and
  goes down fast.
- **The body's path is mostly up and down.** Circles or figure eights in
  the body and head read as a bird's walk.
- **A run leaves the ground.** In a walk one foot is always down; a run has
  at least one frame with both feet off. The body lifts at most half a head
  on the up, leans further forward the faster it goes, keeps the arms tighter
  on a fast run, and the legs lead.
- **In front view a run stacks over the standing foot.** While one foot
  carries the weight, the head, the pelvis and that foot sit on one vertical.
  In the mannequin state, on each front-view key with one foot down, the
  head's, the pelvis's and the standing foot's x values lie within about 0.1
  head. `plumb.over` with
  [`--figure`](#silhouette-and-line-of-action) is only a coarse first test: it
  reads the centre of the fill, not those landmarks.
- **A cycle reads as a cycle.** Alternate steps vary: a different arm
  position or a reversed arch on every other contact, a different silhouette
  on the opposite step of a fast run.
- **Parts on different timings.** Not everything works at once: the head a
  few frames late, arms on their own `gait`, such as arms on 16-frame swings
  over legs on 8, or pumping twice as fast as the legs in a run.
- **A footfall is a force, not a click.** The heel strikes, the weight rolls
  along the outer edge, the ball pushes off: a hard onset and a softer tail.
  The gait sets the timing; the surface sets the sound. A slowing walker digs
  in with the heel and a speeding one pushes with the ball; downhill favours
  the heel and uphill the ball. In a walk, contacts of the two feet overlap,
  so each foot has its own voice, and each footfall's level and colour vary
  ([sound](sound.md)).

A figure on four legs keeps every point above per leg; what changes is the
order the legs step in. One `gait` step is a whole cycle of all four legs,
about two of the table's steps long, and each leg has a phase offset in
that cycle, `(phase - offset + 1) % 1`, so the leg lands when the cycle
reaches its offset; a leg stands while its own phase is below the stance
share and swings for the rest. Its footfall falls at the cycle's contact plus
its offset times the cycle's length, so a cycle sounds four footfalls, not one.

- **A walk steps one leg at a time, hind before fore on the same side.** Offsets
  hind left 0, fore left 0.25, hind right 0.5, fore right 0.75; stance share
  0.6 to 0.75. No frame has fewer than two feet down, and a slow walk has
  three down most of the time.
- **A trot moves diagonal pairs together.** Hind left with fore right at 0,
  hind right with fore left at 0.5; stance share about 0.5, and below that a
  fast trot floats with all four feet up, as a [run](#walks-and-runs) does.
  One leg of a pair offset by 0.02 to 0.05 makes the two footfalls flam
  instead of landing as one click.
- **The body rides the legs that stand.** The shoulders sink as a fore foot
  takes weight and rise as it passes under them; the hips do the same over
  the hind feet, so in a walk the back see-saws rather than bobbing as one
  piece. A trot bounces the whole body twice a cycle, lowest just after each
  pair lands. Each standing foot stays still on the ground while the body
  passes over it.
- **The head counters the shoulders.** In a walk the head nods down as each
  fore foot lands, a few frames behind the shoulders on a spring; in a trot
  it stays nearly level while the body bounces under it.
- **A stop or a brace is a pose, not a paused cycle.** It ends on all four
  feet down, fore feet planted ahead of the shoulders, weight back over the
  hind legs, the head lifting last; it overshoots a little, settles, then
  holds as long as [plan poses before motion](#plan-poses-before-motion) says
  a pose stays to be read. Across the hold, no foot hangs mid-swing and every
  foot sits on the ground line.

#### Joints that break in succession

A big move starts in the hips and travels out along the chain: shoulder,
elbow, wrist, fingers. Each joint starts later and arrives later than its
parent, so as the arm rises the elbow leads and the hand drags, and the hand
is still rising when the elbow has turned down. One track per joint read a
few frames later down the chain, or each joint hung on its parent with
`follow` and a growing `delay`:

```js
const ARM = ['shoulder', 'elbow', 'wrist', 'finger'];
ARM.forEach((joint, j) => { pose[joint] = swing[joint](clock.frame - 2 * j); });
```

On a painted figure each outline point takes the track value of the mannequin
joint it hangs from, read a few frames later for each joint down the chain:
the joints' values go as an array to `keyOutline(KEYS, values, weights)`,
with one row of weights per point. Weights eased from one joint's track to
the next over the points around a joint keep the contour from kinking there.

- **A twist starts in the lower body.** The feet and the pelvis turn first,
  then the chest, then the head, each a few frames later: the same chain as
  the arm's, with each outline point on the track of the joint it hangs from.
- **The head rights itself a beat after the body leans.** A trunk that tips
  carries the head with it, then the head turns back towards level a few
  frames later, since a body keeps its eyes level; a head held at the trunk's
  angle through the whole lean reads as fixed to it like a lid.
- **A relaxed or gesturing wrist bends 15-35° off the forearm, and not on
  top of a twist.** A key with a forearm roll
  ([landmarks, lengths and joints](#landmarks-lengths-and-joints)) keeps its
  wrist straight, and so does a limb that strikes or pushes, since one
  straight limb carries the force ([takes and accents](#takes-and-accents)).
  The wrist angle is in each key's mannequin state.
- **A joint bent past where it would go**, for a frame or two, reads at
  speed as flexibility, not as a break. Straight rigid parts then move with
  the flow of a curve.
- **Paper cutouts look like paper.** A figure that only turns stiff parts,
  all at once, reads as pasteboard sliding around. Parts overlapped and
  delayed, the silhouette changing from curve to opposite curve to straight,
  read as a body.
- **Matching parts moved as twins look mechanical.** Two matching parts,
  such as a pair of handles on a lid or two fins, given the same keys move as
  a mirror. One started a frame or two later with a different amount breaks
  the mirror. The scaffold warns of both among a row's `keys` tracks.

#### Takes and accents

A take is an anticipation, an accent and a settle: the figure sees something,
sinks, snaps up past its new pose and settles into it. A standard take at
24 fps lasts 16 frames, a snappier one 14, and a double take, the head
shaking side to side on its way up, about 19. The sink is slower than the
snap up, and the accent itself is felt in passing rather than held. A
starting chart, to act out and adjust:

```js
const take = keys([
  [0, 0, ease.inOut],     // sees it
  [8, -0.25, ease.out],   // sinks into the anticipation
  [10, 1.15, ease.in],    // the accent, past the pose: felt more than seen
  [16, 1],                // settles into the pose and holds
]);
```

- **Anticipate the opposite way.** A move is stronger after a smaller move
  the other way first, slower than the move itself. One to three frames of it
  are too short to see but give the snap; a small rise before the sink is an
  anticipation of the anticipation.
- **Hard accents recoil, soft ones continue.** A hammer on an anvil or a
  finger jabbed hard bounces back a frame and slows into a hold. A soft accent,
  a conductor's waltz beat, speeds in and keeps going, cushioning to a stop.
- **An impact is timed by its force.** The last frame before a hit shows the
  contact, then the squash. For more force, the frame before contact dropped
  makes the move jump a gap: unseen, but felt. A punch reads by its result,
  not the contact: the fist already past and the head displaced, the contact
  frame dropped and the hit's sound there. A strike meets its target in the
  middle of its swing, at full speed: a swing that reaches the target only at
  its end has already slowed, and reads as a push or a tap. Its
  follow-through carries past a target that gives; on a hard one it recoils,
  as above.
- **A struck body turns most where it is hit.** Its feet stay planted, and the
  turn falls off along the chain away from the hit. On a painted figure each
  outline point of the struck key takes a share of the turn that falls with
  its distance from the hit landmark: `keyOutline([rest, struck], [0, hit],
  weights)`, with `hit` the struck track's value and the row
  `[1 - share, share]` for each point. No part turns
  about a pivot. The limb
  that strikes is the one already swinging forward, and one straight limb
  carries the force.
- **A burst shrinks the outline, then opens it.** The anticipation pulls the
  contour points in toward the body, and the accent opens the outline to
  about twice its rest width. `box` width on the take's keys with
  [`--figure`](#silhouette-and-line-of-action) measures it.
- **Folds sit on the concave side of every bend**, as the crease row of
  [build from volumes](#build-from-volumes) draws them. The upper back stays
  convex in every pose but a hit from behind; an arch or a back bend sits in
  the lower back.
- **A squash keeps the part's volume.** Scaled by `s` below 1 along the hit
  and by `1 / s` across it, the area of its outline stays the same; a
  stretch is the same with `s` above 1 along the move. Scaled about the
  contact point, turned to the hit's direction `a`, with
  `g.translate(cx, cy); g.rotate(a); g.scale(s, 1 / s); g.rotate(-a); g.translate(-cx, -cy)`,
  the part flattens against what it hits instead of shrinking off it; its
  children painted inside the same transform stay on it. The product of the
  two scales is 1 on every frame of the squash. Only a rubbery cast squashes
  ([one body physics](#one-body-physics)).
- **A painted figure stretches in its joint gaps, not in its bones.** The
  gap of the spine between the chest egg and the pelvis, and the shoulder's
  gap from the neck, lengthen; the segment lengths of
  [landmarks, lengths and joints](#landmarks-lengths-and-joints) stay. A
  strained limb thins at the wrist. In the mannequin state every segment
  length is the same on every key while the distances from the neck pit to
  the pelvis and from each shoulder to the neck grow. A rubbery cast
  squashes and stretches as the bullet above says.
- **A large event takes longer than the same event at model size.** A fall or
  a swing of something k times as large takes about the square root of k times
  as long, as gravity times both: a crash of a body 4 times as tall lasts
  about twice the frames. A large subject's moves timed from its size read
  as large; timed from a small model's keys, it reads as a toy.
- **Each sound sits where it lands.** A hard hit sounds on the recoil, one
  frame after contact, and a whip on the frame after its snap: those frames
  show the cause. Against music, the accent pose may come up to two frames
  before its beat, and a sharp body move three or four with the mouth opening
  on the sound: the beat scheduled at `(frame + k) / hz` from the accent's
  frame, with the cue table saying so. A picture that lags the sound reads
  as late. A figure that voices a sound acts it with the body, not the mouth alone:
  the chest lifts on the breath before it, and the head and shoulders take its
  accent. A sound from a still body with only the mouth moving reads as dubbed.
- **A heavy hit can hold the whole action on its result.** Everything that
  is part of the action stops on the first frame that shows the hit's
  result, which is the frame after the contact where
  [the contact frame is dropped](#takes-and-accents): the one that strikes,
  the thing struck, the dust, the effect. Only the view's
  [shake](#camera-and-framing) keeps running through the hold, so the frame
  is not dead. Then it all resumes at full speed. The hold says weight the
  way a held breath does: the same hit without it reads lighter. Starting
  values from game animation, not measured on films: two to five frames at
  24 a second, longer for a heavier hit, and past about a third of a second
  it reads as a stall; hits that overlap share the longest hold, not their
  sum. The struck thing's sway afterwards is a `spring`, not an ease. The
  cue table holds each hold as frames, and the hit's sound keeps its own
  frame, as the bullet on where each sound sits says.
- **After-images are light, not paint.** A fast body can leave a few copies
  of its recent poses behind it. Drawn opaque they smear the body and muddy
  what is behind; added as light over the scene, with the body drawn crisp
  on top, they read as speed. A new one every frame or two, each fading out
  over about four frames, leaves two to four showing at once.
- **A shudder is two series.** Alternate frames between a pose track and a
  copy offset a little, such as reading a track at `frame + (frame % 2) * 3`,
  and it trembles where a single track would slide.

### Detail and resolution

- **Detail falls away from the subject**, as the
  [focal preset](stills.md#art-direction-preset-focal-composition) says for stills:
  broader marks and lower contrast in the background.
- **A painted mark belongs to the thing, not to the frame.** Strokes placed
  afresh in every frame flicker: each frame is another painting. Strokes
  fixed to the screen swim: the thing slides under its own paint. Give each
  stroke a place on the thing's rest shape and its length, lean and colour
  from `R` by the stroke's index, once, never by the frame. Then carry it
  with the thing: `riders(mesh, places)` of `core/deform.js` returns, for a
  bent mesh, where each place now lies and how far its piece has turned
  and grown, so the stroke keeps its spot and turns with the form. For a
  thing that only moves and turns whole, its own transform does the same.
  A stroke that must come or go fades by a phase of its own, also from its
  index, never all at once.
- **Line work near the pixel scale shimmers.** Lines, hatching or pattern
  spacing of one or two output pixels shimmer into moiré as they move and
  blur in the encoded film. The finest spacing several pixels wide at the
  delivered size survives; a decoded frame at 100% (`replay --save-frames`)
  shows it.
- **A regular pattern strobes as it moves.** Stripes, a grid, the spokes of a
  turning wheel or a row of fence posts repeat at a fixed spacing, their
  period. Between two frames the eye matches each stripe to the nearest one,
  so a pattern that moves more than a quarter of its period a frame starts to
  stutter, at half a period it flickers in place, and near a whole period it
  seems to stand still or run backwards, while a subject slides past it.
  Under a quarter period a frame, at a pan's peak speed too, it holds; or it
  moves so fast that it passes as a blur, smeared along the move; or uneven
  spacing or gaps break its regularity. A fence of posts 40 px apart in the
  delivered film crosses at most 10 px a frame. Consecutive
  [frame middles](#look-at-a-film) show it.
- **Fine timing reads differently on the finished render.** Grey blocks judge
  the story and the rhythm, but a hold of a few frames, an accent or a snap
  reads differently once the parts carry their detail, texture and finish.
  After [blocking](#plan-the-film), consecutive frames of the finished render
  with `--at` and `--loupe` show each fine action, and it is retimed there.
  A strip cell is too small to show the detail a hold gives time to read, so
  how long each hold lasts is judged on the saved film at full size.

### Look at a film

Nine seeds show one playhead; a film also needs its times. A time strip draws
them from the command line, at the piece's seed, 640 px wide per frame, each
with its draw time:

```shell
npm --prefix "<library root>" run seeds -- "./my-piece.cjs" --frames 9 --png
npm --prefix "<library root>" run seeds -- "./my-piece.cjs" --at 1.5,1.75,4,6.25 --png
npm --prefix "<library root>" run seeds -- "./my-piece.cjs" --at 4,6.25 --loupe 480,300 --png
npm --prefix "<library root>" run seeds -- "./my-piece.cjs" --frames 9 --sound --png
npm --prefix "<library root>" run seeds -- "./my-piece.cjs" --contacts cues.contacts --loupe --sound --png
```

The first spreads nine frames from the first to the last, the second shows the
frames holding those seconds, and the third adds under each a 100% crop of the
film at its export size around that design point (the centre without one), for
fine detail. The first writes `my-piece-frames.html` and `my-piece-frames.png`;
the second writes `my-piece-at.html` and `my-piece-at.png`, and the third
`my-piece-at-loupe.html` and `my-piece-at-loupe.png`, so no strip replaces
another. Add `--seed 7` to any strip to draw it at seed 7 instead of the
piece's own; the file name gains `-seed7`. The fourth adds the soundtrack under
the strip on the same time axis, each sound's start against the frame that
shows its cause ([time strips](../../../docs/knowledge/command-line-tools.md#time-strips)
describes its panels and `--json` fields). The fifth draws each planned
contact with the two frames before it and three after, a 100% crop and the
sound; a film-scaffold piece keeps its contacts in `cues.contacts`, and
another piece names its own list. It needs a piece that plans a contact (an
empty list is refused), and a silent piece leaves out `--sound`.

Nine frames cannot show how a film moves between them. `--motion` on any
strip draws every frame small and lays under the strip, on the film's own
time axis, how much the whole picture changes from each drawing to the next:

```shell
npm --prefix "<library root>" run seeds -- "./my-piece.cjs" --frames 9 --motion --png
```

A stretch of a second or more that barely changes is shaded: a planned hold
looks like that, and so does a film that has stopped without your meaning it
to. A frame that changes over five times the film's median, and is not a cut,
is marked red: that is the lurch of several changes starting together, or of
a term switched on at a threshold. Neither mark is a fault by itself; each is
a place to look at with `--at`.

These looks are the first way to judge a film's picture and sound. A measure
they already give, such as a sound's onset against its cause's frame or the
level of a quiet beat, is read from them, with `--json` for numbers; a script
of your own is kept for what none of them shows.

For fine motion, such as a shake, a blur or a strobe, pass `--at` the middles
of consecutive frames, `(frame + 0.5) / hz` each: a frame-start time rounded
for typing falls in the frame before and can show one frame twice. The
sections above call this drawing the frame middles.

A shot strip is the film's storyboard: `--shots` in place of `--frames` shows
each shot's first, middle and last frame on one row, labelled with the shot's
name, and writes `my-piece-shots.html`. It reads the shot list from
`state.cues.shots`, the list `shots()` returns, where the
[film scaffold](../film-scaffold.cjs) keeps it; a piece that keeps none there
is refused by name.

Add `--cuts` to a shot strip to see each cut as a composition between two
frames: under each shot's first frame, the last frame before it shows through
at 50%, the incoming focus is ringed and the outgoing frame's strongest edge
in the ring is marked. After the strip, every shot's eye track and every cut's
jump are drawn on one frame. Read the sequence's lines there: a calm stretch
shows a few continuous, matched lines; the peak shows many broken lines and
long jumps. The focus comes from `state.cues.focus`, the scaffold's `FOCUS`
rows, which the scaffold publishes itself (no `focus` key when `FOCUS` is
empty); a `focus: FOCUS` written into `s.cues` by hand overwrites those
filtered rows with the raw ones. The measures and refusals are in
[cut pairs](../../../docs/knowledge/command-line-tools.md#cut-pairs).

`--values`, `--grey` and `--colour-vision` add
[value, greyscale and colour-vision views](../../../docs/knowledge/command-line-tools.md#value-greyscale-and-colour-vision-views)
under every cell of any strip or sheet: lightness blurred into 3 levels, the
grey of each colour, and three colour-blind simulations. With `--json`, every
strip cell, with or without views, gives its OKLCh lightness `mean`, `min`,
`max`, `range`, and `p5` and `p95`, the lightness of its darkest and lightest
large areas; [its `chroma`](../../../docs/knowledge/command-line-tools.md#time-strips)
`mean`, `max`, `p50`, `p95`, `high`, the share of pixels over C 0.1, and
`areas`, the count of areas over 0.1; and `saturated`, its most saturated
areas, at most 3, each with box, `share`, `chroma` and `hue`. `--values`
adds its `peak`, the strongest value step, beside the planned focus.
`--gamut <FOGRA39L.txt>` adds the
[print-gamut view](../../../docs/knowledge/command-line-tools.md#print-gamut-view),
drawn from Fogra's data file that you download, and its `gamut` JSON field gives each cell's `share` of pixels outside the
gamut and `excess`, their largest OKLab distance from it.
`--light-page` shows any sheet on a
light page instead of the near-black one.

This scene review finds what a play-through misses: a thing kept past its
beat, a part covered on its beat, an empty transition, a contact with no
reaction. It costs one `--at` strip per scene and a whole-film strip for
tone; a loop with no beats, contacts or cuts is one scene: those two strips and step 5.
After each scene, and once over the whole film:

1. List every cut, every transition's midpoint, each beat of the beat sheet
   (with a time where a held prop passes the part that acts) and each
   [planned contact](making.md#depth-order-and-contacts).
2. Draw each in a strip with `--at`, and `--sound` for a piece that declares
   sound. Add the time a few frames later wherever motion matters; each such
   frame and the one a few frames later form a pair. Open the image and look
   at every frame.
3. Of the [before-export list](film-route.md#before-you-export-a-film), a
   scene's strip answers the lines on light and support; the hook, the trough
   and the final image need the whole film, so those wait for the pass before
   delivery. Each frame then shows:

   - the background moves between the pair;
   - nothing stays past its beat or vanishes between two times;
   - on each listed `--at` frame of a beat the part that performs its action
     (the touching edge, a mouth, a hand) shows and nothing drawn after it
     covers it, a held prop at each point of its path included: name the part
     by its colour with `--part` and `--json`, and its `covered` stays near 0
     on each `--at` frame of the beat
     ([part coverage](../../../docs/knowledge/command-line-tools.md#part-coverage);
     the [paint order](../../../docs/knowledge/command-line-tools.md#paint-order)
     decides what covers what);
   - no transition midpoint is empty or a flat card;
   - each character matches its other views;
   - every [hinged figure](#hinged-figures) is closed at its joints;
   - every [painted figure](#paint-over-a-hidden-mannequin) on a `--loupe`
     crop at the middle of each blend shows no seam at a joint, and contour
     strokes that taper, break on the lit side and overlap at each joint;
   - at each contact nothing cuts through another part or changes layer;
   - at each contact the thing touched reacts on the frame its sound starts (a
     hard hit on the frame after contact, as in
     [takes and accents](#takes-and-accents)); that frame is the sound's
     `frame` in `state.cues.sounds` (its `at` in SOUNDS times `hz` only when
     no TEMPO applies), or a frame label of a
     `--contacts cues.contacts --sound` strip: a whole-film strip is coarse on a long film;
   - at each contact the thing touched still reads in the frames after the
     contact ends, at the film's size (`--loupe` in a wide shot);
   - at each contact its sound stands out of the ambience only as far as the
     framing brings it near.

   Across each cut and blend, the framing changes with the beat's weight,
   screen direction and the key light hold, and each move lands on its
   planned frame.
   Tone is judged on a whole-film strip (`--frames` high enough for a frame
   per scene): each scene's key and range beside its neighbours, not alone,
   since a scene too dark by itself can be right in sequence. With `--json`,
   the numbers say it:

   - each scene's `lightness.mean` sits near its neighbours' unless the
     colour strip planned the step: a change of key, or a section's change of
     colour or mark technique ([neighbouring sections contrast](#pace));
   - the peak's frame has the strip's largest `lightness.p95` minus
     `lightness.p5`;
   - low-intensity scenes and the final image have a narrow `p95` minus `p5`.

   The strip's near-black page stands for a darkened room; a film meant for a
   lit room or a light page is judged once more on `--light-page`, and full
   screen on a light ground, before a key changes. A grade that is too light
   shows there: low-key frames keep deep darks over most of the frame, down
   to the grade's `black` where a [finish](#film-finish) sets one, and none
   reads as a dim day
   ([make night with its signs](materials.md#light-decides-what-exists)). Each
   return from a long dark eases, as [colour across the film](#colour-across-the-film) asks.
4. Each fault named in visual terms, fixed, and looked at again. One named
   fault per pass, with the new strip at the same seeds and `--at` seconds as
   the last, beside it, makes the change the only difference. Before anything
   is added, the weakest part is named and a removal tried. An added pass,
   such as a glow, a haze or a [finish](#film-finish) part, earns its place
   when the same strip drawn with it off, low and full shows it helping. A
   frame that reads as pasted together is read in this order: the key
   light's direction, then the contrast range, then the haze, and only then
   the detail. Fine detail shows with `--loupe`, then once more on the
   exported film's decoded frames (step 5).
5. Save the film with `npm --prefix "<library root>" run film -- "./my-piece.cjs"` and check it with
   `npm --prefix "<library root>" run replay -- "./my-piece.mp4" --piece "./my-piece.cjs" --save-frames 0,1.5s,4s`.
   `--save-frames` also writes those frames as the film decodes them, full-size
   PNG files in `my-piece.mp4-frames/`; at the times listed in step 1, each
   file at 100% shows the grain, fine lines and colour the encoder lost
   ([replaying a saved file](../../../docs/knowledge/command-line-tools.md#replaying-a-saved-file)).
   Adding `--lag "./before.mp4" --at 2.5s --region x,y,w,h` says how many
   frames a beat moved between two renders; it never changes the verdict.
   `npm run film` names each look above (seeds, frames, `--at`, `--contacts`,
   `--loupe`, and `--shots` and `--sound` where they apply) that is missing or
   stale, and says on stderr what a [fresh-eyes review](#fresh-eyes-review)
   of the saved film finds. The built page with `?player=1` already plays the piece without
   controls.

### Fresh-eyes review

A fresh-eyes review is a read of the saved film by a subagent started without
this work's context. It finds what the plan's author cannot see: a place left
unshown, a cause off screen, a beat that reads only to someone who knows it.
It costs a subagent run. A film with a story takes it twice, blocked and
finished; a loop with no story has nothing to retell and takes none.

- **Only the film.** The MP4's path. When it cannot play video, a strip of
  evenly spread frames from `--frames`, not `--shots`, whose shot names tell
  the plan. The spine, the beat sheet, the cue table, the source or a file
  name that tells the story give it the answers; only the title reviewer
  below also gets the publish title and description.
- **The same questions each time.** What the film is about, in one sentence;
  what the subject wanted, what it did to get it, what worked against it from
  within and what it gave up; whose film it was; three words for its tone; which
  parts felt slow; which were unclear or puzzling; which question it left open;
  for a film set in a place, where each scene is, at what hour and in what
  season, and how deep its space reads. Then what worked. The expected
  answers go in the plan first.
- **The screen is wrong, not the reviewer.** Where its sentence differs from
  the spine's or its three words from the painter's, or where something would
  have to be explained for it to understand, the film changes; arguing it
  back changes nothing. Puzzlement about the question
  the spine leaves open is the film working, provided the reviewer can say
  the question; any other puzzlement is a fault. Every answer noted and
  sorted later; a flaw no first viewer would notice is skipped.
- **Upstream.** A reviewer says where it hurts, not where the cause is: a
  slow or puzzling part asks first what the viewer needed to know before it.
- **A second reviewer stopped at the turn.** Evenly spread frames up to the
  turn, drawn with `--at`, and the question what happens next. One that
  names the ending wants less planting or more twist.
- **A third reviewer with the publish title.** When the finished film will be
  published with a title or a description, one more reviewer gets the film
  with them, exactly as a viewer will read them, and the same questions.
  Where its sentence or its three words move away from the spine's and the
  painter's more than the first reviewer's did, the title or the description
  changes first, then the film.
- **A new reviewer each time.** One that has seen an earlier cut knows too
  much.

## Save a film

Walk `playheads(piece)`; the frames are a property of the piece, never of how
fast the machine is. The built page does it: **MP4 1920 px**, with the long edge
at 1920 px or more, or **MP4 1x draft** at the design box, frame-exact at any drawing speed and
carrying the declared soundtrack, or `__artifex.film({ scale, bitrate })`, which
saves nothing and returns the report read from the file, with `shots`, the
solve's `state.cues.shots` as `{ name, start, end }` in frames, or null unless
that list holds at least one shot and every shot has a string name and whole
frames with `0 <= start < end <= frames`, `end` being the first frame after
the shot. From a
shell, `npm --prefix "<library root>" run film -- "./my-piece.cjs"` saves that same export beside the piece
as `my-piece.mp4`, with its report as `my-piece.mp4.json`, and takes `--out`,
`--seed` (without `--out`, the film at seed 7 is `my-piece-seed7.mp4`), `--scale`, `--bitrate`, `--reframe t:WxH,...`, `--force
no-aac|no-webgl2`, `--crash-gpu ms`, which crashes its own Edge's GPU process
that many milliseconds into the export and records `gpuCrash` in the report,
and `--timeout-ms` (ten minutes by default, an hour at most); do not write your
own browser driver. A film note that says `Drawn twice` or `Drawn again` means
the export drew the whole film again after a failure, and the report's
`encoderError` and `contextLost` say why. The default
bitrate is 0.45 bit per pixel per frame, about 22 Mbit/s at 1080p24, measured to
keep fine hatching over replay's 30 dB floor; pass `bitrate` in bit/s to spend
more. Only where the browser cannot encode that MP4 does the page offer **WebM
film**, which records in real time, so it needs frames cheaper than their
budget and has no sound.

A film's frame size cannot change while it plays. A piece with `boxes` can
still change its box inside that frame with `reframe`; see the runtime skill.

## Film traps

- **An agent host's command sandbox can keep the film from saving.** `npm run
  film` drives Edge, and some hosts' sandboxes stop it: Codex's
  `workspace-write` on Windows denies the launch or ends Edge at startup. The
  command says that a sandbox is the likely cause. Run the same `film` and
  `replay` commands outside the sandbox, as the host allows; the piece needs
  no change ([traps](traps.md)).
- **A piece slower than real time cannot be recorded in real time.** The WebM
  recorder stamps frames by the wall clock, so frames that cost more than their
  budget are lost and the export says so. MP4 encodes every frame at its own
  time; a heavy frame makes a slower export, not a shorter film.
- **A film whose colour tag disagrees with its samples shifts every colour.**
  Limited-range video read as full range lifts black to grey and dims white. The
  MP4 export converts every frame to limited-range BT.709 and tags it so, in the
  container and in the H.264 stream; a re-encode that keeps that range and
  both tags keeps the colours.
- **A draw that resets the transform draws at the wrong size.** `draw(g)` gets
  `g` with the output's scale already set, and a strip cell, a still and a film
  each set their own. `g.setTransform(1, 0, 0, 1, 0, 0)` or `g.resetTransform()`
  drops it, so what follows is one pixel per design unit: too large in a
  640-pixel strip cell of a wide piece, too small in a film exported above
  scale 1. `save`, `translate`, `scale` and `restore` build on the given
  transform. Painting in device pixels, as when laying a cached copy back,
  reads `g.getTransform()` first and sets it back after. A time strip whose cells are
  drawn at a scale other than 1 lists each cell that paints a shape or text
  after `setTransform`, `resetTransform`, `reset()` or a `restore()` past the
  cell's own `save` in `flags.unscaled`, on its own unscaled line
  ([time strips](../../../docs/knowledge/command-line-tools.md#time-strips));
  at scale 1 nothing shows, so a film or still above scale 1 is where it shows.
