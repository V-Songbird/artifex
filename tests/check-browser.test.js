'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const {
  parseArgs, findEdge, connectCDP, evaluate, servePage, runBrowserCheck,
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
  await assert.rejects(runBrowserCheck({ edge: process.execPath, pagePath: __filename, timeoutMs: 3000 }), /Edge exited before completion/);
  const after = (await fs.readdir(tempRoot)).filter((name) => name.startsWith(prefix));
  assert.deepEqual(after, before);
  assert.deepEqual(['SIGINT', 'SIGTERM'].map((signal) => process.listenerCount(signal)), listeners);
});
