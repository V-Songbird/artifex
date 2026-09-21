# Artifex

**Programmatic art for AI agents.** Write one piece; render it to an
interactive page, a video, a print-resolution still or a plotter-ready SVG.
Check it with tests that can actually fail.

Artifex is a JavaScript library and the agent skill that teaches an AI to use
it. Use it for generative, algorithmic or procedural art: a poster, a pattern,
a type specimen, a data piece, an abstract composition, an animated or growing
piece, or an SVG for a pen plotter. It is not for chart libraries, dashboards,
UI mockups or image generation from a prompt.

## The one property everything rests on

> The seed and the playhead are the only inputs, and the same pair always
> produces the same frame — forwards, backwards, or after a scrub.

That is what makes an agent's work reviewable, a video reproducible rather than
recorded, a print re-renderable at any size, and a plotter file trustworthy.

## The governing rule

**Artifex assumes nothing about what art gets made with it.**

This is not a style guideline. It is a structural constraint with eight testable
forms, and it outranks convenience, elegance and performance. A previous engine
drew one kind of picture seven times. Its default line family ended up named
`botanic`, its inking term assumed a contour bounded a volume, and the first
hard-edged piece anyone tried broke in seven places. Its own conclusion:

> "They are the shape of a library built by making one kind of picture seven
> times, **and they would not have appeared from reading the code**."

See [docs/knowledge/subject-neutrality.md](docs/knowledge/subject-neutrality.md).

## Requirements

- Node 20 or later. `.nvmrc` pins 22.
- Nothing else: no dependencies, no build step. Modules are CommonJS.
- To use the skill: Claude Code, Codex or Antigravity.

## Install

Clone the repository, then confirm it works from its root:

```bash
npm run check
```

Expected output, trimmed:

```text
unread-name scan: 399 names across 29 files in core, examples, tests
every declared name has a reader, and every contract key has a consumer
# tests 162
# pass 162
# fail 0
```

The package is private, so there is no `npm install artifex`. Every `require`
path below is relative to the repository root.

## Quick start

Save this as `first.js` in the repository root:

```js
const { renderVector } = require('./core/render.js');

const r = renderVector({
  name: 'first',
  size: { w: 400, h: 300 },          // the DESIGN BOX. It never changes.
  outputs: ['raster', 'vector'],     // 'vector' is a claim, and it is checked
  draw(g) {
    g.strokeStyle = '#1b1b1b';
    for (let i = 0; i < 24; i++) {
      g.beginPath();
      g.arc(200, 150, 8 + i * 5, i * 0.3, i * 0.3 + 2.2);
      g.stroke();
    }
  },
}, { seed: 1 });

console.log(r.marks, 'marks');
require('fs').writeFileSync('out.svg', r.svg);
```

```bash
node first.js
```

Expected output:

```text
24 marks
```

It also writes `out.svg`, 24 arcs, next to `first.js`. If `draw` calls a raster
operation such as `fillText`, the vector surface throws and names the operation.
That is the design.

Then read a real piece: `examples/contours.js`. Eleven ship, and
[none is the starter](docs/knowledge/example-set.md).

## Use it as a skill

Each host loads the skill on its own when a request matches it, for example
"make me a seeded poster I can send to a pen plotter". The skill finds the
library from its own location, so it works from a clone and from an installed
copy.

### Install the plugin

An install copies the whole library next to the skill, so it works from any
project. All three routes were run on 2026-09-20 against throwaway config homes.

**Claude Code.** The catalog is `.claude-plugin/marketplace.json`:

```bash
claude plugin marketplace add V-Songbird/artifex
```

```bash
claude plugin install artifex@artifex
```

**Codex.** The catalog is `.agents/plugins/marketplace.json`:

```bash
codex plugin marketplace add V-Songbird/artifex
```

```bash
codex plugin add artifex@artifex
```

**Antigravity.** It installs from a folder, so clone first:

```bash
agy plugin install .
```

Until the GitHub repository exists, give the first two a path to a clone instead
of `V-Songbird/artifex`. Install from a clean clone: a local path copies
git-ignored files too.

### Use it from a clone

**Claude Code.** Load the plugin for one session:

```bash
claude --plugin-dir .
```

Then call it directly with `/artifex:artifex`.

**Codex and Antigravity.** Both read project skills from `.agents/skills/`.
Copy the skill there:

```bash
mkdir -p .agents/skills
cp -r skills/artifex .agents/skills/
```

That copy is git-ignored here. The source stays `skills/artifex/`.

In Codex, call it directly with `$artifex`. Antigravity has no direct call and
picks the skill by its description.

Check the manifests with `claude plugin validate .`, which reads the catalog,
`claude plugin validate .claude-plugin/plugin.json` and `agy plugin validate .`.
All pass. The second adds one warning: the root `CLAUDE.md` is not shipped as
plugin context. That is intended, because that file serves work on this
repository. Antigravity's `plugin@marketplace` route is undocumented and has no
catalog here.

What changes: the agent writes pieces against the contract in `core/piece.js`,
keeps randomness addressed rather than sequential, and runs `npm run check`
before it reports. The skill text is
[skills/artifex/SKILL.md](skills/artifex/SKILL.md).

## Commands

```bash
npm run check       # lint, then the tests. The one command to run after a change
npm test            # 164 tests
npm run negative    # break it on purpose; 85 caught, 0 escaped, 0 misnamed. About 17 minutes
npm run lint        # every declared name must have a reader, every contract key a consumer
npm run examples    # render every example that declares vector, and report what it reached
npm run page        # build out/index.html, one self-contained file. Open it yourself
npm run seeds       # nine seeds of every example on one page, and LOOK
npm run bench       # generation-speed measurements
```

## What exists

| | |
|---|---|
| `core/piece.js` | the contract: one source of truth, unknown keys refused by name, a still is a legal piece, declared parameters that must move the output |
| `core/rand.js` | the stochastic source, **addressed, never sequential**, plus smooth fields built on it |
| `core/num.js` | the arithmetic every piece was writing for itself. Five outside authors all wrote `clamp` |
| `core/colour.js` | mixing **in linear light**, luminance, contrast, and a readable ink measured rather than guessed |
| `core/path.js` | polylines, and the first operation the design box ever had: clip to it |
| `core/geom.js` | polyline geometry: length, bbox, centroid, point-in-polygon, resample, chaikin, `chain` (segments to as few pen-downs as possible), ring, ribbon |
| `core/surface-vector.js` | a Canvas2D-shaped surface that emits SVG, and refuses every raster operation **by name** |
| `core/render.js` | one frame to any surface, at any scale, with the playhead quantised to the drawn-frame grid |
| `examples/` | eleven pieces spanning idioms that break each other. See [docs/knowledge/example-set.md](docs/knowledge/example-set.md) |
| `tools/build-page.js` | one self-contained HTML file: the live backend, the raster backend at any scale, a transport, and a frame-exact WebM export judged by what its file holds |
| `tools/lint-unread.js` | every declared name must have a reader, every contract key a consumer. No build, no browser, no art |
| `tools/contact-sheet.js` | nine seeds on one page. The only instrument for compositional faults |
| `tests/` | 164 tests |
| `tests/negative.js` | 85 mutations, each naming the test it must trip. A suite that has never been red is not evidence |

| example | idiom | time | declares |
|---|---|---|---|
| `drift` | organic, painterly | 240 frames | **raster only**, and means it |
| `specimen` | hard-edged, typographic | a still | raster + vector |
| `readout` | data-driven. **The seed does not decide what it says** | 144 frames | raster + vector |
| `partition` | recursive subdivision, made of area | a still | raster + vector |
| `contours` | plotter-native: one pen, one weight, no fills | a still | raster + vector |
| `packing` | closed forms grown until they touch. Composition decided by **refusal** | a still | raster + vector |
| `pattern` | one motif, repeated by a wallpaper group. The structure is a **group** | a still | raster + vector |
| `lsystem` | a grammar and a turtle. It computes a **word**, not coordinates | a still | raster + vector |
| `attractor` | a chaotic orbit printed as a density. **Arithmetic only** | a still | **raster only** |
| `cover` | a magazine front cover. The type is set, and the picture grows around it | a still | raster + vector |
| `settle` | forces finding their own arrangement. **State that evolves**, still scrubbable | 144 frames | raster + vector |

Not yet built: the check suite as a shipped tool, and the
mathematics import. The design for all of it comes from [docs/](docs/). Each
document's frontmatter `summary` says what it answers.

## Configuration

Artifex has no configuration file and no environment variables. A piece
declares its own `params`, and the render call takes `seed` and `scale`.

## Documentation

Everything imported from four months of prior work and four independent audits is
in [docs/](docs/). Start with
[subject-neutrality.md](docs/knowledge/subject-neutrality.md). Agents working on the
repository itself start at [AGENTS.md](AGENTS.md), the repository map.
[CONTRIBUTING.md](CONTRIBUTING.md) has the checks to run and the documentation
conventions.

## Support

There is no public issue tracker yet. Report bugs and questions to the author,
Victor Villegas, at the address in the [plugin manifest](plugin.json).
Include the seed, the piece name and the output of `npm run check`. Report a
vulnerability to the same address, not in public.

## License

MIT. See [LICENSE](LICENSE).
