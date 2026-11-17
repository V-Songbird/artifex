---
type: knowledge
summary: "Explains subject-neutral helpers, the supported piece inputs, and when to adapt Artifex's optional compositional guidance."
related_files: ["core/piece.js", "examples/", "skills/artifex/SKILL.md"]
---

# Subject neutrality and medium limits

Shared helpers must not assume what a piece depicts. A pattern, letterform, data composition, landscape, or unfamiliar subject may use the same geometry and rendering operations. Algorithms specific to an example remain with that example until broader reuse justifies a shared helper.

Subject neutrality is not a promise to implement every medium. The [piece contract](../apis/piece-api.md) describes a seeded, parameterized drawing with an optional timeline, or, with `play`, a drawing that answers pointer and key input on fixed ticks and records it as a session log. It does not define network streams, device sensors, or loading assets at run time. A piece may embed fixed data, including the images it declares in `images`; its author must provide and preserve those data for reproducible rendering. The browser's seed, parameter, and playback controls select rendering inputs; only `play` lets a person's input change the state, and only through its session log. `core/play.js` runs sessions and sound cues without knowing what a piece depicts or what game it plays; the rules of the `noughts` example live in that example.

The runtime skill's focal-composition guidance is an optional art-direction preset. Use it when the intended result benefits from a focal relationship and decreasing detail away from it. Equal emphasis can be intentional in a tessellation, textile repeat, all-over field, or evenly structured diagram. Review such work against its stated purpose instead of requiring a focal point.

Supported output formats and their limits are described in [output formats](output-formats.md). Mechanical and visual evidence answer different questions; see [verification limits](verification-culture.md).
