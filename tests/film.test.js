'use strict';

// The frame-exact film: MP4 written, read back and judged against the grid the
// piece declares. Encoders are stand-ins here; native encoding, decoding and
// playback are the browser check's business.

const test = require('node:test');
const assert = require('node:assert/strict');

const { validate, solve } = require('../core/piece.js');
const { playheads } = require('../core/render.js');
const { exportFilm, muxMp4, readMp4, filmCheck, avcCodecs, aacConfig } = require('../core/film.js');
const { nullSurface } = require('../tools/bench.js');
const { fakeAudio, fakeCodecs, opusHead } = require('./fake-media.js');

const SPACE = { primaries: 'bt709', transfer: 'iec61966-2-1', matrix: 'bt709', fullRange: true };
const AVCC = Uint8Array.of(1, 0x64, 0, 0x1f, 0xff, 0xe1, 0, 0);

/** `n` Opus packets of one 20 ms fullband CELT frame each. */
const celt = (n) => Array.from({ length: n }, (_, i) => Uint8Array.of(0xfc, i & 255));

function film({ frames = 48, delta = 1000, timescale = 24000, keys = [0, 24], colour = SPACE, audio = 94, opus = null, width = 64, height = 48 } = {}) {
  return muxMp4({
    video: {
      width, height, timescale, delta, avcC: AVCC, colour,
      samples: Array.from({ length: frames }, (_, i) => ({ data: Uint8Array.of(i, 1, 2, 3), key: keys.includes(i) })),
    },
    audio: opus ? { codec: 'opus', head: opus.head || opusHead(), samples: opus.packets } : audio ? {
      sampleRate: 48000, channels: 2, asc: aacConfig(48000, 2), bitrate: 128000,
      samples: Array.from({ length: audio }, (_, i) => Uint8Array.of(0x21, i & 255)),
    } : null,
  });
}

/** The bytes of the first box of `type`, from its size field to its end. */
function boxBytes(bytes, type) {
  const at = bytes.findIndex((_, i) => String.fromCharCode(...bytes.subarray(i, i + 4)) === type) - 4;
  return [...bytes.subarray(at, at + new DataView(bytes.buffer, bytes.byteOffset).getUint32(at))];
}

const GRID = { frames: 48, hz: 24, width: 64, height: 48, sound: true };

function env(options = {}) {
  const codecs = fakeCodecs(options);
  let clock = 0;
  return {
    codecs,
    env: {
      VideoEncoder: codecs.VideoEncoder, VideoFrame: codecs.VideoFrame,
      AudioEncoder: codecs.AudioEncoder, AudioData: codecs.AudioData,
      OfflineAudioContext: fakeAudio().Context,
      createCanvas: (w, h) => ({ width: w, height: h, getContext: () => nullSurface({ w, h }) }),
      // Every reading moves the clock on, as if each frame took 250 ms to draw.
      now: () => (clock += options.step === undefined ? 250 : options.step),
      pause: async () => {},
    },
  };
}

function piece(extra = {}) {
  const p = validate({
    name: 'film-fixture', size: { w: 64, h: 48 }, seed: 3,
    time: { duration: 2, hz: 24 },
    draw(g, s, t) { g.fillRect(0, 0, 64 * t + 1, 48); },
    ...extra,
  });
  return { p, solved: solve(p, p.seed) };
}

function grab(fn) {
  try { fn(); } catch (e) { return e; }
  throw new Error('expected a throw, and none happened');
}

test('a film is written and read back: every sample, its duration, its keyframes and its colour tag', () => {
  const bytes = film();
  const file = readMp4(bytes);
  assert.equal(file.brand, 'isom');
  const [video, audio] = file.tracks;
  assert.equal(video.codec, 'avc1');
  assert.equal(video.samples, 48);
  assert.deepEqual(video.deltas, [[48, 1000]]);
  assert.deepEqual(video.keys, [1, 25]);
  assert.deepEqual(video.colour, { primaries: 1, transfer: 13, matrix: 1, fullRange: true });
  assert.equal(video.inside, true, 'every sample lies inside the media data');
  assert.equal(audio.codec, 'mp4a');
  assert.equal(audio.duration, 94 * 1024);
  assert.equal(audio.sampleRate, 48000);

  // The offsets point at the bytes that were written, not only somewhere legal.
  const mdat = bytes.findIndex((_, i) => bytes[i] === 0x6d && bytes[i + 1] === 0x64 && bytes[i + 2] === 0x61 && bytes[i + 3] === 0x74);
  assert.deepEqual([...bytes.subarray(mdat + 4, mdat + 8)], [0, 1, 2, 3], 'the first frame starts the media data');

  const report = filmCheck(GRID, file);
  assert.equal(report.frames, 48);
  assert.equal(report.seconds, 2);
  assert.ok(Math.abs(report.sound.seconds - 2) < 1024 / 48000 * 2);
});

test('the film check refuses a file that disagrees with its frame grid, and says how', () => {
  assert.match(grab(() => filmCheck(GRID, readMp4(film({ frames: 47 })))).message, /holds 47 of 48 frames/);
  assert.match(grab(() => filmCheck(GRID, readMp4(film({ delta: 1100 })))).message, /a frame lasts 1100 ticks/);
  assert.match(grab(() => filmCheck(GRID, readMp4(film({ width: 66 })))).message, /66 x 48/);
  assert.match(grab(() => filmCheck(GRID, readMp4(film({ keys: [5] })))).message, /first frame is not a keyframe/);
  assert.match(grab(() => filmCheck(GRID, readMp4(film({ colour: null })))).message, /no colour tag/);
  assert.match(grab(() => filmCheck(GRID, readMp4(film({ audio: 0 })))).message, /no playable soundtrack/);
  assert.match(grab(() => filmCheck(GRID, readMp4(film({ audio: 80 })))).message, /soundtrack lasts 1\.707 s against a 2\.000 s film/);
  assert.match(grab(() => filmCheck({ ...GRID, sound: false }, readMp4(film()))).message, /declares no sound/);

  // A chunk offset past the end of the media data is a broken file, however
  // plausible its tables look.
  const bytes = film();
  const stco = bytes.findIndex((_, i) => bytes[i] === 0x73 && bytes[i + 1] === 0x74 && bytes[i + 2] === 0x63 && bytes[i + 3] === 0x6f);
  new DataView(bytes.buffer).setUint32(stco + 12, bytes.length + 10);
  assert.match(grab(() => filmCheck(GRID, readMp4(bytes))).message, /outside the media data/);
});

test('the dOps box is the OpusHead in big-endian, with its pre-skip and channel mapping kept', () => {
  // Every multi-byte field reads differently in the other byte order: 312
  // samples of pre-skip, a 44.1 kHz source and -3.5 dB of output gain.
  const stereo = film({ opus: { head: opusHead({ preSkip: 312, rate: 44100, gain: -896 }), packets: celt(101) } });
  assert.deepEqual(boxBytes(stereo, 'dOps'), [0, 0, 0, 19, 0x64, 0x4f, 0x70, 0x73, 0, 2, 0x01, 0x38, 0, 0, 0xac, 0x44, 0xfc, 0x80, 0]);
  const track = readMp4(stereo).tracks[1];
  assert.equal(track.codec, 'Opus');
  assert.deepEqual([track.channels, track.sampleRate, track.timescale], [2, 48000, 48000], 'an Opus track runs at 48 kHz, whatever rate went in');
  assert.deepEqual(track.opus, { version: 0, channels: 2, preSkip: 312, inputSampleRate: 44100, outputGain: -896, mappingFamily: 0 });

  // 5.1 under mapping family 1: the stream counts and channel mapping pass through unchanged.
  const surround = film({ opus: { head: opusHead({ channels: 6, family: 1, table: [4, 2, 0, 4, 1, 2, 3, 5] }), packets: celt(101) } });
  assert.deepEqual(boxBytes(surround, 'dOps').slice(8), [0, 6, 0x01, 0x38, 0, 0, 0xbb, 0x80, 0, 0, 1, 4, 2, 0, 4, 1, 2, 3, 5]);
  assert.equal(readMp4(surround).tracks[1].channels, 6);

  assert.throws(() => film({ opus: { head: Uint8Array.of(1, 2, 3), packets: celt(1) } }), /something other than an OpusHead/);
  const cut = opusHead({ channels: 6, family: 1, table: [4, 2] });
  assert.throws(() => film({ opus: { head: cut, packets: celt(1) } }), /something other than an OpusHead/);
});

test('an Opus packet lasts what its TOC byte says, in 48 kHz samples', () => {
  // 20 and 10 ms CELT, 20 and 60 ms SILK, 20 ms hybrid, 2.5 ms CELT, then two
  // equal frames, two unequal frames and a counted three.
  const packets = [[0xfc], [0xf4], [0x08], [0x18], [0x68], [0x80], [0xfd, 0], [0xfe, 0], [0xff, 3]].map((p) => Uint8Array.from(p));
  const track = readMp4(film({ opus: { packets } })).tracks[1];
  assert.deepEqual(track.deltas, [[1, 960], [1, 480], [1, 960], [1, 2880], [1, 960], [1, 120], [2, 1920], [1, 2880]]);
  assert.equal(track.duration, 13080);
});

test('the film check hears an Opus soundtrack without its pre-skip', () => {
  // 101 packets of 20 ms less 312 samples of pre-skip: what Edge's encoder gives a two-second film.
  const report = filmCheck(GRID, readMp4(film({ opus: { packets: celt(101) } })));
  assert.deepEqual(report.sound, { codec: 'Opus', seconds: (101 * 960 - 312) / 48000, channels: 2, sampleRate: 48000 });
  // Two seconds of packets, but 80 ms of them are pre-skip that no decoder plays.
  const late = film({ opus: { head: opusHead({ preSkip: 3840 }), packets: celt(100) } });
  assert.match(grab(() => filmCheck(GRID, readMp4(late))).message, /soundtrack lasts 1\.920 s against a 2\.000 s film/);
  // Without its dOps no decoder can open the track.
  const bytes = film({ opus: { packets: celt(101) } });
  bytes[bytes.findIndex((_, i) => String.fromCharCode(...bytes.subarray(i, i + 4)) === 'dOps') + 3] = 0x78;
  assert.match(grab(() => filmCheck(GRID, readMp4(bytes))).message, /no playable soundtrack/);
});

test('every drawn frame is encoded once, at its own timestamp, however slowly it draws', async () => {
  const { p, solved } = piece();
  const { env: e, codecs } = env({ step: 250 });
  const { bytes, report } = await exportFilm(p, solved, e);
  const n = playheads(p).length;
  assert.equal(codecs.log.frames.length, n, 'one frame handed over per drawn frame');
  assert.deepEqual(codecs.log.frames.map((f) => f.timestamp), Array.from({ length: n }, (_, i) => Math.round((i * 1e6) / 24)));
  assert.ok(codecs.log.frames.every((f) => f.closed), 'every frame is released');
  assert.equal(report.frames, n);
  assert.equal(report.seconds, n / 24);
  assert.equal(report.keyframes, 1, 'one keyframe per two seconds');
  assert.ok(report.realtime < 1, 'a piece slower than real time is a slower export, not a shorter film');
  assert.equal(readMp4(bytes).tracks[0].samples, n);
});

test('the film carries the colour space its encoder reported, and refuses to guess one', async () => {
  const { p, solved } = piece();
  const narrow = { primaries: 'smpte170m', transfer: 'smpte170m', matrix: 'smpte170m', fullRange: false };
  const tagged = await exportFilm(p, solved, env({ colorSpace: narrow }).env);
  assert.deepEqual(readMp4(tagged.bytes).tracks[0].colour, { primaries: 6, transfer: 6, matrix: 6, fullRange: false });
  await assert.rejects(exportFilm(p, solved, env({ colorSpace: null }).env), /no colour tag/);
});

test('a piece with sound gets a soundtrack exactly as long as its film, or no film at all', async () => {
  const { p, solved } = piece({ sound(ctx) { const o = ctx.createOscillator(); o.connect(ctx.destination); o.start(0); } });
  const { env: e, codecs } = env();
  const { bytes, report } = await exportFilm(p, solved, e);
  assert.equal(codecs.log.audioFrames, 2 * 48000, 'the rendered soundtrack is exactly frames / hz long');
  const audio = readMp4(bytes).tracks.find((x) => x.kind === 'soun');
  assert.equal(audio.samples, Math.ceil((2 * 48000) / 1024));
  assert.ok(report.sound, 'and the report reads it from the file');

  const mute = env({ aac: false, opus: false });
  await assert.rejects(exportFilm(p, solved, mute.env), /encodes neither AAC nor Opus/);
  assert.equal(mute.codecs.log.frames.length, 0, 'the soundtrack fails before a single frame is drawn');
  const silent = env().env;
  delete silent.AudioEncoder;
  await assert.rejects(exportFilm(p, solved, silent), /no AudioEncoder/);
});

test('a piece with sound falls back to Opus where AAC is refused, and keeps AAC wherever it is offered', async () => {
  const { p, solved } = piece({ sound(ctx) { const o = ctx.createOscillator(); o.connect(ctx.destination); o.start(0); } });
  const both = await exportFilm(p, solved, env().env);
  assert.equal(readMp4(both.bytes).tracks[1].codec, 'mp4a', 'AAC stays the first choice');

  const { bytes, report } = await exportFilm(p, solved, env({ aac: false }).env);
  const audio = readMp4(bytes).tracks[1];
  assert.equal(audio.codec, 'Opus');
  assert.equal(audio.samples, (2 * 48000) / 960);
  assert.deepEqual(audio.opus, { version: 0, channels: 2, preSkip: 312, inputSampleRate: 48000, outputGain: 0, mappingFamily: 0 },
    "the encoder's pre-skip reaches the file");
  assert.equal(report.sound.codec, 'Opus');

  const blind = env({ aac: false, describe: false });
  await assert.rejects(exportFilm(p, solved, blind.env), /gave no OpusHead/);
  assert.equal(blind.codecs.log.frames.length, 0, 'refused before a single frame is drawn');
});

test('a still, a browser without encoders, a failing or stalled encoder and a bad scale are refused by name', async () => {
  const still = validate({ name: 'still', size: { w: 8, h: 8 }, draw() {} });
  await assert.rejects(exportFilm(still, solve(still), env().env), /a still has no frame list/);

  const { p, solved } = piece();
  const bare = env().env;
  delete bare.VideoEncoder;
  await assert.rejects(exportFilm(p, solved, bare), /no VideoEncoder/);

  await assert.rejects(exportFilm(p, solved, env({ supported: () => false }).env), /no H\.264 encoder here accepts 64 x 48/);
  await assert.rejects(exportFilm(p, solved, env({ failAt: 5 }).env), /fixture encoder failed/);
  await assert.rejects(exportFilm(p, solved, env({ stall: true }).env), /encoder stopped accepting frames at frame 0 of 48/);
  await assert.rejects(exportFilm(p, solved, env().env, { scale: 0 }), /scale must be a positive finite number, got 0/);
});

test('the lowest H.264 level that fits is declared first, and the frame size is kept even', async () => {
  assert.deepEqual(avcCodecs(960, 640, 24).slice(0, 2), ['avc1.64001f', 'avc1.4d001f']);
  assert.equal(avcCodecs(2160, 2160, 24)[0], 'avc1.640032');
  assert.equal(avcCodecs(1920, 1080, 60)[0], 'avc1.64002a');
  assert.deepEqual(avcCodecs(20000, 20000, 24), [], 'nothing fits past the largest level');
  assert.deepEqual([...aacConfig(48000, 2)], [0x11, 0x90]);
  assert.deepEqual([...aacConfig(44100, 1)], [0x12, 0x08]);

  const odd = validate({ name: 'odd', size: { w: 33, h: 21 }, time: { duration: 0.5, hz: 8 }, draw() {} });
  const { report } = await exportFilm(odd, solve(odd), env().env);
  assert.deepEqual([report.width, report.height], [34, 22], '4:2:0 video needs even sides');
});
