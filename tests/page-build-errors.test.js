'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { pngWithManifest, pngManifest } = require('../tools/build-page.js');
const { fakeAudio, fakeCodecs, fakePage } = require('./fake-media.js');
const { measureLoudness, loudnessGain } = require('../core/film.js');

// A real PNG, one opaque pixel, built with Node's own zlib and CRC-32 so the
// page's CRC is checked against an implementation it does not share.
function tinyPng() {
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    data.copy(out, 8);
    out.writeUInt32BE(zlib.crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.from([0, 200, 100, 50, 255]))), chunk('IEND', Buffer.alloc(0))]));
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

function registry(module) {
  module.exports = {
    conditional: {
      name: 'conditional', size: { w: 40, h: 30 }, seed: 7,
      time: { duration: 1, hz: 4 }, outputs: ['raster', 'vector'],
      state: () => ({}),
      build: [
        ['prepare', (state) => { state.width = 12; }],
        ['validate', (state) => { if (state.seed !== 42) throw new Error('fixture build failed'); }],
      ],
      draw(surface, state) { surface.fillRect(0, 0, state.width, 10); },
    },
    valid: { name: 'valid', size: { w: 40, h: 30 }, draw(surface) { surface.fillRect(0, 0, 20, 20); } },
    voiced: {
      name: 'voiced', size: { w: 40, h: 30 }, time: { duration: 1, hz: 4 },
      sound(ctx) { const o = ctx.createOscillator(); o.connect(ctx.destination); o.start(0); },
      draw(surface) { surface.fillRect(0, 0, 20, 20); },
    },
    // 1.01 s at 10 Hz is ten frames: a film, and a soundtrack, of 1 s.
    offgrid: {
      name: 'offgrid', size: { w: 40, h: 30 }, time: { duration: 1.01, hz: 10 },
      sound(ctx) { const o = ctx.createOscillator(); o.connect(ctx.destination); o.start(0); },
      draw(surface) { surface.fillRect(0, 0, 20, 20); },
    },
    throwing: {
      name: 'throwing', size: { w: 40, h: 30 },
      state() { throw new Error('fixture state failed'); },
      draw(surface) { surface.fillRect(0, 0, 20, 20); },
    },
    // Reads its own canvas back, as a pixel piece may.
    reading: {
      name: 'reading', size: { w: 40, h: 30 }, time: { duration: 1, hz: 4 },
      draw(surface) { for (let i = 0; i < 3; i++) surface.getImageData(0, 0, 1, 1); surface.fillRect(0, 0, 20, 20); },
    },
  };
}

function openPage({ deferPng = false, videoFailure = null, codecs = null, media = null } = {}) {
  const pngCallbacks = [];
  const activity = { clears: 0, draws: 0 };
  // Every element is the shared stand-in canvas, which the film export draws
  // on and reads back; every clear is counted.
  const page = fakePage({
    modules: { 'examples/index.js': registry },
    fields: () => ({ disabled: false }),
    png: tinyPng,
    onBlob: (finish) => { if (deferPng) pngCallbacks.push(finish); else finish(); },
    onContext(g) {
      const clear = g.clearRect, read = g.getImageData;
      g.clearRect = function (...args) { activity.clears++; return clear.apply(this, args); };
      // How often each canvas was read back, to tell which one a piece read.
      g.getImageData = function (...args) { g.canvas.readBacks = (g.canvas.readBacks || 0) + 1; return read.apply(this, args); };
    },
    globals: {
      ...(videoFailure && { MediaStreamTrackGenerator: function () { throw new Error(videoFailure); } }),
      ...(codecs && {
        VideoEncoder: codecs.VideoEncoder, VideoFrame: codecs.VideoFrame,
        AudioEncoder: codecs.AudioEncoder, AudioData: codecs.AudioData, OfflineAudioContext: fakeAudio().Context,
      }),
      ...media,
    },
  });
  const draw = page.api.render.drawFrame;
  page.api.render.drawFrame = (...args) => { activity.draws++; return draw(...args); };
  return { ...page, activity, pngCallbacks, saved: page.blobs };
}

// The fixture pieces, as the page's registry holds them.
function fixtures() {
  const m = {};
  registry(m);
  return m.exports;
}

test('failed build keeps its named diagnostic and blocks transport and every export', async () => {
  const { api, elements, png, downloads, frames, activity } = openPage();
  const original = 'build stage "validate" (2 of 2) threw: fixture build failed';
  assert.equal(api.read().error, original);
  assert.doesNotThrow(() => api.setT(0.5));
  elements.get('play').onclick();
  elements.get('t').value = 900;
  elements.get('t').oninput();
  png.onclick();
  elements.get('svg').onclick();
  elements.get('video').onclick();
  await assert.rejects(api.video(), (error) => error.message === original);
  await assert.rejects(api.film(), (error) => error.message === original);
  assert.equal(api.read().error, original);
  assert.equal(elements.get('err').textContent, original);
  assert.equal(api.manifest(), null, 'partial state must not be offered as a replay recipe');
  assert.equal(frames.size, 0, 'failed builds cannot start an animation loop');
  assert.equal(activity.draws, 0, 'no rendering may consume the partial build');
  assert.ok(activity.clears > 0, 'a previous picture must not remain as a successful result');
  assert.deepEqual(downloads, []);
  assert.equal(elements.get('facts').innerHTML, '');
  for (const name of ['play', 't', 'svg', 'video', 'film1', 'film2']) assert.equal(elements.get(name).disabled, true, name);
  assert.equal(png.disabled, true);
});

test('a valid rebuild or another piece recovers rendering, controls and export after failure', async () => {
  const { api, elements, png, downloads, activity } = openPage();
  api.setSeed(42);
  assert.equal(api.read().error, null);
  assert.equal(api.manifest().seed, 42);
  assert.equal(elements.get('play').disabled, false);
  assert.equal(png.disabled, false);
  api.setT(0.5);
  png.onclick(); await settle(); elements.get('svg').onclick();
  assert.deepEqual(downloads, ['conditional-42@1x.png', 'conditional-42.svg']);
  assert.ok(activity.draws > 0);
  api.setSeed(7);
  assert.match(api.read().error, /fixture build failed/);
  assert.equal(api.manifest(), null);
  api.select('valid');
  assert.equal(api.read().name, 'valid');
  assert.equal(api.read().error, null);
  assert.equal(elements.get('play').disabled, true, 'a recovered still keeps its capability limits');
  assert.equal(png.disabled, false);
  png.onclick();
  await settle();
  assert.equal(downloads.at(-1), 'valid-1@1x.png');
});

test('a state initializer exception also invalidates any previous successful build', () => {
  const { api, png, downloads, activity } = openPage();
  api.select('valid');
  const previousDraws = activity.draws;
  api.select('throwing');
  assert.equal(api.read().error, 'fixture state failed');
  assert.equal(api.manifest(), null);
  assert.doesNotThrow(() => api.setT(0.5));
  png.onclick();
  assert.equal(activity.draws, previousDraws);
  assert.deepEqual(downloads, []);
  assert.equal(api.read().error, 'fixture state failed');
});

test('a pending valid PNG retains its original recipe when a later rebuild fails', async () => {
  const { api, png, downloads, pngCallbacks, saved } = openPage({ deferPng: true });
  api.setSeed(42);
  png.onclick();
  assert.equal(pngCallbacks.length, 1);
  assert.deepEqual(downloads, []);
  api.setSeed(7);
  const original = api.read().error;
  assert.match(original, /fixture build failed/);
  assert.doesNotThrow(() => pngCallbacks[0]());
  await settle();
  assert.deepEqual(downloads, ['conditional-42@1x.png']);
  assert.equal(pngManifest(new Uint8Array(await saved.at(-1).arrayBuffer())).seed, 42, 'the file names the recipe it was drawn from');
  assert.equal(api.read().error, original);
  assert.equal(api.manifest(), null);
});

test('an earlier video rejection cannot replace the status of a newly selected valid piece', async () => {
  const { api, elements } = openPage({ videoFailure: 'fixture encoder failed' });
  api.setSeed(42);
  elements.get('video').onclick();
  api.select('valid');
  const note = elements.get('videonote').textContent;
  await new Promise(setImmediate);
  assert.equal(api.read().name, 'valid');
  assert.equal(api.read().error, null);
  assert.equal(elements.get('videonote').textContent, note);
  assert.equal(elements.get('video').disabled, true, 'the current still keeps its capability limit');
});

test('the MP4 film is refused by name without an encoder, and a still offers none', async () => {
  const { api, elements, downloads } = openPage();
  // With nothing exporting, a still's rebuild alone decides the buttons.
  api.select('valid');
  assert.equal(elements.get('film1').disabled, true, 'a still has no film');
  assert.equal(elements.get('film2').disabled, true);
  api.select('conditional');
  api.setSeed(42);
  assert.equal(elements.get('film1').disabled, false, 'a valid timeline can be filmed');
  assert.match(elements.get('filmnote').textContent, /encoded at its own time/);
  await assert.rejects(api.film(), /no VideoEncoder/);
  elements.get('film2').onclick();
  api.select('valid');
  await new Promise(setImmediate);
  assert.equal(api.read().error, null, 'a rejection for the previous piece does not land on this one');
  assert.deepEqual(downloads, []);
  assert.equal(elements.get('film1').disabled, true, 'and the still keeps its limit once that export settles');
});

test('a browser that encodes the film H.264 offers only the MP4 export', async () => {
  const asked = [];
  const { api, elements } = openPage({ codecs: fakeCodecs({ supported: (config) => { asked.push(config); return true; } }) });
  assert.equal(await api.filmFormat(), 'mp4');
  assert.equal(elements.get('mp4').hidden, false);
  assert.equal(elements.get('webm').hidden, true, 'no WebM control where the MP4 film encodes');
  api.setSeed(42);
  const report = await api.film();
  assert.deepEqual(asked[1], asked[0], 'the page asks about the configuration the export encodes with');
  assert.equal(report.codec, asked[0].codec);
  api.select('valid');
  assert.equal(await api.filmFormat(), null, 'a still offers no film');
  assert.equal(elements.get('webm').hidden, true);
  api.select('conditional');
  assert.equal(await api.filmFormat(), 'mp4');
  assert.equal(asked.length, 2, 'the encoder is asked once per size and frame rate, then by the export');
});

test('the page films at 1920 pixels on the long edge unless told a scale, at the bitrate it is given', async () => {
  const { api, elements, downloads } = openPage({ codecs: fakeCodecs() });
  api.setSeed(42);
  const report = await api.film();
  assert.deepEqual([report.width, report.height, report.manifest.film.scale], [1920, 1440, 48], 'a 40 x 30 box drawn 48 times over');
  assert.equal(report.name, 'conditional-42-1920x1440.mp4');
  const draft = await api.film({ scale: 1, bitrate: 3000000 });
  assert.deepEqual([draft.width, draft.height, draft.bitrate], [40, 30, 3000000]);
  await assert.rejects(api.film({ bitrate: '3e6' }), /^Error: film: bitrate must be a whole number of bits per second above zero, got 3e6$/);
  // The stand-in elements carry no markup, so each control takes the scale its button names.
  const markup = require('node:fs').readFileSync(require.resolve('../tools/build-page.js'), 'utf8');
  for (const id of ['film1', 'film2']) elements.get(id).dataset = { film: markup.match(new RegExp('<button id="' + id + '" data-film="([^"]*)"'))[1] };
  for (const [id, name] of [['film1', 'conditional-42-1920x1440.mp4'], ['film2', 'conditional-42-40x30.mp4']]) {
    elements.get(id).onclick();
    for (let i = 0; i < 50 && downloads.at(-1) !== name; i++) await settle();
    assert.equal(downloads.at(-1), name, id === 'film1' ? 'the first control films at the default scale' : 'the second films the design box');
  }
});

test('where H.264 cannot encode the film, the page offers the WebM recorder instead', async () => {
  const cases = [[null, /no VideoEncoder/], [fakeCodecs({ supported: () => false }), /no H\.264 encoder here accepts 1920 x 1440 at 4 Hz/]];
  for (const [codecs, refusal] of cases) {
    const { api, elements } = openPage({ codecs, videoFailure: 'fixture recorder reached' });
    assert.equal(await api.filmFormat(), 'webm');
    assert.equal(elements.get('webm').hidden, false);
    assert.equal(elements.get('mp4').hidden, true, 'an MP4 control that cannot encode is not offered');
    api.setSeed(42);
    await assert.rejects(api.film(), refusal, 'the scripted MP4 export still refuses by name');
    assert.equal(elements.get('video').disabled, false);
    elements.get('video').onclick();
    await new Promise(setImmediate);
    assert.equal(api.read().error, 'fixture recorder reached', 'the WebM control runs the recorder');
    api.select('valid');
    assert.equal(await api.filmFormat(), null);
    assert.equal(elements.get('webm').hidden, true, 'a still offers no film');
    assert.equal(elements.get('mp4').hidden, false);
  }
});

test('where neither AAC nor Opus encodes, a piece with sound is offered a silent WebM', async () => {
  const asked = [];
  const codecs = fakeCodecs({ aac: false, opus: false });
  const ask = codecs.AudioEncoder.isConfigSupported;
  codecs.AudioEncoder.isConfigSupported = (config) => { asked.push(config); return ask(config); };
  const { api, elements } = openPage({ codecs, videoFailure: 'fixture recorder reached' });
  api.select('voiced');
  assert.equal(await api.filmFormat(), 'webm');
  assert.equal(elements.get('mp4').hidden, true, 'an MP4 control that would refuse the film is not offered');
  assert.equal(elements.get('webm').hidden, false);
  assert.match(elements.get('videonote').textContent, /^4 frames, recorded in real time\. The film is silent: this browser encodes neither AAC nor Opus/);
  const probed = asked.length;
  assert.equal(probed, 2, 'AAC, then Opus');
  await assert.rejects(api.film(), /encodes neither AAC nor Opus, and a film without its soundtrack is not written/,
    'the MP4 export still refuses a film without its soundtrack');
  assert.deepEqual(asked.slice(probed), asked.slice(0, probed), 'the page asks about the soundtrack the export would encode');
  elements.get('video').onclick();
  await new Promise(setImmediate);
  assert.equal(api.read().error, 'fixture recorder reached', 'the WebM control runs the recorder');
});

test('a piece without sound keeps the MP4 film where neither AAC nor Opus encodes', async () => {
  let asked = 0;
  const codecs = fakeCodecs({ aac: false, opus: false });
  const ask = codecs.AudioEncoder.isConfigSupported;
  codecs.AudioEncoder.isConfigSupported = (config) => { asked++; return ask(config); };
  const { api, elements } = openPage({ codecs });
  api.setSeed(42);
  assert.equal(await api.filmFormat(), 'mp4');
  assert.equal(elements.get('webm').hidden, true);
  assert.equal(asked, 0, 'a piece without sound asks nothing about a soundtrack');
  assert.equal((await api.film()).frames, 4);
  // A piece with sound keeps MP4 where its soundtrack encodes, and keeps the
  // H.264 reason where the video cannot encode either.
  const voiced = openPage({ codecs: fakeCodecs({ aac: false }) });
  voiced.api.select('voiced');
  assert.equal(await voiced.api.filmFormat(), 'mp4');
  assert.equal((await voiced.api.film()).sound.codec, 'Opus');
  const neither = openPage({ codecs: fakeCodecs({ supported: () => false, aac: false, opus: false }) });
  neither.api.select('voiced');
  assert.equal(await neither.api.filmFormat(), 'webm');
  assert.match(neither.elements.get('videonote').textContent, /without sound, because this browser cannot encode the MP4 film/);
});

test('an SVG saved from the page names the recipe manifest() names, in the bytes renderVector writes', async () => {
  const { renderVector } = require('../core/render.js');
  const { api, elements, saved } = openPage();
  api.setSeed(42);
  api.setT(0.6);
  elements.get('svg').onclick();
  const svg = await saved.at(-1).text();
  const { svgManifest } = require('../core/surface-vector.js');
  // Through JSON: the page's objects belong to another realm.
  assert.deepEqual(svgManifest(svg), JSON.parse(JSON.stringify(api.manifest())), 'the saved SVG carries the recipe at the playhead that was drawn');
  assert.equal(svg, renderVector(fixtures().conditional, { seed: 42, t: 0.6 }).svg, 'and the same file the API writes for it');
});

test('a PNG carries its recipe in one iTXt chunk before IEND, and every other byte as encoded', () => {
  const png = tinyPng();
  const manifest = { name: 'café ☕', seed: 42, params: { reach: 0.5 }, t: 0.25, scale: 4 };
  const saved = pngWithManifest(png, manifest);
  const at = png.length - 12;
  const length = new DataView(saved.buffer).getUint32(at);
  const chunk = saved.subarray(at, at + 12 + length);
  assert.equal(Buffer.from(chunk.subarray(4, 8)).toString('latin1'), 'iTXt');
  assert.equal(Buffer.from(saved.subarray(at + 12 + length, at + 20 + length)).toString('latin1').slice(4), 'IEND', 'IEND comes right after it');
  assert.equal(new DataView(chunk.buffer, chunk.byteOffset).getUint32(8 + length), zlib.crc32(chunk.subarray(4, 8 + length)), 'its CRC is the one zlib computes');
  assert.deepEqual([...saved.subarray(0, at), ...saved.subarray(at + 12 + length)], [...png], 'without the chunk, the PNG as encoded');
  assert.deepEqual(pngManifest(saved), manifest, 'it reads back, non-ASCII names included');
  assert.equal(pngManifest(png), null);
  assert.ok(chunk.subarray(8, 8 + length).every((b) => b < 0x80), 'the JSON is ASCII, so it is also valid UTF-8');
  assert.throws(() => pngWithManifest(png.subarray(0, at), manifest), /no IEND/);
});

test('a PNG cut short inside its manifest chunk, or a chunk without its text, is refused by name', () => {
  const png = tinyPng();
  const at = png.length - 12;
  const saved = pngWithManifest(png, { name: 'cut', seed: 1 });
  assert.throws(() => pngManifest(saved.subarray(0, at + 30)), /ends inside its artifex-manifest chunk/);
  // Keyword, its null and the two compression bytes, then nothing: no language
  // tag, no translated keyword and no text inside the chunk. The IEND after it
  // is all zeros, so a reader that looked past the chunk would find its nulls.
  const body = Buffer.from('iTXtartifex-manifest\0\0\0', 'latin1');
  const bare = Buffer.alloc(body.length + 8);
  bare.writeUInt32BE(body.length - 4, 0);
  body.copy(bare, 4);
  bare.writeUInt32BE(zlib.crc32(body), body.length + 4);
  const malformed = new Uint8Array(Buffer.concat([png.subarray(0, at), bare, png.subarray(at)]));
  assert.throws(() => pngManifest(malformed), /ends before its text/);
});

test('a PNG saved from the page names its recipe and the scale it was drawn at', async () => {
  const { api, png, saved, downloads } = openPage();
  api.setSeed(42);
  api.setT(0.6);
  for (const scale of ['1', '4']) {
    png.dataset.png = scale;
    png.onclick();
    await settle();
    const bytes = new Uint8Array(await saved.at(-1).arrayBuffer());
    const recipe = Object.assign(JSON.parse(JSON.stringify(api.manifest())), { scale: Number(scale) });
    assert.deepEqual(pngManifest(bytes), recipe);
    assert.equal(downloads.at(-1), 'conditional-42@' + scale + 'x.png');
    assert.equal(bytes.length, tinyPng().length + 12 + new DataView(bytes.buffer).getUint32(tinyPng().length - 12));
  }
});

test('the page tells a script why it offers WebM, from the decision its note is written from', async () => {
  const notes = {
    h264: /^4 frames, recorded in real time and without sound, because this browser cannot encode the MP4 film/,
    soundtrack: /^4 frames, recorded in real time\. The film is silent: this browser encodes neither AAC nor Opus/,
  };
  const cases = [
    ['conditional', fakeCodecs(), { format: 'mp4', reason: null }],
    ['conditional', null, { format: 'webm', reason: 'h264' }],
    ['conditional', fakeCodecs({ supported: () => false }), { format: 'webm', reason: 'h264' }],
    ['voiced', fakeCodecs({ aac: false, opus: false }), { format: 'webm', reason: 'soundtrack' }],
    // Without H.264 the silent recorder is the only film, whatever the soundtrack.
    ['voiced', fakeCodecs({ supported: () => false, aac: false, opus: false }), { format: 'webm', reason: 'h264' }],
    ['valid', fakeCodecs(), { format: null, reason: 'still' }],
  ];
  for (const [name, codecs, want] of cases) {
    const { api, elements } = openPage({ codecs });
    api.select(name);
    const offer = await api.filmOffer();
    assert.deepEqual({ ...offer }, want, `${name} with ${codecs ? 'these' : 'no'} encoders`);
    assert.equal(await api.filmFormat(), want.format, 'filmFormat() still answers with the format alone');
    if (want.format === 'webm') assert.match(elements.get('videonote').textContent, notes[want.reason], `${name}: the note gives the reason a script reads`);
    offer.reason = 'changed';
    assert.equal((await api.filmOffer()).reason, want.reason, 'a script cannot change the decision it was handed');
  }
});

test('playing a piece with sound plays its soundtrack from the playhead, and every transport change stops it', async () => {
  // The audio fake stands in for both contexts and records every source; the
  // clock is the page's performance.now(), moved by hand.
  const audio = fakeAudio();
  const made = [];
  class Listener extends audio.Context {
    constructor() { super(2, 1, 48000); this.state = 'suspended'; made.push(this); }

    resume() { this.state = 'running'; return Promise.resolve(); }
  }
  let clock = 1;
  const media = { AudioContext: Listener, OfflineAudioContext: audio.Context, performance: { now: () => clock } };
  const settle = () => new Promise(setImmediate);
  const sources = () => audio.record.nodes.filter((n) => n.kind === 'bufferSource');
  const sounding = () => sources().filter((n) => n.end === null);

  // A piece without sound plays in silence and makes no audio context at all.
  const mute = openPage({ media });
  mute.api.setSeed(42);
  mute.elements.get('play').onclick();
  await settle();
  assert.equal(made.length, 0, 'no audio context for a piece that declares no sound');

  const { api, elements, frame } = openPage({ media });
  const play = () => elements.get('play').onclick();
  api.select('voiced');
  api.setT(0.5);
  play();
  assert.equal(made.length, 1);
  assert.equal(made[0].state, 'running', 'the context is woken inside the click');
  await settle();
  const [first] = sources();
  assert.equal(sources().length, 1, 'one source');
  assert.deepEqual([first.at, first.offset, first.buffer.duration], [0, 0.5, 1], 'started at once, from the playhead, on the whole soundtrack');
  assert.deepEqual(first.to, [made[0].destination]);

  play();
  assert.equal(sounding().length, 0, 'pausing stops it');
  assert.deepEqual(first.to, [], 'and disconnects it');
  play();
  await settle();
  elements.get('t').value = 250;
  elements.get('t').oninput();
  assert.equal(sounding().length, 0, 'scrubbing stops it');
  play();
  await settle();
  elements.get('seed').value = 5;
  elements.get('seed').onchange();
  assert.equal(sounding().length, 0, 'a new seed stops it');

  // A new solve while playing: the old sound stops, the new one starts from the
  // playhead, and a render that lands after the transport stopped starts nothing.
  play();
  await settle();
  const old = sounding()[0];
  api.setSeed(9);
  assert.notEqual(old.end, null, 'the old solve stops at once');
  await settle();
  assert.equal(sounding().length, 1, 'and the new one plays');
  assert.notEqual(sounding()[0], old);
  api.setT(0.5);
  play();
  play();
  await settle();
  assert.equal(sounding().length, 0, 'a render that finishes after a stop starts nothing');

  // The transport wraps at the end, and the soundtrack starts again with it. An
  // animation frame stamped a moment before the click is no wrap.
  play();
  await settle();
  const before = sounding()[0];
  assert.equal(before.offset, 0.5);
  frame(0.5);
  await settle();
  assert.equal(before.end, null, 'a frame stamped before the click leaves the sound playing');
  assert.equal(sounding().length, 1);
  clock = 601;
  frame(601);
  await settle();
  assert.notEqual(before.end, null, 'the wrap stops the source that ran out');
  assert.equal(sounding().length, 1);
  assert.ok(Math.abs(sounding()[0].offset - 0.1) < 1e-9, `and starts one where the transport is, at ${sounding()[0].offset}`);

  api.select('conditional');
  assert.equal(sounding().length, 0, 'selecting another piece stops it');
  assert.equal(made.length, 1, 'one context serves the page');
});

test('a transport lap lasts the frame grid, and a frame stamped before the click reads playhead 0', async () => {
  const audio = fakeAudio();
  let clock = 1;
  const media = { AudioContext: audio.Context, OfflineAudioContext: audio.Context, performance: { now: () => clock } };
  const settle = () => new Promise(setImmediate);
  const sounding = () => audio.record.nodes.filter((n) => n.kind === 'bufferSource' && n.end === null);
  const { api, elements, frame } = openPage({ media });
  api.select('offgrid');
  elements.get('play').onclick();
  await settle();
  const first = sounding()[0];
  assert.equal(first.buffer.duration, 1, 'ten frames at 10 Hz: a 1 s soundtrack');
  // Halfway through the 1 s lap, not the declared 1.01 s.
  frame(501);
  assert.equal(api.read().t, 0.5);
  // 5 ms past the lap: the transport has wrapped with the soundtrack, where a
  // 1.01 s lap would still be 5 ms short of its end with nothing left to hear.
  clock = 1006;
  frame(1006);
  await settle();
  assert.notEqual(first.end, null, 'the soundtrack that ran out is stopped');
  assert.ok(Math.abs(sounding()[0].offset - 0.005) < 1e-9, `and another starts where the lap is, at ${sounding()[0].offset}`);
  assert.ok(Math.abs(api.read().t - 0.005) < 1e-9);

  // A frame stamped a moment before the click cannot put the playhead below 0.
  api.setT(0);
  clock = 2000;
  elements.get('play').onclick();
  frame(1999.5);
  assert.equal(api.read().t, 0);
  assert.equal(elements.get('t').value, 0, 'the slider shows 0 as well');
});

// The browser's recorder, played by stand-ins: every frame written becomes one
// SimpleBlock at its place on the frame grid, in the live shape Edge writes -- a
// Segment and a Cluster of unknown size, and a Duration of one unit.
function recorderStandIns(hz) {
  const inits = [], sources = [];
  let written = 0, sent = 0, clock = 0, opened = false;
  const head = [0x1A, 0x45, 0xDF, 0xA3, 0x83, 0xA3, 0xA3, 0xA3, 0x18, 0x53, 0x80, 0x67, 0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
    0x15, 0x49, 0xA9, 0x66, 0x8E, 0x2A, 0xD7, 0xB1, 0x83, 0x0F, 0x42, 0x40, 0x44, 0x89, 0x84, 0x3F, 0x80, 0x00, 0x00,
    0x1F, 0x43, 0xB6, 0x75, 0xFF, 0xE7, 0x81, 0x00];
  class MediaRecorder {
    start() {}
    requestData() {
      const bytes = opened ? [] : [...head];
      opened = true;
      for (; sent < written; sent++) { const t = Math.round((sent * 1000) / hz); bytes.push(0xA3, 0x85, 0x81, t >> 8, t & 255, 0x80, 0x00); }
      this.ondataavailable({ data: new Blob([Uint8Array.from(bytes)]) });
    }
    stop() { this.requestData(); this.onstop(); }
  }
  const media = {
    performance: { now: () => (clock += 20) },
    MessageChannel: function () { const port1 = {}; this.port1 = port1; this.port2 = { postMessage() { Promise.resolve().then(() => port1.onmessage()); } }; },
    MediaStreamTrackGenerator: function () { this.writable = { getWriter: () => ({ async write() { written++; }, async close() {} }) }; },
    MediaStream: function () {},
    MediaRecorder,
    VideoFrame: function (source, init) { inits.push(init); sources.push(source); this.close = () => {}; },
  };
  return { media, inits, sources };
}

test('the WebM export records frames without alpha and saves the film with its length', async () => {
  const { webmBlockTimes } = require('../tools/build-page.js');
  const { media, inits } = recorderStandIns(4);
  const { api } = openPage({ media });
  api.setSeed(42);
  const report = await api.video();
  assert.equal(inits.length, 4);
  assert.ok(inits.every((init) => init.alpha === 'discard'), 'translucency reaches the recorder over black, as in the MP4');
  const saved = new Uint8Array(await report.blob.arrayBuffer());
  assert.deepEqual(webmBlockTimes(saved), [0, 250, 500, 750]);
  assert.equal(new DataView(saved.buffer).getFloat32(35), 1000, 'four frames at 4 Hz last 1000 units of 1 ms');
});

test('the WebM export records a copy of each frame, on a canvas no piece reads back', async () => {
  // Three read-backs move a canvas to memory, and Edge's recorder then codes the
  // rest of the film in full range under a Colour element that says limited.
  const { media, sources } = recorderStandIns(4);
  const { api } = openPage({ media });
  const drawn = [];
  const draw = api.render.drawFrame;
  api.render.drawFrame = (g, ...rest) => { drawn.push(g.canvas); return draw(g, ...rest); };
  api.select('reading');
  drawn.length = 0;
  await api.video();
  assert.equal(sources.length, 4);
  assert.ok(drawn.length >= 4 && drawn.every((canvas) => canvas.readBacks >= 3), 'the piece read back the canvas it drew on');
  assert.ok(sources.every((canvas) => !canvas.readBacks && !drawn.includes(canvas)), 'every recorded frame comes from a canvas nothing read back');
});

test('the WebM export names the recipe an MP4 of the same film names', async () => {
  const { webmManifest } = require('../tools/build-page.js');
  const webm = openPage({ media: recorderStandIns(4).media });
  webm.api.setSeed(42);
  const report = await webm.api.video();
  const tag = webmManifest(new Uint8Array(await report.blob.arrayBuffer()));
  const mp4 = openPage({ codecs: fakeCodecs() });
  mp4.api.setSeed(42);
  // At the design box, where the recorder draws it.
  const film = await mp4.api.film({ scale: 1 });
  // Through JSON: the page's objects belong to another realm.
  assert.deepEqual(tag, JSON.parse(JSON.stringify(film.manifest)), 'the recipe the MP4 carries, frame grid and scale 1 included');
  assert.deepEqual(JSON.parse(JSON.stringify(report.manifest)), tag, 'and the report names it too');
});

// A WebM with an index, laid out from named top-level parts in order. A
// SeekHead or Cues stores the Segment positions of the parts it names in
// one-byte fields, as Edge's recorder writes a small position. Edge writes
// Cues after the last Cluster when it stops; a recording collected only at
// stop also starts with a SeekHead and has a Segment of known size. With
// `crc`, Info opens with a CRC-32 of the rest of its data, as EBML stores one.
const SEEKHEAD = [0x11, 0x4D, 0x9B, 0x74], CUES = [0x1C, 0x53, 0xBB, 0x6B], INFO = [0x15, 0x49, 0xA9, 0x66], CLUSTER = [0x1F, 0x43, 0xB6, 0x75];
function indexedWebm(layout, { known = false, dated = true, crc = false, parts = {} } = {}) {
  const el = (id, body) => { assert.ok(body.length < 127); return [...id, 0x80 | body.length, ...body]; };
  const u8 = (id, v) => { assert.ok(v < 256); return [...id, 0x81, v]; };
  const eight = (n) => (n === null ? [0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF] : [0x01, 0, 0, 0, 0, 0, n >> 8, n & 255]);
  const cluster = (t, last, extra = []) => {
    const body = [0xE7, 0x81, t, ...extra, 0xA3, 0x85, 0x81, 0x00, 0x00, 0x80, 0xA3, 0xA3, 0x85, 0x81, 0x00, 0x21, 0x80, 0xA3];
    return [...CLUSTER, ...eight(last && !known ? null : body.length), ...body];
  };
  const seek = (id, at) => el([0x4D, 0xBB], [...el([0x53, 0xAB], id), ...u8([0x53, 0xAC], at)]);
  const cue = (t, at, extra = []) => el([0xBB], [...u8([0xB3], t), ...el([0xB7], [...u8([0xF7], 1), ...u8([0xF1], at), ...extra])]);
  // An element that opens with the CRC-32 of the rest of its data, little-endian.
  const summed = (id, data) => {
    const sum = zlib.crc32(Uint8Array.from(data));
    return el(id, [0xBF, 0x84, sum & 255, (sum >>> 8) & 255, (sum >>> 16) & 255, sum >>> 24, ...data]);
  };
  const all = {
    head: (at) => el(SEEKHEAD, [...seek(INFO, at.info), ...seek(CLUSTER, at.one), ...seek(CUES, at.cues)]),
    tail: (at) => el(SEEKHEAD, seek(CUES, at.cues)),
    void: () => [0xEC, 0x83, 0, 0, 0],
    info: () => {
      const data = [0x2A, 0xD7, 0xB1, 0x83, 0x0F, 0x42, 0x40, ...(dated ? [0x44, 0x89, 0x84, 0x3F, 0x80, 0x00, 0x00] : [])];
      return crc ? summed(INFO, data) : el(INFO, data);
    },
    one: () => cluster(0, false),
    two: () => cluster(42, true),
    cues: (at) => el(CUES, [...cue(0, at.one), ...cue(42, at.two)]),
    ...parts,
    el, cluster, cue, seek, summed,
  };
  // The first pass finds where each part starts; every field keeps its width, so the second fills them in.
  let at = Object.fromEntries(layout.map((name) => [name, 0])), body;
  for (let pass = 0; pass < 2; pass++) {
    const next = {};
    body = [];
    for (const name of layout) { next[name] = body.length; body.push(...all[name](at, all)); }
    at = next;
  }
  return Uint8Array.from([0x1A, 0x45, 0xDF, 0xA3, 0x83, 0xA3, 0xA3, 0xA3, 0x18, 0x53, 0x80, 0x67, ...eight(known ? body.length : null), ...body]);
}

// What each stored position in a WebM names, in file order -- the id of the
// element it points at, or a Cluster by its Timecode -- its field's width, and
// for a Seek entry the SeekID it claims.
function stored(bytes) {
  const { ebmlHead } = require('../tools/build-page.js');
  const into = [0x18538067, 0x1F43B675, 0x114D9B74, 0x4DBB, 0x1C53BB6B, 0xBB, 0xB7];
  const uint = (e) => { let v = 0; for (let i = 0; i < e.size; i++) v = v * 256 + bytes[e.body + i]; return v; };
  let base = 0, seek = null;
  const out = [];
  for (let p = 0; p < bytes.length;) {
    const e = ebmlHead(bytes, p);
    if (e.id === 0x18538067) base = e.body;
    if (into.includes(e.id)) { p = e.body; continue; }
    if (e.id === 0x53AB) seek = uint(e);
    if (e.id === 0x53AC || e.id === 0xF1) {
      const t = ebmlHead(bytes, base + uint(e));
      out.push({ name: t.id === 0x1F43B675 ? 'Cluster ' + bytes[ebmlHead(bytes, t.body).body] : t.id.toString(16), width: e.size, seek: e.id === 0x53AC ? seek : null, target: t.id, at: t.at });
    }
    p = e.body + e.size;
  }
  return out;
}

// Whether each CRC-32 opening an element of the Segment, or a part of a SeekHead
// or Cues, matches the rest of that element's data, in file order.
function checksums(bytes) {
  const { ebmlHead } = require('../tools/build-page.js');
  const index = [0x114D9B74, 0x4DBB, 0x1C53BB6B, 0xBB, 0xB7];
  const out = [];
  for (let p = 0; p < bytes.length;) {
    const e = ebmlHead(bytes, p);
    if (e.id === 0x18538067 || e.id === 0x1F43B675) { p = e.body; continue; }
    if (e.unknown) break;
    const c = ebmlHead(bytes, e.body);
    const crc = e.size > 6 && c.id === 0xBF;
    if (crc) out.push(new DataView(bytes.buffer, bytes.byteOffset).getUint32(c.body, true) === zlib.crc32(bytes.subarray(c.body + 4, e.body + e.size)));
    p = !index.includes(e.id) ? e.body + e.size : crc ? c.body + 4 : e.body;
  }
  return out;
}
const named = (bytes) => stored(bytes).map((s) => s.name);

test('a WebM insertion moves every stored position with the element it names', () => {
  const { ebmlHead, webmWithDuration, webmWithManifest, webmManifest, webmBlockTimes } = require('../tools/build-page.js');
  // Long enough that every Cluster moves past Segment position 255.
  const manifest = { piece: 'cues', seed: 3, params: { words: 'a'.repeat(240) }, film: { frames: 4, hz: 24, loop: false, scale: 1 } };
  // What each recording names, and after the Tags go in: a SeekHead also lists them.
  const layouts = [
    // Edge's live recording: Cues after every Cluster, past both insertion points.
    [['void', 'info', 'one', 'two', 'cues'], false, ['Cluster 0', 'Cluster 42'], ['Cluster 0', 'Cluster 42']],
    // Edge's recording collected only at stop: a SeekHead before both insertion points.
    [['head', 'void', 'info', 'one', 'two', 'cues'], true, ['1549a966', 'Cluster 0', '1c53bb6b', 'Cluster 0', 'Cluster 42'],
      ['1549a966', 'Cluster 0', '1c53bb6b', '1254c367', 'Cluster 0', 'Cluster 42']],
    // Cues where Info ends, before the first Cluster, and a SeekHead past everything.
    [['info', 'cues', 'one', 'two', 'tail'], true, ['Cluster 0', 'Cluster 42', '1c53bb6b'], ['Cluster 0', 'Cluster 42', '1c53bb6b', '1254c367']],
  ];
  for (const [layout, known, names, tagged] of layouts) {
    for (const dated of [true, false]) {
      const recorded = indexedWebm(layout, { known, dated });
      const withLength = webmWithDuration(recorded, 4 / 24);
      const saved = webmWithManifest(withLength, manifest);
      const where = layout.join(' ') + (dated ? '' : ', Duration inserted');
      assert.deepEqual(named(recorded), names, where + ': the recording names these');
      assert.deepEqual(named(withLength), names, where + ': after the Duration, every position names what it named');
      assert.deepEqual(named(saved), tagged, where + ': and after the Tags');
      assert.ok(stored(saved).every((s) => s.seek === null || s.seek === s.target), where + ': each Seek entry points at the element its SeekID names');
      assert.deepEqual(webmBlockTimes(saved), webmBlockTimes(recorded), where);
      assert.deepEqual(webmManifest(saved), manifest, where);
      const segment = ebmlHead(saved, 8);
      if (known) assert.equal(segment.body + segment.size, saved.length, where + ': a known Segment holds everything added');
    }
  }
  // Every position past the Tags outgrew its one-byte field and was written wider.
  const live = webmWithManifest(indexedWebm(layouts[0][0]), manifest);
  assert.deepEqual(stored(live).map((s) => s.width), [2, 2]);
});

test('a WebM that stores a position the insertion cannot move is refused by name', () => {
  const { webmWithManifest } = require('../tools/build-page.js');
  const film = (parts) => indexedWebm(['void', 'info', 'one', 'two', 'cues'], { parts });
  const refused = {
    'Cluster Position': { one: (at, all) => all.cluster(0, false, [0xA7, 0x81, at.one]) },
    CueCodecState: { cues: (at, all) => all.el(CUES, [...all.cue(0, at.one, [0xEA, 0x81, 0]), ...all.cue(42, at.two)]) },
    CueReference: { cues: (at, all) => all.el(CUES, [...all.cue(0, at.one, [0xDB, 0x83, 0x96, 0x81, 0]), ...all.cue(42, at.two)]) },
    // A CRC-32 that does not open its element, where EBML never puts one.
    'CRC-32': { cues: (at, all) => all.el(CUES, [...all.cue(0, at.one), 0xBF, 0x84, 0, 0, 0, 0, ...all.cue(42, at.two)]) },
  };
  for (const [name, parts] of Object.entries(refused)) {
    assert.throws(() => webmWithManifest(film(parts), {}), new RegExp('carries a ' + name + ', which the insertion would leave stale'));
  }
  // A CuePoint that claims more than its Cues holds.
  const cut = film({ cues: (at, all) => [...CUES, 0x80 | 12, ...all.cue(0, at.one).slice(0, 12)] });
  assert.throws(() => webmWithManifest(cut, {}), /SeekHead or Cues cut short or malformed/);
});

test('a WebM SeekHead lists the Tags the page adds, and a reader that follows it finds the recipe', () => {
  const { ebmlHead, webmWithDuration, webmWithManifest, webmManifest } = require('../tools/build-page.js');
  const manifest = { piece: 'listed', seed: 5, film: { frames: 4, hz: 24, loop: false, scale: 1 } };
  // A SeekHead before the Tags, as Edge writes when it finalizes, and one after them.
  for (const layout of [['head', 'void', 'info', 'one', 'two', 'cues'], ['info', 'cues', 'one', 'two', 'tail']]) {
    for (const dated of [true, false]) {
      const saved = webmWithManifest(webmWithDuration(indexedWebm(layout, { known: true, dated }), 4 / 24), manifest);
      const where = layout.join(' ') + (dated ? '' : ', Duration inserted');
      const entries = stored(saved).filter((s) => s.seek === 0x1254C367);
      assert.equal(entries.length, 1, where + ': one Seek entry names the Tags');
      const tags = ebmlHead(saved, entries[0].at);
      assert.deepEqual(webmManifest(saved.subarray(tags.at, tags.body + tags.size)), manifest, where + ': and the element there holds the recipe');
    }
  }
  // Edge's live recording has no SeekHead, so nothing is listed.
  const live = webmWithManifest(indexedWebm(['void', 'info', 'one', 'two', 'cues']), manifest);
  assert.equal(stored(live).some((s) => s.seek !== null), false);
});

test('a WebM keeps every CRC-32 matching its element when the page writes its length', () => {
  const { webmWithDuration, webmWithManifest } = require('../tools/build-page.js');
  const manifest = { piece: 'summed', seed: 9 };
  for (const [layout, known] of [[['void', 'info', 'one', 'two', 'cues'], false], [['head', 'void', 'info', 'one', 'two', 'cues'], true]]) {
    for (const dated of [true, false]) {
      const recorded = indexedWebm(layout, { known, dated, crc: true });
      const withLength = webmWithDuration(recorded, 4 / 24);
      const where = layout.join(' ') + (dated ? '' : ', Duration inserted');
      assert.deepEqual(checksums(recorded), [true], where + ': the recording\'s Info CRC-32 holds');
      assert.deepEqual(checksums(withLength), [true], where + ': and is computed again over the new Duration');
      assert.deepEqual(checksums(webmWithManifest(withLength, manifest)), [true], where + ': and holds after the Tags');
    }
  }
  // A CRC-32 over the whole Segment would need the whole film read again: both writers refuse it.
  const whole = indexedWebm(['crc', 'void', 'info', 'one', 'two', 'cues'], { parts: { crc: () => [0xBF, 0x84, 0, 0, 0, 0] } });
  assert.throws(() => webmWithDuration(whole, 1), /carries a CRC-32 over its Segment, which writing its length would leave stale/);
  assert.throws(() => webmWithManifest(whole, manifest), /carries a CRC-32, which the insertion would leave stale/);
});

test('a WebM SeekHead or Cues that opens with a CRC-32 keeps it matching through the page\'s edits', () => {
  const { webmWithDuration, webmWithManifest, webmManifest } = require('../tools/build-page.js');
  // Long enough that the positions inside each summed element are written wider.
  const manifest = { piece: 'summed-index', seed: 4, params: { words: 'a'.repeat(240) } };
  const parts = {
    head: (at, all) => all.summed(SEEKHEAD, [...all.seek(INFO, at.info), ...all.seek(CLUSTER, at.one), ...all.seek(CUES, at.cues)]),
    // The first CuePoint carries its own CRC-32 inside the summed Cues.
    cues: (at, all) => all.summed(CUES, [...all.summed([0xBB], all.cue(0, at.one).slice(2)), ...all.cue(42, at.two)]),
  };
  const layouts = [
    [['head', 'void', 'info', 'one', 'two', 'cues'], true, ['1549a966', 'Cluster 0', '1c53bb6b', '1254c367', 'Cluster 0', 'Cluster 42']],
    [['void', 'info', 'one', 'two', 'cues'], false, ['Cluster 0', 'Cluster 42']],
  ];
  for (const [layout, known, tagged] of layouts) {
    for (const dated of [true, false]) {
      const recorded = indexedWebm(layout, { known, dated, crc: true, parts });
      const saved = webmWithManifest(webmWithDuration(recorded, 4 / 24), manifest);
      const where = layout.join(' ') + (dated ? '' : ', Duration inserted');
      // SeekHead when there is one, Info, Cues and its first CuePoint.
      const sums = Array(layout.includes('head') ? 4 : 3).fill(true);
      assert.deepEqual(checksums(recorded), sums, where + ': every CRC-32 in the recording holds');
      assert.deepEqual(checksums(saved), sums, where + ': and each is computed again over its rebuilt element');
      assert.deepEqual(named(saved), tagged, where + ': every position names what it named, and the Tags are listed');
      assert.deepEqual(webmManifest(saved), manifest, where);
    }
  }
});

test('the MP4 note names the soundtrack codec and the colour route, and warns about Opus', async () => {
  const { filmNote } = require('../tools/build-page.js');
  const base = { frames: 48, width: 64, height: 48, seconds: 2, bytes: 10240, drawMs: 12, totalMs: 40, realtime: 50, convertMs: 7 };
  const aac = filmNote({ ...base, sound: { codec: 'mp4a' }, conversion: 'gpu' });
  assert.match(aac, /10 kB, with an AAC soundtrack\. Colour converted on the GPU in 7 ms\. Drawn in 12 ms/);
  // The encoder converts inside itself; its time is the frame copies and test patterns.
  const encoder = filmNote({ ...base, sound: { codec: 'mp4a' }, conversion: 'encoder' });
  assert.match(encoder, /with an AAC soundtrack\. Colour converted by the encoder, its range proved by test patterns; 7 ms copying frames and testing\. Drawn in 12 ms/);
  assert.doesNotMatch(encoder, /ENCODER/);
  assert.doesNotMatch(aac, /Opus/);
  const opus = filmNote({ ...base, sound: { codec: 'Opus' }, conversion: 'cpu' });
  assert.match(opus, /with an Opus soundtrack\. Colour converted on the CPU in 7 ms\./);
  assert.match(opus, /the soundtrack is Opus: play the film where Opus in MP4 is supported, or it plays silent\.$/);
  assert.doesNotMatch(filmNote({ ...base, sound: null, conversion: 'cpu' }), /soundtrack|Opus/);
  // The page shows the note of the film it exported; with no WebGL2 here, the CPU converts.
  for (const [encodesAac, codec] of [[true, 'AAC'], [false, 'Opus']]) {
    const { api, elements } = openPage({ codecs: fakeCodecs({ aac: encodesAac }) });
    api.select('voiced');
    elements.get('film1').onclick();
    for (let i = 0; i < 50 && !/Colour converted/.test(elements.get('filmnote').textContent); i++) await settle();
    const note = elements.get('filmnote').textContent;
    assert.match(note, new RegExp('with an ' + codec + ' soundtrack\\. Colour converted on the CPU in \\d+ ms\\.'));
    assert.equal(/Opus in MP4 is supported/.test(note), codec === 'Opus');
  }
});

test('an unanswered H.264 question blocks nothing, and a late answer stays with its piece', async () => {
  let answer;
  const gate = new Promise((resolve) => { answer = resolve; });
  const codecs = fakeCodecs({ supported: () => false });
  const ask = codecs.VideoEncoder.isConfigSupported;
  codecs.VideoEncoder.isConfigSupported = async (config) => { await gate; return ask(config); };
  const { api, elements, activity } = openPage({ codecs });
  api.setSeed(42);
  assert.equal(api.read().error, null);
  assert.ok(activity.draws > 0, 'the build and the drawing do not wait for the encoder');
  assert.equal(elements.get('film1').disabled, false);
  assert.equal(elements.get('mp4').hidden, false, 'MP4 shows until the encoder answers');
  assert.equal(elements.get('webm').hidden, true);
  api.select('valid');
  answer();
  assert.equal(await api.filmFormat(), null);
  await new Promise(setImmediate);
  assert.equal(elements.get('webm').hidden, true, 'the refusal for the timeline piece stays with it');
  assert.equal(elements.get('mp4').hidden, false);
});

test('the page exposes the film loudness meter and gain that replay reads, as core/film.js gives them', () => {
  // Replay measures a decoded film with these in Edge; only this test reads them in Node.
  const { api } = openPage();
  assert.equal(typeof api.loudness, 'function', 'the page exposes loudness');
  assert.equal(typeof api.loudnessGain, 'function', 'the page exposes loudnessGain');
  const rate = 48000;
  const buffer = (...channels) => ({ numberOfChannels: channels.length, sampleRate: rate, length: channels[0].length, getChannelData: (c) => channels[c] });
  const tone = (amp, hz) => Float32Array.from({ length: rate }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));
  const silence = new Float32Array(rate);
  for (const [name, b] of [['silence', buffer(silence, silence)], ['a quiet tone', buffer(tone(0.05, 440), tone(0.05, 440))],
    ['a loud tone', buffer(tone(0.9, 1000), tone(0.9, 1000))], ['one channel', buffer(tone(0.3, 220))]]) {
    const measured = measureLoudness(b);
    // Spread into this realm: the page's objects come from the sandbox's Object.
    assert.deepEqual({ ...api.loudness(b) }, measured, name + ': the page measures as core/film.js does');
    for (const codec of ['mp4a', 'Opus']) assert.equal(api.loudnessGain(measured, codec), loudnessGain(measured, codec), name + ': and sets the same gain for ' + codec);
  }
  assert.equal(api.loudnessGain(measureLoudness(buffer(silence)), 'mp4a'), 0, 'silence keeps its level');
  for (const measured of [{ lufs: -20, dbtp: -10 }, { lufs: -8, dbtp: -3 }, { lufs: -30, dbtp: 0 }]) {
    for (const codec of ['mp4a', 'Opus']) assert.equal(api.loudnessGain(measured, codec), loudnessGain(measured, codec), JSON.stringify(measured) + ' ' + codec);
  }
});
