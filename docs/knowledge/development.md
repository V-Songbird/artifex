---
type: knowledge
summary: "Describes Artifex's source layout, development commands, plugin metadata, and the limits of its checks."
related_files: ["package.json", ".nvmrc", "core/piece.js", "core/webgpu-preview.js", "examples/pixel-field.js", "tests/webgpu-preview.test.js", "tests/page-preview.test.js", "tests/pixel-field.test.js", "core/field.js", "core/time.js", "core/stroke-font.js", "examples/stroke-font.js", "tests/field.test.js", "tests/time.test.js", "tests/negative.js", "tests/negative-runner.test.js", "tests/contact-sheet.test.js", "tests/external-piece.test.js", "tests/page-build-errors.test.js", "tests/check-browser.test.js", "tools/piece-input.js", "tools/check-browser.js", "tools/contact-sheet.js", "tools/lint-unread.js", "tools/build-page.js", "plugin.json", ".claude-plugin/plugin.json", ".codex-plugin/plugin.json", "skills/artifex/SKILL.md", ".github/workflows/check.yml"]
---

# Developing Artifex

Artifex has no dependency installation or source compilation step. Use the Node version in [`.nvmrc`](../../.nvmrc); the minimum supported runtime is declared in [`package.json`](../../package.json). Run commands from the repository root.

## Commands

| Command | Purpose and result |
| --- | --- |
| `npm run check` | Runs lint and the Node test suite. |
| `npm test` | Runs `tests/*.test.js`. |
| `npm run lint` | Checks unread declarations and contract keys. |
| `npm run negative` | Mutates isolated copies and checks which named test rejects each mutation. |
| `npm run page` | Builds the self-contained `out/index.html`. |
| `npm run browser` | Checks the built page in installed Edge using native CDP, including an MP4 film export and decode for every example that declares sound; run `npm run page` first. |
| `npm run examples` | Writes registered vector examples as SVG files under `out/`. |
| `npm run seeds -- drift 16 0.5` | Writes a contact sheet for a registered example. |
| `npm run seeds -- drift 5 0.5 --param reach` | Writes a five-value parameter strip at the piece's fixed seed. |
| `npm run seeds -- drift 3 0.5 --param reach,turn` | Writes a 3-by-3 parameter grid at the piece's fixed seed. |
| `npm run bench` | Measures build, draw, and vector emission costs. |

Run `npm run check` after source changes. Run the mutation suite when changing a check, contract key, or invariant; it executes a full test run for each mutation and takes longer than the unit suite.

The benchmark uses a null surface to measure drawing calls without SVG emission. For vector pieces, the displayed emission cost excludes that draw time. The total is build plus full vector rendering; for raster-only pieces it is build plus null-surface drawing. It does not measure browser canvas or video encoding performance. Inspect [`tools/bench.js`](../../tools/bench.js) before choosing benchmark flags or comparing its baseline.

`npm run bench` writes or replaces `out/bench.json`. `BENCH_REPS` controls its sample count and defaults to 40. Preserve a baseline elsewhere before running a comparison you need to retain.

For a focused contract check, run `node --test tests/piece.test.js`. Generated pages, artwork, contact sheets, and benchmark results go under `out/`.

## External pieces

`npm run page -- ./piece.cjs` and `npm run seeds -- ./piece.cjs 9 0.5` accept a CommonJS module exporting one piece. From another project, use `npm --prefix "/path/to/artifex" run page -- "./piece.cjs"` or the equivalent `run seeds --` command, replacing the library path. These npm commands resolve relative input paths against npm's original invocation directory (`INIT_CWD`); direct Node commands use their current directory. Quote paths containing spaces.

External outputs are written beside the resolved source module: `piece-page.html`, `piece-seeds.html`, or `piece-param-width-height.html` for `--param width,height`. Output stems come from the source filename, replacing filesystem-reserved characters. Parameter-name suffixes are URL-encoded, including `*` as `%2A`, so names cannot introduce Windows wildcard characters or path separators. Existing files with the same generated name are replaced. The registered-example defaults still write under the library's `out/`; `examples` and `bench` still operate only on the example registry.

The loader supports a restricted CommonJS subset: direct literal `require('...')` or `require("...")` calls, including relative helpers, absolute library imports and JSON data. Helpers must be browser-compatible `.js` or `.cjs` modules. It is not a general CommonJS bundler. Node builtins, native modules, ESM syntax, require aliases and computed require paths are rejected. Shadowed/local functions named `require` and require calls inside template interpolation are unsupported; keep imports as ordinary calls outside templates.

Inline script-end text in ordinary quoted strings is escaped without changing its value. Any template literal containing literal `</script` text is rejected, whether tagged or untagged; use ordinary quoted strings or JSON for that data. This conservative rule avoids changing raw template strings while trying to infer their tag. Templates without that marker remain supported. Emitted scripts are parsed before writing, and malformed JSON errors identify the data file and retain the original parse cause. The generated HTML includes its module sources and needs no filesystem access when opened. Piece loading uses Node `require()` and executes trusted local code; this is not sandboxing.

In PowerShell, use `npm.cmd` when forwarding options such as `--param`; a PowerShell npm shim may consume the `--` separator before npm sees it. For example: `npm.cmd --prefix "/path/to/artifex" run seeds -- "./piece.cjs" 3 0.5 --param width`.

Parameter strips and grids use the same `--param` option and fixed-seed rules for external pieces. Run `node --test tests/external-piece.test.js tests/contact-sheet.test.js` for module loading, nested dependencies, invocation paths, filenames, error cases and sweep contracts. Inspect the generated page and sheet in a browser to verify native rendering.

## Contact-sheet sweeps and metrics

`npm run seeds -- <piece> [count] [playhead] --param <a>[,<b>]` samples one or two declared parameter ranges evenly, including their exact minimum and maximum. It requires one registered example and distinct, declared parameter names. `count` is samples per axis (default 3, minimum 2), so a two-parameter sweep has `count * count` cells. The first parameter runs across columns; the second runs down rows. The sheet preserves those axes with keyboard-accessible horizontal scrolling on narrow screens. Other parameters retain their declared defaults, and every cell uses the piece's declared seed.

Without `--param`, the existing behavior remains: `count` defaults to 9 and cells use seeds 1 through `count`. The playhead defaults to 1 in either mode. Parameter output names include the selected parameters, such as `out/drift-param-reach-turn.html`; seed output remains `out/drift-seeds.html` (or `out/seeds.html` for all examples).

Each cell labels the varied values and reports three diagnostics:

- **Marks:** successful canvas paint calls (`fill`, `stroke`, `fillRect`, `strokeRect`, `drawImage`, `fillText`, `strokeText`, `putImageData`). A call can paint no visible pixels; this is not an object count. Background paint calls count.
- **Bbox coverage:** the area of the bounding rectangle around final nontransparent pixels, divided by raster canvas area. It includes background pixels: a fully painted background gives 100%. It is not ink density, foreground segmentation, or a quality score. Bounds are sampled at the preview's raster resolution, 480 pixels wide.
- **Build ms:** elapsed time around `solve`, including state creation and the build stages, excluding drawing and pixel measurement. Timing varies between runs.

`window.__sheet` retains `names`, `count`, `t`, and `failures()`, and adds `paramNames` and `cells`. Successful cell records carry `name`, `seed`, resolved `params`, quantized `t`, `buildMs`, `markCount`, `bbox` in raster pixels (null when empty), `coverage` in [0, 1], `rasterSize`, and `error: null`. Failed cells retain their inputs and an error message; later cells still render. These data let an agent filter candidates before visual review, without treating the metrics as artistic judgment.

Run `node --test tests/contact-sheet.test.js` for argument, sampling, determinism, metric, and bundle-parsing checks. Actual raster output and native canvas behavior require browser verification.

## Source entry points

| Path | Responsibility |
| --- | --- |
| [`core/piece.js`](../../core/piece.js) | `FIELDS`, validation, build stages, frame grid, and replay metadata. |
| [`core/render.js`](../../core/render.js) | Drawing a frame, rendering SVG, rendering a soundtrack, and enumerating playheads. |
| [`core/film.js`](../../core/film.js) | Frame-exact MP4 export through injected WebCodecs encoders; MP4 writing, reading and the file check. |
| [`core/webgpu-preview.js`](../../core/webgpu-preview.js) | Optional bounded opaque-pixel GPU preview; explicit ABI, async lifetime and capability fallback. |
| [`core/surface-vector.js`](../../core/surface-vector.js) | Canvas2D-shaped vector surface and SVG serialization. |
| [`core/rand.js`](../../core/rand.js) | Addressed randomness and noise fields. |
| [`core/field.js`](../../core/field.js) | Grid sampling, derivatives and composition, isolines and streamlines; see the [field API](../apis/fields.md). |
| [`core/time.js`](../../core/time.js) | Spans, named rate curves, tweens and shot lists cut on whole frames; see [authored time](../apis/piece-api.md#authored-time). |
| [`core/stroke-font.js`](../../core/stroke-font.js) | Shared polyline stroke font; [`examples/stroke-font.js`](../../examples/stroke-font.js) remains a compatibility entry point. |
| [`core/geom.js`](../../core/geom.js), [`core/path.js`](../../core/path.js) | Geometry and path operations. |
| [`core/num.js`](../../core/num.js), [`core/colour.js`](../../core/colour.js) | Numeric and colour operations. |
| [`examples/index.js`](../../examples/index.js) | Examples available to the bundled tools. |
| [`tools/build-page.js`](../../tools/build-page.js) | Browser bundle, transport, inspection interface, and exports. |
| [`tools/piece-input.js`](../../tools/piece-input.js) | External CommonJS piece loading, caller-directory resolution and dependency bundling. |
| [`tools/check-browser.js`](../../tools/check-browser.js) | Installed Edge smoke checks and the owned browser/server lifecycle. |
| [`tests`](../../tests) | Contract, geometry, rendering, examples, and mutation coverage. |

Core helpers must remain useful across subjects. Keep algorithms specific to an example with that example. When the public contract changes, reconcile the [piece API](../apis/piece-api.md) and [runtime skill](../../skills/artifex/SKILL.md) with `FIELDS`.

`examples/pixel-field.js` is the authored CPU/WGSL reference for optional pixel
previews. Run `node --test tests/piece.test.js tests/webgpu-preview.test.js tests/page-preview.test.js tests/pixel-field.test.js`
for its contract, lifecycle, recipe freshness and CPU pixel checks. GPU tests in
Node use controlled devices; actual shader output, native device loss, canvas
copies and CPU/GPU timing require installed Edge with usable WebGPU. Ordinary
`npm run browser` keeps the CPU path and does not establish GPU availability.
The backend's reported allocation proxy is not measured GPU memory.

The example Recorder hashes real ImageData bytes. Generic seed, parameter and
timeline checks render opted-in pixel examples at up to 64 pixels wide; the scale
invariant compares that diagnostic size with eight times the size. Dedicated
pixel tests cover raster values and scale behavior. The benchmark null surface
allocates real pixel buffers and runs CPU computation while discarding upload;
it cannot measure browser presentation or GPU speedup.

The [geometry API](../apis/geometry.md) defines segment intersection and closest-point results, bounded open-polyline offsets, and their numerical limits. `pattern` consumes offsets and intersections; `packing` uses segment distance to keep interior dots clear of its outlines. Run `node --test tests/geom.test.js tests/geometry-consumers.test.js` for those contracts and consumers.

[Authored time](../apis/piece-api.md#authored-time) defines spans, rate curves, tweens and shot lists cut on whole frames. `drift` times its strokes with `span`; `readout` cuts a reading and a rest and schedules its notes from the same shots. Run `node --test tests/time.test.js` for those contracts; `tests/examples.test.js` checks that readout's notes and pictures agree on every frame.

The page builder discovers JavaScript modules in `core/` and `examples/`, then bundles them with a CommonJS loader. Its module-resolution and script-parsing checks catch structural build failures. Template-string content needs correct escaping before it becomes browser JavaScript.

Address-bar synchronization is best effort: documents that reject `history.replaceState` still support selection, playback and exports, but cannot update shareable recipe URLs.

When building a selected piece fails, the page preserves the original build diagnostic and clears its canvas and measurements. Playback and exports are disabled until a valid rebuild or selection succeeds; `read().error` retains the diagnostic and `manifest()` returns `null`. Direct video requests reject with that diagnostic instead of exporting partial state. Run `node --test tests/page-build-errors.test.js` for this error/recovery contract.

MP4 export runs through [`core/film.js`](../../core/film.js) with the browser encoders passed in, so `node --test tests/film.test.js` checks the writer, the reader, the file check, timestamps, colour tagging, soundtrack length and the replay manifest against controlled encoders. Native encoding, decoding and playback need `npm run browser` or a browser. Frame timing read in a browser measures rasterization only when the work is forced first, for example by a one-pixel `getImageData`; a clock read after the drawing calls return measures their submission.

## What verification establishes

The Node suite checks selected contract, geometry, replay, frame-grid, SVG, and example properties. Its browser-facing tests use controlled surfaces and script inspection. They do not launch a browser or establish visual quality.

`npm run browser` requires Node 22 or later and an installed Microsoft Edge. It uses native `fetch` and `WebSocket`, with no package dependency or browser download. It serves the built HTML snapshot on an OS-assigned loopback port and launches Edge with a unique temporary profile. Existing browser sessions and profiles are left alone. `--edge PATH` or `EDGE_PATH` selects another Edge installation; `--timeout-ms 60000` sets the startup/navigation/evaluation deadline (100–300000 ms), and `--headed` shows the browser. Pass options after `npm run browser --`. Cleanup has a separate bounded grace period and failures exit nonzero with diagnostics.

The browser command selects every registered example, checks `read()`, each declared stage through `inspect()`, and `manifest()`, confirms the HTTP recipe URL, and draws into a separate native canvas with `willReadFrequently: true`. It reports nontransparent pixel counts, including backgrounds. It then exports a film through `__artifex.film()` for every example that declares sound, or for the first with a timeline when none does. For each film it requires the page to offer that example's MP4 film and hide the WebM fallback, decodes the film in the page, requires the first, middle and last decoded frames to resemble their own drawn frames at least as closely as their neighbours (a held frame ties with an identical neighbour), requires a declared soundtrack to decode to sound as long as the film, and requires the replay manifest found in the film's bytes to equal the page's recipe. Page exceptions, console errors, failed checks and timeouts fail the command. This smoke check does not verify composition, cross-browser or physical-device behavior, the WebM fallback or its timing, or how a film plays on another device. The ordinary Node suite and current CI do not require Edge.

For browser or export changes, inspect actual rendered output and saved files. Check exported video frame counts and spacing from the encoded file. Automated numerical checks do not establish composition, layering, or usability.

The mutation suite copies `core/`, `examples/`, `tests/`, `tools/`, and `package.json` into temporary directories. Its control requires exit 0 and a complete, nonempty Node TAP report. A mutation is caught only when a completed exit-1 test run reports its named assertion; a completed passing run is escaped, and a different failed assertion is misnamed. Launch errors, signals, unexpected exit codes, and incomplete or inconsistent TAP are infrastructure failures, including when some failures were printed before the process stopped. The runner keeps process metadata and both output streams, reports infrastructure failures separately, and exits unsuccessfully. A control with failing tests prints each failed title with its TAP diagnostic: the assertion message, expected and actual values, and location. Misnamed and infrastructure lines print the same diagnostics for the failures they did see. Run `node --test tests/negative-runner.test.js` for bounded process and report regression checks.

Every infrastructure result, for the control or a mutation, is kept under the run's temporary root in `infrastructure/control` or `infrastructure/m<index>`: `stdout.tap` holds the captured TAP stream, `stderr.txt` the standard error, and `result.json` the exit status, signal, error, failure reason, deadline and PID. The report line names that directory. Cleanup removes every source copy and removes the temporary root only when nothing was kept; the summary then names the kept `infrastructure` directory.

A mutation's infrastructure result runs its suite once more, for the report only. The line shows the second verdict as `retry, report only: <verdict>`, and a second infrastructure result is kept in `m<index>-retry`. The mutation still counts as an infrastructure failure whatever the retry shows, because a pass under the same load cannot prove the first run harmless and letting it change the verdict would hide load failures. The retry still tells a load-sensitive failure (retry caught) from one the mutation itself causes (retry infrastructure again). A control infrastructure result is kept but not retried: the run stops with exit code 2 either way.

Expected mutation titles must be unique among all TAP results and exclude control characters and literal control escapes such as `\n`. Node 22 can encode distinct original titles identically. The runner reports ambiguous attribution as an infrastructure failure rather than claiming that the intended assertion failed.

Each test-suite subprocess has a five-minute deadline. Set `ARTIFEX_NEGATIVE_TIMEOUT_MS` to an integer from 1 to 2147483647 to override it; zero does not disable the limit. On timeout the runner reports infrastructure failure, terminates only its owned Windows process tree or POSIX process group, and allows up to thirty additional seconds for teardown, because CPU load can delay `taskkill` itself by seconds. On Windows, `taskkill` also fails for a tree member that exited by itself during termination; the runner then accepts the teardown only when every process `taskkill` named has exited within five seconds. Failed termination remains an infrastructure error. Combined stdout and stderr are capped at 1 MiB. Mutation subprocesses run sequentially. The runner always attempts cleanup of its own temporary copy before reporting its exit code. A stopped Windows process can hold that copy briefly after the runner sees it close, so cleanup retries busy or locked removals for up to ten seconds.

## Continuous integration

The [Check workflow](../../.github/workflows/check.yml) uses the Node version in `.nvmrc` on Linux and Windows. It rejects tracked ignored files, runs `npm run check`, builds the standalone page and runs `npm run negative`. Each matrix job has a 120-minute cap; each mutation-suite subprocess also retains the finite runner deadline described above.

Submit changes through a pull request targeting `main`. The branch rules require the Linux and Windows checks, resolved review conversations, and a linear history. Deletion and force pushes are blocked.

See the [security policy](../security.md) for private vulnerability reporting and the boundaries of executing piece code.

## Plugin metadata

[`plugin.json`](../../plugin.json), [`.claude-plugin/plugin.json`](../../.claude-plugin/plugin.json), and [`.codex-plugin/plugin.json`](../../.codex-plugin/plugin.json) describe the plugin. The two host-specific manifests are identical; the root manifest adds `$schema`.

The [Claude marketplace catalog](../../.claude-plugin/marketplace.json) and [Codex marketplace catalog](../../.agents/plugins/marketplace.json) identify `artifex` with a local source of `./`. Keep these descriptions and versions consistent when editing plugin metadata. Parsing these files proves their structure, not installation or discovery in a running host.

[`CLAUDE.md`](../../CLAUDE.md) imports this document as project guidance. Host settings and plugin installation are separate from the library's runtime requirements.

[`AGENTS.md`](../../AGENTS.md) points to this same guide. Read [contributing](contributing.md) for contract changes and [README](../../README.md) for the first working result.
