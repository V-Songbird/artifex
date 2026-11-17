---
type: knowledge
summary: "Explains what Artifex produces and how to render a first piece from a local checkout."
related_files: ["package.json", "core/render.js", "tools/contact-sheet.js", "examples/index.js", "skills/artifex/SKILL.md"]
---

# Artifex

Artifex is a CommonJS library and agent skill for creating art from code. One piece can produce an interactive page, a PNG, an MP4 film (WebM where a browser cannot encode that film), or an SVG when its drawing operations support that output.

The library supplies deterministic randomness, geometry, colour, a piece contract, and rendering tools. It has no runtime dependencies or required network service. It does not generate images from text or judge artistic quality.

## Render a first piece

The [README quick start](../../README.md#quick-start) gives the requirements and the first command, `npm run page`, which writes `out/index.html`. Open that file in a browser to select an example, change its seed and parameters, scrub animated pieces, and export artwork. A successful build does not establish browser compatibility; see [output formats](output-formats.md). Run these commands from the repository root. The project's full checks, `npm run check`, take several minutes; see [development](development.md).

For SVG output from the registered vector examples:

```shell
npm run examples
```

This writes one SVG per vector example under `out/` and reports raster-only examples explicitly. To compare one example across seeds:

```shell
npm run seeds -- drift 9 0.5
```

Open `out/drift-seeds.html` to inspect seeds 1 through 9 at playhead 0.5. The command accepts a name from [`examples/index.js`](../../examples/index.js) or a path to your own piece such as `./first.cjs`.

To compare a parameter range while holding the piece's seed fixed:

```shell
npm run seeds -- drift 5 0.5 --param reach
npm run seeds -- drift 3 0.5 --param reach,turn
```

Open `out/drift-param-reach.html` for a five-value strip, or `out/drift-param-reach-turn.html` for a 3-by-3 grid. Values include the declared range endpoints; the first parameter varies across columns and the second down rows. Cells show their values, paint-call count, painted-pixel bounding-box coverage (including backgrounds), and build time. See [contact-sheet metrics](command-line-tools.md#contact-sheet-sweeps-and-metrics) for their definitions and the `window.__sheet.cells` inspection data.

## Make a piece

Read the [piece API](../apis/piece-api.md) for a runnable custom piece. The [Artifex skill](../../skills/artifex/SKILL.md) explains drawing constraints, example idioms, and visual review.

For fixed code, data, parameters, and rendering configuration, a seed and playhead must reproduce the same frame in the same execution environment. This is an authoring requirement; the library cannot prove that arbitrary user drawing code is pure. Cross-browser pixel equality is not guaranteed.

The root and host-specific plugin manifests describe the same library. The Claude and Codex marketplace catalogs both use the repository root as their source. A plugin installation needs the library files alongside the skill; copying `SKILL.md` alone is insufficient. The README installs Claude Code and Codex with a sparse checkout of the folders the plugin uses: `core/`, `skills/`, `tools/`, `examples/`, `assets/`, `docs/` and the host's catalog folder, plus the files at the root. Anything a command the skills name reads at run time belongs in one of them, which is why the two fixtures `npm run browser` draws live in `tools/fixtures/`, not `tests/fixtures/`.

See [development](development.md) for checks and source entry points, and [LICENSE](../../LICENSE) for the MIT license.
