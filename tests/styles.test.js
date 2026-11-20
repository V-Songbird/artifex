'use strict';

// The style registry: built-in styles and packs installed under a temporary
// ARTIFEX_HOME, never the real one. A style is a guide and mark functions;
// a pack adds a proof of each function. Listing reads style.json only; trust
// records its hash; check refuses anything else before running pack code.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { VERSION } = require('../core/piece.js');
const { imports } = require('../tools/piece-input.js');
const styles = require('../tools/styles.js');

const ROOT = path.resolve(__dirname, '..');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A temporary ARTIFEX_HOME, removed after the test, as the env the registry reads. */
function tempHome(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-styles-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, env: { ARTIFEX_HOME: dir } };
}

// A pack's two mark functions, a helper they share and a proof of each.
const MARKS = `const { rng } = require('artifex/core/rand.js');
const { ink } = require('./lib/ink.js');
// n dots r wide inside the box (x, y, w, h), placed by the seed.
function dots(g, seed, x, y, w, h, { n = 12, r = 2 } = {}) {
  const R = rng(seed);
  g.fillStyle = ink;
  for (let i = 0; i < n; i++) { g.beginPath(); g.arc(x + r + R('d', 'x', i) * (w - 2 * r), y + r + R('d', 'y', i) * (h - 2 * r), r, 0, Math.PI * 2); g.fill(); }
}
// A straight dash from (x0, y0) to (x1, y1).
function dash(g, x0, y0, x1, y1) { g.strokeStyle = ink; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
module.exports = { dots, dash };
`;
const INK = "module.exports = { ink: '#295c7b' };\n";
const PROOF = `module.exports = {
  dots: { box: [0, 0, 60, 40], draw(g, marks) { marks.dots(g, 3, 0, 0, 60, 40); } },
  dash: { box: [0, 0, 60, 40], draw(g, marks) { marks.dash(g, 5, 5, 55, 35); } },
};
`;
const GUIDE = '# Pointillism\n\nDots.\n\n## What makes it read as pointillism\n\nDots.\n\n## Marks\n\nDot.\n\n## Creative direction\n\nLight.\n\n## Palette\n\nTwo.\n\n## Pitfalls\n\nLines.\n';

/** A valid pack in `home`, every file hashed. */
function makePack(home, name = 'pointillism', { extra = {}, change = {} } = {}) {
  const folder = path.join(home, 'styles', name);
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
    fs.writeFileSync(path.join(folder, file), text);
  };
  const files = { 'marks.cjs': MARKS, 'lib/ink.js': INK, 'proof.cjs': PROOF, 'guide.md': GUIDE, ...extra };
  for (const [file, text] of Object.entries(files)) write(file, text);
  const manifest = {
    stylePack: 2, name, title: 'Pointillism', version: '1.0.0', artifex: VERSION, summary: 'Dots of unmixed colour.',
    guide: 'guide.md', module: 'marks.cjs', proof: 'proof.cjs', marks: ['dots', 'dash'], files: {},
  };
  for (const file of Object.keys(files)) manifest.files[file] = sha(fs.readFileSync(path.join(folder, file)));
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

test('builtin.json lists each style once, with a guide and a module of mark functions that is no piece', () => {
  const list = JSON.parse(fs.readFileSync(path.join(styles.STYLES, 'builtin.json'), 'utf8'));
  assert.equal(new Set(list.map((style) => style.name)).size, list.length);
  for (const style of list) {
    assert.deepEqual(Object.keys(style), ['name', 'title', 'summary', 'guide', 'module']);
    assert.equal(style.module, style.name + '.js');
    assert.equal(style.guide, style.name + '.md');
    assert.ok(styles.markNames(require(path.join(styles.STYLES, style.module)), style.module).length, style.module);
    assert.ok(style.title && style.summary, style.name);
  }
});

// A style is taught by its marks and its creative direction, never by a
// picture to copy: no subject, no staged scene, no example image.
test('the built-in styles hold no subject, scene or example image for a piece to copy', () => {
  const files = fs.readdirSync(styles.STYLES, { recursive: true }).map((file) => file.split(path.sep).join('/'));
  const list = JSON.parse(fs.readFileSync(path.join(styles.STYLES, 'builtin.json'), 'utf8'));
  const pictures = files.filter((file) => /\.(?:png|jpe?g|gif|svg)$/i.test(file));
  assert.deepEqual(pictures, [], 'only reference photos of a real material, as WebP under references/, belong here');
  const known = new Set(['builtin.json', 'catalog.md', 'kit.js', ...list.flatMap((style) => [style.guide, style.module])]);
  assert.deepEqual(files.filter((file) => !file.startsWith('references') && !known.has(file)), [], 'every file is a style\'s guide or marks, or shared');
  for (const file of files.filter((one) => /\.c?js$/.test(one))) {
    const text = fs.readFileSync(path.join(styles.STYLES, file), 'utf8');
    for (const dependency of imports(text, path.join(styles.STYLES, file))) assert.doesNotMatch(dependency.spec, /subject|site\//, file);
  }
  for (const style of list) {
    const guide = fs.readFileSync(path.join(styles.STYLES, style.guide), 'utf8');
    assert.doesNotMatch(guide, /\bdemo\b|\bgallery\b|catalog image|songbird|^## (?:Recipe|Any subject)\b/im, style.guide);
    assert.match(guide, /^## Creative direction$/m, style.guide);
  }
});

test('the style catalog lists every built-in style once, with its guide and marks, and shows no image', () => {
  const text = fs.readFileSync(path.join(styles.STYLES, 'catalog.md'), 'utf8');
  const rows = [...text.matchAll(/^\| `([a-z0-9-]+)` \| [^|]+ \| [^|]+ \| \[([^\]]+)\]\(([^)]+)\) \| \[([^\]]+)\]\(([^)]+)\) \|$/gm)];
  assert.deepEqual(rows.map((row) => row[1]).sort(), styles.builtins().map((style) => style.name).sort());
  for (const [, name, guideText, guide, marksText, marks] of rows) assert.deepEqual([guideText, guide, marksText, marks], [name + '.md', name + '.md', name + '.js', name + '.js'], name);
  assert.doesNotMatch(text, /!\[|<img\b/i);
});

test('style.json validation refuses each broken rule by name', () => {
  const good = {
    stylePack: 2, name: 'pointillism', title: 'Pointillism', version: '1.0.0', artifex: VERSION, summary: 'Dots.',
    guide: 'guide.md', module: 'marks.cjs', proof: 'proof.cjs', marks: ['dots', 'dash'],
    files: { 'marks.cjs': 'a'.repeat(64), 'guide.md': 'b'.repeat(64), 'proof.cjs': 'c'.repeat(64) },
  };
  assert.equal(styles.validateManifest({ ...good, author: 'A. Person', license: 'MIT' }, 'pointillism').name, 'pointillism');
  const refused = (change, pattern) => assert.throws(() => styles.validateManifest({ ...good, ...change }, 'pointillism'), pattern);
  const file = (name, hash = 'd'.repeat(64)) => ({ files: { ...good.files, [name]: hash } });
  refused({ extra: true }, /^Error: style\.json: unknown key "extra"$/);
  assert.throws(() => styles.validateManifest(JSON.parse('{"__proto__": 1}'), 'pointillism'), /unknown key "__proto__"/);
  assert.throws(() => styles.validateManifest((({ summary, ...rest }) => rest)(good), 'pointillism'), /missing key "summary"/);
  assert.throws(() => styles.validateManifest([], 'pointillism'), /must be a JSON object/);
  refused({ stylePack: 3 }, /"stylePack" must be 2/);
  refused({ stylePack: 1, piece: 'piece.cjs', sample: 'sample.svg' }, /^Error: style\.json: "stylePack" is 1, a pack that holds a piece and a sample; this library reads format 2, .*npm run styles -- pack$/);
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
  refused({ guide: 'guide.txt' }, /"guide" must name a \.md file/);
  refused({ module: 'marks.mjs' }, /"module" must name a \.cjs or \.js file/);
  refused({ proof: 'proof.json' }, /"proof" must name a \.cjs or \.js file/);
  refused({ module: 'other.cjs' }, /"module" names other\.cjs, which "files" does not list/);
  refused({ proof: 'marks.cjs' }, /"proof" names the module itself/);
  for (const marks of [[], 'dots', ['dots', 7], ['two words']]) refused({ marks }, /"marks" must list the module's function names/);
  refused({ marks: ['dots', 'dots'] }, /"marks" lists a name twice/);
});

test('the scan reads style.json only and lists broken folders with their reason', (t) => {
  const { dir, env } = tempHome(t);
  const pack = makePack(dir);
  // Pack code that ran would throw; listing, resolving and naming never run it.
  rewrite(pack, 'marks.cjs', "throw new Error('pack code ran');\n");
  fs.mkdirSync(path.join(dir, 'styles', 'empty'));
  fs.mkdirSync(path.join(dir, 'styles', 'garbled'));
  fs.writeFileSync(path.join(dir, 'styles', 'garbled', 'style.json'), '{ not json');
  makePack(dir, 'misnamed', { change: { name: 'other' } });
  fs.writeFileSync(path.join(dir, 'styles', 'notes.txt'), 'a loose file is not a pack');
  const { packs, problems } = styles.scan(env);
  assert.deepEqual(packs.map((one) => [one.name, one.source, one.version, one.artifex, one.trusted, one.marks]), [['pointillism', 'installed', '1.0.0', VERSION, false, ['dots', 'dash']]]);
  assert.deepEqual(problems.map((one) => [one.name, one.status]), [['empty', 'broken'], ['garbled', 'broken'], ['misnamed', 'broken']]);
  assert.equal(problems[0].reason, 'no style.json');
  assert.match(problems[1].reason, /^style\.json: not valid JSON/);
  assert.match(problems[2].reason, /"name" is "other" but the folder is "misnamed"/);
  const resolved = styles.resolve('Pointillism', env);
  assert.deepEqual([resolved.module, resolved.proof, resolved.guide], ['marks.cjs', 'proof.cjs', 'guide.md'].map((file) => path.join(pack.folder, file)));
  assert.throws(() => styles.resolve('garbled', env), /the pack in .*garbled is broken: style\.json: not valid JSON/);
  const lines = [];
  styles.list(env, false, (line) => lines.push(line));
  const text = lines.join('\n');
  assert.match(text, new RegExp('^pointillism +installed 1\\.0\\.0, packed with ' + escape(VERSION) + ', not trusted +Pointillism: Dots of unmixed colour\\.\\n +marks: dots, dash\\n +guide: '
    + escape(path.join(pack.folder, 'guide.md')) + ' +module: ' + escape(path.join(pack.folder, 'marks.cjs')) + '$', 'm'));
  assert.match(text, /^papercraft +built in +Papercraft: .+\n +marks: tornEdge, tornSheet, mottle, cutSheet, fibres, fold, script, newsprint\n +guide: .+papercraft\.md +module: .+papercraft\.js$/m);
  assert.match(text, /empty +broken: no style\.json/);
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
    assert.equal(style.module, path.join(styles.STYLES, 'impasto.js'));
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
  // A name is matched against the installed folders' names, never joined into a path.
  for (const name of ['../styles/pointillism', 'styles/pointillism', '.', '..', path.join(dir, 'styles', 'pointillism')]) {
    assert.throws(() => styles.resolve(name, env), { message: /^style: no style named / }, name);
    assert.throws(() => styles.trust(name, env, quiet), { message: /^style: no pack named / }, name);
  }
  // trust names the install folder and what is installed there; built-in styles are not candidates.
  assert.throws(() => styles.trust('nosuch', env, quiet), {
    message: 'style: no pack named "nosuch" is installed in ' + path.join(dir, 'styles') + ' (installed: pointillism). Built-in styles need no trust. Install the pack\'s folder there, then run trust again.',
  });
  assert.equal(fs.existsSync(path.join(dir, 'trust.json')), false, 'a refused name records no trust');
});

test('trust records the hash of style.json and check refuses a pack changed since', async (t) => {
  const { dir, env } = tempHome(t);
  const pack = makePack(dir);
  await assert.rejects(styles.check('pointillism', env, quiet), /pointillism is not trusted\. Read its files in .+, then run: npm --prefix "[^"]+" run styles -- trust pointillism$/);
  const shown = [];
  styles.trust('pointillism', env, (line) => shown.push(line));
  const record = JSON.parse(fs.readFileSync(path.join(dir, 'trust.json'), 'utf8'));
  assert.deepEqual(record, { packs: { pointillism: { version: '1.0.0', sha256: sha(fs.readFileSync(path.join(pack.folder, 'style.json'))) } } });
  assert.equal(styles.scan(env).packs[0].trusted, true);
  const text = shown.join('\n');
  assert.match(text, new RegExp('author: not given; license: not given; packed with Artifex ' + escape(VERSION) + '\\n  marks: dots, dash'));
  for (const file of Object.keys(pack.manifest.files)) {
    const bytes = fs.readFileSync(path.join(pack.folder, file));
    assert.ok(text.includes('  ' + file + '  ' + bytes.length + ' bytes  sha256 ' + sha(bytes)), file);
  }
  assert.match(text, /marks\.cjs .*\n {4}requires: artifex\/core\/rand\.js, \.\/lib\/ink\.js/);
  const lines = [];
  await styles.check('pointillism', env, (line) => lines.push(line));
  assert.deepEqual(lines, ['check pointillism: 4 files match style.json, trusted, its guide has every heading, marks.cjs loads within the pack\'s own files and exports its 2 mark functions, and each draws the same twice inside its proof\'s box on Artifex ' + VERSION]);

  // A new version, even with the same files, must be trusted again.
  pack.manifest.version = '1.0.1';
  pack.write('style.json', JSON.stringify(pack.manifest));
  await assert.rejects(styles.check('pointillism', env, quiet), /pointillism changed since it was trusted as version 1\.0\.0\. Read its files in .+, then run: npm --prefix "[^"]+" run styles -- trust pointillism$/);
  styles.trust('pointillism', env, quiet);
  await styles.check('pointillism', env, quiet);

  // A pack packed on another Artifex version is proved again on this one.
  pack.manifest.artifex = '0.0.1';
  pack.write('style.json', JSON.stringify(pack.manifest));
  styles.trust('pointillism', env, quiet);
  await styles.check('pointillism', env, quiet);

  // Pack code is refused before it runs when it is not the code trusted.
  rewrite(pack, 'marks.cjs', "throw new Error('pack code ran');\n");
  await assert.rejects(styles.check('pointillism', env, quiet), /changed since it was trusted/);
  styles.trust('pointillism', env, quiet);
  await assert.rejects(styles.check('pointillism', env, quiet), /pack code ran/);
});

test('an unknown piece hint points to a style\'s guide and module, and to trust for an untrusted pack', (t) => {
  const { dir, env } = tempHome(t);
  const pack = makePack(dir);
  assert.equal(styles.pieceHint('impasto', env), 'For the built-in style impasto, read ' + path.join(styles.STYLES, 'impasto.md')
    + ' and draw your own piece with the functions in ' + path.join(styles.STYLES, 'impasto.js') + '; for your own piece, pass its path, such as ./impasto.cjs');
  const [guide, module] = ['guide.md', 'marks.cjs'].map((file) => path.join(pack.folder, file));
  assert.equal(styles.pieceHint('Pointillism', env), 'For the style pack pointillism, read its files in ' + pack.folder + ', trust it with ' + require('../tools/piece-input.js').hint('styles', 'trust', 'pointillism') + ', then read '
    + guide + ' and draw your own piece with the functions in ' + module + '; for your own piece, pass its path, such as ./Pointillism.cjs');
  styles.trust('pointillism', env, quiet);
  assert.equal(styles.pieceHint('pointillism', env), 'For the style pack pointillism, read ' + guide + ' and draw your own piece with the functions in ' + module
    + '; for your own piece, pass its path, such as ./pointillism.cjs');
  assert.equal(styles.pieceHint('nosuch', env), 'For your own piece, pass its path, such as ./nosuch.cjs');
  assert.doesNotMatch(styles.pieceHint('pointillism', env), /--style/, 'a style draws nothing by name');
});

test('every use refuses a pack whose files differ from style.json', async (t) => {
  const { dir, env } = tempHome(t);
  const pack = makePack(dir);
  styles.trust('pointillism', env, quiet);
  fs.writeFileSync(path.join(pack.folder, 'lib', 'ink.js'), INK + '// changed\n');
  await assert.rejects(styles.check('pointillism', env, quiet), /^Error: style: pointillism: lib\/ink\.js differs from its hash in style\.json$/);
  assert.throws(() => styles.trust('pointillism', env, quiet), /lib\/ink\.js differs from its hash/);
  fs.writeFileSync(path.join(pack.folder, 'lib', 'ink.js'), INK);
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

test('check loads a pack confined to its own files and refuses marks style.json does not list or a proof that fails', async (t) => {
  const { dir, env } = tempHome(t);
  const reaching = makePack(dir, 'reaching');
  fs.writeFileSync(path.join(dir, 'styles', 'secret.js'), 'module.exports = {};');
  rewrite(reaching, 'lib/ink.js', "require('../../secret.js');\n" + INK);
  styles.trust('reaching', env, quiet);
  await assert.rejects(styles.check('reaching', env, quiet), { message: 'style: lib/ink.js requires ../../secret.js, which is not a listed file of the pack or artifex/core/<file>.js' });
  rewrite(reaching, 'lib/ink.js', "require('node:fs');\n" + INK);
  styles.trust('reaching', env, quiet);
  await assert.rejects(styles.check('reaching', env, quiet), /^Error: style: lib\/ink\.js requires node:fs, which is not a listed file/);

  const more = makePack(dir, 'more');
  rewrite(more, 'marks.cjs', MARKS.replace('module.exports = { dots, dash };', 'module.exports = { dots, dash, spare() {} };'));
  styles.trust('more', env, quiet);
  await assert.rejects(styles.check('more', env, quiet), { message: 'style: more: marks.cjs exports the mark functions dots, dash, spare, but style.json lists dots, dash' });

  const piece = makePack(dir, 'piece');
  rewrite(piece, 'marks.cjs', MARKS.replace('module.exports = { dots, dash };', 'module.exports = { dots, dash, draw() {} };'));
  styles.trust('piece', env, quiet);
  await assert.rejects(styles.check('piece', env, quiet), { message: 'style: marks.cjs exports draw; a style exports the functions that draw its marks, never a piece' });

  const wide = makePack(dir, 'wide');
  rewrite(wide, 'proof.cjs', PROOF.replace('marks.dash(g, 5, 5, 55, 35)', 'marks.dash(g, 5, 5, 75, 35)'));
  styles.trust('wide', env, quiet);
  await assert.rejects(styles.check('wide', env, quiet), { message: 'style: wide: the proof of dash paints at (75, 35), outside its box [0, 0, 60, 40]' });

  const thin = makePack(dir, 'thin');
  rewrite(thin, 'guide.md', '# Thin\n\n## Recipe\n');
  styles.trust('thin', env, quiet);
  await assert.rejects(styles.check('thin', env, quiet), /^Error: style: thin's guide guide\.md has no "## What makes it read as" heading$/);
});

test('a mark proof runs each function twice and refuses a drawing that differs, paints nothing or leaves its box', () => {
  const prove = (marks, proof) => styles.proveMarks((watch) => ({ marks: watch(marks), proof }), Object.keys(marks));
  // Curves, arcs, rounded corners, a transform and pixels, all inside the box.
  const shapes = (g, x, y, s) => {
    g.save(); g.translate(x, y); g.rotate(0.3);
    g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(s, 0, s, s); g.bezierCurveTo(0, s, 0, 0, s / 2, s / 2); g.arc(s / 2, s / 2, s / 4, 0, 3);
    g.arcTo(s, 0, s, s, 2); g.ellipse(0, 0, s / 2, s / 3, 0.5, 0, Math.PI * 2); g.roundRect(-s / 2, -s / 2, s, s, 2); g.stroke(); g.restore();
    const gradient = g.createLinearGradient(0, 0, 1, 1); gradient.addColorStop(0, '#fff');
    g.fillStyle = gradient; g.fillRect(x, y, s, s); g.putImageData(g.createImageData(4, 4), x, y);
  };
  prove({ shapes }, { shapes: { box: [0, 0, 60, 60], draw(g, m) { m.shapes(g, 30, 30, 20); } } });
  const refused = (marks, proof, message) => assert.throws(() => prove(marks, proof), { message });
  const box = [0, 0, 40, 40];
  refused({ dot(g) { g.fillRect(Math.random() * 10, 0, 1, 1); } }, { dot: { box, draw(g, m) { m.dot(g); } } },
    /^the proof of dot draws differently the second time, from call 1: \["fillRect",[\d.]+,0,1,1\] then \["fillRect",[\d.]+,0,1,1\]$/);
  let calls = 0;
  refused({ dot(g) { if (calls++) g.fillStyle = '#000'; g.fillRect(0, 0, 1, 1); } }, { dot: { box, draw(g, m) { m.dot(g); } } },
    'the proof of dot draws differently the second time, from call 1: ["fillRect",0,0,1,1] then ["fillStyle","=","#000"]');
  refused({ edge() { return [[0, 0], [10, 0]]; } }, { edge: { box, draw(g, m) { m.edge(); } } }, 'the proof of edge paints nothing');
  refused({ empty(g) { g.beginPath(); g.fill(); g.fillRect(1, 1, 0, 0); } }, { empty: { box, draw(g, m) { m.empty(g); } } }, 'the proof of empty paints nothing');
  refused({ big(g) { g.fillRect(0, 0, 50, 50); } }, { big: { box, draw(g, m) { m.big(g); } } }, 'the proof of big paints at (50, 0), outside its box [0, 0, 40, 40]');
  refused({ big(g) { g.scale(2); g.fillRect(0, 0, 30, 30); } }, { big: { box, draw(g, m) { m.big(g); } } }, 'the proof of big paints at (60, 0), outside its box [0, 0, 40, 40]');
  refused({ ring(g) { g.beginPath(); g.arc(35, 20, 10, 0, Math.PI * 2); g.stroke(); } }, { ring: { box, draw(g, m) { m.ring(g); } } }, 'the proof of ring paints at (45, 20), outside its box [0, 0, 40, 40]');
  refused({ pixels(g) { g.scale(0.1); g.putImageData(g.createImageData(50, 4), 0, 0); } }, { pixels: { box, draw(g, m) { m.pixels(g); } } }, 'the proof of pixels paints at (50, 0), outside its box [0, 0, 40, 40]');
  refused({ dot(g) { g.fillRect(0, 0, 1, 1); } }, { dot: { box, draw(g) { g.fillRect(0, 0, 1, 1); } } }, 'the proof of dot never calls dot');
  refused({ dot(g) { g.fillRect(0, 0, 1, 1); } }, { dot: { box, draw() { throw new Error('boom'); } } }, 'the proof of dot throws: boom');
  refused({ dot(g) { g.fillRect(0, 0, 1, 1); }, dash() {} }, { dot: { box, draw(g, m) { m.dot(g); } } }, 'its proof has no draw(g, marks) for dash');
  refused({ dot() {} }, { dot: { box, draw(g, m) { m.dot(g); } }, gone: { box, draw() {} } }, 'its proof names gone, which its module does not export as a function');
  for (const bad of [[0, 0, 0, 10], [0, 0, 10], [0, 0, NaN, 10], 'all']) {
    refused({ dot() {} }, { dot: { box: bad, draw(g, m) { m.dot(g); } } }, 'the proof of dot needs a box [x, y, w, h] of finite numbers, w and h above 0');
  }
  refused({ dot() {} }, null, 'its proof exports no object of proofs');
});

test('a mark proof compares every value of an object it is given, refuses an image it cannot compare and checks the box on every run', () => {
  const prove = (marks, proof) => styles.proveMarks((watch) => ({ marks: watch(marks), proof }), Object.keys(marks));
  const refused = (marks, proof, message) => assert.throws(() => prove(marks, proof), { message });
  const box = [0, 0, 40, 40];
  let n = 0;
  refused({ moved(g) { n++; g.setTransform({ a: 1, b: 0, c: 0, d: 1, e: n, f: 0 }); g.fillRect(0, 0, 1, 1); } }, { moved: { box, draw(g, m) { m.moved(g); } } },
    'the proof of moved draws differently the second time, from call 1: ["setTransform",{"a":1,"b":0,"c":0,"d":1,"e":1,"f":0}] then ["setTransform",{"a":1,"b":0,"c":0,"d":1,"e":2,"f":0}]');
  // A real canvas takes no image data in drawImage, and any other source's pixels cannot be compared.
  for (const source of [{ width: 4, height: 4 }, { width: 4, height: 4, data: new Uint8ClampedArray(64) }]) {
    refused({ blit(g) { g.drawImage(source, 0, 0); } }, { blit: { box, draw(g, m) { m.blit(g); } } },
      'the proof of blit throws: drawImage cannot be proved, since a canvas or image source\'s pixels cannot be compared and image data is no drawImage source; place pixels with putImageData');
  }
  // A Map, a Set or a value it does not enumerate logs by what it holds.
  for (const make of [(n) => new Map([['n', n]]), (n) => new Set([n]), (n) => Object.defineProperty({}, 'n', { value: n })]) {
    let k = 0;
    refused({ dot(g) { g.fillStyle = make(k++); g.fillRect(0, 0, 1, 1); } }, { dot: { box, draw(g, m) { m.dot(g); } } }, /^the proof of dot draws differently the second time, from call 1: /);
  }
  // A visible shadow lands its offset away in canvas pixels; a clear one, or pixels put in place, cast none.
  refused({ dot(g) { g.shadowColor = '#000'; g.shadowOffsetX = 500; g.scale(0.5); g.fillRect(0, 0, 4, 4); } }, { dot: { box, draw(g, m) { m.dot(g); } } },
    'the proof of dot paints at (500, 0), outside its box [0, 0, 40, 40]');
  refused({ dot(g) { g.shadowColor = 'rgb(0 0 0 / 0.5)'; g.shadowOffsetY = -1; g.fillRect(0, 0, 4, 4); } }, { dot: { box, draw(g, m) { m.dot(g); } } },
    'the proof of dot paints at (0, -1), outside its box [0, 0, 40, 40]');
  for (const colour of ['rgba(0, 0, 0, 0)', 'transparent', '#0000', '#00000000', 'hsl(0 0% 0% / 0%)', 'rgba(9,9,9,0.0)']) {
    prove({ dot(g) { g.shadowColor = colour; g.shadowOffsetX = 500; g.fillRect(0, 0, 4, 4); } }, { dot: { box, draw(g, m) { m.dot(g); } } });
  }
  prove({ dot(g) { g.shadowColor = '#000'; g.shadowOffsetX = 500; g.putImageData(g.createImageData(4, 4), 0, 0); } }, { dot: { box, draw(g, m) { m.dot(g); } } });
  // Clearing paints nothing but must stay inside the box.
  refused({ dot(g) { g.clearRect(0, 0, 1e4, 1e4); g.fillRect(0, 0, 4, 4); } }, { dot: { box, draw(g, m) { m.dot(g); } } },
    'the proof of dot paints at (10000, 0), outside its box [0, 0, 40, 40]');
  refused({ dot(g) { g.clearRect(0, 0, 4, 4); } }, { dot: { box, draw(g, m) { m.dot(g); } } }, 'the proof of dot paints nothing');
  // The matrix logs alike every run, but from the second run on it moves when setTransform reads it.
  let calls = 0;
  refused({ dot(g) {
    calls++;
    let reads = 0;
    g.setTransform({ a: 1, b: 0, c: 0, d: 1, f: 0, get e() { return reads++ && calls > 1 ? 50 : 0; } });
    g.fillRect(0, 0, 1, 1);
  } }, { dot: { box, draw(g, m) { m.dot(g); } } }, 'the proof of dot paints at (50, 0), outside its box [0, 0, 40, 40]');
});

test('check proves each run from a fresh load of the pack, and counts a call the proof makes through its own require of the module', async (t) => {
  const { dir, env } = tempHome(t);
  const one = (name, marks, proof) => {
    makePack(dir, name, { extra: { 'marks.cjs': marks, 'proof.cjs': proof }, change: { marks: ['dot'] } });
    styles.trust(name, env, quiet);
  };
  const required = "const { dot } = require('./marks.cjs');\nmodule.exports = { dot: { box: [0, 0, 4, 4], draw(g) { dot(g, 1, 1); } } };\n";
  one('required', 'module.exports = { dot(g, x, y) { g.fillRect(x, y, 1, 1); } };\n', required);
  await styles.check('required', env, quiet);
  // A value taken when the module loads differs between loads, as it does between pieces.
  one('loaded', 'const j = Math.random();\nmodule.exports = { dot(g, x, y) { g.fillRect(x + j, y, 1, 1); } };\n', required);
  await assert.rejects(styles.check('loaded', env, quiet), /^Error: style: loaded: the proof of dot draws differently the second time, from call 1: /);
});

test('check draws each proof again on the same load, so a mark that keeps state between calls is refused', async (t) => {
  const { dir, env } = tempHome(t);
  // A fresh load resets the counter, so only a second draw on one load sees it move.
  makePack(dir, 'counting', { extra: {
    'marks.cjs': 'let n = 0;\nmodule.exports = { dot(g, x, y) { n++; g.fillRect(x + n, y, 1, 1); } };\n',
    'proof.cjs': "const { dot } = require('./marks.cjs');\nmodule.exports = { dot: { box: [0, 0, 8, 8], draw(g) { dot(g, 1, 1); } } };\n",
  }, change: { marks: ['dot'] } });
  styles.trust('counting', env, quiet);
  await assert.rejects(styles.check('counting', env, quiet),
    { message: 'style: counting: the proof of dot draws differently the second time, from call 1: ["fillRect",2,1,1,1] then ["fillRect",3,1,1,1]' });
});

test('a built-in style checks as mark functions and a guide with every heading, and refuses a piece', async (t) => {
  const env = { ARTIFEX_HOME: path.join(os.tmpdir(), 'artifex-styles-absent') };
  for (const style of styles.builtins()) {
    const lines = [];
    await styles.check(style.name, env, (line) => lines.push(line));
    assert.match(lines.join('\n'), new RegExp('^check ' + style.name + ': built in; its module exports \\d+ mark functions and no piece, and its guide has every heading$'));
  }
  const marks = require.resolve(path.join(styles.STYLES, 'papercraft.js'));
  const real = require(marks);
  require.cache[marks].exports = { ...real, draw() {} };
  t.after(() => { require.cache[marks].exports = real; });
  await assert.rejects(styles.check('papercraft', env, quiet), { message: 'style: ' + marks + ' exports draw; a style exports the functions that draw its marks, never a piece' });
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
  const folder = path.join(dir, 'styles', 'pointillism');
  assert.deepEqual(report.styles.at(-1), {
    name: 'pointillism', title: 'Pointillism', summary: 'Dots of unmixed colour.', source: 'installed',
    guide: path.join(folder, 'guide.md'), module: path.join(folder, 'marks.cjs'), marks: ['dots', 'dash'], proof: path.join(folder, 'proof.cjs'),
    version: '1.0.0', artifex: VERSION, trusted: false, folder,
  });
  assert.deepEqual(report.styles[0], {
    name: 'papercraft', title: 'Papercraft', summary: styles.builtins()[0].summary, source: 'builtin',
    guide: path.join(styles.STYLES, 'papercraft.md'), module: path.join(styles.STYLES, 'papercraft.js'), marks: styles.markNames(require(path.join(styles.STYLES, 'papercraft.js')), 'papercraft.js'),
  });
  assert.deepEqual(report.problems, []);
  assert.equal(run('--json').stdout, json.stdout);
  const unknown = run('check', 'puntillismo');
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /no style named "puntillismo"\. Available: .*pointillism \(installed\)/);
  const untrusted = run('check', 'pointillism');
  assert.equal(untrusted.status, 1);
  assert.match(untrusted.stderr, /npm --prefix "[^"]+" run styles -- trust pointillism/);
  for (const args of [['check'], ['trust', 'a', 'b'], ['list', '--all'], ['remove', 'pointillism']]) {
    assert.match(run(...args).stderr, /^styles: .+\nusage: npm run styles /, args.join(' '));
  }
});

test('--style draws nothing: page and seeds refuse it by exit code with the style\'s guide and module, and write nothing', (t) => {
  const { dir, env } = tempHome(t);
  // A name of this run's own, so parallel runs never share an output file.
  const name = 'pointillism-' + process.pid;
  makePack(dir, name);
  styles.trust(name, env, quiet);
  const out = path.join(ROOT, 'out');
  const written = () => (fs.existsSync(out) ? fs.readdirSync(out).filter((file) => file.startsWith('style-' + name)) : []);
  const run = (tool, ...args) => spawnSync(process.execPath, [path.join(ROOT, 'tools', tool), ...args],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ARTIFEX_HOME: dir }, timeout: 120000 });
  const folder = path.join(dir, 'styles', name);
  const cause = '--style draws nothing, since a style is a guide and the functions that draw its marks, not a picture. For the style pack ' + name + ', read '
    + path.join(folder, 'guide.md') + ' and draw your own piece with the functions in ' + path.join(folder, 'marks.cjs') + '; nothing was written';
  assert.equal(styles.styleCause(name.toUpperCase(), env), cause);
  assert.equal(styles.styleCause('impasto', env), '--style draws nothing, since a style is a guide and the functions that draw its marks, not a picture. For the built-in style impasto, read '
    + path.join(styles.STYLES, 'impasto.md') + ' and draw your own piece with the functions in ' + path.join(styles.STYLES, 'impasto.js') + '; nothing was written');
  for (const [tool, prefix, args] of [['build-page.js', 'page', []], ['contact-sheet.js', 'seeds', ['2', '0.5']]]) {
    const refused = run(tool, '--style', name, ...args);
    assert.equal(refused.status, 1, tool);
    assert.match(refused.stderr, new RegExp('^' + escape(prefix + ': ' + cause) + '\\nusage: [^\\n]+\\n$'), tool);
    const unknown = run(tool, '--style', 'puntillismo', ...args);
    assert.equal(unknown.status, 1, tool);
    assert.match(unknown.stderr, new RegExp('^' + prefix + ': --style draws nothing, since a style is a guide and the functions that draw its marks, not a picture; no style named "puntillismo"\\. Available: backlit-silhouette, cad, .*\\(built in\\); ' + name + ' \\(installed\\)\\. Packs are installed in .+\\nusage: '), tool);
  }
  assert.deepEqual(written(), [], 'a refused style writes nothing');
});

const LIBRARY = ROOT.split(path.sep).join('/');

/** A project folder holding `files`, as a style's author keeps it before packing. */
function project(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-project-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  }
  return dir;
}

/** An author's project with the pack's module, helper, proof and guide. */
const authored = (t, extra = {}) => project(t, { 'marks.js': MARKS.replace('./lib/ink.js', './ink.js'), 'ink.js': INK, 'proof.js': PROOF, 'guide.md': GUIDE, ...extra });

test('pack copies a module, its proof and the files they reach into marks.cjs, proof.cjs and lib/, rewriting their requires', (t) => {
  const dir = project(t, {
    'dotted.js': "#!/usr/bin/env node\nconst { rng } = require('artifex/core/rand.js');\n"
      + "const { lerp } = require('" + LIBRARY + "/core/num.js');\nconst font = require(\"" + LIBRARY + "/examples/stroke-font.js\");\n"
      + "const { ink } = require('./lib/ink.js');\nconst more = require('./more/ink');\nconst data = require('./data.json');\nconst tear = require('artifex/styles/papercraft.js');\n"
      + 'module.exports = { dot(g, x, y) { g.fillStyle = ink; g.fillRect(lerp(x, x, 0), y, 1, 1); } };\n',
    'lib/ink.js': INK,
    'more/ink.js': "const data = require('../data.json');\nmodule.exports = { ink: data.ink };\n",
    'data.json': '{ "ink": "#295c7b" }\n',
    'check.js': "const { dot } = require('./dotted.js');\nmodule.exports = { dot: { box: [0, 0, 4, 4], draw(g) { dot(g, 1, 1); } } };\n",
  });
  const sources = styles.packSources([[path.join(dir, 'dotted.js'), 'marks.cjs'], [path.join(dir, 'check.js'), 'proof.cjs']]);
  assert.deepEqual(Object.keys(sources).sort(), ['lib/data.json', 'lib/ink-2.js', 'lib/ink.js', 'lib/kit.js', 'lib/papercraft.js', 'marks.cjs', 'proof.cjs']);
  assert.equal(sources['marks.cjs'], "\nconst { rng } = require(\"artifex/core/rand.js\");\nconst { lerp } = require(\"artifex/core/num.js\");\n"
    + "const font = require(\"artifex/core/stroke-font.js\");\nconst { ink } = require(\"./lib/ink.js\");\n"
    + "const more = require(\"./lib/ink-2.js\");\nconst data = require(\"./lib/data.json\");\nconst tear = require(\"./lib/papercraft.js\");\n"
    + 'module.exports = { dot(g, x, y) { g.fillStyle = ink; g.fillRect(lerp(x, x, 0), y, 1, 1); } };\n');
  assert.equal(sources['proof.cjs'], "const { dot } = require(\"./marks.cjs\");\nmodule.exports = { dot: { box: [0, 0, 4, 4], draw(g) { dot(g, 1, 1); } } };\n");
  assert.equal(sources['lib/ink-2.js'], "const data = require(\"./data.json\");\nmodule.exports = { ink: data.ink };\n");
  assert.equal(sources['lib/papercraft.js'].includes('require("artifex/core/rand.js")'), true, 'a built-in style\'s marks are copied, requiring core by name');

  const reaching = project(t, { 'drift.js': "module.exports = require('" + LIBRARY + "/examples/drift.js');\n" });
  assert.throws(() => styles.packSources([[path.join(reaching, 'drift.js'), 'marks.cjs']]),
    /requires .*drift\.js, the library file examples\/drift\.js; a pack may require only its own files and artifex\/core\/<file>\.js$/);
});

test('a pack guide needs a title and the built-in guides\' headings in order', () => {
  assert.equal(styles.guideProblem(GUIDE), null);
  for (const style of styles.builtins()) assert.equal(styles.guideProblem(fs.readFileSync(style.guide, 'utf8')), null, style.name);
  assert.equal(styles.guideProblem(GUIDE.replace('\n## Palette\n\nTwo.\n', '')), null, 'Palette is not required');
  assert.equal(styles.guideProblem(GUIDE.replace('# Pointillism', 'Pointillism')), 'has no "# " title');
  assert.equal(styles.guideProblem(GUIDE.replace('## What makes it read as pointillism', '## Why dots')), 'has no "## What makes it read as" heading');
  assert.equal(styles.guideProblem(GUIDE.replace('## Pitfalls', '## Mistakes')), 'has no "## Pitfalls" heading after "## Creative direction"');
  assert.equal(styles.guideProblem(GUIDE.replace('## Creative direction', '## Mood')), 'has no "## Creative direction" heading after "## Marks"');
  const swapped = GUIDE.replace('## Marks', '## Held').replace('## Pitfalls', '## Pitfalls\n\n## Marks');
  assert.equal(styles.guideProblem(swapped), 'has no "## Creative direction" heading after "## Marks"');
});

test('pack writes style.json, proves each mark from the staged copy, then installs and trusts the pack', async (t) => {
  const { dir, env } = tempHome(t);
  const author = authored(t);
  const shown = [];
  await styles.pack({ marks: path.join(author, 'marks.js'), proof: path.join(author, 'proof.js'), name: 'pointillism', guide: path.join(author, 'guide.md'), summary: 'Dots of unmixed colour.', license: 'MIT' },
    env, (line) => shown.push(line));
  const folder = path.join(dir, 'styles', 'pointillism');
  const read = (file) => fs.readFileSync(path.join(folder, file));
  assert.equal(read('guide.md').toString('utf8'), GUIDE);
  assert.equal(read('lib/ink.js').toString('utf8'), INK);
  assert.equal(read('marks.cjs').toString('utf8'), MARKS.replace("'./lib/ink.js'", '"./lib/ink.js"').replace("require('artifex/core/rand.js')", 'require("artifex/core/rand.js")'));
  assert.equal(read('proof.cjs').toString('utf8'), PROOF);
  const manifest = JSON.parse(read('style.json'));
  assert.deepEqual(manifest, {
    stylePack: 2, name: 'pointillism', title: 'Pointillism', version: '1.0.0', artifex: VERSION, summary: 'Dots of unmixed colour.', license: 'MIT',
    guide: 'guide.md', module: 'marks.cjs', proof: 'proof.cjs', marks: ['dots', 'dash'],
    files: Object.fromEntries(['lib/ink.js', 'marks.cjs', 'proof.cjs', 'guide.md'].map((file) => [file, sha(read(file))])),
  });
  assert.deepEqual(fs.readdirSync(folder).sort(), ['guide.md', 'lib', 'marks.cjs', 'proof.cjs', 'style.json'], 'no picture, sample or piece');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'trust.json'), 'utf8')), { packs: { pointillism: { version: '1.0.0', sha256: sha(read('style.json')) } } });
  assert.equal(shown[0], 'pack pointillism: 4 files in ' + folder + '; each of its 2 marks draws the same twice inside its proof\'s box');
  assert.match(shown.at(-1), /^Trusted pointillism 1\.0\.0 /);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['styles', 'trust.json'], 'no build folder is left');
  await styles.check('pointillism', env, quiet);

  // --replace installs a new pack in the old one's place, and trusts it.
  await styles.pack({ marks: path.join(author, 'marks.js'), proof: path.join(author, 'proof.js'), name: 'pointillism', guide: path.join(author, 'guide.md'), summary: 'Dots.', title: 'Dots', version: '2.0.0', replace: true }, env, quiet);
  assert.deepEqual([JSON.parse(read('style.json')).title, JSON.parse(read('style.json')).version], ['Dots', '2.0.0']);
  assert.equal(styles.scan(env).packs[0].trusted, true);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['styles', 'trust.json']);
});

test('pack copies a required built-in style module and kit.js into lib/, and the pack checks from a clean copy', async (t) => {
  const { dir, env } = tempHome(t);
  const author = project(t, {
    'marks.js': "const { fold } = require('artifex/styles/papercraft.js');\n"
      + '// A crease along (x0, y0)-(x1, y1).\nfunction crease(g, x0, y0, x1, y1) { fold(g, [[x0, y0], [x1, y1]]); }\nmodule.exports = { crease };\n',
    'proof.js': 'module.exports = { crease: { box: [0, 0, 40, 40], draw(g, marks) { marks.crease(g, 5, 5, 35, 35); } } };\n',
    'guide.md': GUIDE,
  });
  await styles.pack({ marks: path.join(author, 'marks.js'), proof: path.join(author, 'proof.js'), name: 'creased', guide: path.join(author, 'guide.md'), summary: 'Creases.' }, env, quiet);
  const folder = path.join(dir, 'styles', 'creased');
  const read = (file) => fs.readFileSync(path.join(folder, file), 'utf8');
  assert.deepEqual(Object.keys(JSON.parse(read('style.json')).files).sort(), ['guide.md', 'lib/kit.js', 'lib/papercraft.js', 'marks.cjs', 'proof.cjs']);
  assert.match(read('marks.cjs'), /^const \{ fold \} = require\("\.\/lib\/papercraft\.js"\);/);
  assert.match(read('lib/papercraft.js'), /require\("\.\/kit\.js"\)/);
  assert.match(read('lib/papercraft.js'), /require\("artifex\/core\/rand\.js"\)/);
  assert.match(read('lib/kit.js'), /require\("artifex\/core\/geom\.js"\)/);
  for (const file of ['lib/papercraft.js', 'lib/kit.js']) assert.doesNotMatch(read(file), /\.\.\/core\//, file + ' reaches no library path');

  // A clean copy in another home, with the author's project gone, trusts and checks.
  fs.rmSync(author, { recursive: true, force: true });
  const other = tempHome(t);
  fs.cpSync(folder, path.join(other.dir, 'styles', 'creased'), { recursive: true });
  styles.trust('creased', other.env, quiet);
  const shown = [];
  await styles.check('creased', other.env, (line) => shown.push(line));
  assert.match(shown.at(-1), /^check creased: 5 files match style\.json, trusted, .* exports its 1 mark functions/);
});

test('pack refuses by name and writes nothing', async (t) => {
  const { dir, env } = tempHome(t);
  const author = authored(t, { 'thin.md': '# Thin\n\n## Recipe\n', 'piece.js': "module.exports = { name: 'dotted', size: { w: 9, h: 9 }, draw() {} };\n", 'none.js': 'module.exports = { ink: 1 };\n' });
  const options = { marks: path.join(author, 'marks.js'), proof: path.join(author, 'proof.js'), name: 'pointillism', guide: path.join(author, 'guide.md'), summary: 'Dots.' };
  const refused = (change, pattern) => assert.rejects(styles.pack({ ...options, ...change }, env, quiet), pattern);
  await refused({ name: 'Pointillism' }, /^Error: pack: the name must be lowercase kebab-case, at most 40 characters, not "Pointillism"$/);
  await refused({ name: 'a'.repeat(41) }, /at most 40 characters/);
  // A name is a folder under styles/, so one that climbs out of it is refused before it forms a path.
  const escaped = '../../' + path.basename(dir) + '-escape';
  for (const name of [escaped, '..', 'a/b', 'a\\b', path.join(dir, 'abs')]) await refused({ name }, /the name must be lowercase kebab-case/);
  assert.equal(fs.existsSync(path.join(dir, escaped.slice(3))), false, 'nothing is written beside ARTIFEX_HOME');
  await refused({ name: 'impasto' }, /^Error: pack: "impasto" is a built-in style's name; choose another$/);
  await refused({ guide: path.join(author, 'thin.md') }, /thin\.md has no "## What makes it read as" heading; a guide has "# <title>", then "## What makes it read as", "## Marks", "## Creative direction", "## Pitfalls", in that order$/);
  await refused({ proof: path.join(author, 'marks.js') }, /^Error: pack: --proof names the module of mark functions itself; a proof is a file of its own$/);
  await refused({ marks: path.join(author, 'absent.js') }, /^Error: pack: cannot load .*absent\.js: /);
  await refused({ marks: path.join(author, 'piece.js') }, /^Error: pack: .*piece\.js exports draw, name, size; a style exports the functions that draw its marks, never a piece$/);
  await refused({ marks: path.join(author, 'none.js') }, /^Error: pack: .*none\.js exports no function$/);
  assert.deepEqual(fs.readdirSync(dir), [], 'a refused pack writes nothing');
  const existing = makePack(dir);
  await refused({}, /pointillism exists; pass --replace to replace it$/);
  fs.rmSync(existing.folder, { recursive: true });
  fs.symlinkSync(author, existing.folder, 'junction');
  await refused({ replace: true }, /pointillism is a link; remove it yourself first$/);
  assert.deepEqual(fs.readdirSync(author).sort(), ['guide.md', 'ink.js', 'marks.js', 'none.js', 'piece.js', 'proof.js', 'thin.md'], 'a linked folder is left alone');
  const usage = /^Error: styles pack: .+\nusage: npm run styles -- pack <marks\.js> --proof <proof\.js> --name <name> --guide <guide\.md> --summary <text> /;
  for (const args of [['pack'], ['pack', 'marks.js'], ['pack', 'marks.js', '--name', 'dots', '--guide', 'guide.md', '--summary', 's'], ['pack', 'a.js', 'b.js', '--proof', 'p.js', '--name', 'dots', '--guide', 'g.md', '--summary', 's'],
    ['pack', 'marks.js', '--proof', 'p.js', '--name', 'dots', '--guide', 'guide.md', '--summary', 's', '--seed', '3'], ['pack', 'marks.js', '--summary']]) {
    await assert.rejects(styles.main(args, env, quiet), usage, args.join(' '));
  }
  assert.deepEqual(styles.packArgs(['marks.js', '--proof', 'p.js', '--name', 'dots', '--guide', 'g.md', '--summary', 's', '--replace']),
    { replace: true, marks: 'marks.js', proof: 'p.js', name: 'dots', guide: 'g.md', summary: 's' });
});

test('Windows device names are refused as a pack name and in every style.json path segment', async (t) => {
  // Git for Windows refuses to index these names, whatever their case, extension
  // or spaces before the dot, and older Windows opens the device instead of the file.
  // Git for Windows 2.55 also refuses CONIN$, CONOUT$ and LPT0, and COM or LPT
  // with a superscript 1 to 3 when alone, which Windows opens as a device.
  const devices = ['con', 'prn', 'aux', 'nul', 'conin$', 'conout$', 'lpt0', ...'123456789'.split('').flatMap((n) => ['com' + n, 'lpt' + n])];
  const superscripts = ['com¹', 'com²', 'com³', 'lpt¹', 'lpt²', 'lpt³'];
  const manifest = (name, file = 'dots.js') => ({
    stylePack: 2, name, title: 'Dots', version: '1.0.0', artifex: VERSION, summary: 'Dots.', guide: 'guide.md', module: 'marks.cjs', proof: 'proof.cjs', marks: ['dots'],
    files: Object.fromEntries(['marks.cjs', 'guide.md', 'proof.cjs', file].map((one) => [one, 'a'.repeat(64)])),
  });
  const { dir, env } = tempHome(t);
  const author = authored(t);
  const segments = (device) => {
    const upper = device.toUpperCase(), mixed = upper[0] + device.slice(1);
    const alone = [[device, device], ['lib/' + mixed + '/dots.js', mixed]];
    return superscripts.includes(device) ? alone
      : [...alone, ['lib/' + upper + '.js', upper + '.js'], ['lib/' + device + '.tar.gz', device + '.tar.gz'], [device + ' .json/dots.js', device + ' .json']];
  };
  for (const device of [...devices, ...superscripts]) {
    const upper = device.toUpperCase();
    // Only a kebab-case device can reach the device rule as a pack name.
    if (/^[a-z0-9]+$/.test(device)) {
      assert.throws(() => styles.validateManifest(manifest(device), device),
        new RegExp('^Error: style\\.json: "name" is "' + device + '", which Windows reads as the device ' + upper + '$'));
      await assert.rejects(styles.pack({ marks: path.join(author, 'marks.js'), proof: path.join(author, 'proof.js'), name: device, guide: path.join(author, 'guide.md'), summary: 'Dots.' }, env, quiet),
        new RegExp('^Error: pack: the name is "' + device + '", which Windows reads as the device ' + upper + '; choose another$'));
    }
    for (const [file, segment] of segments(device)) {
      assert.equal(styles.pathProblem(file), 'has a segment that is "' + segment + '", which Windows reads as the device ' + upper, file);
      assert.throws(() => styles.validateManifest(manifest('dots', file), 'dots'), new RegExp('^Error: style\\.json: files: "' + escape(file) + '" has a segment that is '));
    }
  }
  assert.deepEqual(fs.readdirSync(dir), [], 'a refused pack writes nothing');
  // A device name inside a longer name, or after a dot, is an ordinary name, as
  // are COM0 and a superscript COM or LPT before an extension, which Windows,
  // Git for Windows and Windows tar all take as files.
  for (const name of ['con-x', 'x-con', 'auxx', 'com10', 'com0', 'lpt10', 'nul1']) assert.equal(styles.validateManifest(manifest(name), name).name, name);
  for (const file of ['lib/con-x.js', 'lib/auxx.js', 'lib/com0.js', 'lib/x.con', 'lib/x.aux.js', 'console/dots.js', 'lib/conin.js', 'lib/com¹.js', 'lib/lpt³.tar.gz', 'lib/com¹0']) {
    assert.equal(styles.pathProblem(file), null, file);
  }
});

test('pack refuses a helper whose lib/ name style.json would refuse before staging anything, naming its source file', async (t) => {
  const { dir, env } = tempHome(t);
  for (const helper of ['aux.min.js', 'CON.js', 'lpt0.js']) {
    const author = authored(t, { 'marks.js': MARKS.replace('./lib/ink.js', './helpers/' + helper), ['helpers/' + helper]: INK });
    // The loader names a helper by its real path, which a linked temporary folder changes.
    const source = path.join(fs.realpathSync(author), 'helpers', helper);
    const device = /^[a-z]+\d?/i.exec(helper)[0].toUpperCase();
    await assert.rejects(styles.pack({ marks: path.join(author, 'marks.js'), proof: path.join(author, 'proof.js'), name: 'dots', guide: path.join(author, 'guide.md'), summary: 'Dots.' }, env, quiet),
      { message: 'pack: ' + source + ' would be packed as lib/' + helper + ', a path that has a segment that is "' + helper + '", which Windows reads as the device ' + device + '; rename the file' });
  }
  assert.deepEqual(fs.readdirSync(dir), [], 'nothing is staged');
  // Names another system's files can carry but Windows cannot hold, so given as strings.
  const character = 'holds a character a file name cannot hold on every system', trailing = 'ends a name with a dot or a space, which Windows drops';
  for (const [helper, name, problem] of [['a:b.js', 'lib/a:b.js', character], ['dots*.js', 'lib/dots*.js', character], ['dots?.js', 'lib/dots?.js', character],
    ['"dots".js', 'lib/"dots".js', character], ['<dots>.js', 'lib/<dots>.js', character], ['a|b.js', 'lib/a|b.js', character], ['a\tb.js', 'lib/a\tb.js', character],
    ['dots.', 'lib/dots.', trailing], ['dots ', 'lib/dots ', trailing], ['dots.JS ', 'lib/dots.js ', trailing]]) {
    const file = path.join(os.tmpdir(), 'helpers', helper);
    assert.throws(() => styles.helperName(file), { message: 'pack: ' + file + ' would be packed as ' + name + ', a path that ' + problem + '; rename the file' }, helper);
  }
  assert.equal(styles.helperName(path.join(os.tmpdir(), 'helpers', 'Dots.min.JS')), 'lib/Dots.min.js');
});

test('pack removes its own output when a mark is not proved, and keeps the pack it would replace', async (t) => {
  const { dir, env } = tempHome(t);
  // Each call moves the dash, so the second run can never match the first.
  const restless = MARKS.replace('g.moveTo(x0, y0)', 'globalThis.__artifexRestless = (globalThis.__artifexRestless || 0) + 1; g.moveTo(x0 + globalThis.__artifexRestless % 2, y0)');
  const author = authored(t, { 'marks.js': restless.replace('./lib/ink.js', './ink.js') });
  t.after(() => { delete globalThis.__artifexRestless; });
  const options = { marks: path.join(author, 'marks.js'), proof: path.join(author, 'proof.js'), name: 'restless', guide: path.join(author, 'guide.md'), summary: 'Never still.' };
  await assert.rejects(styles.pack(options, env, quiet),
    /^Error: pack: restless: nothing was installed, since the proof of dash draws differently the second time, from call 3: \["moveTo",\d+,5\] then \["moveTo",\d+,5\]$/);
  assert.deepEqual(fs.readdirSync(dir), [], 'nothing is left in ARTIFEX_HOME');

  const old = makePack(dir, 'restless');
  styles.trust('restless', env, quiet);
  const before = fs.readFileSync(path.join(dir, 'trust.json'), 'utf8');
  await assert.rejects(styles.pack({ ...options, replace: true }, env, quiet), /nothing was installed, since the proof of dash draws differently/);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['styles', 'trust.json']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(old.folder, 'style.json'), 'utf8')), old.manifest, 'the old pack is kept');
  assert.equal(fs.readFileSync(path.join(dir, 'trust.json'), 'utf8'), before, 'and its trust');
  await styles.check('restless', env, quiet);
});

test('pack --replace restores the old pack and its trust when installing the new one fails', async (t) => {
  const { dir, env } = tempHome(t);
  const author = authored(t);
  const options = { marks: path.join(author, 'marks.js'), proof: path.join(author, 'proof.js'), name: 'pointillism', guide: path.join(author, 'guide.md'), summary: 'Dots.', version: '2.0.0', replace: true };
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

test('gouache mixes a short hex paint as its long form, and refuses a colour it cannot read', () => {
  const { mix, ramp, tone } = require('../skills/artifex/styles/gouache.js');
  assert.equal(mix('#ffcc00', '#ffffff', 0.18), '#ffd52e');
  assert.equal(mix('#fc0', '#fff', 0.18), '#ffd52e', 'a short hex is read as its long form');
  assert.equal(mix('#ffcc0080', '#ffffff', 0.18), '#ffd52e', 'the alpha is dropped');
  assert.equal(ramp(['#000', '#fff'], 0.5), '#808080');
  assert.equal(tone('#fc0', 0.5), tone('#ffcc00', 0.5));
  assert.throws(() => mix('gold', '#ffffff', 0.5), /colour: expected #rgb, #rrggbb or #rrggbbaa, got "gold"/);
});

test('a banded gouache sky clips its seams to its box', () => {
  const { sky } = require('../skills/artifex/styles/gouache.js');
  const log = [];
  const g = new Proxy({}, {
    get: (_, key) => key === 'createLinearGradient' ? () => ({ addColorStop() {} }) : (...args) => { log.push([key, ...args]); },
    set: () => true,
  });
  sky(g, () => 0.5, 'sky', 10, 20, 100, 60, ['#123456', '#abcdef'], { bands: 3, streak: 0 });
  const clip = log.findIndex((e) => e[0] === 'clip');
  assert.ok(clip > 0, 'the sky clips');
  assert.deepEqual(log[clip - 1], ['rect', 10, 20, 100, 60]);
  assert.equal(log.findIndex((e) => e[0] === 'stroke'), log.findIndex((e, i) => i > clip && e[0] === 'stroke'), 'no seam is stroked before the clip');
  assert.ok(log.some((e) => e[0] === 'stroke'), 'the seams are stroked');
});

// A context under a transform of `scale` with no canvas: every fill and
// stroke with its path and whether a clip of no area hides it, every clip
// with its path, every clip that has area as `inClip`, and every filter set.
function washLog(scale = 1) {
  const log = []; const stack = []; let poly = []; let state = { hidden: false, inClip: false };
  const area = (p) => Math.abs(p.reduce((s, [x, y], i) => s + x * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * y, 0)) / 2;
  const g = new Proxy({}, {
    get: (_, key) => {
      if (key === 'canvas') return undefined;
      if (key === 'getTransform') return () => ({ a: scale, b: 0, c: 0, d: scale, e: 0, f: 0 });
      return (...args) => {
        if (key === 'beginPath') poly = [];
        else if (key === 'moveTo' || key === 'lineTo') poly.push(args);
        else if (key === 'save') stack.push(state);
        else if (key === 'restore') state = stack.pop();
        else if (key === 'clip') state = area(poly) < 1e-9 ? { ...state, hidden: true } : { ...state, inClip: true };
        if (key === 'fill' || key === 'stroke' || key === 'clip') log.push({ key, poly, ...state });
      };
    },
    set: (_, key, value) => { if (key === 'filter') log.push({ key, value }); return true; },
  });
  return { g, log, area };
}

test('watercolour wash and confine: a collapsed outline draws nothing and throws nothing, a graded wash pools out to its widest pooled layer, a large softened reserve wanders no further than a small one, the feather scales with the output', () => {
  const { wash, confine } = require('../skills/artifex/styles/watercolour.js');
  const { rng } = require('../core/rand.js');
  const point = [[5, 5], [5, 5], [5, 5]];
  for (const opts of [{ layers: 6 }, { layers: 6, wet: 3, rim: 0.2 }]) {
    const { g, log, area } = washLog();
    wash(g, rng(1), 'point', point, '#3e55a8', opts);
    const seen = log.filter((e) => (e.key === 'fill' || e.key === 'stroke') && !e.hidden && area(e.poly) > 1e-9);
    assert.equal(seen.length, 0, 'marks with area outside a clip of no area, ' + JSON.stringify(opts));
  }
  // A graded wash that thins to one point at its first layer.
  const ring = (r) => Array.from({ length: 20 }, (_, i) => [300 + r * Math.cos((i * Math.PI) / 10), 300 + r * Math.sin((i * Math.PI) / 10)]);
  const graded = washLog();
  const edge = wash(graded.g, rng(1), 'thin', (u) => ring(100 * u), '#3e55a8', { layers: 6 });
  assert.ok(edge.length > 0 && edge.every(([x, y]) => Math.hypot(x - 300, y - 300) < 1e-9), 'the edge of the collapsed first layer');
  assert.ok(graded.log.some((e) => e.key === 'fill' && graded.area(e.poly) > 1000), 'the wider layers are painted');
  let painted = 0;
  confine(washLog().g, point, () => painted++, null, { R: rng(1), name: 'reserve' });
  assert.equal(painted, 1, 'confine with soften paints inside a collapsed outline');
  // Graded washes that shrink from 400 to 200 wide and that swell from 200
  // to 400 and back: the pools of the widest pooled layer reach that layer's
  // edge, not only the first or last layer's.
  const shrink = (u) => [[0, 0], [400 - 200 * u, 0], [400 - 200 * u, 100], [0, 100]];
  const swell = (u) => [[0, 0], [200 + 200 * Math.sin(Math.PI * u), 0], [200 + 200 * Math.sin(Math.PI * u), 100], [0, 100]];
  for (const grade of [shrink, swell]) {
    const pools = washLog();
    wash(pools.g, rng(1), 'grade', grade, '#3e55a8', { layers: 10, mottle: 0.8 });
    const reach = Math.max(...pools.log.filter((e) => e.key === 'fill' && e.inClip).flatMap((e) => e.poly.map(([x]) => x)));
    const widest = grade(5 / 9)[1][0];
    assert.ok(reach >= widest, 'pools reach x ' + reach.toFixed(1) + ', the widest pooled layer ' + widest.toFixed(1));
  }
  // A softened reserve 800 across keeps edges of at most 26 units, so it
  // wanders about as far as a small one, not by a tenth of its outline.
  const disc = Array.from({ length: 400 }, (_, i) => [500 + 400 * Math.cos((2 * Math.PI * i) / 400), 500 + 400 * Math.sin((2 * Math.PI * i) / 400)]);
  const large = washLog();
  confine(large.g, disc, () => {}, null, { R: rng(1), name: 'reserve' });
  const stray = Math.max(...large.log.filter((e) => e.key === 'clip').flatMap((e) => e.poly.map(([x, y]) => Math.abs(Math.hypot(x - 500, y - 500) - 400))));
  assert.ok(stray < 20, 'the large reserve strays ' + stray.toFixed(1) + ' from its circle');
  // Canvas filters blur in output pixels, so every blur doubles at twice the scale.
  const blurs = (scale) => {
    const { g, log } = washLog(scale);
    wash(g, rng(1), 'wet', shrink, '#3e55a8', { layers: 10, wet: 3 });
    return log.filter((e) => e.key === 'filter').map((e) => Number(/^blur\(([\d.]+)px\)$/.exec(e.value)[1]));
  };
  assert.ok(blurs(1).length > 0 && blurs(1).includes(3), 'wet 3 at scale 1 blurs 3 pixels: ' + blurs(1));
  assert.deepEqual(blurs(2), blurs(1).map((v) => v * 2));
});

test('watercolour wash: an outline given closer than a cell leaves the circle at its given points too, while a thin strip, a thin limb and a fine bump keep their extent', () => {
  const { wash } = require('../skills/artifex/styles/watercolour.js');
  const { rng } = require('../core/rand.js');
  const { chaikin } = require('../core/geom.js');
  const { g } = washLog();
  // A 48-point disc of radius 40, points 5.2 apart under its cell of 6: the
  // edge's rms distance from the circle at the given points' angles against
  // midway between them. Main pinned every given point: 0.20 to 0.28.
  const disc = Array.from({ length: 48 }, (_, i) => [300 + 40 * Math.cos((2 * Math.PI * i) / 48), 300 + 40 * Math.sin((2 * Math.PI * i) / 48)]);
  for (const seed of [1, 2, 3]) {
    const sum = [0, 0]; const count = [0, 0];
    for (const [x, y] of wash(g, rng(seed), 'beat', disc, '#000', { layers: 1 })) {
      const phase = ((((Math.atan2(y - 300, x - 300) * 48) / (2 * Math.PI)) % 1) + 1) % 1;
      const k = Math.abs(phase - 0.5) < 0.0625 ? 1 : phase < 0.0625 || phase > 0.9375 ? 0 : -1;
      if (k >= 0) { sum[k] += (Math.hypot(x - 300, y - 300) - 40) ** 2; count[k]++; }
    }
    const ratio = Math.sqrt(sum[0] / count[0]) / Math.sqrt(sum[1] / count[1]);
    assert.ok(ratio > 0.45, 'seed ' + seed + ': at the given points ' + ratio.toFixed(2) + ' of the wander midway');
  }
  // A strip 400 long and 4 wide given every 4 units strays at most 1.50
  // past its side over 20 seeds, as on main.
  const strip = [...Array.from({ length: 101 }, (_, i) => [i * 4, 0]), ...Array.from({ length: 101 }, (_, i) => [400 - i * 4, 4])];
  let stray = 0;
  for (let seed = 1; seed <= 20; seed++) for (const [, y] of wash(g, rng(seed), 'strip', strip, '#000', { layers: 1 })) stray = Math.max(stray, Math.abs(y - 2) - 2);
  assert.ok(stray < 1.51, 'the strip strays ' + stray.toFixed(2));
  // A limb 5 to 25 wide crosses itself at most once over 20 seeds, as on main.
  const spine = chaikin([[980, 588], [840, 612], [680, 640], [520, 656], [380, 664], [300, 660]], 3);
  const thick = (i) => 3 + 11 * (1 - i / spine.length) ** 1.3;
  const limb = [...spine.map(([x, y], i) => [x, y - thick(i)]), ...spine.map(([x, y], i) => [x, y + thick(i) * 0.8]).reverse()];
  const side = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  let crossings = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const e = wash(g, rng(seed), 'limb', limb, '#000', { layers: 1, spread: 0.12 });
    for (let i = 0; i < e.length; i++) {
      for (let j = i + 2; j < e.length; j++) {
        if (i === 0 && j === e.length - 1) continue;
        const [a, b, c, d] = [e[i], e[i + 1], e[j], e[(j + 1) % e.length]];
        if (side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0) crossings++;
      }
    }
  }
  assert.ok(crossings <= 1, 'the limb crosses itself ' + crossings + ' times');
  // A bump 20 high and 8 wide given every 0.05 keeps its tip.
  const bump = [[0, 100], [0, 0]];
  for (let x = 180; x <= 220; x += 0.05) bump.push([x, -20 * Math.exp(-((x - 200) ** 2) / 12.5)]);
  bump.push([400, 0], [400, 100]);
  for (let seed = 1; seed <= 5; seed++) {
    const top = -Math.min(...wash(g, rng(seed), 'bump', bump, '#000', { layers: 1 }).map((p) => p[1]));
    assert.ok(top >= 19.9, 'seed ' + seed + ': the bump reaches ' + top.toFixed(2));
  }
});

test('kit soft: draws into a small buffer under the canvas transform, clipped to the box and backed as the target, and lays it back at full size, smoothed, on one lattice as the patch moves; refuses scale 1; a collapsed box draws nothing', () => {
  const { soft } = require('../skills/artifex/styles/kit.js');
  const surface = (canvas) => {
    const log = [];
    let smooth = false, m = { a: 2, b: 0, c: 0, d: 2, e: 10, f: 0 };
    const g = {
      canvas, log,
      getTransform: () => m,
      setTransform: (...t) => { log.push(['setTransform', ...t]); if (t.length === 6) m = { a: t[0], b: t[1], c: t[2], d: t[3], e: t[4], f: t[5] }; },
      save: () => log.push(['save']), restore: () => { log.push(['restore']); m = { a: 2, b: 0, c: 0, d: 2, e: 10, f: 0 }; },
      drawImage: (...a) => log.push(['drawImage', smooth, ...a]),
      beginPath: () => log.push(['beginPath']), rect: (...r) => log.push(['rect', ...r]), clip: () => log.push(['clip']),
      set imageSmoothingEnabled(v) { smooth = v; }, get imageSmoothingEnabled() { return smooth; },
    };
    return g;
  };
  let buffer;
  const doc = { createElement: () => (buffer = { getContext: (type, opts) => { buffer.opts = opts; return (buffer.g = surface(null)); } }) };
  const g = surface({ width: 200, height: 100, ownerDocument: doc });
  const drawn = [];
  // The design box (5, 5, 40, 20) under scale 2 and x + 10 covers pixels 20..100 by 10..50,
  // and the buffer's lattice of 4 pixels from the canvas corner rounds that out to 20..100 by 8..52.
  const buffered = [];
  soft(g, 5, 5, 40, 20, 0.25, (s, b) => { drawn.push(s); buffered.push(b); s.log.push(['draw']); });
  assert.equal(drawn.length, 1, 'draw runs once');
  assert.equal(drawn[0], buffer.g, 'draw paints the buffer, not the canvas');
  assert.equal(buffered[0], true, 'draw is told it paints the buffer');
  assert.deepEqual([buffer.width, buffer.height], [20, 11], 'the buffer holds a quarter of the box\'s pixels');
  assert.deepEqual(buffer.g.log[0], ['setTransform', 0.5, 0, 0, 0.5, -2.5, -2], 'the buffer draws in design units under the canvas transform');
  assert.deepEqual(g.log.find((e) => e[0] === 'drawImage'), ['drawImage', true, buffer, 20, 8, 80, 44], 'laid back smoothed over the whole box');
  // Under a rotation the buffer spans the box's bounds, so draw is clipped to the box there too, as on an SVG.
  const turned = surface({ width: 200, height: 100, ownerDocument: doc });
  turned.getTransform = () => ({ a: Math.cos(0.5), b: Math.sin(0.5), c: -Math.sin(0.5), d: Math.cos(0.5), e: 100, f: 10 });
  turned.getContextAttributes = () => ({ alpha: false, colorSpace: 'display-p3', willReadFrequently: true });
  soft(turned, 5, 5, 40, 20, 0.25, (s) => s.log.push(['draw']));
  assert.deepEqual(buffer.g.log.slice(1).map((e) => e[0] === 'rect' ? e.join(' ') : e[0]), ['beginPath', 'rect 5 5 40 20', 'clip', 'draw'], 'a rotated box is clipped before draw');
  // The buffer is backed as the target is, so a canvas kept in memory stays there, and keeps its alpha.
  assert.deepEqual(buffer.opts, { colorSpace: 'display-p3', willReadFrequently: true }, 'the buffer takes the target\'s colour space and memory backing');
  // A patch moving by fractions of a pixel keeps one lattice: every lay starts on it and its pixels stay 4 wide.
  for (const e of [10, 10.6, 11.3, 12.9, 13.7]) {
    const moved = surface({ width: 200, height: 100, ownerDocument: doc });
    moved.getTransform = () => ({ a: 2, b: 0, c: 0, d: 2, e, f: e / 3 });
    soft(moved, 5, 5, 40, 20, 0.25, () => {});
    const [, , , x0, y0, lw, lh] = moved.log.find((l) => l[0] === 'drawImage');
    assert.deepEqual([x0 % 4, y0 % 4, lw / buffer.width, lh / buffer.height], [0, 0, 4, 4], 'one lattice at x + ' + e);
  }
  for (const scale of [1, 1.5, 0, -0.2, NaN, undefined]) {
    assert.throws(() => soft(g, 5, 5, 40, 20, scale, () => {}), { message: /^kit soft: scale takes a number above 0 and below 1, .*got /, }, String(scale));
  }
  for (const box of [[5, 5, 0, 20], [5, 5, 40, -1], [5, 5, NaN, 20], [500, 500, 40, 20], [-90, 5, 40, 20]]) {
    const h = surface({ width: 200, height: 100, ownerDocument: doc });
    let calls = 0;
    soft(h, ...box, 0.25, () => calls++);
    assert.deepEqual([calls, h.log.length], [0, 0], 'nothing drawn for ' + JSON.stringify(box));
  }
  // A surface with no canvas, such as an SVG, takes the drawing sharp, clipped to the box and told so.
  const flat = surface(undefined);
  soft(flat, 5, 5, 40, 20, 0.25, (s, b) => { drawn.push(s); buffered.push(b); s.log.push(['draw']); });
  assert.equal(drawn.at(-1), flat);
  assert.equal(buffered.at(-1), false, 'draw is told it paints the surface itself');
  assert.deepEqual(flat.log.map((e) => e[0] === 'rect' ? e.join(' ') : e[0]), ['save', 'beginPath', 'rect 5 5 40 20', 'clip', 'draw', 'restore'], 'the sharp fallback is clipped to the box');
  // On the real vector surface the documented fade is skipped and nothing throws.
  const { VectorSurface } = require('../core/surface-vector.js');
  const svg = new VectorSurface({ w: 200, h: 100 });
  soft(svg, 5, 5, 40, 20, 0.25, (s, b) => { s.fillStyle = '#888'; s.fillRect(0, 0, 200, 100); if (b) { s.globalCompositeOperation = 'destination-in'; s.fillRect(5, 5, 40, 20); } });
});

test('kit bristles: a wet stroke is one unbroken run per hair, a dry one breaks past its dry point, a collapsed spine draws nothing', () => {
  const { bristles } = require('../skills/artifex/styles/kit.js');
  const { rng } = require('../core/rand.js');
  // A level spine 200 long, resampled every 2 units: 101 stations.
  const spine = [[0, 0], [200, 0]];
  const wet = bristles(rng(7), 'wet', spine, { width: 20, count: 16 });
  assert.equal(wet.length, 16);
  assert.deepEqual(wet.map((h) => h.runs.length + ':' + h.runs[0].length), Array(16).fill('1:101'), 'every wet hair is one run of every station');
  const dry = bristles(rng(7), 'dry', spine, { width: 20, count: 16, dryFrom: 0.4, dry: 0.8 });
  assert.equal(dry.reduce((sum, h) => sum + h.runs.length, 0), 29, 'runs under the dry stroke');
  // Each hair runs dry no earlier than 0.8 x 0.75 of dryFrom: unbroken from the start to x = 48.
  for (const [j, h] of dry.entries()) {
    assert.ok(h.runs[0][0][0] === 0 && h.runs[0].at(-1)[0] >= 48, 'hair ' + j + ' first run ' + h.runs[0][0][0] + ' to ' + h.runs[0].at(-1)[0]);
    assert.ok(h.runs.every((r) => r.length > 1), 'hair ' + j + ' has a run of one point');
  }
  // pen-and-pencil drag lays its hairs on a real spine, broken by the tooth.
  {
    const { g: base, log } = recorder();
    const g = new Proxy(base, { get: (target, key) => key === 'getTransform' ? () => ({ a: 1, b: 0 }) : target[key] });
    require('../skills/artifex/styles/pen-and-pencil.js').drag(g, rng(7), 'drag', spine, '#5c9a48');
    const strokes = log.filter((e) => e[0] === 'stroke').length;
    const moves = log.filter((e) => e[0] === 'moveTo').length;
    assert.ok(strokes > 0 && log.some((e) => e[0] === 'lineTo'), 'drag strokes its hairs: ' + strokes);
    assert.ok(moves > strokes, 'drag breaks its hairs into more runs than hairs: ' + moves + ' runs, ' + strokes + ' hairs');
  }
  for (const spine of [[], [[5, 5]], [[5, 5], [5, 5]]]) {
    assert.deepEqual(bristles(rng(7), 'none', spine, { dryFrom: 0 }), [], JSON.stringify(spine));
    const { g: base, log } = recorder();
    const g = new Proxy(base, { get: (target, key) => key === 'getTransform' ? () => ({ a: 1, b: 0 }) : target[key] });
    require('../skills/artifex/styles/gouache.js').drybrush(g, rng(7), 'none', spine, '#123456');
    require('../skills/artifex/styles/pen-and-pencil.js').drag(g, rng(7), 'none', spine, '#5c9a48');
    assert.ok(!log.some((e) => e[0] === 'lineTo'), 'a collapsed spine lays no hair: ' + JSON.stringify(spine));
  }
});

test('kit valueKey, perceptualPalette and notan: lightness lands in the key, contrast reaches the ground, shares count every sample', () => {
  const { valueKey, perceptualPalette, notan } = require('../skills/artifex/styles/kit.js');
  const { oklch, contrast } = require('../core/colour.js');
  const L = (c) => oklch(c)[0];
  const tol = 0.01; // hex rounding
  const ranges = { high: [0.58, 0.94], mid: [0.24, 0.84], low: [0.12, 0.54] };
  for (const [key, [lo, hi]] of Object.entries(ranges)) {
    for (const c of ['#000000', '#6688aa', '#d9524f', '#ffffff', '#20c040']) {
      const out = valueKey(c, key);
      assert.ok(L(out) >= lo - tol && L(out) <= hi + tol, `${c} in ${key} is ${out}, L ${L(out).toFixed(3)}`);
    }
  }
  assert.ok(L(valueKey('#000', 'low')) < L(valueKey('#888', 'low')) && L(valueKey('#888', 'low')) < L(valueKey('#fff', 'low')), 'order of values is kept');
  assert.ok(L(valueKey('#333', 'chiaroscuro')) <= 0.3 + tol && L(valueKey('#ccc', 'chiaroscuro')) >= 0.76 - tol, 'chiaroscuro empties the middle');
  assert.equal(valueKey('#6688aa80', 'high').slice(7), '80', 'alpha is kept');
  assert.throws(() => valueKey('#6688aa', 'dim'), /^Error: kit valueKey: key takes high, mid, low or chiaroscuro, got "dim"$/);

  const low = perceptualPalette({ hue: 0.8, harmony: 'triadic', key: 'low', count: 5 });
  assert.equal(low.length, 5);
  for (let i = 1; i < low.length; i++) assert.ok(low[i].oklch[0] > low[i - 1].oklch[0], 'swatches step dark to light');
  for (const s of low) assert.match(s.hex, /^#[0-9a-f]{6}$/);
  const onDark = perceptualPalette({ hue: 0.8, harmony: 'triadic', key: 'low', count: 5, ground: '#1a1a1a', minContrast: 4.5 });
  for (const s of onDark) assert.ok(contrast(s.hex, '#1a1a1a') >= 4.5, `${s.hex} against #1a1a1a is ${contrast(s.hex, '#1a1a1a').toFixed(2)}`);
  const onLight = perceptualPalette({ key: 'high', count: 4, ground: '#f4f0e8', minContrast: 3 });
  for (const s of onLight) assert.ok(contrast(s.hex, '#f4f0e8') >= 3, `${s.hex} against #f4f0e8`);
  assert.equal(perceptualPalette({ count: 1 }).length, 1);
  assert.equal(new Set(perceptualPalette({ harmony: 'monochrome', count: 3, chroma: 0.1 }).map((s) => Math.round(s.oklch[2] * 10))).size, 1, 'monochrome keeps one hue');
  assert.throws(() => perceptualPalette({ harmony: 'clashing' }), /^Error: kit perceptualPalette: harmony takes monochrome, analogous, .*got "clashing"$/);
  assert.throws(() => perceptualPalette({ count: 0 }), /^Error: kit perceptualPalette: count takes a whole number of 1 or more, got 0$/);
  assert.throws(() => perceptualPalette({ hue: NaN }), /^Error: kit perceptualPalette: hue takes a finite number of radians, got NaN$/);

  const n = notan(['#000000', '#101010', '#808080', '#ffffff', [1, 1, 1]]);
  assert.deepEqual(n.bins, ['dark', 'dark', 'mid', 'light', 'light']);
  assert.equal(n.darkShare + n.midShare + n.lightShare, 1);
  assert.ok(Math.abs(n.meanLuma - (0 + 0.0052 + 0.2159 + 1 + 1) / 5) < 1e-3, 'meanLuma is linear luminance: ' + n.meanLuma);
  assert.ok(Math.abs(n.contrastSpan - 1) < 1e-6 && n.minL === 0);
  assert.deepEqual(notan(['#404040', '#808080', '#c0c0c0'], { low: 0.7, high: 0.7 }).bins, ['dark', 'dark', 'light'], 'low === high gives two values');
  assert.throws(() => notan([]), /^Error: kit notan: samples takes a non-empty array/);
  assert.throws(() => notan([[1, 2]]), /^Error: kit notan: each sample takes a hex colour or linear \[r, g, b\], got \[1,2\]$/);
});

// A mock 2D context for the flat cartoon marks: a log of every call and set,
// and the polygon each fill() closed over.
function recorder() {
  const log = []; let poly = [];
  const g = new Proxy({}, {
    get: (_, key) => (...args) => {
      log.push([key, ...args]);
      if (key === 'beginPath') poly = [];
      if (key === 'moveTo' || key === 'lineTo') poly.push(args);
      if (key === 'fill') log.push(['poly', poly]);
    },
    set: (_, key, value) => { log.push(['set', key, value]); return true; },
  });
  return { g, log, polys: () => log.filter((e) => e[0] === 'poly').map((e) => e[1]) };
}

test('sumi-e taper enters on the point and presses to near full within its first tenth', () => {
  const { PRESS } = require('../skills/artifex/styles/sumi-e.js');
  assert.ok(PRESS.taper(0) <= 0.25, 'entry ' + PRESS.taper(0));
  assert.ok(PRESS.taper(0.1) >= 0.85, 'at a tenth ' + PRESS.taper(0.1));
});

test('sumi-e bristles stay inside the body of a fine entry and a fine lift', () => {
  const { PRESS, brush } = require('../skills/artifex/styles/sumi-e.js');
  const { rng } = require('../core/rand.js');
  for (const press of ['taper', 'flick', 'sweep']) {
    const { g, polys } = recorder();
    // A level spine 200 long, so a point at x sits at t = x / 200 and the body's half width there is 10 x press(t).
    brush(g, rng(7), press, [[0, 0], [200, 0]], { w: 20, dry: 0.3, press: PRESS[press], bristles: 20 });
    const hairs = polys().slice(1).flat();
    const fine = hairs.filter(([x]) => x < 12 || x > 188);
    assert.ok(fine.length > 0, press + ': bristles reach the fine ends');
    const outside = fine.filter(([x, y]) => Math.abs(y) > 1.25 * 10 * Math.max(...[x - 1, x + 1].map((u) => PRESS[press](Math.min(1, Math.max(0, u / 200))))) + 0.05);
    assert.equal(outside.length, 0, press + ': first bristle point outside the body ' + JSON.stringify(outside[0]));
  }
});

test('sumi-e body ends where its bristles do at a fine entry and keeps its round at a wide one', () => {
  const { PRESS, brush } = require('../skills/artifex/styles/sumi-e.js');
  const { rng } = require('../core/rand.js');
  for (const [press, w] of [['taper', 20], ['flick', 20], ['sweep', 20], ['taper', 60], ['swell', 20]]) {
    const { g, polys } = recorder();
    // A level spine from x = 0, so anything at x < 0 lies behind the first point.
    brush(g, rng(7), press, [[0, 0], [200, 0]], { w, dry: 0.3, press: PRESS[press], bristles: 20 });
    const [body, ...hairs] = polys();
    const behind = (poly) => Math.min(0, ...poly.map(([x]) => x));
    const hair = behind(hairs.flat());
    const round = (w / 2) * PRESS[press](0);
    if (PRESS[press](0) <= 0.2) assert.ok(behind(body) >= hair - 0.05, press + ' ' + w + ': body reaches ' + behind(body) + ' behind the entry, bristles ' + hair);
    else assert.ok(behind(body) <= -0.99 * round, press + ' ' + w + ': round reaches ' + behind(body) + ', not ' + -round);
  }
});

test('flat cartoon shade takes #rgb and #rrggbbaa as core does and refuses other colours, and cel paints both fills', () => {
  const fc = require('../skills/artifex/styles/flat-cartoon.js');
  assert.match(fc.shade('#d9524f'), /^#[0-9a-f]{6}$/);
  // The default tone is clearly darker: red's shade sits near #b6464a.
  const near = (a, b) => [1, 3, 5].every((i) => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) <= 2);
  assert.ok(near(fc.shade('#d9524f'), '#b6464a'), fc.shade('#d9524f'));
  assert.equal(fc.shade('#fff'), fc.shade('#ffffff'));
  assert.equal(fc.shade('#ffffff80').slice(0, 7), fc.shade('#ffffff'));
  assert.equal(fc.shade('#ffffff80').slice(7), '80', 'the alpha is kept');
  assert.throws(() => fc.shade('red'), /^Error: colour: /);
  // A short fill gets a real tone, not an invalid fillStyle the canvas would ignore.
  const { g, log } = recorder();
  fc.cel(g, [[0, 0], [50, 0], [50, 50], [0, 50]], '#fff');
  const fills = log.filter((e) => e[0] === 'set' && e[1] === 'fillStyle').map((e) => e[2]);
  assert.deepEqual(fills, [fc.shade('#ffffff'), '#fff']);
  assert.throws(() => fc.cel(recorder().g, [[0, 0], [5, 0], [5, 5]], 'red'), /^Error: colour: /);
});

test('flat cartoon shade of white and a light grey is lavender, a pale warm fill keeps its warmth, never grey', () => {
  const { shade } = require('../skills/artifex/styles/flat-cartoon.js');
  const { oklch, mix } = require('../core/colour.js');
  const deg = (c) => ((oklch(c)[2] * 180) / Math.PI + 360) % 360;
  const turn = (a, b) => Math.abs(((deg(a) - deg(b) + 540) % 360) - 180);
  for (const fill of ['#ffffff', '#cccccc']) {
    const [L, C] = oklch(shade(fill));
    assert.ok(C >= 0.02, `${fill} shades to ${shade(fill)}, chroma ${C.toFixed(4)}`);
    assert.ok(deg(shade(fill)) > 280 && deg(shade(fill)) < 330, `${fill} shades to hue ${deg(shade(fill)).toFixed(0)}`);
    assert.ok(L < oklch(fill)[0] - 0.08, `${fill} shades darker`);
  }
  // Pale warm fills keep their own warm hue.
  for (const fill of ['#f5e6d3', '#fffaf0']) {
    assert.ok(oklch(shade(fill))[1] >= 0.015, `${fill} shades to ${shade(fill)}, a grey`);
    assert.ok(turn(shade(fill), fill) < 15, `${fill} shades to ${shade(fill)}, hue turned ${turn(shade(fill), fill).toFixed(1)} degrees`);
  }
  for (const fill of ['#d9524f', '#83bde9', '#ffd45c', '#7cc47f']) {
    assert.ok(turn(shade(fill), fill) < 5, `${fill} shades to ${shade(fill)}, hue turned ${turn(shade(fill), fill).toFixed(1)} degrees`);
  }
  // The lean grows with k: none at 0, and a light k keeps the plain mix's lightness.
  assert.equal(shade('#ffffff', 0), '#ffffff');
  const light = oklch(shade('#ffffff', 0.1))[0] - oklch(mix('#ffffff', '#3a2340', 0.1))[0];
  assert.ok(Math.abs(light) < 0.01, `#ffffff at k 0.1 shades to ${shade('#ffffff', 0.1)}, lightness off by ${light.toFixed(4)}`);
});

test('flat cartoon shade of near-grey fills a byte apart lands on close colours', () => {
  const { shade } = require('../skills/artifex/styles/flat-cartoon.js');
  const { oklch } = require('../core/colour.js');
  const deg = (c) => ((oklch(c)[2] * 180) / Math.PI + 360) % 360;
  const turn = (a, b) => Math.abs(((deg(a) - deg(b) + 540) % 360) - 180);
  // Near greys and an off-white shade to the same lavender as white.
  for (const [a, b] of [['#d1d3d0', '#d1d3d1'], ['#ccccc9', '#cccccc'], ['#f2f0ee', '#ffffff']]) {
    assert.ok(turn(shade(a), shade(b)) < 15, `${a} shades to ${shade(a)} and ${b} to ${shade(b)}, hues ${turn(shade(a), shade(b)).toFixed(0)} degrees apart`);
  }
  // At several k, every fill within 8 bytes of a grey, dark greys included,
  // shades within 0.02 in OKLab of its neighbours one byte away.
  const lab = (c) => { const [L, C, h] = oklch(c); return [L, C * Math.cos(h), C * Math.sin(h)]; };
  const hex = (v) => '#' + v.map((n) => n.toString(16).padStart(2, '0')).join('');
  let worst = { step: 0 };
  for (const k of [0.2, 0.35, 0.5, 0.7]) for (const grey of [0x30, 0x50, 0x68, 0x80, 0xa4, 0xcc, 0xf2]) {
    for (let r = grey - 8; r <= grey + 8; r++) for (let g = grey - 8; g <= grey + 8; g++) for (let b = grey - 7; b <= grey + 8; b++) {
      const a = hex([r, g, b]); const p = lab(shade(a, k));
      for (const n of [hex([r, g, b - 1]), r > grey - 8 && hex([r - 1, g, b]), g > grey - 8 && hex([r, g - 1, b])].filter(Boolean)) {
        const q = lab(shade(n, k));
        const step = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        if (step > worst.step) worst = { step, a, n, k };
      }
    }
  }
  assert.ok(worst.step < 0.02, `at k ${worst.k} ${worst.a} shades to ${shade(worst.a, worst.k)} and ${worst.n} to ${shade(worst.n, worst.k)}, ${worst.step.toFixed(4)} apart`);
});

test('flat cartoon shade caps k at 0.8, so fills of different hue stay distinct at full strength', () => {
  const { shade } = require('../skills/artifex/styles/flat-cartoon.js');
  const { oklch } = require('../core/colour.js');
  const lab = (c) => { const [L, C, h] = oklch(c); return [L, C * Math.cos(h), C * Math.sin(h)]; };
  const fills = ['#7c827a', '#4b5448', '#cccccc', '#d9524f', '#4f86c6', '#7cc47f', '#ffd45c'];
  for (const f of fills) assert.equal(shade(f, 1), shade(f, 0.8), `${f}: k 1 and 0.8 differ`);
  assert.notEqual(shade('#d9524f', 0.7), shade('#d9524f', 0.8), 'k below the cap still deepens the tone');
  for (let i = 0; i < fills.length; i++) for (let j = i + 1; j < fills.length; j++) {
    const p = lab(shade(fills[i], 1)); const q = lab(shade(fills[j], 1));
    const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    assert.ok(d > 0.03, `${fills[i]} and ${fills[j]} shade at k 1 to ${shade(fills[i], 1)} and ${shade(fills[j], 1)}, ${d.toFixed(4)} apart`);
  }
});

test('flat cartoon shade of dark fills is never lighter than the fill', () => {
  const { shade } = require('../skills/artifex/styles/flat-cartoon.js');
  const { oklch, hex } = require('../core/colour.js');
  assert.equal(shade('#000000'), '#000000');
  let over = 0; let first = '';
  for (let r = 0; r <= 48; r += 3) for (let g = 0; g <= 48; g += 3) for (let b = 0; b <= 48; b += 3) {
    const fill = hex([r / 255, g / 255, b / 255]);
    for (const k of [0.02, 0.1, 0.35, 0.8]) {
      if (oklch(shade(fill, k))[0] <= oklch(fill)[0]) continue;
      over++; first ||= `${fill} at k ${k} shades to ${shade(fill, k)}`;
    }
  }
  for (const fill of ['#010101', '#030002', '#202020', '#10002a', '#300030', '#4b1e45', '#302d40']) for (const k of [0.005, 0.02, 0.05, 0.1, 0.35, 0.8]) {
    if (oklch(shade(fill, k))[0] > oklch(fill)[0]) { over++; first ||= `${fill} at k ${k} shades to ${shade(fill, k)}`; }
  }
  assert.equal(over, 0, `${over} dark fills shade lighter than themselves, first ${first}`);
});

test('flat cartoon shade leaves fills lighter than OKLCh 0.32 undimmed', () => {
  const { shade } = require('../skills/artifex/styles/flat-cartoon.js');
  // The mix as it was before dark fills were dimmed, rounded once.
  assert.equal(shade('#58452a', 0.02), '#58452b');
  assert.equal(shade('#302d66', 0.05), '#312d65');
});

test('flat cartoon cel clips to the part, then fills exactly twice', () => {
  const { g, log } = recorder();
  require('../skills/artifex/styles/flat-cartoon.js').cel(g, [[0, 0], [50, 0], [50, 50], [0, 50]], '#d9524f');
  assert.deepEqual(log.filter((e) => e[0] === 'clip' || e[0] === 'fill').map((e) => e[0]), ['clip', 'fill', 'fill']);
});

test('flat cartoon sfx refuses a character the stroke font lacks and draws one it has', () => {
  const { sfx } = require('../skills/artifex/styles/flat-cartoon.js');
  assert.throws(() => sfx(recorder().g, () => 0.5, 'sfx', 'BAM#', 0, 0, 40), /^Error: sfx: the stroke font has no glyph for #$/);
  const { g, log } = recorder();
  sfx(g, () => 0.5, 'sfx', 'BAM!', 0, 0, 40);
  assert.ok(log.some((e) => e[0] === 'stroke'), 'the lettering is drawn');
});

test('flat cartoon ink tapers an open line and sits heavier away from the light on a closed one, in both windings', () => {
  const { ink } = require('../skills/artifex/styles/flat-cartoon.js');
  const R = () => 0.5;
  const open = recorder();
  ink(open.g, R, 'open', [[0, 0], [100, 0], [200, 0]], { wobble: 0 });
  const [line] = open.polys();
  const half = (x) => Math.max(...line.filter((p) => Math.abs(p[0] - x) < 1.5).map((p) => Math.abs(p[1])));
  assert.ok(half(1) < half(100) / 2 && half(199) < half(100) / 2, 'thin at both ends, swelling in the middle');
  const circle = Array.from({ length: 64 }, (_, i) => [100 * Math.cos(i * Math.PI / 32), 100 * Math.sin(i * Math.PI / 32)]);
  for (const pts of [circle, [...circle].reverse()]) {
    const closed = recorder();
    ink(closed.g, R, 'closed', pts, { closed: true, wobble: 0, w: 10 });
    const [ring] = closed.polys();
    const reach = (dx, dy) => Math.max(...ring.map((p) => p[0] * dx + p[1] * dy)) - 100;
    const away = reach(Math.SQRT1_2, Math.SQRT1_2); const toward = reach(-Math.SQRT1_2, -Math.SQRT1_2);
    assert.ok(away > toward * 1.5, 'lower right ' + away.toFixed(2) + ' against upper left ' + toward.toFixed(2));
  }
});

test('flat cartoon closed ink has no step at the loop start beyond the largest step elsewhere', () => {
  const { ink } = require('../skills/artifex/styles/flat-cartoon.js');
  const { rng } = require('../core/rand.js');
  const N = 200; const RADIUS = 100; const TAU = 2 * Math.PI;
  const ring = Array.from({ length: N }, (_, i) => [RADIUS * Math.cos(TAU * i / N), RADIUS * Math.sin(TAU * i / N)]);
  let seam = 0; let elsewhere = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const rec = recorder();
    ink(rec.g, rng(seed), 'seam', ring, { closed: true, w: 10 });
    // The outer edge of the ring by angle: its half-width above the radius.
    const outer = rec.polys()[0].map(([x, y]) => ({ a: (Math.atan2(y, x) + TAU) % TAU, h: Math.hypot(x, y) - RADIUS })).filter((o) => o.h > 0).sort((p, q) => p.a - q.a);
    for (let i = 0; i < outer.length; i++) {
      const p = outer[i]; const q = outer[(i + 1) % outer.length];
      const step = Math.abs(q.h - p.h);
      if (p.a < 0.05 || p.a > TAU - 0.05 || q.a < 0.05) seam = Math.max(seam, step); else elsewhere = Math.max(elsewhere, step);
    }
  }
  assert.ok(elsewhere > 0, 'the ring has an outer edge');
  assert.ok(seam <= elsewhere, 'seam step ' + seam.toFixed(4) + ' against largest elsewhere ' + elsewhere.toFixed(4));
});

// A context that records current()'s clips, fills and their gradients.
function cometLog() {
  const log = []; let poly = [];
  const gradient = (x0, y0, x1, y1) => { const grad = { line: [x0, y0, x1, y1], stops: [] }; grad.addColorStop = (f, c) => grad.stops.push([f, Number(/([\d.]+)\)$/.exec(c)[1])]); return grad; };
  const state = {};
  const g = new Proxy({}, {
    get: (_, key) => key.startsWith('create') ? gradient : (...args) => {
      log.push([key]);
      if (key === 'beginPath') poly = [];
      if (key === 'moveTo' || key === 'lineTo') poly.push(args);
      if (key === 'fill' || key === 'clip') log.push([key + 'Poly', poly, state.fillStyle]);
    },
    set: (_, key, value) => { state[key] = value; return true; },
  });
  return { g, log };
}

test('circuit board current clips each comet tail to one ribbon, narrowing toward its end, and strokes nothing', () => {
  const { current } = require('../skills/artifex/styles/circuit-board.js');
  const { g, log } = cometLog();
  current(g, [[[0, 0], [300, 0]], [[0, 50], [100, 50], [200, 150]]], [0.5, 0.6]);
  assert.equal(log.filter((e) => e[0] === 'stroke').length, 0, 'no segment is stroked');
  const tails = log.filter((e) => e[0] === 'clipPoly').map((e) => e[1]);
  assert.equal(tails.length, 2, 'one ribbon per trace');
  const [straight] = tails;
  const half = (x) => Math.max(...straight.filter((p) => Math.abs(p[0] - x) < 1).map((p) => Math.abs(p[1])));
  assert.ok(half(90) < half(147), 'the tail end ' + half(90).toFixed(2) + ' is narrower than near the head ' + half(147).toFixed(2));
});

test('circuit board current shades the tail by distance along the trace round a hairpin', () => {
  const { current } = require('../skills/artifex/styles/circuit-board.js');
  const { g, log } = cometLog();
  // Right 70, two 45-degree runs round a hairpin, left 70; the head 20 into the return.
  const hairpin = [[0, 0], [70, 0], [80, 10], [70, 20], [0, 20]];
  const total = 140 + 2 * Math.hypot(10, 10);
  const head = Math.round((total - 50) / 3) * 3;
  const { resample } = require('../core/geom.js');
  current(g, [hairpin], [(head / 3 + 0.5) / (resample(hairpin, 3).length - 1)]);
  const fills = log.filter((e) => e[0] === 'fillPoly');
  const inside = (poly, [x, y]) => poly.reduce((w, a, i) => {
    const b = poly[(i + 1) % poly.length];
    if ((a[1] <= y) !== (b[1] <= y) && x < a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1])) return w + 1;
    return w;
  }, 0) % 2 === 1;
  const shade = ({ line: [x0, y0, x1, y1], stops }, [x, y]) => {
    const f = Math.max(0, Math.min(1, ((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / ((x1 - x0) ** 2 + (y1 - y0) ** 2)));
    const i = Math.min(stops.length - 2, Math.max(0, stops.findIndex((s) => s[0] >= f) - 1));
    const [[fa, a], [fb, b]] = [stops[i], stops[i + 1]];
    return a + ((b - a) * (f - fa)) / (fb - fa);
  };
  // Points on the trace at distance d behind the head, on every run of the tail.
  const point = (s) => {
    for (let i = 1; i < hairpin.length; i++) {
      const [a, b] = [hairpin[i - 1], hairpin[i]]; const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (s <= len) return [a[0] + ((b[0] - a[0]) * s) / len, a[1] + ((b[1] - a[1]) * s) / len];
      s -= len;
    }
  };
  for (const d of [6, 15, 25, 35, 45, 55]) {
    const p = point(head - d);
    const hit = fills.find((e) => inside(e[1], p));
    assert.ok(hit, 'a fill covers the tail ' + d + ' behind the head');
    const want = 0.8 * (1 - d / 66) ** 2;
    const got = shade(hit[2], p);
    assert.ok(Math.abs(got - want) < 0.03, d + ' behind the head: alpha ' + got.toFixed(3) + ', want ' + want.toFixed(3));
  }
});

test('circuit board current draws a finite tail when summed run lengths drift past the head', () => {
  const { current } = require('../skills/artifex/styles/circuit-board.js');
  const { g, log } = cometLog();
  current(g, [[[0, 0], [-20.888443300637782, 21.53306611878672], [9.111556699362218, 21.53306611878672], [9.111556699362218, 51.53306611878672]]], [0.335]);
  const fills = log.filter((e) => e[0] === 'fillPoly' && e[2] && e[2].stops);
  assert.ok(fills.length > 0, 'the tail is filled');
  const bad = fills.filter((e) => !e[1].flat().every(Number.isFinite)).length;
  assert.equal(bad, 0, bad + ' of ' + fills.length + ' tail fills have non-finite coordinates');
});

test('circuit board current draws a tail whose shaded run is one point, with no throw', () => {
  const { current } = require('../skills/artifex/styles/circuit-board.js');
  // A whole trace shorter than 1e-6, then a 2-point tail over a leftover segment shorter than 1e-6.
  for (const [trace, at] of [[[[0, 0], [1e-7, 0]], 1], [[[0, 0], [30, 0], [30 + 1e-7, 0]], 1]]) {
    const { g } = cometLog();
    assert.doesNotThrow(() => current(g, [trace], [at]), JSON.stringify(trace));
  }
});

test('pen-and-pencil and manga pen lines keep their width round a sharp turn, with no notch at the corner', () => {
  const { rng } = require('../core/rand.js');
  // A 135-degree turn at (60, 0); both resample steps divide 60, so the corner stays a point.
  const spine = [[0, 0], [60, 0], [60 - 42.43, 42.43]];
  const seg = ([ax, ay], [bx, by], x, y) => {
    const dx = bx - ax; const dy = by - ay; const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - ax - t * dx, y - ay - t * dy);
  };
  const near = (x, y) => Math.min(seg(spine[0], spine[1], x, y), seg(spine[1], spine[2], x, y));
  const covered = (poly, x, y) => {
    let w = 0;
    for (let i = 0; i < poly.length; i++) {
      const [x0, y0] = poly[i]; const [x1, y1] = poly[(i + 1) % poly.length]; const s = (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0);
      if (y0 <= y) { if (y1 > y && s > 0) w++; } else if (y1 <= y && s < 0) w--;
    }
    return w !== 0;
  };
  // The first point within `reach` of the line and 6 of the corner that no
  // polygon or disc [x, y, r] fills, or null.
  const notch = (polys, discs, reach) => {
    for (let x = 54; x <= 66; x += 0.1) for (let y = -6; y <= 6; y += 0.1) {
      if (Math.hypot(x - 60, y) > 6 || near(x, y) > reach) continue;
      if (!polys.some((poly) => covered(poly, x, y)) && !discs.some(([cx, cy, r]) => Math.hypot(x - cx, y - cy) <= r)) return [x.toFixed(1), y.toFixed(1)];
    }
    return null;
  };
  // A manga line of one width fills its full width round the corner.
  const manga = require('../skills/artifex/styles/manga.js');
  const m = recorder();
  manga.pen(m.g, rng(3), 'turn', spine, { w: 6, press: manga.PRESS.even, wobble: 0, smooth: 0 });
  assert.equal(notch(m.polys(), [], 0.9 * 3), null, 'manga: first empty point near the corner');
  const pp = require('../skills/artifex/styles/pen-and-pencil.js');
  const p = recorder();
  // pen reads one device pixel from the transform: give it the identity.
  const g = new Proxy(p.g, { get: (o, key) => key === 'getTransform' ? () => ({ a: 1, b: 0 }) : o[key] });
  pp.pen(g, rng(3), 'turn', spine, { w: 6, wob: 0, skip: -1 });
  const [run, ...pools] = p.polys();
  // The half-width on the leg just before the corner, where the line runs straight.
  const half = Math.min(...[50, 52.5, 55].map((x) => Math.min(...run.map(([u, v]) => Math.hypot(u - x, v)))));
  assert.ok(half > 0.5, 'leg half-width ' + half);
  // A ballpoint run swells at the corner and pools there; together they leave no notch.
  const discs = p.log.filter((e) => e[0] === 'arc').map((e) => e.slice(1, 4));
  assert.ok(discs.length > 0 && pools.length === discs.length, 'each pool is one filled disc');
  assert.equal(notch([run], discs, 0.9 * half), null, 'pen-and-pencil: first empty point near the corner');
});

test('pen-and-pencil scribble swings across the form it fills, leaves half of it bare and lifts where the form parts', () => {
  const { rng } = require('../core/rand.js');
  const { pointInPoly } = require('../core/geom.js');
  const pp = require('../skills/artifex/styles/pen-and-pencil.js');
  // Every piece the scribble lays, as [x0, y0, x1, y1], with the width it was stroked at.
  const laid = (region, opts) => {
    const { g: base, log } = recorder();
    const g = new Proxy(base, { get: (o, key) => key === 'getTransform' ? () => ({ a: 1, b: 0 }) : o[key] });
    pp.scribble(g, rng(5), 'fill', region, '#d8504a', opts);
    const pieces = [];
    for (let i = 0; i + 1 < log.length; i++) if (log[i][0] === 'moveTo' && log[i + 1][0] === 'lineTo') pieces.push([...log[i].slice(1), ...log[i + 1].slice(1)]);
    return pieces;
  };
  // A bar 400 long and 80 across, turned 0.5: the long axis is found, so the swings run across it.
  const c = Math.cos(0.5); const s = Math.sin(0.5);
  const bar = [[-200, -40], [200, -40], [200, 40], [-200, 40]].map(([x, y]) => [300 + x * c - y * s, 300 + x * s + y * c]);
  const pieces = laid(bar);
  assert.ok(pieces.length > 1000, pieces.length + ' pieces');
  const along = (x, y) => (x - 300) * c + (y - 300) * s; const across = (x, y) => (y - 300) * c - (x - 300) * s;
  const far = pieces.filter(([x, y]) => Math.abs(across(x, y)) > 40 + 6 + 8 || Math.abs(along(x, y)) > 200 + 8).length;
  assert.equal(far, 0, far + ' pieces lie further past the outline than the overshoot and half the line');
  const reach = pieces.map(([x, y]) => across(x, y));
  assert.ok(Math.min(...reach) < -30 && Math.max(...reach) > 30, 'the swings reach both long sides');
  const span = pieces.map(([x, y]) => along(x, y));
  assert.ok(Math.min(...span) < -170 && Math.max(...span) > 170, 'the line travels the whole length');
  // Bare paper: of a grid of points inside the bar, under half lie within a piece's reach.
  let inside = 0; let inked = 0;
  const cells = new Set(pieces.map(([x, y]) => Math.round(x / 2) + ',' + Math.round(y / 2)));
  for (let u = -198; u <= 198; u += 2) for (let v = -38; v <= 38; v += 2) {
    inside++;
    if (cells.has(Math.round((300 + u * c - v * s) / 2) + ',' + Math.round((300 + u * s + v * c) / 2))) inked++;
  }
  assert.ok(inked / inside > 0.15 && inked / inside < 0.5, 'share of the bar under a piece: ' + (inked / inside).toFixed(2));
  assert.deepEqual(laid(bar), pieces, 'the same scribble at the same seed');
  // Two prongs joined by a bridge at one end: no piece is laid across the gap between them.
  const fork = [[0, 0], [400, 0], [400, 60], [80, 60], [80, 140], [400, 140], [400, 200], [0, 200]];
  const gap = laid(fork, { angle: 0, over: 0 }).filter(([x, y]) => x > 110 && y > 75 && y < 125 && !pointInPoly([x, y], fork)).length;
  assert.equal(gap, 0, gap + ' pieces in the gap between the prongs');
});

test('manga speedLines with a path run beside it, keep out of the clear lane and leave out lines folded by a tight turn', () => {
  const { speedLines } = require('../skills/artifex/styles/manga.js');
  const { rng } = require('../core/rand.js');
  const box = [0, 0, 400, 200]; const w = 2;
  // A level path: every line is level, at its own height.
  const level = recorder();
  speedLines(level.g, rng(3), 'level', box, { path: [[0, 100], [200, 100], [400, 100]], count: 40, w });
  const lines = level.polys();
  assert.ok(lines.length > 20, lines.length + ' lines drawn');
  const tilted = lines.filter((p) => Math.max(...p.map((q) => q[1])) - Math.min(...p.map((q) => q[1])) > 2 * w).length;
  assert.equal(tilted, 0, tilted + ' lines leave the level');
  assert.ok(new Set(lines.map((p) => Math.round(p[0][1]))).size > 10, 'the lines sit at many heights');
  // A clear lane on the path: no line enters it, and lines that cross it are cut in two.
  const lane = recorder();
  speedLines(lane.g, rng(3), 'lane', box, { path: [[0, 100], [200, 100], [400, 100]], count: 40, w, reach: [1, 1], clear: [200, 100, 40] });
  const inLane = lane.polys().flat().filter(([x, y]) => Math.hypot(x - 200, y - 100) < 40 - 1.5 * w).length;
  assert.equal(inLane, 0, inLane + ' outline points inside the lane');
  const near = lane.polys().filter((p) => Math.abs(p[0][1] - 100) < 30);
  assert.ok(near.some((p) => p.every(([x]) => x < 200)) && near.some((p) => p.every(([x]) => x > 200)), 'lines through the lane are cut either side of it');
  // A circle of radius 20: offsets up to the box's half-diagonal, so lines on its inside past 20 fold and are left out.
  const turn = recorder();
  const circle = Array.from({ length: 65 }, (_, k) => [200 + 20 * Math.cos((k / 64) * Math.PI * 2), 100 + 20 * Math.sin((k / 64) * Math.PI * 2)]);
  speedLines(turn.g, rng(3), 'turn', box, { path: circle, count: 40, w, reach: [1, 1] });
  const drawn = turn.polys().length;
  assert.ok(drawn > 5 && drawn < 35, drawn + ' of 40 lines drawn round a tight turn');
});

test('voxel drawBoxes paints a long box behind each small box resting on it, wherever the small box sits', () => {
  const { recordMarks, paintOrder } = require('../tools/contact-sheet.js');
  const { drawBoxes, iso } = require('../skills/artifex/styles/voxel.js');
  const tex = { long: () => '#aa0000', small: () => '#00aa00' };
  for (const sx of [0, 2, 3.5, 5, 7]) {
    const boxes = [{ x: 0, y: 0, z: 0, w: 8, d: 1, h: 1, mat: 'long', free: true }, { x: sx, y: 0, z: 1, w: 1, d: 1, h: 1, mat: 'small', free: true }];
    const marks = recordMarks({ w: 800, h: 600 }, (g) => drawBoxes(g, boxes, new Set(), iso(20, 400, 100), tex, { texels: 2 }));
    const order = paintOrder(marks, { long: (m) => /^#..0000$/.test(m.style), small: (m) => /^#00..00$/.test(m.style) })['long/small'];
    assert.ok(order.behind > 0 && order.front === 0, `small box at x ${sx}: ${JSON.stringify(order)}`);
  }
});

// The indices in `boxes` of the boxes drawBoxes paints, in paint order, read
// from the texture ids it passes with base 0; a box with no visible face is absent.
function voxelPaintOrder(boxes, cell) {
  const { drawBoxes, iso } = require('../skills/artifex/styles/voxel.js');
  const order = [];
  const tex = new Proxy({}, { get: () => (face, u, v, id) => { if (order[order.length - 1] !== id) order.push(id); return '#808080'; } });
  drawBoxes({ save() {}, restore() {}, transform() {}, fillRect() {} }, boxes, cell, iso(20, 400, 100), tex, { texels: 1 });
  return order;
}

// Whether two boxes overlap on screen under iso(), and whether box a lies
// behind box b, as backToFront tests them.
const VOXEL_E = 1e-9;
const voxelSpan = ({ x, y, z, w, d, h }) => [x - y - d, x + w - y, y - z - h, y + d - z, x - z - h, x + w - z];
const voxelOverlap = (a, b) => { const p = voxelSpan(a), q = voxelSpan(b); return ![0, 2, 4].some((k) => p[k] >= q[k + 1] - VOXEL_E || q[k] >= p[k + 1] - VOXEL_E); };
const voxelBehind = (a, b) => a.x + a.w <= b.x + VOXEL_E || a.y + a.d <= b.y + VOXEL_E || a.z + a.h <= b.z + VOXEL_E;

test('voxel drawBoxes keeps the depth order of a block world whose depth order is already back to front', () => {
  const { rng } = require('../core/rand.js');
  const { world, depth } = require('../skills/artifex/styles/voxel.js');
  const R = rng(5);
  const { boxes, cell, block } = world();
  for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) for (let z = 0; z <= R('h', 'top', x * 16 + y) * 4; z++) block(x, y, z, 'm');
  // Free boxes of mixed sizes, apart from the blocks and from each other.
  for (let i = 0; i < 6; i++) boxes.push({ x: 14 + i * 3, y: -4 - i * 3, z: 0, w: 1 + (i % 3) * 0.5, d: 1, h: 0.5 + i * 0.3, mat: 'm', free: true });
  const order = voxelPaintOrder(boxes, cell);
  const painted = new Set(order);
  const sorted = boxes.slice().sort((p, q) => depth(p) - depth(q)).map((b) => boxes.indexOf(b)).filter((k) => painted.has(k));
  assert.equal(order.length, sorted.length, 'boxes painted');
  assert.equal(order.findIndex((k, i) => k !== sorted[i]), -1, 'first box out of depth order');
});

test('voxel drawBoxes paints a grid cube that waits on a free box before the grid cube in front of it', () => {
  const { world } = require('../skills/artifex/styles/voxel.js');
  const { boxes, cell, block } = world();
  // The long free box lies behind the back cube and paints after the front
  // cube by depth; the front cube overlaps the back cube but not the long box.
  block(0, 0, 0, 'back');
  block(0, 1, 0, 'front');
  boxes.push({ x: 0, y: -1, z: 0, w: 8, d: 1, h: 1, mat: 'long', free: true });
  assert.deepEqual(voxelPaintOrder(boxes, cell).map((k) => boxes[k].mat), ['long', 'back', 'front'], 'paint order');
});

test('voxel drawBoxes paints each box after every box it lies in front of on screen, in one pinned order, on a free slab under two layers of blocks with free boxes on top', () => {
  const { world } = require('../skills/artifex/styles/voxel.js');
  const { boxes, cell, block } = world();
  boxes.push({ x: 0, y: 0, z: 0, w: 24, d: 24, h: 1, mat: 'm', free: true });
  for (let x = 0; x < 24; x++) for (let y = 0; y < 24; y++) for (let z = 1; z <= 2; z++) block(x, y, z, 'm');
  for (let i = 0; i < 8; i++) boxes.push({ x: 0.3 + i * 2.6, y: 0.5 + (i * 5) % 20, z: 3, w: 0.5 + (i % 3), d: 0.75, h: 0.6, mat: 'm', free: true });
  const order = voxelPaintOrder(boxes, cell);
  const at = new Map(order.map((k, i) => [k, i]));
  // Every pair of painted boxes, tested directly: overlapping on screen, one behind the other.
  let wrong = 0;
  for (const i of order) for (const j of order) {
    if (voxelOverlap(boxes[i], boxes[j]) && voxelBehind(boxes[j], boxes[i]) && !voxelBehind(boxes[i], boxes[j]) && at.get(j) > at.get(i)) wrong++;
  }
  assert.equal(wrong, 0, 'pairs painted front first');
  assert.equal(sha(order.join()), '84dda9caed7ce4ff3a1f6545a513edfef0a936b9e7809455cefe74b0264e3b71', `paint order of ${order.length} boxes`);
});

test('voxel drawBoxes paints each box after every box it lies in front of on screen, in one pinned order, among more than 16 wide slabs, two vast ones, small boxes and posts that cut through the slabs', () => {
  const { rng } = require('../core/rand.js');
  const R = rng(11);
  const boxes = [];
  // Four floors, each six thin slabs at their own heights under ten by ten small boxes.
  for (let k = 0; k < 4; k++) {
    for (let m = 0; m < 6; m++) {
      const s = k * 6 + m;
      boxes.push({ x: -6 + R('slab', 'x', s) * 20, y: -6 + R('slab', 'y', s) * 20, z: 3 * k + 0.25 * m, w: 16 + R('slab', 'w', s) * 14, d: 16 + R('slab', 'd', s) * 14, h: 0.2, mat: 'm', free: true });
    }
    for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) {
      const s = (k * 10 + i) * 10 + j;
      boxes.push({ x: 2 * i + R('box', 'x', s) * 0.5, y: 2 * j + R('box', 'y', s) * 0.5, z: 3 * k + 1.5 + R('box', 'z', s) * 0.25, w: 0.5 + R('box', 'w', s) * 0.9, d: 0.5 + R('box', 'd', s) * 0.9, h: 0.5 + R('box', 'h', s) * 0.7, mat: 'm', free: true });
    }
  }
  boxes.push({ x: -200, y: -200, z: -2, w: 400, d: 400, h: 1, mat: 'm', free: true });
  boxes.push({ x: -150, y: -150, z: 13, w: 300, d: 300, h: 1, mat: 'm', free: true });
  for (let p = 0; p < 12; p++) boxes.push({ x: R('post', 'x', p) * 20, y: R('post', 'y', p) * 20, z: R('post', 'z', p) * 9, w: 0.3, d: 0.3, h: 4, mat: 'm', free: true });
  const order = voxelPaintOrder(boxes, new Set());
  const at = new Map(order.map((k, i) => [k, i]));
  let wrong = 0;
  for (const [i, p] of at) for (const [j, q] of at) {
    if (voxelOverlap(boxes[i], boxes[j]) && voxelBehind(boxes[i], boxes[j]) && !voxelBehind(boxes[j], boxes[i]) && p > q) wrong++;
  }
  assert.equal(wrong, 0, 'pairs painted front first');
  assert.equal(sha(order.join()), '9de462996dda2df2e5e34f1c3b5ad0dd45de4ff5c3934aac1cc10b4c2cc1c21c', `paint order of ${order.length} boxes`);
  // A box past exact whole-number cells, apart from all the others, paints last and moves none of them.
  const far = voxelPaintOrder([...boxes, { x: 1e17, y: 0, z: 0, w: 1, d: 1, h: 1, mat: 'm', free: true }], new Set());
  assert.equal(far.length, order.length + 1, 'boxes painted with a box at x 1e17');
  assert.equal(far.findIndex((k, i) => k !== order[i]), order.length, 'first index that differs with a box at x 1e17');
});

test('voxel drawBoxes gives every other box the same texture id when a free box moves through a row of blocks, in a list drawn on every frame', () => {
  const { world, drawBoxes, iso } = require('../skills/artifex/styles/voxel.js');
  const g = { save() {}, restore() {}, transform() {}, fillRect() {} };
  // One list drawn frame after frame, as a film does, with only the free box moving.
  const { boxes, cell, block } = world();
  for (let i = 0; i < 5; i++) block(i, 0, 0, 'b' + i);
  const free = { x: 0, y: 0.25, z: 1, w: 0.5, d: 0.5, h: 0.5, mat: 'free', free: true };
  boxes.push(free);
  // The ids each block's texture receives, by block, with the free box at x.
  const ids = (x) => {
    free.x = x;
    const seen = {};
    const tex = new Proxy({}, { get: (o, mat) => (face, u, v, id) => { (seen[mat] ||= new Set()).add(id); return '#808080'; } });
    drawBoxes(g, boxes, cell, iso(20, 400, 100), tex, { texels: 1, base: 30 });
    return Object.fromEntries(Object.entries(seen).map(([mat, s]) => [mat, [...s].join()]));
  };
  const first = ids(0.25);
  for (const x of [4.25, 0.25, 4.25]) {
    const now = ids(x);
    for (let i = 0; i < 5; i++) assert.equal(now['b' + i], first['b' + i], `block ${i} texture ids, free box at x 0.25 then ${x}`);
  }
});

test('voxel drawBoxes keeps the texture id of each keyed box when a box is inserted before it in the list', () => {
  const { drawBoxes, iso } = require('../skills/artifex/styles/voxel.js');
  const g = { save() {}, restore() {}, transform() {}, fillRect() {} };
  const boxes = [0, 1, 2, 3].map((i) => ({ x: i * 2, y: 0, z: 0, w: 1, d: 1, h: 1, mat: 'b' + i, key: 100 + i * 7, free: true }));
  // The ids each box's texture receives, by box.
  const ids = () => {
    const seen = {};
    const tex = new Proxy({}, { get: (o, mat) => (face, u, v, id) => { (seen[mat] ||= new Set()).add(id); return '#808080'; } });
    drawBoxes(g, boxes, new Set(), iso(20, 400, 100), tex, { texels: 1 });
    return Object.fromEntries(Object.entries(seen).map(([mat, s]) => [mat, [...s].join()]));
  };
  const first = ids();
  boxes.splice(1, 0, { x: 0, y: 3, z: 0, w: 1, d: 1, h: 1, mat: 'new', free: true });
  const now = ids();
  for (let i = 0; i < 4; i++) assert.equal(now['b' + i], first['b' + i], `box ${i} texture ids after an insert at index 1`);
  assert.equal(now.new, '1', 'an unkeyed box takes base plus its index');
});

test('voxel drawBoxes starts a cycle of three interlocking boxes at its lowest-depth box, follows the cycle, and paints a box resting on it after its support', () => {
  const { depth } = require('../skills/artifex/styles/voxel.js');
  const draw = (boxes) => voxelPaintOrder(boxes, new Set()).map((k) => boxes[k]);
  // Each set lists three boxes in cycle order: each lies behind the next where
  // they overlap on screen, and the last behind the first. The second set's
  // depth order runs against the cycle.
  for (const set of [[[0, 3, 0, 4, 3, 1], [0, 2, 2, 2, 3, 4], [2, 0, 0, 3, 3, 3]], [[1, 1, 3, 2, 4, 4], [3, 2, 2, 4, 1, 2], [2, 3, 1, 4, 2, 2]]]) {
    const cycle = set.map(([x, y, z, w, d, h]) => ({ x, y, z, w, d, h, mat: 'm', free: true }));
    const low = cycle.indexOf(cycle.slice().sort((p, q) => depth(p) - depth(q))[0]);
    const expected = [...cycle.slice(low), ...cycle.slice(0, low)];
    const order = draw(cycle);
    assert.deepEqual(order.map((b) => cycle.indexOf(b)), expected.map((b) => cycle.indexOf(b)), `paint order of ${JSON.stringify(set)}`);
  }
  // A small box on the first set's first box, lower in depth than the whole cycle.
  const cycle = [[0, 3, 0, 4, 3, 1], [0, 2, 2, 2, 3, 4], [2, 0, 0, 3, 3, 3]].map(([x, y, z, w, d, h]) => ({ x, y, z, w, d, h, mat: 'm', free: true }));
  const top = { x: 0, y: 4.5, z: 1, w: 0.5, d: 0.5, h: 0.5, mat: 'm', free: true };
  const order = draw([...cycle, top]);
  assert.ok(order.indexOf(top) > order.indexOf(cycle[0]), `box on top painted at ${order.indexOf(top)}, its support at ${order.indexOf(cycle[0])}`);
});

test('voxel drawBoxes paints a third box behind one of two boxes that cut into each other and in front of the other between them', () => {
  // A and B intersect; C lies behind A (below it) and in front of B (past its far y side).
  const boxes = [[0, 0, 2, 2, 2, 1], [0.5, 0.5, 1.5, 2, 1, 1], [1.9, 1.9, 1, 1, 1, 1]].map(([x, y, z, w, d, h], k) => ({ x, y, z, w, d, h, mat: 'ABC'[k], free: true }));
  assert.equal(voxelPaintOrder(boxes, new Set()).map((k) => boxes[k].mat).join(' '), 'B C A', 'paint order');
});

test('voxel drawBoxes paints two boxes that cut into each other in depth order when a box behind one of them leaves the other free first', () => {
  // A and B intersect, A of lower depth; C lies below A, apart from B on screen, and of higher depth than B.
  const boxes = [[0, 0, 2, 2, 2, 1], [0.5, -0.5, 2.5, 1.5, 2, 1.5], [1, -0.5, 0, 7, 3, 1.5]].map(([x, y, z, w, d, h], k) => ({ x, y, z, w, d, h, mat: 'ABC'[k], free: true }));
  assert.equal(voxelPaintOrder(boxes, new Set()).map((k) => boxes[k].mat).join(' '), 'C A B', 'paint order');
});

test('voxel drawBoxes paints no box before a box it lies behind on screen in random scenes of free boxes that may cut into each other', () => {
  const { rng } = require('../core/rand.js');
  const R = rng(7);
  let wrong = 0, first = null, scenes = 0;
  for (let s = 0; s < 3000; s++) {
    const n = 3 + Math.floor(R('scene', 'n', s) * 8);
    const v = (k, p, max) => Math.round(R('box', p, s * 16 + k) * max) / 10;
    const boxes = Array.from({ length: n }, (_, k) => ({ x: v(k, 'x', 30), y: v(k, 'y', 30), z: v(k, 'z', 20), w: 0.3 + v(k, 'w', 15), d: 0.3 + v(k, 'd', 15), h: 0.3 + v(k, 'h', 10), mat: 'm', free: true }));
    // Each box lies behind the boxes in `ahead` on screen; a scene whose
    // relations form a cycle has no right order, so it is skipped.
    const ahead = boxes.map((a) => boxes.filter((b) => a !== b && voxelOverlap(a, b) && voxelBehind(a, b) && !voxelBehind(b, a)));
    const need = new Map(boxes.map((b) => [b, 0]));
    ahead.flat().forEach((b) => need.set(b, need.get(b) + 1));
    const free = boxes.filter((b) => !need.get(b));
    for (let k = 0; k < free.length; k++) for (const b of ahead[boxes.indexOf(free[k])]) if (need.set(b, need.get(b) - 1).get(b) === 0) free.push(b);
    if (free.length < n) continue;
    scenes++;
    const at = new Map(voxelPaintOrder(boxes, new Set()).map((k, i) => [k, i]));
    for (const [i, p] of at) for (const [j, q] of at) {
      if (voxelOverlap(boxes[i], boxes[j]) && voxelBehind(boxes[i], boxes[j]) && !voxelBehind(boxes[j], boxes[i]) && p > q) { wrong++; first ||= { scene: s, behind: boxes[i], front: boxes[j] }; }
    }
  }
  assert.ok(scenes > 2000, `${scenes} scenes without a cycle`);
  assert.equal(wrong, 0, `pairs painted front first, first: ${JSON.stringify(first)}`);
});

test('drawPng refuses a canvas whose toBlob returns null by name instead of reading null', async () => {
  const canvas = { getContext: () => ({}), toBlob: (done) => done(null) };
  const piece = { validate: (p) => p, atBox: (p) => p, solve: () => ({ stages: {}, manifest: {} }) };
  const saved = { window: global.window, document: global.document };
  global.window = { __artifex: { piece, examples: { demo: { size: { w: 4, h: 2 } } }, render: { drawFrame: () => 0 } } };
  global.document = { createElement: () => canvas };
  try {
    await assert.rejects(styles.drawPng('demo', 1, 0, 8, null), { message: 'styles: the browser could not encode a 8 x 4 PNG of demo; nothing was written' });
  } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete global[key]; else global[key] = value; }
  }
});

test('papercraft mottle fades each disc to nothing at its rim, so no circle edge shows', () => {
  const { mottle } = require('../skills/artifex/styles/papercraft.js');
  const alpha = (c) => Number(/([\d.]+)\)\s*$/.exec(c)[1]);
  const discs = [];
  let style;
  const g = new Proxy({}, {
    get: (_, key) => {
      if (key === 'createRadialGradient') return (x0, y0, r0, x1, y1, r1) => { const stops = []; return { r0, r1, stops, addColorStop: (at, c) => stops.push([at, c]) }; };
      if (key === 'arc') return (x, y, r) => discs.push({ fade: style, r });
      return () => {};
    },
    set: (_, key, value) => { if (key === 'fillStyle') style = value; return true; },
  });
  mottle(g, () => 0.25, 'mt', 0, 0, 400, 300, { n: 5 });
  assert.equal(discs.length, 5, 'five discs');
  for (const { fade, r } of discs) {
    assert.equal(typeof fade, 'object', 'a disc is filled with a gradient, not one flat colour');
    assert.equal(fade.r0, 0);
    assert.equal(fade.r1, r, 'the falloff ends at the disc rim');
    const [first, last] = [fade.stops[0], fade.stops[fade.stops.length - 1]];
    assert.ok(alpha(first[1]) > 0 && alpha(first[1]) <= 0.03, 'the centre stays at or under alpha 0.03');
    assert.equal(alpha(last[1]), 0, 'the rim is fully transparent');
  }
});
