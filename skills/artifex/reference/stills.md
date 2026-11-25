---
type: knowledge
summary: "How to art-direct an Artifex still: the default looks to leave out, the focal composition preset with placement, attraction, a palette that survives greyscale, what points at the subject, an energy line with pressure and release, blocking in masses, placing things in depth from the horizon (level ellipses, openings and blocks, one projection, vanishing points far apart) and running depth cues one way (overlap first, ties for things off the ground, no grazing outlines), shape language, line weight, marks that model form (fold edges, cross-contours, texture at the outline, overlap bands, one-way shadow hatching), painting in masses (light and shade first, three to five value groups, hard, soft and lost edges, temperature shifts between light and shade, few strokes, detail at the focus), scaling to print and comparing two versions blind or scoring a replica by measure; read before the first draft of a still, or when a film's rule points to the focal preset."
related_files: ["skills/artifex/SKILL.md", "core/render.js", "core/geom.js", "core/path.js", "examples/inversion.js", "tools/contact-sheet.js"]
---

# Stills

## Contents

- [Looks to leave out](#looks-to-leave-out)
- [Art-direction preset: focal composition](#art-direction-preset-focal-composition)
- [Colour by its modifiers and medium](#colour-by-its-modifiers-and-medium)
- [Shape language](#shape-language)
- [Line weight](#line-weight)
- [Marks that model form](#marks-that-model-form)
- [Paint in masses, values and edges](#paint-in-masses-values-and-edges)
- [Scaling to print](#scaling-to-print)
- [Comparing two versions](#comparing-two-versions)

Read this with [the core skill](../SKILL.md) for a still, and for the focal
preset any piece may use. A film reads [films](films.md) instead for its looks
and finish. For a brief that gives only a word, [find the idea](making.md#find-the-idea)
first: its concept, its logline and the designs you compare before seeds. A
brief that names its concept skips the search and starts at that concept's
postcard. A brief of one line gets the parts a film's
[treatment](films.md#the-treatment) names, a still being one shot: the format
and size from where it is seen (a screen, a print or a plotter;
[scaling to print](#scaling-to-print)), the view (angle, height, projection
or lens, framing), the staging, the light and time of day, the palette, the
style's marks and drawing order, and the final image.
[Find the idea](making.md#find-the-idea) says how the brief is read and
what goes under `Chosen, not given:`.

## Looks to leave out

A still's list of [looks to leave out](making.md#ask-which-looks-to-leave-out)
starts with these; the painter strikes or extends them when the brief leaves
it open and lists the change under `Chosen, not given:`:

- one noise family at every scale ([focal composition](#art-direction-preset-focal-composition));
- a grain pass over the finished frame instead of texture on each mark (same);
- a line that fades up through `globalAlpha` instead of arriving (same);
- a flow field around a focus that turns botanical ([traps](traps.md)).

## Art-direction preset: focal composition

Use this optional preset when a focal relationship suits the piece. A tessellation,
textile repeat or all-over field may deliberately give elements equal attention;
review that intention without imposing a focal point.

Review these compositional properties in rendered output:

**Place the focus, then weigh the void.** Put the subject near a third line or
a crossing of two, and keep horizons, dividing edges and the main mass off the
centre lines unless symmetry or division is the point. Two foci of equal pull
make tension; one low and centred settles; one high floats. The top of the
frame weighs more than the bottom. Keep the subject's box at least 5% of the
frame inside every edge, and text 10%, at every box the piece declares. Record
the subject's box in the state, and a test can check both at every box of
`boxes` with `atBox`.

**The subject owns the first attractor.** The eye goes first to motion, then
to the brightest value, then to the most saturated hue: whichever of them the
frame holds belongs to the subject, and nothing behind it moves more or shines
brighter. Keep most of the frame in middle values and spend the lightest and
darkest few percent on the focus, the lightest on its
[focal feature](materials.md#one-light-plan). A dark at the frame's edge, such as a near
bush or a bough, stays a step lighter than the focus's darkest accent: at the
same value it joins the focus as one group, and its larger area pulls harder.
Where subject and ground meet at one value,
separate them with a rim of light or a darker ground
([light roles](materials.md#one-light-plan)), and let no background
line pass through or touch the subject's outline.

**Hold three or four colours that span dark, mid and light.** Outside a named
style, pick one dark, one or two mids and one light, one of them the accent,
and derive every other colour from them by light, as
[materials and light](materials.md) says. The span carries the picture; more
hues add noise, not depth.

- **Lay the accent as stepping stones towards the subject.** Repeat it in small
  areas that grow in size and chroma as they near the subject, so the eye
  travels along them and arrives.
- **Same colour, same group.** The viewer joins every area that shares a
  colour, so one colour goes to things that belong together; a subject in the
  colour of what stands behind it joins that group and reads as one shape
  with it.
- **No complements at equal area and full chroma.** Two opposite hues of equal
  size and strength split the frame in two and leave the eye nowhere to land.
  Let one dominate in area and drain the other.
- **A distinction that survives greyscale survives every view.** Two hues at one lightness merge
  in grey, and so does a subject in the colour of its ground. Draw a test view
  with each colour replaced by the grey of its OKLCh lightness, and separate by
  value anything that vanishes there:

  ```js
  const { hex, oklch, rgb, toSRGB } = require('artifex/core/colour.js');
  // The grey with the colour's lightness and alpha: OKLab lightness cubed is linear grey.
  const greyOf = (c) => { const v = toSRGB(oklch(c)[0] ** 3); return hex([v, v, v, rgb(c)[3]]); };
  ```

  Add `--grey` to a seeds command to draw this view under each cell, and
  `--values` for its value masses
  ([value, greyscale and colour-vision views](../../../docs/knowledge/command-line-tools.md#value-greyscale-and-colour-vision-views)).
  Check: two tones meant to read apart differ by at least 0.2 in
  `oklch(c)[0]`, the floor [data images](data-images.md#colour-and-categories)
  set; steps of 0.1 or less blur together in grey.

**Make the focus the exception.** Keep the field regular in one or two
properties, such as shape class, speed, hue, value, size or spacing, and break
them only at the focus: one sharp form among round ones reads as an
exclamation mark.

**Point the picture at the subject.** Lines, masses and the empty space either
lead the eye to the subject or let it leave the frame. Judge them on the flat
masses below, in grey.

- **Converge on the subject.** Let roads, edges in perspective and the slopes of
  large masses run towards the subject, with their vanishing point at or just
  beside it. Lines that meet anywhere else take the eye there instead.
- **Give the masses three sizes:** one large, one middle and one small. Three
  of one size read as a row of props, and none of them leads.
- **Lay repeats along a curve that ends at the subject.** Stones, posts or
  windows set along a bend carry the eye in. The same marks in a flat row read
  as a fence across the frame that points nowhere.
- **Open the empty space onto the edges.** Keep it in a few pools, each touching
  an edge. A pool that masses close on every side becomes a shape of its own,
  a hole the eye circles inside.
- **Close the edge a line runs out through.** Where a bright path or a river
  leads out of the frame, put a dark near form with a cause there, such as a
  bush, a wall or a shadow, so the eye turns back. Keep it a step lighter than
  the focus's darkest accent.
- **An element that runs uncut from edge to edge cuts the frame in two, and
  the eye settles in neither half.** Painters end it inside the frame or
  overlap it with another form; they keep the full cut for a picture about
  division, where two halves are the point.
- **A frame within the frame is a cage.** A small subject in a lit opening in a
  dark wall reads as shut in or alone. Keep it for a picture or a beat about
  that.

**Give the frame one energy line.** Before placing the masses, draw one
gesture across the frame: it enters at an edge, turns twice and ends at the
subject. A straight lead reaches the subject in one move and leaves the ground
on either side of it empty; a line that turns carries the eye through the
whole frame and gives it stops on the way.

- **Seat a mass at each turn.** Put the largest mass on the outside of the
  first turn and a lesser one at the next, so each bend has something to turn
  against. Let the turns reach out to those masses: a line that wriggles in the
  middle of the frame leaves them standing beside it.
- **Press one edge and release the other.** Let the largest dark mass run off
  one whole side, top to bottom, so it pushes in from beyond the frame and only
  its inner edge shows. Kept against that side, it stops short of the far
  edge, so it does not cut the frame in two the way an uncut trunk does. Leave
  the opposite side open: that is the release, where the eye rests. A mass whole
  inside the frame shows its full outline, which becomes a second shape that
  competes with the subject. Pressing both sides squeezes the frame into a
  gap; keep that for a beat about being shut in.
- **Give every large area a job:** carry the line, press, release or set off
  the subject. Name the job of each, and merge into a neighbour or cut any area
  that has none. An idle area at a value near the line's reads as a second
  path.
- **Let the seed draw the line, then place everything from it.** Seed the
  entry, the turns and the subject, and derive each mass from the turn it sits
  at, so the composition holds at every seed; masses scattered by the seed
  touch or overlap at some seeds. `chaikin` from `core/geom.js` smooths the
  line but cuts inside each turn, by about a quarter of the way to the midpoint
  of its neighbours, so the line no longer reaches the masses seated there.
  Draw it through the seeded turns with `catmullRom(pts, samples)` from
  `core/geom.js` instead, which passes through every point, and keep the
  masses at the turns.
  To narrow the line towards the subject, fill it as an
  [`outline`](geometry-fields.md#variable-width-strokes) whose width shrinks
  towards that end.

**Block a still in flat masses first.** Before any texture, draw nine seeds as
the few largest shapes in flat values. Placement, balance and the void are
judged there; detail added later does not fix them. Over one of them, draw
the few lines that point at the subject and number the eye's stops: the
subject first, then each lesser accent in the order the eye reaches it, and
back to the subject. Move any stop that leads to an edge instead.

**Give every irregularity a cause.** Not one noise source standing in for all of
them. Keep them separate: *morphological* (the form itself), *gestural* (how it
appears to have been made), *material* (how the medium behaves), *compositional*
(where things sit), *temporal* (when things happen). One noise family at all
five scales produces recognisable algorithmic self-similarity. The hand shows
most where the picture is about something: the same roughness on every mark
reads as a filter, and the strongest hand-made cue set on the focus, quieter
elsewhere, reads as a choice. Draw the picture once with its expressive layer
left out: if nothing about its voice changes, that layer was noise.

**Texture belongs to the material, not to the frame.** A global grain pass over
a finished image treats every surface as though the same particulate process
affected it. Variation attached to the *mark* is more informative than variation
attached to every pixel. A film differs: its grain,
weave and print did touch every pixel, so declare them once as its
[finish](films.md#film-finish), over marks that keep their own texture.

**Texture's scale tells how big a thing is.** Few large repeats make a form
small and handmade; many fine ones make it large or far. Set each texture's
repeat from the size its form is meant to seem, keep forms meant to seem huge
fine and hazy, and stop a chunky texture before it eats the outlines it crosses, as
[texture scale](materials.md#texture-scale-against-apparent-size) says.

**Place things in depth from the horizon.** Decide where the horizon sits,
in the frame or beyond its top or bottom, before placing anything. On the
ground, a farther thing sits higher in the frame, nearer the horizon; in the
sky, a farther cloud or flock sits lower, nearer the horizon. Stand each
upright thing on its foot contact first and size it from there. In a level
view, a thing as tall as the eye's height has its top on the horizon wherever
it stands, so its height in the frame is the distance its feet sit below the
horizon; a thing half that tall stands half that distance high. Feet on or
above the horizon float. Check on the flat masses: draw the horizon, and every
standing thing of one size reaches the same share of the way from its feet to
it.

- **Open each level circle with its distance from the horizon.** A rim, a
  hole, a lid or a base on a level plane is a flat line on the horizon and a
  rounder ellipse the farther it sits above or below it, so a round thing below
  the horizon shows a base rounder than its top. A round part that is not level
  follows [marks that model form](#marks-that-model-form). Check: with the
  horizon drawn, each level ellipse's height over its width grows with its
  distance from the horizon.
- **An opening shows its far inner wall; a block that stands out shows its
  near side.** A window, a door, a hole or a cut in a face shows its depth as
  the inner wall on the side away from the eye: towards where the face recedes,
  the top inner wall above eye level and the bottom one below it. A block that
  stands out of a face, such as a ledge, a pillar or a sill, shows the sides
  that face the eye instead. Drawing both inner walls, or the near one, turns
  an opening into a block. One receding line inside a doorway is enough to say
  a space lies beyond it. Check: on a frame, name the visible inner wall of
  each opening and the visible side of each block, and each lies on the side
  named above.
- **Build every made thing from one projection.** Derive every receding edge
  of boxes, roofs, doors and paths from one projection in `build`: an angle
  chosen per object gives each box its own space, and the place stops reading
  as one. A stylised piece bends its forms and keeps their receding
  directions. In a level view, keep every vertical edge vertical and
  send each family of parallel level receding edges to one vanishing point on
  the horizon. A sloped family, such as a gable's rake, a ramp or a stair's
  nosings, meets above or below the horizon, on the vertical through the
  vanishing point of the level edges it rises from. An axonometric view keeps
  each family parallel instead. Check: in `build`, extend each family's edges:
  they meet within a few design units of one point, a level family's at the
  horizon's height (`HORIZON` in
  [the film scaffold](films.md#camera-and-framing)) and a sloped family's
  within a few design units of its level family's vanishing point in x; every
  vertical edge is within half a degree of vertical.
- **Keep vanishing points far apart.** In a two-point view, put both outside
  the frame. Brought together, they skew the nearest box like a fishbowl, so
  keep that for a beat that wants distortion. This narrows *converge on the
  subject* above: a vanishing point at or beside the subject belongs to a
  one-point view; in a two-point view, aim the receding edges towards the
  subject while both points stay outside the frame. A film widens its space by
  spreading its layers' depths, as [a lens](films.md#camera-and-framing) does,
  not by moving them together. Check: the two edges that meet at the nearest
  box's near corner, top or bottom, make an angle wider than 90 degrees.

**Run every depth cue one way.** Decide for the scene which way each cue runs
from near to far, and run them all that way: value towards the air's
([aerial perspective](materials.md#aerial-perspective)), warmth towards cool
unless a low sun or lit mist warms the distance, texture from coarse to fine
([texture scale](materials.md#texture-scale-against-apparent-size)), and size
from large to small. A far thing that is darker, warmer, coarser or larger than
a nearer one of its kind, against the scene's choice, jumps forward and reads
as a small near thing. Check: along a line from the nearest thing to the
farthest, on the `--grey` view, each cue steps the way the scene chose; a step
back is the far thing that jumps forward.

- **Overlap decides when cues disagree.** Overlap outranks size, height in the
  frame and value: a small form in front of a vast one still reads nearer. A
  surprise of scale, such as a vast far form behind a tiny near one, holds only
  while the overlaps agree with the planned order. Check: on the flat masses,
  in each overlapping pair the form painted in front is the one the plan calls
  nearer, and a vast far form is overlapped by a nearer one on at least one
  edge.
- **Tie each thing off the ground with an overlap or a cast shadow.** A thing
  that flies, hangs, hovers or is thrown, overlapping nothing and casting
  nothing, floats at no depth. Give it an overlap with something at a known
  depth, or a shadow on the surface under it; a thing at rest follows
  [everything stands on something](films.md#what-every-scene-holds). Check:
  for each thing off the ground, name the overlap or the shadow that fixes its
  depth.
- **Keep outlines from continuing or grazing.** Two forms whose edges line up,
  or whose outlines run along or touch each other, merge and lose their order.
  Move one until it clearly overlaps the other, its outline stopping on the
  other's in a T, or clearly stands apart. This holds for every pair of forms,
  not only for a background line against the subject's outline. Since a graze
  comes by chance at some seeds, test it on outlines kept in the state: walk
  `resample(outline, 1, true)` from `core/geom.js`, and more than 4 points in a
  row within 1 design unit of the other outline, by `closestPointOnSegment`,
  is a graze. Closeness misses a continuation: an edge that butts end to end
  onto another, two corners that kiss, or two straight edges in line across a
  gap. So also count as a graze an outline's corner or end within 1 design
  unit of the other outline where the two do not cross, and a straight edge
  whose extension, within 40 design units beyond its end, comes within 1
  design unit of a straight edge of the other outline running within 3 degrees
  of parallel to it. Check: over 100 seeds, retry each grazing layout
  [by address](making.md#vary-with-intention) and report how often `k > 0`.

**A rendered frame around each planned contact shows what invariants cannot:**
whether layering and occlusion made the picture planned.

**Prefer five excellent marks to fifty equivalent decorative ones.** Detail and
contrast should fall away from the focal relationship. Giving every element the
same detail and contrast can weaken visual hierarchy.

**A line that arrives reads as drawn; one that fades up reads as placed.**
`globalAlpha = progress` is a finished line
fading in, not a pen moving, and the difference is most of what makes a drawing
read as drawn.

**A mean can hide changes in a small mark.** A large local change may contribute
little to a frame-wide average. Pair each mean with the largest single-cell
change.

**Seed robustness is the real test.** A system is not good because it accidentally
produced one beautiful seed. Render nine and look at all of them.

## Colour by its modifiers and medium

Write each colour as three parts before choosing its value: its hue family, its
modifiers and its medium. "Blue, pale and greyed, as light" sets a mood; "blue"
alone does not. The modifiers and the medium carry more of the mood than the
hue family does, so settle them first and let the palette decide the hue.

**The modifiers move the mood.** Each is a step in OKLCh lightness, chroma or
hue, or in alpha:

- **Paler reads weaker or innocent.** Lifting a hue towards white takes its
  force away: a pale form reads as gentle or harmless beside the same hue at
  full depth.
- **Darker adds weight.** Lowering lightness makes a hue heavier and more
  serious, and a dark area weighs more in the frame than a light one of the
  same size.
- **Greyed reads subtle and mature.** A hue with its chroma drained holds back
  and reads as restraint, age or calm. Drain the chroma alone, as
  [the library notes](library.md#colour-and-tone) shows, so the
  value stays where the composition put it.
- **Full chroma over a large area is loud and tiring.** It wears the eye out
  within seconds and leaves the focus nothing to rise above. Spend full chroma
  on small areas, and give a large area a drained or darkened version of the
  hue.
- **Warmer comes forward, cooler steps back.** A warm shift reads as near and
  active, a cool one as far and still; move temperature with the beat, not
  with each object.
- **Transparent or faded reads as force lost.** A colour that lets the ground
  show through, or has faded towards the ground, reads as weakened, passing or
  remembered rather than present.

**Decide whether the mood lives in a surface or in the light.** One hue says
different things by its medium:

- **As an opaque flat area**, such as a painted panel, a cloth or a sign, the
  hue is a statement: deliberate and present, and at full chroma an alarm.
- **As light**, such as a wash over the frame, a low sun, a backlight or a
  glow, the hue is atmosphere or memory: it tints everything it reaches and
  belongs to nothing in particular.

Choose one medium to carry the mood and keep the other near neutral; a strong
hue in both reads as two moods at once. A frame meant to feel like a recalled
afternoon puts its amber in the light and keeps the surfaces greyed; the same
amber painted flat on one panel makes that panel the point of the frame.

## Shape language

Give each element a shape class: round, straight or sharp. Round reads as easy
and free, straight as stable and calm, sharp as tense and dangerous, and sharp
draws the eye first. A crowd of marks reads by its outline as a whole, so judge
a group's class by its silhouette, not by its members.

- **Echo or oppose the place.** A subject whose class the place repeats is at
  home; one the place opposes is under threat. Decide it per scene.
- **Pick the dominant line.** Horizontals rest, verticals stand in tension,
  diagonals are the most intense: keep diagonals for the peak.
- **Show an inner change as a change of class** between beats: a round form
  that sharpens, a sharp one that softens.
- **Make the class a parameter.** Declare one, such as `edge` from 0 (round)
  through 1 (straight) to 2 (sharp), that moves corner radius, vertex angle
  and bulge together, and sweep it with `--param edge` to see all three
  readings at one seed.
- **Let the place carry the arc.** A place's class can change with the story,
  so the world's shapes show the turn, not only the subject's. Read the class
  from the seconds, or from the position along a path, with `keys` from
  `core/time.js`, whose keys take either unit: a street of square blocks whose
  corners round over as the subject opens says the change reached everything
  it sees. `keys([[0, 1], [12, 1, ease.inOut], [18, 0]])(sec)` holds the place
  straight until 12 s and rounds it by 18 s. Move the class only across a turn
  in the beat sheet and hold it between turns: a class that drifts through a
  beat that changes nothing reads as an error, not a turn. Check it twice.
  While you design the place, keep its class as the `edge` parameter and
  sweep it with `--param edge`, then key only values whose readings differ.
  Then draw a time strip, `npm --prefix "<library root>" run seeds -- "./my-piece.cjs" --frames 9`: the
  class changes on the cells that span the turn and holds on the rest.
- **Tell the relationship with glyphs first.** Before drawing the leads, draw
  each as one shape of its class, such as a circle, a square or a triangle,
  at the size, place and tilt the lead will have. If the glyphs alone show
  who leads, who threatens and who belongs together, the drawn leads will
  too; where they fall short, a changed shape, size or place fixes now what
  added detail will not. A reviewer started without this work's context,
  shown only the glyph frame and asked who leads whom, as in
  [comparing two versions](#comparing-two-versions), tells whether the glyphs
  carry the relationship you planned, which your own glance cannot; the same
  question on the finished frame tells whether detail broke them.

Sound can share the class of its cause; see the
[sound reference](sound.md#voices-a-place-and-a-room).

## Line weight

A line of one width reads as a diagram: it traces where an edge is but says
nothing about the form behind it or the hand that drew it. Unless the style
is a constant pen, such as a plotter, a technical drawing or a monoline
lettering, give each line that defines a form a width that follows these points.
Draw it as a filled outline with `outline(pts, width)` from `core/path.js`,
since a canvas stroke has one width per path; see
[geometry and fields](geometry-fields.md#variable-width-strokes).

- **Swell where the gesture presses, taper at the ends.** A drawn line is
  widest where the hand pushed hardest, at the turn that carries the form or
  where a weight rests, and toward the middle of a long arc. It thins to its
  ends, so lines meet and overlap without a blunt join. A cup's rim, for
  example, swells along its front curve and thins where it turns away.
- **Scale the width with the form's size on screen.** A form drawn at half
  the size gets about half the width, so a small far form does not clot into
  a dark blot and a large near one does not look drawn with a hairline. Write
  the width as a share of the form's size, not as a fixed number.
- **Give the nearer part the heavier line.** Weight reads as nearness. On a
  form that turns toward or away from the viewer, such as a cylinder seen end
  on or a limb that points out of the frame, thicken the line on the near end
  and thin it on the far end, and the form gains depth with no shading.
- **Give each class of line its own quality.** The outer silhouette carries
  the heaviest line; edges inside the form, such as a fold or a seam, a
  lighter one; texture marks the lightest. A hard part can have a crisp,
  even line and a soft part a broken or wavering one. When every line has
  one quality, the parts merge into one flat shape.
- **A dark of the local colour can replace black.** A black line around a
  coloured fill cuts the shape out like a sticker. A line in a darker shade
  of the fill's own colour, or a dark grey, keeps the line part of the form
  and lets the colour carry it. Keep pure black where the style asks for ink.
- **A line that changes between frames is a defect unless you declare it.**
  In a film, a line redrawn with new randomness on every frame shimmers, or
  boils, and the shimmer reads as noise. When a held drawing should boil on
  purpose, make a few variants of the line, each addressed by its index, such
  as `R('rim', 'boil', k)` for `k` from 0 to 2, and cycle through them at a
  fixed rate, such as a new variant every two or three frames. Say in the
  source that the boil is intended.

Check line weight at 100% (`--loupe`): a swell that reads in the full frame
can vanish under a pixel at the size a form is drawn, and a taper can end in
a stub.

## Marks that model form

In a line or mark style, a few drawing conventions tell the viewer the form's
depth and turn without a painted gradient. They work in any style that draws
lines over paper, and with [one light plan](materials.md#one-light-plan).

- **A fold's back edge ends on the near edge in a T.** Where a surface folds
  or tucks over itself, the edge that goes behind stops on the edge in front;
  run through, it reads as a surface seen through the near one. Check at
  100%: no hidden edge crosses a near one.
- **Cross-contours open with depth and bow the way a part points.** A line
  across a form, such as a band, a seam, a ring or a row of shading marks,
  curves around it. On a round part seen above or below eye level, its
  ellipse opens the further it sits from eye level; on a part that points at
  the viewer, the curves bow toward the viewer. That change along the part is
  perspective: an orthographic or weak-perspective view shows a straight part
  with one ellipse along its whole length, opened only by the view's pitch,
  which reads as stacked stripes on a large or near form and passes on a small
  or far one. To open each by its own section's direction from the eye (on an
  upright part, its height from eye level), lay them with `crossContours`'
  `eye`
  ([cross-contours](../../../docs/apis/piece-api.md#cross-contours)). Check a
  frame: no two cross-contours on one part are the same ellipse unless the
  part sits level with the eye or the view is orthographic.
- **Shade with marks set close but uneven.** Cross-contours and other
  modelling marks gather closer and heavier toward the shade side, bunch where
  the form turns or foreshortens, vary in spacing, length and weight, and
  leave a few gaps; together they read as the shading. A row of equal, evenly
  spaced marks reads as a comb or as hatching: the eye sees the pattern before
  the form, and the turn flattens into stripes. Choose that even row when the
  regularity is the look, as in pen or ink hatching laid as the style's tone,
  an engraving, a technical drawing or a printed screen; the form then turns
  through where the hatch starts and stops, its angle and its layers. Check at
  100%: where the marks are meant to model the form rather than lay a hatched
  tone, no run of shade-side marks keeps one spacing.
  A painted sheet can count this for you: `medium({ ..., log: true })` keeps
  every stroke and paint call, and `sheet.monotony()` scores how alike their
  length, direction, width, pressure and brush settings are
  ([the stroke log](../../../docs/apis/medium.md#the-stroke-log)).
  `npm run still` prints it under every PNG it saves of such a piece; read it
  after each render. It judges nothing.
- **Show texture at the silhouette and in a few patches.** Give the outline
  the texture's bumps or breaks, and lay a few patches inside, in the
  [half-light](materials.md#texture-in-the-half-light), each foreshortened
  with the plane it sits on. Leave the rest of the surface plain. Texture
  spread evenly over a form flattens it.
- **Lay a narrow dark band on the far form at every overlap.** Where a near
  form crosses a far one, darken the far form in a band against the near
  outline, about one to two widths of that outline. A wider band, or one with
  a gap of paper before the outline, reads as a separate shape.
- **Break a pattern at every fold.** Stripes, checks or spots on a surface
  shift where it folds or creases, and between folds follow the
  cross-contours. A pattern that runs straight across a fold reads as printed
  on top.
- **Run shadow hatching one way, along the light.** Straight hatching that
  marks shadow takes one angle across the frame, set from the key's direction,
  so every shadow reads as cast by one source. Rows of cross-contours follow
  their form instead. Crossed layers darken a shadow at the depth the style
  sets; the first layer keeps the shared angle. Check a frame: every first
  layer of straight shadow hatching runs at one angle.
- **Break a backlit outline where the light spills.** With the key behind a
  form, leave a gap in the outline on its lit edge, where the
  [edge light](materials.md#texture-in-the-half-light) eats it. An unbroken
  outline there puts the form in front of the light.
- **Give layered screens one pitch and one angle.** Dot tones or other
  printed screens laid over one another share both; a second pitch or angle
  makes moiré. Hand hatching may cross at a new angle.
- **Spend modelling by shot role and size.** The lead and the near forms get
  the full set: cross-contours, hatching, overlap bands and texture. Far and
  supporting forms get an outline and one shade. Check at thumbnail size: no
  supporting form carries more marks than the lead.

## Paint in masses, values and edges

In a painted style, build the picture in the order a painter does: the big
masses, then each one's light and shade, then value groups and temperature,
and edges and detail last. Judge each step before the next, since a later
step does not fix an earlier one. The style sets its marks and how hard its
edges run; this section sets where each goes. Where a style's guide sets edges,
modelling or stroke density, the guide wins and each check below follows it:
a flat gouache style keeps most edges crisp and its planes flat,
so it is judged on its value groups and focus, not on soft shade edges or a
split on every form; an impasto style lays many overlapping
dabs, so its stroke check counts the strokes on a plane by their size, not
their number. A style with no cast light, such as
ink-wash painting, skips the split into light and shade and
the temperature shift, and sets tone by nearness and importance, as its guide
says. The value view is `--values`
([value, greyscale and colour-vision views](../../../docs/knowledge/command-line-tools.md#value-greyscale-and-colour-vision-views)).

`--readout` adds each level's share of the frame and a 120 px thumbnail beside
its three values, a quick way to see how the masses divide and whether the
subject survives small. The shares describe the picture; no split is the right one.

- **Block the big masses, then split each into light and shade.** On the
  [flat masses](#art-direction-preset-focal-composition), under a directional
  light, give each large form one light value and one shade value, divided
  along its terminator, before any halftone or texture. Under an overcast sky
  there is [no terminator](materials.md#form-tones-ratio-occlusion): block
  each form's planes by how far they face up instead. Join the shade sides of forms that touch
  into one shape: a shade painted part by part breaks one form into pieces.
  Check on `--values`: each large lit form's shade side is one connected
  area, not a scatter of spots.
- **Gather the values into three to five groups.** Every area joins one
  group, however many local colours it holds; a colour that changes inside a
  group changes hue or chroma and keeps the group's value. Neighbouring groups
  differ by at least 0.2 in `oklch(c)[0]`, the
  [greyscale floor](#art-direction-preset-focal-composition). Keep the light
  family apart from the shade family: the lightest note in shade, reflected
  light included, stays darker than the darkest halftone in light, in the
  order [the form's tones](materials.md#form-tones-ratio-occlusion) give.
  Check: with three groups, `--values` shows the frame as a few large shapes
  per level, not a scatter of small spots. `--values` cuts its blurred
  lightness at fixed levels, L 1/3 and 2/3, so keep each group's value clear
  of both cuts: a group near a cut breaks into spots there, and two groups on
  one side of a cut merge into one level. When a group sits near a cut by design, or
  for four or five groups, judge the `--grey` view by eye at
  thumbnail size and name each large area's group: an area you cannot place
  sits between two groups, so move it into one.
- **Keep an edge hard where the form turns sharply or the eye is meant to land, and
  soften or lose it where the form turns gently or falls into shade.** A
  corner, a cut and the focus get hard edges; a round form turning away, a
  form passing into shade and a far form get soft ones. Where two neighbours
  share a value group, let their boundary vanish for a stretch: the eye
  completes the shape from the rest of its outline. An edge lost at the focus
  loses the focus, and a silhouette lost past where its shape reads loses the
  form; where the subject meets its ground at one value, separate them as
  [the subject owns the first attractor](#art-direction-preset-focal-composition)
  says. Check on a `--loupe` crop of the focus and one of a shade side: at the
  focus the value changes within one or two pixels, on the shade side it grades
  over several, and at least one stretch of an outline away from the focus is
  lost. Edges equally hard everywhere read as cut paper; equally soft, as out
  of focus. One cheap way to soften or lose a stretch is `soft` from
  `artifex/styles/kit.js`: it paints a box at about 0.2 to 0.35 of the frame's
  pixels and lays it back smoothed, so edges inside grade over about
  1 / scale pixels. Repaint the ground and the form in it, fade the patch at
  its rim only when `draw`'s second argument says it paints the buffer (an
  SVG has none, so it gets the box clipped and sharp, and a fade there would
  throw), and lay the paint's texture after it: the texture stays crisp
  across the lost edge, so it reads as paint, not as a blur over the frame.
  A painter may instead match the two values exactly or scumble across the
  edge.
- **Shift temperature between light and shade, not only value.** In a style
  with colour, each shade plane takes the colour of what it faces, as
  [shadow colour by facing](materials.md#shadow-colour-by-facing) sets: under
  a warm sun a plane facing the open sky turns cooler and one facing the lit
  ground warm, and a shade under a partly cloudy sky is greyer. Take the
  colours from [one light plan](materials.md#one-light-plan). A shade that is
  only its local colour darkened, with nothing it faces mixed in, reads as
  dirty. Check with `--sample` on a strip: for a point in the light and one in
  the shade of one form of one local colour, their hue difference, taken the
  short way round the circle (`h` 3 and 357 differ by 6), exceeds the spread
  of hues among a few points sampled inside the light; on a near-grey local
  colour, where `h` can be `null`, compare `a` and `b` instead. The same hue
  at a lower `L` is the failure.
- **Lay few strokes, each at its final value.** State a plane with one or two
  sure strokes and leave them: many short, faint strokes along one edge or over
  one plane read as hesitation. Size each stroke from its mass, the largest the
  style allows for a big mass and smaller only towards the focus. Count a mark
  as the viewer sees it: a wash built of many faint layers is one mark. This
  sharpens [five excellent marks](#art-direction-preset-focal-composition).
  Check on a `--loupe` crop: each change of plane carries one or two strokes,
  no edge is a fringe of short overlapping strokes, and strokes grow larger
  away from the focus.
- **Spend detail only at the focus.** The finest marks, the hardest edges, the
  strongest value step and full chroma meet there; every other area stays in
  its masses, as [spend modelling by shot role and size](#marks-that-model-form)
  sets. Check: on `--values`, the ring on the peak value step sits at or beside
  the planned focus, and at thumbnail size no area outside the focus carries
  more small marks.

## Scaling to print

A print-resolution still is drawn like the page, through `drawFrame` on a real
canvas, at `scale: 8` or higher. **Not capped.** From a shell,
`npm --prefix "<library root>" run still -- "./my-piece.cjs" --scale 8` saves
it beside the piece as the page's PNG button does; for where `./name` paths
resolve, see [start here](../SKILL.md#start-here).

**Soft-proof a still bound for paper.** Ink cannot show the most saturated
sRGB hues, and a printer clips them, which can shift their value or hue.
First add `--gamut` to a seeds command with the path of Fogra's `FOGRA39L.txt`,
which Artifex does not ship; download it from the
[ICC characterization data registry](https://registry.color.org/cmyk-registry/fogra39). For example,
`npm --prefix "<library root>" run seeds -- "./my-piece.cjs" --at 0 --gamut "./FOGRA39L.txt" --json`. The
[print-gamut view](../../../docs/knowledge/command-line-tools.md#print-gamut-view)
paints magenta each pixel outside an approximate gamut of offset printing on
coated paper, and `--json` gives each cell's `gamut.share` outside and
`gamut.excess`, the largest distance of an outside pixel from the gamut. The view
approximates one generic press, not your printer: when the printer is known,
also open the PNG in an image editor with that printer's profile and its gamut
warning on; it settles a colour the generic view flags with an `excess` under
0.03 (see the view's limits). Bring each other flagged colour in by chroma alone
with `drain` from [the library notes](library.md#colour-and-tone),
so lightness and hue stay. Check: the `--gamut` view's magenta marks lie outside the
subject, or `gamut.excess` is exactly 0 (a rounded `gamut.share` of 0 can still
hide a few outside pixels); the printer's gamut warning flags nothing in
the subject when its profile is known; and the `--grey` view of the drained
piece matches the original's.

Do not multiply every stochastic frequency by the scale.
Macro composition must be invariant under resolution; only micro-detail
bandwidth may rise with it.

`inversion.js` reads the surface's `getTransform()` to stop circles below a
1.4-pixel diameter. Larger PNG exports add smaller circles without moving shared
geometry. `VectorSurface` and the benchmark null surface expose detached numeric
`{a,b,c,d,e,f}` snapshots through `getTransform()`, without `DOMMatrix` methods.
Ordinary SVG export uses identity scale and retains the design-resolution cutoff;
surfaces without a reader use scale 1. That cutoff ends each chain; a radius floor
at or above it keeps the tree within 24,573 circles, so a higher scale only adds
smaller circles. See [output formats](../../../docs/knowledge/output-formats.md)
for that limit.

## Comparing two versions

Whoever made a change sees the change they meant, so to choose between two
renders of one piece, a subagent started without this work's context judges
them as below: which reads better on one named region, and what a free list
turns up. One render, or a difference a number measures (`seeds --compare`, a
pixel read), needs no reviewer. Each reviewer costs a subagent run.

- **Give it only images.** Two PNGs from the same seed, size and frame, saved
  under neutral file names and labelled `A` and `B`. Swap which version is `A`
  between reviewers. A reviewer that sees code, scores, an ordering file name
  or which version is current judges the change it was told about, not the
  picture.
- **Name one region.** Say where to look in words or as a crop (`--loupe x,y`
  gives the same 100% crop of each), and ask one question about it, such as
  which edge is cleaner or which reads as the nearer surface. A whole-frame
  question gets a whole-frame impression that hides the difference you changed.
- **Compare pairwise.** "A or B on this region" is more reliable than ranking
  three or asking for a free list. Ask for the choice, the reason in terms of
  what is visible, and its confidence. Treat a reason that is not about the
  region you named as no answer to it.
- **Use a free list to find gaps, not to decide.** "What is missing or wrong?"
  surfaces problems you did not think to ask about. Turn each one into a
  pairwise question on its own region before changing anything.
- **Agreement is not proof.** Reviewers of the same model share blind spots, so
  three that agree are one signal, not three. Weigh a reviewer above a
  measurement for an artifact or a feature too local for a number to see (a
  halo, a stray mark, which way a figure looks), and a measurement above a
  reviewer for a global amount (colour, line weight, texture).
- **Score a replica by measurement.** How close a
  [replica](replica.md) sits to its reference is a global
  amount: read `seeds --compare`'s `off` and `worst`, and ask a reviewer only
  about a local feature the numbers miss.
- **Check a visual claim before acting on it.** Eye claims about a thin
  line, a corner or a shade are often wrong. Open the same spot as a 100% crop
  (`--loupe`), then read the pixel's colour from the saved PNG with a short
  script. Change the piece only when both agree.
- **A new reviewer each time**, as in the
  [fresh-eyes review of a film](films.md#fresh-eyes-review).
- **Show a reviewer less before more.** A fresh reviewer who first sees the
  still small and in grey (`--grey`), says what it shows and where the eye
  goes, and only then sees it whole, tests the masses and the focus before
  colour and detail can carry them. Each answer is written down before the
  next view, and before the reviewer is told what the picture is meant to
  be: an answer given after the intent is known is agreement, not a reading.
- **Look once for what the picture says by accident.** Two dots over a
  stroke are a face, a row of even upright bars is a barcode or a fence, a
  shape cut by the frame at a joint is a missing limb. A fresh reviewer
  names these at once and the maker, who knows what each mark is, does not
  see them.
- **Two design alternatives that share a skeleton are one design.** The
  comparisons above are between two finishes of one picture. When the
  question is which picture to make, alternatives set side by side small
  and in grey with the same big shapes, the same path for the eye, the same
  focus and the same proportions differ in finish only, as
  [two lines that differ only in amounts](making.md#look-at-nine-seeds) are
  one picture. A real alternative moves the skeleton or the path.
