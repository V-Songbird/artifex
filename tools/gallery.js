#!/usr/bin/env node
'use strict';

// The community style gallery: a folder holding one folder per style pack, as
// the gallery branch keeps them. `readGallery` reads and checks a gallery
// without running a pack's proof. `npm run gallery -- <dir>` is the check a
// pull request to the gallery branch must pass: every item read, its pack
// trusted and proved as `npm run styles -- check` proves one, and its demo
// loaded within its own files. See docs/apis/style-packs.md#the-gallery.
//
// An item, `<gallery>/<name>/`:
//   card.json   name, title, summary, author and license
//   demo.cjs    the gallery's bird (tools/gallery-subject.js) drawn with the pack's marks
//   <name>/     the pack, as npm run styles -- pack installs it

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { loadExternal } = require('./piece-input.js');
const styles = require('./styles.js');

const ROOT = path.resolve(__dirname, '..');
// A community pack's licence: MIT, whatever licence the engine itself carries.
const LICENSE = 'MIT';
const USAGE = 'usage: npm run gallery -- <gallery folder> [--base <git revision>]';
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CARD_KEYS = ['name', 'title', 'summary', 'author', 'license'];
// What a demo may require besides its own files and artifex/core: the gallery's bird and the style library's shared helpers.
const ALIASES = {
  'artifex/site/subject.js': path.join(ROOT, 'tools', 'gallery-subject.js'),
  'artifex/styles/kit.js': path.join(ROOT, 'skills', 'artifex', 'styles', 'kit.js'),
};
// A picture in any form: the card is drawn by the pack's marks, never shown from a file.
const PICTURE = /\.(?:png|jpe?g|gif|webp|avif|bmp|ico|tiff?|svg|heic)$/i;
// A private working record named anywhere in a file's text.
const PRIVATE = /(?:^|[^\w-])(\.private|docs[\\/](?:tasks|decisions|knowledge[\\/]private|apis[\\/]private))(?=[\\/\s'"`)\]]|$)/im;
// Code or data that would load something: an address with a scheme or a protocol-relative one, or a loading API.
const LOADS = /\b[a-z][a-z0-9+.-]*:\/\/|['"`]\/\/[^/\s'"`]|\b(?:fetch|importScripts|XMLHttpRequest|WebSocket|EventSource|sendBeacon|Worker|SharedWorker)\b|\bimport\s*\(/i;

/** Every file under `folder`, relative with forward slashes, refusing a link. */
function filesOf(folder, item) {
  const out = [];
  (function walk(relative) {
    for (const entry of fs.readdirSync(path.join(folder, relative), { withFileTypes: true })) {
      const file = relative ? relative + '/' + entry.name : entry.name;
      if (entry.isSymbolicLink()) throw new Error('gallery: ' + item + ': ' + file + ' is a link; an item holds only its own files');
      if (entry.isDirectory()) walk(file); else out.push(file);
    }
  })('');
  return out;
}

/** One item's card.json, refused by name when it breaks a rule or disagrees with its pack. */
function readCard(text, name, manifest) {
  const bad = (why) => { throw new Error('gallery: ' + name + '/card.json ' + why); };
  let card;
  try { card = JSON.parse(text); } catch (error) { bad('is not valid JSON: ' + error.message); }
  if (!card || typeof card !== 'object' || Array.isArray(card)) bad('must be a JSON object');
  const unknown = Object.keys(card).filter((k) => !CARD_KEYS.includes(k));
  if (unknown.length) bad('has unknown key(s) ' + unknown.join(', ') + '; known: ' + CARD_KEYS.join(', '));
  for (const key of CARD_KEYS) if (typeof card[key] !== 'string' || !card[key].trim() || /[\x00-\x1f]/.test(card[key])) bad('needs "' + key + '", a nonempty line of text');
  if (card.name !== name) bad('names "' + card.name + '" but the folder is "' + name + '"');
  for (const key of ['title', 'summary']) if (card[key] !== manifest[key]) bad('"' + key + '" is "' + card[key] + '" but the pack\'s style.json says "' + manifest[key] + '"');
  if (card.license !== LICENSE || manifest.license !== LICENSE) bad('and style.json must give "license": "' + LICENSE + '", the gallery\'s licence, got ' + JSON.stringify(card.license) + ' and ' + JSON.stringify(manifest.license));
  return card;
}

/** The demo loaded within its item's own files, artifex/core and ALIASES: its piece, or a refusal naming the require. */
function loadDemo(item) {
  const files = ['demo.cjs', ...Object.keys(item.manifest.files).map((f) => item.name + '/' + f)];
  try { return loadExternal(path.join(item.folder, 'demo.cjs'), item.folder, { confine: { root: item.folder, files }, aliases: ALIASES }).piece; }
  catch (error) { throw new Error('gallery: ' + item.name + '/demo.cjs: ' + error.message.replace(/^piece: /, ''), { cause: error }); }
}

/**
 * The items of the gallery at `dir`, in name order, each checked without
 * running its pack's proof. A folder whose name starts with a dot, such as
 * `.github`, and the files beside the items are not items.
 */
function readGallery(dir) {
  const root = path.resolve(dir);
  if (!fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) throw new Error('gallery: ' + root + ' is not a folder');
  const builtin = new Set(styles.builtins().map((s) => s.name));
  return fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort().map((name) => {
    const folder = path.join(root, name);
    if (!NAME.test(name) || name.length > 40) throw new Error('gallery: ' + name + ' is not a pack name: lowercase kebab-case, at most 40 characters');
    if (builtin.has(name)) throw new Error('gallery: ' + name + ' is a built-in style\'s name; pick another name for the pack');
    const all = filesOf(folder, name);
    const extra = all.filter((f) => f !== 'card.json' && f !== 'demo.cjs' && !f.startsWith(name + '/'));
    if (extra.length) throw new Error('gallery: ' + name + ' holds ' + extra.join(', ') + '; an item holds only card.json, demo.cjs and its pack folder ' + name + '/');
    for (const need of ['card.json', 'demo.cjs', name + '/style.json']) if (!all.includes(need)) throw new Error('gallery: ' + name + ' has no ' + need);
    const picture = all.find((f) => PICTURE.test(f));
    if (picture) throw new Error('gallery: ' + name + ' holds the picture ' + picture + '; the card is drawn by the pack\'s own marks, so an item holds no picture');
    for (const file of all) {
      const text = fs.readFileSync(path.join(folder, file), 'utf8');
      const named = PRIVATE.exec(text);
      if (named) throw new Error('gallery: ' + name + '/' + file + ' names the private path ' + named[1] + '; nothing in the gallery may name a private working record');
      // Comments aside, so a credit's address in one is not a load.
      const load = file !== 'card.json' && /\.(?:c?js|mjs|json)$/i.test(file) && LOADS.exec(text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1'));
      if (load) throw new Error('gallery: ' + name + '/' + file + ' has "' + load[0] + '", which would load something; a pack and its demo draw only from their own files');
    }
    const pack = path.join(folder, name);
    let manifest;
    try { manifest = styles.validateManifest(JSON.parse(fs.readFileSync(path.join(pack, 'style.json'), 'utf8')), name); }
    catch (error) { throw new Error('gallery: ' + name + '/' + name + '/' + error.message, { cause: error }); }
    styles.verify({ name, folder: pack, manifest });
    const card = readCard(fs.readFileSync(path.join(folder, 'card.json'), 'utf8'), name, manifest);
    const item = { name, folder, pack, manifest, card, demo: path.join(folder, 'demo.cjs'), guide: path.join(pack, manifest.guide), files: ['style.json', ...Object.keys(manifest.files)] };
    loadDemo(item);
    return item;
  });
}

/** Refuse a change against `base` that is anything but one new item: a folder of its own, added whole. */
function oneNewItem(dir, base) {
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  const changed = git('diff', '--name-status', '--no-renames', base, 'HEAD').trim().split('\n').filter(Boolean).map((l) => l.split('\t'));
  if (!changed.length) throw new Error('gallery: nothing changed since ' + base);
  const tops = new Set(changed.map(([, file]) => file.split('/')[0]));
  const outside = changed.find(([, file]) => !file.includes('/') || file.startsWith('.'));
  if (outside || tops.size !== 1) throw new Error('gallery: a pull request adds one item, a folder of its own; this one changes ' + [...tops].join(', '));
  const [top] = tops;
  if (git('ls-tree', '--name-only', base, '--', top).trim()) throw new Error('gallery: ' + top + ' is already in the gallery; a pull request adds a new item, and the owner changes existing ones');
  if (changed.some(([status]) => status !== 'A')) throw new Error('gallery: a pull request only adds files; ' + changed.filter(([s]) => s !== 'A').map(([, f]) => f).join(', ') + ' are changed or removed');
  return top;
}

/** Prove each item's pack in a temporary ARTIFEX_HOME, as `npm run styles -- trust` and `check` would on the visitor's machine. */
async function provePacks(items) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-gallery-'));
  try {
    const env = { ...process.env, ARTIFEX_HOME: home };
    for (const item of items) {
      fs.cpSync(item.pack, path.join(home, 'styles', item.name), { recursive: true });
      styles.trust(item.name, env, () => {});
      try { await styles.check(item.name, env, () => {}); }
      catch (error) { throw new Error('gallery: ' + item.name + ': ' + error.message.replace(/^style: /, ''), { cause: error }); }
    }
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
}

/** The whole check of the gallery at `dir`: the one-new-item rule against `options.base`, every item read, every pack proved. */
async function checkGallery(dir, options = {}) {
  if (options.base) oneNewItem(dir, options.base);
  const items = readGallery(dir);
  if (items.length) await provePacks(items);
  return { items: items.map((i) => i.name) };
}

async function main(args = process.argv.slice(2), log = console.log) {
  if (args.includes('--help') || args.includes('-h')) return log(USAGE);
  const refuse = (cause) => new Error('gallery: ' + cause + '\n' + USAGE);
  const options = {};
  let dir;
  for (let i = 0; i < args.length; i++) {
    const value = () => { if (args[i + 1] === undefined) throw refuse(args[i] + ' needs a value'); return args[++i]; };
    if (args[i] === '--base') options.base = value();
    else if (args[i].startsWith('-')) throw refuse('unknown option ' + args[i]);
    else if (dir) throw refuse('one gallery folder, got "' + dir + '" and "' + args[i] + '"');
    else dir = args[i];
  }
  if (!dir) throw refuse('name the gallery folder');
  const result = await checkGallery(dir, options);
  for (const name of result.items) log('gallery: ' + name + ': read and proved');
  log(result.items.length ? 'gallery: ' + result.items.length + ' item(s) pass' : 'gallery: ' + path.resolve(dir) + ' holds no item yet; nothing to check');
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { readGallery, readCard, loadDemo, oneNewItem, provePacks, checkGallery, main, ALIASES, LICENSE };
