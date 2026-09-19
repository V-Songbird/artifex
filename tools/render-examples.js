#!/usr/bin/env node
'use strict';

// Render every example that declares vector, and report what each one reached.
// The numbers are printed rather than assumed: §5 of ../Docs/Artifex/subject-neutrality.md
// says every example publishes what it DECLARED and what it REACHED.

const fs = require('node:fs');
const path = require('node:path');

const { validate, solve, frameCount } = require('../core/piece.js');
const { renderVector, playheads } = require('../core/render.js');
const EXAMPLES = require('../examples/index.js');

const OUT = path.join(__dirname, '..', 'out');
fs.mkdirSync(OUT, { recursive: true });

const rows = [];
for (const [name, raw] of Object.entries(EXAMPLES)) {
  const p = validate(raw);
  const t0 = Date.now();
  const s = solve(p, p.seed);
  const buildMs = Date.now() - t0;

  const row = {
    name,
    declared: p.outputs.join('+'),
    box: `${p.size.w}x${p.size.h}`,
    frames: frameCount(p),
    build: `${buildMs}ms`,
    reached: '',
  };

  if (p.outputs.includes('vector')) {
    const t1 = Date.now();
    const r = renderVector(raw, { t: p.time ? 1 : 0 });
    fs.writeFileSync(path.join(OUT, `${name}.svg`), r.svg);
    row.reached = `${r.marks} marks, ${(r.svg.length / 1024).toFixed(0)} kB svg, ${Date.now() - t1}ms`;
  } else {
    // Stated, not skipped. A capability-gated step that says nothing reads as a
    // pass, and a suite that silently passes on absence is how a check over
    // cached layers passed on four subjects that had none.
    row.reached = 'SKIP: declares raster only, so there is no vector file to write';
  }
  rows.push(row);
}

const w = (k) => Math.max(...rows.map((r) => String(r[k]).length), k.length);
const cols = ['name', 'declared', 'box', 'frames', 'build', 'reached'];
const line = (r) => cols.map((c) => String(r[c]).padEnd(w(c))).join('  ');
console.log(line(Object.fromEntries(cols.map((c) => [c, c]))));
console.log(cols.map((c) => '-'.repeat(w(c))).join('  '));
for (const r of rows) console.log(line(r));

const timelines = rows.filter((r) => r.frames > 1);
console.log(`\n${rows.length} examples, ${rows.filter((r) => r.declared.includes('vector')).length} reach a plotter, `
  + `${timelines.length} have a timeline (${timelines.reduce((a, r) => a + r.frames, 0)} frames in total).`);
console.log(`SVG written to ${path.relative(path.join(__dirname, '..'), OUT)}${path.sep}`);
