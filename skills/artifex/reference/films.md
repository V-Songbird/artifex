---
type: knowledge
summary: "How to make an Artifex film: the looks to leave out, the film finish, art direction, continuity and transitions, the look loop on frames, and saving the MP4; read before the first draft of any piece delivered as a film."
related_files: ["skills/artifex/SKILL.md", "skills/artifex/film-scaffold.cjs", "core/finish.js", "core/time.js", "examples/cues.js", "tools/film-cli.js"]
---

# Films

Read this with [the core skill](../SKILL.md) for any piece with a timeline that
is delivered as a film. The contract, authored time and sound stay in the core.

## Looks to leave out

Start a film's list of [looks to leave out](../SKILL.md#ask-which-looks-to-leave-out)
with these, so the owner can strike or extend them:

- one noise family at every scale ([focal composition](stills.md#art-direction-preset-focal-composition));
- a line that fades up through `globalAlpha` instead of arriving (same);
- a flow field around a focus that turns botanical ([traps](../SKILL.md#traps)).

A grain pass over the finished frame is not on a film's list. A film's
[finish](#film-finish) is one declared process over every frame; the marks under
it still keep their own texture.

## Film finish

A film may declare `finish`: one process that touched every pixel of every
frame, as developing and printing touch a film. `drawFrame` draws it after
`draw` on every raster frame, the same way on each. Read the
[piece API](../../../docs/apis/piece-api.md#film-finish) for the contract.

```js
finish: {
  grain: 0.35,     // 0..1: seeded grain that boils, a new offset every frame
  weave: 1.2,      // design units: the picture moving in the gate
  flicker: 0.05,   // 0..1: how far a frame's exposure may dip
  vignette: 0.35,  // 0..1: how dark the corners fall
  grade: { black: '#1d1812', white: '#f4ecdc', tone: '#9c7a52', toning: 0.15 },
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
- **One treatment, the whole film.** It is declared once, not per shot. Scenes
  that should feel different differ in their marks and palettes, under the same
  print. Do not bake a different grain or tint into each sprite instead: that is
  the film that reads as made of different styles.
- **The marks keep their own texture.** The finish is the film's material, not a
  substitute for the material on screen: paper keeps its cut edge, paint its
  stroke. [Texture belongs to the material](stills.md#art-direction-preset-focal-composition)
  still holds for every mark, and for stills, which refuse `finish`.
- **Keep it quiet and look at full size.** Grain spends bitrate: at the export's
  default a film grain keeps about two thirds of its finest detail, and the rest
  softens into mottling, so judge it on decoded frames at 100%, not on the
  canvas, and raise `bitrate` if it must survive.
- **Nothing to schedule.** Each part is a function of the seed and the frame, so
  scrubs, exports and replay agree. An SVG keeps the bare marks; a PNG, a film and
  the page carry the finish. Paint an opaque ground: grain over transparency
  shows grey.

`examples/cues.js` declares one: four palettes under one print.

## Film art direction

A film is judged as a world, not a subject on a set. Every rule here is checked
on frames, not in code.

**Plan in seconds before code.** Write a beat sheet: each scene's beats in
seconds, the background action that runs under it, and for each transition the
physical event that links one scene's shape to the next. Keep it in the piece's
header comment beside its [looks to leave out](#looks-to-leave-out),
then turn it into one cue table in frames, as `examples/cues.js` does.

**Start the plumbing from the [film scaffold](../film-scaffold.cjs).** Copy it
beside your piece and fill its slots: the shots, a cue table where every
element has an entry and an exit, what paints each element, the sounds with
their causes and distances, the room, the ground drawn once and the finish. It holds
structure only and draws nothing but a grey ground: the subject, the look,
the voices' recipes and the finish come from you and the style guide. Its
build refuses an element with no exit and a sound whose cause is not on
screen at its second.

**Build and review scene by scene.** Finish one scene, [look at its
frames](#look-at-a-film), fix it, then start the next. Write a long plan or
source in pieces, a scene at a time: one very long write can be lost to the
output limit.

### What every scene holds

- **The background lives, quieter than the subject.** Give elements behind the
  subject their own cues and their own `R` names, so each keeps its own rhythm:
  something flickers, drifts, sways or switches on and off. Keep it smaller,
  slower and lower in contrast than the subject, so the eye still lands there.
- **Background motion stays readable.** Nothing crosses the frame in about half
  a second; slow it or shorten its path.
- **Light reaches as far as it would.** A glow or beam lights what lies around
  it: draw it as its own pass over the layers it crosses, with a blend such as
  `screen` or `lighter` and a falloff with distance, or tint each layer it
  crosses. A layer's edge or clip never cuts a light off. Every lit area has a
  source, in the frame or plainly beyond it.
- **Everything stands on something.** An element meets what holds it with a
  contact shadow, an overlap or a shared edge, and a far form's base runs into
  the colour and texture of the ground under it. A gap of a few pixels reads as
  floating.

### Continuity

- **Props exit when their job ends.** An element whose beat is over leaves, on
  screen or with the cut; one kept as a reminder reads as a mistake.
- **Nothing appears or vanishes without a cause.** An element enters and
  leaves through an edge, an opening that exists or from behind something.
- **A character keeps its identifying features in every view.** Draw every view
  from one set of parts: the same silhouette, markings, colours and proportions.
  Put its views side by side and compare.
- **A transition is a physical event.** Something that can happen to one
  scene's shape turns it into the next: a surface breaks, a form grows into
  another, the view passes through an opening. Never an empty frame, and never
  the next scene as a flat card the view moves into. `core/time.js` only cuts;
  author the change as cues, as `cues.js` blends its scenes part by part.
- **Gags get anticipation and a hold.** Wind up before the action, let it land,
  then hold the result long enough to read before the next beat.
- **Motion has weight: parts overlap and follow through.** Nothing moves as one
  rigid pose. Loose parts, such as a tail, hair, cloth or a held prop, start
  after the body and arrive after it: drive them with `follow` from the body's
  own move, with a longer `delay` and softer `stiffness` the further they hang.
  A landing or a hit rings on a `spring` and holds until its `settle` before
  the next beat. A sine wobble or an instant pose reads as mechanical.

### Detail and resolution

- **Detail falls away from the subject**, as the
  [focal preset](stills.md#art-direction-preset-focal-composition) says for stills:
  broader marks and lower contrast in the background.
- **No line work near the pixel scale.** Lines, hatching or pattern spacing of
  one or two output pixels shimmer into moiré as they move and blur in the
  encoded film. Keep the finest spacing several pixels wide at the delivered
  size, and judge it on a 100% crop of a decoded frame.

### Look at a film

Nine seeds show one playhead; a film also needs its times. A time strip draws
them from the command line, at the piece's seed, 640 px wide per frame, each
with its draw time:

```shell
npm --prefix "<library root>" run seeds -- "./my-piece.cjs" --frames 9 --png
npm --prefix "<library root>" run seeds -- "./my-piece.cjs" --at 1.5,1.75,4,6.25 --png
npm --prefix "<library root>" run seeds -- "./my-piece.cjs" --at 4,6.25 --loupe 480,300 --png
```

The first spreads nine frames from the first to the last, the second shows the
frames holding those seconds, and the third adds under each a 100% crop of the
film at its export size around that design point (the centre without one), for
fine detail. Each writes `my-piece-frames.html` and `my-piece-frames.png`.
After each scene, and before delivery:

1. List every cut, every transition's midpoint and each beat of the beat sheet.
2. Draw each in a strip with `--at`. Add the time a few frames later wherever
   motion matters. Open the image and look at every frame.
3. Check each frame against the three lists above: the background moves between
   the pair, light reaches past the layers it crosses, everything touches what
   holds it, nothing stays past its beat or vanishes between two times, no
   transition midpoint is empty or a flat card, and each character matches its
   other views.
4. Name each fault in visual terms, fix it and look again. Check fine detail
   with `--loupe`, then once more on the exported film.
5. Save the film with `npm run film` and check it with
   `npm --prefix "<library root>" run replay -- "./my-piece.mp4" --piece "./my-piece.cjs"`.
   For a page that plays the piece without controls, open the built page
   with `?player=1`; do not build a player of your own.

## Save a film

Walk `playheads(piece)`; the frames are a property of the piece, never of how
fast the machine is. The built page does it: **MP4**, with the long edge at
1920 px or more, or **MP4 1x** for a draft, frame-exact at any drawing speed and
carrying the declared soundtrack, or `__artifex.film({ scale, bitrate })`, which
saves nothing and returns the report read from the file. From a shell,
`npm run film -- ./my-piece.cjs` saves that same export beside the piece as
`my-piece.mp4`, with its report as `my-piece.mp4.json`, and takes `--out`,
`--scale` and `--bitrate`; do not write your own browser driver. The default
bitrate is 0.45 bit per pixel per frame, about 22 Mbit/s at 1080p24, measured to
keep fine hatching over replay's 30 dB floor; pass `bitrate` in bit/s to spend
more. Only where the browser cannot encode that MP4 does the page offer **WebM
video**, which records in real time, so it needs frames cheaper than their
budget and has no sound.

A film is drawn at one box: its frame size cannot change while it plays.

## Film traps

- **A piece slower than real time cannot be recorded in real time.** The WebM
  recorder stamps frames by the wall clock, so frames that cost more than their
  budget are lost and the export says so. MP4 encodes every frame at its own
  time; a heavy frame makes a slower export, never a shorter film.
- **A film whose colour tag disagrees with its samples shifts every colour.**
  Limited-range video read as full range lifts black to grey and dims white. The
  MP4 export converts every frame to limited-range BT.709 and tags it so, in the
  container and in the H.264 stream; keep that range and both tags through any
  re-encode.
