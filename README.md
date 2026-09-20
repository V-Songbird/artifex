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
- To use the skill: Claude Code. A Codex manifest ships in `.codex-plugin/`,
  but that route is untested.

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

Claude Code loads the skill on its own when a request matches it, for example
"make me a seeded poster I can send to a pen plotter". To load it for one
session, run from the repository root:

```bash
claude --plugin-dir .
```

Then call it directly with `/artifex:artifex`. To install it in one project
instead, copy `skills/artifex/` into that project's `.claude/skills/` and call
it with `/artifex`.

What changes: Claude writes pieces against the contract in `core/piece.js`,
keeps randomness addressed rather than sequential, and runs `npm run check`
before it reports. The skill text is
[skills/artifex/SKILL.md](skills/artifex/SKILL.md).

## Commands

```bash
npm run check       # lint, then the tests. The one command to run after a change
npm test            # 162 tests
npm run negative    # break it on purpose; 81 caught, 0 escaped, 0 misnamed. About 17 minutes
npm run lint        # every declared name must have a reader, every contract key a consumer
npm run examples    # render every example that declares vector, and report what it reached
npm run page        # build out/index.html, then open it
npm run seeds       # nine seeds of every example on one page, and LOOK
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
| `tools/build-page.js` | one self-contained HTML file: the live backend, the raster backend at any scale, a transport |
| `tools/lint-unread.js` | every declared name must have a reader, every contract key a consumer. No build, no browser, no art |
| `tools/contact-sheet.js` | nine seeds on one page. The only instrument for compositional faults |
| `tests/` | 162 tests |
| `tests/negative.js` | 81 mutations, each naming the test it must trip. A suite that has never been red is not evidence |

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

Not yet built: the video walk, the check suite as a shipped tool, and the
mathematics import. The [findings index](docs/README.md) is where the design for
all of it comes from.

## Configuration

Artifex has no configuration file and no environment variables. A piece
declares its own `params`, and the render call takes `seed` and `scale`.

## Documentation

Everything imported from four months of prior work and four independent audits is
in [docs/](docs/README.md). Start with
[subject-neutrality.md](docs/knowledge/subject-neutrality.md). Agents working on the
repository itself start at [AGENTS.md](AGENTS.md).

## Support

There is no public issue tracker yet. Report bugs and questions to the author,
Victor Villegas, at the address in [package manifest](.claude-plugin/plugin.json).
Include the seed, the piece name and the output of `npm run check`.

## License

MIT. See [LICENSE](LICENSE).
