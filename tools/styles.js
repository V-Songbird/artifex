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
const { createRequire } = require('node:module');
const { VERSION, frameT } = require('../core/piece.js');
const { renderVector } = require('../core/render.js');
const { callerDirectory, imports, loadExternal } = require('./piece-input.js');
const { manifestOf, replay } = require('./replay.js');
const { bundle, html, pngWithManifest } = require('./build-page.js');
const { withEdge, waitFor, evaluateInPieces } = require('./check-browser.js');

const ROOT = path.resolve(__dirname, '..');
const STYLES = path.resolve(__dirname, '..', 'skills', 'artifex', 'styles');
const KEYS = ['stylePack', 'name', 'title', 'version', 'artifex', 'summary', 'author', 'license', 'piece', 'guide', 'sample', 'files'];
const OPTIONAL = new Set(['author', 'license']);
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// A file or folder name Windows can read as a device, whatever its case and
// extension, as Git for Windows refuses it: the device, spaces, then a dot or the end.
const DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9]) *(?:\.|$)/i;
const deviceProblem = (name) => { const device = DEVICE.exec(name); return device && 'is "' + name + '", which Windows reads as the device ' + device[1].toUpperCase(); };
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
  const device = parts.map(deviceProblem).find(Boolean);
  if (device) return 'has a segment that ' + device;
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
  if (deviceProblem(m.name)) bad('"name" ' + deviceProblem(m.name));
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
  setTrust(style.name, { version: m.version, sha256: style.hash }, env);
  log('Trusted ' + style.name + ' ' + m.version + ' (style.json sha256 ' + style.hash + ') in ' + trustFile(env) + '.');
}

/** Record `entry` as the trust of pack `name`, or remove its trust when `entry` is undefined. */
function setTrust(name, entry, env) {
  const record = readTrust(env);
  if (entry) record.packs[name] = entry;
  else delete record.packs[name];
  fs.mkdirSync(home(env), { recursive: true });
  const temporary = trustFile(env) + '.' + process.pid + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(record, null, 2) + '\n');
  fs.renameSync(temporary, trustFile(env));
}

/**
 * The piece a style names, loaded as `page` and `seeds` load an external
 * piece, with `style` and an output stem `style-<name>` under the library's
 * out/. A pack must match its hashes and be trusted as it is before any of its
 * code runs, and then loads confined to its listed files; `unproved` hears
 * when its sample was proved on another version.
 */
function load(name, env = process.env, unproved = console.warn) {
  const style = resolve(name, env);
  const named = { style, stem: 'style-' + style.name, directory: path.resolve(__dirname, '..', 'out') };
  if (style.source === 'builtin') return { ...loadExternal(style.piece, STYLES), ...named };
  verify(style);
  if (!style.trusted) {
    const before = readTrust(env).packs[style.name];
    throw new Error('style: ' + style.name + (before ? ' changed since it was trusted as version ' + before.version : ' is not trusted')
      + '. Read its files, then run: ' + trustCommand(style.name));
  }
  if (!style.proved) unproved('style: ' + style.name + ' is not proved on this version: its sample was proved with Artifex ' + style.artifex + ', this is ' + VERSION);
  const files = Object.keys(style.manifest.files);
  return { ...loadExternal(style.piece, style.folder, { confine: { root: style.folder, files } }), ...named };
}

/**
 * Replay a pack's sample from a fresh copy of its listed files, so the proof
 * reads nothing from where the pack was made; its callers have loaded the
 * piece confined to those files first. Resolves to replay's result; the copy
 * is removed either way.
 */
async function prove(folder, m, browser = {}) {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-proof-' + process.pid + '-'));
  try {
    for (const file of Object.keys(m.files)) {
      fs.mkdirSync(path.dirname(path.join(copy, file)), { recursive: true });
      fs.copyFileSync(path.join(folder, file), path.join(copy, file));
    }
    return await replay(m.sample, { piece: m.piece, cwd: copy, browser });
  } finally {
    fs.rmSync(copy, { recursive: true, force: true });
  }
}

/**
 * A built-in style's module must load as a piece of its name. A pack must
 * load as `load` loads it, be proved on this version, and its sample must
 * replay from a clean copy of the pack.
 */
async function check(name, env = process.env, log = console.log, browser = {}) {
  const { style, piece } = load(name, env, (message) => { throw new Error(message); });
  if (style.source === 'builtin') {
    if (piece.name !== style.name) throw new Error('style: ' + style.piece + ' is named ' + piece.name + ', not ' + style.name);
    if (!fs.existsSync(style.guide)) throw new Error('style: ' + style.name + ' has no guide at ' + style.guide);
    log('check ' + style.name + ': built in; its module loads as the piece ' + piece.name + ' and its guide is present');
    return;
  }
  const proof = await prove(style.folder, style.manifest, browser);
  if (!proof.match) throw new Error('style: ' + style.name + ': ' + style.manifest.sample + ' does not replay from a clean copy of the pack: ' + proof.detail);
  log('check ' + style.name + ': ' + Object.keys(style.manifest.files).length + ' files match style.json, trusted, proved with ' + style.artifex
    + ', its piece loads within its own files, and ' + style.manifest.sample + ' replays from a clean copy: ' + proof.detail);
}

// The headings every built-in guide has, in this order, each matched by its start.
const HEADINGS = ['What makes it read as', 'Recipe', 'Pitfalls', 'Any subject'];

/** Why a guide lacks the built-in guides' title and headings, or null. */
function guideProblem(text) {
  if (!/^# +\S/m.test(text)) return 'has no "# " title';
  const headings = [...text.matchAll(/^## +(.+)$/gm)].map((found) => found[1].trim().toLowerCase());
  let at = 0;
  for (const want of HEADINGS) {
    const found = headings.findIndex((heading, i) => i >= at && heading.startsWith(want.toLowerCase()));
    if (found < 0) return 'has no "## ' + want + '" heading' + (at ? ' after "## ' + HEADINGS[HEADINGS.indexOf(want) - 1] + '"' : '');
    at = found + 1;
  }
  return null;
}

const LIBRARY_EXAMPLE = /^examples\/[^/]+\.js$/;

/**
 * The files a pack of `entry` holds: the piece as piece.cjs and each local
 * helper or JSON file it reaches as lib/<name>, as { name: text }, with every
 * literal require rewritten to its new place. The library's core/ becomes
 * artifex/core/<file>.js, as does examples/stroke-font.js, which re-exports
 * core's; any other library file is refused, since only core/ is API.
 */
function packSources(entry) {
  const names = new Map([[entry, 'piece.cjs']]), taken = new Set(['piece.cjs']), found = new Map();
  const nameOf = (file) => {
    if (!names.has(file)) {
      const extension = path.extname(file).toLowerCase(), stem = path.basename(file, path.extname(file));
      let name = 'lib/' + stem + extension;
      for (let n = 2; taken.has(name.toLowerCase()); n++) name = 'lib/' + stem + '-' + n + extension;
      taken.add(name.toLowerCase());
      names.set(file, name);
    }
    return names.get(file);
  };
  (function walk(file) {
    if (found.has(file)) return;
    const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').replace(/^#![^\n]*/, '');
    const one = { text, rewrites: [] };
    found.set(file, one);
    if (/\.json$/i.test(file)) return;
    for (const dependency of imports(text, file)) {
      let spec = dependency.spec;
      if (!/^artifex\/core\//.test(spec)) {
        const target = createRequire(file).resolve(spec);
        const library = path.relative(ROOT, target).split(path.sep).join('/');
        if (/^core\/[^/]+\.js$/.test(library) || library === 'examples/stroke-font.js') spec = 'artifex/core/' + path.basename(library);
        else if (LIBRARY_EXAMPLE.test(library)) {
          throw new Error('pack: ' + file + ' requires ' + dependency.spec + ', the library file ' + library + '; a pack may require only its own files and artifex/core/<file>.js');
        } else {
          walk(target);
          spec = path.posix.relative(path.posix.dirname(nameOf(file)), nameOf(target));
          if (!spec.startsWith('.')) spec = './' + spec;
        }
      }
      one.rewrites.push({ ...dependency, spec });
    }
  })(entry);
  const sources = {};
  for (const [file, { text, rewrites }] of found) {
    let out = text;
    for (const r of rewrites.reverse()) out = out.slice(0, r.start) + 'require(' + JSON.stringify(r.spec) + ')' + out.slice(r.end);
    sources[nameOf(file)] = out;
  }
  return sources;
}

// Serialized into the page: what the page's PNG button does, at `scale`, for
// the one piece the page holds. Resolves to the recipe and the PNG as base64.
async function drawPng(name, seed, t, width) {
  const api = window.__artifex;
  const p = api.piece.validate(api.examples[name]);
  const solved = api.piece.solve(p, seed, {});
  if (solved.stages.error) throw new Error('build stage ' + solved.stages.error.stage + ' threw: ' + solved.stages.error.message);
  const scale = width / p.size.w;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(p.size.w * scale);
  canvas.height = Math.round(p.size.h * scale);
  const drawn = api.render.drawFrame(canvas.getContext('2d'), p, solved, t, { scale: scale });
  const bytes = new Uint8Array(await (await new Promise((resolve) => canvas.toBlob(resolve))).arrayBuffer());
  let text = '';
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(at, at + 0x8000));
  return { manifest: Object.assign({}, solved.manifest, { t: drawn, scale: scale }), png: btoa(text) };
}

const SAMPLE_WIDTH = 600;

/**
 * The sample a pack's piece draws: an SVG in Node for a piece that declares
 * vector output, else a PNG SAMPLE_WIDTH pixels wide from installed Edge,
 * each carrying its replay manifest.
 */
async function drawSample(external, seed, t, browser = {}) {
  const { piece } = external;
  if (piece.outputs.includes('vector')) return { file: 'sample.svg', bytes: Buffer.from(renderVector(piece, { seed, t }).svg, 'utf8') };
  const drawn = await withEdge(html(bundle(external), { count: 1 }), browser, async (client, context) => {
    await waitFor(client, context, 'document.readyState === "complete" && !!window.__artifex');
    context.phase = 'sample drawing';
    const value = await evaluateInPieces(client, '(' + drawPng.toString() + ')(' + [piece.name, seed, t, SAMPLE_WIDTH].map((v) => JSON.stringify(v)).join(', ') + ')');
    if (context.errors.length) throw new Error('browser: page errors:\n' + context.errors.join('\n'));
    return value;
  });
  return { file: 'sample.png', bytes: Buffer.from(pngWithManifest(new Uint8Array(Buffer.from(drawn.png, 'base64')), drawn.manifest)) };
}

const PACK_USAGE = 'styles: usage: npm run styles -- pack <piece> --name <name> --guide <guide.md> --summary <text> '
  + '[--title <text>] [--version <v>] [--author <text>] [--license <spdx>] [--seed <n>] [--t <0..1>] [--replace]';

function packArgs(args) {
  const flags = { '--name': 'name', '--guide': 'guide', '--summary': 'summary', '--title': 'title', '--version': 'version', '--author': 'author', '--license': 'license', '--seed': 'seed', '--t': 't' };
  const options = { replace: false, piece: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--replace') options.replace = true;
    else if (Object.hasOwn(flags, args[i]) && i + 1 < args.length) options[flags[args[i]]] = args[++i];
    else if (args[i].startsWith('-') || options.piece) throw new Error(PACK_USAGE);
    else options.piece = args[i];
  }
  if (!options.piece || !options.name || !options.guide || !options.summary) throw new Error(PACK_USAGE);
  return options;
}

/**
 * Package the piece at `options.piece` as the pack `options.name`: copy it and
 * the files it reaches, rewriting their requires; draw its sample; write
 * style.json; replay the sample from a clean copy; and only when it matches,
 * install the pack in <ARTIFEX_HOME>/styles/<name> and trust it. The pack is
 * built in a folder of its own beside styles/, removed whatever happens, so a
 * failure leaves the install folder and any pack it replaces as they were.
 */
async function pack(options, env = process.env, log = console.log, browser = {}) {
  const cwd = callerDirectory(process.cwd(), env);
  const name = options.name;
  if (!NAME.test(name) || name.length > 40) throw new Error('pack: the name must be lowercase kebab-case, at most 40 characters, not "' + name + '"');
  if (deviceProblem(name)) throw new Error('pack: the name ' + deviceProblem(name) + '; choose another');
  if (builtins().some((style) => style.name === name)) throw new Error('pack: "' + name + '" is a built-in style\'s name; choose another');
  const dest = path.join(home(env), 'styles', name);
  const existing = fs.lstatSync(dest, { throwIfNoEntry: false });
  if (existing && existing.isSymbolicLink()) throw new Error('pack: ' + dest + ' is a link; remove it yourself first');
  if (existing && !options.replace) throw new Error('pack: ' + dest + ' exists; pass --replace to replace it');
  const guidePath = path.resolve(cwd, options.guide);
  const guide = fs.readFileSync(guidePath);
  const problem = guideProblem(guide.toString('utf8'));
  if (problem) throw new Error('pack: ' + guidePath + ' ' + problem + '; a guide has "# <title>", then "## ' + HEADINGS.join('", "## ') + '", in that order');
  const { entry, piece } = loadExternal(options.piece, cwd);
  const seed = options.seed === undefined ? piece.seed : Number(options.seed);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('pack: --seed must be an integer from 0 to 4294967295');
  const t = options.t === undefined ? 1 : Number(options.t);
  if (!(t >= 0 && t <= 1)) throw new Error('pack: --t must be a number from 0 to 1');
  const sources = packSources(entry);

  fs.mkdirSync(home(env), { recursive: true });
  const stage = fs.mkdtempSync(path.join(home(env), '.pack-' + name + '-'));
  try {
    for (const [file, text] of Object.entries(sources)) {
      fs.mkdirSync(path.dirname(path.join(stage, file)), { recursive: true });
      fs.writeFileSync(path.join(stage, file), text);
    }
    fs.writeFileSync(path.join(stage, 'guide.md'), guide);
    const staged = loadExternal('piece.cjs', stage, { confine: { root: stage, files: Object.keys(sources) } });
    const sample = await drawSample(staged, seed, frameT(staged.piece, t), browser);
    fs.writeFileSync(path.join(stage, sample.file), sample.bytes);
    const files = {};
    for (const file of [...Object.keys(sources).sort(), 'guide.md', sample.file]) files[file] = sha256(fs.readFileSync(path.join(stage, file)));
    const title = options.title || /^# +(.+)$/m.exec(guide.toString('utf8'))[1].trim();
    const m = validateManifest({
      stylePack: 1, name, title, version: options.version || '1.0.0', artifex: VERSION, summary: options.summary,
      ...(options.author && { author: options.author }), ...(options.license && { license: options.license }),
      piece: 'piece.cjs', guide: 'guide.md', sample: sample.file, files,
    }, name);
    fs.writeFileSync(path.join(stage, 'style.json'), JSON.stringify(m, null, 2) + '\n');
    const proof = await prove(stage, m, browser);
    if (!proof.match) throw new Error('pack: ' + name + ': ' + sample.file + ' does not replay from a clean copy of the pack, so nothing was installed: ' + proof.detail);
    // The pack being replaced waits beside the build folder, where the scan
    // never looks, until the new one is installed and trusted, and goes back
    // with its trust if either step fails.
    const old = existing && path.join(home(env), '.old-' + path.basename(stage).slice('.pack-'.length));
    const trusted = readTrust(env).packs[name];
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (old) fs.renameSync(dest, old);
    try {
      fs.renameSync(stage, dest);
      log('pack ' + name + ': ' + Object.keys(files).length + ' files in ' + dest + '; ' + sample.file + ' replays from a clean copy: ' + proof.detail);
      trust(name, env, log);
    } catch (error) {
      try {
        fs.rmSync(dest, { recursive: true, force: true });
        if (old) fs.renameSync(old, dest);
        if (JSON.stringify(readTrust(env).packs[name]) !== JSON.stringify(trusted)) setTrust(name, trusted, env);
      } catch (restore) {
        throw new Error('pack: ' + name + ' was not installed (' + error.message + '), and restoring '
          + (old ? 'the pack it replaces failed: ' + restore.message + '; that pack is kept in ' + old : 'the install folder failed: ' + restore.message), { cause: error });
      }
      throw error;
    }
    try { if (old) fs.rmSync(old, { recursive: true, force: true }); }
    catch (error) { log('pack ' + name + ': installed, but the pack it replaced could not be removed from ' + old + ': ' + error.message); }
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
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

const USAGE = 'styles: usage: npm run styles [-- list] [-- --json] | npm run styles -- check <name> | npm run styles -- trust <name> | npm run styles -- pack <piece> …';

async function main(args = process.argv.slice(2), env = process.env, log = console.log) {
  if (args[0] === 'pack') return pack(packArgs(args.slice(1)), env, log);
  const json = args.includes('--json');
  const rest = args.filter((arg) => arg !== '--json');
  if (rest.some((arg) => arg.startsWith('-'))) throw new Error(USAGE);
  const [command = 'list', name, ...extra] = rest;
  if (command === 'list' && !name) return list(env, json, log);
  if (!json && name && !extra.length && command === 'check') return check(name, env, log);
  if (!json && name && !extra.length && command === 'trust') return trust(name, env, log);
  throw new Error(USAGE);
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = {
  home, builtins, pathProblem, validateManifest, scan, resolve, verify, trust, load, check, list, main, STYLES,
  prove, guideProblem, packSources, packArgs, pack, drawPng, SAMPLE_WIDTH,
};
