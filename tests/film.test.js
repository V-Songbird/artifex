'use strict';

// The frame-exact film: MP4 written, read back and judged against the grid the
// piece declares. Encoders are stand-ins here; native encoding, decoding and
// playback are the browser check's business.

const test = require('node:test');
const assert = require('node:assert/strict');

const { validate, solve, VERSION } = require('../core/piece.js');
const { playheads } = require('../core/render.js');
const {
  exportFilm, muxMp4, readMp4, filmCheck, avcCodecs, aacConfig, rgbaToNV12, kWeighting, measureLoudness, loudnessGain,
} = require('../core/film.js');
const { nullSurface } = require('../tools/bench.js');
const { fakeAudio, fakeCodecs, fakeCanvas, opusHead, EDGE_AVCC } = require('./fake-media.js');

const BT709 = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false };
const AVCC = EDGE_AVCC;

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

function film({ frames = 48, delta = 1000, timescale = 24000, keys = [0, 24], audio = 94, opus = null, priming = 0, width = 64, height = 48, manifest = MANIFEST, avcC = AVCC, sample = (i) => Uint8Array.of(i, 1, 2, 3) } = {}) {
  const head = opus && (opus.head || opusHead());
  return muxMp4({
    manifest,
    video: {
      width, height, timescale, delta, avcC,
      samples: Array.from({ length: frames }, (_, i) => ({ data: sample(i), key: keys.includes(i) })),
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
  let clock = 0;
  return {
    codecs,
    contexts,
    env: {
      VideoEncoder: codecs.VideoEncoder, VideoFrame: codecs.VideoFrame,
      // A decoder, which lets the encoder convert frames itself where its probes prove it.
      ...(options.decode ? { VideoDecoder: codecs.VideoDecoder, EncodedVideoChunk: codecs.EncodedVideoChunk } : {}),
      AudioEncoder: codecs.AudioEncoder, AudioData: codecs.AudioData,
      OfflineAudioContext: fakeAudio().Context,
      // The shared stand-in canvas, which paints and reads back. With `webgl`
      // it copies through WebGL2 as well; without it there is no WebGL2, so the
      // CPU converts. Every 2D context's attributes are kept in `contexts`.
      createCanvas: (w, h) => fakeCanvas({ width: w, height: h }, nullSurface, {
        webgl: !!options.webgl,
        onContext: (g, type, attributes) => { if (type === '2d') contexts.push(attributes); },
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

// The colour description inside the H.264 stream: the video signal type of each
// sequence parameter set's VUI (ITU-T H.264, 7.3.2.1.1 and E.1.1). SPS NAL units
// are built from field values and read back field by field here, apart from
// core/film.js.

const HIGH = [100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135];
const PPS = [0x68, 0xee, 0x3c, 0xb0];
const EDGE_SPS = EDGE_AVCC.subarray(8, 31);
const EDGE_TAGGED = '67640020ac2b40780a3602d404040500000303e80000bb800f1c2aa0';
const TAGGED = { format: 5, fullRange: false, primaries: 1, transfer: 1, matrix: 1 };
const LIMITED_709 = { format: 5, full: 0, colour: [1, 1, 1] };

/** A NAL unit's payload: its header byte dropped, and each 03 that follows two zeros. */
function unescape(nal) {
  const out = [];
  let zeros = 0;
  for (const b of nal.subarray(1)) {
    if (zeros === 2 && b === 3) { zeros = 0; continue; }
    out.push(b);
    zeros = b === 0 ? Math.min(zeros + 1, 2) : 0;
  }
  return out;
}

/** A NAL unit from its header and payload, with 03 after every two zeros that precede 00 to 03. */
function escape(header, payload) {
  const out = [header];
  for (const b of payload) {
    if (b <= 3 && out[out.length - 1] === 0 && out[out.length - 2] === 0) out.push(3);
    out.push(b);
  }
  return Uint8Array.from(out);
}

/**
 * An SPS NAL unit from field values. `signal` is [format, full] or [format,
 * full, primaries, transfer, matrix]; `vui` null writes none.
 */
function spsOf(f) {
  const bits = [];
  const u = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push(Math.floor(v / 2 ** i) % 2); };
  const ue = (v) => { const n = Math.floor(Math.log2(v + 1)); u(0, n); u(v + 1, n + 1); };
  const se = (v) => ue(v <= 0 ? -2 * v : 2 * v - 1);
  u(f.profile, 8); u(f.constraint, 8); u(f.level, 8); ue(f.id);
  if (HIGH.includes(f.profile)) {
    ue(f.chroma); if (f.chroma === 3) u(0, 1);
    ue(f.depth || 0); ue(f.depth || 0); u(0, 1);
    u(f.scaling ? 1 : 0, 1);
    // One 4x4 list sent, whose second delta ends it; the rest use their defaults.
    if (f.scaling) for (let i = 0; i < 8; i++) { u(i === 0 ? 1 : 0, 1); if (i === 0) { se(5); se(-13); } }
  }
  ue(f.log2MaxFrame); ue(f.poc);
  if (f.poc === 0) ue(f.log2MaxPoc);
  else if (f.poc === 1) { u(1, 1); se(-2); se(3); ue(2); se(1); se(-1); }
  ue(f.refs); u(0, 1); ue(f.mbW); ue(f.mbH); u(f.frameMbsOnly, 1); if (!f.frameMbsOnly) u(1, 1);
  u(1, 1);
  u(f.crop ? 1 : 0, 1); if (f.crop) f.crop.forEach(ue);
  u(f.vui ? 1 : 0, 1);
  if (f.vui) {
    const v = f.vui;
    u(v.sar ? 1 : 0, 1); if (v.sar) { u(v.sar[0], 8); if (v.sar[0] === 255) { u(v.sar[1], 16); u(v.sar[2], 16); } }
    u(0, 1);
    u(v.signal ? 1 : 0, 1);
    if (v.signal) { u(v.signal[0], 3); u(v.signal[1], 1); u(v.signal.length > 2 ? 1 : 0, 1); v.signal.slice(2).forEach((c) => u(c, 8)); }
    u(v.chromaLoc ? 1 : 0, 1); if (v.chromaLoc) v.chromaLoc.forEach(ue);
    u(v.timing ? 1 : 0, 1); if (v.timing) { u(v.timing[0], 32); u(v.timing[1], 32); u(v.timing[2], 1); }
    u(v.hrd ? 1 : 0, 1);
    if (v.hrd) { ue(0); u(4, 4); u(6, 4); ue(2999); ue(4999); u(1, 1); u(23, 5); u(23, 5); u(23, 5); u(24, 5); }
    u(0, 1);
    if (v.hrd) u(0, 1);
    u(0, 1);
    u(v.restriction ? 1 : 0, 1); if (v.restriction) { u(1, 1); ue(0); ue(0); ue(13); ue(9); ue(0); ue(1); }
  }
  bits.push(1);
  while (bits.length % 8) bits.push(0);
  return escape(0x67, Array.from({ length: bits.length / 8 }, (_, i) => parseInt(bits.slice(i * 8, i * 8 + 8).join(''), 2)));
}

/** Every field of an SPS NAL unit; `end` is whether the stop bit and zero bits end the payload. */
function spsFields(nal) {
  const b = unescape(nal);
  let at = 0;
  const u = (n) => {
    let v = 0;
    for (let i = 0; i < n; i++, at++) {
      if (at >= b.length * 8) throw new Error('the SPS ends before its fields do');
      v = v * 2 + ((b[at >> 3] >> (7 - (at & 7))) & 1);
    }
    return v;
  };
  const ue = () => { let z = 0; while (!u(1)) z++; return 2 ** z - 1 + u(z); };
  const se = () => { const k = ue(); return k & 1 ? (k + 1) / 2 : -k / 2; };
  const f = { profile: u(8), constraint: u(8), level: u(8), id: ue() };
  if (HIGH.includes(f.profile)) {
    f.chroma = ue();
    if (f.chroma === 3) f.separate = u(1);
    f.depths = [ue(), ue(), u(1)];
    f.lists = u(1) ? Array.from({ length: f.chroma === 3 ? 12 : 8 }, (_, i) => {
      if (!u(1)) return null;
      const deltas = [];
      for (let j = 0, last = 8, next = 8; j < (i < 6 ? 16 : 64); j++) {
        if (next !== 0) { deltas.push(se()); next = (last + deltas[deltas.length - 1] + 256) % 256; }
        last = next === 0 ? last : next;
      }
      return deltas;
    }) : null;
  }
  f.log2MaxFrame = ue();
  f.poc = ue();
  if (f.poc === 0) f.log2MaxPoc = ue();
  else if (f.poc === 1) f.pocCycle = [u(1), se(), se(), ...Array.from({ length: ue() }, se)];
  f.frames = [ue(), u(1), ue(), ue()];
  f.frameMbsOnly = u(1);
  if (!f.frameMbsOnly) f.mbaff = u(1);
  f.direct8x8 = u(1);
  f.crop = u(1) ? [ue(), ue(), ue(), ue()] : null;
  if (u(1)) {
    const v = {};
    const hrd = () => {
      const count = ue();
      const out = [count, u(4), u(4)];
      for (let i = 0; i <= count; i++) out.push(ue(), ue(), u(1));
      return [...out, u(5), u(5), u(5), u(5)];
    };
    v.sar = u(1) ? [u(8)] : null;
    if (v.sar && v.sar[0] === 255) v.sar.push(u(16), u(16));
    v.overscan = u(1) ? u(1) : null;
    v.signal = u(1) ? { format: u(3), full: u(1), colour: u(1) ? [u(8), u(8), u(8)] : null } : null;
    v.chromaLoc = u(1) ? [ue(), ue()] : null;
    v.timing = u(1) ? [u(32), u(32), u(1)] : null;
    v.nalHrd = u(1) ? hrd() : null;
    v.vclHrd = u(1) ? hrd() : null;
    if (v.nalHrd || v.vclHrd) v.lowDelay = u(1);
    v.picStruct = u(1);
    v.restriction = u(1) ? [u(1), ue(), ue(), ue(), ue(), ue(), ue()] : null;
    f.vui = v;
  } else f.vui = null;
  const left = b.length * 8 - at;
  f.end = left >= 1 && left <= 8 && u(1) === 1 && u(left - 1) === 0;
  return f;
}

/** The fields apart from the signal type; no VUI reads as one that holds only a signal type. */
function besideSignal(f) {
  const vui = f.vui || { sar: null, overscan: null, signal: null, chromaLoc: null, timing: null, nalHrd: null, vclHrd: null, picStruct: 0, restriction: null };
  return { ...f, vui: { ...vui, signal: undefined } };
}

/** An avcC holding these SPS NAL units and Edge's picture parameter set. */
const avcCWith = (...sets) => Uint8Array.from([
  1, 0x64, 0, 0x20, 0xff, 0xe0 | sets.length, ...sets.flatMap((s) => [s.length >> 8, s.length & 255, ...s]), 1, 0, PPS.length, ...PPS,
]);

/** The avcC a film holds: its first six bytes, its SPS NAL units and the bytes after them. */
function avcCOf(bytes) {
  const c = Uint8Array.from(boxBytes(bytes, 'avcC').slice(8));
  const sets = [];
  let at = 6;
  for (let n = c[5] & 31; n > 0; n--) {
    const length = (c[at] << 8) | c[at + 1];
    sets.push(c.subarray(at + 2, at + 2 + length));
    at += 2 + length;
  }
  return { head: [...c.subarray(0, 6)], sets, rest: [...c.subarray(at)] };
}

/** Length-prefixed NAL units, as a sample holds them. */
const unitsOf = (...units) => Uint8Array.from(units.flatMap((n) => [0, 0, n.length >> 8, n.length & 255, ...n]));

const SHAPES = {
  edge: EDGE_SPS,
  baselineNoVui: spsOf({ profile: 66, constraint: 0xc0, level: 30, id: 0, log2MaxFrame: 0, poc: 2, refs: 1, mbW: 3, mbH: 2, frameMbsOnly: 1, crop: null, vui: null }),
  mainPoc0Crop: spsOf({
    profile: 77, constraint: 0x40, level: 31, id: 1, log2MaxFrame: 2, poc: 0, log2MaxPoc: 4, refs: 3, mbW: 79, mbH: 44, frameMbsOnly: 1,
    crop: [0, 0, 0, 4], vui: { sar: [255, 4, 3], timing: [1001, 60000, 1], restriction: true },
  }),
  // Full-range BT.601 already stated, behind scaling lists, POC type 1, fields and HRD.
  highPoc1Scaling: spsOf({
    profile: 100, constraint: 0, level: 40, id: 0, chroma: 1, scaling: true, log2MaxFrame: 4, poc: 1, refs: 4, mbW: 119, mbH: 67, frameMbsOnly: 0,
    crop: [0, 0, 0, 4], vui: { sar: [1], signal: [5, 1, 6, 6, 6], chromaLoc: [1, 1], hrd: true, restriction: true },
  }),
  // 10-bit 4:4:4, whose SPS carries a colour-plane flag, stating BT.2020 and PQ.
  high444: spsOf({
    profile: 244, constraint: 0, level: 50, id: 2, chroma: 3, depth: 2, scaling: false, log2MaxFrame: 4, poc: 2, refs: 4, mbW: 119, mbH: 67, frameMbsOnly: 1,
    crop: [0, 0, 0, 4], vui: { signal: [2, 0, 9, 16, 9] },
  }),
  // A signal type that states a range and no colour description.
  rangeOnly: spsOf({ profile: 100, constraint: 0, level: 31, id: 0, chroma: 1, scaling: false, log2MaxFrame: 0, poc: 2, refs: 1, mbW: 39, mbH: 29, frameMbsOnly: 1, crop: null, vui: { signal: [5, 1] } }),
  // A zero sample aspect ratio and zero timing put escaped runs of zeros before and after the signal type.
  zeros: spsOf({
    profile: 100, constraint: 0, level: 0, id: 0, chroma: 1, scaling: false, log2MaxFrame: 0, poc: 0, log2MaxPoc: 0, refs: 0, mbW: 0, mbH: 0, frameMbsOnly: 1,
    crop: null, vui: { sar: [255, 0, 0], timing: [0, 0, 0] },
  }),
};

test('every sequence parameter set says limited-range BT.709 and keeps every other field its encoder wrote', () => {
  assert.ok(unescape(SHAPES.zeros).length < SHAPES.zeros.length - 2, 'the zeros shape holds escaped runs');
  for (const [name, sps] of Object.entries(SHAPES)) {
    const bytes = film({ avcC: avcCWith(sps) });
    const c = avcCOf(bytes);
    assert.deepEqual(c.head, [1, 0x64, 0, 0x20, 0xff, 0xe1], `${name}: the avcC header is kept`);
    assert.deepEqual(c.rest, [1, 0, PPS.length, ...PPS], `${name}: the picture parameter set is kept`);
    const [out] = c.sets;
    const before = spsFields(sps), after = spsFields(out);
    assert.deepEqual(after.vui.signal, LIMITED_709, `${name}: limited-range BT.709`);
    assert.deepEqual(besideSignal(after), besideSignal(before), `${name}: every other field is kept`);
    assert.equal(after.end, true, `${name}: the stop bit ends the payload`);
    assert.deepEqual([...escape(out[0], unescape(out))], [...out], `${name}: every 00 00 before 00 to 03 is escaped`);
    assert.deepEqual([...avcCOf(film({ avcC: avcCWith(out) })).sets[0]], [...out], `${name}: tagging twice changes nothing`);
    assert.deepEqual(readMp4(bytes).tracks[0].sps, [TAGGED], `${name}: the reader agrees`);
    assert.equal(filmCheck(GRID, readMp4(bytes)).frames, 48, name);
  }
  assert.equal(Buffer.from(avcCOf(film()).sets[0]).toString('hex'), EDGE_TAGGED, "Edge's SPS, tagged");
});

test('a sequence parameter set a sample repeats is tagged too, and a sample that is not whole NAL units is left alone', () => {
  const slice = [0x65, 0x88, 0x84, 0x00, 0x21];
  const bytes = film({ sample: (i) => (i === 0 ? unitsOf(EDGE_SPS, PPS, slice) : Uint8Array.of(i, 1, 2, 3)) });
  const view = new DataView(bytes.buffer);
  const units = [];
  for (let at = boxesOf(bytes, 'mdat')[0] + 8, i = 0; i < 3; i++) {
    units.push([...bytes.subarray(at + 4, at + 4 + view.getUint32(at))]);
    at += 4 + view.getUint32(at);
  }
  assert.equal(Buffer.from(units[0]).toString('hex'), EDGE_TAGGED, 'the repeated SPS');
  assert.deepEqual(units.slice(1), [PPS, slice], 'the units after it');
  const file = readMp4(bytes);
  assert.equal(file.tracks[0].inside, true);
  assert.deepEqual(file.tracks[0].sps, [TAGGED, TAGGED], "the avcC's, then the sample's");
  assert.equal(filmCheck(GRID, file).frames, 48);

  // A length that runs past the sample: every byte stays as the encoder wrote
  // it, and the check still reads the untagged SPS before that length.
  const broken = Uint8Array.from([...unitsOf(EDGE_SPS), 0, 0, 0, 9, 0x65]);
  const kept = film({ sample: (i) => (i === 0 ? broken : Uint8Array.of(i, 1, 2, 3)) });
  const media = boxesOf(kept, 'mdat')[0] + 8;
  assert.deepEqual([...kept.subarray(media, media + broken.length)], [...broken]);
  assert.match(grab(() => filmCheck(GRID, readMp4(kept))).message, /the H\.264 stream carries no colour description/);
});

test('the film check refuses an H.264 stream whose colour description is missing or disagrees with colr', () => {
  // Byte 11 of Edge's tagged SPS holds the signal type's flag, format, range
  // and description flags; bytes 12 to 14 end primaries, transfer and matrix.
  const says = (bytes, at, edit) => {
    const copy = bytes.slice();
    edit(copy.subarray(at));
    return { sps: copy.subarray(at, at + EDGE_TAGGED.length / 2), message: grab(() => filmCheck(GRID, readMp4(copy))).message };
  };
  const plain = film();
  const inAvcC = boxesOf(plain, 'avcC')[0] + 16;
  const cases = [
    [(s) => { s[11] |= 0x08; }, { format: 5, full: 1, colour: [1, 1, 1] }, /the H\.264 stream says primaries 1, transfer 1, matrix 1, full range, and its colr box says limited-range BT\.709/],
    [(s) => { s[12] = 0x18; }, { format: 5, full: 0, colour: [6, 1, 1] }, /says primaries 6, transfer 1, matrix 1, limited range/],
    [(s) => { s[13] = 0x34; }, { format: 5, full: 0, colour: [1, 13, 1] }, /says primaries 1, transfer 13, matrix 1, limited range/],
    [(s) => { s[14] = 0x19; }, { format: 5, full: 0, colour: [1, 1, 6] }, /says primaries 1, transfer 1, matrix 6, limited range/],
  ];
  for (const [edit, signal, message] of cases) {
    const seen = says(plain, inAvcC, edit);
    assert.deepEqual(spsFields(seen.sps).vui.signal, signal);
    assert.match(seen.message, message);
  }
  // No colour description: the description flag cleared, so the colours read as unspecified.
  assert.match(says(plain, inAvcC, (s) => { s[11] &= ~0x04; }).message, /says primaries 2, transfer 2, matrix 2, limited range/);
  const none = film({ avcC: Uint8Array.of(1, 0x64, 0, 0x20, 0xff, 0xe0, 1, 0, PPS.length, ...PPS) });
  assert.match(grab(() => filmCheck(GRID, readMp4(none))).message, /the H\.264 stream carries no colour description/);

  // The same refusal for an SPS a sample repeats, after a tagged one in the avcC.
  const repeated = film({ sample: (i) => (i === 0 ? unitsOf(EDGE_SPS, PPS) : Uint8Array.of(i, 1, 2, 3)) });
  const seen = says(repeated, boxesOf(repeated, 'mdat')[0] + 12, (s) => { s[11] |= 0x08; });
  assert.deepEqual(spsFields(seen.sps).vui.signal, { format: 5, full: 1, colour: [1, 1, 1] });
  assert.match(seen.message, /the H\.264 stream says primaries 1, transfer 1, matrix 1, full range/);
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

test('the film check refuses a soundtrack that ends before its edit, however little', () => {
  // One AAC packet short: 93 packets hold 95232 of the 96000 samples the edit plays.
  assert.match(grab(() => filmCheck(GRID, readMp4(film({ audio: 93 })))).message, /soundtrack lasts 1\.984 s against a 2\.000 s film/);
  // Opus packets that stop 312 samples short once the pre-skip is skipped.
  assert.match(grab(() => filmCheck(OPUS, readMp4(film({ opus: { packets: celt(100) } })))).message, /soundtrack lasts 1\.99\d s against a 2\.000 s film/);
  // Covered exactly or past: 94 AAC packets, 101 Opus packets.
  assert.equal(filmCheck(GRID, readMp4(film({ audio: 94 }))).frames, 48);
  assert.equal(filmCheck(OPUS, readMp4(film({ opus: { packets: celt(101) } }))).frames, 48);
});

test('the audio stand-ins emit as many packets as the Edge encoders do', async () => {
  const count = async (codec, frames) => {
    const { AudioEncoder, AudioData } = fakeCodecs();
    let n = 0;
    const encoder = new AudioEncoder({ output() { n++; }, error(e) { throw e; } });
    encoder.configure({ codec, sampleRate: 48000, numberOfChannels: 2 });
    for (let at = 0; at < frames; at += 4800) encoder.encode(new AudioData({ numberOfFrames: Math.min(4800, frames - at) }));
    await encoder.flush();
    return n;
  };
  // Edge 153's counts for 2, 6 and 7 s at 48 kHz: Opus packets cover its
  // 312-sample pre-skip as well as the input.
  const lengths = [96000, 288000, 336000];
  assert.deepEqual(await Promise.all(lengths.map((f) => count('opus', f))), [101, 301, 351]);
  assert.deepEqual(await Promise.all(lengths.map((f) => count('mp4a.40.2', f))), [94, 282, 329]);
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
  // A red frame, which this stand-in encoder reports as full-range sRGB; the film does not take its word.
  const { p, solved } = piece({ draw(g) { g.fillStyle = '#f00'; g.fillRect(0, 0, 64, 48); } });
  const { env: e, codecs, contexts } = env();
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

test('the encoder converts frames itself where both probes and every colour space it reports prove limited-range BT.709', async () => {
  // The piece fills in the colour it finds, then in translucent red.
  const found = [];
  const { p, solved } = piece({
    draw(g, s, t) { found.push(g.fillStyle); g.fillRect(0, 0, 64 * t + 2, 24); g.fillStyle = 'rgba(255,0,0,0.5)'; g.fillRect(0, 24, 64, 24); },
  });
  const { env: e, codecs } = env({ webgl: true, decode: true });
  const { bytes, report } = await exportFilm(p, solved, e);
  assert.equal(report.conversion, 'encoder');
  assert.deepEqual([...new Set(found)], ['#000'], 'the probes leave the canvas as they found it');
  const frames = codecs.log.frames;
  assert.ok(frames.every((f) => f.data.pixels && !f.format), 'every frame handed over as the WebGL2 copy, none converted');
  // A probe first, every frame one frame later than its own time, a probe last.
  const us = (i) => Math.round((i * 1e6) / 24);
  assert.deepEqual(frames.map((f) => f.timestamp), [0, ...Array.from({ length: 49 }, (_, i) => us(1) + us(i))]);
  const file = readMp4(bytes);
  assert.equal(file.tracks[0].samples, 48, 'the probes are left out of the film');
  assert.equal(file.tracks[0].reordered, false, 'and every frame is moved back to its own time');
  assert.equal(file.tracks[0].keys[0], 1);
});

test('an encoder that writes full range, changes range part-way or reports anything else gets its frames converted', async () => {
  const { p, solved } = piece();
  const run = async (options) => {
    const { env: e, codecs } = env({ webgl: true, decode: true, ...options });
    const { bytes, report } = await exportFilm(p, solved, e);
    const frames = codecs.log.frames;
    return {
      conversion: report.conversion, copied: frames.filter((f) => f.data.pixels).length,
      converted: frames.filter((f) => f.format === 'NV12' && JSON.stringify(f.colorSpace) === JSON.stringify(BT709)).length,
      samples: readMp4(bytes).tracks[0].samples,
    };
  };
  const converted = (copied) => ({ conversion: 'cpu', copied, converted: 48, samples: 48 });
  const said = (space) => ({ primaries: 'bt709', transfer: 'iec61966-2-1', matrix: 'bt709', fullRange: false, ...space });
  // The first probe decodes full range, so nothing past it is copied.
  assert.deepEqual(await run({ canvasRange: 'full' }), converted(1), 'full range throughout');
  assert.deepEqual(await run({ canvasRange: 'full', claims: said() }), converted(1), 'full range reported as limited');
  // Every configuration it reports must say limited-range BT.709.
  assert.deepEqual(await run({ claims: said({ fullRange: true }) }), converted(1), 'limited range reported as full');
  assert.deepEqual(await run({ claims: said({ matrix: 'smpte170m' }) }), converted(1), 'the BT.601 matrix reported');
  assert.deepEqual(await run({ claims: null }), converted(1), 'no colour space reported');
  assert.deepEqual(await run({ refuseCanvas: true }), converted(0), 'no frame made of the copy');
  // Full range from the probe and nine frames on: the new colour space it
  // reports stops the copy at once; unreported, the last probe finds it.
  assert.deepEqual(await run({ switchAt: 10 }), converted(11), 'a change it reports');
  assert.deepEqual(await run({ switchAt: 10, announce: false }), converted(50), 'a change it keeps quiet');
});

test('without a decoder or WebGL2 every frame is converted', async () => {
  const { p, solved } = piece();
  for (const options of [{ webgl: true }, { decode: true }]) {
    const { env: e, codecs } = env(options);
    const { report } = await exportFilm(p, solved, e);
    assert.equal(report.conversion, 'cpu');
    assert.ok(codecs.log.frames.every((f) => f.format === 'NV12'), JSON.stringify(options));
  }
});

test('a piece with sound gets a soundtrack exactly as long as its film, or no film at all', async () => {
  const { p, solved } = piece({ sound(ctx) { const o = ctx.createOscillator(); o.connect(ctx.destination); o.start(0); } });
  const { env: e, codecs } = env();
  const { bytes, report } = await exportFilm(p, solved, e);
  assert.equal(codecs.log.audioFrames, 2112 + 2 * 48000, 'the rendered soundtrack, exactly frames / hz long, after the AAC lead');
  const audio = readMp4(bytes).tracks.find((x) => x.kind === 'soun');
  assert.equal(audio.samples, Math.ceil((2112 + 2 * 48000) / 1024));
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
  assert.equal(audio.samples, Math.ceil((312 + 2 * 48000) / 960), 'packets covering the pre-skip and the soundtrack');
  assert.deepEqual(audio.opus, { version: 0, channels: 2, preSkip: 0, inputSampleRate: 48000, outputGain: 0, mappingFamily: 0 });
  assert.deepEqual(audio.edits, [{ duration: 48000, mediaTime: 312, rate: 1 }], "the encoder's pre-skip reaches the edit list");
  assert.equal(report.sound.codec, 'Opus');

  // An encoder shows it gives no OpusHead only once it encodes, alongside the frames.
  const blind = env({ aac: false, describe: false });
  await assert.rejects(exportFilm(p, solved, blind.env), /gave no OpusHead/);
  assert.ok(blind.codecs.log.frames.length < 48, 'refused before the film is finished');
});

test('an AAC soundtrack follows a 2112-sample silent lead, and its edit skips the lead and any priming the encoder reports', async () => {
  const { p, solved } = piece({ sound(ctx) { const o = ctx.createOscillator(); o.connect(ctx.destination); o.start(0); } });
  // What reaches the encoder, in order.
  const fed = [];
  const watched = (e) => {
    const Base = e.AudioEncoder;
    e.AudioEncoder = class extends Base {
      encode(data) { fed.push({ frames: data.numberOfFrames, at: data.timestamp, silent: data.data.every((v) => v === 0) }); super.encode(data); }
    };
    return e;
  };
  const plain = await exportFilm(p, solved, watched(env().env));
  assert.deepEqual(fed[0], { frames: 2112, at: 0, silent: true }, '2112 samples of silence first');
  assert.deepEqual(fed.slice(1, 3).map((f) => f.at), [44000, 144000], 'then the soundtrack, 44 ms in');
  assert.equal(fed.slice(1).reduce((n, f) => n + f.frames, 0), 2 * 48000, 'all of it');
  assert.deepEqual(readMp4(plain.bytes).tracks[1].edits, [{ duration: 48000, mediaTime: 2112, rate: 1 }], 'stamped at zero, as Edge stamps it: the edit skips the lead alone');

  // Opus primes itself and names it in its pre-skip: no lead.
  fed.length = 0;
  await exportFilm(p, solved, watched(env({ aac: false }).env));
  assert.deepEqual([fed[0].frames, fed[0].at], [4800, 0]);

  // This encoder primes 1024 samples before its input and says so, stamping its
  // first packet 1024 samples before zero.
  const early = env().env;
  const Base = early.AudioEncoder;
  early.AudioEncoder = class extends Base {
    constructor({ output, error }) { super({ output: (chunk, meta) => output({ ...chunk, timestamp: chunk.timestamp - 21333 }, meta), error }); }
    configure(config) { super.configure(config); this.held += 1024; }
  };
  const primed = await exportFilm(p, solved, early);
  assert.deepEqual(readMp4(primed.bytes).tracks[1].edits, [{ duration: 48000, mediaTime: 2112 + 1024, rate: 1 }]);
});

// A soundtrack made alongside the frames: an OfflineAudioContext whose render
// finishes after `frames` of the export's pauses, or at the next turn of the
// event loop, so nothing waits for ever; and encoders that log, in order, a `v`
// for each frame and an `a` for each piece of sound they are handed.
function paced(frames, options = {}) {
  const made = env(options);
  const order = [];
  const waiting = [];
  const { Context } = fakeAudio();
  const { VideoEncoder, AudioEncoder } = made.env;
  Object.assign(made.env, {
    OfflineAudioContext: class extends Context {
      startRendering() {
        const rendered = super.startRendering();
        return new Promise((resolve) => {
          const done = () => resolve(rendered);
          waiting.push({ left: frames, done });
          setTimeout(done, 0);
        });
      }
    },
    VideoEncoder: class extends VideoEncoder { encode(...args) { order.push('v'); return super.encode(...args); } },
    AudioEncoder: class extends AudioEncoder { encode(...args) { order.push('a'); return super.encode(...args); } },
    pause: async () => { for (const w of waiting) if (--w.left <= 0) w.done(); },
  });
  return { ...made, order };
}

const voiced = () => piece({ sound(ctx) { const o = ctx.createOscillator(); o.connect(ctx.destination); o.start(0); } });

test('a soundtrack made alongside the frames gives the same file whichever finishes first', async () => {
  const { p, solved } = voiced();
  const files = [];
  for (const frames of [0, 5, 1000]) files.push(Buffer.from((await exportFilm(p, solved, paced(frames).env)).bytes));
  assert.ok(files[1].equals(files[0]), 'the sound ready part-way through the frames');
  assert.ok(files[2].equals(files[0]), 'the sound ready only after the last frame');
});

test('the frames draw while the soundtrack renders and encodes, and do not wait for it', async () => {
  const { p, solved } = voiced();
  const { env: e, order } = paced(5);
  const { report } = await exportFilm(p, solved, e);
  const sound = order.indexOf('a');
  assert.ok(order.indexOf('v') < sound, 'the first frame is encoded before any sound');
  assert.ok(order.lastIndexOf('v') > sound, 'and frames are still encoded once the sound is');
  assert.equal(order.filter((x) => x === 'v').length, 48);
  assert.equal(report.sound.codec, 'mp4a');
});

test('a soundtrack that fails stops the frames and fails the export with its own message', async () => {
  const thrown = piece({ sound() { throw new Error('fixture soundtrack failed'); } });
  const early = env();
  await assert.rejects(exportFilm(thrown.p, thrown.solved, early.env), /fixture soundtrack failed/);
  assert.ok(early.codecs.log.frames.length < 48, `stopped after ${early.codecs.log.frames.length} of 48 frames`);
  // The render finishes at the fifth frame's pause, and only then can the
  // encoder show it gives no OpusHead.
  const { p, solved } = voiced();
  const late = paced(5, { aac: false, describe: false });
  await assert.rejects(exportFilm(p, solved, late.env), /gave no OpusHead/);
  assert.ok(late.codecs.log.frames.length < 48, `stopped after ${late.codecs.log.frames.length} of 48 frames`);
  // A soundtrack that fails after the last frame fails the export all the same.
  const last = paced(1000, { aac: false, describe: false });
  await assert.rejects(exportFilm(p, solved, last.env), /gave no OpusHead/);
});

// An encoder that returns nothing, and no error, for the frames `which(kind, n)`
// picks, where `kind` is 'canvas' or 'memory' and `n` counts the frames of that
// kind it was handed before. Chromium's Media Foundation encoder does this to a
// frame it is handed as a texture when it cannot take the texture's lock within
// 100 ms.
function withholding(which, options = {}) {
  const made = env(options);
  const { VideoEncoder } = made.env;
  const withheld = [];
  made.env.VideoEncoder = class extends VideoEncoder {
    constructor(init) {
      let drop = false;
      super({ ...init, output: (chunk, meta) => { if (drop) { drop = false; withheld.push(chunk.timestamp); } else init.output(chunk, meta); } });
      this.seen = { canvas: 0, memory: 0 };
      this.dropNext = () => { drop = true; };
    }

    encode(frame, opts) {
      const kind = frame.data && frame.data.pixels ? 'canvas' : 'memory';
      if (which(kind, this.seen[kind]++)) this.dropNext();
      return super.encode(frame, opts);
    }
  };
  return { ...made, withheld };
}

test('a film the encoder route returns frames short of is encoded again, converted, and keeps every frame', async () => {
  const { p, solved } = piece();
  // The encoder route's canvas frames are its first probe, the 48 frames and its last probe.
  const lossy = withholding((kind, n) => kind === 'canvas' && n >= 21 && n <= 23, { webgl: true, decode: true });
  const { bytes, report } = await exportFilm(p, solved, lossy.env);
  assert.equal(lossy.withheld.length, 3, 'the encoder route lost three frames');
  assert.equal(report.conversion, 'cpu');
  assert.equal(readMp4(bytes).tracks[0].samples, 48);
  const converted = await exportFilm(p, solved, env({ webgl: true }).env);
  assert.ok(Buffer.from(bytes).equals(Buffer.from(converted.bytes)), 'the same film the conversion writes on its own');
  // A film the encoder route returns whole keeps that route and its bytes.
  const whole = await exportFilm(p, solved, withholding(() => false, { webgl: true, decode: true }).env);
  const plain = await exportFilm(p, solved, env({ webgl: true, decode: true }).env);
  assert.equal(whole.report.conversion, 'encoder');
  assert.ok(Buffer.from(whole.bytes).equals(Buffer.from(plain.bytes)));
});

test('a film saved after the encoder route is discarded reports the times of the pass that made it', async () => {
  const { p, solved } = piece();
  const lossy = await exportFilm(p, solved, withholding((kind, n) => kind === 'canvas' && n >= 21 && n <= 23, { webgl: true, decode: true }).env);
  const converted = await exportFilm(p, solved, env({ webgl: true }).env);
  assert.equal(lossy.report.conversion, 'cpu');
  for (const k of ['drawMs', 'convertMs', 'encodeWaitMs']) {
    assert.ok(Number.isFinite(lossy.report[k]), k);
    assert.equal(lossy.report[k], converted.report[k], k);
  }
  // The stand-in clock moves 250 ms a reading: one reading between each frame's start and its drawing's end.
  assert.equal(lossy.report.drawMs, 48 * 250, 'the 48 frames of one pass');
});

test('a probe the encoder returns nothing for fails the encoder route, and no frame is decoded in its place', async () => {
  const { p, solved } = piece();
  // The encoder route's canvas frames: its first probe (0), the 48 frames, its last probe (49).
  for (const [probe, decoded] of [[0, 0], [49, 1]]) {
    const made = withholding((kind, n) => kind === 'canvas' && n === probe, { webgl: true, decode: true });
    const { VideoDecoder } = made.env;
    let decoders = 0;
    made.env.VideoDecoder = class extends VideoDecoder { constructor(init) { super(init); decoders++; } };
    const { bytes, report } = await exportFilm(p, solved, made.env);
    assert.equal(made.withheld.length, 1, `probe ${probe} withheld`);
    assert.equal(decoders, decoded, `probe ${probe}: only probes that came back are decoded`);
    assert.equal(report.conversion, 'cpu');
    assert.equal(readMp4(bytes).tracks[0].samples, 48);
  }
});

test('a film refused for its frame count names the route and the frames its encoder returned nothing for', async () => {
  const { p, solved } = piece();
  const lossy = withholding((kind, n) => kind === 'memory' && n >= 5 && n <= 8);
  await assert.rejects(exportFilm(p, solved, lossy.env),
    /^Error: film: the file holds 44 of 48 frames, from the cpu route; its encoder returned nothing for the frames at 208333 µs, 250000 µs, 291667 µs and 1 more\. Nothing was saved\.$/);
  assert.match(grab(() => filmCheck(GRID, readMp4(film({ frames: 47 })))).message, /^film: the file holds 47 of 48 frames\. Nothing was saved\.$/,
    'a check given no route or missing frames says only the count');
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

// ---------------------------------------------------------------------------
// Loudness to ITU-R BS.1770-4, against signals whose answers are known
// ---------------------------------------------------------------------------

const RATE = 48000;

/** Planar channels as the AudioBuffer shape the meter reads. */
const planar = (channels) => ({
  numberOfChannels: channels.length, sampleRate: RATE, length: channels[0].length, getChannelData: (c) => channels[c],
});

/** A sine of `hz` through [seconds, peak dBFS] parts, phase continuous. */
function tone(parts, hz = 997, phase = 0) {
  const x = new Float32Array(parts.reduce((n, [s]) => n + Math.round(s * RATE), 0));
  let i = 0;
  for (const [seconds, db] of parts) {
    const a = 10 ** (db / 20);
    for (const end = i + Math.round(seconds * RATE); i < end; i++) x[i] = a * Math.sin((2 * Math.PI * hz * i) / RATE + phase);
  }
  return x;
}

const stereo = (x) => planar([x, Float32Array.from(x)]);

test('loudness follows BS.1770-4: K-weighting, 400 ms blocks, and gates of power at -70 LUFS and 10 LU down', () => {
  // The standard tabulates both K-weighting stages at 48 kHz.
  const [shelf, pass] = kWeighting(RATE);
  const table = [[1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585],
    [1.0, -2.0, 1.0, -1.99004745483398, 0.99007225036621]];
  [shelf, pass].forEach((stage, k) => [...stage.b, ...stage.a].forEach((v, i) => assert.ok(Math.abs(v - table[k][i]) < 1e-12,
    `K-weighting stage ${k + 1} coefficient ${i} is ${v}, not ${table[k][i]}`)));

  // EBU Tech 3341's cases, a quarter as long, each within its 0.1 LU: a sine of
  // peak A in both channels reads 20 log10 A, and in one channel 3.01 LU less.
  const near = (got, want, what) => assert.ok(Math.abs(got - want) <= 0.1, `${what}: ${got.toFixed(3)} LUFS where ${want} is right`);
  near(measureLoudness(stereo(tone([[5, -23]]))).lufs, -23, 'a -23 dBFS stereo sine');
  near(measureLoudness(stereo(tone([[5, -33]]))).lufs, -33, 'a -33 dBFS stereo sine');
  near(measureLoudness(planar([tone([[5, -23]])])).lufs, -26.01, 'the same sine in one channel');
  near(measureLoudness(stereo(tone([[2.5, -36], [15, -23], [2.5, -36]]))).lufs, -23, 'quiet ends under the relative gate');
  near(measureLoudness(stereo(tone([[2.5, -72], [2.5, -36], [15, -23], [2.5, -36], [2.5, -72]]))).lufs, -23, 'and under the absolute gate');
  near(measureLoudness(stereo(tone([[5, -26], [5.025, -20], [5, -26]]))).lufs, -23, 'blocks averaged as power, not as decibels');

  // Below the absolute gate there is no loudness at all.
  assert.equal(measureLoudness(stereo(tone([[5, -75]]))).lufs, -Infinity, 'a -75 dBFS tone is silence to the gate');
  assert.equal(measureLoudness(stereo(new Float32Array(RATE))).lufs, -Infinity);
});

test('true peak finds the peaks between samples, oversampled four times as BS.1770-4 Annex 2 filters them', () => {
  // EBU Tech 3341 allows a true-peak meter +0.2 / -0.4 dB.
  const within = (got, want, what) => assert.ok(got - want <= 0.2 && want - got <= 0.4, `${what}: ${got.toFixed(3)} dBTP where ${want} is right`);
  // A quarter of the sample rate, 45 degrees off the samples: every sample sits
  // at 0.707 of the peak, 3 dB under it.
  const between = tone([[1, -6.02]], RATE / 4, Math.PI / 4);
  assert.ok(between.reduce((m, v) => Math.max(m, Math.abs(v)), 0) < 10 ** (-9 / 20), 'the samples miss the peak by 3 dB');
  within(measureLoudness(stereo(between)).dbtp, -6.02, 'a peak between samples');
  for (const hz of [997, 5000, 10000, 19000]) within(measureLoudness(stereo(tone([[1, -6.02]], hz, 0.3))).dbtp, -6.02, `a ${hz} Hz sine`);
  const broken = tone([[1, -20]]);
  broken[480] = NaN;
  assert.ok(Number.isNaN(measureLoudness(stereo(broken)).dbtp), 'a sample that is not a number has no true peak');
});

test('every film soundtrack reaches -14 LUFS with one static gain, or stops at its codec ceiling, -1 dBTP for AAC and -1.2 for Opus', async () => {
  // Contexts that render a known soundtrack, and an encoder that keeps what it
  // is given, so the film's own samples are measured, not the report's word.
  const exported = async (fill, codecs = {}) => {
    const { p, solved } = piece({ sound(ctx) { const o = ctx.createOscillator(); o.connect(ctx.destination); o.start(0); } });
    const { env: e } = env(codecs);
    const Base = e.OfflineAudioContext;
    let rendered = null;
    e.OfflineAudioContext = class extends Base {
      async startRendering() {
        const b = await super.startRendering();
        for (let c = 0; c < b.numberOfChannels; c++) fill(b.getChannelData(c));
        rendered = [0, 1].map((c) => Float32Array.from(b.getChannelData(c)));
        return b;
      }
    };
    const kept = [[], []];
    const Encoder = e.AudioEncoder;
    e.AudioEncoder = class extends Encoder {
      encode(data) {
        for (let c = 0; c < 2; c++) kept[c].push(data.data.slice(c * data.numberOfFrames, (c + 1) * data.numberOfFrames));
        super.encode(data);
      }
    };
    const out = await exportFilm(p, solved, e);
    // The AAC encoder hears 2112 samples of silence first, the lead the film's
    // edit list skips; the soundtrack is what follows them. Opus has no lead.
    const lead = out.report.sound.codec === 'Opus' ? 0 : 2112;
    const encoded = kept.map((parts) => Float32Array.from(parts.flatMap((part) => [...part])).subarray(lead));
    return { report: out.report, rendered, encoded };
  };

  // A quiet steady tone is raised to the target and keeps its shape.
  const quiet = await exported((x) => x.set(tone([[2, -30]])));
  assert.deepEqual([quiet.report.sound.measured.lufs, quiet.report.sound.gain, quiet.report.sound.lufs], [-30, 16, -14]);
  assert.ok(Math.abs(measureLoudness(planar(quiet.encoded)).lufs + 14) < 0.01, 'the encoded soundtrack measures -14 LUFS');
  const ratio = quiet.encoded[0][1000] / quiet.rendered[0][1000];
  assert.ok(Math.abs(20 * Math.log10(ratio) - 16) < 1e-4, 'by the 16 dB it reports');
  let spread = 0;
  quiet.encoded.forEach((x, c) => x.forEach((v, i) => {
    if (Math.abs(quiet.rendered[c][i]) > 1e-3) spread = Math.max(spread, Math.abs(v / quiet.rendered[c][i] - ratio));
  }));
  assert.ok(spread < 1e-5, `one gain for every sample, and some differ from it by ${spread}`);

  // A quiet tone with loud clicks would pass -1 dBTP long before -14 LUFS: the
  // gain stops at the ceiling.
  const peaky = await exported((x) => { x.set(tone([[2, -40]])); for (let i = 0; i < x.length; i += 12000) x[i] = 0.9; });
  const { measured, gain, lufs, dbtp } = peaky.report.sound;
  assert.ok(Math.abs(gain - (-1 - measured.dbtp)) <= 0.011, `the gain ${gain} is the room left under -1 dBTP`);
  assert.ok(Math.abs(measureLoudness(planar(peaky.encoded)).dbtp + 1) < 0.01 && Math.abs(dbtp + 1) < 0.005, 'and the soundtrack peaks at -1 dBTP');
  assert.ok(lufs < -14, `short of -14 LUFS at ${lufs}`);

  // More than 3 LU under the target, the report says by how many; a soundtrack
  // at the target, or stopped within 3 LU of it by softer clicks, says nothing.
  assert.ok(lufs < -17 && peaky.report.sound.short === Math.round((-14 - lufs) * 100) / 100,
    `${lufs} LUFS is ${-14 - lufs} LU short, and the report says ${peaky.report.sound.short}`);
  assert.equal(quiet.report.sound.short, undefined, 'a soundtrack at -14 LUFS reports no shortfall');
  const near = (await exported((x) => { x.set(tone([[2, -30]])); for (let i = 0; i < x.length; i += 12000) x[i] = 0.18; })).report.sound;
  assert.ok(near.lufs < -14 && near.lufs > -17 && near.short === undefined, `${near.lufs} LUFS reports a shortfall of ${near.short}`);

  // Opus raises true peak more than AAC once encoded, so the same clicks stop
  // an Opus soundtrack 0.2 dB lower. Its body still aims at -14 LUFS, and its
  // shortfall is still measured from -14 LUFS.
  const opus = await exported((x) => { x.set(tone([[2, -40]])); for (let i = 0; i < x.length; i += 12000) x[i] = 0.9; }, { aac: false });
  const heard = opus.report.sound;
  assert.equal(heard.codec, 'Opus');
  assert.ok(Math.abs(heard.gain - (-1.2 - heard.measured.dbtp)) <= 0.011 && Math.abs(heard.gain - (gain - 0.2)) <= 0.011,
    `the gain ${heard.gain} is the room left under -1.2 dBTP, 0.2 dB under AAC's ${gain}`);
  assert.ok(Math.abs(measureLoudness(planar(opus.encoded)).dbtp + 1.2) < 0.01 && Math.abs(heard.dbtp + 1.2) < 0.005, 'and the soundtrack peaks at -1.2 dBTP');
  assert.ok(heard.short === Math.round((-14 - heard.lufs) * 100) / 100 && Math.abs(heard.short - (peaky.report.sound.short + 0.2)) <= 0.011,
    `${heard.lufs} LUFS is ${-14 - heard.lufs} LU short, and the report says ${heard.short}`);
  const steady = (await exported((x) => x.set(tone([[2, -30]])), { aac: false })).report.sound;
  assert.deepEqual([steady.gain, steady.lufs, steady.short], [16, -14, undefined], 'a soundtrack its peaks do not stop reaches -14 LUFS as Opus too');
  assert.throws(() => loudnessGain({ lufs: -20, dbtp: -10 }, 'opus'), /levelled for AAC \('mp4a'\) or 'Opus', not "opus"/, 'a codec by another name is refused');

  // Silence has no loudness to set, nor any shortfall. A sample that is not a
  // finite number is refused wherever it falls: an infinite one early would
  // otherwise read as silence and be encoded, and one later would give a gain
  // of -Infinity.
  const silent = await exported(() => {});
  assert.deepEqual([silent.report.sound.gain, silent.report.sound.lufs, silent.report.sound.short], [0, null, undefined]);
  for (const bad of [NaN, Infinity, -Infinity]) {
    for (const at of [7, 90000]) {
      await assert.rejects(exported((x) => { x.set(tone([[2, -30]])); x[at] = bad; }), /not finite numbers/, `${bad} at sample ${at}`);
    }
  }
});
