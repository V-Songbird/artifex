#!/usr/bin/env node
'use strict';

// The style registry: the built-in styles in skills/artifex/styles/builtin.json
// and the style packs installed under <ARTIFEX_HOME>/styles, listed and named
// together. Listing and resolving read JSON only; no pack code runs. `trust`
// records the hash of a pack's style.json, which hashes every file it may load,
// and `check` refuses a pack that differs from what was trusted before it runs
// any of the pack's code. See docs/apis/style-packs.md.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { VERSION } = require('../core/piece.js');
const { callerDirectory, imports, loadExternal } = require('./piece-input.js');
const { manifestOf } = require('./replay.js');

const STYLES = path.resolve(__dirname, '..', 'skills', 'artifex', 'styles');
const KEYS = ['stylePack', 'name', 'title', 'version', 'artifex', 'summary', 'author', 'license', 'piece', 'guide', 'sample', 'files'];
const OPTIONAL = new Set(['author', 'license']);
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LOADABLE = /\.(?:c?js|mjs|json)$/i;
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

/** `ARTIFEX_HOME`, relative to the caller's directory, or ~/.artifex. */
function home(env = process.env) {
  return env.ARTIFEX_HOME ? path.resolve(callerDirectory(process.cwd(), env), env.ARTIFEX_HOME) : path.join(os.homedir(), '.artifex');
}

function builtins() {
  return JSON.parse(fs.readFileSync(path.join(STYLES, 'builtin.json'), 'utf8')).map((style) => ({
    name: style.name, title: style.title, summary: style.summary, source: 'builtin',
    guide: path.join(STYLES, style.guide), piece: path.join(STYLES, style.module),
  }));
}

/** Why a path in `files` cannot name a file inside the pack on every system, or null. */
function pathProblem(file) {
  if (!file) return 'is empty';
  if (file.includes('\\')) return 'uses a backslash; use forward slashes';
  if (file.startsWith('/') || /^[a-z]:/i.test(file)) return 'is absolute';
  if (/[\x00-\x1f:*?"<>|]/.test(file)) return 'holds a character a file name cannot hold on every system';
  const parts = file.split('/');
  if (parts.includes('..')) return 'leaves the pack with ".."';
  if (parts.some((part) => part === '' || part === '.')) return 'has an empty or "." segment';
  if (parts.some((part) => /[. ]$/.test(part))) return 'ends a name with a dot or a space, which Windows drops';
  if (file.toLowerCase() === 'style.json') return 'is the manifest itself';
  return null;
}

/** A pack's style.json, refused by name when it breaks a rule of the format. */
function validateManifest(m, folder) {
  const bad = (why) => { throw new Error('style.json: ' + why); };
  if (!m || typeof m !== 'object' || Array.isArray(m)) bad('must be a JSON object');
  for (const key of Object.keys(m)) if (!KEYS.includes(key)) bad('unknown key "' + key + '"');
  for (const key of KEYS) if (!OPTIONAL.has(key) && !Object.hasOwn(m, key)) bad('missing key "' + key + '"');
  if (m.stylePack !== 1) bad('"stylePack" must be 1, the format this library reads');
  if (typeof m.name !== 'string' || !NAME.test(m.name) || m.name.length > 40) bad('"name" must be lowercase kebab-case, at most 40 characters');
  if (m.name !== folder) bad('"name" is "' + m.name + '" but the folder is "' + folder + '"');
  for (const key of ['title', 'version', 'artifex', 'summary', 'author', 'license']) {
    if (Object.hasOwn(m, key) && (typeof m[key] !== 'string' || !m[key].trim() || /[\x00-\x1f]/.test(m[key]))) bad('"' + key + '" must be a nonempty line of text');
  }
  if (!m.files || typeof m.files !== 'object' || Array.isArray(m.files)) bad('"files" must map each file to its SHA-256');
  for (const [file, hash] of Object.entries(m.files)) {
    const why = pathProblem(file);
    if (why) bad('files: "' + file + '" ' + why);
    if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) bad('files: "' + file + '" needs its SHA-256 in lowercase hex');
  }
  for (const [key, pattern, kind] of [['piece', /\.c?js$/, '.cjs or .js'], ['guide', /\.md$/, '.md'], ['sample', /\.(?:svg|png)$/, '.svg or .png']]) {
    if (typeof m[key] !== 'string' || !pattern.test(m[key])) bad('"' + key + '" must name a ' + kind + ' file');
    if (!Object.hasOwn(m.files, m[key])) bad('"' + key + '" names ' + m[key] + ', which "files" does not list');
  }
  return m;
}

function trustFile(env) { return path.join(home(env), 'trust.json'); }

function readTrust(env) {
  let text;
  try { text = fs.readFileSync(trustFile(env), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return { packs: {} }; throw error; }
  let record;
  try { record = JSON.parse(text); }
  catch (error) { throw new Error('styles: ' + trustFile(env) + ' is not valid JSON: ' + error.message, { cause: error }); }
  if (!record || typeof record.packs !== 'object' || !record.packs || Array.isArray(record.packs)) throw new Error('styles: ' + trustFile(env) + ' needs a "packs" object');
  return record;
}

/**
 * Every installed pack, from its style.json alone, and every folder that is
 * not one: `broken` with the reason, or `refused` for a built-in style's name.
 */
function scan(env = process.env) {
  const dir = path.join(home(env), 'styles');
  const trusted = readTrust(env).packs;
  const reserved = new Set(builtins().map((style) => style.name));
  const packs = [], problems = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const folder = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) { problems.push({ name: entry.name, folder, status: 'broken', reason: 'the folder is a link; install the pack itself' }); continue; }
    if (!entry.isDirectory()) continue;
    let bytes, m;
    try {
      bytes = fs.readFileSync(path.join(folder, 'style.json'));
      let data;
      try { data = JSON.parse(bytes.toString('utf8').replace(/^﻿/, '')); }
      catch (error) { throw new Error('style.json: not valid JSON: ' + error.message); }
      m = validateManifest(data, entry.name);
    }
    catch (error) {
      problems.push({ name: entry.name, folder, status: 'broken', reason: error.code === 'ENOENT' ? 'no style.json' : error.message });
      continue;
    }
    if (reserved.has(m.name)) {
      problems.push({ name: m.name, folder, status: 'refused', reason: '"' + m.name + '" is a built-in style\'s name, so the built-in style is used' });
      continue;
    }
    const hash = sha256(bytes);
    packs.push({
      name: m.name, title: m.title, summary: m.summary, source: 'installed',
      guide: path.join(folder, m.guide), piece: path.join(folder, m.piece), sample: path.join(folder, m.sample),
      version: m.version, artifex: m.artifex, proved: m.artifex === VERSION,
      trusted: trusted[m.name]?.sha256 === hash, author: m.author, license: m.license, folder, manifest: m, hash,
    });
  }
  return { dir, packs, problems };
}

/** The style a name means, lowercased and matched exactly; refused with every available name otherwise. */
function resolve(name, env = process.env) {
  const wanted = String(name).toLowerCase();
  const builtin = builtins();
  const { dir, packs, problems } = scan(env);
  const found = builtin.find((style) => style.name === wanted) || packs.find((style) => style.name === wanted);
  if (found) return found;
  const problem = problems.find((one) => one.name === wanted);
  if (problem) throw new Error('style: the pack in ' + problem.folder + ' is ' + problem.status + ': ' + problem.reason);
  throw new Error('style: no style named "' + name + '". Available: ' + builtin.map((s) => s.name).sort().join(', ') + ' (built in); '
    + (packs.length ? packs.map((s) => s.name).join(', ') + ' (installed)' : 'none installed') + '. Packs are installed in ' + dir + '.');
}

/**
 * A pack's folder holds exactly what its style.json lists: no links, no
 * unlisted file that could be loaded, every listed file present with its hash,
 * and a sample made by the Artifex version style.json names.
 */
function verify(pack) {
  const { folder, manifest: m } = pack;
  const found = new Set();
  (function walk(relative) {
    for (const entry of fs.readdirSync(path.join(folder, relative), { withFileTypes: true })) {
      const file = relative ? relative + '/' + entry.name : entry.name;
      if (entry.isSymbolicLink()) throw new Error('style: ' + pack.name + ': ' + file + ' is a link; a pack holds only its own files');
      if (entry.isDirectory()) { walk(file); continue; }
      found.add(file);
      if (file !== 'style.json' && LOADABLE.test(file) && !Object.hasOwn(m.files, file)) {
        throw new Error('style: ' + pack.name + ': ' + file + ' is not listed in style.json, and only listed files may be loaded');
      }
    }
  })('');
  for (const [file, hash] of Object.entries(m.files)) {
    if (!found.has(file)) throw new Error('style: ' + pack.name + ': ' + file + ' is listed in style.json but missing');
    if (sha256(fs.readFileSync(path.join(folder, file))) !== hash) throw new Error('style: ' + pack.name + ': ' + file + ' differs from its hash in style.json');
  }
  const { manifest } = manifestOf(fs.readFileSync(pack.sample), m.sample);
  if (manifest.artifex !== m.artifex) {
    throw new Error('style: ' + pack.name + ': ' + m.sample + ' was drawn by Artifex ' + manifest.artifex + ', but style.json says ' + m.artifex);
  }
}

const trustCommand = (name) => 'npm run styles -- trust ' + name;

/** Show what a pack holds and requires, without running it, then record its style.json's hash. */
function trust(name, env = process.env, log = console.log) {
  const style = resolve(name, env);
  if (style.source === 'builtin') throw new Error('style: "' + style.name + '" is built in; built-in styles ship with the library and need no trust');
  verify(style);
  const m = style.manifest;
  log('Pack ' + style.name + ' ' + m.version + ' in ' + style.folder);
  log('  author: ' + (m.author || 'not given') + '; license: ' + (m.license || 'not given') + '; proved with Artifex ' + m.artifex
    + (style.proved ? '' : ', not ' + VERSION + ', so its sample is not proved here'));
  for (const [file, hash] of Object.entries(m.files)) {
    const full = path.join(style.folder, file);
    log('  ' + file + '  ' + fs.statSync(full).size + ' bytes  sha256 ' + hash);
    if (/\.c?js$/i.test(file)) {
      const specs = imports(fs.readFileSync(full, 'utf8'), full).map((dependency) => dependency.spec);
      log('    requires: ' + (specs.length ? specs.join(', ') : 'nothing'));
    }
  }
  const record = readTrust(env);
  record.packs[style.name] = { version: m.version, sha256: style.hash };
  fs.mkdirSync(home(env), { recursive: true });
  const temporary = trustFile(env) + '.' + process.pid + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(record, null, 2) + '\n');
  fs.renameSync(temporary, trustFile(env));
  log('Trusted ' + style.name + ' ' + m.version + ' (style.json sha256 ' + style.hash + ') in ' + trustFile(env) + '.');
}

/**
 * A built-in style's module must load as a piece of its name. A pack must
 * match its hashes, be trusted as it is, be proved on this version, and load
 * confined to its listed files. The sample is not replayed.
 */
function check(name, env = process.env, log = console.log) {
  const style = resolve(name, env);
  if (style.source === 'builtin') {
    const { piece } = loadExternal(style.piece, STYLES);
    if (piece.name !== style.name) throw new Error('style: ' + style.piece + ' is named ' + piece.name + ', not ' + style.name);
    if (!fs.existsSync(style.guide)) throw new Error('style: ' + style.name + ' has no guide at ' + style.guide);
    log('check ' + style.name + ': built in; its module loads as the piece ' + piece.name + ' and its guide is present');
    return;
  }
  verify(style);
  if (!style.trusted) {
    const before = readTrust(env).packs[style.name];
    throw new Error('style: ' + style.name + (before ? ' changed since it was trusted as version ' + before.version : ' is not trusted')
      + '. Read its files, then run: ' + trustCommand(style.name));
  }
  if (!style.proved) throw new Error('style: ' + style.name + ' is not proved on this version: its sample was proved with Artifex ' + style.artifex + ', this is ' + VERSION);
  const files = Object.keys(style.manifest.files);
  loadExternal(style.piece, style.folder, { confine: { root: style.folder, files } });
  log('check ' + style.name + ': ' + files.length + ' files match style.json, trusted, proved with ' + style.artifex
    + ', and its piece loads within its own files; the sample was not replayed');
}

function list(env = process.env, json = false, log = console.log) {
  const { dir, packs, problems } = scan(env);
  const styles = [...builtins(), ...packs.map(({ manifest, hash, ...pack }) => pack)];
  if (json) { log(JSON.stringify({ home: home(env), packs: dir, styles, problems }, null, 2)); return; }
  const width = Math.max(...styles.map((s) => s.name.length), ...problems.map((p) => p.name.length));
  for (const s of styles) {
    const where = s.source === 'builtin' ? 'built in' : 'installed ' + s.version + ', proved with ' + s.artifex + ', ' + (s.trusted ? 'trusted' : 'not trusted');
    log(s.name.padEnd(width) + '  ' + where + '  ' + s.title + ': ' + s.summary);
  }
  for (const p of problems) log(p.name.padEnd(width) + '  ' + p.status + ': ' + p.reason + ' (' + p.folder + ')');
  log('Packs are installed in ' + dir + '.');
}

const USAGE = 'styles: usage: npm run styles [-- list] [-- --json] | npm run styles -- check <name> | npm run styles -- trust <name>';

function main(args = process.argv.slice(2), env = process.env, log = console.log) {
  const json = args.includes('--json');
  const rest = args.filter((arg) => arg !== '--json');
  if (rest.some((arg) => arg.startsWith('-'))) throw new Error(USAGE);
  const [command = 'list', name, ...extra] = rest;
  if (command === 'list' && !name) return list(env, json, log);
  if (!json && name && !extra.length && command === 'check') return check(name, env, log);
  if (!json && name && !extra.length && command === 'trust') return trust(name, env, log);
  throw new Error(USAGE);
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { home, builtins, pathProblem, validateManifest, scan, resolve, verify, trust, check, list, main, STYLES };
