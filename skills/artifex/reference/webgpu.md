---
type: knowledge
summary: "How to add the optional WebGPU pixel preview to a raster-only Artifex piece and what it may and may not claim; read before declaring preview."
related_files: ["skills/artifex/SKILL.md", "core/webgpu-preview.js", "examples/pixel-field.js", "docs/apis/piece-api.md"]
---

# WebGPU pixel preview

Read this with [the core skill](../SKILL.md) before declaring `preview`.

For a costly opaque per-pixel field, an author may add
`preview: { kind: 'webgpu-pixels', wgsl, uniforms }` to a raster-only piece.
Read the exact [GPU pixel ABI](../../../docs/apis/piece-api.md#optional-webgpu-pixel-preview)
and `examples/pixel-field.js` first. WGSL defines
`artifexPixel(position: vec2f) -> vec3f` in encoded sRGB, with fixed seed/time/size
inputs and at most sixteen float uniforms. Keep `draw` as the CPU implementation;
there is no automatic JavaScript translation or arbitrary GPU resource API.
Use the resolved state seed and shared quantized clock in both implementations.

The page starts on CPU, labels GPU output as approximate and falls back on
unavailable or software adapters, insufficient device limits, initialization or
render failure, timeout and loss. GPU preview is bounded to 4096 per axis and
8,294,400 pixels. Exports, contact sheets and replay manifests remain CPU-based.
Measure matching native CPU/GPU inputs and inspect local differences before
claiming fidelity or a speedup; Node mocks and shader timings alone do not
establish those claims. Shader arithmetic may differ across devices.
