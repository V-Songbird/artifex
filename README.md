# Artifex

**Programmatic art for AI agents.** Write one piece; render it to an interactive
page, a video, a print-resolution still or a plotter-ready SVG. Check it with
tests that can actually fail.

```js
const { renderVector } = require('./core/render.js');

const { svg, marks } = renderVector({
  name: 'my-piece',
  size: { w: 420, h: 420 },          // the DESIGN BOX. It never changes.
  outputs: ['raster', 'vector'],     // 'vector' is a claim, and it is checked
  state: () => ({ cells: [] }),
  build: [['lay the grid', (s) => { /* pure in the seed */ }]],
  draw(g, s, t) { /* pure in (state, t) */ },
}, { seed: 20260917 });
```

Or start from a real one: `require('./examples/contours.js')`. Eleven of them
ship, and [none is the starter](docs/example-set.md).

## The one property everything rests on

> The seed and the playhead are the only inputs, and the same pair always
> produces the same frame — forwards, backwards, or after a scrub.

That is what makes an agent's work reviewable, a video reproducible rather than
recorded, a print re-renderable at any size, and a plotter file trustworthy.

## The governing rule

**Artifex assumes nothing about what art gets made with it.**

This is not a style guideline. It is a structural constraint with eight testable
forms, and it outranks convenience, elegance and performance. A previous engine —
233 commits, four independent audits, genuinely excellent — drew one kind of
picture seven times, and its default line family ended up literally named
`botanic`, its inking term assumed a contour bounded a volume, and the first
hard-edged piece anyone tried broke in seven places. Its own conclusion:

> "They are the shape of a library built by making one kind of picture seven
> times, **and they would not have appeared from reading the code**."

See [docs/subject-neutrality.md](docs/subject-neutrality.md).

## State

Early. What exists and is tested:

| | |
|---|---|
| `core/piece.js` | the contract — one source of truth, unknown keys refused by name, a still is a legal piece, declared parameters that must move the output |
| `core/rand.js` | the stochastic source: **addressed, never sequential**, plus smooth fields built on it |
| `core/num.js` | the arithmetic every piece was writing for itself — five outside authors all wrote `clamp` |
| `core/colour.js` | mixing **in linear light**, luminance, contrast, and a readable ink measured rather than guessed |
| `core/path.js` | polylines, and the first operation the design box ever had: clip to it |
| `core/geom.js` | polyline geometry: length, bbox, centroid, point-in-polygon, resample, chaikin, `chain` (segments to as few pen-downs as possible), ring, ribbon |
| `core/surface-vector.js` | a Canvas2D-shaped surface that emits SVG, and refuses every raster operation **by name** |
| `core/render.js` | one frame to any surface, at any scale, with the playhead quantised to the drawn-frame grid |
| `examples/` | eleven pieces spanning idioms that break each other — see [docs/example-set.md](docs/example-set.md) |
| `tools/build-page.js` | one self-contained HTML file: the live backend, the raster backend at any scale, a transport |
| `tools/lint-unread.js` | every declared name must have a reader, every contract key a consumer. No build, no browser, no art |
| `tools/contact-sheet.js` | nine seeds on one page — the instrument the docs name as the only one for compositional faults |
| `tests/` | 162 tests |
| `tests/negative.js` | 81 mutations, each naming the test it must trip. A suite that has never been red is not evidence. |

```bash
npm run check       # lint, then the tests -- the one command to run after a change
npm test            # 162 tests
npm run negative    # break it on purpose; 81 caught, 0 escaped, 0 misnamed
npm run lint        # every declared name must have a reader, every contract key a consumer
npm run examples    # render every example that declares vector, and report what it reached
npm run page        # build out/index.html, then open it
npm run seeds       # nine seeds of every example on one page, and LOOK
```

| example | idiom | time | declares |
|---|---|---|---|
| `drift` | organic, painterly | 240 frames | **raster only**, and means it |
| `specimen` | hard-edged, typographic | a still | raster + vector |
| `readout` | data-driven — **the seed does not decide what it says** | 144 frames | raster + vector |
| `partition` | recursive subdivision, made of area | a still | raster + vector |
| `contours` | plotter-native: one pen, one weight, no fills | a still | raster + vector |
| `packing` | closed forms grown until they touch — composition decided by **refusal** | a still | raster + vector |
| `pattern` | one motif, repeated by a wallpaper group — the structure is a **group** | a still | raster + vector |
| `lsystem` | a grammar and a turtle — it computes a **word**, not coordinates | a still | raster + vector |
| `attractor` | a chaotic orbit printed as a density — **arithmetic only** | a still | **raster only** |
| `cover` | a magazine front cover — the type is set, and the picture grows around it | a still | raster + vector |
| `settle` | forces finding their own arrangement — **state that evolves**, still scrubbable | 144 frames | raster + vector |

Not yet built: the video walk, the check suite as a shipped tool, and the
mathematics import. The [findings index](docs/README.md) is where the design for
all of it comes from.

## Documentation

Everything imported from four months of prior work and four independent audits is
in [docs/](docs/README.md). Start with
[subject-neutrality.md](docs/subject-neutrality.md).

## Licence

MIT.
