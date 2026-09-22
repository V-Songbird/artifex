---
type: knowledge
summary: "Describes Artifex's source layout, development commands, plugin metadata, and the limits of its checks."
related_files: ["package.json", ".nvmrc", "core/piece.js", "tests/negative.js", "tests/contact-sheet.test.js", "tools/contact-sheet.js", "tools/lint-unread.js", "tools/build-page.js", "plugin.json", ".claude-plugin/plugin.json", ".codex-plugin/plugin.json", "skills/artifex/SKILL.md", ".github/workflows/check.yml"]
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
| `npm run examples` | Writes registered vector examples as SVG files under `out/`. |
| `npm run seeds -- drift 16 0.5` | Writes a contact sheet for a registered example. |
| `npm run seeds -- drift 5 0.5 --param reach` | Writes a five-value parameter strip at the piece's fixed seed. |
| `npm run seeds -- drift 3 0.5 --param reach,turn` | Writes a 3-by-3 parameter grid at the piece's fixed seed. |
| `npm run bench` | Measures build, draw, and vector emission costs. |

Run `npm run check` after source changes. Run the mutation suite when changing a check, contract key, or invariant; it executes a full test run for each mutation and takes longer than the unit suite.

The benchmark uses a null surface to measure drawing calls without SVG emission. For vector pieces, the displayed emission cost excludes that draw time. The total is build plus full vector rendering; for raster-only pieces it is build plus null-surface drawing. It does not measure browser canvas or video encoding performance. Inspect [`tools/bench.js`](../../tools/bench.js) before choosing benchmark flags or comparing its baseline.

`npm run bench` writes or replaces `out/bench.json`. `BENCH_REPS` controls its sample count and defaults to 40. Preserve a baseline elsewhere before running a comparison you need to retain.

For a focused contract check, run `node --test tests/piece.test.js`. Generated pages, artwork, contact sheets, and benchmark results go under `out/`.

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
| [`core/render.js`](../../core/render.js) | Drawing a frame, rendering SVG, and enumerating playheads. |
| [`core/surface-vector.js`](../../core/surface-vector.js) | Canvas2D-shaped vector surface and SVG serialization. |
| [`core/rand.js`](../../core/rand.js) | Addressed randomness and noise fields. |
| [`core/geom.js`](../../core/geom.js), [`core/path.js`](../../core/path.js) | Geometry and path operations. |
| [`core/num.js`](../../core/num.js), [`core/colour.js`](../../core/colour.js) | Numeric and colour operations. |
| [`examples/index.js`](../../examples/index.js) | Examples available to the bundled tools. |
| [`tools/build-page.js`](../../tools/build-page.js) | Browser bundle, transport, inspection interface, and exports. |
| [`tests`](../../tests) | Contract, geometry, rendering, examples, and mutation coverage. |

Core helpers must remain useful across subjects. Keep algorithms specific to an example with that example. When the public contract changes, reconcile the [piece API](../apis/piece-api.md) and [runtime skill](../../skills/artifex/SKILL.md) with `FIELDS`.

The page builder discovers JavaScript modules in `core/` and `examples/`, then bundles them with a CommonJS loader. Its module-resolution and script-parsing checks catch structural build failures. Template-string content needs correct escaping before it becomes browser JavaScript.

## What verification establishes

The Node suite checks selected contract, geometry, replay, frame-grid, SVG, and example properties. Its browser-facing tests use controlled surfaces and script inspection. They do not launch a browser or establish visual quality.

For browser or export changes, inspect actual rendered output and saved files. Check exported video frame counts and spacing from the encoded file. Automated numerical checks do not establish composition, layering, or usability.

The mutation suite copies `core/`, `examples/`, `tests/`, `tools/`, and `package.json` into temporary directories. Its control run must pass before mutation results are useful. It distinguishes an escaped mutation from one rejected by the wrong test.

## Continuous integration

The [Check workflow](../../.github/workflows/check.yml) uses the Node version in `.nvmrc` on Linux and Windows. It rejects tracked ignored files, runs `npm run check`, and builds the standalone page.

Submit changes through a pull request targeting `main`. The branch rules require the Linux and Windows checks, resolved review conversations, and a linear history. Deletion and force pushes are blocked.

See the [security policy](../security.md) for private vulnerability reporting and the boundaries of executing piece code.

## Plugin metadata

[`plugin.json`](../../plugin.json), [`.claude-plugin/plugin.json`](../../.claude-plugin/plugin.json), and [`.codex-plugin/plugin.json`](../../.codex-plugin/plugin.json) describe the plugin. The two host-specific manifests are identical; the root manifest adds `$schema`.

The [Claude marketplace catalog](../../.claude-plugin/marketplace.json) and [Codex marketplace catalog](../../.agents/plugins/marketplace.json) identify `artifex` with a local source of `./`. Keep these descriptions and versions consistent when editing plugin metadata. Parsing these files proves their structure, not installation or discovery in a running host.

[`CLAUDE.md`](../../CLAUDE.md) imports this document as project guidance. Host settings and plugin installation are separate from the library's runtime requirements.

[`AGENTS.md`](../../AGENTS.md) points to this same guide. Read [contributing](contributing.md) for contract changes and [README](../../README.md) for the first working result.
