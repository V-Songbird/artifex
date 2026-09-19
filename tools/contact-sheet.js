#!/usr/bin/env node
'use strict';

// Nine seeds, on one page, at once.
//
// WHY THIS EXISTS. SKILL.md names this practice twice as the only instrument
// that catches the half of the defects no check can see --
//
//   "Seed robustness is the real test. ... Render nine and look at all of them."
//   "the checks catch roughly half the defects. The other half are
//    compositional, and the only instrument for those is looking at nine seeds
//    at once."
//
// -- and the library shipped no way to do it. `npm run page` shows one seed
// behind a re-roll button. FOUR of the five authors handed this library built
// the same throwaway harness to see nine, each of them outside the repository,
// each of them throwing it away afterwards. The practice the documentation
// recommends most was the one it supported least.
//
// It renders live on canvases rather than writing SVG, so it works for a piece
// that declares raster only -- which is exactly the piece you cannot otherwise
// look at outside a browser.
//
//   npm run seeds                 every example, nine seeds each
//   npm run seeds drift           one piece
//   npm run seeds drift 16 0.5    sixteen seeds, at a playhead of 0.5

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { bundle } = require('./build-page.js');
const EXAMPLES = require('../examples/index.js');

function page(names, count, t) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Artifex — ${count} seeds</title>
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
  figure { margin:0; }
  canvas { width:100%; display:block; background:#fff; border:1px solid var(--line); }
  figcaption { color:var(--dim); margin-top:5px; }
  .bad { color:#e8705a; white-space:pre-wrap; }
</style>
</head>
<body>
<div id="out"></div>
<script>
${bundle()}
(function () {
  var req = __require('');
  var piece = req('core/piece.js');
  var render = req('core/render.js');
  var EX = req('examples/index.js');
  var NAMES = ${JSON.stringify(names)};
  var COUNT = ${count};
  var T = ${t};
  var out = document.getElementById('out');

  NAMES.forEach(function (name) {
    var p = piece.validate(EX[name]);
    var h2 = document.createElement('h2');
    h2.textContent = name;
    var note = document.createElement('p');
    note.className = 'note';
    note.textContent = p.size.w + ' \u00d7 ' + p.size.h + ' \u00b7 '
      + (p.time ? render.playheads(p).length + ' frames, shown at t=' + T : 'a still')
      + ' \u00b7 ' + p.outputs.join(' + ');
    var sheet = document.createElement('div');
    sheet.className = 'sheet';
    out.appendChild(h2); out.appendChild(note);
    // The knobs this piece declares, and what each one does. The sheet sweeps
    // seeds; this is what is holding still while it does, and it is the list
    // anyone deciding what to sweep NEXT has to read first.
    var keys = Object.keys(p.params);
    if (keys.length) {
      var knobs = document.createElement('ul');
      knobs.className = 'knobs';
      keys.forEach(function (k) {
        var d = p.params[k];
        var li = document.createElement('li');
        var nm = document.createElement('b');
        nm.textContent = k + ' ' + d.value;
        li.appendChild(nm);
        li.appendChild(document.createTextNode(
          ' \u00b7 ' + d.meaning + ' [' + d.min + '..' + d.max + ']'));
        knobs.appendChild(li);
      });
      out.appendChild(knobs);
    }
    out.appendChild(sheet);

    for (var i = 0; i < COUNT; i++) {
      // The seeds are the first COUNT integers, not random ones: a contact
      // sheet you cannot reproduce is an anecdote.
      var seed = i + 1;
      var fig = document.createElement('figure');
      var c = document.createElement('canvas');
      var k = 480 / p.size.w;
      c.width = Math.round(p.size.w * k);
      c.height = Math.round(p.size.h * k);
      var cap = document.createElement('figcaption');
      fig.appendChild(c); fig.appendChild(cap); sheet.appendChild(fig);
      try {
        var t0 = performance.now();
        var solved = piece.solve(p, seed);
        if (solved.stages.error) throw new Error(solved.stages.error.stage + ': ' + solved.stages.error.message);
        render.drawFrame(c.getContext('2d'), p, solved, T, { scale: k });
        cap.textContent = 'seed ' + seed + ' \u00b7 ' + (performance.now() - t0).toFixed(0) + ' ms';
      } catch (e) {
        cap.className = 'bad';
        cap.textContent = 'seed ' + seed + ' \u2014 ' + e.message;
      }
    }
  });

  window.__sheet = { names: NAMES, count: COUNT, t: T,
    failures: function () { return document.querySelectorAll('.bad').length; } };
})();
</script>
</body>
</html>
`;
}

function main() {
  const [which, n, t] = process.argv.slice(2);
  const names = which ? [which] : Object.keys(EXAMPLES);
  for (const name of names) {
    if (!EXAMPLES[name]) {
      throw new Error(`no example called "${name}". Known: ${Object.keys(EXAMPLES).join(', ')}`);
    }
  }
  const count = n ? Number(n) : 9;
  if (!Number.isInteger(count) || count < 1) throw new Error(`seeds: count must be a positive integer, got ${n}`);
  const at = t === undefined ? 1 : Number(t);
  if (!Number.isFinite(at)) throw new Error(`seeds: playhead must be a number, got ${t}`);

  const out = path.join(ROOT, 'out');
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, names.length === 1 ? `${names[0]}-seeds.html` : 'seeds.html');
  const html = page(names, count, at);
  fs.writeFileSync(file, html);
  console.log(`${path.relative(ROOT, file)}  ${(Buffer.byteLength(html) / 1024).toFixed(1)} kB`);
  console.log(`${names.length} piece(s) x ${count} seeds at t=${at}. Open it and LOOK -- the checks cannot see this half.`);
}

if (require.main === module) main();

module.exports = { page };
