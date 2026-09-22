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

const ROOT = path.resolve(__dirname, '..');
const USAGE = 'usage: node tools/check-browser.js [--edge PATH] [--timeout-ms 60000] [--headed]';

function parseArgs(args) {
  const options = { timeoutMs: 60000, headed: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help') options.help = true;
    else if (arg === '--headed') options.headed = true;
    else if (arg === '--edge' && args[i + 1] && !args[i + 1].startsWith('--')) options.edge = args[++i];
    else if (arg === '--timeout-ms' && /^\d+$/.test(args[i + 1] || '')) options.timeoutMs = Number(args[++i]);
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

// Serialized into the page. Requires the page to offer the MP4 film and hide the
// WebM fallback, then exports one film through the page's own MP4 path -- the
// first example that declares sound, else the first with a timeline -- and
// decodes it: the first, middle and last frames must each look at least as much
// like their own drawn frame as like a neighbour, and a declared soundtrack must
// decode to sound as long as the film. A held frame draws the same picture as
// its neighbour, so that tie is a match. The export's own verdict is read from
// the file.
async function inspectFilm() {
  const api = window.__artifex;
  const pieces = api.names.map((name) => [name, api.piece.validate(api.examples[name])]);
  const chosen = pieces.find(([, p]) => p.sound) || pieces.find(([, p]) => p.time);
  if (!chosen) return null;
  const [name, p] = chosen;
  api.select(name);
  const offered = await api.filmFormat();
  const shown = (id) => document.getElementById(id).checkVisibility();
  if (offered !== 'mp4' || !shown('film1') || shown('video')) {
    throw new Error(name + ': the page offers ' + offered + ' with MP4 ' + (shown('film1') ? 'shown' : 'hidden')
      + ' and WebM ' + (shown('video') ? 'shown' : 'hidden'));
  }
  const report = await api.film();
  const solved = api.piece.solve(p, api.read().seed);
  const heads = api.render.playheads(p);
  const video = document.createElement('video');
  video.muted = true;
  video.src = URL.createObjectURL(report.blob);
  await new Promise((resolve, reject) => {
    video.onloadeddata = resolve;
    video.onerror = () => reject(new Error(name + ': the exported film does not decode'));
  });
  const w = 240, h = Math.max(2, Math.round((240 * report.height) / report.width));
  const small = document.createElement('canvas');
  small.width = w; small.height = h;
  const sg = small.getContext('2d', { willReadFrequently: true });
  const full = document.createElement('canvas');
  full.width = report.width; full.height = report.height;
  const fg = full.getContext('2d', { willReadFrequently: true });
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
    const got = pixels(video);
    const scores = [i - 1, i, i + 1].filter((j) => j >= 0 && j < heads.length).map((j) => [j, psnr(got, drawn(j))]);
    const own = scores.find(([j]) => j === i)[1];
    const best = scores.slice().sort((a, b) => b[1] - a[1])[0];
    if (best[1] > own) throw new Error(name + ': decoded frame ' + i + ' looks most like drawn frame ' + best[0]);
    frames.push({ frame: i, psnrDb: +own.toFixed(1) });
  }
  URL.revokeObjectURL(video.src);
  let sound = null;
  if (p.sound) {
    const decoded = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(await report.blob.arrayBuffer());
    let peak = 0;
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      for (const v of decoded.getChannelData(c)) peak = Math.max(peak, Math.abs(v));
    }
    if (!(peak > 0.01)) throw new Error(name + ': the soundtrack decodes to silence');
    if (Math.abs(decoded.duration - report.seconds) > 0.05) {
      throw new Error(name + ': the soundtrack decodes to ' + decoded.duration.toFixed(3) + ' s against a ' + report.seconds.toFixed(3) + ' s film');
    }
    sound = { seconds: +decoded.duration.toFixed(3), peak: +peak.toFixed(3) };
  }
  return {
    name, offered, codec: report.codec, frames: report.frames, seconds: report.seconds, width: report.width, height: report.height,
    bytes: report.bytes, colour: report.colour, realtime: report.realtime, decoded: frames, sound,
  };
}

async function stopBrowser(child, exited) {
  if (!child || child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  // This exact child belongs to the unique profile created below. Never kill by
  // executable name: an ordinary Edge session may already be running.
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    await Promise.race([new Promise((resolve) => {
      killer.once('error', resolve); killer.once('exit', resolve);
    }), delay(2000)]);
    if (killer.exitCode === null && killer.signalCode === null) killer.kill();
  } else child.kill('SIGKILL');
  if (!await Promise.race([exited.then(() => true), delay(2000, false)])) {
    throw new Error('browser: could not stop owned Edge process ' + child.pid);
  }
}

async function runBrowserCheck(options = {}) {
  if (typeof globalThis.WebSocket !== 'function' || typeof globalThis.fetch !== 'function') {
    throw new Error('browser: Node 22 or later is required for native WebSocket and fetch');
  }
  const edge = await findEdge(options.edge);
  const pagePath = options.pagePath || path.join(ROOT, 'out', 'index.html');
  const page = await fs.readFile(pagePath).catch((error) => {
    throw new Error('browser: cannot read ' + pagePath + '; run npm run page first: ' + error.message);
  });
  const timeoutMs = options.timeoutMs ?? 60000;
  const controller = new AbortController(), { signal } = controller;
  const timer = setTimeout(() => controller.abort(new Error('browser: timed out after ' + timeoutMs + ' ms')), timeoutMs);
  const interrupt = () => controller.abort(new Error('browser: interrupted'));
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  let server, profile, child, exited, client, report, failure;
  let phase = 'startup', browserLog = '';
  const errors = [];
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
    let target;
    while (!target) {
      const response = await fetch(endpoint + '/json/list', { signal });
      if (!response.ok) throw new Error('browser: target discovery returned HTTP ' + response.status);
      target = (await response.json()).find((item) => item.type === 'page' && item.url === 'about:blank');
      if (!target) await delay(50, undefined, { signal });
    }
    phase = 'CDP connection';
    client = await connectCDP(target.webSocketDebuggerUrl, signal);
    client.onEvent((event) => {
      if (event.method === 'Runtime.exceptionThrown') {
        const details = event.params.exceptionDetails;
        errors.push(details.exception?.description || details.text);
      } else if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') {
        errors.push('console.error: ' + event.params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(' '));
      }
    });
    await client.send('Runtime.enable');
    await client.send('Page.enable');
    phase = 'page navigation';
    const navigation = await client.send('Page.navigate', { url: server.url });
    if (navigation.errorText) throw new Error('browser: navigation failed: ' + navigation.errorText);
    while (true) {
      if (errors.length) throw new Error('browser: page errors:\n' + errors.join('\n'));
      try {
        if (await evaluate(client, 'document.readyState === "complete" && !!window.__artifex')) break;
      } catch (error) {
        if (!/Cannot find context|Execution context was destroyed/.test(error.message)) throw error;
      }
      await delay(50, undefined, { signal });
    }
    const names = await evaluate(client, 'window.__artifex.names');
    if (!Array.isArray(names) || !names.length) throw new Error('browser: no registered examples');
    const pieces = [];
    for (const name of names) {
      phase = 'example ' + name;
      pieces.push(await evaluate(client, '(' + inspectPiece.toString() + ')(' + JSON.stringify(name) + ')'));
    }
    phase = 'film export';
    const film = await evaluate(client, '(' + inspectFilm.toString() + ')()');
    if (errors.length) throw new Error('browser: page errors:\n' + errors.join('\n'));
    report = { browser: version.Browser, mode: options.headed ? 'headed' : 'headless', pieces, film, errors };
  } catch (error) {
    failure = new Error((signal.aborted ? signal.reason.message : error.message) + ' during ' + phase);
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
      try {
        const tempRoot = await fs.realpath(os.tmpdir());
        const relative = path.relative(tempRoot, path.resolve(profile));
        if (!/^artifex-browser-[^/\\]+$/.test(relative)) throw new Error('refusing cleanup outside the owned temporary profile');
        await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch (error) { cleanupErrors.push('profile ' + profile + ': ' + error.message); }
    }
    if (cleanupErrors.length) failure = new Error((failure ? failure.message + '\n' : '') + 'browser: cleanup failed: ' + cleanupErrors.join('; '));
  }
  if (failure) throw failure;
  return report;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(USAGE); return; }
  const report = await runBrowserCheck(options);
  console.log(JSON.stringify(report, null, 2));
  const film = report.film
    ? '; film ' + report.film.name + ' offered as MP4 with WebM hidden, exported ' + report.film.frames + ' frames' + (report.film.sound ? ' with sound' : '') + ' and decoded'
    : '; no example has a timeline, so no film was exported';
  console.log('browser: ' + report.pieces.length + ' examples passed' + film + '; owned browser, server and profile cleaned up');
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { parseArgs, findEdge, connectCDP, evaluate, servePage, inspectPiece, inspectFilm, runBrowserCheck };
