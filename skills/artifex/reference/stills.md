---
type: knowledge
summary: "How to art-direct an Artifex still: the default looks to leave out, the focal composition preset and scaling to print; read before the first draft of a still, or when a film's rule points to the focal preset."
related_files: ["skills/artifex/SKILL.md", "core/render.js", "examples/inversion.js"]
---

# Stills

Read this with [the core skill](../SKILL.md) for a still, and for the focal
preset any piece may use. A film reads [films](films.md) instead for its looks
and finish.

## Looks to leave out

Start a still's list of [looks to leave out](../SKILL.md#ask-which-looks-to-leave-out)
with these, so the owner can strike or extend them:

- one noise family at every scale ([focal composition](#art-direction-preset-focal-composition));
- a grain pass over the finished frame instead of texture on each mark (same);
- a line that fades up through `globalAlpha` instead of arriving (same);
- a flow field around a focus that turns botanical ([traps](../SKILL.md#traps)).

## Art-direction preset: focal composition

Use this optional preset when a focal relationship suits the piece. A tessellation,
textile repeat or all-over field may deliberately give elements equal attention;
review that intention without imposing a focal point. The following guidance
does not add requirements to the piece contract.

Review these compositional properties in rendered output:

**Give every irregularity a cause.** Not one noise source standing in for all of
them. Keep them separate: *morphological* (the form itself), *gestural* (how it
appears to have been made), *material* (how the medium behaves), *compositional*
(where things sit), *temporal* (when things happen). One noise family at all
five scales produces recognisable algorithmic self-similarity.

**Texture belongs to the material, not to the frame.** A global grain pass over
a finished image treats every surface as though the same particulate process
affected it. Variation attached to the *mark* is more informative than variation
attached to every pixel. A film differs: its grain,
weave and print did touch every pixel, so declare them once as its
[finish](films.md#film-finish), over marks that keep their own texture.

**Inspect paint order in rendered output.** Correct invariants do not establish
that layering and occlusion produce the intended image.

**Prefer five excellent marks to fifty equivalent decorative ones.** Detail and
contrast should fall away from the focal relationship. Giving every element the
same detail and contrast can weaken visual hierarchy.

**A line must arrive, not fade up.** `globalAlpha = progress` is a finished line
fading in, not a pen moving, and the difference is most of what makes a drawing
read as drawn.

**A mean can hide changes in a small mark.** A large local change may contribute
little to a frame-wide average. Pair each mean with the largest single-cell
change.

**Seed robustness is the real test.** A system is not good because it accidentally
produced one beautiful seed. Render nine and look at all of them.

## Scaling to print

A print-resolution still is drawn like the page, through `drawFrame` on a real
canvas, at `scale: 8` or higher. **Not capped.**

Do not multiply every stochastic frequency by the scale.
Macro composition must be invariant under resolution; only micro-detail
bandwidth may rise with it.

`inversion.js` reads the surface's `getTransform()` to stop circles below a
1.4-pixel diameter. Larger PNG exports add smaller circles without moving shared
geometry. `VectorSurface` and the benchmark null surface expose detached numeric
`{a,b,c,d,e,f}` snapshots through `getTransform()`, without `DOMMatrix` methods.
Ordinary SVG export uses identity scale and retains the design-resolution cutoff;
surfaces without a reader use scale 1. The tree also stops after twelve reflections. See
[output formats](../../../docs/knowledge/output-formats.md) for that limit.
