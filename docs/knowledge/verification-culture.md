---
type: knowledge
summary: "Defines Artifex's reproducibility and verification limits; read before claiming identical output or completed visual validation."
related_files: ["core/rand.js", "core/render.js", "tests/negative.js", "skills/artifex/SKILL.md"]
---

# Reproducibility and verification limits

A repeated seed and playhead should reproduce a frame when the piece source, input data, parameters, output configuration, JavaScript engine, and rendering backend remain fixed. Drawing must not depend on previous calls or elapsed wall-clock time. A replay manifest records inputs, not the source code or execution environment.

Artifex does not promise byte-identical artwork across JavaScript engines. ECMAScript allows implementation-dependent numerical approximations for functions including [sin](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-math.sin), [cos](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-math.cos), [exp](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-math.exp), and [hypot](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-math.hypot). A deterministic random source does not remove that limit from downstream geometry. Canvas rasterization, antialiasing, and encoding can also vary between backends.

Use evidence that matches the claim:

- Unit tests check the specified inputs and assertions. Include nonempty-output checks when an empty result could satisfy a bound.
- Mutation checks show whether the intended assertion detects a particular defect. A subprocess failure is not evidence that the intended assertion fired.
- Byte comparisons establish equality for the compared artifacts in the recorded environment.
- Browser checks exercise native canvas and export paths in the tested browser. They do not establish other browsers or physical devices.
- Inspect rendered output across seeds and parameter ranges to assess composition, layering, and readability. Numerical agreement does not establish artistic quality.

For export behavior and replay requirements, see [output formats](output-formats.md). For executable checks and their scope, see [development guidance](development.md).
