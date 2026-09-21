# Artifex — repository map

Programmatic art for AI agents. One piece renders to an interactive page, a
video, a print-resolution still and a plotter-ready SVG, with tests that can
fail. This repository is both the library and the plugin that ships it
(`plugin.json`, `.claude-plugin/`, `.codex-plugin/`, `skills/artifex/SKILL.md`).

Node 20 or later; `.nvmrc` pins the version this is developed on. No build step
and no dependencies — `package.json` has no `dependencies` block, and `require`
paths are relative. CommonJS, not ESM.

## The two rules that outrank everything

**1. The seed and the playhead are the only inputs**, and the same pair always
produces the same frame — forwards, backwards, or after a scrub. Nothing in
`core/` may read the clock, `Math.random`, the network or mutable module state.

**2. Artifex assumes nothing about what art gets made with it.** A default, a
primitive or an example that only makes sense for one kind of picture is a
defect, not a convenience. It has eight testable forms in
[docs/knowledge/subject-neutrality.md](docs/knowledge/subject-neutrality.md) —
**read that before adding anything to `core/`.**

## Commands

| command | what it does | cost |
|---|---|---|
| `npm run check` | lint, then the tests — the one command to run after a change | ~10 s |
| `npm test` | 162 tests, `node --test` over `tests/*.test.js` | ~10 s |
| `npm run lint` | every declared name must have a reader, every contract key a consumer | instant |
| `npm run negative` | 81 mutations, each naming the test it must trip | **~17 min** |
| `npm run page` | builds `out/index.html`, one self-contained file | seconds |
| `npm run seeds` | nine seeds of every example on one page — the only instrument for compositional faults | seconds |
| `npm run examples` | renders every example that declares `vector` and reports what it reached | seconds |
| `npm run bench` | generation-speed measurements | varies |

`npm run negative` is the expensive one. Run it when the change touches a check,
a contract key or an invariant — not after every edit.

## Where things are

| path | what lives there |
|---|---|
| `core/` | the library: `piece` (the contract), `rand` (addressed, never sequential), `num`, `colour` (linear light), `path`, `geom` (polyline geometry, `chain`), `render`, `surface-vector` |
| `examples/` | eleven pieces chosen to break each other's assumptions; `index.js` exports them all. **None is the starter** |
| `tools/` | `build-page`, `contact-sheet`, `render-examples`, `lint-unread`, `bench`. No art lives here |
| `tests/` | `*.test.js` per concern (`toolkit` covers `num`, `colour` and `path`), plus `examples.test.js`; `negative.js` is the mutation suite |
| `docs/` | imported knowledge from the prior engine and four audits, one document per topic — each one's frontmatter `summary` says what it answers |
| `docs/knowledge/` | `type: knowledge` — the charter and the living references. Must always be true |
| `docs/decisions/` | `type: adr` — every closed question, with its cost and what would overturn it |
| `docs/tasks/` | `type: task_summary` — dated reports, never rewritten, plus one tracking note per **live** task |
| `docs/rescued-examples/` | `figure`, `girih` and `pulse`, the three declined field-test pieces, kept as source so dropping their branches loses nothing. Why, in [example-set.md](docs/knowledge/example-set.md) §7 |
| `skills/artifex/SKILL.md` | what an agent using the library reads. Changing `core/` usually means changing this too |
| `ROADMAP.jsonl` | Foreman's ledger of planned work. Edit it through the `foreman` skill, not by hand |
| `plugin.json`, `.claude-plugin/`, `.codex-plugin/` | the three host manifests: the root one is Agent Plugins 1.0, which Antigravity and Codex read; `.codex-plugin/` is the fallback older Codex reads. Same fields and no build step: edit all three or they drift |
| `CLAUDE.md` | one line, `@AGENTS.md`, because Claude Code cannot always read this file on its own. Codex and Antigravity read this file directly. Never put content there |
| `out/`, `node_modules/`, `.idea/`, `.agents/skills/artifex/` | generated or local; all git-ignored. The last is the copy of the skill Codex and Antigravity discover, never the source |
| `.claude/` | mostly git-ignored (worktrees, memory, logs, `settings.local.json`); `settings.json` is the one tracked file |

Tests sit in `tests/` rather than beside the code: `npm test` globs
`tests/*.test.js`, and `tools/lint-unread.js` scans `core`, `examples` and
`tests` together, so a test file is a reader like any other.

## Documentation conventions

**The folder is the `type`.** `knowledge/` must always be true, `decisions/` is
an `adr`, `tasks/` was true on its date. Citations are by section, as in
`docs/knowledge/imported-sources.md §18.1`.

The rest — the frontmatter fields, one document per topic, filenames, dated
numbers, what to update when `core/` changes — is written once in
[CONTRIBUTING.md](CONTRIBUTING.md). Read it before adding or renaming a
document.

## Pitfalls

- **`.claude/` is git-ignored except `settings.json`** — worktrees, local
  settings and the memory store stay local. Nothing you put there is committed
  or reaches another worktree.
- **Several worktrees may be open at once.** Stage by path. Never `git stash`,
  `git reset --hard` or `git clean` the whole tree.
- **`surface-vector` refuses raster operations by name.** A piece that declares
  `outputs: ['vector']` and calls one fails loudly; that is the design.
- **Colour mixes in linear light.** `round(v * 255)` with no sRGB encode renders
  a stop dark. Use `core/colour.js`.
- **The design box never changes.** `size` is the coordinate system, not a
  pixel count; scale happens at render time.
- **A suite that has never been red is not evidence.** A new test earns its
  place by failing against a deliberate break — that is what `negative.js` is.

## Start here

[README.md](README.md) for what the library does and the example table.
[docs/knowledge/subject-neutrality.md](docs/knowledge/subject-neutrality.md) for
the rule everything else answers to, then
[objective.md](docs/knowledge/objective.md) for how work is ranked. After those,
search the document summaries.
[CONTRIBUTING.md](CONTRIBUTING.md) for how to work in this repository: the
checks to run, the documentation conventions and what to update alongside code.
