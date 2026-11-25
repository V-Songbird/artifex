---
type: api_spec
summary: "Shows a runnable custom Artifex piece and the public validation, noise, responsive-box, interactive-piece and session, solving, rendering, key-outline, depth-armature, cross-contour, path-growing, simulation, static-layer, sprite, image, colour-dissolve, soundtrack and film-finish entry points."
related_files: ["core/piece.js", "core/sim.js", "core/planck.js", "tests/sim.test.js", "examples/cascade.js", "examples/drape.js", "core/rand.js", "tests/rand.test.js", "core/render.js", "core/time.js", "core/film.js", "core/webgpu-preview.js", "core/surface-vector.js", "examples/pixel-field.js", "examples/refit.js", "examples/readout.js", "examples/drift.js", "examples/settle.js", "examples/cues.js", "examples/stride.js", "core/layer.js", "core/sound.js", "skills/artifex/film-scaffold.cjs", "core/colour.js", "core/finish.js", "core/flash.js", "core/export.js", "tests/finish.test.js", "tests/layer.test.js", "tests/fixtures/sprite-film.cjs", "tests/toolkit.test.js", "tests/piece.test.js", "tests/render.test.js", "tests/time.test.js", "tests/sound.test.js", "tests/film.test.js", "tests/webgpu-preview.test.js", "core/geom.js", "tests/geom.test.js", "core/clip.js", "core/clipper2.js", "core/armature.js", "tests/armature.test.js", "core/path.js", "core/image.js", "tools/image.js", "tests/image.test.js", "tools/fixtures/image-piece.cjs", "core/play.js", "tests/play.test.js", "tests/page-play.test.js", "tools/fixtures/play-piece.cjs"]
---

# Piece API

[`FIELDS` in core/piece.js](../../core/piece.js) is the authoritative contract, including defaults and validation messages. A piece declares `name`, `size`, and `draw`; optional fields add state, build stages, parameters, outputs, a seed, a timeline, a soundtrack, an explicitly authored GPU pixel preview, the range of boxes it recomposes to, a box timeline, a film finish, images to draw over, from or after, and [play](#interactive-pieces), which makes the piece answer pointer and key input.

## Render a custom piece

From the repository root with the Node.js 22 runtime pinned in `.nvmrc`:

```shell
node -e "const fs = require('node:fs'); const { renderVector } = require('./core/render.js'); const piece = { name: 'first', size: { w: 200, h: 100 }, outputs: ['raster', 'vector'], draw(g) { g.beginPath(); g.moveTo(20, 50); g.lineTo(180, 50); g.stroke(); } }; const result = renderVector(piece, { seed: 1 }); fs.mkdirSync('out', { recursive: true }); fs.writeFileSync('out/first.svg', result.svg); console.log(result.marks, 'mark');"
```

Expected output:

```text
1 mark
```

The command writes `out/first.svg`, containing one horizontal stroke. The piece is a still because it declares no timeline.

## Entry points

| Function | Contract |
| --- | --- |
| `validate(piece)` | Returns a normalized copy or throws `PieceError` naming invalid or unknown fields. Its `.diagnostic` is `{ code, path }` for a caller that acts on the refusal: `not-object` (`expected` `'object'`, `got` the type read, such as `'array'`), `unknown-key` (`path` `''`, `expected` every known key, `got` the unknown ones), `missing-key` and `invalid-field` (`path` the top-level field, `expected` its `FIELDS` doc), or `conflict` (`path` the field the message names, which is fine alone but not with another one). Every other `PieceError`, from `atBox`, `parseReframe`, `solve` or a play session, has `.diagnostic` `null`. |
| `atBox(validatedPiece, { w, h })` | Returns the piece at another design box it declares in `boxes`, or itself at its own size; throws `PieceError` naming the box and the range it falls outside. Given a list of boxes instead, returns the piece playing that [box timeline](#box-timeline). See [responsive boxes](#responsive-boxes). |
| `solve(validatedPiece, seed, params, options)` | Creates state, applies parameter overrides, and runs named build stages; stage errors are returned in `stages.error`, and a `state()` that throws or returns no object is returned there too, as a stage called `state()` with no stage run. `options.until` names a build stage: `solve` stops after it and returns the state as that stage left it, and a name no stage has throws `PieceError` listing the declared stages. |
| `drawFrame(surface, validatedPiece, solved, t, options)` | Draws onto a Canvas2D-shaped surface at a quantized playhead; `options.scale` controls output scale. |
| `renderVector(piece, options)` | Validates, solves, and renders SVG, returning `svg`, `marks`, `seed`, `t`, `stages`, and `manifest`. |
| `playheads(piece)` | Returns the playheads of every distinct drawn frame, or `[0]` for a still. |
| `renderSound(validatedPiece, solved, options)` | Renders a declared soundtrack on an `OfflineAudioContext`, exactly `frames / hz` seconds long; resolves to the `AudioBuffer`, or `null` without `sound`. |

Import validation and solving from `core/piece.js`; import the rendering functions from `core/render.js`. `renderVector` accepts seed, parameter, playhead, and background options. It throws when a build stage fails or vector output is unsupported. The vector surface that `renderVector` draws on throws on a raster operation such as `drawImage`, `fillText` or `clearRect`, and the error names the operation. It also throws, naming the property, on a composite mode, filter or shadow that SVG paths cannot carry: `globalCompositeOperation` takes only `'source-over'`, `filter` only `'none'`, and `shadowBlur`, `shadowOffsetX` and `shadowOffsetY` only `0`. `shadowColor` takes any value, because Canvas2D draws no shadow without a blur or an offset. Draw an overlap or a shadow as its own shape in the colour it should have, or declare the piece raster-only. Draw letters with [`core/stroke-font.js`](../../core/stroke-font.js) instead of `fillText`: `text()` strokes a line in one of its `faces`, and `display()` draws a filled word with an outline and a shadow, all as strokes. Draw an image under `if (g.canvas)`, so the SVG keeps only the marks; see [images](#images). `renderSound` takes `OfflineAudioContext`, `sampleRate` (48000) and `channels` (2) options; Node has no Web Audio, so a caller outside a browser supplies the context. [`core/film.js`](../../core/film.js) exports films; see [output formats](../knowledge/output-formats.md#mp4).

Do not require [`core/export.js`](../../core/export.js) from a piece. It saves files for the page, the site and the tools. Its PNG, film and `save` functions need a browser document, and a piece also draws where there is none, such as in Node for `npm run examples` and `npm run bench`.

## State and time

Parameters declare `{ min, max, value, meaning }`. Validated values reach drawing code through `state.params`. The short `meaning` describes the parameter's visual effect. It must be a non-empty string of at most 120 characters, or validation refuses the piece. Each declared parameter should affect the output.

A piece with a timeline declares `time: { duration, hz, loop? }`: `duration` is the film's length in seconds, not a frame count, and `hz` is the number of frames drawn per second. A still declares `time: null` or leaves it out.

`draw(surface, state, t, clock)` receives a normalized, quantized playhead. Use `clock.frame` for frame-indexed simulation snapshots instead of advancing state inside `draw`. `clock` also exposes `frames`, `seconds`, `duration` (the declared `time.duration`, 0 for a still), `hz`, and `loop`.

For more than one frame, a looping timeline uses `i/n` and a non-looping timeline uses `i/(n-1)`. A single-frame timeline uses playhead zero. Drawing and export use one frame grid, computed inside Artifex; a piece only receives `t` and `clock` in `draw` and never computes the grid itself.

For fixed source, input data, parameters, output configuration, and execution environment, repeated seed/playhead pairs must produce the same frame. Use addressed randomness from [`core/rand.js`](../../core/rand.js); do not make drawing depend on prior calls or wall-clock time.

## Interactive pieces

A piece that answers a person declares `play` instead of `time`. The registered example [`noughts`](../../examples/noughts.js) is one, a game against a sun in the margin; how to design such a piece is in [interactive pieces](../../skills/artifex/reference/interactive.md) of the runtime skill. The declaration:

```js
play: {
  hz: 60,                        // ticks a second, a whole number from 1 to 240; 60 when left out
  inputs: ['pointer', 'key'],    // what it listens to; both when left out
  step(state, inputs, tick, R) { /* advance one tick; the only code that changes state after the build */ },
  describe(state) { return 'Two marks; the cursor is in column 4.'; },  // optional, one sentence for a screen reader
}
```

A session starts from the solved state at tick 0. Each tick, `step` gets the inputs that landed in it, in order: `{ kind: 'down' | 'move' | 'up', x, y }` in design units, or `{ kind: 'key', key, down }` with the key's `KeyboardEvent.key`. `tick` counts from 1. `R` is `rng(seed)`, the [addressed source](#noise) of the session's seed, so a choice made with `R('opponent', 'move', tick)` is the same on every run. The picture is `draw(surface, state, t, clock)` with `t` the session time in seconds, `tick / hz` plus the part of a tick already passed, and `clock` holding `tick`, `frame` (the same), `seconds`, `hz` and `reducedMotion`. `draw` stays pure in `(state, t)`; game state changes only in `step`.

`clock.reducedMotion` is true when the session was played asking for reduced motion: the page reads the `prefers-reduced-motion` setting once as a session starts, the saved session keeps it as `reducedMotion: true`, and its film and stills draw with it, so the export still shows what was played. Hold idle motion still under it, such as something that turns or breathes on its own; what the player's own input moves stays.

`step` makes sound by pushing cues onto `state.cues.sounds`: `{ tick, name, wet }` with exactly one of `voice`, `pluck`, `impact`, `shaker` or `ambience`, holding the spec that [`core/sound.js`](../../core/sound.js) function takes. `tick` is the tick it plays at, the current one or later; `name` (1 to 64 characters) addresses its seeded noise, so give each cue its own; `wet`, from 0 to 1 (0 when left out), sends it to the session's one room. A build may push cues at tick 0. The list only grows: the session keeps a copy of each row as it is pushed, and a cue of the wrong shape, an earlier tick or a list that shrank stops the session with a `PieceError` naming it. The page plays each cue at once, through the same function, on a context it makes on the first press or key, a few milliseconds late and unlevelled; a browser starts sound only after such a gesture, so cues pushed before it, a build's tick-0 cues among them, are heard only in the exports; a session's film renders every cue offline at its tick and levels the soundtrack as any film's. A session that pushed no cue makes a silent film.

A session is a pure function of the seed, the parameters and the input log, so `step` must read nothing but its arguments: no wall clock, no `Math.random`, no device data. Nothing can prove that of arbitrary code; the browser check catches a fixture that breaks it, as replay catches a film. A piece with `play` takes no `time`, `sound`, `preview` or `boxes`, each refused by name: its length is the session's, one `draw` serves the live page and every export, and a session replays at the box it was played at.

[`core/play.js`](../../core/play.js) runs sessions:

| Function | Contract |
| --- | --- |
| `session(piece, seed, params, { reducedMotion })` | A session at tick 0: `{ piece, solved, state, tick, log, sounds, reducedMotion, advance(inputs), describe(), save() }`. `advance` steps one tick and records its inputs in `log`, moves within one tick folded to the last; an input of another kind or shape, or one the piece does not listen to, throws `PieceError` naming it. `sounds` holds a copy of every cue pushed so far, in order. Drawing `piece` from `solved` at `tick / hz`, with `drawFrame`'s `reducedMotion` option, draws the session. A build that fails throws, naming the stage. |
| `rerun(piece, file, onTick)` | Runs a saved session again from its seed and parameters, calling `onTick(session)` at tick 0 and after every tick; returns the session at its last tick. |
| `checkSession(validatedPiece, file)` | Throws `PieceError` naming the first way `file` is not a session of the piece. |
| `film(piece, file, name)` | The saved session's film: a validated piece with one frame per tick, frame `i` the session at tick `i`, at the session's seed and parameters, with a soundtrack of the session's cues when it pushed any. Every film, still and replay tool takes it as any piece with a timeline. |
| `cueNode(ctx, R, cue, at)`, `renderCues(ctx, R, cues, hz, duration)` | One cue's sound started at `at` seconds, and every cue before `duration` rendered dry and through one room into `ctx.destination`, each input taking at most two, so the same cues render the same bytes. |
| `digest(log)` | The log's digest, `fnv1a32:` and 8 hex digits, as a session's files record it. |

A saved session is the manifest fields (`artifex`, `piece`, `seed`, `size`, `outputs`, `params`) with `hz`, `ticks` and `log`, and `reducedMotion: true` when it was played so. The log is `[[tick, kind, ...values], ...]` in tick order: `[tick, 'down', x, y]`, also `'move'` and `'up'`, or `[tick, 'key', key, down]`. It is data, checked by shape and never run; it holds at most `MAX_EVENTS` (50000) rows over at most `MAX_TICKS` (216000, an hour at 60 ticks a second) ticks. A pointer moving on every tick logs one row a tick, so it fills the log in about 14 minutes at 60 ticks a second. A tick past either cap, like a `step` that throws, stops play in the page with the error shown, and **save session** still writes every tick played before it.

The page plays a piece with `play`: each animation frame advances as many ticks as real time asks, at most four, so a stall drops time rather than replaying it as a burst, and a hidden page advances none: the session holds its tick as the page hides and again as it shows. `npm run film` refuses an interactive piece without `--session`. The canvas takes focus, the primary pointer and the keys (arrows, Enter, Space, Escape and single characters, without repeats; Tab and shortcuts stay with the page). Restart plays again from the same seed with an empty log; **save session** writes `<name>-<seed>.session.json`. `describe` is announced in a live region when its sentence changes. The page's PNG, SVG and film buttons are off while a piece is played, because a frame of a live game names no session to make it again.

`npm run film -- <piece> --session <file>` saves the session's film, one frame per tick at the session's `hz`, and `npm run still -- <piece> --session <file> --at <seconds>` the frame holding those seconds; without `--out`, each is named after the session file. Both refuse `--seed` beside `--session`, and the film refuses `--reframe` and the still `--box`, since a session plays at its own seed and box. Their manifests record `session: { hz, ticks, digest, file }`, with `reducedMotion: true` when the session holds it, and each command puts a copy of the session beside the file it saves. `npm run replay` reads that session beside the file, refuses one whose log or tick count differs from the manifest, then draws the file again from it. Replay is as long as the session, since every tick is stepped, and exact in the engine that recorded it.

## Noise

The noise functions in [`core/rand.js`](../../core/rand.js) take the addressed source `R = rng(seed)`, a point in lattice units, and a field `name`. The same seed, point and name always give the same value. Two names give independent fields, so give each use of noise in a piece its own name; an omitted `name` is `'field'`, and an omitted `octaves` is 4. Scale the point to set the feature size: `noise2(R, x / 80, y / 80, 'grain')` has about one feature per 80 design units.

| Function | Returns |
| --- | --- |
| `noise2(R, x, y, name)` | Value noise in `[0, 1)`. Its slope is zero on every lattice line, so do not differentiate it. |
| `gradient2(R, x, y, name)` | Gradient (Perlin) noise within `0.5 ± sqrt(2)/4`, about `[0.146, 0.854]`, not the full `[0, 1)`. Smooth in value, slope and curvature; use it for gradients, curls and angles. |
| `periodic2(R, x, y, px, py, name)` | `gradient2` that repeats every `px` units across and `py` units down, so tiles placed side by side show no seam. Each period must be an integer from 1 to 65536; any other value throws. In the tile that starts at the origin, away from its right and bottom edge cells, it equals `gradient2`. |
| `fbm(R, x, y, octaves, name)` | Summed octaves of `noise2`, in `[0, 1)`. Each octave is its own field, and each is 2.17 times finer than the last. |
| `turbulence(R, x, y, octaves, name)` | Summed octaves of `gradient2`, each folded about its middle, in `[0, sqrt(1/2)]`. The folds leave sharp creases between soft billows, as in smoke or marble. Octaves follow `fbm`'s rule. |
| `worley2(R, x, y, name)` | Cell (Worley) noise from one seeded point per lattice cell, as `{ f1, f2, id }`. `f1` is the distance to the nearest point, below `sqrt(2)`; `f2` is the distance to the second nearest, below 1.81, and never less than `f1`. `id` is an integer that names the nearest point's cell. |

`worley2` draws a Voronoi diagram. `f1` is zero at each point and grows towards the cell edge. `f2 - f1` is zero exactly on the edge between two cells, so a small threshold on it draws cracks. `id` is the same for every point one cell owns: `R('tile', 'hue', id)` gives each cell its own colour.

Only `noise2` and `fbm` fill `[0, 1)`. To map any value to another range, use `remap(v, inLo, inHi, outLo, outHi)` from [`core/num.js`](../../core/num.js).

## Responsive boxes

`size` is the design box a piece draws at. A piece that declares `boxes: { w: [min, max], h: [min, max] }`, in design units, accepts any box in those ranges and lays itself out for it; `size` must lie in them and is the box used when nobody chooses one. `boxes` defaults to `null`: such a piece draws only at `size`, as before, and its state gets no box.

`atBox(piece, { w, h })` returns a copy of the validated piece whose `size` is that box. Everything that reads `size` then takes the box: `solve`, `drawFrame`, `renderVector`, the page's canvas and its PNG, SVG and film exports, and the manifest, which records it as `size`. `solve` sets `state.box = { w, h }` before the build stages run, so stages and `draw` compose for the box rather than stretching one composition. A box outside the ranges, or any box but its own size for a piece without `boxes`, is refused by name.

```js
const { validate, atBox } = require('./core/piece.js');
const { renderVector } = require('./core/render.js');

const piece = validate(require('./examples/refit.js'));
const tall = renderVector(atBox(piece, { w: 405, h: 720 }), { t: 1 });
tall.manifest.size;   // { w: 405, h: 720 }
```

The box is chosen per export: a film is drawn at one box, or along a [box timeline](#box-timeline) inside one frame, because a film's frame size cannot change while it plays. The built page shows width and height sliders for a piece that declares `boxes`, rebuilds as they move and keeps the box in its address bar as `box=WxH`; `__artifex.setBox(w, h)` does the same from a script. The page's live player, `?player=1`, shows the piece alone, fitted to the window: a piece with `boxes` that plays no [box timeline](#box-timeline) takes the window's box, held inside its ranges, and recomposes on every resize without stopping playback; any other piece is scaled whole. It starts playing at once unless the piece has a soundtrack, which waits for a click or key because a browser starts sound only inside a gesture. The player was checked by hand on one Android phone: it recomposed on rotation without stretching and kept playing, paused and resumed on a tap, and started a soundtrack on the first tap. It has not been checked on iOS. `npm run seeds -- <piece> [count] [playhead] --box WxH` draws a contact sheet at a box, and `npm run replay` draws a file again at the box its manifest names.

[`examples/refit.js`](../../examples/refit.js) fills a container that takes the box less a fixed margin with things that are never scaled down, so a box no roomier and no taller than the default holds fewer of the same things at their size. Every thing is scaled by one factor, the same for all of them: the square root of the ratio of the container's room to the default box's, times the fourth root of the ratio of its height to the default's, where that comes to more than one, and one where it comes to less. No box scales the things down, and the factor changes with the box without a jump. A roomier box holds bigger things, its largest box about half as many as the default box; a taller box holds bigger things too, because a thing takes more frames to fall and settle through it, even a box narrower than the default with less room; a box no roomier and no taller than the default keeps the things at their size and holds fewer. A film scales them for the roomiest box its [box timeline](#box-timeline) visits, never for its frame, which is never shown, and the factor never passes what the smallest box the timeline visits can take, one of the smallest things high with the clearance a release needs, so a film that visits a small box is not emptied of things too big for it. The solve's cost is the number of things the sim steps by the frames it steps them through. A thing in free fall above everything it could touch is stepped outside the sim until it comes within reach of the pile; once every thing has landed in a still box, only what still moves is simulated, with what it could reach, until nothing in the pile moves a unit a frame, and the pile is then held. Measured in Node on one desktop machine under load, at the smallest grain and the strongest grip, the default box solves in about three seconds, give or take the fifth that a pile's last second of settling varies by; the wide short boxes whose factor comes to about one, which hold up to an eighth more things than the default box, take up to a tenth or so longer, and every other declared box less. The film along its own timeline is not bound by that: it simulates the whole pile on every frame on which its box moves, and takes longer at the smallest grain than any still box does. The walls and the floor are three [moving walls](#moving-walls) of `core/sim.js`. Run `node --test tests/piece.test.js` for the `boxes`, `atBox` and `state.box` contracts, and `node --test tests/examples.test.js tests/replay.test.js tests/contact-sheet.test.js` for refit, replay at a box and `--box`.

### Box timeline

A film can change its box while it plays. A piece that declares `boxes` and a timeline can also declare `reframe`: a list of two or more boxes, each `{ t, w, h }`, at strictly increasing playheads `t` in `[0, 1]`. Every box must lie in the `boxes` ranges. The film's frame stays the largest box, the widest width by the tallest height, and `size` must equal it, so every frame of the film has one size.

```js
reframe: [
  { t: 0, w: 1280, h: 720 },     // wide
  { t: 0.34, w: 1280, h: 720 },  // held
  { t: 0.56, w: 405, h: 720 },   // portrait, centred in the 1280 x 720 frame
],
```

The box holds before the first entry and after the last. Between two entries it moves from rest to rest, by `ease.smooth`, centred in the frame. Two entries at the same playhead are refused, so the box never cuts from one size to another.

The piece does the recomposing, because only it knows which of its elements is which:

- `solve` sets `state.box` to the frame and `state.reframe` to a copy of the list, so a build stage can lay the piece out once at each box, as it would lay out that box alone.
- `drawFrame` passes `clock.box = { w, h, x, y, from, to, u }`: the box's current size, its top-left corner in the frame, the indices of the two entries it is between, and how far it has got, `u` from 0 to 1, linear in the playhead. Draw each element from its place in layout `from` towards its place in layout `to`, so it travels there rather than jumping.
- The piece also paints the whole frame, including the part outside the box. Nothing in `core/` clips the drawing to `clock.box`, so the area around a smaller box shows whatever the piece draws there, and the film shows that area too. How to paint it is the piece's choice; a box that marks another time wants one plain colour (see [films](../../skills/artifex/reference/films.md)).
- A piece without `reframe` gets no `state.reframe` and no `clock.box`, and its recipe and files do not change.

The recipe records the list as `reframe`, and `npm run replay` draws the file again along the list it names. `atBox(piece, [{ t, w, h }, ...])` plays another list; one box, `atBox(piece, { w, h })`, replaces the list, even at the piece's own size. The page plays the piece's own list until its width or height slider moves, and names a box in its address bar only when one replaces the list.

To play another list, write it as `t:WxH` entries separated by commas, such as `0:1280x720,0.5:405x720,1:720x720`. The page reads it from its address bar as `reframe=`, and `__artifex.setReframe([{ t, w, h }, ...])` plays a list from a script. `npm run film -- --reframe` and `npm run seeds -- --reframe` take the same text; see [command-line tools](../knowledge/command-line-tools.md#saving-a-film). `parseReframe(text)` in `core/piece.js` reads the text into a list and refuses by name an entry not written `t:WxH`; `atBox` then refuses by name a list the piece cannot play. The page shows that refusal as its error and keeps the piece's box. The address bar names a list chosen this way, and never the piece's own list.

The live player, `?player=1`, plays a list, the piece's own or the address bar's, with its frame fitted whole into the window. A piece without a list takes the window's box, as before; so does a link that names `box=`.

[`examples/refit.js`](../../examples/refit.js) declares a list that goes from wide to portrait to square. Its build fills the container once: things rain in from above the frame while there is room for the smallest of them, each over the run of columns, a small thing wide each, with the most room for it, a thing too big for the room there is now being passed over, so a short box takes the things that fit it; once no run of columns has room, the container is full and stays full while the box stands still, though the pile packs closer as it settles, and [`core/sim.js`](../../core/sim.js) solves the pile frame by frame, the walls and the floor being three of its [moving walls](#moving-walls) that follow the box, so `draw` only looks up the frame; a still box's pile is held once it is at rest, nothing in it moving a unit a frame, and never before. A container a few of its biggest things wide packs looser than a wide one, and the fill counts on less of its room there, so it is not overfilled by things that then land over the rim. To decide whether the container is full, the build counts the things still falling in as the height they will add to the columns under them. A falling thing covers more columns than its own width, by up to a column on either side. A wide container counts the thing's whole height on each of those columns, which leaves room for the heap that a rain piles where it lands. Things that grip little cannot heap in a narrower container, so there the thing's area is spread over the columns it covers: none of it at three of its biggest things wide, all of it at one, and in proportion between; and all of that at the default grip, 0.25, and under, none of it at a grip of 0.5 and over, and in proportion between, since things that grip more heap up the walls. So a channel barely wider than its biggest things, declared full while its drops are still in the air, lands nearer the rim than a count of their whole height leaves it: on the timeline of its test in `tests/examples.test.js`, a 405 by 1920 box held still and then widened to the largest box, it lands within the room one more of the smallest fourth of its things would need. The rain stops in time for its last drop to land before the box next narrows, so the walls never close under a rain, and a box that narrows releases nothing, because the walls would squeeze out what it let in; it squeezes the pile: a thing climbs over its neighbours to the nearest place that holds it, and what no longer fits shrinks away, as described below, kept inside the walls, and inside the box, as they close: a thing that comes to rest with its centre over the rim, or a landed thing the closing walls push up through the pile so that it pokes over the rim. Nothing is taken in mid-air: a thing falling in is never taken, even as it bounces off the pile, because it lands first; a landed thing that the squeeze flings up flies on until it touches the pile again, or a wall where it is drawn, and goes there, since the sim's wall lines reach on up over the box to keep it inside but no wall is drawn there. A thing over the rim goes only while its contact reaches the floor or a drawn wall: it is within a touch of one, or of a thing that is, and so on from thing to thing, so two things flung up together that touch only each other both fly on. One flung up out of the frame goes out of sight. A thing that goes shrinks away over five frames from its lowest contact, so it never floats off what held it. Of the things it touches when it goes, the floor, a wall where it is drawn or another thing, the build records the one whose contact point is lowest, and `draw` keeps the shrinking thing touching it at that contact, as far from it as when it went. When that lowest contact is another thing that goes on the same frame, the build first waits for that thing to get its own contact. If the things that go on one frame wait only on each other, the first of them that touches something settled, the floor, a wall, a thing that stays or one that already has its contact, takes the lowest of those instead, and each thing on the way from it, from lowest contact to lowest contact up to where that way loops back, takes the thing before it; the loop then takes its own lowest contacts in turn. So a thing takes a contact other than its lowest only when its lowest is a thing that shrinks from it, directly or through others, and two things that go together never each shrink from the other, tied to nothing else. On the floor, it shrinks down to the floor. Against a wall, it shrinks towards the wall, and at the wall's lip once the lip comes down past the contact. On a thing, it stays touching that thing's drawn disc at the angle where they touched, and moves with that thing, whether the thing is whole, shrinking away too or still growing; a thing still growing is followed where it is drawn, as it slides along what holds it. The shrinking thing is then kept inside the walls, and inside the box if it went inside it. Only the drawing changes: the solved frames and the count each frame shows stay the same. Nothing falls in only to vanish: while a box widens, every thing that arrives stays, and so does every thing in a still box, except that a still box whose things grip more than the default 0.25 might, in rare boxes, lose one or two things (a known limit; the piece's own film loses none). A box that widens lets the pile relax towards the wall that moved, keeping its order, and the room it opens fills without a rain: nothing falls in after the first fill. Instead, the next things appear in index order. While the box moves, as many appear in a frame as find a place; once it stops, as many as a still box's rain would bring, looking at up to three times as many things as it may take. A thing that no place takes waits, and is tried again first on the following frames, up to three a frame, oldest first, because the places a big thing needs open later than a small one's. When more than nine things wait, the oldest is passed over for good. Without that wait, the big things were passed over and a widened box ended with a heap of small things half as high as a fill at that size. On the timelines of the growth test in `tests/examples.test.js`, its own film and four widenings, the widened box ends holding whole things over at least four fifths of the area that a box filled at that size holds them over, and at least nine tenths of it after a widening that stops, or that narrows and then holds still, or from a tall narrow box, whose slumped column keeps flowing to the end of the film. A very fast widening, or one another test plays, may end short of that. Each appears in the deepest place where it rests without overlapping anything: in a corner of the floor, on the floor beside a thing, against a wall that stands still on a nearly still thing, or cradled between two things. A pile that a widening box lets slump keeps flowing, so a thing that appears on it moves with it; one that appears on the floor starts with the floor's motion, so it stands on the floor while the box grows taller and the floor descends. Things that hold it, the one beside a wall as much as the two of a cradle, must have landed, move no faster than a landed thing, and be at least a quarter its size as they are drawn now. A whole thing always is, the biggest thing being less than four times the smallest, so a big thing can find a place on a heap of smaller ones; the rule only keeps a thing in its first frames of growth from holding things much bigger than it is drawn. Two things that cradle it must move together, within two units a frame of each other, sit lower than its centre, leave a gap between them clearly narrower than it, and not be drawing apart fast enough to spread that gap by two units while it grows; it starts with their motion. A place in the path of a thing it does not touch, moving towards it so that it would run into it while it grows, is passed over: under a thing still sinking, or beside one that the slumping pile carries along; of the things a place touches, only the neighbour of a place on the floor may be creeping towards it, since a wall's thing stands nearly still and a cradle's two move together, so the pile may nudge a thing born on the floor along it. The exception is a neighbour that stands over the floor place, its centre higher than the place's top, and sinks towards it by more than a unit a frame: the place is then passed over, because a big thing slumping onto a place under its overhang would crush what grows there. It then grows from nothing to its size in that place over five frames, the reverse of how a thing that no longer fits shrinks away: one on the floor grows up from its lowest point, so it stands on the floor at every size; one held by things grows from its contact with the last-born of them, drawn touching that holder's drawn disc, whole or itself still growing, at the angle it touches it whole and as far from it as whole, so it neither hangs over a holder drawn small nor over the gap of a cradle, nor sinks into what holds it, and slides along that holder into its place as it grows. `draw` moves it straight there from where it would grow alone, and stops it short where it would end nearer another holder than whole, in anything else drawn, a holder shrinking away included, or in the floor, so it rests on what stops it; the way itself is never drawn, so it may skim a holder it ends clear of, and a thing it already starts in does not hold it back, a solved pile leaving only overlaps of a hair. A thing that shrinks away from the growing thing, directly or through others, does not stop it either, because that thing moves with it. On the growth test's timelines the way never ends in anything, so no test pins that stop. Holders are placed before what rests on them, so a chain of them rests as drawn. This changes only the drawing: the solved frames, and the replay manifest, are the same. Its weight grows with its area, so it rests on what holds it without pushing it apart. On the same timelines, nine in ten of these things stay within two units of what holds them while they grow, and none sinks twenty units below it; a fast widening may lift a growing thing off what holds it. A thing whose area would take the things it holds past the area its pile can fill is passed over; that cap is set by the container's size and how loosely a pile packs in it. A still box counts as full once its pile is at rest and no place is left, or once the things it holds take all of that area. A box that moves while the container is still filling follows the same rule, because arrivals and walls are both functions of the frame: a box that narrows before the first things could land releases nothing until it stops, and a box that widens before the container is first full keeps the rain going, since the first fill ends the first time the container is full while its box stands still. Its last drops may still be falling then: nothing is released after it, whatever the box does, and nothing grows until they have landed, so nothing grows in a place where a thing still falling in could land on it. Nothing grows within five frames of a coming narrowing either, as the rain stops before one: a thing the walls squeezed out while it grew would pop, its shrink starting from its full size. Nothing falls out of the bottom of the frame, and nothing rises on its own. Run `node --test tests/piece.test.js` for the `reframe` rules and `clock.box`, `tests/examples.test.js` for refit's fill, squeeze and arrivals, and `tests/replay.test.js` for replay along a list. To see the film, run `npm run film -- refit` and `npm run replay -- out/refit.mp4`.

## Authored time

[`core/time.js`](../../core/time.js) shapes motion over the playhead without knowing what moves.

| Helper | Contract |
| --- | --- |
| `span(a, b, x)` | Where `x` sits in the window `[a, b]`, as `[0, 1]`, held at both ends. The three values share one unit: playhead, seconds or frames. A zero-length window is a cut: `0` before `a`, `1` from `a` on. A window with `b < a` or a non-finite value throws. A window reaches `1` only if it closes by the last frame's playhead, which is `1` on a timeline that does not loop and `(n - 1) / n` on one that loops, where `n` is `clock.frames`; close it by then, as [`examples/drift.js`](../../examples/drift.js) does with `span(st.birth, Math.min(st.birth + st.span, 1), t)`, or count in frames and close it by `clock.frames - 1`. |
| `ease.<name>(u)` | A rate curve: how far a move has got after `u` of its time. `linear`; cubic `in`, `out` and `inOut`; `smooth`, the smoothstep; `back`, which passes its mark by about 10% and settles; and `bump`, which rises to `1` at the middle and returns to `0`. Outside `(0, 1)` each returns its end value exactly. The table is frozen. |
| `tween(a, b, rate)` | The function `x => rate(span(a, b, x))`, so a timed move is one value that `draw` and `sound` can both read. Any function of `[0, 1]` can be the rate. |
| `keys([[at, value, rate], ...])` | A function of the same unit as `at`: passes through each value at its `at`, and moves to the next key at the rate this key names, or straight when it names none. See [key tracks and gaits](#key-tracks-and-gaits). |
| `flow([[at, value], ...])` | A function of the same unit as `at`: passes through each value at its `at` without stopping there, on a smooth curve that never leaves the range of the two keys around it. See [key tracks and gaits](#key-tracks-and-gaits). |
| `gait(start, lengths)` | A function of the same unit as `start`: counts steps, the whole part being the step under way and the fraction how far through it. `contacts` lists where each step begins. See [key tracks and gaits](#key-tracks-and-gaits). |
| `drawingAt(clock, n)` | The drawing a frame shows when each drawing is held for `n` frames, `2` (the default) on twos and `3` on threes: `{ seconds, index }`, the time of the hold's first frame and the drawing's count from `0`. `clock` is the `draw` clock or any `{ frame, hz }`. Read a held subject's pose at `seconds` and seed its marks by `index`; keep the camera on `clock`. A still's clock (`hz` 0 at frame 0) gives the first drawing, `{ seconds: 0, index: 0 }`. A looping film keeps every hold whole only when its frame count is a multiple of `n`. See [films: pace](../../skills/artifex/reference/films.md#pace). A missing frame throws `TypeError`; a rate that is not positive (outside a still's clock), or an `n` that is not a whole number of frames from `1`, throws `RangeError`. |
| `bars({ bpm, beats, start, swing })` | A beat grid: `seconds(bar, beat)` is the second a bar and beat sit at, `beat` fractional for subdivisions and past the bar for the next, swung off-beats when `swing` is above 0 (two thirds through the beat at 1); `frame(bar, beat, hz)` is the nearest whole frame, rounded as `shots` rounds a cut, so a cut on a bar line shares the beat's frame. `beats` defaults to 4, `start` (the second of bar 0 beat 0) to 0 and `swing` to 0; the grid carries all four. Frozen. Invalid values throw `RangeError` or `TypeError` by name. See [music](../../skills/artifex/reference/music.md#the-beat-grid). |
| `euclid(k, n, rotation)`, from `core/score.js` | `k` onsets spread as evenly as `n` steps allow, as a list of `n` true and false; `rotation` (default 0) starts it that many steps later. `euclid(3, 8)` is `x..x..x.`. |
| `tones(chord)`, `shift(chord, moves)`, from `core/score.js` | A triad is `{ root, minor }`, `root` a pitch class from 0 to 11. `tones` gives its three pitch classes. `shift` takes a string of moves, each keeping two notes and moving the third by a tone at most: `'P'` to the parallel (C major to C minor), `'R'` to the relative (C major to A minor), `'L'` the root down a semitone (C major to E minor). |
| `lead(from, chord)`, from `core/score.js` | Where each voice goes for the next chord with the least motion: `from` is the voices' MIDI notes, low to high, `chord` the pitch classes to reach. Every voice lands on the chord, every pitch class sounds when there are voices enough, no voice crosses another, and the moves sum to the least there is. Returns the new notes; `hertz` of `core/sound.js` gives each its frequency. |
| `barCuts(lengths, { bpm, beats, start })`, from `core/score.js` | Shots as long as whole bars, so every cut lands on a downbeat: each of `lengths`, in seconds, is rounded to the nearest whole number of bars, never under one. Returns `[{ bars, start, end }]` in seconds. See [music](../../skills/artifex/reference/music.md#a-score-by-rule). |
| `extendChord(chord, kind)`, `scale(root, mode)`, from `core/score.js` | `extendChord` gives a triad's pitch classes with an extension, root first: `kind` is `'triad'`, `'sus2'`, `'sus4'`, `'6'`, `'7'` (the default), `'maj7'`, `'add9'`, `'9'`, `'m7b5'` or `'dim7'`. `scale` gives `mode`'s pitch classes over `root`, a pitch class from 0 to 11: `'major'` (the default), the church modes by name, `'minor'`, `'harmonic-minor'`, `'melodic-minor'`, `'pentatonic'`, `'minor-pentatonic'` or `'whole-tone'`. Either feeds `lead`. An unknown kind or mode throws `RangeError` and lists the names. |
| `express(notes, { R, name, tonic, arch, humanize })`, from `core/score.js` | New note events, `[{ at, note, ... }]` with `note` a MIDI number, each given a `velocity` and a `tension`. Velocity swells toward the phrase's middle by `arch` (from 0 to 1, default 0.25) and rises with the note's distance from `tonic` (a pitch class, default 0), the tritone highest. With `R`, each onset moves by up to `humanize` seconds (default 0.008, at most 0.1) and each velocity by up to 0.06, addressed `R(name, 'timing', i)` and `R(name, 'accent', i)`; `name` defaults to `'phrase'`. Velocity stays from 0.05 to 1 and `at` never goes below 0. |
| `shots(list, timeline)` | Resolves `[[name, seconds], ...]` onto the whole frames of a `clock` or a sound `timeline`. Returns frozen `{ name, index, start, end }` objects; `end` is exclusive. Each shot needs its own name: a list that gives two shots one name, such as `wide`, throws `RangeError` with `shots: "wide" names two shots; give each shot its own name`. |
| `shotAt(film, frame)` | The resolved shot that holds a whole frame, found by integer comparison. |
| `spring({ stiffness, damping, delay })` | A function of seconds since a cue: how far a part released on a damped spring has got towards its mark, from `0` at rest to `1`. See [springs and followers](#springs-and-followers). |
| `follow(driver, { stiffness, damping, delay })` | A function of seconds since a cue: where a part hung on a spring behind `driver` sits. It trails a moving driver, passes it when the driver stops and settles on it. |

Each cut lands on the frame nearest its time, `round(hz * elapsed)`, and shots are compared as integers. A boundary summed in seconds can land a float either side of a frame: `0.1 + 0.2` is not `0.3`. The frame at `start` is the cut into a shot. The list must fill the timeline exactly, and each shot must hold at least one frame. A still has no shots. Each violation throws `RangeError` by name; a malformed list or entry throws `TypeError`. Each name must be unique: to cut back to an earlier shot, give the return its own name, such as `wide-2`. Resolve the same list with `clock` in `draw` and with `timeline` in `sound`, and picture and sound cut on the same frame.

Within a shot, `span(shot.start, shot.end - 1, clock.frame)` runs from `0` on its first frame to `1` on its last. `(clock.frame - shot.start) / (shot.end - shot.start)` is the fraction of the shot's time instead; it reaches `1` only at the next cut. A cut is always a hard cut: the module has no transitions.

The samples on this page require `artifex/core/...`, which the Artifex tools resolve for a piece they load; a plain Node `require` does not, so load such a piece with `loadExternal` ([external pieces](../knowledge/command-line-tools.md#external-pieces)).

```js
const { ease, tween, shots, shotAt } = require('artifex/core/time.js');

const SCORE = [['wide', 2], ['close', 1.5]];   // fills the 3.5-second timeline
const rise = tween(0.25, 1.25, ease.out);      // timed in seconds

const piece = {
  name: 'two-shots',
  size: { w: 400, h: 300 },
  outputs: ['raster', 'vector'],
  time: { duration: 3.5, hz: 24 },
  draw(g, state, t, clock) {
    const shot = shotAt(shots(SCORE, clock), clock.frame);
    g.fillStyle = '#f4f1e8';
    g.fillRect(0, 0, 400, 300);
    g.translate(200, 150);
    if (shot.name === 'close') g.scale(2, 2);   // the cut changes the framing
    g.fillStyle = '#1b1b1b';
    g.beginPath();
    g.arc(0, 60 - 120 * rise(clock.seconds), 20, 0, Math.PI * 2);
    g.fill();
  },
};
```

[`examples/readout.js`](../../examples/readout.js) cuts a reading and a one-second rest on whole frames, and schedules its notes from the same shots. [`examples/drift.js`](../../examples/drift.js) times each stroke with `span`. [`examples/cues.js`](../../examples/cues.js) writes its moves (`tween` at named rates), its bumps (`ease.bump`, including a blink) and its scene changes into one cue table in its build; `draw` and `sound` read only that table. Each scene change starts on its `shots` boundary and turns the parts one after another over a short blend, or all at once at `blend: 0`. Run `node --test tests/time.test.js` for the span, rate, tween, key track, gait, shot, beat grid, spring and follower contracts.

The [film scaffold](../../skills/artifex/film-scaffold.cjs) keeps a cue table in `s.cues` too. Its optional `blocking` rows, `{ shot, marks, line, cross }`, give each shot's subject marks in design units and the two marks its line of attention runs between; `npm run seeds -- <piece> --plan` draws them and flags a shot that shows the line from the wrong side unless its row has `cross: true`.

A scaffold sound row can also carry `gain`, a list of `[seconds, gain]` keys from the film's start that make the row's whole level (dry and room) follow the picture. The level ramps linearly between keys and holds the first key's gain before it and the last key's after it; a gain of 1 leaves the row as its voice or ambience sets it. Keys round to whole frames after THE TEMPO, as `at` does. The build refuses a `gain` that is not a list of keys, a key that is not a pair of two numbers of 0 or more, keys out of order (list them in time order, a frame or more apart) and keys that land on one frame (move them a frame or more apart). The music warning reads each row's level after its gain keys. See [what the scaffold's build refuses](../../skills/artifex/reference/films.md#build-the-film-in-order).

### Springs and followers

A rate curve arrives when its window closes. A spring arrives when its physics lets it: a part with weight gets there late, passes its mark and rings, or creeps in. Both helpers take seconds since a cue, such as `clock.seconds - 1.5` or the seconds since a shot's first frame, and both are pure: the same time gives the same value however the playhead arrived.

- `stiffness` is in 1/s² for a unit mass: `sqrt(stiffness)` is the natural frequency in radians a second, so four times the stiffness is twice as quick.
- `damping` is the damping ratio. Below `1` the spring is under-damped: it passes its mark by `exp(-damping * PI / sqrt(1 - damping²))` of its travel at its first peak and rings. At `1` it is critical: the quickest arrival that never passes the mark. Above `1` it is over-damped and creeps in without passing it.
- `delay` defaults to `0` and holds the part at rest for that many seconds after the cue.

`spring(opts)(s)` is `0` for `s` up to `delay` and leaves from rest after it. Its `settle` property is the time since the cue from which the value stays within 0.1% of `1`, delay included; schedule the next beat after it. Long after the cue the value is exactly `1`, for any finite time. A part kicked off its mark at the cue and coming back to rest, a recoil, is `s < 0 ? 0 : 1 - spring(opts)(s)`; with a delay it holds the kicked pose first. Scale either with `lerp`, as a tween's value is scaled. The returned function is frozen.

`follow(driver, opts)(s)` reads `driver`, any function of seconds since the same cue, `delay` seconds late: a tween, a spring or another follower. The part is at rest on its driver at the cue and sits on the driver before it. Drag holds it `2 * damping / sqrt(stiffness)` seconds of travel behind a driver moving at a steady speed; when the driver stops, the part passes it unless heavily damped, then settles on it. A driver at rest keeps the part on it exactly. Each call steps from the cue at 240 steps a second, reading the driver once a step and taking it as straight between steps, and carries the spring exactly across each step, so a call's work grows with `s`: about 0.07 ms for 10 seconds in Node. Keep cues within the film.

Every invalid stiffness, damping, delay, driver or time throws by name, such as `spring: damping must be a positive, finite ratio, got 0; 1 is critical`. Neither helper allocates per call.

```js
const { lerp } = require('artifex/core/num.js');
const { ease, tween, spring, follow } = require('artifex/core/time.js');

const body = tween(0, 0.8, ease.inOut);                               // seconds since the cue
const tail = follow(body, { stiffness: 150, damping: 0.4, delay: 0.05 }); // arrives late, overshoots
const land = spring({ stiffness: 220, damping: 0.35 });               // a landing that rings

// In draw, with the cue at 1.5 seconds:
const s = clock.seconds - 1.5;
const bodyX = lerp(80, 320, body(s));
const tailX = lerp(80, 320, tail(s)) - 30;
const hit = s - 0.8;                                                    // the move lands
const squash = 1 + 0.2 * (hit < 0 ? 0 : 1 - land(hit));                 // and recoils
```

### Key tracks and gaits

A tween moves between two values. A key track strings many: the poses a part must hit, the breakdowns between them and the holds, on one line per part. A gait counts the steps of a walk or a run, so the picture and the footsteps read one schedule.

`keys(list)` takes `[at, value]` or `[at, value, rate]` entries in time order:

- `at` is a time in the unit the track is read in: frames, such as `clock.frame`, or seconds. Two keys may share an `at`; a key may not come before the one listed ahead of it.
- `value` is a finite number. Each value is exact on its key.
- `rate` is the rate curve from this key to the next, such as `ease.out`. Without one the move is straight. The last key's rate is never used.

Two keys with one value are a hold. Two keys at one `at` are a cut: the earlier value before that moment, the later value from it on. Before the first key the track holds the first value, and after the last key the last value. The list is copied, so changing it afterwards does not change the track. The returned function is frozen.

`flow(list)` takes `[at, value]` entries, with the same rules for `at` and `value`, and strings them on one smooth curve instead of a separate move per key. With `keys`, an eased key brings the part to rest on every pose and a straight key changes its speed there at once; a flowing track carries its speed through each key, slower where the poses are close and faster where they are far apart. At each key its slope is a weighted harmonic mean of the straight slopes either side, so between two keys it never passes outside their two values: it does not overshoot, and two keys with one value are a hold that stays still. Where the track turns back, at the ends and on each side of a cut, it is at rest. With two keys it is `ease.smooth`. A key takes no rate, and an entry with one is refused. Every other rule, and every refusal, is as for `keys`, with `flow:` in place of `keys:`.

`gait(start, lengths)` takes the time the first step begins and the length of each step, in one unit. Lengths may differ, as when steps quicken. The returned function answers `0` before `start`, then the step count: `2.25` is the third step, a quarter of the way through. After the last step it answers `lengths.length`. Within a step the count rises straight with time; shape each part's move with a key track over the fraction. `contacts` is the frozen list of step boundaries, from `start` to the end of the last step, in the same unit.

Count a gait in frames and read it with `clock.frame`. Lengths in seconds are summed as decimals, so a contact can land a hair after the frame that should show it: `0.1 + 0.2` is not `0.3`. The picture then turns the step one frame after its footfall. In frames, whole lengths give whole contacts, and the sound finds each one at `contact / timeline.hz`.

Every invalid list, key, rate, length or time throws by name, such as `keys: entry 2 at 3 comes before entry 1 at 5; list keys in time order`.

```js
const { keys, gait, ease } = require('artifex/core/time.js');

// A walk of four 12-frame steps from frame 24, then two quicker ones.
const walk = gait(24, [12, 12, 12, 12, 10, 10]);
// The hips over one step: lowest a quarter through, highest three quarters.
const hips = keys([[0, 0, ease.out], [0.25, -1, ease.inOut], [0.75, 1, ease.in], [1, 0]]);

// In draw:
const w = walk(clock.frame);
const hipY = 300 - 4 * hips(w % 1);   // the fraction is the step's phase
const leftLeads = Math.floor(w) % 2 === 0;

// In sound: a footfall on every contact after the first.
for (const frame of walk.contacts.slice(1)) {
  const at = frame / timeline.hz;
  // start the footfall voice at `at`
}
```

[`examples/stride.js`](../../examples/stride.js) walks a jointed figure this way. The legs, the hips and each arm's swing read key tracks over the phase of one gait: the hips sink and rise, each foot turns about its heel as it lands and about its toe as it leaves, and the arms swing against the legs. The chest, head, forearms and hands each hang on a damped spring behind those keys, so they lag, carry on past and settle after every contact. The camera follows the hips' mean pace, averaged over about two steps, so it does not change speed at each contact. Each contact after the first plays a footfall on its frame. Run `node --test tests/examples.test.js --test-name-pattern stride` to check that a planted foot never slides, the camera eases across contacts, the upper body overlaps the keyed walk, and each footfall sounds on the frame its heel lands.

The runtime skill's [plan poses before motion](../../skills/artifex/reference/films.md#plan-poses-before-motion) orders key, extreme and breakdown poses to start from ([walks and runs](../../skills/artifex/reference/films.md#walks-and-runs) has the step timings and [takes and accents](../../skills/artifex/reference/films.md#takes-and-accents) the take charts), and a person or creature is [painted over a hidden mannequin](../../skills/artifex/reference/films.md#paint-over-a-hidden-mannequin) rather than built from hinged parts. [Hinged figures](../../skills/artifex/reference/films.md#hinged-figures) covers machines, puppets, cut-outs and styles that show their joints, like the one above.

### Key outlines

A key track's value can also count through key outlines: one closed or open outline per pose, each traced with the same points in the same order. Both functions come from `artifex/core/geom.js`.

| Function | Contract |
| --- | --- |
| `keyOutline(keys, v)` | `keys` is an array of at least two outlines with the same point count. `v` is a finite number. The floor of `v` picks the pair of keys and the fraction blends them point by point: `1.25` is a quarter of the way from key 1 to key 2. Each key comes back exactly on its whole value, and a value below 0 or above `keys.length - 1` holds the nearer end key. Returns new points; the keys are not changed. |
| `keyOutline(keys, v, weights)` | `v` is an array of track values, and `weights` holds one row per point, each row one non-negative number per track value with a positive sum. Point `i` reads the weighted mean of the values, `Σ w[i][j] · v[j] / Σ w[i][j]`, then blends as above. |
| `keyFaults(keys, { ratio, steps = 2, close = true })` | Samples `keyOutline(keys, s / steps)` for every whole `s` from 0 to `(keys.length - 1) * steps`, so the default looks at each key and each blend's middle. Span `i` joins point `i` to the next; `close` adds the span from the last point back to the first. Returns every `{ type: 'cross', at, spans: [i, j], point }` where two spans that share no point meet, in sample order, then every `{ type: 'stretch', at: [k, k + 1], span, ratio }` where a span's longest length over the samples from key `k` to key `k + 1` is more than `ratio` times its shortest. Returns `[]` when there are none. `ratio` is required and must be a finite number above 1; `steps` must be a positive integer. |

`keyFaults` misses a crossing that falls between two samples; a larger `steps` samples finer. It costs O(points²) per sample, so run it in a test or a build stage, never in `draw`. Every invalid key list, value, weights row, ratio or step count throws by name, such as `keyOutline: key 1 has 3 points, key 0 has 4; trace every key with the same points in the same order`.

```js
const { keyOutline, keyFaults } = require('artifex/core/geom.js');

const rest = [[0, 0], [10, 0], [10, 10], [0, 10]];
const reach = [[0, 0], [14, -2], [12, 12], [0, 10]];
keyOutline([rest, reach], 0.5);   // [[0, 0], [12, -1], [11, 11], [0, 10]]

// Points 0 and 1 follow the first track, 3 the second, and 2 halfway between.
keyOutline([rest, reach], [1, 0], [[1, 0], [1, 0], [1, 1], [0, 1]]);

keyFaults([rest, reach], { ratio: 1.5 });   // [] when no blend crosses or stretches
```

The runtime skill's [paint over a hidden mannequin](../../skills/artifex/reference/films.md#paint-over-a-hidden-mannequin) draws a figure from key outlines this way. Run `node --test tests/geom.test.js` for the key-outline contracts.

### Depth armature

A depth armature poses any jointed thing in 3D, such as a limb, a crane arm, a tail or a branch, and projects it to the picture. Each segment has a length and a radius at each end. All four functions come from `artifex/core/armature.js`; they are pure and draw nothing. World points are `[x, y, z]`. With the default view, picture `x` is world `x`, picture `y` is world `y` (growing down, as on a canvas), and `z` is depth, growing away from the viewer, so `-z` points toward the viewer.

| Function | Contract |
| --- | --- |
| `pose(root, base, segments)` | Chains `segments` from `root`, each `{ length, radius: [r0, r1], bend = 0, twist = 0 }`: `length` above 0, both radii not below 0, angles in radians. `base` is `{ forward, side }`, the frame before the first joint; `forward` is normalised, `side` is made perpendicular to it, and the normal is `forward × side`. Each joint first twists the parent frame about its `forward` axis by `twist`, then bends `forward` toward the normal by `bend`. Returns a new array of `{ start, end, forward, side, normal, length, radius }`, each segment starting where the one before ends. With `base` `{ forward: [0, 1, 0], side: [1, 0, 0] }` the normal is `[0, 0, -1]`, so a positive bend turns a segment toward the viewer; a twist of `Math.PI / 2` before the same bend turns it within the picture, toward `-x`. |
| `reach(root, target, [a, b], bendDir)` | Solves two segments of lengths `a` and `b` from `root` toward `target`. The middle joint lies in the plane through `root` spanned by the line to `target` and `bendDir`, on `bendDir`'s side, so `bendDir` `[0, 0, -1]` bends it toward the viewer instead of sideways. A target farther than `a + b` or nearer than `|a - b|` is moved along the same line to the nearest distance the segments reach. Returns `{ joint, end, reached }`; `reached` is false when the target was moved. |
| `fabrik(joints, target, { pole, maxBend, tolerance, iterations })` | Solves a chain of any number of joints toward `target` by FABRIK, keeping every segment's length and the root where it is. `joints` are all `[x, y]` or all `[x, y, z]`, and `target`, `pole` and the result take the same form. A target beyond the chain's length straightens the chain toward it. A straight chain is bent before it is solved, toward `pole` or a fixed side. `pole` turns each middle joint, about the line through its two neighbours, to the pole's side. `maxBend`, radians in `(0, PI]`, caps the turn at each middle joint, so a target it rules out stays unreached. `tolerance` (default `1e-5`) is how near the end must come; `iterations` (default 32, from 1 to 256) caps the passes. Returns new arrays, `{ joints, reached, iterations, error }`, with `error` the end's distance from the target. |
| `project(segments, { view, up, focal, centre, perspective })` | Projects segments `{ start, end, radius: [r0, r1] }`, such as the output of `pose`. `view` (default `[0, 0, 1]`) is the direction the viewer looks; `up` (default `[0, -1, 0]`) is made perpendicular to `view` and points up the picture. With `focal` `Infinity` (the default) the projection is orthographic; a finite `focal` above 0 scales the whole picture by `focal / (focal + mean depth)`, where the mean depth is that of every segment's start and end along `view`. Weak perspective scales the picture about `centre` (default `[0, 0, 0]`), which keeps its own picture point, and `depth` is measured from `centre` along `view`. To pose in canvas coordinates, pass the figure's middle, such as `[400, 300, 0]`; without it, a figure posed at `[400, 300, 100]` slides toward the picture origin as its scale changes. `perspective` `'weak'` (the default) is that one scale for the whole picture; `'joint'` divides each start and end by its own depth, `focal / (focal + depth)`, so a part aimed at the eye widens at its near end and narrows at its far one. With `focal` `Infinity` both are orthographic. Returns `{ scale, segments }`, each segment `{ a, b, depth: [za, zb], foreshortening, scale: [ka, kb], sections: [s0, s1] }`; the top-level `scale` is the mean-depth factor in both modes. |

In each projected segment:

- `a` and `b` are the picture ends, and `depth` is each end's distance from `centre` along `view`.
- `foreshortening` is the picture length over `scale` times the true length: 1 in the picture plane, `Math.SQRT1_2` at 45 degrees and 0 pointing at or away from the viewer. With `perspective` `'joint'` it is still the cosine of the segment's angle to the picture plane, while the picture length also carries the change in scale between the ends.
- `scale` `[ka, kb]` is the factor at the start and at the end: `[scale, scale]` under `'weak'`. Multiply it into any width you draw at that end, such as an `outline` width or a stroke weight; `sections` already carry it in `major`.
- `s0` is the section at the start with radius `r0`, and `s1` the section at the end with radius `r1`. Each is an ellipse `{ centre, major, minor, angle, near }`. `major` is `r` times that end's `scale` and lies across the segment in the picture (under `'joint'`, `angle` and `near` follow the picture segment `a` to `b`); `minor` is `major` times how far the segment points at or away from the viewer, 0 in the picture plane and `major` facing the viewer. `angle` is the direction of `major` in radians, in `[0, π)`: 0 for a segment running down the picture.
- `near` is the unit picture vector from the centre toward the half of the rim nearer the viewer. It is `[0, 0]` when the segment lies in the picture plane, so the section is a line, or points at or away from the viewer, so the section is a full circle (then `angle` is 0); both within `1e-12`.

Every invalid point, length, radius, angle, view, `centre` or `focal` throws by name, such as `pose: segment 1 length must be a finite number above 0, got -2`. A base `side`, a `bendDir` or an `up` parallel to the direction it is measured against throws, as do a target at the root, a zero-length segment and a `focal` that puts the segments' mean depth at or behind the eye. An unknown `perspective` throws, and under `'joint'` so does any start or end at or behind the eye.

```js
const { pose, reach, project } = require('artifex/core/armature.js');

const chain = pose([0, 0, 0], { forward: [0, 1, 0], side: [1, 0, 0] }, [
  { length: 40, radius: [6, 5] },
  { length: 36, radius: [5, 4], bend: 0.6 },   // turns toward the viewer
]);

// Two segments to a target; the middle joint comes toward the viewer.
const { joint, end } = reach([0, 0, 0], [0, 60, 0], [40, 36], [0, 0, -1]);

const { segments } = project(chain, { focal: 400 });
segments[1].foreshortening;      // cos 0.6, about 0.83
segments[1].sections[0].minor;   // 5 · sin 0.6 · scale: the section seen at a slant
const both = project([
  { start: [0, 0, 0], end: joint, radius: [6, 5] },
  { start: joint, end, radius: [5, 4] },
]);
```

`reach` and `pose` solve one chain each. A body of several chains on a trunk that bends is a pattern a piece writes over them, not a function of the module: the runtime skill's [pose table](../../skills/artifex/reference/films.md#a-trunk-that-bends-and-a-pose-table) spreads a lean, a side bend and a twist over pivots down the spine, then calls `reach` for each limb from the bent trunk.

Run `node --test tests/armature.test.js` for these contracts.

### Cross-contours

Cross-contours are strokes laid round a form along its cross-sections, so a tube, a trunk or a limb reads as round instead of flat. `crossContours` comes from `artifex/core/path.js` and builds them from one segment that `project` returns; it draws nothing.

| Function | Contract |
| --- | --- |
| `crossContours(seg, R, name, { light, spacing, at, width, eye, stop })` | `seg` is one projected segment `{ a, b, sections }`. `R` is the piece's `R(entity, property, index)`, and the marks read `R(name, 'at' \| 'from' \| 'to', i)`, plus `R(name, 'stop', i)` with `stop`, so give each segment its own `name`. `light` (default `[-1, -1]`, upper left) is a picture vector toward the light. Without `at`, the count is the segment's picture length over `spacing` (default 12), rounded, at least 1, with one mark at a seeded place in each equal stretch, never at the ends; `at` is an array of fractions in `[0, 1]` along the segment to place them yourself. `width` (default 2) is each mark's full width, before any cut to fit the form or by `stop`. `eye` (optional) is `{ at, focal }`: `at` is the picture point straight ahead of the eye, which is where `project` puts its `centre`, and `focal` is the `focal` passed to `project`. `stop` (optional) is `[low, high]`, fractions of full light: each mark ends where the surface under it first reaches a seeded light level between them, so it starts in the shade and stops in the half-tone. Returns `[{ points, width, at }]` in order of `at`: `points` is the arc, and `width` is a function of the arc-length fraction for `outline`, the mark's width at the first point and 0 at the last. |

Each mark sits on the section at its `at`, whose centre, `major` and `minor` run straight between the two end sections. The arc covers the half of that ellipse on `near`'s side, the half facing the viewer. It starts where the major axis meets the rim on the side away from `light` and runs a seeded 70 to 95 percent of the way round toward it, so the stroke is heavy in the shade and thins toward the light. Where that half faces away from the light, its darkest rim point lies inside it: the start turns toward that point as the section opens, and the arc shortens to stay on the visible half. When `light` lies along the segment, neither end of the major axis is away from it: every mark starts at the end toward `[light[1], -light[0]]`, so its heavy end stays on the same side as the segment turns through the picture plane, and where the visible half faces away from the light the arc turns the same way round as an end-on one. The arc is drawn in from the rim by half the mark's width, a little more for its joins, so the mark filled with `outline(points, width)` stays inside the outline the two end ellipses span. Where the section's radius is under the width, or the mark lies within half its width of an end of the form in depth, its width is cut to fit, down to 0 for a mark at an end of a segment that is not seen end-on. A segment lying in the picture plane gives straight marks across it; the marks round as it turns toward or away from the viewer, and are arcs of a circle when it points straight at or away from the viewer. Seen that way the whole circle shows, so each arc starts at the rim point straight away from `light`, turns toward `[-light[1], light[0]]` and still thins toward the light. A section with `major` 0 gives no mark.

Without `eye`, every mark on one segment is the same ellipse for its size: an orthographic or weak-perspective view shows a straight part that way, and only the view's pitch opens it. With `eye`, each mark opens by its own section's direction from the eye, and its near half faces the eye. On an upright part lying in the picture plane, a mark level with the eye is straight, the marks open further the farther they sit from eye level, and they bow up above it and down below it. The opening uses the eye's picture point and `focal`, not each section's own depth, so it is close to true perspective for a part across the view and approximate for one pointing far toward the viewer. Each mark keeps its centre, `major` and width cut; near an end of the segment its opening can reach past the end ellipses, which keep the view's opening. A segment seen end-on, or with no picture length, gives the same marks with or without `eye`. From `project` with `perspective` `'joint'`, the end sections' `major` differ by their depths, so the marks widen toward the near end; `eye` still sets how far they open.

Within a tilt of 0.2 of end-on (a `minor` over `major` above about 0.98), where the visible half flips to the other side, each mark eases into the end-on arc: its start turns on to the section's darkest point, onto the far half if it lies there, and its span grows to the end-on arc's. A mark that turns the other way round from the end-on arc shrinks into its start, thinning as it goes, vanishes at a tilt of about 0.1 and grows back the end-on arc's way. A segment that passes near end-on without reaching it also swings its picture direction through the light's, where a mark starts from the other end of the major axis and so becomes its mirror image about the light. The mark on one side of that crossing eases into the other side's mirror image as the angle between the segment and the light falls toward 0. That range is widest near end-on, where a passing segment's direction turns fastest, and narrows as the segment tilts away from the view. Within a tilt of 0.1 the mark's start swings round through the section's darkest point, onto the far half if it lies there; from 0.1 to 0.2 that swing gives way, and from a tilt of 0.2 out the mark keeps to the visible half: it shrinks into its start, thinning as it goes, vanishes, and grows back from its start's mirror image across the minor axis. A segment held still with its picture direction that near the light's draws its marks shorter and thinner than farther from it, or not at all. So a mark's width, length and end points change only a little per frame as the segment swings through end-on or past it, with `stop` or without, on a pass near a tilt of 0.2 too. A segment that turns through the light while lying nearly in the picture plane changes its mark fast, and one lying in it still flips the mark to its mirror image in one frame. With `eye`, the mark's opening, its near side and its light ease to the view's as it nears end-on, where `eye` changes nothing, so there the straight mark is the one whose near side flips, which need not be level with the eye; and since a light along the segment leaves a nearly straight mark almost unlit, its start turns on to the darkest point only as the section's brightest light rises to 0.2.

With `stop`, the light level at a point of the arc is the section's surface normal against `light`, both taken in the picture plane: 0 at the terminator, where the surface turns from the light, 1 facing it, and below 0 in shade. Each mark ends where that level first reaches its seeded level between `low` and `high`, or at its seeded 70 to 95 percent end if that comes first or the arc never gets that lit. A mark already lit past its level at its first point gives no mark, so a form whose visible half faces the light keeps its lit side clear. With `eye`, the level uses each mark's own opening.

So that a bend never halves, swells or drops a mark in one frame, both rules ease in over 0.2 of full light:

- Where the brightest point of the section is less than 0.2 above the mark's level, the end lies between the seeded end and the point where the arc reaches that level, closer to that point the brighter the section. Such a mark can be lit up to 0.2 past its level, and past `high`: to keep the lit side clear above a light level, set `high` 0.2 under it. For a level above 0.8 the easing ends at full light instead, so a section lit to full light still ends those marks on their levels.
- Where the light at the mark's first point is less than 0.2 below its level, the mark keeps that gap over 0.2 of the span the first rule leaves it: a first point 0.05 below the level keeps a quarter. The mark thins to nothing as its first point reaches the level, where it is dropped.

A mark that `stop` ends early has `width` scaled by the share of its seeded span it keeps, before any cut to fit the form: cut to a quarter of its seeded span, it is a quarter of `width` wide, or narrower where the form's fit is narrower still. As the light turns and the end nears the first point, the mark thins to nothing instead of ending as a full-width dot.

An invalid segment, a non-function `R`, a `name` that is not a string, a zero or non-finite `light`, a `spacing` not above 0, a negative `width`, an empty or out-of-range `at`, an `eye` that is not `{ at, focal }` with a finite `focal` above 0 or a `stop` that is not `[low, high]` with 0 ≤ `low` ≤ `high` ≤ 1 throws by name, such as `crossContours: spacing must be a finite number above 0, got 0`.

```js
const { pose, project } = require('artifex/core/armature.js');
const { outline, crossContours } = require('artifex/core/path.js');
const { rng } = require('artifex/core/rand.js');

const R = rng(7);
const chain = pose([400, 200, 0], { forward: [0, 1, 0], side: [1, 0, 0] }, [
  { length: 120, radius: [24, 18] },
  { length: 110, radius: [18, 12], bend: 0.8 },   // turns toward the viewer
]);
const { segments } = project(chain, { focal: 600, centre: [400, 300, 0] });
for (const [i, seg] of segments.entries()) {
  // `centre` [400, 300, 0] keeps its picture point [400, 300]: the eye looks straight at it.
  const eye = { at: [400, 300], focal: 600 };
  for (const mark of crossContours(seg, R, `form ${i}`, { light: [-1, -1], spacing: 14, width: 3, eye })) {
    const shape = outline(mark.points, mark.width);   // fill it with `fill(g, shape)` in draw
  }
}
```

Run `node --test tests/geom.test.js` for these contracts.

### Grow a path

`grow` draws a path part of the way along it, so a mark can appear in the order a hand makes it and a tool can follow its tip. It comes from `artifex/core/path.js` and draws nothing.

| Function | Contract |
| --- | --- |
| `grow(pts, length, close = false)` | `pts` is an array of at least one `[x, y]` point. `length` is any number but NaN, clamped to 0 up to the path's length, so `Infinity` gives the whole path. `close` adds the edge from the last point back to the first when there are more than two points, as `lengthOf` does. Returns `{ points, tip, heading, length, total }`. `points` holds every point passed, then the tip, cut part-way along its segment; when the tip lands on a point, or a length too small to move it off a point in floating point, the point is not repeated, so at length 0, or one too small to move off the first point, `points` is the first point alone. `tip` is the last of `points`. `heading` is the direction of travel at the tip in radians, `Math.atan2(dy, dx)` with `y` growing down as on a canvas: of the segment the tip lies on, of the segment that arrives when the tip sits on a point, and of the first segment at length 0. Zero-length segments are skipped, and a path with none gives a heading of 0. `length` is the length drawn, after clamping. `total` is the whole path's length, including the closing edge. Every array returned is new, and `pts` is not changed. |

`points` is a prefix of the whole path: for a shorter length, every point but the tip is the same as for a longer one. Build a mark's whole path once, wobble and resampling included, and grow it by length, so the part already drawn never moves. Give a varying width as a function of the length along the whole path, as below, not of the drawn part's own fraction, or the line re-shapes as it grows. Measure it with the returned `length`, not the one you passed: a stroke timed by the clock runs past the path's end once it finishes, and a width read there can turn negative or NaN, which `outline` refuses. At length 0 `points` holds one point, which is no line yet: `outline` throws on it, so skip it. Missing or empty `pts` throws `grow: needs at least one point`, and a NaN or non-number `length` throws `grow: length must be a number, got NaN`.

```js
const { grow, outline } = require('artifex/core/path.js');

const line = [[0, 0], [40, 0], [40, 30]];   // 70 long
const width = (d) => 1 + 2 * Math.sin(Math.PI * d / 70);   // by the length along the line
const drawn = 55;
const { points, tip, heading, length } = grow(line, drawn);
// points [[0, 0], [40, 0], [40, 15]], tip [40, 15], heading π / 2: moving down, length 55
const shape = outline(points, (u) => width(u * length));   // fill it with `fill(g, shape)` in draw
// Draw the tool at `tip`, turned a little with `heading`.
```

The runtime skill's [draw the drawing](../../skills/artifex/reference/films.md#draw-the-drawing) covers drawing order, how a hand moves and when to show the tool. Run `node --test tests/geom.test.js` for these contracts.

## Polygon booleans and offsets

`artifex/core/clip.js` combines closed shapes and draws the outline at a distance round a shape or a line. It wraps Clipper2, vendored in `core/clipper2.js` with its Boost Software License beside it. Clipper2 is about 28 kB of brotli, so it sits apart from `core/geom.js`: a site shot that never requires `core/clip.js` does not load it.

A shape is one ring of `[x, y]` points, its closing point not repeated, or an array of rings. Every function returns a new array of rings: outer rings, and holes wound the other way from the ring round them. Ring order and starting points are not promised.

| Function | Returns |
| --- | --- |
| `union(a, b = [], options)` | The area inside `a` or `b`. `union(a)` alone merges the overlaps of `a`'s own rings. Each argument's rings are filled together by `fill`: under `'nonzero'`, where a clockwise ring of one argument overlaps a counter-clockwise ring of the same argument their windings cancel and the overlap is left out, so two overlapping 10-unit squares, one reversed, give 150 square units through `union([a, b])` and 175 through `union(a, b)`. Wind them one way first, or pass them as separate arguments. |
| `intersection(a, b, options)` | The area inside both. |
| `difference(a, b, options)` | The area inside `a` and outside `b`. |
| `xor(a, b, options)` | The area inside exactly one of them. |
| `offset(shapes, distance, options)` | The outline `distance` away, merged where its parts meet, so it never crosses itself. Closed shapes, the default: a positive distance grows each shape and a negative one shrinks it; a part narrower than twice the distance disappears. The rings are first merged as `union` merges them, by `fill`, so distance 0 returns the merged outline; a ring's direction does not matter on its own, but overlapping rings wound opposite ways cancel there as in `union`. Open lines, with `closed: false`: each line becomes the band round it, `distance` from the line on both sides. |

| Option | For | Default | Meaning |
| --- | --- | --- | --- |
| `scale` | all five | `1000` | Clipper2 works on integers: each coordinate is multiplied by `scale` and rounded, so results sit on a grid of `1 / scale` design units. A scaled coordinate past 2^25 (33,554,432) throws, because Clipper2's arithmetic stops being exact there; pass a smaller `scale` for larger coordinates. For `offset`, the bound is on the farthest the outline can reach: the largest scaled coordinate plus the scaled distance times the larger of `miterLimit` and 2. |
| `fill` | booleans, closed `offset` | `'nonzero'` | Which areas each argument's rings enclose: `'nonzero'` or `'evenodd'`. |
| `closed` | `offset` | `true` | `false` offsets open lines. Their `distance` must be at least 0, and 0 returns `[]`. |
| `join` | `offset` | `'miter'` | `'miter'`, `'round'`, `'square'` or `'bevel'`. |
| `miterLimit` | `offset` | `4` | A miter reaching more than `miterLimit` times the distance from its corner is squared off. Finite, at least 1. |
| `end` | open `offset` | `'butt'` | `'butt'`, `'square'` or `'round'`. |

A point that is not a finite `[x, y]` pair throws `geometry: expected a finite [x, y] point`; every other refusal names the function, such as `offset: join must be miter, round, square, bevel`.

```js
const { difference, offset } = require('artifex/core/clip.js');

const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
const frame = difference(square, offset(square, -2));   // the square and a 6 by 6 hole
const band = offset([[0, 0], [20, 0], [20, 20]], 3, { closed: false, join: 'round', end: 'round' });
// Fill all of a result's rings as one path, so its holes stay open:
// g.beginPath(); for each ring, moveTo its first point, lineTo the rest, closePath; then g.fill().
```

`offsetPolyline` in `core/geom.js` stays for one side of an open line, point for point, with its folds kept. Run `node --test tests/geom.test.js` for these contracts.

## Simulation

[`core/sim.js`](../../core/sim.js) moves bodies that touch: particles with mass under gravity and drag, joined by links, colliding with one another and with walls, fixed or [moving](#moving-walls), and [boxes and convex shapes that turn](#bodies-that-turn). Use it when parts must push, bounce, hang or pile, and the result must still replay. Solve the whole run once in a build stage, then make `draw` look the frame up: a build stage is not handed the clock, so give `simulate` the piece's frame count and rate yourself, as [`examples/cascade.js`](../../examples/cascade.js) does.

```js
const { simulate, chain } = require('artifex/core/sim.js');

// In a build stage:
s.run = simulate({
  frames: 216, hz: 24,                          // the piece's own frame count and rate
  gravity: [0, 900],                            // design units per second squared
  particles: [
    { x: 100, y: -40, radius: 12, mass: 1, hold: 0.5 },  // let go after half a second
    { x: 300, y: 20, hold: Infinity },          // a pin: held for the whole run
    { x: 300, y: 40, radius: 3 }, { x: 300, y: 60, radius: 3 },
  ],
  links: chain(1, 3),                           // pin, bead, bead
  walls: [{ from: [0, 400], to: [600, 460], restitution: 0.4, friction: 0.1 }],
  quiet: 60,                                    // log impacts from 60 units a second
});

// In draw:
const [x, y] = s.run.at(clock.frame, 0);
```

`simulate(spec)` returns a frozen result: `at(frame, i)` and `velocity(frame, i)` give `[x, y]` for particle `i` on a frame, `contacts` is the impact log, and `xy` and `vxy` hold every frame as flat `Float64Array`s, `(frame * count + i) * 2`. Frame `k` is the state at `k / hz` seconds, so frame `0` is the start as given. `wallGrid` is `true` when `simulate` filed the walls in cells and looked them up there, and `false` when it tested every particle against every wall, as with 8 walls or fewer or with `everyPair`.

`velocity` leaves out the push out of an overlap that a step starts in, and it takes back two other pushes the same way: a contact brings its normal velocity back to what the body arrived with, or to its bounce, even for a body already leaving, so a push that sped it away along the normal does not stay; and when contacts hand the bodies they touch more motion than those bodies brought, all the changes of that step are scaled back by one factor. A step that starts with two bodies overlapping, or a body inside a wall, first moves them apart and then starts from there, so that push never becomes speed. In a crowded pile, or with few `substeps` or `iterations`, overlaps carry from one step to the next, and the crowd moves a body further than its velocity says. A body's travel over the last frame, `at(f, i)` minus `at(f - 1, i)` (multiply it by `hz` for units a second), includes that push, but it looks one frame back, so it lags gravity and bounces. To forecast where a body goes next, such as a path guard or a collision warning, use the travel only for a body pushed through a crowd at a steady speed; for a falling pile or a bouncing ball, velocity forecasts better.

| Key | Default | Meaning |
| --- | --- | --- |
| `frames`, `hz` | required | One snapshot per frame, `frames` of them at `hz` a second. |
| `substeps` | `16` | Steps per frame, a whole number from 1 to 1000. More steps keep fast discs from passing through each other and keep links closer to their length. |
| `iterations` | `4` | Passes over the links and contacts per step, in one fixed order; a whole number from 1 to 1000. |
| `gravity` | `[0, 0]` | Acceleration in design units per second squared. |
| `drag` | `0` | A rate per second, 0 or more: a free particle keeps `exp(-drag)` of its velocity each second, applied as `exp(-drag * seconds)`. |
| `particles` | required | See below. With `bodies`, it may be left out or empty. |
| `bodies` | `[]` | Boxes and convex shapes that turn; see [bodies that turn](#bodies-that-turn). |
| `links` | `[]` | `[a, b]`, `[a, b, length]` or `[a, b, length, stiffness]`. `length` defaults to the start distance; `stiffness` is above `0` and at most `1`. Add `'rope'` as the last element, such as `[a, b, 'rope']`, for a link that never pushes; see below. |
| `breaks` | `[]` | Links that give way: `{ link, at }` breaks link `link` (its index in `links`) at `at` seconds, `{ link, stretch }` when it is stretched past `stretch` times its length (above 1), and one entry may hold both. A broken link stops holding from then on. The result's `broken` lists `{ link, frame, seconds }` for each, in the order they went, so `draw` can stop drawing the link and `sound` can place its snap. |
| `force` | None | A function `(seconds, x, y)` returning `[fx, fy]`: a push on every free particle that varies in time and place, such as a gust that crosses the frame. It is a force, so a heavier particle moves less. The tests that tell a resting body from a moving one know `gravity` only. Without `force` and `breaks` a solve is unchanged. |
| `walls` | `[]` | Segments `{ from, to, restitution, friction }`. A wall works from both sides; its own `restitution` and `friction` default to the spec's. `from` and `to` are `[x, y]`, or functions of seconds for a [wall that moves](#moving-walls). |
| `restitution` | `0.3` | The share of normal speed a contact returns, from `0` to `1`. |
| `friction` | `0.3` | Coulomb friction between two discs, and on walls without their own. |
| `quiet` | `0` | The slowest impact, in design units a second, that the contact log records; a body's must also close faster than two substeps of gravity give. |

A particle is `{ x, y, vx, vy, mass, radius, group, hold, path }`. `mass` defaults to `1` and `radius` to `0`: a particle without a radius meets walls but no other particle. Discs that share a `group` above `0` pass through each other, such as the beads of one cord. `hold` is the number of seconds the particle is held before it is let go; it defaults to `0`, or to `Infinity` when a `path` is given. A held particle has infinite mass: nothing moves it, and it starts at rest. `path(seconds)` returns `[x, y]` and moves a held particle along it; when the hold ends, the particle keeps the velocity its path gave it. `chain(first, count)`, `ring(first, count)` and `grid(first, cols, rows)` write the links of a run, a closed loop and a sheet laid out row by row.

A plain link holds its two particles at its length both ways: it pulls them together when they drift apart and pushes them apart when they come closer. A chain of plain links is stiff, so one dropped on its end stands up. A rope link only pulls. It lets its particles come closer than its length, so a chain of rope links dropped on its end folds and piles up where it lands. Make a whole chain of rope links by adding `'rope'` to each link:

```js
links: chain(1, 12).map((link) => [...link, 'rope']),
```

`'rope'` goes after whichever of `length` and `stiffness` you give: `[a, b, 'rope']`, `[a, b, 40, 'rope']` or `[a, b, 40, 0.5, 'rope']`. A link without it behaves exactly as before.

### Moving walls

A wall moves when `from`, `to` or both are functions of seconds returning `[x, y]`, in the same seconds as a particle's `path`. Use one for a container that resizes, a floor that gives way, a belt or a paddle, instead of building the wall from held discs on paths. For keyframes, make each coordinate a key track from [`keys`](#key-tracks-and-gaits) in `core/time.js`:

```js
const { keys, ease } = require('artifex/core/time.js');

// A box 400 wide that narrows to 240 between seconds 1 and 3, then holds.
const half = keys([[1, 200, ease.inOut], [3, 120]]);
walls: [
  { from: (s) => [-half(s), 200], to: (s) => [half(s), 200] },      // the floor
  { from: (s) => [-half(s), -400], to: (s) => [-half(s), 200] },    // the left side
  { from: (s) => [half(s), -400], to: (s) => [half(s), 200] },      // the right side
],
```

Each step, the wall's line is taken again where the step ends, and the step is swept against it: a wall that crosses a body within one step catches the body, as a body that crosses a wall is caught, at any speed. Over a step the wall moves as a rigid line through its middle: it translates and turns with its middle, and a change of length grows or shrinks it about that middle. So a floor whose ends draw in, as in the box above, does not drag what stands on it, a belt whose ends move together carries what rests on it by friction, and a paddle turning about one end pushes harder at its far end. A wall that strikes a body hands it the wall's speed plus the bounce its `restitution` gives: at `1`, a body at rest leaves at twice the wall's speed; at `0`, it rides the wall.

The [contact log](#the-contact-log) records the impact at the speed the two closed at, the wall's motion included. A body that rides a wall at the wall's own speed can touch it again at almost no speed; set `quiet` to keep such touches out of the log. A wall that moves is never filed in the wall grid: every particle is tested against it on every pass, so a few moving walls cost little and many cost a test per particle each. A wall whose endpoints meet, so that its length is `0`, is refused by name at the second it happens, as is an endpoint function that returns anything but finite `[x, y]`. So is a wall that reverses its direction between one step's end and the next, because its ends passed through each other or it turned more than a quarter in that step: swept as a rigid line, it would carry a body resting on it to its other side. Keep each end on its own side, or raise `substeps` for a wall that turns fast.

### Bodies that turn

A particle has no angle, so a box built from discs lands on its corners and slides without turning. For anything that must turn, topple or stack, give `simulate` a list of `bodies`. They are solved by [planck](../../core/planck.js), a vendored port of Box2D, one world step for each substep, against the same walls, and their impacts go into the same [contact log](#the-contact-log).

```js
const { simulate } = require('artifex/core/sim.js');

// In a build stage: three boxes stacked on a floor, and a wedge thrown at them.
s.run = simulate({
  frames: 144, hz: 24, gravity: [0, 900],
  bodies: [
    { x: 300, y: 370, width: 60, height: 60 },
    { x: 300, y: 310, width: 60, height: 60 },
    { x: 300, y: 250, width: 60, height: 60 },
    { x: 60, y: 250, points: [[-30, 20], [30, 20], [0, -25]], vx: 500, spin: 2, mass: 2 },
  ],
  walls: [{ from: [0, 400], to: [800, 400] }],
});

// In draw: each body from its pose, so its shape turns with it.
for (let k = 0; k < s.run.bodies; k++) {
  const [x, y, angle] = s.run.pose(clock.frame, k);
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.strokeRect(-30, -30, 60, 60);   // or trace the body's own points
  g.restore();
}
```

| Key | Default | Meaning |
| --- | --- | --- |
| `x`, `y` | required | The body's origin. A box is centred on it; `points` are relative to it. |
| `width`, `height` | required without `points` | The box's size. |
| `points` | none | Instead of `width` and `height`: 3 to 8 corners `[x, y]` that go once round a convex shape, in either direction. A star, whose corners go round twice, is refused. |
| `angle` | `0` | Radians. A positive angle turns +x towards +y, the same way as the canvas `rotate`. |
| `vx`, `vy`, `spin` | `0` | The start velocity in design units a second, and the start spin in radians a second. planck turns a body at most a quarter turn a substep, so a `spin` above `(PI / 2) * hz * substeps` either way is refused; raise `substeps` for a faster one. |
| `mass` | `1` | Spread evenly over the shape, so a long box is harder to turn than a short one of the same mass. |
| `hold` | `0` | Seconds the body stands still before it is let go. A held body starts at rest, nothing moves it, and others can land on it. `Infinity` keeps it still for the whole run. |

`simulate` then also returns `bodies`, the number of bodies, and `pose(frame, k)` and `motion(frame, k)`, which give `[x, y, angle]` and `[vx, vy, spin]` for body `k` on a frame. `vx, vy` is the velocity of the body's origin. `poses` and `motions` hold every frame as flat `Float64Array`s, `(frame * bodies + k) * 3`. Frame `0` is the start as given. Both readers refuse a frame or body index out of range.

A body meets other bodies with the spec's `restitution` and `friction`, and meets a wall with that wall's own. `gravity`, `drag` and `substeps` apply to bodies as they do to particles. `iterations` does not: planck takes 8 velocity passes and 3 position passes each step.

A body's impact is logged like a particle's, with three differences. `a` and `b` are `null`. `body` is the lower index of the two bodies, or the one body that met a wall, and the normal points towards it. `other` is the other body's index; when the body met a wall, `other` is `null` and `wall` is the wall's index. The point is the middle of the contact, or, when a body already touching lands again, the middle of the corners that landed. Particle entries keep their own fields and have no `body` or `other`. In a step where both meet something, the particles' entries come first.

### The contact log

Every impact at `quiet` speed or faster is logged once, on the step it begins: a disc resting on a wall or on another disc is not logged again until the two part. A body's touch counts as an impact when it closes at `quiet` or faster, and faster than two substeps of gravity give: twice the length of `gravity`, divided by `hz * substeps`. A body that stays in touch is logged again when another corner or face lands that fast, such as the far end of a box that pivots on one corner and slams down. A body resting on a face is not logged again, nor a held body let go where it rests, or anything resting on it, but a pile that rocks logs each corner that lands, and two bodies that part and touch again log that touch; raise `quiet` to keep the small ones out. Each entry is frozen:

| Field | Meaning |
| --- | --- |
| `frame`, `seconds` | The frame that first shows the impact, and the exact time of the step it happened in. |
| `x`, `y` | The contact point on particle `a`'s surface. |
| `nx`, `ny` | The unit normal, pointing towards `a`. |
| `speed` | How fast the two closed along the normal, in design units a second. |
| `a` | The particle that struck. |
| `b`, `wall` | The other particle's index, or the wall's index; the other one is `null`. |

Start a sound on `frame / hz`, the first frame that shows the impact, so picture and sound agree. [`examples/cascade.js`](../../examples/cascade.js) plays one [`voice`](#soundtrack) per impact: the wall's note, louder and brighter for a higher `speed`, panned by `x`.

### What the solver guarantees

- **The same input gives the same bytes.** Links, pairs, walls and contacts are processed in one fixed order. This holds for bodies too, and an earlier solve in the same run does not change a later one. A spec without bodies gives the same bytes as before bodies existed.
- **A fast body does not pass through a fixed wall or another body, and keeps its speed.** planck sweeps each body's step against the walls at any speed and any `substeps`, and logs the impact. A body that a step carries further than 1/200 of the bodies' median size is swept against the other bodies too; a body at rest is not, so a stack left alone stands. Its own cap of twice the bodies' median size a step is lifted, and no body is put to sleep however slowly it drifts or turns, so nothing slows a body but what it meets and `drag`.
- **A body bounces at any size.** It stops bouncing and rests only below twice the speed gravity gives in one substep, as a particle does; with no gravity, it always bounces.
- **A contact reflects only a velocity that points into its surface.** A body already leaving is not turned back.
- **A contact pushes along its normal.** A body keeps its place along a surface, so it slides down a smooth slope; static friction holds it on a rough one, and sliding friction slows it by `friction` times the normal push.
- **A body started inside a wall or another body is pushed out without gaining speed.**
- **A fast body does not pass through a wall, and a fast wall does not pass through a body with room behind it.** Each step's path is tested against the wall's line, whatever the speed; against a [moving wall](#moving-walls), the path is taken in the wall's own frame. A body squeezed between a moving wall and another wall or body is the exception, under [limits](#limits).
- **Testing only near discs and walls gives the same bytes as testing every pair.** `simulate` files discs in square cells and tests each disc only against discs in its own and neighbouring cells, in the same order. With more than 8 walls, it also files the fixed walls in square cells and tests each particle only against the walls in the cells its step reaches, and against every moving wall, then records the wall contacts in the same order as testing every wall. To check this on your own input, compare with `simulate(spec, { everyPair: true })`, which tests every pair of discs and every particle against every wall.
- **Two discs share an overlap by their masses**, so a collision keeps momentum.
- **Contacts do not add energy.** With restitution `1`, no friction and no drag, the total energy of the free particles does not grow. Where several contacts meet one body at once, the step's contact changes are scaled back together until the bodies have no more motion than they brought into the step. A moving wall is the exception: it may hand a body it touches as much motion as the body could leave it with, the speed they closed at in the wall's frame plus the wall's own.

Invalid input is refused by name, for example `simulate: restitution must be from 0 to 1, got 1.5`, `simulate: particle 2 is held, so it starts at rest; move it with a path, or give it no hold` and `simulate: wall 0 length must be above 0 at 0.5 s: from and to must differ, got 0`. `at` and `velocity` refuse a frame or index out of range.

### Limits

- **Discs do not pass through a wall unless squeezed, but they can pass through each other.** Two discs are tested where each step ends, not along its path. Keep the distance a disc moves in one step, speed divided by `hz * substeps`, below its radius.
- **A body squeezed between a moving wall and another wall or body cannot satisfy both, so one of them passes through it.** Two sides of a box closing on a disc of radius 10, at 5 or at 50 units a second, overlap the disc once they are less than its width apart, and push it out through one side once they are its radius apart or less. Keep a resizing container wider than what it holds.
- **Only particles collide; a link does not.** A link between two beads can cut into a disc by as much as the beads are apart. Keep beads closer together than the disc they drape over is wide, as [`examples/drape.js`](../../examples/drape.js) does. Start no body inside a collider either: a disc or peg pushes beads that begin inside it out on both sides, and the link between them stays across it.
- **A link resists compression as well as stretch.** A chain that lands standing on its end can stay standing. Hold both ends of a cord, or give the surface little friction so the chain slides over.
- **Discs have no spin.** To show a disc rolling, turn a mark by the distance travelled divided by the radius, as `cascade` does. Anything that must turn, topple or stack is one of the [bodies](#bodies-that-turn).
- **Bodies and particles do not meet each other.** A disc falls through a box. Make both of them bodies, or keep them apart.
- **Bodies meet only walls that stand still.** A spec with bodies and a [moving wall](#moving-walls) is refused by name. A body that is held stands still and can serve as a fixed obstacle.
- **Bodies rest a hair apart.** planck keeps shapes about 2 % of a body's size apart, so a box of side 60 rests about 1.2 units above the floor. Draw it where its pose says; the gap is too small to see at most sizes.
- **Bodies of very different sizes lose precision.** planck's tolerances suit shapes about one unit across, so `simulate` divides every length, speed and gravity by the median of the bodies' widest extents before solving, and multiplies the results back. A body more than about 50 times smaller or larger than that median gets tolerances that suit the others, not its own size. planck merges corners closer than 1/400 of the median, so a shape with two such corners is refused by name; make it larger, or give it fewer corners.
- **A body turns at most a quarter turn a substep.** A start `spin` beyond that is refused, but a spin a collision hands a body is held to it without a word: at 24 frames a second and 16 substeps, about 600 radians a second. Raise `substeps` for a body struck into a faster spin.
- **Cost grows with the pairs of discs that can touch**, times `frames * substeps * iterations`. `cascade`, with 32 particles, 216 frames and 10 substeps, solves in about 0.1 seconds in Node. Cells are a little wider than the widest disc filed in them, so one large disc among small ones would make every cell large and put many discs in each. So discs more than four times the median radius are filed in larger cells of their own. A large disc whose reach covers more small cells than there are discs is tested against every disc. At the start of each frame, `simulate` files every disc together in the larger cells instead when its count of the discs in them says that costs less, as in a sparse pile. The result is the same either way; only the time changes.

Run `node --test tests/sim.test.js` for the solver's contracts.

## Flowing media

`fluid(spec)` in [`core/sim.js`](../../core/sim.js) solves a medium that flows on a coarse grid once for the whole film, such as smoke, mist, dye or a current, and returns one snapshot per frame. Each step traces back along the flow and reads what was there, so no speed or step makes it blow up, and one spec gives one run.

| Key | Default | Meaning |
| --- | --- | --- |
| `cols`, `rows` | required | The grid's cells, whole numbers from 4 to 512. It is sampled at its `(cols + 1) * (rows + 1)` corners in row order, the layout `sampleGrid` and `isolines` use; the outer ring of corners is the wall. |
| `frames`, `hz` | required | The film's frame count and rate. `frames` times the samples may not pass 2^26. |
| `sources` | `[]` | A list of sources, or a function of the second and the frame that returns one. |
| `viscosity`, `diffusion` | `0` | How fast the velocity and the density spread, in cells squared per second. |
| `fade` | `0` | The density is multiplied by `e^-fade` each second. |
| `buoyancy` | `0` | Lifts dense cells towards `-y`, in cells per second squared per unit of density. |
| `iterations` | `20` | Relaxation passes of each solve, from 1 to 200, in a fixed order. |

A source is `{ at, radius, density, push, from, to }`: `at` is `[x, y]` from 0 to 1 across the grid, `radius` its reach in cells (default 1.5), `density` what it adds a second at its centre, `push` the `[x, y]` it adds to the velocity a second, in cells per second, and `from` and `to` the seconds it is on. The result holds `cols`, `rows`, `frames`, `density(frame)` (a `Float32Array` of corner samples), `velocity(frame)` (its `[u, v]` arrays, in cells per second) and `sample(frame, x, y)`, the density at `[x, y]` from 0 to 1. Draw the density as cells, or pass it to `isolines(run.density(frame), cols, rows, level)` for contours an SVG keeps. Invalid input is refused by name, for example `fluid: cols must be a whole number from 4 to 512, got 2`.

## Colour dissolves

[`core/colour.js`](../../core/colour.js) offers three mixes of two hex colours at `u` in [0, 1], clamped, returning hex. The two ends come back exactly, and alpha mixes linearly in all three.

| Function | Contract |
| --- | --- |
| `mix(a, b, u)` | The default. Mixes in linear light; between complementary colours the midpoint is close to grey. |
| `mixOklch(a, b, u)` | Moves OKLCh lightness and chroma linearly and turns the hue the short way round, so the midpoint keeps the ends' chroma but may show a hue neither end has. A colour with chroma under 1e-4 counts as grey and takes the other colour's hue. Where the arc leaves sRGB, chroma is reduced at the same lightness and hue. |
| `mixPigment(a, b, u)` | Mixes as paint: the weighted geometric mean of each linear channel, each held at 0.001 or more first. The midpoint is darker than either light mix, and yellow and blue paints make green. Pure sRGB primaries share no channel, so they mix to dark grey. |
| `mixSpectral(a, b, u)` | Mixes as paint across the spectrum, by single-constant Kubelka-Munk theory. Each colour becomes a reflectance curve at 36 wavelengths, lifted to 0.003 or more; the curves' absorption-to-scattering ratios are averaged, each paint weighted by its squared share times its luminance (held at 0.013 or more); the result is read back under D65. Yellow and blue make a clearer, lighter green than `mixPigment`, a colour mixed with white keeps its chroma, and black with white at one half is `#707070`. Where the mix leaves sRGB, chroma is reduced at the same lightness and hue. A call took about twice the time of `mixPigment` in sRGB and three to four times where the mix left it, measured in Node on one machine. |
| `oklch(colour)` | `[L, C, h]`: OKLab lightness in [0, 1], chroma, and hue in radians in (-π, π]. |

The OKLab matrices are those Björn Ottosson published with the space. Switching a piece from `mix` to `mixOklch` changes its frames, so it is an art decision made with before and after frames. [`examples/cues.js`](../../examples/cues.js) turns its palette changes with `mixOklch` and keeps `mix` for its shadows. Run `node --test tests/toolkit.test.js` for the colour contracts. `mixSpectral`'s two tables are derived by [`tests/fixtures/spectral-tables.js`](../../tests/fixtures/spectral-tables.js) from the Wyman, Sloan and Shirley fit of the CIE 1931 observer, the D65 table and Scott Burns' least-slope-squared reflectance method; `node --test tests/colour-spectral.test.js` holds the tables to that derivation.

## Tone mapping

A piece that accumulates a high-range field, such as hit counts, summed energy or added light, can map it to [0, 1] without clipping its densest values. [`core/colour.js`](../../core/colour.js) offers two functions for this. Both run on the CPU.

| Function | Contract |
| --- | --- |
| `reinhard(x, white)` | Extended Reinhard: `x (1 + x / white²) / (1 + x)`. The low end stays close to linear, `white` maps exactly to 1, and values above `white` pass 1. A `white` of `Infinity` gives `x / (1 + x)`. |
| `toneMap(values, { key, exposure, white })` | Returns a curve `(v) => [0, 1]` for the numbers in `values`, which can be any array or typed array. It scales `v` by `exposure * key / average`, where `average` is the mean of the values above 0, then applies `reinhard` and clamps; a value at or below 0, or `NaN`, returns 0. `key` defaults to 0.5 and `exposure` to 1. `white` is in the field's own units and defaults to its peak, so no value clips; a lower `white` maps everything above it to 1. A `key`, `exposure` or `white` that is not a positive finite number throws. |

The average leaves out zeros because, in an accumulated field, a zero is a place nothing reached rather than a dark one. The curve returns linear light. To use it as a position on a colour ramp chosen by eye, encode it with `toSRGB` first; otherwise the faint values sink into the ground.

[`examples/attractor.js`](../../examples/attractor.js) uses it through its `highlights` parameter. At 0, the default, the piece keeps its clipped logarithm and draws exactly as before; at 1, its densest folds keep separate tones instead of merging into one.

## Static layers

`layer(surface, state, key, box, paint, opt)` in [`core/layer.js`](../../core/layer.js) draws the part of a frame that never changes, such as a ground or a grid, once per canvas and device scale. `paint(surface, state)` draws it inside `box`, `[x, y, w, h]` in the surface's current units. It reads only the solved state, never the playhead; a paint that declares a third parameter is refused by name.

On a raster canvas the layer is drawn directly on its first frame at a scale. On its second it is drawn again and copied from the canvas right after; later frames put the copy back instead of drawing it. The copy is kept only when the layer alone is opaque across its box and the box lands on whole device pixels under a plain scale, so a copied frame holds exactly the pixels drawing it would. Otherwise, past 2^25 kept pixels per canvas and solve (`opt.cap` replaces that limit), and on vector and null surfaces, `paint` runs on every frame, and an SVG keeps every path. The copies live per canvas and solve and are released with either. Call `layer` first in `draw`, from the default drawing state.

A browser may move a GPU-backed canvas that is read back often to CPU rasterization, which changes its antialiasing; a copy keeps the layer as that canvas drew it before the move. Read pixels back from a canvas created with `willReadFrequently: true`, as the checks and the CPU film route do. The copy saves drawing time where a canvas is rasterized on the CPU; where the GPU rasterizes it, the layer may already be cheap.

[`examples/drift.js`](../../examples/drift.js) keeps its paper and ground as a layer, and [`examples/readout.js`](../../examples/readout.js) its paper and slot grid. Run `node --test tests/layer.test.js` for the copy rules.

## Sprites

`sprite(surface, state, name, box, paint, opt)` in [`core/layer.js`](../../core/layer.js) draws a picture that changes rarely, such as a textured cutout or a sheet of marks that have settled, as a raster copy placed with any transform. `paint(surface, state, from, to)` draws the picture inside `box`, `[x, y, w, h]` in the sprite's own units, onto a transparent ground. It reads the solved state and the two keys, never the playhead, and sets every drawing state it uses. `name` tells sprites apart within a solve: two calls with the same name and box share their copies, so give each different picture its own name.

| Option | Default | Meaning |
| --- | --- | --- |
| `key` | `0` | The piece's own number for what the picture holds, such as the count of settled marks. |
| `at` | no transform | `[a, b, c, d, e, f]`, applied on top of the surface's current transform, so a sprite can be moved, turned and scaled. |
| `scale` | `1` | Multiplies the pixels per unit the sprite is baked at, above 0 and at most 8 (`MAX_SCALE`), so a sprite that `at` enlarges keeps its detail. Each scale is its own copy, holding `scale` squared times the pixels. |
| `budget` | `BUDGET`, 2^24 pixels (64 MB of RGBA) | The pixels of copies kept per canvas. `0` keeps nothing. |
| `smoothing` | `'high'` | How the copy is drawn: `'high'`, `'medium'` or `'low'` smoothing quality, or `false` for nearest neighbour. Any other value throws a `TypeError` that names it. |

On a raster canvas the sprite is baked on a canvas of its own at the surface's device scale, the square root of its transform's determinant rounded to 2^-20, times `scale`. That canvas is drawn with `at` and the caller's alpha and blend, at the sprite's own `smoothing`, whatever the caller set. At `'high'`, a copy shrunk by `at` is filtered from reduced copies, so a fine texture that turns slowly does not shimmer from frame to frame. Pick `'low'` when drawing copies limits a preview on a CPU-backed canvas and the texture can shimmer a little. Pick `false` for pixel art, so each baked pixel stays a sharp square; place such a sprite at whole-number scales without a turn, or its squares come out uneven. Smoothing changes how a copy is drawn, not what it holds, so sprites that differ only in `smoothing` share one copy. A sprite enlarged by `at` past its `scale` is resampled up and softens. A bake is refused with a `RangeError` that names the sprite and the bake's size when it would hold more than 2^28 pixels (`MAX_BAKE`). That was the largest canvas installed Edge 153 drew on when measured: one pixel more and its canvas stays blank without an error. What falls outside `box` is cut off. Under a scale that differs between the two axes, the copy has the geometric mean of the two, so it is softer along the axis scaled more. The baked canvas is the sprite: without a kept copy it is baked afresh and drawn the same way, so a frame drawn from copies holds exactly the pixels of one drawn without them.

A copy at a new key is grown from the nearest kept copy at a smaller key: `paint` draws only what lies between onto that copy's canvas, with `from` set to the older key, and the canvas is then kept at the new key instead of the older one. A sheet that gains marks on every frame therefore keeps one canvas, not one per frame. If the older key is drawn again, it is grown again from the nearest copy below it, or baked whole. With no older copy, the sprite is baked on a new canvas, `from` is `null` and `paint` draws everything up to `to`. Each call to `paint` starts with the default drawing state and an empty path, as on a new canvas. If `paint` throws while a copy grows, that copy is dropped, so no copy is left holding part of a span. Growing equals baking whole only when painting from a to b and then from b to c leaves what painting from nothing to c does, so draw each mark on its own from the default state. A static cutout keeps the default key and is baked once per canvas, solve and device scale, on its first raster draw, because `build` runs in Node, where there is no canvas.

Copies live per canvas and belong to one solve: drawing another solve on a canvas drops the copies of the one before. Past the budget, the copies drawn least recently are dropped, and a copy larger than the budget is baked on every draw. Each call applies its own `budget`, so give every sprite on a canvas the same one. `held(canvas)` returns `{ copies, pixels }` for what a canvas keeps now; each pixel is 4 bytes. On a surface without a canvas, such as an SVG or the benchmark's null surface, `paint` draws there directly under `at`, from `null` to `key`, so an SVG keeps every path.

`sibling(canvas, w, h)` returns a new blank canvas `w` by `h` pixels of the same kind as `canvas`: an element made by `canvas.ownerDocument` when `canvas` has one, otherwise an `OffscreenCanvas`. It returns `null` when there is no canvas, as on a vector or null surface, and where neither a document nor `OffscreenCanvas` exists, as in Node. Layers, sprites and the [film finish](#film-finish) make their copies with it; use it for a scratch canvas of your own in `draw`, and handle `null`.

[`tests/fixtures/sprite-film.cjs`](../../tests/fixtures/sprite-film.cjs) draws 60 textured cutouts of 12 kinds, each turning and scaling, over a sheet that gains 8 settled marks a frame; the cutouts that grow past their own size are baked at `scale: 2`. The fixture's `keep` parameter set to 0 bakes every sprite afresh, and `direct` set to 1 paints without sprites. In installed Edge 154, at its 1920 by 1080 film size, frames drawn from kept copies were faster than painting directly or baking every draw, on CPU-backed and GPU-backed canvases alike. They held the same bytes as frames baked afresh on both canvases, over 96 frames in order and then 13 revisited out of order, so older keys were baked again after newer ones.

Because the sheet grows in place, it holds one canvas over the whole film. A second pass over the same frames, as a looping preview draws them, makes one new canvas, for the sheet's first key.

Run `node --test tests/layer.test.js` for the sprite rules: one bake per solve and scale, growth in place from the nearest older copy, a new canvas only where no older copy is kept, an older key baked again, each span painted from the default state with an empty path, no copy left after a paint that throws, the budget and its eviction order, the transform and smoothing a copy is drawn with, the refused values, the refused bake past `MAX_BAKE`, and direct drawing on vector and null surfaces.

## Part frames

`partFrames(root, at)` in [`core/layer.js`](../../core/layer.js) works out where every part of a tree of attached parts sits, and returns a `Map` from each part's name to its transform, `[a, b, c, d, e, f]`: the six numbers `surface.transform(...)` and a sprite's `at` take. A part placed in its parent's frame takes on everything its parent does and passes it to its own children, so no joint drifts apart. Unlike nested `save` and `restore`, the parts can then be drawn in any depth order.

| Key of a part | Default | Meaning |
| --- | --- | --- |
| `name` | required | The part's own name, a non-empty string, used once in the tree. |
| `at` | `[0, 0]` | Where the part's origin sits in its parent's frame. |
| `turn` | `0` | Radians the part is turned about its origin. |
| `scale` | `1` | A number, or `[sx, sy]`, the part is scaled by at its origin. A squash here deforms every part below it. |
| `kids` | `[]` | The parts attached to this one. |

A part's transform is its parent's followed by its own move, turn and scale. `at`, the second argument, is the frame the root sits in, six finite numbers, and defaults to no transform. `framePoint(m, [x, y])` returns where a point in a part's own frame lands under its transform `m`: the place of a contact, a held thing or a sound's source. A part without a name, a name used twice, `kids` that is not a list and a value that is not a finite number each throw, naming the part.

## Images

A piece can declare `images`, the images a user gives it, so it can draw over an image, from an image or after one. Each image is decoded pixels, not a PNG or JPEG file. Base64 text decodes the same way in Node and in every browser, so build, draw and replay read the same numbers everywhere.

`images` is `null` by default, or an object of named images. Make each image with [`npm run image`](../knowledge/command-line-tools.md#turning-an-image-into-a-module-a-piece-declares) and declare the module it writes:

```js
images: { photo: require('./photo.image.js') },
```

| Key | Meaning |
| --- | --- |
| `w`, `h` | The size in pixels: whole numbers above 0, at most 16,777,216 pixels in all (`MAX_PIXELS`). |
| `channels` | `1` (grey), `3` (RGB) or `4` (RGBA). |
| `pixels` | Base64 text of exactly `w` x `h` x `channels` bytes, row by row from the top left, 8 bits per channel in sRGB. |
| `source` | Where the image came from, such as the user's own photo or a URL. Required, at most 200 characters. |
| `rights` | Whose the image is and on what terms, as the user gave them. Required, at most 200 characters. The library grants no rights. |

A name starts with a lowercase letter and holds only letters and digits, such as `photo` or `ground2`, so `state.images.photo` reads it. Validation refuses a declaration by name and key: a wrong size, a channel count other than 1, 3 or 4, text that is not base64 or holds the wrong number of bytes, a missing `source` or `rights`, and any other key.

`solve` gives each declared image to the build stages and to `draw` as `state.images.<name>`: `{ w, h, channels, data, source, rights }`, where `data` is a `Uint8Array` of the decoded bytes. Each solve gets its own copy of `data`, so a build stage that changes the bytes changes only that solve.

### Reading an image

Import these functions from [`core/image.js`](../../core/image.js). Each takes a solved image, such as `state.images.photo`, and throws a `TypeError` when given anything else. `u` and `v` run from 0 to 1 across the image's width and height.

| Function | Returns |
| --- | --- |
| `sample(img, u, v)` | The colour at `(u, v)` as `[r, g, b, a]`, each from 0 to 255, read between pixel centres and held at the edges. A grey image gives `r = g = b`; an image without an alpha channel gives `a = 255`. |
| `tone(img, u, v)` | The tone at `(u, v)` from 0 (black) to 1 (white): the Rec. 709 luma of the sRGB values. |
| `toneField(img, rect)` | The tone as a field `(x, y) => tone` in design units, with the image laid on `rect`, `[x, y, w, h]` (default `[0, 0, 1, 1]`). Outside `rect` it holds the edge's tone. The [field functions](../../core/field.js) take it, so contours, edges and streamlines can follow the image. |
| `fit(img, box, mode)` | Where the image lies in `box`, `[x, y, w, h]`, as `[x, y, w, h]`, centred. `'cover'` (default) fills the box and cuts the image on one axis; `'contain'` keeps the whole image inside the box. It also takes a declared image. |
| `show(g, img, x, y, w, h)` | Draws the image's pixels on a raster surface at `[x, y, w, h]` in the surface's current units, smoothed at high quality, with the caller's alpha, blend and clip. |
| `palette(img, k)` | The image's dominant colours, at most `k` (default 8, from 1 to 64), largest first, as `[{ colour: '#rrggbb', share }]`. The shares of the opaque pixels (alpha 128 or more) add up to 1. It keeps no position. An image with no opaque pixel gives `[]`. |
| `values(img, at)` | The image's OKLab lightness, from 0 to 1, at each share in `at` (default `[0.05, 0.25, 0.5, 0.75, 0.95]`) of its opaque pixels sorted from dark to light. It keeps no position. An image over 2^18 pixels is read on an even grid of at most that many. |
| `structureField(img, rect, opt)` | The way the image's structure runs, as a field `(x, y) => [vx, vy]` in design units with the image laid on `rect`. The vector lies along the line of least change: along an edge, a grain or a fold. Its length is the coherence, from 0 to 1, and `[0, 0]` where the image is flat. `opt.smooth` (default 0.015, from 0 to 0.1) is the neighbourhood's size as a share of the image's longer side: a feature much smaller than it is averaged into what surrounds it. `rect` must have a positive size. |
| `regions(img, n, opt)` | The image cut into about `n` (default 64, from 1 to 4096) blocks of like colour, as `{ cols, rows, label, regions, at }`. `label` gives each cell of a `cols` x `rows` grid its block's index, `at(u, v)` the block at a point, and `regions` each block's `{ colour, share, centre: [u, v], box: [u0, v0, u1, v1] }` in seed order, row by row. `opt.compactness` weighs place against colour, in OKLab units: higher gives squarer blocks, lower ones that follow the colour. By default it is half the image's colour spread (the root-mean-square distance of its cells from their mean colour, at least 0.01). There is at most one block a cell of the grid, so a small image gives fewer than a large `n` asks for. |

`structureField` and `regions` read the image averaged in linear light onto a grid whose longer side is `opt.size` cells (from 16 to 512; by default 384 for `structureField` and 192 for `regions`), so their cost does not grow with the image. They do not read alpha, and they read the bytes once per solve: change `img.data` before the first call, not after. One image keeps its last four grids, and one grid its last four values of `smooth`, so pass the same `size` and `smooth` on every frame. Each function is deterministic and takes no seed.

`structureField` gives an orientation: a vector and its opposite mean the same line. Walk it with `axial: true`, from [`core/field.js`](../../core/field.js): `evenStreamlines(field, bounds, { separation, axial: true })` fills a rectangle with long lines along it, and `streamlines(field, seeds, { axial: true })` walks from seeds of your own. With `axial: true` a walk keeps the way it is heading and never turns back, and `heading` picks which of the two ways a `streamline` starts. See the [field API](fields.md#lines-that-fill-a-region).

`show` puts the pixels on a canvas of their own once per solve and target canvas, then draws that canvas. A vector surface has no pixels, so `show` throws on it by name. A piece that also declares `'vector'` output calls `show` under `if (g.canvas)`, and its SVG then holds only the marks drawn over or from the image. On the surface that `layerSwaps` and `recordMarks` in [`tools/contact-sheet.js`](../../tools/contact-sheet.js) record paint order on, `show` is recorded as one `drawImage` of the image's rectangle, so a raster-only piece's layers can be checked with the image among them. On another surface without a canvas, such as the benchmark's null surface, `show` draws nothing.

```js
draw(g, state) {
  const img = state.images.photo;
  if (g.canvas) show(g, img, ...fit(img, [0, 0, 640, 360]));
  // Marks drawn from the image, such as discs sized by tone(img, u, v).
}
```

### Records of an image

The replay manifest of every saved file names each image under `images`: its `w`, `h`, `channels`, `source`, `rights` and `digest`, never its pixels. The digest is `fnv1a32:` and 8 hexadecimal digits, the 32-bit FNV-1a hash of the decoded bytes. It tells one image from another. It does not prove that an image was not forged. `npm run replay` refuses a file drawn with another image, or without an image the piece now declares, and names the image and the key that changed.

The page built by `npm run page` shows an **Images** group for a piece that declares images, with each image's name, size, source and rights. The page's `read()` returns them as `images`, a list of `{ name, w, h, channels, source, rights }`, empty for a piece without images.

Run `node --test tests/image.test.js` for the readers and `show`, and `node --test tests/piece.test.js` for the refusals, the copy per solve and the digest. [`tools/fixtures/image-piece.cjs`](../../tools/fixtures/image-piece.cjs) draws discs sized by the tones of an image made in code; `npm run browser` draws it in installed Edge and replays its PNG and its film.

## Soundtrack

A piece with a timeline may declare `sound(ctx, state, timeline)`. It builds a Web Audio graph on an `OfflineAudioContext` whose length is the film's: `timeline` holds `duration` (`frames / hz` seconds), `frames`, `hz` and `loop`. The graph is rendered offline, faster than real time, and muxed with the film. For a film with `loop: true` the context runs on past the film, by up to six seconds and never more than the film's length, and what rings there is added to the film's first frames, so the seam sounds as the loop heard twice would; `ctx.length` is then longer than the film, and `timeline.duration` is still the film's. `sound` may be `async`; the render waits for it, so a piece can `await ctx.decodeAudioData(bytes)` and play a recorded track.

```js
sound(ctx, state, timeline) {
  const tone = ctx.createOscillator();
  const level = ctx.createGain();
  level.gain.setValueAtTime(0.2, 0);
  level.gain.linearRampToValueAtTime(0, timeline.duration);
  tone.connect(level);
  level.connect(ctx.destination);
  tone.start(0);
  tone.stop(timeline.duration);
},
```

A second of sound is the second `clock.seconds` names in `draw`, so schedule each sound at the second its picture appears and derive both from the same solved state. Take noise from the seeded source rather than an unseeded generator, and schedule only on the context clock. A still cannot declare `sound`; validation refuses it by name. `sound` must build the same graph every time it renders one solved state. Installed Edge adds up three or more connections into one input in an order that changes between renders, so such a graph repeats its samples only to their last bits, and two films of it differ in their audio bytes. Two connections add up the same either way round. `sumInto(ctx, nodes, into)` in [`core/sound.js`](../../core/sound.js) connects any number of nodes to `into` through a balanced tree of gain nodes at unity, one for each node past the second, so no input takes more than two; `into` must take no other connection. `readout`, `settle` and `cues` sum their voices with it, and in Edge 153 two renders of each soundtrack and two MP4 exports of each film, in one page and across page loads, were identical byte for byte. Compare a soundtrack with a wider sum by measurement. `npm run browser` requires two renders of each example to hold the same bits in every sample. Other browsers can differ further, like pixels. [`examples/readout.js`](../../examples/readout.js) sounds each digit on the frame that first shows it, and [`examples/cues.js`](../../examples/cues.js) each part of a scene change on the frame that first shows it turning. Cues also sounds its motion from the same cue table: the disc's slide as it starts in, the bar's landing, each hop, the blink, the bar's rock and the disc's settle, each a short voice, and a bump's voice as hard as the bump is large. [`examples/settle.js`](../../examples/settle.js) reads its events off the snapshots `draw` shows, through the same lookup: an edge that comes taut snaps on the frame that first stretches it that fast, two discs knock on the frame they meet, and a plucked node rings on its frame. Each event is one short voice, pitched on a whole harmonic of one root, panned to the side of the field it is on and placed as far off as it stands from the middle. Each is as hard as the motion that made it: a snap or a knock on the logarithm of its speed over the range its own kind spans, measured over many seeds, and a pluck by how far its node flies on its frame. So the opening rattle runs from soft to full, and most knocks after the first pluck sound at their own level, though about one in nine still sits at the softest. No bundled example sets a control on every frame; a piece that does gives the AudioParam each frame's value from the snapshot `draw` shows, `setValueAtTime` on the first frame and `linearRampToValueAtTime` after.

A recorded track must travel with the piece. A piece bundles only `.js`, `.cjs` and `.json` files, so hold the track's bytes in one of them, for example as base64 text, and give `decodeAudioData` a fresh copy on every render, because decoding takes the buffer it is given. `decodeAudioData` also resamples the track to the render's 48 kHz, and the browser chooses how, so the samples a recorded track yields belong to the browser as well as to the piece. [`tests/fixtures/decoded-track.cjs`](../../tests/fixtures/decoded-track.cjs) writes a 0.3-second mono 16-bit WAV at 44.1 kHz when it loads and plays it eight times at rates from 0.5 to 2. In installed Edge 154, two renders of its soundtrack held the same bits, and its MP4 film replayed as matching: every block of the AAC soundtrack was within 25 dB of the render, the worst at 41.4 dB. The same samples handed over undecoded at 44.1 kHz, so that Web Audio's playback resampler converts them instead, changed 214,989 of 384,000 samples by a difference 69.2 dB below the soundtrack, and the film still replayed as matching, again at 41.4 dB. So replay holds for a WAV decoded by the browser that exported the film. To measure again, run `npm run film -- ./tests/fixtures/decoded-track.cjs --out out/decoded-track.mp4`, then `npm run replay -- out/decoded-track.mp4 --piece ./tests/fixtures/decoded-track.cjs`.

A compressed track does not decode to the samples it was made from. [`tests/fixtures/compressed-track.js`](../../tests/fixtures/compressed-track.js) holds the same tone as 3,703 bytes of AAC-LC (Advanced Audio Coding, low complexity) in ADTS frames, encoded at 96 kbit/s by installed Edge 154's `AudioEncoder`, and plays it as `decoded-track.cjs` does. [`tests/fixtures/measure-compressed-track.js`](../../tests/fixtures/measure-compressed-track.js) makes the track again in installed Edge, where Edge 154 made the same bytes, and measures how it decodes. Decoded at the track's own 44.1 kHz, the track's 13,230 samples became 13,312, thirteen whole AAC frames of 1,024 samples; decoded at the render's 48 kHz, they became 14,489. From one decode, the tone started about 9 to 10 ms late: the lag that best aligned it with the source was 399 samples, and its first sample above 0.02 came 446 samples later than the source's. The end of its fade was cut off, and even when aligned, the decode differed from the source by an error only 11.5 dB below it, which this measurement does not explain. Two decodes at 48 kHz, and two renders of the soundtrack, held the same bits, and the MP4 film replayed as matching, with every block of the AAC soundtrack within 25 dB of the render, the worst at 38.8 dB. So replay held for an AAC track when the browser that exported the film also replayed it, presumably because both decode the track the same way. Place a compressed track's sounds by ear, or measure its delay, rather than by its source's timing. Other browsers and versions, and other formats such as MP3 or Opus, are unmeasured. To measure the decode again, run `node tests/fixtures/measure-compressed-track.js`, which prints its figures as one line of JSON and writes the track it made to `out/compressed-track.aac`. To measure replay again, run `npm run film -- ./tests/fixtures/compressed-track.js --out out/compressed-track.mp4`, then `npm run replay -- out/compressed-track.mp4 --piece ./tests/fixtures/compressed-track.js`.

[`core/sound.js`](../../core/sound.js) also builds sounds for any subject; no function names an instrument.

| Function | Contract |
| --- | --- |
| `voice(ctx, R, name, at, spec)` | One sound in three layers started at `at` seconds, returned as a stereo panner at `spec.pan` (default `0`, from -1 to 1), or moving through it when `pan` is a list of `[seconds, pan]` points in time order after `at`, linearly between them, holding the first point before it and the last after it. The **transient**: seeded noise through a bandpass at `strike.colour` Hz (default 3000), falling to -60 dB over `strike.length` s (default 0.03); off unless `strike.level` > 0. The **body**: a sine partial at `pitch * ratio` for each `[ratio, level]` in `partials` (default `[[1, 1]]`), rising linearly over `attack` s (default 0.005), held for `hold` s (default 0), then falling exponentially to -60 dB over `decay / ratio ** damp` s (defaults 1 and 0.5); `detune` cents (default 0) makes each partial two oscillators that far apart at half level each. A partial at level 0 builds no oscillator, and a silent voice, at `level` or `velocity` 0, builds nothing at all. `pitch` is required unless the body is silent, every partial level 0 or the voice silent, a `pitch` you do give is still checked, and a tail over a silent body of a sounding voice needs its own `tail.colour`. The **tail**: seeded noise through a wide bandpass at `tail.colour` Hz (default `pitch`), rising linearly over `attack` while it falls to -60 dB over `tail.length` s (default 1.5) from its start; off unless `tail.level` > 0. `tail.rise` s (above 0), when given, rises it over that long instead and starts its fall at the peak, so the tail lasts `rise + length` and can swell before it falls. `level` (default 1) scales all three. `velocity` (default 1, from 0 to 1) scales the level again, each partial by a further `velocity ** ((ratio - 1) / 2)` above the first, and the transient by `velocity` once more, its band at `(0.5 + velocity / 2)` of its colour, so a softer start is darker. `vary` (default 0, from 0 to 1) moves this voice, from `R(name, 'vary', k)`, by up to `vary` times 12 cents of pitch, 3 dB of level, 20% of decay and 2 dB of each partial. Every layer then fades linearly to zero over 80 ms and stops. A note can also move while it sounds; each of these is off unless given, and its times are seconds after `at`. `bend`, a list of `[seconds, cents]` points in time order, glides the body's pitch through those offsets, linearly in cents, holding the first point before it and the last after it. `vibrato`, `{ depth, rate, delay, rise }`, swings the body's pitch `depth` cents (up to 1200) either way `rate` times a second (default 5, up to 20), from `delay` s (default 0), growing to full depth over `rise` s (default 0.3); `vary` moves its rate by up to `vary` times 10%, from `R(name, 'vibrato', 0)`. `sweep`, a list of `[seconds, hertz]` points in time order, is a low-pass over the whole voice whose corner moves through those frequencies, exponentially between them. `distance` (default 0, from 0 near to 1 far) scales the level by `10 ** (-0.75 * distance)`, 15 dB down at 1, and above 0 adds a low-pass at `16000 / 8 ** distance` Hz, 2 kHz at 1, for the air the sound crosses; send a far voice more to the room. `fm`, `{ ratio, index }`, modulates each partial's frequency at audio rate: a sine modulator at `ratio` (default 1, above 0, up to 16) times that partial's frequency swings it by `index` (from 0 to 20; 0 builds nothing) times the modulator's frequency. The partial then gains sidebands `ratio` times its frequency apart, more and louder as `index` grows: a whole `ratio` keeps the partial's harmonics, a simple fraction such as 0.5 makes a harmonic series under it, and any other clangs. The modulator follows the partial's `bend` and `vibrato`, and its swing rises, holds and falls with that partial's envelope, so the sound darkens as it dies. Keep the top partial's frequency times `1 + ratio * (index + 1)` under half the sample rate, or its highest strong sidebands fold back as other pitches. `highpass`, `{ peak, rest }`, is a Butterworth high-pass over the whole voice, before `sweep`, whose corner follows the envelope: at `rest` Hz (default 20, above 0 and at most `peak`) before the voice starts, rising exponentially to `peak` Hz (under half the sample rate) over `attack`, held through `hold`, then falling exponentially back to `rest` over `decay`, so the attack is thin and the lows return as the sound dies. A voice given none of these six, a single `pan` and no `tail.rise` builds the same graph and noise it did before they existed. The noise is `R(name, 'strike' \| 'tail', sample)`. Invalid values throw `RangeError` naming the voice and the value; `strike`, `tail`, `vibrato`, `fm` or `highpass` given as anything but an object, such as `null`, throws `RangeError` naming the voice and that key. |
| `ambience(ctx, R, name, at, spec)` | The sound of a place, started at `at` seconds and lasting `spec.length` s, returned as a stereo `AudioBufferSourceNode`. Its **bed**: seeded noise, its own on each side, through two band-passes in a row centred on `colour` Hz (default 800, under 0.45 of the sample rate) and together `band` octaves wide (default 2, up to 8); `level` (default 0.05, 0 leaves it out) is its RMS at its colour. The colour wanders up to `drift` octaves either way (default 0.5, up to 2), and each side's bed level up to `drift` times 6 dB, smoothly, about `pace` times a second (default 0.3, up to 10). `tint` sets the bed's noise before its band-passes: `'white'` (default), `'pink'`, about 3 dB quieter each octave up, or `'brown'`, about 6 dB quieter each octave up above about a 1250th of the sample rate (38 Hz at 48 kHz) and flatter below it. Pink and brown keep less hiss in a wide bed and so sound softer; `level` is still the bed's RMS, the noise keys stay the same, and grains are never tinted. Any other `tint` throws `RangeError`. Its **grains**, when `grains` is given: `grains.rate` events a second (up to 2000) at seeded times, each a sine at a seeded pitch in the band around the colour of that moment, rising `grains.chirp` octaves (default 0, from -4 to 4) as it falls to -60 dB over `grains.length` s (default 0.02, up to 2, and at least 5 ms shorter than the ambience), then fading linearly to zero over 5 ms, which leaves no click and costs a sixteenth of a voice's 80 ms fade; each is set at `grains.level`, less a seeded 0 to `grains.spread` dB (default 12, from 0 to 60), at a seeded place between the two sides. A grain's 1 ms linear rise meets its fall, so it peaks under that level: by a factor of e^(−6.9 ms / `grains.length`) for grains 6.9 ms or longer (−3 dB at the default 20 ms, −1.2 dB at 50 ms), and of `grains.length` / 18.8 ms below that (−11.5 dB at 5 ms, −16 dB at 3 ms, −25.5 dB at 1 ms). Each grain's sine starts at 0, so a pitch whose quarter cycle outlasts the envelope's peak, at 1 ms for grains 6.9 ms or longer and at `grains.length` / 6.9 below that, peaks lower still: under about 250 Hz at any length (−6 dB rather than −3 dB for a 100 Hz grain of 20 ms), and higher for a shorter grain (under about 575 Hz at 3 ms). To have a short grain peak at a given level, raise `grains.level` by that factor. `grains.noise` (default `false`) set to `true` makes each grain seeded noise through a one-octave band-pass at its pitch, gliding with its chirp, instead of a sine: a dry tick where a sine grain reads as wet. Each noise grain keeps the sine grain's time, place, level, envelope and fade, and its band is full from its first sample, so it carries the power of a sine held at its level under that envelope: within 0.5 dB of the sine grain from 1 kHz up for grains 2 ms or longer (about 0.9 dB under it at 1 ms). Lower down it differs only as the sine grain's own start does: it sits above the sine grain where the sine barely rises (about +13 dB for a 1 ms grain at 100 Hz, +5 dB at 3 ms, +17 dB for a 1 ms grain at 60 Hz) and up to about 1.3 dB under it around 300 Hz, where the sine's first peak meets the envelope's. Its peaks, being noise, can pass `grains.level`. Any other value of `grains.noise` throws `RangeError`. `grains.rate` may instead be a list of `[seconds, rate]` points from the ambience's start, times in order and each rate from 0 to 2000: the rate runs linearly between points and holds before the first and after the last, the ambience makes as many events as that curve adds up to over its length, and each event's seeded time falls where the curve is dense, so rain can build and thin. A plain number keeps the uniform times it gave before curves existed. The whole ambience rises from silence over `fade` s (default 1, at least 0.08) and falls back to silence over the same; `length` must be at least twice `fade`. The noise is `R(name, 'bed left' \| 'bed right', sample)`, apart from a room's of the same name, each grain `R(name, 'grain', 4 * index + 0..3)`, the noise of noise grains one shared second of `R(name, 'grain noise', sample)` (for grains over 0.895 s, as long as a grain with its fade plus 0.1 s) that each grain reads from `R(name, 'grain offset', index)`, and the wandering `noise2(R, seconds * pace, row, name + ' drift')`. A place is mostly its events: keep the bed low and dark. Invalid values throw `RangeError` naming the ambience and the value; `grains` given as anything but an object throws `RangeError` naming the ambience and `grains`. |
| `room(ctx, R, name, opts)` | A `ConvolverNode` whose stereo impulse is seeded noise, `R(name, 'left' \| 'right', sample)`, with its early reflections at `R(name, 'early', ...)`: silent for `predelay` s (default 0.012, up to 0.2), then falling to -60 dB over `size` s (default 1.6, up to 10) through a one-pole low-pass whose corner slides from `bright` Hz (default 7000) to `dark` (default 900, above 0 and at most `bright`), plus `early` reflections (default 6, up to 64) in its first 60 ms. It outputs only the reverberation; the browser normalizes the impulse's power, so `size` changes the room, not its level. `opts` given as anything but an object, such as `null`, throws `RangeError` naming the room. |
| `pluck(ctx, R, name, at, spec)` | A plucked string, or anything taut that rings when let go, rendered offline and returned as a mono `AudioBufferSourceNode` started at `at` seconds. One period of seeded noise, `R(name, 'pluck', sample)` with its mean removed and its peak at `level` (default 1, 0 or more), circulates through a delay line that averages neighbouring samples on every pass, so the high partials die first. `pitch` (from 20 Hz to an eighth of the sample rate, 6 kHz at 48 kHz) is the loop's length, tuned to a fraction of a sample by an all-pass filter: in Node, eight pitches from 55 Hz to 4 kHz each measured within 1 cent. The fundamental falls to -60 dB over `decay` s (default 1, above 0 and at most 30), the higher partials sooner, and the whole then fades linearly to zero over 80 ms. Where the averaging alone would end a high note sooner than `decay`, about 1.5 kHz and up at a 1 s decay, the average leans towards the newer sample, so the note still rings for `decay`. The render is offline because a Web Audio feedback loop must hold a delay of at least one 128-sample render quantum, so a loop built from nodes cannot ring above 375 Hz at 48 kHz. Invalid values throw `RangeError` naming the pluck and the value. |
| `impact(ctx, R, name, at, spec)` | One hit on a thing that rings, rendered offline and returned as a mono `AudioBufferSourceNode` started at `at` seconds. `modes` (required) are `[hertz, seconds, level]` triples: each is a two-pole resonator at its frequency (under half the sample rate) that falls to -60 dB over its seconds (above 0, at most 30), at its level (default 1, 0 or more). They are excited by one raised-cosine pulse `contact` seconds long (default 0.002, from 0.0002 to 0.05), so a longer contact leaves high modes less rung, and a mode at 2, 3 or more times `1 / contact` hertz sits in a gap of the pulse. `velocity` (default 1, from 0 to 1) scales the peak and lengthens the contact to `contact * (2 - velocity)`. `rough` (default 0.1, from 0 to 1) mixes seeded noise, `R(name, 'impact', sample)`, into the pulse. The buffer's peak is `level * velocity` (default level 1), it lasts the pulse, the longest mode and 80 ms, and its last 80 ms fade to zero. Invalid values throw `RangeError` naming the impact and the value. |
| `shaker(ctx, R, name, at, spec)` | Many small things striking, rendered offline and returned as a mono `AudioBufferSourceNode` started at `at` seconds and lasting `length` (required, from 0.08 to 600 s). On each sample a collision happens when `R(name, 'hit', sample)` is under `rate / sampleRate`; it adds `energy` to a level that falls to -60 dB over `ring` s (default 0.01, above 0, at most 2) and scales seeded noise, `R(name, 'grit', sample)`, which passes through `modes` as `impact` takes them (default `[[3000, 0.004, 1]]`). `rate` (required, 0 to 20000 a second) and `energy` (default 1, from 0 to 1) are each a number or `[[seconds, value], ...]` points, linear between them and held outside. The buffer's peak is `level` (default 1) and its last 80 ms fade to zero. Invalid values throw `RangeError` naming the shaker and the value. |
| `recipe(kind, opt)`, `play(ctx, R, name, at, kind, opt)`, `INSTRUMENTS`, from `core/instruments.js` | Acoustic voices by name: `celesta`, `vibraphone`, `marimba`, `strings`, `flute`, `brush`, `cajon`, `cymbal` and `pluck`, listed in `INSTRUMENTS`. `recipe` returns the spec for one note, to hand to `voice` (to `pluck` for `'pluck'`) or to change first; `play` plays it and returns its output node. `opt.pitch` is in hertz, needed by the pitched ones; `opt.length` (default 1) is the seconds the note is held or rings; `opt.velocity` (default 0.8, from 0 to 1) is how hard it starts, softer being darker; `opt.level`, `opt.pan` and `opt.vary` (default 0.3) pass through. Each recipe follows the instrument's physics: a vibraphone bar's partials at 1, 4 and 10 with a beat near 5 Hz, a marimba's short wooden decay, a string's partials at one over their number under a slow bow, a flute's breath. A name not in the list throws `RangeError`. |
| `ducking(events, opts)` | How far music dips under the sounds something on screen causes, worked out from the score with no signal detector: `[[seconds, gain], ...]` points in time order, linear gains from 1 down, over the first `opts.length` seconds (required, above 0). Each event is `{ at, length, level }`: its start in seconds, how long it stays on top (default 0.1 s) and its linear peak. An event asks for a dip of `(1 - 1 / ratio)` of the dB its `level` passes `threshold` by (defaults 2 and 0.05), at most `depth` dB (default 6, from 0 to 60); an event with no `level` asks for the whole `depth`, and one at or under the threshold for none. The dip follows what is asked, in dB, through a one-pole smoother with two time constants, as a compressor's level detector does: it closes over `attack` s (default 0.03) and lets go over `release` s (default 0.35), 63% of the way in each, and starts `lead` s before each event (default three attacks), so it is 95% down as the sound lands. Points are `1 / rate` s apart (default 100 a second, from 10 to 1000) and left out where the gain rests; under 0.001 dB the dip is over and the gain is exactly 1. Invalid values throw `RangeError` naming `ducking` and the value. |
| `duck(ctx, events, opts)` | A `GainNode` whose gain follows `ducking(events, opts)` on the context's clock, set at its first point and ramped linearly to each later one. Sum the music into it with `sumInto` and sum it with the caused sounds; it must take no other input. |
| `hertz(note, a4)` | The frequency of MIDI note `note` with A4 (69) at `a4` Hz (default 440): `a4 * 2 ** ((note - 69) / 12)`; 60 is middle C, a fractional note is cents. A non-finite note or an `a4` at or below 0 throws `RangeError` naming it. |
| `scoreCurves(R, notes, { hz, frames, grid })` | What a score will do, read from its notes with no audio rendered, so `draw` can move on it. Each note is `{ part, name, at, spec }`: the `name`, `at` and `spec` it hands to `voice`, with the same `R`, and the part it belongs to. `grid`, from `bars`, is optional. Returns `beats`, `[{ bar, beat, seconds, frame }]`, empty without a grid; `onsets`, `[{ part, name, at, frame, velocity }]` in time order, `frame` the nearest whole frame; and `energy`, `{ [part]: Float64Array(frames) }`, each frame's loudest moment of the part's body partials as `voice` schedules them, its notes added as power. It follows attack, hold, each partial's decay, level, velocity, distance and `vary`. Noise layers, filters, `fm`, `detune` beating and the room are not in the curve, and a looping film's tail does not wrap. The example [`pulse`](../../examples/pulse.js) moves one kind of mark on each voice. Invalid values throw naming the note and the value. |

A `voice` or `ambience` spec given as anything but an object, such as `null`, throws `RangeError` naming the sound. `voice`, `ambience` and `room` take at most two connections into any input they build, and a `pluck` takes none. In installed Edge 153, two renders each of two 8-second soundtracks of voices in a room, one of 15 voices and one of 138, held the same bits. [The film scaffold](../../skills/artifex/film-scaffold.cjs) in the runtime skill wires them into a cue table. It sends each voice to the room more as its `distance` grows, folds each send to one channel and divides its gain by the panner's sum, so the room takes as much of a panned voice as of a centred one on both sides, and keeps an ambience out of the room unless the row gives `wet`, because an ambience is already the wide, diffuse sound of the place and its `level` then stays the level heard. An ambience whose grains are noise (`grains.noise: true`) is many hits as one texture, so the scaffold folds its send to one channel too and divides its gain by the panner's sum averaged by power over the grains' seeded places, `Math.sqrt((1 + 2 / Math.PI) / 2)`: each grain then reaches both sides of the room, on average as loud as a centred voice at the same `wet`, from 0.9 dB over for a centred grain to 2.1 dB under for a hard-panned one. Every other ambience keeps a stereo send at its `wet`. It refuses a row that has neither `voice` nor `ambience`, and a row that has both ("keep one, or split them into two rows"), each naming the row by its time and cause; an `offscreen` that is given and is not an object, `null` aside, naming the sound by its index ("sound 0 has an offscreen that is not an object"); and an ambience row that ends after the film's end. A row's cause must be on screen on the row's frame, where an element that lists its `shots` is on screen only in those shots, unless the row gives `lead` or `trail` in seconds: then the cause may enter up to `lead` seconds after the sound starts, or have exited up to `trail` seconds before it, so a place's sound can bridge a cut. A voice row whose cause is never shown declares `offscreen: { side, distance }`, with `side` `'left'` or `'right'` and `distance` from 0 to 1; the scaffold pans that voice to 0.8 of the side, so a phone folding to mono loses little of it, and sets its `distance`, replacing any `pan` or `distance` the voice gives, and refuses the row while its cause is on screen, or when it also gives `lead` or `trail`. Every row is still named by its cause and frame, so its noise, and replay, stay the same. The scaffold's `CONTACTS` slot lists every planned touch as `{ at, cause, x, y }`, and its cue table carries each as `cues.contacts`, with `x, y` as frame coordinates after the camera at the cause's depth (camera keys are checked first) and the design point as `design: [x, y]`. It refuses a contact with `the contact at <at> s needs a second within the film and a design point x, y`, which covers a second outside the film and a missing or non-finite `x` or `y`, and one with `the contact at <at> s has no cause on screen: <cause>`, or, when the row has no `cause` (or `null`), `the contact at <at> s has no cause key: add cause: 'name' of the element on screen that touches`. A sound row not given `offscreen` meets the same two refusals, `the sound at <at> s has no cause on screen: <cause>` and `the sound at <at> s has no cause key: add cause: 'name' of the element on screen that makes it, or offscreen: { side, distance } for one never shown`. A row with `offscreen` may leave `cause` out; naming it keeps the sound's noise stable when other rows move. It refuses a beat in the first 6 frames at 24 fps after a cut between shots, `Math.ceil(hz / 4)` frames at any rate, with `beat <i> at <at> s falls <n> frames after the cut to <shot>`, and one that soon after two camera keys at one second, which cut the framing, with `... after the camera cut at <at> s`; it names the latest cut before the beat. It refuses a `FOCUS` row marked `jolt` whose shot comes that soon after the cut before it with `the jolt to <shot> comes <n> frames after the cut to <shot>`, and one whose shot starts that soon after a camera cut with `... after the camera cut at <at> s`; it names the latest cut before the jolt. It also refuses a camera cut that falls within that time after a jolt shot starts, with `the camera cut at <at> s comes <n> frames after the jolt to <shot>`, and a cut to the next shot that soon, from a jolt shot shorter than that time, with `the cut to <shot> comes <n> frames after the jolt to <shot>`. It refuses a cut where the eye jumps more than a third of the frame's width, unless the later shot's `FOCUS` row is marked `jolt` or a row carries the motion across the cut (`carry`), with `the eye jumps more than a third of the frame from <shot> to <shot>: move the focus, or mark <shot> as a jolt`. A shot has one `FOCUS` row, `{ shot, in: [x, y], out: [x, y], jolt?, carry? }`. `carry: 'in'` leaves the cut into the shot unchecked and `carry: 'out'` the cut out of it; a carry row leaves out the point its carry drops and is refused when it gives one, with `the focus for <shot> carries in, which drops its in, and gives one: take the in out of the row, or drop the carry`, and when there is no cut to carry, `'in'` on the first shot or `'out'` on the last. A jolt is about the cut into its shot, so a jolt row may carry `'out'` and one that carries `'in'` is refused with `the focus for <shot> is a jolt and carries in: ...`. It also refuses a camera cut inside a shot where the eye jumps that far, unless a `CAMERA` key of that cut after its first gives `jump: true`, with `the eye jumps more than a third of the frame at the camera cut at <at> s in <shot>: move the camera keys or the focus, or give camera key <i> jump: true`, naming the cut's last key. Two or more `CAMERA` keys at one second make one cut, measured from the view on the frame before it to the last key's view. A `CAMERA` key gives `jump` only as `true`, and only on a key on the same frame as the key before it, which is a key that cuts the framing (the second of two keys at one second, or the third of three); a `jump` on any other key is refused with `camera key <i> at <at> s allows a jump but cuts no framing: give jump: true only to a key on the same frame as the key before it`, and a `jump` that is not `true` on such a key, such as `false`, with `camera key <i> at <at> s cuts the framing, so jump must be true or left out, got <value>: give jump: true to let the eye jump there`. The film's first frame is not a cut. An element row may list its parts' tracks as `keys: { <track>: [[frame, value], ...] }`, each a list for `keys` from `core/time.js`; the scaffold refuses a track `keys` refuses, naming the element and the track, and warns through `console.warn` when every track of two keys or more keys on the same frames, or when two such tracks carry the same frames and values and the same rate on every key that starts a move (the rate of the last key, of a key followed by another on its frame, and of a key that starts a hold, followed by a key with its value, shape nothing and are not compared). It rounds each key to a whole frame after `TEMPO`, as it rounds beats and sounds, and runs its keys warnings on the rounded keys. It refuses two keys on different frames that round to one frame, and two keys on one frame before frame 0, where the first never plays, with `element <name>'s keys track <track> has keys <i> and <j> on frames <a> and <b>, which land on one frame, <f>: ` and then, on frame 0 or after, `that cuts the track; move them a frame or more apart, or give both one frame to cut on purpose`, or, before frame 0, `that frame comes before the film starts, so the first of them never plays; move them a frame or more apart`; `TEMPO` adds `on the retimed film` as it does for camera keys. Two keys on one frame are a cut when the value that arrives there differs from the value that leaves; keys on one frame with one value cut nothing. The scaffold warns of a cut on a frame where the row is seen, and was seen on the frame before, with neither a beat on the row nor a sound the row causes on that frame, once for each frame. On the first frame the row is seen on, frame 0 included, it warns instead that the switch is never seen, with `the keys track <track> of <name> cuts on frame <f>, the first frame it is seen on, so the switch is never seen: move the cut to a frame after one it is seen on, or drop the key the cut leaves`. A cut on the first frame of a later shot that shows the row again is not warned of: the changed value is a shot change. The scaffold judges each name's track as one track, each row only on the frames it shows: within a shot, a row taking over from another of its name on the frame it enters (a layer change) is a cut when its value there, after any cut of its own on that frame, differs from the value the earlier row brings to that frame, read before any cut the earlier row has on it, by more than float rounding and by more than the earlier row's own change over its last frame, so a ramp split at the takeover, and retimed, stays one motion. An earlier row that keys no such track showed no value, so a takeover from it is never a cut. An element row may list its `states` in order, each with the `shots` that show it, counted from 0; the scaffold refuses a `states` that is not a list, such as `'wide'` or `null`, with `element <name>'s states is not a list of states, got <states>: put its states in a list, such as [{ shots: ['first'] }], or leave the list out`, a state that is not an object, such as `null` or `['wide']`, with `element <name>'s state <i> is not an object, got <state>: write each state as an object, such as { shots: ['first'], signs: ['whole'] }`, a state whose `shots` is not a list, such as `'wide'`, `0` or `null`, with `element <name>'s state <i> shots is not a list of shot names, got <shots>: put the state's shot names in a list, such as ['first']`, a state with no `shots`, which is never shown, with `element <name>'s state <i> has no shots, so it is never shown: name the shots that show it`, a gap in the `states` list, refused as a state that is not an object, a state whose `shots` list is empty, which is never shown, with `element <name>'s state <i> lists no shots, so it is never shown: name the shots that show it`, a state that names a shot the film does not have with `element <name>'s state <i> names a shot the film does not have: <shot>`, one whose shot plays only outside the row's entry and exit with `element <name>'s state <i> names a shot that does not play between its entry and exit: <shot>`, and, when the row lists its own `shots`, one whose shot that list leaves out, where the row is never drawn, with `element <name>'s state <i> names a shot that the row's shots list leaves out: <shot>`. It refuses a `SHOTS` that is not a list with `the SHOTS table is not a list of rows, got <table>: ...`, one with no rows with `the SHOTS table has no rows: ...`, a row that is not a `[name, seconds]` pair, a hole in the list included, with `shot <i> is not a [name, seconds] pair, got <row>: ...`, a name that is not a non-blank string with `shot <i> has a name that is not a non-blank string, got <name>: ...`, seconds that are not a positive finite number with `shot <i> has seconds that are not a positive finite number, got <seconds>: ...`, and a name an earlier shot has with `shot <i> repeats the name <name> of shot <j>: ...`, all as the film loads. It refuses an `ELEMENTS` row that is not an object, a hole in the list included, with `element <i> is not an object, got <row>: ...`, a row whose `name` is not a non-blank string or a Symbol with `element <i> has no name, got <name>: ...`, and a row whose name an earlier row has with `element <i> repeats the name <name> of element <j>: ...` when a frame shows both; two rows of one name pass when one exits on or before the frame the other enters, so a thing changes layer by ending its row and entering a second at its new place in the table, or when no shot shows both. It refuses a row whose `shots` is not a list, such as `'wide'`, `''` or `null`, with `element <name>'s shots is not a list of shot names, got <shots>: put its shot names in a list, such as ['first'], or leave the list out to show it in every shot`, and a row whose `shots` list is empty, which is never drawn, with `element <name> lists no shots, so it is never drawn: name its shots, or leave the list out to show it in every shot`. A hole in a row's `shots` list is refused by its place, with `element <name>'s shots list has a hole at <i>, which names no shot: name a shot there, or take the hole out`, and so is a hole in a state's, with `element <name>'s state <i> shots list has a hole at <j>, which names no shot: name a shot there, or take the hole out`. Camera keys that round to one frame are refused unless both give one second on a frame after 0, which cuts the framing on purpose: two keys at different seconds, or two keys at one second on frame 0, where no cut is counted, are refused with `camera keys <i> and <j> land on one frame, got <at> s and <at> s on frame <n>: ` and then, after frame 0, `that cuts the framing; move them a frame or more apart, or give both one second to cut on purpose`, or, on frame 0, `no cut is counted on frame 0, so only one of them shows; move them a frame or more apart`; a film with a `TEMPO` adds `on the retimed film` after `apart`. The scaffold's `HORIZON` slot is the design y of the eye's level, `null` when left out. A `HORIZON` set to anything but `null` or a finite number, such as the string `'300'`, is refused at build whatever the rows give, with `HORIZON is not a finite design y, got <HORIZON>: give the horizon's design y as a number, such as 300, or null to leave it out`. An element row that stands on the ground gives `foot`, the design y its feet touch, and may give `tall`, its height over the eye's (default 1); the scaffold keeps `height`, `(foot - HORIZON) * tall`, on the row. A row that gives `foot` or `tall` is refused with `element <name> stands at a foot, but HORIZON is not set: give the horizon's design y, such as 300` when `HORIZON` is `null`. It then refuses, in this order, `element <name> has a foot that is not a finite design y, got <foot>: give the y its feet touch, such as 600`, which covers a row that gives a `tall` and no `foot`; `element <name> has a tall that is not a positive finite number, got <tall>: give its height over the eye's, such as 1`; and `element <name> stands with its feet at <foot>, on or above the horizon at <HORIZON>, so it floats: in a level view a standing thing's feet sit below the horizon`. Each of the five has its own mutation in `tests/negative.js`. A refusal prints a cause, a role, a shot name, an element name or a beat question as written when it is a string and as `Symbol(x)`, as JSON, or as a description such as `a function` otherwise, so a value that is not a string never throws instead. A sound row may give `role: 'music'` or `role: 'sting'`, or no role (`null` counts as none), and the scaffold refuses any other role with `the sound at <at> s takes a role of 'music' or 'sting', or none, got <role>`; it warns when a music or sting row's loudest layer, read from its spec before `vary`, is not quieter than a voice row without a role on any frame of that voice's attack and hold, each at the level it has on that frame, so a music or sting row fallen below the voice no longer counts and an ambience rising over a held voice does. Every level is read as the peak of a sine of the same stereo power: a voice's layers at their linear levels, which equal-power panning keeps, its partials falling after its attack and hold and its strike and tail from its start, each at its full level through the attack; an ambience bed's RMS `level` times 2, since each side carries its own noise at that RMS, and times `10 ** (0.3 * drift)`, the most its wander raises a side; and its loudest grain, over every pitch the band reaches, at the peak, positive or negative, its 1 ms rise, its fall and its sine starting at 0 reach under `grains.level`, or, for noise grains, the peak their rise and fall alone reach, since a noise grain holds a sine's power at its level from its first sample at any pitch. An ambience's bed and grains are read through the raised-cosine fade over its `fade` seconds at each end, as it plays. A voice row whose peak is 0, such as one at `velocity: 0`, never draws the warning, and neither does one that starts within `Math.ceil(hz / 4)` frames of a music or sting row starting on the frame of a beat marked `forward: true`. The scaffold also warns when more than one sting starts within `Math.ceil(hz / 4)` frames of one beat. Unless the film loops, it fades the whole soundtrack to silence over the film's last 80 ms, so a voice or the room still ringing at the end fades instead of stopping on a cut; a looping film keeps its level at the seam. In installed Edge 153, two renders each of two 8-second soundtracks that bend, swing, sweep and place their voices at a distance over two or three ambiences held the same bits, and their MP4 films replayed as matching with an AAC soundtrack and with an Opus one. Run `node --test tests/sound.test.js` for the layers, their envelopes, the seeded noise and impulse, the bend, vibrato, sweep and distance graphs, the ambience's bed, grains, noise grains and rate curves, the refusals and the scaffold's cue table, its lead, trail and off-screen rows, room sends, closing fade and refusal of an ambience past the film's end, the frames after a cut in which it refuses a beat or a jolt, its `states` refusals, its element-name refusals and the rows of one name it lets pass, its `HORIZON`, `foot` and `tall` refusals, its `keys`, music and sting warnings, the note-to-frequency helper, and the pluck's pitch, decay, seeded noise and refusals.

`sound` sets the balance of its voices, not the film's level. The MP4 export measures the rendered soundtrack and brings it to -14 LUFS; where its true peak would pass -2 dBTP first, a look-ahead limiter turns the peaks down, by a depth limit that is smaller for a sparse soundtrack (the thresholds and the ramp are in [soundtrack loudness](../knowledge/output-formats.md#soundtrack-loudness)), so the export can change the dynamics of a soundtrack whose peaks stand far above its body. The export report's `sound.limited` gives the deepest cut and `sound.short` a shortfall of more than 3 LU under -14 LUFS.

See the [runtime skill](../../skills/artifex/SKILL.md) for authoring guidance and [output formats](../knowledge/output-formats.md) for delivery limits.

## Film finish

A piece with a timeline may declare `finish`: one treatment `drawFrame` gives every raster frame after `draw`, the same on every frame of the film. Its default is `null`. Every part is optional and off unless declared; unknown keys, out-of-range values and malformed colours are refused by name, and a still (`time: null`) that declares a finish is refused.

```js
finish: {
  grain: 0.35,     // [0, 1]: seeded grain laid in soft light, at a new offset on every frame
  grainSize: 2,    // [0.5, 6], default 1: how coarse the grain is; 1 is 720 grains across the frame's shorter side
  weave: 1.2,      // design units, >= 0: how far the picture moves in the gate, across; half that down
  flicker: 0.025,  // [0, 0.025]: how far a frame's exposure may dip
  vignette: 0.35,  // [0, 1]: how dark the corners fall
  grade: {
    black: '#1d1812', white: '#f4ecdc', tone: '#9c7a52', toning: 0.15,
    red: { toe: 0.3, mid: 0.52, shoulder: 0.35 },    // each channel's tone curve; omitted, a straight line
    blue: { toe: 0.2, mid: 0.47, shoulder: 0.25 },
    shadows: { tint: '#2e5a6e', amount: 0.35 },       // a hue for the dark tones
    highlights: { tint: '#f0b070', amount: 0.25 },    // a hue for the light tones
  },
  bloom: 0.5,      // [0, 1]: how strongly the brightest light glows into its surroundings
  halation: 0.6,   // [0, 1]: how strongly the brightest light casts a red fringe past its edges
  linear: true,    // default false: add bloom and halation in linear light, so the glow also washes over lit shapes
},
```

| Part | What `drawFrame` does |
| --- | --- |
| `weave` | Before `draw`: translates the picture by an offset of at most `weave` across and `weave / 2` down, a slow wander plus a little jitter, and enlarges it about its middle by `1 + 2 * weave / min(w, h)` so no offset uncovers an edge. |
| `bloom` | First after `draw`: reads the frame at half size, keeps each pixel's light above mid-grey (luminance 128 of 255), more the brighter it is and none at 128, averages it into a copy 90 pixels on the frame's shorter side at any scale, blurs the copy across and down with a 9-tap binomial kernel, and adds it back over the frame with `lighter` at alpha `bloom`. |
| `halation` | After the bloom, from the same read and the same copy of the light above the knee: blurs the copy with a 5-tap binomial kernel, keeps only where the blur raises a sample's luminance, which is just past the light's edges, and adds that rise in a fixed red-orange (1, 0.3 and 0.1 of it in red, green and blue) with `lighter` at alpha `halation`. The fringe reaches about 2% of the frame's shorter side past an edge, whatever the light's own colour. |
| `linear` | `true` adds the bloom and halation in linear light instead of with `lighter`, through a shoulder that never passes white, on the frame's own pixels. Both amounts are multiplied by 3.25, so an amount adds about the mean light it adds without `linear`; the gain that matched ran from 2.3 to 3.7 across three films. It needs `bloom` or `halation` above 0. It costs about 30 to 65 ms a frame at 1080p, against about 6 to 12 ms for the two without it. Left out or `false`, the frame's bytes are the ones it had before this option existed. |
| `grain` | A 512-texel square tile of grey noise about mid-grey, made once per solve from the seed; the frame's shorter side holds 720 texels at any scale. Filled with `soft-light` at alpha `grain`, from an offset chosen per frame. |
| `grade` | `tone` with `color` at alpha `toning` (`tone` and `toning` come together). Then, when it declares any of `red`, `green`, `blue`, `shadows` or `highlights`, one pass over the frame's own pixels: each channel through its curve, then the tints. Last, a `multiply` and a `screen` that land each channel's 0 on `black` and its 1 on `white`, which must be lighter than `black` in every channel. Either end defaults to pure black or white. |
| `grade.red`, `.green`, `.blue` | A tone curve for that channel: `{ toe, mid, shoulder }`, each optional. It passes through black, `mid` at the channel's middle input (0.5), and white, so `mid` above 0.5 lifts the channel's middle tones. `toe` in [0, 1] flattens the curve at black, pressing the shadows down; `shoulder` in [0, 1] flattens it at white, rolling the highlights up into white. The defaults, toe 0, mid 0.5 and shoulder 0, give a straight line. `mid` must lie strictly between 0 and 1. The curve is two cubic spans whose slopes keep it rising, so it never turns back. |
| `grade.shadows`, `.highlights` | A tint, `{ tint, amount }`, both required: a `#rrggbb` colour and a number in [0, 1]. The shadow tint weighs `amount` x (1 - L)² and the highlight tint `amount` x L², at the pixel's luminance L after its curves. Each moves the pixel by its tint's difference from the tint's own luminance, so it changes the hue of the tones and keeps their lightness, except where a channel reaches black or white. |
| `flicker` | Black over the frame at alpha `flicker` times a per-frame uniform. At most 0.025; a larger value is refused by name. |
| `vignette` | An elliptical gradient the frame's shape, clear inside half its size, black at alpha `vignette` in the corners. |

Every part is a function of the solved seed and `clock.frame`, so a scrub, an export and `npm run replay` draw the same frame. The bloom, the halation and the grade's curves and tints are functions of the frame's own pixels: they add no change over time that the picture does not make, and the glow and the fringe grow from nothing at the knee, so a light brightening past it does not pop. Their knee, average, blur, curves and tints are whole-number or exactly rounded arithmetic that every engine computes alike from the same pixels; reading the frame at half size and drawing the glow and the fringe back go through `drawImage`, whose smoothing is the browser's. The curves and tints copy the frame's whole device pixels 1:1 into a separate canvas, so the frame's canvas stays where the browser keeps it, and draw them back onto the same pixels, also at a scale that does not divide the design size. The finish is drawn only on a surface with a `canvas`: `renderVector`'s SVG, the benchmark's null surface and recording test surfaces receive the marks alone. The page, MP4 and WebM films, PNG exports, contact sheets and replay all draw through `drawFrame` and carry it. Paint an opaque ground: grain over transparent pixels shows as grey. Implemented in [`core/finish.js`](../../core/finish.js); run `node --test tests/finish.test.js` for validation, pass order, the grade's ends, grain per seed and frame, weave coverage, flicker bounds, the bloom's knee, blur, size at every scale and absence when undeclared, the curves' shape, the grade's whole-pixel read and draw-back at a fractional scale, the tints' kept lightness, the halation's place past edges, and state restoration. [`examples/cues.js`](../../examples/cues.js) declares one.

In installed Edge, on cues at 1920 x 1080, the finish cost almost nothing on the MP4 encoder route's GPU-backed canvas. On a CPU-backed canvas, the export's CPU colour route, it added tens of milliseconds a frame, most of it the grain. Grain spends bitrate: it makes a film several times larger, and the finest grain softens into mottling.

`bloom` alone added a few milliseconds a frame on either canvas. Reading the frame at half size and finding its light above the knee grow with the export's pixel count; the blur does not, because the copy it blurs is 90 pixels on the frame's shorter side at any scale. Use it on light on a dark ground, such as a night scene, light painting or neon. On a light ground the ground itself blooms and softens fine dark lines and text laid over it.

The grade's curves and tints, with `halation`, made cues at 1920 x 1080 about 26 ms a frame slower to draw on the MP4 encoder route in installed Edge, and about 29 ms with WebGL2 hidden, where the export converts colour on the CPU. Most of it is the curves and tints, which read, change and redraw every pixel. The halation reads the frame only at half size, as the bloom does, and when both are declared they share that read. A grade of `black`, `white` and `tone` alone reads no pixels. Like the bloom, the halation suits light on a dark ground: on a light ground the ground casts its fringe into dark shapes and lines beside it.

### Flashing

A film must not flash more than three times a second ([WCAG 2.3.1](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html)). WCAG counts two kinds of flash:

- A **general flash** is a rise and fall in relative luminance of 0.1 or more, where the darker state is below 0.8.
- A **red flash** is a rise and fall into or out of saturated red.

The 0.025 cap keeps the flicker pass under both thresholds, so flicker never makes a flash on any picture:

- Black at alpha 0.025 lowers white by 0.056 in relative luminance, and any darker pixel by less.
- It lowers pure red's (R - G - B) x 320, the red measure of WCAG 2.0, by less than 20.
- It moves a colour's chromaticity, the red measure of WCAG 2.2, by less than 0.001 in u'v'. The threshold is 0.2.

Measured in installed Edge, flicker 0.1 on a white ground flashed 4 times a second at 24 fps and 7 at 60 fps. Flicker 0.04 on pure red made 4 and 7 red flashes a second by the WCAG 2.0 measure.

The cap covers flicker only. The other parts of the finish are not capped this way: a large `weave` moves the whole picture on every frame. Keep whole-frame or large-area brightness swings, such as a lamp switching on and off or a strobe, to three or fewer a second. Keep any flashing of saturated red to three or fewer a second too.

### The export's flash count

Every film export counts the flashes in the frames it encodes, after `draw` and the whole finish, so it sees what the piece draws as well as what the finish adds, such as a bloom's glow. A film that flashes more than three times in one second is still saved, with a warning: the page's note and the `npm run film` summary line say how many flashes, in which second and where, and the report carries the count as `flashes` (see [the flash count](../knowledge/output-formats.md#the-flash-count)). Slow the flashing, shrink the area that flashes or soften the swing until the warning goes.

The count follows WCAG 2.2's definitions:

- **Transitions.** Each frame is shrunk to at most 300 pixels on its long edge; a smaller frame is read at its own size. Every pixel's relative luminance, and its chromaticity in CIE 1976 u'v', is followed from frame to frame. A transition is the change from one peak or valley to the next, confirmed once the value turns back by the threshold. A general transition changes relative luminance by 0.1 or more with its darker state below 0.8. A red transition goes to or from a colour whose R / (R + G + B) is 0.8 or more, the two colours more than 0.2 apart in u'v'. Black counts as the white point, so red switching to black is a red transition.
- **Area.** A transition counts only where the pixels making it in the same direction, in the same frames, cover more than 25% of a 10 degree visual field. WCAG takes a 341 x 256 pixel rectangle on a 1024 x 768 screen for that field. The count treats the film's long edge as those 1024 pixels, as if the film filled the screen, so the field is a third of the long edge wide and a quarter of it high, placed anywhere in the frame in steps of a 24th of the long edge. A film shown smaller than a screen makes each flash smaller, so this errs towards warning.
- **Flashes.** A flash is a rise and a fall. The count takes, for each field and each second, the fewer of its rises and its falls. One area turning lighter while another turns darker is therefore not a flash, and neither is a picture that brightens in steps.

What the count does not see:

- A pattern finer than a pixel of the shrunk frame, about 0.1 degree, averages out. WCAG exempts such fine, balanced patterns.
- A change of less than a quarter of the threshold after a transition, such as boiling grain, neither extends it nor turns it.
- A change that takes longer than a second is counted from its last second.
- A looping film is not counted across its seam.

The count is a check, not a proof of safety. Viewers sit nearer or further, and screens vary, so a film under the limit can still be uncomfortable for some viewers. In installed Edge the count found the red and the general flashes of [`tools/fixtures/flash-film.cjs`](../../tools/fixtures/flash-film.cjs), a fixture that flashes on purpose, and gave no warning for the readout and cues examples, whose films were counted the same way.

## Optional WebGPU pixel preview

Raster-only pieces may declare `preview`; its default is `null`. The page starts
with the CPU renderer. The user may select **GPU preview** for an opted-in piece.
`draw` remains required and is the reference for every export and contact sheet.
The optional preview does not translate JavaScript or support vector geometry.

```js
preview: {
  kind: 'webgpu-pixels',
  wgsl: `fn artifexPixel(position: vec2f) -> vec3f {
    let uv = position / vec2f(artifex.size);
    return vec3f(uv, artifex.values[0].x);
  }`,
  uniforms(state, t, clock) { return [state.params.amount]; },
}
```

The shader is trusted author code, limited to 65,536 characters. It defines
`artifexPixel(position: vec2f) -> vec3f`; `position` holds raster pixel centers.
Return encoded sRGB channels in `[0,1]`. The wrapper clamps those channels and
sets alpha to one. Keep its color math consistent with the CPU implementation.
Only the fixed uniform binding is supplied; author-owned buffers, textures,
bindings, features and render passes are not supported.

The exact 96-byte ABI is exported as `HEADER` in
[`core/webgpu-preview.js`](../../core/webgpu-preview.js):

```wgsl
struct ArtifexInputs {
  size: vec2u,
  seed: u32,
  frame: u32,
  time: vec4f,
  values: array<vec4f, 4>,
}
@group(0) @binding(0) var<uniform> artifex: ArtifexInputs;
```

`size` is the raster resolution. `seed` is the exact resolved `solve().seed`;
explicit seed overrides retain the existing JavaScript `>>> 0` normalization,
including negative or fractional overrides. `frame` is the same value as `clock.frame`.
`time` contains quantized playhead, clock seconds, design width and design height.
`uniforms(state, t, clock)` receives the same quantized clock as CPU drawing and
returns an Array or Float32Array containing at most sixteen finite numbers whose
float32 conversions are finite. They fill `values` in order; unused slots are
zero. Float32 rounding is expected. Frames must fit u32; playheads, dimensions
and authored floats must fit finite float32 values.

The page owns a separate GPU canvas and copies only a current completed frame to
its visible Canvas2D surface. It coalesces edits, applies playback backpressure,
and disposes sessions on selection, CPU mode, failure and page exit. A missing
or software adapter, insufficient device limits, shader/allocation failure,
operation timeout or device loss restores the current CPU frame. Select GPU
preview again to retry. Preview dimensions are limited to 4096 per axis and
8,294,400 pixels, and must also fit the requested device's limits. Each asynchronous
GPU operation has a ten-second deadline; late devices are disposed. Export
resolution retains the existing destination-dependent limits.

`window.__artifex.setPreview('cpu' | 'gpu')` selects the page renderer;
`read().preview` reports mode, status, reason when falling back, and the last
presented seed/playhead/parameters. While an edit is pending, the requested
inputs are reported separately and an obsolete completion cannot replace them.
GPU timing reports CPU-side submission, queue completion, validation, presentation
copy and total latency; it is not a hardware timestamp. The allocation proxy
counts one four-byte color surface plus the uniform buffer, not measured VRAM
or the browser's additional surfaces. `manifest()` and recipe URLs keep the
CPU/reference contract; they do not reproduce GPU-specific rounding.

See [`pixel-field.js`](../../examples/pixel-field.js) for matching JavaScript and
WGSL noise/warp implementations. Its named build stage prepares immutable octave
weights, frequencies and normalization shared by the CPU draw and GPU uniforms.
Approximate equality is measured for that
workload, not guaranteed for arbitrary shaders or other hardware.
