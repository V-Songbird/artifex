'use strict';

// The frame-exact film: MP4 written, read back and judged against the grid the
// piece declares. Encoders are stand-ins here; native encoding, decoding and
// playback are the browser check's business.

const test = require('node:test');
const assert = require('node:assert/strict');

const { validate, solve, VERSION } = require('../core/piece.js');
const { playheads } = require('../core/render.js');
const { exportFilm, muxMp4, readMp4, filmCheck, avcCodecs, aacConfig, rgbaToNV12 } = require('../core/film.js');
const { nullSurface } = require('../tools/bench.js');
const { fakeAudio, fakeCodecs, opusHead } = require('./fake-media.js');

const BT709 = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false };
const AVCC = Uint8Array.of(1, 0x64, 0, 0x1f, 0xff, 0xe1, 0, 0);

/** `n` Opus packets of one 20 ms fullband CELT frame each. */
const celt = (n) => Array.from({ length: n }, (_, i) => Uint8Array.of(0xfc, i & 255));

// A recipe to carry: a name with characters past Latin-1, and a parameter no
// binary fraction holds exactly.
const MANIFEST = {
  artifex: '0.1.0', piece: 'señal ✳', seed: 3, size: { w: 64, h: 48 }, outputs: ['raster'], params: { reach: 0.1 },
  film: { frames: 48, hz: 24, loop: false, scale: 1 },
};

/** The pre-skip an OpusHead names: little-endian, at byte 10. */
const preSkipOf = (head) => head[10] | (head[11] << 8);

function film({ frames = 48, delta = 1000, timescale = 24000, keys = [0, 24], audio = 94, opus = null, priming = 0, width = 64, height = 48, manifest = MANIFEST } = {}) {
  const head = opus && (opus.head || opusHead());
  return muxMp4({
    manifest,
    video: {
      width, height, timescale, delta, avcC: AVCC,
      samples: Array.from({ length: frames }, (_, i) => ({ data: Uint8Array.of(i, 1, 2, 3), key: keys.includes(i) })),
    },
    audio: opus ? { codec: 'opus', head, samples: opus.packets, priming: preSkipOf(head) } : audio ? {
      sampleRate: 48000, channels: 2, asc: aacConfig(48000, 2), bitrate: 128000, priming,
      samples: Array.from({ length: audio }, (_, i) => Uint8Array.of(0x21, i & 255)),
    } : null,
  });
}

/** Where every box of `type` starts, at its size field. */
function boxesOf(bytes, type) {
  const out = [];
  for (let i = 4; i + 4 <= bytes.length; i++) if (String.fromCharCode(...bytes.subarray(i, i + 4)) === type) out.push(i - 4);
  return out;
}

/** The bytes of the first box of `type`, from its size field to its end. */
function boxBytes(bytes, type) {
  const at = boxesOf(bytes, type)[0];
  return [...bytes.subarray(at, at + new DataView(bytes.buffer, bytes.byteOffset).getUint32(at))];
}

const GRID = { frames: 48, hz: 24, width: 64, height: 48, sound: true, priming: 0, manifest: MANIFEST };
// What an Opus film's check expects: the 312-sample pre-skip Edge's encoder reports.
const OPUS = { ...GRID, priming: 312 };

function env(options = {}) {
  const codecs = fakeCodecs(options);
  const contexts = [];
  const pixel = options.pixel || [255, 0, 0, 255];
  let clock = 0;
  return {
    codecs,
    contexts,
    env: {
      VideoEncoder: codecs.VideoEncoder, VideoFrame: codecs.VideoFrame,
      AudioEncoder: codecs.AudioEncoder, AudioData: codecs.AudioData,
      OfflineAudioContext: fakeAudio().Context,
      // A 2D surface whose every pixel reads back as `pixel`, and no WebGL2, so
      // the CPU conversion runs.
      createCanvas: (w, h) => ({
        width: w, height: h,
        getContext(type, attributes) {
          if (type !== '2d') return null;
          contexts.push(attributes);
          const g = nullSurface({ w, h });
          g.getImageData = (x, y, gw, gh) => ({ data: Uint8ClampedArray.from({ length: gw * gh * 4 }, (_, i) => pixel[i & 3]) });
          return g;
        },
      }),
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
  assert.deepEqual(video.colour, { primaries: 1, transfer: 1, matrix: 1, fullRange: false });
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

test('every film is tagged limited-range BT.709, and the check refuses any other tag', () => {
  const bytes = film();
  assert.deepEqual(boxBytes(bytes, 'colr'), [0, 0, 0, 19, 0x63, 0x6f, 0x6c, 0x72, 0x6e, 0x63, 0x6c, 0x78, 0, 1, 0, 1, 0, 1, 0]);
  assert.equal(filmCheck(GRID, readMp4(bytes)).frames, 48);
  const at = bytes.findIndex((_, i) => String.fromCharCode(...bytes.subarray(i, i + 4)) === 'colr');
  const tagged = (edit) => {
    const copy = bytes.slice();
    edit(new DataView(copy.buffer), copy);
    return grab(() => filmCheck(GRID, readMp4(copy))).message;
  };
  assert.match(tagged((v, b) => { b[at + 14] = 0x80; }), /tagged primaries 1, transfer 1, matrix 1, full range/);
  assert.match(tagged((v) => v.setUint16(at + 10, 13)), /transfer 13,/, 'sRGB transfer is not BT.709');
  assert.match(tagged((v) => v.setUint16(at + 8, 6)), /primaries 6,/);
  assert.match(tagged((v) => v.setUint16(at + 12, 6)), /matrix 6,/);
  assert.match(tagged((v, b) => { b[at + 3] = 0x78; }), /no colour tag/);
});

test('a film carries its replay manifest in a user-data box, and no sample byte moves', () => {
  const carried = film();
  assert.deepEqual(readMp4(carried).manifest, MANIFEST);
  // One uuid box: its size, 'uuid', the extended type, then the JSON in ASCII.
  const uuid = boxBytes(carried, 'uuid');
  assert.deepEqual(uuid.slice(8, 24), [0x8b, 0x2f, 0xd9, 0x66, 0xe9, 0x23, 0x43, 0x30, 0xa2, 0x8e, 0x6d, 0x82, 0x58, 0x7d, 0x1e, 0xc9]);
  assert.ok(uuid.slice(24).every((b) => b < 0x80), 'ASCII only');
  assert.ok(String.fromCharCode(...uuid.slice(24)).startsWith('{"artifex":"0.1.0","piece":"se\\u00f1al \\u2733","seed":3,'));
  const size = (at) => new DataView(carried.buffer).getUint32(at);
  const [moov] = boxesOf(carried, 'moov'), [udta] = boxesOf(carried, 'udta'), [mdat] = boxesOf(carried, 'mdat');
  assert.ok(udta > moov && udta + size(udta) <= moov + size(moov) && udta < mdat, 'in moov, before the media data');

  // The same film without it: the media data is the same bytes, and every
  // chunk offset moves by the box, so every sample is read from them.
  const plain = film({ manifest: null });
  assert.equal(readMp4(plain).manifest, null);
  const grow = carried.length - plain.length;
  assert.equal(grow, size(udta), 'the file grows by the user-data box alone');
  const media = (b) => [...b.subarray(boxesOf(b, 'mdat')[0])];
  assert.deepEqual(media(carried), media(plain));
  const offsets = (b) => boxesOf(b, 'stco').map((at) => {
    const v = new DataView(b.buffer);
    return Array.from({ length: v.getUint32(at + 12) }, (_, i) => v.getUint32(at + 16 + i * 4));
  });
  assert.deepEqual(offsets(carried), offsets(plain).map((track) => track.map((o) => o + grow)));
});

test('the film check refuses a film whose manifest is missing or differs from the one the export drew with', () => {
  assert.deepEqual(filmCheck(GRID, readMp4(film())).manifest, MANIFEST, 'the report carries the manifest the file holds');
  assert.match(grab(() => filmCheck(GRID, readMp4(film({ manifest: null })))).message, /carries no replay manifest/);
  const drew = (change) => grab(() => filmCheck({ ...GRID, manifest: { ...MANIFEST, ...change } }, readMp4(film()))).message;
  assert.match(drew({ seed: 4 }), /manifest gives seed 3 where the export drew with 4\./);
  assert.match(drew({ params: { reach: 0.2 } }), /gives params \{"reach":0\.1\} where the export drew with \{"reach":0\.2\}/);
  assert.match(drew({ film: { ...MANIFEST.film, loop: true } }), /gives film \{[^}]*"loop":false[^}]*\} where/);
  assert.match(drew({ t: 0.5 }), /gives t undefined where the export drew with 0\.5/);

  // Only this writer's extended type is a manifest, and a broken one is named.
  const foreign = film();
  foreign[boxesOf(foreign, 'uuid')[0] + 8] ^= 1;
  assert.equal(readMp4(foreign).manifest, null, 'a uuid box of another type is not a manifest');
  const broken = film();
  broken[boxesOf(broken, 'uuid')[0] + 24] = 0x78;
  assert.throws(() => readMp4(broken), /the replay manifest at byte \d+ is not JSON/);
});

test('a film lasts its frames: the movie, each track header, and one soundtrack edit that skips the priming', () => {
  // AAC whose encoder reported 1024 samples of priming: its 94 packets run to 2.005 s.
  const aac = readMp4(film({ priming: 1024 }));
  assert.deepEqual(aac.movie, { timescale: 24000, duration: 48000 }, "the movie counts in the video's ticks and lasts 2 s");
  assert.deepEqual(aac.tracks.map((t) => t.span), [48000, 48000]);
  assert.equal(aac.tracks[0].edits, null, 'the pictures need no edit');
  assert.deepEqual(aac.tracks[1].edits, [{ duration: 48000, mediaTime: 1024, rate: 1 }]);
  assert.equal(aac.tracks[1].duration, 94 * 1024, "the soundtrack's own samples are all kept");
  assert.deepEqual(readMp4(film({ opus: { packets: celt(101) } })).tracks[1].edits, [{ duration: 48000, mediaTime: 312, rate: 1 }]);
  // 25 frames at 24 Hz last 1.041666... s, which no count of milliseconds holds.
  const odd = readMp4(film({ frames: 25, keys: [0] }));
  assert.deepEqual(odd.movie, { timescale: 24000, duration: 25000 });
  assert.equal(odd.tracks[1].edits[0].duration, 25000);
  const silent = readMp4(film({ audio: 0 }));
  assert.deepEqual([silent.movie.duration, silent.tracks.length], [48000, 1]);
});

test('the film check refuses a movie, a track header or a soundtrack edit that disagrees with the film', () => {
  const at = (bytes, type, k = 0) => boxesOf(bytes, type)[k];
  const edited = (edit, grid = GRID, make = film) => {
    const bytes = make();
    edit(new DataView(bytes.buffer), bytes);
    return grab(() => filmCheck(grid, readMp4(bytes))).message;
  };
  // Durations: mvhd at byte 24 of its box, tkhd at 28; elst's one edit has its
  // segment at 16, its media_time at 20 and its rate at 24.
  assert.match(edited((v, b) => v.setUint32(at(b, 'mvhd') + 24, 48128)), /the movie lasts 2\.005 s against a 2\.000 s film/);
  assert.match(edited((v, b) => v.setUint32(at(b, 'tkhd', 1) + 28, 48128)), /the sound track's header gives 2\.005 s/);
  assert.match(edited((v, b) => v.setUint32(at(b, 'tkhd') + 28, 47000)), /the video track's header gives 1\.958 s/);
  assert.match(edited((v, b) => v.setUint32(at(b, 'elst') + 16, 48128)), /the soundtrack's edit lasts 2\.005 s against a 2\.000 s film/);
  assert.match(edited((v, b) => b.set([0x66, 0x72, 0x65, 0x65], at(b, 'edts') + 4)), /no single edit/);
  assert.match(edited((v, b) => v.setInt16(at(b, 'elst') + 24, 2)), /no single edit/);
  assert.match(edited((v, b) => v.setInt32(at(b, 'elst') + 20, -1)), /no single edit/);
  // The skip is held to what the encoder primed, never to the file's own dOps.
  const opus = () => film({ opus: { packets: celt(101) } });
  assert.match(edited((v, b) => v.setInt32(at(b, 'elst') + 20, 0), OPUS, opus), /edit skips 0 samples and the encoder primed 312/);
  assert.match(edited(() => {}, { ...OPUS, priming: 0 }, opus), /edit skips 312 samples and the encoder primed 0/);
  assert.match(edited(() => {}, { ...GRID, priming: 1024 }), /edit skips 0 samples and the encoder primed 1024/);
});

test('drawn pixels become BT.709 limited-range NV12: luma per pixel, chroma per 2x2 block, translucency over black', () => {
  // A 2x2 block of one colour gives four equal luma samples and one chroma pair.
  const block = (rgba) => Uint8ClampedArray.from({ length: 16 }, (_, i) => rgba[i & 3]);
  const bars = {
    black: [[0, 0, 0], [16, 128, 128]], white: [[255, 255, 255], [235, 128, 128]], grey: [[128, 128, 128], [126, 128, 128]],
    red: [[255, 0, 0], [63, 102, 240]], green: [[0, 255, 0], [173, 42, 26]], blue: [[0, 0, 255], [32, 240, 118]],
    yellow: [[255, 255, 0], [219, 16, 138]], cyan: [[0, 255, 255], [188, 154, 16]], magenta: [[255, 0, 255], [78, 214, 230]],
  };
  for (const [name, [rgb, want]] of Object.entries(bars)) {
    const out = rgbaToNV12(block([...rgb, 255]), 2, 2);
    assert.deepEqual([...out], [want[0], want[0], want[0], want[0], want[1], want[2]], name);
  }
  // The chroma pair comes from the block's average: red and blue make purple.
  const mixed = Uint8ClampedArray.of(255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255, 255, 0, 0, 255);
  assert.deepEqual([...rgbaToNV12(mixed, 2, 2)], [63, 32, 32, 63, 171, 179]);
  // Half-transparent white over black is mid grey.
  assert.deepEqual([...rgbaToNV12(block([255, 255, 255, 128]), 2, 2)], [126, 126, 126, 126, 128, 128]);
  // Four blocks keep their rows and columns, black, white / red, blue, with
  // each block's U and V side by side.
  const quad = new Uint8ClampedArray(64);
  const put = (x, y, rgb) => quad.set([...rgb, 255], (y * 4 + x) * 4);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) put(x, y, y < 2 ? (x < 2 ? [0, 0, 0] : [255, 255, 255]) : (x < 2 ? [255, 0, 0] : [0, 0, 255]));
  }
  assert.deepEqual([...rgbaToNV12(quad, 4, 4)], [
    16, 16, 235, 235, 16, 16, 235, 235, 63, 63, 32, 32, 63, 63, 32, 32,
    128, 128, 128, 128,
    102, 240, 240, 118,
  ]);
});

test('the dOps box is the OpusHead in big-endian with PreSkip 0, and the edit list skips the pre-skip', () => {
  // Every multi-byte field reads differently in the other byte order: a 44.1 kHz
  // source and -3.5 dB of output gain. The encoder's 312 samples of pre-skip
  // belong to the edit list, so a reader that trims by both, as Chromium does,
  // drops them once.
  const stereo = film({ opus: { head: opusHead({ preSkip: 312, rate: 44100, gain: -896 }), packets: celt(101) } });
  assert.deepEqual(boxBytes(stereo, 'dOps'), [0, 0, 0, 19, 0x64, 0x4f, 0x70, 0x73, 0, 2, 0, 0, 0, 0, 0xac, 0x44, 0xfc, 0x80, 0]);
  const track = readMp4(stereo).tracks[1];
  assert.equal(track.codec, 'Opus');
  assert.deepEqual([track.channels, track.sampleRate, track.timescale], [2, 48000, 48000], 'an Opus track runs at 48 kHz, whatever rate went in');
  assert.deepEqual(track.opus, { version: 0, channels: 2, preSkip: 0, inputSampleRate: 44100, outputGain: -896, mappingFamily: 0 });
  assert.deepEqual(track.edits, [{ duration: 48000, mediaTime: 312, rate: 1 }]);

  // 5.1 under mapping family 1: the stream counts and channel mapping pass through unchanged.
  const surround = film({ opus: { head: opusHead({ channels: 6, family: 1, table: [4, 2, 0, 4, 1, 2, 3, 5] }), packets: celt(101) } });
  assert.deepEqual(boxBytes(surround, 'dOps').slice(8), [0, 6, 0, 0, 0, 0, 0xbb, 0x80, 0, 0, 1, 4, 2, 0, 4, 1, 2, 3, 5]);
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
  const report = filmCheck(OPUS, readMp4(film({ opus: { packets: celt(101) } })));
  assert.deepEqual(report.sound, { codec: 'Opus', seconds: (101 * 960 - 312) / 48000, channels: 2, sampleRate: 48000 });
  // Two seconds of packets, but 80 ms of them are pre-skip that no decoder plays.
  const late = film({ opus: { head: opusHead({ preSkip: 3840 }), packets: celt(100) } });
  assert.match(grab(() => filmCheck({ ...GRID, priming: 3840 }, readMp4(late))).message, /soundtrack lasts 1\.920 s against a 2\.000 s film/);
  // Without its dOps no decoder can open the track.
  const bytes = film({ opus: { packets: celt(101) } });
  bytes[bytes.findIndex((_, i) => String.fromCharCode(...bytes.subarray(i, i + 4)) === 'dOps') + 3] = 0x78;
  assert.match(grab(() => filmCheck(OPUS, readMp4(bytes))).message, /no playable soundtrack/);
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

test('an exported film names its piece, seed, parameters, frame grid and scale', async () => {
  const reach = { reach: { value: 0.5, min: 0, max: 1, meaning: 'how far the bar reaches' } };
  const draw = (g, s, t) => g.fillRect(0, 0, 64 * t * s.params.reach + 1, 48);
  const want = (loop, scale) => ({
    artifex: VERSION, piece: 'film-fixture', seed: 7, size: { w: 64, h: 48 }, outputs: ['raster'],
    params: { reach: 0.25 }, film: { frames: 48, hz: 24, loop, scale },
  });
  const { p } = piece({ params: reach, draw });
  const { bytes, report } = await exportFilm(p, solve(p, 7, { reach: 0.25 }), env().env);
  assert.deepEqual(readMp4(bytes).manifest, want(false, 1));
  assert.deepEqual(report.manifest, want(false, 1));
  // A looping timeline puts frame i at i / 48 instead of i / 47, so the grid
  // says which; a piece may draw finer detail at 2x, so the scale is named too.
  const { p: loop } = piece({ params: reach, draw, time: { duration: 2, hz: 24, loop: true } });
  const twice = await exportFilm(loop, solve(loop, 7, { reach: 0.25 }), env().env, { scale: 2 });
  assert.deepEqual(readMp4(twice.bytes).manifest, want(true, 2));
});

test('every frame reaches the encoder as BT.709 limited-range NV12, whatever the encoder reports', async () => {
  const { p, solved } = piece();
  // This stand-in encoder reports full-range sRGB; the film does not take its word.
  const { env: e, codecs, contexts } = env({ pixel: [255, 0, 0, 255] });
  const { bytes, report } = await exportFilm(p, solved, e);
  const frames = codecs.log.frames;
  assert.equal(frames.length, playheads(p).length);
  assert.ok(frames.every((f) => f.format === 'NV12'), 'the encoder is handed video colour, not a canvas to convert');
  assert.ok(frames.every((f) => JSON.stringify(f.colorSpace) === JSON.stringify(BT709)), 'every frame says BT.709 limited range');
  const n = 64 * 48;
  assert.equal(frames[0].data.length, n * 1.5);
  assert.deepEqual([...frames[0].data.subarray(n - 2, n + 2)], [63, 63, 102, 240], 'red, in BT.709 limited range');
  assert.deepEqual(readMp4(bytes).tracks[0].colour, { primaries: 1, transfer: 1, matrix: 1, fullRange: false });
  assert.equal(report.conversion, 'cpu', 'no WebGL2 here, so the CPU converts');
  assert.deepEqual(contexts, [{ willReadFrequently: true }], 'a canvas read back every frame is kept in memory from the first');
  const quiet = await exportFilm(p, solved, env({ colorSpace: null }).env);
  assert.deepEqual(readMp4(quiet.bytes).tracks[0].colour, { primaries: 1, transfer: 1, matrix: 1, fullRange: false },
    'an encoder that reports no colour space still makes a tagged film');
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
  assert.deepEqual(audio.opus, { version: 0, channels: 2, preSkip: 0, inputSampleRate: 48000, outputGain: 0, mappingFamily: 0 });
  assert.deepEqual(audio.edits, [{ duration: 48000, mediaTime: 312, rate: 1 }], "the encoder's pre-skip reaches the edit list");
  assert.equal(report.sound.codec, 'Opus');

  const blind = env({ aac: false, describe: false });
  await assert.rejects(exportFilm(p, solved, blind.env), /gave no OpusHead/);
  assert.equal(blind.codecs.log.frames.length, 0, 'refused before a single frame is drawn');
});

test('an AAC encoder that stamps its first packet before zero has that priming skipped by the edit', async () => {
  const { p, solved } = piece({ sound(ctx) { const o = ctx.createOscillator(); o.connect(ctx.destination); o.start(0); } });
  const plain = await exportFilm(p, solved, env().env);
  assert.deepEqual(readMp4(plain.bytes).tracks[1].edits, [{ duration: 48000, mediaTime: 0, rate: 1 }], 'stamped at zero, as Edge stamps it: nothing to skip');
  // This encoder says its first packet starts 1024 samples before the soundtrack.
  const early = env().env;
  const Base = early.AudioEncoder;
  early.AudioEncoder = class extends Base {
    constructor({ output, error }) { super({ output: (chunk, meta) => output({ ...chunk, timestamp: chunk.timestamp - 21333 }, meta), error }); }
  };
  const primed = await exportFilm(p, solved, early);
  assert.deepEqual(readMp4(primed.bytes).tracks[1].edits, [{ duration: 48000, mediaTime: 1024, rate: 1 }]);
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
