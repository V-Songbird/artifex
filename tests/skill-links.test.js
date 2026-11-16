'use strict';

// The skill is split into a core and references joined by relative links. An
// agent follows them to find what it needs, so a renamed heading or a moved
// file breaks its routing without any other failure. Resolve every one. The
// links and anchors in the public docs, including from one doc to another, are
// checked the same way.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

/**
 * The Markdown the content checks read under `dir` (a folder, or one file), repo-relative with forward slashes: the tracked list
 * the root check reads, so an untracked file another agent leaves in a shared checkout is judged by neither. Without Git
 * (the mutation suite's copy) it is every Markdown file under `dir` outside dot folders, node_modules and out/, untracked or not.
 * Private folders are never listed. A `dir` that does not exist throws, and so does an empty list where Markdown exists on disk
 * (an untracked library inside another Git repo), since a check that reads nothing passes on nothing.
 */
function markdown(dir, root = ROOT) {
  if (!fs.existsSync(path.join(root, dir))) throw new Error(`markdown(): no folder or file ${dir} under ${root}`);
  const inDir = (f) => (f === dir || f.startsWith(dir + '/')) && !PRIVATE.some((p) => f === p || f.startsWith(p + '/'));
  const listed = trackableMarkdown(root).filter(inDir);
  if (!listed.length) {
    const onDisk = diskMarkdown(root, dir).filter(inDir);
    if (onDisk.length) throw new Error(`markdown(): Git lists no tracked Markdown under ${dir} in ${root}, but ${onDisk.length} file(s) exist there, such as ${onDisk[0]}; is the library untracked inside another Git repository?`);
  }
  return listed;
}

/** Every Markdown file under `dir` (a folder or one file) on disk, untracked or not, outside dot folders, node_modules and out/. */
function diskMarkdown(root, dir) {
  const walk = (rel) => {
    if (fs.statSync(path.join(root, rel)).isFile()) return rel.endsWith('.md') ? [rel] : [];
    return fs.readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap((e) => {
      const sub = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) return /^\.|^node_modules$|^out$/.test(e.name) ? [] : walk(sub);
      return e.name.endsWith('.md') ? [sub] : [];
    });
  };
  return walk(dir).sort();
}

/** An ordered list marker; prose() and the code-span stops in links() share it. */
const ORDERED = '\\d{1,9}[.)]';

/**
 * Each line outside fenced and indented code blocks, as written (`raw`), with its 1-based number.
 * An indented block starts after a blank line outside a list item, where the indent is a continuation.
 * With `indented` false only fenced blocks are code, as the guards on fenced samples need.
 */
function prose(text, indented = true) {
  const out = [];
  let fence = null;
  let blank = true;
  let code = false;
  let inList = false;
  text.split(/\r?\n/).forEach((line, i) => {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !line.slice(m[0].length).trim()) fence = null;
      return;
    }
    if (m) {
      fence = m[1];
      blank = false;
      code = false;
      return;
    }
    if (!line.trim()) {
      blank = true;
      out.push({ raw: line, n: i + 1 });
      return;
    }
    if (indented && /^(?: {4}|\t)/.test(line) && (code || (blank && !inList))) {
      code = true;
      blank = false;
      return;
    }
    const afterBlank = blank;
    code = false;
    blank = false;
    // A lazy continuation line keeps the item; only an unindented line after a blank line ends it.
    if (new RegExp('^ {0,3}(?:[-*+]|' + ORDERED + ')(?:\\s|$)').test(line)) inList = true;
    else if (afterBlank && !/^\s/.test(line)) inList = false;
    out.push({ raw: line, n: i + 1, list: inList });
  });
  return out;
}

/** GitHub's slug of a heading's rendered text, as github-slugger makes it. */
function slug(heading) {
  return heading
    .replace(/<[^>]*>/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
}

/** The anchors GitHub gives a file's headings, numbering repeats as it does. */
function anchors(text) {
  const seen = new Map();
  for (const { raw } of prose(text)) {
    const m = /^ {0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/.exec(raw);
    if (!m) continue;
    const base = slug(m[1]);
    let s = base;
    while (seen.has(s)) { seen.set(base, seen.get(base) + 1); s = base + '-' + seen.get(base); }
    seen.set(s, 0);
  }
  return new Set(seen.keys());
}

/** Folders a published skill must not route to: readers never get them. */
const PRIVATE = ['docs/tasks', 'docs/decisions', 'docs/knowledge/private', 'docs/apis/private', '.private'];

const cache = new Map();
function headings(file) {
  if (!cache.has(file)) cache.set(file, anchors(fs.readFileSync(file, 'utf8')));
  return cache.get(file);
}

/** Why a link `target` written in `file` is broken, or null when it resolves or is not judged here. */
function linkProblem(file, target) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return null;
  const [where, hash] = target.split('#');
  let dest, id;
  try {
    dest = where ? path.resolve(path.dirname(file), decodeURIComponent(where)) : file;
    id = hash === undefined ? undefined : decodeURIComponent(hash);
  } catch {
    return 'malformed % escape';
  }
  const rel = path.relative(ROOT, dest).split(path.sep).join('/');
  if (PRIVATE.some((p) => rel === p || rel.startsWith(p + '/'))) return 'links to a private folder';
  // The mutation suite copies only the product tree, without docs/, so a link
  // into docs/ is judged only where docs/ exists.
  if (rel.split('/')[0] === 'docs' && !fs.existsSync(path.join(ROOT, 'docs'))) return null;
  if (!fs.existsSync(dest)) return 'no such file';
  if (id === undefined) return null;
  if (!dest.endsWith('.md')) return 'anchor into a file that is not Markdown';
  return headings(dest).has(id) ? null : `no heading #${hash}`;
}

/**
 * Every inline link outside code in `text`, as `{ target, n }` with the line the link starts on.
 * A link's text or target may wrap onto the next line; a blank line or a fenced block ends it.
 */
function links(text) {
  const lines = prose(text);
  let joined = '';
  const starts = [];
  lines.forEach((p, i) => {
    if (i && p.n !== lines[i - 1].n + 1) joined += '\n';
    starts.push([joined.length, p.n, p.list]);
    joined += p.raw + '\n';
  });
  // A code span may wrap too, and ends at a blank line or a line that starts a
  // heading, list item or quote. It closes on a backtick run of its own length.
  // Blank it in place so offsets and line breaks stay.
  const runs = [...joined.matchAll(/`+/g)];
  // A span that starts inside a quote wraps over the quote's own `>` lines.
  // Inside a list item any ordered marker is a sibling item; in a plain paragraph
  // only "1" can interrupt it, so "2." or "2024." stays a continuation line.
  const spanEnd = (quote, list) =>
    new RegExp('\\n(?:\\s*\\n| {0,3}(?:#{1,6}(?:\\s|$)|[-*+]\\s|' + (list ? ORDERED : '1[.)]') + '\\s' + (quote ? '' : '|>') + '))');
  let blanked = '';
  let at = 0;
  for (let i = 0; i < runs.length; i++) {
    const open = runs[i];
    // A heading is one line, so its span cannot wrap.
    const before = joined.slice(joined.lastIndexOf('\n', open.index) + 1, open.index);
    const heading = /^ {0,3}#{1,6}(?:\s|$)/.test(before);
    let list = false;
    for (const [off, , l] of starts) if (off <= open.index) list = l;
    const stops = spanEnd(/^ {0,3}>/.test(before), list);
    for (let j = i + 1; j < runs.length; j++) {
      const between = joined.slice(open.index + open[0].length, runs[j].index);
      if (heading ? between.includes('\n') : stops.test(between)) break;
      if (runs[j][0].length !== open[0].length) continue;
      const end = runs[j].index + runs[j][0].length;
      blanked += joined.slice(at, open.index) + joined.slice(open.index, end).replace(/[^\n]/g, ' ');
      at = end;
      i = j;
      break;
    }
  }
  joined = blanked + joined.slice(at);
  const out = [];
  const title = '"(?:[^"\\n]|\\n(?!\\s*\\n))*"|\'(?:[^\'\\n]|\\n(?!\\s*\\n))*\'|\\((?:[^()\\n]|\\n(?!\\s*\\n))*\\)';
  const re = new RegExp('!?\\[(?:[^\\]\\n]|\\n(?!\\s*\\n))*\\]\\((?:[^\\S\\n]|\\n(?!\\s*\\n))*<?([^)\\s>]+)>?(?:(?:[^\\S\\n]|\\n(?!\\s*\\n))+(?:' + title + '))?(?:[^\\S\\n]|\\n(?!\\s*\\n))*\\)', 'g');
  for (const m of joined.matchAll(re)) {
    let n = starts[0][1];
    for (const [off, line] of starts) if (off <= m.index) n = line;
    out.push({ target: m[1], n });
  }
  return out;
}

/** Each broken relative link or anchor in the Markdown under `dir`, as `file:line: link: reason`. */
function brokenLinks(dir = 'skills', root = ROOT) {
  const problems = [];
  for (const rel of markdown(dir, root)) {
    const file = path.join(root, rel);
    for (const { target, n } of links(fs.readFileSync(file, 'utf8'))) {
      const why = linkProblem(file, target);
      if (why) problems.push(`${rel}:${n}: ${target}: ${why}`);
    }
  }
  return problems;
}

test('slugs follow GitHub: punctuation dropped, spaces to hyphens, repeats numbered, code unwrapped', () => {
  assert.strictEqual(slug('Art-direction preset: focal composition'), 'art-direction-preset-focal-composition');
  assert.strictEqual(slug('The `finish` field, and *why*'), 'the-finish-field-and-why');
  assert.strictEqual(slug('See [the API](x.md) (v2)'), 'see-the-api-v2');
  assert.deepStrictEqual([...anchors('# A\n## A\n```\n## A\n```\n### A #\n')], ['a', 'a-1', 'a-2']);
});

test('links into private folders and malformed % escapes are broken, whatever this machine holds', () => {
  const skill = path.join(ROOT, 'skills', 'artifex', 'SKILL.md');
  for (const target of ['../../docs/tasks/x.md', '../../docs/decisions', '../../docs/knowledge/private/a.md#b', '../../docs/apis/private/a.md', '../../.private/notes.md']) {
    assert.strictEqual(linkProblem(skill, target), 'links to a private folder', target);
  }
  assert.strictEqual(linkProblem(skill, '../../docs/knowledge/privateer.md'), fs.existsSync(path.join(ROOT, 'docs')) ? 'no such file' : null);
  assert.strictEqual(linkProblem(skill, 'reference/stills%zz.md'), 'malformed % escape');
  assert.strictEqual(linkProblem(skill, 'reference/stills.md#%E0'), 'malformed % escape');
  assert.strictEqual(linkProblem(skill, 'reference/stills.md#scaling-to-print'), null);
});

test('link targets skip code fences and inline code', () => {
  assert.deepStrictEqual(links('a\n```md\n[x](y)\n```\n`[x](z)` b [k](w.md)'), [{ target: 'w.md', n: 5 }]);
});

test('a link whose text or target wraps across lines is read and judged', () => {
  const doc = 'Intro [a link whose text\nwraps](reference/stills.md#no-such-heading) end.\n\n[split\ntarget](\n  reference/stills.md#scaling-to-print\n)\n\n[open text\n\nnot a link](x.md#y)\n\n[blank in target](\n\nz.md#q)\n';
  assert.deepStrictEqual(links(doc), [
    { target: 'reference/stills.md#no-such-heading', n: 1 },
    { target: 'reference/stills.md#scaling-to-print', n: 4 },
  ]);
  const skill = path.join(ROOT, 'skills', 'artifex', 'SKILL.md');
  assert.strictEqual(linkProblem(skill, links(doc)[0].target), 'no heading #no-such-heading');
});

test('a code span that wraps across lines holds no link, and a title does not cross a blank line', () => {
  assert.deepStrictEqual(links('Use `[label\n](nope.md)` syntax, then [real](a.md) and ``[x\n](b.md)``.'), [{ target: 'a.md', n: 2 }]);
  assert.deepStrictEqual(links('A `lone tick\n\n[after](c.md) `x`'), [{ target: 'c.md', n: 3 }]);
  assert.deepStrictEqual(links('[t](d.md "title\nwraps") [u](e.md\n\n"late")'), [{ target: 'd.md', n: 1 }]);
});

test('all three CommonMark title forms are read', () => {
  assert.deepStrictEqual(
    links('[a](m1.md \'T\') [b](m2.md (T)) [c](m3.md "T") [d](m4.md \'wraps\nhere\')').map((l) => l.target),
    ['m1.md', 'm2.md', 'm3.md', 'm4.md'],
  );
});

test('an indented code block holds no link, but a list item continuation does', () => {
  assert.deepStrictEqual(links('para\n\n    [x](y.md)\n\n    [z](y2.md)\n\n[k](w.md)'), [{ target: 'w.md', n: 7 }]);
  assert.deepStrictEqual(links('- item\n\n    [x](v.md)'), [{ target: 'v.md', n: 3 }]);
  assert.deepStrictEqual(links('para\n    [x](u.md)'), [{ target: 'u.md', n: 2 }]);
});

test('a code span ends at a heading, list item or quote line, and a longer run holds a single backtick', () => {
  assert.deepStrictEqual(links('- `open tick\n- [x](h.md) `close`'), [{ target: 'h.md', n: 2 }]);
  assert.deepStrictEqual(links('# a ` tick\n[x](g.md) `'), [{ target: 'g.md', n: 2 }]);
  assert.deepStrictEqual(links('1. a `tick\n2. [x](y.md) `'), [{ target: 'y.md', n: 2 }]);
  assert.deepStrictEqual(links('para `tick\n2. [x](y.md) `'), []);
  assert.deepStrictEqual(links('text `a\n2. b` [x](q.md) `c` '), [{ target: 'q.md', n: 2 }]);
  assert.deepStrictEqual(links('``a`b [x](n.md)`` then [k](w.md)'), [{ target: 'w.md', n: 1 }]);
  assert.deepStrictEqual(links('``a`b`` [x](n.md) `c'), [{ target: 'n.md', n: 1 }]);
});

test('a span wrapped inside a quote holds on over the quote marks, and a lazy list line keeps its item', () => {
  assert.deepStrictEqual(links('> a `code\n> wraps` and [x](real.md) and `y`'), [{ target: 'real.md', n: 2 }]);
  assert.deepStrictEqual(links('1. item\nlazy line\n\n    [x](lazy.md)'), [{ target: 'lazy.md', n: 4 }]);
});

test('the fenced-code guards still treat an indented line as prose', () => {
  assert.deepStrictEqual(bareNpmRuns('para\n\n    npm run film'), []);
  assert.deepStrictEqual(localCoreRequireLines('para\n\n    require("./core/time.js")'), []);
});

test('every relative link and anchor in the skills resolves', () => {
  const problems = brokenLinks();
  assert.strictEqual(problems.length, 0, `broken links in skills/:\n${problems.join('\n')}`);
});

/**
 * A require, require.resolve, import() or import ... from of core by any run of ./ or ../ (./core/, ../../core/),
 * in any quote style: single, double or backtick, with or without a space before the paren, export ... from,
 * new URL( and path.join/resolve(__dirname, ...); the specifier may sit on a later line.
 */
const LOCAL_CORE_REQUIRE = /(?:\brequire(?:\.resolve)?\s*\(|\bimport\s*\(|\bimport\b|\bfrom\b|\bnew\s+URL\s*\(|\bpath\.(?:join|resolve)\s*\(\s*__dirname\s*,)\s*['"`](?:\.{1,2}\/)+core\//g;

/**
 * path.join/resolve with the segments split: (__dirname, '..', 'core', ...) or ('..', 'core', ...) without __dirname.
 * A leading segment is any run of ./ and ../ ('..', '../..'); the core segment may carry its own prefix and rest ('../core', 'core/time.js').
 * Without __dirname a leading segment or a prefixed core segment must come first, so path.join('core', ...) alone is not a local path.
 */
const SPLIT_CORE_PATH = (() => {
  const dots = String.raw`['"\`](?:\.\.?\/)*\.\.?\/?['"\`]\s*,\s*`;
  const tail = String.raw`(?:\/[^'"\`]*)?['"\`](?=\s*[,)])`;
  const bare = String.raw`['"\`](?:\.{1,2}\/)*core` + tail;
  const prefixed = String.raw`['"\`](?:\.{1,2}\/)+core` + tail;
  return new RegExp(String.raw`\bpath\.(?:join|resolve)\s*\(\s*(?:__dirname\s*,\s*(?:${dots})*${bare}|(?:${dots})+${bare}|${prefixed})`, 'g');
})();

/**
 * Fenced lines, by their start, that run from the repository root and so reach core by path.
 * A piece file cannot; these are a command typed at the root and a script that loads a repository example.
 */
const REPO_ROOT_LINES = {
  'docs/apis/piece-api.md': [
    'node -e "const fs = require(\'node:fs\'); const { renderVector } = require(\'./core/render.js\');',
    "const { validate, atBox } = require('./core/piece.js');",
    "const { renderVector } = require('./core/render.js');",
  ],
};

/**
 * The 1-based numbers of lines in fenced code of `text` that require core by a local path.
 * The specifier may sit on a later line than its require( or from; the number is the line of the keyword,
 * and `allowed` prefixes are compared with the line the specifier ends on.
 */
function localCoreRequireLines(text, allowed = []) {
  const outside = new Set(prose(text, false).map((p) => p.n));
  const lines = text.split(/\r?\n/);
  const out = new Set();
  for (const m of [...text.matchAll(LOCAL_CORE_REQUIRE), ...text.matchAll(SPLIT_CORE_PATH)]) {
    const n = text.slice(0, m.index).split(/\r?\n/).length;
    if (outside.has(n)) continue;
    const specifierLine = text.slice(0, m.index + m[0].length).split(/\r?\n/).length;
    if (!allowed.some((a) => lines[specifierLine - 1].trim().startsWith(a))) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

/** The Markdown the guard reads: a folder (all of it) or one file. */
const GUARD_SCAN = ['skills', 'docs/apis', 'docs/knowledge', 'docs/CONTRIBUTING.md', 'docs/SECURITY.md', 'README.md', 'studies'];

/**
 * Every tracked Markdown file under `root`, repo-relative; an untracked file another agent leaves in a shared checkout is not public yet.
 * Without Git (the mutation suite's copy), a walk that skips dot folders, node_modules and out/.
 */
function trackableMarkdown(root = ROOT) {
  try {
    const listed = execFileSync('git', ['ls-files', '--cached', '-z', '--', '*.md'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return listed.split('\0').filter(Boolean).filter((f) => fs.existsSync(path.join(root, f))).sort();
  } catch {
    return diskMarkdown(root, '');
  }
}

/**
 * Public Markdown roots that `scan` does not name, among the Markdown `files`, as repo-relative paths: skills, a docs/ child
 * (folder or file) or any other file. Instruction files, private folders, test fixtures and folders without Markdown are not roots.
 */
function unscannedRoots(scan, files = trackableMarkdown()) {
  const roots = new Set();
  for (const f of files) {
    if (['AGENTS.md', 'CLAUDE.md'].includes(f.split('/').pop())) continue;
    if (PRIVATE.concat('tests/fixtures').some((p) => f.startsWith(p + '/'))) continue;
    if (scan.some((s) => f === s || f.startsWith(s + '/'))) continue;
    const parts = f.split('/');
    roots.add(parts[0] === 'skills' ? 'skills' : parts[0] === 'docs' && parts.length > 2 ? parts.slice(0, 2).join('/') : f);
  }
  return [...roots].filter((r) => !scan.some((s) => r === s || r.startsWith(s + '/')));
}

/**
 * Each local core require inside fenced code in the Markdown under `dir` (or in the one file `dir` names), as `file:line`.
 * A piece or pack names core as artifex/core/<file>.js; ./core/ resolves only from the library root.
 */
function localCoreRequires(dir = 'skills', root = ROOT) {
  return markdown(dir, root).flatMap((rel) =>
    localCoreRequireLines(fs.readFileSync(path.join(root, rel), 'utf8'), REPO_ROOT_LINES[rel]).map((n) => `${rel}:${n}`));
}

test('code samples in the skills, README, API docs, knowledge docs, CONTRIBUTING and SECURITY reach core as artifex/core/, never by a ./core/, ../core/ or deeper path in require, require.resolve, import, export ... from, new URL or path.join/resolve, whole or split into segments, with or without __dirname', () => {
  // The mutation suite copies the product tree without docs/ or README.md; a root missing from that copy is not scanned.
  const copy = !fs.existsSync(path.join(ROOT, 'docs')) || !fs.existsSync(path.join(ROOT, 'README.md'));
  const problems = GUARD_SCAN.filter((d) => !copy || fs.existsSync(path.join(ROOT, d))).flatMap((d) => localCoreRequires(d));
  assert.strictEqual(problems.length, 0,
    `require, require.resolve, import, export ... from, new URL or path.join/resolve of a ./core/, ../core/ or ../../core/ path, whole or split into segments, with or without __dirname, in fenced code; use artifex/core/<file>.js, or add a line that runs from the repository root to REPO_ROOT_LINES:\n${problems.join('\n')}`);
});

test('the core require guard scans every public Markdown root', (t) => {
  // The mutation suite copies the product tree without docs/ or README.md; there is nothing to list.
  if (!fs.existsSync(path.join(ROOT, 'docs')) || !fs.existsSync(path.join(ROOT, 'README.md'))) return t.skip('no docs/ or README.md in this tree');
  assert.deepStrictEqual(unscannedRoots(GUARD_SCAN), []);
  assert.deepStrictEqual(unscannedRoots(GUARD_SCAN.filter((s) => s !== 'README.md' && s !== 'docs/SECURITY.md')), ['README.md', 'docs/SECURITY.md']);
});

test('the core require guard reads a specifier on a later line and path.join or new URL forms', () => {
  const fence = (code) => '```js\n' + code + '\n```';
  for (const [code, line] of [
    ["const t = require(\n  './core/time.js'\n);", 2],
    ["import {\n  t,\n} from\n  '../core/time.js';", 4],
    ["const t = path.join(__dirname, '../core/time.js');", 2],
    ["const u = new URL('./core/time.js', import.meta.url);", 2],
    ["const p = path.resolve(__dirname, '../../core/time.js');", 2],
  ])assert.deepStrictEqual(localCoreRequireLines(fence(code)), [line], code);
  assert.deepStrictEqual(localCoreRequireLines(fence("const t = require(\n  'artifex/core/time.js'\n);")), []);
});

test('the core require guard catches split path.join/resolve segments with or without __dirname and spares artifex/core and a bare core folder', () => {
  const fence = (code) => '```js\n' + code + '\n```';
  for (const code of [
    "const p = path.join(__dirname, '..', 'core', 'time.js');",
    "const p = path.resolve(__dirname, '..', '..', \"core\", 'time.js');",
    "const p = path.join('..', 'core', 'time.js');",
    "const p = path.resolve('.', `core`, 'time.js');",
    "const p = path.join(__dirname,\n  '..',\n  'core');",
    "const p = path.join(__dirname, 'core', 'time.js');",
    "const p = path.join(__dirname, '..', 'core/time.js');",
    "const p = path.join(__dirname, '../core', 'time.js');",
    "const p = path.join(__dirname, '../..', 'core', 'time.js');",
    "const p = path.join('..', 'core/time.js');",
  ]) assert.deepStrictEqual(localCoreRequireLines(fence(code)), [2], code);
  for (const code of [
    "const p = path.join('artifex', 'core', 'time.js');",
    "const p = path.join('core', 'time.js');",
    "const p = path.join(__dirname, '..', 'tools', 'core.js');",
  ]) assert.deepStrictEqual(localCoreRequireLines(fence(code)), [], code);
});

test('REPO_ROOT_LINES prefixes are compared with the line the specifier ends on, not the keyword line', () => {
  const code = '```js\nconst t = require(\n  \'./core/time.js\'\n);\n```';
  assert.deepStrictEqual(localCoreRequireLines(code, ["'./core/time.js'"]), []);
  assert.deepStrictEqual(localCoreRequireLines(code, ['const t = require(']), [2]);
  const split = '```js\nconst p = path.join(\n  __dirname,\n  \'..\',\n  \'core\'\n);\n```';
  assert.deepStrictEqual(localCoreRequireLines(split, ["'core'"]), []);
  assert.deepStrictEqual(localCoreRequireLines(split, [');']), [2]);
  assert.deepStrictEqual(localCoreRequireLines(split, ['const p = path.join(']), [2]);
});

test('the dots pattern of the split core path stays linear on a long run of dots', () => {
  const started = Date.now();
  localCoreRequireLines('```js\npath.join(' + "'" + '.'.repeat(40) + "x'" + ', \'core\');\n```');
  // The earlier backtracking pattern grew about 1.6x to 3x per dot: measured 0.5 to 3.7 s at 34 to 40 dots here (noisy, loaded machine),
  // so 40 dots fail it in seconds, over ten times this bound. The linear one takes about 0 ms. The run ends either way, so a regression fails this bound instead of hanging.
  assert.ok(Date.now() - started < 300);
});

test('unscannedRoots finds nested Markdown roots, skips private, instruction and Markdown-free folders, and lists only tracked Markdown', (t) => {
  const files = ['README.md', 'AGENTS.md', 'examples/README.md', 'site/docs/notes.md', 'docs/guide.md', 'docs/images/diagram.md',
    'docs/tasks/a.md', 'docs/knowledge/private/b.md', '.private/c.md', 'skills/x/SKILL.md', 'tools/AGENTS.md'];
  assert.deepStrictEqual(unscannedRoots(['README.md'], files), ['examples/README.md', 'site/docs/notes.md', 'docs/guide.md', 'docs/images', 'skills']);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-links-'));
  try {
    fs.mkdirSync(path.join(dir, 'examples'));
    fs.writeFileSync(path.join(dir, 'examples/README.md'), '# y');
    fs.writeFileSync(path.join(dir, 'examples/notes.md'), '# untracked');
    // Another agent's untracked file under a scanned folder, with a broken link and a local core require: neither content check may read it.
    fs.mkdirSync(path.join(dir, 'docs'));
    fs.writeFileSync(path.join(dir, 'docs/tracked.md'), '# ok\n');
    fs.writeFileSync(path.join(dir, 'docs/stray.md'), "[x](gone.md)\n```js\nrequire('./core/time.js');\n```\n");
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['add', '--', 'examples/README.md', 'docs/tracked.md'], { cwd: dir, stdio: 'ignore' });
    } catch { return t.skip('git is not available'); }
    assert.deepStrictEqual(trackableMarkdown(dir), ['docs/tracked.md', 'examples/README.md']);
    assert.deepStrictEqual(brokenLinks('docs', dir), []);
    assert.deepStrictEqual(localCoreRequires('docs', dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('markdown() throws for a missing folder or an empty tracked list over Markdown on disk, and never lists a private folder', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-links-'));
  try {
    fs.mkdirSync(path.join(dir, 'docs/tasks'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs/a.md'), '# a\n');
    fs.writeFileSync(path.join(dir, 'docs/tasks/b.md'), '# b\n');
    try { execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' }); } catch { return t.skip('git is not available'); }
    // Nothing tracked yet: an untracked library inside another Git repository looks like this.
    assert.throws(() => markdown('docs', dir), /no tracked Markdown under docs/);
    assert.throws(() => brokenLinks('docs', dir), /no tracked Markdown/);
    assert.throws(() => localCoreRequires('docs', dir), /no tracked Markdown/);
    execFileSync('git', ['add', '--', 'docs/a.md', 'docs/tasks/b.md'], { cwd: dir, stdio: 'ignore' });
    assert.deepStrictEqual(markdown('docs', dir), ['docs/a.md']);
    assert.deepStrictEqual(markdown('docs/tasks', dir), []);
    assert.deepStrictEqual(markdown('docs/a.md', dir), ['docs/a.md']);
    assert.throws(() => markdown('dosc', dir), /no folder or file dosc/);
    assert.throws(() => brokenLinks('dosc', dir), /no folder or file dosc/);
    assert.throws(() => localCoreRequires('dosc', dir), /no folder or file dosc/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the core require guard catches every quote, ./, ../ and deeper paths, require with a space, import and export ... from, and spares prose and artifex/core/', () => {
  const fence = (code) => '```js\n' + code + '\n```';
  for (const code of [
    "const t = require('./core/time.js');",
    'const t = require("./core/time.js");',
    'const t = require(`./core/time.js`);',
    "const t = require('../core/time.js');",
    'const t = require( "../core/time.js" );',
    "const t = require('../../core/time.js');",
    "const p = require.resolve('./core/time.js');",
    "const p = require.resolve('../../core/time.js');",
    "import { t } from './core/time.js';",
    'import { t } from "../../core/time.js";',
    "import './core/time.js';",
    "const m = await import('../core/time.js');",
    "const t = require ('./core/time.js');",
    "const p = require.resolve ('../core/time.js');",
    "export { t } from './core/time.js';",
    "export * from '../../core/time.js';",
  ])assert.deepStrictEqual(localCoreRequireLines(fence(code)), [2], code);
  assert.deepStrictEqual(localCoreRequireLines(fence("const t = require('artifex/core/time.js');")), []);
  assert.deepStrictEqual(localCoreRequireLines(fence("import { t } from 'artifex/core/time.js';")), []);
  assert.deepStrictEqual(localCoreRequireLines(fence("const p = require.resolve('artifex/core/time.js');")), []);
  assert.deepStrictEqual(localCoreRequireLines("Prose may say require('./core/time.js') outside a fence."), []);
  assert.deepStrictEqual(localCoreRequireLines(fence("const t = require('./core/time.js');"), ["const t = require('./core/"]), []);
});

/** Scripts a command may run bare because only a repository clone runs them. Each needs a one-line reason; none today. */
const CLONE_ONLY = new Set();

/**
 * Scripts that prose or inline code may name bare, as a noun for the tool and never as a command to paste.
 * In inline code only the bare name alone is a mention; anything after it before the closing backtick makes it a command.
 * In prose, a name followed by a flag, a quote, a path or a number is still a command. Fenced code has no mentions.
 */
const MENTIONS = {
  film: 'named for its output and reports in sentences; the command to run is written out in full beside them',
  still: 'named for the files it saves; the command to run is written out in full beside it',
  seeds: 'named for the strips it draws and the commands it prints; the command to run is written out in full beside it',
  replay: 'named as the check that judges a saved file; the command to run is written out in full beside it',
  browser: 'named for what it reports; it checks the repository page and is not a command a piece author runs',
};

/**
 * A run of a script by npm: `npm` or `npm.cmd`, any flags (`--silent`, `--prefix "<dir>"`), then `run` or
 * `run-script`. Group 1 holds the flags, group 2 the script.
 */
const NPM_RUN = /\bnpm(?:\.cmd)?\s+((?:--?[\w-]+(?:[=\s]+(?:"[^"]*"|'[^']*'|[^\s"'-]\S*))?\s+)*?)(?:run-script|run)\s+([\w:-]+)/g;

/** Each bare npm run (no `--prefix`) in `text`, fenced or not, as `line: script`. Mentions are spared outside fences. */
function bareNpmRuns(text) {
  const outside = new Set(prose(text, false).map((p) => p.n));
  const out = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const m of line.matchAll(NPM_RUN)) {
      const script = m[2];
      if (/(?:^|\s)--prefix\b/.test(m[1]) || CLONE_ONLY.has(script)) continue;
      const tail = line.slice(m.index + m[0].length);
      const inlineCode = line.slice(0, m.index).split('`').length % 2 === 0;
      // Inside backticks a mention is the bare name alone; in prose the next word must not look like an argument.
      const argument = inlineCode ? !tail.startsWith('`') : /^\s+(?:[-"'<~.\/\\]|\d|\S*\w[./\\]\w)/.test(tail);
      const mention = outside.has(i + 1) && Object.hasOwn(MENTIONS, script) && !argument;
      if (!mention) out.push(`${i + 1}: ${script}`);
    }
  });
  return out;
}

test('commands in the skills use npm --prefix "<library root>" run, never a bare npm run', () => {
  const problems = markdown('skills').flatMap((rel) => bareNpmRuns(fs.readFileSync(path.join(ROOT, rel), 'utf8')).map((p) => `${rel}:${p}`));
  assert.strictEqual(problems.length, 0, `bare npm run in the skills; use npm --prefix "<library root>" run <script>, or name the tool without npm run:\n${problems.join('\n')}`);
});

test('the bare npm run guard reads fenced code, inline code and prose, every spelling, and spares mentions', () => {
  assert.deepStrictEqual(bareNpmRuns('```bash\nnpm run seeds -- "./a.cjs"\nnpm --prefix "<library root>" run film\n```\nnpm run still'), ['2: seeds']);
  assert.deepStrictEqual(bareNpmRuns('```bash\nnpm run film\n```'), ['2: film']);
  for (const cmd of [
    'npm run styles -- check x',
    'npm run styles',
    'npm.cmd run styles',
    'npm run-script styles',
    'npm --silent run styles',
    'npm -s run styles',
    'npm --loglevel silent run styles',
    'npm.cmd --silent run-script styles',
  ]) assert.deepStrictEqual(bareNpmRuns(`Run \`${cmd}\` now.`), ['1: styles'], cmd);
  assert.deepStrictEqual(bareNpmRuns('Run npm run styles in prose.'), ['1: styles']);
  for (const cmd of [
    'npm --prefix "<library root>" run styles',
    'npm.cmd --prefix "<library root>" run-script styles',
    'npm --silent --prefix "<library root>" run styles',
    'npm --prefix="<library root>" --silent run styles',
  ]) assert.deepStrictEqual(bareNpmRuns(`Run \`${cmd}\` now.`), [], cmd);
  // Names that exist on every object are not scripts a list allows.
  for (const name of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) assert.deepStrictEqual(bareNpmRuns(`See \`npm run ${name}\`.`), [`1: ${name}`], name);
  // A mention names the tool; the same name with an argument or a flag is a command.
  assert.deepStrictEqual(bareNpmRuns('`npm run film` names each look, and `--reframe` on `npm run seeds` too. A PNG from npm run still, npm run browser, npm run replay.'), []);
  for (const tail of [' -- "./a.cjs"', ' --scale 8', ' "./a.cjs"', ' ./a.cjs', ' my-piece.cjs', ' bloom 9 0.5', ' ~/a.cjs', ' C:/x/a.cjs', ' 9']) assert.deepStrictEqual(bareNpmRuns(`Use \`npm run still${tail}\`.`), ['1: still'], tail);
  for (const tail of [' -- "./a.cjs"', ' ./a.cjs', ' my-piece.cjs', ' ~/a.cjs', ' C:/x/a.cjs', ' 9']) assert.deepStrictEqual(bareNpmRuns(`Use npm run still${tail} here.`), ['1: still'], `prose${tail}`);
});

/** What the public docs check judges in `dir`: every link, including one doc to another. The docs test and its fixture test both go through here. */
function docsProblems(dir) {
  return brokenLinks(dir);
}

test('a broken anchor between two docs is caught, a good one is not', () => {
  assert.deepStrictEqual(docsProblems('tests/fixtures/broken-docs-anchor'), [
    'tests/fixtures/broken-docs-anchor/a.md:5: b.md#missing-heading: no heading #missing-heading',
  ]);
});

test('every relative link and anchor in the public docs resolves', (t) => {
  if (!fs.existsSync(path.join(ROOT, 'docs'))) return t.skip('no docs/ in this copy');
  const problems = docsProblems('docs');
  assert.strictEqual(problems.length, 0, `broken links in docs/:\n${problems.slice(0, 20).join('\n')}`);
});

test('the films.md anchors npm run film names exist', () => {
  const cli = fs.readFileSync(path.join(ROOT, 'tools', 'film-cli.js'), 'utf8');
  const ids = [...cli.matchAll(/\$\{shown\(FILMS_MD\)\}#([\w-]+)/g)].map((m) => m[1]);
  assert.ok(ids.length > 0, 'tools/film-cli.js names no films.md anchor');
  const films = path.join(ROOT, 'skills', 'artifex', 'reference', 'films.md');
  for (const id of ids) assert.strictEqual(linkProblem(films, '#' + id), null, `films.md#${id}`);
});

test('the music reference is routed from the skill and from films.md, and routes back', () => {
  const skillDir = path.join(ROOT, 'skills', 'artifex');
  const targets = (file) => links(fs.readFileSync(path.join(skillDir, file), 'utf8')).map((l) => l.target);
  assert.ok(targets('SKILL.md').some((t) => t.startsWith('reference/music.md')), 'SKILL.md links to reference/music.md');
  assert.ok(targets(path.join('reference', 'films.md')).some((t) => t.startsWith('music.md#')), 'films.md links into music.md');
  assert.ok(targets(path.join('reference', 'music.md')).some((t) => t.startsWith('sound.md')), 'music.md links back to the sound reference');
});

test('the films.md anchors the film scaffold comments name exist', () => {
  const scaffold = fs.readFileSync(path.join(ROOT, 'skills', 'artifex', 'film-scaffold.cjs'), 'utf8');
  const ids = [...scaffold.matchAll(/reference\/films\.md#([\w-]+)/g)].map((m) => m[1]);
  assert.ok(ids.includes('plan-intensity-with-the-story'), 'the scaffold names no intensity anchor');
  const films = path.join(ROOT, 'skills', 'artifex', 'reference', 'films.md');
  for (const id of ids) assert.strictEqual(linkProblem(films, '#' + id), null, `films.md#${id}`);
});
