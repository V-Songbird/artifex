// Photosensitive flashes in a film's finished frames, counted as WCAG 2.2
// counts them: Success Criterion 2.3.1, Three Flashes or Below Threshold, with
// its glossary's general flash and red flash thresholds.
//
// Each frame is read small (flashReader), at most LONG pixels on its long edge,
// so one pixel spans about 0.1 degree of the field below: a pattern finer than
// that averages out, as WCAG exempts a fine, balanced pattern of squares under
// 0.1 degree. Every pixel is followed through time twice: by its relative
// luminance, and by its chromaticity's distance from sRGB red in CIE 1976 u'v'.
// A transition is the change between adjacent peaks and valleys of that plot:
// a peak or valley is confirmed once the value turns back by the threshold.
//
//   general  a transition of 0.1 or more in relative luminance, where the
//            darker state is below 0.8;
//   red      a transition to or from a state whose R / (R + G + B) is 0.8 or
//            more, the two states more than 0.2 apart in u'v'. Black takes the
//            white point's chromaticity, so red to black is a red transition.
//
// The area rule: a transition counts only where the pixels making it together,
// in the same direction and in the same frames, cover more than 25% of a
// 10 degree visual field. WCAG takes a 341 x 256 rectangle of a 1024 x 768
// screen for that field. Here the film's long edge stands for the screen's
// 1024 pixels, as though the film filled it: the field is a third of the long
// edge across and a quarter of it down, anywhere in the frame, in steps of one
// cell, a 24th of the long edge. A flash is a rise and a fall, so a second
// holds as many flashes in a field as the fewer of the rises and the falls that
// begin in it there: one part turning lighter while another turns darker, or a
// picture brightening in steps, is no flash.
//
// A transition slower than a second is counted from its last second, and a
// film that loops is not counted across its seam.

const WCAG = { luminance: 0.1, darker: 0.8, red: 0.8, chroma: 0.2, area: 0.25, flashes: 3 };
const LONG = 300;
const CELLS = 24;
const FIELD = [8, 6];
// The tallest stack of small frames read back at once, in pixels.
const STACK = 8192;

const LINEAR = Float64Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
// Each 8-bit sRGB value's share of relative luminance, by channel.
const SHARE = [0.2126, 0.7152, 0.0722].map((k) => LINEAR.map((c) => k * c));
// u'v' of D65 white and of the sRGB red primary.
const WHITE = [0.1978, 0.4683];
const RED = [4 * 0.4124 / (0.4124 + 15 * 0.2126 + 3 * 0.0193), 9 * 0.2126 / (0.4124 + 15 * 0.2126 + 3 * 0.0193)];

/**
 * Counts the flashes in `width` x `height` RGBA frames at `hz` frames a
 * second: `add(rgba)` takes each frame in order, translucent pixels over
 * black, and `result(box)` gives { general, red, worst } (see result).
 */
function flashCounter(width, height, hz) {
  const n = width * height;
  const long = Math.max(width, height);
  const cols = Math.ceil((width * CELLS) / long), rows = Math.ceil((height * CELLS) / long);
  const cells = cols * rows;
  const cellOf = new Int32Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) cellOf[y * width + x] = Math.floor((y * CELLS) / long) * cols + Math.floor((x * CELLS) / long);
  }
  // Fields slide a cell at a time; a frame narrower than a field is one field wide.
  const fw = Math.min(FIELD[0], cols), fh = Math.min(FIELD[1], rows);
  const across = cols - fw + 1, down = rows - fh + 1;
  const fields = across * down;
  const enough = WCAG.area * (long / 3) * (long / 4);
  const ring = Math.max(2, Math.ceil(hz));
  // Pixels in a transition, by frame slot, kind, direction and cell.
  const marks = new Uint16Array(ring * 4 * cells);

  const followers = [follower(0, WCAG.luminance), follower(1, WCAG.chroma)];
  // By field, kind and direction: whether the field changed that way on the
  // frame before, how many changes it made, and when it began those of the last second.
  const changing = new Uint8Array(fields * 4);
  const total = new Int32Array(fields * 4);
  const recent = Array.from({ length: fields * 4 }, () => []);
  let worst = null;
  let frame = 0;
  let counted = false;

  // Follows every pixel's plot for one kind: 0 general, by luminance, or 1 red,
  // by distance from red, keeping each end's chromaticity and whether it is
  // saturated red. Until a pixel first moves by `step`, pivot and ext hold its
  // lowest and highest values so far. A leg reaches a new extreme only by
  // `slack`, a quarter of the step, so noise at a held level, such as boiling
  // grain, neither extends a transition nor turns it.
  function follower(kind, step) {
    const slack = step / 4;
    const value = new Float32Array(n), dir = new Int8Array(n);
    const pivot = new Float32Array(n), ext = new Float32Array(n), level = new Float32Array(n);
    // The frames a leg's marks start after: `from`, the last frame not past the
    // level already marked (before the first move, the last near the lowest
    // value), and `near`, the last within slack of the extreme, where the next
    // leg starts; `marked`, the last frame marked.
    const from = new Int32Array(n), near = new Int32Array(n), marked = new Int32Array(n);
    const pu = new Float32Array(n), pv = new Float32Array(n), pr = new Uint8Array(n);
    const eu = new Float32Array(n), ev = new Float32Array(n), er = new Uint8Array(n);
    const offset = kind * 2 * cells;

    // A leg at a new extreme marks its frames since `from`, once it qualifies.
    function reached(p, f) {
      if (kind === 0) {
        if (Math.abs(ext[p] - pivot[p]) < WCAG.luminance || Math.min(ext[p], pivot[p]) >= WCAG.darker) return;
      } else if (!(pr[p] || er[p]) || (eu[p] - pu[p]) * (eu[p] - pu[p]) + (ev[p] - pv[p]) * (ev[p] - pv[p]) <= WCAG.chroma * WCAG.chroma) return;
      const at = offset + (dir[p] > 0 ? 0 : cells) + cellOf[p];
      for (let g = Math.max(from[p], marked[p], f - ring) + 1; g <= f; g++) marks[(g % ring) * 4 * cells + at]++;
      marked[p] = f;
      level[p] = ext[p];
    }
    function toExt(p, x, u, v, red) {
      ext[p] = x; eu[p] = u; ev[p] = v; er[p] = red;
    }
    function toPivot(p, x, u, v, red) {
      pivot[p] = x; pu[p] = u; pv[p] = v; pr[p] = red;
    }
    // The frames a pixel's value leaves `from` and `near` at.
    function keep(p, x, f) {
      const d = dir[p];
      if (d === 0) {
        if (x - pivot[p] < slack) from[p] = f;
        if (ext[p] - x < slack) near[p] = f;
      } else {
        if (d * (x - level[p]) <= 0) from[p] = f;
        if (d * (ext[p] - x) < slack) near[p] = f;
      }
    }
    return {
      // The pixel holds last frame's colour.
      hold(p, f) { keep(p, value[p], f); },
      // The pixel's first frame followed.
      start(p, x, f, u, v, red) {
        value[p] = x; dir[p] = 0; from[p] = near[p] = marked[p] = f;
        toPivot(p, x, u, v, red); toExt(p, x, u, v, red);
      },
      follow(p, x, f, u, v, red) {
        value[p] = x;
        const d = dir[p];
        if (d === 0) {
          if (x > ext[p]) toExt(p, x, u, v, red);
          else if (x < pivot[p]) toPivot(p, x, u, v, red);
          if (ext[p] - pivot[p] < step) { keep(p, x, f); return; }
          // The first move by step, toward the extreme this frame reached.
          if (x === ext[p]) { dir[p] = 1; level[p] = pivot[p] + slack; }
          else {
            toPivot(p, ext[p], eu[p], ev[p], er[p]); toExt(p, x, u, v, red);
            dir[p] = -1; from[p] = near[p]; level[p] = pivot[p] - slack;
          }
          near[p] = f;
          reached(p, f);
        } else if (d * (x - ext[p]) >= slack) {
          toExt(p, x, u, v, red);
          near[p] = f;
          reached(p, f);
        } else if (d * (ext[p] - x) >= step) {
          // Turned back by the threshold: the extreme is confirmed, and a new leg starts from it.
          toPivot(p, ext[p], eu[p], ev[p], er[p]); toExt(p, x, u, v, red);
          dir[p] = -d; from[p] = near[p]; near[p] = f; level[p] = pivot[p] - d * slack;
          reached(p, f);
        } else keep(p, x, f);
      },
    };
  }

  // Frame f can take no more marks: judge every field on it.
  const sum = new Int32Array((cols + 1) * (rows + 1));
  function settle(f) {
    const slot = f % ring;
    for (let kind = 0; kind < 2; kind++) {
      for (let s = 0; s < 2; s++) {
        const base = ((slot * 2 + kind) * 2 + s) * cells;
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            sum[(y + 1) * (cols + 1) + x + 1] = marks[base + y * cols + x] + sum[y * (cols + 1) + x + 1] + sum[(y + 1) * (cols + 1) + x] - sum[y * (cols + 1) + x];
          }
        }
        for (let w = 0; w < fields; w++) {
          const x0 = w % across, y0 = Math.floor(w / across);
          const area = sum[(y0 + fh) * (cols + 1) + x0 + fw] - sum[y0 * (cols + 1) + x0 + fw] - sum[(y0 + fh) * (cols + 1) + x0] + sum[y0 * (cols + 1) + x0];
          const at = (w * 2 + kind) * 2;
          const was = changing[at + s];
          changing[at + s] = area > enough ? 1 : 0;
          if (!changing[at + s] || was) continue;
          // A change begins: a flash is a rise and a fall, so a second holds as many
          // as the fewer of its rises and falls.
          total[at + s]++;
          const q = recent[at + s];
          q.push(f);
          while (recent[at].length && recent[at][0] <= f - hz) recent[at].shift();
          while (recent[at + 1].length && recent[at + 1][0] <= f - hz) recent[at + 1].shift();
          const flashes = Math.min(recent[at].length, recent[at + 1].length);
          if (flashes && (!worst || flashes > worst.flashes)) worst = { kind, start: Math.min(recent[at][0], recent[at + 1][0]), flashes, x0, y0 };
        }
        marks.fill(0, base, base + cells);
      }
    }
  }

  // The red follower starts on a pixel's first saturated red, from its colour
  // the frame before: a pixel never red makes no red transition.
  const held = new Uint32Array(n);
  const reddened = new Uint8Array(n);
  const colour = new Float64Array(3);
  function toRed(method, p, r, g, b, f) {
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const X = 0.4124 * r + 0.3576 * g + 0.1805 * b, Z = 0.0193 * r + 0.1192 * g + 0.9505 * b;
    const den = X + 15 * lum + 3 * Z;
    const u = den > 0 ? (4 * X) / den : WHITE[0], v = den > 0 ? (9 * lum) / den : WHITE[1];
    const sat = r + g + b > 0 && r >= WCAG.red * (r + g + b) ? 1 : 0;
    followers[1][method](p, Math.sqrt((u - RED[0]) * (u - RED[0]) + (v - RED[1]) * (v - RED[1])), f, u, v, sat);
  }
  // A colour as linear sRGB, translucent pixels over black.
  function linear(word, out) {
    const a = word >>> 24;
    for (let c = 0; c < 3; c++) {
      const e = (word >>> (8 * c)) & 255;
      out[c] = LINEAR[a === 255 ? e : Math.round((e * a) / 255)];
    }
  }
  function add(rgba) {
    const f = frame++;
    if (f >= ring) settle(f - ring);
    const words = new Uint32Array(rgba.buffer, rgba.byteOffset, n);
    const [general, red] = followers;
    const [LR, LG, LB] = SHARE;
    for (let p = 0; p < n; p++) {
      const word = words[p];
      if (f && word === held[p]) {
        general.hold(p, f);
        if (reddened[p]) red.hold(p, f);
        continue;
      }
      const before = held[p];
      held[p] = word;
      let r8 = word & 255, g8 = (word >>> 8) & 255, b8 = (word >>> 16) & 255;
      const a8 = word >>> 24;
      if (a8 !== 255) { r8 = Math.round((r8 * a8) / 255); g8 = Math.round((g8 * a8) / 255); b8 = Math.round((b8 * a8) / 255); }
      if (f === 0) general.start(p, LR[r8] + LG[g8] + LB[b8], f, 0, 0, 0);
      else general.follow(p, LR[r8] + LG[g8] + LB[b8], f, 0, 0, 0);
      if (!reddened[p]) {
        const r = LINEAR[r8];
        if (!(r > 0 && r >= WCAG.red * (r + LINEAR[g8] + LINEAR[b8]))) continue;
        reddened[p] = 1;
        if (f === 0) { toRed('start', p, r, LINEAR[g8], LINEAR[b8], f); continue; }
        linear(before, colour);
        toRed('start', p, colour[0], colour[1], colour[2], f - 1);
      }
      toRed('follow', p, LINEAR[r8], LINEAR[g8], LINEAR[b8], f);
    }
  }

  /**
   * The flashes counted: `general` and `red`, the most flashes of that kind
   * any one field makes over the film, and `worst`, the second holding the
   * most flashes in one field: { kind, start, flashes, x, y, w, h }, `start`
   * in seconds and the field in `box`'s units (the frame's own by default),
   * or null when no field flashes.
   */
  function result(box = { w: width, h: height }) {
    if (!counted) for (let f = Math.max(0, frame - ring); f < frame; f++) settle(f);
    counted = true;
    const most = (kind) => Math.max(0, ...Array.from({ length: fields }, (_, w) => Math.min(total[(w * 2 + kind) * 2], total[(w * 2 + kind) * 2 + 1])));
    const k = box.w / width, j = box.h / height;
    const cell = long / CELLS;
    return {
      general: most(0),
      red: most(1),
      worst: worst && {
        kind: worst.kind ? 'red' : 'general',
        start: Math.round((worst.start / hz) * 1000) / 1000,
        flashes: worst.flashes,
        x: Math.round(worst.x0 * cell * k), y: Math.round(worst.y0 * cell * j),
        w: Math.round(Math.min(width - worst.x0 * cell, fw * cell) * k), h: Math.round(Math.min(height - worst.y0 * cell, fh * cell) * j),
      },
    };
  }

  return { add, result };
}

// Run in a worker: copies each stack of `h`-pixel frames it is sent onto a
// canvas kept in memory, reads it back and counts it, and answers a `box` with
// the result.
function countInWorker(w, h, hz, tiles) {
  const counter = flashCounter(w, h, hz);
  const kg = new OffscreenCanvas(w, h * tiles).getContext('2d', { willReadFrequently: true });
  onmessage = ({ data }) => {
    if ('box' in data) { postMessage(counter.result(data.box)); return; }
    kg.clearRect(0, 0, w, h * data.frames);
    kg.drawImage(data.bitmap, 0, 0);
    data.bitmap.close();
    const px = kg.getImageData(0, 0, w, h * data.frames).data;
    for (let i = 0; i < data.frames; i++) counter.add(px.subarray(i * w * h * 4, (i + 1) * w * h * 4));
  };
}

/** The source of a worker that counts `w` x `h` frames at `hz`, `tiles` to a stack. */
function workerSource(w, h, hz, tiles) {
  return [
    `const WCAG = ${JSON.stringify(WCAG)}, CELLS = ${CELLS}, FIELD = ${JSON.stringify(FIELD)};`,
    `const LINEAR = Float64Array.from(${JSON.stringify(Array.from(LINEAR))});`,
    `const SHARE = ${JSON.stringify(SHARE.map((s) => Array.from(s)))}.map((s) => Float64Array.from(s));`,
    `const WHITE = ${JSON.stringify(WHITE)}, RED = ${JSON.stringify(RED)};`,
    String(flashCounter),
    `(${countInWorker})(${w}, ${h}, ${hz}, ${tiles});`,
  ].join('\n');
}

/**
 * Reads each finished frame of a `width` x `height` canvas small: `read(canvas)`
 * shrinks the frame onto the next tile of a canvas of its own, made with
 * `createCanvas`, that stays where the browser draws it, and once a second of
 * frames is stacked there it is read back at once and counted. The film's own
 * canvas is never read back, so a canvas the browser draws on the GPU stays
 * there. Where the browser has workers, the stack is handed to one as an
 * ImageBitmap, and the read back, which waits for the browser to finish
 * drawing, and the count both run there, alongside the export; elsewhere they
 * run here, through a second canvas kept in memory. `result(box, redraw)`
 * counts the frames still stacked and resolves to flashCounter's result. A
 * worker that fails part-way has lost its count, so the frames are counted
 * again here: `redraw(read)` draws every frame again, in order, handing each
 * to `read`; without it the failure is thrown. `close()` stops the worker of
 * an export that ends early.
 */
function flashReader(createCanvas, width, height, hz) {
  const k = Math.min(1, LONG / Math.max(width, height));
  const w = Math.max(1, Math.round(width * k)), h = Math.max(1, Math.round(height * k));
  const tiles = Math.max(1, Math.min(Math.ceil(hz), Math.floor(STACK / h)));
  const stack = createCanvas(w, h * tiles);
  const sg = stack.getContext('2d');
  sg.imageSmoothingQuality = 'high';
  let stacked = 0;
  let kg = null, counter = null, worker = null, url = null, answer = null, queue = Promise.resolve();
  if (typeof Worker === 'function' && typeof OffscreenCanvas === 'function' && typeof createImageBitmap === 'function') {
    url = URL.createObjectURL(new Blob([workerSource(w, h, hz, tiles)], { type: 'text/javascript' }));
    // A page whose policy refuses the worker counts here instead.
    try { worker = new Worker(url); } catch (e) { URL.revokeObjectURL(url); }
  }
  // Counting here, through a second canvas kept in memory.
  function here() {
    kg = createCanvas(w, h * tiles).getContext('2d', { willReadFrequently: true });
    counter = flashCounter(w, h, hz);
  }
  if (worker) {
    answer = new Promise((resolve, reject) => {
      worker.onmessage = (e) => resolve(e.data);
      worker.onerror = (e) => { e.preventDefault(); reject(new Error('flash count: ' + (e.message || 'the counting worker failed'))); };
    });
    answer.catch(() => {});
  } else here();
  function count() {
    if (!stacked) return;
    const frames = stacked;
    stacked = 0;
    if (worker) {
      // The bitmap holds the stack as it is now, so the next frames can go on.
      const bitmap = createImageBitmap(stack, 0, 0, w, h * frames);
      // A failure is reported once, by the queue; a later stack's is not.
      bitmap.catch(() => {});
      queue = queue.then(() => bitmap).then((b) => worker.postMessage({ bitmap: b, frames }, [b]));
      queue.catch(() => {});
      return;
    }
    kg.clearRect(0, 0, w, h * frames);
    kg.drawImage(stack, 0, 0, w, h * frames, 0, 0, w, h * frames);
    const data = kg.getImageData(0, 0, w, h * frames).data;
    for (let i = 0; i < frames; i++) counter.add(data.subarray(i * w * h * 4, (i + 1) * w * h * 4));
  }
  function close() {
    if (!worker) return;
    worker.terminate();
    URL.revokeObjectURL(url);
    worker = null;
  }
  function read(canvas) {
    sg.clearRect(0, h * stacked, w, h);
    sg.drawImage(canvas, 0, 0, width, height, 0, h * stacked, w, h);
    if (++stacked === tiles) count();
  }
  return {
    read,
    async result(box, redraw) {
      count();
      if (worker) {
        try {
          await queue;
          worker.postMessage({ box });
          return await answer;
        } catch (e) {
          if (!redraw) throw e;
        } finally { close(); }
        here();
        await redraw(read);
        count();
      }
      return counter.result(box);
    },
    close,
  };
}

/** What the page says of a film's flashes: nothing unless a second holds more than three. */
function flashNote(flashes) {
  const w = flashes && flashes.worst;
  if (!w || w.flashes <= WCAG.flashes) return '';
  return ' Warning: it flashes ' + w.flashes + ' times in the second from ' + w.start + ' s ('
    + (w.kind === 'red' ? 'saturated red' : 'brightness') + ', in the ' + w.w + ' x ' + w.h + ' area at ' + w.x + ', ' + w.y
    + '), more than the three a second WCAG 2.3.1 allows; flashing that fast can cause seizures.';
}

module.exports = { flashCounter, flashReader, flashNote, WCAG };
