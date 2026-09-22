'use strict';

// Optional, approximate pixel previews. Reference drawing and exports never
// call this module. One session owns one device, pipeline and bounded canvas.
const { frameT, clockAt } = require('./piece.js');

const UNIFORM_BYTES = 96;
const MAX_SIDE = 4096;
const MAX_PIXELS = 3840 * 2160;

// Public shader ABI. Pixel positions are raster pixel centers. Colors returned
// by artifexPixel are encoded sRGB; the preview is always opaque.
const HEADER = `
struct ArtifexInputs {
  size: vec2u,
  seed: u32,
  frame: u32,
  time: vec4f,
  values: array<vec4f, 4>,
}
@group(0) @binding(0) var<uniform> artifex: ArtifexInputs;
`;

function shaderSource(wgsl) {
  return HEADER + wgsl + `
@vertex fn artifexVertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let positions = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  return vec4f(positions[index], 0, 1);
}
@fragment fn artifexFragment(@builtin(position) position: vec4f) -> @location(0) vec4f {
  return vec4f(clamp(artifexPixel(position.xy), vec3f(0), vec3f(1)), 1);
}
`;
}

function dimensions(width, height, limits) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) {
    throw new Error('GPU preview requires integer dimensions up to 4096 per side and 8294400 pixels');
  }
  if (limits && (width > limits.maxTextureDimension2D || height > limits.maxTextureDimension2D
    || limits.maxBufferSize < UNIFORM_BYTES || limits.maxUniformBufferBindingSize < UNIFORM_BYTES)) {
    throw new Error('GPU device limits cannot support this preview');
  }
}

function finiteFloat(value, name) {
  if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value))) {
    throw new Error('GPU preview ' + name + ' must be a finite float32 value');
  }
  return value;
}

function uniformData(piece, solved, t, width, height) {
  dimensions(width, height);
  const qt = frameT(piece, t), clock = clockAt(piece, t);
  if (!Number.isInteger(clock.frame) || clock.frame < 0 || clock.frame > 0xffffffff) {
    throw new Error('GPU preview frame must fit an unsigned 32-bit integer');
  }
  const values = piece.preview.uniforms(solved.state, qt, clock);
  if (!(Array.isArray(values) || values instanceof Float32Array) || values.length > 16) {
    throw new Error('GPU preview uniforms must return an array or Float32Array of at most 16 numbers');
  }
  const data = new ArrayBuffer(UNIFORM_BYTES);
  const uints = new Uint32Array(data), floats = new Float32Array(data);
  uints.set([width, height, solved.seed, clock.frame]);
  // solve() already normalizes explicit seed overrides with >>> 0. Reuse that
  // exact resolved seed: the GPU never applies a second author-facing mapping.
  floats.set([finiteFloat(qt, 'playhead'), finiteFloat(clock.seconds, 'seconds'),
    finiteFloat(piece.size.w, 'design width'), finiteFloat(piece.size.h, 'design height')], 4);
  for (let i = 0; i < values.length; i++) floats[8 + i] = finiteFloat(values[i], 'uniform ' + i);
  return { data, t: qt, clock };
}

/**
 * A session permits one render at a time. The caller coalesces interaction
 * requests and supplies isCurrent(), checked before submission and presentation.
 * Injection points are also useful to hosts with their own canvas lifecycle.
 */
function createPreview({ gpu, createCanvas, now = () => performance.now(), onLoss = () => {},
  timeoutMs = 10000 } = {}) {
  let device = null, canvas = null, context = null, buffer = null, pipeline = null, binding = null;
  let disposed = false, busy = false, initialized = false, descriptor = null, failure = null;
  let generation = 0, initializationMs = 0;
  const cancellations = new Set();

  function dispose() {
    if (disposed) return;
    disposed = true;
    generation++;
    for (const cancel of cancellations) cancel();
    cancellations.clear();
    if (context) context.unconfigure();
    if (buffer) buffer.destroy();
    if (device) device.destroy();
    if (canvas) { canvas.width = 1; canvas.height = 1; }
    pipeline = null; binding = null; buffer = null; context = null; canvas = null;
  }

  function lost(message) {
    if (disposed) return;
    failure = message;
    dispose();
    onLoss(message);
  }

  async function bounded(promise, label, late = () => {}) {
    let timer, cancel, expired = false;
    const guarded = Promise.resolve(promise).then((value) => {
      if (expired || disposed) { late(value); throw new Error('GPU preview session was disposed'); }
      return value;
    });
    try {
      return await Promise.race([guarded, new Promise((resolve, reject) => {
        cancel = () => reject(new Error(failure || 'GPU preview session was disposed'));
        cancellations.add(cancel);
        if (disposed) { cancel(); return; }
        timer = setTimeout(() => { expired = true; reject(new Error('GPU preview ' + label + ' timed out')); }, timeoutMs);
      })]);
    } finally { clearTimeout(timer); cancellations.delete(cancel); }
  }

  async function initialize(piece, width, height) {
    if (!gpu) throw new Error('WebGPU is unavailable in this browser or context');
    const start = now();
    const adapter = await bounded(gpu.requestAdapter(), 'adapter request');
    if (!adapter) throw new Error('No usable WebGPU adapter was found');
    if ((adapter.info && adapter.info.isFallbackAdapter) || adapter.isFallbackAdapter) {
      throw new Error('The WebGPU adapter is a software fallback');
    }
    dimensions(width, height, adapter.limits);
    device = await bounded(adapter.requestDevice(), 'device request', (lateDevice) => lateDevice.destroy());
    device.lost.then((info) => lost('GPU device lost: ' + (info.message || info.reason || 'unknown reason')));
    device.addEventListener('uncapturederror', (event) => {
      if (event.preventDefault) event.preventDefault();
      lost('GPU error: ' + event.error.message);
    });
    dimensions(width, height, device.limits);
    canvas = createCanvas();
    context = canvas.getContext('webgpu');
    if (!context) throw new Error('A WebGPU canvas context could not be created');
    const format = gpu.getPreferredCanvasFormat();
    device.pushErrorScope('validation');
    device.pushErrorScope('out-of-memory');
    try {
      const module = device.createShaderModule({ code: shaderSource(piece.preview.wgsl) });
      const info = await bounded(module.getCompilationInfo(), 'shader compilation');
      const errors = info.messages.filter((message) => message.type === 'error');
      if (errors.length) throw new Error('GPU shader: ' + errors.map((message) => message.message).join('; '));
      const bindLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: 2,
        buffer: { type: 'uniform', minBindingSize: UNIFORM_BYTES } }] });
      const layout = device.createPipelineLayout({ bindGroupLayouts: [bindLayout] });
      pipeline = await bounded(device.createRenderPipelineAsync({
        layout, vertex: { module, entryPoint: 'artifexVertex' },
        fragment: { module, entryPoint: 'artifexFragment', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      }), 'pipeline creation');
      buffer = device.createBuffer({ size: UNIFORM_BYTES, usage: 0x40 | 0x08 });
      binding = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer } }] });
      context.configure({ device, format, alphaMode: 'opaque', colorSpace: 'srgb' });
    } finally {
      const memoryError = await bounded(device.popErrorScope(), 'allocation validation');
      const validationError = await bounded(device.popErrorScope(), 'pipeline validation');
      if (memoryError || validationError) throw new Error('GPU initialization: ' + (memoryError || validationError).message);
    }
    initialized = true;
    descriptor = piece.preview;
    initializationMs = now() - start;
  }

  async function draw(piece, solved, t, width, height, { isCurrent = () => true, present } = {}) {
    if (disposed) throw new Error(failure || 'GPU preview session was disposed');
    if (busy) throw new Error('GPU preview already has a frame in flight');
    if (!piece.preview) throw new Error('This piece has no GPU preview');
    if (initialized && descriptor !== piece.preview) throw new Error('GPU preview session belongs to another piece');
    dimensions(width, height);
    busy = true;
    const ticket = generation, start = now(), wasCold = !initialized;
    try {
      // Capture the authored uniforms before the first asynchronous boundary.
      const inputs = uniformData(piece, solved, t, width, height);
      if (!initialized) await initialize(piece, width, height);
      if (disposed || ticket !== generation || !isCurrent()) return { stale: true };
      dimensions(width, height, device.limits);
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      device.pushErrorScope('validation');
      device.pushErrorScope('out-of-memory');
      let submitted, finished;
      try {
        device.queue.writeBuffer(buffer, 0, inputs.data);
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({ colorAttachments: [{
          view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        }] });
        pass.setPipeline(pipeline); pass.setBindGroup(0, binding); pass.draw(3); pass.end();
        device.queue.submit([encoder.finish()]);
        submitted = now();
        await bounded(device.queue.onSubmittedWorkDone(), 'frame completion');
        finished = now();
      } finally {
        const memoryError = await bounded(device.popErrorScope(), 'frame allocation validation');
        const validationError = await bounded(device.popErrorScope(), 'frame validation');
        if (memoryError || validationError) throw new Error('GPU frame: ' + (memoryError || validationError).message);
      }
      if (disposed || ticket !== generation || !isCurrent()) return { stale: true };
      const validated = now();
      if (present) present(canvas);
      const presented = now();
      return { stale: false, t: inputs.t, cold: wasCold, initializationMs: wasCold ? initializationMs : 0,
        totalMs: presented - start, submitMs: submitted - start - (wasCold ? initializationMs : 0),
        queueMs: finished - submitted, validationMs: validated - finished, presentMs: presented - validated,
        allocationProxyBytes: width * height * 4 + UNIFORM_BYTES };
    } catch (error) {
      dispose();
      throw error;
    } finally { busy = false; }
  }

  return { draw, dispose, get disposed() { return disposed; } };
}

module.exports = { HEADER, UNIFORM_BYTES, MAX_SIDE, MAX_PIXELS, shaderSource, dimensions, uniformData, createPreview };
