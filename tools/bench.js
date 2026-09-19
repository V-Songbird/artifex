#!/usr/bin/env node
'use strict';

// The benchmark. A speed claim is a number or it is nothing.
//
// ../Docs/Artifex/README.md, "The objective": generation speed and render cost are two of
// the four axes this project is judged on, and neither can be inferred from a
// file size, a module count or a build that succeeded. So they are measured
// here, the same way every time, and a change that claims to be faster runs it.
//
// WHAT IS MEASURED, AND WHY THOSE THREE.
//
//   build   solve(piece, seed) -- every stage, before a single mark is placed.
//           This is what a contact sheet pays per seed and a video pays once.
//   draw    one frame onto a real surface. This is what a video pays per frame
//           and a page pays per repaint.
//   marks   how much picture came out. Milliseconds alone reward a renderer for
//           drawing less, so the rate is reported beside the time.
//
// MEDIAN AND p95, NOT MEAN. One garbage-collection pause makes a mean lie about
// every other run. The median is what a user feels; p95 is the stutter they
// notice. A mean hides both.
//
// The seeds are the first N integers, never random: a benchmark you cannot
// reproduce is an anecdote. Same reason as tools/contact-sheet.js.

const fs = require('node:fs');
const path = require('node:path');

const { validate, solve, frameCount } = require('../core/piece.js');
const { drawFrame, playheads } = require('../core/render.js');
const { VectorSurface } = require('../core/surface-vector.js');
const EXAMPLES = require('../examples/index.js');

const OUT = path.join(__dirname, '..', 'out');
const BASELINE = path.join(OUT, 'bench.json');

const REPS = Number(process.env.BENCH_REPS || 40);
const WARMUP = 8;

/**
 * A null surface: the whole Canvas2D-shaped vocabulary, costing as close to
 * nothing as a method call can.
 *
 * WHY IT EXISTS. Timing `draw` against the vector surface measures the piece AND
 * the SVG serialiser together, so a change to either moves the number and
 * neither can be read on its own. This one separates them: the difference
 * between a null-surface draw and a vector-surface draw IS the cost of emitting.
 *
 * It is built from the vector surface's own prototype rather than from a hand
 * list, so a method added there cannot quietly go unmeasured here -- the same
 * reason the drift guard in tests/examples.test.js derives its vocabulary.
 */
function nullSurface(size) {
  const g = { width: size.w, height: size.h, calls: 0 };
  const proto = Object.getOwnPropertyNames(VectorSurface.prototype);
  const noop = function () { g.calls++; };
  for (const k of proto) {
    if (k === 'constructor' || k === 'toSVG') continue;
    const d = Object.getOwnPropertyDescriptor(VectorSurface.prototype, k);
    if (d.get || d.set) { g[k] = 0; continue; }          // a style property: a plain slot
    g[k] = noop;
  }
  g.measureText = () => ({ width: 0 });
  g.createLinearGradient = () => ({ addColorStop() {} });
  g.createRadialGradient = () => ({ addColorStop() {} });
  return g;
}

function timeIt(fn, reps = REPS) {
  for (let i = 0; i < WARMUP; i++) fn(i);
  const ms = [];
  for (let i = 0; i < reps; i++) {
    const t0 = process.hrtime.bigint();
    fn(i);
    ms.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  ms.sort((a, b) => a - b);
  return {
    med: ms[ms.length >> 1],
    p95: ms[Math.min(ms.length - 1, Math.floor(ms.length * 0.95))],
    min: ms[0],
  };
}

function measure(name, piece) {
  const p = validate(piece);
  const build = timeIt((i) => solve(p, i + 1));
  const solved = solve(p, 1);

  const vec = p.outputs.includes('vector');
  const size = p.size;

  const nul = nullSurface(size);
  const drawOnly = timeIt(() => { drawFrame(nul, p, solved, 1); });

  let emit = null;
  let marks = 0;
  let bytes = 0;
  if (vec) {
    emit = timeIt(() => {
      const g = new VectorSurface(size);
      drawFrame(g, p, solved, 1);
      const svg = g.toSVG();
      marks = g.markCount;
      bytes = svg.length;
    });
  }

  return {
    name,
    size: `${size.w}x${size.h}`,
    frames: p.time ? frameCount(p) : 1,
    stages: p.build ? p.build.length : 0,
    build,
    draw: drawOnly,
    emit,
    marks,
    bytes,
    vector: vec,
  };
}

/** The whole timeline, once. What a video walk will actually cost. */
function walk(name, piece) {
  const p = validate(piece);
  if (!p.time) return null;
  const solved = solve(p, 1);
  const ts = playheads(p);
  const g = nullSurface(p.size);
  const t0 = process.hrtime.bigint();
  for (const t of ts) drawFrame(g, p, solved, t);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { frames: ts.length, ms, per: ms / ts.length, fps: 1000 / (ms / ts.length) };
}

function pad(s, w, right = false) {
  s = String(s);
  return right ? s.padStart(w) : s.padEnd(w);
}

function f(v, d = 2) { return v === null || v === undefined ? '--' : v.toFixed(d); }

/**
 * The whole cost of one picture from one seed: every build stage, plus the draw,
 * plus whatever the emitter charges.
 *
 * Compared as a TOTAL rather than per-column, because the columns are not
 * independent -- moving work out of a build stage and into a draw is not an
 * improvement, and a column-by-column delta would report it as one. It also
 * stops a 2 ms number's own jitter being read as a change.
 */
function total(r) {
  return r.build.med + (r.emit ? r.emit.med : r.draw.med);
}

function delta(now, was) {
  if (!was || !Number.isFinite(was) || was === 0) return '';
  const pct = ((now - was) / was) * 100;
  if (Math.abs(pct) < 5) return '  =';
  return `${pct > 0 ? '+' : ''}${pct.toFixed(0)}%`;
}

function main() {
  const prev = fs.existsSync(BASELINE)
    ? JSON.parse(fs.readFileSync(BASELINE, 'utf8'))
    : null;
  const was = {};
  if (prev) for (const r of prev.rows) was[r.name] = r;

  const rows = [];
  for (const [name, piece] of Object.entries(EXAMPLES)) rows.push(measure(name, piece));

  const W = [12, 10, 7, 9, 9, 9, 8, 9, 8, 8];
  const head = ['piece', 'size', 'marks', 'build', 'draw', 'emit', 'svg kB', 'marks/ms', 'total', 'vs base'];
  console.log(head.map((h, i) => pad(h, W[i], i > 1)).join(' '));
  console.log(W.map((w) => '-'.repeat(w)).join(' '));

  for (const r of rows) {
    const b = was[r.name];
    const emitOnly = r.emit ? r.emit.med - r.draw.med : null;
    console.log([
      pad(r.name, W[0]),
      pad(r.size, W[1], true),
      pad(r.marks || '--', W[2], true),
      pad(f(r.build.med), W[3], true),
      pad(f(r.draw.med), W[4], true),
      pad(f(emitOnly), W[5], true),
      pad(r.bytes ? (r.bytes / 1000).toFixed(1) : '--', W[6], true),
      pad(r.marks && r.emit ? (r.marks / r.emit.med).toFixed(0) : '--', W[7], true),
      pad(f(total(r)), W[8], true),
      pad(b ? delta(total(r), total(b)) : '', W[9], true),
    ].join(' '));
  }

  console.log('');
  console.log('build = solve(), every stage.  draw = one frame to a null surface.');
  console.log('emit  = the SVG serialiser alone (vector draw minus null draw).');
  console.log(`median of ${REPS} runs, seeds 1..${REPS}, after ${WARMUP} warm-up runs.`);

  const walks = [];
  for (const [name, piece] of Object.entries(EXAMPLES)) {
    const w = walk(name, piece);
    if (w) walks.push([name, w]);
  }
  if (walks.length) {
    console.log('');
    console.log('timeline walk -- the whole video, drawn once:');
    for (const [name, w] of walks) {
      console.log(`  ${pad(name, 12)} ${pad(w.frames, 4, true)} frames  `
        + `${pad(f(w.ms, 1), 8, true)} ms  ${pad(f(w.per, 2), 7, true)} ms/frame  `
        + `${pad(f(w.fps, 0), 6, true)} fps`);
    }
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(BASELINE, JSON.stringify({ at: new Date().toISOString(), rows }, null, 1));
  console.log('');
  console.log(`baseline written to ${path.relative(process.cwd(), BASELINE)} -- the next run reports the change.`);
}

if (require.main === module) main();

module.exports = { nullSurface, timeIt, measure, walk };
