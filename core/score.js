// A score composed by rule: rhythms spread evenly over a bar, chords that
// move by one small step, voices that go to the next chord by the least
// motion, and shots as long as whole bars. Pure functions over plain lists;
// notes are MIDI numbers, 60 for middle C, and pitch classes are 0 to 11.
//
// Nothing here knows what kind of art a piece makes.
'use strict';

const { bars } = require('./time.js');

function whole(who, what, v, min) {
  if (!Number.isSafeInteger(v) || v < min) throw new RangeError(`${who}: ${what} must be a whole number, ${min} or more, got ${v}`);
  return v;
}

/**
 * `k` onsets spread as evenly as `n` steps allow (Toussaint 2005, the
 * Euclidean rhythms): a list of `n` true and false, the first always an onset
 * when `k` is over 0. `rotation` (default 0) starts the pattern that many
 * steps later. euclid(3, 8) is the tresillo: x . . x . . x .
 */
function euclid(k, n, rotation = 0) {
  whole('euclid', 'n', n, 1);
  whole('euclid', 'k', k, 0);
  if (k > n) throw new RangeError(`euclid: k must be at most n, got ${k} onsets in ${n} steps`);
  if (!Number.isSafeInteger(rotation)) throw new RangeError(`euclid: rotation must be a whole number of steps, got ${rotation}`);
  return Array.from({ length: n }, (_, i) => { const s = (((i + rotation) % n) + n) % n; return (s * k) % n < k; });
}

function chordOf(who, chord) {
  if (!chord || !Number.isInteger(chord.root) || chord.root < 0 || chord.root > 11 || typeof chord.minor !== 'boolean') {
    throw new TypeError(`${who}: takes a triad { root, minor }, root a pitch class from 0 to 11`);
  }
  return chord;
}

/** The three pitch classes of a triad { root, minor }: root, third, fifth. */
function tones(chord) {
  const { root, minor } = chordOf('tones', chord);
  return [root, (root + (minor ? 3 : 4)) % 12, (root + 7) % 12];
}

/**
 * The triad one small step away (Cohn 1997): each move keeps two notes and
 * shifts the third by a semitone or a tone, and turns major into minor or
 * back. 'P' keeps root and fifth (C major to C minor), 'R' goes to the
 * relative (C major to A minor), 'L' moves the root down a semitone (C major
 * to E minor). A string of moves, such as 'PLR', is taken in order.
 */
function shift(chord, moves) {
  let { root, minor } = chordOf('shift', chord);
  if (typeof moves !== 'string' || !/^[PLR]*$/.test(moves)) throw new TypeError(`shift: moves must be a string of the letters P, L and R, got ${JSON.stringify(moves)}`);
  for (const move of moves) {
    if (move === 'R') root = (root + (minor ? 3 : 9)) % 12;
    else if (move === 'L') root = (root + (minor ? 8 : 4)) % 12;
    minor = !minor;
  }
  return { root, minor };
}

/**
 * Where each voice goes for the next chord with the least motion (Tymoczko
 * 2006): `from` is the voices' notes, low to high; `chord` the pitch classes
 * to reach. Every voice lands on a note of the chord, every pitch class is
 * sounded when there are voices enough, no voice crosses another, and the sum
 * of the moves in semitones is the least there is. Among equal sums it takes
 * the smallest largest move, then the lower notes. Returns the new notes.
 */
function lead(from, chord) {
  if (!Array.isArray(from) || from.length === 0 || from.length > 8 || !from.every(Number.isInteger)) throw new TypeError('lead: from must be a list of 1 to 8 whole MIDI notes, low to high');
  for (let i = 1; i < from.length; i++) if (from[i] < from[i - 1]) throw new RangeError('lead: the voices must be given low to high');
  if (!Array.isArray(chord) || chord.length === 0 || !chord.every((c) => Number.isInteger(c) && c >= 0 && c <= 11)) throw new TypeError('lead: chord must be a list of pitch classes from 0 to 11');
  const classes = [...new Set(chord)];
  // For each voice, the nearest note of each pitch class, both ways when it is a tritone off.
  const reach = from.map((note) => classes.flatMap((c) => {
    const up = (((c - note) % 12) + 12) % 12;
    return up === 6 ? [note - 6, note + 6] : [up < 6 ? note + up : note + up - 12];
  }));
  let best = null;
  const pick = new Array(from.length);
  (function place(v, sum, most) {
    if (best && sum > best.sum) return;
    if (v === from.length) {
      if (from.length >= classes.length && new Set(pick.map((n) => ((n % 12) + 12) % 12)).size < classes.length) return;
      const differs = best ? pick.findIndex((n, i) => n !== best.notes[i]) : -1;
      const lower = differs >= 0 && pick[differs] < best.notes[differs];
      if (!best || sum < best.sum || most < best.most || (most === best.most && lower)) best = { sum, most, notes: [...pick] };
      return;
    }
    for (const note of reach[v]) {
      if (v > 0 && note < pick[v - 1]) continue;
      pick[v] = note;
      place(v + 1, sum + Math.abs(note - from[v]), Math.max(most, Math.abs(note - from[v])));
    }
  })(0, 0, 0);
  if (!best) throw new RangeError('lead: no voicing reaches every note of the chord without crossing voices; give the voices more room');
  return best.notes;
}

/**
 * Shots as long as whole bars, so every cut lands on a downbeat: `lengths`
 * are the seconds each shot was meant to last, in order; each is rounded to
 * the nearest whole number of bars, never under one. Returns
 * [{ bars, start, end }], in seconds from `opt.start` (default 0), at
 * `opt.bpm` beats a minute and `opt.beats` beats a bar (default 4).
 */
function barCuts(lengths, opt = {}) {
  const { bpm, beats = 4, start = 0 } = opt;
  if (!Array.isArray(lengths) || !lengths.every((s) => Number.isFinite(s) && s > 0)) throw new TypeError('barCuts: lengths must be a list of seconds, each over 0');
  if (!(bpm > 0 && Number.isFinite(bpm))) throw new RangeError(`barCuts: bpm must be a positive number of beats a minute, got ${bpm}`);
  whole('barCuts', 'beats', beats, 1);
  if (!Number.isFinite(start)) throw new RangeError(`barCuts: start must be a finite second, got ${start}`);
  const bar = beats * 60 / bpm;
  let count = 0;
  return lengths.map((seconds) => {
    const bars = Math.max(1, Math.round(seconds / bar)), from = count;
    count += bars;
    return { bars, start: start + from * bar, end: start + count * bar };
  });
}

const CHORD_EXT = {
  triad: (r, third, fifth) => [r, third, fifth],
  sus2: (r, _third, fifth) => [r, (r + 2) % 12, fifth],
  sus4: (r, _third, fifth) => [r, (r + 5) % 12, fifth],
  6: (r, third, fifth) => [r, third, fifth, (r + 9) % 12],
  7: (r, third, fifth) => [r, third, fifth, (r + 10) % 12],
  maj7: (r, third, fifth) => [r, third, fifth, (r + 11) % 12],
  add9: (r, third, fifth) => [r, third, fifth, (r + 2) % 12],
  9: (r, third, fifth) => [r, third, fifth, (r + 10) % 12, (r + 2) % 12],
  m7b5: (r) => [r, (r + 3) % 12, (r + 6) % 12, (r + 10) % 12],
  dim7: (r) => [r, (r + 3) % 12, (r + 6) % 12, (r + 9) % 12],
};

/**
 * Extended chord pitch classes (`'triad' | '7' | 'maj7' | '9' | 'add9' | 'sus2' | 'sus4' | '6' | 'm7b5' | 'dim7'`)
 * over `{ root, minor }`, ready for `lead(from, extendChord(chord, kind))`.
 */
function extendChord(chord, kind = '7') {
  const { root, minor } = chordOf('extendChord', chord);
  const fn = CHORD_EXT[kind];
  if (!fn) throw new RangeError(`extendChord: kind must be one of ${Object.keys(CHORD_EXT).join(', ')}, got ${JSON.stringify(kind)}`);
  return fn(root, (root + (minor ? 3 : 4)) % 12, (root + 7) % 12);
}

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  minor: [0, 2, 3, 5, 7, 8, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  'harmonic-minor': [0, 2, 3, 5, 7, 8, 11],
  'melodic-minor': [0, 2, 3, 5, 7, 9, 11],
  pentatonic: [0, 2, 4, 7, 9],
  'minor-pentatonic': [0, 3, 5, 7, 10],
  'whole-tone': [0, 2, 4, 6, 8, 10],
};

/**
 * The pitch classes (`0..11`) of `mode` over `root` (`0..11`).
 */
function scale(root, mode = 'major') {
  if (!Number.isInteger(root) || root < 0 || root > 11) throw new RangeError(`scale: root must be a pitch class from 0 to 11, got ${root}`);
  const steps = SCALES[mode];
  if (!steps) throw new RangeError(`scale: mode must be one of ${Object.keys(SCALES).join(', ')}, got ${JSON.stringify(mode)}`);
  return steps.map((s) => (root + s) % 12);
}

/**
 * Shapes a phrase of notes (`[{ at, note, length, velocity }]`) with a deterministic
 * phrasing arch (`arch` in `[0, 1]`), harmonic tension toward `tonic` (`0..11`), and
 * micro-timing humanization from `R(name, 'timing' | 'accent', i)`.
 */
function express(notes, opt = {}) {
  if (!Array.isArray(notes)) throw new TypeError('express: notes must be a list of note events');
  const { R, name = 'phrase', tonic = 0, arch = 0.25, humanize = 0.008 } = opt;
  if (!Number.isInteger(tonic) || tonic < 0 || tonic > 11) throw new RangeError(`express: tonic must be a pitch class from 0 to 11, got ${tonic}`);
  if (!(arch >= 0 && arch <= 1)) throw new RangeError(`express: arch must be from 0 to 1, got ${arch}`);
  if (!(humanize >= 0 && humanize <= 0.1)) throw new RangeError(`express: humanize must be seconds from 0 to 0.1, got ${humanize}`);
  if (R !== undefined && typeof R !== 'function') throw new TypeError('express: R must be the piece\'s R(entity, property, index)');
  const TENSION = [0, 0.9, 0.35, 0.25, 0.2, 0.3, 0.95, 0.1, 0.4, 0.25, 0.45, 0.75];
  const n = notes.length;
  return notes.map((ev, i) => {
    if (!ev || !Number.isFinite(ev.note)) throw new TypeError(`express: note ${i} must be { at, note } with note a MIDI number, got ${JSON.stringify(ev)}`);
    const u = n > 1 ? i / (n - 1) : 0.5;
    const contour = Math.sin(Math.PI * u);
    const pc = ((Math.round(ev.note) - tonic) % 12 + 12) % 12;
    const tension = TENSION[pc];
    const dt = R ? humanize * (2 * R(name, 'timing', i) - 1) : 0;
    const dv = R ? 0.06 * (2 * R(name, 'accent', i) - 1) : 0;
    const baseVel = ev.velocity === undefined ? 0.75 : ev.velocity;
    const velocity = Math.min(1, Math.max(0.05, baseVel * (1 - 0.5 * arch + arch * contour) + 0.1 * tension + dv));
    return { ...ev, at: Math.max(0, (ev.at ?? 0) + dt), velocity, tension };
  });
}

const KINDS = [undefined, 'return', 'peak'];
// Where a section's phrase arch turns, as a share of the section: past the middle, so it arrives late and leaves soon.
const TURN = 0.6;

/**
 * A beat grid that breathes with the form, after the KTH performance rules
 * (Friberg, Bresin and Sundberg 2006). `plan` lists the form's sections in
 * order, `[{ name, bars, kind }]`, `kind` 'return' for a section that brings
 * the theme back and 'peak' for the high point. `opt` is `bars()`'s, plus how
 * far each rule reaches. Every section's downbeat stays where `bars(opt)` puts
 * it, so cuts on section lines and the film's length do not move; only the
 * beats inside a section stretch and press:
 * - the phrase arch (`depth`, `swell`): a little faster and louder up to the
 *   section's turn, broader and softer after it;
 * - the phrase-final ease (`ease`): each section's last beat a little longer;
 * - the breath (`breath`): the last beat before a 'return' longer again, and softer;
 * - the widening (`widen`): the section before a 'peak' grows louder and its
 *   last bar broadens; the peak holds that level;
 * - the close (`close`, the final tempo): the last section's last bar slows on
 *   the stopping runner's curve, v(x) = (1 + (w^q - 1) x)^(1/q) with q 3
 *   (Friberg and Sundberg 1999), and fades.
 * Returns the frozen grid of `bars(opt)` with `seconds` and `frame` warped,
 * `level(bar, beat)`, a gain near 1 for the note's velocity, and the `plan`.
 * Past the plan's last bar the grid is straight and the level 1.
 */
function phraseGrid(plan, opt = {}) {
  const { depth = 0.04, swell = 0.25, ease = 0.12, breath = 0.35, widen = 0.15, close = 0.5 } = opt;
  const straight = bars(opt);
  if (!Array.isArray(plan) || plan.length === 0) throw new TypeError('phraseGrid: plan must be a non-empty list of sections { name, bars, kind }');
  plan.forEach((s, i) => {
    if (!s || typeof s.name !== 'string' || !s.name) throw new TypeError(`phraseGrid: section ${i} must be { name, bars, kind } with a name`);
    whole('phraseGrid', `section "${s.name}" bars`, s.bars, 1);
    if (!KINDS.includes(s.kind)) throw new RangeError(`phraseGrid: section "${s.name}" kind must be 'return', 'peak' or left out, got ${JSON.stringify(s.kind)}`);
  });
  for (const [key, v, top] of [['depth', depth, 0.3], ['swell', swell, 1], ['ease', ease, 1], ['breath', breath, 1], ['widen', widen, 1]]) {
    if (!(v >= 0 && v <= top)) throw new RangeError(`phraseGrid: ${key} must be from 0 to ${top}, got ${v}`);
  }
  if (!(close > 0 && close <= 1)) throw new RangeError(`phraseGrid: close must be a final tempo over 0 and at most 1, got ${close}`);
  const B = straight.beats, beat = 60 / straight.bpm;
  const dur = [], lev = [];
  plan.forEach((s, k) => {
    const n = s.bars * B, next = plan[k + 1], last = k === plan.length - 1;
    const d = [];
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      const arch = u < TURN ? Math.sin((Math.PI / 2) * (u / TURN)) : Math.cos((Math.PI / 2) * ((u - TURN) / (1 - TURN)));
      let tempo = 1 + depth * (2 * arch - 1), level = 1 + swell * (arch - 0.5);
      const inLastBar = i >= n - B, x = (i - (n - B) + 0.5) / B;
      if (next && next.kind === 'peak') {
        level *= 1 + widen * (i + 1) / n;
        if (inLastBar) tempo /= 1 + widen * x;
      }
      if (s.kind === 'peak') level *= 1 + widen;
      if (i === n - 1) {
        tempo /= 1 + ease;
        if (next && next.kind === 'return') { tempo /= 1 + breath; level *= 1 - breath / 2; }
      }
      if (last && inLastBar) { tempo *= (1 + (close ** 3 - 1) * x) ** (1 / 3); level *= 1 - 0.3 * x; }
      d.push(1 / tempo);
      lev.push(level);
    }
    // Time kept: the section lasts its bars exactly, so its downbeat and the next stay on the straight grid.
    const sum = d.reduce((a, b) => a + b, 0);
    for (const v of d) dur.push(v * n / sum);
  });
  const cum = [0];
  for (const v of dur) cum.push(cum[cum.length - 1] + v);
  const total = dur.length;
  const seconds = (bar, b = 0) => {
    if (!Number.isFinite(bar) || !Number.isFinite(b)) throw new TypeError(`phraseGrid: the bar and beat must be finite numbers, got ${bar}, ${b}`);
    const n = bar * B + b, w = Math.floor(n);
    if (w < 0 || w >= total) return straight.seconds(bar, b);
    // The swing's place inside the beat, scaled to this beat's length.
    const f = (straight.seconds(0, n - w) - straight.start) / beat;
    return straight.start + (cum[w] + f * dur[w]) * beat;
  };
  const frame = (bar, b, hz) => {
    if (!Number.isFinite(hz) || hz <= 0) throw new RangeError(`phraseGrid: hz must be a positive, finite frame rate, got ${hz}`);
    return Math.round(seconds(bar, b) * hz);
  };
  const level = (bar, b = 0) => {
    const w = Math.floor(bar * B + b);
    return w >= 0 && w < total ? lev[w] : 1;
  };
  const { bpm, beats, start, swing } = straight;
  return Object.freeze({ bpm, beats, start, swing, seconds, frame, level, plan });
}

module.exports = { euclid, tones, shift, lead, barCuts, extendChord, scale, express, phraseGrid };
