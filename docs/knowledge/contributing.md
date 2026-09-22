---
type: knowledge
summary: "Explains how to change Artifex and which public contracts and checks to update before submitting a contribution."
related_files: ["core/piece.js", "core/render.js", "tests/negative.js", "skills/artifex/SKILL.md", "plugin.json", ".claude-plugin/plugin.json", ".codex-plugin/plugin.json"]
---

# Contributing to Artifex

Use the runtime pinned in [`.nvmrc`](../../.nvmrc). No dependency installation or compilation step is required.
Start with the [development guide](development.md) for source entry points and commands.

## Change the contract

Core helpers must work across subjects. Keep algorithms specific to one example with that example.
The [runtime skill](../../skills/artifex/SKILL.md) describes the authoring constraints.

When changing contract fields or rendering behavior, reconcile the [piece API](../apis/piece-api.md), [output formats](output-formats.md), and runtime skill.
Keep shared plugin metadata consistent across the [root manifest](../../plugin.json) and both host manifests.
The [development guide](development.md#plugin-metadata) identifies the catalogs and their source paths.

## Verify a change

Run `npm run check` from the repository root. It runs lint and the Node test suite.
When changing a check, contract key, or invariant, also run `npm run negative` to test whether the intended assertion rejects each mutation.

For browser and export changes, inspect rendered output and saved files in the target browser.
The Node suite does not establish visual quality or browser compatibility.
If a change claims better performance, compare measurements with `npm run bench`; see its [measurement limits](development.md#commands).

## Report an issue

Provide the piece source, seed, parameter values, command, runtime or browser version, and observed result.
Use the routes in [README support](../../README.md#support).
