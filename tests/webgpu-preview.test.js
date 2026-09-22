'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validate, solve, frameT, clockAt } = require('../core/piece.js');
const { UNIFORM_BYTES, uniformData, createPreview, dimensions } = require('../core/webgpu-preview.js');

function fixture(overrides = {}) {
  return validate({ name: 'pixels', size: { w: 80, h: 40 }, draw() {},
    time: { duration: 2, hz: 10 },
    preview: { kind: 'webgpu-pixels', wgsl: 'fn artifexPixel(p: vec2f) -> vec3f { return vec3f(p, 0); }', uniforms: () => [0.25] },
    ...overrides });
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function hardware(options = {}) {
  const events = [], loss = deferred(), handlers = {};
  const limits = { maxTextureDimension2D: 8192, maxBufferSize: 268435456, maxUniformBufferBindingSize: 65536 };
  const canvas = { width: 1, height: 1, getContext: () => context };
  const context = {
    configure() { events.push('configure'); }, unconfigure() { events.push('unconfigure'); },
    getCurrentTexture: () => ({ createView: () => ({}) }),
  };
  const pipeline = { getBindGroupLayout: () => ({}) };
  const device = {
    limits: { ...limits, ...options.deviceLimits }, lost: loss.promise,
    addEventListener(name, handler) { handlers[name] = handler; },
    destroy() { events.push('destroy device'); },
    pushErrorScope() {}, popErrorScope: async () => options.scopeError || null,
    createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: options.messages || [] }) }),
    createRenderPipelineAsync: (descriptor) => {
      events.push(['pipeline', descriptor]);
      return options.pipeline || Promise.resolve(pipeline);
    },
    createBindGroupLayout: (descriptor) => { events.push(['bindings', descriptor]); return {}; },
    createPipelineLayout: () => ({}),
    createBuffer: () => ({ destroy() { events.push('destroy buffer'); } }),
    createBindGroup: () => ({}),
    createCommandEncoder: () => ({
      beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw(count) { events.push('draw ' + count); }, end() {} }),
      finish: () => ({}),
    }),
    queue: {
      writeBuffer(buffer, offset, data) { events.push(['upload', new Uint32Array(data).slice()]); },
      submit() { events.push('submit'); },
      onSubmittedWorkDone: () => options.completion || Promise.resolve(),
    },
  };
  const adapter = { limits, info: { isFallbackAdapter: !!options.software }, isFallbackAdapter: !!options.legacySoftware,
    requestDevice: () => { events.push('request device'); return options.devicePromise || Promise.resolve(device); } };
  const gpu = { requestAdapter: () => options.adapterPromise || Promise.resolve(options.missing ? null : adapter),
    getPreferredCanvasFormat: () => 'bgra8unorm' };
  const session = createPreview({ gpu, createCanvas: () => canvas, timeoutMs: options.timeoutMs || 100,
    onLoss: options.onLoss || (() => {}) });
  return { session, device, canvas, events, loss, handlers };
}

test('GPU uniforms preserve resolved seeds and the shared quantized frame clock', () => {
  const p = fixture();
  for (const seed of [0, 1, 0xffffffff, -1, -1.9, 1.9, 4294967298]) {
    const solved = solve(p, seed);
    const { data, t, clock } = uniformData(p, solved, 0.47, 1920, 1080);
    assert.equal(data.byteLength, UNIFORM_BYTES);
    assert.deepEqual([...new Uint32Array(data).slice(0, 4)], [1920, 1080, solved.seed, clockAt(p, 0.47).frame]);
    assert.equal(t, frameT(p, 0.47));
    assert.equal(clock.seconds, clockAt(p, t).seconds);
    assert.deepEqual([...new Float32Array(data).slice(4, 10)], [Math.fround(t), Math.fround(clock.seconds), 80, 40, 0.25, 0]);
  }
});

test('GPU uniforms reject non-float32 inputs before submission and cap dimensions', () => {
  for (const value of [NaN, Infinity, 1e40, '1', undefined]) {
    const p = fixture({ preview: { ...fixture().preview, uniforms: () => [value] } });
    assert.throws(() => uniformData(p, solve(p), 0, 80, 40), /finite float32/);
  }
  for (const values of [new Float64Array(1), new Array(17).fill(1), Promise.resolve([]), null]) {
    const p = fixture({ preview: { ...fixture().preview, uniforms: () => values } });
    assert.throws(() => uniformData(p, solve(p), 0, 80, 40), /at most 16/);
  }
  for (const [w, h] of [[4097, 1], [4096, 4096], [1.5, 10], [0, 1]]) assert.throws(() => dimensions(w, h), /dimensions/);
  dimensions(3840, 2160);
  const p = fixture({ size: { w: 1e40, h: 1 } });
  assert.throws(() => uniformData(p, solve(p), 0, 10, 10), /design width/);
});

test('GPU preview completes submission before presentation and disposes owned resources', async () => {
  const h = hardware(), p = fixture();
  const result = await h.session.draw(p, solve(p), 0.47, 80, 40, { present: () => h.events.push('present') });
  assert.equal(result.stale, false);
  assert.equal(result.cold, true);
  assert.equal(result.allocationProxyBytes, 80 * 40 * 4 + UNIFORM_BYTES);
  assert.ok(h.events.indexOf('present') > h.events.indexOf('submit'));
  assert.equal(typeof h.events.find((e) => e[0] === 'pipeline')[1].layout, 'object', 'uniform-free shaders keep an explicit layout');
  assert.equal(h.events.find((e) => e[0] === 'bindings')[1].entries[0].buffer.minBindingSize, UNIFORM_BYTES);
  assert.equal((await h.session.draw(p, solve(p), 1, 80, 40)).cold, false);
  h.session.dispose(); h.session.dispose();
  assert.equal(h.events.filter((e) => e === 'destroy device').length, 1);
  assert.equal(h.events.filter((e) => e === 'destroy buffer').length, 1);
  assert.equal(h.canvas.width, 1);
});

test('GPU preview rejects unavailable adapters, device limits and shader failures', async () => {
  const p = fixture();
  const unavailable = createPreview({ gpu: null });
  await assert.rejects(unavailable.draw(p, solve(p), 0, 80, 40), /unavailable/);
  for (const [options, error] of [
    [{ missing: true }, /No usable/],
    [{ software: true }, /software fallback/],
    [{ legacySoftware: true }, /software fallback/],
    [{ deviceLimits: { maxTextureDimension2D: 32 } }, /device limits/],
    [{ deviceLimits: { maxUniformBufferBindingSize: 64 } }, /device limits/],
    [{ messages: [{ type: 'error', message: 'bad shader' }] }, /bad shader/],
    [{ scopeError: { message: 'allocation failed' } }, /allocation failed/],
  ]) {
    const h = hardware(options);
    await assert.rejects(h.session.draw(p, solve(p), 0, 80, 40), error);
    assert.equal(h.events.includes('submit'), false);
    assert.equal(h.session.disposed, true);
    if (options.software || options.legacySoftware) assert.equal(h.events.includes('request device'), false);
  }
});

test('GPU preview discards stale initialization and stale queued frames', async () => {
  const p = fixture(), compile = deferred();
  const h = hardware({ pipeline: compile.promise });
  let current = true, presented = 0;
  const pending = h.session.draw(p, solve(p), 0, 80, 40, { isCurrent: () => current, present: () => presented++ });
  current = false;
  compile.resolve({ getBindGroupLayout: () => ({}) });
  assert.equal((await pending).stale, true);
  assert.equal(h.events.includes('submit'), false);
  h.session.dispose();
  const complete = deferred(), next = hardware({ completion: complete.promise });
  current = true;
  const frame = next.session.draw(p, solve(p), 0, 80, 40, { isCurrent: () => current, present: () => presented++ });
  await new Promise(setImmediate);
  current = false; complete.resolve();
  assert.equal((await frame).stale, true);
  assert.equal(presented, 0);
  next.session.dispose();
});

test('GPU preview is single-flight and reports real loss only for a live session', async () => {
  const complete = deferred(), messages = [], p = fixture();
  const h = hardware({ completion: complete.promise, onLoss: (message) => messages.push(message) });
  const pending = h.session.draw(p, solve(p), 0, 80, 40);
  const rejected = assert.rejects(pending, /disposed|fixture loss/);
  await assert.rejects(h.session.draw(p, solve(p), 1, 80, 40), /in flight/);
  h.loss.resolve({ reason: 'destroyed', message: 'fixture loss' });
  await new Promise(setImmediate);
  complete.resolve();
  await rejected;
  assert.equal(messages.length, 1);
  assert.match(messages[0], /fixture loss/);
  const old = hardware({ onLoss: (message) => messages.push(message) });
  await old.session.draw(p, solve(p), 0, 80, 40);
  old.session.dispose(); old.loss.resolve({ message: 'late loss' });
  await new Promise(setImmediate);
  assert.equal(messages.length, 1);
});

test('GPU preview times out and destroys a device delivered after the deadline', async () => {
  const late = deferred(), p = fixture();
  const h = hardware({ devicePromise: late.promise, timeoutMs: 5 });
  await assert.rejects(h.session.draw(p, solve(p), 0, 80, 40), /timed out/);
  late.resolve(h.device);
  await new Promise(setImmediate);
  assert.equal(h.events.filter((e) => e === 'destroy device').length, 1);
  assert.equal(h.events.includes('submit'), false);
});

test('disposing GPU initialization cancels promptly and releases a late device', async () => {
  const late = deferred(), p = fixture(), h = hardware({ devicePromise: late.promise, timeoutMs: 10000 });
  const pending = h.session.draw(p, solve(p), 0, 80, 40);
  const rejected = assert.rejects(pending, /disposed/);
  await new Promise(setImmediate);
  h.session.dispose();
  await rejected;
  late.resolve(h.device);
  await new Promise(setImmediate);
  assert.equal(h.events.filter((e) => e === 'destroy device').length, 1);
});
