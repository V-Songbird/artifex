#!/usr/bin/env node
'use strict';

// Join MP4 films that Artifex exported into one film, without encoding again.
//
// A long film is made scene by scene, since one tab cannot hold minutes of
// frames and sound at once. Each scene's film is read with core/film.js's
// reader, checked as the export checks it, and its samples are copied into one
// video track and one soundtrack written by the same writer. The films must
// share their size, frame rate and codec configurations, so one decoder plays
// every scene; any other film is refused by name.
//
// THE PICTURES JOIN EXACTLY. Every scene starts on a keyframe, so its frames
// follow the scene before on the one frame grid.
//
// THE SOUND JOINS ON A PACKET. Each scene's soundtrack opens with its encoder's
// priming, which its own edit list skipped. One soundtrack has one edit, which
// skips the first scene's priming; every later scene drops the whole packets of
// its priming instead, and the scene before it is cut on a packet boundary so
// that the later scene's sound starts on its first frame or up to one packet
// after it, never before. A codec decodes a packet from the one before it as
// well, so the first packet after a join mixes the end of one scene into the
// start of the next, like a crossfade one packet long; an Opus decoder also
// predicts each packet's band energies from the packets before it, so the
// scene before colours up to SETTLE.Opus packets after the join. The joined
// manifest records where each scene's sound starts and which of its samples
// lie past that, the samples replay judges.
//
// THE FILM STREAMS. The command holds no film whole: it reads each film's boxes,
// writes the joined film's, then copies every sample from its scene as it goes,
// so a long film needs about the memory of its sample tables, not of its bytes.
//
//   npm run stitch -- a.mp4 b.mp4 c.mp4 -o film.mp4

const fs = require('node:fs');
const path = require('node:path');
const { readMp4, muxMp4, writeMp4, filmCheck } = require('../core/film.js');
const { callerDirectory } = require('./piece-input.js');

const USAGE = 'usage: npm run stitch -- <a.mp4> <b.mp4> [more.mp4 ...] -o <out.mp4>';

// The writer's box sizes and chunk offsets are 32-bit; this much is left for
// everything ahead of the media.
const MAX_MEDIA = 2 ** 32 - 2 ** 24;

// How many packets after a join the scene before still reaches, by codec.
// Measured in installed Edge 153: past its first packet, an AAC scene decoded
// to the same samples it decodes to in its own film. An Opus scene of speech
// after drums decoded 10 to 15 dB further from its render than in its own film
// over its first 100 ms, and within 0.1 dB of its own film's decode from 200 ms.
const SETTLE = { mp4a: 1, Opus: 10 };

const sameBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
/** Run-length pairs [count, value] as one value per sample. */
const expand = (runs) => runs.flatMap(([n, v]) => Array(n).fill(v));
const codecName = (track) => (track.codec === 'mp4a' ? 'AAC' : track.codec);

/**
 * A film as the joiner reads it: `bytes` held whole, or a file on disk read a
 * sample at a time. Its `head` holds every box ahead of the media data, or the
 * whole file when the media data is not its last box; `close` lets the file go.
 */
function source(film) {
  if (film.bytes) {
    const { bytes } = film;
    return { name: film.name, head: bytes, size: bytes.length, read: (at, n) => bytes.subarray(at, at + n), close() {} };
  }
  const fd = fs.openSync(film.file, 'r');
  const size = fs.fstatSync(fd).size;
  const read = (at, n) => {
    const b = new Uint8Array(n);
    for (let got = 0, r = 1; got < n && r; got += r) r = fs.readSync(fd, b, got, n - got, at + got);
    return b;
  };
  let head = size;
  for (let at = 0; at + 8 <= size;) {
    const h = Buffer.from(read(at, Math.min(16, size - at)));
    const n = h.readUInt32BE(0) === 1 && h.length === 16 ? Number(h.readBigUInt64BE(8)) : h.readUInt32BE(0) || size - at;
    if (h.toString('latin1', 4, 8) === 'mdat' && at + n === size) { head = at + (h.readUInt32BE(0) === 1 ? 16 : 8); break; }
    if (n < 8) break;
    at += n;
  }
  return { name: film.name, head: read(0, head), size, read, close: () => fs.closeSync(fd) };
}

/** A film read and checked for joining; throws naming `name`. */
function readScene({ name, head, size, read }) {
  let file;
  try { file = readMp4(head, { size, read }); } catch (e) { throw new Error(`stitch: ${name} is not a readable MP4: ${e.message.replace(/^film: /, '')}`); }
  const manifest = file.manifest;
  if (!manifest) throw new Error(`stitch: ${name} carries no replay manifest, so it is no film Artifex exported`);
  if (manifest.scenes) throw new Error(`stitch: ${name} is already a joined film; join the films of its scenes in one run`);
  if (!manifest.film) throw new Error(`stitch: ${name}'s manifest has no frame grid, so it is no film Artifex exported`);
  const video = file.tracks.find((t) => t.kind === 'vide');
  const audio = file.tracks.find((t) => t.kind === 'soun') || null;
  try {
    filmCheck({
      frames: manifest.film.frames, hz: manifest.film.hz, width: video && video.width, height: video && video.height,
      sound: !!audio, priming: audio && audio.edits && audio.edits.length ? audio.edits[0].mediaTime : 0, manifest,
    }, file);
  } catch (e) { throw new Error(`stitch: ${name}: ${e.message.replace(/^film: /, '').replace(/ Nothing was saved\.$/, '')}`); }
  return { name, read, manifest, video, audio };
}

/** Refuse `b` unless one decoder plays it and `a` alike, naming the difference. */
function refuseMismatch(a, b) {
  const refuse = (what) => { throw new Error(`stitch: ${what}; films join only at one size, frame rate and codec configuration`); };
  if (b.video.width !== a.video.width || b.video.height !== a.video.height) {
    refuse(`${b.name} is ${b.video.width} x ${b.video.height} and ${a.name} is ${a.video.width} x ${a.video.height}`);
  }
  if (b.manifest.film.hz !== a.manifest.film.hz || b.video.timescale !== a.video.timescale) {
    refuse(`${b.name} runs at ${b.manifest.film.hz} frames a second and ${a.name} at ${a.manifest.film.hz}`);
  }
  if (!sameBytes(b.video.entry, a.video.entry)) refuse(`${b.name}'s H.264 stream is configured otherwise than ${a.name}'s, so one decoder cannot play both`);
  if (!!b.audio !== !!a.audio) refuse(b.audio ? `${b.name} has a soundtrack and ${a.name} has none` : `${b.name} has no soundtrack and ${a.name} has one`);
  if (!a.audio) return;
  if (b.audio.codec !== a.audio.codec) refuse(`${b.name}'s soundtrack is ${codecName(b.audio)} and ${a.name}'s is ${codecName(a.audio)}`);
  if (!sameBytes(b.audio.entry, a.audio.entry)) refuse(`${b.name}'s ${codecName(b.audio)} soundtrack is configured otherwise than ${a.name}'s`);
}

/**
 * The joined soundtrack's packets and each scene's `sound`: `at`, the sample
 * of the joined soundtrack, as a player hears it, where the scene's own sample
 * 0 lands, and `judged`, the scene's own samples [from, to) that were decoded
 * from its own packets alone. `starts[k]` is scene k's first frame, and the
 * last entry the film's length, in frames.
 */
function joinSound(scenes, starts, hz) {
  const rate = scenes[0].audio.timescale;
  const first = scenes[0].audio.edits[0].mediaTime;
  const plan = scenes.map((s, k) => {
    const durations = expand(s.audio.deltas), priming = s.audio.edits[0].mediaTime;
    let skip = 0, dropped = 0;
    // Every scene after the first drops the whole packets of its priming.
    if (k) while (skip < durations.length && dropped + durations[skip] <= priming) dropped += durations[skip++];
    return { s, durations, skip, lead: priming - dropped };
  });
  const samples = (frames) => (frames * rate) / hz;
  const packets = [];
  let media = 0;
  plan.forEach(({ s, durations, skip, lead }, k) => {
    const own = s.audio;
    const zero = media + lead;
    const length = Math.round((s.manifest.film.frames / hz) * rate);
    // Packets are kept up to where the next scene's first kept packet must go
    // for its sound to start on its first frame, or past it by less than a
    // packet; the last scene's until the film's end is covered.
    const until = k + 1 < plan.length ? first + samples(starts[k + 1]) - plan[k + 1].lead : first + samples(starts[k + 1]);
    // The writer gives every AAC packet 1024 samples.
    if (own.codec === 'mp4a' && durations.some((d) => d !== 1024)) throw new Error(`stitch: ${s.name}'s AAC packets are not all 1024 samples long, so it is no film Artifex exported`);
    const opened = media + durations.slice(skip, skip + SETTLE[own.codec]).reduce((n, d) => n + d, 0);
    const kept = packets.length;
    for (let j = skip; j < durations.length && media < until; j++) {
      const at = own.positions[j], n = own.sizes[j];
      packets.push(() => s.read(at, n));
      media += durations[j];
    }
    if (packets.length === kept) throw new Error(`stitch: ${s.name} is shorter than the packet its sound would start in, so none of its sound would be heard; lengthen it or export it with a neighbouring scene`);
    const to = Math.max(0, Math.min(length, Math.floor((k + 1 < plan.length ? media : first + samples(starts[k + 1])) - zero)));
    // The packets just after a join are decoded with the scene before's state.
    const from = Math.min(to, k ? Math.max(0, opened - zero) : 0);
    s.sound = { at: zero - first, judged: [from, to] };
  });
  return { rate, priming: first, packets };
}

/**
 * The joined film of `sources` as muxMp4 takes it, each sample read from its
 * scene only when written, and `finish(file)`, which checks the joined file as
 * readMp4 reads it and returns { report, joins }.
 */
function join(sources) {
  if (sources.length < 2) throw new Error('stitch: name at least two films to join\n' + USAGE);
  const scenes = sources.map(readScene);
  for (const s of scenes.slice(1)) refuseMismatch(scenes[0], s);
  const { hz } = scenes[0].manifest.film;
  const v = scenes[0].video;
  const media = scenes.reduce((n, s) => n + s.video.bytes + (s.audio ? s.audio.bytes : 0), 0);
  if (media > MAX_MEDIA) throw new Error(`stitch: the films hold ${media} bytes of media, more than one MP4 with 32-bit offsets can address; join fewer or smaller films`);

  const starts = [0];
  const samples = [];
  for (const s of scenes) {
    const t = s.video, keys = new Set(t.keys), offsets = t.offsets ? expand(t.offsets) : null;
    for (let i = 0; i < t.samples; i++) {
      const at = t.positions[i], n = t.sizes[i];
      samples.push({ data: () => s.read(at, n), key: keys.has(i + 1), offset: offsets ? offsets[i] : 0 });
    }
    starts.push(starts[starts.length - 1] + t.samples);
  }
  const sound = scenes[0].audio ? joinSound(scenes, starts, hz) : null;
  const manifest = {
    scenes: scenes.map((s, k) => ({ recipe: s.manifest, frames: [starts[k], starts[k + 1]], ...(s.sound && { sound: s.sound }) })),
  };
  const film = {
    video: { width: v.width, height: v.height, timescale: v.timescale, delta: v.deltas[0][1], avcC: v.avcC, samples },
    audio: sound && {
      codec: scenes[0].audio.codec === 'Opus' ? 'opus' : 'mp4a', entry: scenes[0].audio.entry, sampleRate: sound.rate,
      samples: sound.packets, priming: sound.priming,
    },
    manifest,
  };
  const finish = (file) => {
    const report = filmCheck({
      frames: samples.length, hz, width: v.width, height: v.height, sound: !!sound, priming: sound ? sound.priming : 0, manifest,
    }, file);
    const joins = scenes.slice(1).map((s, i) => ({
      seconds: starts[i + 1] / hz,
      ...(s.sound && { lateMs: +(((s.sound.at - (starts[i + 1] * sound.rate) / hz) * 1000) / sound.rate).toFixed(2) }),
    }));
    return { report: { ...report, hz }, joins };
  };
  return { film, finish };
}

/**
 * Join `films`, [{ name, bytes }] in playing order, into one MP4. Returns
 * { bytes, report, joins }: the report filmCheck reads from the joined file and
 * each join's `seconds`, where the later scene starts, and `lateMs`, how long
 * after its first frame its sound starts.
 */
function stitch(films) {
  const { film, finish } = join(films.map(source));
  const bytes = muxMp4(film);
  return { bytes, ...finish(readMp4(bytes)) };
}

/**
 * Join the films at `films`, [{ name, file }] in playing order, into the file
 * `target`, holding neither them nor it: each sample is read from its scene as
 * it is written, and the joined file is checked as it is read back. The film is
 * written beside `target` and takes its name only once it passes; returns
 * { report, joins } as stitch does.
 */
function stitchFile(films, target) {
  const sources = [];
  const part = target + '.part';
  try {
    for (const f of films) sources.push(source(f));
    const { film, finish } = join(sources);
    const fd = fs.openSync(part, 'w');
    try {
      writeMp4(film, (p) => { for (let at = 0; at < p.length;) at += fs.writeSync(fd, p, at); });
    } finally { fs.closeSync(fd); }
    const out = source({ name: target, file: part });
    let result;
    try { result = finish(readMp4(out.head, out)); } finally { out.close(); }
    fs.renameSync(part, target);
    return result;
  } catch (e) {
    fs.rmSync(part, { force: true });
    throw e;
  } finally {
    for (const s of sources) s.close();
  }
}

function parseArgs(args) {
  const out = { films: [], out: null };
  const refuse = (cause) => new Error('stitch: ' + cause + '\n' + USAGE);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-o' || a === '--out') {
      if (args[i + 1] === undefined || args[i + 1].startsWith('-')) throw refuse(a + ' needs the .mp4 file to write');
      if (out.out) throw refuse('give -o only once');
      out.out = args[++i];
    } else if (a.startsWith('-')) throw refuse('unknown option ' + a);
    else out.films.push(a);
  }
  if (!out.out) throw refuse('name the joined film with -o <out.mp4>');
  if (!/\.mp4$/i.test(out.out)) throw new Error('stitch: -o must name an .mp4 file, got ' + out.out);
  if (out.films.length < 2) throw refuse('name at least two films to join');
  return out;
}

// Relative paths resolve from npm's invocation directory; the joined film never
// replaces one of the films it is made from.
function main(args = process.argv.slice(2), cwd = callerDirectory()) {
  if (args.includes('--help') || args.includes('-h')) return console.log(USAGE);
  const options = parseArgs(args);
  const target = path.resolve(cwd, options.out);
  const films = options.films.map((f) => {
    const file = path.resolve(cwd, f);
    if (path.relative(file, target) === '') throw new Error(`stitch: -o ${options.out} names one of the films to join; write the joined film elsewhere`);
    return { name: f, file };
  });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const { report, joins } = stitchFile(films, target);
  const sound = report.sound ? `, ${report.sound.codec === 'mp4a' ? 'AAC' : report.sound.codec}; ` + joins.map((j, i) => `scene ${i + 2}'s sound starts ${j.lateMs} ms after its first frame`).join(', ') : ', no soundtrack';
  console.log(`stitch: ${target}: ${films.length} scenes, ${report.frames} frames (${report.seconds.toFixed(3)} s), ${report.width} x ${report.height} at ${report.hz} Hz${sound}`);
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { stitch, stitchFile, parseArgs, main };
