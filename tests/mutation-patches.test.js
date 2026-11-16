'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MUTATIONS, patchProblem, SUITE_TEMP } = require('./negative.js');

const ROOT = path.join(__dirname, '..');

// The mutation runner gives each copy's suite a temporary directory beside the
// copy. There one file is mutated on purpose, so this check would fail by design.
const inRunnerCopy = path.resolve(os.tmpdir()) === path.resolve(ROOT) + SUITE_TEMP;

test('every mutation patch text occurs exactly once in its file', { skip: inRunnerCopy && 'inside a mutation runner copy' }, () => {
  const sources = new Map();
  const read = (file) => {
    if (!sources.has(file)) sources.set(file, fs.existsSync(path.join(ROOT, file)) ? fs.readFileSync(path.join(ROOT, file), 'utf8') : null);
    return sources.get(file);
  };
  const stale = MUTATIONS.flatMap((m) => {
    const src = read(m.file);
    const problem = src === null ? `file ${m.file} does not exist` : patchProblem(src, m);
    return problem ? [`${m.expect}\n  ${problem}`] : [];
  });
  assert.deepEqual(stale, [], `${stale.length} mutation patch text(s) no longer match their file; update tests/negative.js`);
});

// The mutation runner compares a failed title with its expect exactly, so an
// expect left behind by a renamed test only shows when the mutation suite runs.
// Titles are read from the source: a quoted literal, or a template literal whose
// substitutions match any text, which a per-name title in a loop needs.
const TITLE = /\b(?:test|it|describe|suite)\s*\(\s*('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`)/g;
const SUBSTITUTION = /\$\{(?:[^{}]|\{[^{}]*\})*\}/;

function testTitles(dir) {
  const exact = new Set(), patterns = [];
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.test.js'))) {
    for (const [, literal] of fs.readFileSync(path.join(dir, file), 'utf8').matchAll(TITLE)) {
      const quote = literal[0], body = literal.slice(1, -1);
      const parts = quote === '`' ? body.split(SUBSTITUTION) : [body];
      const cooked = parts.map((part) => JSON.parse(`"${part.replace(/\\'|\\`|\\\$|"/g, (c) => (c === '"' ? '\\"' : c[1]))}"`));
      if (cooked.length === 1) exact.add(cooked[0]);
      else patterns.push(new RegExp(`^${cooked.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+')}$`, 's'));
    }
  }
  return (title) => exact.has(title) || patterns.some((pattern) => pattern.test(title));
}

test('every mutation expect names a test in tests/*.test.js', { skip: inRunnerCopy && 'inside a mutation runner copy' }, () => {
  const named = testTitles(path.join(ROOT, 'tests'));
  const missing = [...new Set(MUTATIONS.map((m) => m.expect))].filter((expect) => !named(expect));
  assert.equal(missing.length, 0, `${missing.length} mutation expect(s) name no test; update tests/negative.js:\n  ${missing.join('\n  ')}`);
});
