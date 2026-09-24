'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const {
  runSuite, mutationVerdict, terminateSuite, removeCopy, judgeMutation, selectMutations, main, RUN_PREFIX, SUITE_TEMP, COPIED,
} = require('./negative.js');

const PASS_TAP = `TAP version 13
# Subtest: checks the value
ok 1 - checks the value
1..1
# tests 1
# suites 0
# pass 1
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1.5
`;
const FAIL_TAP = PASS_TAP.replace('ok 1 -', 'not ok 1 -').replace('# pass 1', '# pass 0').replace('# fail 0', '# fail 1');

function captured(stdout, status = 0, extra = {}) {
  return runSuite('.', () => ({ stdout, stderr: '', status, signal: null, ...extra }));
}

// Short, like the runner's own names: a runner test nests a whole run inside a copy.
const FIXTURE_PREFIX = 'artifex-rt-';

function fixture(t, source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
  t.after(() => removeCopy(dir));
  fs.mkdirSync(path.join(dir, 'tests'));
  fs.writeFileSync(path.join(dir, 'tests', 'fixture.test.js'), source);
  return dir;
}

test('mutation runner keeps launch errors and stderr instead of accepting empty TAP', async () => {
  const error = Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
  const result = await captured('', null, { error, stderr: 'permission diagnostic' });
  assert.equal(result.error, error);
  assert.equal(result.status, null);
  assert.equal(result.stderr, 'permission diagnostic');
  assert.match(result.failure, /EPERM/);
  assert.equal(mutationVerdict(result, 'checks the value'), 'infra');
  const thrown = await runSuite('.', () => { throw error; });
  assert.equal(thrown.error, error);
  assert.match(thrown.failure, /EPERM/);
});

test('mutation runner rejects empty, truncated, duplicate and inconsistent TAP reports', async () => {
  for (const stdout of [
    '', 'TAP version 13\n', PASS_TAP.slice(0, PASS_TAP.indexOf('1..1')),
    PASS_TAP.replace('# duration_ms 1.5\n', ''),
    PASS_TAP.replace('1..1', '1..2'), PASS_TAP.replace('ok 1 -', 'ok 2 -'),
    PASS_TAP.replace('# tests 1', '# tests 2'),
    PASS_TAP.replace('# fail 0', '# fail 0\n# fail 0'),
    PASS_TAP.replace('1..1', '1..1\n1..1'),
    PASS_TAP.replace('ok 1 - checks the value', 'Bail out! interrupted'),
    PASS_TAP.replace('# pass 1', '# pass 0').replace('# skipped 0', '# skipped 1'),
    FAIL_TAP.replace('# fail 1', '# fail 0').replace('# cancelled 0', '# cancelled 1'),
  ]) {
    const result = await captured(stdout);
    assert.ok(result.failure, stdout);
    assert.equal(mutationVerdict(result, 'checks the value'), 'infra');
  }
});

test('mutation runner requires process status and completed TAP failures to agree', async () => {
  for (const result of await Promise.all([
    captured(PASS_TAP, 1), captured(FAIL_TAP, 0), captured(FAIL_TAP, 2),
    captured(FAIL_TAP, null), captured(FAIL_TAP, null, { signal: 'SIGTERM' }),
    captured(FAIL_TAP, 1, { error: Object.assign(new Error('buffer exhausted'), { code: 'ENOBUFS' }) }),
  ])) {
    assert.ok(result.failure);
    assert.equal(mutationVerdict(result, 'checks the value'), 'infra',
      'a previously printed matching failure must not hide a process/report failure');
  }
  const signalled = await captured(FAIL_TAP, null, { signal: 'SIGTERM' });
  assert.equal(signalled.signal, 'SIGTERM');
  assert.equal(signalled.stdout, FAIL_TAP);
});

test('mutation runner preserves caught, misnamed and escaped named-assertion distinctions', async () => {
  const failed = await captured(FAIL_TAP, 1);
  assert.equal(failed.failure, null);
  assert.deepEqual(failed.failed, ['checks the value']);
  assert.equal(mutationVerdict(failed, 'checks the value'), 'caught');
  assert.equal(mutationVerdict(failed, 'another assertion'), 'misnamed');
  const passed = await captured(PASS_TAP.replace(/\n/g, '\r\n'));
  assert.equal(passed.failure, null);
  assert.deepEqual(passed.failed, []);
  assert.equal(mutationVerdict(passed, 'checks the value'), 'escaped');
});

test('mutation runner matches real escaped TAP names without interpreting them as directives', async (t) => {
  const safe = ['leaf # hash', 'leaf \\ path',
    'leaf # SKIP literal', 'leaf # TODO literal', 'leaf \\# TODO escaped hash',
    'leaf trailing  '];
  const ambiguous = ['leaf\nsecond line', 'leaf\bbackspace', 'leaf\fform feed',
    'leaf\ttab', 'leaf\rcarriage', 'leaf\vvertical'];
  const names = [...safe, ...ambiguous];
  const dir = fixture(t, `const {test, describe} = require('node:test');
    describe('outer # suite', () => {
      for (const name of ${JSON.stringify(names)}) test(name, () => { throw Error('expected failure'); });
    });`);
  const result = await runSuite(dir);
  assert.equal(result.status, 1);
  assert.equal(result.failure, null, result.stdout);
  assert.equal(result.summary.fail, names.length);
  assert.equal(result.summary.skipped, 0);
  assert.equal(result.summary.todo, 0);
  for (const name of [...safe, 'outer # suite']) {
    assert.equal(mutationVerdict(result, name), 'caught', JSON.stringify(name));
  }
  for (const name of ambiguous) assert.equal(mutationVerdict(result, name), 'infra', JSON.stringify(name));
  assert.equal(mutationVerdict(result, 'another # assertion'), 'misnamed');
});

test('mutation runner refuses control-name aliases even when only the other source title fails', async (t) => {
  const target = 'target\nline';
  const alias = 'target\\nline';
  const dir = fixture(t, `const test = require('node:test');
    test(${JSON.stringify(target)}, () => {});
    test(${JSON.stringify(alias)}, () => { throw Error('alias failed'); });`);
  const collision = await runSuite(dir);
  assert.equal(collision.failure, null, collision.stdout);
  assert.equal(collision.summary.pass, 1);
  assert.equal(collision.summary.fail, 1);
  assert.equal(mutationVerdict(collision, target), 'infra', 'a passing target must not borrow its alias failure');
  assert.equal(mutationVerdict(collision, alias), 'infra', 'the encoded report cannot distinguish the source titles');
  fs.writeFileSync(path.join(dir, 'tests', 'fixture.test.js'), `require('node:test')(${JSON.stringify(alias)}, () => { throw Error('alias only'); });`);
  const absent = await runSuite(dir);
  assert.equal(absent.failure, null, absent.stdout);
  assert.equal(absent.summary.tests, 1);
  assert.equal(mutationVerdict(absent, target), 'infra', 'absence of duplicate results cannot establish source identity');
});

test('mutation runner refuses duplicate target titles while preserving unique failure attribution', async (t) => {
  const dir = fixture(t, `const test = require('node:test');
    test('duplicate target', () => {});
    test('duplicate target', () => { throw Error('second target failed'); });
    test('unique target', () => { throw Error('unique failed'); });`);
  const result = await runSuite(dir);
  assert.equal(result.failure, null, result.stdout);
  assert.deepEqual(result.names, ['duplicate target', 'duplicate target', 'unique target']);
  assert.equal(mutationVerdict(result, 'duplicate target'), 'infra');
  assert.equal(mutationVerdict(result, 'unique target'), 'caught');
});

test('mutation runner pins TAP and captures real passing and failing Node test processes', async (t) => {
  const dir = fixture(t, `const { test, describe } = require('node:test');
    describe('fixture suite', () => { test('checks the value', () => {}); });`);
  let invocation;
  const inheritedContext = process.env.NODE_TEST_CONTEXT;
  const passed = await runSuite(dir, (command, args, options) => {
    invocation = { command, args, options };
    return spawnSync(command, args, options);
  });
  assert.deepEqual(invocation.args, ['--test', '--test-reporter=tap', 'tests/*.test.js']);
  assert.equal(invocation.options.cwd, dir);
  assert.equal(invocation.options.env.NODE_TEST_CONTEXT, undefined);
  assert.equal(process.env.NODE_TEST_CONTEXT, inheritedContext, 'the parent environment is unchanged');
  assert.equal(passed.status, 0, passed.stderr);
  assert.equal(passed.failure, null, passed.stdout);
  assert.equal(passed.summary.tests, 1);
  assert.equal(passed.summary.suites, 1);
  fs.writeFileSync(path.join(dir, 'tests', 'fixture.test.js'), `require('node:test')('checks the value', () => {
    require('node:assert/strict').equal(1, 2);
  });`);
  const failed = await runSuite(dir);
  assert.equal(failed.status, 1);
  assert.equal(failed.failure, null, failed.stdout);
  assert.equal(mutationVerdict(failed, 'checks the value'), 'caught');
});

test('mutation runner retains failing nested leaves and ignores TAP inside diagnostics', async (t) => {
  const dir = fixture(t, `const {test, describe} = require('node:test');
    describe('outer suite', () => {
      describe('inner suite', () => {
        test('leaf regression', () => {
          throw new Error('not ok 99 - forged failure\\n1..99\\n# Subtest: fake');
        });
      });
      test('passing sibling', () => {});
    });`);
  const result = await runSuite(dir);
  assert.equal(result.status, 1);
  assert.equal(result.failure, null, result.stdout);
  assert.equal(mutationVerdict(result, 'leaf regression'), 'caught');
  assert.equal(mutationVerdict(result, 'forged failure'), 'misnamed');
  assert.ok(result.failed.includes('inner suite') && result.failed.includes('outer suite'));
});

test('mutation runner requires complete independent plans in every nested TAP scope', async (t) => {
  const dir = fixture(t, `const {test, describe} = require('node:test');
    describe('outer suite', () => {
      describe('inner suite', () => { test('leaf regression', () => {}); });
      test('passing sibling', () => {});
    });
    describe('second suite', () => { test('separate leaf', () => {}); });`);
  const green = await runSuite(dir);
  assert.equal(green.failure, null, green.stdout);
  assert.equal(green.summary.tests, 3);
  assert.equal(green.summary.suites, 3);
  for (const damaged of [
    green.stdout.replace(/^        ok 1 - leaf regression\r?\n/m, ''),
    green.stdout.replace(/^        1\.\.1\r?\n/m, ''),
    green.stdout.replace(/^        1\.\.1$/m, '        1..2'),
    green.stdout.replace(/^        ok 1 - leaf regression$/m, '        ok 2 - leaf regression'),
    green.stdout.replace(/^    1\.\.2\r?\n/m, ''),
    green.stdout.replace('# tests 3', '# tests 4').replace('# pass 3', '# pass 4'),
  ]) {
    assert.notEqual(damaged, green.stdout, 'the regression must alter the real emitted TAP');
    const result = await captured(damaged);
    assert.ok(result.failure, damaged);
    assert.equal(mutationVerdict(result, 'leaf regression'), 'infra');
  }
});

test('mutation runner counts nested test parents and suite directives like Node does', async (t) => {
  const dir = fixture(t, `const {test, describe} = require('node:test');
    describe('outer', () => {
      describe('empty', () => {});
      test('skipped', {skip:true}, () => {});
      test('todo', {todo:true}, () => { throw Error('planned'); });
      test('parent test', async t => { await t.test('child test', () => {}); });
    });
    describe('skipped suite', {skip:true}, () => { test('unrun leaf', () => {}); });
    describe('todo suite', {todo:true}, () => { test('todo leaf', () => { throw Error('planned'); }); });`);
  const result = await runSuite(dir);
  assert.equal(result.status, 0);
  assert.equal(result.failure, null, result.stdout);
  assert.deepEqual(result.summary, { tests: 5, suites: 4, pass: 2, fail: 0, cancelled: 0, skipped: 1, todo: 2 });
  assert.deepEqual(result.failed, []);
});

test('mutation runner rejects actual process exits without a completed test report', async (t) => {
  const dir = fixture(t, '');
  for (const [out, code] of [['', 0], ['TAP version 13\nnot ok 1 - checks the value\n', 1]]) {
    const result = await runSuite(dir, (command, _args, options) => spawnSync(command,
      ['-e', `process.stdout.write(${JSON.stringify(out)}); process.exit(${code});`], options));
    assert.equal(result.status, code);
    assert.equal(result.stdout, out);
    assert.ok(result.failure);
    assert.equal(mutationVerdict(result, 'checks the value'), 'infra');
  }
  const missing = await runSuite(dir, (_command, _args, options) => spawnSync(
    path.join(dir, 'missing-node-executable'), [], options));
  assert.equal(missing.error.code, 'ENOENT');
  assert.equal(missing.status, null);
  assert.match(missing.failure, /ENOENT/);
});

test('failed control exits 2, prints its failing assertion and removes only its owned temporary directory', (t) => {
  const dir = fixture(t, `require('node:test')('deliberately failing control', () => {
    require('node:assert/strict').equal(1, 2);
  });`);
  const runner = path.join(dir, 'tests', 'negative.js');
  fs.copyFileSync(path.join(__dirname, 'negative.js'), runner);
  const tempRoot = path.join(dir, 'temp');
  const unrelated = path.join(tempRoot, 'artifex-negative-unrelated');
  fs.mkdirSync(unrelated, { recursive: true });
  fs.writeFileSync(path.join(unrelated, 'keep.txt'), 'unrelated work');
  // Observe allocation in the real CLI process; leave creation and cleanup real.
  const observer = path.join(dir, 'observe.cjs');
  const evidence = path.join(dir, 'allocated.json');
  fs.writeFileSync(observer, `const fs = require('node:fs');
    const allocate = fs.mkdtempSync;
    fs.mkdtempSync = (...args) => {
      const allocated = allocate(...args);
      fs.writeFileSync(${JSON.stringify(evidence)}, JSON.stringify(allocated));
      return allocated;
    };`);
  const env = { ...process.env, TEMP: tempRoot, TMP: tempRoot, TMPDIR: tempRoot };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--require', observer, runner], {
    cwd: dir, encoding: 'utf8', env,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /CONTROL IS NOT GREEN/);
  assert.match(result.stderr, /deliberately failing control/);
  assert.match(result.stderr, /Expected values to be strictly equal:\s+1 !== 2/, 'the assertion message');
  assert.match(result.stderr, /^ +expected: 2$/m, 'the expected value');
  assert.match(result.stderr, /^ +actual: 1$/m, 'the actual value');
  assert.match(result.stderr, /fixture\.test\.js:2:/, 'the assertion location');
  assert.doesNotMatch(result.stdout, /suite green|\bcaught\b|ESCAPED|MISNAMED/);
  const allocated = JSON.parse(fs.readFileSync(evidence, 'utf8'));
  assert.equal(path.dirname(allocated), tempRoot);
  assert.ok(path.basename(allocated).startsWith(RUN_PREFIX), allocated);
  assert.equal(fs.existsSync(allocated), false, 'the failed control must release its own source copy');
  assert.deepEqual(fs.readdirSync(tempRoot), ['artifex-negative-unrelated']);
  assert.equal(fs.readFileSync(path.join(unrelated, 'keep.txt'), 'utf8'), 'unrelated work');
});

test('a new run removes the copies of stopped runs and keeps their evidence and everything else', (t) => {
  const dir = fixture(t, `require('node:test')('deliberately failing control', () => { throw Error('red'); });`);
  const runner = path.join(dir, 'tests', 'negative.js');
  fs.copyFileSync(path.join(__dirname, 'negative.js'), runner);
  const tempRoot = path.join(dir, 'temp');
  const gone = spawnSync(process.execPath, ['-e', '']).pid;
  const seeded = {
    [`${RUN_PREFIX}${gone}-stopped`]: ['control', 'm3', path.join('infrastructure', 'm3')],
    [`${RUN_PREFIX}${gone}-copies`]: ['control', 'm0'],
    [`${RUN_PREFIX}${process.pid}-live`]: ['m1'],
    'artifex-negative-AbC123': ['m2'],
    [`artifex-negative-${gone}-older`]: ['m4'],
    'artifex-negative-unrelated': ['keep'],
    'artifex-rt-other': ['tests'],
  };
  for (const [name, entries] of Object.entries(seeded)) {
    for (const entry of entries) {
      fs.mkdirSync(path.join(tempRoot, name, entry), { recursive: true });
      fs.writeFileSync(path.join(tempRoot, name, entry, 'file'), 'kept');
    }
  }
  const env = { ...process.env, TEMP: tempRoot, TMP: tempRoot, TMPDIR: tempRoot };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [runner], { cwd: dir, encoding: 'utf8', env, windowsHide: true });
  assert.equal(result.status, 2, result.stderr);
  const list = (name) => (fs.existsSync(path.join(tempRoot, name)) ? fs.readdirSync(path.join(tempRoot, name)).sort() : null);
  assert.deepEqual(list(`${RUN_PREFIX}${gone}-stopped`), ['infrastructure'], 'a stopped run keeps only its evidence');
  assert.equal(fs.readFileSync(path.join(tempRoot, `${RUN_PREFIX}${gone}-stopped`, 'infrastructure', 'm3', 'file'), 'utf8'), 'kept');
  assert.equal(list(`${RUN_PREFIX}${gone}-copies`), null, 'a stopped run without evidence is removed');
  assert.deepEqual(list(`${RUN_PREFIX}${process.pid}-live`), ['m1'], 'a live run is never touched');
  assert.deepEqual(list('artifex-negative-AbC123'), ['m2'], 'a root without a runner pid is not this sweep\'s');
  assert.deepEqual(list(`artifex-negative-${gone}-older`), ['m4'], 'a root named before the short prefix is not this sweep\'s');
  assert.deepEqual(list('artifex-negative-unrelated'), ['keep']);
  assert.deepEqual(list('artifex-rt-other'), ['tests']);
  assert.deepEqual(fs.readdirSync(tempRoot).sort(), Object.keys(seeded).filter((name) => !name.endsWith('-copies')).sort(),
    'the run removed its own root and nothing else');
});

test('mutation suite deadlines have a finite default and reject invalid overrides before launch', async () => {
  let requested;
  const execute = (_command, _args, options) => {
    requested = options.timeout;
    return { status: 0, signal: null, stdout: PASS_TAP, stderr: '' };
  };
  const defaultResult = await runSuite('.', execute);
  assert.equal(requested, process.env.ARTIFEX_NEGATIVE_TIMEOUT_MS === undefined
    ? 300000 : Number(process.env.ARTIFEX_NEGATIVE_TIMEOUT_MS));
  assert.equal(defaultResult.timeoutMs, requested);
  assert.equal(defaultResult.timedOut, false);
  await runSuite('.', execute, 1234);
  assert.equal(requested, 1234);
  for (const invalid of [0, -1, 0.5, Infinity, NaN, '', 'not-a-number', 2147483648]) {
    await assert.rejects(runSuite('.', () => { throw Error('must not launch'); }, invalid),
      /ARTIFEX_NEGATIVE_TIMEOUT_MS/);
  }
});

test('mutation runner bounds real output and retains real asynchronous launch errors', async (t) => {
  const dir = fixture(t, `require('node:test')('large diagnostic', () => {
    process.stdout.write('x'.repeat(2 * 1048576));
  });`);
  // The deadlines only stop a broken run: each case ends on its own error well
  // before them, but CPU load can delay a flooding suite by seconds.
  const missing = await runSuite(path.join(dir, 'missing-directory'), undefined, 60000);
  assert.equal(missing.error.code, 'ENOENT');
  assert.notEqual(missing.status, 0, 'preserve the actual asynchronous launch status');
  assert.equal(missing.timedOut, false);
  const flooded = await runSuite(dir, undefined, 60000);
  assert.equal(flooded.error.code, 'ENOBUFS');
  assert.equal(mutationVerdict(flooded, 'large diagnostic'), 'infra');
  assert.ok(Buffer.byteLength(flooded.stdout + flooded.stderr) <= 1048576);
});

test('real hanging suite returns timeout metadata instead of a mutation verdict', async (t) => {
  const dir = fixture(t, 'setInterval(() => {}, 1000);');
  const started = Date.now();
  const result = await runSuite(dir, undefined, 500);
  assert.equal(result.error.code, 'ETIMEDOUT');
  assert.equal(result.timedOut, true);
  assert.equal(result.timeoutMs, 500);
  assert.equal(result.terminationError, undefined);
  assert.ok(result.status !== 0 || result.signal !== null);
  assert.equal(mutationVerdict(result, 'anything'), 'infra');
  // The runner allows the deadline plus its 30 s teardown limit; the rest is
  // process start-up, which CPU load from other work can stretch to seconds.
  assert.ok(Date.now() - started < 500 + 30000 + 20000, 'deadline and owned teardown must be bounded');
  assert.throws(() => process.kill(result.pid, 0), { code: 'ESRCH' });
});

test('timed-out control stops its actual process tree, keeps its evidence and preserves unrelated temporary work', (t) => {
  const dir = fixture(t, '');
  const pidsFile = path.join(dir, 'owned-pids.json');
  const fixtureFile = path.join(dir, 'suite-fixture.json');
  // Like a runner test, the killed suite made a temporary fixture it never removes.
  fs.writeFileSync(path.join(dir, 'tests', 'fixture.test.js'), `const {spawn}=require('node:child_process');
    const fs=require('node:fs'), made=fs.mkdtempSync(require('node:path').join(require('node:os').tmpdir(),${JSON.stringify(FIXTURE_PREFIX)}));
    fs.writeFileSync(${JSON.stringify(fixtureFile)},JSON.stringify(made));
    const child=spawn(process.execPath,['-e','setInterval(() => {}, 1000)'],{stdio:'ignore',windowsHide:true});
    fs.writeFileSync(${JSON.stringify(pidsFile)},JSON.stringify([process.ppid,process.pid,child.pid]));
    setInterval(() => {}, 1000);`);
  const runner = path.join(dir, 'tests', 'negative.js');
  fs.copyFileSync(path.join(__dirname, 'negative.js'), runner);
  const tempRoot = path.join(dir, 'temp');
  const unrelated = path.join(tempRoot, 'artifex-negative-unrelated');
  fs.mkdirSync(unrelated, { recursive: true });
  fs.writeFileSync(path.join(unrelated, 'keep.txt'), 'unrelated work');
  const observer = path.join(dir, 'observe.cjs');
  const allocatedFile = path.join(dir, 'allocated.json');
  fs.writeFileSync(observer, `const fs=require('node:fs'), allocate=fs.mkdtempSync;
    fs.mkdtempSync=(...args)=>{const owned=allocate(...args);
      fs.writeFileSync(${JSON.stringify(allocatedFile)},JSON.stringify(owned));return owned;};`);
  let ownedPids = [];
  t.after(() => {
    // Failure-only cleanup is limited to the PIDs created by this fixture.
    for (const pid of ownedPids) {
      try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  });
  // CPU load can delay the worker past a short deadline, which then stops a tree
  // that never started. Lengthen the deadline until the whole tree has started;
  // every attempt must still time out and release its own copy.
  for (const deadline of [1500, 6000, 24000]) {
    fs.rmSync(fixtureFile, { force: true });
    const env = { ...process.env, TEMP: tempRoot, TMP: tempRoot, TMPDIR: tempRoot, ARTIFEX_NEGATIVE_TIMEOUT_MS: String(deadline) };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['--require', observer, runner], {
      cwd: dir, encoding: 'utf8', env, windowsHide: true, timeout: deadline + 70000,
    });
    ownedPids = fs.existsSync(pidsFile) ? JSON.parse(fs.readFileSync(pidsFile, 'utf8')) : [];
    assert.equal(result.error, undefined, 'the outer guard must not kill the CLI');
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /CONTROL INFRASTRUCTURE FAILURE/);
    assert.match(result.stderr, new RegExp(`ETIMEDOUT.*${deadline}ms`));
    const allocated = JSON.parse(fs.readFileSync(allocatedFile, 'utf8'));
    assert.equal(path.dirname(allocated), tempRoot);
    // The copy is gone; the run's temp root stays only for the evidence the report names.
    const kept = path.join(allocated, 'infrastructure', 'control');
    assert.ok(result.stderr.includes(`kept in ${kept}`), result.stderr);
    assert.deepEqual(fs.readdirSync(allocated), ['infrastructure']);
    assert.deepEqual(fs.readdirSync(kept).sort(), ['result.json', 'stderr.txt', 'stdout.tap']);
    const saved = JSON.parse(fs.readFileSync(path.join(kept, 'result.json'), 'utf8'));
    assert.deepEqual([saved.timedOut, saved.error.code, saved.timeoutMs], [true, 'ETIMEDOUT', deadline]);
    if (fs.existsSync(fixtureFile)) {
      const made = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
      assert.ok(made.startsWith(allocated + path.sep), 'the suite made its fixture inside the run: ' + made);
      assert.equal(fs.existsSync(made), false, 'the killed suite leaves no fixture behind');
    }
    fs.rmSync(allocated, { recursive: true, force: true });
    assert.deepEqual(fs.readdirSync(tempRoot), ['artifex-negative-unrelated']);
    if (ownedPids.length) break;
  }
  assert.ok(fs.existsSync(fixtureFile), 'the killed suite made a fixture');
  assert.equal(ownedPids.length, 3, 'the real test worker and its descendant must have started');
  for (const pid of ownedPids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  assert.equal(fs.readFileSync(path.join(unrelated, 'keep.txt'), 'utf8'), 'unrelated work');
});

test('owned teardown is judged by its own process, never by the kill command', async (t) => {
  // Every kill targets a helper this test owns; each fake suite process only
  // decides whether it exited, as a real one does after or during the kill.
  const helpers = [];
  t.after(() => { for (const helper of helpers) try { helper.kill('SIGKILL'); } catch { /* already stopped */ } });
  const owned = () => {
    const helper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'],
      { stdio: 'ignore', windowsHide: true, detached: process.platform !== 'win32' });
    helpers.push(helper);
    return helper;
  };
  const suite = (exitCode) => Object.assign(new EventEmitter(), { pid: owned().pid, exitCode, signalCode: null });
  const stuck = suite(null);
  const started = Date.now();
  assert.match((await terminateSuite(stuck, 300))?.message ?? '',
    new RegExp(`owned tree termination left process ${stuck.pid} running 300 ms after the kill`), 'a process still running is a failure');
  assert.ok(Date.now() - started >= 300, 'the process is awaited for the whole grace period');
  assert.equal(await terminateSuite(suite(1), 300), null, 'a process that exited by itself has stopped');
  const exiting = suite(null);
  // Exit only once teardown is waiting, as when the exit arrives after the kill's.
  exiting.on('newListener', (event) => { if (event === 'exit') setImmediate(() => exiting.emit('exit', 1, null)); });
  assert.equal(await terminateSuite(exiting, 5000), null, 'a process seen exiting within the grace period has stopped');
  const real = owned();
  assert.equal(await terminateSuite(real), null, 'a real process is stopped');
  assert.notEqual(real.exitCode ?? real.signalCode, null);
});

test('an infrastructure result keeps its streams and stays infrastructure after one report-only retry', async (t) => {
  const root = fixture(t, '');
  const evidence = path.join(root, 'infrastructure', 'm7');
  const truncated = PASS_TAP.slice(0, PASS_TAP.indexOf('1..1'));
  const m = { why: 'a mutation', expect: 'checks the value' };
  for (const [second, retry] of [[{ stdout: FAIL_TAP }, 'caught'], [{ stdout: truncated }, 'infra']]) {
    fs.rmSync(path.join(root, 'infrastructure'), { recursive: true, force: true });
    const attempts = [{ stdout: truncated, stderr: 'first diagnostic' }, { stderr: 'second diagnostic', ...second }];
    let calls = 0;
    const judged = await judgeMutation('.', m, evidence, 1000, () => ({ status: 1, signal: null, ...attempts[calls++] }));
    assert.equal(calls, 2, 'one retry, no more');
    assert.equal(judged.verdict, 'infra', 'the retry never replaces the verdict');
    assert.equal(judged.retry, retry);
    assert.equal(fs.readFileSync(path.join(evidence, 'stdout.tap'), 'utf8'), truncated);
    assert.equal(fs.readFileSync(path.join(evidence, 'stderr.txt'), 'utf8'), 'first diagnostic');
    const saved = JSON.parse(fs.readFileSync(path.join(evidence, 'result.json'), 'utf8'));
    assert.deepEqual([saved.status, saved.timeoutMs], [1, 1000]);
    assert.match(saved.failure, /incomplete/);
    assert.ok(judged.text.includes(`kept in ${evidence}\n`), judged.text);
    assert.ok(judged.text.includes(`retry, report only: ${retry}`), judged.text);
    assert.equal(fs.existsSync(`${evidence}-retry`), retry === 'infra', 'only an infrastructure retry keeps its streams');
    if (retry === 'infra') {
      assert.ok(judged.text.includes(`kept in ${evidence}-retry`), judged.text);
      assert.equal(fs.readFileSync(path.join(`${evidence}-retry`, 'stderr.txt'), 'utf8'), 'second diagnostic');
    }
  }
  let calls = 0;
  const caught = await judgeMutation('.', m, path.join(root, 'caught'), 1000, () => {
    calls++;
    return { stdout: FAIL_TAP, stderr: '', status: 1, signal: null };
  });
  assert.deepEqual([caught.verdict, calls, fs.existsSync(path.join(root, 'caught'))], ['caught', 1, false]);
});

test('misnamed and infrastructure results print what the unintended failure saw', async (t) => {
  const diagnosed = FAIL_TAP.replace('not ok 1 - checks the value\n',
    "not ok 1 - checks the value\n  ---\n  duration_ms: 1\n  error: 'unintended failure'\n  ...\n");
  const execute = () => ({ stdout: diagnosed, stderr: '', status: 1, signal: null });
  const misnamed = await judgeMutation('.', { why: 'w', expect: 'another assertion' }, 'unused', 1000, execute);
  assert.equal(misnamed.verdict, 'misnamed');
  assert.match(misnamed.text, /expected: another assertion\n +failed:\n +checks the value\n +duration_ms: 1\n +error: 'unintended failure'/);
  const evidence = path.join(fixture(t, ''), 'ambiguous');
  const ambiguous = await judgeMutation('.', { why: 'w', expect: 'checks\\nvalue' }, evidence, 1000, execute);
  assert.equal(ambiguous.verdict, 'infra');
  assert.match(ambiguous.text, /checks the value\n +duration_ms: 1\n +error: 'unintended failure'/);
});

test('mutation filters choose by mutated file and expected title and refuse what matches nothing', () => {
  const list = [
    { file: 'examples/readout.js', expect: 'readout: the reading keeps its pace' },
    { file: 'examples/readout.js', expect: 'readout: every digit is heard' },
    { file: 'core/film.js', expect: 'film: frames keep their timestamps' },
  ];
  assert.deepEqual(selectMutations([], list), { chosen: list, filter: '' }, 'no filter runs everything');
  assert.deepEqual(selectMutations(['--file', 'examples/readout.js'], list).chosen, list.slice(0, 2));
  assert.deepEqual(selectMutations(['--file', '.\\examples\\readout.js'], list).chosen, list.slice(0, 2), 'Windows paths name the same file');
  assert.deepEqual(selectMutations(['--expect', 'digit'], list).chosen, [list[1]]);
  assert.deepEqual(selectMutations(['--file', 'core/film.js', '--file', 'examples/readout.js'], list).chosen, list, 'a repeated kind widens');
  const both = selectMutations(['--file', 'examples/readout.js', '--expect', 'pace'], list);
  assert.deepEqual(both, { chosen: [list[0]], filter: '--file examples/readout.js --expect pace' }, 'both kinds must match');
  for (const args of [['--file'], ['--file', ''], ['--file', '--expect'], ['--other', 'x'], ['examples/readout.js']]) {
    assert.throws(() => selectMutations(args, list), /usage: node tests\/negative\.js/, JSON.stringify(args));
  }
  assert.throws(() => selectMutations(['--file', 'core/film.js', '--expect', 'digit'], list), /no mutation matches --file core\/film\.js --expect digit/);
});

test('mutation shards hold every mutation exactly once and narrow the other filters', () => {
  const list = Array.from({ length: 11 }, (_, i) => ({ file: i < 6 ? 'core/a.js' : 'core/b.js', expect: `title ${i}` }));
  for (const n of [1, 2, 4, 11]) {
    const shards = Array.from({ length: n }, (_, k) => selectMutations(['--shard', `${k + 1}/${n}`], list));
    assert.deepEqual(shards.flatMap((s) => s.chosen).sort((a, b) => list.indexOf(a) - list.indexOf(b)), list, `${n} shards cover the list once`);
    assert.equal(new Set(shards.flatMap((s) => s.chosen)).size, list.length, `${n} shards are disjoint`);
  }
  assert.deepEqual(selectMutations(['--shard', '2/4'], list), { chosen: [list[1], list[5], list[9]], filter: '--shard 2/4' });
  assert.deepEqual(selectMutations(['--file', 'core/b.js', '--shard', '1/2'], list).chosen, [list[6], list[8], list[10]], 'a shard keeps full-list positions');
  assert.deepEqual(selectMutations(['--expect', 'title 1', '--shard', '2/2'], list).chosen, [list[1]], '"title 1" and "title 10" split by shard');
  for (const args of [['--shard'], ['--shard', '0/2'], ['--shard', '3/2'], ['--shard', '1/0'], ['--shard', '1'], ['--shard', '1/2x'],
    ['--shard', '1/2', '--shard', '2/2']]) {
    assert.throws(() => selectMutations(args, list), /usage: node tests\/negative\.js/, JSON.stringify(args));
  }
  assert.throws(() => selectMutations(['--shard', '12/12'], list), /no mutation matches --shard 12\/12/);
});

/** Run the runner's main on a fixture project with its own mutations, capturing what it prints. */
async function runMain(t, args, mutations, root) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-main-test-'));
  const saved = ['TEMP', 'TMP', 'TMPDIR'].map((key) => [key, process.env[key]]);
  for (const [key] of saved) process.env[key] = tempRoot;
  const lines = [];
  const log = t.mock.method(console, 'log', (line) => lines.push(String(line)));
  const error = t.mock.method(console, 'error', (line) => lines.push(String(line)));
  try {
    return { code: await main(args, { mutations, root }), output: lines.join('\n'), tempRoot };
  } finally {
    log.mock.restore();
    error.mock.restore();
    for (const [key, value] of saved) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    t.after(() => removeCopy(tempRoot));
  }
}

/** A fixture project whose suite records which runner copies exist beside the one it runs in. */
function mutableProject(t) {
  const root = fixture(t, '');
  const seen = path.join(root, 'seen.jsonl');
  fs.writeFileSync(path.join(root, 'tests', 'value.txt'), 'good');
  fs.writeFileSync(path.join(root, 'tests', 'size.txt'), 'small');
  fs.writeFileSync(path.join(root, 'tests', 'fixture.test.js'), `const fs = require('node:fs'), path = require('node:path');
    const test = require('node:test');
    fs.appendFileSync(${JSON.stringify(seen)}, JSON.stringify({ copy: path.basename(process.cwd()), beside: fs.readdirSync('..') }) + '\\n');
    test('checks the value', () => { if (fs.readFileSync('tests/value.txt', 'utf8') !== 'good') throw Error('bad value'); });
    test('checks the size', () => { if (fs.readFileSync('tests/size.txt', 'utf8') === 'big') process.stdout.write('x'.repeat(2 * 1048576)); });`);
  const observed = () => fs.readFileSync(seen, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  return { root, observed };
}

test('a filtered run judges only its mutations, still checks every patch text and says it was partial', async (t) => {
  const { root, observed } = mutableProject(t);
  const mutations = [
    { why: 'value goes bad', file: 'tests/value.txt', from: 'good', to: 'bad', expect: 'checks the value' },
    { why: 'size grows', file: 'tests/size.txt', from: 'small', to: 'big', expect: 'checks the size' },
    { why: 'a stale patch', file: 'tests/size.txt', from: 'no such text', to: 'x', expect: 'checks the size' },
  ];
  const run = await runMain(t, ['--file', 'tests/value.txt'], mutations, root);
  assert.match(run.output, /^control {2}1 of 3 mutations selected by --file tests\/value\.txt, suite green/m);
  assert.match(run.output, /^ok {14}value goes bad$/m);
  assert.match(run.output, /^MUTATION MISS {3}a stale patch$/m, 'an unselected stale mutation still fails loudly');
  assert.doesNotMatch(run.output, /size grows/, 'an unselected mutation is not judged');
  assert.match(run.output, /^partial run, 1 of 3 mutations by --file tests\/value\.txt: 1 caught {2}0 escaped {2}0 misnamed {2}1 invalid {2}0 infrastructure$/m);
  assert.doesNotMatch(run.output, /^\d+ caught/m, 'a partial run never prints the full summary');
  assert.equal(run.code, 1, 'the stale mutation fails the run');
  assert.deepEqual(observed().map((o) => o.copy), ['control', 'm0'], 'only the control and the chosen mutation ran');
  await assert.rejects(runMain(t, ['--file', 'tests/missing.txt'], mutations, root), /no mutation matches --file tests\/missing\.txt/);
  assert.deepEqual(observed().map((o) => o.copy), ['control', 'm0'], 'a filter that matches nothing runs nothing');
});

test('the runner holds at most one mutated copy at a time and kept evidence survives each removal', async (t) => {
  const { root, observed } = mutableProject(t);
  const mutations = [
    { why: 'value goes bad', file: 'tests/value.txt', from: 'good', to: 'bad', expect: 'checks the value' },
    { why: 'size floods the report', file: 'tests/size.txt', from: 'small', to: 'big', expect: 'checks the size' },
    { why: 'value goes bad again', file: 'tests/value.txt', from: 'good', to: 'worse', expect: 'checks the value' },
  ];
  const run = await runMain(t, [], mutations, root);
  assert.equal(run.code, 1, run.output);
  assert.match(run.output, /^INFRA {11}size floods the report$/m);
  assert.match(run.output, /^2 caught {2}0 escaped {2}0 misnamed {2}0 invalid {2}1 infrastructure$/m, 'verdicts are unchanged');
  const seen = observed();
  assert.deepEqual(seen.map((o) => o.copy), ['control', 'm0', 'm1', 'm1', 'm2'], 'the control, each mutation and one report-only retry ran');
  for (const { copy, beside } of seen.filter((o) => o.copy !== 'control')) {
    assert.deepEqual(beside.filter((name) => /^m\d+$/.test(name)), [copy], `only ${copy} existed while it ran`);
    assert.ok(beside.includes('control'), 'the control stays until the run ends');
  }
  assert.ok(seen.at(-1).beside.includes('infrastructure'), 'the evidence kept for m1 existed while m2 ran');
  const [runRoot] = fs.readdirSync(run.tempRoot).filter((name) => name.startsWith(RUN_PREFIX));
  const evidence = path.join(run.tempRoot, runRoot, 'infrastructure');
  assert.deepEqual(fs.readdirSync(path.join(run.tempRoot, runRoot)), ['infrastructure'], 'every copy is gone and the evidence stays');
  assert.deepEqual(fs.readdirSync(evidence).sort(), ['m1', 'm1-retry']);
  assert.ok(run.output.includes(`kept in ${path.join(evidence, 'm1')}`), 'the report names the kept evidence');
  assert.ok(fs.statSync(path.join(evidence, 'm1', 'stdout.tap')).size > 0);
});

test('every path a mutation run creates stays under the Windows limit with a 120-character TEMP', () => {
  const temp = 'X:\\' + 'a'.repeat(117);
  assert.equal(temp.length, 120);
  // The widest Windows PID, and mkdtemp's six random characters.
  const root = RUN_PREFIX + '4294967295-XXXXXX';
  const copy = 'm' + 9999;
  // The deepest chain: a runner test's fixture inside a mutated copy, holding a
  // whole run of its own whose control copy makes a fixture in its temp.
  const nested = path.win32.join(temp, root, copy, SUITE_TEMP, FIXTURE_PREFIX + 'XXXXXX', 'temp', root, 'control', SUITE_TEMP, FIXTURE_PREFIX + 'XXXXXX');
  assert.ok(nested.length < 260, nested.length + ': ' + nested);
  // And every file of the copied tree, in a copy and in the nested run's control copy.
  const files = [];
  const walk = (relative) => {
    const full = path.join(__dirname, '..', relative);
    if (fs.statSync(full).isDirectory()) for (const name of fs.readdirSync(full)) walk(path.join(relative, name));
    else files.push(relative);
  };
  for (const name of COPIED) walk(name);
  const longest = files.reduce((a, b) => (b.length > a.length ? b : a));
  assert.ok(path.win32.join(temp, root, copy, longest).length < 260, longest);
  const nestedControl = path.win32.join(temp, root, copy, SUITE_TEMP, FIXTURE_PREFIX + 'XXXXXX', 'temp', root, 'control');
  assert.ok(path.win32.join(nestedControl, 'tests', 'fixture.test.js').length < 260);
});
