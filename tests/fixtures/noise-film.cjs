// A film whose soundtrack holds the noise-like sounds a perceptual codec keeps
// by level rather than by waveform, one after another over tonal lines, for
// measuring how a soundtrack replays: hi-hats whose noise reaches past 16 kHz
// over a bass and a chord; a fricative-like burst inside a voiced line; noisy
// plucks, whose attack is filtered noise; a pop high-passed at 1.5 kHz and a
// hiss high-passed at 5 kHz over a pad; and a tone cut to silence in 30 ms.
// The picture only marks which part is sounding. Every noise comes from the seed.

'use strict';

const { rng } = require('../../core/rand.js');
const { sumInto } = require('../../core/sound.js');

const W = 320;
const H = 180;
// Each part's start in seconds; the film ends at 8.
const PARTS = [['hats', 0], ['fricative', 1.5], ['plucks', 3], ['pop and hiss', 4.5], ['cut', 6]];

module.exports = {
  name: 'noise-film',
  size: { w: W, h: H },
  seed: 1,
  time: { duration: 8, hz: 12 },
  build: [['noise', (s) => { s.R = rng(s.seed); }]],
  draw(g, s, t, clock) {
    g.fillStyle = '#15171c';
    g.fillRect(0, 0, W, H);
    const now = clock.seconds;
    PARTS.forEach(([, at], i) => {
      const end = i + 1 < PARTS.length ? PARTS[i + 1][1] : 7.5;
      const on = now >= at && now < end;
      g.fillStyle = on ? '#e8c26a' : '#3a3f4a';
      g.fillRect(16 + i * 60, on ? 40 : 80, 48, on ? 100 : 60);
    });
    g.fillStyle = '#e8e2d4';
    g.fillRect(16 + (now / 8) * (W - 36), 160, 4, 8);
  },
  sound(ctx, s, timeline) {
    const rate = ctx.sampleRate;
    const voices = [];
    // `seconds` of seeded white noise named `name`, one buffer per call.
    const noise = (name, seconds) => {
      const b = ctx.createBuffer(1, Math.round(seconds * rate), rate), x = b.getChannelData(0);
      for (let i = 0; i < x.length; i++) x[i] = 2 * s.R('noise', name, i) - 1;
      return b;
    };
    const filter = (type, hz, q = 0.707) => { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = hz; f.Q.value = q; return f; };
    const level = (points) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, 0);
      for (const [at, v, how = 'lin'] of points) {
        if (how === 'set') g.gain.setValueAtTime(v, at);
        else if (how === 'exp') g.gain.exponentialRampToValueAtTime(v, at);
        else g.gain.linearRampToValueAtTime(v, at);
      }
      return g;
    };
    // source -> nodes... -> a voice summed into the mix.
    const chain = (source, ...nodes) => { [source, ...nodes].reduce((a, b) => { a.connect(b); return b; }); voices.push(nodes[nodes.length - 1]); };
    const osc = (type, hz, from, to) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = hz; o.start(from); o.stop(to); return o; };
    const play = (buffer, at) => { const b = ctx.createBufferSource(); b.buffer = buffer; b.start(at); return b; };

    // Hi-hats: noise high-passed at 7 kHz, so flat to 24 kHz, a short decay,
    // eighth notes over a bass and a chord.
    chain(osc('sine', 55, 0, 1.5), level([[0.02, 0.5], [1.4, 0.5], [1.5, 0]]));
    for (const hz of [220, 277.2, 329.6]) chain(osc('triangle', hz, 0, 1.5), level([[0.02, 0.06], [1.4, 0.06], [1.5, 0]]));
    for (let k = 0; k < 12; k++) {
      const at = k * 0.125;
      chain(play(noise('hat ' + k, 0.1), at), filter('highpass', 7000), level([[at, 0, 'set'], [at + 0.002, 0.35], [at + 0.09, 0.001, 'exp']]));
    }
    // A voiced line, a sawtooth through a formant, after a breath and with a
    // fricative-like burst between two syllables: noise high-passed at 1 kHz
    // and at 4 kHz, each crossfading with the line.
    chain(play(noise('breath', 0.3), 1.3), filter('highpass', 1000), level([[1.3, 0, 'set'], [1.4, 0.03], [1.5, 0.03], [1.6, 0]]));
    chain(osc('sawtooth', 160, 1.5, 3), filter('lowpass', 2400), level([[1.5, 0, 'set'], [1.55, 0.25], [2.1, 0.25], [2.15, 0.02], [2.4, 0.02], [2.45, 0.25], [2.9, 0.25], [3, 0]]));
    chain(play(noise('fricative', 0.35), 2.1), filter('highpass', 4000), level([[2.1, 0, 'set'], [2.15, 0.08], [2.4, 0.08], [2.45, 0]]));
    // Noisy plucks: Karplus-Strong strings, each excited by a burst of noise.
    [[3.05, 196], [3.4, 247], [3.75, 294], [4.1, 392]].forEach(([at, hz], k) => {
      const n = Math.round(rate * 0.4), b = ctx.createBuffer(1, n, rate), y = b.getChannelData(0), d = Math.round(rate / hz);
      for (let i = 0; i < n; i++) y[i] = i < d ? 2 * s.R('noise', 'pluck ' + k, i) - 1 : 0.498 * (y[i - d] + y[i - d - 1 < 0 ? 0 : i - d - 1]);
      chain(play(b, at), level([[at, 0.3, 'set'], [at + 0.38, 0.3], [at + 0.4, 0]]));
    });
    // A pop high-passed at 1.5 kHz and a hiss high-passed at 5 kHz over a pad.
    chain(osc('sine', 330, 4.5, 6), level([[4.5, 0, 'set'], [4.55, 0.15], [5.9, 0.15], [6, 0]]));
    chain(play(noise('pop', 0.02), 4.9), filter('highpass', 1500), level([[4.9, 0.6, 'set'], [4.915, 0.001, 'exp']]));
    chain(play(noise('hiss', 0.6), 5.3), filter('highpass', 5000), level([[5.3, 0, 'set'], [5.35, 0.12], [5.75, 0.12], [5.85, 0]]));
    // A tone cut to silence in 30 ms.
    chain(osc('triangle', 262, 6, 7.2), level([[6, 0, 'set'], [6.05, 0.3], [7, 0.3, 'set'], [7.03, 0]]));

    const out = ctx.createGain();
    out.connect(ctx.destination);
    sumInto(ctx, voices, out);
  },
};
