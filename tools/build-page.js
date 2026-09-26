#!/usr/bin/env node
'use strict';

// Build one self-contained HTML file: the live backend, the raster backend and
// the transport, around whichever pieces are handed to it.
//
// WHY A BUILD STEP RATHER THAN A DIFFERENT MODULE FORMAT. The single-file
// constraint is a DELIVERY target, not an authoring constraint. The core stays
// plain CommonJS that `node --test` runs directly, and this file pays the one
// cost of making it reachable from a browser.
//
// No dependencies, node: built-ins only.

const fs = require('node:fs');
const path = require('node:path');
const { loadExternal } = require('./piece-input.js');

const ROOT = path.join(__dirname, '..');
/**
 * The modules to bundle, DISCOVERED rather than listed.
 *
 * Deriving the list from the directories includes newly added examples and
 * their helper modules without a second registry to keep in sync.
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
  const bad = [];
  for (const id of ids) {
    if (!MODULES.includes(id)) { bad.push(id + ' is asked for, but it is not a module in core/ or examples/'); continue; }
    for (const [spec, target] of requires(id)) {
      if (!have.has(target)) bad.push(id + ' requires ' + spec + ' -> ' + target + ', which is not bundled');
    }
  }
  if (bad.length) {
    throw new Error('build: this page would throw on load and render nothing.\n  ' + bad.join('\n  '));
  }
}

/** Each require in a library module, as [spec, id], resolved as the page's own __resolve does. */
function requires(id) {
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
  const src = fs.readFileSync(path.join(ROOT, id), 'utf8');
  return [...src.matchAll(/require\('([^']+)'\)/g)].filter((m) => !m[1].startsWith('node:')).map((m) => [m[1], resolve(id, m[1])]);
}

/**
 * The library modules `ids` reach, themselves included, in bundle order: what
 * a bundle needs for a caller that requires only those. An id outside the
 * library is left in, so checkResolvable names it rather than this dropping it.
 */
function reach(ids) {
  const found = new Set();
  const visit = (id) => {
    if (found.has(id)) return;
    found.add(id);
    if (MODULES.includes(id)) for (const [, target] of requires(id)) visit(target);
  };
  ids.forEach(visit);
  return MODULES.filter((id) => found.has(id)).concat([...found].filter((id) => !MODULES.includes(id)));
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

function html(bundle, options = {}) {
  // Counted, never written out: the word "Five" shipped in the delivered page
  // for as long as there were five examples, and stayed there when there were six.
  const count = options.count === undefined ? MODULES.filter((m) => m.startsWith('examples/')
    && m !== 'examples/index.js' && m !== 'examples/stroke-font.js').length : options.count;
  const description = options.count === undefined
    ? count + " idioms that break each other's assumptions. The seed and the playhead are the only inputs."
    : 'Adjust the seed, playhead and declared parameters of your piece.';
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
  #previewMode { font: inherit; color: var(--fg); background: #262932; border: 1px solid #737681;
                 border-radius: 3px; min-height: 32px; padding: 5px 7px; width: 100%; }
  #previewMode:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  #previewStatus { color: var(--fg); }
  .facts { color: var(--dim); line-height: 1.7; font-size: 11px; }
  .facts b { color: var(--fg); font-weight: normal; }
  .meaning { color: var(--dim); font-size: 10px; line-height: 1.5; opacity: .75;
             margin: 0 0 3px 1px; }
  .note { color: var(--dim); font-size: 10px; line-height: 1.5; margin-top: 8px; }
  .err { color: #e8705a; white-space: pre-wrap; line-height: 1.5; font-size: 11px; }
  a { color: var(--accent); }
  /* The live player: the piece alone, at the size of whatever frame holds the page. */
  body.player aside { display: none; }
  body.player main { position: fixed; inset: 0; padding: 0; }
  body.player canvas { max-width: none; max-height: none; box-shadow: none; cursor: pointer; }
</style>
</head>
<body>
<div class="wrap">
  <aside>
    <h1>Artifex</h1>
    <p class="sub">${description}</p>

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
      <div class="note"><a id="playerLink" href="?player=1">Open in the live player</a>: the piece alone, fitted to the window.</div>
    </div>

    <div class="group" id="paramsGroup" hidden>
      <div class="label">Declared parameters</div>
      <div id="params"></div>
    </div>

    <div class="group" id="boxGroup" hidden>
      <div class="label">Box</div>
      <div id="boxes"></div>
      <div class="note">This piece recomposes to its box. Exports draw at it and their recipes record it.</div>
    </div>

    <div class="group" id="previewGroup" hidden>
      <label class="label" for="previewMode">Preview renderer</label>
      <select id="previewMode" aria-describedby="previewStatus">
        <option value="cpu">CPU reference</option>
        <option value="gpu">GPU preview</option>
      </select>
      <div class="note" id="previewStatus" role="status" aria-live="polite">CPU reference. Exports always use CPU.</div>
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
      <div id="mp4">
        <div class="row" style="margin-top:10px">
          <button id="film1" data-film="" title="Long edge at 1920 pixels or more">MP4</button>
          <button id="film2" data-film="1" title="The design box, for a quick draft">MP4 1x</button>
        </div>
        <div class="note" id="filmnote"></div>
      </div>
      <div id="webm" hidden>
        <div class="row" style="margin-top:10px"><button id="video">WebM video</button></div>
        <div class="note" id="videonote"></div>
      </div>
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
var gpuPreview = __req('core/webgpu-preview.js');
var film = __req('core/film.js');
var exporter = __req('core/export.js'), save = exporter.save;
var EXAMPLES = __req('examples/index.js');

var names = Object.keys(EXAMPLES);
// base is the piece as declared; current is base at the box chosen for it.
var base = null, current = null, currentName = null, solved = null, t = 0, playing = false, overrides = {}, raf = 0, videoBusy = false, filmBusy = false;
// The live player shows the piece alone, fitted to the window, and a piece that
// declares boxes takes the window's box. view is device pixels per design unit.
var player = /(^|[?&])player=1(&|$)/.test(String(location.search || '')), view = 1;
var filmButtons = [document.getElementById('film1'), document.getElementById('film2')];
var c = document.getElementById('c'), ctx = c.getContext('2d');
var facts = document.getElementById('facts'), err = document.getElementById('err');
var previewMode = 'cpu', previewSession = null, previewPending = null, previewLoop = null;
var frameRevision = 0, transportRevision = 0;
var previewInfo = { mode: 'cpu', status: 'reference', presented: null };

function previewStatus(message) {
  var node = document.getElementById('previewStatus');
  if (node.textContent !== message) node.textContent = message;
}

function makePreviewSession() {
  var session = gpuPreview.createPreview({
    gpu: typeof navigator === 'undefined' ? null : navigator.gpu,
    createCanvas: function () { return document.createElement('canvas'); },
    onLoss: function (message) { if (previewSession === session) previewFallback(message); },
  });
  return session;
}

function resetPreview() {
  frameRevision++;
  previewPending = null;
  if (previewSession) previewSession.dispose();
  previewSession = null;
  previewMode = 'cpu';
  document.getElementById('previewMode').value = 'cpu';
  previewInfo = { mode: 'cpu', status: 'reference', presented: null };
  previewStatus('CPU reference. Exports always use CPU.');
}

function previewFallback(message) {
  resetPreview();
  previewInfo.status = 'fallback';
  previewInfo.reason = message;
  previewStatus('CPU fallback: ' + message + '. Choose GPU preview to retry. Exports use CPU.');
  frame();
}

function setPreview(mode) {
  if (mode !== 'cpu' && mode !== 'gpu') throw new Error('preview renderer must be cpu or gpu');
  if (mode === 'gpu' && (!current || !current.preview)) throw new Error('this piece has no GPU preview');
  stop();
  resetPreview();
  previewMode = mode;
  document.getElementById('previewMode').value = mode;
  if (mode === 'gpu') {
    previewInfo = { mode: 'gpu', status: 'preparing', presented: null };
    previewStatus('Preparing GPU preview. Exports always use CPU.');
  }
  return frame();
}

document.getElementById('previewMode').onchange = function () { setPreview(this.value); };
if (window.addEventListener) window.addEventListener('pagehide', resetPreview);

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
  resetPreview();
  err.textContent = '';
  // The piece is never decorated. playheads() validates whatever it is handed
  // and a stowaway key is refused BY NAME -- which is the contract working, so
  // the name lives beside the piece rather than on it.
  base = current = piece.validate(EXAMPLES[name]);
  currentName = name;
  document.getElementById('previewGroup').hidden = !current.preview;
  overrides = {};
  document.getElementById('seed').value = current.seed;
  sizeCanvas();
  buildBox();
  t = current.time ? 0 : 0;
  document.getElementById('t').value = 0;
  document.getElementById('t').disabled = !current.time;
  document.getElementById('play').disabled = !current.time;
  var can = current.outputs.indexOf('vector') >= 0;
  document.getElementById('svg').disabled = !can;
  document.getElementById('svgnote').textContent = can
    ? 'Declared vector: any raster call would throw by name rather than vanish.'
    : 'This piece declares raster only, and means it. Asking for SVG is refused rather than answered with half a picture.';
  document.getElementById('video').disabled = !current.time || videoBusy;
  document.getElementById('videonote').textContent = current.time ? exporter.webmNote(current, 'h264') : '';
  Array.prototype.forEach.call(filmButtons, function (b) { b.disabled = !current.time || filmBusy; });
  document.getElementById('filmnote').textContent = current.time
    ? render.playheads(current).length + ' frames, each encoded at its own time however long it takes to draw'
      + (current.sound ? ', with the soundtrack the piece declares.' : '.')
    : 'A still has no frame list to walk, so there is no film to write.';
  offerFilm();
  Array.prototype.forEach.call(box.children, function (b) { b.classList.toggle('on', b.dataset.name === name); });
  buildParams();
  resolve();
}

// THE FILM ON OFFER. MP4 is the film export wherever this browser encodes it
// (core/export.js filmOffer). Only where it cannot does the page offer the
// real-time WebM recorder, which loses frames on a piece slower than real time
// and carries no sound. Nothing waits for the encoders: MP4 shows until they answer.
var asked = {}, filmOffer = null;

function offerFilm() {
  var p = current;
  document.getElementById('mp4').hidden = false;
  document.getElementById('webm').hidden = true;
  filmOffer = exporter.filmOffer(p, asked).then(function (choice) {
    // An answer about a piece no longer selected says nothing about this one.
    if (p === current) {
      document.getElementById('mp4').hidden = choice.format === 'webm';
      document.getElementById('webm').hidden = choice.format !== 'webm';
      if (choice.format === 'webm') document.getElementById('videonote').textContent = exporter.webmNote(p, choice.reason);
    }
    return choice;
  });
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
    r.min = d.min; r.max = d.max;
    r.step = (d.max - d.min) / 200;
    r.value = at;
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

// THE BOX. A piece that declares boxes is drawn at the one chosen for it, and
// solved again for it, so it recomposes rather than stretches. Exports read
// current.size, so they draw at the chosen box and their recipes record it.
function sizeCanvas() {
  view = 1;
  if (player) {
    // One design unit is one CSS pixel while the box fits the window; a box
    // that cannot, such as a fixed piece's, is fitted whole. The backing store
    // has the device's pixels, so the player is sharp at any zoom.
    var fit = Math.min(window.innerWidth / current.size.w, window.innerHeight / current.size.h);
    view = fit * (window.devicePixelRatio || 1);
    c.style.width = current.size.w * fit + 'px';
    c.style.height = current.size.h * fit + 'px';
  }
  c.width = Math.round(current.size.w * view);
  c.height = Math.round(current.size.h * view);
}

function setBox(w, h) {
  // atBox refuses a box outside the declared ranges by name, and leaves the
  // piece as it was.
  current = piece.atBox(base, { w: w, h: h });
  sizeCanvas();
  offerFilm();
  resolve();
}

function buildBox() {
  var host = document.getElementById('boxes');
  document.getElementById('boxGroup').hidden = !base.boxes;
  host.innerHTML = '';
  if (!base.boxes) return;
  [['w', 'width'], ['h', 'height']].forEach(function (axis) {
    var k = axis[0];
    var lab = document.createElement('div');
    lab.className = 'facts';
    lab.textContent = axis[1] + ' ';
    var val = document.createElement('b');
    val.textContent = current.size[k];
    lab.appendChild(val);
    var r = document.createElement('input');
    r.type = 'range';
    r.min = base.boxes[k][0]; r.max = base.boxes[k][1];
    r.step = 1;
    r.value = current.size[k];
    r.setAttribute('aria-label', 'box ' + axis[1]);
    r.oninput = function () {
      val.textContent = r.value;
      var box = { w: current.size.w, h: current.size.h };
      box[k] = Number(r.value);
      setBox(box.w, box.h);
    };
    host.appendChild(lab);
    host.appendChild(r);
  });
}

// The player's box is the window's, held inside the declared ranges.
function fitPlayer() {
  if (!current) return;
  if (base.boxes) {
    var clampTo = function (v, range) { return Math.min(range[1], Math.max(range[0], Math.round(v))); };
    var w = clampTo(window.innerWidth, base.boxes.w), h = clampTo(window.innerHeight, base.boxes.h);
    if (w !== current.size.w || h !== current.size.h) return setBox(w, h);
  }
  sizeCanvas();
  frame();
}

function buildControls(ready) {
  document.getElementById('previewMode').disabled = !ready;
  document.getElementById('play').disabled = !ready || !current.time;
  document.getElementById('t').disabled = !ready || !current.time;
  document.getElementById('svg').disabled = !ready || current.outputs.indexOf('vector') < 0;
  document.getElementById('video').disabled = !ready || !current.time || videoBusy;
  Array.prototype.forEach.call(filmButtons, function (b) { b.disabled = !ready || !current.time || filmBusy; });
  Array.prototype.forEach.call(document.querySelectorAll('[data-png]'), function (b) { b.disabled = !ready; });
}

function failBuild(message) {
  // A partial solve is diagnostic state, never a frame or an export recipe.
  solved = null;
  resetPreview();
  err.textContent = message;
  stop();
  buildControls(false);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  facts.innerHTML = '';
  document.getElementById('tread').textContent = '';
}

function resolve() {
  var t0 = performance.now();
  // A new solve has its own soundtrack: the old one stops and is dropped.
  soundtrack = null;
  silence();
  try {
    solved = piece.solve(current, Number(document.getElementById('seed').value), overrides);
    err.textContent = '';
  } catch (e) { failBuild(String(e.message)); return; }
  if (solved.stages.error) {
    var s = solved.stages.error;
    failBuild('build stage "' + s.stage + '" (' + (s.at + 1) + ' of ' + s.of + ') threw: ' + s.message);
    return;
  }
  solved.__ms = performance.now() - t0;
  if (previewMode === 'gpu') {
    ctx.clearRect(0, 0, c.width, c.height);
    previewInfo.presented = null;
  }
  buildControls(true);
  frame();
  // A parameter changed while playing: the transport plays on, so its sound
  // does too, from the new solve.
  if (playing) playSound(transportRevision);
}

function frame() {
  if (!solved) return;
  var revision = ++frameRevision;
  if (previewMode === 'gpu') {
    previewPending = { p: current, s: solved, t: t, revision: revision, width: c.width, height: c.height };
    previewInfo.requested = { seed: solved.seed, t: piece.frameT(current, t), params: Object.assign({}, solved.state.params) };
    if (!playing) {
      ctx.clearRect(0, 0, c.width, c.height);
      previewInfo.presented = null;
      toUrl();
    }
    if (previewLoop) return previewLoop;
    // One in-flight frame plus a replaceable latest request. Playback waits
    // for this loop so slow GPUs cannot be invalidated on every animation tick.
    previewLoop = (async function () {
      while (previewPending && previewMode === 'gpu') {
        var request = previewPending;
        previewPending = null;
        if (!previewSession) previewSession = makePreviewSession();
        var active = previewSession;
        try {
          var result = await active.draw(request.p, request.s, request.t, request.width, request.height, {
            isCurrent: function () { return previewMode === 'gpu' && previewSession === active && request.revision === frameRevision; },
            present: function (image) {
              ctx.setTransform(1, 0, 0, 1, 0, 0);
              ctx.drawImage(image, 0, 0);
            },
          });
          if (!result.stale && previewSession === active && request.revision === frameRevision) {
            previewInfo = { mode: 'gpu', status: 'active', presented: {
              seed: request.s.seed, t: result.t, params: Object.assign({}, request.s.state.params),
            }, timing: result };
            previewStatus('GPU preview is approximate. Exports always use CPU.');
            showFrame(result.t, result.totalMs, 'preview');
          }
        } catch (e) {
          if (previewSession === active) previewFallback(String(e.message || e));
        }
      }
    })().finally(function () { previewLoop = null; });
    return previewLoop;
  }
  var t0 = performance.now();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  var qt;
  try { qt = render.drawFrame(ctx, current, solved, t, { scale: view }); }
  catch (e) { err.textContent = String(e.message); stop(); return; }
  var ms = performance.now() - t0;
  previewInfo.presented = { seed: solved.seed, t: qt, params: Object.assign({}, solved.state.params) };
  showFrame(qt, ms, 'draw');
}

function showFrame(qt, ms, timingLabel) {
  document.getElementById('tread').textContent = current.time ? qt.toFixed(3) + ' of 1' : 'a still';
  facts.innerHTML = [
    'declared <b>' + current.outputs.join(' + ') + '</b>',
    'design box <b>' + current.size.w + ' \\u00d7 ' + current.size.h + '</b>',
    'seed <b>' + solved.seed + '</b>',
    'build <b>' + solved.__ms.toFixed(1) + ' ms</b> in <b>' + solved.stages.of + '</b> stage(s)',
    timingLabel + ' <b>' + ms.toFixed(1) + ' ms</b>',
    current.time ? 'frames <b>' + render.playheads(current).length + '</b>' : 'no timeline',
  ].join('<br>');
  if (!playing) toUrl();
}

function stop() {
  playing = false;
  transportRevision++;
  cancelAnimationFrame(raf);
  silence();
  var b = document.getElementById('play');
  b.classList.remove('on');
  b.textContent = 'play';
  toUrl();
}

// THE SOUNDTRACK IN THE TRANSPORT. Playing a piece that declares sound plays its
// soundtrack with the picture, so an author hears the two together while
// working. It is rendered once per solve, on the first play, by the renderSound
// the exports use, and started where the transport is. The transport's own
// clock still draws every frame: the audio clock is read only to start the
// sound, and every change to the transport stops it. Exports never touch it.
var listener = null;       // the page's AudioContext, made or resumed in the play click
var soundtrack = null;     // { solved, buffer: a promise of its AudioBuffer }
var voice = null;          // the one playing source, or null
var transportOrigin = 0;   // performance.now() at the transport's playhead 0

// A lap of the transport lasts the frame grid, frames / hz, as the soundtrack
// and the film do. A declared duration that is no whole number of frames would
// otherwise add a silence and an off-grid playhead at every wrap.
function lapMs(p) { return (render.playheads(p).length / p.time.hz) * 1000; }

function silence() {
  if (!voice) return;
  var v = voice;
  voice = null;
  try { v.stop(); } catch (e) { /* a source that never started cannot stop */ }
  v.disconnect();
}

// Start the soundtrack where the transport is once it is rendered, unless the
// transport or the solve has moved on by then.
function playSound(transport) {
  if (!listener || !current.sound || !solved) return;
  var s = solved;
  if (!soundtrack || soundtrack.solved !== s) {
    soundtrack = { solved: s, buffer: render.renderSound(current, s, {
      OfflineAudioContext: typeof OfflineAudioContext === 'function' ? OfflineAudioContext : undefined,
    }) };
  }
  var entry = soundtrack;
  entry.buffer.then(function (buffer) {
    if (!playing || transport !== transportRevision || solved !== s || soundtrack !== entry) return;
    silence();
    var dur = lapMs(current);
    // Where the picture is now, plus the time the sound takes to reach the
    // speakers, so the two are heard and seen together.
    var at = ((performance.now() - transportOrigin) % dur) / 1000 + (listener.outputLatency || listener.baseLatency || 0);
    var v = listener.createBufferSource();
    v.buffer = buffer;
    v.connect(listener.destination);
    v.start(0, Math.min(at, buffer.duration));
    voice = v;
  }, function (e) {
    if (soundtrack === entry) err.textContent = 'the soundtrack could not be rendered: ' + String(e.message || e);
  });
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
  if (base.boxes) q.push('box=' + current.size.w + 'x' + current.size.h);
  document.getElementById('playerLink').href = '?' + q.concat('player=1').join('&');
  if (player) q.push('player=1');
  // Sandboxed documents and data URLs can refuse address-bar updates. The
  // recipe is optional persistence; a refusal must not interrupt the controls.
  try { history.replaceState(null, '', '?' + q.join('&')); }
  catch (e) { /* address-bar synchronization is best effort */ }
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
  var out = { piece: null, seed: null, t: null, params: {}, box: null };
  q.split('&').forEach(function (kv) {
    var i = kv.indexOf('=');
    if (i < 0) return;
    var k = decodeURIComponent(kv.slice(0, i));
    var v = decodeURIComponent(kv.slice(i + 1));
    if (k === 'piece') out.piece = v;
    else if (k === 'seed' && /^[0-9]+$/.test(v)) out.seed = Number(v);
    else if (k === 't' && isFinite(Number(v))) out.t = Math.min(1, Math.max(0, Number(v)));
    else if (k.indexOf('p.') === 0 && isFinite(Number(v))) out.params[k.slice(2)] = Number(v);
    else if (k === 'box' && /^[0-9.]+x[0-9.]+$/.test(v)) out.box = { w: Number(v.split('x')[0]), h: Number(v.split('x')[1]) };
  });
  return out.piece ? out : null;
}

document.getElementById('play').onclick = function () {
  if (!solved || !current.time) return;
  if (playing) return stop();
  playing = true;
  this.classList.add('on');
  this.textContent = 'pause';
  var dur = lapMs(current);
  var transport = ++transportRevision;
  var t0 = performance.now() - t * dur;
  transportOrigin = t0;
  // A browser starts audio only inside a user gesture, so the context is made,
  // or woken, here in the click. A piece without sound never makes one.
  if (current.sound && typeof AudioContext === 'function') {
    if (!listener) listener = new AudioContext();
    if (listener.state === 'suspended') listener.resume();
  }
  playSound(transport);
  var lap = 0;
  (function step(now) {
    if (!playing) return;
    // The wall clock drives the TRANSPORT and nothing else. drawFrame quantises
    // the playhead to the drawn-frame grid, so no mark ever sees this number. A
    // frame stamped before the click would put it below 0, so it is held there.
    t = Math.max(0, (now - t0) % dur) / dur;
    // The transport wrapped, so the soundtrack starts again with it. Laps are
    // counted rather than playheads compared: an animation frame can be stamped
    // a little before the click that started the transport.
    var laps = Math.floor((now - t0) / dur);
    if (laps > lap) { lap = laps; playSound(transport); }
    document.getElementById('t').value = t * 1000;
    var pending = frame();
    function next() { if (playing && transport === transportRevision) raf = requestAnimationFrame(step); }
    if (pending && pending.then) pending.then(next); else next();
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
    if (!solved) return;
    var k = Number(b.dataset.png);
    var filename = currentName + '-' + solved.seed + '@' + k + 'x.png';
    // Drawn at the click, with the recipe as it stands then.
    exporter.png(current, solved, t, k).then(function (blob) { save(blob, filename); })
      .catch(function (e) { err.textContent = String(e.message || e); });
  };
});

// The recipe for what is on screen: the frame drawn, not the one the slider
// was left at. Saved files carry the same one.
function recipe() {
  return exporter.recipe(current, solved, t);
}

document.getElementById('svg').onclick = function () {
  if (!solved) return;
  save(new Blob([exporter.svg(current, solved, t)], { type: 'image/svg+xml' }), currentName + '-' + solved.seed + '.svg');
};

// THE FILMS, from core/export.js: the real-time WebM, offered only where the
// MP4 cannot be encoded (see offerFilm), and the frame-exact MP4. Each saves
// nothing itself; the buttons save, and a headless check calls these and reads
// the report. The piece and its solve are held at the call, because an export
// runs for the length of the film and nothing stops anyone choosing another
// piece while it does.
async function exportVideo() {
  var p = current, s = solved, name = currentName;
  if (!s) throw new Error(err.textContent || 'the piece has no successful build to export');
  return exporter.webm(p, s, name);
}

async function exportFilm(opts) {
  var p = current, s = solved, name = currentName;
  if (!s) throw new Error(err.textContent || 'the piece has no successful build to export');
  return exporter.mp4(p, s, name, opts);
}

filmButtons.forEach(function (button) {
  button.onclick = function () {
    if (!solved || filmBusy) return;
    var request = solved;
    var note = document.getElementById('filmnote');
    var total = render.playheads(current).length;
    filmBusy = true;
    filmButtons.forEach(function (b) { b.disabled = true; });
    err.textContent = '';
    note.textContent = 'drawing and encoding ' + total + ' frames...';
    var lastNote = note.textContent;
    exportFilm({
      scale: button.dataset.film ? Number(button.dataset.film) : undefined,
      onProgress: function (done) {
        if (solved === request && note.textContent === lastNote) {
          note.textContent = 'frame ' + done + ' of ' + total;
          lastNote = note.textContent;
        }
      },
    }).then(function (r) {
      save(r.blob, r.name);
      if (solved !== request) return;
      note.textContent = exporter.filmNote(r);
    }).catch(function (e) {
      if (solved !== request) return;
      note.textContent = '';
      err.textContent = String(e.message || e);
    }).finally(function () {
      filmBusy = false;
      filmButtons.forEach(function (b) { b.disabled = !solved || !current.time; });
      if (solved !== request && note.textContent === lastNote) note.textContent = '';
    });
  };
});

document.getElementById('video').onclick = function () {
  if (!solved || videoBusy) return;
  var b = this;
  var request = solved;
  var note = document.getElementById('videonote');
  b.disabled = true;
  videoBusy = true;
  err.textContent = '';
  var pendingNote = 'encoding ' + render.playheads(current).length + ' frames...';
  note.textContent = pendingNote;
  exportVideo().then(function (r) {
    save(r.blob, r.name);
    if (solved !== request) return;
    note.textContent = r.frames + ' of ' + r.expected + ' frames, ' + r.seconds.toFixed(2) + ' s, '
      + Math.round(r.bytes / 1024) + ' kB. Gap between frames: median ' + r.medianGapMs.toFixed(1)
      + ' ms, p95 ' + r.p95GapMs.toFixed(1) + ' ms, max ' + r.maxGapMs.toFixed(1) + ' ms. Render '
      + r.renderMs.toFixed(0) + ' ms, encode ' + r.encodeMs.toFixed(0) + ' ms.';
  }).catch(function (e) {
    if (solved !== request) return;
    note.textContent = '';
    err.textContent = String(e.message || e);
  }).finally(function () {
    videoBusy = false;
    b.disabled = !solved || !current.time;
    if (solved !== request && note.textContent === pendingNote) note.textContent = '';
  });
};

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
  gpu: gpuPreview,
  setPreview: setPreview,
  video: exportVideo,
  film: exportFilm,
  // Integrated loudness and true peak of an AudioBuffer, by the meter the film
  // export levels its soundtrack with, so a decoded film can be measured, and
  // the levelling itself, gain and limiter, applied in place for a codec's
  // sample entry, so a fresh render can be levelled as the export levelled it.
  loudness: film.measureLoudness,
  level: film.normalizeLoudness,
  // The film export the page offers for the selected piece, once the encoders
  // have answered: 'mp4', 'webm' where H.264 cannot encode it or no codec can
  // encode its declared soundtrack, or null for a still. filmOffer() says why,
  // from the decision the WebM note is written from: { format, reason }, the
  // reason 'h264', 'soundtrack', 'still', or null for the MP4. video() and
  // film() stay callable either way; only the controls follow this.
  filmFormat: function () { return filmOffer.then(function (choice) { return choice.format; }); },
  filmOffer: function () { return filmOffer.then(function (choice) { return { format: choice.format, reason: choice.reason }; }); },
  examples: EXAMPLES,
  setSeed: function (s) { document.getElementById('seed').value = s; resolve(); },
  // Draw the selected piece at another box it declares; throws by name otherwise.
  setBox: function (w, h) { setBox(w, h); buildBox(); },
  setT: function (v) { stop(); t = v; document.getElementById('t').value = v * 1000; frame(); },
  read: function () {
    return {
      name: currentName, seed: solved && solved.seed, t: t,
      outputs: current.outputs, size: current.size, boxes: current.boxes, player: player, view: view,
      frames: render.playheads(current).length,
      error: err.textContent || null,
      preview: previewInfo,
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
  // literal, so an unescaped backtick in a comment ends it early.
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
  // The recipe for what is on screen right now; saved SVGs carry the same one.
  manifest: recipe,
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
  // A box this piece does not accept is left out, as a stale parameter is.
  if (from.box) {
    try { current = piece.atBox(base, from.box); } catch (e) { /* the declared box stands */ }
    sizeCanvas();
    offerFilm();
    buildBox();
  }
  buildParams();
  resolve();
} else {
  select(names[0]);
}

if (player) {
  document.body.classList.add('player');
  c.tabIndex = 0;
  c.setAttribute('role', 'button');
  c.setAttribute('aria-label', currentName + ': play or pause');
  var toggle = function () { var b = document.getElementById('play'); b.onclick.call(b); };
  c.onclick = toggle;
  c.onkeydown = function (e) { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } };
  // Debounced: a rebuild waits until the window has kept its size for 100 ms,
  // so a drag rebuilds once rather than on every event, and it then runs at the
  // start of an animation frame, never in the middle of drawing one.
  var fitting = 0, settling = 0;
  window.addEventListener('resize', function () {
    clearTimeout(settling);
    settling = setTimeout(function () {
      if (!fitting) fitting = requestAnimationFrame(function () { fitting = 0; fitPlayer(); });
    }, 100);
  });
  fitPlayer();
  // A browser starts sound only inside a gesture, so a piece with a soundtrack
  // waits for the first click; a silent one plays at once.
  if (current.time && !current.sound) toggle();
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
 * checkResolvable verifies module paths. This check also parses the page body
 * emitted by the template literal before writing the output file.
 *
 * Template escaping can turn a valid regex in this source into invalid browser
 * JavaScript, so validation must use the emitted script.
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
  const args = process.argv.slice(2);
  const style = args[0] === '--style' && args.length === 2;
  if (!style && (args.length > 1 || (args[0] && args[0].startsWith('--')))) throw new Error('usage: page [path/to/piece.cjs | --style <name>]');
  // Required when used: tools/styles.js requires tools/replay.js, which requires this module.
  const external = style ? require('./styles.js').load(args[1]) : args.length ? loadExternal(args[0]) : null;
  const page = html(bundle(external), external ? { count: 1 } : {});
  checkParses(page);
  const out = external ? external.directory : path.join(ROOT, 'out');
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, external ? external.stem + '-page.html' : 'index.html');
  fs.writeFileSync(file, page);
  console.log(`${external ? file : path.relative(ROOT, file)}  ${(Buffer.byteLength(page) / 1024).toFixed(1)} kB  ${MODULES.length + (external ? external.moduleCount : 0)} modules, no dependencies`);
}

/**
 * The module runtime plus the library modules `ids`, every one by default, for
 * any page that wants them. A list that leaves out a module one of its own
 * requires is refused by name here, before anything is written.
 */
function bundle(external = null, ids = MODULES) {
  checkResolvable(ids);
  return [RUNTIME].concat(ids.map(wrap), external ? [external.source] : []).join(String.fromCharCode(10));
}

module.exports = { modules, checkResolvable, reach, checkParses, bundle, html, wrap, MODULES };

// Requirable, so the resolution check can be tested. Without this the only
// check the delivery tool has would itself be unchecked. It runs after the
// exports are set, since --style reaches this module back through
// tools/styles.js and tools/replay.js.
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
