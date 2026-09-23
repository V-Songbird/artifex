// Static layers: a part of every frame that never changes, drawn once per scale.
//
// Many frames begin with the same picture -- a ground, a grid, a plate -- and a
// timeline redraws it on every frame. On a raster surface `layer` keeps a copy
// of it at the surface's device scale and puts that copy back on later frames.
// On any other surface it runs `paint`, so an SVG keeps every path and the
// benchmark's null surface measures the piece's own calls.
//
// THE COPY IS EXACT, OR THERE IS NO COPY. The copy is taken from the surface
// itself, just after it drew the layer, so it holds the pixels that surface's
// own rasteriser made. It is kept only when the layer alone is opaque across
// its box -- then nothing under it shows through, and putting the copy back on
// whole device pixels leaves exactly what drawing the layer would. A translucent
// layer is drawn directly instead, and so is a rotated or skewed surface, a box
// off the pixel grid, and anything past the cap.
//
// WHAT PAINT MAY READ: the surface it is handed and the solved state, never the
// playhead. A copy does not change between frames, so a paint that read the
// playhead would freeze on the frame that was copied. A paint that asks for a
// third argument is refused by name; one that reads the playhead some other way
// is caught by comparing copied frames with drawn ones, as the tests do.

'use strict';

// Pixels kept per canvas and solve: 2^25, about 128 MB of RGBA. Past it, layers
// are drawn.
const CAP = 2 ** 25;

// One cache per canvas and solve, released with either: a copy holds the pixels
// of the canvas it was taken from, so it is never put on another. Entry per
// layer, scale, box and canvas size: 'seen' after its first draw, 'direct' when
// it cannot be kept, or the copy's canvas.
const caches = new WeakMap();

/**
 * Draw a static layer: `paint(surface, state)` inside `box`, [x, y, w, h] in the
 * surface's current units, from the default drawing state.
 *
 * On a raster surface the first draw at a device scale paints directly; the
 * second paints directly again and keeps a copy; every later draw puts the copy
 * back. A frame drawn once costs nothing extra, and `paint` runs at most three
 * times per layer and scale. `key` names the layer within its solve; `opt.cap`
 * replaces the pixel cap. Drawing state set by `paint` does not leak into the
 * frame.
 */
function layer(g, state, key, box, paint, opt = {}) {
  if (typeof paint !== 'function' || paint.length > 2) {
    throw new TypeError(`layer "${key}": paint takes the surface and the solved state, and never the playhead`);
  }
  const at = place(g, box);
  if (!at) return direct(g, state, paint);
  let solves = caches.get(g.canvas);
  if (!solves) caches.set(g.canvas, solves = new WeakMap());
  let cache = solves.get(state);
  if (!cache) solves.set(state, cache = { pixels: 0, entries: new Map() });
  const id = `${key}@${at.scale}:${box.join(',')}:${g.canvas.width}x${g.canvas.height}`;
  const entry = cache.entries.get(id);
  if (entry === undefined || entry === 'direct') {
    if (entry === undefined) cache.entries.set(id, 'seen');
    return direct(g, state, paint);
  }
  if (entry !== 'seen') return put(g, entry, at);
  direct(g, state, paint);
  const cap = opt.cap === undefined ? CAP : opt.cap;
  const copy = cache.pixels + at.w * at.h <= cap ? keep(g, state, at, paint) : null;
  cache.entries.set(id, copy || 'direct');
  if (copy) cache.pixels += at.w * at.h;
}

function direct(g, state, paint) {
  if (g.save) g.save();
  try { paint(g, state); } finally { if (g.restore) g.restore(); }
}

/** Where the box lands in device pixels, or null where no exact copy is possible. */
function place(g, box) {
  const c = g.canvas;
  if (!c || typeof c.width !== 'number' || typeof g.drawImage !== 'function' || typeof g.getTransform !== 'function') return null;
  const m = g.getTransform();
  if (m.b !== 0 || m.c !== 0 || !(m.a > 0) || m.a !== m.d) return null;
  const [x, y, w, h] = box;
  const dx = m.a * x + m.e;
  const dy = m.a * y + m.f;
  if (!Number.isInteger(dx) || !Number.isInteger(dy)) return null;
  const pw = Math.ceil(m.a * w);
  const ph = Math.ceil(m.a * h);
  if (!(pw > 0 && ph > 0)) return null;
  return { scale: m.a, e: m.e, f: m.f, dx, dy, w: pw, h: ph };
}

/**
 * Just after the surface drew the layer: if the layer alone is opaque, a copy of
 * what the surface now shows in the box, else null. Opacity is judged on a
 * separate canvas, where nothing drawn before the layer can make it look opaque.
 */
function keep(g, state, at, paint) {
  const probe = sibling(g.canvas, at.w, at.h);
  const copy = probe && sibling(g.canvas, at.w, at.h);
  if (!copy) return null;
  const pg = probe.getContext('2d', { willReadFrequently: true });
  // The surface's own transform, moved by whole pixels to the box's corner.
  pg.setTransform(at.scale, 0, 0, at.scale, at.e - at.dx, at.f - at.dy);
  paint(pg, state);
  const px = pg.getImageData(0, 0, at.w, at.h).data;
  for (let i = 3; i < px.length; i += 4) if (px[i] !== 255) return null;
  // A canvas of the surface's own kind: a copy between a CPU-backed and a
  // GPU-backed canvas can shift a colour by a few levels.
  const attrs = typeof g.getContextAttributes === 'function' ? g.getContextAttributes() : {};
  const cg = copy.getContext('2d', { alpha: attrs.alpha, colorSpace: attrs.colorSpace, willReadFrequently: attrs.willReadFrequently });
  cg.imageSmoothingEnabled = false;
  cg.drawImage(g.canvas, at.dx, at.dy, at.w, at.h, 0, 0, at.w, at.h);
  return copy;
}

function sibling(canvas, w, h) {
  if (canvas.ownerDocument && typeof canvas.ownerDocument.createElement === 'function') {
    const c = canvas.ownerDocument.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(w, h) : null;
}

function put(g, copy, at) {
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.imageSmoothingEnabled = false;
  g.drawImage(copy, at.dx, at.dy);
  g.restore();
}

module.exports = { layer };
