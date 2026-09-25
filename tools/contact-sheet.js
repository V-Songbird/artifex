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
//   npm run seeds -- --style impasto 9 0.5        a built-in style or a trusted pack, by name
//   npm run seeds -- readout --frames 9           a time strip: nine frames across the timeline
//   npm run seeds -- readout --at 0.5,2,3.25 --loupe   chosen seconds, each with a 100% crop

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { bundle, checkParses } = require('./build-page.js');
const EXAMPLES = require('../examples/index.js');
const { validate, atBox } = require('../core/piece.js');
const { playheads } = require('../core/render.js');
const { filmScale } = require('../core/film.js');
const { isPiecePath, loadExternal } = require('./piece-input.js');
const { load: loadStyle } = require('./styles.js');

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

// A time strip's cells are this many pixels wide unless --scale says otherwise,
// and as many columns as fit this many CSS pixels share a row.
const STRIP_CELL = 640, STRIP_WIDTH = 2048;

/**
 * A time strip of piece `p` at its own seed: `strip.frames` frames spread
 * from the first to the last, or the frames holding `strip.at` seconds. Each
 * cell is drawn at `strip.scale` pixels per design unit, 640 pixels wide by
 * default. `strip.loupe`, true or a design point { x, y }, adds a crop at 100%
 * of the film's default export scale around that point, the centre for true,
 * the size of a cell.
 */
function planStrip(p, strip) {
  if (!p.time) throw new Error(`seeds: ${p.name} is a still; a time strip needs a timeline`);
  const heads = playheads(p), hz = p.time.hz, n = heads.length;
  let frames;
  if (strip.at) {
    frames = strip.at.map((s) => {
      // A second belongs to the frame it falls in; the margin keeps 0.29 * 100 in frame 29.
      const frame = Math.floor(s * hz + 1e-6);
      if (!(s >= 0 && frame < n)) throw new Error(`seeds: --at ${s} is outside ${p.name}'s ${n / hz} s`);
      return frame;
    });
  } else {
    if (strip.frames > n) throw new Error(`seeds: --frames ${strip.frames} asks for more than ${p.name}'s ${n} frames`);
    frames = Array.from({ length: strip.frames }, (_, i) => Math.round((i * (n - 1)) / (strip.frames - 1)));
  }
  const scale = strip.scale || STRIP_CELL / p.size.w;
  const width = Math.max(1, Math.round(p.size.w * scale)), height = Math.max(1, Math.round(p.size.h * scale));
  const columns = Math.max(1, Math.min(frames.length, Math.floor((STRIP_WIDTH - 48 + 14) / (width + 2 + 14))));
  let loupe = null;
  if (strip.loupe) {
    const { x, y } = strip.loupe === true ? { x: p.size.w / 2, y: p.size.h / 2 } : strip.loupe;
    if (!(x >= 0 && x <= p.size.w && y >= 0 && y <= p.size.h)) {
      throw new Error(`seeds: --loupe ${x},${y} is outside ${p.name}'s ${p.size.w} x ${p.size.h} box`);
    }
    // The film's frame size, rounded to even pixels as the export rounds it.
    const k = filmScale(p), even = (v) => Math.max(2, 2 * Math.round(v / 2));
    const W = even(p.size.w * k), H = even(p.size.h * k), w = Math.min(width, W), h = Math.min(height, H);
    const clamp = (v, hi) => Math.min(Math.max(Math.round(v), 0), hi);
    loupe = { x, y, scale: k, W, H, w, h, sx: clamp(x * k - w / 2, W - w), sy: clamp(y * k - h / 2, H - h) };
  }
  const cells = frames.map((frame) => ({ seed: p.seed, params: {}, frame, t: heads[frame], seconds: frame / hz }));
  return { cells, frames: n, hz, scale, width, height, columns, loupe };
}

function pieceOf(name, external = null, box = null) {
  const pieces = external ? Object.fromEntries([[external.piece.name, external.piece]]) : EXAMPLES;
  if (!Object.hasOwn(pieces, name)) {
    throw new Error(`no example called "${name}". Known: ${Object.keys(EXAMPLES).join(', ')}`);
  }
  // A box the piece does not accept is refused here, by name, before a page is written.
  const p = validate(pieces[name]);
  return box ? atBox(p, box) : p;
}

function sheetPlans(names, count, paramNames = [], external = null, box = null, strip = null) {
  return names.map((name) => (strip ? planStrip(pieceOf(name, external, box), strip).cells
    : planSheet(pieceOf(name, external, box), count, paramNames)));
}

function page(names, count, t, paramNames = [], external = null, box = null, strip = null) {
  if (!Number.isFinite(t)) throw new Error('seeds: playhead must be a finite number');
  const layout = strip && planStrip(pieceOf(names[0], external, box), strip);
  const plans = layout ? [layout.cells] : sheetPlans(names, count, paramNames, external, box);
  const json = (value) => JSON.stringify(value).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Artifex — ${layout ? layout.cells.length + ' frames' : paramNames.length ? 'parameter sweep' : count + ' seeds'}</title>
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
  /* A strip shows every canvas pixel as one CSS pixel, its 1px border outside it. */
  .sheet.strip { grid-template-columns:repeat(var(--columns), calc(var(--cell) + 2px)); }
  .strip canvas { width:auto; }
  .strip figcaption + canvas { margin-top:10px; }
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
  var STRIP = ${json(layout && { ...layout, cells: undefined })};
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
      + (STRIP ? STRIP.frames + ' frames at ' + STRIP.hz + ' fps, ' + PLANS[0].length + ' shown at seed ' + p.seed
        + ', ' + STRIP.width + ' px wide (scale ' + +STRIP.scale.toFixed(4) + ')'
        + (STRIP.loupe ? ', each with a 100% crop of the ' + STRIP.loupe.W + ' \u00d7 ' + STRIP.loupe.H + ' film around ('
          + STRIP.loupe.x + ', ' + STRIP.loupe.y + ')' : '')
        : p.time ? render.playheads(p).length + ' frames, shown at t=' + T : 'a still')
      + ' \u00b7 ' + p.outputs.join(' + ');
    if (PARAMS.length) {
      note.textContent += ' \u00b7 seed ' + p.seed + ' fixed \u00b7 '
        + COUNT + ' samples per axis \u00b7 columns: ' + PARAMS[0]
        + (PARAMS.length === 2 ? ', rows: ' + PARAMS[1] : '')
        + ' (min to max). Scroll to compare all values.';
    }
    var sheet = document.createElement('div');
    sheet.className = STRIP ? 'sheet strip' : PARAMS.length ? 'sheet sweep' : 'sheet';
    if (PARAMS.length) sheet.style.setProperty('--columns', COUNT);
    if (STRIP) { sheet.style.setProperty('--columns', STRIP.columns); sheet.style.setProperty('--cell', STRIP.width + 'px'); }
    // The film's frame at its export scale, which each loupe is cut from.
    var film = STRIP && STRIP.loupe ? document.createElement('canvas') : null;
    if (film) { film.width = STRIP.loupe.W; film.height = STRIP.loupe.H; }
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
      var k = STRIP ? STRIP.scale : 480 / p.size.w;
      var when = STRIP ? 'frame ' + cell.frame + ' \u00b7 ' + cell.seconds.toFixed(3) + ' s' : '';
      c.width = STRIP ? STRIP.width : Math.round(p.size.w * k);
      c.height = STRIP ? STRIP.height : Math.round(p.size.h * k);
      c.setAttribute('role', 'img');
      c.setAttribute('aria-label', name + ', ' + (when || 'seed ' + seed) + (values ? ', ' + values : ''));
      var cap = document.createElement('figcaption');
      var label = document.createElement('div');
      label.className = 'values';
      label.textContent = when || values || 'seed ' + seed;
      var stats = document.createElement('div');
      cap.appendChild(label); cap.appendChild(stats);
      fig.appendChild(c); fig.appendChild(cap); sheet.appendChild(fig);
      var at = STRIP ? cell.t : T;
      var result = { name: name, seed: seed, params: cell.params, t: at, error: null };
      if (STRIP) { result.frame = cell.frame; result.seconds = cell.seconds; }
      results.push(result);
      try {
        var t0 = performance.now();
        var solved = piece.solve(p, seed, cell.params);
        result.buildMs = performance.now() - t0;
        if (solved.stages.error) throw new Error(solved.stages.error.stage + ': ' + solved.stages.error.message);
        result.params = solved.state.params;
        if (STRIP) {
          // The median of three draws, each forced by a one-pixel read so it times
          // rasterization, not submission. One draw alone caught a 100 ms pause on
          // the page's first cell that a redraw of the same frame never showed.
          var g = c.getContext('2d'), times = [];
          for (var r = 0; r < 3; r++) {
            g.clearRect(0, 0, c.width, c.height);
            var t1 = performance.now();
            render.drawFrame(g, p, solved, at, { scale: k });
            g.getImageData(0, 0, 1, 1);
            times.push(performance.now() - t1);
          }
          g.clearRect(0, 0, c.width, c.height);
          result.drawMs = times.sort(function (a, b) { return a - b; })[1];
        }
        Object.assign(result, measureFrame(c.getContext('2d'), function (surface) {
          result.t = render.drawFrame(surface, p, solved, at, { scale: k });
        }));
        result.rasterSize = { width: c.width, height: c.height };
        stats.textContent = result.markCount + ' marks \u00b7 bbox ' + (result.coverage * 100).toFixed(1)
          + '% \u00b7 build ' + result.buildMs.toFixed(1) + ' ms' + (STRIP ? ' \u00b7 draw ' + result.drawMs.toFixed(1) + ' ms' : '');
        if (film) {
          var L = STRIP.loupe, fg = film.getContext('2d');
          fg.clearRect(0, 0, L.W, L.H);
          render.drawFrame(fg, p, solved, at, { scale: L.scale });
          var crop = document.createElement('canvas');
          crop.width = L.w; crop.height = L.h;
          crop.getContext('2d').drawImage(film, L.sx, L.sy, L.w, L.h, 0, 0, L.w, L.h);
          crop.setAttribute('role', 'img');
          crop.setAttribute('aria-label', name + ', ' + when + ', 100% crop');
          var note100 = document.createElement('figcaption');
          note100.textContent = '100% of ' + L.W + ' \u00d7 ' + L.H + ', pixels ' + L.sx + ',' + L.sy + ' to ' + (L.sx + L.w) + ',' + (L.sy + L.h);
          fig.appendChild(crop); fig.appendChild(note100);
          result.loupe = { x: L.sx, y: L.sy, width: L.w, height: L.h, scale: L.scale };
        }
      } catch (e) {
        result.error = e.message;
        stats.className = 'bad';
        stats.textContent = 'seed ' + seed + ' \u2014 ' + e.message;
      }
    });
  });

  window.__sheet = { names: NAMES, count: COUNT, t: STRIP ? null : T, paramNames: PARAMS, cells: results, strip: STRIP,
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
  let seenParam = false, png = false, box = null, style = null;
  // A time strip: --frames or --at, and the --scale and --loupe it takes.
  let frames = null, times = null, scale = null, loupe = null;
  const once = (value, option) => { if (value !== null) throw new Error(`seeds: use ${option} only once`); };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--png') png = true;
    else if (arg === '--frames') {
      once(frames, arg);
      frames = Number(args[++i]);
      if (!Number.isSafeInteger(frames) || frames < 2) throw new Error('seeds: --frames needs a whole number of frames, 2 or more');
    }
    else if (arg === '--at') {
      once(times, arg);
      times = String(args[++i] || '').split(',').map((v) => (v.trim() ? Number(v) : NaN));
      if (!times.every(Number.isFinite)) throw new Error('seeds: --at needs seconds separated by commas, such as 0.5,2,3.25');
    }
    else if (arg === '--scale') {
      once(scale, arg);
      scale = Number(args[++i]);
      if (!(Number.isFinite(scale) && scale > 0)) throw new Error('seeds: --scale needs a positive number of pixels per design unit');
    }
    else if (arg === '--loupe') {
      once(loupe, arg);
      // An optional design point x,y; the centre without one.
      const m = /^(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/.exec(args[i + 1] || '');
      loupe = m ? { x: Number(m[1]), y: Number(m[2]) } : true;
      if (m) i++;
    }
    else if (arg === '--style') {
      if (style) throw new Error('seeds: use --style only once');
      style = args[++i];
      if (!style || style.startsWith('--')) throw new Error('seeds: --style needs a style name; npm run styles lists them');
    }
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
  if (positional.length > (style ? 2 : 3)) {
    throw new Error('usage: seeds [piece | --style <name>] [count] [playhead] [--param a[,b]] [--box WxH] [--png]'
      + ' | seeds <piece | --style <name>> (--frames N | --at s,s,...) [--scale k] [--loupe [x,y]] [--box WxH] [--png]');
  }
  const [which, n, t] = style ? [null, ...positional] : positional;
  const strip = frames !== null || times !== null ? { frames, at: times, scale, loupe } : null;
  if (!strip && (scale !== null || loupe !== null)) throw new Error('seeds: --scale and --loupe belong to a time strip; add --frames or --at');
  if (strip) {
    if (frames !== null && times !== null) throw new Error('seeds: a time strip takes --frames or --at, not both');
    if (paramNames.length) throw new Error('seeds: a time strip holds the seed and parameters; drop --param');
    if (!which && !style) throw new Error('seeds: name one piece for a time strip');
    if (n !== undefined) throw new Error('seeds: a time strip takes its frames from --frames or --at, not a count or playhead');
    return { names: style ? [] : [which], count: frames || times.length, at: 1, paramNames, png, box, style, strip };
  }
  if (paramNames.length && !which && !style) throw new Error('seeds: name one piece when using --param');
  if (box && !which && !style) throw new Error('seeds: name one piece when using --box');
  const names = style ? [] : which ? [which] : Object.keys(EXAMPLES);
  const count = n === undefined ? (paramNames.length ? 3 : 9) : Number(n);
  if (!Number.isSafeInteger(count) || count < (paramNames.length ? 2 : 1)) {
    throw new Error(`seeds: count must be an integer >= ${paramNames.length ? 2 : 1}, got ${n}`);
  }
  const at = t === undefined ? 1 : Number(t);
  if (!Number.isFinite(at)) throw new Error(`seeds: playhead must be a number, got ${t}`);
  return { names, count, at, paramNames, png, box, style };
}

/** The sheet's file, without extension: under out/, or beside an external piece. */
function sheetStem(names, paramNames, external, box = null, strip = null) {
  const out = external ? external.directory : path.join(ROOT, 'out');
  const suffix = (strip ? 'frames' : paramNames.length ? 'param-' + paramNames.map((key) => encodeURIComponent(key).replace(/\*/g, '%2A')).join('-') : 'seeds')
    + (box ? `-${box.w}x${box.h}` : '');
  return path.join(out, names.length === 1 ? `${external ? external.stem : names[0]}-${suffix}` : 'seeds');
}

/** CSS pixels a PNG of the sheet is wide: enough for every sweep or strip column, 1280 at least. */
function sheetWidth(count, paramNames, layout = null) {
  // 24 px of body padding each side, 220 px columns and 14 px gaps; a strip's
  // columns are its cells and their borders.
  if (layout) return Math.max(1280, 48 + layout.columns * (layout.width + 2) + (layout.columns - 1) * 14);
  return paramNames.length ? Math.max(1280, 48 + count * 220 + (count - 1) * 14) : 1280;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { count, at, paramNames, box, strip = null } = args;
  const external = args.style ? loadStyle(args.style)
    : args.names.length === 1 && isPiecePath(args.names[0]) ? loadExternal(args.names[0]) : null;
  const names = external ? external.names : args.names;
  const html = page(names, count, at, paramNames, external, box, strip);
  checkParses(html);
  const stem = sheetStem(names, paramNames, external, box, strip);
  const layout = strip && planStrip(pieceOf(names[0], external, box), strip);
  fs.mkdirSync(path.dirname(stem), { recursive: true });
  const file = stem + '.html';
  fs.writeFileSync(file, html);
  const shown = (target) => (external ? target : path.relative(ROOT, target));
  console.log(`${shown(file)}  ${(Buffer.byteLength(html) / 1024).toFixed(1)} kB`);
  const mode = layout ? `${count} of ${layout.frames} frames at seed ${layout.cells[0].seed}, ${layout.width} px wide${layout.loupe ? ', each with a 100% crop' : ''}`
    : (paramNames.length ? `${count} samples per axis (${count ** paramNames.length} cells), fixed seed` : `${count} seeds`) + ` at t=${at}`;
  console.log(`${names.length} piece(s) x ${mode}. Open it and LOOK -- the checks cannot see this half.`);
  if (!args.png) return undefined;
  const { captureSheet } = require('./check-browser.js');
  const cells = sheetPlans(names, count, paramNames, external, box, strip).reduce((sum, plan) => sum + plan.length, 0);
  return captureSheet(html, stem, { cells, width: sheetWidth(count, paramNames, layout) }).then(({ shots, failures }) => {
    for (const shot of shots) console.log(`${shown(shot.file)}  ${shot.width} x ${shot.height} px`);
    console.log(`${cells} cells, ${failures} failed. Open ${shots.length > 1 ? 'these images' : 'this image'} and look at every cell.`);
  });
}

if (require.main === module) {
  Promise.resolve().then(main).catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { page, parseArgs, planSheet, planStrip, pixelBounds, measureFrame, sheetPlans, sheetStem, sheetWidth };
