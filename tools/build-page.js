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

/**
 * When every frame in a WebM file plays, in milliseconds, read from the FILE.
 *
 * MediaRecorder cannot be asked how many frames it received, and it stamps each
 * one by the wall clock rather than by the timestamp on the frame it was handed.
 * So what the write loop believes it
 * wrote is the wrong half to measure: the file is the film, and this reads it.
 *
 * A flat walk, not a tree: a recorder writes its Segment and its Clusters with
 * unknown sizes, and stepping INTO a master instead of over it needs no size.
 * The recorder here has one track, so every block is one picture.
 *
 * It lives out here, and the page gets its source, so that `node --test` can
 * reach it. Nothing inside the page body can be reached that way.
 */
function webmBlockTimes(bytes) {
  const SEGMENT = 0x18538067, INFO = 0x1549A966, CLUSTER = 0x1F43B675, GROUP = 0xA0;
  const SCALE = 0x2AD7B1, TIMECODE = 0xE7, SIMPLE = 0xA3, BLOCK = 0xA1;
  let p = 0, scale = 1000000, cluster = 0;
  const out = [];
  const width = (b) => { let n = 1; while (n <= 8 && !(b & (0x80 >> (n - 1)))) n++; return n; };
  const uint = (at, n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + bytes[at + i]; return v; };
  while (p < bytes.length) {
    const idLen = width(bytes[p]);
    const sizeLen = width(bytes[p + idLen]);
    if (idLen > 4 || sizeLen > 8) break;
    const id = uint(p, idLen);
    // A size of all ones means "unknown", which only a master may carry.
    const size = uint(p + idLen, sizeLen) - 2 ** (7 * sizeLen);
    p += idLen + sizeLen;
    if (id === SEGMENT || id === INFO || id === CLUSTER || id === GROUP) continue;
    if (size === 2 ** (7 * sizeLen) - 1) break;
    if (id === SCALE) scale = uint(p, size);
    else if (id === TIMECODE) cluster = uint(p, size);
    else if (id === SIMPLE || id === BLOCK) {
      const at = p + width(bytes[p]);
      out.push((cluster + ((uint(at, 2) << 16) >> 16)) * scale / 1000000);
    }
    p += size;
  }
  return out;
}

/**
 * Judge a film by what its file holds: every declared frame, evenly spaced.
 *
 * A film once passed frames written, frames received AND duration, and still
 * played in bursts -- thirty frames in forty milliseconds, then a one-second
 * freeze, ten times over. Spacing is the only thing
 * "fluid" means, so it is asserted here and not merely reported.
 *
 * The three bounds sit outside everything a good film measured: median 33.3 to
 * 33.6 ms against a 33.33 ms budget, p95 37.6, and one max of 65.3.
 */
function filmVerdict(expected, hz, times) {
  const budget = 1000 / hz;
  const gaps = times.slice(1).map((ms, i) => ms - times[i]).sort((a, b) => a - b);
  const at = (q) => (gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(q * gaps.length))] : 0);
  const v = {
    frames: times.length, expected, hz,
    seconds: times.length ? (times[times.length - 1] - times[0] + budget) / 1000 : 0,
    budgetMs: budget, medianGapMs: at(0.5), p95GapMs: at(0.95), maxGapMs: at(1),
  };
  if (v.frames !== expected) {
    throw new Error(`the file holds ${v.frames} of ${expected} frames, so this film is missing pictures rather than slow. Nothing was saved.`);
  }
  if (Math.abs(v.medianGapMs - budget) > budget * 0.1 || v.p95GapMs > budget * 1.5 || v.maxGapMs > budget * 3) {
    throw new Error(`the frame spacing is uneven: median ${v.medianGapMs.toFixed(1)} ms, p95 ${v.p95GapMs.toFixed(1)} ms, `
      + `max ${v.maxGapMs.toFixed(1)} ms against a budget of ${budget.toFixed(1)} ms. Every frame is there and the film would still judder. Nothing was saved.`);
  }
  return v;
}

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
  .meaning { color: var(--dim); font-size: 10px; line-height: 1.5; opacity: .75;
             margin: 0 0 3px 1px; }
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
      <div class="row" style="margin-top:10px"><button id="video">WebM video</button></div>
      <div class="note" id="videonote"></div>
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
  document.getElementById('video').disabled = !current.time;
  document.getElementById('videonote').textContent = current.time
    ? render.playheads(current).length + ' frames, encoded one at a time.'
    : 'A still has no frame list to walk, so there is no film to write.';
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
    // An override already in hand wins over the declared default -- otherwise a
    // link that names a parameter opens with the right picture and the wrong
    // slider, and the panel is lying about the thing it is there to show.
    var at = k in overrides ? overrides[k] : d.value;
    var lab = document.createElement('div');
    lab.className = 'facts';
    lab.textContent = k + ' ';
    var val = document.createElement('b');
    val.textContent = at;
    lab.appendChild(val);
    // What the knob DOES, from the piece's own declaration. A slider labelled
    // only with its name asks the reader to guess, and a reader that cannot
    // read the source -- an agent, or anyone a page is handed to -- cannot.
    var why = document.createElement('div');
    why.className = 'meaning';
    why.textContent = d.meaning;
    var r = document.createElement('input');
    r.type = 'range';
    r.min = d.min; r.max = d.max; r.value = at;
    r.step = (d.max - d.min) / 200;
    r.oninput = function () {
      overrides[k] = Number(r.value);
      val.textContent = Number(r.value).toFixed(2);
      resolve();
    };
    host.appendChild(lab);
    host.appendChild(why);
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
  if (!playing) toUrl();
}

function stop() {
  playing = false;
  cancelAnimationFrame(raf);
  var b = document.getElementById('play');
  b.classList.remove('on');
  b.textContent = 'play';
  toUrl();
}

// THE ADDRESS BAR IS THE RECIPE. solve() knows the piece, the seed and every
// parameter at the moment it runs, and until now the page threw all of it away
// -- so a picture someone liked was gone on the next click, and there was no
// way to send one to anybody.
//
// replaceState rather than pushState: scrubbing a playhead would otherwise put
// a hundred entries in the back button, and the picture is a VIEW of this page,
// not a place you navigated to.
//
// Not called from frame() while playing. That runs once per animation frame,
// and a browser is entitled to throttle a page that rewrites its own URL sixty
// times a second. stop() calls it, so the address bar is right the moment
// anyone could act on it.
function toUrl() {
  if (!current) return;
  var q = ['piece=' + encodeURIComponent(currentName),
    'seed=' + encodeURIComponent(document.getElementById('seed').value)];
  if (current.time) q.push('t=' + t.toFixed(4));
  Object.keys(overrides).forEach(function (k) {
    q.push('p.' + encodeURIComponent(k) + '=' + encodeURIComponent(overrides[k]));
  });
  history.replaceState(null, '', '?' + q.join('&'));
}

// Read it back. Every value is checked against the piece that is actually here
// rather than trusted: a URL is the one input to this page that arrives from
// outside it, and a stale link naming a parameter this build no longer declares
// would otherwise throw on load and leave a blank page.
function fromUrl() {
  // Escaped twice on purpose: this whole page body is a template literal, so a
  // single backslash is eaten before it ever reaches the browser. The first
  // draft of this line shipped /^?/ and the page died on load with "Nothing to
  // repeat" -- and the builder's module check cannot see that, because the
  // bundle resolved perfectly.
  var q = String(location.search || '').replace(/^\\?/, '');
  if (!q) return null;
  var out = { piece: null, seed: null, t: null, params: {} };
  q.split('&').forEach(function (kv) {
    var i = kv.indexOf('=');
    if (i < 0) return;
    var k = decodeURIComponent(kv.slice(0, i));
    var v = decodeURIComponent(kv.slice(i + 1));
    if (k === 'piece') out.piece = v;
    else if (k === 'seed' && /^[0-9]+$/.test(v)) out.seed = Number(v);
    else if (k === 't' && isFinite(Number(v))) out.t = Math.min(1, Math.max(0, Number(v)));
    else if (k.indexOf('p.') === 0 && isFinite(Number(v))) out.params[k.slice(2)] = Number(v);
  });
  return out.piece ? out : null;
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

${webmBlockTimes.toString()}
${filmVerdict.toString()}

// THE FRAME-EXACT FILM. It walks playheads(piece) -- the piece's OWN frame list
// -- and hands each drawn frame to the encoder itself, so the file holds the
// frames the piece declares rather than the ones the machine managed to paint.
//
// Two measurements decide the shape.
// A canvas MediaStream is paced by the COMPOSITOR: four routes gave
// 159, 112, 96 and 92 frames of 300, and every one of those files still played
// ten seconds. And a timer is clamped to one second in a page that is not in
// front, which wrote thirty frames at once and then froze. So: no canvas stream
// and no timer of any kind -- frames the code builds, paced by a MessageChannel
// round trip, which is a macrotask and is not clamped.
//
// It saves nothing itself and judges the FILE, not the loop: filmVerdict reads
// the blocks the recorder actually wrote, and throws on a missing frame or on
// uneven spacing. The button saves; a headless check calls this and reads the
// report.
async function exportVideo() {
  // Held here, because the export runs for the length of the film and nothing
  // stops anyone choosing another piece while it does.
  var p = current, s = solved, name = currentName;
  if (!p || !p.time) throw new Error('this piece is a still: there is no frame list to walk');
  if (typeof MediaStreamTrackGenerator !== 'function') {
    throw new Error('this browser has no MediaStreamTrackGenerator, and the frame-exact export needs it: a canvas captureStream is paced by the compositor and silently drops most of the film');
  }
  var heads = render.playheads(p), hz = p.time.hz;
  var off = document.createElement('canvas');
  off.width = p.size.w;
  off.height = p.size.h;
  var octx = off.getContext('2d');
  var track = new MediaStreamTrackGenerator({ kind: 'video' });
  var writer = track.writable.getWriter();
  var rec = new MediaRecorder(new MediaStream([track]), { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 8000000 });
  var chunks = [];
  rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
  var finished = new Promise(function (r) { rec.onstop = r; });
  rec.start();

  var mc = new MessageChannel();
  var macro = function () {
    return new Promise(function (r) { mc.port1.onmessage = function () { r(); }; mc.port2.postMessage(0); });
  };

  // RENDER AND ENCODE ARE TWO CALLS, timed apart. On four of five subjects in
  // the engine this imports from, most of what every instrument had measured
  // was the encoder, and one number for both hides it.
  function renderFrame(i) {
    octx.clearRect(0, 0, off.width, off.height);
    render.drawFrame(octx, p, s, heads[i]);
  }
  async function encodeFrame(i) {
    var f = new VideoFrame(off, { timestamp: Math.round((i * 1000000) / hz) });
    await writer.write(f);
    f.close();
  }

  var t0 = performance.now(), renderMs = 0, encodeMs = 0;
  try {
    for (var i = 0; i <= heads.length; i++) {
      // Paced to the piece's own rate: MediaRecorder stamps blocks by the wall
      // clock, not by the timestamp on the frame handed to it, so a loop that
      // is not paced writes a film that plays in a fraction of its length.
      var due = t0 + (i * 1000) / hz;
      while (performance.now() < due) await macro();
      // One lap past the end, so the LAST frame is held for its own interval
      // like every other. Stopped straight after the last write, the recorder
      // drops the frame still in its encoder: 19 of 20, three runs of three,
      // and 20 of 20 from a 17 ms wait up. A count of writes cannot see that;
      // the count read back from the file did, on the first export.
      if (i === heads.length) break;
      var a = performance.now();
      renderFrame(i);
      var b = performance.now();
      await encodeFrame(i);
      renderMs += b - a;
      encodeMs += performance.now() - b;
    }
  } finally {
    try { await writer.close(); } catch (e) { /* the track may already be closed */ }
    rec.stop();
    await finished;
  }

  var blob = new Blob(chunks, { type: 'video/webm' });
  var report = filmVerdict(heads.length, hz, webmBlockTimes(new Uint8Array(await blob.arrayBuffer())));
  report.bytes = blob.size;
  report.renderMs = renderMs;
  report.encodeMs = encodeMs;
  report.name = name + '-' + s.seed + '.webm';
  report.blob = blob;
  return report;
}

document.getElementById('video').onclick = function () {
  var b = this;
  var note = document.getElementById('videonote');
  b.disabled = true;
  err.textContent = '';
  note.textContent = 'encoding ' + render.playheads(current).length + ' frames...';
  exportVideo().then(function (r) {
    save(r.blob, r.name);
    note.textContent = r.frames + ' of ' + r.expected + ' frames, ' + r.seconds.toFixed(2) + ' s, '
      + Math.round(r.bytes / 1024) + ' kB. Gap between frames: median ' + r.medianGapMs.toFixed(1)
      + ' ms, p95 ' + r.p95GapMs.toFixed(1) + ' ms, max ' + r.maxGapMs.toFixed(1) + ' ms. Render '
      + r.renderMs.toFixed(0) + ' ms, encode ' + r.encodeMs.toFixed(0) + ' ms.';
  }).catch(function (e) {
    note.textContent = '';
    err.textContent = String(e.message || e);
  }).finally(function () { b.disabled = !current.time; });
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
  video: exportVideo,
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
  // Stop the build after a named stage and describe what it had made. read()
  // above answers what is on screen; this answers what the piece was holding
  // part-way through, which is the look the build graph is a graph FOR. The
  // state comes back summarised, never raw: raw state is typed arrays and
  // nested polylines, and a caller that JSON.stringify'd it would get either
  // the wrong answer or megabytes of one.
  //
  // NO BACKTICKS ANYWHERE IN HERE. This whole page body is one template
  // literal, so a backtick in a comment ends it early -- which is exactly how
  // this function was written the first time.
  stages: function () { return current ? current.build.map(function (s) { return s[0]; }) : []; },
  inspect: function (stage) {
    if (!current) return null;
    var s = piece.solve(current, Number(document.getElementById('seed').value), overrides, { until: stage });
    return {
      stage: stage,
      ran: s.stages.ms.length,
      of: s.stages.of,
      ms: s.stages.ms,
      error: s.stages.error,
      state: piece.summarise(s.state),
    };
  },
  // The recipe for what is on screen right now, with the QUANTISED playhead --
  // the frame that was actually drawn, not the one the slider was left at.
  manifest: function () {
    return solved ? Object.assign({}, solved.manifest, { t: piece.frameT(current, t) }) : null;
  },
};

// Open what the address bar asks for, when this build actually has it. The
// order matters: select() clears the overrides and resets the seed, so the
// URL's values go on AFTER it, not before.
var from = fromUrl();
if (from && EXAMPLES[from.piece]) {
  select(from.piece);
  if (from.seed !== null) document.getElementById('seed').value = from.seed;
  if (from.t !== null && current.time) {
    t = from.t;
    document.getElementById('t').value = t * 1000;
  }
  Object.keys(from.params).forEach(function (k) {
    var d = current.params[k];
    if (d && from.params[k] >= d.min && from.params[k] <= d.max) overrides[k] = from.params[k];
  });
  buildParams();
  resolve();
} else {
  select(names[0]);
}
})();
</script>
</body>
</html>
`;
}

/**
 * Parse the script this page is about to ship.
 *
 * checkResolvable only proves the MODULES can find each other. Nothing looked
 * at the page body around them, which is a single template literal written in
 * this file -- so an error in THAT wrote a 146 kB file, printed a success line,
 * exited 0 and rendered a blank page.
 *
 * The fault that bought this check: a regex written /^\?/ inside the literal,
 * where the backslash is eaten before the browser ever sees it, so the page got
 * /^?/ and died on load with "Nothing to repeat". Nothing in the build, the
 * suite, the mutation run or the lint could see it.
 *
 * Its sibling -- a backtick inside a comment in the literal, which ends the
 * literal early -- is NOT caught here: it breaks this file instead, and fails
 * when anything requires it. Two different faults, two different guards.
 *
 * `new Function` compiles without running, so this costs nothing and fails at
 * build time with the browser's own message.
 */
function checkParses(page) {
  const m = page.match(/<script>([\s\S]*)<\/script>/);
  if (!m) throw new Error('build-page: the emitted page has no script block');
  try {
    new Function(m[1]);     // eslint-disable-line no-new-func
  } catch (e) {
    throw new Error(`build-page: the emitted page does not parse -- ${e.message}`);
  }
  return true;
}

function main() {
  checkResolvable(MODULES);
  const bundle = MODULES.map(wrap).join('\n');
  const page = html(bundle);
  checkParses(page);
  const out = path.join(ROOT, 'out');
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, 'index.html');
  fs.writeFileSync(file, page);
  console.log(`${path.relative(ROOT, file)}  ${(Buffer.byteLength(page) / 1024).toFixed(1)} kB  ${MODULES.length} modules, no dependencies`);
}

// Requirable, so the resolution check can be tested. Without this the only
// check the delivery tool has would itself be unchecked.
if (require.main === module) main();

/** The module runtime plus every bundled module, for any page that wants them. */
function bundle() {
  checkResolvable(MODULES);
  return [RUNTIME].concat(MODULES.map(wrap)).join(String.fromCharCode(10));
}

module.exports = { modules, checkResolvable, checkParses, bundle, html, webmBlockTimes, filmVerdict, MODULES };
