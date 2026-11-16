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
  if (!canvas) return null;
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

// Sprites: a picture baked into a raster copy and drawn back with any transform.
//
// A cutout with its rim, shadow and tint, or the sheet of every mark that has
// settled by now, costs the same to paint on every frame although it rarely
// changes. `sprite` bakes it on its own canvas at the surface's device scale and
// draws that canvas back, moved, turned and scaled, with the caller's alpha and
// blend, smoothed at high quality unless it asks otherwise. A sprite IS its baked
// canvas: without a copy it is baked afresh and drawn the same way, so a frame
// drawn from copies equals the frame drawn without them. A copy is only a cache.
//
// A KEY GROWS A COPY. `key` is the piece's own number for what the picture holds,
// such as how many marks have settled. The copy at `key` is the nearest older
// copy of the same sprite grown in place: only what lies between is painted on
// it, and it is kept at `key` instead, so a sheet that gains a mark per frame
// paints one mark per frame on one canvas. The older key, drawn again, is
// grown again from the copy below it or baked whole. That equals baking it
// whole as long as painting from a to b and then from b to c leaves what
// painting from nothing to c does.

// Pixels of copies kept per canvas: 2^24, 64 MB of RGBA. Past it the least
// recently drawn copies are dropped.
const BUDGET = 2 ** 24;

// The most `opt.scale` may multiply a bake by: 64 times the pixels.
const MAX_SCALE = 8;

// The most pixels one bake may hold: 2^28, the largest canvas installed Edge
// draws on. One pixel more and its canvas stays blank without an error.
const MAX_BAKE = 2 ** 28;

// Per canvas: the solve its copies were baked from, their pixels, each sprite's
// copies by key, and every copy in the order it was last drawn.
const sprites = new WeakMap();

/**
 * Draw a sprite: `paint(surface, state, from, to)` inside `box`, [x, y, w, h] in
 * its own units, baked on a raster surface and drawn with the transform `at`,
 * [a, b, c, d, e, f] on top of the surface's current one.
 *
 * `paint` draws what the sprite holds at key `to` beyond what it held at key
 * `from`, or all of it when `from` is null, onto a transparent ground, setting
 * every drawing state it uses; on a raster surface what falls outside `box` is
 * cut off. It reads the solved state and the keys, never the playhead.
 * `opt.key` defaults to 0, `opt.at` to no transform, `opt.scale` to 1 and
 * `opt.budget` to BUDGET pixels per canvas; a budget of 0 keeps nothing.
 * `scale`, up to MAX_SCALE, multiplies the bake's pixels per unit, so a sprite
 * that `at` enlarges keeps its detail. A bake past MAX_BAKE pixels is refused.
 * `opt.smoothing`, 'high' by default, 'medium', 'low' or false for nearest
 * neighbour, is how the copy is drawn, not what it holds, so it shares the copy
 * of every other smoothing. On a surface without a canvas, such as an SVG,
 * `paint` draws there directly under `at`, from null to `key`, and every path
 * is kept.
 */
function sprite(g, state, name, box, paint, opt = {}) {
  const { key = 0, at = [1, 0, 0, 1, 0, 0], scale = 1, budget = BUDGET, smoothing = 'high' } = opt;
  if (typeof paint !== 'function') throw new TypeError(`sprite "${name}": paint must be a function`);
  if (!Number.isFinite(key)) throw new RangeError(`sprite "${name}": key must be a finite number`);
  if (!(box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0)) throw new RangeError(`sprite "${name}": box must be [x, y, w, h] with a positive size`);
  if (!(at.length === 6 && at.every(Number.isFinite))) throw new RangeError(`sprite "${name}": at must be six finite numbers`);
  if (!(scale > 0 && scale <= MAX_SCALE)) throw new RangeError(`sprite "${name}": scale must be a number above 0 and at most ${MAX_SCALE}`);
  if (smoothing !== false && !['high', 'medium', 'low'].includes(smoothing)) {
    throw new TypeError(`sprite "${name}": smoothing must be 'high', 'medium', 'low' or false, not ${typeof smoothing === 'string' ? `'${smoothing}'` : typeof smoothing === 'object' && smoothing ? 'an object' : String(smoothing)}`);
  }
  const m = g.canvas && typeof g.drawImage === 'function' && typeof g.getTransform === 'function' ? g.getTransform() : null;
  // Rounded to 2^-20, so a surface turned by another angle on each frame keeps
  // one scale: the root of 4 cos^2 + 4 sin^2 lands a hair either side of 2.
  const res = m && Math.round(Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) * 2 ** 20) / 2 ** 20 * scale;
  const [x, y, w, h] = box;
  const [pw, ph] = [Math.ceil(w * res), Math.ceil(h * res)];
  const doc = g.canvas && g.canvas.ownerDocument;
  const raster = res > 0 && ((doc && typeof doc.createElement === 'function') || typeof OffscreenCanvas === 'function');
  if (raster && !(pw * ph <= MAX_BAKE)) throw new RangeError(`sprite "${name}": a bake of ${pw} x ${ph} pixels is more than the ${MAX_BAKE} pixels a canvas holds`);
  g.save();
  try {
    g.transform(...at);
    if (!raster) return paint(g, state, null, key);
    let cache = sprites.get(g.canvas);
    if (!cache || cache.state !== state) sprites.set(g.canvas, cache = { state, pixels: 0, sprites: new Map(), recent: new Map() });
    const id = `${name}@${res}:${box.join(',')}`;
    let copies = cache.sprites.get(id);
    if (!copies) cache.sprites.set(id, copies = new Map());
    let copy = copies.get(key);
    if (!copy) {
      let from = null;
      for (const k of copies.keys()) if (k < key && (from === null || k > from)) from = k;
      // The older copy leaves the cache before it grows, so a paint that throws
      // leaves no half-grown copy behind.
      const older = from === null ? null : copies.get(from);
      if (older) {
        copies.delete(from);
        cache.recent.delete(older);
        cache.pixels -= pw * ph;
      }
      copy = bake(g, older || sibling(g.canvas, pw, ph), state, box, res, paint, from, key);
      if (pw * ph <= budget) {
        for (const [old, keys] of cache.recent) {
          if (cache.pixels + pw * ph <= budget) break;
          cache.recent.delete(old);
          keys.copies.delete(keys.key);
          cache.pixels -= old.width * old.height;
        }
        copies.set(key, copy);
        cache.pixels += pw * ph;
      }
    }
    if (copies.get(key) === copy) {
      cache.recent.delete(copy);
      cache.recent.set(copy, { copies, key });
    }
    g.translate(x, y);
    g.scale(1 / res, 1 / res);
    // At 'high', mipmapped where the copy is shrunk, so a fine texture turning
    // slowly does not shimmer from frame to frame.
    g.imageSmoothingEnabled = smoothing !== false;
    if (smoothing) g.imageSmoothingQuality = smoothing;
    g.drawImage(copy, 0, 0);
  } finally {
    g.restore();
  }
}

/** A sprite's canvas at `to`: the copy at `from` with what lies between painted on it, or a new canvas with all of it. */
function bake(g, canvas, state, [x, y], res, paint, from, to) {
  const attrs = typeof g.getContextAttributes === 'function' ? g.getContextAttributes() : {};
  const cg = canvas.getContext('2d', { colorSpace: attrs.colorSpace, willReadFrequently: attrs.willReadFrequently });
  // Each span is painted from the default drawing state and an empty path, as
  // on a new canvas: save and restore do not keep the path.
  cg.save();
  cg.beginPath();
  try {
    cg.setTransform(res, 0, 0, res, -x * res, -y * res);
    paint(cg, state, from, to);
  } finally {
    cg.restore();
  }
  return canvas;
}

/** The copies a canvas holds: how many, and their pixels (4 bytes each). */
function held(canvas) {
  const cache = sprites.get(canvas);
  return cache ? { copies: cache.recent.size, pixels: cache.pixels } : { copies: 0, pixels: 0 };
}

// Part frames: where every part of a tree of parts sits.
//
// A thing made of attached parts moves as a tree: a part placed in its parent's
// frame takes on everything its parent does, its place, its turn and its squash,
// and passes it to its own children. Nested save and restore draws such a tree
// only in the tree's own order. `partFrames` works each part's whole transform
// out once, so parts can be drawn in any depth order, handed to `sprite` as its
// `at`, and asked where one of their points lands on the surface.

/**
 * The transform of every part of a tree, by name: a Map of `[a, b, c, d, e, f]`,
 * the six numbers `g.transform(...)` and `sprite`'s `at` take.
 *
 * A part is `{ name, at, turn, scale, kids }`: `at`, [x, y], is where its own
 * origin sits in its parent's frame (default [0, 0]), `turn` the radians it is
 * turned about that origin (default 0), `scale` a number or [sx, sy] it is
 * scaled by there (default 1), and `kids` the parts attached to it. A child's
 * transform is its parent's followed by its own, so a parent that moves, turns
 * or squashes carries every part below it and no joint drifts apart. `at`, the
 * second argument, is the frame the root sits in (default none).
 *
 * Every part needs its own name; a part without one, a name used twice and a
 * value that is not a finite number are refused by name.
 */
function partFrames(root, at = [1, 0, 0, 1, 0, 0]) {
  if (!(Array.isArray(at) && at.length === 6 && at.every(Number.isFinite))) throw new RangeError('partFrames: at must be six finite numbers');
  const out = new Map();
  const walk = (part, parent, path) => {
    if (part === null || typeof part !== 'object' || typeof part.name !== 'string' || part.name === '') throw new TypeError(`partFrames: a part under ${path} has no name`);
    const who = `partFrames: part "${part.name}"`;
    if (out.has(part.name)) throw new RangeError(`${who} is named twice`);
    const { at: place = [0, 0], turn = 0, scale = 1, kids = [] } = part;
    const [x, y] = Array.isArray(place) ? place : [NaN, NaN];
    const [sx, sy] = Array.isArray(scale) ? scale : [scale, scale];
    if (![x, y, turn, sx, sy].every(Number.isFinite)) throw new RangeError(`${who}: at, turn and scale must be finite numbers`);
    if (!Array.isArray(kids)) throw new TypeError(`${who}: kids must be a list of parts`);
    const [cos, sin] = [Math.cos(turn), Math.sin(turn)];
    // The parent's transform, then this part's own: move, turn, scale.
    const [a, b, c, d, e, f] = parent;
    const own = [cos * sx, sin * sx, -sin * sy, cos * sy, x, y];
    const m = [a * own[0] + c * own[1], b * own[0] + d * own[1], a * own[2] + c * own[3], b * own[2] + d * own[3], a * x + c * y + e, b * x + d * y + f];
    out.set(part.name, m);
    for (const k of kids) walk(k, m, `"${part.name}"`);
  };
  walk(root, at, 'the root');
  return out;
}

/** Where the point `p`, [x, y] in a part's own frame, lands under that part's transform `m`. */
function framePoint(m, p) {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}

module.exports = { layer, sibling, sprite, held, partFrames, framePoint, BUDGET, MAX_SCALE, MAX_BAKE };
