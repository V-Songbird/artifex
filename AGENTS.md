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
[docs/subject-neutrality.md](docs/subject-neutrality.md) — **read that before
adding anything to `core/`.**

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
| `core/` | the library: `piece` (the contract), `rand` (addressed, never sequential), `num`, `colour` (linear light), `path`, `render`, `surface-vector` |
| `examples/` | eleven pieces chosen to break each other's assumptions; `index.js` exports them all. **None is the starter** |
| `tools/` | `build-page`, `contact-sheet`, `render-examples`, `lint-unread`, `bench`. No art lives here |
| `tests/` | one `*.test.js` per core module, plus `examples.test.js`; `negative.js` is the mutation suite |
| `docs/` | imported knowledge from the prior engine and four audits — start at [docs/README.md](docs/README.md) |
| `docs/tasks/` | dated task summaries; they record what was true that day and are not rewritten |
| `skills/artifex/SKILL.md` | what an agent using the library reads. Changing `core/` usually means changing this too |
| `ROADMAP.jsonl` | Foreman's ledger of planned work. Edit it through the `foreman` skill, not by hand |
| `out/`, `node_modules/`, `.claude/`, `.idea/` | generated or local; all git-ignored |

Tests sit in `tests/` rather than beside the code: `npm test` globs
`tests/*.test.js`, and `tools/lint-unread.js` scans `core`, `examples` and
`tests` together, so a test file is a reader like any other.

## Documentation conventions

Every file in `docs/` opens with YAML frontmatter — `type`, `summary`,
`related_files`, plus `status` on a `task_summary`. Find the right document by
searching that metadata instead of opening all of them. `type: knowledge` must
always be true; `task_summary` was true on its date; `adr` is a decision with
its reasoning.

When you change `core/`, check the documents whose `related_files` cover what
you touched and update them in the same commit.

## Pitfalls

- **`.claude/` is git-ignored in full** — worktrees, local settings and the
  memory store. Nothing you put there is committed or reaches another worktree.
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
