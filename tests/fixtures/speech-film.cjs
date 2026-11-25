// A film whose soundtrack has speech-like peaks, for measuring how the export's
// limiter levels a voice: phrases of syllables, each a sawtooth voice through
// two formants, some opened by a plosive's short loud burst of noise, over a quiet bed
// of low room noise and a hum. The bursts stand far above the bed, so one gain
// alone would stop the soundtrack short of -14 LUFS at the codec ceiling. It is
// synthesized, not recorded. The picture draws a bar for each syllable as it
// sounds and moves a playhead to the end. Every noise comes from the seed.

'use strict';

const { rng } = require('../../core/rand.js');
const { sumInto } = require('../../core/sound.js');

const W = 320;
const H = 180;
const SECONDS = 8;
// Syllables as [start s, length s, pitch Hz, first formant Hz, second formant Hz, plosive].
const SYLLABLES = [
  [0.4, 0.18, 150, 700, 1200, true], [0.62, 0.14, 160, 400, 2000, false], [0.8, 0.22, 140, 600, 1000, true],
  [1.1, 0.16, 135, 300, 2300, false], [1.3, 0.3, 125, 500, 1500, true],
  [2.2, 0.15, 170, 750, 1300, true], [2.4, 0.2, 165, 450, 1900, false], [2.65, 0.14, 150, 650, 1100, true],
  [2.85, 0.18, 145, 350, 2200, false], [3.1, 0.35, 120, 550, 900, true],
  [4.1, 0.2, 155, 700, 1250, true], [4.35, 0.16, 150, 420, 2100, true], [4.55, 0.2, 140, 600, 1000, false],
  [4.8, 0.15, 150, 320, 2400, true], [5.0, 0.4, 118, 520, 1400, false],
  [6.0, 0.18, 165, 720, 1200, true], [6.22, 0.16, 155, 380, 2000, false], [6.42, 0.2, 145, 640, 1050, true],
  [6.66, 0.22, 138, 480, 1700, true], [6.95, 0.45, 115, 560, 950, false],
];

module.exports = {
  name: 'speech-film',
  size: { w: W, h: H },
  seed: 1,
  time: { duration: SECONDS, hz: 24 },
  build: [['noise', (s) => { s.R = rng(s.seed); }]],
  draw(g, s, t, clock) {
    g.fillStyle = '#16151a';
    g.fillRect(0, 0, W, H);
    const now = clock.seconds;
    SYLLABLES.forEach(([at, length, hz], i) => {
      const on = now >= at && now < at + length;
      const x = 12 + (at / SECONDS) * (W - 24);
      const h = on ? 30 + ((hz - 110) / 60) * 60 : 12;
      g.fillStyle = on ? '#8fc7c0' : now >= at ? '#3e5552' : '#2a2c33';
      g.fillRect(x, 90 - h / 2, Math.max(3, (length / SECONDS) * (W - 24) - 2), h);
    });
    g.fillStyle = '#e8e2d4';
    g.fillRect(12 + (now / SECONDS) * (W - 28), 160, 4, 8);
  },
  sound(ctx, s) {
    const rate = ctx.sampleRate;
    const voices = [];
    const noise = (name, seconds) => {
      const b = ctx.createBuffer(1, Math.round(seconds * rate), rate), x = b.getChannelData(0);
      for (let i = 0; i < x.length; i++) x[i] = 2 * s.R('noise', name, i) - 1;
      return b;
    };
    const filter = (type, hz, q = 0.707) => { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = hz; f.Q.value = q; return f; };
    const chain = (source, ...nodes) => { [source, ...nodes].reduce((a, b) => { a.connect(b); return b; }); voices.push(nodes[nodes.length - 1]); };
    const play = (buffer, at) => { const b = ctx.createBufferSource(); b.buffer = buffer; b.start(at); return b; };
    // A gain through [time, value] points, linear between them, silent before and after.
    const level = (points) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, 0);
      for (const [at, v] of points) g.gain.linearRampToValueAtTime(v, at);
      return g;
    };

    // The bed: room noise low-passed at 400 Hz and a 60 Hz hum, faded in and out.
    chain(play(noise('room', SECONDS), 0), filter('lowpass', 400), level([[0.3, 0.05], [SECONDS - 0.3, 0.05], [SECONDS, 0]]));
    const hum = ctx.createOscillator();
    hum.frequency.value = 60;
    hum.start(0);
    hum.stop(SECONDS);
    chain(hum, level([[0.3, 0.012], [SECONDS - 0.3, 0.012], [SECONDS, 0]]));

    SYLLABLES.forEach(([at, length, hz, f1, f2, plosive], k) => {
      // A voice gliding down a semitone, through two formants, rising in 15 ms
      // and falling over the last third of the syllable.
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(hz, at);
      o.frequency.linearRampToValueAtTime(hz * 0.944, at + length);
      o.start(at);
      o.stop(at + length + 0.02);
      const shape = [[at, 0], [at + 0.015, 0.22], [at + length * 0.66, 0.18], [at + length, 0]];
      chain(o, filter('bandpass', f1, 5), level(shape));
      const o2 = ctx.createOscillator();
      o2.type = 'sawtooth';
      o2.frequency.setValueAtTime(hz, at);
      o2.frequency.linearRampToValueAtTime(hz * 0.944, at + length);
      o2.start(at);
      o2.stop(at + length + 0.02);
      chain(o2, filter('bandpass', f2, 8), level(shape.map(([t, v]) => [t, v * 0.6])));
      // A plosive: 12 ms of noise around 2 kHz, loud and short, just before the voice.
      if (plosive) {
        const from = at - 0.012;
        chain(play(noise('plosive ' + k, 0.03), from), filter('bandpass', 2000, 0.7), level([[from, 0], [from + 0.001, 0.5], [from + 0.006, 0.15], [from + 0.02, 0]]));
      }
    });

    const out = ctx.createGain();
    out.connect(ctx.destination);
    sumInto(ctx, voices, out);
  },
};
