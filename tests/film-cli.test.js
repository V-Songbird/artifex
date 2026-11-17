'use strict';

// npm run film in Node: its arguments, where a film goes, the page function
// that carries the page's own export back, and what the command writes. The
// export itself needs installed Edge: run npm run film and npm run replay.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parseArgs, filmTarget, exportFilm, exportInPage, soundInPage, filmLooks, main, TIMEOUT_MS } = require('../tools/film-cli.js');

const ROOT = path.join(__dirname, '..');
const EXAMPLES = require('../examples/index.js');

test('film: arguments name one piece and pass --scale and --bitrate to the page unchanged', () => {
  assert.deepEqual(parseArgs(['readout']), { piece: 'readout', style: null, out: null, film: {}, browser: { timeoutMs: TIMEOUT_MS } });
  assert.deepEqual(parseArgs(['./boat.cjs', '--out', 'boat.mp4', '--scale', '2', '--bitrate', '30000000', '--headed', '--edge', 'e.exe', '--timeout-ms', '900000']), {
    piece: './boat.cjs', style: null, out: 'boat.mp4', film: { scale: 2, bitrate: 30000000 },
    browser: { timeoutMs: 900000, headed: true, edge: 'e.exe' },
  });
  // A style draws nothing: --style parses, then filmTarget refuses it; tests/cli.test.js checks the whole message.
  assert.throws(() => filmTarget(parseArgs(['--style', 'impasto'])), { message: /^film: --style draws nothing, since a style is a guide/ });
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

test('film: --force passes one of the browser check\'s conditions to withEdge and refuses no-h264 by name', () => {
  assert.deepEqual(parseArgs(['settle', '--force', 'no-aac']).browser, { timeoutMs: TIMEOUT_MS, force: 'no-aac' });
  assert.equal(parseArgs(['settle', '--force', 'no-webgl2']).browser.force, 'no-webgl2');
  assert.throws(() => parseArgs(['settle', '--force', 'no-h264']), { message: /^film: --force no-h264 leaves the page only its WebM recording, which npm run film does not save; check that recording with npm run browser -- --force no-h264, which takes no piece and records the first film its run exports\nusage: npm run film / });
  assert.throws(() => parseArgs(['settle', '--force', 'gpu-crash']), { message: /^film: --force gpu-crash only hides WebGL2 .*use --crash-gpu <ms>.*\nusage: npm run film / });
  for (const args of [['settle', '--force'], ['settle', '--force', 'no-opus'], ['settle', '--force', 'constructor'], ['settle', '--force', 'no-aac', '--force', 'no-webgl2']]) {
    assert.throws(() => parseArgs(args), /film: .*--force/, args.join(' '));
  }
});

test('film: a film goes under out/, beside an external piece, or where --out says from the caller', (t) => {
  const cwd = path.join(ROOT, 'tests');
  assert.deepEqual(filmTarget(parseArgs(['readout']), cwd), { name: 'readout', external: null, file: path.join(ROOT, 'out', 'readout.mp4') });
  assert.equal(filmTarget(parseArgs(['readout', '--out', 'x/f.mp4']), cwd).file, path.join(cwd, 'x', 'f.mp4'));
  const fixture = filmTarget(parseArgs(['fixtures/noise-film.cjs']), cwd);
  assert.equal(fixture.name, fixture.external.names[0]);
  assert.equal(fixture.file, path.join(ROOT, 'out', 'pieces', 'tests', 'fixtures', 'noise-film.mp4'),
    'a piece inside the library films under out/pieces/, never into its tracked folder');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-film-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'mine.cjs'), "module.exports={name:'mine',size:{w:20,h:20},draw(){}};");
  assert.equal(filmTarget(parseArgs(['./mine.cjs']), dir).file, path.join(dir, 'mine.mp4'), 'a piece outside the library films beside itself');
  // An empty ARTIFEX_HOME, so an installed pack cannot change the unknown-name hint.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-film-home-'));
  const saved = process.env.ARTIFEX_HOME;
  process.env.ARTIFEX_HOME = home;
  t.after(() => {
    if (saved === undefined) delete process.env.ARTIFEX_HOME; else process.env.ARTIFEX_HOME = saved;
    fs.rmSync(home, { recursive: true, force: true });
  });
  assert.throws(() => filmTarget(parseArgs(['constructor']), cwd),
    (e) => e.message.startsWith(`film: no example called "constructor". Known: ${Object.keys(EXAMPLES).join(', ')}. For your own piece, pass its path, such as ./constructor.cjs\nusage: npm run film -- `));
});

test('film: --reframe reads a box timeline written t:WxH,... and atBox refuses one the piece cannot play by name before Edge starts', async () => {
  const keys = [{ t: 0, w: 1280, h: 720 }, { t: 0.5, w: 405, h: 720 }];
  assert.deepEqual(parseArgs(['refit', '--reframe', '0:1280x720,0.5:405x720']).reframe, keys);
  assert.equal('reframe' in parseArgs(['refit']), false, 'no timeline, no key');
  for (const [args, why] of [
    [['refit', '--reframe'], /film: --reframe needs a value/],
    [['refit', '--reframe', '0-1280x720,1:405x720'], /film: --reframe: box 0, "0-1280x720", must be t:WIDTHxHEIGHT/],
    [['refit', '--reframe', '0:1280x720,1:405x720', '--reframe', '0:720x720,1:405x720'], /film: give --reframe only once/],
  ]) assert.throws(() => parseArgs(args), why, args.join(' '));
  const cwd = path.join(ROOT, 'tests');
  assert.deepEqual(filmTarget(parseArgs(['refit', '--reframe', '0:1280x720,0.5:405x720']), cwd),
    { name: 'refit', external: null, file: path.join(ROOT, 'out', 'refit.mp4'), reframe: keys });
  for (const [list, why] of [
    ['0:1280x720,0:405x720', /film: --reframe: refit cannot play that box timeline: reframe\[1\]\.t must come after reframe\[0\]\.t/],
    ['0:1280x720,1:4000x720', /film: --reframe: refit cannot play that box timeline: box 1, 4000 x 720/],
    ['0:1280x720,2:405x720', /film: --reframe: refit cannot play that box timeline: reframe\[1\]\.t must be a playhead in \[0, 1\]/],
    ['0:1280x720', /film: --reframe: refit cannot play that box timeline: must be null or/],
  ]) assert.throws(() => filmTarget(parseArgs(['refit', '--reframe', list]), cwd), why, list);
  assert.throws(() => filmTarget(parseArgs(['readout', '--reframe', '0:960x640,1:640x640']), cwd), /film: --reframe: readout cannot play that box timeline: readout declares no boxes/);
  // The page selects the piece, then plays it along the timeline, before its film() runs.
  const calls = [];
  globalThis.window = { __artifex: {
    select: (name) => calls.push(['select', name]),
    setReframe: (k) => calls.push(['setReframe', k]),
    film: async () => { calls.push(['film']); return { bytes: 1, blob: new Blob([new Uint8Array(1)]) }; },
  } };
  try {
    await exportInPage('refit', {}, keys);
    assert.deepEqual(calls, [['select', 'refit'], ['setReframe', keys], ['film']]);
  } finally { delete globalThis.window; }
});

test('film: --seed films at that seed: the page sets it after select, which resets it, and its film records it', async () => {
  assert.equal(parseArgs(['readout', '--seed', '7']).seed, 7);
  assert.equal('seed' in parseArgs(['readout']), false, 'no seed, no key');
  for (const [args, why] of [
    [['readout', '--seed'], /film: --seed needs a value/],
    [['readout', '--seed', '1.5'], /film: --seed takes a whole number from 0 to 4294967295, got 1\.5/],
    [['readout', '--seed', '4294967296'], /film: --seed takes a whole number from 0 to 4294967295, got 4294967296/],
    [['readout', '--seed', '1', '--seed', '2'], /film: give --seed only once/],
  ]) assert.throws(() => parseArgs(args), why, args.join(' '));
  const cwd = path.join(ROOT, 'tests');
  assert.deepEqual(filmTarget(parseArgs(['readout', '--seed', '7']), cwd), { name: 'readout', external: null, file: path.join(ROOT, 'out', 'readout-seed7.mp4'), seed: 7 });
  assert.equal(filmTarget(parseArgs(['readout']), cwd).file, path.join(ROOT, 'out', 'readout.mp4'), 'no --seed, the piece\'s own name');
  assert.equal(filmTarget(parseArgs(['readout', '--seed', '7', '--out', 'mine.mp4']), cwd).file, path.join(cwd, 'mine.mp4'), '--out names the file whatever the seed');
  assert.equal(filmTarget(parseArgs(['refit', '--seed', '0', '--reframe', '0:1280x720,1:405x720']), cwd).seed, 0, 'seed 0 is a seed');
  const calls = [];
  globalThis.window = { __artifex: {
    select: (name) => calls.push(['select', name]),
    setSeed: (s) => calls.push(['setSeed', s]),
    film: async () => { calls.push(['film']); return { bytes: 1, blob: new Blob([new Uint8Array(1)]) }; },
  } };
  try {
    await exportInPage('readout', {}, null, null, 7);
    assert.deepEqual(calls, [['select', 'readout'], ['setSeed', 7], ['film']]);
  } finally { delete globalThis.window; }
  // exportFilm carries the target's seed into the page.
  const reply = JSON.stringify({ report: { bytes: 1 }, data: 'YQ==', sound: null });
  const sent = [];
  const client = { send: async (method, { expression }) => {
    sent.push(expression);
    if (expression.startsWith('(async () => (globalThis.__artifexValue')) return { result: { value: reply.length } };
    return { result: { value: expression.startsWith('globalThis.__artifexValue.slice') ? reply : true } };
  } };
  const edge = async (page, browser, work) => work(client, { errors: [], version: { Browser: 'stub' } });
  await exportFilm({ name: 'readout', external: { piece: EXAMPLES.readout, source: '' }, seed: 7 }, {}, {}, undefined, edge);
  assert.ok(sent.some((e) => /, 7, null\);\n\}\)\(\)/.test(e)), 'the seed is the page function\'s argument before the session, which is null without --session');
});

test('film: a saved session goes to the page before select, so the film is the session\'s, and exportFilm carries it as the last argument', async () => {
  const calls = [];
  globalThis.window = { __artifex: {
    session: (file, name) => calls.push(['session', file.piece, name]),
    select: (name) => calls.push(['select', name]),
    film: async () => { calls.push(['film']); return { bytes: 1, blob: new Blob([new Uint8Array(1)]) }; },
  } };
  try {
    await exportInPage('play-piece', {}, null, null, null, { file: { piece: 'play-piece' }, name: 'round.session.json' });
    assert.deepEqual(calls, [['session', 'play-piece', 'round.session.json'], ['select', 'play-piece'], ['film']]);
  } finally { delete globalThis.window; }
  const reply = JSON.stringify({ report: { bytes: 1 }, data: 'YQ==', sound: null });
  const sent = [];
  const client = { send: async (method, { expression }) => {
    sent.push(expression);
    if (expression.startsWith('(async () => (globalThis.__artifexValue')) return { result: { value: reply.length } };
    return { result: { value: expression.startsWith('globalThis.__artifexValue.slice') ? reply : true } };
  } };
  const edge = async (page, browser, work) => work(client, { errors: [], version: { Browser: 'stub' } });
  const session = { file: { piece: 'play-piece', ticks: 2 }, name: 'round.session.json', text: 'kept out of the page' };
  await exportFilm({ name: 'play-piece', external: { piece: EXAMPLES.readout, source: '' }, session }, {}, {}, undefined, edge);
  assert.ok(sent.some((e) => e.includes(', null, {"file":{"piece":"play-piece","ticks":2},"name":"round.session.json"});\n})()')), 'the session, its file and name only, is the page function\'s last argument');
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
    assert.equal('forced' in saved, false, 'an unforced film names no condition');
  } finally { console.log = log; }
});

test('film: the save names each look npm run seeds has not drawn since the piece changed, and the fresh-eyes review, in its report and on stderr', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-film-looks-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const piece = path.join(dir, 'looks-film.cjs');
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'looks-film.cjs'), piece);
  const old = new Date(Date.now() - 3600e3);
  fs.utimesSync(piece, old, old);
  // Real strips, drawn beside the piece without Edge: frames, and at with a loupe.
  const { execFileSync } = require('node:child_process');
  for (const strip of [['--frames', '3'], ['--at', '1', '--loupe']]) {
    execFileSync(process.execPath, [path.join(ROOT, 'tools', 'contact-sheet.js'), piece, ...strip], { cwd: ROOT, stdio: 'ignore' });
  }
  const report = { frames: 24, width: 320, height: 180, seconds: 2, bytes: 1, conversion: 'encoder', convertMs: 1, drawMs: 2, totalMs: 3, realtime: 1,
    sound: { codec: 'mp4a' }, shots: [{ name: 'a', start: 0, end: 24 }] };
  const out = [], errors = [];
  const { log, error } = console;
  // The hint names the library root as npm --prefix does, so it runs as printed from the caller's folder.
  const seeds = `npm --prefix "${ROOT.split(path.sep).join('/')}" run seeds`;
  console.log = (line) => out.push(line);
  console.error = (line) => errors.push(line);
  const film = async (rep, flags = [], name = 'looks-film') => {
    errors.length = 0;
    await main(['./' + name + '.cjs', ...flags], async () => ({ browser: 'Edge/1', report: rep, bytes: Buffer.from('a') }), dir);
    // A film at another seed keeps its own file, and so its own report.
    const seed = flags.includes('--seed') ? '-seed' + flags[flags.indexOf('--seed') + 1] : '';
    return JSON.parse(fs.readFileSync(path.join(dir, name + seed + '.mp4.json'), 'utf8')).looks;
  };
  try {
    // The piece keeps no contact list, so no contact strip is asked for.
    let looks = await film(report);
    assert.deepEqual(looks, { source: piece, fresh: ['frames', 'at', 'loupe'], stale: [], missing: ['seeds', 'shots', 'sound'] });
    assert.ok(fs.existsSync(path.join(dir, 'looks-film.mp4')), 'the film is saved whatever the looks');
    assert.equal(out.length, 1, 'stdout keeps its one summary line');
    assert.deepEqual(errors.slice(0, -1), [
      `film: look not drawn: seeds; ${seeds} -- "./looks-film.cjs" --png`,
      `film: look not drawn: shots; ${seeds} -- "./looks-film.cjs" --shots --png`,
      `film: look not drawn: sound; ${seeds} -- "./looks-film.cjs" --frames 9 --sound --png`,
    ]);
    assert.match(errors.at(-1), /fresh-eyes review .*films\.md#fresh-eyes-review$/);
    // Each command repeats the film's seed and box timeline; the contact sheet, which sweeps seeds, only the box timeline.
    await film(report, ['--seed', '7', '--reframe', '0:320x180, 1:180x180']);
    assert.deepEqual(errors.filter((line) => / (seeds|shots);/.test(line)), [
      `film: look not drawn: seeds; ${seeds} -- "./looks-film.cjs" --reframe 0:320x180,1:180x180 --png`,
      `film: look not drawn: shots; ${seeds} -- "./looks-film.cjs" --shots --seed 7 --reframe 0:320x180,1:180x180 --png`,
    ]);
    // The same piece keeping a contact list at seed 7 only asks for its strip, by the list's name, in a film at that seed.
    fs.writeFileSync(path.join(dir, 'looks-kept.cjs'), fs.readFileSync(piece, 'utf8').replace("name: 'looks-film',", "name: 'looks-kept',"
      + " build: [['plan', (s) => { if (s.seed === 7) s.cues = { contacts: [{ seconds: 1 }], shots: [] }; }]],"));
    looks = await film(report, [], 'looks-kept');
    assert.deepEqual([looks.contacts, looks.missing], [undefined, ['seeds', 'frames', 'at', 'shots', 'loupe', 'sound']]);
    looks = await film(report, ['--seed', '7'], 'looks-kept');
    assert.deepEqual([looks.contacts, looks.missing], [['cues.contacts'], ['seeds', 'frames', 'at', 'shots', 'contacts', 'loupe', 'sound']]);
    assert.ok(errors.includes(`film: look not drawn: contacts; ${seeds} -- "./looks-kept.cjs" --contacts "cues.contacts" --seed 7 --png`), errors.join('\n'));
    // A contact list named with a $ is single-quoted, so the pasted command reads it literally.
    fs.writeFileSync(path.join(dir, 'looks-dollar.cjs'), fs.readFileSync(piece, 'utf8').replace("name: 'looks-film',", "name: 'looks-dollar',"
      + " build: [['plan', (s) => { s.cues$ = { contacts: [{ seconds: 1 }] }; }]],"));
    await film(report, [], 'looks-dollar');
    assert.ok(errors.includes(`film: look not drawn: contacts; ${seeds} -- "./looks-dollar.cjs" --contacts 'cues$.contacts' --png`), errors.join('\n'));
    // A piece keeping its contact list only at its own size names none in a film along a box timeline,
    // since npm run seeds --reframe would refuse the list.
    fs.writeFileSync(path.join(dir, 'looks-boxed.cjs'), fs.readFileSync(piece, 'utf8').replace("name: 'looks-film',", "name: 'looks-boxed',"
      + " build: [['plan', (s) => { if (!s.reframe) s.cues = { contacts: [{ seconds: 1 }] }; }]],"));
    assert.deepEqual((await film(report, [], 'looks-boxed')).contacts, ['cues.contacts']);
    assert.equal((await film(report, ['--reframe', '0:320x180,1:180x180'], 'looks-boxed')).contacts, undefined);
    // Files named as npm run seeds names a shots strip and a frames strip with sound count as those looks.
    for (const name of ['looks-film-shots.html', 'looks-film-frames-sound.html']) fs.writeFileSync(path.join(dir, name), 'x');
    looks = await film(report);
    assert.deepEqual([looks.fresh, looks.stale, looks.missing], [['frames', 'at', 'shots', 'loupe', 'sound'], [], ['seeds']]);
    assert.deepEqual(errors.slice(0, -1), [`film: look not drawn: seeds; ${seeds} -- "./looks-film.cjs" --png`]);
    // Only strips at the film's seed and box timeline count: none drawn so far is for a film at seed 7,
    // a strip at seed 7 is, and a contact sheet along the box timeline counts for a film along it at any seed.
    looks = await film(report, ['--seed', '7']);
    assert.deepEqual([looks.fresh, looks.missing], [[], ['seeds', 'frames', 'at', 'shots', 'loupe', 'sound']]);
    for (const name of ['looks-film-shots-seed7.html', 'looks-film-seeds-reframe.html']) fs.writeFileSync(path.join(dir, name), 'x');
    assert.deepEqual((await film(report, ['--seed', '7'])).fresh, ['shots']);
    assert.deepEqual((await film(report, ['--seed', '7', '--reframe', '0:320x180,1:180x180'])).fresh, ['seeds']);
    // An edit to the piece makes every strip drawn before it stale; a film without shots or sound needs neither strip.
    fs.utimesSync(piece, new Date(), new Date(Date.now() + 60e3));
    looks = await film(report);
    assert.deepEqual([looks.fresh, looks.stale, looks.missing], [[], ['frames', 'at', 'shots', 'loupe', 'sound'], ['seeds']]);
    looks = await film({ ...report, sound: null, shots: null });
    assert.deepEqual([looks.fresh, looks.stale, looks.missing], [[], ['frames', 'at', 'loupe'], ['seeds']]);
    assert.equal(errors.find((line) => / loupe;/.test(line)).replace(/^film: look older than .*looks-film\.cjs: /, ''), `loupe; ${seeds} -- "./looks-film.cjs" --at "<s,s,...>" --loupe --png`);
    // A state keeping several contact lists offers them as one quoted placeholder, and the at look's placeholder is quoted too;
    // a path typed with the caller's separators prints with forward slashes. A piece with no strip drawn is missing every look.
    fs.writeFileSync(path.join(dir, 'looks-many.cjs'), fs.readFileSync(piece, 'utf8').replace("name: 'looks-film',", "name: 'looks-many',"
      + " build: [['plan', (s) => { s.cues = { contacts: [{ seconds: 1 }], more: [{ seconds: 0.5 }] }; }]],"));
    errors.length = 0;
    await main(['.' + path.sep + 'looks-many.cjs'], async () => ({ browser: 'Edge/1', report, bytes: Buffer.from('a') }), dir);
    assert.ok(errors.includes(`film: look not drawn: contacts; ${seeds} -- "./looks-many.cjs" --contacts "<cues.contacts or cues.more>" --png`), errors.join('\n'));
    assert.ok(errors.includes(`film: look not drawn: at; ${seeds} -- "./looks-many.cjs" --at "<each cut, beat and contact, in s>" --png`), errors.join('\n'));
    assert.ok(errors.includes(`film: look not drawn: loupe; ${seeds} -- "./looks-many.cjs" --at "<s,s,...>" --loupe --png`), errors.join('\n'));
    // A placeholder naming a list with a $ is single-quoted too, or a pasted command would expand the $.
    fs.writeFileSync(path.join(dir, 'looks-many-dollar.cjs'), fs.readFileSync(piece, 'utf8').replace("name: 'looks-film',", "name: 'looks-many-dollar',"
      + " build: [['plan', (s) => { s.cues$ = { contacts: [{ seconds: 1 }], more: [{ seconds: 0.5 }] }; }]],"));
    errors.length = 0;
    await main(['.' + path.sep + 'looks-many-dollar.cjs'], async () => ({ browser: 'Edge/1', report, bytes: Buffer.from('a') }), dir);
    assert.ok(errors.includes(`film: look not drawn: contacts; ${seeds} -- "./looks-many-dollar.cjs" --contacts '<cues$.contacts or cues$.more>' --png`), errors.join('\n'));
    // A piece path holding a space stays one quoted argument, so the hint pastes whole.
    fs.copyFileSync(piece, path.join(dir, 'looks spaced.cjs'));
    await film(report, [], 'looks spaced');
    assert.ok(errors.includes(`film: look not drawn: seeds; ${seeds} -- "./looks spaced.cjs" --png`), errors.join('\n'));
  } finally { Object.assign(console, { log, error }); }
});

test('film: an edit to a local module the piece requires, even through another, makes its strips stale', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-film-helped-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'lib'));
  const piece = path.join(dir, 'looks-helped.cjs'), ground = path.join(dir, 'lib', 'ground.js'), tone = path.join(dir, 'lib', 'tone.js');
  fs.writeFileSync(piece, "const ground = require('./lib/ground.js');\n" + fs.readFileSync(path.join(__dirname, 'fixtures', 'looks-film.cjs'), 'utf8')
    .replace("name: 'looks-film',", "name: 'looks-helped',").replace("g.fillStyle = '#808080';", 'g.fillStyle = ground;'));
  fs.writeFileSync(ground, "module.exports = require('./tone.js');\n");
  fs.writeFileSync(tone, "module.exports = '#808080';\n");
  const old = new Date(Date.now() - 3600e3);
  for (const file of [piece, ground, tone]) fs.utimesSync(file, old, old);
  fs.writeFileSync(path.join(dir, 'looks-helped-frames.html'), 'x');
  const report = { frames: 24, width: 320, height: 180, seconds: 2, bytes: 1, conversion: 'encoder', convertMs: 1, drawMs: 2, totalMs: 3, realtime: 1 };
  const errors = [];
  const { log, error } = console;
  console.log = () => {};
  console.error = (line) => errors.push(line);
  const film = async () => {
    errors.length = 0;
    await main(['./looks-helped.cjs'], async () => ({ browser: 'Edge/1', report, bytes: Buffer.from('a') }), dir);
    return JSON.parse(fs.readFileSync(path.join(dir, 'looks-helped.mp4.json'), 'utf8')).looks;
  };
  try {
    assert.deepEqual((await film()).fresh, ['frames']);
    // The piece's own module is untouched; only the module its helper requires changed.
    fs.utimesSync(tone, new Date(), new Date(Date.now() + 60e3));
    const looks = await film();
    assert.deepEqual([looks.source, looks.fresh, looks.stale], [tone, [], ['frames']]);
    assert.match(errors.find((line) => / frames;/.test(line)) ?? '', /^film: look older than .*tone\.js: frames; /);
  } finally { Object.assign(console, { log, error }); }
});

test('film: an edit to a helper the piece requires from a sibling folder makes its strips stale', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-film-sibling-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const sub of ['pieces', 'lib']) fs.mkdirSync(path.join(dir, sub));
  const pieces = path.join(dir, 'pieces'), piece = path.join(pieces, 'looks-sibling.cjs'), helper = path.join(dir, 'lib', 'helper.js');
  fs.writeFileSync(piece, "const ground = require('../lib/helper.js');\n" + fs.readFileSync(path.join(__dirname, 'fixtures', 'looks-film.cjs'), 'utf8')
    .replace("name: 'looks-film',", "name: 'looks-sibling',").replace("g.fillStyle = '#808080';", 'g.fillStyle = ground;'));
  // A require back to the piece, never run, is a cycle the walk must survive.
  fs.writeFileSync(helper, "module.exports = '#808080';\nfunction unused() { require('../pieces/looks-sibling.cjs'); }\n");
  const old = new Date(Date.now() - 3600e3);
  for (const file of [piece, helper]) fs.utimesSync(file, old, old);
  fs.writeFileSync(path.join(pieces, 'looks-sibling-frames.html'), 'x');
  const report = { frames: 24, width: 320, height: 180, seconds: 2, bytes: 1, conversion: 'encoder', convertMs: 1, drawMs: 2, totalMs: 3, realtime: 1 };
  const { log, error } = console;
  console.log = () => {};
  console.error = () => {};
  const film = async () => {
    await main(['./looks-sibling.cjs'], async () => ({ browser: 'Edge/1', report, bytes: Buffer.from('a') }), pieces);
    return JSON.parse(fs.readFileSync(path.join(pieces, 'looks-sibling.mp4.json'), 'utf8')).looks;
  };
  try {
    assert.deepEqual((await film()).fresh, ['frames']);
    fs.utimesSync(helper, new Date(), new Date(Date.now() + 60e3));
    const looks = await film();
    assert.deepEqual([looks.source, looks.fresh, looks.stale], [helper, [], ['frames']]);
  } finally { Object.assign(console, { log, error }); }
});

test('film: a newer library core module a piece reaches by relative require leaves its strips fresh', async (t) => {
  const { loadExternal } = require('../tools/piece-input.js');
  const out = path.join(__dirname, '..', 'out');
  fs.mkdirSync(out, { recursive: true });
  const dir = fs.mkdtempSync(path.join(out, 'artifex-film-library-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const piece = path.join(dir, 'looks-library.cjs'), core = path.join(ROOT, 'core', 'num.js');
  fs.writeFileSync(piece, "require('../../core/num.js');\n" + fs.readFileSync(path.join(__dirname, 'fixtures', 'looks-film.cjs'), 'utf8')
    .replace("name: 'looks-film',", "name: 'looks-library',"));
  // The core module is newer than the piece and its strip.
  const base = fs.statSync(core).mtimeMs, strip = path.join(dir, 'looks-library-frames.html');
  fs.writeFileSync(strip, 'x');
  fs.utimesSync(piece, new Date(base - 7200e3), new Date(base - 7200e3));
  fs.utimesSync(strip, new Date(base - 3600e3), new Date(base - 3600e3));
  const looks = filmLooks({ name: 'looks-library', external: loadExternal(piece) }, { frames: 24 });
  assert.deepEqual([looks.source, looks.fresh, looks.stale], [piece, ['frames'], []]);
});

test('film: the looks build the piece once, however many contact lists its state offers', async (t) => {
  const { loadExternal } = require('../tools/piece-input.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-film-builds-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); delete globalThis.__filmBuilds; });
  const piece = path.join(dir, 'looks-builds.cjs');
  fs.writeFileSync(piece, fs.readFileSync(path.join(__dirname, 'fixtures', 'looks-film.cjs'), 'utf8').replace("name: 'looks-film',", "name: 'looks-builds',"
    + " build: [['plan', (s) => { globalThis.__filmBuilds = (globalThis.__filmBuilds || 0) + 1;"
    + " s.cues = { contacts: [{ seconds: 1 }], more: [{ frame: 3 }], late: [{ seconds: 9 }] }; }]],"));
  globalThis.__filmBuilds = 0;
  const looks = filmLooks({ name: 'looks-builds', external: loadExternal(piece) }, { frames: 24 });
  // The list past the film's end is still refused, from the same build.
  assert.deepEqual([looks.contacts, globalThis.__filmBuilds], [['cues.contacts', 'cues.more'], 1]);
});

test('film: a ../shared helper the export bundles makes strips stale, and one gone by the save is skipped with the report still written', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-film-shared-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const sub of ['pieces', 'shared']) fs.mkdirSync(path.join(dir, sub));
  const pieces = path.join(dir, 'pieces'), piece = path.join(pieces, 'looks-shared.cjs'), helper = path.join(dir, 'shared', 'tone.js');
  fs.writeFileSync(piece, "const tone = require('../shared/tone.js');\n" + fs.readFileSync(path.join(__dirname, 'fixtures', 'looks-film.cjs'), 'utf8')
    .replace("name: 'looks-film',", "name: 'looks-shared',").replace("g.fillStyle = '#808080';", 'g.fillStyle = tone;'));
  fs.writeFileSync(helper, "module.exports = '#808080';\n");
  const old = new Date(Date.now() - 3600e3);
  for (const file of [piece, helper]) fs.utimesSync(file, old, old);
  fs.writeFileSync(path.join(pieces, 'looks-shared-frames.html'), 'x');
  fs.utimesSync(helper, new Date(), new Date(Date.now() + 60e3));
  const report = { frames: 24, width: 320, height: 180, seconds: 2, bytes: 1, conversion: 'encoder', convertMs: 1, drawMs: 2, totalMs: 3, realtime: 1 };
  const { log, error } = console;
  console.log = () => {};
  console.error = () => {};
  const film = async (during = () => {}) => {
    await main(['./looks-shared.cjs'], async () => { during(); return { browser: 'Edge/1', report, bytes: Buffer.from('a') }; }, pieces);
    return JSON.parse(fs.readFileSync(path.join(pieces, 'looks-shared.mp4.json'), 'utf8')).looks;
  };
  try {
    let looks = await film();
    assert.deepEqual([looks.source, looks.fresh, looks.stale], [helper, [], ['frames']]);
    // The helper is deleted while the film exports: the save skips it and judges the strips by the piece alone.
    fs.rmSync(path.join(pieces, 'looks-shared.mp4.json'));
    looks = await film(() => fs.rmSync(helper));
    assert.deepEqual([looks.source, looks.fresh, looks.stale], [piece, ['frames'], []]);
    // The piece's own module gone by the save is skipped the same way, so the helper alone dates the strips.
    fs.writeFileSync(helper, "module.exports = '#808080';\n");
    fs.utimesSync(helper, new Date(), new Date(Date.now() + 60e3));
    fs.rmSync(path.join(pieces, 'looks-shared.mp4.json'));
    looks = await film(() => fs.rmSync(piece));
    assert.deepEqual([looks.source, looks.fresh, looks.stale], [helper, [], ['frames']]);
  } finally { Object.assign(console, { log, error }); }
});

// tools/piece-input.js folds case on win32 and darwin only, and a case-sensitive volume (a macOS one can be) resolves
// no second spelling; so the case-spelling tests run where the platform folds and the volumes under test ignore case.
const caseSkip = () => {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return 'tools/piece-input.js folds case only on win32 and darwin';
  const other = (folder) => folder === folder.toUpperCase() ? folder.toLowerCase() : folder.toUpperCase();
  return [os.tmpdir(), ROOT].every((folder) => fs.existsSync(other(folder))) ? false : 'a volume here is case-sensitive, so a second spelling names no file';
};

test('film: loadExternal runs one helper required under two spellings once, so both share its state', { skip: caseSkip() }, (t) => {
  const { loadExternal, slash } = require('../tools/piece-input.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-film-spell-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'helper.cjs'), 'module.exports = { count: 0 };\n');
  const base = slash(path.join(ROOT, 'core')) + '/';
  const fixture = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'burst-film.cjs'), 'utf8').split('../../core/').join(base);
  const counts = [];
  for (const [name, head] of [['once', "require('./helper.cjs');\n"], ['twice', "if (require('./helper.cjs') !== require('./HELPER.cjs')) throw new Error('two instances');\n"]]) {
    const file = path.join(dir, name + '.cjs');
    fs.writeFileSync(file, head + fixture);
    counts.push(loadExternal([file], dir).moduleCount);
  }
  assert.equal(counts[1], counts[0], 'module counts, one spelling then two: ' + counts.join(', '));
});

test('film: a piece reaching core through a miscased path still bundles core as library modules', { skip: caseSkip() }, (t) => {
  const { loadExternal, slash } = require('../tools/piece-input.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-film-case-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const seen = [];
  for (const folder of ['core', 'CORE']) {
    const base = slash(path.join(ROOT, folder)) + '/';
    const file = path.join(dir, 'p-' + folder + '.cjs');
    fs.writeFileSync(file, fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'burst-film.cjs'), 'utf8').split('../../core/').join(base));
    const loaded = loadExternal([file], dir);
    seen.push([loaded.moduleCount, loaded.library.join(',')]);
  }
  assert.deepEqual(seen[1], seen[0], 'a miscased core path changed the bundle: ' + JSON.stringify(seen));
  assert.ok(seen[0][1].startsWith('core/'), 'core was not bundled as library modules: ' + JSON.stringify(seen));
});

// A piece that requires `needs` and registers under `name`; one file listed twice is the same piece.
const listedPiece = (name, needs = '') => needs + `\nmodule.exports = { name: '${name}', size: { w: 10, h: 10 }, draw(g) { g.fillRect(0, 0, 10, 10); } };\n`;

test('film: loadExternal takes one piece listed under two differently cased spellings as one piece', { skip: caseSkip() }, (t) => {
  const { loadExternal } = require('../tools/piece-input.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-film-named-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'piece.cjs'), listedPiece('named-twice'));
  const loaded = loadExternal(['piece.cjs', 'PIECE.cjs'], dir);
  assert.deepEqual(loaded.names, ['named-twice']);
  assert.equal(loaded.pieces.length, 2);
  assert.equal(loaded.pieces[1].id, loaded.pieces[0].id);
});

test('film: loadExternal takes one piece listed under a link and its target as one piece', (t) => {
  const { loadExternal } = require('../tools/piece-input.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-film-named-link-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'piece.cjs'), listedPiece('named-linked'));
  try { fs.symlinkSync(path.join(dir, 'piece.cjs'), path.join(dir, 'alias.cjs')); } catch (error) { return t.skip('no symbolic links here: ' + error.code); }
  const loaded = loadExternal(['piece.cjs', 'alias.cjs'], dir);
  assert.deepEqual(loaded.names, ['named-linked']);
  assert.equal(loaded.pieces[1].id, loaded.pieces[0].id);
  fs.writeFileSync(path.join(dir, 'other.cjs'), listedPiece('named-linked'));
  assert.throws(() => loadExternal(['piece.cjs', 'other.cjs'], dir), /are both named named-linked/, 'two files under one name are still refused');
});

test('film: a confined load passes a listed file reached through a miscased spelling', { skip: caseSkip() }, (t) => {
  const { loadExternal } = require('../tools/piece-input.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-film-confine-case-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'helper.cjs'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(dir, 'piece.cjs'), listedPiece('confined-case', "require('./HELPER.cjs');"));
  fs.writeFileSync(path.join(dir, 'unlisted.cjs'), 'module.exports = 2;\n');
  const confine = { root: dir, files: ['piece.cjs', 'helper.cjs'] };
  assert.equal(loadExternal('piece.cjs', dir, { confine }).moduleCount, 2);
  assert.equal(loadExternal('PIECE.cjs', dir, { confine }).moduleCount, 2, 'a miscased entry');
  assert.equal(loadExternal('piece.cjs', dir, { confine: { ...confine, root: dir.toUpperCase() } }).moduleCount, 2, 'a miscased root');
  fs.writeFileSync(path.join(dir, 'piece.cjs'), listedPiece('confined-case', "require('./UNLISTED.cjs');"));
  assert.throws(() => loadExternal('piece.cjs', dir, { confine }), /not a listed file/, 'a miscased unlisted file is still refused');
});

test('film: a confined load checks a link by the file it reaches', (t) => {
  const { loadExternal } = require('../tools/piece-input.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-film-confine-link-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'helper.cjs'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(dir, 'unlisted.cjs'), 'module.exports = 2;\n');
  try {
    fs.symlinkSync(path.join(dir, 'helper.cjs'), path.join(dir, 'to-listed.cjs'));
    fs.symlinkSync(path.join(dir, 'unlisted.cjs'), path.join(dir, 'to-unlisted.cjs'));
  } catch (error) { return t.skip('no symbolic links here: ' + error.code); }
  const confine = { root: dir, files: ['piece.cjs', 'helper.cjs', 'to-unlisted.cjs'] };
  fs.writeFileSync(path.join(dir, 'piece.cjs'), listedPiece('confined-link', "require('./to-listed.cjs');"));
  assert.equal(loadExternal('piece.cjs', dir, { confine }).moduleCount, 2, 'a link to a listed file');
  fs.writeFileSync(path.join(dir, 'piece.cjs'), listedPiece('confined-link', "require('./to-unlisted.cjs');"));
  assert.throws(() => loadExternal('piece.cjs', dir, { confine }), /not a listed file/, 'a listed link to an unlisted file');
});

// A link to a folder: a junction on Windows (needs an absolute target, no symlink right), a symbolic link elsewhere.
const folderLink = (target, link) => fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');

test('film: loadExternal takes one piece listed under a folder link and its target as one piece', (t) => {
  const { loadExternal } = require('../tools/piece-input.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-film-named-folder-link-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'real'));
  fs.writeFileSync(path.join(dir, 'real', 'piece.cjs'), listedPiece('named-folder-linked'));
  folderLink(path.join(dir, 'real'), path.join(dir, 'alias'));
  const loaded = loadExternal(['real/piece.cjs', 'alias/piece.cjs'], dir);
  assert.deepEqual(loaded.names, ['named-folder-linked']);
  assert.equal(loaded.pieces[1].id, loaded.pieces[0].id);
  fs.writeFileSync(path.join(dir, 'other.cjs'), listedPiece('named-folder-linked'));
  assert.throws(() => loadExternal(['real/piece.cjs', 'other.cjs'], dir), /are both named named-folder-linked/, 'two files under one name are still refused');
});

test('film: a confined load checks a file reached through a folder link by the file it reaches', (t) => {
  const { loadExternal } = require('../tools/piece-input.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-film-confine-folder-link-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'real'));
  fs.writeFileSync(path.join(dir, 'real', 'helper.cjs'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(dir, 'real', 'unlisted.cjs'), 'module.exports = 2;\n');
  folderLink(path.join(dir, 'real'), path.join(dir, 'alias'));
  const confine = { root: dir, files: ['piece.cjs', 'real/helper.cjs'] };
  fs.writeFileSync(path.join(dir, 'piece.cjs'), listedPiece('confined-folder-link', "require('./alias/helper.cjs');"));
  assert.equal(loadExternal('piece.cjs', dir, { confine }).moduleCount, 2, 'a listed file through a folder link');
  fs.writeFileSync(path.join(dir, 'piece.cjs'), listedPiece('confined-folder-link', "require('./alias/unlisted.cjs');"));
  assert.throws(() => loadExternal('piece.cjs', dir, { confine }), /not a listed file/, 'an unlisted file through a folder link');
});

test('film: a film with sound writes its decoded soundtrack\'s picture beside the report; one without leaves none', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-film-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // The page draws the picture only when the film has sound.
  const drawn = [];
  globalThis.window = { __artifex: { select() {}, film: async () => ({ bytes: 2, frames: 3, sound: { codec: 'mp4a' }, blob: new Blob([new Uint8Array(2)]) }) } };
  try {
    const { sound } = await exportInPage('readout', {}, null, async (bytes, report) => { drawn.push([bytes.length, report.frames]); return { png: 'AA==' }; });
    assert.deepEqual([sound, drawn], [{ png: 'AA==' }, [[2, 3]]]);
    globalThis.window.__artifex.film = async () => ({ bytes: 2, blob: new Blob([new Uint8Array(2)]) });
    assert.equal((await exportInPage('drift', {}, null, () => assert.fail('a silent film is not drawn'))).sound, null);
  } finally { delete globalThis.window; }
  const report = { frames: 24, width: 1920, height: 1080, seconds: 1, bytes: 1, conversion: 'encoder', convertMs: 1, drawMs: 2, totalMs: 3, realtime: 0.33, sound: { codec: 'mp4a' } };
  const png = Buffer.from([137, 80, 78, 71]);
  const lines = [];
  const log = console.log;
  console.log = (line) => lines.push(line);
  try {
    const sound = { png: png.toString('base64'), seconds: 1, peakDb: -1.5, rmsDb: { min: -60, max: -12 } };
    await main(['readout', '--out', 'f.mp4'], async () => ({ browser: 'Edge/1', report, bytes: Buffer.from('a'), sound }), dir);
    const file = path.join(dir, 'f.mp4.sound.png');
    assert.deepEqual(fs.readFileSync(file), png);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'f.mp4.json'), 'utf8')).decoded, { file, seconds: 1, peakDb: -1.5, rmsDb: { min: -60, max: -12 } });
    assert.match(lines[0], /with an AAC soundtrack\..* Decoded soundtrack: .*f\.mp4\.sound\.png\. Report: /);
    // A decode the browser refuses is named; an earlier picture never stands in for it.
    await main(['readout', '--out', 'f.mp4'], async () => ({ browser: 'Edge/1', report, bytes: Buffer.from('a'), sound: { error: 'Unable to decode audio data' } }), dir);
    assert.equal(fs.existsSync(file), false);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'f.mp4.json'), 'utf8')).decoded, { error: 'Unable to decode audio data' });
    assert.match(lines[1], / The soundtrack could not be decoded to draw it: Unable to decode audio data\. Report: /);
    // A silent film says nothing new.
    fs.writeFileSync(file, png);
    const silent = { ...report, sound: null };
    await main(['drift', '--out', 'f.mp4'], async () => ({ browser: 'Edge/1', report: silent, bytes: Buffer.from('a'), sound: null }), dir);
    assert.equal(fs.existsSync(file), false);
    assert.equal('decoded' in JSON.parse(fs.readFileSync(path.join(dir, 'f.mp4.json'), 'utf8')), false);
    assert.doesNotMatch(lines[2], /soundtrack/);
  } finally { console.log = log; }
});

// Runs soundInPage in Node against a decoded track of `seconds` at 48 kHz: a
// 2D context that records its red cut lines and labels, and a canvas that saves nothing.
// `sample(i)` is the track's i-th sample, a steady tone unless given.
async function soundInNode(seconds, report, shots, inPage = soundInPage, sample = (i) => 0.5 * Math.sin(i / 10)) {
  const drawn = [];
  const g = new Proxy({}, {
    get: (target, key) => (key in target ? target[key]
      : key === 'createImageData' ? (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) })
        : (...args) => { if (target.fillStyle === '#e8705a' || key === 'fillText') drawn.push([key, ...args]); }),
  });
  const channel = Float32Array.from({ length: Math.round(seconds * 48000) }, (_, i) => sample(i));
  globalThis.OfflineAudioContext = class { async decodeAudioData() { return { numberOfChannels: 2, sampleRate: 48000, getChannelData: () => channel }; } };
  globalThis.document = { createElement: () => ({ getContext: () => g, toDataURL: () => 'data:image/png;base64,AA==' }) };
  try { return { sound: await inPage(new Uint8Array(4), report, 400, 32, 8, shots), drawn }; }
  finally { delete globalThis.OfflineAudioContext; delete globalThis.document; }
}

test('film: the decoded soundtrack\'s picture marks each shot cut where the next shot starts, and names an empty track', async () => {
  const report = { frames: 48, hz: 24 };
  const { sound, drawn } = await soundInNode(2, report, [{ name: 'open', start: 0, end: 12 }, { name: 'turn', start: 12, end: 36 }, { name: 'close', start: 36, end: 48 }]);
  assert.equal(sound.png, 'AA==');
  assert.deepEqual(drawn.filter(([key]) => key === 'fillRect').map(([, x]) => x + 1), [100, 300], 'a red line where turn and close start, 12 and 36 of 48 frames');
  assert.deepEqual(drawn.filter(([key, text]) => key === 'fillText' && /^[a-z]/.test(text)).map(([, text]) => text), ['turn', 'close']);
  assert.ok(Math.abs(sound.peakDb + 6) < 0.1 && sound.rmsDb.max <= sound.peakDb, 'the shared summary, rounded to 0.1 dB');
  assert.equal((await soundInNode(2, report, null)).drawn.filter(([key]) => key === 'fillRect').length, 0, 'a piece with no shot list has no cuts');
  // A track that decodes to no samples is named, never drawn with its marks at NaN.
  assert.deepEqual(await soundInNode(0, report, null), { sound: { error: 'the soundtrack holds no samples, so there is nothing to draw' }, drawn: [] });
});

test('film: the decoded soundtrack\'s picture shades a silent opening and a silent gap between cues, as the --sound strip does', async () => {
  // Silent for 1.5 s, a tone to 2 s, silent again to 2.8 s, a tone to the end at 3 s.
  const tone = (i) => (i >= 72000 && i < 96000) || i >= 134400 ? 0.5 * Math.sin(i / 10) : 0;
  const labels = (drawn) => drawn.filter(([key, text]) => key === 'fillText' && text.startsWith('silent')).map(([, text]) => text);
  assert.deepEqual(labels((await soundInNode(3, { frames: 72, hz: 24 }, null, soundInPage, tone)).drawn), ['silent 1.5 s', 'silent 0.8 s']);
  assert.deepEqual(labels((await soundInNode(3, { frames: 72, hz: 24 }, null)).drawn), [], 'a steady track shades nothing');
});

test('film: exportFilm never builds the piece in Node; the sound picture takes its cuts from the page\'s own report', async () => {
  let built = false;
  const piece = { ...EXAMPLES.readout, build: [...EXAMPLES.readout.build, ['count Node builds', (s) => { built = true; return s; }]] };
  const target = { name: 'readout', external: { piece, source: '' } };
  const reply = JSON.stringify({ report: { bytes: 1 }, data: 'YQ==', sound: { error: 'stub' } });
  const sent = [];
  const client = { send: async (method, { expression }) => {
    sent.push(expression);
    if (expression.startsWith('(async () => (globalThis.__artifexValue')) return { result: { value: reply.length } };
    return { result: { value: expression.startsWith('globalThis.__artifexValue.slice') ? reply : true } };
  } };
  const edge = async (page, browser, work) => work(client, { errors: [], version: { Browser: 'stub' } });
  const result = await exportFilm(target, {}, {}, undefined, edge);
  assert.equal(built, false, 'no build stage ran in Node');
  assert.equal(result.browser, 'stub');
  assert.equal(result.bytes.toString(), 'a');
  assert.ok(sent.some((e) => /\(bytes, report, [\d., ]+, report\.shots\)/.test(e)), 'the picture draws the cuts the page\'s report carries');
  // The sound code the page receives before exportInPage, run with nothing else, draws what the direct call draws.
  const expression = sent.find((e) => e.includes(exportInPage.toString()));
  const from = expression.indexOf('(() => {\n') + '(() => {\n'.length, to = expression.indexOf('\nreturn (' + exportInPage.toString());
  const alone = new Function(`${expression.slice(from, to)}\nreturn (${soundInPage});`)();
  const report = { hz: 24, frames: 48 }, shots = [{ name: 'open', start: 0, end: 12 }, { name: 'turn', start: 12, end: 48 }];
  const page = JSON.stringify(await soundInNode(2, report, shots, alone)), direct = JSON.stringify(await soundInNode(2, report, shots));
  assert.ok(!page.includes('"error"') && page === direct, page.slice(0, 200));
});

test('film: the page\'s film report carries plain copies of the exported solve\'s shots, or null when they do not lie within the film', async () => {
  const { fakeCodecs, fakeAudio, fakePage } = require('./fake-media.js');
  // Serialised into the page, so it builds its pieces from nothing outside itself.
  const registry = (module) => {
    const open = () => ({ name: 'open', start: 0, end: 2 }), close = () => ({ name: 'close', start: 2, end: 4 });
    const circular = () => { const c = { ...close(), extra: 1n }; c.self = c; return c; };
    const shot = (name, shots) => ({
      name, size: { w: 40, h: 30 }, time: { duration: 1, hz: 4 },
      build: [['cues', (state) => { state.cues = { shots: shots && shots() }; }]],
      draw(surface) { surface.fillRect(0, 0, 20, 20); },
    });
    module.exports = {
      cut: shot('cut', () => [open(), close()]), odd: shot('odd', () => [open(), circular()]),
      past: shot('past', () => [open(), { name: 'close', start: 2, end: 9 }]), none: shot('none', null),
      unnamed: shot('unnamed', () => [open(), { name: '', start: 2, end: 4 }]), hole: shot('hole', () => [open(), null]),
    };
  };
  const open = { name: 'open', start: 0, end: 2 }, close = { name: 'close', start: 2, end: 4 };
  const codecs = fakeCodecs();
  const { api } = fakePage({
    modules: { 'examples/index.js': registry },
    fields: () => ({ disabled: false }),
    globals: { VideoEncoder: codecs.VideoEncoder, VideoFrame: codecs.VideoFrame, AudioEncoder: codecs.AudioEncoder, AudioData: codecs.AudioData, OfflineAudioContext: fakeAudio().Context },
  });
  for (const [name, shots] of [['cut', [open, close]], ['odd', [open, close]], ['past', null], ['none', null], ['unnamed', null], ['hole', null]]) {
    api.select(name);
    const report = await api.film({ scale: 1 });
    // Compared as JSON, which also proves the report serialises; the page's objects come from another realm.
    assert.equal(JSON.stringify(report.shots), JSON.stringify(shots), name);
  }
});

test('film: the summary line says where the frames were drawn when the report knows, as npm run browser does', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-film-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const base = { frames: 24, width: 1920, height: 1080, seconds: 1, bytes: 1, conversion: 'cpu', convertMs: 1, drawMs: 2, totalMs: 3, realtime: 0.33 };
  const lines = [];
  const log = console.log;
  console.log = (line) => lines.push(line);
  try {
    for (const rasterizer of ['gpu', 'memory', null]) {
      await main(['readout', '--out', 'r.mp4'], async () => ({ browser: 'Edge/1', report: { ...base, rasterizer }, bytes: Buffer.from('a') }), dir);
    }
  } finally { console.log = log; }
  assert.match(lines[0], / from frames drawn on the GPU\. Report: /);
  assert.match(lines[1], / from frames drawn in memory\. Report: /);
  assert.doesNotMatch(lines[2], /frames drawn/, 'a report that cannot tell names no place');
});

test('film: a forced film names its condition in its report and first in its summary line', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-film-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const report = { frames: 24, width: 1920, height: 1080, seconds: 1, bytes: 3, conversion: 'encoder', convertMs: 1, drawMs: 2, totalMs: 3, realtime: 0.33, sound: { codec: 'Opus' } };
  const lines = [];
  const log = console.log;
  console.log = (line) => lines.push(line);
  try {
    let asked;
    await main(['settle', '--out', 'o.mp4', '--force', 'no-aac'], async (...args) => { asked = args; return { browser: 'Edge/1', report, bytes: Buffer.from('abc') }; }, dir);
    assert.equal(asked[2].force, 'no-aac', 'the condition reaches withEdge');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'o.mp4.json'), 'utf8')).forced, 'no-aac');
    assert.match(lines[0], /^film with AAC refused: .*o\.mp4: .*with an Opus soundtrack/);
  } finally { console.log = log; }
});
