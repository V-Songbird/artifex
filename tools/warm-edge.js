#!/usr/bin/env node
'use strict';

// One headless Edge kept running between calls, so a run of npm run still
// calls skips Edge's launch and close, and reuses the loaded page while its
// HTML is the same. Opt-in: nothing changes until `npm run edge -- start`.
//
//   npm run edge -- start     launch it for this checkout
//   npm run edge -- status    say whether it runs
//   npm run edge -- stop      close it and remove its profile
//
// Each call draws on a fresh CDP connection with its own page errors. A call
// that could change the page for later ones (a forced condition, a session,
// listeners, a file to serve, a headed or chosen browser), a busy tab, or a
// warm Edge that is gone, runs on a cold Edge through withEdge instead.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const B = require('./check-browser.js');

const USAGE = 'usage: npm run edge -- start | status | stop';
const ROOT = path.resolve(__dirname, '..');
// One warm Edge per checkout, found by this file in the temporary directory.
const STATE = path.join(os.tmpdir(), 'artifex-warm-edge-' + crypto.createHash('sha256').update(ROOT.toLowerCase()).digest('hex').slice(0, 12) + '.json');
const LOCK = 'artifex-tab.lock';

const running = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };

/** The warm Edge's state when it still runs, else null. */
function warmState(file = STATE) {
  let state;
  try { state = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  return state && running(state.pid) ? state : null;
}

/** Take the tab's lock for this process; null when another live process holds it. */
function takeLock(profile) {
  const lock = path.join(profile, LOCK);
  for (let i = 0; i < 2; i++) {
    try {
      fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
      return () => fs.rmSync(lock, { force: true });
    } catch (error) {
      if (error.code !== 'EEXIST') return null;
      let holder = 0;
      try { holder = Number(fs.readFileSync(lock, 'utf8')); } catch { /* released meanwhile */ }
      if (holder && running(holder)) return null;
      fs.rmSync(lock, { force: true });
    }
  }
  return null;
}

/**
 * withEdge's `(page, options, work)`, on the warm Edge when it runs and the call
 * leaves the page as it found it; otherwise `cold`, withEdge itself. The tab is
 * navigated only when it does not already hold exactly `page`.
 */
async function warmEdge(page, options, work, { cold = B.withEdge, state = warmState() } = {}) {
  const unsafe = options.force || options.headed || options.phaseDeadline || options.file || options.spawn || options.edge;
  // Listeners hear the page from its start, so their call loads it again, as a fresh one does.
  const fresh = options.fresh || options.listen;
  const release = !unsafe && state && takeLock(state.profile);
  if (!release) return cold(page, options, work);
  const signal = AbortSignal.timeout(options.timeoutMs ?? B.TIMEOUT_MS);
  const context = { signal, errors: [], phase: 'CDP connection', version: state.version };
  let client, server, ready = false;
  try {
    try {
      const targets = await (await fetch('http://127.0.0.1:' + state.port + '/json/list', { signal })).json();
      const target = targets.find((item) => item.type === 'page');
      client = await B.connectCDP(target.webSocketDebuggerUrl, signal);
      client.command = options.command ?? null;
      client.onEvent((event) => {
        if (event.method === 'Runtime.exceptionThrown') {
          const details = event.params.exceptionDetails;
          context.errors.push(details.exception?.description || details.text);
        } else if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') {
          context.errors.push('console.error: ' + event.params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(' '));
        }
      });
      await client.send('Runtime.enable');
      // Runtime.enable repeats messages from earlier calls; this call's start now.
      context.errors.length = 0;
      const key = crypto.createHash('sha256').update(page).digest('hex');
      if (fresh || await B.evaluate(client, 'globalThis.__artifexWarmKey || null') !== key) {
        options.listen?.(client, context);
        context.phase = 'page navigation';
        server = await B.servePage(page);
        const navigation = await client.send('Page.navigate', { url: server.url });
        if (navigation.errorText) throw new Error('browser: navigation failed: ' + navigation.errorText);
        // A fresh call's work, a film or a sheet, changes the page: it is never reused.
        if (!fresh) {
          await B.waitFor(client, context, 'document.readyState === "complete"');
          await B.evaluate(client, 'globalThis.__artifexWarmKey = ' + JSON.stringify(key));
        }
      }
      ready = true;
    } catch (error) {
      if (signal.aborted) throw error;
    }
    // A warm Edge that cannot take the call leaves it to a cold one.
    if (!ready) { client?.close(); client = null; return await cold(page, options, work); }
    return await work(client, context);
  } catch (error) {
    // A call that failed may have left the page changed: the next one loads it again.
    await B.evaluate(client, 'delete globalThis.__artifexWarmKey').catch(() => {});
    throw new Error(signal.aborted ? 'browser: timed out after ' + (options.timeoutMs ?? B.TIMEOUT_MS) + ' ms during ' + context.phase
      : error.pageRefusal ? error.message : error.message + ' during ' + context.phase);
  } finally {
    // A sheet sets the viewport; the next call starts from the tab's own.
    if (client && fresh) {
      await client.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
      await client.send('Emulation.setScrollbarsHidden', { hidden: false }).catch(() => {});
    }
    client?.close();
    if (server) await server.close().catch(() => {});
    release();
  }
}

async function start() {
  const old = warmState();
  if (old) return 'edge: already running for this checkout, process ' + old.pid;
  await stopOld();
  const edge = await B.findEdge();
  const profile = await fsp.mkdtemp(path.join(await fsp.realpath(os.tmpdir()), 'artifex-browser-warm-'));
  const child = spawn(edge, ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--headless=new', 'about:blank'],
  { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  let port, version;
  for (const until = performance.now() + 15000; !version; await delay(50)) {
    if (performance.now() > until) { await stop(profile); throw new Error('edge: Edge did not open its debugging port within 15 s'); }
    try {
      port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim();
      const response = await fetch('http://127.0.0.1:' + port + '/json/version');
      if (response.ok) version = await response.json();
    } catch { /* not written yet */ }
  }
  const browser = await B.connectCDP(version.webSocketDebuggerUrl, AbortSignal.timeout(3000));
  let pid;
  try { pid = (await browser.send('SystemInfo.getProcessInfo')).processInfo.find((item) => item.type === 'browser').id; } finally { browser.close(); }
  fs.writeFileSync(STATE, JSON.stringify({ pid, port, profile, version }));
  return 'edge: running, process ' + pid + '; npm run still reuses it until npm run edge -- stop';
}

/** Close a state file's Edge, if it runs, and remove its profile and the file. */
async function stopOld() {
  let state;
  try { state = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return false; }
  if (running(state.pid)) {
    try {
      const browser = await B.connectCDP(state.version.webSocketDebuggerUrl, AbortSignal.timeout(3000));
      await Promise.race([browser.send('Browser.close').catch(() => {}), delay(1500)]);
      browser.close();
    } catch { /* stopped below */ }
    for (const until = performance.now() + 10000; running(state.pid) && performance.now() < until;) await delay(100);
    // Only this profile's browser: the id came from its own endpoint at start.
    if (running(state.pid)) await B.stopRelaunched(state.pid);
  }
  await B.removeProfile(state.profile);
  fs.rmSync(STATE, { force: true });
  return true;
}

async function stop(profile) {
  if (profile) { await B.removeProfile(profile).catch(() => {}); return ''; }
  return await stopOld() ? 'edge: stopped, profile removed' : 'edge: not running';
}

async function main(args = process.argv.slice(2)) {
  const verbs = { start, stop: () => stop(), status: async () => { const s = warmState(); return s ? 'edge: running, process ' + s.pid : 'edge: not running'; } };
  if (args.length !== 1 || !Object.hasOwn(verbs, args[0])) throw new Error('edge: ' + (args.length ? 'unknown command ' + args.join(' ') : 'name a command') + '\n' + USAGE);
  console.log(await verbs[args[0]]());
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

/** warmEdge for a call whose work changes the page, such as a film: it always loads the page. */
const freshEdge = (page, options, work) => warmEdge(page, { ...options, fresh: true }, work);

module.exports = { warmEdge, freshEdge, warmState, main };
