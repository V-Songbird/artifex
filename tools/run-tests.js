#!/usr/bin/env node
'use strict';

// Run the test files a change can reach, one run at a time on this machine.
//
// Several worktrees of this repository share one machine. Each `node --test`
// starts as many test processes as the machine has threads less one, so two
// suites at once ask for twice the machine. This runner keeps them apart:
//
//   - It selects only the tests/*.test.js files that reach a changed file. The
//     changed files are those that differ between the working tree and the
//     merge base with --base (main by default), plus untracked files.
//   - A test reaches a file it requires, through `./`, `../` or `artifex/`,
//     or a file whose name it mentions, such as a fixture or a tool it spawns,
//     and so on through each file it reaches. `artifex/core/`, `artifex/styles/`
//     and `<library root>/` specs count as requires. package.json is reached by
//     name but reaches nothing further; a Markdown file reaches only the files its
//     fenced js samples require by those three names, comments skipped. Mentions select too many tests rather
//     than too few; a test that lists a directory is not seen, except those
//     named in READS, so run --all before merging.
//   - A run holds a lock file in the system temp directory. A second run from
//     any worktree waits for it, and takes over a lock whose process is gone.
//   - It passes --test-concurrency, half the machine's threads by default.
//
// --all runs every test file under the same lock and cap. --list prints the
// selection and runs nothing.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { jsSamples } = require('./markdown-samples');
// A name in a comment is prose, not a dependency.
const { uncomment } = require('./js-comments');

const ROOT = path.join(__dirname, '..');
const LOCK = path.join(os.tmpdir(), 'artifex-tests.lock');
// Changed files that reach every test.
const EVERYTHING = new Set(['package.json', '.nvmrc']);
const USAGE = 'usage: node tools/run-tests.js [--all] [--list] [--base main] [--concurrency N]';

function parseArgs(args) {
  const out = { all: false, list: false, base: 'main', concurrency: Math.max(1, Math.floor(os.availableParallelism() / 2)) };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--all') out.all = true;
    else if (a === '--list') out.list = true;
    else if (a === '--base') {
      out.base = args[++i];
      if (!out.base) throw new Error('--base needs a branch or commit');
    } else if (a === '--concurrency') {
      out.concurrency = Number(args[++i]);
      if (!Number.isInteger(out.concurrency) || out.concurrency < 1) throw new Error(`--concurrency needs a whole number of 1 or more, got "${args[i]}"`);
    } else throw new Error(a.startsWith('-') ? `unknown option ${a}` : `unexpected argument "${a}"`);
  }
  return out;
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' }).split('\n').map((s) => s.trim()).filter(Boolean);
}

// A require spec: relative, or one of the skill's names for the library
// (`artifex/core/<file>`, `artifex/styles/<file>`, `<library root>/<path>`).
const REQUIRE = /\brequire\s*\(\s*['"]((?:\.\.?|artifex|<library root>)\/[^'"]+)['"]/g;

/** The repository path a require spec in `from` names, as the skill samples resolve it. */
function specPath(spec, from) {
  if (spec.startsWith('<library root>/')) return spec.slice('<library root>/'.length);
  if (spec.startsWith('artifex/styles/')) return 'skills/' + spec;
  if (spec.startsWith('artifex/')) return spec.slice('artifex/'.length);
  return path.posix.join(path.posix.dirname(from), spec);
}

/** Each file's direct dependencies: the files it requires and the files it names. */
function edges(files, read) {
  const known = new Set(files);
  const byName = new Map();
  for (const f of files) {
    const name = path.posix.basename(f);
    byName.set(name, [...(byName.get(name) || []), f]);
  }
  const out = new Map();
  const follow = (f, text, deps, relative) => {
    for (const [, spec] of text.matchAll(REQUIRE)) {
      if (!relative && spec.startsWith('.')) continue;
      const base = specPath(spec, f);
      const hit = [base, base + '.js', base + '/index.js'].find((p) => known.has(p));
      if (hit) deps.add(hit);
    }
  };
  for (const f of files) {
    const deps = new Set();
    // package.json names every tool, so following it would reach them all.
    if (/\.(c?js|json)$/.test(f) && !EVERYTHING.has(f)) {
      const text = uncomment(read(f));
      follow(f, text, deps, true);
      for (const [name] of text.matchAll(/[\w.-]+\.(?:c?js|json|md)\b/g)) for (const g of byName.get(name) || []) deps.add(g);
    } else if (f.endsWith('.md')) {
      // A Markdown file reaches only the library files its fenced js samples require by the skill's names.
      for (const { source } of jsSamples(read(f))) follow(f, uncomment(source), deps, false);
    }
    deps.delete(f);
    out.set(f, deps);
  }
  return out;
}

// Tests that list a directory, so no edge reaches what they read: each is selected
// by a changed file matching one pattern, and also reaches what the matching files
// require. The skill-samples test reads the skill's docs; the library files, styles
// and tools a sample requires are edges from those docs, so only the docs and core/
// (a sample may reach a core module through a path the docs do not spell) are listed.
const READS = {
  'tests/skill-samples.test.js': [/^skills\/artifex\/(?:SKILL|reference\/[^/]+)\.md$/, /^core\//],
};

/** The tests whose dependencies, followed to the end, include a changed file. */
function affected(tests, deps, changed) {
  const hit = new Set(changed);
  return tests.filter((t) => {
    const reads = READS[t] || [];
    if (reads.some((re) => changed.some((f) => re.test(f)))) return true;
    const seen = new Set([t]);
    const stack = [t];
    // The Markdown files it reads are dependencies too, so what their samples require is reached.
    if (reads.length) for (const f of deps.keys()) if (f.endsWith('.md') && reads.some((re) => re.test(f))) { seen.add(f); stack.push(f); }
    while (stack.length) {
      const f = stack.pop();
      if (hit.has(f)) return true;
      for (const d of deps.get(f) || []) if (!seen.has(d)) { seen.add(d); stack.push(d); }
    }
    return false;
  });
}

/** Wait until no other test run on this machine holds the lock, then hold it. */
async function acquire() {
  let told = false;
  for (;;) {
    try {
      fs.writeFileSync(LOCK, `${process.pid}\n${ROOT}\n`, { flag: 'wx' });
      process.on('exit', release);
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const [pid, where] = (fs.existsSync(LOCK) ? fs.readFileSync(LOCK, 'utf8') : '').split('\n');
    // A lock with no pid yet is being written; wait for it like a live one.
    if (pid && !alive(Number(pid))) { fs.rmSync(LOCK, { force: true }); continue; }
    if (!told) { console.error(`run-tests: waiting for the test run in ${where || 'another worktree'} (pid ${pid || '?'}) to finish`); told = true; }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

function release() {
  try { if (fs.readFileSync(LOCK, 'utf8').split('\n')[0] === String(process.pid)) fs.rmSync(LOCK, { force: true }); } catch { /* already gone */ }
}

async function main({ all, list, base, concurrency }) {
  const files = [...new Set([...git(['ls-files']), ...git(['ls-files', '--others', '--exclude-standard'])])];
  const tests = files.filter((f) => /^tests\/[^/]+\.test\.js$/.test(f)).sort();
  let selected = tests;
  if (!all) {
    const fork = git(['merge-base', base, 'HEAD'])[0];
    const changed = [...new Set([...git(['diff', '--name-only', fork]), ...git(['ls-files', '--others', '--exclude-standard'])])];
    const wide = changed.filter((f) => EVERYTHING.has(f));
    if (wide.length) console.error(`run-tests: ${wide.join(', ')} changed, so every test runs`);
    else {
      const deps = edges(files, (f) => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { return ''; } });
      selected = affected(tests, deps, changed);
      const unreached = changed.filter((f) => /\.c?js$/.test(f) && affected(tests, deps, [f]).length === 0);
      if (unreached.length) console.error(`run-tests: no test reaches ${unreached.join(', ')}`);
    }
    console.error(`run-tests: ${changed.length} changed file(s) against ${base}; ${selected.length} of ${tests.length} test files reach them`);
  }
  if (list) { for (const t of selected) console.log(t); return; }
  if (!selected.length) return;
  await acquire();
  console.error(`run-tests: running ${selected.length} test file(s), at most ${concurrency} at once`);
  const run = spawnSync(process.execPath, ['--test', `--test-concurrency=${concurrency}`, ...selected], { cwd: ROOT, stdio: 'inherit' });
  process.exitCode = run.status ?? 1;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) console.log(USAGE);
  else {
    let opts;
    try { opts = parseArgs(args); } catch (e) {
      console.error('run-tests: ' + e.message + '\n' + USAGE);
      process.exitCode = 1;
    }
    // Ctrl+C ends the run through process.exit, so the lock is released.
    process.on('SIGINT', () => process.exit(130));
    if (opts) main(opts).catch((error) => { console.error('run-tests: ' + error.message); process.exitCode = 1; });
  }
}

module.exports = { parseArgs, edges, affected };
