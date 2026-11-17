// The product page's interface sounds, one soundtrack the page renders once,
// the first time the visitor turns Listen on, and plays a slice of for each
// event; `sound.cues` says where each slice starts and how long it rings, as
// `sound.ambience` rides on a shot's sound. Quiet, short and dry: a tap of a
// nib, never a tone.

'use strict';

const Sd = require('./sounds.js');
const { rng } = require('../../core/rand.js');

// [start, length] in seconds, for each event the page sounds.
const CUES = {
  tap: [0.05, 0.25],        // a button pressed
  on: [0.4, 0.3],           // a toggle turned on: low, then high
  off: [0.8, 0.3],          // a toggle turned off: high, then low
  roll: [1.2, 0.4],         // a new seed: a quick run of nibs, rising
  slide: [1.7, 0.2],        // a slider moved one step
};

function sound(ctx, s) {
  const R = rng(s.seed), end = ctx.length / ctx.sampleRate, pairs = [];
  const nib = (at, colour, level, i) => pairs.push([at, { ...Sd.snap(colour, 0.006 + 0.004 * R('nib', 'length', i), 0.2), velocity: level, vary: 0.4, pan: 0, distance: 0.15 }]);
  nib(CUES.tap[0], 1900, 0.55, 0);
  nib(CUES.on[0], 700, 0.5, 1); nib(CUES.on[0] + 0.07, 1300, 0.45, 2);
  nib(CUES.off[0], 1300, 0.45, 3); nib(CUES.off[0] + 0.07, 700, 0.4, 4);
  for (let j = 0; j < 5; j++) nib(CUES.roll[0] + j * 0.045, 900 + 380 * j, 0.25 + 0.06 * j, 5 + j);
  nib(CUES.slide[0], 2800, 0.25, 10);
  Sd.mix(ctx, R, Sd.place(ctx, R, 'ui', pairs, end), { level: 4 });
}
sound.cues = CUES;

module.exports = {
  name: 'site-ui',
  size: { w: 16, h: 16 },
  seed: 1,
  time: { duration: 2, hz: 30 },
  draw() {},
  sound,
};
