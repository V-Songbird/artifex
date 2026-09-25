'use strict';

// The style registry: built-in styles and packs installed under a temporary
// ARTIFEX_HOME, never the real one. Listing reads style.json only; trust
// records its hash; check refuses anything else before running pack code.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { VERSION, validate } = require('../core/piece.js');
const { renderVector } = require('../core/render.js');
const { imports, loadExternal } = require('../tools/piece-input.js');
const styles = require('../tools/styles.js');
const { checkParses } = require('../tools/build-page.js');

const ROOT = path.resolve(__dirname, '..');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

/** An SVG with its manifest replaced, escaped as the vector surface writes it. */
const withManifest = (svg, m) => svg.replace(/(<metadata id="artifex-manifest">)[^<]*(<\/metadata>)/,
  (_, open, close) => open + JSON.stringify(m).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]) + close);

/** A temporary ARTIFEX_HOME, removed after the test, as the env the registry reads. */
function tempHome(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-styles-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, env: { ARTIFEX_HOME: dir } };
}

const PIECE = `const { rng } = require('artifex/core/rand.js');
const { dot } = require('./lib/dots.js');
module.exports = { name: 'dotted', size: { w: 60, h: 40 }, seed: 3, outputs: ['raster', 'vector'],
  draw(g, s) { g.fillStyle = '#f5efe1'; g.fillRect(0, 0, 60, 40); const r = rng(s.seed); for (let i = 0; i < 12; i++) dot(g, r('dot' + i, 'x') * 56, r('dot' + i, 'y') * 36); } };
`;
const DOTS = "module.exports = { dot(g, x, y) { g.fillStyle = '#295c7b'; g.fillRect(x, y, 4, 4); } };\n";

/** A valid pack in `home`, with its sample drawn by its own piece and every file hashed. */
function makePack(home, name = 'pointillism', { extra = {}, change = {} } = {}) {
  const folder = path.join(home, 'styles', name);
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
    fs.writeFileSync(path.join(folder, file), text);
  };
  write('piece.cjs', PIECE);
  write('lib/dots.js', DOTS);
  write('guide.md', '# Pointillism\n');
  write('sample.svg', renderVector(loadExternal(path.join(folder, 'piece.cjs'), folder).piece).svg);
  for (const [file, text] of Object.entries(extra)) write(file, text);
  const manifest = {
    stylePack: 1, name, title: 'Pointillism', version: '1.0.0', artifex: VERSION, summary: 'Dots of unmixed colour.',
    piece: 'piece.cjs', guide: 'guide.md', sample: 'sample.svg', files: {},
  };
  for (const file of ['piece.cjs', 'lib/dots.js', 'guide.md', 'sample.svg', ...Object.keys(extra)]) {
    manifest.files[file] = sha(fs.readFileSync(path.join(folder, file)));
  }
  Object.assign(manifest, change);
  write('style.json', JSON.stringify(manifest, null, 2));
  return { folder, manifest, write };
}

/** Replace one file of a pack and its hash, so the pack is valid but no longer the one trusted. */
function rewrite(pack, file, text) {
  pack.write(file, text);
  pack.manifest.files[file] = sha(Buffer.from(text));
  pack.write('style.json', JSON.stringify(pack.manifest, null, 2));
}

const quiet = () => {};

test('builtin.json lists the gallery styles in order and each module is a piece of its name', () => {
  const list = JSON.parse(fs.readFileSync(path.join(styles.STYLES, 'builtin.json'), 'utf8'));
  const gallery = path.join(styles.STYLES, 'gallery.cjs');
  const order = imports(fs.readFileSync(gallery, 'utf8'), gallery).map((dependency) => dependency.spec);
  assert.deepEqual(list.map((style) => './' + style.module), order);
  assert.equal(new Set(list.map((style) => style.name)).size, list.length);
  for (const style of list) {
    assert.deepEqual(Object.keys(style), ['name', 'title', 'summary', 'guide', 'module']);
    const piece = validate(require(path.join(styles.STYLES, style.module)));
    assert.equal(piece.name, style.name);
    assert.equal(style.module, style.name + '.js');
    assert.ok(fs.existsSync(path.join(styles.STYLES, style.guide)), style.guide);
    assert.ok(style.title && style.summary, style.name);
  }
});

test('style.json validation refuses each broken rule by name', () => {
  const good = {
    stylePack: 1, name: 'pointillism', title: 'Pointillism', version: '1.0.0', artifex: VERSION, summary: 'Dots.',
    piece: 'piece.cjs', guide: 'guide.md', sample: 'sample.png', files: { 'piece.cjs': 'a'.repeat(64), 'guide.md': 'b'.repeat(64), 'sample.png': 'c'.repeat(64) },
  };
  assert.equal(styles.validateManifest({ ...good, author: 'A. Person', license: 'MIT' }, 'pointillism').name, 'pointillism');
  const refused = (change, pattern) => assert.throws(() => styles.validateManifest({ ...good, ...change }, 'pointillism'), pattern);
  const file = (name, hash = 'd'.repeat(64)) => ({ files: { ...good.files, [name]: hash } });
  refused({ extra: true }, /^Error: style\.json: unknown key "extra"$/);
  assert.throws(() => styles.validateManifest(JSON.parse('{"__proto__": 1}'), 'pointillism'), /unknown key "__proto__"/);
  assert.throws(() => styles.validateManifest((({ summary, ...rest }) => rest)(good), 'pointillism'), /missing key "summary"/);
  assert.throws(() => styles.validateManifest([], 'pointillism'), /must be a JSON object/);
  refused({ stylePack: 2 }, /"stylePack" must be 1/);
  refused({ name: 'Pointillism' }, /"name" must be lowercase kebab-case/);
  refused({ name: 'dots_and_more' }, /"name" must be lowercase kebab-case/);
  refused({ name: 'a'.repeat(41) }, /at most 40 characters/);
  refused({ name: 'dots' }, /"name" is "dots" but the folder is "pointillism"/);
  refused({ version: '' }, /"version" must be a nonempty line of text/);
  refused({ author: 7 }, /"author" must be a nonempty line of text/);
  refused({ summary: 'two\nlines' }, /"summary" must be a nonempty line of text/);
  refused({ files: [] }, /"files" must map each file/);
  refused(file('../outside.js'), /files: "\.\.\/outside\.js" leaves the pack with "\.\."/);
  refused(file('lib/../../outside.js'), /leaves the pack/);
  refused(file('lib\\dots.js'), /files: "lib\\dots\.js" uses a backslash/);
  refused(file('/etc/passwd'), /is absolute/);
  refused(file('C:/secret.js'), /is absolute/);
  refused(file('lib//dots.js'), /has an empty or "\." segment/);
  refused(file('./dots.js'), /has an empty or "\." segment/);
  refused(file('dots.js.'), /ends a name with a dot or a space/);
  refused(file('dots:stream.js'), /holds a character/);
  refused(file('Style.json'), /is the manifest itself/);
  refused(file('dots.js', 'D'.repeat(64)), /files: "dots\.js" needs its SHA-256 in lowercase hex/);
  refused({ piece: 'piece.mjs' }, /"piece" must name a \.cjs or \.js file/);
  refused({ guide: 'guide.txt' }, /"guide" must name a \.md file/);
  refused({ sample: 'sample.jpg' }, /"sample" must name a \.svg or \.png file/);
  refused({ piece: 'other.cjs' }, /"piece" names other\.cjs, which "files" does not list/);
});

test('the scan reads style.json only and lists broken folders with their reason', (t) => {
  const { dir, env } = tempHome(t);
  const pack = makePack(dir);
  // Pack code that ran would throw; listing, resolving and naming never run it.
  rewrite(pack, 'piece.cjs', "throw new Error('pack code ran');\n");
  fs.mkdirSync(path.join(dir, 'styles', 'empty'));
  fs.mkdirSync(path.join(dir, 'styles', 'garbled'));
  fs.writeFileSync(path.join(dir, 'styles', 'garbled', 'style.json'), '{ not json');
  makePack(dir, 'misnamed', { change: { name: 'other' } });
  fs.writeFileSync(path.join(dir, 'styles', 'notes.txt'), 'a loose file is not a pack');
  const { packs, problems } = styles.scan(env);
  assert.deepEqual(packs.map((one) => [one.name, one.source, one.version, one.proved, one.trusted]), [['pointillism', 'installed', '1.0.0', true, false]]);
  assert.deepEqual(problems.map((one) => [one.name, one.status]), [['empty', 'broken'], ['garbled', 'broken'], ['misnamed', 'broken']]);
  assert.equal(problems[0].reason, 'no style.json');
  assert.match(problems[1].reason, /^style\.json: not valid JSON/);
  assert.match(problems[2].reason, /"name" is "other" but the folder is "misnamed"/);
  assert.equal(styles.resolve('Pointillism', env).piece, path.join(pack.folder, 'piece.cjs'));
  assert.throws(() => styles.resolve('garbled', env), /the pack in .*garbled is broken: style\.json: not valid JSON/);
  const lines = [];
  styles.list(env, false, (line) => lines.push(line));
  assert.match(lines.join('\n'), /pointillism +installed 1\.0\.0, proved with 0\.1\.0, not trusted +Pointillism: Dots of unmixed colour\./);
  assert.match(lines.join('\n'), /empty +broken: no style\.json/);
});

test('an installed pack with a built-in name is refused and the built-in style is used', (t) => {
  const { dir, env } = tempHome(t);
  makePack(dir, 'impasto');
  const { packs, problems } = styles.scan(env);
  assert.deepEqual(packs, []);
  assert.deepEqual(problems.map((one) => [one.name, one.status]), [['impasto', 'refused']]);
  assert.match(problems[0].reason, /"impasto" is a built-in style's name, so the built-in style is used/);
  for (const name of ['impasto', 'IMPASTO']) {
    const style = styles.resolve(name, env);
    assert.equal(style.source, 'builtin');
    assert.equal(style.piece, path.join(styles.STYLES, 'impasto.js'));
  }
  assert.throws(() => styles.trust('impasto', env, quiet), /"impasto" is built in; built-in styles ship with the library and need no trust/);
});

test('an unknown style name lists every built-in and installed style and the install folder', (t) => {
  const { dir, env } = tempHome(t);
  const builtin = styles.builtins().map((style) => style.name).sort().join(', ');
  assert.throws(() => styles.resolve('puntillismo', env), {
    message: 'style: no style named "puntillismo". Available: ' + builtin + ' (built in); none installed. Packs are installed in ' + path.join(dir, 'styles') + '.',
  });
  makePack(dir);
  assert.throws(() => styles.resolve('puntillismo', env), {
    message: 'style: no style named "puntillismo". Available: ' + builtin + ' (built in); pointillism (installed). Packs are installed in ' + path.join(dir, 'styles') + '.',
  });
});

test('trust records the hash of style.json and check refuses a pack changed since', async (t) => {
  const { dir, env } = tempHome(t);
  const pack = makePack(dir);
  await assert.rejects(styles.check('pointillism', env, quiet), /pointillism is not trusted\. Read its files, then run: npm run styles -- trust pointillism/);
  const shown = [];
  styles.trust('pointillism', env, (line) => shown.push(line));
  const record = JSON.parse(fs.readFileSync(path.join(dir, 'trust.json'), 'utf8'));
  assert.deepEqual(record, { packs: { pointillism: { version: '1.0.0', sha256: sha(fs.readFileSync(path.join(pack.folder, 'style.json'))) } } });
  assert.equal(styles.scan(env).packs[0].trusted, true);
  const text = shown.join('\n');
  assert.match(text, /author: not given; license: not given; proved with Artifex 0\.1\.0/);
  for (const file of Object.keys(pack.manifest.files)) {
    const bytes = fs.readFileSync(path.join(pack.folder, file));
    assert.ok(text.includes('  ' + file + '  ' + bytes.length + ' bytes  sha256 ' + sha(bytes)), file);
  }
  assert.match(text, /piece\.cjs .*\n {4}requires: artifex\/core\/rand\.js, \.\/lib\/dots\.js/);
  const lines = [];
  await styles.check('pointillism', env, (line) => lines.push(line));
  assert.deepEqual(lines, ['check pointillism: 4 files match style.json, trusted, proved with 0.1.0, its piece loads within its own files, and sample.svg replays from a clean copy: ' + fs.statSync(path.join(pack.folder, 'sample.svg')).size + ' bytes, identical to the replay']);

  // A new version, even with the same files, must be trusted again.
  pack.manifest.version = '1.0.1';
  pack.write('style.json', JSON.stringify(pack.manifest));
  await assert.rejects(styles.check('pointillism', env, quiet), /pointillism changed since it was trusted as version 1\.0\.0\. Read its files, then run: npm run styles -- trust pointillism/);
  styles.trust('pointillism', env, quiet);
  await styles.check('pointillism', env, quiet);

  // Pack code is refused before it runs when it is not the code trusted.
  rewrite(pack, 'piece.cjs', "throw new Error('pack code ran');\n");
  await assert.rejects(styles.check('pointillism', env, quiet), /changed since it was trusted/);
  styles.trust('pointillism', env, quiet);
  await assert.rejects(styles.check('pointillism', env, quiet), /pack code ran/);
});

test('every use refuses a pack whose files differ from style.json', async (t) => {
  const { dir, env } = tempHome(t);
  const pack = makePack(dir);
  styles.trust('pointillism', env, quiet);
  fs.writeFileSync(path.join(pack.folder, 'lib', 'dots.js'), DOTS + '// changed\n');
  await assert.rejects(styles.check('pointillism', env, quiet), /^Error: style: pointillism: lib\/dots\.js differs from its hash in style\.json$/);
  assert.throws(() => styles.trust('pointillism', env, quiet), /lib\/dots\.js differs from its hash/);
  fs.writeFileSync(path.join(pack.folder, 'lib', 'dots.js'), DOTS);
  await styles.check('pointillism', env, quiet);
  for (const unlisted of ['lib/extra.js', 'extra.cjs', 'lib/data.json', 'loader.mjs']) {
    fs.writeFileSync(path.join(pack.folder, unlisted), 'module.exports = 1;');
    await assert.rejects(styles.check('pointillism', env, quiet), new RegExp(unlisted.replace('.', '\\.') + ' is not listed in style\\.json, and only listed files may be loaded'));
    fs.rmSync(path.join(pack.folder, unlisted));
  }
  fs.writeFileSync(path.join(pack.folder, 'Thumbs.db'), 'ignored, never read');
  await styles.check('pointillism', env, quiet);
  fs.rmSync(path.join(pack.folder, 'guide.md'));
  await assert.rejects(styles.check('pointillism', env, quiet), /pointillism: guide\.md is listed in style\.json but missing/);
});

test('a pack holding a link is refused, as is a linked pack folder', async (t) => {
  const { dir, env } = tempHome(t);
  const pack = makePack(dir);
  styles.trust('pointillism', env, quiet);
  const outside = path.join(dir, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(pack.folder, 'more'), 'junction');
  await assert.rejects(styles.check('pointillism', env, quiet), /pointillism: more is a link; a pack holds only its own files/);
  fs.symlinkSync(pack.folder, path.join(dir, 'styles', 'alias'), 'junction');
  assert.deepEqual(styles.scan(env).problems.map((one) => [one.name, one.reason]), [['alias', 'the folder is a link; install the pack itself']]);
});

test('check refuses a pack proved on another version and a piece that requires outside its files', async (t) => {
  const { dir, env } = tempHome(t);
  const pack = makePack(dir);
  const svg = fs.readFileSync(path.join(pack.folder, 'sample.svg'), 'utf8');
  const manifest = JSON.parse(/<metadata id="artifex-manifest">([^<]*)</.exec(svg)[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  rewrite(pack, 'sample.svg', withManifest(svg, { ...manifest, artifex: '0.0.1' }));
  assert.throws(() => styles.trust('pointillism', env, quiet), /sample\.svg was drawn by Artifex 0\.0\.1, but style\.json says 0\.1\.0/);
  pack.manifest.artifex = '0.0.1';
  pack.write('style.json', JSON.stringify(pack.manifest));
  assert.equal(styles.scan(env).packs[0].proved, false);
  styles.trust('pointillism', env, quiet);
  await assert.rejects(styles.check('pointillism', env, quiet), /pointillism is not proved on this version: its sample was proved with Artifex 0\.0\.1, this is 0\.1\.0/);

  const other = makePack(dir, 'reaching');
  fs.writeFileSync(path.join(dir, 'styles', 'secret.js'), 'module.exports = {};');
  rewrite(other, 'lib/dots.js', "require('../../secret.js');\n" + DOTS);
  styles.trust('reaching', env, quiet);
  await assert.rejects(styles.check('reaching', env, quiet), /requires \.\.\/\.\.\/secret\.js .*which is not a listed file of/);
});

test('a built-in style checks as a piece of its name', async () => {
  const lines = [];
  await styles.check('papercraft', { ARTIFEX_HOME: path.join(os.tmpdir(), 'artifex-styles-absent') }, (line) => lines.push(line));
  assert.deepEqual(lines, ['check papercraft: built in; its module loads as the piece papercraft and its guide is present']);
});

test('npm run styles resolves ARTIFEX_HOME from the caller and lists, prints JSON and refuses by exit code', (t) => {
  const { dir } = tempHome(t);
  makePack(dir);
  const npm = { npm_lifecycle_event: 'styles', npm_package_json: path.join(ROOT, 'package.json'), INIT_CWD: path.dirname(dir) };
  assert.equal(styles.home({ ...npm, ARTIFEX_HOME: path.basename(dir) }), dir);
  assert.equal(styles.home({ ARTIFEX_HOME: dir }), dir);
  const run = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'tools', 'styles.js'), ...args],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ARTIFEX_HOME: dir }, timeout: 120000 });
  const listed = run();
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /^papercraft +built in +Papercraft: /m);
  assert.match(listed.stdout, /^pointillism +installed 1\.0\.0/m);
  const json = run('list', '--json');
  assert.equal(json.status, 0, json.stderr);
  const report = JSON.parse(json.stdout);
  assert.equal(report.home, dir);
  assert.equal(report.packs, path.join(dir, 'styles'));
  assert.deepEqual(report.styles.at(-1), {
    name: 'pointillism', title: 'Pointillism', summary: 'Dots of unmixed colour.', source: 'installed',
    guide: path.join(dir, 'styles', 'pointillism', 'guide.md'), piece: path.join(dir, 'styles', 'pointillism', 'piece.cjs'),
    sample: path.join(dir, 'styles', 'pointillism', 'sample.svg'), version: '1.0.0', artifex: VERSION, proved: true, trusted: false,
    folder: path.join(dir, 'styles', 'pointillism'),
  });
  assert.equal(report.styles[0].source, 'builtin');
  assert.deepEqual(report.problems, []);
  assert.equal(run('--json').stdout, json.stdout);
  const unknown = run('check', 'puntillismo');
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /no style named "puntillismo"\. Available: .*pointillism \(installed\)/);
  const untrusted = run('check', 'pointillism');
  assert.equal(untrusted.status, 1);
  assert.match(untrusted.stderr, /npm run styles -- trust pointillism/);
  for (const args of [['check'], ['trust', 'a', 'b'], ['list', '--all'], ['remove', 'pointillism']]) {
    assert.match(run(...args).stderr, /styles: usage: /, args.join(' '));
  }
});

test('a style loads by name for page and seeds: a built-in module, or a trusted pack before its code runs', (t) => {
  const { dir, env } = tempHome(t);
  const out = path.join(ROOT, 'out');
  const unproved = [];
  const builtin = styles.load('Impasto', env, (message) => unproved.push(message));
  assert.deepEqual([builtin.piece.name, builtin.style.source, builtin.stem, builtin.directory], ['impasto', 'builtin', 'style-impasto', out]);
  const pack = makePack(dir);
  // Pack code that ran would throw; an untrusted or changed pack is refused before it runs.
  rewrite(pack, 'piece.cjs', "throw new Error('pack code ran');\n");
  assert.throws(() => styles.load('pointillism', env), /^Error: style: pointillism is not trusted\. Read its files, then run: npm run styles -- trust pointillism$/);
  styles.trust('pointillism', env, quiet);
  assert.throws(() => styles.load('pointillism', env), /pack code ran/);
  rewrite(pack, 'piece.cjs', PIECE);
  assert.throws(() => styles.load('pointillism', env), /pointillism changed since it was trusted as version 1\.0\.0\. Read its files, then run: npm run styles -- trust pointillism/);
  styles.trust('pointillism', env, quiet);
  const loaded = styles.load('pointillism', env, (message) => unproved.push(message));
  assert.deepEqual([loaded.piece.name, loaded.names, loaded.style.source, loaded.stem, loaded.directory], ['dotted', ['dotted'], 'installed', 'style-pointillism', out]);
  assert.deepEqual(unproved, []);

  // A pack proved on another version still loads, with a warning.
  const svg = fs.readFileSync(path.join(pack.folder, 'sample.svg'), 'utf8');
  const manifest = JSON.parse(/<metadata id="artifex-manifest">([^<]*)</.exec(svg)[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  rewrite(pack, 'sample.svg', withManifest(svg, { ...manifest, artifex: '0.0.1' }));
  pack.manifest.artifex = '0.0.1';
  pack.write('style.json', JSON.stringify(pack.manifest));
  styles.trust('pointillism', env, quiet);
  assert.equal(styles.load('pointillism', env, (message) => unproved.push(message)).piece.name, 'dotted');
  assert.deepEqual(unproved, ['style: pointillism is not proved on this version: its sample was proved with Artifex 0.0.1, this is ' + VERSION]);
});

test('npm run page and seeds take --style, write out/style-<name>-page.html and -seeds.html, and refuse by exit code', (t) => {
  const { dir, env } = tempHome(t);
  // A name of this run's own, so parallel runs never share an output file.
  const name = 'pointillism-' + process.pid;
  makePack(dir, name);
  const files = ['page', 'seeds'].map((kind) => path.join(ROOT, 'out', 'style-' + name + '-' + kind + '.html'));
  t.after(() => { for (const file of files) fs.rmSync(file, { force: true }); });
  const run = (tool, ...args) => spawnSync(process.execPath, [path.join(ROOT, 'tools', tool), ...args],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ARTIFEX_HOME: dir }, timeout: 120000 });
  for (const [tool, args] of [['build-page.js', []], ['contact-sheet.js', ['2', '0.5']]]) {
    const untrusted = run(tool, '--style', name, ...args);
    assert.equal(untrusted.status, 1, tool);
    assert.equal(untrusted.stderr, 'style: ' + name + ' is not trusted. Read its files, then run: npm run styles -- trust ' + name + '\n', tool);
    const unknown = run(tool, '--style', 'puntillismo', ...args);
    assert.equal(unknown.status, 1, tool);
    assert.match(unknown.stderr, new RegExp('^style: no style named "puntillismo"\\. Available: cad, circuit-board, .* \\(built in\\); ' + name + ' \\(installed\\)\\. Packs are installed in '), tool);
  }
  assert.deepEqual(files.filter((file) => fs.existsSync(file)), [], 'a refused style writes nothing');
  styles.trust(name, env, quiet);
  const built = run('build-page.js', '--style', name.toUpperCase());
  assert.equal(built.status, 0, built.stderr);
  assert.equal(checkParses(fs.readFileSync(files[0], 'utf8')), true);
  const sheet = run('contact-sheet.js', '--style', name, '2', '0.5');
  assert.equal(sheet.status, 0, sheet.stderr);
  assert.match(fs.readFileSync(files[1], 'utf8'), /var NAMES = \["dotted"\];/);
});

const GUIDE = '# Pointillism\n\nDots.\n\n## What makes it read as pointillism\n\nDots.\n\n## Recipe\n\nDot.\n\n## Palette\n\nTwo.\n\n## Pitfalls\n\nLines.\n\n## Any subject\n\nDots.\n';
const LIBRARY = ROOT.split(path.sep).join('/');

/** A project folder holding `files`, as a piece's author keeps it before packing. */
function project(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-project-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  }
  return dir;
}

/** What `pack` leaves in the temporary folder of this process: proof copies it never removed. */
const proofCopies = () => fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('artifex-proof-' + process.pid + '-'));

test('pack copies a piece and the files it reaches into piece.cjs and lib/, rewriting their requires', (t) => {
  const body = "module.exports = { name: 'dotted', size: { w: 60, h: 40 }, seed: 3, outputs: ['raster', 'vector'],\n"
    + "  draw(g, s) { g.fillStyle = data.ground; g.fillRect(0, 0, 60, 40); const r = rng(s.seed); for (let i = 0; i < 8; i++) { dot(g, lerp(4, 52, r('d' + i, 'x')), r('d' + i, 'y') * 36); more.ring(g, 30, 20, 4 + i * 2); } } };\n";
  const dir = project(t, {
    'dotted.cjs': "#!/usr/bin/env node\nconst { rng } = require('artifex/core/rand.js');\n"
      + "const { lerp } = require('" + LIBRARY + "/core/num.js');\nconst font = require(\"" + LIBRARY + "/examples/stroke-font.js\");\n"
      + "const { dot } = require('./lib/dots.js');\nconst more = require('./more/dots');\nconst data = require('./data.json');\n" + body,
    'lib/dots.js': DOTS,
    'more/dots.js': "const data = require('../data.json');\nmodule.exports = { ring(g, x, y, r) { g.strokeStyle = data.ink; g.beginPath(); g.arc(x, y, r, 0, 3); g.stroke(); } };\n",
    'data.json': '{ "ground": "#f5efe1", "ink": "#295c7b" }\n',
  });
  const sources = styles.packSources(path.join(dir, 'dotted.cjs'));
  assert.deepEqual(sources, {
    'piece.cjs': "\nconst { rng } = require(\"artifex/core/rand.js\");\nconst { lerp } = require(\"artifex/core/num.js\");\n"
      + "const font = require(\"artifex/core/stroke-font.js\");\nconst { dot } = require(\"./lib/dots.js\");\n"
      + "const more = require(\"./lib/dots-2.js\");\nconst data = require(\"./lib/data.json\");\n" + body,
    'lib/dots.js': DOTS,
    'lib/dots-2.js': "const data = require(\"./data.json\");\nmodule.exports = { ring(g, x, y, r) { g.strokeStyle = data.ink; g.beginPath(); g.arc(x, y, r, 0, 3); g.stroke(); } };\n",
    'lib/data.json': '{ "ground": "#f5efe1", "ink": "#295c7b" }\n',
  });
  // The rewritten files load confined to themselves and draw what the author's files draw.
  const pack = project(t, sources);
  const confined = loadExternal('piece.cjs', pack, { confine: { root: pack, files: Object.keys(sources) } });
  assert.equal(renderVector(confined.piece).svg, renderVector(loadExternal(path.join(dir, 'dotted.cjs'), dir).piece).svg);

  const reaching = project(t, { 'drift.cjs': "module.exports = require('" + LIBRARY + "/examples/drift.js');\n" });
  assert.throws(() => styles.packSources(path.join(reaching, 'drift.cjs')),
    /requires .*drift\.js, the library file examples\/drift\.js; a pack may require only its own files and artifex\/core\/<file>\.js$/);
});

test('a pack guide needs a title and the built-in guides\' headings in order', () => {
  assert.equal(styles.guideProblem(GUIDE), null);
  for (const style of styles.builtins()) assert.equal(styles.guideProblem(fs.readFileSync(style.guide, 'utf8')), null, style.name);
  assert.equal(styles.guideProblem(GUIDE.replace('\n## Palette\n\nTwo.\n', '')), null, 'Palette is not required');
  assert.equal(styles.guideProblem(GUIDE.replace('# Pointillism', 'Pointillism')), 'has no "# " title');
  assert.equal(styles.guideProblem(GUIDE.replace('## What makes it read as pointillism', '## Why dots')), 'has no "## What makes it read as" heading');
  assert.equal(styles.guideProblem(GUIDE.replace('## Pitfalls', '## Mistakes')), 'has no "## Pitfalls" heading after "## Recipe"');
  const swapped = GUIDE.replace('## Recipe', '## Held').replace('## Any subject', '## Any subject\n\n## Recipe');
  assert.equal(styles.guideProblem(swapped), 'has no "## Pitfalls" heading after "## Recipe"');
});

test('pack writes style.json and the sample, proves it from a clean copy, then installs and trusts the pack', async (t) => {
  const { dir, env } = tempHome(t);
  const author = project(t, { 'dotted.cjs': PIECE.replace('./lib/dots.js', './dots.js'), 'dots.js': DOTS, 'guide.md': GUIDE });
  const shown = [];
  await styles.pack({ piece: path.join(author, 'dotted.cjs'), name: 'pointillism', guide: path.join(author, 'guide.md'), summary: 'Dots of unmixed colour.', license: 'MIT', seed: '5', t: '1' },
    env, (line) => shown.push(line));
  const folder = path.join(dir, 'styles', 'pointillism');
  const read = (file) => fs.readFileSync(path.join(folder, file));
  const svg = renderVector(loadExternal(path.join(author, 'dotted.cjs'), author).piece, { seed: 5 }).svg;
  assert.equal(read('sample.svg').toString('utf8'), svg);
  assert.equal(read('guide.md').toString('utf8'), GUIDE);
  assert.equal(read('lib/dots.js').toString('utf8'), DOTS);
  const manifest = JSON.parse(read('style.json'));
  assert.deepEqual(manifest, {
    stylePack: 1, name: 'pointillism', title: 'Pointillism', version: '1.0.0', artifex: VERSION, summary: 'Dots of unmixed colour.', license: 'MIT',
    piece: 'piece.cjs', guide: 'guide.md', sample: 'sample.svg',
    files: Object.fromEntries(['lib/dots.js', 'piece.cjs', 'guide.md', 'sample.svg'].map((file) => [file, sha(read(file))])),
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'trust.json'), 'utf8')), { packs: { pointillism: { version: '1.0.0', sha256: sha(read('style.json')) } } });
  assert.equal(shown[0], 'pack pointillism: 4 files in ' + folder + '; sample.svg replays from a clean copy: ' + Buffer.byteLength(svg) + ' bytes, identical to the replay');
  assert.match(shown.at(-1), /^Trusted pointillism 1\.0\.0 /);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['styles', 'trust.json'], 'no build folder is left');
  assert.deepEqual(proofCopies(), []);
  await styles.check('pointillism', env, quiet);

  // --replace installs a new pack in the old one's place, and trusts it.
  await styles.pack({ piece: path.join(author, 'dotted.cjs'), name: 'pointillism', guide: path.join(author, 'guide.md'), summary: 'Dots.', title: 'Dots', version: '2.0.0', replace: true }, env, quiet);
  assert.deepEqual([JSON.parse(read('style.json')).title, JSON.parse(read('style.json')).version], ['Dots', '2.0.0']);
  assert.equal(styles.scan(env).packs[0].trusted, true);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['styles', 'trust.json']);
});

test('pack refuses by name and writes nothing', async (t) => {
  const { dir, env } = tempHome(t);
  const author = project(t, { 'dotted.cjs': PIECE.replace('./lib/dots.js', './dots.js'), 'dots.js': DOTS, 'guide.md': GUIDE, 'thin.md': '# Thin\n\n## Recipe\n' });
  const options = { piece: path.join(author, 'dotted.cjs'), name: 'pointillism', guide: path.join(author, 'guide.md'), summary: 'Dots.' };
  const refused = (change, pattern) => assert.rejects(styles.pack({ ...options, ...change }, env, quiet), pattern);
  await refused({ name: 'Pointillism' }, /^Error: pack: the name must be lowercase kebab-case, at most 40 characters, not "Pointillism"$/);
  await refused({ name: 'a'.repeat(41) }, /at most 40 characters/);
  await refused({ name: 'impasto' }, /^Error: pack: "impasto" is a built-in style's name; choose another$/);
  await refused({ guide: path.join(author, 'thin.md') }, /thin\.md has no "## What makes it read as" heading; a guide has "# <title>", then "## What makes it read as", "## Recipe", "## Pitfalls", "## Any subject", in that order$/);
  await refused({ seed: '-1' }, /^Error: pack: --seed must be an integer from 0 to 4294967295$/);
  await refused({ seed: '1.5' }, /--seed must be an integer/);
  await refused({ t: '2' }, /^Error: pack: --t must be a number from 0 to 1$/);
  await refused({ t: 'end' }, /--t must be a number/);
  assert.deepEqual(fs.readdirSync(dir), [], 'a refused pack writes nothing');
  const existing = makePack(dir);
  await refused({}, /pointillism exists; pass --replace to replace it$/);
  fs.rmSync(existing.folder, { recursive: true });
  fs.symlinkSync(author, existing.folder, 'junction');
  await refused({ replace: true }, /pointillism is a link; remove it yourself first$/);
  assert.deepEqual(fs.readdirSync(author).sort(), ['dots.js', 'dotted.cjs', 'guide.md', 'thin.md'], 'a linked folder is left alone');
  const usage = /^Error: styles: usage: npm run styles -- pack <piece> --name <name> --guide <guide\.md> --summary <text> /;
  for (const args of [['pack'], ['pack', 'dotted.cjs'], ['pack', 'dotted.cjs', '--name', 'dots', '--guide', 'guide.md'], ['pack', 'a.cjs', 'b.cjs', '--name', 'dots', '--guide', 'g.md', '--summary', 's'],
    ['pack', 'dotted.cjs', '--name', 'dots', '--guide', 'guide.md', '--summary', 's', '--frame', '3'], ['pack', 'dotted.cjs', '--summary']]) {
    await assert.rejects(styles.main(args, env, quiet), usage, args.join(' '));
  }
  assert.deepEqual(styles.packArgs(['dotted.cjs', '--name', 'dots', '--guide', 'g.md', '--summary', 's', '--replace', '--seed', '4', '--t', '0.5']),
    { replace: true, piece: 'dotted.cjs', name: 'dots', guide: 'g.md', summary: 's', seed: '4', t: '0.5' });
});

test('pack removes its own output when the sample does not replay, and keeps the pack it would replace', async (t) => {
  const { dir, env } = tempHome(t);
  // Each draw moves the square, so the redraw can never match the sample.
  const author = project(t, {
    'restless.cjs': "module.exports = { name: 'restless', size: { w: 40, h: 40 }, outputs: ['raster', 'vector'],\n"
      + "  draw(g) { globalThis.__artifexRestless = (globalThis.__artifexRestless || 0) + 1; g.fillStyle = '#123456'; g.fillRect(globalThis.__artifexRestless, 0, 10, 10); } };\n",
    'guide.md': GUIDE,
  });
  t.after(() => { delete globalThis.__artifexRestless; });
  const options = { piece: path.join(author, 'restless.cjs'), name: 'restless', guide: path.join(author, 'guide.md'), summary: 'Never still.' };
  await assert.rejects(styles.pack(options, env, quiet),
    /^Error: pack: restless: sample\.svg does not replay from a clean copy of the pack, so nothing was installed: byte \d+ of \d+ differs: /);
  assert.deepEqual(fs.readdirSync(dir), [], 'nothing is left in ARTIFEX_HOME');
  assert.deepEqual(proofCopies(), []);

  const old = makePack(dir, 'restless');
  styles.trust('restless', env, quiet);
  const before = fs.readFileSync(path.join(dir, 'trust.json'), 'utf8');
  await assert.rejects(styles.pack({ ...options, replace: true }, env, quiet), /does not replay from a clean copy of the pack, so nothing was installed/);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['styles', 'trust.json']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(old.folder, 'style.json'), 'utf8')), old.manifest, 'the old pack is kept');
  assert.equal(fs.readFileSync(path.join(dir, 'trust.json'), 'utf8'), before, 'and its trust');
  await styles.check('restless', env, quiet);
  assert.deepEqual(proofCopies(), []);
});

test('pack --replace restores the old pack and its trust when installing the new one fails', async (t) => {
  const { dir, env } = tempHome(t);
  const author = project(t, { 'dotted.cjs': PIECE.replace('./lib/dots.js', './dots.js'), 'dots.js': DOTS, 'guide.md': GUIDE });
  const options = { piece: path.join(author, 'dotted.cjs'), name: 'pointillism', guide: path.join(author, 'guide.md'), summary: 'Dots.', version: '2.0.0', replace: true };
  const old = makePack(dir);
  styles.trust('pointillism', env, quiet);
  const snapshot = () => Object.fromEntries(fs.readdirSync(old.folder, { recursive: true }).sort()
    .filter((file) => fs.statSync(path.join(old.folder, file)).isFile()).map((file) => [file, fs.readFileSync(path.join(old.folder, file), 'utf8')]));
  const before = { pack: snapshot(), trust: fs.readFileSync(path.join(dir, 'trust.json'), 'utf8') };
  const unchanged = async () => {
    assert.deepEqual(snapshot(), before.pack, 'the old pack is back in its folder');
    assert.equal(fs.readFileSync(path.join(dir, 'trust.json'), 'utf8'), before.trust, 'with its trust');
    assert.deepEqual(fs.readdirSync(dir).sort(), ['styles', 'trust.json'], 'no build or old folder is left');
    await styles.check('pointillism', env, quiet);
  };

  // The rename into styles/ fails, as a locked file or a full disk makes it.
  const rename = fs.renameSync;
  const locked = t.mock.method(fs, 'renameSync', (from, to) => {
    if (path.basename(from).startsWith('.pack-')) throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });
    return rename(from, to);
  });
  await assert.rejects(styles.pack(options, env, quiet), /^Error: EPERM: operation not permitted, rename$/);
  locked.mock.restore();
  await unchanged();

  // The new pack is installed and trusted, and then the install fails.
  await assert.rejects(styles.pack(options, env, (line) => { if (line.startsWith('Trusted')) throw new Error('log failed'); }), /^Error: log failed$/);
  await unchanged();

  await styles.pack(options, env, quiet);
  assert.equal(JSON.parse(fs.readFileSync(path.join(old.folder, 'style.json'), 'utf8')).version, '2.0.0');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['styles', 'trust.json'], 'the old pack is removed once the new one is trusted');
});

test('check replays a pack\'s sample from a clean copy and names the first difference', async (t) => {
  const { dir, env } = tempHome(t);
  const pack = makePack(dir);
  styles.trust('pointillism', env, quiet);
  await styles.check('pointillism', env, quiet);
  // The same recipe, another drawing: the file matches its hash and trust, but not its piece.
  const svg = fs.readFileSync(path.join(pack.folder, 'sample.svg'), 'utf8');
  rewrite(pack, 'sample.svg', svg.replace('#295c7b', '#295c7c'));
  styles.trust('pointillism', env, quiet);
  await assert.rejects(styles.check('pointillism', env, quiet),
    /^Error: style: pointillism: sample\.svg does not replay from a clean copy of the pack: byte \d+ of \d+ differs: the file has .*#295c7c.* where the replay draws .*#295c7b/);
  assert.deepEqual(proofCopies(), []);
});
