'use strict';

// Photosensitive flashes counted in finished frames (core/flash.js), against
// synthetic frame sequences whose flashes are known: WCAG 2.2's general and red
// thresholds, its three flashes a second and its area rule.

const test = require('node:test');
const assert = require('node:assert/strict');

const vm = require('node:vm');

const { flashCounter, flashReader, flashNote, WCAG } = require('../core/flash.js');
const { filmNote, filmSaved } = require('../core/export.js');

/**
 * The counter's result for `frames` frames of `w` x `h` at `hz`, each pixel
 * painted by `paint(frame, x, y)` as [r, g, b], opaque.
 */
function count({ w = 64, h = 48, hz = 24, frames = 48, paint }) {
  const counter = flashCounter(w, h, hz);
  const px = new Uint8ClampedArray(w * h * 4);
  for (let f = 0; f < frames; f++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const q = (y * w + x) * 4;
        px.set(paint(f, x, y), q);
        px[q + 3] = 255;
      }
    }
    counter.add(px);
  }
  return counter.result();
}

/** A square wave that switches `rate` times a second each way: on in its second half-cycle. */
const on = (rate, hz) => (f) => Math.floor((f * 2 * rate) / hz) % 2 === 1;
/** The whole frame swinging between two colours `rate` times a second. */
const swing = (rate, hz, high, low) => (f) => (on(rate, hz)(f) ? high : low);
const WHITE = [255, 255, 255], BLACK = [0, 0, 0];

test('a whole frame swinging white to black 4 times a second is flagged, 3 times a second is not', () => {
  const four = count({ paint: swing(4, 24, WHITE, BLACK) });
  assert.equal(four.worst.flashes, 4);
  assert.equal(four.worst.kind, 'general');
  assert.equal(four.general, 7, 'two seconds of 4 a second: fifteen changes, seven whole flashes');
  assert.equal(four.red, 0);
  assert.match(flashNote(four), /flashes 4 times in the second from 0\.125 s \(brightness/);

  const three = count({ paint: swing(3, 24, WHITE, BLACK) });
  assert.equal(three.worst.flashes, 3);
  assert.equal(flashNote(three), '', 'three a second is allowed');
  // At 25 frames a second a 3 a second swing changes on the nearest frames,
  // and a second can hold seven changes: still three whole flashes.
  const rounded = count({ hz: 25, frames: 50, paint: swing(3, 25, WHITE, BLACK) });
  assert.equal(rounded.worst.flashes, 3);
});

test('a swing under the general threshold, or between two bright states, is no flash', () => {
  // 90 to 100 in sRGB moves relative luminance by about 0.02.
  assert.deepEqual(count({ paint: swing(6, 24, [100, 100, 100], [90, 90, 90]) }), { general: 0, red: 0, worst: null });
  // White to 235 changes by 0.17, but the darker state, 0.83, is not below 0.8.
  assert.deepEqual(count({ paint: swing(6, 24, WHITE, [235, 235, 235]) }), { general: 0, red: 0, worst: null });
  // The same change with its darker state just under 0.8 flashes.
  assert.equal(count({ paint: swing(6, 24, WHITE, [225, 225, 225]) }).worst.flashes, 6);
});

test('a slow swing whose frames each change less than the threshold still flashes', () => {
  // 4 a second, 0.14 from valley to peak, never more than 0.07 from one frame to the next.
  const lum = (f) => 0.3 + 0.07 * Math.sin((2 * Math.PI * 4 * f) / 24);
  const srgb = (l) => Math.round(255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055));
  const r = count({ paint: (f) => { const v = srgb(lum(f)); return [v, v, v]; } });
  assert.equal(r.worst.flashes, 4);
});

test('saturated red too dark to flash in brightness counts as a red flash', () => {
  // #5a0000 is about 0.02 in relative luminance, so on black it is no general flash.
  const red = count({ paint: swing(5, 24, [90, 0, 0], BLACK) });
  assert.equal(red.general, 0);
  assert.equal(red.worst.kind, 'red');
  assert.equal(red.worst.flashes, 5);
  assert.match(flashNote(red), /\(saturated red/);
  // As dark a green moves as far in chromaticity, but it is not red. Nor is a
  // crimson whose R / (R + G + B) is about 0.7, though it swings far from blue.
  assert.deepEqual(count({ paint: swing(5, 24, [0, 60, 0], BLACK) }), { general: 0, red: 0, worst: null });
  assert.deepEqual(count({ paint: swing(5, 24, [90, 0, 60], [0, 0, 90]) }), { general: 0, red: 0, worst: null });
  // Red to a darker red keeps its chromaticity: a general flash, not a red one.
  const dimmer = count({ paint: swing(5, 24, [255, 0, 0], [90, 0, 0]) });
  assert.equal(dimmer.red, 0);
  assert.equal(dimmer.worst.kind, 'general');
});

test('a small flashing area under the area rule is not counted, one over it is', () => {
  // A 64-pixel long edge makes a field 21.3 x 16 pixels; 25% of it is 85 pixels.
  const square = (side) => (f, x, y) => (x >= 20 && x < 20 + side && y >= 20 && y < 20 + side && on(4, 24)(f) ? WHITE : BLACK);
  assert.deepEqual(count({ paint: square(9) }), { general: 0, red: 0, worst: null }, '81 pixels is under 25% of a field');
  const over = count({ paint: square(10) });
  assert.equal(over.worst.flashes, 4, '100 pixels is over it');
  assert.equal(WCAG.area, 0.25);
  // The field is reported in the frame's units, to whole pixels: it holds most of the square.
  const r = over.worst;
  const inside = (Math.min(r.x + r.w, 30) - Math.max(r.x, 20)) * (Math.min(r.y + r.h, 30) - Math.max(r.y, 20));
  assert.ok(inside >= 80, 'the field holds ' + inside + ' of the square\'s pixels');
  // A bar sweeping across the frame changes every pixel it passes, but never enough of a field at once.
  assert.deepEqual(count({ frames: 96, paint: (f, x) => (Math.abs(x - ((f * 2) % 64)) < 6 ? WHITE : BLACK) }), { general: 0, red: 0, worst: null });
});

test('a frame brightening in steps, never darkening, is no flash', () => {
  // Five steps, each 0.1 or more in relative luminance: all rises.
  const stairs = count({ paint: (f) => { const v = [40, 100, 150, 200, 250][Math.min(4, Math.floor(f / 4))]; return [v, v, v]; } });
  assert.deepEqual(stairs, { general: 0, red: 0, worst: null });
});

test('a flash is dated from the frame its first change happens in', () => {
  // Grey for 30 frames, then white and black 4 times a second.
  const late = count({ frames: 60, paint: (f) => (f < 30 ? [150, 150, 150] : on(4, 24)(f - 30) ? BLACK : WHITE) });
  assert.equal(late.worst.start, 1.25);
  assert.equal(late.worst.flashes, 4);
});

test('grain boiling on two areas that changed opposite ways makes no flashes', () => {
  // The left half steps up and the right half down, once, as a scene change can;
  // then every pixel boils by up to 0.02 in luminance on every frame.
  let seed = 7;
  const grain = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 12; };
  const r = count({ frames: 72, paint: (f, x) => {
    const base = f < 12 ? 110 : x < 32 ? 190 : 40;
    const v = Math.round(base + (f < 12 ? 0 : grain()));
    return [v, v, v];
  } });
  assert.ok(!r.worst || r.worst.flashes <= 1, 'one rise and one fall at most: ' + JSON.stringify(r.worst));
});

/** A stand-in 2D canvas that copies pixels one to one, enough for the flash reader at full size. */
class Canvas {
  constructor(w, h) { this.width = w; this.height = h; this.px = new Uint8ClampedArray(w * h * 4); }
  getContext() { return this; }
  clearRect(x, y, w, h) { for (let r = y; r < y + h; r++) this.px.fill(0, (r * this.width + x) * 4, (r * this.width + x + w) * 4); }
  drawImage(src, sx, sy, sw = src.width, sh = src.height, dx = sx, dy = sy) {
    if (arguments.length === 3) { dx = sx; dy = sy; sx = sy = 0; }
    for (let r = 0; r < sh; r++) this.px.set(src.px.subarray(((sy + r) * src.width + sx) * 4, ((sy + r) * src.width + sx + sw) * 4), ((dy + r) * this.width + dx) * 4);
  }
  getImageData(x, y, w, h) { const c = new Canvas(w, h); c.drawImage(this, x, y, w, h, 0, 0); return { data: c.px }; }
}

/**
 * Runs `work` with a browser's worker globals standing in, restoring Node's
 * after: a worker whose source runs by itself, with only the globals a browser
 * worker has. `fail` makes it fail: 'construct' refuses the worker, 'async'
 * fails it once it is sent a stack, and 'bitmap' fails the bitmap of a stack.
 * Resolves to what `work` resolves to, with how many workers were made and stopped.
 */
async function withWorkers(work, fail = null) {
  const saved = { Worker: global.Worker, OffscreenCanvas: global.OffscreenCanvas, createImageBitmap: global.createImageBitmap, Blob: global.Blob, URL: global.URL };
  const sources = [];
  const workers = { made: 0, stopped: 0 };
  Object.assign(global, {
    Blob: class { constructor(parts) { this.text = parts.join(''); } },
    URL: { createObjectURL: (b) => { sources.push(b.text); return 'blob:' + (sources.length - 1); }, revokeObjectURL() {} },
    OffscreenCanvas: Canvas,
    createImageBitmap: async (c, x, y, bw, bh) => {
      if (fail === 'bitmap') throw new Error('no bitmap');
      return Object.assign(new Canvas(bw, bh), { px: c.getImageData(x, y, bw, bh).data, close() {} });
    },
    Worker: class {
      constructor(url) {
        if (fail === 'construct') throw new Error('refused by the page\'s policy');
        workers.made++;
        this.inside = vm.createContext({ OffscreenCanvas: Canvas, postMessage: (data) => setImmediate(() => this.onmessage({ data })) });
        vm.runInContext(sources[Number(url.slice(5))], this.inside);
      }
      postMessage(data) {
        if (fail === 'async') setImmediate(() => this.onerror({ message: 'worker lost', preventDefault() {} }));
        else setImmediate(() => this.inside.onmessage({ data }));
      }
      terminate() { workers.stopped++; }
    },
  });
  try {
    // A worker's answer arrives cloned, as the stand-in's would from its own realm.
    return { result: structuredClone(await work()), workers };
  } finally { Object.assign(global, saved); }
}

/** 25 frames at 10 a second, read through a flash reader; with `redraw`, a failed worker's frames are drawn again. */
async function readFrames(redraw) {
  const w = 64, h = 48, hz = 10;
  const frame = new Canvas(w, h);
  const paint = (f) => {
    for (let p = 0; p < w * h; p++) { frame.px.set(p % w < 40 && on(4, hz)(f) ? WHITE : [200, 0, 0], p * 4); frame.px[p * 4 + 3] = 255; }
    return frame;
  };
  const reader = flashReader((cw, ch) => new Canvas(cw, ch), w, h, hz);
  for (let f = 0; f < 25; f++) reader.read(paint(f));
  return reader.result({ w: 640, h: 480 }, redraw && (async (read) => { for (let f = 0; f < 25; f++) read(paint(f)); }));
}

test('the flash reader counts the same in a worker as on the page', async () => {
  const here = await readFrames();
  assert.equal(here.worst.flashes, 4);
  const { result, workers } = await withWorkers(readFrames);
  assert.deepEqual(result, here);
  assert.deepEqual(workers, { made: 1, stopped: 1 }, 'the counter ran in a worker, stopped once it answered');
});

test('the flash reader counts on the page when the page refuses its worker', async () => {
  const { result, workers } = await withWorkers(readFrames, 'construct');
  assert.deepEqual(result, await readFrames());
  assert.equal(workers.made, 0);
});

test('the flash reader counts every frame again on the page when its worker fails part-way', async () => {
  const here = await readFrames();
  for (const fail of ['async', 'bitmap']) {
    const { result, workers } = await withWorkers(() => readFrames(true), fail);
    assert.deepEqual(result, here, fail);
    assert.deepEqual(workers, { made: 1, stopped: 1 }, fail);
    // Without frames to draw again, the lost count is an error.
    await assert.rejects(withWorkers(() => readFrames(), fail), /no bitmap|flash count: worker lost/);
  }
});

test('the film note warns of flashes only past three a second', () => {
  const report = {
    frames: 48, width: 64, height: 48, seconds: 2, bytes: 4096, conversion: 'cpu', convertMs: 5, drawMs: 9, totalMs: 20, realtime: 100,
  };
  const worst = (flashes) => ({ general: flashes, red: 0, worst: { kind: 'general', start: 0.5, flashes, x: 0, y: 0, w: 320, h: 240 } });
  assert.doesNotMatch(filmNote({ ...report, flashes: worst(3) }), /Warning/);
  assert.doesNotMatch(filmNote({ ...report, flashes: { general: 0, red: 0, worst: null } }), /Warning/);
  assert.match(filmNote({ ...report, flashes: worst(4) }),
    /100x real time\)\. Warning: it flashes 4 times in the second from 0\.5 s \(brightness, in the 320 x 240 area at 0, 0\), more than the three a second WCAG 2\.3\.1 allows/);
  // The announced sentence keeps the warning.
  assert.match(filmSaved({ ...report, flashes: worst(4) }), /^Saved the MP4 film: .* kB\. Warning: it flashes 4 times/);
});
