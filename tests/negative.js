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
    from: '  return Math.min(1, Math.round(tt * n) / n);',
    to: '  return tt;',
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
