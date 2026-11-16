---
type: knowledge
summary: "How to deliver an Artifex piece as a plotter or print SVG: declaring vector output, chaining segments into pen-down paths and the raster operations a vector surface refuses; read before claiming vector output."
related_files: ["skills/artifex/SKILL.md", "core/render.js", "core/surface-vector.js", "core/geom.js", "examples/contours.js"]
---

# Vector and plotter output

Read this with [the core skill](../SKILL.md) when a piece declares
`outputs: ['raster', 'vector']`. `renderVector(piece)` in `core/render.js`
returns the SVG; `examples/contours.js` is the plotter-native example. For a
piece in its own `.cjs` file, `npm --prefix "<library root>" run still -- "./my-piece.cjs"
--out "./my-piece.svg"` saves it, because a plain `require` of the
piece cannot resolve `artifex/core/...`. For where `./name` paths resolve, see
[start here](../SKILL.md#start-here).

**Chain your segments before you draw them.** A plotter lifts its pen between
paths. `chain(segs)` in `core/geom.js` joins connected segments into longer
pen-down paths. Endpoints match exactly: generate shared endpoints with the same
arithmetic. The implementation uses numeric `Map` keys, which treat `-0` and `0`
as equal. Rounding coordinates into string keys can merge distinct endpoints and
can distinguish tiny negative values rounded to `"-0.000000"` from values rounded
to `"0.000000"`.

A vector surface **refuses every raster operation by name** —
`drawImage`, `putImageData`, `fillText`, `createPattern`, `clearRect` and the
rest — and tells you what to do instead. It will never hand back a file quietly
missing half the picture.

The paths it writes carry no compositing, filter or shadow, so setting one also
throws, naming the property. `globalCompositeOperation` takes only
`'source-over'` (no `'multiply'`, `'screen'` or `'lighter'`), `filter` takes
only `'none'`, and `shadowBlur`, `shadowOffsetX` and `shadowOffsetY` take only
`0`. `shadowColor` takes any value, because with no blur and no offset no
shadow is drawn. Draw an overlap or a shadow as its own shape in the colour it
should have, or declare the piece raster-only. A blur or an offset is refused
even with a transparent `shadowColor`, and a misspelt mode is refused rather
than ignored. `shadow()` in `styles/kit.js` throws there unless its blur and
offsets are `0`.

`reset()` discards every mark drawn before it, as a canvas `reset()` clears
its bitmap, so the SVG holds only what comes after it. A `background` passed
to `renderVector` still paints its rectangle first.

An SVG keeps the bare marks: a film's finish is drawn only on raster frames.
For clipping, offsets and fields that end in paths, read
[geometry and fields](geometry-fields.md); for the output scale an SVG uses,
[scaling to print](stills.md#scaling-to-print).
