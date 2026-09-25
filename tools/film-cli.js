#!/usr/bin/env node
'use strict';

// Save a piece's MP4 film from the command line.
//
// The film is made by the page's own __artifex.film(), in installed Edge on
// check-browser's withEdge lifecycle, so the file is the one the page's MP4
// button saves: the same frames, soundtrack, levelling and replay manifest.
// This adds no exporter of its own; it carries the bytes back and writes them.
//
//   npm run film -- readout                          out/readout.mp4
//   npm run film -- ./boat.cjs --out boat.mp4        beside the caller
//   npm run film -- --style impasto --scale 1        a style by name, at its design box
//   npm run film -- readout --bitrate 30000000       more bits than the default
//
// Writes the MP4 and its report, the MP4's name with .json added, and prints
// one summary line. Exits 1 with the page's own message when the export fails.

const fs = require('node:fs');
const path = require('node:path');

const EXAMPLES = require('../examples/index.js');
const { bundle, html, filmNote } = require('./build-page.js');
const { withEdge, waitFor, evaluateInPieces } = require('./check-browser.js');
const { isPiecePath, loadExternal, callerDirectory } = require('./piece-input.js');

const ROOT = path.resolve(__dirname, '..');
const USAGE = 'usage: npm run film -- <piece | ./piece.cjs | --style name> [--out file.mp4] [--scale n] [--bitrate bit/s]'
  + ' [--edge PATH] [--timeout-ms N] [--headed]';
// A long film takes minutes to draw and encode; the deadline still ends a hung export.
const TIMEOUT_MS = 600000, MAX_TIMEOUT_MS = 3600000;

function parseArgs(args) {
  const out = { piece: null, style: null, out: null, film: {}, browser: { timeoutMs: TIMEOUT_MS } };
  const value = (i) => {
    if (args[i + 1] === undefined || args[i + 1].startsWith('--')) throw new Error('film: ' + args[i] + ' needs a value. ' + USAGE);
    return args[i + 1];
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--out') out.out = value(i++);
    else if (a === '--style') out.style = value(i++);
    else if (a === '--scale' || a === '--bitrate') {
      const n = Number(value(i));
      if (!(Number.isFinite(n) && n > 0)) throw new Error('film: ' + a + ' must be a positive number, got ' + args[i + 1]);
      out.film[a.slice(2)] = n;
      i++;
    }
    else if (a === '--edge') out.browser.edge = value(i++);
    else if (a === '--timeout-ms') out.browser.timeoutMs = Number(value(i++));
    else if (a === '--headed') out.browser.headed = true;
    else if (a.startsWith('--') || out.piece) throw new Error(USAGE);
    else out.piece = a;
  }
  if (!out.piece === !out.style) throw new Error(USAGE);
  const ms = out.browser.timeoutMs;
  if (!Number.isSafeInteger(ms) || ms < 100 || ms > MAX_TIMEOUT_MS) throw new Error('film: --timeout-ms must be an integer from 100 to ' + MAX_TIMEOUT_MS);
  // Only an .mp4 is written, so a slip of the option never replaces a piece or its data.
  if (out.out !== null && !/\.mp4$/i.test(out.out)) throw new Error('film: --out must name an .mp4 file, got ' + out.out);
  return out;
}

/**
 * The piece to film and where its film goes: `{ name, external, file }`. A
 * registered example writes under the library's out/, an external piece beside
 * its module and a style as out/style-<name>.mp4, unless `--out` names the file,
 * relative to the caller's directory.
 */
function filmTarget(options, cwd = callerDirectory(), loadStyle = (name) => require('./styles.js').load(name)) {
  let external = null, name = options.piece;
  if (options.style) external = loadStyle(options.style);
  else if (isPiecePath(name)) external = loadExternal(name, cwd);
  else if (!Object.hasOwn(EXAMPLES, name)) throw new Error(`film: no example called "${name}". Known: ${Object.keys(EXAMPLES).join(', ')}`);
  if (external) name = external.names[0];
  const file = options.out !== null ? path.resolve(cwd, options.out)
    : external ? path.join(external.directory, external.stem + '.mp4') : path.join(ROOT, 'out', name + '.mp4');
  return { name, external, file };
}

// Serialized into the page. The page's own export of `name`, with `opts`
// ({ scale, bitrate }) passed through, and its file as base64.
async function exportInPage(name, opts) {
  const api = window.__artifex;
  api.select(name);
  const report = await api.film(opts);
  const bytes = new Uint8Array(await report.blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  delete report.blob;
  return { report, data: btoa(binary) };
}

/** Export `target`'s film in installed Edge; resolves to { browser, report, bytes }. */
async function exportFilm(target, film = {}, browser = {}) {
  const page = html(bundle(target.external), target.external ? { count: 1 } : {});
  return withEdge(page, browser, async (client, context) => {
    await waitFor(client, context, 'document.readyState === "complete" && !!window.__artifex');
    context.phase = 'film export ' + target.name;
    // The film comes back as base64, in pieces, since it passes the 4 MiB a reply may carry.
    const { report, data } = await evaluateInPieces(client, '(' + exportInPage.toString() + ')(' + JSON.stringify(target.name) + ', ' + JSON.stringify(film) + ')');
    if (context.errors.length) throw new Error('browser: page errors:\n' + context.errors.join('\n'));
    return { browser: context.version.Browser, report, bytes: Buffer.from(data, 'base64') };
  });
}

async function main(args = process.argv.slice(2), run = exportFilm, cwd = callerDirectory()) {
  const options = parseArgs(args);
  const target = filmTarget(options, cwd);
  const { browser, report, bytes } = await run(target, options.film, options.browser);
  // A film cut short in transfer is never written.
  if (bytes.length !== report.bytes) throw new Error(`film: ${bytes.length} of the film's ${report.bytes} bytes arrived; nothing was written`);
  fs.mkdirSync(path.dirname(target.file), { recursive: true });
  fs.writeFileSync(target.file, bytes);
  const reportFile = target.file + '.json';
  fs.writeFileSync(reportFile, JSON.stringify({ file: target.file, piece: target.name, browser, ...report }, null, 2) + '\n');
  console.log('film: ' + target.file + ': ' + filmNote(report) + ' Report: ' + reportFile);
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { parseArgs, filmTarget, exportInPage, exportFilm, main, TIMEOUT_MS };
