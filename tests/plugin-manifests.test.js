'use strict';

// One plugin, several manifests: each host reads its own file, and Claude Code
// pins users to the manifest's version, so a release that bumps one copy and
// forgets another never reaches them. Name, version and description must agree
// everywhere they are stated.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const exists = (file) => fs.existsSync(path.join(ROOT, file));

/** Every place a field is stated, as `[where, value]` rows. */
function stated(root = ROOT) {
  const json = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  const has = (file) => fs.existsSync(path.join(root, file));
  const rows = { name: [], version: [], description: [] };
  const take = (where, object, fields) => {
    for (const field of fields) if (object[field] !== undefined) rows[field].push([where, object[field]]);
  };
  for (const file of ['plugin.json', '.claude-plugin/plugin.json', '.codex-plugin/plugin.json', 'package.json']) {
    if (has(file)) take(file, json(file), ['name', 'version', 'description']);
  }
  for (const file of ['.claude-plugin/marketplace.json', '.agents/plugins/marketplace.json']) {
    const catalog = json(file);
    take(file, catalog, ['name', 'description']);
    catalog.plugins.forEach((plugin, i) => take(`${file} plugins[${i}]`, plugin, ['name', 'version', 'description']));
  }
  for (const entry of fs.readdirSync(path.join(root, 'skills'), { withFileTypes: true })) {
    const file = path.join(root, 'skills', entry.name, 'SKILL.md');
    if (!entry.isDirectory() || !fs.existsSync(file)) continue;
    const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(fs.readFileSync(file, 'utf8'));
    const version = front && /^metadata:\r?\n(?:[ \t]+.*\r?\n)*?[ \t]+version:\s*"?([^"\r\n]+)"?/m.exec(front[1] + '\n');
    rows.version.push([`skills/${entry.name}/SKILL.md metadata.version`, version ? version[1] : undefined]);
  }
  return rows;
}

/** Each field whose stated values differ, as one line naming every place and its value. */
function disagreements(rows) {
  return Object.entries(rows)
    .filter(([, list]) => new Set(list.map(([, value]) => value)).size > 1)
    .map(([field, list]) => `${field}: ` + list.map(([where, value]) => `${where} = ${JSON.stringify(value)}`).join('; '));
}

test('name, version and description agree across every manifest, catalog, package.json and skill', () => {
  const rows = stated();
  assert.ok(rows.name.length >= 5, 'fewer than 5 places state the name: ' + rows.name.map(([where]) => where).join(', '));
  assert.ok(rows.version.length >= 5, 'fewer than 5 places state the version: ' + rows.version.map(([where]) => where).join(', '));
  assert.ok(rows.description.length >= 4, 'fewer than 4 places state the description: ' + rows.description.map(([where]) => where).join(', '));
  assert.deepStrictEqual(disagreements(rows), []);
});

test('a differing value is reported with every place that states the field', () => {
  assert.deepStrictEqual(disagreements({ version: [['a', '0.1.0'], ['b', '0.1.0']], name: [['a', 'x']] }), []);
  assert.deepStrictEqual(disagreements({ version: [['a', '0.1.0'], ['b', '0.2.0'], ['c', undefined]] }), ['version: a = "0.1.0"; b = "0.2.0"; c = undefined']);
});

test('the root manifest is Agent Plugins 1.0 with only the fields its closed schema allows', () => {
  const manifest = read('plugin.json');
  assert.strictEqual(manifest.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  const allowed = ['$schema', 'name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'extensions'];
  assert.deepStrictEqual(Object.keys(manifest).filter((key) => !allowed.includes(key)), []);
  assert.match(manifest.name, /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/);
});

test('the icon is a square PNG every host takes, where each host looks for it', () => {
  // Claude Code finds assets/icon.png by its path and takes a square PNG of 512 to 2048 px under 2 MB; Codex reads the paths in its interface block.
  const png = fs.readFileSync(path.join(ROOT, 'assets', 'icon.png'));
  assert.strictEqual(png.subarray(1, 4).toString('latin1'), 'PNG');
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
  assert.strictEqual(w, h, `the icon is ${w} by ${h}, not square`);
  assert.ok(w >= 512 && w <= 2048, `the icon is ${w} px a side, outside 512 to 2048`);
  assert.ok(png.length < 2 * 1024 * 1024, `the icon is ${png.length} bytes, not under 2 MB`);
  const face = read('plugin.json').extensions['com.openai'].interface;
  for (const key of ['logo', 'composerIcon']) assert.ok(exists(face[key]), `interface.${key} names ${face[key]}, which is not in the plugin`);
  assert.ok(exists('assets/icon.cjs') && exists('assets/icon.svg'), 'the icon keeps its piece and its SVG beside it');
});

test('Codex presentation lives in the root manifest, so no second Codex manifest can drift from it', () => {
  assert.strictEqual(read('plugin.json').extensions['com.openai'].interface.displayName, 'Artifex');
  assert.strictEqual(exists('.codex-plugin/plugin.json'), false, '.codex-plugin/plugin.json is back: Codex reads it only when extensions.com.openai is absent');
  assert.strictEqual(exists('gemini-extension.json'), false, 'no Gemini manifest: that host is out of scope');
});
