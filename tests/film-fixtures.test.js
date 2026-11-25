'use strict';

// Every film fixture under tests/fixtures/ loads, builds, draws its first and
// last frame and renders any soundtrack in Node, so a core change that breaks
// one fails here rather than only in a browser run that exports it.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadExternal } = require('../tools/piece-input.js');
const { validate, solve } = require('../core/piece.js');
const { drawFrame, playheads, renderSound } = require('../core/render.js');
const { nullSurface } = require('../tools/bench.js');
const { fakeAudio, fakeCanvas } = require('./fake-media.js');

const DIR = path.join(__dirname, 'fixtures');
// A fixture is a film when its piece declares `time`, whatever its file is called.
const FILMS = fs.readdirSync(DIR).filter((f) => f.endsWith('.cjs')
  && loadExternal(path.join(DIR, f)).piece.time).sort();

test('film fixtures: there are some to check', () => {
  assert.ok(FILMS.length > 0, `no fixture declaring time under ${DIR}`);
});

// drawFrame applies a declared finish only on a surface with a canvas, and
// nullSurface has none, so this draws on fakeCanvas, which also makes the grain
// tile's canvas through the frame canvas's ownerDocument.
const DOCUMENT = { createElement: () => fakeCanvas({ width: 0, height: 0 }, nullSurface) };
const paint = (piece, t) => {
  const canvas = fakeCanvas({ width: piece.size.w, height: piece.size.h, ownerDocument: DOCUMENT }, nullSurface);
  drawFrame(canvas.getContext('2d'), piece, solve(piece, piece.seed), t);
  return canvas.pixels;
};
// How many bytes differ between piece `a` and piece `b` over every frame: a count, not the pixels.
const changed = (a, b) => playheads(a).reduce((n, t) => {
  const x = paint(a, t), y = paint(b, t);
  return n + x.reduce((k, v, i) => k + (v !== y[i]), 0);
}, 0);
const FINISHED = FILMS.filter((f) => loadExternal(path.join(DIR, f)).piece.finish);

test('film fixtures: a declared finish changes the frame drawFrame paints', () => {
  assert.ok(FINISHED.length > 0, 'no fixture declares a finish');
  for (const file of FINISHED) {
    const { finish, ...rest } = loadExternal(path.join(DIR, file)).piece;
    assert.ok(changed(validate({ ...rest, finish }), validate(rest)) > 0, `${file}: no frame differs with its finish declared`);
  }
});

// Each part of the finish, and the grade's toning (color) and its ends
// (multiply, then screen) apart, dropped from the finish one at a time.
const PARTS = {
  grain: ({ grain, ...f }) => f,
  'grade toning': ({ grade: { tone, toning, ...d }, ...f }) => ({ ...f, grade: d }),
  'grade black and white': ({ grade: { black, white, ...d }, ...f }) => ({ ...f, grade: d }),
  flicker: ({ flicker, ...f }) => f,
  vignette: ({ vignette, ...f }) => f,
};
const declares = (finish, part) => (part.startsWith('grade ')
  ? !!finish.grade && (part === 'grade toning' ? 'toning' in finish.grade : 'black' in finish.grade || 'white' in finish.grade)
  : part in finish);

for (const part of Object.keys(PARTS)) {
  test(`film fixtures: drawFrame applies the finish's ${part} where a fixture declares it`, () => {
    const files = FINISHED.filter((f) => declares(loadExternal(path.join(DIR, f)).piece.finish, part));
    assert.ok(files.length > 0, `no fixture declares ${part}`);
    for (const file of files) {
      const piece = loadExternal(path.join(DIR, file)).piece;
      const n = changed(validate(piece), validate({ ...piece, finish: PARTS[part](piece.finish) }));
      assert.ok(n > 0, `${file}: no pixel differs with its ${part} declared`);
    }
  });
}

for (const file of FILMS) {
  test(`film fixtures: ${file} builds, draws its first and last frame and renders any soundtrack`, async () => {
    const p = validate(loadExternal(path.join(DIR, file)).piece);
    const solved = solve(p, p.seed);
    assert.equal(solved.stages.error, null, `${file} failed to build`);
    const heads = playheads(p);
    for (const t of [heads[0], heads[heads.length - 1]]) drawFrame(nullSurface(p.size), p, solved, t);
    if (!p.sound) return;
    const audio = fakeAudio();
    await renderSound(p, solved, { OfflineAudioContext: audio.Context });
    assert.ok(audio.record.nodes.some((n) => n.at !== undefined && n.at !== null), `${file} scheduled no sound`);
  });
}

test('film fixtures: decoded-track.cjs plays the track its sound() decoded', async () => {
  const p = validate(loadExternal(path.join(DIR, 'decoded-track.cjs')).piece);
  const audio = fakeAudio();
  await renderSound(p, solve(p, p.seed), { OfflineAudioContext: audio.Context });
  assert.equal(audio.record.decoded.length, 1, 'sound() decoded no track');
  const [track] = audio.record.decoded;
  assert.deepEqual([track.numberOfChannels, track.length, track.sampleRate], [1, 13230, 44100]);
  assert.ok(track.getChannelData(0).some((v) => v !== 0), 'the decoded track is silent');
  // The fixture's eight hits each start one source; count those that play the track.
  const plays = audio.record.nodes.filter((n) => n.kind === 'bufferSource' && n.buffer === track);
  assert.equal(plays.length, 8, 'a hit plays something other than the decoded track');
});

test('film fixtures: the audio stand-in refuses a WAVE it does not parse, by name', async () => {
  const wave = (format, bits) => {
    const bytes = new Uint8Array(48);
    const view = new DataView(bytes.buffer);
    [[0, 'RIFF'], [8, 'WAVEfmt '], [36, 'data']].forEach(([at, s]) => bytes.set(Array.from(s, (c) => c.charCodeAt(0)), at));
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 8000, true);
    view.setUint16(34, bits, true);
    view.setUint32(40, 4, true);
    return bytes.buffer;
  };
  const ctx = new (fakeAudio().Context)(1, 1, 48000);
  await assert.rejects(ctx.decodeAudioData(wave(3, 32)), /16-bit PCM/);
  await assert.rejects(ctx.decodeAudioData(wave(1, 8)), /16-bit PCM/);
  await assert.rejects(ctx.decodeAudioData(new Uint8Array(16).buffer), /RIFF WAVE/);
  const mute = wave(1, 16);
  new DataView(mute).setUint16(22, 0, true);
  await assert.rejects(ctx.decodeAudioData(mute), /16-bit PCM/);
  await assert.rejects(ctx.decodeAudioData(wave(1, 16).slice(0, 23)), RangeError);
  const good = wave(1, 16);
  assert.equal((await ctx.decodeAudioData(good)).length, 2);
  assert.equal(good.byteLength, 0, 'the decode left its input attached');
});
