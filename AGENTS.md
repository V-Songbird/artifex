# Artifex

A JavaScript library and agent skill for making art from code: one seeded piece renders to a page, PNG, SVG and an MP4 film with sound. CommonJS on Node 22 or later, pinned in [`.nvmrc`](.nvmrc). Nothing to install or build: no dependencies, no compile step. Run every command from the repository root.

## Start here

- Before changing a piece field, validation or rendering behaviour: [the piece API](docs/apis/piece-api.md), then [the runtime skill](skills/artifex/SKILL.md); `FIELDS` in [`core/piece.js`](core/piece.js) is the contract both describe.
- Before running a command not listed below, or a flag you have not used: [the full command reference](docs/knowledge/development.md#commands) and [command-line tools](docs/knowledge/command-line-tools.md).
- Before choosing which tests prove a change, or claiming a browser, export or visual result: [verifying changes](docs/knowledge/verification.md#focused-checks-by-area).
- Before changing `core/`, `tools/build-page.js` or anything under `site/`: [the site](docs/knowledge/site.md); it bundles core modules under a first-load budget.
- Before changing a style guide, a style module or style packs: [the style catalog](skills/artifex/styles/catalog.md) and [style packs](docs/apis/style-packs.md).

## Rules that outrank everything

- Shared helpers, the skill and the style guides assume nothing about what a piece depicts; an algorithm for one example lives with that example ([subject neutrality](docs/knowledge/subject-neutrality.md)).
- When the public contract changes, `FIELDS`, [the piece API](docs/apis/piece-api.md) and [the runtime skill](skills/artifex/SKILL.md) with its references change together.
- Public files never link to or depend on `.private/`, `docs/tasks/`, `docs/decisions/`, `docs/knowledge/private/` or `docs/apis/private/`; `tests/skill-links.test.js` and the site build refuse it.

## Commands

| Command | What it does | Cost |
| --- | --- | --- |
| `npm run lint` | Unread declarations and contract keys. | Seconds. |
| `npm run test:changed` | Only the tests a change against `main` reaches; `-- --list` prints the selection. | Up to minutes; waits for any other test run on the machine. |
| `npm run test:all` | Every test file. Run with lint before merging. | Several minutes; run in the background with output written to a file. |
| `node --test tests/<file>.test.js` | One test file. | Seconds. |
| `npm run check` | Lint plus `npm test`, as CI runs it. | Several minutes. |
| `npm run page` | Builds `out/index.html`, the self-contained page. | Seconds. |
| `npm run browser` | Checks the built page and its film export in installed Edge. Run `npm run page` first. | Minutes; needs Microsoft Edge. |
| `npm run seeds -- <piece> 9 0.5` | Contact sheets, parameter sweeps and time strips; `--png` and `--json` draw in Edge. | Seconds to minutes. |
| `npm run film -- <piece>` / `npm run still -- <piece>` | Saves an MP4 film or one frame through the page's own export. | Minutes; needs Edge. |
| `npm run site` / `npm run site:check` | Builds the showcase site and runs its tests. | Seconds to a minute. |
| `npm run negative` | Mutation suite: proves each check rejects its mutation. | Hours; CI runs it when started by hand. |

## Where things live

| Path | Holds |
| --- | --- |
| `core/` | The library: contract and validation (`piece.js`), drawing and sound rendering, film export, geometry, fields, time, simulation, sound. |
| `examples/` | Registered example pieces, listed in `examples/index.js`; the tools find them by that name. |
| `tools/` | Every `npm run` command: page build, Edge checks, seeds, film, still, replay, stitch, styles, site. `tools/fixtures/` holds the two pieces `npm run browser` draws, since installs leave out `tests/`. |
| `tests/` | Node tests (`*.test.js`), fixtures in `tests/fixtures/`, mutations in `tests/negative.js`. |
| `skills/artifex/` | The runtime skill (`SKILL.md`), its `reference/` docs, the film scaffold. |
| `skills/artifex/styles/` | Built-in styles: a guide `<name>.md` and a mark-functions module `<name>.js` each, listed in `builtin.json`. No picture to draw. |
| `skills/style-pack/` | The skill for packing a style's guide, mark functions and their proof as an installable style pack. |
| `site/` | The showcase site: `shots.js`, stage runtime, `pieces/` (its art shots), `demos/` (site demos of the built-in styles, each named after its style), `posters/`, `tests/`. |
| `docs/apis/`, `docs/knowledge/` | Public contracts and guides. [Contributing](docs/CONTRIBUTING.md) and [security](docs/SECURITY.md) sit in `docs/`. |
| `out/` | Generated pages, artwork, sheets, films and reports. Ignored by Git. |
| `assets/` | The plugin's icon: its piece `icon.cjs` and the `icon.png` and `icon.svg` drawn from it. |
| `plugin.json`, `.claude-plugin/`, `.agents/plugins/` | Plugin manifests and marketplace catalogs; `tests/plugin-manifests.test.js` keeps them consistent ([plugin metadata](docs/knowledge/development.md#plugin-metadata)). |

One name can mean three files: `skills/artifex/styles/cad.js` is the style's mark functions, `site/demos/cad.js` its site demo, and `site/pieces/cad.cjs` a site art shot. Search with the folder.

## Conventions

- Refusal messages follow one pattern, and `tests/cli.test.js` checks them: see [messages and terms](docs/CONTRIBUTING.md#messages-and-terms).
- Generated output goes under `out/`; an external piece's sheets go beside it.
- To run an external piece from a Node script, load it with `loadExternal` from `tools/piece-input.js`; a plain `require` cannot resolve its `artifex/core/...` imports.

## Pitfalls

- **Other agents may be working in this checkout.** Stage and commit by path (`git commit -- <paths>`), leave a file someone else has modified, and never run `git stash`, `git checkout .`, `git reset --hard` or `git clean`.
- **Only one test run at a time per machine.** `test:changed` and `test:all` take a lock in the system temp directory, so a second run waits instead of failing.
- **A test a mutation expects must fail in well under 1 MiB of output.** Compare large arrays by a count or the first differing index, not `deepEqual`, or the mutation reports as infrastructure (`ENOBUFS`).
- **Editing a line that `tests/negative.js` patches makes that mutation stale.** Run `node --test tests/mutation-patches.test.js`; it names each stale patch in under a second.
- **A change under `core/` reaches the site and its posters.** Run `npm run site` and `npm run site:check` (the first load must stay under 150 kB), and `npm run posters`, committing the poster records it rewrites.
- **`--style <name>` draws nothing.** Every style, built in or packed, is a guide and mark functions with no picture; each tool refuses `--style` with the style's guide and module paths.
- **A `node --test` run that stops names only the file.** To find a hanging test, run each title alone with `--test-name-pattern` under a timeout.
