'use strict';

// The site's exports: exports.js holds core/export.js and what it reaches
// beyond core.js, out of the first load, and runs on top of core.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { build } = require('../../tools/build-site.js');
const { reach } = require('../../tools/build-page.js');

function site(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-site-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'one.cjs'), "module.exports = { name: 'one', size: { w: 100, h: 50 }, time: { duration: 1, hz: 30 }, draw(g) { g.fillRect(0, 0, 100, 50); } };");
  fs.writeFileSync(path.join(dir, 'shots.js'), 'module.exports = ' + JSON.stringify({ hz: 30, seed: 1, shots: [{ name: 'one', piece: './one.cjs' }] }) + ';');
  const out = path.join(dir, 'out');
  return { out, result: build({ shots: path.join(dir, 'shots.js'), out }) };
}

const defines = (text) => [...text.matchAll(/^__def\("([^"]+)"/gm)].map((m) => m[1]);

test('site: exports.js holds core/export.js and what it reaches beyond core.js, outside the first load', (t) => {
  const { out, result } = site(t);
  assert.deepEqual(result.data.exports, { script: 'exports.js', module: 'core/export.js' });
  const core = defines(fs.readFileSync(path.join(out, 'core.js'), 'utf8'));
  const exported = defines(fs.readFileSync(path.join(out, 'exports.js'), 'utf8'));
  assert.ok(!core.includes('core/export.js') && !core.includes('core/film.js'), 'the first load carries no exporter');
  assert.ok(exported.includes('core/export.js') && exported.includes('core/film.js'));
  assert.deepEqual(exported.filter((id) => core.includes(id)), [], 'a module defined in both');
  assert.deepEqual(core.concat(exported).filter((id) => id.startsWith('core/')).sort(), reach(core.concat('core/export.js')).filter((id) => id.startsWith('core/')).sort());
  const first = ['index.html', 'data.js', 'site.css', 'core.js', 'stage.js', ...result.data.shots[0].scripts];
  assert.equal(result.firstLoad, first.reduce((sum, f) => sum + result.sizes[f], 0), 'exports.js is not in the first load');
});

test('site: core/export.js runs from exports.js on top of core.js, and refuses an SVG a piece does not declare', (t) => {
  const { out } = site(t);
  const context = vm.createContext({ window: {} });
  for (const f of ['core.js', 'exports.js']) vm.runInContext(fs.readFileSync(path.join(out, f), 'utf8'), context);
  const E = vm.runInContext("__require('')('core/export.js')", context);
  const P = vm.runInContext("__require('')('core/piece.js')", context);
  const raster = P.validate({ name: 'raster', size: { w: 10, h: 10 }, draw(g) { g.fillRect(0, 0, 10, 10); } });
  assert.throws(() => E.svg(raster, P.solve(raster, 3), 0), /^Error: export: piece "raster" declares raster only, so it has no SVG$/);
  const lines = P.validate({ name: 'lines', size: { w: 10, h: 10 }, outputs: ['raster', 'vector'], draw(g) { g.fillRect(0, 0, 10, 10); } });
  const svg = E.svg(lines, P.solve(lines, 3), 0);
  assert.match(svg, /^<svg[^>]*><metadata id="artifex-manifest">\{&quot;artifex&quot;:[^<]*&quot;piece&quot;:&quot;lines&quot;,&quot;seed&quot;:3,/);
  assert.deepEqual({ ...E.filmChoice(raster, true, true) }, { format: null, reason: 'still' });
});
