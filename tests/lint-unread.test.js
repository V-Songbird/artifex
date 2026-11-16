'use strict';

// The unread-name lint on small fixtures: a destructured binding its own file
// never reads is reported, even when the name it copies is read elsewhere, and
// a name mentioned only in a comment, a string or a regular expression is unread.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { bindings, pattern, topLevel, unreadContractKeys, unreadNames } = require('../tools/lint-unread.js');

test('lint: a destructuring pattern binds its targets, not its keys or defaults', () => {
  assert.deepEqual(bindings('{ a, b: c, d = f(g, h), ...e }'), ['a', 'c', 'd', 'e']);
  assert.deepEqual(bindings('[x, , [y, { z }], ...rest]'), ['x', 'y', 'z', 'rest']);
  assert.deepEqual(bindings('{\n  a,\n  b: { c = [1, 2] },\n}'), ['a', 'c']);
  assert.deepEqual(bindings("{\n  a, // the one, used\n  b, /* don't */ c,\n}"), ['a', 'b', 'c']);
});

test('lint: a destructured name its file never reads is reported, a read one is not', () => {
  const files = [
    ['lib.js', 'function used() {}\nfunction unused() {}\nmodule.exports = { used, unused };\n'],
    ['app.js', "const { used, unused } = require('./lib.js');\nconst [first, second] = [')', 2]; // ]\nused(first);\n"],
  ];
  const { hits } = unreadNames(files);
  assert.deepEqual(hits.map((h) => `${h.file} ${h.name} ${h.kind}`), [
    'app.js unused destructured',
    'app.js second destructured',
  ]);
});

test('lint: a vendored file reports nothing of its own, but still reads names', () => {
  const files = [
    ['lib.js', 'function helper() {}\nmodule.exports = { helper };\n'],
    ['vendor.js', '// Vendored from somewhere 1.0.0\nfunction shipped() {}\nhelper();\n'],
    ['plain.js', 'function lonely() {}\n'],
  ];
  const { hits } = unreadNames(files);
  assert.deepEqual(hits.map((h) => `${h.file} ${h.name}`), ['plain.js lonely']);
});

test('lint: a class member named like a destructured binding does not read it', () => {
  const files = [
    ['lib.js', 'function draw() {}\nmodule.exports = { draw };\n'],
    ['app.js', "const { draw } = require('./lib.js');\nclass Pen {\n  draw() { return 1; }\n}\nnew Pen().draw();\n"],
  ];
  const { hits } = unreadNames(files);
  assert.deepEqual(hits.map((h) => `${h.file} ${h.name} ${h.kind}`), ['app.js draw destructured']);
});

test('lint: a name in a comment, a string or a regular expression is not a reader', () => {
  const files = [
    ['a.js', [
      '// helper() is kept for later',
      'function helper() {}',
      "const note = 'call helper here';",
      'const t = `${note} helper ${`${kept} helper`}`;',
      "const re = /'helper/g; kept(re.of / 2, re, t); // '",
      'function kept() {}',
      '/* helper */',
      'const g = 0;',
      '',
    ].join('\n')],
  ];
  const { hits } = unreadNames(files);
  assert.deepEqual(hits.map((h) => `${h.file} ${h.name} ${h.kind}`), ['a.js helper declared', 'a.js g declared']);
});

test("lint: the page's browser code in a template is source, its other templates are not", () => {
  const files = [
    ['lib.js', 'function boot() {}\nmodule.exports = { boot };\n'],
    ['tools/build-page.js', [
      "const { boot } = require('./lib.js');",
      'const RUNTIME = `',
      'function __def(id, fn) { return fn(id); }',
      '`;',
      'function helper() {}',
      'const wrap = (src) => `__def(1, function () {\\n${src}\\n});`;',
      'const page = () => `<p>helper</p>',
      '<script>',
      '${RUNTIME}',
      '__def(2, boot);',
      '</script>`;',
      'module.exports = { page, wrap };',
      '',
    ].join('\n')],
  ];
  const { hits } = unreadNames(files);
  assert.deepEqual(hits.map((h) => `${h.file} ${h.name} ${h.kind}`), ['tools/build-page.js helper declared']);
});

const hitsOf = (files) => unreadNames(files).hits.map((h) => `${h.file} ${h.name} ${h.kind}`);

test('lint: a regular expression after a condition or a block is not a reader', () => {
  assert.deepEqual(hitsOf([['a.js', 'function helper() {}\nconst s = 1;\nif (s) /helper/.test(s);\n']]), ['a.js helper declared']);
  assert.deepEqual(hitsOf([['a.js', 'function helper() {}\nconst s = 1;\nwhile (s) /helper/.test(s);\n']]), ['a.js helper declared']);
  assert.deepEqual(hitsOf([['a.js', 'function helper() {}\nconst s = 1;\n{}\n/helper/.test(s);\n']]), ['a.js helper declared']);
  assert.deepEqual(hitsOf([['a.js', 'function helper() {}\nconst s = 1;\nwhile   (s)\n  /helper/.test(s);\n']]), ['a.js helper declared']);
  // After return, however far away or past a comment, a slash starts one.
  assert.deepEqual(hitsOf([['a.js', 'function helper() {}\nfunction f(s) {\n  return            /helper/.test(s);\n}\nmodule.exports = { f };\n']]), ['a.js helper declared']);
  assert.deepEqual(hitsOf([['a.js', 'function helper() {}\nfunction f(s) {\n  return /* c */ /helper/.test(s);\n}\nmodule.exports = { f };\n']]), ['a.js helper declared']);
  // A slash after a plain parenthesis is still a division.
  assert.deepEqual(hitsOf([['a.js', 'function helper() {}\nconst s = (1) / helper() / 2;\nmodule.exports = { s };\n']]), []);
});

test('lint: a slash after a postfix increment is a division, not a regular expression', () => {
  assert.deepEqual(hitsOf([['a.js', 'function helper() {}\nlet n = 0;\nn++ / 2; const re = /(helper)/;\nmodule.exports = { re };\n']]), ['a.js helper declared']);
  assert.deepEqual(hitsOf([['a.js', 'function helper() {}\nlet n = 0;\nn-- / 2; const re = /(helper)/;\nmodule.exports = { re };\n']]), ['a.js helper declared']);
});

test('lint: an async class member, or one at any indent, does not read a binding of its name', () => {
  const lib = ['lib.js', 'function draw() {}\nmodule.exports = { draw };\n'];
  assert.deepEqual(hitsOf([lib, ['app.js', "const { draw } = require('./lib.js');\nclass Pen {\n  async draw() { return 1; }\n}\nnew Pen();\n"]]), ['app.js draw destructured']);
  assert.deepEqual(hitsOf([lib, ['app.js', "const { draw } = require('./lib.js');\nclass Pen {\n    draw() { return 1; }\n}\nnew Pen();\n"]]), ['app.js draw destructured']);
  assert.deepEqual(hitsOf([lib, ['app.js', "const { draw } = require('./lib.js');\nclass Pen {\n\tstatic async draw() { return 1; }\n}\nnew Pen();\n"]]), ['app.js draw destructured']);
});

test('lint: a property access with a space after the dot does not read a binding', () => {
  const lib = ['lib.js', 'function draw() {}\nmodule.exports = { draw };\n'];
  assert.deepEqual(hitsOf([lib, ['app.js', "const { draw } = require('./lib.js');\nconst o = {};\no. draw();\no.\n  draw();\n"]]), ['app.js draw destructured']);
  assert.deepEqual(hitsOf([lib, ['app.js', "const { draw } = require('./lib.js');\nconst o = [];\no.push(...draw);\n"]]), []);
});

test('lint: a // inside a string does not hide the rest of a destructuring pattern', () => {
  assert.deepEqual(bindings("{ a = 'http://example.test', b }"), ['a', 'b']);
  assert.deepEqual(bindings('{ a = `//`, b } // c'), ['a', 'b']);
});

test('lint: a quote in a comment or a regular expression does not open a string in a pattern', () => {
  assert.equal(pattern("{ /* it's */ a, b } = x; 'c'", 0), "{ /* it's */ a, b }");
  assert.equal(pattern("{ a = /'/, b } = x; '", 0), "{ a = /'/, b }");
  assert.equal(pattern("{ a = 'http://x', b } = x; // )", 0), "{ a = 'http://x', b }");
});

test('lint: a ternary in a default binds the name before it, not the branch after its colon', () => {
  assert.deepEqual(bindings('{ a = c ? d : e, f }'), ['a', 'f']);
  assert.deepEqual(bindings('{ k: a = c ? d : e, f = g?.h ?? i }'), ['a', 'f']);
  assert.deepEqual(hitsOf([['app.js', 'const c = 1;\nconst { a = c ? 2 : 3, f } = {};\nf();\n']]), ['app.js a destructured']);
});

test('lint: a lone ? before a top-level comma or semicolon does not swallow a later colon', () => {
  assert.deepEqual(topLevel('a ?, b: c', ':'), ['a ?, b', ' c']);
  assert.deepEqual(topLevel('a ?; b: c', ':'), ['a ?; b', ' c']);
  assert.deepEqual(topLevel('x ? y : z, b: c', ':'), ['x ? y : z, b', ' c']);
});

test('lint: a regular expression or a comment in a destructuring pattern hides no binding', () => {
  assert.deepEqual(bindings("{ a = /'/, b }"), ['a', 'b']);
  assert.deepEqual(bindings('{ a = /[,]/, b }'), ['a', 'b']);
});

test('lint: pattern() scans a file once for all its patterns', () => {
  const comments = require('../tools/js-comments.js');
  const real = comments.scan, file = require.resolve('../tools/lint-unread.js'), cached = require.cache[file];
  let calls = 0;
  comments.scan = (src) => { calls++; return real(src); };
  delete require.cache[file];
  try {
    const fresh = require(file);
    const src = Array.from({ length: 20 }, (_, i) => `const { a${i}, b${i} } = require('./m${i}.js'); // }`).join('\n');
    const opens = [...src.matchAll(/\{ a/g)].map((m) => m.index);
    for (const at of opens) assert.match(fresh.pattern(src, at), /^\{ a\d+, b\d+ \}$/);
    assert.equal(calls, 1, `${opens.length} patterns in one file took ${calls} scans`);
  } finally {
    comments.scan = real;
    require.cache[file] = cached;
  }
});

test('lint: a contract key right after a block comment, or after a file ending in a // comment, has a consumer', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-unread-'));
  try {
    fs.mkdirSync(path.join(root, 'core'));
    fs.writeFileSync(path.join(root, 'core', 'piece.js'), 'const FIELDS = {\n  alpha: {\n  },\n  beta: {\n  },\n};\nconst OUTPUTS = 1;\n');
    fs.writeFileSync(path.join(root, 'core', 'a.js'), 'function f() { return/* c */alpha; }\n// ends without a newline');
    fs.writeFileSync(path.join(root, 'core', 'b.js'), 'use(opts.beta);\n');
    assert.deepEqual(unreadContractKeys(root).map((h) => h.name), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('lint: a U+2028 or U+2029 ends a // comment, so a contract key after it has a consumer', () => {
  const { uncomment } = require('../tools/js-comments.js');
  assert.equal(uncomment('// note\u{2028}use(x); // more\u{2029}use(y);'), '\u{2028}use(x); \u{2029}use(y);');
  assert.equal(uncomment("const s = '// a\u{2028}b';"), "const s = '// a\u{2028}b';", 'a terminator inside a string stays text');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-unread-'));
  try {
    fs.mkdirSync(path.join(root, 'core'));
    fs.writeFileSync(path.join(root, 'core', 'piece.js'), 'const FIELDS = {\n  alpha: {\n  },\n};\nconst OUTPUTS = 1;\n');
    fs.writeFileSync(path.join(root, 'core', 'a.js'), '// note\u{2028}use(opts.alpha);\n');
    assert.deepEqual(unreadContractKeys(root).map((h) => h.name), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('lint: a lone CR ends a // comment, and a CRLF pair still ends it once', () => {
  const { uncomment } = require('../tools/js-comments.js');
  assert.equal(uncomment('// x\ruse(a);'), '\ruse(a);');
  assert.equal(uncomment('// x\r\nuse(a); // y\r\n'), '\nuse(a); \n', 'a CRLF file loses the CR with its comment, as before');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-unread-'));
  try {
    fs.mkdirSync(path.join(root, 'core'));
    fs.writeFileSync(path.join(root, 'core', 'piece.js'), 'const FIELDS = {\n  alpha: {\n  },\n};\nconst OUTPUTS = 1;\n');
    fs.writeFileSync(path.join(root, 'core', 'a.js'), '// note\ruse(opts.alpha);\r');
    assert.deepEqual(unreadContractKeys(root).map((h) => h.name), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('lint: a string or regular expression left open stops at a lone CR, and blank() keeps every line terminator', () => {
  const { scan, uncomment, blank, lineEnd, quotedEnd } = require('../tools/js-comments.js');
  assert.equal(uncomment("const s = 'a\ruse(b); // c\r"), "const s = 'a\ruse(b); \r", 'an open string stops at a lone CR');
  assert.equal(uncomment('x = /a\ruse(b); // c/\r'), 'x = /a\ruse(b); \r', 'an open regular expression stops at a lone CR');
  assert.equal(uncomment("const s = 'a\\\rb'; // c"), "const s = 'a\\\rb'; ", 'an escaped CR continues the string');
  assert.deepEqual(scan("const s = 'a\\\r\nb'; x;\r\n"), [['string', 11, 16]], 'an escaped CRLF continues the string');
  assert.equal(blank('// a\u{2028}b\n\'x\\\ry\' `p\u{2029}q` // r\r\nz'), '    \u{2028}b\n\'  \r \' ` \u{2029} `     \r\nz');
  assert.deepEqual([lineEnd('ab\r\ncd', 0), lineEnd('ab\rcd', 0), lineEnd('a\u{2029}b\n', 2), lineEnd('ab', 1)], [3, 2, 3, 2]);
  assert.deepEqual([quotedEnd("'a\u{2028}b\n", 0), quotedEnd("'ab\r\ncd", 0), quotedEnd("'a\\\r\nb'", 0), quotedEnd("'a\\", 0)], [4, 3, 6, 3]);
  assert.deepEqual(scan('x = /a\r\nb'), [['regex', 5, 6]], 'an open regular expression stops at the CR of a CRLF pair');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-unread-'));
  try {
    fs.mkdirSync(path.join(root, 'core'));
    fs.writeFileSync(path.join(root, 'core', 'piece.js'), 'const FIELDS = {\n  alpha: {\n  },\n};\nconst OUTPUTS = 1;\n');
    fs.writeFileSync(path.join(root, 'core', 'a.js'), "const s = 'it\ruse(opts.alpha); // '\r");
    assert.deepEqual(unreadContractKeys(root).map((h) => h.name), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('lint: scanning a long one-line source takes time in step with its length', () => {
  const { scan } = require('../tools/js-comments.js');
  // Strings and regular expressions on one line: a scan that looks ahead to the
  // line's end for each literal takes sixteen times as long for four times the
  // line. The fastest of up to seven alternating runs, so warm-up and load even
  // out; a run over two seconds already shows the cost and stops the repeats.
  const best = [Infinity, Infinity];
  for (let round = 0; round < 7 && (!round || Math.max(...best) < 2e9); round++) {
    for (const k of [0, 1]) {
      const n = 10000 * (1 + 3 * k), src = "var a = 'x' + \"y\" + /z/g.test(b); ".repeat(n);
      const start = process.hrtime.bigint();
      assert.equal(scan(src).length, n * 4);
      best[k] = Math.min(best[k], Number(process.hrtime.bigint() - start));
    }
  }
  const ratio = best[1] / best[0];
  assert.ok(ratio < 8, `four times the line took ${ratio.toFixed(2)} times as long`);
});

test('lint: templateEnd follows ${...}, and regexEnd stops at a CRLF', () => {
  const { templateEnd, regexEnd } = require('../tools/js-comments.js');
  assert.deepEqual([templateEnd("`${'`'}` + x", 0), templateEnd('`a${`b${"}"}` /* ` */}c`', 0), templateEnd('`a${b', 0), templateEnd('x `a`', 2)], [7, 23, 5, 4]);
  assert.deepEqual([regexEnd('/a[/]b/g', 0), regexEnd('/a\\/b/', 0), regexEnd('/a\r\nb/', 0), regexEnd('/a\\', 0)], [6, 5, 2, 3]);
});

test('lint: of, yield and await divide where they are names, and of starts a regular expression after a for-head binding', () => {
  const { scan } = require('../tools/js-comments.js');
  assert.deepEqual(scan('h = `${of / 2}`; // c'), [['comment', 17, 21]]);
  assert.deepEqual(scan('var yield, await; h = yield / await / 2; // c'), [['comment', 41, 45]], 'in a source that declares them as names');
  assert.deepEqual(scan('for (const x of /a/) f(x instanceof /b/);'), [['regex', 17, 18], ['regex', 37, 38]]);
  assert.deepEqual(scan('for (const [x] of /a/);'), [['regex', 19, 20]], 'after a destructured binding');
  assert.deepEqual(scan('for (x in of / 2);'), [], 'of after in is a name');
  assert.deepEqual(scan('function* g() { yield /a/; } async () => await /b/;'), [['regex', 23, 24], ['regex', 48, 49]]);
  assert.deepEqual(scan('{ /** d */ *g() { yield /a/; } }'), [['comment', 2, 10], ['regex', 25, 26]], 'a generator method after a comment');
  assert.deepEqual(scan('for await (const x of /a/) f(x); // c'), [['regex', 23, 24], ['comment', 33, 37]], 'after a for await head binding');
  assert.deepEqual(scan('for /* c */ await (const x of /a/);'), [['comment', 4, 11], ['regex', 31, 32]], 'a comment between for and await');
  assert.deepEqual(scan('// let await = 1;\nasync function g() { await /a/; }'), [['comment', 0, 17], ['regex', 46, 47]], 'a declaration in a comment does not make await a name');
  assert.deepEqual(scan("const s = 'let await = 1;'; async function g() { await /a/; }"), [['string', 11, 25], ['regex', 56, 57]], 'nor one in a string');
  assert.deepEqual(scan('x = await / 2; var await = 1; // c'), [['comment', 30, 34]], 'a declaration after await / is still code');
  assert.deepEqual(scan('var yield = 4; var h = yield / 2, await = 1; h = await / 2; // c'), [['comment', 60, 64]], 'and one after yield /');
});

test('lint: a comment left open at one core file\'s end does not hide the next file\'s consumer', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-unread-'));
  try {
    fs.mkdirSync(path.join(root, 'core'));
    fs.writeFileSync(path.join(root, 'core', 'piece.js'), 'const FIELDS = {\n  alpha: {\n  },\n};\nconst OUTPUTS = 1;\n');
    fs.writeFileSync(path.join(root, 'core', 'a.js'), 'const x = 1; /* never closed\n');
    fs.writeFileSync(path.join(root, 'core', 'b.js'), 'use(opts.alpha);\n');
    assert.deepEqual(unreadContractKeys(root).map((h) => h.name), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('lint: a contract key read after a // inside a string has a consumer', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-unread-'));
  try {
    fs.mkdirSync(path.join(root, 'core'));
    fs.writeFileSync(path.join(root, 'core', 'piece.js'), 'const FIELDS = {\n  alpha: {\n  },\n  beta: {\n  },\n};\nconst OUTPUTS = 1;\n');
    fs.writeFileSync(path.join(root, 'core', 'use.js'), "const ns = 'http://example.test'; use(opts.alpha); // beta\n/* beta */\n");
    assert.deepEqual(unreadContractKeys(root).map((h) => h.name), ['beta']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
