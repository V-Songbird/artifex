'use strict';

// Third-party code copied into core/ must stay deterministic and offline: a
// later update of a vendored file cannot slip in a random source, a clock, a
// timer or a network call, and it keeps its licence beside it.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CORE = path.join(__dirname, '..', 'core');
const vendored = fs.readdirSync(CORE)
  .filter((f) => f.endsWith('.js'))
  .filter((f) => fs.readFileSync(path.join(CORE, f), 'utf8').startsWith('// Vendored from '));

test('vendored files are found, so the scan below cannot pass empty', () => {
  for (const f of ['robust-predicates.js', 'earcut.js', 'delaunator.js', 'd3-delaunay.js', 'clipper2.js', 'kdbush.js', 'tinyqueue.js', 'polylabel.js', 'poisson-disk.js', 'planck.js']) {
    assert.ok(vendored.includes(f), `${f} not among ${vendored.join(', ')}`);
  }
});

test('vendored files call no random source, clock, timer or network', () => {
  const banned = /Math\.random|Date\.now|new Date\b|performance\.now|setTimeout|setInterval|requestAnimationFrame|fetch\s*\(|XMLHttpRequest|WebSocket|importScripts|\brequire\s*\(\s*['"](?!\.\/)/;
  for (const f of vendored) {
    const lines = fs.readFileSync(path.join(CORE, f), 'utf8').split('\n');
    const at = lines.findIndex((l) => banned.test(l.replace(/\/\/.*$/, '')));
    assert.equal(at, -1, `core/${f}:${at + 1}: ${lines[at]}`);
  }
});

test('each vendored file keeps its licence beside it', () => {
  for (const f of vendored) {
    assert.ok(fs.existsSync(path.join(CORE, f.replace(/\.js$/, '.LICENSE'))), `core/${f} has no ${f.replace(/\.js$/, '.LICENSE')}`);
  }
});
