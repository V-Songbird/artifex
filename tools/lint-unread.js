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
// See docs/knowledge/verification-culture.md §11.
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

/**
 * A second pass, for a fault the first cannot see.
 *
 * `time.hold` was accepted by the contract, asserted by a test, and read by
 * NOTHING -- frameT, frameCount, playheads and render.js all ignored it, so
 * declaring it got you no hold, silently. That is the disease this project
 * cured for `params` and then reproduced inside `time` two commits later.
 *
 * The first pass could not catch it because `hold` was never a declared NAME,
 * only a string in a validator. So: every key the contract accepts must be
 * mentioned somewhere that is not the declaration itself.
 *
 * It is coarse -- a key whose name collides with a common identifier passes for
 * the wrong reason -- but it catches a key nothing else mentions, which is
 * exactly the shape of the fault.
 */
function unreadContractKeys() {
  const src = fs.readFileSync(path.join(ROOT, 'core', 'piece.js'), 'utf8');
  const cut = src.indexOf('const OUTPUTS');
  if (cut < 0) throw new Error('lint: cannot find where the FIELDS declaration ends');
  const declaration = src.slice(0, cut);

  const keys = [];
  for (const m of declaration.matchAll(/^  ([a-z][\w]*): \{$/gm)) keys.push(m[1]);
  const known = /const known = \[([^\]]*)\]/.exec(declaration);
  if (known) for (const m of known[1].matchAll(/'([^']+)'/g)) keys.push(`time.${m[1]}`);

  // Everything that could consume a key: the rest of piece.js, plus the other
  // core modules -- WITH COMMENTS STRIPPED. The first version matched raw text
  // and passed `hold` because the word appears in a sentence in rand.js. A
  // check satisfied by prose is a check that cannot fail, which is the thing
  // this tool exists to find.
  let consumers = src.slice(cut);
  for (const f of fs.readdirSync(path.join(ROOT, 'core'))) {
    if (f.endsWith('.js') && f !== 'piece.js') consumers += fs.readFileSync(path.join(ROOT, 'core', f), 'utf8');
  }
  consumers = consumers
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ');

  return keys
    .filter((k) => {
      const name = k.replace('time.', '');
      // A template literal turns \b into a BACKSPACE, not a word boundary, so
      // the first version of this line flagged every key at once having
      // previously flagged none. String.raw keeps the escape as written.
      return !new RegExp(String.raw`\b` + name + String.raw`\b`).test(consumers);
    })
    .map((k) => ({ file: 'core/piece.js', name: k, kind: 'contract key, no consumer' }));
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
  hits.push(...unreadContractKeys());

  if (!hits.length) {
    console.log('every declared name has a reader, and every contract key has a consumer');
    return;
  }
  for (const h of hits) console.log(`  ${h.file}  ${h.name}  [${h.kind}] is its own only reader`);
  console.log(`\n${hits.length} unread name(s). Each one is either DEAD -- delete it -- or UNPROVEN.`);
  console.log('Prefer proving it when its absence would make two outputs disagree.');
  process.exitCode = 1;
}

main();
