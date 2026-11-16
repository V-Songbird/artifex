// Acoustic voices a score calls by name, each built from how the thing makes
// its sound: which partials a bar, a string or a pipe has, how it is started,
// how it dies, what moves while it sounds. Each is a recipe for `voice` or
// `pluck` of core/sound.js, so a piece can take one and change it.
//
// Nothing here knows what kind of art a piece makes.
'use strict';

const { voice, pluck } = require('./sound.js');

// Cents between two partials that beat `hz` times a second at `pitch`.
const beat = (pitch, hz) => 1200 * Math.log2(1 + hz / pitch);

const RECIPES = {
  // A steel plate over a tuned box: the box keeps the fundamental and little
  // else of the plate's own inharmonic modes; a hard, small hammer.
  celesta: ({ pitch, length }) => ({ pitch, partials: [[1, 1], [2, 0.16], [2.76, 0.1], [5.4, 0.05]], attack: 0.002, hold: 0, decay: 1.1 * length, damp: 1.1,
    strike: { colour: Math.min(9000, pitch * 6), length: 0.012, level: 0.18 } }),
  // An aluminium bar cut so its modes sit at 1, 4 and 10; it rings long, and
  // the turning discs in its pipes make it swell and fade about five times a
  // second, drawn here as two partials that beat.
  vibraphone: ({ pitch, length }) => ({ pitch, partials: [[1, 1], [4, 0.22], [10, 0.06]], attack: 0.003, hold: 0, decay: 3.2 * length, damp: 0.7,
    detune: beat(pitch, 5.2), strike: { colour: Math.min(7000, pitch * 4), length: 0.015, level: 0.12 } }),
  // A rosewood bar, tuned 1, 4 and about 9.2, over a pipe: wood loses its
  // highs at once and its fundamental soon; a soft mallet.
  marimba: ({ pitch, length }) => ({ pitch, partials: [[1, 1], [4, 0.2], [9.2, 0.05]], attack: 0.003, hold: 0, decay: 0.55 * length, damp: 1.6,
    strike: { colour: Math.min(3500, pitch * 3), length: 0.02, level: 0.22 } }),
  // Many bowed strings on one note: a string's partials fall as one over
  // their number; a bow starts it slowly; no two players agree to the cent,
  // and each lets the pitch swing once the note has settled.
  strings: ({ pitch, length }) => ({ pitch, partials: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => [n, 1 / n]), attack: 0.22, hold: Math.max(0, length - 0.5), decay: 0.6, damp: 0.5,
    detune: 9, vibrato: { depth: 14, rate: 5.4, delay: 0.25, rise: 0.4 }, tail: { level: 0.05, colour: Math.min(9000, pitch * 8), length: 0.3 } }),
  // A pipe blown across its edge: few partials, the first far the strongest;
  // the breath is heard with it, and a short hiss an octave up starts it.
  flute: ({ pitch, length }) => ({ pitch, partials: [[1, 1], [2, 0.28], [3, 0.1], [4, 0.04]], attack: 0.07, hold: Math.max(0, length - 0.25), decay: 0.22, damp: 0.3,
    vibrato: { depth: 9, rate: 4.8, delay: 0.3, rise: 0.4 }, strike: { colour: pitch * 2, length: 0.05, level: 0.16 },
    tail: { level: 0.2, colour: Math.min(8000, pitch * 3), rise: 0.06, length: Math.max(0.1, length) } }),
  // Wires swept over a drum skin: nearly all noise, a swish that rises and
  // falls, over a faint thud of the head's first two modes.
  brush: ({ length }) => ({ pitch: 190, partials: [[1, 0.25], [1.59, 0.15]], attack: 0.004, hold: 0, decay: 0.12, damp: 1,
    strike: { colour: 4500, length: 0.1 * length, level: 0.35 }, tail: { level: 0.6, colour: 5200, rise: 0.03 * length, length: 0.2 * length } }),
  // A wooden box struck on its face: a low thump from the air inside, the
  // plate's own modes above it, and a slap of loose wires.
  cajon: () => ({ pitch: 92, partials: [[1, 1], [1.59, 0.4], [2.3, 0.2], [3.6, 0.08]], attack: 0.002, hold: 0, decay: 0.28, damp: 1.2,
    strike: { colour: 2600, length: 0.035, level: 0.5 } }),
  // A cymbal rolled with soft sticks: many close inharmonic modes fused into
  // noise that swells and then washes out.
  cymbal: ({ length }) => ({ partials: [[1, 0]], strike: { level: 0 }, tail: { level: 1, colour: 7000, rise: 0.7 * length, length: 0.9 * length + 0.4 } }),
};

/** The names `recipe` and `play` take. */
const INSTRUMENTS = Object.freeze([...Object.keys(RECIPES), 'pluck']);

/**
 * The spec for one note of the instrument `kind`, to hand to `voice` (or to
 * `pluck` for 'pluck') of core/sound.js, or to change first. `opt.pitch` is
 * in hertz, needed by the pitched ones; `opt.length` (default 1) is how long
 * the note is held or rings, in seconds; `opt.velocity` (default 0.8, from 0
 * to 1) is how hard it is started, softer being darker; `opt.level`, `opt.pan`
 * and `opt.vary` (default 0.3) pass through.
 */
function recipe(kind, opt = {}) {
  if (!INSTRUMENTS.includes(kind)) throw new RangeError(`recipe: kind must be one of ${INSTRUMENTS.join(', ')}, got ${JSON.stringify(kind)}`);
  const { pitch, length = 1, velocity = 0.8, level = 1, pan = 0, vary = 0.3 } = opt;
  const pitched = !['brush', 'cajon', 'cymbal'].includes(kind);
  if (pitched && !(pitch > 0 && Number.isFinite(pitch))) throw new RangeError(`recipe: ${kind} needs a pitch in hertz over 0, got ${pitch}`);
  if (!(length > 0 && Number.isFinite(length))) throw new RangeError(`recipe: length must be seconds over 0, got ${length}`);
  if (!(velocity >= 0 && velocity <= 1)) throw new RangeError(`recipe: velocity must be from 0 to 1, got ${velocity}`);
  // A plucked string is the string itself: a loop of noise that averages away.
  if (kind === 'pluck') return { pitch, decay: 1.6 * length, level: level * velocity };
  return { ...RECIPES[kind]({ pitch, length }), level, pan, velocity, vary };
}

/** One note of `kind` started at `at` seconds: `recipe(kind, opt)` played through `voice` or `pluck`. Returns the output node, to sum with `sumInto`. */
function play(ctx, R, name, at, kind, opt) {
  const spec = recipe(kind, opt);
  return kind === 'pluck' ? pluck(ctx, R, name, at, spec) : voice(ctx, R, name, at, spec);
}

module.exports = { recipe, play, INSTRUMENTS };
