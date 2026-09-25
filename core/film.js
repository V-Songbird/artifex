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
  parts.push(full('stsz', 0, 0, u32(0), u32(t.samples.length), ...t.samples.map((s) => u32(s.length))));
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
function muxMp4({ video, audio = null, manifest = null }) {
  const length = video.samples.length * video.delta;
  const avcC = avcCBt709(video.avcC);
  const tracks = [{
    id: 1, handler: 'vide', timescale: video.timescale, duration: length,
    width: video.width, height: video.height,
    entry: avcEntry(video.width, video.height, avcC),
    samples: video.samples.map((s) => sampleBt709(s.data, (avcC[4] & 3) + 1)),
    deltas: video.samples.map(() => video.delta),
    offsets: video.samples.map((s) => s.offset || 0),
    keys: video.samples.map((s, i) => (s.key ? i + 1 : 0)).filter(Boolean),
  }];
  if (audio) {
    const opus = audio.codec === 'opus';
    const deltas = audio.samples.map((s) => (opus ? opusSamples(s) : 1024));
    tracks.push({
      id: 2, handler: 'soun', timescale: opus ? 48000 : audio.sampleRate, duration: deltas.reduce((n, d) => n + d, 0),
      entry: opus ? opusEntry(audio.head) : aacEntry(audio.channels, audio.sampleRate, audio.asc, audio.bitrate),
      samples: audio.samples, deltas,
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
  for (const t of tracks) t.chunks = t.samples.map(() => 0);
  let at = ftyp.length + moov().length + 8;
  for (const t of tracks) t.chunks = t.samples.map((s) => { const o = at; at += s.length; return o; });
  const body = concat(tracks.flatMap((t) => t.samples));
  return concat([ftyp, moov(), u32(body.length + 8), ascii('mdat'), body]);
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
 * sample lies inside the media data. Reads any file with 32-bit chunk offsets,
 * not only this writer's.
 */
function readMp4(bytes) {
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
        t = { handler: null, codec: null, colour: null, sps: [], nalLength: 0, opus: null, span: null, edits: null, deltas: [], keys: null, sizes: [], chunks: [], stsc: [], offsets: false };
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
    movie: out.movie,
    manifest: out.manifest,
    tracks: out.tracks.map((x) => {
      // Place every sample from its chunk and the chunk's run in stsc.
      let inside = !!out.media && x.sizes.length > 0;
      let sample = 0;
      for (let c = 0; c < x.chunks.length && sample < x.sizes.length; c++) {
        const run = x.stsc.filter((r) => r[0] <= c + 1).pop();
        let at = x.chunks[c];
        for (let k = 0; k < (run ? run[1] : 1) && sample < x.sizes.length; k++, sample++) {
          if (at < out.media[0] || at + x.sizes[sample] > out.media[1]) inside = false;
          // A sequence parameter set the sample repeats, in its length-prefixed NAL units.
          else if (x.nalLength) {
            for (let p = at, end = at + x.sizes[sample]; p + x.nalLength < end;) {
              let n = 0;
              for (let i = 0; i < x.nalLength; i++) n = n * 256 + bytes[p + i];
              if (n === 0 || p + x.nalLength + n > end) break;
              if ((bytes[p + x.nalLength] & 31) === 7) x.sps.push(spsLayout(rbspOf(bytes.subarray(p + x.nalLength, p + x.nalLength + n))).colour);
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
        reordered: x.offsets, inside,
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

/**
 * RGBA pixels, as a canvas holds them, to BT.709 limited-range NV12: a luma
 * plane with a sample for every pixel, then one plane of chroma pairs, U then
 * V, one pair for every 2x2 block from the block's average. The canvas's
 * sRGB-encoded values are the R'G'B' that BT.709 converts. A translucent pixel
 * is composited over black, as an encoder handed the canvas would. Width and
 * height are even.
 */
function rgbaToNV12(px, w, h, out = new Uint8Array(w * h * 1.5)) {
  const cw = w >> 1;
  const u = w * h;
  const row = w * 4;
  const yr = KR * 219 / 255, yg = KG * 219 / 255, yb = KB * 219 / 255;
  // Chroma is computed from the sum of the block's four pixels.
  const cb = 224 / 255 / (2 * (1 - KB)) / 4, cr = 224 / 255 / (2 * (1 - KR)) / 4;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0, p = y * row, o = y * w, c = (y >> 1) * cw; x < w; x += 2, p += 8, o += 2, c++) {
      const q = p + row;
      let r0 = px[p], g0 = px[p + 1], b0 = px[p + 2], r1 = px[p + 4], g1 = px[p + 5], b1 = px[p + 6];
      let r2 = px[q], g2 = px[q + 1], b2 = px[q + 2], r3 = px[q + 4], g3 = px[q + 5], b3 = px[q + 6];
      if ((px[p + 3] & px[p + 7] & px[q + 3] & px[q + 7]) !== 255) {
        const a0 = px[p + 3] / 255, a1 = px[p + 7] / 255, a2 = px[q + 3] / 255, a3 = px[q + 7] / 255;
        r0 *= a0; g0 *= a0; b0 *= a0; r1 *= a1; g1 *= a1; b1 *= a1;
        r2 *= a2; g2 *= a2; b2 *= a2; r3 *= a3; g3 *= a3; b3 *= a3;
      }
      // A Uint8Array store truncates, so the added 0.5 rounds half up.
      out[o] = 16.5 + yr * r0 + yg * g0 + yb * b0;
      out[o + 1] = 16.5 + yr * r1 + yg * g1 + yb * b1;
      out[o + w] = 16.5 + yr * r2 + yg * g2 + yb * b2;
      out[o + w + 1] = 16.5 + yr * r3 + yg * g3 + yb * b3;
      const rs = r0 + r1 + r2 + r3, gs = g0 + g1 + g2 + g3, bs = b0 + b1 + b2 + b3;
      const ls = KR * rs + KG * gs + KB * bs;
      out[u + 2 * c] = 128.5 + cb * (bs - ls);
      out[u + 2 * c + 1] = 128.5 + cr * (rs - ls);
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
vec3 at(int x, int y) { return texelFetch(s, ivec2(min(x, size.x - 1), min(y, size.y - 1)), 0).rgb; }
float luma(int x, int y) { return (16.0 + 219.0 * dot(at(x, y), K)) / 255.0; }
vec2 chroma(int x, int y) {
  vec3 c = (at(2 * x, 2 * y) + at(2 * x + 1, 2 * y) + at(2 * x, 2 * y + 1) + at(2 * x + 1, 2 * y + 1)) * 0.25;
  float l = dot(c, K);
  return (128.0 + 224.0 * vec2((c.b - l) / ${f(2 * (1 - KB))}, (c.r - l) / ${f(2 * (1 - KR))})) / 255.0;
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
      if (gl.isContextLost()) throw new Error('film: the GPU lost the frame copy part-way through the film. Nothing was saved.');
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
// soundtracks -0.10 to +0.14 dB. So the ceiling is -2 dBTP for both, which
// keeps a soundtrack under -1 dBTP once decoded. A soundtrack whose peaks
// would need more than `depth` dB of limiting stops short, and one that ends
// more than `short` LU under the target says how far.
const LOUDNESS = { target: -14, ceiling: { mp4a: -2, Opus: -2 }, short: 3, depth: 12, attack: 0.005, release: 0.05 };

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
 * block passes, which is silence as far as loudness goes.
 */
function integratedLoudness(channels, rate) {
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
  if (!heard.length) return -Infinity;
  const floor = lufs(mean(heard)) - 10;
  return lufs(mean(heard.filter((z) => lufs(z) > floor)));
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
 * runs 11 past the last sample while the filter rings out.
 */
function peakEnvelope(channels) {
  const envelope = new Float64Array(channels[0].length + 11);
  for (const x of channels) {
    const padded = new Float64Array(x.length + 22);
    padded.set(x, 11);
    for (let i = 11; i < padded.length; i++) {
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
 * True peak in dBTP: the largest magnitude of the signal oversampled four
 * times, which finds the peaks that fall between samples, where a decoder's
 * reconstruction and a lossy encoder overshoot the sample peak. NaN or
 * Infinity when a sample is not a finite number.
 */
function truePeak(channels) {
  return 20 * Math.log10(peakEnvelope(channels).reduce((a, b) => Math.max(a, b), 0));
}

/**
 * The limiter's gain on each of `n` samples, so that `scale` times a signal
 * whose peakEnvelope is `envelope` stays under the linear `ceiling`. Every
 * envelope point that would pass it is brought down to it on all twelve
 * samples it was interpolated from: the gain falls linearly over the attack
 * before them, as the mean of the least need over a window, and recovers
 * exponentially over the release after. The same channels, scale and rate
 * give the same gain, bit for bit.
 */
function limiterGain(envelope, n, scale, ceiling, rate) {
  const attack = Math.max(1, Math.round(LOUDNESS.attack * rate)), span = attack + 12;
  const need = new Float64Array(n + span - 1).fill(1);
  for (let j = 0; j < Math.min(need.length, envelope.length); j++) need[j] = Math.min(1, ceiling / (scale * envelope[j]));
  // least[q], the least need from q to q + span - 1, by a sliding minimum.
  const least = new Float64Array(n), queue = new Int32Array(need.length);
  for (let j = 0, head = 0, tail = 0; j < need.length; j++) {
    while (tail > head && need[queue[tail - 1]] >= need[j]) tail--;
    queue[tail++] = j;
    const q = j - span + 1;
    if (q < 0) continue;
    while (queue[head] < q) head++;
    least[q] = need[queue[head]];
  }
  // The mean of least over the attack ending at each sample is under the need
  // of every envelope point within span of it; the release only lowers it.
  // Before the first sample the window holds least[0], so a peak there is met.
  const back = Math.exp(-1 / (LOUDNESS.release * rate)), gain = new Float64Array(n);
  for (let k = 0, sum = attack * least[0], g = 1; k < n; k++) {
    sum += least[k] - least[Math.max(0, k - attack)];
    g = Math.min(sum / attack, 1 - (1 - g) * back);
    gain[k] = g;
  }
  return gain;
}

/** Integrated loudness (LUFS) and true peak (dBTP) of an AudioBuffer-shaped soundtrack. */
function measureLoudness(buffer) {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  return { lufs: integratedLoudness(channels, buffer.sampleRate), dbtp: truePeak(channels) };
}

const round2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

/**
 * Bring a rendered soundtrack to LOUDNESS in place, for encoding in `codec`,
 * the sample entry it is encoded in: 'mp4a', AAC, or 'Opus', each with a
 * ceiling of -2 dBTP. A soundtrack whose peaks leave room gets one static
 * gain to -14 LUFS. One whose peaks would pass the ceiling first is limited:
 * its gain is found by the secant method, within 0.005 LU of the target in at
 * most eight tries, through limiterGain, then trimmed so its true peak meets
 * the ceiling; by LOUDNESS.depth dB of limiting at most, where it stops short.
 * Says what was measured and done: `measured` as rendered, the `gain` in dB,
 * `limited`, the deepest the limiter turned it down in dB, only when it did,
 * the `lufs` and `dbtp` it is encoded at, and `short`, how many LU it ends
 * under the target, where that is more than LOUDNESS.short. A soundtrack with
 * no block above the -70 LUFS gate has no loudness to set and keeps its level,
 * reported as null. A sample that is not a finite number, which no player can
 * play, is refused. The same soundtrack and codec come out the same bits, so
 * replay levels its render as the export did.
 */
function normalizeLoudness(buffer, codec) {
  const ceiling = LOUDNESS.ceiling[codec];
  if (typeof ceiling !== 'number') throw new Error(`film: a soundtrack is levelled for AAC ('mp4a') or 'Opus', not ${JSON.stringify(codec)}`);
  // Checked before measuring: an infinite sample becomes NaN in the K-weighting
  // filter, which the -70 LUFS gate drops, so the meter alone would pass it.
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    if (!buffer.getChannelData(c).every(Number.isFinite)) {
      throw new Error('film: the soundtrack holds samples that are not finite numbers, so it cannot be measured or played. Nothing was saved.');
    }
  }
  const measured = measureLoudness(buffer);
  if (measured.lufs === -Infinity) return { measured: { lufs: null, dbtp: round2(measured.dbtp) }, gain: 0, lufs: null, dbtp: round2(measured.dbtp) };
  const want = LOUDNESS.target - measured.lufs, room = ceiling - measured.dbtp;
  let gain = Math.min(want, room), limited = 0;
  if (want > room) {
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
    const n = channels[0].length, rate = buffer.sampleRate, envelope = peakEnvelope(channels), line = 10 ** (ceiling / 20);
    const out = channels.map((x) => new Float32Array(x.length));
    // The loudness at `g` dB through the limiter, left in `out` with its depth in `limited`.
    const level = (g) => {
      const scale = 10 ** (g / 20), curve = limiterGain(envelope, n, scale, line, rate);
      channels.forEach((x, c) => { for (let i = 0; i < n; i++) out[c][i] = x[i] * scale * curve[i]; });
      const trim = 10 ** (Math.min(0, ceiling - truePeak(out)) / 20);
      if (trim < 1) for (const y of out) for (let i = 0; i < n; i++) y[i] *= trim;
      limited = -20 * Math.log10(trim * curve.reduce((a, b) => Math.min(a, b), 1));
      return integratedLoudness(out, rate);
    };
    const cap = room + LOUDNESS.depth;
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

// How long the encoder's queue may stand still before the export gives up.
const STALL_MS = 30000;

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
  encoder.close();
  if (failure) throw failure;
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
 * `keySeconds` and `onProgress(done, total)`.
 *
 * Resolves to { bytes, report }; the report is read from the finished file,
 * replay manifest included, and names the colour conversion that ran,
 * `encoder`, `gpu` or `cpu`. `convertMs` includes, on the GPU and CPU routes,
 * waiting for the browser to finish drawing each frame, and on the encoder
 * route its probes. `soundMs` is the soundtrack's own time, which runs
 * alongside the frames, and `encodeWaitMs` includes each frame's yield to it.
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
  if (opt.bitrate !== undefined && !(Number.isSafeInteger(opt.bitrate) && opt.bitrate > 0)) {
    throw new Error(`film: bitrate must be a whole number of bits per second above zero, got ${opt.bitrate}`);
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
  let soundPending = !!piece.sound;
  const soundtrack = piece.sound ? (async () => {
    const s0 = now();
    const buffer = await renderSound(piece, solved, { OfflineAudioContext: env.OfflineAudioContext, sampleRate: SOUND.sampleRate, channels: SOUND.channels });
    const level = normalizeLoudness(buffer, soundCodec.codec === 'opus' ? 'Opus' : 'mp4a');
    const sound = await encodeSound(env, buffer, soundCodec);
    soundMs = now() - s0;
    return { sound, level };
  })() : Promise.resolve({ sound: null, level: null });
  soundtrack.then(() => { soundPending = false; }, (e) => { soundPending = false; soundFailure = e; });

  const gop = Math.max(1, Math.round(hz * (opt.keySeconds || 2)));
  const stamp = (i) => Math.round((i * 1e6) / hz);

  // Every frame drawn and encoded once, handed over as `route` says: 'encoder'
  // through glCopy with a probe before and after, 'gpu' through gpuNV12, 'cpu'
  // through rgbaToNV12. Resolves to the film's chunks and avcC, with this pass's
  // own drawing, conversion and encode-wait times, or null when the encoder
  // route is not proven for this export.
  async function pass(route, gpu) {
    let drawMs = 0;
    let convertMs = 0;
    let waitMs = 0;
    const canvas = env.createCanvas(width, height);
    // Without the GPU the canvas is read back every frame, so it is kept in memory
    // from the first: a browser that moved it there part-way would change how the
    // rest of the film is drawn.
    const g = route === 'cpu' ? canvas.getContext('2d', { willReadFrequently: true }) : canvas.getContext('2d');
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
    const probe = async (timestamp) => {
      const t = now();
      drawProbe(g, width, height);
      const frame = frameAt(timestamp);
      try { encoder.encode(frame, { keyFrame: true }); } finally { frame.close(); }
      await encoder.flush();
      if (failure) throw failure;
      // An encoder that returned nothing for the probe fails it as such, rather
      // than have the film's last frame decoded in its place.
      if (!chunks.length || chunks[chunks.length - 1].timestamp !== timestamp) return false;
      const cells = await probeCells(env, config, avcC, chunks.pop());
      convertMs += now() - t;
      return !!cells && cells.every((cell, k) => cell.every((v, j) => Math.abs(v - want[k][j]) <= 2));
    };
    try {
      encoder.configure(config);
      if (copy && !await probe(0)) return null;
      for (let i = 0; i < heads.length; i++) {
        if (failure) throw failure;
        if (soundFailure) throw soundFailure;
        if (copy && !spaces.every(limited709)) return null;
        const a = now();
        g.clearRect(0, 0, width, height);
        drawFrame(g, piece, solved, heads[i], { scale });
        const c = now();
        const frame = frameAt(shift + stamp(i));
        const b = now();
        try { encoder.encode(frame, { keyFrame: i % gop === 0 }); } finally { frame.close(); }
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
        convertMs += b - c;
        waitMs += now() - b;
        if (opt.onProgress) opt.onProgress(i + 1, heads.length);
      }
      await encoder.flush();
      // An encoder may drop a frame it is handed as a texture, with no output
      // and no error: Chromium's Media Foundation encoder does when it cannot
      // take the texture's lock within 100 ms, which load can cause. A film the
      // encoder route returns short is encoded again, converted: the conversion
      // hands frames over in memory, which that encoder copies without the lock.
      if (copy && chunks.length !== heads.length) return null;
      if (copy && !(await probe(shift + stamp(heads.length)) && spaces.every(limited709))) return null;
    } finally {
      if (copy) copy.dispose();
      if (encoder.state !== 'closed') encoder.close();
    }
    if (failure) throw failure;
    return { avcC, chunks: chunks.map((x) => ({ ...x, timestamp: x.timestamp - shift })), drawMs, convertMs, waitMs };
  }

  // The encoder converts where the browser can copy on the GPU and decode the
  // probes, and the export converts wherever that is not proven. The encoder
  // route only saves time, so anything that fails on it, a browser that cannot
  // make a frame of the copy or a piece that throws, is left to the conversion,
  // which fails the same way where the fault is not the route's.
  let conversion = 'encoder';
  let film = null;
  if (env.VideoDecoder && env.EncodedVideoChunk) {
    try { film = await pass('encoder'); } catch (e) { film = null; }
  }
  if (!film) {
    const gpu = gpuNV12(env);
    conversion = gpu ? 'gpu' : 'cpu';
    try { film = await pass(conversion, gpu); } finally { if (gpu) gpu.dispose(); }
  }
  // The report times only the pass that made the film.
  const { avcC, chunks, drawMs, convertMs, waitMs } = film;
  if (!avcC) throw new Error('film: the encoder described no decoder configuration, so no player could open the film');
  const { sound, level } = await soundtrack;

  // The timescale holds a whole number of ticks per frame, so no frame drifts.
  const timescale = Math.round(hz * 1000);
  const delta = Math.round(timescale / hz);
  // The solve's recipe, with the frames drawn where an SVG names its playhead:
  // how many, at what rate, whether the timeline loops, which decides each
  // frame's playhead, and the scale, which some pieces draw finer detail for.
  const manifest = { ...solved.manifest, film: { frames: heads.length, hz, loop: !!piece.time.loop, scale } };
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
  const totalMs = now() - started;
  return {
    bytes,
    report: Object.assign(report, {
      codec: config.codec, bitrate, bytes: bytes.length, hz, conversion,
      drawMs: Math.round(drawMs), convertMs: Math.round(convertMs), encodeWaitMs: Math.round(waitMs),
      soundMs: Math.round(soundMs), totalMs: Math.round(totalMs),
      realtime: totalMs > 0 ? +((report.seconds * 1000) / totalMs).toFixed(2) : null,
    }),
  };
}

module.exports = {
  exportFilm, filmConfig, filmScale, soundConfig, muxMp4, readMp4, filmCheck, avcCodecs, aacConfig, rgbaToNV12,
  kWeighting, measureLoudness, normalizeLoudness,
};
