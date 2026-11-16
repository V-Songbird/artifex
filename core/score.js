// A score composed by rule: rhythms spread evenly over a bar, chords that
// move by one small step, voices that go to the next chord by the least
// motion, and shots as long as whole bars. Pure functions over plain lists;
// notes are MIDI numbers, 60 for middle C, and pitch classes are 0 to 11.
//
// Nothing here knows what kind of art a piece makes.
'use strict';

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

module.exports = { euclid, tones, shift, lead, barCuts };
