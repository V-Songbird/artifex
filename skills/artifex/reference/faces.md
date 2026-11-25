---
type: knowledge
summary: "How to build a face and head that read at close range, in a still or a film: head units placed by one transform, proportions as ratios and how a style shifts them, measuring landmarks and outlines from a reference, the ear's three forms, asymmetry and a slight turn, eyes and brows at rest and in motion (the white and socket shaded as a ball, gaze changes, blink timing, brow shapes, a figure that listens), a face on an object (where it sits, how much face, features from its own parts, its idle life), nose and cast shadows under overhangs, the lips' structure, hairline, hair flow, its shadow and rims that fold, jaw, neck width and slope, collarbones, skin with one far-side shade mass and a contained blush, and hands toward the camera; read before drawing a face large enough to show its features, or a face on an object at any size."
related_files: ["skills/artifex/SKILL.md", "skills/artifex/reference/films.md", "skills/artifex/reference/materials.md", "core/geom.js"]
---

# Faces

## Contents

- [Build the face in head units](#build-the-face-in-head-units)
- [Measure from a reference](#measure-from-a-reference)
- [Asymmetry and a slight turn](#asymmetry-and-a-slight-turn)
- [Eyes and brows](#eyes-and-brows)
- [Eyes and brows in motion](#eyes-and-brows-in-motion)
- [A face on an object](#a-face-on-an-object)
- [Nose](#nose)
- [Mouth](#mouth)
- [Hairline and hair](#hairline-and-hair)
- [Jaw, neck and collarbones](#jaw-neck-and-collarbones)
- [Skin](#skin)
- [Hands towards the camera](#hands-towards-the-camera)

Read this with [the core skill](../SKILL.md) when a piece shows a face large
enough for its eyes, nose and mouth to read: from the last row of
[the smallest figure that still acts](films.md#the-smallest-figure-that-still-acts)
up to a portrait that fills the frame. It is the close-up level below
[figures that read](films.md#figures-that-read), which covers the volumes, the
head count, [a face that acts](films.md#a-face-that-acts) and hands, then
[painting over a hidden mannequin](films.md#paint-over-a-hidden-mannequin), and
[hinged figures](films.md#hinged-figures) for a figure built from visible
parts. This page does not repeat them.

Nothing here sets whose face it is, or in what style. Every value in an example
is invented to show the arithmetic, not a face to copy. A
[style's guide](../styles/catalog.md) that draws faces its own way wins over the
defaults below. A face that is not human, such as an animal's or a creature's,
keeps the method and sets its own landmarks; an object's face, down to two
dots, is in [a face on an object](#a-face-on-an-object).

## Build the face in head units

- **Draw every part of the face in one local frame, and place it with one
  transform.** Put the origin between the eyes, x to the right and y down, and
  make one unit a distance the face keeps, such as the distance between the eye
  centres. Then move, scale and tilt the whole face with one `translate`,
  `rotate` and `scale`. Every feature keeps its place relative to the others
  whatever the head does, and a proportion is one number you can read and
  change.

```js
// Proportions in head units: 1 unit is the distance between the eye centres.
// The values are invented for this example; keep them in the state, as
// `state.face`, and pass them in.
const FACE = { eyeY: 0, noseY: 0.8, mouthY: 1.15, chinY: 1.85, cheekX: 1.15 };

function drawFace(g, at, face, paint) {
  g.save();
  g.translate(at.x, at.y);   // the point between the eyes, in piece units
  g.rotate(at.tilt);         // the head's lean, in radians
  g.scale(at.k, at.k);       // piece units per head unit
  paint(g, face);            // hair behind the face, skin, marks on the skin, features, then hair in front
  g.restore();
}
```

  Line widths scale with the transform, so give them in head units too. On a
  painted figure, take `at` for each frame from the head landmarks of the
  blended mannequin. In a hinged rig, the head part's `paint` makes this move
  inside its own frame, from the neck pivot to the point between the eyes.
- **The head under the face has a side view of its own.** This page places
  the features; the skull, the face wedge in front of it, the brow, the nose,
  the chin and the jaw's angle are masses of the mannequin, sized in
  [hands and feet](films.md#hands-and-feet). The features sit on the face
  wedge. Laid on the skull's ball they fall behind the profile, and a head
  turned to the side shows a beak.
- **Planes before features.** Two broad tones laid first make a head that
  the features then sit in: the two sockets under the brow, one soft dab
  each in the shade colour, and the side plane of the face away from the
  light, from the temple down the cheek to the jaw, in the half-tone. Eyes,
  nose and mouth drawn on a face with neither read as marks on a ball.
- **Keep the proportions as ratios, written once.** Store them in the state
  with the figure's other numbers, as
  [proportions in heads](films.md#proportions-in-heads) says, and draw every
  shot and expression from them.
- **A lower face drawn too long is the commonest error.** Features are usually
  placed one under the other, so each small gap adds up and the chin drifts
  down. A long lower face changes age and character more than any other ratio.
  Measure the eye line to the mouth and the eye line to the chin on the render,
  in head units, before you change anything else.
- **A realistic adult face, seen from the front, starts from these ratios.**
  The eyes sit halfway between the top of the skull and the chin. The gap
  between the eyes is about one eye's width. The base of the nose sits about
  halfway between the brows and the chin, and the line between the lips about a
  third of the way from the nose to the chin. The ears run from the brow line
  to the base of the nose.
- **Build the ear from three forms: a rim, a bowl and a front bump.** The rim
  curls round the top and the back. The bowl inside it is the ear's darkest
  value. The small bump at the bowl's front edge, beside the face, takes the
  ear's own skin value: a light dot inside the bowl reads as an earring. An ear
  drawn as one flat shape reads as a handle.
- **A style moves the ratios, not the order of the landmarks.** A younger or
  cuter face has larger eyes set lower, a shorter nose and a shorter lower
  face. An older or more elegant face lengthens the lower face and the nose. A
  cartoon pushes one or two ratios far and holds the rest. In every style the
  brows stay above the eyes, the eyes above the nose, the nose above the mouth
  and the mouth above the chin.

## Measure from a reference

When the piece works from a reference that the user gave you and may use, such
as their own photo or drawing, reading it by measure finds what the eye misses:
a face drawn by eye drifts towards the template the hand knows.
To match the reference itself rather than read its proportions, follow
[replica mode](replica.md).

- **Fit your landmarks to the reference's.** Read a few landmarks off the
  reference, in pixels: the eye centres, the tip of the nose, the corners of
  the mouth and the chin. Fit your own landmarks, in head units, onto them with
  one scale, one turn and one shift, solved by least squares. What is left over
  at each landmark says which feature sits wrong relative to the rest. A
  feature that is wrong on its own is the one to move. The fit already absorbs
  any difference in size and tilt, so misses spread over every landmark mean a
  ratio in `FACE` is wrong, such as the face's length against its width, or the
  head is turned in depth by a different amount than the reference.

```js
// Fit landmarks `ours` (head units) onto `theirs` (reference pixels), listed
// in the same order, by one scale, turn and shift.
function fitLandmarks(ours, theirs) {
  const n = ours.length;
  const mean = (P) => P.reduce((m, [x, y]) => [m[0] + x / n, m[1] + y / n], [0, 0]);
  const [ax, ay] = mean(ours), [bx, by] = mean(theirs);
  let dot = 0, cross = 0, size = 0;
  for (let i = 0; i < n; i++) {
    const px = ours[i][0] - ax, py = ours[i][1] - ay;
    const qx = theirs[i][0] - bx, qy = theirs[i][1] - by;
    dot += px * qx + py * qy;
    cross += px * qy - py * qx;
    size += px * px + py * py;
  }
  const c = dot / size, s = cross / size;
  const k = Math.hypot(c, s);                    // reference pixels per head unit
  const place = ([x, y]) => [bx + c * (x - ax) - s * (y - ay), by + s * (x - ax) + c * (y - ay)];
  const miss = ours.map((p, i) => {              // head units, one per landmark
    const [x, y] = place(p);
    return Math.hypot(x - theirs[i][0], y - theirs[i][1]) / k;
  });
  return { k, turn: Math.atan2(s, c), place, miss };
}
```

- **Fit outlines through measured points.** Take a
  few points each off the measured edge of the face, the hairline and the chin
  (`npm --prefix "<library root>" run measure`; a clean line drawing reads more surely than a photo),
  turn them into head units with the inverse of the fit, and draw each through
  `spline`, listing in `corners` only a point that is sharp in the reference;
  a rounded chin stays out of it. A pasted point list traces the reference
  instead of drawing it: it carries every wobble of the measurement, and
  nothing in `FACE` can reshape it. A heart, a V
  or an egg built by hand gives the face that template's shape, and the eye
  notices a jaw that is too pointed or too round sooner than almost any other
  error.
- **Compare at the size the piece draws.** Render a 100% crop of the face beside
  the reference, scaled to match, with `--loupe` and `--reference` as in
  [the core skill's steps for reference photos](named-styles.md). Compare one
  region at a time: the eyes, then the nose, then the mouth.

## Asymmetry and a slight turn

- **Break the mirror.** Make the two sides differ by a few percent: one cheek a
  little fuller, the other side of the jaw a little narrower, one brow a little
  higher. An exact mirror reads as mechanical, because no living face is one.
- **A slight turn gives more life than a face seen straight from the front.**
  It gives the face a near side and a far side, so the asymmetry, the overlap
  and the depth come from the geometry. For a small turn, give each landmark a
  depth `z` in head units, towards the viewer, and move it sideways by its
  depth. Keep the outline of the head where it is: the outline is where the
  head turns away from the eye, so it does not travel with the features.

```js
// `yaw` turns the face about the vertical axis, in radians; a small value,
// such as 0.15, is a slight turn. The nose tip has the largest depth.
const turned = ([x, y, z], yaw) => [x * Math.cos(yaw) + z * Math.sin(yaw), y];
```

  The features then crowd towards the far edge, and the near cheek shows wider
  between the centre line and the outline.
- **Avoid the three-quarter view unless the beat needs it.** Every feature
  changes shape in it: the far eye narrows, the nose covers part of the far
  cheek, the mouth curves around the face and the far cheekbone becomes the
  outline. Each of these shapes can go wrong, and the view reads only when
  they agree with each other. A front view with a slight turn reads far more
  reliably. When a beat
  needs a three-quarter head, see [a face that acts](films.md#a-face-that-acts).
- **Reshape a face with a smooth warp, and move what is attached to it.** To
  make a face narrower, narrow it towards its centre line with a weight that
  grows from the cheekbones down to the jaw. Then move the ears and the edges
  of the hair with the outline. Narrowing it at the temples crowds the eyes
  and opens a step at the hairline.

## Eyes and brows

- **Draw the eye smaller and less open than your first guess.** The upper lid
  covers the top of the iris, and the eye is an almond, not a circle. An eye
  that is too large and wide open is usually the first thing that looks wrong:
  it reads as startled or doll-like. A style that sets large eyes keeps them
  large, and still lets the upper lid cover the top of the iris.
- **Centre the irises for a gaze that looks straight ahead,** with white on
  both sides. Irises moved outward read as eyes looking apart, and irises
  moved inward read as cross-eyed. To look aside, move both irises the same
  way by the same amount in head units. The iris lies on a ball, so as the eye
  turns aside it narrows into an ellipse; a round iris at the side of the eye
  reads as painted on.
- **Make the iris darker than the lid's shadow,** with one highlight for each
  light, placed as [a specular](materials.md#materials) is placed. A pale iris
  with no dark edge reads as glass. In a close shot, mark it with short strokes
  of mixed length that radiate from the pupil.
- **Shade the white as part of a ball under its lids.** The upper lid shades a
  band across the top of the white, a step darker than the rest. A thin lit
  ledge along the lower lid shows its thickness. A closed lid bows out over the
  ball, since the ball is still under it. A white of one flat value reads as
  a sticker.
- **The eye sits in a socket.** Shade it as one soft band from the lid up
  towards the brow, darkest at the inner corner beside the nose and falling
  into the cheek below. A pale strip on the lid alone reads flat. Start the
  socket light: a dark or wide one reads as heavy make-up or a bruise.
- **Group the lashes into a few clumps.** Make them thicker towards the outer
  corner, where they merge into the shadow of the socket, and make the lower
  lashes finer and fewer.
- **Brows are hair, not a bar.** The inner end of the brow is the fullest, and
  the outer end thins out. Short strokes stand nearly upright at the inner end
  and lie down along the brow towards the outer end, because the hair grows
  that way. A brow drawn too thick takes over the face.
- **No pure black on a face.** Lashes, lid lines, nostrils, the seam between the
  lips and the darkest hair each take a dark tinted with the colour around
  them. A pure black mark on skin looks pasted on.

## Eyes and brows in motion

In a film, a few marks that move well carry more feeling than a detailed eye
that holds still. This holds for a dot, a line or a full eye, and for a
brow drawn as one stroke or as hair. [A face that acts](films.md#a-face-that-acts)
says what each part carries; this section says how it moves. Frame counts are
at 24 fps, one drawing per frame. At another rate, scale them by `hz / 24` and
round.

- **Move the pupil on a slight arc, not a straight line.** The pupil rides a
  ball, and a glance rarely travels exactly level, so a straight slide reads as
  a mark on a rail. Bow its path a little away from the straight line between
  the two looks, and ease it out of the first look and into the second.
- **Blink at the middle of a gaze change, and let the head follow.** The eyes
  turn first. Start closing the lids as the eyes start to move, so they are
  shut at the middle of the move and open on the new look. The eye is then
  already turned when it opens, and the change reads as a decision, not a
  slide. The head starts as the lids open and turns on a downward arc: it dips
  in the middle of the turn and rises into its new angle. A head that swings
  level reads as a turret.

```js
const { keys, ease } = require('artifex/core/time.js');
const { lerp } = require('artifex/core/num.js');
// A blink from frame `at`: `close` in-betweens down to one shut frame, then
// `open` in-betweens back up. The value is how far the lid has closed; 1 is shut.
const blink = (at, close, open) => keys([[at, 0], [at + close + 1, 1], [at + close + open + 2, 0]]);

// One gaze change. The frames and sizes are invented for this example.
const look = keys([[10, 0, ease.inOut], [14, 1]]);  // the eyes turn over frames 10 to 14
const lid = blink(9, 2, 1);                         // shut on frame 12, open again on 14
const turn = keys([[13, 0, ease.inOut], [24, 1]]);  // the head follows from frame 13
function gaze(frame) {
  const s = look(frame), h = turn(frame);
  return {
    pupil: [lerp(-0.12, 0.12, s), 0.03 * Math.sin(Math.PI * s)], // head units, across on an arc
    lid: lid(frame),
    head: { yaw: lerp(0, 0.3, h), drop: 0.08 * Math.sin(Math.PI * h) }, // the dip, in head units
  };
}
```

- **Time a blink by the figure's state.** Count the in-between frames from
  open to shut and from shut to open, with one shut frame between them, as
  `blink` above does. A blink that closes and opens at one even speed reads as
  a shutter, not a lid. The upper lid does most of the closing; the lower lid
  rises about 15% of the eye's opening to meet it, so the lids shut below the
  eye's middle. Two lids meeting halfway also read as a shutter.

| State | Closing in-betweens | Opening in-betweens | It reads as |
| --- | --- | --- | --- |
| alert, the default | 2 | 1 | awake and attending |
| sharp | 1 | 0 | a snap of attention or a sudden thought |
| sleepy | 2 | 2 | tired or calm |
| falling asleep | many | many | each blink slower than the last, the lids reopening less each time, until they stay shut |

- **A dot eye blinks by vanishing.** A dot has no lid to close, so remove it,
  or draw a short line in its place, for 2 frames or more. A dot gone for one
  frame reads as a flicker, not a blink.
- **Space the other blinks by seeded gaps.** Between gaze changes, draw each
  gap as [vary with intention](making.md#vary-with-intention) says, and let a
  change of thought take a blink of its own.
- **Two brow strokes carry the whole range.** In a minimal face each brow can
  be one stroke set by three numbers: how high it sits, how far its inner end
  rises or falls against its outer end, and how far its middle arches. Mixed,
  they carry most feelings, and their slope still reads where the eye is too
  small to show its shape. A brow drawn as hair moves the same way, as a whole.

```js
// One brow in head units, over the eye centre at x = side * 0.5. `side` is -1
// or 1. `lift` raises the brow, `tilt` raises the inner end against the outer,
// in radians, and `bend` arches the middle up; a negative bend sags it.
function brow(g, side, { lift, tilt, bend }) {
  const cx = side * 0.5, cy = -0.45 - lift, half = 0.28; // invented for this example
  const dx = Math.cos(tilt) * half, dy = Math.sin(tilt) * half;
  g.beginPath();
  g.moveTo(cx - side * dx, cy - dy);                      // the inner end
  g.quadraticCurveTo(cx, cy - 2 * bend, cx + side * dx, cy + dy);
  g.stroke();
}
```

| It reads as | `lift` | `tilt` | `bend` |
| --- | --- | --- | --- |
| surprise | high | about level | arched up |
| anger or concentration | low | inner end down | flat or sagging |
| worry or sadness | a little up | inner end up | about flat |
| despair | up | inner end steeply up | sagging, so the stroke sweeps up into the inner end |
| doubt | one brow up, the other down | — | — |

- **Despair sweeps up at the centre.** The inner ends rise steeply towards the
  middle of the forehead while the outer ends stay low. Keep the lids lowered
  under them. Brows pulling up against falling lids read as grief held in; the
  same brows over wide open lids read as fear.
- **A figure that listens answers what it hears with a small change.** A
  nod, a sway or a blink on a fixed interval is a loop, and once the
  viewer sees the loop, the figure stops hearing anything. Take the frames of
  what it hears from the cue table that times them, such as another figure's
  lines, a sound or an event nearby. Answer a few of them with one small change
  each: a brow lifts at a question, a blink and a small dip of the head as a
  point lands, the eyes drop at something unwelcome. Hold the new face until
  the next answer. A [breath under the hold](films.md#gesture-and-mood) keeps
  the body alive, but it does not answer anything.
- **Look at each gaze change on single frames.** A strip spread over the whole
  film skips them. For each change, pass `--at` the [frame middles](films.md#look-at-a-film)
  of a few frames, with `--loupe` on the face: the last frame of the
  old look, the shut frame, the first fully open frame, the head's lowest frame
  and its landing. For the example above, at 24 fps:

```shell
npm --prefix "<library root>" run seeds -- "./my-piece.cjs" --at 0.3958,0.5208,0.6042,0.7708,1.0208 --loupe 480,300 --png
```

  On the open frame the eye already looks the new way, and the head sits lower
  in the middle of its turn than at either end. For a dot eye, draw the frames
  of each blink in a row: the dot stays gone on at least two of them.

## A face on an object

An object's face is found on it, in its own units and from its own parts, and
it can be as little as two dots. [An object that acts](films.md#an-object-that-acts)
gives the object its traits, its feet and its one way of moving; this section
says where its face sits, how much face it gets and how that face lives.

- **The face sits where the object's own forms suggest one.** On the side its
  use faces: a jug's face is on its belly under the spout, a lock's on its
  front plate, a letterform's in its counter. The eyes go in the top third of
  that face, or on a knob, a rivet or a counter the object already has, and
  the mouth under them. A letter with two counters, such as a B, takes its
  eyes in the upper one and its mouth in the lower; a letter with one, such as
  an o, holds both inside it, the mouth under the eyes. Draw it in the object's own units, one unit the object's width, kept
  in state as the `FACE` ratios of
  [build the face in head units](#build-the-face-in-head-units) are, and place
  it with one transform inside the object's own, so the face rides every
  squash, hop and turn of the body. A stock face at the object's centre, at
  its own size, reads as a sticker.
- **How much face is a choice of what the thing is.** None: a stiff thing, a
  brick or a safe, acts through tilt, tempo and amplitude alone. Two dots and
  a line. Dots with brows and lids. A full face. Fewer marks read as a thing,
  more as a person. Brows carry the feeling and lids the attention, as
  [a face that acts](films.md#a-face-that-acts) says, so a dot-eyed object
  gains feeling from a brow bar before it gains a lid. The object that leads a
  scene often gets the most face; the rest of the cast keep the same eye
  construction with fewer marks
  ([a cast is one family](films.md#an-object-that-acts)). Dot eyes
  [blink by vanishing](#eyes-and-brows-in-motion). On a round object the
  features follow the curve, as [a slight turn](#asymmetry-and-a-slight-turn)
  bends them; on a flat front they are drawn flat.
- **Features come from the object's own parts.** An opening under the eyes is
  its mouth: a lock's keyhole under two rivets, a bag's clasp, a B's lower
  counter. An opening above the eyes stays what it is: a jug's spout is not
  its mouth, it points where the jug looks. A rim, a seam or a serif is its brow line. A mark added from
  outside, lashes, a moustache, a scar, a patch, states one trait the story
  names and nothing else; a second such mark is decoration.
- **The face lives on its own time.** Blinks fall at
  [seeded gaps](#eyes-and-brows-in-motion), the pupils follow the action,
  and a change of thought takes a blink
  ([blink at the middle of a gaze change](#eyes-and-brows-in-motion)). An
  expression changes at a take's accent, brows and mouth together on one
  frame ([takes and accents](films.md#takes-and-accents)). A face on a held
  object answers events; a change on a fixed interval reads as a loop once
  the viewer has seen it repeat
  ([a figure that listens](#eyes-and-brows-in-motion)). The pupils turn
  toward each beat's element before the beat, as
  [idle life under a hold](films.md#an-object-that-acts) times it. Check both
  with `--at` and `--loupe` on the face: for a blink, the frame middles from
  its first shut frame to its reopening show the dot gone on at least two of
  them; for a look, the frame before the pupils start to turn, the frame they
  land and the beat's frame show every pupil in frame turned on the landing
  frame, before the body moves.

## Nose

- **Shape the nose with shading, not with a line.** A drawn line down the
  bridge reads as a scar. Use a soft, narrow shadow along the side of the
  bridge that faces away from the key light, and, if the style wants a line, a
  faint one that fades out towards the top. Draw the nostrils as two small
  marks, and the underside of the tip as one short curve. A tip drawn as an L
  (bridge, corner, underside) reads as a diagram.
- **Check the bridge in head units before restyling it.** A bridge that leans
  against the head's own vertical reads as a crooked nose. The cause is in the
  geometry, not in the drawing.
- **Leave out every shadow the light plan cannot explain.** A soft shadow
  placed beside the nose for depth, with no light that casts it, reads as a
  stain. Place each shadow from [one light plan](materials.md#one-light-plan).
- **Each overhang casts a short shadow downwards.** The nose, the lower lip and
  the chin each cast a soft wedge on the skin below them, all on the side away
  from the key light. Each one is crisp at the overhang and lightens as it goes
  down. The wedge under the nose is no wider than the nostrils.

## Mouth

- **The upper lip is thinner than the lower.** The upper lip faces down, into
  shade, and the lower one faces up towards the light, so the lower lip is
  also the lighter one.
- **Build the lips on the forms around them.** The two ridges under the nose
  land on the two peaks of the upper lip, either side of the dip in its middle,
  and the groove between them runs down into that dip; show it as a soft
  groove of shade, not as two lines. Model the lower lip as two rounded
  masses, one each side of the centre: two soft light lobes inside one lip
  outline. Drawn as two separate shapes, they read as swollen.
- **The mouth's corners keep a thickness.** The lips end in a short tuck, not
  in a point. A smile lifts the cheeks, and their shadows rise with them.
- **Keep the lip colour close to the skin's hue and lower in chroma than a
  first guess.** Bright lips look like a sticker, unless the style asks for
  them.
- **The seam between the lips is a soft line in a darker lip colour.** In
  that colour, not black (which on skin reads as pasted on), it runs as two
  shallow S curves that meet at the centre, and it is darkest at the corners.
- **One light, one gloss.** Draw a single highlight on the lower lip, clipped to
  the lip. Several streaks read as stripes.
- **A talking mouth opens once a syllable.** About 180 ms a syllable, 4 to 5
  frames at 24 fps, open on each and shut on the pauses between phrases,
  reads as speech: a mouth that changes every frame chatters, and one that
  opens once a word falls out of step with the voice. The body carries the
  line too, as [each sound sits where it lands](films.md#takes-and-accents)
  says.

## Hairline and hair

- **The hairline is not a smooth arch.** It has a centre, such as a point or a
  part, and it falls steeply to the temples. A smooth arch looks like a cap or
  a wig. Soften each side of the hairline on its own, so its centre stays
  sharp.
- **Let the roots draw the hairline.** Fan a few long, muted lines out from
  its centre both ways over the crown. Dozens of short lines look like spiky
  grass.
- **Build hair as masses, then locks, then fine lines.** Start from a few large
  masses with soft edges, as for any
  [fibre mass](materials.md#materials). Fill each lock as an
  [`outline`](geometry-fields.md#variable-width-strokes) with a few smooth waves that start near the root. Sample each
  wave finely, because a coarse sample turns waves into zigzags. A lit edge
  along each lock, and fine lines along its flow over the dark mass, keep the
  hair from reading as one flat fill. Each fine line also adds to the edge
  density: stop before the hair looks busier than the face.
- **Not all hair falls.** Hair that only hangs down reads as wet or rigid. Add
  locks that rise from just above the hairline and sweep back over the crown,
  starting thin so that they grow out of the hairline, and a few loose hairs that lift
  away from the mass in S curves.
- **Hair casts one simple shadow on the skin.** Lay one or two soft bands under
  the hairline on the side away from the light, such as the temple and in front
  of the ear, following the hair's edge only loosely. A shadow that copies
  every lock looks cut out.
- **Lift the darkest hair off black.** Give the darkest hair a hue and a value
  above black, so its lines and its lit edges stay visible.
- **A line offset along a lock folds back where the lock bends tighter than
  the offset.** On the inside of a tight bend, the offset points run backwards
  against the lock and draw a loop, a "4", a "<" or a small triangle. Drop the
  points that run backwards, plus a few on each side. Breaking the line at
  sharp turns only makes the fold smaller.

```js
const { ribbon } = require('artifex/core/geom.js');
// The offset line `width` to the left of `pts`, one point per point,
// with the stretches that fold back at tight bends dropped.
function rimWithoutFolds(pts, width, pad = 2) {
  const rim = ribbon(pts, () => width).slice(0, pts.length);
  const drop = new Set();
  for (let i = 1; i < pts.length; i++) {
    const along = (rim[i][0] - rim[i - 1][0]) * (pts[i][0] - pts[i - 1][0])
                + (rim[i][1] - rim[i - 1][1]) * (pts[i][1] - pts[i - 1][1]);
    if (along < 0) for (let j = i - 1 - pad; j <= i + pad; j++) drop.add(j);
  }
  return rim.filter((_, i) => !drop.has(i));
}
```

  `offsetPolyline` in `core/geom.js` keeps such folds too
  ([geometry and fields](geometry-fields.md)), but its output does not have one
  point per input point: it merges repeated points and adds two points at a
  bevelled corner. Pair each offset segment with the source segment it was
  made from, not `rim[i]` with `pts[i]`, and drop the offset segments that run
  against their source segment.

## Jaw, neck and collarbones

- **Shape the jaw with shading, not with a dark outline.** Use a thin line,
  warmer than the skin, that swells along the shadowed side of the jaw and
  tapers at both ends, at low strength.
- **The jaw casts a shadow on the neck.** Make it crisp and short, a wedge
  rather than a long band, clipped to the skin of the neck. It takes its colour
  from what it faces ([shadow colour by facing](materials.md#shadow-colour-by-facing)).
- **Draw the neck shorter and slimmer than your first guess.** On a human it
  is about 0.45 of the head's width, narrowest at mid-throat. Run its top up
  under the jaw, so its edges stay behind it, and let its back contour leave
  the skull behind the ear; edges that show beside the face read as a neck
  wider than the head.
- **The head leans on the neck.** On a painted figure the head and the neck
  are one outline: the contour runs from the skull down the neck into the
  shoulders with no line where they meet. Seen from the side, the neck leans
  forward about 15 to 20 degrees; a vertical neck reads as a post. From about halfway
  down, one long concave curve runs out to each shoulder point, with no corner.
  A lean is a key pose of that outline, split between the head and the neck
  ([paint over a hidden mannequin](films.md#paint-over-a-hidden-mannequin)).
  In a hinged rig, give the head its own part as the neck's child, with its
  own pivot at the neck's top, under the skull behind the ear
  ([landmarks, lengths and joints](films.md#landmarks-lengths-and-joints),
  [hinged figures](films.md#hinged-figures)), and
  split a lean between the two the same way.
- **Collarbones are not two matching curves.** Two matching curves read as a
  necklace. From behind each ear, a tendon runs down to the notch at the top of
  the breastbone. From that notch, each collarbone runs out towards its
  shoulder, nearly straight. Draw the shadowed tendon and one faint collarbone,
  each as a soft shadow. Keep the two collarbones at one height and one
  length, and let only their strength differ. Tendons and collarbones show more
  as the head turns, as the shoulders tense and on a thin build.

## Skin

- **In a painted or graphic style, keep the skin nearly flat.** Use a narrow
  range of values and let the features carry the form. Heavy modelling makes
  such skin look dirty or aged. A realistic style models the skin as a
  translucent form, with
  [subsurface light](materials.md#materials) at thin edges.
- **Turn the face with one soft shade mass on its far side.** Under a key
  light from the side the face turns towards, paint one connected shape where the front of the face
  turns into its side: from the temple, past the outer corner of the far eye,
  in under the cheekbone, out to the corner of the jaw and on under the jaw
  onto the neck. It folds into the far socket and the shaded side of the nose,
  while the bridge, the upper lip and the chin stay lit. Clip it to the skin of
  the face and the neck. To check it, reduce the skin to two values: the shade
  is one region covering a quarter to a third of the face, and the near cheek
  holds none of it.
- **Contain the blush.** Put one soft patch on each cheekbone, below the span
  from the iris to the outer corner of the eye and between the lower lid and
  the level of the nose tip. Make each patch a little warmer and slightly
  darker than the cheek under it, no larger than about one and a half eyes,
  fading over its outer third, and never lighter than the lit parts of the
  face: a blush lighter than them reads as skin lit, not skin tinted.
  A blush spread wider flattens the cheek.
- **Fine texture on skin reads as a feature of the skin, not of the medium.**
  Dots read as freckles, and long fibres read as scratches. Fade such texture
  far down, or leave it out.
- **Draw every mark on the skin in head units, clipped to the face.** This
  covers freckles, paint, scars and glitter. Draw them after the skin and before
  the features. Drawn in piece units, or after the eyes, they float over the
  face when the head moves.
- **Soften the face without softening the hair.** On a raster piece, draw a
  blurred copy of the face, with `g.filter = 'blur(...)'` at a low opacity,
  clipped to the face and drawn after the mouth. Blurring the whole frame loses
  the crisp lines of the hair and the outline. A vector surface refuses
  filters ([vector and plotter output](vector.md)), so draw softer, wider and
  fainter copies of the feature strokes instead.

## Hands towards the camera

- **A hand that comes towards the camera foreshortens: it does not only grow.**
  Its length shortens, the fingers overlap the palm and each other, and the
  nearest knuckles grow most. Grow it only as much as its change in distance
  explains, and keep the arm attached. A hand that keeps its shape and simply
  scales up reads as a hand that is growing.
- **Leave hands out of a close shot unless they carry the idea.** Hands drawn
  at close range need their own construction
  ([hands and feet](films.md#hands-and-feet)), and fingers that are too short
  are the usual fault.
