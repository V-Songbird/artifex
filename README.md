# Artifex

**Programmatic art for AI agents.** Write one piece; render it to an interactive
page, a video, a print-resolution still or a plotter-ready SVG. Check it with
tests that can actually fail.

```js
const { renderVector } = require('./core/render.js');

const { svg, marks } = renderVector({
  name: 'lattice',
  size: { w: 420, h: 420 },
  outputs: ['raster', 'vector'],
  state: () => ({ cells: [] }),
  build: [['lay the grid', (s) => { /* pure in the seed */ }]],
  draw(g, s, t) { /* pure in (state, t) */ },
}, { seed: 20260917 });
```

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
| `core/piece.js` | the contract — one source of truth, unknown keys refused by name, a still is a legal piece |
| `core/surface-vector.js` | a Canvas2D-shaped surface that emits SVG, and refuses every raster operation **by name** |
| `core/render.js` | one frame to any surface, at any scale, with the playhead quantised to the drawn-frame grid |
| `tests/` | 51 tests |
| `tests/negative.js` | 13 mutations, each naming the test it must trip. A suite that has never been red is not evidence. |

```bash
npm test        # 51 tests
npm run negative  # break it on purpose; 13 caught, 0 escaped, 0 misnamed
```

Not yet built: the live and raster backends, the video walk, the check suite as a
shipped tool, the example set, and the mathematics import. The
[findings index](docs/README.md) is where the design for all of it comes from.

## Documentation

Everything imported from four months of prior work and four independent audits is
in [docs/](docs/README.md). Start with
[subject-neutrality.md](docs/subject-neutrality.md).

## Licence

MIT.
