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

/**
 * Draw one frame onto any Canvas2D-shaped surface.
 *
 * `scale` is device units per design unit. Any positive finite scale is valid;
 * the destination surface determines the available output resolution.
 *
 * Note for authors: do not multiply every stochastic frequency by `scale`.
 * Macro composition must be invariant under resolution; only micro-detail
 * bandwidth may rise with it.
 */
function drawFrame(surface, piece, solved, t, opt = {}) {
  const scale = opt.scale === undefined ? 1 : opt.scale;
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('render: scale must be a positive finite number');
  const tt = frameT(piece, t);
  const clock = clockAt(piece, t);
  if (surface.save) surface.save();
  if (scale !== 1 && surface.scale) surface.scale(scale, scale);
  try {
    piece.draw(surface, solved.state, tt, clock);
  } finally {
    if (surface.restore) surface.restore();
  }
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
  const ctx = new Context(opt.channels || 2, Math.round(duration * rate), rate);
  piece.sound(ctx, solved.state, { duration, frames, hz: piece.time.hz, loop: !!piece.time.loop });
  return ctx.startRendering();
}

module.exports = { drawFrame, renderVector, playheads, renderSound };
