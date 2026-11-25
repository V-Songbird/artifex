'use strict';

// Joining scene films: `npm run stitch` copies the samples of films exported
// against stand-in encoders into one MP4, and replay plans each scene of it
// against its own recipe. Decoding a joined film and hearing its joins needs
// installed Edge: `npm run stitch` then `npm run replay`.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const { validate, solve } = require('../core/piece.js');
const { exportFilm, readMp4, muxMp4, normalizeLoudness } = require('../core/film.js');
const { nullSurface } = require('../tools/bench.js');
const { stitch, stitchFile, parseArgs, main } = require('../tools/stitch.js');
const replayTool = require('../tools/replay.js');
const EXAMPLES = require('../examples/index.js');
const { fakeAudio, fakeCodecs, fakeCanvas } = require('./fake-media.js');

const { filmPlan, compareSound, soundVerdict, SOUND_BLOCK, SOUND_BAND, SOUND_FLATNESS, SOUND_CUT, SOUND_VOICE, SOUND_MASK_DB } = replayTool;

/** A small piece with a timeline: `duration` seconds at `hz`, with a soundtrack unless `sound` is false. */
function scene(name, duration, { hz = 30, size = { w: 32, h: 24 }, sound = true } = {}) {
  return validate({
    name, size, seed: 5, time: { duration, hz },
    ...(sound && { sound() {} }),
    draw(g, s, t) { g.fillRect(0, 0, 32 * t + 1, 24); },
  });
}

/** The film exportFilm makes of `piece` against stand-in encoders; `codecs` passes their options, `opt` the export's. */
async function filmOf(piece, codecs = {}, opt = {}) {
  const c = fakeCodecs(codecs);
  let clock = 0;
  const env = {
    VideoEncoder: c.VideoEncoder, VideoFrame: c.VideoFrame, AudioEncoder: c.AudioEncoder, AudioData: c.AudioData,
    OfflineAudioContext: fakeAudio().Context,
    createCanvas: (w, h) => fakeCanvas({ width: w, height: h }, nullSurface),
    now: () => (clock += 1), pause: async () => {},
  };
  return (await exportFilm(piece, solve(piece, piece.seed), env, opt)).bytes;
}

/** Every sample of the file's track of `kind`, as bytes. */
function samplesOf(bytes, kind) {
  const t = readMp4(bytes).tracks.find((x) => x.kind === kind);
  return t.positions.map((at, i) => [...bytes.subarray(at, at + t.sizes[i])]);
}

const named = (...films) => films.map((bytes, i) => ({ name: `${'abcd'[i]}.mp4`, bytes }));

function grab(fn) {
  try { fn(); } catch (e) { return e; }
  throw new Error('expected a throw, and none happened');
}

test('joined AAC films keep every frame in order and cut their soundtracks on packets, each scene sounding on its first frame or up to a packet after', async () => {
  const [a, b, c] = await Promise.all([scene('a', 1), scene('b', 0.5), scene('c', 0.7)].map((p) => filmOf(p)));
  const { bytes, report, joins } = stitch(named(a, b, c));
  const file = readMp4(bytes);
  assert.deepEqual(file.tracks.map((t) => t.kind), ['vide', 'soun'], 'one video track and one soundtrack');
  assert.equal(report.frames, 66);
  assert.equal(report.seconds, 2.2);
  assert.deepEqual(samplesOf(bytes, 'vide'), [a, b, c].flatMap((f) => samplesOf(f, 'vide')), 'every frame, byte for byte and in order');
  assert.deepEqual(file.tracks[0].keys, [1, 31, 46], 'each scene opens on its own keyframe');
  // One edit skips the first scene's 2112-sample priming and plays the film's length.
  assert.deepEqual(file.tracks[1].edits, [{ duration: 66000, mediaTime: 2112, rate: 1 }]);

  // The first scene keeps its packets up to where the second's first kept
  // packet goes: that one, packet 2 of its own soundtrack, holds the last 64
  // samples of its priming, so its sound starts at 48128, 128 samples (2.67 ms)
  // after its first frame at 48000. Its first packet is decoded with the first
  // scene's last, so its samples are judged from 960, where that packet ends.
  const heard = samplesOf(bytes, 'soun');
  const [pa, pb, pc] = [a, b, c].map((f) => samplesOf(f, 'soun'));
  assert.deepEqual(heard.slice(0, 49), pa.slice(0, 49), 'the first scene keeps its priming and its packets to the join');
  assert.deepEqual(heard.slice(49, 73), pb.slice(2), 'the second drops the two whole packets of its priming');
  assert.deepEqual(heard.slice(73), pc.slice(2, 2 + heard.length - 73), 'the last keeps packets only until the film is covered');
  const scenes = file.manifest.scenes;
  assert.deepEqual(scenes.map((s) => s.recipe), [a, b, c].map((f) => readMp4(f).manifest), 'each scene keeps its own recipe');
  assert.deepEqual(scenes.map((s) => s.frames), [[0, 30], [30, 45], [45, 66]]);
  assert.deepEqual(scenes.map((s) => s.sound), [
    { at: 0, judged: [0, 48000] },
    { at: 48128, judged: [960, 24000] },
    // The last scene lands 704 samples late, so the film ends 704 samples before its render does.
    { at: 72704, judged: [960, 32896] },
  ]);
  assert.deepEqual(joins, [{ seconds: 1, lateMs: 2.67 }, { seconds: 1.5, lateMs: 14.67 }]);
  for (const [k, s] of scenes.entries()) {
    const late = s.sound.at - (s.frames[0] * 48000) / 30;
    assert.ok(late >= 0 && late < 1024, `scene ${k + 1} sounds ${late} samples after its first frame`);
  }
  // The soundtrack covers the film and runs past it by less than a packet.
  const t = file.tracks[1];
  assert.ok(t.duration - 2112 >= 2.2 * 48000 && t.duration - 2112 < 2.2 * 48000 + 1024, `${t.duration - 2112} samples heard`);
});

test('joined Opus films keep every packet of a scene that lasts whole packets, and judge each later scene from its tenth packet', async () => {
  const [a, b] = await Promise.all([scene('a', 1), scene('b', 0.5)].map((p) => filmOf(p, { aac: false })));
  const { bytes, report, joins } = stitch(named(a, b));
  const file = readMp4(bytes);
  assert.equal(report.sound.codec, 'Opus');
  assert.deepEqual(file.tracks[1].edits, [{ duration: 45000, mediaTime: 312, rate: 1 }]);
  // No Opus packet is priming alone, so the second scene keeps its first, whose
  // 312 samples of pre-skip overlay the first scene's last 312.
  const [pa, pb] = [a, b].map((f) => samplesOf(f, 'soun'));
  assert.deepEqual(samplesOf(bytes, 'soun'), [...pa.slice(0, 50), ...pb]);
  assert.deepEqual(file.manifest.scenes.map((s) => s.sound), [{ at: 0, judged: [0, 47688] }, { at: 48000, judged: [9288, 24000] }]);
  assert.deepEqual(joins, [{ seconds: 1, lateMs: 0 }], 'a second of 50 whole packets joins exactly');
});

test('a film without a soundtrack joins its frames alone', async () => {
  const [a, b] = await Promise.all([scene('a', 0.5, { sound: false }), scene('b', 0.5, { sound: false })].map((p) => filmOf(p)));
  const { bytes, report, joins } = stitch(named(a, b));
  assert.equal(report.sound, null);
  assert.deepEqual(readMp4(bytes).tracks.map((t) => t.kind), ['vide']);
  assert.deepEqual(readMp4(bytes).manifest.scenes.map((s) => [s.frames, s.sound]), [[[0, 15], undefined], [[15, 30], undefined]]);
  assert.deepEqual(joins, [{ seconds: 0.5 }]);
});

test('films that one decoder cannot play alike, or that Artifex did not export, are refused by name', async () => {
  const aac = await filmOf(scene('a', 0.5));
  const refused = async (other, pattern, first = aac) => assert.match(grab(() => stitch(named(first, other))).message, pattern);
  await refused(await filmOf(scene('b', 0.5, { size: { w: 64, h: 48 } })), /^stitch: b\.mp4 is 64 x 48 and a\.mp4 is 32 x 24; films join only at one size, frame rate and codec configuration$/);
  await refused(await filmOf(scene('b', 0.5, { hz: 24 })), /^stitch: b\.mp4 runs at 24 frames a second and a\.mp4 at 30;/);
  await refused(await filmOf(scene('b', 0.5, { sound: false })), /^stitch: b\.mp4 has no soundtrack and a\.mp4 has one;/);
  await refused(aac, /^stitch: b\.mp4 has a soundtrack and a\.mp4 has none;/, await filmOf(scene('a', 0.5, { sound: false })));
  await refused(await filmOf(scene('b', 0.5), { aac: false }), /^stitch: b\.mp4's soundtrack is Opus and a\.mp4's is AAC;/);
  await refused(await filmOf(scene('b', 0.5), {}, { audioBitrate: 128000 }), /^stitch: b\.mp4's AAC soundtrack is configured otherwise than a\.mp4's;/);
  // Another level in the avcC: a configuration the first film's decoder was not opened with.
  const level = (await filmOf(scene('b', 0.5))).slice();
  const avcC = Buffer.from(level).indexOf('avcC') + 4;
  level[avcC + 3] ^= 1;
  await refused(level, /^stitch: b\.mp4's H\.264 stream is configured otherwise than a\.mp4's, so one decoder cannot play both;/);

  // A film with no recipe, one already joined, one the export's own check refuses, and bytes that are no MP4.
  const t = readMp4(aac).tracks[0];
  const bare = muxMp4({ video: { width: 32, height: 24, timescale: 30000, delta: 1000, avcC: t.avcC, samples: samplesOf(aac, 'vide').map((d, i) => ({ data: Uint8Array.from(d), key: i === 0 })) } });
  await refused(bare, /^stitch: b\.mp4 carries no replay manifest, so it is no film Artifex exported$/);
  await refused(stitch(named(aac, aac)).bytes, /^stitch: b\.mp4 is already a joined film; join the films of its scenes in one run$/);
  const short = Buffer.from(aac);
  short.write('"frames":16', Buffer.from(aac).indexOf('"frames":15'), 'latin1');
  await refused(short, /^stitch: b\.mp4: the file holds 15 of 16 frames\.$/);
  await refused(Uint8Array.of(0, 0, 0, 9, 1, 2, 3, 4), /^stitch: b\.mp4 is not a readable MP4: box/);
  assert.match(grab(() => stitch(named(aac))).message, /^stitch: name at least two films to join/);
  // After 9 frames at 60 Hz the next scene's sound starts 992 samples late,
  // past the whole of a one-frame scene's 800.
  const [nine, one, after] = await Promise.all([scene('a', 0.15, { hz: 60 }), scene('b', 1 / 60, { hz: 60 }), scene('c', 0.5, { hz: 60 })].map((p) => filmOf(p)));
  assert.match(grab(() => stitch(named(nine, one, after))).message, /^stitch: b\.mp4 is shorter than the packet its sound would start in, so none of its sound would be heard;/);
});

test('the command joins the films it names into the file -o names, never over one of them', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-stitch-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'a.mp4'), await filmOf(scene('a', 1)));
  fs.writeFileSync(path.join(dir, 'b.mp4'), await filmOf(scene('b', 0.5)));
  const lines = [];
  t.mock.method(console, 'log', (line) => lines.push(line));
  main(['a.mp4', 'b.mp4', '-o', 'out/film.mp4'], dir);
  const joined = path.join(dir, 'out', 'film.mp4');
  assert.equal(readMp4(new Uint8Array(fs.readFileSync(joined))).manifest.scenes.length, 2);
  assert.deepEqual(lines, [`stitch: ${joined}: 2 scenes, 45 frames (1.500 s), 32 x 24 at 30 Hz, AAC; scene 2's sound starts 2.67 ms after its first frame`]);
  assert.throws(() => main(['a.mp4', 'b.mp4', '-o', 'b.mp4'], dir), /^Error: stitch: -o b\.mp4 names one of the films to join; write the joined film elsewhere$/);
  assert.throws(() => parseArgs(['a.mp4', 'b.mp4']), /name the joined film with -o <out\.mp4>\nusage: npm run stitch/);
  assert.throws(() => parseArgs(['a.mp4', '-o', 'x.mp4']), /name at least two films to join/);
  assert.throws(() => parseArgs(['a.mp4', 'b.mp4', '-o', 'x.mov']), /^Error: stitch: -o must name an \.mp4 file, got x\.mov$/);
  assert.throws(() => parseArgs(['a.mp4', 'b.mp4', '-o']), /-o needs the \.mp4 file to write/);
  assert.throws(() => parseArgs(['a.mp4', 'b.mp4', '--fast', '-o', 'x.mp4']), /unknown option --fast/);
  assert.deepEqual(parseArgs(['a.mp4', 'b.mp4', '--out', 'x.mp4']), { films: ['a.mp4', 'b.mp4'], out: 'x.mp4' });
});

test('the command streams the joined film to disk, byte for byte the film joined in memory, and leaves nothing when it refuses', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-stitch-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const films = await Promise.all([scene('a', 1), scene('b', 0.5), scene('c', 0.7), scene('d', 0.5, { hz: 24 })].map((p) => filmOf(p)));
  const opus = await Promise.all([scene('a', 1), scene('b', 0.5)].map((p) => filmOf(p, { aac: false })));
  const silent = await Promise.all([scene('a', 0.5, { sound: false }), scene('b', 0.5, { sound: false })].map((p) => filmOf(p)));
  const onDisk = (list) => list.map((bytes, i) => {
    const file = path.join(dir, `${'abcd'[i]}.mp4`);
    fs.writeFileSync(file, bytes);
    return { name: `${'abcd'[i]}.mp4`, file };
  });
  for (const [kind, list] of [['AAC', films.slice(0, 3)], ['Opus', opus], ['silent', silent]]) {
    const target = path.join(dir, `${kind}.mp4`);
    const streamed = stitchFile(onDisk(list), target);
    const held = stitch(named(...list));
    assert.deepEqual(new Uint8Array(fs.readFileSync(target)), held.bytes, `${kind}: the same bytes as muxMp4 writes`);
    assert.deepEqual(streamed, { report: held.report, joins: held.joins }, `${kind}: the same report`);
  }
  const target = path.join(dir, 'refused.mp4');
  assert.throws(() => stitchFile(onDisk([films[0], films[3]]), target), /^Error: stitch: b\.mp4 runs at 24 frames a second and a\.mp4 at 30;/);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith('refused')), [], 'no joined film and no part of one');
});

// ---- replaying a joined film ------------------------------------------------

test('replay plans each scene of a joined film against its own frame range', async () => {
  const pieces = [scene('a', 1), scene('b', 0.5)];
  const { bytes } = stitch(named(...await Promise.all(pieces.map((p) => filmOf(p)))));
  const [first, second] = readMp4(bytes).manifest.scenes;
  assert.deepEqual(filmPlan(bytes, second.recipe, pieces[1], second.frames), Array.from({ length: 15 }, (_, i) => i), 'frames counted from the scene\'s first');
  assert.deepEqual(filmPlan(bytes, first.recipe, pieces[0], first.frames).length, 24);
  assert.throws(() => filmPlan(bytes, second.recipe, pieces[1], [40, 55]), /the scene holds 5 of the 15 frames its manifest names/);
});

test('replay refuses a joined film whose scene names a piece it cannot find, and a film of one piece given two', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-stitch-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'joined.mp4');
  fs.writeFileSync(file, stitch(named(...await Promise.all([scene('a', 0.5), scene('b', 0.5)].map((p) => filmOf(p))))).bytes);
  // A style draws nothing, so the refusal offers only --piece, whatever the home holds.
  const env = { ARTIFEX_HOME: path.join(dir, 'home') };
  await assert.rejects(replayTool.replay(file, { env }), /no registered example is named "a"; pass its module with --piece$/);
  assert.deepEqual(replayTool.parseArgs(['j.mp4', '--piece', 'a.cjs', '--piece', 'b.cjs']).piece, ['a.cjs', 'b.cjs'], 'one --piece for each external piece');
  const one = path.join(dir, 'one.mp4');
  fs.writeFileSync(one, await filmOf(scene('a', 0.5)));
  await assert.rejects(replayTool.replay(one, { piece: ['a.cjs', 'b.cjs'], cwd: dir }), /was drawn by one piece; pass one --piece/);
});

test('replay compares every scene of a joined film of registered examples in one page, sent the film once', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-stitch-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'joined.mp4');
  const settle = await filmOf(validate(EXAMPLES.settle), {}, { scale: 0.1 });
  fs.writeFileSync(file, stitch(named(settle, settle, settle)).bytes);
  // A stand-in for withEdge whose page answers each evaluation by its kind.
  const pages = [], sent = [], compared = [];
  const answer = (expression) => {
    if (expression.startsWith('document.readyState')) return true;
    if (expression.startsWith('fetch("/file")')) { sent.push(expression); return fs.statSync(file).size; }
    if (expression.includes('function compareFilm')) { compared.push(Number(/, (\d+)\)$/.exec(expression)[1])); return [{ frame: 0, psnr: 40, neighbours: [] }]; }
    if (expression.includes('function compareSound')) return { error: 'stand-in' };
    throw new Error('unexpected evaluation ' + expression.slice(0, 40));
  };
  const withEdge = async (page, options, work) => {
    pages.push(options);
    // A value read in pieces is kept as its JSON and handed back by slices.
    let kept;
    const client = {
      send: async (method, { expression }) => {
        const whole = /^\(async \(\) => \(globalThis\.__artifexValue = JSON\.stringify\(await \(([\s\S]*)\)\)\)\.length\)\(\)$/.exec(expression);
        const piece = /^globalThis\.__artifexValue\.slice\((\d+), (\d+)\)$/.exec(expression);
        if (whole) return { result: { value: (kept = JSON.stringify(answer(whole[1]))).length } };
        if (piece) return { result: { value: kept.slice(Number(piece[1]), Number(piece[2])) } };
        if (expression === 'delete globalThis.__artifexValue') return { result: { value: true } };
        return { result: { value: answer(expression) } };
      },
    };
    return work(client, { errors: [], phase: 'startup', version: { Browser: 'Stand-in/1' }, signal: new AbortController().signal });
  };
  // A missing Edge fails at once should the stand-in not be used.
  const result = await replayTool.replay(file, { withEdge, browser: { edge: path.join(dir, 'no-edge.exe') } });
  assert.equal(pages.length, 1, 'one page for the three scenes');
  assert.equal(pages[0].timeoutMs, 3 * 60000, 'with each scene\'s time limit');
  assert.equal(sent.length, 1, 'the film sent once');
  assert.ok(Buffer.from(pages[0].file).equals(fs.readFileSync(file)), 'served whole to the page');
  assert.deepEqual(compared, [0, 144, 288], 'each scene compared from its own first frame');
  assert.deepEqual(result.scenes.map((s) => [s.scene, s.piece, s.range, s.match, s.detail]), [1, 2, 3].map((k) => [k, 'settle', [144 * (k - 1), 144 * k], false, 'the soundtrack does not decode: stand-in']));
  assert.equal(result.detail, 'scene 1 (settle) differs: the soundtrack does not decode: stand-in');
});

test('replay seeks each scene of a joined film from the scene\'s own first frame', async () => {
  const seeks = [];
  const video = { videoWidth: 32, videoHeight: 24 };
  Object.defineProperties(video, {
    src: { get: () => 'blob:film', set() { setTimeout(() => video.onloadeddata(), 0); } },
    currentTime: { set(v) { seeks.push(v); setTimeout(() => video.onseeked(), 0); } },
  });
  const canvas = () => ({ getContext: () => ({ clearRect() {}, drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(240 * 180 * 4) }) }) });
  const api = { examples: { a: { name: 'a' } }, piece: { validate: (p) => p, atBox: (p) => ({ ...p, time: { hz: 30 } }), solve: () => ({}) }, render: { playheads: () => Array(15).fill(0), drawFrame() {} } };
  const globals = {
    window: { __artifex: api }, VideoFrame: class { close() {} }, Blob, setTimeout, clearTimeout,
    URL: { createObjectURL: () => 'blob:film', revokeObjectURL() {} },
    document: { createElement: (tag) => (tag === 'video' ? video : canvas()) },
  };
  await vm.runInNewContext(`(${replayTool.compareFilm})(new Uint8Array(0), ${JSON.stringify({ piece: 'a', seed: 1, film: { scale: 1 } })}, [0, 14], 30)`, globals);
  assert.deepEqual(seeks, [30.5 / 30, 44.5 / 30], 'the scene\'s frames 0 and 14 are the film\'s 30 and 44');
});

/** An AudioBuffer stand-in at 48 kHz holding `channels`. */
const audio = (channels) => ({ numberOfChannels: channels.length, length: channels[0].length, sampleRate: 48000, duration: channels[0].length / 48000, getChannelData: (c) => channels[c] });
const tone = (n, f) => [0, 1].map((c) => Float32Array.from({ length: n }, (_, i) => 0.2 * Math.sin((2 * Math.PI * (f + 50 * c) * i) / 48000)));

/**
 * compareSound as the page runs it, from its source text, for a scene whose
 * piece renders `rendered` in a joined film that decodes to `decoded`.
 */
async function sceneInPage(rendered, decoded, span) {
  const p = validate({ name: 'tone', size: { w: 8, h: 8 }, time: { duration: rendered[0].length / 48000, hz: 10 }, sound() {}, draw() {} });
  class OfflineAudioContext {
    constructor(channels, length, sampleRate) { Object.assign(this, { channels, length, sampleRate, destination: {} }); }
    startRendering() { return Promise.resolve(audio(rendered.map((x) => x.slice()))); }
    decodeAudioData() { return Promise.resolve(audio(decoded)); }
  }
  const window = { __artifex: { piece: require('../core/piece.js'), render: require('../core/render.js'), examples: { tone: p }, level: normalizeLoudness } };
  const recipe = { ...solve(p, p.seed).manifest, film: { frames: 10, hz: 10, loop: false, scale: 1 } };
  const run = `(${compareSound})(new Uint8Array(0), ${JSON.stringify(recipe)}, ${SOUND_BLOCK}, "mp4a", ${SOUND_BAND}, ${SOUND_FLATNESS}, ${JSON.stringify(SOUND_CUT)}, ${JSON.stringify(SOUND_VOICE)}, ${SOUND_MASK_DB.mp4a}, ${JSON.stringify(span)})`;
  return soundVerdict(await vm.runInNewContext(run, { window, OfflineAudioContext, atob }), 'mp4a');
}

test('replay judges a scene\'s sound where the joined film says it lies, and only the samples its own packets made', async () => {
  const rendered = tone(48000, 440);
  const heard = rendered.map((x) => x.slice());
  normalizeLoudness(audio(heard), 'mp4a');
  // A joined soundtrack: another scene, then this one from sample 30128, its
  // first 960 samples mixed with the scene before, then another scene again.
  const at = 30128, total = 100000;
  const joined = tone(total, 300).map((x, c) => { x.set(heard[c], at); for (let i = 0; i < 960; i++) x[at + i] += 0.3; return x; });
  const span = { at, from: 960, to: 48000, total };
  const judged = await sceneInPage(rendered, joined, span);
  assert.equal(judged.match, true, judged.detail);
  assert.match(judged.detail, /^the scene's AAC sound, judged from 0\.020 s to 1\.000 s of its 1\.000 s, lies in the joined soundtrack's 100000 samples, every block within 25 dB/);
  const early = await sceneInPage(rendered, joined, { ...span, from: 0 });
  assert.equal(early.match, false, 'the mixed samples differ where they are judged');
  assert.match(early.detail, /differs from its recipe at 0\.000 s/);
  const moved = await sceneInPage(rendered, joined, { ...span, at: at - 128 });
  assert.equal(moved.match, false, 'a scene heard 128 samples from where it lies differs');
  assert.match(moved.detail, /differs from its recipe at 0\.020 s/, 'named by its time in the scene');
  assert.deepEqual(await sceneInPage(rendered, joined, { ...span, total: total + 1 }), { match: false, detail: 'the joined soundtrack decodes to 100000 samples and its film lasts 100001' });
});

test('replay decodes a joined film\'s soundtrack and makes its object URL once per page, for all its scenes', async () => {
  const p = validate({ name: 'tone', size: { w: 8, h: 8 }, time: { duration: 0.1, hz: 10 }, sound() {}, draw() {} });
  const rendered = tone(4800, 440);
  let decodes = 0, urls = 0;
  class OfflineAudioContext {
    constructor(channels, length, sampleRate) { Object.assign(this, { channels, length, sampleRate, destination: {} }); }
    startRendering() { return Promise.resolve(audio(rendered.map((x) => x.slice()))); }
    decodeAudioData() { decodes++; return Promise.resolve(audio(rendered)); }
  }
  const video = { videoWidth: 32, videoHeight: 24 };
  Object.defineProperties(video, {
    src: { get: () => 'blob:film', set() { setTimeout(() => video.onloadeddata(), 0); } },
    currentTime: { set() { setTimeout(() => video.onseeked(), 0); } },
  });
  const canvas = () => ({ getContext: () => ({ clearRect() {}, drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(240 * 180 * 4) }) }) });
  const render = { ...require('../core/render.js'), drawFrame() {} };
  const window = { __artifex: { piece: require('../core/piece.js'), render, examples: { tone: p }, level: normalizeLoudness } };
  const globals = {
    window, OfflineAudioContext, VideoFrame: class { close() {} }, Blob, setTimeout, clearTimeout,
    URL: { createObjectURL: () => { urls++; return 'blob:film'; }, revokeObjectURL() {} },
    document: { createElement: (tag) => (tag === 'video' ? video : canvas()) },
  };
  const recipe = JSON.stringify({ ...solve(p, p.seed).manifest, film: { frames: 1, hz: 10, loop: false, scale: 1 } });
  const sound = `(${compareSound})(bytes, ${recipe}, ${SOUND_BLOCK}, "mp4a", ${SOUND_BAND}, ${SOUND_FLATNESS}, ${JSON.stringify(SOUND_CUT)}, ${JSON.stringify(SOUND_VOICE)}, ${SOUND_MASK_DB.mp4a})`;
  const heard = await vm.runInNewContext(`(async () => { const bytes = new Uint8Array(4), heard = [];
    for (let k = 0; k < 3; k++) { await (${replayTool.compareFilm})(bytes, ${recipe}, [0], 0); heard.push(await ${sound}); }
    return heard; })()`, globals);
  assert.equal(decodes, 1, 'the soundtrack decoded once for three scenes');
  assert.equal(urls, 1, 'one object URL for three scenes');
  assert.deepEqual(heard[1], heard[0]);
  assert.ok(heard[0].blocks.length, 'each scene judged from the one decode');
  assert.deepEqual(heard[2], heard[0]);
});

test('replay prints a joined film\'s verdict and a line for each scene', async (t) => {
  const out = [];
  const lines = [];
  t.mock.method(console, 'log', (line) => out.push(line));
  t.mock.method(console, 'error', (line) => lines.push(line));
  const exitCode = process.exitCode;
  t.after(() => { process.exitCode = exitCode; });
  const scenes = [
    { scene: 1, piece: 'a', seed: 5, range: [0, 30], match: true, detail: 'fine' },
    { scene: 2, piece: 'b', seed: 5, range: [30, 45], match: false, detail: 'frame 3 is off' },
  ];
  await replayTool.main(['j.mp4', '--json'], async (file) => ({ file, type: 'mp4', manifest: { scenes: [] }, scenes, match: false, detail: 'scene 2 (b) differs: frame 3 is off' }));
  assert.equal(process.exitCode, 1, 'a joined film that differs exits nonzero');
  assert.equal(out.length, 1, 'stdout holds the report alone');
  assert.equal(JSON.parse(out[0]).scenes.length, 2, 'and it parses as JSON');
  assert.deepEqual(lines, [
    `replay: j.mp4 (mp4, 2 scenes): DIFFERS: the file is not what its recipe draws on Artifex ${require('../core/piece.js').VERSION}, so it was changed after export, made by another version or browser, or its piece has changed since; scene 2 (b) differs: frame 3 is off`,
    '  scene 1, frames 0 to 29 (a seed 5): matches; fine',
    '  scene 2, frames 30 to 44 (b seed 5): DIFFERS; frame 3 is off',
  ]);
});

test('replay judges a joined scene of sparse noise by the same blocks, onsets and near bands as the scene alone', async () => {
  const { SOUND_SPARSE } = replayTool;
  // Bursts of seeded noise 6 ms long every 100 ms over a quiet tone: sparse contacts, as a seam's are.
  let seed = 7;
  const next = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 31 - 1; };
  const n = 48000;
  const rendered = [0, 1].map((c) => Float32Array.from({ length: n }, (_, i) => {
    const t = i % 4800;
    return 0.02 * Math.sin((2 * Math.PI * (330 + 40 * c) * i) / 48000) + (t < 288 ? 0.3 * next() * (1 - t / 288) : 0);
  }));
  // The film: the render as the export levels it, with a little noise of its own, as a codec's error.
  const heard = rendered.map((x) => x.slice());
  normalizeLoudness(audio(heard), 'mp4a');
  const coded = heard.map((x) => x.map((v) => v + 0.004 * next()));
  const inPage = async (decoded, span) => {
    const p = validate({ name: 'tone', size: { w: 8, h: 8 }, time: { duration: 1, hz: 10 }, sound() {}, draw() {} });
    class OfflineAudioContext {
      constructor(channels, length, sampleRate) { Object.assign(this, { channels, length, sampleRate, destination: {} }); }
      startRendering() { return Promise.resolve(audio(rendered.map((x) => x.slice()))); }
      decodeAudioData() { return Promise.resolve(audio(decoded)); }
    }
    const window = { __artifex: { piece: require('../core/piece.js'), render: require('../core/render.js'), examples: { tone: p }, level: normalizeLoudness } };
    const recipe = { ...solve(p, p.seed).manifest, film: { frames: 10, hz: 10, loop: false, scale: 1 } };
    return vm.runInNewContext(`(${compareSound})(new Uint8Array(0), ${JSON.stringify(recipe)}, ${SOUND_BLOCK}, "mp4a", ${SOUND_BAND}, ${SOUND_FLATNESS}, ${JSON.stringify(SOUND_CUT)}, ${JSON.stringify(SOUND_VOICE)}, ${SOUND_MASK_DB.mp4a}, ${JSON.stringify(span)}, ${JSON.stringify(SOUND_SPARSE)})`, { window, OfflineAudioContext, atob });
  };
  const alone = await inPage(coded, null);
  // The same scene in a joined soundtrack, from a block boundary, between two other scenes.
  const at = 30 * SOUND_BLOCK, total = at + n + 20000;
  const joined = tone(total, 300).map((x, c) => { x.set(coded[c], at); return x; });
  const scene = await inPage(joined, { at, from: 0, to: n, total });
  assert.ok(alone.blocks.some((b) => b[9] > 0), 'some block of the scene lies beside an onset');
  assert.equal(scene.blocks.length, alone.blocks.length);
  const differing = scene.blocks.findIndex((b, i) => b.some((v, k) => Math.abs(v - alone.blocks[i][k]) > 1e-6 * Math.max(1, Math.abs(v))));
  assert.equal(differing, -1, 'block ' + differing + ' is measured differently inside the joined film');
  assert.equal(soundVerdict(scene, 'mp4a').match, soundVerdict(alone, 'mp4a').match);
  // A burst moved in the film is found in the scene as it is alone, at the same second.
  const moved = coded.map((x) => { const y = x.slice(); y.copyWithin(24000 + 480, 24000, 24000 + 288); return y; });
  const [a, b] = [soundVerdict(await inPage(moved, null), 'mp4a'), soundVerdict(await inPage(tone(total, 300).map((x, c) => { x.set(moved[c], at); return x; }), { at, from: 0, to: n, total }), 'mp4a')];
  assert.equal(a.match, false, a.detail);
  assert.equal(b.match, false, b.detail);
  assert.equal(/at (\d+\.\d+) s/.exec(b.detail)[1], /at (\d+\.\d+) s/.exec(a.detail)[1], 'named at the scene\'s own second');
});
