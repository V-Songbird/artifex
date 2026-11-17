'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { loadExternal, callerDirectory, outputStem, outRoot, outputDirectory, resolvePiece } = require('../tools/piece-input.js');
const { bundle, html, checkParses, pageFile } = require('../tools/build-page.js');
const { page } = require('../tools/contact-sheet.js');

const ROOT = path.resolve(__dirname, '..');

// A CLI command run to completion. Each one ends on its own, but an npm command
// can take well over 15 s on a loaded machine; the deadline only stops a
// command that hangs, so it sits far above that. A command that runs out of
// time says so first, before anything it printed.
const CLI_DEADLINE_MS = 120000;
function cli(args, cwd) {
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: CLI_DEADLINE_MS });
  assert.equal(result.status, 0, [result.error?.message, result.stderr].filter(Boolean).join('\n'));
}

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-external-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'project with spaces', 'lib', 'data'), { recursive: true });
  const project = path.join(dir, 'project with spaces');
  const file = path.join(project, 'My piece.cjs');
  fs.writeFileSync(path.join(project, 'lib', 'data', 'palette.json'), '{"ink":"#295c7b","paper":"#f5efe1","__proto__":"literal data"}');
  fs.writeFileSync(path.join(project, 'lib', 'palette.js'), 'module.exports = require /* data */ ("./data/palette.json");');
  fs.writeFileSync(file, `const palette = require('./lib/palette');
const { rng } = require(${JSON.stringify(path.join(ROOT, 'core', 'rand.js'))});
// require('node:fs') is a comment, not a dependency.
const label = "require('not-a-dependency')";
const templateText = \`require('not-a-dependency')\`;
const pattern = /["']/;
const importText = /require\('not-a-module'\)/;
importText.test(label + templateText);
module.exports = {
 name: 'external-study', size: {w: 120, h: 80}, seed: 17,
 outputs: ['raster', 'vector'], time: {duration: 1, hz: 4},
 params: { width: {min: 10, max: 90, value: 40, meaning: 'rectangle width'} },
 state: () => ({}),
 build: [['place', (s) => { s.x = 5 + rng(s.seed)('rectangle', 'x') * 10; s.ownData = Object.hasOwn(palette, '__proto__'); }]],
 draw(g, s, t) { g.fillStyle=palette.paper; g.fillRect(0,0,120,80);
 g.fillStyle=palette.ink; g.fillRect(s.x,10,s.params.width,20+t*40); }
};`);
  return { dir, project, file };
}

test('external piece resolves nested CommonJS/JSON and library helpers into a runnable bundle', (t) => {
  const { project, file } = fixture(t);
  const external = loadExternal('./My piece.cjs', project);
  assert.equal(external.entry, file);
  assert.equal(external.moduleCount, 3);
  assert.deepEqual(external.names, ['external-study']);
  const context = vm.createContext({});
  vm.runInContext(bundle(external), context);
  const result = vm.runInContext(`(() => {
    const req=__require(''), p=req('core/piece.js');
    const examples=req('examples/index.js'), value=p.validate(examples['external-study']);
    const solved=p.solve(value, 3); const marks=[];
    value.draw({fillRect(...args){marks.push(args);}},solved.state,0.5);
    return { names:Object.keys(examples), params:solved.state.params, ownData:solved.state.ownData, marks, error:solved.stages.error };
  })()`, context);
  assert.deepEqual(Array.from(result.names), ['external-study']);
  assert.equal(result.params.width, 40);
  assert.equal(result.error, null);
  assert.equal(result.ownData, true, 'JSON keys keep their own-property meaning in the browser');
  assert.equal(result.marks.length, 2);
  assert.ok(Number.isFinite(result.marks[1][0]));
  assert.equal(result.marks[1][2], 40);
  assert.equal(checkParses(html(bundle(external), { count: 1 })), true);
  assert.match(html(bundle(external), { count: 1 }), /declared parameters of your piece/);
  const sheet = page(external.names, 3, 0.5, ['width'], external);
  const plans = JSON.parse(/var PLANS = (.*);/.exec(sheet)[1]);
  assert.deepEqual(plans[0].map((cell) => cell.params.width), [10, 50, 90]);
  assert.ok(plans[0].every((cell) => cell.seed === 17));
  assert.equal(checkParses(sheet), true);
});

test('an external piece with an image module beside it loads, solves the same bytes in the page as in Node, and builds a page', (t) => {
  const { project } = fixture(t);
  const { imageModule } = require('../tools/image.js');
  const rgba = Uint8Array.from({ length: 6 * 4 * 4 }, (_, i) => (i % 4 === 3 ? 255 : (i * 37) % 256));
  const made = imageModule({ w: 6, h: 4, rgba }, { width: null, channels: null, source: 'made from code', rights: 'the tests\'' }, 'grid.png');
  fs.writeFileSync(path.join(project, 'grid.image.js'), made.text);
  fs.writeFileSync(path.join(project, 'over.cjs'), `const { tone } = require('artifex/core/image.js');
module.exports = { name: 'over', size: { w: 60, h: 40 }, images: { grid: require('./grid.image.js') },
  draw(g, s) { g.fillRect(0, 0, 60 * tone(s.images.grid, 0.5, 0.5), 40); } };`);
  const external = loadExternal('./over.cjs', project);
  assert.equal(external.moduleCount, 2, 'the piece and its image module');
  const context = vm.createContext({ atob });
  vm.runInContext(bundle(external), context);
  const inPage = vm.runInContext(`(() => {
    const req = __require(''), p = req('core/piece.js'), s = p.solve(p.validate(req('examples/index.js').over));
    return { bytes: Array.from(s.state.images.grid.data), manifest: JSON.stringify(s.manifest) };
  })()`, context);
  const { solve } = require('../core/piece.js');
  const inNode = solve(external.piece);
  assert.deepEqual([...inPage.bytes], Array.from(inNode.state.images.grid.data));
  assert.equal(inPage.manifest, JSON.stringify(inNode.manifest), 'one recipe, digest included, on both routes');
  assert.equal(inNode.manifest.images.grid.digest, made.digest, 'the digest the tool printed');
  const page = html(bundle(external), { count: 1 });
  assert.equal(checkParses(page), true);
  assert.match(page, /id="imagesGroup" hidden/);
});

test('npm run browser\'s image fixture checks the page\'s credit, and a failure keeps the run\'s report and says whether cleanup failed', async (t) => {
  const zlib = require('node:zlib');
  const { checkImageFixture, main } = require('../tools/check-browser.js');
  const { solve } = require('../core/piece.js');
  const { sample } = require('../core/image.js');
  const { piece } = loadExternal(path.join(ROOT, 'tools', 'fixtures', 'image-piece.cjs'), ROOT);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-image-fixture-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // A PNG of the fixture's size: the image as sample reads it, or transparent.
  const png = (shown) => {
    const { w, h } = piece.size, img = solve(piece).state.images.ground, rows = Buffer.alloc((w * 4 + 1) * h);
    if (shown) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rows.set(sample(img, (x + 0.5) / w, (y + 0.5) / h).map(Math.round), y * (w * 4 + 1) + 1 + x * 4);
    const chunk = (type, data) => {
      const out = Buffer.alloc(12 + data.length);
      out.writeUInt32BE(data.length, 0); out.write(type, 4, 'latin1'); data.copy(out, 8);
      out.writeUInt32BE(zlib.crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
      return out;
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
  };
  const d = piece.images.ground;
  const credit = { images: [{ name: 'ground', w: d.w, h: d.h, channels: d.channels, source: d.source, rights: d.rights }], group: 'ground · 64 x 36 · ' + d.source + ' · ' + d.rights };
  // The page answers the credit read; the still runs its work in that page.
  const edgeAnswering = (value) => (page, opts, work) => work({ send: async () => ({ result: { value } }) }, {});
  const still = (bytes) => async (external, name, seed, at, width, browser, box, edge) => { await edge(null, {}, async () => null); return { bytes }; };
  // The gAMA 1.0 PNG's pixels as Edge hands them back converted to sRGB, and as Node would read them unconverted.
  const decoded = (rgb) => async () => ({ w: 3, h: 1, rgba: Uint8Array.from([0, 1, 2].flatMap((p) => [...rgb.slice(p * 3, p * 3 + 3), 255])) });
  const deps = (over) => ({ dir, edge: edgeAnswering(credit), still: still(png(true)), exportFilm: async () => ({ bytes: Buffer.from('film') }), replay: async () => ({ match: true, detail: 'same', frames: [] }),
    decode: decoded([188, 137, 255, 137, 255, 188, 255, 188, 137]), ...over });
  const run = () => ({ films: [], pieces: [] });

  const report = run();
  const fixture = await checkImageFixture(report, {}, deps());
  assert.deepEqual([fixture.png.shows, fixture.png.match, fixture.replay.match, fixture.decode.converted], [true, true, true, true]);
  const raw = run();
  await assert.rejects(checkImageFixture(raw, {}, deps({ decode: decoded([128, 64, 255, 64, 255, 128, 255, 128, 64]) })),
    (error) => /^browser: the image fixture: npm run image read a PNG tagged gAMA 1\.0 as \[128,64,255,/.test(error.message) && error.report === raw);
  assert.equal(raw.imageFixture.decode.converted, false);

  await assert.rejects(checkImageFixture(run(), {}, deps({ edge: edgeAnswering({ ...credit, group: null }) })), /^Error: browser: the image fixture's page credits /);
  await assert.rejects(checkImageFixture(run(), {}, deps({ edge: edgeAnswering({ ...credit, images: [] }) })), /^Error: browser: the image fixture's page credits /);

  // A failure that is not a cleanup failure says the browsers were cleaned up.
  const logged = [];
  t.mock.method(console, 'log', (line) => logged.push(line));
  const missed = run();
  await assert.rejects(main([], () => checkImageFixture(missed, {}, deps({ still: still(png(false)) })), dir), /^Error: browser: the image fixture's PNG shows /);
  assert.equal(missed.imageFixture.png.shows, false);
  assert.match(logged[0], /; owned browser, server and profile cleaned up$/);
  // A still whose Edge failed only to clean up is named as the fixture's and carries the run's report, so main still writes it.
  const stuck = async () => { throw Object.assign(new Error('browser: cleanup failed: profile p: EBUSY'), { report: { png: 'its own' } }); };
  const kept = run();
  await assert.rejects(main([], () => checkImageFixture(kept, {}, deps({ still: stuck })), dir),
    (error) => error.message === 'browser: the image fixture: browser: cleanup failed: profile p: EBUSY' && error.report === kept);
  assert.match(logged.at(-2), /; cleanup failed$/);
  // A plain failure inside the fixture is named as the fixture's and keeps the run's report, so main prints the summary and saves it.
  const plain = run();
  await assert.rejects(main([], () => checkImageFixture(plain, {}, deps({ exportFilm: async () => { throw new Error('encoder gone'); } })), dir),
    (error) => error.message === 'browser: the image fixture: encoder gone' && error.report === plain);
  assert.equal(plain.imageFixture.png.match, true);
  assert.match(logged.at(-2), /; owned browser, server and profile cleaned up$/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'browser.json'), 'utf8')).imageFixture.png.match, true);
});

test('external piece diagnostics reject missing modules, invalid pieces and unsupported browser dependencies', (t) => {
  const { project } = fixture(t);
  assert.throws(() => loadExternal('./missing.cjs', project), /cannot load/);
  for (const [name, source, expected] of [
    ['invalid.cjs', 'module.exports = {};', /invalid module.*name/],
    ['missing-dependency.cjs', "require('./missing-helper');", /cannot resolve.*missing-helper/],
    ['node-only.cjs', "require('node:fs');", /Node builtin node:fs cannot run in the browser/],
    ['dynamic.cjs', "const target='./lib/palette'; require(target);", /literal module path/],
    ['dynamic-import.cjs', "import('./lib/palette.js');", /dynamic import is not supported/],
    ['alias.cjs', "const local = require; local('./lib/palette.js');", /direct literal require calls/],
    ['esm.js', 'export default {};', /expected browser-compatible CommonJS/],
    ['bad-name.cjs', "module.exports={name:'../escape',size:{w:1,h:1},draw(){}};", /kebab-case/],
  ]) {
    fs.writeFileSync(path.join(project, name), source);
    assert.throws(() => loadExternal('./' + name, project), expected, name);
  }
});

test('external piece inline script markers retain their string value without closing the HTML script', (t) => {
  const { project } = fixture(t);
  fs.writeFileSync(path.join(project, 'marker.cjs'), `const marker = '</ScRiPt>';
module.exports={name:'script-marker',size:{w:20,h:20},draw(g){g.fillRect(0,0,marker.length,1);}};`);
  const external = loadExternal('./marker.cjs', project);
  const generated = html(bundle(external), { count: 1 });
  assert.equal((generated.match(/<\/script/gi) || []).length, 1);
  assert.equal(checkParses(generated), true);
  const piece = vm.runInNewContext(bundle(external) + "\n__require('')('examples/index.js')['script-marker']");
  let width;
  piece.draw({ fillRect(_x, _y, w) { width = w; } });
  assert.equal(width, '</ScRiPt>'.length);
});

test('external piece rejects tagged/raw script-boundary text rather than changing its raw value', (t) => {
  const { project } = fixture(t);
  for (const [name, prefix] of [
    ['raw', 'const value=String.raw`</ScRiPt>`;'],
    ['tagged', 'const tag = strings => strings.raw[0]; const value=tag`</script>`;'],
    ['unicode-tag', 'const λ = String.raw; const value=λ`</script>`;'],
  ]) {
    const file = path.join(project, name + '.cjs');
    fs.writeFileSync(file, prefix + "module.exports={name:'marker',size:{w:20,h:20},draw(g){g.fillRect(0,0,value.length,1);}};");
    assert.throws(() => loadExternal(file), /template.*script/i);
  }
});

for (const [name, expression] of [
  ['a direct function-expression tag', 'function(parts){return parts.raw[0];}`</script>`'],
  ['an untagged template', '`</script>`'],
]) {
  test('external piece rejects a script-end marker inside ' + name, (t) => {
    const { project } = fixture(t);
    const file = path.join(project, 'template-marker.cjs');
    fs.writeFileSync(file, 'const value=' + expression + ";module.exports={name:'marker',size:{w:20,h:20},draw(g){g.fillRect(0,0,value.length,1);}};");
    assert.throws(() => loadExternal(file), /template.*script/i);
  });
}

for (const [name, prefix] of [
  ['object property', "const value={require:'data'};"],
  ['regex after control parentheses', "if(true) /require('node:fs')/.test('x');"],
]) {
  test('external piece does not mistake ' + name + ' for a module import', (t) => {
    const { project } = fixture(t);
    const file = path.join(project, 'lexical.cjs');
    fs.writeFileSync(file, prefix + "module.exports={name:'lexical',size:{w:20,h:20},draw(g){g.fillRect(0,0,9,1);}};");
    const external = loadExternal(file);
    const piece = vm.runInNewContext(bundle(external) + "\n__require('')('examples/index.js').lexical");
    let width;
    piece.draw({ fillRect(_x, _y, w) { width = w; } });
    assert.equal(width, 9);
  });
}

test('external malformed JSON diagnostics identify the nested file and retain the parse cause', (t) => {
  const { project, file } = fixture(t);
  const jsonFile = path.join(project, 'lib', 'data', 'palette.json');
  fs.writeFileSync(jsonFile, '{"value":}');
  assert.throws(() => loadExternal(file), (error) => error instanceof SyntaxError
    && error.message.includes(jsonFile) && error.cause instanceof SyntaxError);
});

test('external parameter-sheet filenames encode Windows wildcards and stay beside the piece', (t) => {
  const { project, file } = fixture(t);
  for (const [key, filename] of [
    ['width*height', 'My piece-param-width%2Aheight.html'],
    ['../../../escape', 'My piece-param-..%2F..%2F..%2Fescape.html'],
  ]) {
    const params = { [key]: { min: 1, max: 2, value: 1, meaning: 'rectangle width' } };
    fs.writeFileSync(file, "module.exports={name:'filenames',size:{w:20,h:20},params:" + JSON.stringify(params) + ',draw(){}};');
    cli([path.join(ROOT, 'tools', 'contact-sheet.js'), file, '2', '0.5', '--param', key], project);
    const output = path.join(project, filename);
    assert.equal(fs.existsSync(output), true);
    assert.equal(path.dirname(fs.realpathSync(output)), project);
    assert.doesNotMatch(path.basename(output), /[<>:"/\\|?*]/);
  }
});

test('page: a piece inside the library writes its page under out/pieces/, one outside beside itself', (t) => {
  const inside = loadExternal(path.join(ROOT, 'tests', 'fixtures', 'gradient-film.cjs'));
  assert.equal(pageFile(inside),path.join(ROOT, 'out', 'pieces', 'tests', 'fixtures', 'gradient-film-page.html'));
  const { project, file } = fixture(t);
  assert.equal(pageFile(loadExternal(file)), path.join(project, 'My piece-page.html'));
  assert.equal(pageFile(null), path.join(ROOT, 'out', 'index.html'));
});

test('output: run from a folder outside the library, the page and a registered example write to that folder\'s out/, never into the library', (t) => {
  const { project, file } = fixture(t);
  // An installed plugin is a copy its host replaces on update, so it must hold no output; a clone keeps its own out/.
  assert.equal(outRoot(ROOT), path.join(ROOT, 'out'));
  assert.equal(outRoot(path.join(ROOT, 'tools')), path.join(ROOT, 'out'), 'a folder inside the library still means the library\'s out/');
  assert.equal(outRoot(project), path.join(project, 'out'));
  assert.equal(outputDirectory(null, project), path.join(project, 'out'));
  assert.equal(pageFile(null, project), path.join(project, 'out', 'index.html'));
  const refuse = (cause) => new Error(cause);
  assert.equal(resolvePiece({ piece: 'drift', style: null, out: null, seed: 7 }, project, refuse, '.png').file, path.join(project, 'out', 'drift-seed7.png'));
  const inside = loadExternal(path.join(ROOT, 'tests', 'fixtures', 'gradient-film.cjs'));
  assert.equal(outputDirectory(inside, project), path.join(project, 'out', 'pieces', 'tests', 'fixtures'), 'a piece in a tracked folder of the library goes under the caller\'s out/pieces/');
  assert.equal(outputDirectory(loadExternal(file), project), project, 'an external piece still writes beside itself');
  const before = fs.existsSync(path.join(ROOT, 'out', 'index.html')) ? fs.statSync(path.join(ROOT, 'out', 'index.html')).mtimeMs : null;
  cli([path.join(ROOT, 'tools', 'build-page.js')], project);
  assert.equal(checkParses(fs.readFileSync(path.join(project, 'out', 'index.html'), 'utf8')), true);
  const after = fs.existsSync(path.join(ROOT, 'out', 'index.html')) ? fs.statSync(path.join(ROOT, 'out', 'index.html')).mtimeMs : null;
  assert.equal(after, before, 'the library\'s own out/index.html was not written');
});

test('external piece paths use the npm caller only for this library page/seeds script', () => {
  const cwd = path.join(ROOT, 'caller'), initial = path.join(ROOT, 'initial');
  const env = { npm_lifecycle_event: 'page', npm_package_json: path.join(ROOT, 'package.json'), INIT_CWD: initial };
  assert.equal(callerDirectory(cwd, env), initial);
  assert.equal(callerDirectory(cwd, { ...env, npm_lifecycle_event: 'seeds' }), initial);
  assert.equal(callerDirectory(cwd, { ...env, npm_lifecycle_event: 'film' }), initial);
  assert.equal(callerDirectory(cwd, { ...env, npm_lifecycle_event: 'test' }), cwd);
  assert.equal(callerDirectory(cwd, { INIT_CWD: initial }), cwd);
  assert.equal(callerDirectory(cwd, { ...env, npm_package_json: path.join(initial, 'package.json') }), cwd);
  assert.equal(outputStem('My piece.cjs'), 'My piece');
  assert.doesNotMatch(outputStem('unsafe:piece?.cjs'), /[<>:"/\\|?*]/);
});

test('external CLI commands resolve caller paths with spaces and write beside the piece', (t) => {
  const { project, file } = fixture(t);
  const run = (args) => cli(args, project);
  run([path.join(ROOT, 'tools', 'build-page.js'), './My piece.cjs']);
  assert.equal(checkParses(fs.readFileSync(path.join(project, 'My piece-page.html'), 'utf8')), true);
  run([path.join(ROOT, 'tools', 'contact-sheet.js'), file, '3', '0.5']);
  assert.equal(checkParses(fs.readFileSync(path.join(project, 'My piece-seeds.html'), 'utf8')), true);
  // Outside npm, npm-cli.js sits beside node on Windows and under ../lib on POSIX.
  const bin = path.dirname(process.execPath);
  const npmPaths = [path.join(bin, 'node_modules', 'npm', 'bin', 'npm-cli.js'), path.join(bin, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')];
  const npm = process.env.npm_execpath || npmPaths.find((p) => fs.existsSync(p));
  assert.ok(npm, `npm-cli.js not found at ${npmPaths.join(' or ')}; set npm_execpath to its path`);
  run([npm, '--prefix', ROOT, 'run', 'page', '--', './My piece.cjs']);
  run([npm, '--prefix', ROOT, 'run', 'seeds', '--', './My piece.cjs', '3', '0.5', '--param', 'width']);
  const sweep = fs.readFileSync(path.join(project, 'My piece-param-width.html'), 'utf8');
  assert.equal(checkParses(sweep), true);
  assert.match(sweep, /external-study/);
  assert.equal(fs.existsSync(path.join(project, 'out')), false);
  assert.equal(fs.existsSync(file), true);
});

test('external pieces loaded as a list define a shared helper once and name what each piece reaches', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-external-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (name, text) => fs.writeFileSync(path.join(dir, name), text);
  const piece = (name, needs) => needs + "\nmodule.exports = { name: '" + name + "', size: { w: 10, h: 10 }, draw(g) { g.fillRect(0, 0, 10, 10); } };";
  write('shared.js', "module.exports = require('./deep.json');");
  write('deep.json', '{"x": 1}');
  write('own.js', 'module.exports = 2;');
  write('a.cjs', piece('list-a', "require('./shared.js'); require('./own.js');"));
  write('b.cjs', piece('list-b', "require('./shared.js'); require(" + JSON.stringify(path.join(ROOT, 'core', 'num.js')) + ');'));
  write('c.cjs', piece('list-a', ''));
  const external = loadExternal(['./a.cjs', './b.cjs', './a.cjs'], dir);
  assert.equal(external.moduleCount, 5);
  assert.deepEqual(external.names, ['list-a', 'list-b']);
  assert.equal(external.modules.length, 5);
  const file = (id) => path.basename(external.modules.find((m) => m.id === id).file);
  assert.deepEqual(external.pieces.map((p) => p.modules.map(file).sort()), [
    ['a.cjs', 'deep.json', 'own.js', 'shared.js'], ['b.cjs', 'deep.json', 'shared.js'], ['a.cjs', 'deep.json', 'own.js', 'shared.js']]);
  assert.equal(external.pieces[0].modules[0], external.pieces[0].id, 'a piece reaches itself first');
  // The joined source runs every piece from one registry, as bundle() takes it.
  const context = vm.createContext({});
  vm.runInContext(bundle(external), context);
  assert.equal(vm.runInContext('Object.keys(__require("t")("examples/index.js")).join()', context), 'list-a,list-b');
  assert.throws(() => loadExternal(['./a.cjs', './c.cjs'], dir), /are both named list-a/);
  assert.throws(() => loadExternal([], dir), /at least one piece/);
  // One path keeps the single-piece shape.
  assert.deepEqual(Object.keys(loadExternal('./b.cjs', dir)).sort(), ['directory', 'entry', 'moduleCount', 'names', 'piece', 'source', 'stem']);
});

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

test('external piece requires artifex/core modules from any folder, as the page resolves them', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-external-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'lib'));
  fs.writeFileSync(path.join(dir, 'lib', 'mid.js'), "module.exports = require('artifex/core/num.js').lerp(0, 10, 0.5);");
  fs.writeFileSync(path.join(dir, 'core.cjs'), "const { rng } = require('artifex/core/rand.js'); const mid = require('./lib/mid.js');\n"
    + "module.exports = { name: 'core-import', size: { w: 20, h: 20 }, seed: 3, draw(g, s) { g.fillRect(0, 0, mid, typeof rng); } };");
  const external = loadExternal('./core.cjs', dir);
  assert.deepEqual(external.piece.size, { w: 20, h: 20 });
  assert.match(external.source, /require\("core\/rand\.js"\)/);
  assert.match(external.source, /require\("core\/num\.js"\)/);
  const piece = vm.runInNewContext(bundle(external) + "\n__require('')('examples/index.js')['core-import']");
  const marks = [];
  piece.draw({ fillRect(...args) { marks.push(args); } });
  assert.deepEqual(marks, [[0, 0, 5, 'function']]);
  for (const spec of ['artifex/core/nope.js', 'artifex/core/../examples/drift.js']) {
    fs.writeFileSync(path.join(dir, 'bad.cjs'), 'require(' + JSON.stringify(spec) + ");module.exports={name:'bad',size:{w:1,h:1},draw(){}};");
    assert.throws(() => loadExternal('./bad.cjs', dir), new RegExp('cannot resolve ' + escape(spec)), spec);
  }
});

test('external piece requires a built-in style\'s marks as artifex/styles/<name>.js from any folder, bundled with the piece', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-external-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'inked.cjs'), "const { rng } = require('artifex/core/rand.js'); const M = require('artifex/styles/manga.js');\n"
    + "module.exports = { name: 'inked', size: { w: 40, h: 20 }, seed: 3, draw(g, s) { M.pen(g, rng(s.seed), 'line', [[2, 10], [38, 10]], { w: 3 }); } };");
  const external = loadExternal('./inked.cjs', dir);
  assert.equal(external.moduleCount, 3, 'the piece, the marks and the kit they require are bundled as the piece\'s own modules');
  assert.match(external.source, /function screentone\(/);
  const piece = vm.runInNewContext(bundle(external) + "\n__require('')('examples/index.js')['inked']");
  const calls = [];
  piece.draw(new Proxy({}, { get: (o, k) => (k in o ? o[k] : (...args) => calls.push(k)), set: () => true }), { seed: 3 });
  assert.ok(calls.includes('fill'), 'the pen line is filled');
  for (const spec of ['artifex/styles/nope.js', 'artifex/styles/catalog.md']) {
    fs.writeFileSync(path.join(dir, 'bad.cjs'), 'require(' + JSON.stringify(spec) + ");module.exports={name:'bad',size:{w:1,h:1},draw(){}};");
    assert.throws(() => loadExternal('./bad.cjs', dir), new RegExp('cannot resolve ' + escape(spec) + '.*skills/artifex/styles/ has no module'), spec);
  }
});

test('external piece runs in Node from the module table the page runs, without Node-only module globals', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-external-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // What a module sees of its surroundings, carried out through a parameter's meaning.
  fs.writeFileSync(path.join(dir, 'probe.js'), 'module.exports = JSON.stringify([typeof __dirname, typeof __filename, this === module.exports, typeof module.id]);');
  fs.writeFileSync(path.join(dir, 'probe.cjs'), "const probe = require('./probe.js');\n"
    + "module.exports = { name: 'probe', size: { w: 1, h: 1 }, params: { p: { min: 0, max: 1, value: 0, meaning: probe } }, draw() {} };");
  const external = loadExternal('./probe.cjs', dir);
  const page = vm.runInNewContext(bundle(external) + "\n__require('')('examples/index.js').probe");
  assert.equal(page.params.p.meaning, '["undefined","undefined",false,"undefined"]');
  assert.equal(external.piece.params.p.meaning, page.params.p.meaning);
  fs.writeFileSync(path.join(dir, 'dirname.cjs'), "module.exports = { name: 'dirname', size: { w: 1, h: 1 }, draw() { return __dirname; }, seed: __dirname.length };");
  assert.throws(() => loadExternal('./dirname.cjs', dir), /invalid module.*dirname\.cjs.*__dirname is not defined/);
});

test('external piece confined to its listed files refuses every other require by name', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-external-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pack = path.join(dir, 'pack');
  fs.mkdirSync(path.join(pack, 'lib'), { recursive: true });
  const write = (name, text) => fs.writeFileSync(path.join(dir, name), text);
  const piece = (needs) => needs + "\nmodule.exports = { name: 'dots', size: { w: 10, h: 10 }, draw(g) { g.fillRect(0, 0, 10, 10); } };";
  write('outside.js', 'module.exports = 1;');
  write('pack/lib/data.json', '{"r": 2}');
  write('pack/lib/dots.js', "module.exports = require('./data.json').r;");
  write('pack/lib/unlisted.js', 'module.exports = 3;');
  write('pack/lib/leak.js', "module.exports = require('../../outside.js');");
  write('pack/piece.cjs', piece("require('./lib/dots.js'); require('artifex/core/rand.js');"));
  const files = ['piece.cjs', 'lib/dots.js', 'lib/data.json', 'lib/leak.js'];
  const load = (name) => loadExternal('./' + name, pack, { confine: { root: pack, files: files.concat(name) } });
  assert.equal(load('piece.cjs').moduleCount, 3);
  assert.deepEqual(loadExternal(['./piece.cjs'], pack, { confine: { root: pack, files } }).library, ['core/rand.js']);
  for (const [name, spec, file = name] of [
    ['absolute-core.cjs', path.join(ROOT, 'core', 'rand.js')],
    ['library.cjs', 'artifex/examples/drift.js'],
    ['up.cjs', '../outside.js'],
    ['package.cjs', 'some-package'],
    ['unlisted.cjs', './lib/unlisted.js'],
    ['nested.cjs', '../../outside.js', 'lib/leak.js'],
  ]) {
    write('pack/' + name, piece(name === 'nested.cjs' ? "require('./lib/leak.js');" : 'require(' + JSON.stringify(spec) + ');'));
    assert.throws(() => load(name), new RegExp(escape(path.join(pack, file)) + ' requires ' + escape(spec) + '.*which is not a listed file of '), name);
  }
  assert.throws(() => loadExternal('./lib/unlisted.js', pack, { confine: { root: pack, files } }),
    new RegExp(escape(path.join(pack, 'lib', 'unlisted.js')) + ' is not a listed file of '));
});

// tools/piece-input.js folds case on win32 and darwin only, and a case-sensitive volume (a macOS one can be) resolves
// no second spelling; so this test runs where the platform folds and the temp volume ignores case.
const caseSkip = () => {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return 'tools/piece-input.js folds case only on win32 and darwin';
  const tmp = os.tmpdir();
  return fs.existsSync(tmp === tmp.toUpperCase() ? tmp.toLowerCase() : tmp.toUpperCase()) ? false : 'the temp volume is case-sensitive, so a second spelling names no file';
};

test('a confine list spelled in another case lists the same files on a volume that ignores case', { skip: caseSkip() }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-external-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'lib'));
  fs.writeFileSync(path.join(dir, 'lib', 'dots.js'), 'module.exports = 1;');
  fs.writeFileSync(path.join(dir, 'lib', 'unlisted.js'), 'module.exports = 2;');
  const piece = (needs) => needs + "\nmodule.exports = { name: 'cased', size: { w: 10, h: 10 }, draw(g) { g.fillRect(0, 0, 10, 10); } };";
  fs.writeFileSync(path.join(dir, 'piece.cjs'), piece("require('./lib/dots.js');"));
  const confine = { root: dir, files: ['PIECE.cjs', 'Lib/DOTS.js'] };
  assert.equal(loadExternal('./piece.cjs', dir, { confine }).moduleCount, 2, 'a miscased list names the files it lists');
  fs.writeFileSync(path.join(dir, 'piece.cjs'), piece("require('./lib/unlisted.js');"));
  assert.throws(() => loadExternal('./piece.cjs', dir, { confine }), /not a listed file of /, 'an unlisted file stays refused');
});
