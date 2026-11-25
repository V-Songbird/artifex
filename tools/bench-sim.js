#!/usr/bin/env node
'use strict';

// Time core/sim.js's simulate on seeded piles of discs, broad phase against
// everyPair.
//
// Each run is a fresh node process, so a run cannot warm the next one, and the
// two variants alternate, so a load that comes and goes lands on both. The
// table gives each variant's median, its range and the whole machine's CPU load
// during its runs, which includes the timed run itself (about one core's share),
// and the SHA-256 of a run's positions,
// velocities and contacts: every run of one pile must print one digest, or the
// broad phase has changed the bytes, and the tool exits 1.
//
// The piles are seeded, never random, like the seeds of tools/bench.js. All
// have 24 Hz, 16 substeps, 4 iterations, gravity 900 and a floor and two side
// walls. The first three have no other walls, so `simulate` builds no wall
// grid; pegboard's 234 walls make it build one:
//
//   uniform   1000 discs of radius 3 to 8 scattered in a box 1200 wide and high
//   bimodal   501 discs of radius 1 and 500 of radius 5 in the same box
//   mixed     1000 discs of radius 2 in a band 300 high and 3000 wide, and 50
//             of radius 200 and mass 50 in rows above it
//   pegboard  600 discs of radius 3 to 6 in a band 480 high, falling onto 231
//             pegs 26 long, tilted, in 14 staggered rows below them

const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PILES = ['uniform', 'bimodal', 'mixed', 'pegboard'];
const VARIANTS = [{ label: 'broad phase', everyPair: false }, { label: 'every pair', everyPair: true }];
const USAGE = 'usage: node tools/bench-sim.js [--pile uniform,bimodal,mixed,pegboard] [--runs 5] [--frames 24]';

/** The particles and walls of a named pile; the same every time it is asked. */
function pile(name) {
  let s = 1;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const particles = [];
  const box = (w) => [
    { from: [-w, 0], to: [2 * w, 0] },
    { from: [0, -4000], to: [0, 0] },
    { from: [w, -4000], to: [w, 0] },
  ];
  const scatter = (count, radius) => {
    for (let i = 0; i < count; i++) particles.push({ x: 20 + rnd() * 1160, y: -20 - rnd() * 1160, radius: radius(), mass: 1 });
  };
  if (name === 'uniform') {
    scatter(1000, () => 3 + rnd() * 5);
    return { particles, walls: box(1200) };
  }
  if (name === 'bimodal') {
    scatter(1001, () => particles.length < 501 ? 1 : 5);
    return { particles, walls: box(1200) };
  }
  if (name === 'pegboard') {
    for (let i = 0; i < 600; i++) particles.push({ x: 20 + rnd() * 1160, y: -700 - rnd() * 480, radius: 3 + rnd() * 3, mass: 1 });
    const pegs = [];
    for (let r = 0; r < 14; r++) {
      const y = -80 - r * 45;
      const tilt = r % 2 ? 5 : -5;
      for (let c = 0; c < 17 - (r % 2); c++) {
        const x = 40 + (r % 2) * 34 + c * 68;
        pegs.push({ from: [x - 12, y - tilt], to: [x + 12, y + tilt] });
      }
    }
    return { particles, walls: box(1200).concat(pegs) };
  }
  if (name !== 'mixed') throw new RangeError(`bench-sim: no pile named "${name}"; the piles are ${PILES.join(', ')}`);
  for (let i = 0; i < 1000; i++) particles.push({ x: 10 + rnd() * 2980, y: -10 - rnd() * 280, radius: 2, mass: 1 });
  for (let i = 0; i < 50; i++) particles.push({ x: 200 + (i % 7) * 400 + rnd() * 5, y: -500 - Math.floor(i / 7) * 420, radius: 200, mass: 50 });
  return { particles, walls: box(3000) };
}

/** The digest of one simulate result: positions, velocities and every contact. */
function digest(r) {
  return crypto.createHash('sha256').update(Buffer.from(r.xy.buffer)).update(Buffer.from(r.vxy.buffer)).update(JSON.stringify(r.contacts)).digest('hex').slice(0, 12);
}

/** One run in this process; prints `{ ms, digest }` for the parent to read. */
function child(name, variant, frames) {
  if (!VARIANTS[variant]) throw new RangeError(`bench-sim: no variant ${variant}`);
  const { simulate } = require('../core/sim.js');
  const { particles, walls } = pile(name);
  const spec = { frames, hz: 24, substeps: 16, iterations: 4, gravity: [0, 900], particles, walls };
  const t0 = process.hrtime.bigint();
  const r = simulate(spec, { everyPair: VARIANTS[variant].everyPair });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(JSON.stringify({ ms, digest: digest(r) }));
}

/** The share of the machine's CPU time spent busy between two `os.cpus()` readings. */
function busy(a, b) {
  let total = 0;
  let idle = 0;
  a.forEach((c, i) => {
    for (const k of Object.keys(c.times)) total += b[i].times[k] - c.times[k];
    idle += b[i].times.idle - c.times.idle;
  });
  return total > 0 ? 100 * (1 - idle / total) : 0;
}

function median(v) {
  const s = [...v].sort((a, b) => a - b);
  return s[s.length >> 1];
}

function parseArgs(args) {
  const out = { piles: PILES, runs: 5, frames: 24 };
  const whole = (flag, v) => {
    if (!/^[1-9]\d*$/.test(v ?? '')) throw new Error(`${flag} needs a whole number of 1 or more, got ${v === undefined ? 'nothing' : `"${v}"`}`);
    return Number(v);
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--pile') {
      const v = args[++i];
      const list = (v ?? '').split(',');
      const bad = list.find((p) => !PILES.includes(p));
      if (v === undefined || bad !== undefined) throw new Error(`--pile needs piles from ${PILES.join(', ')}, got ${v === undefined ? 'nothing' : `"${bad}"`}`);
      out.piles = list;
    } else if (a === '--runs') out.runs = whole(a, args[++i]);
    else if (a === '--frames') out.frames = whole(a, args[++i]);
    else throw new Error(a.startsWith('-') ? `unknown option ${a}` : `unexpected argument "${a}"`);
  }
  return out;
}

function main({ piles, runs, frames }) {
  const rows = [];
  let same = true;
  for (const name of piles) {
    const got = VARIANTS.map(() => ({ ms: [], load: [], digests: new Set() }));
    for (let r = 0; r < runs; r++) {
      VARIANTS.forEach(({ label }, v) => {
        const before = os.cpus();
        const run = spawnSync(process.execPath, [__filename, '--child', name, String(v), String(frames)], { encoding: 'utf8' });
        const load = busy(before, os.cpus());
        if (run.status !== 0) throw new Error(`${name} ${label} failed: ${run.stderr.trim() || run.error || (run.signal ? `killed by ${run.signal}` : `exit status ${run.status}`)}`);
        const result = JSON.parse(run.stdout);
        got[v].ms.push(result.ms);
        got[v].load.push(load);
        got[v].digests.add(result.digest);
      });
    }
    const all = new Set(got.flatMap((g) => [...g.digests]));
    if (all.size !== 1) same = false;
    VARIANTS.forEach(({ label }, v) => {
      const g = got[v];
      rows.push([name, frames, label, runs, `${Math.round(median(g.ms))} (${Math.round(Math.min(...g.ms))}-${Math.round(Math.max(...g.ms))})`,
        `${Math.round(Math.min(...g.load))}-${Math.round(Math.max(...g.load))}`, [...g.digests].join(',')]);
    });
  }
  const head = ['pile', 'frames', 'variant', 'runs', 'median (min-max) ms', 'CPU load %', 'digest'];
  const W = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (r) => r.map((c, i) => String(c).padEnd(W[i])).join('  ').trimEnd();
  console.log([line(head), W.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)].join('\n'));
  console.log(`\nNode ${process.version}. Fresh process per run, variants alternated. CPU load is the whole machine's across each run, the run itself included (about one core's share).`);
  console.log(same ? 'digests: equal between the broad phase and every pair for each pile.' : 'digests: DIFFER for a pile; the broad phase changed the bytes.');
  if (!same) process.exitCode = 1;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) console.log(USAGE);
  else if (args[0] === '--child') child(args[1], args[2], Number(args[3]));
  else {
    let opts;
    try { opts = parseArgs(args); } catch (e) {
      console.error('bench-sim: ' + e.message + '\n' + USAGE);
      process.exitCode = 1;
    }
    if (opts) main(opts);
  }
}

module.exports = { pile, parseArgs };
