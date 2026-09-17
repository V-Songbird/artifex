#!/usr/bin/env node
'use strict';

// Break it on purpose, and check that the RIGHT test notices.
//
// A green suite is evidence only if it could have been red. The engine this
// project imports from ran this experiment on itself and FOUR OF NINE mutations
// escaped its own checks -- two were real gaps, two were mistakes in the
// mutations, and one was a check working correctly while looking like an escape.
// From outside, all five read identically. That is why this reports three
// verdicts and not two:
//
//   ESCAPED    nothing failed. The suite does not cover this.
//   MISNAMED   something failed, but not the test aimed at. Catching the right
//              break for the wrong reason is the same bug one level up.
//   ok         the expected test failed.
//
// It mutates TEXT in a copy, never a tracked file, and refuses a patch that is
// absent or that matches more than once -- a mutation that lands in two places
// is not the experiment you wrote.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

/** Each mutation names the file, a UNIQUE substring, its replacement, and the test it must trip. */
const MUTATIONS = [
  {
    why: 'unknown top-level keys are accepted',
    file: 'core/piece.js',
    from: 'if (unknown.length) {',
    to: 'if (false) {',
    expect: 'an unknown key is refused and named',
  },
  {
    why: 'the build reports the stages it FINISHED instead of the ones it declared',
    file: 'core/piece.js',
    from: 'return { state, seed: sd, stages: { ms, of: piece.build.length, error } };',
    to: 'return { state, seed: sd, stages: { ms, of: ms.length, error } };',
    expect: 'solve reports every DECLARED stage, not only the ones that finished',
  },
  {
    why: 'a timeline becomes mandatory, so a still is no longer a legal piece',
    file: 'core/piece.js',
    from: '      if (v === null) return null;',
    to: '      if (v === null) return "a piece must have a timeline";',
    expect: 'A STILL IS A LEGAL PIECE, and a timeline is opt-in',
  },
  {
    why: 'the playhead is not quantised to the drawn-frame grid',
    file: 'core/piece.js',
    from: '  return frameIndex(piece, t) / frameDen(piece);',
    to: '  return Math.min(1, Math.max(0, t));',
    expect: 'a timeline quantises to the drawn-frame grid, and clamps outside [0,1]',
  },
  {
    why: 'stroke width ignores the transform',
    file: 'core/surface-vector.js',
    from: '`stroke-width="${n(st.lineWidth * k)}"`',
    to: '`stroke-width="${n(st.lineWidth)}"`',
    expect: 'stroke width scales by sqrt(|det|) of the transform',
  },
  {
    why: 'a non-finite coordinate is written to the file instead of throwing',
    file: 'core/surface-vector.js',
    from: "  if (!Number.isFinite(v)) throw new Error(`vector surface: non-finite coordinate ${v}`);",
    to: '  if (!Number.isFinite(v)) return String(v);',
    expect: 'a non-finite coordinate throws rather than reaching the file',
  },
  {
    why: 'the transform is dropped instead of baked into coordinates',
    file: 'core/surface-vector.js',
    from: '  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];',
    to: '  return [x, y];',
    expect: 'the transform is baked into coordinates',
  },
  {
    why: 'the arc-to-Bezier constant is wrong, so a circle is not a circle',
    file: 'core/surface-vector.js',
    from: '    const alpha = (4 / 3) * Math.tan(step / 4);',
    to: '    const alpha = Math.tan(step / 4);',
    expect: 'a full arc approximates a circle to better than 3e-4 of its radius',
  },
  {
    why: 'a style string reaches the document unescaped',
    file: 'core/surface-vector.js',
    from: "  return String(s).replace(/[&<>\"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[c]));",
    to: '  return String(s);',
    expect: 'a colour or a stop is escaped, so a string cannot close an attribute',
  },
  {
    why: 'vector output is handed to a piece that never declared it',
    file: 'core/render.js',
    from: "  if (!p.outputs.includes('vector')) {",
    to: '  if (false) {',
    expect: 'vector output is REFUSED for a piece that did not declare it',
  },
  {
    why: 'a draw that throws leaves its transform on the surface',
    file: 'core/render.js',
    from: '    if (surface.restore) surface.restore();',
    to: '    if (false) surface.restore();',
    expect: 'drawFrame leaves the surface state as it found it, even if draw throws',
  },
  {
    why: 'a still is given more than one playhead',
    file: 'core/render.js',
    from: '  if (n === 1) return [0];',
    to: '  if (n === 1) return [0, 0];',
    expect: 'a still has exactly one playhead, and it is 0',
  },
  {
    why: 'render scale is capped at 2, putting print resolution out of reach',
    file: 'core/render.js',
    from: '  const scale = opt.scale === undefined ? 1 : opt.scale;',
    to: '  const scale = Math.min(2, opt.scale === undefined ? 1 : opt.scale);',
    expect: 'scale is not capped, so print resolution is reachable',
  },

  // --- the stochastic source ----------------------------------------------
  {
    why: 'the two halves of an address run together, so unrelated quantities share a value',
    file: 'core/rand.js',
    from: '    h = fnv1a(SEP + property, h);',
    to: '    h = fnv1a(property, h);',
    expect: 'the two halves of an address do not run together',
  },
  {
    why: 'the finaliser is dropped, so consecutive indices walk slowly',
    file: 'core/rand.js',
    from: '    return mix32(h ^ Math.imul(index | 0, 0x9e3779b1)) / 4294967296;',
    to: '    return ((h ^ Math.imul(index | 0, 0x9e3779b1)) >>> 0) / 4294967296;',
    expect: 'near addresses do not give near values',
  },
  {
    why: 'noise2 ignores the field name, so every irregularity has one cause',
    file: 'core/rand.js',
    from: "function noise2(R, x, y, name = 'field') {",
    to: "function noise2(R, x, y, ignored = 'field') { const name = 'field';",
    expect: 'two named fields are independent at the same point',
  },
  {
    why: 'every fbm octave reads the same field, so the octaves buy nothing',
    file: 'core/rand.js',
    from: 'sum += amp * noise2(R, x * (1 << o), y * (1 << o), `${name}/${o}`);',
    to: 'sum += amp * noise2(R, x * (1 << o), y * (1 << o), name);',
    expect: 'fbm octaves are separate fields, not one field read at two scales',
  },

  // --- declared parameters --------------------------------------------------
  {
    why: 'a declared parameter never reaches the build, so it cannot move the output',
    file: 'core/piece.js',
    from: '    state.params[k] = v;',
    to: '    state.params[k] = d.value;',
    expect: 'EVERY DECLARED PARAMETER MOVES THE OUTPUT, at three pins and not two',
  },
  {
    why: 'a parameter outside its declared range is accepted',
    file: 'core/piece.js',
    from: '    if (!Number.isFinite(v) || v < d.min || v > d.max) {',
    to: '    if (false) {',
    expect: 'an undeclared parameter is refused by name',
  },

  // --- the examples, which are the real specification -----------------------
  {
    why: 'THE CROSSBAR: a two-point straight run is filtered out of a glyph',
    file: 'examples/stroke-font.js',
    from: '    for (const run of glyph(ch)) {',
    to: '    for (const run of glyph(ch).filter((q) => q.length > 2)) {',
    expect: 'specimen: every run of every glyph survives being drawn',
  },
  {
    why: 'an unknown character quietly draws a different glyph',
    file: 'examples/stroke-font.js',
    from: "  if (src === undefined || src === '') return [];",
    to: "  if (src === undefined || src === '') return glyph('X');",
    expect: 'specimen: an unknown character is a gap, never a substituted glyph',
  },
  {
    why: 'a line fades up instead of arriving, so every laid dab changes with the playhead',
    file: 'examples/drift.js',
    from: '        g.globalAlpha = 0.03 + st.press * 0.05 * (0.5 + grit * 0.9);',
    to: '        g.globalAlpha = progress * 0.08;',
    expect: 'drift: THE LINE ARRIVES -- a pen travels, it does not fade up',
  },
  {
    why: 'the subdivision is uniform, so every cell gets the same attention',
    file: 'examples/partition.js',
    from: 'const keep = d < maxDepth && w > 15 && h > 15 && (want * 0.95 + grain * 0.32) > 0.44;',
    to: 'const keep = d < maxDepth && w > 15 && h > 15 && (0.95 + grain * 0.32) > 0.44;',
    expect: 'partition: detail falls away from the focus rather than filling the sheet',
  },
  {
    why: 'contour segments are not chained, so a plotter lifts the pen thousands of times',
    file: 'examples/contours.js',
    from: '      s.paths = chain(segs).map((pts) => pts.map(([gx, gy]) => [',
    to: '      s.paths = segs.map((pts) => pts.map(([gx, gy]) => [',
    expect: 'contours: chaining collapses the segments into few pen-down paths',
  },
  {
    why: 'the seed reaches the DATA, so a re-roll makes the piece say something else',
    file: 'examples/readout.js',
    from: '          digit: Number(DIGITS[k]),',
    to: '          digit: Number(DIGITS[(k + s.seed) % DIGITS.length]),',
    expect: 'readout: the DATA is not seeded, and the presentation is',
  },
  {
    why: 'render scale is ignored entirely, so a print is the size of a screen',
    file: 'core/render.js',
    from: '  if (scale !== 1 && surface.scale) surface.scale(scale, scale);',
    to: '  if (false && surface.scale) surface.scale(scale, scale);',
    expect: 'N7 -- macro geometry is preserved from 1x to 8x',
  },
// --- the accessors that were implemented and never once run ---------------
  {
    why: 'strokeRect fills instead of stroking, so it means one thing live and another on export',
    file: 'core/surface-vector.js',
    from: 'strokeRect(x, y, w, h) { this.beginPath(); this.rect(x, y, w, h); return this.stroke(); }',
    to: 'strokeRect(x, y, w, h) { this.beginPath(); this.rect(x, y, w, h); return this.fill(); }',
    expect: 'strokeRect is a rect and a stroke, so the live path and the vector path agree',
  },
  {
    why: 'resetTransform is a no-op, so a caller escaping a transform stack keeps it',
    file: 'core/surface-vector.js',
    from: 'resetTransform() { this._st.m = [1, 0, 0, 1, 0, 0]; return this; }',
    to: 'resetTransform() { return this; }',
    expect: 'resetTransform drops the whole transform stack back to identity',
  },
  {
    why: 'a mitre limit is written for joins that have no mitre',
    file: 'core/surface-vector.js',
    from: "st.lineJoin === 'miter' && st.miterLimit !== 10 ?",
    to: 'st.miterLimit !== 10 ?',
    expect: 'miterLimit reaches the document, and only where it can matter',
  },
  {
    why: 'the dash offset ignores the transform, so a print comes back with screen-sized dashes',
    file: 'core/surface-vector.js',
    from: 'stroke-dashoffset="${n(st.lineDashOffset * k)}"',
    to: 'stroke-dashoffset="${n(st.lineDashOffset)}"',
    expect: 'a dash offset is written, and scales with the transform like the dashes do',
  },
  {
    why: 'getLineDash hands out the live array, so a caller can change the surface by accident',
    file: 'core/surface-vector.js',
    from: 'getLineDash() { return this._st.lineDash.slice(); }',
    to: 'getLineDash() { return this._st.lineDash; }',
    expect: 'getLineDash hands back a copy, so a caller cannot reach in and change it',
  },
  {
    why: 'setTransform composes instead of replacing, so a piece cannot escape an outer transform',
    file: 'core/surface-vector.js',
    from: 'setTransform(a, b, c, d, e, f) { this._st.m = [a, b, c, d, e, f]; return this; }',
    to: 'setTransform(a, b, c, d, e, f) { this._st.m = mul(this._st.m, [a, b, c, d, e, f]); return this; }',
    expect: 'setTransform REPLACES the transform where transform() multiplies it',
  },

  // --- the frame lattice, after the field test found it dropping frames ------
  {
    why: 'a piece that does not loop is walked on the looping lattice, so a frame is lost',
    file: 'core/piece.js',
    from: '  return piece.time.loop ? n : n - 1;',
    to: '  return n;',
    expect: 'playheads visits EVERY drawn frame exactly once, and none of them twice',
  },
  {
    why: 'playheads samples the grid instead of walking it -- the original dropped-frame bug',
    file: 'core/render.js',
    from: '  return Array.from({ length: n }, (_, i) => i / den);',
    to: '  return Array.from({ length: n }, (_, i) => frameT(p, i / (n - 1)));',
    expect: 'playheads visits EVERY drawn frame exactly once, and none of them twice',
  },
  {
    why: 'a looping playhead does not wrap, so t=1 is a frame past the end',
    file: 'core/piece.js',
    from: '    return Math.round(tt * n) % n;',
    to: '    return Math.round(tt * n);',
    expect: 'the frame index is an integer in [0, frames-1] wherever the playhead lands',
  },
  {
    why: 'the clock reports seconds against the duration instead of the draw rate',
    file: 'core/piece.js',
    from: '    seconds: piece.time ? frame / piece.time.hz : 0,',
    to: '    seconds: piece.time ? frame / piece.time.duration : 0,',
    expect: 'draw is handed a clock, so a piece need not restate its own timeline',
  },
  {
    why: 'draw is handed the playhead and nothing else, so a piece must restate its own timeline',
    file: 'core/render.js',
    from: '    piece.draw(surface, solved.state, tt, clock);',
    to: '    piece.draw(surface, solved.state, tt);',
    expect: 'draw is handed a clock, so a piece need not restate its own timeline',
  },

  // --- the measuring instrument ---------------------------------------------
  {
    why: 'the harness loses a surface operation, and quietly forbids an example from using it',
    file: 'tests/examples.test.js',
    from: '  roundRect(x, y, w, h, radii = 0) {',
    to: '  roundRectRemoved(x, y, w, h, radii = 0) {',
    expect: 'THE RECORDER IMPLEMENTS THE WHOLE SURFACE, so the suite cannot narrow the art',
  },
  {
    why: 'an arc is recorded as a point, so a piece of pure discs passes the resolution check',
    file: 'tests/examples.test.js',
    from: '    const k = this._rad(x, y, rad);',
    to: '    const k = rad * this._k; this._pt(x, y);',
    expect: 'the recorder sees an arc as an area, not as a point',
  },
  {
    why: 'an arc forgets its sweep, so a change of phase is invisible to every determinism check',
    file: 'tests/examples.test.js',
    from: "    const key = `A${r(this._x(x, y))},${r(this._y(x, y))},${r(k)},${r(a)},${r(b)},${ccw ? 1 : 0}`",
    to: "    const key = `A${r(this._x(x, y))},${r(this._y(x, y))},${r(k)}`",
    expect: 'the recorder sees an arc sweep, so a change of phase cannot hide',
  },

  // --- the delivery tool ------------------------------------------------------
  {
    why: 'the page builder writes a bundle with a hole in it and exits 0',
    file: 'tools/build-page.js',
    from: '  if (bad.length) {',
    to: '  if (false) {',
    expect: 'the page builder refuses to write a bundle with a hole in it',
  },
  {
    why: 'the page builder goes back to a hand-maintained module list',
    file: 'tools/build-page.js',
    from: "    ...files('examples').filter((f) => f !== 'examples/index.js'),",
    to: "    'examples/drift.js',",
    expect: 'the page builder refuses to write a bundle with a hole in it',
  },

];

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

/** Run the suite in `dir`, returning the names of the tests that failed. */
function runSuite(dir) {
  let out;
  try {
    out = execFileSync(process.execPath, ['--test', 'tests/*.test.js'], {
      cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    out = `${e.stdout || ''}${e.stderr || ''}`;
  }
  return [...out.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1].trim());
}

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-negative-'));
  let escaped = 0, misnamed = 0, passed = 0, invalid = 0;

  try {
    // The control. If the suite is not green to begin with, nothing below means
    // anything -- a mutation cannot be blamed for a failure that was already there.
    const control = path.join(tmp, 'control');
    copyDir(ROOT, control);
    const already = runSuite(control);
    if (already.length) {
      console.error('CONTROL IS NOT GREEN. Fix the suite before running this.');
      for (const t of already) console.error(`  ${t}`);
      process.exit(2);
    }
    console.log(`control  ${MUTATIONS.length} mutations, suite green before any of them\n`);

    for (const [i, m] of MUTATIONS.entries()) {
      const dir = path.join(tmp, `m${i}`);
      copyDir(ROOT, dir);
      const file = path.join(dir, m.file);
      const src = fs.readFileSync(file, 'utf8');

      const hits = src.split(m.from).length - 1;
      if (hits === 0) { console.log(`MUTATION MISS   ${m.why}\n                patch text not found in ${m.file}`); invalid++; continue; }
      if (hits > 1) { console.log(`MUTATION AMBIG  ${m.why}\n                patch text matches ${hits} times in ${m.file}`); invalid++; continue; }

      fs.writeFileSync(file, src.replace(m.from, m.to));
      const failed = runSuite(dir);

      if (failed.length === 0) {
        console.log(`ESCAPED         ${m.why}\n                nothing failed; no check covers this`);
        escaped++;
      } else if (!failed.includes(m.expect)) {
        console.log(`MISNAMED        ${m.why}\n                expected: ${m.expect}\n                failed:   ${failed.join(' | ')}`);
        misnamed++;
      } else {
        console.log(`ok              ${m.why}`);
        passed++;
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\n${passed} caught  ${escaped} escaped  ${misnamed} misnamed  ${invalid} invalid`);
  process.exit(escaped + misnamed + invalid === 0 ? 0 : 1);
}

main();
