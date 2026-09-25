'use strict';

// npm run site: the shot list, per-shot scripts with shared modules defined
// once, the private-path refusal and the loopback preview server.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { build, serveSite } = require('../../tools/build-site.js');

const SITE = path.resolve(__dirname, '..');

function temp(t, name = 'artifex-site-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A site of its own: the real template, stage and worker, and pieces written here.
function fixture(t, shots, files) {
  const dir = temp(t);
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  fs.writeFileSync(path.join(dir, 'shots.js'), 'module.exports = ' + JSON.stringify({ hz: 30, seed: 1, shots }) + ';');
  return { dir, run: () => build({ shots: path.join(dir, 'shots.js'), out: path.join(dir, 'out') }) };
}

const piece = (name, extra = '', time = 'time: { duration: 1, hz: 30 },') => `${extra}
module.exports = { name: '${name}', size: { w: 100, h: 50 }, ${time} draw(g) { g.fillRect(0, 0, 100, 50); } };`;

test('site: the real shot list builds, one script per shot, every module defined once', (t) => {
  const out = temp(t);
  const result = build({ out });
  const { data } = result;
  assert.deepEqual(data.shots.map((s) => s.name), ['rows', 'grid', 'cells']);
  assert.deepEqual(data.shots.map((s) => s.tier), ['frame', 'frame', 'worker']);
  assert.equal(data.frames, 210);
  // The lattice every shot requires is in shared.js, and only there.
  const scripts = result.files.filter((f) => /^(shared|shot-.*)\.js$/.test(f));
  const defined = scripts.flatMap((f) => [...fs.readFileSync(path.join(out, f), 'utf8').matchAll(/^__def\("(external\/\d+\.js)"/gm)].map((m) => m[1]));
  assert.equal(new Set(defined).size, defined.length, 'a module defined twice: ' + defined);
  assert.ok(data.shots.every((s) => s.scripts[0] === 'shared.js' && s.scripts[1] === 'shot-' + s.name + '.js'));
  assert.ok(fs.readFileSync(path.join(out, 'shared.js'), 'utf8').includes('solveLattice'));
  // Every piece loads and validates from core.js and its own scripts, as the stage loads it.
  for (const s of data.shots) {
    const context = vm.createContext({});
    for (const f of ['core.js', ...s.scripts]) vm.runInContext(fs.readFileSync(path.join(out, f), 'utf8'), context);
    const name = vm.runInContext('(() => { const r = __require("test"); return r("core/piece.js").validate(r(' + JSON.stringify(s.id) + ')).name; })()', context);
    assert.equal(name, 'site-' + s.name);
  }
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.match(html, /<section class="shot seam" id="shot-grid" data-shot="1" aria-hidden="true">/);
  assert.equal((html.match(/<figure class="still"/g) || []).length, 2, 'a still for each shot, none for the seam');
  assert.ok(result.firstLoad <= 150 * 1024, 'first load ' + result.firstLoad + ' bytes of brotli, over the 150 kB budget');
});

test('site: modules two shots share go in shared.js; a module one shot needs stays in its script', (t) => {
  const { dir, run } = fixture(t, [
    { name: 'one', piece: './one.cjs', text: 'a < b & "c"' },
    { name: 'two', piece: './two.cjs', seam: true },
  ], {
    'common.js': 'module.exports = 1;',
    'only.js': 'module.exports = 2;',
    'one.cjs': piece('one', "require('./common.js'); require('./only.js');"),
    'two.cjs': piece('two', "require('./common.js');"),
  });
  const result = run();
  const out = path.join(dir, 'out');
  assert.deepEqual(result.data.shots.map((s) => s.scripts), [['shared.js', 'shot-one.js'], ['shared.js', 'shot-two.js']]);
  const text = (f) => fs.readFileSync(path.join(out, f), 'utf8');
  assert.match(text('shared.js'), /module\.exports = 1;/);
  assert.doesNotMatch(text('shared.js'), /module\.exports = 2;/);
  assert.match(text('shot-one.js'), /module\.exports = 2;/);
  assert.match(text('index.html'), /<p>a &lt; b &amp; &quot;c&quot;<\/p>/);
});

test('site: the shot list is refused when it cannot play', (t) => {
  const pieces = { 'a.cjs': piece('a'), 'still.cjs': piece('still', '', '') };
  const refuses = (shots, message) => assert.throws(() => fixture(t, shots, pieces).run(), message);
  refuses([{ name: 'a', piece: './a.cjs' }, { name: 'a', piece: './a.cjs' }], /used twice/);
  refuses([{ name: 'a', piece: './a.cjs', seconds: 2 }], /lasts its own duration/);
  refuses([{ name: 's', piece: './still.cjs' }], /a still needs seconds/);
  refuses([{ name: 'a', piece: './a.cjs', tier: 'gpu' }], /tier must be/);
  refuses([{ name: 'a', piece: './a.cjs', seam: true, still: 0.5 }], /a seam has none/);
  refuses([{ name: 'a', piece: './a.cjs', colour: 'red' }], /unknown key\(s\) colour/);
  refuses([{ name: 'A', piece: './a.cjs' }], /kebab-case/);
  refuses([{ name: 'a', piece: './a.cjs', poster: './a.gif' }], /poster must be/);
  refuses([{ name: 'a', piece: './a.cjs' }, { name: 's', piece: './still.cjs', seconds: 0.001 }], /holds no whole frame/);
});

test('site: a module, asset or shot list under a private directory is refused, by name', (t) => {
  for (const place of ['.private', 'docs/tasks', 'docs/decisions', 'docs/knowledge/private', 'docs/apis/private']) {
    const helper = path.join(place, 'helper.js');
    const { run } = fixture(t, [{ name: 'a', piece: './a.cjs' }], { 'a.cjs': piece('a', "require('./" + helper.replace(/\\/g, '/') + "');"), [helper]: 'module.exports = 1;' });
    assert.throws(run, (e) => /refusing to publish module/.test(e.message) && e.message.includes(path.join(place, 'helper.js')), place);
  }
  const poster = fixture(t, [{ name: 'a', piece: './a.cjs', poster: './docs/tasks/a.webp' }], { 'a.cjs': piece('a'), 'docs/tasks/a.webp': 'RIFF' });
  assert.throws(poster.run, (e) => /refusing to publish asset/.test(e.message) && e.message.includes(path.join('docs', 'tasks', 'a.webp')));
  const entry = fixture(t, [{ name: 'a', piece: './.private/a.cjs' }], { '.private/a.cjs': piece('a') });
  assert.throws(entry.run, /refusing to publish module .*\.private/);
  const list = temp(t);
  fs.mkdirSync(path.join(list, 'docs', 'decisions'), { recursive: true });
  fs.writeFileSync(path.join(list, 'docs', 'decisions', 'shots.js'), 'module.exports = {};');
  assert.throws(() => build({ shots: path.join(list, 'docs', 'decisions', 'shots.js'), out: path.join(list, 'out') }), /refusing to publish shot list/);
  // A public poster is copied under the shot's name.
  const ok = fixture(t, [{ name: 'a', piece: './a.cjs', poster: './art/a.webp' }], { 'a.cjs': piece('a'), 'art/a.webp': 'RIFF' });
  assert.equal(ok.run().data.shots[0].poster, 'posters/a.webp');
});

test('site: the preview server serves the built files on loopback and nothing outside them', async (t) => {
  const dir = temp(t);
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html>');
  fs.writeFileSync(path.join(dir, 'core.js'), '1;');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
  fs.writeFileSync(path.join(path.dirname(dir), path.basename(dir) + '-secret.html'), 'secret');
  t.after(() => fs.rmSync(path.join(path.dirname(dir), path.basename(dir) + '-secret.html'), { force: true }));
  const server = await serveSite(dir);
  t.after(() => server.close());
  assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  const get = (p, init) => fetch(server.url + p, init);
  const index = await get('');
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /text\/html/);
  assert.match((await get('core.js')).headers.get('content-type'), /text\/javascript/);
  for (const p of ['missing.js', 'notes.txt', '%2e%2e/' + path.basename(dir) + '-secret.html', '..%2f' + path.basename(dir) + '-secret.html']) {
    assert.equal((await get(p)).status, 404, p);
  }
  assert.equal((await get('core.js', { method: 'POST' })).status, 404);
  assert.equal((await get('%00')).status, 400);
});

test('site: the template keeps the markers the builder fills', () => {
  const template = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
  assert.ok(template.includes('<!-- shots -->') && template.includes('<!-- data -->'));
  assert.match(template, /<html lang="en">/);
});
