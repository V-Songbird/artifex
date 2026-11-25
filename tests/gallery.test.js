'use strict';

// The community style gallery (tools/gallery.js): an item is read and refused
// by name, its pack proved, its demo kept to its own files, and a pull request
// held to one new item. The fixture gallery is tests/fixtures/gallery.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const gallery = require('../tools/gallery.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'gallery');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

/** A copy of the fixture gallery in a temporary folder, `change(item)` applied to its item, removed after the test. */
function copy(t, change = () => {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-gallery-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync(FIXTURE, dir, { recursive: true });
  change(path.join(dir, 'dots'));
  return dir;
}

/** Write `text` to the pack file `file` and record its hash in style.json, so the pack still matches itself. */
function repack(item, file, text) {
  const pack = path.join(item, 'dots'), manifest = JSON.parse(fs.readFileSync(path.join(pack, 'style.json'), 'utf8'));
  fs.mkdirSync(path.dirname(path.join(pack, file)), { recursive: true });
  fs.writeFileSync(path.join(pack, file), text);
  manifest.files[file] = sha(Buffer.from(text));
  fs.writeFileSync(path.join(pack, 'style.json'), JSON.stringify(manifest, null, 2));
}

test('gallery: the fixture item reads, its pack proves and its demo loads within its own files', async () => {
  const items = gallery.readGallery(FIXTURE);
  assert.deepEqual(items.map((i) => i.name), ['dots']);
  assert.deepEqual(items[0].files, ['style.json', 'guide.md', 'marks.cjs', 'proof.cjs']);
  await gallery.provePacks(items);
  assert.deepEqual(await gallery.checkGallery(FIXTURE), { items: ['dots'] });
});

test('gallery: an item that breaks a rule is refused by name', async (t) => {
  const refused = async (name, change, pattern) => t.test(name, () => assert.throws(() => gallery.readGallery(copy(t, change)), pattern));
  await refused('a missing card.json', (item) => fs.rmSync(path.join(item, 'card.json')), /gallery: dots has no card\.json/);
  await refused('a missing demo', (item) => fs.rmSync(path.join(item, 'demo.cjs')), /gallery: dots has no demo\.cjs/);
  await refused('a picture in the pack', (item) => fs.writeFileSync(path.join(item, 'dots', 'sample.png'), ''), /holds the picture dots\/sample\.png/);
  await refused('a file beside the pack', (item) => fs.writeFileSync(path.join(item, 'notes.txt'), 'x'), /holds notes\.txt; an item holds only card\.json, demo\.cjs and its pack folder dots\//);
  await refused('a private path in the guide', (item) => repack(item, 'guide.md', fs.readFileSync(path.join(item, 'dots', 'guide.md'), 'utf8') + '\nSee .private/notes.md.\n'), /dots\/dots\/guide\.md names the private path \.private/);
  await refused('a private path in the demo', (item) => fs.appendFileSync(path.join(item, 'demo.cjs'), '\nconst where = "docs/tasks/x.md";\n'), /dots\/demo\.cjs names the private path docs\/tasks/);
  await refused('an address the marks would load', (item) => repack(item, 'marks.cjs', fs.readFileSync(path.join(item, 'dots', 'marks.cjs'), 'utf8') + '\nconst AT = "https://example.com/ink.json";\n'), /dots\/dots\/marks\.cjs has "https:\/\/", which would load something/);
  await refused('a fetch in the demo', (item) => fs.appendFileSync(path.join(item, 'demo.cjs'), '\nif (globalThis.go) fetch("ink");\n'), /dots\/demo\.cjs has "fetch", which would load something/);
  await refused('a dynamic import in the demo', (item) => fs.appendFileSync(path.join(item, 'demo.cjs'), '\nif (globalThis.go) import("./x.js");\n'), /dots\/demo\.cjs has "import\(", which would load something/);
  await refused('a demo requiring a file outside its item', (item) => {
    fs.writeFileSync(path.join(item, '..', 'shared.js'), 'module.exports = {};');
    fs.appendFileSync(path.join(item, 'demo.cjs'), "\nrequire('../shared.js');\n");
  }, /gallery: dots\/demo\.cjs: .*requires \.\.\/shared\.js.*which is not a listed file/);
  await refused('a demo requiring an unlisted file of its own item', (item) => fs.appendFileSync(path.join(item, 'demo.cjs'), "\nrequire('./card.json');\n"), /requires \.\/card\.json.*which is not a listed file/);
  await refused('a pack file changed after packing', (item) => fs.appendFileSync(path.join(item, 'dots', 'marks.cjs'), '\n'), /marks\.cjs differs from its hash in style\.json/);
  await refused('a card that disagrees with its pack', (item) => {
    const card = JSON.parse(fs.readFileSync(path.join(item, 'card.json'), 'utf8'));
    fs.writeFileSync(path.join(item, 'card.json'), JSON.stringify({ ...card, title: 'Spots' }));
  }, /card\.json "title" is "Spots" but the pack's style\.json says "Dots"/);
  await refused('another licence', (item) => {
    const card = JSON.parse(fs.readFileSync(path.join(item, 'card.json'), 'utf8'));
    fs.writeFileSync(path.join(item, 'card.json'), JSON.stringify({ ...card, license: 'GPL-3.0' }));
  }, /must give "license": "MIT", the gallery's licence/);
  await refused('an unknown card key', (item) => {
    const card = JSON.parse(fs.readFileSync(path.join(item, 'card.json'), 'utf8'));
    fs.writeFileSync(path.join(item, 'card.json'), JSON.stringify({ ...card, image: 'x' }));
  }, /unknown key\(s\) image/);
  await t.test('a credit\'s address in a comment is not a load', () => {
    gallery.readGallery(copy(t, (item) => fs.appendFileSync(path.join(item, 'demo.cjs'), '\n// After a drawing at https://example.com/dots.\n')));
  });
});

test('gallery: a pack whose proof fails is refused, naming the mark', async (t) => {
  const dir = copy(t, (item) => repack(item, 'proof.cjs', fs.readFileSync(path.join(item, 'dots', 'proof.cjs'), 'utf8').replace("marks.dot(g, 10, 10, 6, '#223')", "marks.dot(g, 30, 10, 6, '#223')")));
  await assert.rejects(gallery.provePacks(gallery.readGallery(dir)), /gallery: dots: dots: the proof of dot paints at \(\d+(?:\.\d+)?, \d+(?:\.\d+)?\), outside its box \[0, 0, 20, 20\]/);
});

test('gallery: a pull request adds one new item, a folder of its own, and nothing else', async (t) => {
  const dir = copy(t);
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'base');
  const base = git('rev-parse', 'HEAD').trim();
  const commit = (m) => { git('add', '-A'); git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', m); return git('rev-parse', 'HEAD').trim(); };
  const added = commit('add dots');
  assert.equal(gallery.oneNewItem(dir, base), 'dots');
  fs.mkdirSync(path.join(dir, '.github'));
  fs.writeFileSync(path.join(dir, '.github', 'x.yml'), 'x');
  commit('touch the workflows');
  await t.test('a change outside the item', () => assert.throws(() => gallery.oneNewItem(dir, base), /a pull request adds one item, a folder of its own; this one changes \.github, dots|a pull request adds one item, a folder of its own; this one changes dots, \.github/));
  fs.rmSync(path.join(dir, '.github'), { recursive: true });
  commit('drop it');
  fs.appendFileSync(path.join(dir, 'dots', 'demo.cjs'), '\n');
  commit('change dots');
  await t.test('a change to an item already there', () => assert.throws(() => gallery.oneNewItem(dir, added), /gallery: dots is already in the gallery/));
});
