#!/usr/bin/env node
'use strict';

// Check the built site, out/site/, in installed Edge, through the browser
// check's own lifecycle (withEdge: a unique temporary profile, only the owned
// Edge stopped, only its profile removed). The site is served by the builder's
// loopback server. Run `npm run site` first.
//
// On each of the two references, desktop (1280 x 800 at DPR 1) and slow (390 x
// 844 at DPR 3, a 1170-pixel canvas, 4x CPU throttling), native wheel events
// scroll the whole film forward one frame at a time, and the check requires:
// a measuring sink that waits for rasterization (calibrated first on a heavy
// frame); no page errors; every shot drawn; as many draws as distinct frames, besides
// one redraw of the same frame after each scale change; at most two canvases;
// no scroll write, no preventDefault on wheel, touch, scroll or keys, and no
// listener for them that is not passive; and each shot's p95 draw time, forced
// to rasterize, within its tier's budget, over its draws after the cold one
// that follows a load, a new solve or a scale change (reported apart). Then reduced motion must
// show every shot as a still and draw nothing on scroll; with the canvas
// transfer taken away, the worker-tier shot must draw on the main thread; and
// a recipe URL must open its shot, frame and seed; "Play as film" must
// scroll at the site's rate until a key stops it; and the stage's exports must
// carry their recipes (see exporting).

const fs = require('node:fs');
const path = require('node:path');
const { withEdge, evaluate, evaluateInPieces, waitFor, FORCED } = require('./check-browser.js');
const { manifestOf } = require('./replay.js');
const { serveSite, OUT } = require('./build-site.js');
const { shots: cut } = require('../core/time.js');
const { frameOf, p95 } = require('../site/stage.js');

const USAGE = 'usage: node tools/check-site.js [--edge PATH] [--timeout-ms 300000] [--headed]';

// The references and budgets of the site's frame budget (docs/knowledge/site.md):
// a shot drawn per frame, and a still redrawn on change.
const REFERENCES = [
  { name: 'desktop', width: 1280, height: 800, dpr: 1, cpu: 1, frameMs: 12, changeMs: 100 },
  { name: 'slow', width: 390, height: 844, dpr: 3, cpu: 4, frameMs: 33, changeMs: 300 },
];

function parseArgs(args) {
  const options = { timeoutMs: 300000, headed: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--headed') options.headed = true;
    else if (args[i] === '--edge' && args[i + 1] && !args[i + 1].startsWith('--')) options.edge = args[++i];
    else if (args[i] === '--timeout-ms' && /^\d+$/.test(args[i + 1] || '') && Number(args[i + 1]) >= 1000) options.timeoutMs = Number(args[++i]);
    else throw new Error(USAGE);
  }
  return options;
}

// Installed before the page's first script: every way a page could take the
// scroll from the visitor.
function probe() {
  const log = window.__probe = { writes: [], prevented: [], active: [] };
  const watched = /^(wheel|mousewheel|touchstart|touchmove|scroll|keydown)$/;
  const wrap = (owner, name) => {
    const original = owner[name];
    owner[name] = function () { log.writes.push(name); return original.apply(this, arguments); };
  };
  ['scrollTo', 'scrollBy', 'scroll'].forEach((name) => { wrap(window, name); wrap(Element.prototype, name); });
  wrap(Element.prototype, 'scrollIntoView');
  for (const name of ['scrollTop', 'scrollLeft']) {
    const d = Object.getOwnPropertyDescriptor(Element.prototype, name);
    Object.defineProperty(Element.prototype, name, { get() { return d.get.call(this); }, set(v) { log.writes.push(name); d.set.call(this, v); }, configurable: true });
  }
  const add = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (watched.test(type) && !(options && options.passive)) log.active.push(type);
    return add.call(this, type, listener, options);
  };
  const prevent = Event.prototype.preventDefault;
  Event.prototype.preventDefault = function () {
    if (watched.test(this.type)) log.prevented.push(this.type);
    return prevent.call(this);
  };
}

// Taken away for the fallback run: the worker route then cannot start.
function noTransfer() {
  delete HTMLCanvasElement.prototype.transferControlToOffscreen;
}

// Drawn in the page, on a canvas the size of the stage's: a frame whose drawing
// calls are few and whose rasterization is heavy (one long wide stroke), timed
// without forcing (the calls alone), forced by the stage's own force(), and
// forced by copying a pixel into a canvas kept for reading, which copies the
// whole frame to the CPU and so cannot finish before the frame is drawn.
async function sinkFrames(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const copy = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true });
  const heavy = (i) => {
    g.fillStyle = '#eee'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(20, 30, 90, 0.6)'; g.lineWidth = 3; g.lineJoin = 'round';
    g.beginPath();
    for (let k = 0; k < 4000; k++) { const a = k * 0.37 + i * 0.01; g.lineTo(w / 2 + Math.cos(a) * (k % (w / 2)), h / 2 + Math.sin(a * 1.3) * (k % (h / 2))); }
    g.stroke();
  };
  const ways = { none: () => {}, forced: () => __stage.force(c), copied: () => { copy.drawImage(c, 0, 0, 1, 1, 0, 0, 1, 1); copy.getImageData(0, 0, 1, 1); } };
  const out = { none: [], forced: [], copied: [] };
  for (let i = 0; i < 18; i++) {
    const way = Object.keys(ways)[i % 3];
    await new Promise((r) => requestAnimationFrame(r));
    const a = performance.now();
    heavy(i);
    ways[way]();
    out[way].push(performance.now() - a);
    // Whatever the frame left unrasterized is finished before the next one is timed.
    ways.copied();
  }
  return out;
}

/**
 * Whether the stage's sink waits for rasterization, from sinkFrames' times:
 * forced, the heavy frame must cost at least half what the whole-frame copy
 * shows and three times its drawing calls alone. A sink that stopped waiting
 * would measure the calls alone and let every shot pass fast.
 */
function sinkWaits(times) {
  const med = (xs) => xs.slice().sort((a, b) => a - b)[xs.length >> 1];
  const out = { noneMs: +med(times.none).toFixed(2), forcedMs: +med(times.forced).toFixed(2), copiedMs: +med(times.copied).toFixed(2) };
  if (out.forcedMs < out.copiedMs / 2 || out.forcedMs < 3 * out.noneMs) out.failure = 'the measuring sink does not wait for rasterization: a heavy frame measured ' + out.forcedMs + ' ms forced, ' + out.copiedMs + ' ms copied whole and ' + out.noneMs + ' ms unforced';
  return out;
}

const SETTLE = 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))';

async function wheel(client, view, deltaY) {
  await client.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.round(view.width / 2), y: Math.round(view.height / 2), deltaX: 0, deltaY });
  await evaluate(client, SETTLE);
}

async function open(client, context, view, url) {
  await client.send('Emulation.setDeviceMetricsOverride', { width: view.width, height: view.height, deviceScaleFactor: view.dpr, mobile: false });
  await client.send('Emulation.setCPUThrottlingRate', { rate: view.cpu });
  await client.send('Page.navigate', { url });
  await waitFor(client, context, 'document.readyState === "complete" && !!window.__stage && __stage.ready');
}

/**
 * Draws against distinct frames: `redraws` are draws of the frame a shot
 * drew last, at another scale, each allowed once after the scale change it
 * follows; `extra` are any other draws of a frame already drawn.
 */
function countDraws(entries) {
  const seen = new Set(), last = new Map();
  let redraws = 0, extra = 0;
  for (const e of entries) {
    const key = e.shot + '|' + e.frame + '|' + e.seed, before = last.get(e.shot);
    if (!seen.has(key)) seen.add(key);
    else if (before && before.key === key && before.scale !== e.scale) redraws++;
    else extra++;
    last.set(e.shot, { key, scale: e.scale });
  }
  return { distinct: seen.size, redraws, extra };
}

/** The shots each draw belongs to, and what a forward walk must hold. */
function judgeWalk(view, shots, entries, samples, probeLog) {
  const failures = [];
  const count = countDraws(entries);
  if (count.extra) failures.push(view.name + ': ' + entries.length + ' draws for ' + count.distinct + ' distinct frames and ' + count.redraws + ' redraws after a scale change');
  const perShot = shots.map((s, i) => {
    const mine = entries.filter((e) => e.shot === i);
    if (!mine.length) { failures.push(view.name + ': shot ' + s.name + ' was never drawn'); return { shot: s.name, draws: 0 }; }
    const where = [...new Set(mine.map((e) => e.where))];
    // The budget holds at the scale the shot settled on; a worker-tier shot is off the main thread.
    // A cold draw, the first after a load, a new solve or a scale change, is reported, not judged.
    const scale = mine[mine.length - 1].scale;
    const main = mine.filter((e) => e.where === 'main' && e.scale === scale && !e.cold).map((e) => e.ms);
    const limit = s.tier === 'frame' ? view.frameMs : view.changeMs;
    const out = { shot: s.name, tier: s.tier, where, draws: mine.length, warm: mine.filter((e) => e.warm).length, scale, width: mine[mine.length - 1].w,
      p95Ms: main.length ? p95(main) : null, maxMs: Math.max(...mine.map((e) => e.ms)), budgetMs: s.tier === 'worker' ? null : limit,
      cold: mine.filter((e) => e.cold).map((e) => ({ frame: e.frame, ms: e.ms, scale: e.scale, warm: e.warm })) };
    if (s.tier !== 'worker' && main.length && out.p95Ms > limit) failures.push(view.name + ': shot ' + s.name + ' p95 ' + out.p95Ms + ' ms over its ' + limit + ' ms budget');
    return out;
  });
  const canvases = Math.max(...samples);
  if (canvases > 2) failures.push(view.name + ': ' + canvases + ' canvases at once');
  if (probeLog.writes.length) failures.push(view.name + ': the page wrote the scroll: ' + probeLog.writes.join(', '));
  if (probeLog.prevented.length) failures.push(view.name + ': preventDefault on ' + probeLog.prevented.join(', '));
  if (probeLog.active.length) failures.push(view.name + ': listeners that are not passive: ' + probeLog.active.join(', '));
  return { failures, perShot, canvases, draws: entries.length, distinct: count.distinct, redraws: count.redraws };
}

/** Scroll the whole film forward by native wheel, one frame of scroll per event. */
async function walk(client, context, view, base, shots) {
  context.phase = view.name + ' walk';
  await open(client, context, view, base + '?measure=1');
  const start = await evaluate(client, '({ px: __stage.px, frames: __stage.frames, draws: __stage.draws, canvas: document.querySelectorAll("canvas").length })');
  const sink = sinkWaits(await evaluate(client, '(' + sinkFrames + ')(...(({ width, height }) => [width, height])(document.querySelector("#stage canvas:not([hidden])")))'));
  // Wheel steps too small to reach the next frame must not draw.
  for (let i = 0; i < 3; i++) await wheel(client, view, 1);
  const tiny = await evaluate(client, '__stage.draws') - start.draws;
  await wheel(client, view, -3);
  const from = await evaluate(client, '__stage.log.length');
  const step = Math.max(1, Math.round(start.px));
  const samples = [start.canvas];
  for (let moved = 0; moved < (start.frames - 1) * start.px + step; moved += step) {
    await wheel(client, view, step);
    samples.push(await evaluate(client, 'document.querySelectorAll("canvas").length'));
  }
  // A draw still in the worker lands after the last step.
  await evaluate(client, 'new Promise((r) => setTimeout(r, 300))');
  const end = await evaluate(client, '({ log: __stage.log.slice(' + from + '), frame: __stage.frame, lowered: __stage.lowered, worker: __stage.worker, probe: window.__probe, held: window.__held || null })');
  const verdict = judgeWalk(view, shots, end.log, samples, end.probe);
  if (sink.failure) verdict.failures.push(view.name + ': ' + sink.failure);
  if (tiny) verdict.failures.push(view.name + ': ' + tiny + ' draws from wheel steps that did not reach a new frame');
  if (end.frame !== start.frames - 1) verdict.failures.push(view.name + ': the walk ended on frame ' + end.frame + ', not the last, ' + (start.frames - 1));
  if (context.errors.length) verdict.failures.push(view.name + ': page errors: ' + context.errors.join('; '));
  // The copies site/pieces/held.js keeps on the main thread at the walk's end, and the most pixels they held at once.
  const kept = end.held && { copies: end.held.copies, megapixels: +(end.held.pixels / 1e6).toFixed(1), peakMegapixels: +(end.held.peak / 1e6).toFixed(1) };
  return { view: view.name, pxPerFrame: +start.px.toFixed(2), lastFrame: end.frame, lowered: end.lowered, worker: end.worker, kept, sink, ...verdict };
}

async function reduced(client, context, base, shots) {
  context.phase = 'reduced motion';
  const view = REFERENCES[0];
  await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await open(client, context, view, base);
  for (let i = 0; i < 40; i++) await wheel(client, view, 240);
  const expected = shots.filter((s) => !s.seam).length;
  await waitFor(client, context, '__stage.stills >= ' + expected);
  const state = await evaluate(client, `(() => ({
    mode: __stage.mode, draws: __stage.draws,
    stage: getComputedStyle(document.getElementById('stage')).display,
    seams: [...document.querySelectorAll('.shot.seam')].map((s) => getComputedStyle(s).display),
    stills: [...document.querySelectorAll('.still img')].map((img) => ({ alt: img.alt, width: img.naturalWidth, complete: img.complete })),
    probe: window.__probe,
  }))()`);
  const failures = [];
  if (state.mode !== 'stills') failures.push('reduced motion: mode ' + state.mode);
  if (state.draws) failures.push('reduced motion: ' + state.draws + ' film draws on scroll');
  if (state.stage !== 'none') failures.push('reduced motion: the stage is shown');
  if (state.seams.some((d) => d !== 'none')) failures.push('reduced motion: a seam is shown');
  if (state.stills.length !== expected || state.stills.some((s) => !s.complete || !s.width || !s.alt)) failures.push('reduced motion: ' + JSON.stringify(state.stills));
  if (state.probe.writes.length) failures.push('reduced motion: the page wrote the scroll: ' + state.probe.writes.join(', '));
  // The preference changes back without a reload, and the film returns.
  await client.send('Emulation.setEmulatedMedia', { features: [] });
  await waitFor(client, context, '__stage.mode === "film" && __stage.draws > 0');
  if (context.errors.length) failures.push('reduced motion: page errors: ' + context.errors.join('; '));
  return { stills: state.stills, failures };
}

async function fallback(client, context, base, shots) {
  context.phase = 'worker fallback';
  const view = REFERENCES[0];
  const { identifier } = await client.send('Page.addScriptToEvaluateOnNewDocument', { source: '(' + noTransfer + ')();' });
  await open(client, context, view, base);
  const { px, frames } = await evaluate(client, '({ px: __stage.px, frames: __stage.frames })');
  for (let moved = 0; moved < frames * px; moved += 8 * px) await wheel(client, view, Math.round(8 * px));
  const worker = shots.findIndex((s) => s.tier === 'worker');
  await waitFor(client, context, '__stage.log.some((e) => e.shot === ' + worker + ')');
  const state = await evaluate(client, '({ worker: __stage.worker, where: [...new Set(__stage.log.filter((e) => e.shot === ' + worker + ').map((e) => e.where))] })');
  await client.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  const failures = [];
  if (state.worker !== 'unavailable' || state.where.join() !== 'main') failures.push('fallback: ' + JSON.stringify(state));
  if (context.errors.length) failures.push('fallback: page errors: ' + context.errors.join('; '));
  return { ...state, failures };
}

async function recipe(client, context, base, shots, data) {
  context.phase = 'recipe';
  const view = REFERENCES[0];
  const i = Math.min(1, shots.length - 1), t = 0.5, seed = 7;
  await open(client, context, view, base + '?shot=' + shots[i].name + '&t=' + t + '&seed=' + seed);
  // The recipe's shot has loaded once the stage is ready, and its timeline decides the frame.
  const time = await evaluate(client, '__require("check")(' + JSON.stringify(shots[i].id) + ').time || null');
  const film = cut(shots.map((s) => [s.name, s.seconds]), { hz: data.hz, frames: data.frames });
  const expected = frameOf(film[i], t, time);
  await waitFor(client, context, '__stage.frame === ' + expected + ' && __stage.log.some((e) => e.site === ' + expected + ' && !e.warm)');
  await evaluate(client, 'new Promise((r) => setTimeout(r, 600))');
  const state = await evaluate(client, '({ shot: __stage.shot, seed: __stage.seed, frame: __stage.frame, writes: __stage.writes, probe: window.__probe.writes, search: location.search })');
  const failures = [];
  const wantSearch = new URLSearchParams(state.search);
  if (state.shot !== shots[i].name || state.seed !== seed || state.frame !== expected) failures.push('recipe: opened ' + JSON.stringify(state));
  if (state.writes.join() !== 'recipe' || state.probe.length !== 1) failures.push('recipe: scroll writes ' + JSON.stringify(state.writes) + ', probe ' + JSON.stringify(state.probe));
  if (wantSearch.get('shot') !== shots[i].name || wantSearch.get('seed') !== String(seed)) failures.push('recipe: the address bar reads ' + state.search);
  if (context.errors.length) failures.push('recipe: page errors: ' + context.errors.join('; '));
  return { expectedFrame: expected, ...state, failures };
}

// "Play as film" scrolls at the site's rate from where it stands, and a key stops it.
async function play(client, context, base, data) {
  context.phase = 'play as film';
  const view = REFERENCES[0];
  await open(client, context, view, base);
  const start = await evaluate(client, 'document.getElementById("play").click(), performance.now()');
  await evaluate(client, 'new Promise((r) => setTimeout(r, 1000))');
  const during = await evaluate(client, '({ frame: __stage.frame, at: performance.now(), pressed: document.getElementById("play").getAttribute("aria-pressed") })');
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Shift', code: 'ShiftLeft' });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Shift', code: 'ShiftLeft' });
  await evaluate(client, 'new Promise((r) => setTimeout(r, 300))');
  const after = await evaluate(client, '({ frame: __stage.frame, writes: __stage.writes, pressed: document.getElementById("play").getAttribute("aria-pressed") })');
  await evaluate(client, 'new Promise((r) => setTimeout(r, 300))');
  const still = await evaluate(client, '__stage.frame');
  const expected = Math.floor((during.at - start) * data.hz / 1000);
  const failures = [];
  // Frames are taken on animation frames, so the film may trail the clock by a few.
  if (during.pressed !== 'true' || during.frame > expected + 1 || during.frame < expected - 6) failures.push('play: frame ' + during.frame + ' after ' + Math.round(during.at - start) + ' ms, expected about ' + expected);
  if (after.pressed !== 'false' || still !== after.frame) failures.push('play: a key did not stop the film: ' + JSON.stringify(after) + ', then frame ' + still);
  if (after.writes[0] !== 'play' || after.writes.length !== 1) failures.push('play: writes ' + JSON.stringify(after.writes));
  if (context.errors.length) failures.push('play: page errors: ' + context.errors.join('; '));
  return { frameAfterOneSecond: during.frame, expected, stoppedAt: after.frame, failures };
}

/**
 * The stage's exports, of the shot and frame a recipe URL opens: exports.js
 * is not loaded until a file is asked for; a PNG at 1x, read in Node, names
 * the recipe the address bar names at scale 1 and has the piece's size; one at
 * 8x has eight times the size and names scale 8; an SVG of a raster-only
 * piece is refused by name; the film on offer is the MP4, and its bytes, read
 * in Node, name the recipe and every frame. With H.264 refused, the offer is
 * the WebM, for that reason.
 */
async function exporting(client, context, base, shots) {
  context.phase = 'exports';
  const view = REFERENCES[0];
  // A timed shot, the first of 5 seconds or less when there is one, so its film exports quickly.
  const timed = shots.filter((x) => x.tier === 'frame');
  const s = timed.find((x) => x.seconds <= 5) || timed[0], seed = 7;
  const failures = [];
  const fail = (what) => failures.push('exports: ' + what);
  await open(client, context, view, base + '?shot=' + s.name + '&t=0.5&seed=' + seed);
  // The stage writes the recipe back, its playhead to four places, once the scroll rests.
  await waitFor(client, context, '/[?&]t=\\d\\.\\d{4}(&|$)/.test(location.search)');
  const before = await evaluate(client, '({ defined: typeof __mods["core/export.js"], fetched: performance.getEntriesByType("resource").some((e) => /exports\\.js$/.test(e.name)), search: location.search, piece: __require("check")(' + JSON.stringify(s.id) + '), frames: __require("check")("core/render.js").playheads(__require("check")(' + JSON.stringify(s.id) + ')).length })');
  if (before.defined !== 'undefined' || before.fetched) fail('exports.js was loaded before a file was asked for');
  const q = new URLSearchParams(before.search), size = before.piece.size;
  const bytes = (b64) => new Uint8Array(Buffer.from(b64, 'base64'));
  const encode = 'async (f) => { const b = new Uint8Array(await f.blob.arrayBuffer()); let s = ""; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768)); return { name: f.name, b64: btoa(s) }; }';
  const recipeOf = (m) => m && { piece: m.piece, seed: m.seed, t: m.t };
  const want = { piece: before.piece.name, seed, t: Number(q.get('t')) };
  const near = (m) => m && m.piece === want.piece && m.seed === want.seed && Math.abs(m.t - want.t) < 1e-4;

  const png = await evaluateInPieces(client, '__stage.exports.file("png").then(' + encode + ')');
  const pngBytes = bytes(png.b64), view32 = new DataView(pngBytes.buffer);
  const pngManifest = manifestOf(pngBytes, png.name).manifest;
  if (!near(pngManifest) || pngManifest.scale !== 1) fail('the 1x PNG names ' + JSON.stringify(recipeOf(pngManifest)) + ' at scale ' + pngManifest.scale + ', not ' + JSON.stringify(want));
  if (view32.getUint32(16) !== size.w || view32.getUint32(20) !== size.h) fail('the 1x PNG is ' + view32.getUint32(16) + ' x ' + view32.getUint32(20) + ', not ' + size.w + ' x ' + size.h);
  const after = await evaluate(client, '({ defined: typeof __mods["core/export.js"], fetched: performance.getEntriesByType("resource").some((e) => /exports\\.js$/.test(e.name)) })');
  if (after.defined !== 'function' || !after.fetched) fail('exports.js was not loaded for the export: ' + JSON.stringify(after));
  const big = await evaluate(client, '__stage.exports.file("png", { scale: 8 }).then(async (f) => { const b = new Uint8Array(await f.blob.arrayBuffer()), d = new DataView(b.buffer); const E = await __stage.exports.module(); return { name: f.name, w: d.getUint32(16), h: d.getUint32(20), scale: E.pngManifest(b).scale }; })');
  if (big.w !== size.w * 8 || big.h !== size.h * 8 || big.scale !== 8) fail('the 8x PNG is ' + JSON.stringify(big));
  const svg = await evaluate(client, '__stage.exports.file("svg").then(() => "saved", (e) => e.message)');
  if (!/declares raster only, so it has no SVG/.test(svg)) fail('an SVG of a raster-only piece: ' + svg);

  const offer = await evaluate(client, '__stage.exports.offer()');
  if (offer.format !== 'mp4') fail('the film on offer is ' + JSON.stringify(offer) + ', not the MP4');
  const film = await evaluateInPieces(client, '__stage.exports.file("film", { scale: 1 }).then(async (r) => Object.assign(await (' + encode + ')(r), { frames: r.frames, conversion: r.conversion }))');
  const filmManifest = manifestOf(bytes(film.b64), film.name).manifest;
  const frames = before.frames;
  // A film names every frame, so no playhead.
  if (filmManifest.piece !== want.piece || filmManifest.seed !== seed || 't' in filmManifest || !filmManifest.film || filmManifest.film.frames !== frames || filmManifest.film.scale !== 1 || film.frames !== frames) {
    fail('the film ' + film.name + ' names ' + JSON.stringify(filmManifest && { ...recipeOf(filmManifest), film: filmManifest.film }) + ' and holds ' + film.frames + ' frames, not ' + frames);
  }
  if (context.errors.length) fail('page errors: ' + context.errors.join('; '));

  const { identifier } = await client.send('Page.addScriptToEvaluateOnNewDocument', { source: '(' + FORCED['no-h264'].install + ')();' });
  await open(client, context, view, base + '?shot=' + s.name + '&t=0.5&seed=' + seed);
  const refused = await evaluate(client, '__stage.exports.offer()');
  await client.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  if (refused.format !== 'webm' || refused.reason !== 'h264') fail('with H.264 refused the film on offer is ' + JSON.stringify(refused));
  if (context.errors.length) fail('page errors: ' + context.errors.join('; '));
  return { shot: s.name, png: { name: png.name, bytes: pngBytes.length }, png8: big, svg, offer, film: { name: film.name, frames: film.frames, conversion: film.conversion }, withoutH264: refused, failures };
}

async function runSiteCheck(options = {}) {
  const dir = options.dir || OUT;
  const file = path.join(dir, 'data.js');
  if (!fs.existsSync(file)) throw new Error('site: ' + file + ' not found; run npm run site first');
  const data = JSON.parse(/^window\.__siteData = (.*);$/m.exec(fs.readFileSync(file, 'utf8'))[1]);
  const shots = data.shots;
  const server = await serveSite(dir);
  try {
    return await withEdge('<!doctype html><title>site check</title>', options, async (client, context) => {
      await client.send('Page.addScriptToEvaluateOnNewDocument', { source: '(' + probe + ')();' });
      const report = { browser: context.version && context.version.Browser, frames: data.frames, hz: data.hz, shots: shots.map((s) => s.name) };
      report.walks = [];
      for (const view of REFERENCES) report.walks.push(await walk(client, context, view, server.url, shots));
      await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      report.reduced = await reduced(client, context, server.url, shots);
      report.fallback = await fallback(client, context, server.url, shots);
      report.recipe = await recipe(client, context, server.url, shots, data);
      report.play = await play(client, context, server.url, data);
      report.exports = await exporting(client, context, server.url, shots);
      report.failures = [...report.walks.flatMap((w) => w.failures), ...report.reduced.failures, ...report.fallback.failures, ...report.recipe.failures, ...report.play.failures, ...report.exports.failures];
      return report;
    });
  } finally {
    await server.close();
  }
}

async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  let report, failure;
  try { report = await runSiteCheck(options); } catch (error) { failure = error; report = error.report; }
  if (report) {
    console.log(JSON.stringify(report, null, 2));
    const walks = report.walks.map((w) => w.view + ' ' + w.draws + ' draws of ' + w.distinct + ' distinct frames'
      + (w.redraws ? ' and ' + w.redraws + ' redraws after a scale change' : '') + ', p95 '
      + w.perShot.map((s) => s.shot + ' ' + (s.p95Ms === null ? 'in worker' : s.p95Ms + ' ms')).join(', ')
      + (w.kept ? ', kept ' + w.kept.copies + ' copies, peak ' + w.kept.peakMegapixels + ' Mpx' : '')).join('; ');
    console.log('site: ' + (report.failures.length ? report.failures.length + ' failed: ' + report.failures.join('; ') : 'passed') + '; ' + walks
      + (failure ? '; cleanup failed' : '; owned browser, server and profile cleaned up'));
    if (report.failures.length && !failure) failure = new Error('site: ' + report.failures.length + ' check(s) failed');
  }
  if (failure) throw failure;
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { parseArgs, countDraws, judgeWalk, sinkWaits, runSiteCheck, main, REFERENCES, probe };
