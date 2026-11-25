'use strict';

// Measures a reference PNG: its pixel size, its dominant colours with their
// pixel shares, and each colour region's outlines as simplified point lists,
// printed as JSON. A piece fits its own shapes to the measured points; this tool
// never writes a picture, an SVG or per-pixel data, so the piece stays solved,
// not traced. Node built-ins only: the PNG is inflated with node:zlib.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { bbox } = require('../core/geom.js');
const { clusters } = require('../core/image.js');
const { callerDirectory, shown } = require('./piece-input.js');

const USAGE = 'usage: npm run measure -- <reference.png> [--colors N] [--tolerance px] [--min-area px] [--out file.json]';
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_PIXELS = 50000000;
// The bit depths each PNG colour type allows, and its samples per pixel.
const DEPTHS = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** A PNG's pixels as `{ w, h, rgba }`, 8 bits per channel; `name` names the file in refusals. */
function decodePng(bytes, name) {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at, s) => b.toString('latin1', at, at + s.length) === s;
  if (b.length < 8 || SIGNATURE.some((v, i) => b[i] !== v)) {
    const format = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'a JPEG' : text(0, 'RIFF') && text(8, 'WEBP') ? 'a WebP' : text(0, 'GIF8') ? 'a GIF' : null;
    throw new Error(format ? `measure: ${name} is ${format} image; this tool reads PNG only, so save the reference as PNG first` : `measure: ${name} is not a PNG file`);
  }
  const invalid = (what) => new Error(`measure: ${name} is not a valid PNG: ${what}`);
  let w = 0, h = 0, depth = 0, type = 0, plte = null, trns = null;
  const idat = [];
  for (let at = 8; ;) {
    if (at + 8 > b.length) throw invalid('it ends before its IEND chunk');
    const length = b.readUInt32BE(at);
    const chunk = b.toString('latin1', at + 4, at + 8);
    const data = b.subarray(at + 8, at + 8 + length);
    if (data.length < length) throw invalid(`its ${chunk} chunk is cut short`);
    if (at === 8 && chunk !== 'IHDR') throw invalid('it does not start with an IHDR chunk');
    if (chunk === 'IHDR') {
      if (length !== 13) throw invalid('its IHDR chunk is not 13 bytes');
      w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9];
      if (!w || !h) throw invalid(`it is ${w} x ${h} pixels`);
      if (!DEPTHS[type]) throw invalid(`colour type ${type} is not one PNG defines`);
      if (!DEPTHS[type].includes(depth)) throw invalid(`colour type ${type} does not allow bit depth ${depth}`);
      if (data[12] === 1) throw new Error(`measure: ${name} is an interlaced PNG, which this tool does not read; save it without interlacing`);
      if (w * h > MAX_PIXELS) throw new Error(`measure: ${name} is ${w} x ${h}, over the ${MAX_PIXELS}-pixel limit; scale it down first`);
    } else if (chunk === 'PLTE') plte = data;
    else if (chunk === 'tRNS') trns = data;
    else if (chunk === 'IDAT') idat.push(data);
    else if (chunk === 'IEND') break;
    at += 12 + length;
  }
  if (!idat.length) throw invalid('it has no IDAT chunk');
  if (type === 3 && !plte) throw invalid('it has no palette');
  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(idat)); } catch { throw invalid('its image data does not inflate'); }
  const channels = CHANNELS[type];
  const stride = Math.ceil(w * channels * depth / 8);
  const bpp = Math.max(1, (channels * depth) >> 3);
  if (raw.length < h * (stride + 1)) throw invalid('its image data is cut short');

  // Undo each row's filter: 0 None, 1 Sub, 2 Up, 3 Average, 4 Paeth. Uint8 stores wrap mod 256.
  const data = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    if (filter > 4) throw invalid(`row ${y} has filter type ${filter}`);
    const src = y * (stride + 1) + 1, row = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? data[row + i - bpp] : 0;
      const u = y ? data[row - stride + i] : 0;
      let v = raw[src + i];
      if (filter === 1) v += a;
      else if (filter === 2) v += u;
      else if (filter === 3) v += (a + u) >> 1;
      else if (filter === 4) {
        const c = i >= bpp && y ? data[row - stride + i - bpp] : 0;
        const pa = Math.abs(u - c), pb = Math.abs(a - c), pc = Math.abs(a + u - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? u : c;
      }
      data[row + i] = v;
    }
  }

  // One sample as stored (up to 16 bits), and scaled to 8 bits (16-bit samples keep their high byte).
  const sample = depth === 16 ? (row, i) => (data[row + 2 * i] << 8) | data[row + 2 * i + 1]
    : depth === 8 ? (row, i) => data[row + i]
      : (row, i) => (data[row + ((i * depth) >> 3)] >> (8 - depth - ((i * depth) & 7))) & ((1 << depth) - 1);
  const to8 = depth === 16 ? (v) => v >> 8 : depth === 8 ? (v) => v : (v) => Math.round(v * 255 / ((1 << depth) - 1));
  const key = trns && type === 0 && trns.length >= 2 ? [trns.readUInt16BE(0)]
    : trns && type === 2 && trns.length >= 6 ? [trns.readUInt16BE(0), trns.readUInt16BE(2), trns.readUInt16BE(4)] : null;
  const colours = plte ? plte.length / 3 | 0 : 0;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0, o = 0; y < h; y++) {
    const row = y * stride;
    for (let x = 0; x < w; x++, o += 4) {
      const s = x * channels;
      if (type === 3) {
        const i = sample(row, s);
        if (i >= colours) throw invalid(`pixel ${x}, ${y} uses palette index ${i}, past its ${colours}-colour palette`);
        rgba[o] = plte[3 * i]; rgba[o + 1] = plte[3 * i + 1]; rgba[o + 2] = plte[3 * i + 2];
        rgba[o + 3] = trns && i < trns.length ? trns[i] : 255;
      } else if (type === 0 || type === 4) {
        const g = sample(row, s);
        rgba[o] = rgba[o + 1] = rgba[o + 2] = to8(g);
        rgba[o + 3] = type === 4 ? to8(sample(row, s + 1)) : key && g === key[0] ? 0 : 255;
      } else {
        const r = sample(row, s), g = sample(row, s + 1), bl = sample(row, s + 2);
        rgba[o] = to8(r); rgba[o + 1] = to8(g); rgba[o + 2] = to8(bl);
        rgba[o + 3] = type === 6 ? to8(sample(row, s + 3)) : key && r === key[0] && g === key[1] && bl === key[2] ? 0 : 255;
      }
    }
  }
  return { w, h, rgba };
}

/**
 * Up to `k` dominant colours of the opaque pixels (alpha 128 or more), largest
 * first: `{ transparent, clusters: [{ rgb, pixels }], label }`, where `label`
 * gives each pixel its cluster's index, or 255 for a transparent pixel.
 * The clustering is core/image.js's, the one a piece's `palette` reads.
 */
function palette(rgba, w, h, k) {
  return clusters(rgba, w, h, k, 4);
}

/** Distance from `p` to the segment a-b; exactly 0 for a point on it. */
function segmentDistance(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
  const t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : -1;
  if (t <= 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  if (t >= 1) return Math.hypot(p[0] - b[0], p[1] - b[1]);
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / Math.sqrt(len2);
}

/**
 * A closed loop (first point not repeated) with Ramer-Douglas-Peucker: every
 * dropped point lies within `tolerance` of the kept outline. Tolerance 0 drops
 * only points on a straight run. At least 3 points stay.
 */
function simplify(pts, tolerance) {
  const n = pts.length;
  if (n < 4) return pts.slice();
  let far = 0;
  for (let i = 1; i < n; i++) if (Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]) > Math.hypot(pts[far][0] - pts[0][0], pts[far][1] - pts[0][1])) far = i;
  const keep = new Uint8Array(n);
  keep[0] = keep[far] = 1;
  for (const stack = [[0, far], [far, n]]; stack.length;) {
    const [a, b] = stack.pop();
    let best = -1, d = tolerance;
    for (let i = a + 1; i < b; i++) {
      const e = segmentDistance(pts[i], pts[a], pts[b % n]);
      if (e > d) { d = e; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  if (keep.reduce((s, v) => s + v, 0) < 3) {
    let best = 1;
    for (let i = 1; i < n; i++) if (segmentDistance(pts[i], pts[0], pts[far]) > segmentDistance(pts[best], pts[0], pts[far])) best = i;
    keep[best] = 1;
  }
  return pts.filter((_, i) => keep[i]);
}

/**
 * Clears from a 0/1 `mask` (cols x rows, its border 0) every outline that
 * encloses less than `minArea`, with everything inside it, so none of them is
 * traced, and returns how many outlines that drops; every outline left traces
 * as before.
 * 1s join through sides and 0s through sides or corners, so each outline parts
 * one part of 1s from one part of 0s, and one of the two lies inside the other:
 * the part around a part holds the sample above its first one. A part of 1s with
 * pixel, side and 2 x 2 block counts V, E and F covers (V + E - F) / 2 of the
 * area inside its outline; a part of 0s touching Q 2 x 2 blocks covers
 * 2.5 V - E / 2 - Q / 2. An outline encloses its part's cover plus the cover of
 * every part inside it, so this is exact for a region with holes too.
 */
function clearSmall(mask, cols, rows, minArea) {
  const n = cols * rows, part = new Int32Array(n).fill(-1), queue = new Int32Array(n);
  // Part 0 is the outside: the border and every 0 joined to it, with no outline.
  // Its 0s next to the border start it, so every sample queued has 8 neighbours.
  part.fill(0, 0, cols); part.fill(0, n - cols);
  for (let p = cols; p < n; p += cols) part[p - 1] = part[p] = 0;
  const ring = [];
  for (let x = 1; x < cols - 1; x++) ring.push(cols + x, n - 2 * cols + x);
  for (let p = 2 * cols; p < n - 2 * cols; p += cols) ring.push(p + 1, p + cols - 2);
  let start = 0;
  for (const p of ring) if (!mask[p] && part[p] < 0) { part[p] = 0; queue[start++] = p; }
  // Per part: the part around it, its value, and twice the area inside its outline.
  const around = [], value = [], area = [];
  for (let s = 0, tail = start; s < n; s++) {
    if (s && part[s] >= 0) continue;
    const id = area.length, one = mask[s], head = id ? tail : 0;
    around.push(id ? part[s - cols] : -1); value.push(one);
    if (id) { queue[tail++] = s; part[s] = id; }
    let twice = 0;
    for (let i = head; i < tail; i++) {
      const p = queue[i];
      if (one) {
        // A part of 1s never reaches the empty border, so its neighbours are all in the mask.
        const right = mask[p + 1], down = mask[p + cols];
        twice += 1 + right + down - (right & down & mask[p + cols + 1]);
        if (mask[p - 1] && part[p - 1] < 0) { part[p - 1] = id; queue[tail++] = p - 1; }
        if (right && part[p + 1] < 0) { part[p + 1] = id; queue[tail++] = p + 1; }
        if (mask[p - cols] && part[p - cols] < 0) { part[p - cols] = id; queue[tail++] = p - cols; }
        if (down && part[p + cols] < 0) { part[p + cols] = id; queue[tail++] = p + cols; }
        continue;
      }
      if (id) {
        // The 2 x 2 blocks whose first 0, in reading order, is p.
        const up = mask[p - cols], left = mask[p - 1];
        twice += 5 - (1 - mask[p + 1]) - (1 - mask[p + cols]) - 1 - left - (up & mask[p - cols + 1]) - (up & left & mask[p - cols - 1]);
      }
      for (let o = p - cols - 1; o <= p + cols - 1; o += cols) {
        if (part[o] < 0 && !mask[o]) { part[o] = id; queue[tail++] = o; }
        if (part[o + 1] < 0 && !mask[o + 1]) { part[o + 1] = id; queue[tail++] = o + 1; }
        if (part[o + 2] < 0 && !mask[o + 2]) { part[o + 2] = id; queue[tail++] = o + 2; }
      }
    }
    area.push(twice);
  }
  // A part comes after the part around it, so adding backwards sums every part inside.
  for (let id = area.length - 1; id > 0; id--) area[around[id]] += area[id];
  // A part under minArea, and everything inside it, takes the value of the part around it.
  const fill = new Uint8Array(area.length);
  let dropped = 0;
  for (let id = 1; id < area.length; id++) {
    const small = area[id] < 2 * minArea;
    dropped += small;
    fill[id] = small ? fill[around[id]] : value[id];
  }
  if (dropped) for (let p = 0; p < n; p++) mask[p] = fill[part[p]];
  return dropped;
}

// The edges of a 2 x 2 cell of mask samples: 0 top, 1 right, 2 bottom, 3 left,
// with their midpoints, and the cell across each. SEGMENTS lists each cell
// case's segments [from, to] in the order and direction core isolines gives at
// level 0.5 (a saddle keeps its 1s apart); OTHER is each edge's other end.
const EDGE_X = [0.5, 1, 0.5, 0], EDGE_Y = [0, 0.5, 1, 0.5], STEP_X = [0, 1, 0, -1], STEP_Y = [-1, 0, 1, 0];
const SEGMENTS = [[], [[3, 2]], [[2, 1]], [[3, 1]], [[0, 1]], [[0, 1], [3, 2]], [[0, 2]], [[3, 0]],
  [[3, 0]], [[0, 2]], [[3, 0], [2, 1]], [[0, 1]], [[3, 1]], [[2, 1]], [[3, 2]], []];
const OTHER = new Int8Array(64);
SEGMENTS.forEach((list, c) => { for (const [a, b] of list) { OTHER[c * 4 + a] = b; OTHER[c * 4 + b] = a; } });

/**
 * Every outline of a 0/1 `mask` (cols x rows, its border 0) as a closed loop of
 * edge midpoints in grid units moved by (ox, oy), first point not repeated: the
 * loops, starting points and directions core isolines and chain give at level
 * 0.5, in the same order, found by walking from cell to cell.
 */
function trace(mask, cols, rows, ox, oy) {
  const cw = cols - 1, used = new Uint8Array(cw * (rows - 1)), loops = [];
  const kind = (i, j) => { const p = j * cols + i; return mask[p] << 3 | mask[p + 1] << 2 | mask[p + cols + 1] << 1 | mask[p + cols]; };
  for (let j0 = 0; j0 < rows - 1; j0++) {
    for (let i0 = 0; i0 < cw; i0++) {
      const c = kind(i0, j0);
      if (c === 0 || c === 15) continue;
      for (const [a, b] of SEGMENTS[c]) {
        const k0 = j0 * cw + i0;
        if (used[k0] & 1 << a) continue;
        used[k0] |= 1 << a | 1 << b;
        const pts = [[i0 + EDGE_X[a] + ox, j0 + EDGE_Y[a] + oy]];
        // Walk out through edge e into the next cell until that edge is the first point's.
        for (let i = i0, j = j0, e = b; !(i + STEP_X[e] === i0 && j + STEP_Y[e] === j0 && (e ^ 2) === a);) {
          pts.push([i + EDGE_X[e] + ox, j + EDGE_Y[e] + oy]);
          i += STEP_X[e]; j += STEP_Y[e];
          const into = e ^ 2;
          e = OTHER[kind(i, j) * 4 + into];
          used[j * cw + i] |= 1 << into | 1 << e;
        }
        loops.push(pts);
      }
    }
  }
  return loops;
}

/**
 * The outlines of colour `c` in `label` (w x h), in image pixels from the
 * top-left corner, along pixel edges: `{ outlines: [{ points, area, hole, bbox }], dropped, traced }`,
 * largest first. A loop enclosing less than `minArea` square pixels is dropped
 * and counted; `hole` marks a loop around a part that is not colour `c`.
 * `area` and `bbox` are the loop's before simplification. `traced` counts the
 * loops walked, which is the outlines kept; `measure` leaves it out of the report.
 */
function outlines(label, w, h, c, { tolerance, minArea }) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0, p = 0; y < h; y++) {
    for (let x = 0; x < w; x++, p++) {
      if (label[p] !== c) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { outlines: [], dropped: 0, traced: 0 };
  // The colour's box with a one-sample empty border, so every region closes.
  const cols = x1 - x0 + 3, rows = y1 - y0 + 3, mask = new Uint8Array(cols * rows);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (label[y * w + x] === c) mask[(y - y0 + 1) * cols + x - x0 + 1] = 1;
  const is = (x, y) => x >= 0 && y >= 0 && x < w && y < h && label[y * w + x] === c;
  const found = [];
  // Every loop left to trace encloses at least minArea, so none is dropped after tracing.
  const dropped = minArea > 0 ? clearSmall(mask, cols, rows, minArea) : 0;
  // Sample (gx, gy) is the centre of pixel (gx - 1 + x0, gy - 1 + y0), at (gx + x0 - 0.5, gy + y0 - 0.5).
  const loops = trace(mask, cols, rows, x0 - 0.5, y0 - 0.5);
  for (const raw of loops) {
    let signed = 0;
    for (let i = 0; i < raw.length; i++) {
      const [ax, ay] = raw[i], [bx, by] = raw[(i + 1) % raw.length];
      signed += ax * by - bx * ay;
    }
    signed /= 2;
    const area = Math.abs(signed);
    // Probe half a pixel inside the loop from its first edge: a hole's inside is not colour c.
    const [a, b] = [raw[0], raw[1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), side = signed > 0 ? 0.5 / len : -0.5 / len;
    const qx = (a[0] + b[0]) / 2 - (b[1] - a[1]) * side, qy = (a[1] + b[1]) / 2 + (b[0] - a[0]) * side;
    found.push({ points: simplify(raw, tolerance), area: Math.round(area * 100) / 100, hole: !is(Math.floor(qx), Math.floor(qy)), bbox: bbox(raw) });
  }
  return { outlines: found.sort((p, q) => q.area - p.area), dropped, traced: loops.length };
}

/** The measurement report of a PNG's bytes. */
function measure(bytes, { name, colors = 8, tolerance = 1, minArea = 4 }) {
  const { w, h, rgba } = decodePng(bytes, name);
  const { transparent, clusters, label } = palette(rgba, w, h, colors);
  const n = w * h, share = (v) => Math.round(v / n * 1e6) / 1e6;
  return {
    file: name,
    size: { w, h },
    pixels: n,
    transparent: share(transparent),
    colours: clusters.map((cl, c) => ({
      hex: '#' + cl.rgb.map((v) => v.toString(16).padStart(2, '0')).join(''),
      rgb: cl.rgb,
      pixels: cl.pixels,
      share: share(cl.pixels),
      ...(({ traced, ...rest }) => rest)(outlines(label, w, h, c, { tolerance, minArea })),
    })),
    options: { colors, tolerance, minArea },
  };
}

function parseArgs(args) {
  const refuse = (cause) => new Error('measure: ' + cause + '\n' + USAGE);
  const out = { file: null, colors: 8, tolerance: 1, minArea: 4, out: null };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('-')) {
      if (out.file !== null) throw refuse(`one image at a time, got "${out.file}" and "${a}"`);
      out.file = a;
      continue;
    }
    if (!['--colors', '--tolerance', '--min-area', '--out'].includes(a)) throw refuse('unknown option ' + a);
    if (seen.has(a)) throw refuse(`give ${a} only once`);
    seen.add(a);
    const v = args[i + 1] === undefined || args[i + 1].startsWith('--') ? null : args[++i];
    if (a === '--out') {
      if (v === null) throw refuse('--out needs a .json file');
      if (!/\.json$/i.test(v)) throw refuse('--out must name a .json file, got ' + v);
      out.out = v;
      continue;
    }
    const num = v === null || v.trim() === '' ? NaN : Number(v), got = v === null ? 'nothing' : v;
    if (a === '--colors') {
      if (!Number.isInteger(num) || num < 1 || num > 32) throw refuse('--colors takes a whole number from 1 to 32, got ' + got);
      out.colors = num;
    } else if (!Number.isFinite(num) || num < 0) {
      throw refuse(a === '--tolerance' ? '--tolerance takes a number of pixels, 0 or more, got ' + got : '--min-area takes a number of square pixels, 0 or more, got ' + got);
    } else if (a === '--tolerance') out.tolerance = num;
    else out.minArea = num;
  }
  if (out.file === null) throw refuse('name the PNG to measure');
  return out;
}

// Relative paths resolve from the caller's directory (callerDirectory: the directory npm run was started in), not the library root.
function main(args = process.argv.slice(2), cwd = callerDirectory()) {
  if (args.includes('--help') || args.includes('-h')) return console.log(USAGE);
  const options = parseArgs(args);
  const file = path.resolve(cwd, options.file);
  let bytes;
  try { bytes = fs.readFileSync(file); } catch (e) {
    if (e.code === 'ENOENT') throw new Error(`measure: no file at ${file}; name a PNG file\n${USAGE}`);
    throw e;
  }
  const report = measure(bytes, { name: options.file, colors: options.colors, tolerance: options.tolerance, minArea: options.minArea });
  if (!options.out) return console.log(JSON.stringify(report));
  const target = path.resolve(cwd, options.out);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(report) + '\n');
  const count = report.colours.reduce((s, c) => s + c.outlines.length, 0);
  console.log(`measure: ${shown(target)}: ${report.size.w} x ${report.size.h}, ${report.colours.length} colours, ${count} outlines`);
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { decodePng, palette, clearSmall, outlines, simplify, measure, parseArgs, main };
