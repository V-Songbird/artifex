#!/usr/bin/env node
'use strict';

// Native Node 22 globals speak CDP to an installed Edge. No browser download,
// dependency, existing profile, or externally owned debugging port is used.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const { webmBlockTimes, filmVerdict, filmDrawnAgain } = require('../core/export.js');
const { flashNote, WCAG } = require('../core/flash.js');
const { LOUDNESS } = require('../core/film.js');
const { loadExternal, slash, quote, hint, callerDirectory, outRoot } = require('./piece-input.js');
const { solve } = require('../core/piece.js');
const { sample } = require('../core/image.js');

const ROOT = path.resolve(__dirname, '..');
const OUT = outRoot(); // the library's out/ in a clone, the caller's from outside it
// A film that flashes on purpose, both ways, so the count is seen to work.
const FLASH_FIXTURE = path.join(ROOT, 'tools', 'fixtures', 'flash-film.cjs');
// A film drawn over and from an image it declares, so a declared image is seen
// in the page's own PNG and to replay in its PNG and its film.
const IMAGE_FIXTURE = path.join(ROOT, 'tools', 'fixtures', 'image-piece.cjs');
// An interactive piece, played in the page through real pointer and key input,
// so a recorded session is seen to run again to the same frames, and its film
// and still to replay from the session saved beside them.
const PLAY_FIXTURE = path.join(ROOT, 'tools', 'fixtures', 'play-piece.cjs');
// How many ticks the play fixture is played for after its last input.
const PLAY_TAIL = 30;
// Pixels of the image fixture's first frame, away from its marks, where its PNG
// must show the image itself, and by how many levels a channel there may differ
// from the image read bilinearly: any smooth upscale of the fixture's linear
// ramps lands within a few.
const IMAGE_POINTS = [[16, 16], [303, 16], [16, 163], [303, 163], [160, 40]];
const IMAGE_LEVELS = 6;
// A 3 x 1 RGB PNG tagged gAMA 1.0, so its bytes 128, 64 and 255 are linear
// light, and those values on the sRGB curve, as npm run image must store them.
const GAMMA_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAMAAAABCAIAAACUgoPjAAAABGdBTUEAAYagMeiWXwAAABJJREFUeNpjaHD47/C/4X+DAwAaOwU+5g9omwAAAABJRU5ErkJggg==';
const GAMMA_SRGB = [188, 137, 255, 137, 255, 188, 255, 188, 137];
const USAGE = 'usage: node tools/check-browser.js [--edge PATH] [--timeout-ms 60000] [--headed] [--force no-aac|no-webgl2|no-h264|gpu-crash] [--allow-fallback] [--json]';

// Serialized into the page before it loads, one per export fallback. Each takes
// away one thing the browser can do, as a browser without it would answer, and
// leaves everything else to the real browser.
function refuseAac() {
  const ask = AudioEncoder.isConfigSupported.bind(AudioEncoder);
  AudioEncoder.isConfigSupported = (config) => (/^mp4a\./.test(config.codec) ? Promise.resolve({ supported: false, config }) : ask(config));
}

function hideWebgl2() {
  for (const Canvas of [globalThis.HTMLCanvasElement, globalThis.OffscreenCanvas].filter(Boolean)) {
    const get = Canvas.prototype.getContext;
    Canvas.prototype.getContext = function (type, ...rest) { return type === 'webgl2' ? null : get.call(this, type, ...rest); };
  }
}

function refuseH264() {
  const ask = VideoEncoder.isConfigSupported.bind(VideoEncoder);
  VideoEncoder.isConfigSupported = (config) => (/^avc1\./.test(config.codec) ? Promise.resolve({ supported: false, config }) : ask(config));
}

// The conditions `--force` can install, and what a forced run's summary calls them.
const FORCED = {
  'no-aac': { means: 'AAC refused', install: refuseAac },
  'no-webgl2': { means: 'WebGL2 hidden', install: hideWebgl2 },
  'no-h264': { means: 'H.264 refused', install: refuseH264 },
  // Only the CPU route's canvas is watched for a lost GPU, so WebGL2 is hidden
  // too, and checkPage crashes the GPU process part-way through the export.
  'gpu-crash': { means: 'the GPU process crashed mid-export', install: hideWebgl2 },
};

// withEdge's time limit when a tool gives none.
const TIMEOUT_MS = 60000;

// A --timeout-ms value as whole milliseconds from min to max; `refuse` makes the
// tool's own error, told the default it keeps and, after "milliseconds", any `per`.
// max is clamped to 2147483647, setTimeout's limit: past it Node waits 1 ms instead.
function timeoutArg(text, refuse, { min = 100, max = 300000, fallback = TIMEOUT_MS, per = '' } = {}) {
  const ms = Number(text);
  max = Math.min(max, 2147483647);
  if (!/^\d+$/.test(text) || ms < min || ms > max) {
    throw refuse('--timeout-ms takes an integer from ' + min + ' to ' + max + ' milliseconds' + per + ' (default ' + fallback + '), got ' + text);
  }
  return ms;
}

function parseArgs(args) {
  const options = { timeoutMs: TIMEOUT_MS, headed: false };
  const refuse = (cause) => new Error('browser: ' + cause + '\n' + USAGE);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--headed') options.headed = true;
    else if (arg === '--edge') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw refuse('--edge needs the path to msedge');
      options.edge = args[++i];
    }
    else if (arg === '--timeout-ms') {
      if (!/^\d+$/.test(args[i + 1] || '')) throw refuse('--timeout-ms needs a whole number of milliseconds, got ' + (args[i + 1] ?? 'nothing'));
      options.timeoutMs = timeoutArg(args[++i], refuse);
    }
    // One condition per run, so a verdict names the one fallback it checked.
    else if (arg === '--force') {
      if (options.force) throw refuse('give --force only once');
      if (!Object.hasOwn(FORCED, args[i + 1] || '')) throw refuse('--force takes no-aac, no-webgl2, no-h264 or gpu-crash, got ' + (args[i + 1] ?? 'nothing'));
      options.force = args[++i];
    }
    // For a machine without a usable GPU, where the encoder route cannot run.
    else if (arg === '--allow-fallback') options.allowFallback = true;
    // Print the whole report instead of writing it to a file.
    else if (arg === '--json') options.json = true;
    else throw refuse('unknown option ' + arg);
  }
  return options;
}

/**
 * Where an installed browser is looked for, in order: every Microsoft Edge
 * path first, then Google Chrome, then Chromium. All three speak the DevTools
 * protocol the tools drive; Edge stays first because the checks are run on it.
 */
function browserCandidates(env = process.env, platform = process.platform) {
  if (platform === 'win32') {
    const dirs = [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean);
    return [['Microsoft', 'Edge', 'Application', 'msedge.exe'], ['Google', 'Chrome', 'Application', 'chrome.exe'], ['Chromium', 'Application', 'chrome.exe']]
      .flatMap((parts) => dirs.map((dir) => path.join(dir, ...parts)));
  }
  if (platform === 'darwin') {
    return ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'];
  }
  return ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable', '/opt/microsoft/msedge/msedge',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];
}

/** The browser the tools drive: `--edge` or EDGE_PATH when given (any Chromium-family browser), else the first of browserCandidates on disk. */
async function findEdge(explicit, env = process.env, platform = process.platform) {
  const named = explicit || env.EDGE_PATH;
  const candidates = named ? [named] : browserCandidates(env, platform);
  // A relative Edge path follows the npm-run rule of every other path argument.
  const caller = callerDirectory(process.cwd(), env);
  const tried = [];
  for (const candidate of candidates) {
    const resolved = path.resolve(caller, candidate);
    if (await fs.stat(resolved).then((stat) => stat.isFile(), () => false)) return resolved;
    tried.push(resolved);
  }
  throw new Error('browser: ' + (named ? 'installed Microsoft Edge was not found at ' : 'no installed Microsoft Edge, Chrome or Chromium was found at ')
    + tried.join(' or ') + '; use --edge PATH or EDGE_PATH (no browser is downloaded)');
}

function untilAbort(promise, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

async function connectCDP(url, signal, WebSocketClass = globalThis.WebSocket) {
  signal.throwIfAborted();
  const socket = new WebSocketClass(url);
  const pending = new Map(), listeners = new Set();
  let nextId = 0, failure = null;
  let opened, refused;
  const ready = new Promise((resolve, reject) => { opened = resolve; refused = reject; });
  function fail(error) {
    if (failure) return;
    failure = error;
    refused(error);
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    signal.removeEventListener('abort', abort);
  }
  function abort() { fail(signal.reason); socket.close(); }
  signal.addEventListener('abort', abort, { once: true });
  socket.addEventListener('open', () => opened());
  socket.addEventListener('error', () => fail(new Error('browser: CDP WebSocket failed')));
  socket.addEventListener('close', (event) => fail(new Error('browser: CDP connection closed (' + event.code + ': ' + (event.reason || 'no reason') + ')')));
  socket.addEventListener('message', (event) => {
    let message;
    try { message = JSON.parse(event.data); }
    catch { fail(new Error('browser: invalid CDP response')); socket.close(); return; }
    if (message.id !== undefined) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error('browser: ' + request.method + ': ' + message.error.message));
      else request.resolve(message.result);
    } else {
      for (const listener of listeners) listener(message);
    }
  });
  try { await ready; } catch (error) { socket.close(); throw error; }
  return {
    onEvent(listener) { listeners.add(listener); },
    send(method, params = {}) {
      if (failure) return Promise.reject(failure);
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject, method });
        try { socket.send(JSON.stringify({ id, method, params })); }
        catch (error) { pending.delete(id); reject(error); }
      });
    },
    close() { fail(new Error('browser: CDP client closed')); socket.close(); },
  };
}

// The page's description of an error it threw: "<name>: <message>", then the stack.
const PAGE_ERROR = /^(\w+): ([^]*?)(?:\n\s+at [^]*)?$/;

/**
 * The refusal a page error's `description` stands for, or null: a PieceError
 * is "<command>: <message>", and an Error whose message opens with
 * "<command>: " is that message. Any other error, a piece's own among them,
 * is no refusal, and without a `command` nothing is.
 */
function pageRefusal(description, command) {
  const [, name, message] = (command && PAGE_ERROR.exec(description)) || [];
  if (name === 'PieceError') return command + ': ' + message;
  if (name === 'Error' && message.startsWith(command + ': ')) return message;
  return null;
}

/**
 * The value of `expression` in the page. A page error that is a refusal of
 * `client.command`, the tool the user ran, as withEdge's `options.command`
 * names it (pageRefusal), throws as that message alone, marked `pageRefusal`
 * so withEdge adds no phase; any other page error keeps "browser: evaluation
 * failed: " and the page's description with its stack.
 */
async function evaluate(client, expression) {
  const reply = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (reply.exceptionDetails) {
    const description = reply.exceptionDetails.exception?.description || reply.exceptionDetails.text;
    const refusal = pageRefusal(description, client.command);
    if (refusal) throw Object.assign(new Error(refusal), { pageRefusal: true });
    throw new Error('browser: evaluation failed: ' + description);
  }
  return reply.result?.value;
}

// The most characters of a value's JSON one reply carries. Node's WebSocket
// refuses a message from the browser whose decompressed size passes 4 MiB
// ("Max decompressed message size exceeded", measured with Edge 153 and Node
// 22); a reply adds about 60 bytes, and escaping can make one character six.
const PIECE_CHARS = 1 << 19;

/**
 * The value of `expression`, as evaluate returns it, carried from the page as
 * its JSON text in pieces of at most `piece` characters, so a value past that
 * limit, such as a recording read back whole, arrives whole. The page keeps
 * the text only until the last piece is read.
 */
async function evaluateInPieces(client, expression, piece = PIECE_CHARS) {
  const length = await evaluate(client, '(async () => (globalThis.__artifexValue = JSON.stringify(await (' + expression + '))).length)()');
  let text = '';
  for (let at = 0; at < length; at += piece) text += await evaluate(client, 'globalThis.__artifexValue.slice(' + at + ', ' + (at + piece) + ')');
  await evaluate(client, 'delete globalThis.__artifexValue');
  return JSON.parse(text);
}

async function servePage(page, file = null) {
  // Serve only this immutable HTML snapshot and, when given, the bytes of one
  // file at /file, never arbitrary workspace paths.
  const server = http.createServer((request, response) => {
    let pathname;
    try { pathname = new URL(request.url, 'http://localhost').pathname; }
    catch { response.writeHead(400).end(); return; }
    if (request.method === 'GET' && file && pathname === '/file') {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(file);
      return;
    }
    if (request.method !== 'GET' || !['/', '/index.html'].includes(pathname)) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(page);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: 'http://127.0.0.1:' + server.address().port + '/',
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}

// Serialized into the page. Counts nontransparent pixels, including backgrounds;
// this smoke check establishes native rendering, not composition or ink coverage.
function inspectPiece(name) {
  const api = window.__artifex;
  const check = (condition, message) => { if (!condition) throw new Error(name + ': ' + message); };
  api.select(name);
  api.setT(0.5);
  const state = api.read(), manifest = api.manifest();
  check(state.name === name && !state.error, state.error || 'selection did not change');
  const p = api.piece.validate(api.examples[name]);
  check(manifest && manifest.piece === p.name && manifest.seed === state.seed
    && manifest.t === api.piece.frameT(p, state.t), 'manifest does not match the displayed recipe');
  const stages = api.stages().map((stage, index) => {
    const result = api.inspect(stage);
    check(!result.error && result.stage === stage && result.ran === index + 1, 'stage inspection failed: ' + stage);
    return stage;
  });
  const solved = api.piece.solve(p, manifest.seed, manifest.params);
  check(!solved.stages.error, 'raster build failed');
  const canvas = document.createElement('canvas');
  canvas.width = p.size.w; canvas.height = p.size.h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  api.render.drawFrame(ctx, p, solved, manifest.t);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let painted = 0;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) painted++;
  check(painted > 0, 'native canvas is fully transparent');
  const recipe = new URLSearchParams(location.search);
  check(recipe.get('piece') === name && Number(recipe.get('seed')) === manifest.seed, 'HTTP recipe URL did not update');
  const out = { name, stages, manifest, paintedPixels: painted, pixels: canvas.width * canvas.height };
  if (p.boxes) {
    // A piece that declares boxes is rebuilt at a narrower one: the page's
    // canvas, its recipe and its address bar all take the box, and it draws.
    const box = { w: Math.round((p.boxes.w[0] + p.size.w) / 2), h: p.size.h };
    api.setBox(box.w, box.h);
    const at = api.manifest(), shown = document.getElementById('c');
    check(JSON.stringify(api.read().size) === JSON.stringify(box) && JSON.stringify(at.size) === JSON.stringify(box),
      'the recipe does not name the box the page was set to');
    check(shown.width === box.w && shown.height === box.h, 'the canvas did not take the box');
    check(new URLSearchParams(location.search).get('box') === box.w + 'x' + box.h, 'the recipe URL does not name the box');
    const q = api.piece.atBox(p, box), again = api.piece.solve(q, at.seed, at.params);
    check(!again.stages.error, 'the build failed at the box');
    const boxed = document.createElement('canvas');
    boxed.width = box.w; boxed.height = box.h;
    const bg = boxed.getContext('2d', { willReadFrequently: true });
    api.render.drawFrame(bg, q, again, at.t);
    const bp = bg.getImageData(0, 0, box.w, box.h).data;
    let boxPainted = 0;
    for (let i = 3; i < bp.length; i += 4) if (bp[i]) boxPainted++;
    check(boxPainted > 0, 'native canvas at the box is fully transparent');
    api.setBox(p.size.w, p.size.h);
    out.box = { size: box, paintedPixels: boxPainted, pixels: box.w * box.h };
  }
  return out;
}

// Serialized into the page with styles.js's drawPng, the drawing npm run still
// saves, or with pagePng, the page's own PNG button. A 40 x 20 piece paints its
// left half and leaves its right half unpainted; its PNG is decoded
// unpremultiplied. Resolves to the lowest alpha of the painted half and the
// highest of the unpainted one, for stillVerdict.
async function inspectStill(drawPng) {
  const api = window.__artifex, name = 'browser-still-alpha';
  api.examples[name] = { name, size: { w: 40, h: 20 }, draw(g) { g.fillStyle = '#336699'; g.fillRect(0, 0, 20, 20); } };
  let drawn;
  try { drawn = await drawPng(name, 1, 0, 40, null, 'browser'); } finally { delete api.examples[name]; }
  const blob = drawn.blob || new Blob([Uint8Array.from(atob(drawn.png), (c) => c.charCodeAt(0))], { type: 'image/png' });
  const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
  let painted = 255, unpainted = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3];
    if ((i / 4) % bitmap.width < bitmap.width / 2) painted = Math.min(painted, alpha);
    else unpainted = Math.max(unpainted, alpha);
  }
  return { size: [bitmap.width, bitmap.height], painted, unpainted };
}

// Serialized into the page, in drawPng's place for inspectStill: selects the
// piece `name` at `seed` and presses the page's PNG 1x button, which saves
// through core/export.js png(). The saved Blob is caught at
// URL.createObjectURL and no download starts; the selection is restored.
async function pagePng(name, seed) {
  const api = window.__artifex, was = api.read().name;
  const made = URL.createObjectURL, click = HTMLAnchorElement.prototype.click;
  let timer;
  try {
    return { blob: await new Promise((resolve, reject) => {
      URL.createObjectURL = (blob) => { resolve(blob); return made.call(URL, blob); };
      HTMLAnchorElement.prototype.click = () => {};
      api.select(name);
      api.setSeed(seed);
      document.querySelector('[data-png="1"]').click();
      timer = setTimeout(() => reject(new Error('the page\'s PNG 1x button saved nothing within 10 s' + (api.read().error ? ': ' + api.read().error : ''))), 10000);
    }) };
  } finally {
    clearTimeout(timer);
    URL.createObjectURL = made;
    HTMLAnchorElement.prototype.click = click;
    api.select(was);
  }
}

// Why inspectStill's PNG breaks the still contract, or null: the piece's 40 x
// 20 pixels, opaque where it paints and alpha 0 where it leaves them unpainted.
function stillVerdict(still) {
  if (still.size[0] !== 40 || still.size[1] !== 20) return 'the still PNG is ' + still.size.join(' x ') + ' pixels, not the piece\'s 40 x 20';
  if (still.unpainted !== 0) return 'the still PNG gives pixels the piece left unpainted an alpha up to ' + still.unpainted + ', not 0, so they are no longer transparent';
  if (still.painted !== 255) return 'the still PNG gives pixels the piece painted opaque an alpha down to ' + still.painted + ', not 255';
  return null;
}

// Serialized into the page. What filmsToExport needs of each registered example.
function exampleTraits() {
  const api = window.__artifex;
  return api.names.map((name) => {
    const p = api.piece.validate(api.examples[name]);
    return { name, sound: !!p.sound, time: !!p.time, reframe: !!p.reframe };
  });
}

// Serialized into the page and pinned in Node, so it stays self-contained. The
// films to export: every example that declares sound, so each soundtrack is
// decoded, else the first with a timeline; and the first that declares a box
// timeline, unless it is chosen already, so one film is drawn along one.
function filmsToExport(examples) {
  const sounding = examples.filter((example) => example.sound);
  const chosen = sounding.length ? sounding : examples.filter((example) => example.time).slice(0, 1);
  const reframed = examples.find((example) => example.reframe);
  return (reframed && !chosen.includes(reframed) ? chosen.concat(reframed) : chosen).map((example) => example.name);
}

// Serialized into the page and pinned in Node. A decoded frame matches its
// drawn frame when it resembles it by at least `floorDb` and at least as much
// as either neighbour; a held frame draws the same picture as its neighbour,
// so that tie is a match. `scores` pairs frame indices with PSNR in dB.
// Decoded frames of the exported films measured 40 to 54 dB from references
// drawn as the export draws them, in installed Edge; a frame of another film,
// or one the export garbled, scores far lower. Returns why a frame does not
// match, or null.
function frameMatch(frame, scores, floorDb = 30) {
  const own = scores.find(([j]) => j === frame)[1];
  const best = scores.slice().sort((a, b) => b[1] - a[1])[0];
  if (best[1] > own) return 'looks most like drawn frame ' + best[0];
  if (own < floorDb) return 'resembles its drawn frame by ' + own.toFixed(1) + ' dB, under ' + floorDb + ' dB';
  return null;
}

// Two renders of one soundtrack, compared bit for bit. Installed Edge adds up
// three or more connections into one input in an order that changes between
// renders; the examples sum their voices two at a time, so it renders each to
// the same bits every time. Returns where the two first differ, or null.
function soundMatch(a, b) {
  if (a.numberOfChannels !== b.numberOfChannels || a.length !== b.length) {
    return 'hold ' + a.numberOfChannels + ' x ' + a.length + ' and ' + b.numberOfChannels + ' x ' + b.length + ' samples';
  }
  for (let c = 0; c < a.numberOfChannels; c++) {
    const x = a.getChannelData(c), y = b.getChannelData(c);
    const xs = new Uint32Array(x.buffer, x.byteOffset, x.length), ys = new Uint32Array(y.buffer, y.byteOffset, y.length);
    for (let i = 0; i < x.length; i++) {
      if (xs[i] !== ys[i]) return 'differ first in channel ' + c + ' at sample ' + i + ': ' + x[i] + ' (0x' + xs[i].toString(16) + ') against ' + y[i] + ' (0x' + ys[i].toString(16) + ')';
    }
  }
  return null;
}

// Serialized into the page as PAGE_LOUDNESS_MATCH, with LOUDNESS from
// core/film.js handed in, and pinned in Node. The export levels every
// soundtrack to its `target`, limiting its peaks under the codec's `ceiling`,
// or where the limiter's depth stops it first (`depth`, or `sparse.depth` for
// a sparse soundtrack, whose accents it keeps), with its peaks at that
// ceiling, and the decoded film has to measure so, codec and all. A codec
// lowered the examples' true peak by up to 0.10 dB in installed Edge, Opus, so
// a quieter soundtrack's decoded peak is held no more than PEAK_WITHIN under
// the ceiling, and raised limited peaks by up to 0.71 dB, so it is held under
// the ceiling plus LOUDNESS's `rise` whatever the codec. `heard` is the decoded
// soundtrack's { lufs, dbtp }; `sound` is the export's report, whose `short`
// must be there exactly when the `lufs` it encoded at is more than `short` LU
// under the target. That `lufs` is rounded to two decimals and `short` is
// measured before rounding, so at exactly `short` LU under either is right.
// Returns why the soundtrack does not match, or null. It refuses by name, with
// the value given, a `rise` that is not a finite number, a missing `ceiling`
// object (an array or a class instance is not one), and a codec with no finite
// `ceiling` or no finite PEAK_WITHIN, rather than judge the peak against a NaN
// bar; likewise a `target` or `short` that is not a finite number. A null or
// empty `codec` counts as none. The peak refusal names the codec as given,
// except that mp4a reads AAC.
function loudnessMatch(heard, sound, loudness = LOUDNESS) {
  // Inside the function, since the page gets only its source text.
  const LUFS_WITHIN = 0.1, PEAK_WITHIN = { mp4a: 0.1, Opus: 0.15 };
  const { target, short } = loudness;
  const codec = sound.codec === null || sound.codec === '' ? undefined : sound.codec;
  if (!Number.isFinite(target)) return 'the loudness target is ' + String(target) + ', not a finite number, so the soundtrack has no level to be judged against';
  if (!Number.isFinite(short)) return 'the loudness short is ' + String(short) + ', not a finite number, so the soundtrack has no shortfall to be judged against';
  if (!Number.isFinite(loudness.rise)) return 'the loudness rise is ' + String(loudness.rise) + ', not a finite number, so the decoded peak has no bar to stay under';
  const proto = loudness.ceiling === null || typeof loudness.ceiling !== 'object' ? 0 : Object.getPrototypeOf(loudness.ceiling);
  if (proto !== Object.prototype && proto !== null) return 'the loudness has no ceiling object, its ceiling is ' + String(loudness.ceiling) + ', so the decoded peak has no bar to stay under';
  const ceiling = loudness.ceiling[codec], within = PEAK_WITHIN[codec];
  const named = codec === undefined ? 'no codec' : 'the codec ' + String(codec);
  if (!Number.isFinite(ceiling)) return 'the loudness has no finite ceiling for ' + named + ', so the decoded peak has no bar to stay under';
  if (!Number.isFinite(within)) return 'the check has no finite peak margin for ' + named + ', so the decoded peak has no bar to stay under';
  const bar = ceiling + loudness.rise;
  if (!(Math.abs(heard.lufs - target) <= LUFS_WITHIN || (heard.dbtp >= ceiling - within && heard.lufs < target))) {
    return 'the decoded soundtrack measures ' + heard.lufs.toFixed(2) + ' LUFS and ' + heard.dbtp.toFixed(2) + ' dBTP, neither ' + target + ' LUFS nor ' + ceiling + ' dBTP';
  }
  if (!(heard.dbtp < bar)) return 'the decoded ' + (codec === 'mp4a' ? 'AAC' : String(codec)) + ' soundtrack peaks at ' + heard.dbtp.toFixed(2) + ' dBTP, not under ' + bar + ' dBTP';
  const under = target - sound.lufs;
  if (under !== short && (sound.short !== undefined) !== under > short) {
    return 'the export encoded the soundtrack at ' + sound.lufs + ' LUFS and reports '
      + (sound.short === undefined ? 'no shortfall, ' + under.toFixed(2) + ' LU under ' + target + ' LUFS' : 'a shortfall of ' + sound.short + ' LU, within ' + short + ' LU of ' + target + ' LUFS');
  }
  return null;
}
// loudnessMatch as the page runs it: no module scope there, so LOUDNESS goes in as a literal.
const PAGE_LOUDNESS_MATCH = '((heard, sound) => (' + loudnessMatch + ')(heard, sound, ' + JSON.stringify(LOUDNESS) + '))';

// Serialized into the page for a forced WebM run. The page refuses a recording
// that fell behind its schedule, which a loaded machine causes; this records
// again, at most `limit` recordings in all, and names each refusal with the
// frames it held and whether the recorder or drawing ran late. Any other
// refusal fails at once. Resolves to the accepted
// recording's report and the refusals before it.
async function retryBehindSchedule(record, frames, limit = 3) {
  const refusals = [];
  for (;;) {
    try { return { report: await record(), refusals }; } catch (error) {
      const behind = /fell (\d+) ms behind its schedule/.exec(error.message);
      if (!behind || refusals.length + 1 >= limit) {
        if (refusals.length) {
          error.message += ' Recording ' + (refusals.length + 1) + ' of ' + limit + '; the page refused '
            + refusals.map((r) => r.frames + ' of ' + frames + ' frames, ' + r.late + ' late').join('; ') + ' before it.';
        }
        throw error;
      }
      const held = /holds (\d+) of \d+ frames/.exec(error.message);
      // The page names which ran late: the recorder accepting a frame, or drawing.
      const late = /the recorder took up to \d+ ms to accept a frame/.test(error.message) ? 'recorder' : 'drawing';
      refusals.push({ frames: held ? Number(held[1]) : frames, behindMs: Number(behind[1]), late });
    }
  }
}

// Serialized into the page. Requires the page to offer the MP4 film and hide the
// WebM fallback, then exports the named example's film through the page's own
// MP4 path and decodes it: the first, middle and last frames must each match
// their own drawn frame, as frameMatch judges, and a declared
// soundtrack must decode to exactly the film's length, start as a fresh render
// does, and measure as loudnessMatch judges, and two more renders of it must
// be the same bits. The export's own verdict is read from the file. The
// replay manifest is found in the film's bytes by this check's own scan, not
// readMp4, so a fault shared by the writer and the reader cannot pass: it must
// be the page's recipe with the frames drawn in place of the playhead, and name
// a piece's box timeline. Each reference frame is drawn at the box it holds.
// The film's bytes come back as base64, `mp4` or `webm`, for replayFilms.
//
// A forced run (`force`, a FORCED key) checks what its condition must change:
// an Opus soundtrack without AAC, the colour route without WebGL2 or after a
// GPU crash (judged in Node by routeVerdict), and without H.264 the WebM offer, whose recording must decode, last frames / hz
// and come back with its bytes for the frame count. That recording goes through
// `retry`, retryBehindSchedule.
async function inspectFilm(name, force, retry) {
  const api = window.__artifex;
  const p = api.piece.validate(api.examples[name]);
  api.select(name);
  const webm = force === 'no-h264';
  const offer = await api.filmOffer();
  const offered = offer.format;
  const shown = (id) => document.getElementById(id).checkVisibility();
  if (offered !== (webm ? 'webm' : 'mp4') || (webm && offer.reason !== 'h264') || shown('film1') === webm || shown('video') !== webm) {
    throw new Error(name + ': the page offers ' + offered + (webm ? ' for ' + offer.reason : '') + ' with MP4 ' + (shown('film1') ? 'shown' : 'hidden')
      + ' and WebM ' + (shown('video') ? 'shown' : 'hidden'));
  }
  const heads = api.render.playheads(p);
  // Under gpu-crash the export's progress is left where crashPartway reads it.
  const progress = force === 'gpu-crash' ? { onProgress: (done, total, restart) => { globalThis.__artifexFilmDone = { done, total, restart }; } } : undefined;
  const { report, refusals } = webm ? await retry(() => api.video(), heads.length) : { report: await api.film(progress), refusals: [] };
  if (force === 'no-aac' && p.sound && (!report.sound || report.sound.codec !== 'Opus')) {
    throw new Error(name + ': with AAC refused the film carries ' + (report.sound ? 'an ' + report.sound.codec : 'no') + ' soundtrack, not Opus');
  }
  const solved = api.piece.solve(p, api.read().seed);
  const bytes = new Uint8Array(await report.blob.arrayBuffer());
  let manifest = null;
  if (!webm) {
    // 'uuid', then the manifest box's extended type.
    const mark = [0x75, 0x75, 0x69, 0x64, 0x8b, 0x2f, 0xd9, 0x66, 0xe9, 0x23, 0x43, 0x30, 0xa2, 0x8e, 0x6d, 0x82, 0x58, 0x7d, 0x1e, 0xc9];
    let at = -1;
    for (let i = 4; at < 0 && i + mark.length <= bytes.length; i++) if (mark.every((v, k) => bytes[i + k] === v)) at = i - 4;
    if (at < 0) throw new Error(name + ': the film carries no replay manifest');
    manifest = JSON.parse(String.fromCharCode(...bytes.subarray(at + 24, at + new DataView(bytes.buffer).getUint32(at))));
    const recipe = api.manifest();
    delete recipe.t;
    // Drawn with the long edge at 1920 pixels, the page's default, never below the design box.
    recipe.film = { frames: heads.length, hz: p.time.hz, loop: !!p.time.loop, scale: Math.max(1, 1920 / Math.max(p.size.w, p.size.h)) };
    if (JSON.stringify(manifest) !== JSON.stringify(recipe)) {
      throw new Error(name + ': the film names ' + JSON.stringify(manifest) + ' and the page ' + JSON.stringify(recipe));
    }
    // A film drawn along a box timeline must name it, or replay draws one box.
    const boxes = p.reframe && JSON.stringify(p.reframe.map((k) => ({ t: k.t, w: k.w, h: k.h })));
    if (boxes && JSON.stringify(manifest.reframe) !== boxes) {
      throw new Error(name + ': the film names the box timeline ' + JSON.stringify(manifest.reframe) + ' and the piece ' + boxes);
    }
  }
  const video = document.createElement('video');
  video.muted = true;
  video.src = URL.createObjectURL(report.blob);
  await new Promise((resolve, reject) => {
    video.onloadeddata = resolve;
    video.onerror = () => reject(new Error(name + ': the exported film does not decode'));
  });
  // A live recording says it lasts one unit until the exporter writes its length.
  if (webm && Math.abs(video.duration - heads.length / p.time.hz) > 0.001) {
    throw new Error(name + ': the WebM film lasts ' + video.duration + ' s against the film\'s ' + heads.length / p.time.hz + ' s');
  }
  const width = webm ? p.size.w : report.width, height = webm ? p.size.h : report.height;
  const w = 240, h = Math.max(2, Math.round((240 * height) / width));
  const small = document.createElement('canvas');
  small.width = w; small.height = h;
  const sg = small.getContext('2d', { willReadFrequently: true });
  // The reference is drawn on the kind of canvas the export drew the film on,
  // because translucent drawing rasterizes differently on a GPU-backed canvas
  // and on one kept in memory. The export draws on a GPU-backed canvas on every
  // colour route, where the browser has a GPU, as routeVerdict requires of the
  // CPU route with WebGL2 hidden. The reference is read only
  // through the small memory canvas: reading a GPU-backed canvas directly would
  // move it to memory for good.
  const full = document.createElement('canvas');
  full.width = width; full.height = height;
  const fg = full.getContext('2d');
  const pixels = (source) => { sg.clearRect(0, 0, w, h); sg.drawImage(source, 0, 0, w, h); return sg.getImageData(0, 0, w, h).data; };
  const drawn = (i) => { fg.clearRect(0, 0, full.width, full.height); api.render.drawFrame(fg, p, solved, heads[i], { scale: webm ? 1 : report.manifest.film.scale }); return pixels(full); };
  const psnr = (a, b) => {
    let se = 0;
    for (let k = 0; k < a.length; k += 4) for (let c = 0; c < 3; c++) se += (a[k + c] - b[k + c]) ** 2;
    return se ? 10 * Math.log10((255 * 255 * a.length * 0.75) / se) : 99;
  };
  const frames = [];
  for (const i of [0, Math.floor(heads.length / 2), heads.length - 1]) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(name + ': seeking the film to frame ' + i + ' timed out')), 10000);
      video.onseeked = () => { clearTimeout(timer); resolve(); };
      video.currentTime = (i + 0.5) / p.time.hz;
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    // The pixels the film carries: a VideoFrame made from the element, closed
    // once read. Drawing the element itself put a software-decoded (I420)
    // frame's blue up to 12 levels off in Edge, and which decoder Edge picks
    // varies between films whose frames are identical.
    const frame = new VideoFrame(video);
    let got;
    try { got = pixels(frame); } finally { frame.close(); }
    const scores = [i - 1, i, i + 1].filter((j) => j >= 0 && j < heads.length).map((j) => [j, psnr(got, drawn(j))]);
    const mismatch = frameMatch(i, scores);
    if (mismatch) throw new Error(name + ': decoded frame ' + i + ' ' + mismatch);
    const others = scores.filter(([j]) => j !== i).map(([, db]) => db);
    frames.push({ frame: i, psnrDb: +scores.find(([j]) => j === i)[1].toFixed(1), neighbourDb: others.length ? +Math.max(...others).toFixed(1) : null });
  }
  const lasts = video.duration;
  URL.revokeObjectURL(video.src);
  // The saved bytes go back to Node, which replays the film and counts a WebM's
  // frames with the page's reader.
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  if (webm) {
    return {
      name, offered, reason: offer.reason, frames: heads.length, hz: p.time.hz, seconds: lasts, bytes: bytes.length, decoded: frames, refusals,
      flashes: report.flashes, webm: btoa(binary),
    };
  }
  let sound = null;
  if (p.sound) {
    const decoded = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(await report.blob.arrayBuffer());
    let peak = 0;
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      for (const v of decoded.getChannelData(c)) peak = Math.max(peak, Math.abs(v));
    }
    if (!(peak > 0.01)) throw new Error(name + ': the soundtrack decodes to silence');
    // The soundtrack's edit list trims it to the film, to the sample.
    const want = Math.round(report.seconds * decoded.sampleRate);
    if (Math.abs(decoded.length - want) > 1) {
      throw new Error(name + ': the soundtrack decodes to ' + decoded.length + ' samples against the film\'s ' + want);
    }
    // Two renders must be the same bits, as soundMatch judges.
    const [a, b] = [await api.render.renderSound(p, solved, { OfflineAudioContext }),
      await api.render.renderSound(p, solved, { OfflineAudioContext })];
    const apart = soundMatch(a, b);
    if (apart) throw new Error(name + ': two renders of the soundtrack ' + apart);
    // A fresh render levelled in the page, gain and limiter, must level as the
    // export reported, which replay relies on.
    const level = api.level(b, report.sound.codec);
    const keys = ['measured', 'gain', 'limited', 'lufs', 'dbtp', 'short'];
    const [fresh, said] = [level, report.sound].map((s) => JSON.stringify(keys.map((k) => s[k])));
    if (fresh !== said) throw new Error(name + ': a fresh render levels to ' + fresh + ' and the export reported ' + said + ', as ' + keys.join(', '));
    // A codec's priming can swallow or shift the start of a soundtrack: from its
    // first sound, 1024 decoded samples must follow that levelled render. In
    // installed Edge the examples decode 29 to 52 dB from their render there,
    // AAC and Opus. The bar sits at 10 because settle once opened on a held
    // chord whose AAC, without its silent lead, decoded 6.4 dB from it; it
    // now opens on snaps and in Edge 154 decoded 42.1 dB as AAC and 38.3 as
    // Opus.
    const START_DB = 10;
    const sounds = (i) => { for (let c = 0; c < b.numberOfChannels; c++) if (Math.abs(b.getChannelData(c)[i]) > 1e-3) return true; return false; };
    let onset = 0;
    while (onset < b.length && !sounds(onset)) onset++;
    let rendered = 0, error = 0;
    for (let c = 0; c < b.numberOfChannels; c++) {
      const x = b.getChannelData(c), y = decoded.getChannelData(c);
      for (let i = onset; i < Math.min(onset + 1024, x.length); i++) { rendered += x[i] ** 2; error += (x[i] - y[i]) ** 2; }
    }
    const startDb = 10 * Math.log10(rendered / error);
    if (!(startDb >= START_DB)) {
      throw new Error(name + ': from its first sound, at sample ' + onset + ', the soundtrack decodes ' + startDb.toFixed(1)
        + ' dB from a fresh render, under ' + START_DB + ' dB');
    }
    const heard = api.loudness(decoded);
    const loud = loudnessMatch(heard, report.sound);
    if (loud) throw new Error(name + ': ' + loud);
    sound = {
      seconds: +decoded.duration.toFixed(3), samples: decoded.length, peak: +peak.toFixed(3),
      gain: report.sound.gain, limited: report.sound.limited, lufs: +heard.lufs.toFixed(2), dbtp: +heard.dbtp.toFixed(2), short: report.sound.short,
      onset, startDb: +startDb.toFixed(1),
    };
  }
  return {
    name, offered, codec: report.codec, frames: report.frames, seconds: report.seconds, width: report.width, height: report.height,
    bytes: report.bytes, colour: report.colour, realtime: report.realtime, decoded: frames, sound, manifest,
    soundCodec: report.sound ? report.sound.codec : null, conversion: report.conversion, rasterizer: report.rasterizer,
    rasterizerBeforeRedraw: report.rasterizerBeforeRedraw, contextLost: report.contextLost, encoderError: report.encoderError, convertMs: report.convertMs, flashes: report.flashes,
    mp4: btoa(binary),
  };
}

// Under heavy CPU load an owned Edge has taken over two minutes to exit after
// taskkill, and files in its profile stayed locked for another minute.
const STOP_MS = 180000, PROFILE_MS = 120000;

/** Stop the child's own tree; reject only when the stop cannot start. */
function killTree(child, deadline) {
  if (process.platform !== 'win32') { child.kill('SIGKILL'); return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true, stdio: 'ignore', timeout: Math.max(1, Math.ceil(deadline - performance.now())), killSignal: 'SIGKILL',
    });
    killer.once('error', reject);
    killer.once('close', () => resolve());
  });
}

async function stopBrowser(child, exited, { limitMs = STOP_MS, kill = killTree } = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  // This exact child belongs to the unique profile created below. Never kill by
  // executable name: an ordinary Edge session may already be running. Deadlines
  // run on the monotonic clock, so a wall-clock step cannot move them.
  const deadline = performance.now() + limitMs;
  await kill(child, deadline);
  // The stop is judged by the owned Edge alone. taskkill's exit code and
  // localized output decide nothing: it also fails for a member that exited by
  // itself. A descendant that outlived Edge would keep the profile locked, and
  // the bounded profile removal then fails the cleanup.
  // Cancel the bound once Edge exits, so its timer does not hold the process open.
  const bound = new AbortController();
  const stopped = await Promise.race([exited.then(() => true),
    delay(Math.max(0, deadline - performance.now()), false, { signal: bound.signal }).catch(() => false)]);
  bound.abort();
  if (!stopped) throw new Error('browser: could not stop owned Edge process ' + child.pid + ' within ' + limitMs + ' ms');
}

/** Whether a process with this id runs; EPERM means it runs under another account. */
function running(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

/**
 * Stop the browser process `pid` that a relaunched Edge runs on, with its tree,
 * as stopBrowser stops the started child. It is no child of ours, so its exit
 * is watched by polling.
 */
async function stopRelaunched(pid) {
  if (!running(pid)) return;
  const watch = new AbortController();
  const gone = (async () => {
    while (running(pid) && !watch.signal.aborted) await delay(100, undefined, { signal: watch.signal }).catch(() => {});
  })();
  try {
    // A browser that exits between the check above and the kill is already stopped.
    const kill = (signal) => { try { process.kill(pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
    await stopBrowser({ pid, exitCode: null, signalCode: null, kill }, gone);
  } finally { watch.abort(); }
}

/** Remove only the owned artifex-browser-* profile, retrying while stopped processes still hold its files. */
async function removeProfile(profile, { limitMs = PROFILE_MS, rm = fs.rm } = {}) {
  const tempRoot = await fs.realpath(os.tmpdir());
  const relative = path.relative(tempRoot, path.resolve(profile));
  if (!/^artifex-browser-[^/\\]+$/.test(relative)) throw new Error('refusing cleanup outside the owned temporary profile');
  const deadline = performance.now() + limitMs;
  for (;;) {
    try { await rm(profile, { recursive: true, force: true }); return; } catch (error) {
      if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error.code) || performance.now() >= deadline) throw error;
      await delay(200);
    }
  }
}

// Edge can relaunch itself, and then the process started here exits 0 within
// milliseconds while the browser it started runs on. That exit is a hand-off,
// not a failure: the debugging port says whether it took, within this time.
const HANDOFF_MS = 15000;

// An agent host's command sandbox, such as Codex's workspace-write on Windows,
// stops Edge in one of three ways: the launch is denied (EPERM or EACCES, its
// stderr pipe included), Edge exits non-zero at startup (0x80000003 and
// 0xC0000005 seen), or its GPU process dies later. An exit 0 is a hand-off.
const SANDBOX_HINT = ': Edge could not run here, and a command sandbox such as an agent host\'s is the likely cause; run this command outside the sandbox';

/** Whether the failure `message`, from `phase`, has the marks of a sandboxed Edge. */
function sandboxStopped(message, phase) {
  return /Edge launch failed: .*\b(EPERM|EACCES)\b|GPU process isn't usable/.test(message)
    || (phase === 'startup' && /Edge exited before completion \((?!0\))/.test(message));
}

/**
 * The process id of the browser at the CDP endpoint `url`. The endpoint's path
 * names one browser instance, so only that browser answers it.
 */
async function browserPidOf(url, signal, WebSocket) {
  const browser = await connectCDP(url, signal, WebSocket);
  try { return (await untilAbort(browser.send('SystemInfo.getProcessInfo'), signal)).processInfo.find((item) => item.type === 'browser')?.id; } finally { browser.close(); }
}

/**
 * The debugging port and endpoint path `profile`'s DevToolsActivePort names. A
 * half-written file throws, so no caller builds a URL from it.
 */
async function readDevtoolsPort(profile) {
  const [port = '', endpoint = ''] = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n').map((line) => line.trim());
  if (!/^\d+$/.test(port) || !/^\/devtools\/browser\/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(endpoint)) throw new Error('invalid debugging endpoint');
  return { port, endpoint };
}

/**
 * Ask the browser that owns `profile` to close. `found` is the port and endpoint
 * of a startup read whose `/json/version` fetch succeeded, tried first. Without
 * one, or once the endpoint tried refuses, the profile's DevToolsActivePort is
 * read again every 50 ms until it names a valid endpoint other than the one
 * that refused, and that one is tried. A missing or half-written file is read
 * again too, because a relaunched browser may write it late. Reading, connecting
 * and Browser.close all end at `boundMs`. Only this profile's browser is asked.
 */
async function closeOwned(profile, WebSocket, found, boundMs = 3000) {
  const signal = AbortSignal.timeout(boundMs);
  const url = (target) => 'ws://127.0.0.1:' + target.port + target.endpoint;
  let client, refused, failure;
  while (!client) {
    let target = found;
    found = undefined;
    if (!target) {
      try { target = await readDevtoolsPort(profile); } catch (error) { failure = error; }
    }
    if (target && url(target) !== refused) {
      try { client = await connectCDP(url(target), signal, WebSocket); } catch (error) { refused = url(target); failure = error; }
    }
    if (client) break;
    if (signal.aborted) throw failure;
    await delay(50, undefined, { signal }).catch(() => {});
  }
  try { await untilAbort(client.send('Browser.close'), signal); } catch { /* the socket closes with the browser */ }
  client.close();
}

/**
 * Serve one HTML snapshot on loopback, and `options.file`'s bytes at /file when
 * given, open it in installed Edge with a unique
 * temporary profile over CDP, and run `work(client, context)`. Then stop only
 * that Edge and remove only its profile. Page exceptions and console errors
 * collect in `context.errors`; `context.phase` names the step a failure
 * reports. A cleanup-only failure keeps work's result on the error as `report`.
 * `options.listen(client, context)`, when given, runs once connected and
 * before navigation, so the listeners it adds hear the page from its start.
 * `options.command` names the tool the user ran ("posters", "site check"); the
 * client carries it as `client.command`, so evaluate, waitFor and pageErrors
 * refuse that tool's page refusals as its own. `options.spawn`,
 * `options.handoffMs`, `options.closeMs` and `options.WebSocket` stand in for the launch, its hand-off window, the bound on cleanup's
 * hand-off close (reading the port file, connecting and Browser.close share one
 * signal) and the CDP socket in tests.
 */
async function withEdge(page, options, work) {
  if (typeof globalThis.WebSocket !== 'function' || typeof globalThis.fetch !== 'function') {
    throw new Error('browser: Node 22 or later is required for native WebSocket and fetch');
  }
  const edge = await findEdge(options.edge);
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const controller = new AbortController(), { signal } = controller;
  const expire = () => controller.abort(new Error('browser: timed out after ' + timeoutMs + ' ms'));
  let timer = setTimeout(expire, timeoutMs);
  const interrupt = () => controller.abort(new Error('browser: interrupted'));
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  let server, profile, child, exited, client, result, failure, browserPid, started;
  let browserLog = '', handedOff = 0;
  const context = { signal, errors: [], phase: 'startup', version: null };
  // With `options.phaseDeadline` the deadline starts again at each phase, so a
  // run of many quick phases is never cut short by their sum, and a phase that
  // hangs still fails by its name.
  if (options.phaseDeadline) {
    let phase = context.phase;
    Object.defineProperty(context, 'phase', {
      enumerable: true,
      get: () => phase,
      set: (next) => { phase = next; clearTimeout(timer); if (!signal.aborted) timer = setTimeout(expire, timeoutMs); },
    });
  }
  try {
    server = await servePage(page, options.file);
    const tempRoot = await fs.realpath(os.tmpdir());
    profile = await fs.mkdtemp(path.join(tempRoot, 'artifex-browser-' + process.pid + '-'));
    try {
      child = (options.spawn ?? spawn)(edge, [
        '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
        '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
        '--disable-background-networking', ...(options.headed ? [] : ['--headless=new']), 'about:blank',
      ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (error) { throw new Error('browser: Edge launch failed: ' + error.message); }
    child.stderr.on('data', (chunk) => { browserLog = (browserLog + chunk).slice(-3000); });
    exited = new Promise((resolve) => {
      child.once('error', (error) => { controller.abort(new Error('browser: Edge launch failed: ' + error.message)); resolve(); });
      child.once('exit', (code, killed) => {
        if (code === 0 && !killed) { handedOff = performance.now(); resolve(); return; }
        controller.abort(new Error('browser: Edge exited before completion (' + (killed || code) + ')'));
        resolve();
      });
    });
    let endpoint, version;
    while (!version) {
      signal.throwIfAborted();
      try {
        const parsed = await readDevtoolsPort(profile);
        endpoint = 'http://127.0.0.1:' + parsed.port;
        const response = await fetch(endpoint + '/json/version', { signal });
        if (response.ok) { version = await response.json(); started = parsed; }
      } catch { signal.throwIfAborted(); }
      if (!version && handedOff && performance.now() - handedOff > (options.handoffMs ?? HANDOFF_MS)) {
        throw new Error('browser: Edge exited before completion (0)');
      }
      if (!version) await delay(50, undefined, { signal });
    }
    context.version = version;
    // The browser's own process id: after a relaunch it is not the child's, and
    // only it, stopped with its tree, frees the profile when a busy renderer
    // keeps Browser.close from ending it. The port is the unique profile's, so
    // the process is ours; cleanup asks again before it kills by this id.
    if (version.webSocketDebuggerUrl) {
      try {
        browserPid = await browserPidOf(version.webSocketDebuggerUrl, AbortSignal.any([signal, AbortSignal.timeout(3000)]), options.WebSocket);
      } catch { signal.throwIfAborted(); }
    }
    let target;
    while (!target) {
      const response = await fetch(endpoint + '/json/list', { signal });
      if (!response.ok) throw new Error('browser: target discovery returned HTTP ' + response.status);
      target = (await response.json()).find((item) => item.type === 'page' && item.url === 'about:blank');
      if (!target) await delay(50, undefined, { signal });
    }
    context.phase = 'CDP connection';
    client = await connectCDP(target.webSocketDebuggerUrl, signal, options.WebSocket);
    client.command = options.command ?? null;
    // Before navigation, so no event the page sends as it loads is missed.
    options.listen?.(client, context);
    client.onEvent((event) => {
      if (event.method === 'Runtime.exceptionThrown') {
        const details = event.params.exceptionDetails;
        context.errors.push(details.exception?.description || details.text);
      } else if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') {
        context.errors.push('console.error: ' + event.params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(' '));
      }
    });
    await client.send('Runtime.enable');
    await client.send('Page.enable');
    // A forced condition (`options.force`, a FORCED key) is in place before the
    // page's first script runs, since the page asks its encoders as it loads.
    if (options.force) await client.send('Page.addScriptToEvaluateOnNewDocument', { source: '(' + FORCED[options.force].install + ')();' });
    context.phase = 'page navigation';
    const navigation = await client.send('Page.navigate', { url: server.url });
    if (navigation.errorText) throw new Error('browser: navigation failed: ' + navigation.errorText);
    result = await work(client, context);
  } catch (error) {
    failure = new Error(signal.aborted ? signal.reason.message + ' during ' + context.phase
      : error.pageRefusal ? error.message : error.message + ' during ' + context.phase);
    if (/CDP connection closed|Edge exited/.test(failure.message) && browserLog) {
      failure.message += '\nEdge diagnostics:\n' + browserLog.trim();
    }
    if (sandboxStopped(failure.message, context.phase)) failure.message += '\n' + (options.command ?? 'browser') + SANDBOX_HINT;
  } finally {
    clearTimeout(timer);
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
    if (client) {
      // Browser.close may close the socket before its reply reaches the client.
      try { await untilAbort(client.send('Browser.close'), AbortSignal.timeout(1500)); } catch { /* force-close below */ }
      client.close();
    } else if (handedOff && profile) {
      // No connection was made, and the started process is no longer ours to kill.
      try { await closeOwned(profile, options.WebSocket, started, options.closeMs); } catch { /* it never opened its port */ }
    }
    const cleanupErrors = [];
    try { await stopBrowser(child, exited); } catch (error) { cleanupErrors.push(error.message); }
    const browserUrl = context.version?.webSocketDebuggerUrl;
    if (browserUrl && browserPid !== child?.pid) {
      // Kill by an id only while the browser's own endpoint still reports it:
      // once that browser is gone, an id learned earlier may name another
      // process. When no id was learned (the deadline fired first, or the
      // lookup failed or passed its own 3 s bound), the endpoint's answer,
      // asked now with a fresh bound, is the only id.
      let current;
      try { current = await browserPidOf(browserUrl, AbortSignal.timeout(3000), options.WebSocket); } catch { /* it has closed its endpoint */ }
      if (current && current === (browserPid ?? current) && current !== child?.pid) {
        try { await stopRelaunched(current); } catch (error) { cleanupErrors.push(error.message); }
      }
    }
    if (server) { try { await server.close(); } catch (error) { cleanupErrors.push(error.message); } }
    if (profile) {
      try { await removeProfile(profile); } catch (error) { cleanupErrors.push('profile ' + profile + ': ' + error.message); }
    }
    if (cleanupErrors.length) {
      failure = new Error((failure ? failure.message + '\n' : '') + 'browser: cleanup failed: ' + cleanupErrors.join('; '));
      // Work that finished keeps its result; the command still fails.
      if (result) failure.report = result;
    }
  }
  if (failure) throw failure;
  return result;
}

/**
 * Throws when the page has reported errors in `context.errors`: as the first
 * that is a refusal of `client.command` (pageRefusal), such as a PieceError,
 * or else as "browser: page errors:" with them all.
 */
function pageErrors(client, context) {
  const refusal = context.errors.map((error) => pageRefusal(error, client.command)).find(Boolean);
  if (refusal) throw Object.assign(new Error(refusal), { pageRefusal: true });
  if (context.errors.length) throw new Error('browser: page errors:\n' + context.errors.join('\n'));
}

/** Wait until `expression` holds in the page, failing at once on a page error (pageErrors). */
async function waitFor(client, context, expression, ms = Infinity) {
  const until = Date.now() + ms;
  for (;;) {
    if (Date.now() > until) throw new Error(client.command + ': waited ' + ms + ' ms for ' + expression);
    pageErrors(client, context);
    try {
      if (await evaluate(client, expression)) return;
    } catch (error) {
      if (!/Cannot find context|Execution context was destroyed/.test(error.message)) throw error;
    }
    await delay(50, undefined, { signal: context.signal });
  }
}

/**
 * Why `film`'s colour route is not the one the run requires, or null when it
 * is. `film` is inspectFilm's report: its `name`, the format `offered`, and
 * the `conversion` route an MP4 took. A WebM is recorded, not converted. With
 * WebGL2 hidden neither the encoder's copy nor the GPU conversion exists, so
 * the CPU must convert, with or without --allow-fallback. Otherwise the encoder
 * must: its fallbacks keep a film correct and only slow it down, so a browser
 * or code change that stopped the route would pass unseen. --allow-fallback
 * accepts either fallback on a machine without a usable GPU.
 *
 * The CPU route must also have drawn its film on the GPU, as its `rasterizer`
 * says, because the reference frames are drawn on a default canvas and the CPU
 * route is about three times slower in memory. A film drawn again in memory
 * after its canvas lost the GPU (`contextLost`) or its encoder failed
 * (`encoderError` naming `video`) is drawn there on purpose, unless the pass it
 * replaced was already drawn in memory (`rasterizerBeforeRedraw`), and
 * --allow-fallback accepts memory too.
 *
 * Under --force gpu-crash the film must report its canvas lost after the GPU
 * process was crashed at frame `crashedAt` of its first pass, whatever else is
 * accepted.
 */
function routeVerdict(options, film) {
  if (film.offered !== 'mp4') return null;
  if (options.force === 'gpu-crash') {
    if (film.crashedAt == null) return film.name + ': the export ended before the GPU process could be crashed part-way through it';
    if (film.contextLost) return null;
    return film.name + ': the GPU process crashed at frame ' + film.crashedAt + ' of ' + film.frames + ' and the film does not report its canvas lost, so it was not drawn again in memory'
      + (film.encoderError ? '; the export reports ' + film.encoderError : '');
  }
  const route = String(film.conversion).toUpperCase();
  if (options.force === 'no-webgl2') {
    if (film.conversion !== 'cpu') return film.name + ': with WebGL2 hidden the colour was converted on the ' + route + ', not the CPU';
    if (film.rasterizerBeforeRedraw === 'memory' && !options.allowFallback) {
      return film.name + ': with WebGL2 hidden the film was drawn in memory before it was drawn again there, not on the GPU, so the browser no longer moves the CPU route\'s canvas to the GPU; on a machine without a usable GPU, pass --allow-fallback';
    }
    if (film.rasterizer === 'gpu' || options.allowFallback || filmDrawnAgain(film) === 'memory') return null;
    return film.name + ': with WebGL2 hidden the film was drawn ' + (film.rasterizer === 'memory' ? 'in memory' : 'where a test pattern could not tell the GPU from memory')
      + ', not on the GPU, so the browser no longer moves the CPU route\'s canvas to the GPU; on a machine without a usable GPU, pass --allow-fallback';
  }
  if (film.conversion === 'encoder' || options.allowFallback) return null;
  return film.name + ': the colour was converted on the ' + route + ', not by the encoder, so the encoder route fell back; on a machine without a usable GPU, pass --allow-fallback';
}

/**
 * The whole `npm run browser` check: the page, its films' replays and, without
 * --force, the flash fixture's film and its replay. `edge`, `exportFilm`,
 * `replay` and `dir` stand in for withEdge, film-cli's exportFilm,
 * tools/replay.js's replay and OUT in tests.
 */
async function runBrowserCheck(options = {}, { edge = withEdge, exportFilm, replay, dir = OUT } = {}) {
  const pagePath = options.pagePath || path.join(OUT, 'index.html');
  const page = await fs.readFile(pagePath).catch((error) => {
    throw new Error('browser: cannot read ' + pagePath + '; run npm run page first: ' + error.message);
  });
  // An Edge whose work finished but which failed only to clean up still has its
  // films replayed; the first such failure fails the run once every film has a verdict.
  let cleanup;
  // Each example and each film export gets the whole deadline: together they
  // pass a minute on a loaded machine, and the list grows with the examples.
  const report = await edge(page, { ...options, command: 'browser', phaseDeadline: true }, (client, context) => checkPage(client, context, options))
    .catch((error) => { if (!error.report) throw error; cleanup = error; return error.report; });
  try {
    await replayFilms(report, options, { dir, replay });
    // A forced run checks its fallback alone; without H.264 no MP4 film can be made.
    if (!options.force) {
      report.flashFixture = await checkFlashFixture(options, exportFilm);
      cleanup ??= report.flashFixture.cleanup;
      await replayFilm(report.flashFixture, 'the flash fixture', path.join(dir, 'browser-flash-film.mp4'), report.flashFixture.saved, report, options,
        { replay, piece: FLASH_FIXTURE });
    }
    requireReplays(report);
  } catch (error) {
    if (cleanup) error.message += '\n' + cleanup.message;
    if (error.report || cleanup) error.report = report;
    throw error;
  }
  if (cleanup) throw Object.assign(cleanup, { report });
  return report;
}

// Fails, naming the first, when any film the run exported holds no replay verdict.
function requireReplays(report) {
  const films = report.flashFixture ? [...report.films, { name: 'the flash fixture', replay: report.flashFixture.replay }] : report.films;
  const skipped = films.find((film) => !film.replay);
  if (skipped) throw new Error('browser: ' + skipped.name + ': its film was exported but never replayed');
}

/**
 * Replays each film checkPage exported into `report`, as `npm run replay` does, in a fresh
 * Edge without the run's forced condition; a film checkPage kept no bytes of
 * fails the run. Each film is written under
 * `dir` as browser-<name>.mp4 or .webm, with the forced condition before the
 * name under --force, and kept there to replay by hand. The first film that
 * DIFFERS fails the run, naming the film, replay's reason and its file, and
 * carries `report`. Each film replayed holds in its `replay` the verdict, its
 * worst frame's dB and, for a soundtrack, its worst block judged by the
 * codec's floor, each with its margin over replay's floor (null when replay
 * compared none), and how long the replay took. A replay whose
 * Edge failed only to clean up fails the run as such, carrying `report`, as a
 * cleanup-only failure of the run's own Edge does. `replay` stands in for
 * tools/replay.js's in tests.
 */
async function replayFilms(report, options, { dir = OUT, replay } = {}) {
  for (const film of report.films) {
    // inspectFilm always sends the bytes back, so a film without them is a fault, never a film to skip.
    if (!film.saved) throw new Error('browser: ' + film.name + ': the page sent back none of its film\'s bytes, so it cannot be replayed');
    const file = path.join(dir, 'browser-' + (options.force ? options.force + '-' : '') + film.name + '.' + film.offered);
    await replayFilm(film, film.name, file, film.saved, report, options, { replay });
  }
}

// The run's --edge and a --timeout-ms other than the default, as npm run replay takes them, so a printed replay finds the same Edge.
const replayFlags = ({ edge, timeoutMs }) => [...(edge ? ['--edge', quote(path.resolve(callerDirectory(process.cwd(), process.env), edge))] : []), ...(timeoutMs !== undefined && timeoutMs !== TIMEOUT_MS ? ['--timeout-ms', String(timeoutMs)] : [])];

/**
 * Writes `bytes` to `file`, replays it with `piece` when given, and sets
 * `holder.replay`, as replayFilms describes, before throwing on DIFFERS.
 */
async function replayFilm(holder, name, file, bytes, report, options, { replay, piece }) {
  // Required here: tools/replay.js requires this module.
  const replayer = require('./replay.js');
  replay ??= replayer.replay;
  const browser = { edge: options.edge, timeoutMs: options.timeoutMs, headed: options.headed };
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, bytes);
  const started = performance.now();
  let result;
  try { result = await replay(file, { browser, ...(piece && { piece }) }); } catch (error) {
    // withEdge's error carries `.report` only when its work finished and cleanup alone failed.
    const failure = new Error('browser: ' + name + ': its film, ' + slash(file) + (error.report
      ? ', was replayed, but the replay\'s Edge failed to clean up, so its verdict is unread: '
      : ', cannot be replayed: ') + error.message);
    if (error.report) failure.report = report;
    throw failure;
  }
  // Replay stops at the first frame it cannot seek to, which leaves no compared frame when that frame is the first.
  const psnrs = (result.frames || []).map((row) => row.psnr).filter(Number.isFinite);
  const pictureDb = psnrs.length ? Math.min(...psnrs) : null;
  // The worst block within the codec's floor, as soundVerdict words it.
  const heard = result.sound && /every block within (\d+) dB of the render \(worst (-?[\d.]+) dB\)/.exec(result.sound.detail);
  holder.replay = {
    match: result.match, file: slash(file), pictureDb, pictureMarginDb: pictureDb === null ? null : +(pictureDb - replayer.FILM_FLOOR_DB).toFixed(2),
    soundDb: heard ? Number(heard[2]) : null, soundMarginDb: heard ? +(heard[2] - heard[1]).toFixed(2) : null,
    ms: Math.round(performance.now() - started), detail: result.detail,
  };
  // The report goes with the failure, so main still writes every verdict so far.
  if (!result.match) {
    throw Object.assign(new Error('browser: ' + name + ': its film DIFFERS on replay: ' + result.detail + '; replay it with ' + hint('replay', quote(file), ...(piece ? ['--piece', quote(piece)] : []), ...replayFlags(browser))), { report });
  }
}

/**
 * Exports the flash fixture's MP4 film at its design size through the page's
 * own export, as `npm run film` does, in a fresh Edge with `options`, and
 * resolves to its `flashes` once the count found more than three general and
 * more than three red flashes and the page warns of them, with the film's
 * bytes as `saved`, kept out of the report. When the export finished but its
 * Edge failed only to clean up, that failure comes back as `cleanup`, also kept
 * out of the report, for the run to throw once the film is replayed; a count
 * that then fails names that cleanup failure too and carries `report`.
 * `exportFilm` is film-cli's.
 */
async function checkFlashFixture(options, exportFilm = require('./film-cli.js').exportFilm) {
  const external = loadExternal(FLASH_FIXTURE, ROOT);
  let cleanup;
  const exported = exportFilm({ name: external.names[0], external }, { scale: 1 }, options);
  const { report, bytes } = await exported.catch((error) => { if (!error.report) throw error; cleanup = error; return error.report; });
  const { flashes } = report;
  if (!flashes || !(flashes.general > WCAG.flashes) || !(flashes.red > WCAG.flashes) || !flashNote(flashes)) {
    const error = new Error('browser: the flash fixture\'s film counted ' + JSON.stringify(flashes) + ', not a warning of more than '
      + WCAG.flashes + ' general and ' + WCAG.flashes + ' red flashes');
    // The cleanup failure goes with it, and `report` makes runBrowserCheck attach the run's report.
    if (cleanup) Object.assign(error, { message: error.message + '\n' + cleanup.message, report });
    throw error;
  }
  return Object.defineProperties(flashes, { saved: { value: bytes }, cleanup: { value: cleanup } });
}

/**
 * Where a PNG of the image fixture's first frame, `bytes` at scale 1, does not
 * show the fixture's image at IMAGE_POINTS, or null when it does.
 */
function imageMiss(bytes, piece) {
  const { w, rgba } = require('./measure-reference.js').decodePng(new Uint8Array(bytes), 'the PNG');
  const img = solve(piece).state.images.ground;
  for (const [x, y] of IMAGE_POINTS) {
    const want = sample(img, (x + 0.5) / piece.size.w, (y + 0.5) / piece.size.h).map(Math.round);
    const got = Array.from(rgba.subarray((y * w + x) * 4, (y * w + x) * 4 + 4));
    if (got.some((v, c) => Math.abs(v - want[c]) > IMAGE_LEVELS)) return 'shows ' + JSON.stringify(got) + ' at pixel ' + x + ', ' + y + ', where its image is ' + JSON.stringify(want);
  }
  return null;
}

/**
 * The image fixture through the page's own exports, each in a fresh Edge with
 * `options`, as `npm run still` and `npm run film` save them: its first frame
 * as a PNG, which must show the image away from the marks (imageMiss) and
 * replay as matching, and its MP4 film, replayed as replayFilms replays one.
 * The page that drew the PNG must credit the image: `read().images` and its
 * Images group name each image with its source and rights, as the piece
 * declares them. Each is written under `dir` as browser-image-piece.png or
 * .mp4. Sets `report.imageFixture` to { png, replay } with the two verdicts,
 * `png.shows` false when the PNG missed its image. Every failure carries the
 * run's `report`, so main prints the summary and saves out/browser.json with
 * every verdict so far, even when a still, replay or film export carried its
 * own result as `report`; a message that does not name the fixture gets the
 * prefix "browser: the image fixture: ".
 * Last, tools/image.js's decode reads GAMMA_PNG in Edge, which must hand back
 * GAMMA_SRGB within IMAGE_LEVELS; `report.imageFixture.decode.converted` says
 * whether it did.
 * `edge`, `still`, `exportFilm`, `replay` and `decode` stand in for withEdge,
 * styles' pngInEdge, film-cli's exportFilm, tools/replay.js's replay and
 * tools/image.js's decode.
 */
async function checkImageFixture(report, options, deps = {}) {
  try { return await imageFixtureSteps(report, options, deps); } catch (error) {
    if (!/the image fixture/.test(error.message)) error.message = 'browser: the image fixture: ' + error.message;
    throw Object.assign(error, { report });
  }
}

async function imageFixtureSteps(report, options, { dir = OUT, edge: inEdge = withEdge, still, exportFilm, replay, decode }) {
  const external = loadExternal(IMAGE_FIXTURE, ROOT);
  const [name] = external.names, { piece } = external;
  const browser = { edge: options.edge, timeoutMs: options.timeoutMs, headed: options.headed };
  const fixture = report.imageFixture = {};
  const fail = (message) => Object.assign(new Error('browser: the image fixture\'s PNG ' + message), { report });
  // The page's credit, read once the PNG is drawn in the same page.
  let credit;
  const edge = (page, opts, work) => inEdge(page, opts, async (client, context) => {
    const value = await work(client, context);
    credit = await evaluate(client, '({ images: window.__artifex.read().images, group: document.getElementById("imagesGroup").hidden ? null : document.getElementById("images").innerText })');
    return value;
  });
  const { bytes } = await (still ?? require('./styles.js').pngInEdge)(external, name, piece.seed, 0, piece.size.w, browser, null, edge, 'browser');
  const miss = imageMiss(bytes, piece);
  fixture.png = { shows: !miss };
  if (miss) throw fail(miss);
  const want = Object.entries(piece.images).map(([k, d]) => ({ name: k, w: d.w, h: d.h, channels: d.channels, source: d.source, rights: d.rights }));
  if (!credit || JSON.stringify(credit.images) !== JSON.stringify(want) || !want.every((d) => credit.group && credit.group.includes(d.source) && credit.group.includes(d.rights))) {
    throw Object.assign(new Error('browser: the image fixture\'s page credits ' + JSON.stringify(credit) + ', not each image with its source and rights, ' + JSON.stringify(want)), { report });
  }
  const file = path.join(dir, 'browser-image-piece.png');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, bytes);
  const shown = await (replay ?? require('./replay.js').replay)(file, { browser, piece: IMAGE_FIXTURE });
  Object.assign(fixture.png, { match: shown.match, file: slash(file), detail: shown.detail });
  if (!shown.match) throw fail('DIFFERS on replay: ' + shown.detail);
  const exported = await (exportFilm ?? require('./film-cli.js').exportFilm)({ external, name }, { scale: 1 }, options);
  await replayFilm(fixture, 'the image fixture', path.join(dir, 'browser-image-piece.mp4'), exported.bytes, report, options, { replay, piece: IMAGE_FIXTURE });
  // npm run image's Edge route, which every photo and every profile- or gamma-tagged PNG takes.
  const decoded = await (decode ?? require('./image.js').decode)(new Uint8Array(Buffer.from(GAMMA_PNG, 'base64')), 'gamma.png', browser);
  const got = Array.from(decoded.rgba).filter((_, i) => i % 4 !== 3);
  fixture.decode = { converted: got.length === GAMMA_SRGB.length && got.every((v, i) => Math.abs(v - GAMMA_SRGB[i]) <= IMAGE_LEVELS) };
  if (!fixture.decode.converted) throw new Error('browser: the image fixture: npm run image read a PNG tagged gAMA 1.0 as ' + JSON.stringify(got) + ', not converted to sRGB ' + JSON.stringify(GAMMA_SRGB));
  return fixture;
}

// Serialized into the play fixture's page. From a restart, records after every
// tick the page plays a digest of the session drawn at that tick, on a canvas
// of its own read back once, until stopTicks; the drawing is the same one a
// re-run of the saved session makes in rerunTicks.
function recordTicks() {
  const api = window.__artifex;
  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const digestOf = (s) => {
    canvas.width = s.piece.size.w; canvas.height = s.piece.size.h;
    api.render.drawFrame(g, s.piece, s.solved, s.tick / s.piece.play.hz);
    const data = g.getImageData(0, 0, canvas.width, canvas.height).data;
    let h = 0x811c9dc5;
    for (let i = 0; i < data.length; i++) h = Math.imul(h ^ data[i], 0x01000193);
    return h >>> 0;
  };
  window.__playDigest = digestOf;
  window.__playFrames = [];
  document.getElementById('restart').onclick();
  api.onTick((s) => window.__playFrames.push(digestOf(s)));
  return true;
}

// Serialized into the page: stops recording and returns the saved session with the frames recorded live.
function stopTicks() {
  const api = window.__artifex;
  api.onTick(null);
  return { session: api.saveSession(), frames: window.__playFrames };
}

// Serialized into the page: runs `session` again in this page, from the
// piece's own declaration, and names the first tick whose frame differs from
// the one recorded live in `frames` (tick 1 first), or null.
function rerunTicks(name, session, frames) {
  const api = window.__artifex, again = [];
  api.play.rerun(api.examples[name], session, (s) => { if (s.tick > 0) again.push(window.__playDigest(s)); });
  const at = again.findIndex((d, i) => d !== frames[i]);
  return { rerun: again.length, differs: at < 0 && again.length === frames.length ? null : at < 0 ? Math.min(again.length, frames.length) + 1 : at + 1 };
}

/**
 * The play fixture played in installed Edge through the page's own play mode:
 * presses, a drag and keys sent as real input through DevTools, a digest of
 * every tick's frame recorded as it plays, then the saved session run again in
 * the same page and compared tick by tick. Its film and its still at the
 * middle tick are then made by npm run film's and npm run still's own routes
 * with the session written beside them as browser-play-piece.session.json, and
 * each is replayed. Sets `report.playFixture` to { ticks, inputs, kinds,
 * differs, sound, film, still }, `differs` the first tick whose re-run frame differs,
 * or null, and `sound` the cues the fixture pushed, how many the page played
 * live and its audio context's state; every cue must have played. Every failure names the fixture and carries the run's `report`.
 */
async function checkPlayFixture(report, options, { dir = OUT, edge = withEdge, exportFilm, still, replay } = {}) {
  try { return await playFixtureSteps(report, options, { dir, edge, exportFilm, still, replay }); } catch (error) {
    if (!/the play fixture/.test(error.message)) error.message = 'browser: the play fixture: ' + error.message;
    throw Object.assign(error, { report });
  }
}

async function playFixtureSteps(report, options, { dir, edge, exportFilm, still, replay }) {
  const external = loadExternal(PLAY_FIXTURE, ROOT);
  const [name] = external.names;
  const browser = { edge: options.edge, timeoutMs: options.timeoutMs, headed: options.headed };
  const fixture = report.playFixture = {};
  const { bundle, html } = require('./build-page.js');
  const played = await edge(html(bundle(external), { count: 1 }), { ...browser, command: 'browser' }, async (client, context) => {
    await waitFor(client, context, 'document.readyState === "complete" && !!window.__artifex && !!window.__artifex.read().play');
    context.phase = 'play fixture';
    await evaluate(client, '(' + recordTicks + ')()');
    const box = await evaluate(client, '(() => { const r = document.getElementById("c").getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()');
    // A design point of the 160 x 120 fixture as a point on the page.
    const at = (x, y) => ({ x: box.x + (x / 160) * box.w, y: box.y + (y / 120) * box.h });
    const mouse = (type, x, y) => client.send('Input.dispatchMouseEvent', { type, ...at(x, y), button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    const key = (type, k, code, vk) => client.send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    const pause = () => delay(60, undefined, { signal: context.signal });
    await mouse('mousePressed', 30, 30); await pause();
    await mouse('mouseReleased', 30, 30); await pause();
    await mouse('mouseMoved', 70, 50); await pause();
    await mouse('mouseMoved', 90, 60); await pause();
    await key('rawKeyDown', 'ArrowRight', 'ArrowRight', 39); await key('keyUp', 'ArrowRight', 'ArrowRight', 39); await pause();
    await key('rawKeyDown', 'Enter', 'Enter', 13); await key('keyUp', 'Enter', 'Enter', 13); await pause();
    await mouse('mousePressed', 130, 90); await pause();
    await mouse('mouseReleased', 130, 90);
    const last = await evaluate(client, 'window.__artifex.read().play.tick');
    await waitFor(client, context, 'window.__artifex.read().play.tick >= ' + (last + PLAY_TAIL));
    // The sound cues its marks pushed, and how many the page played live.
    const heard = await evaluate(client, '(({ cues, heard, sound }) => ({ cues, heard, sound }))(window.__artifex.read().play)');
    const recorded = await evaluateInPieces(client, '(' + stopTicks + ')()');
    const verdict = await evaluate(client, '(' + rerunTicks + ')(' + [name, recorded.session, recorded.frames].map((v) => JSON.stringify(v)).join(', ') + ')');
    pageErrors(client, context);
    return { ...recorded, ...verdict, heard };
  });
  const { session } = played;
  const kinds = [...new Set(session.log.map((row) => row[1]))].sort();
  Object.assign(fixture, { ticks: session.ticks, inputs: session.log.length, kinds, differs: played.differs, sound: played.heard });
  if (!played.heard.cues || played.heard.heard !== played.heard.cues || played.heard.sound !== 'running') {
    throw new Error(`browser: the play fixture pushed ${played.heard.cues} sound cues and the page played ${played.heard.heard} of them live, its audio ${played.heard.sound ?? 'never made'}`);
  }
  if (played.frames.length !== session.ticks || played.rerun !== session.ticks) {
    throw new Error(`browser: the play fixture recorded ${played.frames.length} frames over ${session.ticks} ticks and its re-run drew ${played.rerun}`);
  }
  if (played.differs !== null) throw new Error(`browser: the play fixture's saved session ran again to another frame at tick ${played.differs} of ${session.ticks}`);
  // Every kind of input sent reached the log, through the page's own input handling.
  const want = ['down', 'key', 'move', 'up'];
  if (want.some((k) => !kinds.includes(k))) throw new Error(`browser: the play fixture's log holds inputs of kinds ${JSON.stringify(kinds)}, not each of ${JSON.stringify(want)} the check sent`);
  const sessionName = 'browser-play-piece.session.json';
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, sessionName), JSON.stringify(session));
  const target = { name, external, session: { file: session, name: sessionName } };
  const exported = await (exportFilm ?? require('./film-cli.js').exportFilm)(target, { scale: 1 }, options);
  fixture.film = {};
  await replayFilm(fixture.film, 'the play fixture', path.join(dir, 'browser-play-piece.mp4'), exported.bytes, report, options, { replay, piece: PLAY_FIXTURE });
  const middle = Math.round(session.ticks / 2);
  const { bytes } = await (still ?? require('./styles.js').pngInEdge)(external, name, session.seed, middle / session.ticks, 160, browser, null, edge, 'browser', target.session);
  const file = path.join(dir, 'browser-play-piece.png');
  await fs.writeFile(file, bytes);
  const shown = await (replay ?? require('./replay.js').replay)(file, { browser, piece: PLAY_FIXTURE });
  fixture.still = { tick: middle, match: shown.match, file: slash(file), detail: shown.detail };
  if (!shown.match) throw new Error('browser: the play fixture\'s still DIFFERS on replay: ' + shown.detail);
  return fixture;
}

/** `npm run browser`: runBrowserCheck, then, without --force, the image fixture (checkImageFixture) and the play fixture (checkPlayFixture). */
async function runAll(options) {
  const report = await runBrowserCheck(options);
  if (!options.force) {
    await checkImageFixture(report, options);
    await checkPlayFixture(report, options);
  }
  return report;
}

/**
 * Crash the owned Edge's GPU process through CDP once `exported`, the film
 * export inspectFilm runs under --force gpu-crash, has drawn a third of its
 * frames on the pass it drew first. Resolves to the frames drawn by then, or
 * null when the export ended before that.
 */
async function crashPartway(client, context, exported) {
  let ended = false;
  exported.then(() => { ended = true; }, () => { ended = true; });
  while (!ended) {
    const at = await evaluate(client, 'globalThis.__artifexFilmDone || null');
    if (at && !at.restart && at.done * 3 >= at.total) {
      await client.send('Browser.crashGpuProcess');
      return at.done;
    }
    await delay(20, undefined, { signal: context.signal });
  }
  return null;
}

/**
 * The checks `npm run browser` makes in the loaded page: every example, a
 * still PNG's transparency (inspectStill), from npm run still's drawing and
 * from the page's PNG button, then each film filmsToExport
 * chooses, on the colour route the run requires.
 */
async function checkPage(client, context, options) {
  // The page validates every example as it loads, and an error there names no
  // example, so a PieceError before window.__artifex keeps its stack unrefused.
  await waitFor(client, context, 'document.readyState === "complete" && !!window.__artifex').catch((error) => {
    throw error.pageRefusal ? new Error('browser: page errors:\n' + context.errors.join('\n')) : error;
  });
  const names = await evaluate(client, 'window.__artifex.names');
  if (!Array.isArray(names) || !names.length) throw new Error('browser: no registered examples');
  // A page refusal of an example or film ("browser: <message>") names it.
  const named = (name, value) => value.catch((error) => {
    throw error.pageRefusal ? Object.assign(new Error('browser: ' + name + ': ' + error.message.slice('browser: '.length)), { pageRefusal: true }) : error;
  });
  const pieces = [];
  for (const name of names) {
    context.phase = 'example ' + name;
    pieces.push(await named(name, evaluate(client, '(' + inspectPiece.toString() + ')(' + JSON.stringify(name) + ')')));
  }
  context.phase = 'still PNG';
  // Required here: tools/styles.js requires this module.
  const still = await evaluate(client, '(' + inspectStill.toString() + ')(' + require('./styles.js').drawPng.toString() + ')');
  const unlike = stillVerdict(still);
  if (unlike) throw new Error('browser: ' + unlike);
  // The page's PNG button saves through core/export.js png(), its own copy of that drawing.
  context.phase = 'page PNG';
  const pagePngStill = await evaluate(client, '(' + inspectStill.toString() + ')(' + pagePng.toString() + ')');
  const pageUnlike = stillVerdict(pagePngStill);
  if (pageUnlike) throw new Error('browser: the page\'s PNG 1x button: ' + pageUnlike);
  const films = [];
  const chosen = await evaluate(client, '(' + filmsToExport.toString() + ')((' + exampleTraits.toString() + ')())');
  // A forced run checks its one fallback on one film, except that without AAC
  // every film is Opus, so a soundtrack its peaks stop at the Opus ceiling, as
  // settle's do (limited by 2.41 dB in Edge 154, its plucks' attacks at the
  // -2 dBTP ceiling), is decoded too.
  for (const name of options.force && options.force !== 'no-aac' ? chosen.slice(0, 1) : chosen) {
    context.phase = 'film export ' + name;
    // A WebM film comes back whole, as base64, and can pass the 4 MiB a reply may carry.
    const exported = evaluateInPieces(client, '((frameMatch, soundMatch, loudnessMatch) => (' + inspectFilm.toString() + ')(' + JSON.stringify(name)
      + (options.force ? ', ' + JSON.stringify(options.force) + ', ' + retryBehindSchedule.toString() : '') + '))('
      + frameMatch.toString() + ', ' + soundMatch.toString() + ', ' + PAGE_LOUDNESS_MATCH + ')');
    const crashedAt = options.force === 'gpu-crash' ? await crashPartway(client, context, exported) : undefined;
    const film = await named(name, exported);
    if (crashedAt !== undefined) film.crashedAt = crashedAt;
    const route = routeVerdict(options, film);
    if (route) throw new Error('browser: ' + route);
    // No example may flash past WCAG 2.3.1, and each film must have been counted.
    if (!film.flashes) throw new Error('browser: ' + name + ': the film carries no flash count');
    if (flashNote(film.flashes)) throw new Error('browser: ' + name + ':' + flashNote(film.flashes));
    const saved = film.webm || film.mp4;
    if (saved) {
      const bytes = Buffer.from(saved, 'base64');
      // Every frame, evenly spaced, in the bytes the page saved.
      if (film.webm) film.blocks = filmVerdict(film.frames, film.hz, webmBlockTimes(new Uint8Array(bytes))).frames;
      delete film.webm; delete film.mp4;
      // Kept for replayFilms, and out of the report, which JSON writes without it.
      Object.defineProperty(film, 'saved', { value: bytes });
    }
    films.push(film);
  }
  if (context.errors.length) throw new Error('browser: page errors:\n' + context.errors.join('\n'));
  return {
    browser: context.version.Browser, mode: options.headed ? 'headed' : 'headless', ...(options.force && { forced: options.force }),
    ...(options.allowFallback && { allowFallback: true }), pieces, still, pagePng: pagePngStill, films, errors: context.errors,
  };
}

// Serialized into the contact sheet. Ready once every planned cell has
// rendered or failed; the sheet publishes window.__sheet after its last cell.
function sheetReady(expected) {
  const sheet = window.__sheet;
  return !!sheet && sheet.cells.length === expected
    && sheet.cells.every((cell) => cell.error !== null || typeof cell.markCount === 'number')
    // A reference photo shown beside the cells has loaded; a stand-in window has none.
    && Array.from(window.document ? window.document.images : []).every((image) => image.complete);
}

// Serialized into the contact sheet: window.__sheet as plain data, its
// failures() counted.
function sheetData() {
  const sheet = window.__sheet;
  return { ...sheet, failures: sheet.failures() };
}

// Serialized into the contact sheet. Each piece's part of the page in CSS
// pixels from the top: its heading down to the next piece's heading.
function sheetSections() {
  const heads = Array.from(document.querySelectorAll('#out > h2'));
  const top = (element) => Math.round(element.getBoundingClientRect().top + window.scrollY);
  return heads.map((h2) => ({ name: h2.textContent, top: top(h2) }));
}

// Serialized into the contact sheet. Where an image of it may be cut, in CSS
// pixels from the top, as two ascending lists. First the top of a cell (its
// figure: frame, caption, 100% crop and its caption), heading, paragraph or
// list item that no other one of them crosses, so a cut falls between rows of
// whole cells. Then the same inside a cell, at the top of a canvas, reference
// photo or caption, for a row of cells too heavy for one image.
function sheetCuts() {
  const level = (selector) => {
    const spans = Array.from(document.querySelectorAll(selector)).map((element) => {
      const box = element.getBoundingClientRect();
      return [box.top + window.scrollY, box.bottom + window.scrollY];
    });
    return [...new Set(spans.map(([top]) => Math.floor(top)))]
      .filter((y) => spans.every(([top, bottom]) => !(top < y && y < bottom)))
      .sort((a, b) => a - b);
  };
  return [level('figure, h2, p, li'), level('canvas, .photo, figcaption, h2, p, li')];
}

// The tallest image one capture writes; a taller part is written in pieces
// at full scale, each this tall at most.
const SHEET_MAX_HEIGHT = 8192;

// The largest screenshot PNG one reply may carry: Node's WebSocket refuses a
// reply from Edge past 4 MiB, base64 takes a third more, and 64 KiB covers the
// reply's framing and a whole screenshot weighing a little more than its bands.
const SHOT_BYTES = Math.floor(((4 * 1024 * 1024 - 65536) * 3) / 4);

// How many device rows `width` pixels wide always fit in one reply: a PNG that
// does not compress takes up to four bytes a pixel and one a row.
function bandRows(width) {
  return Math.floor(SHOT_BYTES / (1 + 4 * width));
}

/**
 * The screenshot clip for `count` device rows from row `from` of a sheet part
 * `height` CSS pixels tall from CSS pixel `top`, shot at scale 1. The whole
 * part keeps the clip it always had, so its file stays the same.
 */
function sheetClip(top, width, height, from, count) {
  if (count === Math.round(height)) return { x: 0, y: top, width, height, scale: 1 };
  return { x: 0, y: top + from, width, height: count, scale: 1 };
}

/**
 * Shoot `rows` device rows with `shoot(fromRow, rowCount)`, which returns one
 * screenshot's PNG, in as few screenshots as fit in a reply: `[{ file, from,
 * rows, png }]`. Rows that fit even as incompressible pixels take one
 * screenshot. Otherwise pieces are cut only at the rows in `cuts`, a list of
 * ascending lists, coarsest first: each stretch between two cuts of the first
 * list is weighed in bands of `band` rows, which always fit, and each run of
 * stretches whose PNGs fit together is shot again whole. A stretch too heavy
 * for one reply is its own run of pieces, cut the same way at the next list's
 * cuts inside it, and after the last list between its bands. No piece is
 * taller than `maxRows`: a stretch past it is cut the same way as a heavy one.
 * One piece keeps `file`; several are `<name>-1-of-<n>.png` and on.
 */
async function sheetPieces(file, shoot, rows, band, cuts = [], maxRows = Infinity) {
  band = Math.min(band, maxRows);
  if (rows <= band) return [{ file, from: 0, rows, png: await shoot(0, rows) }];
  // Units of [from, to) that each fit, weighed; `alone` names the stretch too heavy to fit that a unit was cut from.
  let heavy = 0;
  const stretch = async (from, to, level) => {
    const units = [];
    if (level < cuts.length) {
      const edges = [from, ...cuts[level].filter((cut) => cut > from && cut < to), to];
      for (let i = 1; i < edges.length; i++) units.push(...await stretch(edges[i - 1], edges[i], level + 1));
    } else {
      for (let at = from; at < to; at += band) {
        const count = Math.min(band, to - at);
        units.push({ from: at, count, bytes: (await shoot(at, count)).length, alone: 0 });
      }
    }
    const bytes = units.reduce((sum, unit) => sum + unit.bytes, 0);
    if (bytes <= SHOT_BYTES && to - from <= maxRows) return [{ from, count: to - from, bytes, alone: 0 }];
    const alone = ++heavy;
    return units.map((unit) => (unit.alone ? unit : { ...unit, alone }));
  };
  const units = await stretch(0, rows, 0);
  const pieces = [];
  for (const { from, count, bytes, alone } of units) {
    const prior = pieces[pieces.length - 1];
    const last = prior && prior.alone === alone && prior.rows + count <= maxRows ? prior : null;
    if (last && last.bytes + bytes <= SHOT_BYTES) { last.rows += count; last.bytes += bytes; } else pieces.push({ from, rows: count, bytes, alone });
  }
  for (const [i, piece] of pieces.entries()) {
    piece.file = pieces.length === 1 ? file : file.replace(/\.png$/, '-' + (i + 1) + '-of-' + pieces.length + '.png');
    piece.png = await shoot(piece.from, piece.rows);
  }
  return pieces;
}

// Remove one image; a file another program holds open (EBUSY or EPERM on Windows) only warns.
async function removeImage(target, { rm = fs.rm, warn = console.warn } = {}) {
  try { await rm(target); } catch (error) {
    if (error.code !== 'EBUSY' && error.code !== 'EPERM') throw error;
    warn(`Could not remove ${target}, which another program holds open (${error.code}); close it and run again to clear it.`);
  }
}

/**
 * Write the `pieces` of image `file`, first removing what an earlier run left
 * of it beside them: `file` itself and every `<name>-<i>-of-<n>.png`, whose
 * count can differ from this run's, so no stale part stays to be opened. A
 * file a viewer holds open cannot be removed on Windows (EBUSY or EPERM):
 * that warns with its name and the capture goes on, its write replacing it or
 * leaving it stale.
 */
async function writePieces(file, pieces, options) {
  const base = path.basename(file, '.png').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const earlier = new RegExp('^' + base + '(-\\d+-of-\\d+)?\\.png$');
  for (const name of await fs.readdir(path.dirname(file))) {
    if (earlier.test(name)) await removeImage(path.join(path.dirname(file), name), options);
  }
  for (const piece of pieces) await fs.writeFile(piece.file, piece.png);
}

/**
 * Remove the section images `<stem>-<piece>.png`, whole or in parts, of a
 * several-piece sheet for pieces not in `names`: what an earlier run with a
 * longer list left. Only that sheet's own naming matches. A `<stem>-reference-`
 * name belongs to the reference sheet, so a piece of that name is never removed
 * by a plain sheet.
 */
async function removeGoneSections(stem, names, options) {
  const dir = path.dirname(stem), base = path.basename(stem);
  const own = new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-(.+?)(-\\d+-of-\\d+)?\\.png$');
  for (const name of await fs.readdir(dir)) {
    const piece = own.exec(name)?.[1];
    if (piece === undefined || names.includes(piece)) continue;
    if (!base.endsWith('-reference') && piece.startsWith('reference-')) continue;
    await removeImage(path.join(dir, name), options);
  }
}

/**
 * The image files of a sheet `bottom` CSS pixels tall with its `sections`
 * ({ name, top }): `<stem>.png` for one section, else `<stem>-<name>.png` for
 * each, after removing the section images of pieces an earlier run had. Each
 * part starts a little above its heading's rule and ends where the next starts.
 */
async function sheetParts(stem, sections, bottom) {
  if (sections.length === 1) return [{ file: stem + '.png', top: 0, bottom }];
  if (sections.length > 1) await removeGoneSections(stem, sections.map((section) => section.name));
  return sections.map((section, i) => ({
    file: stem + '-' + section.name + '.png',
    top: i ? section.top - 16 : 0,
    bottom: i + 1 < sections.length ? sections[i + 1].top - 16 : bottom,
  }));
}

// What the contact sheet page logs with console.debug before each stage it runs.
const SHEET_PROGRESS = 'artifex sheet: ';

/**
 * Write PNGs of a contact sheet as installed Edge renders it, once all
 * `cells` have rendered or failed: `<stem>.png` for a one-piece sheet, and
 * `<stem>-<piece>.png` for each piece of a larger one, so every image stays
 * readable. Images are `width` CSS pixels wide at one device pixel each, never
 * scaled down. A part too heavy for one screenshot reply, or taller than
 * SHEET_MAX_HEIGHT, is written top to bottom as `<name>-1-of-<n>.png` and on,
 * each file one screenshot cut between rows of whole cells, or inside a row
 * only when that row alone is too heavy or too tall for one file. With `images` false, or a sheet that carries a refusal, it writes none. Either way it returns window.__sheet as `sheet`.
 * `edge` stands in for withEdge in a test.
 */
async function captureSheet(html, stem, { cells, width = 1280, images = true, ...options }, edge = withEdge) {
  // The sheet page logs each stage it runs (SHEET_PROGRESS) before it runs it
  // in a task of its own, so a stall is named by its stage and cell. The
  // listener is added before navigation, so even the first stage is heard.
  let heard = false;
  const listen = (client, context) => client.onEvent((event) => {
    const text = event.method === 'Runtime.consoleAPICalled' && event.params.type === 'debug' && event.params.args[0]?.value;
    if (typeof text === 'string' && text.startsWith(SHEET_PROGRESS)) { heard = true; context.phase = text.slice(SHEET_PROGRESS.length); }
  });
  // The sheet is npm run seeds's: a PieceError its page throws is a seeds refusal.
  return edge(html, { ...options, listen, command: 'seeds' }, async (client, context) => {
    if (!heard) context.phase = 'sheet page load';
    const viewport = (height) => client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    // A short viewport first, so the content alone sets the page height, and no
    // scroll bar, so the layout is the full width from the start.
    await viewport(100);
    await client.send('Emulation.setScrollbarsHidden', { hidden: true });
    await waitFor(client, context, '(' + sheetReady.toString() + ')(' + cells + ')');
    // Node reading the finished sheet back over CDP: a stall here is not the piece's.
    context.phase = 'sheet read-back';
    const sheet = await evaluateInPieces(client, '(' + sheetData.toString() + ')()');
    // A refused sheet is refused by its caller, so no image of it is left behind.
    if (!images || sheet.refusal) return { shots: [], cells, failures: sheet.failures, sheet };
    context.phase = 'sheet capture';
    // Grow the viewport to the whole sheet, so what is measured below is exactly
    // what is captured.
    let bottom = 0;
    for (let tries = 0; tries < 4; tries++) {
      const height = Math.ceil((await client.send('Page.getLayoutMetrics')).cssContentSize.height);
      if (height === bottom) break;
      bottom = height;
      await viewport(bottom);
    }
    const parts = await sheetParts(stem, await evaluate(client, '(' + sheetSections.toString() + ')()'), bottom);
    const cuts = await evaluate(client, '(' + sheetCuts.toString() + ')()');
    const shots = [];
    for (const part of parts) {
      const height = part.bottom - part.top;
      const pieces = await sheetPieces(part.file, async (from, count) => {
        const clip = sheetClip(part.top, width, height, from, count);
        return Buffer.from((await client.send('Page.captureScreenshot', { format: 'png', clip })).data, 'base64');
      }, height, bandRows(width), cuts.map((level) => level.map((y) => y - part.top)), SHEET_MAX_HEIGHT);
      await writePieces(part.file, pieces);
      for (const piece of pieces) shots.push({ file: piece.file, width, height: piece.rows });
    }
    return { shots, cells, failures: sheet.failures, sheet };
  }).catch((error) => {
    // Only a stall in the sheet's own work earns the hint; one at Edge startup,
    // CDP connection, page navigation, sheet page load or sheet read-back is the browser's.
    // It follows the timeout line it explains, before any cleanup failure.
    error.message = error.message.replace(/^.*timed out after \d+ ms during (piece module load|piece setup|piece build|frame draw|strip flags|sheet results|soundtrack render|sheet capture).*$/m,
      '$&\nA slow piece needs more time: raise --timeout-ms, or draw fewer or smaller cells.');
    throw error;
  });
}

// Writes a tool's full JSON report under `dir` and returns its absolute path.
async function saveReport(name, report, dir = OUT) {
  const file = path.resolve(dir, name + '.json');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, JSON.stringify(report, null, 2) + '\n');
  return file;
}

/**
 * What an MP4 film's summary says of a film drawn again in memory (`contextLost`,
 * an `encoderError` naming `video`, or a `rasterizerBeforeRedraw`), or '' for
 * one drawn once. It names the reading of the pass it replaced, as
 * routeVerdict judges it, and makes no verdict. That pass's `null` means a test
 * pattern could not tell only when it was the CPU route's, as under
 * --force no-webgl2; on any other route no pattern ran.
 */
function redrawPhrase(film, options) {
  const before = film.rasterizerBeforeRedraw;
  if (!before && filmDrawnAgain(film) !== 'memory') return '';
  const first = before === 'gpu' ? 'on the GPU' : before === 'memory' ? 'in memory'
    : options.force === 'no-webgl2' ? 'where a test pattern could not tell' : null;
  return ', drawn again in memory' + (first ? ' after frames first drawn ' + first : '');
}

// What the summary says of a film's replay verdict, or '' for a film not replayed.
function replayPhrase(replay) {
  if (!replay) return '';
  if (!replay.match) return ', and DIFFERS on replay';
  return ', and replayed as matching, its worst frame ' + replay.pictureMarginDb + ' dB over the floor'
    + (replay.soundMarginDb !== null ? ' and its worst sound block at or over the floor ' + replay.soundMarginDb + ' dB over it' : '');
}

async function main(args = process.argv.slice(2), run = runAll, dir = OUT) {
  const options = parseArgs(args);
  if (options.help) { console.log(USAGE); return; }
  let report, failure;
  try { report = await run(options); } catch (error) { failure = error; report = error.report; }
  if (report) {
    if (options.json) console.log(JSON.stringify(report, null, 2));
    const films = report.films.length
      ? report.films.map((f) => '; film ' + f.name + (f.offered === 'webm'
        ? ' offered as WebM with MP4 hidden, recorded ' + f.frames + ' frames lasting ' + f.seconds + ' s'
          + (f.refusals && f.refusals.length ? ' after ' + f.refusals.length + ' refused recording' + (f.refusals.length > 1 ? 's' : '')
            + ' (' + f.refusals.map((r) => r.frames + ' of ' + f.frames + ' frames, ' + r.late + ' late').join('; ') + ')' : '')
          + ', decoded, and parsed with every frame'
        : ' offered as MP4 with WebM hidden, exported ' + f.frames + ' frames'
          + (f.manifest && f.manifest.reframe ? ' along a timeline of ' + f.manifest.reframe.length + ' boxes' : '')
          + (f.sound ? ' with an ' + (f.soundCodec === 'mp4a' ? 'AAC' : f.soundCodec) + ' soundtrack' : '')
          + ', colour converted ' + (f.conversion === 'encoder' ? 'by the encoder' : 'on the ' + f.conversion.toUpperCase())
          + (f.rasterizer ? ' from frames drawn ' + (f.rasterizer === 'gpu' ? 'on the GPU' : 'in memory') : '')
          + (f.crashedAt != null ? ', the GPU process crashed at frame ' + f.crashedAt : '')
          + redrawPhrase(f, options)
          + ', decoded, and named the page\'s recipe')
        + replayPhrase(f.replay)).join('')
      : '; no example has a timeline, so no film was exported';
    // Every Edge that failed only to clean up says so in the failure (withEdge's
    // "browser: cleanup failed"); any other failure came after every browser was cleaned up.
    const image = report.imageFixture, play = report.playFixture;
    // A forced run's verdict is about its fallback, and must never read as the
    // default run's; nor may a run that accepted any colour route.
    console.log('browser' + (report.forced ? ' with ' + FORCED[report.forced].means : '')
      + (report.allowFallback ? (report.forced ? ',' : '') + ' accepting a fallback colour route' : '')
      + ': ' + report.pieces.length + ' examples passed' + films
      + (report.flashFixture ? '; no film flashed past WCAG 2.3.1, and the flash fixture\'s film warned of ' + report.flashFixture.general
        + ' general and ' + report.flashFixture.red + ' red flashes' + replayPhrase(report.flashFixture.replay) : '')
      + (image && image.png && image.png.match ? '; the image fixture\'s page credited its image, and its PNG showed it and replayed as matching'
        + (image.replay ? ', and its film was exported' + replayPhrase(image.replay) : '')
        + (image.decode && image.decode.converted ? '; npm run image converted a gamma-tagged PNG to sRGB in Edge' : '') : '')
      + (play && play.still && play.still.match ? '; the play fixture was played for ' + play.ticks + ' ticks through ' + play.inputs + ' real inputs'
        + (play.sound ? ', the page played its ' + play.sound.heard + ' sound cues live' : '') + ', its saved session ran again to the same frames'
        + ', its film was exported' + replayPhrase(play.film.replay) + ', and its still replayed as matching' : '')
      + (failure && /browser: cleanup failed/.test(failure.message) ? '; cleanup failed' : '; owned browser, server and profile cleaned up'));
    if (!options.json) console.log('report: ' + slash(await saveReport('browser', report, dir)));
  }
  if (failure) throw failure;
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = {
  parseArgs, findEdge, browserCandidates, connectCDP, evaluate, servePage, inspectPiece, inspectStill, pagePng, stillVerdict, filmsToExport, inspectFilm, runBrowserCheck, checkPage, replayFilms, requireReplays,
  stopBrowser, stopRelaunched, removeProfile, main, saveReport, FORCED, retryBehindSchedule, crashPartway, sheetReady, sheetData, captureSheet, frameMatch, soundMatch, loudnessMatch, PAGE_LOUDNESS_MATCH, withEdge, waitFor, pageErrors, routeVerdict, redrawPhrase,
  evaluateInPieces, PIECE_CHARS, SHOT_BYTES, bandRows, sheetPieces, sheetCuts, writePieces, removeGoneSections, sheetParts, sheetClip, checkFlashFixture, checkImageFixture, checkPlayFixture, imageMiss, TIMEOUT_MS, timeoutArg, SHEET_PROGRESS,
};
