---
type: knowledge
summary: "The showcase site: how npm run site builds out/site/ from ordinary pieces in site/shots.js, how the stage turns scroll into frames, and what npm run site:check and tools/check-site.js establish; read before changing the site, its shots or its checks."
related_files: ["tools/build-site.js", "tools/check-site.js", "tools/piece-input.js", "site/shots.js", "site/stage.js", "site/worker.js", "site/index.html", "site/site.css", "site/pieces/", "site/tests/"]
---

# Showcase site

The site is one film the visitor scrolls. Every section, and every seam between two sections, is a shot played by an ordinary Artifex piece; the scroll position is the playhead of the whole site. Scrolling back rewinds, because every frame is a function of the seed and the playhead.

The three shots in `site/pieces/` (`rows`, the seam `grid`, and the still `cells`) are placeholders that exercise the stage. They are not the site's art.

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
| `poster` | A `.webp`, `.png` or `.jpg` drawn from the same recipe, shown until a worker-tier frame is ready and used as the reduced-motion still. |
| `title`, `text` | The copy over the shot, as HTML-escaped text. |

Unknown keys are refused. The list is resolved with `shots` from [`core/time.js`](../../core/time.js) at build time, so a shot too short to hold a whole frame fails the build.

## What the build writes

`tools/build-site.js` loads every piece through `loadExternal` in [`tools/piece-input.js`](../../tools/piece-input.js) as one list. A list shares one module table: a helper two pieces require is defined once, and the result names the modules each piece reaches. A module reached by two or more shots goes in `shared.js`; the rest go in `shot-<name>.js`. `core.js` is `bundle()` from [`tools/build-page.js`](../../tools/build-page.js), the module runtime and the library. `index.html` is `site/index.html` with the shot sections and the site data filled in; `stage.js`, `worker.js` and `site.css` are copied. Every script is parsed before it is written, and `out/site/` is replaced whole.

The page carries a Content-Security-Policy of `default-src 'self'; img-src 'self' blob:`: no third-party request, no inline script. Without script, the text reads in order.

**The public boundary.** The build refuses any module, asset, shot list or site file whose real path lies under `.private/`, `docs/tasks/`, `docs/decisions/`, `docs/knowledge/private/` or `docs/apis/private/`, wherever those directories are, naming the file. Symbolic links are followed before the test.

**The preview server** serves only regular files under `out/site/` with a known type, on loopback, to `GET` and `HEAD`; any other path, including one that climbs out of the directory, is a 404.

## The stage

[`site/stage.js`](../../site/stage.js) maps `scrollY` to a whole frame of the shot list (0.6 viewport heights of scroll per second of film), finds the shot with `shotAt`, and maps the frame inside the shot to the piece's playhead, both ends included. It draws only when the piece's own frame, the seed, the parameters or the canvas size change.

- **Scroll is never taken.** The stage reads the scroll. It writes it only when the visitor starts "Play as film" and once when a recipe URL opens; every listener is passive, and nothing calls `preventDefault`.
- **Two canvases at most.** One holds the shot on screen. The other holds the neighbour in the direction of travel: its scripts load two seconds of film before the join and its first frame is drawn one second before, so the join shows a frame already drawn.
- **Scripts load as the visitor nears a shot**, with `shared.js` before the shot's own.
- **Three tiers.** A timed piece draws per frame on the main thread; a still draws once per change; a worker-tier shot draws in a Worker on the stage canvas, handed over with `transferControlToOffscreen`, and its poster covers it until the first frame is ready. Where that route is missing or fails, a worker-tier shot draws on the main thread once the scroll has rested for 150 ms, and never warms.
- **Scale lowering.** A main-thread shot whose last 20 draws have a p95 over `1000 / hz - 4` ms (29.3 ms at 30 Hz) draws at three quarters of its raster scale, down to one device pixel per CSS pixel, and then moves to the worker tier. The draw time measured here is the time of the drawing calls, which is not the rasterization time.
- **Canvas size.** The piece's design box fits inside the viewport, centred, at the device pixel ratio, capped at 8,294,400 pixels.
- **Reduced motion** (`prefers-reduced-motion: reduce`): nothing draws on scroll. Each shot that is not a seam shows one still, its poster or its `still` playhead drawn once as an image, as its figure nears the viewport. The preference can change without a reload. "Play as film" still plays, as an explicit request, and returns to the stills when stopped.
- **Recipes.** The address bar follows the frame on screen once the scroll has rested for 400 ms: `?shot=<name>&seed=<n>&t=<playhead>&p.<name>=<value>`, where `t` is the piece's quantized playhead, as the page writes it. Opening such a URL scrolls once to that frame. A parameter the piece refuses is dropped. "Copy link" copies it; "Re-roll seed" moves to the next seed.
- **Play as film** scrolls the site at `hz` frames a second from where it stands. The button pauses it; any key, pointer press, wheel or touch elsewhere stops it.

`window.__stage` reports the mode, the frame and shot, every draw (`log`, with its shot, frame, time, tier, scale, canvas width and whether it warmed a neighbour), the stills drawn, the scroll writes and why, scale lowering and the worker's state. The check reads it.

## What the checks establish

`npm run site:check` builds the real shot list and fixtures into temporary directories and checks: shared modules defined once and each shot's own module in its script; every piece loading and validating from `core.js` and its scripts in a VM; the sections, seams and stills in the page; the first load within 150 kB of brotli; each shot-list refusal; the private-path refusal for modules, entries, assets and the shot list; escaped copy; the preview server's refusals; and the stage's frame mapping, recipe round trip, scale lowering and canvas fit. [`tests/external-piece.test.js`](../../tests/external-piece.test.js) checks the loader's list form, and three mutations in `tests/negative.js` guard it.

`tools/check-site.js` runs in installed Edge through `withEdge` from [`tools/check-browser.js`](../../tools/check-browser.js), with its temporary profile and cleanup, against the builder's loopback server. A probe installed before the page's first script counts scroll writes, `preventDefault` on wheel, touch, scroll and key events, and listeners for them that are not passive. On two references, desktop (1280 by 800 at DPR 1) and slow (390 by 844 at DPR 3, a 1170-pixel canvas, 4x CPU throttling), it scrolls the whole film forward by native wheel events, one frame of scroll per event, drawing forced to rasterize through a one-pixel sink (`?measure=1`), and requires: no page errors; three wheel steps too small for a new frame draw nothing; the walk ends on the last frame; every shot drawn; as many draws as distinct frames; at most two canvases; no scroll write, `preventDefault` or active listener; and each main-thread shot's p95 draw time, at the scale it settled on and counting its warm-up draw, within 12 ms (desktop) or 33 ms (slow) per frame, or 100 ms and 300 ms for a still. Then reduced motion must show a loaded still with alternative text for every shot that is not a seam, hide the stage and the seams, draw nothing on scroll, and return to the film when the preference changes back; with `transferControlToOffscreen` removed, the worker-tier shot must draw on the main thread; a recipe URL must open its shot, frame and seed with exactly one scroll write, and rewrite the address bar; and "Play as film" must reach within a few frames of `hz` frames after one second, and stop on a key.

Measured on this repository's development machine (Edge 153, headless): in two runs the placeholders drew at p95 4.8 to 10.5 ms on desktop and 11.7 to 15.3 ms on the slow reference, varying with the machine's load; the seam's warm-up draw, off screen, took up to 34 ms on desktop. The first load is 114.1 kB of brotli, of which `core.js` is about 105 kB, because `bundle()` includes every example.

The check does not establish: behaviour on phones and tablets (the slow reference is a throttled desktop CPU on its GPU), headed windows, touch or trackpad inertia, other browsers, memory use, flashes, contrast, keyboard traversal, screen-reader output, scale lowering in a browser (its rule is tested in Node; the placeholders never exceed the budget), posters (the placeholders have none), or whether a poster matches its live frame.
