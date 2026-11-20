// Score helpers (core/score.js): even rhythms, triad moves, least-motion
// voice leading checked against brute force, and shots as whole bars.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { euclid, tones, shift, lead, barCuts, extendChord, scale, express } = require('../core/score.js');

const draw = (p) => p.map((on) => (on ? 'x' : '.')).join('');

test('euclid spreads k onsets as evenly as n steps allow', () => {
  assert.equal(draw(euclid(3, 8)), 'x..x..x.');
  assert.equal(draw(euclid(5, 8)), 'x.x.xx.x', 'the cinquillo, at one of its rotations');
  assert.equal(draw(euclid(4, 16)), 'x...x...x...x...');
  assert.equal(draw(euclid(0, 4)), '....');
  assert.equal(draw(euclid(4, 4)), 'xxxx');
  assert.equal(draw(euclid(3, 8, 3)), 'x..x.x..', 'three steps later');
  assert.equal(draw(euclid(3, 8, -8)), draw(euclid(3, 8)));
  for (let n = 1; n <= 16; n++) {
    for (let k = 0; k <= n; k++) {
      const p = euclid(k, n);
      assert.equal(p.filter(Boolean).length, k, `${k} onsets in ${n}`);
      // Evenness: the gaps between onsets differ by one step at most.
      const at = p.flatMap((on, i) => (on ? [i] : [])), gaps = at.map((v, i) => (at[(i + 1) % at.length] - v + n) % n || n);
      if (k > 0) assert.ok(Math.max(...gaps) - Math.min(...gaps) <= 1, `gaps ${gaps} for ${k} in ${n}`);
    }
  }
  assert.throws(() => euclid(5, 4), /euclid: k must be at most n, got 5 onsets in 4 steps/);
  assert.throws(() => euclid(1, 0), /euclid: n must be a whole number, 1 or more, got 0/);
  assert.throws(() => euclid(1, 4, 0.5), /euclid: rotation must be a whole number of steps, got 0.5/);
});

test('tones spells a triad, and P, L and R each keep two notes and move the third by a step', () => {
  const C = { root: 0, minor: false };
  assert.deepEqual(tones(C), [0, 4, 7]);
  assert.deepEqual(tones({ root: 9, minor: true }), [9, 0, 4]);
  assert.deepEqual(shift(C, 'P'), { root: 0, minor: true });
  assert.deepEqual(shift(C, 'R'), { root: 9, minor: true });
  assert.deepEqual(shift(C, 'L'), { root: 4, minor: true });
  for (let root = 0; root < 12; root++) {
    for (const minor of [false, true]) {
      const chord = { root, minor };
      for (const move of 'PLR') {
        const next = shift(chord, move), kept = tones(next).filter((t) => tones(chord).includes(t));
        assert.equal(kept.length, 2, `${move} keeps two notes of ${JSON.stringify(chord)}`);
        assert.notEqual(next.minor, minor);
        assert.deepEqual(shift(next, move), chord, `${move} twice comes home`);
        const gone = tones(chord).find((t) => !tones(next).includes(t)), come = tones(next).find((t) => !tones(chord).includes(t));
        assert.ok(Math.min((come - gone + 12) % 12, (gone - come + 12) % 12) <= 2, 'the third note moves a tone at most');
      }
    }
  }
  assert.deepEqual(shift(C, ''), C);
  assert.deepEqual(shift(C, 'PL'), { root: 8, minor: false });
  assert.throws(() => shift(C, 'X'), /shift: moves must be a string of the letters P, L and R, got "X"/);
  assert.throws(() => tones({ root: 12, minor: false }), /tones: takes a triad \{ root, minor \}, root a pitch class from 0 to 11/);
});

// Every voicing within an octave of each voice, the slow way.
function brute(from, chord) {
  const classes = [...new Set(chord)];
  let best = Infinity;
  (function place(v, pick, sum) {
    if (v === from.length) {
      if (from.length >= classes.length && new Set(pick.map((n) => ((n % 12) + 12) % 12)).size < classes.length) return;
      best = Math.min(best, sum);
      return;
    }
    for (let note = from[v] - 12; note <= from[v] + 12; note++) {
      if (!classes.includes(((note % 12) + 12) % 12) || (v > 0 && note < pick[v - 1])) continue;
      place(v + 1, [...pick, note], sum + Math.abs(note - from[v]));
    }
  })(0, [], 0);
  return best;
}

test('lead moves the voices to the next chord by the least total motion, with no voice crossing', () => {
  assert.deepEqual(lead([60, 64, 67], tones({ root: 9, minor: true })), [60, 64, 69]);
  assert.deepEqual(lead([60, 64, 67], tones({ root: 5, minor: false })), [60, 65, 69]);
  assert.deepEqual(lead([60, 64, 67], [0, 4, 7]), [60, 64, 67], 'the same chord moves nothing');
  let cases = 0;
  for (let root = 0; root < 12; root++) {
    for (const minor of [false, true]) {
      for (const from of [[60, 64, 67], [55, 60, 64, 72], [48, 63], [57, 60, 65, 69, 72]]) {
        const chord = tones({ root, minor }), out = lead(from, chord), sum = out.reduce((s, n, i) => s + Math.abs(n - from[i]), 0);
        assert.equal(sum, brute(from, chord), `${from} to ${chord} moves ${sum}`);
        assert.ok(out.every((n) => chord.includes(((n % 12) + 12) % 12)), 'every voice lands on the chord');
        assert.ok(out.every((n, i) => i === 0 || n >= out[i - 1]), `no voice crosses in ${out}`);
        if (from.length >= 3) assert.equal(new Set(out.map((n) => n % 12)).size, 3, 'every note of the chord sounds');
        cases++;
      }
    }
  }
  assert.equal(cases, 96);
  assert.deepEqual(lead([60], [6]), [54], 'a tritone off, the lower note');
  assert.throws(() => lead([64, 60], [0]), /lead: the voices must be given low to high/);
  assert.throws(() => lead([60, 60.5], [0]), /lead: from must be a list of 1 to 8 whole MIDI notes, low to high/);
  assert.throws(() => lead([60], [12]), /lead: chord must be a list of pitch classes from 0 to 11/);
});

test('barCuts makes every shot a whole number of bars, end to start, never under one', () => {
  const cuts = barCuts([3.1, 0.4, 7.9], { bpm: 120 });
  assert.deepEqual(cuts, [{ bars: 2, start: 0, end: 4 }, { bars: 1, start: 4, end: 6 }, { bars: 4, start: 6, end: 14 }]);
  assert.deepEqual(barCuts([2], { bpm: 90, beats: 3, start: 1 }), [{ bars: 1, start: 1, end: 3 }]);
  assert.deepEqual(barCuts([], { bpm: 100 }), []);
  assert.throws(() => barCuts([1], {}), /barCuts: bpm must be a positive number of beats a minute, got undefined/);
  assert.throws(() => barCuts([0], { bpm: 100 }), /barCuts: lengths must be a list of seconds, each over 0/);
  assert.throws(() => barCuts([1], { bpm: 100, beats: 0 }), /barCuts: beats must be a whole number, 1 or more, got 0/);
});

test('extendChord, scale and express build extended harmonies, modal collections and phrased contours', () => {
  const { rng } = require('../core/rand.js');
  const C = { root: 0, minor: false };
  assert.deepEqual(extendChord(C, '7'), [0, 4, 7, 10]);
  assert.deepEqual(extendChord(C, 'maj7'), [0, 4, 7, 11]);
  assert.deepEqual(extendChord(C, '9'), [0, 4, 7, 10, 2]);
  assert.deepEqual(extendChord(C, 'sus4'), [0, 5, 7]);
  assert.deepEqual(scale(2, 'dorian'), [2, 4, 5, 7, 9, 11, 0]);
  assert.deepEqual(scale(0, 'pentatonic'), [0, 2, 4, 7, 9]);

  const raw = [{ at: 0, note: 60 }, { at: 0.5, note: 66 }, { at: 1, note: 67 }];
  const phrased = express(raw, { R: rng(5), name: 'mel', tonic: 0, arch: 0.3, humanize: 0.005 });
  assert.equal(phrased.length, 3);
  assert.ok(phrased[1].tension > phrased[2].tension, 'tritone has higher tension than fifth');
  assert.ok(phrased.every((n) => n.velocity >= 0.05 && n.velocity <= 1));
  assert.deepEqual(express(raw, { R: rng(5), name: 'mel' }), express(raw, { R: rng(5), name: 'mel' }), 'the same seed phrases the same way');
  assert.ok(Number.isFinite(express([{ at: 0, note: 60.5 }])[0].velocity), 'a microtonal note still gets a velocity');
  assert.throws(() => express([{ at: 0 }]), /express: note 0 must be \{ at, note \} with note a MIDI number/);
  assert.throws(() => express(raw, { R: 3 }), /express: R must be the piece's R/);
  assert.throws(() => extendChord(C, 'maj13'), /extendChord: kind must be one of/);
  assert.throws(() => scale(12, 'dorian'), /scale: root must be a pitch class from 0 to 11, got 12/);
});
