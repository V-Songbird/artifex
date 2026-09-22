// Film export: every drawn frame, at its own time, in an MP4 file.
//
// WHY NOT THE RECORDER. MediaRecorder stamps each frame by the wall clock, so an
// export built on it has to hand frames over in real time, and a piece whose
// frames take longer than their budget loses pictures. Here each drawn frame
// goes to a VideoEncoder carrying the timestamp i / hz, however long it took to
// draw. Nothing waits on a clock, so a slow piece is a slow export, never a
// shorter film.
//
// THE FILE IS THE WITNESS. The finished bytes are read back -- sample counts,
// sample durations, the colour tag, the soundtrack's length -- and checked
// against the frame grid before anyone is handed a film.
//
// THE COLOUR TAG IS NOT DECORATION. The encoder reports the colour space it
// encoded a canvas frame in, and for a canvas that is full range. A decoder that
// is not told so assumes limited range: near-black goes to black, near-white to
// white, and a saturated colour moves by a dozen levels. The film carries what
// the encoder reported, in a `colr` box.
//
// The browser's encoders arrive through `env`, so the whole path runs in Node
// against controlled stand-ins. Nothing here knows what a piece depicts.

'use strict';

const { drawFrame, playheads, renderSound } = require('./render.js');

// ---------------------------------------------------------------------------
// Writing ISO base media (MP4)
// ---------------------------------------------------------------------------

const u8 = (v) => Uint8Array.of(v & 255);
const u16 = (v) => Uint8Array.of((v >>> 8) & 255, v & 255);
const u24 = (v) => Uint8Array.of((v >>> 16) & 255, (v >>> 8) & 255, v & 255);
const u32 = (v) => Uint8Array.of((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
// Box types and handler names are ASCII; no TextEncoder, which a bare script
// context does not provide.
const ascii = (s) => Uint8Array.from(s, (ch) => ch.charCodeAt(0));

function concat(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

const box = (type, ...parts) => { const body = concat(parts); return concat([u32(body.length + 8), ascii(type), body]); };
const full = (type, version, flags, ...parts) => box(type, u8(version), u24(flags), ...parts);
const IDENTITY = concat([0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].map(u32));

/** Run-length pairs [count, value], the shape stts and ctts store. */
function runs(values) {
  const out = [];
  for (const v of values) {
    if (out.length && out[out.length - 1][1] === v) out[out.length - 1][0]++;
    else out.push([1, v]);
  }
  return out;
}

// ISO/IEC 23091-2 code points for the colour spaces a WebCodecs encoder reports.
const PRIMARIES = { bt709: 1, bt470bg: 5, smpte170m: 6, bt2020: 9, smpte432: 12 };
const TRANSFER = { bt709: 1, smpte170m: 6, linear: 8, 'iec61966-2-1': 13, pq: 16, hlg: 18 };
const MATRIX = { rgb: 0, bt709: 1, bt470bg: 5, smpte170m: 6, 'bt2020-ncl': 9 };

/**
 * The `colr` box for a reported colour space, or nothing when none was reported.
 * An unknown name is written as 2, "unspecified", rather than guessed.
 */
function colourBox(space) {
  if (!space) return new Uint8Array(0);
  const code = (table, name) => (name in table ? table[name] : 2);
  return box('colr', ascii('nclx'), u16(code(PRIMARIES, space.primaries)), u16(code(TRANSFER, space.transfer)),
    u16(code(MATRIX, space.matrix)), u8(space.fullRange ? 0x80 : 0));
}

function sampleTable(t) {
  const parts = [full('stsd', 0, 0, u32(1), t.entry)];
  const stts = runs(t.deltas);
  parts.push(full('stts', 0, 0, u32(stts.length), ...stts.map(([n, d]) => concat([u32(n), u32(d)]))));
  if (t.offsets && t.offsets.some((o) => o !== 0)) {
    const ctts = runs(t.offsets);
    parts.push(full('ctts', 1, 0, u32(ctts.length), ...ctts.map(([n, o]) => concat([u32(n), u32(o >>> 0)]))));
  }
  if (t.keys) parts.push(full('stss', 0, 0, u32(t.keys.length), ...t.keys.map(u32)));
  parts.push(full('stsc', 0, 0, u32(1), u32(1), u32(1), u32(1)));
  parts.push(full('stsz', 0, 0, u32(0), u32(t.samples.length), ...t.samples.map((s) => u32(s.length))));
  parts.push(full('stco', 0, 0, u32(t.chunks.length), ...t.chunks.map(u32)));
  return box('stbl', ...parts);
}

function track(t, movieScale) {
  const span = Math.round((t.duration * movieScale) / t.timescale);
  const audio = t.handler === 'soun';
  return box('trak',
    full('tkhd', 0, 3, u32(0), u32(0), u32(t.id), u32(0), u32(span), new Uint8Array(8),
      u16(0), u16(0), u16(audio ? 0x0100 : 0), u16(0), IDENTITY,
      u32((t.width || 0) * 65536), u32((t.height || 0) * 65536)),
    box('mdia',
      full('mdhd', 0, 0, u32(0), u32(0), u32(t.timescale), u32(t.duration), u16(0x55c4), u16(0)),
      full('hdlr', 0, 0, u32(0), ascii(t.handler), new Uint8Array(12), ascii(audio ? 'SoundHandler\0' : 'VideoHandler\0')),
      box('minf',
        audio ? full('smhd', 0, 0, new Uint8Array(4)) : full('vmhd', 0, 1, new Uint8Array(8)),
        box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))),
        sampleTable(t))));
}

function avcEntry(width, height, avcC, colour) {
  const name = new Uint8Array(32);
  const label = ascii('Artifex H.264');
  name[0] = label.length;
  name.set(label, 1);
  return box('avc1', new Uint8Array(6), u16(1), u16(0), u16(0), new Uint8Array(12), u16(width), u16(height),
    u32(0x00480000), u32(0x00480000), u32(0), u16(1), name, u16(0x0018), u16(0xffff),
    box('avcC', avcC), colourBox(colour));
}

function aacEntry(channels, rate, asc, bitrate) {
  const descriptor = (tag, body) => concat([u8(tag), Uint8Array.of(0x80, 0x80, 0x80, body.length), body]);
  const decoderConfig = descriptor(0x04, concat([u8(0x40), u8(0x15), u24(0), u32(bitrate), u32(bitrate), descriptor(0x05, asc)]));
  const es = descriptor(0x03, concat([u16(0), u8(0), decoderConfig, descriptor(0x06, u8(0x02))]));
  return box('mp4a', new Uint8Array(6), u16(1), new Uint8Array(8), u16(channels), u16(16), u16(0), u16(0),
    u32(rate * 65536), full('esds', 0, 0, es));
}

/** AAC-LC AudioSpecificConfig for a sample rate and channel count. */
function aacConfig(rate, channels) {
  const index = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350].indexOf(rate);
  if (index < 0) throw new Error(`film: AAC has no sampling-frequency index for ${rate} Hz`);
  return Uint8Array.of((2 << 3) | (index >> 1), ((index & 1) << 7) | (channels << 3));
}

/**
 * One MP4 file: moov first, so a player can start before it has the whole file.
 *
 * `video`: { width, height, timescale, delta, samples: [{ data, key, offset }],
 * avcC, colour }. `audio`, optional: { sampleRate, channels, samples: [Uint8Array],
 * asc, bitrate }. Every sample is its own chunk.
 */
function muxMp4({ video, audio = null }) {
  const tracks = [{
    id: 1, handler: 'vide', timescale: video.timescale, duration: video.samples.length * video.delta,
    width: video.width, height: video.height,
    entry: avcEntry(video.width, video.height, video.avcC, video.colour),
    samples: video.samples.map((s) => s.data),
    deltas: video.samples.map(() => video.delta),
    offsets: video.samples.map((s) => s.offset || 0),
    keys: video.samples.map((s, i) => (s.key ? i + 1 : 0)).filter(Boolean),
  }];
  if (audio) {
    tracks.push({
      id: 2, handler: 'soun', timescale: audio.sampleRate, duration: audio.samples.length * 1024,
      entry: aacEntry(audio.channels, audio.sampleRate, audio.asc, audio.bitrate),
      samples: audio.samples, deltas: audio.samples.map(() => 1024),
    });
  }
  const ftyp = box('ftyp', ascii('isom'), u32(512), ascii('isom'), ascii('iso2'), ascii('avc1'), ascii('mp41'));
  const movieScale = 1000;
  const span = Math.max(...tracks.map((t) => Math.round((t.duration * movieScale) / t.timescale)));
  const moov = () => box('moov',
    full('mvhd', 0, 0, u32(0), u32(0), u32(movieScale), u32(span), u32(0x00010000), u16(0x0100), new Uint8Array(10),
      IDENTITY, new Uint8Array(24), u32(tracks.length + 1)),
    ...tracks.map((t) => track(t, movieScale)));
  // Chunk offsets depend on moov's size and moov's size never depends on the
  // offsets (stco entries are fixed width), so measure once and fill in.
  for (const t of tracks) t.chunks = t.samples.map(() => 0);
  let at = ftyp.length + moov().length + 8;
  for (const t of tracks) t.chunks = t.samples.map((s) => { const o = at; at += s.length; return o; });
  const body = concat(tracks.flatMap((t) => t.samples));
  return concat([ftyp, moov(), u32(body.length + 8), ascii('mdat'), body]);
}

// ---------------------------------------------------------------------------
// Reading it back
// ---------------------------------------------------------------------------

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'dinf', 'edts']);

/**
 * What an MP4 file actually holds: each track's codec, size, timescale, sample
 * durations, keyframes, colour tag and whether every sample lies inside the
 * media data. Reads any file with 32-bit chunk offsets, not only this writer's.
 */
function readMp4(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = (at) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  const out = { brand: null, seconds: 0, media: null, tracks: [] };
  let t = null;
  const walk = (start, end) => {
    for (let at = start; at + 8 <= end;) {
      let size = view.getUint32(at);
      const kind = type(at + 4);
      let head = 8;
      if (size === 1) { size = Number(view.getBigUint64(at + 8)); head = 16; }
      if (size === 0) size = end - at;
      if (size < head || at + size > end) throw new Error(`film: box ${JSON.stringify(kind)} at byte ${at} runs past its parent`);
      const b = at + head;
      if (kind === 'ftyp') out.brand = type(b);
      else if (kind === 'mdat') out.media = [b, at + size];
      else if (kind === 'mvhd') {
        const v1 = bytes[b] === 1;
        const scale = view.getUint32(b + (v1 ? 20 : 12));
        out.seconds = (v1 ? Number(view.getBigUint64(b + 24)) : view.getUint32(b + 16)) / scale;
      } else if (kind === 'trak') {
        t = { handler: null, codec: null, colour: null, deltas: [], keys: null, sizes: [], chunks: [], stsc: [], offsets: false };
        out.tracks.push(t);
      } else if (kind === 'hdlr') t.handler = type(b + 8);
      else if (kind === 'mdhd') {
        const v1 = bytes[b] === 1;
        t.timescale = view.getUint32(b + (v1 ? 20 : 12));
        t.duration = v1 ? Number(view.getBigUint64(b + 24)) : view.getUint32(b + 16);
      } else if (kind === 'stsd') {
        const entry = b + 8;
        t.codec = type(entry + 4);
        if (t.codec === 'avc1') {
          t.width = view.getUint16(entry + 32);
          t.height = view.getUint16(entry + 34);
          walk(entry + 86, entry + view.getUint32(entry));
        } else if (t.codec === 'mp4a') {
          t.channels = view.getUint16(entry + 24);
          t.sampleRate = view.getUint32(entry + 32) >>> 16;
        }
      } else if (kind === 'colr' && type(b) === 'nclx') {
        t.colour = { primaries: view.getUint16(b + 4), transfer: view.getUint16(b + 6), matrix: view.getUint16(b + 8), fullRange: (bytes[b + 10] & 0x80) !== 0 };
      } else if (kind === 'stts') {
        for (let i = 0, n = view.getUint32(b + 4); i < n; i++) t.deltas.push([view.getUint32(b + 8 + i * 8), view.getUint32(b + 12 + i * 8)]);
      } else if (kind === 'ctts') t.offsets = true;
      else if (kind === 'stss') {
        t.keys = [];
        for (let i = 0, n = view.getUint32(b + 4); i < n; i++) t.keys.push(view.getUint32(b + 8 + i * 4));
      } else if (kind === 'stsz') {
        const fixed = view.getUint32(b + 4);
        for (let i = 0, n = view.getUint32(b + 8); i < n; i++) t.sizes.push(fixed || view.getUint32(b + 12 + i * 4));
      } else if (kind === 'stsc') {
        for (let i = 0, n = view.getUint32(b + 4); i < n; i++) t.stsc.push([view.getUint32(b + 8 + i * 12), view.getUint32(b + 12 + i * 12)]);
      } else if (kind === 'stco') {
        for (let i = 0, n = view.getUint32(b + 4); i < n; i++) t.chunks.push(view.getUint32(b + 8 + i * 4));
      }
      if (CONTAINERS.has(kind)) walk(b, at + size);
      at += size;
    }
  };
  walk(0, bytes.length);
  return {
    brand: out.brand,
    seconds: out.seconds,
    tracks: out.tracks.map((x) => {
      // Place every sample from its chunk and the chunk's run in stsc.
      let inside = !!out.media && x.sizes.length > 0;
      let sample = 0;
      for (let c = 0; c < x.chunks.length && sample < x.sizes.length; c++) {
        const run = x.stsc.filter((r) => r[0] <= c + 1).pop();
        let at = x.chunks[c];
        for (let k = 0; k < (run ? run[1] : 1) && sample < x.sizes.length; k++, sample++) {
          if (at < out.media[0] || at + x.sizes[sample] > out.media[1]) inside = false;
          at += x.sizes[sample];
        }
      }
      if (sample < x.sizes.length) inside = false;
      return {
        kind: x.handler, codec: x.codec, width: x.width, height: x.height, channels: x.channels, sampleRate: x.sampleRate,
        timescale: x.timescale, duration: x.duration, samples: x.sizes.length,
        bytes: x.sizes.reduce((s, v) => s + v, 0), deltas: x.deltas, keys: x.keys, colour: x.colour,
        reordered: x.offsets, inside,
      };
    }),
  };
}

/**
 * Judge a film by what its file holds against the frame grid it was cut from.
 *
 * `expected`: { frames, hz, width, height, sound, sampleRate }. Throws naming the
 * first thing the file gets wrong; returns the report otherwise.
 */
function filmCheck(expected, file) {
  const video = file.tracks.filter((x) => x.kind === 'vide');
  const audio = file.tracks.filter((x) => x.kind === 'soun');
  if (video.length !== 1 || video[0].codec !== 'avc1') {
    throw new Error(`film: expected one H.264 video track and the file holds ${video.length}. Nothing was saved.`);
  }
  const v = video[0];
  if (!v.inside) throw new Error('film: a sample points outside the media data. Nothing was saved.');
  if (v.samples !== expected.frames) {
    throw new Error(`film: the file holds ${v.samples} of ${expected.frames} frames. Nothing was saved.`);
  }
  const delta = v.timescale / expected.hz;
  const uneven = v.deltas.find(([, d]) => Math.abs(d - delta) > 0.5);
  if (uneven) {
    throw new Error(`film: a frame lasts ${uneven[1]} ticks where the grid gives ${delta.toFixed(1)} of ${v.timescale} per second. Nothing was saved.`);
  }
  if (v.width !== expected.width || v.height !== expected.height) {
    throw new Error(`film: the file is ${v.width} x ${v.height} and the export asked for ${expected.width} x ${expected.height}. Nothing was saved.`);
  }
  if (!v.keys || v.keys[0] !== 1) throw new Error('film: the first frame is not a keyframe, so the film cannot start. Nothing was saved.');
  if (!v.colour) {
    throw new Error('film: the file carries no colour tag, and a decoder would assume limited range and shift every colour. Nothing was saved.');
  }
  const seconds = v.duration / v.timescale;
  let sound = null;
  if (expected.sound) {
    const a = audio[0];
    if (audio.length !== 1 || a.codec !== 'mp4a' || !a.inside || a.samples === 0) {
      throw new Error('film: the piece declares sound and the file holds no playable soundtrack. Nothing was saved.');
    }
    const heard = a.duration / a.timescale;
    const grain = 1024 / a.timescale;
    if (heard < seconds - grain || heard > seconds + 2 * grain) {
      throw new Error(`film: the soundtrack lasts ${heard.toFixed(3)} s against a ${seconds.toFixed(3)} s film. Nothing was saved.`);
    }
    sound = { seconds: heard, channels: a.channels, sampleRate: a.sampleRate };
  } else if (audio.length) {
    throw new Error('film: the piece declares no sound and the file holds a soundtrack. Nothing was saved.');
  }
  return { frames: v.samples, seconds, width: v.width, height: v.height, keyframes: v.keys.length, colour: v.colour, sound };
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

// H.264 levels as [level_idc, max macroblocks per second, max frame size in
// macroblocks]. The lowest level that fits is declared, because an old
// hardware decoder can refuse a film that claims more than it needs.
const LEVELS = [
  [31, 108000, 3600], [32, 216000, 5120], [40, 245760, 8192], [42, 522240, 8704],
  [50, 589824, 22080], [51, 983040, 36864], [52, 2073600, 36864],
  [60, 4177920, 139264], [61, 8355840, 139264], [62, 16711680, 139264],
];

/** Codec strings to try for a size and rate, lowest fitting level first, High profile before Main. */
function avcCodecs(width, height, hz) {
  const mw = Math.ceil(width / 16);
  const mh = Math.ceil(height / 16);
  const out = [];
  for (const [level, rate, size] of LEVELS) {
    const side = Math.sqrt(8 * size);
    if (mw * mh > size || mw * mh * hz > rate || mw > side || mh > side) continue;
    const hex = level.toString(16).padStart(2, '0');
    out.push('avc1.6400' + hex, 'avc1.4d00' + hex);
  }
  return out;
}

const even = (v) => Math.max(2, 2 * Math.round(v / 2));

// How long the encoder's queue may stand still before the export gives up.
const STALL_MS = 30000;

function copyBytes(source) {
  return source instanceof ArrayBuffer ? new Uint8Array(source.slice(0)) : new Uint8Array(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));
}

async function encodeSound(env, buffer, bitrate) {
  const rate = buffer.sampleRate;
  const channels = buffer.numberOfChannels;
  const config = { codec: 'mp4a.40.2', sampleRate: rate, numberOfChannels: channels, bitrate };
  const support = await env.AudioEncoder.isConfigSupported(config);
  if (!support || !support.supported) {
    throw new Error('film: this browser cannot encode AAC, and a film without its soundtrack is not written');
  }
  const samples = [];
  let asc = null;
  let failure = null;
  const encoder = new env.AudioEncoder({
    output(chunk, meta) {
      if (meta && meta.decoderConfig && meta.decoderConfig.description) asc = copyBytes(meta.decoderConfig.description);
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      samples.push(data);
    },
    error(e) { failure = e; },
  });
  encoder.configure(config);
  const planes = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  for (let at = 0; at < buffer.length; at += 4800) {
    const n = Math.min(4800, buffer.length - at);
    const data = new Float32Array(n * channels);
    planes.forEach((plane, c) => data.set(plane.subarray(at, at + n), c * n));
    const chunk = new env.AudioData({
      format: 'f32-planar', sampleRate: rate, numberOfFrames: n, numberOfChannels: channels,
      timestamp: Math.round((at * 1e6) / rate), data,
    });
    try { encoder.encode(chunk); } finally { chunk.close(); }
  }
  await encoder.flush();
  encoder.close();
  if (failure) throw failure;
  return { samples, asc: asc || aacConfig(rate, channels), sampleRate: rate, channels, bitrate };
}

/**
 * Draw every frame of a validated, solved piece and encode it as MP4.
 *
 * `env` supplies VideoEncoder and VideoFrame, and for a piece with sound
 * AudioEncoder, AudioData and OfflineAudioContext; `createCanvas(w, h)`, a
 * clock `now()` for the report and the stall deadline, and `pause()`, which
 * yields to the event loop while the encoder drains. `opt`: `scale`, `bitrate`, `audioBitrate`,
 * `keySeconds` and `onProgress(done, total)`.
 *
 * Resolves to { bytes, report }; the report is read from the finished file.
 */
async function exportFilm(piece, solved, env, opt = {}) {
  if (!piece.time) throw new Error('film: a still has no frame list, so there is no film to write');
  for (const api of ['VideoEncoder', 'VideoFrame']) {
    if (typeof env[api] !== 'function') throw new Error(`film: this browser has no ${api}, which a frame-exact film needs`);
  }
  if (piece.sound && (typeof env.AudioEncoder !== 'function' || typeof env.AudioData !== 'function')) {
    throw new Error('film: the piece declares sound and this browser has no AudioEncoder, and a film without its soundtrack is not written');
  }
  const now = env.now || Date.now;
  const pause = env.pause || (() => new Promise((r) => setTimeout(r, 0)));
  const heads = playheads(piece);
  const hz = piece.time.hz;
  const scale = opt.scale === undefined ? 1 : opt.scale;
  if (!Number.isFinite(scale) || scale <= 0) throw new Error(`film: scale must be a positive finite number, got ${scale}`);
  const width = even(piece.size.w * scale);
  const height = even(piece.size.h * scale);
  const bitrate = opt.bitrate || Math.min(80e6, Math.max(2e6, Math.round(0.12 * width * height * hz)));
  const started = now();

  let config = null;
  for (const codec of avcCodecs(width, height, hz)) {
    const candidate = { codec, width, height, bitrate, bitrateMode: 'variable', framerate: hz, avc: { format: 'avc' }, latencyMode: 'quality' };
    const support = await env.VideoEncoder.isConfigSupported(candidate);
    if (support && support.supported) { config = candidate; break; }
  }
  if (!config) throw new Error(`film: no H.264 encoder here accepts ${width} x ${height} at ${hz} Hz; export at a smaller scale`);

  // The soundtrack first: it costs a fraction of the frames, and a piece whose
  // sound cannot be rendered or encoded should fail before a long export, not
  // after it.
  let sound = null;
  let soundMs = 0;
  if (piece.sound) {
    const s0 = now();
    const buffer = await renderSound(piece, solved, { OfflineAudioContext: env.OfflineAudioContext });
    sound = await encodeSound(env, buffer, opt.audioBitrate || 192000);
    soundMs = now() - s0;
  }

  const chunks = [];
  let avcC = null;
  let colour = null;
  let failure = null;
  const encoder = new env.VideoEncoder({
    output(chunk, meta) {
      const cfg = meta && meta.decoderConfig;
      if (cfg && cfg.description) avcC = copyBytes(cfg.description);
      if (cfg && cfg.colorSpace) colour = cfg.colorSpace;
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      chunks.push({ data, timestamp: chunk.timestamp, key: chunk.type === 'key' });
    },
    error(e) { failure = e; },
  });
  const canvas = env.createCanvas(width, height);
  const g = canvas.getContext('2d');
  const gop = Math.max(1, Math.round(hz * (opt.keySeconds || 2)));
  let drawMs = 0;
  let waitMs = 0;
  try {
    encoder.configure(config);
    for (let i = 0; i < heads.length; i++) {
      if (failure) throw failure;
      const a = now();
      g.clearRect(0, 0, width, height);
      drawFrame(g, piece, solved, heads[i], { scale });
      const frame = new env.VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / hz), duration: Math.round(1e6 / hz) });
      const b = now();
      try { encoder.encode(frame, { keyFrame: i % gop === 0 }); } finally { frame.close(); }
      // Anything that can hang is raced against a deadline: an encoder that
      // stops draining would otherwise hold the export open for ever.
      const stall = now() + STALL_MS;
      while (encoder.encodeQueueSize > 2 && !failure) {
        if (now() > stall) throw new Error(`film: the encoder stopped accepting frames at frame ${i} of ${heads.length}`);
        await pause();
      }
      drawMs += b - a;
      waitMs += now() - b;
      if (opt.onProgress) opt.onProgress(i + 1, heads.length);
    }
    await encoder.flush();
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
  if (failure) throw failure;
  if (!avcC) throw new Error('film: the encoder described no decoder configuration, so no player could open the film');

  // The timescale holds a whole number of ticks per frame, so no frame drifts.
  const timescale = Math.round(hz * 1000);
  const delta = Math.round(timescale / hz);
  const bytes = muxMp4({
    video: {
      width, height, timescale, delta, avcC, colour,
      samples: chunks.map((c, i) => ({ data: c.data, key: c.key, offset: Math.round((c.timestamp * timescale) / 1e6) - i * delta })),
    },
    audio: sound,
  });
  const report = filmCheck({ frames: heads.length, hz, width, height, sound: !!piece.sound }, readMp4(bytes));
  const totalMs = now() - started;
  return {
    bytes,
    report: Object.assign(report, {
      codec: config.codec, bitrate, bytes: bytes.length, hz,
      drawMs: Math.round(drawMs), encodeWaitMs: Math.round(waitMs), soundMs: Math.round(soundMs), totalMs: Math.round(totalMs),
      realtime: totalMs > 0 ? +((report.seconds * 1000) / totalMs).toFixed(2) : null,
    }),
  };
}

module.exports = { exportFilm, muxMp4, readMp4, filmCheck, avcCodecs, aacConfig };
