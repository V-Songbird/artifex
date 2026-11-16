#!/usr/bin/env node
'use strict';

// Every declared name must have a reader somewhere in the tree.
//
// Tokenise every source file, then for each top-level declaration and each class
// member count how often that identifier appears ANYWHERE in code; a mention in
// a comment, a string or a regular expression is not a reader. One occurrence
// means the declaration is its own only reader. A top-level destructured binding
// (`const { a, b } = require(...)`) counts only in its own file.
//
// WHAT TO DO WITH A HIT, which is the whole point:
//
//   An unread name is either DEAD or UNPROVEN, and the two have opposite fixes.
//   Delete the dead. Prove the unproven -- and prefer proving it when its
//   absence would make two outputs disagree.
//
// The vector surface is Canvas2D-shaped so one `draw` can reach a screen,
// print and plotter. An unused surface method may need a regression test:
// removing it could break a piece that uses the same method on a canvas.
//
// No dependencies, no build, no browser, no art. It runs before anything else.

const fs = require('node:fs');
const path = require('node:path');
const { scan, uncomment, blank } = require('./js-comments.js');

const ROOT = path.join(__dirname, '..');
const DIRS = ['core', 'examples', 'tests', 'site', 'site/demos', 'site/pieces', 'site/tests', 'tools'];

// Control-flow keywords read as member declarations at the same indent.
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'return', 'catch', 'constructor', 'else', 'try', 'do']);

function sources() {
  const out = [];
  for (const d of DIRS) {
    for (const f of fs.readdirSync(path.join(ROOT, d))) {
      if (/\.c?js$/.test(f)) out.push([`${d}/${f}`, fs.readFileSync(path.join(ROOT, d, f), 'utf8')]);
    }
  }
  return out;
}

/**
 * A second pass, for a fault the first cannot see.
 *
 * A contract key can appear only as a string in a validator, without a named
 * declaration. Every accepted key must also occur in code that consumes it;
 * otherwise a declared option could have no effect.
 *
 * It is coarse -- a key whose name collides with a common identifier passes for
 * the wrong reason -- but it catches a key nothing else mentions, which is
 * exactly the shape of the fault.
 */
function unreadContractKeys(root = ROOT) {
  const src = fs.readFileSync(path.join(root, 'core', 'piece.js'), 'utf8');
  const cut = src.indexOf('const OUTPUTS');
  if (cut < 0) throw new Error('lint: cannot find where the FIELDS declaration ends');
  const declaration = src.slice(0, cut);

  const keys = [];
  for (const m of declaration.matchAll(/^  ([a-z][\w]*): \{$/gm)) keys.push(m[1]);
  const known = /const known = \[([^\]]*)\]/.exec(declaration);
  if (known) for (const m of known[1].matchAll(/'([^']+)'/g)) keys.push(`time.${m[1]}`);

  // Everything that could consume a key: the rest of piece.js, plus the other
  // core modules -- WITH COMMENTS STRIPPED. A mention in prose does not show
  // that runtime code consumes the key. Each file is stripped alone, so a
  // comment left open at one file's end does not swallow the next.
  const consumers = [src.slice(cut), ...fs.readdirSync(path.join(root, 'core'))
    .filter((f) => f.endsWith('.js') && f !== 'piece.js')
    .map((f) => fs.readFileSync(path.join(root, 'core', f), 'utf8'))].map(uncomment).join('\n');

  return keys
    .filter((k) => {
      const name = k.replace('time.', '');
      // A template literal turns \b into a BACKSPACE, not a word boundary.
      // String.raw keeps the escape as written.
      return !new RegExp(String.raw`\b` + name + String.raw`\b`).test(consumers);
    })
    .map((k) => ({ file: 'core/piece.js', name: k, kind: 'contract key, no consumer' }));
}

// Split at `sep` outside brackets, braces, parentheses, comments, strings,
// template text and regular expressions. A colon that closes a `?` is not a
// separator; `??` and `?.` open nothing. No ternary spans a top-level `,`, `;`
// or separator, so a misread `?` cannot swallow a colon past one.
function topLevel(text, sep) {
  const parts = [], skip = scan(text);
  let depth = 0, start = 0, next = 0, open = 0;
  for (let i = 0; i < text.length; i++) {
    while (next < skip.length && i >= skip[next][1]) i = Math.max(i, skip[next++][2]);
    if (i >= text.length) break;
    const c = text[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === '?' && text[i + 1] === '?') i++;
    else if (c === '?' && !depth && !/^\.\D/.test(text.slice(i + 1, i + 3))) open++;
    else if (c === ':' && !depth && open) open--;
    else if (c === sep && !depth) { parts.push(text.slice(start, i)); start = i + 1; open = 0; }
    else if ((c === ',' || c === ';') && !depth) open = 0;
  }
  parts.push(text.slice(start));
  return parts;
}

// The names a destructuring pattern binds: `{ a, b: c, d = 1, ...e }` binds
// a, c, d and e; `[x, , [y]]` binds x and y. A default value binds nothing.
function bindings(pattern) {
  pattern = uncomment(pattern);
  const inner = pattern.trim().slice(1, -1);
  const out = [];
  for (let part of topLevel(inner, ',')) {
    part = part.replace(/^\s*\.\.\./, '');
    if (pattern.trim()[0] === '{') {
      const key = topLevel(part, ':');
      if (key.length > 1) part = key.slice(1).join(':');
    }
    part = topLevel(part, '=')[0].trim();
    if (/^[{[]/.test(part)) out.push(...bindings(part));
    else if (/^[A-Za-z_$][\w$]*$/.test(part)) out.push(part);
  }
  return out;
}

// The pattern that opens at `src[at]`, through its matching bracket; brackets
// in comments, strings, template text and regular expressions do not count.
// The last source's ranges are kept, so a file is scanned once for all its
// patterns; an opening inside a range (browser code in a template) is scanned
// from there.
let scanned = [null, []];
function pattern(src, at) {
  if (scanned[0] !== src) scanned = [src, scan(src)];
  let skip = scanned[1], next = 0;
  for (let lo = skip.length; next < lo;) { const mid = (next + lo) >> 1; if (skip[mid][2] <= at) next = mid + 1; else lo = mid; }
  if (next < skip.length && skip[next][1] <= at) {
    skip = scan(src.slice(at)).map(([kind, a, b]) => [kind, a + at, b + at]);
    next = 0;
  }
  let depth = 0;
  for (let i = at; i < src.length; i++) {
    while (next < skip.length && skip[next][2] <= i) next++;
    if (next < skip.length && i >= skip[next][1]) { i = skip[next][2] - 1; continue; }
    const c = src[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c) && !--depth) return src.slice(at, i + 1);
  }
  return src.slice(at);
}

// Top-level declarations and, in a file that defines a class, its members.
function declarations(src) {
  const names = new Map();
  for (const m of src.matchAll(/^(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/gm)) names.set(m[1], 'declared');
  for (const m of src.matchAll(/^(?:const|let)\s*([{[])/gm)) {
    for (const name of bindings(pattern(src, m.index + m[0].length - 1))) names.set(name, 'destructured');
  }
  return names;
}

// Template text that is browser code, scanned as source rather than blanked:
// [file, a pattern whose group is that text]. Other templates hold prose,
// markup, GLSL or fixtures for another program.
const CODE_TEMPLATES = [
  ['tools/build-page.js', /const RUNTIME = `([^`]*)`/],
  ['tools/build-page.js', /`(__def\([^`]*)`/],
  ['tools/build-page.js', /<script>\n([^`]*)<\/script>/],
];

// `src` blanked (a name in prose is not a reader), with each listed template's
// text scanned as source.
function readable(file, src) {
  let out = blank(src);
  for (const [f, re] of CODE_TEMPLATES) {
    if (f !== file) continue;
    const m = re.exec(src);
    if (!m) throw new Error(`lint: cannot find the code template ${re} in ${file}`);
    const a = m.index + m[0].indexOf(m[1]), b = a + m[1].length;
    out = out.slice(0, a) + blank(src.slice(a, b)) + out.slice(b);
  }
  return out;
}

// Every declaration in `files` ([path, source] pairs) whose name occurs once.
function unreadNames(files) {
  const vendored = new Set(files.filter(([, src]) => src.startsWith('// Vendored from ')).map(([file]) => file));
  files = files.map(([file, src]) => [file, readable(file, src)]);
  const counts = new Map();
  for (const [, src] of files) {
    for (const m of src.matchAll(/[A-Za-z_$][\w$]*/g)) counts.set(m[0], (counts.get(m[0]) || 0) + 1);
  }

  const hits = [];
  let declared = 0;
  for (const [file, src] of files) {
    // Vendored third-party code is kept as published, whole: its names read
    // others, but an API it ships and nobody calls is not ours to delete.
    if (vendored.has(file)) continue;
    const names = declarations(src);
    const members = new Map();
    // Members only in files that actually define a class. Without this, a
    // two-space-indented CALL inside a template literal reads as a declaration,
    // and the scan reports the platform's own globals as dead code.
    if (/^class\s/m.test(src)) {
      for (const m of src.matchAll(/^[ \t]+(?:(?:async|get|set|static)\s+)*\*?[ \t]*([a-zA-Z_$][\w$]*)\s*\(/gm)) {
        if (KEYWORDS.has(m[1])) continue;
        // A declaration has a body; an indented call does not.
        const open = m.index + m[0].length - 1;
        if (!/^\s*\{/.test(src.slice(open + pattern(src, open).length))) continue;
        members.set(m[1], (members.get(m[1]) || 0) + 1);
        // A member of the same name is counted tree-wide anyway; the binding
        // keeps its own-file count.
        if (names.get(m[1]) !== 'destructured') names.set(m[1], 'member');
      }
    }
    declared += names.size;
    // A destructured binding is read only in its own file, however often
    // the name it copies occurs elsewhere, and never by a property access
    // (`.name`) or a member declaration of the same name.
    const local = [...src.matchAll(/(\.*)\s*([A-Za-z_$][\w$]*)/g)].filter((m) => m[1].length !== 1).map((m) => m[2]);
    for (const [name, kind] of names) {
      const seen = kind === 'destructured' ? local.filter((t) => t === name).length - (members.get(name) || 0) : counts.get(name) || 0;
      if (seen <= 1) hits.push({ file, name, kind });
    }
  }
  return { hits, scanned: declared };
}

function main() {
  const files = sources();
  const { hits, scanned } = unreadNames(files);

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

const USAGE = 'usage: npm run lint';
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) console.log(USAGE);
  else if (args.length) {
    console.error('lint: ' + (args[0].startsWith('-') ? 'unknown option ' + args[0] : 'unexpected argument "' + args[0] + '"') + '\n' + USAGE);
    process.exitCode = 1;
  }
  else main();
}

module.exports = { bindings, pattern, topLevel, unreadContractKeys, unreadNames };
