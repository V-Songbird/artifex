#!/usr/bin/env node
'use strict';

// Build one self-contained HTML file: the live backend, the raster backend and
// the transport, around whichever pieces are handed to it.
//
// WHY A BUILD STEP RATHER THAN A DIFFERENT MODULE FORMAT. The single-file
// constraint is a DELIVERY target, not an authoring constraint. The core stays
// plain CommonJS that `node --test` runs directly, and this file pays the one
// cost of making it reachable from a browser. The second architecture this
// project imported from arrived at the same split and it is the right trade.
//
// No dependencies, node: built-ins only.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
/**
 * The modules to bundle, DISCOVERED rather than listed.
 *
 * This was a hand-maintained array, which made it a second place that had to
 * agree with examples/index.js. When it did not, the build printed a success
 * line and exited 0, and the page then threw
 *
 *     Uncaught Error: module not bundled: examples/<name>.js
 *
 * on load and rendered NOTHING -- not just the new piece, every piece -- while
 * the test suite, the mutation suite, the lint and the example renderer all
 * stayed green. Four of five authors adding an example hit it. The one artefact
 * a human actually looks at was the one with no check on it.
 *
 * A list cannot disagree with the directory it is derived from.
 */
function modules() {
  const files = (dir) => fs.readdirSync(path.join(ROOT, dir))
    .filter((f) => f.endsWith('.js'))
    .sort()
    .map((f) => dir + '/' + f);
  // index.js last: it requires the others.
  return [
    ...files('core'),
    ...files('examples').filter((f) => f !== 'examples/index.js'),
    'examples/index.js',
  ];
}

const MODULES = modules();

/**
 * Resolve every require inside every bundled module exactly as the page's own
 * __resolve does, and refuse to write a bundle with a hole in it.
 *
 * Discovery above removes the fault class; this catches what discovery cannot:
 * a typo, or a module reaching outside the bundled directories. A build that
 * cannot produce a working page must say so instead of exiting 0.
 */
function checkResolvable(ids) {
  const have = new Set(ids);
  const resolve = (from, spec) => {
    if (spec[0] !== '.') return spec;
    const base = from.split('/').slice(0, -1);
    for (const part of spec.split('/')) {
      if (part === '.') continue;
      else if (part === '..') base.pop();
      else base.push(part);
    }
    return base.join('/');
  };
  const bad = [];
  for (const id of ids) {
    const src = fs.readFileSync(path.join(ROOT, id), 'utf8');
    for (const m of src.matchAll(/require\('([^']+)'\)/g)) {
      if (m[1].startsWith('node:')) continue;
      const target = resolve(id, m[1]);
      if (!have.has(target)) bad.push(id + ' requires ' + m[1] + ' -> ' + target + ', which is not bundled');
    }
  }
  if (bad.length) {
    throw new Error('build: this page would throw on load and render nothing.\n  ' + bad.join('\n  '));
  }
}

function wrap(rel) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  // A module containing a literal </script would end the tag early and the page
  // would be silently truncated. Refuse rather than ship half a file.
  if (/<\/script/i.test(src)) throw new Error(`build: ${rel} contains a literal </script`);
  return `__def(${JSON.stringify(rel)}, function (module, exports, require) {\n${src}\n});`;
}

const RUNTIME = `
var __mods = {}, __cache = {};
function __def(id, fn) { __mods[id] = fn; }
function __resolve(from, spec) {
  if (spec[0] !== '.') return spec;
  var base = from.split('/').slice(0, -1);
  for (var i = 0, p = spec.split('/'); i < p.length; i++) {
    if (p[i] === '.') continue;
    else if (p[i] === '..') base.pop();
    else base.push(p[i]);
  }
  return base.join('/');
}
function __require(from) {
  return function (spec) {
    var id = __resolve(from, spec);
    if (__cache[id]) return __cache[id].exports;
    var fn = __mods[id];
    if (!fn) throw new Error('module not bundled: ' + id + ' (from ' + from + ')');
    var m = __cache[id] = { exports: {} };
    fn(m, m.exports, __require(id));
    return m.exports;
  };
}
`;

function html(bundle) {
  // Counted, never written out: the word "Five" shipped in the delivered page
  // for as long as there were five examples, and stayed there when there were six.
  const count = MODULES.filter((m) => m.startsWith('examples/')
    && m !== 'examples/index.js' && m !== 'examples/stroke-font.js').length;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Artifex examples</title>
<style>
  :root {
    --bg: #14151a; --panel: #1c1e25; --line: #2e313b;
    --fg: #e7e4dc; --dim: #8e8f99; --accent: #d8a24a;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font-size: 13px; }
  .wrap { display: flex; min-height: 100vh; }
  aside { width: 320px; flex: none; background: var(--panel); border-right: 1px solid var(--line);
          padding: 18px; overflow-y: auto; height: 100vh; position: sticky; top: 0; }
  main { flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px; min-width: 0; }
  canvas { max-width: 100%; max-height: calc(100vh - 48px); background: #fff;
           box-shadow: 0 10px 40px rgba(0,0,0,.5); }
  h1 { font-size: 13px; letter-spacing: .18em; margin: 0 0 4px; text-transform: uppercase; }
  .sub { color: var(--dim); margin: 0 0 18px; line-height: 1.5; font-size: 11px; }
  .group { border-top: 1px solid var(--line); padding-top: 14px; margin-top: 14px; }
  .label { color: var(--dim); text-transform: uppercase; letter-spacing: .12em; font-size: 10px; margin-bottom: 8px; }
  button { font: inherit; background: #262932; color: var(--fg); border: 1px solid var(--line);
           padding: 6px 10px; cursor: pointer; border-radius: 3px; }
  button:hover:not(:disabled) { border-color: var(--accent); }
  button:disabled { opacity: .35; cursor: not-allowed; }
  button.on { background: var(--accent); color: #14151a; border-color: var(--accent); }
  .pieces { display: grid; gap: 6px; }
  .pieces button { text-align: left; }
  .pieces .kind { color: var(--dim); font-size: 10px; display: block; margin-top: 2px; }
  .pieces button.on .kind { color: #14151a; opacity: .75; }
  .row { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
  input[type=number] { font: inherit; width: 100px; background: #262932; color: var(--fg);
                       border: 1px solid var(--line); padding: 5px 7px; border-radius: 3px; }
  input[type=range] { width: 100%; accent-color: var(--accent); }
  .facts { color: var(--dim); line-height: 1.7; font-size: 11px; }
  .facts b { color: var(--fg); font-weight: normal; }
  .note { color: var(--dim); font-size: 10px; line-height: 1.5; margin-top: 8px; }
  .err { color: #e8705a; white-space: pre-wrap; line-height: 1.5; font-size: 11px; }
</style>
</head>
<body>
<div class="wrap">
  <aside>
    <h1>Artifex</h1>
    <p class="sub">${count} idioms that break each other's assumptions. The seed
    and the playhead are the only inputs.</p>

    <div class="pieces" id="pieces"></div>

    <div class="group">
      <div class="label">Seed</div>
      <div class="row">
        <input type="number" id="seed" min="0" step="1">
        <button id="reroll">re-roll</button>
      </div>
      <div class="label" style="margin-top:12px">Playhead</div>
      <div class="row">
        <button id="play">play</button>
        <span id="tread" class="facts"></span>
      </div>
      <input type="range" id="t" min="0" max="1000" value="0">
    </div>

    <div class="group" id="paramsGroup" hidden>
      <div class="label">Declared parameters</div>
      <div id="params"></div>
    </div>

    <div class="group">
      <div class="label">Outputs</div>
      <div class="row">
        <button data-png="1">PNG 1x</button>
        <button data-png="4">PNG 4x</button>
        <button data-png="8">PNG 8x</button>
      </div>
      <div class="row"><button id="svg">SVG</button></div>
      <div class="note" id="svgnote"></div>
    </div>

    <div class="group">
      <div class="label">Measured</div>
      <div class="facts" id="facts"></div>
      <div class="err" id="err"></div>
    </div>
  </aside>
  <main><canvas id="c"></canvas></main>
</div>

<script>
// Everything is inside one function. window.__artifex is the ONLY global the
// page publishes, because the moment a page hands out a test hook, someone
// drives it from a console script -- and a bare top-level "var render" is
// clobbered by the first helper of that name. That happened within minutes of
// the hook existing, and it looked exactly like a library bug.
(function () {
${RUNTIME}
${bundle}

var __req = __require('');
var piece = __req('core/piece.js');
var render = __req('core/render.js');
var vector = __req('core/surface-vector.js');
var EXAMPLES = __req('examples/index.js');

var names = Object.keys(EXAMPLES);
var current = null, currentName = null, solved = null, t = 0, playing = false, overrides = {}, raf = 0;
var c = document.getElementById('c'), ctx = c.getContext('2d');
var facts = document.getElementById('facts'), err = document.getElementById('err');

function kindOf(p) {
  return (p.time ? Math.round(p.time.duration * p.time.hz) + ' frames' : 'a still')
    + ' \\u00b7 ' + p.outputs.join(' + ');
}

var box = document.getElementById('pieces');
names.forEach(function (n) {
  var b = document.createElement('button');
  b.innerHTML = n + '<span class="kind">' + kindOf(piece.validate(EXAMPLES[n])) + '</span>';
  b.onclick = function () { select(n); };
  b.dataset.name = n;
  box.appendChild(b);
});

function select(name) {
  stop();
  err.textContent = '';
  // The piece is never decorated. playheads() validates whatever it is handed
  // and a stowaway key is refused BY NAME -- which is the contract working, so
  // the name lives beside the piece rather than on it.
  current = piece.validate(EXAMPLES[name]);
  currentName = name;
  overrides = {};
  document.getElementById('seed').value = current.seed;
  c.width = current.size.w;
  c.height = current.size.h;
  t = current.time ? 0 : 0;
  document.getElementById('t').value = 0;
  document.getElementById('t').disabled = !current.time;
  document.getElementById('play').disabled = !current.time;
  var can = current.outputs.indexOf('vector') >= 0;
  document.getElementById('svg').disabled = !can;
  document.getElementById('svgnote').textContent = can
    ? 'Declared vector: any raster call would throw by name rather than vanish.'
    : 'This piece declares raster only, and means it. Asking for SVG is refused rather than answered with half a picture.';
  Array.prototype.forEach.call(box.children, function (b) { b.classList.toggle('on', b.dataset.name === name); });
  buildParams();
  resolve();
}

function buildParams() {
  var host = document.getElementById('params');
  var keys = Object.keys(current.params);
  document.getElementById('paramsGroup').hidden = keys.length === 0;
  host.innerHTML = '';
  keys.forEach(function (k) {
    var d = current.params[k];
    var lab = document.createElement('div');
    lab.className = 'facts';
    lab.textContent = k + ' ';
    var val = document.createElement('b');
    val.textContent = d.value;
    lab.appendChild(val);
    var r = document.createElement('input');
    r.type = 'range';
    r.min = d.min; r.max = d.max; r.value = d.value;
    r.step = (d.max - d.min) / 200;
    r.oninput = function () {
      overrides[k] = Number(r.value);
      val.textContent = Number(r.value).toFixed(2);
      resolve();
    };
    host.appendChild(lab);
    host.appendChild(r);
  });
}

function resolve() {
  var t0 = performance.now();
  try {
    solved = piece.solve(current, Number(document.getElementById('seed').value), overrides);
    err.textContent = '';
  } catch (e) { err.textContent = String(e.message); return; }
  if (solved.stages.error) {
    var s = solved.stages.error;
    err.textContent = 'build stage "' + s.stage + '" (' + (s.at + 1) + ' of ' + s.of + ') threw: ' + s.message;
    return;
  }
  solved.__ms = performance.now() - t0;
  frame();
}

function frame() {
  if (!solved) return;
  var t0 = performance.now();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  var qt;
  try { qt = render.drawFrame(ctx, current, solved, t); }
  catch (e) { err.textContent = String(e.message); stop(); return; }
  var ms = performance.now() - t0;
  document.getElementById('tread').textContent = current.time ? qt.toFixed(3) + ' of 1' : 'a still';
  facts.innerHTML = [
    'declared <b>' + current.outputs.join(' + ') + '</b>',
    'design box <b>' + current.size.w + ' \\u00d7 ' + current.size.h + '</b>',
    'seed <b>' + solved.seed + '</b>',
    'build <b>' + solved.__ms.toFixed(1) + ' ms</b> in <b>' + solved.stages.of + '</b> stage(s)',
    'draw <b>' + ms.toFixed(1) + ' ms</b>',
    current.time ? 'frames <b>' + render.playheads(current).length + '</b>' : 'no timeline',
  ].join('<br>');
}

function stop() {
  playing = false;
  cancelAnimationFrame(raf);
  var b = document.getElementById('play');
  b.classList.remove('on');
  b.textContent = 'play';
}

document.getElementById('play').onclick = function () {
  if (playing) return stop();
  playing = true;
  this.classList.add('on');
  this.textContent = 'pause';
  var dur = current.time.duration * 1000;
  var t0 = performance.now() - t * dur;
  (function step(now) {
    if (!playing) return;
    // The wall clock drives the TRANSPORT and nothing else. drawFrame quantises
    // the playhead to the drawn-frame grid, so no mark ever sees this number.
    t = ((now - t0) % dur) / dur;
    document.getElementById('t').value = t * 1000;
    frame();
    raf = requestAnimationFrame(step);
  })(performance.now());
};

document.getElementById('t').oninput = function () { stop(); t = Number(this.value) / 1000; frame(); };
document.getElementById('seed').onchange = function () { stop(); resolve(); };
document.getElementById('reroll').onclick = function () {
  stop();
  document.getElementById('seed').value = Math.floor(Math.random() * 4294967296);
  resolve();
};

Array.prototype.forEach.call(document.querySelectorAll('[data-png]'), function (b) {
  b.onclick = function () {
    // The raster backend, entire: an offscreen canvas at any scale. Not capped.
    var k = Number(b.dataset.png);
    var o = document.createElement('canvas');
    o.width = Math.round(current.size.w * k);
    o.height = Math.round(current.size.h * k);
    render.drawFrame(o.getContext('2d'), current, solved, t, { scale: k });
    o.toBlob(function (blob) { save(blob, currentName + '-' + solved.seed + '@' + k + 'x.png'); });
  };
});

document.getElementById('svg').onclick = function () {
  var g = new vector.VectorSurface(current.size);
  render.drawFrame(g, current, solved, t);
  save(new Blob([g.toSVG()], { type: 'image/svg+xml' }), currentName + '-' + solved.seed + '.svg');
};

function save(blob, name) {
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
}

// Published so a headless check can drive the page without screenshot diffing.
// The modules go with it: a raster check must render into its OWN canvas with
// willReadFrequently set, because a displayed canvas is GPU-rasterised until the
// browser decides otherwise, and its anti-aliasing changes when it switches.
// That is a property of the browser, not of the piece, and a check that reads
// the visible canvas measures the wrong thing.
window.__artifex = {
  names: names,
  select: select,
  piece: piece,
  render: render,
  vector: vector,
  examples: EXAMPLES,
  setSeed: function (s) { document.getElementById('seed').value = s; resolve(); },
  setT: function (v) { stop(); t = v; frame(); },
  read: function () {
    return {
      name: currentName, seed: solved && solved.seed, t: t,
      outputs: current.outputs, size: current.size,
      frames: render.playheads(current).length,
      error: err.textContent || null,
    };
  },
};

select(names[0]);
})();
</script>
</body>
</html>
`;
}

function main() {
  checkResolvable(MODULES);
  const bundle = MODULES.map(wrap).join('\n');
  const page = html(bundle);
  const out = path.join(ROOT, 'out');
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, 'index.html');
  fs.writeFileSync(file, page);
  console.log(`${path.relative(ROOT, file)}  ${(Buffer.byteLength(page) / 1024).toFixed(1)} kB  ${MODULES.length} modules, no dependencies`);
}

// Requirable, so the resolution check can be tested. Without this the only
// check the delivery tool has would itself be unchecked.
if (require.main === module) main();

module.exports = { modules, checkResolvable };
