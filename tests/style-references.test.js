'use strict';

// Reference photos beside the built-in styles: each a small WebP with a record
// of where it came from, free to publish, and listed in its style's guide.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const STYLES = path.join(__dirname, '..', 'skills', 'artifex', 'styles');
// The most one photo may weigh: 150 KiB.
const BUDGET = 150 * 1024;
// Photos the owner took, and photos anyone may publish without conditions.
const LICENCES = ['owner', 'CC0-1.0', 'public-domain'];

/** Every broken rule under `styles`/references, one line each; empty when it holds. */
function referenceProblems(styles) {
  const dir = path.join(styles, 'references');
  if (!fs.existsSync(dir)) return [];
  const names = JSON.parse(fs.readFileSync(path.join(styles, 'builtin.json'), 'utf8')).map((s) => s.name);
  const problems = [];
  for (const style of fs.readdirSync(dir)) {
    const folder = path.join(dir, style);
    if (!names.includes(style) || !fs.statSync(folder).isDirectory()) { problems.push(`references/${style} is not a built-in style's folder`); continue; }
    const guide = fs.readFileSync(path.join(styles, `${style}.md`), 'utf8');
    const files = fs.readdirSync(folder);
    for (const file of files) {
      const at = `references/${style}/${file}`, stem = file.replace(/\.(webp|json)$/, '');
      if (stem === file) { problems.push(`${at} is neither a .webp photo nor its .json record`); continue; }
      if (file.endsWith('.json')) {
        if (!files.includes(stem + '.webp')) problems.push(`${at} records no photo`);
        continue;
      }
      const bytes = fs.readFileSync(path.join(folder, file));
      if (bytes.subarray(0, 4).toString('latin1') !== 'RIFF' || bytes.subarray(8, 12).toString('latin1') !== 'WEBP') problems.push(`${at} is not a WebP file`);
      if (bytes.length > BUDGET) problems.push(`${at} weighs ${bytes.length} bytes, over the ${BUDGET}-byte budget`);
      if (!guide.includes(at)) problems.push(`${at} is not listed in ${style}.md`);
      if (!files.includes(stem + '.json')) { problems.push(`${at} has no ${stem}.json record`); continue; }
      const record = JSON.parse(fs.readFileSync(path.join(folder, stem + '.json'), 'utf8'));
      if (!LICENCES.includes(record.licence)) problems.push(`${at}: licence ${JSON.stringify(record.licence)} is not one of ${LICENCES.join(', ')}`);
      if (!(typeof record.author === 'string' && record.author.trim())) problems.push(`${at} records no author`);
      if (record.licence !== 'owner' && !/^https:\/\/\S+$/.test(record.source || '')) problems.push(`${at} records no source page`);
    }
  }
  return problems;
}

test('style references: each photo is a WebP within the budget, freely licensed, recorded and listed in its guide', () => {
  assert.deepEqual(referenceProblems(STYLES), []);
});

test('style references: an oversized, unrecorded or unlisted photo is named', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-references-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'builtin.json'), JSON.stringify([{ name: 'papercraft' }]));
  fs.writeFileSync(path.join(dir, 'papercraft.md'), 'See references/papercraft/big.webp.\n');
  const folder = path.join(dir, 'references', 'papercraft');
  fs.mkdirSync(folder, { recursive: true });
  const webp = (size) => Buffer.concat([Buffer.from('RIFF\0\0\0\0WEBP', 'latin1'), Buffer.alloc(size - 12)]);
  const record = { author: 'someone', source: 'https://example.org/photo', licence: 'CC0-1.0' };
  fs.writeFileSync(path.join(folder, 'big.webp'), webp(BUDGET + 1));
  fs.writeFileSync(path.join(folder, 'big.json'), JSON.stringify(record));
  assert.deepEqual(referenceProblems(dir), [`references/papercraft/big.webp weighs ${BUDGET + 1} bytes, over the ${BUDGET}-byte budget`]);

  fs.writeFileSync(path.join(folder, 'big.webp'), webp(BUDGET));
  assert.deepEqual(referenceProblems(dir), [], 'a photo of exactly the budget passes');

  fs.writeFileSync(path.join(folder, 'big.json'), JSON.stringify({ ...record, licence: 'CC-BY-4.0', source: '' }));
  fs.writeFileSync(path.join(folder, 'other.webp'), webp(100));
  fs.writeFileSync(path.join(folder, 'note.txt'), '');
  fs.mkdirSync(path.join(dir, 'references', 'felt'));
  assert.deepEqual(referenceProblems(dir).sort(), [
    'references/felt is not a built-in style\'s folder',
    'references/papercraft/big.webp records no source page',
    'references/papercraft/big.webp: licence "CC-BY-4.0" is not one of owner, CC0-1.0, public-domain',
    'references/papercraft/note.txt is neither a .webp photo nor its .json record',
    'references/papercraft/other.webp has no other.json record',
    'references/papercraft/other.webp is not listed in papercraft.md',
  ]);
});
