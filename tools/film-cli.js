#!/usr/bin/env node
'use strict';

// Save a piece's MP4 film from the command line.
//
// The film is made by the page's own __artifex.film(), in installed Edge on
// check-browser's withEdge lifecycle, so the file is the one the page's MP4
// button saves: the same frames, soundtrack, levelling and replay manifest.
// This adds no exporter of its own; it carries the bytes back and writes them.
//
//   npm run film -- readout                          out/readout.mp4
//   npm run film -- ./boat.cjs --out boat.mp4        beside the caller
//   npm run film -- readout --bitrate 30000000       more bits than the default
//   npm run film -- readout --seed 7                 at seed 7 instead of the piece's own
//   npm run film -- settle --force no-aac            with AAC refused, so an Opus soundtrack
//   npm run film -- refit --reframe 0:720x720,1:405x720   along another box timeline
//   npm run film -- cues --crash-gpu 1500            with Edge's GPU process crashed 1.5 s into the export
//   npm run film -- ./game.cjs --session game-1.session.json   an interactive piece's saved session, one frame a tick
//
// Writes the MP4 and its report, the MP4's name with .json added, and prints
// one summary line. Exits 1 with the page's own message when the export fails.
// On stderr it reminds, one line per look, which looks of "Look at a film" npm run seeds
// has not drawn since the piece's module, or a module bundled with it, last changed, with
// the command that draws each, then says what a fresh-eyes review of the saved film finds.

const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const EXAMPLES = require('../examples/index.js');
const { bundle, html } = require('./build-page.js');
const { filmNote } = require('../core/export.js');
const { validate, atBox, parseReframe, solve } = require('../core/piece.js');
const { withEdge, waitFor, evaluate, evaluateInPieces, pageErrors, FORCED, timeoutArg } = require('./check-browser.js');
const { callerDirectory, shown, resolvePiece, outputDirectory, quote, quoteWord, hint, sessionInput, keepSessionBeside } = require('./piece-input.js');
const { SOUND_HELPERS, soundPicture, soundSummary, drawSound, silentSpans, contactList, SOUND_WAVE, SOUND_ROWS } = require('./contact-sheet.js');
// soundInPage runs in Node too (in tests); contact-sheet keeps soundSquares only in the helpers it serializes.
const soundSquares = new Function(SOUND_HELPERS + '\nreturn soundSquares;')();

const USAGE = 'usage: npm run film -- <piece | ./piece.cjs> [--out file.mp4] [--seed n] [--scale n] [--bitrate bit/s] [--reframe t:WxH,t:WxH,...]'
  + ' [--session file.session.json] [--force no-aac|no-webgl2] [--crash-gpu ms] [--edge PATH] [--timeout-ms N] [--headed]';
// A long film takes minutes to draw and encode; the deadline still ends a hung export.
const TIMEOUT_MS = 600000, MAX_TIMEOUT_MS = 3600000;
// The decoded soundtrack's picture, in pixels across the whole film.
const SOUND_WIDTH = 1280;
/** A refused argument: its cause, then the usage line. */
const refuse = (cause) => new Error('film: ' + cause + '\n' + USAGE);

function parseArgs(args) {
  const out = { piece: null, style: null, out: null, film: {}, browser: { timeoutMs: TIMEOUT_MS } };
  const value = (i) => {
    if (args[i + 1] === undefined || args[i + 1].startsWith('--')) throw refuse(args[i] + ' needs a value');
    return args[i + 1];
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--out') out.out = value(i++);
    else if (a === '--style') out.style = value(i++);
    // Checked as npm run still checks it; absent, the film is at the piece's own seed.
    else if (a === '--seed') {
      if (out.seed !== undefined) throw refuse('give --seed only once');
      const text = value(i++), n = Number(text);
      if (!/^\d+$/.test(text) || n > 0xffffffff) throw refuse('--seed takes a whole number from 0 to 4294967295, got ' + text);
      out.seed = n;
    }
    else if (a === '--scale' || a === '--bitrate') {
      const n = Number(value(i));
      if (!(Number.isFinite(n) && n > 0)) throw refuse(a + ' must be a positive number, got ' + args[i + 1]);
      out.film[a.slice(2)] = n;
      i++;
    }
    // A box timeline read as text here; filmTarget refuses one the piece cannot play.
    else if (a === '--reframe') {
      if (out.reframe) throw refuse('give --reframe only once');
      const text = value(i++);
      try { out.reframe = parseReframe(text); } catch (e) { throw refuse('--' + e.message); }
    }
    // An interactive piece's saved session; filmTarget reads and checks it.
    else if (a === '--session') {
      if (out.session) throw refuse('give --session only once');
      out.session = value(i++);
    }
    else if (a === '--edge') out.browser.edge = value(i++);
    else if (a === '--timeout-ms') {
      out.browser.timeoutMs = timeoutArg(value(i++), refuse, { max: MAX_TIMEOUT_MS, fallback: TIMEOUT_MS });
    }
    else if (a === '--headed') out.browser.headed = true;
    // A probe: the owned Edge's GPU process crashed this many milliseconds into the export.
    else if (a === '--crash-gpu') {
      const text = value(i++), ms = Number(text);
      if (!/^\d+$/.test(text)) throw refuse('--crash-gpu takes whole milliseconds from 0, got ' + text);
      // Node runs a timer set past 2^31 - 1 ms after 1 ms instead.
      if (ms > 2147483647) throw refuse('--crash-gpu takes at most 2147483647 ms, got ' + text);
      out.crashGpu = ms;
    }
    // The browser check's conditions, installed by withEdge, one per film.
    else if (a === '--force') {
      const force = value(i++);
      if (out.browser.force) throw refuse('give --force only once');
      // Without H.264 the page offers only its WebM recording, which this command does not save.
      if (force === 'no-h264') throw refuse('--force no-h264 leaves the page only its WebM recording, which npm run film does not save; check that recording with npm run browser -- --force no-h264, which takes no piece and records the first film its run exports');
      // The crash itself comes from --crash-gpu; FORCED's gpu-crash only hides WebGL2.
      if (force === 'gpu-crash') throw refuse('--force gpu-crash only hides WebGL2 and crashes nothing here; use --crash-gpu <ms> to crash the GPU process that many milliseconds into the export');
      if (!Object.hasOwn(FORCED, force)) throw refuse('--force takes no-aac or no-webgl2, got ' + force);
      out.browser.force = force;
    }
    else if (a.startsWith('--')) throw refuse('unknown option ' + a);
    else if (out.piece) throw refuse('one piece per film, got "' + out.piece + '" and "' + a + '"');
    else out.piece = a;
  }
  if (!out.piece && !out.style) throw refuse('name the piece to film: an example or ./piece.cjs');
  if (out.piece && out.style) throw refuse('give a piece or --style, not both; got "' + out.piece + '" and --style ' + out.style);
  // Only an .mp4 is written, so a slip of the option never replaces a piece or its data.
  if (out.out !== null && !/\.mp4$/i.test(out.out)) throw refuse('--out must name an .mp4 file, got ' + out.out);
  return out;
}

/**
 * The piece to film and where its film goes: `{ name, external, file }`. A
 * registered example writes under out/ (the library's own from inside it, else
 * the caller's, so an installed copy holds no output), an external piece beside
 * its module (a piece inside the library goes under out/pieces/ instead; see
 * docs/knowledge/command-line-tools.md#external-pieces), unless `--out` names
 * the file, relative to the caller's directory. `--style` is
 * refused with where the style's guide and mark functions are, since a style
 * is no piece.
 */
function filmTarget(options, cwd = callerDirectory()) {
  const { name, external, file } = resolvePiece(options, cwd, refuse, '.mp4');
  const target = { name, external, file, ...(options.seed !== undefined && { seed: options.seed }) };
  // An interactive piece has no film of its own, only its sessions'.
  if (!options.session && validate(external ? external.piece : EXAMPLES[name]).play) {
    throw refuse(`${name} is interactive, so its film comes from a saved session; pass --session <file> as the page's save session wrote it`);
  }
  // A saved session is read and checked here, before Edge starts, and names the film after itself.
  if (options.session) {
    if (options.reframe) throw refuse('give --reframe or --session, not both: a session plays at the box it was played at');
    const session = sessionInput(options, cwd, refuse, validate(external ? external.piece : EXAMPLES[name]), file);
    return { ...target, file: session.output, session };
  }
  if (!options.reframe) return target;
  // A box timeline the piece cannot play is refused by name before Edge starts.
  try { atBox(validate(external ? external.piece : EXAMPLES[name]), options.reframe); }
  catch (e) { throw refuse('--reframe: ' + e.message.replace(/^atBox: /, '')); }
  return { ...target, reframe: options.reframe };
}

// Serialized into the page. The page's own export of `name`, along the box
// timeline `reframe` when one is given, at `seed` when one is given, or the
// film of the saved `session` ({ file, name }) when one is given, with
// `opts` ({ scale, bitrate }) passed through, and its file as base64. A film
// with sound also returns `picture(bytes, report)`, the picture of its decoded
// soundtrack, as `sound`.
async function exportInPage(name, opts, reframe = null, picture = null, seed = null, session = null) {
  const api = window.__artifex;
  if (session) api.session(session.file, session.name);
  api.select(name);
  if (reframe) api.setReframe(reframe);
  // After select, which resets the seed to the piece's own.
  if (seed !== null) api.setSeed(seed);
  const report = await api.film(opts);
  // Read by crashAfter: past here, a crash would land on the transfer, not the export.
  globalThis.__artifexFilmEnded = true;
  const bytes = new Uint8Array(await report.blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  delete report.blob;
  const sound = report.sound && picture ? await picture(bytes, report) : null;
  return { report, data: btoa(binary), sound };
}

// Serialized into the page beside contact-sheet's SOUND_HELPERS, soundPicture,
// soundSummary, drawSound and silentSpans. The saved film's soundtrack as the browser decodes it from
// the file's `bytes`, AAC or Opus, drawn as a time strip's --sound picture
// `width` pixels wide with the frames a nine-frame strip shows marked, a
// cut where each of `shots` after the first starts and each silent stretch shaded, so what shows is what the
// file plays: { png, seconds, peakDb, rmsDb: { min, max } }, the PNG in
// base64, or { error } when the browser cannot decode it or it holds no samples.
async function soundInPage(bytes, report, width, wave, rows, shots = null) {
  try {
    const buffer = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(bytes.slice().buffer);
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    const squares = soundSquares(channels), pic = soundPicture(channels, buffer.sampleRate, width, rows, squares);
    const x = (frame) => Math.min(width - 1, Math.round((frame / report.hz / pic.seconds) * width));
    const frames = [...new Set(Array.from({ length: 9 }, (_, i) => Math.round((i * (report.frames - 1)) / 8)))];
    const marks = frames.map((frame) => ({ frame, x: x(frame) }));
    // The page's report carries only a shot list that lies within the film's frames, or null.
    const cuts = (shots || []).slice(1).map((s) => ({ shot: s.name, frame: s.start, x: x(s.start) }));
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = 16 + wave + 6 + rows + 18;
    drawSound(canvas.getContext('2d'), pic, { wave, marks, cuts, silences: silentSpans(squares, buffer.sampleRate) });
    const { peakDb, rmsDb } = soundSummary(pic), round = (db) => Math.round(db * 10) / 10;
    return {
      png: canvas.toDataURL('image/png').split(',')[1], seconds: pic.seconds,
      peakDb: round(peakDb), rmsDb: { min: round(rmsDb.min), max: round(rmsDb.max) },
    };
  } catch (e) { return { error: String((e && e.message) || e) }; }
}

/**
 * Crash the owned Edge's GPU process through CDP `ms` after `exported`, the
 * film export, started. Resolves to whether it crashed: false when the page's
 * export ended first.
 */
async function crashAfter(client, context, exported, ms) {
  let ended = false;
  exported.then(() => { ended = true; }, () => { ended = true; });
  await Promise.race([delay(ms, undefined, { signal: context.signal, ref: false }), exported.catch(() => {})]);
  // An export that ends within the next CDP round trip still counts as crashed, though the crash hits its transfer.
  if (ended || await evaluate(client, 'globalThis.__artifexFilmEnded === true')) return false;
  await client.send('Browser.crashGpuProcess');
  return true;
}

/**
 * Export `target`'s film in installed Edge; resolves to { browser, report, bytes, sound },
 * with `crashed` when `crashGpu` milliseconds asked for the GPU process to crash.
 * `edge` stands in for withEdge in tests.
 */
async function exportFilm(target, film = {}, browser = {}, crashGpu, edge = withEdge) {
  const page = html(bundle(target.external), target.external ? { count: 1 } : {});
  return edge(page, { ...browser, command: 'film' }, async (client, context) => {
    await waitFor(client, context, 'document.readyState === "complete" && !!window.__artifex');
    context.phase = 'film export ' + target.name;
    // The film comes back as base64, in pieces, since it passes the 4 MiB a reply may carry.
    // The sound picture's cuts are the shots of the solve the page exported, carried in its report.
    const picture = '(bytes, report) => (' + soundInPage + ')(bytes, report, ' + [SOUND_WIDTH, SOUND_WAVE, SOUND_ROWS] + ', report.shots)';
    const exported = evaluateInPieces(client, '(() => {\n' + SOUND_HELPERS + soundPicture + '\n' + soundSummary + '\n' + drawSound + '\n' + silentSpans + '\nreturn (' + exportInPage.toString() + ')('
      + JSON.stringify(target.name) + ', ' + JSON.stringify(film) + ', ' + JSON.stringify(target.reframe || null) + ', ' + picture + ', ' + JSON.stringify(target.seed ?? null)
      + ', ' + JSON.stringify(target.session ? { file: target.session.file, name: target.session.name } : null) + ');\n})()');
    const crashed = crashGpu === undefined ? undefined : await crashAfter(client, context, exported, crashGpu);
    const { report, data, sound } = await exported;
    pageErrors(client, context);
    return { browser: context.version.Browser, report, bytes: Buffer.from(data, 'base64'), sound, ...(crashed !== undefined && { crashed }) };
  });
}

// The looks films.md's "Look at a film" asks for before delivery, each with
// the npm run seeds options that draw it; shots only for a film whose report
// carries a shot list, contacts only for a piece whose built state keeps a
// contact list, sound only for one with a soundtrack.
const LOOKS = {
  seeds: '', frames: '--frames 9', at: '--at "<each cut, beat and contact, in s>"', shots: '--shots',
  contacts: '--contacts', loupe: '--at "<s,s,...>" --loupe', sound: '--frames 9 --sound',
};

/**
 * The dotted names of the lists in `target`'s state, built at the film's seed,
 * that npm run seeds --contacts draws, such as `cues.contacts`, searched three
 * levels deep.
 */
function contactKeys(target) {
  const own = validate(target.external ? target.external.piece : EXAMPLES[target.name]);
  // Along the film's box timeline, as npm run seeds --reframe builds it.
  const p = target.reframe ? atBox(own, target.reframe) : own;
  const seed = target.seed ?? p.seed, keys = [];
  // Built once; a piece that fails to build keeps no list npm run seeds --contacts would draw.
  const solved = solve(p, seed);
  if (solved.stages.error) return keys;
  const walk = (v, key, depth) => {
    if (Array.isArray(v)) {
      // Only a list whose first entry is on a frame or at seconds is offered to contactList, which reads the same state.
      const c = v[0];
      if (c && (Number.isInteger(c.frame) || Number.isFinite(c.seconds))) {
        try { contactList(p, key, seed, solved.state); keys.push(key); } catch {}
      }
    } else if (v && typeof v === 'object' && depth < 3) {
      for (const k of Object.keys(v)) if (/^[\w$]+$/.test(k)) walk(v[k], key ? key + '.' + k : k, depth + 1);
    }
  };
  walk(solved.state, '', 0);
  return keys;
}
const FILMS_MD = path.join(__dirname, '..', 'skills', 'artifex', 'reference', 'films.md');
// A strip's file name as npm run seeds writes it (contact-sheet's sheetStem), after the piece's stem:
// the look, a contact list with its case hash, then the seed, sound and box suffixes.
const STRIP_NAME = /^-(seeds|frames|at|shots|contacts-[\w$.]+(?:-[0-9a-f]{6})?)(?:-loupe)?(-seed\d+)?(-sound)?(-reframe|-\d+x\d+)?(?:-reference)?\.html$/;

/**
 * Which required looks of `target` npm run seeds has drawn since its source
 * last changed: { source, fresh, stale, missing }, each a list of LOOKS names,
 * with `contacts`, the contactKeys, when the piece keeps a contact list.
 * `source` is the newest of the modules loadExternal bundled for the piece (an example: its own module);
 * one that can no longer be read is skipped, and with none left `source` is null.
 * Only strips at the film's seed and box timeline count. A look is fresh when one of its strips is no older than `source`,
 * stale when all of them are older, missing when none was drawn.
 */
function filmLooks(target, report) {
  const files = target.external ? target.external.modules.map((m) => m.file) : [path.join(__dirname, '..', 'examples', target.name + '.js')];
  const times = files.flatMap((file) => { try { return [[file, fs.statSync(file).mtimeMs]]; } catch { return []; } });
  const [source, changed] = times.reduce((a, b) => (b[1] > a[1] ? b : a), [null, -Infinity]);
  const dir = outputDirectory(target.external), stem = target.external ? target.external.stem : target.name;
  const newest = {};
  const saw = (look, ms) => { newest[look] = Math.max(newest[look] ?? -Infinity, ms); };
  // Only a strip at the film's seed and box timeline counts; a contact sheet sweeps seeds, so it has no seed suffix.
  const seed = target.seed !== undefined ? '-seed' + target.seed : '', box = target.reframe ? '-reframe' : '';
  for (const file of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const m = file.startsWith(stem) && STRIP_NAME.exec(file.slice(stem.length));
    if (!m || (m[2] ?? '') !== (m[1] === 'seeds' ? '' : seed) || (m[4] ?? '') !== box) continue;
    const ms = fs.statSync(path.join(dir, file)).mtimeMs;
    saw(m[1].replace(/-.*/, ''), ms);
    if (m[3]) saw('sound', ms);
    if (/var STRIP = \{[^\n]*"loupe":\{/.test(fs.readFileSync(path.join(dir, file), 'utf8'))) saw('loupe', ms);
  }
  const looks = { source, fresh: [], stale: [], missing: [] };
  const contacts = contactKeys(target);
  if (contacts.length) looks.contacts = contacts;
  for (const look of Object.keys(LOOKS)) {
    if ((look === 'shots' && !report.shots) || (look === 'contacts' && !contacts.length) || (look === 'sound' && !report.sound)) continue;
    looks[newest[look] === undefined ? 'missing' : newest[look] >= changed ? 'fresh' : 'stale'].push(look);
  }
  return looks;
}

async function main(args = process.argv.slice(2), run = exportFilm, cwd = callerDirectory()) {
  if (args.includes('--help') || args.includes('-h')) return console.log(USAGE);
  const options = parseArgs(args);
  const target = filmTarget(options, cwd);
  const { browser, report, bytes, sound = null, crashed } = await run(target, options.film, options.browser, options.crashGpu);
  // A film cut short in transfer is never written.
  if (bytes.length !== report.bytes) throw new Error(`film: ${bytes.length} of the film's ${report.bytes} bytes arrived; nothing was written`);
  fs.mkdirSync(path.dirname(target.file), { recursive: true });
  fs.writeFileSync(target.file, bytes);
  // Replay reads a session's film beside the session it was played from.
  if (target.session) keepSessionBeside(target.session);
  // The decoded soundtrack's picture; an earlier run's is removed, so a film without sound leaves none.
  const soundFile = target.file + '.sound.png';
  fs.rmSync(soundFile, { force: true });
  if (sound && sound.png) fs.writeFileSync(soundFile, Buffer.from(sound.png, 'base64'));
  const decoded = sound && (sound.png ? { file: soundFile, seconds: sound.seconds, peakDb: sound.peakDb, rmsDb: sound.rmsDb } : { error: sound.error });
  const reportFile = target.file + '.json';
  const forced = options.browser.force;
  const gpuCrash = options.crashGpu !== undefined && { atMs: options.crashGpu, crashed: !!crashed };
  const looks = filmLooks(target, report);
  fs.writeFileSync(reportFile, JSON.stringify({ file: target.file, piece: target.name, browser, ...report, ...(forced && { forced }), ...(gpuCrash && { gpuCrash }), ...(decoded && { decoded }), looks }, null, 2) + '\n');
  const crashNote = !gpuCrash ? '' : gpuCrash.crashed ? ' GPU process crashed ' + gpuCrash.atMs + ' ms into the export.' : ' The export ended before ' + gpuCrash.atMs + ' ms, so the GPU process was not crashed.';
  const soundNote = !decoded ? '' : decoded.file ? ' Decoded soundtrack: ' + shown(soundFile) + '.' : ' The soundtrack could not be decoded to draw it: ' + decoded.error + '.';
  // Where the frames were drawn, in the browser check's words, when the export could tell.
  const drawn = report.rasterizer ? ' Film made from frames drawn ' + (report.rasterizer === 'gpu' ? 'on the GPU' : 'in memory') + '.' : '';
  // A forced film says so first, as a forced browser check does.
  const sessionNote = target.session ? ' Played from ' + shown(target.session.beside) + ', which replay reads beside it.' : '';
  console.log('film' + (forced ? ' with ' + FORCED[forced].means : '') + ': ' + shown(target.file) + ': ' + filmNote(report) + drawn + crashNote + soundNote + sessionNote + ' Report: ' + shown(reportFile));
  // npm run seeds draws no session yet, so a session's film is shown no looks to draw.
  if (target.session) return console.error(`film: a fresh-eyes review by a subagent without this work's context finds what the plan's author cannot see: ${shown(FILMS_MD)}#fresh-eyes-review`);
  // The film is saved either way; the looks not drawn since the piece changed go to stderr, one per line,
  // each command at the film's seed and box timeline. A contact sheet sweeps seeds, so it takes no --seed.
  const reframe = options.reframe ? '--reframe ' + options.reframe.map((k) => `${k.t}:${k.w}x${k.h}`).join(',') : '';
  const seed = options.seed !== undefined ? '--seed ' + options.seed : '';
  const lists = looks.contacts || [];
  for (const look of [...looks.missing, ...looks.stale]) {
    // The contact list by name, or the lists to pick from, quoted as one placeholder, when the state keeps several.
    const flags = look !== 'contacts' ? LOOKS[look] : LOOKS[look] + ' ' + quoteWord(lists.length === 1 ? lists[0] : `<${lists.join(' or ')}>`);
    console.error(`film: look ${looks.missing.includes(look) ? 'not drawn' : 'older than ' + shown(looks.source)}: ${look}; ${hint('seeds', quote(options.piece), flags, look === 'seeds' ? '' : seed, reframe, '--png')}`);
  }
  console.error(`film: a fresh-eyes review by a subagent without this work's context finds what the plan's author cannot see, such as a place left unshown, a cause off screen or a beat that reads only to someone who knows it: ${shown(FILMS_MD)}#fresh-eyes-review`);
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { parseArgs, filmTarget, exportInPage, soundInPage, crashAfter, exportFilm, filmLooks, main, TIMEOUT_MS };
