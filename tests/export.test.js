'use strict';

// core/export.js's file names and the life of a download's blob URL, against a
// stand-in document.

const test = require('node:test');
const assert = require('node:assert/strict');

const PATH = require.resolve('../core/export.js');

test('a still asked for a film is told it declares no timeline, and to export PNG, or SVG only if it draws vector, or add a time field', async () => {
  const { webm, mp4 } = require('../core/export.js');
  const raster = /^Error: this piece is a still: it declares no timeline, so it has no film\. Export PNG, or give the piece a time field to make it a film\.$/;
  const vector = /^Error: this piece is a still: it declares no timeline, so it has no film\. Export PNG or SVG, or give the piece a time field to make it a film\.$/;
  const pixels = { name: 'still', size: { w: 8, h: 8 }, outputs: ['raster'] };
  const paths = { name: 'still', size: { w: 8, h: 8 }, outputs: ['raster', 'vector'] };
  for (const [still, said] of [[pixels, raster], [paths, vector], [null, raster]]) {
    await assert.rejects(webm(still, {}, 'still'), said);
    await assert.rejects(mp4(still, {}, 'still'), said);
  }
});

test('a saved file is named by piece, seed and kind, the same from the page and the site', () => {
  const { fileName } = require('../core/export.js');
  assert.equal(fileName('png', 'drift', 7, 1), 'drift-7@1x.png');
  assert.equal(fileName('png', 'drift', 7, 8), 'drift-7@8x.png');
  assert.equal(fileName('svg', 'drift', 7), 'drift-7.svg');
  assert.equal(fileName('webm', 'drift', 7), 'drift-7.webm');
  assert.equal(fileName('mp4', 'drift', 7, '1920x1080'), 'drift-7-1920x1080.mp4');
});

test('a film drawn again after the canvas lost its GPU or its video encoder failed, or whose sound was encoded again, says so in its announced note', () => {
  const { filmFigures, filmNote, filmSaved } = require('../core/export.js');
  const r = { frames: 48, width: 64, height: 48, seconds: 2, bytes: 4096, conversion: 'cpu', convertMs: 5, drawMs: 9, totalMs: 20, realtime: 100, contextLost: false, encoderError: null };
  const lost = / Drawn again from the first frame, in memory, after the canvas lost its GPU\./;
  const video = / Drawn again from the first frame, in memory, after the video encoder failed\./;
  const sound = / The sound was encoded again after its encoder failed\./;
  for (const said of [lost, video, sound, /again/]) assert.doesNotMatch(filmSaved(r) + filmNote(r), said, 'a film made once says nothing of a second pass');
  const gone = { ...r, contextLost: true };
  assert.match(filmSaved(gone), lost);
  assert.doesNotMatch(filmSaved(gone), sound);
  const both = filmSaved({ ...r, encoderError: 'video: Error: EncodingError; sound: Error: EncodingError' });
  assert.match(both, video);
  assert.match(both, sound);
  const heard = filmSaved({ ...r, encoderError: 'sound: Error: EncodingError' });
  assert.match(heard, sound);
  assert.doesNotMatch(heard, /Drawn again/, 'a sound encoded again redrew no frame');
  assert.equal(filmNote(gone).split('Drawn again').length, 2, 'the command line says it once');
  assert.doesNotMatch(filmFigures(gone), /again/, 'the unannounced figures hold only the route and timings');
  for (const s of [filmSaved(gone), both]) assert.doesNotMatch(s, /contextLost|encoderError|EncodingError/, 'plain words, no internal names');
});

test('a film is drawn again in memory, converted after its encoder route was dropped, or once, as its report says, and a converted one says it was drawn twice', () => {
  const { filmDrawnAgain, filmNote, filmSaved } = require('../core/export.js');
  const r = { frames: 48, width: 64, height: 48, seconds: 2, bytes: 4096, conversion: 'gpu', convertMs: 5, drawMs: 9, totalMs: 20, realtime: 100, contextLost: false, encoderError: null };
  const route = 'encoder route: the encoder returned 45 of 48 frames';
  for (const [extra, again] of [
    [{}, null], [{ encoderError: 'sound: Error: EncodingError' }, null],
    [{ contextLost: true }, 'memory'], [{ encoderError: 'video: Error: EncodingError' }, 'memory'],
    [{ encoderError: route }, 'converted'], [{ encoderError: route + '; sound: Error: EncodingError' }, 'converted'],
    [{ encoderError: route + '; video: Error: EncodingError' }, 'memory'],
    // Only an entry's own name counts, not the words of another entry's error.
    [{ encoderError: 'sound: Error: no video: here' }, null],
    // An encoder that failed on the encoder route's first probe drew nothing of the film.
    [{ encoderError: 'encoder probe: Error: EncodingError' }, null],
  ]) assert.equal(filmDrawnAgain({ ...r, ...extra }), again, JSON.stringify(extra));
  const converted = { ...r, encoderError: route };
  const twice = / Drawn twice: the encoder route failed, so the film was drawn again from the first frame with its colour converted on the GPU\./;
  assert.match(filmSaved(converted), twice);
  assert.equal(filmNote(converted).split('Drawn twice').length, 2, 'the command line says it once');
  assert.doesNotMatch(filmSaved(converted), /in memory/, 'converted, not drawn in memory');
  assert.doesNotMatch(filmSaved(converted), /encoder route:|encoderError/, 'plain words, no internal names');
  assert.doesNotMatch(filmSaved({ ...r, encoderError: route + '; video: Error: EncodingError' }), /Drawn twice/, 'a film drawn last in memory says so instead');
});

test('a download keeps its blob URL until the next save or until the page is hidden, never on a timer', (t) => {
  // A fresh module, so no save from another test is held.
  delete require.cache[PATH];
  t.after(() => { delete require.cache[PATH]; });
  const { save } = require('../core/export.js');
  const revoked = [], clicked = [], listeners = {};
  let n = 0;
  t.mock.method(URL, 'createObjectURL', () => 'blob:' + ++n);
  t.mock.method(URL, 'revokeObjectURL', (u) => revoked.push(u));
  globalThis.document = { createElement: (tag) => ({ tag, click() { clicked.push([this.href, this.download]); } }) };
  // As the platform does, the same listener added twice is added once.
  globalThis.addEventListener = (type, f) => { (listeners[type] = listeners[type] || new Set()).add(f); };
  t.after(() => { delete globalThis.document; delete globalThis.addEventListener; });
  const timer = t.mock.method(globalThis, 'setTimeout', () => 0);

  save(new Blob(['a']), 'a.png');
  assert.deepEqual(clicked, [['blob:1', 'a.png']]);
  assert.deepEqual(revoked, []);
  assert.equal(timer.mock.callCount(), 0, 'no timer can revoke it under a slow download');

  save(new Blob(['b']), 'b.svg');
  assert.deepEqual(clicked[1], ['blob:2', 'b.svg']);
  assert.deepEqual(revoked, ['blob:1'], 'the next save revokes the one before it');

  assert.equal(listeners.pagehide.size, 1);
  for (const f of listeners.pagehide) f();
  assert.deepEqual(revoked, ['blob:1', 'blob:2'], 'hiding the page revokes the last');
  for (const f of listeners.pagehide) f();
  save(new Blob(['c']), 'c.webm');
  assert.deepEqual(revoked, ['blob:1', 'blob:2'], 'nothing is revoked twice');
});

// What a walk of a written WebM finds: each element's id and body, masters opened.
function walkWebm(bytes) {
  const { ebmlHead } = require('../core/export.js');
  const MASTERS = [0x18538067, 0x114D9B74, 0x4DBB, 0x1549A966, 0x1654AE6B, 0xAE, 0xE0, 0x55B0, 0x1F43B675, 0x1C53BB6B, 0xBB, 0xB7];
  const out = [];
  for (let p = 0; p < bytes.length;) {
    const e = ebmlHead(bytes, p);
    out.push(e);
    p = MASTERS.includes(e.id) ? e.body : e.body + e.size;
  }
  return out;
}
const uintAt = (bytes, e) => { let v = 0; for (let i = 0; i < e.size; i++) v = v * 256 + bytes[e.body + i]; return v; };
const webmFrames = (n, every) => Array.from({ length: n }, (_, i) => ({ data: Uint8Array.of(i & 255, 7, 7), key: i % every === 0 }));

test('a written WebM holds every frame at its own time, from its index and the frame rate alone', () => {
  const { muxWebm, webmBlockTimes } = require('../core/export.js');
  for (const hz of [24, 30, 29.97, 60, 240, 0.5]) {
    const bytes = muxWebm({ codec: 'vp9', width: 64, height: 36, hz, frames: webmFrames(97, 30), seed: 7 });
    const times = webmBlockTimes(bytes);
    assert.equal(times.length, 97, hz + ' Hz: frames');
    const off = times.findIndex((ms, i) => ms !== Math.round((i * 1e6) / hz) / 1000);
    assert.equal(off, -1, hz + ' Hz: the first frame off its time is ' + off);
  }
});

test('a written WebM states its length, lists every keyframe Cluster and every index position names its element', () => {
  const { muxWebm, webmManifest, webmBlockTimes } = require('../core/export.js');
  const made = { codec: 'vp8', width: 640, height: 360, hz: 60, frames: webmFrames(150, 60), seed: 'abc' };
  const manifest = { piece: 'check', seed: 'abc', note: 'café' };
  for (const bytes of [muxWebm(made), muxWebm({ ...made, manifest })]) {
    const els = walkWebm(bytes), segment = els.find((e) => e.id === 0x18538067);
    assert.equal(segment.body + segment.size, bytes.length, 'the Segment ends where the file does');
    assert.equal(new DataView(bytes.buffer).getFloat64(els.find((e) => e.id === 0x4489).body), 150 * 1e6 / 60, 'length in microseconds');
    assert.equal(uintAt(bytes, els.find((e) => e.id === 0x2AD7B1)), 1000);
    assert.equal(uintAt(bytes, els.find((e) => e.id === 0xB0)), 640);
    assert.equal(uintAt(bytes, els.find((e) => e.id === 0xBA)), 360);
    assert.equal(String.fromCharCode(...bytes.subarray(els.find((e) => e.id === 0x86).body).subarray(0, 5)), 'V_VP8');
    // Each Seek names the element that starts at its position.
    const ids = els.filter((e) => e.id === 0x53AB).map((e) => uintAt(bytes, e)), seeks = els.filter((e) => e.id === 0x53AC).map((e) => uintAt(bytes, e));
    assert.ok(ids.includes(0x1549A966) && ids.includes(0x1654AE6B) && ids.includes(0x1C53BB6B));
    ids.forEach((id, i) => assert.equal(els.find((e) => e.at === segment.body + seeks[i]).id, id, 'Seek ' + i));
    // Each CuePoint names a Cluster at its own time, one per keyframe.
    const cueTimes = els.filter((e) => e.id === 0xB3).map((e) => uintAt(bytes, e)), cueAt = els.filter((e) => e.id === 0xF1).map((e) => uintAt(bytes, e));
    assert.deepEqual(cueTimes, [0, 1000000, 2000000]);
    cueAt.forEach((at, i) => {
      const cluster = els.find((e) => e.at === segment.body + at);
      assert.equal(cluster.id, 0x1F43B675, 'cue ' + i);
      assert.equal(uintAt(bytes, els[els.indexOf(cluster) + 1]), cueTimes[i], 'cue ' + i + ' time');
      assert.equal(bytes[els[els.indexOf(cluster) + 2].body + 3], 0x80, 'cue ' + i + ' opens on a keyframe');
    });
    assert.equal(webmBlockTimes(bytes).length, 150);
  }
  assert.equal(webmManifest(muxWebm(made)), null);
  assert.deepEqual(webmManifest(muxWebm({ ...made, manifest })), manifest);
});

test('the same frames and seed write the same WebM bytes, and the seed changes only the track UID', () => {
  const { muxWebm } = require('../core/export.js');
  const made = { codec: 'vp9', width: 32, height: 32, hz: 30, frames: webmFrames(40, 10), colour: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false } };
  const a = muxWebm({ ...made, seed: 1 }), again = muxWebm({ ...made, seed: 1 }), b = muxWebm({ ...made, seed: 2 });
  assert.equal(Buffer.compare(a, again), 0);
  assert.equal(a.length, b.length);
  const uid = walkWebm(a).find((e) => e.id === 0x73C5);
  const differ = [];
  a.forEach((v, i) => { if (v !== b[i]) differ.push(i); });
  assert.ok(differ.length > 0 && differ.every((i) => i >= uid.body && i < uid.body + uid.size), 'bytes outside the track UID differ');
  // Each colour value under its own element: primaries, transfer, matrix, range.
  const tagged = muxWebm({ ...made, seed: 1, colour: { primaries: 'bt470bg', transfer: 'iec61966-2-1', matrix: 'rgb', fullRange: true } });
  const colour = (id) => uintAt(tagged, walkWebm(tagged).find((e) => e.id === id));
  assert.deepEqual([0x55BB, 0x55BA, 0x55B1, 0x55B9].map(colour), [5, 13, 0, 2]);
  assert.equal(uintAt(a, walkWebm(a).find((e) => e.id === 0x55B9)), 1, 'limited range');
});

test('a WebM that cannot be written is refused by name, with nothing written', () => {
  const { muxWebm } = require('../core/export.js');
  const ok = { codec: 'vp8', width: 8, height: 8, hz: 30, frames: webmFrames(3, 3), seed: 1 };
  assert.throws(() => muxWebm({ ...ok, codec: 'h264' }), /^Error: webm: the codec must be vp8 or vp9, got h264; nothing was written$/);
  assert.throws(() => muxWebm({ ...ok, hz: 0 }), /^Error: webm: the frame rate must be a positive number, got 0; nothing was written$/);
  assert.throws(() => muxWebm({ ...ok, width: 8.5 }), /^Error: webm: the frame size must be whole pixels, got 8\.5 x 8; nothing was written$/);
  assert.throws(() => muxWebm({ ...ok, frames: [] }), /^Error: webm: a film starts with a keyframe, and this one has no frames; nothing was written$/);
  assert.throws(() => muxWebm({ ...ok, frames: [{ data: Uint8Array.of(1), key: false }] }), /^Error: webm: a film starts with a keyframe, and this one starts with a delta frame; nothing was written$/);
  assert.throws(() => muxWebm({ ...ok, seed: undefined }), /^Error: webm: the film needs its seed, which its track UID is made from; nothing was written$/);
  assert.throws(() => muxWebm({ ...ok, colour: { primaries: 'constructor' } }), /^Error: webm: the colour primaries must be one of bt709, bt470bg, smpte170m, got constructor; nothing was written$/);
  assert.throws(() => muxWebm({ ...ok, colour: { fullRange: 'yes' } }), /^Error: webm: the colour fullRange must be true or false, got yes; nothing was written$/);
  assert.throws(() => muxWebm({ ...ok, colour: { matrix: 'bt2020-ncl' } }), /^Error: webm: the colour matrix must be one of rgb, bt709, bt470bg, smpte170m, got bt2020-ncl; nothing was written$/);
});
