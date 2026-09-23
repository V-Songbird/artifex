'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { html, bundle } = require('../tools/build-page.js');
const { nullSurface } = require('../tools/bench.js');
const { fakeAudio, fakeCodecs } = require('./fake-media.js');

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
    throwing: {
      name: 'throwing', size: { w: 40, h: 30 },
      state() { throw new Error('fixture state failed'); },
      draw(surface) { surface.fillRect(0, 0, 20, 20); },
    },
  };
}

function openPage({ deferPng = false, videoFailure = null, codecs = null, media = null } = {}) {
  const elements = new Map(), downloads = [], frames = new Map();
  const pngCallbacks = [];
  const activity = { clears: 0, draws: 0 };
  function element() {
    return {
      children: [], dataset: {}, textContent: '', value: '', width: 300, height: 150, disabled: false,
      set innerHTML(value) { this.children = []; this.markup = value; },
      get innerHTML() { return this.markup || ''; },
      classList: { add() {}, remove() {}, toggle() {} },
      appendChild(child) { this.children.push(child); },
      getContext() {
        const surface = nullSurface({ w: this.width, h: this.height });
        surface.clearRect = () => { activity.clears++; };
        // The film's colour conversion reads each drawn frame back.
        surface.getImageData = (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
        return surface;
      },
      toBlob(callback) {
        const finish = () => callback(new Blob(['png']));
        if (deferPng) pngCallbacks.push(finish); else finish();
      },
      click() { downloads.push(this.download); },
    };
  }
  const png = element(); png.dataset.png = '1';
  const sandbox = {
    window: {}, Blob,
    document: {
      getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
      createElement: element, querySelectorAll: () => [png],
    },
    history: { replaceState() {} }, location: { search: '' },
    performance: { now: () => 1 },
    requestAnimationFrame(callback) { frames.set(1, callback); return 1; },
    cancelAnimationFrame(id) { frames.delete(id); },
    URL: { createObjectURL: () => 'blob:fixture', revokeObjectURL() {} },
    setTimeout(callback) { callback(); },
  };
  const overrides = "\n__def('examples/index.js', " + registry.toString() + ');';
  if (videoFailure) sandbox.MediaStreamTrackGenerator = function () { throw new Error(videoFailure); };
  if (codecs) {
    Object.assign(sandbox, {
      VideoEncoder: codecs.VideoEncoder, VideoFrame: codecs.VideoFrame,
      AudioEncoder: codecs.AudioEncoder, AudioData: codecs.AudioData, OfflineAudioContext: fakeAudio().Context,
    });
  }
  if (media) Object.assign(sandbox, media);
  const script = html(bundle() + overrides).match(/<script>([\s\S]*)<\/script>/)[1];
  vm.runInNewContext(script, sandbox);
  const api = sandbox.window.__artifex;
  const draw = api.render.drawFrame;
  api.render.drawFrame = (...args) => { activity.draws++; return draw(...args); };
  return { api, elements, png, downloads, frames, activity, pngCallbacks };
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

test('a valid rebuild or another piece recovers rendering, controls and export after failure', () => {
  const { api, elements, png, downloads, activity } = openPage();
  api.setSeed(42);
  assert.equal(api.read().error, null);
  assert.equal(api.manifest().seed, 42);
  assert.equal(elements.get('play').disabled, false);
  assert.equal(png.disabled, false);
  api.setT(0.5);
  png.onclick(); elements.get('svg').onclick();
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

test('a pending valid PNG retains its original recipe when a later rebuild fails', () => {
  const { api, png, downloads, pngCallbacks } = openPage({ deferPng: true });
  api.setSeed(42);
  png.onclick();
  assert.equal(pngCallbacks.length, 1);
  assert.deepEqual(downloads, []);
  api.setSeed(7);
  const original = api.read().error;
  assert.match(original, /fixture build failed/);
  assert.doesNotThrow(() => pngCallbacks[0]());
  assert.deepEqual(downloads, ['conditional-42@1x.png']);
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

test('where H.264 cannot encode the film, the page offers the WebM recorder instead', async () => {
  const cases = [[null, /no VideoEncoder/], [fakeCodecs({ supported: () => false }), /no H\.264 encoder here accepts 40 x 30 at 4 Hz/]];
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

// The browser's recorder, played by stand-ins: every frame written becomes one
// SimpleBlock at its place on the frame grid, in the live shape Edge writes -- a
// Segment and a Cluster of unknown size, and a Duration of one unit.
function recorderStandIns(hz) {
  const inits = [];
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
    VideoFrame: function (source, init) { inits.push(init); this.close = () => {}; },
  };
  return { media, inits };
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
