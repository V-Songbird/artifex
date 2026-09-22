'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { html, bundle } = require('../tools/build-page.js');
const { nullSurface } = require('../tools/bench.js');

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
    throwing: {
      name: 'throwing', size: { w: 40, h: 30 },
      state() { throw new Error('fixture state failed'); },
      draw(surface) { surface.fillRect(0, 0, 20, 20); },
    },
  };
}

function openPage({ deferPng = false, videoFailure = null } = {}) {
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
