'use strict';

// Every command-line tool: an argument it refuses is named, with what was
// given, and the tool's usage line follows; --help and -h print that usage and
// exit 0.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

const { withManifest } = require('./svg-manifest.js');

const ROOT = path.join(__dirname, '..');

// An empty ARTIFEX_HOME for this file's process and the tools it starts, so the
// user's own style packs cannot change a refusal's style hint.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-cli-home-'));
process.env.ARTIFEX_HOME = HOME;
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

/** `node <file> ...args` from the library root, resolving to { status, stdout, stderr }. */
const run = (file, ...args) => new Promise((resolve) => {
  execFile(process.execPath, [path.join(ROOT, file), ...args], { cwd: ROOT }, (error, stdout, stderr) => resolve({ status: error ? error.code : 0, stdout, stderr }));
});

/** `text` as a pattern that matches it literally. */
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A refusal: its cause, then one usage line; `rest`, a pattern for what may follow the cause on its line. */
const refusal = (cause, rest = '') => ({ message: new RegExp('^' + escape(cause) + rest + '\\nusage: [^\\n]+$') });

test('every tool prints its usage and exits 0 for --help and -h', async () => {
  const tools = ['tools/build-page.js', 'tools/contact-sheet.js', 'tools/film-cli.js', 'tools/still-cli.js', 'tools/replay.js', 'tools/styles.js',
    'tools/check-browser.js', 'tools/gallery.js', 'tests/negative.js',
    'tools/bench.js', 'tools/bench-sim.js', 'tools/render-examples.js', 'tools/lint-unread.js', 'tools/stitch.js', 'tools/measure-reference.js', 'tools/image.js'];
  const runs = await Promise.all(tools.flatMap((file) => ['--help', '-h'].map((flag) => run(file, flag).then((r) => ({ file, flag, ...r })))));
  for (const r of runs) {
    assert.equal(r.status, 0, `${r.file} ${r.flag}: ${r.stderr}`);
    assert.match(r.stdout, /^usage: [^\n]+\n$/, `${r.file} ${r.flag}`);
  }
  assert.match((await run('tools/styles.js', 'pack', '--help')).stdout, /^usage: npm run styles -- pack <marks\.js> --proof <proof\.js> /, 'pack has a usage of its own');
});

test('page: a refused argument is named, then the usage line', async () => {
  const cases = [
    [['--bogus'], 'page: unknown option --bogus'],
    [['a.cjs', '--bogus'], 'page: unknown option --bogus'],
    [['--style'], 'page: --style needs a style name; npm run styles lists them'],
    [['--style', '--json'], 'page: --style needs a style name; npm run styles lists them'],
    [['a.cjs', 'b.cjs'], 'page: one piece per page, got "a.cjs" and "b.cjs"'],
    [['--style', 'dots', 'b.cjs'], 'page: one piece per page, got "dots" and "b.cjs"'],
    [['a.cjs', '--style', 'dots'], 'page: give a piece or --style, not both; got "a.cjs" and --style dots'],
    [['--bogus', '--style', 'dots'], 'page: unknown option --bogus'],
  ];
  const runs = await Promise.all(cases.map(([args]) => run('tools/build-page.js', ...args)));
  cases.forEach(([args, cause], i) => {
    assert.equal(runs[i].status, 1, args.join(' '));
    assert.match(runs[i].stderr.trimEnd(), refusal(cause).message, args.join(' '));
  });
});

test('gallery: a refused argument is named, then the usage line', async (t) => {
  const cases = [
    ['tools/gallery.js', [], 'gallery: name the gallery folder'],
    ['tools/gallery.js', ['--bogus'], 'gallery: unknown option --bogus'],
    ['tools/gallery.js', ['a', 'b'], 'gallery: one gallery folder, got "a" and "b"'],
    ['tools/gallery.js', ['a', '--base'], 'gallery: --base needs a value'],
  ];
  for (const [file, args, cause] of cases) {
    await t.test(file + ' ' + args.join(' '), async () => {
      const r = await run(file, ...args);
      assert.equal(r.status, 1, r.stderr);
      assert.match(r.stderr.trimEnd(), refusal(cause).message);
    });
  }
});

test('bench, examples and lint: a refused argument is named, then the usage line, and nothing runs', async () => {
  const cases = [
    ['tools/bench.js', ['--bogus'], 'bench: unknown option --bogus'],
    ['tools/bench.js', ['drift'], 'bench: unexpected argument "drift"'],
    ['tools/bench-sim.js', ['--bogus'], 'bench-sim: unknown option --bogus'],
    ['tools/bench-sim.js', ['uniform'], 'bench-sim: unexpected argument "uniform"'],
    ['tools/bench-sim.js', ['--pile', 'x'], 'bench-sim: --pile needs piles from uniform, bimodal, mixed, pegboard, got "x"'],
    ['tools/bench-sim.js', ['--pile'], 'bench-sim: --pile needs piles from uniform, bimodal, mixed, pegboard, got nothing'],
    ['tools/bench-sim.js', ['--runs', '0'], 'bench-sim: --runs needs a whole number of 1 or more, got "0"'],
    ['tools/bench-sim.js', ['--frames'], 'bench-sim: --frames needs a whole number of 1 or more, got nothing'],
    ['tools/render-examples.js', ['--out', 'x'], 'examples: unknown option --out'],
    ['tools/render-examples.js', ['drift'], 'examples: unexpected argument "drift"'],
    ['tools/lint-unread.js', ['--fix'], 'lint: unknown option --fix'],
    ['tools/lint-unread.js', ['core'], 'lint: unexpected argument "core"'],
  ];
  const runs = await Promise.all(cases.map(([file, args]) => run(file, ...args)));
  cases.forEach(([file, args, cause], i) => {
    assert.equal(runs[i].status, 1, `${file} ${args.join(' ')}`);
    assert.equal(runs[i].stdout, '', `${file} ${args.join(' ')} does no work`);
    assert.match(runs[i].stderr.trimEnd(), refusal(cause).message, `${file} ${args.join(' ')}`);
  });
});

test('bench-sim: a pile it does not know is refused by name', () => {
  const { pile } = require('../tools/bench-sim.js');
  assert.throws(() => pile('mixd'), /bench-sim: no pile named "mixd"; the piles are uniform, bimodal, mixed, pegboard/);
  for (const name of ['uniform', 'bimodal', 'mixed']) assert.ok(pile(name).particles.length >= 1000, name);
});

test('bench-sim: --pile takes pegboard, whose 234 walls simulate files in a grid', () => {
  const { pile, parseArgs } = require('../tools/bench-sim.js');
  const { simulate } = require('../core/sim.js');
  assert.deepEqual(parseArgs(['--pile', 'mixed,pegboard']).piles, ['mixed', 'pegboard']);
  const { particles, walls } = pile('pegboard');
  assert.equal(particles.length, 600);
  assert.equal(walls.length, 234);
  assert.equal(simulate({ frames: 1, hz: 24, particles, walls }).wallGrid, true);
});

test('seeds: a refused argument is named, then the usage line', async (t) => {
  const { parseArgs } = require('../tools/contact-sheet.js');
  assert.throws(() => parseArgs(['drift', '--bogus']), refusal('seeds: unknown option --bogus'));
  for (const out of [['--out', 'x.html'], ['--out=x.html']]) {
    await t.test(out.join(' '), () => {
      assert.throws(() => parseArgs(['drift', ...out]), refusal('seeds: --out belongs to film, still, image, stitch and measure; seeds names its own files, under out/ for a registered piece or beside an external piece, and prints each path; drop --out'));
    });
  }
  assert.throws(() => parseArgs(['drift', '2', '1', 'extra']), refusal('seeds: unexpected argument "extra"'));
  assert.throws(() => parseArgs(['--style', 'impasto', '2', '1', 'extra']), /^Error: seeds: --style draws nothing/);
  assert.throws(() => parseArgs(['drift', '--png', '--timeout-ms', '5']), refusal('seeds: --timeout-ms takes an integer from 100 to 3600000 milliseconds (default 60000), got 5'));
});

test('seeds: a --figure or --part colour the canvas rejects is named, then the usage line', () => {
  const { figureFill, partCover, refuseSheet } = require('../tools/contact-sheet.js');
  // A canvas that, as a browser's, keeps the style set before a colour it rejects.
  let style = '#000000';
  const ctx = { canvas: { width: 1, height: 1 }, save() {}, restore() {}, reset() {}, getImageData: () => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) }) };
  Object.defineProperty(ctx, 'fillStyle', { get: () => style, set: (s) => { if (s !== 'nocolour') style = s; } });
  const sheetOf = (measure) => { try { measure(); } catch (e) { return { refusal: e.message }; } return {}; };
  assert.throws(() => refuseSheet(sheetOf(() => figureFill(ctx, () => {}, ['nocolour']))),
    refusal('seeds: --figure takes colours the canvas reads, such as #b07a5a or rgba(176, 122, 90, 0.5), got nocolour'));
  assert.throws(() => refuseSheet(sheetOf(() => partCover(ctx, () => {}, [{ name: 'red', styles: ['nocolour'] }]))),
    refusal('seeds: --part takes colours the canvas reads, such as #f00 or rgba(255, 0, 0, 0.5), got nocolour'));
});

test('film: a refused argument is named, then the usage line', () => {
  const { parseArgs } = require('../tools/film-cli.js');
  for (const [args, cause] of [
    [['readout', '--other'], 'film: unknown option --other'],
    [['a', 'b'], 'film: one piece per film, got "a" and "b"'],
    [[], 'film: name the piece to film: an example or ./piece.cjs'],
    [['--style', 'impasto', 'readout'], 'film: give a piece or --style, not both; got "readout" and --style impasto'],
    [['settle', '--force', 'no-aac', '--force', 'no-webgl2'], 'film: give --force only once'],
    [['settle', '--force', 'no-aac', '--force', 'no-h264'], 'film: give --force only once'],
    [['settle', '--force', 'no-opus'], 'film: --force takes no-aac or no-webgl2, got no-opus'],
    [['readout', '--out'], 'film: --out needs a value'],
    [['readout', '--timeout-ms', '99'], 'film: --timeout-ms takes an integer from 100 to 3600000 milliseconds (default 600000), got 99'],
    [['readout', '--timeout-ms', '1.5'], 'film: --timeout-ms takes an integer from 100 to 3600000 milliseconds (default 600000), got 1.5'],
    [['cues', '--crash-gpu'], 'film: --crash-gpu needs a value'],
    [['cues', '--crash-gpu', '--headed'], 'film: --crash-gpu needs a value'],
    [['cues', '--crash-gpu', 'soon'], 'film: --crash-gpu takes whole milliseconds from 0, got soon'],
    [['cues', '--crash-gpu', '-5'], 'film: --crash-gpu takes whole milliseconds from 0, got -5'],
    [['cues', '--crash-gpu', '1.5'], 'film: --crash-gpu takes whole milliseconds from 0, got 1.5'],
    [['cues', '--crash-gpu', ''], 'film: --crash-gpu takes whole milliseconds from 0, got '],
    [['cues', '--crash-gpu', '1e3'], 'film: --crash-gpu takes whole milliseconds from 0, got 1e3'],
    [['cues', '--crash-gpu', '2147483648'], 'film: --crash-gpu takes at most 2147483647 ms, got 2147483648'],
  ]) assert.throws(() => parseArgs(args), refusal(cause), args.join(' '));
  assert.equal(parseArgs(['cues', '--crash-gpu', '2147483647']).crashGpu, 2147483647);
  assert.equal(parseArgs(['cues', '--crash-gpu', '0']).crashGpu, 0);
  assert.equal('crashGpu' in parseArgs(['cues']), false);
});

test('film: crashAfter crashes the GPU process only while the export still runs', async (t) => {
  const { crashAfter } = require('../tools/film-cli.js');
  const client = (ended) => ({ sent: [], async send(method) { this.sent.push(method); return { result: { value: ended } }; } });
  const context = { signal: new AbortController().signal };
  const never = new Promise(() => {});
  // crashAfter's own timer does not hold the event loop open; this one does, until the test ends.
  const hold = setInterval(() => {}, 1000);
  t.after(() => clearInterval(hold));
  // The export ended before the delay passed: nothing is sent.
  const first = client(false);
  assert.equal(await crashAfter(first, context, Promise.resolve({}), 60000), false);
  assert.deepEqual(first.sent, []);
  // The delay passed, but the page says its export already ended: no crash.
  const late = client(true);
  assert.equal(await crashAfter(late, context, never, 0), false);
  assert.deepEqual(late.sent, ['Runtime.evaluate']);
  // The export still runs: the crash is sent.
  const running = client(false);
  assert.equal(await crashAfter(running, context, never, 0), true);
  assert.deepEqual(running.sent, ['Runtime.evaluate', 'Browser.crashGpuProcess']);
});

test('film: --crash-gpu is saved in the report and said in the summary line, whether or not the crash came', async (t) => {
  const { main } = require('../tools/film-cli.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-film-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const report = { frames: 24, width: 1920, height: 1080, seconds: 1, bytes: 1, conversion: 'encoder', convertMs: 1, drawMs: 2, totalMs: 3, realtime: 0.33 };
  const saved = () => JSON.parse(fs.readFileSync(path.join(dir, 'c.mp4.json'), 'utf8'));
  const lines = [], errors = [];
  const { log, error } = console;
  console.log = (line) => lines.push(line);
  console.error = (line) => errors.push(line);
  try {
    let asked;
    for (const crashed of [true, false]) {
      await main(['drift', '--out', 'c.mp4', '--crash-gpu', '1500'], async (...args) => { asked = args; return { browser: 'Edge/1', report, bytes: Buffer.from('a'), crashed }; }, dir);
      assert.equal(asked[3], 1500, 'the milliseconds reach the export');
      assert.deepEqual(saved().gpuCrash, { atMs: 1500, crashed });
    }
    await main(['drift', '--out', 'c.mp4'], async () => ({ browser: 'Edge/1', report, bytes: Buffer.from('a') }), dir);
    assert.equal('gpuCrash' in saved(), false, 'a film without --crash-gpu names no crash');
  } finally { console.log = log; console.error = error; }
  // The closing stderr line offers the review by what it finds and links it; it orders nothing.
  assert.match(errors.at(-1), /^film: a fresh-eyes review by a subagent without this work's context finds what the plan's author cannot see, such as a place left unshown, a cause off screen or a beat that reads only to someone who knows it: .*films\.md#fresh-eyes-review$/);
  assert.match(lines[0], / GPU process crashed 1500 ms into the export\. Report: /);
  assert.match(lines[1], / The export ended before 1500 ms, so the GPU process was not crashed\. Report: /);
  assert.doesNotMatch(lines[2], /GPU process/);
});

/** A refusal whose cause starts with `prefix`, where the rest names what the piece or parser found. */
const refusalFrom = (prefix) => refusal(prefix, '[^\\n]*');

// One subtest per message, so each names its own refusal when it fails.
test('seeds: every other argument refusal is named, then the usage line', async (t) => {
  const { parseArgs } = require('../tools/contact-sheet.js');
  for (const [args, cause] of [
    [['readout', '--frames', '3', '--frames', '3'], 'seeds: use --frames only once'],
    [['readout', '--frames', '1'], 'seeds: --frames needs a whole number of frames, 2 or more'],
    [['readout', '--at', 'x'], 'seeds: --at needs seconds separated by commas, such as 0.5,2,3.25'],
    [['readout', '--frames', '3', '--scale', '0'], 'seeds: --scale needs a positive plain decimal number of pixels per design unit, got 0'],
    [['readout', '--frames', '3', '--scale', '0x2'], 'seeds: --scale needs a positive plain decimal number of pixels per design unit, got 0x2'],
    [['readout', '--frames', '3', '--scale', '1e-1'], 'seeds: --scale needs a positive plain decimal number of pixels per design unit, got 1e-1'],
    [['readout', '--frames', '3', '--scale', ' 2'], 'seeds: --scale needs a positive plain decimal number of pixels per design unit, got  2'],
    [['readout', '--frames', '3', '--scale', ' '], 'seeds: --scale needs a positive plain decimal number of pixels per design unit, got " "'],
    [['readout', '--frames', '3', '--scale', `1${'0'.repeat(400)}`], `seeds: --scale needs a positive plain decimal number of pixels per design unit, got 1${'0'.repeat(400)}`],
    [['readout', '--frames', '3', '--loupe', '--reference', 'a.png', '--reference-scale', `1${'0'.repeat(400)}`], `seeds: --reference-scale needs a positive plain decimal number of crop pixels per photo pixel, such as 0.5 for a photo with twice the detail, got 1${'0'.repeat(400)}`],
    [['readout', '--frames', '3', '--scale'], 'seeds: --scale needs a positive plain decimal number of pixels per design unit, got nothing'],
    [['readout', '--frames', '3', '--loupe', '--reference', 'a.png', '--reference-scale', '0x2'], 'seeds: --reference-scale needs a positive plain decimal number of crop pixels per photo pixel, such as 0.5 for a photo with twice the detail, got 0x2'],
    [['readout', '--frames', '3', '--loupe', '--reference', 'a.png', '--reference-scale', '1e-1'], 'seeds: --reference-scale needs a positive plain decimal number of crop pixels per photo pixel, such as 0.5 for a photo with twice the detail, got 1e-1'],
    [['readout', '--frames', '3', '--loupe', '--reference', 'a.png', '--reference-scale', '0.5 '], 'seeds: --reference-scale needs a positive plain decimal number of crop pixels per photo pixel, such as 0.5 for a photo with twice the detail, got 0.5 '],
    [['drift', '--json', '--json'], 'seeds: use --json only once'],
    [['drift', '--png', '--png'], 'seeds: use --png only once'],
    [['readout', '--frames', '3', '--png', '--json', '--png'], 'seeds: use --png only once'],
    [['readout', '--png', '--timeout-ms'], 'seeds: --timeout-ms needs a number of milliseconds'],
    [['--style'], 'seeds: --style needs a style name; npm run styles lists them'],
    [['refit', '--box', '405x720', '--box', '405x720'], 'seeds: use --box or --reframe only once'],
    [['refit', '--box', 'x'], 'seeds: --box needs a box as WIDTHxHEIGHT, such as 405x720'],
    [['refit', '--box', '405x720', '--reframe', '0:405x720'], 'seeds: use --box or --reframe only once'],
    [['refit', '--reframe'], 'seeds: --reframe needs a box timeline as t:WIDTHxHEIGHT,..., such as 0:1280x720,1:405x720'],
    [['refit', '--reframe', 'bogus'], 'seeds: --reframe: box 0, "bogus", must be t:WIDTHxHEIGHT, such as 0.5:405x720'],
    [['drift', '--param', 'reach', '--param', 'turn'], 'seeds: use --param only once'],
    [['drift', '--param'], 'seeds: --param needs one or two comma-separated names'],
    [['drift', '--param', 'reach,reach'], 'seeds: --param needs one or two distinct parameter names'],
    [['drift', '--timeout-ms', '100'], 'seeds: --timeout-ms limits the browser that --png or --json starts; add one'],
    [['drift', '--scale', '1'], 'seeds: --scale, --loupe and --sound belong to a time strip; add --frames, --at, --shots or --contacts'],
    [['readout', '--frames', '3', '--shots'], 'seeds: a time strip takes one of --frames, --at, --shots or --contacts'],
    [['readout', '--frames', '3', '--param', 'x'], 'seeds: a time strip holds the seed and parameters; drop --param'],
    [['--frames', '3'], 'seeds: name one piece for a time strip'],
    [['readout', '--frames', '3', '2'], 'seeds: a time strip takes its frames from --frames, --at, --shots or --contacts, not a count or playhead'],
    [['--param', 'reach'], 'seeds: name one piece when using --param'],
    [['--box', '405x720'], 'seeds: name one piece when using --box'],
    [['--compare', 'a.png', 'b.png', '--compare', 'a.png', 'b.png'], 'seeds: use --compare only once'],
    [['--compare'], 'seeds: --compare needs a render and a reference, two .png files, got nothing'],
    [['--compare', 'a.png'], 'seeds: --compare needs a render and a reference, two .png files, got a.png'],
    [['--compare', 'a.png', 'b.jpg'], 'seeds: --compare needs a render and a reference, two .png files, got a.png b.jpg'],
    [['--compare', 'a.png', 'b.png', '--threshold', '8', '--threshold', '8'], 'seeds: use --threshold only once'],
    [['--compare', 'a.png', 'b.png', '--threshold'], 'seeds: --threshold takes a plain decimal channel difference from 0 to under 255, such as 24, got nothing'],
    [['--compare', 'a.png', 'b.png', '--threshold', 'x'], 'seeds: --threshold takes a plain decimal channel difference from 0 to under 255, such as 24, got x'],
    [['--compare', 'a.png', 'b.png', '--threshold', '-1'], 'seeds: --threshold takes a plain decimal channel difference from 0 to under 255, such as 24, got -1'],
    [['--compare', 'a.png', 'b.png', '--threshold', '255'], 'seeds: --threshold takes a plain decimal channel difference from 0 to under 255, such as 24, got 255'],
    [['--compare', 'a.png', 'b.png', '--threshold', ''], 'seeds: --threshold takes a plain decimal channel difference from 0 to under 255, such as 24, got ""'],
    [['--compare', 'a.png', 'b.png', '--threshold', ' '], 'seeds: --threshold takes a plain decimal channel difference from 0 to under 255, such as 24, got " "'],
    [['--compare', 'a.png', 'b.png', '--threshold', '0x20'], 'seeds: --threshold takes a plain decimal channel difference from 0 to under 255, such as 24, got 0x20'],
    [['--compare', 'a.png', 'b.png', '--threshold', '1e1'], 'seeds: --threshold takes a plain decimal channel difference from 0 to under 255, such as 24, got 1e1'],
    [['--compare', 'a.png', 'b.png', '--json', '--json'], 'seeds: use --json only once'],
    [['drift', '--threshold', '8'], 'seeds: --threshold belongs to --compare; add --compare <render.png> <reference.png>'],
    [['drift', '--cuts'], 'seeds: --cuts blends the frames either side of each cut on a shot strip; add --shots'],
    [['--compare', 'a.png', 'b.png', '--values'], 'seeds: --compare takes only --threshold and --json beside its two files, got --values'],
    [['drift', '--compare', 'a.png', 'b.png'], 'seeds: --compare takes only --threshold and --json beside its two files, got drift'],
    [['readout', '--frames', '3', '--sound', '--json', '--sound-reference', 'ref.txt'], 'seeds: --sound-reference needs a sound file: .wav, .mp3, .m4a, .aac, .ogg, .opus or .flac, got ref.txt'],
    [['readout', '--frames', '3', '--sound', '--json', '--sound-reference', 'a.wav', '--sound-reference', 'b.wav'], 'seeds: use --sound-reference only once'],
    [['readout', '--frames', '3', '--json', '--sound-reference', 'a.wav'], 'seeds: --sound-reference is measured beside the strip\'s soundtrack; add --sound'],
    [['readout', '--frames', '3', '--sound', '--sound-reference', 'a.wav'], 'seeds: --sound-reference reports its profile in the sheet\'s JSON; add --json'],
    [['readout', '--frames', '3', '--two-values'], 'seeds: --two-values needs two OKLCh lightnesses, dark then light, from 0 to 1, such as 0.12,0.88, got nothing'],
    [['readout', '--frames', '3', '--two-values', '0.12'], 'seeds: --two-values needs two OKLCh lightnesses, dark then light, from 0 to 1, such as 0.12,0.88, got 0.12'],
    [['readout', '--frames', '3', '--two-values', '1e-1,0.9'], 'seeds: --two-values needs two OKLCh lightnesses, dark then light, from 0 to 1, such as 0.12,0.88, got 1e-1,0.9'],
    [['readout', '--frames', '3', '--two-values', '0.9,0.12'], 'seeds: --two-values needs the dark value 0.2 or more under the light one, both from 0 to 1, as a declared two-value film holds them, got 0.9,0.12'],
    [['readout', '--frames', '3', '--two-values', '0.1,1.2'], 'seeds: --two-values needs the dark value 0.2 or more under the light one, both from 0 to 1, as a declared two-value film holds them, got 0.1,1.2'],
    [['readout', '--frames', '3', '--two-values', '0.1,0.9', '--two-values', '0.1,0.9'], 'seeds: use --two-values only once'],
    [['drift', '--two-values', '0.1,0.9'], 'seeds: --two-values reads the frames of a time strip; add --frames, --at, --shots or --contacts'],
    [['drift', '--gamut'], 'seeds: --gamut needs the characterization data the print-gamut view reads, which Artifex does not ship, got nothing; download FOGRA39L.txt, Fogra\'s data for offset printing on coated paper, from https://registry.color.org/cmyk-registry/fogra39 and pass its path, such as --gamut FOGRA39L.txt'],
    [['drift', '--gamut', '--json'], 'seeds: --gamut needs the characterization data the print-gamut view reads, which Artifex does not ship, got --json; download FOGRA39L.txt, Fogra\'s data for offset printing on coated paper, from https://registry.color.org/cmyk-registry/fogra39 and pass its path, such as --gamut FOGRA39L.txt'],
    [['drift', '--gamut', 'a.txt', '--gamut', 'b.txt'], 'seeds: use --gamut only once'],
    [['drift', '0'], 'seeds: count must be an integer >= 1, got 0'],
    [['drift', '3', 'x'], 'seeds: playhead must be a number, got x'],
    [['drift', '3', '1.5'], 'seeds: playhead must be from 0 (the start) to 1 (the end), got 1.5'],
    [['drift', '3', '-0.5'], 'seeds: playhead must be from 0 (the start) to 1 (the end), got -0.5'],
  ]) await t.test(args.join(' '), () => assert.throws(() => parseArgs(args), refusal(cause)));
});

test('seeds: a piece that cannot take an argument is named, then the usage line', async (t) => {
  const { page, planSheet, planStrip, sheetPlans } = require('../tools/contact-sheet.js');
  const { validate } = require('../core/piece.js');
  const EXAMPLES = require('../examples/index.js');
  const [drift, readout] = [validate(EXAMPLES.drift), validate(EXAMPLES.readout)];
  for (const [draw, cause] of [
    // planSheet repeats two of parseArgs's checks for callers that skip it.
    [() => planSheet(drift, 0), 'seeds: count must be an integer >= 1'],
    [() => planSheet(drift, 3, ['a', 'b', 'c']), 'seeds: --param needs one or two distinct parameter names'],
    [() => planStrip(validate(EXAMPLES.specimen), { frames: 3 }), 'seeds: specimen is a still; a time strip needs a timeline, and --at 0 shows the still itself'],
    [() => planStrip(drift, { frames: 3, sound: true }), 'seeds: --sound draws drift\'s soundtrack, and drift declares no sound'],
    [() => planStrip(drift, { shots: true }), 'seeds: --shots reads drift\'s shot list from state.cues.shots, the list shots() returns, and drift keeps none there'],
    [() => planStrip(readout, { at: [7] }), 'seeds: --at 7 is outside readout\'s 7 s'],
    [() => planStrip(readout, { frames: 169 }), 'seeds: --frames 169 asks for more than readout\'s 168 frames'],
    [() => planStrip(readout, { frames: 3, loupe: { x: 961, y: 0 } }), 'seeds: --loupe 961,0 is outside readout\'s 960 x 640 box'],
    [() => page(['drift'], 3, NaN), 'seeds: playhead must be a finite number'],
  ]) await t.test(cause, () => assert.throws(draw, refusal(cause)));
  for (const [draw, prefix] of [
    [() => page(['drift'], 3, 1, ['missing']), 'seeds: unknown parameter "missing" for drift.'],
    [() => sheetPlans(['refit'], 3, [], null, { w: 100, h: 100 }), 'seeds: refit cannot draw at 100 x 100'],
    [() => page(['constructor'], 3, 1), 'seeds: no example called "constructor".'],
  ]) await t.test(prefix, () => assert.throws(draw, refusalFrom(prefix)));
});

/**
 * A scratch ARTIFEX_HOME with the trusted pack `name`, a guide and one mark
 * function with its proof, set for the test and restored after it, so the
 * tools' own hint reads it. Resolves to the pack's folder.
 */
function packHome(t, name) {
  const { VERSION } = require('../core/piece.js');
  const styles = require('../tools/styles.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-cli-packs-'));
  const folder = path.join(dir, 'styles', name);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'marks.cjs'), "module.exports = { square(g, x, y, s) { g.fillStyle = '#123'; g.fillRect(x, y, s, s); } };\n");
  fs.writeFileSync(path.join(folder, 'proof.cjs'), 'module.exports = { square: { box: [0, 0, 20, 20], draw(g, marks) { marks.square(g, 0, 0, 20); } } };\n');
  fs.writeFileSync(path.join(folder, 'guide.md'), '# ' + name + '\n');
  const files = {};
  for (const file of ['marks.cjs', 'proof.cjs', 'guide.md']) files[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(folder, file))).digest('hex');
  fs.writeFileSync(path.join(folder, 'style.json'), JSON.stringify({ stylePack: 2, name, title: name, version: '1.0.0', artifex: VERSION, summary: 'A square.', guide: 'guide.md', module: 'marks.cjs', proof: 'proof.cjs', marks: ['square'], files }));
  styles.trust(name, { ARTIFEX_HOME: dir }, () => {});
  process.env.ARTIFEX_HOME = dir;
  t.after(() => { process.env.ARTIFEX_HOME = HOME; fs.rmSync(dir, { recursive: true, force: true }); });
  return folder;
}

test('seeds and film: an unknown piece named like a trusted style pack points to its guide and marks, never to --style', async (t) => {
  const folder = packHome(t, 'tile');
  const { page } = require('../tools/contact-sheet.js');
  const { parseArgs, filmTarget } = require('../tools/film-cli.js');
  const hint = (tool) => ({ message: new RegExp(`^${tool}: no example called "tile"\\. Known: [^\\n]+\\. For the style pack tile, read ${escape(path.join(folder, 'guide.md'))} and draw your own piece with the functions in ${escape(path.join(folder, 'marks.cjs'))}; for your own piece, pass its path, such as \\./tile\\.cjs\\nusage: [^\\n]+$`) });
  await t.test('seeds', () => assert.throws(() => page(['tile'], 3, 1), hint('seeds')));
  await t.test('film', () => assert.throws(() => filmTarget(parseArgs(['tile'])), hint('film')));
  await t.test('no style, no --style', () => assert.throws(() => page(['constructor'], 3, 1), (e) => !e.message.includes('--style constructor')));
});

test('film and still: --style draws nothing and is refused with the style\'s guide and marks, then the usage line', async (t) => {
  const folder = packHome(t, 'tile');
  const film = require('../tools/film-cli.js'), still = require('../tools/still-cli.js');
  const cause = (style, guide, module) => '--style draws nothing, since a style is a guide and the functions that draw its marks, not a picture. For ' + style + ', read ' + guide
    + ' and draw your own piece with the functions in ' + module + '; nothing was written';
  for (const [tool, target] of [['film', (args) => film.filmTarget(film.parseArgs(args))], ['still', (args) => still.stillTarget(still.parseArgs(args))]]) {
    await t.test(tool, () => {
      assert.throws(() => target(['--style', 'tile']), refusal(tool + ': ' + cause('the style pack tile', path.join(folder, 'guide.md'), path.join(folder, 'marks.cjs'))));
      assert.throws(() => target(['--style', 'Tile']), refusal(tool + ': ' + cause('the style pack tile', path.join(folder, 'guide.md'), path.join(folder, 'marks.cjs'))));
      assert.throws(() => target(['--style', 'nosuch']), refusalFrom(tool + ': --style draws nothing, since a style is a guide and the functions that draw its marks, not a picture; no style named "nosuch". Available: '));
    });
  }
});

test('film: every other argument refusal is named, then the usage line', async (t) => {
  const { parseArgs, filmTarget } = require('../tools/film-cli.js');
  for (const [args, cause] of [
    [['readout', '--scale', '0'], 'film: --scale must be a positive number, got 0'],
    [['readout', '--bitrate', 'x'], 'film: --bitrate must be a positive number, got x'],
    [['readout', '--out', 'film.mov'], 'film: --out must name an .mp4 file, got film.mov'],
    [['readout', '--seed', '-1'], 'film: --seed takes a whole number from 0 to 4294967295, got -1'],
    [['readout', '--seed', '7.5'], 'film: --seed takes a whole number from 0 to 4294967295, got 7.5'],
    [['settle', '--force', 'no-h264'], 'film: --force no-h264 leaves the page only its WebM recording, which npm run film does not save; check that recording with npm run browser -- --force no-h264, which takes no piece and records the first film its run exports'],
  ]) await t.test(args.join(' '), () => assert.throws(() => parseArgs(args), refusal(cause)));
  for (const [args, prefix] of [
    [['constructor'], 'film: no example called "constructor".'],
    [['readout', '--reframe', '0:960x640,1:640x640'], 'film: --reframe: readout cannot play that box timeline'],
  ]) await t.test(args.join(' '), () => assert.throws(() => filmTarget(parseArgs(args)), refusalFrom(prefix)));
});

test('film and still: --session plays a saved session, checked before Edge starts and named after it, and every refusal is named, then the usage line', async (t) => {
  const film = require('../tools/film-cli.js'), still = require('../tools/still-cli.js');
  const play = require('../core/play.js');
  const { slash } = require('../tools/piece-input.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-session-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const PIECE = 'tools/fixtures/play-piece.cjs';
  const s = play.session(require('../tools/fixtures/play-piece.cjs'), 4);
  s.advance([{ kind: 'down', x: 10, y: 10 }]);
  s.advance([]);
  const file = path.join(dir, 'round-4.session.json');
  fs.writeFileSync(file, JSON.stringify(s.save()));
  const filmOf = (...args) => film.filmTarget(film.parseArgs([PIECE, ...args]), ROOT);
  const stillOf = (...args) => still.stillTarget(still.parseArgs([PIECE, ...args]), ROOT);
  await t.test('a film plays one frame a tick, named after the session, which it keeps beside the film', () => {
    const target = filmOf('--session', file);
    assert.equal(path.basename(target.file), 'round-4.mp4');
    assert.equal(target.session.name, 'round-4.session.json');
    assert.equal(target.session.film.time.duration, 3 / 60);
    assert.equal(target.session.beside, path.join(path.dirname(target.file), 'round-4.session.json'));
    assert.equal(path.basename(filmOf('--session', file, '--out', path.join(dir, 'kept.mp4')).file), 'kept.mp4');
  });
  await t.test('a still reads --at in the session\'s seconds', () => {
    const target = stillOf('--session', file, '--at', String(2 / 60));
    assert.equal(path.basename(target.file), 'round-4.png');
    assert.equal(target.t, 1);
  });
  fs.writeFileSync(path.join(dir, 'broken.session.json'), '{');
  fs.writeFileSync(path.join(dir, 'other.session.json'), JSON.stringify({ ...s.save(), piece: 'other' }));
  const elsewhere = path.join(dir, 'elsewhere');
  fs.mkdirSync(elsewhere);
  fs.writeFileSync(path.join(elsewhere, 'round-4.session.json'), JSON.stringify({ ...s.save(), seed: 5 }));
  for (const [run, args, cause] of [
    [() => film.parseArgs([PIECE, '--session', file, '--session', file]), [], 'film: give --session only once'],
    [() => still.parseArgs([PIECE, '--session', file, '--session', file]), [], 'still: give --session only once'],
    [filmOf, [], 'film: play-piece is interactive, so its film comes from a saved session; pass --session <file> as the page\'s save session wrote it'],
    [filmOf, ['--session', file, '--seed', '3'],'film: give --seed or --session, not both: a session plays at the seed it was played at'],
    [filmOf, ['--session', file, '--reframe', '0:160x120,1:160x120'], 'film: give --reframe or --session, not both: a session plays at the box it was played at'],
    [stillOf, ['--session', file, '--box', '80x60'], 'still: give --box or --session, not both: a session plays at the box it was played at'],
    [stillOf, ['--at', '1'], 'still: play-piece is interactive, so --at reads a saved session\'s time; pass --session <file> as the page\'s save session wrote it'],
    [filmOf, ['--session', path.join(dir, 'none.json')], 'film: --session: no session file at ' + slash(path.join(dir, 'none.json')) + '; name the file the page\'s save session wrote'],
    [filmOf, ['--session', path.join(dir, 'other.session.json')], 'film: --session: session: the session is of piece "other", not play-piece'],
    [stillOf, ['--session', file, '--at', '1'], 'still: --at 1 is outside play-piece\'s 0.05 s'],
  ]) await t.test(cause, () => assert.throws(() => run(...args), refusal(cause)));
  for (const [run, args, prefix] of [
    [filmOf, ['--session', path.join(dir, 'broken.session.json')], 'film: --session: '],
    [filmOf, ['--session', file, '--out', path.join(elsewhere, 'film.mp4')], 'film: --session: '],
  ]) await t.test(args.join(' '), () => assert.throws(() => run(...args), refusalFrom(prefix)));
  assert.throws(() => filmOf('--session', path.join(dir, 'broken.session.json')), /is not JSON: /);
  assert.throws(() => filmOf('--session', file, '--out', path.join(elsewhere, 'film.mp4')), /round-4\.session\.json already holds another session, and replay reads the session beside the file it checks; move it, or write the file elsewhere with --out/);
});

test('still: without --out the file name carries --seed, so two seeds stay apart', () => {
  const { parseArgs, stillTarget } = require('../tools/still-cli.js');
  const name = (...args) => path.basename(stillTarget(parseArgs(['specimen', ...args])).file);
  assert.deepEqual([name(), name('--seed', '7'), name('--seed', '7', '--out', 'kept.png')], ['specimen.png', 'specimen-seed7.png', 'kept.png']);
});

test('still: a medium sheet\'s monotony report follows the file line, one line per sheet, and a piece without one prints only that line', async (t) => {
  const { main } = require('../tools/still-cli.js');
  const logged = [];
  t.mock.method(console, 'log', (line) => logged.push(line));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-still-log-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const report = (calls) => ({ calls, stroke: 0, paint: calls, narrowness: { length: calls > 1 ? 1 : null, angle: null }, mean: calls > 1 ? 1 : null, short: 0 });
  const drawn = (monotony) => async () => ({ bytes: Buffer.from('png'), manifest: { piece: 'specimen', seed: 4 }, monotony });
  await main(['specimen', '--out', path.join(dir, 'a.png')], drawn([report(20), report(1)]), dir);
  assert.equal(logged.length, 3);
  assert.match(logged[0], /^still: /);
  assert.equal(logged[1], 'stroke log 1: 20 calls (stroke 0, paint 20); narrowness, 0 varied to 1 all alike: length 1; mean 1; shorter than 1.5 widths 0');
  assert.equal(logged[2], 'stroke log 2: 1 calls (stroke 0, paint 1); narrowness, 0 varied to 1 all alike: none; mean null; shorter than 1.5 widths 0');
  logged.length = 0;
  await main(['specimen', '--out', path.join(dir, 'b.png')], drawn([]), dir);
  await main(['specimen', '--out', path.join(dir, 'c.png')], drawn(undefined), dir);
  assert.equal(logged.length, 2, 'no sheet, no report line');
});

test('still: every argument refusal is named, then the usage line', async (t) => {
  const { parseArgs, stillTarget } = require('../tools/still-cli.js');
  const specimen = require('../core/piece.js').validate(require('../examples/index.js').specimen).size;
  for (const [args, cause] of [
    [['specimen', '--other'], 'still: unknown option --other'],
    [['a', 'b'], 'still: one piece per still, got "a" and "b"'],
    [[], 'still: name the piece to draw: an example or ./piece.cjs'],
    [['--style', 'impasto', 'specimen'], 'still: give a piece or --style, not both; got "specimen" and --style impasto'],
    [['specimen', '--out'], 'still: --out needs a value'],
    [['specimen', '--out', 'still.jpg'], 'still: --out must name a .png or .svg file, got still.jpg'],
    [['specimen', '--out', 'still.svg', '--scale', '2'], 'still: --scale sets a PNG\'s pixels; an SVG is drawn at the design box'],
    [['specimen', '--seed', '1.5'], 'still: --seed takes a whole number from 0 to 4294967295, got 1.5'],
    [['specimen', '--seed', '4294967296'], 'still: --seed takes a whole number from 0 to 4294967295, got 4294967296'],
    [['specimen', '--at', '-1'], 'still: --at must be a number of seconds, 0 or more, got -1'],
    [['specimen', '--scale', '0'], 'still: --scale must be a positive number, got 0'],
    [['specimen', '--timeout-ms', '99'], 'still: --timeout-ms takes an integer from 100 to 3600000 milliseconds (default 60000), got 99'],
    [['refit', '--box', '405'], 'still: --box needs a box as WIDTHxHEIGHT, such as 405x720'],
    [['refit', '--box', '405x720', '--box', '720x720'], 'still: give --box only once'],
  ]) await t.test(args.join(' ') || '(nothing)', () => assert.throws(() => parseArgs(args), refusal(cause)));
  for (const [args, cause] of [
    [['specimen', '--box', '405x720'], `still: specimen declares no boxes, so it draws only at ${specimen.w} x ${specimen.h}`],
    [['refit', '--box', '4000x720'], 'still: refit cannot draw at 4000 x 720: w 4000 is outside the declared [240, 1920]; it takes widths 240 to 1920 and heights 240 to 1920'],
    [['drift', '--out', 'drift.svg'], 'still: drift declares raster only, so it has no SVG; save a PNG'],
    [['specimen', '--at', '1'], 'still: specimen is a still; --at 0 is its one frame'],
    [['readout', '--at', '7'], 'still: --at 7 is outside readout\'s 7 s'],
  ]) await t.test(args.join(' '), () => assert.throws(() => stillTarget(parseArgs(args)), refusal(cause)));
  await t.test('constructor', () => assert.throws(() => stillTarget(parseArgs(['constructor'])), refusalFrom('still: no example called "constructor".')));
});

test('still: a saved SVG carries the recipe replay draws again, at the seed and second asked', async () => {
  const { main } = require('../tools/still-cli.js');
  const { replay } = require('../tools/replay.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-still-'));
  const log = console.log;
  try {
    console.log = () => {};
    await main(['readout', '--seed', '7', '--at', '2', '--out', 'frame.svg'], undefined, dir);
    console.log = log;
    const r = await replay('frame.svg', { cwd: dir });
    assert.equal(r.match, true, r.detail);
    assert.equal(r.manifest.seed, 7);
    assert.equal(r.manifest.t, 48 / 167, 'the frame holding 2 s at 24 Hz, of 168');
  } finally {
    console.log = log;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('still: --box saves a piece that declares boxes at that box, and replay draws it again there', async () => {
  const { main } = require('../tools/still-cli.js');
  const { replay } = require('../tools/replay.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-still-'));
  const log = console.log;
  const lines = [];
  try {
    console.log = (line) => lines.push(line);
    await main(['refit', '--box', '405x720', '--seed', '3', '--at', '1', '--out', 'frame.svg'], undefined, dir);
    console.log = log;
    const r = await replay('frame.svg', { cwd: dir });
    assert.equal(r.match, true, r.detail);
    assert.deepEqual([r.manifest.size, r.manifest.seed], [{ w: 405, h: 720 }, 3]);
    assert.match(lines[0], /: refit seed 3 at box 405x720, the frame at 1 s/);
  } finally {
    console.log = log;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('styles: drawPng draws the page\'s piece at its box, and as declared without one', async () => {
  const { drawPng } = require('../tools/styles.js');
  const run = async (box) => {
    const calls = [];
    const canvas = { getContext: () => ({}), toBlob: (done) => done({ arrayBuffer: async () => new ArrayBuffer(0) }) };
    globalThis.document = { createElement: () => canvas };
    globalThis.window = { __artifex: {
      examples: { refit: 'module' },
      piece: {
        validate: (p) => (calls.push(['validate', p]), p === 'module' ? { size: { w: 100, h: 200 } } : { size: { w: 405, h: 720 } }),
        atBox: (p, b) => (calls.push(['atBox', p.size.w, b]), 'boxed'),
        solve: (p) => (calls.push(['solve', p.size.w]), { stages: {}, manifest: {} }),
      },
      render: { drawFrame: (ctx, p, solved, t, o) => (calls.push(['draw', p.size.w, o.scale]), t) },
    } };
    try { await drawPng('refit', 3, 0.5, 810, box); } finally { delete globalThis.window; delete globalThis.document; }
    return calls;
  };
  assert.deepEqual(await run({ w: 405, h: 720 }), [['validate', 'module'], ['atBox', 100, { w: 405, h: 720 }], ['validate', 'boxed'], ['solve', 405], ['draw', 405, 2]]);
  assert.deepEqual(await run(undefined), [['validate', 'module'], ['solve', 100], ['draw', 100, 8.1]]);
});

test('styles: pngInEdge sends the box to the page and saves the PNG through the injected browser', async () => {
  const { pngInEdge } = require('../tools/styles.js');
  const png = Buffer.from('89504e470d0a1a0a0000000049454e44ae426082', 'hex').toString('base64');
  const expressions = [];
  const value = JSON.stringify({ png, manifest: { piece: 'refit' } });
  const client = { send: async (_, { expression }) => {
    expressions.push(expression);
    if (expression.startsWith('(async () => (globalThis.__artifexValue')) return { result: { value: value.length } };
    if (expression.startsWith('globalThis.__artifexValue.slice')) return { result: { value } };
    return { result: { value: true } };
  } };
  const edge = (page, browser, work) => work(client, { errors: [], phase: '' });
  await pngInEdge(null, 'refit', 3, 0, 810, {}, { w: 405, h: 720 }, edge);
  await pngInEdge(null, 'refit', 3, 0, 810, {}, undefined, edge);
  const drawn = expressions.filter((e) => e.includes('__artifexValue = JSON.stringify'));
  assert.equal(drawn.length, 2);
  assert.ok(drawn[0].includes('"refit", 3, 0, 810, {"w":405,"h":720}, "styles")'), 'with a box');
  assert.ok(drawn[1].includes('"refit", 3, 0, 810, null, "styles")'), 'without one');
});

test('still: drawPng refuses a PieceError from validate, atBox or solve as still: <its message>, and a piece\'s own Error keeps its stack', async () => {
  const { drawPng } = require('../tools/styles.js');
  const { evaluate } = require('../tools/check-browser.js');
  const pieceError = (message) => Object.assign(new Error(message), { name: 'PieceError' });
  const fails = { validate: null, atBox: null, solve: null, drawFrame: null };
  const raise = (step, value) => { if (fails[step]) throw fails[step]; return value; };
  // drawPng in Node, its rejection carried as the page's description to evaluate(), for npm run still.
  const drawn = async (step, error) => {
    Object.keys(fails).forEach((key) => { fails[key] = key === step ? error : null; });
    globalThis.document = { createElement: () => ({ getContext: () => ({}), toBlob: (done) => done({ arrayBuffer: async () => new ArrayBuffer(0) }) }) };
    globalThis.window = { __artifex: {
      examples: { refit: 'module' },
      piece: {
        validate: () => raise('validate', { size: { w: 100, h: 200 } }),
        atBox: () => raise('atBox', 'boxed'),
        solve: () => raise('solve', { stages: {}, manifest: {} }),
      },
      render: { drawFrame: () => raise('drawFrame', 0) },
    } };
    let description;
    try { await drawPng('refit', 3, 0, 100, { w: 50, h: 100 }, 'still'); } catch (e) { description = e.stack; } finally { delete globalThis.window; delete globalThis.document; }
    return evaluate({ command: 'still', send: async () => ({ exceptionDetails: { exception: { description } } }) }, 'drawPng');
  };
  for (const step of ['validate', 'atBox', 'solve']) {
    await assert.rejects(drawn(step, pieceError('sound: a soundtrack needs a timeline')),
      { message: 'still: sound: a soundtrack needs a timeline; nothing was written', pageRefusal: true }, step);
  }
  const own = await drawn('drawFrame', new Error('sound: no voice')).then(() => null, (e) => e);
  assert.equal(own.pageRefusal, undefined, 'a piece\'s own Error is no tool refusal');
  assert.match(own.message, /^browser: evaluation failed: Error: drawing refit threw: Error: sound: no voice\n\s+at /);
});

test('styles: pngInEdge shows a page refusal as its own message, and leaves other evaluation failures alone', async () => {
  const { pngInEdge } = require('../tools/styles.js');
  // The page is ready (waitFor reads true); drawing it throws.
  const failWith = (description) => ({ send: async (_, { expression }) => (expression.includes('drawPng')
    ? { exceptionDetails: { exception: { description } } } : { result: { value: true } }) });
  // A stand-in for withEdge that hands the client its options' command, as withEdge does.
  const run = (description) => pngInEdge(null, 'refit', 3, 0, 810, {}, null, (page, browser, work) => work({ ...failWith(description), command: browser.command }, { errors: [], phase: '' }));
  const stack = '\n    at drawPng (<anonymous>:12:11)\n    at <anonymous>:1:1';
  await assert.rejects(run('Error: styles: build stage fields threw: no field; nothing was written' + stack), { message: 'styles: build stage fields threw: no field; nothing was written' });
  await assert.rejects(run('TypeError: x is not a function' + stack), { message: 'browser: evaluation failed: TypeError: x is not a function' + stack });
  await assert.rejects(run('Error: plain' + stack), { message: 'browser: evaluation failed: Error: plain' + stack });
});

test('still: pngInEdge refuses only its own tool\'s page refusals, during the drawing and among the page errors at its end', async (t) => {
  const { pngInEdge } = require('../tools/styles.js');
  const png = Buffer.from('89504e470d0a1a0a0000000049454e44ae426082', 'hex').toString('base64');
  const value = JSON.stringify({ png, manifest: { piece: 'refit' } });
  const stack = '\n    at drawPng (<anonymous>:12:11)\n    at <anonymous>:1:1';
  // A stand-in for withEdge whose page draws the PNG and has reported `reported`
  // meanwhile, or throws `thrown` from the drawing; the client carries the options' command.
  const still = ({ thrown = null, reported = [] }) => pngInEdge(null, 'refit', 3, 0, 810, {}, null, (page, browser, work) => {
    const context = { errors: [], phase: '' };
    return work({ command: browser.command, send: async (_, { expression }) => {
      if (expression.startsWith('(async () => (globalThis.__artifexValue')) {
        if (thrown) return { exceptionDetails: { exception: { description: thrown + stack } } };
        context.errors.push(...reported);
        return { result: { value: value.length } };
      }
      if (expression.startsWith('globalThis.__artifexValue.slice')) return { result: { value } };
      return { result: { value: true } };
    } }, context);
  }, 'still');
  await t.test('a piece\'s own Error that opens with another prefix keeps its stack', async () => {
    const own = await still({ thrown: 'Error: sound: no voice' }).then(() => null, (e) => e);
    assert.equal(own.pageRefusal, undefined, 'no tool refusal');
    assert.equal(own.message, 'browser: evaluation failed: Error: sound: no voice' + stack);
  });
  await t.test('a PieceError the page reported while it drew', async () => {
    await assert.rejects(still({ reported: ['PieceError: sound: a soundtrack needs a timeline' + stack] }),
      { message: 'still: sound: a soundtrack needs a timeline', pageRefusal: true });
  });
});

// The page's description of `error`, as Edge gives it: its stack.
const thrown = (error) => ({ exceptionDetails: { exception: { description: error.stack } } });
// A piece the page's validate refuses, and the PieceError it throws.
const unvalidated = { name: 'demo', size: { w: 32, h: 24 }, sound() {}, draw() {} };
const pieceError = () => { try { require('../core/piece.js').validate(unvalidated); } catch (e) { return e; } return null; };

test('replay: a page PieceError is refused as replay: <its message>, and a piece\'s own Error keeps its stack', async (t) => {
  const vm = require('node:vm');
  const core = require('../core/piece.js');
  const { exportFilm } = require('../core/film.js');
  const { fakeAudio, fakeCodecs, fakeCanvas } = require('./fake-media.js');
  const { nullSurface } = require('../tools/bench.js');
  const { replay, compareFilm } = require('../tools/replay.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-cli-replay-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const piece = path.join(dir, 'demo.cjs');
  fs.writeFileSync(piece, 'module.exports = { name: "demo", size: { w: 32, h: 24 }, seed: 5, outputs: ["raster"], time: { duration: 1, hz: 12 }, draw(g) { g.fillRect(0, 0, 8, 8); } };\n');
  const p = core.validate(require(piece));
  const codecs = fakeCodecs();
  let clock = 0;
  const film = (await exportFilm(p, core.solve(p, p.seed), {
    VideoEncoder: codecs.VideoEncoder, VideoFrame: codecs.VideoFrame, AudioEncoder: codecs.AudioEncoder, AudioData: codecs.AudioData,
    OfflineAudioContext: fakeAudio().Context, createCanvas: (w, h) => fakeCanvas({ width: w, height: h }, nullSurface),
    now: () => (clock += 1), pause: async () => {},
  })).bytes;
  const file = path.join(dir, 'demo.mp4');
  fs.writeFileSync(file, film);
  // A stand-in for withEdge whose page runs compareFilm with `api` as its
  // window.__artifex or, given `reported`, has reported those errors meanwhile
  // and compared no frame; the client carries the options' command, as withEdge's does.
  const run = (api, reported = []) => replay(file, { piece, browser: {}, withEdge: (page, options, work) => {
    const context = { errors: [], phase: 'film replay', version: { Browser: 'Stand-in/1' } };
    return work({ command: options.command, send: async (method, { expression }) => {
      if (expression.startsWith('document.readyState')) return { result: { value: true } };
      if (expression.startsWith('fetch("/file")')) return { result: { value: film.length } };
      assert.ok(expression.includes(compareFilm.name), 'only compareFilm runs the piece');
      if (reported.length) { context.errors.push(...reported); return { result: { value: [] } }; }
      try { return { result: { value: await vm.runInNewContext(expression, { window: { __artifex: api } }) } }; } catch (e) { return thrown(e); }
    } }, context);
  } });
  await t.test('a PieceError from the page\'s validate', async () => {
    await assert.rejects(run({ examples: { demo: unvalidated }, piece: core }),
      { message: 'replay: ' + pieceError().message, pageRefusal: true });
  });
  await t.test('a piece\'s own Error', async () => {
    const own = await run({ examples: { demo: p }, piece: { ...core, solve: () => { throw new Error('sound: no voice'); } } }).then(() => null, (e) => e);
    assert.equal(own.pageRefusal, undefined, 'no tool refusal');
    assert.match(own.message, /^browser: evaluation failed: Error: sound: no voice\n\s+at /);
  });
  await t.test('a PieceError the page reported while it compared the film', async () => {
    await assert.rejects(run({ examples: { demo: p }, piece: core }, [pieceError().stack]),
      { message: 'replay: ' + pieceError().message, pageRefusal: true });
  });
});

test('film: a PieceError the page reported during the export is refused as film: <its message> at the export\'s end', async (t) => {
  const { exportFilm } = require('../tools/film-cli.js');
  const value = JSON.stringify({ report: {}, data: '', sound: null });
  // A stand-in for withEdge whose page exports a film and has reported `reported`
  // meanwhile; the client carries the options' command, as withEdge's does.
  const film = (reported) => exportFilm({ name: 'demo' }, {}, {}, undefined, (page, options, work) => {
    const context = { errors: [], phase: '', version: { Browser: 'Stand-in/1' } };
    return work({ command: options.command, send: async (_, { expression }) => {
      if (expression.startsWith('(async () => (globalThis.__artifexValue')) { context.errors.push(...reported); return { result: { value: value.length } }; }
      if (expression.startsWith('globalThis.__artifexValue.slice')) return { result: { value } };
      return { result: { value: true } };
    } }, context);
  });
  await t.test('a PieceError', async () => {
    await assert.rejects(film([pieceError().stack]), { message: 'film: ' + pieceError().message, pageRefusal: true });
  });
  await t.test('a piece\'s own Error', async () => {
    const own = await film([new Error('sound: no voice').stack]).then(() => null, (e) => e);
    assert.equal(own.pageRefusal, undefined, 'no tool refusal');
    assert.match(own.message, /^browser: page errors:\nError: sound: no voice\n\s+at /);
  });
});

test('seeds: the reference photo and sound pages refuse a page PieceError as seeds: <its message>', async (t) => {
  const { cropReference, measureSound } = require('../tools/contact-sheet.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-cli-reference-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'reference.bin');
  fs.writeFileSync(file, Buffer.from([1, 2, 3, 4]));
  // A stand-in for withEdge whose page is ready and throws a PieceError from
  // anything else it runs; the client carries the options' command, as withEdge's does.
  const edge = (page, options, work) => work({ command: options.command, send: async (_, { expression }) => (expression.startsWith('location.protocol')
    ? { result: { value: true } } : thrown(pieceError())) }, { errors: [], phase: '' });
  await t.test('the photo', async () => {
    await assert.rejects(cropReference(file, { w: 2, h: 2 }, {}, undefined, edge), { message: 'seeds: ' + pieceError().message, pageRefusal: true });
  });
  await t.test('the sound', async () => {
    await assert.rejects(measureSound(file, undefined, edge), { message: 'seeds: ' + pieceError().message, pageRefusal: true });
  });
});

test('seeds: a PieceError the reference photo or sound page reported meanwhile is refused as seeds: <its message> at the route\'s end', async (t) => {
  const { cropReference, measureSound } = require('../tools/contact-sheet.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-cli-reference-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'reference.bin');
  fs.writeFileSync(file, Buffer.from([1, 2, 3, 4]));
  // A stand-in for withEdge whose page reads a 4 x 4 photo and returns `value`
  // in pieces, having reported a PieceError meanwhile; the client carries the options' command.
  const edge = (value) => (page, options, work) => {
    const context = { errors: [], phase: '' };
    return work({ command: options.command, send: async (_, { expression }) => {
      if (expression.startsWith('(async () => (globalThis.__artifexValue')) { context.errors.push(pieceError().stack); return { result: { value: value.length } }; }
      if (expression.startsWith('globalThis.__artifexValue.slice')) return { result: { value } };
      return { result: { value: expression.startsWith('location.protocol') ? true : { W: 4, H: 4 } } };
    } }, context);
  };
  await t.test('the photo', async () => {
    await assert.rejects(cropReference(file, { w: 2, h: 2 }, {}, undefined, edge(JSON.stringify('data:image/png;base64,'))),
      { message: 'seeds: ' + pieceError().message, pageRefusal: true });
  });
  await t.test('the sound', async () => {
    await assert.rejects(measureSound(file, undefined, edge(JSON.stringify({ seconds: 1, rate: 48000, channels: 1, profile: {} }))),
      { message: 'seeds: ' + pieceError().message, pageRefusal: true });
  });
});

test('seeds: a PieceError the sheet page throws is refused as seeds: <its message>, and a piece\'s own Error stays a page error with its stack', async (t) => {
  const { captureSheet } = require('../tools/check-browser.js');
  // A stand-in for withEdge whose page has thrown `error` while it set the sheet
  // up; the client carries the options' command, as withEdge's does.
  const sheet = (error) => captureSheet('<title>sheet</title>', path.join(os.tmpdir(), 'artifex-cli-sheet'), { cells: 1, images: false },
    (page, options, work) => work({ command: options.command, send: async () => ({ result: { value: false } }) }, { errors: [error.stack], phase: 'piece setup of demo' }));
  await t.test('a PieceError from the page\'s validate', async () => {
    await assert.rejects(sheet(pieceError()), { message: 'seeds: ' + pieceError().message, pageRefusal: true });
  });
  await t.test('a piece\'s own Error', async () => {
    const own = await sheet(new Error('sound: no voice')).then(() => null, (e) => e);
    assert.equal(own.pageRefusal, undefined, 'no tool refusal');
    assert.match(own.message, /^browser: page errors:\nError: sound: no voice\n\s+at /);
  });
});

test('styles: drawPng refuses a failed build stage and says nothing was written', async () => {
  const { drawPng } = require('../tools/styles.js');
  globalThis.window = { __artifex: {
    examples: { refit: 'module' },
    piece: { validate: () => ({ size: { w: 100, h: 200 } }), solve: () => ({ stages: { error: { stage: 'fields', message: 'no field' } } }) },
  } };
  try {
    await assert.rejects(drawPng('refit', 3, 0, 100, null), { message: 'styles: build stage fields threw: no field; nothing was written' });
    await assert.rejects(drawPng('refit', 3, 0, 100, null, 'still'), { message: 'still: build stage fields threw: no field; nothing was written' });
  } finally { delete globalThis.window; }
});

test('still: a PNG at --box is drawn through the shared PNG route with the box, and the summary names the box its manifest records', async () => {
  const { main, drawStill } = require('../tools/still-cli.js');
  const { pngManifest } = require('../core/export.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-still-'));
  // A PNG signature and its IEND chunk, all pngWithManifest needs.
  const png = Buffer.from('89504e470d0a1a0a0000000049454e44ae426082', 'hex').toString('base64');
  const manifest = { piece: 'refit', seed: 3, t: 0, size: { w: 405, h: 720 } };
  const expressions = [];
  // A stand-in client: waitFor reads true, evaluateInPieces reads the drawn value in one piece.
  const value = JSON.stringify({ png, manifest });
  const client = { send: async (_, { expression }) => {
    expressions.push(expression);
    if (expression.startsWith('(async () => (globalThis.__artifexValue')) return { result: { value: value.length } };
    if (expression.startsWith('globalThis.__artifexValue.slice')) return { result: { value } };
    return { result: { value: true } };
  } };
  const edge = (page, browser, work) => work(client, { errors: [], phase: '' });
  const log = console.log;
  const lines = [];
  try {
    console.log = (line) => lines.push(line);
    await main(['refit', '--box', '405x720', '--seed', '3', '--scale', '2', '--out', 'refit.png'], (target, options) => drawStill(target, options, edge), dir);
    console.log = log;
    const drawn = expressions.find((e) => e.includes('__artifexValue = JSON.stringify'));
    assert.ok(drawn.includes('async function drawPng('), 'the page draws through drawPng');
    assert.ok(drawn.includes('"refit", 3, 0, 810, {"w":405,"h":720}, "still")'),'with the seed, the width at scale 2 of the box, the box and still as its refusals\' prefix');
    assert.deepEqual(pngManifest(new Uint8Array(fs.readFileSync(path.join(dir, 'refit.png')))), manifest);
    assert.match(lines[0], /: refit seed 3 at box 405x720/);
  } finally {
    console.log = log;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('still: the summary line prints the saved path with forward slashes', async () => {
  const { main } = require('../tools/still-cli.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-still-'));
  const log = console.log;
  const lines = [];
  try {
    console.log = (line) => lines.push(line);
    await main(['readout', '--out', 'frame.svg'], undefined, dir);
  } finally {
    console.log = log;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const want = `still: ${path.join(dir, 'frame.svg').split(path.sep).join('/')}: readout`;
  assert.equal(lines.length, 1);
  assert.equal(lines[0].slice(0, want.length), want, 'the saved path is printed with forward slashes');
});

test('still: the replay hint prints its file and --piece paths with forward slashes', async () => {
  const { main } = require('../tools/still-cli.js');
  const folder = 'out/test-still-hint';
  const log = console.log;
  const lines = [];
  try {
    console.log = (line) => lines.push(line);
    await main(['./tests/fixtures/hatch-film.cjs', '--out', folder + '/frame.png'], async () => ({ bytes: Buffer.from('x'), manifest: { piece: 'hatch-film', seed: 1 } }), ROOT);
  } finally {
    console.log = log;
    fs.rmSync(path.join(ROOT, folder), { recursive: true, force: true });
  }
  assert.deepEqual(lines, [`still: ${folder}/frame.png: hatch-film seed 1, the frame at 0 s; npm run film saves the whole film.`
    + ` Check it with npm --prefix "${ROOT.split(path.sep).join('/')}" run replay -- "${folder}/frame.png" --piece "tests/fixtures/hatch-film.cjs"`]);
});

test('hint: names the library root, quotes each path with forward slashes and leaves out empty words', () => {
  const { hint, quote } = require('../tools/piece-input.js');
  const root = ROOT.split(path.sep).join('/');
  assert.equal(quote(['my pieces', 'a.cjs'].join(path.sep)), '"my pieces/a.cjs"');
  assert.equal(hint('replay', quote(path.join('out', 'a b.mp4')), '--piece', quote('p.cjs')), `npm --prefix "${root}" run replay -- "out/a b.mp4" --piece "p.cjs"`);
  assert.equal(hint('seeds', quote('p.cjs'), '', '--at "<s,s,...>" --loupe', '', '--png'), `npm --prefix "${root}" run seeds -- "p.cjs" --at "<s,s,...>" --loupe --png`);
});

test('library paths: a miscased path is inside the library, in its own spelling, where the file system ignores case', () => {
  const { inLibrary, outputDirectory } = require('../tools/piece-input.js');
  const miscased = path.join(ROOT.toUpperCase(), 'Tests', 'a.png');
  for (const platform of ['win32', 'darwin']) assert.equal(inLibrary(miscased, platform), path.join('Tests', 'a.png'), platform);
  assert.equal(inLibrary(path.join(ROOT, 'tests', 'a.png'), 'linux'), path.join('tests', 'a.png'));
  assert.equal(inLibrary(path.join(ROOT, '..', 'elsewhere'), 'darwin'), null);
  assert.equal(inLibrary(ROOT, 'darwin'), '');
  // reportDirectory (replay) and shown (every tool) ask inLibrary; outputDirectory also names the out/ folder.
  assert.equal(outputDirectory({ directory: path.join(ROOT, process.platform === 'win32' ? 'OUT' : 'out') }), path.join(ROOT, 'out', 'pieces'));
});

test('hint: a path holding $, !, a backtick or a double quote is single-quoted, and one holding a single quote too says to quote it by hand', () => {
  const { hint, quote, quoteWord } = require('../tools/piece-input.js');
  const root = ROOT.split(path.sep).join('/');
  assert.equal(quote(path.join('my $HOME', 'a.cjs')), "'my $HOME/a.cjs'");
  assert.equal(quote('a!b.mp4'), "'a!b.mp4'", 'bash expands ! inside double quotes');
  assert.equal(quote(path.join('out', 'wow!take', 'a.mp4')), "'out/wow!take/a.mp4'");
  assert.equal(quoteWord('a!b'), "'a!b'");
  assert.equal(quoteWord('a b'), '"a b"');
  assert.equal(quote('a`b.cjs'), "'a`b.cjs'");
  assert.equal(quote('a"b.cjs'), `'a"b.cjs'`);
  assert.equal(quote("it's.cjs"), `"it's.cjs"`, 'a single quote alone stays inside double quotes');
  assert.equal(hint('replay', quote('$x/a.mp4')), `npm --prefix "${root}" run replay -- '$x/a.mp4'`);
  const byHand = hint('replay', quote("it's $x.mp4"));
  assert.ok(byHand.startsWith(`npm --prefix "${root}" run replay -- "<path>" # `), byHand);
  assert.ok(byHand.endsWith('quoted by hand: it holds a single quote and a $, a !, a backtick, a backslash or a double quote, straight or curly'), byHand);
  assert.ok(hint('seeds', '--contacts "<path>"').endsWith('straight or curly'), 'a placeholder inside a flags string still earns the note');
  assert.ok(!byHand.includes("$x"), 'the unsafe path is never printed where a shell would expand it');
});

test('quoteWord: a word holding a backslash is single-quoted, since bash reads \\\\ and a closing \\" as escapes inside double quotes', () => {
  const { quoteWord } = require('../tools/piece-input.js');
  assert.equal(quoteWord('a\\\\b'), "'a\\\\b'");
  assert.equal(quoteWord('end\\'), "'end\\'");
  assert.equal(quoteWord('a\\b c'), "'a\\b c'");
  assert.equal(quoteWord("it's a\\b"), '"<path>"', 'a backslash and a single quote has no common form');
  assert.equal(quoteWord('a b'), '"a b"');
});

test('quoteWord: PowerShell reads curly double quotes as a double quote and curly single quotes as a single quote', () => {
  const { quoteWord, hint } = require('../tools/piece-input.js');
  for (const mark of ['“', '”', '„']) assert.equal(quoteWord(`a${mark}b`), `'a${mark}b'`, 'a curly double quote would end a double-quoted word');
  for (const mark of ['‘', '’', '‚', '‛']) {
    assert.equal(quoteWord(`it${mark}s`), `"it${mark}s"`, 'a curly single quote alone stays inside double quotes');
    assert.equal(quoteWord(`it${mark}s $x`), '"<path>"', 'a curly single quote would end a single-quoted word, so it is quoted by hand');
  }
  assert.equal(quoteWord('“it’s”'), '"<path>"');
  assert.ok(hint('replay', quoteWord('“it’s”')).includes('quoted by hand'));
});

test('still: the replay hint quotes a path holding a space as one argument', async () => {
  const { main } = require('../tools/still-cli.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-still-space-'));
  const log = console.log;
  const lines = [];
  try {
    console.log = (line) => lines.push(line);
    fs.mkdirSync(path.join(dir, 'my pieces'));
    fs.writeFileSync(path.join(dir, 'my pieces', 'square one.cjs'), "module.exports = { name: 'square', size: { w: 20, h: 20 }, seed: 1, outputs: ['raster'], draw(g) {} };\n");
    await main(['./my pieces/square one.cjs', '--out', 'my pieces/frame one.png'], async () => ({ bytes: Buffer.from('x'), manifest: { piece: 'square', seed: 1 } }), dir);
  } finally {
    console.log = log;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(lines.length, 1);
  assert.ok(lines[0].endsWith(` Check it with npm --prefix "${ROOT.split(path.sep).join('/')}" run replay -- "my pieces/frame one.png" --piece "my pieces/square one.cjs"`), lines[0]);
});

test('still: under npm run, a relative piece and --out resolve from the caller\'s folder, and the replay hint replays from there', async () => {
  const { callerDirectory } = require('../tools/piece-input.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-still-caller-'));
  // npm run sets these and runs the script from the library root, as npm --prefix does from anywhere.
  const npm = (script) => ({ ...process.env, npm_lifecycle_event: script, npm_package_json: path.join(ROOT, 'package.json'), INIT_CWD: dir });
  const node = (file, args, env, cwd = ROOT) => new Promise((resolve) => {
    execFile(process.execPath, [path.join(ROOT, file), ...args], { cwd, env },(error, stdout, stderr) => resolve({ status: error ? error.code : 0, stdout, stderr }));
  });
  try {
    fs.writeFileSync(path.join(dir, 'square.cjs'), "module.exports = { name: 'square', size: { w: 20, h: 20 }, seed: 1, outputs: ['raster', 'vector'], draw(g) { g.fillStyle = '#123'; g.fillRect(0, 0, 20, 20); } };\n");
    const still = await node('tools/still-cli.js', ['./square.cjs', '--out', 'square.svg'], npm('still'));
    assert.equal(still.status, 0, still.stderr);
    assert.ok(fs.existsSync(path.join(dir, 'square.svg')), 'the SVG lands in the caller\'s folder');
    const hint = /Check it with npm --prefix "[^"]+" run replay -- (.+)\n$/.exec(still.stdout);
    assert.ok(hint, still.stdout);
    assert.equal(hint[1], '"square.svg" --piece "square.cjs"', 'the hint names both files from the caller\'s folder');
    const replay = await node('tools/replay.js', hint[1].replace(/"/g, '').split(' '), npm('replay'));
    assert.equal(replay.status, 0, replay.stdout + replay.stderr);
    // npm run stitch resolves its films and -o from the same folder.
    assert.equal(callerDirectory(ROOT, npm('stitch')), dir);
    // npm run measure resolves its reference image from the same folder.
    assert.equal(callerDirectory(ROOT, npm('measure')), dir);
    // So does every other library tool script in package.json, including one added later.
    for (const [script, command] of Object.entries(require('../package.json').scripts)) {
      if (command.startsWith('node tools/') && !command.startsWith('node tools/run-tests.js')) assert.equal(callerDirectory(ROOT, npm(script)), dir, script);
    }
    // The test runner keeps cwd: its test children inherit this env and spawn tools with their own cwd.
    assert.equal(callerDirectory(ROOT, npm('test:changed')), ROOT);
    assert.equal(callerDirectory(ROOT, npm('test:all')), ROOT);
    // A tool a test starts in its own folder under the runner's env resolves its paths from that folder.
    const child = await node('tools/still-cli.js', ['./square.cjs', '--out', 'child.svg'], { ...npm('test:all'), INIT_CWD: ROOT }, dir);
    assert.equal(child.status, 0, child.stderr);
    assert.ok(fs.existsSync(path.join(dir, 'child.svg')), 'a runner\'s tool child resolves its paths from its own folder');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('replay and the browser check print their report path with forward slashes', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-report-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const logged = [];
  t.mock.method(console, 'log', (line) => logged.push(line));
  const exitCode = process.exitCode;
  t.after(() => { process.exitCode = exitCode; });
  const out = path.join(dir, 'out');
  await require('../tools/check-browser.js').main([], async () => ({ pieces: [], films: [], errors: [] }), out);
  const result = { file: path.join(dir, 'a.svg'), type: 'svg', manifest: { piece: 'a', seed: 3 }, match: true, detail: 'same' };
  await require('../tools/replay.js').main([result.file], async () => result, out);
  const reports = logged.filter((line) => line.startsWith('report: '));
  assert.deepEqual(reports, [`report: ${dir.split(path.sep).join('/')}/out/browser.json`, `report: ${dir.split(path.sep).join('/')}/out/replay-a.svg.json`]);
});

test('shown: a path is printed with forward slashes, from a base when given, else from the library root', () => {
  const { shown } = require('../tools/piece-input.js');
  assert.equal(shown(path.join(ROOT, 'out', 'site'), ROOT), 'out/site');
  assert.equal(shown(path.join(ROOT, 'out', 'site')), 'out/site');
  assert.equal(shown(path.join(ROOT, 'out', 'a', 'b.png'), path.join(ROOT, 'out')), 'a/b.png');
});

test('imports: a U+2028 or U+2029 ends a // comment, so a require after it is found', () => {
  const { imports } = require('../tools/piece-input.js');
  const specs = (source) => imports(source, 'a.cjs').map((m) => m.spec);
  assert.deepEqual(specs("// note\u{2028}const a = require('./a.js'); // more\u{2029}require('./b.js');\n"), ['./a.js', './b.js']);
  assert.deepEqual(specs("const a = require // note\u{2028}('./a.js');\n"), ['./a.js'], 'between require and its parenthesis too');
  assert.deepEqual(specs("// note require('./a.js')\n"), []);
});

test('imports: a lone CR ends a // comment, so a require after it is found; CRLF still works', () => {
  const { imports } = require('../tools/piece-input.js');
  const specs = (source) => imports(source, 'a.cjs').map((m) => m.spec);
  assert.deepEqual(specs("// note\rconst a = require('./a.js');\r"), ['./a.js']);
  assert.deepEqual(specs("// note\r\nconst a = require('./a.js'); // b\r\nrequire('./b.js');\r\n"), ['./a.js', './b.js']);
  assert.deepEqual(specs("// note require('./a.js')\r\n"), []);
});

test('imports: a regular expression or quoted string left open stops at its line terminator', () => {
  const { imports } = require('../tools/piece-input.js');
  const specs = (source) => imports(source, 'a.cjs').map((m) => m.spec);
  // `x = /` starts a regular expression; one left open must not run on past the line.
  assert.deepEqual(specs("let x; x = / 2;\nconst b = require('./b.js'); // /\n"), ['./b.js']);
  assert.deepEqual(specs("let x; x = / 2;\rconst b = require('./b.js'); // /\r"), ['./b.js'], 'a lone CR too');
  assert.deepEqual(specs("x = / 2; // it's\rconst b = require('./b.js');\n"), ['./b.js'], 'an open quoted string stops at a lone CR too');
  assert.deepEqual(specs("const s = 'a\u{2028}b'; require('./b.js');\n"), ['./b.js'], 'U+2028 is text inside a string');
  assert.deepEqual(specs("const s = 'a\\\nb'; const t = `c\rd`; require('./b.js');\n"), ['./b.js'], 'an escaped terminator and a template continue');
  assert.deepEqual(specs("const s = 'a\\\r\nb'; const c = require('./c.js');\r\n"), ['./c.js'], 'an escaped CRLF continues the string');
  assert.deepEqual(specs("x = / 2; // it's\r\nconst b = require('./b.js');\r\n"), ['./b.js'], 'an open quoted string stops at a CRLF');
  assert.throws(() => imports("require('./a\r.js');\n", 'a.cjs'), /^Error: piece: unterminated string in a\.cjs$/);
  assert.throws(() => imports("const s = 'open", 'a.cjs'), /^Error: piece: unterminated string in a\.cjs$/, 'a string open at the end refuses');
  assert.deepEqual(specs("x = /b\r\nconst c = require('./c.js');\r\n"), ['./c.js'], 'an open regular expression stops at a CRLF');
});

test('imports: a backtick inside a template\'s ${...} does not end the template', () => {
  const { imports } = require('../tools/piece-input.js');
  const specs = (source) => imports(source, 'a.cjs').map((m) => m.spec);
  assert.deepEqual(specs("const t = `${'`'}` + require('./b');\nconst u = 1;\n"), ['./b']);
  assert.deepEqual(specs('const t = `a${`b${"}"}` /* ` */}c` + require(\'./b\');\n'), ['./b'], 'nested templates, strings and comments inside');
  assert.throws(() => imports("const t = `${'`'}${require('./b')}`;\n", 'a.cjs'), /^Error: piece: move require calls outside template literals in a\.cjs$/);
});

test('imports: of, yield and await divide where they are names, and of starts a regular expression after a for-head binding', () => {
  const { imports } = require('../tools/piece-input.js');
  const specs = (source) => imports(source, 'a.cjs').map((m) => m.spec);
  assert.deepEqual(specs("const of = 4; const s = `${of / 2}`; // '\nconst b = require('./b.js');\n"), ['./b.js']);
  assert.deepEqual(specs("const of = 4, h = of / 2; const b = require('./b.js');\n"), ['./b.js'], 'outside a template too');
  assert.deepEqual(specs("var yield = 4, await = 2; f(`${yield / 2}`, await / 2, require('./b.js'));\n"), ['./b.js'], 'yield and await in a source that declares them as names');
  assert.deepEqual(specs("for (const x of /'/.exec(s)) f(x);\nconst b = require('./b.js');\n"), ['./b.js'], 'for (const x of /re/) still reads a regular expression');
  assert.deepEqual(specs("for (const [x] of /'/.exec(s)) f(`${x}`);\nconst b = require('./b.js');\n"), ['./b.js'], 'after a destructured binding too');
  assert.deepEqual(specs("function* g() { yield /'/; }\nconst b = require('./b.js');\n"), ['./b.js'], 'yield in a generator');
  assert.deepEqual(specs("async function g() { await /'/; }\nconst b = require('./b.js');\n"), ['./b.js'], 'await in an async function');
  assert.deepEqual(specs("class A {\n  // d\n  *g() { yield /'/; require('./b.js'); }\n}\n"), ['./b.js'], 'yield in a generator method after a comment');
  assert.deepEqual(specs("async function f() { for await (const x of /'/.exec(s)) g(x); } // '\nconst b = require('./b.js');\n"), ['./b.js'], 'of after a for await head binding');
  assert.deepEqual(specs("async function f() { for /* c */ await (const x of /'/.exec(s)) g(x); } // '\nconst b = require('./b.js');\n"), ['./b.js'], 'a comment between for and await');
  assert.deepEqual(specs("// let await = 1;\nasync function g() { const r = await /'/.exec(s); return require('./b.js'); }\n"), ['./b.js'], 'a declaration in a comment does not make await a name');
  assert.deepEqual(specs("const s = 'let await = 1;';\nasync function g() { const r = await /'/.exec(s); return require('./b.js'); }\n"), ['./b.js'], 'nor one in a string');
  assert.deepEqual(specs("var yield = 4; var h = yield / 2, await = 1; h = await / 2; const b = require('./b.js'); // c\n"), ['./b.js'], 'a declaration after yield / is still code');
});

test('imports: a slash after a postfix ++ or -- divides, so the require behind it is found', () => {
  const { imports } = require('../tools/piece-input.js');
  const specs = (source) => imports(source, 'a.cjs').map((m) => m.spec);
  assert.deepEqual(specs("let x = 1; const n = x++ / [require('./a.js')] / 1;"), ['./a.js']);
  assert.deepEqual(specs("let x = 1; const n = x-- /* c */ / [require('./a.js')] / 1;"), ['./a.js'], 'after -- and a comment too');
  assert.deepEqual(specs("let x = [1]; const n = x[0]++ / f(require('./a.js')) / 1;"), ['./a.js'], 'after a member');
  assert.deepEqual(specs("let x = 1; ++x / [require('./a.js')] / 1;"), ['./a.js'], 'a prefix ++ before a name still divides after the name');
  assert.deepEqual(specs("a = b\n++/'/.lastIndex; require('./a.js');"), ['./a.js'], 'a ++ after a line break is prefix, so a slash after it starts a regular expression');
  assert.deepEqual(specs("a = b\n/* c\n */ ++/'/.lastIndex; require('./a.js');"), ['./a.js'], 'a line break inside a comment counts');
  assert.deepEqual(specs("f(...++/'/.lastIndex); require('./a.js'); // c"), ['./a.js'], 'a ++ after a spread is prefix');
  assert.deepEqual(specs("f(.../'/g); require('./a.js'); // c"), ['./a.js'], 'a slash after a spread starts a regular expression');
});

test('imports: a require or import right after a spread `...` is read, and a keyword after `...` starts a regular expression', (t) => {
  const { imports, loadExternal } = require('../tools/piece-input.js');
  const specs = (source) => imports(source, 'a.cjs').map((m) => m.spec);
  assert.deepEqual(specs("f(...require('./a.js'));"), ['./a.js']);
  assert.deepEqual(specs("x = [...require('./a.js')];"), ['./a.js'], 'in an array');
  assert.deepEqual(specs("x = a.require('./a.js');"), [], 'a member require is not an import');
  assert.throws(() => imports("f(...import('./a.js'));", 'a.cjs'), /^Error: piece: dynamic import is not supported in a\.cjs$/);
  assert.deepEqual(specs("x = [...typeof/'/.source]; require('./a.js'); // c"), ['./a.js'], 'typeof after a spread is a keyword');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-spread-require-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'shared.js'), "module.exports = { name: 'spread', size: { w: 1, h: 1 } };");
  fs.writeFileSync(path.join(dir, 'piece.cjs'), "function draw() {}\nmodule.exports = { ...require('./shared.js'), draw };");
  const loaded = loadExternal('./piece.cjs', dir);
  assert.equal(loaded.piece.name, 'spread');
  assert.equal(loaded.moduleCount, 2, 'shared.js is bundled');
});

test('imports: a member or private name require or import is not read, past a comment or line break too', () => {
  const { imports } = require('../tools/piece-input.js');
  const specs = (source) => imports(source, 'a.cjs').map((m) => m.spec);
  assert.deepEqual(specs("x = this.#require('./x');"), [], 'a private name');
  assert.deepEqual(specs("x = this.#import('./x');"), [], 'a private import');
  assert.deepEqual(specs("x = a./* c */require('./x');"), [], 'after a comment');
  assert.deepEqual(specs("x = a.\n require('./x');"), [], 'after a line break');
  assert.deepEqual(specs("x = a.\n typeof / 2; require('./a.js'); // '"), ['./a.js'], 'typeof after a member access is a property name, so the slash divides');
  assert.deepEqual(specs("x = this.#typeof / 2; require('./a.js'); // '"), ['./a.js'], 'and after a #');
  assert.deepEqual(specs("a = o.if(1) / 2; b = require('./b'); // /"), ['./b'], 'a member named if is not a control head');
  assert.deepEqual(specs("a = this.#if(1) / 2; b = require('./b'); // /"), ['./b'], 'nor a private name');
  assert.deepEqual(specs("a = o.\n if(1) / 2; b = require('./b'); // /"), ['./b'], 'nor one past a line break');
  assert.deepEqual(specs("x = 1.\nrequire('./x');"), ['./x'], 'a dot that ends a number is not a member access');
  assert.throws(() => imports("x = 1.\nimport('./x');", 'a.cjs'), /^Error: piece: dynamic import is not supported in a\.cjs$/, 'so an import after it is refused');
  assert.deepEqual(specs("x = 0x1e-5.\nrequire('./x');"), ['./x'], 'nor one after a hex literal minus a number');
  for (const n of ['a1', '1.5', '1.', '0x10', '1e-5', '1e+5']) assert.deepEqual(specs(`x = ${n}.require('./x'); y = ${n}.import('./y');`), [], `a dot after ${n} is a member access`);
  for (const [n, what] of [['a' + '1'.repeat(70), 'a name ending in 70 digits'], ['01', 'a legacy octal 01'], ['\u{1D465}1', 'an astral name character and a digit']]) assert.deepEqual(specs(`x = ${n}.require('./x'); y = ${n}.import('./y');`), [], `a dot after ${what} is a member access`);
});

test('loadExternal: a require imports() did not read is refused by name, not resolved from the library root', (t) => {
  const { imports, loadExternal } = require('../tools/piece-input.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-confine-miss-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // The module's require reached through arguments has no require token, so the reader never sees it.
  const needs = "const n = arguments[2]('./package.json');";
  assert.deepEqual(imports(needs, 'piece.cjs'), [], 'the fixture forces a miss');
  fs.writeFileSync(path.join(dir, 'piece.cjs'), needs + "\nmodule.exports = { name: 'miss', size: { w: 1, h: 1 }, draw() {} };");
  const refused = (more) => new RegExp('piece: invalid module .*' + escape(path.join(dir, 'piece.cjs')) + ' requires \\./package\\.json where no direct literal require was read, so ' + more);
  assert.throws(() => loadExternal('./piece.cjs', dir, { confine: { root: dir, files: ['piece.cjs'] } }), refused('it cannot be checked against the listed files'));
  assert.throws(() => loadExternal('./piece.cjs', dir), refused('the page cannot bundle it'), 'without confine too');
});

test('imports: reading a long one-line source takes time in step with its length', () => {
  const { imports } = require('../tools/piece-input.js');
  // Strings and regular expressions on one line, as a bundled helper has: a
  // reader that looks ahead to the line's end for each literal takes sixteen
  // times as long for four times the line. The fastest of up to seven
  // alternating runs, so warm-up and load even out; a run over two seconds
  // stops the repeats.
  const best = [Infinity, Infinity];
  for (let round = 0; round < 7 && (!round || Math.max(...best) < 2e9); round++) {
    for (const k of [0, 1]) {
      const source = "var a = 'x' + \"y\" + /z/g.test(b); ".repeat(10000 * (1 + 3 * k)) + "require('./b.js');";
      const start = process.hrtime.bigint();
      assert.deepEqual(imports(source, 'a.cjs').map((m) => m.spec), ['./b.js']);
      best[k] = Math.min(best[k], Number(process.hrtime.bigint() - start));
    }
  }
  const ratio = best[1] / best[0];
  assert.ok(ratio < 8, `four times the line took ${ratio.toFixed(2)} times as long`);
});

test('replay: a refused argument is named, then the usage line', () => {
  const { parseArgs } = require('../tools/replay.js');
  for (const [args, cause] of [
    [['a.svg', '--bogus'], 'replay: unknown option --bogus'],
    [['a.svg', 'b.svg'], 'replay: one file at a time, got "a.svg" and "b.svg"'],
    [[], 'replay: name the SVG, PNG, MP4 or WebM file to replay'],
    [['a.svg', '--piece'], 'replay: --piece needs the ./piece.cjs that made the file'],
    [['a.png', '--piece', '--json'], 'replay: --piece needs the ./piece.cjs that made the file'],
    [['a.svg', '--edge'], 'replay: --edge needs the path to msedge'],
    [['a.png', '--edge', '--json'], 'replay: --edge needs the path to msedge'],
    [['a.mp4', '--timeout-ms', '5'], 'replay: --timeout-ms takes an integer from 100 to 300000 milliseconds per film (default 60000), got 5'],
    [['a.mp4', '--timeout-ms', 'soon'], 'replay: --timeout-ms takes an integer from 100 to 300000 milliseconds per film (default 60000), got soon'],
  ]) assert.throws(() => parseArgs(args), refusal(cause), args.join(' '));
});

test('replay: --timeout-ms without a value is named, not read from the next option', async () => {
  const r = await run('tools/replay.js', 'a.png', '--timeout-ms', '--json');
  assert.equal(r.status, 1);
  assert.match(r.stderr.trimEnd(), refusal('replay: --timeout-ms needs a number of milliseconds').message);
});

test('replay: a file that is not there is named with its full path, then the usage line', async () => {
  const r = await run('tools/replay.js', 'nofile.svg');
  assert.equal(r.status, 1);
  assert.match(r.stderr.trimEnd(), refusal(`replay: no file at ${path.join(ROOT, 'nofile.svg')}; name a saved SVG, PNG, MP4 or WebM file`).message);
});

// tools/styles.js requires build-page.js, which requires it back lazily, so an
// entry that runs its main before setting module.exports reads a half-loaded
// module. Node warns of that only when the entry is run as one, and only once
// its refusal loads styles.js: an unknown --style, or a saved file whose piece
// is not registered. Each spawn must end in that refusal, not a crash.
test('tools that reach tools/styles.js: run as the entry, none warns of a circular dependency', async () => {
  const { renderVector } = require('../core/render.js');
  const EXAMPLES = require('../examples/index.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-cli-'));
  try {
    const { svg, manifest } = renderVector(EXAMPLES.readout);
    const saved = path.join(dir, 'nope.svg');
    fs.writeFileSync(saved, withManifest(svg, { ...manifest, piece: 'nope' }));
    const style = ['--style', 'nosuch'];
    const entries = [
      ['replay', [saved], /no registered example is named "nope"/],
      ['build-page', style, /no style named "nosuch"/],
      ['contact-sheet', style, /no style named "nosuch"/],
      ['film-cli', style, /no style named "nosuch"/],
      ['still-cli', style, /no style named "nosuch"/],
      ['styles', ['--bogus'], /unknown option --bogus/],
    ];
    const runs = await Promise.all(entries.map(([name, args]) => new Promise((resolve) => {
      execFile(process.execPath, ['--trace-warnings', path.join(ROOT, 'tools', name + '.js'), ...args], { cwd: ROOT, env: { ...process.env, ARTIFEX_HOME: dir } },
        (error, stdout, stderr) => resolve({ name, status: error ? error.code : 0, stderr }));
    })));
    runs.forEach((r, i) => {
      assert.doesNotMatch(r.stderr, /circular dependency/i, `${r.name}: ${r.stderr}`);
      assert.equal(r.status, 1, `${r.name}: ${r.stderr}`);
      assert.match(r.stderr, entries[i][2], r.name);
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('styles: a refused argument or command is named, then the usage line', async () => {
  const { main, packArgs } = require('../tools/styles.js');
  for (const [args, cause] of [
    [['--bogus'], 'styles: unknown option --bogus'],
    [['remove', 'dots'], 'styles: unknown command "remove"'],
    [['list', 'dots'], 'styles: list takes no style name, got "dots"'],
    [['check', 'dots', '--json'], 'styles: --json belongs to list, not check'],
    [['trust'], 'styles: trust needs a style name; npm run styles lists them'],
    [['check', 'a', 'b'], 'styles: check takes one style name, got "a" "b"'],
  ]) await assert.rejects(main(args, {}, () => {}), refusal(cause), args.join(' '));
  for (const [args, cause] of [
    [['a.cjs', '--frame', '3'], 'styles pack: unknown option --frame'],
    [['a.cjs', 'b.cjs'], 'styles pack: one module of mark functions per pack, got "a.cjs" and "b.cjs"'],
    [['a.cjs', '--name', 'dots'], 'styles pack: missing --proof, --guide, --summary'],
    [[], 'styles pack: missing <marks.js>, --proof, --name, --guide, --summary'],
    [['a.cjs', '--summary'], 'styles pack: --summary needs a value'],
  ]) assert.throws(() => packArgs(args), refusal(cause), args.join(' '));
});

test('browser: a refused argument is named, then the usage line', () => {
  const { parseArgs } = require('../tools/check-browser.js');
  for (const [args, cause] of [
    [['--bogus'], 'browser: unknown option --bogus'],
    [['--edge', '--headed'], 'browser: --edge needs the path to msedge'],
    [['--timeout-ms', '1.5'], 'browser: --timeout-ms needs a whole number of milliseconds, got 1.5'],
    [['--timeout-ms'], 'browser: --timeout-ms needs a whole number of milliseconds, got nothing'],
    [['--timeout-ms', '5'], 'browser: --timeout-ms takes an integer from 100 to 300000 milliseconds (default 60000), got 5'],
    [['--force', 'no-opus'], 'browser: --force takes no-aac, no-webgl2, no-h264 or gpu-crash, got no-opus'],
    [['--force', 'no-aac', '--force', 'no-h264'], 'browser: give --force only once'],
  ]) assert.throws(() => parseArgs(args), refusal(cause), args.join(' '));
});

test('timeoutArg: a max past setTimeout\'s limit is held to 2147483647', () => {
  const { timeoutArg } = require('../tools/check-browser.js');
  const refuse = (cause) => new Error(cause);
  assert.equal(timeoutArg('2147483647', refuse, { max: 4e9 }), 2147483647);
  assert.throws(() => timeoutArg('2147483648', refuse, { max: 4e9 }), { message: '--timeout-ms takes an integer from 100 to 2147483647 milliseconds (default 60000), got 2147483648' });
});

test('image: a refused argument is named, then the usage line', () => {
  const { parseArgs } = require('../tools/image.js');
  const given = ['a.png', '--source', 's', '--rights', 'r'];
  for (const [args, cause] of [
    [[], 'image: name the image to read, such as ./photo.jpg'],
    [['a.png', 'b.png'], 'image: one image per module, got "a.png" and "b.png"'],
    [[...given, '--bogus'], 'image: unknown option --bogus'],
    [[...given, '--width'], 'image: --width needs a value'],
    [[...given, '--width', '0'], 'image: --width takes a whole number of pixels, 1 or more, got 0'],
    [[...given, '--width', '1.5'], 'image: --width takes a whole number of pixels, 1 or more, got 1.5'],
    [[...given, '--channels', '2'], 'image: --channels takes 1 (grey), 3 (RGB) or 4 (RGBA), got 2'],
    [[...given, '--out', 'piece.js'], 'image: --out must name a .image.js file, got piece.js'],
    [['a.png', '--rights', 'r'], 'image: --source must name where the image came from, such as the user\'s own photo or a URL'],
    [['a.png', '--source', 's'], 'image: --rights must say whose the image is and on what terms, as the user gave them; the library grants none'],
    [[...given, '--timeout-ms', '5'], 'image: --timeout-ms takes an integer from 100 to 3600000 milliseconds (default 60000), got 5'],
  ]) assert.throws(() => parseArgs(args), refusal(cause), args.join(' '));
});

/**
 * A plain 8-bit PNG of `w` x `h` RGB (3) or RGBA (4) `bytes`, every row
 * unfiltered; `interlace` sets the IHDR flag alone, and each name in `tags`
 * adds that chunk, with four zero bytes, before the pixels.
 */
function plainPng(w, h, channels, bytes, interlace = 0, tags = []) {
  const zlib = require('node:zlib');
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    data.copy(out, 8);
    out.writeUInt32BE(zlib.crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = channels === 4 ? 6 : 2; head[12] = interlace;
  const rows = Buffer.concat(Array.from({ length: h }, (_, y) => Buffer.concat([Buffer.of(0), Buffer.from(bytes.slice(y * w * channels, (y + 1) * w * channels))])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', head), ...tags.map((t) => chunk(t, Buffer.alloc(4))), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

test('image: a PNG becomes a module a piece declares, shrunk by area average, with its source and rights in the header', async (t) => {
  const { main, edgeReason } = require('../tools/image.js');
  const { validate, solve } = require('../core/piece.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-image-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // Four by two RGB, each pixel its own colour.
  const bytes = Array.from({ length: 4 * 2 * 3 }, (_, i) => i * 10);
  fs.writeFileSync(path.join(dir, 'grid.png'), plainPng(4, 2, 3, bytes));
  const noEdge = async () => { throw new Error('a plain PNG never opens Edge'); };
  const lines = [];
  t.mock.method(console, 'log', (line) => lines.push(line));
  await main(['grid.png', '--source', 'made from code', '--rights', 'the tests\'; MIT'], dir, noEdge);
  const file = path.join(dir, 'grid.image.js');
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /^\/\/ grid\.png, decoded for an Artifex piece's images by npm run image\.\n\/\/ Source: "made from code"\n\/\/ Rights: "the tests'; MIT"\n\/\/ 4 x 2 pixels, RGB, fnv1a32:[0-9a-f]{8}\.\n/);
  const img = require(file);
  const p = validate({ name: 'x', size: { w: 4, h: 2 }, draw() {}, images: { grid: img } });
  assert.deepEqual(Array.from(solve(p).state.images.grid.data), bytes, 'the bytes as the PNG holds them');
  assert.match(lines[0], /^image: grid\.image\.js: 4 x 2, 3 channels, [\d.]+ kB, fnv1a32:[0-9a-f]{8}\. Declare it in the piece as images: \{ name: require\('\.\/grid\.image\.js'\) \}$/);
  // Shrunk to 2 x 1 in grey: each pixel the average of the four it covers, then its luma.
  await main(['grid.png', '--source', 's', '--rights', 'r', '--width', '2', '--channels', '1', '--out', 'small.image.js'], dir, noEdge);
  const small = require(path.join(dir, 'small.image.js'));
  assert.deepEqual([small.w, small.h, small.channels], [2, 1, 1]);
  const mean = (x, c) => [0, 1].flatMap((dy) => [0, 1].map((dx) => bytes[(dy * 4 + x * 2 + dx) * 3 + c])).reduce((a, b) => a + b) / 4;
  const luma = (x) => Math.round(0.2126 * mean(x, 0) + 0.7152 * mean(x, 1) + 0.0722 * mean(x, 2));
  assert.deepEqual(Array.from(Buffer.from(small.pixels, 'base64')), [luma(0), luma(1)]);
  // Refusals the file brings.
  await assert.rejects(main(['grid.png', '--source', 's', '--rights', 'r', '--width', '5'], dir, noEdge), refusal('image: --width 5 is wider than grid.png, which is 4 pixels wide; it only shrinks'));
  fs.writeFileSync(path.join(dir, 'clear.png'), plainPng(1, 1, 4, [1, 2, 3, 128]));
  await assert.rejects(main(['clear.png', '--source', 's', '--rights', 'r', '--channels', '3'], dir, noEdge),
    refusal('image: clear.png has transparent pixels, which --channels 3 would drop; use --channels 4, or flatten the image first'));
  await main(['clear.png', '--source', 's', '--rights', 'r'], dir, noEdge);
  assert.equal(require(path.join(dir, 'clear.image.js')).channels, 4, 'transparency keeps 4 channels');
  await assert.rejects(main(['none.png', '--source', 's', '--rights', 'r'], dir, noEdge), refusal('image: no file at none.png'));
  await assert.rejects(main(['grid.png', '--source', 'x'.repeat(201), '--rights', 'r'], dir, noEdge),
    refusal('image: --source must name where the image came from, such as the user\'s own photo or a URL, in at most 200 characters'));
  // Anything Node would read wrong goes to Edge, which hands back a plain PNG.
  assert.equal(edgeReason(plainPng(1, 1, 3, [0, 0, 0])), null);
  assert.equal(edgeReason(plainPng(1, 1, 3, [0, 0, 0], 1)), 'it is an interlaced PNG');
  assert.equal(edgeReason(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])), 'it is not a PNG');
  for (const tags of [['gAMA'], ['iCCP'], ['cHRM']]) assert.equal(edgeReason(plainPng(1, 1, 3, [0, 0, 0], 0, tags)), 'it is a PNG with a colour profile or gamma', tags.join());
  assert.equal(edgeReason(plainPng(1, 1, 3, [0, 0, 0], 0, ['sRGB', 'gAMA'])), null, 'an sRGB chunk says the bytes are sRGB already');
  fs.writeFileSync(path.join(dir, 'photo.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]));
  let asked = null;
  const edge = async (page, options, work) => { asked = options; return plainPng(1, 1, 3, [9, 8, 7]).toString('base64'); };
  await main(['photo.jpg', '--source', 's', '--rights', 'r'], dir, edge);
  assert.equal(asked.command, 'image');
  assert.deepEqual(Array.from(asked.file.subarray(0, 3)), [0xff, 0xd8, 0xff], 'Edge is handed the file itself');
  assert.equal(Buffer.from(require(path.join(dir, 'photo.image.js')).pixels, 'base64').toString('hex'), '090807');
});

test('negative: a refused argument is named, then the usage line', () => {
  const { selectMutations } = require('./negative.js');
  for (const [args, cause] of [
    [['--other', 'x'], 'negative: unknown option --other'],
    [['--file'], 'negative: --file needs a value'],
    [['--shard', '1/2', '--shard', '2/2'], 'negative: give --shard only once'],
    [['--shard', '3/2'], 'negative: --shard needs k/n, whole numbers with 1 <= k <= n, got 3/2'],
  ]) assert.throws(() => selectMutations(args, []), refusal(cause), args.join(' '));
});
