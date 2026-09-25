// A part of a frame drawn once per canvas, scale and solve, and put back on
// every frame after: `core/layer.js` without its opacity probe.
//
// WHY NOT `layer`. `layer` draws a layer directly on its first frame and, on
// its second, draws it again on a probe canvas and reads every pixel back to
// prove it opaque before keeping a copy. A shot on the site pays those two
// frames where the visitor scrolls, and the stage judges its first twenty
// draws. Here the caller vouches that the part is opaque, so the first frame
// paints it once on its own canvas and every frame, the first included, puts
// that canvas back: one costly frame instead of two, and every frame made the
// same way.
//
// On a surface with no canvas -- a vector or null surface -- it paints directly.

'use strict';

const held = new WeakMap();
const CAP = 8294400;

/**
 * Draw `paint(g, s)`, which must cover the whole canvas opaquely and read only
 * the solved state, through a copy kept per canvas, device transform and solve.
 *
 * `prime(g, s)`, when given, runs on the surface itself just before the first
 * copy is put down, so whatever it draws is covered. The first time a GPU
 * canvas meets a kind of mark -- a sprite, a hairline, a gradient with so many
 * stops -- the browser prepares it, and that frame costs 25 to 40 ms more.
 * Primed, that cost lands on the first frame, which is already the costly one
 * and, for every shot but the first, drawn before the shot is on screen.
 */
function hold(g, s, key, paint, prime) {
  const copy = keep(g, s, key, paint, prime);
  if (!copy) { paint(g, s); return; }
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.imageSmoothingEnabled = false;
  g.drawImage(copy, 0, 0);
  g.restore();
}

/**
 * The kept copy `hold` would put down, without putting it down, for a shot
 * that lays it itself -- cut into pieces, moved, reflected -- or null on a
 * surface that keeps no copies, where the caller paints instead.
 */
function keep(g, s, key, paint, prime) {
  const c = g.canvas;
  // Past the stage's own canvas cap -- a print export -- a copy would only double the memory of a one-off frame.
  if (!c || typeof c.width !== 'number' || c.width * c.height > CAP || typeof g.drawImage !== 'function' || typeof g.getTransform !== 'function') {
    return null;
  }
  const m = g.getTransform();
  const id = [key, c.width, c.height, m.a, m.b, m.c, m.d, m.e, m.f].join(',');
  let kept = held.get(c);
  if (!kept) held.set(c, kept = new WeakMap());
  let mine = kept.get(s);
  if (!mine) kept.set(s, mine = new Map());
  let copy = mine.get(id);
  if (!copy) {
    // One copy per key: a new size or scale replaces the old one. When the
    // stage has lowered the scale, the new copy is the old one shrunk.
    let old = null;
    for (const [k, v] of mine) if (k.startsWith(key + ',')) { old = v; mine.delete(k); }
    copy = old && shrinks(old, m) ? shrink(old, c, m) : null;
    if (!copy) {
      copy = sibling(c);
      if (!copy) return null;
      const cg = copy.getContext('2d');
      cg.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
      paint(cg, s);
      copy.scale = m.a;
      mine.set(id, copy);
      // Where the copy goes down, marks drawn now are covered at once: a shot
      // draws there, once, every kind of mark it will make (see `prime`).
      if (prime) { g.save(); prime(g, s); g.restore(); }
    }
    mine.set(id, copy);
  }
  return copy;
}

const counts = new WeakMap();
const EVERY = 4;           // a copy at every multiple of this count is kept for good
const KEEP = 2;            // and this many others, the least recently used given up first

/**
 * Draw `base(g, s)` and then items 0 to k - 1, `item(g, s, i)`, through kept
 * copies: the copy for the nearest count at or below k, brought up to k by
 * drawing the items it lacks onto a new copy. A shot that lays marks one after
 * another, and whose finished marks no longer change, draws each mark about
 * once however the visitor scrolls. `base` must be opaque; neither it nor
 * `item` may read the playhead.
 *
 * The base's copy and one at every EVERY-th count are kept for good, so a
 * visitor scrolling back redraws at most EVERY - 1 items; KEEP more are kept
 * for the counts in between; with `most`, the largest count it will be asked
 * for, it makes them all on its first frame. `prime`, when given, runs on the surface once,
 * where the first copy then covers it (see `hold`). On a surface with no
 * canvas, or past the cap, everything is drawn.
 */
function upTo(g, s, key, k, base, item, prime, most = 0) {
  const c = g.canvas;
  if (!c || typeof c.width !== 'number' || c.width * c.height > CAP || typeof g.drawImage !== 'function' || typeof g.getTransform !== 'function') {
    base(g, s);
    for (let i = 0; i < k; i++) item(g, s, i);
    return;
  }
  const m = g.getTransform();
  const id = [key, c.width, c.height, m.a, m.b, m.c, m.d, m.e, m.f].join(',');
  let bySolve = counts.get(c);
  if (!bySolve) counts.set(c, bySolve = new WeakMap());
  let kept = bySolve.get(s);
  if (kept && kept.id !== id && shrinks(kept.copies.get(0), m)) {
    // The stage lowered the scale: every kept count, shrunk from the larger copies.
    const copies = new Map();
    for (const [n, old] of kept.copies) copies.set(n, shrink(old, c, m));
    bySolve.set(s, kept = { id, copies, used: kept.used.slice(), pool: [] });
  }
  if (!kept || kept.id !== id) {
    const first = sibling(c);
    if (!first) { base(g, s); for (let i = 0; i < k; i++) item(g, s, i); return; }
    const fg = first.getContext('2d');
    fg.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    base(fg, s);
    first.scale = m.a;
    // Every copy it will need, made now: a canvas's first draw is its costly
    // one, and the first frame is already costly and, for all but the first
    // shot, drawn before the shot is on screen.
    const pool = [];
    for (let i = Math.ceil(most / EVERY) + KEEP; i > 0; i--) {
      const spare = sibling(c);
      if (!spare) break;
      spare.getContext('2d').drawImage(first, 0, 0);
      pool.push(spare);
    }
    bySolve.set(s, kept = { id, copies: new Map([[0, first]]), used: [], pool });
    if (prime) { g.save(); prime(g, s); g.restore(); }
  }
  let from = 0;
  for (const n of kept.copies.keys()) if (n <= k && n > from) from = n;
  // Up to k, making each kept count passed on the way.
  while (from < k) {
    const to = Math.min(k, (Math.floor(from / EVERY) + 1) * EVERY);
    let next = null;
    const at = to % EVERY && kept.used.length >= KEEP ? kept.used.findIndex((n) => n !== from) : -1;
    if (at >= 0) {
      const old = kept.used.splice(at, 1)[0];
      next = kept.copies.get(old);
      kept.copies.delete(old);
    }
    next = next || kept.pool.pop() || sibling(c);
    const ng = next.getContext('2d');
    ng.setTransform(1, 0, 0, 1, 0, 0);
    ng.globalAlpha = 1;
    // The copies are opaque, so laying one over another replaces it.
    ng.drawImage(kept.copies.get(from), 0, 0);
    ng.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    for (let i = from; i < to; i++) item(ng, s, i);
    next.scale = m.a;
    kept.copies.set(to, next);
    if (to % EVERY) kept.used.push(to);
    from = to;
  }
  if (k % EVERY) { kept.used = kept.used.filter((n) => n !== k); kept.used.push(k); }
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.imageSmoothingEnabled = false;
  g.drawImage(kept.copies.get(k), 0, 0);
  g.restore();
}

/**
 * Whether a copy kept at a larger scale can stand in, shrunk, for one at the
 * transform `m`: a plain scale from the origin, as the stage draws, only ever
 * downwards (shrinking loses nothing a lower scale could show).
 */
function shrinks(old, m) {
  return !!old && old.scale > m.a && m.b === 0 && m.c === 0 && m.a === m.d && m.e === 0 && m.f === 0;
}

/** A copy for canvas `c` at transform `m`, shrunk from `old`, smoothed. */
function shrink(old, c, m) {
  const copy = sibling(c);
  if (!copy) return null;
  const cg = copy.getContext('2d');
  const r = m.a / old.scale;
  cg.imageSmoothingEnabled = true;
  cg.imageSmoothingQuality = 'high';
  cg.drawImage(old, 0, 0, old.width * r, old.height * r);
  copy.scale = m.a;
  return copy;
}

// One small canvas per size, shared by every surface of that size: each use
// clears it, and a new canvas's first draw is a costly one.
const scratch = new Map();

/**
 * Draw `draw(g)` at 1/`factor` of the surface's resolution and lay the result
 * back, smoothed: the soft edge of ink in water, for the price of a small
 * canvas. What `draw` lays composes as it would on the surface itself. On a
 * surface with no canvas it draws directly.
 */
function soft(g, factor, draw) {
  const c = g.canvas;
  if (!c || typeof c.width !== 'number' || typeof g.drawImage !== 'function' || typeof g.getTransform !== 'function') {
    draw(g);
    return;
  }
  const w = Math.ceil(c.width / factor), h = Math.ceil(c.height / factor);
  const size = w + 'x' + h + (c.ownerDocument ? '' : ' offscreen');
  let small = scratch.get(size);
  if (!small) {
    small = sibling({ width: w, height: h, ownerDocument: c.ownerDocument });
    if (!small) { draw(g); return; }
    scratch.set(size, small);
  }
  const sg = small.getContext('2d');
  const m = g.getTransform();
  sg.setTransform(1, 0, 0, 1, 0, 0);
  sg.clearRect(0, 0, w, h);
  sg.setTransform(m.a / factor, m.b / factor, m.c / factor, m.d / factor, m.e / factor, m.f / factor);
  draw(sg);
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.imageSmoothingEnabled = true;
  g.drawImage(small, 0, 0, w, h, 0, 0, w * factor, h * factor);
  g.restore();
}

function sibling(canvas) {
  if (canvas.ownerDocument && typeof canvas.ownerDocument.createElement === 'function') {
    const c = canvas.ownerDocument.createElement('canvas');
    c.width = canvas.width;
    c.height = canvas.height;
    return c;
  }
  return typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(canvas.width, canvas.height) : null;
}

module.exports = { hold, keep, soft, upTo };
