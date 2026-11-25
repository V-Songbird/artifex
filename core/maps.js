// A surface built as maps: grids of numbers a piece composes like a graph of
// nodes. A height comes first; light, hollows and wear are derived from it;
// colour comes last, read through a ramp and laid by masks. Every function
// returns a new map and changes none it is given.
'use strict';

const { rgb, toLinear, toSRGB } = require('./colour.js');

// The most cells one map may hold: 4096 x 4096.
const MAX_CELLS = 2 ** 24;

function sized(w, h, who) {
  if (!(Number.isInteger(w) && w >= 1 && Number.isInteger(h) && h >= 1 && w * h <= MAX_CELLS)) {
    throw new RangeError(`${who}: w and h must be whole numbers of cells, 1 or more, with at most ${MAX_CELLS} cells in all, got ${w} x ${h}`);
  }
}

function mapOf(m, who) {
  if (!(m && m.data instanceof Float32Array && m.data.length === m.w * m.h)) throw new TypeError(`${who}: takes a map, such as fill(w, h, 0)`);
  return m;
}

function alike(a, b, who) {
  if (mapOf(a, who).w !== mapOf(b, who).w || a.h !== b.h) throw new RangeError(`${who}: its maps must have one size, got ${a.w} x ${a.h} and ${b.w} x ${b.h}`);
}

function amount(v, who, what) {
  if (!Number.isFinite(v)) throw new RangeError(`${who}: ${what} must be a finite number, got ${v}`);
  return v;
}

/** A w x h map, { w, h, data: Float32Array }, row by row from the top left, holding `value`: a number, or a function (x, y) of a cell's column and row. */
function fill(w, h, value = 0) {
  sized(w, h, 'fill');
  const data = new Float32Array(w * h);
  if (typeof value === 'function') {
    for (let y = 0, p = 0; y < h; y++) for (let x = 0; x < w; x++, p++) data[p] = value(x, y);
  } else data.fill(amount(value, 'fill', 'value'));
  return { w, h, data };
}

/**
 * Gradient noise about 0.5, in [0, 1), from `R`. `scale` (default 64) is the size in cells
 * of its largest features, one number or [across, down] for a grain that runs
 * one way. `octaves` (default 1, at most 12) adds finer copies, each half the
 * size and `gain` (default 0.5) the strength of the one before; an octave
 * finer than a cell is not added. `name` (default 'map') separates one noise
 * from another. The noise is a window on one endless field: a larger map
 * with the same name holds the smaller one in its top left corner.
 */
function noise(R, w, h, opt = {}) {
  sized(w, h, 'noise');
  const { scale = 64, octaves = 1, gain = 0.5, name = 'map' } = opt;
  const [sx, sy] = Array.isArray(scale) ? scale : [scale, scale];
  if (!(sx > 0 && sy > 0 && Number.isFinite(sx + sy) && w / sx < 32768 && h / sy < 32768)) throw new RangeError(`noise: scale must be a positive size in cells, or [across, down], got ${scale}`);
  if (!(Number.isInteger(octaves) && octaves >= 1 && octaves <= 12)) throw new RangeError(`noise: octaves must be a whole number from 1 to 12, got ${octaves}`);
  if (!(gain > 0 && gain <= 1)) throw new RangeError(`noise: gain must be over 0 and at most 1, got ${gain}`);
  if (typeof name !== 'string') throw new TypeError(`noise: name must be a string, got ${typeof name}`);
  const data = new Float32Array(w * h), left = new Int32Array(w), tx = new Float32Array(w), fx = new Float32Array(w);
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  let total = 0;
  for (let o = 0, amp = 1; o < octaves; o++, amp *= gain) {
    const cx = sx / 2 ** o, cy = sy / 2 ** o;
    if (o > 0 && cx < 1 && cy < 1) break;
    // One unit gradient per lattice point; a cell's value is the four nearest
    // slopes read at it and joined by a curve flat to its second derivative,
    // so a height made of this noise lights without showing the lattice.
    const cols = Math.floor((w - 1) / cx) + 2, rows = Math.floor((h - 1) / cy) + 2, gx = new Float32Array(cols * rows), gy = new Float32Array(cols * rows), key = `octave ${o}`;
    for (let j = 0, k = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++, k++) { const turn = R(name, key, (i << 16) | j) * Math.PI * 2; gx[k] = Math.cos(turn); gy[k] = Math.sin(turn); }
    }
    for (let x = 0; x < w; x++) { const u = x / cx; left[x] = Math.floor(u); tx[x] = u - left[x]; fx[x] = fade(tx[x]); }
    for (let y = 0, p = 0; y < h; y++) {
      const v = y / cy, ty = v - Math.floor(v), fy = fade(ty), top = Math.floor(v) * cols, low = top + cols;
      for (let x = 0; x < w; x++, p++) {
        const a = top + left[x], b = low + left[x], t = tx[x];
        const up = gx[a] * t + gy[a] * ty, upRight = gx[a + 1] * (t - 1) + gy[a + 1] * ty;
        const down = gx[b] * t + gy[b] * (ty - 1), downRight = gx[b + 1] * (t - 1) + gy[b + 1] * (ty - 1);
        const high = up + (upRight - up) * fx[x];
        data[p] += amp * (high + (down + (downRight - down) * fx[x] - high) * fy);
      }
    }
    total += amp;
  }
  // A gradient noise lies within sqrt(1/2) of zero; the map holds it about 0.5.
  for (let p = 0; p < data.length; p++) data[p] = Math.min(0.999999, Math.max(0, 0.5 + data[p] / total * Math.SQRT1_2));
  return { w, h, data };
}

/**
 * The surface cut into cells, each round one point of a jittered lattice, as
 * four maps: `value`, one number in [0, 1) for the whole cell; `edge`, how
 * far each place lies from the cell's nearest border, 0 on it, in map cells
 * (measured along the cell's short side when `scale` differs each way);
 * and `x` and `y`, where a place lies from its cell's point, in units of
 * `scale`, so about -0.5 to 0.5 across a cell. Break lines come from here,
 * not from the height: give each cell a level from `value`, a tilt from `x`
 * and `y`, a bevel from `edge`. `scale` (default 64) is the cell's size in
 * map cells, one number or [across, down]; `jitter` (default 1, from 0 to 1)
 * is how far a point strays from its lattice place; `name` (default 'cells')
 * separates one cutting from another. A window on one endless field, as
 * `noise` is.
 */
function cells(R, w, h, opt = {}) {
  sized(w, h, 'cells');
  const { scale = 64, jitter = 1, name = 'cells' } = opt;
  const [sx, sy] = Array.isArray(scale) ? scale : [scale, scale];
  if (!(sx > 0 && sy > 0 && Number.isFinite(sx + sy) && w / sx < 32768 && h / sy < 32768)) throw new RangeError(`cells: scale must be a positive size in cells, or [across, down], got ${scale}`);
  if (!(jitter >= 0 && jitter <= 1)) throw new RangeError(`cells: jitter must be a share from 0 to 1, got ${jitter}`);
  if (typeof name !== 'string') throw new TypeError(`cells: name must be a string, got ${typeof name}`);
  // Lattice points two places past every side, so a cell's five by five
  // neighbourhood always holds its nearest point and the ones that bound it.
  const cols = Math.floor((w - 1) / sx) + 5, rows = Math.floor((h - 1) / sy) + 5, n = cols * rows;
  const px = new Float32Array(n), py = new Float32Array(n), pv = new Float32Array(n);
  for (let j = 0, k = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++, k++) {
      const at = (((i - 2) & 0xffff) << 16) | ((j - 2) & 0xffff);
      px[k] = i - 1.5 + jitter * (R(name, 'x', at) - 0.5);
      py[k] = j - 1.5 + jitter * (R(name, 'y', at) - 0.5);
      pv[k] = R(name, 'value', at);
    }
  }
  // Distances are measured in units of `scale`, each way on its own, so a
  // scale longer one way gives cells longer that way and the neighbourhood
  // of five by five lattice places still holds every point that matters.
  const value = new Float32Array(w * h), edge = new Float32Array(w * h), ox = new Float32Array(w * h), oy = new Float32Array(w * h);
  const near = new Int32Array(25), far = new Float32Array(25), short = Math.min(sx, sy);
  for (let y = 0, p = 0; y < h; y++) {
    const v = y / sy, cj = Math.floor(v);
    for (let x = 0; x < w; x++, p++) {
      const u = x / sx, ci = Math.floor(u);
      let best = 0, count = 0;
      for (let j = cj; j < cj + 5; j++) {
        for (let i = ci, k = j * cols + ci; i < ci + 5; i++, k++, count++) {
          near[count] = k;
          far[count] = (u - px[k]) ** 2 + (v - py[k]) ** 2;
          if (far[count] < far[best]) best = count;
        }
      }
      // The border with each other point is the line half way to it.
      const b = near[best];
      let border = Infinity;
      for (let c = 0; c < 25; c++) {
        if (c === best) continue;
        const k = near[c], gap = Math.hypot(px[k] - px[b], py[k] - py[b]);
        if (gap > 0) border = Math.min(border, (far[c] - far[best]) / (2 * gap));
      }
      value[p] = pv[b]; edge[p] = border * short; ox[p] = u - px[b]; oy[p] = v - py[b];
    }
  }
  return { value: { w, h, data: value }, edge: { w, h, data: edge }, x: { w, h, data: ox }, y: { w, h, data: oy } };
}

/**
 * `m` read through a bend: each cell takes the value found `reach` cells away
 * across and down, times how far `dx` and `dy` lie from 0.5 at that cell, so a
 * noise in [0, 1) bends evenly both ways. Read between cells; past an edge
 * the map is read mirrored, so a bend drags no smear in from the border.
 */
function warp(m, dx, dy, reach) {
  alike(m, dx, 'warp');
  alike(m, dy, 'warp');
  amount(reach, 'warp', 'reach');
  const { w, h, data } = m, out = new Float32Array(w * h);
  const mirror = (v, last) => { if (last === 0) return 0; const t = Math.abs(v) % (2 * last); return t > last ? 2 * last - t : t; };
  for (let y = 0, p = 0; y < h; y++) {
    for (let x = 0; x < w; x++, p++) {
      const u = mirror(x + reach * (dx.data[p] - 0.5), w - 1), v = mirror(y + reach * (dy.data[p] - 0.5), h - 1);
      const x0 = Math.floor(u), y0 = Math.floor(v), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), tx = u - x0;
      const top = data[y0 * w + x0] + (data[y0 * w + x1] - data[y0 * w + x0]) * tx, low = data[y1 * w + x0] + (data[y1 * w + x1] - data[y1 * w + x0]) * tx;
      out[p] = top + (low - top) * (v - y0);
    }
  }
  return { w, h, data: out };
}

/** `m` with `lo` moved to 0 and `hi` to 1, held between them, then raised to `gamma`. A `hi` under `lo` turns it over; the two close together make a mask. */
function levels(m, lo = 0, hi = 1, gamma = 1) {
  mapOf(m, 'levels');
  if (!(Number.isFinite(lo) && Number.isFinite(hi) && lo !== hi)) throw new RangeError(`levels: lo and hi must be two different finite numbers, got ${lo} and ${hi}`);
  if (!(gamma > 0 && Number.isFinite(gamma))) throw new RangeError(`levels: gamma must be a positive finite number, got ${gamma}`);
  const out = new Float32Array(m.data.length), k = 1 / (hi - lo);
  for (let p = 0; p < out.length; p++) {
    const v = Math.min(1, Math.max(0, (m.data[p] - lo) * k));
    out[p] = gamma === 1 ? v : v ** gamma;
  }
  return { w: m.w, h: m.h, data: out };
}

/**
 * `m` cut into `n` flat steps to a unit of height, as layers or terraces: a
 * height read through `shade` and `relief` then has a lit or dark riser where
 * each layer ends. `soft` (default 0.1, from 0 to 1) is the share of a step
 * its riser takes; 0 makes a wall.
 */
function steps(m, n, soft = 0.1) {
  mapOf(m, 'steps');
  if (!(n > 0 && Number.isFinite(n))) throw new RangeError(`steps: n must be a positive number of steps, got ${n}`);
  if (!(soft >= 0 && soft <= 1)) throw new RangeError(`steps: soft must be a share from 0 to 1, got ${soft}`);
  const out = new Float32Array(m.data.length);
  for (let p = 0; p < out.length; p++) {
    const t = m.data[p] * n, floor = Math.floor(t), r = soft === 0 ? 0 : Math.max(0, (t - floor - 1 + soft) / soft);
    out[p] = (floor + r * r * (3 - 2 * r)) / n;
  }
  return { w: m.w, h: m.h, data: out };
}

// One running mean of 2r + 1 cells along each of `count` lines, edges held.
function boxPass(src, dst, count, length, stride, step, r) {
  const scale = 1 / (2 * r + 1);
  for (let line = 0; line < count; line++) {
    const s = line * step, first = src[s], last = src[s + (length - 1) * stride];
    let sum = first * (r + 1);
    for (let k = 0; k < r; k++) sum += src[s + Math.min(length - 1, k) * stride];
    for (let k = 0; k < length; k++) {
      sum += (k + r < length ? src[s + (k + r) * stride] : last) - (k - r - 1 >= 0 ? src[s + (k - r - 1) * stride] : first);
      dst[s + k * stride] = sum * scale;
    }
  }
}

/** `m` blurred by about a Gaussian of `sigma` cells: three running means, so the cost does not grow with `sigma`. Edges held. */
function blur(m, sigma) {
  mapOf(m, 'blur');
  if (!(sigma >= 0 && Number.isFinite(sigma))) throw new RangeError(`blur: sigma must be a finite number of cells, 0 or more, got ${sigma}`);
  const { w, h } = m, ideal = Math.sqrt(4 * sigma * sigma + 1);
  let lower = Math.floor(ideal), a = Float32Array.from(m.data), b = new Float32Array(a.length);
  if (lower % 2 === 0) lower--;
  const few = Math.round((12 * sigma * sigma - 3 * lower * lower - 12 * lower - 9) / (-4 * lower - 4));
  for (let pass = 0; pass < 3; pass++) {
    const r = ((pass < few ? lower : lower + 2) - 1) / 2;
    if (r < 1) continue;
    boxPass(a, b, h, w, 1, w, r);
    boxPass(b, a, w, h, w, 1, r);
  }
  return { w, h, data: a };
}

/**
 * `m` dragged down the slopes of another map: each cell takes the fold of
 * the values found from it up the slope of `slope`, at `samples` places
 * (default 16, at most 64) along a line `reach` cells long (default 8) where
 * that slope is an average one, shorter where it is gentle and at most twice
 * as long where it is steep. `mode` is the fold: 'mean' (default) smears,
 * 'min' eats what is high away, 'max' spreads it. Wear made this way is
 * uneven and lopsided: a rough `slope` chips an edge, and a ramp drags
 * everything one way. A flat `slope` leaves `m` as it is.
 */
function slopeBlur(m, slope, opt = {}) {
  alike(m, slope, 'slopeBlur');
  const { reach = 8, samples = 16, mode = 'mean' } = opt;
  amount(reach, 'slopeBlur', 'reach');
  if (!(Number.isInteger(samples) && samples >= 1 && samples <= 64)) throw new RangeError(`slopeBlur: samples must be a whole number from 1 to 64, got ${samples}`);
  if (!['mean', 'min', 'max'].includes(mode)) throw new TypeError(`slopeBlur: mode must be 'mean', 'min' or 'max', got ${JSON.stringify(mode)}`);
  const { w, h, data } = m, s = slope.data, gx = new Float32Array(w * h), gy = new Float32Array(w * h), out = Float32Array.from(data);
  let square = 0;
  for (let y = 0, p = 0; y < h; y++) {
    const up = Math.max(0, y - 1) * w, down = Math.min(h - 1, y + 1) * w;
    for (let x = 0; x < w; x++, p++) {
      gx[p] = (s[y * w + Math.min(w - 1, x + 1)] - s[y * w + Math.max(0, x - 1)]) / 2;
      gy[p] = (s[down + x] - s[up + x]) / 2;
      square += gx[p] * gx[p] + gy[p] * gy[p];
    }
  }
  const average = Math.sqrt(square / (w * h));
  if (average === 0 || reach === 0) return { w, h, data: out };
  for (let y = 0, p = 0; y < h; y++) {
    for (let x = 0; x < w; x++, p++) {
      const steep = Math.hypot(gx[p], gy[p]), k = Math.min(2, steep / average) * reach / samples / (steep || 1);
      let fold = data[p];
      for (let i = 1; i <= samples; i++) {
        const u = Math.min(w - 1, Math.max(0, x + gx[p] * k * i)), v = Math.min(h - 1, Math.max(0, y + gy[p] * k * i));
        const x0 = Math.floor(u), y0 = Math.floor(v), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), tx = u - x0;
        const top = data[y0 * w + x0] + (data[y0 * w + x1] - data[y0 * w + x0]) * tx, low = data[y1 * w + x0] + (data[y1 * w + x1] - data[y1 * w + x0]) * tx;
        const found = top + (low - top) * (v - y0);
        fold = mode === 'mean' ? fold + found : mode === 'min' ? Math.min(fold, found) : Math.max(fold, found);
      }
      out[p] = mode === 'mean' ? fold / (samples + 1) : fold;
    }
  }
  return { w, h, data: out };
}

/** A map whose every cell is `fn` of the same cell of each map given: `combine((a, b) => a * b, height, mask)`. */
function combine(fn, ...maps) {
  if (typeof fn !== 'function' || maps.length === 0) throw new TypeError('combine: takes a function, then one map or more');
  for (const m of maps) alike(maps[0], m, 'combine');
  const [a, b, c] = maps.map((m) => m.data), out = new Float32Array(a.length);
  if (maps.length === 1) for (let p = 0; p < out.length; p++) out[p] = fn(a[p]);
  else if (maps.length === 2) for (let p = 0; p < out.length; p++) out[p] = fn(a[p], b[p]);
  else if (maps.length === 3) for (let p = 0; p < out.length; p++) out[p] = fn(a[p], b[p], c[p]);
  else for (let p = 0; p < out.length; p++) out[p] = fn(...maps.map((m) => m.data[p]));
  return { w: maps[0].w, h: maps[0].h, data: out };
}

/**
 * The light a height takes, 0 to 1: the cosine between each cell's facing and
 * `light`, [x, y, z] towards the lamp with y down the map and z out of it
 * (default [-1, -1, 1], from the upper left). `scale` (default 1) is how many
 * cells one unit of height stands: larger is a deeper relief. A flat cell
 * takes the lamp's own height, about 0.58 by default, so light and dark
 * slopes lie to either side of it.
 */
function shade(height, opt = {}) {
  mapOf(height, 'shade');
  const { light = [-1, -1, 1], scale = 1 } = opt;
  if (!(Array.isArray(light) && light.length === 3 && light.every(Number.isFinite) && Math.hypot(...light) > 0)) throw new RangeError('shade: light must be [x, y, z] towards the lamp, not all zero');
  amount(scale, 'shade', 'scale');
  const { w, h, data } = height, out = new Float32Array(w * h), n = Math.hypot(...light), lx = light[0] / n, ly = light[1] / n, lz = light[2] / n;
  for (let y = 0, p = 0; y < h; y++) {
    const up = Math.max(0, y - 1) * w, down = Math.min(h - 1, y + 1) * w;
    for (let x = 0; x < w; x++, p++) {
      const gx = (data[y * w + Math.min(w - 1, x + 1)] - data[y * w + Math.max(0, x - 1)]) * scale / 2, gy = (data[down + x] - data[up + x]) * scale / 2;
      out[p] = Math.max(0, (lz - gx * lx - gy * ly) / Math.sqrt(gx * gx + gy * gy + 1));
    }
  }
  return { w, h, data: out };
}

/** How far each cell of a height stands above its surroundings, `sigma` cells wide: over 0 on what stands out, where wear and light catch, and under 0 in the hollows, where dirt and shadow sit. */
function relief(height, sigma) {
  const soft = blur(mapOf(height, 'relief'), sigma);
  for (let p = 0; p < soft.data.length; p++) soft.data[p] = height.data[p] - soft.data[p];
  return soft;
}

// Display bytes to linear light, and linear light in 4096 steps back to bytes.
const LINEAR = Float32Array.from({ length: 256 }, (_, v) => toLinear(v / 255));
const BYTE = Uint8Array.from({ length: 4097 }, (_, v) => Math.round(toSRGB(v / 4096) * 255));
const byte = (linear) => BYTE[Math.round(Math.min(1, Math.max(0, linear)) * 4096)];

/**
 * The map as an image `show` draws, { w, h, channels: 3, data }: each cell's
 * value, held to 0..1, read through `stops`, colours from the one at 0 to the
 * one at 1, evenly spaced and mixed in linear light.
 */
function toImage(m, stops) {
  mapOf(m, 'toImage');
  if (!(Array.isArray(stops) && stops.length >= 1)) throw new TypeError('toImage: stops must be a list of one colour or more, such as [\'#2b2b2b\', \'#d8d2c4\']');
  const colours = stops.map((s) => rgb(s).slice(0, 3).map(toLinear)), STEPS = 1024, table = new Uint8Array((STEPS + 1) * 3);
  for (let k = 0; k <= STEPS; k++) {
    const u = k / STEPS * (colours.length - 1), i = Math.min(colours.length - 2, Math.floor(u)), a = colours[Math.max(0, i)], b = colours[i + 1] || a;
    for (let c = 0; c < 3; c++) table[k * 3 + c] = byte(a[c] + (b[c] - a[c]) * (u - i));
  }
  const data = new Uint8Array(m.data.length * 3);
  for (let p = 0; p < m.data.length; p++) {
    const k = Math.round(Math.min(1, Math.max(0, m.data[p])) * STEPS) * 3;
    data[p * 3] = table[k]; data[p * 3 + 1] = table[k + 1]; data[p * 3 + 2] = table[k + 2];
  }
  return { w: m.w, h: m.h, channels: 3, data };
}

/** The RGB image `img` with `colour` laid over it by `mask`: 0 leaves a pixel, 1 replaces it, mixed in linear light. A new image. */
function over(img, colour, mask) {
  mapOf(mask, 'over');
  if (!(img && img.data instanceof Uint8Array && img.channels === 3 && img.w === mask.w && img.h === mask.h)) throw new TypeError('over: takes an RGB image from toImage and a mask of its size');
  const tint = rgb(colour).slice(0, 3).map(toLinear), data = new Uint8Array(img.data.length);
  for (let p = 0; p < mask.data.length; p++) {
    const k = Math.min(1, Math.max(0, mask.data[p]));
    for (let c = 0; c < 3; c++) { const v = LINEAR[img.data[p * 3 + c]]; data[p * 3 + c] = k === 0 ? img.data[p * 3 + c] : byte(v + (tint[c] - v) * k); }
  }
  return { w: img.w, h: img.h, channels: 3, data };
}

module.exports = { fill, noise, cells, warp, levels, steps, blur, slopeBlur, combine, shade, relief, toImage, over };
