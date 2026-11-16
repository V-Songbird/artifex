---
type: knowledge
summary: "Traps that break an Artifex piece without an error: blends that read their destination, cached layers that read the playhead, simulations advanced in draw, display values taken as linear light, binding limiters, unstable addresses, checks that pass on nothing, timing, dead parameters and botanical flow fields."
related_files: ["skills/artifex/SKILL.md", "core/sim.js", "core/layer.js", "core/rand.js"]
---

# Traps

Read this with [the core skill](../SKILL.md).

- **A blend may not read its own destination.** Writing a blend back into the
  value it read makes the result a function of how many times the page has been
  re-rolled, not of the seed.
- **A cached layer may not read the playhead.** It freezes the frame it was built
  on and the piece silently stops animating there.
- **Solve a simulation in `build`; make `draw` a lookup.** Advancing a system
  inside `draw` makes `draw` stateful, so landing on t=0.3 gives whatever the
  previous call left behind and the piece is unscrubbable. Step the whole
  trajectory once, store a snapshot per drawn frame, and have `draw` read
  `clock.frame`. Quantise the whole frame, not just the reveal: a simulation
  advanced continuously under a stepped drawing slides. For bodies that push,
  bounce, hang or pile, `simulate` from `core/sim.js` does this: hand it the
  piece's frame count and rate, read `at(clock.frame, i)`, and schedule sound
  from its `contacts` log (see [films](films.md#parts-coupled-in-space)).
  Boxes and shapes that turn, topple and stack are its `bodies`, read with
  `pose(clock.frame, k)`. For a medium that flows, such as smoke, mist, dye
  or a current behind the action, `fluid` from `core/sim.js` bakes a coarse
  grid the same way: give it sources that add density and a push, read
  `density(clock.frame)` in draw, and paint it as soft cells or as
  `isolines` contours. A grid of 48 by 27 is enough for a background; draw
  it large and soft, and let `sample(frame, x, y)` carry small marks along.
- **Display values are not linear light.** Passing linear-light values directly
  to `round(v*255)`, without sRGB encoding, produces an incorrectly dark display
  result.
- **A limiter that binds throughout a simulation can determine the animation.**
  With a falling displacement ceiling, the ceiling may dictate motion magnitude
  while the forces only choose direction. Measure how often the clamp binds
  across frames and seeds.
- **Address stable entities, not output positions.** `R('dither', 'f', facets.length)`
  changes its address whenever an earlier facet is removed. Use an entity index
  that remains stable when other output is filtered or reordered.
- **A check whose pass condition is "no difference" is satisfied by nothing
  happening.** Pair every bound with a floor that must be non-zero.
- **A clock read after the drawing calls return measures their submission.**
  A browser canvas defers rasterization; force it, for example with a one-pixel
  `getImageData`, before timing a frame.
- **A declared parameter must affect the output.** Sweep each parameter at min,
  value and max: cyclic parameters may produce the same output at both endpoints.
  Check that the build or draw actually reads its validated value.
- **A flow field plus starts around a focus defaults to looking botanical.**
  If `f` changes little along a stroke, integrating `(f - 0.5)` into its heading
  produces an approximately circular arc. To avoid that default, steer *towards*
  the field with inertia and let the focus modulate size and density rather
  than position.
