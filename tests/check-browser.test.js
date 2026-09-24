'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const {
  parseArgs, findEdge, connectCDP, evaluate, servePage, runBrowserCheck, stopBrowser, removeProfile, main, filmsToExport, FORCED, sheetReady,
  retryBehindSchedule, frameMatch, soundMatch, checkPage, inspectPiece, inspectFilm, evaluateInPieces, PIECE_CHARS, routeVerdict,
  SHOT_BYTES, bandRows, sheetPieces, sheetClip,
} = require('../tools/check-browser.js');

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

test('browser stop waits for the owned Edge to exit and fails while it keeps running', async () => {
  // The kill is injected, so no real process is signalled.
  const root = { pid: 424242, exitCode: null, signalCode: null };
  let calls = 0;
  const kill = async () => { calls++; };
  await stopBrowser(root, delay(200), { limitMs: 5000, kill });
  assert.equal(calls, 1);
  const started = Date.now();
  await assert.rejects(stopBrowser(root, new Promise(() => {}), { limitMs: 500, kill }),
    /could not stop owned Edge process 424242 within 500 ms/, 'an Edge whose exit is never seen is not stopped');
  assert.ok(Date.now() - started >= 500, 'the exit is awaited until the limit');
  await assert.rejects(stopBrowser(root, Promise.resolve(), { kill: async () => { throw new Error('spawn taskkill.exe ENOENT'); } }),
    /ENOENT/, 'a stop that cannot start fails');
  // A finished stop must not hold the command open until its 60 s bound.
  const started2 = Date.now();
  const lingering = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(require.resolve('../tools/check-browser.js'))})
    .stopBrowser({ pid: 424242, exitCode: null, signalCode: null }, Promise.resolve(), { limitMs: 60000, kill: async () => {} })`],
  { encoding: 'utf8', timeout: 90000, windowsHide: true });
  assert.equal(lingering.status, 0, lingering.stderr);
  assert.ok(Date.now() - started2 < 30000, 'the stop released its bound once Edge exited');
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
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && (() => { try { process.kill(pids[1], 0); return true; } catch { return false; } })()) await delay(50);
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
  await assert.rejects(main([], async () => { throw failure; }), /cleanup failed: stuck/);
  assert.deepEqual(JSON.parse(logged[0]), report);
  assert.match(logged[1], /^browser: 2 examples passed; no example has a timeline, so no film was exported; cleanup failed$/);
  logged.length = 0;
  await assert.rejects(main([], async () => { throw new Error('browser: page errors'); }), /page errors/);
  assert.deepEqual(logged, [], 'a failed check prints no report');
});

test('the browser check exports a film for every example that declares sound, else the first with a timeline', () => {
  const examples = require('../examples/index.js');
  const { validate } = require('../core/piece.js');
  // The traits the page reads for each registered example, in registry order.
  const traits = Object.keys(examples).map((name) => {
    const p = validate(examples[name]);
    return { name, sound: !!p.sound, time: !!p.time };
  });
  const sounding = traits.filter((example) => example.sound).map((example) => example.name);
  assert.ok(sounding.length > 0, 'the registry declares sound');
  assert.deepEqual(filmsToExport(traits), sounding, 'every example that declares sound gets its film');
  const example = (name, sound, time) => ({ name, sound, time });
  assert.deepEqual(filmsToExport([example('still', false, false), example('first', false, true), example('second', false, true)]),
    ['first'], 'without sound, the first example with a timeline');
  assert.deepEqual(filmsToExport([example('one', true, true), example('quiet', false, true), example('two', true, true)]), ['one', 'two']);
  assert.deepEqual(filmsToExport([example('still', false, false)]), [], 'without a timeline there is no film');
  // The page runs it from its source text alone.
  assert.deepEqual(new Function(`return (${filmsToExport.toString()});`)()([example('one', true, true)]), ['one']);
});

test('the browser check forces one named export fallback per run, and the default run none', () => {
  assert.equal('force' in parseArgs([]), false, 'the default run installs nothing');
  for (const force of Object.keys(FORCED)) assert.equal(parseArgs(['--force', force]).force, force);
  assert.deepEqual(Object.keys(FORCED).sort(), ['no-aac', 'no-h264', 'no-webgl2']);
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
});

test('a forced run names its condition in its summary and report, and the default summary is unchanged', async (t) => {
  const logged = [];
  t.mock.method(console, 'log', (line) => logged.push(line));
  const run = (films) => async (options) => ({
    browser: 'Edge/1', mode: 'headless', ...(options.force && { forced: options.force }), pieces: [{ name: 'a' }], films, errors: [],
  });
  const mp4 = (soundCodec, conversion) => ({ name: 'a', offered: 'mp4', frames: 48, sound: {}, soundCodec, conversion });
  await main([], run([mp4('mp4a', 'gpu')]));
  assert.equal(JSON.parse(logged[0]).forced, undefined);
  assert.equal(logged[1], 'browser: 1 examples passed; film a offered as MP4 with WebM hidden, exported 48 frames with an AAC soundtrack,'
    + ' colour converted on the GPU, decoded, and named the page\'s recipe; owned browser, server and profile cleaned up');
  logged.length = 0;
  await main([], run([mp4('mp4a', 'encoder')]));
  assert.match(logged[1], /exported 48 frames with an AAC soundtrack, colour converted by the encoder, decoded,/, 'the encoder route reads as itself');
  for (const [force, films, summary] of [
    ['no-aac', [mp4('Opus', 'gpu')], /^browser with AAC refused: 1 examples passed; film a .* with an Opus soundtrack, colour converted on the GPU,/],
    ['no-webgl2', [mp4('mp4a', 'cpu')], /^browser with WebGL2 hidden: .* colour converted on the CPU,/],
    ['no-h264', [{ name: 'a', offered: 'webm', frames: 96, seconds: 4, refusals: [] }],
      /^browser with H\.264 refused: 1 examples passed; film a offered as WebM with MP4 hidden, recorded 96 frames lasting 4 s, decoded, and parsed with every frame;/],
    ['no-h264', [{ name: 'a', offered: 'webm', frames: 96, seconds: 4, refusals: [{ frames: 93, behindMs: 43 }, { frames: 95, behindMs: 50 }] }],
      /^browser with H\.264 refused: .* recorded 96 frames lasting 4 s after 2 refused recordings \(93, 95 of 96 frames\), decoded,/],
  ]) {
    logged.length = 0;
    await main(['--force', force], run(films));
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
// check makes by the function it runs there: one piece, and `films` by name. A
// value read in pieces is kept as JSON and handed back by slices, and a reply
// past 4 MiB fails as Node's WebSocket fails.
function pageOf(films) {
  const answer = (expression) => {
    const called = (fn) => expression.startsWith('(' + fn + ')(');
    // inspectFilm runs with frameMatch and soundMatch handed in; the film's name is its first argument.
    const film = '((frameMatch, soundMatch) => (' + inspectFilm + ')(';
    const name = () => JSON.parse(/^"[^"]*"/.exec(expression.slice(film.length))[0]);
    if (expression.startsWith('document.readyState')) return true;
    if (expression === 'window.__artifex.names') return ['a'];
    if (called(inspectPiece)) return { name: 'a' };
    if (called(filmsToExport)) return Object.keys(films);
    if (expression.startsWith(film)) return { name: name(), ...films[name()] };
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

test('a default browser run requires every MP4 film on the encoder route, and --allow-fallback accepts the GPU or CPU', async () => {
  const context = () => ({ errors: [], phase: 'page navigation', signal: new AbortController().signal, version: { Browser: 'Edge/1' } });
  const mp4 = (conversion) => ({ offered: 'mp4', frames: 48, conversion });
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

test('a whole sheet part keeps its clip, and a scaled piece asks half a row more', () => {
  // Unscaled: the whole part as it was always shot, and a band of whole rows.
  assert.deepEqual(sheetClip(2400, 1280, 1310, 1, 0, 1310), { x: 0, y: 2400, width: 1280, height: 1310, scale: 1 });
  assert.deepEqual(sheetClip(2400, 1280, 1310, 1, 604, 604), { x: 0, y: 3004, width: 1280, height: 604, scale: 1 });
  // Scaled, as a part 11205 CSS pixels tall is: the whole part keeps its clip,
  // and each piece or band asks half a row more than it wants, from its first row.
  const scale = 8192 / 11205;
  assert.deepEqual(sheetClip(3000, 1280, 11205, scale, 0, 8192), { x: 0, y: 3000, width: 1280, height: 11205, scale });
  for (const [from, count] of [[0, 2478], [2478, 2478], [7434, 758]]) {
    const clip = sheetClip(3000, 1280, 11205, scale, from, count);
    assert.ok(Math.abs(clip.height * scale - (count + 0.5)) < 1e-9, count + ' rows ask for ' + clip.height * scale);
    assert.ok(Math.abs((clip.y - 3000) * scale - from) < 1e-9, 'from row ' + from);
    assert.deepEqual([clip.x, clip.width, clip.scale], [0, 1280, scale]);
  }
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
  const film = (offered, conversion) => ({ name: 'a', offered, conversion });
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

test('a run that accepts a fallback colour route says so in its summary', async (t) => {
  const logged = [];
  t.mock.method(console, 'log', (line) => logged.push(line));
  const run = async (options) => ({
    browser: 'Edge/1', mode: 'headless', ...(options.force && { forced: options.force }), ...(options.allowFallback && { allowFallback: true }),
    pieces: [{ name: 'a' }], films: [{ name: 'a', offered: 'mp4', frames: 48, sound: {}, soundCodec: 'mp4a', conversion: 'cpu' }], errors: [],
  });
  await main(['--allow-fallback'], run);
  assert.equal(JSON.parse(logged[0]).allowFallback, true);
  assert.match(logged[1], /^browser accepting a fallback colour route: 1 examples passed; film a .* colour converted on the CPU,/);
  logged.length = 0;
  await main(['--force', 'no-aac', '--allow-fallback'], run);
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
    piece: { validate: (p) => p, solve: () => ({}) },
    render: { playheads: () => heads, drawFrame: (g, p, s, t) => { g.canvas.rgb = colour(t); } },
    select() {}, read: () => ({ seed: 1 }),
    filmOffer: async () => ({ format: 'webm', reason: 'h264' }),
    video: async () => ({ blob: new Blob([Uint8Array.of(1, 2, 3)]) }),
  };
  const globals = {
    window: { __artifex: api }, VideoFrame, Blob, setTimeout, clearTimeout, atob, btoa,
    URL: { createObjectURL: () => 'blob:film', revokeObjectURL() {} },
    document: { createElement: (tag) => (tag === 'video' ? video() : canvas()), getElementById: (id) => ({ checkVisibility: () => id === 'video' }) },
  };
  return { globals, count };
}

test('the browser check scores each decoded frame by the pixels its VideoFrame holds, and closes every frame', async () => {
  const vm = require('node:vm');
  const { globals, count } = filmPage();
  // As the page runs it, with frameMatch and soundMatch handed in, for a forced WebM film.
  const film = await vm.runInNewContext(`((frameMatch, soundMatch) => (${inspectFilm})('a', 'no-h264', async (record) => ({ report: await record(), refusals: [] })))(${frameMatch}, ${soundMatch})`, globals);
  // Through Array.from: the page's arrays belong to another realm.
  assert.deepEqual(Array.from(film.decoded, (d) => [d.frame, d.psnrDb]), [[0, 99], [1, 99], [2, 99]], 'each frame read as the film holds it');
  assert.ok(film.decoded.every((d) => d.neighbourDb < 30), 'and unlike its neighbours');
  assert.deepEqual([count.made, count.closed], [3, 3], 'every VideoFrame closed');
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

test('a forced WebM run records again only when the page refuses a recording as behind schedule, three recordings at most', async () => {
  // As the page runs it, from its source text alone.
  const retry = new Function(`return (${retryBehindSchedule});`)();
  const behind = (held) => new Error(`the file holds ${held} of 168 frames. The export fell 43 ms behind its schedule against a 41.7 ms frame budget.`);
  const recordings = (...outcomes) => {
    const made = { count: 0 };
    made.record = async () => { const outcome = outcomes[made.count++]; if (outcome instanceof Error) throw outcome; return outcome; };
    return made;
  };
  const accepted = recordings(behind(165), behind(164), 'report');
  assert.deepEqual(await retry(accepted.record, 168), { report: 'report', refusals: [{ frames: 165, behindMs: 43 }, { frames: 164, behindMs: 43 }] },
    'accepted on the third recording, each refusal named with its frames');
  const refused = recordings(behind(165), behind(164), behind(166), 'never reached');
  await assert.rejects(retry(refused.record, 168), /holds 166 of 168 frames\. .* Recording 3 of 3; the page refused 165 of 168 frames, 164 of 168 frames before it\./);
  assert.equal(refused.count, 3, 'three recordings at most');
  const lost = recordings(new Error('the file holds 22 of 24 frames, and pictures went missing mid-film. This film is missing pictures rather than slow.'));
  await assert.rejects(retry(lost.record, 24), /missing pictures rather than slow\.$/);
  assert.equal(lost.count, 1, 'any other refusal fails at once');
  const late = recordings(behind(165), new Error('this browser has no MediaStreamTrackGenerator'));
  await assert.rejects(retry(late.record, 168), /no MediaStreamTrackGenerator Recording 2 of 3; the page refused 165 of 168 frames before it\./);
});
