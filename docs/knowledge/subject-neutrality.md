---
type: knowledge
summary: "Explains subject-neutral helpers, the supported piece inputs, and when to adapt Artifex's optional compositional guidance."
related_files: ["core/piece.js", "examples/", "skills/artifex/SKILL.md"]
---

# Subject neutrality and medium limits

Shared helpers must not assume what a piece depicts. A pattern, letterform, data composition, landscape, or unfamiliar subject may use the same geometry and rendering operations. Algorithms specific to an example remain with that example until broader reuse justifies a shared helper.

Subject neutrality is not a promise to implement every medium. The [piece contract](../apis/piece-api.md) describes a seeded, parameterized drawing with an optional timeline. It does not define live pointer or keyboard input, network streams, device sensors, or an asset-loading lifecycle. A piece may close over fixed data; its author must provide and preserve those data for reproducible rendering. The browser's seed, parameter, and playback controls select rendering inputs rather than extending the piece contract with live interaction.

The runtime skill's focal-composition guidance is an optional art-direction preset. Use it when the intended result benefits from a focal relationship and decreasing detail away from it. Equal emphasis can be intentional in a tessellation, textile repeat, all-over field, or evenly structured diagram. Review such work against its stated purpose instead of requiring a focal point.

Supported output formats and their limits are described in [output formats](output-formats.md). Mechanical and visual evidence answer different questions; see [verification limits](verification-culture.md).
