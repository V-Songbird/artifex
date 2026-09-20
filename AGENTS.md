# Artifex — repository map

Programmatic art for AI agents. One piece renders to an interactive page, a
video, a print-resolution still and a plotter-ready SVG, with tests that can
fail. This repository is both the library and the plugin that ships it
(`.claude-plugin/`, `.codex-plugin/`, `skills/artifex/SKILL.md`).

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
| `docs/` | imported knowledge from the prior engine and four audits, one document per topic — start at [docs/README.md](docs/README.md) |
| `docs/knowledge/` | `type: knowledge` — the charter and the living references. Must always be true |
| `docs/decisions/` | `type: adr` — every closed question, with its cost and what would overturn it |
| `docs/tasks/` | `type: task_summary` — dated reports, never rewritten, plus one tracking note per **live** task |
| `docs/rescued-examples/` | the three declined field-test pieces, kept as source so dropping their branches loses nothing |
| `skills/artifex/SKILL.md` | what an agent using the library reads. Changing `core/` usually means changing this too |
| `ROADMAP.jsonl` | Foreman's ledger of planned work. Edit it through the `foreman` skill, not by hand |
| `.claude-plugin/`, `.codex-plugin/` | the two host manifests. They are byte-identical copies with no build step: edit both or they drift |
| `out/`, `node_modules/`, `.idea/` | generated or local; all git-ignored |
| `.claude/` | mostly git-ignored (worktrees, memory, logs, `settings.local.json`); `settings.json` is the one tracked file |

Tests sit in `tests/` rather than beside the code: `npm test` globs
`tests/*.test.js`, and `tools/lint-unread.js` scans `core`, `examples` and
`tests` together, so a test file is a reader like any other.

## Documentation conventions

**The folder is the `type`.** `knowledge/` must always be true, `decisions/` is
an `adr`, `tasks/` was true on its date. Every file also opens with YAML
frontmatter — `type`, `summary`, `related_files`, plus `status` on a
`task_summary` — so the right document is found by searching that metadata
rather than by opening all of them.

**One document per topic**, with a stable kebab-case name and no date in it, so
a citation stays good. Add to the topic's document rather than starting a
sibling. A number inside a dated section keeps its date instead of being
refreshed: `docs/tasks/field-test-findings.md` saying "96 tests" is evidence,
not a stale count. Citations are by section, as in
`docs/knowledge/imported-sources.md §18.1`.

When you change `core/`, check the documents whose `related_files` cover what
you touched and update them in the same commit.

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
[docs/README.md](docs/README.md) for the design behind everything unbuilt.
