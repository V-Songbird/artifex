'use strict';

// Every host loads SKILL.md, and each has limits. Antigravity reads only the
// first 24,000 bytes of the body, so anything past that is never seen; the
// Agent Skills format caps the frontmatter fields. Long guidance belongs in the
// reference files the body routes to.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BODY_BYTES = 24000;
const DESCRIPTION_CHARS = 1024;
const COMPATIBILITY_CHARS = 500;

/** The frontmatter's top-level `key: value` pairs and the body after it. */
function parse(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!m) return null;
  const fields = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (kv) fields[kv[1]] = kv[2].replace(/^"(.*)"$/, '$1');
  }
  return { fields, body: text.slice(m[0].length) };
}

/** What breaks a host's limit in one SKILL.md, given the folder that holds it. */
function problems(folder, text) {
  const skill = parse(text);
  if (!skill) return ['no frontmatter'];
  const { fields, body } = skill;
  const out = [];
  if (fields.name !== folder) out.push(`name "${fields.name}" is not its folder "${folder}"`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fields.name || '') || fields.name.length > 64) out.push('name is not 1 to 64 lower-case letters, digits and single hyphens');
  const description = fields.description || '';
  if (!description) out.push('no description');
  if (description.length > DESCRIPTION_CHARS) out.push(`description is ${description.length} characters, over ${DESCRIPTION_CHARS}`);
  const compatibility = fields.compatibility || '';
  if (compatibility.length > COMPATIBILITY_CHARS) out.push(`compatibility is ${compatibility.length} characters, over ${COMPATIBILITY_CHARS}`);
  const bytes = Buffer.byteLength(body);
  if (bytes >= BODY_BYTES) out.push(`body is ${bytes} bytes, not under ${BODY_BYTES}`);
  return out;
}

const folders = fs.readdirSync(path.join(ROOT, 'skills'), { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.existsSync(path.join(ROOT, 'skills', e.name, 'SKILL.md')))
  .map((e) => e.name);

test('there are skills to check', () => {
  assert.ok(folders.includes('artifex'), 'skills/artifex/SKILL.md not found');
});

for (const folder of folders) {
  test(`skills/${folder}/SKILL.md fits every host's limits`, () => {
    assert.deepStrictEqual(problems(folder, fs.readFileSync(path.join(ROOT, 'skills', folder, 'SKILL.md'), 'utf8')), []);
  });
}

test('each limit is reported when broken', () => {
  const front = (name, extra = '') => `---\nname: ${name}\ndescription: d\n${extra}---\n`;
  assert.deepStrictEqual(problems('a', front('a') + 'x'.repeat(BODY_BYTES - 1)), []);
  assert.deepStrictEqual(problems('a', front('a') + 'x'.repeat(BODY_BYTES)), [`body is ${BODY_BYTES} bytes, not under ${BODY_BYTES}`]);
  assert.deepStrictEqual(problems('a', front('a') + 'é'.repeat(BODY_BYTES / 2)), [`body is ${BODY_BYTES} bytes, not under ${BODY_BYTES}`]);
  assert.deepStrictEqual(problems('b', front('a')), ['name "a" is not its folder "b"']);
  assert.deepStrictEqual(problems('a', `---\nname: a\ndescription: ${'d'.repeat(1025)}\n---\n`), ['description is 1025 characters, over 1024']);
  assert.deepStrictEqual(problems('a', front('a', `compatibility: ${'c'.repeat(501)}\n`)), ['compatibility is 501 characters, over 500']);
  assert.deepStrictEqual(problems('a', 'no frontmatter here'), ['no frontmatter']);
});
