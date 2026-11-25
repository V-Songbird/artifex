// pulse -- a picture that reads its score. Three voices play four bars, and each
// moves one kind of mark: the low voice the disc, the middle one the spokes, the
// high one the dots around them.
//
// IN THE SET BECAUSE THE CAUSE RUNS THE OTHER WAY. In the other films the picture
// happens and the sound follows it. Here the notes are written first, and the
// build reads from them, with no audio rendered, how loud each voice is on every
// frame. `draw` and `sound` read that one list, so a mark cannot move off its note.

'use strict';

const { rng } = require('../core/rand.js');
const { mix } = require('../core/colour.js');
const { bars } = require('../core/time.js');
const { voice, sumInto, hertz, scoreCurves } = require('../core/sound.js');

const W = 960;
const H = 540;
const HZ = 24;
const BPM = 120;          // 12 frames a beat at 24 fps, so every eighth is a whole frame
const BARS = 4;
const DUR = BARS * 4 * 60 / BPM;
const FRAMES = Math.round(DUR * HZ);
const TAU = Math.PI * 2;

// Semitones over the root, one chord a bar: i, VI, III, VII.
const CHORDS = [0, 8, 3, 10];
const PARTS = {
  low: { from: 0, hits: [0, 1.5, 3], notes: [0], pan: 0,
    spec: { partials: [[1, 1], [2, 0.3]], attack: 0.004, hold: 0.04, decay: 0.95, damp: 1, level: 0.3, vary: 0.2 } },
  mid: { from: 1, hits: [0.5, 2, 2.5, 3.5], notes: [12, 19, 24, 19], pan: -0.3,
    spec: { partials: [[1, 1], [2, 0.5], [3, 0.2]], attack: 0.003, hold: 0.02, decay: 0.7, damp: 1.2, level: 0.28, vary: 0.3 } },
  high: { from: 2, hits: [0, 0.75, 1.5, 2.25, 3], notes: [24, 31, 36, 31, 27], pan: 0.35,
    spec: { partials: [[1, 1], [2.76, 0.3]], attack: 0.002, decay: 0.45, damp: 1, level: 0.17, vary: 0.4 } },
};
const INKS = [
  { ground: '#14161c', orbit: '#343a46', low: '#e4573d', mid: '#e9c46a', high: '#9fd8cb' },
  { ground: '#f1eadc', orbit: '#cfc5b1', low: '#1f4e5f', mid: '#c8553d', high: '#3b2f45' },
  { ground: '#201a2b', orbit: '#463b58', low: '#f2a65a', mid: '#f6f1e9', high: '#7fb7be' },
];

module.exports = {
  name: 'pulse',
  size: { w: W, h: H },
  outputs: ['raster'],
  time: { duration: DUR, hz: HZ },
  seed: 4,
  params: {
    reach: { min: 0.2, max: 1, value: 0.7, meaning: 'how far each mark jumps when its voice sounds' },
  },

  state: () => ({ notes: [], curves: null, level: {}, turn: 0, ink: null }),

  build: [
    ['write the score', (s) => {
      const R = rng(s.seed);
      const root = 45 + Math.floor(R('score', 'root') * 5);
      s.turn = R('stage', 'turn') * TAU;
      s.ink = INKS[Math.floor(R('stage', 'ink') * INKS.length)];
      const grid = bars({ bpm: BPM });
      for (const [part, p] of Object.entries(PARTS)) {
        for (let bar = p.from; bar < BARS; bar++) {
          p.hits.forEach((beat, i) => {
            const accent = beat === 0 ? 1 : Number.isInteger(beat) ? 0.82 : 0.66;
            s.notes.push({
              part, name: `${part} ${bar} ${i}`, at: grid.seconds(bar, beat), note: root + CHORDS[bar] + p.notes[i % p.notes.length],
              spec: { ...p.spec, velocity: accent, pan: p.pan },
            });
          });
        }
      }
      for (const n of s.notes) n.spec.pitch = hertz(n.note);
      s.curves = scoreCurves(R, s.notes, { hz: HZ, frames: FRAMES, grid });
      for (const [part, curve] of Object.entries(s.curves.energy)) {
        const top = Math.max(...curve);
        s.level[part] = curve.map((v) => v / top);
      }
    }],
  ],

  draw(g, s, _t, clock) {
    const f = Math.max(0, Math.min(FRAMES - 1, Math.floor(clock.frame + 1e-9)));
    const k = s.params.reach;
    const { ink, level } = s;
    const beats = f / 12;
    const cx = W / 2;
    const cy = H / 2;
    g.fillStyle = ink.ground;
    g.fillRect(0, 0, W, H);

    g.strokeStyle = ink.orbit;
    g.lineWidth = 1;
    for (const r of [118, 176, 232]) {
      g.beginPath();
      g.arc(cx, cy, r, 0, TAU);
      g.stroke();
    }

    // The spokes turn once in two bars and reach out on the middle voice.
    const spoke = level.mid[f];
    g.strokeStyle = mix(ink.orbit, ink.mid, 0.35 + 0.65 * spoke);
    g.lineWidth = 2 + 3 * spoke;
    g.lineCap = 'round';
    for (let i = 0; i < 24; i++) {
      const a = s.turn + beats / 8 * TAU + (i / 24) * TAU;
      const r0 = 134;
      const r1 = r0 + 12 + 62 * k * spoke * (i % 2 ? 0.62 : 1);
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      g.stroke();
    }

    // The dots turn the other way, once in four bars, and flare on the high voice.
    const spark = level.high[f];
    g.fillStyle = mix(ink.orbit, ink.high, 0.3 + 0.7 * spark);
    for (let i = 0; i < 40; i++) {
      const a = -s.turn - beats / 16 * TAU + (i / 40) * TAU;
      const r = 232 + (i % 4 === 0 ? 10 * k * spark : 0);
      g.beginPath();
      g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1.6 + (i % 4 === 0 ? 6 : 3) * k * spark, 0, TAU);
      g.fill();
    }

    // The disc swells on the low voice.
    const body = level.low[f];
    g.fillStyle = mix(ink.orbit, ink.low, 0.55 + 0.45 * body);
    g.beginPath();
    g.arc(cx, cy, 58 + 56 * k * body, 0, TAU);
    g.fill();
  },

  sound(ctx, s) {
    const R = rng(s.seed);
    const out = ctx.createGain();
    out.gain.value = 0.9;
    out.connect(ctx.destination);
    sumInto(ctx, s.notes.map((n) => voice(ctx, R, n.name, n.at, n.spec)), out);
  },
};
