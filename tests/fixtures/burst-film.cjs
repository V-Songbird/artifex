// A film whose soundtrack is sparse contacts of noise and nothing else, for
// measuring how a soundtrack of short transients replays: core/sound.js
// voices with only their transient, bursts of seeded noise 2 to 30 ms long
// in bands from 600 Hz to 9 kHz, near and far, soft and hard, a few a second
// over silence, then over a quiet bed. The picture lights a dot where each
// contact sounds. Every noise comes from the seed.

'use strict';

const { rng } = require('../../core/rand.js');
const { sumInto, voice } = require('../../core/sound.js');

const W = 320;
const H = 180;
const LENGTH = 6;

// The contacts, from the seed: [seconds, colour, length, velocity, pan, distance].
function contacts(R) {
  const out = [];
  for (let at = 0.1, k = 0; at < LENGTH - 0.3; k++) {
    out.push([at, 600 * 15 ** R('contact', 'colour', k), 0.002 + 0.028 * R('contact', 'length', k) ** 2,
      0.2 + 0.8 * R('contact', 'velocity', k), 1.6 * (R('contact', 'pan', k) - 0.5), 0.8 * R('contact', 'far', k) ** 2]);
    at += 0.08 + 0.4 * R('contact', 'gap', k);
  }
  return out;
}

module.exports = {
  name: 'burst-film',
  size: { w: W, h: H },
  seed: 1,
  time: { duration: LENGTH, hz: 12 },
  build: [['contacts', (s) => { s.R = rng(s.seed); s.contacts = contacts(s.R); }]],
  draw(g, s, t, clock) {
    g.fillStyle = '#15171c';
    g.fillRect(0, 0, W, H);
    const now = clock.seconds;
    for (const [at, colour, , velocity, pan, distance] of s.contacts) {
      const since = now - at;
      if (since < 0 || since > 0.25) continue;
      g.fillStyle = `rgba(232, 194, 106, ${(1 - since / 0.25) * (1 - distance / 2)})`;
      g.fillRect(W / 2 + pan * 140 - 4, H - 20 - (Math.log2(colour / 600) / Math.log2(15)) * (H - 40) - 4, 8 + 8 * velocity, 8 + 8 * velocity);
    }
    g.fillStyle = '#e8e2d4';
    g.fillRect(12 + (now / LENGTH) * (W - 28), 170, 4, 6);
  },
  sound(ctx, s) {
    const voices = s.contacts.map(([at, colour, length, velocity, pan, distance], k) => voice(ctx, s.R, 'contact ' + k, at, {
      pitch: colour, partials: [[1, 0]], strike: { level: 1, colour, length }, velocity, pan, distance, level: 0.9, vary: 0.5,
    }));
    // A quiet bed under the second half: the contacts over a noise floor.
    const n = Math.round((LENGTH / 2) * ctx.sampleRate);
    const bed = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const x = bed.getChannelData(c);
      for (let i = 0; i < n; i++) x[i] = 0.002 * (2 * s.R('bed', c ? 'right' : 'left', i) - 1) * Math.min(1, i / 4800, (n - 1 - i) / 4800);
    }
    const src = ctx.createBufferSource();
    src.buffer = bed;
    src.start(LENGTH / 2);
    voices.push(src);
    const out = ctx.createGain();
    out.connect(ctx.destination);
    sumInto(ctx, voices, out);
  },
};
