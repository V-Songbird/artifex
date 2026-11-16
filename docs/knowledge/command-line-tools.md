---
type: knowledge
summary: "How to run Artifex's command-line tools on external pieces and style packs, draw contact sheets, sweeps and time strips, save a still or a film, join scene films, replay a saved file, turn an image into a module a piece declares and measure a reference image, and which tests cover each; read before using or changing one of these commands."
related_files: ["tools/piece-input.js", "tools/run-tests.js", "tools/bench-sim.js", "tools/styles.js", "tools/contact-sheet.js", "tools/still-cli.js", "tests/cli.test.js", "tools/film-cli.js", "core/export.js", "core/film.js", "tools/build-page.js", "tools/stitch.js", "tests/stitch.test.js", "tools/replay.js", "tools/check-browser.js", "tests/external-piece.test.js", "tests/styles.test.js", "tests/contact-sheet.test.js", "tests/fixtures/print-characterization-synthetic.txt", "tests/film-cli.test.js", "tests/replay.test.js", "tests/fixtures/empty-film.cjs", "tests/fixtures/noise-film.cjs", "tests/fixtures/grain-film.cjs", "tests/fixtures/burst-film.cjs", "tests/fixtures/peak-film.cjs", "tests/fixtures/light-film.cjs", "tests/fixtures/activity-film.cjs", "tools/measure-reference.js", "tests/measure-reference.test.js", "tools/image.js"]
---

# Command-line tools

These sections detail the commands listed in [developing Artifex](development.md#commands). Run every command from the repository root.

## External pieces

`npm run page -- ./piece.cjs` and `npm run seeds -- ./piece.cjs 9 0.5` accept a CommonJS module exporting one piece. From another project, use `npm --prefix "/path/to/artifex" run page -- "./piece.cjs"` or the equivalent `run seeds --` command, replacing the library path. Relative paths resolve from the folder you ran npm in; see [paths under npm run](#paths-under-npm-run). Quote paths containing spaces.

External outputs are named after the resolved source module, such as `piece-page.html`, `piece-seeds.html`, or `piece-param-width-height.html` for `--param width,height`; [where output goes](#where-output-goes) says which folder they land in. Output stems come from the source filename, replacing filesystem-reserved characters. Parameter-name suffixes are URL-encoded, including `*` as `%2A` and `-` inside a key as `%2D`, so the key `a-b` never names the sheet of the keys `a` and `b`, and names cannot introduce Windows wildcard characters or path separators. Existing files with the same generated name are replaced. `examples` and `bench` still operate only on the example registry.

The loader supports a restricted CommonJS subset: direct literal `require('...')` or `require("...")` calls, including relative helpers, absolute library imports and JSON data. `require('artifex/core/<file>.js')` names a module in the library's `core/` from any folder; a name `core/` does not hold is refused. Helpers must be browser-compatible `.js` or `.cjs` modules. It is not a general CommonJS bundler. Node builtins, native modules, ESM syntax, require aliases and computed require paths are rejected. Shadowed/local functions named `require` and require calls inside template interpolation are unsupported; keep imports as ordinary calls outside templates.

Node runs an external piece from the same module table and module text the page gets, not through Node's own `require`, so both load the same sources.

- **What a module sees.** Only `module`, `exports` and `require`. Node's module globals such as `__dirname`, `__filename` and `require.resolve` are absent in Node as in the page, and reading one fails the load. Library modules are the files the page bundles.
- **Confined loads.** `loadExternal(input, cwd, { confine: { root, files } })` confines a load to `files`, paths relative to `root` with forward slashes, and to `artifex/core/<file>.js`. A piece outside the list, and every other require, including another library file, an absolute path, a package or a path out of `root`, is refused by name. A listed path matches the file it names on disk, so on a volume that ignores case (Windows, and macOS by default) a list spelled in another case still lists the same files. A listed link lists only itself: if it points to a file that is not listed, loading it is refused.
- **Loading a list of pieces.** Given an array of inputs, `loadExternal` returns `pieces` with one entry per input, in the order given. A file listed twice, or under two spellings, gives two entries with the same `id`, so a caller that renders each entry renders that file twice; compare `id` to skip one.
- **Try a new piece in Node first.** Before you open it in Edge, solve it and draw one frame in Node, for example with `solve` from `core/piece.js` and `drawFrame` from `core/render.js` on the benchmark's `nullSurface` from `tools/bench.js`. Then check `stages.error`: `solve` records a failing build stage there instead of throwing, so the page fails later with a message that does not name that stage.
- **Solving in the page.** `__artifex.examples[name]` is the module as exported, without the defaults `validate` fills in. Pass it through `__artifex.piece.validate` before `__artifex.piece.solve` or `__artifex.render.drawFrame`, as the page does with the piece it selects. `solve` given the module itself fails with `piece.state is not a function` when the piece declares no `state`.
- **What `solve` returns.** `{ state, seed, stages, manifest }`. What `build` stores is on `.state`, not on the return itself. `drawFrame` takes the whole return.

Inline script-end text in ordinary quoted strings is escaped without changing its value. Any template literal containing literal `</script` text is rejected, whether tagged or untagged; use ordinary quoted strings or JSON for that data. This conservative rule avoids changing raw template strings while trying to infer their tag. Templates without that marker remain supported. Emitted scripts are parsed before writing, and malformed JSON errors identify the data file and retain the original parse cause. The generated HTML includes its module sources and needs no filesystem access when opened. Piece loading executes trusted local code in Node, where globals such as `process` remain reachable; this is not sandboxing.

In PowerShell, use `npm.cmd` when forwarding options such as `--param`; a PowerShell npm shim may consume the `--` separator before npm sees it. For example: `npm.cmd --prefix "/path/to/artifex" run seeds -- "./piece.cjs" 3 0.5 --param width`.

Parameter strips and grids use the same `--param` option and fixed-seed rules for external pieces. Run `node --test tests/external-piece.test.js tests/contact-sheet.test.js` for module loading, the `artifex/core/` import, Node and page parity, confinement refusals, nested dependencies, invocation paths, filenames, error cases and sweep contracts. Inspect the generated page and sheet in a browser to verify native rendering.

For a runnable `--param` sweep, use `tests/fixtures/key-lift.cjs`, a sphere lit by one key light. It declares `key` from 0 to 1 and `lift` from -0.25 to 0.25. A sweep includes both ends, so give `key` a count of 9: the cells are 45 degrees apart and the first and last share one angle. For example, `npm run seeds -- tests/fixtures/key-lift.cjs 9 0.5 --param key`. [One light plan](../../skills/artifex/reference/materials.md#one-light-plan) explains the angles.

### Where output goes

The page, seeds, still and film commands choose the output folder from where the piece lives:

- A registered example writes under the library's `out/`.
- A piece outside the library, or in a folder under `out/`, or in a folder Git ignores, writes beside its own source. For example, `out/drafts/piece.cjs` writes `out/drafts/piece-seeds.html`.
- A piece in a tracked folder of the library, such as a test fixture in `tests/fixtures/`, writes under `out/pieces/` followed by its folder, for example `out/pieces/tests/fixtures/gradient-film-page.html`, `gradient-film.mp4` and `gradient-film-frames.html`. No output lands in a tracked folder.
- A piece at the top of `out/`, such as `out/drift.cjs`, writes under `out/pieces/`, for example `out/pieces/drift-seeds.html`, so it never replaces the output of a registered example of the same name.

The commands print library paths from the library root. `npm run film`, `still`, `image`, `stitch` and `measure` take `--out` to name the file instead, relative to the directory you ran the command from. Without `--out`, `npm run film` and `still` at `--seed n` add `-seed<n>` to the name, such as `out/readout-seed7.mp4`, as a seeds strip does, so a file at another seed never replaces the piece's own.

### Paths under npm run

Under `npm run`, a tool resolves a relative path from the folder you ran npm in, also under `npm --prefix <library>`. That covers a piece, `--out`, a relative `ARTIFEX_HOME`, a reference image, films to join and a file to replay. npm runs the script from the library root and records the folder you ran it in as `INIT_CWD`; `callerDirectory` in `tools/piece-input.js` reads it. The rule holds only for a path a tool resolves through `callerDirectory`, `loadExternal` or `resolvePiece`; the script form alone does not do it, so a new tool must resolve its path arguments through one of them.

- **`--edge PATH` and `EDGE_PATH` follow the same rule.** `findEdge` in `tools/check-browser.js` resolves a relative Edge path from the folder you ran npm in, in every command that draws in Edge. An absolute path works from anywhere.

- **When the rule applies.** Only when `npm_package_json` names this library's `package.json` and `INIT_CWD` is set. Otherwise, and under a direct `node tools/<file>.js` command, a tool resolves relative paths from its current directory.
- **The test runner keeps its current directory.** `npm run test:changed` and `npm run test:all` run `tools/run-tests.js`. Its test files inherit npm's environment and start tools from folders of their own, so under those two scripts `callerDirectory` ignores `INIT_CWD`. `npm test`, `npm run site:check` and `npm run negative` do not run `node tools/`, so they keep the current directory too.
- **Child processes.** `npm run bench:sim` restarts itself once per run with pile names and numbers, no path. The commands that draw in Edge start Edge, and `taskkill.exe` on Windows to stop it; neither reads an npm variable. `tools/run-tests.js` starts `node --test`, whose test files the runner exception above covers. `tools/run-tests.js` and `tools/piece-input.js` (for every tool that loads a piece) start `git` from the library root with an absolute path or none, and git reads no npm variable. No other tool starts a child.
- **A new tool that starts a Node tool child with a path argument** must remove `npm_lifecycle_event`, `npm_package_json` and `INIT_CWD` from the child's environment, or pass the child an absolute path. Otherwise the child resolves that path from the folder npm was run in, not from its own.

`tests/cli.test.js` checks every `node tools/` script, the runner exception and a tool started with the runner's environment from another folder, and `tests/external-piece.test.js` checks the page and seeds commands under `npm --prefix`.

## Style packs

`npm run styles` is the catalog of built-in styles and installed style packs: each style's name, signature, mark functions and the paths of its guide and module. [Style packs](../apis/style-packs.md) defines the pack format, the proof, the install folder, name resolution, `trust` and `check`. Listing runs no pack code. `ARTIFEX_HOME` replaces `~/.artifex`; a relative value resolves from npm's invocation directory, as `page` and `seeds` paths do.

A style is a guide and mark functions, never a picture, so no tool draws one by name. `--style <name>` in `page`, `seeds`, `still`, `film` and `replay` is refused with the paths of the style's guide and module, and nothing is written. A piece requires a built-in style's marks as `require('artifex/styles/<name>.js')`, from any folder, as it requires `artifex/core/<file>.js`; the module is bundled as one of the piece's own.

`npm run styles -- pack` copies a module of mark functions and its proof into a temporary folder inside `ARTIFEX_HOME`, proves each mark from that copy, and moves the pack into `styles/` only when every mark is proved; the build folder is removed either way, so a failure leaves the install folder and any pack `--replace` would have replaced as they were. `--replace` moves the old pack aside and brings it back with its trust if installing or trusting the new one fails. `check` proves an installed pack's marks the same way. The [style-pack skill](../../skills/style-pack/SKILL.md) tells an agent how to write the module, the proof and the guide and run `pack`.

Run `node --test tests/styles.test.js` for `builtin.json` against the guides and mark modules, that the built-in styles hold no subject, scene or example image, the catalog, every `style.json` rule, broken and refused folders, the unknown-name error, trust, every `check` refusal, confined loading, every refusal of a mark's proof, `pack`'s rewriting, guide headings, output, refusals and removal of its own output when a mark is not proved, the return of a replaced pack and its trust when the install fails, and the `--style` refusal in `page` and `seeds`; its tests use a temporary `ARTIFEX_HOME`, never the real one. `tests/cli.test.js` checks the `--style` refusal in `still` and `film`, and `tests/contact-sheet.test.js` the `--style` arguments.

## Contact-sheet sweeps and metrics

`npm run seeds -- <piece> [count] [playhead] --param <a>[,<b>]` samples one or two declared parameter ranges evenly, including their exact minimum and maximum. It requires one piece (a registered example or an external piece) and distinct, declared parameter names. `count` is samples per axis (default 3, minimum 2), so a two-parameter sweep has `count * count` cells. The first parameter runs across columns; the second runs down rows. The sheet preserves those axes with keyboard-accessible horizontal scrolling on narrow screens. Other parameters retain their declared defaults, and every cell uses the piece's declared seed.

`--seeds <n>,<n>,...` with one `--param` name draws the same sweep once per seed, one row per seed in the order given, so a parameter's limit is judged at several seeds: `npm run seeds -- drift 5 --param reach --seeds 1,2,3` draws 3 rows of 5 cells. Each cell is labelled with its seed and value, such as `seed 2 · reach=200`, and the file name ends in the seeds, such as `out/drift-param-reach-seeds1-2-3.html`. A seed is a whole number from 0 to 4294967295, and the list may not repeat one or hold more than 16. `--seed <n>` with one `--param` name is a list of one seed: `npm run seeds -- drift 5 --param reach --seed 7` draws one row at seed 7, in a file ending `-seeds7`. `--seeds` is refused without `--param`, with two `--param` names (their grid already uses the rows), with a time strip (which takes one `--seed`), and with `--seed`; a missing, empty, repeated, too long or malformed list is refused by name. Without `--seeds`, a sweep holds the piece's own seed as before.

`--box WxH` draws every cell of one piece at that box, refused by name unless the piece declares `boxes` holding it, and adds the box to the file name, such as `out/refit-seeds-405x720.html`. For a piece that declares `reframe`, the box replaces that timeline, so the header and every cell show the box, not the film's frame.

`--reframe t:WxH,t:WxH,...` draws every cell of one piece along that [box timeline](../apis/piece-api.md#box-timeline) instead of the piece's own: each entry is a playhead from 0 to 1, a colon, then a box, such as `--reframe 0:1280x720,0.5:405x720,1:720x720`. The sheet's file name ends in `-reframe`, such as `out/refit-frames-reframe.html`. An entry that is not written `t:WxH` is refused by name. The timeline's rules are those of `atBox`, so a timeline the piece cannot play is refused by name before a page is written: fewer than two boxes, playheads that do not increase, a box outside the declared ranges, or a piece without `boxes` or a timeline. Give `--box` or `--reframe`, not both. A time strip shows the box moving: `npm run seeds -- refit --frames 9 --reframe 0:1280x720,1:405x720`.

Without `--param`, the existing behavior remains: `count` defaults to 9 and cells use seeds 1 through `count`. The playhead defaults to 1 in either mode, and a playhead below 0 or above 1 is refused. Parameter output names include the selected parameters, such as `out/drift-param-reach-turn.html`; a `--param` key set with a capital letter adds a hash of 6 hexadecimal digits, so sweeps of `Reach` and `reach` keep separate files; seed output remains `out/drift-seeds.html` (or `out/seeds.html` for all examples).

Each cell labels the varied values and reports three diagnostics:

- **Marks:** successful canvas paint calls (`fill`, `stroke`, `fillRect`, `strokeRect`, `drawImage`, `fillText`, `strokeText`, `putImageData`). A call can paint no visible pixels; this is not an object count. Background paint calls count. A static layer put back from its copy and a [sprite](../apis/piece-api.md#sprites) each count as one `drawImage` call, however many marks they hold.
- **Bbox coverage:** the area of the bounding rectangle around final nontransparent pixels, divided by raster canvas area. It includes background pixels: a fully painted background gives 100%. It is not ink density, foreground segmentation, or a quality score. Bounds are sampled at the preview's raster resolution, 480 pixels wide.
- **Build ms:** elapsed time around `solve`, including state creation and the build stages, excluding drawing and pixel measurement. Timing varies between runs.

`window.__sheet` retains `names`, `count`, `t`, and `failures()`, and adds `paramNames` and `cells`. Successful cell records carry `name`, `seed`, resolved `params`, quantized `t`, `buildMs` (null on a cell that shares an earlier cell's seed and params, which reuses that build), `markCount`, `bbox` in raster pixels (null when empty), `coverage` in [0, 1], `rasterSize`, and `error: null`; with the [view flags](#value-greyscale-and-colour-vision-views), and in every [time strip](#time-strips), they add `lightness`, `chroma`, `saturated`, `viewMs` (the milliseconds the page took to compute the views, lightness and chroma, shown as `views 41.2 ms` in the caption; every other cell has `viewMs: null`), with `--values` the `peak` value step, and with `--gamut` the `gamut` share outside the print gamut. Failed cells retain their inputs and an error message; later cells still render. These data let an agent filter candidates before visual review, without treating the metrics as artistic judgment.

Run `node --test tests/contact-sheet.test.js` for argument, sampling, determinism, metric, and bundle-parsing checks. Actual raster output and native canvas behavior require browser verification.

Add `--png` to any `npm run seeds` command to also write a PNG of the sheet beside its HTML, with the same name, such as `out/drift-seeds.png`. A sheet of several pieces gets one image per piece, such as `out/seeds-drift.png`, so each stays readable.

- **Capture.** It opens the sheet in installed Edge with the browser check's own lifecycle (a unique temporary profile, a loopback server and the same cleanup), waits until `window.__sheet` holds every planned cell, each drawn or failed, and captures the whole page at one device pixel per CSS pixel.
- **Size.** Seed sheets are 1280 pixels wide; a sweep is wide enough for every column (48 + 220 per column + 14 per gap), and 1280 at least. Every image is at full scale, one pixel per CSS pixel, however tall the sheet, so you can read it at 100%.
- **Parts.** An image too heavy for one browser reply (about 3 MB of PNG) or taller than 8192 pixels is written top to bottom as `<name>-1-of-<n>.png` and on, each file one screenshot at most 8192 pixels tall and as wide as the sheet. Each part ends between two rows of cells, so every part shows whole cells: each frame with its caption and, under `--loupe`, its 100% crop and that crop's caption. Only a row of cells too heavy for one reply or taller than 8192 pixels is cut inside, between a frame, a crop and their captions, and only one of those too heavy or too tall by itself is cut across. The number of parts depends on how the PNGs compress, and a cell's timings change from run to run, so the same command can split into a different number of parts.
- **Earlier files.** Before writing an image, the command removes the files an earlier run left under the same name, `<name>.png` and every `<name>-<i>-of-<n>.png`, so only this run's parts remain. Once its arguments and piece are read, a run with `--png` removes them before planning, drawing or capture can refuse or fail it; a run refused while reading its arguments or piece, and a run without `--png`, keep them.
- **Deadline.** The browser is stopped after 60 seconds; `--timeout-ms N` gives it `N` milliseconds instead, from 100 to 3600000, for a sheet of costly frames. A missing or wrong value, or `--timeout-ms` with neither `--png` nor `--json`, is refused by name. When the deadline passes, the error names the stage that was running: first `piece module load`, while the piece modules run their top-level code; then `piece setup of <piece>`, `piece build of <cell>` or `frame draw of <cell>`, where `<cell>` is the piece, the cell's number and its seed, value or frame, such as `drift cell 2 of 9 (seed 2)`; then `strip flags of <piece>` for a strip, and `sheet results`, or `soundtrack render` under `--sound`; then `sheet read-back`, while Node reads the finished sheet's data from the browser; and last, only with `--png`, `sheet capture`, while the images are taken. These stages, except `sheet read-back`, are the piece's work, and the error adds a hint to raise `--timeout-ms` or draw fewer or smaller cells. A stall at Edge startup, CDP connection, page navigation, `sheet page load` (before the first stage) or `sheet read-back` is the browser's and gets no hint. `--sound-reference` decodes its file in a browser of its own before the sheet's, with the same `--timeout-ms` counted separately, and a stall there names `sound reference decoding`.

The HTML sheet and `window.__sheet` are unchanged. `node --test tests/contact-sheet.test.js tests/check-browser.test.js` checks the option, the names, the widths and the wait condition; the image itself needs installed Edge.

## Time strips

`npm run seeds -- <piece> --frames <n>` draws `n` frames, 2 or more, of one piece at its declared seed and parameters, spread evenly from its first frame to its last, rounded to whole frames: `--frames 9` on readout's 168 frames shows frames 0, 21, 42, 63, 84, 104, 125, 146 and 167. `--at 0.5,2,3.25` shows instead the frame each of those seconds falls in, frame `floor(seconds * hz)`, and refuses a second outside the film. To show a given frame, give its middle, `(frame + 0.5) / hz` seconds, such as `0.625` for frame 7 at 12 Hz: a time on a frame's start that is rounded for typing, such as `0.58` for 7 / 12, falls in the frame before and can show one frame twice. When two different `--at` seconds fall in one frame, the command still writes the strip and prints a warning on stderr that names those seconds, their frame and, for a film of more than one frame, the frame centres to give instead: at 30 frames per second, `--at 5.9,5.933` shows frame 177 twice, and `--at 5.917,5.95` shows frames 177 and 178. A second repeated on purpose, such as `--at 2,2`, gives no warning. `--frames` writes `<piece>-frames.html`, and with `--png` `<piece>-frames.png`, where the seed sheet would go. `--at` writes `<piece>-at.html` and `<piece>-at.png` instead, so a strip taken with `--at` never replaces a `--frames` strip of the same piece; `--loupe` adds `-loupe` right after the strip's kind, such as `readout-at-loupe.html` and `readout-at-loupe.png`, so an `--at` strip survives a later `--at --loupe` run of the same piece, and the other way round; `--sound`, `--reference`, `--box` and the parts of a large image add their suffix to whichever name the strip has, such as `readout-at-sound.html`. `--box` applies as for any sheet, and a count, a playhead or `--param` is refused. A still has one frame, so `--at 0` shows it as a strip of one cell, which takes `--scale` and `--loupe`: `npm run seeds -- specimen --at 0 --loupe --png` shows specimen with a 100% crop at a 1920-pixel long edge. Any other strip of a still is refused by name.

`--seed <n>` draws a time strip, a shot strip or a still at seed `n`, a whole number from 0 to 4294967295, instead of the piece's own seed, and adds `-seed<n>` to the name, such as `readout-frames-seed7.html`, so strips at two seeds never replace each other. For example, `npm run seeds -- readout --frames 3 --seed 7`. A seed sheet already draws seeds 1 to its count, and a sweep of two `--param` names holds the piece's own seed, so both refuse `--seed`; a sweep of one name takes it as a [one-row sweep](#contact-sheet-sweeps-and-metrics) or several rows with `--seeds`. Without `--seed`, a strip and its name are unchanged.

`npm run seeds -- <piece> --shots` draws a shot strip, the film's storyboard: each shot's first, middle and last frame on one row, each cell labelled with the shot's name and which of the three it is, such as `turn, middle`. It writes `<piece>-shots.html`, and with `--png` `<piece>-shots.png`. The strip reads the shot list from the piece's built state at `state.cues.shots`, the list `shots()` from `core/time.js` returns, which is where the film scaffold, `examples/cues.js` and `examples/readout.js` keep it. A piece that keeps no such list there is refused by name, and so is a list that names two shots alike, as `shots()` refuses it. Every strip (`--frames`, `--at`, `--shots`, `--contacts`, `--sound`) and [`--plan`](#planning-a-films-views) reads that list, so each one refuses a list with two shots named alike. `--shots` replaces `--frames` or `--at`; `--seed`, `--scale`, `--loupe`, `--sound` and `--box` apply as for any strip. For example, `npm run seeds -- cues --shots` shows cues' 4 shots in 12 frames.

`npm run seeds -- <piece> --contacts <list>` draws a contact strip: for each frame on which something touches, the two frames before it, the frame itself and the three after it, each contact starting a row of its own, each cell labelled `contact 3, 2 before`, `contact 3` or `contact 3, 1 after` with its frame and second. It writes `<piece>-contacts-<list>.html`, and with `--png` `<piece>-contacts-<list>.png`, so strips of two lists from one piece keep separate files: `--contacts cues.hits` writes `cues-contacts-cues.hits.html`. A list name with a capital letter adds a hash of 6 hexadecimal digits to the file name, so `Falls` and `falls` keep separate files even on a file system that ignores case. `<list>` names a list in the piece's built state, with a dot for a nested one: `npm run seeds -- stride --contacts falls` reads stride's footfalls, and `--contacts cues.hits` reads the hits in cues' cue table. Each entry needs a whole `frame`, or `seconds`, which the strip turns into the frame it falls in; entries on one frame make one contact, at the first point among them, and a frame near either end of the film shows only the frames that exist, its contact frame kept in the same column as every other's. An entry with `x` and `y`, a design point such as a simulation's impact, places `--loupe`'s 100% crop around that contact on its row, unless `--loupe x,y` names a point of its own; the crop's caption names the contact's point, and the strip's header says the crops sit around each contact's point once any does. A list that is not there or is empty, an entry with neither frame nor seconds, or a frame outside the film is refused by name, and so is a list on more than 24 frames, such as a simulation's whole impact log: name a shorter list, such as the planned contacts, or pick frames with `--at`. `--contacts` replaces `--frames`, `--at` and `--shots`; `--seed`, `--scale`, `--loupe`, `--sound` and `--box` apply as for any strip, so the film scaffold's `--contacts cues.contacts --loupe --sound --png` writes `<piece>-contacts-cues.contacts-loupe-sound.html` and `.png`. At 640 pixels three cells fit a row, so a contact takes two rows; cells under 320 pixels, `--scale 0.3` for stride's 960 design units, put a whole contact on one.

Each cell is 640 pixels wide, or `--scale k` pixels per design unit, and is shown at one CSS pixel per canvas pixel, so the PNG holds every pixel drawn; a strip taller than 8192 pixels is written in parts of whole rows, as any sheet is. As many cells share a row as fit about 2048 pixels, three at 640; the image is as wide as that row, 1280 at least.

Each cell is labelled with its frame and second and carries the seed sheet's marks, bounding-box coverage and build time (`build shared` after the first cell, since every cell of a strip shares one seed and one build), plus its draw time, its view time (`viewMs`), its detail, its change and, in some cells, its hold. The caption shows them as `draw 1.2 ms`, `views 41.2 ms`, `detail 3.41`, `change 0.80` and `hold 0.35`. Detail is described in a later paragraph; change and hold are two kinds of difference between frames, and only hold is the measure the **Held** flag in the list there uses. **Change** is how far the cell's frame moved from the previous frame shown: the mean luma difference between their block grids, from 0 to 255, with no matching of shift or gain, so a film finish's weave and flicker count. A cell that opens a run, as defined below with `window.__sheet.flags`, and a cell after a failed one show none. A `--frames`, `--at` or `--contacts` cell that opens a shot inside its row is labelled `<shot>, shot start`, after its contact on a `--contacts` strip, such as `contact 1 · b, shot start`, so its missing change reads as a cut. **Hold** is how far the cell's frame moved from the first frame of the current hold run, measured as the **Held** flag measures it, in the largest region after the picture is matched for shift and gain; it is shown only on a cell the hold check compared, so not on a cell that opens a run, on a failed cell or on the cell right after one. The JSON fields below say how to read it against the threshold of 2. The draw time is the median of three draws of that frame, each forced by copying one pixel of the cell into a small memory canvas and reading that pixel, so it measures rasterization at the cell's size, not at the film's. The cell itself is not read while it is timed: reading a canvas moves it from the GPU to the CPU, and its pixels would then differ from the film's. One draw is not reported, because the first draw on a page can take many times as long as later draws of the same frame. The time varies between runs and machines.

Each drawn strip cell also carries `lightness`, with or without the [view flags](#value-greyscale-and-colour-vision-views): the `mean`, `min` and `max` of OKLCh lightness L over the cell, from 0 (black) to 1 (white), their `range`, `max` minus `min`, and `p5` and `p95`, the 5th and 95th percentiles of L, each rounded to 4 decimals. L is measured on the cell's own pixels over the sheet's white, never on the page around them. Use it to check tone by numbers: a low-key frame has a low `mean`, and when the peak spans the widest range, its frame has the largest `p95` minus `p5` of the strip. `min` and `max` count every pixel, so one small highlight sets `max`. `p5` and `p95` leave out the darkest and lightest 5% of the pixels, so they give the lightness of the cell's darkest and lightest large areas; to see where those areas are, look at the [value view](#value-greyscale-and-colour-vision-views). The percentiles are by nearest rank: `p95` is the lightness of the pixel at 95% of the cell's pixels counted from the darkest. They are read from a histogram of L in 1024 bins, as the mean L of the bin that holds that pixel, so they are within 1/1024 (about 0.001) of the exact value. A failed cell has no `lightness`.

Each drawn strip cell also carries `chroma` and `saturated`, measured on the same pixels. Use them to check colour by numbers instead of by eye: which forms pass OKLCh chroma C 0.1 in a place, how much chroma steps up from one place to the next, and which small area is the most saturated, and in which hue.

- `chroma` is `{ mean, max, p50, p95, high, areas }`: the mean and max of C over the cell, its median and 95th percentile, and `high`, the share of pixels with C over 0.1. Each is rounded to 4 decimals. `areas` is the number of areas in the cell whose `chroma`, rounded to 4 decimals as `saturated` lists it, is over 0.1, found the way `saturated` finds them, listed or not. The percentiles are by nearest rank from a histogram of C in 1024 bins over 0 to 0.4, so they are within about 0.0004 of the exact value. `max` counts every pixel, so one bright speck sets it.
- `saturated` lists the most saturated areas, at most 3, most saturated first; it is empty on a cell with no area of C 0.03 or more. The cell is cut into square blocks one 64th of its width a side (10 pixels on a cell 640 pixels wide). An area starts at the block of highest mean C not yet in an area, and grows over blocks touching it on a side or a corner that have a mean C of 0.03 or more and a hue within 30 degrees of that first block's. It grows on through a block whose C is at least 0.7 times the C of the area block it touches, so a form whose chroma fades along it, tapers or has soft edges stays one area, while a sharp step down to a paler ground stops it. A touching block of that hue that fails the 0.7 step, such as a block the form only partly covers, joins the area but it grows no further from there. Two touching forms whose hues differ by more than 30 degrees are two areas. Each area is `{ x, y, w, h, share, chroma, hue }`: `x` and `y`, the top-left corner, and `w` and `h`, the width and height, of the box around its blocks, in design units; `share`, its share of the cell's pixels; `chroma`, the mean C of its most saturated block, the block it started from; and `hue`, the OKLCh hue of its mean colour, from 0 to 360 degrees. The list is in order of `chroma`, highest first. Because the area is made of whole blocks, its box can reach up to one block past the coloured form on a side. A ground of the form's hue at more than about half the form's C, behind a soft edge, can join its area. A form under about two blocks across never fills a block, so its `chroma` is lower than the form's own C and it can rank below a larger, paler form; `chroma.max` keeps the form's own value. Only three areas are listed. When `chroma.areas` is larger than the number of listed areas with `chroma` over 0.1, the others are not listed, so find them by eye; when it is not larger, every area over 0.1 is listed.

A failed cell has neither `chroma` nor `saturated`.

`--light-page` puts the sheet on a light page instead of the default near-black one, so you can judge how dark a frame looks in a lit room or on a light page. It works on any sheet or strip and changes no cell or number. The file gains `+light-page`, such as `readout-frames+light-page.html`, so it never replaces the dark sheet.

`--loupe` adds under each frame a 100% crop of that frame drawn at the film's default export scale, `filmScale(piece)`, at the film's even-rounded size: the size of a cell, centred on the design box's centre or on `--loupe x,y`, and held inside the frame. The crop is cut from the whole frame drawn at that scale, so a finish's vignette and grain are the film's. It shows detail at the size the film is encoded at, before encoding; judge encoding loss on the saved film. `window.__sheet` adds `strip`, the layout, and each strip cell's `frame`, `seconds`, `drawMs` and `loupe` crop rectangle; its `t` is null.

`--reference <photo>` adds a photo of the material the piece imitates, a `.webp`, `.png` or `.jpg` file, as the strip's first cell. The photo is shown pixel for pixel, cut at its centre to the size of a 100% crop, so the material and the piece compare at one scale. `--reference <photo>@x,y` cuts around the point x,y in the photo's pixels instead, kept inside the photo, and refuses a point outside it. `--reference-scale k` shows each photo pixel k pixels wide, such as `0.5` for a photo with twice the detail of the piece's crop, so you do not have to resize the photo by hand. To match the photo's detail to the piece's, use k = the export width divided by the photo's width in pixels; the export width is the first number in the crop's caption (`100% of 1920 × 1440` is 1920 wide). The formula holds only when the photo shows what the whole frame shows, as a replica's reference photo does. For a close-up or macro photo of the material, or a wider one, set k by eye until the features are the size the piece draws them. The crop starts on a whole photo pixel, is drawn without smoothing at a scale of 1 or more, and is cut and encoded losslessly as PNG in installed Edge, and only the crop is embedded in the sheet, never the whole file, so a large phone photo does not make a large sheet; the command prints the photo's size and the size of the crop's embedded data URL. It needs installed Edge even without `--png`, and `--loupe`, and a PNG waits until the photo has loaded. A relative photo path is found from the directory you run the command in, as a piece is. The sheet's name gains `-reference`, such as `my-piece-at-loupe-reference.png`, so it never replaces the plain strip. Each crop also gets a [style gap](#style-gap) from the photo. Built-in styles keep their photos under `skills/artifex/styles/references/`; see [reference photos](../../skills/artifex/styles/catalog.md#reference-photos).

Each strip cell also reports its detail: the cell's luma, over the sheet's white, averaged in square blocks about 1/80 of the cell wide, 8 pixels at 640, then the mean step between neighbouring blocks, from 0 to 255. Averaging first means grain, and fine hatching with no subject, count as flat, and the detail of one frame is about the same at any `--scale`. Three flags mark frames to look at:

- **Nearly empty.** A frame is flagged when its detail is under 0.005, or under 25% of the most detailed frame shown on each side of it, so a blank that spans several shown frames is still found, while a film that opens from nothing or fades out at its end is not.
- **Unscaled.** On a strip drawn at a scale other than 1, a cell is flagged when its draw paints shapes or text, not images, at one pixel per design unit after dropping the cell's scale. The draw drops it with `setTransform`, `resetTransform` or `reset()`, or with a `restore()` that has no `save()` of its own and so pops the cell's scale. A `restore()` back to before the drop clears it. Such a cell may not show the frame, so it is flagged on its own line whatever its detail. At scale 1 nothing is flagged.
- **Held.** Frames are reported as held when they span 6 seconds or more and none of them differs from the first of them by 2 or more in luma in any region. Both frames are first blurred by about 1.4 pixels at 640, because moving a picture by a fraction of a pixel, as below, redraws fine anti-aliased edges that sit off whole pixels, such as a grid of 3-pixel lines, a little unlike the renderer, by enough to break a frozen hold; the blur moves little luma from one block to the next, so a moving figure changes its region about as much without it. Each frame is then matched with the first frame moved as a whole by up to 1/320 of the cell's width each way, 2 pixels at 640, because a film finish's weave moves the whole picture by a fraction of a pixel each frame, and scaled as a whole by the gain that matches it best, kept within 3% of 1, because a finish's flicker darkens the whole frame by up to 2.5%, which moves a light ground by up to about 6. What still differs is averaged in blocks, so grain averages out. A region is a square of blocks about 1/10 of the cell wide, 8 by 8 blocks, and its change is the mean of its blocks' luma changes. The flag compares region by region, not the mean over the frame, so one small region that keeps moving, such as a figure breathing in a held pose, breaks the hold when it changes that region by 2 or more, even though the mean over the whole frame barely changes. A small figure that moves by a pixel or two may change no region that much, and is then held; a solid figure that moves a pixel or two beside a still object can change a region by 2 and break the hold, depending on how much of the figure's edge moves within one region, so a 40-pixel solid figure moving 1 pixel can break it while thin lines moving a few pixels did not. A whole picture that moves less than that shift over the hold, such as a very slow pan, is held. So is a lone subject on a plain ground that moves as a whole by less than that shift, such as a figure on blank paper rising and falling by a pixel or two, because the shift follows the only detail there is. The shift cannot follow a figure that moves beside anything that holds still, or moves only in part, so such a move breaks the hold when it changes a region by 2 or more. A frame that darkens or brightens as a whole, every pixel scaled by one gain within 3% of 1 as a finish's flicker scales it, is held too. Marks that fade toward a light ground are not scaled as a whole, so such a fade breaks the hold once it changes a region by 2 or more.

  What was checked, in installed Edge at 640 pixels:

  - A frozen picture of discs on mid grey (#808080) was held with no finish, under grain 0.25 or 0.6, under weave 1.2, under grain 0.35 with weave 1.2, and under stride's grain, weave, flicker and vignette (grain 0.25, weave 0.6, flicker 0.015, vignette 0.3, with no grade). So was a black line drawing on white under weave 1.2, and a frozen grid of black lines on white off whole pixels, 3 pixels wide and 24 apart, under weave 1.2, and of 2-pixel strokes 20 apart under weave 0.6.
  - A stick figure frozen in a pose on paper (#efe8dc) was held with no finish, under grain 0.35 with weave 1.2, under stride's grain, weave, flicker and vignette, and under the same with the deepest flicker, 0.025. The same figure breathing in the held pose was not held in any of these, changing one region by up to about 14 within each breath where a frozen one changes by under 0.5.
  - At `--scale` 0.5, 2 and 4, the line drawing, the two grids, every case under grain 0.35 with weave 1.2 and every case of the figure under stride's finish, with flicker 0.015 or 0.025, gave the same results. The other cases were checked only at 640 pixels.

  A finish that still changes one region by 2 after the shift and the gain breaks the hold. Stronger finishes than these were not checked.

The flags only report; a dark, sparse or still frame can be the art, and a hold is judged only on the frames shown. The sheet names each flag under its own cell, so two cells of one frame each carry theirs, and sums them under the strip.

`window.__sheet.flags` holds `empty`, each with its `cell` (its index among the strip's cells), `frame`, `seconds`, playhead `t`, `detail` and `why` (`floor` or `dip`); `unscaled`, each cell flagged unscaled, with its `cell`, `frame`, `seconds`, `t` and `marks`, the number of marks painted unscaled; and `holds`, each with its `from` and `to` cells, frames and `seconds`; each cell carries its `detail`, its `unscaled` count, always 0 at scale 1, its `change` from the cell before, and its `hold`. Whenever the piece keeps a valid `state.cues.shots`, each cell also carries `shot`, the name of the shot its frame falls in, on every strip; a `--shots` cell also carries its `mark`. A cell **opens a run** when it is the strip's first cell, its `mark` is `first`, or its `shot` or contact differs from the cell before's, as at a cut or the first cell of a contact's row on a `--contacts` strip. `change` is the mean block change over the whole frame, which the flags do not use. It is `null` on a cell that opens a run, a failed cell, and the cell right after a failed one. `hold` is the region measure the held flag uses, from the first frame of the run the cell was compared with, so it shows how close a cell came to the threshold of 2: under 2 the cell continues the run, and 2 or more means the cell ended the run and starts the next one, which is flagged as held only when it spans 6 seconds or more. `hold` is `null` for a cell that opens a run, a failed cell, and the cell right after a failed one, because none of them is compared. A hold never spans a cut or two contacts' rows. The `unscaled` count can fall short in two cases: it stops counting at a `restore()` with no matching `save()` after a `reset()`, and it drops the marks still pending when a piece pops the cell's own save and then leaves one of its own `save()` calls unbalanced at the end of the draw.

Each drawn cell also carries `light`, its lit area, which tells a moving light from drift where `change` cannot:

- `x` and `y`: the centre of the frame's light above its ground, in design units. The ground is the median block's luma, and each block brighter than it counts by how much brighter it is.
- `level`: that rise averaged over every block, from 0 to 255.
- `move` and `step`: how far the centre moved and how much `level` changed since the cell before. Both are `null` on a cell that opens a run, on a failed cell, after a failed cell, and when the cell before had no light, since across a cut the move is the cut's. A failed cell keeps its `x`, `y` and `level`.

`light` is `null` on a frame with nothing above its ground, such as a flat or white frame. A uniform brightening and a flicker move the ground with the frame, so the centre stays in place. The centre follows a lit area smaller than half the frame; above that, the median is the lit level. Anything bright that moves moves the centre too, such as a pale shape crossing a dark scene, so `light` says that a lit area moved, not what moved it.

`window.__sheet.flags.lights` judges the light of each run of 2 or more drawn cells. A run breaks at a cell that opens a run and at a failed cell or a cell with no luma. A piece that keeps no `state.cues.shots` gives its cells no shot, so such a strip is one run across its cuts. Each entry holds:

- `from` and `to`: the run's first and last cells, frames and playheads; `shot`: its shot's name, or `null`.
- `move`: the largest distance between any two of the run's lights, in design units to 2 decimals, or `null` with fewer than two lights. It does not depend on which cell comes first: a slow move sampled by many cells adds up, so a dense `--at` strip does not hide it, and a lamp swinging about where it started reads its full swing.
- `low` and `high`: the lowest and highest `level` among its cells, a `null` light counting as 0. Comparing the lowest with the highest, not the first with the last, catches a switch that turns back within the run (on, off, on).
- `dim`: the smallest ratio of lowest to highest mean rise over the ground in square regions about 1/10 of the frame wide, among the regions whose highest mean rise reaches 8 (0 to 255), or `null` when none does. It catches a small lamp switching beside a brighter static area, which barely changes `level` and the centre.
- `held`: `true` unless `move` reaches 1% of the frame's design width, `low` falls to 3/4 of `high` or less, or `dim` falls to 3/4 or less.

The thresholds live in `STRIP_RULES` in `tools/contact-sheet.js`. The sheet writes "light held" under the last cell of each held run and counts the held runs under the strip. Steady light is the normal state of most shots, so "light held" is a plain caption, not a flag, and does not mark the strip's report as flagged. Like the other flags, it only reports: a bright film or a still shot can be the art.

One limit remains, plus a narrower one:

- **A camera move reads as a changed light.** A pan, push-in or weave moves every lit area, so `move` and `dim` include the camera's move. Judge on cells whose framing holds, or discount the camera's own move between the two cells.
- **A lamp in the same region as a brighter static area** still mixes into that region's rise. Regions are about 1/10 of the frame wide, so check such a lamp by eye on a `--loupe` crop over it.

Example: [`tests/fixtures/light-film.cjs`](../../tests/fixtures/light-film.cjs) is a dark 640 x 360 film in seven 3-second shots. In installed Edge, `npm run seeds -- tests/fixtures/light-film.cjs --shots --json` judges them as follows:

| Shot | What the light does | Result |
| --- | --- | --- |
| `sweep` | A lamp crosses the frame. | `move` 400, not held. |
| `drift` | The lamp holds while the ground brightens by 35. | `move` 0, `low` = `high` = 0.76, `dim` 1: held. |
| `rise` | The lamp's level rises from a third to full. | `low` 0.25 of `high` 0.76, not held. |
| `switch` | The lamp goes off and back on; the middle cell has no light. | `low` 0, not held. |
| `pan` | The lamp holds while the camera pans 8 design units a frame. | `move` 280, the camera's move over 35 frames, not held. |
| `dilute` | A small lamp goes off beside a brighter static area. | `level` 9.29 to 8.89 (0.96) and `move` 4.13 pass, `dim` 0 catches it: not held. |
| `creep` | The lamp drifts a quarter of a design unit a frame. | Steps of 4 and 5 between cells, but `move` 9 from first to last, not held. |

A test in [`tests/contact-sheet.test.js`](../../tests/contact-sheet.test.js) paints the fixture's rectangles in Node and checks the same flags. Another builds the soft glow of the `litArea` test, held while the ground drifts under grain, weave and flicker, and checks that it is held with no region dimming; that case is checked only in Node.

`window.__sheet.beats` summarizes the strip beat by beat when the piece's built state keeps a beat sheet in `state.cues.beats`, as the film scaffold does: each beat on a whole frame within the film, with a finite `intensity`, in frame order. A strip whose piece keeps no such list has no `beats` key. Each entry spans from its beat's frame to the next beat's frame, or to the film's end for the last beat, and holds `frame`, `end`, `seconds`, `endSeconds`, `intensity` and `peak`, true on the first beat with the highest intensity (the scaffold's `s.cues.peak`). A cell's `change` is measured from the cell before it, so when the two cells lie in different beats it counts in the more intense of the two beats that hold them, the later on a tie: the peak keeps both the change that opens it and the drop after a flash at its end. A beat between them that holds neither cell gets nothing from that change. `cells` counts the shown cells with a `change` that counts in the beat, and `change.max` and `change.median` summarize their `change`. With `--sound`, each entry also adds `events`, the number of `sound.profile.events` in the span, `loudestDb`, the loudest of them, and `rmsDb.max` and `rmsDb.median`, the top panel's 50 ms RMS line over the beat's columns in dBFS to 0.1, measured after the export's levelling. A beat with no change counted in it gives `null` for `change.max` and `change.median`, so a beat that holds no shown cell always does. A beat with no event, or narrower than one column of the picture, gives `null` for its sound values. A column counts in the beat that holds its middle, and its 50 ms RMS window is cut at that beat's edges, so a loud hit in the next beat never raises a quiet beat's `rmsDb`.

Example: [`tests/fixtures/peak-film.cjs`](../../tests/fixtures/peak-film.cjs) keeps four beats over a quiet hum, with its peak at frame 36. In installed Edge, `npm run seeds -- tests/fixtures/peak-film.cjs --frames 18 --sound --json` gives the peak beat the largest `change.max` (28.1, against a median of 0.19 in the beats at intensity 0.4 or less) and the loudest event (-8.9 dB, 10.4 dB over those beats). Its last beat holds the hum alone: `events` is 0, but `rmsDb.max` is -22.0, 12.2 dB under the peak's. A test in [`tests/contact-sheet.test.js`](../../tests/contact-sheet.test.js) checks the beat spans and the sound half, the levels, on this fixture in Node; the change half, the peak's `change.max` and its 2x margin, is checked only by hand in Edge with the command above, since no automated check draws the fixture's pixels.

The thresholds were set in installed Edge so that no registered example with a timeline is flagged at 9, 11, 24 or 48 frames, on the default 640-pixel cells and at `--scale` 0.5, 2 and 4, while [`tests/fixtures/empty-film.cjs`](../../tests/fixtures/empty-film.cjs) is: `npm run seeds -- tests/fixtures/empty-film.cjs --frames 11` flags its blank ground, its bare hatching and its hold.

`--sound` adds the piece's soundtrack under any strip, for a piece that declares `sound`; a piece without one is refused by name. The page renders the soundtrack offline and levels it as the MP4 export levels its AAC soundtrack, so the picture shows what the film plays, and the caption gives the gain and any limiting. With `--png` or `--json` the terminal prints the same level after the cells line, such as `soundtrack levelled as the film's AAC: gain 13 dB, limited by up to 2.34 dB, -14 LUFS`, or `silent, kept as rendered`; a sheet with failed cells first prints each distinct error, up to three, with the cells it hit.

- **Layout.** The picture is as wide as a row of cells and spans the whole film on one time axis.
- **Top panel.** Every channel's samples and their RMS over 50 ms in dBFS, from -60 at the bottom to 0 at the top, with a line every 12 dB.
- **Bottom panel.** A spectrogram from 40 Hz to 16 kHz on a log scale, each row its loudest bin of a 4096-point transform, from -96 dB black to 0 dB pale, where a full-scale sine reads 0.
- **Levels.** Levels are the channels' mean power, so a sound panned to one side is not halved.
- **Lines.** A grey line with its number starts each frame shown, and a red line with the next shot's name marks each cut in `state.cues.shots`. A piece that keeps no shot list there, or an invalid one (see [saving a film](#saving-a-film)), gets no red line, and the strip is still drawn.
- **Silence.** Each stretch of 0.5 s or more where the levelled soundtrack stays under -60 dBFS, the floor of the RMS line, is shaded pale blue across the top panel and labelled with its length. The level is the mean power over consecutive 50 ms blocks. One line per stretch under the picture gives its start and end and says whether it opens the film, sits between sounds or ends it. A shorter rest, or a quiet room tone above the floor, is not shaded. The shading shows a fact and refuses nothing: a planned silence stays.

The file gains `-sound`, such as `readout-frames-sound.html`, and a strip without `--sound` is unchanged. `window.__sheet` appears once the soundtrack has drawn or failed, and adds `sound`: its `error`, the export's `level`, `seconds`, `peakDb` and `rmsDb`, the envelope's `min` and `max`, `silences`, the shaded stretches as `{ from, to }` in seconds (every piece with sound gets it, scaffold or not), and `profile`, the soundtrack's sound events.

The export's `level` carries its per-beat cuts and event prominence ([soundtrack loudness](output-formats.md#soundtrack-loudness)), and two lines under the picture say them: each beat, or 400 ms block, the limiter cut 1 dB or more, and how many events stand under 6 dB over the median of the 300 ms before them, buried, naming each, and how many land under 100 ms after the one before, flagged when either count is not zero. The events are the rows of `state.cues.sounds`; a piece that keeps none gets the events `profile` finds, and `sound.prominence` holds their measures. A found event is a peak by `profile`'s own rule, so an event too buried to be found is not named; list planned events in `cues.sounds` to measure them.

`sound.gaps` checks a film-scaffold piece against the skill's sound guide: a bed 10 to 20 dB under the focus's events, an ambience 20 dB or more under them. Only a piece whose built state keeps scaffold-shaped `state.cues.sounds` rows (each with a `voice` or an `ambience` object) gets it, at the cost of three more offline renders of its soundtrack.

- **Stems.** The page renders three stems, each from the strip's own build with only some rows in `cues.sounds`. `bed` holds the voices that swell in as a bed does, with an `attack` of 0.5 s or more. `events` holds every other voice, so a caused voice held for a second after a 0.2 s attack is an event. `ambience` holds the rows with an `ambience`. Rows with a `role` (music, sting) count in no stem. The stems are measured as rendered, before the export's levelling: the gaps are ratios, so its gain does not change them.
- **Levels.** For each shot in `state.cues.shots` (the whole film when there is no shot list), each stem's level is its loudest 50 ms mean power in that shot, in dBFS to 0.1: `eventsDb`, `bedDb` and `ambienceDb`, `null` under -90 dB.
- **Gaps.** `bedGapDb` and `ambienceGapDb` are `eventsDb` minus each, `null` when either side is. `short` lists `'bed'` when the bed gap is under 10 dB and `'ambience'` when the ambience gap is under 20 dB. A bed more than 20 dB under is not flagged.
- **Page.** One line per shot under the soundtrack gives the events' level and both gaps, flagged when `short` is not empty.
- **Errors.** A stem that fails to render sets `sound.gapsError` and leaves the rest of `sound` as it was.

The gaps leave out masking and the export's limiter: a bed can pass its gap and still cover a dull event in the same band, so listen too. A piece that keeps rows of this shape in `cues.sounds` but does not play exactly those rows in `sound()` gets stems that are not its parts.

`profile` measures the levelled soundtrack the picture shows, so you can compare a sound with a reference by numbers. Its envelope is the channels' mean power over 5 ms around each millisecond, in dB, with silence after the track. The 5 ms window adds up to 5 ms to an attack. It holds half a period of 100 Hz, so a tone lower than that ripples in it with its zero crossings, by about 15 dB at 20 Hz. An event is a peak of that envelope: the first point within 1 dB of the highest point within 50 ms on either side, within 50 dB of the loudest point, where that highest point stands at least 12 dB above the lowest point, in the track's 50 ms before, of the power over 25 ms. So a sound that rises and then holds its level, a drone or a stretch of noise, peaks where its rise ends, not at whichever ripple of its sustain stands highest. The 25 ms window holds half a period of 20 Hz, so a steady low tone's ripple is no event. A sound that swells slowly is no event. Sound already there when the track starts that holds its level, such as room tone or a steady bed, is no event either. A sound that starts at the track's first sample, or a few milliseconds in, is an event when the level it falls back to is 12 dB under its peak. That level is the lowest 25 ms power while, in 50 ms steps from the peak, one of every two steps ends lower than any step before, however slowly. So a sound file trimmed to start on its hit still gives that hit, even one with a decay of several seconds or one followed at once by more hits, as in a flam or a roll, while a sound that holds its level and then fades out is no event. A sound that fades steadily from its first sample, such as a bed faded out over 20 seconds, falls 12 dB from its peak too, so it counts as an event at the start. A peak found the same way in the track's first difference, the change from each sample to the next, also counts where the plain envelope has no event within 50 ms, unless one sample's difference holds more than half of the difference power in the peak's 5 ms window. The first difference tilts the spectrum 6 dB per octave toward high frequencies, so a bright hit over a loud low bed is an event even when the plain power shows it under the bed's own ripple, such as a 4 kHz hit at amplitude 0.1 over a 40 Hz bed at 0.3, wherever it lands in that ripple, and so is a bright hit over a low hit's decaying tail, whether the whole signal's power falls, holds or rises across it. The difference is zero at the first sample, so a track that starts mid-waveform gains no event there, and a sound cut off, gated, stepped to another level, flipped in phase or spliced to another sound mid-waveform steps once in its first difference, one sample holding the window's power, and with nothing that much brighter sounding after it, the cut is no event. A hit that starts abruptly on a sample away from zero steps once too, at any phase, and then sounds: it is an event when the first difference's power over the 5 ms after that sample stands 12 dB or more over the 5 ms before it, and so is a splice to a sound that much brighter. Such an event's `seconds`, attack, decay and span below are measured on the first difference's envelope, and its `peakDb` on the plain one. `profile.events` holds one entry per event, in time order:

- **`seconds`** and **`peakDb`**: where the event's rise ends, the first point within 1 dB of its peak, and how loud the peak is, in dBFS: the highest point in the 50 ms from there.
- **`attackMs`**: from the event's onset to `seconds`. The onset is the last point before it within 3 dB of the level under the event, the lowest point of the 50 ms before, or the last point 20 dB under the peak when that comes later. So a hit over a bed of sound, or over an earlier sound's tail, is measured from where it rises out of that sound. An event at the track's start, one that counts only because it falls, has no 50 ms before it. The level under it is the level it falls back to instead. So a hit at the first sample over a bed is measured like the same hit later in the track, whether it decays in milliseconds or in seconds, though its attack can read 1 ms shorter, since the track cuts off its rise.
- **`decayMs`**: from `seconds` to the first point 20 dB under the peak; `null` when the next event or the end of the track comes first, or when a bed within 20 dB of the peak holds the envelope up. A held sound's decay runs through its hold, so a note held 400 ms decays in about 400 ms.
- **`octaves`**: each octave band's share of the power, keyed by its centre from `31` to `16000` Hz, measured over the event's span: from its onset to where the envelope first comes back within 3 dB of the level under the event or 20 dB under the peak, or to the next event or 500 ms after `seconds` when it stays above both, and at most 8192 samples long. The span is weighted fully from its start, so an onset transient keeps its share, and fades over its last quarter. The shares sum to 1.
- **`centroidHz`**: the mean frequency of that power.

`profile.median` holds each value's median over the events that have one, and `null` when none has. A silent track has no events.

`--sound-reference <file>` measures a sound file the same way, so one run gives both profiles: `npm run seeds -- stride --contacts falls --sound --json --sound-reference steps.mp3`. It takes a `.wav`, `.mp3`, `.m4a`, `.aac`, `.ogg`, `.opus` or `.flac` file and needs `--sound` and `--json`; anything else is refused by name. A relative path is found from the directory you run the command in. Installed Edge decodes the file at 48 kHz, even without `--png`, and a file Edge cannot decode is refused with the decoder's message. This happens before the sheet is written, so a refused file leaves nothing new. The file is never copied, written or embedded in the sheet: only its numbers go into the sheet, as `window.__sheet.sound.reference`, which holds `file` (its name), `bytes`, `seconds`, `rate`, `channels` and `profile`. The sheet's name does not change. The piece's profile is measured after the export's levelling and the reference as the file plays, so compare attack, decay, octave shares and centroid, not `peakDb`.

`--motion` adds the film's motion energy under any strip of a film; a still is refused by name. The page draws every frame of the film 160 px wide (the piece's own width when that is smaller), over white, and takes the mean absolute change in luma, 0 to 255, from the frame before. A film on twos or threes repeats each drawing, so the trace holds each change over the repeats that follow it and runs at the drawing rate. The picture is as wide as a row of cells, the whole film from its left edge, on a square-root scale to the film's largest change, with a line at the median change of the drawings that are not cuts, the number of each frame shown under it, and a grey line at each cut: a shot's first frame from `state.cues.shots`, or a frame whose `state.cues.views` entry gives `cut: true`. A stretch whose energy stays under 0.25 for 1 second or more is shaded and labelled `still`, and a frame that is not a cut and changes over 5 times the median is a red line; each also gets a line of text under the picture. Nothing is refused or failed: a planned hold is still, and an impact may jump. `window.__sheet.motion` holds `step` (frames each drawing is held), `median`, `peak`, `energy` (one number per frame), `still` (`{ from, to }` in seconds) and `jumps` (`{ frame, seconds, change, times }`), or `{ error }` when a frame failed to draw. The file gains `-motion`, such as `readout-frames-motion.html`. It costs one small draw per frame of the film: `readout`'s 168 frames added 0.1 to 0.2 s to a 2.1 s run in installed Edge, two runs each way.

Use it to see what you cannot hear: a sound that starts before the frame showing its cause, a film at one loudness throughout, a band of noise across the whole film, or a film that opens on silence or drops out between its sounds.

### Value, greyscale and colour-vision views

Four flags add views under each cell, so you can check value structure, greyscale, colour-blind legibility and colours ink cannot print without squinting or building a grey parameter by hand. They work on seed sheets, `--param` sweeps and every strip (`--frames`, `--at`, `--shots`, `--contacts` and a still at `--at 0`). `--compare` refuses them. For example, `npm run seeds -- readout --at 2,4 --values --grey --colour-vision --png --json`.

| Flag | Views it adds under each cell |
| --- | --- |
| `--values` | The **value view**: lightness blurred, then cut into 3 levels, with a ring on the cell's peak value step. |
| `--grey` | The **greyscale view**: each pixel replaced by the grey of its OKLCh lightness. |
| `--colour-vision` | Three views: **deuteranopia**, **protanopia** and **tritanopia**, simulated. |
| `--gamut <FOGRA39L.txt>` | The **print-gamut view**: each pixel outside an approximate coated-paper print gamut painted magenta, the rest in grey. It reads Fogra's data file, which you download. See [print-gamut view](#print-gamut-view). |

Each view is the cell's size and has its own caption. Every view lays the cell's pixels over the sheet's white first, as the sheet shows them.

- **Lightness.** Each view starts from OKLab lightness L, from 0 (black) to 1 (white). A lightness is shown as the grey sRGB(L³), the `greyOf` rule in [a distinction that survives greyscale survives every view](../../skills/artifex/reference/stills.md#art-direction-preset-focal-composition).
- **Value view.** Lightness is blurred by three box passes each way, each of half-width h = round(2% of the cell's width), with h at least 1. Three passes are close to a Gaussian blur of standard deviation h: 13 pixels on a 640-pixel strip cell, 10 on a 480-pixel seed-sheet cell. The blurred lightness is then cut into 3 levels: under 1/3 is dark, under 2/3 is mid, and the rest is light. The levels are painted as the greys of L 1/6, 1/2 and 5/6. Fine lines on a light ground blur into the light level, as they do when you squint, so a line drawing can show one level only.
- **Greyscale view.** Each pixel is the grey of its own lightness, with no blur. Two colours that merge here differ only in hue.
- **Colour-vision views.** Each simulates one dichromacy with the severity-1.0 matrices of Machado, Oliveira and Fernandes, "A Physiologically-based Model for Simulation of Color Vision Deficiency" (IEEE TVCG 15(6), 2009), [as the authors publish them](https://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html), applied to linear RGB and clamped. Greys keep their value. A red and a green of one lightness merge under deuteranopia and protanopia, and a pure blue turns teal under tritanopia.

The **peak** is the strongest value step at the blur's scale. For each pixel of the blurred lightness B, the step is the length of (B at x + h minus B at x − h, B at y + h minus B at y − h), halved. The peak is the pixel with the largest step, the first in reading order on a tie. A thin dark mark on a light ground can be the peak even where the levels do not change. The value view's caption names it and a ring of radius h marks it. The peak is not a focal-point detector or a quality score: compare it with the focus you planned. Several equal edges can make it jump between frames of a strip. Its `contrast` compares only between cells of one width, because h follows the width.

With `--json`, each drawn cell of a sheet with any of these flags carries `lightness`: the `mean`, `min`, `max`, `range`, `p5` and `p95` of L over the cell, and `chroma` and `saturated`, as every [time-strip](#time-strips) cell does. With `--values`, it also carries `peak`: `{ x, y, contrast }`, with x and y in design units at the pixel's centre and `contrast` rounded to 4 decimals. `peak` is null on a cell whose blurred lightness has no step of 1e-6 or more. With `--gamut`, it carries `gamut`: `{ share, excess }`, described in [print-gamut view](#print-gamut-view). A failed cell has no views and none of these fields.

The file name gains a suffix for each flag, in the order `+values`, `+grey`, `+colour-vision`, `+gamut`, such as `readout-at+values+grey+colour-vision.html`, `drift-seeds+values.png` or `seeds+colour-vision.html`; the `+` keeps a sweep of a parameter named `grey` or `values` from taking the view sheet's name. `--reference` adds `-reference` after them. A sheet without these flags is unchanged. With all four flags each cell is about seven times as tall, so a large strip splits into more image parts and can need `--timeout-ms`.

### Print-gamut view

`--gamut` shows which colours of a still or frame printing ink is unlikely to reproduce. Use it before you print a still, as the [soft-proof step in stills](../../skills/artifex/reference/stills.md#scaling-to-print) asks.

`--gamut` takes the path of `FOGRA39L.txt`, Fogra's characterization data for offset printing on coated paper. Artifex does not ship that file, because its redistribution terms are not confirmed. Download it from the [ICC characterization data registry](https://registry.color.org/cmyk-registry/fogra39). The path is found from the directory you run the command in. For example, `npm run seeds -- specimen --at 0 --gamut FOGRA39L.txt --json`.

Without a path, `--gamut` is refused and the refusal says where to get the file. A file seeds cannot read, or one that lacks a field or a patch the view needs, is refused before anything is written. The file must use the registry's CGATS text layout: field names between `BEGIN_DATA_FORMAT` and `END_DATA_FORMAT`, including `CMYK_C`, `CMYK_M`, `CMYK_Y`, `CMYK_K`, `LAB_L`, `LAB_A` and `LAB_B`, and one patch per line between `BEGIN_DATA` and `END_DATA`. Fields are found by name, so their order does not matter. When two lines hold the same four coverages, the first one counts.

The view paints each pixel outside the gamut magenta (`#ff00ff`) and every other pixel in the grey of its lightness, as the greyscale view does. Its caption gives the share of pixels outside. With `--json`, each drawn cell carries `gamut`:

- `share`: the share of the cell's pixels outside the gamut, from 0 to 1.
- `excess`: the largest OKLab distance from an outside pixel to the nearest colour in the gamut, 0 when no pixel is outside.

Both are rounded to 4 decimals, so a `share` of 0 can still hide a few outside pixels in a large cell; an `excess` of 0 means no pixel is outside.

**The gamut is an approximation of one generic press.** It stands for offset printing on coated paper, as ISO 12647-2 describes it for paper type 1 or 2. It is not a printer profile. It is built from the measured CIELAB (D50) values in the file you pass. From that file, the view reads these patches, each by its C, M, Y and K coverage:

- Paper: no ink.
- Black: cyan, magenta and black at 100%.
- The 10, 20, 40, 70 and 100% tints of cyan, magenta and yellow, without black.
- Every two-ink patch between those tints, such as cyan 40% with magenta 20%, without black. The patches with both inks at one coverage are the overprints red (M+Y), green (C+Y) and blue (C+M).
- The six solids C, C+M, M, M+Y, Y and C+Y, each with 20% and 40% black.

The view tests each pixel in four steps:

1. **Convert the tints.** Each tint goes from CIELAB to XYZ (D50 white).
2. **Compensate the black point.** Each XYZ becomes (XYZ − Yk × W) / (Yp − Yk), with W the D50 white and Yp and Yk the Y of the paper and black patches, so paper becomes white and the press's black becomes black. This is a printer driver's relative colorimetric intent with black-point compensation, with paper and black taken as neutral. Black-point compensation maps the darkest colour the press prints to black, so the view takes cyan, magenta and black at 100% as black, not black ink alone. Black ink alone is lighter. With it as black, dark colours would come out more saturated than the press prints them, and the view would understate how far dark saturated colours lie outside: with FOGRA39L.txt, navy `#000080` would measure about 0.04 outside instead of about 0.09. The result goes to linear sRGB through Bruce Lindbloom's Bradford-adapted D50 matrix, then to OKLab with Björn Ottosson's matrices.
3. **Build the gamut's edge at the pixel's hue.** The patches form rings around grey, from light to dark. At each coverage of 10, 20, 40, 70 and 100%, a ring runs around the six inks and overprints at that coverage through the two-ink patches between them: cyan 40% with magenta rising through 10, 20 and 40%, then magenta 40% with cyan falling, and so on round to cyan. Below these, the solids with 20% black form one ring and with 40% black another. Between two neighbouring patches of a ring, the view mixes them in linear light, the halftones between them under Neugebauer's model. At each hue, the edge runs from white through the point where each ring reaches that hue, then in a straight line to black. The view holds this edge at 720 hues, half a degree apart, and uses the one nearest the pixel's hue.
4. **Compare.** A pixel under the edge is inside. Above it, the pixel's distance to the gamut is the smallest OKLab distance to that edge or to the edges of nearby hues, tried every 3 degrees. The pixel is outside when that distance is more than 0.02, the just-noticeable difference that [CSS Color Module Level 4](https://www.w3.org/TR/css-color-4/#gamut-mapping) uses for gamut mapping. Clipping a colour that close to the gamut changes it by less than a viewer is likely to see.

The paper's slight tint is ignored, so every grey counts as printable. With FOGRA39L.txt, near-white grounds and pale tints that the press prints within 0.02, such as ivory `#fffff0`, cream `#ffffcc`, the pale green `#f0fff0` and the pale blue `#e0e0ff`, are inside.

To bring a flagged colour inside, lower its chroma alone with `drain` from [the library section of the skill](../../skills/artifex/SKILL.md#what-the-library-gives-you), so its lightness and hue stay. With the test fixture's data, pure green `#00ff00` and pure blue `#0000ff` are outside, and each comes inside after `drain` with u 0.9.

**Limits.**

- It approximates one press condition. Uncoated paper, newsprint, inkjet printers and photo printers have other gamuts.
- Between its patches, the edge is a model of how the inks mix, not a measured boundary. `tests/contact-sheet.test.js` compares the view with a denser reference built from more patches of the same file: the whole surface of the CMY cube without black at the coverages 0, 10, 20, 30, 40, 55, 70, 85 and 100%, and the edges between the solids and overprints with 20 to 100% black. The reference is a pair of triangle meshes in OKLab after the same black-point compensation. The test measures the distance from it of every sRGB colour whose channels are multiples of 17, 4,096 colours.
- The tests run on `tests/fixtures/print-characterization-synthetic.txt`, made-up data in the registry's layout that holds those patches. It describes no real press. It checks the parser and the gamut maths, not FOGRA39L's numbers.
- The counts below were measured with FOGRA39L.txt. To check them again, set the environment variable `ARTIFEX_FOGRA39L` to the file's path and run `node --test tests/contact-sheet.test.js`; without it, that test is skipped. With FOGRA39L.txt, 1,912 of the 4,096 colours are more than 0.02 outside the reference. Against that reference:
  - The view flags 34 colours that are within 0.02 of the gamut, each with an `excess` of at most about 0.027: yellows such as `#eeee00` and `#ffffbb`, blues such as `#0077cc` and `#66aaee`, greens such as `#447700` and `#99cc22`, pinks and reds such as `#ee3399`, `#ffccee` and `#ee0000`, and dark purples such as `#220033` and `#440044`. A flagged colour with an `excess` under 0.03 is worth checking in the external proof below before you drain it.
  - It passes 9 colours that are more than 0.02 outside, each by at most about 0.022: blue-greens such as `#22bb99` and `#66ccbb`, the light cyan `#44ccee`, purples such as `#883399`, and the pinks `#ff9999` and `#ff99aa`.
  - Mid-lightness colours between two inks that the press cannot reach are flagged, with an `excess` of about 0.04 to 0.07, as the reference measures them: purples between magenta and blue, such as `#9900aa`, greens between green and yellow, such as `#33bb00`, and blue-greens between cyan and green, such as `#00ccbb`. Dark saturated colours past the solids with black are flagged too, such as navy `#000080` at about 0.09.
- Neither the view nor the reference holds patches with black over three inks, such as cyan and yellow 100% with magenta 40% and black 60%. The view's darkest patches are the solids with 40% black, and below them its edge runs straight to black; the reference also holds the solids with 60 to 100% black. Very dark colours are the least certain.
- Some pale colours really are outside. Pale greens and cyans with full sRGB green, such as `#ccffcc`, `#e0ffe0` and `#ccffff`, and the brighter yellow `#ffff99` are about 0.025 to 0.05 from the press's nearest colour, so a press prints them visibly duller or shifted in hue.

For a real printer, still soft-proof the PNG in an image editor with that printer's ICC profile and its gamut warning on.

Run `node --test tests/contact-sheet.test.js` for its checks: the file's parsing and refusals, known colours inside and outside, the magenta marks, the `--json` share, the caption, and flagged and passed colours against the reference. With `ARTIFEX_FOGRA39L` set, it also checks the counts and examples above.

### Style gap

With `--reference`, each 100% crop also gets a **style gap**: how far its look is from the photo crop's, measured in installed Edge on the pixels the sheet shows. The photo crop and each piece crop are the same size, so both are measured at one scale. The gap appears in a caption under each crop. With `--png` or `--json`, the command also prints one line per crop, such as `style gap, frame 48 (2.000 s): colour 0.61 · lightness 0.6 · chroma 0.0088 vs photo 0.0114 · ...`, and `--json` keeps the full gap as each cell's `style`. For example, `npm run seeds -- readout --at 2 --loupe --reference skills/artifex/styles/references/papercraft/torn-paper.webp --json`.

Every part is a statistic of the whole crop. None of them says where anything is: a mirrored picture of the same marks gives the same numbers. To find a shape in the wrong place, [compare a render with a reference](#comparing-a-render-with-a-reference) pixel by pixel. Colours are measured in OKLab, where lightness runs from 0 (black) to 1 (white) and `a` and `b` are the two colour axes, near 0 for grey. A blank margin the photo crop leaves at a `--reference-scale` that does not divide the crop is not measured; the piece crop is measured over white, as the sheet shows it.

| Part | What it measures |
| --- | --- |
| `colour` | How differently the two crops spread over OKLab colour bins: 10 lightness steps of 0.1, by 11 steps of `a` and 11 of `b`, each 0.06 wide, the middle step centred on grey. 0 means the same shares in every bin; 1 means no pixel in a common bin. |
| `lightness` | The same measure over 20 lightness steps of 0.05, with both histograms. |
| `chroma` | The mean colour strength. |
| `gradient` | The mean lightness change from one pixel to the next: how much edge and modelling there is. |
| `fine` | The share of pixels at a sharp change of lightness, such as a one-pixel line 0.05 off its ground or a hard edge of 0.1. |
| `bright` | The share of pixels with lightness over 0.9: paper and highlights. |
| `textureLight`, `textureDark` | How far each pixel's lightness is from the mean of its 3 x 3 neighbourhood, averaged where that mean is 2/3 or more, or 1/3 or less: grain, fibre or brush texture in the light and in the dark parts. |
| `bins` | The 5 colour bins whose shares differ most, each with its OKLab centre `L`, `a`, `b` and the share of each crop in it. |

`colour` is a single number. In the JSON, `lightness` is `{ gap, piece, reference }`: the number is in `gap`, beside the two 20-step histograms; the printed line shows only the number. Each of the other measures gives the piece's value, the photo's value and their `ratio`, piece over photo; a value is `none` (null in the JSON) where no pixel qualifies, and the ratio is null where the photo's value is 0. The `bins` list names colours rather than amounts: a bin of strong blue at 7% in the piece and 0% in the photo says the piece has blue marks the material does not.

The gap reports; it does not decide. There is no weight and no total score, and nothing searches parameters to shrink it. Read it with these limits:

- **A global measure cannot see a small local feature.** A highlight on one bead or a single dark crease changes the numbers by almost nothing, so check such features by eye in the crops.
- **Values compare only under one reference and one crop.** A different photo, `@x,y` point, `--reference-scale` or `--loupe` point changes both sides; compare gaps only between runs that keep all four.
- **A small gap is not a match.** Two crops can share every statistic and still read as different materials. The crops beside each other remain the judgement.

`node --test tests/contact-sheet.test.js` checks the arithmetic on generated images.

### Paint order

A thing drawn in front of another in some places and behind it in others, such as a plant whose blades are sorted by where their tips fall, is hard to see in a strip and easy to read from the paint calls. `tools/contact-sheet.js` exports three functions for a Node test or script:

- `recordMarks(size, draw)` calls `draw(g)` on a surface that paints nothing and returns every paint call in order, each with its `op` (`fill`, `stroke`, `fillRect`, `drawImage` and the rest), the `style` the surface held, its line `width`, the `box` its path's points span, widened by half the stroke, `starts`, the point of each `moveTo` in its path (`rect`, `arc` and `ellipse` add none), all in surface units, and `composite`, the `globalCompositeOperation` it was painted with. The box is the points' bounds: an arc or ellipse counts only the extent it sweeps, while a bezier or quadratic curve's control points still count, so the box tells where two marks can meet, not what they painted. Draw a frame with `drawFrame(g, piece, solved, playheads(piece)[frame])` from `core/render.js`.
- `paintOrder(marks, things)` takes names mapped to tests of a mark, such as `{ figure: (m) => m.style === WOOD, plants: (m) => m.width === 1.6 }`, and returns, for each pair, how many of the first thing's marks lie `behind` a mark of the second they meet and how many lie in `front` of one; both above zero is `mixed`, one thing on both sides of the other on this frame. A mark both tests pick is not compared with itself, and a mark painted with `destination-over` counts as behind every `source-over` mark it meets, painted before or after it; no other composite mode changes the order.
- `layerSwaps(piece, solved, frames, things)` draws each frame and returns `[{ frame, pair, behind, front, why }]`: `mixed` on that frame, or `swapped`, in front on one frame shown and behind on the next. An empty list means every pair kept its side.

A thing is whatever a test picks out, so the result is only as good as the tests: stride's plants taken as one thing are `mixed` on many frames, because the plants rooted in front of the walker are meant to be painted after it and those behind it before; split by the root (the lowest `starts` point), each side holds. A depth sort, such as the voxel style's `drawBoxes` (which also orders boxes that overlap on screen, so an overlap starting or ending can change which box is in front without centres crossing, and a cycle of boxes each in front of the next is painted from its lowest-depth box; see [the voxel guide](../../skills/artifex/styles/voxel.md)), that paints one thing's marks between another's on one frame is `mixed` the same way: split each thing by depth until every pair holds one side. The recording surface has no canvas, so a sprite or a static layer paints there directly and its marks appear one by one as the fills and strokes it paints, never as a `drawImage`; a raster-only piece's `clearRect`, `createImageData` and `getImageData` are accepted, the last two giving transparent pixels, its `putImageData` is a mark, `globalCompositeOperation`, `filter` and the shadow properties take any value, scoped by `save` and `restore`, and `createPattern`, `createConicGradient` and `measureText` give a stand-in style or width, so the site's style demos in `site/demos/` read, the compositing and shadowed ones included.

Run `node --test tests/contact-sheet.test.js` for the frames, seconds, shot strip frames and labels, contact rows, a `simulate()` contact log read as contacts, the crops around contacts on the strip page, refusals, columns, image width, loupe rectangle, the detail measure, both flags, the soundtrack's layout and analysis on synthetic tones, the value, greyscale and colour-vision views and the peak on generated images, the flat-fill silhouette measure on generated masks, and the paint order on a recorded draw, on stride's plants and on cascade's discs and ledges. The drawn cells, their times, their detail and the drawn soundtrack need installed Edge.

### Part coverage

`paintOrder` and `layerSwaps` report only a part that changes sides. A part that stays under a later mark for a whole beat, such as a held prop over the touching edge, gives them nothing to report. `--part` measures that case on each drawn frame: how much of the part's area does not show, such as under marks drawn after it.

`--part <name>=<colour>` names a part by the colour its marks are painted with. Join several colours with `+`, such as `--part edge=#ff0000+rgba(255, 0, 0, 0.5)`, and repeat `--part` for each part. It works on any time strip (`--frames`, `--at`, `--shots` or `--contacts`) and needs `--json`. Each of these is refused by name: a value without a name or a colour, an empty colour after `+`, a name given twice, `--part` without a strip, and `--part` without `--json`. The picture and the file name stay the same as the strip's without `--part`.

A mark belongs to a part when it is a fill, stroke, rectangle or text painted with one of the part's colours. Colours are compared as the canvas writes them, so `#f00` matches a mark painted `red` or `#ff0000`. An image or `putImageData` never belongs to a part, and a gradient or pattern cannot be named.

In the JSON, each drawn cell gains `parts`: one `{ name, share, covered }` per `--part`, in the order given.

| Field | Meaning |
| --- | --- |
| `share` | The part's area as a share of the cell, to 4 decimals. |
| `covered` | The share of that area that does not show, from 0 to 1, to 4 decimals: what later marks cover, and what the part's own compositing operator hides, as listed below. `null` when the part paints nothing on that frame. |

A cell gets `partsError` instead of `parts` when the piece throws while drawing without a canvas. The cell keeps its other fields.

A `--part` colour the canvas rejects, such as a misspelt name, is refused once the page is drawn: `seeds: --part takes colours the canvas reads, such as #f00 or rgba(255, 0, 0, 0.5), got <colour>`, then the usage line. Each cell's `partsError` holds the same message.

How it is measured: in installed Edge, on real pixels at the strip's own cell size, with two extra draws per part per cell. Both draws skip the finish, and layers and sprites paint mark by mark, as on the recording surface. The first draw paints only the part, for its area. The second paints the part in white and every other mark in black, in paint order, for what still shows.

- **The part counts as opaque**, whatever the alpha of its colour.
- **Each later mark keeps its alpha**, in any form the canvas writes the colour, such as `rgba(0, 0, 255, 0.25)` or `oklch(0.6 0.2 30 / 0.25)`. A gradient, pattern or image counts as opaque. Shadows and filters are ignored.
- **A mark painted before a `source-over` part covers nothing**, because it lies under it.
- **Compositing counts as the canvas shows it.** Every mark, the part included, keeps an operator that decides which pixels show, such as `destination-over`, `destination-out` or `source-atop`. A later `destination-over` mark goes under the part and covers nothing. A later `destination-out` mark erases the part's pixels it hits, and those count as covered. A blend mode such as `multiply`, and `lighter`, change only colour, so they count as `source-over`.
- **The part's own operator can hide it without a later mark.** Drawn `destination-over`, `destination-atop`, `source-out` or `xor`, the part is hidden where marks painted before it lie, and those pixels count as covered. Drawn `source-in` or `source-atop`, it shows only over earlier marks, so its pixels over empty canvas count as covered. Drawn `destination-in` or `destination-out`, it never shows, and `covered` is 1. Drawn `copy`, it shows whole and only later marks cover it.
- **An image drawn at a point, `drawImage(image, x, y)`, covers the size the canvas draws it at**: a `VideoFrame`'s `displayWidth` and `displayHeight`, an image's `naturalWidth` and `naturalHeight`, a video's `videoWidth` and `videoHeight`, and otherwise its `width` and `height`. SVG images follow what Edge draws instead. Edge ignores the `width` and `height` of the `<img>` or SVG `<image>` element itself.
  - **An SVG given as a `data:` URL**, percent-encoded, base64 or plain text, on an `<img>` or an SVG `<image>`, counts at the size its root `<svg>` element gives:
    - With a `width` and a `height`, it counts at that size.
    - With only one of them, the other comes from the `viewBox` ratio, or else from the canvas. On a 960 × 640 canvas, a `width` of 200 with no `viewBox` counts as 200 × 640.
    - With neither, it counts as its `viewBox` fitted whole inside the canvas, or else as the whole canvas. A `viewBox` of 4:1 on a 960 × 640 canvas counts as 960 × 240.
    - A percentage, or a value that is not a number, counts as no length. The units `px`, `in`, `cm`, `mm`, `pt`, `pc`, `em` and `rem` are read, with `em` and `rem` as 16 pixels.
    - A `viewBox` with a width or height of 0 draws nothing, so it covers nothing.
  - **Any other SVG source**, such as a file path, and a `data:` SVG the tool cannot read, count by these bounds. A `data:` SVG cannot be read when a length uses a unit that depends on the font, such as `ex` or `ch`, when its `viewBox` has a negative width or height, or when it sets `preserveAspectRatio="none"` with a `viewBox` and fewer than both a `width` and a `height`. Attribute names must match exactly as written (`viewBox`, not `viewbox`; `width`, not `WIDTH`), as in an SVG image. A `viewBox` that is not four finite numbers is ignored, so the SVG counts as one with no `viewBox`. A `width` and a `height` together count at those lengths even with `preserveAspectRatio="none"`.
    - An SVG `<img>` that reads 300 × 150 natural pixels counts as the whole canvas, because Edge draws an SVG with no size of its own at the canvas's size.
    - An SVG `<img>` that reads 150 natural pixels tall at any other width, as one with only a `viewBox` does, counts at that ratio fitted whole inside the canvas. A square one on a 960 × 640 canvas counts as 640 × 640.
    - An SVG `<image>` element counts as the whole canvas, the most of it that can show.

Limits:

- **Other marks painted in the same colour join the part.** Give the part a colour nothing else uses.
- **A `share` of 0 on a frame where the part shows means its marks are painted in another colour**, such as when the piece sets a colour the canvas rejects, so the mark keeps the colour set before it. Check the colour the piece sets.
- **Antialiased edges make a half cover read about 0.5, not exactly 0.5.**
- **Some SVG images drawn at a point count at the wrong size** when they are not a readable `data:` URL, because only the natural size tells them apart:
  - An SVG that really is 300 × 150, or has a `viewBox` of 2:1, counts as the whole canvas, which is too much.
  - An SVG that really is 150 tall, or has only a `width`, counts fitted inside the canvas, which is too much.
  - An SVG with a `viewBox` wider than 2:1, or with only a `height`, counts at its natural size, which is too little.
  - An SVG loaded from a `blob:` URL is not recognised as SVG, so it counts at its natural size, such as 300 × 150, which is too little.
  - An SVG `<image>` element holding a file with a size of its own counts as the whole canvas, which is too much.

Example: on `tests/fixtures/touching-film.cjs` a red and a blue square overlap by half, and they swap paint order on odd frames.

```sh
npm run seeds -- tests/fixtures/touching-film.cjs --at 0,0.125 --part red=#f00 --part blue=#00f --part green=#0f0 --json
```

In installed Edge at 640 pixels, frame 0 gives red `covered` 0.4992, blue 0 and green 0, and frame 1 gives red 0, blue 0.4992 and green 0. Each square's `share` is 0.0651 and the green one's 0.0163. `node --test tests/contact-sheet.test.js` checks the measure on drawn pixels of the touching film and the page wiring.

### Figure silhouettes

A figure must read as a flat fill: its painted silhouette in one colour on a plain ground, as [the silhouette rules of the film guide](../../skills/artifex/reference/films.md#silhouette-and-line-of-action) ask. `--figure` draws that fill under each frame of a time strip and measures it: the gaps of ground between its parts, the holes, the width and the widest single run at each tenth of the figure's height, and whether its mass stands over its base.

`--figure <name>=<colour>` names a figure by the colours its painted fill and contour strokes use. Join several colours with `+`, such as `--figure body=#b07a5a+#2a2320`, and repeat `--figure` for each figure. It works on any time strip (`--frames`, `--at`, `--shots` or `--contacts`), on the plain page, with `--png` and with `--json`. Each of these is refused by name: a value without a name or a colour, an empty colour after `+`, a name given twice, and `--figure` without a strip. The page and its PNG take `+figure` at the end of their file name, so they never replace the plain strip.

A mark belongs to the figure when it is a fill, stroke, rectangle or text painted with one of its colours, compared as the canvas writes colours, as for [`--part`](#part-coverage). Under each cell, one flat-fill view per figure shows those marks in near-black on white, with a 1-pixel red line at the centre of its mass over the figure's height. Its caption gives the count of gaps and closed gaps, the widest gap at film size, the pinholes, and whether the plumb line falls over its base, or says the figure painted nothing.

In the JSON, each drawn cell gains `figures`: one entry per `--figure`, in the order given, with these fields in design units to 2 decimals:

| Field | Meaning |
| --- | --- |
| `name` | The figure's name. |
| `area` | The filled area. 0 when the figure paints nothing on that frame. |
| `box` | `[x0, y0, x1, y1]`, the box of the fill, or `null`. |
| `gaps` | Each connected patch of ground that has the figure on both sides of it on its own row, as `{ x, y, w, h, area, widest, closed }`, top to bottom. `widest` is its longest run across a row, in pixels of the saved film to 1 decimal. `closed` is `true` when no ground joins it to the frame's edge: a hole, such as the ground a bent part encloses where its tip touches the main mass. Patches under 4 cell pixels are left out. |
| `pinholes` | The count of closed patches under 4 cell pixels: seams in the fill. |
| `widths` | 9 widths: the span of the fill on the rows at 0.1 to 0.9 of the box's height, from its top, first filled pixel to last. A row that crosses a part beside the main mass spans it too, so it is never the mass's own width. 0 on a row the fill misses. |
| `runs` | On the same 9 rows, the longest single unbroken run of filled pixels. A part with ground between it and the rest on that row is left out, so the run reads the widest mass alone. 0 on a row the fill misses, and `null` when the figure paints nothing. |
| `widthStep` | The largest change of any of the 9 widths since the previous drawn cell, as a share of this cell's box height. `null` on a cell that opens a run, as `change` is, and when either cell paints nothing. |
| `plumb` | `{ x, from, to, over }`: `x` the centre of the fill's mass across, `from` and `to` the span of its lowest rows (2% of the box height, 2 rows at least), and `over` whether `x` lies inside that span. `null` when the figure paints nothing. |

A cell gets `figuresError` instead of `figures` when the piece throws while drawing without a canvas. The cell keeps its other fields, and a caption under the cell, `flat fill failed:` and the message, says it on the page and in its PNG.

A `--figure` colour the canvas rejects, such as a misspelt name, gives every cell that `figuresError` and caption. With `--png` or `--json` the run is then refused: `seeds: --figure takes colours the canvas reads, such as #b07a5a or rgba(176, 122, 90, 0.5), got <colour>`, then the usage line. The page is written, and no PNG. Without either, open the page and read the caption.

How it is measured: in installed Edge, on real pixels at the strip's own cell size, with one extra draw per figure per cell. The draw skips the finish, and layers and sprites paint mark by mark, as for `--part`. Only the figure's marks are painted, opaque and with no shadow or filter, so a later mark of another colour never cuts the fill. A pixel with an alpha of 128 or more is inside the figure.

Limits:

- **Other marks painted in the figure's colours join it**, such as a fine line inked in the contour's colour above the shape. Give the fill and the contour colours nothing else uses.
- **Every notch counts as a gap.** Ground between two parts that rise from the top of the shape, or between two parts that hang below it, has the figure on both sides of its row. Read each gap by its place in `gaps` and on the view.
- **Every mark in the figure's colours fills solid.** The fill is painted opaque and `source-over`, so a mark painted at an alpha of 0, or with an erasing operator such as `destination-out`, fills as if it were painted.
- **The widths sit at tenths of each frame's own box.** A part raised above the shape, or the shape crouching lower, moves the rows, so `widthStep` can rise without a twist. Compare keys of the same height.
- **`widthStep` reads `widths`, not `runs`.** A part that swings out beside the rest widens `widths` and raises `widthStep`; compare `runs` across frames to read the widest mass without it.
- **A run counts only filled pixels in a row.** A part pressed against the rest with no ground between them on a row joins the run, and a pinhole or a seam on the row splits it.
- **A strip at the default 640-pixel cell is smaller than the film.** A gap can close in the cell and open in the film. Judge gaps by `widest`, which is in film pixels, or draw the strip at film size with `--scale` set to the piece's `filmScale`, 1920 divided by its long edge.
- **The 4-pixel floor and the alpha of 128 are starting values**, not measured on films.

Example: on `tests/fixtures/touching-film.cjs` a red square is drawn at 100 to 300 design units on frame 0 and moves to 200 to 400 on frame 1.

```sh
npm run seeds -- tests/fixtures/touching-film.cjs --at 0,0.125 --figure red=#f00 --json
```

In installed Edge at 640 pixels, frame 0 gives `area` 39800.25, `box` [100.5, 100.5, 300, 300], no gaps, 0 pinholes, every width and run 199.5 and `plumb` { x: 200.25, from: 100.5, to: 300, over: true }. Frame 1 gives `box` [199.5, 100.5, 400.5, 300], every width and run 201 and `widthStep` 0.01. The edges sit within a cell pixel, 1.5 design units, of the drawn values, because the cell is drawn at two thirds of the design size. `node --test tests/contact-sheet.test.js` checks the measure on generated masks, the fill on the touching film's drawn pixels, and the page wiring.

### Armature overlay

A piece posed with the [depth armature](../apis/piece-api.md#depth-armature) (`pose`, `reach` and `project` in `core/armature.js`) is painted over chains of segments you never see. `--armature` shows them: under each frame of a time strip it draws the same frame again with the chains over it, and it prints the joint faults of every frame of the film.

`--armature` takes no value. It works on any time strip (`--frames`, `--at`, `--shots` or `--contacts`), on the plain page, with `--png` and with `--json`. The checks run in Node, so the faults print even without `--png` or `--json`. The page and its PNG take `+armature` at the end of their file name, so they never replace the plain strip.

On the overlay, each segment's bone axis is a blue line, each end's section is a thin blue ellipse, and each joint is a dark dot. A joint named by a line or limit fault, and a planted end that slides, get a red ring on that frame. The caption under the overlay counts the chains and lists the faults on that frame, such as `armature: 1 chain · 1 joint fault: chain joint 1 off its line`.

#### What the piece keeps

The piece keeps its posed chains in its built state, in `state.cues.armature`:

| Key | What it holds |
| --- | --- |
| `state.cues.armature` | A list with one entry per frame of the film, in frame order; a still keeps one. Each entry is a list of chains, or `null` or `[]` for a frame with nothing posed. |
| `name` | A non-empty string, different from every other chain's name on that frame. Faults compare a chain with the chain of the same name on the frame before. |
| `segments` | A non-empty list of `{ start, end, radius: [r0, r1] }`, the shape `pose` returns; other keys are ignored. Each segment starts where the one before it ends. Joint `j`, from 1 to the segment count minus 1, is where segment `j - 1` ends and segment `j` starts. |
| `view` | Optional. The options `project` takes, `{ view, up, focal, centre, perspective }`; without it, the default view. The overlay is projected with these options. |
| `front` | Optional. `true` says the chain is seen in a front view, so the line rule applies to it; `false` or no `front` leaves the rule off. |
| `limits` | Optional. An object keyed by joint number, each value the largest bend at that joint in radians, above 0 and at most π, such as `{ 1: 2.4 }`. |
| `reasons` | Optional. An object keyed by joint number, each value a non-empty string: why the pose bends that joint off the line on that frame. A joint with a reason is left out of the line rule on that frame. |
| `planted` | Optional `'start'` or `'end'`: the end of the chain that holds still on that frame. |

A build stage keeps it like this, posing each frame's chains itself:

```js
const { pose } = require('artifex/core/armature.js');

const FRAMES = 48;
const chainOn = (frame) => ({
  name: 'chain',
  front: true,
  limits: { 1: 2.4 },
  segments: pose([320, 100, 0], { forward: [0, 1, 0], side: [1, 0, 0] }, [
    { length: 160, radius: [20, 14] },
    { length: 160, radius: [14, 8], bend: 0.3 * Math.sin(frame / 8) },
  ]),
});

module.exports = {
  // ...
  build: [['armature', (s) => { s.cues = { ...s.cues, armature: Array.from({ length: FRAMES }, (_, f) => [chainOn(f)]) }; }]],
};
```

#### Rules

| Fault | When it is flagged |
| --- | --- |
| line | On a chain with `front: true`, a joint with no reason lies off the picture line between its two neighbouring joints by more than 0.05 of the distance between those neighbours. |
| limit | A joint bends more than its limit: the angle between the segments either side of it, in 3D. |
| length | A segment's 3D length changes by more than 0.01 of its length on the frame before. |
| slide | A planted end moves more than 0.5 design units in 3D since the frame before, when the chain was planted at the same end there. |

#### What it prints

After the page's path and summary, seeds prints one line for the whole film, then one line per frame with faults:

```text
armature: 4 of 12 frames with joint faults (rules: line 0.05 of the span in a front view, length 0.01, slide 0.5 design units)
frame 2 (0.167 s): chain joint 1 leaves the line between its neighbours by 0.204 of their span in a front view, with no pose reason
frame 7 (0.583 s): chain segment 0 changes length by 0.1 of it since the frame before; chain planted end slides 3 design units since the frame before
frame 9 (0.750 s): chain joint 1 bends 2.891 rad, past its limit of 2.4
```

A film with no faults prints `armature: no joint faults on <frames> frames`. Up to 24 frames are listed; after them, one line counts the rest. With `--json`, these lines go to standard error.

#### Armature JSON and refusals

With `--json`, `strip.armature.rules` holds the rule values, and `strip.armature.faults` lists every fault of the film in frame order. Each fault is `{ frame, chain, kind, value, rule }`, plus `joint` for `line` and `limit`, `segment` for `length`, and `end` for `slide`. `value` is the measure the rule compares: the share of the span, the bend in radians, the share of the length, or the distance in design units. Each drawn cell gains `armature`: the faults on its frame.

The command refuses, and names the cause:

- `--armature` given twice: `use --armature only once`;
- `--armature` without a strip: `--armature reads the frames of a time strip; add --frames, --at, --shots or --contacts`;
- a piece that fails to build: `<piece> fails to build at <stage>: <message>`, the stage `state()` when the piece's `state()` throws;
- a piece that keeps no `state.cues.armature`: `--armature reads one armature per frame from state.cues.armature, and <piece> keeps none there`;
- a list with another count than the film's frames, or a value that is not a list: `... and <piece> keeps 3 for its 12 frames`, or `keeps no list for its 12 frames`;
- an entry that is not a list: `--armature: state.cues.armature entry [3] is not a list of chains`;
- a chain with no name, or a name another chain on its frame has: `entry [3] chain [1] needs a name of its own`;
- segments `project` refuses, with its message, such as `entry [3] chain chain: project: segment 0 has zero length; give it an end apart from its start`;
- a segment that does not start where the one before it ends: `entry [3] chain chain: segment 1 starts 2 from where segment 0 ends; a chain's segments join end to start, as pose returns them`;
- a `view` that is not an object, a `limits` or `reasons` key that is not a joint of the chain, a limit that is not a bend above 0 and at most π, an empty reason, a `front` other than `true` or `false`, and a `planted` other than `'start'` or `'end'`, each named by entry, chain and key.

Limits:

- **A front view is the piece's statement.** The tool never guesses it from the view; a chain without `front: true` gets no line rule.
- **A limit is an unsigned largest bend.** A joint that bends the wrong way within its limit is not flagged.
- **Comparisons skip some frames.** The length and slide rules both skip a frame that opens a shot, from `state.cues.shots`, and a chain missing on the frame before. Only the length rule skips a chain with another segment count there; the slide rule skips a chain planted at another end there, or not planted.
- **The overlay shows what the piece keeps, not what it paints.** It is projected with each chain's own `view` and drawn at the cell's scale. A piece that paints with other projection options sees the overlay off its strokes.
- **The rule values are starting values**, not measured on films.

From Node, `armatureList(piece, state)`, `jointFaults(frames, opens)` and `armatureText(faults, frames, hz)` in `tools/contact-sheet.js` read the armature, find the faults and write the lines. Run `node --test tests/contact-sheet.test.js` for the parsing, the refusals, each fault kind and the page wiring.

### Pixel samples

`--sample x,y` reports the colour at one design point on each drawn frame, so you can compare a mark's colour across frames by numbers, such as one paint colour under two lights. Repeat `--sample` for each point. It works on any time strip (`--frames`, `--at`, `--shots` or `--contacts`) and needs `--json`. Each of these is refused by name: a point that is not two plain numbers `x,y`, a point given twice, a point outside the piece's box, `--sample` without a strip, and `--sample` without `--json`. The picture and the file name stay the same as the strip's without `--sample`.

In the JSON, each drawn cell gains `samples`: one `{ x, y, L, a, b, C, h }` per point, in the order given. `x` and `y` are the design point. `L`, `a` and `b` are its OKLab colour, `C` its OKLCh chroma, each to 4 decimals, and `h` its OKLCh hue from 0 to 360 degrees, to 1 decimal, or `null` when `C` rounds to 0.

How it is measured: the point maps to the cell pixel `floor(x × scale)`, `floor(y × scale)`, kept inside the cell. The colour is the mean OKLab of the 3 × 3 pixels around that pixel, clipped to the cell, each laid over the sheet's white, as `lightness` and `chroma` are.

Limits:

- **The colour is read at the strip's scale**, 640 pixels wide by default, not at the film's export size. One cell pixel covers about 1.5 design units on a piece 960 wide.
- **A point near a mark's edge reads a blend** with what lies next to it. Keep each point at least 2 cell pixels inside the mark, about 3 design units at the default scale.
- **Grain and texture vary from pixel to pixel**, even after the 3 × 3 mean. Sample a few points inside a mark before you compare it across frames.
- **A failed cell has no `samples`.**

Example: on `tests/fixtures/touching-film.cjs` the square at x 100 is red on even frames and blue on odd ones, and a green square sits at x 600.

```sh
npm run seeds -- tests/fixtures/touching-film.cjs --at 0,0.125 --sample 650,150 --sample 150,200 --sample 800,500 --json
```

In installed Edge at 640 pixels, the green point reads `C` 0.2948 and `h` 142.5 on both frames. The point at 150,200 reads red, `C` 0.2577 and `h` 29.2, on frame 0, and blue, `C` 0.3132 and `h` 264.1, on frame 1. The point on the empty ground reads `L` 1, `C` 0 and `h` `null`. `node --test tests/contact-sheet.test.js` checks the parsing, the refusals, the 3 × 3 mean on generated images and the page wiring.

### Two values

A film held to two values, such as a stencil or ink look, declares them on its beat sheet ([films](../../skills/artifex/reference/films.md)). On a time strip of such a film, each frame reports how much of its tone lies between the two values and is flagged when that share is too large.

Give the values in one of two ways:

- **`--two-values dark,light`**, two OKLCh lightnesses, such as `--two-values 0.12,0.88`.
- **The beat-sheet line `// two values: 0.12, 0.88`** in an external piece's entry file, `/* two values: 0.12, 0.88 */`, or ` * two values: 0.12, 0.88` inside a block comment, with LF or CRLF line endings. Seeds reads the first comment line that opens with `two values:`, passing over one that still holds the `<dark L>, <light L>` placeholder; prose such as `// keeps to two values: ink and paper` declares nothing; the line holds two plain decimals and nothing else, such as `0.12` and not `.12`. `--two-values` wins over the line. Registered examples declare none.

A mistyped line declares nothing, so seeds warns on stderr about any other line with a digit somewhere after `two values:`, such as `x(); // two values: .12, .88` or `x(); // two values: dark 0.12, light 0.88` after code. Prose with no digit after `two values:` that does not open the comment, such as `// keeps to two values: ink and paper`, stays silent. A comment that opens with `two values:` is a declaration even without a digit: `// two values: ... ink and paper` is refused when it is the first such line, and warns after a real declaration. The warning names the file and the line and quotes the rest of that line as written: `warning: ./my-film.cjs line 4 holds two values: .12, .88, but seeds reads two values only from a comment line that opens with them, such as // two values: 0.12, 0.88`.

Seeds also warns about each comment line after the first that opens with `two values:`, quoting it, since only the first counts: `warning: ./my-film.cjs line 5 holds // two values: .2, .9, but seeds reads two values only from the first comment line that declares them, line 4`. A placeholder line gets no warning. Any other value that opens with `<`, such as `// two values: <0.12>, 0.88`, declares nothing and warns.

When values are in force, seeds prints one line naming them and where they came from, such as `two values 0.12, 0.88 (OKLCh L), from the beat sheet in ./my-film.cjs`. It works on any time strip (`--frames`, `--at`, `--shots` or `--contacts`), with or without `--json`. Each of these is refused by name: a value that is not two plain decimals `dark,light`, a value outside 0 to 1, a dark value less than 0.2 under the light one, `--two-values` given twice, `--two-values` without a strip, and a beat-sheet line that breaks the same rules. The file name stays the strip's.

What it reports:

- **`between`** on each drawn cell: the share of its pixels whose OKLCh lightness is more than 0.05 from both values, to 4 decimals, each pixel laid over the sheet's white. The caption shows it as `between values 1.0%`.
- **`window.__sheet.flags.between`**: one `{ cell, frame, seconds, t, share }` for each drawn cell whose share is over `STRIP_RULES.between`, 2%. The flagged cell's caption reads `tone between the two values: 10.9% of pixels more than 0.05 from both 0.19 and 0.92 (over 2%)`, and the strip report ends with `Tone between the two values in 3 of 9 frames.` or `Every frame keeps to the two values.`
- **`window.__sheet.strip.twoValues`**: the values in force, `[dark, light]`.

Without declared values a cell has no `between`, `flags.between` is an empty list, and the strip report says nothing about two values.

Limits:

- **Anti-aliased edges count as between.** A frame of light shapes with smooth edges on a dark ground reads about 1% at 640 pixels. Many fine edges, grain or a vignette can pass 2%; look at the grey view to see where the mid tones sit.
- **The share is read at the strip's scale**, 640 pixels wide by default, so edges weigh more in a smaller cell.
- **A failed cell has no `between`.**
- **It sees what the other readouts miss.** The 5th and 95th lightness percentiles ignore a value under 5% of the frame, and the value view blurs fine detail into a mid area; `between` counts every pixel and blurs nothing.

Example: the test film `tests/fixtures/two-value-film.cjs`, light discs and a band on a dark ground, `rgb(230, 230, 230)` on `rgb(20, 20, 20)`, declares `two values: 0.19, 0.92`; its middle shot adds a mid-grey bar over a tenth of the frame.

```sh
npm run seeds -- tests/fixtures/two-value-film.cjs --shots --json
```

In installed Edge at 640 pixels, with the file saved with LF or with CRLF endings, the six cells of the first and last shots read `between` 0.0094 to 0.0101, all from the discs' edges, and the three cells of the bar shot read 0.109 to 0.1096; only those three are flagged. Every cell, flagged or not, reads the same lightness `p5` 0.1913 and `p95` 0.9249. `node --test tests/contact-sheet.test.js` checks the share on generated images, the parsing, the refusals, the beat-sheet line with either line ending, `flags.between` from `stripFlags`, and the page's captions and flags.

## Saving a still

`npm run still -- <piece | ./piece.cjs> [--out file.png|file.svg] [--seed n] [--at s] [--scale k] [--box WxH] [--edge PATH] [--timeout-ms N] [--headed]` saves one frame of a piece as the page's PNG or SVG button saves it, with its replay manifest. Use it for a still, which `npm run film` refuses. `--style` is refused, since a style draws nothing (see [style packs](#style-packs)).

- **Which file.** A PNG by default. `--out` names the file, relative to where you ran npm, and its extension picks the format. Without `--out`, the PNG goes where `npm run film` puts a film, with `.png` for `.mp4`: `out/<example>.png`, or beside an external piece.
- **PNG.** Drawn by the page's own drawing in installed Edge, at `--scale` pixels per design unit, 1 by default. A pixel the piece leaves unpainted stays transparent in the PNG, so `npm run measure` counts it under `transparent` and a hole cut through a region comes back as a `hole: true` outline ([holes](#holes)).
- **SVG.** Drawn in Node without Edge, at the design box. The command refuses an SVG of a piece that declares raster only, and `--scale` with an SVG.
- **Seed and time.** `--seed` draws at another seed; the piece's own seed is the default. For a piece with a timeline, `--at` picks the frame that holds that second, as the [time strip's `--at`](#time-strips) does; 0 is the default. A still takes only `--at 0`. For a film, the command saves that one frame and says that `npm run film` saves the whole film.
- **Box.** `--box WxH` draws the frame at another box, written as for [`npm run seeds -- --box`](#contact-sheet-sweeps-and-metrics), such as `--box 405x720`. A PNG is then `--scale` pixels per design unit of that box. The command refuses by name a box the piece does not declare: a piece without `boxes` names the one size it draws at, and a box outside the declared ranges names the widths and heights the piece takes. The replay manifest records the box, so `npm run replay` draws the file again at it. Without `--box`, the piece draws at its own size.

The printed line names the file, its piece and seed, the box when `--box` gave one, and the replay command that checks it, with `--piece` when the file needs one:

```sh
npm run still -- ./dots.cjs --scale 0.5
npm run replay -- dots.png --piece dots.cjs
```

Run `node --test tests/cli.test.js` for the refusals and for saved SVGs that `npm run replay` matches at the seed, second and box asked. A saved PNG needs installed Edge, for example `npm run still -- refit --box 405x720` and then `npm run replay -- out/refit.png`.

## Saving a film

`npm run film -- <piece | ./piece.cjs> [--out file.mp4] [--seed n] [--scale n] [--bitrate bit/s] [--reframe t:WxH,...] [--force no-aac|no-webgl2] [--crash-gpu ms] [--edge PATH] [--timeout-ms N] [--headed]` saves the MP4 film the page's MP4 button saves. `--style` is refused, since a style draws nothing. There is no second exporter; [output formats](output-formats.md#saving-a-film-from-the-command-line) describes the file, its location and its report.

- **How it runs.** Through the page's own `__artifex.film()` in installed Edge on [`withEdge`](../../tools/check-browser.js), the browser check's lifecycle: a unique temporary profile, a loopback server and the same cleanup. Relative paths resolve from npm's invocation directory.
- **Seed.** `--seed` films at another seed, a whole number from 0 to 4294967295, as [`npm run still -- --seed`](#saving-a-still) draws one frame; the piece's own seed is the default. The film's replay manifest records the seed, so `npm run replay` draws the film again at it. Without `--out` the file name gains `-seed<n>`, so films at two seeds stay apart.
- **What it writes.** The film and its report, and one printed line: the page's film note and the report's path. A film with sound also writes `<film>.mp4.sound.png`, described below.
- **Looks not taken.** The report's `looks` field lists which looks of [Look at a film](../../skills/artifex/reference/films.md#look-at-a-film) have a strip from `npm run seeds` beside the piece's other output, drawn at the film's `--seed` and `--reframe`, that is no older than the piece's modules: `seeds`, `frames`, `at`, `loupe` (any strip drawn with `--loupe`), plus `shots` when the report carries a shot list, `contacts` when the piece's state built at the film's seed and box timeline keeps a list that `--contacts` draws, and `sound` when the film has sound. Each sits under `fresh`, `stale` (every strip is older than `source`) or `missing`; a `contacts` field names the contact lists found, such as `cues.contacts`, searched three levels deep. For each stale or missing look, the command prints a reminder on stderr, such as `film: look not drawn: seeds; ...` or `film: look older than <module>: frames; ...`, with the `npm run seeds` options that draw it, naming the contact list and repeating the film's `--seed` and `--reframe` (a contact sheet, which sweeps seeds, takes only `--reframe`). Its last stderr line says what a [fresh-eyes review](../../skills/artifex/reference/films.md#fresh-eyes-review) by a subagent without the work's context finds: a place left unshown, a cause off screen, or a beat that reads only to someone who knows it. The film is saved either way. The piece's modules are the ones the film bundles for it, in whatever folder they sit, never the library's `core/` or `examples/` modules; one that can no longer be read when the film is saved is skipped. `source` names the one that changed last, so an edit to a helper module makes the strips drawn before it stale.
- **When the export ran twice.** The film note says so when the export redid part of its work, and the report's `encoderError` and `contextLost` fields hold the cause. `Drawn again from the first frame, in memory, after the canvas lost its GPU.` and `Drawn again from the first frame, in memory, after the video encoder failed.` mean the export drew the whole film a second time. `The sound was encoded again after its encoder failed.` means the soundtrack was encoded a second time, without being rendered again. `Drawn twice: the encoder route failed, so the film was drawn again from the first frame with its colour converted on the GPU.` (or `CPU`) means the encoder route stopped after its first frame and the export drew the film again, converted. A film that needed none of these has no such sentence, and neither has a film whose encoder route stopped before its first frame, because nothing of the film was drawn twice; the note's colour route names the route that made the film. A film that needed both the converted and the in-memory pass gets only the in-memory sentence. [Output formats](output-formats.md#which-failures-the-report-names) lists the `encoderError` values.
- **When the GPU is lost.** Only the CPU route's canvas is watched for a lost GPU; a loss there draws the film again in memory. A loss while the GPU route converts the colour fails the export with `film: the GPU lost the colour conversion part-way through the film. Nothing was saved.` If the same crash also stops the video encoder, the result depends on which failure the export notices first. On the GPU route, an encoder error noticed first gives a `video: ` entry and a film drawn again in memory and saved. On the CPU route, the film is drawn again in memory either way, with `contextLost` true or a `video: ` entry. This order is read from the code in [`core/film.js`](../../core/film.js), not observed in a browser.
- **GPU crash.** `--crash-gpu <ms>` crashes the GPU process of the command's own Edge that many milliseconds into the export, and the report records it as `gpuCrash`. See [crashing the GPU during a saved film](verification.md#crashing-the-gpu-during-a-saved-film).
- **When it fails.** It exits nonzero with the page's message when the export fails, and writes nothing when fewer bytes arrive than the film holds.
- **Deadline.** The deadline covers the whole run, ten minutes by default, up to an hour with `--timeout-ms`.

Check the film with `npm run replay -- <file>`, adding `--piece` for an external piece.

For a film with sound, the command also draws the soundtrack the saved file plays. The page decodes the film's own AAC or Opus track with `decodeAudioData`, as `npm run replay` does. It draws the result as the [time strip's soundtrack](#time-strips) is drawn, 1280 pixels across the whole film: the waveform and its loudness over 50 ms, over a spectrogram from 40 Hz to 16 kHz. Grey lines mark the nine frames a nine-frame strip shows. A red line marks where each shot after the first starts, labelled with that shot's name. Each stretch of 0.5 s or more where the decoded track stays under -60 dBFS is shaded and labelled with its length, as in the time strip, so a film that opens on silence or drops out between its sounds shows it. The shading refuses nothing. The cuts come from the shot list the exported solve keeps in `state.cues.shots`, which the page's report carries as `shots`. A piece with one shot has no red line, and neither has a piece that keeps no shot list, an empty one or an invalid one, where a shot's name is not a non-empty string, starts or ends off a whole frame or before frame 0, ends no later than it starts or ends after the film's frame count (an `end` equal to the frame count is valid, because `end` is the first frame after the shot): the report's `shots` is then `null`, and the picture is still drawn. The picture is written as `<film>.mp4.sound.png`, for example `out/readout.mp4.sound.png`. The report's `decoded` field holds its path, length in seconds, peak (`peakDb`) and loudness range (`rmsDb`), and the summary line names it.

Use this picture to see what the AAC or Opus encoding did to the sound. The time strip's `--sound` picture shows the offline render instead, levelled as AAC whatever codec the browser uses. If the browser cannot decode the track, or the decoded track holds no samples (`the soundtrack holds no samples, so there is nothing to draw`), no picture is written: `decoded` holds the `error`, and the summary line quotes it after `The soundtrack could not be decoded to draw it:`. A film without sound writes no picture, and a picture left by an earlier run under the same name is removed.

`--force` installs one of the browser check's conditions in the page before it loads, as [`npm run browser -- --force`](verification.md#what-verification-establishes) does, so the film is the one a browser without that feature saves. `--force no-aac` refuses AAC, so a film with sound carries an Opus soundtrack. `--force no-webgl2` hides WebGL2, so the film's colour is converted on the CPU. When the export can tell where it drew the frames, the summary line also says `Film made from frames drawn on the GPU.` or `Film made from frames drawn in memory.`, from the report's `rasterizer` field. A film drawn in memory takes longer, so this sentence explains a slow time. The report then carries `forced` with the condition's name, and the summary line starts `film with AAC refused` or `film with WebGL2 hidden` instead of `film`. `--force no-h264` is refused by name before Edge starts: without H.264 the page offers only its WebM recording, which this command does not save; check that recording with `npm run browser -- --force no-h264`. `--force gpu-crash` is refused too, because here it would only hide WebGL2 and crash nothing; use `--crash-gpu <ms>` instead. One `--force` is taken per film.

`--reframe t:WxH,t:WxH,...` films the piece along that [box timeline](../apis/piece-api.md#box-timeline) instead of its own, written as for [`npm run seeds -- --reframe`](#contact-sheet-sweeps-and-metrics). The command refuses by name, before Edge starts, an entry not written `t:WxH` and a timeline `atBox` refuses. The film's replay manifest records the timeline, so `npm run replay` draws the film along it:

```sh
npm run film -- refit --reframe 0:720x720,0.5:405x720,1:1280x720
npm run replay -- out/refit.mp4
```

Run `node --test tests/film-cli.test.js` for the arguments, `--seed` and its refusals, `--reframe` and its refusals, `--force` and its refusals, the `forced` field and summary line, the `rasterizer` sentence, the `.mp4` rule, the output locations, the page function against a stand-in page and what the command writes, the soundtrack picture and its `decoded` field included, and the `looks` field with its stderr lines. The export itself needs installed Edge.

## Joining films

`npm run stitch -- <a.mp4> <b.mp4> [more.mp4 ...] -o <out.mp4>` joins MP4 films saved by Artifex into one film, in the order given, without encoding them again. Use it for a film too long to export in one tab: export each scene with `npm run film`, then join the scene films. The films must share their size, frame rate and codec configuration, so export every scene at the same `--scale` and `--bitrate`, and with the same soundtrack codec. [Joining scene films](output-formats.md#joining-scene-films) describes what the join does to the pictures, the sound and the replay manifest.

1. Export each scene, for example `npm run film -- ./scene-1.cjs --out scenes/1.mp4`, and the same for the other scenes.
2. Join them: `npm run stitch -- scenes/1.mp4 scenes/2.mp4 scenes/3.mp4 -o film.mp4`. The command prints one line with the scene count, frames, length, size, rate and soundtrack codec, and how many milliseconds after its first frame each later scene's sound starts.
3. Check the joined film: `npm run replay -- film.mp4 --piece ./scene-1.cjs --piece ./scene-2.cjs --piece ./scene-3.cjs`. Each scene gets its own verdict line.

`-o` (or `--out`) is required, must end in `.mp4`, and must not name one of the films being joined. Relative paths resolve from npm's invocation directory. A film that cannot be joined is refused before anything is written, naming the film and the difference, and the command exits nonzero.

Run `node --test tests/stitch.test.js` for the joined frames and packets with AAC and Opus, each scene's recorded frames, sound position and judged samples, films without sound, every refusal, the command's arguments and output, and replay's plan, seeks, sound judgement and output for a joined film. The tests join films exported against stand-in encoders. Hearing a joined soundtrack and decoding its frames needs installed Edge, through `npm run replay`.

## Replaying a saved file

`npm run replay -- <file> [--piece ./piece.cjs] [--edge PATH] [--timeout-ms N] [--headed] [--json] [--seed N] [--dump <folder>] [--save-frames <frames>] [--lag <other.mp4> --at <frame or s>] [--region x,y,w,h]` reads the replay manifest a saved SVG, PNG, MP4 film or WebM film carries, draws its recipe again and reports whether the file matches; [output formats](output-formats.md#replaying-a-saved-file) describes what each type proves and its limits.

- **External pieces.** Pass `--piece` with the module that made a file from an external piece.
- **Styles.** A style draws nothing, so no file comes from one. `--style <name>` is refused before the file is read, with the paths of the style's guide and module.
- **Joined films.** For a joined film from `npm run stitch`, pass `--piece` once for each external piece among its scenes. Each scene is then replayed against its own recipe and printed on its own line under the verdict. The scenes of registered examples share one Edge page, and the scenes of each external piece share another. Each page fetches the film once from a server that the replay runs on loopback (127.0.0.1).
- **Another seed.** `--seed N` redraws the file's recipe at seed `N` instead of its own and compares the file with that, to see how far another seed's picture or sound lies from the one saved. It is a comparison, not a verdict: the line reads `against its recipe at seed N instead of its own seed M: differs` (or `the same picture`), with the first difference as usual, the report is written as `replay-<file name>-seed<N>.json` with the file's own seed as `manifest.savedSeed`, and the command exits 0 either way. A joined film is refused: it holds one recipe per scene.
- **Sound margins.** For an MP4 film whose soundtrack matches, the report's `sound.margins` holds the lowest value each sound rule met, as `{ db, threshold, at }` with `at` the second of that block: `floor` (a block's distance from the render), `waveform` and `band` (its noise-like bands together and the one judged alone), `near` (a nearly noise-like band's level), `level` and `onsetLevel` (the levels of its noise-like bands away from an onset and beside one). A rule no block came under is left out. `sound.mask` is the codec's masking depth in dB, which `blocks.json` of `--dump` carries too. A film that passes a rule by a fraction of a dB is one a small change of piece or browser will fail.
- **Time limit.** `--timeout-ms N` is the time allowed per film, from 100 to 300000 milliseconds, 60000 by default. A PNG or WebM replay, or an MP4 film that is not joined, gets `N` milliseconds. A page of a joined film gets `N` once for each scene it replays, so a page of three scenes gets three times `N`.
- **Paths and browser.** Relative paths resolve from npm's invocation directory, as for `page` and `seeds`. A PNG or film replay starts installed Edge through [`tools/check-browser.js`](../../tools/check-browser.js), which takes the same `--edge`, `--timeout-ms` and `--headed` options; an SVG replay needs no browser.
- **Output.** The command prints a verdict line and the absolute path of its full JSON report, written as `replay-<file name>.json` beside the replayed file when that file lies outside the library, such as `replay-strata.png.json` next to `strata.png`, and under the library's `out/` when the file is inside the library, such as `out/replay-readout.svg.json`. The report is replaced on the next replay of a file with that name in that folder. `--json` prints the JSON report on standard output instead and writes no file. The verdict line, and a line for each scene of a joined film, then go to standard error, so standard output holds only the JSON and `JSON.parse` reads it.
- **Exit code.** Either way it exits nonzero when the file differs or cannot be replayed. A file that differs is named with its first difference in the verdict line, and one that cannot be replayed on standard error. For an MP4 or WebM film, a frame that the browser does not finish seeking to within 10 seconds counts as a difference, unless an earlier frame, or an earlier scene's soundtrack, already differs, or `--timeout-ms` runs out first, which is a film that cannot be replayed. The frame comparison of that film, or of that scene of a joined film, stops there; an MP4's soundtrack is still compared and dumped. The rule came from a film of blank frames that Edge once stopped seeking part-way. It did not happen again when tried: in installed Edge 157, three MP4 films of one flat colour on every frame (1 s at 12 frames a second, 5 s at 24 and 12 s at 30) each replayed as a match in 2 to 3 seconds. A test holds the named difference against a stand-in that never reports the seek. The verdict line ends with `frame <n> cannot be sought: the browser did not finish seeking the film to it within 10 s`, prefixed by `scene <k> (<piece>) differs:` for a joined film. Replay has not judged the later frames of that film or scene; the other scenes of a joined film are still judged.
- **Soundtrack files.** `--dump <folder>` also writes an MP4 film's soundtrack comparison into that folder, so you can listen to a block the verdict names and measure it. The folder is created if it does not exist. The verdict and the report stay the same; the report adds a `dump` list of the files written. When the film's soundtrack decodes, replay writes three files. When it does not, replay writes only `blocks.json`, with the decoding error in `error` and an empty `blocks` list, and removes any `decoded.wav` and `rendered.wav` an earlier dump left in the folder:
  - `decoded.wav`: the film's soundtrack as the browser decodes it, 16-bit PCM at 48 kHz;
  - `rendered.wav`: the recipe's soundtrack, levelled with the gain and limiter the export applies, in the same format;
  - `blocks.json`: the codec, the soundtrack verdict, the gain, the cut and, for each block of 1024 samples, its start in seconds in `rendered.wav` (`at`) and in `decoded.wav` (`decodedAt`), how far the difference between the two soundtracks lies under the render, in decibels (`db`; higher is closer; `"identical"` means the two soundtracks do not differ in the block, and `"render silent"` means only the film sounds in it) and the energies the verdict judged.

  For a joined film, replay writes one `decoded.wav` holding the whole joined soundtrack, and each scene's other files start with `scene-<n>-`, such as `scene-2-rendered.wav`. A block's `decodedAt` then lies later than its `at` by where the scene's sound starts in the joined film.

  Replay refuses `--dump` before starting Edge, for every scene of a joined film, and names the reason when no folder follows it, when the file is not an MP4 film, when the film or its piece has no soundtrack, or when replay cannot create the folder or write a file into it, such as a path that is a file. If a file cannot be written after the comparison, replay still prints the verdict, then names the folder and the error on standard error and exits nonzero; the report holds that message as `dumpError` instead of `dump`.
- **Decoded frames.** `--save-frames <frames>` also writes an MP4 film's frames as Edge decodes them, so you can look at the exported film at 100%: its grain, fine lines and colour after encoding. `<frames>` is a comma-separated list of frame numbers from 0, or seconds ending in `s`, such as `0,24,2.5s`; a time names the frame that holds it. Each frame is sought at its middle and read 60 ms after the seek, as the frame comparison reads it, and written at the film's full size as `frame-<n>.png` into `<film file name>-frames`, in the folder that receives the report, with `<n>` zero-padded to the width of the film's last frame number: `my-piece.mp4-frames/frame-024.png` beside a 240-frame `my-piece.mp4`. Frames of a joined film are numbered across the whole film. The verdict stays the same; the report adds a `frameFiles` list of the files written. Replay refuses `--save-frames` before starting Edge, and names the reason, when no list follows it, when an item is neither a whole number nor seconds ending in `s`, when a frame lies past the film's last, when the file is not an MP4 film, or when it cannot create the folder.
- **Lag between two films.** `--lag <other.mp4> --at <frame or s>` decodes every frame of both MP4 films, each in a page of its own after the replay, sought at its middle and read 60 ms after the seek, at 480 pixels wide (narrower films at their width), and compares each frame with the one before it, its step: `frameGap`'s share of pixels whose largest channel moved by more than 32 levels, as [`npm run seeds -- --compare`](#comparing-a-render-with-a-reference) measures it, so a codec's noise of a level or two does not count. It then measures how many frames the other film runs behind this one around `--at`: of every lag from -15 to 15 frames, the one whose correlation of this film's steps within 15 frames of `--at` with the other film's steps that many frames later is highest, the smaller lag on a tie. Positive means the other film is later, negative earlier; the line printed names the lag in frames and seconds and its correlation, and the report adds `lag`. `--region x,y,w,h`, in the piece's units, measures the steps over that region only, so a beat is aligned by the element that keys it rather than by everything else moving. Both films must share a frame rate and size. On the fixture's films in installed Edge 156, its beat keyed 5 frames later at seed 2 measured 5 against seed 1 over its region at `--at 60`, and over the whole frame, -5 the other way round, and its control at seed 3, in other colours, 0. Use it to see whether a beat moved between two renders of one piece, such as before and after a change to its timing; it is a check, never a gate. Replay refuses `--lag` without `--at`, `--at` or `--region` without the options they serve, a frame or time past the film, a region outside it, a film to compare that is missing, is no MP4 film or runs on another grid, and `--lag` on a file that is no MP4 film, before starting Edge.

Run `node --test tests/replay.test.js` for:

- manifest reading, and the version, piece, box, outputs, scale, size and frame-grid refusals;
- the `--style` refusal, in a temporary `ARTIFEX_HOME`, naming the style's guide and module;
- the SVG round trip, the WebM seek times, and the PNG and film verdict rules;
- the soundtrack's levelling, gain and limiter, as the export applies it, and its block verdicts;
- a noise fixture's noise-like bands judged by waveform and level, still refusing a moved tone, another noise, a missing voice, a voice in another band and one 6 dB louder or quieter;
- a hi-hat low-passed as a codec cuts it, judged only below the band the film kept; those refusals and a different hi-hat still refused under that cut; and no cut taken under 12 kHz, for a missing voice or for a gentle low-pass;
- each noise-like band under 14 kHz that holds -25 dB of its block, and the rest of a block, held to their own waveform, so a quiet noise voice from another seed and a tone moved under loud noise differ, while a quieter band or one above 14 kHz is judged only with the others;
- a block judged without its mean;
- tones under a noise bed, held to their waveform only where the difference lies under the render's own noise by the codec's margin, and a different soundtrack still refused;
- the sparse-noise rules, for AAC and Opus films alike: a band just under the noise-like flatness between noise-like bands judged as noise, with a tone there moved, dropped or 6 dB quieter still refused; a near band under -25 dB of its block judged only with the other bands; a near band beside an onset still judged on its own, with a tone there moved, dropped or 6 dB quieter still refused beside a click; blocks beside an onset judged together, their levels below 14 kHz within 12 dB, with a contact moved, dropped, re-pitched, reseeded or 3 dB quieter still refused, the last also under a bright transient above 14 kHz; the verdict's figures for near bands and blocks beside an onset; and the allowance passed to the page for both codecs;
- a quiet block beside a block 12 dB or more louder, matching where its difference lies 30 dB (AAC) or 25 dB (Opus) or more under that block, as the codec spreads a grain's coding noise into the quiet block after it; blocks measured from the AAC film of `tests/fixtures/grain-film.cjs`, with a difference 29 dB under, a neighbour 11 dB louder, louder noise or a grain moved 1 ms still refused;
- the Opus films of `tests/fixtures/grain-film.cjs`: blocks measured from them, refused without the sparse-noise rules and matching with them, and a quiet block 28.2 dB under its louder neighbour matching as Opus but not as AAC, with its difference 22 dB under still refused;
- a responsive piece redrawn at the box its file names, or along the box timeline it names, and a box it does not accept refused;
- the rule that a film and its piece agree on a soundtrack in a codec the export writes;
- pictures named before the soundtrack;
- `--dump`: both soundtracks written as 16-bit WAV by the page and read back in pieces, the files and blocks written against a stand-in browser, a soundtrack that does not decode, a write that fails after the comparison, a joined film's one decoded soundtrack and files per scene with each block placed in it, and each refusal, a joined film's before its first page opens;
- `--save-frames`: frames named by number and by seconds, each sought once at its middle, written whole after crossing in pieces from a stand-in browser, a joined film's frames decoded once on its first page, and each refusal before a page opens;
- `--lag`: frames of [`tests/fixtures/activity-film.cjs`](../../tests/fixtures/activity-film.cjs) painted in Node, its beat 5 frames later at seed 2 measured at 5, and -5 the other way round, and its control at seed 3 at 0; synthetic steps and curves; the scan's own pages against a stand-in browser with the verdict unchanged; and each refusal before a page opens;
- a WebM frame whose read throws still closing its `VideoFrame`, and a frame the browser stops seeking at named as a mismatch, not a timeout;
- the output rules: the verdict line naming the first difference and the report's path, `--json` printing the report alone on standard output with the verdict and scene lines on standard error, the report written beside a file outside the library or under `out/` for one inside, and a browser named as a cause only for a file a browser replays.

The Node tests make their own files and do not start a browser; decoding a PNG or a film and comparing its pixels or frames needs `npm run replay` with installed Edge.

To see where a codec cuts, build the page of [`tests/fixtures/noise-film.cjs`](../../tests/fixtures/noise-film.cjs) with `npm run page -- tests/fixtures/noise-film.cjs`, save its MP4 film and replay it with `--piece tests/fixtures/noise-film.cjs`; the report's `sound.cut` is the frequency it judged below. In the same way, [`tests/fixtures/grain-film.cjs`](../../tests/fixtures/grain-film.cjs) replays `core/sound.js` ambience grains, with and without a bed, and [`tests/fixtures/burst-film.cjs`](../../tests/fixtures/burst-film.cjs) sparse noise contacts made by `voice` transients alone, over silence and over a quiet bed.

## Turning an image into a module a piece declares

`npm run image -- <image> --source <text> --rights <text> [--out file.image.js] [--width N] [--channels 1|3|4] [--edge PATH] [--timeout-ms N] [--headed]` decodes an image the user gives and writes it as a module that a piece declares in `images`, so the piece can draw over it, from it or after it. [The piece API](../apis/piece-api.md#images) describes the declaration and the functions that read it.

- **Source and rights.** Both options are required. `--source` says where the image came from, such as "the user's own photo" or a URL. `--rights` says whose the image is and on what terms, in the user's words. The library grants no rights of its own. Each is at most 200 characters.
- **Decoding.** A plain PNG is decoded in Node. Installed Edge decodes every other image, such as a JPEG, WebP or GIF file, and also a PNG that is interlaced or carries a colour profile or gamma without an sRGB chunk. Edge converts the image to sRGB first. `--edge`, `--timeout-ms` and `--headed` work as for the other Edge tools.
- **Size.** `--width N` shrinks the image to `N` pixels wide and keeps its proportions. Each new pixel is the average of the area it covers, so the same file always gives the same bytes. The tool refuses a width larger than the image. A module over 16,777,216 pixels is refused; give a smaller `--width`. A file over 50,000,000 pixels is refused before it can be shrunk, so scale it down with another tool first.
- **Channels.** By default, the module keeps 3 channels (RGB), or 4 (RGBA) when the image has transparent pixels. `--channels 1` keeps only the tone, a third of the size, for a piece that reads tones alone. The tool refuses 1 or 3 channels for an image with transparent pixels, because those channels would drop the transparency.
- **Output.** The module goes to `--out`, which must end in `.image.js`, or by default beside the image as `<image name>.image.js`, such as `photo.image.js` next to `photo.jpg`. Its header comment names the image, its source, its rights, its size and its digest. The tool prints one line with the module's path, size, channels, length in kilobytes and digest, then the line to paste into the piece.
- **Paths.** Relative paths resolve from the folder you ran `npm run image` in.

For example, `npm run image -- ./photo.jpg --source "the user's own photo" --rights "the user's; private use" --width 384 --channels 1` writes `photo.image.js` beside `photo.jpg`, 384 pixels wide and in grey tones. The piece then declares `images: { photo: require('./photo.image.js') }`.

The module holds the decoded pixels as text, so it is larger than a compressed file: a 384 x 216 grey image is about 110 kB, and the same image in RGB about three times that. The module and the image stay in the user's project. Keep the image only as large as the piece needs.

Run `node --test tests/cli.test.js` for the tool's refusals, a PNG written as a module, shrunk by area average, with its source and rights in the header, and its `--help`. It does not start Edge; decoding a JPEG needs installed Edge.

## Measuring a reference image

`npm run measure -- <reference.png> [--colors N] [--tolerance px] [--min-area px] [--out file.json]` measures a PNG reference: its size in pixels, its dominant colours with the share of pixels each covers, and the outline of each colour region as a short list of points. Use it when a piece must match a reference: build the piece's own shapes from the measured sizes, colours and points instead of judging them by eye. The command writes no picture and no path a piece could paste; [reference measurements](../apis/reference-measurements.md) defines every field of its JSON report.

- **Formats.** It reads PNG files of every colour type and bit depth, without interlacing. A JPEG, WebP or GIF file is refused by name; save the reference as PNG first. An image over 50,000,000 pixels is refused; scale it down first.
- **Options.** `--colors` is the most colours to report, a whole number from 1 to 32, 8 by default. `--tolerance` is how far, in pixels, a simplified outline may stray from the pixel edges, 1 by default; 0 keeps every corner. `--min-area` leaves out outlines that enclose fewer square pixels, 4 by default, and each colour's `dropped` counts them.
- **Output.** Without `--out`, the command prints the report as one line of JSON on standard output. With `--out file.json`, it writes the report to that file, creating its folder, and prints one line such as `measure: out/ref.json: 40 x 30, 3 colours, 7 outlines`.
- **Paths.** Relative paths resolve from the folder you ran `npm run measure` in, including with `npm --prefix <library> run measure`.
- **Holes.** [Holes](#holes) says which outline to fit and how to paint a region with one.

For example, `npm run measure -- C:/refs/poster.png --colors 4 --out out/poster.json` writes the four dominant colours of `poster.png` and their outlines to `out/poster.json`.

Run `node --test tests/measure-reference.test.js` for decoding every colour type, bit depth and row filter, the file refusals, the colours and shares of flat shapes, anti-aliased edges and a smooth gradient, transparent pixels, outline areas, bounds and holes (a ring filled even-odd as [replica mode](../../skills/artifex/SKILL.md#replica-mode) paints it reports its hole over transparent pixels), simplification within the tolerance, `--min-area` (regions under it, and a ring whose outer outline encloses less than it with all its holes, are skipped before tracing, and the loops `outlines` reports as `traced` equal the outlines kept), the report's fields, each argument refusal, and what the command prints and writes. `node --test tests/cli.test.js` checks its `--help` and `-h`.

### Holes

An outline with `hole: true` runs around a part of its colour's region that has another colour or is transparent, such as the ground's outline around a shape drawn on it. It is the edge of what lies inside, never a shape to fill. When a shape sits on a ground, fit the shape's own outer outline (`hole: false` under the shape's colour), not the ground's hole around it. On an anti-aliased edge, when the edge blends become colours of their own (as in a small image), the hole also encloses them and lies about 1 pixel outside the shape's outline; when they join the two colours (as in a large image), the two coincide. Fit the hole only when the shape's colour has no outline of its own, for example when its outline was dropped. A hole that holds only transparent pixels has no colour of its own in the report, so no region draws it: leave its inside unpainted and cut the hole out of the region's fill. [Replica mode](../../skills/artifex/SKILL.md#replica-mode) says how to paint a region with holes.

## Comparing a render with a reference

`npm run seeds -- --compare <render.png> <reference.png> [--threshold n] [--json]` compares a render with a reference of the same size, pixel by pixel at the same place. Use it when a piece must match a reference: it gives numbers a fidelity loop can fail on, and a grid that shows where to look next. The [style gap](#style-gap) compares colour and texture statistics only, so a shape drawn 20 px from its place with the same colours scores almost no style gap; here it does. [Replica mode](../../skills/artifex/SKILL.md#replica-mode) puts this score into a fitting loop.

The command runs in Node, without Edge. Both files must have a `.png` name; any other name is refused before the file is read. It reads them as [`npm run measure`](#measuring-a-reference-image) does, so a file with a `.png` name in another format is refused as `npm run measure` refuses it. Relative paths resolve from the directory you ran npm in. To make the render, save a still at the reference's size with [`npm run still`](#saving-a-still), choosing `--scale` so the PNG has the reference's width and height.

| Output | What it measures |
| --- | --- |
| `mean` | The mean difference of the red, green and blue channels over the whole frame, from 0 (the same pixels) to 255. |
| `off` | The share of pixels whose largest channel difference is over the threshold, 32 by default. `--threshold` sets another, from 0 to under 255, written as a plain decimal such as `24` or `8.5` (`0x20` and `1e1` are refused). |
| `grid` | That share in each region of an 8 x 8 grid over the frame (fewer columns or rows in a frame under 8 pixels wide or high), as `cols`, `rows` and `off`, rows from the top. |
| `worst` | The region with the largest share: its `col` and `row` from 0, its pixel bounds `x`, `y`, `width` and `height`, and its `off`. It is the first in reading order on a tie, and null when no pixel is off. |

Each pixel is laid over white before it is compared, so a transparent pixel matches white. `mean` and the shares are rounded to 4 decimals. Without `--json`, the command prints the numbers, the grid as percentages and the worst region, with columns and rows counted from 1. For a blue disc drawn 20 px right of its place in a 160 x 80 frame:

```text
render.png against reference.png, 160 x 80 px: mean channel difference 13.08 of 255; 8.5% of pixels off by more than 32
share off by region, 8 x 8, top row first:
   0.0%   0.0%   0.0%   0.0%   0.0%   0.0%   0.0%   0.0%
   ...
   0.0%   0.0%  66.5%  62.0%  71.5%   0.0%   0.0%   0.0%
   ...
most off: column 5 of 8, row 5 of 8, pixels 80 to 99 across and 40 to 49 down: 71.5% off
```

With `--json`, it prints the same fields as one line of JSON. The command reports and never fails on the numbers; a fidelity loop sets its own limit, such as `off` under 0.02.

Two files of different sizes are refused, such as `seeds: the render is 640 x 360 px and the reference 1280 x 720 px; the comparison is pixel by pixel at the same place and rescales nothing, ...`. Nothing is rescaled: draw the render at the reference's size, or crop the reference to the render's. From Node, `frameGap(reference, render, threshold)` in `tools/contact-sheet.js` takes two RGBA images `{ data, width, height }` and returns the same fields.

Run `node --test tests/contact-sheet.test.js` for the shifted shape, the threshold, transparent pixels, uneven regions, the size refusal and what the command prints. Run `node --test tests/cli.test.js` for the argument refusals.

## Planning a film's views

`npm run seeds -- <piece> --plan [--seed n] [--json]` draws a film's view on every frame over the whole place, seen from above, so you can check its camera moves against its beats in one picture. Use it after you set a film's camera keys and beats, before you look at its frames. [Camera and framing](../../skills/artifex/reference/films.md#camera-and-framing) says what to check on it.

The command runs in Node, without Edge. It builds the piece at its own seed, or at `--seed n`, and writes `<piece>-plan.html` (`<piece>-plan-seed<n>.html` with `--seed`) in the folder [where output goes](#where-output-goes) names. The page has no script. It shows:

- the design box, and each shot's first view as a dashed box;
- a dot at the centre of the view on every frame, joined by a line that breaks at each cut of the framing, and a red cross at each such cut; a cut between shots shows as its shot's dashed box and leaves the line whole;
- a ring on each beat with its view boxed, numbered in order, the most intense beat in amber;
- when the piece keeps blocking rows, a square at each subject mark, labelled with the mark's name and its shot, and a blue line between each shot's two line ends, drawn red where a shot puts the line on the wrong side. The design box grows to take in every mark, so none falls off the page.

Along a pan, dots spaced wide are fast travel and dots bunched together are an ease or a rest. A zoom keeps its dots on one centre, so read its ease from the listed speeds, not from the dot spacing.

The command prints the page's path and size, then a line for each beat and each move. For a short move followed by a long one, with one beat midway through the short move and one on the key between them:

```text
beat 1 at 1.50 s (a: mid slow move): 0.13 frame widths/s, 100% of the peak of move 1
beat 2 at 2.00 s (a: on middle key): 0.00 frame widths/s, 0% of the peak of move 2
move 1: frames 24 to 48 (1.00 to 2.00 s), peak 0.13 frame widths/s
move 2: frames 48 to 72 (2.00 to 3.00 s), peak 1.94 frame widths/s
```

- A view's **speed** is how far its farthest-moving corner travels in a second, in widths of the view on that frame, so a pan and a zoom count alike. A beat's speed is the step into its frame or the step out of it, whichever is the larger share of its move's peak.
- A **move** is a run of frames in which the view travels. A move ends on each camera key, so a move that arrives at a key and one that leaves it are listed apart, and so are the two halves of an out-and-back. The frame of that key ends one move and starts the next. A frame marked `cut: true` ends a move too, and its jump counts in no move's peak. A cut between shots that leaves the camera path alone is not marked, so the move runs on across it.
- A beat outside every move reads `at rest`. A beat inside a move gives its speed as a share of that move's fastest frame. A beat on a key between two moves is measured on both sides: the step into it against the move that ends there, the step out against the move that starts there. It names the side with the larger share.

With `--json`, the page path and lines go to standard error, and standard output gets the plan as one line of JSON without its views: `frames`, `hz`, `size`, `box`, `shots`, `moves`, `beats`, `peak`, `blocking` and `blockingLeftOut`. Each `blocking` entry is `{ shot, frame, line, marks, left, cross, wrong, after, was }`: `frame` is the shot's first frame, `left` the line end on the left of the screen in that frame's view (`null` when the two ends are almost head-on), and `wrong` is `true` when an earlier shot of the same two ends put the other end on the left, with `after` that shot and `was` the end that was on the left. `blockingLeftOut` is `null` unless the rows were left out, then the text that names the first bad row.

### What the piece must keep

The [film scaffold](../../skills/artifex/film-scaffold.cjs) keeps all of this. A piece built another way keeps it in its built state:

| Field | What it holds |
| --- | --- |
| `state.cues.views` | One `{ x, y, zoom }` for each frame, in frame order: the design point at the centre of the frame and the zoom, all finite numbers, with the zoom above 0. Add `dolly` (a push-in or pull-back, a finite number above 0, 1 when missing) and the plan follows the subject's plane, which scales by `zoom * dolly`, so a dolly alone counts as a move and sizes the boxes. Add `cut: true` only on a frame where the framing cuts, the view jumping from one frame to the next, and `key: true` on each camera key's frame. A cut between shots is read from `state.cues.shots`: marking it `cut: true` as well ends the camera move there. The film scaffold marks both this way. |
| `state.cues.beats` | Optional. Each beat as `{ frame, intensity, element, changes }`, in frame order, with a whole frame from 0 to the film's frame count and a finite intensity. If any beat breaks this, the plan lists no beats. |
| `state.cues.shots` | Optional. Each shot as `{ name, start, end }`, its first frame and the frame after its last, for the dashed boxes and the cut labels. |
| `state.cues.blocking` | Optional. One row per shot as `{ shot, marks, line, cross }`: `shot` names a shot of the film (its `state.cues.shots`), in one row only; `marks` maps each subject's name to a design point, `{ a: [420, 520], b: [860, 500] }`, with finite numbers; `line` is the two different mark names whose line of attention the shots keep, `['a', 'b']`; `cross: true` names a deliberate crossing of that line. The plan draws the marks and the line, and flags a shot that puts the line's ends the other way round from an earlier shot unless it names the crossing. If any row breaks this, the plan uses none of them and prints `state.cues.blocking left out (row <n> of <count>)`, with `<n>` counted from 1, followed by what a row needs. A shot named by two rows breaks it too: the first row for that shot fits, the second is the one named. |

When no frame carries `key: true`, a move ends instead on each frame where the view slows to its slowest and then speeds up again. A stretch of equal steps counts as one slowest point, so a move that slows into a steady drift stays one move. That frame can sit one frame off the key the piece meant; mark the keys to place the split exactly.

The command refuses, and names the cause:

- a still: `--plan draws a film's view across its frames, and <piece> is a still`;
- a film with no `state.cues.views`, or with a different number of views than frames;
- a view that is not finite numbers with a zoom above 0, named by its index, such as `state.cues.views entry [3] is not { x, y, zoom } with finite numbers and a zoom above 0`;
- a `dolly` that is not a finite number above 0, named by its index and value, such as `state.cues.views entry [2] takes a dolly that is a finite number above 0 or no dolly, got dolly: 0`;
- a `cut` or `key` that is not `true`, named by its index and value, such as `state.cues.views entry [4] takes cut: true or no cut, got cut: false`;
- a `state.cues.shots` list that names two shots alike, named by its index and name, such as `state.cues.shots entry [1] is a second shot named read in readout`;
- more than one piece, no piece, or any option other than `--seed` and `--json`.

From Node, `viewPlan(piece, seed)` in `tools/contact-sheet.js` returns the plan, `planText(plan)` its lines and `planPage(plan)` the page. Run `node --test tests/contact-sheet.test.js` for the moves, the beat shares, the scaffold's keys and the refusals, and `node --test tests/sound.test.js` for the views the scaffold keeps.

## Cut pairs

`npm run seeds -- <piece> --shots --cuts [--png] [--json]` adds to a [shot strip](#time-strips) what you need to compose across each cut. [Continuity](../../skills/artifex/reference/films.md#continuity) says what to check on it. It writes `<piece>-shots-cuts.html`, so it never replaces the plain shot strip, and draws in installed Edge with `--png` or `--json`.

Under each shot's first frame, from the second shot on, the strip draws a **cut pair**: the last frame of the shot before, with this first frame over it at 50%. On the pair:

- a red ring around the incoming focus, its radius 1/16 of the frame's width (80 design units in a 1280-wide film);
- a red dot on the outgoing focus, and a line from it to the ring's centre;
- a square on the outgoing frame's strongest edge inside the ring, amber when it is strong.

The **edge** is the step of luma, 0 to 255, between neighbouring blocks 1/80 of the cell wide, as the strip's detail measures it. Blocks within the same radius of the outgoing focus do not count, so the shape that carries the eye across the cut is not flagged. A large outgoing focus shape can still reach the ring and be flagged. A step of 32 or more is a **stray** edge: the caption says `stray: an outgoing edge of <step> lies on the incoming focus`.

The **mass** of a frame is the share of its contrast with its ground, the median block, that lies left of centre: 1 is all on the left, 0 all on the right. A cut is **flipped** when one frame's share is 0.55 or more and the other's 0.45 or less.

After the strip, one figure draws every shot's **eye track** and every cut's **jump** on one frame. A track runs from a dot on the shot's first frame through the point between its in and out on each frame. A jump is a dashed line from the outgoing point to the incoming one, labelled with its length in frame widths. It is amber over a third of the frame's width unless the incoming shot is a jolt. A carried cut draws no jump. The tracks are the focus points the piece writes, carried through its views, not subjects tracked in the pixels.

Every measure reports and never fails. On a scratch film drawn in Edge, a dark mass's edge that lay 60 design units from the next focus measured 191, and a cut whose ring held only flat mass measured 0.

### What the piece keeps for cut pairs

`--cuts` reads the shot list from `state.cues.shots`, as `--shots` does, and the focus from `state.cues.focus`: one row per shot, `{ shot, in: [x, y], out: [x, y], jolt?, carry? }` in design units, the shape of the [film scaffold](../../skills/artifex/film-scaffold.cjs)'s `FOCUS` rows. A row with `carry: 'in'` leaves out its `in`, and a row with `carry: 'out'` leaves out its `out`; every other row needs both points, and `--cuts` refuses a row that lacks one, as the scaffold does. The eye track of a carry row that leaves out the point it drops holds on the one point it keeps; a carry row that gives both points runs its track from `in` to `out`. The scaffold publishes its `FOCUS` rows there itself, in that shape, and leaves out the `focus` key when `FOCUS` is empty; a scaffold film adds nothing to its `s.cues`.

The points are carried on screen through `state.cues.views` at depth 1, as the scaffold's `FOCUS` check carries them: the plane scales by `zoom * dolly` (1 for a view with no `dolly`), the out point on the frame before the cut, the in point on the cut's first frame. When the piece keeps focus rows and one view per frame, a `dolly` that is not a finite number above 0 is refused by its view's index, as `--plan` refuses it, even when another view is invalid; a piece with no focus rows, or with a different number of views than frames, never reads the views. Without one valid view per frame, the design box is used. A cut out of a `carry: 'out'` row or into a `carry: 'in'` row has no jump and no stray square, as the scaffold leaves it unchecked. A piece with no `state.cues.focus` still gets the pairs and their mass, with no ring, square or tracks.

### Cut-pair JSON and refusals

With `--json`, the sheet's `cuts` lists one entry per cut: `cut`, `from`, `to`, `frame`, `out` and `in` (on screen, in design units, or null), `jump` (frame widths, or null), `jolt`, `carried`, `stray` (`{ step, x, y }` in design units, or null), `strong`, `mass` (`{ out, in }`) and `flipped`. Each cut's blend and measures are found by its `frame`, the incoming shot's first frame. A cut whose cells failed keeps null measures.

The command refuses, and names the cause:

- `--cuts` without `--shots`: `--cuts blends the frames either side of each cut on a shot strip; add --shots`;
- a film of one shot: `--cuts blends the frames either side of each cut, and <piece> has one shot`;
- a `state.cues.focus` that is not a list: `--cuts: state.cues.focus is not a list of { shot, in, out } rows`;
- a row, named by its index: `--cuts: state.cues.focus entry [1] names no shot of <piece>`, `entry [1] is a second row for shot a`, or `entry [1] has neither an in nor an out [x, y]`.

From Node, `cutPlan(piece, shots)` in `tools/contact-sheet.js` returns the cuts and tracks, and `cutOverlay(layout)` the figure. Run `node --test tests/contact-sheet.test.js` for them, the pairs and the refusals.
