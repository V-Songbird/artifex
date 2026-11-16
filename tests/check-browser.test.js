'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { writeFileSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { spawn, spawnSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const {
  parseArgs, findEdge, connectCDP, evaluate, servePage, runBrowserCheck, replayFilms, requireReplays, stopBrowser, removeProfile, main, filmsToExport, FORCED, sheetReady,
  retryBehindSchedule, frameMatch, soundMatch, loudnessMatch, PAGE_LOUDNESS_MATCH, checkPage, inspectPiece, inspectStill, pagePng, stillVerdict, inspectFilm, evaluateInPieces, PIECE_CHARS, routeVerdict,
  SHOT_BYTES, bandRows, sheetPieces, sheetCuts, writePieces, removeGoneSections, sheetParts, sheetClip, withEdge, crashPartway,
} = require('../tools/check-browser.js');
const { muxMp4 } = require('../core/film.js');
const { EDGE_AVCC } = require('./fake-media.js');

class FakeSocket extends EventTarget {
  static latest;
  constructor(url) {
    super();
    this.url = url;
    this.sent = [];
    FakeSocket.latest = this;
  }
  send(data) { this.sent.push(JSON.parse(data)); }
  open() { this.dispatchEvent(new Event('open')); }
  reply(data) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) })); }
  close() { this.closed = true; this.dispatchEvent(new Event('close')); }
}

async function connection(t) {
  const controller = new AbortController();
  const opening = connectCDP('ws://127.0.0.1/test', controller.signal, FakeSocket);
  const socket = FakeSocket.latest;
  socket.open();
  const client = await opening;
  t.after(() => client.close());
  return { controller, socket, client };
}

test('browser CLI validates deadlines and never requires a browser for help', () => {
  assert.deepEqual(parseArgs([]), { timeoutMs: 60000, headed: false });
  assert.deepEqual(parseArgs(['--edge', 'C:/Program Files/Edge.exe', '--timeout-ms', '3000', '--headed']), {
    edge: 'C:/Program Files/Edge.exe', timeoutMs: 3000, headed: true,
  });
  assert.equal(parseArgs(['--help']).help, true);
  for (const args of [['--edge'], ['--edge', '--headed'], ['--timeout-ms', '0'],
    ['--timeout-ms', '-1'], ['--timeout-ms', '1.5'], ['--timeout-ms', '300001'], ['--other']]) {
    assert.throws(() => parseArgs(args), /usage|timeout-ms/);
  }
});

test('browser discovery reports an actionable missing-Edge error', async () => {
  await assert.rejects(findEdge(path.join(os.tmpdir(), 'artifex-no-such-edge', 'msedge.exe')), /--edge PATH or EDGE_PATH/);
  assert.equal(await findEdge(process.execPath), process.execPath);
});

test('a relative --edge or EDGE_PATH resolves from the folder npm was run in', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artifex-edge-'));
  const fake = path.join(dir, 'msedge-fake');
  writeFileSync(fake, '');
  const root = path.resolve(__dirname, '..');
  try {
    for (const script of ['browser', 'film', 'still', 'posters']) {
      const env = { npm_lifecycle_event: script, npm_package_json: path.join(root, 'package.json'), INIT_CWD: dir };
      assert.equal(await findEdge('msedge-fake', env), fake, script + ' --edge');
      assert.equal(await findEdge(undefined, { ...env, EDGE_PATH: './msedge-fake' }), fake, script + ' EDGE_PATH');
    }
    assert.equal(await findEdge(fake, { npm_lifecycle_event: 'browser', npm_package_json: path.join(root, 'package.json'), INIT_CWD: os.tmpdir() }), fake);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('the missing-Edge refusal names the resolved path it tried, from the folder npm was run in', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artifex-edge-'));
  try {
    const env = { npm_lifecycle_event: 'browser', npm_package_json: path.join(path.resolve(__dirname, '..'), 'package.json'), INIT_CWD: dir };
    const tried = path.join(dir, 'no-such-edge');
    await assert.rejects(findEdge('no-such-edge', env), (error) => error.message.startsWith('browser: installed Microsoft Edge was not found at ' + tried + '; use --edge PATH or EDGE_PATH'));
    await assert.rejects(findEdge(undefined, { ...env, EDGE_PATH: './no-such-edge' }), (error) => error.message.includes(' at ' + tried + ';'));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('browser HTTP server is loopback-only, serves one page and releases its port', async (t) => {
  const server = await servePage('<title>fixture</title>');
  let closed = false;
  t.after(async () => { if (!closed) await server.close(); });
  assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  const page = await fetch(server.url + 'index.html?piece=test');
  assert.equal(page.status, 200);
  assert.equal(await page.text(), '<title>fixture</title>');
  assert.equal((await fetch(server.url + 'package.json')).status, 404);
  assert.equal((await fetch(server.url, { method: 'POST' })).status, 404);
  await server.close(); closed = true;
  await assert.rejects(fetch(server.url), /fetch failed/);
});

test('CDP matches response ids, forwards events and rejects protocol errors', async (t) => {
  const { socket, client } = await connection(t);
  const first = client.send('Page.enable');
  const second = client.send('Runtime.enable');
  const events = [];
  client.onEvent((event) => events.push(event.method));
  socket.reply({ method: 'Runtime.exceptionThrown', params: {} });
  socket.reply({ id: socket.sent[1].id, result: { second: true } });
  socket.reply({ id: socket.sent[0].id, result: { first: true } });
  assert.deepEqual(await first, { first: true });
  assert.deepEqual(await second, { second: true });
  assert.deepEqual(events, ['Runtime.exceptionThrown']);
  const rejected = client.send('Unknown.method');
  socket.reply({ id: socket.sent.at(-1).id, error: { message: 'unknown method' } });
  await assert.rejects(rejected, /Unknown.method: unknown method/);
});

test('browser HTTP server rejects malformed request URLs and remains usable and cleanable', async (t) => {
  const server = await servePage('<title>still available</title>');
  t.after(() => server.close());
  const port = Number(new URL(server.url).port);
  const response = await new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    let data = '';
    socket.setTimeout(2000, () => socket.destroy(new Error('malformed request timed out')));
    socket.on('error', reject);
    socket.on('data', (chunk) => { data += chunk; });
    socket.on('end', () => resolve(data));
    socket.on('connect', () => socket.end('GET http://[ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n'));
  });
  assert.match(response, /^HTTP\/1\.1 400 /);
  assert.equal(await (await fetch(server.url)).text(), '<title>still available</title>');
});

test('CDP evaluation propagates page exceptions instead of accepting an empty result', async (t) => {
  const { socket, client } = await connection(t);
  const failed = evaluate(client, 'throw new Error("fixture")');
  assert.equal(socket.sent[0].params.awaitPromise, true);
  socket.reply({ id: socket.sent[0].id, result: { exceptionDetails: { exception: { description: 'Error: fixture' } } } });
  await assert.rejects(failed, /evaluation failed: Error: fixture/);
});

test('CDP evaluation for the client\'s command refuses a PieceError as "<command>: <message>" and an Error with that command\'s prefix alone', async (t) => {
  const { socket, client } = await connection(t);
  const stack = '\n    at validate (<anonymous>:12:11)\n    at <anonymous>:1:1';
  // withEdge sets client.command from its options.command.
  const fail = async (description, command) => {
    client.command = command;
    const failed = evaluate(client, 'throw 1');
    socket.reply({ id: socket.sent.at(-1).id, result: { exceptionDetails: { exception: { description } } } });
    return failed;
  };
  await assert.rejects(fail('PieceError: sound: a soundtrack needs a timeline' + stack, 'posters'),
    { message: 'posters: sound: a soundtrack needs a timeline', pageRefusal: true });
  await assert.rejects(fail('Error: posters: demo: no room; nothing was written' + stack, 'posters'),
    { message: 'posters: demo: no room; nothing was written', pageRefusal: true });
  await assert.rejects(fail('Error: styles pack: --proof needs a file\nusage: npm run styles -- pack' + stack, 'styles pack'),
    { message: 'styles pack: --proof needs a file\nusage: npm run styles -- pack', pageRefusal: true });
  // A piece's own Error, whatever its message opens with, keeps its stack.
  await assert.rejects(fail('Error: sound: no voice' + stack, 'posters'), { message: 'browser: evaluation failed: Error: sound: no voice' + stack });
  await assert.rejects(fail('TypeError: posters: not a refusal' + stack, 'posters'), { message: 'browser: evaluation failed: TypeError: posters: not a refusal' + stack });
  await assert.rejects(fail('PieceError: sound: no voice' + stack), { message: 'browser: evaluation failed: PieceError: sound: no voice' + stack });
});

test('CDP evaluation without a command refuses nothing, whatever tool prefix an Error opens with', async (t) => {
  const { socket, client } = await connection(t);
  const stack = '\n    at drawPoster (<anonymous>:12:11)\n    at <anonymous>:1:1';
  const failed = evaluate(client, 'throw 1');
  socket.reply({ id: socket.sent.at(-1).id, result: { exceptionDetails: { exception: { description: 'Error: posters: demo: no room; nothing was written' + stack } } } });
  const error = await failed.then(() => null, (e) => e);
  assert.equal(error.pageRefusal, undefined, 'no tool refusal');
  assert.equal(error.message, 'browser: evaluation failed: Error: posters: demo: no room; nothing was written' + stack);
});

test('withEdge prints a page refusal without the phase it failed in, and an ordinary page error with it', async (t) => {
  const devtools = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/json/version') response.end(JSON.stringify({ Browser: 'Fake/1' }));
    else if (request.url === '/json/list') response.end(JSON.stringify([{ type: 'page', url: 'about:blank', webSocketDebuggerUrl: 'ws://127.0.0.1:1/devtools/page/fake' }]));
    else response.writeHead(404).end();
  });
  await new Promise((resolve) => devtools.listen(0, '127.0.0.1', resolve));
  t.after(() => devtools.close());
  let description;
  class Socket extends FakeSocket {
    constructor(url) { super(url); queueMicrotask(() => this.open()); }
    send(data) {
      const { id, method } = JSON.parse(data);
      this.reply({ id, result: method === 'Runtime.evaluate' ? { exceptionDetails: { exception: { description } } } : {} });
    }
  }
  const run = (text) => {
    description = text;
    return withEdge('<title>x</title>', {
      edge: process.execPath, spawn: relaunching(devtools.address().port), WebSocket: Socket, timeoutMs: 20000, command: 'posters',
    }, async (client, context) => { context.phase = 'poster drawing'; await evaluate(client, 'x'); }).catch((error) => error);
  };
  const stack = '\n    at drawPoster (<anonymous>:12:11)';
  assert.equal((await run('Error: posters: demo: build stage "x" threw: no room; nothing was written' + stack)).message,
    'posters: demo: build stage "x" threw: no room; nothing was written');
  // The command comes from withEdge's options alone.
  assert.equal((await run('PieceError: sound: a soundtrack needs a timeline' + stack)).message, 'posters: sound: a soundtrack needs a timeline');
  assert.equal((await run('TypeError: x is not a function' + stack)).message,
    'browser: evaluation failed: TypeError: x is not a function' + stack + ' during poster drawing');
});

test('npm run browser refuses a page PieceError naming the example or film it came from', async (t) => {
  const stack = '\n    at validate (<anonymous>:12:11)';
  // The loaded page, whose evaluation of `fn` throws a PieceError, in a stand-in
  // for withEdge that hands the client its options' command, as withEdge does.
  const refusing = (fn) => {
    const page = pageOf({ readout: { offered: 'mp4', frames: 48, conversion: 'encoder' } });
    return (html, options, work) => work({
      command: options.command,
      send: async (method, params) => (params.expression.includes('function ' + fn.name + '(')
        ? { exceptionDetails: { exception: { description: 'PieceError: sound: a soundtrack needs a timeline' + stack } } } : page.send(method, params)),
    }, { errors: [], phase: 'page navigation', signal: new AbortController().signal, version: { Browser: 'Edge/1' } });
  };
  await t.test('an example', async () => {
    await assert.rejects(runBrowserCheck({ pagePath: __filename }, { edge: refusing(inspectPiece) }),
      { message: 'browser: a: sound: a soundtrack needs a timeline', pageRefusal: true });
  });
  await t.test('a film', async () => {
    await assert.rejects(runBrowserCheck({ pagePath: __filename }, { edge: refusing(inspectFilm) }),
      { message: 'browser: readout: sound: a soundtrack needs a timeline', pageRefusal: true });
  });
  // The page validates every example as it loads, before window.__artifex, so
  // that error names no example and keeps its stack.
  await t.test('the page load', async () => {
    const description = 'PieceError: sound: a soundtrack needs a timeline' + stack;
    const page = pageOf({});
    const loading = (html, options, work) => work({ command: options.command, send: page.send },
      { errors: [description], phase: 'page navigation', signal: new AbortController().signal, version: { Browser: 'Edge/1' } });
    const error = await runBrowserCheck({ pagePath: __filename }, { edge: loading }).then(() => null, (e) => e);
    assert.equal(error.pageRefusal, undefined, 'no page refusal');
    assert.equal(error.message, 'browser: page errors:\n' + description);
  });
});

test('CDP abort rejects connection startup and in-flight evaluation', async (t) => {
  const startup = new AbortController();
  const opening = connectCDP('ws://127.0.0.1/test', startup.signal, FakeSocket);
  startup.abort(new Error('startup deadline'));
  await assert.rejects(opening, /startup deadline/);
  assert.equal(FakeSocket.latest.closed, true);
  const { controller, socket, client } = await connection(t);
  const waiting = client.send('Runtime.evaluate', { expression: 'new Promise(() => {})' });
  controller.abort(new Error('evaluation deadline'));
  await assert.rejects(waiting, /evaluation deadline/);
  assert.equal(socket.closed, true);
  await assert.rejects(client.send('Page.enable'), /evaluation deadline/);
});

test('CDP disconnect rejects every pending request', async (t) => {
  const { socket, client } = await connection(t);
  const requests = [client.send('Page.enable'), client.send('Runtime.enable')];
  socket.close();
  const settled = await Promise.allSettled(requests);
  assert.ok(settled.every((result) => result.status === 'rejected' && /connection closed/.test(result.reason.message)));
});

test('browser launch failure closes owned resources without changing signal listeners', async () => {
  const tempRoot = await fs.realpath(os.tmpdir());
  const prefix = 'artifex-browser-' + process.pid + '-';
  const before = (await fs.readdir(tempRoot)).filter((name) => name.startsWith(prefix));
  const listeners = ['SIGINT', 'SIGTERM'].map((signal) => process.listenerCount(signal));
  // Node is a known executable which rejects Edge's command-line flags. This
  // proves lifecycle cleanup without depending on an installed GUI browser.
  // The longest deadline keeps a slow start under CPU load from preempting the
  // exit this test waits for.
  await assert.rejects(runBrowserCheck({ edge: process.execPath, pagePath: __filename, timeoutMs: 300000 }), /Edge exited before completion/);
  const after = (await fs.readdir(tempRoot)).filter((name) => name.startsWith(prefix));
  assert.deepEqual(after, before);
  assert.deepEqual(['SIGINT', 'SIGTERM'].map((signal) => process.listenerCount(signal)), listeners);
});

// A launcher stand-in: the process the run starts exits 0 at once, as an Edge that
// relaunches itself does, and `opened` says whether the browser it started opened its port.
const BROWSER_ENDPOINT = '/devtools/browser/3f2a9c1e-7b4d-4e8a-9d56-0c1b2a3d4e5f';
function relaunching(opened) {
  return (exe, args) => {
    const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), pid: 424242, exitCode: null, signalCode: null });
    const profile = args.find((arg) => arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
    Promise.resolve(opened && fs.writeFile(path.join(profile, 'DevToolsActivePort'), opened + '\n' + BROWSER_ENDPOINT))
      .then(() => { child.exitCode = 0; child.emit('exit', 0, null); });
    return child;
  };
}

// Takes the run's deadline timer (the first one of `ms`) so it fires when the page
// stalls, not `ms` after the start: under CPU load the launch alone can outlast it.
// A 60 s timer bounds a stall that never comes, and setTimeout is restored when the
// test ends. The returned function fires the deadline on the next tick. When the run
// never started a timer of that delay it fails the test in its end hook, naming the
// delay, because the run may swallow an error thrown from inside the fake socket.
function deadlineAtStall(t, ms) {
  const realSetTimeout = globalThis.setTimeout;
  let taken;
  let missed;
  globalThis.setTimeout = (fn, delay, ...rest) => {
    if (delay !== ms || taken) return realSetTimeout(fn, delay, ...rest);
    const timer = realSetTimeout(fn, 60000);
    taken = () => { clearTimeout(timer); fn(); };
    return timer;
  };
  t.after(() => {
    globalThis.setTimeout = realSetTimeout;
    assert.ok(!missed, missed);
  });
  return () => {
    if (!taken) missed = 'deadlineAtStall: the run started no ' + ms + ' ms timer before the stall, so there is no deadline to fire';
    else setImmediate(taken);
  };
}

test('an Edge launcher that exits 0 hands the browser over: the run goes on to its debugging port', async (t) => {
  const devtools = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/json/version') response.end(JSON.stringify({ Browser: 'Fake/1' }));
    else if (request.url === '/json/list') response.end(JSON.stringify([{ type: 'page', url: 'about:blank', webSocketDebuggerUrl: 'ws://127.0.0.1:1/none' }]));
    else response.writeHead(404).end();
  });
  await new Promise((resolve) => devtools.listen(0, '127.0.0.1', resolve));
  t.after(() => devtools.close());
  const tempRoot = await fs.realpath(os.tmpdir());
  const prefix = 'artifex-browser-' + process.pid + '-';
  const before = (await fs.readdir(tempRoot)).filter((name) => name.startsWith(prefix));
  // The stand-in's port answers, its socket refuses: the run reaches the CDP connection, not "Edge exited".
  await assert.rejects(
    withEdge('<title>x</title>', { edge: process.execPath, spawn: relaunching(devtools.address().port), timeoutMs: 20000 }, async () => 'unreachable'),
    /CDP WebSocket failed|CDP connection closed/);
  assert.deepEqual((await fs.readdir(tempRoot)).filter((name) => name.startsWith(prefix)), before, 'the profile is removed');
});

test('an Edge launcher that exits 0 and never opens a port fails after the hand-off window', async () => {
  await assert.rejects(
    withEdge('<title>x</title>', { edge: process.execPath, spawn: relaunching(0), handoffMs: 300, timeoutMs: 20000 }, async () => 'unreachable'),
    /Edge exited before completion \(0\)/);
});

test('browser stop waits for the owned Edge to exit and fails while it keeps running', async () => {
  // The kill is injected, so no real process is signalled.
  const root = { pid: 424242, exitCode: null, signalCode: null };
  let calls = 0;
  const kill = async () => { calls++; };
  await stopBrowser(root, delay(200), { limitMs: 5000, kill });
  assert.equal(calls, 1);
  // Node times a timer from the event loop's cached whole milliseconds, so it
  // can fire a little early: a correct stop waits over 498 ms here.
  const started = performance.now();
  await assert.rejects(stopBrowser(root, new Promise(() => {}), { limitMs: 500, kill }),
    /could not stop owned Edge process 424242 within 500 ms/, 'an Edge whose exit is never seen is not stopped');
  assert.ok(performance.now() - started >= 500 - 2, 'the exit is awaited until the limit');
  await assert.rejects(stopBrowser(root, Promise.resolve(), { kill: async () => { throw new Error('spawn taskkill.exe ENOENT'); } }),
    /ENOENT/, 'a stop that cannot start fails');
  // A finished stop must not hold the command open until its 60 s bound.
  const started2 = performance.now();
  const lingering = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(require.resolve('../tools/check-browser.js'))})
    .stopBrowser({ pid: 424242, exitCode: null, signalCode: null }, Promise.resolve(), { limitMs: 60000, kill: async () => {} })`],
  { encoding: 'utf8', timeout: 90000, windowsHide: true });
  assert.equal(lingering.status, 0, lingering.stderr);
  assert.ok(performance.now() - started2 < 30000, 'the stop released its bound once Edge exited');
});

test('a relaunched browser that exits just before its kill off Windows is already stopped', async () => {
  const { stopRelaunched } = require('../tools/check-browser.js');
  // Stubbed, so no real process is signalled: the browser runs at the first
  // look, then exits before the SIGKILL lands, which throws ESRCH.
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  const { kill } = process;
  let alive = true;
  const signals = [];
  Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
  process.kill = (pid, signal) => {
    signals.push(signal);
    if (signal === 'SIGKILL') alive = false;
    if (signal === 'SIGKILL' || !alive) throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
    return true;
  };
  try {
    await stopRelaunched(424242);
  } finally {
    process.kill = kill;
    Object.defineProperty(process, 'platform', platform);
  }
  assert.ok(signals.includes('SIGKILL'), 'the kill was sent');
});

test('browser stop ends the real owned tree before it returns', { skip: process.platform !== 'win32' && 'taskkill tree stop is Windows-only' }, async (t) => {
  const pidsFile = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'artifex-stop-test-')), 'pids.json');
  t.after(() => fs.rm(path.dirname(pidsFile), { recursive: true, force: true }));
  const root = spawn(process.execPath, ['-e', `const c = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
    require('node:fs').writeFileSync(${JSON.stringify(pidsFile)}, JSON.stringify([process.pid, c.pid])); setInterval(() => {}, 1000);`], { stdio: 'ignore', windowsHide: true });
  const exited = new Promise((resolve) => root.once('exit', resolve));
  let pids;
  while (!pids) pids = await fs.readFile(pidsFile, 'utf8').then(JSON.parse).catch(() => delay(50));
  t.after(() => { for (const pid of pids) try { process.kill(pid, 'SIGKILL'); } catch { /* already stopped */ } });
  await stopBrowser(root, exited);
  assert.throws(() => process.kill(pids[0], 0), { code: 'ESRCH' }, 'the owned root has exited');
  // Its descendant ends with it; Windows completes that exit asynchronously.
  const deadline = performance.now() + 10000;
  while (performance.now() < deadline && (() => { try { process.kill(pids[1], 0); return true; } catch { return false; } })()) await delay(50);
  assert.throws(() => process.kill(pids[1], 0), { code: 'ESRCH' }, 'the descendant has exited');
});

test('browser profile removal retries a busy owned profile and refuses anything else', async () => {
  const tempRoot = await fs.realpath(os.tmpdir());
  const profile = path.join(tempRoot, 'artifex-browser-test-busy');
  const busy = (message) => Object.assign(new Error(message), { code: 'EBUSY' });
  let calls = 0;
  await removeProfile(profile, { limitMs: 5000, rm: async () => { if (++calls < 3) throw busy('busy'); } });
  assert.equal(calls, 3, 'removal is retried until the stopped processes release the profile');
  calls = 0;
  await assert.rejects(removeProfile(profile, { limitMs: 300, rm: async () => { calls++; throw busy('still busy'); } }), /still busy/);
  assert.ok(calls > 1);
  calls = 0;
  await assert.rejects(removeProfile(profile, { rm: async () => { calls++; throw Object.assign(new Error('denied'), { code: 'EACCES' }); } }), /denied/);
  assert.equal(calls, 1, 'other failures are not retried');
  for (const outside of [path.join(tempRoot, 'other-profile'), path.join(tempRoot, 'artifex-browser-x', 'nested'), os.homedir()]) {
    await assert.rejects(removeProfile(outside, { rm: () => assert.fail('removed ' + outside) }), /refusing cleanup outside/);
  }
});

test('a run whose checks passed prints its report before a cleanup-only failure', async (t) => {
  const logged = [];
  t.mock.method(console, 'log', (line) => logged.push(line));
  const report = { browser: 'Edge/1', mode: 'headless', pieces: [{ name: 'a' }, { name: 'b' }], films: [], errors: [] };
  const failure = Object.assign(new Error('browser: cleanup failed: stuck'), { report });
  await assert.rejects(main(['--json'], async () => { throw failure; }), /cleanup failed: stuck/);
  assert.deepEqual(JSON.parse(logged[0]), report);
  assert.match(logged[1], /^browser: 2 examples passed; no example has a timeline, so no film was exported; cleanup failed$/);
  logged.length = 0;
  await assert.rejects(main([], async () => { throw new Error('browser: page errors'); }), /page errors/);
  assert.deepEqual(logged, [], 'a failed check prints no report');
});

test('by default the browser check prints its summary and the path of its full report, and --json prints the report instead', async (t) => {
  const logged = [];
  t.mock.method(console, 'log', (line) => logged.push(line));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artifex-report-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const report = { browser: 'Edge/1', mode: 'headless', pieces: [{ name: 'a' }], films: [], errors: [] };
  const file = path.join(dir, 'out', 'browser.json');
  await main([], async () => report, path.join(dir, 'out'));
  assert.deepEqual(logged, ['browser: 1 examples passed; no example has a timeline, so no film was exported; owned browser, server and profile cleaned up', 'report: ' + file.split(path.sep).join('/')]);
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), report);
  logged.length = 0;
  const failure = Object.assign(new Error('browser: cleanup failed: stuck'), { report });
  await assert.rejects(main([], async () => { throw failure; }, path.join(dir, 'out')), /cleanup failed: stuck/);
  assert.match(logged[0], /; cleanup failed$/);
  assert.equal(logged[1], 'report: ' + file.split(path.sep).join('/'),'a cleanup-only failure still writes its report');
  logged.length = 0;
  await main(['--json'], async () => report, path.join(dir, 'json'));
  assert.deepEqual(JSON.parse(logged[0]), report);
  assert.equal(logged.length, 2);
  await assert.rejects(fs.stat(path.join(dir, 'json')), { code: 'ENOENT' }, '--json writes no file');
});

test('the browser check exports a film for every example that declares sound, else the first with a timeline, and the first with a box timeline', () => {
  const examples = require('../examples/index.js');
  const { validate } = require('../core/piece.js');
  // The traits the page reads for each registered example, in registry order.
  const traits = Object.keys(examples).map((name) => {
    const p = validate(examples[name]);
    return { name, sound: !!p.sound, time: !!p.time, reframe: !!p.reframe };
  });
  const sounding = traits.filter((example) => example.sound).map((example) => example.name);
  const reframed = traits.filter((example) => example.reframe).map((example) => example.name);
  assert.ok(sounding.length > 0, 'the registry declares sound');
  assert.ok(reframed.length > 0, 'the registry declares a box timeline');
  const chosen = filmsToExport(traits);
  assert.deepEqual(chosen.slice(0, sounding.length), sounding, 'every example that declares sound gets its film');
  assert.ok(chosen.includes(reframed[0]), 'the first example with a box timeline gets its film');
  assert.equal(chosen.length, new Set(sounding.concat(reframed[0])).size, 'one film more at most, not one per box or per reframed example');
  const example = (name, sound, time, reframe = false) => ({ name, sound, time, reframe });
  assert.deepEqual(filmsToExport([example('still', false, false), example('first', false, true), example('second', false, true)]),
    ['first'], 'without sound, the first example with a timeline');
  assert.deepEqual(filmsToExport([example('one', true, true), example('quiet', false, true), example('two', true, true)]), ['one', 'two']);
  assert.deepEqual(filmsToExport([example('still', false, false)]), [], 'without a timeline there is no film');
  assert.deepEqual(filmsToExport([example('one', true, true), example('box', false, true, true), example('box2', false, true, true)]),
    ['one', 'box'], 'the first box timeline joins the sound films, once');
  assert.deepEqual(filmsToExport([example('box', true, true, true), example('box2', false, true, true)]), ['box'], 'a sound film along a box timeline counts');
  assert.deepEqual(filmsToExport([example('box', false, true, true), example('late', false, true)]), ['box'], 'without sound, the first with a timeline may be it');
  // The page runs it from its source text alone.
  assert.deepEqual(new Function(`return (${filmsToExport.toString()});`)()([example('one', true, true), example('box', false, true, true)]), ['one', 'box']);
});

test('the browser check forces one named export fallback per run, and the default run none', () => {
  assert.equal('force' in parseArgs([]), false, 'the default run installs nothing');
  for (const force of Object.keys(FORCED)) assert.equal(parseArgs(['--force', force]).force, force);
  assert.deepEqual(Object.keys(FORCED).sort(), ['gpu-crash', 'no-aac', 'no-h264', 'no-webgl2']);
  for (const args of [['--force'], ['--force', 'no-opus'], ['--force', '--headed'], ['--force', 'no-aac', '--force', 'no-h264']]) {
    assert.throws(() => parseArgs(args), /usage/);
  }
});

test('each forced condition takes away one codec or context, from its source text, and leaves the rest to the browser', async () => {
  const vm = require('node:vm');
  // The page installs each condition from its source text alone, before it loads.
  const install = (force, globals) => vm.runInNewContext(`(${FORCED[force].install})();`, globals);
  const asked = [];
  const encoder = () => class { static async isConfigSupported(config) { asked.push(config.codec); return { supported: true, config }; } };

  const AudioEncoder = encoder();
  install('no-aac', { AudioEncoder });
  assert.equal((await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2' })).supported, false, 'AAC is refused');
  assert.equal((await AudioEncoder.isConfigSupported({ codec: 'opus' })).supported, true);
  const VideoEncoder = encoder();
  install('no-h264', { VideoEncoder });
  for (const codec of ['avc1.64001f', 'avc1.4d0028']) assert.equal((await VideoEncoder.isConfigSupported({ codec })).supported, false, codec);
  assert.equal((await VideoEncoder.isConfigSupported({ codec: 'vp8' })).supported, true);
  assert.deepEqual(asked, ['opus', 'vp8'], 'only the codecs left reach the browser');

  const canvas = () => class { getContext(type, options) { return { type, options }; } };
  const [HTMLCanvasElement, OffscreenCanvas] = [canvas(), canvas()];
  install('no-webgl2', { HTMLCanvasElement, OffscreenCanvas });
  for (const Canvas of [HTMLCanvasElement, OffscreenCanvas]) {
    assert.equal(new Canvas().getContext('webgl2', { antialias: false }), null, 'WebGL2 is hidden');
    assert.deepEqual(new Canvas().getContext('2d', { alpha: false }), { type: '2d', options: { alpha: false } });
  }
  const Element = canvas();
  install('no-webgl2', { HTMLCanvasElement: Element });
  assert.equal(new Element().getContext('webgl2'), null, 'a page without OffscreenCanvas is covered too');
  // The GPU crash is aimed at the CPU route's canvas, the one the export watches for a loss.
  const Crashed = canvas();
  install('gpu-crash', { HTMLCanvasElement: Crashed });
  assert.equal(new Crashed().getContext('webgl2'), null, 'a GPU-crash run hides WebGL2 too');
});

test('a GPU-crash run crashes the GPU process once a third of the first pass is drawn, and never during a redraw', async () => {
  const context = { signal: new AbortController().signal };
  // A page whose export reports `steps` of progress, one per read, then ends.
  const client = (steps) => {
    const sent = [];
    let read = 0;
    return {
      sent,
      async send(method, params) {
        sent.push(method);
        if (method === 'Browser.crashGpuProcess') return {};
        assert.equal(params.expression, 'globalThis.__artifexFilmDone || null');
        return { result: { value: steps[Math.min(read++, steps.length - 1)] } };
      },
    };
  };
  const never = new Promise(() => {});
  const first = client([null, { done: 5, total: 48, restart: null }, { done: 16, total: 48, restart: null }]);
  assert.equal(await crashPartway(first, context, never), 16);
  assert.deepEqual(first.sent.filter((m) => m === 'Browser.crashGpuProcess'), ['Browser.crashGpuProcess'], 'crashed once, at a third');
  const redrawn = client([{ done: 20, total: 48, restart: 'starting over: converting each frame' }]);
  let end;
  const ending = new Promise((resolve) => { end = resolve; });
  const waited = crashPartway(redrawn, context, ending);
  await delay(50);
  end();
  assert.equal(await waited, null, 'an export that ended uncrashed says so');
  assert.equal(redrawn.sent.includes('Browser.crashGpuProcess'), false, 'a pass drawn again is never crashed');
});

test('a GPU-crash run passes only a film that reports its canvas lost after the crash, and says where it crashed', async (t) => {
  const film = (extra) => ({ name: 'a', offered: 'mp4', frames: 48, conversion: 'cpu', rasterizer: null, rasterizerBeforeRedraw: 'gpu', contextLost: true, encoderError: null, crashedAt: 16, ...extra });
  for (const options of [{ force: 'gpu-crash' }, { force: 'gpu-crash', allowFallback: true }]) {
    assert.equal(routeVerdict(options, film()), null);
    assert.equal(routeVerdict(options, film({ contextLost: false, conversion: 'encoder' })),
      'a: the GPU process crashed at frame 16 of 48 and the film does not report its canvas lost, so it was not drawn again in memory');
    assert.equal(routeVerdict(options, film({ contextLost: false, encoderError: 'video: Error: EncodingError' })),
      'a: the GPU process crashed at frame 16 of 48 and the film does not report its canvas lost, so it was not drawn again in memory; the export reports video: Error: EncodingError');
    assert.equal(routeVerdict(options, film({ crashedAt: null })), 'a: the export ended before the GPU process could be crashed part-way through it');
  }
  // checkPage crashes the page's GPU part-way through its first film and carries where.
  const context = () => ({ errors: [], phase: 'page navigation', signal: new AbortController().signal, version: { Browser: 'Edge/1' } });
  const page = (lost) => {
    const inner = pageOf({ readout: { offered: 'mp4', frames: 48, conversion: 'cpu', contextLost: lost }, settle: { offered: 'mp4', frames: 48, conversion: 'cpu' } });
    return {
      crashed: 0,
      async send(method, params) {
        if (method === 'Browser.crashGpuProcess') { this.crashed++; return {}; }
        if (params.expression === 'globalThis.__artifexFilmDone || null') return { result: { value: { done: 16, total: 48, restart: null } } };
        return inner.send(method, params);
      },
    };
  };
  const passed = page(true);
  const report = await checkPage(passed, context(), { force: 'gpu-crash' });
  assert.deepEqual(report.films.map((f) => [f.name, f.crashedAt]), [['readout', 16]], 'one film, crashed at frame 16');
  assert.equal(passed.crashed, 1);
  await assert.rejects(checkPage(page(false), context(), { force: 'gpu-crash' }), { message: /^browser: readout: the GPU process crashed at frame 16 of 48 and the film does not report its canvas lost/ });
  // The summary names the condition, the crash and the redraw.
  const logged = [];
  t.mock.method(console, 'log', (line) => logged.push(line));
  await main(['--force', 'gpu-crash', '--json'], async () => ({ browser: 'Edge/1', mode: 'headless', forced: 'gpu-crash', pieces: [{ name: 'a' }], films: [film()], errors: [] }));
  assert.match(logged[1], /^browser with the GPU process crashed mid-export: 1 examples passed; film a .* colour converted on the CPU, the GPU process crashed at frame 16, drawn again in memory after frames first drawn on the GPU, decoded,/);
});

test('a forced run names its condition in its summary and report, and the default summary is unchanged', async (t) => {
  const logged = [];
  t.mock.method(console, 'log', (line) => logged.push(line));
  const run = (films) => async (options) => ({
    browser: 'Edge/1', mode: 'headless', ...(options.force && { forced: options.force }), pieces: [{ name: 'a' }], films, errors: [],
  });
  const mp4 = (soundCodec, conversion) => ({ name: 'a', offered: 'mp4', frames: 48, sound: {}, soundCodec, conversion });
  await main(['--json'], run([mp4('mp4a', 'gpu')]));
  assert.equal(JSON.parse(logged[0]).forced, undefined);
  assert.equal(logged[1], 'browser: 1 examples passed; film a offered as MP4 with WebM hidden, exported 48 frames with an AAC soundtrack,'
    + ' colour converted on the GPU, decoded, and named the page\'s recipe; owned browser, server and profile cleaned up');
  logged.length = 0;
  await main(['--json'], run([mp4('mp4a', 'encoder')]));
  assert.match(logged[1], /exported 48 frames with an AAC soundtrack, colour converted by the encoder, decoded,/, 'the encoder route reads as itself');
  for (const [force, films, summary] of [
    ['no-aac', [mp4('Opus', 'gpu')], /^browser with AAC refused: 1 examples passed; film a .* with an Opus soundtrack, colour converted on the GPU,/],
    ['no-webgl2', [mp4('mp4a', 'cpu')], /^browser with WebGL2 hidden: .* colour converted on the CPU,/],
    ['no-h264', [{ name: 'a', offered: 'webm', frames: 96, seconds: 4, refusals: [] }],
      /^browser with H\.264 refused: 1 examples passed; film a offered as WebM with MP4 hidden, recorded 96 frames lasting 4 s, decoded, and parsed with every frame;/],
    ['no-h264', [{ name: 'a', offered: 'webm', frames: 96, seconds: 4, refusals: [{ frames: 93, behindMs: 43, late: 'recorder' }, { frames: 95, behindMs: 50, late: 'drawing' }] }],
      /^browser with H\.264 refused: .* recorded 96 frames lasting 4 s after 2 refused recordings \(93 of 96 frames, recorder late; 95 of 96 frames, drawing late\), decoded,/],
  ]) {
    logged.length = 0;
    await main(['--force', force, '--json'], run(films));
    assert.equal(JSON.parse(logged[0]).forced, force, 'the report names the condition');
    assert.match(logged[1], summary);
  }
});

test('the browser check accepts a fallback colour route only when asked', () => {
  assert.equal('allowFallback' in parseArgs([]), false, 'the default run requires the encoder route');
  assert.equal(parseArgs(['--allow-fallback']).allowFallback, true);
  assert.deepEqual(parseArgs(['--force', 'no-aac', '--allow-fallback']), { timeoutMs: 60000, headed: false, force: 'no-aac', allowFallback: true });
});

// The loaded page, played by a CDP client that answers each evaluation the
// check makes by the function it runs there: one piece, and `films` by name,
// each with no flash unless it names its `flashes`. A
// value read in pieces is kept as JSON and handed back by slices, and a reply
// past 4 MiB fails as Node's WebSocket fails.
function pageOf(films, still = { size: [40, 20], painted: 255, unpainted: 0 }, pageStill = still) {
  const answer = (expression) => {
    const called = (fn) => expression.startsWith('(' + fn + ')(');
    if (expression === '(' + inspectStill + ')(' + pagePng + ')') return pageStill;
    // inspectFilm runs with frameMatch, soundMatch and loudnessMatch handed in; the film's name is its first argument.
    const film = '((frameMatch, soundMatch, loudnessMatch) => (' + inspectFilm + ')(';
    const name = () => JSON.parse(/^"[^"]*"/.exec(expression.slice(film.length))[0]);
    if (expression.startsWith('document.readyState')) return true;
    if (expression === 'window.__artifex.names') return ['a'];
    if (called(inspectPiece)) return { name: 'a' };
    if (called(inspectStill)) return still;
    if (called(filmsToExport)) return Object.keys(films);
    if (expression.startsWith(film)) return { name: name(), flashes: { general: 0, red: 0, worst: null }, ...films[name()] };
    throw new Error('unexpected evaluation: ' + expression.slice(0, 80));
  };
  let kept;
  return {
    async send(method, { expression }) {
      const whole = /^\(async \(\) => \(globalThis\.__artifexValue = JSON\.stringify\(await \(([\s\S]*)\)\)\)\.length\)\(\)$/.exec(expression);
      const piece = /^globalThis\.__artifexValue\.slice\((\d+), (\d+)\)$/.exec(expression);
      let value;
      if (whole) value = (kept = JSON.stringify(answer(whole[1]))).length;
      else if (piece) value = kept.slice(Number(piece[1]), Number(piece[2]));
      else if (expression === 'delete globalThis.__artifexValue') { kept = undefined; value = true; }
      else value = answer(expression);
      const reply = { result: { value } };
      if (JSON.stringify(reply).length > 4 * 1024 * 1024) throw new Error('browser: CDP WebSocket failed');
      return reply;
    },
  };
}

test('a still PNG must keep the pixels its piece leaves unpainted at alpha 0 and the ones it paints opaque', async (t) => {
  // inspectStill in Node: drawPng is handed the half-painted piece by name, and
  // the decoded PNG's alphas are read per half, unpremultiplied.
  const picture = (left, right) => {
    const data = new Uint8ClampedArray(40 * 20 * 4);
    for (let i = 0; i < 40 * 20; i++) data[i * 4 + 3] = i % 40 < 20 ? left : right;
    return data;
  };
  let pixels, asked;
  globalThis.window = { __artifex: { examples: {} } };
  t.after(() => { delete globalThis.window; delete globalThis.OffscreenCanvas; delete globalThis.createImageBitmap; });
  globalThis.createImageBitmap = async (blob, options) => { asked = options; return { width: 40, height: 20 }; };
  globalThis.OffscreenCanvas = class { getContext() { return { drawImage() {}, getImageData: () => ({ data: pixels }) }; } };
  const drawPng = async (name, seed, at, width, box, tool) => {
    const p = window.__artifex.examples[name];
    // npm run browser runs it, so drawPng's refusals open with "browser:".
    assert.deepEqual([p.size, seed, at, width, box, tool], [{ w: 40, h: 20 }, 1, 0, 40, null, 'browser']);
    return { png: btoa('PNG') };
  };
  pixels = picture(255, 0);
  assert.deepEqual(await inspectStill(drawPng), { size: [40, 20], painted: 255, unpainted: 0 });
  assert.deepEqual(asked, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  assert.deepEqual(window.__artifex.examples, {}, 'the piece is removed from the examples again');
  pixels = picture(254, 255);
  assert.deepEqual(await inspectStill(drawPng), { size: [40, 20], painted: 254, unpainted: 255 });
  // The verdict, and checkPage, refuse an opaque background, a faded paint and a wrong size.
  assert.equal(stillVerdict({ size: [40, 20], painted: 255, unpainted: 0 }), null);
  const opaque = { size: [40, 20], painted: 255, unpainted: 255 };
  assert.equal(stillVerdict(opaque), 'the still PNG gives pixels the piece left unpainted an alpha up to 255, not 0, so they are no longer transparent');
  assert.equal(stillVerdict({ size: [40, 20], painted: 128, unpainted: 0 }), 'the still PNG gives pixels the piece painted opaque an alpha down to 128, not 255');
  assert.equal(stillVerdict({ size: [80, 40], painted: 255, unpainted: 0 }), 'the still PNG is 80 x 40 pixels, not the piece\'s 40 x 20');
  const context = { errors: [], phase: 'page navigation', signal: new AbortController().signal, version: { Browser: 'Edge/1' } };
  const films = { readout: { offered: 'mp4', frames: 48, conversion: 'encoder' } };
  assert.deepEqual((await checkPage(pageOf(films), context, {})).still, { size: [40, 20], painted: 255, unpainted: 0 });
  await assert.rejects(checkPage(pageOf(films, opaque), context, {}), { message: /^browser: the still PNG gives pixels the piece left unpainted an alpha up to 255/ });
  assert.equal(context.phase, 'still PNG');
  // The page's PNG button, core/export.js png(), gets the same verdict.
  assert.deepEqual((await checkPage(pageOf(films), context, {})).pagePng, { size: [40, 20], painted: 255, unpainted: 0 });
  await assert.rejects(checkPage(pageOf(films, undefined, opaque), context, {}),
    { message: /^browser: the page's PNG 1x button: the still PNG gives pixels the piece left unpainted an alpha up to 255/ });
  assert.equal(context.phase, 'page PNG');
});

test('pagePng presses the page\'s PNG 1x button for the piece, catches the saved PNG without a download, and restores the selection', async (t) => {
  const saved = new Blob(['PNG']), made = URL.createObjectURL;
  const log = [];
  let selected = 'first';
  globalThis.window = { __artifex: {
    read: () => ({ name: selected, error: null }),
    select: (name) => { selected = name; log.push('select ' + name); },
    setSeed: (seed) => log.push('seed ' + seed),
  } };
  globalThis.HTMLAnchorElement = class { click() { log.push('download'); } };
  globalThis.document = { querySelector: (query) => ({ click() {
    log.push('press ' + query);
    URL.createObjectURL(saved);
    new HTMLAnchorElement().click();
  } }) };
  URL.createObjectURL = () => 'blob:saved';
  t.after(() => { delete globalThis.window; delete globalThis.document; delete globalThis.HTMLAnchorElement; URL.createObjectURL = made; });
  const drawn = await pagePng('browser-still-alpha', 1);
  assert.equal(drawn.blob, saved);
  assert.deepEqual(log, ['select browser-still-alpha', 'seed 1', 'press [data-png="1"]', 'select first']);
  new HTMLAnchorElement().click();
  assert.equal(log.at(-1), 'download', 'the anchor\'s click is restored');
});

test('a default browser run requires every MP4 film on the encoder route, and --allow-fallback accepts the GPU or CPU', async () => {
  const context = () => ({ errors: [], phase: 'page navigation', signal: new AbortController().signal, version: { Browser: 'Edge/1' } });
  const mp4 = (conversion) => ({ offered: 'mp4', frames: 48, conversion, rasterizer: conversion === 'cpu' ? 'gpu' : null });
  const check = (films, options = {}, at = context()) => checkPage(pageOf(films), at, options);
  const report = await check({ readout: mp4('encoder'), cues: mp4('encoder') });
  assert.deepEqual(report.films.map((film) => [film.name, film.conversion]), [['readout', 'encoder'], ['cues', 'encoder']]);
  assert.equal('allowFallback' in report, false);
  for (const route of ['gpu', 'cpu']) {
    const at = context();
    await assert.rejects(check({ readout: mp4('encoder'), cues: mp4(route) }, {}, at),
      { message: new RegExp('^browser: cues: the colour was converted on the ' + route.toUpperCase() + ', not by the encoder, .* pass --allow-fallback$') });
    assert.equal(at.phase, 'film export cues', 'the failure names the film');
    const allowed = await check({ readout: mp4(route) }, { allowFallback: true });
    assert.equal(allowed.allowFallback, true, 'the report says a fallback was accepted');
    assert.equal(allowed.films[0].conversion, route);
  }
  // A forced run keeps its own route: refusing AAC leaves the encoder route to
  // take, and with WebGL2 hidden only the CPU route exists.
  await assert.rejects(check({ readout: mp4('gpu') }, { force: 'no-aac' }), /converted on the GPU, not by the encoder/);
  assert.equal((await check({ readout: mp4('cpu') }, { force: 'no-webgl2' })).films[0].conversion, 'cpu');
  await assert.rejects(check({ readout: mp4('encoder') }, { force: 'no-webgl2', allowFallback: true }),
    { message: 'browser: readout: with WebGL2 hidden the colour was converted on the ENCODER, not the CPU' });
  // A WebM film is recorded, not converted, so it has no route to take.
  assert.equal((await check({ readout: { offered: 'webm', frames: 48 } }, { force: 'no-h264' })).films.length, 1);
});

test('a run forced to refuse AAC exports every film with sound, and every other forced run the first', async () => {
  const context = { errors: [], phase: 'page navigation', signal: new AbortController().signal, version: { Browser: 'Edge/1' } };
  const films = (conversion, rasterizer = conversion === 'cpu' ? 'gpu' : null) => ({ readout: { offered: 'mp4', frames: 48, conversion, rasterizer }, settle: { offered: 'mp4', frames: 48, conversion, rasterizer } });
  const names = async (options, conversion = 'encoder') => (await checkPage(pageOf(films(conversion)), context, options)).films.map((film) => film.name);
  assert.deepEqual(await names({ force: 'no-aac' }), ['readout', 'settle'], 'without AAC every soundtrack is decoded as Opus, settle\'s at its ceiling');
  assert.deepEqual(await names({ force: 'no-webgl2' }, 'cpu'), ['readout']);
  assert.deepEqual(await names({ force: 'no-h264' }), ['readout']);
  assert.deepEqual(await names({}), ['readout', 'settle']);
});

// A sheet part as screenshots of it: every row weighs `weigh(row)` bytes of PNG,
// each screenshot names its own rows, and a reply past what Node's WebSocket
// takes from the browser fails, as it does in Edge.
function sheetShots(weigh) {
  const calls = [];
  const shoot = async (from, count) => {
    calls.push([from, count]);
    let bytes = 64;
    for (let row = from; row < from + count; row++) bytes += weigh(row);
    if (4 * Math.ceil(bytes / 3) + 40 > 4 * 1024 * 1024) throw new Error('browser: CDP WebSocket failed');
    const png = Buffer.alloc(bytes);
    png.write(from + '+' + count);
    return png;
  };
  return { calls, shoot };
}

test('a sheet part too heavy for one screenshot reply is shot in pieces that each fit, top to bottom', async () => {
  // 1500 rows 1280 wide at 2400 bytes a row: 3.6 MB as one PNG, 4.8 MB as base64.
  const { calls, shoot } = sheetShots(() => 2400);
  await assert.rejects(shoot(0, 1500), /CDP WebSocket failed/, 'the whole part in one reply fails');
  calls.length = 0;
  const band = bandRows(1280);
  const pieces = await sheetPieces('out/drift-seeds.png', shoot, 1500, band);
  assert.deepEqual(calls.slice(0, 3), [[0, band], [band, band], [2 * band, 1500 - 2 * band]], 'weighed in bands that always fit');
  assert.deepEqual(pieces.map((p) => [p.file, p.from, p.rows]), [['out/drift-seeds-1-of-2.png', 0, 2 * band], ['out/drift-seeds-2-of-2.png', 2 * band, 1500 - 2 * band]],
    'as few pieces as fit, top to bottom, every row once');
  assert.deepEqual(calls.slice(3), [[0, 2 * band], [2 * band, 1500 - 2 * band]], 'each piece is shot again whole');
  for (const piece of pieces) {
    const label = piece.from + '+' + piece.rows;
    assert.equal(piece.png.toString('latin1', 0, label.length), label, 'each file is its own one screenshot');
  }
});

test('a sheet part that fits in one screenshot reply keeps its one file and screenshot', async () => {
  const band = bandRows(1280);
  const small = sheetShots(() => 5121);
  const [only] = await sheetPieces('out/drift-seeds.png', small.shoot, band, band);
  assert.deepEqual(small.calls, [[0, band]], 'rows that fit even uncompressed take one screenshot, as before');
  assert.deepEqual([only.file, only.from, only.rows, only.png.toString('latin1', 0, 5)], ['out/drift-seeds.png', 0, band, '0+' + band]);
  // Taller, but light enough: weighed in bands, then shot whole as one file.
  const light = sheetShots(() => 600);
  const pieces = await sheetPieces('out/drift-seeds.png', light.shoot, 1310, band);
  assert.deepEqual(light.calls, [[0, band], [band, band], [2 * band, 1310 - 2 * band], [0, 1310]]);
  assert.deepEqual(pieces.map((p) => [p.file, p.from, p.rows, p.png.toString('latin1', 0, 6)]), [['out/drift-seeds.png', 0, 1310, '0+1310']]);
});

test('a heavy sheet part is cut between rows of cells, never across one', async () => {
  // Four rows of cells 400 device rows tall at 2400 bytes a row: 0.96 MB each,
  // so three fit in one reply and a cut at a band would fall inside the second row.
  const band = bandRows(1280);
  const { calls, shoot } = sheetShots(() => 2400);
  const pieces = await sheetPieces('out/stride-at.png', shoot, 1600, band, [[400, 800, 1200]]);
  assert.deepEqual(pieces.map((p) => [p.file, p.from, p.rows]), [['out/stride-at-1-of-2.png', 0, 1200], ['out/stride-at-2-of-2.png', 1200, 400]],
    'each piece ends where a row of cells ends');
  assert.deepEqual(calls.slice(-2), [[0, 1200], [1200, 400]], 'each piece is shot whole');
  // A row too heavy for one reply is its own run of pieces, cut between its bands,
  // and the rows on either side start and end their own pieces.
  const heavy = sheetShots((row) => (row >= 200 && row < 1600 ? 2400 : 100));
  const split = await sheetPieces('out/stride-at.png', heavy.shoot, 1800, band, [[200, 1600]]);
  assert.deepEqual(split.map((p) => [p.from, p.rows]), [[0, 200], [200, 2 * band], [200 + 2 * band, 1400 - 2 * band], [1600, 200]]);
  // With cuts inside the cells, the heavy row is cut there instead of between bands;
  // a cut inside a row that fits is never used.
  const inner = sheetShots((row) => (row >= 200 && row < 1600 ? 2400 : 100));
  const within = await sheetPieces('out/stride-at.png', inner.shoot, 1800, band, [[200, 1600], [100, 600, 1000, 1700]]);
  assert.deepEqual(within.map((p) => [p.from, p.rows]), [[0, 200], [200, 800], [1000, 600], [1600, 200]]);
});

test('a sheet part is cut so no piece is taller than maxRows, even when its bytes fit', async () => {
  const band = bandRows(1280);
  const { shoot } = sheetShots(() => 100);
  const pieces = await sheetPieces('out/tall.png', shoot, 3 * band, band, [], 1000);
  assert.ok(pieces.every((p) => p.rows <= 1000), 'no piece past maxRows: ' + pieces.map((p) => p.rows));
  assert.equal(pieces.reduce((sum, p) => sum + p.rows, 0), 3 * band, 'every row once');
  assert.ok(pieces.length > 1 && pieces[1].file === 'out/tall-2-of-' + pieces.length + '.png');
});

test('a contact sheet is cut at the top of a whole cell, and inside one only where nothing crosses', () => {
  // Two columns of cells, the right caption a line longer, then a loupe under
  // each; a third cell below, then a reference photo whose border is its .photo box.
  const boxes = [
    ['h2', 0, 20], ['p', 24, 40],
    ['figure', 54, 552], ['canvas', 54, 300], ['figcaption', 307, 340], ['canvas', 350, 500], ['figcaption', 507, 530],
    ['figure', 54, 552], ['canvas', 54, 300], ['figcaption', 307, 362], ['canvas', 372, 522], ['figcaption', 529, 552],
    ['figure', 566.4, 852], ['canvas', 566.4, 812], ['figcaption', 819, 852],
    ['figure', 870, 1030], ['.photo', 870, 1000], ['img', 871, 999], ['figcaption', 1007, 1030],
  ];
  const document = {
    querySelectorAll: (selector) => boxes.filter(([kind]) => selector.split(', ').includes(kind))
      .map(([, top, bottom]) => ({ getBoundingClientRect: () => ({ top: top - 100, bottom: bottom - 100 }) })),
  };
  const [cells, inside] = new Function('document', 'window', 'return (' + sheetCuts + ')()')(document, { scrollY: 100 });
  // A loupe (350, 372) or a caption (307) is not a cut between whole cells; 566.4 floors to 566.
  assert.deepEqual(cells, [0, 24, 54, 566, 870]);
  // Inside the cells, 350 falls inside the right caption and 372 inside the left loupe;
  // the photo is cut above its border, never at its image.
  assert.deepEqual(inside, [0, 24, 54, 307, 566, 819, 870, 1007]);
});

test('a tall captured sheet is written at full scale, in parts of whole rows of cells', async () => {
  const vm = require('node:vm');
  const { captureSheet } = require('../tools/check-browser.js');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artifex-cuts-'));
  try {
    // Two sections; the second, from CSS pixel 1000 to 21000, is 20000 tall, past
    // the 8192 rows one file holds, and its rows of cells start at 1100, 5000,
    // 9000, 13000 and 17000. Light enough for one reply, it is cut for height alone.
    const box = (top, bottom) => ({ getBoundingClientRect: () => ({ top, bottom }) });
    const heads = [{ textContent: 'a', ...box(0, 20) }, { textContent: 'b', ...box(1016, 1036) }];
    const figures = [[1100, 4990], [5000, 8990], [9000, 12990], [13000, 16990], [17000, 20990]].map(([top, bottom]) => box(top, bottom));
    const page = vm.createContext({
      window: { __sheet: { names: ['a', 'b'], cells: [], failures: () => 0 }, scrollY: 0 },
      document: { querySelectorAll: (selector) => (selector === '#out > h2' ? heads : selector.startsWith('figure') ? [...heads, ...figures] : heads) },
    });
    const clips = [];
    const client = {
      async send(method, params) {
        if (method === 'Page.getLayoutMetrics') return { cssContentSize: { width: 1280, height: 21000 } };
        if (method === 'Page.captureScreenshot') {
          clips.push(params.clip);
          // 100 bytes a device row: the whole second part is 2 MB, which one reply carries.
          return { data: Buffer.alloc(64 + 100 * Math.floor(params.clip.height * params.clip.scale)).toString('base64') };
        }
        if (method !== 'Runtime.evaluate') return {};
        return { result: { value: await vm.runInContext(params.expression, page) } };
      },
    };
    const edge = (html, options, work) => work(client, { errors: [], phase: null });
    const { shots } = await captureSheet('<html></html>', path.join(dir, 'seeds'), { cells: 0 }, edge);
    assert.deepEqual(shots.map((s) => [path.basename(s.file), s.width, s.height]), [
      ['seeds-a.png', 1280, 1000],
      ['seeds-b-1-of-3.png', 1280, 8000], ['seeds-b-2-of-3.png', 1280, 8000], ['seeds-b-3-of-3.png', 1280, 4000],
    ], 'every file is full width, no taller than 8192 rows, and ends where a row of cells ends');
    // Each piece of the second part is shot at scale 1, from its heading or a cell's top.
    assert.deepEqual(clips.slice(-3).map((clip) => [clip.y, clip.height, clip.scale]), [[1000, 8000, 1], [9000, 8000, 1], [17000, 4000, 1]]);
    assert.ok(clips.every((clip) => clip.scale === 1 && clip.height <= 8192), 'no screenshot is scaled down or past 8192 rows');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('a sheet whose cells outlast the timeout names the stage and cell that stalled, and gives the hint only for the piece', async () => {
  const { captureSheet, SHEET_PROGRESS } = require('../tools/check-browser.js');
  // As in Edge: the sheet page logs each stage before running it, then a stage
  // stalls, so every command stays unanswered until withEdge's timer aborts,
  // and withEdge reports the phase its work had reached.
  // `answer(method, params)` replies to a command, or leaves it unanswered by returning undefined.
  const stall = async (logged, { from = 'page navigation', reach = true, answer = () => undefined } = {}) => {
    const controller = new AbortController();
    const client = {
      onEvent(listener) {
        for (const text of logged) listener({ method: 'Runtime.consoleAPICalled', params: { type: 'debug', args: [{ type: 'string', value: text }] } });
      },
      send: (method, params) => {
        const reply = answer(method, params);
        if (reply !== undefined) return Promise.resolve(reply);
        return new Promise((resolve, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason)));
      },
    };
    const edge = async (html, options, work) => {
      const context = { errors: [], phase: from, signal: controller.signal };
      setTimeout(() => controller.abort(new Error('browser: timed out after ' + options.timeoutMs + ' ms')), 10);
      try {
        if (!reach) await new Promise((resolve, reject) => controller.signal.addEventListener('abort', reject));
        // As withEdge does: the listener is added before navigation, then the work runs.
        options.listen(client, context);
        return await work(client, context);
      } catch { throw new Error(controller.signal.reason.message + ' during ' + context.phase); }
    };
    return (await captureSheet('<html></html>', 'unused', { cells: 9, timeoutMs: 60000 }, edge).catch((e) => e)).message;
  };
  const hint = /\nA slow piece needs more time: raise --timeout-ms, or draw fewer or smaller cells\.$/;
  const cell = 'pixel-field cell 4 of 9 (frame 54 · 2.250 s)';
  const drawing = await stall([SHEET_PROGRESS + 'piece build of ' + cell, 'unrelated', SHEET_PROGRESS + 'frame draw of ' + cell]);
  assert.equal(drawing.split('\n')[0], 'browser: timed out after 60000 ms during frame draw of ' + cell);
  assert.match(drawing, hint);
  // Seed sheets and --param sweeps share this capture and refuse --scale, so the hint names no strip flag.
  assert.doesNotMatch(drawing, /--frames|--scale/);
  const building = await stall([SHEET_PROGRESS + 'piece build of drift cell 2 of 9 (seed 2)']);
  assert.equal(building.split('\n')[0], 'browser: timed out after 60000 ms during piece build of drift cell 2 of 9 (seed 2)');
  assert.match(building, hint);
  // Stalls before the page runs any of the sheet's work are the browser's, and get no hint.
  for (const from of ['startup', 'CDP connection', 'page navigation']) {
    assert.equal(await stall([], { from, reach: false }), 'browser: timed out after 60000 ms during ' + from, from);
  }
  assert.equal(await stall([]), 'browser: timed out after 60000 ms during sheet page load');
  const sound = await stall([SHEET_PROGRESS + 'frame draw of ' + cell, SHEET_PROGRESS + 'soundtrack render']);
  assert.equal(sound.split('\n')[0], 'browser: timed out after 60000 ms during soundtrack render');
  assert.match(sound, hint);
  // A piece module heavy at load is the sheet's first stage, and gets the hint.
  const loading = await stall([SHEET_PROGRESS + 'piece module load']);
  assert.equal(loading.split('\n')[0], 'browser: timed out after 60000 ms during piece module load');
  assert.match(loading, hint);
  // The piece's setup before its cells, and the strip's flags and the results after them.
  for (const stage of ['piece setup of pixel-field', 'strip flags of pixel-field', 'sheet results']) {
    const stalled = await stall([SHEET_PROGRESS + 'frame draw of ' + cell, SHEET_PROGRESS + stage]);
    assert.equal(stalled.split('\n')[0], 'browser: timed out after 60000 ms during ' + stage, stage);
    assert.match(stalled, hint, stage);
  }
  // Every cell drawn, then Node's read-back of window.__sheet stalls over CDP: the browser's, with no hint.
  const readBack = await stall([SHEET_PROGRESS + 'sheet results'], {
    answer: (method, params) => method.startsWith('Emulation.') ? {} : method === 'Runtime.evaluate' && !params.expression.includes('__artifexValue') ? { result: { value: true } } : undefined,
  });
  assert.equal(readBack, 'browser: timed out after 60000 ms during sheet read-back');
  // Every cell drawn and read back, then the screenshot the sheet is cut from stalls.
  const ready = (method, params) => {
    if (method.startsWith('Emulation.')) return {};
    if (method !== 'Runtime.evaluate') return undefined;
    const value = params.expression.includes('__artifexValue = JSON.stringify') ? 2 : params.expression.includes('.slice(') ? '{}' : true;
    return { result: { value } };
  };
  const capture = await stall([SHEET_PROGRESS + 'frame draw of ' + cell], { answer: ready });
  assert.equal(capture.split('\n')[0], 'browser: timed out after 60000 ms during sheet capture');
  assert.match(capture, hint);
});

test('a sheet hears a stage the page logs before its navigation is answered', async (t) => {
  const { captureSheet, SHEET_PROGRESS } = require('../tools/check-browser.js');
  const devtools = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/json/version') response.end(JSON.stringify({ Browser: 'Fake/1' }));
    else if (request.url === '/json/list') response.end(JSON.stringify([{ type: 'page', url: 'about:blank', webSocketDebuggerUrl: 'ws://127.0.0.1:1/fake' }]));
    else response.writeHead(404).end();
  });
  await new Promise((resolve) => devtools.listen(0, '127.0.0.1', resolve));
  t.after(() => devtools.close());
  // A CDP socket that answers every command at once, except the page's
  // evaluations, which stall; the page logs its first stage just before the
  // navigation's reply, as Edge can. The run's 2000 ms deadline fires when the
  // page stalls, not 2000 ms after the start: under CPU load the launch or the
  // connection alone can outlast it. The 60 s timer bounds a stall that never comes.
  const deadline = deadlineAtStall(t, 2000);
  const sent = [];
  class Socket extends FakeSocket {
    constructor(url) { super(url); queueMicrotask(() => this.open()); }
    send(data) {
      const { id, method } = JSON.parse(data);
      sent.push(method);
      if (method === 'Runtime.evaluate') { deadline(); return; }
      if (method === 'Page.navigate') {
        this.reply({ method: 'Runtime.consoleAPICalled', params: { type: 'debug', args: [{ type: 'string', value: SHEET_PROGRESS + 'piece setup of drift' }] } });
      }
      this.reply({ id, result: {} });
    }
  }
  const failure = await captureSheet('<html></html>', 'unused', {
    cells: 1, images: false, edge: process.execPath, spawn: relaunching(devtools.address().port), WebSocket: Socket, timeoutMs: 2000,
  }).catch((error) => error);
  assert.ok(sent.includes('Page.navigate') && sent.includes('Runtime.evaluate'), 'the run navigated and waited on the page: ' + sent.join(', '));
  assert.equal(failure.message.split('\n')[0], 'browser: timed out after 2000 ms during piece setup of drift');
  assert.match(failure.message, /\nA slow piece needs more time/);
});

test('a timed-out sheet whose relaunched Edge ignores Browser.close stops that browser, removes its profile and gives the hint under the timeout', async (t) => {
  const { captureSheet, SHEET_PROGRESS } = require('../tools/check-browser.js');
  const devtools = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/json/version') response.end(JSON.stringify({ Browser: 'Fake/1', webSocketDebuggerUrl: 'ws://127.0.0.1:1/devtools/browser/fake' }));
    else if (request.url === '/json/list') response.end(JSON.stringify([{ type: 'page', url: 'about:blank', webSocketDebuggerUrl: 'ws://127.0.0.1:1/devtools/page/fake' }]));
    else response.writeHead(404).end();
  });
  await new Promise((resolve) => devtools.listen(0, '127.0.0.1', resolve));
  t.after(() => devtools.close());
  // The relaunched browser: a process of its own, started in the profile so it
  // holds it, as Edge's browser holds its files. Browser.close goes unanswered
  // and leaves it running, as a renderer stuck in a draw keeps Edge from closing.
  let browser;
  const launch = relaunching(devtools.address().port);
  const spawnEdge = (exe, args) => {
    const profile = args.find((arg) => arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
    browser = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd: profile, stdio: 'ignore', windowsHide: true });
    return launch(exe, args);
  };
  t.after(() => { try { process.kill(browser.pid, 'SIGKILL'); } catch { /* already stopped */ } });
  // The run's 2000 ms deadline fires when the page stalls, not 2000 ms after the
  // start: under CPU load the launch alone can outlast it, and a deadline before
  // the browser's id is learned leaves nothing to stop. The 60 s timer bounds a
  // stall that never comes.
  const deadline = deadlineAtStall(t, 2000);
  class Socket extends FakeSocket {
    constructor(url) { super(url); queueMicrotask(() => this.open()); }
    send(data) {
      const { id, method } = JSON.parse(data);
      if (method === 'SystemInfo.getProcessInfo') this.reply({ id, result: { processInfo: [{ type: 'browser', id: browser.pid }, { type: 'renderer', id: 1 }] } });
      else if (method === 'Page.navigate') {
        this.reply({ method: 'Runtime.consoleAPICalled', params: { type: 'debug', args: [{ type: 'string', value: SHEET_PROGRESS + 'frame draw of pixel-field cell 4 of 9' }] } });
        this.reply({ id, result: {} });
      } else if (method === 'Runtime.evaluate') deadline();
      else if (method !== 'Browser.close') this.reply({ id, result: {} });
    }
  }
  const tempRoot = await fs.realpath(os.tmpdir());
  const prefix = 'artifex-browser-' + process.pid + '-';
  const before = (await fs.readdir(tempRoot)).filter((name) => name.startsWith(prefix));
  const failure = await captureSheet('<html></html>', 'unused', {
    cells: 9, images: false, edge: process.execPath, spawn: spawnEdge, WebSocket: Socket, timeoutMs: 2000,
  }).catch((error) => error);
  assert.throws(() => process.kill(browser.pid, 0), { code: 'ESRCH' }, 'the relaunched browser is stopped');
  assert.deepEqual(failure.message.split('\n').slice(0, 2), [
    'browser: timed out after 2000 ms during frame draw of pixel-field cell 4 of 9',
    'A slow piece needs more time: raise --timeout-ms, or draw fewer or smaller cells.',
  ]);
  assert.doesNotMatch(failure.message, /cleanup failed/);
  assert.deepEqual((await fs.readdir(tempRoot)).filter((name) => name.startsWith(prefix)), before, 'the profile is removed');
});

test('a timed-out sheet whose cleanup also fails gives the hint under the timeout, before the cleanup failure', async () => {
  const { captureSheet } = require('../tools/check-browser.js');
  // withEdge's failure as it reads when the stop or the profile removal fails too.
  const edge = async () => {
    throw new Error('browser: timed out after 2000 ms during frame draw of pixel-field cell 4 of 9\n'
      + 'browser: cleanup failed: browser: could not stop owned Edge process 424242 within 500 ms');
  };
  const failure = await captureSheet('<html></html>', 'unused', { cells: 9, images: false }, edge).catch((error) => error);
  assert.deepEqual(failure.message.split('\n'), [
    'browser: timed out after 2000 ms during frame draw of pixel-field cell 4 of 9',
    'A slow piece needs more time: raise --timeout-ms, or draw fewer or smaller cells.',
    'browser: cleanup failed: browser: could not stop owned Edge process 424242 within 500 ms',
  ]);
});

test('cleanup kills a relaunched browser\'s process id only while that browser\'s endpoint still reports it', async (t) => {
  const devtools = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/json/version') response.end(JSON.stringify({ Browser: 'Fake/1', webSocketDebuggerUrl: 'ws://127.0.0.1:1/devtools/browser/fake' }));
    else if (request.url === '/json/list') response.end(JSON.stringify([{ type: 'page', url: 'about:blank', webSocketDebuggerUrl: 'ws://127.0.0.1:1/devtools/page/fake' }]));
    else response.writeHead(404).end();
  });
  await new Promise((resolve) => devtools.listen(0, '127.0.0.1', resolve));
  t.after(() => devtools.close());
  // The browser reports this id at startup, then exits, and the id now names an
  // unrelated process: the browser endpoint no longer answers at cleanup.
  const stranger = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd: os.tmpdir(), stdio: 'ignore', windowsHide: true });
  t.after(() => { try { process.kill(stranger.pid, 'SIGKILL'); } catch { /* already stopped */ } });
  let asked = 0;
  class Socket extends FakeSocket {
    constructor(url) {
      super(url);
      const gone = url.includes('/devtools/browser/') && asked++ > 0;
      queueMicrotask(() => (gone ? this.dispatchEvent(new Event('error')) : this.open()));
    }
    send(data) {
      const { id, method } = JSON.parse(data);
      if (method === 'SystemInfo.getProcessInfo') this.reply({ id, result: { processInfo: [{ type: 'browser', id: stranger.pid }] } });
      else this.reply({ id, result: {} });
    }
  }
  const result = await withEdge('<title>x</title>', {
    edge: process.execPath, spawn: relaunching(devtools.address().port), WebSocket: Socket, timeoutMs: 20000,
  }, async () => 'done');
  assert.equal(result, 'done');
  assert.doesNotThrow(() => process.kill(stranger.pid, 0), 'the process that took the id is left running');
  assert.equal(asked, 2, 'cleanup asked the browser endpoint again');
});

test('a deadline that fires before a relaunched browser\'s process id is learned still stops that browser and removes its profile', async (t) => {
  const devtools = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/json/version') response.end(JSON.stringify({ Browser: 'Fake/1', webSocketDebuggerUrl: 'ws://127.0.0.1:1/devtools/browser/fake' }));
    else response.writeHead(404).end();
  });
  await new Promise((resolve) => devtools.listen(0, '127.0.0.1', resolve));
  t.after(() => devtools.close());
  // The relaunched browser holds its profile, as Edge's browser holds its files.
  let browser;
  const launch = relaunching(devtools.address().port);
  const spawnEdge = (exe, args) => {
    const profile = args.find((arg) => arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
    browser = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd: profile, stdio: 'ignore', windowsHide: true });
    return launch(exe, args);
  };
  t.after(() => { try { process.kill(browser.pid, 'SIGKILL'); } catch { /* already stopped */ } });
  // The run's deadline fires while the first id lookup waits for its answer.
  const deadline = deadlineAtStall(t, 2001);
  let asked = 0;
  class Socket extends FakeSocket {
    constructor(url) { super(url); queueMicrotask(() => this.open()); }
    send(data) {
      const { id, method } = JSON.parse(data);
      if (method !== 'SystemInfo.getProcessInfo') return;
      if (asked++ === 0) deadline();
      else this.reply({ id, result: { processInfo: [{ type: 'browser', id: browser.pid }] } });
    }
  }
  const tempRoot = await fs.realpath(os.tmpdir());
  const prefix = 'artifex-browser-' + process.pid + '-';
  const before = (await fs.readdir(tempRoot)).filter((name) => name.startsWith(prefix));
  const failure = await withEdge('<title>x</title>', {
    edge: process.execPath, spawn: spawnEdge, WebSocket: Socket, timeoutMs: 2001,
  }, async () => 'unreachable').catch((error) => error);
  assert.equal(asked, 2, 'cleanup asked the browser endpoint for its id');
  assert.throws(() => process.kill(browser.pid, 0), { code: 'ESRCH' }, 'the relaunched browser is stopped');
  assert.equal(failure.message, 'browser: timed out after 2001 ms during startup');
  assert.deepEqual((await fs.readdir(tempRoot)).filter((name) => name.startsWith(prefix)), before, 'the profile is removed');
});

test('a relaunched browser that never offers a page is asked to close through the injected CDP socket', async (t) => {
  const devtools = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/json/version') response.end(JSON.stringify({ Browser: 'Fake/1' }));
    else if (request.url === '/json/list') response.end('[]');
    else response.writeHead(404).end();
  });
  await new Promise((resolve) => devtools.listen(0, '127.0.0.1', resolve));
  t.after(() => devtools.close());
  const sent = [];
  class Socket extends FakeSocket {
    constructor(url) { super(url); queueMicrotask(() => this.open()); }
    send(data) {
      const { id, method } = JSON.parse(data);
      sent.push(this.url + ' ' + method);
      this.reply({ id, result: {} });
    }
  }
  const tempRoot = await fs.realpath(os.tmpdir());
  const prefix = 'artifex-browser-' + process.pid + '-';
  const before = (await fs.readdir(tempRoot)).filter((name) => name.startsWith(prefix));
  const failure = await withEdge('<title>x</title>', {
    edge: process.execPath, spawn: relaunching(devtools.address().port), WebSocket: Socket, timeoutMs: 400,
  }, async () => 'unreachable').catch((error) => error);
  assert.equal(failure.message, 'browser: timed out after 400 ms during startup');
  assert.deepEqual(sent, ['ws://127.0.0.1:' + devtools.address().port + BROWSER_ENDPOINT + ' Browser.close'],
    'cleanup closed the browser its DevToolsActivePort names');
  assert.deepEqual((await fs.readdir(tempRoot)).filter((name) => name.startsWith(prefix)), before, 'the profile is removed');
});

test('cleanup does not open a socket from a DevToolsActivePort whose port is not digits', async () => {
  // The file is malformed from the launch, so startup validates nothing and
  // cleanup is the one that reads it. The endpoint is a valid one, so only the
  // port check can refuse the file.
  const opened = [];
  class Socket extends FakeSocket {
    constructor(url) { super(url); opened.push(url); queueMicrotask(() => this.open()); }
    send(data) { this.reply({ id: JSON.parse(data).id, result: {} }); }
  }
  const spawnEdge = (exe, args) => {
    const file = path.join(args.find((arg) => arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length), 'DevToolsActivePort');
    writeFileSync(file, '5000x\n' + BROWSER_ENDPOINT);
    return relaunching(0)(exe, args);
  };
  const failure = await withEdge('<title>x</title>', {
    edge: process.execPath, spawn: spawnEdge, WebSocket: Socket, timeoutMs: 400, closeMs: 300,
  }, async () => 'unreachable').catch((error) => error);
  assert.equal(failure.message, 'browser: timed out after 400 ms during startup');
  assert.deepEqual(opened.filter((url) => url.includes('5000x')), [], 'no socket was opened to a malformed URL');
});

test('cleanup reads a half-written DevToolsActivePort again and still closes the browser', async () => {
  // Half-written from the launch, so startup never reads a complete file: the
  // endpoint is cut inside the browser id and is completed only after the run's
  // 400 ms deadline, when cleanup is already reading it.
  const port = 45678;
  const sent = [];
  class Socket extends FakeSocket {
    constructor(url) { super(url); queueMicrotask(() => this.open()); }
    send(data) {
      const { id, method } = JSON.parse(data);
      sent.push(this.url + ' ' + method);
      this.reply({ id, result: {} });
    }
  }
  const spawnEdge = (exe, args) => {
    const file = path.join(args.find((arg) => arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length), 'DevToolsActivePort');
    writeFileSync(file, port + '\n' + BROWSER_ENDPOINT.slice(0, -20));
    setTimeout(() => fs.writeFile(file, port + '\n' + BROWSER_ENDPOINT).catch(() => {}), 600);
    return relaunching(0)(exe, args);
  };
  await withEdge('<title>x</title>', {
    edge: process.execPath, spawn: spawnEdge, WebSocket: Socket, handoffMs: 60000, timeoutMs: 400,
  }, async () => 'unreachable').catch((error) => error);
  assert.deepEqual(sent, ['ws://127.0.0.1:' + port + BROWSER_ENDPOINT + ' Browser.close'],
    'the complete file was read on a later try and the browser was closed');
});

test('cleanup closes the endpoint startup validated when the port file changes afterwards', async (t) => {
  let profile;
  const devtools = http.createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/json/version') response.end(JSON.stringify({ Browser: 'Fake/1' }));
    else if (request.url === '/json/list') {
      // A complete but different endpoint, written after startup read the file.
      await fs.writeFile(path.join(profile, 'DevToolsActivePort'), devtools.address().port + '\n/devtools/browser/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
      response.end('[]');
    } else response.writeHead(404).end();
  });
  await new Promise((resolve) => devtools.listen(0, '127.0.0.1', resolve));
  t.after(() => devtools.close());
  const sent = [];
  class Socket extends FakeSocket {
    constructor(url) { super(url); queueMicrotask(() => this.open()); }
    send(data) {
      const { id, method } = JSON.parse(data);
      sent.push(this.url + ' ' + method);
      this.reply({ id, result: {} });
    }
  }
  const spawnEdge = (exe, args) => {
    profile = args.find((arg) => arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
    return relaunching(devtools.address().port)(exe, args);
  };
  await withEdge('<title>x</title>', {
    edge: process.execPath, spawn: spawnEdge, WebSocket: Socket, timeoutMs: 400,
  }, async () => 'unreachable').catch((error) => error);
  assert.deepEqual(sent, ['ws://127.0.0.1:' + devtools.address().port + BROWSER_ENDPOINT + ' Browser.close'],
    'cleanup used the endpoint startup validated');
});

test('cleanup closes the current endpoint when the one startup validated stops answering', async (t) => {
  let profile;
  const rewritten = '/devtools/browser/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const devtools = http.createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/json/version') response.end(JSON.stringify({ Browser: 'Fake/1' }));
    else if (request.url === '/json/list') {
      // The browser relaunches again after startup: a new endpoint, the old one gone.
      await fs.writeFile(path.join(profile, 'DevToolsActivePort'), devtools.address().port + '\n' + rewritten);
      response.end('[]');
    } else response.writeHead(404).end();
  });
  await new Promise((resolve) => devtools.listen(0, '127.0.0.1', resolve));
  t.after(() => devtools.close());
  const sent = [];
  class Socket extends FakeSocket {
    constructor(url) {
      super(url);
      queueMicrotask(() => (url.endsWith(BROWSER_ENDPOINT) ? this.dispatchEvent(new Event('error')) : this.open()));
    }
    send(data) {
      const { id, method } = JSON.parse(data);
      sent.push(this.url + ' ' + method);
      this.reply({ id, result: {} });
    }
  }
  const spawnEdge = (exe, args) => {
    profile = args.find((arg) => arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
    return relaunching(devtools.address().port)(exe, args);
  };
  await withEdge('<title>x</title>', {
    edge: process.execPath, spawn: spawnEdge, WebSocket: Socket, timeoutMs: 400,
  }, async () => 'unreachable').catch((error) => error);
  assert.deepEqual(sent, ['ws://127.0.0.1:' + devtools.address().port + rewritten + ' Browser.close'],
    'the endpoint startup validated refused, so cleanup closed the one the file now names');
});

test('cleanup keeps reading the port file within its bound until a relaunched browser rewrites it', async (t) => {
  let profile;
  const rewritten = '/devtools/browser/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const devtools = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/json/version') response.end(JSON.stringify({ Browser: 'Fake/1' }));
    else if (request.url === '/json/list') response.end('[]');
    else response.writeHead(404).end();
  });
  await new Promise((resolve) => devtools.listen(0, '127.0.0.1', resolve));
  t.after(() => devtools.close());
  const sent = [];
  class Socket extends FakeSocket {
    constructor(url) {
      super(url);
      if (!url.endsWith(BROWSER_ENDPOINT)) { queueMicrotask(() => this.open()); return; }
      // The endpoint startup validated refuses, and the file still names it
      // until the relaunched browser rewrites it, after cleanup's first re-read.
      queueMicrotask(() => this.dispatchEvent(new Event('error')));
      const { port } = devtools.address();
      setTimeout(() => fs.writeFile(path.join(profile, 'DevToolsActivePort'), port + '\n' + rewritten).catch(() => {}), 300);
    }
    send(data) {
      const { id, method } = JSON.parse(data);
      sent.push(this.url + ' ' + method);
      this.reply({ id, result: {} });
    }
  }
  const spawnEdge = (exe, args) => {
    profile = args.find((arg) => arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
    return relaunching(devtools.address().port)(exe, args);
  };
  await withEdge('<title>x</title>', {
    edge: process.execPath, spawn: spawnEdge, WebSocket: Socket, timeoutMs: 400, closeMs: 2000,
  }, async () => 'unreachable').catch((error) => error);
  assert.deepEqual(sent, ['ws://127.0.0.1:' + devtools.address().port + rewritten + ' Browser.close'],
    'cleanup read the file again until it named the new endpoint, and closed that browser');
});

test('cleanup closes the rewritten endpoint when /json/version never answered at startup', async (t) => {
  let profile;
  const rewritten = '/devtools/browser/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const devtools = http.createServer((request) => {
    // Never answers, but the file is rewritten while startup waits for it.
    if (request.url === '/json/version') writeFileSync(path.join(profile, 'DevToolsActivePort'), devtools.address().port + '\n' + rewritten);
  });
  await new Promise((resolve) => devtools.listen(0, '127.0.0.1', resolve));
  t.after(() => { devtools.closeAllConnections(); devtools.close(); });
  const sent = [];
  class Socket extends FakeSocket {
    constructor(url) { super(url); queueMicrotask(() => this.open()); }
    send(data) {
      const { id, method } = JSON.parse(data);
      sent.push(this.url + ' ' + method);
      this.reply({ id, result: {} });
    }
  }
  const spawnEdge = (exe, args) => {
    profile = args.find((arg) => arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
    return relaunching(devtools.address().port)(exe, args);
  };
  await withEdge('<title>x</title>', {
    edge: process.execPath, spawn: spawnEdge, WebSocket: Socket, handoffMs: 60000, timeoutMs: 400,
  }, async () => 'unreachable').catch((error) => error);
  assert.deepEqual(sent, ['ws://127.0.0.1:' + devtools.address().port + rewritten + ' Browser.close'],
    'the endpoint startup never validated was not passed to cleanup; the rewritten file was read');
});

test('cleanup does not take an endpoint whose /json/version body was not JSON as validated', async (t) => {
  let profile, closedPort;
  const other = '/devtools/browser/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const devtools = http.createServer((request, response) => {
    // Answers 200 with a body that is not JSON, then the file names an endpoint nothing listens on.
    if (request.url === '/json/version') writeFileSync(path.join(profile, 'DevToolsActivePort'), closedPort + '\n' + other);
    response.setHeader('content-type', 'text/plain');
    response.end('not json');
  });
  await new Promise((resolve) => devtools.listen(0, '127.0.0.1', resolve));
  t.after(() => { devtools.closeAllConnections(); devtools.close(); });
  const spare = http.createServer();
  await new Promise((resolve) => spare.listen(0, '127.0.0.1', resolve));
  closedPort = spare.address().port;
  await new Promise((resolve) => spare.close(resolve));
  const sent = [];
  class Socket extends FakeSocket {
    constructor(url) { super(url); queueMicrotask(() => this.open()); }
    send(data) {
      const { id, method } = JSON.parse(data);
      sent.push(this.url + ' ' + method);
      this.reply({ id, result: {} });
    }
  }
  const spawnEdge = (exe, args) => {
    profile = args.find((arg) => arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
    return relaunching(devtools.address().port)(exe, args);
  };
  await withEdge('<title>x</title>', {
    edge: process.execPath, spawn: spawnEdge, WebSocket: Socket, handoffMs: 60000, timeoutMs: 400,
  }, async () => 'unreachable').catch((error) => error);
  assert.deepEqual(sent, ['ws://127.0.0.1:' + closedPort + other + ' Browser.close'],
    'the endpoint whose body failed to parse was not passed to cleanup; the rewritten file was read');
});

test('cleanup stops reading a malformed port file at the injected bound', async () => {
  const started = performance.now();
  const spawnEdge = (exe, args) => {
    const profile = args.find((arg) => arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
    writeFileSync(path.join(profile, 'DevToolsActivePort'), '5000x\n/devtools/browser/fake');
    return relaunching(0)(exe, args);
  };
  await withEdge('<title>x</title>', {
    edge: process.execPath, spawn: spawnEdge, handoffMs: 60000, timeoutMs: 300, closeMs: 100,
  }, async () => 'unreachable').catch((error) => error);
  assert.ok(performance.now() - started < 1500, 'the bound was 100 ms, not 3 s: ' + Math.round(performance.now() - started) + ' ms');
});

test('a sheet part written again removes the earlier parts of its name, whatever their count', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artifex-parts-'));
  try {
    const planted = ['readout-frames.png', 'readout-frames-1-of-3.png', 'readout-frames-2-of-3.png', 'readout-frames-3-of-3.png',
      'readout-frames-sound.png', 'readout-frames-sound-1-of-2.png', 'readout-frames.html', 'readout.png'];
    for (const name of planted) await fs.writeFile(path.join(dir, name), 'stale');
    const file = path.join(dir, 'readout-frames.png');
    await writePieces(file, [1, 2].map((i) => ({ file: file.replace(/\.png$/, `-${i}-of-2.png`), png: Buffer.from('new ' + i) })));
    assert.deepEqual((await fs.readdir(dir)).sort(), ['readout-frames-1-of-2.png', 'readout-frames-2-of-2.png', 'readout-frames-sound-1-of-2.png',
      'readout-frames-sound.png', 'readout-frames.html', 'readout.png'], 'the stale parts and whole image are gone; other names stay');
    assert.equal(await fs.readFile(path.join(dir, 'readout-frames-2-of-2.png'), 'latin1'), 'new 2');
    await writePieces(file, [{ file, png: Buffer.from('whole') }]);
    assert.deepEqual((await fs.readdir(dir)).filter((name) => name.startsWith('readout-frames-') && /of/.test(name)), ['readout-frames-sound-1-of-2.png'],
      'one image written whole removes the parts of a longer earlier run');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('a sheet part held open by a viewer warns and the capture goes on', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artifex-locked-'));
  try {
    const locked = path.join(dir, 'readout-frames-1-of-3.png');
    await fs.writeFile(locked, 'stale');
    await fs.writeFile(path.join(dir, 'readout-frames-2-of-3.png'), 'stale');
    const file = path.join(dir, 'readout-frames.png');
    const warnings = [];
    // Windows refuses to remove a file a viewer holds open, with EBUSY or EPERM; the stand-in refuses the same way anywhere.
    const rm = async (target, ...rest) => {
      if (target === locked) throw Object.assign(new Error(`EBUSY: resource busy or locked, unlink '${target}'`), { code: 'EBUSY' });
      return fs.rm(target, ...rest);
    };
    const png = Buffer.from('new');
    await writePieces(file, [{ file, png }], { rm, warn: (message) => warnings.push(message) });
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes(locked), 'the warning names the file');
    assert.equal(await fs.readFile(file, 'latin1'), 'new', 'the capture wrote its image');
    assert.deepEqual((await fs.readdir(dir)).sort(), ['readout-frames-1-of-3.png', 'readout-frames.png'], 'the other stale part is gone');
    await assert.rejects(writePieces(file, [{ file, png }], { rm: async () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); }, warn: () => {} }),
      /EACCES/, 'another failure still stops the capture');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('a several-piece sheet removes the section images of pieces it no longer has, and only its own', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artifex-gone-'));
  try {
    const planted = ['seeds-drift.png', 'seeds-gone.png', 'seeds-gone-1-of-2.png', 'seeds-gone-2-of-2.png', 'seeds-kept-1-of-2.png',
      'seeds-reference-gone.png', 'seeds.html', 'seeds.png', 'gone-seeds.png', 'other-seeds-gone.png', 'seeds-gone.svg'];
    for (const name of planted) await fs.writeFile(path.join(dir, name), 'stale');
    const warnings = [];
    await removeGoneSections(path.join(dir, 'seeds'), ['drift', 'kept'], { warn: (message) => warnings.push(message) });
    assert.deepEqual((await fs.readdir(dir)).sort(), ['gone-seeds.png', 'other-seeds-gone.png', 'seeds-drift.png', 'seeds-gone.svg',
      'seeds-kept-1-of-2.png', 'seeds-reference-gone.png', 'seeds.html', 'seeds.png'], 'only the images of gone pieces are removed');
    assert.deepEqual(warnings, []);
    await removeGoneSections(path.join(dir, 'seeds-reference'), [], { warn: () => {} });
    assert.ok(!(await fs.readdir(dir)).includes('seeds-reference-gone.png'), 'the reference sheet clears its own');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('a captured sheet of several sections removes the images of sections it no longer has', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artifex-parts-gone-'));
  try {
    const planted = ['seeds-gone.png', 'seeds-gone-1-of-2.png', 'seeds-reference-keep.png', 'other-seeds-keep.png', 'seeds.png'];
    for (const name of planted) await fs.writeFile(path.join(dir, name), 'stale');
    const stem = path.join(dir, 'seeds');
    const parts = await sheetParts(stem, [{ name: 'drift', top: 0 }, { name: 'kept', top: 500 }], 900);
    assert.deepEqual(parts, [{ file: stem + '-drift.png', top: 0, bottom: 484 }, { file: stem + '-kept.png', top: 484, bottom: 900 }]);
    assert.deepEqual((await fs.readdir(dir)).sort(), ['other-seeds-keep.png', 'seeds-reference-keep.png', 'seeds.png'],
      'the gone section and its part are removed; other sheets\' images stay');
    assert.deepEqual(await sheetParts(stem, [{ name: 'drift', top: 0 }], 900), [{ file: stem + '.png', top: 0, bottom: 900 }]);
    assert.equal((await fs.readdir(dir)).length, 3, 'a one-section sheet removes nothing');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('a whole sheet part keeps its clip, and a piece is clipped from its first row', () => {
  assert.deepEqual(sheetClip(2400, 1280, 1310, 0, 1310), { x: 0, y: 2400, width: 1280, height: 1310, scale: 1 });
  assert.deepEqual(sheetClip(2400, 1280, 1310.4, 0, 1310), { x: 0, y: 2400, width: 1280, height: 1310.4, scale: 1 });
  assert.deepEqual(sheetClip(2400, 1280, 1310, 604, 604), { x: 0, y: 3004, width: 1280, height: 604, scale: 1 });
});

test('a band holds as many rows as fit in one reply even if no pixel compresses', () => {
  assert.ok((4 * SHOT_BYTES) / 3 + 65536 <= 4 * 1024 * 1024, 'a whole piece may weigh 64 KiB more than its bands and still fit');
  for (const w of [1280, 1234, 2280, 4000]) {
    const rows = bandRows(w);
    // Four bytes a pixel and a filter byte a row, stored uncompressed, as base64,
    // with 64 KiB for the reply's and the PNG's framing.
    const worst = (n) => 4 * Math.ceil((n * (1 + 4 * w)) / 3) + 65536;
    assert.ok(worst(rows) <= 4 * 1024 * 1024, w + ' px: ' + rows + ' rows fit');
    assert.ok(worst(rows + 20) > 4 * 1024 * 1024, w + ' px: and not many more');
  }
});

test('a value past the 4 MiB a reply may carry crosses from the page whole, in pieces', async () => {
  const vm = require('node:vm');
  const page = vm.createContext({});
  const film = { name: 'readout', frames: 168, webm: 'Q'.repeat(6 * 1024 * 1024) + '==' };
  vm.runInContext('globalThis.film = ' + JSON.stringify(film), page);
  // Each evaluation runs in the page; a reply past 4 MiB fails as Node's WebSocket fails.
  const replies = [];
  const client = {
    async send(method, { expression }) {
      const value = await vm.runInContext(expression, page);
      const reply = { result: { value } };
      replies.push(JSON.stringify(reply).length);
      if (replies.at(-1) > 4 * 1024 * 1024) throw new Error('browser: CDP WebSocket failed');
      return reply;
    },
  };
  await assert.rejects(evaluate(client, 'Promise.resolve(film)'), /CDP WebSocket failed/, 'the whole value in one reply fails');
  replies.length = 0;
  assert.deepEqual(await evaluateInPieces(client, 'Promise.resolve(film)'), film, 'the same value crosses whole in pieces');
  assert.ok(Math.max(...replies) <= PIECE_CHARS + 100, 'no reply carries more than one piece');
  assert.equal(vm.runInContext('typeof globalThis.__artifexValue', page), 'undefined', 'and the page lets its copy go');
});

test('a forced WebM run reads back a recording past 4 MiB whole', async () => {
  // 48 frames at 24 Hz, each block holding 100 kB: 4.8 MB, 6.4 MB as base64.
  const blocks = Array.from({ length: 48 }, (_, i) => {
    const t = Math.round((i * 1000) / 24), size = 4 + 100000;
    return [0xA3, 0x01, 0, 0, 0, 0, (size >> 16) & 255, (size >> 8) & 255, size & 255, 0x81, t >> 8, t & 255, 0x80, ...new Uint8Array(100000)];
  }).flat();
  const bytes = Uint8Array.from([0x1A, 0x45, 0xDF, 0xA3, 0x83, 0xA3, 0xA3, 0xA3, 0x18, 0x53, 0x80, 0x67, 0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
    0x15, 0x49, 0xA9, 0x66, 0x87, 0x2A, 0xD7, 0xB1, 0x83, 0x0F, 0x42, 0x40, 0x1F, 0x43, 0xB6, 0x75, 0xFF, 0xE7, 0x81, 0x00, ...blocks]);
  const webm = Buffer.from(bytes).toString('base64');
  assert.ok(webm.length > 4 * 1024 * 1024);
  const context = { errors: [], phase: 'page navigation', signal: new AbortController().signal, version: { Browser: 'Edge/1' } };
  const report = await checkPage(pageOf({ readout: { offered: 'webm', frames: 48, hz: 24, webm } }), context, { force: 'no-h264' });
  assert.equal(report.films[0].blocks, 48, 'every frame found in the bytes that came back');
  assert.equal('webm' in report.films[0], false, 'and the report carries no recording');
});

test('one function decides the colour route every film must take, for every run option', () => {
  const film = (offered, conversion) => ({ name: 'a', offered, conversion, rasterizer: conversion === 'cpu' ? 'gpu' : null });
  const runs = [[{}, 'default'], [{ allowFallback: true }, 'fallback'], [{ force: 'no-aac' }, 'no-aac'], [{ force: 'no-aac', allowFallback: true }, 'no-aac fallback'],
    [{ force: 'no-webgl2' }, 'no-webgl2'], [{ force: 'no-webgl2', allowFallback: true }, 'no-webgl2 fallback'], [{ force: 'no-h264' }, 'no-h264']];
  // The routes each run accepts from an MP4 film.
  const accepted = { default: ['encoder'], fallback: ['encoder', 'gpu', 'cpu'], 'no-aac': ['encoder'], 'no-aac fallback': ['encoder', 'gpu', 'cpu'],
    'no-webgl2': ['cpu'], 'no-webgl2 fallback': ['cpu'], 'no-h264': ['encoder'] };
  for (const [options, run] of runs) {
    for (const route of ['encoder', 'gpu', 'cpu']) {
      assert.equal(routeVerdict(options, film('mp4', route)) === null, accepted[run].includes(route), run + ' with ' + route);
    }
    assert.equal(routeVerdict(options, film('webm', undefined)), null, run + ': a WebM has no colour route');
  }
  assert.equal(routeVerdict({}, film('mp4', 'gpu')),
    'a: the colour was converted on the GPU, not by the encoder, so the encoder route fell back; on a machine without a usable GPU, pass --allow-fallback');
  assert.equal(routeVerdict({ force: 'no-webgl2' }, film('mp4', 'gpu')), 'a: with WebGL2 hidden the colour was converted on the GPU, not the CPU');
});

test('with WebGL2 hidden the CPU route must have drawn its film on the GPU, unless it was drawn again in memory or a fallback is accepted', () => {
  const cpu = (extra) => ({ name: 'a', offered: 'mp4', conversion: 'cpu', rasterizer: 'gpu', contextLost: false, encoderError: null, ...extra });
  const forced = { force: 'no-webgl2' };
  assert.equal(routeVerdict(forced, cpu()), null);
  assert.equal(routeVerdict(forced, cpu({ rasterizer: 'memory' })),
    'a: with WebGL2 hidden the film was drawn in memory, not on the GPU, so the browser no longer moves the CPU route\'s canvas to the GPU; on a machine without a usable GPU, pass --allow-fallback');
  assert.equal(routeVerdict(forced, cpu({ rasterizer: null })),
    'a: with WebGL2 hidden the film was drawn where a test pattern could not tell the GPU from memory, not on the GPU, so the browser no longer moves the CPU route\'s canvas to the GPU; on a machine without a usable GPU, pass --allow-fallback');
  for (const rasterizer of ['memory', null]) {
    assert.equal(routeVerdict({ ...forced, allowFallback: true }, cpu({ rasterizer })), null, rasterizer + ': --allow-fallback accepts it');
    // The fallback pass is not probed, so its report says null.
    assert.equal(routeVerdict(forced, cpu({ rasterizer, contextLost: true })), null, rasterizer + ': drawn again in memory after a GPU loss');
    assert.equal(routeVerdict(forced, cpu({ rasterizer, encoderError: 'video: Error: EncodingError' })), null, rasterizer + ': drawn again after a video encoder failed');
    assert.equal(routeVerdict(forced, cpu({ rasterizer, encoderError: 'sound: Error: EncodingError' })) === null, false,
      rasterizer + ': a soundtrack encoded again does not draw the film again');
    assert.equal(routeVerdict(forced, cpu({ rasterizer, encoderError: 'encoder route: Error: EncodingError' })) === null, false,
      rasterizer + ': a film converted after its encoder route was dropped was not drawn again in memory');
  }
  // Only the forced run requires it: a run accepting a fallback takes a CPU film drawn anywhere.
  assert.equal(routeVerdict({ allowFallback: true }, cpu({ rasterizer: 'memory' })), null);
});

test('with WebGL2 hidden a film drawn again in memory fails when the pass it replaced was drawn in memory too', () => {
  const again = (before, extra) => ({ name: 'a', offered: 'mp4', conversion: 'cpu', rasterizer: null, rasterizerBeforeRedraw: before, contextLost: false, encoderError: null, ...extra });
  const forced = { force: 'no-webgl2' };
  for (const extra of [{ contextLost: true }, { encoderError: 'video: Error: EncodingError' }]) {
    const why = extra.contextLost ? 'after a GPU loss' : 'after a video encoder failed';
    assert.equal(routeVerdict(forced, again('memory', extra)),
      'a: with WebGL2 hidden the film was drawn in memory before it was drawn again there, not on the GPU, so the browser no longer moves the CPU route\'s canvas to the GPU; on a machine without a usable GPU, pass --allow-fallback', why);
    assert.equal(routeVerdict(forced, again('gpu', extra)), null, why + ': the replaced pass was drawn on the GPU');
    assert.equal(routeVerdict(forced, again(null, extra)), null, why + ': the replaced pass could not tell, or was not on the CPU route');
    for (const before of ['memory', 'gpu']) assert.equal(routeVerdict({ ...forced, allowFallback: true }, again(before, extra)), null, before + ': --allow-fallback accepts it');
  }
});

test('the summary names where a film drawn again in memory was first drawn, and says nothing of a film drawn once', async (t) => {
  const logged = [];
  t.mock.method(console, 'log', (line) => logged.push(line));
  const summary = async (args, extra) => {
    logged.length = 0;
    const run = async () => ({ browser: 'Edge/1', mode: 'headless', pieces: [{ name: 'a' }], films: [{ name: 'a', offered: 'mp4', frames: 48, conversion: 'cpu', rasterizer: null, ...extra }], errors: [] });
    await main([...args, '--json'], run);
    return logged[1];
  };
  const forced = ['--force', 'no-webgl2'];
  const redrawn = { contextLost: true };
  assert.match(await summary(forced, { ...redrawn, rasterizerBeforeRedraw: 'gpu' }), /on the CPU, drawn again in memory after frames first drawn on the GPU, decoded/);
  assert.match(await summary(forced, { ...redrawn, rasterizerBeforeRedraw: 'memory' }), /on the CPU, drawn again in memory after frames first drawn in memory, decoded/);
  assert.match(await summary(forced, { ...redrawn, rasterizerBeforeRedraw: null }), /on the CPU, drawn again in memory after frames first drawn where a test pattern could not tell, decoded/);
  // Off the CPU route's watched pass no pattern ran, so a null reading claims nothing.
  const video = { encoderError: 'video: Error: EncodingError', conversion: 'encoder' };
  assert.match(await summary([], { ...video, rasterizerBeforeRedraw: null }), /by the encoder, drawn again in memory, decoded/);
  for (const [args, extra] of [[forced, { rasterizer: 'gpu', rasterizerBeforeRedraw: null }], [forced, {}], [[], { encoderError: 'sound: Error: EncodingError' }],
    [forced, { encoderError: 'encoder route: Error: EncodingError' }]]) {
    assert.doesNotMatch(await summary(args, extra), /drawn again|first drawn/);
  }
});

test('a run that accepts a fallback colour route says so in its summary', async (t) => {
  const logged = [];
  t.mock.method(console, 'log', (line) => logged.push(line));
  const run = async (options) => ({
    browser: 'Edge/1', mode: 'headless', ...(options.force && { forced: options.force }), ...(options.allowFallback && { allowFallback: true }),
    pieces: [{ name: 'a' }], films: [{ name: 'a', offered: 'mp4', frames: 48, sound: {}, soundCodec: 'mp4a', conversion: 'cpu' }], errors: [],
  });
  await main(['--allow-fallback', '--json'], run);
  assert.equal(JSON.parse(logged[0]).allowFallback, true);
  assert.match(logged[1], /^browser accepting a fallback colour route: 1 examples passed; film a .* colour converted on the CPU,/);
  logged.length = 0;
  await main(['--force', 'no-aac', '--allow-fallback', '--json'], run);
  assert.match(logged[1], /^browser with AAC refused, accepting a fallback colour route: 1 examples passed;/);
});

test('a sheet image waits until every planned cell has rendered or failed', (t) => {
  t.after(() => { delete globalThis.window; });
  const drawn = { error: null, markCount: 12 };
  const failed = { error: 'seed 2: build failed' };
  const pending = { error: null };
  const ready = (sheet, expected) => { globalThis.window = { __sheet: sheet }; return sheetReady(expected); };
  assert.equal(ready(undefined, 2), false, 'no sheet yet');
  assert.equal(ready({ cells: [drawn] }, 2), false, 'a cell is still missing');
  assert.equal(ready({ cells: [drawn, pending] }, 2), false, 'a cell has neither drawn nor failed');
  assert.equal(ready({ cells: [drawn, failed] }, 2), true, 'a failed cell counts as finished');
  assert.equal(ready({ cells: [drawn, drawn, drawn] }, 2), false, 'more cells than planned is not the planned sheet');
});

// A page whose films hold one flat colour per frame, for the two readers of
// decoded frames: the browser check's inspectFilm and replay's compareFilm.
// Drawing the video element itself shows each frame's blue 60 levels high, as
// Edge's element draw showed a software-decoded frame's blue up to 12 levels
// off; a VideoFrame made from the element holds the frame's own pixels. Counts
// the VideoFrames made and closed.
function filmPage(frames = 3, hz = 4) {
  const colour = (t) => [Math.round(200 * t) + 20, 100, 50];
  const heads = Array.from({ length: frames }, (_, i) => i / (frames - 1));
  const count = { made: 0, closed: 0 };
  const canvas = () => {
    const c = { width: 0, height: 0, rgb: [0, 0, 0] };
    c.getContext = () => ({
      canvas: c,
      clearRect() { c.rgb = [0, 0, 0]; },
      drawImage(source) { c.rgb = source.rgb; },
      getImageData(x, y, w, h) {
        const data = new Uint8ClampedArray(w * h * 4);
        for (let k = 0; k < data.length; k += 4) data.set([...c.rgb, 255], k);
        return { data };
      },
    });
    return c;
  };
  const video = () => {
    const v = { index: 0, muted: false, videoWidth: 32, videoHeight: 24, duration: frames / hz };
    Object.defineProperties(v, {
      src: { get: () => 'blob:film', set() { setTimeout(() => v.onloadeddata(), 0); } },
      currentTime: { get: () => (v.index + 0.5) / hz, set(s) { v.index = Math.min(frames - 1, Math.floor(s * hz)); setTimeout(() => v.onseeked(), 0); } },
      held: { get: () => colour(heads[v.index]) },
      rgb: { get: () => { const [r, g, b] = v.held; return [r, g, Math.min(255, b + 60)]; } },
    });
    return v;
  };
  class VideoFrame {
    constructor(source) { count.made++; this.rgb = source.held; }
    close() { count.closed++; }
  }
  const api = {
    examples: { a: { name: 'a', size: { w: 32, h: 24 }, time: { hz } } },
    piece: { validate: (p) => p, atBox: (p) => p, solve: () => ({}) },
    render: { playheads: () => heads, drawFrame: (g, p, s, t) => { g.canvas.rgb = colour(t); } },
    select() {}, read: () => ({ seed: 1 }),
    filmOffer: async () => ({ format: 'webm', reason: 'h264' }),
    video: async () => ({ blob: new Blob([Uint8Array.of(1, 2, 3)]), flashes: { general: 1, red: 0, worst: { kind: 'general', start: 0, flashes: 1, x: 0, y: 0, w: 32, h: 24 } } }),
  };
  const globals = {
    window: { __artifex: api }, VideoFrame, Blob, setTimeout, clearTimeout, atob, btoa,
    URL: { createObjectURL: () => 'blob:film', revokeObjectURL() {} },
    document: { createElement: (tag) => (tag === 'video' ? video() : canvas()), getElementById: (id) => ({ checkVisibility: () => id === 'video' }) },
  };
  return { globals, count };
}

// filmPage's film offered as MP4 with its replay manifest and a soundtrack the
// export reports as `sound` and the page's meter hears as `heard`: a tone
// rendered the same every time and decoded at the export's gain.
function soundFilmPage(sound, heard, levels = sound) {
  const { globals } = filmPage();
  const api = globals.window.__artifex;
  const length = 36000, samples = (scale) => Float32Array.from({ length }, (_, i) => scale * 0.1 * Math.sin(i / 10));
  const buffer = (scale) => { const xs = [samples(scale), samples(scale)]; return { numberOfChannels: 2, length, sampleRate: 48000, duration: length / 48000, getChannelData: (c) => xs[c] }; };
  // Exported at the page's default scale: a 32 x 24 box with its long edge at 1920 pixels.
  const manifest = { piece: 'a', seed: 1, film: { frames: 3, hz: 4, loop: false, scale: 60 } };
  const video = { width: 1920, height: 1440, timescale: 12000, delta: 3000, avcC: EDGE_AVCC, samples: [0, 1, 2].map((i) => ({ data: Uint8Array.of(i, 1, 2, 3), key: !i })) };
  Object.assign(api, {
    manifest: () => ({ piece: 'a', seed: 1, t: 0.5 }),
    filmOffer: async () => ({ format: 'mp4' }),
    film: async () => ({ blob: new Blob([muxMp4({ manifest, video })]), manifest, width: 1920, height: 1440, frames: 3, seconds: 0.75, sound, flashes: { general: 2, red: 0, worst: { kind: 'general', start: 0.25, flashes: 2, x: 0, y: 0, w: 32, h: 24 } } }),
    loudness: () => heard,
    // Levels in place by the export's gain, and reports as `levels` says, for the export's codec only.
    level: (b, codec) => {
      if (codec !== sound.codec) throw new Error('levelled for ' + codec);
      for (let c = 0; c < b.numberOfChannels; c++) { const x = b.getChannelData(c); for (let i = 0; i < x.length; i++) x[i] *= 10 ** (sound.gain / 20); }
      return { ...levels };
    },
  });
  api.examples.a.sound = {};
  api.render.renderSound = async () => buffer(1);
  // Every reference frame is drawn at the scale the film names.
  const draw = api.render.drawFrame;
  api.render.drawFrame = (g, p, s, t, opt) => { if (!opt || opt.scale !== 60) throw new Error('a reference drawn at scale ' + (opt && opt.scale)); return draw(g, p, s, t); };
  globals.OfflineAudioContext = class { async decodeAudioData() { return buffer(10 ** (sound.gain / 20)); } };
  globals.document.getElementById = (id) => ({ checkVisibility: () => id === 'film1' });
  return globals;
}

test('the browser check carries a shortfall into its film report, and refuses a film whose decoded loudness loudnessMatch refuses', async () => {
  const vm = require('node:vm');
  // As the page runs it, with frameMatch, soundMatch and loudnessMatch handed in, for an MP4 film.
  const run = (sound, heard, force, levels) => vm.runInNewContext(`((frameMatch, soundMatch, loudnessMatch) => (${inspectFilm})('a'${force ? `, '${force}'` : ''}))(${frameMatch}, ${soundMatch}, ${PAGE_LOUDNESS_MATCH})`,
    soundFilmPage(sound, heard, levels));
  const peaky = await run({ codec: 'mp4a', gain: 6, lufs: -18.2, dbtp: -1, short: 4.2 }, { lufs: -18.21, dbtp: -1.02 });
  assert.deepEqual([peaky.sound.gain, peaky.sound.lufs, peaky.sound.dbtp, peaky.sound.short], [6, -18.21, -1.02, 4.2], 'the level decoded, and the shortfall the export reports');
  const level = await run({ codec: 'mp4a', gain: 6, lufs: -14, dbtp: -3 }, { lufs: -14.01, dbtp: -3 });
  assert.equal('short' in JSON.parse(JSON.stringify(level.sound)), false, 'a film at -14 LUFS reports no shortfall');
  await assert.rejects(run({ codec: 'mp4a', gain: 6, lufs: -14, dbtp: -3 }, { lufs: -14.3, dbtp: -3 }),
    { message: 'a: the decoded soundtrack measures -14.30 LUFS and -3.00 dBTP, neither -14 LUFS nor -2 dBTP' });
  await assert.rejects(run({ codec: 'Opus', gain: 6, lufs: -14.05, dbtp: -1.2 }, { lufs: -14.04, dbtp: -0.94 }, 'no-aac'),
    { message: 'a: the decoded Opus soundtrack peaks at -0.94 dBTP, not under -1 dBTP' });
  // A fresh render the page levels otherwise than the export reported is refused.
  const limited = { codec: 'mp4a', measured: { lufs: -18, dbtp: 1 }, gain: 4, limited: 6.5, lufs: -14, dbtp: -1 };
  assert.equal((await run(limited, { lufs: -14.01, dbtp: -1.02 })).sound.limited, 6.5, 'the limiting the export reports');
  await assert.rejects(run(limited, { lufs: -14.01, dbtp: -1.02 }, undefined, { ...limited, limited: 6.49 }),
    { message: 'a: a fresh render levels to [{"lufs":-18,"dbtp":1},4,6.49,-14,-1,null] and the export reported [{"lufs":-18,"dbtp":1},4,6.5,-14,-1,null], as measured, gain, limited, lufs, dbtp, short' });
});

test('the browser check scores each decoded frame by the pixels its VideoFrame holds, and closes every frame', async () => {
  const vm = require('node:vm');
  const { globals, count } = filmPage();
  // As the page runs it, with frameMatch, soundMatch and loudnessMatch handed in, for a forced WebM film.
  const film = await vm.runInNewContext(`((frameMatch, soundMatch, loudnessMatch) => (${inspectFilm})('a', 'no-h264', async (record) => ({ report: await record(), refusals: [] })))(${frameMatch}, ${soundMatch}, ${PAGE_LOUDNESS_MATCH})`, globals);
  // Through Array.from: the page's arrays belong to another realm.
  assert.deepEqual(Array.from(film.decoded, (d) => [d.frame, d.psnrDb]), [[0, 99], [1, 99], [2, 99]], 'each frame read as the film holds it');
  assert.ok(film.decoded.every((d) => d.neighbourDb < 30), 'and unlike its neighbours');
  assert.deepEqual([count.made, count.closed], [3, 3], 'every VideoFrame closed');
});

test('under a GPU-crash run the page\'s film check leaves the export\'s progress for the crash, and a default run asks the export as before', async () => {
  const vm = require('node:vm');
  const inspect = async (force) => {
    const globals = soundFilmPage({ codec: 'mp4a', gain: 6, lufs: -14, dbtp: -3 }, { lufs: -14.01, dbtp: -3 });
    const api = globals.window.__artifex, film = api.film, given = [];
    api.film = async (opts) => { given.push(opts); if (opts) opts.onProgress(16, 48, null); return film(); };
    const page = vm.createContext(globals);
    await vm.runInContext(`((frameMatch, soundMatch, loudnessMatch) => (${inspectFilm})('a'${force ? `, '${force}'` : ''}))(${frameMatch}, ${soundMatch}, ${PAGE_LOUDNESS_MATCH})`, page);
    return { given, done: JSON.stringify(page.__artifexFilmDone) };
  };
  const plain = await inspect(null);
  assert.deepEqual([plain.given, plain.done], [[undefined], undefined], 'the default run passes no options and leaves nothing');
  assert.equal((await inspect('gpu-crash')).done, '{"done":16,"total":48,"restart":null}');
});

test('the page\'s film check carries the flash count the export reports, for an MP4 and a WebM film', async () => {
  const vm = require('node:vm');
  const inspect = (force, globals) => vm.runInNewContext(`((frameMatch, soundMatch, loudnessMatch) => (${inspectFilm})('a'${force ? `, '${force}', async (record) => ({ report: await record(), refusals: [] })` : ''}))(${frameMatch}, ${soundMatch}, ${PAGE_LOUDNESS_MATCH})`, globals);
  const mp4 = await inspect(null, soundFilmPage({ codec: 'mp4a', gain: 6, lufs: -14, dbtp: -3 }, { lufs: -14.01, dbtp: -3 }));
  assert.deepEqual(JSON.parse(JSON.stringify(mp4.flashes)), { general: 2, red: 0, worst: { kind: 'general', start: 0.25, flashes: 2, x: 0, y: 0, w: 32, h: 24 } });
  const webm = await inspect('no-h264', filmPage().globals);
  assert.equal(webm.flashes.general, 1, 'a WebM film carries its count too');
});

test('the browser check refuses an example film whose flash count warns, or that carries none', async () => {
  const context = () => ({ errors: [], phase: 'page navigation', signal: new AbortController().signal, version: { Browser: 'Edge/1' } });
  const worst = (flashes) => ({ kind: 'general', start: 1.5, flashes, x: 0, y: 0, w: 320, h: 240 });
  const film = (flashes, conversion = 'encoder') => ({ offered: 'mp4', frames: 48, conversion, rasterizer: conversion === 'cpu' ? 'gpu' : null, flashes });
  const three = { general: 3, red: 0, worst: worst(3) };
  const report = await checkPage(pageOf({ readout: film(three), cues: film({ general: 0, red: 0, worst: null }) }), context(), {});
  assert.deepEqual(report.films.map((f) => f.flashes), [three, { general: 0, red: 0, worst: null }], 'three flashes a second is within WCAG 2.3.1, and the report carries each count');
  const at = context();
  await assert.rejects(checkPage(pageOf({ readout: film(three), cues: film({ general: 4, red: 0, worst: worst(4) }) }), at, {}),
    { message: /^browser: cues: Warning: it flashes 4 times in the second from 1\.5 s \(brightness, / });
  assert.equal(at.phase, 'film export cues', 'the failure names the film');
  await assert.rejects(checkPage(pageOf({ readout: film({ general: 4, red: 4, worst: { ...worst(4), kind: 'red' } }, 'cpu') }), context(), { force: 'no-webgl2' }),
    { message: /^browser: readout: Warning: it flashes 4 times .*\(saturated red, / }, 'a forced run refuses it too');
  await assert.rejects(checkPage(pageOf({ readout: film(undefined) }), context(), {}), { message: 'browser: readout: the film carries no flash count' });
});

test('the browser check exports the flash fixture at its design size and requires a warning of more than three general and three red flashes', async (t) => {
  const { checkFlashFixture } = require('../tools/check-browser.js');
  const calls = [];
  const exportWith = (flashes) => async (target, film, options) => { calls.push({ name: target.name, piece: target.external.piece.name, film, options }); return { report: { flashes }, bytes: Buffer.alloc(0) }; };
  const warns = { general: 4, red: 5, worst: { kind: 'red', start: 1.125, flashes: 5, x: 280, y: 0, w: 320, h: 240 } };
  const options = { timeoutMs: 60000, headed: false };
  assert.deepEqual(await checkFlashFixture(options, exportWith(warns)), warns);
  assert.deepEqual(calls, [{ name: 'flash-film', piece: 'flash-film', film: { scale: 1 }, options }], 'the fixture, once, at its design size, in the run\'s Edge');
  for (const flashes of [undefined, { general: 0, red: 0, worst: null }, { ...warns, general: 3 }, { ...warns, red: 3 }, { general: 4, red: 4, worst: { ...warns.worst, flashes: 3 } }]) {
    await assert.rejects(checkFlashFixture(options, exportWith(flashes)),
      { message: /^browser: the flash fixture's film counted .*, not a warning of more than 3 general and 3 red flashes$/ }, JSON.stringify(flashes));
  }
  // The summary says what the fixture's count found.
  const logged = [];
  t.mock.method(console, 'log', (line) => logged.push(line));
  await main(['--json'], async () => ({ browser: 'Edge/1', mode: 'headless', pieces: [{ name: 'a' }], films: [], errors: [], flashFixture: warns }));
  assert.match(logged[1], /; no film flashed past WCAG 2\.3\.1, and the flash fixture's film warned of 4 general and 5 red flashes; owned browser/);
});

test('replay scores each decoded film frame by the pixels its VideoFrame holds, and closes every frame', async () => {
  const vm = require('node:vm');
  const { compareFilm } = require('../tools/replay.js');
  const { globals, count } = filmPage();
  const rows = await vm.runInNewContext(`(${compareFilm})('AQID', ${JSON.stringify({ piece: 'a', seed: 1, film: { scale: 1 } })}, [0, 1, 2])`, globals);
  assert.deepEqual(Array.from(rows, (r) => [r.frame, r.psnr]), [[0, 99], [1, 99], [2, 99]], 'each frame read as the film holds it');
  assert.ok(rows.every((r) => r.neighbours.every((n) => n.psnr < 30)), 'and unlike its neighbours');
  assert.deepEqual([count.made, count.closed], [3, 3], 'every VideoFrame closed');
});

test('a decoded frame matches its drawn frame only when it scores at least 30 dB and no neighbour scores higher', () => {
  // As the page runs it, from its source text alone.
  const match = new Function(`return (${frameMatch});`)();
  assert.equal(match(84, [[83, 33.3], [84, 41.3], [85, 34]]), null, 'above both neighbours');
  assert.equal(match(0, [[0, 53.9], [1, 53.9]]), null, 'a held frame ties with its neighbour');
  assert.equal(match(167, [[166, 40.4], [167, 40.4]]), null, 'the last frame, held');
  assert.equal(match(84, [[83, 30.2], [84, 30], [85, 12]]), 'looks most like drawn frame 83', 'a shifted frame');
  assert.equal(match(84, [[83, 21], [84, 29.9], [85, 21]]), 'resembles its drawn frame by 29.9 dB, under 30 dB', 'a garbled frame');
  assert.equal(match(0, [[0, 30], [1, 18]]), null, 'the floor itself matches');
});

test('two renders of a soundtrack match only when every sample holds the same bits', () => {
  // As the page runs it, from its source text alone.
  const same = new Function(`return (${soundMatch});`)();
  const render = (...channels) => ({
    numberOfChannels: channels.length, length: channels[0].length, getChannelData: (c) => Float32Array.from(channels[c]),
  });
  const quiet = [0.25, -0.5, 0, 0.125];
  assert.equal(same(render(quiet, quiet), render(quiet, quiet)), null, 'the same bits');
  // Edge's own difference between renders of a wider sum: one float32 step,
  // far inside the 1e-6 the check once allowed.
  const near = Math.fround(0.125 + 2 ** -26);
  assert.ok(near !== 0.125 && near - 0.125 < 1e-6);
  assert.equal(same(render(quiet, quiet), render(quiet, [0.25, -0.5, 0, near])),
    `differ first in channel 1 at sample 3: 0.125 (0x3e000000) against ${near} (0x3e000001)`, 'the channel, sample and both values of the first difference');
  assert.match(same(render([0, 1]), render([-0, 1])), /channel 0 at sample 0: 0 \(0x0\) against 0 \(0x80000000\)/, 'a negative zero is other bits');
  assert.equal(same(render(quiet), render(quiet.slice(1))), 'hold 1 x 4 and 1 x 3 samples', 'a render of another length');
});

test('a decoded soundtrack measures -14 LUFS or its ceiling, stays under the ceiling plus the codec rise, and the report names a shortfall past 3 LU', () => {
  // As the page runs it, from its source text alone.
  const match = new Function(`return ${PAGE_LOUDNESS_MATCH};`)();
  const heard = (lufs, dbtp) => ({ lufs, dbtp });
  const aac = (lufs, short) => ({ codec: 'mp4a', lufs, ...(short !== undefined && { short }) });
  const opus = (lufs, short) => ({ codec: 'Opus', lufs, ...(short !== undefined && { short }) });

  // -14 LUFS within 0.1, at any peak under the -2 dBTP ceiling plus the 1 dB rise.
  assert.equal(match(heard(-14.01, -2.77), aac(-14)), null, 'readout as AAC');
  assert.equal(match(heard(-14.01, -1.99), aac(-14)), null, 'settle as AAC');
  assert.equal(match(heard(-14.05, -1.56), aac(-14.1)), null, 'limited drums, raised over the ceiling by AAC');
  assert.equal(match(heard(-14.3, -3), aac(-14.3)), 'the decoded soundtrack measures -14.30 LUFS and -3.00 dBTP, neither -14 LUFS nor -2 dBTP',
    'quieter, and not at the ceiling');
  // Or quieter, with its peaks at the ceiling: no more than 0.1 dB under -2 dBTP for AAC.
  assert.equal(match(heard(-14.45, -1.56), aac(-14.4)), null, 'drums stopped by 12 dB of limiting');
  assert.equal(match(heard(-18.21, -2.02), aac(-18.2, 4.2)), null, 'a peaky soundtrack at the AAC ceiling');
  assert.match(match(heard(-17.5, -2.13), aac(-17.5, 3.5)), /^the decoded soundtrack .* neither -14 LUFS nor -2 dBTP$/, 'over 0.1 dB under the AAC ceiling');
  assert.match(match(heard(-13.5, -2), aac(-13.5)), /-13\.50 LUFS and -2\.00 dBTP, neither/, 'louder than -14 LUFS is never the ceiling\'s doing');
  // No more than 0.15 dB under it for Opus, which lowered a peak by up to 0.10 dB.
  assert.equal(match(heard(-14.24, -2.1), opus(-14.25)), null, 'a soundtrack stopped at the ceiling, as Opus');
  assert.equal(match(heard(-14.24, -2.14), opus(-14.25)), null, 'within 0.15 dB of -2 dBTP');
  assert.match(match(heard(-14.24, -2.16), opus(-14.25)), /neither -14 LUFS nor -2 dBTP$/, 'over 0.15 dB under it');
  assert.match(match(heard(-14.24, -2.14), aac(-14.25)), /neither -14 LUFS nor -2 dBTP$/, 'the same soundtrack is too far under the ceiling as AAC');
  // Under the ceiling plus the rise whatever its loudness or codec.
  assert.equal(match(heard(-14.04, -0.94), opus(-14.05)), 'the decoded Opus soundtrack peaks at -0.94 dBTP, not under -1 dBTP', 'at -14 LUFS');
  assert.equal(match(heard(-14.01, -1), opus(-14)), 'the decoded Opus soundtrack peaks at -1.00 dBTP, not under -1 dBTP', 'at -1 dBTP itself');
  assert.equal(match(heard(-14.04, -0.94), aac(-14.05)), 'the decoded AAC soundtrack peaks at -0.94 dBTP, not under -1 dBTP', 'as AAC');
  assert.equal(match(heard(-14.45, -0.99), aac(-14.4)), 'the decoded AAC soundtrack peaks at -0.99 dBTP, not under -1 dBTP', 'stopped short as well');

  // The report names a shortfall exactly when the level it encoded at is more
  // than 3 LU under -14 LUFS. No example is that far short; a peaky one is.
  assert.equal(match(heard(-18.41, -2.11), opus(-18.4, 4.4)), null, 'a peaky soundtrack as Opus');
  assert.equal(match(heard(-18.21, -2.02), aac(-18.2)), 'the export encoded the soundtrack at -18.2 LUFS and reports no shortfall, 4.20 LU under -14 LUFS');
  assert.match(match(heard(-18.41, -2.11), opus(-18.4)), /reports no shortfall, 4\.40 LU under -14 LUFS$/);
  assert.equal(match(heard(-16.51, -2.01), aac(-16.5)), null, 'within 3 LU it says nothing');
  assert.equal(match(heard(-16.51, -2.01), aac(-16.5, 2.5)), 'the export encoded the soundtrack at -16.5 LUFS and reports a shortfall of 2.5 LU, within 3 LU of -14 LUFS');
  assert.match(match(heard(-14.01, -2.77), aac(-14, 0)), /a shortfall of 0 LU/, 'nor at the target');
  assert.equal(match(heard(-17.02, -2.02), aac(-17.01, 3.01)), null);
  assert.match(match(heard(-17.02, -2.02), aac(-17.01)), /no shortfall, 3\.01 LU/, 'a hundredth past 3 LU');
  // The report rounds the level to two decimals and measures the shortfall
  // before rounding, so at exactly -17 LUFS it may be a hair past 3 LU or not.
  assert.equal(match(heard(-17.01, -2.02), aac(-17, 3)), null, 'a shortfall at -17.00 LUFS');
  assert.equal(match(heard(-17.01, -2.02), aac(-17)), null, 'none at -17.00 LUFS');
});

test('the browser check judges loudness by the target, ceiling and short of LOUDNESS in core/film.js', async (t) => {
  const { LOUDNESS } = require('../core/film.js');
  // The page gets LOUDNESS itself, not numbers of its own.
  assert.ok(PAGE_LOUDNESS_MATCH.includes(JSON.stringify(LOUDNESS)), 'the page form carries LOUDNESS');
  // Another LOUDNESS moves its target, ceiling and short with it: -16 LUFS, -3 dBTP and 2 LU here.
  // The decoded-peak bar sits LOUDNESS.rise, 1 dB, over the ceiling; the 0.1/0.15 dB codec tolerances stay fixed in loudnessMatch.
  const other = { ...LOUDNESS, target: -16, ceiling: { mp4a: -3, Opus: -3 }, short: 2 };
  const aac = (lufs, short) => ({ codec: 'mp4a', lufs, ...(short !== undefined && { short }) });
  assert.equal(loudnessMatch({ lufs: -16.01, dbtp: -1.5 }, aac(-16), other),
    'the decoded AAC soundtrack peaks at -1.50 dBTP, not under -2 dBTP', 'a decoded peak 1.5 dB over a -3 dBTP ceiling');
  const higher = { ...LOUDNESS, ceiling: { mp4a: -1.5, Opus: -1.5 } };
  assert.equal(loudnessMatch({ lufs: -14.01, dbtp: -0.8 }, aac(-14), higher), null, 'a decoded peak 0.7 dB over a -1.5 dBTP ceiling');
  assert.equal(loudnessMatch({ lufs: -14.01, dbtp: -0.5 }, { codec: 'Opus', lufs: -14 }, higher),
    'the decoded Opus soundtrack peaks at -0.50 dBTP, not under -0.5 dBTP', 'at the bar itself');
  // Another rise moves the bar with it: 0.5 dB over the -2 dBTP ceiling here.
  const lower = { ...LOUDNESS, rise: 0.5 };
  assert.equal(loudnessMatch({ lufs: -14.01, dbtp: -1.6 }, aac(-14), lower), null, 'a decoded peak 0.4 dB over the ceiling');
  assert.equal(loudnessMatch({ lufs: -14.01, dbtp: -1.2 }, aac(-14), lower),
    'the decoded AAC soundtrack peaks at -1.20 dBTP, not under -1.5 dBTP', 'a decoded peak 0.8 dB over the ceiling');
  // A loudness without a finite rise, a ceiling object or a codec's ceiling or peak margin is refused by name, not judged against a NaN bar.
  const noBar = ', so the decoded peak has no bar to stay under';
  for (const [rise, shown] of [[undefined, 'undefined'], ['1', '1'], [NaN, 'NaN'], [Infinity, 'Infinity'], [-Infinity, '-Infinity']]) {
    await t.test('a rise of ' + shown + ' is refused by name', () => {
      assert.equal(loudnessMatch({ lufs: -14.01, dbtp: -0.5 }, aac(-14), { ...LOUDNESS, rise }),
        'the loudness rise is ' + shown + ', not a finite number' + noBar);
    });
  }
  for (const [ceiling, shown] of [[undefined, 'undefined'], [null, 'null'], [-2, '-2'], [[-1, -2], '-1,-2'], [new Map(), '[object Map]']]) {
    await t.test('a ceiling of ' + shown + ' is refused by name', () => {
      assert.equal(loudnessMatch({ lufs: -14.01, dbtp: -3 }, aac(-14), { ...LOUDNESS, ceiling }),
        'the loudness has no ceiling object, its ceiling is ' + shown + noBar);
    });
  }
  for (const key of ['target', 'short']) {
    for (const [value, shown] of [[undefined, 'undefined'], ['3', '3'], [NaN, 'NaN'], [Infinity, 'Infinity']]) {
      await t.test('a ' + key + ' of ' + shown + ' is refused by name', () => {
        assert.equal(loudnessMatch({ lufs: -14.01, dbtp: -3 }, aac(-14), { ...LOUDNESS, [key]: value }),
          'the loudness ' + key + ' is ' + shown + ', not a finite number, so the soundtrack has no '
          + (key === 'target' ? 'level' : 'shortfall') + ' to be judged against');
      });
    }
  }
  for (const [codec, shown] of [[null, 'null'], ['', 'an empty string']]) {
    await t.test(shown + ' for a codec is refused as no codec', () => {
      assert.equal(loudnessMatch({ lufs: -14.01, dbtp: -3 }, { codec, lufs: -14 }, LOUDNESS),
        'the loudness has no finite ceiling for no codec' + noBar);
    });
  }
  await t.test('a codec with no ceiling is refused by name', () => {
    assert.equal(loudnessMatch({ lufs: -14.01, dbtp: -3 }, { codec: 'flac', lufs: -14 }, LOUDNESS),
      'the loudness has no finite ceiling for the codec flac' + noBar);
  });
  await t.test('no codec is refused as no codec', () => {
    assert.equal(loudnessMatch({ lufs: -14.01, dbtp: -3 }, { lufs: -14 }, LOUDNESS),
      'the loudness has no finite ceiling for no codec' + noBar);
  });
  await t.test('a codec with a ceiling but no peak margin is refused by name', () => {
    const extra = { ...LOUDNESS, ceiling: { ...LOUDNESS.ceiling, flac: -2 } };
    assert.equal(loudnessMatch({ lufs: -14.01, dbtp: -3 }, { codec: 'flac', lufs: -14 }, extra),
      'the check has no finite peak margin for the codec flac' + noBar);
  });
  await t.test('the page form refuses a codec with no ceiling too', () => {
    assert.equal(new Function(`return ${PAGE_LOUDNESS_MATCH};`)()({ lufs: -14.01, dbtp: -3 }, { codec: 'flac', lufs: -14 }),
      'the loudness has no finite ceiling for the codec flac' + noBar);
  });
  assert.equal(loudnessMatch({ lufs: -16.01, dbtp: -4 }, aac(-16), other), null, 'at its target');
  assert.equal(loudnessMatch({ lufs: -14.01, dbtp: -4 }, aac(-14), other),
    'the decoded soundtrack measures -14.01 LUFS and -4.00 dBTP, neither -16 LUFS nor -3 dBTP', 'at the old target');
  assert.equal(loudnessMatch({ lufs: -17, dbtp: -3.05 }, aac(-17), other), null, 'stopped short at its ceiling, within its short');
  assert.equal(loudnessMatch({ lufs: -18.5, dbtp: -3.05 }, aac(-18.5), other),
    'the export encoded the soundtrack at -18.5 LUFS and reports no shortfall, 2.50 LU under -16 LUFS');
  assert.equal(loudnessMatch({ lufs: -17.5, dbtp: -3.05 }, aac(-17.5, 1.5), other),
    'the export encoded the soundtrack at -17.5 LUFS and reports a shortfall of 1.5 LU, within 2 LU of -16 LUFS');
});

test('a forced WebM run records again only when the page refuses a recording as behind schedule, three recordings at most', async () => {
  // As the page runs it, from its source text alone.
  const retry = new Function(`return (${retryBehindSchedule});`)();
  // The page's own wording, from filmVerdict, for drawing or the recorder running late.
  const { filmVerdict } = require('../core/export.js');
  const even = Array.from({ length: 168 }, (_, i) => Math.round((i * 1000) / 24));
  const behind = (held, recorder) => {
    try { filmVerdict(168, 24, even.slice(0, held), { worstLagMs: 43, worstDrawMs: recorder ? 0.2 : 50, worstWriteMs: recorder ? 56 : 1 }); } catch (e) { return e; }
    throw new Error('filmVerdict accepted a film missing frames');
  };
  const recordings = (...outcomes) => {
    const made = { count: 0 };
    made.record = async () => { const outcome = outcomes[made.count++]; if (outcome instanceof Error) throw outcome; return outcome; };
    return made;
  };
  const accepted = recordings(behind(165, true), behind(164), 'report');
  assert.deepEqual(await retry(accepted.record, 168), { report: 'report', refusals: [{ frames: 165, behindMs: 43, late: 'recorder' }, { frames: 164, behindMs: 43, late: 'drawing' }] },
    'accepted on the third recording, each refusal named with its frames and what ran late');
  const refused = recordings(behind(165), behind(164, true), behind(166), 'never reached');
  await assert.rejects(retry(refused.record, 168), /holds 166 of 168 frames\. .* Recording 3 of 3; the page refused 165 of 168 frames, drawing late; 164 of 168 frames, recorder late before it\./);
  assert.equal(refused.count, 3, 'three recordings at most');
  const lost = recordings(new Error('the file holds 22 of 24 frames, and pictures went missing mid-film. This film is missing pictures rather than slow.'));
  await assert.rejects(retry(lost.record, 24), /missing pictures rather than slow\.$/);
  assert.equal(lost.count, 1, 'any other refusal fails at once');
  const late = recordings(behind(165), new Error('this browser has no MediaStreamTrackGenerator'));
  await assert.rejects(retry(late.record, 168), /no MediaStreamTrackGenerator Recording 2 of 3; the page refused 165 of 168 frames, drawing late before it\./);
});

test('the browser check replays every film it exported, records its margins, and fails on one that differs, naming it', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artifex-replay-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const context = { errors: [], phase: 'page navigation', signal: new AbortController().signal, version: { Browser: 'Edge/1' } };
  const mp4 = (text) => ({ offered: 'mp4', frames: 48, conversion: 'encoder', mp4: Buffer.from(text).toString('base64') });
  // checkPage keeps each film's bytes for the replay, and out of the report.
  const report = await checkPage(pageOf({ stride: mp4('stride film'), drape: mp4('drape film') }), context, {});
  for (const film of JSON.parse(JSON.stringify(report)).films) assert.equal('mp4' in film || 'saved' in film, false, 'the report carries no film bytes');
  assert.equal(String(report.films[0].saved), 'stride film');
  // A stand-in for tools/replay.js's replay, answering as it does for a film with sound and one without.
  const asked = [];
  const sound = 'the AAC soundtrack decodes to its recipe\'s 384000 samples, every block within 25 dB of the render (worst 25.4 dB) or, in its noise-like bands, within 3 dB of its waveform';
  const verdicts = {
    stride: { match: true, detail: '24 frames ...; ' + sound, frames: [{ frame: 0, psnr: 45.53 }, { frame: 1, psnr: 48 }], sound: { match: true, detail: sound } },
    drape: { match: true, detail: '24 frames ...', frames: [{ frame: 0, psnr: 99 }, { frame: 1, psnr: 41.2 }] },
  };
  const replay = async (file, options) => {
    asked.push([path.basename(file), String(await fs.readFile(file)), options]);
    return verdicts[path.basename(file).replace(/^browser-(no-aac-)?|\.mp4$/g, '')];
  };
  await replayFilms(report, { force: 'no-aac', timeoutMs: 90000, edge: 'msedge' }, { dir, replay });
  assert.deepEqual(asked.map(([file, bytes]) => [file, bytes]), [['browser-no-aac-stride.mp4', 'stride film'], ['browser-no-aac-drape.mp4', 'drape film']],
    'each film is written under the run\'s condition and replayed in order');
  assert.deepEqual(asked[0][2], { browser: { edge: 'msedge', timeoutMs: 90000, headed: undefined } }, 'the replay\'s browser has no forced condition');
  const [stride, drape] = report.films.map((film) => film.replay);
  assert.deepEqual([stride.match, stride.pictureDb, stride.pictureMarginDb, stride.soundDb, stride.soundMarginDb], [true, 45.53, 15.53, 25.4, 0.4]);
  assert.deepEqual([drape.pictureDb, drape.pictureMarginDb, drape.soundDb, drape.soundMarginDb], [41.2, 11.2, null, null], 'a film without sound has no sound margin');
  assert.equal(stride.file, path.join(dir, 'browser-no-aac-stride.mp4').split(path.sep).join('/'));
  assert.ok(Number.isInteger(stride.ms), 'each replay\'s time is recorded');
  // The default run's file names no condition; a differing film fails the run, by name, with replay's reason.
  // It carries the run's report, holding the differing verdict and the margins of the films before it.
  verdicts.drape = { match: false, detail: 'frame 12 decodes at 22.1 dB from its redraw, under the 30 dB floor', frames: [{ frame: 11, psnr: 33 }, { frame: 12, psnr: 22.1 }] };
  asked.length = 0;
  await assert.rejects(replayFilms(report, {}, { dir, replay }),
    (error) => error.message === 'browser: drape: its film DIFFERS on replay: frame 12 decodes at 22.1 dB from its redraw, under the 30 dB floor; replay it with npm --prefix "'
      + path.resolve(__dirname, '..').split(path.sep).join('/') + '" run replay -- "' + path.join(dir, 'browser-drape.mp4').split(path.sep).join('/') + '"' && error.report === report);
  assert.deepEqual(asked.map(([file]) => file), ['browser-stride.mp4', 'browser-drape.mp4']);
  // The run's --edge and a --timeout-ms other than the default go into the printed replay, so it finds the same Edge;
  // the default timeout and --headed do not.
  // The path is absolute on Windows and on Linux alike: a drive-letter path is a relative one on Linux, which prints resolved.
  const beta = path.resolve(path.sep, 'Edge Beta', 'msedge.exe');
  await assert.rejects(replayFilms(report, { edge: beta, timeoutMs: 90000, headed: true }, { dir, replay }),
    (error) => error.message.endsWith('"' + path.join(dir, 'browser-drape.mp4').split(path.sep).join('/') + '" --edge "' + beta.split(path.sep).join('/') + '" --timeout-ms 90000'));
  await assert.rejects(replayFilms(report, { timeoutMs: 60000 }, { dir, replay }), (error) => !/--(edge|timeout-ms|headed)/.test(error.message));
  // A relative --edge prints as the absolute path it resolved to, so the command runs the same Edge from any folder.
  const saved = ['npm_lifecycle_event', 'npm_package_json', 'INIT_CWD'].map((key) => [key, process.env[key]]);
  Object.assign(process.env, { npm_lifecycle_event: 'browser', npm_package_json: path.join(path.resolve(__dirname, '..'), 'package.json'), INIT_CWD: dir });
  try {
    await assert.rejects(replayFilms(report, { edge: 'rel/msedge.exe' }, { dir, replay }),
      (error) => error.message.endsWith(' --edge "' + path.join(dir, 'rel', 'msedge.exe').split(path.sep).join('/') + '"'));
  } finally {
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
  // The printed flags come from the very browser object the replay was handed, so they cannot drift from what ran.
  const drifting = async (file, options) => { Object.assign(options.browser, { edge: path.join('C:', 'Drifted', 'msedge.exe'), timeoutMs: 45000 }); return replay(file, options); };
  await assert.rejects(replayFilms(report, { edge: path.join('C:', 'Edge Beta', 'msedge.exe') }, { dir, replay: drifting }),
    (error) => error.message.endsWith(' --edge "C:/Drifted/msedge.exe" --timeout-ms 45000'));
  assert.deepEqual([report.films[0].replay.match, report.films[0].replay.pictureMarginDb], [true, 15.53]);
  const differs = report.films[1].replay;
  assert.deepEqual([differs.match, differs.pictureDb, differs.pictureMarginDb, differs.soundMarginDb, differs.detail],
    [false, 22.1, -7.9, null, verdicts.drape.detail]);
  verdicts.drape = { match: false, detail: 'frame 0 cannot be sought: the browser did not finish seeking the film to it within 10 s', frames: [{ frame: 0, seekTimeoutMs: 10000 }] };
  await assert.rejects(replayFilms(report, {}, { dir, replay }), (error) => error.report === report);
  assert.deepEqual([report.films[1].replay.match, report.films[1].replay.pictureDb, report.films[1].replay.pictureMarginDb], [false, null, null],
    'a film whose first frame cannot be sought has no compared frame and no picture margin');
  // A film replay cannot read fails the run too, and so does an exported film checkPage kept no bytes of, before any replay.
  const first = { films: report.films.slice(0, 1) };
  await assert.rejects(replayFilms(first, {}, { dir, replay: async () => { throw new Error('replay: no registered example'); } }),
    (error) => /^browser: stride: its film, .*browser-stride\.mp4, cannot be replayed: replay: no registered example$/.test(error.message) && !('report' in error));
  // A replay whose Edge failed only to clean up says so, and the failure carries the run's report to print.
  const cleanup = Object.assign(new Error('browser: cleanup failed: profile p: EBUSY'), { report: { films: [] } });
  await assert.rejects(replayFilms(first, {}, { dir, replay: async () => { throw cleanup; } }),
    (error) => /^browser: stride: its film, .*browser-stride\.mp4, was replayed, but the replay's Edge failed to clean up, so its verdict is unread: browser: cleanup failed: profile p: EBUSY$/.test(error.message)
      && error.report === first);
  asked.length = 0;
  await assert.rejects(replayFilms({ films: [{ name: 'a', offered: 'mp4' }] }, {}, { dir, replay }),
    { message: 'browser: a: the page sent back none of its film\'s bytes, so it cannot be replayed' });
  assert.equal(asked.length, 0);
});

test('the summary says each film replayed as matching, with its worst frame and sound block over the floor', async (t) => {
  const logged = [];
  t.mock.method(console, 'log', (line) => logged.push(line));
  const film = (replay) => ({ name: 'a', offered: 'mp4', frames: 48, conversion: 'encoder', replay });
  await main(['--json'], async () => ({ browser: 'Edge/1', mode: 'headless', pieces: [{ name: 'a' }], errors: [],
    films: [film({ match: true, pictureMarginDb: 15.53, soundMarginDb: 0.4 }), film({ match: true, pictureMarginDb: 11.2, soundMarginDb: null })] }));
  assert.match(logged[1], /named the page's recipe, and replayed as matching, its worst frame 15\.53 dB over the floor and its worst sound block at or over the floor 0\.4 dB over it; film a .* and replayed as matching, its worst frame 11\.2 dB over the floor;/);
});

test('a run whose film DIFFERS on replay still writes its report, and its summary names the film as differing', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artifex-differs-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const logged = [];
  t.mock.method(console, 'log', (line) => logged.push(line));
  const film = (name, replay) => ({ name, offered: 'mp4', frames: 48, conversion: 'encoder', replay });
  const report = { browser: 'Edge/1', mode: 'headless', pieces: [{ name: 'a' }, { name: 'b' }], errors: [],
    films: [film('a', { match: true, pictureMarginDb: 15.53, soundMarginDb: null }), film('b', { match: false, pictureDb: 22.1, pictureMarginDb: -7.9, soundMarginDb: null })] };
  const differs = Object.assign(new Error('browser: b: its film DIFFERS on replay: frame 12 ...'), { report });
  await assert.rejects(main([], async () => { throw differs; }, dir), (error) => error === differs);
  assert.match(logged[0], /film a .* and replayed as matching, its worst frame 15\.53 dB over the floor; film b .*recipe, and DIFFERS on replay; owned browser, server and profile cleaned up$/);
  const saved = JSON.parse(await fs.readFile(path.join(dir, 'browser.json'), 'utf8'));
  assert.deepEqual(saved.films.map((f) => [f.replay.match, f.replay.pictureMarginDb]), [[true, 15.53], [false, -7.9]]);
});

test('a run replays every film it exported and the flash fixture\'s, with the fixture as its piece, and fails on a film left unreplayed', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artifex-run-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const pagePath = path.join(dir, 'index.html');
  await fs.writeFile(pagePath, '<!doctype html>');
  const context = () => ({ errors: [], phase: 'page navigation', signal: new AbortController().signal, version: { Browser: 'Edge/1' } });
  const edge = async (page, options, work) => work(pageOf({ stride: { offered: 'mp4', frames: 48, conversion: 'encoder', mp4: Buffer.from('stride film').toString('base64') } }), context());
  const exportFilm = async () => ({ report: { flashes: { general: 4, red: 5, worst: { kind: 'red', start: 1.125, flashes: 5, x: 0, y: 0, w: 320, h: 240 } } }, bytes: Buffer.from('flash film') });
  const asked = [];
  let fixture = { match: true, detail: '24 frames ...', frames: [{ frame: 0, psnr: 40 }] };
  const replay = async (file, options) => {
    asked.push([path.basename(file), String(await fs.readFile(file)), options.piece]);
    return /flash/.test(file) ? fixture : { match: true, detail: '24 frames ...', frames: [{ frame: 0, psnr: 50 }] };
  };
  const report = await runBrowserCheck({ pagePath }, { edge, exportFilm, replay, dir });
  assert.deepEqual(asked, [['browser-stride.mp4', 'stride film', undefined], ['browser-flash-film.mp4', 'flash film', path.join(__dirname, 'fixtures', 'flash-film.cjs')]]);
  assert.deepEqual([report.films[0].replay.match, report.flashFixture.replay.match, report.flashFixture.replay.pictureMarginDb], [true, true, 10]);
  assert.equal('saved' in JSON.parse(JSON.stringify(report)).flashFixture, false, 'the report carries no film bytes');
  // A forced run exports no fixture, so it replays only its own films.
  asked.length = 0;
  assert.equal('flashFixture' in await runBrowserCheck({ pagePath, force: 'no-aac' }, { edge, exportFilm, replay, dir }), false);
  assert.deepEqual(asked.map(([file]) => file), ['browser-no-aac-stride.mp4']);
  // The fixture's film failing replay fails the run, carrying the report with its verdict.
  fixture = { match: false, detail: 'frame 3 decodes at 20 dB from its redraw, under the 30 dB floor', frames: [{ frame: 3, psnr: 20 }] };
  await assert.rejects(runBrowserCheck({ pagePath }, { edge, exportFilm, replay, dir }),
    (error) => error.message === 'browser: the flash fixture: its film DIFFERS on replay: frame 3 decodes at 20 dB from its redraw, under the 30 dB floor; replay it with npm --prefix "'
      + path.resolve(__dirname, '..').split(path.sep).join('/') + '" run replay -- "' + path.join(dir, 'browser-flash-film.mp4').split(path.sep).join('/')
      + '" --piece "' + path.join(__dirname, 'fixtures', 'flash-film.cjs').split(path.sep).join('/') + '"'
      && error.report.flashFixture.replay.match === false && error.report.flashFixture.replay.pictureMarginDb === -10);
  // Any exported film without a replay verdict fails the run, by name.
  assert.throws(() => requireReplays({ films: [{ name: 'stride' }] }), { message: 'browser: stride: its film was exported but never replayed' });
  assert.throws(() => requireReplays({ films: [{ name: 'stride', replay: { match: true } }], flashFixture: { general: 4, red: 5 } }),
    { message: 'browser: the flash fixture: its film was exported but never replayed' });
  // The summary gives the fixture's replay too.
  const logged = [];
  t.mock.method(console, 'log', (line) => logged.push(line));
  await main(['--json'], async () => ({ browser: 'Edge/1', mode: 'headless', pieces: [{ name: 'a' }], films: [], errors: [],
    flashFixture: { general: 4, red: 5, replay: { match: true, pictureMarginDb: 10, soundMarginDb: null } } }));
  assert.match(logged[1], /warned of 4 general and 5 red flashes, and replayed as matching, its worst frame 10 dB over the floor; owned browser/);
});

test('a run whose page or fixture Edge failed only to clean up still replays every film, then fails with the cleanup', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artifex-cleanup-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const pagePath = path.join(dir, 'index.html');
  await fs.writeFile(pagePath, '<!doctype html>');
  const context = () => ({ errors: [], phase: 'page navigation', signal: new AbortController().signal, version: { Browser: 'Edge/1' } });
  const checked = () => checkPage(pageOf({ stride: { offered: 'mp4', frames: 48, conversion: 'encoder', mp4: Buffer.from('stride film').toString('base64') } }), context(), {});
  const stuck = (what, report) => Object.assign(new Error('browser: cleanup failed: profile ' + what + ': EBUSY'), { report });
  const fixture = () => ({ report: { flashes: { general: 4, red: 5, worst: { kind: 'red', start: 1.125, flashes: 5, x: 0, y: 0, w: 320, h: 240 } } }, bytes: Buffer.from('flash film') });
  let verdict = { match: true, detail: '24 frames ...', frames: [{ frame: 0, psnr: 50 }] };
  const asked = [];
  const replay = async (file) => { asked.push(path.basename(file)); return verdict; };
  for (const [edge, exportFilm, what] of [
    [async () => { throw stuck('page', await checked()); }, async () => fixture(), 'page'],
    [async () => checked(), async () => { throw stuck('fixture', fixture()); }, 'fixture'],
  ]) {
    asked.length = 0;
    let failure;
    await assert.rejects(runBrowserCheck({ pagePath }, { edge, exportFilm, replay, dir }), (error) => { failure = error; return true; });
    assert.equal(failure.message, 'browser: cleanup failed: profile ' + what + ': EBUSY', what);
    assert.deepEqual(asked, ['browser-stride.mp4', 'browser-flash-film.mp4'], what + ': every film is replayed before the cleanup fails the run');
    assert.deepEqual([failure.report.films[0].replay.match, failure.report.flashFixture.replay.match], [true, true], what);
    assert.equal('cleanup' in JSON.parse(JSON.stringify(failure.report)).flashFixture, false, 'the report carries no cleanup error');
  }
  // A fixture count that fails after its Edge failed to clean up names both and keeps the run's report.
  const quiet = async () => { throw stuck('fixture', { report: { flashes: { general: 1, red: 0 } }, bytes: Buffer.from('flash film') }); };
  let counted;
  await assert.rejects(runBrowserCheck({ pagePath }, { edge: async () => checked(), exportFilm: quiet, replay, dir }), (error) => { counted = error; return true; });
  assert.match(counted.message, /^browser: the flash fixture's film counted .*\nbrowser: cleanup failed: profile fixture: EBUSY$/);
  assert.equal(counted.report.films[0].replay.match, true, 'the run\'s report goes with the failure');
  // A film that DIFFERS after such a cleanup failure names both, and the summary says cleanup failed.
  verdict = { match: false, detail: 'frame 3 decodes at 20 dB from its redraw, under the 30 dB floor', frames: [{ frame: 3, psnr: 20 }] };
  const logged = [];
  t.mock.method(console, 'log', (line) => logged.push(line));
  await assert.rejects(main([], () => runBrowserCheck({ pagePath }, { edge: async () => { throw stuck('page', await checked()); }, replay, dir }), dir),
    { message: /^browser: stride: its film DIFFERS on replay: frame 3 .*\nbrowser: cleanup failed: profile page: EBUSY$/ });
  assert.match(logged[0], /and DIFFERS on replay; cleanup failed$/);
});
