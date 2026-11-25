// FILM SCAFFOLD -- structure only, no subject and no look.
//
// Copy this file beside your piece, rename it and fill every slot: the shots,
// the elements and what paints them, the sounds, the ground and the finish. It
// holds the plumbing every film repeats -- shots cut on whole frames, one cue
// table that picture and sound both read, a ground drawn once, a room for
// each place the sounds play in, voices summed two at a time -- and nothing
// that decides what the film is. The style guide you follow decides that. An
// empty slot draws and sounds nothing.
//
// THE STORY SPINE. Write it first, one line each, only what is seen or heard:
// the subject and what it wants; under it, what it does to get it and why that
// should work in its own eyes (the means follows from the want, and an absurd
// means needs an earlier shot that sets up why the subject trusts it); what
// stands against it; what in its own body or form works against it, shown at
// work in its first shot; what it needs, which the turn crosses to from the
// want; what is lost if it fails; what it does every day; until one day...;
// because of that... (as many links as the length holds, each read as "because
// of that", never "and then"); the crisis, two wants the film's rules make
// exclusive, both in view, the one given up lost; until finally...; and ever
// since.
// Then the final image, and what earlier in the film it pays off, and Left
// open: the one question the film does not answer on purpose, or none. A piece
// with no protagonist writes the order of its states instead. See Plan the film
// in the skill's films reference.
//
// THE BEAT SHEET. Write it here, in seconds, before the code: whose scene each
// scene is, the subject whose point of view the film takes there; each shot's
// beats, each beat's intensity, the thing whose state it changes and how, what
// the viewer knows, the background action under it, a sound line (what is
// heard, and what it adds that the picture does not show), and the physical
// event that carries each transition, and in a film over about a minute, the
// hold-back before the subject commits and the worsening that leaves it no
// other choice. Then turn it into the tables below, the things into
// ELEMENTS and the beats into BEATS. A film held to two values on purpose,
// such as flat silhouettes or a figure-ground inversion, also declares them
// here, on a comment line of its own that opens with the words two values
// and a colon, then the dark and the light OKLCh L (see
// skills/artifex/reference/films.md#colour-across-the-film); seeds reads it.
//
// THE TREATMENT. A brief of one line gets the rest of the film on paper here,
// a line or two each: the shot list (each shot's seconds, whose scene it is,
// the beat it carries, angle, height, lens, movement, framing, what is in
// frame and what is kept out), the staging, the light and time of day, the
// palette, the marks and their drawing order, and Chosen, not given: one line
// per choice the brief left open, what was chosen and what else it could have
// been. See skills/artifex/reference/films.md#the-treatment.
//
// THE LOOKS TO LEAVE OUT. Name them here too.

'use strict';

const { rng } = require('artifex/core/rand.js');
const { span, ease, shots, keys } = require('artifex/core/time.js');
const { layer } = require('artifex/core/layer.js');
const { sumInto, voice, ambience, room, pluck, duck } = require('artifex/core/sound.js');

const W = 1280;
const H = 720;
const HZ = 24;

// How a refusal prints the value it was given, without throwing on any value.
const shown = (value) => {
  if (typeof value === 'function') return 'a function';
  if (typeof value === 'number') return String(value);
  // A NaN or Infinity nested in a list or object is printed as written, not as null.
  const mark = (_key, one) => (typeof one === 'number' && !Number.isFinite(one) ? `\0${one}` : one);
  try { return JSON.stringify(value, mark)?.replace(/"\\u0000(NaN|-?Infinity)"/g, '$1') ?? String(value); } catch { return typeof value === 'bigint' ? `${value}n` : 'an object that cannot be printed'; }
};

// THE SHOTS, in seconds, in playing order: [name, seconds]. They fill the film.
const SHOTS = [['first', 4]];
// Refused by its name before the first read below.
if (!Array.isArray(SHOTS)) throw new Error(`the SHOTS table is not a list of rows, got ${shown(SHOTS)}: write it as a list, such as [['first', 4]]`);
if (SHOTS.length === 0) throw new Error(`the SHOTS table has no rows: add at least one shot, such as ['first', 4]`);
const shotIndex = new Map();
// An indexed walk, so a hole in a sparse list is refused as a row that is not a pair.
for (let i = 0; i < SHOTS.length; i++) {
  const row = SHOTS[i];
  if (!Array.isArray(row) || row.length !== 2) throw new Error(`shot ${i} is not a [name, seconds] pair, got ${shown(row)}: write each row as a pair, such as ['first', 4]`);
  if (typeof row[0] !== 'string' || row[0].trim() === '') throw new Error(`shot ${i} has a name that is not a non-blank string, got ${shown(row[0])}: name it with text, such as 'first'`);
  if (shotIndex.has(row[0])) throw new Error(`shot ${i} repeats the name ${shown(row[0])} of shot ${shotIndex.get(row[0])}: give each shot its own name`);
  shotIndex.set(row[0], i);
  if (!(Number.isFinite(row[1]) && row[1] > 0)) throw new Error(`shot ${i} has seconds that are not a positive finite number, got ${shown(row[1])}: give its length in seconds, such as 4`);
}
const DUR = SHOTS.reduce((sum, [, seconds]) => sum + seconds, 0);

// THE TEMPO, to try a blocked shot faster or slower: { shot name: factor }.
// 0.75 plays the shot in three quarters of its time, 1.3 in 1.3 times it.
// Keep writing every table in the seconds above, as if TEMPO were empty:
// "write the cues" retimes them once, before they round to frames. The factor
// scales the shot's length and the cue tables' times inside it, from the
// shot's start: each element's enter, exit and keys, each beat, camera key,
// contact and sound, a sound's lead, trail and gain keys, and an ambience's length. Every
// later time moves by the change in the shot's length, and a time on a shot's
// start lands on its cut. What runs in seconds keeps its speed: the
// life.since and the clock a paint is given, a voice's shape, and an
// ambience's grain rate keys and fades (each fade halves to fit a length
// shortened under twice it). So time a move meant to scale with the shot from
// life.u or the row's keys, not from life.since. FOCUS names shots, so it
// needs no retiming. Empty, every cue stays where its table puts it. A name
// that is not a shot, or a factor that is not a positive finite number, is
// refused.
//   { first: 0.75 },
const TEMPO = {};

// THE HORIZON, in design units: the y of the eye's level, for a level view.
// null leaves it out; anything else that is not a finite number is refused at
// build, whatever the rows give. A row that stands on the ground gives `foot`,
// the design y its feet touch, and may give `tall`, its height over the eye's
// (default 1, its top on the horizon): the build keeps `height`,
// (foot - HORIZON) * tall, on the row for its paint, and refuses feet on or
// above the horizon, which float. See Camera and framing in the skill's films
// reference.
//   300,
const HORIZON = null;

// THE CUE TABLE: one row for each thing that lasts on screen, a figure, a prop
// or a place, never a pose or an action: how a thing looks at a beat is its
// state, which its paint reads from the beats. A row needs a unique name, a
// non-blank string or a Symbol, which sounds and contacts cite as their cause; two rows share
// one only when no frame shows both: one exits on or before the frame the other
// enters, as a thing that changes layer does, or no shot shows both. Every thing a beat changes is a
// row, above all the ones the story turns on. Each row says when the thing
// enters and when it EXITS, in seconds from the film's start. A row without an
// exit is refused: a thing leaves when its job ends, and so is an exit or an
// enter that is given and is not a finite number of seconds (null counts as
// left out). `exit: DUR` keeps one to the last frame on purpose. `shots` lists the shots it is seen in, by name;
// left out, it is seen in every shot between its entry and exit. The build
// refuses a `shots` that is not a list, an empty list, and a shot that does
// not play between the row's entry and exit, and a hole in the list. Its paint,
// sounds, contacts and beats see it only there. Add any fields your paint
// reads, such as where it goes or how it moves. `depth` (default 1) is how far
// the camera's travel moves it: 0 stays put like a sky at infinity, 1 moves
// with the subject's plane, above 1 passes nearer. It also sets how much a
// CAMERA dolly scales it, by dolly to the power of its depth: depth 3 under
// dolly 1.15 scales by about 1.52. A thing standing on the
// ground gives `foot` and `tall` against THE HORIZON. `keys` holds a moving
// thing's parts, one track each by name, every track a list of [frame, value]
// or [frame, value, rate] for core/time.js's keys, which paint reads. Parts
// that all key on the same frames move as one stiff piece, and two tracks with
// the same frames, values and rates of their moves move as twins (the rate of
// the last key, of a key cut on its frame or of a key that starts a hold
// shapes no move), so the build warns of each:
// offset the frames of some parts, and vary one of the twins. A light is a row
// too: its level, or where it points, is a keys track its paint and the lit
// layers read; a sound meets a switch through a `cause` naming the row, and
// only a switch that changes the scene's state is also a beat. Two keys on one
// frame switch it on that frame, and the build warns, once per frame, of a
// switch with neither a beat on its row nor a sound its row causes on that
// frame, where the row is seen on that frame and the one before; where that
// frame is the first the row is seen on, frame 0 included, it warns that the
// switch is never seen. A row that takes over from another of its name seen
// on the frame before, within a shot, continues it: a track is a switch there
// when the new row's value on that frame, after any cut of its own there,
// differs beyond float rounding from the value the earlier row carries onto it
// before any cut of the earlier row there. Keys round to whole frames after THE TEMPO, as
// beats and sounds do, and these warnings read the rounded keys; two keys on
// different frames that round to one frame are refused, and so are two on one
// frame before the film, where the first never plays. A thing that returns from scene to
// scene and ages, breaks or grows can list its `states` in order, each with the
// signs its paint draws (grown, worn, cracked, loose or missing parts) and the
// shots that show it; a shot between two states may blend them. Draw how long a
// state has lasted as a trace, such as a pale patch where something hung. The
// build refuses a `states` that is not a list, a state that is not an object
// (a hole in the list counts as one), one whose `shots` is left out, is not a
// list or is empty, one that names a shot the
// film does not have, one that
// plays outside the row's entry and exit, or one that the row's own `shots`
// list leaves out; check on a shot strip that each row shows its state.
//   { name: 'a', enter: 0.5, exit: 3.2 },
//   { name: 'fence', enter: 0, exit: DUR, states: [{ shots: ['first'], signs: ['whole'] }, { shots: ['later'], signs: ['slat missing', 'leans', 'pale gap where the slat was'] }] },
//   { name: 'c', enter: 0, exit: DUR, keys: { upper: [[0, 0], [10, 1]], lower: [[3, 0], [14, 0.6]] } },
//   { name: 'b', enter: 0, exit: DUR, shots: ['first'] },
//   { name: 'hills', enter: 0, exit: DUR, depth: 0.3 },
//   { name: 'post', enter: 0, exit: DUR, foot: 610, tall: 0.95 },
//   { name: 'light', enter: 0, exit: DUR, keys: { level: [[0, 0.2], [60, 0.2], [60, 1], [90, 0.9]] } },
const ELEMENTS = [];

// THE BEATS, in seconds, in playing order:
// { at, intensity, element, changes, knows, asks, answers, rise }. `intensity`,
// 0 to 1, is how hard the beat hits; draw and sound may read it. What a time
// strip and the sound must show at the peak (s.cues.peak) is the intensity check
// in skills/artifex/reference/films.md#plan-intensity-with-the-story. `element` names
// the row whose state the beat changes, and `changes` how: a beat that names no
// row, or no change, is refused, and so is one whose row is not on screen in the
// shot playing at the beat, since a change the viewer does not see did not
// happen in the film. `knows` is what the viewer knows against the subject:
// 'less', 'same' or 'more'. `asks` leaves a question open, and a later beat
// `answers` it in the same words; a question never answered is refused unless
// it is LEFT_OPEN, which a beat must ask and none may answer. `rise` is the
// quantity that grows across the escalation, at this beat: each beat that
// gives one must give more than the last. `forward: true` lets music come
// forward on it (see THE SOUNDS). The eye spends the first frames
// after a cut finding the new shot, so a beat in the first 6 frames at 24 fps
// (a quarter of a second at any rate) after a cut between SHOTS, or a CAMERA
// cut of the framing, is refused. The film's first frame is not a cut.
//   { at: 0.5, intensity: 0.2, element: 'b', changes: 'shown whole', knows: 'same' },
//   { at: 2, intensity: 0.6, element: 'b', changes: 'one part fails', knows: 'more', asks: 'will the rest hold?', rise: 1 },
//   { at: 3.5, intensity: 1, element: 'b', changes: 'half of it gives way', answers: 'will the rest hold?', rise: 12 },
const BEATS = [];
const LEFT_OPEN = null;

// WHERE THE EYE IS on each shot's first and last frame, in design units:
// { shot, in: [x, y], out: [x, y] }, by the shot's name. Across a cut the eye
// lands near where it left: the build carries each point through THE CAMERA
// TRACK on that frame, at depth 1, and a shot whose `in` lands on screen more
// than a third of the frame's width from where the last shot's `out` left
// it is refused unless it is marked `jolt: true`, kept for a heavy beat. A
// CAMERA cut inside a shot is held to the same third, for the point between
// that shot's in and out at the cut, unless a key after its first is marked
// `jump: true` (see THE CAMERA TRACK). A jolt in the first quarter of a second
// after the cut before it, between SHOTS or a CAMERA cut, is refused too: the
// eye is still finding that shot. So is a cut, between SHOTS or a CAMERA cut,
// in the jolt's own first quarter of a second: a jolt shot holds that long.
// The rows go to s.cues.focus, for npm run seeds -- <piece> --cuts; a film
// with no row keeps no focus key. A cut with a shot that has no row is not checked. `carry: 'in'` or
// `carry: 'out'` leaves only the cut into or out of that shot unchecked, for a
// motion carried across it, and drops the point that cut would use. A carry
// needs a cut to carry (not 'in' on the first shot or 'out' on the last) and
// leaves out the point it drops. A jolt is about the cut into its shot, so a
// jolt row may carry 'out' and not 'in'. A shot has one row.
//   { shot: 'first', in: [420, 300], out: [700, 340] },
const FOCUS = [];

// THE LINE OF ATTENTION and where the subjects stand, per shot, in design
// units: { shot, marks: { name: [x, y], ... }, line: [name, name], cross }.
// `marks` gives each subject's design point at depth 1, by any name. `line`
// names the two marks the line of attention runs between: two subjects that
// face each other, or where the action starts and where it goes. From shot to
// shot, the two ends of one line (the same two names) keep their left-to-right
// order on screen. A shot that shows them the other way round views the line
// from the wrong side, unless its row names the crossing the beat sheet plans
// with `cross: true`. A shot whose ends are under a twentieth of the frame's
// width apart on screen is head-on, and the next shot may take either side.
// THE CAMERA TRACK pans and scales the plane at depth 1 and never mirrors it,
// so the order on screen is the marks' order in design units: place the marks
// where each shot shows its subjects. A shot with no row is not checked. A row
// that names no shot, a second row for one shot, a mark that is not [x, y], a
// line that is not two different names of its marks, and a cross other than
// true are refused. npm run seeds -- <piece> --plan draws the marks and lines
// and names a shot on the wrong side; the build does not check the side.
// Where the subject travels towards a goal, give the goal a mark too and note
// on each row whether it shows: in view, far, hidden or behind the subject. At
// the crisis it is not in plain view; nothing checks it. See
// skills/artifex/reference/films.md#plan-the-film and
// skills/artifex/reference/films.md#continuity.
//   { shot: 'first', marks: { a: [420, 520], b: [860, 500] }, line: ['a', 'b'] },
const BLOCKING = [];

// THE CAMERA TRACK: the design point at the frame's centre and the zoom, each
// key at a second from the film's start: { at, x, y, zoom, dolly }. The view moves
// from rest to rest between keys, zoom and dolly by ratio. A key that pans and
// changes scale moves its x, y in a straight line on screen from where the key
// before shows it to the centre (see viewAt), so a target in frame there stays
// in frame through a deep zoom. It holds before the first and after the
// last; two keys at one second cut the framing, and two keys at seconds that
// round to one frame, after THE TEMPO, are refused, as are two keys on frame 0,
// where no cut is counted. Keys at one second make one cut, from the view
// before it to the last key's. `jump: true` on any key of a cut after its
// first lets the eye jump more than a third of the frame there (see WHERE THE EYE IS); it
// is refused on a key that is not on the frame of the key before it, and
// refused as anything but true on one that is. Empty, the view stays on the
// design box. Start each move on a cause on screen and land it on a planned
// frame. Travel moves each element by its depth, which is a track; for a pan,
// which moves every layer alike, leave every depth at 1. `zoom` is the lens: it
// scales every layer alike. `dolly` (default 1) is a push-in or pull-back: it
// scales the subject's plane, depth 1, by that much, and each element by dolly
// to the power of its depth, so a near element grows more than a far one and a
// sky at depth 0 not at all. Keep zoom at one value through a dolly. A dolly
// that is not a positive finite number is refused. Each key states the whole
// view: a field it leaves out takes its default, never the previous key's value
// (x the frame's centre W / 2, y H / 2, zoom 1, dolly 1), so repeat every held
// value on each later key or the camera eases back to the default. A pull-back
// below 1 shrinks every layer above depth 0 and shows THE GROUND at the
// frame's edges: paint those layers wider than the frame. THE GROUND stays fixed: paint what the view should
// cross as an element. A key's `y` is already a y parallax, a crane: it moves
// each element by its depth, as `x` does. A pitch (tilt) is not a key field;
// one you add is optional: interpolate it in viewAt with x and y, add it as
// one y shift every depth takes alike in both onScreen and draw's per-element
// transform, so contacts and WHERE THE EYE IS stay where draw paints (--plan
// still shows the untilted track). Every element, a painted horizon included,
// takes the shift through that transform; foot values and THE HORIZON stay in
// level-view design units, which the build checks. A camera angle swept as a look
// can instead be a `params` entry read in draw.
// Draw the track over the place before you show the
// film: npm --prefix "<library root>" run seeds -- "./my-piece.cjs" --plan
// See Camera and framing in the skill's films reference.
//   { at: 1, x: 640, y: 360, zoom: 1 }, { at: 2.5, x: 820, y: 330, zoom: 1.6 },
//   { at: 0.5, x: 640, y: 360, dolly: 1 }, { at: 3.5, x: 640, y: 360, dolly: 1.15 },
const CAMERA = [];

// THE SOUNDS: each at the second its picture shows its cause, which is an
// element on screen then, the shot that holds it, or for a bed or an ambience
// the place: an element that lasts as long as the place, so its sound runs
// under the cuts inside it. `lead` lets a sound come up to that many seconds
// before its cause is on screen, `trail` up to that many after it has gone,
// such as the next place's ambience rising under the last shot of this one.
// A cause that is never shown is declared: `offscreen: { side, distance }`,
// `side` 'left' or 'right' of the frame and `distance` 0 to 1, which place the
// voice; it is refused while its cause is on screen, and takes no lead or trail;
// its `cause` may be omitted. `voice` takes
// core/sound.js's voice spec: a transient, a body of partials and a tail, how
// hard it starts (`velocity`), how much it differs from its neighbours
// (`vary`), how it moves while it sounds (`bend`, `vibrato`, `sweep`) and how
// far away it is (`distance`, 0 to 1: softer and darker). `wet` is how much of
// it the room takes; left out, it grows from SEND near to 1 far. The room takes
// as much of a panned voice as of a centred one, on both sides, and follows a
// voice that moves along `pan` points. `gain`, a list
// of [seconds, gain] keys from the film's start, makes a row's level follow
// the picture: the whole row, dry and room, ramps linearly from key to key and
// holds the first key's gain before it and the last's after it; 1 leaves the
// row as its voice or ambience sets it. Key it on the frames whose picture sets
// the level, rather than building a silent voice per swell. Keys round to whole
// frames after THE TEMPO, as `at` does; a gain that is not a list of [seconds,
// gain] pairs, both 0 or more, is refused, and so are keys out of order or on
// one frame (two refusals, each with its own remedy). A voice's `detune` splits each partial, so each beats about
// pitch x ratio x cents / 1731 times a second. The level of a held voice holds
// within half a dB while its length times its loudest partial's beat rate
// stays under about 0.1, so a loud low bed stays undetuned, as the bed below
// does (55 Hz over about 4 s allows about 0.8 cents); a shimmer goes on a
// second voice of upper partials.
// A `level` is linear amplitude, so a ratio r is 20 log10 r dB. On the --sound
// strip's 50 ms measure, at one level a held voice reads about 2 dB over a
// struck voice of one partial and 26 dB over a strike alone, and an ambience
// about 6 dB over the held voice. With the rows below in one shot, --sound
// reads the bed about 15 dB under any one of the three event rows alone, and
// the first ambience, at its gain key of 2, about 22 dB under; where event rows
// overlap their sum is louder, and the gaps widen to about 18 and 25 dB: inside
// the skill's 10 to 20 and 20 dB or more either way. Set the bed and ambience
// from each shot's loudest event. --sound prints each shot's bed and ambience gaps, taking a
// voice with an attack of 0.5 s or more as the bed and every other voice as
// events.
//   { at: 0.5, cause: 'a', voice: { pitch: 330, partials: [[1, 1], [2.7, 0.3]], velocity: 0.8, vary: 0.4, strike: { level: 0.3 }, distance: 0.6 } },
//   { at: 1, cause: 'a', voice: { pitch: 440, attack: 0.2, hold: 0.8, bend: [[0, -60], [0.25, 0]], vibrato: { depth: 15, delay: 0.3 }, sweep: [[0, 600], [0.5, 4000], [1.5, 900]], level: 0.2 } },
//   { at: 0, cause: 'first', voice: { pitch: 55, attack: 1.5, hold: 1, decay: 1.5, level: 0.045 } },
//   { at: 2, cause: 'gate', offscreen: { side: 'left', distance: 0.7 }, voice: { pitch: 180, strike: { level: 0.4 } } },
// A row with `ambience` in place of `voice` is the sound of the place itself,
// such as wind, water or a street, for a shot that has one; not every shot does.
// It is already wide and diffuse, so it stays out of the room unless its `wet`
// is given, and it must end by the film's end. The film's last 80 ms fade out,
// so a voice or the room still ringing then fades instead of stopping on a cut,
// unless the film loops: what a loop rings past its end is laid over its start
// by the export, so it keeps its level.
//   { at: 0, cause: 'first', ambience: { length: 4, colour: 700, band: 2.5, level: 0.005, drift: 0.6 }, gain: [[0.5, 1], [1.5, 2], [2.5, 1]] },
//   { at: 5, cause: 'shore', lead: 1, ambience: { length: 7, colour: 2800, level: 0.004, grains: { rate: [[0, 20], [4, 200], [7, 60]], length: 0.012, level: 0.04 } } },
// A row with `pluck` in place of `voice` is anything taut that rings when it is
// let go: core/sound.js's pluck spec, `pitch`, `decay` and `level`. It is mono
// and centred, takes SEND of the room unless its `wet` is given, and takes no
// `offscreen`.
//   { at: 1.5, cause: 'a', pluck: { pitch: 196, decay: 2, level: 0.3 } },
// Mark music, a melody, pulse or held chord that nothing on screen causes,
// `role: 'music'`, with its shot or place as its cause, and a short accent the
// music adds to a beat `role: 'sting'`. The build warns when a music or sting
// row, as loud as it is on any frame of a caused voice's attack and hold, after
// both rows' gain keys, is not
// quieter than that voice's loudest layer then, unless it starts on a beat
// marked `forward` and the voice starts within a quarter of a second of that
// beat; and when more than one sting starts within a quarter of a second of
// one beat.
//   { at: 0, cause: 'first', role: 'music', voice: { pitch: 110, attack: 1, hold: 2, level: 0.1 } },
//   { at: 2, cause: 'first', role: 'sting', voice: { pitch: 880, decay: 0.4, level: 0.3 } },
const SOUNDS = [];

// THE CONTACTS: every planned touch, at the second the two outlines first meet,
// by the element that touches and at its design point [x, y] on that frame. The
// cues carry it as x, y where the camera shows it on that frame, at its cause's
// depth, and keep the design point as `design`. Give each one a reaction in the
// thing touched and a sound in SOUNDS. A contact whose cause is not on screen,
// or with no point, is refused. Draw them before
// you show the film: npm --prefix "<library root>" run seeds -- "./my-piece.cjs" --contacts cues.contacts --loupe --sound
//   { at: 1.25, cause: 'a', x: 512, y: 600 },
const CONTACTS = [];

// THE ROOM the sounds play in, and how much of a sound it takes by default.
const ROOM = { size: 1.6 };
const SEND = 0.25;

// THE DUCK: how the rows marked music or sting step back under each caused
// voice or pluck and return, dry and in the room: core/sound.js's ducking
// options. A sound dips them by what its peak passes `threshold`, at most
// `depth` dB, from just before it starts until its attack and hold are over,
// so a loud hit clears room for itself and a quiet detail moves nothing. A
// sound that starts with music on a beat marked forward dips nothing. The dips
// go to s.cues.ducks. null leaves the music level.
const DUCK = { depth: 6, threshold: 0.05, attack: 0.03, release: 0.35 };

// A ROOM PER PLACE, by the name of the element that lasts as long as the place.
// A sound plays in its cause's room when its cause is such a place, else in the
// room of the place on screen at its first frame (the latest to enter, where
// two overlap), else in ROOM. Each is named 'room <place>', so another place's
// room never moves its noise.
//   { hall: { size: 2.4 }, cupboard: { size: 0.3, bright: 4000 } },
const ROOMS = {};

// WHAT PAINTS EACH ELEMENT, by name: paint(g, state, element, life, clock).
// `life.u` runs from 0 on its first frame to 1 on its last, `life.since` is
// seconds since it entered; time its moves from them with core/time.js. A second
// row of one name restarts both from 0, so time a move across rows from clock.frame.
// THE TEMPO does not retime the clock: a move timed from clock.frame keeps its
// speed when a factor changes, so time one meant to scale from the row's keys.
// Keys sit on film frames, not the row's own, and THE TEMPO retimes them: for a
// move across rows that scales, give both rows the same track and read it with
// keys(element.keys.<track>)(clock.frame).
const PAINT = {};

// THE VIEW on frame `f`: between the camera keys either side of it, rest to rest.
// Zoom and dolly move by ratio. Where the subject's plane, depth 1, changes scale,
// x and y move by the share made so far of the change in 1 / scale, so the design point that
// sits at one screen place on both keys holds still there and each key's point
// moves in a straight line on screen. With no change of scale they move evenly,
// as they do through a dolly-zoom whose zoom * dolly holds only up to rounding.
const viewAt = (keys, f) => {
  const next = keys.findIndex((k) => k.frame > f);
  const a = keys[next < 0 ? keys.length - 1 : Math.max(0, next - 1)] || { x: W / 2, y: H / 2, zoom: 1, dolly: 1, frame: 0 };
  const b = next < 0 ? a : keys[next];
  const u = ease.inOut(span(a.frame, b.frame, f));
  const L = Math.log(b.zoom / a.zoom) + Math.log(b.dolly / a.dolly);
  const p = Math.abs(L) < 1e-9 ? u : Math.expm1(-u * L) / Math.expm1(-L);
  return { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p, dolly: a.dolly * (b.dolly / a.dolly) ** u, zoom: a.zoom * (b.zoom / a.zoom) ** u };
};
// Where `view` shows the design point [x, y] of a thing at `depth`, as draw paints it.
const onScreen = (view, [x, y], depth = 1) => {
  const k = view.zoom * view.dolly ** depth;
  return [W / 2 + k * (x - W / 2 - (view.x - W / 2) * depth), H / 2 + k * (y - H / 2 - (view.y - H / 2) * depth)];
};
// A shot name as a refusal prints it: a string as written, any other value through shown().
const called = (name) => typeof name === 'string' ? name : shown(name);
// A sound's or contact's cause as a message prints it: an off-screen row may have none.
const causeOf = (cause) => (cause == null ? 'no cause' : called(cause));
// Refuses the `key` of the row `what` when `value` is given and is not a finite
// number of seconds. One rule for every timed value: null or undefined is a
// missing value, which keeps its table's own handling.
const secondsOf = (what, key, value, fix) => {
  if (value != null && !Number.isFinite(value)) throw new Error(`${what} has ${/^[aeiou]/.test(key) ? 'an' : 'a'} ${key} that is not a finite number of seconds, got ${shown(value)}: ${fix}`);
};
// Refuses the row `what` of a timed table that has no `at`, or whose `at` is not
// a finite number of seconds, before THE TEMPO retimes it.
const atOf = (what, row) => {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) throw new Error(`${what} is not an object, got ${shown(row)}: give each row an object such as { at: 1.5 }`);
  secondsOf(what, 'at', row.at, 'give the second it comes at, such as 1.5');
  if (row.at == null) throw new Error(`${what} has no at: give the second it comes at, such as 1.5`);
};
// Refuses `list`, named by `what`, when it is given and is not a list of `items`.
const listOf = (list, what, items, fix) => {
  if (list !== undefined && !Array.isArray(list)) throw new Error(`${what} is not a list of ${items}, got ${shown(list)}: ${fix}`);
};
for (const [name, factor] of Object.entries(TEMPO)) {
  if (!SHOTS.some(([shot]) => shot === name)) throw new Error(`the TEMPO names a shot the film does not have, got ${shown(name)}: name one of ${SHOTS.map(([shot]) => shot).join(', ')}`);
  if (!(Number.isFinite(factor) && factor > 0)) throw new Error(`the TEMPO for ${name} is not a positive finite number, got ${typeof factor === 'number' ? factor : shown(factor)}: give a factor such as 0.75 or 1.3`);
}
// Each shot's start in the tables (`from`) and on the retimed film (`to`), with
// its factor, then the film's end, past which time keeps its speed. `to` is the
// same running sum of scaled lengths that shots() rounds to its cuts, so a time
// on a shot's start, or the film's end, rounds to the frame of its cut.
const SPANS = [];
{
  let from = 0;
  let to = 0;
  for (const [name, seconds] of SHOTS) {
    const factor = Object.hasOwn(TEMPO, name) ? TEMPO[name] : 1;
    SPANS.push({ from, to, factor });
    from += seconds;
    to += seconds * factor;
  }
  SPANS.push({ from, to, factor: 1 });
}
// Second `t` of the tables on the retimed film: from the start of the span it
// falls in, scaled by its factor. Where nothing is retimed it stays `t` exactly.
const retime = (t) => {
  if (t == null) return NaN;
  const s = SPANS.findLast((x) => x.from <= t);
  return !s || (s.to === s.from && s.factor === 1) ? t : s.to + (t - s.from) * s.factor;
};
// The seconds THE TEMPO adds by second `t`, and a span of `length` seconds from `t`.
const gained = (t) => retime(t) - t;
const stretch = (t, length) => length + gained(t + length) - gained(t);

module.exports = {
  name: 'film-scaffold',
  size: { w: W, h: H },
  outputs: ['raster'],
  time: { duration: retime(DUR), hz: HZ },
  seed: 1,
  params: {},
  // THE FILM FINISH: one process over every frame of the whole film, declared
  // once. null until you choose one; see Film finish in the skill.
  finish: null,

  state: () => ({ cues: null }),

  build: [
    ['write the cues', (s) => {
      // Every time lands on a whole frame here, once, after THE TEMPO retimes
      // it; draw and sound read only this.
      if (HORIZON != null && !Number.isFinite(HORIZON)) throw new Error(`HORIZON is not a finite design y, got ${shown(HORIZON)}: give the horizon's design y as a number, such as 300, or null to leave it out`);
      const film = shots(SHOTS.map(([name, seconds], i) => [name, seconds * SPANS[i].factor]), { hz: HZ, frames: Math.round(retime(DUR) * HZ) });
      const last = film[film.length - 1].end;
      const frame = (seconds) => Math.round(seconds * HZ);
      // Advice for two keys that land on one frame; a camera counts no cut on frame 0.
      const apart = `move them a frame or more apart${Object.keys(TEMPO).length ? ' on the retimed film' : ''}`;
      const noCutAtZero = `no cut is counted on frame 0, so only one of them shows; ${apart}`;
      // A table that is not a list is refused by its name before its rows are walked.
      for (const [name, table, row] of [['ELEMENTS', ELEMENTS, "{ name: 'door', enter: 0, exit: DUR }"], ['SOUNDS', SOUNDS, '{ at: 1.5, cause: \'door\', voice: { pitch: 220 } }'],
        ['CONTACTS', CONTACTS, "{ at: 1.5, cause: 'door', x: 100, y: 100 }"], ['BEATS', BEATS, "{ at: 1.5, intensity: 0.5, element: 'door', changes: 'open' }"], ['CAMERA', CAMERA, '{ at: 0, x: 640, y: 360, zoom: 1 }'],
        ['BLOCKING', BLOCKING, "{ shot: 'first', marks: { a: [420, 520], b: [860, 500] }, line: ['a', 'b'] }"]]) {
        if (!Array.isArray(table)) throw new Error(`the ${name} table is not a list of rows, got ${shown(table)}: write it as a list, such as [${row}]`);
      }
      // Array.from visits a hole in the list, which map skips.
      const elements = Array.from(ELEMENTS, (e, i) => {
        if (e === null || typeof e !== 'object' || Array.isArray(e)) throw new Error(`element ${i} is not an object, got ${shown(e)}: give each row an object such as { name: 'door', enter: 0, exit: DUR }`);
        // A row with no name would match a cause-less sound in alive().
        if (!(typeof e.name === 'symbol' || (typeof e.name === 'string' && e.name.trim() !== ''))) throw new Error(`element ${i} has no name, got ${shown(e.name)}: give it the name that sounds and contacts cite as their cause, such as 'door'`);
        const who = called(e.name);
        if (e.exit == null) throw new Error(`element ${who} has no exit`);
        secondsOf(`element ${who}`, 'exit', e.exit, 'give the second it goes off, such as 3.2');
        secondsOf(`element ${who}`, 'enter', e.enter, 'give the second it comes on, such as 0');
        const at = { ...e, enter: frame(retime(e.enter)), exit: frame(retime(e.exit)) };
        if (!(at.enter >= 0 && at.exit > at.enter && at.exit <= last)) {
          throw new Error(`element ${who} must enter at 0 or later and exit after it enters, by ${DUR} s`);
        }
        if (e.depth !== undefined && !Number.isFinite(e.depth)) throw new Error(`element ${who} has a depth that is not a finite number`);
        // A standing thing is placed by its foot contact: in a level view its height
        // is its feet's distance below the horizon, times its height over the eye's.
        if (e.foot !== undefined || e.tall !== undefined) {
          if (HORIZON == null) throw new Error(`element ${who} stands at a foot, but HORIZON is not set: give the horizon's design y, such as 300`);
          if (!Number.isFinite(e.foot)) throw new Error(`element ${who} has a foot that is not a finite design y, got ${shown(e.foot)}: give the y its feet touch, such as 600`);
          if (e.tall !== undefined && !(Number.isFinite(e.tall) && e.tall > 0)) throw new Error(`element ${who} has a tall that is not a positive finite number, got ${shown(e.tall)}: give its height over the eye's, such as 1`);
          if (!(e.foot > HORIZON)) throw new Error(`element ${who} stands with its feet at ${e.foot}, on or above the horizon at ${HORIZON}, so it floats: in a level view a standing thing's feet sit below the horizon`);
          at.height = (e.foot - HORIZON) * (e.tall ?? 1);
        }
        // Its parts' tracks, of two keys or more: a track of one key never moves.
        const moving = Object.entries(e.keys ?? {}).filter(([track, list]) => {
          try { keys(list); } catch (error) { throw new Error(`element ${who}'s keys track ${track}: ${error.message}`); }
          return list.length > 1;
        });
        // Its keys on the retimed film, rounded to whole frames as beats and sounds
        // are, so a switch shows on its beat's frame. Two keys written on different
        // frames that round to one frame are refused: rounding would cut the move.
        // So are two on one frame before the film, written so or rounded: the
        // first never plays. A cut written on frame 0 is a cut on a row's first
        // shown frame, warned of below.
        if (e.keys) {
          at.keys = Object.fromEntries(Object.entries(e.keys).map(([track, list]) => [track, list.map(([f, ...rest], i) => {
            const to = frame(retime(f / HZ));
            if (i > 0 && (f !== list[i - 1][0] || to < 0) && to === frame(retime(list[i - 1][0] / HZ))) {
              throw new Error(`element ${who}'s keys track ${track} has keys ${i - 1} and ${i} on frames ${list[i - 1][0]} and ${f}, which land on one frame, ${to}: ` + (to >= 0
                ? `that cuts the track; ${apart}, or give both one frame to cut on purpose`
                : `that frame comes before the film starts, so the first of them never plays; ${apart}`));
            }
            return [to, ...rest];
          })]));
        }
        // The stiff and twins warnings read the rounded keys, which are what plays.
        const tracks = moving.map(([track]) => [track, at.keys[track]]);
        const when = (list) => list.map(([f]) => f).join(', ');
        // Twins share every key's frame and value, and the rate of every key that
        // starts a move, so easing alone tells two tracks apart. The rate of the last
        // key, of a key cut on its frame and of a key that starts a hold (the next key
        // has its value) shapes nothing, so it is not compared.
        const same = (one, two) => one.length === two.length
          && one.every(([f, v, r = ease.linear], k) => f === two[k][0] && v === two[k][1]
            && (k === one.length - 1 || one[k + 1][0] === f || one[k + 1][1] === v || r === (two[k][2] ?? ease.linear)));
        if (tracks.length > 1 && tracks.every(([, list]) => when(list) === when(tracks[0][1]))) {
          console.warn(`warning: every keys track of ${who} keys on frames ${when(tracks[0][1])}, so its parts move as one stiff piece: offset some of them`);
        }
        tracks.forEach(([a, one], i) => tracks.slice(i + 1).forEach(([b, two]) => {
          if (same(one, two)) console.warn(`warning: the keys tracks ${a} and ${b} of ${who} carry the same keys, so they move as twins: vary one in its frames, values or the rates of its moves`);
        }));
        listOf(e.shots, `element ${who}'s shots`, 'shot names', "put its shot names in a list, such as ['first'], or leave the list out to show it in every shot");
        if (e.shots && !e.shots.length) throw new Error(`element ${who} lists no shots, so it is never drawn: name its shots, or leave the list out to show it in every shot`);
        // An indexed walk, so a hole in a sparse list is refused by its place.
        for (let i = 0; i < (e.shots?.length ?? 0); i++) {
          const name = e.shots[i];
          if (!(i in e.shots)) throw new Error(`element ${who}'s shots list has a hole at ${i}, which names no shot: name a shot there, or take the hole out`);
          if (!film.some((shot) => shot.name === name && shot.start < at.exit && at.enter < shot.end)) {
            throw new Error(`element ${who} lists a shot that does not play between its entry and exit: ${called(name)}`);
          }
        }
        listOf(e.states, `element ${who}'s states`, 'states', "put its states in a list, such as [{ shots: ['first'] }], or leave the list out");
        // An indexed walk, so a hole in a sparse list is refused as a state that is not an object.
        for (let i = 0; i < (e.states?.length ?? 0); i++) {
          const state = e.states[i];
          if (typeof state !== 'object' || state === null || Array.isArray(state)) throw new Error(`element ${who}'s state ${i} is not an object, got ${shown(state)}: write each state as an object, such as { shots: ['first'], signs: ['whole'] }`);
          listOf(state.shots, `element ${who}'s state ${i} shots`, 'shot names', "put the state's shot names in a list, such as ['first']");
          if (state.shots === undefined) throw new Error(`element ${who}'s state ${i} has no shots, so it is never shown: name the shots that show it`);
          if (!state.shots.length) throw new Error(`element ${who}'s state ${i} lists no shots, so it is never shown: name the shots that show it`);
          // An indexed walk, so a hole in the list is refused by its place.
          for (let j = 0; j < state.shots.length; j++) {
            if (!(j in state.shots)) throw new Error(`element ${who}'s state ${i} shots list has a hole at ${j}, which names no shot: name a shot there, or take the hole out`);
            const shot = state.shots[j];
            const name = called(shot);
            const plays = film.filter((one) => one.name === shot);
            if (!plays.length) throw new Error(`element ${who}'s state ${i} names a shot the film does not have: ${name}`);
            if (!plays.some((one) => one.start < at.exit && at.enter < one.end)) {
              throw new Error(`element ${who}'s state ${i} names a shot that does not play between its entry and exit: ${name}`);
            }
            if (e.shots && !e.shots.includes(shot)) throw new Error(`element ${who}'s state ${i} names a shot that the row's shots list leaves out: ${name}`);
          }
        }
        return at;
      });
      // Whether element row `e` is seen on any frame from `from` to `to`: between
      // its entry and exit, and in one of its shots when it lists them.
      const shows = (e, from, to) => film.some((shot) => (!e.shots || e.shots.includes(shot.name))
        && Math.max(e.enter, shot.start, from) < Math.min(e.exit, shot.end, to + 1));
      // Two rows of one name are ambiguous only on a frame that shows both
      // (depth and contacts would take the first, paint would run twice), so a
      // row may exit on the frame a second of its name enters at another place
      // in the table, its new layer, and intercut places may share a name when
      // no shot shows both.
      elements.forEach((e, i) => {
        const first = elements.findIndex((other, j) => j < i && other.name === e.name
          && film.some((shot) => [e, other].every((x) => !x.shots || x.shots.includes(shot.name))
            && Math.max(e.enter, other.enter, shot.start) < Math.min(e.exit, other.exit, shot.end)));
        if (first >= 0) throw new Error(`element ${i} repeats the name ${shown(e.name)} of element ${first}: a frame shows both; give each row its own name, exit one on or before the frame the other enters, or list shots that never meet`);
      });
      for (const place of Object.keys(ROOMS)) {
        if (!elements.some((e) => e.name === place)) throw new Error(`the room for ${place} has no element of that name`);
      }
      // The place whose room a sound starting on frame `f` of `cause` plays in, or null for ROOM.
      const home = (cause, f) => (Object.hasOwn(ROOMS, cause) ? cause : elements
        .filter((e) => Object.hasOwn(ROOMS, e.name) && shows(e, f, f))
        .reduce((a, e) => (a && a.enter > e.enter ? a : e), null)?.name ?? null);
      // Whether `name` is on screen on any frame from `from` to `to`.
      const alive = (name, from, to) => elements.some((e) => e.name === name && shows(e, from, to))
        || film.some((shot) => shot.name === name && shot.start <= to && from < shot.end);
      const seen = new Map();
      const sounds = Array.from(SOUNDS, (c, i) => {
        atOf(`sound ${i}`, c);
        if (c.ambience != null && (typeof c.ambience !== 'object' || Array.isArray(c.ambience))) throw new Error(`sound ${i} has an ambience that is not an object, got ${shown(c.ambience)}: give its keys, such as { length: 3 }`);
        if (c.voice != null && (typeof c.voice !== 'object' || Array.isArray(c.voice))) throw new Error(`sound ${i} has a voice that is not an object, got ${shown(c.voice)}: give its keys, such as { pitch: 220 }`);
        if (c.pluck != null && (typeof c.pluck !== 'object' || Array.isArray(c.pluck))) throw new Error(`sound ${i} has a pluck that is not an object, got ${shown(c.pluck)}: give its keys, such as { pitch: 196 }`);
        if (c.offscreen != null && (typeof c.offscreen !== 'object' || Array.isArray(c.offscreen))) throw new Error(`sound ${i} has an offscreen that is not an object, got ${shown(c.offscreen)}: give its keys, such as { side: 'left', distance: 0.5 }`);
        for (const side of ['lead', 'trail']) secondsOf(`sound ${i}`, side, c[side], `give the seconds it ${side}s by, such as 0.5`);
        secondsOf(`sound ${i}`, 'ambience length', c.ambience?.length, 'give the seconds it lasts, such as 3');
        secondsOf(`sound ${i}`, 'ambience fade', c.ambience?.fade, 'give the seconds it fades by, such as 0.5');
        // Its gain keys as [frame, gain], each retimed and rounded to a whole frame as `at` is.
        let gain;
        if (c.gain != null) {
          if (!Array.isArray(c.gain) || !c.gain.length) throw new Error(`sound ${i} has a gain that is not a list of [seconds, gain] keys, got ${shown(c.gain)}: give keys such as [[1, 0.5], [2, 1]], or leave it out`);
          gain = [];
          // An indexed walk, so a hole in the list is refused as a key that is not a pair.
          for (let k = 0; k < c.gain.length; k++) {
            const pair = c.gain[k];
            if (!(Array.isArray(pair) && pair.length === 2 && pair.every((x) => Number.isFinite(x) && x >= 0))) {
              throw new Error(`sound ${i} has gain key ${k} that is not a [seconds, gain] pair with seconds and a gain of 0 or more, got ${shown(pair)}: write it such as [1.5, 0.8]`);
            }
            const to = frame(retime(pair[0]));
            if (k > 0 && pair[0] < c.gain[k - 1][0]) throw new Error(`sound ${i} has gain keys ${k - 1} and ${k} at ${c.gain[k - 1][0]} s and ${pair[0]} s, which are out of order: list the keys in time order, a frame or more apart`);
            if (k > 0 && to <= gain[k - 1][0]) throw new Error(`sound ${i} has gain keys ${k - 1} and ${k} at ${c.gain[k - 1][0]} s and ${pair[0]} s, which land on one frame: ${apart}`);
            gain.push([to, pair[1]]);
          }
        }
        if (!c.voice && !c.ambience && !c.pluck) throw new Error(`the sound at ${called(c.at)} s (${causeOf(c.cause)}) has neither a voice nor an ambience`);
        if (c.voice && c.ambience) throw new Error(`the sound at ${called(c.at)} s (${causeOf(c.cause)}) has both a voice and an ambience: keep one, or split them into two rows`);
        if (c.pluck && (c.voice || c.ambience)) throw new Error(`the sound at ${called(c.at)} s (${causeOf(c.cause)}) has both a pluck and ${c.voice ? 'a voice' : 'an ambience'}: keep one, or split them into two rows`);
        if (c.role != null && c.role !== 'music' && c.role !== 'sting') throw new Error(`the sound at ${called(c.at)} s takes a role of 'music' or 'sting', or none, got ${called(c.role)}`);
        const f = frame(retime(c.at));
        // THE TEMPO stretches the spans of film time a row covers, as it does
        // the shots under them: its lead, its trail and an ambience's length. A
        // voice's own shape and an ambience's grains' keys keep their seconds, and
        // so do its fades, unless a shortened length is under twice them: then
        // each fade takes half the length, so the ambience still renders.
        const { offscreen } = c;
        const lead = stretch(c.at, c.lead ?? 0);
        const trail = stretch(c.at - (c.trail ?? 0), c.trail ?? 0);
        if (Number.isFinite(c.ambience?.length)) {
          const length = stretch(c.at, c.ambience.length);
          const fade = c.ambience.fade ?? 1;
          c = { ...c, ambience: { ...c.ambience, length, ...(c.ambience.fade === null && { fade: undefined }), ...(length < c.ambience.length && length < 2 * fade && { fade: length / 2 }) } };
        }
        if (!(lead >= 0 && trail >= 0 && Number.isFinite(lead + trail))) throw new Error(`the sound at ${c.at} s must lead or trail by seconds, 0 or more`);
        let voice = c.voice;
        if (offscreen != null) {
          const { side, distance } = offscreen;
          if (c.voice == null || c.lead != null || c.trail != null || !['left', 'right'].includes(side) || !(distance >= 0 && distance <= 1)) {
            throw new Error(`the sound at ${c.at} s must be a voice with an off-screen side of 'left' or 'right' and a distance from 0 to 1, and no lead or trail`);
          }
          if (alive(c.cause, f, f)) throw new Error(`the sound at ${c.at} s declares its cause off screen, but ${causeOf(c.cause)} is on screen then`);
          // 0.8, not 1: a phone folding to mono loses 1.8 dB of it rather than 3,
          // and it still leans 16 dB to its side, with some of the room on the other.
          voice = { ...c.voice, pan: side === 'left' ? -0.8 : 0.8, distance };
        } else if (!alive(c.cause, f - (trail > 0 ? frame(trail) + 1 : 0), f + frame(lead))) {
          // A trail counts from the frame its cause has gone, one after its last on screen.
          throw new Error(c.cause == null
            ? `the sound at ${c.at} s has no cause key: add cause: 'name' of the element on screen that makes it, or offscreen: { side, distance } for one never shown`
            : `the sound at ${c.at} s has no cause on screen: ${causeOf(c.cause)}`);
        }
        if (c.ambience && c.ambience.length * HZ > last - f + 1e-6) throw new Error(`the ambience at ${c.at} s lasts past the film's end at ${last / HZ} s`);
        // Named by cause and frame, so adding a sound never moves another's noise.
        const key = `${causeOf(c.cause)} ${f}`;
        seen.set(key, (seen.get(key) || 0) + 1);
        return { ...c, voice, frame: f, name: `${key} ${seen.get(key)}`, room: home(c.cause, f), ...(c.gain !== undefined && { gain }) };
      });
      let prevFrame = -1;
      const camera = Array.from(CAMERA, (k, i) => {
        atOf(`camera key ${i}`, k);
        const at = { x: W / 2, y: H / 2, zoom: 1, dolly: 1, ...k, frame: frame(retime(k.at)) };
        if (!(at.frame >= 0 && at.frame <= last && (i === 0 || k.at >= CAMERA[i - 1].at))
          || ![at.x, at.y, at.zoom].every(Number.isFinite) || !(at.zoom > 0)) {
          throw new Error(`camera key ${i} must come at or after the one before it, by ${DUR} s, with a finite place and a zoom above 0`);
        }
        if (!(Number.isFinite(at.dolly) && at.dolly > 0)) throw new Error(`camera key ${i} has a dolly that is not a positive finite number, got ${shown(at.dolly)}: give the scale of the subject's plane, such as 1.2`);
        // Only two keys at one second cut the framing: two seconds that round to one frame are refused, and so are two keys on frame 0, which counts no cut.
        if (i > 0 && (k.at !== CAMERA[i - 1].at || at.frame === 0) && at.frame === prevFrame) {
          // Frame 0 counts no cut, so one second would not cut there either.
          throw new Error(`camera keys ${i - 1} and ${i} land on one frame, got ${CAMERA[i - 1].at} s and ${k.at} s on frame ${at.frame}: ` + (at.frame > 0
            ? `that cuts the framing; ${apart}, or give both one second to cut on purpose`
            : noCutAtZero));
        }
        if (k.jump !== undefined) {
          const cuts = i > 0 && at.frame === prevFrame;
          if (!cuts) throw new Error(`camera key ${i} at ${k.at} s allows a jump but cuts no framing: give jump: true only to a key on the same frame as the key before it`);
          if (k.jump !== true) throw new Error(`camera key ${i} at ${k.at} s cuts the framing, so jump must be true or left out, got ${String(k.jump)}: give jump: true to let the eye jump there`);
        }
        prevFrame = at.frame;
        return at;
      });
      const contacts = Array.from(CONTACTS, (c, i) => {
        atOf(`contact ${i}`, c);
        const f = frame(retime(c.at));
        if (!(f >= 0 && f < last && Number.isFinite(c.x) && Number.isFinite(c.y))) throw new Error(`the contact at ${c.at} s needs a second within the film and a design point x, y`);
        if (!alive(c.cause, f, f)) throw new Error(c.cause == null
          ? `the contact at ${c.at} s has no cause key: add cause: 'name' of the element on screen that touches`
          : `the contact at ${c.at} s has no cause on screen: ${causeOf(c.cause)}`);
        // Where the frame shows the design point: through the view on frame f, as draw paints its cause.
        const depth = elements.find((e) => e.name === c.cause && shows(e, f, f))?.depth ?? 1;
        const [x, y] = onScreen(viewAt(camera, f), [c.x, c.y], depth);
        return { ...c, x, y, design: [c.x, c.y], frame: f };
      });
      // The beats: each on its frame, in order, changing the state of an element
      // seen in the shot playing then; every question
      // asked is answered later, except the one left open on purpose.
      const open = new Set();
      let rise = -Infinity;
      // The frames after a cut in which the eye is still finding the new shot.
      const settle = Math.ceil((6 * HZ) / 24);
      // Every cut after the film's first frame: between SHOTS, and of the
      // framing, where two or more CAMERA keys share a frame: one cut per frame,
      // named at its last key, which a jump on any of its keys exempts.
      const cuts = [...film.slice(1).map((x) => ({ frame: x.start, name: `cut to ${x.name}`, shot: x.name })),
        ...camera.flatMap((k, j) => j > 0 && k.frame === camera[j - 1].frame && camera[j + 1]?.frame !== k.frame
          ? [{ frame: k.frame, name: `camera cut at ${k.at} s`, key: j, jump: camera.some((o) => o.frame === k.frame && o.jump) }] : [])];
      const beats = Array.from(BEATS, (b, i) => {
        atOf(`beat ${i}`, b);
        const at = { ...b, frame: frame(retime(b.at)) };
        if (!(at.frame >= 0 && at.frame <= last && (i === 0 || b.at >= BEATS[i - 1].at))) {
          throw new Error(`beat ${i} must come at or after the one before it, by ${DUR} s`);
        }
        if (!(b.intensity >= 0 && b.intensity <= 1)) throw new Error(`beat ${i} at ${b.at} s needs an intensity from 0 to 1`);
        if (typeof b.changes !== 'string' || !b.changes.trim()) throw new Error(`beat ${i} at ${b.at} s changes no state: name what it changes`);
        if (!elements.some((e) => e.name === b.element)) throw new Error(`beat ${i} at ${b.at} s names no element of the cue table whose state it changes: ${called(b.element)}`);
        // A beat on the film's last instant changes what its last frame shows.
        const seen = Math.min(at.frame, last - 1);
        if (!elements.some((e) => e.name === b.element && shows(e, seen, seen))) {
          const shot = film.find((x) => x.start <= seen && seen < x.end).name;
          throw new Error(`beat ${i} at ${b.at} s changes ${called(b.element)} off screen: it is not seen in ${shot}, the shot playing then`);
        }
        // The latest cut before the beat, so moving it past that one clears them all.
        const cut = cuts.filter((c) => c.frame <= at.frame && at.frame < c.frame + settle).reduce((a, c) => (a && a.frame >= c.frame ? a : c), null);
        if (cut) throw new Error(`beat ${i} at ${b.at} s falls ${at.frame - cut.frame} frames after the ${cut.name}, before the eye has found the shot: move it ${settle} frames or more after the cut`);
        if (b.knows !== undefined && !['less', 'same', 'more'].includes(b.knows)) throw new Error(`beat ${i} at ${b.at} s: the viewer knows 'less', 'same' or 'more'`);
        for (const q of [].concat(b.answers ?? [])) {
          if (q === LEFT_OPEN) throw new Error(`beat ${i} at ${b.at} s answers the question left open: ${called(q)}`);
          if (!open.delete(q)) throw new Error(`beat ${i} at ${b.at} s answers a question no earlier beat asks: ${called(q)}`);
        }
        for (const q of [].concat(b.asks ?? [])) open.add(q);
        if (b.rise !== undefined) {
          if (!(Number.isFinite(b.rise) && b.rise > rise)) throw new Error(`beat ${i} at ${b.at} s does not raise what rises: ${called(b.rise)} after ${rise}`);
          rise = b.rise;
        }
        return at;
      });
      if (LEFT_OPEN !== null && !open.has(LEFT_OPEN)) throw new Error(`no beat asks the question left open: ${called(LEFT_OPEN)}`);
      open.delete(LEFT_OPEN);
      if (open.size) throw new Error(`no beat answers: ${[...open].map(called).join('; ')}`);
      // Music under the caused sounds: each row's loudest layer `s` seconds after
      // it starts, `level(s)`, as the peak of a sine of the same stereo power, its
      // peak and its frames, from its spec with core/sound.js's defaults, before
      // `vary`. A voice's partials fall after its attack and hold, its strike and
      // tail from its start, or its tail from the peak of its `tail.rise`, as
      // core's do; each is read at its full level through the attack it rises
      // over, which a music row is judged on, while a tail with `tail.rise`
      // swells linearly from 0 and peaks at the end of the rise, as core's
      // does. An ambience is read through its fades.
      const fall = (s, length) => (s < length ? 1000 ** (-Math.max(0, s) / length) : 0);
      const heard = (c) => {
        if (c.ambience) {
          const { length, colour = 800, band = 2, drift = 0.5, level = 0.05, fade = 1, grains } = c.ambience;
          // The bed carries its own noise at RMS `level` on each side, which
          // wanders up to 10 ** (0.3 * drift) louder: the power of a centred sine
          // of peak 2 * level at that top. Voices and grains pan at equal power.
          let peak = level * 2 * 10 ** (0.3 * drift);
          if (grains) {
            // The loudest grain: every pitch the band reaches, 1/96 octave apart
            // from the top down, as its 1 ms rise, its fall and its sine from 0,
            // whose negative crests are as loud, let it peak. A noise grain holds
            // a sine's power at its level from its first sample at any pitch, so
            // its rise and fall alone let it peak.
            const { length: ring = 0.02, chirp = 0, level: top = 0, noise = false } = grains;
            const n = Math.ceil(ring * 48000);
            const span = 2 * drift + band;
            if (noise) for (let i = 0, env = top; i < n && env > peak; i++, env *= 1000 ** (-1 / n)) peak = Math.max(peak, env * Math.min(1, i / 48));
            else for (let o = Math.ceil(96 * span); o >= 0; o--) {
              let hz = Math.min(colour * 2 ** (Math.min(o / 96, span) - drift - band / 2), (0.45 * 48000) / 2 ** Math.max(0, chirp));
              for (let i = 0, phase = 0, env = top; i < n && env > peak; i++, env *= 1000 ** (-1 / n), hz *= 2 ** (chirp / n)) {
                peak = Math.max(peak, env * Math.min(1, i / 48) * Math.abs(Math.sin(phase)));
                phase += (2 * Math.PI * hz) / 48000;
              }
            }
          }
          // Bed and grains rise and fall over `fade` at each end, on a raised cosine.
          const edge = (s) => Math.min(s, length - s) / fade;
          return { peak, end: c.frame + length * HZ, level: (s) => (s < length ? peak * (edge(s) >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * edge(s))) : 0) };
        }
        // A pluck peaks at its level as it starts and falls to -60 dB over its decay.
        if (c.pluck) {
          const { level = 1, decay = 1 } = c.pluck;
          return { peak: level, end: c.frame + decay * HZ, level: (s) => level * fall(s, decay), held: 0, swell: 0 };
        }
        const { partials = [[1, 1]], attack = 0.005, hold = 0, decay = 1, damp = 0.5, strike = {}, tail = {}, level = 1, velocity = 1, distance = 0 } = c.voice;
        const body = Array.isArray(partials) ? partials : [];
        const swell = tail.level ? tail.rise ?? 0 : 0;
        const at = (s) => level * velocity * 10 ** (-0.75 * distance) * Math.max((strike.level ?? 0) * velocity * fall(s, strike.length ?? 0.03),
          (tail.level ?? 0) * (s < swell ? Math.max(0, s) / swell : fall(s - swell, tail.length ?? 1.5)),
          ...body.map(([ratio, amount]) => amount * velocity ** (Math.max(0, ratio - 1) / 2) * fall(s - attack - hold, decay / ratio ** damp)));
        const length = Math.max(...body.map(([ratio]) => attack + hold + decay / ratio ** damp), tail.level ? swell + (tail.length ?? 1.5) : 0);
        return { peak: Math.max(at(0), at(swell)), end: c.frame + length * HZ, level: at, held: Math.max(attack + hold, swell), swell };
      };
      // A row as it plays: its level `s` seconds after it starts times its gain keys then.
      const played = (c) => {
        const h = heard(c);
        return c.gain ? { ...h, level: (s) => h.level(s) * keys(c.gain)(c.frame + s * HZ) } : h;
      };
      // A sting is music too: it adds to the beat and leaves the hit on top.
      for (const m of sounds.filter((c) => c.role === 'music' || c.role === 'sting')) {
        const music = played(m);
        // Music that starts on a beat marked forward may cover the caused sounds
        // that start on that beat, and none after it.
        const forward = beats.some((b) => b.forward && b.frame === m.frame);
        // A sound under the music is judged against it on each frame of its
        // attack and hold, as both are then, so music fallen below it no longer
        // counts and an ambience rising over a held voice does; a silent one,
        // or a frame its gain keys silence, never.
        const over = sounds.find((c) => {
          const event = (c.voice || c.pluck) && !c.role && !(forward && Math.abs(c.frame - m.frame) < settle) && played(c);
          if (!(event?.peak > 0 && m.frame < event.end)) return false;
          // Music not started yet is silent on that frame. A swell that starts
          // under music already playing rises out of it, so through its rise it
          // is read at its peak (a rise frame its gain keys silence stays silent);
          // music entering during the rise meets it as it is.
          const under = m.frame <= c.frame;
          for (let f = Math.max(c.frame, m.frame); f <= c.frame + event.held * HZ; f++) {
            const s = (f - c.frame) / HZ;
            const level = under && s < event.swell && event.level(s) > 0 ? Math.max(event.level(s), event.level(event.swell)) : event.level(s);
            if (level > 0 && level <= music.level(Math.max(0, f - m.frame) / HZ)) return true;
          }
          return false;
        });
        if (over) console.warn(`warning: the ${m.role} at ${m.at} s (${causeOf(m.cause)}) is not quieter than the sound at ${over.at} s (${causeOf(over.cause)}) it plays with: lower the ${m.role}, or bring it forward only on a beat marked forward and drop it back after`);
      }
      // THE DUCK's events: each caused voice or pluck that sounds, at its loudest
      // on a frame of its attack and hold after its gain keys, on top through
      // them, but for one that starts with music on a beat marked forward,
      // which the music may cover.
      const led = sounds.filter((m) => m.role && beats.some((b) => b.forward && b.frame === m.frame));
      const ducks = !DUCK ? [] : sounds.filter((c) => (c.voice || c.pluck) && !c.role && !led.some((m) => Math.abs(c.frame - m.frame) < settle)).map((c) => {
        const p = played(c);
        let level = 0;
        for (let f = 0; f <= Math.max(p.held, p.swell) * HZ; f++) level = Math.max(level, p.level(f / HZ));
        return { at: c.frame / HZ, length: Math.max(0.1, p.held), level };
      }).filter((d) => d.level > 0);
      // A cut in a row's keys (two keys on one frame after the first) is a switch
      // the viewer should see and hear: warn of one with neither a beat on the row
      // nor a sound the row causes on its frame, once per frame, where the row is
      // seen on that frame and the one before, so the value it leaves was seen.
      // A cut on the first frame the row is seen on, frame 0 included, is never
      // seen as a switch: warn of that instead. A row returning in a later shot
      // with a changed value is a shot change, so a cut there is not warned of.
      // Within a shot, a row taking over from another of its name seen on the
      // frame before (a layer change) continues it, so each name's track is one
      // track, each row read only on the frames it shows: the takeover is a cut
      // too when the new row's value there differs, beyond float rounding, from
      // the value the earlier row would carry onto that frame (before any cut of
      // its own there, which is never seen), by more than that row's own change
      // over its last frame. The new row's own cut on that frame is judged only
      // so, as its value before the cut is never seen either; an earlier row that
      // keys no such track showed no value, so that takeover is quiet. Keys on
      // one frame with one value cut nothing.
      // On a shot's first frame the name
      // seen in an earlier shot is a thing returning: a shot change, not warned of.
      const named = (name, from, to) => elements.some((x) => x.name === name && shows(x, from, to));
      const carried = (list, f) => list.find(([k]) => k === f)?.[1] ?? keys(list)(f);
      const differ = (a, b) => Math.abs(a - b) > 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
      for (const e of elements) {
        for (const [track, list] of Object.entries(e.keys ?? {})) {
          const before = elements.find((x) => x !== e && x.name === e.name && shows(x, e.enter - 1, e.enter - 1));
          const takeover = before && !film.some((shot) => shot.start === e.enter);
          // What the earlier row hands over: its track's value on that frame. A row
          // that keys no such track showed no value, so nothing is seen to switch.
          const handed = takeover && before.keys?.[track];
          // A hand-over within one frame of the earlier row's own motion is the
          // motion going on, as a ramp split at the takeover and retimed is.
          const gap = handed ? Math.abs(carried(handed, e.enter) - keys(list)(e.enter)) : 0;
          const jumps = handed && differ(carried(handed, e.enter), keys(list)(e.enter)) && gap > Math.abs(carried(handed, e.enter) - keys(handed)(e.enter - 1)) * (1 + 1e-9);
          // Two or more keys on one frame cut only when the value arriving differs from the value leaving.
          const cutsOn = [...new Set(list.filter(([f], i) => i > 0 && f === list[i - 1][0]).map(([f]) => f))]
            .filter((f) => { const at = list.filter(([k]) => k === f); return differ(at[0][1], at[at.length - 1][1]); });
          for (const f of new Set([...(jumps ? [e.enter] : []), ...cutsOn.filter((f) => !(takeover && f === e.enter))])) {
            if (!shows(e, f, f)) continue;
            const start = film.some((shot) => shot.start === f);
            if (!shows(e, 0, f - 1) && !named(e.name, start ? 0 : f - 1, f - 1)) {
              console.warn(`warning: the keys track ${track} of ${called(e.name)} cuts on frame ${f}, the first frame it is seen on, so the switch is never seen: move the cut to a frame after one it is seen on, or drop the key the cut leaves`);
              continue;
            }
            if (!shows(e, f - 1, f - 1) && (start || !named(e.name, f - 1, f - 1))) continue;
            if (beats.some((b) => b.element === e.name && b.frame === f) || sounds.some((c) => c.cause === e.name && c.frame === f)) continue;
            console.warn(`warning: the keys track ${track} of ${called(e.name)} cuts on frame ${f} with neither a beat on ${called(e.name)} nor a sound it causes on that frame: put the switch's beat or sound on frame ${f}, or move the cut`);
          }
        }
      }
      beats.forEach((b, i) => {
        const stings = sounds.filter((c) => c.role === 'sting' && Math.abs(c.frame - b.frame) < settle);
        if (stings.length > 1) console.warn(`warning: beat ${i} at ${b.at} s carries ${stings.length} stings, at ${stings.map((c) => `${c.at} s`).join(', ')}: keep one`);
      });
      const peak = beats.reduce((a, b) => (a && a.intensity >= b.intensity ? a : b), null);
      // Where the eye is across each cut.
      const point = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
      FOCUS.forEach((r, i) => {
        if (!film.some((shot) => shot.name === r.shot)) throw new Error(`the focus for ${called(r.shot)} names no shot`);
        if (FOCUS.findIndex((o) => o.shot === r.shot) < i) throw new Error(`the focus has two rows for ${called(r.shot)}: keep one`);
        if (r.carry !== undefined && r.carry !== 'in' && r.carry !== 'out') throw new Error(`the focus for ${called(r.shot)} carries ${called(r.carry)}: carry 'in' or 'out'`);
        // A jolt is about the cut into its shot, which carry 'in' leaves unchecked; carry 'out' is about the cut out of it.
        if (r.carry === 'in' && r.jolt) throw new Error(`the focus for ${called(r.shot)} is a jolt and carries in: both are about the cut into ${called(r.shot)}, and a carry leaves it unchecked, so keep one of them`);
        if (r.carry === 'in' && film[0].name === r.shot) throw new Error(`the focus for ${called(r.shot)} carries in, but ${called(r.shot)} is the first shot and has no cut into it: drop the carry`);
        if (r.carry === 'out' && film[film.length - 1].name === r.shot) throw new Error(`the focus for ${called(r.shot)} carries out, but ${called(r.shot)} is the last shot and has no cut out of it: drop the carry`);
        if (r.carry && !point(r[r.carry === 'in' ? 'out' : 'in'])) throw new Error(`the focus for ${called(r.shot)} carries ${r.carry} and needs its ${r.carry === 'in' ? 'out' : 'in'}, [x, y]`);
        if (r.carry && r[r.carry] !== undefined) throw new Error(`the focus for ${called(r.shot)} carries ${r.carry}, which drops its ${r.carry}, and gives one: take the ${r.carry} out of the row, or drop the carry`);
        if ((!point(r.in) && r.carry !== 'in') || (!point(r.out) && r.carry !== 'out')) throw new Error(`the focus for ${called(r.shot)} needs an in and an out, each [x, y]`);
      });
      for (let i = 1; i < film.length; i++) {
        // A row that carries the motion across this cut leaves it unchecked.
        const from = FOCUS.find((r) => r.shot === film[i - 1].name && r.carry !== 'out');
        const to = FOCUS.find((r) => r.shot === film[i].name && r.carry !== 'in');
        // Measured on screen: the out point through the view on the last frame
        // before the cut, the in point through the view on the first after it.
        const out = from && onScreen(viewAt(camera, film[i].start - 1), from.out);
        const land = to && onScreen(viewAt(camera, film[i].start), to.in);
        if (from && to && !to.jolt && Math.hypot(land[0] - out[0], land[1] - out[1]) > W / 3) {
          throw new Error(`the eye jumps more than a third of the frame from ${from.shot} to ${to.shot}: move the focus, mark ${to.shot} as a jolt for a heavy beat, or give its row carry: 'in' where motion carries the eye across`);
        }
        // The latest cut, between SHOTS or of the framing, before the jolt's own.
        const cut = to?.jolt && cuts.filter((c) => c.frame < film[i].start && film[i].start < c.frame + settle).reduce((a, c) => (a && a.frame >= c.frame ? a : c), null);
        if (cut) {
          throw new Error(`the jolt to ${to.shot} comes ${film[i].start - cut.frame} frames after the ${cut.name}, before the eye has found that shot: ${cut.shot ? `hold ${cut.shot} ${settle} frames or more` : `start ${to.shot} ${settle} frames or more after it`}`);
        }
        // A cut inside the jolt's own settle frames, between SHOTS or of the framing, moves the eye while the jolt still lands.
        const late = to?.jolt && cuts.find((c) => film[i].start < c.frame && c.frame < film[i].start + settle);
        if (late) {
          throw new Error(`the ${late.name} comes ${late.frame - film[i].start} frames after the jolt to ${to.shot}, before the eye has found that shot: ${late.shot ? `hold ${to.shot} ${settle} frames or more` : `move the camera cut ${settle} frames or more after the jolt`}`);
        }
      }
      // A camera cut inside a shot jumps the eye too: the shot's point between
      // its in and out at the cut's place in the shot, through the view on the
      // frames either side of it. One on a shot's first frame is that shot's cut;
      // one marked jump: true may jump.
      for (const c of cuts.filter((c) => !c.shot && !c.jump && !film.some((x) => x.start === c.frame))) {
        const shot = film.find((x) => x.start < c.frame && c.frame < x.end);
        // A cut on the film's last instant shows no frame after it.
        const r = shot && FOCUS.find((r) => r.shot === shot.name);
        if (!r) continue;
        const [a, b] = [point(r.in) ? r.in : r.out, point(r.out) ? r.out : r.in];
        // The in point on the shot's first frame, the out point on its last.
        const u = (c.frame - shot.start) / (shot.end - 1 - shot.start);
        const p = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
        const before = onScreen(viewAt(camera, c.frame - 1), p);
        const after = onScreen(viewAt(camera, c.frame), p);
        if (Math.hypot(after[0] - before[0], after[1] - before[1]) * 3 > W) {
          throw new Error(`the eye jumps more than a third of the frame at the ${c.name} in ${shot.name}: move the camera keys or the focus, or give camera key ${c.key} jump: true`);
        }
      }
      // The view on every frame, as draw shows it: the design point at the
      // frame's centre, the zoom and the dolly, with cut: true on each frame the framing
      // cuts on (two CAMERA keys on one frame; a cut between SHOTS that leaves the
      // camera path alone is no cut of the framing, and cues.shots holds it) and key: true on each camera key's frame, where --plan splits
      // one move from the next, for the plan that npm run seeds -- <piece> --plan draws.
      const cutAt = new Set(cuts.filter((c) => !c.shot).map((c) => c.frame)), keyAt = new Set(camera.map((k) => k.frame));
      const views = Array.from({ length: last }, (_, f) => ({ ...viewAt(camera, f), ...(cutAt.has(f) && { cut: true }), ...(keyAt.has(f) && { key: true }) }));
      // Each shot's subject marks and line of attention, which --plan draws and checks for a view on the wrong side.
      const plain = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
      const blocking = Array.from(BLOCKING, (r, i) => {
        if (!plain(r)) throw new Error(`blocking row ${i} is not an object, got ${shown(r)}: give each row an object such as { shot: 'first', marks: { a: [420, 520], b: [860, 500] }, line: ['a', 'b'] }`);
        if (!film.some((x) => x.name === r.shot)) throw new Error(`the blocking row ${i} names no shot of the film, got ${shown(r.shot)}: name one of ${film.map((x) => x.name).join(', ')}`);
        if (BLOCKING.findIndex((o) => o?.shot === r.shot) < i) throw new Error(`the blocking has two rows for ${called(r.shot)}: keep one`);
        if (!plain(r.marks)) throw new Error(`the blocking for ${called(r.shot)} has marks that are not named design points, got ${shown(r.marks)}: give each subject's point by name, such as { a: [420, 520] }`);
        for (const [name, p] of Object.entries(r.marks)) if (!point(p)) throw new Error(`the blocking for ${called(r.shot)} has a mark ${name} that is not a design point [x, y], got ${shown(p)}`);
        if (!(Array.isArray(r.line) && r.line.length === 2 && r.line[0] !== r.line[1] && r.line.every((m) => typeof m === 'string' && Object.hasOwn(r.marks, m)))) {
          throw new Error(`the blocking for ${called(r.shot)} has a line that is not two different names of its marks, got ${shown(r.line)}: name its two ends, such as ['a', 'b']`);
        }
        if (r.cross !== undefined && r.cross !== true) throw new Error(`the blocking for ${called(r.shot)} takes cross: true or no cross, got ${shown(r.cross)}`);
        return { shot: r.shot, marks: { ...r.marks }, line: [...r.line], ...(r.cross && { cross: true }) };
      });
      // The FOCUS rows as --cuts reads them, in design units; no key without a row.
      const focus = FOCUS.map((r) => ({ shot: r.shot, ...(point(r.in) && { in: [...r.in] }), ...(point(r.out) && { out: [...r.out] }), ...(r.jolt && { jolt: true }), ...(r.carry && { carry: r.carry }) }));
      s.cues = { shots: film, elements, sounds, ducks, contacts, camera, views, beats, blocking, ...(focus.length && { focus }), peak: peak ? peak.frame : null };
    }],
  ],

  draw(g, s, _t, clock) {
    // THE GROUND: the part of every frame that never changes, drawn once.
    layer(g, s, 'ground', [0, 0, W, H], (lg) => {
      lg.fillStyle = '#808080';
      lg.fillRect(0, 0, W, H);
    });
    const f = clock.frame;
    const view = viewAt(s.cues.camera, f);
    const shot = s.cues.shots.find((x) => x.start <= f && f < x.end)?.name;
    for (const e of s.cues.elements) {
      if (f < e.enter || f >= e.exit || !PAINT[e.name]) continue;
      if (e.shots && !e.shots.includes(shot)) continue;
      const depth = e.depth === undefined ? 1 : e.depth;
      g.save();
      g.translate(W / 2, H / 2);
      const k = view.zoom * view.dolly ** depth;
      g.scale(k, k);
      g.translate(-(W / 2 + (view.x - W / 2) * depth), -(H / 2 + (view.y - H / 2) * depth));
      PAINT[e.name](g, s, e, { u: span(e.enter, e.exit - 1, f), since: (f - e.enter) / HZ }, clock);
      g.restore();
    }
  },

  sound(ctx, s, timeline) {
    const R = rng(s.seed);
    const dry = ctx.createGain();
    // ROOM under null, then each place's room.
    const halls = new Map([[null, room(ctx, R, 'room', ROOM)],
      ...Object.entries(ROOMS).map(([place, opts]) => [place, room(ctx, R, `room ${place}`, opts)])]);
    const out = ctx.createGain();
    if (!timeline.loop) {
      out.gain.setValueAtTime(1, Math.max(0, timeline.duration - 0.08));
      out.gain.linearRampToValueAtTime(0, timeline.duration);
    }
    sumInto(ctx, [dry, ...halls.values()], out);
    out.connect(ctx.destination);
    const voices = [], music = [];
    const sends = new Map([...halls.keys()].map((place) => [place, []]));
    const musicSends = new Map([...halls.keys()].map((place) => [place, []]));
    for (const c of s.cues.sounds) {
      const at = c.frame / timeline.hz;
      const v = c.ambience ? ambience(ctx, R, c.name, at, c.ambience) : c.pluck ? pluck(ctx, R, c.name, at, c.pluck) : voice(ctx, R, c.name, at, c.voice);
      // A row with gain keys follows the picture: one gain over its dry path and
      // its room send ramps linearly from key to key, holding its first key's
      // gain before it and its last's after it.
      const level = c.gain ? ctx.createGain() : v;
      if (c.gain) {
        level.gain.value = c.gain[0][1];
        c.gain.forEach(([k, g], j) => level.gain[j ? 'linearRampToValueAtTime' : 'setValueAtTime'](g, k / timeline.hz));
        v.connect(level);
      }
      const send = ctx.createGain();
      const far = c.ambience ? 0 : SEND + (1 - SEND) * (c.voice?.distance || 0);
      send.gain.value = c.wet === undefined ? far : c.wet;
      if (c.voice) {
        // The room surrounds a voice wherever it is panned: its send folds the
        // panned voice to one channel, (L + R) / 2, and undoes the panner's
        // equal-power law, whose two sides sum to sin((pan + 2) pi / 4) of a
        // centred voice's, so every voice reaches both sides of the room as a
        // centred one does. A voice moving along pan points has its send ramp
        // linearly along the same points: exact at each point, while between
        // points a wide crossing runs up to about 3 dB hot midway.
        Object.assign(send, { channelCount: 1, channelCountMode: 'explicit' });
        const base = send.gain.value;
        const undo = (pan) => base / Math.sin(((pan + 2) * Math.PI) / 4);
        const { pan = 0 } = c.voice;
        if (Array.isArray(pan)) {
          send.gain.value = undo(pan[0][1]);
          send.gain.setValueAtTime(undo(pan[0][1]), at);
          for (const [t, p] of pan) send.gain.linearRampToValueAtTime(undo(p), at + t);
        } else send.gain.value = undo(pan);
      } else if (c.ambience?.grains?.noise) {
        // Noise grains are many hits as one texture, so the room takes them as
        // it takes a voice: folded to one channel, divided by the panner's sum
        // as a power average over their seeded places, sqrt((1 + 2 / pi) / 2),
        // so a grain reaches both sides, on average as a centred voice does,
        // from 0.9 dB over (a centred grain) to 2.1 dB under (a hard-panned one).
        Object.assign(send, { channelCount: 1, channelCountMode: 'explicit' }).gain.value /= Math.sqrt((1 + 2 / Math.PI) / 2);
      }
      level.connect(send);
      (c.role ? music : voices).push(level);
      (c.role ? musicSends : sends).get(c.room).push(send);
    }
    // THE DUCK: the music's dry sum and each room's music sends pass a gain of
    // their own that dips under the caused sounds.
    const under = (nodes) => {
      if (!nodes.length || !s.cues.ducks.length) return nodes;
      const dip = duck(ctx, s.cues.ducks, { ...DUCK, length: timeline.duration });
      sumInto(ctx, nodes, dip);
      return [dip];
    };
    sumInto(ctx, [...voices, ...under(music)], dry);
    for (const [place, hall] of halls) sumInto(ctx, [...sends.get(place), ...under(musicSends.get(place))], hall);
  },
};
