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
// scroll at the site's rate until a key stops it; no audio may start before
// the visitor presses Listen, and then every shot's soundtrack must render the
// same bits twice and play within one frame of the picture (see listening);
// and the stage's exports must carry their recipes (see exporting).

const fs = require('node:fs');
const path = require('node:path');
const { withEdge, evaluate, evaluateInPieces, waitFor: waitUntil, FORCED, timeoutArg } = require('./check-browser.js');

// One wait may take this long, well under the run's deadline, so a state the
// page never reaches is refused with the phase and the expression waited for
// while the phases already finished stay in the report.
const WAIT_MS = 120000;
const waitFor = (client, context, expression) => waitUntil(client, context, expression, context.waitMs ?? WAIT_MS);
const { manifestOf } = require('./replay.js');
const { serveSite, OUT } = require('./build-site.js');
const { shots: cut } = require('../core/time.js');
// Loaded on use, so --help and argument checks run without the site's modules.
const stage = () => require('../site/stage.js');

const USAGE = 'usage: node tools/check-site.js [--edge PATH] [--timeout-ms N] [--headed]';

// Without --timeout-ms the deadline grows with the film: both walks go over
// every frame, and under load took about 80 ms a frame together.
const deadline = (frames) => Math.max(300000, frames * 250);

// The references and budgets of the site's frame budget (docs/knowledge/site.md):
// a shot drawn per frame, and a still redrawn on change.
const REFERENCES = [
  { name: 'desktop', width: 1280, height: 800, dpr: 1, cpu: 1, frameMs: 12, changeMs: 100 },
  { name: 'slow', width: 390, height: 844, dpr: 3, cpu: 4, frameMs: 33, changeMs: 300 },
];
// A shot's own frame budget where it is over its reference's: the portal's
// steady draws fit 12 ms alone and read 12.2 to 12.7 ms beside another browser.
const FRAME_MS = { portal: 14 };
// The longest the desktop reference's picture may stop while "Play as film"
// with Listen on crosses a join whose soundtrack is built as it plays.
const PLAY_GAP_MS = 200;

function parseArgs(args) {
  const options = { timeoutMs: null, headed: false };
  const refuse = (cause) => new Error('site check: ' + cause + '\n' + USAGE);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--headed') options.headed = true;
    else if (args[i] === '--edge') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw refuse('--edge needs the path to msedge');
      options.edge = args[++i];
    }
    else if (args[i] === '--timeout-ms') options.timeoutMs = timeoutArg(args[++i] ?? 'nothing', refuse, { min: 1000, max: 2147483647, fallback: '250 a frame, 300000 at least' });
    else throw refuse('unknown option ' + args[i]);
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
  // Every audio context the page makes, and every buffer a live one starts:
  // when, how far in, and the audio and page clocks at the call.
  const audio = log.audio = { contexts: 0, offline: 0, starts: [] }, live = [];
  const counted = (name, key, keep) => {
    const Original = window[name];
    if (typeof Original !== 'function') return null;
    window[name] = function () { const c = new Original(...arguments); audio[key]++; if (keep) live.push(c); return c; };
    window[name].prototype = Original.prototype;
    return Original;
  };
  const Live = counted('AudioContext', 'contexts', true);
  counted('OfflineAudioContext', 'offline', false);
  if (Live) {
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when = 0, offset = 0) {
      if (this.context instanceof Live) audio.starts.push({ when, offset, now: this.context.currentTime, perf: performance.now() });
      return start.apply(this, arguments);
    };
  }
  // The live context's clocks, read together: what it is playing out now, against the page's clock.
  window.__probeClock = () => {
    const c = live[0], ts = c.getOutputTimestamp();
    return { state: c.state, contextTime: ts.contextTime, performanceTime: ts.performanceTime, currentTime: c.currentTime, perf: performance.now(), outputLatency: c.outputLatency || 0, baseLatency: c.baseLatency || 0 };
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
  const failures = [], { p95 } = stage();
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
    const limit = s.tier === 'frame' ? Math.max(view.frameMs, FRAME_MS[s.name] || 0) : view.changeMs;
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
  if (probeLog.audio && (probeLog.audio.contexts || probeLog.audio.offline)) failures.push(view.name + ': audio without the visitor pressing Listen: ' + JSON.stringify({ contexts: probeLog.audio.contexts, offline: probeLog.audio.offline }));
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
  // Far enough down the page to bring every still near the viewport, however many shots there are.
  const expected = shots.filter((s) => !s.seam).length;
  for (let i = 0; i < Math.max(40, 4 * expected); i++) await wheel(client, view, 240);
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
  // The walk skims and rests on the last shot: a worker-tier shot drawn on the main thread draws once the scroll rests.
  const worker = shots.findLastIndex((s) => s.tier === 'worker');
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
  const expected = stage().frameOf(film[i], t, time);
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
  const after = await evaluate(client, '({ frame: __stage.frame, writes: __stage.writes, pressed: document.getElementById("play").getAttribute("aria-pressed"), audio: window.__probe.audio })');
  await evaluate(client, 'new Promise((r) => setTimeout(r, 300))');
  const still = await evaluate(client, '__stage.frame');
  const expected = Math.floor((during.at - start) * data.hz / 1000);
  const failures = [];
  // Frames are taken on animation frames, so the film may trail the clock by a few.
  if (during.pressed !== 'true' || during.frame > expected + 1 || during.frame < expected - 6) failures.push('play: frame ' + during.frame + ' after ' + Math.round(during.at - start) + ' ms, expected about ' + expected);
  if (after.pressed !== 'false' || still !== after.frame) failures.push('play: a key did not stop the film: ' + JSON.stringify(after) + ', then frame ' + still);
  if (after.writes[0] !== 'play' || after.writes.length !== 1) failures.push('play: writes ' + JSON.stringify(after.writes));
  if (after.audio.contexts || after.audio.offline) failures.push('play: audio without the visitor pressing Listen: ' + JSON.stringify(after.audio));
  if (context.errors.length) failures.push('play: page errors: ' + context.errors.join('; '));
  return { frameAfterOneSecond: during.frame, expected, stoppedAt: after.frame, failures };
}

// Rendered twice in the page, each shot's soundtrack, or with `how`
// 'ambience' its ambience: its length, its peak and the first sample whose
// bits differ between the two renders, or null.
async function twice(names, how = 'render') {
  const out = [];
  for (const name of names) {
    const a = await __stage.listen[how](name);
    if (!a) continue;
    const b = await __stage.listen[how](name);
    let diff = null, peak = 0;
    for (let ch = 0; ch < a.numberOfChannels && !diff; ch++) {
      const x = a.getChannelData(ch), y = b.getChannelData(ch), xi = new Uint32Array(x.buffer, x.byteOffset, x.length), yi = new Uint32Array(y.buffer, y.byteOffset, y.length);
      if (x.length !== y.length) diff = { channel: ch, lengths: [x.length, y.length] };
      for (let i = 0; i < x.length && !diff; i++) {
        if (xi[i] !== yi[i]) diff = { channel: ch, sample: i, values: [x[i], y[i]] };
        peak = Math.max(peak, Math.abs(x[i]));
      }
    }
    out.push({ name, seconds: +a.duration.toFixed(3), channels: a.numberOfChannels, peakDb: peak ? +(20 * Math.log10(peak)).toFixed(1) : null, diff });
  }
  return out;
}

/**
 * Where "Play as film" had each drawn frame's soundtrack, against the frame:
 * `draws` ({ site, at }: the site frame and the page clock when it was drawn),
 * `starts` ({ when, offset, shot }: each soundtrack started, on the audio
 * clock), `clock` (one reading of the live context's clocks, from the probe)
 * and `film` (the resolved shot list). The audio heard at a draw is the
 * context's output time then; a draw's lag is how far the sound it was heard
 * with stood from the middle of its frame, in milliseconds. Draws before any
 * start of their shot are not judged.
 */
function syncLags(draws, starts, clock, film, hz) {
  const toAudio = clock.performanceTime > 0 ? (ms) => clock.contextTime + (ms - clock.performanceTime) / 1000 : (ms) => clock.currentTime - clock.outputLatency - clock.baseLatency + (ms - clock.perf) / 1000;
  const lags = [];
  for (const d of draws) {
    const cut = film.find((c) => d.site >= c.start && d.site < c.end), heard = toAudio(d.at);
    const s = starts.filter((x) => x.shot === cut.name && x.when <= heard).pop();
    if (!s) continue;
    const pos = s.offset + (heard - s.when), want = (d.site - cut.start + 0.5) / hz;
    lags.push({ shot: cut.name, site: d.site, lagMs: +((pos - want) * 1000).toFixed(1) });
  }
  return lags;
}

/**
 * Listen: the switch is hidden without Web Audio; with it, it is reached by
 * Tab, named, and pressing it by keyboard makes the only audio context and
 * says so in the status line. Two renders of every shot's soundtrack, and of
 * every ambience, hold the same bits. Scrolled, the first shot with an
 * ambience sounds it once settled, and scrolling forward, resting, going back
 * and skimming start, cut or scrub nothing; a shot with no ambience fades it,
 * and across a join between two shots with ambiences the second crossfades in
 * over the first. Played as film across a join between two shots with sound,
 * from far enough before it that the second's soundtrack is built as the film
 * plays, no ambience starts, the picture never stops for more than
 * PLAY_GAP_MS, and every frame is drawn within one frame of the sound
 * heard with it, each soundtrack started as the probe saw it started. Pressed
 * again, the switch fades the sound and says so.
 */
async function listening(client, context, base, shots, data) {
  context.phase = 'listen';
  const view = REFERENCES[0];
  const failures = [];
  const fail = (what) => failures.push('listen: ' + what);
  const quiet = await client.send('Page.addScriptToEvaluateOnNewDocument', { source: 'delete window.AudioContext;' });
  await open(client, context, view, base);
  const hidden = await evaluate(client, 'document.getElementById("listen").hidden');
  await client.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: quiet.identifier });
  if (!hidden) fail('the switch shows in a browser without Web Audio');

  const film = cut(shots.map((s) => [s.name, s.seconds]), { hz: data.hz, frames: data.frames }).map((c, i) => ({ name: shots[i].name, start: c.start, end: c.end }));
  await open(client, context, view, base);
  const renders = await evaluate(client, '(' + twice + ')(' + JSON.stringify(shots.map((s) => s.name)) + ')');
  for (const r of renders) {
    if (r.diff) fail(r.name + ': two renders of its soundtrack differ: ' + JSON.stringify(r.diff));
    if (r.peakDb === null) fail(r.name + ': its soundtrack is silent');
  }
  if (!renders.length) fail('no shot declares sound');
  const airs = await evaluate(client, '(' + twice + ')(' + JSON.stringify(shots.map((s) => s.name)) + ', "ambience")');
  for (const r of airs) {
    if (r.diff) fail(r.name + ': two renders of its ambience differ: ' + JSON.stringify(r.diff));
    if (r.peakDb === null) fail(r.name + ': its ambience is silent');
  }
  const heard = renders.map((r) => r.name), roomy = airs.map((r) => r.name);
  const before = await evaluate(client, 'window.__probe.audio.contexts');
  if (before) fail(before + ' audio contexts before the switch was pressed');

  // A join between two shots with sound, one between two shots with ambiences, and the first shot with an ambience.
  const join = film.findIndex((c, i) => i && heard.includes(c.name) && heard.includes(film[i - 1].name));
  const cross = film.findIndex((c, i) => i && roomy.includes(c.name) && roomy.includes(film[i - 1].name));
  const first = film.find((c) => roomy.includes(c.name));
  if (!first) fail('no shot carries an ambience');
  const press = async () => {
    await evaluate(client, 'document.getElementById("listen").focus()');
    await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await waitFor(client, context, '__stage.listen.on && __probeClock().state === "running"');
  };
  await open(client, context, view, base + '?shot=' + (first || film[0]).name + '&t=0');
  let tabs = 0;
  for (; tabs < 40; tabs++) {
    if (await evaluate(client, 'document.activeElement && document.activeElement.id') === 'listen') break;
    await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  }
  const name = await evaluate(client, '(() => { const b = document.getElementById("listen"); return { text: b.textContent.trim(), pressed: b.getAttribute("aria-pressed"), label: b.getAttribute("aria-label") }; })()');
  if (tabs >= 40) fail('Tab never reached the switch');
  if (name.text !== 'Listen' || name.pressed !== 'false') fail('the switch reads ' + JSON.stringify(name));
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await waitFor(client, context, 'window.__probe.audio.contexts === 1 && __probeClock().state === "running"');
  const on = await evaluate(client, '({ pressed: document.getElementById("listen").getAttribute("aria-pressed"), status: document.getElementById("status").textContent, role: document.getElementById("status").getAttribute("role") })');
  if (on.pressed !== 'true' || !/listening/.test(on.status) || on.role !== 'status') fail('pressed, the switch says ' + JSON.stringify(on));

  // Scrolled by native wheel steps at `speed` times real time (negative goes
  // back) for `ms`: the fewest and most ambiences and soundtracks sounding at once meanwhile.
  const px = await evaluate(client, '__stage.px');
  const listened = 'new Promise((r) => setTimeout(r, 16)).then(() => ({ ambient: __stage.listen.ambient, playing: __stage.listen.playing }))';
  const scroll = async (ms, speed) => {
    const t0 = Date.now(), seen = { least: Infinity, most: 0, playing: 0 };
    let moved = 0;
    while (Date.now() - t0 < ms) {
      const want = Math.round(((Date.now() - t0) / 1000) * data.hz * px * Math.abs(speed));
      if (want > moved) { await client.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 640, y: 400, deltaX: 0, deltaY: Math.sign(speed) * (want - moved) }); moved = want; }
      const now = await evaluate(client, listened);
      Object.assign(seen, { least: Math.min(seen.least, now.ambient), most: Math.max(seen.most, now.ambient), playing: Math.max(seen.playing, now.playing) });
    }
    return seen;
  };
  // Sampled at rest for `ms`, or until `done` (an expression) holds: the fewest
  // and most ambiences sounding at once meanwhile. An ambience is rendered once
  // its shot is near, which a loaded machine can slow, so an awaited state is
  // given up to `ms` rather than a fixed time.
  const rest = async (ms, done = 'false') => {
    const t0 = Date.now(), seen = { least: Infinity, most: 0, held: false };
    while (Date.now() - t0 < ms && !seen.held) {
      const now = await evaluate(client, listened);
      Object.assign(seen, { least: Math.min(seen.least, now.ambient), most: Math.max(seen.most, now.ambient), held: await evaluate(client, done) });
    }
    return seen;
  };
  const counts = '({ rooms: __stage.listen.rooms.length, starts: __stage.listen.starts.length, fades: __stage.listen.fades, ambient: __stage.listen.ambient, last: (__stage.listen.rooms[__stage.listen.rooms.length - 1] || {}).shot })';
  let roamed = null;
  if (first) {
    // Its ambience renders once the switch is on, and sounds once the shot has settled, with no scroll at all.
    await waitFor(client, context, '__stage.listen.ambient === 1 && __stage.listen.rooms.length === 1');
    const settled = await evaluate(client, counts);
    if (settled.last !== first.name) fail('pressed at ' + first.name + ', the ambience of ' + settled.last + ' started');
    // Forward at real time, a rest, back, then a skim at three times real time, all within the shot.
    const moves = [await scroll(1000, 1), await rest(600), await scroll(500, -1), await scroll(500, 3)];
    const after = await evaluate(client, counts);
    roamed = { settled, moves, after };
    if (after.rooms !== settled.rooms || after.starts !== settled.starts || after.fades !== settled.fades) fail('scrolled within ' + first.name + ', its sound was started, cut or faded: ' + JSON.stringify(roamed));
    if (moves.some((m) => m.least !== 1 || m.most !== 1 || m.playing)) fail('scrolled within ' + first.name + ', its ambience did not sound alone throughout: ' + JSON.stringify(roamed));
    // On into the next shot: settled there, a shot with no ambience fades it out over about a second; one with an ambience crossfades.
    const next = film[film.findIndex((c) => c.name === first.name) + 1], has = roomy.includes(next.name);
    // The moves above end two seconds into the shot: far enough from there to be half a second into the next one.
    const went = await scroll(Math.max(2000, ((first.end - first.start) / data.hz - 1.5) * 1000), 1);
    const onward = await rest(8000, has ? '__stage.listen.ambient === 1 && __stage.listen.rooms[__stage.listen.rooms.length - 1].shot === ' + JSON.stringify(next.name) : '__stage.listen.ambient === 0');
    const gone = await evaluate(client, counts);
    roamed.onward = { next: next.name, went, onward, gone };
    if (!onward.held || gone.last !== (has ? next.name : first.name) || Math.max(went.most, onward.most) > 2 || went.playing) fail('scrolled on into ' + next.name + ', the ambiences left ' + JSON.stringify(roamed.onward));
  }

  // Across a join between two shots with ambiences, scrolled at real time: the second crossfades in over the first, then sounds alone.
  let crossed = null;
  if (cross <= 0) fail('no two shots with ambiences meet, so no crossfade was scrolled');
  else {
    const [a, b] = [film[cross - 1], film[cross]];
    const at = Math.max(0, 1 - 1.5 * data.hz / (a.end - a.start - 1));
    await open(client, context, view, base + '?shot=' + a.name + '&t=' + at.toFixed(4));
    await press();
    await waitFor(client, context, '__stage.listen.ambient === 1 && (__stage.listen.rooms[__stage.listen.rooms.length - 1] || {}).shot === ' + JSON.stringify(a.name));
    const over = await scroll(2500, 1);
    const then = await rest(8000, '__stage.listen.ambient === 1 && __stage.listen.rooms[__stage.listen.rooms.length - 1].shot === ' + JSON.stringify(b.name));
    const end = await evaluate(client, counts);
    crossed = { from: a.name, to: b.name, most: Math.max(over.most, then.most), held: then.held, end };
    if (crossed.most !== 2 || !then.held || end.last !== b.name || over.playing) fail('scrolled from ' + a.name + ' into ' + b.name + ', the ambiences did not crossfade: ' + JSON.stringify(crossed));
  }

  // Played as film across a join, from three seconds before it, for four and
  // a half: the second shot's soundtrack is built while the film plays, so the
  // longest gap between animation frames meanwhile is that build's cost.
  let sync = null;
  if (join < 0) fail('no two shots with sound meet, so no join was played');
  else {
    const at = Math.max(0, 1 - 3 * data.hz / (film[join - 1].end - film[join - 1].start - 1));
    await open(client, context, view, base + '?shot=' + film[join - 1].name + '&t=' + at.toFixed(4));
    await press();
    // Settled there, as a visitor who presses Play would be, so its own soundtrack is built.
    await evaluate(client, 'new Promise((r) => setTimeout(r, 1500))');
    const log0 = await evaluate(client, '__stage.log.length'), p0 = await evaluate(client, 'window.__probe.audio.starts.length'), s1 = await evaluate(client, '__stage.listen.starts.length');
    const r1 = await evaluate(client, '__stage.listen.rooms.length');
    await evaluate(client, '(() => { const g = window.__gaps = { on: true, list: [] }; let last = 0; const loop = (t) => { if (last) g.list.push(t - last); last = t; if (g.on) requestAnimationFrame(loop); }; requestAnimationFrame(loop); })()');
    await evaluate(client, 'document.getElementById("play").click()');
    await evaluate(client, 'new Promise((r) => setTimeout(r, 4500))');
    const during = await evaluate(client, '({ ambient: __stage.listen.ambient, rooms: __stage.listen.rooms.slice(' + r1 + '), gapMs: Math.round(Math.max(0, ...window.__gaps.list)) })');
    await evaluate(client, 'window.__gaps.on = false; document.getElementById("play").click()');
    const got = await evaluate(client, '({ log: __stage.log.slice(' + log0 + ').filter((e) => !e.warm), stage: __stage.listen.starts.slice(' + s1 + '), probe: window.__probe.audio.starts.slice(' + p0 + '), clock: __probeClock() })');
    if (during.ambient || during.rooms.length) fail('played as film, an ambience sounded: ' + JSON.stringify(during));
    if (during.gapMs > PLAY_GAP_MS) fail('played as film across ' + film[join - 1].name + ' into ' + film[join].name + ', the picture stopped for ' + during.gapMs + ' ms, more than ' + PLAY_GAP_MS);
    const played = got.stage.filter((x) => x.playing);
    // The stage's record of each start must be the call the probe saw.
    const matched = played.every((x) => got.probe.some((p) => Math.abs(p.when - x.when) < 1e-9 && Math.abs(p.offset - x.offset) < 1e-9));
    if (!matched) fail('the stage recorded starts the probe did not see: ' + JSON.stringify({ stage: played, probe: got.probe }));
    const lags = syncLags(got.log.map((e) => ({ site: e.site, at: e.at })), played, got.clock, film, data.hz);
    const worst = lags.reduce((m, l) => Math.abs(l.lagMs) > Math.abs(m) ? l.lagMs : m, 0);
    sync = { from: film[join - 1].name, to: film[join].name, starts: played, judged: lags.length, worstLagMs: worst, longestGapMs: during.gapMs, clock: got.clock };
    if (![film[join - 1].name, film[join].name].every((n) => played.some((x) => x.shot === n))) fail('played as film, not both ' + film[join - 1].name + ' and ' + film[join].name + ' were heard: ' + JSON.stringify(played));
    if (!lags.some((l) => l.shot === film[join].name)) fail('played as film, no frame of ' + film[join].name + ' was judged');
    if (Math.abs(worst) > 1000 / data.hz) fail('played as film, a frame was drawn ' + worst + ' ms from the sound heard with it, more than one frame');
  }

  await evaluate(client, 'document.getElementById("listen").click()');
  await evaluate(client, 'new Promise((r) => setTimeout(r, 300))');
  const off = await evaluate(client, '({ pressed: document.getElementById("listen").getAttribute("aria-pressed"), status: document.getElementById("status").textContent, playing: __stage.listen.playing, ambient: __stage.listen.ambient })');
  if (off.pressed !== 'false' || !/sound off/.test(off.status) || off.playing || off.ambient) fail('pressed again, the switch left ' + JSON.stringify(off));
  if (context.errors.length) fail('page errors: ' + context.errors.join('; '));
  return { heard, renders, airs, tabs, roamed, crossed, sync, failures };
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

  // The page's own buttons: the picture's button hands the browser a PNG named for the shot and says so; the recipe's names the shot.
  // The download is caught where the page starts it, so the check leaves no file behind.
  await evaluate(client, 'window.__taken = []; HTMLAnchorElement.prototype.click = function () { window.__taken.push(this.download); }; document.getElementById("savepng").click()');
  await waitFor(client, context, 'window.__taken.length > 0 || /could not|refus|error/i.test(document.getElementById("status").textContent)');
  const taken = await evaluate(client, '({ names: window.__taken, status: document.getElementById("status").textContent })');
  if (taken.names[0] !== png.name || !taken.status.startsWith('saved ' + png.name)) fail('the Save picture button gave ' + JSON.stringify(taken) + ', not ' + png.name);
  await evaluate(client, 'document.getElementById("recipe").click()');
  await waitFor(client, context, '/^recipe/.test(document.getElementById("status").textContent)');
  const copied = await evaluate(client, 'document.getElementById("status").textContent');
  if (!/^recipe copied/.test(copied) && !copied.includes('"shot":' + JSON.stringify(s.name))) fail('the Copy recipe button said ' + JSON.stringify(copied));
  await evaluate(client, 'document.getElementById("install").click()');
  await waitFor(client, context, '/^install/.test(document.getElementById("status").textContent)');
  const install = await evaluate(client, 'document.getElementById("status").textContent');
  if (!/^install commands copied/.test(install) && !install.includes('claude plugin install artifex@artifex')) fail('the Copy install button said ' + JSON.stringify(install));

  const { identifier } = await client.send('Page.addScriptToEvaluateOnNewDocument', { source: '(' + FORCED['no-h264'].install + ')();' });
  await open(client, context, view, base + '?shot=' + s.name + '&t=0.5&seed=' + seed);
  const refused = await evaluate(client, '__stage.exports.offer()');
  await client.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  if (refused.format !== 'webm' || refused.reason !== 'h264') fail('with H.264 refused the film on offer is ' + JSON.stringify(refused));
  if (context.errors.length) fail('page errors: ' + context.errors.join('; '));
  return { shot: s.name, png: { name: png.name, bytes: pngBytes.length }, png8: big, svg, offer, film: { name: film.name, frames: film.frames, conversion: film.conversion }, withoutH264: refused, failures };
}

/**
 * The shots whose pieces declare boxes, with their design size and ranges, read
 * from the built data, so the check judges the build and not today's sources.
 */
const boxShots = (shots) => shots.filter((s) => s.boxes).map(({ name, id, size, boxes }) => ({ name, id, size, boxes }));

// The canvas on screen, its CSS box, and the last draw the stage made that was not a warm-up.
const SHOWN = `(() => {
  const c = document.querySelector('#stage canvas:not([hidden])'), r = c && c.getBoundingClientRect(), d = __stage.log.filter((e) => !e.warm).pop();
  return { shot: __stage.shot, frame: __stage.frame, search: location.search, canvas: r && { x: r.x, y: r.y, w: r.width, h: r.height, label: c.getAttribute('aria-label') }, draw: d && { shot: d.shot, box: d.box, site: d.site }, wall: [...document.querySelectorAll('.wall')].map((w) => !w.hidden && ((r) => r.x + r.width / 2)(w.getBoundingClientRect())), control: !document.getElementById('boxcontrol').hidden };
})()`;

/**
 * The box path, at both references' sizes: a shot that declares boxes is
 * drawn at the viewport's box (boxFor) on a canvas that fills the viewport
 * and shows its walls and width control, and its recipe carries the box; a
 * wall dragged in draws it again at the narrower box and rewrites the recipe;
 * that recipe opened afresh restores the box; a resized window gives a new
 * box; and a shot without boxes keeps its design box, fitted, with no box.
 */
async function boxing(client, context, base, shots) {
  context.phase = 'boxes';
  const failures = [], out = [], fail = (m) => failures.push('boxes: ' + m), { boxFor } = stage();
  const found = boxShots(shots);
  if (!found.length) return { failures: ['boxes: no shot declares boxes'] };
  const s = found[0], i = shots.findIndex((x) => x.name === s.name), plain = shots.findIndex((x, j) => j !== i && !x.seam && !found.some((f) => f.name === x.name));
  const shown = async (want) => {
    await waitFor(client, context, '__stage.log.some((e) => !e.warm && e.shot === ' + i + ' && e.box === ' + JSON.stringify(want) + ')');
    await evaluate(client, 'new Promise((r) => setTimeout(r, 600))');
    return evaluate(client, SHOWN);
  };
  const near = (a, b) => Math.abs(a - b) <= 1.5;
  for (const ref of REFERENCES) {
    const view = { ...ref, cpu: 1 }, name = view.name + ' ' + view.width + 'x' + view.height;
    const own = boxFor(s.size, s.boxes, { w: view.width, h: view.height }, null), key = own.w + 'x' + own.h;
    await open(client, context, view, base + '?shot=' + s.name + '&t=0.8&seed=1');
    const a = await shown(key);
    // The viewport's box fills the viewport, unless the declared ranges hold it smaller.
    const css = Math.min(view.width / s.size.w, view.height / s.size.h), w = own.w * css, h = own.h * css;
    if (!a.canvas || !near(a.canvas.w, w) || !near(a.canvas.h, h) || !near(a.canvas.x, (view.width - w) / 2)) fail(name + ': the canvas is ' + JSON.stringify(a.canvas) + ', not ' + w + ' by ' + h + ' centred');
    if (new URLSearchParams(a.search).get('box') !== key) fail(name + ': the recipe reads ' + a.search + ', not box=' + key);
    if (!a.control || a.wall.some((x) => x === false) || !a.canvas.label.includes('box ' + own.w + ' by ' + own.h)) fail(name + ': the walls, control or label: ' + JSON.stringify(a));
    // Drag the right wall in by a quarter of the canvas.
    const from = a.wall[1], to = from - a.canvas.w / 4, y = Math.round(view.height / 2);
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(from), y, button: 'left', clickCount: 1 });
    for (let k = 1; k <= 5; k++) await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(from + ((to - from) * k) / 5), y, button: 'left' });
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(to), y, button: 'left', clickCount: 1 });
    const dragged = boxFor(s.size, s.boxes, { w: view.width, h: view.height }, { w: (2 * (Math.round(to) - view.width / 2)) / css, h: own.h }), dkey = dragged.w + 'x' + dragged.h;
    const b = await shown(dkey);
    if (!b.canvas || !near(b.canvas.w, dragged.w * css)) fail(name + ': dragged to ' + dkey + ', the canvas is ' + JSON.stringify(b.canvas));
    if (new URLSearchParams(b.search).get('box') !== dkey) fail(name + ': dragged, the recipe reads ' + b.search + ', not box=' + dkey);
    // The dragged box's recipe, opened afresh.
    await open(client, context, view, base + b.search);
    const c = await shown(dkey);
    if (!c.canvas || !near(c.canvas.w, dragged.w * css) || new URLSearchParams(c.search).get('box') !== dkey) fail(name + ': the recipe ' + b.search + ' opened ' + JSON.stringify(c));
    out.push({ view: name, box: key, canvas: a.canvas, dragged: dkey, restored: c.draw && c.draw.box });
  }
  // A window made wider gives the shot a new box; its height, and so the frame the scroll is at, stays.
  const view = { ...REFERENCES[0], cpu: 1 }, wide = { ...view, width: 1600 };
  await open(client, context, view, base + '?shot=' + s.name + '&t=0.5&seed=1');
  await shown((({ w, h }) => w + 'x' + h)(boxFor(s.size, s.boxes, { w: view.width, h: view.height }, null)));
  await client.send('Emulation.setDeviceMetricsOverride', { width: wide.width, height: wide.height, deviceScaleFactor: 1, mobile: false });
  const resizedBox = boxFor(s.size, s.boxes, { w: wide.width, h: wide.height }, null), resized = await shown(resizedBox.w + 'x' + resizedBox.h);
  if (!resized.canvas || !near(resized.canvas.w, resizedBox.w * Math.min(wide.width / s.size.w, wide.height / s.size.h))) fail('resized to ' + wide.width + 'x' + wide.height + ': ' + JSON.stringify(resized));
  // A dragged box in a window made taller: the box keeps its width and takes the new height, and the frame the scroll was at stays on screen.
  const tall = { ...view, height: 1000 };
  await open(client, context, view, base + '?shot=' + s.name + '&t=0.5&seed=1');
  const ownHere = boxFor(s.size, s.boxes, { w: view.width, h: view.height }, null), before = await shown(ownHere.w + 'x' + ownHere.h);
  const grip = before.wall[1], inTo = grip - before.canvas.w / 4, midY = Math.round(view.height / 2), fit = Math.min(view.width / s.size.w, view.height / s.size.h);
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(grip), y: midY, button: 'left', clickCount: 1 });
  for (let k = 1; k <= 5; k++) await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(grip + ((inTo - grip) * k) / 5), y: midY, button: 'left' });
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(inTo), y: midY, button: 'left', clickCount: 1 });
  const narrow = boxFor(s.size, s.boxes, { w: view.width, h: view.height }, { w: (2 * (Math.round(inTo) - view.width / 2)) / fit, h: null });
  const held = await shown(narrow.w + 'x' + narrow.h);
  await client.send('Emulation.setDeviceMetricsOverride', { width: tall.width, height: tall.height, deviceScaleFactor: 1, mobile: false });
  const taller = boxFor(s.size, s.boxes, { w: tall.width, h: tall.height }, { w: narrow.w, h: null }), grown = await shown(taller.w + 'x' + taller.h);
  if (taller.h === narrow.h) fail('the taller window gives the dragged box no new height to check: ' + JSON.stringify(taller));
  if (grown.shot !== held.shot || grown.frame !== held.frame) fail('made taller, the stage went from shot ' + held.shot + ' frame ' + held.frame + ' to shot ' + grown.shot + ' frame ' + grown.frame);
  if (new URLSearchParams(grown.search).get('box') !== taller.w + 'x' + taller.h) fail('made taller, the recipe reads ' + grown.search + ', not box=' + taller.w + 'x' + taller.h);
  // A shot without boxes keeps its design box, fitted, and names no box.
  let fitted = null;
  if (plain >= 0) {
    await open(client, context, view, base + '?shot=' + shots[plain].name + '&t=0.5&seed=1');
    await waitFor(client, context, '__stage.log.some((e) => !e.warm && e.shot === ' + plain + ')');
    await evaluate(client, 'new Promise((r) => setTimeout(r, 600))');
    fitted = await evaluate(client, SHOWN);
    const size = await evaluate(client, '__require("check")(' + JSON.stringify(shots[plain].id) + ').size');
    const k = Math.min(view.width / size.w, view.height / size.h);
    if (!fitted.canvas || !near(fitted.canvas.w, size.w * k) || !near(fitted.canvas.h, size.h * k) || fitted.draw.box !== null || new URLSearchParams(fitted.search).has('box') || fitted.control) fail('the shot ' + shots[plain].name + ' without boxes: ' + JSON.stringify(fitted));
  }
  if (context.errors.length) fail('page errors: ' + context.errors.join('; '));
  return { shot: s.name, views: out, resized: resized.draw && resized.draw.box, fitted: fitted && { shot: shots[plain].name, canvas: fitted.canvas }, failures };
}

/** The requests among `urls` that leave `origin`: the site loads nothing from anywhere else. */
function outside(urls, origin) {
  return [...new Set(urls.filter((u) => !/^(data|blob|about):/.test(u) && u !== origin && !u.startsWith(origin + '/')))];
}

/** `fg` over `bg` flattened onto `under`, each [r, g, b, a] with a from 0 to 1: the colour seen, as #rrggbb. */
function seen(fg, under) {
  const mix = (i) => Math.round(fg[i] * fg[3] + under[i] * (1 - fg[3]));
  return '#' + [0, 1, 2].map((i) => mix(i).toString(16).padStart(2, '0')).join('');
}

/**
 * What the audit's page readings fail: every control named in the
 * accessibility tree and at least 24 by 24 CSS px; every control reached by Tab, with a
 * focus ring and not covered; every canvas an image with a label; a status
 * region; text at 4.5 to 1 against its ground, which for a translucent card
 * is taken over black and over white, whichever is worse.
 */
function judgeAudit(read) {
  const { contrast } = require('../core/colour.js'), failures = [], fail = (m) => failures.push('audit: ' + m);
  // The accessibility tree lists the controls in its own order: each has a name, and there are as many as the page shows.
  for (const n of read.named) if (!n.name) fail('a ' + n.role + ' has no name for assistive technology');
  if (read.named.length !== read.controls.length) fail('the accessibility tree has ' + read.named.length + ' controls and the page shows ' + read.controls.length);
  for (const c of read.controls) {
    if (c.w < 24 || c.h < 24) fail('the control ' + c.id + ' is ' + c.w + ' by ' + c.h + ' CSS px, under 24 by 24');
    const stop = read.tabbed.find((t) => t.id === c.id);
    if (!stop) fail('Tab never reaches the control ' + c.id);
    else if (!stop.ring) fail('the control ' + c.id + ' shows no focus ring');
    else if (!stop.clear) fail('the control ' + c.id + ' is covered where it takes the focus');
  }
  if (!read.controls.length) fail('the page shows no control');
  for (const c of read.canvases) if (c.role !== 'img' || !c.label) fail('a stage canvas has the role ' + c.role + ' and the label ' + JSON.stringify(c.label));
  if (!read.canvases.length) fail('the stage shows no canvas');
  if (!read.status) fail('the page has no status region');
  if (read.lang !== 'en') fail('the page says its language is ' + JSON.stringify(read.lang));
  for (const t of read.text) {
    const worst = Math.min(...[[0, 0, 0], [255, 255, 255]].map((under) => contrast(seen(t.color, [0, 0, 0, 1]), seen(t.ground, under))));
    if (worst < 4.5) fail('the text ' + JSON.stringify(t.what) + ' has a contrast of ' + worst.toFixed(2) + ' to 1 against its ground, under 4.5');
  }
  if (!read.text.length) fail('the page shows no text to judge');
  return failures;
}

// The page's controls, canvases and text, read from the DOM and the styles it computed.
const AUDIT = `(() => {
  const shown = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const rgba = (text) => { const m = /rgba?\\(([^)]+)\\)/.exec(text), p = m ? m[1].split(/[ ,\\/]+/).map(Number) : [0, 0, 0, 0]; return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const ground = (e) => { for (let x = e; x; x = x.parentElement) { const c = rgba(getComputedStyle(x).backgroundColor); if (c[3] > 0) return c; } return [255, 255, 255, 1]; };
  return {
    lang: document.documentElement.lang,
    status: !!document.querySelector('[role="status"]'),
    controls: [...document.querySelectorAll('button, input, select, textarea, a[href]')].filter(shown).map((e) => { const r = e.getBoundingClientRect(); return { id: e.id || e.tagName.toLowerCase(), w: Math.round(r.width), h: Math.round(r.height) }; }),
    canvases: [...document.querySelectorAll('#stage canvas:not([hidden])')].map((c) => ({ role: c.getAttribute('role'), label: c.getAttribute('aria-label') })),
    text: [...document.querySelectorAll('h1, h2, .card p, #bar label, #bar button, #status')].filter(shown).map((e) => ({ what: (e.textContent || '').trim().slice(0, 40), color: rgba(getComputedStyle(e).color), ground: ground(e) })),
  };
})()`;

// The element with the focus: its id, whether it shows a focus ring and whether it is the topmost thing at its middle.
const FOCUSED = `(() => {
  const e = document.activeElement;
  if (!e || e === document.body) return null;
  const r = e.getBoundingClientRect(), s = getComputedStyle(e), top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return { id: e.id || e.tagName.toLowerCase(), ring: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0, clear: top === e || e.contains(top) };
})()`;

/**
 * The audit, on a shot that shows every control: the names and roles the
 * browser's accessibility tree gives the controls, their sizes, Tab's path
 * through them, the canvases' role and label, the text's contrast; and, with
 * scripts off, the text in order with each shot's poster as an image.
 */
async function audit(client, context, base, shots) {
  context.phase = 'audit';
  const view = REFERENCES[0], boxed = boxShots(shots)[0] || shots[0];
  await open(client, context, view, base + '?shot=' + boxed.name + '&t=0.5&seed=1');
  await waitFor(client, context, '!document.getElementById("boxcontrol").hidden || ' + JSON.stringify(!boxed.boxes));
  const read = await evaluate(client, AUDIT);
  // Names and roles as assistive technology gets them.
  await client.send('Accessibility.enable');
  const tree = (await client.send('Accessibility.getFullAXTree')).nodes || [];
  await client.send('Accessibility.disable');
  read.named = tree.filter((n) => !n.ignored && n.role && ['button', 'slider', 'link', 'textbox', 'checkbox', 'combobox'].includes(n.role.value)).map((n) => ({ role: n.role.value, name: (n.name && n.name.value) || '' }));
  // Tab through the page, from its start, once round.
  read.tabbed = [];
  await evaluate(client, 'document.activeElement && document.activeElement.blur()');
  for (let i = 0; i < read.controls.length + 4; i++) {
    await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    const at = await evaluate(client, FOCUSED);
    if (at && !read.tabbed.some((t) => t.id === at.id)) read.tabbed.push(at);
  }
  const failures = judgeAudit(read);
  // Scripts off: the page is its text in order, each shot with a poster shown as an image with its text.
  await client.send('Emulation.setScriptExecutionDisabled', { value: true });
  await client.send('Page.navigate', { url: base });
  await new Promise((r) => setTimeout(r, 1500));
  const plain = (await client.send('Runtime.evaluate', { returnByValue: true, expression: `({
    headings: [...document.querySelectorAll('.shot h2')].map((h) => h.textContent),
    images: [...document.querySelectorAll('.shot img')].map((i) => ({ shot: i.closest('.shot').id.slice(5), alt: i.alt, width: i.naturalWidth })),
  })` })).result.value;
  await client.send('Emulation.setScriptExecutionDisabled', { value: false });
  const titled = shots.filter((s) => !s.seam && s.label !== s.name).map((s) => s.label), postered = shots.filter((s) => s.poster).map((s) => s.name);
  if (!plain || plain.headings.join('|') !== titled.join('|')) fail0(failures, 'with scripts off the headings read ' + JSON.stringify(plain && plain.headings) + ', not the shots\' titles in order');
  else {
    const drawn = plain.images.filter((i) => i.alt && i.width > 0).map((i) => i.shot);
    if (postered.join() !== drawn.join()) fail0(failures, 'with scripts off the posters shown as images are ' + JSON.stringify(drawn) + ', not those of ' + JSON.stringify(postered));
  }
  if (context.errors.length) fail0(failures, 'page errors: ' + context.errors.join('; '));
  return { controls: read.controls, named: read.named, tabbed: read.tabbed.map((t) => t.id), text: read.text.length, plain, failures };
}
const fail0 = (failures, m) => failures.push('audit: ' + m);

// In the page: every frame of each seam drawn at its design size and read by core/flash.js's reader, as
// a film export reads its own. Drawn small instead, thin marks alias from frame to frame and count as
// flashes that the picture does not have (the bend seam read 5 in a second at 160 pixels wide, 1 at 1200).
async function seamFlashes(seams, hz, seed) {
  await __stage.exports.module();
  const req = __require('check'), P = req('core/piece.js'), R = req('core/render.js'), F = req('core/flash.js'), out = [];
  for (const s of seams) {
    await __stage.exports.offer({ shot: s.name });
    const piece = P.validate(req(s.id)), solve = P.solve(piece, seed, {}), { w, h } = piece.size, n = Math.round(piece.time.duration * hz);
    const canvas = new OffscreenCanvas(w, h), g = canvas.getContext('2d'), reader = F.flashReader((cw, ch) => new OffscreenCanvas(cw, ch), w, h, hz);
    const all = (read) => {
      for (let f = 0; f < n; f++) {
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, w, h);
        R.drawFrame(g, piece, solve, n > 1 ? f / (n - 1) : 0);
        read(canvas);
      }
    };
    all(reader.read);
    // The site's policy refuses the reader's worker: it then counts here, from the frames drawn again.
    const flashes = await reader.result(undefined, async (read) => all(read));
    out.push({ shot: s.name, frames: n, worst: flashes.worst, warning: F.flashNote(flashes) });
  }
  return out;
}

/** Flashes: no seam flashes more than three times in any second (WCAG 2.3.1), counted on every frame of each. */
async function flashing(client, context, base, shots, data) {
  context.phase = 'flashes';
  await open(client, context, REFERENCES[0], base);
  const seams = shots.filter((s) => s.seam).map(({ name, id }) => ({ name, id }));
  const counted = await evaluate(client, '(' + seamFlashes + ')(' + JSON.stringify(seams) + ', ' + data.hz + ', ' + data.seed + ')');
  const failures = counted.filter((c) => c.warning).map((c) => 'flashes: the seam ' + c.shot + ':' + c.warning);
  if (!counted.length) failures.push('flashes: no seam was counted');
  if (context.errors.length) failures.push('flashes: page errors: ' + context.errors.join('; '));
  return { seams: counted, failures };
}

/** The site check of `options.dir`; `edge` stands in for withEdge in a test. */
async function runSiteCheck(options = {}, edge = withEdge) {
  const dir = options.dir || OUT;
  const file = path.join(dir, 'data.js');
  if (!fs.existsSync(file)) throw new Error('site: ' + file + ' not found; run npm run site first');
  const data = JSON.parse(/^window\.__siteData = (.*);$/m.exec(fs.readFileSync(file, 'utf8'))[1]);
  const shots = data.shots;
  const server = await serveSite(dir);
  const report = { walks: [] };
  try {
    const timeoutMs = options.timeoutMs ?? deadline(data.frames);
    return await edge('<!doctype html><title>site check</title>', { ...options, timeoutMs, command: 'site check' }, async (client, context) => {
      try {
        if (options.waitMs !== undefined) context.waitMs = options.waitMs;
        await client.send('Page.addScriptToEvaluateOnNewDocument', { source: '(' + probe + ')();' });
        const requested = [];
        if (client.onEvent) {
          await client.send('Network.enable');
          // Only what the site's own pages ask for: the browser's first page, which the check opens, is not the site.
          client.onEvent((event) => { if (event.method === 'Network.requestWillBeSent' && (event.params.documentURL || '').startsWith(server.url)) requested.push(event.params.request.url); });
        }
        Object.assign(report, { browser: context.version && context.version.Browser, frames: data.frames, hz: data.hz, timeoutMs, shots: shots.map((s) => s.name) });
        for (const view of REFERENCES) report.walks.push(await walk(client, context, view, server.url, shots));
        await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
        report.reduced = await reduced(client, context, server.url, shots);
        report.fallback = await fallback(client, context, server.url, shots);
        report.recipe = await recipe(client, context, server.url, shots, data);
        report.play = await play(client, context, server.url, data);
        report.listen = await listening(client, context, server.url, shots, data);
        report.exports = await exporting(client, context, server.url, shots);
        report.boxes = await boxing(client, context, server.url, shots);
        report.audit = await audit(client, context, server.url, shots);
        report.flashes = await flashing(client, context, server.url, shots, data);
        // Every request the site's pages made, through every phase: none leaves the site.
        const origin = new URL(server.url).origin, away = outside(requested, origin);
        report.requests = { count: requested.length, outside: away, failures: away.length ? ['requests: the site asked for ' + away.join(', ') + ', outside ' + origin] : [] };
        report.failures = failuresOf(report);
        return report;
      } catch (error) {
        // A page refusal ("site check: <message>") names the phase it came from, which withEdge leaves out of it.
        throw error.pageRefusal ? Object.assign(new Error('site check: ' + context.phase + ': ' + error.message.slice('site check: '.length)), { pageRefusal: true }) : error;
      }
    });
  } catch (error) {
    // The phases that finished before the run stopped, for main to print.
    if (!error.report && report.browser !== undefined) error.partial = { ...report, failures: failuresOf(report) };
    throw error;
  } finally {
    await server.close();
  }
}

const failuresOf = (report) => [...report.walks.flatMap((w) => w.failures),
  ...['reduced', 'fallback', 'recipe', 'play', 'listen', 'exports', 'boxes', 'audit', 'flashes', 'requests'].flatMap((phase) => (report[phase] ? report[phase].failures : []))];

async function main(args = process.argv.slice(2)) {
  if (args.includes('--help') || args.includes('-h')) return console.log(USAGE);
  const options = parseArgs(args);
  let report, failure;
  try { report = await runSiteCheck(options); } catch (error) { failure = error; report = error.report || error.partial; }
  if (report) {
    console.log(JSON.stringify(report, null, 2));
    const walks = report.walks.map((w) => w.view + ' ' + w.draws + ' draws of ' + w.distinct + ' distinct frames'
      + (w.redraws ? ' and ' + w.redraws + ' redraws after a scale change' : '') + ', p95 '
      + w.perShot.map((s) => s.shot + ' ' + (s.p95Ms === null ? 'in worker' : s.p95Ms + ' ms')).join(', ')
      + (w.kept ? ', kept ' + w.kept.copies + ' copies, peak ' + w.kept.peakMegapixels + ' Mpx' : '')).join('; ');
    console.log('site: ' + (report.failures.length ? report.failures.length + ' failed: ' + report.failures.join('; ') : 'passed') + '; ' + walks
      + (failure ? (failure.partial ? '; stopped before the rest' : '; cleanup failed') : '; owned browser, server and profile cleaned up'));
    if (report.failures.length && !failure) failure = new Error('site: ' + report.failures.length + ' check(s) failed');
  }
  if (failure) throw failure;
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { parseArgs, deadline, countDraws, judgeWalk, sinkWaits, syncLags, boxShots, boxing, outside, judgeAudit, runSiteCheck, main, REFERENCES, probe };
