'use strict';

// tools/measure-reference.js on PNGs built here with node:zlib: decoding every
// colour type and filter, the palette's clusters and shares, each region's
// outlines and holes, simplification, the file and argument refusals, and what
// the command prints and writes.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');

const { decodePng, palette, clearSmall, outlines, simplify, measure, parseArgs, main } = require('../tools/measure-reference.js');
const { isolines } = require('../core/field.js');
const { bbox, spline } = require('../core/geom.js');

const ROOT = path.join(__dirname, '..');
const USAGE_LINE = '\\nusage: [^\\n]+$';
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A refusal about the arguments: its cause, then one usage line. */
const refusal = (cause) => ({ message: new RegExp('^' + escape(cause) + USAGE_LINE) });
/** A refusal about the file: its cause alone. */
const fileRefusal = (cause) => ({ message: new RegExp('^' + escape(cause) + '$') });

/** Deterministic numbers in [0, 1). */
const random = (seed) => () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;

const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(zlib.crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ihdr = (w, h, depth, type, interlace = 0) => {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(w, 0); data.writeUInt32BE(h, 4); data[8] = depth; data[9] = type; data[12] = interlace;
  return chunk('IHDR', data);
};

/**
 * A PNG of `samples` (row-major, `channels` stored values a pixel), row y
 * filtered with filter type y % 5, so five rows exercise None, Sub, Up,
 * Average and Paeth.
 */
function png({ w, h, type, depth, samples, plte = null, trns = null }) {
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  const stride = Math.ceil(w * channels * depth / 8), bpp = Math.max(1, (channels * depth) >> 3);
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(stride);
    for (let i = 0; i < w * channels; i++) {
      const v = samples[y * w * channels + i];
      if (depth === 16) row.writeUInt16BE(v, 2 * i);
      else if (depth === 8) row[i] = v;
      else row[(i * depth) >> 3] |= v << (8 - depth - ((i * depth) & 7));
    }
    rows.push(row);
  }
  const filtered = rows.map((row, y) => {
    const f = y % 5, out = Buffer.alloc(stride + 1);
    out[0] = f;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0, b = y ? rows[y - 1][i] : 0, c = i >= bpp && y ? rows[y - 1][i - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predictor = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      out[i + 1] = (row[i] - predictor) & 255;
    }
    return out;
  });
  return Buffer.concat([SIGNATURE, ihdr(w, h, depth, type), ...(plte ? [chunk('PLTE', Buffer.from(plte))] : []),
    ...(trns ? [chunk('tRNS', Buffer.from(trns))] : []), chunk('IDAT', zlib.deflateSync(Buffer.concat(filtered))), chunk('IEND', Buffer.alloc(0))]);
}

/** An 8-bit RGBA PNG of `colourAt(x, y)`, [r, g, b] or [r, g, b, a]. */
function rgbaPng(w, h, colourAt) {
  const samples = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = colourAt(x, y); samples.push(c[0], c[1], c[2], c[3] ?? 255); }
  return png({ w, h, type: 6, depth: 8, samples });
}

/** Colour `c` of `label` (w x h) as a 0/1 mask with an empty border: `{ mask, cols, rows }`. */
function maskOf(label, w, h, c) {
  const cols = w + 2, rows = h + 2, mask = new Uint8Array(cols * rows);
  for (let p = 0; p < w * h; p++) if (label[p] === c) mask[(Math.floor(p / w) + 1) * cols + p % w + 1] = 1;
  return { mask, cols, rows };
}

/**
 * Every outline of colour `c`, traced by core isolines and chain with nothing
 * skipped and measured as the tool measures a loop: what the tool's own walk
 * must give, point for point.
 */
function coreOutlines(label, w, h, c, tolerance) {
  const { mask, cols, rows } = maskOf(label, w, h, c);
  const is = (x, y) => x >= 0 && y >= 0 && x < w && y < h && label[y * w + x] === c;
  return isolines(mask, cols - 1, rows - 1, 0.5).paths.map((path) => {
    const raw = path.slice(0, -1).map(([gx, gy]) => [gx - 0.5, gy - 0.5]);
    let signed = 0;
    raw.forEach(([ax, ay], i) => { const [bx, by] = raw[(i + 1) % raw.length]; signed += ax * by - bx * ay; });
    signed /= 2;
    const [a, b] = raw, len = Math.hypot(b[0] - a[0], b[1] - a[1]), side = signed > 0 ? 0.5 / len : -0.5 / len;
    const qx = (a[0] + b[0]) / 2 - (b[1] - a[1]) * side, qy = (a[1] + b[1]) / 2 + (b[0] - a[0]) * side;
    return { points: simplify(raw, tolerance), area: Math.round(Math.abs(signed) * 100) / 100, hole: !is(Math.floor(qx), Math.floor(qy)), bbox: bbox(raw) };
  }).sort((p, q) => q.area - p.area);
}

/** How many bytes differ between two buffers. */
const differing = (a, b) => { let n = Math.abs(a.length - b.length); for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) n++; return n; };

test('decodePng reads every colour type and bit depth, through all five filters', async (t) => {
  const W = 13, H = 7;
  const plte = [10, 20, 30, 200, 100, 0, 0, 255, 0, 90, 90, 90, 255, 255, 255];
  // Each case: stored samples of one pixel and the RGBA it decodes to, from a random r.
  const cases = [
    ['grey, 1 bit', { type: 0, depth: 1 }, (r) => { const v = r() < 0.5 ? 0 : 1; return [[v], [v * 255, v * 255, v * 255, 255]]; }],
    ['grey, 4 bits', { type: 0, depth: 4 }, (r) => { const v = Math.floor(r() * 16); return [[v], [v * 17, v * 17, v * 17, 255]]; }],
    ['grey, 8 bits, transparent key', { type: 0, depth: 8, trns: [0, 7] }, (r) => { const v = r() < 0.2 ? 7 : Math.floor(r() * 256); return [[v], [v, v, v, v === 7 ? 0 : 255]]; }],
    ['grey, 16 bits', { type: 0, depth: 16 }, (r) => { const v = Math.floor(r() * 256); return [[v * 256 + Math.floor(r() * 256)], [v, v, v, 255]]; }],
    ['RGB, 8 bits', { type: 2, depth: 8 }, (r) => { const c = [0, 0, 0].map(() => Math.floor(r() * 256)); return [c, [...c, 255]]; }],
    ['RGB, 16 bits, transparent key', { type: 2, depth: 16, trns: [1, 2, 3, 4, 5, 6] }, (r) => {
      if (r() < 0.2) return [[0x0102, 0x0304, 0x0506], [1, 3, 5, 0]];
      const c = [0, 0, 0].map(() => Math.floor(r() * 256));
      return [c.map((v) => v * 256 + 255), [...c, 255]];
    }],
    ['palette, 4 bits, tRNS', { type: 3, depth: 4, plte, trns: [0, 128] }, (r) => {
      const i = Math.floor(r() * 5);
      return [[i], [plte[3 * i], plte[3 * i + 1], plte[3 * i + 2], [0, 128][i] ?? 255]];
    }],
    ['palette, 8 bits', { type: 3, depth: 8, plte }, (r) => { const i = Math.floor(r() * 5); return [[i], [...plte.slice(3 * i, 3 * i + 3), 255]]; }],
    ['grey and alpha, 8 bits', { type: 4, depth: 8 }, (r) => { const g = Math.floor(r() * 256), a = Math.floor(r() * 256); return [[g, a], [g, g, g, a]]; }],
    ['RGBA, 8 bits', { type: 6, depth: 8 }, (r) => { const c = [0, 0, 0, 0].map(() => Math.floor(r() * 256)); return [c, c]; }],
    ['RGBA, 16 bits', { type: 6, depth: 16 }, (r) => { const c = [0, 0, 0, 0].map(() => Math.floor(r() * 256)); return [c.map((v) => v * 256 + 17), c]; }],
  ];
  for (const [title, options, pixel] of cases) {
    await t.test(title, () => {
      const r = random(title.length * 31), samples = [], expected = [];
      for (let p = 0; p < W * H; p++) { const [s, e] = pixel(r); samples.push(...s); expected.push(...e); }
      const image = decodePng(png({ w: W, h: H, samples, ...options }), 'a.png');
      assert.equal(image.w, W);
      assert.equal(image.h, H);
      assert.equal(differing(image.rgba, expected), 0);
    });
  }
});

test('decodePng refuses what it cannot read, naming the file', async (t) => {
  const riff = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
  const cases = [
    ['JPEG', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), 'measure: ref is a JPEG image; this tool reads PNG only, so save the reference as PNG first'],
    ['WebP', riff, 'measure: ref is a WebP image; this tool reads PNG only, so save the reference as PNG first'],
    ['GIF', Buffer.from('GIF89a'), 'measure: ref is a GIF image; this tool reads PNG only, so save the reference as PNG first'],
    ['other bytes', Buffer.from('not an image at all'), 'measure: ref is not a PNG file'],
    ['interlaced', Buffer.concat([SIGNATURE, ihdr(4, 4, 8, 6, 1)]), 'measure: ref is an interlaced PNG, which this tool does not read; save it without interlacing'],
    ['bit depth', Buffer.concat([SIGNATURE, ihdr(4, 4, 4, 2)]), 'measure: ref is not a valid PNG: colour type 2 does not allow bit depth 4'],
    ['size', Buffer.concat([SIGNATURE, ihdr(10000, 6000, 8, 6)]), 'measure: ref is 10000 x 6000, over the 50000000-pixel limit; scale it down first'],
    ['no IDAT', Buffer.concat([SIGNATURE, ihdr(4, 4, 8, 6), chunk('IEND', Buffer.alloc(0))]), 'measure: ref is not a valid PNG: it has no IDAT chunk'],
    ['no IEND', Buffer.concat([SIGNATURE, ihdr(4, 4, 8, 6)]), 'measure: ref is not a valid PNG: it ends before its IEND chunk'],
    ['palette index', png({ w: 2, h: 1, type: 3, depth: 8, samples: [0, 2], plte: [0, 0, 0, 9, 9, 9] }), 'measure: ref is not a valid PNG: pixel 1, 0 uses palette index 2, past its 2-colour palette'],
  ];
  for (const [title, bytes, cause] of cases) await t.test(title, () => assert.throws(() => decodePng(bytes, 'ref'), fileRefusal(cause)));
});

// 40 x 30, white ground; a red 10 x 10 square at pixels 5..14; a blue 12 x 12
// ring at 24..35 x 8..19 around a 4 x 4 white hole at 28..31 x 12..15.
const RED = [220, 30, 30], BLUE = [30, 60, 200], WHITE = [255, 255, 255];
const inBox = (x, y, x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
const flat = rgbaPng(40, 30, (x, y) => inBox(x, y, 5, 5, 14, 14) ? RED
  : inBox(x, y, 24, 8, 35, 19) && !inBox(x, y, 28, 12, 31, 15) ? BLUE : WHITE);

test('measure reports the size, colours, shares and outlines of flat shapes', () => {
  const report = measure(flat, { name: 'flat.png' });
  assert.deepEqual(report.size, { w: 40, h: 30 });
  assert.equal(report.pixels, 1200);
  assert.equal(report.transparent, 0);
  assert.deepEqual(report.colours.map((c) => [c.hex, c.pixels]), [['#ffffff', 972], ['#1e3cc8', 128], ['#dc1e1e', 100]]);
  assert.ok(Math.abs(report.colours.reduce((s, c) => s + c.share, 0) - 1) < 1e-6);
  const [white, blue, red] = report.colours;

  assert.equal(red.outlines.length, 1);
  assert.equal(red.outlines[0].hole, false);
  assert.ok(Math.abs(red.outlines[0].area - 100) <= 0.5, `area ${red.outlines[0].area}`);
  assert.ok(red.outlines[0].points.length <= 8, `${red.outlines[0].points.length} points`);
  assert.deepEqual(red.outlines[0].bbox, [5, 5, 15, 15]);

  assert.deepEqual(blue.outlines.map((o) => [o.hole, o.area]), [[false, 143.5], [true, 15.5]]);
  assert.deepEqual(white.outlines.map((o) => [o.hole, o.area]), [[false, 1199.5], [true, 143.5], [true, 99.5], [false, 15.5]]);
  assert.equal(white.dropped + blue.dropped + red.dropped, 0);
});

test('at tolerance 0 an outline keeps every corner and runs along pixel edges', () => {
  const [, blue, red] = measure(flat, { name: 'flat.png', tolerance: 0 }).colours;
  // Four sides along pixel edges, each corner chamfered by half a pixel.
  assert.deepEqual(red.outlines[0].points.map(String).sort(), ['14.5,15', '15,14.5', '15,5.5', '14.5,5', '5,14.5', '5,5.5', '5.5,15', '5.5,5'].sort());
  assert.deepEqual(blue.outlines.map((o) => o.bbox), [[24, 8, 36, 20], [28, 12, 32, 16]]);
});

test('anti-aliased edge colours join the colours they blend, not clusters of their own', () => {
  // 100 x 100: white, a plain blue square, and a red square edged with six
  // blends of red and white, each on fewer than 0.1% of the pixels.
  const blends = [40, 80, 120, 160, 200, 230];
  const image = rgbaPng(100, 100, (x, y) => {
    if (inBox(x, y, 10, 10, 39, 39)) return BLUE;
    if (inBox(x, y, 45, 45, 54, 54)) return [255, 0, 0];
    if (inBox(x, y, 44, 44, 55, 55)) { const v = blends[(x + y) % 6]; return [255, v, v]; }
    return WHITE;
  });
  const report = measure(image, { name: 'edges.png' });
  assert.equal(report.colours.length, 3);
  assert.equal(report.colours.reduce((s, c) => s + c.pixels, 0), 10000);
  const two = measure(image, { name: 'edges.png', colors: 2 });
  assert.equal(two.colours.length, 2);
  assert.equal(two.colours.reduce((s, c) => s + c.pixels, 0), 10000);
});

test('a smooth gradient, every colour on few pixels, still splits into --colors clusters', () => {
  // 128 x 128 over red and green: each 5-bit bin holds 16 pixels, under 0.1%.
  const report = measure(rgbaPng(128, 128, (x, y) => [2 * x, 2 * y, 0]), { name: 'gradient.png', colors: 6, minArea: 1e9 });
  assert.equal(report.colours.length, 6);
  assert.ok(report.colours.every((c) => c.share > 0.05), report.colours.map((c) => c.share).join(', '));
});

test('transparent pixels are counted apart and belong to no colour', () => {
  const report = measure(rgbaPng(20, 20, (x) => x < 10 ? [0, 0, 0, 0] : [0, 128, 0, 255]), { name: 'half.png' });
  assert.equal(report.transparent, 0.5);
  assert.deepEqual(report.colours.map((c) => [c.hex, c.share]), [['#008000', 0.5]]);
  assert.deepEqual(report.colours[0].outlines.map((o) => o.bbox), [[10, 0, 20, 20]]);
  // palette labels a transparent pixel 255.
  const image = decodePng(rgbaPng(2, 1, (x) => x ? [9, 9, 9] : [9, 9, 9, 0]), 'two.png');
  const { transparent, label } = palette(image.rgba, 2, 1, 8);
  assert.equal(transparent, 1);
  assert.deepEqual([...label], [255, 0]);
});

test('a ring filled even-odd from two spline loops, as replica step 4 paints it, reports a hole: true outline over transparent pixels', () => {
  const loop = (r) => spline([[30 - r, 30], [30, 30 - r], [30 + r, 30], [30, 30 + r]], 1, { close: true });
  const loops = [loop(25), loop(11)];
  // The even-odd rule: a pixel centre is painted when a ray from it crosses the loops an odd number of times.
  const inside = (px, py) => loops.reduce((odd, pts) => pts.reduce((o, [x1, y1], i) => {
    const [x0, y0] = pts[(i || pts.length) - 1];
    return (y0 > py) !== (y1 > py) && px < x0 + ((py - y0) / (y1 - y0)) * (x1 - x0) ? !o : o;
  }, odd), false);
  const report = measure(rgbaPng(60, 60, (x, y) => inside(x + 0.5, y + 0.5) ? RED : [0, 0, 0, 0]), { name: 'ring.png' });
  assert.equal(report.colours.length, 1);
  assert.ok(report.transparent > 0);
  const [outer, hole] = report.colours[0].outlines;
  assert.deepEqual([outer.hole, hole.hole], [false, true]);
  assert.deepEqual(outer.bbox, [5, 5, 55, 55]);
  assert.deepEqual(hole.bbox, [19, 19, 41, 41]);
});

test('a curved outline keeps its area, and its points follow --tolerance', () => {
  const disc = rgbaPng(40, 40, (x, y) => (x + 0.5 - 20) ** 2 + (y + 0.5 - 20) ** 2 <= 144 ? [0, 0, 0] : WHITE);
  const pointsAt = (tolerance) => measure(disc, { name: 'disc.png', tolerance }).colours.find((c) => c.hex === '#000000').outlines;
  const fine = pointsAt(0.25), normal = pointsAt(1), coarse = pointsAt(2);
  assert.equal(normal.length, 1);
  assert.ok(Math.abs(normal[0].area - Math.PI * 144) / (Math.PI * 144) < 0.03, `area ${normal[0].area}`);
  assert.ok(fine[0].points.length > normal[0].points.length && normal[0].points.length > coarse[0].points.length,
    `${fine[0].points.length}, ${normal[0].points.length}, ${coarse[0].points.length} points`);

  // Every point of the full outline lies within the tolerance of the simplified one.
  const full = pointsAt(0)[0].points, kept = simplify(full, 1);
  const segment = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };
  const far = full.filter((p) => Math.min(...kept.map((a, i) => segment(p, a, kept[(i + 1) % kept.length]))) > 1 + 1e-9);
  assert.equal(far.length, 0, `${far.length} points farther than the tolerance`);
  assert.ok(simplify(full, 1000).length >= 3, 'a loop keeps at least 3 points');
});

test('--min-area drops small islands and counts them', () => {
  const dot = rgbaPng(10, 10, (x, y) => x === 4 && y === 4 ? [0, 0, 0] : WHITE);
  const black = (minArea) => measure(dot, { name: 'dot.png', minArea }).colours.find((c) => c.hex === '#000000');
  assert.deepEqual([black(4).outlines.length, black(4).dropped], [0, 1]);
  assert.deepEqual([black(0).outlines.length, black(0).dropped], [1, 0]);
  // outlines works on any label array: a colour absent from it has none.
  assert.deepEqual(outlines(new Uint8Array(4), 2, 2, 1, { tolerance: 1, minArea: 0 }), { outlines: [], dropped: 0, traced: 0 });
});

// 160 x 120 over four colours: a ring around a hole holding a small ring, a
// disc, a frame, and seeded speckles of 1 to 4 pixels and little 3 x 3 rings,
// some touching the shapes at a corner or a side.
const SPECK_COLOURS = [WHITE, RED, BLUE, [20, 160, 60]];
const speckled = (() => {
  const W = 160, H = 120, grid = new Uint8Array(W * H), r = random(771);
  const fill = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (x >= 0 && y >= 0 && x < W && y < H) grid[y * W + x] = c; };
  fill(10, 10, 69, 69, 1); fill(25, 25, 54, 54, 0); fill(35, 35, 41, 41, 2); fill(37, 37, 39, 39, 0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x - 115) ** 2 + (y - 40) ** 2 <= 400) grid[y * W + x] = 2;
  fill(80, 75, 150, 110, 3); fill(90, 82, 140, 103, 0);
  for (let i = 0; i < 900; i++) {
    const x = Math.floor(r() * W), y = Math.floor(r() * H), c = Math.floor(r() * 4), shape = Math.floor(r() * 6);
    if (shape === 0) fill(x, y, x, y, c);
    else if (shape === 1) fill(x, y, x + 1, y, c);
    else if (shape === 2) fill(x, y, x, y + 2, c);
    else if (shape === 3) fill(x, y, x + 1, y + 1, c);
    else if (shape === 4) { fill(x, y, x + 1, y, c); fill(x, y + 1, x, y + 1, c); }
    else { fill(x, y, x + 2, y + 2, c); fill(x + 1, y + 1, x + 1, y + 1, (c + 1) % 4); }
  }
  // A 1-pixel moat enclosing 24 square pixels around a 5 x 5 island enclosing 24.5.
  fill(140, 2, 156, 18, 3); fill(145, 7, 151, 13, 0); fill(146, 8, 150, 12, 3);
  return rgbaPng(W, H, (x, y) => SPECK_COLOURS[grid[y * W + x]]);
})();

/**
 * Whether `report` holds, for each colour, exactly the outlines core isolines
 * traces at or over `minArea` and counts the rest as dropped: '' when it does,
 * else what differs, kept short.
 */
function sameAsTracingEverything(bytes, report, minArea) {
  const image = decodePng(bytes, 'x.png'), { label } = palette(image.rgba, image.w, image.h, report.options.colors);
  const want = report.colours.map((_, c) => {
    const all = coreOutlines(label, image.w, image.h, c, report.options.tolerance);
    return { outlines: all.filter((o) => o.area >= minArea), dropped: all.filter((o) => o.area < minArea).length };
  });
  const got = report.colours.map((c) => ({ outlines: c.outlines, dropped: c.dropped }));
  if (JSON.stringify(got) === JSON.stringify(want)) return '';
  return `minArea ${minArea}: ${got.map((c) => c.outlines.length + '/' + c.dropped)} outlines/dropped, tracing everything gives ${want.map((c) => c.outlines.length + '/' + c.dropped)}`;
}

test('skipping small regions and holes before tracing leaves every kept outline and the dropped counts as tracing them gives', () => {
  for (const minArea of [0.5, 1, 2.5, 4, 9, 12, 24.5, 40]) {
    const report = measure(speckled, { name: 'speckled.png', minArea });
    assert.equal(report.colours.length, 4);
    assert.equal(sameAsTracingEverything(speckled, report, minArea), '');
    if (minArea === 4) assert.ok(report.colours.some((c) => c.dropped > 100) && report.colours.some((c) => c.outlines.some((o) => o.hole)), 'the image has speckles and holes');
  }
});

test('regions under --min-area are never traced', () => {
  // 400 x 300: four flat bands under 13,300 single pixels and dominoes of the
  // other colours, 3 pixels apart: each a speck of its colour and a hole in its band.
  const W = 400, H = 300, r = random(7), specks = new Map();
  for (let y = 1; y < H; y += 3) {
    for (let x = 1; x < W - 1; x += 3) {
      const c = (Math.floor(x / 100) + 1 + Math.floor(r() * 3)) % 4;
      specks.set(y * W + x, c);
      if (r() < 0.5) specks.set(y * W + x + 1, c);
    }
  }
  const image = rgbaPng(W, H, (x, y) => SPECK_COLOURS[specks.get(y * W + x) ?? Math.floor(x / 100)]);
  const report = measure(image, { name: 'specks.png' });
  const { label } = palette(decodePng(image, 'specks.png').rgba, W, H, 8);
  // What clearSmall leaves of each colour is what the tool traces: its kept outlines and no more.
  const left = report.colours.map((colour, c) => {
    const { mask, cols, rows } = maskOf(label, W, H, c);
    assert.equal(clearSmall(mask, cols, rows, 4), colour.dropped);
    return isolines(mask, cols - 1, rows - 1, 0.5).paths.length;
  });
  const kept = report.colours.map((c) => c.outlines.length), dropped = report.colours.reduce((s, c) => s + c.dropped, 0);
  assert.ok(dropped > 20000, `${dropped} dropped`);
  assert.deepEqual(left, kept, `${left} loops left to trace for ${kept} outlines kept and ${dropped} dropped`);
  // What the tool itself walks: a variant that traces every loop and then drops the small ones walks them all.
  const traced = report.colours.map((_, c) => outlines(label, W, H, c, { tolerance: 1, minArea: 4 }).traced);
  assert.deepEqual(traced, kept, `${traced} loops traced for ${kept} outlines kept and ${dropped} dropped`);
});

test('a region with holes is skipped before tracing when its outer outline encloses less than --min-area', () => {
  // A mask's rows with its empty border, # for 1.
  const grid = (...lines) => ({ mask: Uint8Array.from(lines.join(''), (ch) => ch === '#' ? 1 : 0), cols: lines[0].length, rows: lines.length });
  const ones = (mask) => mask.reduce((s, v) => s + v, 0);
  const ring = () => grid('.....', '.###.', '.#.#.', '.###.', '.....');
  // A 3 x 3 ring encloses 8.5 inside its bounding box of 9, and its hole 0.5.
  let m = ring();
  assert.equal(clearSmall(m.mask, m.cols, m.rows, 8.6), 2, 'both outlines dropped');
  assert.equal(ones(m.mask), 0, 'nothing left to trace');
  m = ring();
  assert.equal(clearSmall(m.mask, m.cols, m.rows, 8.5), 1, 'the hole dropped');
  assert.equal(ones(m.mask), 9, 'the ring left with its hole filled');
  // A 5 x 5 ring encloses 24.5, its 3 x 3 hole 8.5 and the dot in the hole 0.5.
  m = grid('.......', '.#####.', '.#...#.', '.#.#.#.', '.#...#.', '.#####.', '.......');
  assert.equal(clearSmall(m.mask, m.cols, m.rows, 25), 3, 'all three outlines dropped');
  assert.equal(ones(m.mask), 0, 'nothing left to trace');
});

// 320 x 240 smooth colour waves with per-pixel noise, like a noisy photo, and
// 200 x 150 pixels each one of 8 flat colours at random.
const photoLike = (() => {
  const r = random(784), noisy = (v) => Math.max(0, Math.min(255, Math.round(v + (r() - 0.5) * 40)));
  return rgbaPng(320, 240, (x, y) => [noisy(128 + 100 * Math.sin(x / 31 + Math.cos(y / 27))),
    noisy(128 + 100 * Math.sin(y / 23 + 2 * Math.sin(x / 41))), noisy(128 + 100 * Math.cos((x + y) / 35))]);
})();
const EIGHT = [[0, 0, 0], WHITE, RED, BLUE, [20, 160, 60], [240, 200, 20], [140, 40, 160], [20, 200, 200]];
const eightColours = (() => { const r = random(8); return rgbaPng(200, 150, () => EIGHT[Math.floor(r() * 8)]); })();

test('outlines are walked by the tool itself, never chained through core isolines, with the report unchanged', (t) => {
  const field = require('../core/field.js'), original = field.isolines, tool = require.resolve('../tools/measure-reference.js');
  let segments = 0;
  field.isolines = (...args) => { const out = original(...args); segments += out.segments.length; return out; };
  delete require.cache[tool];
  t.after(() => { field.isolines = original; delete require.cache[tool]; });
  const fresh = require(tool);
  let kept = 0;
  for (const [name, bytes] of [['photo-like.png', photoLike], ['eight.png', eightColours]]) {
    for (const minArea of [0, 1, 4, 25]) {
      const report = fresh.measure(bytes, { name, minArea });
      assert.equal(sameAsTracingEverything(bytes, report, minArea), '', name);
      kept += report.colours.reduce((s, c) => s + c.outlines.length, 0);
    }
  }
  assert.ok(kept > 10000, `${kept} outlines kept`);
  assert.equal(segments, 0, `${segments} segments chained through core isolines for ${kept} outlines kept`);
});

test('the report holds measurements only, the same on every run', () => {
  const report = measure(flat, { name: 'flat.png' });
  assert.deepEqual(measure(flat, { name: 'flat.png' }), report);
  assert.deepEqual(Object.keys(report), ['file', 'size', 'pixels', 'transparent', 'colours', 'options']);
  for (const colour of report.colours) {
    assert.deepEqual(Object.keys(colour), ['hex', 'rgb', 'pixels', 'share', 'outlines', 'dropped']);
    for (const o of colour.outlines) assert.deepEqual(Object.keys(o), ['points', 'area', 'hole', 'bbox']);
  }
  assert.deepEqual(report.options, { colors: 8, tolerance: 1, minArea: 4 });
});

test('measure: a refused argument is named, then the usage line', async (t) => {
  for (const [args, cause] of [
    [['--bogus'], 'measure: unknown option --bogus'],
    [['a.png', 'b.png'], 'measure: one image at a time, got "a.png" and "b.png"'],
    [[], 'measure: name the PNG to measure'],
    [['a.png', '--colors', '0'], 'measure: --colors takes a whole number from 1 to 32, got 0'],
    [['a.png', '--colors', '33'], 'measure: --colors takes a whole number from 1 to 32, got 33'],
    [['a.png', '--colors', '2.5'], 'measure: --colors takes a whole number from 1 to 32, got 2.5'],
    [['a.png', '--colors'], 'measure: --colors takes a whole number from 1 to 32, got nothing'],
    [['a.png', '--colors', '--out', 'a.json'], 'measure: --colors takes a whole number from 1 to 32, got nothing'],
    [['a.png', '--tolerance', '-1'], 'measure: --tolerance takes a number of pixels, 0 or more, got -1'],
    [['a.png', '--tolerance', ''], 'measure: --tolerance takes a number of pixels, 0 or more, got '],
    [['a.png', '--min-area', 'x'], 'measure: --min-area takes a number of square pixels, 0 or more, got x'],
    [['a.png', '--min-area', 'Infinity'], 'measure: --min-area takes a number of square pixels, 0 or more, got Infinity'],
    [['a.png', '--out'], 'measure: --out needs a .json file'],
    [['a.png', '--out', 'a.txt'], 'measure: --out must name a .json file, got a.txt'],
    [['a.png', '--colors', '2', '--colors', '3'], 'measure: give --colors only once'],
  ]) await t.test(args.join(' ') || '(none)', () => assert.throws(() => parseArgs(args), refusal(cause)));
  assert.deepEqual(parseArgs(['a.png', '--colors', '3', '--tolerance', '0', '--min-area', '0.5', '--out', 'm.json']),
    { file: 'a.png', colors: 3, tolerance: 0, minArea: 0.5, out: 'm.json' });
});

test('the command prints the report, or writes it with --out and prints one line', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-measure-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'flat.png'), flat);
  const log = t.mock.method(console, 'log', () => {});

  main(['flat.png'], dir);
  assert.equal(log.mock.callCount(), 1);
  const printed = log.mock.calls[0].arguments[0];
  assert.doesNotMatch(printed, /\n/);
  assert.deepEqual(JSON.parse(printed), measure(flat, { name: 'flat.png' }));

  main(['flat.png', '--out', 'sub/flat.json', '--colors', '3'], dir);
  const target = path.join(dir, 'sub', 'flat.json');
  assert.equal(JSON.parse(fs.readFileSync(target, 'utf8')).colours.length, 3);
  assert.match(log.mock.calls[1].arguments[0], /^measure: .+flat\.json: 40 x 30, 3 colours, 7 outlines$/);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['flat.png', 'sub'], 'nothing else is written');

  assert.throws(() => main(['missing.png'], dir), refusal(`measure: no file at ${path.join(dir, 'missing.png')}; name a PNG file`));
  main(['--help'], dir);
  assert.match(log.mock.calls[2].arguments[0], /^usage: npm run measure -- <reference\.png>/);
});

test('the command exits 1 with the refusal on stderr', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/measure-reference.js'), 'nofile.png'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr.trim(), refusal(`measure: no file at ${path.join(ROOT, 'nofile.png')}; name a PNG file`).message);
  assert.equal(r.stdout, '');
});
