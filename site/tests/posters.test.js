'use strict';

// npm run posters: the recipe each poster is drawn from, and the rule that a
// poster whose recipe or sources changed since it was drawn is stale. Drawing
// needs installed Edge; these checks read the records the tool writes.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { stripComments, recipes: load, record, stale, writePosters, drawPoster } = require('../../tools/posters.js');

// The list of recipes alone; `load` also returns the load they came from.
const recipes = (file) => load(file).recipes;

const NUM = path.resolve(__dirname, '..', '..', 'core', 'num.js');

test('posters: the real shot list draws ink, mirror, cad, kandinsky, wall, cues, readout and settle at 1200 x 800, seed 1, each at its still playhead, WebP 0.82, and all are current', () => {
  const all = recipes(), entries = all.filter((e) => !e.name.startsWith('style-'));
  assert.deepEqual(entries.map((e) => e.name), ['ink', 'mirror', 'cad', 'kandinsky', 'wall', 'cues', 'readout', 'settle']);
  // A slow style's card poster: its demo at the site's seed, finished, 600 pixels wide.
  const cards = all.filter((e) => e.name.startsWith('style-'));
  assert.deepEqual(cards.map((e) => e.name), Object.keys(require('../shots.js').styles.posters).map((name) => 'style-' + name));
  for (const e of cards) {
    const name = e.name.slice('style-'.length);
    assert.deepEqual(e.recipe, { piece: 'demos/' + name + '.js', seed: 1, t: 1, width: 600, height: 600, type: 'image/webp', quality: 0.82 });
    assert.ok(e.sources['demos/' + name + '.js'] && e.sources['../skills/artifex/styles/' + name + '.js'], Object.keys(e.sources).join());
  }
  for (const e of entries) {
    assert.deepEqual(e.recipe, { piece: 'pieces/' + e.name + '.cjs', seed: 1, t: e.name === 'wall' ? 0.6 : 1, width: 1200, height: 800, type: 'image/webp', quality: 0.82 });
    assert.ok(e.sources['pieces/' + e.name + '.cjs'] && e.sources['pieces/paper.js'] && e.sources['core/rand.js'], Object.keys(e.sources).join());
  }
  assert.deepEqual(stale(), []);
  // The cad shot is a piece of its own, drawn by cadsheet.js: the cad style's mark functions take no
  // part in it, so the record names the sheet and not the style, and a change to either stales what it draws.
  const cad = entries.find((e) => e.name === 'cad'), wall = entries.find((e) => e.name === 'wall');
  assert.ok(cad.sources['pieces/cadsheet.js'], 'the cad poster follows its sheet');
  assert.equal(cad.sources['../skills/artifex/styles/cad.js'], undefined, 'and not the cad style, which it does not draw with');
  assert.ok(wall.sources['../skills/artifex/styles/cad.js'] && wall.sources['demos/cad.js'], 'the wall hangs the work of the cad style, so its poster follows the style');
});

// A shot list of its own: one piece with a helper and a library module, its poster and record.
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-posters-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (name, text) => { fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true }); fs.writeFileSync(path.join(dir, name), text); };
  const shots = (seed = 1, still) => write('shots.js', 'module.exports = ' + JSON.stringify({ hz: 30, seed, shots: [
    { name: 'one', piece: './pieces/one.cjs', poster: './posters/one.webp', ...(still === undefined ? {} : { still }) },
    { name: 'two', piece: './pieces/one.cjs' },
  ] }) + ';');
  write('pieces/helper.js', 'module.exports = { w: 100 };\n');
  write('pieces/one.cjs', 'const H = require("./helper.js");\nconst N = require(' + JSON.stringify(NUM) + ');\n'
    + "module.exports = { name: 'one', size: { w: H.w, h: 50 }, time: { duration: 1, hz: 30 }, draw(g) { g.fillRect(0, 0, N.clamp(1, 0, 2), 1); } };\n");
  write('posters/one.webp', 'RIFF-not-really-a-webp');
  shots();
  const file = path.join(dir, 'shots.js');
  const poster = path.join(dir, 'posters', 'one.webp');
  fs.writeFileSync(poster + '.json', record(recipes(file)[0], fs.readFileSync(poster)));
  return { dir, file, poster, write, shots };
}

test('posters: a recipe names its piece, the design size and the still playhead, and hashes every source the piece reaches', (t) => {
  const f = fixture(t);
  const [entry, ...rest] = recipes(f.file);
  assert.equal(rest.length, 0, 'a shot without a poster has no recipe');
  assert.deepEqual(entry.recipe, { piece: 'pieces/one.cjs', seed: 1, t: 1, width: 100, height: 50, type: 'image/webp', quality: 0.82 });
  assert.deepEqual(Object.keys(entry.sources), ['core/num.js', 'pieces/helper.js', 'pieces/one.cjs']);
  assert.deepEqual(stale(f.file), []);
});

test('posters: a changed helper, seed, still playhead or size makes the poster stale, naming what moved', (t) => {
  const f = fixture(t);
  f.write('pieces/helper.js', 'module.exports = { w: 100, h: 1 };\n');
  assert.match(stale(f.file).join('\n'), /poster one: sources changed since it was drawn \(pieces\/helper\.js\)/);
  f.write('pieces/helper.js', 'module.exports = { w: 120 };\n');
  assert.match(stale(f.file).join('\n'), /drawn from another recipe \(width 100 -> 120\)/);
  f.write('pieces/helper.js', 'module.exports = { w: 100 };\n');
  assert.deepEqual(stale(f.file), [], 'the helper as it was is current again');
  f.shots(2, 0.5);
  assert.match(stale(f.file).join('\n'), /drawn from another recipe \(seed 1 -> 2, t 1 -> 0\.5\)/);
});

test('posters: a comment edit leaves a record current, while a code edit changes it', (t) => {
  const f = fixture(t);
  const before = record(recipes(f.file)[0], fs.readFileSync(f.poster));
  f.write('pieces/helper.js', '// a note\n/* and\n   another */\nmodule.exports = { w: 100 }; // retouched\n');
  assert.deepEqual(stale(f.file), []);
  assert.equal(record(recipes(f.file)[0], fs.readFileSync(f.poster)), before, 'the record text is byte-identical');
  f.write('pieces/helper.js', 'module.exports = { w: 100, x: 1 };\n');
  assert.notEqual(record(recipes(f.file)[0], fs.readFileSync(f.poster)), before);
  const same = (a, b) => assert.equal(stripComments(a), stripComments(b));
  same("const s = 'a // b' + \"/* c */\" + `d // ${1 /* e */ + 2} f`; // g\n", "const s = 'a // b' + \"/* c */\" + `d // ${1 + 2} f`;\n");
  assert.notEqual(stripComments('const s = "a // b";'), stripComments('const s = "a // c";'));
  assert.notEqual(stripComments('const r = /a\\/\\/b/;'), stripComments('const r = /a\\/\\/c/;'));
  assert.notEqual(stripComments('const x = 4 / 2; // d'), stripComments('const x = 4 / 3; // d'));
  // A regex after a control head is a regex, so a `//` inside it is not a comment.
  assert.equal(stripComments('if (ok) /[//]/.test(u) // c'), 'if (ok) /[//]/.test(u)');
  assert.notEqual(stripComments('if (ok) /[//]/.test(u) // c'), stripComments('if (ok) /[//]/.test(v) // c'));
  assert.equal(stripComments('a = (b) / 2 / 3; // c'), 'a = (b) / 2 / 3;');
  // A slash after a postfix increment or a property named like a keyword divides.
  assert.equal(stripComments('n++ / 2 /* c */ + 1;'), 'n++ / 2 + 1;');
  assert.equal(stripComments('x = s.of / 2; // c'), 'x = s.of / 2;');
  // An inline block comment keeps the tokens apart.
  assert.notEqual(stripComments('return/*c*/a'), stripComments('returna'));
  same('return/*c*/a', 'return a');
});

test('posters: a leading BOM or a lone CR leaves the source hash alone', (t) => {
  const f = fixture(t);
  const before = record(recipes(f.file)[0], fs.readFileSync(f.poster));
  for (const text of ['\uFEFFmodule.exports = { w: 100 };\n', 'module.exports = { w: 100 };\r', '\uFEFFmodule.exports = { w: 100 };\r\n']) {
    f.write('pieces/helper.js', text);
    assert.equal(record(recipes(f.file)[0], fs.readFileSync(f.poster)), before, JSON.stringify(text));
    assert.deepEqual(stale(f.file), []);
  }
});

test('posters: two posters naming one piece load it once per recipes() call', (t) => {
  const f = fixture(t);
  const key = '__artifexPosterLoads';
  t.after(() => { delete globalThis[key]; });
  f.write('pieces/counted.cjs', 'globalThis.' + key + ' = (globalThis.' + key + ' || 0) + 1;\n'
    + "module.exports = { name: 'counted', size: { w: 10, h: 10 }, time: { duration: 1, hz: 30 }, draw() {} };\n");
  f.write('counted-shots.js', 'module.exports = ' + JSON.stringify({ hz: 30, seed: 1, shots: [
    { name: 'a', piece: './pieces/counted.cjs', poster: './posters/a.webp' },
    { name: 'b', piece: './pieces/counted.cjs', poster: './posters/b.webp' },
  ] }) + ';');
  const file = path.join(f.dir, 'counted-shots.js');
  globalThis[key] = 0;
  assert.equal(recipes(file).length, 2);
  assert.equal(globalThis[key], 1, 'the piece ran once for two shots');
  assert.equal(recipes(file).length, 2);
  assert.equal(globalThis[key], 2, 'the next call loads it again');
});

test('posters: two spellings of one piece file load it once', (t) => {
  const f = fixture(t);
  const key = '__artifexPosterSpellings';
  t.after(() => { delete globalThis[key]; });
  f.write('pieces/counted.cjs', 'globalThis.' + key + ' = (globalThis.' + key + ' || 0) + 1;\n'
    + "module.exports = { name: 'counted', size: { w: 10, h: 10 }, time: { duration: 1, hz: 30 }, draw() {} };\n");
  f.write('spelled-shots.js', 'module.exports = ' + JSON.stringify({ hz: 30, seed: 1, shots: [
    { name: 'a', piece: './pieces/counted.cjs', poster: './posters/a.webp' },
    { name: 'b', piece: 'pieces/../pieces/counted.cjs', poster: './posters/b.webp' },
  ] }) + ';');
  globalThis[key] = 0;
  assert.equal(recipes(path.join(f.dir, 'spelled-shots.js')).length, 2);
  assert.equal(globalThis[key], 1, 'one file, one load');
});

test('posters: an extension-less spelling of one piece file loads it once', (t) => {
  const f = fixture(t);
  const key = '__artifexPosterBare';
  t.after(() => { delete globalThis[key]; });
  f.write('pieces/bare.js', 'globalThis.' + key + ' = (globalThis.' + key + ' || 0) + 1;\n'
    + "module.exports = { name: 'bare', size: { w: 10, h: 10 }, time: { duration: 1, hz: 30 }, draw() {} };\n");
  f.write('bare-shots.js', 'module.exports = ' + JSON.stringify({ hz: 30, seed: 1, shots: [
    { name: 'a', piece: './pieces/bare.js', poster: './posters/a.webp' },
    { name: 'b', piece: './pieces/bare', poster: './posters/b.webp' },
  ] }) + ';');
  globalThis[key] = 0;
  const [a, b] = recipes(path.join(f.dir, 'bare-shots.js'));
  assert.equal(globalThis[key], 1, 'one file, one load');
  assert.deepEqual(a.sources, b.sources);
  assert.equal(a.recipe.piece, 'pieces/bare.js');
  assert.equal(b.recipe.piece, 'pieces/bare.js');
});

test('posters: writePosters evaluates each piece module once per run, reusing the recipes load', async (t) => {
  const f = fixture(t);
  const key = '__artifexPosterWrites';
  t.after(() => { delete globalThis[key]; });
  f.write('pieces/counted.cjs', 'globalThis.' + key + ' = (globalThis.' + key + ' || 0) + 1;\n'
    + "module.exports = { name: 'counted', size: { w: 10, h: 10 }, time: { duration: 1, hz: 30 }, draw() {} };\n");
  f.write('write-shots.js', 'module.exports = ' + JSON.stringify({ hz: 30, seed: 1, shots: [
    { name: 'a', piece: './pieces/counted.cjs', poster: './posters/a.webp' },
  ] }) + ';');
  globalThis[key] = 0;
  // No browser at this path: the run stops after it has loaded and bundled, before any drawing.
  await assert.rejects(writePosters({ edge: path.join(f.dir, 'no-such-edge.exe'), timeoutMs: 5000 }, path.join(f.dir, 'write-shots.js')), /installed Microsoft Edge was not found/);
  assert.equal(globalThis[key], 1, 'the piece ran once for the whole run');
});

test('posters: a canvas whose toBlob returns null is refused by name, and a blob of another type too', async (t) => {
  let blob = null;
  const canvas = { getContext: () => ({}), toBlob: (cb) => cb(blob) };
  const saved = ['__require', 'document'].map((k) => [k, globalThis[k]]);
  t.after(() => { for (const [k, v] of saved) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; } });
  const mods = {
    'core/piece.js': { validate: (p) => p, solve: () => ({ stages: {} }) },
    'core/render.js': { drawFrame() {} },
    'examples/index.js': { demo: { size: { w: 10, h: 10 } } },
  };
  globalThis.__require = () => (id) => mods[id];
  globalThis.document = { createElement: () => canvas };
  const recipe = { seed: 1, t: 1, width: 10, height: 10, type: 'image/webp', quality: 0.82 };
  await assert.rejects(drawPoster('demo', recipe),
    (e) => e.message === 'posters: the browser could not encode a 10 x 10 image/webp poster of demo; nothing was written');
  blob = { type: 'image/png', arrayBuffer: async () => new ArrayBuffer(0) };
  await assert.rejects(drawPoster('demo', recipe), /posters: demo: the canvas wrote image\/png, not image\/webp/);
});

test('posters: a piece whose build stage throws is refused with the posters prefix and says nothing was written', async (t) => {
  const saved = ['__require'].map((k) => [k, globalThis[k]]);
  t.after(() => { for (const [k, v] of saved) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; } });
  const mods = {
    'core/piece.js': { validate: (p) => p, solve: () => ({ stages: { error: { stage: 'lay out', message: 'no room' } } }) },
    'core/render.js': { drawFrame() {} },
    'examples/index.js': { demo: { size: { w: 10, h: 10 } } },
  };
  globalThis.__require = () => (id) => mods[id];
  await assert.rejects(drawPoster('demo', { seed: 1, t: 1, width: 10, height: 10, type: 'image/webp', quality: 0.82 }),
    (e) => e.message === 'posters: demo: build stage "lay out" threw: no room; nothing was written');
});

test('posters: two case spellings of one piece file give one recipe.piece', (t) => {
  const f = fixture(t);
  const upper = path.join(f.dir, 'PIECES');
  if (!fs.existsSync(upper)) return t.skip('the file system tells these spellings apart');
  f.write('case-shots.js', 'module.exports = ' + JSON.stringify({ hz: 30, seed: 1, shots: [
    { name: 'a', piece: './pieces/one.cjs', poster: './posters/a.webp' },
    { name: 'b', piece: './PIECES/ONE.cjs', poster: './posters/b.webp' },
  ] }) + ';');
  const [a, b] = recipes(path.join(f.dir, 'case-shots.js'));
  assert.equal(a.recipe.piece, 'pieces/one.cjs');
  assert.equal(b.recipe.piece, 'pieces/one.cjs');
});

test('posters: a miscased first spelling of a piece file gives the same sources keys', (t) => {
  const f = fixture(t);
  if (!fs.existsSync(path.join(f.dir, 'PIECES'))) return t.skip('the file system tells these spellings apart');
  f.write('upper-shots.js', 'module.exports = ' + JSON.stringify({ hz: 30, seed: 1, shots: [
    { name: 'a', piece: './PIECES/ONE.cjs', poster: './posters/a.webp' },
  ] }) + ';');
  const [a] = recipes(path.join(f.dir, 'upper-shots.js'));
  assert.deepEqual(Object.keys(a.sources), ['core/num.js', 'pieces/helper.js', 'pieces/one.cjs']);
});

test('posters: the load records each module\'s real path beside the spelling that first reached it', (t) => {
  const f = fixture(t);
  for (const m of load(f.file).loaded.modules) assert.equal(m.real, fs.realpathSync.native(m.file), m.file);
  if (!fs.existsSync(path.join(f.dir, 'PIECES'))) return t.skip('the file system tells these spellings apart');
  f.write('upper-shots.js', 'module.exports = ' + JSON.stringify({ hz: 30, seed: 1, shots: [
    { name: 'a', piece: './PIECES/ONE.cjs', poster: './posters/a.webp' },
  ] }) + ';');
  const entry = load(path.join(f.dir, 'upper-shots.js')).loaded.modules.find((m) => /ONE\.cjs$/.test(m.file));
  assert.ok(entry, 'the entry keeps its spelled file');
  assert.equal(entry.real, path.join(fs.realpathSync.native(f.dir), 'pieces', 'one.cjs'));
});

test('posters: recipes returns its load explicitly, null when no shot names a poster', (t) => {
  const f = fixture(t);
  const { recipes: list, loaded } = load(f.file);
  assert.equal(list.length, 1);
  assert.deepEqual(loaded.pieces.map((p) => p.piece.name), ['one']);
  f.write('none-shots.js', 'module.exports = ' + JSON.stringify({ hz: 30, seed: 1, shots: [{ name: 'x', piece: './pieces/one.cjs' }] }) + ';');
  assert.deepEqual(load(path.join(f.dir, 'none-shots.js')), { recipes: [], loaded: null });
});

test('posters: a U+2028 or U+2029 line terminator ends a comment, so code after it is hashed', (t) => {
  const f = fixture(t);
  const before = record(recipes(f.file)[0], fs.readFileSync(f.poster));
  f.write('pieces/helper.js', 'module.exports = { w: 100 }; // note\u2028');
  assert.equal(record(recipes(f.file)[0], fs.readFileSync(f.poster)), before, 'a terminator alone is a line ending');
  f.write('pieces/helper.js', '// note\u2028module.exports = { w: 100, x: 1 };\n');
  assert.notEqual(record(recipes(f.file)[0], fs.readFileSync(f.poster)), before, 'code after the terminator is not a comment');
  f.write('pieces/helper.js', 'module.exports = { w: 100 };\u2029');
  assert.equal(record(recipes(f.file)[0], fs.readFileSync(f.poster)), before);
});

test('posters: a terminator inside a string is text, so an edit after it is hashed', (t) => {
  const f = fixture(t);
  f.write('pieces/helper.js', "module.exports = { w: 100, n: 'a\u2028https://example.com/a' };\n");
  const before = record(recipes(f.file)[0], fs.readFileSync(f.poster));
  f.write('pieces/helper.js', "module.exports = { w: 100, n: 'a\u2028https://example.com/b' };\n");
  assert.notEqual(record(recipes(f.file)[0], fs.readFileSync(f.poster)), before, 'the URL after the terminator is not a comment');
});

test('posters: line endings are not a change, but a replaced poster, a missing record or a missing poster is', (t) => {
  const f = fixture(t);
  f.write('pieces/helper.js', 'module.exports = { w: 100 };\r\n');
  assert.deepEqual(stale(f.file), []);
  fs.writeFileSync(f.poster, 'RIFF-another-file');
  assert.match(stale(f.file).join('\n'), /poster one: .*one\.webp is not the file its record names/);
  fs.rmSync(f.poster + '.json');
  assert.match(stale(f.file).join('\n'), /poster one: no record .*one\.webp\.json/);
  fs.rmSync(f.poster);
  assert.match(stale(f.file).join('\n'), /poster one: .*one\.webp is missing/);
});
