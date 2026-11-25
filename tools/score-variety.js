#!/usr/bin/env node
// score-variety -- do several scores converge on one? Reads scores and reports, with no
// model, how often the most common key and progression come back, the tempo spread, how
// many forms are distinct, and the mean pairwise Jaccard of chord pairs and rhythm 4-grams.
//
//   node tools/score-variety.js <score.json>...            scores written by hand or by agents
//   node tools/score-variety.js --piece <name> [--seeds 9] [--bpm 120]
//
// A score is { bpm, beats?: 4, notes: [{ at: seconds, midi }] }; a file may hold one or an array.
// A piece's score is the first array in its solved state whose items carry numeric `at` and
// `note` or `midi`. Keys are absolute (tonic and mode, Krumhansl-Schmuckler); a bar's chord is
// its lowest note as a degree over the tonic, so a transposed score shows the same
// progression. Onsets are quantised to sixteenths of a beat.

'use strict';

const fs = require('node:fs');
const { solve, validate } = require('../core/piece.js');

const USAGE = 'usage: node tools/score-variety.js <score.json>... | --piece <name> [--seeds 9] [--bpm 120]';
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function refuse(what) {
  process.stderr.write(`score-variety: ${what}, nothing was measured\n${USAGE}\n`);
  process.exit(2);
}

function pearson(a, b) {
  const ma = a.reduce((x, y) => x + y) / a.length;
  const mb = b.reduce((x, y) => x + y) / b.length;
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    n += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? n / Math.sqrt(da * db) : 0;
}

function keyOf(notes) {
  const hist = Array(12).fill(0);
  for (const n of notes) hist[((Math.round(n.midi) % 12) + 12) % 12]++;
  let best = { r: -Infinity };
  for (let t = 0; t < 12; t++) {
    for (const [mode, prof] of [['major', MAJOR], ['minor', MINOR]]) {
      const r = pearson(hist, prof.map((_, i) => prof[(i - t + 12) % 12]));
      if (r > best.r) best = { r, tonic: t, mode };
    }
  }
  return best;
}

function read(score, label) {
  if (!score || !Number.isFinite(score.bpm) || score.bpm <= 0) refuse(`${label} needs a positive bpm, got ${score && score.bpm}`);
  if (!Array.isArray(score.notes) || !score.notes.length) refuse(`${label} needs a non-empty notes array`);
  const beats = score.beats || 4;
  const step = 60 / score.bpm / 4;
  const notes = score.notes.map((n) => ({ q: Math.round(n.at / step), midi: n.midi }));
  const key = keyOf(notes);
  const deg = (m) => ((Math.round(m) - key.tonic) % 12 + 12) % 12;
  const bars = new Map();
  for (const n of notes) {
    const b = Math.floor(n.q / (beats * 4));
    if (!bars.has(b)) bars.set(b, []);
    bars.get(b).push(n);
  }
  const order = [...bars.keys()].sort((x, y) => x - y).map((b) => bars.get(b));
  const chords = order.map((bar) => deg(Math.min(...bar.map((n) => n.midi))));
  const prints = order.map((bar, i) => chords[i] + '/' + [...new Set(bar.map((n) => n.q % (beats * 4)))].sort((x, y) => x - y)
    + '/' + [...new Set(bar.map((n) => deg(n.midi)))].sort((x, y) => x - y));
  const letters = new Map();
  const form = prints.map((p) => letters.get(p) || (letters.set(p, String.fromCharCode(65 + letters.size)), letters.get(p))).join('');
  const onsets = [...new Set(notes.map((n) => n.q))].sort((x, y) => x - y);
  const ioi = onsets.slice(1).map((q, i) => q - onsets[i]);
  return {
    key: NAMES[key.tonic] + ' ' + key.mode,
    bpm: score.bpm,
    progression: chords.slice(0, 4).join('-'),
    form,
    pairs: new Set(chords.slice(1).map((c, i) => chords[i] + '>' + c)),
    grams: new Set(ioi.slice(3).map((_, i) => ioi.slice(i, i + 4).join(','))),
  };
}

function jaccard(a, b) {
  const union = new Set([...a, ...b]).size;
  return union ? [...a].filter((x) => b.has(x)).length / union : 1;
}

function top(list) {
  const count = new Map();
  for (const x of list) count.set(x, (count.get(x) || 0) + 1);
  const [value, n] = [...count].sort((x, y) => y[1] - x[1])[0];
  return { value, share: n / list.length, distinct: count.size };
}

function meanPairwise(scores, field) {
  let sum = 0, n = 0;
  for (let i = 0; i < scores.length; i++) {
    for (let j = i + 1; j < scores.length; j++) { sum += jaccard(scores[i][field], scores[j][field]); n++; }
  }
  return n ? sum / n : null;
}

function report(scores) {
  const bpms = scores.map((s) => s.bpm);
  const round = (x) => x === null ? null : Math.round(x * 1000) / 1000;
  return {
    scores: scores.length,
    key: top(scores.map((s) => s.key)),
    progression: top(scores.map((s) => s.progression)),
    tempo: { min: Math.min(...bpms), max: Math.max(...bpms), spread: Math.max(...bpms) - Math.min(...bpms) },
    form: top(scores.map((s) => s.form)),
    chordPairJaccard: round(meanPairwise(scores, 'pairs')),
    rhythmGramJaccard: round(meanPairwise(scores, 'grams')),
    each: scores.map((s) => ({ key: s.key, bpm: s.bpm, progression: s.progression, form: s.form })),
  };
}

function fromPiece(name, seeds, bpm) {
  const raw = require('../examples/index.js')[name];
  if (!raw) refuse(`no example called ${JSON.stringify(name)}, examples/index.js lists them`);
  const piece = validate(raw);
  const out = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const { state } = solve(piece, seed);
    const list = Object.values(state).find((v) => Array.isArray(v) && v.length
      && v.every((n) => n && Number.isFinite(n.at) && Number.isFinite(n.note ?? n.midi)));
    if (!list) refuse(`${name} leaves no note list in its solved state`);
    const b = Number.isFinite(state.bpm) ? state.bpm : bpm;
    if (!b) refuse(`${name} keeps no bpm in its state, give --bpm`);
    out.push(read({ bpm: b, notes: list.map((n) => ({ at: n.at, midi: n.note ?? n.midi })) }, `${name} seed ${seed}`));
  }
  return out;
}

function main(argv) {
  const flag = (f) => { const i = argv.indexOf(f); return i < 0 ? undefined : argv.splice(i, 2)[1]; };
  const piece = flag('--piece');
  const seeds = Number(flag('--seeds') ?? 9);
  const bpm = Number(flag('--bpm') ?? NaN);
  if (!Number.isInteger(seeds) || seeds < 2) refuse(`--seeds takes a whole number of 2 or more, got ${seeds}`);
  let scores;
  if (piece) scores = fromPiece(piece, seeds, bpm);
  else {
    if (!argv.length) refuse('no score given');
    scores = argv.flatMap((file) => {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      return (Array.isArray(data) ? data : [data]).map((s, i) => read(s, `${file} score ${i + 1}`));
    });
  }
  if (scores.length < 2) refuse(`variety needs 2 or more scores, got ${scores.length}`);
  process.stdout.write(JSON.stringify(report(scores), null, 2) + '\n');
}

main(process.argv.slice(2));
