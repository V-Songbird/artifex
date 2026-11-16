'use strict';

// The export comments under "What the library gives you" in skills/artifex/SKILL.md
// must name exactly what each core module exports, so a helper added to a module
// cannot go unlisted there, nor a removed one stay listed. Every core module must
// be either listed there or named in the paragraph on the modules left out.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const skill = fs.readFileSync(path.join(root, 'skills/artifex/SKILL.md'), 'utf8');
const coreFiles = fs.readdirSync(path.join(root, 'core')).filter((f) => f.endsWith('.js'));

// A SKILL.md sample line such as `require('artifex/core/<module>.js')`; the
// render.js line spells its prefix `<library root>/`.
const REQUIRE_LINE = /^require\('(?:artifex|<library root>)\/core\/([\w-]+)\.js'\)\s*(.*)$/;

// Maps each module to the comment text after its require line, joined across
// the `//` lines that follow it.
function comments(text) {
  const out = {};
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const head = REQUIRE_LINE.exec(line);
    let note = null;
    if (head) {
      current = head[1];
      out[current] = '';
      note = /^\/\/\s?(.*)$/.exec(head[2]);
    } else if (current) {
      note = /^\s*\/\/\s?(.*)$/.exec(line);
      if (!note) current = null;
    }
    if (current && note) out[current] += ' ' + note[1];
  }
  return out;
}

// Maps each module to the names its comment lists, leaving out parentheses,
// which may run across lines, and `-> result` notes.
function listed(text) {
  const out = {};
  for (const [mod, note] of Object.entries(comments(text))) {
    const prose = note.replace(/\([^)]*\)/g, '').replace(/->\s*\w+/g, '');
    // Any item left that is not a bare name, such as `wobbleTo seconds`, is
    // kept whole, so it can match no export and is reported.
    out[mod] = prose.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return out;
}

function diff(modules) {
  const problems = [];
  for (const [mod, names] of Object.entries(modules)) {
    const actual = Object.keys(require(path.join(root, 'core', mod + '.js')));
    const missing = actual.filter((n) => !names.includes(n));
    const extra = names.filter((n) => !actual.includes(n));
    if (missing.length || extra.length) {
      problems.push(`core/${mod}.js: missing from SKILL.md [${missing}], not exported [${extra}]`);
    }
  }
  return problems;
}

// The `x.js` names in the paragraph that begins "The other core modules".
function leftOut(text) {
  const para = /^The other core modules[\s\S]*?(?:\r?\n\s*\r?\n|(?![\s\S]))/m.exec(text);
  return para ? [...para[0].matchAll(/`([\w-]+\.js)`/g)].map((m) => m[1]) : [];
}

// Each core file neither listed nor left out, and each name either place gives
// that is not a core file.
function coverage(text, files) {
  const named = [...Object.keys(listed(text)).map((m) => m + '.js'), ...leftOut(text)];
  return {
    unnamed: files.filter((f) => !named.includes(f)).sort(),
    unknown: named.filter((f) => !files.includes(f)).sort(),
  };
}

// The names the render.js comment says come from piece.js.
function pieceNames(text) {
  const m = /piece\.js's (\w+(?:(?:, | and )\w+)*)/.exec(comments(text).render || '');
  return m ? m[1].split(/, | and /) : [];
}

test('the parser finds the listed modules, so an empty parse cannot pass', () => {
  assert.ok(Object.keys(listed(skill)).length >= 12, 'fewer than 12 require lines parsed');
});

test('SKILL.md export comments match each core module', () => {
  assert.deepStrictEqual(diff(listed(skill)), []);
});

test('every core module is listed or named as left out in SKILL.md', () => {
  assert.deepStrictEqual(coverage(skill, coreFiles), { unnamed: [], unknown: [] });
});

test('the render.js comment names validate and solve, which piece.js exports', () => {
  const names = pieceNames(skill);
  assert.deepStrictEqual(names, ['validate', 'solve']);
  const exported = Object.keys(require(path.join(root, 'core/piece.js')));
  assert.deepStrictEqual(names.filter((n) => !exported.includes(n)), []);
});

test('a core module neither listed nor left out is reported', () => {
  assert.deepStrictEqual(coverage(skill, [...coreFiles, 'extra.js']), {
    unnamed: ['extra.js'],
    unknown: [],
  });
});

test('a left-out name that is not a core module is reported', () => {
  const mutated = skill.replace('`flash.js` counts', '`flashes.js` counts');
  assert.notStrictEqual(mutated, skill);
  assert.deepStrictEqual(coverage(mutated, coreFiles), {
    unnamed: ['flash.js'],
    unknown: ['flashes.js'],
  });
});

test('a name dropped from a comment is reported', () => {
  const mutated = skill.replace('chaikin, catmullRom,', 'catmullRom,');
  assert.notStrictEqual(mutated, skill);
  assert.deepStrictEqual(diff(listed(mutated)), [
    'core/geom.js: missing from SKILL.md [chaikin], not exported []',
  ]);
});

test('an item that is not a bare name is reported', () => {
  const mutated = skill.replace('spring, follow', 'spring, follow, wobbleTo seconds');
  assert.notStrictEqual(mutated, skill);
  assert.deepStrictEqual(diff(listed(mutated)), [
    'core/time.js: missing from SKILL.md [], not exported [wobbleTo seconds]',
  ]);
});
