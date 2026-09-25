---
type: knowledge
summary: "The showcase site: how npm run site builds out/site/ from ordinary pieces in site/shots.js, how the stage turns scroll into frames, and what npm run site:check and tools/check-site.js establish; read before changing the site, its shots or its checks."
related_files: ["tools/build-site.js", "tools/check-site.js", "tools/piece-input.js", "site/shots.js", "site/stage.js", "site/worker.js", "site/index.html", "site/site.css", "site/pieces/", "site/posters/", "site/tests/"]
---

# Showcase site

The site is one film the visitor scrolls. Every section, and every seam between two sections, is a shot played by an ordinary Artifex piece; the scroll position is the playhead of the whole site. Scrolling back rewinds, because every frame is a function of the seed and the playhead.

The first seven shots are the site's art (see [the art shots](#the-art-shots)). The three after them (`rows`, the seam `grid`, and the still `cells`) are placeholders that keep the stage's worker tier and recipe checks exercised until the later shots replace them.

## Commands

| Command | Purpose and result |
| --- | --- |
| `npm run site` | Builds `out/site/` from `site/shots.js` and prints the brotli size of the first load and of the whole site. |
| `npm run site -- --serve [--port N]` | Builds, then serves `out/site/` on `127.0.0.1` until stopped. |
| `npm run site:check` | Runs `site/tests/*.test.js`: the builder, the refusals, the preview server and the stage's pure helpers. |
| `node tools/check-site.js [--edge PATH] [--timeout-ms N] [--headed]` | Checks the built site in installed Edge; run `npm run site` first. |

The site's tests are not in `tests/*.test.js`, so the mutation suite, which reruns the whole Node suite for every mutation, does not grow with the site. The [Check workflow](../../.github/workflows/check.yml) builds the site and runs `npm run site:check`; it deploys nothing and does not run the Edge check.

## The shot list

`site/shots.js` exports `{ hz, seed, shots }`. `hz` is the site's frame rate: frames of scroll per second of film. `seed` is the seed every piece is solved with, so a seam and the shots on either side of it agree. Each shot has:

| Key | Meaning |
| --- | --- |
| `name` | Kebab-case and unique; recipe URLs and script names use it. |
| `piece` | Path to a CommonJS piece, from `site/shots.js`. |
| `seam` | A transformation between two shots: hidden from assistive technology, and not shown under reduced motion. |
| `seconds` | How long a still holds. Required for a still; refused for a timed piece, which lasts its own duration. |
| `tier` | `'worker'` draws the shot off the main thread; otherwise a timed piece draws per frame and a still once per change. |
| `still` | The playhead shown under reduced motion; 1 by default. |
| `poster` | Path to a `.webp`, `.png` or `.jpg` drawn from the same recipe, from `site/shots.js`, shown until a worker-tier frame is ready and used as the reduced-motion still. The build copies it to `posters/<name>.<ext>`, and the page names only that path. |
| `title`, `text` | The copy over the shot, as HTML-escaped text. |

Unknown keys are refused. The list is resolved with `shots` from [`core/time.js`](../../core/time.js) at build time, so a shot too short to hold a whole frame fails the build.

## The art shots

Each seam begins on the last frame of the shot before it, drawn from the same state, and each shot on the last frame of its seam, so a join changes nothing on screen; every piece is solved with the site's seed. The pieces share their modules in `site/pieces/`.

| Shot | Piece | What it draws | Length |
| --- | --- | --- | --- |
| `intro` | `intro.cjs` | A plotter pen writes the wordmark on drawing paper, a line at a time, its gantry's shadow over the sheet; the last line stays wet. | 4.5 s |
| `bloom` (seam) | `bloom.cjs` | A wide brush of clean water crosses the wet line and the ink blooms into the water along its current. | 3.5 s |
| `ink` | `ink.cjs` | A brush lays that one ink along the water's current, pale washes first and dark strokes last, with tapered touchdowns, dry-brush breaks and gloss. | 6 s |
| `crack` (seam) | `crack.cjs` | The sheet dries a shade lighter and tears in generations of recursive cuts, each running between tears already there, with a white fibrous core and the table showing through. | 5 s |
| `mirror` | `mirror.cjs` | The torn pieces lift apart; three glass mirrors slide in and stand on the sheet round a triangle, and its reflections slide out of them, ring by ring, into the wallpaper group *333. | 7 s |
| `bend` (seam) | `bend.cjs` | The mirrors, pinned at their corners, bow inwards; the wallpaper turns hyperbolic, its reflections nesting towards one circle, and the mirrors turn together. | 6 s |
| `portal` (seam) | `portal.cjs` | A notebook page with the catalog's bird doodled in ballpoint slides in under a mirror, the kaleidoscope carries it into every reflection, and the camera goes into one mirror's reflection of it. | 7 s |

- **One ink.** [`paper.js`](../../site/pieces/paper.js) holds the paper and one ink: `tone(c)` is the colour ink at concentration `c` leaves on the paper, and `wash(c)` the ink at the opacity that leaves it with ordinary source-over drawing. The multiply composite doubled a frame's cost on a GPU-backed canvas.
- **What stays is kept.** [`held.js`](../../site/pieces/held.js) keeps what a shot has finished drawing as copies per canvas, scale and solve: `hold` and `keep` for an opaque layer, `upTo` for marks laid one after another (a copy every fourth count and two recently used ones), `soft` for marks laid at a fraction of the resolution and smoothed back. A copy is made on the shot's first frame; when the stage lowers the scale, the copies are shrunk rather than redrawn. Its `prime` hook draws, on the shot's own canvas under the first copy, every kind of mark the shot will make: a GPU-backed canvas costs 25 to 40 ms the first time it meets a kind of mark, and the first frame is drawn before the shot is on screen.
- **Curved mirrors, pixel by pixel.** A circle mirror reflects by inversion, which no copy of a picture can show, so [`inversion.js`](../../site/pieces/inversion.js) folds every pixel outside the region between the mirrors back into it on the CPU, at one folded pixel per 3.6 canvas pixels each way, reading the lifted scene's colours once at half the design's resolution, a little darker for every reflection and blended to the mean tone past seven. The reflections in `bend` and `portal` are therefore softer than the sheet between the mirrors; the page the camera goes into in `portal` is drawn sharp, its lines mapped through the inversion (straight lines as exact arcs). The display uses neither WebGL nor WebGPU.
- **The page** ([`page.js`](../../site/pieces/page.js)) is built from the style library's subject and helpers ([`skills/artifex/styles/subject.js`](../../skills/artifex/styles/subject.js), [`kit.js`](../../skills/artifex/styles/kit.js)) as the [doodle](../../skills/artifex/styles/doodle.md) style draws it, as polylines, so it can be drawn through any map.

**Posters.** `ink` and `mirror` carry posters in [`site/posters/`](../../site/posters/): the piece at seed 1 and its still playhead (1), at its design size of 1200 by 800, written as WebP at quality 0.82 by installed Edge's `canvas.toBlob`. They are the reduced-motion stills of the two shots whose first draw costs hundreds of milliseconds. The intro has none: its still draws in a few milliseconds, and a poster of the first shot counts in the first load. The repository has no poster writer; when a piece changes, its poster must be written again from the same recipe.

## What the build writes

`tools/build-site.js` loads every piece through `loadExternal` in [`tools/piece-input.js`](../../tools/piece-input.js) as one list. A list shares one module table: a helper two pieces require is defined once, and the result names the modules each piece reaches. A module reached by two or more shots goes in `shared.js`; the rest go in `shot-<name>.js`. `core.js` is `bundle()` from [`tools/build-page.js`](../../tools/build-page.js), the module runtime and the library. `index.html` is `site/index.html` with the shot sections filled in and, at its `<!-- data -->` marker, a script tag for `data.js`, which sets `window.__siteData` to the shot data the stage reads: the shots, their scripts, tiers, posters and labels, the frame count, `hz` and the seed. The data is a same-origin script rather than text in the page, so the stage never reads markup or DOM text as data. `stage.js`, `worker.js` and `site.css` are copied. Every script is parsed before it is written, and `out/site/` is replaced whole.

The page carries a Content-Security-Policy of `default-src 'self'; img-src 'self' blob:`: no third-party request, no inline script. Without script, the text reads in order.

**The public boundary.** The build refuses any module, asset, shot list or site file whose real path lies under `.private/`, `docs/tasks/`, `docs/decisions/`, `docs/knowledge/private/` or `docs/apis/private/`, wherever those directories are, naming the file. Symbolic links are followed before the test.

**The preview server** serves only regular files under `out/site/` with a known type, on loopback, to `GET` and `HEAD`; any other path, including one that climbs out of the directory, is a 404.

## The stage

[`site/stage.js`](../../site/stage.js) maps `scrollY` to a whole frame of the shot list (0.6 viewport heights of scroll per second of film), finds the shot with `shotAt`, and maps the frame inside the shot to the piece's playhead, both ends included. It draws only when the piece's own frame, the seed, the parameters or the canvas size change.

- **Scroll is never taken.** The stage reads the scroll. It writes it only when the visitor starts "Play as film" and once when a recipe URL opens; every listener is passive, and nothing calls `preventDefault`.
- **Two canvases at most.** One holds the shot on screen. The other holds the neighbour in the direction of travel: its scripts load two seconds of film before the join and its first frame is drawn one second before, so the join shows a frame already drawn.
- **Scripts load as the visitor nears a shot**, with `shared.js` before the shot's own.
- **Three tiers.** A timed piece draws per frame on the main thread; a still draws once per change; a worker-tier shot draws in a Worker on the stage canvas, handed over with `transferControlToOffscreen`, and its poster covers it until the first frame is ready. Where that route is missing or fails, a worker-tier shot draws on the main thread once the scroll has rested for 150 ms, and never warms.
- **Scale lowering.** A main-thread shot draws at three quarters of its raster scale when at least 3 of its last 20 judged draws take over `1000 / hz - 4` ms (29.3 ms at 30 Hz), down to one device pixel per CSS pixel, and then moves to the worker tier. A cold draw, the first after the piece loads, after a new solve or on a new canvas, size or scale, is not judged, nor is a warm-up draw: a piece makes its kept copies and first marks once, and that is not what each frame costs. The draw time measured here is the time of the drawing calls, which is not the rasterization time.
- **Canvas size.** The piece's design box fits inside the viewport, centred, at the device pixel ratio, capped at 8,294,400 pixels.
- **Reduced motion** (`prefers-reduced-motion: reduce`): nothing draws on scroll. Each shot that is not a seam shows one still, its poster or its `still` playhead drawn once as an image, as its figure nears the viewport. The preference can change without a reload. "Play as film" still plays, as an explicit request, and returns to the stills when stopped.
- **Recipes.** The address bar follows the frame on screen once the scroll has rested for 400 ms: `?shot=<name>&seed=<n>&t=<playhead>&p.<name>=<value>`, where `t` is the piece's quantized playhead, as the page writes it. Opening such a URL scrolls once to that frame. A parameter the piece refuses is dropped. "Copy link" copies it; "Re-roll seed" moves to the next seed.
- **Play as film** scrolls the site at `hz` frames a second from where it stands. The button pauses it; any key, pointer press, wheel or touch elsewhere stops it.

`window.__stage` reports the mode, the frame and shot, every draw (`log`, with its shot, frame, time, tier, scale, canvas width, whether it warmed a neighbour and whether it was cold), the stills drawn, the scroll writes and why, scale lowering and the worker's state. The check reads it.

## What the checks establish

`npm run site:check` builds the real shot list and fixtures into temporary directories and checks: shared modules defined once and each shot's own module in its script; every piece loading and validating from `core.js` and its scripts in a VM; the sections, seams and stills in the page; the page's only scripts being `data.js`, `core.js` and `stage.js`, and `data.js` holding the build's data; the first load within 150 kB of brotli; a poster named in the shot list as a `javascript:`, `data:` or other-origin URL refused as a missing file, and one outside the shot list's directory published only as `posters/<name>.<ext>`; each shot-list refusal; the private-path refusal for modules, entries, assets and the shot list; escaped copy; the preview server's refusals; and the stage's frame mapping, recipe round trip, scale lowering (a cold draw and two spikes in twenty do not lower, three over-budget draws do, and the draw after a scale change is not judged) and canvas fit; and the check's count of redraws after a scale change. [`tests/external-piece.test.js`](../../tests/external-piece.test.js) checks the loader's list form, and three mutations in `tests/negative.js` guard it.

`tools/check-site.js` runs in installed Edge through `withEdge` from [`tools/check-browser.js`](../../tools/check-browser.js), with its temporary profile and cleanup, against the builder's loopback server. A probe installed before the page's first script counts scroll writes, `preventDefault` on wheel, touch, scroll and key events, and listeners for them that are not passive. On two references, desktop (1280 by 800 at DPR 1) and slow (390 by 844 at DPR 3, a 1170-pixel canvas, 4x CPU throttling), it scrolls the whole film forward by native wheel events, one frame of scroll per event, drawing forced to rasterize through a one-pixel sink (`?measure=1`), and requires: no page errors; three wheel steps too small for a new frame draw nothing; the walk ends on the last frame; every shot drawn; as many draws as distinct frames, besides one redraw of the frame on screen after each scale change, counted apart; at most two canvases; no scroll write, `preventDefault` or active listener; and each main-thread shot's p95 draw time, at the scale it settled on and over its draws after the cold one, within 12 ms (desktop) or 33 ms (slow) per frame, or 100 ms and 300 ms for a still. The cold draws are left out of the p95 but reported, with their times, in the JSON, so a stall once per page stays visible. Then reduced motion must show a loaded still with alternative text for every shot that is not a seam, hide the stage and the seams, draw nothing on scroll, and return to the film when the preference changes back; with `transferControlToOffscreen` removed, the worker-tier shot must draw on the main thread; a recipe URL must open its shot, frame and seed with exactly one scroll write, and rewrite the address bar; and "Play as film" must reach within a few frames of `hz` frames after one second, and stop on a key.

Measured on this repository's development machine (Edge 153, headless), which other work was loading at 4 to 100 % CPU during the runs, so the figures move by several milliseconds between runs. Over six runs of the final shots on desktop the art drew at p95 4.2 to 5.6 ms (intro), 5.9 to 8.1 (bloom), 7.5 to 11.8 (ink), 9.9 to 12.5 (crack), 6.2 to 7.8 (mirror), 10.8 to 13.6 (bend) and 11.2 to 18.1 (portal): crack, bend and portal went over the 12 ms budget in some runs, the portal in five of six, and it held only in the run that began at 4 % load. On the slow reference the stage lowered the scale of bend and portal in every run, and every shot then drew within 33 ms. Their cold draws, made off screen as warm-ups, took 150 to 225 ms on desktop and 420 to 1,340 ms on the slow reference. The first load is 149.5 kB of brotli, half a kilobyte under the 150 kB budget: `core.js` is 110.0 kB of it, because `bundle()` includes every example, `shared.js` 33.4 kB, since it holds every module two shots share and grows with the shots, and `stage.js` 6.9 kB. The whole site is 266.9 kB, the posters included.

Under the rule before the one above (a p95 of the last 20 draws, the second-highest, cold draws included), the stage lowered bend and portal on the slow reference in every run, and the check counted each redraw after a lowering as a duplicate, so its draw count failed in every such run. Under the present rule, in two runs at 74 to 100 % load, the slow walks counted 7 and 4 redraws after scale changes apart and held the draw count; bend and portal were still lowered, on their steady draws.

The check does not establish: behaviour on phones and tablets (the slow reference is a throttled desktop CPU on its GPU), headed windows, touch or trackpad inertia, other browsers, memory use, flashes, contrast, keyboard traversal, screen-reader output, scale lowering's effect on the art (the check records which shots were lowered, not how they look), memory held by kept copies across shots, or whether a poster matches its live frame.
