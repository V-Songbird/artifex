'use strict';

// npm run film in Node: its arguments, where a film goes, the page function
// that carries the page's own export back, and what the command writes. The
// export itself needs installed Edge: run npm run film and npm run replay.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parseArgs, filmTarget, exportInPage, main, TIMEOUT_MS } = require('../tools/film-cli.js');

const ROOT = path.join(__dirname, '..');

test('film: arguments name one piece and pass --scale and --bitrate to the page unchanged', () => {
  assert.deepEqual(parseArgs(['readout']), { piece: 'readout', style: null, out: null, film: {}, browser: { timeoutMs: TIMEOUT_MS } });
  assert.deepEqual(parseArgs(['./boat.cjs', '--out', 'boat.mp4', '--scale', '2', '--bitrate', '30000000', '--headed', '--edge', 'e.exe', '--timeout-ms', '900000']), {
    piece: './boat.cjs', style: null, out: 'boat.mp4', film: { scale: 2, bitrate: 30000000 },
    browser: { timeoutMs: 900000, headed: true, edge: 'e.exe' },
  });
  assert.equal(parseArgs(['--style', 'impasto']).style, 'impasto');
  for (const args of [
    [], ['a', 'b'], ['--style', 'impasto', 'readout'], ['readout', '--scale', '0'], ['readout', '--scale', 'x'],
    ['readout', '--bitrate', '-1'], ['readout', '--out'], ['readout', '--timeout-ms', '99'], ['readout', '--timeout-ms', '3600001'],
    ['readout', '--other'],
  ]) assert.throws(() => parseArgs(args), /film|usage/, args.join(' '));
});

test('film: --out must name an .mp4, so a slip never replaces a piece or its data', () => {
  assert.equal(parseArgs(['readout', '--out', 'Boat.MP4']).out, 'Boat.MP4');
  for (const out of ['boat.cjs', 'boat.json', 'boat.mp4.bak', 'boat']) {
    assert.throws(() => parseArgs(['readout', '--out', out]), /--out must name an \.mp4 file/, out);
  }
});

test('film: a film goes under out/, beside an external piece, or where --out says from the caller', () => {
  const cwd = path.join(ROOT, 'tests');
  assert.deepEqual(filmTarget(parseArgs(['readout']), cwd), { name: 'readout', external: null, file: path.join(ROOT, 'out', 'readout.mp4') });
  assert.equal(filmTarget(parseArgs(['readout', '--out', 'x/f.mp4']), cwd).file, path.join(cwd, 'x', 'f.mp4'));
  const external = filmTarget(parseArgs(['fixtures/noise-film.cjs']), cwd);
  assert.equal(external.name, external.external.names[0]);
  assert.equal(external.file, path.join(cwd, 'fixtures', 'noise-film.mp4'));
  const style = filmTarget(parseArgs(['--style', 'dots']), cwd, (name) => ({ names: [name], directory: path.join(ROOT, 'out'), stem: 'style-' + name }));
  assert.deepEqual([style.name, style.file], ['dots', path.join(ROOT, 'out', 'style-dots.mp4')]);
  assert.throws(() => filmTarget(parseArgs(['constructor']), cwd), /no example called "constructor"/);
});

test('film: the page function selects the piece, passes the options to the page\'s film() and returns its file as base64', async () => {
  const bytes = new Uint8Array(70000).map((_, i) => (i * 7) % 256);
  const calls = [];
  globalThis.window = {
    __artifex: {
      select: (name) => calls.push(['select', name]),
      film: async (opts) => { calls.push(['film', opts]); return { bytes: bytes.length, frames: 3, blob: new Blob([bytes]) }; },
    },
  };
  try {
    const { report, data } = await exportInPage('readout', { scale: 2, bitrate: 1e7 });
    assert.deepEqual(calls, [['select', 'readout'], ['film', { scale: 2, bitrate: 1e7 }]]);
    assert.deepEqual(report, { bytes: bytes.length, frames: 3 }, 'the blob stays in the page');
    assert.deepEqual(new Uint8Array(Buffer.from(data, 'base64')), bytes);
  } finally { delete globalThis.window; }
});

test('film: the command writes the film and its report and prints one line; a film cut short writes nothing', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-film-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const report = {
    frames: 24, width: 1920, height: 1080, seconds: 1, bytes: 5, conversion: 'encoder', convertMs: 1, drawMs: 2, totalMs: 3, realtime: 0.33,
    sound: { codec: 'mp4a' },
  };
  const lines = [];
  const log = console.log;
  console.log = (line) => lines.push(line);
  try {
    let asked;
    await main(['readout', '--out', 'f.mp4', '--scale', '2'], async (...args) => { asked = args; return { browser: 'Edge/1', report, bytes: Buffer.from('abcde') }; }, dir);
    assert.deepEqual([asked[0].name, asked[1]], ['readout', { scale: 2 }]);
    assert.equal(fs.readFileSync(path.join(dir, 'f.mp4'), 'utf8'), 'abcde');
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'f.mp4.json'), 'utf8'));
    assert.deepEqual([saved.file, saved.piece, saved.browser, saved.frames], [path.join(dir, 'f.mp4'), 'readout', 'Edge/1', 24]);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^film: .*f\.mp4: 24 frames, 1920 × 1080, 1\.00 s.*with an AAC soundtrack.* Report: .*f\.mp4\.json$/);
    await assert.rejects(main(['readout', '--out', 'g.mp4'], async () => ({ browser: 'Edge/1', report, bytes: Buffer.from('abcd') }), dir),
      /4 of the film's 5 bytes arrived; nothing was written/);
    assert.equal(fs.existsSync(path.join(dir, 'g.mp4')), false);
  } finally { console.log = log; }
});
