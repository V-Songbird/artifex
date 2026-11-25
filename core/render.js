// Rendering: one piece, several outputs.
//
// The design box never changes. Aspect ratio, device scale and output medium are
// render-time choices -- which is the whole reason one piece can serve a page, a
// video, a print and a plotter without being written four times.
//
// `draw(surface, state, t)` receives a surface, not a canvas context, so the
// SAME drawing code reaches a screen, an offscreen buffer at print scale, a
// deterministic frame sequence and an SVG document. Every surface here is
// Canvas2D-shaped, because the platform already has a drawing vocabulary and
// inventing a second one would buy nothing.

'use strict';

const { validate, frameT, frameCount, frameDen, clockAt, solve } = require('./piece.js');
const { VectorSurface } = require('./surface-vector.js');
const { weave, develop } = require('./finish.js');
const { toLinear } = require('./colour.js');
const { sibling } = require('./layer.js');

// An 8-bit sRGB level in linear light, and the first level to try for a linear
// value, so an average encodes to its nearest level without a power per pixel.
const LINEAR = Float32Array.from({ length: 256 }, (_, i) => toLinear(i / 255));
const STEPS = 4096;
const LEVEL = new Uint8Array(STEPS);
for (let i = 0, b = 0; i < STEPS; i++) {
  while (b < 255 && LINEAR[b + 1] <= i / (STEPS - 1)) b++;
  LEVEL[i] = b;
}
const encoded = (v) => {
  let b = LEVEL[Math.min(STEPS - 1, Math.floor(v * (STEPS - 1)))];
  while (b < 255 && v > (LINEAR[b] + LINEAR[b + 1]) / 2) b++;
  return b;
};

// One scratch canvas and sum per solve and size, as the finish keeps its tile.
const EXPOSURES = new WeakMap();

/**
 * Draw `n` instants across the first half of the frame interval, a 180 degree
 * shutter, and lay their average in linear light on `g`. Only the time moves:
 * `clock.frame`, the weave and a box timeline's box stay the frame's own, so a
 * piece stepped by frame holds still and shows no blur.
 */
function expose(g, piece, solved, tt, clock, scale, n) {
  const { width: W, height: H } = g.canvas;
  let x = EXPOSURES.get(solved);
  if (!x || x.W !== W || x.H !== H) {
    const canvas = sibling(g.canvas, W, H);
    if (!canvas) throw new Error('render: this environment has no canvas to expose a shutter on');
    x = { W, H, canvas, g: canvas.getContext('2d', { willReadFrequently: true }), sum: new Float32Array(W * H * 4) };
    EXPOSURES.set(solved, x);
  }
  const { sum } = x;
  sum.fill(0);
  const den = frameDen(piece), last = piece.time.loop ? Infinity : (clock.frames - 1) / clock.hz;
  for (let k = 0; k < n; k++) {
    const open = (k / n) * 0.5;
    x.g.setTransform(1, 0, 0, 1, 0, 0);
    x.g.clearRect(0, 0, W, H);
    x.g.save();
    x.g.scale(scale, scale);
    try {
      if (piece.finish) weave(x.g, piece, solved, clock.frame);
      piece.draw(x.g, solved.state, Math.min(1, tt + open / den), { ...clock, seconds: Math.min(last, clock.seconds + open / clock.hz) });
    } finally {
      x.g.restore();
    }
    const d = x.g.getImageData(0, 0, W, H).data;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3] / 255;
      sum[i] += LINEAR[d[i]] * a;
      sum[i + 1] += LINEAR[d[i + 1]] * a;
      sum[i + 2] += LINEAR[d[i + 2]] * a;
      sum[i + 3] += a;
    }
  }
  const out = x.g.createImageData(W, H), o = out.data;
  for (let i = 0; i < o.length; i += 4) {
    const a = sum[i + 3];
    if (a <= 0) continue;
    o[i] = encoded(sum[i] / a);
    o[i + 1] = encoded(sum[i + 1] / a);
    o[i + 2] = encoded(sum[i + 2] / a);
    o[i + 3] = Math.round((a / n) * 255);
  }
  x.g.setTransform(1, 0, 0, 1, 0, 0);
  x.g.putImageData(out, 0, 0);
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(x.canvas, 0, 0);
  g.restore();
}

/**
 * Draw one frame onto any Canvas2D-shaped surface.
 *
 * `scale` is device units per design unit. Any positive finite scale is valid;
 * the destination surface determines the available output resolution.
 * `reducedMotion` tells a piece with play, through its clock, that idle motion
 * should hold still.
 *
 * Note for authors: do not multiply every stochastic frequency by `scale`.
 * Macro composition must be invariant under resolution; only micro-detail
 * bandwidth may rise with it.
 */
function drawFrame(surface, piece, solved, t, opt = {}) {
  const scale = opt.scale === undefined ? 1 : opt.scale;
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('render: scale must be a positive finite number');
  const tt = frameT(piece, t);
  const clock = clockAt(piece, t, opt);
  // A declared finish needs pixels; a surface without a canvas gets the marks.
  const film = !!(piece.finish && surface.canvas);
  // `opt.shutter`, a film export's sub-frames per frame; absent, one instant.
  if (opt.shutter > 1 && surface.canvas && piece.time && !piece.play) {
    expose(surface, piece, solved, tt, clock, scale, opt.shutter);
    if (film) develop(surface, piece, solved, clock.frame, scale);
    return tt;
  }
  if (surface.save) surface.save();
  if (scale !== 1 && surface.scale) surface.scale(scale, scale);
  try {
    if (film) weave(surface, piece, solved, clock.frame);
    piece.draw(surface, solved.state, tt, clock);
  } finally {
    if (surface.restore) surface.restore();
  }
  if (film) develop(surface, piece, solved, clock.frame, scale);
  return tt;
}

/**
 * Render one frame as an SVG document.
 *
 * Refuses a piece that has not declared `vector`, by name. A piece may be
 * perfectly drawable as vector and still not have said so -- declaring it is
 * what makes the claim checkable, and a silently-wrong file is the failure this
 * whole design exists to avoid.
 */
function renderVector(piece, opt = {}) {
  const p = validate(piece);
  if (!p.outputs.includes('vector')) {
    throw new Error(
      `render: piece "${p.name}" has not declared vector output. Add outputs: `
      + `["raster", "vector"] if it draws only paths -- the vector surface will `
      + `then refuse any raster operation by name rather than dropping it.`,
    );
  }
  const solved = solve(p, opt.seed, opt.params);
  if (solved.stages.error) {
    const e = solved.stages.error;
    throw new Error(`render: build stage "${e.stage}" (${e.at + 1} of ${e.of}) threw: ${e.message}`);
  }
  // The playhead is only known here, so the recipe is completed here: solve()
  // has no idea which frame anyone is going to draw. `t` is the QUANTISED one
  // drawFrame returns, not the one that was asked for -- the recipe has to name
  // the frame that was actually drawn, or replaying it lands somewhere else.
  const g = new VectorSurface(p.size, { background: opt.background });
  const t = drawFrame(g, p, solved, opt.t === undefined ? 1 : opt.t);
  const manifest = { ...solved.manifest, t };
  g.setManifest(manifest);
  return { svg: g.toSVG(), marks: g.markCount, t, seed: solved.seed, stages: solved.stages, manifest };
}

/**
 * The playheads of every drawn frame, in order. One entry for a still.
 * A video export walks exactly this list: the frames are a property of the
 * piece, never of how fast the machine happened to be.
 *
 * Walk the shared frame lattice directly so export visits each drawn frame
 * once, using the same loop and endpoint conventions as drawing.
 */
function playheads(piece) {
  const p = validate(piece);
  const n = frameCount(p);
  if (n === 1) return [0];
  const den = frameDen(p);
  return Array.from({ length: n }, (_, i) => i / den);
}

/**
 * Render a validated piece's soundtrack offline, sample-exact against its frames.
 *
 * The soundtrack lasts `frames / hz` seconds: the frame grid, not the declared
 * duration, because a film holds whole frames and a soundtrack one frame longer
 * or shorter ends out of step with its picture. Resolves to the rendered
 * AudioBuffer, or to null when the piece declares no sound.
 *
 * `opt.OfflineAudioContext` defaults to the global one. Node has none, so a
 * caller outside a browser hands one in. `opt.sampleRate` defaults to 48000 and
 * `opt.channels` to 2.
 */
async function renderSound(piece, solved, opt = {}) {
  if (!piece.sound) return null;
  const Context = opt.OfflineAudioContext || globalThis.OfflineAudioContext;
  if (typeof Context !== 'function') {
    throw new Error('render: this environment has no OfflineAudioContext, so the soundtrack cannot be rendered');
  }
  const rate = opt.sampleRate || 48000;
  const frames = frameCount(piece);
  const duration = frames / piece.time.hz;
  const length = Math.round(duration * rate), loop = !!piece.time.loop;
  // A loop is heard end to start, so what rings past its last frame belongs
  // on its first ones: render that overhang too, then lay it over the start.
  const over = loop ? Math.min(length, Math.round(LOOP_TAIL * rate)) : 0;
  const ctx = new Context(opt.channels || 2, length + over, rate);
  await piece.sound(ctx, solved.state, { duration, frames, hz: piece.time.hz, loop });
  const rendered = await ctx.startRendering();
  if (over === 0) return rendered;
  const channels = rendered.numberOfChannels, folded = [];
  for (let c = 0; c < channels; c++) {
    const all = rendered.getChannelData(c), data = new Float32Array(length);
    data.set(all.subarray(0, length));
    for (let i = 0; i < over; i++) data[i] += all[length + i];
    folded.push(data);
  }
  if (typeof ctx.createBuffer === 'function') {
    const buffer = ctx.createBuffer(channels, length, rate);
    folded.forEach((data, c) => buffer.getChannelData(c).set(data));
    return buffer;
  }
  return { length, duration: length / rate, sampleRate: rate, numberOfChannels: channels, getChannelData: (c) => folded[c] };
}

// How much of a looping film's ring past its end is kept and laid over its
// start, in seconds; never more than the film's own length.
const LOOP_TAIL = 6;

module.exports = { drawFrame, renderVector, playheads, renderSound };
