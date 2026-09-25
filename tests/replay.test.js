'use strict';

// Replaying a saved file from the recipe it carries: the manifest read back,
// the piece found and checked, and the file compared with a fresh drawing. An
// SVG round trip runs whole here. A PNG's pixels and a film's frames are
// compared in installed Edge by `npm run replay`; here their manifests, scale,
// size, frame grid, seek times and verdict rules are checked.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const { renderVector, playheads } = require('../core/render.js');
const { exportFilm, muxMp4 } = require('../core/film.js');
const { solve, atBox } = require('../core/piece.js');
const { nullSurface } = require('../tools/bench.js');
const { callerDirectory, loadExternal } = require('../tools/piece-input.js');
const { pngWithManifest, webmWithDuration, webmWithManifest } = require('../tools/build-page.js');
const {
  fileType, manifestOf, pieceFor, filmPlan, filmFrames, replayVerdict, replay, parseArgs, main, FILM_FLOOR_DB,
  soundPlan, compareSound, soundVerdict, SOUND_BLOCK, SOUND_FLOOR_DB, SOUND_GATE_DB, SOUND_BAND, SOUND_FLATNESS, SOUND_NOISE_DB,
  pngPlan, pngVerdict, webmPlan, PNG_FLOOR_DB, compareFilm, comparePng, compareWebm, sendBytes, PIECE_BYTES,
} = require('../tools/replay.js');
const { fakeAudio, fakeCodecs, fakeCanvas, EDGE_AVCC } = require('./fake-media.js');
const EXAMPLES = require('../examples/index.js');

const ROOT = path.resolve(__dirname, '..');

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-replay-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** An SVG with its manifest replaced, escaped as the vector surface writes it. */
const withManifest = (svg, m) => svg.replace(/(<metadata id="artifex-manifest">)[^<]*(<\/metadata>)/,
  (_, open, close) => open + JSON.stringify(m).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]) + close);

/** A small external piece with a timeline, written as a module in `dir`. */
function fixturePiece(dir, name = 'replay-fixture') {
  const file = path.join(dir, name + '.cjs');
  fs.writeFileSync(file, `module.exports = {
  name: ${JSON.stringify(name)}, size: { w: 32, h: 24 }, seed: 5, outputs: ['raster', 'vector'],
  time: { duration: 1, hz: 12 },
  draw(g, s, t) { g.fillStyle = '#123456'; g.fillRect(0, 0, 32 * t + 1, 24); },
};\n`);
  return file;
}

/** A w x h RGBA PNG of transparent pixels, built with Node's zlib. */
function png(w, h) {
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    data.copy(out, 8);
    out.writeUInt32BE(zlib.crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.alloc((w * 4 + 1) * h))), chunk('IEND', Buffer.alloc(0))]));
}

/**
 * A WebM in the live shape Edge's recorder writes, w x h, with one block at
 * each of `times` (milliseconds) in a Cluster of unknown size.
 */
function webm(times, w = 32, h = 24) {
  const el = (id, body) => [...id, 0x80 | body.length, ...body];
  const u16 = (v) => [v >> 8, v & 255];
  const video = el([0xe0], [...el([0xb0], u16(w)), ...el([0xba], u16(h))]);
  const tracks = el([0x16, 0x54, 0xae, 0x6b], el([0xae], [...el([0xd7], [1]), ...el([0x86], [...Buffer.from('V_VP8')]), ...video]));
  const info = el([0x15, 0x49, 0xa9, 0x66], [0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40, 0x44, 0x89, 0x84, 0x3f, 0x80, 0, 0]);
  const blocks = times.flatMap((t) => [0xa3, 0x85, 0x81, ...u16(t), 0x80, 0]);
  return Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x83, 0xa3, 0xa3, 0xa3, 0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    ...info, ...tracks, 0x1f, 0x43, 0xb6, 0x75, 0xff, 0xe7, 0x81, 0, ...blocks]);
}

/** The film exportFilm makes of `piece` against stand-in encoders; `codecs` passes their options. */
async function filmOf(piece, options = {}) {
  const codecs = fakeCodecs(options);
  let clock = 0;
  const env = {
    VideoEncoder: codecs.VideoEncoder, VideoFrame: codecs.VideoFrame, AudioEncoder: codecs.AudioEncoder, AudioData: codecs.AudioData,
    OfflineAudioContext: fakeAudio().Context,
    createCanvas: (w, h) => fakeCanvas({ width: w, height: h }, nullSurface),
    now: () => (clock += 1), pause: async () => {},
  };
  const { solve } = require('../core/piece.js');
  return (await exportFilm(piece, solve(piece, piece.seed), env)).bytes;
}

test('an SVG replays byte for byte from the manifest it carries', async (t) => {
  const dir = scratch(t);
  for (const [name, opt] of [['inversion', {}], ['readout', { seed: 7, t: 0.37 }]]) {
    const file = path.join(dir, name + '.svg');
    fs.writeFileSync(file, renderVector(EXAMPLES[name], opt).svg);
    const result = await replay(file);
    assert.equal(result.type, 'svg');
    assert.equal(result.match, true, result.detail);
    assert.match(result.detail, /identical to the replay/);
  }
});

test('an SVG whose drawing or recipe differs is named by its first differing byte', async (t) => {
  const dir = scratch(t);
  const { svg, manifest } = renderVector(EXAMPLES.readout, { seed: 7, t: 0.37 });
  const drawn = path.join(dir, 'drawn.svg');
  const at = svg.indexOf(' d="M') + 5;
  fs.writeFileSync(drawn, svg.slice(0, at) + (svg[at] === '1' ? '2' : '1') + svg.slice(at + 1));
  const redrawn = await replay(drawn);
  assert.equal(redrawn.match, false);
  assert.match(redrawn.detail, new RegExp(`^byte ${at} of ${svg.length} differs: the file has`));
  const seeded = path.join(dir, 'seeded.svg');
  fs.writeFileSync(seeded, withManifest(svg, { ...manifest, seed: 8 }));
  assert.equal((await replay(seeded)).match, false, 'another seed draws another SVG');
});

test('a file made by another version, for another piece, box or outputs is refused, never compared', async (t) => {
  const dir = scratch(t);
  const { svg, manifest } = renderVector(EXAMPLES.inversion);
  const saved = (m) => { const file = path.join(dir, 'x.svg'); fs.writeFileSync(file, withManifest(svg, m)); return file; };
  await assert.rejects(replay(saved({ ...manifest, artifex: '0.0.1' })), /the file was made by artifex "0\.0\.1" and this is 0\.1\.0/);
  await assert.rejects(replay(saved({ ...manifest, piece: 'nope' })), /no registered example is named "nope"; pass its module with --piece/);
  // Looked up as an own property: a name every object inherits is no example.
  await assert.rejects(replay(saved({ ...manifest, piece: 'toString' })), /no registered example is named "toString"/);
  await assert.rejects(replay(saved({ ...manifest, size: { w: 1, h: 1 } })), /drawn at \{"w":1,"h":1\} and inversion now draws at/);
  await assert.rejects(replay(saved({ ...manifest, outputs: ['raster'] })), /names outputs \["raster"\] and inversion now declares/);
  const other = fixturePiece(dir, 'other-piece');
  await assert.rejects(replay(saved(manifest), { piece: other }), /names piece "inversion" and .*other-piece\.cjs is "other-piece"/);
});

test('a manifest never names the module that runs: a path in it is refused, not loaded', async (t) => {
  const dir = scratch(t);
  const evil = path.join(dir, 'evil.cjs');
  fs.writeFileSync(evil, "globalThis.__replayLoaded = true;\nmodule.exports = { name: 'evil', size: { w: 10, h: 10 }, draw() {} };\n");
  const { svg, manifest } = renderVector(EXAMPLES.inversion);
  const file = path.join(dir, 'named.svg');
  fs.writeFileSync(file, withManifest(svg, { ...manifest, piece: evil }));
  await assert.rejects(replay(file), /no registered example is named ".*evil\.cjs"; pass its module with --piece/);
  assert.equal(globalThis.__replayLoaded, undefined, 'the module the file names never ran');
});

test('a film is checked against its frame grid, size and frame count before any browser starts', async (t) => {
  const dir = scratch(t);
  const modulePath = fixturePiece(dir);
  const { piece } = loadExternal(modulePath, dir);
  const bytes = await filmOf(piece);
  const { type, manifest } = manifestOf(bytes);
  assert.equal(type, 'mp4');
  assert.deepEqual(manifest.film, { frames: 12, hz: 12, loop: false, scale: 1 });
  assert.equal(pieceFor(manifest, modulePath, dir).piece.name, 'replay-fixture');
  assert.deepEqual(filmPlan(bytes, manifest, piece), Array.from({ length: 12 }, (_, i) => i), 'every frame of a short film');
  const grid = (film) => ({ ...manifest, film: { ...manifest.film, ...film } });
  assert.throws(() => filmPlan(bytes, grid({ frames: 13 }), piece), /the film's frame grid has frames 13 and replay-fixture now has 12/);
  assert.throws(() => filmPlan(bytes, grid({ hz: 24 }), piece), /frame grid has hz 24 and replay-fixture now has 12/);
  assert.throws(() => filmPlan(bytes, grid({ loop: true }), piece), /frame grid has loop true and replay-fixture now has false/);
  assert.throws(() => filmPlan(bytes, grid({ scale: 2 }), piece), /the film is 32 x 24 and replay-fixture at scale 2 draws 64 x 48/);
  assert.throws(() => filmPlan(bytes, manifest, { ...piece, time: null }), /the file is a film and replay-fixture is now a still/);
  const short = muxMp4({
    manifest, video: { width: 32, height: 24, timescale: 12000, delta: 1000, avcC: EDGE_AVCC, samples: Array.from({ length: 11 }, (_, i) => ({ data: Uint8Array.of(i, 1, 2, 3), key: i === 0 })) },
  });
  assert.throws(() => filmPlan(short, manifest, piece), /the film holds 11 of the 12 frames its manifest names/);
});

test('a piece that declares boxes replays at the box its file names, and refuses a box it does not accept', async (t) => {
  const dir = scratch(t);
  const narrow = atBox(validate(EXAMPLES.refit), { w: 405, h: 720 });
  const { svg, manifest } = renderVector(narrow, { t: 0.5 });
  const file = path.join(dir, 'narrow.svg');
  fs.writeFileSync(file, svg);
  const result = await replay(file);
  assert.equal(result.match, true, result.detail);
  assert.deepEqual(pieceFor(manifest).piece.size, { w: 405, h: 720 });
  fs.writeFileSync(file, withManifest(svg, { ...manifest, size: { w: 100, h: 720 } }));
  await assert.rejects(replay(file), /drawn at \{"w":100,"h":720\} and refit cannot draw at 100 x 720: w 100 is outside the declared \[240, 1920\]/);
  // A film records its box too, and its frame size is checked against that box.
  const bytes = await filmOf(narrow);
  const film = manifestOf(bytes).manifest;
  assert.deepEqual(film.size, { w: 405, h: 720 });
  assert.equal(filmPlan(bytes, film, pieceFor(film).piece).length, 24);
});

test('the page redraws a responsive film, its soundtrack, a PNG or a WebM at the box its recipe records', async () => {
  // Each page function is stopped at its solve, which is handed the piece it will draw.
  const vm = require('node:vm');
  const core = require('../core/piece.js');
  for (const f of [compareFilm, compareSound, comparePng, compareWebm]) {
    const solvedAt = [];
    const piece = { validate: core.validate, atBox: core.atBox, solve: (p) => { solvedAt.push({ ...p.size }); throw new Error('stopped at the solve'); } };
    const window = { __artifex: { examples: { refit: EXAMPLES.refit }, piece } };
    const recipe = { piece: 'refit', seed: 5, params: {}, size: { w: 405, h: 720 }, film: { scale: 1 } };
    await assert.rejects(vm.runInNewContext(`(${f})(new Uint8Array(0), ${JSON.stringify(recipe)}, [], [])`, { window }), /stopped at the solve/, f.name);
    assert.deepEqual(solvedAt, [{ w: 405, h: 720 }], f.name + ' draws at the recorded box');
  }
});

test('a long film is compared at 24 frames spread evenly, first and last included', () => {
  const frames = filmFrames(240);
  assert.equal(frames.length, 24);
  assert.deepEqual([frames[0], frames[23]], [0, 239]);
  assert.ok(frames.every((f, i) => i === 0 || f > frames[i - 1]));
  assert.deepEqual(filmFrames(3), [0, 1, 2]);
});

test('a film matches only where every compared frame is within the floor of its redraw and closest to its own', () => {
  const row = (frame, psnr, ...neighbours) => ({ frame, psnr, neighbours: neighbours.map(([f, p]) => ({ frame: f, psnr: p })) });
  assert.equal(FILM_FLOOR_DB, 30);
  const good = [row(0, 45, [1, 40]), row(1, 44, [0, 39], [2, 38]), row(2, 50, [1, 50])];
  assert.deepEqual(replayVerdict(good), { match: true, detail: '3 frames each within 30 dB of their redraw (worst 44 dB) and closest to their own' },
    'a held frame ties with its identical neighbour');
  assert.deepEqual(replayVerdict([row(0, 45), row(3, 29.99, [2, 20])]),
    { match: false, detail: 'frame 3 decodes at 29.99 dB from its redraw, under the 30 dB floor' });
  assert.deepEqual(replayVerdict([row(5, 40, [4, 30], [6, 41])]),
    { match: false, detail: 'frame 5 looks more like frame 6 (41 dB) than itself (40 dB)' });
});

// ---- the soundtrack -------------------------------------------------------

const { validate } = require('../core/piece.js');
const { measureLoudness, loudnessGain, normalizeLoudness } = require('../core/film.js');

/** An AudioBuffer stand-in at 48 kHz holding `channels`, Float32Arrays. */
const audio = (channels) => ({ numberOfChannels: channels.length, length: channels[0].length, sampleRate: 48000, duration: channels[0].length / 48000, getChannelData: (c) => channels[c] });
/** Two channels of `n` samples, each `f(i, c)`. */
const signal = (n, f) => [0, 1].map((c) => Float32Array.from({ length: n }, (_, i) => f(i, c)));
const tone = (n, level = 0.2) => signal(n, (i, c) => level * Math.sin((2 * Math.PI * (440 + 110 * c) * i) / 48000));

/**
 * compareSound as the page runs it, from its source text alone, with the page's
 * loudness meter and gain: the piece renders `rendered` and the film decodes
 * to `decoded`, or fails to decode, from a soundtrack in `codec`.
 */
async function soundInPage({ rendered, decoded }, codec = 'mp4a') {
  const vm = require('node:vm');
  const p = validate({ name: 'tone', size: { w: 8, h: 8 }, time: { duration: 1, hz: 10 }, sound() {}, draw() {} });
  class OfflineAudioContext {
    constructor(channels, length, sampleRate) { Object.assign(this, { channels, length, sampleRate, destination: {} }); }
    startRendering() { return Promise.resolve(audio(rendered.map((x) => x.slice()))); }
    decodeAudioData() { return decoded ? Promise.resolve(audio(decoded)) : Promise.reject(new Error('Unable to decode audio data')); }
  }
  const window = { __artifex: { piece: require('../core/piece.js'), render: require('../core/render.js'), examples: { tone: p }, loudness: measureLoudness, loudnessGain } };
  const recipe = { ...solve(p, p.seed).manifest, film: { frames: 10, hz: 10, loop: false, scale: 1 } };
  const run = `(${compareSound})(new Uint8Array(${JSON.stringify([...Buffer.from('film')])}), ${JSON.stringify(recipe)}, ${SOUND_BLOCK}, ${JSON.stringify(codec)}, ${SOUND_BAND}, ${SOUND_FLATNESS})`;
  return vm.runInNewContext(run, { window, OfflineAudioContext, atob });
}

const comparedInPage = async (films) => soundVerdict(await soundInPage(films), 'mp4a');

test('replay levels a soundtrack with the gain the export applies', async () => {
  const click = signal(48000, (i) => (i === 24000 ? 0.9 : 0.001 * Math.sin(i / 7)));
  for (const [what, rendered] of [['a steady tone reaches -14 LUFS', tone(48000)], ['a click stops at its codec ceiling', click], ['silence keeps its level', signal(48000, () => 0)]]) {
    for (const codec of ['mp4a', 'Opus']) {
      const { gain } = await soundInPage({ rendered, decoded: rendered }, codec);
      assert.equal(Math.round(gain * 100) / 100, normalizeLoudness(audio(rendered.map((x) => x.slice())), codec).gain, `${what}, ${codec}`);
    }
  }
  // Opus stops a click 0.2 dB under AAC, so replay must level for the film's codec.
  const [aac, opus] = await Promise.all(['mp4a', 'Opus'].map((codec) => soundInPage({ rendered: click, decoded: click }, codec)));
  assert.ok(Math.abs(aac.gain - opus.gain - 0.2) < 1e-9, `AAC ${aac.gain} dB and Opus ${opus.gain} dB`);
});

test('a film soundtrack matches only where it decodes to its recipe, levelled as the export levels it', async () => {
  const rendered = tone(48000);
  const scale = 10 ** (loudnessGain(measureLoudness(audio(rendered)), 'mp4a') / 20);
  const heard = rendered.map((x) => x.map((v) => v * scale));
  const same = await comparedInPage({ rendered, decoded: heard });
  assert.equal(same.match, true, same.detail);
  assert.match(same.detail, /^the AAC soundtrack decodes to its recipe's 48000 samples, every block within 25 dB of the render/);
  assert.equal((await comparedInPage({ rendered, decoded: rendered })).match, false, 'a soundtrack the export never levelled differs');
  const changed = heard.map((x) => x.map((v, i) => (i >= 24576 && i < 25600 ? v * 0.5 : v)));
  assert.deepEqual(await comparedInPage({ rendered, decoded: changed }), {
    match: false, detail: 'the soundtrack differs from its recipe at 0.512 s: that block decodes 6.0 dB from the render, under the 25 dB floor for AAC',
  }, 'one changed block is named by its time');
  assert.deepEqual(await comparedInPage({ rendered, decoded: heard.map((x) => x.subarray(0, 47000)) }),
    { match: false, detail: 'the soundtrack decodes to 47000 samples and its recipe renders 48000' }, 'a cut soundtrack');
  assert.deepEqual(await comparedInPage({ rendered, decoded: [heard[0]] }),
    { match: false, detail: 'the soundtrack decodes to 1 channels and its recipe renders 2' });
  assert.deepEqual(await comparedInPage({ rendered, decoded: null }), { match: false, detail: 'the soundtrack does not decode: Unable to decode audio data' });
});

/** `n` samples of seeded white noise in [-1, 1). */
function whiteNoise(n, seed) {
  let a = seed >>> 0;
  return Float32Array.from({ length: n }, () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 2 ** 31 - 1; });
}

/** `x` through the cookbook band-pass biquad at `hz`, quality `q`, at 48 kHz. */
function bandPass(x, hz, q) {
  const w = (2 * Math.PI * hz) / 48000, alpha = Math.sin(w) / (2 * q), a0 = 1 + alpha;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return x.map((v) => {
    const y = (alpha * v - alpha * x2 + 2 * Math.cos(w) * y1 - (1 - alpha) * y2) / a0;
    [x2, x1, y2, y1] = [x1, v, y1, y];
    return y;
  });
}

/**
 * One second of a tone under two noise voices, `low` band-passed at 2 kHz and
 * `high` at 8 kHz, each { seed, hz, level }, or null for a missing voice; each
 * channel draws its own noise. `filmOfNoise` is that soundtrack as the export
 * levels it and a perceptual codec keeps it: each voice's waveform only 10 dB
 * under it, as another noise in the same band adds, and its level nearly whole.
 */
function noiseSoundtrack({ toneHz = 440, low = {}, high = {} } = {}) {
  const voices = [low && { seed: 1, hz: 2000, level: 1, ...low }, high && { seed: 3, hz: 8000, level: 1, ...high }].filter(Boolean);
  const voice = (v, c, seed = v.seed) => bandPass(whiteNoise(48000, seed * 2 + c), v.hz, 1.5).map((x) => v.level * x);
  const sound = (coded) => [0, 1].map((c) => {
    const noise = voices.map((v) => voice(v, c));
    const error = coded ? voices.map((v) => voice(v, c, v.seed + 50).map((x) => x * 10 ** (-10 / 20))) : [];
    return Float32Array.from({ length: 48000 }, (_, i) => 0.05 * Math.sin((2 * Math.PI * (toneHz + 110 * c) * i) / 48000)
      + [...noise, ...error].reduce((s, x) => s + x[i], 0));
  });
  return { sound: sound(false), coded: sound(true) };
}

function filmOfNoise(options) {
  const { sound, coded } = noiseSoundtrack(options);
  const scale = 10 ** (loudnessGain(measureLoudness(audio(sound)), 'mp4a') / 20);
  return coded.map((x) => x.map((v) => v * scale));
}

test('a noise voice replays by what a perceptual codec keeps of it, and a different one still differs', async () => {
  const rendered = noiseSoundtrack().sound;
  const own = await soundInPage({ rendered, decoded: filmOfNoise() });
  const [noise, total] = own.blocks.reduce(([n, s], b) => [n + b[2], s + b[0]], [0, 0]);
  assert.ok(noise > 0.9 * total, `the noise voices are noise-like bands: ${noise / total} of the energy`);
  for (const codec of ['mp4a', 'Opus']) {
    const heard = soundVerdict(own, codec);
    assert.equal(heard.match, true, heard.detail);
    assert.match(heard.detail, /in its noise-like bands, within 3 dB of its waveform and 18 dB of its levels \(47 blocks, worst /);
  }
  const waveOnly = own.blocks.map(([signal, error]) => 10 * Math.log10(signal / error));
  assert.ok(Math.max(...waveOnly) < 15, `every block misses the waveform floor: ${Math.max(...waveOnly).toFixed(1)} dB at best`);

  // A chord keeps its waveform floor: through a Hann window its partials stand
  // out, where unwindowed leakage would fill the bands between them.
  const chord = signal(48000, (i, c) => Array.from({ length: 12 }, (_, k) => (0.1 / (k + 1)) * Math.sin((2 * Math.PI * (220 + 55 * c) * (k + 1) * i) / 48000 + k))
    .reduce((s, v) => s + v, 0));
  const [chordNoise, chordTotal] = (await soundInPage({ rendered: chord, decoded: chord })).blocks.reduce(([n, s], b) => [n + b[2], s + b[0]], [0, 0]);
  assert.ok(chordNoise < 0.01 * chordTotal, `a chord is not noise-like: ${chordNoise / chordTotal} of its energy`);

  for (const [what, options] of [['a tone moved from 440 to 466 Hz', { toneHz: 466 }], ['another noise', { low: { seed: 7 } }], ['a missing voice', { low: null }],
    ['a voice in another band', { high: { hz: 5000 } }], ['a voice 6 dB louder', { high: { level: 2 } }], ['a voice 6 dB quieter', { high: { level: 0.5 } }]]) {
    for (const codec of ['mp4a', 'Opus']) {
      const heard = soundVerdict(await soundInPage({ rendered, decoded: filmOfNoise(options) }, codec), codec);
      assert.equal(heard.match, false, `${what}, ${codec}: ${heard.detail}`);
      assert.match(heard.detail, /^the soundtrack differs from its recipe at \d+\.\d{3} s: /);
    }
  }
});

test('a block under its floor matches only where the rest keeps it and its noise-like bands keep their waveform and levels', () => {
  assert.equal(SOUND_BAND, 16);
  assert.equal(SOUND_FLATNESS, 0.4);
  assert.deepEqual(SOUND_NOISE_DB, { waveform: 3, envelope: 18 });
  const at = (...blocks) => ({ rate: 48000, block: SOUND_BLOCK, channels: [2, 2], length: [SOUND_BLOCK * blocks.length, SOUND_BLOCK * blocks.length], blocks });
  // A block of energy 1 whose noise-like bands hold `noise` of it: the error
  // outside them `rest` dB under the block, and inside them `wave` dB under
  // their energy, with their levels `level` dB from the render's.
  const noisy = ({ noise = 0.9, rest = 30, wave = 10, level = 25 } = {}) => {
    const inside = noise * 10 ** (-wave / 10);
    return [1, 10 ** (-rest / 10) + inside, noise, inside, noise * 10 ** (-level / 10)];
  };
  const differs = 'the soundtrack differs from its recipe at 0.000 s: that block decodes 10.4 dB from the render, under the 25 dB floor for AAC';
  assert.deepEqual(soundVerdict(at(noisy()), 'mp4a'), { match: true, detail: 'the AAC soundtrack decodes to its recipe\'s 1024 samples, every block within 25 dB of the render'
    + ' or, in its noise-like bands, within 3 dB of its waveform and 18 dB of its levels (1 blocks, worst 10.0 and 25.0 dB)' });
  assert.deepEqual(soundVerdict(at(noisy({ rest: 24.9 })), 'mp4a'), { match: false, detail: differs.replace('10.4', '10.3') }, 'the rest of the block keeps the codec floor');
  assert.equal(soundVerdict(at(noisy({ rest: 15.1 })), 'Opus').match, true, 'the Opus floor for the rest of an Opus block');
  assert.deepEqual(soundVerdict(at(noisy({ wave: 2.9 })), 'mp4a'),
    { match: false, detail: 'the soundtrack differs from its recipe at 0.000 s: that block decodes 3.3 dB from the render, under the 25 dB floor for AAC, and its noise-like bands follow the render\'s waveform at 2.9 dB, under 3 dB' });
  assert.deepEqual(soundVerdict(at(noisy({ level: 17.9 })), 'mp4a'),
    { match: false, detail: `${differs}, and its noise-like bands keep the render's levels at 17.9 dB, under 18 dB` });
  assert.deepEqual(soundVerdict(at([1, 0.091, 0, 0, 0]), 'mp4a'), { match: false, detail: differs }, 'a block without noise-like bands keeps the floor');
  // All the error in noise-like bands, the rest a rounding under zero.
  assert.equal(soundVerdict(at([1, 0.09, 0.9, 0.09 * (1 + 1e-12), 0]), 'mp4a').match, true);
  const plain = [100, 0.1];
  assert.match(soundVerdict(at(plain, noisy()), 'mp4a').detail, /every block within 25 dB of the render \(worst 30\.0 dB\) or, in its noise-like bands, .* \(1 blocks, worst 10\.0 and 25\.0 dB\)$/);
});

/**
 * A page for sendBytes: `run` evaluates each message in a context of its own
 * and refuses any message longer than `limit` characters, as Edge closes the
 * connection at 100 MB; `skip` pieces are received and then lost.
 */
function pageFor(limit, skip = null) {
  const vm = require('node:vm');
  const page = vm.createContext({ window: {}, atob });
  const sent = [];
  const run = async (client, expression) => {
    if (expression.length > limit) throw new Error('browser: CDP connection closed (1006: no reason)');
    sent.push(expression.length);
    return skip !== null && sent.length - 2 === skip ? 0 : vm.runInContext(expression, page);
  };
  return { page, sent, run };
}

test('a file too large for one message reaches the page whole, one piece per message', async () => {
  // Every piece encodes on its own and stays well under the 96 MB Edge takes.
  assert.equal(PIECE_BYTES % 3, 0);
  assert.ok((PIECE_BYTES / 3) * 4 < 96e6);
  const bytes = new Uint8Array(5 * 1024 * 1024 + 7).map((_, i) => (i * 131 + (i >> 9)) & 255);
  const limit = 3 * 1024 * 1024;
  assert.ok(Buffer.from(bytes).toString('base64').length > limit, 'the whole file is past one message');
  const { page, sent, run } = pageFor(limit);
  await sendBytes(null, bytes, run, 1536 * 1024);
  assert.ok(Buffer.from(page.window.__replayBytes).equals(Buffer.from(bytes)), 'the page holds every byte, in order');
  assert.equal(sent.length, 1 + 4, 'the array, then four pieces');
  const lost = pageFor(limit, 2);
  await assert.rejects(sendBytes(null, bytes, lost.run, 1536 * 1024), /^Error: replay: the page received 3670023 of the file's 5242887 bytes$/);
});

test('every page function refuses a piece name that is not its own the same way', async () => {
  const vm = require('node:vm');
  const window = { __artifex: { examples: Object.assign(Object.create({ inherited: {} }), { tone: {} }), piece: require('../core/piece.js') } };
  for (const f of [compareFilm, compareSound, comparePng, compareWebm]) {
    for (const name of ['constructor', 'inherited', 'missing']) {
      await assert.rejects(vm.runInNewContext(`(${f})(new Uint8Array(0), ${JSON.stringify({ piece: name })}, [], [])`, { window }),
        (e) => e.message === 'replay: the page has no piece named ' + JSON.stringify(name), f.name + ' refuses ' + name);
    }
  }
});

test('a soundtrack block is judged against its codec floor unless the difference is under the gate', () => {
  assert.deepEqual(SOUND_FLOOR_DB, { mp4a: 25, Opus: 15 });
  assert.equal(SOUND_GATE_DB, -60);
  const n = SOUND_BLOCK * 2;
  // Per block: the rendered energy and the difference's, over both channels.
  const at = (...blocks) => ({ rate: 48000, block: SOUND_BLOCK, channels: [2, 2], length: [SOUND_BLOCK * blocks.length, SOUND_BLOCK * blocks.length], blocks });
  const db = (snr, error) => [error * 10 ** (snr / 10), error];
  const loud = n * 10 ** (-40 / 10);
  assert.equal(soundVerdict(at(db(30, loud), db(20, loud)), 'Opus').match, true, 'Opus passes a block at 20 dB');
  assert.deepEqual(soundVerdict(at(db(30, loud), db(20, loud)), 'mp4a'),
    { match: false, detail: 'the soundtrack differs from its recipe at 0.021 s: that block decodes 20.0 dB from the render, under the 25 dB floor for AAC' });
  const quiet = n * 10 ** (-61 / 10);
  assert.equal(soundVerdict(at(db(30, loud), [quiet / 100, quiet]), 'mp4a').match, true, 'a difference under -60 dBFS is left to the codec');
  assert.deepEqual(soundVerdict(at([0, loud]), 'mp4a'),
    { match: false, detail: 'the soundtrack differs from its recipe at 0.000 s: that block decodes -Infinity dB from the render, under the 25 dB floor for AAC' },
    'sound where the recipe is silent');
});

test('a film and its piece must agree on whether there is a soundtrack, in a codec the export writes', async (t) => {
  const dir = scratch(t);
  const silent = loadExternal(fixturePiece(dir), dir).piece;
  const voiced = validate({ ...silent, sound(ctx) { const o = ctx.createOscillator(); o.connect(ctx.destination); o.start(0); } });
  const aac = await filmOf(voiced);
  assert.deepEqual(soundPlan(aac, voiced), { codec: 'mp4a' });
  assert.deepEqual(soundPlan(await filmOf(voiced, { aac: false }), voiced), { codec: 'Opus' });
  assert.equal(soundPlan(await filmOf(silent), silent), null, 'a film without sound replays as before');
  assert.deepEqual(soundPlan(await filmOf(silent), voiced), { match: false, detail: 'the film carries no soundtrack and replay-fixture declares one' });
  assert.deepEqual(soundPlan(aac, silent), { match: false, detail: 'the film carries a soundtrack and replay-fixture declares none' });
  const other = Buffer.from(aac);
  other.write('ac-3', other.indexOf('mp4a'), 'latin1');
  assert.deepEqual(soundPlan(new Uint8Array(other), voiced), { match: false, detail: 'the film\'s soundtrack is "ac-3", and the export writes AAC or Opus' });
});

test('a film whose pictures match still differs by its soundtrack, and pictures are named first', () => {
  const rows = [{ frame: 0, psnr: 45, neighbours: [] }];
  const heard = { match: true, detail: 'the AAC soundtrack decodes to its recipe\'s 96 samples, every block within 25 dB of the render (worst 30.0 dB)' };
  assert.deepEqual(replayVerdict(rows, heard), {
    match: true, detail: '1 frames each within 30 dB of their redraw (worst 45 dB) and closest to their own; ' + heard.detail,
  });
  const lost = { match: false, detail: 'the film carries no soundtrack and tone declares one' };
  assert.deepEqual(replayVerdict(rows, lost), lost);
  assert.match(replayVerdict([{ frame: 0, psnr: 12, neighbours: [] }], lost).detail, /^frame 0 decodes at 12 dB/);
});

test('a PNG from the page is checked against its scale, size and playhead before any browser starts', async (t) => {
  const dir = scratch(t);
  const modulePath = fixturePiece(dir);
  const { piece } = loadExternal(modulePath, dir);
  const heads = playheads(piece);
  const recipe = { ...solve(piece, 9).manifest, t: heads[5], scale: 2 };
  const saved = pngWithManifest(png(64, 48), recipe);
  const { type, manifest } = manifestOf(saved);
  assert.equal(type, 'png');
  assert.deepEqual(manifest, recipe, 'the page\'s iTXt recipe, scale included');
  assert.deepEqual(pngPlan(saved, manifest, piece), { heads, at: 5, frames: [4, 5, 6] }, 'its own frame and both neighbours');
  assert.throws(() => pngPlan(pngWithManifest(png(32, 24), recipe), manifest, piece), /the PNG is 32 x 24 and replay-fixture at scale 2 draws 64 x 48/);
  assert.throws(() => pngPlan(saved, { ...manifest, scale: undefined }, piece), /names no scale it was drawn at/);
  assert.throws(() => pngPlan(saved, { ...manifest, t: 0.5 }, piece), /the PNG's playhead 0\.5 is not a frame of replay-fixture/);
  // A still has one frame, and no neighbours to be mistaken for.
  assert.deepEqual(pngPlan(png(32, 24), { scale: 1, t: 0 }, { ...piece, time: null }).frames, [0]);
});

test('a PNG matches when identical to its redraw, or within the floor and closest to its own frame', () => {
  const row = (frame, psnr, pixels, max = pixels ? 1 : 0) => ({ frame, psnr, pixels, max });
  const size = { w: 64, h: 48 };
  assert.equal(PNG_FLOOR_DB, 40);
  assert.deepEqual(pngVerdict([row(4, 30, 900), row(5, 99, 0), row(6, 99, 0)], 5, size), { match: true, detail: '64 x 48 pixels, identical to the redraw' },
    'a held frame is identical to its neighbour too');
  assert.deepEqual(pngVerdict([row(5, 52.1, 12, 3), row(6, 31, 800)], 5, size),
    { match: true, detail: '12 pixels differ from the redraw, by up to 3 levels: 52.1 dB, and closest to its own frame' });
  assert.deepEqual(pngVerdict([row(5, 39.99, 70, 40)], 5, size),
    { match: false, detail: '70 pixels differ from the redraw, by up to 40 levels: 39.99 dB, under the 40 dB floor' });
  assert.deepEqual(pngVerdict([row(4, 60, 3), row(5, 45, 20)], 5, size),
    { match: false, detail: 'the PNG looks more like frame 4 (60 dB) than its own frame 5 (45 dB)' });
});

test('a WebM from the page is checked like a film, and each frame is sought within its own block', async (t) => {
  const dir = scratch(t);
  const modulePath = fixturePiece(dir);
  const { piece } = loadExternal(modulePath, dir);
  // The recorder's clock: frame 1 came late and frame 2 right after it, so
  // (i + 0.5) / hz would seek frame 1 at 125 ms, inside frame 2's block.
  const times = [0, 40, 60, 250, 333, 417, 500, 583, 667, 750, 833, 917];
  const recipe = { ...solve(piece, 9).manifest, film: { frames: 12, hz: 12, loop: false, scale: 1 } };
  const saved = webmWithManifest(webmWithDuration(webm(times), 1), recipe);
  const { type, manifest } = manifestOf(saved);
  assert.equal(type, 'webm');
  assert.deepEqual(manifest, recipe, 'the page\'s Tags recipe, frame grid included');
  const plan = webmPlan(saved, manifest, piece);
  assert.deepEqual(plan.frames, Array.from({ length: 12 }, (_, i) => i));
  assert.equal(plan.seeks[1], 0.05, 'midway between frame 1\'s block and frame 2\'s');
  plan.frames.forEach((i, n) => assert.ok(plan.seeks[n] * 1000 > times[i] && (i === 11 || plan.seeks[n] * 1000 < times[i + 1]), `frame ${i} is sought inside its own block`));
  assert.ok((1 + 0.5) / 12 * 1000 >= times[2], 'the frame grid alone would have landed on frame 2');
  const tagged = (bytes) => webmWithManifest(webmWithDuration(bytes, 1), recipe);
  assert.throws(() => webmPlan(tagged(webm(times.slice(0, 11))), manifest, piece), /the film holds 11 of the 12 frames its manifest names/);
  assert.throws(() => webmPlan(tagged(webm(times, 64, 48)), manifest, piece), /the film is 64 x 48 and replay-fixture at scale 1 draws 32 x 24/);
  assert.throws(() => webmPlan(saved, { ...manifest, film: { ...manifest.film, hz: 24 } }, piece), /the film's frame grid has hz 24 and replay-fixture now has 12/);
  assert.throws(() => webmPlan(saved, manifest, { ...piece, time: null }), /the file is a film and replay-fixture is now a still/);
});

test('a WebM frame whose read throws still closes the VideoFrame it was read through', async () => {
  const vm = require('node:vm');
  const count = { made: 0, closed: 0 };
  class VideoFrame {
    constructor() { count.made++; }
    close() { count.closed++; }
  }
  const video = { videoWidth: 32, videoHeight: 24 };
  Object.defineProperties(video, {
    src: { get: () => 'blob:film', set() { setTimeout(() => video.onloadeddata(), 0); } },
    currentTime: { set() { setTimeout(() => video.onseeked(), 0); } },
  });
  // Reading a frame fails where it is drawn onto the small canvas.
  const canvas = () => ({ getContext: () => ({ clearRect() {}, drawImage() { throw new Error('the frame could not be read'); } }) });
  const api = { examples: { a: { name: 'a' } }, piece: { validate: (p) => p, atBox: (p) => p, solve: () => ({}) }, render: { playheads: () => [0, 1], drawFrame() {} } };
  const globals = {
    window: { __artifex: api }, VideoFrame, Blob, setTimeout, clearTimeout, atob,
    URL: { createObjectURL: () => 'blob:film', revokeObjectURL() {} },
    document: { createElement: (tag) => (tag === 'video' ? video : canvas()) },
  };
  await assert.rejects(vm.runInNewContext(`(${compareWebm})('AQID', ${JSON.stringify({ piece: 'a', seed: 1, film: { scale: 1 } })}, [0], [0.04])`, globals),
    /the frame could not be read/);
  assert.deepEqual([count.made, count.closed], [1, 1], 'the frame is closed although its read threw');
});

test('replay reads every file type it knows by its bytes and names a file that carries no recipe', async (t) => {
  const dir = scratch(t);
  assert.equal(fileType(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), 'png');
  assert.equal(fileType(Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3, 0)), 'webm');
  assert.equal(fileType(Uint8Array.of(0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70)), 'mp4');
  assert.equal(fileType(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'svg');
  assert.equal(fileType(Buffer.from('hello')), null);
  assert.throws(() => manifestOf(png(1, 1), 'a.png'), /a\.png carries no replay manifest/);
  assert.throws(() => manifestOf(webm([0]), 'a.webm'), /a\.webm carries no replay manifest/);
  assert.throws(() => manifestOf(Buffer.from('hello'), 'a.txt'), /a\.txt is not an SVG, MP4, PNG or WebM file/);
  assert.throws(() => manifestOf(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'bare.svg'), /bare\.svg carries no replay manifest/);
  assert.throws(() => parseArgs([]), /usage: npm run replay/);
  assert.throws(() => parseArgs(['a.svg', 'b.svg']), /usage/);
  assert.throws(() => parseArgs(['a.svg', '--piece']), /usage/);
  assert.throws(() => parseArgs(['a.mp4', '--timeout-ms', '5']), /--timeout-ms must be an integer from 100 to 300000/);
  assert.deepEqual(parseArgs(['a.mp4', '--piece', './p.cjs', '--headed']), { file: 'a.mp4', piece: './p.cjs', browser: { headed: true } });
  assert.equal(parseArgs(['a.svg', '--json']).json, true);
  const env = { npm_lifecycle_event: 'replay', npm_package_json: path.join(ROOT, 'package.json'), INIT_CWD: dir };
  assert.equal(callerDirectory(path.join(dir, 'elsewhere'), env), dir, 'npm run replay resolves paths from where it was called');
});

test('by default replay prints its verdict, naming the first difference, and the path of its full report, and --json prints the report too', async (t) => {
  const dir = scratch(t);
  const logged = [];
  t.mock.method(console, 'log', (line) => logged.push(line));
  const exitCode = process.exitCode;
  t.after(() => { process.exitCode = exitCode; });
  const result = { file: path.join(dir, 'a.svg'), type: 'svg', manifest: { piece: 'a', seed: 3 }, match: false, detail: 'first difference at byte 12' };
  await main([result.file], async () => result, dir);
  const verdict = `replay: ${result.file} (svg, a seed 3): DIFFERS; first difference at byte 12`;
  const file = path.join(dir, 'replay-a.svg.json');
  assert.deepEqual(logged, [verdict, 'report: ' + file]);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), result);
  assert.equal(process.exitCode, 1, 'a file that differs still fails');
  logged.length = 0;
  fs.rmSync(file);
  process.exitCode = undefined;
  await main([result.file, '--json'], async () => ({ ...result, match: true, detail: 'identical' }), dir);
  assert.equal(JSON.parse(logged[0]).match, true);
  assert.equal(logged[1], `replay: ${result.file} (svg, a seed 3): matches; identical`);
  assert.equal(logged.length, 2);
  assert.equal(fs.existsSync(file), false, '--json writes no file');
  assert.equal(process.exitCode, undefined);
});
