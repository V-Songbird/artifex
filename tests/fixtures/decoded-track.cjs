// A film whose sound() decodes a recorded track, for measuring whether export
// and replay hold when the soundtrack comes from `ctx.decodeAudioData`. The
// "recording" is a WAV this module writes when it loads: 0.3 s of a plucked
// tone, mono 16-bit at 44.1 kHz, so the 48 kHz render resamples it, and each
// hit plays it at its own rate, so the source resamples it again. The bytes are
// part of the piece, as a real track's would have to be, since a piece bundles
// only .js, .cjs and .json files. The picture lights a pad for each hit as it
// sounds and moves a playhead to the end.

'use strict';

const { sumInto } = require('../../core/sound.js');

const W = 320;
const H = 180;
const SECONDS = 4;
const RATE = 44100;
const LENGTH = 0.3;
// The hits as [start s, playback rate, pan].
const HITS = [
  [0.25, 1, -0.5], [0.75, 1.5, 0.5], [1.25, 0.75, -0.3], [1.75, 1.25, 0.3],
  [2.25, 1, 0], [2.75, 2, -0.6], [3.25, 0.5, 0.6], [3.6, 1, 0],
];

// The track's samples, as the WAV holds them: three partials of 330 Hz, each
// falling faster than the one below, after a 2 ms rise and before a 20 ms fade.
const PCM = Float32Array.from({ length: Math.round(LENGTH * RATE) }, (_, i) => {
  const t = i / RATE;
  const v = Math.min(1, t / 0.002, (LENGTH - t) / 0.02) * [[1, 0.6, 9], [2.02, 0.25, 14], [3.1, 0.12, 22]]
    .reduce((sum, [ratio, level, fall]) => sum + level * Math.exp(-fall * t) * Math.sin(2 * Math.PI * 330 * ratio * t), 0);
  return Math.round(v * 32767) / 32768;
});

// The track as a RIFF WAVE file: a 44-byte header, then little-endian PCM.
const BYTES = (() => {
  const bytes = new Uint8Array(44 + 2 * PCM.length);
  const view = new DataView(bytes.buffer);
  const text = (at, s) => { for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i); };
  text(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true);
  view.setUint32(28, 2 * RATE, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, 2 * PCM.length, true);
  PCM.forEach((v, i) => view.setInt16(44 + 2 * i, Math.round(v * 32768), true));
  return bytes;
})();

module.exports = {
  name: 'decoded-track',
  size: { w: W, h: H },
  seed: 1,
  time: { duration: SECONDS, hz: 24 },
  draw(g, s, t, clock) {
    g.fillStyle = '#15171c';
    g.fillRect(0, 0, W, H);
    const now = clock.seconds;
    HITS.forEach(([at, rate], i) => {
      // How far through its play this hit is, from 0 as it starts to 1 as it ends.
      const through = (now - at) / (LENGTH / rate);
      const lit = through >= 0 && through < 1 ? 1 - through : 0;
      g.fillStyle = `rgba(120, 196, 222, ${0.15 + 0.85 * lit})`;
      g.fillRect(16 + i * 37, 50 + 20 * (1 - lit), 30, 60 + 20 * lit);
    });
    g.fillStyle = '#e8e2d4';
    g.fillRect(12 + (now / SECONDS) * (W - 28), 156, 6, 10);
  },
  async sound(ctx) {
    // decodeAudioData takes its buffer away, so every render decodes a copy.
    const track = await ctx.decodeAudioData(BYTES.slice().buffer);
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
