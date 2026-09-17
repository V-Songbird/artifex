#!/usr/bin/env node
'use strict';

// Every declared name must have a reader somewhere in the tree.
//
// Tokenise every source file, then for each top-level declaration and each class
// member count how often that identifier appears ANYWHERE. One occurrence means
// the declaration is its own only reader.
//
// WHAT TO DO WITH A HIT, which is the whole point:
//
//   An unread name is either DEAD or UNPROVEN, and the two have opposite fixes.
//   Delete the dead. Prove the unproven -- and prefer proving it when its
//   absence would make two outputs disagree.
//
// The second case is not hypothetical. This scan's first run found five members
// of the vector surface that had never been exercised, and deleting them would
// have been wrong: the surface is Canvas2D-shaped so one `draw` reaches a
// screen, a print and a plotter unchanged, and a method that exists on a canvas
// and is missing here throws a bare TypeError on export from a piece that
// worked live. All five were correct. What they lacked was proof.
// See docs/verification-culture.md §11.
//
// No dependencies, no build, no browser, no art. It runs before anything else.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DIRS = ['core', 'examples', 'tests'];

// Control-flow keywords read as member declarations at the same indent.
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'return', 'catch', 'constructor', 'else', 'try', 'do']);

function sources() {
  const out = [];
  for (const d of DIRS) {
    for (const f of fs.readdirSync(path.join(ROOT, d))) {
      if (f.endsWith('.js')) out.push([`${d}/${f}`, fs.readFileSync(path.join(ROOT, d, f), 'utf8')]);
    }
  }
  return out;
}

function main() {
  const files = sources();

  const counts = new Map();
  for (const [, src] of files) {
    for (const m of src.matchAll(/[A-Za-z_$][\w$]*/g)) counts.set(m[0], (counts.get(m[0]) || 0) + 1);
  }

  const hits = [];
  let scanned = 0;
  for (const [file, src] of files) {
    const names = new Map();
    for (const m of src.matchAll(/^(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/gm)) names.set(m[1], 'declared');
    // Members only in files that actually define a class. Without this, a
    // two-space-indented CALL inside a template literal reads as a declaration,
    // and the scan reports the platform's own globals as dead code.
    if (/^class\s/m.test(src)) {
      for (const m of src.matchAll(/^ {2}(?:get\s+|set\s+|static\s+)?([a-zA-Z_][\w]*)\s*\(/gm)) {
        if (!KEYWORDS.has(m[1])) names.set(m[1], 'member');
      }
    }
    scanned += names.size;
    for (const [name, kind] of names) {
      if ((counts.get(name) || 0) <= 1) hits.push({ file, name, kind });
    }
  }

  console.log(`unread-name scan: ${scanned} names across ${files.length} files in ${DIRS.join(', ')}`);
  if (!hits.length) {
    console.log('every declared name has a reader');
    return;
  }
  for (const h of hits) console.log(`  ${h.file}  ${h.name}  [${h.kind}] is its own only reader`);
  console.log(`\n${hits.length} unread name(s). Each one is either DEAD -- delete it -- or UNPROVEN.`);
  console.log('Prefer proving it when its absence would make two outputs disagree.');
  process.exitCode = 1;
}

main();
