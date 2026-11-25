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
  // The open library ships no named style: the owner keeps them private (2026-11-25), so one here would publish it.
  assert.deepEqual(list, [], 'builtin.json lists no style in the open library');
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
  assert.match(text, /empty +broken: no style\.json/);
});

test('an unknown style name lists every built-in and installed style and the install folder', (t) => {
  const { dir, env } = tempHome(t);
  assert.throws(() => styles.resolve('puntillismo', env), {
    message: 'style: no style named "puntillismo". Available: none installed. Packs are installed in ' + path.join(dir, 'styles') + '.',
  });
  makePack(dir);
  assert.throws(() => styles.resolve('puntillismo', env), {
    message: 'style: no style named "puntillismo". Available: pointillism (installed). Packs are installed in ' + path.join(dir, 'styles') + '.',
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
  assert.equal(report.styles.length, 1, 'the installed pack is the only style');
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
  for (const [tool, prefix, args] of [['build-page.js', 'page', []], ['contact-sheet.js', 'seeds', ['2', '0.5']]]) {
    const refused = run(tool, '--style', name, ...args);
    assert.equal(refused.status, 1, tool);
    assert.match(refused.stderr, new RegExp('^' + escape(prefix + ': ' + cause) + '\\nusage: [^\\n]+\\n$'), tool);
    const unknown = run(tool, '--style', 'puntillismo', ...args);
    assert.equal(unknown.status, 1, tool);
    assert.match(unknown.stderr, new RegExp('^' + prefix + ': --style draws nothing, since a style is a guide and the functions that draw its marks, not a picture; no style named "puntillismo"\\. Available: ' + name + ' \\(installed\\)\\. Packs are installed in .+\\nusage: '), tool);
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
      + "const { ink } = require('./lib/ink.js');\nconst more = require('./more/ink');\nconst data = require('./data.json');\nconst kit = require('artifex/styles/kit.js');\n"
      + 'module.exports = { dot(g, x, y) { g.fillStyle = ink; g.fillRect(lerp(x, x, 0), y, 1, 1); } };\n',
    'lib/ink.js': INK,
    'more/ink.js': "const data = require('../data.json');\nmodule.exports = { ink: data.ink };\n",
    'data.json': '{ "ink": "#295c7b" }\n',
    'check.js': "const { dot } = require('./dotted.js');\nmodule.exports = { dot: { box: [0, 0, 4, 4], draw(g) { dot(g, 1, 1); } } };\n",
  });
  const sources = styles.packSources([[path.join(dir, 'dotted.js'), 'marks.cjs'], [path.join(dir, 'check.js'), 'proof.cjs']]);
  assert.deepEqual(Object.keys(sources).sort(), ['lib/data.json', 'lib/ink-2.js', 'lib/ink.js', 'lib/kit.js', 'marks.cjs', 'proof.cjs']);
  assert.equal(sources['marks.cjs'], "\nconst { rng } = require(\"artifex/core/rand.js\");\nconst { lerp } = require(\"artifex/core/num.js\");\n"
    + "const font = require(\"artifex/core/stroke-font.js\");\nconst { ink } = require(\"./lib/ink.js\");\n"
    + "const more = require(\"./lib/ink-2.js\");\nconst data = require(\"./lib/data.json\");\nconst kit = require(\"./lib/kit.js\");\n"
    + 'module.exports = { dot(g, x, y) { g.fillStyle = ink; g.fillRect(lerp(x, x, 0), y, 1, 1); } };\n');
  assert.equal(sources['proof.cjs'], "const { dot } = require(\"./marks.cjs\");\nmodule.exports = { dot: { box: [0, 0, 4, 4], draw(g) { dot(g, 1, 1); } } };\n");
  assert.equal(sources['lib/ink-2.js'], "const data = require(\"./data.json\");\nmodule.exports = { ink: data.ink };\n");
  assert.equal(sources['lib/kit.js'].includes('require("artifex/core/geom.js")'), true, 'the shared kit is copied, requiring core by name');

  const reaching = project(t, { 'drift.js': "module.exports = require('" + LIBRARY + "/examples/drift.js');\n" });
  assert.throws(() => styles.packSources([[path.join(reaching, 'drift.js'), 'marks.cjs']]),
    /requires .*drift\.js, the library file examples\/drift\.js; a pack may require only its own files and artifex\/core\/<file>\.js$/);
});

test('a pack guide needs a title and the built-in guides\' headings in order', () => {
  assert.equal(styles.guideProblem(GUIDE), null);
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

test('pack copies a required kit.js into lib/, and the pack checks from a clean copy', async (t) => {
  const { dir, env } = tempHome(t);
  const author = project(t, {
    'marks.js': "const { path } = require('artifex/styles/kit.js');\n"
      + "// A crease along (x0, y0)-(x1, y1).\nfunction crease(g, x0, y0, x1, y1) { g.strokeStyle = '#432'; path(g, [[x0, y0], [x1, y1]], false); g.stroke(); }\nmodule.exports = { crease };\n",
    'proof.js': 'module.exports = { crease: { box: [0, 0, 40, 40], draw(g, marks) { marks.crease(g, 5, 5, 35, 35); } } };\n',
    'guide.md': GUIDE,
  });
  await styles.pack({ marks: path.join(author, 'marks.js'), proof: path.join(author, 'proof.js'), name: 'creased', guide: path.join(author, 'guide.md'), summary: 'Creases.' }, env, quiet);
  const folder = path.join(dir, 'styles', 'creased');
  const read = (file) => fs.readFileSync(path.join(folder, file), 'utf8');
  assert.deepEqual(Object.keys(JSON.parse(read('style.json')).files).sort(), ['guide.md', 'lib/kit.js', 'marks.cjs', 'proof.cjs']);
  assert.match(read('marks.cjs'), /^const \{ path \} = require\("\.\/lib\/kit\.js"\);/);
  assert.match(read('lib/kit.js'), /require\("artifex\/core\/geom\.js"\)/);
  assert.doesNotMatch(read('lib/kit.js'), /\.\.\/core\//, 'lib/kit.js reaches no library path');

  // A clean copy in another home, with the author's project gone, trusts and checks.
  fs.rmSync(author, { recursive: true, force: true });
  const other = tempHome(t);
  fs.cpSync(folder, path.join(other.dir, 'styles', 'creased'), { recursive: true });
  styles.trust('creased', other.env, quiet);
  const shown = [];
  await styles.check('creased', other.env, (line) => shown.push(line));
  assert.match(shown.at(-1), /^check creased: 4 files match style\.json, trusted, .* exports its 1 mark functions/);
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
  for (const spine of [[], [[5, 5]], [[5, 5], [5, 5]]]) {
    assert.deepEqual(bristles(rng(7), 'none', spine, { dryFrom: 0 }), [], JSON.stringify(spine));
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

// Where a hand is `d` along `lines` drawn one after another, by core grow.
function along(lines, d) {
  const { grow } = require('../core/path.js');
  for (const [k, line] of lines.entries()) {
    const { total } = grow(line, Infinity);
    if (d <= total || k === lines.length - 1) return grow(line, d);
    d -= total;
  }
}

test('kit upTo: whole lines before the share, the one it ends in up to a point index, core grow\'s tip there, and a share that is no number refused', () => {
  const { upTo } = require('../skills/artifex/styles/kit.js');
  const lines = [[[0, 0], [10, 0]], [[0, 10], [0, 14], [0, 20]]];
  assert.deepEqual(upTo(lines, 0.75, 'x'), { line: 1, at: 1 + 1 / 6, points: [[0, 10], [0, 14], [0, 15]], tip: [0, 15], heading: Math.PI / 2 });
  assert.deepEqual(upTo(lines, 0, 'x'), { line: 0, at: 0, points: [[0, 0]], tip: [0, 0], heading: 0 });
  assert.deepEqual([upTo(lines, 0.5, 'x').line, upTo(lines, 0.5, 'x').at], [0, 1], 'a share ending on a line\'s last point starts no later line');
  assert.deepEqual(upTo(lines, 3, 'x').tip, [0, 20], 'a share past 1 is clamped');
  assert.equal(upTo([], 0.5, 'x').tip, null);
  for (const bad of [NaN, '0.5', undefined]) assert.throws(() => upTo(lines, bad, 'manga pen'), new RegExp('^TypeError: manga pen: grow takes a number from 0 to 1, got ' + bad + '$'));
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
