---
type: knowledge
summary: "The short map of an Artifex film, from a brief to the saved MP4, each line linked to the section that holds the rest; read whole before any piece delivered as a film."
related_files: ["skills/artifex/SKILL.md", "skills/artifex/reference/films.md", "skills/artifex/reference/sound.md", "skills/artifex/reference/making.md", "skills/artifex/styles/catalog.md", "core/time.js", "core/sound.js", "core/rand.js", "tools/contact-sheet.js", "tools/film-cli.js", "tools/piece-input.js"]
---

# The film route

A map, not a procedure: what a film most often needs, in the order it is
usually made. Each line gives the knowledge and its reason, then the section
of [films](films.md), [sound](sound.md) or [making a piece](making.md) that
holds the rest; open one when the film needs it. A brief of one line is
enough to start.

The one-page piece below runs, and it leaves out what most often decides
how a film is judged. The page goes on with how a listed medium's marks are
called, how weight and contact move, how a drawing grows one mark at a time,
how a place sounds as grains under its events, and which strips show a film
before its export.

## The piece on one page

A film is one `.cjs` file. This one runs as it stands; its shapes and sounds
are placeholders.

```js
// my-piece: the film in one sentence.
// TREATMENT. The subject and the moment chosen; the beats in seconds; the shots;
// light and palette; the marks and their drawing order; the sound of each beat;
// the final image. LOOKS TO LEAVE OUT: ... CHOSEN, NOT GIVEN: ...
'use strict';
const { rng } = require('artifex/core/rand.js');
const { shots, span, ease, spring } = require('artifex/core/time.js');
const { sumInto, voice, ambience, room } = require('artifex/core/sound.js');

const W = 1280, H = 720, HZ = 24, FLOOR = 560;
const SHOTS = [['wait', 2], ['fall', 2], ['rest', 2]];   // [name, seconds], in playing order
const DUR = SHOTS.reduce((sum, [, seconds]) => sum + seconds, 0);

module.exports = {
  name: 'my-piece',
  size: { w: W, h: H },
  time: { duration: DUR, hz: HZ },
  seed: 1,
  state: () => ({ cues: null }),
  build: [
    ['write the cues', (s) => {
      // Every timed event is written here once, in whole frames. `draw` and `sound` only read it.
      const film = shots(SHOTS, { hz: HZ, frames: Math.round(DUR * HZ) });
      const land = { name: 'land', frame: film[1].start + 30, x: 640, y: FLOOR, velocity: 0.8 };
      s.cues = { shots: film, drop: { from: film[1].start, to: land.frame }, contacts: [land] };
    }],
  ],
  draw(g, s, t, clock) {
    const R = rng(s.seed);   // addressed, not a stream: R('thing', 'property', wholeNumberIndex)
    const { drop, contacts: [land] } = s.cues;
    g.fillStyle = '#e8e1d2';
    g.fillRect(0, 0, W, H);
    // Behind the subject, alive and quieter: smaller, slower, lower in contrast.
    g.fillStyle = '#d6cdb9';
    for (let i = 0; i < 5; i++) {
      const x = (R('far', 'x', i) * W + clock.seconds * (4 + 6 * R('far', 'speed', i))) % W;
      g.fillRect(x, 120 + 60 * i, 40, 6);
    }
    // The fall gains speed, the landing rings on a spring and then rests, and
    // the thing touched gives from the contact's own frame.
    const since = (clock.frame - land.frame) / clock.hz;   // seconds since the contact
    const give = since < 0 ? 0 : 1 - spring({ stiffness: 220, damping: 0.3 })(since);
    const y = FLOOR - 300 * (1 - ease.in(span(drop.from, drop.to, clock.frame)));
    g.fillStyle = '#2b2a28';
    g.fillRect(200, FLOOR + 14 * give, 880, 8);
    g.fillRect(land.x - 40, y - 80 + 14 * give, 80, 80);
  },
  sound(ctx, s, timeline) {
    const R = rng(s.seed);
    const events = ctx.createGain();
    const send = ctx.createGain();
    const hall = room(ctx, R, 'room', { size: 0.6 });   // wet only: it sounds beside the dry mix
    send.gain.value = 0.2;   // a farther event takes a larger send of its own
    events.connect(send);
    send.connect(hall);
    // The place sounds from frame 0 to the end, as sparse quiet events far under
    // the caused sounds. It is already wide and diffuse, so it stays out of the room.
    const place = ambience(ctx, R, 'place', 0, { length: timeline.duration, colour: 700, level: 0.002,
      grains: { rate: 5, length: 0.04, level: 0.02, spread: 18 } });
    // Each planned contact sounds on its own frame, as hard as its cause.
    const hits = s.cues.contacts.map((c, i) => voice(ctx, R, `${c.name} ${i}`, c.frame / timeline.hz,
      { pitch: 98, partials: [[1, 1], [2.4, 0.4]], attack: 0.004, decay: 0.5, level: 0.3, velocity: c.velocity }));
    sumInto(ctx, hits, events);
    sumInto(ctx, [place, events, hall], ctx.destination);
  },
};
```

- **One cue table feeds picture and sound**, so a sound cannot drift from the
  frame that shows its cause ([the contract](contract.md)).
- **`module.exports` holds the contract's keys and nothing else.** Tables and
  helper functions stay in the module, outside the exported object; a key the
  contract does not list is refused by name.
- **`R(entity, property, index)` takes two strings and a whole number.** It
  hashes its address, so adding a mark never moves another. A value that
  varies smoothly over space or time comes from `noise2(R, x, y, name)`.
- **Motion comes from `core/time.js`.** `span`, `ease` and `tween` time a
  move; `spring` and `follow` give it weight; `shots` and `shotAt` put cuts on
  whole frames ([the contract](contract.md)).
- **`s.cues.contacts` is the list the contact strip draws**: each planned touch
  with its `frame` and design point `x`, `y`
  ([depth order and contacts](making.md#depth-order-and-contacts)).
- **A long film has more plumbing than this.** The optional
  [film scaffold](../film-scaffold.cjs) is a file to copy and fill: shots,
  elements, a camera track, rooms and contacts, checked for continuity
  ([build the film in order](films.md#build-the-film-in-order)). It is a
  large file, and a film of one shot or a few seconds is written faster
  from this page: open it only for a film of several shots.
- **The first draft is looked at before it is extended.**
  `npm --prefix "<library root>" run seeds -- "./my-piece.cjs" --frames 9 --sound --png`
  shows the whole film and its soundtrack in seconds; the other strips are in
  [look, then export](#look-then-export).

## The plan on paper

- **The treatment is the film written before it is built**, in the header
  comment, with the parts the piece above lists and the
  [looks to leave out](films.md#looks-to-leave-out).
  A beat nobody can point to costs one line to fix there and a rebuild later
  ([the treatment](films.md#the-treatment), [find the idea](making.md#find-the-idea)).
- **The final image is planned first.** It is what the viewer keeps, and every
  beat before it is judged by whether it earns it
  ([plan the film](films.md#plan-the-film)).
- **What the brief leaves open is chosen, not asked.** Each choice goes on a
  `Chosen, not given:` line with what else it could have been, and the report
  repeats the list, so the user redirects after seeing a film instead of
  before seeing anything.
- **A trough comes before the peak.** A film at one intensity reads as flat
  however much happens ([plan intensity with the story](films.md#plan-intensity-with-the-story)).
- **The length fits [where it plays](films.md#where-it-plays)**, and the
  first second decides whether the rest plays.

## Draw like a painter

A painter finds the main movement, lays the big masses, finds the contours on
them and leaves detail for last, looking after each pass and correcting it
before the next. A piece can be written the same way.

- **Movement and masses first.** Start from the few large shapes that carry
  the picture at thumbnail size, and derive the smaller parts from their axes,
  widths and offsets instead of typing every coordinate: a part placed on its
  mass moves with it when the mass is corrected
  ([paint in masses, values and edges](stills.md#paint-in-masses-values-and-edges),
  [blocking the film first](films.md#build-the-film-in-order)).
- **Marks follow the form.** A stroke that describes a surface runs along it
  or around it, and a line swells where the hand presses and on the nearer
  part, thinning to its ends
  ([marks that model form](stills.md#marks-that-model-form),
  [line weight](stills.md#line-weight)).
- **Look after every pass, at viewing size and at 100%.** The masses alone,
  drawn and looked at before the next pass is written, show a wrong proportion
  while it costs one number to fix; a later pass rarely rescues an earlier
  one. `npm --prefix "<library root>" run seeds -- "./my-piece.cjs" --at <seconds> --loupe --png`
  gives one frame and a 100% crop in seconds.

## The medium

- **The [style catalog](../styles/catalog.md) lists media whose marks are
  ready**: pens, brushes, washes, cut paper, stitches and more, as functions
  that draw on any path or area a piece gives them. Choosing one, or none, is
  the painter's call; a brief that names no medium asks for none of them.
- **A medium's marks carry its character.** A style's functions hold what
  makes it read, such as a ballpoint's skips and ink pools or a brush's taper.
  A mark rewritten by hand loses that unless it rebuilds it, so a piece in a
  listed medium calls the style's marks with its own geometry: the catalog row
  and the style's guide, read whole, give every mark's signature and the
  medium's drawing order ([named styles](named-styles.md)).
- **One medium holds the whole frame.** The marks go on what moves as well as
  on what holds still: a set drawn in a medium's marks around a figure built
  from plain shapes reads as two films pasted together.

## What moves

- **Whatever moves is pushed, pulled, carried or falls.** A thing that glides
  with nothing driving it reads as moved by an unseen hand; a falling thing
  gains speed, and each bounce is lower and sooner ([continuity](films.md#continuity)).
- **Motion has weight.** A landing or a hit rings on a `spring` and rests
  before the next beat; loose parts trail the body with `follow`. An instant
  pose or a sine wobble reads as mechanical ([continuity](films.md#continuity)).
- **A changed state stays changed.** What breaks, fills, opens or moves stays
  so in every later shot until something on screen reverses it; a thing whole
  again a beat later undoes the event the viewer just watched. What arrives
  comes from somewhere in the scene ([continuity](films.md#continuity)).
- **A touch makes the thing touched react, and sound.** It bends, gives,
  cracks or rings from the frame the outlines meet, and the contact has a
  sound of its own; a touch with neither reads as two layers passing
  ([depth order and contacts](making.md#depth-order-and-contacts)).
- **The background lives, quieter than the subject.** Something behind the
  subject drifts, sways or flickers on its own rhythm, smaller, slower and
  lower in contrast, so the frame is alive and the eye still lands on the
  subject ([what every scene holds](films.md#what-every-scene-holds)).
- **A camera move has a cause the viewer can name and lands on a view at
  rest.** A zoom or pan nothing in the story asks for reads as the camera
  wandering; a still camera is a style too
  ([camera and framing](films.md#camera-and-framing)).
- **A figure is painted as one form over a hidden mannequin.** The joints
  place the pose and stay unseen; the body is one silhouette in the medium's
  marks, bending where the figure bends. Hinged parts suit machines, puppets
  and cut-outs ([paint over a hidden mannequin](films.md#paint-over-a-hidden-mannequin),
  [figures that read](films.md#figures-that-read),
  [an object that acts](films.md#an-object-that-acts)).

## When the drawing is the film

A reveal, a timelapse or a diagram drawn as it is explained
(all of it: [draw the drawing](films.md#draw-the-drawing)).

- **One hand draws.** The marks that carry the picture grow one at a time, in
  the medium's order: light construction, then the line, big forms before
  small, fills, details, lettering last. Fill that changes the read little,
  such as hatching, dots or a wash, can grow several marks at once or faster.
  Nothing fades in.
- **A large form is many strokes.** A hand lays an outline in pieces ending
  at its corners and turns, then the lines inside it, then the shading,
  lifting after each; one line round a whole shape reads as a plotter.
  Write the form as a list of strokes, each with its own points and window in
  the cue table; `core/path.js` splits no path.
- **A hand slows at starts, corners and ends**, takes longer over a longer
  mark, pauses before a new part, and travels through the air to a start near
  where the last mark ended: ease each mark's time with `span` and `ease`
  before turning it into a length.
- **The tool at the tip makes the drawing an act.** A pen, brush or hand at a
  steady slant on the growing tip, over every layer, reads as someone drawing;
  it leaves the frame before the end.
- **The drawn part of a mark never moves.** A style's pen, pencil, brush or
  hatch that takes `grow` draws that share of its own length with the whole
  mark's taper, skips and blots, and returns `{ tip, heading }` for the tool:
  `const at = pen(g, R, 'line 3', points, { grow: share })`, every frame with
  the same `R` and name. A mark of your own is built whole once and cut with
  `grow(points, length)` from `core/path.js`; other style marks are called
  whole inside a clip.
- **The picture reads early and is held at the end.** The big shapes land in
  the first quarter and the subject reads by a third; the finished drawing
  holds for a second or two.
- **The tool's sound is friction that follows the tip, not a hit per mark.**
  One voice whose level and brightness follow the tip's speed, silent at each
  lift, keeps reading as a tool when the marks come fast: a burst per mark
  was heard as white noise once dozens overlapped, and one texture at a fixed
  rate did not say that the marks had multiplied. Measured on a few films,
  then built once and chosen by ear over a burst per mark
  ([a sliding contact](sound.md#voices-a-place-and-a-room)).

## Sound

`core/sound.js` names no instrument; the subject decides what each call is.

| call | gives |
|---|---|
| `voice(ctx, R, name, at, spec)` | one event at `at` seconds, already panned: a `strike` (the contact), a body of `partials` (what rings) and a `tail` (what lingers) |
| `ambience(ctx, R, name, at, spec)` | a place: a low bed of seeded noise and `grains`, small events |
| `pluck(ctx, R, name, at, { pitch, decay, level })` | anything taut that rings when let go |
| `room(ctx, R, name, { size })` | a convolver, wet only; `size` is its seconds to fall silent |
| `sumInto(ctx, nodes, into)` | any number of nodes summed in a fixed order; `into` takes no other input |
| `impact(ctx, R, name, at, { modes, contact, velocity })` | one hit on a thing that rings: `modes` are `[hertz, seconds, level]`, `contact` the seconds the touch lasts |
| `shaker(ctx, R, name, at, { length, rate, ring, energy, modes })` | many small things striking: rain, gravel, pouring, a shake |
| `duck(ctx, events, { length })` | a gain for the music that dips under each caused sound, from `{ at, length, level }` events |
| `hertz(note)` | a MIDI note as hertz |

Every key of a `voice` and an `ambience`, with a value, is in the commented
block of [voices, a place and a room](sound.md#voices-a-place-and-a-room).

- **An event peaks on the frame that shows its cause**, at `frame / timeline.hz`
  from the cue table; a sound off its frame reads as dubbed.
- **Each sound has its own recipe and its own level.** Partial ratios and how
  fast each dies make a thing sound like itself; `velocity` from the cause's
  weight or speed and `vary` on repeats keep events from sounding like one
  machine.
- **A place is heard as many small quiet events.** Grains 20 dB or more under
  the caused sounds, over a low dark bed, read as rain, a street or a room; a
  steady band of noise at the level of the events reads as white noise. Sine
  grains sound wet; `grains.noise: true` makes them dry.
- **The place sounds from frame 0 to the last frame.** Silence at either end is
  heard as the film being broken; a planned silence is short and framed by
  sound.
- **Mix the balance; the export sets the level**, to -14 LUFS: voices are set
  against each other, not against a meter. A score: [music](music.md).

## Look, then export

A strip takes seconds and the film export takes minutes, so what a strip can
show is settled on strips and the export runs once. Each command writes a PNG
beside the piece and prints its path: look at every cell.

```shell
npm --prefix "<library root>" run seeds -- "./my-piece.cjs" --frames 9 --png
npm --prefix "<library root>" run seeds -- "./my-piece.cjs" --at 1.5,4 --loupe --png
npm --prefix "<library root>" run seeds -- "./my-piece.cjs" --frames 9 --sound --png
npm --prefix "<library root>" run seeds -- "./my-piece.cjs" --contacts cues.contacts --loupe --sound --png
npm --prefix "<library root>" run film -- "./my-piece.cjs"
```

- **Nine frames show the whole film at once**: the story, the pace, an empty
  frame. `--at` shows chosen seconds; `--loupe` adds a 100% crop, where marks
  and edges are judged.
- **`--sound` puts the soundtrack under the frames** on one time axis, shades
  each silent stretch and, drawn with `--png`, prints the gain, limiting and
  loudness the export will reach, so the mix is settled before the film is saved.
- **`--contacts` shows each planned touch**, two frames before to three after,
  with its crop and its sound.
- **`seeds` names its own files; `film` and `still` take `--out`.** The film
  is saved beside the piece as `my-piece.mp4` with its report
  `my-piece.mp4.json` ([save a film](films.md#save-a-film)).
- **A script of your own loads the piece with `loadExternal`**: a plain
  `require` cannot resolve its `artifex/core/...` imports.
  `require('<library root>/tools/piece-input.js').loadExternal('./my-piece.cjs').piece`
  is the validated piece. The strips give most measures, and `--json` their
  numbers ([look at a film](films.md#look-at-a-film)).

## Before you export a film

These are the questions a film's time strip, shot strip, source and plan can
answer.
[Look at a film](films.md#look-at-a-film) pairs them with its own
frame checks; painters ask them after each scene, of the scenes so far, and
once more before delivery. A question whose subject the film does not have
(no sound, no planned contacts) is not asked.

- Do the first two seconds hook ([plan the film](films.md#plan-the-film))?
- Does a trough come before the peak, and do the extremes wait for it ([plan the film](films.md#plan-the-film))?
- Do most changes use the Frame's dominant transition ([plan the film](films.md#plan-the-film))?
- Is the ambience made of grains well under the events ([voices, a place and a room](sound.md#voices-a-place-and-a-room))?
- Are the quiet beats quiet in the sound strip too ([plan intensity](films.md#plan-intensity-with-the-story))?
- Does the sound start on the first frames and carry through to the end, with every silent stretch the `--sound` strip shades planned ([voices, a place and a room](sound.md#voices-a-place-and-a-room))?
- Does each law the film teaches hold, such as one gravity for everything one event releases ([plan the film](films.md#plan-the-film))?
- Is every overlap of two moving things either a planned contact or a pass apart with a held depth cue ([depth order and contacts](making.md#depth-order-and-contacts))?
- Does light reach past the layers it crosses and only as far as it would, night included, and does everything touch what holds it ([what every scene holds](films.md#what-every-scene-holds))?
- Is the final image the one you planned first, with every noun the logline places in it whole and readable at sheet size on the last cell of a `--frames` strip, each relation it states visible there, and do the last frame and the turn's frame (`--at <last>,<turn> --png` at [frame middles](films.md#look-at-a-film), the last one at the duration minus half a frame) differ from the postcard and every look to leave out the plan names ([plan the final image](films.md#plan-the-film), [find the idea](making.md#find-the-idea))?

The film export prints one line per look no fresh strip shows, with
the seeds options that draw it, and lists them in `<film>.mp4.json` under
`looks.missing` and `looks.stale`; a look is stale when the piece's module, or
one it reaches by relative `require`, changed after its strip.
The film is saved either way. The
[fresh-eyes review](films.md#fresh-eyes-review) gets a
reading of the finished frames from someone without this work's context; when
no subagent can start, the same questions asked of the decoded frames
(`npm --prefix "<library root>" run replay -- "./my-piece.mp4" --piece "./my-piece.cjs" --save-frames 0,1.5s,4s`)
and the strips are a self-review, named as one in the report.

## The rest of films, by need

- A film that explains: [a film that explains](films.md#a-film-that-explains).
- Colour and light across scenes: [colour across the film](films.md#colour-across-the-film).
- Cuts, match cuts, morphs and zooms: [continuity](films.md#continuity).
- Shot lengths and rhythm: [pace](films.md#pace).
- Titles, captions and lyrics: [words in motion](films.md#words-in-motion).
- Faces, hands, walks and acting: [figures that read](films.md#figures-that-read), [faces](faces.md).
- Grain or a print grade: [film finish](films.md#film-finish).
- Surfaces, light, weather and water: [materials and light](materials.md).
- What goes wrong in an export: [film traps](films.md#film-traps).
