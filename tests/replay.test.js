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
const { solve, atBox, VERSION } = require('../core/piece.js');
const { nullSurface } = require('../tools/bench.js');
const { callerDirectory, loadExternal, slash } = require('../tools/piece-input.js');
const { pngWithManifest, webmWithDuration, webmWithManifest } = require('../core/export.js');
const {
  fileType, manifestOf, pieceFor, filmPlan, filmFrames, replayVerdict, replay, parseArgs, main, FILM_FLOOR_DB,
  soundPlan, compareSound, soundWav, soundVerdict, SOUND_BLOCK, SOUND_FLOOR_DB, SOUND_GATE_DB, SOUND_BAND, SOUND_FLATNESS, SOUND_NOISE_DB, SOUND_VOICE, SOUND_MASK_DB, SOUND_CUT, SOUND_SPARSE, SOUND_NEAR_DB, SOUND_SPILL_DB,
  pngPlan, pngVerdict, webmPlan, PNG_FLOOR_DB, compareFilm, comparePng, compareWebm, sendBytes,
  frameChange, activityLag, scanText, SCAN_WIDTH, LAG_FRAMES,
} = require('../tools/replay.js');
const { fakeAudio, fakeCodecs, fakeCanvas, EDGE_AVCC } = require('./fake-media.js');
const { withManifest } = require('./svg-manifest.js');
const { PIECE_CHARS } = require('../tools/check-browser.js');
const { stitch } = require('../tools/stitch.js');
const EXAMPLES = require('../examples/index.js');

const ROOT = path.resolve(__dirname, '..');

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-replay-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

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
  // An empty temporary home, never the real one.
  const env = { ARTIFEX_HOME: path.join(dir, 'home') };
  await assert.rejects(replay(saved({ ...manifest, piece: 'nope' }), { env }), /no registered example is named "nope"; pass its module with --piece$/);
  // Looked up as an own property: a name every object inherits is no example.
  await assert.rejects(replay(saved({ ...manifest, piece: 'toString' }), { env }), /no registered example is named "toString"/);
  await assert.rejects(replay(saved({ ...manifest, size: { w: 1, h: 1 } })), /drawn at \{"w":1,"h":1\} and inversion now draws at/);
  await assert.rejects(replay(saved({ ...manifest, outputs: ['raster'] })), /names outputs \["raster"\] and inversion now declares/);
  const other = fixturePiece(dir, 'other-piece');
  await assert.rejects(replay(saved(manifest), { piece: other }), /names piece "inversion" and .*other-piece\.cjs is "other-piece"/);
});

test('a file drawn with another image, or without one the piece declares, is refused naming the image', async (t) => {
  const dir = scratch(t);
  const piece = path.join(ROOT, 'tools', 'fixtures', 'image-piece.cjs');
  const { svg, manifest } = renderVector(require(piece), { seed: 1, t: 0 });
  const saved = (m) => { const file = path.join(dir, 'x.svg'); fs.writeFileSync(file, withManifest(svg, m)); return file; };
  const same = await replay(saved(manifest), { piece });
  assert.equal(same.match, true, same.detail);
  const ground = manifest.images.ground;
  await assert.rejects(replay(saved({ ...manifest, images: { ground: { ...ground, digest: 'fnv1a32:00000000' } } }), { piece }),
    new RegExp(`^Error: replay: the file was drawn with image "ground" at digest "fnv1a32:00000000" and image-piece now declares "${ground.digest}"$`));
  await assert.rejects(replay(saved({ ...manifest, images: { ground: { ...ground, w: 32 } } }), { piece }), /drawn with image "ground" at w 32 and image-piece now declares 64$/);
  const { images, ...without } = manifest;
  await assert.rejects(replay(saved(without), { piece }), /^Error: replay: image-piece now declares image "ground", which the file was drawn without$/);
  await assert.rejects(replay(saved({ ...manifest, images: { ...images, other: ground } }), { piece }), /^Error: replay: the file was drawn with image "other" and image-piece no longer declares it$/);
  await assert.rejects(replay(saved({ ...manifest, images: [] }), { piece }), /^Error: replay: the file names images that are not an object, \[\]$/);
});

test('a manifest never names the module that runs: a path in it is refused, not loaded', async (t) => {
  const dir = scratch(t);
  const evil = path.join(dir, 'evil.cjs');
  fs.writeFileSync(evil, "globalThis.__replayLoaded = true;\nmodule.exports = { name: 'evil', size: { w: 10, h: 10 }, draw() {} };\n");
  const { svg, manifest } = renderVector(EXAMPLES.inversion);
  const file = path.join(dir, 'named.svg');
  fs.writeFileSync(file, withManifest(svg, { ...manifest, piece: evil }));
  await assert.rejects(replay(file, { env: { ARTIFEX_HOME: path.join(dir, 'home') } }), /no registered example is named ".*evil\.cjs"; pass its module with --piece/);
  assert.equal(globalThis.__replayLoaded, undefined, 'the module the file names never ran');
});

test('replay refuses --style before reading the file, since a style draws nothing, naming the style\'s guide and marks', async (t) => {
  const dir = scratch(t);
  // A temporary ARTIFEX_HOME, never the real one.
  const env = { ARTIFEX_HOME: path.join(dir, 'home') };
  const { svg, manifest } = renderVector(EXAMPLES.inversion);
  const file = path.join(dir, 'doodle.svg');
  fs.writeFileSync(file, withManifest(svg, { ...manifest, piece: 'doodle' }));
  // A style's name is no piece, so a file naming it is offered only --piece.
  await assert.rejects(replay(file, { env }), /no registered example is named "doodle"; pass its module with --piece$/);
  const STYLES = path.join(ROOT, 'skills', 'artifex', 'styles');
  const refused = new RegExp('^Error: replay: --style draws nothing, since a style is a guide and the functions that draw its marks, not a picture\\. For the built-in style doodle, read '
    + [path.join(STYLES, 'doodle.md'), ' and draw your own piece with the functions in ', path.join(STYLES, 'doodle.js')].map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('')
    + '; nothing was written\\nusage: npm run replay -- ');
  await assert.rejects(replay(file, { style: 'doodle', env }), refused);
  await assert.rejects(replay(path.join(dir, 'absent.svg'), { style: 'doodle', env }), refused);
  await assert.rejects(replay(file, { style: 'nosuch', env }), /^Error: replay: --style draws nothing, since a style is a guide and the functions that draw its marks, not a picture; no style named "nosuch"\. Available: /);
  assert.equal(parseArgs(['x.png', '--style', 'doodle']).style, 'doodle');
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

test('a file drawn along a box timeline replays along the timeline it names, and one drawn at one box at that box', async (t) => {
  const dir = scratch(t);
  const piece = validate(EXAMPLES.refit);
  const { svg, manifest } = renderVector(piece, { t: 0.5 });
  assert.deepEqual(manifest.reframe, piece.reframe, 'the recipe names the timeline');
  const file = path.join(dir, 'moving.svg');
  fs.writeFileSync(file, svg);
  const result = await replay(file);
  assert.equal(result.match, true, result.detail);
  // A timeline the file names, not the piece's own, is the one drawn again.
  const other = [{ t: 0, w: 1280, h: 720 }, { t: 1, w: 600, h: 400 }];
  assert.deepEqual(pieceFor({ ...manifest, reframe: other }).piece.reframe, other);
  assert.throws(() => pieceFor({ ...manifest, reframe: { w: 405, h: 720 } }), /names a box timeline that is not a list, \{"w":405,"h":720\}/);
  fs.writeFileSync(file, withManifest(svg, { ...manifest, reframe: other }));
  assert.equal((await replay(file)).match, false, 'drawn along another timeline, it differs');
  fs.writeFileSync(file, withManifest(svg, { ...manifest, reframe: [other[0], { ...other[1], w: 100 }] }));
  await assert.rejects(replay(file), /refit cannot play that box timeline: box 1, 100 x 400: w 100 is outside the declared \[240, 1920\]/);
  // One box at the piece's own size is that box, not the piece's timeline.
  const still = renderVector(atBox(piece, piece.size), { t: 0.5 });
  assert.equal('reframe' in still.manifest, false);
  assert.equal(pieceFor(still.manifest).piece.reframe, null);
  fs.writeFileSync(file, still.svg);
  assert.equal((await replay(file)).match, true);
  // A film records the timeline too.
  const bytes = await filmOf(piece);
  const film = manifestOf(bytes).manifest;
  assert.deepEqual(film.reframe, piece.reframe);
  assert.deepEqual(pieceFor(film).piece.reframe, piece.reframe);
});

test('the page redraws a responsive film, its soundtrack, a PNG or a WebM at the box its recipe records', async () => {
  // Each page function is stopped at its solve, which is handed the piece it will draw.
  const vm = require('node:vm');
  const core = require('../core/piece.js');
  for (const f of [compareFilm, compareSound, comparePng, compareWebm]) {
    const solvedAt = [];
    const piece = { validate: core.validate, atBox: core.atBox, solve: (p) => { solvedAt.push({ ...p.size, reframe: p.reframe }); throw new Error('stopped at the solve'); } };
    const window = { __artifex: { examples: { refit: EXAMPLES.refit }, piece } };
    const recipe = { piece: 'refit', seed: 5, params: {}, size: { w: 405, h: 720 }, film: { scale: 1 } };
    const reframe = [{ t: 0, w: 600, h: 400 }, { t: 1, w: 300, h: 500 }];
    for (const r of [recipe, { ...recipe, size: { w: 600, h: 500 }, reframe }]) {
      await assert.rejects(vm.runInNewContext(`(${f})(new Uint8Array(0), ${JSON.stringify(r)}, [], [])`, { window }), /stopped at the solve/, f.name);
    }
    // Compared as JSON: the page function's arrays come from another realm.
    assert.equal(JSON.stringify(solvedAt), JSON.stringify([{ w: 405, h: 720, reframe: null }, { w: 600, h: 500, reframe }]), f.name + ' draws at the recorded box or along the recorded timeline');
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
const { normalizeLoudness } = require('../core/film.js');

/** An AudioBuffer stand-in at 48 kHz holding `channels`, Float32Arrays. */
const audio = (channels) => ({ numberOfChannels: channels.length, length: channels[0].length, sampleRate: 48000, duration: channels[0].length / 48000, getChannelData: (c) => channels[c] });
/** Two channels of `n` samples, each `f(i, c)`. */
const signal = (n, f) => [0, 1].map((c) => Float32Array.from({ length: n }, (_, i) => f(i, c)));
const tone = (n, level = 0.2) => signal(n, (i, c) => level * Math.sin((2 * Math.PI * (440 + 110 * c) * i) / 48000));
/** `channels` levelled as the export levels them for `codec`, gain and limiter, in a copy. */
const levelled = (channels, codec = 'mp4a') => { const out = channels.map((x) => x.slice()); normalizeLoudness(audio(out), codec); return out; };

/**
 * compareSound as the page runs it, from its source text alone, with the page's
 * loudness meter and gain: the piece renders `rendered` and the film decodes
 * to `decoded`, or fails to decode, from a soundtrack in `codec`, its cut
 * measured by `cut`, its bands judged alone as `voice` names them, masked by its own noise at `mask` dB,
 * and its sparse noise allowed for as `sparse` says, or not at all when null: by default, as replay
 * passes it.
 */
async function soundInPage({ rendered, decoded }, codec = 'mp4a', cut = SOUND_CUT, voice = SOUND_VOICE, mask = SOUND_MASK_DB[codec], dump = false, sparse = SOUND_SPARSE) {
  const vm = require('node:vm');
  const p = validate({ name: 'tone', size: { w: 8, h: 8 }, time: { duration: 1, hz: 10 }, sound() {}, draw() {} });
  class OfflineAudioContext {
    constructor(channels, length, sampleRate) { Object.assign(this, { channels, length, sampleRate, destination: {} }); }
    startRendering() { return Promise.resolve(audio(rendered.map((x) => x.slice()))); }
    decodeAudioData() { return decoded ? Promise.resolve(audio(decoded)) : Promise.reject(new Error('Unable to decode audio data')); }
  }
  const window = { __artifex: { piece: require('../core/piece.js'), render: require('../core/render.js'), examples: { tone: p }, level: normalizeLoudness } };
  const recipe = { ...solve(p, p.seed).manifest, film: { frames: 10, hz: 10, loop: false, scale: 1 } };
  const run = `(${compareSound})(new Uint8Array(${JSON.stringify([...Buffer.from('film')])}), ${JSON.stringify(recipe)}, ${SOUND_BLOCK}, ${JSON.stringify(codec)}, ${SOUND_BAND}, ${SOUND_FLATNESS}, ${JSON.stringify(cut)}, ${JSON.stringify(voice)}, ${mask}, null, ${JSON.stringify(sparse)})`;
  const context = { window, OfflineAudioContext, atob, btoa };
  const s = await vm.runInNewContext(run, context);
  if (!dump) return s;
  const wav = (name) => vm.runInNewContext(`(${soundWav})(${JSON.stringify(name)})`, context);
  return { s, dump: { decoded: wav('decoded'), rendered: wav('rendered') } };
}

/** A 16-bit PCM WAV's format and its samples per channel. */
function readWav(base64) {
  const b = Buffer.from(base64, 'base64');
  const k = b.readUInt16LE(22), n = b.readUInt32LE(40) / (2 * k);
  return {
    tags: [0, 8, 12, 36].map((at) => b.toString('latin1', at, at + 4)), riff: b.readUInt32LE(4), bytes: b.length,
    format: b.readUInt16LE(20), rate: b.readUInt32LE(24), bits: b.readUInt16LE(34),
    channels: Array.from({ length: k }, (_, c) => Int16Array.from({ length: n }, (_, i) => b.readInt16LE(44 + 2 * (i * k + c)))),
  };
}

const comparedInPage = async (films) => soundVerdict(await soundInPage(films), 'mp4a');

test('replay levels a soundtrack with the gain and limiter the export applies', async () => {
  const click = signal(48000, (i) => (i === 24000 ? 0.9 : 0.001 * Math.sin(i / 7)));
  const beats = signal(48000, (i) => 0.02 * Math.sin(i / 20) + (i % 12000 < 400 ? 0.6 * Math.exp(-(i % 12000) / 100) * Math.sin(i / 3) : 0));
  for (const [what, rendered] of [['a steady tone reaches -14 LUFS', tone(48000)], ['a click stops at 12 dB of limiting under its codec ceiling', click],
    ['beats are limited to -14 LUFS', beats], ['silence keeps its level', signal(48000, () => 0)]]) {
    for (const codec of ['mp4a', 'Opus']) {
      const { gain, limited } = await soundInPage({ rendered, decoded: rendered }, codec);
      const want = normalizeLoudness(audio(rendered.map((x) => x.slice())), codec);
      assert.deepEqual([gain, limited], [want.gain, want.limited], `${what}, ${codec}`);
    }
  }
  const beat = soundVerdict(await soundInPage({ rendered: beats, decoded: levelled(beats) }), 'mp4a');
  assert.equal(beat.match, true, 'limited beats match their render levelled as the export levels it: ' + beat.detail);
  const scale = 10 ** (normalizeLoudness(audio(beats.map((x) => x.slice())), 'mp4a').gain / 20);
  const once = soundVerdict(await soundInPage({ rendered: beats, decoded: beats.map((x) => x.map((v) => v * scale)) }), 'mp4a');
  assert.equal(once.match, false, 'and differ from it at one gain, unlimited: ' + once.detail);
  // AAC and Opus share the -2 dBTP ceiling, so a click is levelled the same for either.
  const [aac, opus] = await Promise.all(['mp4a', 'Opus'].map((codec) => soundInPage({ rendered: click, decoded: click }, codec)));
  assert.deepEqual([aac.gain, aac.limited], [opus.gain, opus.limited], `AAC ${aac.gain} dB and Opus ${opus.gain} dB`);
});

test('a film soundtrack matches only where it decodes to its recipe, levelled as the export levels it', async () => {
  const rendered = tone(48000);
  const heard = levelled(rendered);
  const measured = await soundInPage({ rendered, decoded: heard });
  // Energies come from the spectrum, and add up to the levelled render's.
  const energy = heard.reduce((e, x) => x.reduce((a, v) => a + v * v, e), 0), summed = measured.blocks.reduce((e, b) => e + b[0], 0);
  assert.ok(Math.abs(summed / energy - 1) < 1e-3, `${summed} of ${energy}`);
  const same = soundVerdict(measured, 'mp4a');
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

test('with --dump the page leaves the decoded soundtrack and the levelled render as 16-bit WAV files', async () => {
  const rendered = tone(4800);
  // The film decodes to the levelled render at half its level on the right.
  const heard = levelled(rendered).map((x, c) => x.map((v) => (c ? v / 2 : v)));
  const { s, dump } = await soundInPage({ rendered, decoded: heard }, 'mp4a', SOUND_CUT, SOUND_VOICE, SOUND_MASK_DB.mp4a, true);
  assert.equal(s.blocks.length, 5, 'the comparison runs as before');
  for (const [name, want] of [['decoded', heard], ['rendered', levelled(rendered)]]) {
    const wav = readWav(dump[name]);
    assert.deepEqual([wav.tags, wav.riff, wav.bytes, wav.format, wav.rate, wav.bits], [['RIFF', 'WAVE', 'fmt ', 'data'], 36 + 4 * 4800, 44 + 4 * 4800, 1, 48000, 16], name);
    const off = want.map((x, c) => x.findIndex((v, i) => wav.channels[c][i] !== Math.round(v * 32767)));
    assert.deepEqual(off, [-1, -1], `${name}: every sample, channels interleaved`);
  }
  assert.equal(await soundInPage({ rendered, decoded: heard }).then((r) => r.blocks.length), 5);
});

/** The stand-in page's WAV named `name`: its name, then more bytes than one reply may carry. */
const standInWav = (name) => Buffer.concat([Buffer.from('RIFF ' + name), Buffer.alloc(PIECE_CHARS)]);

/**
 * A stand-in for withEdge whose page answers each evaluation by its kind: every
 * frame at 40 dB, a soundtrack of one 1024-sample block 30 dB from its render,
 * a joined film's scene where its span says, and each WAV as standInWav. A
 * value read in pieces is handed back by slices, and a reply past PIECE_CHARS
 * characters is refused, as Node's WebSocket refuses one past 4 MiB. `calls`
 * records the compareSound calls, the WAVs asked for, the seconds each decoded
 * frame was sought at, each answered as standInWav('frame <seconds>'), and
 * the pages opened.
 * `sound` replaces the soundtrack's blocks, or with `error` makes it fail to decode.
 */
function standInEdge(file, calls = { sound: [], wav: [], frames: [], pages: 0 }, sound = {}) {
  const answer = (expression) => {
    if (expression.startsWith('document.readyState')) return true;
    const frame = /function decodedFrame[\s\S]*\)\(window\.__replayBytes, ([\d.]+)\)$/.exec(expression);
    if (frame) {
      calls.frames.push(Number(frame[1]));
      return standInWav('frame ' + frame[1]).toString('base64');
    }
    if (expression.startsWith('fetch("/file")')) return fs.statSync(file).size;
    if (expression.includes('function scanFilm')) {
      (calls.scans ||= []).push(expression);
      return sound.scan || [];
    }
    if (expression.includes('function compareFilm')) return [{ frame: 0, psnr: 40, neighbours: [] }];
    if (expression.includes('function compareSound')) {
      calls.sound.push(expression);
      if (sound.error) return { error: sound.error };
      const span = JSON.parse(/, (null|\{[^{}]*\}), (?:null|\{[^{}]*\})\)$/.exec(expression)[1]);
      return {
        gain: 1, limited: 0, rate: 48000, block: 1024, cut: null, channels: [2, 2], blocks: sound.blocks || [[1, 0.001, 0, 0, 0, -1, 0, 0, 0]],
        ...(span ? { length: [span.total, span.total], span: { from: span.from, to: span.from + 1024, of: span.to } } : { length: [1024, 1024] }),
      };
    }
    const wav = /function soundWav[\s\S]*\)\("(decoded|rendered)"\)$/.exec(expression);
    if (wav) {
      calls.wav.push(wav[1]);
      return standInWav(wav[1]).toString('base64');
    }
    throw new Error('unexpected evaluation ' + expression.slice(0, 40));
  };
  const withEdge = async (page, options, work) => {
    calls.pages++;
    let kept;
    const reply = (value) => {
      if ((typeof value === 'string' ? value : JSON.stringify(value ?? null)).length > PIECE_CHARS) throw new Error('Max decompressed message size exceeded');
      return { result: { value } };
    };
    const client = {
      send: async (method, { expression }) => {
        const whole = /^\(async \(\) => \(globalThis\.__artifexValue = JSON\.stringify\(await \(([\s\S]*)\)\)\)\.length\)\(\)$/.exec(expression);
        const piece = /^globalThis\.__artifexValue\.slice\((\d+), (\d+)\)$/.exec(expression);
        if (whole) return reply((kept = JSON.stringify(answer(whole[1]))).length);
        if (piece) return reply(kept.slice(Number(piece[1]), Number(piece[2])));
        if (expression === 'delete globalThis.__artifexValue') return reply(true);
        return reply(answer(expression));
      },
    };
    return work(client, { errors: [], phase: 'startup', version: { Browser: 'Stand-in/1' }, signal: new AbortController().signal });
  };
  return { withEdge, calls };
}

/** fixturePiece with a soundtrack of one oscillator, or none when `sound` is false. */
function voicedPiece(dir, name, sound = true) {
  const file = fixturePiece(dir, name);
  if (sound) fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('draw(g', 'sound(ctx) { const o = ctx.createOscillator(); o.connect(ctx.destination); o.start(0); },\n  draw(g'));
  return file;
}

test('replay --dump writes a film\'s decoded soundtrack, its render and the per-block figures into a folder, and refuses by name what it cannot dump', async (t) => {
  const dir = scratch(t);
  const piece = voicedPiece(dir, 'voiced');
  const file = path.join(dir, 'voiced.mp4');
  fs.writeFileSync(file, await filmOf(loadExternal(piece, dir).piece));
  const browser = { edge: path.join(dir, 'no-edge.exe') };
  const plain = standInEdge(file);
  const without = await replay(file, { piece, withEdge: plain.withEdge, browser });
  assert.equal('dump' in without, false, 'without --dump the report is as before');
  assert.deepEqual([plain.calls.sound.length, plain.calls.wav], [1, []], 'without --dump no WAV is asked for');
  const out = path.join(dir, 'dump', 'here');
  const dumping = standInEdge(file);
  const result = await replay(file, { piece, withEdge: dumping.withEdge, browser, dump: out });
  assert.deepEqual(dumping.calls.sound, plain.calls.sound, 'the soundtrack is compared as without --dump');
  assert.deepEqual(dumping.calls.wav, ['decoded', 'rendered']);
  assert.deepEqual({ ...result, dump: undefined }, { ...without, dump: undefined }, 'the verdict is unchanged');
  assert.deepEqual(result.dump, ['decoded.wav', 'rendered.wav', 'blocks.json'].map((f) => path.join(out, f)));
  // Each WAV is longer than one reply may carry, so it crossed in pieces.
  for (const name of ['decoded', 'rendered']) assert.ok(fs.readFileSync(path.join(out, name + '.wav')).equals(standInWav(name)), name + '.wav whole');
  const blocks = JSON.parse(fs.readFileSync(path.join(out, 'blocks.json'), 'utf8'));
  assert.deepEqual([blocks.codec, blocks.verdict.match, blocks.rate, blocks.block], ['mp4a', true, 48000, 1024]);
  assert.deepEqual(blocks.blocks, [{ at: 0, decodedAt: 0, db: 30, signal: 1, error: 0.001, noise: 0, noiseError: 0, envelope: 0, band: -1, bandNoise: 0, bandError: 0, masked: 0 }]);
  // A block with no difference and one where only the film sounds are named, not null.
  const edges = standInEdge(file, undefined, { blocks: [[1, 0, 0, 0, 0, -1, 0, 0, 0], [0, 0.5, 0, 0, 0, -1, 0, 0, 0]] });
  await replay(file, { piece, withEdge: edges.withEdge, browser, dump: out });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'blocks.json'), 'utf8')).blocks.map((b) => b.db), ['identical', 'render silent']);
  // A soundtrack that does not decode leaves blocks.json alone, holding the error, and removes the earlier WAVs.
  const broken = standInEdge(file, undefined, { error: 'Unable to decode audio data' });
  const undecoded = await replay(file, { piece, withEdge: broken.withEdge, browser, dump: out });
  assert.deepEqual([undecoded.match, undecoded.dump, broken.calls.wav], [false, [path.join(out, 'blocks.json')], []]);
  assert.deepEqual(fs.readdirSync(out), ['blocks.json']);
  const failed = JSON.parse(fs.readFileSync(path.join(out, 'blocks.json'), 'utf8'));
  assert.deepEqual([failed.error, failed.blocks], ['Unable to decode audio data', []]);
  // A write that fails after the comparison is named beside the unchanged verdict, and fails the command.
  const blocked = path.join(dir, 'blocked');
  fs.mkdirSync(path.join(blocked, 'decoded.wav'), { recursive: true });
  const unwritten = await replay(file, { piece, withEdge: standInEdge(file).withEdge, browser, dump: blocked });
  assert.deepEqual([unwritten.match, unwritten.detail, 'dump' in unwritten], [without.match, without.detail, false]);
  assert.match(unwritten.dumpError, /^replay: --dump cannot write into the folder .*blocked: E[A-Z]+$/);
  const logged = [], errors = [];
  t.mock.method(console, 'log', (line) => logged.push(line));
  t.mock.method(console, 'error', (line) => errors.push(line));
  const exitCode = process.exitCode;
  t.after(() => { process.exitCode = exitCode; });
  process.exitCode = undefined;
  await main([file, '--dump', blocked], async () => unwritten, dir);
  assert.match(logged[0], /: matches; /, 'the verdict still prints');
  assert.deepEqual([errors, process.exitCode], [[unwritten.dumpError], 1]);
  t.mock.restoreAll();

  // A long film's per-block comparison, longer than one reply may carry, crosses in pieces and arrives whole.
  const many = Array.from({ length: 25000 }, () => [1, 0.001, 0, 0, 0, -1, 0, 0, 0]).concat([[0, 0.5, 0, 0, 0, -1, 0, 0, 0]]);
  assert.ok(JSON.stringify(many).length > PIECE_CHARS, 'the blocks pass one reply');
  await replay(file, { piece, withEdge: standInEdge(file, undefined, { blocks: many }).withEdge, browser, dump: out });
  const long = JSON.parse(fs.readFileSync(path.join(out, 'blocks.json'), 'utf8')).blocks;
  assert.deepEqual([long.length, long[0].db, long.at(-1).db], [many.length, 30, 'render silent'], 'every block, the last one included');

  // Refused before any page opens: a film without sound, a folder that is a file, a file that is no MP4 film.
  const refused = standInEdge(file);
  const silent = path.join(dir, 'silent.mp4');
  fs.writeFileSync(silent, await filmOf(loadExternal(fixturePiece(dir), dir).piece));
  await assert.rejects(replay(silent, { piece: fixturePiece(dir), withEdge: refused.withEdge, browser, dump: out }),
    /^Error: replay: --dump writes a film's soundtrack, and the film carries none and its piece declares none$/);
  const taken = path.join(dir, 'taken');
  fs.writeFileSync(taken, '');
  await assert.rejects(replay(file, { piece, withEdge: refused.withEdge, browser, dump: taken }), /^Error: replay: --dump cannot use the folder .*taken: E[A-Z]+$/);
  assert.equal(refused.calls.pages, 0, 'no page opened');
  const svg = path.join(dir, 'still.svg');
  fs.writeFileSync(svg, renderVector(EXAMPLES.inversion).svg);
  await assert.rejects(replay(svg, { dump: out }), /--dump writes an MP4 film's soundtrack, and .*still\.svg is SVG$/);
  assert.equal(parseArgs(['a.mp4', '--dump', 'out/d']).dump, 'out/d');
  assert.throws(() => parseArgs(['a.mp4', '--dump']), /--dump needs a folder to write the soundtracks and their blocks into/);
  assert.throws(() => parseArgs(['a.mp4', '--dump', '--json']), /--dump needs a folder/);
});

test('replay --save-frames writes the decoded frames it names, by number or seconds, sought at their middles, as full-size PNG files beside the film, and refuses by name what it cannot write', async (t) => {
  const dir = scratch(t);
  const piece = fixturePiece(dir);
  const file = path.join(dir, 'film.mp4');
  fs.writeFileSync(file, await filmOf(loadExternal(piece, dir).piece));
  const browser = { edge: path.join(dir, 'no-edge.exe') };
  const plain = await replay(file, { piece, withEdge: standInEdge(file).withEdge, browser });
  assert.equal('frameFiles' in plain, false, 'without --save-frames the report is as before');
  const edge = standInEdge(file);
  const result = await replay(file, { piece, withEdge: edge.withEdge, browser, saveFrames: '0,11,0.5s,6' });
  assert.deepEqual(edge.calls.frames, [0.5 / 12, 11.5 / 12, 6.5 / 12], 'each frame sought once, at its middle; 0.5 s is frame 6');
  const folder = path.join(dir, 'film.mp4-frames');
  assert.deepEqual(result.frameFiles, ['frame-00.png', 'frame-11.png', 'frame-06.png'].map((f) => path.join(folder, f)));
  // Each picture is longer than one reply may carry, so it crossed in pieces.
  for (const [i, f] of result.frameFiles.entries()) assert.ok(fs.readFileSync(f).equals(standInWav('frame ' + edge.calls.frames[i])), f + ' whole');
  assert.deepEqual({ ...result, frameFiles: undefined }, { ...plain, frameFiles: undefined }, 'the verdict is unchanged');
  assert.equal(edge.calls.pages, 1, 'decoded on the replay\'s own page');
  // Refused before any page opens: a frame past the film, a bare decimal, a file that is no MP4 film.
  const refused = standInEdge(file);
  await assert.rejects(replay(file, { piece, withEdge: refused.withEdge, browser, saveFrames: '3,12' }),
    /^Error: replay: --save-frames names 12, and the film holds frames 0 to 11 \(1\.000 s\)$/);
  await assert.rejects(replay(file, { piece, withEdge: refused.withEdge, browser, saveFrames: '1.5' }),
    /^Error: replay: --save-frames takes frame numbers or seconds ending in s, such as 0,24,2\.5s, and got "1\.5"$/);
  assert.equal(refused.calls.pages, 0, 'no page opened');
  const svg = path.join(dir, 'still.svg');
  fs.writeFileSync(svg, renderVector(EXAMPLES.inversion).svg);
  await assert.rejects(replay(svg, { saveFrames: '0' }), /--save-frames writes an MP4 film's decoded frames, and .*still\.svg is SVG$/);
  assert.equal(parseArgs(['a.mp4', '--save-frames', '0,2.5s']).saveFrames, '0,2.5s');
  assert.throws(() => parseArgs(['a.mp4', '--save-frames']), /--save-frames needs frame numbers or seconds ending in s/);
});

test('replay --dump on a joined film writes each scene\'s files under its number, placed in the decoded soundtrack, and refuses any scene before the first page opens', async (t) => {
  const dir = scratch(t);
  // Two external pieces, so the scenes are compared on two pages.
  const pieces = ['va', 'vb'].map((name) => voicedPiece(dir, name));
  const file = path.join(dir, 'joined.mp4');
  const films = await Promise.all(pieces.map((p) => filmOf(loadExternal(p, dir).piece)));
  const { bytes } = stitch(films.map((b, i) => ({ name: `${i}.mp4`, bytes: b })));
  fs.writeFileSync(file, bytes);
  const second = manifestOf(bytes).manifest.scenes[1].sound;
  const browser = { edge: path.join(dir, 'no-edge.exe') };
  const out = path.join(dir, 'dump');
  const edge = standInEdge(file);
  const result = await replay(file, { piece: pieces, withEdge: edge.withEdge, browser, dump: out, saveFrames: '13' });
  assert.equal(edge.calls.pages, 2);
  // --save-frames numbers the joined film's frames and decodes them once, on the first page.
  assert.deepEqual([edge.calls.frames, result.frameFiles], [[13.5 / 12], [path.join(dir, 'joined.mp4-frames', 'frame-13.png')]]);
  // One decoded.wav for the whole joined soundtrack, with the first scene's files.
  assert.deepEqual(result.scenes.map((s) => s.dump), [['decoded.wav', 'scene-1-rendered.wav', 'scene-1-blocks.json'], ['scene-2-rendered.wav', 'scene-2-blocks.json']].map((l) => l.map((f) => path.join(out, f))));
  assert.deepEqual(edge.calls.wav, ['decoded', 'rendered', 'rendered']);
  const blocks = JSON.parse(fs.readFileSync(path.join(out, 'scene-2-blocks.json'), 'utf8')).blocks;
  assert.deepEqual([blocks[0].at, blocks[0].decodedAt], [second.judged[0] / 48000, (second.at + second.judged[0]) / 48000], 'a later scene\'s block is placed in the whole decoded soundtrack');
  assert.ok(second.at > 0);

  // The second scene's piece now declares no sound: refused before either page opens.
  voicedPiece(dir, 'vb', false);
  const refused = standInEdge(file);
  await assert.rejects(replay(file, { piece: pieces, withEdge: refused.withEdge, browser, dump: path.join(dir, 'other') }),
    /^Error: replay: --dump writes a film's soundtrack, and the film carries a soundtrack and vb declares none$/);
  assert.equal(refused.calls.pages, 0, 'no page opened');
  assert.equal(fs.existsSync(path.join(dir, 'other')), false, 'no folder made');
});

test('the sparse-noise allowance is passed to the page for an AAC film and an Opus film alike', async (t) => {
  const dir = scratch(t);
  const piece = voicedPiece(dir, 'voiced');
  const browser = { edge: path.join(dir, 'no-edge.exe') };
  const passed = async (codec, aac) => {
    const file = path.join(dir, `${codec}.mp4`);
    fs.writeFileSync(file, await filmOf(loadExternal(piece, dir).piece, { aac }));
    const edge = standInEdge(file);
    await replay(file, { piece, withEdge: edge.withEdge, browser });
    assert.equal(edge.calls.sound.length, 1, codec);
    return edge.calls.sound[0];
  };
  assert.match(await passed('mp4a', true), /, "mp4a", 16, 0\.4, \{[^{}]*\}, \{[^{}]*\}, -6, null, \{"near":0\.2,"onset":6,"envelope":12\}\)$/);
  assert.match(await passed('Opus', false), /, "Opus", 16, 0\.4, \{[^{}]*\}, \{[^{}]*\}, -3, null, \{"near":0\.2,"onset":6,"envelope":12\}\)$/);
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
 * `high` at 8 kHz, and a `hat` band-passed broadly at 12 kHz, reaching past
 * 20 kHz, each { seed, hz, level }, or null for a missing voice; the hat is
 * missing unless given. Each channel draws its own noise. `filmOfNoise` is that
 * soundtrack as the export levels it and a perceptual codec keeps it: each
 * voice's waveform only 10 dB under it, as another noise in the same band adds,
 * and its level nearly whole; then, given `cut` in Hz, low-passed there.
 */
function noiseSoundtrack({ toneHz = 440, low = {}, high = {}, hat = null } = {}) {
  const voices = [low && { seed: 1, hz: 2000, level: 1, q: 1.5, ...low }, high && { seed: 3, hz: 8000, level: 1, q: 1.5, ...high },
    hat && { seed: 5, hz: 12000, level: 0.3, q: 0.5, ...hat }].filter(Boolean);
  const voice = (v, c, seed = v.seed) => bandPass(whiteNoise(48000, seed * 2 + c), v.hz, v.q).map((x) => v.level * x);
  const sound = (coded) => [0, 1].map((c) => {
    const noise = voices.map((v) => voice(v, c));
    const error = coded ? voices.map((v) => voice(v, c, v.seed + 50).map((x) => x * 10 ** (-10 / 20))) : [];
    return Float32Array.from({ length: 48000 }, (_, i) => 0.05 * Math.sin((2 * Math.PI * (toneHz + 110 * c) * i) / 48000)
      + [...noise, ...error].reduce((s, x) => s + x[i], 0));
  });
  return { sound: sound(false), coded: sound(true) };
}

function filmOfNoise({ cut, ...options } = {}) {
  const { sound, coded } = noiseSoundtrack(options);
  const scale = 10 ** (normalizeLoudness(audio(sound.map((x) => x.slice())), 'mp4a').gain / 20);
  return coded.map((x) => (cut ? lowPass(x, cut) : x).map((v) => v * scale));
}

/** `x` through a linear-phase low-pass at `hz`: a 511-tap Blackman-windowed sinc, as steep as a codec's cut. */
function lowPass(x, hz) {
  const M = 255, w = (2 * hz) / 48000;
  const h = Array.from({ length: 2 * M + 1 }, (_, j) => {
    const t = j - M, blackman = 0.42 - 0.5 * Math.cos((Math.PI * j) / M) + 0.08 * Math.cos((2 * Math.PI * j) / M);
    return (t ? Math.sin(Math.PI * w * t) / (Math.PI * t) : w) * blackman;
  });
  return x.map((_, i) => { let y = 0; for (let j = 0; j <= 2 * M; j++) { const k = i + j - M; if (k >= 0 && k < x.length) y += h[j] * x[k]; } return y; });
}

test('a noise voice replays by what a perceptual codec keeps of it, and a different one still differs', async () => {
  const rendered = noiseSoundtrack().sound;
  const own = await soundInPage({ rendered, decoded: filmOfNoise() });
  const [noise, total] = own.blocks.reduce(([n, s], b) => [n + b[2], s + b[0]], [0, 0]);
  assert.ok(noise > 0.9 * total, `the noise voices are noise-like bands: ${noise / total} of the energy`);
  // Each codec's film is compared as replay compares it: the sparse-noise allowance for AAC only.
  for (const codec of ['mp4a', 'Opus']) {
    const heard = soundVerdict(await soundInPage({ rendered, decoded: filmOfNoise() }, codec), codec);
    assert.equal(heard.match, true, `${codec}: ${heard.detail}`);
    assert.match(heard.detail, /in its noise-like bands, within 3 dB of its waveform, together and in each band under 14 kHz within 25 dB of its block, and 18 dB of its levels \(47 blocks, worst /);
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

test('a soundtrack is judged below the band its codec kept, measured from the film, and a different one still differs', async () => {
  assert.deepEqual(SOUND_CUT, { kept: 2, lost: 10, quiet: 60, above: 12000 });
  // A hi-hat reaching past 20 kHz, and a film whose codec cut it at 18.6 kHz.
  const rendered = noiseSoundtrack({ hat: {} }).sound;
  const own = await soundInPage({ rendered, decoded: filmOfNoise({ hat: {}, cut: 18600 }) });
  assert.equal(own.cut, 18000, 'judged up to the band edge under the cut');
  for (const codec of ['mp4a', 'Opus']) {
    const heard = soundVerdict(await soundInPage({ rendered, decoded: filmOfNoise({ hat: {}, cut: 18600 }) }, codec), codec);
    assert.equal(heard.match, true, `${codec}: ${heard.detail}`);
    assert.match(heard.detail, /decodes to its recipe's 48000 samples and, below 18\.00 kHz, where its codec kept the render, every block within /);
  }
  // Judged over the whole band, the same film differs: the cut is the cause.
  const whole = soundVerdict(await soundInPage({ rendered, decoded: filmOfNoise({ hat: {}, cut: 18600 }) }, 'mp4a', { ...SOUND_CUT, above: 24000 }), 'mp4a');
  assert.equal(whole.match, false, whole.detail);
  assert.equal((await soundInPage({ rendered, decoded: filmOfNoise({ hat: {} }) })).cut, null, 'a film that kept every band has no cut');

  // A cut under SOUND_CUT.above, one with no kept band under it, or one that
  // falls over more than a band, is no codec's.
  const gentle = (x) => {
    const w = (2 * Math.PI * 16000) / 48000, alpha = Math.sin(w) / Math.SQRT2, a0 = 1 + alpha, b = (1 - Math.cos(w)) / 2;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    return x.map((v) => { const y = (b * v + 2 * b * x1 + b * x2 + 2 * Math.cos(w) * y1 - (1 - alpha) * y2) / a0; [x2, x1, y2, y1] = [x1, v, y1, y]; return y; });
  };
  for (const [what, film] of [['a cut at 9 kHz', filmOfNoise({ hat: {}, cut: 9000 })], ['a missing hat', filmOfNoise({ hat: { level: 0 }, cut: 18600 })],
    ['a gentle low-pass at 16 kHz', filmOfNoise({ hat: {} }).map(gentle)]]) {
    const s = await soundInPage({ rendered, decoded: film });
    assert.equal(s.cut, null, what);
    assert.equal(soundVerdict(s, 'mp4a').match, false, what);
  }

  // 159's refusals under a cut, then the hat's own, where it leads the noise.
  const loud = noiseSoundtrack({ hat: { level: 1 } }).sound;
  for (const [what, options, recipe = rendered] of [['a tone moved from 440 to 466 Hz', { toneHz: 466 }], ['another noise', { low: { seed: 7 } }], ['a missing voice', { low: null }],
    ['a voice in another band', { high: { hz: 5000 } }], ['a voice 6 dB louder', { high: { level: 2 } }], ['a voice 6 dB quieter', { high: { level: 0.5 } }],
    ['another hat', { hat: { seed: 9, level: 1 } }, loud], ['a hat 6 dB louder', { hat: { level: 2 } }, loud], ['a hat 6 dB quieter', { hat: { level: 0.5 } }, loud]]) {
    for (const codec of ['mp4a', 'Opus']) {
      const s = await soundInPage({ rendered: recipe, decoded: filmOfNoise({ hat: {}, ...options, cut: 18600 }) }, codec);
      assert.equal(s.cut, 18000, `${what}, ${codec}: judged under the cut`);
      const heard = soundVerdict(s, codec);
      assert.equal(heard.match, false, `${what}, ${codec}: ${heard.detail}`);
      assert.match(heard.detail, /^the soundtrack differs from its recipe at \d+\.\d{3} s: /);
    }
  }
});

test('each noise-like band and the rest of a block keep their own waveform, so a quiet voice replaced or a tone moved under loud noise still differs', async () => {
  // The hat alone at 0.3 comes 8.3 dB under the two other noise voices.
  const hat = (under) => ({ level: 0.3 * 10 ** ((8.3 - under) / 20) });
  const judged = async (recipe, film, codec) => soundVerdict(await soundInPage({ rendered: noiseSoundtrack(recipe).sound, decoded: filmOfNoise(film) }, codec), codec);
  for (const codec of ['mp4a', 'Opus']) {
    for (const under of [8, 10, 14]) {
      const own = await judged({ hat: hat(under) }, { hat: hat(under) }, codec);
      assert.equal(own.match, true, `a hat ${under} dB under the other noise, ${codec}: ${own.detail}`);
      const other = await judged({ hat: hat(under) }, { hat: { ...hat(under), seed: 9 } }, codec);
      assert.equal(other.match, false, `a hat ${under} dB under the other noise, from another seed, ${codec}`);
      assert.match(other.detail, /, and its noise-like band at \d+\.\d\d to \d+\.\d\d kHz follows the render's waveform at -?\d+\.\d dB, under 3 dB$/);
    }
    // A tone 21 dB under a hat, alone.
    const loud = { low: null, high: null, hat: { level: 0.97 } };
    assert.equal((await judged(loud, loud, codec)).match, true, `a tone under a loud hat, ${codec}`);
    const moved = await judged(loud, { ...loud, toneHz: 466 }, codec);
    assert.equal(moved.match, false, `a tone moved from 440 to 466 Hz under a hat 21 dB louder, ${codec}`);
    // AAC's floor already names it; Opus's 15 dB passed it before the rest was judged on its own.
    if (codec === 'Opus') assert.match(moved.detail, /, and outside its noise-like bands it follows the render's waveform at -?\d+\.\d dB, under 10 dB$/);
  }
});

test('a noise-like band a codec may not keep is judged only with the others: 41 dB under its block, or above 14 kHz', async () => {
  // A tone over a noise bed from 1.5 to 6 kHz, a quiet noise across 9.75 to
  // 10.5 kHz and another across 18 to 18.75 kHz, each cut wider than those
  // bands so they stay noise-like; the film holds each noise with another 10 dB under it.
  const bands = new Map();
  const band = (seed, lo, hi) => {
    const key = [seed, lo, hi].join();
    if (!bands.has(key)) { const w = whiteNoise(48000, seed), under = lowPass(w, lo); bands.set(key, lowPass(w, hi).map((v, i) => v - under[i])); }
    return bands.get(key);
  };
  const voices = [[1, 1500, 6000, 0.5], [3, 9500, 10750, 0.02], [5, 17750, 19000, 0.15]];
  // Voice `other` comes from another seed.
  const mix = (coded, other = -1) => [0, 1].map((c) => Float32Array.from({ length: 48000 }, (_, i) => 0.2 * Math.sin((2 * Math.PI * (440 + 110 * c) * i) / 48000)
    + voices.reduce((s, [seed, lo, hi, level], v) => {
      const at = v === other ? seed + 20 : seed;
      return s + level * (band(at * 2 + c, lo, hi)[i] + (coded ? 10 ** (-10 / 20) * band((at + 50) * 2 + c, lo, hi)[i] : 0));
    }, 0)));
  const rendered = mix(false), scale = 10 ** (normalizeLoudness(audio(rendered.map((x) => x.slice())), 'Opus').gain / 20);
  for (const [what, other] of [['its own film', -1], ['the quiet noise from another seed', 1], ['the noise above 14 kHz from another seed', 2]]) {
    const heard = soundVerdict(await soundInPage({ rendered, decoded: mix(true, other).map((x) => x.map((v) => v * scale)) }, 'Opus'), 'Opus');
    assert.equal(heard.match, true, `${what}: ${heard.detail}`);
    assert.match(heard.detail, /in its noise-like bands, .* \(47 blocks, /, `${what} is judged by its noise-like bands`);
  }
});

test('a soundtrack is judged without its mean, which Opus removes', async () => {
  const rendered = tone(48000).map((x) => x.map((v, i) => (i < 24000 ? v + 0.05 : v)));
  const scale = 10 ** (normalizeLoudness(audio(rendered.map((x) => x.slice())), 'Opus').gain / 20);
  const heard = soundVerdict(await soundInPage({ rendered, decoded: tone(48000).map((x) => x.map((v) => v * scale)) }, 'Opus'), 'Opus');
  assert.equal(heard.match, true, heard.detail);
});

test('tones a noise bed masks may keep their waveform only under that noise, and a different soundtrack still differs', async () => {
  assert.deepEqual(SOUND_MASK_DB, { mp4a: -6, Opus: -3 });
  // Short chirps every 40 ms, rising in 1 ms and falling to -60 dB over 30 ms,
  // each at its own pitch, over a noise bed in their band. As a codec's error
  // under the noise that masks it, the film adds another noise `error` dB under
  // the bed and the chirps again 18 dB under them, which alone leaves blocks at 18 dB.
  const pitches = [1300, 2100, 1700, 2400, 1500, 1900];
  const grains = ({ skip = -1, shift = 1 } = {}) => signal(48000, (i, c) => {
    const k = Math.floor(i / 1920), t = i - k * 1920;
    if (k === skip || t >= 1440) return 0;
    return (0.08 + 0.02 * c) * Math.min(1, t / 48) * Math.exp((-Math.log(1000) * t) / 1440) * Math.sin((2 * Math.PI * pitches[k % 6] * shift * t) / 48000);
  });
  const bed = (seed) => [0, 1].map((c) => bandPass(whiteNoise(48000, seed * 2 + c), 1800, 1).map((v) => 0.1 * v));
  const mix = (...parts) => [0, 1].map((c) => Float32Array.from({ length: 48000 }, (_, i) => parts.reduce((s, p) => s + p[c][i], 0)));
  const rendered = mix(grains(), bed(1));
  const scale = 10 ** (normalizeLoudness(audio(rendered.map((x) => x.slice())), 'mp4a').gain / 20);
  const film = (parts, error = 14, tone = 18) => mix(...parts, bed(40).map((x) => x.map((v) => v * 10 ** (-error / 20))), grains().map((x) => x.map((v) => v * 10 ** (-tone / 20)))).map((x) => x.map((v) => v * scale));
  const own = await soundInPage({ rendered, decoded: film([grains(), bed(1)]) });
  const heard = soundVerdict(own, 'mp4a');
  assert.equal(heard.match, true, heard.detail);
  assert.match(heard.detail, / or, in its other bands, 6 dB under the render's own noise \(\d+ blocks\)$/);
  assert.equal(soundVerdict(await soundInPage({ rendered, decoded: film([grains(), bed(1)]) }, 'mp4a', SOUND_CUT, SOUND_VOICE, -Infinity), 'mp4a').match, false,
    'without the mask the same film differs');
  for (const [what, parts, error] of [['its bed from another seed', [grains(), bed(9)]], ['one chirp missing', [grains({ skip: 12 }), bed(1)]],
    ['its chirps a semitone higher', [grains({ shift: 2 ** (1 / 12) }), bed(1)]], ['the codec error 3 dB under the bed', [grains(), bed(1)], 3]]) {
    const other = soundVerdict(await soundInPage({ rendered, decoded: film(parts, error) }), 'mp4a');
    assert.equal(other.match, false, `${what}: ${other.detail}`);
  }
});

test('an Opus block leaves out a tonal band only where its difference lies 3 dB or more under the render\'s own noise there', async () => {
  // Whole blocks of a tone 10 dB over 16 fixed sines in its own band, 1.5 to
  // 2.25 kHz, and a quiet noise elsewhere; the film adds 16 other sines in that
  // band, `under` dB under the render's.
  const n = 46 * SOUND_BLOCK, sines = (seed, level, c) => { const phase = whiteNoise(16, seed * 2 + c); return (i) => phase.reduce((s, p, k) => s + level * Math.sin((2 * Math.PI * (32 + k) * i) / SOUND_BLOCK + Math.PI * p), 0); };
  const quiet = [0, 1].map((c) => whiteNoise(n, 90 + c)), noise = [0, 1].map((c) => sines(1, 0.01, c));
  const rendered = signal(n, (i, c) => 0.01 * Math.sqrt(160) * Math.sin((2 * Math.PI * 40 * i) / SOUND_BLOCK) + noise[c](i) + 1e-4 * quiet[c][i]);
  const scale = 10 ** (normalizeLoudness(audio(rendered.map((x) => x.slice())), 'Opus').gain / 20);
  const film = (under) => { const extra = [0, 1].map((c) => sines(5, 0.01 * 10 ** (-under / 20), c)); return levelled(rendered, 'Opus').map((x, c) => x.map((v, i) => v + scale * extra[c](i))); };
  const judged = async (under, mask) => soundVerdict(await soundInPage({ rendered, decoded: film(under) }, 'Opus', SOUND_CUT, SOUND_VOICE, mask), 'Opus');
  const own = await judged(4.5);
  assert.equal(own.match, true, own.detail);
  assert.match(own.detail, / or, in its other bands, 3 dB under the render's own noise \(46 blocks\)$/);
  assert.equal((await judged(4.5, SOUND_MASK_DB.mp4a)).match, false, 'at the AAC mask the same film differs');
  const above = await judged(1.5);
  assert.equal(above.match, false, above.detail);
  assert.match(above.detail, /^the soundtrack differs from its recipe at 0\.000 s: that block decodes \d+\.\d dB from the render, under the 15 dB floor for Opus$/);
});

/** `film`, a coded copy of `rendered`, as the export levels it for `codec`: the render levelled, and the codec's difference at the render's gain. */
const levelledFilm = (rendered, film, codec = 'mp4a') => {
  const scale = 10 ** (normalizeLoudness(audio(rendered.map((x) => x.slice())), codec).gain / 20);
  return levelled(rendered, codec).map((x, c) => x.map((v, i) => v + scale * (film[c][i] - rendered[c][i])));
};
/** The sparse-noise rules hold for both codecs: each judged with its own levelling and mask. */
const CODECS = ['mp4a', 'Opus'];

test('a band of noise just under the noise-like flatness, between noise-like bands, is judged as noise, and a tone there moved, dropped or 6 dB quieter still differs', async () => {
  assert.deepEqual(SOUND_SPARSE, { near: 0.2, onset: 6, envelope: 12 });
  // A noise voice about 3 kHz with a tone in its 3 to 3.75 kHz band, a little
  // louder than the noise there; the film adds another noise 9 dB under the
  // voice, as AAC codes a noise by its levels. Plain noise falls under the
  // flatness in some bands by chance, and so does the tone's band.
  const voice = (seed) => [0, 1].map((c) => bandPass(whiteNoise(48000, seed * 2 + c), 3000, 0.9).map((v) => 0.3 * v));
  const noise = voice(1), error = voice(50);
  const mix = (amp, hz = 3093.75, coded = true) => [0, 1].map((c) => Float32Array.from({ length: 48000 }, (_, i) => noise[c][i]
    + amp * Math.sin((2 * Math.PI * hz * i) / 48000) + (coded ? 10 ** (-9 / 20) * error[c][i] : 0)));
  const rendered = mix(0.065, undefined, false);
  const own = await soundInPage({ rendered, decoded: levelledFilm(rendered, mix(0.065)) });
  assert.ok(own.blocks.filter((b) => b[10] === 4).length >= 10, 'the tone\'s band is near in many blocks');
  const heard = soundVerdict(own, 'mp4a');
  assert.equal(heard.match, true, heard.detail);
  // As the seams' films were judged before: a band under the flatness counts as
  // a tone, and its difference misses the floor or its own 10 dB.
  const before = soundVerdict(await soundInPage({ rendered, decoded: levelledFilm(rendered, mix(0.065)) }, 'mp4a', SOUND_CUT, SOUND_VOICE, SOUND_MASK_DB.mp4a, false, null), 'mp4a');
  assert.equal(before.match, false, 'without the allowance the same film differs');
  assert.match(before.detail, /under the 25 dB floor for AAC(, and outside its noise-like bands it follows the render's waveform at \d\.\d dB, under 10 dB)?$/);
  for (const codec of CODECS) {
    const itself = soundVerdict(await soundInPage({ rendered, decoded: levelledFilm(rendered, mix(0.065), codec) }, codec), codec);
    assert.equal(itself.match, true, `${codec}: ${itself.detail}`);
    for (const [what, film, named] of [['the tone moved a bin', mix(0.065, 3140.625), /follows? the render's waveform at -?\d+\.\d dB, under 3 dB$/], ['the tone dropped', mix(0), /follows? the render's waveform at -?\d+\.\d dB, under 3 dB$/],
      ['the tone 6 dB quieter', mix(0.0325), /its band at 3\.00 to 3\.75 kHz, nearly noise-like, keeps the render's level at \d+\.\d dB, under 12 dB$/]]) {
      const other = soundVerdict(await soundInPage({ rendered, decoded: levelledFilm(rendered, film, codec) }, codec), codec);
      assert.equal(other.match, false, `${what}, ${codec}: ${other.detail}`);
      assert.match(other.detail, named, `${what}, ${codec}`);
    }
  }
});

test('a near band under 25 dB of its block is judged only with the other noise-like bands, as a quiet noise-like band is', async () => {
  // The voice and tone of the test above, 24 dB quieter, under a loud noise
  // voice about 10 kHz whose film adds another noise `under` dB under it, so
  // the block lies under the codec's floor. The film moves the quiet tone a
  // bin, which its band alone would refuse.
  const steep = (x) => bandPass(bandPass(bandPass(x, 10000, 2), 10000, 2), 10000, 2);
  const voice = (seed, hz, amp) => [0, 1].map((c) => bandPass(whiteNoise(48000, seed * 2 + c), hz, 0.9).map((v) => amp * v));
  const loud = (seed) => [0, 1].map((c) => steep(whiteNoise(48000, seed * 2 + c)));
  const noise = voice(1, 3000, 0.3), error = voice(50, 3000, 0.3), high = loud(5), highError = loud(60);
  const quiet = 10 ** (-24 / 20);
  for (const [codec, under] of [['mp4a', 20], ['Opus', 12]]) {
    const mix = (hz, coded) => [0, 1].map((c) => Float32Array.from({ length: 48000 }, (_, i) => high[c][i] + quiet * (noise[c][i] + 0.065 * Math.sin((2 * Math.PI * hz * i) / 48000))
      + (coded ? 10 ** (-under / 20) * highError[c][i] + quiet * 10 ** (-9 / 20) * error[c][i] : 0)));
    const rendered = mix(3093.75, false), decoded = levelledFilm(rendered, mix(3140.625, true), codec);
    const anyShare = await soundInPage({ rendered, decoded }, codec, SOUND_CUT, { ...SOUND_VOICE, share: -100 });
    const quietNear = anyShare.blocks.filter((b) => b[10] === 4 && b[11] < b[0] * 10 ** (SOUND_VOICE.share / 10)).length;
    assert.ok(quietNear >= 10, `${codec}: the tone's band is near and under 25 dB of its block in ${quietNear} blocks`);
    assert.equal(soundVerdict(anyShare, codec).match, false, `${codec}: judged alone, the moved tone differs`);
    const own = await soundInPage({ rendered, decoded }, codec);
    const heard = soundVerdict(own, codec);
    assert.equal(heard.match, true, `${codec}: ${heard.detail}`);
    assert.equal(own.blocks.filter((b) => b[10] === 4).length, 0, `${codec}: the quiet near band is never judged alone`);
  }
});

test('a near band beside an onset is still judged on its own, so a tone there moved, dropped or 6 dB quieter differs beside a click', async () => {
  // The voice and tone of the near-band test, with a click in every block: an
  // eighth of a block of steep noise about 10 kHz, 12 times the voice's
  // amplitude, the same in the render and the film, so every block lies
  // beside an onset. The click's bands carry no difference, so the noise-like
  // bands together keep their waveform and their levels, and only the tone's
  // band judged on its own refuses a changed tone: judged with the others, as
  // a noise-like band is beside an onset, the moved tone would match.
  const steep = (x) => bandPass(bandPass(bandPass(x, 10000, 2), 10000, 2), 10000, 2);
  const voice = (seed) => [0, 1].map((c) => bandPass(whiteNoise(48000, seed * 2 + c), 3000, 0.9).map((v) => 0.3 * v));
  const noise = voice(1), error = voice(50);
  const click = [0, 1].map((c) => steep(whiteNoise(48000, 10 + c)).map((v, i) => { const t = (i % SOUND_BLOCK) - 448; return t >= 0 && t < 128 ? 12 * v * Math.sin((Math.PI * t) / 128) : 0; }));
  const mix = (amp, hz = 3093.75, coded = true) => [0, 1].map((c) => Float32Array.from({ length: 48000 }, (_, i) => noise[c][i] + click[c][i]
    + amp * Math.sin((2 * Math.PI * hz * i) / 48000) + (coded ? 10 ** (-9 / 20) * error[c][i] : 0)));
  const rendered = mix(0.065, undefined, false);
  const own = await soundInPage({ rendered, decoded: levelledFilm(rendered, mix(0.065)) });
  assert.ok(own.blocks.every((b) => b[9] >= 1), 'every block lies beside an onset');
  assert.ok(own.blocks.filter((b) => b[10] === 4).length >= 10, 'the tone\'s band is near and judged on its own in many blocks');
  const heard = soundVerdict(own, 'mp4a');
  assert.equal(heard.match, true, heard.detail);
  const byWaveform = /its noise-like band at 3\.00 to 3\.75 kHz follows the render's waveform at -?\d+\.\d dB, under 3 dB$/;
  const byItself = /its (?:noise-like band at 3\.00 to 3\.75 kHz follows the render's waveform at -?\d+\.\d dB, under 3|band at 3\.00 to 3\.75 kHz, nearly noise-like, keeps the render's level at \d+\.\d dB, under 12) dB$/;
  for (const codec of CODECS) {
    const itself = soundVerdict(await soundInPage({ rendered, decoded: levelledFilm(rendered, mix(0.065), codec) }, codec), codec);
    assert.equal(itself.match, true, `${codec}: ${itself.detail}`);
    for (const [what, film, named] of [['the tone moved a bin', mix(0.065, 3140.625), byWaveform], ['the tone dropped', mix(0), byWaveform], ['the tone 6 dB quieter', mix(0.0325), byItself]]) {
      const other = soundVerdict(await soundInPage({ rendered, decoded: levelledFilm(rendered, film, codec) }, codec), codec);
      assert.equal(other.match, false, `${what}, ${codec}: ${other.detail}`);
      assert.match(other.detail, named, `${what}, ${codec}`);
    }
  }
});

test('beside an onset noise-like bands are judged together, and their levels under 14 kHz within 12 dB, as AAC coded the seams\' sparse noise contacts, and a changed contact still differs', async () => {
  // Contacts as the site's seams sound them: twenty 4 ms bursts of seeded
  // noise falling to -60 dB, band-passed about `hz`, over a quiet bed, and a
  // loud breath that stops at a block's start. As AAC coded the seams' films
  // beside an onset, the film adds another burst train 12 dB under the
  // contacts, keeps their band from 5.25 to 6 kHz only in part, at 0 to 3 dB
  // and up to 3 dB off in level, and puts a quiet 16.5 kHz tone, louder than
  // the render there, in the block after the breath stops.
  const N = 48000, stop = 36 * SOUND_BLOCK;
  const contacts = ({ hz = 3500, level = 0.5, seed = 1, moved = -1, by = 0, dropped = -1, q = 0.9, passes = 1 } = {}) => [0, 1].map((c) => {
    const x = new Float32Array(N), jitter = whiteNoise(20, 7), n = whiteNoise(N, seed * 2 + c);
    for (let k = 0; k < 20; k++) {
      if (k === dropped) continue;
      const at = Math.round((0.02 + 0.045 * k + 0.01 * jitter[k]) * 48000) + (k === moved ? by : 0);
      for (let i = 0; i < 192 && at + i < N; i++) x[at + i] += level * Math.min(1, i / 48) * Math.exp((-Math.log(1000) * i) / 192) * n[at + i];
    }
    return Array.from({ length: passes }).reduce((y) => bandPass(y, hz, q), x);
  });
  const bed = [0, 1].map((c) => bandPass(whiteNoise(N, 40 + c), 1500, 0.7).map((v) => 0.004 * v));
  const breath = [0, 1].map((c) => bandPass(whiteNoise(N, 60 + c), 2000, 0.5).map((v, i) => (i >= 28 * SOUND_BLOCK && i < stop ? 0.4 * v : 0)));
  const mix = (...parts) => [0, 1].map((c) => Float32Array.from({ length: N }, (_, i) => parts.reduce((s, p) => s + p[c][i], 0)));
  const narrow = (x) => x.map((ch) => bandPass(ch, 5625, 7.5));
  const coded = (options = {}) => {
    const own = contacts(options), kept = narrow(own), other = narrow(contacts({ seed: 90 }));
    const error = contacts({ seed: 70 }).map((x) => x.map((v) => v * 10 ** (-12 / 20)));
    const birdie = [0, 1].map(() => Float32Array.from({ length: N }, (_, i) => (i >= stop && i < stop + SOUND_BLOCK ? 0.004 * Math.sin((2 * Math.PI * 16500 * i) / 48000) * Math.sin((Math.PI * (i - stop)) / SOUND_BLOCK) : 0)));
    return mix(own, bed, breath, error, birdie).map((x, c) => x.map((v, i) => v - 0.45 * kept[c][i] + 0.5 * other[c][i]));
  };
  const rendered = mix(contacts(), bed, breath);
  const own = await soundInPage({ rendered, decoded: levelledFilm(rendered, coded()) });
  const heard = soundVerdict(own, 'mp4a');
  assert.equal(heard.match, true, heard.detail);
  assert.match(heard.detail, /, beside an onset 12 dB of its levels under 14 kHz \(\d+ of those blocks, worst \d+\.\d dB\)$/);
  // Judged as before, a band alone, the levels within 18 dB and the tone after the breath each refuse it.
  const before = await soundInPage({ rendered, decoded: levelledFilm(rendered, coded()) }, 'mp4a', SOUND_CUT, SOUND_VOICE, SOUND_MASK_DB.mp4a, false, null);
  const refused = before.blocks.map((b, i) => [i, soundVerdict({ ...before, blocks: [b], length: [SOUND_BLOCK, SOUND_BLOCK] }, 'mp4a')]).filter(([, v]) => !v.match);
  assert.ok(refused.some(([, v]) => / and its noise-like band at 5\.25 to 6\.00 kHz follows the render's waveform at -?\d+\.\d dB, under 3 dB$/.test(v.detail)), 'a band alone');
  const after = refused.find(([i]) => i === 36);
  assert.ok(after, 'the block after the breath stops');
  const levels = /, and its noise-like bands keep the render's levels at (\d+\.\d) dB, under 18 dB$/.exec(after[1].detail);
  assert.ok(levels && Number(levels[1]) < SOUND_SPARSE.envelope, `by its levels above 14 kHz, under 12 dB: ${after[1].detail}`);
  for (const codec of CODECS) {
    const itself = soundVerdict(await soundInPage({ rendered, decoded: levelledFilm(rendered, coded(), codec) }, codec), codec);
    assert.equal(itself.match, true, `${codec}: ${itself.detail}`);
    for (const [what, options, named] of [['a contact 5 ms late', { moved: 6, by: 240 }, /its noise-like bands follow the render's waveform at -?\d+\.\d dB, under 3 dB$/],
      ['a contact dropped', { dropped: 6 }, /its noise-like bands follow the render's waveform at -?\d+\.\d dB, under 3 dB$/],
      ['the contacts an octave higher', { hz: 7000 }, /its noise-like bands follow the render's waveform at -?\d+\.\d dB, under 3 dB$/],
      ['the contacts from another seed', { seed: 3 }, /its noise-like bands follow the render's waveform at -?\d+\.\d dB, under 3 dB$/],
      ['the contacts 3 dB quieter', { level: 0.5 / Math.SQRT2 }, /, and beside an onset its noise-like bands under 14 kHz keep the render's levels at \d+\.\d dB, under 12 dB$/]]) {
      const other = soundVerdict(await soundInPage({ rendered, decoded: levelledFilm(rendered, coded(options), codec) }, codec), codec);
      assert.equal(other.match, false, `${what}, ${codec}: ${other.detail}`);
      assert.match(other.detail, named, `${what}, ${codec}`);
    }
  }
  // Each contact with a bright transient above 14 kHz, about ten times its
  // energy, the same in the film: noise-like energy beside the onset that no
  // level judges. The levels below 14 kHz are held to their own energy, not
  // to the block's, so the contacts 3 dB quieter still differ there.
  const bright = contacts({ hz: 18000, level: 2.8, seed: 11, q: 2, passes: 3 });
  const lit = mix(rendered, bright);
  const litOwn = await soundInPage({ rendered: lit, decoded: levelledFilm(lit, mix(coded(), bright)) });
  const onsetNoise = (s) => s.blocks.filter((b) => b[9] === 1).reduce((e, b) => e + b[2], 0);
  assert.ok(onsetNoise(litOwn) > 8 * onsetNoise(own), `the bright transients add noise-like energy beside the onsets: ${(onsetNoise(litOwn) / onsetNoise(own)).toFixed(1)} times`);
  for (const codec of CODECS) {
    const litHeard = soundVerdict(codec === 'mp4a' ? litOwn : await soundInPage({ rendered: lit, decoded: levelledFilm(lit, mix(coded(), bright), codec) }, codec), codec);
    assert.equal(litHeard.match, true, `${codec}: ${litHeard.detail}`);
    const litQuieter = soundVerdict(await soundInPage({ rendered: lit, decoded: levelledFilm(lit, mix(coded({ level: 0.5 / Math.SQRT2 }), bright), codec) }, codec), codec);
    assert.equal(litQuieter.match, false, `the contacts 3 dB quieter under bright transients, ${codec}: ${litQuieter.detail}`);
    assert.match(litQuieter.detail, /, and beside an onset its noise-like bands under 14 kHz keep the render's levels at \d+\.\d dB, under 12 dB$/, codec);
  }
});

test('a block under its floor matches only where the rest keeps it and its noise-like bands keep their waveform and levels', () => {
  assert.equal(SOUND_BAND, 16);
  assert.equal(SOUND_FLATNESS, 0.4);
  assert.deepEqual(SOUND_NOISE_DB, { waveform: 3, envelope: 18, rest: 10 });
  assert.deepEqual(SOUND_VOICE, { share: -25, below: 14000 });
  const at = (...blocks) => ({ rate: 48000, block: SOUND_BLOCK, channels: [2, 2], length: [SOUND_BLOCK * blocks.length, SOUND_BLOCK * blocks.length], blocks });
  // A block of energy 1 whose noise-like bands hold `noise` of it: the error
  // outside them `rest` dB under the block, and inside them `wave` dB under
  // their energy, with their levels `level` dB from the render's; its band 7,
  // holding half the noise, `alone` dB under its own energy.
  const noisy = ({ noise = 0.9, rest = 30, wave = 10, level = 25, alone = 10 } = {}) => {
    const inside = noise * 10 ** (-wave / 10);
    return [1, 10 ** (-rest / 10) + inside, noise, inside, noise * 10 ** (-level / 10), 7, noise / 2, (noise / 2) * 10 ** (-alone / 10)];
  };
  const differs = 'the soundtrack differs from its recipe at 0.000 s: that block decodes 10.4 dB from the render, under the 25 dB floor for AAC';
  assert.deepEqual(soundVerdict(at(noisy()), 'mp4a'), { match: true, detail: 'the AAC soundtrack decodes to its recipe\'s 1024 samples, every block within 25 dB of the render'
    + ' or, in its noise-like bands, within 3 dB of its waveform, together and in each band under 14 kHz within 25 dB of its block, and 18 dB of its levels (1 blocks, worst 10.0, 10.0 and 25.0 dB)' });
  assert.deepEqual(soundVerdict(at(noisy({ alone: 2.9 })), 'mp4a'),
    { match: false, detail: `${differs}, and its noise-like band at 5.25 to 6.00 kHz follows the render's waveform at 2.9 dB, under 3 dB` }, 'each band on its own');
  assert.match(soundVerdict(at(noisy().slice(0, 5).concat([-1, 0, 0])), 'mp4a').detail, /\(1 blocks, worst 10\.0, no band and 25\.0 dB\)$/, 'no band holds enough of its block');
  // The rest keeps its own waveform too, unless its difference is under the gate:
  // here it holds 1 of a block of 100, and differs from it by 0.2, 27 dB under the block.
  const restOf = (restError) => [100, restError + 9.9, 99, 9.9, 99 * 10 ** -2.5, -1, 0, 0];
  assert.deepEqual(soundVerdict(at(restOf(0.2)), 'mp4a'), { match: false, detail: 'the soundtrack differs from its recipe at 0.000 s: that block decodes 10.0 dB from the render,'
    + ' under the 25 dB floor for AAC, and outside its noise-like bands it follows the render\'s waveform at 7.0 dB, under 10 dB' }, 'a rest 7 dB from its render');
  assert.equal(soundVerdict(at(restOf(0.09)), 'mp4a').match, true, 'a rest 10.5 dB from its render');
  assert.equal(soundVerdict(at([1, 0.101, 1, 0.1, 1e-3, -1, 0, 0]), 'mp4a').match, true, 'a rest silent in the render, with a difference under the gate');
  assert.deepEqual(soundVerdict(at(noisy({ rest: 24.9 })), 'mp4a'), { match: false, detail: differs.replace('10.4', '10.3') }, 'the rest of the block keeps the codec floor');
  assert.equal(soundVerdict(at(noisy({ noise: 0.5, rest: 15.1 })), 'Opus').match, true, 'the Opus floor for the rest of an Opus block');
  assert.deepEqual(soundVerdict(at(noisy({ wave: 2.9 })), 'mp4a'),
    { match: false, detail: 'the soundtrack differs from its recipe at 0.000 s: that block decodes 3.3 dB from the render, under the 25 dB floor for AAC, and its noise-like bands follow the render\'s waveform at 2.9 dB, under 3 dB' });
  assert.deepEqual(soundVerdict(at(noisy({ level: 17.9 })), 'mp4a'),
    { match: false, detail: `${differs}, and its noise-like bands keep the render's levels at 17.9 dB, under 18 dB` });
  assert.deepEqual(soundVerdict(at([1, 0.091, 0, 0, 0]), 'mp4a'), { match: false, detail: differs }, 'a block without noise-like bands keeps the floor');
  // All the error in noise-like bands, the rest a rounding under zero.
  const rounded = soundVerdict(at([1, 0.09, 0.9, 0.09 * (1 + 1e-12), 0]), 'mp4a');
  assert.equal(rounded.match, true, rounded.detail);
  assert.doesNotMatch(rounded.detail, /other bands/, 'and no band needed the noise under it');
  // A block without noise-like bands, 20 dB from its render: the part of its
  // difference under the render's noise leaves it out of the floor, the rest not.
  const tonal = (masked) => [1, 0.01, 0, 0, 0, -1, 0, 0, masked];
  assert.match(soundVerdict(at(tonal(0.007)), 'mp4a').detail, /every block within 25 dB of the render or, in its other bands, 6 dB under the render's own noise \(1 blocks\)$/);
  assert.deepEqual(soundVerdict(at(tonal(0.0065)), 'mp4a'), { match: false, detail: 'the soundtrack differs from its recipe at 0.000 s: that block decodes 20.0 dB from the render, under the 25 dB floor for AAC' });
  // Opus leaves them out too, and names its own mask.
  const opus = [1, 0.08, 0, 0, 0, -1, 0, 0, 0.079];
  assert.equal(soundVerdict(at(opus), 'mp4a').match, true, 'AAC leaves the masked bands out');
  assert.match(soundVerdict(at(opus), 'Opus').detail, /every block within 15 dB of the render or, in its other bands, 3 dB under the render's own noise \(1 blocks\)$/);
  assert.deepEqual(soundVerdict(at([1, 0.08, 0, 0, 0, -1, 0, 0, 0.04]), 'Opus'), { match: false, detail: 'the soundtrack differs from its recipe at 0.000 s: that block decodes 11.0 dB from the render, under the 15 dB floor for Opus' });
  assert.match(soundVerdict(at([1, 0.2, 0, 0, 0, -1, 0, 0, 0.2]), 'mp4a').detail, /and outside its noise-like bands it follows the render's waveform at 7\.0 dB, under 10 dB$/, 'the masked rest still keeps its own waveform');
  const plain = [100, 0.1];
  assert.match(soundVerdict(at(plain, noisy()), 'mp4a').detail, /every block within 25 dB of the render \(worst 30\.0 dB\) or, in its noise-like bands, .* \(1 blocks, worst 10\.0, 10\.0 and 25\.0 dB\)$/);
});

test('a block within 1 dB over the AAC floor is judged by the noise rules too, so a crack\'s onset block reads the same either side of the floor', () => {
  const at = (...blocks) => ({ rate: 48000, block: SOUND_BLOCK, channels: [2, 2], length: [SOUND_BLOCK * blocks.length, SOUND_BLOCK * blocks.length], blocks });
  // A crack's onset block as AAC codes it, of energy 10, its plain figure `db`
  // by how much of the crack it holds: noise-like bands holding 0.6 of it
  // beside an onset, with 0.7 of the difference, their levels 20 dB from the
  // render's. Each difference here lies over the gate.
  const crack = (db) => { const e = 10 ** (1 - db / 10); return [10, e, 6, 0.7 * e, 0.06, -1, 0, 0, 0, 1, -1, 0, 0]; };
  const tone = [100, 0.01];
  const worst = (block) => {
    const heard = soundVerdict(at(tone, block), 'mp4a');
    assert.equal(heard.match, true, heard.detail);
    return /every block within 25 dB of the render \(worst (-?[\d.]+) dB\)/.exec(heard.detail)[1];
  };
  // The same crack's block either side of the floor, as frame phase moves it.
  for (const db of [24.6, 25.16, 25.68, 25.94]) assert.equal(worst(crack(db)), '40.0', `a crack's block at ${db} dB leaves the plain worst to the tone`);
  assert.match(soundVerdict(at(tone, crack(25.5)), 'mp4a').detail, /\(1 blocks, 1 of them within 1 dB over the floor, worst 24\.8, no band and no block away from an onset\), beside an onset 12 dB of its levels under 14 kHz \(1 of those blocks, worst 20\.0 dB\)$/);
  assert.equal(worst(crack(26)), '26.0', 'a block 1 dB over the floor is judged by the floor alone');
  // So a block whose noise-like bands lose their waveform differs just over the floor as it does just under it.
  const lost = (db) => { const e = 10 ** (1 - db / 10); return [10, e, 0.03, 0.02, 1e-3, -1, 0, 0]; };
  assert.deepEqual(soundVerdict(at(lost(25.5)), 'mp4a'), { match: false, detail: 'the soundtrack differs from its recipe at 0.000 s: that block decodes 25.5 dB from the render,'
    + ' within 1 dB over the 25 dB floor for AAC, and its noise-like bands follow the render\'s waveform at 1.8 dB, under 3 dB' });
  assert.match(soundVerdict(at(lost(24.5)), 'mp4a').detail, /under the 25 dB floor for AAC, and its noise-like bands follow the render's waveform at 1\.8 dB, under 3 dB$/);
  assert.equal(soundVerdict(at(lost(26.5)), 'mp4a').match, true, 'over the band, the floor alone');
  // A near block whose noise-like bands keep their waveform still differs when the rest of it does not keep its own.
  const astray = (db) => [10, 10 ** (1 - db / 10), 9.9, 0.001, 0.01, -1, 0, 0, 0, 1];
  assert.match(soundVerdict(at(astray(25.5)), 'mp4a').detail, /within 1 dB over the 25 dB floor for AAC, and outside its noise-like bands it follows the render's waveform at 5\.7 dB, under 10 dB$/);
  assert.equal(soundVerdict(at(astray(26.5)), 'mp4a').match, true, 'over the band, the floor alone');
  // A block with no noise-like band has nothing else to be judged by. Opus takes the same 1 dB over its own floor.
  assert.equal(worst([10, 10 ** -1.55]), '25.5');
  const opus = soundVerdict(at(lost(15.5)), 'Opus');
  assert.equal(opus.match, false, 'an Opus block within 1 dB over its floor is judged by its noise-like bands');
  assert.match(opus.detail, /within 1 dB over the 15 dB floor for Opus/);
  assert.equal(soundVerdict(at(lost(16.5)), 'Opus').match, true, 'an Opus block over the band, by the floor alone');
  assert.deepEqual(SOUND_NEAR_DB, { mp4a: 1, Opus: 1 });
});

test('a near band keeps its own level within 12 dB, and beside an onset the noise-like bands keep theirs together within 12 dB instead of 18', () => {
  const at = (...blocks) => ({ rate: 48000, block: SOUND_BLOCK, channels: [2, 2], length: [SOUND_BLOCK * blocks.length, SOUND_BLOCK * blocks.length], blocks });
  // A block of energy 1, its noise-like bands 0.9 of it, 10 dB from their waveform, their levels `level` dB
  // from the render's; beside an onset or not; its near band 4 holding 0.1 of it, its level `near` dB off.
  const block = ({ level = 25, onset = 0, near = null } = {}) => [1, 0.091, 0.9, 0.09, 0.9 * 10 ** (-level / 10), -1, 0, 0, 0, onset,
    ...(near === null ? [-1, 0, 0] : [4, 0.1, 0.1 * 10 ** (-near / 10)])];
  const differs = 'the soundtrack differs from its recipe at 0.000 s: that block decodes 10.4 dB from the render, under the 25 dB floor for AAC';
  assert.equal(soundVerdict(at(block({ near: 12.1 })), 'mp4a').match, true, 'a near band 12.1 dB from its level');
  assert.deepEqual(soundVerdict(at(block({ near: 11.9 })), 'mp4a'),
    { match: false, detail: `${differs}, and its band at 3.00 to 3.75 kHz, nearly noise-like, keeps the render's level at 11.9 dB, under 12 dB` });
  assert.deepEqual(soundVerdict(at(block({ level: 15 })), 'mp4a'), { match: false, detail: `${differs}, and its noise-like bands keep the render's levels at 15.0 dB, under 18 dB` });
  assert.deepEqual(soundVerdict(at(block({ level: 15, onset: 1 })), 'mp4a'), { match: true, detail: 'the AAC soundtrack decodes to its recipe\'s 1024 samples, every block within 25 dB of the render'
    + ' or, in its noise-like bands, within 3 dB of its waveform, together and in each band under 14 kHz within 25 dB of its block, and 18 dB of its levels (1 blocks, worst 10.0, no band and no block away from an onset),'
    + ' beside an onset 12 dB of its levels under 14 kHz (1 of those blocks, worst 15.0 dB)' });
  assert.deepEqual(soundVerdict(at(block({ level: 11.9, onset: 1 })), 'mp4a'),
    { match: false, detail: `${differs}, and beside an onset its noise-like bands under 14 kHz keep the render's levels at 11.9 dB, under 12 dB` });
  assert.match(soundVerdict(at(block(), block({ level: 20, onset: 1 })), 'mp4a').detail, /\(2 blocks, worst 10\.0, no band and 25\.0 dB\), beside an onset 12 dB of its levels under 14 kHz \(1 of those blocks, worst 20\.0 dB\)$/);
  // Beside an onset with every noise-like band above 14 kHz, compareSound judged no level: the verdict says so.
  assert.match(soundVerdict(at(block({ onset: 2 })), 'mp4a').detail, /\(1 blocks, worst 10\.0, no band and no block away from an onset\), beside an onset 12 dB of its levels under 14 kHz \(1 with no noise-like band under 14 kHz, so no level judged\)$/);
  assert.match(soundVerdict(at(block({ level: 20, onset: 1 }), block({ level: 5, onset: 2 })), 'mp4a').detail, /beside an onset 12 dB of its levels under 14 kHz \(1 of those blocks, worst 20\.0 dB; 1 with no noise-like band under 14 kHz, so no level judged\)$/);
});

test('in an AAC film, a quiet block beside a block 12 dB or more louder matches where its difference lies 30 dB under that block, as AAC spreads a grain\'s noise into it', () => {
  const at = (...blocks) => ({ rate: 48000, block: SOUND_BLOCK, channels: [2, 2], length: [SOUND_BLOCK * blocks.length, SOUND_BLOCK * blocks.length], blocks });
  // Blocks of the AAC film of tests/fixtures/grain-film.cjs as installed Edge
  // 154 decoded them: a 20 ms grain's loudest block, the block after it, where
  // only its end and the codec's noise sound, and silence; then a 50 ms grain's.
  const twenty = [[97.26, 0.1164, 3.824, 0.008675, 0.0004669, 3, 1.734, 0.005681, 0.1077, 0, 4, 2.067, 0.0004192],
    [0.1845, 0.002697, 0.006041, 0.00006517, 0.000022, -1, 0, 0, 0, 1, -1, 0, 0], [0, 7.513e-9, 0, 0, 0, -1, 0, 0, 0, 2, -1, 0, 0]];
  const fifty = [[28.4, 0.01513, 0.01688, 0.0003964, 0.00007851, -1, 0, 0, 0.01473, 0, -1, 0, 0],
    [0.8482, 0.007793, 0.00751, 0.00002237, 0.00001092, -1, 0, 0, 0, 1, -1, 0, 0], [72.07, 0.002207, 0.02267, 0.00003512, 1.433e-7, -1, 0, 0, 0.002172, 0, -1, 0, 0]];
  const film = soundVerdict(at(...twenty, ...fifty), 'mp4a');
  assert.equal(film.match, true, film.detail);
  assert.match(film.detail, / or, beside a block 12 dB or more louder, differing 30 dB or more under it, whose noise AAC spreads \(2 blocks\)$/);
  // Judged as before, the film differed at the 20 ms grain's quiet block.
  const before = 'the soundtrack differs from its recipe at 0.021 s: that block decodes 18.3 dB from the render, under the 25 dB floor for AAC';
  assert.deepEqual(SOUND_SPILL_DB, { under: { mp4a: 30, Opus: 25 }, louder: 12 });
  assert.equal(soundVerdict(at(...twenty), 'Opus').match, true, 'over the Opus floor of 15 dB');
  // The quiet block `louder` dB under the loud one, its difference `difference` dB under it.
  const quiet = (difference, louder) => [twenty[0], [97.26 * 10 ** (-louder / 10), 97.26 * 10 ** (-difference / 10), 0, 0, 0], twenty[2]];
  assert.equal(soundVerdict(at(...quiet(26, 13)), 'Opus').match, true, 'Opus takes 25 dB');
  assert.deepEqual(soundVerdict(at(...quiet(24, 13)), 'Opus'), { match: false, detail: before.replace('18.3', '11.0').replace('25 dB floor for AAC', '15 dB floor for Opus') }, 'its difference 24 dB under the loud block');
  assert.equal(soundVerdict(at(...quiet(31, 13)), 'mp4a').match, true);
  assert.deepEqual(soundVerdict(at(...quiet(29, 13)), 'mp4a'), { match: false, detail: before.replace('18.3', '16.0') }, 'its difference 29 dB under the loud block');
  assert.deepEqual(soundVerdict(at(...quiet(35, 11)), 'mp4a'), { match: false, detail: before.replace('18.3', '24.0') }, 'the loud block 11 dB over its render');
  assert.deepEqual(soundVerdict(at(quiet(35, 13)[1], ...quiet(35, 13)), 'mp4a').match, true, 'a loud block after it counts too');
});

test('an Opus film of ambience grains replays: its bands beside an onset judged by the sparse-noise rules, and a grain\'s noise in the quiet block beside it 25 dB under that block', () => {
  const at = (...blocks) => ({ rate: 48000, block: SOUND_BLOCK, channels: [2, 2], length: [SOUND_BLOCK * blocks.length, SOUND_BLOCK * blocks.length], blocks });
  // Blocks of the Opus films of tests/fixtures/grain-film.cjs as installed Edge
  // 155 decoded them. At seed 3, 3.627 to 3.669 s: grains chirping over a faint
  // bed, the middle block between two only 10.3 dB louder, judged without the
  // sparse-noise rules, as an Opus film was judged before, then with them.
  const plain = [[22.29, 0.2498, 15.89, 0.2205, 0.0137, 4, 1.093, 0.05601, 0.02933, 0, -1, 0, 0],
    [2.064, 0.1031, 2.06, 0.1031, 0.01335, 8, 0.01404, 0.02335, 0, 0, -1, 0, 0],
    [18.53, 0.07851, 14.3, 0.07012, 0.00124, 4, 0.07037, 0.006824, 0.008394, 0, -1, 0, 0]];
  const sparse = [[22.29, 0.2498, 22.29, 0.2498, 0.01417, 3, 6.405, 0.02933, 0, 1, 3, 6.405, 0.0004788],
    [2.064, 0.1031, 2.06, 0.1031, 0.01338, -1, 0, 0, 0, 1, -1, 0, 0],
    [18.53, 0.07851, 18.53, 0.07851, 0.001613, 3, 4.226, 0.008394, 0, 1, 3, 4.226, 0.0003768]];
  assert.deepEqual(soundVerdict(at(...plain), 'Opus'), { match: false, detail: 'the soundtrack differs from its recipe at 0.021 s: that block decodes 13.0 dB from the render, under the 15 dB floor for Opus, and its noise-like band at 6.00 to 6.75 kHz follows the render\'s waveform at -2.2 dB, under 3 dB' });
  // At seed 1, 8.789 to 8.832 s, and at seed 6, 9.707 to 9.749 s: a quiet block
  // between two grains with no bed, its difference 42.7 and 28.2 dB under the
  // louder of them, the second the least of any of those films.
  const spread = [[40.38, 0.01318, 0.01516, 0.00002812, 0.000002022, -1, 0, 0, 0.01316, 0, -1, 0, 0],
    [0.01703, 0.00218, 0.0006069, 0.00003633, 0.000004131, -1, 0, 0, 0, 1, -1, 0, 0],
    [38.05, 0.003698, 0.01309, 0.000007371, 6.789e-7, -1, 0, 0, 0.00369, 0, -1, 0, 0]];
  const least = [[32.91, 0.1883, 32.91, 0.1883, 0.003157, 3, 0.1976, 0.003851, 0, 1, 3, 0.1976, 0.00002729],
    [0.3351, 0.05018, 0.008655, 0.00004807, 0.00000278, -1, 0, 0, 0, 1, -1, 0, 0],
    [30.7, 0.006751, 30.04, 0.006525, 0.003055, -1, 0, 0, 0.0002252, 1, -1, 0, 0]];
  const film = soundVerdict(at(...sparse, ...spread, ...least), 'Opus');
  assert.equal(film.match, true, film.detail);
  assert.match(film.detail, /, beside an onset 12 dB of its levels under 14 kHz \(1 of those blocks, worst \d+\.\d dB\) or, beside a block 12 dB or more louder, differing 25 dB or more under it, whose noise Opus spreads \(2 blocks\)$/);
  // The same blocks as AAC, whose rule takes 30 dB, still differ at the least.
  assert.deepEqual(soundVerdict(at(...least), 'mp4a'), { match: false, detail: 'the soundtrack differs from its recipe at 0.021 s: that block decodes 8.2 dB from the render, under the 25 dB floor for AAC' });
  // The quiet block's difference twice as loud, 25.2 dB under, still passes; four times, 22.2 dB under, differs.
  const louder = (k) => [least[0], [least[1][0], least[1][1] * k, ...least[1].slice(2)], least[2]];
  assert.equal(soundVerdict(at(...louder(2)), 'Opus').match, true);
  assert.deepEqual(soundVerdict(at(...louder(4)), 'Opus'), { match: false, detail: 'the soundtrack differs from its recipe at 0.021 s: that block decodes 2.2 dB from the render, under the 15 dB floor for Opus' });
});

test('a grain\'s coding noise in the quiet block after it replays as AAC, and a moved grain or louder noise there still differs', async () => {
  // Grains alone: a 20 ms sine at 1800 Hz rising over 1 ms and falling to
  // -60 dB, then out over 5 ms, starting 200 samples into every fourth block,
  // so its faint end rings into the next. The film adds noise over the whole
  // block after each grain's loudest one, `under` dB under that block, as AAC
  // spread a grain's noise.
  const period = 4 * SOUND_BLOCK, start = 200;
  const grains = (shift = 0) => signal(48000, (i, c) => {
    const t = (i % period) - start - shift;
    return t < 0 || t >= 1200 ? 0 : (0.3 - 0.05 * c) * Math.min(1, t / 48, (1200 - t) / 240) * Math.exp((-Math.log(1000) * Math.min(t, 960)) / 960) * Math.sin((2 * Math.PI * 1800 * t) / 48000);
  });
  // The noise is set against the render as the export levels and limits it.
  const rendered = grains(), noise = [0, 1].map((c) => whiteNoise(48000, 30 + c));
  const loud = levelled(rendered).reduce((e, x) => e + x.subarray(0, SOUND_BLOCK).reduce((a, v) => a + v * v, 0), 0);
  const film = (under, from = grains()) => levelled(from).map((x, c) => x.map((v, i) => v
    + ((i % period) >= SOUND_BLOCK && (i % period) < 2 * SOUND_BLOCK ? Math.sqrt((3 * loud * 10 ** (-under / 10)) / (2 * SOUND_BLOCK)) * noise[c][i] : 0)));
  const own = await soundInPage({ rendered, decoded: film(40) });
  const heard = soundVerdict(own, 'mp4a');
  assert.equal(heard.match, true, heard.detail);
  assert.match(heard.detail, /, whose noise AAC spreads \(12 blocks\)$/);
  assert.match(soundVerdict(own, 'Opus').detail, /, whose noise Opus spreads \(12 blocks\)$/);
  for (const [what, decoded] of [['the noise 24 dB under the grain', film(24)], ['the grains 1 ms late', film(40, grains(48))]]) {
    const s = await soundInPage({ rendered, decoded });
    for (const codec of ['mp4a', 'Opus']) {
      const other = soundVerdict(s, codec);
      assert.equal(other.match, false, `${what}, ${codec}: ${other.detail}`);
    }
  }
});

/**
 * A page served by check-browser's loopback server with `file`: `run`
 * evaluates each message in a context of its own whose fetch resolves against
 * the page's address, and records each message's length.
 */
async function pageFor(t, file) {
  const vm = require('node:vm');
  const { servePage } = require('../tools/check-browser.js');
  const server = await servePage('<title>replay</title>', file);
  t.after(() => server.close());
  const page = vm.createContext({ window: {}, fetch: (url) => fetch(new URL(url, server.url)) });
  const sent = [];
  const run = async (client, expression) => { sent.push(expression.length); return vm.runInContext(expression, page); };
  return { server, page, sent, run };
}

test('a replayed file reaches the page whole in one fetch from the loopback server, not in DevTools messages', async (t) => {
  const bytes = new Uint8Array(5 * 1024 * 1024 + 7).map((_, i) => (i * 131 + (i >> 9)) & 255);
  const { server, page, sent, run } = await pageFor(t, bytes);
  await sendBytes(null, bytes, run);
  assert.ok(Buffer.from(page.window.__replayBytes).equals(Buffer.from(bytes)), 'the page holds every byte, in order');
  assert.equal(sent.length, 1, 'one message');
  assert.ok(sent[0] < 200, 'which carries none of the file');
  // The server still serves nothing else, and the file only to GET.
  assert.equal((await fetch(server.url + 'package.json')).status, 404);
  assert.equal((await fetch(server.url + 'file', { method: 'POST' })).status, 404);
  // A page served without the file receives none of it, and the replay stops.
  const bare = await pageFor(t, null);
  await assert.rejects(sendBytes(null, bytes, bare.run), /^Error: replay: the page received 0 of the file's 5242887 bytes$/);
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
    { match: false, detail: 'the soundtrack differs from its recipe at 0.000 s: the render is silent in that block and the film is not' },
    'sound where the recipe is silent');
});

test('a verdict says a silent render or an exact match in words, never as an infinite dB', async (t) => {
  const at = (block) => ({ rate: 48000, block: SOUND_BLOCK, channels: [2, 2], length: [SOUND_BLOCK, SOUND_BLOCK], blocks: [block] });
  const start = 'the soundtrack differs from its recipe at 0.000 s: ';
  // Energy 1 with noise-like bands holding `noise` of it, `waveError` of
  // difference inside them and `envelope` of level error, `band` naming the
  // worst band; 0.01 of difference outside them lies 0.007 under the render's
  // noise, so the block passes.
  const exact = (noise, waveError, envelope, band = [-1, 0, 0]) => [1, 0.01 + waveError, noise, waveError, envelope, ...band, 0.007];
  await t.test('the render is silent in a block that differs', () => {
    const heard = soundVerdict(at([0, 1]), 'mp4a');
    assert.deepEqual(heard, { match: false, detail: start + 'the render is silent in that block and the film is not' });
    assert.doesNotMatch(heard.detail, /Infinity/);
  });
  await t.test('the render holds nothing outside its noise-like bands and the rest differs', () => {
    // The whole block is noise-like, and the difference outside it, 0.003, is above the gate.
    const heard = soundVerdict(at([1, 0.013, 1, 0.01, 1e-3, -1, 0, 0]), 'mp4a');
    assert.deepEqual(heard, { match: false, detail: start + 'that block decodes 18.9 dB from the render, under the 25 dB floor for AAC, and outside its noise-like bands the render is silent and the film is not' });
    assert.doesNotMatch(heard.detail, /Infinity/);
  });
  await t.test('the noise-like bands and their levels match exactly', () => {
    const heard = soundVerdict(at(exact(0.5, 0, 0)), 'mp4a');
    assert.equal(heard.match, true, heard.detail);
    assert.match(heard.detail, /\(1 blocks, worst no difference, no band and no difference\)/);
    assert.doesNotMatch(heard.detail, /Infinity/);
  });
  await t.test('a noise-like band matches exactly', () => {
    const heard = soundVerdict(at(exact(0.5, 0, 0.5 * 10 ** -2.5, [7, 0.25, 0])), 'mp4a');
    assert.equal(heard.match, true, heard.detail);
    assert.match(heard.detail, /\(1 blocks, worst no difference, no difference and 25\.0 dB\)/);
    assert.doesNotMatch(heard.detail, /Infinity/);
  });
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

test('a film of blank frames the browser stops seeking at frame 7 is a named mismatch, not a timeout', async () => {
  const vm = require('node:vm');
  const hz = 12, heads = Array.from({ length: 12 }, (_, i) => i / hz);
  // The page's 10 s wait for a seek runs out only when the element ignores the
  // seek, so no clock races the stand-in's seeks under load.
  let expire = null;
  // Every frame decodes blank and every redraw is blank, as a piece that starts
  // dark draws; the element never reports seeking to frame 7, as Edge did.
  const video = () => {
    const v = { videoWidth: 32, videoHeight: 24 };
    Object.defineProperties(v, {
      src: { get: () => 'blob:film', set() { setTimeout(() => v.onloadeddata(), 0); } },
      currentTime: { set(s) { setTimeout(Math.floor(s * hz) !== 7 ? () => v.onseeked() : expire, 0); } },
    });
    return v;
  };
  const canvas = () => ({ getContext: () => ({ clearRect() {}, drawImage() {}, getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) }) });
  const api = { examples: { a: { name: 'a', time: { hz } } }, piece: { validate: (p) => p, atBox: (p) => p, solve: () => ({}) }, render: { playheads: () => heads, drawFrame() {} } };
  const recipe = JSON.stringify({ piece: 'a', seed: 1, film: { scale: 1 } });
  const frames = heads.map((_, i) => i), seeks = frames.map((i) => (i + 0.5) / hz);
  for (const [name, call] of [['compareFilm', `(${compareFilm})(new Uint8Array(3), ${recipe}, ${JSON.stringify(frames)}, 0)`],
    ['compareWebm', `(${compareWebm})(new Uint8Array(3), ${recipe}, ${JSON.stringify(frames)}, ${JSON.stringify(seeks)})`]]) {
    const globals = {
      window: { __artifex: api }, VideoFrame: class { close() {} }, Blob, clearTimeout,
      setTimeout: (fn, ms) => (ms === 10000 ? (expire = fn, null) : setTimeout(fn, ms)),
      URL: { createObjectURL: () => 'blob:film', revokeObjectURL() {} },
      document: { createElement: (tag) => (tag === 'video' ? video() : canvas()) },
    };
    const rows = JSON.parse(JSON.stringify(await vm.runInNewContext(call, globals)));
    assert.deepEqual(rows.map((r) => [r.frame, r.psnr]), [...frames.slice(0, 7).map((i) => [i, 99]), [7, undefined]], name + ' stops at the frame it cannot seek');
    assert.deepEqual(rows[7], { frame: 7, seekTimeoutMs: 10000 }, name);
    assert.deepEqual(replayVerdict(rows), { match: false, detail: 'frame 7 cannot be sought: the browser did not finish seeking the film to it within 10 s' }, name);
  }
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
  assert.throws(() => parseArgs(['a.mp4', '--timeout-ms', '5']), /--timeout-ms takes an integer from 100 to 300000 milliseconds per film \(default 60000\), got 5/);
  assert.deepEqual(parseArgs(['a.mp4', '--piece', './p.cjs', '--headed']), { file: 'a.mp4', piece: './p.cjs', browser: { headed: true } });
  assert.equal(parseArgs(['a.svg', '--json']).json, true);
  const env = { npm_lifecycle_event: 'replay', npm_package_json: path.join(ROOT, 'package.json'), INIT_CWD: dir };
  assert.equal(callerDirectory(path.join(dir, 'elsewhere'), env), dir, 'npm run replay resolves paths from where it was called');
});

test('by default replay prints its verdict, naming the first difference, and the path of its full report, and --json prints the report alone on stdout', async (t) => {
  const dir = scratch(t);
  const logged = [];
  const errors = [];
  t.mock.method(console, 'log', (line) => logged.push(line));
  t.mock.method(console, 'error', (line) => errors.push(line));
  const exitCode = process.exitCode;
  t.after(() => { process.exitCode = exitCode; });
  const result = { file: path.join(dir, 'a.svg'), type: 'svg', manifest: { piece: 'a', seed: 3 }, match: false, detail: 'first difference at byte 12' };
  await main([result.file], async () => result, dir);
  const verdict = `replay: ${result.file} (svg, a seed 3): DIFFERS: the file is not what its recipe draws on Artifex ${VERSION}, so it was changed after export, made by another version, or its piece has changed since; first difference at byte 12`;
  const file = path.join(dir, 'replay-a.svg.json');
  assert.deepEqual(logged, [verdict, 'report: ' + file.split(path.sep).join('/')]);
  assert.deepEqual(errors, [], 'without --json nothing goes to stderr');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), result);
  assert.equal(process.exitCode, 1, 'a file that differs still fails');
  logged.length = 0;
  fs.rmSync(file);
  process.exitCode = undefined;
  await main([result.file, '--json'], async () => ({ ...result, match: true, detail: 'identical' }), dir);
  assert.equal(logged.length, 1, 'stdout holds the report alone');
  assert.equal(JSON.parse(logged[0]).match, true);
  assert.deepEqual(errors, [`replay: ${result.file} (svg, a seed 3): matches; identical`]);
  assert.equal(fs.existsSync(file), false, '--json writes no file');
  assert.equal(process.exitCode, undefined);
});

test('replay writes its report beside a file outside the library and under the library\'s out/ for one inside', async (t) => {
  const dir = scratch(t);
  const logged = [];
  t.mock.method(console, 'log', (line) => logged.push(line));
  const exitCode = process.exitCode;
  t.after(() => { process.exitCode = exitCode; });
  const stub = (file) => async () => ({ file, type: 'svg', manifest: { piece: 'a', seed: 3 }, match: true, detail: 'identical' });
  // The report of a file saved in a folder of the user's own, which in an installed plugin must not land in the plugin.
  const outside = path.join(dir, 'strata.png');
  await main([outside], stub(outside));
  assert.deepEqual(fs.readdirSync(dir), ['replay-strata.png.json'], 'the report sits beside the replayed file');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'replay-strata.png.json'), 'utf8')).file, outside, 'its content is unchanged');
  assert.equal(fs.existsSync(path.join(ROOT, 'out', 'replay-strata.png.json')), false, 'nothing lands in the library');
  assert.ok(logged.includes('report: ' + slash(path.join(dir, 'replay-strata.png.json'))), 'its report line prints that path');
  // A file inside the library keeps its report under out/.
  const name = `artifex-replay-location-${process.pid}.svg`;
  const inside = path.join(ROOT, 'tests', name), report = path.join(ROOT, 'out', `replay-${name}.json`);
  t.after(() => fs.rmSync(report, { force: true }));
  await main([inside], stub(inside));
  assert.equal(fs.existsSync(report), true, 'the report is written under out/');
  assert.equal(fs.existsSync(path.join(ROOT, 'tests', `replay-${name}.json`)), false, 'and not beside the file');
  assert.ok(logged.includes('report: ' + slash(report)), 'its report line prints the out/ path');
});

test('under --json a joined film\'s verdict and scene lines go to stderr and stdout parses as JSON', async (t) => {
  const dir = scratch(t);
  const logged = [];
  const errors = [];
  t.mock.method(console, 'log', (line) => logged.push(line));
  t.mock.method(console, 'error', (line) => errors.push(line));
  const exitCode = process.exitCode;
  t.after(() => { process.exitCode = exitCode; });
  const scenes = [{ scene: 1, piece: 'a', seed: 3, range: [0, 30], match: true, detail: 'fine' }];
  const joined = { file: 'j.mp4', type: 'mp4', manifest: { scenes: [] }, scenes, match: true, detail: 'identical' };
  await main(['j.mp4', '--json'], async () => joined, dir);
  assert.deepEqual(JSON.parse(logged.join('\n')), joined);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /^replay: j\.mp4 \(mp4, 1 scenes\): matches; identical$/);
  assert.equal(errors[1], '  scene 1, frames 0 to 29 (a seed 3): matches; fine');
  logged.length = 0;
  errors.length = 0;
  await main(['j.mp4'], async () => joined, dir);
  assert.equal(logged.length, 3,'without --json the verdict, the scene line and the report path stay on stdout');
  assert.deepEqual(errors, []);
});

test('a DIFFERS verdict names a browser as a cause only for a file a browser replays', async (t) => {
  const dir = scratch(t);
  const logged = [];
  const errors = [];
  t.mock.method(console, 'log', (line) => logged.push(line));
  t.mock.method(console, 'error', (line) => errors.push(line));
  const exitCode = process.exitCode;
  t.after(() => { process.exitCode = exitCode; });
  // An external SVG with one byte of its drawing changed, replayed in Node.
  const modulePath = fixturePiece(dir);
  const file = path.join(dir, 'changed.svg');
  fs.writeFileSync(file, renderVector(loadExternal(modulePath, dir).piece, { t: 0.5 }).svg.replace('#123456', '#123457'));
  await main([file, '--piece', modulePath], replay, dir);
  assert.match(logged[0], /: DIFFERS: .*, made by another version, or its piece has changed since; byte \d+ of \d+ differs/);
  for (const type of ['png', 'mp4', 'webm']) {
    errors.length = 0;
    await main(['a.' + type, '--json'], async () => ({ file: 'a.' + type, type, manifest: { piece: 'a', seed: 3 }, match: false, detail: 'd' }), dir);
    assert.match(errors[0], /, made by another version or browser, or its piece has changed since; d$/, type);
  }
});

/**
 * tests/fixtures/activity-film.cjs at `seed`, every frame painted in Node at its
 * own size, 480 x 270, as RGBA: it draws only opaque whole-unit fillRect in rgb().
 */
function activityFrames(seed) {
  const piece = loadExternal(path.join(__dirname, 'fixtures', 'activity-film.cjs')).piece;
  const { state } = solve(piece, seed);
  const { w: W, h: H } = piece.size;
  return playheads(piece).map((t, frame) => {
    const data = new Uint8ClampedArray(W * H * 4);
    const g = {
      fillStyle: '',
      fillRect(x, y, w, h) {
        const rgba = [.../rgb\((\d+), (\d+), (\d+)\)/.exec(this.fillStyle).slice(1).map(Number), 255];
        for (let j = Math.max(0, y); j < Math.min(H, y + h); j++) for (let i = Math.max(0, x); i < Math.min(W, x + w); i++) data.set(rgba, (j * W + i) * 4);
      },
    };
    piece.draw(g, state, t, { frame });
    return { data, width: W, height: H };
  });
}

/** The activity curve scanInEdge returns, as the page compares the frames it decodes, over painted `frames`. */
function activityOf(frames, region = null) {
  return [0, ...frames.slice(1).map((f, i) => frameChange(frames[i], f, region))];
}

test('the lag between two films is the peak of their activity curves\' correlation, later or earlier alike', () => {
  const box = { x: 320, y: 20, w: 120, h: 120 };
  const curve = (seed) => activityOf(activityFrames(seed), box);
  const [base, late, control] = [1, 2, 3].map(curve);
  assert.equal(base.length, 144);
  assert.equal(activityLag(activityOf(activityFrames(1)), activityOf(activityFrames(2)), 60).lag, 5, 'over the whole frame too');
  assert.equal(activityLag(base, late, 60).lag, 5, 'the beat keyed 5 frames later');
  assert.equal(activityLag(late, base, 65).lag, -5, 'and the other way round, earlier');
  assert.equal(activityLag(base, control, 60).lag, 0, 'the control, in other colours');
  // Synthetic curves: a pulse moved by 5, -5 or 0 frames, a flat window, a lag past LAG_FRAMES.
  const pulse = (at) => Array.from({ length: 80 }, (_, i) => Math.exp(-((i - at) ** 2) / 4));
  assert.deepEqual([5, -5, 0].map((d) => activityLag(pulse(40), pulse(40 + d), 40).lag), [5, -5, 0]);
  assert.deepEqual(activityLag(new Array(80).fill(0), pulse(40), 40), { lag: null, correlation: null });
  assert.notEqual(activityLag(pulse(40), pulse(40 + LAG_FRAMES + 5), 40).lag, LAG_FRAMES + 5);
});

test('replay --lag scans both MP4 films in pages of their own beside the verdict, and refuses by name what it cannot scan', async (t) => {
  const dir = scratch(t);
  const piece = fixturePiece(dir);
  const file = path.join(dir, 'film.mp4'), other = path.join(dir, 'other.mp4');
  const bytes = await filmOf(loadExternal(piece, dir).piece);
  fs.writeFileSync(file, bytes);
  fs.writeFileSync(other, bytes);
  const browser = { edge: path.join(dir, 'no-edge.exe') };
  const plain = await replay(file, { piece, withEdge: standInEdge(file).withEdge, browser });
  assert.equal('lag' in plain, false, 'without --lag the report is as before');
  // Eleven steps of twelve frames with a pulse at frame 5.
  const steps = Array.from({ length: 11 }, (_, i) => (i === 4 || i === 5 ? 0.3 : 0.01));
  const whole = standInEdge(file, undefined, { scan: steps });
  const same = await replay(file, { piece, withEdge: whole.withEdge, browser, lag: other, at: '6' });
  assert.deepEqual({ ...same, lag: undefined }, { ...plain, lag: undefined }, 'the verdict is unchanged');
  assert.equal(whole.calls.pages, 3, 'each film scanned in a page of its own');
  assert.match(whole.calls.scans[0], new RegExp(`\\)\\(window\\.__replayBytes, 12, 12, ${Math.min(SCAN_WIDTH, 32)}, null\\); \\}\\)\\(\\)$`), 'frame rate, frames, width, no region');
  const lagged = standInEdge(file, undefined, { scan: steps });
  const pair = await replay(file, { piece, withEdge: lagged.withEdge, browser, lag: other, at: '0.5s', region: '0,0,16,12' });
  assert.equal(lagged.calls.scans.length, 2, 'both films scanned');
  assert.deepEqual([pair.lag.lag, pair.lag.at, pair.lag.region], [0, 6, '0,0,16,12']);
  assert.match(scanText(pair)[0], /^lag: .*other\.mp4 runs in step with the file around frame 6 in region 0,0,16,12, correlation 1 \(a check, not part of the verdict\)$/);
  // Refused before any page opens.
  const refused = standInEdge(file);
  const refuse = (options, pattern) => assert.rejects(replay(file, { piece, withEdge: refused.withEdge, browser, ...options }), pattern);
  await refuse({ lag: other, at: '12' }, /^Error: replay: --at names 12, and the film holds frames 0 to 11 \(1\.000 s\)$/);
  await refuse({ lag: other, at: '1.5' }, /^Error: replay: --at takes a frame number or seconds ending in s, such as 60 or 2\.5s, and got "1\.5"$/);
  await refuse({ lag: path.join(dir, 'none.mp4'), at: '0' }, /^Error: replay: no film at .*none\.mp4 for --lag; name an MP4 film of the same piece$/);
  await refuse({ lag: other, at: '0', region: '0,0,0,5' }, /^Error: replay: --region takes x,y,w,h in the piece's units, such as 100,80,200,150, and got "0,0,0,5"$/);
  await refuse({ lag: other, at: '0', region: '40,0,5,5' }, /^Error: replay: --region 40,0,5,5 lies outside the film's 32 x 24 units$/);
  assert.equal(refused.calls.pages, 0, 'no page opened');
  const svg = path.join(dir, 'still.svg');
  fs.writeFileSync(svg, renderVector(EXAMPLES.inversion).svg);
  await assert.rejects(replay(svg, { lag: other, at: '0' }), /^Error: replay: --lag scans an MP4 film's frames, and .*still\.svg is SVG$/);
  await assert.rejects(replay(file, { piece, lag: svg, at: '0' }), /^Error: replay: --lag compares two MP4 films, and .*still\.svg is SVG$/);
  assert.deepEqual(parseArgs(['a.mp4', '--lag', 'b.mp4', '--at', '2.5s', '--region', '1,2,3,4']), { file: 'a.mp4', piece: null, browser: {}, lag: 'b.mp4', at: '2.5s', region: '1,2,3,4' });
  assert.throws(() => parseArgs(['a.mp4', '--activity']), /unknown option --activity/);
  assert.throws(() => parseArgs(['a.mp4', '--lag', 'b.mp4']), /--lag needs --at, the frame or seconds of the beat to align/);
  assert.throws(() => parseArgs(['a.mp4', '--at', '3']), /--at goes with --lag, the film to align with/);
  assert.throws(() => parseArgs(['a.mp4', '--region', '1,2,3,4']), /--region goes with --lag/);
});

test('a matching soundtrack reports the lowest value each sound rule met, with its threshold and its second, and the mask of its codec', () => {
  const at = (...blocks) => ({ rate: 48000, block: SOUND_BLOCK, channels: [2, 2], length: [SOUND_BLOCK * blocks.length, SOUND_BLOCK * blocks.length], blocks });
  // A clean block 40 dB from the render, then one under the floor that its noise-like bands carry: waveform 10 dB, levels 25 dB, band 7 alone 10 dB.
  const inside = 0.9 * 10 ** -1;
  const noisy = [1, 10 ** -3 + inside, 0.9, inside, 0.9 * 10 ** -2.5, 7, 0.45, 0.45 * 10 ** -1];
  const report = {};
  const heard = soundVerdict(at([1e6, 1e2, 0, 0, 0, -1, 0, 0], noisy), 'mp4a', report);
  assert.deepEqual(Object.keys(heard), ['match', 'detail'], 'the verdict keeps its two fields');
  assert.equal(heard.match, true);
  assert.deepEqual(report, {
    margins: {
      floor: { db: 40, threshold: 25, at: 0 },
      waveform: { db: 10, threshold: 3, at: 0.021 },
      band: { db: 10, threshold: 3, at: 0.021 },
      level: { db: 25, threshold: 18, at: 0.021 },
    },
    mask: -6,
  });
  const opus = {};
  soundVerdict(at([1e6, 1e2, 0, 0, 0, -1, 0, 0]), 'Opus', opus);
  assert.deepEqual(opus, { margins: { floor: { db: 40, threshold: 15, at: 0 } }, mask: -3 });
  const refused = {};
  assert.equal(soundVerdict(at([1, 1, 0, 0, 0, -1, 0, 0]), 'mp4a', refused).match, false);
  assert.deepEqual(refused, {}, 'a soundtrack that differs reports its first difference, not margins');
});

test('a codec the floor names and another sound table lacks is an error, not a comparison against nothing', async (t) => {
  const dir = scratch(t);
  const silent = loadExternal(fixturePiece(dir), dir).piece;
  const voiced = validate({ ...silent, sound(ctx) { const o = ctx.createOscillator(); o.connect(ctx.destination); o.start(0); } });
  const film = await filmOf(voiced, { aac: false });
  const kept = SOUND_MASK_DB.Opus;
  delete SOUND_MASK_DB.Opus;
  try {
    assert.throws(() => soundPlan(film, voiced), { message: 'replay: SOUND_MASK_DB has no entry for the codec "Opus", which SOUND_FLOOR_DB names: give it one before a Opus film is compared' });
  } finally { SOUND_MASK_DB.Opus = kept; }
  assert.deepEqual(soundPlan(film, voiced), { codec: 'Opus' });
});

test('a silent stretch lies beside no onset', async () => {
  const silence = [new Float32Array(48000 / 10 * 10), new Float32Array(48000 / 10 * 10)];
  const s = await soundInPage({ rendered: silence, decoded: silence.map((x) => x.slice()) });
  assert.ok(s.blocks.length > 0);
  assert.deepEqual([...new Set(s.blocks.map((b) => b[9]))], [0], 'no block of silence is marked beside an onset');
});

test('replay --seed redraws the recipe at another seed and reports the difference without failing', async (t) => {
  assert.equal(parseArgs(['a.svg', '--seed', '7']).seed, 7);
  assert.throws(() => parseArgs(['a.svg', '--seed', '1.5']), /--seed takes a whole number, 0 or more/);
  assert.throws(() => parseArgs(['a.svg', '--seed']), /--seed needs the seed to redraw the recipe at/);
  const dir = scratch(t);
  const { piece } = loadExternal(fixturePiece(dir), dir);
  const file = path.join(dir, 'made.svg');
  fs.writeFileSync(file, require('../core/render.js').renderVector(piece, { seed: 3 }).svg);
  const own = await replay(file, { piece: fixturePiece(dir), cwd: dir, seed: 3 });
  assert.deepEqual([own.match, own.manifest.seed, own.manifest.savedSeed], [true, 3, undefined], 'its own seed draws the file');
  const other = await replay(file, { piece: fixturePiece(dir), cwd: dir, seed: 4 });
  assert.deepEqual([other.manifest.seed, other.manifest.savedSeed], [4, 3]);
  const logged = [];
  t.mock.method(console, 'log', (line) => logged.push(line));
  const exitCode = process.exitCode;
  t.after(() => { process.exitCode = exitCode; });
  process.exitCode = undefined;
  await main([file, '--seed', '4'], async () => other, dir);
  assert.equal(process.exitCode, undefined, 'a comparison is no failure');
  assert.match(logged[0], /against its recipe at seed 4 instead of its own seed 3: (differs|the same picture); /);
  assert.equal(logged[1], 'report: ' + path.join(dir, 'replay-made.svg-seed4.json').split(path.sep).join('/'));
});

test('an Opus film of chirps over a noise bed replays, and a wrong soundtrack still differs at the Opus mask', async () => {
  // The masked-tones case above, levelled and judged as an Opus film: short
  // chirps every 40 ms over a noise bed in their band; the film adds another
  // noise `error` dB under the bed and the chirps again 18 dB under them.
  const pitches = [1300, 2100, 1700, 2400, 1500, 1900];
  const grains = ({ skip = -1, shift = 1 } = {}) => signal(48000, (i, c) => {
    const k = Math.floor(i / 1920), t = i - k * 1920;
    if (k === skip || t >= 1440) return 0;
    return (0.08 + 0.02 * c) * Math.min(1, t / 48) * Math.exp((-Math.log(1000) * t) / 1440) * Math.sin((2 * Math.PI * pitches[k % 6] * shift * t) / 48000);
  });
  const bed = (seed) => [0, 1].map((c) => bandPass(whiteNoise(48000, seed * 2 + c), 1800, 1).map((v) => 0.1 * v));
  const mix = (...parts) => [0, 1].map((c) => Float32Array.from({ length: 48000 }, (_, i) => parts.reduce((s, p) => s + p[c][i], 0)));
  const rendered = mix(grains(), bed(1));
  const scale = 10 ** (normalizeLoudness(audio(rendered.map((x) => x.slice())), 'Opus').gain / 20);
  const film = (parts, error = 14) => mix(...parts, bed(40).map((x) => x.map((v) => v * 10 ** (-error / 20))), grains().map((x) => x.map((v) => v * 10 ** (-18 / 20)))).map((x) => x.map((v) => v * scale));
  const judged = async (parts, error) => soundVerdict(await soundInPage({ rendered, decoded: film(parts, error) }, 'Opus'), 'Opus');
  const own = await judged([grains(), bed(1)]);
  assert.equal(own.match, true, own.detail);
  assert.match(own.detail, /^the Opus soundtrack decodes to its recipe's 48000 samples, every block within 15 dB of the render/);
  for (const [what, parts, error] of [['its bed from another seed', [grains(), bed(9)]], ['one chirp missing', [grains({ skip: 12 }), bed(1)]],
    ['its chirps a semitone higher', [grains({ shift: 2 ** (1 / 12) }), bed(1)]], ['the codec error 3 dB under the bed', [grains(), bed(1)], 3]]) {
    const other = await judged(parts, error);
    assert.equal(other.match, false, `${what}: ${other.detail}`);
    assert.match(other.detail, /under the 15 dB floor for Opus/, what);
  }
});
