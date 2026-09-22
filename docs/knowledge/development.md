---
type: knowledge
summary: "Describes Artifex's source layout, development commands, plugin metadata, and the limits of its checks."
related_files: ["package.json", ".nvmrc", "core/piece.js", "tests/negative.js", "tools/lint-unread.js", "tools/build-page.js", "plugin.json", ".claude-plugin/plugin.json", ".codex-plugin/plugin.json", "skills/artifex/SKILL.md", ".github/workflows/check.yml"]
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
| `npm run bench` | Measures build, draw, and vector emission costs. |

Run `npm run check` after source changes. Run the mutation suite when changing a check, contract key, or invariant; it executes a full test run for each mutation and takes longer than the unit suite.

The benchmark uses a null surface to measure drawing calls without SVG emission. For vector pieces, the displayed emission cost excludes that draw time. The total is build plus full vector rendering; for raster-only pieces it is build plus null-surface drawing. It does not measure browser canvas or video encoding performance. Inspect [`tools/bench.js`](../../tools/bench.js) before choosing benchmark flags or comparing its baseline.

`npm run bench` writes or replaces `out/bench.json`. `BENCH_REPS` controls its sample count and defaults to 40. Preserve a baseline elsewhere before running a comparison you need to retain.

For a focused contract check, run `node --test tests/piece.test.js`. Generated pages, artwork, contact sheets, and benchmark results go under `out/`.

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
