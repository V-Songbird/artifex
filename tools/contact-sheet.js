#!/usr/bin/env node
'use strict';

// Compare seeds or declared parameter ranges on one self-contained page.
//
// Compare multiple seeds to inspect compositional variation and robustness.
// Automated checks do not establish whether each composition reads clearly.
//
// It renders live on canvases rather than writing SVG, so it works for a piece
// that declares raster only -- which is exactly the piece you cannot otherwise
// look at outside a browser.
//
//   npm run seeds                 every example, nine seeds each
//   npm run seeds drift           one piece
//   npm run seeds drift 16 0.5    sixteen seeds, at a playhead of 0.5
//   npm run seeds -- drift 5 --param reach       five values, fixed seed
//   npm run seeds -- drift 3 --param reach,turn  a three-by-three grid
//   npm run seeds -- drift 9 0.5 --png            also a PNG of the sheet, from installed Edge
//   npm run seeds -- refit 9 1 --box 405x720      at another box the piece declares

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { bundle, checkParses } = require('./build-page.js');
const EXAMPLES = require('../examples/index.js');
const { validate, atBox } = require('../core/piece.js');
const { isPiecePath, loadExternal } = require('./piece-input.js');

function planSheet(p, count, paramNames = []) {
  if (!Number.isSafeInteger(count) || count < (paramNames.length ? 2 : 1)) {
    throw new Error(`seeds: count must be an integer >= ${paramNames.length ? 2 : 1}`);
  }
  if (paramNames.length > 2 || new Set(paramNames).size !== paramNames.length) {
    throw new Error('seeds: --param needs one or two distinct parameter names');
  }
  for (const key of paramNames) {
    if (!Object.hasOwn(p.params, key)) {
      throw new Error(`seeds: unknown parameter "${key}" for ${p.name}. Declared: ${Object.keys(p.params).join(', ') || '(none)'}`);
    }
  }
  const sample = (key, index) => {
    const { min, max } = p.params[key];
    if (index === 0) return min;
    if (index === count - 1) return max;
    const u = index / (count - 1);
    return min * (1 - u) + max * u;
  };
  const rows = paramNames.length === 2 ? count : 1;
  const cells = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < count; x++) {
      const params = Object.fromEntries(paramNames.map((key, axis) => [key, sample(key, axis ? y : x)]));
      cells.push({ seed: paramNames.length ? p.seed : x + 1, params });
    }
  }
  return cells;
}

// Final nontransparent pixels, including painted backgrounds. This is a
// raster bounding box, not foreground segmentation or an aesthetic score.
function pixelBounds({ data, width, height }) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!data[(y * width + x) * 4 + 3]) continue;
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
  }
  const bbox = right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
  return { bbox, coverage: bbox ? bbox.width * bbox.height / (width * height) : 0 };
}

// Forward to the real canvas so clipping, curves and compositing keep their
// native behavior. A mark means a paint call, even if it paints no pixels.
function measureFrame(ctx, draw) {
  const paint = new Set(['fill', 'stroke', 'fillRect', 'strokeRect', 'drawImage', 'fillText', 'strokeText', 'putImageData']);
  const methods = new Map();
  let markCount = 0;
  const surface = new Proxy(ctx, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      if (!methods.has(key)) methods.set(key, (...args) => {
        const result = value.apply(target, args);
        if (paint.has(key)) markCount++;
        return result;
      });
      return methods.get(key);
    },
    set(target, key, value) { return Reflect.set(target, key, value, target); },
  });
  draw(surface);
  const { width, height } = ctx.canvas;
  return { markCount, ...pixelBounds(ctx.getImageData(0, 0, width, height)) };
}

function sheetPlans(names, count, paramNames = [], external = null, box = null) {
  const pieces = external ? Object.fromEntries([[external.piece.name, external.piece]]) : EXAMPLES;
  return names.map((name) => {
    if (!Object.hasOwn(pieces, name)) {
      throw new Error(`no example called "${name}". Known: ${Object.keys(EXAMPLES).join(', ')}`);
    }
    // A box the piece does not accept is refused here, by name, before a page is written.
    const p = validate(pieces[name]);
    return planSheet(box ? atBox(p, box) : p, count, paramNames);
  });
}

function page(names, count, t, paramNames = [], external = null, box = null) {
  if (!Number.isFinite(t)) throw new Error('seeds: playhead must be a finite number');
  const plans = sheetPlans(names, count, paramNames, external, box);
  const json = (value) => JSON.stringify(value).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Artifex — ${paramNames.length ? 'parameter sweep' : count + ' seeds'}</title>
<style>
  :root { --bg:#14151a; --fg:#e7e4dc; --dim:#8e8f99; --line:#2e313b;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  body { margin:0; padding:24px; background:var(--bg); color:var(--fg); font-size:12px; }
  h2 { font-size:12px; letter-spacing:.16em; text-transform:uppercase; margin:32px 0 4px;
       border-top:1px solid var(--line); padding-top:14px; }
  h2:first-of-type { margin-top:0; border-top:0; padding-top:0; }
  .note { color:var(--dim); margin:0 0 14px; }
  .knobs { color:var(--dim); margin:-10px 0 14px; padding-left:16px; line-height:1.7; }
  .knobs b { color:var(--fg); font-weight:normal; }
  .sheet { display:grid; grid-template-columns:repeat(auto-fill, minmax(240px, 1fr)); gap:14px; }
  .sheet.sweep { grid-template-columns:repeat(var(--columns), minmax(220px, 1fr)); }
  .viewport { overflow-x:auto; padding-bottom:10px; scrollbar-color:var(--dim) var(--bg); }
  .viewport:focus-visible { outline:2px solid var(--fg); outline-offset:4px; }
  figure { margin:0; min-width:0; }
  canvas { width:100%; box-sizing:border-box; display:block; background:#fff; border:1px solid var(--line); }
  figcaption { color:var(--dim); margin-top:7px; line-height:1.6; font-variant-numeric:tabular-nums; }
  .values { color:var(--fg); overflow-wrap:anywhere; }
  .legend { color:var(--dim); max-width:75ch; line-height:1.6; }
  .bad { color:#e8705a; white-space:pre-wrap; }
  @media (max-width:600px) { body { padding:16px; } }
</style>
</head>
<body>
<div id="out"></div>
<p class="legend">Marks count paint calls. Bbox is the bounding-box area of painted pixels,
including backgrounds, as a percentage of the canvas. Build time excludes drawing.
These diagnostics do not measure artistic quality.</p>
<script>
${bundle(external)}
${pixelBounds.toString()}
${measureFrame.toString()}
(function () {
  var req = __require('');
  var piece = req('core/piece.js');
  var render = req('core/render.js');
  var EX = req('examples/index.js');
  var NAMES = ${json(names)};
  var PARAMS = ${json(paramNames)};
  var PLANS = ${json(plans)};
  var COUNT = ${count};
  var T = ${t};
  var BOX = ${json(box)};
  var out = document.getElementById('out');
  var results = [];

  NAMES.forEach(function (name, nameIndex) {
    var p = piece.validate(EX[name]);
    if (BOX) p = piece.atBox(p, BOX);
    var h2 = document.createElement('h2');
    h2.textContent = name;
    var note = document.createElement('p');
    note.className = 'note';
    note.textContent = p.size.w + ' \u00d7 ' + p.size.h + ' \u00b7 '
      + (p.time ? render.playheads(p).length + ' frames, shown at t=' + T : 'a still')
      + ' \u00b7 ' + p.outputs.join(' + ');
    if (PARAMS.length) {
      note.textContent += ' \u00b7 seed ' + p.seed + ' fixed \u00b7 '
        + COUNT + ' samples per axis \u00b7 columns: ' + PARAMS[0]
        + (PARAMS.length === 2 ? ', rows: ' + PARAMS[1] : '')
        + ' (min to max). Scroll to compare all values.';
    }
    var sheet = document.createElement('div');
    sheet.className = PARAMS.length ? 'sheet sweep' : 'sheet';
    if (PARAMS.length) sheet.style.setProperty('--columns', COUNT);
    out.appendChild(h2); out.appendChild(note);
    // Keep the meanings and held defaults next to the comparison.
    var keys = Object.keys(p.params);
    if (keys.length) {
      var knobs = document.createElement('ul');
      knobs.className = 'knobs';
      keys.forEach(function (k) {
        var d = p.params[k];
        var li = document.createElement('li');
        var nm = document.createElement('b');
        nm.textContent = k + (PARAMS.includes(k) ? ' (swept)' : ' ' + d.value);
        li.appendChild(nm);
        li.appendChild(document.createTextNode(
          ' \u00b7 ' + d.meaning + ' [' + d.min + '..' + d.max + ']'));
        knobs.appendChild(li);
      });
      out.appendChild(knobs);
    }
    var viewport = document.createElement('div');
    viewport.className = 'viewport';
    if (PARAMS.length) {
      viewport.tabIndex = 0;
      viewport.setAttribute('role', 'region');
      viewport.setAttribute('aria-label', name + ' parameter comparison');
    }
    viewport.appendChild(sheet); out.appendChild(viewport);

    PLANS[nameIndex].forEach(function (cell) {
      var seed = cell.seed;
      var values = PARAMS.map(function (key) { return key + '=' + cell.params[key]; }).join(' \u00b7 ');
      var fig = document.createElement('figure');
      var c = document.createElement('canvas');
      var k = 480 / p.size.w;
      c.width = Math.round(p.size.w * k);
      c.height = Math.round(p.size.h * k);
      c.setAttribute('role', 'img');
      c.setAttribute('aria-label', name + ', seed ' + seed + (values ? ', ' + values : ''));
      var cap = document.createElement('figcaption');
      var label = document.createElement('div');
      label.className = 'values';
      label.textContent = values || 'seed ' + seed;
      var stats = document.createElement('div');
      cap.appendChild(label); cap.appendChild(stats);
      fig.appendChild(c); fig.appendChild(cap); sheet.appendChild(fig);
      var result = { name: name, seed: seed, params: cell.params, t: T, error: null };
      results.push(result);
      try {
        var t0 = performance.now();
        var solved = piece.solve(p, seed, cell.params);
        result.buildMs = performance.now() - t0;
        if (solved.stages.error) throw new Error(solved.stages.error.stage + ': ' + solved.stages.error.message);
        result.params = solved.state.params;
        Object.assign(result, measureFrame(c.getContext('2d'), function (surface) {
          result.t = render.drawFrame(surface, p, solved, T, { scale: k });
        }));
        result.rasterSize = { width: c.width, height: c.height };
        stats.textContent = result.markCount + ' marks \u00b7 bbox ' + (result.coverage * 100).toFixed(1)
          + '% \u00b7 build ' + result.buildMs.toFixed(1) + ' ms';
      } catch (e) {
        result.error = e.message;
        stats.className = 'bad';
        stats.textContent = 'seed ' + seed + ' \u2014 ' + e.message;
      }
    });
  });

  window.__sheet = { names: NAMES, count: COUNT, t: T, paramNames: PARAMS, cells: results,
    failures: function () { return document.querySelectorAll('.bad').length; } };
})();
</script>
</body>
</html>
`;
}

function parseArgs(args) {
  const positional = [];
  let paramNames = [];
  let seenParam = false, png = false, box = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--png') png = true;
    else if (arg === '--box') {
      if (box) throw new Error('seeds: use --box only once');
      const m = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(args[++i] || '');
      if (!m) throw new Error('seeds: --box needs a box as WIDTHxHEIGHT, such as 405x720');
      box = { w: Number(m[1]), h: Number(m[2]) };
    }
    else if (arg === '--param' || arg.startsWith('--param=')) {
      if (seenParam) throw new Error('seeds: use --param only once');
      seenParam = true;
      const value = arg === '--param' ? args[++i] : arg.slice(8);
      if (!value || value.startsWith('--')) throw new Error('seeds: --param needs one or two comma-separated names');
      paramNames = value.split(',').map((key) => key.trim());
      if (paramNames.some((key) => !key) || paramNames.length > 2 || new Set(paramNames).size !== paramNames.length) {
        throw new Error('seeds: --param needs one or two distinct parameter names');
      }
    } else if (arg.startsWith('--')) throw new Error(`seeds: unknown option ${arg}`);
    else positional.push(arg);
  }
  if (positional.length > 3) throw new Error('usage: seeds [piece] [count] [playhead] [--param a[,b]] [--box WxH] [--png]');
  const [which, n, t] = positional;
  if (paramNames.length && !which) throw new Error('seeds: name one piece when using --param');
  if (box && !which) throw new Error('seeds: name one piece when using --box');
  const names = which ? [which] : Object.keys(EXAMPLES);
  const count = n === undefined ? (paramNames.length ? 3 : 9) : Number(n);
  if (!Number.isSafeInteger(count) || count < (paramNames.length ? 2 : 1)) {
    throw new Error(`seeds: count must be an integer >= ${paramNames.length ? 2 : 1}, got ${n}`);
  }
  const at = t === undefined ? 1 : Number(t);
  if (!Number.isFinite(at)) throw new Error(`seeds: playhead must be a number, got ${t}`);
  return { names, count, at, paramNames, png, box };
}

/** The sheet's file, without extension: under out/, or beside an external piece. */
function sheetStem(names, paramNames, external, box = null) {
  const out = external ? external.directory : path.join(ROOT, 'out');
  const suffix = (paramNames.length ? 'param-' + paramNames.map((key) => encodeURIComponent(key).replace(/\*/g, '%2A')).join('-') : 'seeds')
    + (box ? `-${box.w}x${box.h}` : '');
  return path.join(out, names.length === 1 ? `${external ? external.stem : names[0]}-${suffix}` : 'seeds');
}

/** CSS pixels a PNG of the sheet is wide: enough for every sweep column, 1280 at least. */
function sheetWidth(count, paramNames) {
  // 24 px of body padding each side, 220 px columns and 14 px gaps.
  return paramNames.length ? Math.max(1280, 48 + count * 220 + (count - 1) * 14) : 1280;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { count, at, paramNames, box } = args;
  const external = args.names.length === 1 && isPiecePath(args.names[0]) ? loadExternal(args.names[0]) : null;
  const names = external ? external.names : args.names;
  const html = page(names, count, at, paramNames, external, box);
  checkParses(html);
  const stem = sheetStem(names, paramNames, external, box);
  fs.mkdirSync(path.dirname(stem), { recursive: true });
  const file = stem + '.html';
  fs.writeFileSync(file, html);
  const shown = (target) => (external ? target : path.relative(ROOT, target));
  console.log(`${shown(file)}  ${(Buffer.byteLength(html) / 1024).toFixed(1)} kB`);
  const mode = paramNames.length ? `${count} samples per axis (${count ** paramNames.length} cells), fixed seed` : `${count} seeds`;
  console.log(`${names.length} piece(s) x ${mode} at t=${at}. Open it and LOOK -- the checks cannot see this half.`);
  if (!args.png) return undefined;
  const { captureSheet } = require('./check-browser.js');
  const cells = sheetPlans(names, count, paramNames, external, box).reduce((sum, plan) => sum + plan.length, 0);
  return captureSheet(html, stem, { cells, width: sheetWidth(count, paramNames) }).then(({ shots, failures }) => {
    for (const shot of shots) console.log(`${shown(shot.file)}  ${shot.width} x ${shot.height} px`);
    console.log(`${cells} cells, ${failures} failed. Open ${shots.length > 1 ? 'these images' : 'this image'} and look at every cell.`);
  });
}

if (require.main === module) {
  Promise.resolve(main()).catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { page, parseArgs, planSheet, pixelBounds, measureFrame, sheetPlans, sheetStem, sheetWidth };
