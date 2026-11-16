---
type: knowledge
summary: "Replica mode in Artifex: a piece made to match one reference image as a named study, entered only on request, measured, fitted with few-point shapes and scored against the reference; read whole before making a replica."
related_files: ["skills/artifex/SKILL.md", "tools/measure-reference.js", "tools/contact-sheet.js", "tools/still-cli.js", "core/geom.js"]
---

# Replica mode

Read this with [the core skill](../SKILL.md) before making a replica.

A replica is a piece made to match one reference image, to copy an artwork or
to study a style. It is a named study, and it is drawn from shapes you write
and scored against the reference. To draw over, from or after an image, which
is a different thing, see [images in](images-in.md).

1. **Enter it only on an explicit request.** The user asks for a copy, a
   replica or a faithful study of that image, or to make a style from it. A
   reference given for mood, a material or a style to draw in is not one: take
   its technique, never its composition, as [named styles](named-styles.md) says.
   For a style made from it, the replica only calibrates the marks (step 3 of
   making a style there), and its composition never enters the style. When
   the request is unclear, ask.
2. **Name the source; the rights stay the user's.** The comment at the top of
   the piece says it is a replica and names the work, its maker and where the
   image came from, as the user gave them. The library grants no rights. A
   replica stays in the user's project, never in the library's `examples/` or
   `site/`.
3. **Measure the reference.** Save it as PNG and run
   `npm --prefix "<library root>" run measure -- "./ref.png" --out "./ref.json"`
   from the piece's folder; relative paths follow [Start here](../SKILL.md#start-here)
   ([measuring a reference image](../../../docs/knowledge/command-line-tools.md#measuring-a-reference-image)).
   Set the piece's `size` to the report's `size`, so one design unit is one
   reference pixel. Raise `--tolerance` until the largest outlines keep few
   points. Paint by containment, not by `share`: draw a region before every
   region inside it, so the backdrop goes first and a shape inside a ring goes
   after the ring. An outline marked `hole: true` is the edge of what lies
   inside the region, never a shape to fill in that region's colour: fill the
   region's outer outline, then draw what sits in the hole on top of it. To
   fit a shape that sits on a ground, use the shape's own outer outline, not the
   ground's hole around it; fit the hole only when the shape's colour has no
   outline of its own. A hole holding only transparent pixels stays unpainted:
   cut it out of the region's fill (both loops in one path, filled or clipped
   even-odd) ([holes](../../../docs/knowledge/command-line-tools.md#holes)).
4. **Fit few-point shapes.** Type a few named points per region into the source
   from the report, and draw each region through them with
   `fill(g, spline(pts, 1, { corners, close: true }))`, listing a sharp point's
   index in `corners`, or with `bezier(path, 1, true)` for a shape known as
   curves ([geometry and fields](geometry-fields.md)). Use `fill` on
   the points, not `outline(..., { closed: true })`, which paints a ring. Keep
   each shape to 12 points or fewer; split a larger region into named parts.
   For a region with a transparent hole, `fill` cannot help: it starts a new
   path for each loop. Call `g.beginPath()`, trace the outer loop and each
   hole loop (each a `spline(...)` result) with `moveTo`, `lineTo` and
   `closePath`, then `g.fill('evenodd')`. To clip the region's marks instead,
   call `g.save()` before `beginPath`, `g.clip('evenodd')` after the loops and
   `g.restore()` after the marks, or the clip cuts every region drawn later in
   the frame, including what sits in the hole. Check: run
   `npm --prefix "<library root>" run measure` on the step 5 still as in
   step 3; the region's colour again lists a
   `hole: true` outline there, `transparent` is above 0, and no colour has an
   outline inside that hole's `bbox` unless the reference has one.
5. **Score it.** Save the render at the reference's exact size with
   `npm --prefix "<library root>" run still -- "./replica.cjs" --out "./replica.png"`,
   then run
   `npm --prefix "<library root>" run seeds -- --compare "./replica.png" "./ref.png" --json`
   ([comparing a render with a reference](../../../docs/knowledge/command-line-tools.md#comparing-a-render-with-a-reference)).
   Change the shape inside the `worst` region next.
6. **Stop when `off` stops falling.** Keep a change only when it lowers `off`.
   Stop after two rounds in a row that each lower `off` by less than a tenth
   of its value, or when `off` meets a limit the user set. Then look at the
   render and the reference side by side at 100% (`--loupe`).
7. **Keep the reference out of the replica.** Do not declare it in `images`,
   and do not copy the measure report or any shape over the 12 points of
   step 4, even when an outline's `points` list holds more. A replica that
   shows or samples its reference scores the image, not your shapes, and
   calibrates nothing. If what the user wants is the image itself under or
   inside the marks, make that piece instead ([images in](images-in.md)) and
   name it as one.
