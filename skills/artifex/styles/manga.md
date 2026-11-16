---
type: knowledge
summary: "How to draw manga's marks with the functions in manga.js (pressure pen lines, screentone, hatching, speed and focus lines, bursts, panels, balloons, held drawings), and how manga and the animation drawn from it are composed, valued, paced and moved; read before making a piece in manga."
related_files: ["skills/artifex/styles/manga.js", "skills/artifex/styles/kit.js"]
---

# Manga

## Contents

- [What makes it read as manga](#what-makes-it-read-as-manga)
- [Marks](#marks)
- [Creative direction](#creative-direction)
- [Palette](#palette)
- [Pitfalls](#pitfalls)

Japanese comics: black ink on white paper, printed in one colour, read as a
sequence of panels. Every grey is printed dots or drawn lines, and motion,
sound and feeling are drawn as marks on the page. Moving, as in anime drawn
from it, the style keeps its drawings held for several frames.

## What makes it read as manga

- Lines are pen lines with pressure: they enter on the point, swell and leave
  on the point. Outlines are heavier on the near side and on what matters,
  thinner on what is far. One-width outlines read as a vector drawing.
- No flat grey. Mid-tones are screentone, round dots on a regular grid at
  45 degrees, or hatching, rows of short tapered strokes. Flat grey fills
  read as a cartoon.
- Solid black (beta) is a deliberate shape: hair, a night sky, a shadow, a
  mood. Where a line crosses black or tone, a thin white edge keeps it apart.
- Force and motion are drawn: speed lines, focus lines, bursts and impact
  frames, rather than blur.
- When the piece is a page, panels with ink borders and white gutters order
  the reading, and balloons carry speech. A single frame or a film can drop
  both and keep the rest.
- Moving, drawings are held for two or three frames, and the camera moves
  over held drawings more than the drawings move.

## Marks

Lay them in this order: paper, black, tone, hatching, lines, effect lines,
then panel borders and balloons over all.

- `paper(g, R, w, h, { colour, specks })`: flat off-white, `#f6f4ee`, with a
  few printed specks; `specks: 0` for a clean sheet.
- `pen(g, R, name, spine, opts)`: one dip-pen line along the points `spine`,
  as a filled outline whose half-width is `w / 2 x press(t)`. Pressures in
  `PRESS`: `both` enters and leaves on the point, the pen's own line; `out`
  starts pressed and lifts to a point, for hair, a flick or a trail; `in`
  lands pressed; `even` is a ruled line. `w` from 1 for far detail to 6 for a
  near contour; `wobble` 0.1 is a steady hand, 0.3 a quick one; `smooth`
  rounds the spine with Chaikin passes; `halo` first strokes a paper edge that
  many units wide, so the line reads over tone or black.
- `beta(g, outlines, { halo })`: solid black for each outline. Keep black for
  a few shapes; it should be a decision you can name.
- `screentone(g, area, { value, pitch, angle, ramp })`: printed dots clipped
  to an outline or a list of them. `value` is ink coverage: 0.05 a pale tint,
  0.2 a shadow, 0.5 a dark grey; past about 0.75 the dots merge. `pitch` 4 to 8
  units reads as print at film size; below 3 it becomes a flat grey in the
  encoded film. `ramp: { from, to, value }` grades the tone between two points,
  for skies, light falling off and emotional backgrounds. Keep one `angle`
  per piece, as one printer's screen, and one `pitch` where screens overlap;
  a second angle or pitch over the first makes moiré.
- `hatch(g, R, name, area, { layers, angle, pitch, len, w })`: hand hatching,
  rows of short strokes tapered at both ends, laid like bricks. `layers` 1 for
  a soft shade, 2 crossed for a shadow, 3 for the deepest; only strokes whose
  ends both fall inside the area are drawn, so no stroke ends on a cut.
- Where tone or hatching meets white, grade the edge through a band unless
  the light is hard: a `ramp` that falls to 0 toward the edge, or each extra
  hatch layer in a smaller area than the one under it. A field cut off on one
  line looks pasted on.
- Model a form with [marks that model form](../reference/stills.md#marks-that-model-form):
  shadow `hatch` at one `angle` along the light, a narrow band of `hatch` or
  dark `screentone` on the far form at each overlap, laid up to the near
  outline with no white edge, and cross-contour `pen` lines that open with
  depth. The band is tone, not one of the few `beta` shapes.
- `speedLines(g, R, name, box, { angle, count, w, reach, clear, path })`:
  tapered lines across a box along the motion. `clear: [cx, cy, r]` leaves a
  round lane where the moving thing is. `path`, points along a turning
  motion, bends every line with it; a line inside a turn tighter than its
  offset is left out. Behind a subject drawn sharp, they say the camera
  follows it; over the subject, that it moves past.
  - Set `count` from the speed: more lines read faster, so a mover that
    speeds up gains lines.
  - For speed lines, keep `reach` long so each line thins over a long run;
    short stubs that end abruptly carry little speed. (The haze of short
    marks under Effect backgrounds is not speed and uses short reach on
    purpose.)
- `focusLines(g, R, name, cx, cy, box, { r, count, w, jitter })`: lines that
  run in from beyond the box and stop short of a point, thick outside and
  pointed inside. They pull the eye to the point: a reveal, a realisation, a
  stare.
- `burst(g, R, name, cx, cy, r0, r1, { spikes, reach })`: black from `r1`
  outward, split by white spikes from a white core: a shock or a shout.
- `panel(g, outline, { w, fill })`: a panel border at one width, 2 to 4 units,
  mitred, after filling the panel with paper.
- `balloon(g, R, name, cx, cy, rx, ry, { kind, tail })`: `speech`, `shout` or
  `thought`, filled with paper and outlined with a pen line. Text inside comes
  from the stroke font, in capitals or lower case.
- `impact(g, w, h)`: inverts everything drawn so far, ink to paper, for a frame
  or two at a hit. Raster only.
- `held(seconds, every, fps)`: the time and index of the drawing a moment shows
  when each drawing is held for `every` frames, from seconds and a rate;
  `drawingAt(clock, every)` in `core/time.js` answers the same from the clock.
  Draw from `held(...).seconds`
  instead of the playhead to animate on twos or threes, with the camera still
  on ones ([twos under a moving camera](../reference/films.md#pace)). Address hand wobble by
  the drawing's index, `name + index`, so lines boil between drawings and stand
  still within one.
- `shake(R, name, index, amp, from, settle)`: a camera offset that jumps on
  each drawing after a hit at drawing `from` and dies out over `settle`
  drawings.

## Creative direction

**Where it comes from.** Postwar Japanese comics, shaped by Osamu Tezuka's
cinematic layouts in the late 1940s and 1950s, and printed cheaply in black
and white in thick weekly and monthly magazines. Artists ink with dip pens,
brushes for black, and adhesive screentone sheets cut and scraped by hand.
The magazines' audiences gave the main genres their own habits: action
(shonen), romance and inner life (shojo), and adult drama (seinen and the
realist gekiga of the late 1950s).

**What it shows.** Anything at all, from sport and cooking to war and
loneliness. Its habit is to show feeling directly on the page: a background
that turns to tone, flowers or black when a character feels something, a
face reduced to a few lines for a joke. Quiet everyday detail is as much its
subject as action. It rarely uses colour, except on opening pages.

**Figures and faces.** Manga is carried by its characters, so they get the
most ink.
- A body is one closed contour per form in pen lines, continuous across the
  joints, heavier on the outside edge and where it overlaps, rather than
  single strokes for limbs
  ([paint over a hidden mannequin](../reference/films.md#paint-over-a-hidden-mannequin)). Hair is a mass, often
  solid black with white highlight streaks.
- A character reads by silhouette first: one distinct shape of hair, clothes
  or prop, kept the same in every drawing.
- Faces simplify toward the eyes. Expression has a shared shorthand (manpu):
  a sweat drop for unease, hatched cheeks for a blush, vertical lines over the
  brow for gloom, a cross-shaped vein for anger, a face reduced to dots and a
  line for a joke.
- Poses push: lean, twist and a clear line of action through the body. A
  stiff upright figure reads as a diagram. For walking and running, see
  [walks and runs](../reference/films.md#walks-and-runs).

**Composition and framing.**
- The page is the unit, read right to left and top to bottom in Japan. Panel
  size is time and weight: a wide panel holds a moment, a thin one passes it.
- Cut close: eyes, hands, a foot landing. Then pull out to a wide panel that
  sets the place. The change of distance is the rhythm.
- Break the frame for force: a figure or a line that runs over the border.
  Remove borders for memory, dream or a feeling that has no edge.
- Tilt panels and the camera for chaos; keep them square for calm.
- Leave silent panels with no words, a held look or an empty room, to give a
  beat of time.

**Value and light.** High contrast, with three levels doing most work: paper,
one or two tones, black. Black sets mood and night; tone sets air, shadow and
emotion; white is light, emptiness or shock. Light is often not literal: a
face lit by a gradation tone because the moment is tender.

**Effect backgrounds.**
- Open each place with the place drawn, so the viewer knows where and when.
  Spend effect backgrounds (lines, tone, pattern) only on beats of feeling or
  speed, then return to the drawn place. Too many make the work look thin.
- An effect background over a faint, still-moving trace of the place keeps
  the figure somewhere; a blank ground floats it. To isolate a figure, manga
  drains the place to a narrow pale range instead of removing it.
- Give each feeling one mark family and one direction, and keep it for the
  whole film so the viewer learns it: lines hanging from the top edge for
  gloom, focus lines or radiating flashes for a realisation, swirls for force
  welling up, a haze of short marks for burning intensity.
- Build each family from the functions above:
  - Lines hanging from the top edge: one `pen` line per column from the
    panel's top edge `[x, top]` straight down, `press: PRESS.out` so it starts
    pressed at the edge and lifts to a point, with seeded lengths from a third
    of the panel's height to most of it. `pen` does not clip, so the lines
    stay inside the panel only because they start at its edge.
  - Swirls: `speedLines` with `path` set to a spiral's points, so the lines
    curl beside it, each at its own offset (a line inside a turn tighter than
    its offset is left out).
  - A haze of short marks: two or three `speedLines` calls over one box at
    angles about a radian apart, each with a short `reach` such as
    `[0.02, 0.05]` and a high `count`. One angle alone reads as rain. Give
    each call its own `name`: offsets are seeded by `(name, i)`, so calls
    that share a name lay their marks on the same offsets.

**Motion and time.**
- On paper, motion is lines: speed lines along the path, motion lines on the
  moving part, an afterimage of the limb, and the next panel showing the
  result. Between panels the reader fills the gap.
- Animation from manga is limited animation: drawings held on twos or threes
  ([twos under a moving camera](../reference/films.md#pace)),
  long holds on a key pose, mouths and eyes moving on a still face, and the
  camera panning and pushing in across a held drawing. Tezuka's Astro Boy
  (1963) set this economy for television.
- A hit is a sequence: a held anticipation, one to three frames of impact
  (often an inverted frame or a burst), a camera shake, then a hold on the
  result. Cutting from the wind-up straight to the aftermath reads as power.
- Speed-line backgrounds loop under a held figure to sell speed without
  animating the figure.
- Transitions native to the medium: a panel border sliding in, a cut to a
  close-up of eyes, a white or black frame, focus lines closing in.
- What breaks it: smooth motion on every frame, blur instead of lines, flat
  grey, and soft gradients that are not printed dots.

**Drawing order.** A light rough first, then the inks, main lines before
effect lines, then blacks, hatching and tone, then panel borders and balloons
([draw the drawing](../reference/films.md#draw-the-drawing)). The lines are
inked before the blacks and tone, though they layer over them. A `pen` line
tapers by its press along the spine it is given, so call it on the whole
spine every frame inside a clip to the grown band, and `hatch` inside a swept
band. `pen` draws along `chaikin(spine, smooth)` (`smooth` 2 by default)
when the spine has more than two points, so grow the band along those
points, not the raw spine, and call it unclipped once the line is whole. A
`screentone` sheet is laid whole
([grow a mark by length](../reference/films.md#draw-the-drawing)).

**Sound.** Manga writes sound into the picture as hand-lettered effects, and
writes silence too. A film in the style can do the same: a sharp sting on an
impact frame, silence on the hold before it, and a sound for each drawn line
effect only when it marks an event.

**Study.**
- Osamu Tezuka, *Phoenix* and *Astro Boy*: for panel flow as camera work.
- Katsuhiro Otomo, *Akira* (manga and the 1988 film): for speed lines, dense
  backgrounds and the weight of a hit.
- Takehiko Inoue, *Vagabond*: for brush blacks and long silent sequences.
- Riyoko Ikeda, *The Rose of Versailles*: for shojo's emotional backgrounds,
  flowers, sparkles and tone.
- Naoki Urasawa, *Monster*: for cinematic pacing and quiet faces.
- Scott McCloud, *Understanding Comics*: for how Japanese comics use
  moment-to-moment and aspect-to-aspect transitions.

**Levers.**
- Panel scale: one full-frame drawing makes a moment monumental; many small
  panels make time run.
- Black share: mostly white is light and open; mostly black is night, fear or
  pressure.
- Tone or line: screentone makes air and softness; hatching makes texture,
  grit and age.
- Background: a literal place grounds the scene; tone, lines or flowers put
  the viewer inside a feeling, over a trace of the place (effect backgrounds
  above).
- Line weight: heavy near and thin far gives depth; one weight flattens.
- Effect lines: speed lines move the world, focus lines stop it.
- Timing: on ones is smooth and expensive-looking; on twos is the anime
  rhythm; on threes with long holds is graphic and deliberate.
- Camera on a held drawing: a slow push makes tension; a pan reveals.

## Palette

| Role | Colour |
| --- | --- |
| paper | `#f6f4ee` |
| ink | `#141210` |
| tone | ink dots at `value` 0.05 to 0.6 |
| spot colour, colour pages only | one red, such as `#c8302a`, at full strength |

## Pitfalls

- A stick figure, limbs as single lines, reads as a diagram, not a character.
  Closed contours with weight and a black mass for the hair read as a body.
- Flat grey anywhere reads as a cartoon or a vector drawing; manga makes
  every grey of dots or lines.
- Screentone with a pitch under about 3 units turns to flat grey, or to moiré,
  once the film is encoded; 100% crops (`--loupe`) show it.
- Two screens at different angles or pitches over each other make moiré;
  one angle and one pitch stay clean.
- Lines of one width read as clip art; `w` varied by distance and
  importance and tapered at each end, reads as a pen.
- Speed lines with no clear lane and no sharp subject read as rain or
  scratches; something sharp for the eye to hold makes them speed.
- Every frame new reads as a video game; held drawings, boiled only by the
  drawing's index, read as drawn.
- An impact frame on every hit stops reading as an impact; saved for the
  biggest one, it lands. Flashes stay at three a second or fewer.
