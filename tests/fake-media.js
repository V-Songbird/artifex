'use strict';

// Stand-ins for the browser APIs the tests need: media, a canvas and the page's
// host, so a check can read WHAT a soundtrack, a film export or the page
// scheduled, and WHEN, without a browser. They record and paint rectangles;
// they do not make sound.

const vm = require('node:vm');
const { html, bundle } = require('../tools/build-page.js');
const { nullSurface } = require('../tools/bench.js');

/**
 * An OfflineAudioContext that records the graph built on it. Every node a
 * soundtrack creates lands in `record.nodes`, in creation order, with its
 * `kind` and parameters; each `connect` adds its target to the node's `to`. A
 * connection to an AudioParam lists the param, whose `owner` is its node, so a
 * test can follow any node to `destination` from the record alone.
 */
function fakeAudio() {
  const record = {
    contexts: [], nodes: [], decoded: [],
    get oscillators() { return this.nodes.filter((n) => n.kind === 'oscillator'); },
  };
  const param = (value) => {
    const p = { kind: 'param', value, events: [], owner: null };
    for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime',
      'setTargetAtTime', 'setValueCurveAtTime', 'cancelScheduledValues']) {
      p[m] = (...args) => { p.events.push([m, ...args]); return p; };
    }
    return p;
  };
  const node = (kind, fields) => {
    const n = Object.assign({ kind, to: [] }, fields);
    for (const v of Object.values(fields)) if (v && v.kind === 'param') v.owner = n;
    // connect returns its target node, as Web Audio does, and nothing for a param.
    n.connect = (target) => { n.to.push(target); return target.kind === 'param' ? undefined : target; };
    n.disconnect = (target) => { n.to = target === undefined ? [] : n.to.filter((t) => t !== target); };
    if (kind !== 'destination') record.nodes.push(n);
    return n;
  };
  // A scheduled source records when it starts and stops, and where it starts reading.
  const source = (kind, fields) => {
    const n = node(kind, { at: null, end: null, ...fields });
    n.start = (at = 0, offset = 0, duration = undefined) => { Object.assign(n, { at, offset, duration }); };
    n.stop = (at = 0) => { n.end = at; };
    return n;
  };
  const buffer = (channels, length, sampleRate) => {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: (c) => data[c] };
  };
  class Context {
    constructor(channels, length, sampleRate) {
      Object.assign(this, { channels, length, sampleRate, currentTime: 0, destination: node('destination', {}) });
      record.contexts.push(this);
    }

    createOscillator() { return source('oscillator', { type: 'sine', frequency: param(440), detune: param(0) }); }

    createBufferSource() {
      return source('bufferSource', { buffer: null, loop: false, loopStart: 0, loopEnd: 0, playbackRate: param(1), detune: param(0) });
    }

    createGain() { return node('gain', { gain: param(1) }); }

    createBiquadFilter() { return node('biquadFilter', { type: 'lowpass', frequency: param(350), Q: param(1), gain: param(0), detune: param(0) }); }

    createStereoPanner() { return node('stereoPanner', { pan: param(0) }); }

    createDelay(maxDelayTime = 1) { return node('delay', { maxDelayTime, delayTime: param(0) }); }

    createConvolver() { return node('convolver', { buffer: null, normalize: true }); }

    createDynamicsCompressor() {
      return node('dynamicsCompressor', {
        threshold: param(-24), knee: param(30), ratio: param(12), attack: param(0.003), release: param(0.25), reduction: 0,
      });
    }

    createBuffer(channels, length, sampleRate) { return buffer(channels, length, sampleRate); }

    // Decodes a PCM16 RIFF WAVE into a buffer at the file's own rate (a browser
    // would resample it to the context's), recorded in `record.decoded`; refuses
    // any other form by name, as a real decoder refuses what it cannot read. It
    // takes `data` away, as Web Audio detaches it, so a second decode of the same
    // buffer fails here as in a browser.
    async decodeAudioData(data) {
      const bytes = new Uint8Array(structuredClone(data, { transfer: [data] }));
      const view = new DataView(bytes.buffer);
      const text = (at) => String.fromCharCode(...bytes.subarray(at, at + 4));
      if (bytes.length < 12 || text(0) !== 'RIFF' || text(8) !== 'WAVE') throw new Error('fakeAudio decodes only RIFF WAVE');
      let fmt = null;
      for (let at = 12; at + 8 <= bytes.length; at += 8 + view.getUint32(at + 4, true) + (view.getUint32(at + 4, true) & 1)) {
        const size = view.getUint32(at + 4, true);
        if (text(at) === 'fmt ') fmt = { format: view.getUint16(at + 8, true), channels: view.getUint16(at + 10, true), rate: view.getUint32(at + 12, true), bits: view.getUint16(at + 22, true) };
        if (text(at) !== 'data') continue;
        if (!fmt || fmt.format !== 1 || fmt.bits !== 16 || fmt.channels < 1) throw new Error('fakeAudio decodes only 16-bit PCM WAVE');
        const frames = Math.floor(Math.min(size, bytes.length - at - 8) / (2 * fmt.channels));
        const b = buffer(fmt.channels, frames, fmt.rate);
        for (let i = 0; i < frames; i++) {
          for (let c = 0; c < fmt.channels; c++) b.getChannelData(c)[i] = view.getInt16(at + 8 + 2 * (i * fmt.channels + c), true) / 32768;
        }
        record.decoded.push(b);
        return b;
      }
      throw new Error('fakeAudio found no data chunk in the WAVE');
    }

    startRendering() { return Promise.resolve(buffer(this.channels, this.length, this.sampleRate)); }
  }
  return { Context, record };
}

/**
 * An OpusHead (RFC 7845, section 5.1), the description a browser's Opus encoder
 * gives: little-endian, by default stereo at 48 kHz with the 312-sample pre-skip
 * Edge's encoder reports.
 */
function opusHead({ channels = 2, preSkip = 312, rate = 48000, gain = 0, family = 0, table = [] } = {}) {
  const head = new Uint8Array(19 + table.length);
  const le = new DataView(head.buffer);
  head.set(Array.from('OpusHead', (ch) => ch.charCodeAt(0)));
  head[8] = 1;
  head[9] = channels;
  le.setUint16(10, preSkip, true);
  le.setUint32(12, rate, true);
  le.setInt16(16, gain, true);
  head[18] = family;
  head.set(table, 19);
  return head;
}

/**
 * The avcC Edge 153's H.264 encoder described a 960 x 640 film with: High
 * profile, level 3.2, one sequence parameter set whose VUI states no colour,
 * and one picture parameter set.
 */
const EDGE_AVCC = Uint8Array.from(Buffer.from('01640020ffe1001767640020ac2b40780a36022000007d0000177001e3855401000468ee3cb0fdf8f800', 'hex'));

/**
 * A CSS colour as straight RGBA bytes: hex of 3, 4, 6 or 8 digits, and rgb()
 * or hsl() with commas or spaces and an optional alpha. Anything else, such as
 * a named colour or a gradient, is opaque black.
 */
function rgbaOf(css) {
  const s = String(css).trim();
  let m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s);
  if (m) {
    const v = (m[1].length <= 4 ? [...m[1]].map((c) => c + c) : m[1].match(/../g)).map((h) => parseInt(h, 16));
    return v.length === 4 ? v : v.concat(255);
  }
  m = /^(rgb|hsl)a?\(([^)]*)\)$/i.exec(s);
  if (!m) return [0, 0, 0, 255];
  const parts = m[2].split(/[\s,/]+/).filter(Boolean);
  const num = (p, whole) => (p.endsWith('%') ? (parseFloat(p) / 100) * whole : parseFloat(p));
  const alpha = Math.round(Math.min(1, Math.max(0, parts.length > 3 ? num(parts[3], 1) : 1)) * 255);
  if (m[1].toLowerCase() === 'rgb') return parts.slice(0, 3).map((p) => Math.round(num(p, 255))).concat(alpha);
  const [h, sat, l] = [((parseFloat(parts[0]) % 360) + 360) % 360, num(parts[1], 1), num(parts[2], 1)];
  const k = sat * Math.min(l, 1 - l);
  const f = (n) => { const q = (n + h / 30) % 12; return Math.round((l - k * Math.max(-1, Math.min(q - 3, 9 - q, 1))) * 255); };
  return [f(0), f(8), f(4), alpha];
}

const lum = ([r, g, b]) => 0.3 * r + 0.59 * g + 0.11 * b;

/**
 * The blend modes other than source-over, as the Compositing and Blending spec
 * defines them: each takes the backdrop and source colours in [0, 1] and gives
 * the mixed colour. `color` keeps the backdrop's luminosity in the source's hue
 * and saturation.
 */
const MIX = {
  multiply: (B, S) => B.map((b, i) => b * S[i]),
  screen: (B, S) => B.map((b, i) => b + S[i] - b * S[i]),
  'soft-light': (B, S) => B.map((b, i) => (S[i] <= 0.5
    ? b - (1 - 2 * S[i]) * b * (1 - b)
    : b + (2 * S[i] - 1) * ((b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b)) - b))),
  color: (B, S) => {
    const d = lum(B) - lum(S);
    let o = S.map((v) => v + d);
    const L = lum(o), n = Math.min(...o), x = Math.max(...o);
    if (n < 0) o = o.map((v) => L + ((v - L) * L) / (L - n));
    if (x > 1) o = o.map((v) => L + ((v - L) * (1 - L)) / (x - L));
    return o;
  },
};

/**
 * One straight-RGBA colour at opacity `a` into the pixel at `p` under the
 * composite `op`, rounded once per mark as a canvas does: a blend mode mixes
 * the colour with the backdrop as far as the backdrop is opaque, then lays it
 * source-over.
 */
function blend(px, p, rgb, a, op = 'source-over') {
  const da = px[p + 3] / 255;
  if (MIX[op] && da) {
    const m = MIX[op]([0, 1, 2].map((c) => px[p + c] / 255), rgb.map((v) => v / 255));
    rgb = rgb.map((v, c) => (1 - da) * v + da * 255 * m[c]);
  }
  const oa = a + da * (1 - a);
  rgb.forEach((v, c) => { px[p + c] = oa ? (v * a + px[p + c] * da * (1 - a)) / oa : 0; });
  px[p + 3] = oa * 255;
}

/**
 * The stand-in canvas every test that draws and reads pixels uses. It gives
 * `canvas`, anything with a width and a height, a getContext and returns it;
 * getContext returns the canvas's one context, as a browser does, and null for
 * another type. The canvas's RGBA is `canvas.pixels`, cleared whenever the
 * canvas changes size, as a browser's bitmap is.
 *
 * A 2D context is `surface` with pixels: the surface keeps the transform and
 * receives every call, so a recording surface keeps its record. The context
 * names its `canvas` and reports its attributes; save and restore keep only
 * imageSmoothingEnabled themselves, and the surface keeps the transform and
 * the other styles on its own stack. reset() clears the canvas's pixels to
 * transparent, empties the save stack and returns the transform and every
 * style to its default, as a browser's does. It paints source-over and the
 * blend modes in MIX, and throws on another
 * composite operation:
 * - fillRect and clearRect cover each pixel whose centre lies inside the
 *   rectangle under the transform, its top and left edges included; a fill
 *   blends fillStyle at its own alpha times globalAlpha.
 * - fillStyle is a colour, a pattern or a radial gradient, each read at the
 *   pixel centre in the fill's user space. createPattern repeats another
 *   fakeCanvas, texel by texel, and takes 'repeat' only. createRadialGradient
 *   takes two circles about one centre and interpolates straight RGBA between
 *   its stops, holding the end stops beyond them.
 * - createImageData and putImageData make and write image data, putImageData
 *   whole at a device point, replacing the pixels it covers.
 * - drawImage of another fakeCanvas, whole or a source region, blends it at
 *   globalAlpha on whole device pixels only; anything else throws. Unscaled,
 *   each pixel is copied; shrunk, each pixel takes the mean of the source
 *   pixels whose centres fall in it, weighted by their alpha.
 * - getImageData reads the canvas back as sized image data, unpremultiplied as
 *   a canvas returns it.
 * Colours are read by rgbaOf.
 *
 * With `webgl`, a WebGL2 context copies the canvas last uploaded with
 * texImage2D, over black, into this one on drawArrays and reads nothing back,
 * so a conversion shader never matches here; without it there is no WebGL2.
 * `onContext(context, type, attributes)` sees the context when it is made.
 */
function fakeCanvas(canvas, surface, { webgl = false, onContext = () => {} } = {}) {
  let bitmap = new Uint8ClampedArray(0);
  const pixels = () => {
    if (bitmap.length !== canvas.width * canvas.height * 4) bitmap = new Uint8ClampedArray(canvas.width * canvas.height * 4);
    return bitmap;
  };
  Object.defineProperty(canvas, 'pixels', { get: pixels, configurable: true });
  const cover = ({ a, b, c, d, e, f }, x, y, w, h, each) => {
    const det = a * d - b * c;
    if (!det) return;
    const [u0, u1] = w < 0 ? [x + w, x] : [x, x + w];
    const [v0, v1] = h < 0 ? [y + h, y] : [y, y + h];
    const xs = [u0, u1].flatMap((u) => [v0, v1].map((v) => a * u + c * v + e));
    const ys = [u0, u1].flatMap((u) => [v0, v1].map((v) => b * u + d * v + f));
    const px = pixels();
    for (let j = Math.max(0, Math.floor(Math.min(...ys))); j < Math.min(canvas.height, Math.ceil(Math.max(...ys))); j++) {
      for (let i = Math.max(0, Math.floor(Math.min(...xs))); i < Math.min(canvas.width, Math.ceil(Math.max(...xs))); i++) {
        const X = i + 0.5 - e, Y = j + 0.5 - f;
        const u = (d * X - c * Y) / det, v = (a * Y - b * X) / det;
        if (u >= u0 && u < u1 && v >= v0 && v < v1) each(px, (j * canvas.width + i) * 4, u, v);
      }
    }
  };
  // A fill mixes when `mixes` is set, and then may use a blend mode in MIX too.
  const sourceOver = (g, mixes = false) => {
    if (mixes && MIX[g.globalCompositeOperation]) return;
    if (g.globalCompositeOperation !== 'source-over') throw new Error(`fakeCanvas paints ${mixes ? `${Object.keys(MIX).join(', ')} and ` : ''}source-over only, not ${g.globalCompositeOperation}`);
  };
  // The surface keeps fillStyle, globalAlpha and globalCompositeOperation on its
  // own save stack; only what it lacks is kept here.
  const STATE = ['imageSmoothingEnabled'];
  const flat = (attributes) => {
    const g = surface({ w: canvas.width, h: canvas.height });
    const base = { save: g.save, restore: g.restore, reset: g.reset, clearRect: g.clearRect, fillRect: g.fillRect, drawImage: g.drawImage };
    const kept = [];
    return Object.assign(g, {
      canvas,
      fillStyle: '#000', globalAlpha: 1, globalCompositeOperation: 'source-over', imageSmoothingEnabled: true,
      getContextAttributes() { return { alpha: true, colorSpace: 'srgb', desynchronized: false, willReadFrequently: false, ...attributes }; },
      save() { kept.push(STATE.map((k) => this[k])); base.save.call(this); },
      restore() { const s = kept.pop(); if (s) STATE.forEach((k, i) => { this[k] = s[i]; }); base.restore.call(this); },
      reset() { kept.length = 0; this.imageSmoothingEnabled = true; pixels().fill(0); if (base.reset) base.reset.call(this); },
      clearRect(x, y, w, h) {
        cover(this.getTransform(), x, y, w, h, (px, p) => px.fill(0, p, p + 4));
        if (base.clearRect) base.clearRect.call(this, x, y, w, h);
      },
      fillRect(x, y, w, h) {
        sourceOver(this, true);
        const op = this.globalCompositeOperation, style = this.fillStyle;
        const made = style && typeof style === 'object' && style.at;
        if (op !== 'source-over' || made) {
          const at = made || (() => rgbaOf(style));
          cover(this.getTransform(), x, y, w, h, (px, p, u, v) => {
            const [r, gr, b, a] = at(u, v);
            blend(px, p, [r, gr, b], (a / 255) * this.globalAlpha, op);
          });
          if (base.fillRect) base.fillRect.call(this, x, y, w, h);
          return;
        }
        const [r, gr, b, a] = rgbaOf(this.fillStyle);
        cover(this.getTransform(), x, y, w, h, (px, p) => blend(px, p, [r, gr, b], (a / 255) * this.globalAlpha));
        if (base.fillRect) base.fillRect.call(this, x, y, w, h);
      },
      createPattern(image, repetition) {
        if (!image || !image.pixels || repetition !== 'repeat') throw new Error("fakeCanvas repeats only another fakeCanvas, with 'repeat'");
        const { width: W, height: H } = image;
        return {
          at(u, v) {
            const s = ((((Math.floor(v) % H) + H) % H) * W + (((Math.floor(u) % W) + W) % W)) * 4;
            return Array.from(image.pixels.subarray(s, s + 4));
          },
        };
      },
      createRadialGradient(x0, y0, r0, x1, y1, r1) {
        if (x0 !== x1 || y0 !== y1 || !(r1 > r0)) throw new Error('fakeCanvas draws a radial gradient between two circles about one centre, the outer one last');
        const stops = [];
        return {
          addColorStop(offset, colour) { stops.push([offset, rgbaOf(colour)]); stops.sort((m, n) => m[0] - n[0]); },
          at(u, v) {
            if (!stops.length) return [0, 0, 0, 0];
            const t = Math.min(1, Math.max(0, (Math.hypot(u - x0, v - y0) - r0) / (r1 - r0)));
            const k = stops.findIndex(([o]) => o > t);
            if (k <= 0) return stops[k < 0 ? stops.length - 1 : 0][1];
            const [[o0, c0], [o1, c1]] = [stops[k - 1], stops[k]];
            return c0.map((c, i) => c + ((c1[i] - c) * (t - o0)) / (o1 - o0));
          },
        };
      },
      createImageData(width, height) { return { width, height, data: new Uint8ClampedArray(width * height * 4) }; },
      putImageData(img, x, y) {
        const px = pixels();
        for (let j = 0; j < img.height; j++) {
          for (let i = 0; i < img.width; i++) {
            if (x + i < 0 || y + j < 0 || x + i >= canvas.width || y + j >= canvas.height) continue;
            const s = (j * img.width + i) * 4;
            px.set(img.data.subarray(s, s + 4), ((y + j) * canvas.width + x + i) * 4);
          }
        }
      },
      drawImage(src, ...args) {
        if (args.length !== 2 && args.length !== 8) throw new Error('fakeCanvas draws an image whole at a point, or a source region at its own size');
        const [sx, sy, sw, sh, dx, dy, dw, dh] = args.length === 2 ? [0, 0, src.width, src.height, ...args, src.width, src.height] : args;
        const { a, b, c, d, e, f } = this.getTransform();
        const [x0, y0] = [dx + e, dy + f];
        if (dw > sw || dh > sh || a !== 1 || b !== 0 || c !== 0 || d !== 1 || ![sx, sy, sw, sh, x0, y0, dw, dh].every(Number.isInteger)) {
          throw new Error('fakeCanvas draws an image shrunk or unscaled, on whole device pixels');
        }
        if (!src || !src.pixels) throw new Error('fakeCanvas draws only another fakeCanvas');
        sourceOver(this);
        const px = pixels();
        if (dw !== sw || dh !== sh) {
          for (let j = 0; j < dh; j++) {
            for (let i = 0; i < dw; i++) {
              const [X, Y] = [x0 + i, y0 + j];
              if (X < 0 || Y < 0 || X >= canvas.width || Y >= canvas.height) continue;
              const sum = [0, 0, 0, 0];
              let count = 0;
              for (let v = Math.ceil(sy + (j * sh) / dh - 0.5); v + 0.5 < sy + ((j + 1) * sh) / dh; v++) {
                for (let u = Math.ceil(sx + (i * sw) / dw - 0.5); u + 0.5 < sx + ((i + 1) * sw) / dw; u++) {
                  count++;
                  if (u < 0 || v < 0 || u >= src.width || v >= src.height) continue;
                  const s = (v * src.width + u) * 4, w = src.pixels[s + 3];
                  for (let k = 0; k < 3; k++) sum[k] += src.pixels[s + k] * w;
                  sum[3] += w;
                }
              }
              if (sum[3]) blend(px, (Y * canvas.width + X) * 4, sum.slice(0, 3).map((t) => t / sum[3]), (sum[3] / count / 255) * this.globalAlpha);
            }
          }
          if (base.drawImage) base.drawImage.call(this, src, ...args);
          return;
        }
        const from = src.pixels;
        for (let j = 0; j < sh; j++) {
          for (let i = 0; i < sw; i++) {
            const [X, Y, u, v] = [x0 + i, y0 + j, sx + i, sy + j];
            if (X < 0 || Y < 0 || X >= canvas.width || Y >= canvas.height || u < 0 || v < 0 || u >= src.width || v >= src.height) continue;
            const s = (v * src.width + u) * 4;
            blend(px, (Y * canvas.width + X) * 4, [from[s], from[s + 1], from[s + 2]], (from[s + 3] / 255) * this.globalAlpha);
          }
        }
        if (base.drawImage) base.drawImage.call(this, src, ...args);
      },
      getImageData(x, y, w, h) {
        const px = pixels(), data = new Uint8ClampedArray(w * h * 4);
        for (let j = 0; j < h; j++) data.set(px.subarray(((y + j) * canvas.width + x) * 4, ((y + j) * canvas.width + x + w) * 4), j * w * 4);
        return { width: w, height: h, data };
      },
    });
  };
  const copier = () => {
    let source = null;
    const gl = {
      texImage2D(...args) { source = args[args.length - 1]; },
      drawArrays() {
        if (!source || !source.pixels) return;
        const from = source.pixels, px = pixels();
        for (let p = 0; p < Math.min(px.length, from.length); p += 4) {
          for (let c = 0; c < 3; c++) px[p + c] = (from[p + c] * from[p + 3]) / 255;
          px[p + 3] = 255;
        }
      },
      getProgramParameter: () => true,
      isContextLost: () => false,
      getExtension: () => null,
    };
    return new Proxy(gl, { get: (t, k) => (k in t ? t[k] : typeof k === 'string' && k === k.toUpperCase() ? 0 : () => ({})) });
  };
  let made = null, madeType = null;
  canvas.getContext = (type, attributes) => {
    if (made) return type === madeType ? made : null;
    made = type === '2d' ? flat(attributes) : type === 'webgl2' && webgl ? copier() : null;
    if (made) { madeType = type; onContext(made, type, attributes); }
    return made;
  };
  return canvas;
}

/** RGBA pixels as I420 in BT.709, limited or full range: luma per pixel, chroma per 2x2 block. */
function i420(px, w, h, full) {
  const kr = 0.2126, kb = 0.0722, kg = 1 - kr - kb;
  const [ys, y0, cs] = full ? [255, 0, 255] : [219, 16, 224];
  const out = new Uint8ClampedArray(w * h * 1.5);
  const u = w * h, v = u + (w * h) / 4;
  for (let p = 0; p < w * h; p++) out[p] = y0 + (ys * (kr * px[4 * p] + kg * px[4 * p + 1] + kb * px[4 * p + 2])) / 255;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const at = [y * w + x, y * w + x + 1, (y + 1) * w + x, (y + 1) * w + x + 1].map((p) => 4 * p);
      const [r, g, b] = [0, 1, 2].map((c) => at.reduce((s, p) => s + px[p + c], 0) / 4);
      const l = kr * r + kg * g + kb * b;
      out[u + (y / 2) * (w / 2) + x / 2] = 128 + (cs * (b - l)) / (2 * (1 - kb)) / 255;
      out[v + (y / 2) * (w / 2) + x / 2] = 128 + (cs * (r - l)) / (2 * (1 - kr)) / 255;
    }
  }
  return out;
}

/**
 * VideoEncoder, VideoFrame, VideoDecoder, EncodedVideoChunk, AudioEncoder and
 * AudioData stand-ins. A frame keeps the pixel data and colour space it was
 * built with; each encoded frame is four bytes naming its index, described by
 * Edge's avcC. `supported` decides which configs are accepted, `colorSpace` is
 * what the video encoder reports for NV12 frames (full-range sRGB unless
 * given), `aac` and `opus` whether each encodes, `describe` whether the audio
 * encoder describes its stream, `failAt` a frame index whose encode reports an
 * error, and `stall` an encoder whose queue never drains.
 *
 * A frame made from a canvas is converted by the encoder itself, as Edge's
 * does: to limited-range BT.709, or full range with `canvasRange: 'full'` or
 * from the `switchAt`th canvas frame on. It reports that colour space, again
 * whenever it changes unless `announce` is false, or `claims` in its place;
 * the decoder hands back what it wrote, as I420. `refuseCanvas` makes no frame
 * of a canvas at all.
 */
function fakeCodecs({
  supported = () => true, colorSpace, aac = true, opus = true, describe = true, failAt = -1, stall = false,
  canvasRange = 'limited', switchAt = -1, announce = true, claims, refuseCanvas = false,
} = {}) {
  const log = { frames: [], audioFrames: 0 };
  const space = colorSpace === undefined
    ? { primaries: 'bt709', transfer: 'iec61966-2-1', matrix: 'bt709', fullRange: true }
    : colorSpace;
  // What the encoder wrote for each frame it converted itself, by index.
  const pictures = [];
  const chunk = (type, timestamp, data) => ({ type, timestamp, byteLength: data.length, copyTo: (dest) => dest.set(data) });

  class VideoFrame {
    constructor(data, init) {
      if (refuseCanvas && data && data.pixels) throw new Error('fixture: this browser makes no frame of a canvas');
      Object.assign(this, {
        data, format: init.format, colorSpace: init.colorSpace, timestamp: init.timestamp, duration: init.duration, closed: false,
      });
      log.frames.push(this);
    }

    close() { this.closed = true; }
  }

  class VideoEncoder {
    static async isConfigSupported(config) { return { supported: supported(config), config }; }

    constructor({ output, error }) {
      Object.assign(this, { output, error, state: 'unconfigured', encodeQueueSize: stall ? 5 : 0, sent: 0, drawn: 0, said: null });
    }

    configure(config) { this.config = config; this.state = 'configured'; }

    encode(frame, options) {
      if (this.sent === failAt) { this.error(new Error('fixture encoder failed')); return; }
      const key = !!(options && options.keyFrame);
      let said = space;
      if (frame.data && frame.data.pixels) {
        const full = canvasRange === 'full' || (switchAt >= 0 && this.drawn >= switchAt);
        pictures[this.sent] = { width: frame.data.width, height: frame.data.height, data: i420(frame.data.pixels, frame.data.width, frame.data.height, full) };
        said = claims === undefined ? { primaries: 'bt709', transfer: 'iec61966-2-1', matrix: 'bt709', fullRange: full } : claims;
        this.drawn++;
      }
      const tell = this.sent === 0 || (announce && JSON.stringify(said) !== JSON.stringify(this.said));
      this.said = said;
      const meta = tell ? { decoderConfig: { codec: this.config.codec, description: EDGE_AVCC, colorSpace: said } } : undefined;
      this.output(chunk(key ? 'key' : 'delta', frame.timestamp, Uint8Array.of(this.sent & 255, (this.sent >> 8) & 255, key ? 1 : 0, 7)), meta);
      this.sent++;
    }

    async flush() {}

    close() { this.state = 'closed'; }
  }

  class EncodedVideoChunk {
    constructor(init) { Object.assign(this, init); }
  }

  // Decodes a chunk the encoder converted itself back to what it wrote.
  class VideoDecoder {
    constructor({ output, error }) { Object.assign(this, { output, error, state: 'unconfigured' }); }

    configure(config) { this.config = config; this.state = 'configured'; }

    decode(encoded) {
      const picture = pictures[encoded.data[0] | (encoded.data[1] << 8)];
      if (!picture) { this.error(new Error('fixture decoder: nothing was encoded as this chunk')); return; }
      const { width: w, height: h, data } = picture;
      const layout = [{ offset: 0, stride: w }, { offset: w * h, stride: w / 2 }, { offset: (w * h * 5) / 4, stride: w / 2 }];
      this.output({
        format: 'I420', codedWidth: w, codedHeight: h, timestamp: encoded.timestamp,
        allocationSize: () => data.length,
        copyTo: async (dest) => { dest.set(data); return layout; },
        close() {},
      });
    }

    async flush() {}

    close() { this.state = 'closed'; }
  }

  class AudioData {
    constructor(init) { Object.assign(this, init); }

    close() {}
  }

  // Emits one chunk per frame of samples held -- 1024 for AAC, 960 (20 ms) for
  // Opus, whose pre-skip is held from the start -- and the remainder on flush.
  // The first chunk carries the decoder description: an AudioSpecificConfig, or
  // an OpusHead.
  class AudioEncoder {
    static async isConfigSupported(config) {
      return { supported: config.codec === 'mp4a.40.2' ? aac : config.codec === 'opus' && opus, config };
    }

    constructor({ output, error }) { Object.assign(this, { output, error, held: 0, sent: 0 }); }

    // Edge's Opus encoder emits its 312-sample pre-skip as well as its input,
    // so its packets cover both; its AAC encoder emits its input alone.
    configure(config) { this.config = config; this.frame = config.codec === 'opus' ? 960 : 1024; this.held = config.codec === 'opus' ? 312 : 0; }

    encode(data) {
      this.held += data.numberOfFrames;
      log.audioFrames += data.numberOfFrames;
      while (this.held >= this.frame) this.emit();
    }

    emit() {
      const isOpus = this.config.codec === 'opus';
      const description = isOpus ? opusHead({ channels: this.config.numberOfChannels, rate: this.config.sampleRate }) : Uint8Array.of(0x11, 0x90);
      const meta = this.sent === 0 && describe ? { decoderConfig: { description } } : undefined;
      // 0xfc opens one 20 ms fullband CELT frame, the packet Edge's Opus encoder sends.
      const data = Uint8Array.of(isOpus ? 0xfc : 0x21, this.sent & 255);
      this.output(chunk('key', Math.round((this.sent * this.frame * 1e6) / this.config.sampleRate), data), meta);
      this.held = Math.max(0, this.held - this.frame);
      this.sent++;
    }

    async flush() { if (this.held > 0) this.emit(); }

    close() {}
  }

  return { VideoEncoder, VideoFrame, VideoDecoder, EncodedVideoChunk, AudioEncoder, AudioData, log };
}

// A PNG's signature and IEND, enough for the page to add its recipe.
const PNG_STUB = () => Uint8Array.of(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82);

/**
 * Run the built page in a vm sandbox of the host it needs, as every page test
 * does. Every element is a fakeCanvas over nullSurface, `width` by `height`,
 * that keeps its children, dataset, text, value, markup and attributes; `fields(tag)` adds
 * a test's own fields to each. toBlob hands `png()` back as an image/png Blob
 * through `onBlob(finish)`, and click records the element's download name in
 * `downloads`. Animation frames wait in `frames` until `frame(timestamp)` runs
 * every pending one, as a browser does; timeouts run at once; object URLs
 * record their Blob in `blobs`. `modules` replaces bundled modules by path;
 * `window` and `globals` extend the host, and `globals` wins.
 */
function fakePage({
  modules = {}, width = 300, height = 150, fields = () => ({}), onContext, png = PNG_STUB, onBlob = (finish) => finish(),
  window = {}, globals = {}, replaceState = () => {}, search = '', now = () => 1, downloads = [],
} = {}) {
  const elements = new Map(), frames = new Map(), blobs = [];
  let nextFrame = 0;
  const element = (tag) => fakeCanvas(Object.defineProperties({
    tag, children: [], dataset: {}, textContent: '', value: '', width, height,
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild(child) { this.children.push(child); },
    setAttribute(name, value) { (this.attributes ||= {})[name] = String(value); },
    set innerHTML(value) { this.children = []; this.markup = value; },
    get innerHTML() { return this.markup || ''; },
    toBlob(callback) { onBlob(() => callback(new Blob([png()], { type: 'image/png' }))); },
    click() { downloads.push(this.download); },
  }, Object.getOwnPropertyDescriptors(fields(tag))), nullSurface, { onContext });
  const pngButton = element('button');
  pngButton.dataset.png = '1';
  const sandbox = {
    window, Blob,
    document: {
      body: element('body'),
      getElementById(id) { if (!elements.has(id)) elements.set(id, element(id === 'c' ? 'canvas' : 'div')); return elements.get(id); },
      createElement: element,
      querySelectorAll: () => [pngButton],
    },
    history: { replaceState }, location: { search }, performance: { now },
    requestAnimationFrame(callback) { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame(id) { frames.delete(id); },
    URL: { createObjectURL: (blob) => { blobs.push(blob); return 'blob:fixture'; }, revokeObjectURL() {} },
    setTimeout(callback) { callback(); },
    addEventListener() {},
    ...globals,
  };
  const overrides = Object.entries(modules).map(([name, module]) => `\n__def(${JSON.stringify(name)}, ${module.toString()});`).join('');
  vm.runInNewContext(html(bundle() + overrides).match(/<script>([\s\S]*)<\/script>/)[1], sandbox);
  const frame = (timestamp) => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(timestamp));
  };
  return { api: sandbox.window.__artifex, window: sandbox.window, document: sandbox.document, elements, png: pngButton, frames, frame, downloads, blobs };
}

module.exports = { fakeAudio, fakeCodecs, fakeCanvas, fakePage, opusHead, EDGE_AVCC };
