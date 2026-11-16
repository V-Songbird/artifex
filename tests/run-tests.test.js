'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs, edges, affected } = require('../tools/run-tests');
const { scan } = require('../tools/js-comments');

const FILES = {
  'core/a.js': "const b = require('./b');",
  'core/b.js': '',
  'core/c.js': '',
  'tools/cli.js': "require('../core/c.js');",
  'tests/fixtures/thing.cjs': "require('artifex/core/b');",
  'docs/guide.md': 'see core/c.js',
  'tests/a.test.js': "require('../core/a');",
  'tests/cli.test.js': "spawn(process.execPath, [path.join(ROOT, 'tools', 'cli.js')]);",
  'tests/fixture.test.js': "load('tests/fixtures/thing.cjs');",
  'tests/doc.test.js': "read('docs/guide.md');",
};
const TESTS = Object.keys(FILES).filter((f) => f.endsWith('.test.js'));
const DEPS = edges(Object.keys(FILES), (f) => FILES[f]);

test('run-tests selects tests that require a changed file, directly or through another', () => {
  assert.deepEqual(affected(TESTS, DEPS, ['core/a.js']), ['tests/a.test.js']);
  assert.deepEqual(affected(TESTS, DEPS, ['core/b.js']), ['tests/a.test.js', 'tests/fixture.test.js']);
});

test('run-tests follows a named tool or fixture to what it requires', () => {
  assert.deepEqual(affected(TESTS, DEPS, ['core/c.js']), ['tests/cli.test.js']);
  assert.deepEqual(affected(TESTS, DEPS, ['tests/fixtures/thing.cjs']), ['tests/fixture.test.js']);
});

test('run-tests reaches a Markdown file by name but goes no further', () => {
  assert.deepEqual(affected(TESTS, DEPS, ['docs/guide.md']), ['tests/doc.test.js']);
  assert.equal(DEPS.get('docs/guide.md').size, 0);
});

test('run-tests selects a changed test itself and nothing for an unrelated file', () => {
  assert.deepEqual(affected(TESTS, DEPS, ['tests/doc.test.js']), ['tests/doc.test.js']);
  assert.deepEqual(affected(TESTS, DEPS, ['README.md']), []);
});

test('run-tests selects the skill-samples test for a skill doc or a core module it reads by directory', () => {
  const tests = ['tests/skill-samples.test.js', 'tests/doc.test.js'];
  const deps = new Map(tests.map((t) => [t, new Set()]));
  for (const f of ['skills/artifex/SKILL.md', 'skills/artifex/reference/films.md', 'core/num.js']) {
    assert.deepEqual(affected(tests, deps, [f]), ['tests/skill-samples.test.js'], f);
  }
  assert.deepEqual(affected(tests, deps, ['skills/artifex/styles/catalog.md', 'docs/guide.md']), []);
});

test('run-tests follows the skill names artifex/styles/ and <library root>/ in a require, in code and in a doc sample', () => {
  const sample = ['```js', "require('artifex/styles/lib/ink');", "require('<library root>/tools/sheet');", "require('./not-a-library-file');", '```'].join('\n');
  const files = {
    'skills/artifex/SKILL.md': sample,
    'skills/artifex/styles/lib/ink.js': '',
    'skills/artifex/styles/other.js': '',
    'tools/sheet.js': '',
    'tools/seeds.js': '',
    'core/num.js': '',
    'tests/skill-samples.test.js': "fs.readdirSync(path.join(SKILL, 'reference'));",
    'tests/styled.test.js': "require('artifex/styles/lib/ink');require('<library root>/core/num');",
  };
  const names = Object.keys(files);
  const deps = edges(names, (f) => files[f]);
  assert.deepEqual([...deps.get('skills/artifex/SKILL.md')].sort(), ['skills/artifex/styles/lib/ink.js', 'tools/sheet.js']);
  assert.deepEqual([...deps.get('tests/styled.test.js')].sort(), ['core/num.js', 'skills/artifex/styles/lib/ink.js']);
  const tests = names.filter((f) => f.endsWith('.test.js'));
  // The samples test lists the skill docs by directory, so only what the docs require reaches it.
  assert.deepEqual(affected(tests, deps, ['skills/artifex/styles/lib/ink.js']), ['tests/skill-samples.test.js', 'tests/styled.test.js']);
  assert.deepEqual(affected(tests, deps, ['tools/sheet.js']), ['tests/skill-samples.test.js']);
  assert.deepEqual(affected(tests, deps, ['skills/artifex/styles/other.js', 'tools/seeds.js']), []);
});

test('run-tests reads a Markdown require only from a fenced js sample, not from prose or a comment', () => {
  const doc = [
    "Prose: require('artifex/core/prose') is not a dependency.",
    '```js',
    "// require('artifex/core/commented');",
    "require('artifex/core/sample');",
    '```',
    '```text',
    "require('artifex/core/other-fence');",
    '```',
    '- A list item:',
    '',
    '  ```js',
    "  require('artifex/core/indented');",
    '  ```',
  ].join('\n');
  const files = { 'docs/guide.md': doc, 'core/prose.js': '', 'core/commented.js': '', 'core/sample.js': '', 'core/other-fence.js': '', 'core/indented.js': '' };
  const deps = edges(Object.keys(files), (f) => files[f]);
  assert.deepEqual([...deps.get('docs/guide.md')].sort(), ['core/indented.js', 'core/sample.js']);
});

test('run-tests reads a sample whose fence has a space before the language, as the skill-samples test runs it', () => {
  const doc = ['``` js', "require('artifex/core/spaced');", '```', '```cjs', "require('artifex/core/cjs-only');", '```'].join('\n');
  const files = { 'docs/guide.md': doc, 'core/spaced.js': '', 'core/cjs-only.js': '' };
  const deps = edges(Object.keys(files), (f) => files[f]);
  assert.deepEqual([...deps.get('docs/guide.md')], ['core/spaced.js']);
});

test('run-tests: an edit to the runner alone does not select the skill-samples test, an edit to the shared parser does', () => {
  const read = (f) => { try { return fs.readFileSync(path.join(__dirname, '..', f), 'utf8'); } catch { return ''; } };
  const names = ['tools/run-tests.js', 'tools/markdown-samples.js', 'tests/skill-samples.test.js', 'tests/run-tests.test.js'];
  const deps = edges(names, read);
  const tests = names.filter((f) => f.endsWith('.test.js'));
  assert.deepEqual(affected(tests, deps, ['tools/run-tests.js']), ['tests/run-tests.test.js']);
  assert.deepEqual(affected(tests, deps, ['tools/markdown-samples.js']), tests);
});

test('run-tests keeps a require that follows a /* inside a line comment or a string', () => {
  const files = {
    'tools/a.js': ["// reads reference/*.md and tests/*.test.js", "require('./one');", "const glob = 'skills/*.md'; /* block */ require('./two');", "const t = `x/*y`; require('./three');", "require('./four'); // http://x/* not a start", "/* require('./gone'); */"].join('\n'),
    'tools/one.js': '', 'tools/two.js': '', 'tools/three.js': '', 'tools/four.js': '', 'tools/gone.js': '',
  };
  const deps = edges(Object.keys(files), (f) => files[f]);
  assert.deepEqual([...deps.get('tools/a.js')].sort(), ['tools/four.js', 'tools/one.js', 'tools/three.js', 'tools/two.js']);
});

test('run-tests keeps a require after a regex literal holding //, a quote or a backtick', () => {
  const files = {
    'tools/a.js': [
      "const url = /^https?:\\/\\//; require('./one');",
      'const tick = /`/;',
      "require('./two');",
      'const q = /[\'"]/g;',
      "const s = `https://x`; require('./three'); // require('./gone')",
      "const half = total / 2; require('./four'); const r = half / 3;",
    ].join('\n'),
    'tools/one.js': '', 'tools/two.js': '', 'tools/three.js': '', 'tools/four.js': '', 'tools/gone.js': '',
  };
  const deps = edges(Object.keys(files), (f) => files[f]);
  assert.deepEqual([...deps.get('tools/a.js')].sort(), ['tools/four.js', 'tools/one.js', 'tools/three.js', 'tools/two.js']);
});

test('run-tests keeps a require after a regex holding /* that follows a control head', () => {
  const files = {
    'tools/a.js': ["if (ok) /\\/*/.test(s); require('./one');", "const q = f(a) / 2 /* half */ + g[1] / 2; require('./two');", "n++ / 2; require('./three'); // */ require('./gone')"].join('\n'),
    'tools/one.js': '', 'tools/two.js': '', 'tools/three.js': '', 'tools/gone.js': '',
  };
  assert.deepEqual([...edges(Object.keys(files), (f) => files[f]).get('tools/a.js')].sort(), ['tools/one.js', 'tools/three.js', 'tools/two.js']);
});

test('run-tests reads a slash after ++ or -- as a regex unless the operator is postfix on the same line', () => {
  const files = {
    'tools/a.js': [
      "x = 1 + ++/'/.lastIndex; require('./one'); // require('./gone')",
      "a = b",
      "++/'/.lastIndex; require('./two'); // require('./gone')",
      "const t = `${1 + ++/'/.lastIndex}`; require('./three'); // require('./gone')",
      "n++ / 2; m-- /1; require('./four'); // '",
      "x = a / ++/'/.lastIndex; require('./five'); // require('./gone')",
      "f(...++/'/.lastIndex); require('./six'); // require('./gone')",
    ].join('\n'),
    'tools/one.js': '', 'tools/two.js': '', 'tools/three.js': '', 'tools/four.js': '', 'tools/five.js': '', 'tools/six.js': '', 'tools/gone.js': '',
  };
  assert.deepEqual([...edges(Object.keys(files), (f) => files[f]).get('tools/a.js')].sort(), ['tools/five.js', 'tools/four.js', 'tools/one.js', 'tools/six.js', 'tools/three.js', 'tools/two.js']);
  assert.deepEqual(scan("f(...++/'/.lastIndex); // c").map(([kind]) => kind), ['regex', 'comment'], 'a ++ after a spread is prefix');
});

test('run-tests reads a keyword right after a spread `...` as a keyword, so a slash after it starts a regex', () => {
  assert.deepEqual(scan("[...typeof/'/.source]; // c").map(([kind]) => kind), ['regex', 'comment']);
  assert.deepEqual(scan("a.typeof/'/.source; // c").map(([kind]) => kind), ['string'], 'after a member access it is a property name');
  assert.deepEqual(scan("a. typeof/'/; // c").map(([kind]) => kind), ['string'], 'past a space too');
  assert.deepEqual(scan("a./* c */typeof/'/; // c").map(([kind]) => kind), ['comment', 'string'], 'past a comment too');
  assert.deepEqual(scan("this.#typeof / 2; require('./a.js'); // '").map(([kind]) => kind), ['string', 'comment'], 'a private name is not a keyword');
  assert.deepEqual(scan("this.#if (a) /'/; // c").map(([kind]) => kind), ['string'], 'nor a control keyword');
  assert.deepEqual(scan("a. if (a) /'/; // c").map(([kind]) => kind), ['string'], 'nor a member control word past a space');
  assert.deepEqual(scan("a.\n if (a) /'/; // c").map(([kind]) => kind), ['string'], 'nor one past a line break');
  assert.deepEqual(scan("x = 1.\ntypeof /'/.source; // c").map(([kind]) => kind), ['regex', 'comment'], 'a dot that ends a number is not a member access');
  for (const n of ['a1', '1.5', '1.', '0x10', '1e-5', '1e+5']) assert.deepEqual(scan(`x = ${n}.in /'/; // c`).map(([kind]) => kind), ['string'], `a dot after ${n} is a member access`);
  for (const [n, what] of [['a' + '1'.repeat(70), 'a name ending in 70 digits'], ['01', 'a legacy octal 01'], ['\u{1D465}1', 'an astral name character and a digit'], ['x = \\u{61}1', 'a braced escape in a name and a digit']])assert.deepEqual(scan(`${n}.in /'/; // c`).map(([kind]) => kind), ['string'], `a dot after ${what} is a member access`);
  assert.deepEqual(scan("x = a.b, 'k'in /'/; // c").map(([kind]) => kind), ['string', 'regex', 'comment'], 'a word right after a string is read from the string, not an earlier member');
  assert.deepEqual(scan("x = a.b, `k`in /'/; // c").map(([kind]) => kind), ['template', 'regex', 'comment'], 'or a template');
});

test('run-tests follows a require with a comment or a space before its parenthesis', () => {
  const files = {
    'tools/a.js': "require/* x */('./one'); require ('./two');",
    'tools/one.js': '', 'tools/two.js': '',
  };
  assert.deepEqual([...edges(Object.keys(files), (f) => files[f]).get('tools/a.js')].sort(), ['tools/one.js', 'tools/two.js']);
});

test('run-tests follows only a require of that name, not one that ends in it', () => {
  const files = {
    'tools/a.js': "myrequire ('./one'); _require('./two'); require('./three');",
    'tools/one.js': '', 'tools/two.js': '', 'tools/three.js': '',
  };
  assert.deepEqual([...edges(Object.keys(files), (f) => files[f]).get('tools/a.js')], ['tools/three.js']);
});

test('js-comments: blank keeps every index and newline, and blanks only what is not code', () => {
  const { blank } = require('../tools/js-comments');
  assert.equal(blank("f('a b') // c\n/* d\ne */ `x ${y} z`"), "f('   ')     \n    \n     `  ${y}  `");
});

test('js-comments: one reading of comments, strings, templates and regular expressions', () => {
  const { uncomment } = require('../tools/js-comments');
  const cases = [
    ['if (ok) /[//]/.test(u); // c', 'if (ok) /[//]/.test(u); '],
    ['while (x)\n  /\\/*/.test(u); /* c */', 'while (x)\n  /\\/*/.test(u);  '],
    ['a = f(b) / 2 /* c */ / 3;', 'a = f(b) / 2   / 3;'],
    ['a = b[0] / 2 /* c */ / 3;', 'a = b[0] / 2   / 3;'],
    ['n++ / 2 /* c */ + 1;', 'n++ / 2   + 1;'],
    ['n-- / 2 /* c */ + 1;', 'n-- / 2   + 1;'],
    ['x = s.of / 2 /* c */ + 1;', 'x = s.of / 2   + 1;'],
    ['return /* c */ /a*/.test(s);', 'return   /a*/.test(s);'],
    ["s = 'a /* b' + \"c // d\"; // e", "s = 'a /* b' + \"c // d\"; "],
    ['t = `a /* ${f(`b // ${1 /* c */}`)} d */`; // e', 't = `a /* ${f(`b // ${1  }`)} d */`; '],
    ['// a /* b\nx; // */ y', '\nx; '],
    // A block comment leaves a space, so the names on either side stay apart.
    ['use(x)/* c */alpha', 'use(x) alpha'],
  ];
  for (const [src, want] of cases) assert.equal(uncomment(src), want, src);
});

test('run-tests refuses a concurrency that is not a whole number of 1 or more', () => {
  assert.equal(parseArgs(['--concurrency', '3']).concurrency, 3);
  assert.throws(() => parseArgs(['--concurrency', '0']), /--concurrency needs/);
  assert.throws(() => parseArgs(['--bogus']), /unknown option --bogus/);
});
