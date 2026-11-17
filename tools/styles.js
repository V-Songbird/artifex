#!/usr/bin/env node
'use strict';

// The style registry: the built-in styles in skills/artifex/styles/builtin.json
// and the style packs installed under <ARTIFEX_HOME>/styles, listed and named
// together. A style is knowledge, never a picture: a guide to its marks and
// creative direction, and a module of functions that draw those marks. A pack
// adds a proof that runs each function twice inside a box. Listing and
// resolving read JSON and the built-in modules only; no pack code runs. `trust`
// records the hash of a pack's style.json, which hashes every file it may load,
// and `check` refuses a pack that differs from what was trusted before it runs
// any of the pack's code. See docs/apis/style-packs.md.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { VERSION } = require('../core/piece.js');
const { callerDirectory, imports, hint } = require('./piece-input.js');
const { bundle, html } = require('./build-page.js');
const { pngWithManifest } = require('../core/export.js');
const { VectorSurface } = require('../core/surface-vector.js');
const { withEdge, waitFor, evaluate, evaluateInPieces, pageErrors } = require('./check-browser.js');

const ROOT = path.resolve(__dirname, '..');
const STYLES = path.resolve(__dirname, '..', 'skills', 'artifex', 'styles');
const CORE = fs.readdirSync(path.join(ROOT, 'core')).filter((file) => file.endsWith('.js'));
const FORMAT = 2;
const KEYS = ['stylePack', 'name', 'title', 'version', 'artifex', 'summary', 'author', 'license', 'guide', 'module', 'proof', 'marks', 'files'];
const OPTIONAL = new Set(['author', 'license']);
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
// What a piece exports; a style's module exports none of them.
const PIECE_KEYS = ['draw', 'name', 'size', 'seed'];
// A file or folder name Windows can read as a device, whatever its case, as Git
// for Windows refuses it: the device, spaces, then a dot or the end; COM and LPT
// with a superscript digit only alone, since Windows and Git take com¹.js as a file.
const DEVICE = /^(?:(con|prn|aux|nul|conin\$|conout\$|com[1-9]|lpt[0-9]) *(?:\.|$)|((?:com|lpt)[¹²³]) *$)/i;
const deviceProblem = (name) => { const device = DEVICE.exec(name); return device && 'is "' + name + '", which Windows reads as the device ' + (device[1] || device[2]).toUpperCase(); };
const LOADABLE = /\.(?:c?js|mjs|json)$/i;
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

/** `ARTIFEX_HOME`, relative to the caller's directory, or ~/.artifex. */
function home(env = process.env) {
  return env.ARTIFEX_HOME ? path.resolve(callerDirectory(process.cwd(), env), env.ARTIFEX_HOME) : path.join(os.homedir(), '.artifex');
}

// A built-in style: its guide and a module of functions that draw its marks.
function builtins() {
  return JSON.parse(fs.readFileSync(path.join(STYLES, 'builtin.json'), 'utf8')).map((style) => ({
    name: style.name, title: style.title, summary: style.summary, source: 'builtin',
    guide: path.join(STYLES, style.guide), module: path.join(STYLES, style.module),
  }));
}

/**
 * The names of the functions a style's module `file` exports, refused after
 * `prefix` when it exports a piece or no function.
 */
function markNames(marks, file, prefix = 'style: ') {
  if (!marks || typeof marks !== 'object') throw new Error(prefix + file + ' exports no object of mark functions');
  const piece = PIECE_KEYS.filter((key) => Object.hasOwn(marks, key));
  if (piece.length) throw new Error(prefix + file + ' exports ' + piece.join(', ') + '; a style exports the functions that draw its marks, never a piece');
  const names = Object.keys(marks).filter((key) => typeof marks[key] === 'function');
  if (!names.length) throw new Error(prefix + file + ' exports no function');
  return names;
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
  if (m.stylePack === 1) bad('"stylePack" is 1, a pack that holds a piece and a sample; this library reads format 2, a guide and mark functions with their proof, so pack the style\'s mark functions again with npm run styles -- pack');
  for (const key of Object.keys(m)) if (!KEYS.includes(key)) bad('unknown key "' + key + '"');
  for (const key of KEYS) if (!OPTIONAL.has(key) && !Object.hasOwn(m, key)) bad('missing key "' + key + '"');
  if (m.stylePack !== FORMAT) bad('"stylePack" must be ' + FORMAT + ', the format this library reads');
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
  for (const [key, pattern, kind] of [['guide', /\.md$/, '.md'], ['module', /\.c?js$/, '.cjs or .js'], ['proof', /\.c?js$/, '.cjs or .js']]) {
    if (typeof m[key] !== 'string' || !pattern.test(m[key])) bad('"' + key + '" must name a ' + kind + ' file');
    if (!Object.hasOwn(m.files, m[key])) bad('"' + key + '" names ' + m[key] + ', which "files" does not list');
  }
  if (m.module === m.proof) bad('"proof" names the module itself; a proof is a file of its own');
  if (!Array.isArray(m.marks) || !m.marks.length || !m.marks.every((mark) => typeof mark === 'string' && IDENTIFIER.test(mark))) bad('"marks" must list the module\'s function names');
  if (new Set(m.marks).size !== m.marks.length) bad('"marks" lists a name twice');
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
      guide: path.join(folder, m.guide), module: path.join(folder, m.module), marks: m.marks, proof: path.join(folder, m.proof),
      version: m.version, artifex: m.artifex, trusted: trusted[m.name]?.sha256 === hash,
      author: m.author, license: m.license, folder, manifest: m, hash,
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

/** How to use `style` in a piece: its guide and the module of functions that draw its marks. */
function useHint(style) {
  if (style.source === 'builtin') return `the built-in style ${style.name}, read ${style.guide} and draw your own piece with the functions in ${style.module}`;
  const read = style.trusted ? `read ${style.guide}` : `read its files in ${style.folder}, trust it with ${trustCommand(style.name)}, then read ${style.guide}`;
  return `the style pack ${style.name}, ${read} and draw your own piece with the functions in ${style.module}`;
}

/**
 * What to pass instead of a piece name no example has: its path, and, for a
 * style's name, where its guide and marks are, since a style is no piece.
 */
function pieceHint(name, env = process.env) {
  let style = null;
  try { style = resolve(name, env); } catch { /* no style of that name */ }
  return 'For ' + (style ? useHint(style) + '; for ' : '') + `your own piece, pass its path, such as ./${name}.cjs`;
}

/**
 * Why `--style <name>` draws nothing, as a command's refusal cause: a style is
 * a guide and mark functions, so the cause names the style's guide and module,
 * or why the name has no style.
 */
function styleCause(name, env = process.env) {
  const cause = '--style draws nothing, since a style is a guide and the functions that draw its marks, not a picture';
  let style;
  try { style = resolve(name, env); } catch (error) { return cause + '; ' + error.message.replace(/^style: /, ''); }
  return cause + '. For ' + useHint(style) + '; nothing was written';
}

/**
 * A pack's folder holds exactly what its style.json lists: no links, no
 * unlisted file that could be loaded, and every listed file present with its hash.
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
}

const trustCommand = (name) => hint('styles', 'trust', name);

/** Show what a pack holds and requires, without running it, then record its style.json's hash. */
function trust(name, env = process.env, log = console.log) {
  let style;
  try { style = resolve(name, env); } catch (e) {
    if (!e.message.startsWith('style: no style named ')) throw e;
    const { dir, packs } = scan(env);
    throw new Error('style: no pack named "' + name + '" is installed in ' + dir + ' ('
      + (packs.length ? 'installed: ' + packs.map((s) => s.name).join(', ') : 'none is installed')
      + '). Built-in styles need no trust. Install the pack\'s folder there, then run trust again.');
  }
  if (style.source === 'builtin') throw new Error('style: "' + style.name + '" is built in; built-in styles ship with the library and need no trust');
  verify(style);
  const m = style.manifest;
  log('Pack ' + style.name + ' ' + m.version + ' in ' + style.folder);
  log('  author: ' + (m.author || 'not given') + '; license: ' + (m.license || 'not given') + '; packed with Artifex ' + m.artifex);
  log('  marks: ' + m.marks.join(', '));
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
 * The pack file `entry` run as CommonJS, reading nothing but the pack's
 * listed `files` and the library's core/: each require names a listed file by
 * its path from the requiring file, or artifex/core/<file>.js. `cache` shares
 * the modules between entries.
 */
function loadConfined(folder, files, entry, cache = new Map()) {
  const run = (file) => {
    if (cache.has(file)) return cache.get(file).exports;
    const full = path.join(folder, file);
    const text = fs.readFileSync(full, 'utf8').replace(/^﻿/, '').replace(/^#![^\n]*/, '');
    const module = { exports: {} };
    cache.set(file, module);
    if (/\.json$/i.test(file)) {
      try { module.exports = JSON.parse(text); } catch (error) { throw new Error('style: ' + file + ' is not valid JSON: ' + error.message); }
      return module.exports;
    }
    const local = (spec) => {
      const core = /^artifex\/core\/([^/\\]+)$/.exec(spec);
      if (core && CORE.includes(core[1])) return require(path.join(ROOT, 'core', core[1]));
      const target = /^\.\.?\//.test(spec) && path.posix.join(path.posix.dirname(file), spec);
      if (!target || !files.includes(target)) throw new Error('style: ' + file + ' requires ' + spec + ', which is not a listed file of the pack or artifex/core/<file>.js');
      return run(target);
    };
    vm.runInThisContext('(function (module, exports, require) {' + text + '\n})', { filename: full })(module, module.exports, local);
    return module.exports;
  };
  return run(entry);
}

// The Canvas2D state a proof surface starts with, as a canvas does.
const CANVAS_STATE = {
  fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, globalAlpha: 1,
  globalCompositeOperation: 'source-over', lineDashOffset: 0, shadowColor: 'rgba(0, 0, 0, 0)', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
  filter: 'none', font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', imageSmoothingEnabled: true,
};
// A colour that casts no shadow, once spaces are dropped: transparent, or an alpha of zero.
const CLEAR = /^(transparent|#[0-9a-f]{3}0|#[0-9a-f]{6}00|\w+\((([^,]*,){3}|[^/]*\/)(0*\.?0+|0+\.?)%?\))$/i;
// The dash a canvas holds after setLineDash(next) when it held `now`, by VectorSurface's rule:
// a list with a negative or non-finite entry is ignored, an odd-length list is stored doubled.
const DASH = new VectorSurface({ w: 1, h: 1 });
const nextDash = (now, next) => DASH.setLineDash(now).setLineDash(next).getLineDash();

/**
 * A Canvas2D-shaped surface that draws nothing. It records every call and
 * setting, an object by every value it holds and image data by its pixels, so
 * two runs can be compared; drawImage is refused. It checks every point a path,
 * rect or image reaches when painted or cleared, in surface coordinates, and
 * again at a visible shadow's offset, against `box` ([x, y, w, h]); a stroke's
 * width and a shadow's blur are not counted. Curves and arcs are checked at 16
 * and 32 points along them.
 */
function proofSurface(box) {
  const [bx, by, bw, bh] = box;
  const slack = 1e-6 * Math.max(1, Math.abs(bx) + bw, Math.abs(by) + bh);
  const log = [], state = { ...CANVAS_STATE }, stack = [];
  const madeHere = new WeakSet();
  let m = [1, 0, 0, 1, 0, 0], dash = [], points = [], cur = null, paints = 0, outside = null, ids = 0;
  const at = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const to = (x, y) => { points.push(at(x, y)); cur = [x, y]; };
  const check = (reached) => {
    for (const [x, y] of reached) {
      if (!outside && !(x >= bx - slack && x <= bx + bw + slack && y >= by - slack && y <= by + bh + slack)) outside = [x, y];
    }
  };
  const paint = (reached, shadow = true) => {
    // A paint counts only when it reaches two different points: an empty path or a rect of no size paints nothing.
    if (reached.some(([x, y]) => x !== reached[0][0] || y !== reached[0][1])) paints++;
    check(reached);
    // A shadow lands its offset away in canvas pixels, whatever the transform.
    const { shadowOffsetX: sx, shadowOffsetY: sy } = state;
    if (shadow && (sx || sy) && !CLEAR.test(String(state.shadowColor).replace(/\s/g, ''))) check(reached.map(([x, y]) => [x + (+sx || 0), y + (+sy || 0)]));
  };
  const corners = (x, y, w, h, map = at) => [map(x, y), map(x + w, y), map(x, y + h), map(x + w, y + h)];
  const transform = (a, b, c, d, e, f) => { m = [m[0] * a + m[2] * b, m[1] * a + m[3] * b, m[0] * c + m[2] * d, m[1] * c + m[3] * d, m[0] * e + m[2] * f + m[4], m[1] * e + m[3] * f + m[5]]; };
  const made = (kind) => {
    const id = kind + ' ' + ++ids, one = { id, addColorStop(offset, colour) { log.push([id, 'addColorStop', offset, colour]); } };
    madeHere.add(one);
    return one;
  };
  const image = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(0, Math.round(w) * Math.round(h) * 4)) });
  const ellipse = (cx, cy, rx, ry, rot, a0, a1, ccw = false) => {
    const TAU = Math.PI * 2;
    let d = a1 - a0;
    if (ccw) { if (d > 0) d -= TAU * Math.ceil(d / TAU); if (d <= -TAU) d = -TAU; }
    else { if (d < 0) d += TAU * Math.ceil(-d / TAU); if (d >= TAU) d = TAU; }
    if (d === 0 && a1 !== a0) d = ccw ? -TAU : TAU;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    for (let i = 0; i <= 32; i++) {
      const th = a0 + (d * i) / 32, x = rx * Math.cos(th), y = ry * Math.sin(th);
      to(cx + x * cr - y * sr, cy + x * sr + y * cr);
    }
  };
  const methods = {
    save() { stack.push({ m, dash, state: { ...state } }); },
    restore() { const saved = stack.pop(); if (saved) { m = saved.m; dash = saved.dash; Object.assign(state, saved.state); } },
    transform,
    setTransform(a, b, c, d, e, f) { m = typeof a === 'object' && a ? [a.a, a.b, a.c, a.d, a.e, a.f] : [a, b, c, d, e, f]; },
    resetTransform() { m = [1, 0, 0, 1, 0, 0]; },
    translate(x, y) { transform(1, 0, 0, 1, x, y); },
    scale(x, y = x) { transform(x, 0, 0, y, 0, 0); },
    rotate(a) { transform(Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0); },
    getTransform() { const [a, b, c, d, e, f] = m; return { a, b, c, d, e, f }; },
    beginPath() { points = []; cur = null; },
    moveTo: to,
    lineTo: to,
    closePath() {},
    quadraticCurveTo(cx, cy, x, y) {
      const [x0, y0] = cur || [cx, cy];
      for (let i = 1; i <= 16; i++) { const t = i / 16, u = 1 - t; to(u * u * x0 + 2 * u * t * cx + t * t * x, u * u * y0 + 2 * u * t * cy + t * t * y); }
    },
    bezierCurveTo(x1, y1, x2, y2, x, y) {
      const [x0, y0] = cur || [x1, y1];
      for (let i = 1; i <= 16; i++) {
        const t = i / 16, u = 1 - t;
        to(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y);
      }
    },
    arc(cx, cy, r, a0, a1, ccw) { ellipse(cx, cy, r, r, 0, a0, a1, ccw); },
    ellipse,
    // The corner's tangent points and the arc between them, as Canvas2D draws it.
    arcTo(x1, y1, x2, y2, r) {
      if (!cur) return to(x1, y1);
      const [x0, y0] = cur, a = [x0 - x1, y0 - y1], b = [x2 - x1, y2 - y1], la = Math.hypot(...a), lb = Math.hypot(...b);
      const cos = la && lb ? (a[0] * b[0] + a[1] * b[1]) / (la * lb) : 1;
      if (!r || Math.abs(cos) > 1 - 1e-12) return to(x1, y1);
      const half = Math.acos(cos) / 2, reach = r / Math.tan(half), toCentre = r / Math.sin(half);
      const ua = [a[0] / la, a[1] / la], ub = [b[0] / lb, b[1] / lb], bis = [ua[0] + ub[0], ua[1] + ub[1]], lbis = Math.hypot(...bis);
      const c = [x1 + (bis[0] / lbis) * toCentre, y1 + (bis[1] / lbis) * toCentre];
      const t1 = [x1 + ua[0] * reach, y1 + ua[1] * reach], t2 = [x1 + ub[0] * reach, y1 + ub[1] * reach];
      to(...t1);
      ellipse(c[0], c[1], r, r, 0, Math.atan2(t1[1] - c[1], t1[0] - c[0]), Math.atan2(t2[1] - c[1], t2[0] - c[0]), ua[0] * ub[1] - ua[1] * ub[0] > 0);
    },
    rect(x, y, w, h) { points.push(...corners(x, y, w, h)); cur = [x, y]; },
    roundRect(x, y, w, h) { points.push(...corners(x, y, w, h)); cur = [x, y]; },
    fill() { paint(points); },
    stroke() { paint(points); },
    clip() {},
    fillRect(x, y, w, h) { paint(corners(x, y, w, h)); },
    strokeRect(x, y, w, h) { paint(corners(x, y, w, h)); },
    // Clearing paints nothing, but erases only inside the box.
    clearRect(x, y, w, h) { check(corners(x, y, w, h)); },
    drawImage() {
      throw new Error('drawImage cannot be proved, since a canvas or image source\'s pixels cannot be compared and image data is no drawImage source; place pixels with putImageData');
    },
    // Pixels are placed in canvas pixels, whatever the transform, and cast no shadow.
    putImageData(data, x, y) { paint(corners(x, y, data.width, data.height, (u, v) => [u, v]), false); },
    createImageData(w, h) { return typeof w === 'object' ? image(w.width, w.height) : image(w, h); },
    getImageData(x, y, w, h) { return image(w, h); },
    createLinearGradient() { return made('gradient'); },
    createRadialGradient() { return made('gradient'); },
    createConicGradient() { return made('gradient'); },
    createPattern() { return made('pattern'); },
    setLineDash(segments) { dash = nextDash(dash, segments); },
    getLineDash() { return [...dash]; },
  };
  const shown = (value) => {
    if (value && typeof value === 'object') {
      if (madeHere.has(value)) return value.id;
      if (value.data instanceof Uint8ClampedArray) return 'image ' + value.width + 'x' + value.height + ' ' + sha256(value.data);
      if (Array.isArray(value)) return value.map(shown);
      if (value instanceof Map || value instanceof Set) return [value.constructor.name, ...[...value].map(shown)];
      // Any other object, such as a matrix given to setTransform, by every value it holds, so different values never log alike.
      const keys = new Set(Object.getOwnPropertyNames(value));
      for (const key of 'abcdef') if (key in value) keys.add(key);
      return Object.fromEntries([...keys].map((key) => [key, shown(value[key])]));
    }
    return typeof value === 'number' && !Number.isFinite(value) ? String(value) : value;
  };
  const g = new Proxy(state, {
    get(target, key) {
      if (!Object.hasOwn(methods, key)) return target[key];
      return (...args) => { log.push([key, ...args.map(shown)]); return methods[key](...args); };
    },
    set(target, key, value) { log.push([key, '=', shown(value)]); target[key] = value; return true; },
  });
  return { g, log, result: () => ({ paints, outside }) };
}

const short = (text) => (text.length > 160 ? text.slice(0, 157) + '...' : text);

/**
 * Prove each of `names`, the functions a module of marks exports, with its
 * proof module: { <name>: { box: [x, y, w, h], draw(g, marks) } }. `load(watch)`
 * loads the module and its proof afresh and returns { marks, proof }, marks
 * being watch(<the module's exports>), which the proof's own require of the
 * module returns too. Each draw runs on two fresh loads, then once more on the
 * second load, each run on its own proof surface, so neither a value taken when
 * the module loads nor state kept between calls passes as deterministic. A mark
 * is refused by name when its proof throws, never calls it, draws differently
 * the second time, paints nothing or paints outside its box. A
 * proof of a name the module lacks, or a box that is not four finite numbers
 * with a positive size, is refused too.
 */
function proveMarks(load, names) {
  const fresh = () => {
    const called = new Set();
    const watch = (marks) => {
      const watched = { ...marks };
      for (const key of names) watched[key] = (...args) => { called.add(key); return marks[key](...args); };
      return watched;
    };
    return { ...load(watch), called };
  };
  const { proof } = fresh();
  if (!proof || typeof proof !== 'object') throw new Error('its proof exports no object of proofs');
  const extra = Object.keys(proof).filter((key) => !names.includes(key));
  if (extra.length) throw new Error('its proof names ' + extra.join(', ') + ', which its module does not export as a function');
  for (const name of names) {
    const one = proof[name];
    if (!one || typeof one.draw !== 'function') throw new Error('its proof has no draw(g, marks) for ' + name);
    const { box } = one;
    if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite) || !(box[2] > 0 && box[3] > 0)) {
      throw new Error('the proof of ' + name + ' needs a box [x, y, w, h] of finite numbers, w and h above 0');
    }
    // Two loads catch a value taken at load; drawing again on the second catches state kept between calls.
    const later = fresh();
    const runs = [fresh(), later, later].map(({ marks, proof: again, called }) => {
      const surface = proofSurface(box);
      try { again[name].draw(surface.g, marks); } catch (error) { throw new Error('the proof of ' + name + ' throws: ' + error.message); }
      if (!called.has(name)) throw new Error('the proof of ' + name + ' never calls ' + name);
      return surface;
    });
    const logs = runs.map((run) => run.log.map((entry) => JSON.stringify(entry)));
    for (const [first, second] of [[logs[0], logs[1]], [logs[1], logs[2]]]) {
      let differs = first.findIndex((entry, i) => entry !== second[i]);
      if (differs < 0 && first.length !== second.length) differs = first.length;
      if (differs >= 0) {
        throw new Error('the proof of ' + name + ' draws differently the second time, from call ' + (differs + 1) + ': '
          + short(first[differs] ?? 'nothing') + ' then ' + short(second[differs] ?? 'nothing'));
      }
    }
    for (const run of runs) {
      const { paints, outside } = run.result();
      if (!paints) throw new Error('the proof of ' + name + ' paints nothing');
      if (outside) throw new Error('the proof of ' + name + ' paints at (' + outside.map((v) => +v.toFixed(3)).join(', ') + '), outside its box [' + box.join(', ') + ']');
    }
  }
}

/**
 * Load a pack's module and proof confined to its listed files, and prove
 * them: the module exports the functions style.json names and no piece, and
 * each draws the same twice inside its proof's box. Throws naming the first
 * failure, after `prefix`.
 */
function provePack(folder, m, prefix) {
  const files = Object.keys(m.files);
  const names = markNames(loadConfined(folder, files, m.module), m.module);
  if (names.join() !== m.marks.join()) {
    throw new Error(prefix + m.module + ' exports the mark functions ' + names.join(', ') + ', but style.json lists ' + m.marks.join(', '));
  }
  const load = (watch) => {
    const cache = new Map(), marks = watch(loadConfined(folder, files, m.module, cache));
    cache.get(m.module).exports = marks;
    return { marks, proof: loadConfined(folder, files, m.proof, cache) };
  };
  try { proveMarks(load, names); }
  catch (error) { throw new Error(prefix + error.message, { cause: error }); }
  return names;
}

/**
 * A built-in style's module must export functions that draw marks and no
 * piece, and its guide must have the guides' headings. A pack must match its
 * hashes and be trusted as it is before any of its code runs; then its module
 * and proof load confined to its listed files, and each mark is proved.
 */
async function check(name, env = process.env, log = console.log) {
  const style = resolve(name, env);
  if (style.source === 'builtin') {
    const functions = markNames(require(style.module), style.module);
    const problem = fs.existsSync(style.guide) ? guideProblem(fs.readFileSync(style.guide, 'utf8')) : 'is missing';
    if (problem) throw new Error('style: ' + style.name + "'s guide " + style.guide + ' ' + problem);
    log('check ' + style.name + ': built in; its module exports ' + functions.length + ' mark functions and no piece, and its guide has every heading');
    return;
  }
  verify(style);
  if (!style.trusted) {
    const before = readTrust(env).packs[style.name];
    throw new Error('style: ' + style.name + (before ? ' changed since it was trusted as version ' + before.version : ' is not trusted')
      + '. Read its files in ' + style.folder + ', then run: ' + trustCommand(style.name));
  }
  const problem = guideProblem(fs.readFileSync(style.guide, 'utf8'));
  if (problem) throw new Error('style: ' + style.name + "'s guide " + style.manifest.guide + ' ' + problem);
  const names = provePack(style.folder, style.manifest, 'style: ' + style.name + ': ');
  log('check ' + style.name + ': ' + Object.keys(style.manifest.files).length + ' files match style.json, trusted, its guide has every heading, '
    + style.manifest.module + ' loads within the pack\'s own files and exports its ' + names.length + ' mark functions, and each draws the same twice inside its proof\'s box on Artifex ' + VERSION);
}

// The headings every guide has, in this order, each matched by its start.
const HEADINGS = ['What makes it read as', 'Marks', 'Creative direction', 'Pitfalls'];

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
 * lib/<name> for the helper `file`, refused, naming `file`, when style.json
 * would refuse that path, so a pack stops before it stages or proves anything.
 */
function helperName(file) {
  const name = 'lib/' + path.basename(file, path.extname(file)) + path.extname(file).toLowerCase();
  const why = pathProblem(name);
  if (why) throw new Error('pack: ' + file + ' would be packed as ' + name + ', a path that ' + why + '; rename the file');
  return name;
}

/**
 * The files a pack holds, as { name: text }: each of `entries`, [file, name]
 * pairs such as the module as marks.cjs and its proof as proof.cjs, and each
 * local helper or JSON file they reach as lib/<name>, with every literal
 * require rewritten to its new place. The library's core/ becomes
 * artifex/core/<file>.js, as does examples/stroke-font.js, which re-exports
 * core's; a built-in style's module is copied as a helper; any other library
 * file is refused, since only core/ is API.
 */
function packSources(entries) {
  const names = new Map(entries), taken = new Set([...names.values()].map((name) => name.toLowerCase())), found = new Map();
  const nameOf = (file) => {
    if (!names.has(file)) {
      const extension = path.extname(file).toLowerCase(), stem = path.basename(file, path.extname(file));
      let name = helperName(file);
      for (let n = 2; taken.has(name.toLowerCase()); n++) name = 'lib/' + stem + '-' + n + extension;
      taken.add(name.toLowerCase());
      names.set(file, name);
    }
    return names.get(file);
  };
  function walk(file) {
    if (found.has(file)) return;
    const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').replace(/^#![^\n]*/, '');
    const one = { text, rewrites: [] };
    found.set(file, one);
    if (/\.json$/i.test(file)) return;
    for (const dependency of imports(text, file)) {
      let spec = dependency.spec;
      if (!/^artifex\/core\//.test(spec)) {
        const style = /^artifex\/styles\/([^/\\]+\.js)$/.exec(spec);
        const target = style ? path.join(STYLES, style[1]) : createRequire(file).resolve(spec);
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
  }
  for (const [entry] of entries) walk(entry);
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
// Its refusals open with `tool`, the command the user ran.
async function drawPng(name, seed, t, width, box, tool = 'styles') {
  const api = window.__artifex;
  const refuse = (cause) => new Error(tool + ': ' + cause + '; nothing was written');
  // A PieceError is a refusal; a piece's own Error keeps its stack, wrapped so evaluate never shows it as a tool's refusal.
  const failed = (e) => (e && e.name === 'PieceError' ? refuse(e.message) : new Error('drawing ' + name + ' threw: ' + (e && e.stack || e)));
  let p, solved, drawn;
  try {
    const declared = api.piece.validate(api.examples[name]);
    p = box ? api.piece.validate(api.piece.atBox(declared, box)) : declared;
    solved = api.piece.solve(p, seed, {});
  } catch (e) { throw failed(e); }
  if (solved.stages.error) throw refuse('build stage ' + solved.stages.error.stage + ' threw: ' + solved.stages.error.message);
  const scale = width / p.size.w;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(p.size.w * scale);
  canvas.height = Math.round(p.size.h * scale);
  try { drawn = api.render.drawFrame(canvas.getContext('2d'), p, solved, t, { scale: scale }); } catch (e) { throw failed(e); }
  const blob = await new Promise((resolve) => canvas.toBlob(resolve));
  if (!blob) throw refuse('the browser could not encode a ' + canvas.width + ' x ' + canvas.height + ' PNG of ' + name);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(at, at + 0x8000));
  return { manifest: Object.assign({}, solved.manifest, { t: drawn, scale: scale }), png: btoa(text) };
}

/**
 * The piece `name` drawn by drawPng in installed Edge, from `external` or the
 * registered examples when it is null: the PNG's bytes carrying its replay
 * manifest, and the manifest. A `box` ({ w, h }) draws the piece's copy at
 * that box; `edge` stands in for withEdge in tests; `tool` opens its refusals;
 * a `session` ({ file, name }) draws a frame of that saved session's film.
 */
async function pngInEdge(external, name, seed, t, width, browser = {}, box = null, edge = withEdge, tool = 'styles', session = null) {
  const drawn = await edge(html(bundle(external), external ? { count: 1 } : {}), { ...browser, command: tool }, async (client, context) => {
    await waitFor(client, context, 'document.readyState === "complete" && !!window.__artifex');
    context.phase = 'drawing ' + name;
    if (session) await evaluate(client, 'window.__artifex.session(' + JSON.stringify(session.file) + ', ' + JSON.stringify(session.name) + '), true');
    // evaluate() shows a page refusal of `tool` ("still: ...") as its message alone.
    const value = await evaluateInPieces(client, '(' + drawPng.toString() + ')(' + [name, seed, t, width, box, tool].map((v) => JSON.stringify(v)).join(', ') + ')');
    pageErrors(client, context);
    return value;
  });
  return { bytes: Buffer.from(pngWithManifest(new Uint8Array(Buffer.from(drawn.png, 'base64')), drawn.manifest)), manifest: drawn.manifest };
}

const PACK_USAGE = 'usage: npm run styles -- pack <marks.js> --proof <proof.js> --name <name> --guide <guide.md> --summary <text> '
  + '[--title <text>] [--version <v>] [--author <text>] [--license <spdx>] [--replace]';

function packArgs(args) {
  const flags = { '--proof': 'proof', '--name': 'name', '--guide': 'guide', '--summary': 'summary', '--title': 'title', '--version': 'version', '--author': 'author', '--license': 'license' };
  const options = { replace: false, marks: null };
  const refuse = (cause) => new Error('styles pack: ' + cause + '\n' + PACK_USAGE);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--replace') options.replace = true;
    else if (Object.hasOwn(flags, args[i])) {
      if (i + 1 === args.length) throw refuse(args[i] + ' needs a value');
      options[flags[args[i]]] = args[++i];
    }
    else if (args[i].startsWith('-')) throw refuse('unknown option ' + args[i]);
    else if (options.marks) throw refuse('one module of mark functions per pack, got "' + options.marks + '" and "' + args[i] + '"');
    else options.marks = args[i];
  }
  const missing = ['marks', 'proof', 'name', 'guide', 'summary'].filter((key) => !options[key]);
  if (missing.length) throw refuse('missing ' + missing.map((key) => (key === 'marks' ? '<marks.js>' : '--' + key)).join(', '));
  return options;
}

/**
 * Package the module of mark functions at `options.marks`, with its proof at
 * `options.proof`, as the pack `options.name`: copy both and the files they
 * reach, rewriting their requires; write style.json; prove each mark from the
 * copy; and only when every mark is proved, install the pack in
 * <ARTIFEX_HOME>/styles/<name> and trust it. The pack is built in a folder of
 * its own beside styles/, removed whatever happens, so a failure leaves the
 * install folder and any pack it replaces as they were.
 */
async function pack(options, env = process.env, log = console.log) {
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
  const entry = (file) => {
    try { return require.resolve(path.resolve(cwd, file)); }
    catch (error) { throw new Error('pack: cannot load ' + path.resolve(cwd, file) + ': ' + error.message, { cause: error }); }
  };
  const [module, proof] = [entry(options.marks), entry(options.proof)];
  if (module === proof) throw new Error('pack: --proof names the module of mark functions itself; a proof is a file of its own');
  const sources = packSources([[module, 'marks.cjs'], [proof, 'proof.cjs']]);

  fs.mkdirSync(home(env), { recursive: true });
  const stage = fs.mkdtempSync(path.join(home(env), '.pack-' + name + '-'));
  try {
    for (const [file, text] of Object.entries(sources)) {
      fs.mkdirSync(path.dirname(path.join(stage, file)), { recursive: true });
      fs.writeFileSync(path.join(stage, file), text);
    }
    fs.writeFileSync(path.join(stage, 'guide.md'), guide);
    const files = {};
    for (const file of [...Object.keys(sources).sort(), 'guide.md']) files[file] = sha256(fs.readFileSync(path.join(stage, file)));
    const marks = markNames(loadConfined(stage, Object.keys(files), 'marks.cjs'), module, 'pack: ');
    const title = options.title || /^# +(.+)$/m.exec(guide.toString('utf8'))[1].trim();
    const m = validateManifest({
      stylePack: FORMAT, name, title, version: options.version || '1.0.0', artifex: VERSION, summary: options.summary,
      ...(options.author && { author: options.author }), ...(options.license && { license: options.license }),
      guide: 'guide.md', module: 'marks.cjs', proof: 'proof.cjs', marks, files,
    }, name);
    // Proved from the staged copy, so the proof reads nothing from where the pack was made.
    provePack(stage, m, 'pack: ' + name + ': nothing was installed, since ');
    fs.writeFileSync(path.join(stage, 'style.json'), JSON.stringify(m, null, 2) + '\n');
    // The pack being replaced waits beside the build folder, where the scan
    // never looks, until the new one is installed and trusted, and goes back
    // with its trust if either step fails.
    const old = existing && path.join(home(env), '.old-' + path.basename(stage).slice('.pack-'.length));
    const trusted = readTrust(env).packs[name];
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (old) fs.renameSync(dest, old);
    try {
      fs.renameSync(stage, dest);
      log('pack ' + name + ': ' + Object.keys(files).length + ' files in ' + dest + '; each of its ' + marks.length + ' marks draws the same twice inside its proof\'s box');
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

/**
 * The catalog: every style, built in and installed, by name, with its
 * signature in words, the marks it offers and the paths of its guide and
 * module. A built-in module is read for its function names; a pack's come
 * from its style.json, so no pack code runs.
 */
function list(env = process.env, json = false, log = console.log) {
  const { dir, packs, problems } = scan(env);
  const functions = (exported) => Object.keys(exported).filter((key) => typeof exported[key] === 'function');
  const styles = [...builtins().map((style) => ({ ...style, marks: functions(require(style.module)) })), ...packs.map(({ manifest, hash, ...pack }) => pack)];
  if (json) { log(JSON.stringify({ home: home(env), packs: dir, styles, problems }, null, 2)); return; }
  const width = Math.max(...styles.map((s) => s.name.length), ...problems.map((p) => p.name.length));
  for (const s of styles) {
    const where = s.source === 'builtin' ? 'built in' : 'installed ' + s.version + ', packed with ' + s.artifex + ', ' + (s.trusted ? 'trusted' : 'not trusted');
    log(s.name.padEnd(width) + '  ' + where + '  ' + s.title + ': ' + s.summary);
    log(' '.repeat(width) + '  marks: ' + s.marks.join(', '));
    log(' '.repeat(width) + '  guide: ' + s.guide + '  module: ' + s.module);
  }
  for (const p of problems) log(p.name.padEnd(width) + '  ' + p.status + ': ' + p.reason + ' (' + p.folder + ')');
  log('Packs are installed in ' + dir + '.');
}

const USAGE = 'usage: npm run styles [-- list] [-- --json] | npm run styles -- check <name> | npm run styles -- trust <name> | npm run styles -- pack <marks.js> …';

async function main(args = process.argv.slice(2), env = process.env, log = console.log) {
  if (args.includes('--help') || args.includes('-h')) return log(args[0] === 'pack' ? PACK_USAGE : USAGE);
  if (args[0] === 'pack') return pack(packArgs(args.slice(1)), env, log);
  const refuse = (cause) => new Error('styles: ' + cause + '\n' + USAGE);
  const json = args.includes('--json');
  const rest = args.filter((arg) => arg !== '--json');
  const option = rest.find((arg) => arg.startsWith('-'));
  if (option) throw refuse('unknown option ' + option);
  const [command = 'list', name, ...extra] = rest;
  if (!['list', 'check', 'trust'].includes(command)) throw refuse('unknown command "' + command + '"');
  if (command === 'list' && name) throw refuse('list takes no style name, got "' + name + '"');
  if (command === 'list') return list(env, json, log);
  if (json) throw refuse('--json belongs to list, not ' + command);
  if (!name) throw refuse(command + ' needs a style name; npm run styles lists them');
  if (extra.length) throw refuse(command + ' takes one style name, got "' + rest.slice(1).join('" "') + '"');
  return command === 'check' ? check(name, env, log) : trust(name, env, log);
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = {
  home, builtins, markNames, pathProblem, validateManifest, scan, resolve, pieceHint, styleCause, verify, trust, check, list, main, STYLES,
  loadConfined, proofSurface, proveMarks, guideProblem, helperName, packSources, packArgs, pack, drawPng, pngInEdge,
};
