// A film with a beat sheet, for measuring a time strip's per-beat change and
// level: four beats of 1.5 s, quiet, rising, peak and falling, kept in
// s.cues.beats as the film scaffold keeps them. A low hum plays under the whole
// film, a sustained bed whose only event is its fade-in at the start; soft
// ticks rise over it, loud hits of noise and a falling tone mark the peak, and
// the last beat holds the hum alone, audible with no event. The picture is a
// row of squares: still over the bed, swaying with the ticks, jumping and
// flashing on each hit, then settling. The soundtrack is one buffer computed
// here, every noise from the seed.

'use strict';

const { rng } = require('../../core/rand.js');

const W = 320;
const H = 180;
const HZ = 12;
const LENGTH = 6;
// Each beat: its first frame and its intensity.
const BEATS = [[0, 0.2], [18, 0.5], [36, 1], [54, 0.3]];
// Each sound: [seconds, level, decay in seconds, tone in Hz, noise share].
const TICKS = [[1.75, 0.03, 0.15, 880, 0], [2.25, 0.04, 0.15, 880, 0], [2.75, 0.05, 0.15, 880, 0]];
// The last hit's flash fades out before the peak beat ends, so the drop from
// it lands between a cell in the peak and the next cell, a change that counts
// in the more intense of the two cells' beats, the peak.
const HITS = [[3, 0.6, 0.3, 220, 0.5], [3.3, 0.6, 0.3, 220, 0.5], [3.6, 0.7, 0.3, 220, 0.5], [3.9, 0.6, 0.3, 220, 0.5]];

// How far `now` is past the latest of `sounds`, capped at `cap` seconds.
const since = (sounds, now, cap) => Math.min(cap, ...sounds.map(([at]) => now - at).filter((d) => d >= 0));

module.exports = {
  name: 'peak-film',
  size: { w: W, h: H },
  seed: 1,
  time: { duration: LENGTH, hz: HZ },
  build: [['plan', (s) => {
    s.R = rng(s.seed);
    s.cues = { beats: BEATS.map(([frame, intensity]) => ({ frame, intensity })), peak: 36 };
  }]],
  draw(g, s, t, clock) {
    const now = clock.seconds;
    // The peak's last hit, fading over a quarter second.
    const hit = 1 - since(HITS, now, 0.25) / 0.25;
    g.fillStyle = hit > 0 ? `rgb(${21 + 60 * hit}, ${23 + 50 * hit}, ${28 + 30 * hit})` : '#15171c';
    g.fillRect(0, 0, W, H);
    // Sway grows over the rising beat and dies away over the falling one.
    const sway = now < 1.5 ? 0 : now < 3 ? 8 * (now - 1.5) / 1.5 : now < 4.5 ? 8 : 8 * Math.max(0, 1 - (now - 4.5) / 1.2);
    for (let i = 0; i < 5; i++) {
      const size = 30 + 40 * hit * (i % 2 ? 1 : 0.6);
      const x = 40 + i * 60 + sway * Math.sin(2 * Math.PI * (now * 0.8 + i / 5)) + (hit > 0 ? 18 * hit * (i % 2 ? 1 : -1) : 0);
      const y = H / 2 + (hit > 0 ? 24 * hit * (i % 2 ? -1 : 1) : 0);
      g.fillStyle = hit > 0.5 ? '#f4e6c4' : '#c8a75e';
      g.fillRect(x - size / 2, y - size / 2, size, size);
    }
  },
  sound(ctx, s) {
    const rate = ctx.sampleRate, n = Math.round(LENGTH * rate);
    const buffer = ctx.createBuffer(2, n, rate), left = buffer.getChannelData(0), right = buffer.getChannelData(1);
    // The bed: a hum at 110 and 165 Hz, faded in over 50 ms and out over 80 ms.
    for (let i = 0; i < n; i++) {
      const tt = i / rate, fade = Math.min(1, tt / 0.05, (LENGTH - tt) / 0.08);
      left[i] = right[i] = fade * (0.02 * Math.sin(2 * Math.PI * 110 * tt) + 0.01 * Math.sin(2 * Math.PI * 165 * tt));
    }
    // Each tick and hit: a 2 ms rise to `level`, then an exponential fall to
    // -60 dB over `decay`, of a tone falling as it decays and seeded noise
    // mixed by `share`.
    [...TICKS, ...HITS].forEach(([at, level, decay, hz, share], k) => {
      const from = Math.round(at * rate), to = Math.min(n, from + Math.round(decay * rate));
      for (let i = from; i < to; i++) {
        const d = (i - from) / rate, env = level * Math.min(1, d / 0.002) * Math.exp(-6.9 * d / decay);
        const x = env * ((1 - share) * Math.sin(2 * Math.PI * hz * d * (1 - d)) + share * (2 * s.R('noise', 'sound ' + k, i - from) - 1));
        left[i] += x;
        right[i] += x;
      }
    });
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.start(0);
  },
};
