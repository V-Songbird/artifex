// decoded-track.cjs's film with its track compressed: the same 0.3 s tone,
// mono at 44.1 kHz, encoded once as AAC-LC at 96 kbit/s in ADTS frames by
// installed Edge 154's AudioEncoder, and held here as base64. sound() decodes
// it with `ctx.decodeAudioData`, so the render hears whatever the browser's AAC
// decoder yields, delay and trimming included. The picture and the hits are
// decoded-track.cjs's, timed from the uncompressed track.
//
// This file ends in .js, not .cjs, so tests/film-fixtures.test.js does not
// render it in Node: its audio stand-in decodes only 16-bit PCM WAVE.

'use strict';

const { sumInto } = require('../../core/sound.js');

const W = 320;
const H = 180;
const SECONDS = 4;
const LENGTH = 0.3;
// The hits as [start s, playback rate, pan].
const HITS = [
  [0.25, 1, -0.5], [0.75, 1.5, 0.5], [1.25, 0.75, -0.3], [1.75, 1.25, 0.3],
  [2.25, 1, 0], [2.75, 2, -0.6], [3.25, 0.5, 0.6], [3.6, 1, 0],
];

// 13 ADTS frames, 3,703 bytes.
const TRACK = [
  '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',
  'vvrVtX7VSCgr7aCkihVEC2s/Omv/UkV+KkuPcQ==',
].join('');

module.exports = {
  name: 'compressed-track',
  size: { w: W, h: H },
  seed: 1,
  time: { duration: SECONDS, hz: 24 },
  draw(g, s, t, clock) {
    g.fillStyle = '#15171c';
    g.fillRect(0, 0, W, H);
    const now = clock.seconds;
    HITS.forEach(([at, rate], i) => {
      const through = (now - at) / (LENGTH / rate);
      const lit = through >= 0 && through < 1 ? 1 - through : 0;
      g.fillStyle = `rgba(222, 170, 120, ${0.15 + 0.85 * lit})`;
      g.fillRect(16 + i * 37, 50 + 20 * (1 - lit), 30, 60 + 20 * lit);
    });
    g.fillStyle = '#e8e2d4';
    g.fillRect(12 + (now / SECONDS) * (W - 28), 156, 6, 10);
  },
  async sound(ctx) {
    // A fresh buffer on every render, since decodeAudioData takes the one it gets.
    const track = await ctx.decodeAudioData(Uint8Array.from(atob(TRACK), (c) => c.charCodeAt(0)).buffer);
    const voices = HITS.map(([at, rate, pan]) => {
      const source = ctx.createBufferSource();
      source.buffer = track;
      source.playbackRate.value = rate;
      const level = ctx.createGain();
      level.gain.value = 0.5;
      const place = ctx.createStereoPanner();
      place.pan.value = pan;
      source.connect(level);
      level.connect(place);
      source.start(at);
      return place;
    });
    const out = ctx.createGain();
    out.connect(ctx.destination);
    sumInto(ctx, voices, out);
  },
};
