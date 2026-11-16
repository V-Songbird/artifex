---
type: knowledge
summary: "How to compose a score for an Artifex film, for any subject: when music leads (a music video, a dance, a loop) and when it sits under caused sounds, the form (intro, build, stop, drop, outro) as bars, tempo and metre chosen so bars land on frames, the beat grid from core/time.js that cuts and motion land on, the picture on the beat (key hits on the grid over patterns that keep turning, one parameter for each part, effect strength by section, one event list for notes and picture), harmony and common progressions by mood as scale degrees over a root note, writing a hook, swing, an arrangement that enters part by part, instrument recipes by genre as voice specs, a score that loops, and what the sound strip shows of a score; read with the sound reference for a film whose music leads, or any film that wants a score under its sounds."
related_files: ["skills/artifex/SKILL.md", "skills/artifex/reference/films.md", "core/time.js", "core/sound.js"]
---

# Music

## Contents

- [When music leads](#when-music-leads)
- [Form](#form)
- [Tempo and metre](#tempo-and-metre)
- [The beat grid](#the-beat-grid)
- [Harmony by mood](#harmony-by-mood)
- [Writing a hook](#writing-a-hook)
- [Swing](#swing)
- [Arrangement part by part](#arrangement-part-by-part)
- [Instruments by genre](#instruments-by-genre)
- [A score by rule](#a-score-by-rule)
- [A score that loops](#a-score-that-loops)
- [Looking at the score](#looking-at-the-score)

Read this with the [sound reference](sound.md), which stays
the home of caused sounds, places, rooms and the mix; this reference is the
score: what the music is made of, where it sits in time and how the picture
lands on it. Nothing here assumes what the film depicts: instruments are named
by genre and role, and the film decides what plays them.

## When music leads

- **A music video, a dance, a title or a loop made to be watched muted first
  is told by its music.** The beat grid is the film's clock: every cut,
  entrance and accent lands on a beat, and the picture is composed to the bars
  as a story film is composed to its beat sheet. A film that would read the
  same with the music off is not one of these.
- **A story film with caused sounds keeps the skill's rule.** Music sits
  [under the events](sound.md) and comes forward on a beat the cue
  table marks; the grid still times the music, but the cuts follow the story.
- **In a film the music tells, every note has a visible cause.** The player,
  or the thing that moves on the note, is on screen when it sounds, so a note
  is an event like any other. In the [film scaffold](../film-scaffold.cjs)
  such a row takes its `cause` and no `role`: the scaffold's `role: 'music'`
  warning encodes the under mode, music quieter than any caused voice it plays
  with, and does not apply to music that is the cause. A plain piece with its
  own `sound(ctx, state, timeline)` is the other route, and the one the
  samples below take.
- **What the music is about decides the picture's clock.** A pulse the viewer
  is meant to feel sets the cutting and the motion on the grid; a pulse meant
  to be felt and not noticed keeps the cuts off the grid and only the accents
  on it.

## Form

- **Write the form as bars at the chosen tempo.** Intro, build, stop (or
  break), drop and outro, each a count of bars: a 30 to 45 s film at 100 to
  130 BPM holds 13 to 24 bars of 4/4, so the form is short and every bar
  counts. Two bars of intro, six of build, one stop, six of drop and three of
  outro is one shape of 18; the film's own peak places the drop.
- **Phrases come in pairs of 2 or 4 bars.** The first ends on a half cadence,
  the chord on the fifth degree (V) that asks a question; the second ends on a
  full cadence, the chord on the first degree (I) that answers it. A phrase
  that ends twice the same way is heard as going nowhere.
- **The stop is the trough before the peak.** One or two beats of near
  silence, the room still ringing, then a pickup into the drop: the dip that
  [plan intensity with the story](films.md#plan-intensity-with-the-story)
  asks for before the peak, written as rests. Where the film has a turn, the
  stop sits on it. With the room still ringing, the stop stays above the
  `--sound` strip's -60 dBFS floor and is not shaded as silent; a longer stop
  at digital zero is shaded and heard as the film stopping.
- **The drop is the peak with every part in.** It is the first time the
  whole arrangement is heard together, so nothing enters during it; what
  changes inside it is the hook returning whole and the velocity rising to the
  last bar.
- **The outro thins part by part.** Parts leave in the reverse of the order
  they entered, and the last chord sounds early enough to decay before the
  film's end, with the room's tail inside the film too; a chord cut off by
  the end is heard as a mistake.
- **The middle-third mark of [pace](films.md#pace) is the stop or the drop.**
  A film that places its stop at about a third and its drop just after reads
  as a film that had somewhere to go; one whose drop sits at the end has no
  outro and ends on its loudest second.

## Tempo and metre

- **A beat lasts 60 / BPM seconds; a bar, that times the beats in it.** At
  120 BPM a beat is 0.5 s and a bar of 4/4 is 2 s; at 100 BPM, 0.6 s and
  2.4 s. Every other time in the score is a count of those.
- **Tempo ranges read as feels.** About 60 to 80 BPM is slow and heavy, 90 to
  110 a walk, 120 to 130 driving, 140 to 175 urgent; a halved or doubled
  pulse keeps the tempo and changes the feel, so a 150 BPM score felt in half
  time rolls where the same notes felt straight race.
- **4/4 is the default metre.** 3/4 and 6/8 sway and lilt; 5 and 7 beats a
  bar are heard as unease, since the ear keeps losing the downbeat. `beats`
  in the grid below is that count.
- **Choose a tempo whose bar is a whole number of frames where it can be.**
  At 24 fps, 120 BPM gives 48-frame bars, 90 BPM 64-frame bars, 144 BPM
  40-frame bars; at 30 fps, 100 BPM gives 72-frame bars and 120 BPM 60. Bar
  lines then fall on frames exactly, and the frame the picture cuts on is the
  frame the downbeat sounds on. A bar that is not whole frames lands a cut a
  frame off a beat now and then, near a half frame.
- **Make the film's duration a whole number of bars.** 18 bars at 120 BPM is
  36 s; a duration that ends mid-bar ends in the wrong place for the ear.
- **Give each shot a whole number of bars, so each cut is a downbeat.** The
  shot list in seconds is then bar counts times the bar's length. No helper
  rounds each shot to whole bars or sets the tempo so every cut lands on a
  downbeat: write the bar counts by hand, and pick the tempo whose bar times
  their sum is the film's duration.
- **A scored film leaves the scaffold's `TEMPO` empty.** The scaffold's
  `TEMPO` is a per-shot speed factor that retimes a score written in seconds,
  so a shot played at 0.75 plays its bars at another tempo than the rest.

## The beat grid

`bars` in [`core/time.js`](../../../core/time.js) places bars and beats of one
tempo in seconds and on frames, and `draw` and `sound` both read it.

```js
const { bars, shots } = require('artifex/core/time.js');

const grid = bars({ bpm: 120, beats: 4 });     // 0.5 s a beat, 2 s a bar, straight
const bar4 = grid.seconds(4, 0);               // 8: the downbeat of bar 4
const off = grid.seconds(2, 0.5);              // 4.25: the off-beat after bar 2's downbeat
const form = shots([['intro', 4], ['build', 12], ['stop', 2], ['drop', 12], ['outro', 6]], timeline); // the 18-bar form in seconds, filling a 36 s timeline, every section starting on a downbeat
const drop = grid.frame(9, 0, timeline.hz);    // the frame the drop's downbeat (bar 9, after 2 + 6 + 1 bars) sounds on
```

- **Construct the grid once and keep it in the state.** Built in `build` (or
  at module level from constants) from the tempo the state holds, read in
  `draw` and `sound`, one grid times the picture and the score; a grid built
  twice from constants written twice drifts by the difference.
- **`seconds(bar, beat)` schedules every voice's `at`.** A beat may be a
  fraction, 0.5 for the off-beat (an eighth), 0.25 and 0.75 for sixteenths,
  and may pass the bar, so a fill written as beats 4, 4.5 and 5 of bar 7 runs
  into bar 8 without a second table.
- **`frame(bar, beat, clock.hz)` places a cut or a key on the frame the sound
  starts on.** It rounds as `shots` rounds a cut, so a cut on a bar line and
  the beat on it are one frame; a key track whose keys sit on `frame(...)`
  moves on the beats.
- **A pulse read from the playhead lets a mark breathe with the beat.**
  `((clock.seconds - grid.start) * grid.bpm / 60) % 1` runs 0 to 1 over each
  beat; a scale or a glow that falls from 1 at 0 reads as the beat landing,
  and needs no table of every beat.
- **Motion that lands on a beat keys its arrival on `frame(...)` and starts 2
  to 6 frames before it with `ease.in`.** The move reaches its mark on the
  frame the note sounds; a move that starts on the beat is late by its whole
  length. An accent pose may come up to two frames before its beat, as
  [takes and accents](films.md#takes-and-accents) says.
- **A spring released on the beat gives the landing weight.** `spring({ ... })`
  fed `clock.seconds - grid.seconds(bar, beat)` of the latest beat rings from
  the beat and settles before the next.
- **A fill sits on the last beat of a phrase.** Three or four subdivided notes
  on beat 3.5 to 4.75 of the phrase's last bar announce the downbeat that
  follows; a fill elsewhere announces nothing.
- **Everything either moves on the grid or moves continuously.** Motion that
  starts and stops between beats, at no subdivision, reads as off the music;
  a drift that never stops, or a move keyed on beats, both read as on it.

### The picture on the beat

- **Only the key hits snap to the beat; the patterns keep turning.** A cycle
  that never stops, a rotation, a scroll or a wave, carries the pulse when its
  period of k beats divides the bar: a phase of
  `(clock.seconds - grid.start) * grid.bpm / 60 / k` turns once every k beats,
  and with k of 1, 2 or 4 in 4/4 it meets each downbeat in the same place. A
  period of whole bars meets the downbeat of each phrase that long in the same
  place; a period of 3 beats in 4/4 meets each downbeat a third of a turn
  further on and drifts against the bar. The downbeats, the snare and the
  hook's notes land on top of it as accents. A notch on every beat, each move
  stopping dead until the next, reads as stutter, not as dance.
- **Neighbouring beats do not repeat a pose.** A figure or a mark that hits
  the same pose on two beats in a row reads as stuck. Two or more poses read
  in turn by the beat's count, `poses[n % poses.length]`, never repeat a
  neighbour, and the pose of one bar's downbeat can return on the next
  bar's, which reads as the phrase.
- **Kick, bass and highs each drive their own parameter.** The kick a short
  bump in scale or a push of the camera, the bass a slow one held through its
  note, such as a size, a glow or the weight of a colour, and the hats and
  high parts a fine one, such as a flicker, a sparkle or a line's jitter. One
  parameter that every part drives twitches on everything and says nothing
  about which part played; one parameter for each part lets the eye follow the
  [arrangement](#arrangement-part-by-part), and a part's entrance is its
  parameter starting to move.
- **Effect strength follows the song's section.** Each effect's strength, the
  kick's bump, the flicker's depth, the glow's reach, is about 40% of its peak
  in the intro and the outro, about 70% in the build and 100% only in the
  drop, near zero in the stop. One strength in every section flattens the
  drop; held back until then, the drop is seen as the peak as well as heard.
  One number per section beside the form sets it, read in `draw` from
  `shotAt(form, clock.frame).name`, where `form` is `shots()` over the
  sections alone, kept apart from the cut list: a section cut into several
  shots, as a drop that quickens near its peak is, has no shot named after
  it. [Plan intensity with the story](films.md#plan-intensity-with-the-story)
  gives the curve beat by beat.
- **One list of events drives the notes and the picture.** Each hit written
  once in `build`, its bar, beat, part and weight, is scheduled by `sound` at
  `grid.seconds(bar, beat)` and keyed by `draw` on `grid.frame(bar, beat, hz)`,
  so no note sounds without its mark and no mark moves without its note. Two
  tables written by hand disagree the first time one is edited. Where a
  simulation makes the hits, its [contact log is the
  score](films.md#parts-coupled-in-space): the same one list, read by both.

## Harmony by mood

- **Write chords as scale degrees over a root MIDI number held in the state.**
  A major scale is 0, 2, 4, 5, 7, 9, 11 semitones over the root; natural
  minor is 0, 2, 3, 5, 7, 8, 10. A chord on degree n is the scale's notes n,
  n + 2 and n + 4; `hertz(root + semitones)` from
  [`core/sound.js`](../../../core/sound.js) turns each into a voice's `pitch`.
  Another seed, another root: the score transposes and the film does not
  change.
- **Major and minor each hold seven diatonic triads.** In major, I, IV and V
  are major, ii, iii and vi minor, vii diminished; in natural minor, i, iv and
  v are minor, III, VI and VII major, ii diminished. Upper case is a major
  chord, lower case a minor one.
- **Common progressions by mood**, each one bar a chord in a 4-bar phrase and
  repeated, written as degrees:

  | mood | progression | degrees (semitones over the root) |
  | --- | --- | --- |
  | open, hopeful | I-V-vi-IV | 0, 7, 9, 5 |
  | warm, nostalgic | I-vi-IV-V | 0, 9, 5, 7 |
  | bittersweet | vi-IV-I-V | 9, 5, 0, 7 |
  | resolving, a sentence that ends | ii-V-I | 2, 7, 0 |
  | driving, plain | I-IV-V-IV | 0, 5, 7, 5 |
  | epic minor | i-VI-III-VII | 0, 8, 3, 10 |
  | grave | i-iv-v | 0, 5, 7 (all minor) |
  | descending tension | i-bVII-bVI-V | 0, 10, 8, 7 (V major) |
  | drive or dread | one or two chords, a modal vamp | i, or i-bVII |

- **Modes colour one root.** Dorian (minor with a raised sixth: 0, 2, 3, 5,
  7, 9, 10) is cool minor; Mixolydian (major with a flat seventh: 0, 2, 4, 5,
  7, 9, 10) is bright with a lean; Lydian (major with a raised fourth: 0, 2,
  4, 6, 7, 9, 11) is wonder. A vamp on one chord takes its mood from the mode
  the hook plays over it.
- **A held drone names no mood.** A low note with an open fifth over it has
  no third, so it is neither major nor minor, and held unchanged through the
  film's turn it is heard as machinery running beside the picture, not as
  music about it. One viewer kept a film's picture and would change exactly
  such a score; the track preferred beside it carried a line that changed
  note every half second to second and a half over a low pulse, with short
  stops. A mood chosen for each scene from the table, a chord that changes
  at the phrase ends and on the turn, where the ear expects the music to
  answer the picture, and a line that moves ([writing a hook](#writing-a-hook))
  tie the score to what happens, even under caused sounds.
- **Tension pulls, release lands.** A chord that pulls (V, or vii) on the bar
  before the beat that matters, and the root (I) on the final image, give the
  film a cadence; a film that ends on IV or V ends asking.
- **Film scores drift between triads that share two notes.** From a major
  triad, moving one voice a semitone or a tone gives its parallel minor (C
  major to C minor), the minor a third up (to E minor) or the relative minor
  (to A minor): the P, L and R moves of Cohn (1997), which read as a change of
  light without a change of key, as a cloud crossing the sun does. Voicing
  each chord so each voice moves to its nearest chord tone keeps the drift
  smooth. No helper makes these moves or picks the voicing; a 4-bar drift is
  three lines by hand, each chord's three semitone offsets written out.
- **A pentatonic over the chords never clashes.** The hook written on 0, 2, 4,
  7, 9 (major) or 0, 3, 5, 7, 10 (minor) over the root sits on every diatonic
  chord of its key; the sound reference's [pitch from a scale](sound.md)
  bullet says the same for caused sounds.

## Writing a hook

- **A hook is 2 or 4 bars.** Long enough to carry a shape, short enough to
  return four or five times in a 36 s film.
- **Rhythm first.** A pattern a listener could clap, with a long note or a
  rest where it breathes; a hook with a note on every eighth has no shape to
  remember.
- **Chord tones on the strong beats, passing notes between.** Beats 1 and 3
  hold a note of the bar's chord; the off-beats may step through the scale to
  the next chord tone.
- **One high point.** A contour that rises to one top note and comes back,
  within about an octave, is heard as a line; two tops are two hooks.
- **Repeat with one change.** The second time ends differently, up where the
  first went down, or on the chord tone the first avoided: the call and its
  answer. Seeded by address, `R('hook', 'turn', bar)` choosing the ornament of
  the second ending from a short list, every seed keeps the hook and varies
  its answer.
- **Return it whole in the drop and varied elsewhere.** The skill's
  [motif bullet](sound.md) names the operations, from tempo, mode and
  register to dynamics, articulation and voice. The
  intro hints at it in fragments, the build plays its call, the drop plays it
  whole twice, the outro leaves one phrase of it over the last chord. A film
  of several scenes keeps that one hook through all of them, each scene
  changing it to suit its mood rather than bringing a tune of its own.
- **Its last return changes what it meant.** The same notes over another
  chord, or slower in the minor, end the film on the hook heard new.

## Swing

- **Swing delays the off-beats and leaves the on-beats where they are.** In
  `bars`, `swing` from 0 to 1: at 0 the off-beat sits halfway through the
  beat, at 1 two thirds through (a triplet feel); about 0.3 to 0.5 is a light
  swing, 0.6 to 0.8 a heavy one. Sixteenths on either side of the off-beat
  stretch and squeeze with it.
- **Swing the hats and the melody first, and keep the kick straight.** A kick
  on the on-beats never moves in any case; the parts that play the off-beats
  are what swing. A snare's fill on sixteenths follows the grid's swing.
- **Swing reads as played when the picture's off-beat motion is swung by the
  same grid.** A mark that appears on `frame(bar, 2.5, hz)` lands where the
  hat does; one placed at the straight half beat is heard a frame early
  against a heavy swing.
- **A performer's offset sits on top of the swing.** The skill's bullet on a
  [performer who misses the beat a little](making.md#vary-with-intention),
  about 1 to 1.5 frames at 24 fps, applies to a note the picture shows being
  played; the grid is the metronome and the offset is the player. One
  player's offsets lean together: a player who runs late stays late for a
  phrase and drifts slowly into the next one's lean, while each note draws
  only a small spread around that lean. Offsets drawn on their own for every
  note jitter, which reads as a machine's error rather than a person's feel.
  An addressed draw per player and phrase, such as `R('drum', 'lean', phrase)`,
  eased across the phrase towards the next phrase's draw rather than stepping
  to it, with a smaller one per note added to it, gives that.

## Arrangement part by part

- **Parts enter one per phrase.** A pad, then the hats, then the bass, then
  the kick, then the hook: each entrance on a downbeat, each a phrase apart,
  so the build is heard as growth. Two parts entering on one bar read as one.
- **Each part in its own register, so none masks another.** The bass low and
  alone under about 150 Hz, the chords in the middle, the hook on top, the
  percussion as short noise and a tuned kick; two parts sharing a register
  fight, and the mix is heard as mud.
- **In the film, what enters is seen entering.** Each part's first sound is
  a visible event on its frame: the mark, the figure or the colour that
  belongs to the part appears on `frame(bar, 0, hz)` of its entrance bar.
- **Thin before the stop, everything in at the drop, leave in reverse in the
  outro.** The bar before the stop drops the hats and the chords; the stop
  keeps the room; the drop brings every part back on one downbeat; the outro
  removes them one per bar, the hook last or the pad last.
- **Dynamics follow [plan intensity](films.md#plan-intensity-with-the-story).**
  The number of parts and the `velocity` per note both rise to the peak.
  Take `velocity` from the beat's weight: the downbeat 1, beat 3 about 0.8,
  the other on-beats about 0.7, off-beats about 0.6, and `vary` of 0.2 to 0.4
  on repeated notes, so no two hats are one hat.
- **The whole score plays in one room.** Every part's send summed into one
  `room` with `sumInto`, the sends growing with each part's `distance` as the
  skill's [voices section](sound.md#voices-a-place-and-a-room) says, and
  the room summed with the dry mix into the output, every input two at most.

## Instruments by genre

Recipes as `voice` specs from [`core/sound.js`](../../../core/sound.js); each is
a role, not a thing, and the film decides what is seen playing it. `voice` has
no bowed or blown body; a held tone is a pad or a lead built from these recipes.

```js
const { voice, hertz } = require('artifex/core/sound.js');
const { rng } = require('artifex/core/rand.js');

const R = rng(7);
const root = 60;                                   // middle C: hertz(root) is 261.63
const kick = voice(ctx, R, 'kick 4.0', 8, {        // a sine that falls from an octave up
  pitch: 55, partials: [[1, 1]], decay: 0.25, damp: 1, bend: [[0, 1200], [0.03, 0]],
  strike: { level: 0.3, length: 0.01, colour: 150 }, level: 0.5, velocity: 1,
});
const pluck = voice(ctx, R, 'pluck 4.0', 8, {      // the hook's first note
  pitch: hertz(root + 7), partials: [[1, 1], [2, 0.5], [3, 0.25], [4, 0.12]], decay: 0.8, damp: 1.2,
  strike: { level: 0.1, length: 0.01, colour: 2500 }, level: 0.3, velocity: 1, vary: 0.3,
});
```

- **Kick.** A sine at 50 to 60 Hz with a `bend` from +1200 cents falling to 0
  over 30 ms, `decay` 0.25, a `strike` at level 0.3 and colour 150 Hz. Lower
  and longer is heavier; a shorter bend is a tighter click.
- **Snare.** A `strike` at 1800 Hz over a `tail` of 0.15 s at 1200 Hz, with a
  quiet body at 180 Hz (`partials: [[1, 0.3]]`, decay 0.1): the tail is the
  wires, the body the drum.
- **Hat.** A `strike` alone, colour 8000 Hz, length 0.03, over a silent body
  (`partials: [[1, 0]]`, which needs no `pitch`); 0.08 long is an open hat.
- **Bass.** `partials: [[1, 1], [2, 0.3]]`, `decay` 0.3, `damp` 1, at the
  root an octave or two below the chords: one note a beat or a held note a
  bar.
- **Pluck.** `partials: [[1, 1], [2, 0.5], [3, 0.25], [4, 0.12]]`, `decay`
  0.8, `damp` 1.2, a soft `strike`: the hook's voice in most genres.
- **Mallet or bell.** Inharmonic `partials: [[1, 1], [2.76, 0.4], [5.4, 0.15]]`,
  `decay` 1.5; a little `detune` shimmers.
- **Pad.** `attack` 0.3 to 1, `hold` over the bar, `detune` 6 to 10, a `sweep`
  that opens on entry, such as `[[0, 400], [1.5, 4000]]`: the chord's voice,
  one `voice` per chord tone. Keep a long low tone undetuned or under a cent,
  since its slow beat dips the whole pad ([the bed](sound.md#voices-a-place-and-a-room)
  gives the numbers).
- **Lead.** Three or four partials, `vibrato` after 0.15 s, a `bend` into the
  note from -50 cents: the hook's voice when it is sung rather than struck.
- **An acoustic instrument by name.** `play(ctx, R, name, at, kind, { pitch,
  length, velocity })` of `core/instruments.js` plays one note of `celesta`,
  `vibraphone`, `marimba`, `strings`, `flute`, `brush`, `cajon`, `cymbal` or
  `pluck`, each built from how the thing sounds: a bar's own partials, a bow's
  slow start, a pipe's breath, a vibraphone's slow beat. `recipe(kind, opt)`
  gives the spec to change before playing it. They are dry: send them to the
  [room](sound.md#voices-a-place-and-a-room), the sustained ones (`strings`,
  `flute`) lower than the struck ones, since a held note carries more than
  its peak shows.
- **A genre is a choice of recipes, tempo and swing:**

  | genre | tempo, swing | kick and snare | hats | bass | chords | hook |
  | --- | --- | --- | --- | --- | --- | --- |
  | lo-fi hip hop | 70-90, swing 0.5-0.7 | soft kick, snare with a long tail | closed hat, vary 0.4 | bass, held a bar | pad, dark sweep | pluck or mallet |
  | house | 120-128, swing 0.1-0.3 | kick on every beat, snare on 2 and 4 | open hat on the off-beats | bass, a note an eighth | pad, short hold | pluck |
  | synthwave | 100-118, swing 0 | kick, snare with a bright tail | closed hat on eighths | bass on sixteenths | pad, detune 10 | lead with vibrato |
  | orchestral-ish score | 60-90, swing 0 | none, or a low mallet on 1 | none | pad an octave down, slow attack | pad, long hold | bell or mallet |
  | folk | 90-120, swing 0-0.3 | none, or a soft kick | none | pluck an octave down | pluck, three notes a bar | pluck |
  | jazz-like | 110-160, swing 0.6-1 | a brushed snare (tail only over a silent body, no strike, its own `tail.colour`) | hat on 2 and 4 | bass, a note a beat, walking the scale | pluck, off-beat | pluck or lead |
  | chiptune | 130-170, swing 0 | kick, a noise-only snare | strike alone, 0.02 long | square-like `[[1, 1], [3, 0.33], [5, 0.2]]` | the same, two voices | the same, one high |
  | ambient | 50-70, or no grid | none | none | pad, very low | pad, hold over bars | ambience grains in the key |

## A score by rule

A score made of choices addressed by `R` needs rules that make any choice
sound intended. `core/score.js` holds four, each a short published method:

- **A rhythm spread evenly.** `euclid(k, n)` puts `k` hits in `n` steps as
  evenly as they go: 3 in 8, 5 in 8 and 7 in 16 are rhythms heard the world
  over. Pick `k` by `R` and rotate it for a second part, and two parts lock
  without being the same.
- **A chord one step away.** `shift(chord, 'P' | 'L' | 'R')` keeps two notes
  of a triad and moves the third by a tone at most, so any walk of these
  moves sounds like it belongs, however far it wanders. Draw the moves by
  `R`; return home by undoing them.
- **Voices that barely move.** `lead(from, tones(chord))` sends each voice
  to the nearest note of the next chord without crossing another. A pad or
  a choir voiced this way holds together where chords stacked in root
  position jump.
- **Cuts on bar lines.** `barCuts(lengths, { bpm })` rounds each shot to
  whole bars, so every cut lands on a downbeat. Size the shots first, then
  let the tempo settle their exact length.

```js
const { euclid, tones, shift, lead } = require('artifex/core/score.js');
const { hertz } = require('artifex/core/sound.js');
let chord = { root: 0, minor: false }, notes = [48, 55, 64];
for (let bar = 0; bar < 8; bar++) {
  chord = shift(chord, 'PLR'[Math.floor(R('score', 'move', bar) * 3)]);
  notes = lead(notes, tones(chord));
  euclid(3 + (bar % 2) * 2, 8).forEach((hit, step) => { if (hit) play(bar, step, notes.map((n) => hertz(n))); });
}
```

`play` is the piece's own: it turns a bar, a step and frequencies into
voices on the [beat grid](#the-beat-grid).

## A score that loops

- **The bar count fills the timeline exactly.** With `loop: true` the n frames
  sit at i / n, so the last bar's last frame is one frame before bar 0 comes
  round: a score of whole bars at a bar that is whole frames meets its own
  start.
- **The export lays the tail over the start.** What a looping film's voices
  ring past its last frame, up to six seconds and never more than the
  film's own length, is added to its first frames, so the seam sounds as
  the loop heard twice would. Let the last bar's notes decay and the room
  ring: they carry over. A voice that *starts* past the end still plays at
  the start as well, so start none there.
- **Put the seam on a rest or on a downbeat whose voices start at 0.** A rest
  in the last beat, with the room's tail over it, lets frame 0's downbeat
  land as the next bar; a downbeat at 0 whose voices start at exactly 0 reads
  as the bar line.
- **Keep motion to the last frame.** A loop whose last frames barely change
  fails replay by a hair; the pulse read from the playhead keeps a mark
  breathing over the seam.

## Looking at the score

- **The `--sound` strip shows the onsets on the grid's frames.** Each event's
  `seconds` in the strip's profile sits on a `grid.seconds(bar, beat)`, the
  loudness rises to the drop and thins through the outro, and each part's
  entrance is a step in the RMS line on its bar.
- **The score sounds from frame 0 to the last frame.** A pad, or the bed
  under the first hit, starts on the first frame, and the last chord and its
  room tail end with the film, so the strip shades no silent span
  (`sound.silences`) at either end. A first cue that comes late leaves the
  opening shaded.
- **`sound.limited` past about 4 dB says the drums are too loud against the
  body.** The export brings the soundtrack to -14 LUFS, and a kick that
  stands far above the pad is what the limiter flattens. Only the balance
  counts, since the export sets the level with one gain: every drum down N dB
  and every other part up N dB are one mix after that gain, limited to the
  same depth. When the score is only drums and body (pad, bass, pluck, lead),
  the body up N dB is that move; a bed, ambience, effects or a voice left
  where they were make it a different balance. In one invented score of drums
  and body limited 6.1 dB, either move of 3 dB left 4.4 dB and either move of
  6 dB left 2.8 dB. The size of the move brings the
  depth under 4 dB; which side moves decides only which parts you hear change.
- **A noise verdict on the hats is a report.** Replay judges noise by level,
  so a hat can miss its verdict; the verdict goes in the report, as the skill
  says, and is not a reason to soften the hat.
- **Only ears judge the rest.** Whether the hook is remembered, the swing is
  felt and the drop lands is heard, not measured; the strip proves the score
  is where the plan put it, and a listen without the picture proves it plays.
