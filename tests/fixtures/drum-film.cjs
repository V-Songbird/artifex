// A film whose soundtrack is drum-heavy, for hearing and measuring how the
// export's limiter levels percussion: four bars at 120 BPM of a kick with a
// click on its attack, a snare, closed hi-hats and a quiet bass line. The hits
// stand far above the bass, so one gain alone would stop the soundtrack well
// short of -14 LUFS at the codec ceiling. The picture lights a pad for each
// voice as it sounds and moves a playhead to the end. Every noise comes from
// the seed.

'use strict';

const { rng } = require('../../core/rand.js');
const { sumInto } = require('../../core/sound.js');

const W = 320;
const H = 180;
const BEAT = 0.5;
const BARS = 4;
// Each voice's hits, in beats from the start: a kick on 1 and 3 with a pickup
// before the fourth bar's 3, a snare on 2 and 4, and a hi-hat on every eighth.
const HITS = {
  kick: [].concat(...Array.from({ length: BARS }, (_, b) => [4 * b, 4 * b + 2, ...(b === 2 ? [4 * b + 3.5] : [])])),
  snare: [].concat(...Array.from({ length: BARS }, (_, b) => [4 * b + 1, 4 * b + 3])),
  hat: Array.from({ length: 8 * BARS }, (_, k) => k / 2),
};
// The bass line, one note a beat, in Hz.
const BASS = [55, 55, 65.41, 55, 73.42, 73.42, 65.41, 61.74];

module.exports = {
  name: 'drum-film',
  size: { w: W, h: H },
  seed: 1,
  time: { duration: BARS * 4 * BEAT, hz: 24 },
  build: [['noise', (s) => { s.R = rng(s.seed); }]],
  draw(g, s, t, clock) {
    g.fillStyle = '#14161b';
    g.fillRect(0, 0, W, H);
    const now = clock.seconds;
    Object.entries(HITS).forEach(([, beats], i) => {
      // How recently this voice sounded, fading over a beat.
      const since = Math.min(...beats.map((b) => now - b * BEAT).filter((d) => d >= 0), BEAT);
      const lit = 1 - since / BEAT;
      g.fillStyle = `rgba(232, 194, 106, ${0.15 + 0.85 * lit})`;
      g.fillRect(28 + i * 96, 40 + 30 * (1 - lit), 72, 70 + 30 * lit);
    });
    g.fillStyle = '#e8e2d4';
    g.fillRect(12 + (now / (BARS * 4 * BEAT)) * (W - 28), 160, 4, 8);
  },
  sound(ctx, s) {
    const rate = ctx.sampleRate;
    const voices = [];
    // `seconds` of seeded white noise named `name`, one buffer per call.
    const noise = (name, seconds) => {
      const b = ctx.createBuffer(1, Math.round(seconds * rate), rate), x = b.getChannelData(0);
      for (let i = 0; i < x.length; i++) x[i] = 2 * s.R('noise', name, i) - 1;
      return b;
    };
    const filter = (type, hz, q = 0.707) => { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = hz; f.Q.value = q; return f; };
    // A gain that rises to `peak` in 2 ms at `at`, falls to a thousandth of it
    // over `decay` seconds, then to silence in 10 ms.
    const hit = (at, peak, decay) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, 0);
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(peak, at + 0.002);
      g.gain.exponentialRampToValueAtTime(peak / 1000, at + decay);
      g.gain.linearRampToValueAtTime(0, at + decay + 0.01);
      return g;
    };
    const chain = (source, ...nodes) => { [source, ...nodes].reduce((a, b) => { a.connect(b); return b; }); voices.push(nodes[nodes.length - 1]); };
    const play = (buffer, at) => { const b = ctx.createBufferSource(); b.buffer = buffer; b.start(at); return b; };

    HITS.kick.forEach((beat, k) => {
      const at = beat * BEAT;
      // A sine falling from 160 to 45 Hz, and a click of noise on its attack.
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(160, at);
      o.frequency.exponentialRampToValueAtTime(45, at + 0.09);
      o.start(at);
      o.stop(at + 0.5);
      chain(o, hit(at, 0.95, 0.4));
      chain(play(noise('kick ' + k, 0.03), at), filter('highpass', 2000), hit(at, 0.5, 0.012));
    });
    HITS.snare.forEach((beat, k) => {
      const at = beat * BEAT;
      // Noise around 2 kHz over a triangle body at 190 Hz.
      chain(play(noise('snare ' + k, 0.3), at), filter('bandpass', 2000, 0.8), hit(at, 0.9, 0.18));
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = 190;
      o.start(at);
      o.stop(at + 0.2);
      chain(o, hit(at, 0.4, 0.09));
    });
    HITS.hat.forEach((beat, k) => {
      const at = beat * BEAT;
      chain(play(noise('hat ' + k, 0.08), at), filter('highpass', 7000), hit(at, k % 2 ? 0.12 : 0.2, 0.05));
    });
    // The bass: a triangle a beat per note, faded in and out over 80 ms.
    const bass = ctx.createOscillator();
    bass.type = 'triangle';
    const level = ctx.createGain();
    level.gain.setValueAtTime(0, 0);
    level.gain.linearRampToValueAtTime(0.1, 0.08);
    for (let k = 0; k < BARS * 4; k++) bass.frequency.setValueAtTime(BASS[k % BASS.length], k * BEAT);
    level.gain.setValueAtTime(0.1, BARS * 4 * BEAT - 0.08);
    level.gain.linearRampToValueAtTime(0, BARS * 4 * BEAT);
    bass.start(0);
    bass.stop(BARS * 4 * BEAT);
    chain(bass, level);

    const out = ctx.createGain();
    out.connect(ctx.destination);
    sumInto(ctx, voices, out);
  },
};
