'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { loadExternal, callerDirectory, outputStem } = require('../tools/piece-input.js');
const { bundle, html, checkParses } = require('../tools/build-page.js');
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

test('external piece paths use the npm caller only for this library page/seeds script', () => {
  const cwd = path.join(ROOT, 'caller'), initial = path.join(ROOT, 'initial');
  const env = { npm_lifecycle_event: 'page', npm_package_json: path.join(ROOT, 'package.json'), INIT_CWD: initial };
  assert.equal(callerDirectory(cwd, env), initial);
  assert.equal(callerDirectory(cwd, { ...env, npm_lifecycle_event: 'seeds' }), initial);
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
  const npm = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  run([npm, '--prefix', ROOT, 'run', 'page', '--', './My piece.cjs']);
  run([npm, '--prefix', ROOT, 'run', 'seeds', '--', './My piece.cjs', '3', '0.5', '--param', 'width']);
  const sweep = fs.readFileSync(path.join(project, 'My piece-param-width.html'), 'utf8');
  assert.equal(checkParses(sweep), true);
  assert.match(sweep, /external-study/);
  assert.equal(fs.existsSync(path.join(project, 'out')), false);
  assert.equal(fs.existsSync(file), true);
});
