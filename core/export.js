// Saving a drawn frame or a film as a file that carries its recipe.
//
// The page's exports and the site's are these: PNG and SVG of one frame, the
// frame-exact MP4 through core/film.js, and the real-time WebM recorder where
// the browser cannot encode the MP4; which film a browser can make of a piece
// (filmChoice), and what is said about it after (filmNote). Every file carries
// the replay manifest, so npm run replay can draw it again.
//
// The byte writers and readers below run in Node as well, where the tools read
// saved files and the tests reach them. The exporters at the end need a browser:
// a document to make canvases, and its encoders and recorder.

'use strict';

const piece = require('./piece.js');
const render = require('./render.js');
const film = require('./film.js');
const { VectorSurface } = require('./surface-vector.js');

/**
 * The head of the EBML element at `at`: its id, the widths of its id and size
 * fields, its size and where its body starts. The size is read without its
 * marker bit, a byte at a time, so a size of any length up to 8 bytes stays
 * exact; all value bits set means "unknown", which a recorder writes for a
 * Segment or Cluster still being written. Every WebM walk here reads its
 * elements through this.
 */
function ebmlHead(bytes, at) {
  const width = (b) => { let n = 1; while (n <= 8 && !(b & (0x80 >> (n - 1)))) n++; return n; };
  const idLen = width(bytes[at]), sizeLen = width(bytes[at + idLen]);
  let id = 0;
  for (let i = 0; i < idLen; i++) id = id * 256 + bytes[at + i];
  const first = bytes[at + idLen] & (0xFF >> sizeLen);
  let size = first, unknown = first === 0xFF >> sizeLen;
  for (let i = 1; i < sizeLen; i++) { size = size * 256 + bytes[at + idLen + i]; unknown = unknown && bytes[at + idLen + i] === 0xFF; }
  return { at, id, idLen, sizeLen, size, unknown, body: at + idLen + sizeLen };
}

/**
 * Write `size` into the size field of the element whose head is `head`, in
 * `out`, keeping the field's width. Throws where the width cannot hold it.
 */
function ebmlResize(out, head, size) {
  if (size >= 2 ** (7 * head.sizeLen) - 1) throw new Error('an EBML size field of ' + head.sizeLen + ' bytes cannot hold ' + size);
  for (let i = head.sizeLen - 1, v = size; i >= 0; i--, v = Math.floor(v / 256)) out[head.body - head.sizeLen + i] = v % 256;
  out[head.body - head.sizeLen] |= 0x80 >> (head.sizeLen - 1);
}

/** The CRC-32 of `bytes`, as zlib, PNG and EBML compute it. */
function crc32(bytes) {
  let crc = ~0;
  for (const b of bytes) { crc ^= b; for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1)); }
  return ~crc >>> 0;
}

/**
 * `bytes` with `added` inserted at byte `at` of its Segment, every stored
 * position still naming the element it named. A WebM stores positions from
 * the start of its Segment's data: the SeekPositions in a SeekHead, and the
 * CueClusterPositions in Cues, which Edge's recorder writes after the last
 * Cluster when it stops. Each position at or past the insertion moves by its
 * length. A position that outgrows its field is written wider, which grows its
 * SeekHead or Cues and moves what follows them; that repeats until no field
 * grows. `parent`, when given, is the head of the element the insertion lands
 * inside and grows by its length; a Segment of known size grows by everything
 * added. With `listed`, the first SeekHead also gets a Seek entry for the
 * inserted element, so a reader that finds elements through it finds this one.
 * A CRC-32 that opens a rebuilt SeekHead, Cues or one of their parts covers the
 * rest of that element's data, so it is computed again over the new data. A
 * Cluster Position, a CueCodecState, a CueReference, a CRC-32 anywhere else in
 * an index, or one over the whole Segment would go stale too, so a file
 * carrying one is refused.
 */
function webmInsert(bytes, at, added, parent, listed) {
  const SEGMENT = 0x18538067, CLUSTER = 0x1F43B675, SEEKHEAD = 0x114D9B74, CUES = 0x1C53BB6B;
  const MASTERS = [SEEKHEAD, 0x4DBB, CUES, 0xBB, 0xB7], POSITIONS = [0x53AC, 0xF1];
  const REFUSED = { 0xA7: 'Cluster Position', 0xEA: 'CueCodecState', 0xDB: 'CueReference', 0xBF: 'CRC-32' };
  const refuse = (id) => { throw new Error('the recorded WebM carries a ' + REFUSED[id] + ', which the insertion would leave stale'); };
  const uint = (from, n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + bytes[from + i]; return v; };
  // A size field at least `width` bytes wide that holds `n`.
  const field = (n, width) => {
    while (n >= 2 ** (7 * width) - 1) width++;
    const out = new Uint8Array(width);
    ebmlResize(out, { body: width, sizeLen: width }, n);
    return Array.from(out);
  };
  // Every SeekHead and Cues, stepping into Clusters to reach those after one of unknown size.
  let segment = null;
  const index = [];
  for (let p = 0; p < bytes.length;) {
    const e = ebmlHead(bytes, p);
    if (e.idLen > 4 || e.sizeLen > 8) break;
    if (e.id === SEGMENT) {
      segment = e;
      if (ebmlHead(bytes, e.body).id === 0xBF) refuse(0xBF);
    }
    if (e.id === SEGMENT || e.id === CLUSTER) { p = e.body; continue; }
    if (e.id === 0xA7) refuse(e.id);
    if (e.unknown) break;
    if (e.id === SEEKHEAD || e.id === CUES) index.push(e);
    p = e.body + e.size;
  }
  const base = segment ? segment.body : 0, grown = index.map(() => 0);
  const lists = listed ? index.find((e) => e.id === SEEKHEAD) : null;
  // Where the element at Segment position `P` starts once everything is in.
  const move = (P) => P + (P >= at - base ? added.length : 0) + index.reduce((sum, e, i) => sum + (e.at - base < P ? grown[i] : 0), 0);
  // The element `e` written again with every position moved; each field keeps
  // its width unless its new value needs more.
  const rebuild = (e) => {
    const end = e.body + e.size, parts = [];
    let summed = false;
    for (let q = e.body; q < end;) {
      const c = ebmlHead(bytes, q);
      if (end > bytes.length || c.unknown || c.body + c.size > end) throw new Error('the recorded WebM has a SeekHead or Cues cut short or malformed');
      if (q === e.body && c.id === 0xBF && c.size === 4) { summed = true; q = c.body + c.size; continue; }
      if (c.id in REFUSED) refuse(c.id);
      if (MASTERS.includes(c.id)) parts.push(rebuild(c));
      else if (POSITIONS.includes(c.id)) {
        let v = move(uint(c.body, c.size)), n = c.size;
        while (v >= 256 ** n) n++;
        const value = [];
        for (let i = 0; i < n; i++, v = Math.floor(v / 256)) value.unshift(v % 256);
        parts.push([...bytes.subarray(q, c.body - c.sizeLen), ...field(n, c.sizeLen), ...value]);
      } else parts.push(Array.from(bytes.subarray(q, c.body + c.size)));
      q = c.body + c.size;
    }
    if (e === lists) {
      // Where the inserted element starts: past what grew before it, not past itself.
      let v = move(at - base) - added.length;
      const value = [], id = Array.from(added.subarray(0, ebmlHead(added, 0).idLen));
      do { value.unshift(v % 256); v = Math.floor(v / 256); } while (v > 0);
      const entry = [0x53, 0xAB, ...field(id.length, 1), ...id, 0x53, 0xAC, ...field(value.length, 1), ...value];
      parts.push([0x4D, 0xBB, ...field(entry.length, 1), ...entry]);
    }
    let body = parts.flat();
    if (summed) {
      const sum = crc32(body);
      body = [0xBF, 0x84, sum & 255, (sum >>> 8) & 255, (sum >>> 16) & 255, sum >>> 24, ...body];
    }
    return [...bytes.subarray(e.at, e.body - e.sizeLen), ...field(body.length, e.sizeLen), ...body];
  };
  let built;
  for (;;) {
    built = index.map(rebuild);
    const next = built.map((b, i) => b.length - (index[i].body + index[i].size - index[i].at));
    if (next.every((g, i) => g === grown[i])) break;
    next.forEach((g, i) => { grown[i] = g; });
  }
  const total = added.length + grown.reduce((a, b) => a + b, 0);
  const src = bytes.slice();
  if (parent) ebmlResize(src, parent, parent.size + added.length);
  if (segment && !segment.unknown) ebmlResize(src, segment, segment.size + total);
  const cuts = [{ at, end: at, put: added }, ...index.map((e, i) => ({ at: e.at, end: e.body + e.size, put: built[i] }))].sort((a, b) => a.at - b.at);
  const out = new Uint8Array(bytes.length + total);
  let from = 0, to = 0;
  for (const c of cuts) {
    out.set(src.subarray(from, c.at), to);
    to += c.at - from;
    out.set(c.put, to);
    to += c.put.length;
    from = c.end;
  }
  out.set(src.subarray(from), to);
  return out;
}

/**
 * When every frame in a WebM file plays, in milliseconds, read from the FILE.
 *
 * MediaRecorder cannot be asked how many frames it received, and it stamps each
 * one by the wall clock rather than by the timestamp on the frame it was handed.
 * So what the write loop believes it
 * wrote is the wrong half to measure: the file is the film, and this reads it.
 *
 * A flat walk, not a tree: a recorder writes its Segment and its Clusters with
 * unknown sizes, and stepping INTO a master instead of over it needs no size.
 * The recorder here has one track, so every block is one picture.
 *
 * The page, the site and the tools that read a saved film all use this one.
 */
function webmBlockTimes(bytes) {
  const SEGMENT = 0x18538067, INFO = 0x1549A966, CLUSTER = 0x1F43B675, GROUP = 0xA0;
  const SCALE = 0x2AD7B1, TIMECODE = 0xE7, SIMPLE = 0xA3, BLOCK = 0xA1;
  let p = 0, scale = 1000000, cluster = 0;
  const out = [];
  const uint = (at, n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + bytes[at + i]; return v; };
  while (p < bytes.length) {
    const e = ebmlHead(bytes, p);
    if (e.idLen > 4 || e.sizeLen > 8) break;
    p = e.body;
    if (e.id === SEGMENT || e.id === INFO || e.id === CLUSTER || e.id === GROUP) continue;
    // Only a master may carry an unknown size.
    if (e.unknown) break;
    if (e.id === SCALE) scale = uint(p, e.size);
    else if (e.id === TIMECODE) cluster = uint(p, e.size);
    else if (e.id === SIMPLE || e.id === BLOCK) {
      // Past the block's track number, a vint as wide as its marker says.
      const at = p + ebmlHead(bytes, p).idLen;
      out.push((cluster + ((uint(at, 2) << 16) >> 16)) * scale / 1000000);
    }
    p += e.size;
  }
  return out;
}

/**
 * A recorded WebM whose Segment Info says it lasts `seconds`.
 *
 * MediaRecorder writes a live film. Edge's recorder leaves a Duration of one
 * TimecodeScale unit, so a player reports 0.001 s and cannot seek. The film's
 * length is known -- frames / hz -- so it is written here, in the file's own
 * units: over the recorder's Duration where there is one, else as a new one at
 * the end of Info. Every other byte stays; an insertion grows Info and moves
 * the positions webmInsert names. A CRC-32 that opens Info covers the rest of
 * Info's data, so it is computed again, little-endian as EBML stores it; one
 * that opens the Segment covers the whole film, and is refused.
 */
function webmWithDuration(bytes, seconds) {
  const SEGMENT = 0x18538067, INFO = 0x1549A966, SCALE = 0x2AD7B1, DURATION = 0x4489, CRC = 0xBF;
  const uint = (at, n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + bytes[at + i]; return v; };
  const head = (at) => ebmlHead(bytes, at);
  // `out` with Info's CRC-32 computed again, over Info where it now sits.
  const checked = (out) => {
    for (let p = 0; p < out.length;) {
      const e = ebmlHead(out, p);
      if (e.id === SEGMENT) {
        if (ebmlHead(out, e.body).id === CRC) throw new Error('the recorded WebM carries a CRC-32 over its Segment, which writing its length would leave stale');
        p = e.body;
        continue;
      }
      if (e.id === INFO) {
        const c = ebmlHead(out, e.body);
        if (c.id === CRC && c.size === 4) new DataView(out.buffer, out.byteOffset).setUint32(c.body, crc32(out.subarray(c.body + 4, e.body + e.size)), true);
        break;
      }
      p = e.body + e.size;
    }
    return out;
  };
  for (let p = 0; p < bytes.length;) {
    const e = head(p);
    if (e.id === SEGMENT) { p = e.body; continue; }
    if (e.id !== INFO) { if (e.unknown) break; p = e.body + e.size; continue; }
    let scale = 1000000, duration = null;
    for (let q = e.body; q < e.body + e.size;) {
      const c = head(q);
      if (c.id === SCALE) scale = uint(c.body, c.size);
      else if (c.id === DURATION) duration = c;
      q = c.body + c.size;
    }
    const units = (seconds * 1e9) / scale;
    if (duration && (duration.size === 4 || duration.size === 8)) {
      const out = bytes.slice();
      const view = new DataView(out.buffer, out.byteOffset + duration.body, duration.size);
      if (duration.size === 4) view.setFloat32(0, units); else view.setFloat64(0, units);
      return checked(out);
    }
    const added = Uint8Array.of(0x44, 0x89, 0x88, 0, 0, 0, 0, 0, 0, 0, 0);
    new DataView(added.buffer).setFloat64(3, units);
    return checked(webmInsert(bytes, e.body + e.size, added, e));
  }
  throw new Error('the recorded WebM has no Segment Info, so its length cannot be written');
}

/**
 * A recorded WebM that also carries the replay manifest: one Tags element
 * inserted before the first Cluster, holding one Tag with empty Targets (the
 * whole film) and one SimpleTag, TagName "ARTIFEX_MANIFEST" and TagString the
 * manifest as JSON, ASCII only as in a film and a PNG. Players skip tags they
 * do not use. Every other byte stays, but for the positions webmInsert moves;
 * a SeekHead also lists the Tags.
 */
function webmWithManifest(bytes, manifest) {
  const SEGMENT = 0x18538067, CLUSTER = 0x1F43B675;
  const ascii = (s) => Array.from(s, (ch) => ch.charCodeAt(0));
  const json = JSON.stringify(manifest).replace(/[^\x00-\x7f]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  // An element with an 8-byte size, the width the recorder writes.
  const element = (id, body) => {
    const size = [0x01, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 7, v = body.length; i > 0; i--, v = Math.floor(v / 256)) size[i] = v % 256;
    return [...id, ...size, ...body];
  };
  const simple = element([0x67, 0xC8], [...element([0x45, 0xA3], ascii('ARTIFEX_MANIFEST')), ...element([0x44, 0x87], ascii(json))]);
  const tags = Uint8Array.from(element([0x12, 0x54, 0xC3, 0x67], element([0x73, 0x73], [...element([0x63, 0xC0], []), ...simple])));
  for (let p = 0; p < bytes.length;) {
    const e = ebmlHead(bytes, p);
    if (e.sizeLen > 8) break;
    if (e.id === SEGMENT) { p = e.body; continue; }
    if (e.id !== CLUSTER) { if (e.unknown) break; p = e.body + e.size; continue; }
    return webmInsert(bytes, p, tags, null, true);
  }
  throw new Error('the recorded WebM has no Cluster, so its recipe has nowhere to go');
}

/**
 * The replay manifest a WebM's ARTIFEX_MANIFEST tag holds, or null for a WebM
 * without one. Every read stays inside its element: a Tags element the file
 * cuts short, or one whose parts overrun their parent, throws by name.
 */
function webmManifest(bytes) {
  const SEGMENT = 0x18538067, TAGS = 0x1254C367, TAG = 0x7373, SIMPLE = 0x67C8, NAME = 0x45A3, STRING = 0x4487;
  const text = (from, to) => String.fromCharCode(...bytes.subarray(from, to));
  const children = (from, to) => {
    const out = [];
    for (let p = from; p < to;) {
      const e = ebmlHead(bytes, p);
      if (e.unknown || e.sizeLen > 8 || e.body + e.size > to) throw new Error('the WebM Tags element is cut short or malformed');
      out.push(e);
      p = e.body + e.size;
    }
    return out;
  };
  for (let p = 0; p < bytes.length;) {
    const e = ebmlHead(bytes, p);
    if (e.sizeLen > 8) break;
    if (e.id === SEGMENT) { p = e.body; continue; }
    if (e.unknown) break;
    if (e.id === TAGS) {
      if (e.body + e.size > bytes.length) throw new Error('the WebM ends inside its Tags element');
      for (const tag of children(e.body, e.body + e.size).filter((c) => c.id === TAG)) {
        for (const simple of children(tag.body, tag.body + tag.size).filter((c) => c.id === SIMPLE)) {
          const parts = children(simple.body, simple.body + simple.size);
          const name = parts.find((c) => c.id === NAME), value = parts.find((c) => c.id === STRING);
          if (!name || !value || text(name.body, name.body + name.size) !== 'ARTIFEX_MANIFEST') continue;
          try { return JSON.parse(text(value.body, value.body + value.size)); } catch (err) { throw new Error('the WebM ARTIFEX_MANIFEST tag does not hold JSON: ' + err.message); }
        }
      }
    }
    p = e.body + e.size;
  }
  return null;
}

/**
 * PNG bytes that also carry the replay manifest: one iTXt chunk, keyword
 * "artifex-manifest", inserted before IEND. The text is the manifest as JSON,
 * ASCII only -- any other character becomes a \uXXXX escape, as in a film -- so
 * it is also the UTF-8 an iTXt chunk holds. Every other chunk, and so every
 * pixel, keeps its bytes.
 */
function pngWithManifest(bytes, manifest) {
  const ascii = (s) => Array.from(s, (ch) => ch.charCodeAt(0));
  const json = JSON.stringify(manifest).replace(/[^\x00-\x7f]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  // Type, keyword and its null, compression flag and method (none), then an
  // empty language tag and translated keyword, each ended by a null.
  const body = Uint8Array.from([...ascii('iTXtartifex-manifest'), 0, 0, 0, 0, 0, ...ascii(json)]);
  const chunk = new Uint8Array(body.length + 8);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, body.length - 4);
  chunk.set(body, 4);
  view.setUint32(chunk.length - 4, crc32(body));
  const u32 = (at) => ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
  for (let p = 8; p + 12 <= bytes.length; p += 12 + u32(p)) {
    if (String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]) !== 'IEND') continue;
    const out = new Uint8Array(bytes.length + chunk.length);
    out.set(bytes.subarray(0, p));
    out.set(chunk, p);
    out.set(bytes.subarray(p), p + chunk.length);
    return out;
  }
  throw new Error('the PNG has no IEND chunk, so its recipe has nowhere to go');
}

/**
 * The replay manifest a PNG's "artifex-manifest" iTXt chunk holds, or null for
 * a PNG without one. Every read stays inside the chunk: a chunk the file cuts
 * short, or one without its text, throws by name rather than being read past.
 */
function pngManifest(bytes) {
  const u32 = (at) => ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
  const text = (from, to) => String.fromCharCode(...bytes.subarray(from, to));
  const KEY = 'artifex-manifest';
  for (let p = 8; p + 12 <= bytes.length; p += 12 + u32(p)) {
    const data = p + 8, end = data + u32(p);
    if (text(p + 4, p + 8) !== 'iTXt' || text(data, Math.min(end, data + KEY.length + 1)) !== KEY + '\0') continue;
    if (end + 4 > bytes.length) throw new Error('the PNG ends inside its artifex-manifest chunk');
    // Past the keyword, the two compression bytes, and the language tag and
    // translated keyword, each ended by a null. The text is ASCII JSON.
    let at = data + KEY.length + 3;
    for (let nulls = 0; nulls < 2; at++) {
      if (at >= end) throw new Error('the artifex-manifest chunk ends before its text');
      if (bytes[at] === 0) nulls++;
    }
    try { return JSON.parse(text(at, end)); } catch (e) { throw new Error('the artifex-manifest chunk does not hold JSON: ' + e.message); }
  }
  return null;
}

/**
 * What the page says after an MP4 export, read from the film's own report: its
 * size and length, its soundtrack's codec, and where its colour was converted
 * and how long that took. An Opus soundtrack gets a warning of its own, because
 * a player without Opus in MP4 plays the pictures and not the sound.
 */
function filmNote(r) {
  const codec = !r.sound ? null : r.sound.codec === 'mp4a' ? 'AAC' : r.sound.codec;
  return r.frames + ' frames, ' + r.width + ' × ' + r.height + ', ' + r.seconds.toFixed(2) + ' s, '
    + Math.round(r.bytes / 1024) + ' kB' + (codec ? ', with an ' + codec + ' soundtrack' : '')
    // The encoder route converts inside the encoder; its time is the frame copies and test patterns.
    + (r.conversion === 'encoder' ? '. Colour converted by the encoder, its range proved by test patterns; ' + r.convertMs + ' ms copying frames and testing.'
      : '. Colour converted on the ' + r.conversion.toUpperCase() + ' in ' + r.convertMs + ' ms.') + ' Drawn in ' + r.drawMs + ' ms, '
    + r.totalMs + ' ms in all (' + r.realtime + 'x real time).'
    + (codec === 'Opus' ? ' This browser encodes no AAC, so the soundtrack is Opus: play the film where Opus in MP4 is supported, or it plays silent.' : '');
}

/**
 * Judge a film by what its file holds: every declared frame, evenly spaced.
 *
 * A film once passed frames written, frames received AND duration, and still
 * played in bursts -- thirty frames in forty milliseconds, then a one-second
 * freeze, ten times over. Spacing is the only thing
 * "fluid" means, so it is asserted here and not merely reported.
 *
 * The three bounds sit outside everything a good film measured: median 33.3 to
 * 33.6 ms against a 33.33 ms budget, p95 37.6, and one max of 65.3.
 *
 * `pace.worstLagMs` is how far the write loop fell behind its own schedule. A
 * recorder stamps frames by the wall clock, so a piece that draws slower than
 * its frame rate cannot be recorded at all. That is a different fault from a
 * lost picture, with a different fix, and the message names it.
 */
function filmVerdict(expected, hz, times, pace) {
  const budget = 1000 / hz;
  const gaps = times.slice(1).map((ms, i) => ms - times[i]).sort((a, b) => a - b);
  const at = (q) => (gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(q * gaps.length))] : 0);
  const v = {
    frames: times.length, expected, hz,
    seconds: times.length ? (times[times.length - 1] - times[0] + budget) / 1000 : 0,
    budgetMs: budget, medianGapMs: at(0.5), p95GapMs: at(0.95), maxGapMs: at(1),
  };
  const slow = pace && pace.worstLagMs > budget
    ? ` The export fell ${pace.worstLagMs.toFixed(0)} ms behind its schedule against a ${budget.toFixed(1)} ms frame budget: `
      + 'this piece draws slower than real time, and a recorder that stamps frames by the wall clock cannot keep them. '
      + 'Export MP4 from a browser that encodes H.264, which keeps every frame at its own time. Nothing was saved.'
    : null;
  if (v.frames !== expected) {
    if (slow) throw new Error(`the file holds ${v.frames} of ${expected} frames.${slow}`);
    // WHERE it went is the first thing anyone needs, and the gaps already say:
    // a picture lost mid-film leaves a hole twice the budget wide, and one lost
    // at either end leaves none.
    const where = !gaps.length ? 'that is too few to say where the rest went' : v.maxGapMs > budget * 1.5
      ? `the widest gap is ${v.maxGapMs.toFixed(1)} ms against a budget of ${budget.toFixed(1)} ms, so pictures went missing mid-film`
      : 'the gaps are even, so they went missing at an end';
    throw new Error(`the file holds ${v.frames} of ${expected} frames, and ${where}. This film is missing pictures rather than slow. Nothing was saved.`);
  }
  // One recorded frame has no spacing interval. Keep the numeric gap report at
  // zero, but only accept it after checking the exact declared frame count.
  if (expected === 1) return v;
  if (Math.abs(v.medianGapMs - budget) > budget * 0.1 || v.p95GapMs > budget * 1.5 || v.maxGapMs > budget * 3) {
    const spacing = `the frame spacing is uneven: median ${v.medianGapMs.toFixed(1)} ms, p95 ${v.p95GapMs.toFixed(1)} ms, `
      + `max ${v.maxGapMs.toFixed(1)} ms against a budget of ${budget.toFixed(1)} ms.`;
    if (slow) throw new Error(spacing + slow);
    throw new Error(`${spacing} Every frame is there and the film would still judder. Nothing was saved.`);
  }
  return v;
}

// The one decision behind the film controls, the WebM note and filmOffer():
// which film this browser can make of the piece and, where it is not the MP4,
// why. H.264 decides first: without it the silent recorder is the only film,
// whatever the soundtrack encoders say.
function filmChoice(p, encodesH264, encodesSound) {
  if (!p.time) return { format: null, reason: 'still' };
  if (!encodesH264) return { format: 'webm', reason: 'h264' };
  if (!encodesSound) return { format: 'webm', reason: 'soundtrack' };
  return { format: 'mp4', reason: null };
}

/** What is said of the WebM film on offer, for filmChoice's reason. */
function webmNote(p, reason) {
  var frames = render.playheads(p).length + ' frames, recorded in real time';
  return (reason === 'soundtrack'
    ? frames + '. The film is silent: this browser encodes neither AAC nor Opus for the soundtrack'
      + ' the piece declares, and an MP4 is never written without it.'
    : frames + ' and without sound, because this browser cannot encode the MP4 film.')
    + ' A piece slower than its frame rate cannot be recorded this way.';
}

/**
 * The film this browser can make of `p`: a promise of filmChoice's answer.
 * MP4 wherever this browser encodes the piece's H.264 configuration -- the one
 * core/film.js picks at the default scale, filmScale. The MP4 export never
 * writes a film without the soundtrack a piece declares, so where the browser
 * encodes neither AAC nor Opus, a piece with sound is offered a silent WebM.
 * `asked` keeps the encoders' answers between calls: the video encoder is asked
 * once per size and frame rate, the audio encoder once.
 */
function filmOffer(p, asked) {
  var h264 = null, voiced = true;
  if (p.time) {
    var key = p.size.w + 'x' + p.size.h + '@' + p.time.hz;
    if (!asked[key]) {
      asked[key] = typeof VideoEncoder !== 'function' || typeof VideoFrame !== 'function' ? Promise.resolve(false)
        : film.filmConfig(p, VideoEncoder, { scale: film.filmScale(p) }).then(function (config) { return !!config; }, function () { return false; });
    }
    h264 = asked[key];
  }
  if (p.time && p.sound) {
    if (!asked.sound) {
      asked.sound = typeof AudioEncoder !== 'function' || typeof AudioData !== 'function' ? Promise.resolve(false)
        : film.soundConfig(AudioEncoder).then(function (config) { return !!config; }, function () { return false; });
    }
    voiced = asked.sound;
  }
  return Promise.all([h264, voiced]).then(function (answers) { return filmChoice(p, answers[0], answers[1]); });
}

/**
 * The recipe for frame `t` of a solve, with the QUANTISED playhead -- the frame
 * that is drawn, not the one asked for. A saved SVG carries it as renderVector's
 * does; a saved PNG carries it with its scale.
 */
function recipe(p, s, t) {
  return s ? Object.assign({}, s.manifest, { t: piece.frameT(p, t) }) : null;
}

/**
 * Frame `t` as a PNG drawn `k` times over, carrying its recipe and the scale: a
 * piece may draw finer detail at a higher one. The raster backend, entire: an
 * offscreen canvas at any scale, not capped. Drawn when called; a promise of
 * the Blob.
 */
function png(p, s, t, k) {
  var manifest = Object.assign(recipe(p, s, t), { scale: k });
  var o = document.createElement('canvas');
  o.width = Math.round(p.size.w * k);
  o.height = Math.round(p.size.h * k);
  render.drawFrame(o.getContext('2d'), p, s, t, { scale: k });
  return new Promise(function (resolve, reject) {
    o.toBlob(function (blob) { if (blob) resolve(blob); else reject(new Error('the browser could not encode a ' + o.width + ' x ' + o.height + ' PNG')); });
  }).then(function (blob) { return blob.arrayBuffer(); }).then(function (buf) {
    return new Blob([pngWithManifest(new Uint8Array(buf), manifest)], { type: 'image/png' });
  });
}

/** Frame `t` as SVG text carrying its recipe; a piece that declares raster only is refused by name. */
function svg(p, s, t) {
  if (p.outputs.indexOf('vector') < 0) throw new Error('export: piece "' + p.name + '" declares raster only, so it has no SVG');
  var g = new VectorSurface(p.size);
  render.drawFrame(g, p, s, t);
  g.setManifest(recipe(p, s, t));
  return g.toSVG();
}

// THE REAL-TIME WEBM, offered only where the MP4 below cannot be encoded (see
// filmOffer). It walks playheads(piece) -- the piece's OWN frame list
// -- and hands each drawn frame to the encoder itself, so the file holds the
// frames the piece declares rather than the ones the machine managed to paint.
//
// A canvas capture stream follows compositor updates and may omit frames.
// Background timer throttling can also bunch frames together. The exporter
// supplies each frame directly and paces it with MessageChannel macrotasks.
//
// It saves nothing itself and judges the FILE, not the loop: filmVerdict reads
// the blocks the recorder actually wrote, and throws on a missing frame or on
// uneven spacing. The report names the file `name`-seed.webm.
async function webm(p, s, name) {
  if (!p || !p.time) throw new Error('this piece is a still: there is no frame list to walk');
  if (typeof MediaStreamTrackGenerator !== 'function') {
    throw new Error('this browser has no MediaStreamTrackGenerator, and the frame-exact export needs it: a canvas captureStream is paced by the compositor and silently drops most of the film');
  }
  var heads = render.playheads(p), hz = p.time.hz;
  var off = document.createElement('canvas');
  off.width = p.size.w;
  off.height = p.size.h;
  var octx = off.getContext('2d');
  // The recorder is handed a copy of each drawn frame, on a canvas nothing reads
  // back. A piece may read its own canvas, and three read-backs move a canvas to
  // memory for good; Edge's recorder then codes the rest of the film in full
  // range while the Colour element it wrote at the first frame still says
  // limited. The copy keeps every frame on the backing the film started with.
  var copy = document.createElement('canvas');
  copy.width = off.width;
  copy.height = off.height;
  var cctx = copy.getContext('2d');
  var track = new MediaStreamTrackGenerator({ kind: 'video' });
  var writer = track.writable.getWriter();
  var rec = new MediaRecorder(new MediaStream([track]), { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 8000000 });
  var chunks = [], onData = null;
  rec.ondataavailable = function (e) {
    if (e.data && e.data.size) chunks.push(e.data);
    if (onData) onData();
  };
  var finished = new Promise(function (r) { rec.onstop = r; });
  rec.start();

  var mc = new MessageChannel();
  var macro = function () {
    return new Promise(function (r) { mc.port1.onmessage = function () { r(); }; mc.port2.postMessage(0); });
  };

  // Render and encode are timed separately so encoder cost cannot hide draw cost.
  function renderFrame(i) {
    octx.clearRect(0, 0, off.width, off.height);
    render.drawFrame(octx, p, s, heads[i]);
  }
  // How many frames the file holds SO FAR, from the recorder's own bytes.
  async function held() {
    await new Promise(function (r) { onData = r; rec.requestData(); });
    onData = null;
    return webmBlockTimes(new Uint8Array(await new Blob(chunks).arrayBuffer())).length;
  }
  // Without its alpha plane, as the MP4 composites translucency over black. A
  // film that keeps one is decoded and scaled on another path in Edge, and a
  // player showing it at another size loses up to 11 dB against the drawing.
  async function encodeFrame(i) {
    cctx.clearRect(0, 0, copy.width, copy.height);
    cctx.drawImage(off, 0, 0);
    var f = new VideoFrame(copy, { timestamp: Math.round((i * 1000000) / hz), alpha: 'discard' });
    await writer.write(f);
    f.close();
  }

  var t0 = performance.now(), renderMs = 0, encodeMs = 0, worstLagMs = 0;
  try {
    for (var i = 0; i < heads.length; i++) {
      // Paced to the piece's own rate: MediaRecorder stamps blocks by the wall
      // clock, not by the timestamp on the frame handed to it, so a loop that
      // is not paced writes a film that plays in a fraction of its length.
      var due = t0 + (i * 1000) / hz;
      while (performance.now() < due) await macro();
      var a = performance.now();
      renderFrame(i);
      var b = performance.now();
      await encodeFrame(i);
      renderMs += b - a;
      encodeMs += performance.now() - b;
      // How late this frame left against its slot: the one number that tells a
      // slow piece from a lost picture.
      worstLagMs = Math.max(worstLagMs, performance.now() - due);
    }
    // Drain recorded data until every frame is present before stopping the
    // recorder. Encoder latency varies with the host; the two-second deadline
    // bounds the wait when a frame never arrives.
    var give = performance.now() + 2000;
    while ((await held()) < heads.length && performance.now() < give) await macro();
  } finally {
    try { await writer.close(); } catch (e) { /* the track may already be closed */ }
    rec.stop();
    await finished;
  }

  var bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
  var report = filmVerdict(heads.length, hz, webmBlockTimes(bytes), { worstLagMs: worstLagMs });
  // Judged as recorded, saved with the length it has, frames / hz, and the
  // recipe an MP4 of the same film carries: drawn at the design size, scale 1.
  var manifest = Object.assign({}, s.manifest, { film: { frames: heads.length, hz: hz, loop: !!p.time.loop, scale: 1 } });
  var blob = new Blob([webmWithManifest(webmWithDuration(bytes, heads.length / hz), manifest)], { type: 'video/webm' });
  report.bytes = blob.size;
  report.manifest = manifest;
  report.renderMs = renderMs;
  report.encodeMs = encodeMs;
  report.worstLagMs = worstLagMs;
  report.name = name + '-' + s.seed + '.webm';
  report.blob = blob;
  return report;
}

// THE FRAME-EXACT MP4. core/film.js draws every frame into its own canvas and
// hands it to the encoder with its own timestamp, so nothing here is paced and
// a piece slower than its frame rate still exports every frame. This hands it
// the browser's encoders; core/film.js takes them passed in, which is what lets
// the same path run in Node against controlled stand-ins.
//
// Unless opts.scale names one, the film is drawn with its long edge at 1920
// pixels at least; opts.bitrate, in bit/s, replaces the default core/film.js
// derives from the frame size and rate. core/film.js refuses either by name.
// The report names the file `name`-seed-WxH.mp4.
async function mp4(p, s, name, opts) {
  if (!p || !p.time) throw new Error('this piece is a still: there is no frame list to walk');
  var scale = opts && opts.scale !== undefined ? opts.scale : film.filmScale(p);
  var mc = typeof MessageChannel === 'function' ? new MessageChannel() : null;
  var result = await film.exportFilm(p, s, {
    VideoEncoder: typeof VideoEncoder === 'function' ? VideoEncoder : undefined,
    VideoFrame: typeof VideoFrame === 'function' ? VideoFrame : undefined,
    VideoDecoder: typeof VideoDecoder === 'function' ? VideoDecoder : undefined,
    EncodedVideoChunk: typeof EncodedVideoChunk === 'function' ? EncodedVideoChunk : undefined,
    AudioEncoder: typeof AudioEncoder === 'function' ? AudioEncoder : undefined,
    AudioData: typeof AudioData === 'function' ? AudioData : undefined,
    OfflineAudioContext: typeof OfflineAudioContext === 'function' ? OfflineAudioContext : undefined,
    createCanvas: function (w, h) { var o = document.createElement('canvas'); o.width = w; o.height = h; return o; },
    now: function () { return performance.now(); },
    // A macrotask, not a timer: a timer is clamped to a second in a hidden page.
    pause: mc ? function () {
      return new Promise(function (r) { mc.port1.onmessage = function () { r(); }; mc.port2.postMessage(0); });
    } : undefined,
  }, { scale: scale, bitrate: opts && opts.bitrate, onProgress: opts && opts.onProgress });
  var report = result.report;
  report.name = name + '-' + s.seed + '-' + report.width + 'x' + report.height + '.mp4';
  report.blob = new Blob([result.bytes], { type: 'video/mp4' });
  return report;
}

/** Hand `blob` to the browser as a download named `name`. */
function save(blob, name) {
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
}

module.exports = {
  ebmlHead, ebmlResize, crc32, webmInsert, webmBlockTimes, webmWithDuration, webmWithManifest, webmManifest,
  pngWithManifest, pngManifest, filmNote, filmVerdict, filmChoice, webmNote, filmOffer, recipe, png, svg, webm, mp4, save,
};
