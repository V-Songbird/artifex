---
type: api_spec
summary: "Defines core/medium.js, a simulated painting sheet that watercolour and body paint act on over time; read when a piece paints with water or thick paint instead of drawing shapes."
related_files: ["core/medium.js", "core/colour.js", "core/layer.js", "core/image.js", "tests/medium.test.js", "examples/tidal-painting.js", "examples/quince-and-shadow.js", "tests/tidal-painting.test.js", "tests/fixtures/painted-layers.cjs"]
---

# Painting medium

`core/medium.js` keeps a sheet of paper as a grid of cells and lets a piece act on it in order: wet it, wash it, stroke it, tilt it, let it dry, paint into it. Each call leaves the sheet changed for the next, so a stroke into a wet wash bleeds and a stroke over dried paint lies on top. The picture is what the sheet holds when the piece asks for it.

```js
const { medium, pigment } = require('artifex/core/medium.js');
const sheet = medium({ width: 960, height: 540, cell: 1, seed: 7, paper: { grain: 7, tooth: 0.55 } });
const ultra = pigment('#2b3a9c', { granulation: 0.8, staining: 0.2, density: 0.7 });
sheet.wash([[330, 40], [620, 40], [620, 240], [330, 240]], { water: 1.2 });   // clean water
sheet.step(10);
sheet.stroke([[340, 80], [610, 85]], { width: 70, pigment: ultra });         // wet-in-wet
sheet.step(160);
sheet.dry();
sheet.draw(g);   // on a raster surface, in the piece's design units
```

The sheet is raster by nature. `draw` puts one pixel per cell on a raster surface, scaled to the box it is given; on a vector surface it throws `medium: a vector surface has no pixels, so it cannot show a sheet`. Declare `outputs: ["raster"]`, or draw the sheet under `if (g.canvas)`.

Everything is a function of the seed and the calls, in order: no clock and no unseeded randomness. The simulation costs time per call, not per frame. Build the sheet once, outside the drawing function, and draw the finished sheet each frame.

## Paint and export a reproducible still

For JavaScript authors and agents, [tidal-painting.js](../../examples/tidal-painting.js) is a complete piece: translucent washes, a bank of body paint and knife-work highlights. Run these commands from the repository root with the Node version in `.nvmrc` and installed Microsoft Edge. No package installation is needed.

1. Export the example at a chosen seed:

   ```shell
   npm run still -- tidal-painting --seed 17 --out out/tidal-painting.png
   ```

   The result is a 720 by 540 PNG containing its replay recipe. Open the image to review the paint, then check that the recipe reproduces it:

   ```shell
   npm run replay -- out/tidal-painting.png
   ```

2. Copy `examples/tidal-painting.js` to `examples/my-painting.cjs`. Change the exported `name` to `my-painting`. Keeping the copy in `examples/` preserves its relative imports; it does not need a registry entry.

3. Change a control's `value` in `params`, keeping it within the declared range. Start with one change so its effect is visible:

   | Control | Default | Range | What changes |
   | --- | --- | --- | --- |
   | `water` | 1.1 | 0.35–1.8 | Water in the washes and watercolor strokes; changes spreading and the wet appearance. |
   | `load` | 1 | 0.2–1.8 | Body-paint coverage and raised ridges, plus the lower dry-brush accent. |
   | `tooth` | 0.25 | 0.1–0.9 | Paper relief and brush contact; absorption stays fixed. |

   These are this piece's chosen ranges, not percentages or physical units. For a different composition, edit the pigment colors and paths. Paths use 240 by 180 design units; a third coordinate is pressure from 0 to 1. The engine samples 480 by 360 cells and the piece displays the result at 720 by 540.

4. Export and replay the modified piece with the same seed:

   ```shell
   npm run still -- ./examples/my-painting.cjs --seed 17 --out out/my-painting.png
   npm run replay -- out/my-painting.png --piece ./examples/my-painting.cjs
   ```

   Compare the two PNGs to judge the intended change. Replay checks reproducibility, not whether the painting looks good. The still command takes no parameter override flag: edit defaults in your copy, or pass overrides to `solve` in JavaScript.

### Inspect a stage or supply parameters from code

With your validated `piece` and the `solve` entry point described in the [piece API](piece-api.md#entry-points):

```js
const result = solve(piece, 17, { water: 1.6, load: 0.6, tooth: 0.3 });
if (result.stages.error) throw new Error(result.stages.error.message);
const image = result.state.image; // { w, h, channels: 4, data: Uint8Array }
```

Pass `{ until: 'wash' }` as the fourth `solve` argument to inspect that stage. The stages are `paper`, `wash`, `body paint` and `finish`. Each publishes a separate image buffer. Treat those bytes as read-only after publication; `image.show` caches by buffer identity. The last stage releases the mutable sheet, so drawing the finished piece cannot keep drying or changing it.

The wash advances exactly 32 simulation steps. A step is a simulation tick, not a second. This captures a chosen wet moment; it does not run until dry. `dry()` can require many steps, so choose it deliberately when a dry result is needed.

The example uses `relief: 0.35` to keep raised paint readable without strong
repeated ridge shadows. Its `gloss`, `shadows` and `sheen` are 0.32, 0.5 and
0.35. These rendering choices change the finish, not the deposited pigment
or simulation steps; `cure(0.28)` separately sets the final paint state.

### Resolution and recovery

Increasing `--scale` changes the exported pixels, not the simulation grid. To add simulated detail, increase the sheet dimensions or reduce `cell`, then review the changed material behavior and measure the cost. This example uses 172,800 cells at `cell: 0.5`; `cell: 1` gives a smaller 43,200-cell study with coarser edges and a different material response. The engine's maximum is a refusal boundary, not a recommended working size.

The grid fields alone allocate 61 bytes per cell, plus 8 bytes per cell for
each registered watercolor pigment and each registered body-paint pigment.
Rendering needs additional buffers, and each retained RGBA snapshot uses
another 4 bytes per cell. Noise tables, tile maps, paths, the JavaScript runtime
and browser canvases add further memory. At the 4,194,304-cell refusal boundary,
the base fields alone occupy 244 MiB; filling all 16 pigment slots adds 512 MiB.
Do not use that boundary as a default working size. Release completed sheets
when only their snapshots are needed, and budget multiple sheets separately.

These single-process observations used Node 22.22.2 on Windows, with a 128 MiB
JavaScript heap cap, on 2026-11-07. The reference recipe has a 320 by 240 design
box, two watercolor pigments, one body-paint pigment and 32 explicit water
ticks. The examples use their own default recipes and seeds.

| Case | Simulation cells | Solve time | Peak Node RSS |
| --- | ---: | ---: | ---: |
| Reference, `cell: 2` | 19,200 | 0.41 s | 60.2 MiB |
| Reference, `cell: 1` | 76,800 | 0.99 s | 63.1 MiB |
| Reference, `cell: 0.5` | 307,200 | 2.44 s | 77.4 MiB |
| `tidal-painting` | 172,800 | 1.83 s | 75.6 MiB |
| `quince-and-shadow` | 307,200 | 3.45 s | 95.3 MiB |

RSS includes the measuring process and library imports; these observations
exclude browser export and are not a comparative benchmark or a latency
guarantee. A heap cap does not cap typed-array, canvas or total process memory.
Start with a modest grid, inspect the material response, then increase detail.
Doubling export scale uses four times as many output pixels without adding
simulation detail; layer and sprite caches consume additional raster memory.

If Edge cannot be found, supply its executable with `--edge PATH`. A stage failure appears in `result.stages.error`; resolve it before using a partial result. This example is raster-only and opaque: export PNG, since SVG is refused. Independent sheets do not exchange water or pigment; compositing their rendered images is separate from mixing paint on one sheet.

[quince-and-shadow.js](../../examples/quince-and-shadow.js) applies the same
journey to a still life on 307,200 cells (`cell: 0.5`) with 36 finite steps.
Broad light and shade washes turn the fruit; smaller body-paint marks add light
accents. Paper tooth is 0.28 and rendering relief is 0.28. The cloth and its
shadow reserve the fruit's shape with a one-design-unit overlap underneath it,
reducing a paper gap at their contact. These are choices in the recipe.

The still life adds dry brush marks, a transparent sprite for the branch details
and a polygon clip around the composition. Its `branchAngle` control rotates
the attached branch and leaves together. The clip masks the finished image;
it does not stop pigment transport in the simulation.

The coastal bank varies pressure along seven authored points. Its small lower
light accent is a dry `stroke` at `water: 0.08`, with amount scaled by `load`.
This gives it a different contact pattern from the three body-paint gestures.
Long body-brush strokes can still show conspicuous parallel strands; reducing
rendering relief softens their shadows without changing their geometry.

The coastal example rounds its sea and deep-pool polygons before depositing
pigment. It prewets the whole sea area plus a four-design-unit margin with
clean water, using 0.4 times the `water` control, then applies the colored washes.
This gives the edge room to spread during the existing 32 simulation steps.
Rounding changes the deposited area; prewetting changes the support's moisture.
At the low endpoint, `water: 0.35`, the pool-depth stroke uses dry-brush
contact and stays more distinct. The same control changes both the washes
and the later strokes, so it is not an isolated diffusion control.

The example also intersects the sand polygon with a shore mask before calling `wash`, reserving a dry paper margin. This restricts the initial deposit; subsequent water can still cross that boundary. Use a final drawing clip when the boundary must remain sharp in the exported image.

## Choose marks that describe the form

Choose a visual language before choosing the tool. Changing the subject or
palette does not by itself change the style. Decide what makes the intended
result recognizable at thumbnail size, then check edges and material at output size:

| Visual language | Useful starting operations | Evidence to look for |
| --- | --- | --- |
| Transparent watercolor | `wash`, wet `stroke`, finite water steps | Paper light, merged wet edges and selective dry accents; distance has less contrast. |
| Opaque, expressive oil paint | Connected body-paint masses with `paint`, local pickup and curing | Strokes turn planes and overlap; selected ridges carry light instead of covering every form equally. |
| Flat geometric composition | Public [path](../../core/path.js) and [clip](../../core/clip.js) operations on the drawing surface | Clean silhouettes, deliberate spacing and flat color relationships; no simulated paper or paint is required. |

The medium is one Artifex tool, not a requirement for every artwork. A mixture
of operations is useful when the visible result serves the chosen language.
Audit the rendered image without its style label: a recipe name or a count of
paint calls does not establish that the style reads. Check subject, style and
quality separately when comparing several works.

For authors and agents, the useful starting point is the form's silhouette,
light plane and shadow plane. Make those readable at the intended display size
before adding grain or individual strands. The [still-painting reference](../../skills/artifex/reference/stills.md#paint-in-masses-values-and-edges)
covers value groups, edge choices and marks that turn around a volume.

Render that construction before finishing. Use the final picture's geometry,
overlaps and light masses; an unrelated simplified drawing does not check them.
An ordinary declared parameter can select a construction view. Keep it as the
default while reviewing. If another parameter selects composition candidates,
capture them with `npm run seeds -- ./piece.cjs 3 --param layout --png`, replacing
`layout` with that parameter's name, and open the generated image. A generated
sheet can contain failed cells; check their errors before judging construction.

At thumbnail size, name the primary silhouette, the secondary form, their
overlap or separation, their support/contact and the dominant light/shade groups
where the style uses light. Identify the weakest relationship and its location,
or explain why none needs correction. When one fails, change shape, placement,
occlusion or a value mass before brush texture. Preserve the earlier render,
render the correction at the same seed, and check that relationship again.
Finish only after the construction reads. Compare the finished image with the
construction: marks must preserve the corrected shapes, contacts and hierarchy.
Clipping a painted image preserves its boundary, not the light/shadow separation
inside it. Inspect the silhouette and the internal planes separately.

Describe the depicted material's response to light before choosing the paint
marks. A reflection, a moist cut surface and a woven fold need different shapes,
transition widths and contrast. Brush texture describes the painting medium;
it does not by itself establish the material of the depicted object. A mark
that could move to another surface unchanged may be decoration rather than
useful material information. See the [material reference](../../skills/artifex/reference/materials.md).

Carry each major plane into the finish as a region with its own base color,
nearby value family and mark direction. Keep contact accents within their planes;
use shared boundaries to locate broader transitions where a continuous surface
turns. An internal construction boundary does not require a visible contour.
Keep light and shadow paint optically separate when
mixing would close their value gap. Public `paint` snapshots or the
[`gouache.drybrush` helper](../../skills/artifex/styles/gouache.js) over colored
masses can both supply marks; choose the one that serves the material. Turn
strokes around rounded forms and carry fold directions through changes of plane.
Reserve stronger accents for a reason; texture need not cover every region.

Preserve the value groups, not necessarily the visible flat fills of the study.
In charcoal or pencil, construct those groups with overlapping broken marks;
the public [`drag` and `pencil` helpers](../../skills/artifex/styles/pen-and-pencil.md#marks)
supply paper-sensitive strokes. Judge the resulting coverage: sparse dark marks
over light paper can lighten a shadow even when their pigment color is correct.

Assign marks a job before distributing them: a quiet mass groups value, a
turning band explains curvature, and a focal accent attracts attention. Vary
coverage, stroke length and contrast by that job. Inspect the finish at thumbnail
size: if grain attracts attention before the intended form, reduce its contrast
or spread rather than adding more kinds of marks.

Before finishing, choose a few interior light/shadow sample pairs on visible
surfaces, after occlusion. Compare the actual rendered colors at the same scale,
not just the declared palette; [pixel samples](../knowledge/command-line-tools.md#pixel-samples)
describe the existing strip tool and its limits. A few samples can flag a reversed
or weakened relationship, but cannot prove that a whole plane or picture works.
Keep sample locations fixed during a finish comparison. Correct a misplaced
baseline sample before finishing and record why; never move it to hide a failure.
If a family loses contrast, inspect the full plane and adjust its palette,
pickup, layering or mark distribution rather than retouching the sample patch.
Combine that evidence with visual review of connected masses and articulations.

For an edge or material correction, name the intended change and an untouched
control area before editing. Keep seed, geometry, light and export scale fixed.
Compare the two saved PNGs with the existing tool:

```shell
node tools/contact-sheet.js --compare out/after.png out/before.png --threshold 0 --json
```

The result reports changes after alpha is composed over white, including an
8-by-8 grid and the most changed cell. Check cells covering the intended change
and the control, then inspect both at thumbnail size and 100%. Cells can cross
material boundaries; they are not exact region masks. A large delta is not a
quality score, and a near-zero delta does not demonstrate the intended effect.

### Keep folds connected and overlaps readable

Build adjacent planes from one shared boundary. Draw each fold across both
planes before dividing it for their colors. This keeps its width and position
continuous at the turn. A sharp fold can change direction there; continuity
requires a shared crossing, not a smooth tangent in every case.

Give each major ridge and trough a corresponding change in cross-section,
silhouette or overlap where visible. Connected color bands alone can read as
stripes on a flat surface. At a free edge, check how the hem follows those folds;
reserve contact shadows for places where one surface actually hides another.

This fragment defines a piece's `draw(g)`. The plane boundary and the fold
crossing are shared data. `outline` constructs the whole band once;
`intersection` assigns the visible parts to their respective planes.

```js
const { spline } = require('artifex/core/geom.js');
const { outline } = require('artifex/core/path.js');
const { intersection } = require('artifex/core/clip.js');
const seam = [[50, 130], [240, 160]];
const crossing = [145, 145]; // Midpoint of this seam.
const planes = [
  { ring: [[100, 50], [290, 80], ...seam.toReversed()],
    base: '#c18879', shade: '#8c5558' },
  { ring: [...seam, [240, 260], [50, 230]],
    base: '#a66760', shade: '#663c49' },
];
const fold = outline(spline([
  [195, 65], [163, 108], crossing, [132, 188], [151, 246],
], 4), t => 20 + 8 * Math.sin(Math.PI * t));
const nearer = [[95, 205], [220, 225], [220, 245], [95, 225]];

function paintRings(g, rings, color) {
  g.beginPath();
  for (const ring of rings) {
    if (!ring.length) continue;
    g.moveTo(...ring[0]);
    for (const point of ring.slice(1)) g.lineTo(...point);
    g.closePath();
  }
  g.fillStyle = color;
  g.fill(); // Fill all rings together: preserve boolean holes.
}

function draw(g) {
  for (const plane of planes) {
    paintRings(g, [plane.ring], plane.base);
    paintRings(g, intersection(fold, plane.ring), plane.shade);
  }
  paintRings(g, [nearer], '#526559'); // The near contour owns the overlap.
}
```

For a band bounded by two curves, reuse both curves in neighboring regions,
reversing their traversal when necessary. Derive finishing marks from those
same curves and clip them to the intended plane. Independently authored marks
on either side can drift even when the underlying masses join.

When rendering a mark under both plane clips, keep its whole trajectory and
random identity unchanged so its dry gaps also continue across the boundary.

If adjacent antialiased fills reveal a hairline of background, fill their
`union` with the underlying material first, then add the individual planes.
Repair raster coverage without moving the shared boundary.

An overlap differs from a surface turn: paint far shapes first, then the near
shape. The far edge stops against the uninterrupted near contour. If needed,
place a short cast-shadow band on the far surface; a dark outline around every
part obscures that ownership. Check the flat masses with texture hidden: a
fold must continue across a visible turn and disappear only where occluded.
If the junction fails, repair the shared geometry before adding accents.

### Compare styles and subjects

For a style comparison, hold the subject, geometry, viewpoint and light fixed
while changing the mark language. To check transfer, give a fresh author another
subject using the same public procedure. Retain its first study and distinguish
self-correction from specific feedback supplied later. One successful transfer
is evidence for that case, not a general quality guarantee or proof that a guide
caused the improvement.

Choose a tool for each visible job instead of giving every material the same
brush settings:

| Visible job | Starting point | What to inspect |
| --- | --- | --- |
| Broad light or shade plane | `wash` with an authored shape and limited edge wander | Does the plane turn the form? Same-sheet washes mix coefficients; use independent optical layers when order must remain visible. |
| A small continuous feature or contact | A `stroke` at or above `water: 0.3`, sized for the simulation grid | Does the feature survive at display size? This wets the surface and can loosen pigment; later water steps can alter it. |
| Broken grain or worn contact | A dry `stroke` below `water: 0.3` | Do the gaps describe the surface, or erase an important feature? |
| Raised paint or a directional accent | `paint` with locally chosen pressure, width, load and length | Does the mark describe curvature or light? Long parallel strands can overwhelm a small form. |
| A crisp silhouette over existing work | A separate painted image and a presentation clip | Does the boundary need to stay sharp? A deposit mask does not block later fluid movement. |

For a face, keep brow, cheek and jaw related to one head orientation before
placing eye and mouth accents. For curved wood, let marks follow the surface
and interrupt them where light changes or another form overlaps. These are
different drawing tasks even when both use the same pigments. A continuous
outline or equally weighted marks can flatten either form.
When two materials touch, check that their values or temperatures keep the
contact readable. A skin-colored hand against similar-colored wood can merge
into it even when their geometry is correct. Use a shaped grip and a selective
contact shadow; a full dark outline is not the only way to separate them.

`water: 0` in `wash` does not make an opaque source-over brush. On one sheet, washing
skin over a dark sleeve combines their pigments; draw order alone does not
separate them. Reserve the upper material's footprint in the lower deposits,
or paint it on a fresh sheet and [compose its image over the lower one](#compose-painted-sheets).
Separate sheets preserve optical order; the upper pigment's opacity and amount
still determine how much lower color shows through. Keep deliberate mixing
inside each material's light and shade planes.

When the remaining issue is a brush setting, compare one change at a time with
the same seed, grid and lighting. Changing
bristle count changes coverage as well as grooves; it does not correct a weak
silhouette or misplaced highlight. Check both the whole composition and a crop
at output size. More export pixels alone cannot recover a feature lost on the
simulation grid.

## Animate painted drawings

Plan the action's preparation, contact, effort and release before choosing the
number of drawings. Establish the important poses as paintings; a translated
still does not demonstrate a new pose. Keep anatomical landmarks and contact
points coherent while changing contours and internal marks with the pose.
Derive adjoining parts from shared posed landmarks. For example, rotate a head
while keeping the neck's base attached to the body; moving the whole neck with
the head can open a gap at the collar.
Make a change of contact visible through the pose, separation and shadow.
An object that rises without a readable lifting gesture can look as though it
floats. If the action changes a surface, preserve that result after the tool
passes so the cause remains visible.
A successful `reach` establishes joint positions, not convincing anatomy.
Review wrist direction, thumb/finger grouping, elbow silhouette and apparent
limb volume in the preparation, contact and release poses before painting the
whole sequence. Keep this drawing review separate from the contact-coordinate check.
See [authored time](piece-api.md#authored-time) and
[paint over a hidden mannequin](../../skills/artifex/reference/films.md#paint-over-a-hidden-mannequin).

Build a static background once, then construct each painted drawing during
`build`. Reuse pigment objects, a stable paper seed and stable logical mark
identities; changing randomness every drawing can make texture flicker. The
medium's paper grid stays in sheet coordinates, so a fixed seed alone does not
guarantee that redrawn marks remain visually attached to a moving form.
Inspect their motion. Discard each mutable sheet after copying its rendered
pixels, and budget retained RGBA drawings at four bytes per cell each.

For a three-second, 24 fps film, 72 output frames held in twos need 36 drawings.
`drawingAt(clock, 2).index` from `artifex/core/time.js` selects their index; it
does not generate in-between drawings. Publish separate `Uint8Array` image
buffers and let `draw` select and display one. Drawing or scrubbing must not
advance `step`, `dry` or `cure`. Optical backdrops preserve appearance, not the
previous sheet's wet or height fields.

Review preparation, contact and release in a time strip, then watch the exported
film at normal speed. Check sliding hands, changing volume, popping contours,
boiling texture and mechanically repeated marks. Inspect decoded frames for
compression artifacts and replay the file for reproduction. These checks answer
different questions; a replay match does not establish natural movement or
artistic quality. [Film review commands](../knowledge/command-line-tools.md#time-strips)
provide strips and [replay](../knowledge/command-line-tools.md#replaying-a-saved-file)
can save decoded frames.
Use `--scale 1` with the film command to keep the piece's design dimensions;
otherwise check the encoded size. Export scaling adds pixels, not simulated detail.

## The sheet

`medium({ width, height, cell = 1, seed = 0, paper = {}, evaporate = 1 })` makes a sheet `width` by `height` design units with `cell` design units to a cell. It refuses more than 2^22 cells (about 4 M); use a larger `cell`. Water behaviour is set per cell, so a larger `cell` makes a bloom reach farther in design units. The grid does not follow the output scale.

| `paper` field | Default | Meaning |
| --- | --- | --- |
| `colour` | `'#f4efe4'` | The paper's colour. |
| `grain` | `6` | Size of its tooth in design units. |
| `tooth` | `0.5` | How deep the tooth is, 0 to 1. Granulation and dry brush follow it. |
| `weave` | `0` | A canvas weave over the tooth, 0 to 1. |
| `absorb` | `0.5` | Capacity of the fibres to hold water, 0 to 1. It changes capacity, not the uptake rate per step. Even 0 absorbs some water. |

`evaporate` scales the baseline evaporation rates of standing and absorbed
water. At 0 those rates stop, but wet-edge loss and small-residual cleanup
still apply. Absorption and flow continue.

`sheet.cols` and `sheet.rows` give the grid size.

## Pigments

`pigment(colour, { opacity = 0.15, granulation = 0.3, staining = 0.5, density = 0.4 })` describes a pigment by the colour it shows at full strength over white. Each option runs from 0 to 1:

- `opacity`: how strongly the pigment scatters light. At 0 it mostly filters, with a small scattering floor; at 1 it scatters more. Coverage also depends on color and deposited amount or paint thickness. This is not an alpha value or a promise to hide the background in one pass.
- `granulation`: how much it settles into the paper's hollows.
- `staining`: resistance to remobilization and lifting. Higher values keep more pigment settled and resist removal, but even 1 can release some during wet simulation or a `lift` operation.
- `density`: how fast it falls out of the water.

Colors mix through Kubelka-Munk absorption and scattering in three linear RGB
channels. Selected yellow and blue pigments can form green mixtures; this
RGB approximation does not predict every real pigment pair or spectral effect.
One sheet holds at most 8 watercolor pigments and 8 paint pigments; reuse the
same pigment object.

Overlapping watercolor washes on one sheet combine their pigment coefficients,
including settled pigment. Drying between washes does not create separate
optical glaze layers. Use separate sheets and `render({ backdrop })` when layer
order must remain explicit. For a mixture on one sheet, divide the desired
total `amount` and water between pigment shares; adding a full water dose for
each color also changes the moisture. Apply all shares before stepping when
comparing mixtures at a fixed starting state.

## Water

Paths are arrays of `[x, y]` or `[x, y, pressure]` points in design units, pressure 0 to 1.

Pressure 0 means minimum contact, not pen-up. It reduces the watercolor
footprint and the body brush's span, bristle radius and contact. Use separate
gestures to lift and reposition the tool. Paths with three or more points are
smoothed through their points; the curve can extend beyond the control-point
bounds, while interpolated pressure stays from 0 to 1. A single point, or a
path whose points coincide, makes a stationary dab.

| Call | What it does |
| --- | --- |
| `wash(shape, { water = 1, pigment, amount = 1, wander, feather = 0 })` | Clean water, or pigment and water, inside a polygon of at least 3 points. Its edge wanders by up to `wander` design units, the paper's grain by default. Positive `feather` fades the initial deposit inward from that edge. `water: 0` lays pigment straight on the paper. |
| `stroke(path, { width = 10, water = 1, pigment, amount = 1, length = Infinity })` | A round brush. Pressure sets the width. Below `water: 0.3` it is a dry brush that touches only the tops of the tooth. At `length` design units from the start, the distance-based deposition multiplier falls to half; `Infinity` keeps that multiplier at 1. Water on dried paint loosens some of what settled there, which makes a bloom. |
| `lift(path, { width = 10, strength = 0.6 })` | A clean damp brush that loosens settled pigment and soaks some of it up; staining pigment lifts less. `width` must be finite and positive; an invalid width is refused before pigment or water changes. |
| `tilt(x, y)` | Tilts the sheet toward `[x, y]`. Water and what floats in it run that way; a very wet area gathers a bead along its low edge and lets a few drops run as drips. `tilt(0, 0)` lays it flat. |
| `blow(at, dir, { radius = 30, strength = 1 })` | Pushes standing water toward `dir`. Both vectors have two finite numbers; arrays and numeric typed arrays are accepted. Radius is finite and positive, strength is finite and nonnegative. A zero direction or zero strength has no effect. |
| `step(times = 1)` | Runs an integer from 0 to 20,000 water ticks and applies the paint-curing rate on each tick. Zero changes nothing. |
| `dry(speed = 4)` | Runs at most 20,000 water ticks with accelerated baseline evaporation, settles pending drops at their current positions and remaining floating pigment, then clears the grid's water fields. Speed is finite and at least 1. This does not cure body paint. |

For `blow`, coordinates and radius must remain finite after conversion to
cells, the converted radius must stay positive, and the direction's magnitude
must be finite even when both of its components are finite.

`feather` is an inward transition width in design units, not a blur of the
finished image. It scales both initial water and pigment from zero at the
polygon boundary to full deposit at that distance inside, using a smooth cubic
transition. It uses the same displaced coordinates as `wander`. Zero preserves
the unfeathered deposit. The width must be finite and nonnegative, and a positive
width must remain positive after conversion to cells and span at most 65,536 cells.
Shapes too narrow for that width may never reach full coverage. Less total
pigment is deposited; `amount` is not renormalized. Later water steps can still
move pigment across the edge. This control can soften a plane or a distant
silhouette; it does not close geometry gaps or construct missing volume.
Positive feather adds a distance check against polygon edges, so use fewer
vertices where they do not change the contour and measure large sheets.

`amount` scales pigment deposited locally; it is not a fixed total quantity
shared across the whole wash or stroke. A larger wash deposits more pigment.
A stroke's total also depends on its width, path, pressure and contact with
the support. On already-wet paper, a wet brush deposits an additional soft
fringe beyond its nominal radius, before any `step()` call. Consequently,
the same `amount` can deposit more total pigment on wet paper than on dry paper.

For a controlled wet/dry comparison, use the same pigment-bearing `wash`
with `wander: 0` on each support, and prewet only one with clean water.
This keeps the initial pigment deposit identical. Record `total(pigment)`
and `render({ sheen: 0 })` before and after the same number of `step()` calls.
The resulting change includes transport, settling and drying; it does not
measure diffusion alone. `length` attenuates the watercolor stroke's local
deposit; the separate `paint` tool carries paint volumes on its bristles.

Each path or polygon accepts at most 65,536 input points. A gesture is also
limited to 65,536 curve samples and 65,536 half-cell brush samples; an excessive
path is refused before painting or reserving pigment slots. Knife operations
count their transverse blade samples toward a 65,536-sample total. Use shorter
gestures or a narrower knife when a call exceeds its budget. Splitting a brush
gesture can change its loading, depletion, smoothing and stamp spacing; it is
not an identical-output optimization. Consecutive `step(a); step(b)` calls do
preserve the same ticks as `step(a + b)` when that combined call fits its limit.
These limits bound individual loops, not elapsed time or total process memory.

The Float32 simulation also has numerical operating limits:

- Water, `amount`, body-paint `load`, air `strength` and render `relief` must be
  finite numbers from 0 to 1,000,000. Each tilt component is finite, from
  -1,000,000 to 1,000,000. Defaults and useful painting controls are usually
  near 1; these ceilings prevent extreme arithmetic, not define a target look.
- Widths for `stroke`, `paint` and `lift`, and the air radius, must remain
  positive and at most 65,536 cells after division by `cell`. `wander` may be
  zero and has the same upper cell limit. The knife also obeys its sampling
  budget above.
- Paper grain must produce finite coordinates when converted to cells.
  A positive value too small for that conversion is refused. A stroke's
  positive `length` must stay positive in cells; a paint brush's computed
  release rate must stay finite. Very small lengths can therefore be refused.

These checks run before the operation changes the sheet. Relative mixture
weights are not deposited amounts: they may exceed the amplitude ceiling,
provided their sum stays finite and positive. Large sheets, long recipes and
multiple simultaneous sheets still need a resource budget.

Adding clean water to dried pigment reactivates settled-to-floating exchange
during `step()`. The newly released pigment can move on subsequent steps.
A wet `stroke` also has an immediate release term on previously dry cells;
a clean `wash` supplies water without that brush term. `lift` additionally
removes pigment from the sheet. With `sheen: 0`, release alone may not change
the image immediately because rendering includes both settled and floating
pigment; compare after the same finite number of steps.

What a dried wash keeps:

- a darker rim where the water left last;
- granulation in the paper's hollows;
- blooms where water crept back into a drying area;
- soft bleeds where a stroke went into wet paper.

## Body paint

| Call | What it does |
| --- | --- |
| `paint(path, { colour, width = 20, load = 1, oil = 0.5, pick = 0.5, bristles, length, multicolour = false, dirty = false, carve = 0, variation = 0 })` | Body paint from a row of bristles. `colour` is a pigment or `[[pigment, share], ...]`. `load` is how much the brush holds, `oil` how fluid the paint is (0 stiff, 1 smudgy), `pick` how much wet paint the bristles take up from the sheet. `length` is the distance in design units after which a bristle has laid about half its paint, so a short length runs dry and breaks up; by default the oil sets it. `multicolour: true` loads each pigment of the mix on its own band of bristles, side by side across the brush, in the order and shares given. `dirty: true` keeps a quarter of what each bristle still held after the last `paint` under the new load, so traces of the last colour come through. `carve` (0-1) is the share of bristles that lay little and push wet paint out to their side, cutting valleys and raising ridges. `variation` (0-1) is how much groups of neighbouring bristles differ in how hard they press, so some bands lay thick and some thin. Pressure sets the width and how much is laid down. Each bristle carries its own paint, so a stroke through wet paint drags it along and its colour changes as it goes. |
| `knife(path, { width = 20, level = 0.05 })` | A palette knife: scrapes wet paint down to `level` and leaves ridges at its sides. |
| Water over wet paint | Standing water carries wet paint with it at a fraction of its speed, so wet paint under a wash thins and runs; cured paint stays. |
| `cure(share = 1, rate)` | Moves `share` of the wet paint into the sheet's accumulated dry paint. Wet paint renders above dry paint; curing merges its pigments into the dry mixture. With `rate`, each `step` dries that share. |

`paint` accepts an integer `bristles` count from 1 to 96. Omit it or use 0
to choose automatically from the brush width. Other values are refused before
pigment slots or paint change. This bounds the work done by each brush stamp.

Mixture shares are finite and nonnegative, with a finite positive total. Shares
are relative weights, and repeating the same pigment object uses one slot.
Invalid paths, shares and pigment batches are rejected before registering new
pigments, so a rejected call does not consume the sheet's eight pigment slots.

`knife` uses a fixed blade width and ignores point pressure. It redistributes
wet body paint into side ridges without cutting an alpha hole or removing
cured paint. `lift` uses a fixed removal width, followed by its damp brush
stroke; its pressure points affect that stroke rather than the removal width.
Zero `amount`, `load` or lifting strength does not disable other effects such
as water application or pickup. To make no change, omit the tool call.

`cure(share)` keeps any previously configured curing rate. Use `cure(0, 0)`
to stop automatic curing without curing more paint immediately. Water drying
and body-paint curing are separate operations.

One sheet retains one wet and one accumulated dry body-paint layer, not an
independent optical layer for every cured stroke. Successive curing can change
the apparent color as dry pigment coefficients combine. When a new dark or light
plane must keep its optical separation, use a separate sheet and
[compose its image](#compose-painted-sheets), or use the drawing surface for that
plane. Recheck the finished light/shade groups; increasing load alone does not
guarantee that the intended value survives curing.

`pick` collects wet body paint before depositing the bristle's current mix.
Some collected pigment can remain in the brush, so `total(pigment)` on the
sheet may decrease after a stroke. Body-paint levelling is a local smoothing
approximation and does not enforce exact pigment balance during `paint`.
`dirty: true` carries a quarter of the
previous brush's retained paint into the next load. A fully cured layer is
protected from pickup, the knife and water transport; curing alone does not
flatten its relief or make its finish matte.

For `paint`, a shorter positive `length` releases paint sooner. With an explicit
positive length, `oil` changes levelling rather than the release-rate formula.
`length: 0` lets oil set that rate. `length: Infinity` releases no paint;
it is not a constant-load brush. `stroke` uses its own distance multiplier,
as described under Water.

## The picture

`render({ light = [-0.5, -0.6, 0.62], relief = 1, gloss = 0.5, shadows = 0.7, sheen = 1, backdrop = null })` returns `{ width, height, data }`, opaque RGBA bytes, one pixel per cell. Rendering reads the sheet without advancing its simulation.

| Control | Accepted values | Effect |
| --- | --- | --- |
| `light` | An array or numeric typed array of exactly three finite numbers, with a finite nonzero magnitude. | Direction toward the light; normalized internally. Use a direction above the sheet. |
| `relief` | Finite number from 0 to 1,000,000. | Apparent body-paint height. Zero retains paper-grain lighting; watercolor adds no height. |
| `gloss` | Finite number from 0 to 1. | Body-paint highlights; higher values raise the peak and narrow it. Curing alone does not make paint matte. |
| `shadows` | Finite number from 0 to 1. | Local body-paint occlusion. Zero leaves the diffuse shading from surface normals. |
| `sheen` | Finite number from 0 to 1. | An appearance adjustment from standing water. Zero disables it without drying the sheet. |

The lighting model clamps the normalized vertical light component to at least
0.05 and does not model illumination from behind the support. Shadow rays use
16 samples and reach at most 24 cells horizontally. Only cells containing body
paint receive this occlusion; bare paper and watercolor-only cells do not receive
cast shadows from paint. The wet sheen adjustment is not a view-dependent
reflection or an environment map. These are bounded appearance approximations.

`draw(g, x = 0, y = 0, w = width, h = height, options)` renders and draws the sheet into the box `[x, y, w, h]` with smoothing. The options are `render`'s.

`wetCells()` counts the cells holding standing water now. `total(pigment)` gives how much of a pigment the sheet holds, floating, settled, in running drops, and as wet and dry paint; 0 for a pigment never used. Water transport, settling and drying during `step` and `dry` on a flat sheet keep that total. A drop that runs off the sheet's edge takes its pigment with it, and `lift` takes some away. Paint retained by a brush is outside this total.

Zero `wetCells()` does not mean the sheet is dry: fibres or pending drops can
still hold water. `step()` advances drops even after grid water is gone.
Use `dry()` to settle any remaining drops and finish drying rather than testing
that counter alone.

## Compose painted sheets

Pass a lower sheet's rendered image as `backdrop` when rendering the upper sheet. The upper pigments act on the supplied colors through the existing absorption/scattering model. Untouched pixels retain the lower image's exact bytes, and the upper sheet does not add a second paper surface.

```js
const { medium, pigment } = require('artifex/core/medium.js');
const lower = medium({ width: 240, height: 180, seed: 7 });
const upper = medium({ width: 240, height: 180, seed: 7 });
lower.wash([[20, 20], [180, 20], [180, 140], [20, 140]], {
  pigment: pigment('#345e9c'), water: 0, amount: 0.8,
});
upper.wash([[60, 40], [220, 40], [220, 160], [60, 160]], {
  pigment: pigment('#e2bd45'), water: 0, amount: 0.4,
});
const frame = upper.render({ backdrop: lower.render() });
```

The backdrop must have `{ width, height, data }` with dimensions matching the upper sheet's **cell grid**. Use matching dimensions and `cell` when constructing sheets. Data must be an unshared `Uint8Array` or `Uint8ClampedArray` of exactly `width * height * 4` bytes, with every alpha byte equal to 255. Mismatched sizes, other types and transparent backgrounds are refused; no implicit resizing or flattening takes place.

Rendering reads the backdrop without modifying or retaining it and returns a new image buffer. Edit either sheet and render the chain again to obtain a new result. Earlier snapshots stay unchanged. With clean water only, `sheen: 0` preserves the backdrop exactly; drying that pigment-free sheet also restores it exactly. Omitting `backdrop`, or passing `null`, keeps the ordinary paper rendering.

A new backdrop does not remove pigment already deposited on the upper sheet.
Rendering several snapshots with different base colors therefore does not
isolate their paint mixtures. Use a fresh sheet for an independent value family
when the existing deposits would contaminate its light or shadow plane.

This composes appearances. Sheets do not exchange water, pigment, brush pickup or curing state. Each sheet keeps its existing water, dry-paint and wet-paint order; use separate sheets when their optical order must change. The upper body paint contributes its own relief and finish; it does not recover the lower sheet's height or cast shadows through that relief. Shading a background that already contains lighting is an approximation. A drawing clip masks the final result separately.

The [painted-layers fixture](../../tests/fixtures/painted-layers.cjs) shows the
lower sheet, the upper sheet alone, their composition and an upper-sheet edit.
Four more cards show a selection and a cutout, each over the intact lower
image and on transparency. A Canvas clip selects from the already-composed
snapshot; a transparent `sprite` isolates the cutout so erasing it does not
erase the lower image. Drawing reads completed snapshots and retains no live
sheet. These masks change presentation, not pigment, water or their transport.
An image with transparent pixels must be flattened over opaque pixels before
it can serve as `backdrop`. From the repository root:

```shell
npm run still -- ./tests/fixtures/painted-layers.cjs --out out/painted-layers.png
npm run replay -- out/painted-layers.png --piece ./tests/fixtures/painted-layers.cjs
```

The fixture exports real alpha. The checked native 1x and 2x PNGs passed replay
with two and ten pixels respectively differing by one channel level. Their
source snapshots were unchanged, and
interior mask/fill samples matched exactly. This is not a bit-identical PNG
promise across browser rasterization paths.

## Sources and limits

The water layer follows Curtis, Anderson, Seims, Fleischer and Salesin, "Computer-Generated Watercolor" (SIGGRAPH 1997):

- shallow water moved by its pressure, the paper's slope and the tilt;
- pigment that floats, settles into the hollows and lifts again;
- capillary water that widens a drying area;
- faster drying at the wet edge, which makes the dark rim.

The body paint follows Baxter, Wendt and Lin, "IMPaSTo" (NPAR 2004): a wet layer over a dry one, with bristles that each lay down and pick up paint.

These parts are Artifex's own and come from no paper:

- the brush's flood past its bristles into standing water;
- the bead along a tilted wash's low edge, and the drips it lets go;
- the drift that carries pigment to the rim and into the hollows.
