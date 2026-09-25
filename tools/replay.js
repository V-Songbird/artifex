'use strict';

// Replay a saved file from the recipe it carries.
//
// An SVG, PNG, MP4 or WebM film that Artifex saved names the library version,
// the piece, its seed and parameters, and the frame, scale or frame grid it was
// drawn from. This reads that manifest back and finds the piece: the registered
// example of that name, or the module the caller passes with --piece, never a
// path the file names. It refuses a file made by another library version, for
// another piece, or for a box, outputs, size or frame grid the piece no longer
// has, naming the difference. Then it draws the recipe again and compares: an
// SVG byte for byte in Node; a PNG pixel for pixel, a film frame by frame and
// an MP4 film's soundtrack block by block, in installed Edge.
//
//   npm run replay -- <file> [--piece ./piece.cjs] [--edge PATH] [--timeout-ms N] [--headed]
//
// Exits 0 when the file matches and 1, with the first difference named, when
// it does not or cannot be replayed.

const fs = require('node:fs');
const path = require('node:path');
const { validate, atBox, VERSION } = require('../core/piece.js');
const { renderVector, playheads } = require('../core/render.js');
const { readMp4 } = require('../core/film.js');
const { svgManifest } = require('../core/surface-vector.js');
const EXAMPLES = require('../examples/index.js');
const { loadExternal, callerDirectory } = require('./piece-input.js');
const { bundle, html, pngManifest, webmManifest, webmBlockTimes, ebmlHead } = require('./build-page.js');
const { withEdge, waitFor, evaluate } = require('./check-browser.js');

const USAGE = 'usage: npm run replay -- <file> [--piece ./piece.cjs] [--edge PATH] [--timeout-ms N] [--headed]';

/** 'svg', 'mp4', 'png' or 'webm' from a file's first bytes, or null. */
function fileType(bytes) {
  const starts = (sig, at = 0) => bytes.length >= at + sig.length && sig.every((v, i) => bytes[at + i] === v);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (starts([0x1a, 0x45, 0xdf, 0xa3])) return 'webm';
  if (starts([0x66, 0x74, 0x79, 0x70], 4)) return 'mp4';
  if (/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/.test(Buffer.from(bytes.subarray(0, 512)).toString('utf8'))) return 'svg';
  return null;
}

// Where each file type keeps its manifest: an SVG in <metadata>, escaped as
// XML text, whether renderVector or the page wrote it; a film in moov/udta; a
// PNG from the page in an iTXt chunk before IEND; a WebM from the page in a
// Tags element before the first Cluster.
const READERS = {
  svg: (bytes) => svgManifest(Buffer.from(bytes).toString('utf8')),
  mp4: (bytes) => readMp4(bytes).manifest,
  png: pngManifest,
  webm: webmManifest,
};

/** The file's type and the manifest it carries; throws naming why there is none. */
function manifestOf(bytes, name = 'the file') {
  const type = fileType(bytes);
  if (!type) throw new Error(`replay: ${name} is not an SVG, MP4, PNG or WebM file`);
  const manifest = READERS[type](bytes);
  if (!manifest || typeof manifest !== 'object') throw new Error(`replay: ${name} carries no replay manifest, so it cannot say what made it`);
  return { type, manifest };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The piece a manifest names, as { piece, external }: the module at
 * `modulePath` when given, else the registered example of that name. Refuses
 * another library version, another piece, or a piece whose box or outputs have
 * changed since, naming the difference. Never loads a module the file names.
 */
function pieceFor(manifest, modulePath = null, cwd = callerDirectory()) {
  if (manifest.artifex !== VERSION) {
    throw new Error(`replay: the file was made by artifex ${JSON.stringify(manifest.artifex)} and this is ${VERSION}; replay it with that version`);
  }
  let piece, external = null;
  if (modulePath) {
    external = loadExternal(modulePath, cwd);
    piece = external.piece;
  } else if (Object.prototype.hasOwnProperty.call(EXAMPLES, manifest.piece)) {
    piece = validate(EXAMPLES[manifest.piece]);
  } else {
    throw new Error(`replay: no registered example is named ${JSON.stringify(manifest.piece)}; pass its module with --piece`);
  }
  if (piece.name !== manifest.piece) {
    throw new Error(`replay: the file names piece ${JSON.stringify(manifest.piece)} and ${modulePath} is ${JSON.stringify(piece.name)}`);
  }
  // A piece that declares boxes is drawn again at the box the file names, if
  // it still accepts that box; one that does not keeps its size, compared below.
  if (piece.boxes && manifest.size && typeof manifest.size === 'object') {
    try { piece = atBox(piece, manifest.size); } catch (e) { throw new Error(`replay: the file was drawn at ${JSON.stringify(manifest.size)} and ${e.message.replace(/^atBox: /, '')}`); }
  }
  if (!same(manifest.size, { w: piece.size.w, h: piece.size.h })) {
    throw new Error(`replay: the file was drawn at ${JSON.stringify(manifest.size)} and ${piece.name} now draws at ${JSON.stringify(piece.size)}`);
  }
  if (!same(manifest.outputs, piece.outputs)) {
    throw new Error(`replay: the file names outputs ${JSON.stringify(manifest.outputs)} and ${piece.name} now declares ${JSON.stringify(piece.outputs)}`);
  }
  return { piece, external };
}

/** An SVG drawn again from its recipe, compared byte for byte. */
function replaySvg(bytes, manifest, piece) {
  const again = Buffer.from(renderVector(piece, { seed: manifest.seed, params: manifest.params, t: manifest.t }).svg, 'utf8');
  const saved = Buffer.from(bytes);
  let at = 0;
  while (at < saved.length && at < again.length && saved[at] === again[at]) at++;
  if (at === saved.length && at === again.length) return { match: true, detail: `${saved.length} bytes, identical to the replay` };
  const around = (b) => JSON.stringify(b.subarray(Math.max(0, at - 24), at + 40).toString('utf8'));
  return { match: false, detail: `byte ${at} of ${saved.length} differs: the file has ${around(saved)} where the replay draws ${around(again)}` };
}

// A film is compared at most this many frames, first and last included, each
// decoded frame against its redraw and its neighbours' at 240 pixels wide.
// Measured in installed Edge, every example's own film decoded at 39 to 54 dB
// from its redraw on a GPU canvas, and a film of the next seed had frames at
// 3 to 23 dB in every example whose drawing uses the seed.
const FILM_FRAMES = 24;
const FILM_FLOOR_DB = 30;

/** The frames a film replay compares: every one up to FILM_FRAMES, else that many spread evenly. */
function filmFrames(n) {
  if (n <= FILM_FRAMES) return Array.from({ length: n }, (_, i) => i);
  return [...new Set(Array.from({ length: FILM_FRAMES }, (_, k) => Math.round((k * (n - 1)) / (FILM_FRAMES - 1))))];
}

const even = (v) => Math.max(2, 2 * Math.round(v / 2));

/**
 * Check a film's frame grid and size against the piece as it is now, before
 * any browser starts, and name the frames to compare.
 */
function filmPlan(bytes, manifest, piece) {
  const grid = manifest.film;
  if (!grid) throw new Error('replay: the film\'s manifest has no frame grid');
  if (!piece.time) throw new Error(`replay: the file is a film and ${piece.name} is now a still`);
  const now = { frames: playheads(piece).length, hz: piece.time.hz, loop: !!piece.time.loop };
  for (const k of ['frames', 'hz', 'loop']) {
    if (grid[k] !== now[k]) throw new Error(`replay: the film's frame grid has ${k} ${JSON.stringify(grid[k])} and ${piece.name} now has ${JSON.stringify(now[k])}`);
  }
  const video = readMp4(bytes).tracks.find((t) => t.kind === 'vide');
  if (!video || video.samples !== grid.frames) throw new Error(`replay: the film holds ${video ? video.samples : 0} of the ${grid.frames} frames its manifest names`);
  const size = { w: even(piece.size.w * grid.scale), h: even(piece.size.h * grid.scale) };
  if (video.width !== size.w || video.height !== size.h) {
    throw new Error(`replay: the film is ${video.width} x ${video.height} and ${piece.name} at scale ${grid.scale} draws ${size.w} x ${size.h}`);
  }
  return filmFrames(grid.frames);
}

// Serialized into the page. The saved film is decoded there, and each named
// frame, read through a VideoFrame, is compared with its redraw at the recipe
// on a GPU canvas, as the export draws, and with its neighbours' redraws. Drawn
// pixels are taken over black, as every film is.
async function compareFilm(bytes, recipe, frames) {
  const api = window.__artifex;
  if (!Object.prototype.hasOwnProperty.call(api.examples, recipe.piece)) throw new Error('replay: the page has no piece named ' + JSON.stringify(recipe.piece));
  const p = api.piece.atBox(api.piece.validate(api.examples[recipe.piece]), recipe.size);
  const solved = api.piece.solve(p, recipe.seed, recipe.params);
  const heads = api.render.playheads(p);
  const video = document.createElement('video');
  video.muted = true;
  video.src = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
  await new Promise((resolve, reject) => {
    video.onloadeddata = resolve;
    video.onerror = () => reject(new Error('replay: the film does not decode in this browser'));
  });
  const W = video.videoWidth, H = video.videoHeight;
  const w = 240, h = Math.max(2, Math.round((240 * H) / W));
  const small = document.createElement('canvas');
  small.width = w; small.height = h;
  const sg = small.getContext('2d', { willReadFrequently: true });
  const full = document.createElement('canvas');
  full.width = W; full.height = H;
  const fg = full.getContext('2d');
  const shrink = (source) => { sg.clearRect(0, 0, w, h); sg.drawImage(source, 0, 0, w, h); return sg.getImageData(0, 0, w, h).data; };
  const drawn = (i) => { fg.clearRect(0, 0, W, H); api.render.drawFrame(fg, p, solved, heads[i], { scale: recipe.film.scale }); return shrink(full); };
  const psnr = (got, want) => {
    let se = 0;
    for (let k = 0; k < got.length; k += 4) for (let c = 0; c < 3; c++) se += (got[k + c] - (want[k + c] * want[k + 3]) / 255) ** 2;
    return se ? +(10 * Math.log10((255 * 255 * got.length * 0.75) / se)).toFixed(2) : 99;
  };
  const rows = [];
  for (const i of frames) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('replay: seeking the film to frame ' + i + ' timed out')), 10000);
      video.onseeked = () => { clearTimeout(timer); resolve(); };
      video.currentTime = (i + 0.5) / p.time.hz;
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    // Read through a VideoFrame made from the element, closed once read, as the
    // browser check reads: drawing the element itself can convert a
    // software-decoded frame's colours differently from the pixels it carries.
    const frame = new VideoFrame(video);
    let got;
    try { got = shrink(frame); } finally { frame.close(); }
    rows.push({
      frame: i, psnr: psnr(got, drawn(i)),
      neighbours: [i - 1, i + 1].filter((j) => j >= 0 && j < heads.length).map((j) => ({ frame: j, psnr: psnr(got, drawn(j)) })),
    });
  }
  URL.revokeObjectURL(video.src);
  return rows;
}

// A soundtrack is compared in blocks of SOUND_BLOCK samples. Each block of the
// decoded film must be within its codec's SOUND_FLOOR_DB of the recipe's
// soundtrack, levelled as the export levels it, unless their difference is
// quieter than SOUND_GATE_DB of full scale, where the codec's own noise decides.
// Measured in installed Edge on readout, cues and settle, every judged block of
// an AAC film decoded at 34.8 dB or better from its render and of an Opus film
// at 23.6 dB or better; the next seed's soundtrack of readout and settle came
// within -7 dB, and of cues within 24.2 dB as AAC and 20.1 dB as Opus.
const SOUND_BLOCK = 1024;
const SOUND_FLOOR_DB = { mp4a: 25, Opus: 15 };
const SOUND_GATE_DB = -60;

// A perceptual codec keeps a noise's band levels, not its waveform. So a block
// under its floor is judged again, band by band of SOUND_BAND bins (750 Hz): a
// band is noise-like where the render's own spectrum, Hann-windowed, has a
// flatness of at least SOUND_FLATNESS, and the film never decides it. Outside
// those bands the block must still keep its floor. Inside them the film must
// follow the render's waveform within SOUND_NOISE_DB.waveform, which another
// noise (-3 dB), a missing voice or a moved one (about 0 dB) cannot, and its band
// levels within SOUND_NOISE_DB.envelope, which a voice 3 dB louder or quieter
// cannot. Measured in installed Edge on pieces of filtered-noise voices under
// 15 kHz, their own films decoded at 10.2 dB or better by waveform and 25.2 dB
// or better by level in those bands, as AAC and as Opus; films whose noise voice
// came from another seed, band or level, or was missing, named blocks at 2.5 dB
// or less by waveform or 17.9 dB or less by level.
const SOUND_BAND = 16;
const SOUND_FLATNESS = 0.4;
const SOUND_NOISE_DB = { waveform: 3, envelope: 18 };

/**
 * Whether a film's soundtrack is compared: null when neither the piece nor the
 * film has one; a verdict when only one of them does, or when the film's is in
 * a codec the export never writes; else { codec }, to compare.
 */
function soundPlan(bytes, piece) {
  const track = readMp4(bytes).tracks.find((t) => t.kind === 'soun');
  if (!piece.sound) return track ? { match: false, detail: `the film carries a soundtrack and ${piece.name} declares none` } : null;
  if (!track) return { match: false, detail: `the film carries no soundtrack and ${piece.name} declares one` };
  if (!Object.prototype.hasOwnProperty.call(SOUND_FLOOR_DB, track.codec)) {
    return { match: false, detail: `the film's soundtrack is ${JSON.stringify(track.codec)}, and the export writes AAC or Opus` };
  }
  return { codec: track.codec };
}

// Serialized into the page. The film's soundtrack is decoded as a player hears
// it, trimmed by its edit list, and the recipe's is rendered and levelled with
// the page's loudnessGain for the film's `codec`, the gain the export applies.
// For each block of `block` samples, over every channel, it returns the rendered
// energy and the energy of the difference, then, in the bands of `band` bins
// where the render is noise-like (a Hann-windowed spectral flatness of at least
// `flatness`), the rendered energy, the difference's, and the envelope error: the
// sum of (sqrt(decoded) - sqrt(rendered))^2 over those bands' energies. Band
// energies come from an unwindowed transform, so they add up to the block's.
async function compareSound(bytes, recipe, block, codec, band, flatness) {
  const api = window.__artifex;
  if (!Object.prototype.hasOwnProperty.call(api.examples, recipe.piece)) throw new Error('replay: the page has no piece named ' + JSON.stringify(recipe.piece));
  const p = api.piece.atBox(api.piece.validate(api.examples[recipe.piece]), recipe.size);
  const solved = api.piece.solve(p, recipe.seed, recipe.params);
  let decoded;
  try { decoded = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(bytes.slice().buffer); } catch (e) { return { error: String((e && e.message) || e) }; }
  const rendered = await api.render.renderSound(p, solved, { OfflineAudioContext, sampleRate: 48000, channels: 2 });
  const gain = api.loudnessGain(api.loudness(rendered), codec);
  const scale = 10 ** (gain / 20);
  const channels = Math.min(decoded.numberOfChannels, rendered.numberOfChannels), n = Math.min(decoded.length, rendered.length);
  // An in-place radix-2 transform of `block` points.
  const fft = (re, im) => {
    for (let i = 1, j = 0; i < block; i++) {
      let bit = block >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= block; len <<= 1) {
      const wr = Math.cos((-2 * Math.PI) / len), wi = Math.sin((-2 * Math.PI) / len);
      for (let i = 0; i < block; i += len) {
        for (let k = 0, cr = 1, ci = 0; k < len / 2; k++, [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr]) {
          const a = i + k, b = a + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        }
      }
    }
  };
  const hann = Float64Array.from({ length: block }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / block));
  // The last band also takes the Nyquist bin.
  const bins = block / 2 + 1, bands = (bins - 1) / band, bandOf = (k) => Math.min(bands - 1, Math.floor(k / band));
  const spectra = Array.from({ length: 6 }, () => new Float64Array(block)), shape = new Float64Array(bins);
  const blocks = [];
  for (let at = 0; at < n; at += block) {
    let signal = 0, error = 0;
    // Per band, the rendered, decoded and difference energies; per bin, the
    // windowed rendered power.
    const sums = Array.from({ length: bands }, () => [0, 0, 0]);
    shape.fill(0);
    for (let c = 0; c < channels; c++) {
      const r = rendered.getChannelData(c), d = decoded.getChannelData(c);
      const [xr, xi, yr, yi, wr, wi] = spectra;
      for (const s of spectra) s.fill(0);
      for (let i = at; i < Math.min(n, at + block); i++) {
        const x = scale * r[i];
        signal += x * x; error += (x - d[i]) ** 2;
        xr[i - at] = x; yr[i - at] = d[i]; wr[i - at] = x * hann[i - at];
      }
      fft(xr, xi); fft(yr, yi); fft(wr, wi);
      for (let k = 0; k < bins; k++) {
        const s = sums[bandOf(k)], m = (k === 0 || k === bins - 1 ? 1 : 2) / block;
        s[0] += m * (xr[k] ** 2 + xi[k] ** 2); s[1] += m * (yr[k] ** 2 + yi[k] ** 2); s[2] += m * ((xr[k] - yr[k]) ** 2 + (xi[k] - yi[k]) ** 2);
        shape[k] += wr[k] ** 2 + wi[k] ** 2;
      }
    }
    let noise = 0, noiseError = 0, envelope = 0;
    for (const [b, [want, got, diff]] of sums.entries()) {
      let power = 0, logs = 0;
      const lo = b * band, hi = b === bands - 1 ? bins : lo + band;
      for (let k = lo; k < hi; k++) { power += shape[k]; logs += Math.log(shape[k]); }
      if (!(Math.exp(logs / (hi - lo)) / (power / (hi - lo)) >= flatness)) continue;
      noise += want; noiseError += diff; envelope += (Math.sqrt(got) - Math.sqrt(want)) ** 2;
    }
    blocks.push([signal, error, noise, noiseError, envelope]);
  }
  return {
    gain, rate: rendered.sampleRate, block, blocks,
    channels: [decoded.numberOfChannels, rendered.numberOfChannels], length: [decoded.length, rendered.length],
  };
}

/**
 * A soundtrack's verdict from compareSound, for a film whose soundtrack is in
 * `codec`: the decoded film must have the rendered soundtrack's channels and
 * length exactly, and every block must be within the codec's SOUND_FLOOR_DB of
 * the render or differ from it by less than SOUND_GATE_DB. A block under the
 * floor still matches when the rest of it keeps the floor outside its
 * noise-like bands and those bands keep SOUND_NOISE_DB.
 */
function soundVerdict(s, codec) {
  if (s.error) return { match: false, detail: `the soundtrack does not decode: ${s.error}` };
  if (s.channels[0] !== s.channels[1]) return { match: false, detail: `the soundtrack decodes to ${s.channels[0]} channels and its recipe renders ${s.channels[1]}` };
  if (s.length[0] !== s.length[1]) return { match: false, detail: `the soundtrack decodes to ${s.length[0]} samples and its recipe renders ${s.length[1]}` };
  const floor = SOUND_FLOOR_DB[codec], name = codec === 'mp4a' ? 'AAC' : codec, { waveform, envelope: level } = SOUND_NOISE_DB;
  let worst = Infinity, noisy = 0, worstWave = Infinity, worstLevel = Infinity;
  for (const [i, [signal, error, noise, noiseError, envelope]] of s.blocks.entries()) {
    const samples = Math.min(s.block, s.length[1] - i * s.block) * s.channels[1];
    if (error / samples < 10 ** (SOUND_GATE_DB / 10)) continue;
    const db = 10 * Math.log10(signal / error);
    if (db >= floor) { worst = Math.min(worst, db); continue; }
    const differs = `the soundtrack differs from its recipe at ${((i * s.block) / s.rate).toFixed(3)} s: `
      + `that block decodes ${db.toFixed(1)} dB from the render, under the ${floor} dB floor for ${name}`;
    // The difference outside the noise-like bands, which rounding can take under zero.
    if (!(10 * Math.log10(signal / Math.max(0, error - noiseError)) >= floor)) return { match: false, detail: differs };
    const wave = 10 * Math.log10(noise / noiseError), kept = 10 * Math.log10(noise / envelope);
    if (!(wave >= waveform)) return { match: false, detail: `${differs}, and its noise-like bands follow the render's waveform at ${wave.toFixed(1)} dB, under ${waveform} dB` };
    if (!(kept >= level)) return { match: false, detail: `${differs}, and its noise-like bands keep the render's levels at ${kept.toFixed(1)} dB, under ${level} dB` };
    noisy++;
    worstWave = Math.min(worstWave, wave);
    worstLevel = Math.min(worstLevel, kept);
  }
  return { match: true, detail: `the ${name} soundtrack decodes to its recipe's ${s.length[1]} samples, every block within ${floor} dB of the render`
    + (worst < Infinity ? ` (worst ${worst.toFixed(1)} dB)` : noisy ? '' : ' or differing by less than the gate')
    + (noisy ? ` or, in its noise-like bands, within ${waveform} dB of its waveform and ${level} dB of its levels (${noisy} blocks, worst ${worstWave.toFixed(1)} and ${worstLevel.toFixed(1)} dB)` : '') };
}

/**
 * A film's verdict from its compared frames: each must decode within
 * FILM_FLOOR_DB of its redraw and at least as close to it as to either
 * neighbour's, a held frame tying with an identical neighbour. `heard`, the
 * soundtrack's verdict where there is one, must match too.
 */
function replayVerdict(rows, heard = null) {
  for (const r of rows) {
    if (!(r.psnr >= FILM_FLOOR_DB)) {
      return { match: false, detail: `frame ${r.frame} decodes at ${r.psnr} dB from its redraw, under the ${FILM_FLOOR_DB} dB floor` };
    }
    const closer = r.neighbours.find((n) => n.psnr > r.psnr);
    if (closer) return { match: false, detail: `frame ${r.frame} looks more like frame ${closer.frame} (${closer.psnr} dB) than itself (${r.psnr} dB)` };
  }
  if (heard && !heard.match) return heard;
  const worst = Math.min(...rows.map((r) => r.psnr));
  return { match: true, detail: `${rows.length} frames each within ${FILM_FLOOR_DB} dB of their redraw (worst ${worst} dB) and closest to their own`
    + (heard ? '; ' + heard.detail : '') };
}

// A PNG is lossless and the page drew it on a GPU canvas in Edge, so its redraw
// there is compared at full size, every channel, alpha included. It matches when
// every pixel is identical, or else within PNG_FLOOR_DB and at least as close to
// its own frame's redraw as to either neighbour's.
const PNG_FLOOR_DB = 40;

/** A PNG's width and height, from its IHDR. */
function pngSize(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { w: view.getUint32(16), h: view.getUint32(20) };
}

/**
 * Check a PNG against the piece before any browser starts: the scale it names,
 * the size that scale gives, and a playhead on the piece's frame grid. Names
 * the frames to redraw, its own and its neighbours'.
 */
function pngPlan(bytes, manifest, piece) {
  const k = manifest.scale;
  if (!(typeof k === 'number' && Number.isFinite(k) && k > 0)) throw new Error('replay: the PNG\'s manifest names no scale it was drawn at');
  const size = { w: Math.round(piece.size.w * k), h: Math.round(piece.size.h * k) };
  const got = pngSize(bytes);
  if (got.w !== size.w || got.h !== size.h) throw new Error(`replay: the PNG is ${got.w} x ${got.h} and ${piece.name} at scale ${k} draws ${size.w} x ${size.h}`);
  const heads = playheads(piece);
  const at = heads.indexOf(manifest.t);
  if (at < 0) throw new Error(`replay: the PNG's playhead ${JSON.stringify(manifest.t)} is not a frame of ${piece.name}`);
  return { heads, at, frames: [at - 1, at, at + 1].filter((i) => i >= 0 && i < heads.length) };
}

// Serialized into the page. The saved PNG is decoded there and compared with a
// redraw of each named frame at the recipe and scale, each on a fresh GPU
// canvas read back once, as the page's PNG button draws.
async function comparePng(bytes, recipe, heads, frames) {
  const api = window.__artifex;
  if (!Object.prototype.hasOwnProperty.call(api.examples, recipe.piece)) throw new Error('replay: the page has no piece named ' + JSON.stringify(recipe.piece));
  const p = api.piece.atBox(api.piece.validate(api.examples[recipe.piece]), recipe.size);
  const solved = api.piece.solve(p, recipe.seed, recipe.params);
  const W = Math.round(p.size.w * recipe.scale), H = Math.round(p.size.h * recipe.scale);
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const canvas = (options) => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c.getContext('2d', options); };
  const read = canvas({ willReadFrequently: true });
  read.drawImage(bitmap, 0, 0);
  const saved = read.getImageData(0, 0, W, H).data;
  return frames.map((i) => {
    const g = canvas();
    api.render.drawFrame(g, p, solved, heads[i], { scale: recipe.scale });
    const drawn = g.getImageData(0, 0, W, H).data;
    let se = 0, max = 0, pixels = 0;
    for (let q = 0; q < saved.length; q += 4) {
      let off = false;
      for (let c = 0; c < 4; c++) { const d = saved[q + c] - drawn[q + c]; if (d) { se += d * d; max = Math.max(max, Math.abs(d)); off = true; } }
      if (off) pixels++;
    }
    return { frame: i, psnr: se ? +(10 * Math.log10((255 * 255 * saved.length) / se)).toFixed(2) : 99, pixels, max };
  });
}

/** A PNG's verdict from its own frame's comparison and its neighbours'. */
function pngVerdict(rows, at, size) {
  const own = rows.find((r) => r.frame === at);
  if (own.pixels === 0) return { match: true, detail: `${size.w} x ${size.h} pixels, identical to the redraw` };
  if (!(own.psnr >= PNG_FLOOR_DB)) {
    return { match: false, detail: `${own.pixels} pixels differ from the redraw, by up to ${own.max} levels: ${own.psnr} dB, under the ${PNG_FLOOR_DB} dB floor` };
  }
  const closer = rows.find((r) => r.frame !== at && r.psnr > own.psnr);
  if (closer) return { match: false, detail: `the PNG looks more like frame ${closer.frame} (${closer.psnr} dB) than its own frame ${at} (${own.psnr} dB)` };
  return { match: true, detail: `${own.pixels} pixels differ from the redraw, by up to ${own.max} levels: ${own.psnr} dB, and closest to its own frame` };
}

/** A WebM's frame size, from the Video element of its first TrackEntry. */
function webmSize(bytes) {
  const size = {};
  for (let p = 0; p < bytes.length && !(size.w && size.h);) {
    const e = ebmlHead(bytes, p);
    if (e.idLen > 4 || e.sizeLen > 8) break;
    // Into the Segment, Tracks, TrackEntry and Video; over everything else.
    if ([0x18538067, 0x1654AE6B, 0xAE, 0xE0].includes(e.id)) { p = e.body; continue; }
    if (e.id === 0x1F43B675 || e.unknown) break;
    if (e.id === 0xB0 || e.id === 0xBA) {
      let v = 0;
      for (let i = 0; i < e.size; i++) v = v * 256 + bytes[e.body + i];
      size[e.id === 0xB0 ? 'w' : 'h'] = v;
    }
    p = e.body + e.size;
  }
  return size;
}

/**
 * Check a WebM against the piece before any browser starts, as filmPlan checks
 * an MP4, and name the frames to compare and where to seek for each. The
 * recorder stamps blocks by the wall clock, so each frame is sought midway
 * through its own block, from the file's block times, never at (i + 0.5) / hz.
 */
function webmPlan(bytes, manifest, piece) {
  const grid = manifest.film;
  if (!grid) throw new Error('replay: the film\'s manifest has no frame grid');
  if (!piece.time) throw new Error(`replay: the file is a film and ${piece.name} is now a still`);
  const now = { frames: playheads(piece).length, hz: piece.time.hz, loop: !!piece.time.loop };
  const off = ['frames', 'hz', 'loop'].find((k) => grid[k] !== now[k]);
  if (off) throw new Error(`replay: the film's frame grid has ${off} ${JSON.stringify(grid[off])} and ${piece.name} now has ${JSON.stringify(now[off])}`);
  const times = webmBlockTimes(bytes);
  if (times.length !== grid.frames) throw new Error(`replay: the film holds ${times.length} of the ${grid.frames} frames its manifest names`);
  const size = { w: Math.round(piece.size.w * grid.scale), h: Math.round(piece.size.h * grid.scale) };
  const got = webmSize(bytes);
  if (got.w !== size.w || got.h !== size.h) throw new Error(`replay: the film is ${got.w} x ${got.h} and ${piece.name} at scale ${grid.scale} draws ${size.w} x ${size.h}`);
  const frames = filmFrames(grid.frames);
  const end = (i) => (i + 1 < times.length ? times[i + 1] : times[i] + 1000 / grid.hz);
  return { frames, seeks: frames.map((i) => (times[i] + end(i)) / 2000) };
}

// Serialized into the page. As compareFilm, but the saved WebM is sought at the
// given seconds and each decoded frame is read through a VideoFrame: drawing
// the video element itself put a software-decoded frame's blue up to 12 levels
// off in Edge.
async function compareWebm(bytes, recipe, frames, seeks) {
  const api = window.__artifex;
  if (!Object.prototype.hasOwnProperty.call(api.examples, recipe.piece)) throw new Error('replay: the page has no piece named ' + JSON.stringify(recipe.piece));
  const p = api.piece.atBox(api.piece.validate(api.examples[recipe.piece]), recipe.size);
  const solved = api.piece.solve(p, recipe.seed, recipe.params);
  const heads = api.render.playheads(p);
  const video = document.createElement('video');
  video.muted = true;
  video.src = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }));
  await new Promise((resolve, reject) => {
    video.onloadeddata = resolve;
    video.onerror = () => reject(new Error('replay: the film does not decode in this browser'));
  });
  const W = video.videoWidth, H = video.videoHeight;
  const w = 240, h = Math.max(2, Math.round((240 * H) / W));
  const small = document.createElement('canvas');
  small.width = w; small.height = h;
  const sg = small.getContext('2d', { willReadFrequently: true });
  const full = document.createElement('canvas');
  full.width = W; full.height = H;
  const fg = full.getContext('2d');
  const shrink = (source) => { sg.clearRect(0, 0, w, h); sg.drawImage(source, 0, 0, w, h); return sg.getImageData(0, 0, w, h).data; };
  const drawn = (i) => { fg.clearRect(0, 0, W, H); api.render.drawFrame(fg, p, solved, heads[i], { scale: recipe.film.scale }); return shrink(full); };
  const psnr = (got, want) => {
    let se = 0;
    for (let k = 0; k < got.length; k += 4) for (let c = 0; c < 3; c++) se += (got[k + c] - (want[k + c] * want[k + 3]) / 255) ** 2;
    return se ? +(10 * Math.log10((255 * 255 * got.length * 0.75) / se)).toFixed(2) : 99;
  };
  const rows = [];
  for (let n = 0; n < frames.length; n++) {
    const i = frames[n];
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('replay: seeking the film to frame ' + i + ' timed out')), 10000);
      video.onseeked = () => { clearTimeout(timer); resolve(); };
      video.currentTime = seeks[n];
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    const frame = new VideoFrame(video);
    let got;
    try { got = shrink(frame); } finally { frame.close(); }
    rows.push({
      frame: i, psnr: psnr(got, drawn(i)),
      neighbours: [i - 1, i + 1].filter((j) => j >= 0 && j < heads.length).map((j) => ({ frame: j, psnr: psnr(got, drawn(j)) })),
    });
  }
  URL.revokeObjectURL(video.src);
  return rows;
}

// Edge closes the DevTools connection at a 100 MB message, and a file travels
// as base64, a third larger. So a file goes into the page once, PIECE_BYTES at a
// time, a multiple of 3 so that each piece encodes on its own, and every page
// function reads it from there.
const PIECE_BYTES = 12 * 1024 * 1024;

/**
 * Put `bytes` in the page as window.__replayBytes, one message per piece, and
 * check that every byte arrived. `run` is check-browser's evaluate.
 */
async function sendBytes(client, bytes, run = evaluate, piece = PIECE_BYTES) {
  await run(client, 'window.__replayBytes = new Uint8Array(' + bytes.length + '); 0');
  let held = 0;
  for (let at = 0; at < bytes.length; at += piece) {
    const b64 = JSON.stringify(Buffer.from(bytes.subarray(at, at + piece)).toString('base64'));
    held += await run(client, '(() => { const s = atob(' + b64 + '), b = window.__replayBytes; '
      + 'for (let i = 0; i < s.length; i++) b[' + at + ' + i] = s.charCodeAt(i); return s.length; })()');
  }
  if (held !== bytes.length) throw new Error(`replay: the page received ${held} of the file's ${bytes.length} bytes`);
}

/** A PNG or WebM compared in installed Edge; resolves to what replay() adds for it. */
async function replayInEdge(type, bytes, manifest, piece, external, browser) {
  const plan = type === 'png' ? pngPlan(bytes, manifest, piece) : webmPlan(bytes, manifest, piece);
  const call = type === 'png'
    ? '(' + comparePng.toString() + ')(window.__replayBytes, ' + [manifest, plan.heads, plan.frames].map((v) => JSON.stringify(v)).join(', ') + ')'
    : '(' + compareWebm.toString() + ')(window.__replayBytes, ' + [manifest, plan.frames, plan.seeks].map((v) => JSON.stringify(v)).join(', ') + ')';
  const page = html(bundle(external), external ? { count: 1 } : {});
  const report = await withEdge(page, browser || {}, async (client, context) => {
    await waitFor(client, context, 'document.readyState === "complete" && !!window.__artifex');
    context.phase = type + ' replay';
    await sendBytes(client, bytes);
    const rows = await evaluate(client, call);
    if (context.errors.length) throw new Error('browser: page errors:\n' + context.errors.join('\n'));
    return { browser: context.version.Browser, rows };
  });
  const verdict = type === 'png' ? pngVerdict(report.rows, plan.at, pngSize(bytes)) : replayVerdict(report.rows);
  return { browser: report.browser, frames: report.rows, ...verdict };
}

/**
 * Replay `file`. Resolves to { file, type, manifest, match, detail } and, for a
 * PNG or a film, the browser and the compared frames; throws when the file cannot be
 * replayed. `options`: `piece`, a module path; `cwd`, the directory relative
 * paths start from; `browser`, options for the Edge check.
 */
async function replay(file, options = {}) {
  const cwd = options.cwd || callerDirectory();
  const bytes = new Uint8Array(fs.readFileSync(path.resolve(cwd, file)));
  const { type, manifest } = manifestOf(bytes, file);
  const { piece, external } = pieceFor(manifest, options.piece, cwd);
  if (type === 'svg') return { file, type, manifest, ...replaySvg(bytes, manifest, piece) };
  if (type === 'png' || type === 'webm') return { file, type, manifest, ...await replayInEdge(type, bytes, manifest, piece, external, options.browser) };
  const frames = filmPlan(bytes, manifest, piece);
  const plan = soundPlan(bytes, piece);
  const page = html(bundle(external), external ? { count: 1 } : {});
  const recipe = JSON.stringify(manifest);
  const report = await withEdge(page, options.browser || {}, async (client, context) => {
    await waitFor(client, context, 'document.readyState === "complete" && !!window.__artifex');
    context.phase = 'film replay';
    await sendBytes(client, bytes);
    const rows = await evaluate(client, '(' + compareFilm.toString() + ')(' + ['window.__replayBytes', recipe, JSON.stringify(frames)].join(', ') + ')');
    let sound = null;
    if (plan && plan.codec) {
      context.phase = 'soundtrack replay';
      sound = await evaluate(client, '(' + compareSound.toString() + ')(' + ['window.__replayBytes', recipe, SOUND_BLOCK, JSON.stringify(plan.codec), SOUND_BAND, SOUND_FLATNESS].join(', ') + ')');
    }
    if (context.errors.length) throw new Error('browser: page errors:\n' + context.errors.join('\n'));
    return { browser: context.version.Browser, rows, sound };
  });
  const heard = plan && plan.codec ? soundVerdict(report.sound, plan.codec) : plan;
  const sound = heard && { ...heard, ...(report.sound && { gain: report.sound.gain, length: report.sound.length }) };
  return { file, type, manifest, browser: report.browser, frames: report.rows, ...(sound && { sound }), ...replayVerdict(report.rows, heard) };
}

function parseArgs(args) {
  const out = { file: null, piece: null, browser: {} };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--piece') out.piece = args[++i];
    else if (a === '--edge') out.browser.edge = args[++i];
    else if (a === '--timeout-ms') out.browser.timeoutMs = Number(args[++i]);
    else if (a === '--headed') out.browser.headed = true;
    else if (a.startsWith('--') || out.file) throw new Error(USAGE);
    else out.file = a;
  }
  if (!out.file || (out.piece !== null && !out.piece)) throw new Error(USAGE);
  const ms = out.browser.timeoutMs;
  if (ms !== undefined && (!Number.isSafeInteger(ms) || ms < 100 || ms > 300000)) throw new Error('replay: --timeout-ms must be an integer from 100 to 300000');
  return out;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await replay(options.file, options);
  console.log(JSON.stringify(result, null, 2));
  console.log(`replay: ${result.file} (${result.type}, ${result.manifest.piece} seed ${result.manifest.seed}): ${result.match ? 'matches' : 'DIFFERS'}; ${result.detail}`);
  if (!result.match) process.exitCode = 1;
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = {
  fileType, manifestOf, pieceFor, replaySvg, filmPlan, filmFrames, replayVerdict, compareFilm, replay, parseArgs, FILM_FLOOR_DB,
  soundPlan, compareSound, soundVerdict, SOUND_BLOCK, SOUND_FLOOR_DB, SOUND_GATE_DB, SOUND_BAND, SOUND_FLATNESS, SOUND_NOISE_DB,
  pngPlan, pngVerdict, comparePng, webmPlan, compareWebm, PNG_FLOOR_DB, sendBytes, PIECE_BYTES,
};
