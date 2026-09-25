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
// no page errors; every shot drawn; as many draws as distinct frames; at most
// two canvases; no scroll write, no preventDefault on wheel, touch, scroll or
// keys, and no listener for them that is not passive; and each shot's p95 draw
// time, forced to rasterize, within its tier's budget. Then reduced motion must
// show every shot as a still and draw nothing on scroll; with the canvas
// transfer taken away, the worker-tier shot must draw on the main thread; and
// a recipe URL must open its shot, frame and seed; and "Play as film" must
// scroll at the site's rate until a key stops it.

const fs = require('node:fs');
const path = require('node:path');
const { withEdge, evaluate, waitFor } = require('./check-browser.js');
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

/** The shots each draw belongs to, and what a forward walk must hold. */
function judgeWalk(view, shots, entries, samples, probeLog) {
  const failures = [];
  const keys = new Set(entries.map((e) => e.shot + '|' + e.frame + '|' + e.seed));
  if (keys.size !== entries.length) failures.push(view.name + ': ' + entries.length + ' draws for ' + keys.size + ' distinct frames');
  const perShot = shots.map((s, i) => {
    const mine = entries.filter((e) => e.shot === i);
    if (!mine.length) { failures.push(view.name + ': shot ' + s.name + ' was never drawn'); return { shot: s.name, draws: 0 }; }
    const where = [...new Set(mine.map((e) => e.where))];
    // The budget holds at the scale the shot settled on; a worker-tier shot is off the main thread.
    const scale = mine[mine.length - 1].scale;
    const main = mine.filter((e) => e.where === 'main' && e.scale === scale).map((e) => e.ms);
    const limit = s.tier === 'frame' ? view.frameMs : view.changeMs;
    const out = { shot: s.name, tier: s.tier, where, draws: mine.length, warm: mine.filter((e) => e.warm).length, scale, width: mine[mine.length - 1].w,
      p95Ms: main.length ? p95(main) : null, maxMs: Math.max(...mine.map((e) => e.ms)), budgetMs: s.tier === 'worker' ? null : limit };
    if (s.tier !== 'worker' && main.length && out.p95Ms > limit) failures.push(view.name + ': shot ' + s.name + ' p95 ' + out.p95Ms + ' ms over its ' + limit + ' ms budget');
    return out;
  });
  const canvases = Math.max(...samples);
  if (canvases > 2) failures.push(view.name + ': ' + canvases + ' canvases at once');
  if (probeLog.writes.length) failures.push(view.name + ': the page wrote the scroll: ' + probeLog.writes.join(', '));
  if (probeLog.prevented.length) failures.push(view.name + ': preventDefault on ' + probeLog.prevented.join(', '));
  if (probeLog.active.length) failures.push(view.name + ': listeners that are not passive: ' + probeLog.active.join(', '));
  return { failures, perShot, canvases, draws: entries.length, distinct: keys.size };
}

/** Scroll the whole film forward by native wheel, one frame of scroll per event. */
async function walk(client, context, view, base, shots) {
  context.phase = view.name + ' walk';
  await open(client, context, view, base + '?measure=1');
  const start = await evaluate(client, '({ px: __stage.px, frames: __stage.frames, draws: __stage.draws, canvas: document.querySelectorAll("canvas").length })');
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
  const end = await evaluate(client, '({ log: __stage.log.slice(' + from + '), frame: __stage.frame, lowered: __stage.lowered, worker: __stage.worker, probe: window.__probe })');
  const verdict = judgeWalk(view, shots, end.log, samples, end.probe);
  if (tiny) verdict.failures.push(view.name + ': ' + tiny + ' draws from wheel steps that did not reach a new frame');
  if (end.frame !== start.frames - 1) verdict.failures.push(view.name + ': the walk ended on frame ' + end.frame + ', not the last, ' + (start.frames - 1));
  if (context.errors.length) verdict.failures.push(view.name + ': page errors: ' + context.errors.join('; '));
  return { view: view.name, pxPerFrame: +start.px.toFixed(2), lastFrame: end.frame, lowered: end.lowered, worker: end.worker, ...verdict };
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
      report.failures = [...report.walks.flatMap((w) => w.failures), ...report.reduced.failures, ...report.fallback.failures, ...report.recipe.failures, ...report.play.failures];
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
    const walks = report.walks.map((w) => w.view + ' ' + w.draws + ' draws of ' + w.distinct + ' distinct frames, p95 '
      + w.perShot.map((s) => s.shot + ' ' + (s.p95Ms === null ? 'in worker' : s.p95Ms + ' ms')).join(', ')).join('; ');
    console.log('site: ' + (report.failures.length ? report.failures.length + ' failed: ' + report.failures.join('; ') : 'passed') + '; ' + walks
      + (failure ? '; cleanup failed' : '; owned browser, server and profile cleaned up'));
    if (report.failures.length && !failure) failure = new Error('site: ' + report.failures.length + ' check(s) failed');
  }
  if (failure) throw failure;
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { parseArgs, judgeWalk, runSiteCheck, main, REFERENCES, probe };
