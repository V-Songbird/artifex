'use strict';

// The js samples in the runtime skill (SKILL.md and the reference docs) are what an
// agent copies into a piece. This test runs them, so a sample that throws fails CI.
//
// Which samples run: every fenced js block, with `artifex/core/<file>`,
// `artifex/styles/<file>` and `<library root>/<path>` resolved to this repository.
// Each runs alone in a child process with a timeout, as the body of a function,
// so a hanging sample fails fast and one sample cannot leak into the next.
//
// Which samples are fragments, by two rules and no list of lines:
//   - it does not parse as a program (an object literal, a method signature, `draw(g, s, t) { ... }`);
//   - it runs until its own code uses a name it never declares (`g`, `s`, `clock`, a helper the doc
//     leaves out); an undeclared name thrown from inside core or a style module is a failure.
// The number of samples that run clean is pinned (CLEAN_RUNS), so one that turns into a fragment fails.
// A fragment is skipped. A sample that parses and meets neither rule must run to the end
// without throwing. A sample that throws anything else is broken; if the doc cannot be
// edited yet, KNOWN_FAILURES names it, and the test then fails once it stops throwing.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SKILL = path.join(ROOT, 'skills', 'artifex');
const TIMEOUT = 20000;

// How many samples run clean today; a sample that drops to a fragment changes it.
const CLEAN_RUNS = 24;

// Samples that throw today: doc path (from the repository root), the nearest heading, why, and the
// error it must throw (`message`, matched against the first line of the error), so a moved
// module the sample requires first is not mistaken for the expected failure.
const KNOWN_FAILURES = [
  {
    doc: 'skills/artifex/reference/films.md',
    heading: 'The smallest figure that still acts',
    why: "loads './my-piece.cjs', a placeholder for the reader's own piece, so it cannot run as written",
    message: /^Error: piece: cannot load .*my-piece\.cjs: Cannot find module/,
  },
];

/** Why a known failure's result does not count as the expected failure, or '' when it does. */
function knownFailureProblem(entry, result) {
  if (isFragment(result) || result.kind !== 'threw') return `the known failure (${entry.why}) no longer fails: remove it from KNOWN_FAILURES (got ${result.kind})`;
  if (!entry.message.test(result.message.split('\n')[0])) return `the known failure (${entry.why}) now throws something else, ${entry.message}: ${result.message.split('\n')[0]}`;
  return '';
}

// The same parser test selection uses, so the docs that select this test are the ones whose samples run.
const { jsSamples: extractSamples } = require('../tools/markdown-samples');

// The child: reads the sample on stdin, runs it as a function body with a `require`
// that resolves the skill's names to this repository, and prints one result line.
function child() {
  const Module = require('node:module');
  const root = process.argv[process.argv.length - 1];
  const real = Module.createRequire(require('node:path').join(root, 'sample.js'));
  const join = (...parts) => require('node:path').join(root, ...parts);
  const resolve = (spec) => {
    let match;
    if ((match = /^artifex\/core\/(.+)$/.exec(spec))) return join('core', match[1]);
    if ((match = /^artifex\/styles\/(.+)$/.exec(spec))) return join('skills', 'artifex', 'styles', match[1]);
    if ((match = /^<library root>\/(.+)$/.exec(spec))) return join(match[1]);
    return spec;
  };
  const report = (result) => {
    require('node:fs').writeSync(1, '\n\u0001' + JSON.stringify(result) + '\n');
    process.exit(0);
  };
  const source = require('node:fs').readFileSync(0, 'utf8');
  let body;
  try { body = new Function('require', source); }
  catch (error) { report({ kind: 'syntax', message: error.message }); }
  try { body((spec) => real(resolve(spec))); }
  catch (error) {
    // Only the sample's own code counts: a name core or a style module fails to declare is a defect.
    const top = String(error && error.stack || '').split('\n').find((text) => /^\s*at /.test(text)) || '';
    const undeclared = error instanceof ReferenceError && /^(\S+) is not defined$/.test(error.message) && /\beval at\b/.test(top);
    report(undeclared ? { kind: 'undeclared', message: error.message } : { kind: 'threw', message: String(error && error.stack || error) });
  }
  report({ kind: 'ok' });
}

/** Runs one sample. kind: ok | syntax | undeclared | threw | timeout | crashed. */
function runSample(source, timeout = TIMEOUT) {
  const run = spawnSync(process.execPath, ['-e', '(' + child + ')()', '--', ROOT], { input: source, encoding: 'utf8', timeout, killSignal: 'SIGKILL', cwd: ROOT });
  if (run.error && run.error.code === 'ETIMEDOUT') return { kind: 'timeout', message: 'no result in ' + timeout + ' ms' };
  const line = run.stdout.split('\n').reverse().find((text) => text.startsWith('\u0001'));
  if (!line) return { kind: 'crashed', message: 'exit ' + run.status + ': ' + run.stderr.slice(0, 500) };
  return JSON.parse(line.slice(1));
}

const isFragment = (result) => result.kind === 'syntax' || result.kind === 'undeclared';

/** The skill's Markdown files: SKILL.md, then reference/*.md. */
function docs() {
  const reference = fs.readdirSync(path.join(SKILL, 'reference')).filter((name) => name.endsWith('.md')).sort();
  return ['SKILL.md', ...reference.map((name) => 'reference/' + name)].map((name) => ({
    doc: 'skills/artifex/' + name,
    samples: extractSamples(fs.readFileSync(path.join(SKILL, name), 'utf8')),
  }));
}

const known = (doc, sample) => KNOWN_FAILURES.find((entry) => entry.doc === doc && entry.heading === sample.heading);

// Results for the real docs, one child per sample.
const found = docs().flatMap(({ doc, samples }) => samples.map((sample) => ({ doc, ...sample })));
const results = new Map();
const resultOf = (sample) => {
  if (!results.has(sample)) results.set(sample, runSample(sample.source));
  return results.get(sample);
};

for (const sample of found) {
  test(`${sample.doc}:${sample.line} (${sample.heading}) runs or is a fragment`, () => {
    const result = resultOf(sample);
    const entry = known(sample.doc, sample);
    if (entry) {
      assert.equal(knownFailureProblem(entry, result), '');
      return;
    }
    if (isFragment(result)) return; // a fragment, by the rules at the top
    assert.equal(result.kind, 'ok', `${sample.doc}:${sample.line} ${result.kind}: ${result.message}`);
  });
}

test('every known failure names a sample that exists', () => {
  const stale = KNOWN_FAILURES.filter((entry) => !found.some((sample) => sample.doc === entry.doc && sample.heading === entry.heading));
  assert.deepEqual(stale, []);
});

test('the docs hold a spread of runnable samples, so the fragment rules are not skipping real ones', (t) => {
  const kinds = found.map((sample) => resultOf(sample).kind);
  const count = (...wanted) => kinds.filter((kind) => wanted.includes(kind)).length;
  const ran = count('ok');
  t.diagnostic(`${found.length} js samples: ${ran} ran clean, ${count('syntax')} fragments that do not parse, ${count('undeclared')} fragments with an undeclared name, ${count('threw', 'timeout', 'crashed')} failing`);
  assert.equal(ran, CLEAN_RUNS, `${ran} samples ran clean, expected ${CLEAN_RUNS}: a sample that became a fragment is hidden, or samples were added or removed (update CLEAN_RUNS if so)`);
  assert.ok(new Set(found.filter((sample) => resultOf(sample).kind === 'ok').map((sample) => sample.doc)).size >= 3, 'samples from fewer than three docs ran');
});

// Self-tests of the extractor and the runner, on invented text.

test('extractSamples reads js fences, indented ones too, with their heading, and ignores other languages', () => {
  const text = [
    '# Top', '', '## Colour', '```js', 'const a = 1;', '```', '',
    '- a list item', '', '  ```js', '  const b = 2;', '    nested();', '  ```', '',
    '```shell', '# not a heading', 'ls', '```', '', '### Later', '```', 'plain', '```', '```javascript', 'c();', '```',
  ].join('\n');
  const got = extractSamples(text);
  assert.deepEqual(got.map((sample) => [sample.line, sample.heading, sample.source]), [
    [4, 'Colour', 'const a = 1;'],
    [10, 'Colour', 'const b = 2;\n  nested();'],
    [24, 'Later', 'c();'],
  ]);
});

test('a sample that runs clean is ok, and artifex/core, artifex/styles and <library root> resolve to the repository', () => {
  const ok = runSample([
    "const { clamp01 } = require('artifex/core/num.js');",
    "const { loadExternal } = require('<library root>/tools/piece-input.js');",
    "const styles = require('artifex/styles/builtin.json');",
    "if (clamp01(2) !== 1 || typeof loadExternal !== 'function' || !styles) throw new Error('wrong module');",
  ].join('\n'));
  assert.equal(ok.kind, 'ok', ok.message);
});

test('a broken sample fails: it calls a core function that does not exist', () => {
  const result = runSample("const { nothingHere } = require('artifex/core/num.js');\nnothingHere(1);");
  assert.equal(result.kind, 'threw');
  assert.match(result.message, /nothingHere is not a function/);
  assert.ok(!isFragment(result));
});

test('a broken sample fails: it requires a core module that does not exist', () => {
  const result = runSample("require('artifex/core/no-such-module.js');");
  assert.equal(result.kind, 'threw');
});

test('a sample that throws on purpose, even a ReferenceError-like Error, is broken, not a fragment', () => {
  assert.equal(runSample("throw new Error('x is not defined');").kind, 'threw');
  assert.equal(runSample('const t = 1; t = 2;').kind, 'threw');
});

test('an undeclared name thrown from inside a required module is broken, not a fragment', () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'skill-samples-'));
  try {
    fs.writeFileSync(path.join(dir, 'inner.js'), 'module.exports = () => missingHelper;');
    const result = runSample(`require(${JSON.stringify(path.join(dir, 'inner.js'))})();`);
    assert.equal(result.kind, 'threw');
    assert.match(result.message, /missingHelper is not defined/);
    assert.ok(!isFragment(result));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a fragment that uses a name it never declares is skipped', () => {
  const result = runSample("const { lerp } = require('artifex/core/num.js');\nconst y = lerp(400, 120, clock.seconds);");
  assert.equal(result.kind, 'undeclared');
  assert.ok(isFragment(result));
});

test('a fragment that is not a program is skipped', () => {
  for (const source of ['{ name: "x", size: { w, h }, draw(surface, state, t, clock), }', 'draw(g, s, t, clock) {\n  g.fill();\n}']) {
    const result = runSample(source);
    assert.equal(result.kind, 'syntax', source);
    assert.ok(isFragment(result));
  }
});

test('a known failure must throw its own error: a different throw fails the check', () => {
  const entry = { why: 'invented', message: /^Error: Cannot find module '[^']*placeholder\.cjs'/ };
  const own = runSample("require('./placeholder.cjs');");
  assert.equal(own.kind, 'threw');
  assert.equal(knownFailureProblem(entry, own), '');
  const other = runSample("require('artifex/core/no-such-module.js');");
  assert.equal(other.kind, 'threw');
  assert.match(knownFailureProblem(entry, other), /now throws something else/);
  assert.match(knownFailureProblem(entry, runSample('1;')), /no longer fails/);
});

test('a sample that never ends fails fast instead of hanging the run', () => {
  const started = Date.now();
  const result = runSample('for (;;) {}', 800);
  assert.equal(result.kind, 'timeout');
  assert.ok(!isFragment(result));
  assert.ok(Date.now() - started < 10000);
});

test('a sample that ends the process or prints is judged by its own result line', () => {
  assert.equal(runSample("console.log('hello');").kind, 'ok');
  assert.equal(runSample('process.exit(3);').kind, 'crashed');
});
