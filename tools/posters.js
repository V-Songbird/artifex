#!/usr/bin/env node
'use strict';

// Write the site's posters: every shot in site/shots.js that names a poster is
// drawn in installed Edge, through the browser check's own lifecycle (withEdge),
// at its piece's design size, the site's seed and the shot's still playhead,
// and written as WebP at quality 0.82 by canvas.toBlob. Beside each poster,
// `<poster>.json` names that recipe, a hash of every source file the piece
// reaches and a hash of the poster's bytes. `stale()` compares that record
// with the shot list and sources as they are now, so a poster left behind by a
// changed piece, seed, playhead or size fails `npm run site:check`. The WebP
// bytes can differ between machines, so the check never redraws; it trusts
// the record and the record's own hash of the file.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { withEdge, evaluate, waitFor } = require('./check-browser.js');
const { bundle, reach } = require('./build-page.js');
const { loadExternal } = require('./piece-input.js');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'site', 'shots.js');
// The type follows the poster's extension, as the build accepts it; the site's posters are WebP.
const TYPES = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }, QUALITY = 0.82;
const USAGE = 'usage: npm run posters [-- --edge PATH] [--timeout-ms 120000] [--headed]';

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const slash = (p) => p.replace(/\\/g, '/');

/**
 * Each shot of `shots` (the shot-list module) that names a poster: its name,
 * the poster's path, the recipe it must be drawn from, and the hash of every
 * source file its piece reaches, keyed by path (the piece's own modules from
 * the shot list's directory, library modules by their id). Line endings are
 * not part of a source.
 */
function recipes(shots = SHOTS) {
  const file = path.resolve(shots), base = path.dirname(file);
  delete require.cache[file];
  const config = require(file);
  return config.shots.filter((s) => s.poster).map((s) => {
    const loaded = loadExternal([s.piece], base);
    // The next call reads the piece's size as its sources then stand.
    for (const m of loaded.modules) delete require.cache[m.file];
    const files = loaded.modules.map((m) => [slash(path.relative(base, m.file)), m.file])
      .concat(reach(loaded.library).map((id) => [id, path.join(ROOT, id)]));
    const sources = Object.fromEntries(files.sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, f]) => [key, sha(fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'))]));
    const { size } = loaded.pieces[0].piece;
    return {
      name: s.name, poster: path.resolve(base, s.poster), id: loaded.pieces[0].piece.name,
      recipe: { piece: slash(path.relative(base, loaded.pieces[0].entry)), seed: config.seed, t: s.still ?? 1, width: size.w, height: size.h, type: TYPES[path.extname(s.poster).toLowerCase()], quality: QUALITY },
      sources,
    };
  });
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
  for (const entry of recipes(shots)) {
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
  if (solved.stages.error) throw new Error(id + ': build stage "' + solved.stages.error.stage + '" threw: ' + solved.stages.error.message);
  const c = document.createElement('canvas');
  c.width = recipe.width; c.height = recipe.height;
  R.drawFrame(c.getContext('2d'), piece, solved, recipe.t, { scale: recipe.width / piece.size.w });
  const blob = await new Promise((resolve) => c.toBlob(resolve, recipe.type, recipe.quality));
  if (!blob || blob.type !== recipe.type) throw new Error(id + ': the canvas wrote ' + (blob && blob.type) + ', not ' + recipe.type);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/** Draw every poster of `shots` in installed Edge and write each file that changed. */
async function writePosters(options = {}, shots = SHOTS) {
  const entries = recipes(shots);
  if (!entries.length) return [];
  const base = path.dirname(path.resolve(shots));
  const external = loadExternal(entries.map((e) => e.recipe.piece), base);
  const page = '<!doctype html><meta charset="utf-8"><title>posters</title><script>\n'
    + bundle({ source: external.source }, reach(external.library.concat(['core/piece.js', 'core/render.js']))) + '\n</script>';
  const drawn = await withEdge(page, options, async (client, context) => {
    context.phase = 'poster drawing';
    await waitFor(client, context, 'document.readyState === "complete"');
    const out = [];
    for (const e of entries) out.push(Buffer.from(await evaluate(client, '(' + drawPoster + ')(' + JSON.stringify(e.id) + ', ' + JSON.stringify(e.recipe) + ')'), 'base64'));
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
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--headed') options.headed = true;
    else if (args[i] === '--edge' && args[i + 1] && !args[i + 1].startsWith('--')) options.edge = args[++i];
    else if (args[i] === '--timeout-ms' && /^\d+$/.test(args[i + 1] || '') && Number(args[i + 1]) >= 1000) options.timeoutMs = Number(args[++i]);
    else throw new Error(USAGE);
  }
  return options;
}

async function main(args = process.argv.slice(2)) {
  const written = await writePosters(parseArgs(args));
  for (const w of written) {
    console.log(slash(path.relative(ROOT, w.file)) + '  ' + w.bytes + ' B, ' + (w.written ? 'written' : 'unchanged')
      + (w.recordWritten ? ', record written' : ''));
  }
  const failures = stale();
  if (failures.length) throw new Error(failures.join('\n'));
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { recipes, record, stale, writePosters, parseArgs, main, QUALITY };
