#!/usr/bin/env node
'use strict';

// Save one frame of a piece as a PNG or SVG from the command line, with its
// replay manifest, the file the page's PNG and SVG buttons save.
//
// A PNG is drawn by styles.drawPng in installed Edge, the page's own drawing,
// and an SVG by renderVector in Node; both carry the recipe npm run replay
// reads. This adds no drawing of its own.
//
//   npm run still -- specimen                        out/specimen.png
//   npm run still -- drift --out drift.svg           an SVG, beside the caller
//   npm run still -- readout --at 2 --seed 7         the frame holding 2 s of a film, at seed 7
//   npm run still -- refit --box 405x720             at another box the piece declares
//   npm run still -- ./game.cjs --session game-1.session.json --at 2   a saved session's frame at 2 s
//
// Prints one line naming the file and its recipe. A PNG of a piece that paints
// on a medium sheet adds one line per sheet: its stroke log's monotony report
// (docs/apis/medium.md#the-stroke-log), numbers only.

const fs = require('node:fs');
const path = require('node:path');

const EXAMPLES = require('../examples/index.js');
const { validate, atBox } = require('../core/piece.js');
const { renderVector, playheads } = require('../core/render.js');
const { timeoutArg } = require('./check-browser.js');
const { callerDirectory, shown, quote, hint, resolvePiece, sessionInput, keepSessionBeside } = require('./piece-input.js');

const USAGE = 'usage: npm run still -- <piece | ./piece.cjs> [--out file.png|file.svg] [--seed n] [--at s] [--scale k] [--box WxH]'
  + ' [--session file.session.json] [--edge PATH] [--timeout-ms N] [--headed]';
/** A refused argument: its cause, then the usage line. */
const refuse = (cause) => new Error('still: ' + cause + '\n' + USAGE);

function parseArgs(args) {
  const out = { piece: null, style: null, out: null, seed: null, at: 0, scale: null, box: null, session: null, browser: {} };
  const value = (i) => {
    if (args[i + 1] === undefined || args[i + 1].startsWith('--')) throw refuse(args[i] + ' needs a value');
    return args[i + 1];
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--out') out.out = value(i++);
    else if (a === '--style') out.style = value(i++);
    else if (a === '--seed') {
      const text = value(i++), n = Number(text);
      if (!/^\d+$/.test(text) || n > 0xffffffff) throw refuse('--seed takes a whole number from 0 to 4294967295, got ' + text);
      out.seed = n;
    }
    else if (a === '--at' || a === '--scale') {
      const n = Number(value(i));
      if (!(Number.isFinite(n) && (a === '--at' ? n >= 0 : n > 0))) throw refuse(a + ' must be a ' + (a === '--at' ? 'number of seconds, 0 or more' : 'positive number') + ', got ' + args[i + 1]);
      out[a.slice(2)] = n;
      i++;
    }
    // A box written as npm run seeds takes it; stillTarget refuses one the piece cannot draw.
    else if (a === '--box') {
      if (out.box) throw refuse('give --box only once');
      const m = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(value(i++));
      if (!m) throw refuse('--box needs a box as WIDTHxHEIGHT, such as 405x720');
      out.box = { w: Number(m[1]), h: Number(m[2]) };
    }
    // An interactive piece's saved session; stillTarget reads and checks it.
    else if (a === '--session') {
      if (out.session) throw refuse('give --session only once');
      out.session = value(i++);
    }
    else if (a === '--edge') out.browser.edge = value(i++);
    else if (a === '--timeout-ms') out.browser.timeoutMs = timeoutArg(value(i++), refuse, { max: 3600000 });
    else if (a === '--headed') out.browser.headed = true;
    else if (a.startsWith('--')) throw refuse('unknown option ' + a);
    else if (out.piece) throw refuse('one piece per still, got "' + out.piece + '" and "' + a + '"');
    else out.piece = a;
  }
  if (!out.piece && !out.style) throw refuse('name the piece to draw: an example or ./piece.cjs');
  if (out.piece && out.style) throw refuse('give a piece or --style, not both; got "' + out.piece + '" and --style ' + out.style);
  // Only a .png or .svg is written, so a slip of the option never replaces a piece or its data.
  if (out.out !== null && !/\.(png|svg)$/i.test(out.out)) throw refuse('--out must name a .png or .svg file, got ' + out.out);
  out.svg = out.out !== null && /\.svg$/i.test(out.out);
  if (out.svg && out.scale !== null) throw refuse('--scale sets a PNG\'s pixels; an SVG is drawn at the design box');
  return out;
}

/**
 * The piece to draw and where its file goes: `{ name, external, piece, file, t }`,
 * `t` the playhead of the frame holding `--at` seconds. The file lands where
 * npm run film puts a film, with .png or .svg for .mp4. `--style` is refused
 * with where the style's guide and mark functions are, since a style is no piece.
 */
function stillTarget(options, cwd = callerDirectory()) {
  const resolved = resolvePiece(options, cwd, refuse, '.png');
  const { name, external } = resolved;
  let piece = validate(external ? external.piece : EXAMPLES[name]), file = resolved.file, session = null;
  // A saved session's frame is a frame of its film, one a tick, named after the session.
  if (options.session) {
    if (options.box) throw refuse('give --box or --session, not both: a session plays at the box it was played at');
    session = sessionInput(options, cwd, refuse, piece, file);
    piece = session.film;
    file = session.output;
  }
  if (piece.play && options.at !== 0) throw refuse(`${name} is interactive, so --at reads a saved session's time; pass --session <file> as the page's save session wrote it`);
  // A box the piece does not declare is refused by name, with the boxes it takes.
  if (options.box) {
    try { piece = atBox(piece, options.box); } catch (e) { throw refuse(e.message.replace(/^atBox: /, '')); }
  }
  if (options.svg && !piece.outputs.includes('vector')) throw refuse(`${name} declares raster only, so it has no SVG; save a PNG`);
  // A second belongs to the frame it falls in, as in a time strip's --at.
  const heads = playheads(piece), frame = Math.floor(options.at * (piece.time ? piece.time.hz : 0) + 1e-6);
  if (!piece.time && options.at !== 0) throw refuse(`${name} is a still; --at 0 is its one frame`);
  if (frame >= heads.length) throw refuse(`--at ${options.at} is outside ${name}'s ${heads.length / piece.time.hz} s`);
  return { name, external, piece, file, t: heads[frame], ...(session && { session }) };
}

/** Draw `target`'s frame: resolves to { bytes, manifest }. `edge` stands in for withEdge in tests. */
async function drawStill(target, options, edge) {
  const seed = options.seed ?? target.piece.seed;
  if (options.svg) {
    const r = renderVector(target.piece, { seed, t: target.t });
    return { bytes: Buffer.from(r.svg, 'utf8'), manifest: r.manifest };
  }
  const width = target.piece.size.w * (options.scale ?? 1);
  const session = target.session ? { file: target.session.file, name: target.session.name } : null;
  // A warm Edge from npm run edge -- start, when one runs; a session changes the page, so it goes cold.
  const inEdge = edge ?? (session ? undefined : require('./warm-edge.js').warmEdge);
  return require('./styles.js').pngInEdge(target.external, target.name, seed, target.t, width, options.browser, options.box, inEdge, 'still', session, true);
}

// One line per painting-medium sheet: how alike its marks are, as numbers.
function monotonyLines(reports = []) {
  return reports.map((m, i) => `stroke log${reports.length > 1 ? ' ' + (i + 1) : ''}: ${m.calls} calls (stroke ${m.stroke}, paint ${m.paint}); `
    + `narrowness, 0 varied to 1 all alike: ${Object.entries(m.narrowness).filter(([, v]) => v !== null).map(([k, v]) => k + ' ' + v).join(', ') || 'none'}; `
    + `mean ${m.mean}; shorter than 1.5 widths ${m.short}`);
}

async function main(args = process.argv.slice(2), draw = drawStill, cwd = callerDirectory()) {
  if (args.includes('--help') || args.includes('-h')) return console.log(USAGE);
  const options = parseArgs(args);
  const target = stillTarget(options, cwd);
  const { bytes, manifest, monotony } = await draw(target, options);
  fs.mkdirSync(path.dirname(target.file), { recursive: true });
  fs.writeFileSync(target.file, bytes);
  // Replay reads a session's frame beside the session it was played from.
  if (target.session) keepSessionBeside(target.session);
  // A film's frame says which one it is and where the whole film comes from.
  const frame = target.piece.time ? `, the frame at ${options.at} s; npm run film saves the whole film` : '';
  // Replay finds a registered example itself, and needs to be told an external piece.
  // Replay resolves both paths from the caller's directory, so the hint does too.
  const here = (file) => shown(file, cwd);
  const from = target.external ? ['--piece', quote(here(target.external.entry))] : [];
  console.log(`still: ${shown(target.file)}: ${manifest.piece} seed ${manifest.seed}${options.box ? ` at box ${manifest.size.w}x${manifest.size.h}` : ''}${manifest.scale ? ' at scale ' + manifest.scale : ''}${frame}. Check it with ${hint('replay', quote(here(target.file)), ...from)}`);
  for (const line of monotonyLines(monotony)) console.log(line);
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { parseArgs, stillTarget, drawStill, main };
