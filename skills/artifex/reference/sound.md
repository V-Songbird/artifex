---
type: knowledge
summary: "How to give an Artifex film its soundtrack, for any subject: the sound(ctx, state, timeline) contract and recorded tracks, voices, a place and a room, the mix, loudness and how to check what you hear; read with the core skill for any piece with a timeline that should sound."
related_files: ["skills/artifex/SKILL.md", "skills/artifex/film-scaffold.cjs", "skills/artifex/reference/music.md", "core/sound.js", "core/render.js", "docs/apis/piece-api.md", "docs/knowledge/output-formats.md"]
---

# Sound

## Contents

- [Voices, a place and a room](#voices-a-place-and-a-room)

A piece with a timeline may declare `sound(ctx, state, timeline)`: build a Web
Audio graph on the `OfflineAudioContext` it is handed, as long as the film.
`timeline` holds `duration` (`frames / hz`), `frames`, `hz` and `loop`. The
MP4 export renders it offline and muxes it with the frames (`sound` may be
`async`, to decode a recorded track first); `renderSound` in `core/render.js`
renders it alone. Read the [piece API](../../../docs/apis/piece-api.md#soundtrack).
A recorded track must travel in a `.js`, `.cjs` or `.json` module, for example
as base64 text, and `decodeAudioData` needs a fresh copy of its bytes on every
render, because decoding takes the buffer. Replay was measured in installed
Edge 154 for a WAV and for an AAC-LC track, each decoded by the browser that
exported the film, and held for both; other browsers, and other formats such
as MP3 or Opus, are unmeasured. A compressed track does not decode to the
samples it was made from: the AAC track's tone started about 9 to 10 ms late
and the end of its fade was cut off, so place a compressed track's sounds by
ear, or measure its delay, rather than by its source's timing.

Sound follows the picture in two ways, and one piece may use both. An **event**
peaks on the frame that shows its cause: `readout.js` sounds each digit on the
frame that fills its cell, and `settle.js` each edge snapping taut, each knock
of two discs and each pluck on the frame that first shows it, read off the
same snapshots `draw` shows. A **control** follows a quantity the state holds
on every frame, such as a voice's detune, pan or level set from each frame's
snapshot. No bundled example sets a control per frame; the lines below say
what keeps one a function of the state. In the [film scaffold](../film-scaffold.cjs), a sound row's
`gain` keys, `[[seconds, gain], ...]` from the film's start, ramp its whole
level from key to key, so a bed or an ambience follows the picture without a
voice per swell.

- **Place each event's peak at the second its picture appears.** Frame `i` sits at
  `i / hz`. Find the frame with draw's own arithmetic rather than an estimate of
  it, and the two cannot drift. A sound is heard where it peaks, not where it
  starts: a `voice` body peaks `attack` after its start, and a `tail` with
  `tail.rise` that long after it, so a swell, a whoosh past the camera or a
  riser into a hit starts that much before its cause's second and peaks on
  it, while a `strike` peaks within milliseconds and starts on the frame.
  A caused sound takes its time from its action, not from a beat grid: a hit
  moved to the nearest beat is heard up to half a beat off the frame that
  shows it, and reads as dubbed. Where the music leads, the action itself is
  composed onto the beat, so the two still meet
  ([music](music.md#when-music-leads)). Cut the sound with the shot list the picture
  uses: `shots(list, timeline)`. A sound that leads or trails its picture, or
  whose cause is off screen, says so; see the scaffold below. The `--sound`
  strip ([look at nine seeds](making.md#look-at-nine-seeds)) shows each event's start
  against the frame of its cause, and `--json` lists the starts in
  `sound.profile.events`: read the onset there rather than with a script of
  your own. A swell's onset there leads its cause by its rise on purpose.
- **Set each control on every drawn frame.** At `i / hz`, give the AudioParam
  the value of the snapshot `draw` shows on frame `i`, through the lookup `draw`
  uses rather than a copy of it: `setValueAtTime` on the first frame,
  `linearRampToValueAtTime` after. The sound is continuous and still sampled
  from exactly the frames the film holds.
- **Map through the ear's scales.** Cents for pitch and a logarithm for level
  keep a quantity that falls through orders of magnitude audible for its
  whole course, where a linear map goes silent after its first second. Scaled
  against a bound it cannot exceed, a calmer run sounds calmer; scaled against
  one run's own peak, every run sounds alike.
- **Silence can be state.** A level measured from a threshold, the smallest
  value that is heard at all, reaches zero where the quantity falls below it,
  so the sound starts and ends with its cause; a fade the clock schedules ends
  it on the clock's time instead.
- **Keep the bass in the middle and centre the rest on the sound.** A voice's
  pan width that grows with its pitch keeps the lowest voices centred, as
  mixes keep them: a panned voice loses up to 3 dB when a phone or a mono
  speaker folds the mix to one channel. The others panned from the middle of
  the voices that may move, weighted by power and width, keep the mix centred
  on the sound; panned from the middle of the picture, the loudest elements
  lean the whole mix to one side.
- **Keep every control a function of the state.** A test can then pool
  (state, value) pairs from every frame of two different runs and require one
  curve through them; a control driven by the clock gives two answers for one
  state.
- **One solved state feeds both.** Positions, counts and timings come from
  `state`; a `sound` that re-derives them from constants of its own drifts
  from its picture by the difference.
- **Noise comes from the seed.** Fill buffers from `rng(seed)`; an unseeded
  generator makes the soundtrack a function of when it was rendered.
- **Mix the balance; the film sets the level.** The MP4 export brings every
  soundtrack to -14 LUFS, about the level platforms that play films turn a
  louder upload down to, so a film plays as loud as what plays beside it. Where its true peak would pass -2 dBTP first, a
  look-ahead limiter turns the peaks down, so drums and voices reach the
  target too; a `seeds --frames 9 --sound --png` strip prints the gain and
  cut before you export, and the export report's `sound.limited` says how deep it cut,
  `sound.beats` (or `sound.blocks`, every 400 ms, without a beat sheet) how
  deep in each beat, and, for the rows of `cues.sounds`, `sound.events` how
  far each stands over the bed before it, with `sound.buried` and
  `sound.close` counting those that sink into it or land on one another
  ([soundtrack loudness](../../../docs/knowledge/output-formats.md#soundtrack-loudness)). A
  sparse soundtrack, where few of its 400 ms blocks are loud enough to
  count toward loudness, is limited less deeply (the thresholds and the
  ramp are in [soundtrack loudness](../../../docs/knowledge/output-formats.md#soundtrack-loudness)).
  Set voices against each other, not the overall level. Peaks that would need
  more than the limiter's depth stop the gain, so such a film plays quieter
  than -14 LUFS; when it ends more than
  [3 LU](../../../docs/knowledge/output-formats.md#soundtrack-loudness)
  under it, `sound.short` says by how many LU. A short sparse film stops at
  its shallower depth with `sound.short` set. Raising the quiet body or the
  bed against the peaks in the piece, until the quiet beats' `rmsDb.max` sits
  3 dB under the peak beat's, lifts the loudness inside the margin
  [plan intensity with the story](films.md#plan-intensity-with-the-story)
  keeps; past it the quiet beats stop reading as quiet, and flattening the
  peak reaches -14 LUFS and loses the range. A film still short at that
  margin keeps its range, with `sound.short` and the margin named in the
  report. Silence anywhere, a silent start or end included,
  lowers the share of blocks that count, and the limiter's depth falls with
  it; a bed over the ends counts only if it is within about 10 LU of the
  soundtrack's loudness. A mix keeps its own transients when attacks are
  softened or peaks tamed in the piece. `npm run browser` reports each
  decoded film's loudness, true peak and limiting.
- **Sum voices two at a time.** Installed Edge adds up three or more
  connections into one input in an order that changes from render to render,
  so such a graph renders other last bits each time, and its film other audio
  bytes. Two add up the same either way round. Connect many voices to one node
  with `sumInto(ctx, voices, into)` from `core/sound.js`, and one browser
  renders the soundtrack and its film to the same bytes every time, as it does
  for every example that declares sound. Compare a soundtrack with a wider sum by
  measurement. `npm run browser` requires two renders of each example to be
  the same bits. Engines differ further, like pixels.
- **Replay's noise verdict is a report, not a direction.** `npm run replay`
  judges a soundtrack below the band its codec kept, and its noise by level,
  so a hiss, a breath or a pluck's attack can miss the verdict. The verdict
  names a block, its time and its measure, and that is what goes in the
  report; it is not a reason to soften a sound or change the art.

## Voices, a place and a room

A bare oscillator blip sounds like a test tone. `core/sound.js` gives a voice
in layers, the ambience of a place and a room for them to sound in; none names
an instrument, so the subject decides what they are.

```js
const { sumInto, voice, ambience, room, pluck } = require('artifex/core/sound.js');
const R = rng(state.seed);
const v = voice(ctx, R, 'impact 3', seconds, {
  pitch: 220,                                   // the body's first partial, in hertz
  partials: [[1, 1], [2.76, 0.4], [5.4, 0.15]], // [ratio, level]: whole ratios ring, others clang
  detune: 7,                                    // cents: each partial doubled that far apart, beating
  attack: 0.005, hold: 0, decay: 1.2, damp: 0.5, // higher partials die sooner as damp grows
  strike: { level: 0.3, length: 0.02, colour: 4000 }, // the transient: seeded noise in a band
  tail: { level: 0.05, length: 1, colour: 440 },       // the air it leaves: seeded noise, longer
  level: 0.4, pan: -0.2,                         // or [[seconds, pan], ...] to move it; tail.rise swells the tail
  velocity: 0.7,   // 0..1: how hard it starts; softer is quieter and darker
  vary: 0.5,       // 0..1: this voice's own seeded pitch, level and decay
  bend: [[0, -150], [0.1, 0]],                  // [seconds, cents]: the pitch glides as it sounds
  vibrato: { depth: 10, rate: 5.5, delay: 0.3 }, // cents either way, times a second, from a delay
  sweep: [[0, 800], [0.2, 5000], [1.5, 1200]],  // [seconds, hertz]: a low-pass that opens and closes
  fm: { ratio: 1, index: 2 }, highpass: { peak: 600 }, // sidebands that fade as it dies; a thin start whose lows bloom
  distance: 0.4,   // 0..1: far is quieter and darker; send it more to the room
});
const rain = ambience(ctx, R, 'rain', 0, {       // the place: a low bed and small events
  length: 8, colour: 2800, band: 1.5, level: 0.004, drift: 0.3, pace: 0.3, fade: 1.5, // pace: how often a second its colour and level wander
  tint: 'pink',                                   // the bed's noise: 'white' (default), 'pink' or 'brown', softer and less hissy
  grains: { rate: 160, length: 0.012, chirp: 0.6, level: 0.045, spread: 24 }, // drops as rising bubbles
});                                               // rate: [[0, 20], [5, 200], [8, 60]] builds and thins; noise: true makes dry ticks
const hall = room(ctx, R, 'room', { size: 1.6 });     // a convolver of seeded noise
```

- **Build each sound from its three layers.** The transient is the contact, the
  body what rings, the tail what lingers. Most of a sound's character is in its
  partial ratios and how fast each dies, so each element with its own recipe
  reads as its own thing, where one voice at several pitches is one
  instrument for everything. The recipe follows the contact, not the thing:
  a thing that meets another and then lands on a surface makes two sounds,
  and one recipe for both says the same event happened twice.
- **For anything taut that rings when let go, use `pluck`.**
  `pluck(ctx, R, name, at, { pitch, decay, level })` renders a plucked string
  offline, its highs dying first as a real one's do. In the film scaffold, a
  row with `pluck` in place of `voice` plays one, centred, at the room's
  `SEND` unless the row gives `wet`.
- **For a contact on a thing that rings, use `impact`.**
  `impact(ctx, R, name, at, { modes, contact, velocity, level })` is one hit.
  What is hit is its `modes`, `[hertz, seconds, level]` triples, each dying
  over its own time: two or three close modes under 0.15 s read as wood or a
  box, long high ones that are not whole multiples (1, 2.76, 5.4, 8.9 times
  the lowest, 1 to 4 s) as metal or glass, one low mode under 0.2 s as a
  thud. How it is hit is `contact`, the seconds the touch lasts: 0.0005 is a
  hard tap that rings every mode, 0.005 a soft or padded one that leaves the
  high modes dull. `velocity` makes a softer hit quieter and duller at once,
  so hits at different speeds on one thing sound like one thing. A
  simulation's contact gives `at` from its frame and `velocity` from its
  speed. A `voice` stays the choice for a sound that is held, bent or swept.
- **For many small things striking, use `shaker`.**
  `shaker(ctx, R, name, at, { length, rate, ring, energy, modes, level })`
  places nothing by hand: `rate` collisions a second fall at seeded moments,
  each a burst of noise through what is struck. Rain on a hard roof is about
  400 a second with a 0.004 s `ring` and a mode near 5 kHz; gravel underfoot
  30 to 80 a second with a 0.02 s ring and modes from 800 to 2500 Hz; grain
  poured 2000 a second, short and bright. `energy` and `rate` take
  `[[seconds, value], ...]` points, so a fall builds and thins and a shake
  dies. It is dry noise, where an ambience's sine grains read as wet. Both
  return a mono source: pan it and send it to the room as any voice.
- **Give the sounds dynamics, or they sound dead.** Events at one level read
  as a machine. A phrase, sparse and soft, building to a height, then
  thinning, with the picture on the same curve, reads as played. Each event's
  `velocity` set from its cause, such as its weight, speed or nearness, makes
  an accent both louder and brighter; `vary` on repeated events keeps any two
  strikes apart. Louder and brighter is the default, not a law: for a cry held
  back, a high level with `sweep` kept closed is loud and dark.
- **Give a sound the shape class of its cause.** Round: whole-ratio partials
  and a soft strike. Straight: a long hold, low and damped. Sharp: inharmonic
  partials, a hard short strike and a fast decay. A motif's contour shaped
  like its element's path does what [shape language](stills.md#shape-language)
  does for forms. The cause's size sets pitch and weight too: a larger cause
  sounds lower, with a slower attack and a longer tail, about an octave down
  for twice the size.
- **Decide the sound before the motion that answers it.** A sound's character
  sets the reaction it causes, and a reaction timed apart from its sound reads
  as a second event. A dull, heavy thud asks for a slow sag and a long settle;
  a bright, short click asks for a small jolt that stops at once. The voice
  chosen in the plan first times the reaction to its attack and decay. Hits
  sort into three tiers, each its own recipe and its own reaction: light, a
  short bright `strike` with little body and a jolt that stops at once;
  medium, a body with a short ring and a squash that settles; heavy, a low
  body with a long `tail`, a sag and a long settle, and the view
  [shaken along the hit](films.md#camera-and-framing). The cause's
  size or speed past set thresholds picks the tier and `velocity` varies the
  hit within it, so a soft heavy hit still reads heavy; one recipe scaled by
  level reads as one hit at three volumes.
- **Design a sound by how it reads, not by its physics.** A viewer judges a
  sound by what it suggests, not by what the real source would make, and a
  faithful recording often reads duller or muddier than its picture. A break
  reads as a dry snap with a short ring; a fire as a dense granular crackle
  over a low rush; a light thing landing as a soft tap with no tail. The three
  layers build that reading.
- **Tell an action's direction by its sound.** Where the picture alone leaves
  open which way an action goes, such as opening or closing, arriving or
  leaving, or picking up or setting down, a pair of sounds that read apart,
  such as a light, short click for one direction and a heavier, darker strike
  with a body for the other, used the same way every time, tells it, and a
  short film can then skip the action's middle. On a `--sound` strip the two
  sounds differ plainly in attack and level; a listener who plays each
  instance of the action and names its direction by ear confirms what the
  strip cannot.
- **Take pitch from a scale held in the state**, by degree: look the degree up in the scale's semitones
  over the root (major is 0, 2, 4, 5, 7, 9, 11), and `hertz(root + semitones)`
  from `core/sound.js` turns that MIDI number into the voice's `pitch`. A
  pentatonic scale
  never clashes and never pulls; tension beats on degrees that pull, and the
  final image on the root, give the film a cadence. Where the picture hides a
  threat, a pulse whose rate follows a state quantity, such as the distance to
  it, tells it.
- **Let each note move while it sounds.** A held pitch at one colour is a
  machine. A note that falls in or rises out with `bend`, swings with
  `vibrato` after a delay, and opens and closes its colour with `sweep` is
  heard as played; its motion taken from the cause reads as the cause: a
  closing bubble rises, a passing engine's note drops as it goes, a gust
  opens and then closes. A source that crosses the frame crosses the
  field too, with `pan` as `[[seconds, pan], ...]` points that follow its
  place on screen (in the film scaffold, the room send follows the same
  points).
- **Put the sounds at their distances.** `distance` set from the cause's
  place makes a far sound quieter, darker and wetter than a near one, and a
  room send that grows as the dry sound falls keeps it in its space; the
  [film scaffold](../film-scaffold.cjs) does that when a sound gives no `wet`. A
  thing that moves toward the viewer comes nearer. Limiting past about 4 dB,
  on the `seeds --sound` line or as the export report's `sound.limited`, says the limiter is flattening the accents.
  The depth follows the balance of the accents against the rest, since the
  export sets the level with one gain: the accents down N dB or every other
  part (body, beds, ambience, effects) up N dB limit to the same depth, so a
  larger move, not its side, brings it under 4 dB ([music](music.md#looking-at-the-score)).
  How far an accent then clears the bed is set by the bed, not the accent's
  level: the export leaves about 12 dB between the -14 LUFS loudness and the
  -2 dBTP ceiling, and the bed's own true peak takes its share of that room.
  A bed whose peaks sit 11.7 dB over its loudness left one film's hits 1.4 dB
  above the bed's peaks after an 8.7 dB cut. A steady bed with no slow swell,
  or one that dips under the accent as music ducks under speech, leaves the
  accent more room; `sound.events` in the export report says how far each
  planned one stood over its bed.
- **Many small hits are one sound.** Hits closer than about 50 ms apart, such
  as a pile settling, a shower of fragments or many feet at once, stop being
  heard one by one, and each voiced on its own frame chatters like a machine.
  Voice the few nearest or heaviest on their frames and the rest as one
  texture under them: one `ambience` (`level: 0` leaves out its bed) whose
  `grains` set `noise: true`, as many a second as the picture shows, dry
  where sine grains read as wet, and one row however many grains it holds.
  Give it a short `fade`, such as 0.1, so it starts and stops with the hits
  rather than swelling in over the default second, and give its row a `wet`
  near the hits' room send, since an ambience otherwise stays out of the room.
  The scaffold folds that send to one channel, as it does a voice's, so each
  grain's echo fills both sides of the room, as the hits' does. With distance the voiced hits drop out first, until only the texture is
  left, quieter and darker: a lower `grains.level` and `colour`.
- **A sliding contact is one voice that follows the motion.** A tool that
  rubs, scrapes or makes marks on a surface sounds as friction, not as a row
  of hits. The lines below come from seven films of one kind measured from
  their saved soundtracks and from one viewer's blind remarks on them; one
  film per case. A voice built this way was then heard beside a burst per
  mark over one test picture and chosen by ear: in the burst version the
  dense passage stood 23 dB over the slow strokes, in the one voice 2 dB.
  - One noise voice per tool. Its level and brightness rise with the tool's
    speed, dip at each turn, and fall silent at each lift; a soft tick marks
    a set-down.
  - A burst per mark fails when the marks come fast. Bursts overlap by their
    rate times their length, and overlapping noise adds in power: at about 30
    bursts at once (930 marks a second, 35 ms each) one film's level stopped
    moving, rose 8 dB and was heard as white noise. Its level motion at 2 to
    20 Hz fell from 0.69 of its mean to 0.11.
  - One texture at a fixed rate and colour fails the other way. A film whose
    marks went from 5 to 600 a second over a texture held at one rate kept
    the same onsets, level motion and brightness, and was heard as not
    sounding like hundreds of marks.
  - So past about 20 marks a second keep the one voice, and let the density
    of the marks raise its grain rate, its level by a few dB and its
    brightness together, while its level still moves at a rate the ear can
    count: the tool's back and forth, or the lift between patches. Keep
    separate accents for slow marks and set-downs.
  - Colour: the films heard as a tool on its surface kept under a quarter of
    the voice's energy above 4 kHz. One with a strong mode near 7 kHz and a
    click at every lift was heard as raspy, and a third of its energy sat
    above 4 kHz.
  - Balance: while the tool is what the shot is about, its voice stays within
    a few dB of the mix. In the film whose tool sound was heard as getting
    worse, a bed rose under the busiest marks and the tool fell from 2 dB
    under the mix to 15 dB under it, while its own level never changed.
  - The `--sound` strip shows it: the voice's trace rises and falls with the
    marks, stays up but uneven where they are dense, and no bed climbs over
    it there.
- **Keep the busiest stretch legible.** A climax built from more of every
  voice turns to noise once the viewer can no longer tell which thing made
  which sound. In one measured film, 21 hits a second from 16 sources, up to
  6 on one frame and about 15 voices ringing at once, gave under 6 separate
  onsets a second: most hits had fused. Its overall level rose only about
  2 dB, so loudness was not the cause, and turning the stretch down does not
  help. Four things keep each sound tied to its cause. Thin: the focus and the few heaviest or nearest contacts in full,
  the rest quieter, shorter and further, or in the texture above; a source
  that repeats faster and faster, such as a thing settling, keeps its first
  strikes and hands the rest to that texture, and each repeat of one hit in
  a row a step quieter than the last, so the first reads as the event and
  the rest as its echo where equal repeats read as a loop. A hit pushed
  further keeps its room send at a near sound's, as mixing by what the shot
  is about, below, says: in the scaffold a row with no `wet` takes more room
  as its `distance` grows.
  On any one beat, at most two rows of the cue table stand forward; a third
  fuses with them. Space: a decay set shorter as
  the rate rises dies before the next onset in its register, and a room send
  lowered as the stretch fills keeps the room's tail from covering the next
  onset in that register. Register: each source in its own band, as
  [music](music.md#arrangement-part-by-part)
  sets parts; a low voice masks the voices above it more than they mask it,
  so a long low ring under the busiest stretch buries them. Cause: one recipe
  for each kind of contact, so two kinds of event the picture shows sound as
  two. The peak then rises with more of the focus, on the curve
  [plan intensity](films.md#plan-intensity-with-the-story) sets. The densest
  moment need not be the loudest: density that peaks just before a drop of
  0.4 s or more, about 15 dB under the loud passages with the room tone
  holding through it, lands the climax in the drop, where more level only
  flattens it.
- **Mix by what the shot is about.** Each scene's sound focus, named in its
  plan, decides what sits forward. An effect that is not the focus dresses the
  scene and sits under the place and the other sounds: at the `distance` the
  framing shows, with its room send kept at a near sound's (the scaffold's
  `SEND`, through the row's `wet`) rather than grown, and with no `tail`, so
  it leaves no echo of its own; a close view on its source brings it forward
  and dry. A contact's level set from the action's size and the camera's
  distance puts a small touch seen wide a little over the ambience, quiet and far
  but still heard, as it would be heard there; one level with the other events
  is heard where it is not. Every [planned contact](making.md#depth-order-and-contacts)
  gets its sound, however quiet: a touch the picture shows with no sound is
  heard as a missing beat, or as a thing that weighs nothing, and a viewer
  notices that gap more than a quiet sound. Played through each planned
  contact's moment, a contact heard landing has its sound; where nothing
  lands, its row is missing, at level 0 or buried under the bed, the causes
  below. A soft contact voiced short and from noise with no ringing body is a
  `strike` alone over a silent body (`partials: [[1, 0]]`, which needs no
  `pitch`; nor does a voice with every partial at level 0 or the voice itself
  at `level` or `velocity` 0, but a `pitch` you give is still checked; a
  `tail` over that silent body needs its own `tail.colour`, since it has no
  `pitch` to default to). That `strike` defaults to `level` 0, which is
  silent. A contact meant to be heard has a body or a `tail`, not a bare
  strike: on the `--sound` strip a strike alone reads about 26 dB under a held
  voice of the same level, so a bed set for the other events buries it. Sine
  `ambience` grains read as wet; `grains.noise` makes them dry. As the view
  closes on one subject, most of the other event voices drop and the rest move
  back, and return as the view opens; the bed and the ambience hold through
  those cuts.
- **Delay a far event's sound by its distance**, about 3 ms a metre, once the
  gap passes a frame (about 14 m at 24 fps): added to the event's time, a
  strike 60 m off lands about four frames after its picture. In the scaffold,
  the row takes `trail` if its cause has left the frame by then.
- **Let the sounds tell the hour in a held place.** While the picture holds
  one place, the events its ambience carries and how dense they are, changed
  over the stay, pass the time of day without a cut.
- **Name every voice by its cause**, such as `'drop 4'`: its noise is
  `R(name, …)`, so adding a voice never changes another.
- **Play each place's sounds in its one room.** Each voice with its own send,
  sized by its distance, the sends summed into its place's room with
  `sumInto`, and the rooms summed with the dry mix into the output, puts every
  sound of a place in one space. `voice()` returns its output already panned,
  so a send taken from it gives a panned voice a one-sided room; a send taken
  from an unpanned voice with the dry path panned by hand, or folded to one
  channel as the scaffold does (a gain held to one channel, divided by the
  panner's sum), keeps the room centred.
  The scaffold's `ROOMS`
  gives a place its room by the name of the place's element, named
  `'room <place>'`; a sound outside every such place plays in `ROOM`. An
  ambience is already the wide, diffuse sound
  of its place: the scaffold keeps it out of the room unless its row gives
  `wet`, which suits events you want heard in the same space. `size` is the
  seconds it takes to fall to -60 dB: under half a second is a small space,
  two or more a hall. Another seed is another room of the same size.
- **Lay a bed under the effects, one per place.** A film whose sounds all
  start and stop on events has silence between them. A bed per place, one or
  two voices with a slow attack and a hold across the place, low in pitch and
  10 to 20 dB under the focus's events, any beating on its upper voice rather
  than its low one (below), gives the
  effects something to sit on. A `level` is linear amplitude: a ratio r between
  two levels is 20 log10 r dB (0.3 is about 10 dB under 1, 0.1 is 20 dB).
  The shape adds to it: on the `--sound` strip's 50 ms measure, at one level
  a held voice reads about 2 dB over a struck voice of one partial and about
  26 dB over a strike alone (`partials: [[1, 0]]`, `strike` only), and an
  ambience about 6 dB over the held voice. So a bed 15 dB under a one-partial
  event takes about a seventh of its level, and under a strike alone about a
  hundredth; the bed set from these numbers shows its gaps on the shot's
  strip. `detune` splits every partial, and each pair
  beats about (pitch x ratio) x cents / 1731 times a second. The two copies
  start in phase, so a partial's level falls from the start and reaches a
  null half a beat period in: a beat whose period is under twice the place
  still reaches that null inside it, and one fast enough to repeat pulses
  like a machine. The loudest
  partial's beat is a level swell of the whole bed: 6 cents on a 55 Hz
  fundamental beats every 5.2 s, so its first null falls 2.6 s in, and one
  measured bed rose and fell about 5 dB on that clock with nothing causing it,
  the climb the next lines warn against, repeated. The level holds within
  half a dB while the place's length times the beat rate stays under about
  0.1: for a 55 Hz voice in a 10 s place that is about 0.3 cents, so keep a
  loud low voice undetuned. `detune` is one value for a whole voice, so a
  beat meant to shimmer goes on a second voice of upper partials, detuned,
  over the undetuned low one. The bed, the ambience and the room belong to
  the place, not the shot: running under every cut inside it they hold the
  air, and a cut where they stop is heard as a jump in it. They change where
  the place itself transforms, the two overlapping over the old one's decay
  and the new one's attack. Within a place their level holds: a bed or an
  ambience that climbs a few dB partway, with nothing in the place or the
  picture causing it, and stays up is heard as the noise being turned up, not
  as the place changing, and from there on it narrows the gap under every
  event (`sound.gaps` shrinks from that shot). A rise that means something has
  its cause on screen or comes back down, as the bed brought in on a beat, the
  swell and the staged tension below do. `grains.rate` points hold their last
  value after the last point, so a build meant to pass ends on the place's
  resting rate. Heard alone, a bed with no such cause sounds as loud at the
  end of its place as at the start. A place at digital zero is heard as the film
  stopping; its quiet is its own low tone, which painters keep. The first
  place's bed or ambience starts at frame 0, not with the first cue: a viewer
  who unmutes early and hears nothing reads the film as broken. Between cues,
  the held bed, ambience grains or a low event far under the focus carry the
  gap. A planned silence, such as a held breath before a blow or a stop before
  a drop, is short, marked in the cue table and framed by sound. The `--sound`
  strip shades each stretch of 0.5 s or more under -60 dBFS
  (`sound.silences`), so each shaded span is either in the plan or gets a bed;
  a quiet room tone above that floor is not shaded. A place whose
  ambience is rich may hold its bed back for a stretch and bring it in on the
  beat that should feel it, so its entrance is an event, before any melody
  over it. After the heaviest beat, a planned gap with only the room tone is
  the release.
- **Give a place its ambience when it has one.** Rain, a stream or a street
  (wind is gusts, below) is heard as many small events more than as noise:
  `ambience` grains in the place's band, such as bubbles that rise as they
  close for water, over a bed low and dark. A steady band of noise at the
  level of the events is heard as white noise, not as a place; an ambience
  20 dB or more under the focus's events (its `level` is the noise's RMS per
  side, so it reads about 6 dB over a held voice of the same level; see the
  bed above for turning levels into dB) is heard as the place, with a
  contact that only dresses a wide shot a little over it. The grains carry the
  ambience's dynamics, not its bed: `drift` only wanders the bed's colour and
  level, while `grains.spread` sets the events apart in level (12 dB by
  default) and `grains.rate` as `[seconds, rate]` points lets them gather and
  thin with the scene, a cluster and then a lull, as rain builds and eases.
  A few seconds of the ambience played alone tell it: separate small sounds,
  some near and some faint, are the place; a hiss is the bed set too high
  against its grains. A bed set very low has a cost of its own: the film's
  replay check can refuse a film made from its own recipe when the grains
  stand far over the bed. Measured in installed Edge 154, a grain ambience
  replayed as AAC and as Opus with its bed's `level` at 1/38 of the grains'
  peak or more and its `colour` from 400 to 4000 Hz; with grains 50 times
  their bed as AAC, 71 or more as Opus, or a `colour` of 8000 Hz, most or
  all of the films were refused
  ([comparing a film's soundtrack](../../../docs/knowledge/output-formats.md#comparing-a-films-soundtrack)).
  A wide bed with `tint: 'pink'` or `'brown'` keeps less
  of the high hiss that makes white noise harsh, so it sits softer under the
  events. Not every
  shot has one. It ends by the film's end: the scaffold refuses one that runs
  past it. Two exceptions, each at most once a scene and
  marked in the cue table with the element whose state it shows: an ambience
  may swell over several seconds until it covers the events, to show a state
  rising, then drop at once to the place's low tone (in the scaffold, key its
  row's `gain`); or the place may fall
  silent before a blow, its grains dropping to nothing a few seconds before
  the beat while the bed holds.
- **Build wind from gusts.** A held band is heard as white noise, and
  sine `ambience` grains as wet. A windy place's `ambience` with no
  `grains`, over a bed low and dark or none, leaves room for each gust as its
  own event: a `voice` with a silent body (`partials: [[1, 0]]`) and a `tail`
  with its own `tail.level` and `tail.colour`.
  A `tail.rise` of a second or more swells it, and its fall over
  `tail.length` starts at that peak; a `sweep` that opens and closes, such as
  `[[0, 300], [1.2, 2500], [4, 400]]`, makes its band rise and fall. Without
  `tail.rise` the tail rises over the `attack` while it already falls, and
  peaks at the end of the attack only while `tail.length` is about seven
  times the attack or more. A gust that crosses the place moves with
  `pan` as `[[seconds, pan], ...]` points, such as `[[0, -0.7], [3, 0.5]]`.
  Gusts varied in colour, length, level and path, with a second or more of
  near silence between them, are heard as weather. A gust the picture shows peaks on the frame of the
  largest movement it causes, panned to where that movement is, at the
  `distance` it is seen; one heard across the place stays 20 dB or more under
  the focus, as an ambience does.
- **Let sound lead or trail its picture where it joins two places.** The
  next place's ambience can rise under the last second of this one, or this
  one's last sound can ring on over the first shot of the next. In the
  scaffold, such a row takes `lead` or `trail` in seconds; without them a
  row starts with its cause on screen.
- **Imply the world beyond the frame.** A sound whose cause is never shown,
  such as a door, a crowd or a storm off to one side, makes the frame part of
  a larger place. Declared through the scaffold's `offscreen: { side, distance }`,
  the voice pans to 0.8 on that side, where a mono fold loses 1.8 dB rather
  than a hard pan's 3, at that distance. Its `cause` is optional; named, it
  keeps the voice's noise stable when rows move. It refuses one whose cause
  is on screen then.
- **Build tension in stages and release it into the place's tone.** Tension
  raised in steps, each adding a layer or lifting the bed's pitch a little
  from shot to shot, then let fall at once to the place's own quiet tone
  rather than to nothing, makes the drop the release. Every event voice
  stopped just before the moment that matters most, with the sound returning
  thinner and darker after it, makes the moment land.
- **Give each element a short motif.** A figure of two to five notes or
  strikes that belongs to one element, and returns each time it acts, varied
  and tightened as the film goes on rather than repeated whole, ties the
  element to its sound. Named operations vary it: slower, in another mode, in
  another register or voice, louder or softer, played short or held, in
  fragments that shorten, over a held low note. The motif of the element the
  film follows, carried through every scene, each changing it by these to suit its mood, ties the scenes
  into one film where a new tune for each starts over. Its last
  return changes what it meant. [Writing a hook](music.md#writing-a-hook)
  says how a motif is built.
- **Mark a threshold with a sound.** Entering another world, another place or
  another state gets one sound of its own on the frame that crosses it.
- **Go against the picture once, on purpose.** On the heaviest beat a film may
  give the sound the opposite feeling to the picture, such as a sweet voice
  over a loss. That beat marked in the cue table as counterpoint keeps the
  sound starting on the frame of its cause.
- **Hold music under the caused sounds.** Music here is any melody, pulse or
  held chord that nothing on screen causes. Below the events the picture
  shows, each sound is still heard as its cause; above them, the music becomes
  the cause. Brought forward on a beat the cue table marks, such as an arrival
  or a turn, and dropped back after, it points at the beat. Under speech,
  singing or a sound the shot features, the music ducks: its gain dips about
  6 to 10 dB (to about 0.5 to 0.3) over about 0.1 s ending as that sound
  starts, holds through it and returns over about half a second after it,
  worked out from the same event list. Music held at one level under it
  competes with it; a dip that drops or returns at once is heard as pumping.
  When the music is the film, read [music](music.md#when-music-leads).
- **`duck` writes that dip from the score.** A film knows when every caused
  sound starts, so nothing has to listen for it.
  `duck(ctx, events, { length })` from `core/sound.js` is a gain: sum the
  music into it with `sumInto` and sum it with the caused sounds. Each event
  is `{ at, length, level }`, a caused sound's start, how long it stays on
  top and its peak. A loud event dips the music up to `depth` dB (6 unless
  given), a quiet detail under `threshold` moves nothing, and the dip starts
  just before the sound and lets go over `release` seconds. Ducking helps
  where the music is dense or held and an event must read through it. It
  does not replace a quieter music level, and sparse music with rests around
  the events needs none. In the film scaffold, `DUCK` does this for every
  row marked `role: 'music'` or `'sting'`; a row's `gain` keys still shape a
  dip by hand, as under speech.
- **Give a strong beat at most one sting.** A sting is a single short accent,
  a second or less, that the music adds to a beat. One on a strong beat
  points at it; several at once, or one on every beat, flatten them all, and
  the rest of the beat belongs to its caused sound.
- **Make the soundtrack hold up heard alone.** Without the picture, a
  soundtrack whose places, events and their order still tell the film, with
  quiet stretches and peaks, tells it beside the picture too; one that makes
  sense only beside its picture follows the picture instead of telling it.
- **The `--sound` strip shows the music against the events.** Each caused
  event rising above the music in the waveform on its cause's frame, the music
  at the waveform floor between events and rising only at a marked beat, and a
  sting as one short stroke on a strong beat, where a run flattens the beats,
  are what the strip can show. For a
  film-scaffold piece the strip also renders the event voices, the bed
  voices (an `attack` of 0.5 s or more) and the ambience apart and prints, per shot, how far the loudest bed
  and ambience sit under the loudest event (`sound.gaps` in `--json`),
  flagging a shot short of the 10 and 20 dB above. What the strip cannot
  show, a listener can: played alone, without the picture, whether the
  soundtrack still tells the film.
- **Every layer fades out over 80 ms** from -60 dB and stops, so a voice never
  ends in a click; an ambience grain fades over 5 ms. The scaffold also fades
  the film's last 80 ms, so a sound still ringing at the end fades rather than
  stopping on a cut; a looping film keeps its level at the seam.
