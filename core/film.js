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
// EVERY FILM IS LIMITED-RANGE BT.709. An encoder handed a canvas converts it to
// video colour its own way, and the range it picks can change from one export
// to the next. Platforms that re-encode an upload may ignore a full-range tag
// and shift every colour. So the encoder converts frames itself only where
// probes in the same export prove it writes limited-range BT.709; otherwise
// each drawn frame is converted to BT.709 limited-range NV12 before the encoder
// sees it. The `colr` box and the H.264 stream's own sequence parameter set
// both say so, and the check refuses a film tagged anything else or tagged two
// ways.
//
// THE FILM NAMES ITS RECIPE. Like an SVG, every film carries the replay manifest
// it was drawn from, so a saved file can say which piece, seed and parameters
// made it. The check refuses a film whose manifest is missing or differs.
//
// The browser's encoders arrive through `env`, so the whole path runs in Node
// against controlled stand-ins. Nothing here knows what a piece depicts.

'use strict';

const { drawFrame, playheads, renderSound } = require('./render.js');
const { solve } = require('./piece.js');
const { flashReader } = require('./flash.js');

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

// The colour space of every frame handed to the encoder, in WebCodecs names,
// and the `colr` box that states it in ISO/IEC 23091-2 code points: BT.709
// primaries, transfer and matrix (1, 1, 1), full range off.
const BT709 = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false };
const COLR = box('colr', ascii('nclx'), u16(1), u16(1), u16(1), u8(0));

// The same description inside the H.264 stream, for a player or platform that
// ignores `colr`: the video signal type of the sequence parameter set's VUI
// (ITU-T H.264, 7.3.2.1.1 and E.1.1). Edge's encoder writes a VUI without one.

// Profiles whose SPS carries a chroma format, bit depths and scaling lists.
const HIGH_PROFILES = [100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135];

/** A NAL unit's payload without its header byte or its emulation-prevention bytes. */
function rbspOf(nal) {
  const out = [];
  for (let i = 1; i < nal.length; i++) {
    if (i + 2 < nal.length && nal[i] === 0 && nal[i + 1] === 0 && nal[i + 2] === 3) { out.push(0, 0); i += 2; continue; }
    out.push(nal[i]);
  }
  return out;
}

/** A NAL unit under `header`, with an emulation-prevention byte wherever two zeros precede 0 to 3. */
function nalOf(header, rbsp) {
  const out = [header];
  let zeros = 0;
  for (const b of rbsp) {
    if (zeros >= 2 && b <= 3) { out.push(3); zeros = 0; }
    out.push(b);
    zeros = b === 0 ? zeros + 1 : 0;
  }
  return Uint8Array.from(out);
}

/**
 * Where an SPS's RBSP keeps its video signal type, in bits: `vui` is
 * vui_parameters_present_flag, `signal` video_signal_type_present_flag and
 * `after` the bit past the signal type, both null without a VUI. `colour` is
 * what the signal type says -- { format, fullRange, primaries, transfer,
 * matrix }, 2 meaning unspecified -- or null without one.
 */
function spsLayout(rbsp) {
  let at = 0;
  const u = (n) => {
    let v = 0;
    for (let i = 0; i < n; i++, at++) {
      if (at >= rbsp.length * 8) throw new Error('film: a sequence parameter set ends before its fields do');
      v = v * 2 + ((rbsp[at >> 3] >> (7 - (at & 7))) & 1);
    }
    return v;
  };
  const ue = () => { let z = 0; while (!u(1)) z++; return 2 ** z - 1 + u(z); };
  const se = () => { const k = ue(); return k & 1 ? (k + 1) / 2 : -k / 2; };
  const profile = u(8);
  u(16);
  ue();
  if (HIGH_PROFILES.includes(profile)) {
    const chroma = ue();
    if (chroma === 3) u(1);
    ue(); ue(); u(1);
    // Scaling lists are read only to be stepped over.
    if (u(1)) {
      for (let i = 0; i < (chroma !== 3 ? 8 : 12); i++) {
        if (!u(1)) continue;
        for (let j = 0, last = 8, next = 8; j < (i < 6 ? 16 : 64); j++) {
          if (next !== 0) next = (last + se() + 256) % 256;
          last = next === 0 ? last : next;
        }
      }
    }
  }
  ue();
  const poc = ue();
  if (poc === 0) ue();
  else if (poc === 1) { u(1); se(); se(); for (let i = 0, n = ue(); i < n; i++) se(); }
  ue(); u(1); ue(); ue();
  if (!u(1)) u(1);
  u(1);
  if (u(1)) { ue(); ue(); ue(); ue(); }
  const vui = at;
  if (!u(1)) return { vui, signal: null, after: null, colour: null };
  if (u(1) && u(8) === 255) u(32);
  if (u(1)) u(1);
  const signal = at;
  let colour = null;
  if (u(1)) {
    const format = u(3), fullRange = u(1) === 1;
    colour = u(1) ? { format, fullRange, primaries: u(8), transfer: u(8), matrix: u(8) } : { format, fullRange, primaries: 2, transfer: 2, matrix: 2 };
  }
  return { vui, signal, after: at, colour };
}

/**
 * The SPS NAL unit with its video signal type saying limited-range BT.709:
 * video format unspecified, full range off, primaries, transfer and matrix 1.
 * Every other bit is copied as the encoder wrote it. An SPS without a VUI gets
 * one holding the signal type alone, whose other flags left off infer what an
 * absent VUI does.
 */
function spsBt709(nal) {
  const rbsp = rbspOf(nal);
  const l = spsLayout(rbsp);
  // The rbsp_stop_one_bit is the last bit set.
  let stop = rbsp.length * 8 - 1;
  while (stop >= 0 && !((rbsp[stop >> 3] >> (7 - (stop & 7))) & 1)) stop--;
  if (stop < 0) throw new Error('film: the encoder wrote a sequence parameter set without its stop bit');
  const bits = [];
  const copy = (from, to) => { for (let i = from; i < to; i++) bits.push((rbsp[i >> 3] >> (7 - (i & 7))) & 1); };
  const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1); };
  const signal = () => { put(1, 1); put(5, 3); put(0, 1); put(1, 1); put(1, 8); put(1, 8); put(1, 8); };
  if (l.signal === null) {
    copy(0, l.vui);
    put(1, 1); put(0, 1); put(0, 1); signal(); put(0, 6);
    copy(l.vui + 1, stop);
  } else {
    copy(0, l.signal); signal(); copy(l.after, stop);
  }
  put(1, 1);
  while (bits.length % 8) bits.push(0);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((v, b) => v * 2 + b, 0));
  return nalOf(nal[0], out);
}

/** The avcC configuration with each SPS it holds said in limited-range BT.709; the rest unchanged. */
function avcCBt709(avcC) {
  const parts = [avcC.subarray(0, 6)];
  let at = 6;
  for (let i = 0, n = avcC[5] & 31; i < n; i++) {
    const sps = spsBt709(avcC.subarray(at + 2, at + 2 + ((avcC[at] << 8) | avcC[at + 1])));
    parts.push(u16(sps.length), sps);
    at += 2 + ((avcC[at] << 8) | avcC[at + 1]);
  }
  parts.push(avcC.subarray(at));
  return concat(parts);
}

/**
 * A sample of length-prefixed NAL units, with any SPS it repeats said in
 * limited-range BT.709. A sample that is not whole NAL units is left alone.
 */
function sampleBt709(data, size) {
  const parts = [];
  let changed = false;
  for (let at = 0; at < data.length;) {
    let n = 0;
    for (let k = 0; k < size; k++) n = n * 256 + data[at + k];
    if (!(n > 0 && at + size + n <= data.length)) return data;
    const nal = data.subarray(at + size, at + size + n);
    if ((nal[0] & 31) === 7) {
      const sps = spsBt709(nal);
      parts.push(Uint8Array.from({ length: size }, (_, k) => Math.floor(sps.length / 256 ** (size - 1 - k)) & 255), sps);
      changed = true;
    } else parts.push(data.subarray(at, at + size + n));
    at += size + n;
  }
  return changed ? concat(parts) : data;
}

// The replay manifest rides in moov/udta, the user-data box, as a `uuid` box,
// the ISO/IEC 14496-12 form for a private box type:
//
//   u32 size | 'uuid' | the 16-byte extended type below | manifest JSON
//
// The JSON runs to the end of the box, size - 24 bytes. It is ASCII only: any
// other character is written as a \uXXXX escape, so the bytes are also UTF-8
// and no TextEncoder is needed. Readers skip a box type they do not know, so
// players ignore it. It sits in moov, outside the media data, so adding it moves
// the chunk offsets and no sample byte.
const MANIFEST_TYPE = Uint8Array.of(0x8b, 0x2f, 0xd9, 0x66, 0xe9, 0x23, 0x43, 0x30, 0xa2, 0x8e, 0x6d, 0x82, 0x58, 0x7d, 0x1e, 0xc9);
const manifestBox = (m) => box('uuid', MANIFEST_TYPE,
  ascii(JSON.stringify(m).replace(/[^\x00-\x7f]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))));

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
  parts.push(full('stsz', 0, 0, u32(0), u32(t.sizes.length), ...t.sizes.map(u32)));
  parts.push(full('stco', 0, 0, u32(t.chunks.length), ...t.chunks.map(u32)));
  return box('stbl', ...parts);
}

function track(t, movieScale) {
  // A track with an edit lasts what its edit presents, as ISO/IEC 14496-12 has it.
  const span = t.edit ? t.edit.duration : Math.round((t.duration * movieScale) / t.timescale);
  const audio = t.handler === 'soun';
  return box('trak',
    full('tkhd', 0, 3, u32(0), u32(0), u32(t.id), u32(0), u32(span), new Uint8Array(8),
      u16(0), u16(0), u16(audio ? 0x0100 : 0), u16(0), IDENTITY,
      u32((t.width || 0) * 65536), u32((t.height || 0) * 65536)),
    // One edit: segment_duration in movie ticks, media_time in the track's own
    // ticks, media rate 1.
    t.edit ? box('edts', full('elst', 0, 0, u32(1), u32(t.edit.duration), u32(t.edit.mediaTime), u16(1), u16(0))) : new Uint8Array(0),
    box('mdia',
      full('mdhd', 0, 0, u32(0), u32(0), u32(t.timescale), u32(t.duration), u16(0x55c4), u16(0)),
      full('hdlr', 0, 0, u32(0), ascii(t.handler), new Uint8Array(12), ascii(audio ? 'SoundHandler\0' : 'VideoHandler\0')),
      box('minf',
        audio ? full('smhd', 0, 0, new Uint8Array(4)) : full('vmhd', 0, 1, new Uint8Array(8)),
        box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))),
        sampleTable(t))));
}

function avcEntry(width, height, avcC) {
  const name = new Uint8Array(32);
  const label = ascii('Artifex H.264');
  name[0] = label.length;
  name.set(label, 1);
  return box('avc1', new Uint8Array(6), u16(1), u16(0), u16(0), new Uint8Array(12), u16(width), u16(height),
    u32(0x00480000), u32(0x00480000), u32(0), u16(1), name, u16(0x0018), u16(0xffff),
    box('avcC', avcC), COLR);
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
 * The `dOps` box from the encoder's OpusHead (RFC 7845, section 5.1): the same
 * fields in the same order under version 0, big-endian where OpusHead is
 * little-endian, except PreSkip, which is written as 0.
 *
 * The encoder's pre-skip, the samples it spent warming up, is skipped by the
 * soundtrack's edit list, which Opus in ISOBMFF makes the trim and PreSkip
 * informative only. Chromium trims by both, so a PreSkip that repeated the
 * edit would drop the pre-skip twice there.
 */
function opusSpecific(head) {
  // Mapping families other than 0 add stream counts and a channel mapping.
  const table = head && head[18] ? 2 + head[9] : 0;
  if (!head || head.length < 19 + table || String.fromCharCode(...head.subarray(0, 8)) !== 'OpusHead') {
    throw new Error('film: the Opus encoder described its stream with something other than an OpusHead');
  }
  const le = new DataView(head.buffer, head.byteOffset, head.byteLength);
  return box('dOps', u8(0), u8(head[9]), u16(0), u32(le.getUint32(12, true)), u16(le.getInt16(16, true)),
    u8(head[18]), head.subarray(19, 19 + table));
}

/** An Opus sample entry: 48 kHz whatever rate went in, and its `dOps`. */
function opusEntry(head) {
  const dOps = opusSpecific(head);
  return box('Opus', new Uint8Array(6), u16(1), new Uint8Array(8), u16(head[9]), u16(16), u16(0), u16(0), u32(48000 * 65536), dOps);
}

/** How many 48 kHz samples an Opus packet holds, from its TOC byte (RFC 6716, section 3.1). */
function opusSamples(packet) {
  const config = packet[0] >> 3;
  const frame = config < 12 ? [480, 960, 1920, 2880][config & 3]
    : config < 16 ? [480, 960][config & 1]
      : [120, 240, 480, 960][config & 3];
  const code = packet[0] & 3;
  return frame * (code === 0 ? 1 : code === 3 ? packet[1] & 63 : 2);
}

/**
 * One MP4 file: moov first, so a player can start before it has the whole file.
 *
 * `video`: { width, height, timescale, delta, samples: [{ data, key, offset }],
 * avcC }, tagged limited-range BT.709 in `colr` and in every sequence parameter
 * set, the avcC's and any a sample repeats. `audio`, optional, is AAC as { sampleRate,
 * channels, samples: [Uint8Array], asc, bitrate, priming }, or Opus as { codec:
 * 'opus', head, samples, priming }, where `head` is the encoder's OpusHead and
 * `priming` the samples the encoder primed the soundtrack with: the Opus
 * pre-skip, or an AAC encoder's reported delay. `manifest`, optional, is the
 * replay manifest, written to moov/udta. Every sample is its own chunk.
 *
 * THE FILM IS AS LONG AS ITS PICTURES. The movie counts time in the video's own
 * ticks, so the movie, each track and the soundtrack's edit all state the
 * film's length exactly. An encoder's soundtrack starts with its priming and
 * runs past the film, to the end of its last packet. The soundtrack's one edit
 * skips the priming and plays exactly the film's length.
 */
function muxMp4(film) {
  const parts = [];
  writeMp4(film, (p) => parts.push(p));
  return concat(parts);
}

/**
 * The file muxMp4 makes, handed to `write` part by part in file order, so a
 * caller can put it on disk without holding it. A sample's bytes, a video
 * sample's `data` or an audio sample, may also be a function returning them;
 * it is called twice, once to measure the sample for moov and once to write
 * it, and nothing keeps what it returns.
 */
function writeMp4({ video, audio = null, manifest = null }, write) {
  const length = video.samples.length * video.delta;
  const avcC = avcCBt709(video.avcC);
  const bytesOf = (d) => (typeof d === 'function' ? d() : d);
  const picture = (s) => sampleBt709(bytesOf(s.data), (avcC[4] & 3) + 1);
  // A sample given as bytes is converted once and kept, as it is held anyway.
  const pictures = video.samples.map((s) => (typeof s.data === 'function' ? null : picture(s)));
  const tracks = [{
    id: 1, handler: 'vide', timescale: video.timescale, duration: length,
    width: video.width, height: video.height,
    entry: avcEntry(video.width, video.height, avcC),
    sizes: video.samples.map((s, i) => (pictures[i] || picture(s)).length),
    sample: (i) => pictures[i] || picture(video.samples[i]),
    deltas: video.samples.map(() => video.delta),
    offsets: video.samples.map((s) => s.offset || 0),
    keys: video.samples.map((s, i) => (s.key ? i + 1 : 0)).filter(Boolean),
  }];
  if (audio) {
    const opus = audio.codec === 'opus';
    const sizes = [];
    const deltas = audio.samples.map((s) => { const b = bytesOf(s); sizes.push(b.length); return opus ? opusSamples(b) : 1024; });
    tracks.push({
      id: 2, handler: 'soun', timescale: opus ? 48000 : audio.sampleRate, duration: deltas.reduce((n, d) => n + d, 0),
      // A joined film carries its scenes' sample entry as they wrote it.
      entry: audio.entry || (opus ? opusEntry(audio.head) : aacEntry(audio.channels, audio.sampleRate, audio.asc, audio.bitrate)),
      sizes, sample: (i) => bytesOf(audio.samples[i]), deltas,
      edit: { duration: length, mediaTime: audio.priming || 0 },
    });
  }
  const ftyp = box('ftyp', ascii('isom'), u32(512), ascii('isom'), ascii('iso2'), ascii('avc1'), ascii('mp41'));
  const movieScale = video.timescale;
  const udta = manifest ? box('udta', manifestBox(manifest)) : new Uint8Array(0);
  const moov = () => box('moov',
    full('mvhd', 0, 0, u32(0), u32(0), u32(movieScale), u32(length), u32(0x00010000), u16(0x0100), new Uint8Array(10),
      IDENTITY, new Uint8Array(24), u32(tracks.length + 1)),
    ...tracks.map((t) => track(t, movieScale)), udta);
  // Chunk offsets depend on moov's size and moov's size never depends on the
  // offsets (stco entries are fixed width), so measure once and fill in.
  for (const t of tracks) t.chunks = t.sizes.map(() => 0);
  const start = ftyp.length + moov().length + 8;
  let at = start;
  for (const t of tracks) t.chunks = t.sizes.map((n) => { const o = at; at += n; return o; });
  write(ftyp);
  write(moov());
  write(concat([u32(at - start + 8), ascii('mdat')]));
  for (const t of tracks) {
    t.sizes.forEach((n, i) => {
      const b = t.sample(i);
      if (b.length !== n) throw new Error(`film: a sample measured ${n} bytes and gave ${b.length} to write`);
      write(b);
    });
  }
}

// ---------------------------------------------------------------------------
// Reading it back
// ---------------------------------------------------------------------------

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'dinf', 'edts', 'udta']);

/**
 * What an MP4 file actually holds: the movie's timescale and duration, its
 * replay manifest, or null, and each track's codec, size, timescale, sample
 * durations, its header's duration (`span`, in movie ticks), its edit list or
 * null, keyframes, colour tag, an H.264 track's `sps` -- the colour description
 * of every sequence parameter set, the avcC's first and then any a sample
 * repeats, null for one without -- an Opus track's `dOps`, and whether every
 * sample lies inside the media data. Each track also gives the bytes a joiner
 * copies: its sample entry `entry`, an H.264 track's `avcC` body, its
 * composition offsets as `offsets` runs [count, offset] or null, and every
 * sample's byte `positions` and `sizes`. Reads any file with 32-bit chunk
 * offsets, not only this writer's.
 *
 * `file`, optional, reads a file too large to hold: `bytes` is then its head,
 * every box before the media data and the media data's own header, `size` the
 * whole file's length and `read(at, n)` its n bytes from byte `at`, called once
 * for each video sample. The media data must be the file's last box.
 */
function readMp4(bytes, { size: length = bytes.length, read = (at, n) => bytes.subarray(at, at + n) } = {}) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = (at) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  const out = { brand: null, seconds: 0, movie: null, media: null, manifest: null, tracks: [] };
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
      else if (kind === 'uuid' && size - head >= 16 && MANIFEST_TYPE.every((v, i) => bytes[b + i] === v)) {
        let json = '';
        for (let i = b + 16; i < at + size; i++) json += String.fromCharCode(bytes[i]);
        try { out.manifest = JSON.parse(json); } catch (e) { throw new Error(`film: the replay manifest at byte ${at} is not JSON: ${e.message}`); }
      }
      else if (kind === 'mvhd') {
        const v1 = bytes[b] === 1;
        out.movie = { timescale: view.getUint32(b + (v1 ? 20 : 12)), duration: v1 ? Number(view.getBigUint64(b + 24)) : view.getUint32(b + 16) };
        out.seconds = out.movie.duration / out.movie.timescale;
      } else if (kind === 'trak') {
        t = { handler: null, codec: null, entry: null, avcC: null, colour: null, sps: [], nalLength: 0, opus: null, span: null, edits: null, deltas: [], keys: null, sizes: [], chunks: [], stsc: [], offsets: null };
        out.tracks.push(t);
      } else if (kind === 'tkhd') t.span = bytes[b] === 1 ? Number(view.getBigUint64(b + 28)) : view.getUint32(b + 20);
      else if (kind === 'elst') {
        // Each edit: segment_duration in movie ticks, media_time in the track's
        // ticks (-1 for an empty edit), and the media rate.
        const v1 = bytes[b] === 1;
        t.edits = [];
        for (let i = 0, n = view.getUint32(b + 4), p = b + 8; i < n; i++, p += v1 ? 20 : 12) {
          t.edits.push(v1
            ? { duration: Number(view.getBigUint64(p)), mediaTime: Number(view.getBigInt64(p + 8)), rate: view.getInt16(p + 16) + view.getInt16(p + 18) / 65536 }
            : { duration: view.getUint32(p), mediaTime: view.getInt32(p + 4), rate: view.getInt16(p + 8) + view.getInt16(p + 10) / 65536 });
        }
      } else if (kind === 'hdlr') t.handler = type(b + 8);
      else if (kind === 'mdhd') {
        const v1 = bytes[b] === 1;
        t.timescale = view.getUint32(b + (v1 ? 20 : 12));
        t.duration = v1 ? Number(view.getBigUint64(b + 24)) : view.getUint32(b + 16);
      } else if (kind === 'stsd') {
        const entry = b + 8;
        t.codec = type(entry + 4);
        t.entry = bytes.subarray(entry, entry + view.getUint32(entry));
        if (t.codec === 'avc1') {
          t.width = view.getUint16(entry + 32);
          t.height = view.getUint16(entry + 34);
          walk(entry + 86, entry + view.getUint32(entry));
        } else if (t.codec === 'mp4a' || t.codec === 'Opus') {
          t.channels = view.getUint16(entry + 24);
          t.sampleRate = view.getUint32(entry + 32) >>> 16;
          if (t.codec === 'Opus') walk(entry + 36, entry + view.getUint32(entry));
        }
      } else if (kind === 'avcC') {
        // Its sequence parameter sets, and the length prefix its samples' NAL units carry.
        t.avcC = bytes.subarray(b, at + size);
        t.nalLength = (bytes[b + 4] & 3) + 1;
        for (let i = 0, n = bytes[b + 5] & 31, p = b + 6; i < n; i++, p += 2 + view.getUint16(p)) {
          t.sps.push(spsLayout(rbspOf(bytes.subarray(p + 2, p + 2 + view.getUint16(p)))).colour);
        }
      } else if (kind === 'colr' && type(b) === 'nclx') {
        t.colour = { primaries: view.getUint16(b + 4), transfer: view.getUint16(b + 6), matrix: view.getUint16(b + 8), fullRange: (bytes[b + 10] & 0x80) !== 0 };
      } else if (kind === 'dOps' && size - head >= 11) {
        t.opus = {
          version: bytes[b], channels: bytes[b + 1], preSkip: view.getUint16(b + 2), inputSampleRate: view.getUint32(b + 4),
          outputGain: view.getInt16(b + 8), mappingFamily: bytes[b + 10],
        };
      } else if (kind === 'stts') {
        for (let i = 0, n = view.getUint32(b + 4); i < n; i++) t.deltas.push([view.getUint32(b + 8 + i * 8), view.getUint32(b + 12 + i * 8)]);
      } else if (kind === 'ctts') {
        // Run-length pairs [count, offset]; version 1 offsets are signed.
        t.offsets = [];
        for (let i = 0, n = view.getUint32(b + 4); i < n; i++) {
          t.offsets.push([view.getUint32(b + 8 + i * 8), bytes[b] === 1 ? view.getInt32(b + 12 + i * 8) : view.getUint32(b + 12 + i * 8)]);
        }
      }
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
  walk(0, length);
  return {
    brand: out.brand,
    seconds: out.seconds,
    movie: out.movie,
    manifest: out.manifest,
    tracks: out.tracks.map((x) => {
      // Place every sample from its chunk and the chunk's run in stsc.
      let inside = !!out.media && x.sizes.length > 0;
      let sample = 0;
      const positions = [];
      for (let c = 0; c < x.chunks.length && sample < x.sizes.length; c++) {
        const run = x.stsc.filter((r) => r[0] <= c + 1).pop();
        let at = x.chunks[c];
        for (let k = 0; k < (run ? run[1] : 1) && sample < x.sizes.length; k++, sample++) {
          positions.push(at);
          if (at < out.media[0] || at + x.sizes[sample] > out.media[1]) inside = false;
          // A sequence parameter set the sample repeats, in its length-prefixed NAL units.
          else if (x.nalLength) {
            const data = read(at, x.sizes[sample]);
            for (let p = 0, end = data.length; p + x.nalLength < end;) {
              let n = 0;
              for (let i = 0; i < x.nalLength; i++) n = n * 256 + data[p + i];
              if (n === 0 || p + x.nalLength + n > end) break;
              if ((data[p + x.nalLength] & 31) === 7) x.sps.push(spsLayout(rbspOf(data.subarray(p + x.nalLength, p + x.nalLength + n))).colour);
              p += x.nalLength + n;
            }
          }
          at += x.sizes[sample];
        }
      }
      if (sample < x.sizes.length) inside = false;
      return {
        kind: x.handler, codec: x.codec, width: x.width, height: x.height, channels: x.channels, sampleRate: x.sampleRate,
        timescale: x.timescale, duration: x.duration, span: x.span, edits: x.edits, samples: x.sizes.length,
        bytes: x.sizes.reduce((s, v) => s + v, 0), deltas: x.deltas, keys: x.keys, colour: x.colour, sps: x.sps, opus: x.opus,
        reordered: !!x.offsets, inside, entry: x.entry, avcC: x.avcC, offsets: x.offsets, positions, sizes: x.sizes,
      };
    }),
  };
}

/**
 * Judge a film by what its file holds against the frame grid it was cut from.
 *
 * `expected`: { frames, hz, width, height, sound, priming, manifest, route,
 * missing }, where `priming` is the samples the encoder primed the soundtrack
 * with, `manifest` the one the export drew from, and the optional `route` and
 * `missing` the colour route that ran and the timestamps, in microseconds, of
 * the frames its encoder returned nothing for, which a frame-count refusal
 * names. Throws naming the first thing the file gets wrong; returns the report
 * otherwise.
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
    const lost = expected.missing || [];
    throw new Error(`film: the file holds ${v.samples} of ${expected.frames} frames`
      + (expected.route ? `, from the ${expected.route} route` : '')
      + (lost.length ? `; its encoder returned nothing for the frames at ${lost.slice(0, 3).map((t) => `${t} µs`).join(', ')}`
        + (lost.length > 3 ? ` and ${lost.length - 3} more` : '') : '')
      + '. Nothing was saved.');
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
    throw new Error('film: the file carries no colour tag, so a player would have to guess its colours. Nothing was saved.');
  }
  const { primaries, transfer, matrix, fullRange } = v.colour;
  if (primaries !== 1 || transfer !== 1 || matrix !== 1 || fullRange) {
    throw new Error(`film: the file is tagged primaries ${primaries}, transfer ${transfer}, matrix ${matrix}, ${fullRange ? 'full' : 'limited'} range, `
      + 'and every film must be limited-range BT.709 (1, 1, 1). Nothing was saved.');
  }
  // Every sequence parameter set says the same, for a player that ignores colr.
  const stream = v.sps.find((c) => !c || c.primaries !== primaries || c.transfer !== transfer || c.matrix !== matrix || c.fullRange !== fullRange);
  if (!v.sps.length || stream === null) {
    throw new Error('film: the H.264 stream carries no colour description, so a player that ignores colr has to guess its colours. Nothing was saved.');
  }
  if (stream) {
    throw new Error(`film: the H.264 stream says primaries ${stream.primaries}, transfer ${stream.transfer}, matrix ${stream.matrix}, `
      + `${stream.fullRange ? 'full' : 'limited'} range, and its colr box says limited-range BT.709 (1, 1, 1). Nothing was saved.`);
  }
  if (!file.manifest) throw new Error('film: the file carries no replay manifest, so it cannot say what made it. Nothing was saved.');
  const differs = Object.keys({ ...expected.manifest, ...file.manifest })
    .find((k) => JSON.stringify(file.manifest[k]) !== JSON.stringify(expected.manifest[k]));
  if (differs) {
    throw new Error(`film: the file's manifest gives ${differs} ${JSON.stringify(file.manifest[differs])} `
      + `where the export drew with ${JSON.stringify(expected.manifest[differs])}. Nothing was saved.`);
  }
  const seconds = v.duration / v.timescale;
  // The movie and every track last the film, however far the soundtrack's
  // last packet runs.
  const movie = file.movie || { timescale: 0, duration: 0 };
  if (!(Math.abs(movie.duration / movie.timescale - seconds) * movie.timescale <= 0.5)) {
    throw new Error(`film: the movie lasts ${(movie.duration / movie.timescale).toFixed(3)} s against a ${seconds.toFixed(3)} s film. Nothing was saved.`);
  }
  const long = file.tracks.find((x) => x.span !== movie.duration);
  if (long) {
    throw new Error(`film: the ${long.kind === 'soun' ? 'sound' : 'video'} track's header gives ${(long.span / movie.timescale).toFixed(3)} s `
      + `against a ${seconds.toFixed(3)} s film. Nothing was saved.`);
  }
  let sound = null;
  if (expected.sound) {
    const a = audio[0];
    // A decoder opens an Opus track by its dOps.
    const opus = a && a.codec === 'Opus' ? a.opus : null;
    if (audio.length !== 1 || !(a.codec === 'mp4a' || (opus && opus.version === 0)) || !a.inside || a.samples === 0) {
      throw new Error('film: the piece declares sound and the file holds no playable soundtrack. Nothing was saved.');
    }
    // One edit plays it, past the samples the encoder primed and for exactly the
    // film's length. The priming is the encoder's word, never read back from
    // the file: dOps carries a PreSkip of 0.
    const edit = a.edits && a.edits.length === 1 && a.edits[0].rate === 1 && a.edits[0].mediaTime >= 0 ? a.edits[0] : null;
    if (!edit) {
      throw new Error('film: the soundtrack has no single edit to play it, so a player may start it with the encoder\'s priming '
        + 'or play it past the pictures. Nothing was saved.');
    }
    if (edit.duration !== movie.duration) {
      throw new Error(`film: the soundtrack's edit lasts ${(edit.duration / movie.timescale).toFixed(3)} s against a ${seconds.toFixed(3)} s film. Nothing was saved.`);
    }
    if (edit.mediaTime !== expected.priming) {
      throw new Error(`film: the soundtrack's edit skips ${edit.mediaTime} samples and the encoder primed ${expected.priming}. Nothing was saved.`);
    }
    const heard = (a.duration - edit.mediaTime) / a.timescale;
    const grain = Math.max(...a.deltas.map(([, d]) => d)) / a.timescale;
    // Every encoder measured leaves packets covering its whole edit, so one
    // that ends before its edit, by however little, is refused.
    const covered = (a.duration - edit.mediaTime) * movie.timescale >= edit.duration * a.timescale;
    if (!covered || heard > seconds + 2 * grain) {
      throw new Error(`film: the soundtrack lasts ${heard.toFixed(3)} s against a ${seconds.toFixed(3)} s film. Nothing was saved.`);
    }
    sound = { codec: a.codec, seconds: heard, channels: a.channels, sampleRate: a.sampleRate };
  } else if (audio.length) {
    throw new Error('film: the piece declares no sound and the file holds a soundtrack. Nothing was saved.');
  }
  return { frames: v.samples, seconds, width: v.width, height: v.height, keyframes: v.keys.length, colour: v.colour, sound, manifest: file.manifest };
}

// ---------------------------------------------------------------------------
// Drawn frames to BT.709 limited-range NV12
// ---------------------------------------------------------------------------

// BT.709 luma weights. Limited range puts luma in 16..235 and chroma in 16..240.
const KR = 0.2126;
const KB = 0.0722;
const KG = 1 - KR - KB;

// DITHER. Limited range squeezes 256 levels of each channel into 220 of luma
// (225 of chroma), so rounding every sample the same way merges one level in
// about seven and a slow ramp decodes as flat steps up to twice as wide as the
// drawing's own. Each sample gets a seeded offset in (-0.5, 0.5) before it
// rounds: under half a level either way, uniform, mean zero, the same pattern on
// every frame so the encoder predicts it rather than paying for new noise. A
// value that lands on a whole level, as black, white and pure primaries do,
// rounds to that level whatever the offset. It is an integer hash of the
// sample's column and row, each modulo 128, and its plane (0 luma, 1 U, 2 V),
// whose hash the shader computes bit for bit, since GLSL's uint arithmetic
// wraps as Math.imul does; its float offset can differ in the last bits.
const DITHER = [0x8da6b343, 0xd8163841, 0xcb1ab31f, 0x7feb352d, 0x846ca68b];

/** The offset added to sample (x, y) of `plane` before it rounds, in (-0.5, 0.5). */
function dither(x, y, plane) {
  let h = Math.imul(x & 127, DITHER[0]) ^ Math.imul(y & 127, DITHER[1]) ^ Math.imul(plane + 1, DITHER[2]);
  h ^= h >>> 16; h = Math.imul(h, DITHER[3]); h ^= h >>> 15; h = Math.imul(h, DITHER[4]); h ^= h >>> 16;
  return ((h >>> 8) + 0.5) / 16777216 - 0.5;
}

// The pattern repeats every 128 samples across and down, so the CPU reads it
// from a table: planes 0, 1 and 2, 16384 offsets each, row by row.
let ditherTile = null;
const ditherTable = () => ditherTile || (ditherTile = Float64Array.from({ length: 3 << 14 }, (_, i) => dither(i & 127, (i >> 7) & 127, i >> 14)));

// The same function in GLSL ES 3.00.
const DITHER_GLSL = `float dither(int x, int y, uint plane) {
  uint h = uint(x & 127) * ${DITHER[0]}u ^ uint(y & 127) * ${DITHER[1]}u ^ (plane + 1u) * ${DITHER[2]}u;
  h ^= h >> 16u; h *= ${DITHER[3]}u; h ^= h >> 15u; h *= ${DITHER[4]}u; h ^= h >> 16u;
  return (float(h >> 8u) + 0.5) / 16777216.0 - 0.5;
}`;

/**
 * RGBA pixels, as a canvas holds them, to BT.709 limited-range NV12: a luma
 * plane with a sample for every pixel, then one plane of chroma pairs, U then
 * V, one pair for every 2x2 block from the block's average. The canvas's
 * sRGB-encoded values are the R'G'B' that BT.709 converts. A translucent pixel
 * is composited over black, as an encoder handed the canvas would. Each
 * sample rounds after its `dither` offset. Width and height are even.
 */
function rgbaToNV12(px, w, h, out = new Uint8Array(w * h * 1.5)) {
  const cw = w >> 1;
  const u = w * h;
  const row = w * 4;
  const yr = KR * 219 / 255, yg = KG * 219 / 255, yb = KB * 219 / 255;
  // Chroma is computed from the sum of the block's four pixels.
  const cb = 224 / 255 / (2 * (1 - KB)) / 4, cr = 224 / 255 / (2 * (1 - KR)) / 4;
  const D = ditherTable();
  for (let y = 0; y < h; y += 2) {
    // x and y are even, so the pixel right of or below one is one step on in the tile.
    const dy = (y & 127) << 7, dc = 16384 + (((y >> 1) & 127) << 7);
    for (let x = 0, p = y * row, o = y * w, c = (y >> 1) * cw; x < w; x += 2, p += 8, o += 2, c++) {
      const q = p + row, d = dy + (x & 127), e = dc + ((x >> 1) & 127);
      let r0 = px[p], g0 = px[p + 1], b0 = px[p + 2], r1 = px[p + 4], g1 = px[p + 5], b1 = px[p + 6];
      let r2 = px[q], g2 = px[q + 1], b2 = px[q + 2], r3 = px[q + 4], g3 = px[q + 5], b3 = px[q + 6];
      if ((px[p + 3] & px[p + 7] & px[q + 3] & px[q + 7]) !== 255) {
        const a0 = px[p + 3] / 255, a1 = px[p + 7] / 255, a2 = px[q + 3] / 255, a3 = px[q + 7] / 255;
        r0 *= a0; g0 *= a0; b0 *= a0; r1 *= a1; g1 *= a1; b1 *= a1;
        r2 *= a2; g2 *= a2; b2 *= a2; r3 *= a3; g3 *= a3; b3 *= a3;
      }
      // A Uint8Array store truncates, so the added 0.5 plus the dither rounds.
      out[o] = 16.5 + D[d] + yr * r0 + yg * g0 + yb * b0;
      out[o + 1] = 16.5 + D[d + 1] + yr * r1 + yg * g1 + yb * b1;
      out[o + w] = 16.5 + D[d + 128] + yr * r2 + yg * g2 + yb * b2;
      out[o + w + 1] = 16.5 + D[d + 129] + yr * r3 + yg * g3 + yb * b3;
      const rs = r0 + r1 + r2 + r3, gs = g0 + g1 + g2 + g3, bs = b0 + b1 + b2 + b3;
      const ls = KR * rs + KG * gs + KB * bs;
      out[u + 2 * c] = 128.5 + D[e] + cb * (bs - ls);
      out[u + 2 * c + 1] = 128.5 + D[e + 16384] + cr * (rs - ls);
    }
  }
  return out;
}

// Eight by four pixels whose NV12 the GPU must reproduce: black, white, the
// primaries, grey, a block of four colours and a translucent white.
const PROBE = [
  '#000', '#000', '#fff', '#fff', '#f00', '#f00', '#0f0', '#0f0',
  '#000', '#000', '#fff', '#fff', '#f00', '#f00', '#0f0', '#0f0',
  '#00f', '#00f', '#808080', '#808080', '#f00', '#00f', 'rgba(255,255,255,0.5)', 'rgba(255,255,255,0.5)',
  '#00f', '#00f', '#808080', '#808080', '#0f0', '#ff0', 'rgba(255,255,255,0.5)', 'rgba(255,255,255,0.5)',
];

/**
 * The same conversion on the GPU, where the browser offers WebGL2. Reading the
 * drawing canvas back every frame can make the browser move it to its CPU
 * rasterizer part-way through a film; copying it into a texture does not. One
 * pass writes the luma rows and then the chroma rows, four bytes to an RGBA
 * texel, and one readback fetches both planes. Returns
 * { convert(canvas) -> { data, layout }, dispose() }, or null where WebGL2 is
 * missing or differs from rgbaToNV12 on PROBE by more than one.
 */
function gpuNV12(env) {
  const gl = env.createCanvas(1, 1).getContext('webgl2', { antialias: false, depth: false, stencil: false, premultipliedAlpha: false });
  if (!gl || typeof gl.texImage2D !== 'function') return null;
  const dispose = () => { const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext(); };
  const f = (n) => n.toFixed(7);
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, '#version 300 es\nvoid main() { gl_Position = vec4(float(gl_VertexID & 1) * 4.0 - 1.0, float(gl_VertexID >> 1) * 4.0 - 1.0, 0.0, 1.0); }'],
    [gl.FRAGMENT_SHADER, `#version 300 es
precision highp float;
uniform highp sampler2D s;
uniform ivec2 size;
out vec4 o;
const vec3 K = vec3(${f(KR)}, ${f(KG)}, ${f(KB)});
${DITHER_GLSL}
vec3 at(int x, int y) { return texelFetch(s, ivec2(min(x, size.x - 1), min(y, size.y - 1)), 0).rgb; }
float luma(int x, int y) { return (16.0 + dither(x, y, 0u) + 219.0 * dot(at(x, y), K)) / 255.0; }
vec2 chroma(int x, int y) {
  vec3 c = (at(2 * x, 2 * y) + at(2 * x + 1, 2 * y) + at(2 * x, 2 * y + 1) + at(2 * x + 1, 2 * y + 1)) * 0.25;
  float l = dot(c, K);
  return (128.0 + vec2(dither(x, y, 1u), dither(x, y, 2u)) + 224.0 * vec2((c.b - l) / ${f(2 * (1 - KB))}, (c.r - l) / ${f(2 * (1 - KR))})) / 255.0;
}
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
  int x = q.x * 4;
  if (q.y < size.y) o = vec4(luma(x, q.y), luma(x + 1, q.y), luma(x + 2, q.y), luma(x + 3, q.y));
  else o = vec4(chroma(q.x * 2, q.y - size.y), chroma(q.x * 2 + 1, q.y - size.y));
}`],
  ]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { dispose(); return null; }
  gl.useProgram(program);
  const [source, target] = [gl.createTexture(), gl.createTexture()];
  gl.bindTexture(gl.TEXTURE_2D, source);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  const frame = gl.createFramebuffer();
  let shape = '';
  const convert = (canvas) => {
    const w = canvas.width, h = canvas.height;
    // A row of either plane is w bytes: w luma samples, or w / 2 chroma pairs.
    const tw = Math.ceil(w / 4), th = h * 1.5;
    if (shape !== w + 'x' + h) {
      gl.bindTexture(gl.TEXTURE_2D, target);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, tw, th, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, frame);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
      gl.viewport(0, 0, tw, th);
      gl.uniform2i(gl.getUniformLocation(program, 'size'), w, h);
      shape = w + 'x' + h;
    }
    gl.bindTexture(gl.TEXTURE_2D, source);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const data = new Uint8Array(tw * 4 * th);
    gl.readPixels(0, 0, tw, th, gl.RGBA, gl.UNSIGNED_BYTE, data);
    if (gl.isContextLost()) throw new Error('film: the GPU lost the colour conversion part-way through the film. Nothing was saved.');
    const stride = tw * 4;
    return { data, layout: [{ offset: 0, stride }, { offset: h * stride, stride }] };
  };
  // Trusted only once it reproduces the CPU conversion.
  const probe = probeImage(env);
  const want = rgbaToNV12(probe.pixels, 8, 4);
  const got = convert(probe.canvas);
  const at = (k) => { const p = got.layout[k < 32 ? 0 : 1], j = k & 31; return p.offset + (j >> 3) * p.stride + (j & 7); };
  if (want.some((value, k) => Math.abs(value - got.data[at(k)]) > 1)) { dispose(); return null; }
  return { convert, dispose };
}

/** PROBE on an 8 x 4 canvas kept in memory, and its pixels. */
function probeImage(env) {
  const probe = env.createCanvas(8, 4);
  const pg = probe.getContext('2d', { willReadFrequently: true });
  PROBE.forEach((css, i) => { pg.fillStyle = css; pg.fillRect(i % 8, i >> 3, 1, 1); });
  return { canvas: probe, pixels: pg.getImageData(0, 0, 8, 4).data };
}

/**
 * Where the browser draws the 2D context `g`: 'gpu' when a translucent pattern
 * comes out on it as on a default canvas and not as on one asked to be read
 * often, 'memory' the reverse, and null when those two agree, as without a
 * GPU, or `g` matches neither. Installed Edge draws the pattern's blends and
 * edges differently on the GPU and in memory, the same way every time. The
 * pattern is cleared from `g`, whose pixels, state and path are otherwise left
 * as they were.
 */
function rasterizer(env, g) {
  const s = Math.min(16, g.canvas.width, g.canvas.height);
  const read = (c) => {
    c.save();
    c.fillStyle = 'rgba(20, 180, 240, 0.61)'; c.fillRect(0, 0, s, s);
    c.fillStyle = 'rgba(200, 100, 50, 0.37)'; c.fillRect(0, 0, s / 2, s / 2);
    c.fillStyle = 'rgba(90, 30, 220, 0.45)'; c.beginPath(); c.arc(s * 0.52, s * 0.48, s * 0.4, 0, 2 * Math.PI); c.fill();
    const data = c.getImageData(0, 0, s, s).data;
    c.clearRect(0, 0, s, s);
    c.restore();
    c.beginPath();
    return data;
  };
  const same = (a, b) => a.every((v, i) => v === b[i]);
  const film = read(g);
  const gpu = read(env.createCanvas(s, s).getContext('2d'));
  const memory = read(env.createCanvas(s, s).getContext('2d', { willReadFrequently: true }));
  if (same(gpu, memory)) return null;
  return same(film, gpu) ? 'gpu' : same(film, memory) ? 'memory' : null;
}

// ---------------------------------------------------------------------------
// Frames the encoder converts itself
// ---------------------------------------------------------------------------
//
// An encoder handed a canvas converts it to video colour itself. In Edge a
// canvas the browser draws on the GPU comes out limited-range BT.709, within a
// level of rgbaToNV12, and one it keeps in memory comes out full range. The
// browser moves a canvas to memory by itself, for example once a piece reads
// its pixels back, and the range then changes part-way through the film. So
// the encoder is handed a WebGL2 copy of each drawn frame, which stays on the
// GPU whatever happens to the canvas it copies, and no frame is read back.
//
// It is trusted only as far as each export proves it. PROBE's colours, one
// cell each, go through the same copy and encoder before the first frame and
// after the last, and decoded, every cell must be rgbaToNV12's value within
// two levels. Every decoder configuration the encoder reports, as Edge's does
// again whenever its colour changes, must say limited-range BT.709. A film
// that fails either is encoded again, converted.

/**
 * A WebGL2 canvas that copy() fills with `source` over black. Returns
 * { canvas, copy(), dispose() }, or null without WebGL2.
 */
function glCopy(env, source) {
  const canvas = env.createCanvas(source.width, source.height);
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true });
  if (!gl || typeof gl.texImage2D !== 'function') return null;
  const dispose = () => { const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext(); };
  const program = gl.createProgram();
  for (const [type, text] of [
    [gl.VERTEX_SHADER, '#version 300 es\nvoid main() { gl_Position = vec4(float(gl_VertexID & 1) * 4.0 - 1.0, float(gl_VertexID >> 1) * 4.0 - 1.0, 0.0, 1.0); }'],
    [gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float;\nuniform highp sampler2D s;\nout vec4 o;\nvoid main() { o = texelFetch(s, ivec2(gl_FragCoord.xy), 0); }'],
  ]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, text);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { dispose(); return null; }
  gl.useProgram(program);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  // Premultiplied colour is the colour over black; the texture's first row is
  // the drawing's bottom, where the drawing buffer starts.
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.viewport(0, 0, canvas.width, canvas.height);
  return {
    canvas,
    copy() {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (gl.isContextLost()) throw new Error('film: the GPU lost the frame copy part-way through the film.');
    },
    dispose,
  };
}

/**
 * PROBE drawn over the whole frame, one cell per colour, eight across and four
 * down, leaving the canvas's drawing state as it found it for the piece.
 */
function drawProbe(g, w, h) {
  g.save();
  g.clearRect(0, 0, w, h);
  PROBE.forEach((css, k) => {
    const x = Math.round(((k % 8) * w) / 8), y = Math.round(((k >> 3) * h) / 4);
    g.fillStyle = css;
    g.fillRect(x, y, Math.round((((k % 8) + 1) * w) / 8) - x, Math.round((((k >> 3) + 1) * h) / 4) - y);
  });
  g.restore();
}

/**
 * A probe's chunk decoded in software, as [Y, U, V] at the centre of each of
 * PROBE's cells; null where the browser cannot decode it or hand over its
 * planes as I420.
 */
async function probeCells(env, config, description, chunk) {
  const { width: w, height: h } = config;
  let planes = null;
  let failure = null;
  const decoder = new env.VideoDecoder({
    output(frame) {
      if (frame.format !== 'I420') { frame.close(); return; }
      const buf = new Uint8Array(frame.allocationSize());
      planes = Promise.resolve(frame.copyTo(buf)).then((layout) => ({ buf, layout }), () => null).finally(() => frame.close());
    },
    error(e) { failure = e; },
  });
  try {
    decoder.configure({ codec: config.codec, description, hardwareAcceleration: 'prefer-software' });
    decoder.decode(new env.EncodedVideoChunk({ type: 'key', timestamp: chunk.timestamp, data: chunk.data }));
    await decoder.flush();
  } catch (e) {
    failure = e;
  } finally {
    if (decoder.state !== 'closed') decoder.close();
  }
  const got = !failure && planes && await planes;
  if (!got) return null;
  const { buf, layout: [y, u, v] } = got;
  return PROBE.map((_, k) => {
    const x = Math.round((((k % 8) + 0.5) * w) / 8) & ~1, r = Math.round((((k >> 3) + 0.5) * h) / 4) & ~1;
    return [buf[y.offset + r * y.stride + x], buf[u.offset + (r >> 1) * u.stride + (x >> 1)], buf[v.offset + (r >> 1) * v.stride + (x >> 1)]];
  });
}

/** What the encoder must write for each of PROBE's cells: rgbaToNV12 of a block of its colour. */
function probeWant(env) {
  const { pixels } = probeImage(env);
  return PROBE.map((_, k) => {
    const nv = rgbaToNV12(Uint8ClampedArray.from({ length: 16 }, (_, j) => pixels[4 * k + (j & 3)]), 2, 2);
    return [nv[0], nv[4], nv[5]];
  });
}

const limited709 = (space) => !!space && space.primaries === 'bt709' && space.matrix === 'bt709' && space.fullRange === false;
const UNLIMITED = 'the encoder reported a colour space other than limited-range BT.709';

// Edge 158's hardware encoder writes a canvas full range, black at luma 0 and
// white at 255, and ignores `bitrate`: a 1080p film of cues came out a fifth of
// the size of Edge 157's, 5 to 12 dB further from its drawing. A per-frame
// quantizer is the setting it obeys, and at 18 the film's size and quality
// return to Edge 157's. So a probe that decodes to that range sends the
// converted film through the quantizer.
const FULL_RANGE_QUANTIZER = 18;
const wroteFullRange = (cells) => cells[0][0] <= 2 && cells[2][0] >= 253;

// ---------------------------------------------------------------------------
// Loudness: ITU-R BS.1770-4
// ---------------------------------------------------------------------------

// A FILM IS AS LOUD AS WHAT PLAYS BESIDE IT, AND ITS PEAKS ARE LIMITED TO GET THERE.
// Platforms that play films turn a loud upload down to about -14 LUFS and
// barely raise a quiet one, so a film mixed quiet stays quiet beside everything
// else. Each soundtrack is measured as rendered and given one gain to -14 LUFS
// integrated. Where that gain would take its true peak past its codec's
// ceiling, a look-ahead limiter turns the peaks down to the ceiling, by
// `depth` dB at most, and the gain is raised until the limited soundtrack
// reaches the target: the export then changes the dynamics of a mix whose
// peaks stand far above its body, as a drum's or a voice's do. The limiter
// sees a peak coming and turns down over the `attack` seconds before it, then
// recovers with a time constant of `release` seconds. The ceiling is measured
// before encoding, and a codec moves the peak, most where limiting has put
// many peaks at the ceiling: in installed Edge, limited drums and speech-like
// bursts decoded 0.14 to 0.71 dB above it, AAC and Opus alike, and unlimited
// soundtracks -0.10 to +0.14 dB. So the ceiling is -2 dBTP for both, and the
// browser check holds a decoded soundtrack under the ceiling plus `rise` dB,
// the codec's rise rounded up from 0.71 dB. A soundtrack whose peaks
// would need more than `depth` dB of limiting stops short, and one that ends
// more than `short` LU under the target says how far.
// A SPARSE SOUNDTRACK KEEPS ITS ACCENTS. Where sound fills only part of the
// film, a crack or a lamp's click over a quiet bed, its loudness is the
// accents themselves, and limiting it to the target flattens each one into
// the bed: five of the site's ten seam films were cut 11 to 12 dB at their
// loudest accent. So the depth follows the share of 400 ms blocks that pass
// the loudness gates: `sparse.depth` dB at `sparse.from` or under, `depth` at
// `sparse.to` or over, and in a line between, so no seed jumps between them.
// Drums and speech-like bursts fill 99 to 100% of their blocks; the seams
// that needed deep limiting filled 60 to 76%. Silence counts as unfilled
// wherever it falls, a silent start or end too: the crack seam fills 90% of
// the blocks from its first sound to its last but 60% of the film, so leaving
// the ends out would cut it 10.6 dB again. Synthesized drums silent for a
// quarter of the film are therefore cut about 6.5 dB and end near -16 LUFS,
// within `short`; the drum fixture rendered in Edge ends near -17.6 to -17.9
// LUFS that way, and its report says `short`.
// WHERE THE LIMITER CUT, AND WHICH EVENTS STILL STAND OUT. One deepest cut
// says nothing of which beats lost level: the limiter's least gain is kept
// every `step` seconds, and each beat of the piece's beat sheet, or each
// 400 ms `block` where it has none, reports its own deepest cut. Each planned
// event is measured on the soundtrack as levelled: its loudest `window` of
// mean power in the `after` seconds from its time over the median of those
// windows in the `before` seconds ahead of it, the bed it lands on, ducked by
// the limiter. One under `buried` dB over that bed is buried, and two events
// closer than `close` seconds land as one.
const LOUDNESS = {
  target: -14, ceiling: { mp4a: -2, Opus: -2 }, rise: 1, short: 3, depth: 12, sparse: { depth: 6, from: 0.75, to: 0.95 }, attack: 0.005, release: 0.05,
  step: 0.01, block: 0.4, window: 0.01, before: 0.3, after: 0.05, buried: 6, close: 0.1,
};

/**
 * The two K-weighting stages for a sample rate, as { b: [b0, b1, b2], a: [a1,
 * a2] }: a high shelf of about +4 dB above 1.5 kHz, the head's effect, then a
 * high-pass near 38 Hz. BS.1770-4 tabulates them at 48 kHz; this is the
 * analogue design those numbers come from, so other rates get the same curve.
 */
function kWeighting(rate) {
  let K = Math.tan((Math.PI * 1681.974450955533) / rate);
  const Q1 = 0.7071752369554196;
  const Vh = 10 ** (3.999843853973347 / 20);
  const Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q1 + K * K;
  const shelf = {
    b: [(Vh + (Vb * K) / Q1 + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q1 + K * K) / a0],
    a: [(2 * (K * K - 1)) / a0, (1 - K / Q1 + K * K) / a0],
  };
  K = Math.tan((Math.PI * 38.13547087602444) / rate);
  const Q2 = 0.5003270373238773;
  a0 = 1 + K / Q2 + K * K;
  const pass = { b: [1, -2, 1], a: [(2 * (K * K - 1)) / a0, (1 - K / Q2 + K * K) / a0] };
  return [shelf, pass];
}

/**
 * Integrated loudness in LUFS of planar mono or stereo channels, each weighted
 * 1: the mean square of the K-weighted signal over 400 ms blocks that overlap
 * by 75%, gated at -70 LUFS and then 10 LU below the mean of the blocks that
 * passed, where every mean is of power, not of decibels. -Infinity when no
 * block passes, which is silence as far as loudness goes. Given `gate`, it
 * sets gate.share, the share of all blocks, silent ones too, that passed
 * both gates.
 */
function integratedLoudness(channels, rate, gate) {
  if (channels.length < 1 || channels.length > 2) throw new Error(`film: loudness is measured on mono or stereo, not ${channels.length} channels`);
  const step = Math.round(rate / 10);
  const segments = Math.floor(channels[0].length / step);
  // The squared K-weighted signal, summed over channels, per 100 ms segment.
  const power = new Float64Array(segments);
  const [{ b: [p0, p1, p2], a: [q1, q2] }, { b: [r0, r1, r2], a: [s1, s2] }] = kWeighting(rate);
  for (const x of channels) {
    let u1 = 0, u2 = 0, v1 = 0, v2 = 0;   // transposed direct form II, one pair per stage
    for (let k = 0, i = 0; k < segments; k++) {
      let sum = 0;
      for (const end = i + step; i < end; i++) {
        const y = p0 * x[i] + u1;
        u1 = p1 * x[i] - q1 * y + u2;
        u2 = p2 * x[i] - q2 * y;
        const z = r0 * y + v1;
        v1 = r1 * y - s1 * z + v2;
        v2 = r2 * y - s2 * z;
        sum += z * z;
      }
      power[k] += sum;
    }
  }
  const blocks = [];
  for (let j = 0; j + 4 <= segments; j++) blocks.push((power[j] + power[j + 1] + power[j + 2] + power[j + 3]) / (4 * step));
  const lufs = (z) => -0.691 + 10 * Math.log10(z);
  const mean = (zs) => zs.reduce((s, z) => s + z, 0) / zs.length;
  const heard = blocks.filter((z) => lufs(z) > -70);
  if (gate) gate.share = 0;
  if (!heard.length) return -Infinity;
  const floor = lufs(mean(heard)) - 10;
  const passed = heard.filter((z) => lufs(z) > floor);
  if (gate) gate.share = passed.length / blocks.length;
  return lufs(mean(passed));
}

// BS.1770-4 Annex 2: the 48-tap interpolation filter for four-times
// oversampling. Output phase p of each input sample uses taps p, p + 4, ...
const OVERSAMPLE = [
  0.0017089843750, -0.0291748046875, -0.0189208984375, -0.0083007812500,
  0.0109863281250, 0.0292968750000, 0.0330810546875, 0.0148925781250,
  -0.0196533203125, -0.0517578125000, -0.0582275390625, -0.0266113281250,
  0.0332031250000, 0.0891113281250, 0.1015625000000, 0.0476074218750,
  -0.0594482421875, -0.1665039062500, -0.2003173828125, -0.1022949218750,
  0.1373291015625, 0.4650878906250, 0.7797851562500, 0.9721679687500,
  0.9721679687500, 0.7797851562500, 0.4650878906250, 0.1373291015625,
  -0.1022949218750, -0.2003173828125, -0.1665039062500, -0.0594482421875,
  0.0476074218750, 0.1015625000000, 0.0891113281250, 0.0332031250000,
  -0.0266113281250, -0.0582275390625, -0.0517578125000, -0.0196533203125,
  0.0148925781250, 0.0330810546875, 0.0292968750000, 0.0109863281250,
  -0.0083007812500, -0.0189208984375, -0.0291748046875, 0.0017089843750,
];

/**
 * The true-peak envelope of planar channels: at j, the largest magnitude over
 * every channel of the four phases oversampled from samples j - 11 to j, so it
 * runs 11 past the last sample while the filter rings out. It is written into
 * `envelope` from its start, and each channel is copied into `padded` between
 * 11 zeros on either side; both may be longer than that and are reused.
 */
function peakEnvelope(channels, envelope, padded) {
  const n = channels[0].length;
  envelope.fill(0, 0, n + 11);
  padded.fill(0, 0, 11);
  for (const x of channels) {
    padded.set(x, 11);
    padded.fill(0, n + 11, n + 22);
    for (let i = 11; i < n + 22; i++) {
      let peak = envelope[i - 11];
      for (let p = 0; p < 4; p++) {
        let y = 0;
        for (let m = 0; m < 12; m++) y += OVERSAMPLE[p + 4 * m] * padded[i - m];
        peak = Math.max(peak, Math.abs(y));
      }
      envelope[i - 11] = peak;
    }
  }
  return envelope;
}

/**
 * The peakEnvelope of planar channels 65536 points at a time: `each(part, a)`
 * is given the points from a on, each worked out from the samples it reaches
 * back to, so every point is the one peakEnvelope gives the whole, and a long
 * soundtrack needs no envelope or padded copy of its own length.
 */
function peakBlocks(channels, each) {
  const n = channels[0].length, block = 65536;
  const envelope = new Float64Array(block + 22), padded = new Float64Array(block + 33);
  for (let a = 0; a < n + 11; a += block) {
    const from = Math.max(0, a - 11), end = Math.min(n + 11, a + block);
    peakEnvelope(channels.map((x) => x.subarray(from, Math.min(n, end))), envelope, padded);
    each(envelope.subarray(a - from, end - from), a);
  }
}

/**
 * True peak in dBTP: the largest magnitude of the signal oversampled four
 * times, which finds the peaks that fall between samples, where a decoder's
 * reconstruction and a lossy encoder overshoot the sample peak. NaN or
 * Infinity when a sample is not a finite number.
 */
function truePeak(channels) {
  let top = 0;
  peakBlocks(channels, (part) => { for (const v of part) top = Math.max(top, v); });
  return 20 * Math.log10(top);
}

/**
 * Planar `channels` times `scale`, limited into `out` so that they stay under
 * the linear `ceiling`, given their peakEnvelope `envelope`; returns the least
 * gain the limiter gave a sample. Every envelope point that would pass the
 * ceiling is brought down to it on all twelve samples it was interpolated
 * from: the gain falls linearly over the attack before them, as the mean of
 * the least need over a window, and recovers exponentially over the release
 * after. The same channels, scale and rate give the same bits. `least`, as
 * long as a channel, is written over, so the tries at several scales share it,
 * and so is `deep`, given one entry per LOUDNESS.step seconds: the least gain
 * in each.
 */
function limit(envelope, channels, scale, ceiling, rate, out, least, deep) {
  const n = channels[0].length, attack = Math.max(1, Math.round(LOUDNESS.attack * rate)), span = attack + 12;
  // least[q], the least need from q to q + span - 1, by a sliding minimum over
  // a ring of the points still in the window and their needs, each need worked
  // out as its point enters; past the envelope's end nothing is needed.
  const size = span + 1, queue = new Int32Array(size), needs = new Float64Array(size);
  for (let j = 0, head = 0, tail = 0; j < n + span - 1; j++) {
    const need = j < envelope.length ? Math.min(1, ceiling / (scale * envelope[j])) : 1;
    while (tail > head && needs[(tail - 1) % size] >= need) tail--;
    queue[tail % size] = j;
    needs[tail++ % size] = need;
    const q = j - span + 1;
    if (q < 0) continue;
    while (queue[head % size] < q) head++;
    least[q] = needs[head % size];
  }
  // The mean of least over the attack ending at each sample is under the need
  // of every envelope point within span of it; the release only lowers it.
  // Before the first sample the window holds least[0], so a peak there is met.
  const back = Math.exp(-1 / (LOUDNESS.release * rate));
  let deepest = 1;
  const hop = LOUDNESS.step * rate;
  deep.fill(1);
  for (let k = 0, sum = attack * least[0], g = 1; k < n; k++) {
    sum += least[k] - least[Math.max(0, k - attack)];
    g = Math.min(sum / attack, 1 - (1 - g) * back);
    for (let c = 0; c < channels.length; c++) out[c][k] = channels[c][k] * scale * g;
    deepest = Math.min(deepest, g);
    const s = Math.floor(k / hop);
    if (g < deep[s]) deep[s] = g;
  }
  return deepest;
}

/** Integrated loudness (LUFS) and true peak (dBTP) of an AudioBuffer-shaped soundtrack. */
function measureLoudness(buffer) {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  return { lufs: integratedLoudness(channels, buffer.sampleRate), dbtp: truePeak(channels) };
}

const round2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

/**
 * How far each event at `times` (seconds, ascending) stands over the bed it
 * lands on in planar `channels` at `rate`, as LOUDNESS says: { events: [{ at,
 * prominence }], buried, close }, `prominence` in dB, null for an event with
 * no bed before it, at the first sample; `buried` counts the events under
 * LOUDNESS.buried dB, `close` those under LOUDNESS.close seconds after the one
 * before. Times outside the soundtrack are left out.
 */
function eventProminence(channels, rate, times) {
  const n = channels[0].length, w = Math.max(1, Math.round(LOUDNESS.window * rate)), ms = Math.max(1, Math.round(rate / 1000));
  // Mean power over the channels in [a, a + w), cut at the end, in dB over a -100 dB floor.
  const db = (a) => {
    let sum = 0;
    const b = Math.min(n, a + w);
    for (const x of channels) for (let i = a; i < b; i++) sum += x[i] * x[i];
    return 10 * Math.log10(Math.max(1e-10, sum / channels.length / Math.max(1, b - a)));
  };
  const kept = times.filter((t) => t >= 0 && t * rate < n);
  const events = kept.map((t) => {
    const i = Math.round(t * rate), beds = [];
    for (let a = i - w; a >= Math.max(0, i - Math.round(LOUDNESS.before * rate)); a -= w) beds.push(db(a));
    let top = -Infinity;
    for (let a = i; a <= Math.min(n - 1, i + Math.round(LOUDNESS.after * rate) - w); a += ms) top = Math.max(top, db(a));
    if (top === -Infinity) top = db(i);
    beds.sort((x, y) => x - y);
    const m = beds.length >> 1, bed = beds.length % 2 ? beds[m] : (beds[m - 1] + beds[m]) / 2;
    return { at: Math.round(t * 1000) / 1000, prominence: beds.length ? round2(top - bed) : null };
  });
  return {
    events,
    buried: events.filter((e) => e.prominence !== null && e.prominence < LOUDNESS.buried).length,
    close: kept.filter((t, k) => k && t - kept[k - 1] < LOUDNESS.close).length,
  };
}

/**
 * The beat starts and planned events in a built `state`, in seconds at `hz`,
 * each ascending: the frames of `state.cues.beats` and of `state.cues.sounds`,
 * the film scaffold's beat sheet and sound rows. Empty where a piece keeps none.
 */
function soundMarks(state, hz) {
  const cues = state && state.cues;
  const at = (rows) => (Array.isArray(rows) ? rows.filter((r) => r && Number.isFinite(r.frame) && r.frame >= 0).map((r) => r.frame / hz).sort((a, b) => a - b) : []);
  return { beats: at(cues && cues.beats), events: at(cues && cues.sounds) };
}

/**
 * Bring a rendered soundtrack to LOUDNESS in place, for encoding in `codec`,
 * the sample entry it is encoded in: 'mp4a', AAC, or 'Opus', each with a
 * ceiling of -2 dBTP. A soundtrack whose peaks leave room gets one static
 * gain to -14 LUFS. One whose peaks would pass the ceiling first is limited:
 * its gain is found by the secant method, within 0.005 LU of the target in at
 * most eight tries, through limit, then trimmed so its true peak meets
 * the ceiling; by LOUDNESS.depth dB of limiting at most, or less for a sparse
 * soundtrack, where it stops short.
 * Says what was measured and done: `measured` as rendered, the `gain` in dB,
 * `limited`, the deepest the limiter turned it down in dB, only when it did,
 * the `lufs` and `dbtp` it is encoded at, and `short`, how many LU it ends
 * under the target, where that is more than LOUDNESS.short. With `limited`,
 * `beats`, each of `marks.beats` (start seconds, ascending) with its span
 * { from, to } and its own deepest cut `limited`, or `blocks`, the same for
 * every LOUDNESS.block seconds from 0 where `marks.beats` is empty; and given
 * `marks.events`, eventProminence's { events, buried, close } on the
 * soundtrack as levelled. A soundtrack with
 * no block above the -70 LUFS gate has no loudness to set and keeps its level,
 * reported as null. A sample that is not a finite number, which no player can
 * play, is refused. The same soundtrack and codec come out the same bits, so
 * replay levels its render as the export did.
 */
function normalizeLoudness(buffer, codec, marks = { beats: [], events: [] }) {
  const ceiling = LOUDNESS.ceiling[codec];
  if (typeof ceiling !== 'number') throw new Error(`film: a soundtrack is levelled for AAC ('mp4a') or 'Opus', not ${JSON.stringify(codec)}`);
  // Checked before measuring: an infinite sample becomes NaN in the K-weighting
  // filter, which the -70 LUFS gate drops, so the meter alone would pass it.
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    if (!buffer.getChannelData(c).every(Number.isFinite)) {
      throw new Error('film: the soundtrack holds samples that are not finite numbers, so it cannot be measured or played. Nothing was saved.');
    }
  }
  const gate = {}, channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const measured = { lufs: integratedLoudness(channels, buffer.sampleRate, gate), dbtp: truePeak(channels) };
  if (measured.lufs === -Infinity) return { measured: { lufs: null, dbtp: round2(measured.dbtp) }, gain: 0, lufs: null, dbtp: round2(measured.dbtp) };
  const want = LOUDNESS.target - measured.lufs, room = ceiling - measured.dbtp;
  let gain = Math.min(want, room), limited = 0, cuts = null;
  if (want > room) {
    const n = channels[0].length, rate = buffer.sampleRate, envelope = new Float64Array(n + 11), line = 10 ** (ceiling / 20);
    peakBlocks(channels, (part, a) => envelope.set(part, a));
    // Made once for every try: the envelope, out, the limiter's least need and its least gain per step.
    const out = channels.map((x) => new Float32Array(x.length)), least = new Float64Array(n), deep = new Float64Array(Math.ceil(n / (LOUDNESS.step * rate)) + 1);
    // The loudness at `g` dB through the limiter, left in `out` with its depth in `limited`.
    let trim = 1;
    const level = (g) => {
      const deepest = limit(envelope, channels, 10 ** (g / 20), line, rate, out, least, deep);
      trim = 10 ** (Math.min(0, ceiling - truePeak(out)) / 20);
      if (trim < 1) for (const y of out) for (let i = 0; i < n; i++) y[i] *= trim;
      limited = -20 * Math.log10(trim * deepest);
      return integratedLoudness(out, rate);
    };
    const { depth, from, to } = LOUDNESS.sparse;
    const cap = room + depth + (LOUDNESS.depth - depth) * Math.min(1, Math.max(0, (gate.share - from) / (to - from)));
    let [g0, l0] = [room, measured.lufs + room];
    gain = Math.min(want, cap);
    let l1 = level(gain);
    for (let k = 0; k < 8; k++) {
      const miss = LOUDNESS.target - l1;
      if (Math.abs(miss) <= 0.005 || (gain === cap && miss > 0) || l1 === l0) break;
      const g = Math.min(cap, Math.max(room, gain + (miss * (gain - g0)) / (l1 - l0)));
      [g0, l0] = [gain, l1];
      gain = g;
      l1 = level(gain);
    }
    channels.forEach((x, c) => x.set(out[c]));
    // Each beat's deepest cut, from its start to the next beat's or the end, or each block's.
    const seconds = n / rate, starts = marks.beats.length ? marks.beats : Array.from({ length: Math.ceil(seconds / LOUDNESS.block) }, (_, k) => k * LOUDNESS.block);
    cuts = starts.filter((t) => t < seconds).map((t, k, all) => {
      const end = k + 1 < all.length ? all[k + 1] : seconds;
      let g = 1;
      for (let s = Math.floor(t / LOUDNESS.step + 1e-9); s < Math.ceil(end / LOUDNESS.step - 1e-9); s++) g = Math.min(g, deep[s]);
      return { from: Math.round(t * 1000) / 1000, to: Math.round(end * 1000) / 1000, limited: round2(Math.max(0, -20 * Math.log10(trim * g))) };
    });
  } else {
    const scale = 10 ** (gain / 20);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const x = buffer.getChannelData(c);
      for (let i = 0; i < x.length; i++) x[i] *= scale;
    }
  }
  const result = measureLoudness(buffer);
  const short = LOUDNESS.target - result.lufs;
  return {
    measured: { lufs: round2(measured.lufs), dbtp: round2(measured.dbtp) },
    gain: round2(gain), ...(limited > 0 && { limited: round2(limited) }), lufs: round2(result.lufs), dbtp: round2(result.dbtp),
    ...(short > LOUDNESS.short && { short: round2(short) }),
    ...(limited > 0 && cuts && { [marks.beats.length ? 'beats' : 'blocks']: cuts }),
    ...(marks.events.length && eventProminence(channels, buffer.sampleRate, marks.events)),
  };
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

// H.264 levels as [level_idc, max macroblocks per second, max frame size in
// macroblocks, max bitrate in kbit/s for Main]; High allows 1.25 times that
// bitrate. The lowest level that fits is declared, because an old hardware
// decoder can refuse a film that claims more than it needs.
const LEVELS = [
  [31, 108000, 3600, 14000], [32, 216000, 5120, 20000], [40, 245760, 8192, 20000], [42, 522240, 8704, 50000],
  [50, 589824, 22080, 135000], [51, 983040, 36864, 240000], [52, 2073600, 36864, 240000],
  [60, 4177920, 139264, 240000], [61, 8355840, 139264, 480000], [62, 16711680, 139264, 800000],
];

/**
 * Codec strings to try for a size, rate and bitrate in bit/s, lowest fitting
 * level first, High profile before Main. Without a bitrate, any fits.
 */
function avcCodecs(width, height, hz, bitrate = 0) {
  const mw = Math.ceil(width / 16);
  const mh = Math.ceil(height / 16);
  const out = [];
  for (const [level, rate, size, kbps] of LEVELS) {
    const side = Math.sqrt(8 * size);
    if (mw * mh > size || mw * mh * hz > rate || mw > side || mh > side) continue;
    const hex = level.toString(16).padStart(2, '0');
    if (bitrate <= 1250 * kbps) out.push('avc1.6400' + hex);
    if (bitrate <= 1000 * kbps) out.push('avc1.4d00' + hex);
  }
  return out;
}

const even = (v) => Math.max(2, 2 * Math.round(v / 2));

// The long edge the page draws a film at unless its caller names a scale.
const LONG_EDGE = 1920;

/** The scale that brings the piece's long edge to LONG_EDGE, and never below 1. */
function filmScale(piece) {
  return Math.max(1, LONG_EDGE / Math.max(piece.size.w, piece.size.h));
}

// Bits per pixel per frame for the default bitrate: the least that kept a
// boiling hatch over replay's 30 dB floor, and most of a film grain's fine
// detail, in installed Edge; see docs/knowledge/output-formats.md.
const BITS_PER_PIXEL = 0.45;

/**
 * The H.264 configuration a film of this piece is encoded with at `opt.scale`
 * (default 1): the lowest fitting level `VideoEncoder` accepts, High profile
 * before Main, or null when it accepts none. `opt.bitrate` replaces the
 * bitrate derived from the frame size and rate. The export and any caller
 * asking whether a film can be encoded share this one choice.
 */
async function filmConfig(piece, VideoEncoder, opt = {}) {
  const scale = opt.scale === undefined ? 1 : opt.scale;
  const hz = piece.time.hz;
  const width = even(piece.size.w * scale);
  const height = even(piece.size.h * scale);
  const bitrate = opt.bitrate || Math.min(80e6, Math.max(2e6, Math.round(BITS_PER_PIXEL * width * height * hz)));
  for (const codec of avcCodecs(width, height, hz, bitrate)) {
    const candidate = { codec, width, height, bitrate, bitrateMode: 'variable', framerate: hz, avc: { format: 'avc' }, latencyMode: 'quality' };
    const support = await VideoEncoder.isConfigSupported(candidate);
    if (support && support.supported) return candidate;
  }
  return null;
}

/**
 * What a film export says to a piece with no timeline, the one text behind the
 * WebM and MP4 exports and exportFilm. It offers SVG only where the piece
 * declares the vector output, as the page's SVG button does: a piece that
 * draws pixels has no SVG to export instead.
 */
function stillFilmRefusal(piece) {
  const svg = !!piece && Array.isArray(piece.outputs) && piece.outputs.includes('vector');
  return 'this piece is a still: it declares no timeline, so it has no film. Export PNG' + (svg ? ' or SVG' : '')
    + ', or give the piece a time field to make it a film.';
}

// How long the encoder's queue may stand still before the export gives up.
const STALL_MS = 30000;
// How long a CPU-route film waits after its last frame for a lost GPU to say
// so. In installed Edge 154, a canvas blanked by a GPU process crash had fired
// contextlost within 50 ms of the crash; this is twice that.
const LOSS_MS = 100;

function copyBytes(source) {
  return source instanceof ArrayBuffer ? new Uint8Array(source.slice(0)) : new Uint8Array(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));
}

// The soundtrack every film is rendered and encoded at.
const SOUND = { sampleRate: 48000, channels: 2, bitrate: 192000 };

/**
 * The soundtrack configuration a film is encoded with: AAC where `AudioEncoder`
 * accepts it, because more MP4 players play it, else Opus, or null when it
 * accepts neither. `opt.sampleRate`, `opt.channels` and `opt.bitrate` default to
 * the ones exportFilm renders and encodes at. The export and any caller asking
 * whether a soundtrack can be encoded share this one choice.
 */
async function soundConfig(AudioEncoder, opt = {}) {
  const sampleRate = opt.sampleRate || SOUND.sampleRate;
  const numberOfChannels = opt.channels || SOUND.channels;
  const bitrate = opt.bitrate || SOUND.bitrate;
  for (const codec of ['mp4a.40.2', 'opus']) {
    const candidate = { codec, sampleRate, numberOfChannels, bitrate };
    const support = await AudioEncoder.isConfigSupported(candidate);
    if (support && support.supported) return candidate;
  }
  return null;
}

// An AAC stream cannot rebuild the first half of its first frame, and Edge's
// encoder starts the soundtrack in that frame and reports no priming, so its
// first ~500 decoded samples carry none of the soundtrack. So this much silence,
// the conventional AAC priming, goes in ahead of the soundtrack, and the edit
// list skips it. It is no whole number of 1024-sample packets: an edit that
// starts on a packet boundary makes Edge's video element start that packet
// without the one before it, and the loss comes back.
const AAC_LEAD = 2112;

// Opus is the fallback where the encoder refuses AAC: a piece with sound gets
// its soundtrack or no film at all. `config` is soundConfig's choice for the
// buffer's rate and channels.
async function encodeSound(env, buffer, config) {
  const rate = buffer.sampleRate;
  const channels = buffer.numberOfChannels;
  const bitrate = config.bitrate;
  // Opus primes itself and says how much, in its pre-skip.
  const lead = config.codec === 'opus' ? 0 : AAC_LEAD;
  const samples = [];
  let description = null;
  let failure = null;
  let first = null;
  const encoder = new env.AudioEncoder({
    output(chunk, meta) {
      if (first === null) first = chunk.timestamp;
      if (meta && meta.decoderConfig && meta.decoderConfig.description) description = copyBytes(meta.decoderConfig.description);
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      samples.push(data);
    },
    error(e) { failure = e; },
  });
  encoder.configure(config);
  // An encoder that has failed refuses its frames and rejects its flush with
  // errors of their own; the failure it reported is what fails the soundtrack.
  try {
    if (lead) {
      const silence = new env.AudioData({
        format: 'f32-planar', sampleRate: rate, numberOfFrames: lead, numberOfChannels: channels, timestamp: 0, data: new Float32Array(lead * channels),
      });
      try { encoder.encode(silence); } finally { silence.close(); }
    }
    const planes = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
    for (let at = 0; at < buffer.length; at += 4800) {
      const n = Math.min(4800, buffer.length - at);
      const data = new Float32Array(n * channels);
      planes.forEach((plane, c) => data.set(plane.subarray(at, at + n), c * n));
      const chunk = new env.AudioData({
        format: 'f32-planar', sampleRate: rate, numberOfFrames: n, numberOfChannels: channels,
        timestamp: Math.round(((lead + at) * 1e6) / rate), data,
      });
      try { encoder.encode(chunk); } finally { chunk.close(); }
    }
    await encoder.flush();
  } catch (e) {
    if (!failure) { if (encoder.state !== 'closed') encoder.close(); throw e; }
  }
  if (encoder.state !== 'closed') encoder.close();
  // Only a failure the encoder reported is worth a fresh encoder, so it is
  // returned for the export to try once more; anything else fails it here.
  if (failure) return { failed: failure };
  if (config.codec === 'opus') {
    // Only the OpusHead knows the pre-skip, and a guessed one moves the sound
    // against the pictures. Refused here, which fails the export.
    if (!description) throw new Error('film: the Opus encoder gave no OpusHead, so the film cannot say where its sound starts');
    // OpusHead holds the pre-skip little-endian at byte 10.
    return { codec: 'opus', head: description, samples, priming: description[10] | (description[11] << 8) };
  }
  // An AAC encoder that primes its first packet with samples from before its
  // input says so by stamping that packet before zero, and the edit list skips
  // those as well as the lead. Edge's encoder stamps its first packet at zero.
  return { samples, asc: description || aacConfig(rate, channels), sampleRate: rate, channels, bitrate, priming: lead + Math.max(0, Math.round((-first * rate) / 1e6)) };
}

/**
 * Draw every frame of a validated, solved piece and encode it as MP4.
 *
 * `env` supplies VideoEncoder and VideoFrame, and for a piece with sound
 * AudioEncoder, AudioData and OfflineAudioContext; VideoDecoder and
 * EncodedVideoChunk, which let the encoder convert frames itself where its
 * probes prove it; `createCanvas(w, h)`, a
 * clock `now()` for the report and the stall deadline, and `pause()`, which
 * yields to the event loop while the encoder drains. `opt`: `scale`, `bitrate`, `audioBitrate`,
 * `keySeconds` and `onProgress(done, total, restart)`, where `restart` is null
 * until a pass that reported frames is dropped and the film drawn again from
 * its first frame, and then says why.
 *
 * Resolves to { bytes, report }; the report is read from the finished file,
 * replay manifest included, and names the colour conversion that ran,
 * `encoder`, `gpu` or `cpu`; `quantizer` is the H.264 quantizer every frame was
 * encoded at because a probe decoded to full range, and null otherwise, when
 * `bitrate` governs the film; `rasterizer` says where the browser drew the CPU
 * route's film, `gpu` or `memory`, and is null where a test pattern cannot tell,
 * as without a GPU, and for every other pass; `rasterizerBeforeRedraw` is,
 * when a pass in memory made the film, what `rasterizer` read on the CPU
 * route's pass it replaced, and null otherwise; `contextLost` says the CPU route's canvas lost
 * its GPU and the film was drawn again in memory, and `encoderError`, when not
 * null, names each encoder that failed once and its error: `encoder route: ...`
 * when the encoder route was dropped after it drew frames of the film, because
 * its video encoder failed, it returned frames short, it reported a colour
 * space other than limited-range BT.709, its last test pattern did not come
 * back as drawn or it threw, and the film was drawn again converted,
 * `encoder probe: ...` when the video encoder failed on the encoder route's
 * first probe, before any frame of the film, which was then drawn once converted,
 * `video: ...` when the film was drawn again in memory on a
 * fresh encoder, `sound: ...` when the soundtrack was encoded again on a fresh
 * one, only ever after an error the audio encoder reported. `convertMs` includes, on
 * the GPU and CPU routes, waiting for the browser to finish drawing each
 * frame, and on the encoder route its probes. `soundMs` is the soundtrack's own time, which runs
 * alongside the frames, and `encodeWaitMs` includes each frame's yield to it.
 * `flashes` counts the flashes in the finished frames (core/flash.js), and
 * `flashMs` is the time the frames spent on it: shrinking each, and waiting
 * for the count at the end, which runs alongside the export where the browser
 * has workers and includes waiting for the browser to finish drawing where not.
 */
async function exportFilm(piece, solved, env, opt = {}) {
  if (!piece.time) throw new Error('film: ' + stillFilmRefusal(piece));
  for (const api of ['VideoEncoder', 'VideoFrame']) {
    if (typeof env[api] !== 'function') throw new Error(`film: this browser has no ${api}, which a frame-exact film needs`);
  }
  if (piece.sound && (typeof env.AudioEncoder !== 'function' || typeof env.AudioData !== 'function')) {
    throw new Error('film: the piece declares sound and this browser has no AudioEncoder, and a film without its soundtrack is not written');
  }
  const now = env.now || Date.now;
  const pause = env.pause || ((ms = 0) => new Promise((r) => setTimeout(r, ms)));
  const heads = playheads(piece);
  const hz = piece.time.hz;
  const scale = opt.scale === undefined ? 1 : opt.scale;
  if (!Number.isFinite(scale) || scale <= 0) throw new Error(`film: scale must be a positive finite number, got ${scale}`);
  if (opt.bitrate !== undefined && !(Number.isSafeInteger(opt.bitrate) && opt.bitrate > 0)) {
    throw new Error(`film: bitrate must be a whole number of bits per second above zero, got ${opt.bitrate}`);
  }
  const shutter = opt.shutter;
  if (shutter !== undefined && !(Number.isInteger(shutter) && shutter >= 2 && shutter <= 16)) {
    throw new Error(`film: shutter must be a whole number of sub-frames from 2 to 16, got ${shutter}`);
  }
  const started = now();

  const config = await filmConfig(piece, env.VideoEncoder, { scale, bitrate: opt.bitrate });
  if (!config) {
    throw new Error(`film: no H.264 encoder here accepts ${even(piece.size.w * scale)} x ${even(piece.size.h * scale)} at ${hz} Hz`
      + (opt.bitrate ? ` and ${opt.bitrate} bit/s; export at a smaller scale or bitrate` : '; export at a smaller scale'));
  }
  const { width, height, bitrate } = config;

  // A browser that encodes neither soundtrack codec is refused before any
  // frame is drawn. The soundtrack itself is rendered, levelled and encoded
  // alongside the frames and joined before the file is written: its rendering
  // and encoding run off this thread, so the frames need not wait for them. A
  // soundtrack that fails stops the frames at the next one and fails the export
  // with its own message, so a long export does not run on after its sound is
  // lost.
  const soundCodec = piece.sound ? await soundConfig(env.AudioEncoder, { bitrate: opt.audioBitrate }) : null;
  if (piece.sound && !soundCodec) throw new Error('film: this browser encodes neither AAC nor Opus, and a film without its soundtrack is not written');
  let soundMs = 0;
  let soundFailure = null;
  // Each encoder error the export recovered from, by the encoder that failed.
  const restarts = [];
  // Why the frames are being drawn again from the first, once a pass that
  // reported progress was dropped; handed to onProgress with every frame after.
  let restart = null;
  let reported = false;
  // Where the watched pass found its canvas drawn, kept when a pass in memory
  // replaces it, which is not tested.
  let watchedOn = null;
  // Set once a probe decodes to full range; the passes after it encode so.
  let fullRange = false;
  let encoding = config;
  let quantizer = null;
  let soundPending = !!piece.sound;
  const soundtrack = piece.sound ? (async () => {
    const s0 = now();
    const buffer = await renderSound(piece, solved, { OfflineAudioContext: env.OfflineAudioContext, sampleRate: SOUND.sampleRate, channels: SOUND.channels });
    const level = normalizeLoudness(buffer, soundCodec.codec === 'opus' ? 'Opus' : 'mp4a', soundMarks(solved.state, hz));
    // A GPU process crash can kill the audio encoder too: the same soundtrack
    // is encoded once more on a fresh one.
    let sound = await encodeSound(env, buffer, soundCodec);
    if (sound.failed) {
      restarts.push('sound: ' + sound.failed);
      sound = await encodeSound(env, buffer, soundCodec);
      if (sound.failed) throw sound.failed;
    }
    soundMs = now() - s0;
    return { sound, level };
  })() : Promise.resolve({ sound: null, level: null });
  soundtrack.then(() => { soundPending = false; }, (e) => { soundPending = false; soundFailure = e; });

  const gop = Math.max(1, Math.round(hz * (opt.keySeconds || 2)));
  const stamp = (i) => Math.round((i * 1e6) / hz);

  // Every frame drawn and encoded once, handed over as `route` says: 'encoder'
  // through glCopy with a probe before and after, 'gpu' through gpuNV12, 'cpu'
  // through rgbaToNV12, on a canvas kept in memory with `memory`. Resolves to
  // the film's chunks and avcC, with this pass's own drawing, conversion and
  // encode-wait times, null when the encoder route is not proven for this
  // export, { dropped } saying why when it is dropped part-way, { lost: true }
  // when the CPU route's canvas lost its GPU, or { failed } with the error the
  // encoder reported. `from` is the solve drawn.
  async function pass(route, gpu, memory, from = solved) {
    let drawMs = 0;
    let convertMs = 0;
    let waitMs = 0;
    let flashMs = 0;
    const canvas = env.createCanvas(width, height);
    // Without WebGL2 the canvas is read back every frame, so it is kept where it
    // is drawn from the first: a browser that moved it part-way would change how
    // the rest of the film is drawn. Asked to be read often, Edge draws it in
    // memory, unless a canvas of its own GPU is drawn into it: then it draws the
    // whole film on the GPU and reads each frame back, three times faster for
    // cues with its finish. A cleared canvas of one pixel is that canvas, drawn
    // before the first frame; a browser with no GPU draws it in memory as before.
    const g = route === 'cpu' ? canvas.getContext('2d', { willReadFrequently: true }) : canvas.getContext('2d');
    // A GPU process that crashes or resets loses a canvas drawn on the GPU: in
    // installed Edge it reads back transparent, with no error, and fires
    // contextlost only after the first blank frame. That pass is dropped, and
    // the film drawn again on a canvas kept in memory, which no GPU can lose.
    const watched = route === 'cpu' && !memory;
    let lost = false;
    const onLost = () => { lost = true; };
    const gone = () => watched && (lost || (typeof g.isContextLost === 'function' && g.isContextLost()));
    // Whether that drawing moved the canvas to the GPU, which the report names.
    let drawnOn = null;
    if (watched) {
      const one = env.createCanvas(1, 1);
      one.getContext('2d').clearRect(0, 0, 1, 1);
      g.drawImage(one, 0, 0);
      drawnOn = rasterizer(env, g);
      watchedOn = drawnOn;
      if (canvas.addEventListener) canvas.addEventListener('contextlost', onLost);
    }
    const copy = route === 'encoder' ? glCopy(env, canvas) : null;
    if (route === 'encoder' && !copy) return null;
    const chunks = [];
    const spaces = [];
    let avcC = null;
    let failure = null;
    const encoder = new env.VideoEncoder({
      output(chunk, meta) {
        const cfg = meta && meta.decoderConfig;
        if (cfg && cfg.description) avcC = copyBytes(cfg.description);
        if (cfg) spaces.push(cfg.colorSpace || null);
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        chunks.push({ data, timestamp: chunk.timestamp, key: chunk.type === 'key' });
      },
      error(e) { failure = e; },
    });
    // An encoder that has failed also rejects its flush and refuses frames,
    // with errors of their own; the failure it reported is what counts.
    const encode = (frame, o) => { try { encoder.encode(frame, quantizer === null ? o : { ...o, avc: { quantizer } }); } catch (e) { throw failure || e; } };
    const flush = async () => { try { await encoder.flush(); } catch (e) { throw failure || e; } };
    const duration = Math.round(1e6 / hz);
    const frameAt = (timestamp) => {
      if (copy) { copy.copy(); return new env.VideoFrame(copy.canvas, { timestamp, duration }); }
      const { data, layout } = gpu ? gpu.convert(canvas) : { data: rgbaToNV12(g.getImageData(0, 0, width, height).data, width, height) };
      return new env.VideoFrame(data, { format: 'NV12', codedWidth: width, codedHeight: height, layout, colorSpace: BT709, timestamp, duration });
    };
    // The encoder route's first probe takes the first timestamp, so every frame
    // is encoded one frame later and moved back.
    const shift = copy ? duration : 0;
    const want = copy && probeWant(env);
    // Each finished frame is also read small for its flashes, through canvases
    // of the reader's own, so the film's canvas is never read back.
    const flashes = flashReader(env.createCanvas, width, height, hz);
    let counted = null;
    const probe = async (timestamp) => {
      const t = now();
      drawProbe(g, width, height);
      const frame = frameAt(timestamp);
      try { encode(frame, { keyFrame: true }); } finally { frame.close(); }
      await flush();
      if (failure) throw failure;
      // An encoder that returned nothing for the probe fails it as such, rather
      // than have the film's last frame decoded in its place.
      if (!chunks.length || chunks[chunks.length - 1].timestamp !== timestamp) return false;
      const cells = await probeCells(env, config, avcC, chunks.pop());
      convertMs += now() - t;
      if (cells && wroteFullRange(cells)) fullRange = true;
      return !!cells && cells.every((cell, k) => cell.every((v, j) => Math.abs(v - want[k][j]) <= 2));
    };
    try {
      encoder.configure(encoding);
      if (copy && !await probe(0)) return null;
      for (let i = 0; i < heads.length; i++) {
        if (gone()) return { lost: true };
        if (failure) throw failure;
        if (soundFailure) throw soundFailure;
        if (copy && !spaces.every(limited709)) return { dropped: UNLIMITED };
        const a = now();
        g.clearRect(0, 0, width, height);
        drawFrame(g, piece, from, heads[i], { scale, shutter });
        const c = now();
        flashes.read(canvas);
        const d = now();
        const frame = frameAt(shift + stamp(i));
        const b = now();
        try { encode(frame, { keyFrame: i % gop === 0 }); } finally { frame.close(); }
        // Anything that can hang is raced against a deadline: an encoder that
        // stops draining would otherwise hold the export open for ever.
        const stall = now() + STALL_MS;
        while (encoder.encodeQueueSize > 2 && !failure) {
          if (now() > stall) throw new Error(`film: the encoder stopped accepting frames at frame ${i} of ${heads.length}`);
          await pause();
        }
        // While the soundtrack is being made, each frame yields once, so the
        // soundtrack's steps on this thread run between frames.
        if (soundPending) await pause();
        drawMs += c - a;
        flashMs += d - c;
        convertMs += b - d;
        waitMs += now() - b;
        reported = true;
        if (opt.onProgress) opt.onProgress(i + 1, heads.length, restart);
      }
      await flush();
      // An encoder that reported an error may still resolve its flush: on the
      // encoder route its failure, not the frames it left out, is reported.
      if (copy && failure) throw failure;
      // An encoder may drop a frame it is handed as a texture, with no output
      // and no error: Chromium's Media Foundation encoder does when it cannot
      // take the texture's lock within 100 ms, which load can cause. A film the
      // encoder route returns short is encoded again, converted: the conversion
      // hands frames over in memory, which that encoder copies without the lock.
      if (copy && chunks.length !== heads.length) return { dropped: `the encoder returned ${chunks.length} of ${heads.length} frames` };
      if (copy && !await probe(shift + stamp(heads.length))) return { dropped: 'the test pattern after the last frame did not come back as drawn' };
      if (copy && !spaces.every(limited709)) return { dropped: UNLIMITED };
      const e = now();
      // A count lost with its worker is counted again from the frames drawn again.
      counted = await flashes.result(piece.size, async (read) => {
        for (let i = 0; i < heads.length; i++) {
          g.clearRect(0, 0, width, height);
          drawFrame(g, piece, from, heads[i], { scale, shutter });
          read(canvas);
        }
      });
      // Checked once more after the last frames, their recount and a wait for
      // a loss that has blanked them but not yet said so.
      if (watched) await pause(LOSS_MS);
      if (gone()) return { lost: true };
      flashMs += now() - e;
    } catch (e) {
      // Any other error, a draw that throws among them, is the pass's own.
      if (!failure || e !== failure) throw e;
    } finally {
      if (watched && canvas.removeEventListener) canvas.removeEventListener('contextlost', onLost);
      flashes.close();
      if (copy) copy.dispose();
      if (encoder.state !== 'closed') encoder.close();
    }
    if (failure) return { failed: failure };
    return { avcC, chunks: chunks.map((x) => ({ ...x, timestamp: x.timestamp - shift })), drawMs, convertMs, waitMs, flashMs, flashes: counted, rasterizer: drawnOn };
  }

  // The encoder converts where the browser can copy on the GPU and decode the
  // probes, and the export converts wherever that is not proven. The encoder
  // route only saves time, so anything that fails on it, a browser that cannot
  // make a frame of the copy or a piece that throws, is left to the conversion,
  // which fails the same way where the fault is not the route's. The report
  // names a route whose encoder failed, or that was dropped, after it drew
  // frames of the film, which is then drawn again; one dropped on its first
  // probe drew none, and is not named, and an encoder that failed on it is
  // named as the probe's, which drew nothing of the film.
  let conversion = 'encoder';
  let film = null;
  if (env.VideoDecoder && env.EncodedVideoChunk) {
    try { film = await pass('encoder'); } catch (e) { film = { dropped: String(e) }; }
    const why = film && reported && (film.failed || film.dropped);
    if (why) restarts.push('encoder route: ' + why);
    else if (film && film.failed) restarts.push('encoder probe: ' + film.failed);
    if (film && !film.chunks) film = null;
  }
  if (!film) {
    if (reported) restart = 'starting over: converting each frame';
    if (fullRange) {
      const candidate = { ...config, bitrateMode: 'quantizer' };
      const support = await env.VideoEncoder.isConfigSupported(candidate);
      if (support && support.supported) { encoding = candidate; quantizer = FULL_RANGE_QUANTIZER; }
    }
    const gpu = gpuNV12(env);
    conversion = gpu ? 'gpu' : 'cpu';
    try { film = await pass(conversion, gpu); } finally { if (gpu) gpu.dispose(); }
  }
  // The GPU process crash that loses the canvas can kill a hardware encoder as
  // well. Either way the film is drawn once more, in memory, on a fresh
  // encoder; an encoder that fails that pass too fails the export.
  const contextLost = !!film.lost;
  if (film.failed) restarts.push('video: ' + film.failed);
  let replaced = null;
  if (film.lost || film.failed) {
    replaced = watchedOn;
    conversion = 'cpu';
    if (reported) restart = `starting over in memory: ${film.lost ? 'the canvas lost its GPU' : 'the encoder failed'}`;
    // The crash also blanks, with no error, every canvas kept with the solve,
    // such as the finish's grain tile, so the frames are drawn from a fresh
    // solve of the same recipe, which makes them again.
    film = await pass('cpu', null, true, solve(piece, solved.seed, solved.manifest.params));
  }
  if (film.failed) throw film.failed;
  // The report times only the pass that made the film.
  const { avcC, chunks, drawMs, convertMs, waitMs, flashMs, flashes, rasterizer: drawnOn } = film;
  if (!avcC) throw new Error('film: the encoder described no decoder configuration, so no player could open the film');
  const { sound, level } = await soundtrack;

  // The timescale holds a whole number of ticks per frame, so no frame drifts.
  const timescale = Math.round(hz * 1000);
  const delta = Math.round(timescale / hz);
  // The solve's recipe, with the frames drawn where an SVG names its playhead:
  // how many, at what rate, whether the timeline loops, which decides each
  // frame's playhead, and the scale, which some pieces draw finer detail for.
  const manifest = { ...solved.manifest, film: { frames: heads.length, hz, loop: !!piece.time.loop, scale } };
  if (shutter) manifest.film.shutter = shutter;
  const bytes = muxMp4({
    video: {
      width, height, timescale, delta, avcC,
      samples: chunks.map((c, i) => ({ data: c.data, key: c.key, offset: Math.round((c.timestamp * timescale) / 1e6) - i * delta })),
    },
    audio: sound,
    manifest,
  });
  // The frames the encoder returned nothing for, which a refusal names.
  const returned = new Set(chunks.map((c) => c.timestamp));
  const missing = heads.map((_, i) => stamp(i)).filter((t) => !returned.has(t));
  const report = filmCheck({
    frames: heads.length, hz, width, height, sound: !!piece.sound, priming: sound ? sound.priming : 0, manifest, route: conversion, missing,
  }, readMp4(bytes));
  if (level) Object.assign(report.sound, level);
  const encoderError = restarts.length ? restarts.join('; ') : null;
  const totalMs = now() - started;
  return {
    bytes,
    report: Object.assign(report, {
      codec: config.codec, bitrate, quantizer, bytes: bytes.length, hz, conversion, rasterizer: drawnOn,
      rasterizerBeforeRedraw: replaced, contextLost, encoderError,
      drawMs: Math.round(drawMs), convertMs: Math.round(convertMs), encodeWaitMs: Math.round(waitMs), flashMs: Math.round(flashMs),
      soundMs: Math.round(soundMs), totalMs: Math.round(totalMs),
      realtime: totalMs > 0 ? +((report.seconds * 1000) / totalMs).toFixed(2) : null,
      flashes,
    }),
  };
}

module.exports = {
  exportFilm, stillFilmRefusal, filmConfig, filmScale, soundConfig, muxMp4, writeMp4, readMp4, filmCheck, avcCodecs, aacConfig, rgbaToNV12, dither,
  kWeighting, measureLoudness, normalizeLoudness, eventProminence, soundMarks, LOUDNESS,
};
