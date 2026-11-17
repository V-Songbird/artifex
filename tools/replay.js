'use strict';

// Replay a saved file from the recipe it carries.
//
// An SVG, PNG, MP4 or WebM film that Artifex saved names the library version,
// the piece, its seed and parameters, and the frame, scale or frame grid it was
// drawn from. This reads that manifest back and finds the piece: the registered
// example of that name or the module the caller passes with --piece, never a
// path the file names. --style is refused, since a style draws nothing. It refuses a
// file made by another library version, for another piece, or for a box,
// outputs, size, frame grid or image the piece no longer has, naming the difference. Then it draws the recipe again and compares: an
// SVG byte for byte in Node; a PNG pixel for pixel, a film frame by frame and
// an MP4 film's soundtrack block by block, in installed Edge. A film joined by
// `npm run stitch` is replayed scene by scene, each against its own recipe.
//
//   npm run replay -- <file> [--piece ./piece.cjs] [--edge PATH] [--timeout-ms N] [--headed] [--dump DIR] [--save-frames LIST]
//
// --dump writes an MP4 film's decoded soundtrack and its levelled render as
// WAV files, and the per-block figures as JSON, into DIR. --save-frames writes
// the MP4 film's decoded frames that LIST names, by number or by seconds ending
// in s, as full-size PNG files into <film name>-frames beside the report.
// --lag measures how many frames another film of the piece runs behind it
// around --at, over --region when given: a check beside the verdict, never
// part of it.
//
// Exits 0 when the file matches and 1, with the first difference named, when
// it does not or cannot be replayed.

const fs = require('node:fs');
const path = require('node:path');
const { validate, atBox, VERSION } = require('../core/piece.js');
const { renderVector, playheads } = require('../core/render.js');
const { readMp4 } = require('../core/film.js');
const { svgManifest } = require('../core/surface-vector.js');
const { describe } = require('../core/image.js');
const { film: playFilm, digest } = require('../core/play.js');
const EXAMPLES = require('../examples/index.js');
const { loadExternal, callerDirectory, inLibrary, slash, outRoot } = require('./piece-input.js');
const { bundle, html } = require('./build-page.js');
const { pngManifest, webmManifest, webmBlockTimes, ebmlHead } = require('../core/export.js');
const { withEdge, waitFor, evaluate, evaluateInPieces, pageErrors, saveReport, TIMEOUT_MS, timeoutArg } = require('./check-browser.js');
const { frameGap, FRAME_THRESHOLD, FRAME_GRID } = require('./contact-sheet.js');

const USAGE = 'usage: npm run replay -- <file> [--piece ./piece.cjs ...] [--edge PATH] [--timeout-ms N] [--headed] [--json] [--seed N] [--dump DIR] [--save-frames 0,24,2.5s] [--lag other.mp4 --at 2.5s] [--region x,y,w,h]';

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
 * `loaded`, loadExternal's result for `modulePath`, spares loading it again.
 */
function pieceFor(manifest, modulePath = null, cwd = callerDirectory(), loaded = null) {
  if (manifest.artifex !== VERSION) {
    throw new Error(`replay: the file was made by artifex ${JSON.stringify(manifest.artifex)} and this is ${VERSION}; replay it with that version`);
  }
  let piece, external = null;
  if (modulePath) {
    external = loaded || loadExternal(modulePath, cwd);
    piece = external.piece;
  } else if (Object.prototype.hasOwnProperty.call(EXAMPLES, manifest.piece)) {
    piece = validate(EXAMPLES[manifest.piece]);
  } else {
    throw new Error(`replay: no registered example is named ${JSON.stringify(manifest.piece)}; pass its module with --piece`);
  }
  if (piece.name !== manifest.piece) {
    throw new Error(`replay: the file names piece ${JSON.stringify(manifest.piece)} and ${modulePath} is ${JSON.stringify(piece.name)}`);
  }
  // A piece that declares boxes is drawn again at the box, or the box
  // timeline, the file names, if it still accepts it; one that does not keeps
  // its size, compared below.
  if (manifest.reframe !== undefined && !Array.isArray(manifest.reframe)) {
    throw new Error(`replay: the file names a box timeline that is not a list, ${JSON.stringify(manifest.reframe)}`);
  }
  const plan = manifest.reframe || manifest.size;
  if ((piece.boxes || manifest.reframe) && plan && typeof plan === 'object') {
    try { piece = atBox(piece, plan); } catch (e) { throw new Error(`replay: the file was drawn at ${JSON.stringify(plan)} and ${e.message.replace(/^atBox: /, '')}`); }
  }
  if (!same(manifest.size, { w: piece.size.w, h: piece.size.h })) {
    throw new Error(`replay: the file was drawn at ${JSON.stringify(manifest.size)} and ${piece.name} now draws at ${JSON.stringify(piece.size)}`);
  }
  if (!same(manifest.outputs, piece.outputs)) {
    throw new Error(`replay: the file names outputs ${JSON.stringify(manifest.outputs)} and ${piece.name} now declares ${JSON.stringify(piece.outputs)}`);
  }
  const changed = imageChange(manifest.images, piece);
  if (changed) throw new Error(`replay: ${changed}`);
  return { piece, external };
}

/**
 * A file drawn from an interactive piece's saved session, `file` its path:
 * the session's film, to draw it again, from the session file the manifest
 * names. That file must sit beside `file` and hold the log the manifest's
 * digest names, over the ticks it names; anything else is refused by name.
 * Returns { piece, session }, `session` ({ file, name }) as the page takes it.
 */
function sessionFor(file, manifest, piece) {
  const s = manifest.session;
  if (!s || typeof s !== 'object' || typeof s.file !== 'string' || !s.file || path.basename(s.file) !== s.file) {
    throw new Error(`replay: the file was drawn from a session and names no session file, ${JSON.stringify(s)}; npm run film and npm run still with --session make one that replay can check`);
  }
  const beside = path.join(path.dirname(file), s.file);
  let text, saved, film;
  try { text = fs.readFileSync(beside, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') throw new Error(`replay: the file was drawn from the session ${s.file}, and no file of that name is beside it at ${slash(beside)}; put the session file there`);
    throw e;
  }
  try { saved = JSON.parse(text); } catch (e) { throw new Error(`replay: ${slash(beside)} is not a session: ${e.message}`); }
  try { film = playFilm(piece, saved, s.file); } catch (e) {
    if (e.name !== 'PieceError') throw e;
    throw new Error(`replay: ${slash(beside)}: ${e.message}`);
  }
  const now = digest(saved.log);
  if (now !== s.digest) {
    throw new Error(`replay: the file was drawn from a session whose log has digest ${JSON.stringify(s.digest)}, and ${slash(beside)} holds another log, digest ${now}; replay it beside the session it was played from`);
  }
  if (saved.ticks !== s.ticks) throw new Error(`replay: the file was drawn from ${JSON.stringify(s.ticks)} ticks of its session, and ${slash(beside)} holds ${saved.ticks}`);
  return { piece: film, session: { file: saved, name: s.file } };
}

/** Makes the page's piece of `session` ({ file, name }) that session's film, as the export drew it. */
const useSession = (client, session) => evaluate(client, 'window.__artifex.session(' + JSON.stringify(session.file) + ', ' + JSON.stringify(session.name) + '), true');

/** How the images a file names differ from those `piece` declares, naming the first image that differs, or null. */
function imageChange(saved, piece) {
  if (saved !== undefined && (!saved || typeof saved !== 'object' || Array.isArray(saved))) return `the file names images that are not an object, ${JSON.stringify(saved)}`;
  const was = saved || {}, now = piece.images ? describe(piece.images) : {};
  for (const name of new Set([...Object.keys(was), ...Object.keys(now)])) {
    if (!Object.prototype.hasOwnProperty.call(now, name)) return `the file was drawn with image ${JSON.stringify(name)} and ${piece.name} no longer declares it`;
    if (!Object.prototype.hasOwnProperty.call(was, name)) return `${piece.name} now declares image ${JSON.stringify(name)}, which the file was drawn without`;
    const old = was[name] && typeof was[name] === 'object' ? was[name] : {};
    for (const key of ['digest', 'w', 'h', 'channels', 'source', 'rights']) {
      if (!same(old[key], now[name][key])) {
        return `the file was drawn with image ${JSON.stringify(name)} at ${key} ${JSON.stringify(old[key])} and ${piece.name} now declares ${JSON.stringify(now[name][key])}`;
      }
    }
  }
  return null;
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
 * any browser starts, and name the frames to compare. `frames`, a joined
 * film's scene, is the range [from, to) of the film's frames the scene holds.
 */
function filmPlan(bytes, manifest, piece, frames = null) {
  const grid = manifest.film;
  if (!grid) throw new Error('replay: the film\'s manifest has no frame grid');
  if (!piece.time) throw new Error(`replay: the file is a film and ${piece.name} is now a still`);
  const now = { frames: playheads(piece).length, hz: piece.time.hz, loop: !!piece.time.loop };
  for (const k of ['frames', 'hz', 'loop']) {
    if (grid[k] !== now[k]) throw new Error(`replay: the film's frame grid has ${k} ${JSON.stringify(grid[k])} and ${piece.name} now has ${JSON.stringify(now[k])}`);
  }
  const video = readMp4(bytes).tracks.find((t) => t.kind === 'vide');
  const held = !video ? 0 : frames ? Math.min(frames[1], video.samples) - frames[0] : video.samples;
  if (held !== grid.frames) throw new Error(`replay: the ${frames ? 'scene' : 'film'} holds ${held} of the ${grid.frames} frames its manifest names`);
  const size = { w: even(piece.size.w * grid.scale), h: even(piece.size.h * grid.scale) };
  if (video.width !== size.w || video.height !== size.h) {
    throw new Error(`replay: the film is ${video.width} x ${video.height} and ${piece.name} at scale ${grid.scale} draws ${size.w} x ${size.h}`);
  }
  return filmFrames(grid.frames);
}

// Serialized into the page. The saved film is decoded there, and each named
// frame, read through a VideoFrame, is compared with its redraw at the recipe
// on a GPU canvas, as the export draws, and with its neighbours' redraws. Drawn
// pixels are taken over black, as every film is. A joined film's scene starts
// at the film's frame `first`. The page keeps one object URL for `bytes`, so
// the scenes of a joined film share it; it lasts as long as the page.
async function compareFilm(bytes, recipe, frames, first = 0) {
  const api = window.__artifex;
  if (!Object.prototype.hasOwnProperty.call(api.examples, recipe.piece)) throw new Error('replay: the page has no piece named ' + JSON.stringify(recipe.piece));
  const p = api.piece.atBox(api.piece.validate(api.examples[recipe.piece]), recipe.reframe || recipe.size);
  const solved = api.piece.solve(p, recipe.seed, recipe.params);
  const heads = api.render.playheads(p);
  const cache = (window.__replayHeld = window.__replayHeld || new Map());
  if (!cache.has(bytes)) cache.set(bytes, {});
  const kept = cache.get(bytes);
  const video = document.createElement('video');
  video.muted = true;
  video.src = kept.url = kept.url || URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
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
    // A frame the browser cannot seek to ends the comparison as a row of its own.
    const sought = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 10000);
      video.onseeked = () => { clearTimeout(timer); resolve(true); };
      video.currentTime = (first + i + 0.5) / p.time.hz;
    });
    if (!sought) { rows.push({ frame: i, seekTimeoutMs: 10000 }); break; }
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
  return rows;
}

// A soundtrack is compared in blocks of SOUND_BLOCK samples. Each block of the
// decoded film must be within its codec's SOUND_FLOOR_DB of the recipe's
// soundtrack, levelled as the export levels it, unless their difference is
// quieter than SOUND_GATE_DB of full scale, where the codec's own noise decides.
// Measured in installed Edge on readout and cues, every judged block of an AAC
// film decoded at 34.8 dB or better from its render and of an Opus film at
// 23.6 dB or better, and on settle, whose soundtrack has since become short
// events, at 31.2 dB as AAC and 23.3 dB as Opus; the next seed's soundtrack of
// readout came within -7 dB, of settle within 5.7 dB at its first block, and
// of cues within 24.2 dB as AAC and 20.1 dB as Opus.
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
// Judged together, those bands let a quiet noise voice replaced by another pass
// under louder ones, and the block's floor lets a tone moved under loud noise
// pass. So each noise-like band under SOUND_VOICE.below Hz that holds
// SOUND_VOICE.share dB of its block or more must follow the render's waveform
// within SOUND_NOISE_DB.waveform on its own too, and the rest of the block,
// outside the noise-like bands, must follow its own waveform within
// SOUND_NOISE_DB.rest unless its difference is under the gate: a moved or
// missing tone comes to about -3 and 0 dB, one 6 dB quieter to 6 dB. Opus codes
// everything from 15.6 kHz up as one band, whose waveform it keeps loosely, so
// bands are judged alone only below 14 kHz: an Opus film of bright sine grains
// over near-silence decoded its 14.25 to 15 kHz band at 2.7 dB. With the limit
// at 14 kHz, in installed Edge 157, 17 films of each codec matched their own
// recipes and 7 wrong soundtracks of each still differed. The figures below
// were taken with the limit at 15 kHz. Measured in installed Edge on the
// blocks under their floor in films of readout, cues, settle, the noise, drum
// and speech fixtures, and of the noise fixture with added parts, each as AAC
// and as Opus, noise-like bands under 15 kHz holding -25 dB of their block or
// more decoded at 11.8 dB or better by waveform, and the rest at 15.3 dB or
// better; above 15 kHz an Opus film's bands came to 3.6 dB. Films whose quiet
// noise voice came from another seed named bands at 0.2 dB or less, and one
// whose tone 30 dB under a noise moved, which Opus's floor let pass, a rest at
// 7.1 dB.
const SOUND_BAND = 16;
const SOUND_FLATNESS = 0.4;
const SOUND_NOISE_DB = { waveform: 3, envelope: 18, rest: 10 };
const SOUND_VOICE = { share: -25, below: 14000 };

// A perceptual codec may also code tones coarsely where a noise masks them: a
// noise bed under chirping grains in its own band leaves those bands too tonal
// to count as noise-like, and the codec's error there sits under the bed. So a
// band that is not noise-like, in a block under its floor, is left out of the
// floor when its difference lies its codec's SOUND_MASK_DB or more under the
// render's own noise floor in that band, its median bin over all its bins; the
// rest of the block must still keep its own waveform within SOUND_NOISE_DB.rest.
// Measured in installed Edge 154 on AAC films of an ambience of grains, 0.05 at
// their peak over a noise bed at 0.004 or 0.012, ringing 0.03, 0.08 or 0.15 s,
// plain or chirping, every block under the AAC floor passed with its bands'
// difference 9.6 dB or more under their noise floor; the same render judged
// against its film moved by one sample, 1 ms or a block, silenced, halved,
// without its bed or with its grains risen over 10 ms kept the AAC floor only
// with a mask of -3.6 dB or more. Opus films of grains 50 times their bed's
// level, three of ten, needed a mask of -6.2, -4.6 and -4.6 dB; the render
// judged against those films and one of grains 12.5 times their bed, moved by
// one sample, 1 ms or a block, silenced, halved or with its grains risen slowly,
// kept the Opus floor only with a mask of 6.6 dB or more, so Opus takes -3 dB.
// Grains 50 times their bed's level still lie beyond the rule as AAC, needing
// -5.2 to -2.0 dB, and 71 times or more on both codecs (see output-formats.md).
const SOUND_MASK_DB = { mp4a: -6, Opus: -3 };

// A perceptual codec also cuts the top of the spectrum, and Opus removes the
// mean, which is not heard. So a block is judged without its first bin (0 to
// 23 Hz), and below the band the film's codec kept, measured over the whole
// film from each bin's Hann-windowed power: scanning down from the top, bins
// where the film holds SOUND_CUT.lost dB or more under the render, then at most
// one band of SOUND_BAND bins of transition, then a bin within SOUND_CUT.kept
// dB of it; bins the render holds SOUND_CUT.quiet dB under its loudest are no
// evidence either way. The cut is taken only when that edge lies above
// SOUND_CUT.above Hz, and every band from the one that holds the edge upwards
// goes unjudged. Measured in installed Edge on a film of hi-hats, a breath, a
// fricative, plucks, a pop and a hiss, the AAC film kept the render within
// 0.4 dB to 18.52 kHz and lost 10 dB or more from 18.66 kHz, and the Opus film
// within 0.7 dB to 19.97 kHz and 10 dB or more from 20.11 kHz; every block
// under a floor was a block with sound above the cut, or, in Opus, with a
// pluck's mean.
const SOUND_CUT = { kept: 2, lost: 10, quiet: 60, above: 12000 };

// AAC codes sparse noise, contacts a few milliseconds long, more coarsely than
// a steady one, in two ways. First, a short burst's Hann-windowed spectrum
// rests on few independent cells, so a band of plain noise can fall under
// SOUND_FLATNESS by chance and be judged as a tone. So a band of flatness
// SOUND_SPARSE.near or more whose judged neighbours are all noise-like counts as
// noise-like too, and, where it holds SOUND_VOICE.share dB of its block or more
// under SOUND_VOICE.below Hz, is judged on its own, even beside an onset: its
// waveform within SOUND_NOISE_DB.waveform, and its level within
// SOUND_SPARSE.envelope dB, the error summed as the envelope's is. A quieter
// near band is judged only with the others, as a quiet noise-like band is.
// A tone two to four times its band's noise lies in that range: moved or
// dropped it misses the waveform, 6 dB quieter the level. Second, around an
// onset AAC codes in short windows, coarser in frequency, and spreads its noise
// over its window, into the quiet top bands after a sound stops. So in a block
// where the render's loudest eighth of a block, in it or in a block beside it,
// lies SOUND_SPARSE.onset dB or more over the block's mean eighth, noise-like
// bands are judged together only, near bands still on their own, and their
// levels under SOUND_VOICE.below Hz only, within SOUND_SPARSE.envelope dB.
// Measured in installed Edge 154 on the AAC films of the seven early seams of
// the site at seeds 1 to 3, 14 of 21 differed without these rules and all
// matched with them: near bands down to a flatness of 0.24 decoded at 6.2 dB
// or better by waveform under 15 kHz, and those judged alone at 13.8 dB or
// better by level; a film of stride, a near band 35 dB under its block
// following its waveform at -0.1 dB, matched once that band was judged only
// with the others; in blocks beside an onset single bands came to 1.0 dB and
// levels to 17.8 dB under 15 kHz, 11.8 dB with the bands above. The seed-1
// films of four seams judged against 19 changed recipes (another seed; a voice
// 3 dB quieter, dropped, 5 ms late or 12% higher) differed wherever the rules
// before these did beyond their own films' blocks; snaps 12% higher in two
// seams and quiet glints 3 dB quieter passed under both, changes within the
// codec's noise. Opus codes short events coarsely too: in installed Edge 155
// its films of tests/fixtures/grain-film.cjs at seeds 1 to 6 each differed
// without these rules, five first by a noise-like band following its waveform
// at -2.2 to 2.7 dB or keeping its levels at 17.9 dB, and seeds 3 and 4 still
// beyond SOUND_SPILL_DB; with them all six matched, and its films of
// burst-film.cjs at seeds 1 to 3 matched with and without them. Those nine
// films judged with these rules against changed recipes (another seed; moved
// by a sample, 1 ms or a block; 3 dB quieter or louder) each still differed at
// a block no louder than its neighbours by SOUND_SPILL_DB.louder. So both
// codecs get these rules.
const SOUND_SPARSE = { near: 0.2, onset: 6, envelope: 12 };

// A block's plain figure slides through its floor with the share of a noise
// burst it holds, so by frame phase alone the same sound would be judged by the
// floor in one film and by the noise rules in the next. So a block with
// noise-like bands within SOUND_NEAR_DB over its floor is judged by every rule
// for a block under it, and its figure is not reported as the worst over the
// floor. Measured in installed Edge 154 on AAC films of stride at seeds 1 to
// 12, the worst block judged by the floor alone came to 25.55 dB at seed 9 and
// 26.45 dB or more at the others; with this rule, seed 9's two blocks at 25.55
// and 25.97 dB followed their noise-like bands' waveform at 18.0 dB or better,
// and the one block under the floor, at seed 12, at 17.3 dB, while the worst
// block judged by the floor alone came to 26.45 dB. Opus takes the same 1 dB:
// in installed Edge, the Opus film of tests/fixtures/noise-film.cjs replayed
// against that fixture with its hi-hats 3 dB quieter matched by the floor
// alone, its worst block at 15.8 dB, and with this rule differed there, its
// noise-like bands keeping their levels at 8.4 dB. The film's own recipe, the
// Opus films of readout, cues, settle, cascade and stride, of the drum and
// speech fixtures and of tests/fixtures/grain-film.cjs at seeds 1 to 6 all
// still matched, at 1 dB and at 2.
const SOUND_NEAR_DB = { mp4a: 1, Opus: 1 };

// A codec codes each block in a window that spans the blocks either side of it,
// so a loud event spreads its coding noise into a quiet block beside it, such
// as the faint end of a grain that rang out in the block before, where nothing
// masks it. So a block that every rule above refuses still matches beside a
// block whose render is SOUND_SPILL_DB.louder dB or more over its own, when its
// difference lies its codec's SOUND_SPILL_DB.under dB or more under that
// block's render. Measured in installed Edge 154 on AAC films of core/sound.js
// ambience grains 5 to 80 ms long with no bed, at seeds 1 to 6, 4 of 23
// differed, each by one block after a grain's loudest block, decoding -0.1 to
// 22.2 dB from the render: that block was 15.2 to 41.9 dB louder than its own
// render and 35.7 to 44.7 dB over its difference. Their recipes changed (another
// seed, the grains 1 ms late) still differed. Opus spreads more: in installed Edge 155
// its films of tests/fixtures/grain-film.cjs at seeds 1 to 6, judged with SOUND_SPARSE, left
// 10 such blocks, 17.9 dB or more under their louder neighbour and 28.2 to
// 46.7 dB under it by their difference, so Opus takes 25 dB.
const SOUND_SPILL_DB = { under: { mp4a: 30, Opus: 25 }, louder: 12 };

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
  // A codec the floor names and another table lacks would compare against undefined and pass or fail by accident.
  for (const [table, rules] of Object.entries({ SOUND_MASK_DB, SOUND_NEAR_DB, 'SOUND_SPILL_DB.under': SOUND_SPILL_DB.under })) {
    if (!Object.prototype.hasOwnProperty.call(rules, track.codec)) throw new Error(`replay: ${table} has no entry for the codec ${JSON.stringify(track.codec)}, which SOUND_FLOOR_DB names: give it one before a ${track.codec} film is compared`);
  }
  return { codec: track.codec };
}

// Serialized into the page. The film's soundtrack is decoded as a player hears
// it, trimmed by its edit list, and the recipe's is rendered and levelled in
// place by the page's level for the film's `codec`, the gain and limiter the
// export applies, to the same bits.
// It first measures `cut`, the band the codec kept, as SOUND_CUT describes.
// Then for each block of `block` samples, over every channel and the bins it
// judges, it returns the rendered energy and the energy of the difference, then,
// in the bands of `band` bins where the render is noise-like (a Hann-windowed
// spectral flatness of at least `flatness`, or near it as `sparse` allows), the
// rendered energy, the difference's, and the envelope error: the sum of
// (sqrt(decoded) - sqrt(rendered))^2 over those bands' energies; last, of the
// noise-like bands under `voice.below` Hz holding `voice.share` dB of the
// block's energy or more, away from an onset unless near, the one whose rendered to
// difference ratio is lowest, as its index, rendered energy and difference's,
// or -1, 0, 0; then the difference's energy in the bands that are not
// noise-like where it lies `mask` dB or more under the render's noise floor;
// then 1 for a block beside an onset, 2 for one beside an onset with no
// noise-like band under `voice.below` Hz, else 0; last, of the near bands
// judged alone, the one whose level the film keeps least, as its index,
// rendered energy and envelope error, or -1, 0, 0. Beside an onset, the
// envelope error is summed under `voice.below` Hz and scaled by the energy of
// every noise-like band over theirs, and only near bands are judged alone.
// Without `sparse` there are no near bands and no onsets. Energies come from
// an unwindowed transform, so over every bin they add up to the block's.
// A joined film's scene passes `span`: { at, from, to, total }, where its own
// sample 0 lands in the decoded soundtrack, the samples [from, to) of its
// render to judge, and the joined film's length in samples; blocks then start
// at `from`. The page decodes `bytes` once, so the scenes of a joined film
// share the decoded soundtrack, or its error.
// It leaves both soundtracks, the render levelled, at window.__replaySound,
// for soundWav to write out under --dump.
async function compareSound(bytes, recipe, block, codec, band, flatness, cut, voice, mask, span = null, sparse = null) {
  const api = window.__artifex;
  if (!Object.prototype.hasOwnProperty.call(api.examples, recipe.piece)) throw new Error('replay: the page has no piece named ' + JSON.stringify(recipe.piece));
  const p = api.piece.atBox(api.piece.validate(api.examples[recipe.piece]), recipe.reframe || recipe.size);
  const solved = api.piece.solve(p, recipe.seed, recipe.params);
  const cache = (window.__replayHeld = window.__replayHeld || new Map());
  if (!cache.has(bytes)) cache.set(bytes, {});
  const kept = cache.get(bytes);
  let decoded;
  try { decoded = await (kept.sound = kept.sound || new OfflineAudioContext(2, 1, 48000).decodeAudioData(bytes.slice().buffer)); } catch (e) { return { error: String((e && e.message) || e) }; }
  const rendered = await api.render.renderSound(p, solved, { OfflineAudioContext, sampleRate: 48000, channels: 2 });
  const { gain, limited } = api.level(rendered, codec);
  window.__replaySound = { decoded, rendered };
  const from = span ? span.from : 0, shift = span ? span.at : 0;
  const channels = Math.min(decoded.numberOfChannels, rendered.numberOfChannels);
  const n = span ? Math.max(0, Math.min(span.to, rendered.length, decoded.length - shift) - from) : Math.min(decoded.length, rendered.length);
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
  const [xr, xi, yr, yi, wr, wi, vr, vi] = Array.from({ length: 8 }, () => new Float64Array(block));
  // Channel c's block at `at`, the render levelled and the film, each
  // transformed plain and through the window.
  const load = (c, at) => {
    const r = rendered.getChannelData(c).subarray(from), d = decoded.getChannelData(c).subarray(shift + from);
    for (const s of [xr, xi, yr, yi, wr, wi, vr, vi]) s.fill(0);
    for (let i = at; i < Math.min(n, at + block); i++) {
      const x = r[i];
      xr[i - at] = x; yr[i - at] = d[i]; wr[i - at] = x * hann[i - at]; vr[i - at] = d[i] * hann[i - at];
    }
    fft(xr, xi); fft(yr, yi); fft(wr, wi); fft(vr, vi);
  };
  // The band the codec kept: judged bins run from 1 up to `top`, a band edge.
  const made = new Float64Array(bins), held = new Float64Array(bins);
  for (let at = 0; at < n; at += block) {
    for (let c = 0; c < channels; c++) {
      load(c, at);
      for (let k = 0; k < bins; k++) { made[k] += wr[k] ** 2 + wi[k] ** 2; held[k] += vr[k] ** 2 + vi[k] ** 2; }
    }
  }
  const loud = Math.max(...made) * 10 ** (-cut.quiet / 10), lowest = Math.ceil((cut.above * block) / rendered.sampleRate);
  const heard = (k) => (made[k] > loud ? 10 * Math.log10(held[k] / made[k]) : null);
  let top = bins, k = bins - 1, lost = -1;
  for (; k >= 1; k--) { const r = heard(k); if (r === null) continue; if (r > -cut.lost) break; lost = k; }
  for (; lost > 0 && k >= lowest && lost - k <= band; k--) {
    const r = heard(k);
    if (r !== null && r >= -cut.kept) { top = band * Math.floor((k + 1) / band); break; }
  }
  const shape = new Float64Array(bins);
  const blocks = [];
  // The render's energy in each eighth of a block, over every channel.
  const slice = block / 8, eighths = new Float64Array(Math.ceil(n / slice));
  for (let c = 0; c < channels; c++) {
    const r = rendered.getChannelData(c).subarray(from);
    for (let i = 0; i < n; i++) eighths[Math.floor(i / slice)] += r[i] * r[i];
  }
  for (let at = 0; at < n; at += block) {
    // Beside an onset: the render's loudest eighth, in this block or in either
    // beside it, lies sparse.onset dB or more over this block's mean eighth.
    const own = eighths.subarray(at / slice, at / slice + 8), mean = own.reduce((s, e) => s + e, 0) / own.length;
    const loudest = sparse ? Math.max(...eighths.subarray(Math.max(0, at / slice - 8), at / slice + 16)) : 0;
    const onset = loudest > 0 && loudest >= mean * 10 ** (sparse.onset / 10);
    // Per band, the rendered, decoded and difference energies; per bin, the
    // windowed rendered power.
    const sums = Array.from({ length: bands }, () => [0, 0, 0]);
    shape.fill(0);
    for (let c = 0; c < channels; c++) {
      load(c, at);
      for (let k = 1; k < bins; k++) {
        const s = sums[bandOf(k)], m = (k === bins - 1 ? 1 : 2) / block;
        s[0] += m * (xr[k] ** 2 + xi[k] ** 2); s[1] += m * (yr[k] ** 2 + yi[k] ** 2); s[2] += m * ((xr[k] - yr[k]) ** 2 + (xi[k] - yi[k]) ** 2);
        shape[k] += wr[k] ** 2 + wi[k] ** 2;
      }
    }
    let signal = 0, error = 0, noise = 0, noiseError = 0, envelope = 0, levelled = 0, masked = 0;
    const noisy = [];
    // Each judged band's bins and the render's flatness there, or null for a band past the cut.
    const flat = sums.map((_, b) => {
      const lo = Math.max(1, b * band), hi = Math.min(top, b === bands - 1 ? bins : b * band + band);
      if (lo >= hi) return null;
      let power = 0, logs = 0;
      for (let k = lo; k < hi; k++) { power += shape[k]; logs += Math.log(shape[k]); }
      return [lo, hi, Math.exp(logs / (hi - lo)) / (power / (hi - lo))];
    });
    // A near band: under `flatness` but at least sparse.near, its judged
    // neighbours, one at least, all noise-like.
    const near = (b) => !!sparse && flat[b][2] >= sparse.near && [b - 1, b + 1].every((j) => !flat[j] || flat[j][2] >= flatness) && [b - 1, b + 1].some((j) => flat[j]);
    for (const [b, [want, got, diff]] of sums.entries()) {
      if (!flat[b]) continue;
      const [lo, hi] = flat[b];
      signal += want; error += diff;
      if (!(flat[b][2] >= flatness) && !near(b)) {
        // The band's noise floor: its median windowed bin, as unwindowed energy
        // (a Hann window keeps 0.375 of a noise's) over all its bins.
        const sorted = Array.from(shape.subarray(lo, hi)).sort((x, y) => x - y);
        if (diff <= ((hi - lo) * 2 * sorted[(hi - lo) >> 1] * 10 ** (mask / 10)) / (block * 0.375)) masked += diff;
        continue;
      }
      const high = (b + 1) * band * rendered.sampleRate > voice.below * block, drift = (Math.sqrt(got) - Math.sqrt(want)) ** 2;
      noise += want; noiseError += diff;
      if (!(onset && high)) { levelled += want; envelope += drift; }
      noisy.push([b, want, diff, !(flat[b][2] >= flatness), high, drift]);
    }
    if (levelled > 0) envelope *= noise / levelled;
    // The noise-like band, of those under voice.below Hz holding voice.share dB
    // of the block or more, and away from an onset unless near, whose waveform
    // the film follows least, or -1; and the near band whose level it keeps least.
    let worst = [-1, 0, 0], least = [-1, 0, 0];
    for (const [b, want, diff, isNear, high, drift] of noisy) {
      if (high || want < signal * 10 ** (voice.share / 10) || (onset && !isNear)) continue;
      if (worst[0] < 0 || want * worst[2] < worst[1] * diff) worst = [b, want, diff];
      if (isNear && (least[0] < 0 || want * least[2] < least[1] * drift)) least = [b, want, drift];
    }
    // Beside an onset with no noise-like band under voice.below Hz, no level was judged: 2.
    blocks.push([signal, error, noise, noiseError, envelope, ...worst, masked, onset ? (levelled > 0 ? 1 : 2) : 0, ...least]);
  }
  return {
    gain, limited, rate: rendered.sampleRate, block, blocks, cut: top < bins ? (top * rendered.sampleRate) / block : null,
    channels: [decoded.numberOfChannels, rendered.numberOfChannels],
    ...(span ? { length: [decoded.length, span.total], span: { from, to: from + n, of: rendered.length } } : { length: [decoded.length, rendered.length] }),
  };
}

// Runs in the page: the soundtrack compareSound left at window.__replaySound
// under `name`, 'decoded' or 'rendered', as a 16-bit PCM WAV in base64.
function soundWav(name) {
  const b = window.__replaySound[name];
  const k = b.numberOfChannels, size = 2 * k * b.length, out = new DataView(new ArrayBuffer(44 + size));
  for (const [at, tag] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']]) for (let i = 0; i < 4; i++) out.setUint8(at + i, tag.charCodeAt(i));
  for (const [at, v, bits] of [[4, 36 + size, 32], [16, 16, 32], [20, 1, 16], [22, k, 16], [24, b.sampleRate, 32], [28, 2 * k * b.sampleRate, 32], [32, 2 * k, 16], [34, 16, 16], [40, size, 32]]) {
    out[bits === 32 ? 'setUint32' : 'setUint16'](at, v, true);
  }
  for (let c = 0; c < k; c++) {
    const x = b.getChannelData(c);
    for (let i = 0; i < b.length; i++) out.setInt16(44 + 2 * (i * k + c), Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), true);
  }
  const u = new Uint8Array(out.buffer);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}

// Runs in the page: the film's decoded frame at `time` seconds, a frame
// middle, at full size, as a PNG in base64. The page keeps one video element
// for every frame it is asked for. The frame is read through a VideoFrame
// 60 ms after the seek, as compareFilm reads it.
async function decodedFrame(bytes, time) {
  let video = window.__replayFrames;
  if (!video) {
    video = window.__replayFrames = document.createElement('video');
    video.muted = true;
    video.src = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
    await new Promise((resolve, reject) => {
      video.onloadeddata = resolve;
      video.onerror = () => reject(new Error('replay: the film does not decode in this browser'));
    });
  }
  const sought = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 10000);
    video.onseeked = () => { clearTimeout(timer); resolve(true); };
    video.currentTime = time;
  });
  if (!sought) throw new Error('replay: the browser did not finish seeking the film to ' + time + ' s within 10 s');
  await new Promise((resolve) => setTimeout(resolve, 60));
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  const frame = new VideoFrame(video);
  try { canvas.getContext('2d').drawImage(frame, 0, 0); } finally { frame.close(); }
  const u = new Uint8Array(await (await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))).arrayBuffer());
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * The --save-frames plan for an MP4 film, checked before any browser starts:
 * `list`, frame numbers or seconds ending in s (such as "0,24,2.5s"), as the
 * frames to write, each sought at its middle, and `dir`, the folder, made.
 */
function framesPlan(bytes, manifest, list, dir) {
  const grid = (manifest.scenes ? manifest.scenes[0].recipe : manifest).film;
  if (!grid) throw new Error('replay: the film\'s manifest has no frame grid');
  const video = readMp4(bytes).tracks.find((t) => t.kind === 'vide');
  const count = video ? video.samples : 0;
  const frames = [...new Set(String(list).split(',').map((item) => {
    const m = /^(\d+)$|^(\d+(?:\.\d+)?)s$/.exec(item.trim());
    if (!m) throw new Error(`replay: --save-frames takes frame numbers or seconds ending in s, such as 0,24,2.5s, and got ${JSON.stringify(item)}`);
    const frame = m[1] !== undefined ? Number(m[1]) : Math.floor(Number(m[2]) * grid.hz + 1e-9);
    if (frame >= count) throw new Error(`replay: --save-frames names ${item}, and the film holds frames 0 to ${count - 1} (${(count / grid.hz).toFixed(3)} s)`);
    return frame;
  }))];
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { throw new Error(`replay: --save-frames cannot use the folder ${dir}: ${e.code || e.message}`); }
  const digits = String(count - 1).length;
  return { frames: frames.map((frame) => ({ frame, time: (frame + 0.5) / grid.hz, file: path.join(dir, `frame-${String(frame).padStart(digits, '0')}.png`) })) };
}

// --lag decodes every frame of both MP4 films at SCAN_WIDTH pixels wide, each
// sought at its middle and read through a VideoFrame 60 ms after the seek, as
// compareFilm reads, and compares frame i with frame i - 1 (its step) by
// frameGap from tools/contact-sheet.js. frameGap's `off`, the share of pixels
// a channel moved by more than 32 levels, stays clear of the codec's noise of
// a level or two.
const SCAN_WIDTH = 480;
// --lag searches LAG_FRAMES frames either way, over the frames LAG_FRAMES
// either side of --at.
const LAG_FRAMES = 15;

/**
 * Frames `a` and `b`, RGBA images of one size, compared by frameGap: its `off`
 * over `region` ({ x, y, w, h } in pixels), or over the whole frame when
 * `region` is null.
 */
function frameChange(a, b, region) {
  const crop = (m) => {
    const data = new Uint8ClampedArray(region.w * region.h * 4);
    for (let y = 0; y < region.h; y++) data.set(m.data.subarray(((region.y + y) * m.width + region.x) * 4, ((region.y + y) * m.width + region.x + region.w) * 4), y * region.w * 4);
    return { data, width: region.w, height: region.h };
  };
  return region ? frameGap(crop(a), crop(b)).off : frameGap(a, b).off;
}

// Serialized into the page with frameGap and frameChange. Every frame of the
// film is read at `width` pixels wide; returns the steps: steps[i - 1] is
// frameChange of frame i - 1 and frame i. The page keeps two frames.
async function scanFilm(bytes, hz, count, width, region) {
  const video = document.createElement('video');
  video.muted = true;
  video.src = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
  await new Promise((resolve, reject) => {
    video.onloadeddata = resolve;
    video.onerror = () => reject(new Error('replay: the film does not decode in this browser'));
  });
  const w = width, h = Math.max(2, Math.round((width * video.videoHeight) / video.videoWidth));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const kept = [], steps = [];
  for (let i = 0; i < count; i++) {
    const sought = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 10000);
      video.onseeked = () => { clearTimeout(timer); resolve(true); };
      video.currentTime = (i + 0.5) / hz;
    });
    if (!sought) throw new Error('replay: the browser did not finish seeking the film to frame ' + i + ' within 10 s');
    await new Promise((resolve) => setTimeout(resolve, 60));
    const frame = new VideoFrame(video);
    try { g.drawImage(frame, 0, 0, w, h); } finally { frame.close(); }
    kept.push({ data: g.getImageData(0, 0, w, h).data, width: w, height: h });
    if (kept.length > 2) kept.shift();
    if (kept.length === 2) steps.push(frameChange(kept[0], kept[1], region));
  }
  URL.revokeObjectURL(video.src);
  return steps;
}

/**
 * The --lag plan for an MP4 film, checked before any browser
 * starts: its frame rate, frame count, scan width and `region`, x,y,w,h in the
 * piece's units as text, in scan pixels, or null.
 */
function scanPlan(bytes, manifest, region = null, name = 'the film') {
  const grid = (manifest.scenes ? manifest.scenes[0].recipe : manifest).film;
  if (!grid) throw new Error(`replay: ${name}'s manifest has no frame grid`);
  const video = readMp4(bytes).tracks.find((t) => t.kind === 'vide');
  if (!video) throw new Error(`replay: ${name} holds no video track`);
  const width = Math.min(SCAN_WIDTH, video.width), k = (grid.scale * width) / video.width;
  const height = Math.max(2, Math.round((width * video.height) / video.width));
  let box = null;
  if (region) {
    const v = String(region).split(',').map(Number);
    if (v.length !== 4 || !v.every(Number.isFinite) || v[2] <= 0 || v[3] <= 0) throw new Error(`replay: --region takes x,y,w,h in the piece's units, such as 100,80,200,150, and got ${JSON.stringify(region)}`);
    const x = Math.max(0, Math.round(v[0] * k)), y = Math.max(0, Math.round(v[1] * k));
    box = { x, y, w: Math.min(width, Math.round((v[0] + v[2]) * k)) - x, h: Math.min(height, Math.round((v[1] + v[3]) * k)) - y };
    if (!(box.w > 0 && box.h > 0)) throw new Error(`replay: --region ${region} lies outside the film's ${(width / k).toFixed(0)} x ${(height / k).toFixed(0)} units`);
  }
  return { hz: grid.hz, count: video.samples, width, region: box };
}

/**
 * A film's activity curve, each frame's step from scanInEdge (frame 0 has
 * none, so 0), from every frame of a film decoded and compared in installed
 * Edge, as scanFilm returns it for `plan`, a scanPlan.
 */
async function scanInEdge(bytes, plan, browser = {}, open = withEdge) {
  const page = '<!doctype html><meta charset="utf-8"><title>replay scan</title>';
  const limit = { ...browser, command: 'replay', file: bytes, timeoutMs: (browser.timeoutMs ?? TIMEOUT_MS) + plan.count * 250 };
  return open(page, limit, async (client, context) => {
    await waitFor(client, context, 'document.readyState === "complete"');
    context.phase = 'lag scan';
    await sendBytes(client, bytes);
    const code = `(async () => { const FRAME_THRESHOLD = ${FRAME_THRESHOLD}, FRAME_GRID = ${FRAME_GRID}; ${frameGap}; ${frameChange}; return (${scanFilm})(window.__replayBytes, ${[plan.hz, plan.count, plan.width, JSON.stringify(plan.region)].join(', ')}); })()`;
    const steps = await evaluateInPieces(client, code);
    pageErrors(client, context);
    return [0, ...steps];
  });
}

/**
 * How many frames curve `b` runs behind curve `a` around frame `at`: the lag
 * from -span to span whose Pearson correlation of a's frames within `span` of
 * `at` with b's frames that lag later is highest, the smaller lag on a tie,
 * either sign alike. Positive when b is later. { lag, correlation }, or
 * { lag: null } when no lag gives a window with change in both curves.
 */
function activityLag(a, b, at, span = LAG_FRAMES) {
  let best = { lag: null, correlation: null };
  for (let lag = -span; lag <= span; lag++) {
    const xs = [], ys = [];
    for (let i = at - span; i <= at + span; i++) {
      if (i >= 0 && i < a.length && i + lag >= 0 && i + lag < b.length) { xs.push(a[i]); ys.push(b[i + lag]); }
    }
    const mx = xs.reduce((s, v) => s + v, 0) / xs.length, my = ys.reduce((s, v) => s + v, 0) / ys.length;
    let sxy = 0, sxx = 0, syy = 0;
    for (let k = 0; k < xs.length; k++) { sxy += (xs[k] - mx) * (ys[k] - my); sxx += (xs[k] - mx) ** 2; syy += (ys[k] - my) ** 2; }
    if (!(sxx > 0 && syy > 0)) continue;
    const r = sxy / Math.sqrt(sxx * syy);
    if (best.lag === null || r > best.correlation + 1e-9 || (Math.abs(r - best.correlation) <= 1e-9 && Math.abs(lag) < Math.abs(best.lag))) best = { lag, correlation: r };
  }
  return best.lag === null ? best : { lag: best.lag, correlation: +best.correlation.toFixed(4) };
}

/**
 * The scan --lag asks of the MP4 film `bytes`, checked before any browser
 * starts: { own, other, at }, `own` its scanPlan, `other` the film named,
 * read and planned, and `at` the frame --at names.
 */
function scanSetup(bytes, manifest, options, cwd) {
  const own = scanPlan(bytes, manifest, options.region);
  const where = path.resolve(cwd, options.lag);
  let other;
  try { other = new Uint8Array(fs.readFileSync(where)); } catch (e) {
    if (e.code === 'ENOENT') throw new Error(`replay: no film at ${where} for --lag; name an MP4 film of the same piece`);
    throw e;
  }
  const theirs = manifestOf(other, options.lag);
  if (theirs.type !== 'mp4') throw new Error(`replay: --lag compares two MP4 films, and ${options.lag} is ${theirs.type.toUpperCase()}`);
  const plan = scanPlan(other, theirs.manifest, options.region, options.lag);
  if (plan.hz !== own.hz || plan.width !== own.width || !same(plan.region, own.region)) {
    throw new Error(`replay: --lag compares films on one frame grid and size, and the file runs at ${own.hz} frames a second, ${own.width} pixels wide as scanned, and ${options.lag} at ${plan.hz}, ${plan.width}`);
  }
  const m = /^(\d+)$|^(\d+(?:\.\d+)?)s$/.exec(String(options.at).trim());
  if (!m) throw new Error(`replay: --at takes a frame number or seconds ending in s, such as 60 or 2.5s, and got ${JSON.stringify(options.at)}`);
  const at = m[1] !== undefined ? Number(m[1]) : Math.floor(Number(m[2]) * own.hz + 1e-9);
  if (at >= own.count) throw new Error(`replay: --at names ${options.at}, and the film holds frames 0 to ${own.count - 1} (${(own.count / own.hz).toFixed(3)} s)`);
  return { own, other: { file: options.lag, bytes: other, plan }, at };
}

/** What the scan scanSetup planned adds to replay's result: `lag`. */
async function scanned(scan, bytes, options) {
  const open = options.withEdge || withEdge;
  const ours = await scanInEdge(bytes, scan.own, options.browser, open);
  const theirs = await scanInEdge(scan.other.bytes, scan.other.plan, options.browser, open);
  const lag = activityLag(ours, theirs, scan.at);
  return {
    lag: {
      against: scan.other.file, at: scan.at, ...(scan.own.region && { region: options.region }), ...lag,
      ...(lag.lag !== null && { seconds: +(lag.lag / scan.own.hz).toFixed(3) }),
    },
  };
}

/** The line replay prints for a result's `lag`, or none. */
function scanText({ lag }) {
  if (!lag) return [];
  const where = `around frame ${lag.at}${lag.region ? ` in region ${lag.region}` : ''}`;
  return [lag.lag === null ? `lag: ${lag.against} and the file show no change to align ${where}`
    : `lag: ${lag.against} runs ${lag.lag === 0 ? 'in step with the file' : `${Math.abs(lag.lag)} frame${Math.abs(lag.lag) > 1 ? 's' : ''} (${Math.abs(lag.seconds).toFixed(3)} s) ${lag.lag > 0 ? 'later' : 'earlier'} than the file`} ${where}, correlation ${lag.correlation} (a check, not part of the verdict)`];
}

/**
 * A soundtrack's verdict from compareSound, for a film whose soundtrack is in
 * `codec`: the decoded film must have the rendered soundtrack's channels and
 * length exactly, and every block must be within the codec's SOUND_FLOOR_DB of
 * the render or differ from it by less than SOUND_GATE_DB. A block under the
 * floor still matches when the rest of it keeps the floor, leaving out its
 * noise-like bands and the bands whose difference lies its codec's
 * SOUND_MASK_DB under the render's noise; when that rest keeps its own
 * waveform within SOUND_NOISE_DB.rest; and when its noise-like bands keep
 * SOUND_NOISE_DB, together and each band that SOUND_VOICE names, those of its
 * near bands each their waveform and SOUND_SPARSE.envelope of their level, and,
 * beside an onset, its bands together under SOUND_VOICE.below Hz
 * SOUND_SPARSE.envelope of their levels instead of SOUND_NOISE_DB.envelope,
 * where it has any. A block with noise-like bands within its codec's
 * SOUND_NEAR_DB over the floor is judged as one under it. A block those rules
 * refuse still matches beside a block as its codec's SOUND_SPILL_DB names.
 * Blocks are judged below `s.cut`, in Hz, when compareSound measured one.
 * A matching soundtrack also fills `report`, when given, with `margins`, the
 * lowest value each rule met as { db, threshold, at } (`floor`, `waveform`,
 * `band`, `near`, `level`, `onsetLevel`; a rule no block came under is left
 * out), and `mask`, its codec's SOUND_MASK_DB.
 */
function soundVerdict(s, codec, report = null) {
  if (s.error) return { match: false, detail: `the soundtrack does not decode: ${s.error}` };
  if (s.channels[0] !== s.channels[1]) return { match: false, detail: `the soundtrack decodes to ${s.channels[0]} channels and its recipe renders ${s.channels[1]}` };
  if (s.length[0] !== s.length[1]) {
    return { match: false, detail: s.span ? `the joined soundtrack decodes to ${s.length[0]} samples and its film lasts ${s.length[1]}` : `the soundtrack decodes to ${s.length[0]} samples and its recipe renders ${s.length[1]}` };
  }
  const floor = SOUND_FLOOR_DB[codec], name = codec === 'mp4a' ? 'AAC' : codec, { waveform, envelope: level, rest } = SOUND_NOISE_DB;
  const gate = 10 ** (SOUND_GATE_DB / 10);
  // A joined film's scene is judged from s.span.from to s.span.to of its render.
  const from = s.span ? s.span.from : 0, end = s.span ? s.span.to : s.length[1];
  let worst = Infinity, noisy = 0, quiet = 0, worstWave = Infinity, worstBand = Infinity, worstLevel = Infinity, banded = false, onsets = 0, onsetLevel = Infinity, unlevelled = 0, nearby = 0, spilled = 0;
  const khz = (k) => ((k * SOUND_BAND * s.rate) / s.block / 1000).toFixed(2);
  // The lowest value each rule met, with the second of its block, for the report.
  const margins = {};
  const margin = (rule, db, threshold, i) => { if (Number.isFinite(db) && !(margins[rule] && margins[rule].db <= db)) margins[rule] = { db: +db.toFixed(2), threshold, at: +((from + i * s.block) / s.rate).toFixed(3) }; };
  for (const [i, [signal, error, noise, noiseError, envelope, band, bandNoise, bandError, masked = 0, onset = 0, levelBand = -1, levelNoise = 0, levelError = 0]] of s.blocks.entries()) {
    const samples = Math.min(s.block, end - from - i * s.block) * s.channels[1];
    if (error / samples < gate) continue;
    const db = 10 * Math.log10(signal / error), over = db >= floor;
    if (over && !(noise > 0 && db < floor + SOUND_NEAR_DB[codec])) { worst = Math.min(worst, db); margin('floor', db, floor, i); continue; }
    const differs = `the soundtrack differs from its recipe at ${((from + i * s.block) / s.rate).toFixed(3)} s: `
      + (signal > 0 ? `that block decodes ${db.toFixed(1)} dB from the render, ${over ? `within ${SOUND_NEAR_DB[codec]} dB over` : 'under'} the ${floor} dB floor for ${name}` : 'the render is silent in that block and the film is not');
    // The rules below, as the reason the block differs, or null with what it adds to the verdict's counts.
    let adds = null;
    const refused = (() => {
      // The difference outside the noise-like bands, which rounding can take under zero,
      // and of that, the part not under the render's own noise.
      const restError = Math.max(0, error - noiseError), heard = Math.max(0, restError - masked);
      if (!(10 * Math.log10(signal / heard) >= floor)) return differs;
      const own = 10 * Math.log10(Math.max(0, signal - noise) / restError);
      if (!(own >= rest) && restError / samples >= gate) return `${differs}, and outside its noise-like bands ` + (own > -Infinity ? `it follows the render's waveform at ${own.toFixed(1)} dB, under ${rest} dB` : 'the render is silent and the film is not');
      const masks = !(10 * Math.log10(signal / restError) >= floor);
      if (!(noise > 0)) { adds = () => { if (masks) quiet++; }; return null; }
      const wave = 10 * Math.log10(noise / noiseError), kept = 10 * Math.log10(noise / envelope);
      if (!(wave >= waveform)) return `${differs}, and its noise-like bands follow the render's waveform at ${wave.toFixed(1)} dB, under ${waveform} dB`;
      const alone = band >= 0 ? 10 * Math.log10(bandNoise / bandError) : Infinity;
      if (!(alone >= waveform)) return `${differs}, and its noise-like band at ${khz(band)} to ${khz(band + 1)} kHz follows the render's waveform at ${alone.toFixed(1)} dB, under ${waveform} dB`;
      const held = levelBand >= 0 ? 10 * Math.log10(levelNoise / levelError) : Infinity;
      if (!(held >= SOUND_SPARSE.envelope)) return `${differs}, and its band at ${khz(levelBand)} to ${khz(levelBand + 1)} kHz, nearly noise-like, keeps the render's level at ${held.toFixed(1)} dB, under ${SOUND_SPARSE.envelope} dB`;
      if (onset === 1 && !(kept >= SOUND_SPARSE.envelope)) return `${differs}, and beside an onset its noise-like bands under ${SOUND_VOICE.below / 1000} kHz keep the render's levels at ${kept.toFixed(1)} dB, under ${SOUND_SPARSE.envelope} dB`;
      if (!onset && !(kept >= level)) return `${differs}, and its noise-like bands keep the render's levels at ${kept.toFixed(1)} dB, under ${level} dB`;
      adds = () => {
        if (masks) quiet++;
        if (onset === 2) unlevelled++;
        else if (onset) { onsets++; onsetLevel = Math.min(onsetLevel, kept); } else worstLevel = Math.min(worstLevel, kept);
        noisy++;
        if (over) nearby++;
        worstWave = Math.min(worstWave, wave);
        worstBand = Math.min(worstBand, alone);
        margin('waveform', wave, waveform, i);
        margin('band', alone, waveform, i);
        margin('near', held, SOUND_SPARSE.envelope, i);
        if (onset === 1) margin('onsetLevel', kept, SOUND_SPARSE.envelope, i); else if (!onset) margin('level', kept, level, i);
        banded ||= band >= 0;
      };
      return null;
    })();
    if (!refused) { adds(); continue; }
    // Refused by those rules, the block may still hold only the codec's noise spread from a louder block beside it.
    const beside = Math.max(0, ...[i - 1, i + 1].filter((j) => j >= 0 && j < s.blocks.length).map((j) => s.blocks[j][0]));
    if (10 * Math.log10(beside / error) >= SOUND_SPILL_DB.under[codec] && !(10 * Math.log10(beside / signal) < SOUND_SPILL_DB.louder)) { spilled++; continue; }
    return { match: false, detail: refused };
  }
  const none = 'no difference';
  const judged = s.span
    ? `the scene's ${name} sound, judged from ${(from / s.rate).toFixed(3)} s to ${(end / s.rate).toFixed(3)} s of its ${(s.span.of / s.rate).toFixed(3)} s, lies in the joined soundtrack's ${s.length[1]} samples`
    : `the ${name} soundtrack decodes to its recipe's ${s.length[1]} samples`;
  if (report) Object.assign(report, { margins, mask: SOUND_MASK_DB[codec] });
  return { match: true, detail: judged
    + (s.cut ? ` and, below ${(s.cut / 1000).toFixed(2)} kHz, where its codec kept the render,` : ',') + ` every block within ${floor} dB of the render`
    + (worst < Infinity ? ` (worst ${worst.toFixed(1)} dB)` : noisy || quiet || spilled ? '' : ' or differing by less than the gate')
    + (noisy ? ` or, in its noise-like bands, within ${waveform} dB of its waveform, together and in each band under ${SOUND_VOICE.below / 1000} kHz within ${-SOUND_VOICE.share} dB of its block,`
      + ` and ${level} dB of its levels (${noisy} blocks${nearby ? `, ${nearby} of them within ${SOUND_NEAR_DB[codec]} dB over the floor` : ''}, worst ${worstWave < Infinity ? worstWave.toFixed(1) : none}, ${worstBand < Infinity ? worstBand.toFixed(1) : banded ? none : 'no band'} and ${worstLevel < Infinity ? worstLevel.toFixed(1) + ' dB' : onsets + unlevelled === noisy ? 'no block away from an onset' : none})`
      + (onsets || unlevelled ? `, beside an onset ${SOUND_SPARSE.envelope} dB of its levels under ${SOUND_VOICE.below / 1000} kHz (`
        + [onsets && `${onsets} of those blocks, worst ${onsetLevel < Infinity ? onsetLevel.toFixed(1) + ' dB' : none}`,
          unlevelled && `${unlevelled} with no noise-like band under ${SOUND_VOICE.below / 1000} kHz, so no level judged`].filter(Boolean).join('; ') + ')' : '') : '')
    + (quiet ? ` or, in its other bands, ${-SOUND_MASK_DB[codec]} dB under the render's own noise (${quiet} blocks)` : '')
    + (spilled ? ` or, beside a block ${SOUND_SPILL_DB.louder} dB or more louder, differing ${SOUND_SPILL_DB.under[codec]} dB or more under it, whose noise ${name} spreads (${spilled} blocks)` : '') };
}

/**
 * A film's verdict from its compared frames: each must decode within
 * FILM_FLOOR_DB of its redraw and at least as close to it as to either
 * neighbour's, a held frame tying with an identical neighbour; a row with
 * `seekTimeoutMs` is a frame the browser could not seek to. `heard`, the
 * soundtrack's verdict where there is one, must match too.
 */
function replayVerdict(rows, heard = null) {
  for (const r of rows) {
    if (r.seekTimeoutMs) {
      return { match: false, detail: `frame ${r.frame} cannot be sought: the browser did not finish seeking the film to it within ${r.seekTimeoutMs / 1000} s` };
    }
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
  const p = api.piece.atBox(api.piece.validate(api.examples[recipe.piece]), recipe.reframe || recipe.size);
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
  const p = api.piece.atBox(api.piece.validate(api.examples[recipe.piece]), recipe.reframe || recipe.size);
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
    const sought = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 10000);
      video.onseeked = () => { clearTimeout(timer); resolve(true); };
      video.currentTime = seeks[n];
    });
    if (!sought) { rows.push({ frame: i, seekTimeoutMs: 10000 }); break; }
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

/**
 * Put `bytes` in the page as window.__replayBytes, which every page function
 * reads, and check that every byte arrived. withEdge serves them at /file on
 * its loopback server (pass them as its `file` option), and the page fetches
 * them in one request: a DevTools message carries them only as base64, a
 * third larger, and Edge closes the connection at 100 MB. `run` is
 * check-browser's evaluate.
 */
async function sendBytes(client, bytes, run = evaluate) {
  const held = await run(client, 'fetch("/file").then((r) => r.arrayBuffer())'
    + '.then((b) => (window.__replayBytes = new Uint8Array(b)).length)');
  if (held !== bytes.length) throw new Error(`replay: the page received ${held} of the file's ${bytes.length} bytes`);
}

/** A PNG or WebM compared in installed Edge; resolves to what replay() adds for it. */
async function replayInEdge(type, bytes, manifest, piece, external, browser, session = null) {
  const plan = type === 'png' ? pngPlan(bytes, manifest, piece) : webmPlan(bytes, manifest, piece);
  const call = type === 'png'
    ? '(' + comparePng.toString() + ')(window.__replayBytes, ' + [manifest, plan.heads, plan.frames].map((v) => JSON.stringify(v)).join(', ') + ')'
    : '(' + compareWebm.toString() + ')(window.__replayBytes, ' + [manifest, plan.frames, plan.seeks].map((v) => JSON.stringify(v)).join(', ') + ')';
  const page = html(bundle(external), external ? { count: 1 } : {});
  const report = await withEdge(page, { ...browser, file: bytes, command: 'replay' }, async (client, context) => {
    await waitFor(client, context, 'document.readyState === "complete" && !!window.__artifex');
    context.phase = type + ' replay';
    await sendBytes(client, bytes);
    if (session) await useSession(client, session);
    const rows = await evaluate(client, call);
    pageErrors(client, context);
    return { browser: context.version.Browser, rows };
  });
  const verdict = type === 'png' ? pngVerdict(report.rows, plan.at, pngSize(bytes)) : replayVerdict(report.rows);
  return { browser: report.browser, frames: report.rows, ...verdict };
}

/**
 * Replay `file`. Resolves to { file, type, manifest, match, detail } and, for a
 * PNG or a film, the browser and the compared frames; throws when the file cannot be
 * replayed. `options`: `piece`, a module path; `style`, a style's name, which is refused with where its
 * guide and mark functions are; `cwd`, the directory relative paths start from; `env`, the environment
 * whose ARTIFEX_HOME holds style packs;
 * `browser`, options for the Edge check; `withEdge`, a stand-in for
 * check-browser's, which opens each page.
 */
async function replay(file, options = {}) {
  const cwd = options.cwd || callerDirectory(), env = options.env || process.env;
  // Required when used, since only this refusal needs it.
  if (options.style) throw new Error('replay: ' + require('./styles.js').styleCause(options.style, env) + '\n' + USAGE);
  const where = path.resolve(cwd, file);
  let bytes;
  try { bytes = new Uint8Array(fs.readFileSync(where)); } catch (e) {
    if (e.code === 'ENOENT') throw new Error(`replay: no file at ${where}; name a saved SVG, PNG, MP4 or WebM file\n${USAGE}`);
    throw e;
  }
  const { type, manifest: saved0 } = manifestOf(bytes, file);
  // --seed redraws the file's recipe at another seed, to see how far that seed's picture lies from the file.
  if (options.seed !== undefined && type === 'mp4' && saved0.scenes) throw new Error('replay: --seed redraws one recipe, and ' + file + ' is a joined film of ' + saved0.scenes.length + ' scenes');
  const manifest = options.seed === undefined ? saved0 : { ...saved0, seed: options.seed, ...(saved0.seed !== options.seed && { savedSeed: saved0.seed }) };
  if (options.dump && type !== 'mp4') throw new Error(`replay: --dump writes an MP4 film's soundtrack, and ${file} is ${type.toUpperCase()}`);
  if (options.saveFrames && type !== 'mp4') throw new Error(`replay: --save-frames writes an MP4 film's decoded frames, and ${file} is ${type.toUpperCase()}`);
  if (options.lag && type !== 'mp4') throw new Error(`replay: --lag scans an MP4 film's frames, and ${file} is ${type.toUpperCase()}`);
  const scan = options.lag ? scanSetup(bytes, manifest, options, cwd) : null;
  // Beside the report: <film name>-frames beside a film outside the library, else under out/.
  const grab = options.saveFrames ? framesPlan(bytes, manifest, options.saveFrames, path.join(reportDirectory(file, cwd) ?? outRoot(cwd), path.basename(file) + '-frames')) : null;
  // The scan follows the replay, in pages of its own, and never changes its verdict.
  const saved = async (result) => ({ ...result, ...(grab && { frameFiles: grab.frames.map((f) => f.file) }), ...(scan && await scanned(scan, bytes, options)) });
  // A joined film takes a --piece for each external scene.
  const joined = type === 'mp4' && manifest.scenes;
  if (!joined && Array.isArray(options.piece)) throw new Error(`replay: ${file} was drawn by one piece; pass one --piece`);
  if (joined) return saved(await replayScenes(file, bytes, manifest, { ...options, grab }, cwd));
  let { piece, external } = pieceFor(manifest, options.piece, cwd), session = null;
  // A file drawn from a saved session is drawn again from the session beside it.
  if (manifest.session !== undefined) ({ piece, session } = sessionFor(where, manifest, piece));
  if (type === 'svg') return { file, type, manifest, ...replaySvg(bytes, manifest, piece) };
  if (type === 'png' || type === 'webm') return { file, type, manifest, ...await replayInEdge(type, bytes, manifest, piece, external, options.browser, session) };
  const dump = options.dump ? dumpFolder(bytes, [piece], path.resolve(cwd, options.dump), '') : null;
  const [result] = await replayMp4(bytes, [{ manifest, piece, dump, session }], external, options.browser, options.withEdge, grab);
  return saved({ file, type, manifest, ...result });
}

/**
 * MP4 films compared in one installed Edge page, which receives `bytes` once:
 * a film, or the scenes of a joined film that one bundle draws, each pictures
 * then soundtrack. `films` lists { manifest, piece, scene }, `scene` for a
 * joined film's scene; resolves to what replay() adds for each, in order. The
 * page has the browser's time limit for each film it compares. `grab`, a
 * framesPlan, has the page decode those frames too, written as PNG files.
 */
async function replayMp4(bytes, films, external, browser = {}, open = withEdge, grab = null) {
  const jobs = films.map(({ manifest, piece, scene = null, dump = null, session = null }) => ({
    recipe: JSON.stringify(manifest), first: scene ? scene.frames[0] : 0, session,
    frames: filmPlan(bytes, manifest, piece, scene && scene.frames),
    plan: soundPlan(bytes, piece),
    span: scene && scene.sound ? { at: scene.sound.at, from: scene.sound.judged[0], to: scene.sound.judged[1], total: scene.total } : null,
    dump,
  }));
  const page = html(bundle(external), external ? { count: 1 } : {});
  const limit = { ...browser, command: 'replay', timeoutMs: (browser.timeoutMs ?? TIMEOUT_MS) * jobs.length, file: bytes };
  const report = await open(page, limit, async (client, context) => {
    await waitFor(client, context, 'document.readyState === "complete" && !!window.__artifex');
    context.phase = 'film replay';
    await sendBytes(client, bytes);
    const compared = [];
    for (const { recipe, first, frames, plan, span, dump, session } of jobs) {
      context.phase = 'film replay';
      if (session) await useSession(client, session);
      const rows = await evaluate(client, '(' + compareFilm.toString() + ')(' + ['window.__replayBytes', recipe, JSON.stringify(frames), first].join(', ') + ')');
      let sound = null;
      if (plan && plan.codec) {
        context.phase = 'soundtrack replay';
        // In pieces: about 13 numbers per block pass the 4 MiB one reply
        // may carry at about 5 minutes of film.
        sound = await evaluateInPieces(client, '(' + compareSound.toString() + ')(' + ['window.__replayBytes', recipe, SOUND_BLOCK, JSON.stringify(plan.codec), SOUND_BAND, SOUND_FLATNESS, JSON.stringify(SOUND_CUT), JSON.stringify(SOUND_VOICE), SOUND_MASK_DB[plan.codec], JSON.stringify(span), JSON.stringify(SOUND_SPARSE)].join(', ') + ')');
      }
      // Each WAV in replies of its own, in pieces: a stereo film past about
      // 16 s passes the 4 MiB one reply may carry.
      const wav = (name) => evaluateInPieces(client, '(' + soundWav.toString() + ')(' + JSON.stringify(name) + ')');
      const wavs = dump && sound && !sound.error ? { ...(dump.decoded && { decoded: await wav('decoded') }), rendered: await wav('rendered') } : null;
      pageErrors(client, context);
      compared.push({ rows, sound, wavs });
    }
    // Each frame in replies of its own, in pieces: a full-size PNG can pass 4 MiB.
    context.phase = 'decoded frames';
    const pictures = [];
    for (const { time } of grab ? grab.frames : []) pictures.push(await evaluateInPieces(client, '(' + decodedFrame.toString() + ')(window.__replayBytes, ' + time + ')'));
    pageErrors(client, context);
    return { browser: context.version.Browser, compared, pictures };
  });
  for (const [i, { file }] of (grab ? grab.frames : []).entries()) fs.writeFileSync(file, Buffer.from(report.pictures[i], 'base64'));
  return jobs.map(({ plan, dump, span }, i) => {
    const { rows, sound: s, wavs } = report.compared[i];
    const measured = {};
    const heard = plan && plan.codec ? soundVerdict(s, plan.codec, measured) : plan;
    const sound = heard && { ...heard, ...measured, ...(s && { gain: s.gain, limited: s.limited, length: s.length, cut: s.cut, span: s.span }) };
    // A folder that fails a write after the comparison is named beside the verdict.
    let dumped = null;
    if (dump) {
      try { dumped = { dump: dumpSound(dump, s, heard, plan.codec, wavs, span ? span.at : 0) }; } catch (e) { dumped = { dumpError: `replay: --dump cannot write into the folder ${dump.dir}: ${e.code || e.message}` }; }
    }
    return { browser: report.browser, frames: rows, ...(sound && { sound }), ...replayVerdict(rows, heard), ...dumped };
  });
}

const BLOCK_FIELDS = ['signal', 'error', 'noise', 'noiseError', 'envelope', 'band', 'bandNoise', 'bandError', 'masked', 'onset', 'levelBand', 'levelNoise', 'levelError'];

/**
 * The --dump folder `dir`, made and written to once, for a film whose `pieces`
 * each have their soundtrack compared; refused by name otherwise, before any
 * browser starts. Returns { dir, prefix, decoded }, `decoded` the decoded
 * soundtrack's file name.
 */
function dumpFolder(bytes, pieces, dir, prefix) {
  for (const piece of pieces) {
    const plan = soundPlan(bytes, piece);
    if (!plan || !plan.codec) throw new Error(`replay: --dump writes a film's soundtrack, and ${plan ? plan.detail : 'the film carries none and its piece declares none'}`);
  }
  const probe = path.join(dir, `.replay-dump-${process.pid}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(probe, '');
    fs.rmSync(probe);
  } catch (e) { throw new Error(`replay: --dump cannot use the folder ${dir}: ${e.code || e.message}`); }
  return { dir, prefix, decoded: 'decoded.wav' };
}

/**
 * Write a soundtrack's comparison into `dump.dir`: `dump.decoded`, unless
 * null, and `dump.prefix` + rendered.wav from `wavs`, when the film decoded,
 * else removing either left by an earlier dump; and `dump.prefix` +
 * blocks.json, compareSound's figures `s` with each block's energies named,
 * its start in seconds in the render (`at`) and in the decoded soundtrack
 * (`decodedAt`, `shift` samples later for a joined film's scene), and its
 * signal-to-difference ratio in dB, or "identical" when nothing differs and
 * "render silent" when only the film sounds. Returns the paths written.
 */
function dumpSound(dump, s, verdict, codec, wavs, shift = 0) {
  const files = { decoded: dump.decoded && path.join(dump.dir, dump.decoded), rendered: path.join(dump.dir, dump.prefix + 'rendered.wav') };
  const written = [];
  for (const [name, file] of Object.entries(files)) {
    if (!file) continue;
    if (!wavs) { fs.rmSync(file, { force: true }); continue; }
    fs.writeFileSync(file, Buffer.from(wavs[name], 'base64'));
    written.push(file);
  }
  const at = (name) => path.join(dump.dir, dump.prefix + name);
  const { blocks = [], ...rest } = s;
  const from = s.span ? s.span.from : 0;
  const named = blocks.map((b, i) => ({
    at: (from + i * s.block) / s.rate, decodedAt: (shift + from + i * s.block) / s.rate,
    db: !b[1] ? 'identical' : !b[0] ? 'render silent' : 10 * Math.log10(b[0] / b[1]), ...Object.fromEntries(BLOCK_FIELDS.map((k, j) => [k, b[j]])),
  }));
  fs.writeFileSync(at('blocks.json'), JSON.stringify({ codec, mask: SOUND_MASK_DB[codec], verdict, ...rest, blocks: named }, null, 2) + '\n');
  return written.concat(at('blocks.json'));
}

/**
 * A joined film from `npm run stitch`, each scene replayed against its own
 * recipe. A scene's piece is the module passed with --piece whose piece has the
 * scene's name, else the registered example of that name. Scenes drawn by
 * one bundle, every registered example's or one module's, share one page.
 */
async function replayScenes(file, bytes, manifest, options, cwd) {
  if (!Array.isArray(manifest.scenes) || !manifest.scenes.length) throw new Error('replay: the joined film\'s manifest lists no scenes');
  const modules = [].concat(options.piece || []).map((m) => ({ path: m, loaded: loadExternal(m, cwd) }));
  const video = readMp4(bytes).tracks.find((t) => t.kind === 'vide');
  const hz = manifest.scenes[0].recipe.film && manifest.scenes[0].recipe.film.hz;
  const total = Math.round(((video ? video.samples : 0) / hz) * 48000);
  // Each bundle's scenes, keyed by its module's load, or null for the examples.
  const pages = new Map();
  for (const [k, scene] of manifest.scenes.entries()) {
    const own = modules.find((m) => m.loaded.piece.name === scene.recipe.piece);
    let { piece, external } = pieceFor(scene.recipe, own ? own.path : null, cwd, own ? own.loaded : null), session = null;
    // A scene filmed from a saved session is drawn again from the session beside the joined film.
    if (scene.recipe.session !== undefined) ({ piece, session } = sessionFor(path.resolve(cwd, file), scene.recipe, piece));
    if (!pages.has(external)) pages.set(external, []);
    pages.get(external).push({ k, manifest: scene.recipe, piece, session, scene: { ...scene, total } });
  }
  // Every scene's --dump is checked before the first page opens.
  if (options.dump) {
    const films = [...pages.values()].flat(), dir = path.resolve(cwd, options.dump);
    dumpFolder(bytes, films.map((f) => f.piece), dir, '');
    // The scenes share one decoded soundtrack, written with the first scene's files.
    for (const f of films) f.dump = { dir, prefix: `scene-${f.k + 1}-`, decoded: f.k === 0 ? 'decoded.wav' : null };
  }
  const scenes = [];
  // The first page decodes the frames --save-frames names, from the whole joined film.
  let grab = options.grab;
  for (const [external, films] of pages) {
    const results = await replayMp4(bytes, films, external, options.browser, options.withEdge, grab);
    grab = null;
    for (const [i, { k, scene }] of films.entries()) {
      scenes[k] = { scene: k + 1, piece: scene.recipe.piece, seed: scene.recipe.seed, range: scene.frames, ...results[i] };
    }
  }
  const off = scenes.find((s) => !s.match);
  return {
    file, type: 'mp4', manifest, scenes, match: !off,
    detail: off ? `scene ${off.scene} (${off.piece}) differs: ${off.detail}` : `each of its ${scenes.length} scenes matches its own recipe`,
  };
}

function parseArgs(args) {
  const out = { file: null, piece: null, browser: {} };
  const refuse = (cause) => new Error('replay: ' + cause + '\n' + USAGE);
  let i = 0;
  // Takes the value after option name, refusing a missing one or the next option.
  const value = (name, cause) => {
    const v = args[i + 1];
    if (!v || v.startsWith('--')) throw refuse(name + ' needs ' + cause);
    i++;
    return v;
  };
  for (; i < args.length; i++) {
    const a = args[i];
    if (a === '--piece') {
      const piece = value(a, 'the ./piece.cjs that made the file');
      // A joined film takes one --piece for each external piece among its scenes.
      out.piece = out.piece ? [].concat(out.piece, piece) : piece;
    }
    else if (a === '--style') {
      if (out.style) throw refuse('one --style at a time');
      out.style = value(a, 'a style name; npm run styles lists them');
    }
    else if (a === '--edge') out.browser.edge = value(a, 'the path to msedge');
    else if (a === '--timeout-ms') {
      const ms = value(a, 'a number of milliseconds');
      // Per film: a joined MP4 gives each page this times the films it compares.
      out.browser.timeoutMs = timeoutArg(ms, refuse, { per: ' per film' });
    }
    else if (a === '--headed') out.browser.headed = true;
    else if (a === '--json') out.json = true;
    else if (a === '--seed') {
      const seed = Number(value(a, 'the seed to redraw the recipe at, a whole number'));
      if (!Number.isSafeInteger(seed) || seed < 0) throw refuse('--seed takes a whole number, 0 or more');
      out.seed = seed;
    }
    else if (a === '--dump') out.dump = value(a, 'a folder to write the soundtracks and their blocks into');
    else if (a === '--save-frames') out.saveFrames = value(a, 'frame numbers or seconds ending in s, such as 0,24,2.5s');
    else if (a === '--lag') out.lag = value(a, 'another MP4 film of the same piece');
    else if (a === '--at') out.at = value(a, 'the frame or seconds of the beat to align, such as 60 or 2.5s');
    else if (a === '--region') out.region = value(a, 'x,y,w,h in the piece\'s units, such as 100,80,200,150');
    else if (a.startsWith('--')) throw refuse('unknown option ' + a);
    else if (out.file) throw refuse('one file at a time, got "' + out.file + '" and "' + a + '"');
    else out.file = a;
  }
  if (!out.file) throw refuse('name the SVG, PNG, MP4 or WebM file to replay');
  if (out.lag && out.at === undefined) throw refuse('--lag needs --at, the frame or seconds of the beat to align');
  if (out.at !== undefined && !out.lag) throw refuse('--at goes with --lag, the film to align with');
  if (out.region !== undefined && !out.lag) throw refuse('--region goes with --lag');
  return out;
}

/** The folder for a replay's report: beside `file` when it lies outside the library, else undefined, which saveReport takes as out/ (the library's own from inside it, else the caller's; see outRoot). */
function reportDirectory(file, cwd = callerDirectory()) {
  const where = path.resolve(cwd, file);
  return inLibrary(where) === null ? path.dirname(where) : undefined;
}

// Without --json the full report goes to replay-<file name>.json, beside the
// file when it lies outside the library and under out/ when it is
// inside, so the output holds only the verdict, which names the first
// difference, and its path.
async function main(args = process.argv.slice(2), run = replay, dir) {
  if (args.includes('--help') || args.includes('-h')) return console.log(USAGE);
  const options = parseArgs(args);
  const result = await run(options.file, options);
  if (options.json) console.log(JSON.stringify(result, null, 2));
  // Under --json stdout holds only the report, so the verdict and scene lines go to stderr.
  const say = options.json ? console.error : console.log;
  // A joined film names its scenes, then a line for each.
  const made = result.scenes ? `${result.scenes.length} scenes` : `${result.manifest.piece} seed ${result.manifest.seed}`;
  // An SVG replays in Node, so no browser can explain its difference.
  if (options.seed !== undefined) {
    // A comparison, not a verdict: another seed is meant to differ.
    const was = result.manifest.savedSeed;
    say(`replay: ${result.file} (${result.type}, ${result.manifest.piece}) against its recipe at seed ${options.seed}${was === undefined ? ', the seed it was made at' : ` instead of its own seed ${was}`}: ${result.match ? 'the same picture' : 'differs'}; ${result.detail}`);
    if (!options.json) console.log('report: ' + slash(await saveReport('replay-' + path.basename(result.file) + '-seed' + options.seed, result, dir ?? reportDirectory(result.file))));
    return;
  }
  const differs = `DIFFERS: the file is not what its recipe draws on Artifex ${VERSION}, so it was changed after export, made by another version${result.type === 'svg' ? '' : ' or browser'}, or its piece has changed since`;
  say(`replay: ${result.file} (${result.type}, ${made}): ${result.match ? 'matches' : differs}; ${result.detail}`);
  for (const s of result.scenes || []) {
    say(`  scene ${s.scene}, frames ${s.range[0]} to ${s.range[1] - 1} (${s.piece} seed ${s.seed}): ${s.match ? 'matches' : 'DIFFERS'}; ${s.detail}`);
  }
  for (const line of scanText(result)) say(line);
  // A --dump folder that failed a write after the comparison, once per folder.
  const unwritten = new Set([result, ...(result.scenes || [])].map((r) => r.dumpError).filter(Boolean));
  for (const cause of unwritten) console.error(cause);
  if (!options.json) console.log('report: ' + slash(await saveReport('replay-' + path.basename(result.file), result, dir ?? reportDirectory(result.file))));
  if (!result.match || unwritten.size) process.exitCode = 1;
}

module.exports = {
  fileType, manifestOf, pieceFor, replaySvg, filmPlan, filmFrames, replayVerdict, compareFilm, replay, parseArgs, main, FILM_FLOOR_DB,
  soundPlan, compareSound, soundWav, soundVerdict, SOUND_BLOCK, SOUND_FLOOR_DB, SOUND_GATE_DB, SOUND_BAND, SOUND_FLATNESS, SOUND_NOISE_DB, SOUND_VOICE, SOUND_MASK_DB, SOUND_CUT, SOUND_SPARSE, SOUND_NEAR_DB, SOUND_SPILL_DB,
  pngPlan, pngVerdict, comparePng, webmPlan, compareWebm, PNG_FLOOR_DB, sendBytes,
  frameChange, activityLag, scanText, SCAN_WIDTH, LAG_FRAMES,
};

// After the exports are set, so a module that requires this one back reads them whole.
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
