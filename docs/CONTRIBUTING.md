---
type: knowledge
summary: "Explains how to change Artifex and which public contracts and checks to update before submitting a contribution."
related_files: ["core/piece.js", "core/render.js", "tests/negative.js", "tests/cli.test.js", "skills/artifex/SKILL.md", "plugin.json", ".claude-plugin/plugin.json", ".codex-plugin/plugin.json"]
---

# Contributing to Artifex

Use the runtime pinned in [`.nvmrc`](../.nvmrc). No dependency installation or compilation step is required.
Start with the [development guide](knowledge/development.md) for source entry points and commands.

## Change the contract

Core helpers must work across subjects. Keep algorithms specific to one example with that example.
The [runtime skill](../skills/artifex/SKILL.md) describes the authoring constraints.

When changing contract fields or rendering behavior, reconcile the [piece API](apis/piece-api.md), [output formats](knowledge/output-formats.md), and runtime skill.
Keep shared plugin metadata consistent across the [root manifest](../plugin.json) and both host manifests.
The [development guide](knowledge/development.md#plugin-metadata) identifies the catalogs and their source paths.

## Verify a change

Run `npm run check` from the repository root. It runs lint and the Node test suite.
When changing a check, contract key, or invariant, also run `npm run negative` to test whether the intended assertion rejects each mutation.

For browser and export changes, inspect rendered output and saved files in the target browser.
The Node suite does not establish visual quality or browser compatibility.
If a change claims better performance, compare measurements with `npm run bench`; see its [measurement limits](knowledge/development.md#commands).

## Messages and terms

Agents read the messages Artifex prints and act on them directly. Every refusal a command prints follows one pattern:

- It starts with the tool's name in lowercase and a colon, such as `film:`, `seeds:` or `styles pack:`.
- It says what is wrong, then what was given: `film: --force takes no-aac or no-webgl2, got no-opus`.
- It names the valid values when there are few, or the command that lists them: `npm run styles lists them`.
- It says what to do when that is not obvious, and whether anything was written: `nothing was written`.
- When the refusal is about the command's arguments, the tool's usage line follows on the next line.

`--help` and `-h` print the usage line and exit 0, and the command does nothing else. [`tests/cli.test.js`](../tests/cli.test.js) checks most tools' argument refusals and the help of each tool it lists; add a case there when you add or change an option. `tools/stitch.js` and `tools/replay.js` keep their refusal tests beside their own tests, and `tools/check-site.js` needs the site's modules, so [`site/tests/check-site.test.js`](../site/tests/check-site.test.js) checks it. When one test checks several messages or refusals, write each case as its own subtest with `await t.test(...)`, as the `seeds` and `film` cases in [`tests/cli.test.js`](../tests/cli.test.js) do, because a table-driven `assert.throws` loop stops at its first failing case and so shows one failure where each message should fail on its own.

Use one term for one thing, the term the command's options and output already use, such as piece, film or style pack, in messages, docs and tests alike.

## Report an issue

Provide the piece source, seed, parameter values, command, runtime or browser version, and observed result.
Use the routes in [README support](../README.md#support).
