// Images a piece draws over, from or after.
//
// A piece declares each image as decoded pixels (`images` in core/piece.js):
// { w, h, channels, pixels, source, rights }, where `pixels` is base64 text of
// w x h x channels bytes, row by row, 8 bits per channel in sRGB, as
// `npm run image` writes it. Decoded bytes rather than PNG or JPEG, because
// base64 decodes the same way, synchronously, in Node and in every browser, so
// build and draw read the same numbers on every route, replay included.
//
// Nothing here knows what an image depicts. It reads pixels: a colour, a tone,
// a rectangle to fit, and the pixels themselves shown on a raster surface. It
// also reads the image as a whole, for a piece drawn after it: its dominant
// colours, its values, the way its structure runs and its blocks of colour.

'use strict';

const { sibling } = require('./layer.js');
const { hex, toLinear, toSRGB, oklabOfLinear } = require('./colour.js');

const KEYS = ['w', 'h', 'channels', 'pixels', 'source', 'rights'];
// A name `state.images.<name>` can be written with a dot.
const NAME = /^[a-z][a-zA-Z0-9]*$/;
// The most pixels one image may hold: 2^24, 64 MB as RGBA on a canvas, the
// budget one canvas keeps for sprites.
const MAX_PIXELS = 2 ** 24;
// The longest `source` or `rights`, so a manifest stays small.
const TEXT = 200;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

const named = (s) => typeof s === 'string' && s.trim() !== '' && s.length <= TEXT;

/** Why a declared `images` is invalid, or null. The validator for FIELDS.images. */
function check(v) {
  if (v === null) return null;
  if (!v || typeof v !== 'object' || Array.isArray(v) || !Object.keys(v).length) {
    return `must be null or { name: { ${KEYS.join(', ')} } }`;
  }
  for (const [name, img] of Object.entries(v)) {
    if (!NAME.test(name)) return `${JSON.stringify(name)} must be a name of letters and digits that starts with a lowercase letter, such as photo or ground2`;
    const at = `images.${name}`;
    if (!img || typeof img !== 'object' || Array.isArray(img)) return `${at} must be { ${KEYS.join(', ')} }`;
    const extra = Object.keys(img).filter((k) => !KEYS.includes(k));
    if (extra.length) return `${at}: unknown key(s): ${extra.join(', ')}; known: ${KEYS.join(', ')}`;
    for (const k of ['w', 'h']) {
      if (!(Number.isInteger(img[k]) && img[k] > 0)) return `${at}.${k} must be a positive whole number of pixels`;
    }
    if (img.w * img.h > MAX_PIXELS) return `${at} is ${img.w} x ${img.h} = ${img.w * img.h} pixels, over the ${MAX_PIXELS} one image may hold`;
    if (![1, 3, 4].includes(img.channels)) return `${at}.channels must be 1 (grey), 3 (RGB) or 4 (RGBA)`;
    const n = img.w * img.h * img.channels;
    if (typeof img.pixels !== 'string' || img.pixels.length % 4 || !BASE64.test(img.pixels)) {
      return `${at}.pixels is not base64 text; npm run image writes it`;
    }
    // The bytes the text holds, from its length and padding, so a wrong size is refused without decoding it.
    const holds = img.pixels.length / 4 * 3 - (img.pixels.endsWith('==') ? 2 : img.pixels.endsWith('=') ? 1 : 0);
    if (holds !== n) return `${at}.pixels must be base64 text of ${img.w} x ${img.h} x ${img.channels} = ${n} bytes; it holds ${holds}`;
    if (!named(img.source)) return `${at}.source must name where the image came from, such as the user's own photo or a URL, in at most ${TEXT} characters`;
    if (!named(img.rights)) return `${at}.rights must say whose the image is and on what terms, as the user gave them, in at most ${TEXT} characters; the library grants none`;
  }
  return null;
}

// Per declaration: its base64 text, the bytes it decodes to and their digest,
// each made once and kept while the declaration lives.
const decoded = new WeakMap();

function entry(img) {
  let e = decoded.get(img);
  if (!e || e.pixels !== img.pixels) {
    const text = atob(img.pixels);
    const data = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) data[i] = text.charCodeAt(i);
    decoded.set(img, e = { pixels: img.pixels, data, digest: null });
  }
  return e;
}

/** FNV-1a, 32 bits, over `bytes`, as 'fnv1a32:' and 8 hex digits. It tells one image from another; it proves nothing about forgery. */
function digest(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193);
  return 'fnv1a32:' + (h >>> 0).toString(16).padStart(8, '0');
}

/** The validated `images` as a solve hands them to build and draw: each with a fresh copy of its bytes as `data`. */
function solved(images) {
  const out = {};
  for (const [name, img] of Object.entries(images)) {
    out[name] = { w: img.w, h: img.h, channels: img.channels, data: entry(img).data.slice(), source: img.source, rights: img.rights };
  }
  return out;
}

/** The validated `images` as a manifest records them: size, channels, digest, source and rights, never the pixels. */
function describe(images) {
  const out = {};
  for (const [name, img] of Object.entries(images)) {
    const e = entry(img);
    if (e.digest === null) e.digest = digest(e.data);
    out[name] = { w: img.w, h: img.h, channels: img.channels, digest: e.digest, source: img.source, rights: img.rights };
  }
  return out;
}

function pixelsOf(img, who) {
  if (!img || !(img.data instanceof Uint8Array)) throw new TypeError(`${who}: takes an image of the solved state, such as state.images.photo`);
}

/**
 * The colour at (u, v), each in [0, 1] across the image, as [r, g, b, a] in
 * 0-255: read bilinearly between pixel centres and clamped at the edges. A grey
 * image gives r = g = b, and one with no alpha channel a = 255.
 */
function sample(img, u, v) {
  pixelsOf(img, 'sample');
  if (!Number.isFinite(u) || !Number.isFinite(v)) throw new RangeError(`sample: u and v must be finite numbers, got ${u}, ${v}`);
  const { w, h, channels: n, data } = img;
  const x = Math.min(w - 1, Math.max(0, u * w - 0.5));
  const y = Math.min(h - 1, Math.max(0, v * h - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const a = (y0 * w + x0) * n, b = (y0 * w + x1) * n, c = (y1 * w + x0) * n, d = (y1 * w + x1) * n;
  const at = (k) => {
    const top = data[a + k] + (data[b + k] - data[a + k]) * fx;
    const low = data[c + k] + (data[d + k] - data[c + k]) * fx;
    return top + (low - top) * fy;
  };
  if (n === 1) { const g = at(0); return [g, g, g, 255]; }
  return [at(0), at(1), at(2), n === 4 ? at(3) : 255];
}

/** The tone at (u, v) in [0, 1]: luma with Rec. 709 weights on the sRGB values, read as `sample` reads. */
function tone(img, u, v) {
  const [r, g, b] = sample(img, u, v);
  return img.channels === 1 ? r / 255 : Math.min(1, (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255);
}

/**
 * The tone as a field (x, y) => [0, 1] in design units, with the image laid on
 * `rect`, [x, y, w, h] (default [0, 0, 1, 1]): what core/field.js takes, so
 * sampleGrid and isolines give contours, gradient edges, and streamlines
 * strokes that follow the image. Outside `rect` it holds the edge's tone.
 */
function toneField(img, rect = [0, 0, 1, 1]) {
  pixelsOf(img, 'toneField');
  const [rx, ry, rw, rh] = rect;
  return (x, y) => tone(img, (x - rx) / rw, (y - ry) / rh);
}

/**
 * Where the image lies to 'cover' `box`, [x, y, w, h] in design units, cut on
 * one axis, or to sit whole inside it ('contain'), centred either way, as
 * [x, y, w, h]. It takes a declared image or a solved one.
 */
function fit(img, box, mode = 'cover') {
  if (!(img && Number.isInteger(img.w) && img.w > 0 && Number.isInteger(img.h) && img.h > 0)) {
    throw new TypeError('fit: takes an image of the solved state, such as state.images.photo, or a declared one');
  }
  if (mode !== 'cover' && mode !== 'contain') throw new TypeError(`fit: mode must be 'cover' or 'contain', got ${JSON.stringify(mode)}`);
  if (!(Array.isArray(box) && box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0)) {
    throw new RangeError('fit: box must be [x, y, w, h] with a positive size');
  }
  const [x, y, w, h] = box;
  const k = (mode === 'cover' ? Math.max : Math.min)(w / img.w, h / img.h);
  return [x + (w - img.w * k) / 2, y + (h - img.h * k) / 2, img.w * k, img.h * k];
}

// Per solved image's bytes, then per target canvas: a canvas holding its
// pixels. Keyed by the solved bytes, so a build that changed them shows them
// changed, and each solve has its own.
const shown = new WeakMap();

/**
 * Draw the image's pixels on a raster surface at [x, y, w, h] in its current
 * units, smoothed at high quality, with the caller's alpha, blend and clip.
 * The pixels are put on a canvas of their own once per solve and target
 * canvas. A vector surface refuses by name: an SVG has no pixels, so a piece
 * that claims 'vector' calls show under `if (g.canvas)` and its SVG keeps the
 * marks alone. A vector surface that takes drawImage, such as the one
 * recordMarks (tools/contact-sheet.js) records paint order on, gets one
 * drawImage of the image's size there. On another surface without a canvas,
 * such as the benchmark's null surface, it draws nothing, as the film finish does.
 */
function show(g, img, x, y, w, h) {
  pixelsOf(img, 'show');
  if (![x, y, w, h].every(Number.isFinite)) throw new RangeError(`show: x, y, w and h must be finite numbers, got ${x}, ${y}, ${w}, ${h}`);
  const canvas = g.canvas;
  if (!canvas || typeof g.drawImage !== 'function') {
    if (g.kind !== 'vector') return;
    try {
      g.drawImage({ width: img.w, height: img.h }, x, y, w, h);
      return;
    } catch {
      throw new Error('show: a vector surface has no pixels, so it cannot show an image. Call show under if (g.canvas) so the SVG keeps the marks alone, or declare outputs: ["raster"]');
    }
  }
  let copies = shown.get(img.data);
  if (!copies) shown.set(img.data, copies = new WeakMap());
  let copy = copies.get(canvas);
  if (!copy) copies.set(canvas, copy = pixelCanvas(g, img));
  g.save();
  try {
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(copy, x, y, w, h);
  } finally {
    g.restore();
  }
}

/** A canvas of the target's kind holding the image's pixels as RGBA. */
function pixelCanvas(g, img) {
  const c = sibling(g.canvas, img.w, img.h);
  if (!c) throw new Error('show: this surface\'s canvas has no document and there is no OffscreenCanvas, so the image has no canvas to go on');
  // Backed as the target is: a copy between a CPU-backed and a GPU-backed canvas can shift a colour by a few levels.
  const attrs = typeof g.getContextAttributes === 'function' ? g.getContextAttributes() : {};
  const cg = c.getContext('2d', { willReadFrequently: attrs.willReadFrequently });
  const out = cg.createImageData(img.w, img.h);
  const px = out.data, src = img.data, n = img.channels;
  for (let i = 0, j = 0; i < px.length; i += 4, j += n) {
    px[i] = src[j];
    px[i + 1] = src[n === 1 ? j : j + 1];
    px[i + 2] = src[n === 1 ? j : j + 2];
    px[i + 3] = n === 4 ? src[j + 3] : 255;
  }
  cg.putImageData(out, 0, 0);
  return c;
}

// A colour seeds a cluster only when its neighbourhood of bins holds this share
// of the opaque pixels, so anti-aliased edge colours never become clusters of
// their own; a seed nearer than SAME (sRGB units) to another is not taken.
const SEED_SHARE = 0.001;
const SAME = 16;

/**
 * Up to `k` dominant colours of the opaque pixels (alpha 128 or more) of
 * `data`, w x h x channels bytes, largest first: `{ transparent, clusters:
 * [{ rgb, pixels }], label }`, where `label` gives each pixel its cluster's
 * index, or 255 for a transparent pixel. Deterministic: 5-bit-per-channel bins
 * seeded farthest-first, then k-means.
 */
function clusters(data, w, h, k, channels = 4) {
  const n = w * h, label = new Uint8Array(n).fill(255);
  const count = new Float64Array(32768), sum = new Float64Array(32768 * 3);
  const green = channels === 1 ? 0 : 1, blue = channels === 1 ? 0 : 2;
  const binOf = (o) => (data[o] >> 3) << 10 | (data[o + green] >> 3) << 5 | data[o + blue] >> 3;
  const seen = (o) => channels !== 4 || data[o + 3] >= 128;
  let opaque = 0;
  for (let o = 0; o < n * channels; o += channels) {
    if (!seen(o)) continue;
    const bin = binOf(o);
    count[bin]++; sum[bin * 3] += data[o]; sum[bin * 3 + 1] += data[o + green]; sum[bin * 3 + 2] += data[o + blue];
    opaque++;
  }
  const bins = [];
  for (let i = 0; i < 32768; i++) if (count[i]) bins.push(i);
  const mean = (i) => [sum[i * 3] / count[i], sum[i * 3 + 1] / count[i], sum[i * 3 + 2] / count[i]];
  const means = new Map(bins.map((i) => [i, mean(i)]));
  const d2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
  // Pixels in a bin and its 26 neighbours, about 24 levels a channel.
  const near = (i) => {
    let total = 0;
    const r = i >> 10, g = (i >> 5) & 31, b = i & 31;
    for (let dr = Math.max(0, r - 1); dr <= Math.min(31, r + 1); dr++) {
      for (let dg = Math.max(0, g - 1); dg <= Math.min(31, g + 1); dg++) {
        for (let db = Math.max(0, b - 1); db <= Math.min(31, b + 1); db++) total += count[dr << 10 | dg << 5 | db];
      }
    }
    return total;
  };

  const centres = [];
  if (bins.length) {
    let first = bins[0];
    for (const i of bins) if (count[i] > count[first]) first = i;
    centres.push(means.get(first));
    const eligible = bins.filter((i) => near(i) >= SEED_SHARE * opaque);
    while (centres.length < k) {
      let best = -1, far = -1;
      for (const i of eligible) {
        let d = Infinity;
        for (const c of centres) d = Math.min(d, d2(means.get(i), c));
        if (d > far) { far = d; best = i; }
      }
      if (far < SAME * SAME) break;
      centres.push(means.get(best));
    }
  }

  const cluster = new Int32Array(32768).fill(-1);
  for (let round = 0; round < 32; round++) {
    let changed = false;
    for (const i of bins) {
      let best = 0, d = Infinity;
      centres.forEach((c, j) => { const e = d2(means.get(i), c); if (e < d) { d = e; best = j; } });
      if (cluster[i] !== best) { cluster[i] = best; changed = true; }
    }
    if (!changed) break;
    const acc = centres.map(() => [0, 0, 0, 0]);
    for (const i of bins) {
      const a = acc[cluster[i]];
      a[0] += sum[i * 3]; a[1] += sum[i * 3 + 1]; a[2] += sum[i * 3 + 2]; a[3] += count[i];
    }
    acc.forEach((a, j) => { if (a[3]) centres[j] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; });
  }

  const acc = centres.map((c, j) => ({ j, centre: c, r: 0, g: 0, b: 0, pixels: 0 }));
  for (const i of bins) {
    const a = acc[cluster[i]];
    a.r += sum[i * 3]; a.g += sum[i * 3 + 1]; a.b += sum[i * 3 + 2]; a.pixels += count[i];
  }
  const kept = acc.filter((a) => a.pixels).sort((p, q) => q.pixels - p.pixels
    || p.centre[0] - q.centre[0] || p.centre[1] - q.centre[1] || p.centre[2] - q.centre[2]);
  const relabel = new Int32Array(centres.length);
  kept.forEach((a, index) => { relabel[a.j] = index; });
  for (let p = 0, o = 0; p < n; p++, o += channels) if (seen(o)) label[p] = relabel[cluster[binOf(o)]];
  return {
    transparent: n - opaque,
    clusters: kept.map((a) => ({ rgb: [a.r, a.g, a.b].map((v) => Math.round(v / a.pixels)), pixels: a.pixels })),
    label,
  };
}

/**
 * The image's dominant colours, at most `k` (default 8), largest first, as
 * [{ colour: '#rrggbb', share }], where the shares of the opaque pixels (alpha
 * 128 or more) add up to 1. It keeps no position: two images of the same
 * colours in other places give the same palette. An image with no opaque
 * pixel gives [].
 */
function palette(img, k = 8) {
  pixelsOf(img, 'palette');
  if (!(Number.isInteger(k) && k >= 1 && k <= 64)) throw new RangeError(`palette: k must be a whole number from 1 to 64, got ${k}`);
  const found = clusters(img.data, img.w, img.h, k, img.channels);
  const opaque = img.w * img.h - found.transparent;
  return found.clusters.map((c) => ({ colour: hex(c.rgb.map((v) => v / 255)), share: c.pixels / opaque }));
}

// A byte of sRGB as linear light.
const LINEAR = Float32Array.from({ length: 256 }, (_, i) => toLinear(i / 255));
// The most pixels `values` reads: a larger image is read on an even grid.
const SAMPLES = 2 ** 18;

/**
 * The image's values: its OKLab lightness, 0 to 1, at each share in `at`
 * (default [0.05, 0.25, 0.5, 0.75, 0.95]) of its opaque pixels sorted from
 * dark to light. So [0.05, 0.95] is the range a picture after it keeps, and
 * 0.5 its middle value. It keeps no position. An image over 2^18 pixels is
 * read on an even grid of at most that many.
 */
function values(img, at = [0.05, 0.25, 0.5, 0.75, 0.95]) {
  pixelsOf(img, 'values');
  if (!(Array.isArray(at) && at.length && at.every((q) => Number.isFinite(q) && q >= 0 && q <= 1))) {
    throw new RangeError('values: at must be a list of shares from 0 to 1, such as [0.05, 0.5, 0.95]');
  }
  const { w, h, channels: n, data } = img;
  const step = Math.max(1, Math.ceil(Math.sqrt(w * h / SAMPLES)));
  const green = n === 1 ? 0 : 1, blue = n === 1 ? 0 : 2, found = [];
  for (let y = step >> 1; y < h; y += step) {
    for (let x = step >> 1; x < w; x += step) {
      const o = (y * w + x) * n;
      if (n === 4 && data[o + 3] < 128) continue;
      found.push(oklabOfLinear([LINEAR[data[o]], LINEAR[data[o + green]], LINEAR[data[o + blue]]])[0]);
    }
  }
  if (!found.length) throw new RangeError('values: the image has no opaque pixel to read');
  const sorted = Float64Array.from(found).sort();
  return at.map((q) => {
    const p = q * (sorted.length - 1), i = Math.floor(p);
    return sorted[i] + (sorted[Math.min(sorted.length - 1, i + 1)] - sorted[i]) * (p - i);
  });
}

// Per solved image's bytes, then per size: the image averaged in linear light
// onto a grid whose longer side is `size` cells, as linear RGB and as OKLab.
// The fields below read this grid, not the pixels, so their cost does not grow
// with the image. Bytes changed after the first read are not read again.
const reductions = new WeakMap();
// The grids one image keeps, and the tensors one grid keeps: the last few
// asked for, so a piece that varies `size` or `smooth` by the frame holds no more.
const KEPT = 4;

/** `map`'s value for `key`, made by `make` when it holds none, dropping its oldest past KEPT. */
function kept(map, key, make) {
  let value = map.get(key);
  if (value === undefined) {
    if (map.size >= KEPT) map.delete(map.keys().next().value);
    map.set(key, value = make());
  }
  return value;
}

function reduced(img, size, who) {
  if (!(Number.isInteger(size) && size >= 16 && size <= 512)) throw new RangeError(`${who}: size must be a whole number of cells from 16 to 512, got ${size}`);
  let sizes = reductions.get(img.data);
  if (!sizes) reductions.set(img.data, sizes = new Map());
  return kept(sizes, size, () => reduce(img, size));
}

function reduce(img, size) {
  const { w, h, channels: n, data } = img;
  const k = Math.min(1, size / Math.max(w, h));
  const cols = Math.max(1, Math.round(w * k)), rows = Math.max(1, Math.round(h * k));
  const lin = new Float32Array(cols * rows * 3), lab = new Float32Array(cols * rows * 3);
  const green = n === 1 ? 0 : 1, blue = n === 1 ? 0 : 2;
  for (let j = 0; j < rows; j++) {
    const y0 = Math.floor(j * h / rows), y1 = Math.max(y0 + 1, Math.floor((j + 1) * h / rows));
    for (let i = 0; i < cols; i++) {
      const x0 = Math.floor(i * w / cols), x1 = Math.max(x0 + 1, Math.floor((i + 1) * w / cols));
      let r = 0, g = 0, b = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0, o = (y * w + x0) * n; x < x1; x++, o += n) { r += LINEAR[data[o]]; g += LINEAR[data[o + green]]; b += LINEAR[data[o + blue]]; }
      }
      const area = (y1 - y0) * (x1 - x0), c = (j * cols + i) * 3;
      lin[c] = r / area; lin[c + 1] = g / area; lin[c + 2] = b / area;
      lab.set(oklabOfLinear([lin[c], lin[c + 1], lin[c + 2]]), c);
    }
  }
  return { cols, rows, lin, lab, tensors: new Map() };
}

/** `a`, cols x rows, blurred by a Gaussian of `sigma` cells, its edges held. */
function blur(a, cols, rows, sigma) {
  if (!(sigma > 0)) return a;
  const radius = Math.ceil(sigma * 3), kernel = new Float32Array(radius * 2 + 1);
  let total = 0;
  for (let i = -radius; i <= radius; i++) total += kernel[i + radius] = Math.exp(-(i * i) / (2 * sigma * sigma));
  const across = new Float32Array(a.length), out = new Float32Array(a.length);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let s = 0;
      for (let i = -radius; i <= radius; i++) s += kernel[i + radius] * a[y * cols + Math.min(cols - 1, Math.max(0, x + i))];
      across[y * cols + x] = s / total;
    }
  }
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let s = 0;
      for (let i = -radius; i <= radius; i++) s += kernel[i + radius] * across[Math.min(rows - 1, Math.max(0, y + i)) * cols + x];
      out[y * cols + x] = s / total;
    }
  }
  return out;
}

// The structure tensor of a colour image (Di Zenzo 1986): per cell, the sums
// over the three OKLab channels of gx*gx, gx*gy and gy*gy, each then blurred,
// so a cell knows how its neighbourhood changes and along which line.
function tensor(grid, smooth) {
  return kept(grid.tensors, smooth, () => tensorOf(grid, smooth));
}

function tensorOf(grid, smooth) {
  const { cols, rows, lab } = grid, n = cols * rows;
  const jxx = new Float32Array(n), jxy = new Float32Array(n), jyy = new Float32Array(n);
  for (let y = 0; y < rows; y++) {
    const up = Math.max(0, y - 1), down = Math.min(rows - 1, y + 1);
    for (let x = 0; x < cols; x++) {
      const left = Math.max(0, x - 1), right = Math.min(cols - 1, x + 1), p = y * cols + x;
      for (let c = 0; c < 3; c++) {
        const gx = (lab[(y * cols + right) * 3 + c] - lab[(y * cols + left) * 3 + c]) / 2;
        const gy = (lab[(down * cols + x) * 3 + c] - lab[(up * cols + x) * 3 + c]) / 2;
        jxx[p] += gx * gx; jxy[p] += gx * gy; jyy[p] += gy * gy;
      }
    }
  }
  const sigma = smooth * Math.max(cols, rows);
  return { jxx: blur(jxx, cols, rows, sigma), jxy: blur(jxy, cols, rows, sigma), jyy: blur(jyy, cols, rows, sigma) };
}

// Under this much change, summed over a neighbourhood, a cell is flat.
const FLAT = 1e-7;

/**
 * The way the image's structure runs, as a field (x, y) => [vx, vy] in design
 * units with the image laid on `rect`, [x, y, w, h] (default [0, 0, 1, 1]). The
 * vector lies along the line of least change, so along an edge, a grain or a
 * fold, never across it. Its length is the coherence, 0 to 1: near 1 where the
 * neighbourhood runs one way, near 0 where it runs every way, and [0, 0] where
 * the image is flat. It is an orientation: a vector and its opposite mean the
 * same line, so walk it with `axial: true`. `opt.smooth` (default 0.015, at
 * most 0.1) is the neighbourhood's size as a share of the image's longer
 * side: a feature much smaller than it is averaged into what surrounds it.
 * `opt.size` (default 384) is the cells along that side the image is read on.
 * Alpha is not read. Outside `rect` it holds the edge's value.
 */
function structureField(img, rect = [0, 0, 1, 1], opt = {}) {
  pixelsOf(img, 'structureField');
  const { smooth = 0.015, size = 384 } = opt;
  if (!(Array.isArray(rect) && rect.length === 4 && rect.every(Number.isFinite) && rect[2] > 0 && rect[3] > 0)) {
    throw new RangeError('structureField: rect must be [x, y, w, h] with a positive size');
  }
  if (!(Number.isFinite(smooth) && smooth >= 0 && smooth <= 0.1)) throw new RangeError(`structureField: smooth must be a share from 0 to 0.1 of the image's longer side, got ${smooth}`);
  const grid = reduced(img, size, 'structureField'), { cols, rows } = grid, { jxx, jxy, jyy } = tensor(grid, smooth);
  const [rx, ry, rw, rh] = rect, kx = rw / cols, ky = rh / rows;
  return (x, y) => {
    const px = Math.min(cols - 1, Math.max(0, (x - rx) / rw * cols - 0.5)), py = Math.min(rows - 1, Math.max(0, (y - ry) / rh * rows - 0.5));
    const x0 = Math.floor(px), y0 = Math.floor(py), x1 = Math.min(cols - 1, x0 + 1), y1 = Math.min(rows - 1, y0 + 1), fx = px - x0, fy = py - y0;
    const at = (a) => {
      const top = a[y0 * cols + x0] + (a[y0 * cols + x1] - a[y0 * cols + x0]) * fx;
      const low = a[y1 * cols + x0] + (a[y1 * cols + x1] - a[y1 * cols + x0]) * fx;
      return top + (low - top) * fy;
    };
    const a = at(jxx), b = at(jxy), c = at(jyy), trace = a + c;
    if (!(trace > FLAT)) return [0, 0];
    // The tensor's main axis is the line of most change; the structure runs square to it.
    const coherence = Math.min(1, Math.hypot(a - c, 2 * b) / trace), angle = 0.5 * Math.atan2(2 * b, a - c) + Math.PI / 2;
    const vx = Math.cos(angle) * kx, vy = Math.sin(angle) * ky, length = Math.hypot(vx, vy);
    return [coherence * vx / length, coherence * vy / length];
  };
}

/** How far, root mean square in OKLab, the grid's cells lie from their mean colour. */
function spread(lab, cells) {
  const mean = [0, 0, 0];
  for (let p = 0; p < cells * 3; p++) mean[p % 3] += lab[p] / cells;
  let total = 0;
  for (let p = 0; p < cells * 3; p++) total += (lab[p] - mean[p % 3]) ** 2;
  return Math.sqrt(total / cells);
}

/**
 * The image cut into about `n` (default 64) blocks of like colour that hold
 * together, by growing them all at once from an even grid of seeds, nearest
 * first in colour and place (SNIC, Achanta and Süsstrunk 2017). Returns
 * `{ cols, rows, label, regions, at }`: `label` gives each cell of the cols x
 * rows grid its block's index, `at(u, v)` the block at a point of the image,
 * and `regions` each block's `{ colour, share, centre: [u, v], box: [u0, v0,
 * u1, v1] }`, in seed order, row by row. `opt.compactness` weighs place
 * against colour, in OKLab units: higher gives squarer blocks, lower ones that
 * follow the colour. By default it is half the image's colour spread, so a
 * quiet image and a loud one are both cut along their colours. `opt.size`
 * (default 192) is the grid's longer side; there is at most one block a cell.
 * Alpha is not read.
 */
function regions(img, n = 64, opt = {}) {
  pixelsOf(img, 'regions');
  const { size = 192 } = opt;
  if (!(Number.isInteger(n) && n >= 1 && n <= 4096)) throw new RangeError(`regions: n must be a whole number from 1 to 4096, got ${n}`);
  const { cols, rows, lin, lab } = reduced(img, size, 'regions'), cells = cols * rows;
  const compactness = opt.compactness === undefined ? Math.max(0.01, spread(lab, cells) / 2) : opt.compactness;
  if (!(Number.isFinite(compactness) && compactness > 0)) throw new RangeError(`regions: compactness must be positive and finite, got ${compactness}`);
  // Seeds on an even grid of about n: rows first from the shape, then columns from the rows that fit.
  const down = Math.min(rows, Math.max(1, Math.round(n / Math.min(cols, Math.max(1, Math.round(Math.sqrt(n * cols / rows)))))));
  const across = Math.min(cols, Math.max(1, Math.round(n / down)));
  const count = across * down, spacing2 = cells / count, colour2 = compactness * compactness;
  const label = new Int32Array(cells).fill(-1);
  // Per block: sums of OKLab, of linear RGB and of place, its cells and its box.
  const sum = new Float64Array(count * 8), held = new Int32Array(count), box = new Int32Array(count * 4);
  // A min-heap on distance; equal distances leave in the order they came.
  const hd = [], hp = [], hk = [], hs = [];
  let pushed = 0;
  const less = (i, j) => hd[i] < hd[j] || (hd[i] === hd[j] && hs[i] < hs[j]);
  const swap = (i, j) => {
    let t = hd[i]; hd[i] = hd[j]; hd[j] = t;
    t = hp[i]; hp[i] = hp[j]; hp[j] = t;
    t = hk[i]; hk[i] = hk[j]; hk[j] = t;
    t = hs[i]; hs[i] = hs[j]; hs[j] = t;
  };
  const push = (d, p, k) => {
    let i = hd.length;
    hd.push(d); hp.push(p); hk.push(k); hs.push(pushed++);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (!less(i, up)) break;
      swap(i, up); i = up;
    }
  };
  const pop = () => {
    const last = hd.length - 1;
    swap(0, last);
    hd.pop(); hp.pop(); hk.pop(); hs.pop();
    for (let i = 0; ;) {
      const a = i * 2 + 1, b = a + 1;
      let least = i;
      if (a < last && less(a, least)) least = a;
      if (b < last && less(b, least)) least = b;
      if (least === i) break;
      swap(i, least); i = least;
    }
  };
  for (let j = 0; j < down; j++) {
    for (let i = 0; i < across; i++) push(0, Math.floor((j + 0.5) * rows / down) * cols + Math.floor((i + 0.5) * cols / across), j * across + i);
  }
  while (hd.length) {
    const p = hp[0], k = hk[0];
    pop();
    if (label[p] !== -1) continue;
    label[p] = k;
    const x = p % cols, y = (p - x) / cols, s = k * 8;
    for (let c = 0; c < 3; c++) { sum[s + c] += lab[p * 3 + c]; sum[s + 3 + c] += lin[p * 3 + c]; }
    sum[s + 6] += x; sum[s + 7] += y;
    if (!held[k]++) { box[k * 4] = box[k * 4 + 2] = x; box[k * 4 + 1] = box[k * 4 + 3] = y; }
    box[k * 4] = Math.min(box[k * 4], x); box[k * 4 + 1] = Math.min(box[k * 4 + 1], y);
    box[k * 4 + 2] = Math.max(box[k * 4 + 2], x); box[k * 4 + 3] = Math.max(box[k * 4 + 3], y);
    const m = held[k];
    for (const [qx, qy] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (qx < 0 || qy < 0 || qx >= cols || qy >= rows) continue;
      const q = qy * cols + qx;
      if (label[q] !== -1) continue;
      const dl = lab[q * 3] - sum[s] / m, da = lab[q * 3 + 1] - sum[s + 1] / m, db = lab[q * 3 + 2] - sum[s + 2] / m;
      const dx = qx - sum[s + 6] / m, dy = qy - sum[s + 7] / m;
      push((dl * dl + da * da + db * db) / colour2 + (dx * dx + dy * dy) / spacing2, q, k);
    }
  }
  const found = [];
  for (let k = 0; k < count; k++) {
    const s = k * 8, m = held[k];
    found.push({
      colour: hex([toSRGB(sum[s + 3] / m), toSRGB(sum[s + 4] / m), toSRGB(sum[s + 5] / m)]),
      share: m / cells,
      centre: [(sum[s + 6] / m + 0.5) / cols, (sum[s + 7] / m + 0.5) / rows],
      box: [box[k * 4] / cols, box[k * 4 + 1] / rows, (box[k * 4 + 2] + 1) / cols, (box[k * 4 + 3] + 1) / rows],
    });
  }
  const at = (u, v) => label[Math.min(rows - 1, Math.max(0, Math.floor(v * rows))) * cols + Math.min(cols - 1, Math.max(0, Math.floor(u * cols)))];
  return { cols, rows, label, regions: found, at };
}

module.exports = { check, digest, solved, describe, sample, tone, toneField, fit, show, clusters, palette, values, structureField, regions, MAX_PIXELS };
