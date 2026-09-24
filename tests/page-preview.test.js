'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fakePage } = require('./fake-media.js');

function registry(module) {
  module.exports = {
    pixels: { name: 'pixels', size: { w: 80, h: 40 }, seed: 1, time: { duration: 2, hz: 10 },
      params: { amount: { min: 0, max: 1, value: 0.5, meaning: 'changes the amount of ink' } },
      preview: { kind: 'webgpu-pixels', wgsl: 'shader fixture', uniforms: () => [] },
      draw(g, s, t) { g.fillRect(s.seed, t, s.params.amount, 1); } },
    still: { name: 'still', size: { w: 80, h: 40 }, draw(g) { g.fillRect(0, 0, 10, 10); } },
  };
}

function previewModule(module) {
  module.exports = { createPreview(options) {
    const session = {
      disposed: false, onLoss: options.onLoss,
      dispose() { this.disposed = true; },
      draw(p, s, t, w, h, hooks) {
        return new Promise((resolve, reject) => {
          window.requests.push({ seed: s.seed, t, w, h, session, reject,
            finish() {
              if (!hooks.isCurrent()) { resolve({ stale: true }); return; }
              hooks.present({ seed: s.seed, t });
              resolve({ stale: false, t: window.__artifex.piece.frameT(p, t), totalMs: 2 });
            },
          });
        });
      },
    };
    window.sessions.push(session);
    return session;
  } };
}

function page() {
  const activity = { cpu: [], gpu: [], saved: [] };
  // Every element is the shared stand-in canvas; a CPU frame is recorded by its
  // rectangle fills and a GPU frame by the image drawn onto it.
  const p = fakePage({
    modules: { 'examples/index.js': registry, 'core/webgpu-preview.js': previewModule },
    width: 80, height: 40, window: { requests: [], sessions: [] }, downloads: activity.saved,
    onContext(g) {
      const { fillRect } = g;
      g.fillRect = function (...args) { activity.cpu.push(args); return fillRect.apply(this, args); };
      g.drawImage = (image) => activity.gpu.push(image);
    },
  });
  return { api: p.api, requests: p.window.requests, sessions: p.window.sessions, elements: p.elements, frames: p.frames, activity, png: p.png };
}

const tick = () => new Promise(setImmediate);

test('page keeps CPU default, preview opt-in, and PNG on the reference renderer', async () => {
  const p = page();
  assert.equal(p.api.read().preview.mode, 'cpu');
  assert.equal(p.requests.length, 0);
  const pending = p.api.setPreview('gpu');
  p.requests[0].finish(); await pending;
  assert.equal(p.api.read().preview.status, 'active');
  assert.equal(p.activity.gpu.length, 1);
  const count = p.activity.cpu.length;
  p.png.onclick();
  assert.equal(p.activity.cpu.length, count + 1, 'PNG redraws with the CPU');
  await tick();
  assert.equal(p.activity.saved[0], 'pixels-1@1x.png');
  assert.equal('preview' in p.api.manifest(), false, 'reference recipes do not claim GPU identity');
  p.api.select('still');
  assert.equal(p.elements.get('previewGroup').hidden, true);
  assert.equal(p.api.read().preview.mode, 'cpu');
  assert.throws(() => p.api.setPreview('gpu'), /no GPU preview/);
});

test('page coalesces rapid seed and playhead changes and presents only the latest recipe', async () => {
  const p = page(), pending = p.api.setPreview('gpu');
  p.api.setSeed(2); p.api.setT(0.5); p.api.setSeed(3);
  assert.equal(p.requests.length, 1, 'only one frame is in flight');
  p.requests[0].finish(); await tick();
  assert.equal(p.activity.gpu.length, 0, 'old recipe is never presented');
  assert.equal(p.requests.length, 2, 'intermediate requests are replaced');
  assert.equal(p.requests[1].seed, 3);
  assert.equal(p.requests[1].t, 0.5);
  p.requests[1].finish(); await pending;
  assert.equal(p.activity.gpu.length, 1);
  assert.equal(p.api.read().preview.presented.seed, 3);
  assert.equal(p.api.read().preview.presented.t, p.api.manifest().t);
});

test('page ignores stale frame completions and device loss from an old piece', async () => {
  const p = page(), pending = p.api.setPreview('gpu');
  const old = p.sessions[0];
  p.api.select('still');
  old.onLoss('old device lost');
  p.requests[0].finish(); await pending;
  assert.equal(old.disposed, true);
  assert.equal(p.activity.gpu.length, 0);
  assert.equal(p.api.read().name, 'still');
  assert.equal(p.api.read().preview.status, 'reference');
  assert.equal(p.api.read().error, null);
});

test('page GPU failure restores the current CPU frame and allows an explicit retry', async () => {
  const p = page(), pending = p.api.setPreview('gpu');
  p.api.setSeed(9);
  p.requests[0].reject(new Error('adapter failed')); await pending;
  assert.equal(p.api.read().preview.status, 'fallback');
  assert.equal(p.api.read().preview.presented.seed, 9);
  assert.match(p.elements.get('previewStatus').textContent, /Choose GPU preview to retry/);
  assert.equal(p.elements.get('previewMode').value, 'cpu');
  const retry = p.api.setPreview('gpu');
  p.requests[1].finish(); await retry;
  assert.equal(p.api.read().preview.status, 'active');
  assert.equal(p.sessions.length, 2);
  p.sessions[1].onLoss('device removed');
  assert.equal(p.api.read().preview.status, 'fallback');
  assert.equal(p.api.read().preview.presented.seed, 9);
});

test('page playback waits for GPU completion and pause prevents an obsolete transport restart', async () => {
  const p = page(), ready = p.api.setPreview('gpu');
  p.requests[0].finish(); await ready;
  p.elements.get('play').onclick();
  assert.equal(p.requests.length, 2);
  assert.equal(p.frames.size, 0, 'GPU frame is allowed to finish without new animation requests');
  p.requests[1].finish(); await tick();
  assert.equal(p.frames.size, 1);
  const next = [...p.frames.values()][0]; p.frames.clear(); next(200);
  assert.equal(p.requests.length, 3);
  p.elements.get('play').onclick();
  p.requests[2].finish(); await tick();
  assert.equal(p.frames.size, 0, 'paused transport stays paused after late completion');
});
