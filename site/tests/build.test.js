'use strict';

// npm run site: the shot list, per-shot scripts with shared modules defined
// once and loaded only by the shots that reach them, the private-path refusal
// and the loopback preview server.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { build, serveSite } = require('../../tools/build-site.js');
const { loadExternal } = require('../../tools/piece-input.js');

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
  assert.deepEqual(data.shots.map((s) => s.name), ['intro', 'bloom', 'ink', 'crack', 'mirror', 'bend', 'portal', 'trace', 'print', 'cad', 'fold', 'paint', 'kandinsky', 'wall', 'rows', 'grid', 'cells']);
  assert.deepEqual(data.shots.map((s) => s.tier), ['frame', 'frame', 'frame', 'frame', 'frame', 'frame', 'frame', 'frame', 'frame', 'frame', 'frame', 'frame', 'frame', 'frame', 'frame', 'frame', 'worker']);
  assert.equal(data.frames, 3600);
  // Every module is defined once, and a shot's scripts define exactly the modules its piece reaches.
  const defines = (f) => [...fs.readFileSync(path.join(out, f), 'utf8').matchAll(/^__def\("(external\/\d+\.js)"/gm)].map((m) => m[1]);
  const defined = result.files.filter((f) => /^(shared-\d+|shot-.*)\.js$/.test(f)).flatMap(defines);
  assert.equal(new Set(defined).size, defined.length, 'a module defined twice: ' + defined);
  const external = loadExternal(require('../shots.js').shots.map((s) => s.piece), SITE);
  data.shots.forEach((s, i) => assert.deepEqual(s.scripts.flatMap(defines).sort(), external.pieces[i].modules.slice().sort(), s.name + ' loads what it reaches'));
  assert.ok(data.shots.every((s) => s.scripts[s.scripts.length - 1] === 'shot-' + s.name + '.js'));
  const shared = (name) => data.shots.find((s) => s.name === name).scripts.filter((f) => f.startsWith('shared-')).map((f) => fs.readFileSync(path.join(out, f), 'utf8')).join('\n');
  // The intro loads the paper and wordmark and nothing it does not draw; the placeholders share the lattice.
  assert.deepEqual(data.shots[0].scripts, ['shared-1.js', 'shot-intro.js']);
  assert.ok(shared('intro').includes('drawWord') && !shared('intro').includes('drawPlumes'));
  assert.ok(shared('rows').includes('solveLattice') && !shared('rows').includes('drawWord'));
  for (const f of ['drawWord', 'drawPlumes', 'drawStrokes', 'drawTears', 'drawReflections', 'drawRims']) assert.ok(shared('fold').includes(f), 'fold shares ' + f);
  // The portal's page and picture, which the shots after it begin from, and the draftsman's sheet those share.
  for (const f of ['drawPage', 'released', 'drawSheet', 'drawPlot']) assert.ok(shared('fold').includes(f), 'fold shares ' + f);
  // The papercut the paint seam begins on, and the impasto and its oil paint the Kandinsky shot scrapes.
  for (const f of ['drawCut', 'drawDabs', 'drawSmears']) assert.ok(shared('kandinsky').includes(f), 'kandinsky shares ' + f);
  // The scraping the wall begins from, shared; a module one shot needs stays in its script: the wall's hang and the style modules.
  assert.ok(shared('wall').includes('drawStep'), 'wall shares drawStep');
  const wall = fs.readFileSync(path.join(out, 'shot-wall.js'), 'utf8');
  for (const f of ['drawHang', 'style-gallery', 'light-painting']) assert.ok(f === 'style-gallery' ? !wall.includes(f) : wall.includes(f), 'shot-wall.js ' + f);
  for (const name of ['ink', 'mirror', 'cad', 'kandinsky', 'wall']) assert.ok(fs.existsSync(path.join(out, 'posters', name + '.webp')), name + ' has its poster');
  // Every piece loads and validates from core.js and its own scripts, as the stage loads it.
  for (const s of data.shots) {
    const context = vm.createContext({});
    for (const f of ['core.js', ...s.scripts]) vm.runInContext(fs.readFileSync(path.join(out, f), 'utf8'), context);
    const name = vm.runInContext('(() => { const r = __require("test"); return r("core/piece.js").validate(r(' + JSON.stringify(s.id) + ')).name; })()', context);
    assert.equal(name, 'site-' + s.name);
  }
  // core.js holds library modules and a registry of the shots, and no example.
  const core = fs.readFileSync(path.join(out, 'core.js'), 'utf8');
  const bundled = [...core.matchAll(/^__def\(["']([^"']+)["']/gm)].map((m) => m[1]);
  assert.deepEqual(bundled.filter((id) => !id.startsWith('core/')), ['examples/index.js'], 'core.js holds no example');
  for (const s of data.shots) assert.ok(core.includes('module.exports["site-' + s.name + '"] = require(' + JSON.stringify(s.id) + ');'), s.name + ' is in the registry');
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.match(html, /<section class="shot seam" id="shot-grid" data-shot="15" aria-hidden="true">/);
  assert.equal((html.match(/<figure class="still"/g) || []).length, 8, 'a still for each shot, none for the seam');
  // The data is a same-origin script, not text in the page: the page has no inline script.
  assert.deepEqual(html.match(/<script[^>]*>/g), ['<script src="data.js">', '<script src="core.js">', '<script src="stage.js">']);
  assert.equal(fs.readFileSync(path.join(out, 'data.js'), 'utf8'), 'window.__siteData = ' + JSON.stringify(data) + ';\n');
  assert.ok(result.firstLoad <= 150 * 1024, 'first load ' + result.firstLoad + ' bytes of brotli, over the 150 kB budget');
});

test('site: modules the same shots share go in one shared script; a module one shot needs stays in its script', (t) => {
  const { dir, run } = fixture(t, [
    { name: 'one', piece: './one.cjs', text: 'a < b & "c"' },
    { name: 'two', piece: './two.cjs', seam: true },
    { name: 'three', piece: './three.cjs' },
  ], {
    'common.js': 'module.exports = 1;',
    'only.js': 'module.exports = 2;',
    'pair.js': 'module.exports = 3;',
    'one.cjs': piece('one', "require('./common.js'); require('./only.js');"),
    'two.cjs': piece('two', "require('./common.js'); require('./pair.js');"),
    'three.cjs': piece('three', "require('./pair.js'); require('./common.js');"),
  });
  const result = run();
  const out = path.join(dir, 'out');
  assert.deepEqual(result.data.shots.map((s) => s.scripts), [
    ['shared-1.js', 'shot-one.js'], ['shared-1.js', 'shared-2.js', 'shot-two.js'], ['shared-1.js', 'shared-2.js', 'shot-three.js'],
  ]);
  const text = (f) => fs.readFileSync(path.join(out, f), 'utf8');
  assert.match(text('shared-1.js'), /module\.exports = 1;/);
  assert.doesNotMatch(text('shared-1.js'), /module\.exports = [23];/);
  assert.match(text('shared-2.js'), /module\.exports = 3;/);
  assert.doesNotMatch(text('shared-2.js'), /module\.exports = [12];/);
  assert.match(text('shot-one.js'), /module\.exports = 2;/);
  // The first load holds the first shot's scripts alone.
  const sizes = ['index.html', 'data.js', 'site.css', 'core.js', 'stage.js', 'shared-1.js', 'shot-one.js'].map((f) => result.sizes[f]);
  assert.equal(result.firstLoad, sizes.reduce((a, b) => a + b, 0));
  assert.match(text('index.html'), /<p>a &lt; b &amp; &quot;c&quot;<\/p>/);
});

test('site: core.js holds the library modules the shots and the stage require; a require it cannot see fails by name', (t) => {
  const lib = (name) => JSON.stringify(path.join(SITE, '..', 'core', name).replace(/\\/g, '/'));
  const core = (files) => {
    const { dir, run } = fixture(t, [{ name: 'a', piece: './a.cjs' }], files);
    run();
    return [...fs.readFileSync(path.join(dir, 'out', 'core.js'), 'utf8').matchAll(/^__def\("([^"]+)"/gm)].map((m) => m[1]);
  };
  const plain = core({ 'a.cjs': piece('a') });
  for (const id of ['core/piece.js', 'core/render.js', 'core/time.js']) assert.ok(plain.includes(id), 'the stage requires ' + id);
  assert.ok(!plain.includes('core/sound.js'), 'a module nothing requires is left out');
  const sound = core({ 'a.cjs': piece('a', "require('./helper.js');"), 'helper.js': 'module.exports = require(' + lib('sound.js') + ');' });
  assert.ok(sound.includes('core/sound.js'), 'a module a shot requires through a helper is in');
  assert.throws(fixture(t, [{ name: 'a', piece: './a.cjs' }], { 'a.cjs': piece('a', "require('../core/' + 'sound.js');") }).run,
    (e) => /literal module path/.test(e.message) && e.message.includes('a.cjs'));
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

test('site: a poster reaches the page only as posters/<name>, whatever the shot list names', (t) => {
  // The stage sets the poster's src from data.js alone, and only the build writes it.
  for (const poster of ['javascript:alert(1)//a.png', 'data:image/png;base64,AAAA.png', 'https://evil.example/a.png']) {
    assert.throws(fixture(t, [{ name: 'a', piece: './a.cjs', poster }], { 'a.cjs': piece('a') }).run, { code: 'ENOENT' }, poster);
  }
  const outside = temp(t);
  fs.writeFileSync(path.join(outside, 'a.png'), 'PNG');
  const { dir, run } = fixture(t, [{ name: 'a', piece: './a.cjs', poster: '../' + path.basename(outside) + '/a.png' }], { 'a.cjs': piece('a') });
  assert.equal(run().data.shots[0].poster, 'posters/a.png');
  assert.ok(!fs.readFileSync(path.join(dir, 'out', 'data.js'), 'utf8').includes(path.basename(outside)));
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
