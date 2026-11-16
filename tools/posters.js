#!/usr/bin/env node
'use strict';

// Write the site's posters: every shot in site/shots.js that names a poster is
// drawn in installed Edge, through the browser check's own lifecycle (withEdge),
// at its piece's design size, the site's seed and the shot's still playhead,
// and written as WebP at quality 0.82 by canvas.toBlob. Beside each poster,
// `<poster>.json` names that recipe, a hash of every source file the piece
// reaches (comments, line endings and a leading BOM left out, so such an edit
// leaves the record alone) and a hash of the poster's bytes. `stale()` compares that record
// with the shot list and sources as they are now, so a poster left behind by a
// changed piece, seed, playhead or size fails `npm run site:check`. The WebP
// bytes can differ between machines, so the check never redraws; it trusts
// the record and the record's own hash of the file.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { withEdge, evaluate, waitFor, pageErrors, timeoutArg } = require('./check-browser.js');
const { bundle, reach } = require('./build-page.js');
const { loadExternal, realPath } = require('./piece-input.js');
const { scan } = require('./js-comments.js');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'site', 'shots.js');
// The type follows the poster's extension, as the build accepts it; the site's posters are WebP.
const TYPES = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }, QUALITY = 0.82;
const USAGE = 'usage: npm run posters [-- --edge PATH] [--timeout-ms 120000] [--headed]';

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const slash = (p) => p.replace(/\\/g, '/');

/**
 * `text` without its comments, so a comment edit is not a change to a source.
 * Strings, template literals and regular expression literals are copied as
 * written; a comment that fills its line leaves no blank line behind.
 */
function stripComments(text) {
  const out = [];
  let i = 0;
  const copy = (end) => { for (; i < end; i++) out.push(text[i]); };
  for (const [kind, a, b] of scan(text)) {
    if (kind !== 'comment') continue;
    copy(a);
    i = b;
    let k = out.length, r = i;
    while (k && (out[k - 1] === ' ' || out[k - 1] === '\t')) k--;
    while (text[r] === ' ' || text[r] === '\t') r++;
    const alone = !k || out[k - 1] === '\n', rest = r >= text.length || text[r] === '\n';
    out.length = k;
    // A comment alone on its line takes the line with it.
    if (alone && rest) i = Math.min(r + 1, text.length);
    // A block comment between tokens leaves one space, so `a/*c*/b` does not become `ab`.
    else if (text[a + 1] === '*' && !rest) { i = r; if (k && out[k - 1] !== '\n') out.push(' '); }
  }
  copy(text.length);
  return out.join('');
}

/**
 * `text` with each U+2028 or U+2029 outside a string, template or regular
 * expression turned into a newline, since JavaScript reads it as a line ending
 * there; one inside a literal is text and is left as written.
 */
function lineEndings(text) {
  let out = '', from = 0;
  for (const [kind, a, b] of scan(text)) {
    if (kind === 'comment') continue;
    out += text.slice(from, a).replace(/[\u2028\u2029]/g, '\n') + text.slice(a, b);
    from = b;
  }
  return out + text.slice(from).replace(/[\u2028\u2029]/g, '\n');
}

/**
 * Each shot of `shots` (the shot-list module) that names a poster: its name,
 * the poster's path, the recipe it must be drawn from, and the hash of every
 * source file its piece reaches, keyed by real path (on-disk case, links
 * followed, as `recipe.piece` is): the piece's own modules relative to the
 * shot list's real directory, library modules by their id. Returns
 * `{ recipes, loaded }`: the shots as a list, and the one `loadExternal` load
 * they came from (null when no shot names a poster), so `writePosters` bundles
 * it instead of loading again. Line endings and
 * comments and a leading byte order mark (BOM) are not part of a source.
 * U+2028 and U+2029 count as line endings in code and comments; inside a
 * string, template or regular expression they are text and hash as written.
 */
function recipes(shots = SHOTS) {
  const file = path.resolve(shots), base = path.dirname(file);
  delete require.cache[file];
  const config = require(file);
  // Each source file is hashed once per call.
  const hashes = new Map();
  const hashOf = (f) => {
    if (!hashes.has(f)) hashes.set(f, sha(stripComments(lineEndings(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')))));
    return hashes.get(f);
  };
  const named = config.shots.filter((s) => s.poster);
  if (!named.length) return { recipes: [], loaded: null };
  // One call loads every piece, so loadExternal decides which spellings are one file.
  const loaded = loadExternal(named.map((s) => s.piece), base);
  const realOf = new Map(loaded.modules.map((m) => [m.id, m.real]));
  const realBase = realPath(base);
  const list = named.map((s, i) => {
    const { entry, piece, modules, library } = loaded.pieces[i];
    // Keys are real paths, as recipe.piece is: the file's first spelling (another case, a link) names the same key.
    const files = modules.map((id) => [slash(path.relative(realBase, realOf.get(id))), realOf.get(id)])
      .concat(reach(library).map((id) => [id, path.join(ROOT, id)]));
    const sources = Object.fromEntries(files.sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, f]) => [key, hashOf(f)]));
    const { size } = piece;
    return {
      name: s.name, poster: path.resolve(base, s.poster), id: piece.name,
      recipe: { piece: slash(path.relative(realBase, realPath(entry))), seed: config.seed, t: s.still ?? 1, width: size.w, height: size.h, type: TYPES[path.extname(s.poster).toLowerCase()], quality: QUALITY },
      sources,
    };
  });
  return { recipes: list, loaded };
}

/** The record written beside a poster: its recipe, its sources and its bytes' hash. */
function record(entry, bytes) {
  return JSON.stringify({ recipe: entry.recipe, sources: entry.sources, poster: sha(bytes) }, null, 2) + '\n';
}

/**
 * Why each poster of `shots` was not drawn from its shot's current recipe, as
 * messages naming the shot; empty when every poster is current.
 */
function stale(shots = SHOTS) {
  const failures = [];
  for (const entry of recipes(shots).recipes) {
    const who = 'poster ' + entry.name + ': ';
    const json = entry.poster + '.json';
    if (!fs.existsSync(entry.poster)) { failures.push(who + entry.poster + ' is missing; run npm run posters'); continue; }
    if (!fs.existsSync(json)) { failures.push(who + 'no record ' + json + '; run npm run posters'); continue; }
    const kept = JSON.parse(fs.readFileSync(json, 'utf8'));
    const keys = [...new Set(Object.keys(entry.recipe).concat(Object.keys(kept.recipe || {})))];
    const moved = keys.filter((k) => (kept.recipe || {})[k] !== entry.recipe[k]).map((k) => k + ' ' + (kept.recipe || {})[k] + ' -> ' + entry.recipe[k]);
    if (moved.length) failures.push(who + 'drawn from another recipe (' + moved.join(', ') + '); run npm run posters');
    const names = [...new Set(Object.keys(entry.sources).concat(Object.keys(kept.sources || {})))];
    const changed = names.filter((k) => (kept.sources || {})[k] !== entry.sources[k]);
    if (changed.length) failures.push(who + 'sources changed since it was drawn (' + changed.join(', ') + '); run npm run posters');
    if (kept.poster !== sha(fs.readFileSync(entry.poster))) failures.push(who + entry.poster + ' is not the file its record names; run npm run posters');
  }
  return failures;
}

// Drawn in the page: one poster, returned as base64.
async function drawPoster(id, recipe) {
  const req = __require('posters');
  const P = req('core/piece.js'), R = req('core/render.js');
  const piece = P.validate(req('examples/index.js')[id]);
  const solved = P.solve(piece, recipe.seed, {});
  if (solved.stages.error) throw new Error('posters: ' + id + ': build stage "' + solved.stages.error.stage + '" threw: ' + solved.stages.error.message + '; nothing was written');
  const c = document.createElement('canvas');
  c.width = recipe.width; c.height = recipe.height;
  R.drawFrame(c.getContext('2d'), piece, solved, recipe.t, { scale: recipe.width / piece.size.w });
  const blob = await new Promise((resolve) => c.toBlob(resolve, recipe.type, recipe.quality));
  if (!blob) throw new Error('posters: the browser could not encode a ' + c.width + ' x ' + c.height + ' ' + recipe.type + ' poster of ' + id + '; nothing was written');
  if (blob.type !== recipe.type) throw new Error('posters: ' + id + ': the canvas wrote ' + blob.type + ', not ' + recipe.type + '; nothing was written');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/**
 * Draw every poster of `shots` in installed Edge and write each file that
 * changed; a page error refuses the run before anything is written. `edge`
 * stands in for withEdge in a test.
 */
async function writePosters(options = {}, shots = SHOTS, edge = withEdge) {
  const { recipes: entries, loaded: external } = recipes(shots);
  if (!entries.length) return [];
  const page = '<!doctype html><meta charset="utf-8"><title>posters</title><script>\n'
    + bundle({ source: external.source }, reach(external.library.concat(['core/piece.js', 'core/render.js']))) + '\n</script>';
  const drawn = await edge(page, { ...options, command: 'posters' }, async (client, context) => {
    context.phase = 'poster drawing';
    await waitFor(client, context, 'document.readyState === "complete"');
    const out = [];
    for (const e of entries) out.push(Buffer.from(await evaluate(client, '(' + drawPoster + ')(' + JSON.stringify(e.id) + ', ' + JSON.stringify(e.recipe) + ')'), 'base64'));
    pageErrors(client, context);
    return out;
  });
  return entries.map((e, i) => {
    const bytes = drawn[i], json = e.poster + '.json', text = record(e, bytes);
    const same = fs.existsSync(e.poster) && fs.readFileSync(e.poster).equals(bytes);
    if (!same) { fs.mkdirSync(path.dirname(e.poster), { recursive: true }); fs.writeFileSync(e.poster, bytes); }
    const kept = fs.existsSync(json) && fs.readFileSync(json, 'utf8') === text;
    if (!kept) fs.writeFileSync(json, text);
    return { name: e.name, file: e.poster, bytes: bytes.length, written: !same, recordWritten: !kept };
  });
}

function parseArgs(args) {
  const options = { timeoutMs: 120000, headed: false };
  const refuse = (cause) => new Error('posters: ' + cause + '\n' + USAGE);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--headed') options.headed = true;
    else if (args[i] === '--edge') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw refuse('--edge needs the path to msedge');
      options.edge = args[++i];
    }
    else if (args[i] === '--timeout-ms') options.timeoutMs = timeoutArg(args[++i] ?? 'nothing', refuse, { min: 1000, max: 2147483647, fallback: 120000 });
    else throw refuse('unknown option ' + args[i]);
  }
  return options;
}

async function main(args = process.argv.slice(2)) {
  if (args.includes('--help') || args.includes('-h')) return console.log(USAGE);
  const written = await writePosters(parseArgs(args));
  for (const w of written) {
    console.log(slash(path.relative(ROOT, w.file)) + '  ' + w.bytes + ' B, ' + (w.written ? 'written' : 'unchanged')
      + (w.recordWritten ? ', record written' : ''));
  }
  const failures = stale();
  if (failures.length) throw new Error(failures.join('\n'));
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { stripComments, recipes, record, stale, writePosters, drawPoster, parseArgs, main, QUALITY };
