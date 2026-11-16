// A film whose soundtrack is core/sound.js ambience grains, for measuring how
// a soundtrack of short sine events replays: five places one after another,
// each an ambience of seeded grains at far more than its bed's level. Plain
// 20 ms grains over a faint bed; 12 ms grains chirping an octave up over a
// fainter one, their rate building and thinning; then 4, 20 and 50 ms grains
// with no bed at all, where AAC spreads a grain's coding noise into the quiet
// block after it. The picture marks which place is sounding. Every noise and
// grain comes from the seed.

'use strict';

const { rng } = require('../../core/rand.js');
const { sumInto, ambience } = require('../../core/sound.js');

const W = 320;
const H = 180;
// Each place: its start in seconds and its ambience.
const PLACES = [
  [0, { length: 2.5, colour: 1800, band: 1.5, level: 0.002, fade: 0.2, grains: { rate: 30, length: 0.02, level: 0.2 } }],
  [2.5, { length: 2.5, colour: 2600, band: 1.5, level: 0.001, fade: 0.2, grains: { rate: [[0, 10], [1.2, 80], [2.5, 20]], length: 0.012, chirp: 1, level: 0.2 } }],
  [5, { length: 2.5, colour: 3200, band: 2, level: 0, fade: 0.2, grains: { rate: 25, length: 0.004, level: 0.5 } }],
  [7.5, { length: 2.5, colour: 1800, band: 1.5, level: 0, fade: 0.2, grains: { rate: 30, length: 0.02, level: 0.3 } }],
  [10, { length: 2.5, colour: 2000, band: 2, level: 0, fade: 0.2, grains: { rate: 15, length: 0.05, level: 0.3 } }],
];
const END = 12.5;

module.exports = {
  name: 'grain-film',
  size: { w: W, h: H },
  seed: 1,
  time: { duration: END, hz: 12 },
  build: [['noise', (s) => { s.R = rng(s.seed); }]],
  draw(g, s, t, clock) {
    g.fillStyle = '#15171c';
    g.fillRect(0, 0, W, H);
    const now = clock.seconds;
    PLACES.forEach(([at, { length }], i) => {
      const on = now >= at && now < at + length;
      g.fillStyle = on ? '#e8c26a' : '#3a3f4a';
      g.fillRect(20 + i * 60, on ? 40 : 80, 40, on ? 100 : 60);
    });
    g.fillStyle = '#e8e2d4';
    g.fillRect(12 + (now / END) * (W - 28), 165, 4, 8);
  },
  sound(ctx, s) {
    const out = ctx.createGain();
    out.connect(ctx.destination);
    sumInto(ctx, PLACES.map(([at, spec], i) => ambience(ctx, s.R, 'place ' + i, at, spec)), out);
  },
};
