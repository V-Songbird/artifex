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
 * `scale` is device units per design unit. It is NOT capped: a print needs 8x or
 * more, and the engine this imports from capped it at 2 inside its published
 * hook, which put print resolution out of reach of every caller.
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
  const g = new VectorSurface(p.size, { background: opt.background });
  const t = drawFrame(g, p, solved, opt.t === undefined ? 1 : opt.t);
  return { svg: g.toSVG(), marks: g.markCount, t, seed: solved.seed, stages: solved.stages };
}

/**
 * The playheads of every drawn frame, in order. One entry for a still.
 * A video export walks exactly this list: the frames are a property of the
 * piece, never of how fast the machine happened to be.
 *
 * It walks the lattice directly rather than sampling it. Sampling i/(n-1) and
 * letting frameT round is what dropped the middle frame of every timeline in
 * this library for as long as the function existed -- n samples over a lattice
 * that had n+1 positions, with Math.round quietly choosing which one to lose.
 */
function playheads(piece) {
  const p = validate(piece);
  const n = frameCount(p);
  if (n === 1) return [0];
  const den = frameDen(p);
  return Array.from({ length: n }, (_, i) => i / den);
}

module.exports = { drawFrame, renderVector, playheads };
