// The sound of the loose forms: one voice for each kind of event in the
// score (see score.js events), panned where its form lies, in the room of the
// table. A piece that shows part of the score plays the events that fall in
// its own seconds, from `start`, so its soundtrack is its own and the next
// piece's begins where it ends.

'use strict';

const { ease } = require('../../core/time.js');
const { rng } = require('../../core/rand.js');
const { voice, room, sumInto } = require('../../core/sound.js');

const hertz = (note) => 440 * 2 ** ((note - 69) / 12);

// Each kind of event: what it sounds like, from its form's size `small` (1 the smallest) and its note.
const KINDS = {
  // One grain of dry paint cracking: a click of noise, no note (see crackle).
  grain: (e, small) => ({ pitch: 1000, partials: [[1, 0]], strike: { level: 1, colour: e.colour, length: 0.004 + 0.01 * (1 - small) }, level: 0.22 }),
  // A loose skin landing on the paint: a soft, tuned note, a plucked string's.
  land: (e, small) => ({ pitch: hertz(e.note), partials: [[1, 1], [2, 0.22], [3, 0.08], [4, 0.03]], decay: 0.6 + 0.6 * (1 - small), damp: 0.9, strike: { level: 0.12, colour: 1400, length: 0.012 }, level: 0.16 }),
  // A form drawn over the dry paint: a low, smooth breath as long as the slide, louder the heavier (see friction).
  slide: (e, small) => ({ pitch: 200, partials: [[1, 0]], attack: 0.2, decay: 0.3, tail: { level: 1, colour: 150 + 160 * small, length: e.length * 1.2 }, level: (e.skin.shape === 'line' ? 0.07 : 0.2) * (0.3 + 0.7 * (1 - small)) }),
  // One grain of that friction: a small scrape, soft for a round form, rough for a line (see friction).
  scrape: (e) => ({ pitch: 1000, partials: [[1, 0]], strike: { level: 1, colour: e.colour, length: e.skin.shape === 'round' ? 0.018 : 0.008 }, level: 0.09 }),
  // A long line laid on the staff: a low string, bowed briefly.
  string: (e) => ({ pitch: hertz(e.note), partials: [[1, 1], [2, 0.5], [3, 0.3], [4, 0.14], [5, 0.08]], attack: 0.06, decay: 2.2, damp: 0.7, detune: 4, tail: { level: 0.25, length: 0.8 }, level: 0.1 }),
  // A big form landing or hopping: a soft drum of paint.
  drum: (e) => ({ pitch: hertz(e.note), partials: [[1, 1], [1.59, 0.45], [2.14, 0.25], [2.65, 0.1]], decay: 0.8, damp: 1.2, strike: { level: 0.3, colour: 700, length: 0.03 }, level: 0.19 }),
  // A middling form: a mallet on wood.
  mallet: (e) => ({ pitch: hertz(e.note), partials: [[1, 1], [3.93, 0.3], [9.2, 0.08]], decay: 1.0, damp: 1, strike: { level: 0.25, colour: 2200, length: 0.015 }, level: 0.16 }),
  // The rainbow: a bell.
  bell: (e) => ({ pitch: hertz(e.note), partials: [[1, 1], [2.76, 0.5], [5.4, 0.25], [8.93, 0.1]], decay: 2.4, damp: 0.5, detune: 3, level: 0.1 }),
  // The cursor set down: a knock of wood.
  knock: (e) => ({ pitch: hertz(e.note), partials: [[1, 1], [2.4, 0.3]], decay: 0.18, damp: 1, strike: { level: 0.8, colour: 1500, length: 0.02 }, level: 0.2 }),
  // A small thing set down: a tick.
  tick: (e) => ({ pitch: hertz(e.note), partials: [[1, 0.5]], decay: 0.05, damp: 1, strike: { level: 0.8, colour: 4200, length: 0.012 }, level: 0.08 }),
  // A form striking another as it falls: its knock and its note, soft for a round form, woody for a line.
  strike: (e, small) => ({ pitch: hertz(e.note), partials: e.skin.shape === 'round' ? [[1, 1], [2.4, 0.22], [4.1, 0.06]] : e.skin.shape === 'line' ? [[1, 1], [2.76, 0.35], [5.4, 0.12]] : [[1, 1], [3.2, 0.3], [6.3, 0.08]], decay: 0.25 + 0.7 * (1 - small), damp: 1, strike: { level: 0.45, colour: RUB[e.skin.shape][0] + (RUB[e.skin.shape][1] - RUB[e.skin.shape][0]) * small, length: 0.012 + 0.02 * (1 - small) }, level: 0.15 }),
  // The board bending as the box deepens: a slow, low creak of wood fibre.
  creak: (e) => ({ pitch: hertz(e.note), partials: [[1, 0.35], [2.3, 0.15]], attack: 0.03, decay: 0.12, damp: 1, strike: { level: 0.7, colour: 420 + (e.note - 38) * 200, length: 0.05 }, level: 0.12 }),
  // The box, hollow: a low ring that swells as its walls rise and dies away.
  hollow: (e) => ({ pitch: hertz(e.note - 12), partials: [[1, 1], [1.51, 0.45], [2.27, 0.22], [3.02, 0.08]], attack: 0.9, hold: 0.6, decay: 2.6, damp: 0.6, detune: 5, tail: { level: 0.2, colour: 300, length: 2.4 }, level: 0.16 }),
  // The pile at rest: a held, bowed tone that swells and fades, one voice of its chord.
  rest: (e) => ({ pitch: hertz(e.note), partials: [[1, 1], [2, 0.4], [3, 0.2], [4, 0.08]], attack: 1.3, hold: 0.8, decay: 3.2, damp: 0.6, detune: 6, tail: { level: 0.15, length: 2 }, level: 0.08 }),
  // A digit read: its note, clear.
  note: (e) => ({ pitch: hertz(e.note), partials: [[1, 1], [2, 0.3], [3, 0.12], [4, 0.05]], decay: 0.9, damp: 0.8, strike: { level: 0.15, colour: 3000, length: 0.01 }, level: 0.2 }),
};

/**
 * A crack as dry paint makes it: a run of grains over a tenth of a second or
 * so, more and lower for a larger form, each at its own moment and colour.
 */
function crackle(e, small, R) {
  const n = 3 + Math.round(6 * (1 - small)), span = 0.05 + 0.12 * (1 - small), out = [], name = 'crackle ' + e.skin.i;
  for (let j = 0; j < n; j++) {
    const u = R(name, 'at', j);
    out.push({ ...e, kind: 'grain', at: e.at + span * u * u, colour: (1800 + 3800 * small) * (0.7 + 0.6 * R(name, 'colour', j)), velocity: e.velocity * (0.5 + 0.5 * R(name, 'level', j)), j });
  }
  return out;
}

// The friction's colour and grain by shape: [lowest colour, highest, units travelled a grain].
const RUB = { round: [380, 1100, 9], flat: [800, 2000, 7], line: [1400, 3600, 4.5] };

/**
 * A form's friction as it slides: the breath of its weight, and grains of
 * scrape, one each time it has gone a little further, so they come thick
 * while it moves fast and thin out as it eases to a stop; the colour by its
 * shape and size, each grain a little different.
 */
function friction(e, small, R) {
  const [lo, hi, pace] = RUB[e.skin.shape], step = Math.max(pace, e.far / 28), name = 'rub ' + e.skin.i + ' ' + e.at.toFixed(3);
  const out = [e], n = 60, way = (u) => ease[e.rate](u) * e.far, top = (1.6 * e.far) / e.length;
  let next = step, j = 0;
  for (let i = 1; i <= n; i++) {
    const was = way((i - 1) / n), is = way(i / n), speed = ((is - was) * n) / e.length;
    while (is >= next) {
      const u = (i - 1 + (next - was) / Math.max(1e-6, is - was)) / n;
      out.push({ ...e, kind: 'scrape', at: e.at + u * e.length, colour: (lo + (hi - lo) * small) * (0.8 + 0.4 * R(name, 'colour', j)), velocity: e.velocity * (0.25 + 0.75 * Math.min(1, speed / top)) * (0.6 + 0.4 * R(name, 'level', j)), j: j++ });
      next += step;
    }
  }
  return out;
}

// How far back a piece reaches for notes still ringing as it begins, begun in the piece before it:
// longer than the longest voice, the rest chord's 5.3 s (see KINDS rest).
const CARRY = 6;
// -60 dB, where a decay counts as over (as core/sound.js voice has it).
const QUIET = 1e-3;

/**
 * The rest of a note begun `ago` seconds before this piece starts: its body
 * from where its decay has reached, each partial as far down as its own decay
 * (`decay / ratio ** damp`, as core/sound.js voice has it) has taken it, and
 * silent once that is over, entering over 20 ms; its strike and its breath are
 * over. Null when nothing of it is left.
 */
function ringing(spec, ago) {
  const { attack = 0.005, hold = 0, decay = 1, damp = 0.5, partials = [[1, 1]] } = spec, top = attack + hold, gone = Math.max(0, ago - top);
  if (gone >= decay * 0.95) return null;
  // Relative to the level the whole voice is set at, which follows the lowest partial.
  const left = (r) => (gone >= decay / r ** damp ? 0 : QUIET ** ((gone * r ** damp) / decay - gone / decay));
  return {
    ...spec, attack: 0.02, hold: Math.max(0, top - ago), decay: decay - gone, strike: {}, tail: {},
    partials: partials.map(([r, l]) => [r, l * left(r)]),
    level: (spec.level === undefined ? 1 : spec.level) * QUIET ** (gone / decay),
  };
}

/**
 * Play every event in `list` that falls from second `start` for `length`
 * seconds, at its time less `start`, panned by its form's place about
 * `mid`, into the context's destination through the room of the table.
 * Notes begun in the few seconds before `start` go on ringing from where
 * they had got to, and a slide still under way goes on scraping, so a piece
 * picks up what the one before it left sounding.
 */
function play(ctx, s, list, start, length, mid) {
  const R = rng(s.seed), voices = [];
  for (const ev of list) {
    if (ev.at < start - CARRY || ev.at >= start + length) continue;
    const small = Math.min(1, 40 / ev.skin.size), pan = ev.pan !== undefined ? ev.pan : Math.max(-0.8, Math.min(0.8, (ev.skin.c[0] - mid) / 380));
    const name = (e) => `${e.kind} ${e.skin.i} ${e.at.toFixed(3)} ${e.j || 0}`;
    if (ev.at < start && ev.kind !== 'slide') {
      // A note carries over; a crack is over by now.
      if (ev.kind === 'crack') continue;
      const spec = ringing(KINDS[ev.kind](ev, small), start - ev.at);
      if (spec) voices.push(voice(ctx, R, name(ev), 0, { ...spec, velocity: ev.velocity, vary: 0.6, pan }));
      continue;
    }
    // A slide begun before this piece plays the grains of its friction from here on.
    for (const e of ev.kind === 'crack' ? crackle(ev, small, R) : ev.kind === 'slide' ? friction(ev, small, R) : [ev]) {
      if (e.at >= start) voices.push(voice(ctx, R, name(e), e.at - start, { ...KINDS[e.kind](e, small), velocity: e.velocity, vary: 0.6, pan }));
    }
  }
  const dry = ctx.createGain(), out = ctx.createGain(), send = ctx.createGain(), hall = room(ctx, R, 'table', { size: 1.4, bright: 6000, dark: 700 });
  out.gain.value = 0.9;
  send.gain.value = 0.3;
  sumInto(ctx, voices, dry);
  dry.connect(out);
  dry.connect(send);
  send.connect(hall);
  out.connect(ctx.destination);
  hall.connect(ctx.destination);
}

module.exports = { play };
