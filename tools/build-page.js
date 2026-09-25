#!/usr/bin/env node
'use strict';

// Build one self-contained HTML file: the live backend, the raster backend and
// the transport, around whichever pieces are handed to it.
//
// WHY A BUILD STEP RATHER THAN A DIFFERENT MODULE FORMAT. The single-file
// constraint is a DELIVERY target, not an authoring constraint. The core stays
// plain CommonJS that `node --test` runs directly, and this file pays the one
// cost of making it reachable from a browser.
//
// No dependencies, node: built-ins only.

const fs = require('node:fs');
const path = require('node:path');
const { loadExternal } = require('./piece-input.js');

const ROOT = path.join(__dirname, '..');
/**
 * The modules to bundle, DISCOVERED rather than listed.
 *
 * Deriving the list from the directories includes newly added examples and
 * their helper modules without a second registry to keep in sync.
 */
function modules() {
  const files = (dir) => fs.readdirSync(path.join(ROOT, dir))
    .filter((f) => f.endsWith('.js'))
    .sort()
    .map((f) => dir + '/' + f);
  // index.js last: it requires the others.
  return [
    ...files('core'),
    ...files('examples').filter((f) => f !== 'examples/index.js'),
    'examples/index.js',
  ];
}

const MODULES = modules();

/**
 * Resolve every require inside every bundled module exactly as the page's own
 * __resolve does, and refuse to write a bundle with a hole in it.
 *
 * Discovery above removes the fault class; this catches what discovery cannot:
 * a typo, or a module reaching outside the bundled directories. A build that
 * cannot produce a working page must say so instead of exiting 0.
 */
function checkResolvable(ids) {
  const have = new Set(ids);
  const bad = [];
  for (const id of ids) {
    if (!MODULES.includes(id)) { bad.push(id + ' is asked for, but it is not a module in core/ or examples/'); continue; }
    for (const [spec, target] of requires(id)) {
      if (!have.has(target)) bad.push(id + ' requires ' + spec + ' -> ' + target + ', which is not bundled');
    }
  }
  if (bad.length) {
    throw new Error('build: this page would throw on load and render nothing.\n  ' + bad.join('\n  '));
  }
}

/** Each require in a library module, as [spec, id], resolved as the page's own __resolve does. */
function requires(id) {
  const resolve = (from, spec) => {
    if (spec[0] !== '.') return spec;
    const base = from.split('/').slice(0, -1);
    for (const part of spec.split('/')) {
      if (part === '.') continue;
      else if (part === '..') base.pop();
      else base.push(part);
    }
    return base.join('/');
  };
  const src = fs.readFileSync(path.join(ROOT, id), 'utf8');
  return [...src.matchAll(/require\('([^']+)'\)/g)].filter((m) => !m[1].startsWith('node:')).map((m) => [m[1], resolve(id, m[1])]);
}

/**
 * The library modules `ids` reach, themselves included, in bundle order: what
 * a bundle needs for a caller that requires only those. An id outside the
 * library is left in, so checkResolvable names it rather than this dropping it.
 */
function reach(ids) {
  const found = new Set();
  const visit = (id) => {
    if (found.has(id)) return;
    found.add(id);
    if (MODULES.includes(id)) for (const [, target] of requires(id)) visit(target);
  };
  ids.forEach(visit);
  return MODULES.filter((id) => found.has(id)).concat([...found].filter((id) => !MODULES.includes(id)));
}

function wrap(rel) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  // A module containing a literal </script would end the tag early and the page
  // would be silently truncated. Refuse rather than ship half a file.
  if (/<\/script/i.test(src)) throw new Error(`build: ${rel} contains a literal </script`);
  return `__def(${JSON.stringify(rel)}, function (module, exports, require) {\n${src}\n});`;
}

const RUNTIME = `
var __mods = {}, __cache = {};
function __def(id, fn) { __mods[id] = fn; }
function __resolve(from, spec) {
  if (spec[0] !== '.') return spec;
  var base = from.split('/').slice(0, -1);
  for (var i = 0, p = spec.split('/'); i < p.length; i++) {
    if (p[i] === '.') continue;
    else if (p[i] === '..') base.pop();
    else base.push(p[i]);
  }
  return base.join('/');
}
function __require(from) {
  return function (spec) {
    var id = __resolve(from, spec);
    if (__cache[id]) return __cache[id].exports;
    var fn = __mods[id];
    if (!fn) throw new Error('module not bundled: ' + id + ' (from ' + from + ')');
    var m = __cache[id] = { exports: {} };
    fn(m, m.exports, __require(id));
    return m.exports;
  };
}
`;

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
 * It lives out here, and the page gets its source, so that `node --test` can
 * reach it. Nothing inside the page body can be reached that way.
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

function html(bundle, options = {}) {
  // Counted, never written out: the word "Five" shipped in the delivered page
  // for as long as there were five examples, and stayed there when there were six.
  const count = options.count === undefined ? MODULES.filter((m) => m.startsWith('examples/')
    && m !== 'examples/index.js' && m !== 'examples/stroke-font.js').length : options.count;
  const description = options.count === undefined
    ? count + " idioms that break each other's assumptions. The seed and the playhead are the only inputs."
    : 'Adjust the seed, playhead and declared parameters of your piece.';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Artifex examples</title>
<style>
  :root {
    --bg: #14151a; --panel: #1c1e25; --line: #2e313b;
    --fg: #e7e4dc; --dim: #8e8f99; --accent: #d8a24a;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font-size: 13px; }
  .wrap { display: flex; min-height: 100vh; }
  aside { width: 320px; flex: none; background: var(--panel); border-right: 1px solid var(--line);
          padding: 18px; overflow-y: auto; height: 100vh; position: sticky; top: 0; }
  main { flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px; min-width: 0; }
  canvas { max-width: 100%; max-height: calc(100vh - 48px); background: #fff;
           box-shadow: 0 10px 40px rgba(0,0,0,.5); }
  h1 { font-size: 13px; letter-spacing: .18em; margin: 0 0 4px; text-transform: uppercase; }
  .sub { color: var(--dim); margin: 0 0 18px; line-height: 1.5; font-size: 11px; }
  .group { border-top: 1px solid var(--line); padding-top: 14px; margin-top: 14px; }
  .label { color: var(--dim); text-transform: uppercase; letter-spacing: .12em; font-size: 10px; margin-bottom: 8px; }
  button { font: inherit; background: #262932; color: var(--fg); border: 1px solid var(--line);
           padding: 6px 10px; cursor: pointer; border-radius: 3px; }
  button:hover:not(:disabled) { border-color: var(--accent); }
  button:disabled { opacity: .35; cursor: not-allowed; }
  button.on { background: var(--accent); color: #14151a; border-color: var(--accent); }
  .pieces { display: grid; gap: 6px; }
  .pieces button { text-align: left; }
  .pieces .kind { color: var(--dim); font-size: 10px; display: block; margin-top: 2px; }
  .pieces button.on .kind { color: #14151a; opacity: .75; }
  .row { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
  input[type=number] { font: inherit; width: 100px; background: #262932; color: var(--fg);
                       border: 1px solid var(--line); padding: 5px 7px; border-radius: 3px; }
  input[type=range] { width: 100%; accent-color: var(--accent); }
  #previewMode { font: inherit; color: var(--fg); background: #262932; border: 1px solid #737681;
                 border-radius: 3px; min-height: 32px; padding: 5px 7px; width: 100%; }
  #previewMode:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  #previewStatus { color: var(--fg); }
  .facts { color: var(--dim); line-height: 1.7; font-size: 11px; }
  .facts b { color: var(--fg); font-weight: normal; }
  .meaning { color: var(--dim); font-size: 10px; line-height: 1.5; opacity: .75;
             margin: 0 0 3px 1px; }
  .note { color: var(--dim); font-size: 10px; line-height: 1.5; margin-top: 8px; }
  .err { color: #e8705a; white-space: pre-wrap; line-height: 1.5; font-size: 11px; }
  a { color: var(--accent); }
  /* The live player: the piece alone, at the size of whatever frame holds the page. */
  body.player aside { display: none; }
  body.player main { position: fixed; inset: 0; padding: 0; }
  body.player canvas { max-width: none; max-height: none; box-shadow: none; cursor: pointer; }
</style>
</head>
<body>
<div class="wrap">
  <aside>
    <h1>Artifex</h1>
    <p class="sub">${description}</p>

    <div class="pieces" id="pieces"></div>

    <div class="group">
      <div class="label">Seed</div>
      <div class="row">
        <input type="number" id="seed" min="0" step="1">
        <button id="reroll">re-roll</button>
      </div>
      <div class="label" style="margin-top:12px">Playhead</div>
      <div class="row">
        <button id="play">play</button>
        <span id="tread" class="facts"></span>
      </div>
      <input type="range" id="t" min="0" max="1000" value="0">
      <div class="note"><a id="playerLink" href="?player=1">Open in the live player</a>: the piece alone, fitted to the window.</div>
    </div>

    <div class="group" id="paramsGroup" hidden>
      <div class="label">Declared parameters</div>
      <div id="params"></div>
    </div>

    <div class="group" id="boxGroup" hidden>
      <div class="label">Box</div>
      <div id="boxes"></div>
      <div class="note">This piece recomposes to its box. Exports draw at it and their recipes record it.</div>
    </div>

    <div class="group" id="previewGroup" hidden>
      <label class="label" for="previewMode">Preview renderer</label>
      <select id="previewMode" aria-describedby="previewStatus">
        <option value="cpu">CPU reference</option>
        <option value="gpu">GPU preview</option>
      </select>
      <div class="note" id="previewStatus" role="status" aria-live="polite">CPU reference. Exports always use CPU.</div>
    </div>

    <div class="group">
      <div class="label">Outputs</div>
      <div class="row">
        <button data-png="1">PNG 1x</button>
        <button data-png="4">PNG 4x</button>
        <button data-png="8">PNG 8x</button>
      </div>
      <div class="row"><button id="svg">SVG</button></div>
      <div class="note" id="svgnote"></div>
      <div id="mp4">
        <div class="row" style="margin-top:10px">
          <button id="film1" data-film="" title="Long edge at 1920 pixels or more">MP4</button>
          <button id="film2" data-film="1" title="The design box, for a quick draft">MP4 1x</button>
        </div>
        <div class="note" id="filmnote"></div>
      </div>
      <div id="webm" hidden>
        <div class="row" style="margin-top:10px"><button id="video">WebM video</button></div>
        <div class="note" id="videonote"></div>
      </div>
    </div>

    <div class="group">
      <div class="label">Measured</div>
      <div class="facts" id="facts"></div>
      <div class="err" id="err"></div>
    </div>
  </aside>
  <main><canvas id="c"></canvas></main>
</div>

<script>
// Everything is inside one function. window.__artifex is the ONLY global the
// page publishes, because the moment a page hands out a test hook, someone
// drives it from a console script -- and a bare top-level "var render" is
// clobbered by the first helper of that name. That happened within minutes of
// the hook existing, and it looked exactly like a library bug.
(function () {
${RUNTIME}
${bundle}

var __req = __require('');
var piece = __req('core/piece.js');
var render = __req('core/render.js');
var vector = __req('core/surface-vector.js');
var gpuPreview = __req('core/webgpu-preview.js');
var film = __req('core/film.js');
var EXAMPLES = __req('examples/index.js');

var names = Object.keys(EXAMPLES);
// base is the piece as declared; current is base at the box chosen for it.
var base = null, current = null, currentName = null, solved = null, t = 0, playing = false, overrides = {}, raf = 0, videoBusy = false, filmBusy = false;
// The live player shows the piece alone, fitted to the window, and a piece that
// declares boxes takes the window's box. view is device pixels per design unit.
var player = /(^|[?&])player=1(&|$)/.test(String(location.search || '')), view = 1;
var filmButtons = [document.getElementById('film1'), document.getElementById('film2')];
var c = document.getElementById('c'), ctx = c.getContext('2d');
var facts = document.getElementById('facts'), err = document.getElementById('err');
var previewMode = 'cpu', previewSession = null, previewPending = null, previewLoop = null;
var frameRevision = 0, transportRevision = 0;
var previewInfo = { mode: 'cpu', status: 'reference', presented: null };

function previewStatus(message) {
  var node = document.getElementById('previewStatus');
  if (node.textContent !== message) node.textContent = message;
}

function makePreviewSession() {
  var session = gpuPreview.createPreview({
    gpu: typeof navigator === 'undefined' ? null : navigator.gpu,
    createCanvas: function () { return document.createElement('canvas'); },
    onLoss: function (message) { if (previewSession === session) previewFallback(message); },
  });
  return session;
}

function resetPreview() {
  frameRevision++;
  previewPending = null;
  if (previewSession) previewSession.dispose();
  previewSession = null;
  previewMode = 'cpu';
  document.getElementById('previewMode').value = 'cpu';
  previewInfo = { mode: 'cpu', status: 'reference', presented: null };
  previewStatus('CPU reference. Exports always use CPU.');
}

function previewFallback(message) {
  resetPreview();
  previewInfo.status = 'fallback';
  previewInfo.reason = message;
  previewStatus('CPU fallback: ' + message + '. Choose GPU preview to retry. Exports use CPU.');
  frame();
}

function setPreview(mode) {
  if (mode !== 'cpu' && mode !== 'gpu') throw new Error('preview renderer must be cpu or gpu');
  if (mode === 'gpu' && (!current || !current.preview)) throw new Error('this piece has no GPU preview');
  stop();
  resetPreview();
  previewMode = mode;
  document.getElementById('previewMode').value = mode;
  if (mode === 'gpu') {
    previewInfo = { mode: 'gpu', status: 'preparing', presented: null };
    previewStatus('Preparing GPU preview. Exports always use CPU.');
  }
  return frame();
}

document.getElementById('previewMode').onchange = function () { setPreview(this.value); };
if (window.addEventListener) window.addEventListener('pagehide', resetPreview);

function kindOf(p) {
  return (p.time ? Math.round(p.time.duration * p.time.hz) + ' frames' : 'a still')
    + ' \\u00b7 ' + p.outputs.join(' + ');
}

var box = document.getElementById('pieces');
names.forEach(function (n) {
  var b = document.createElement('button');
  b.innerHTML = n + '<span class="kind">' + kindOf(piece.validate(EXAMPLES[n])) + '</span>';
  b.onclick = function () { select(n); };
  b.dataset.name = n;
  box.appendChild(b);
});

function select(name) {
  stop();
  resetPreview();
  err.textContent = '';
  // The piece is never decorated. playheads() validates whatever it is handed
  // and a stowaway key is refused BY NAME -- which is the contract working, so
  // the name lives beside the piece rather than on it.
  base = current = piece.validate(EXAMPLES[name]);
  currentName = name;
  document.getElementById('previewGroup').hidden = !current.preview;
  overrides = {};
  document.getElementById('seed').value = current.seed;
  sizeCanvas();
  buildBox();
  t = current.time ? 0 : 0;
  document.getElementById('t').value = 0;
  document.getElementById('t').disabled = !current.time;
  document.getElementById('play').disabled = !current.time;
  var can = current.outputs.indexOf('vector') >= 0;
  document.getElementById('svg').disabled = !can;
  document.getElementById('svgnote').textContent = can
    ? 'Declared vector: any raster call would throw by name rather than vanish.'
    : 'This piece declares raster only, and means it. Asking for SVG is refused rather than answered with half a picture.';
  document.getElementById('video').disabled = !current.time || videoBusy;
  document.getElementById('videonote').textContent = current.time ? webmNote(current, 'h264') : '';
  Array.prototype.forEach.call(filmButtons, function (b) { b.disabled = !current.time || filmBusy; });
  document.getElementById('filmnote').textContent = current.time
    ? render.playheads(current).length + ' frames, each encoded at its own time however long it takes to draw'
      + (current.sound ? ', with the soundtrack the piece declares.' : '.')
    : 'A still has no frame list to walk, so there is no film to write.';
  offerFilm();
  Array.prototype.forEach.call(box.children, function (b) { b.classList.toggle('on', b.dataset.name === name); });
  buildParams();
  resolve();
}

// THE FILM ON OFFER. MP4 is the film export wherever this browser encodes the
// piece's H.264 configuration -- the one core/film.js picks at the default
// scale, filmScale. Only where it cannot does the page offer the real-time WebM recorder, which loses frames on
// a piece slower than real time and carries no sound. The MP4 export never
// writes a film without the soundtrack a piece declares, so where the browser
// encodes neither AAC nor Opus, a piece with sound is offered a silent WebM. The
// video encoder is asked once per size and frame rate, the audio encoder once,
// and nothing waits for either: MP4 shows until they answer.
var h264 = {}, aacOrOpus = null, filmOffer = null;

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

function webmNote(p, reason) {
  var frames = render.playheads(p).length + ' frames, recorded in real time';
  return (reason === 'soundtrack'
    ? frames + '. The film is silent: this browser encodes neither AAC nor Opus for the soundtrack'
      + ' the piece declares, and an MP4 is never written without it.'
    : frames + ' and without sound, because this browser cannot encode the MP4 film.')
    + ' A piece slower than its frame rate cannot be recorded this way.';
}

function offerFilm() {
  var p = current, asked = null, voiced = true;
  if (p.time) {
    var key = p.size.w + 'x' + p.size.h + '@' + p.time.hz;
    if (!h264[key]) {
      h264[key] = typeof VideoEncoder !== 'function' || typeof VideoFrame !== 'function' ? Promise.resolve(false)
        : film.filmConfig(p, VideoEncoder, { scale: film.filmScale(p) }).then(function (config) { return !!config; }, function () { return false; });
    }
    asked = h264[key];
  }
  if (p.time && p.sound) {
    if (!aacOrOpus) {
      aacOrOpus = typeof AudioEncoder !== 'function' || typeof AudioData !== 'function' ? Promise.resolve(false)
        : film.soundConfig(AudioEncoder).then(function (config) { return !!config; }, function () { return false; });
    }
    voiced = aacOrOpus;
  }
  document.getElementById('mp4').hidden = false;
  document.getElementById('webm').hidden = true;
  filmOffer = Promise.all([asked, voiced]).then(function (answers) {
    var choice = filmChoice(p, answers[0], answers[1]);
    // An answer about a piece no longer selected says nothing about this one.
    if (p === current) {
      document.getElementById('mp4').hidden = choice.format === 'webm';
      document.getElementById('webm').hidden = choice.format !== 'webm';
      if (choice.format === 'webm') document.getElementById('videonote').textContent = webmNote(p, choice.reason);
    }
    return choice;
  });
}

function buildParams() {
  var host = document.getElementById('params');
  var keys = Object.keys(current.params);
  document.getElementById('paramsGroup').hidden = keys.length === 0;
  host.innerHTML = '';
  keys.forEach(function (k) {
    var d = current.params[k];
    // An override already in hand wins over the declared default -- otherwise a
    // link that names a parameter opens with the right picture and the wrong
    // slider, and the panel is lying about the thing it is there to show.
    var at = k in overrides ? overrides[k] : d.value;
    var lab = document.createElement('div');
    lab.className = 'facts';
    lab.textContent = k + ' ';
    var val = document.createElement('b');
    val.textContent = at;
    lab.appendChild(val);
    // What the knob DOES, from the piece's own declaration. A slider labelled
    // only with its name asks the reader to guess, and a reader that cannot
    // read the source -- an agent, or anyone a page is handed to -- cannot.
    var why = document.createElement('div');
    why.className = 'meaning';
    why.textContent = d.meaning;
    var r = document.createElement('input');
    r.type = 'range';
    r.min = d.min; r.max = d.max;
    r.step = (d.max - d.min) / 200;
    r.value = at;
    r.oninput = function () {
      overrides[k] = Number(r.value);
      val.textContent = Number(r.value).toFixed(2);
      resolve();
    };
    host.appendChild(lab);
    host.appendChild(why);
    host.appendChild(r);
  });
}

// THE BOX. A piece that declares boxes is drawn at the one chosen for it, and
// solved again for it, so it recomposes rather than stretches. Exports read
// current.size, so they draw at the chosen box and their recipes record it.
function sizeCanvas() {
  view = 1;
  if (player) {
    // One design unit is one CSS pixel while the box fits the window; a box
    // that cannot, such as a fixed piece's, is fitted whole. The backing store
    // has the device's pixels, so the player is sharp at any zoom.
    var fit = Math.min(window.innerWidth / current.size.w, window.innerHeight / current.size.h);
    view = fit * (window.devicePixelRatio || 1);
    c.style.width = current.size.w * fit + 'px';
    c.style.height = current.size.h * fit + 'px';
  }
  c.width = Math.round(current.size.w * view);
  c.height = Math.round(current.size.h * view);
}

function setBox(w, h) {
  // atBox refuses a box outside the declared ranges by name, and leaves the
  // piece as it was.
  current = piece.atBox(base, { w: w, h: h });
  sizeCanvas();
  offerFilm();
  resolve();
}

function buildBox() {
  var host = document.getElementById('boxes');
  document.getElementById('boxGroup').hidden = !base.boxes;
  host.innerHTML = '';
  if (!base.boxes) return;
  [['w', 'width'], ['h', 'height']].forEach(function (axis) {
    var k = axis[0];
    var lab = document.createElement('div');
    lab.className = 'facts';
    lab.textContent = axis[1] + ' ';
    var val = document.createElement('b');
    val.textContent = current.size[k];
    lab.appendChild(val);
    var r = document.createElement('input');
    r.type = 'range';
    r.min = base.boxes[k][0]; r.max = base.boxes[k][1];
    r.step = 1;
    r.value = current.size[k];
    r.setAttribute('aria-label', 'box ' + axis[1]);
    r.oninput = function () {
      val.textContent = r.value;
      var box = { w: current.size.w, h: current.size.h };
      box[k] = Number(r.value);
      setBox(box.w, box.h);
    };
    host.appendChild(lab);
    host.appendChild(r);
  });
}

// The player's box is the window's, held inside the declared ranges.
function fitPlayer() {
  if (!current) return;
  if (base.boxes) {
    var clampTo = function (v, range) { return Math.min(range[1], Math.max(range[0], Math.round(v))); };
    var w = clampTo(window.innerWidth, base.boxes.w), h = clampTo(window.innerHeight, base.boxes.h);
    if (w !== current.size.w || h !== current.size.h) return setBox(w, h);
  }
  sizeCanvas();
  frame();
}

function buildControls(ready) {
  document.getElementById('previewMode').disabled = !ready;
  document.getElementById('play').disabled = !ready || !current.time;
  document.getElementById('t').disabled = !ready || !current.time;
  document.getElementById('svg').disabled = !ready || current.outputs.indexOf('vector') < 0;
  document.getElementById('video').disabled = !ready || !current.time || videoBusy;
  Array.prototype.forEach.call(filmButtons, function (b) { b.disabled = !ready || !current.time || filmBusy; });
  Array.prototype.forEach.call(document.querySelectorAll('[data-png]'), function (b) { b.disabled = !ready; });
}

function failBuild(message) {
  // A partial solve is diagnostic state, never a frame or an export recipe.
  solved = null;
  resetPreview();
  err.textContent = message;
  stop();
  buildControls(false);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  facts.innerHTML = '';
  document.getElementById('tread').textContent = '';
}

function resolve() {
  var t0 = performance.now();
  // A new solve has its own soundtrack: the old one stops and is dropped.
  soundtrack = null;
  silence();
  try {
    solved = piece.solve(current, Number(document.getElementById('seed').value), overrides);
    err.textContent = '';
  } catch (e) { failBuild(String(e.message)); return; }
  if (solved.stages.error) {
    var s = solved.stages.error;
    failBuild('build stage "' + s.stage + '" (' + (s.at + 1) + ' of ' + s.of + ') threw: ' + s.message);
    return;
  }
  solved.__ms = performance.now() - t0;
  if (previewMode === 'gpu') {
    ctx.clearRect(0, 0, c.width, c.height);
    previewInfo.presented = null;
  }
  buildControls(true);
  frame();
  // A parameter changed while playing: the transport plays on, so its sound
  // does too, from the new solve.
  if (playing) playSound(transportRevision);
}

function frame() {
  if (!solved) return;
  var revision = ++frameRevision;
  if (previewMode === 'gpu') {
    previewPending = { p: current, s: solved, t: t, revision: revision, width: c.width, height: c.height };
    previewInfo.requested = { seed: solved.seed, t: piece.frameT(current, t), params: Object.assign({}, solved.state.params) };
    if (!playing) {
      ctx.clearRect(0, 0, c.width, c.height);
      previewInfo.presented = null;
      toUrl();
    }
    if (previewLoop) return previewLoop;
    // One in-flight frame plus a replaceable latest request. Playback waits
    // for this loop so slow GPUs cannot be invalidated on every animation tick.
    previewLoop = (async function () {
      while (previewPending && previewMode === 'gpu') {
        var request = previewPending;
        previewPending = null;
        if (!previewSession) previewSession = makePreviewSession();
        var active = previewSession;
        try {
          var result = await active.draw(request.p, request.s, request.t, request.width, request.height, {
            isCurrent: function () { return previewMode === 'gpu' && previewSession === active && request.revision === frameRevision; },
            present: function (image) {
              ctx.setTransform(1, 0, 0, 1, 0, 0);
              ctx.drawImage(image, 0, 0);
            },
          });
          if (!result.stale && previewSession === active && request.revision === frameRevision) {
            previewInfo = { mode: 'gpu', status: 'active', presented: {
              seed: request.s.seed, t: result.t, params: Object.assign({}, request.s.state.params),
            }, timing: result };
            previewStatus('GPU preview is approximate. Exports always use CPU.');
            showFrame(result.t, result.totalMs, 'preview');
          }
        } catch (e) {
          if (previewSession === active) previewFallback(String(e.message || e));
        }
      }
    })().finally(function () { previewLoop = null; });
    return previewLoop;
  }
  var t0 = performance.now();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  var qt;
  try { qt = render.drawFrame(ctx, current, solved, t, { scale: view }); }
  catch (e) { err.textContent = String(e.message); stop(); return; }
  var ms = performance.now() - t0;
  previewInfo.presented = { seed: solved.seed, t: qt, params: Object.assign({}, solved.state.params) };
  showFrame(qt, ms, 'draw');
}

function showFrame(qt, ms, timingLabel) {
  document.getElementById('tread').textContent = current.time ? qt.toFixed(3) + ' of 1' : 'a still';
  facts.innerHTML = [
    'declared <b>' + current.outputs.join(' + ') + '</b>',
    'design box <b>' + current.size.w + ' \\u00d7 ' + current.size.h + '</b>',
    'seed <b>' + solved.seed + '</b>',
    'build <b>' + solved.__ms.toFixed(1) + ' ms</b> in <b>' + solved.stages.of + '</b> stage(s)',
    timingLabel + ' <b>' + ms.toFixed(1) + ' ms</b>',
    current.time ? 'frames <b>' + render.playheads(current).length + '</b>' : 'no timeline',
  ].join('<br>');
  if (!playing) toUrl();
}

function stop() {
  playing = false;
  transportRevision++;
  cancelAnimationFrame(raf);
  silence();
  var b = document.getElementById('play');
  b.classList.remove('on');
  b.textContent = 'play';
  toUrl();
}

// THE SOUNDTRACK IN THE TRANSPORT. Playing a piece that declares sound plays its
// soundtrack with the picture, so an author hears the two together while
// working. It is rendered once per solve, on the first play, by the renderSound
// the exports use, and started where the transport is. The transport's own
// clock still draws every frame: the audio clock is read only to start the
// sound, and every change to the transport stops it. Exports never touch it.
var listener = null;       // the page's AudioContext, made or resumed in the play click
var soundtrack = null;     // { solved, buffer: a promise of its AudioBuffer }
var voice = null;          // the one playing source, or null
var transportOrigin = 0;   // performance.now() at the transport's playhead 0

// A lap of the transport lasts the frame grid, frames / hz, as the soundtrack
// and the film do. A declared duration that is no whole number of frames would
// otherwise add a silence and an off-grid playhead at every wrap.
function lapMs(p) { return (render.playheads(p).length / p.time.hz) * 1000; }

function silence() {
  if (!voice) return;
  var v = voice;
  voice = null;
  try { v.stop(); } catch (e) { /* a source that never started cannot stop */ }
  v.disconnect();
}

// Start the soundtrack where the transport is once it is rendered, unless the
// transport or the solve has moved on by then.
function playSound(transport) {
  if (!listener || !current.sound || !solved) return;
  var s = solved;
  if (!soundtrack || soundtrack.solved !== s) {
    soundtrack = { solved: s, buffer: render.renderSound(current, s, {
      OfflineAudioContext: typeof OfflineAudioContext === 'function' ? OfflineAudioContext : undefined,
    }) };
  }
  var entry = soundtrack;
  entry.buffer.then(function (buffer) {
    if (!playing || transport !== transportRevision || solved !== s || soundtrack !== entry) return;
    silence();
    var dur = lapMs(current);
    // Where the picture is now, plus the time the sound takes to reach the
    // speakers, so the two are heard and seen together.
    var at = ((performance.now() - transportOrigin) % dur) / 1000 + (listener.outputLatency || listener.baseLatency || 0);
    var v = listener.createBufferSource();
    v.buffer = buffer;
    v.connect(listener.destination);
    v.start(0, Math.min(at, buffer.duration));
    voice = v;
  }, function (e) {
    if (soundtrack === entry) err.textContent = 'the soundtrack could not be rendered: ' + String(e.message || e);
  });
}

// THE ADDRESS BAR IS THE RECIPE. solve() knows the piece, the seed and every
// parameter at the moment it runs, and until now the page threw all of it away
// -- so a picture someone liked was gone on the next click, and there was no
// way to send one to anybody.
//
// replaceState rather than pushState: scrubbing a playhead would otherwise put
// a hundred entries in the back button, and the picture is a VIEW of this page,
// not a place you navigated to.
//
// Not called from frame() while playing. That runs once per animation frame,
// and a browser is entitled to throttle a page that rewrites its own URL sixty
// times a second. stop() calls it, so the address bar is right the moment
// anyone could act on it.
function toUrl() {
  if (!current) return;
  var q = ['piece=' + encodeURIComponent(currentName),
    'seed=' + encodeURIComponent(document.getElementById('seed').value)];
  if (current.time) q.push('t=' + t.toFixed(4));
  Object.keys(overrides).forEach(function (k) {
    q.push('p.' + encodeURIComponent(k) + '=' + encodeURIComponent(overrides[k]));
  });
  if (base.boxes) q.push('box=' + current.size.w + 'x' + current.size.h);
  document.getElementById('playerLink').href = '?' + q.concat('player=1').join('&');
  if (player) q.push('player=1');
  // Sandboxed documents and data URLs can refuse address-bar updates. The
  // recipe is optional persistence; a refusal must not interrupt the controls.
  try { history.replaceState(null, '', '?' + q.join('&')); }
  catch (e) { /* address-bar synchronization is best effort */ }
}

// Read it back. Every value is checked against the piece that is actually here
// rather than trusted: a URL is the one input to this page that arrives from
// outside it, and a stale link naming a parameter this build no longer declares
// would otherwise throw on load and leave a blank page.
function fromUrl() {
  // Escaped twice on purpose: this whole page body is a template literal, so a
  // single backslash is eaten before it ever reaches the browser. The first
  // draft of this line shipped /^?/ and the page died on load with "Nothing to
  // repeat" -- and the builder's module check cannot see that, because the
  // bundle resolved perfectly.
  var q = String(location.search || '').replace(/^\\?/, '');
  if (!q) return null;
  var out = { piece: null, seed: null, t: null, params: {}, box: null };
  q.split('&').forEach(function (kv) {
    var i = kv.indexOf('=');
    if (i < 0) return;
    var k = decodeURIComponent(kv.slice(0, i));
    var v = decodeURIComponent(kv.slice(i + 1));
    if (k === 'piece') out.piece = v;
    else if (k === 'seed' && /^[0-9]+$/.test(v)) out.seed = Number(v);
    else if (k === 't' && isFinite(Number(v))) out.t = Math.min(1, Math.max(0, Number(v)));
    else if (k.indexOf('p.') === 0 && isFinite(Number(v))) out.params[k.slice(2)] = Number(v);
    else if (k === 'box' && /^[0-9.]+x[0-9.]+$/.test(v)) out.box = { w: Number(v.split('x')[0]), h: Number(v.split('x')[1]) };
  });
  return out.piece ? out : null;
}

document.getElementById('play').onclick = function () {
  if (!solved || !current.time) return;
  if (playing) return stop();
  playing = true;
  this.classList.add('on');
  this.textContent = 'pause';
  var dur = lapMs(current);
  var transport = ++transportRevision;
  var t0 = performance.now() - t * dur;
  transportOrigin = t0;
  // A browser starts audio only inside a user gesture, so the context is made,
  // or woken, here in the click. A piece without sound never makes one.
  if (current.sound && typeof AudioContext === 'function') {
    if (!listener) listener = new AudioContext();
    if (listener.state === 'suspended') listener.resume();
  }
  playSound(transport);
  var lap = 0;
  (function step(now) {
    if (!playing) return;
    // The wall clock drives the TRANSPORT and nothing else. drawFrame quantises
    // the playhead to the drawn-frame grid, so no mark ever sees this number. A
    // frame stamped before the click would put it below 0, so it is held there.
    t = Math.max(0, (now - t0) % dur) / dur;
    // The transport wrapped, so the soundtrack starts again with it. Laps are
    // counted rather than playheads compared: an animation frame can be stamped
    // a little before the click that started the transport.
    var laps = Math.floor((now - t0) / dur);
    if (laps > lap) { lap = laps; playSound(transport); }
    document.getElementById('t').value = t * 1000;
    var pending = frame();
    function next() { if (playing && transport === transportRevision) raf = requestAnimationFrame(step); }
    if (pending && pending.then) pending.then(next); else next();
  })(performance.now());
};

document.getElementById('t').oninput = function () { stop(); t = Number(this.value) / 1000; frame(); };
document.getElementById('seed').onchange = function () { stop(); resolve(); };
document.getElementById('reroll').onclick = function () {
  stop();
  document.getElementById('seed').value = Math.floor(Math.random() * 4294967296);
  resolve();
};

Array.prototype.forEach.call(document.querySelectorAll('[data-png]'), function (b) {
  b.onclick = function () {
    if (!solved) return;
    // The raster backend, entire: an offscreen canvas at any scale. Not capped.
    var k = Number(b.dataset.png);
    var filename = currentName + '-' + solved.seed + '@' + k + 'x.png';
    // The recipe as it stands at the click, and the scale: a piece may draw
    // finer detail at a higher one.
    var manifest = Object.assign(recipe(), { scale: k });
    var o = document.createElement('canvas');
    o.width = Math.round(current.size.w * k);
    o.height = Math.round(current.size.h * k);
    render.drawFrame(o.getContext('2d'), current, solved, t, { scale: k });
    o.toBlob(function (blob) {
      blob.arrayBuffer().then(function (buf) {
        save(new Blob([pngWithManifest(new Uint8Array(buf), manifest)], { type: 'image/png' }), filename);
      }).catch(function (e) { err.textContent = String(e.message || e); });
    });
  };
});

// The recipe for what is on screen, with the QUANTISED playhead -- the frame that
// was actually drawn, not the one the slider was left at. A saved SVG carries it
// as renderVector's does; a saved PNG carries it with its scale.
function recipe() {
  return solved ? Object.assign({}, solved.manifest, { t: piece.frameT(current, t) }) : null;
}

document.getElementById('svg').onclick = function () {
  if (!solved) return;
  var g = new vector.VectorSurface(current.size);
  render.drawFrame(g, current, solved, t);
  g.setManifest(recipe());
  save(new Blob([g.toSVG()], { type: 'image/svg+xml' }), currentName + '-' + solved.seed + '.svg');
};

${ebmlHead.toString()}
${ebmlResize.toString()}
${crc32.toString()}
${webmInsert.toString()}
${webmBlockTimes.toString()}
${webmWithDuration.toString()}
${webmWithManifest.toString()}
${filmNote.toString()}
${pngWithManifest.toString()}
${filmVerdict.toString()}

// THE REAL-TIME WEBM, offered only where the MP4 below cannot be encoded (see
// offerFilm). It walks playheads(piece) -- the piece's OWN frame list
// -- and hands each drawn frame to the encoder itself, so the file holds the
// frames the piece declares rather than the ones the machine managed to paint.
//
// A canvas capture stream follows compositor updates and may omit frames.
// Background timer throttling can also bunch frames together. The exporter
// supplies each frame directly and paces it with MessageChannel macrotasks.
//
// It saves nothing itself and judges the FILE, not the loop: filmVerdict reads
// the blocks the recorder actually wrote, and throws on a missing frame or on
// uneven spacing. The button saves; a headless check calls this and reads the
// report.
async function exportVideo() {
  // Held here, because the export runs for the length of the film and nothing
  // stops anyone choosing another piece while it does.
  var p = current, s = solved, name = currentName;
  if (!s) throw new Error(err.textContent || 'the piece has no successful build to export');
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
// a piece slower than its frame rate still exports every frame. The browser's
// encoders are passed in rather than read inside the module, which is what lets
// the same path run in Node against controlled stand-ins.
//
// Unless opts.scale names one, the film is drawn with its long edge at 1920
// pixels at least; opts.bitrate, in bit/s, replaces the default core/film.js
// derives from the frame size and rate. core/film.js refuses either by name.
async function exportFilm(opts) {
  var p = current, s = solved, name = currentName;
  if (!s) throw new Error(err.textContent || 'the piece has no successful build to export');
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

filmButtons.forEach(function (button) {
  button.onclick = function () {
    if (!solved || filmBusy) return;
    var request = solved;
    var note = document.getElementById('filmnote');
    var total = render.playheads(current).length;
    filmBusy = true;
    filmButtons.forEach(function (b) { b.disabled = true; });
    err.textContent = '';
    note.textContent = 'drawing and encoding ' + total + ' frames...';
    var lastNote = note.textContent;
    exportFilm({
      scale: button.dataset.film ? Number(button.dataset.film) : undefined,
      onProgress: function (done) {
        if (solved === request && note.textContent === lastNote) {
          note.textContent = 'frame ' + done + ' of ' + total;
          lastNote = note.textContent;
        }
      },
    }).then(function (r) {
      save(r.blob, r.name);
      if (solved !== request) return;
      note.textContent = filmNote(r);
    }).catch(function (e) {
      if (solved !== request) return;
      note.textContent = '';
      err.textContent = String(e.message || e);
    }).finally(function () {
      filmBusy = false;
      filmButtons.forEach(function (b) { b.disabled = !solved || !current.time; });
      if (solved !== request && note.textContent === lastNote) note.textContent = '';
    });
  };
});

document.getElementById('video').onclick = function () {
  if (!solved || videoBusy) return;
  var b = this;
  var request = solved;
  var note = document.getElementById('videonote');
  b.disabled = true;
  videoBusy = true;
  err.textContent = '';
  var pendingNote = 'encoding ' + render.playheads(current).length + ' frames...';
  note.textContent = pendingNote;
  exportVideo().then(function (r) {
    save(r.blob, r.name);
    if (solved !== request) return;
    note.textContent = r.frames + ' of ' + r.expected + ' frames, ' + r.seconds.toFixed(2) + ' s, '
      + Math.round(r.bytes / 1024) + ' kB. Gap between frames: median ' + r.medianGapMs.toFixed(1)
      + ' ms, p95 ' + r.p95GapMs.toFixed(1) + ' ms, max ' + r.maxGapMs.toFixed(1) + ' ms. Render '
      + r.renderMs.toFixed(0) + ' ms, encode ' + r.encodeMs.toFixed(0) + ' ms.';
  }).catch(function (e) {
    if (solved !== request) return;
    note.textContent = '';
    err.textContent = String(e.message || e);
  }).finally(function () {
    videoBusy = false;
    b.disabled = !solved || !current.time;
    if (solved !== request && note.textContent === pendingNote) note.textContent = '';
  });
};

function save(blob, name) {
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
}

// Published so a headless check can drive the page without screenshot diffing.
// The modules go with it: a raster check must render into its OWN canvas with
// willReadFrequently set, because a displayed canvas is GPU-rasterised until the
// browser decides otherwise, and its anti-aliasing changes when it switches.
// That is a property of the browser, not of the piece, and a check that reads
// the visible canvas measures the wrong thing.
window.__artifex = {
  names: names,
  select: select,
  piece: piece,
  render: render,
  vector: vector,
  gpu: gpuPreview,
  setPreview: setPreview,
  video: exportVideo,
  film: exportFilm,
  // Integrated loudness and true peak of an AudioBuffer, by the meter the film
  // export levels its soundtrack with, so a decoded film can be measured.
  loudness: film.measureLoudness,
  loudnessGain: film.loudnessGain,
  // The film export the page offers for the selected piece, once the encoders
  // have answered: 'mp4', 'webm' where H.264 cannot encode it or no codec can
  // encode its declared soundtrack, or null for a still. filmOffer() says why,
  // from the decision the WebM note is written from: { format, reason }, the
  // reason 'h264', 'soundtrack', 'still', or null for the MP4. video() and
  // film() stay callable either way; only the controls follow this.
  filmFormat: function () { return filmOffer.then(function (choice) { return choice.format; }); },
  filmOffer: function () { return filmOffer.then(function (choice) { return { format: choice.format, reason: choice.reason }; }); },
  examples: EXAMPLES,
  setSeed: function (s) { document.getElementById('seed').value = s; resolve(); },
  // Draw the selected piece at another box it declares; throws by name otherwise.
  setBox: function (w, h) { setBox(w, h); buildBox(); },
  setT: function (v) { stop(); t = v; document.getElementById('t').value = v * 1000; frame(); },
  read: function () {
    return {
      name: currentName, seed: solved && solved.seed, t: t,
      outputs: current.outputs, size: current.size, boxes: current.boxes, player: player, view: view,
      frames: render.playheads(current).length,
      error: err.textContent || null,
      preview: previewInfo,
    };
  },
  // Stop the build after a named stage and describe what it had made. read()
  // above answers what is on screen; this answers what the piece was holding
  // part-way through, which is the look the build graph is a graph FOR. The
  // state comes back summarised, never raw: raw state is typed arrays and
  // nested polylines, and a caller that JSON.stringify'd it would get either
  // the wrong answer or megabytes of one.
  //
  // NO BACKTICKS ANYWHERE IN HERE. This whole page body is one template
  // literal, so an unescaped backtick in a comment ends it early.
  stages: function () { return current ? current.build.map(function (s) { return s[0]; }) : []; },
  inspect: function (stage) {
    if (!current) return null;
    var s = piece.solve(current, Number(document.getElementById('seed').value), overrides, { until: stage });
    return {
      stage: stage,
      ran: s.stages.ms.length,
      of: s.stages.of,
      ms: s.stages.ms,
      error: s.stages.error,
      state: piece.summarise(s.state),
    };
  },
  // The recipe for what is on screen right now; saved SVGs carry the same one.
  manifest: recipe,
};

// Open what the address bar asks for, when this build actually has it. The
// order matters: select() clears the overrides and resets the seed, so the
// URL's values go on AFTER it, not before.
var from = fromUrl();
if (from && EXAMPLES[from.piece]) {
  select(from.piece);
  if (from.seed !== null) document.getElementById('seed').value = from.seed;
  if (from.t !== null && current.time) {
    t = from.t;
    document.getElementById('t').value = t * 1000;
  }
  Object.keys(from.params).forEach(function (k) {
    var d = current.params[k];
    if (d && from.params[k] >= d.min && from.params[k] <= d.max) overrides[k] = from.params[k];
  });
  // A box this piece does not accept is left out, as a stale parameter is.
  if (from.box) {
    try { current = piece.atBox(base, from.box); } catch (e) { /* the declared box stands */ }
    sizeCanvas();
    offerFilm();
    buildBox();
  }
  buildParams();
  resolve();
} else {
  select(names[0]);
}

if (player) {
  document.body.classList.add('player');
  c.tabIndex = 0;
  c.setAttribute('role', 'button');
  c.setAttribute('aria-label', currentName + ': play or pause');
  var toggle = function () { var b = document.getElementById('play'); b.onclick.call(b); };
  c.onclick = toggle;
  c.onkeydown = function (e) { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } };
  // Debounced: a rebuild waits until the window has kept its size for 100 ms,
  // so a drag rebuilds once rather than on every event, and it then runs at the
  // start of an animation frame, never in the middle of drawing one.
  var fitting = 0, settling = 0;
  window.addEventListener('resize', function () {
    clearTimeout(settling);
    settling = setTimeout(function () {
      if (!fitting) fitting = requestAnimationFrame(function () { fitting = 0; fitPlayer(); });
    }, 100);
  });
  fitPlayer();
  // A browser starts sound only inside a gesture, so a piece with a soundtrack
  // waits for the first click; a silent one plays at once.
  if (current.time && !current.sound) toggle();
}
})();
</script>
</body>
</html>
`;
}

/**
 * Parse the script this page is about to ship.
 *
 * checkResolvable verifies module paths. This check also parses the page body
 * emitted by the template literal before writing the output file.
 *
 * Template escaping can turn a valid regex in this source into invalid browser
 * JavaScript, so validation must use the emitted script.
 *
 * Its sibling -- a backtick inside a comment in the literal, which ends the
 * literal early -- is NOT caught here: it breaks this file instead, and fails
 * when anything requires it. Two different faults, two different guards.
 *
 * `new Function` compiles without running, so this costs nothing and fails at
 * build time with the browser's own message.
 */
function checkParses(page) {
  const m = page.match(/<script>([\s\S]*)<\/script>/);
  if (!m) throw new Error('build-page: the emitted page has no script block');
  try {
    new Function(m[1]);     // eslint-disable-line no-new-func
  } catch (e) {
    throw new Error(`build-page: the emitted page does not parse -- ${e.message}`);
  }
  return true;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args[0] && args[0].startsWith('--'))) throw new Error('usage: page [path/to/piece.cjs]');
  const external = args.length ? loadExternal(args[0]) : null;
  const page = html(bundle(external), external ? { count: 1 } : {});
  checkParses(page);
  const out = external ? external.directory : path.join(ROOT, 'out');
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, external ? external.stem + '-page.html' : 'index.html');
  fs.writeFileSync(file, page);
  console.log(`${external ? file : path.relative(ROOT, file)}  ${(Buffer.byteLength(page) / 1024).toFixed(1)} kB  ${MODULES.length + (external ? external.moduleCount : 0)} modules, no dependencies`);
}

// Requirable, so the resolution check can be tested. Without this the only
// check the delivery tool has would itself be unchecked.
if (require.main === module) main();

/**
 * The module runtime plus the library modules `ids`, every one by default, for
 * any page that wants them. A list that leaves out a module one of its own
 * requires is refused by name here, before anything is written.
 */
function bundle(external = null, ids = MODULES) {
  checkResolvable(ids);
  return [RUNTIME].concat(ids.map(wrap), external ? [external.source] : []).join(String.fromCharCode(10));
}

module.exports = { modules, checkResolvable, reach, checkParses, bundle, html, ebmlHead, ebmlResize, webmBlockTimes, webmWithDuration, webmWithManifest, webmManifest, pngWithManifest, pngManifest, filmNote, filmVerdict, MODULES };
