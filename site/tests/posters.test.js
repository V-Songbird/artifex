'use strict';

// npm run posters: the recipe each poster is drawn from, and the rule that a
// poster whose recipe or sources changed since it was drawn is stale. Drawing
// needs installed Edge; these checks read the records the tool writes.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { recipes, record, stale } = require('../../tools/posters.js');

const NUM = path.resolve(__dirname, '..', '..', 'core', 'num.js');

test('posters: the real shot list draws ink, mirror, cad and kandinsky at 1200 x 800, seed 1, playhead 1, WebP 0.82, and all are current', () => {
  const entries = recipes();
  assert.deepEqual(entries.map((e) => e.name), ['ink', 'mirror', 'cad', 'kandinsky']);
  for (const e of entries) {
    assert.deepEqual(e.recipe, { piece: 'pieces/' + e.name + '.cjs', seed: 1, t: 1, width: 1200, height: 800, type: 'image/webp', quality: 0.82 });
    assert.ok(e.sources['pieces/' + e.name + '.cjs'] && e.sources['pieces/paper.js'] && e.sources['core/rand.js'], Object.keys(e.sources).join());
  }
  assert.deepEqual(stale(), []);
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
  f.write('pieces/helper.js', 'module.exports = { w: 100 }; // retouched\n');
  assert.match(stale(f.file).join('\n'), /poster one: sources changed since it was drawn \(pieces\/helper\.js\)/);
  f.write('pieces/helper.js', 'module.exports = { w: 120 };\n');
  assert.match(stale(f.file).join('\n'), /drawn from another recipe \(width 100 -> 120\)/);
  f.write('pieces/helper.js', 'module.exports = { w: 100 };\n');
  assert.deepEqual(stale(f.file), [], 'the helper as it was is current again');
  f.shots(2, 0.5);
  assert.match(stale(f.file).join('\n'), /drawn from another recipe \(seed 1 -> 2, t 1 -> 0\.5\)/);
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
