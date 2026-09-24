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

const { webmBlockTimes, filmVerdict } = require('./build-page.js');

const ROOT = path.resolve(__dirname, '..');
const USAGE = 'usage: node tools/check-browser.js [--edge PATH] [--timeout-ms 60000] [--headed] [--force no-aac|no-webgl2|no-h264] [--allow-fallback]';

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
};

function parseArgs(args) {
  const options = { timeoutMs: 60000, headed: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help') options.help = true;
    else if (arg === '--headed') options.headed = true;
    else if (arg === '--edge' && args[i + 1] && !args[i + 1].startsWith('--')) options.edge = args[++i];
    else if (arg === '--timeout-ms' && /^\d+$/.test(args[i + 1] || '')) options.timeoutMs = Number(args[++i]);
    // One condition per run, so a verdict names the one fallback it checked.
    else if (arg === '--force' && !options.force && Object.hasOwn(FORCED, args[i + 1] || '')) options.force = args[++i];
    // For a machine without a usable GPU, where the encoder route cannot run.
    else if (arg === '--allow-fallback') options.allowFallback = true;
    else throw new Error(USAGE);
  }
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 100 || options.timeoutMs > 300000) {
    throw new Error('browser: --timeout-ms must be an integer from 100 to 300000');
  }
  return options;
}

async function findEdge(explicit, env = process.env, platform = process.platform) {
  const candidates = explicit ? [explicit] : env.EDGE_PATH ? [env.EDGE_PATH] : platform === 'win32'
    ? [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean)
      .map((dir) => path.join(dir, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
    : platform === 'darwin' ? ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
      : ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable', '/opt/microsoft/msedge/msedge'];
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (await fs.stat(resolved).then((stat) => stat.isFile(), () => false)) return resolved;
  }
  throw new Error('browser: installed Microsoft Edge was not found; use --edge PATH or EDGE_PATH (no browser is downloaded)');
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

async function evaluate(client, expression) {
  const reply = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (reply.exceptionDetails) {
    throw new Error('browser: evaluation failed: ' + (reply.exceptionDetails.exception?.description || reply.exceptionDetails.text));
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

async function servePage(page) {
  // Serve only this immutable HTML snapshot, never arbitrary workspace paths.
  const server = http.createServer((request, response) => {
    let pathname;
    try { pathname = new URL(request.url, 'http://localhost').pathname; }
    catch { response.writeHead(400).end(); return; }
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
  return { name, stages, manifest, paintedPixels: painted, pixels: canvas.width * canvas.height };
}

// Serialized into the page. What filmsToExport needs of each registered example.
function exampleTraits() {
  const api = window.__artifex;
  return api.names.map((name) => {
    const p = api.piece.validate(api.examples[name]);
    return { name, sound: !!p.sound, time: !!p.time };
  });
}

// Serialized into the page and pinned in Node, so it stays self-contained. The
// films to export: every example that declares sound, so each soundtrack is
// decoded, else the first with a timeline.
function filmsToExport(examples) {
  const sounding = examples.filter((example) => example.sound);
  return (sounding.length ? sounding : examples.filter((example) => example.time).slice(0, 1)).map((example) => example.name);
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

// Serialized into the page for a forced WebM run. The page refuses a recording
// that fell behind its schedule, which a loaded machine causes; this records
// again, at most `limit` recordings in all, and names each refusal with the
// frames it held. Any other refusal fails at once. Resolves to the accepted
// recording's report and the refusals before it.
async function retryBehindSchedule(record, frames, limit = 3) {
  const refusals = [];
  for (;;) {
    try { return { report: await record(), refusals }; } catch (error) {
      const behind = /fell (\d+) ms behind its schedule/.exec(error.message);
      if (!behind || refusals.length + 1 >= limit) {
        if (refusals.length) {
          error.message += ' Recording ' + (refusals.length + 1) + ' of ' + limit + '; the page refused '
            + refusals.map((r) => r.frames + ' of ' + frames + ' frames').join(', ') + ' before it.';
        }
        throw error;
      }
      const held = /holds (\d+) of \d+ frames/.exec(error.message);
      refusals.push({ frames: held ? Number(held[1]) : frames, behindMs: Number(behind[1]) });
    }
  }
}

// Serialized into the page. Requires the page to offer the MP4 film and hide the
// WebM fallback, then exports the named example's film through the page's own
// MP4 path and decodes it: the first, middle and last frames must each match
// their own drawn frame, as frameMatch judges, and a declared
// soundtrack must decode to exactly the film's length, start as a fresh render
// does, and measure -14 LUFS or peak at -1 dBTP, and two more renders of it must
// agree within 1e-6. The export's own verdict is read from the file. The
// replay manifest is found in the film's bytes by this check's own scan, not
// readMp4, so a fault shared by the writer and the reader cannot pass: it must
// be the page's recipe with the frames drawn in place of the playhead.
//
// A forced run (`force`, a FORCED key) checks what its condition must change:
// an Opus soundtrack without AAC, the colour route without WebGL2 (judged in
// Node by routeVerdict), and without H.264 the WebM offer, whose recording must decode, last frames / hz
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
  const { report, refusals } = webm ? await retry(() => api.video(), heads.length) : { report: await api.film(), refusals: [] };
  if (force === 'no-aac' && (!report.sound || report.sound.codec !== 'Opus')) {
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
    recipe.film = { frames: heads.length, hz: p.time.hz, loop: !!p.time.loop, scale: 1 };
    if (JSON.stringify(manifest) !== JSON.stringify(recipe)) {
      throw new Error(name + ': the film names ' + JSON.stringify(manifest) + ' and the page ' + JSON.stringify(recipe));
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
  // and on one kept in memory. The export draws on a GPU-backed canvas, except
  // on the CPU colour route, which reads every frame back. The reference is read
  // only through the small memory canvas: reading a GPU-backed canvas directly
  // would move it to memory for good.
  const full = document.createElement('canvas');
  full.width = width; full.height = height;
  const fg = report.conversion === 'cpu' ? full.getContext('2d', { willReadFrequently: true }) : full.getContext('2d');
  const pixels = (source) => { sg.clearRect(0, 0, w, h); sg.drawImage(source, 0, 0, w, h); return sg.getImageData(0, 0, w, h).data; };
  const drawn = (i) => { fg.clearRect(0, 0, full.width, full.height); api.render.drawFrame(fg, p, solved, heads[i]); return pixels(full); };
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
  if (webm) {
    // The saved bytes go back to Node, which counts their frames with the page's reader.
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return {
      name, offered, reason: offer.reason, frames: heads.length, hz: p.time.hz, seconds: lasts, bytes: bytes.length, decoded: frames, refusals,
      webm: btoa(binary),
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
    // Edge adds up a node's three or more inputs in an order that changes
    // between renders, so two renders agree only to the last bits of a float.
    const [a, b] = [await api.render.renderSound(p, solved, { OfflineAudioContext }),
      await api.render.renderSound(p, solved, { OfflineAudioContext })];
    let apart = 0;
    for (let c = 0; c < a.numberOfChannels; c++) {
      const x = a.getChannelData(c), y = b.getChannelData(c);
      for (let i = 0; i < x.length; i++) apart = Math.max(apart, Math.abs(x[i] - y[i]));
    }
    if (!(apart <= 1e-6)) throw new Error(name + ': two renders of the soundtrack differ by ' + apart);
    // A codec's priming can swallow or shift the start of a soundtrack: from its
    // first sound, 1024 decoded samples must follow a fresh render at the gain
    // the export applied. In installed Edge the examples decode 29 to 52 dB from
    // their render there, AAC and Opus; settle's AAC soundtrack without its
    // silent lead decoded 6.4 dB from it.
    const START_DB = 10;
    const gain = 10 ** (report.sound.gain / 20);
    const sounds = (i) => { for (let c = 0; c < a.numberOfChannels; c++) if (Math.abs(gain * a.getChannelData(c)[i]) > 1e-3) return true; return false; };
    let onset = 0;
    while (onset < a.length && !sounds(onset)) onset++;
    let rendered = 0, error = 0;
    for (let c = 0; c < a.numberOfChannels; c++) {
      const x = a.getChannelData(c), y = decoded.getChannelData(c);
      for (let i = onset; i < Math.min(onset + 1024, x.length); i++) { rendered += (gain * x[i]) ** 2; error += (gain * x[i] - y[i]) ** 2; }
    }
    const startDb = 10 * Math.log10(rendered / error);
    if (!(startDb >= START_DB)) {
      throw new Error(name + ': from its first sound, at sample ' + onset + ', the soundtrack decodes ' + startDb.toFixed(1)
        + ' dB from a fresh render, under ' + START_DB + ' dB');
    }
    // The export levels every soundtrack to -14 LUFS, or to -1 dBTP where its
    // peaks come first, and the decoded film has to measure so, codec and all.
    const heard = api.loudness(decoded);
    if (!(Math.abs(heard.lufs + 14) <= 0.1 || (Math.abs(heard.dbtp + 1) <= 0.1 && heard.lufs < -14))) {
      throw new Error(name + ': the decoded soundtrack measures ' + heard.lufs.toFixed(2) + ' LUFS and ' + heard.dbtp.toFixed(2)
        + ' dBTP, neither -14 LUFS nor -1 dBTP');
    }
    sound = {
      seconds: +decoded.duration.toFixed(3), samples: decoded.length, peak: +peak.toFixed(3), renderDiff: apart,
      gain: report.sound.gain, lufs: +heard.lufs.toFixed(2), dbtp: +heard.dbtp.toFixed(2),
      onset, startDb: +startDb.toFixed(1),
    };
  }
  return {
    name, offered, codec: report.codec, frames: report.frames, seconds: report.seconds, width: report.width, height: report.height,
    bytes: report.bytes, colour: report.colour, realtime: report.realtime, decoded: frames, sound, manifest,
    soundCodec: report.sound ? report.sound.codec : null, conversion: report.conversion, convertMs: report.convertMs,
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
      windowsHide: true, stdio: 'ignore', timeout: Math.max(1, deadline - Date.now()), killSignal: 'SIGKILL',
    });
    killer.once('error', reject);
    killer.once('close', () => resolve());
  });
}

async function stopBrowser(child, exited, { limitMs = STOP_MS, kill = killTree } = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  // This exact child belongs to the unique profile created below. Never kill by
  // executable name: an ordinary Edge session may already be running.
  const deadline = Date.now() + limitMs;
  await kill(child, deadline);
  // The stop is judged by the owned Edge alone. taskkill's exit code and
  // localized output decide nothing: it also fails for a member that exited by
  // itself. A descendant that outlived Edge would keep the profile locked, and
  // the bounded profile removal then fails the cleanup.
  // Cancel the bound once Edge exits, so its timer does not hold the process open.
  const bound = new AbortController();
  const stopped = await Promise.race([exited.then(() => true),
    delay(Math.max(0, deadline - Date.now()), false, { signal: bound.signal }).catch(() => false)]);
  bound.abort();
  if (!stopped) throw new Error('browser: could not stop owned Edge process ' + child.pid + ' within ' + limitMs + ' ms');
}

/** Remove only the owned artifex-browser-* profile, retrying while stopped processes still hold its files. */
async function removeProfile(profile, { limitMs = PROFILE_MS, rm = fs.rm } = {}) {
  const tempRoot = await fs.realpath(os.tmpdir());
  const relative = path.relative(tempRoot, path.resolve(profile));
  if (!/^artifex-browser-[^/\\]+$/.test(relative)) throw new Error('refusing cleanup outside the owned temporary profile');
  const deadline = Date.now() + limitMs;
  for (;;) {
    try { await rm(profile, { recursive: true, force: true }); return; } catch (error) {
      if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error.code) || Date.now() >= deadline) throw error;
      await delay(200);
    }
  }
}

/**
 * Serve one HTML snapshot on loopback, open it in installed Edge with a unique
 * temporary profile over CDP, and run `work(client, context)`. Then stop only
 * that Edge and remove only its profile. Page exceptions and console errors
 * collect in `context.errors`; `context.phase` names the step a failure
 * reports. A cleanup-only failure keeps work's result on the error as `report`.
 */
async function withEdge(page, options, work) {
  if (typeof globalThis.WebSocket !== 'function' || typeof globalThis.fetch !== 'function') {
    throw new Error('browser: Node 22 or later is required for native WebSocket and fetch');
  }
  const edge = await findEdge(options.edge);
  const timeoutMs = options.timeoutMs ?? 60000;
  const controller = new AbortController(), { signal } = controller;
  const timer = setTimeout(() => controller.abort(new Error('browser: timed out after ' + timeoutMs + ' ms')), timeoutMs);
  const interrupt = () => controller.abort(new Error('browser: interrupted'));
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  let server, profile, child, exited, client, result, failure;
  let browserLog = '';
  const context = { signal, errors: [], phase: 'startup', version: null };
  try {
    server = await servePage(page);
    const tempRoot = await fs.realpath(os.tmpdir());
    profile = await fs.mkdtemp(path.join(tempRoot, 'artifex-browser-' + process.pid + '-'));
    child = spawn(edge, [
      '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
      '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
      '--disable-background-networking', ...(options.headed ? [] : ['--headless=new']), 'about:blank',
    ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.on('data', (chunk) => { browserLog = (browserLog + chunk).slice(-3000); });
    exited = new Promise((resolve) => {
      child.once('error', (error) => { controller.abort(new Error('browser: Edge launch failed: ' + error.message)); resolve(); });
      child.once('exit', (code, killed) => {
        controller.abort(new Error('browser: Edge exited before completion (' + (killed || code) + ')'));
        resolve();
      });
    });
    let endpoint, version;
    while (!version) {
      signal.throwIfAborted();
      try {
        const port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0].trim();
        if (!/^\d+$/.test(port)) throw new Error('invalid debugging port');
        endpoint = 'http://127.0.0.1:' + port;
        const response = await fetch(endpoint + '/json/version', { signal });
        if (response.ok) version = await response.json();
      } catch { signal.throwIfAborted(); }
      if (!version) await delay(50, undefined, { signal });
    }
    context.version = version;
    let target;
    while (!target) {
      const response = await fetch(endpoint + '/json/list', { signal });
      if (!response.ok) throw new Error('browser: target discovery returned HTTP ' + response.status);
      target = (await response.json()).find((item) => item.type === 'page' && item.url === 'about:blank');
      if (!target) await delay(50, undefined, { signal });
    }
    context.phase = 'CDP connection';
    client = await connectCDP(target.webSocketDebuggerUrl, signal);
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
    failure = new Error((signal.aborted ? signal.reason.message : error.message) + ' during ' + context.phase);
    if (/CDP connection closed|Edge exited/.test(failure.message) && browserLog) {
      failure.message += '\nEdge diagnostics:\n' + browserLog.trim();
    }
  } finally {
    clearTimeout(timer);
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
    if (client) {
      // Browser.close may close the socket before its reply reaches the client.
      try { await untilAbort(client.send('Browser.close'), AbortSignal.timeout(1500)); } catch { /* force-close below */ }
      client.close();
    }
    const cleanupErrors = [];
    try { await stopBrowser(child, exited); } catch (error) { cleanupErrors.push(error.message); }
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

/** Wait until `expression` holds in the page, failing at once on a page error. */
async function waitFor(client, context, expression) {
  for (;;) {
    if (context.errors.length) throw new Error('browser: page errors:\n' + context.errors.join('\n'));
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
 */
function routeVerdict(options, film) {
  if (film.offered !== 'mp4') return null;
  const route = String(film.conversion).toUpperCase();
  if (options.force === 'no-webgl2') return film.conversion === 'cpu' ? null : film.name + ': with WebGL2 hidden the colour was converted on the ' + route + ', not the CPU';
  if (film.conversion === 'encoder' || options.allowFallback) return null;
  return film.name + ': the colour was converted on the ' + route + ', not by the encoder, so the encoder route fell back; on a machine without a usable GPU, pass --allow-fallback';
}

async function runBrowserCheck(options = {}) {
  const pagePath = options.pagePath || path.join(ROOT, 'out', 'index.html');
  const page = await fs.readFile(pagePath).catch((error) => {
    throw new Error('browser: cannot read ' + pagePath + '; run npm run page first: ' + error.message);
  });
  return withEdge(page, options, (client, context) => checkPage(client, context, options));
}

/**
 * The checks `npm run browser` makes in the loaded page: every example, then
 * each film filmsToExport chooses, on the colour route the run requires.
 */
async function checkPage(client, context, options) {
  await waitFor(client, context, 'document.readyState === "complete" && !!window.__artifex');
  const names = await evaluate(client, 'window.__artifex.names');
  if (!Array.isArray(names) || !names.length) throw new Error('browser: no registered examples');
  const pieces = [];
  for (const name of names) {
    context.phase = 'example ' + name;
    pieces.push(await evaluate(client, '(' + inspectPiece.toString() + ')(' + JSON.stringify(name) + ')'));
  }
  const films = [];
  const chosen = await evaluate(client, '(' + filmsToExport.toString() + ')((' + exampleTraits.toString() + ')())');
  // A forced run checks its one fallback on one film.
  for (const name of options.force ? chosen.slice(0, 1) : chosen) {
    context.phase = 'film export ' + name;
    // A WebM film comes back whole, as base64, and can pass the 4 MiB a reply may carry.
    const film = await evaluateInPieces(client, '((frameMatch) => (' + inspectFilm.toString() + ')(' + JSON.stringify(name)
      + (options.force ? ', ' + JSON.stringify(options.force) + ', ' + retryBehindSchedule.toString() : '') + '))(' + frameMatch.toString() + ')');
    const route = routeVerdict(options, film);
    if (route) throw new Error('browser: ' + route);
    if (film.webm) {
      // Every frame, evenly spaced, in the bytes the page saved.
      film.blocks = filmVerdict(film.frames, film.hz, webmBlockTimes(new Uint8Array(Buffer.from(film.webm, 'base64')))).frames;
      delete film.webm;
    }
    films.push(film);
  }
  if (context.errors.length) throw new Error('browser: page errors:\n' + context.errors.join('\n'));
  return {
    browser: context.version.Browser, mode: options.headed ? 'headed' : 'headless', ...(options.force && { forced: options.force }),
    ...(options.allowFallback && { allowFallback: true }), pieces, films, errors: context.errors,
  };
}

// Serialized into the contact sheet. Ready once every planned cell has
// rendered or failed; the sheet publishes window.__sheet after its last cell.
function sheetReady(expected) {
  const sheet = window.__sheet;
  return !!sheet && sheet.cells.length === expected
    && sheet.cells.every((cell) => cell.error !== null || typeof cell.markCount === 'number');
}

// Serialized into the contact sheet. Each piece's part of the page in CSS
// pixels from the top: its heading down to the next piece's heading.
function sheetSections() {
  const heads = Array.from(document.querySelectorAll('#out > h2'));
  const top = (element) => Math.round(element.getBoundingClientRect().top + window.scrollY);
  return heads.map((h2) => ({ name: h2.textContent, top: top(h2) }));
}

// The tallest image one capture writes; a taller part is scaled down to fit.
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
 * `height` CSS pixels tall from CSS pixel `top`, shot at `scale`. The whole
 * part keeps the clip it always had, so its file stays the same. Edge drops a
 * row when a scaled piece's height comes a hair short of whole rows, and gives
 * `count` rows for anything up to nearly one more, so a scaled piece asks half
 * a row more; an unscaled piece is whole rows already.
 */
function sheetClip(top, width, height, scale, from, count) {
  if (count === Math.round(height * scale)) return { x: 0, y: top, width, height, scale };
  return { x: 0, y: top + from / scale, width, height: scale < 1 ? (count + 0.5) / scale : count, scale };
}

/**
 * Shoot `rows` device rows with `shoot(fromRow, rowCount)`, which returns one
 * screenshot's PNG, in as few screenshots as fit in a reply: `[{ file, from,
 * rows, png }]`. Rows that fit even as incompressible pixels take one
 * screenshot. Otherwise bands of `band` rows, which always fit, are shot first
 * to weigh them, and each run of bands whose PNGs fit together is shot again
 * whole. One piece keeps `file`; several are `<name>-1-of-<n>.png` and on.
 */
async function sheetPieces(file, shoot, rows, band) {
  if (rows <= band) return [{ file, from: 0, rows, png: await shoot(0, rows) }];
  const pieces = [];
  for (let from = 0; from < rows; from += band) {
    const count = Math.min(band, rows - from), bytes = (await shoot(from, count)).length, last = pieces[pieces.length - 1];
    if (last && last.bytes + bytes <= SHOT_BYTES) { last.rows += count; last.bytes += bytes; } else pieces.push({ from, rows: count, bytes });
  }
  for (const [i, piece] of pieces.entries()) {
    piece.file = pieces.length === 1 ? file : file.replace(/\.png$/, '-' + (i + 1) + '-of-' + pieces.length + '.png');
    piece.png = await shoot(piece.from, piece.rows);
  }
  return pieces;
}

/**
 * Write PNGs of a contact sheet as installed Edge renders it, once all
 * `cells` have rendered or failed: `<stem>.png` for a one-piece sheet, and
 * `<stem>-<piece>.png` for each piece of a larger one, so every image stays
 * readable. Images are `width` CSS pixels wide at one device pixel each. A
 * part too heavy for one screenshot reply is written top to bottom as
 * `<name>-1-of-<n>.png` and on, each file one screenshot.
 */
async function captureSheet(html, stem, { cells, width = 1280, ...options }) {
  return withEdge(html, options, async (client, context) => {
    const viewport = (height) => client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    // A short viewport first, so the content alone sets the page height, and no
    // scroll bar, so the layout is the full width from the start.
    await viewport(100);
    await client.send('Emulation.setScrollbarsHidden', { hidden: true });
    context.phase = 'sheet rendering';
    await waitFor(client, context, '(' + sheetReady.toString() + ')(' + cells + ')');
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
    const sections = await evaluate(client, '(' + sheetSections.toString() + ')()');
    // Each part starts a little above its heading's rule and ends where the next part starts.
    const parts = sections.length === 1 ? [{ file: stem + '.png', top: 0, bottom }]
      : sections.map((section, i) => ({
        file: stem + '-' + section.name + '.png',
        top: i ? section.top - 16 : 0,
        bottom: i + 1 < sections.length ? sections[i + 1].top - 16 : bottom,
      }));
    const shots = [];
    for (const part of parts) {
      const height = part.bottom - part.top;
      const scale = Math.min(1, SHEET_MAX_HEIGHT / height);
      const w = Math.round(width * scale), rows = Math.round(height * scale);
      const pieces = await sheetPieces(part.file, async (from, count) => {
        const clip = sheetClip(part.top, width, height, scale, from, count);
        return Buffer.from((await client.send('Page.captureScreenshot', { format: 'png', clip })).data, 'base64');
      }, rows, bandRows(w));
      for (const piece of pieces) {
        await fs.writeFile(piece.file, piece.png);
        shots.push({ file: piece.file, width: w, height: piece.rows });
      }
    }
    return { shots, cells, failures: await evaluate(client, 'window.__sheet.failures()') };
  });
}

async function main(args = process.argv.slice(2), run = runBrowserCheck) {
  const options = parseArgs(args);
  if (options.help) { console.log(USAGE); return; }
  let report, failure;
  try { report = await run(options); } catch (error) { failure = error; report = error.report; }
  if (report) {
    console.log(JSON.stringify(report, null, 2));
    const films = report.films.length
      ? report.films.map((f) => '; film ' + f.name + (f.offered === 'webm'
        ? ' offered as WebM with MP4 hidden, recorded ' + f.frames + ' frames lasting ' + f.seconds + ' s'
          + (f.refusals && f.refusals.length ? ' after ' + f.refusals.length + ' refused recording' + (f.refusals.length > 1 ? 's' : '')
            + ' (' + f.refusals.map((r) => r.frames).join(', ') + ' of ' + f.frames + ' frames)' : '')
          + ', decoded, and parsed with every frame'
        : ' offered as MP4 with WebM hidden, exported ' + f.frames + ' frames'
          + (f.sound ? ' with an ' + (f.soundCodec === 'mp4a' ? 'AAC' : f.soundCodec) + ' soundtrack' : '')
          + ', colour converted ' + (f.conversion === 'encoder' ? 'by the encoder' : 'on the ' + f.conversion.toUpperCase())
          + ', decoded, and named the page\'s recipe')).join('')
      : '; no example has a timeline, so no film was exported';
    // A forced run's verdict is about its fallback, and must never read as the
    // default run's; nor may a run that accepted any colour route.
    console.log('browser' + (report.forced ? ' with ' + FORCED[report.forced].means : '')
      + (report.allowFallback ? (report.forced ? ',' : '') + ' accepting a fallback colour route' : '')
      + ': ' + report.pieces.length + ' examples passed' + films
      + (failure ? '; cleanup failed' : '; owned browser, server and profile cleaned up'));
  }
  if (failure) throw failure;
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = {
  parseArgs, findEdge, connectCDP, evaluate, servePage, inspectPiece, filmsToExport, inspectFilm, runBrowserCheck, checkPage,
  stopBrowser, removeProfile, main, FORCED, retryBehindSchedule, sheetReady, captureSheet, frameMatch, withEdge, waitFor, routeVerdict,
  evaluateInPieces, PIECE_CHARS, SHOT_BYTES, bandRows, sheetPieces, sheetClip,
};
