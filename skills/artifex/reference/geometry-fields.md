---
type: knowledge
summary: "Artifex's geometry, path and field helpers and their traps: clipping runs, segment queries, offsets, isolines, streamlines, resampling and height-field shading; read before a piece clips, offsets, resamples or draws a field."
related_files: ["skills/artifex/SKILL.md", "core/geom.js", "core/path.js", "core/field.js", "docs/apis/geometry.md", "docs/apis/fields.md"]
---

# Geometry and fields

Read this with [the core skill](../SKILL.md) when a piece uses `core/geom.js`,
`core/path.js` or `core/field.js`.

**`clipPolyline` returns RUNS, not one line.** A line that leaves the design box
and comes back is two marks; joining them draws a stroke across the middle of
the picture that you never asked for, and a plotter draws it too.

For segment query results and bounded open offsets, read the
[geometry API](../../../docs/apis/geometry.md). Intersections distinguish a single
point from a collinear overlap. Offsets keep self-intersections and use limited
miter joins with bevel fallback; they are not polygon boolean operations.

For fields that end in drawing paths, read the [field API](../../../docs/apis/fields.md).
`isolines` returns raw segments and chained paths in grid coordinates;
`streamline` walks scalar angles or vector directions with a fixed spatial step.
`gradient` and `curl` differentiate a caller-supplied scalar field with a finite
difference step in that field's coordinate units.

## Traps

- **Preserve straight runs when resampling.** Curvature-based resampling can drop
  a two-point stroke below a station minimum, removing a letter's crossbar or
  another straight feature. Retain its endpoints.
- **Curvature is not occlusion.** A Laplacian measures local curvature rather
  than visibility and can produce bright centres and dark rings unrelated to
  blocked light. When estimating ambient occlusion from a height field, use
  visibility information, such as a horizon sweep.
