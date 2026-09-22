'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runSuite, mutationVerdict } = require('./negative.js');

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

function fixture(t, source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-runner-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
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

test('failed control exits 2 after removing only its owned temporary directory', (t) => {
  const dir = fixture(t, `require('node:test')('deliberately failing control', () => {
    require('node:assert/strict').equal(1, 2);
  });`);
  const runner = path.join(dir, 'tests', 'negative.js');
  fs.copyFileSync(path.join(__dirname, 'negative.js'), runner);
  const tempRoot = path.join(dir, 'temp-area');
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
  assert.doesNotMatch(result.stdout, /suite green|\bcaught\b|ESCAPED|MISNAMED/);
  const allocated = JSON.parse(fs.readFileSync(evidence, 'utf8'));
  assert.equal(path.dirname(allocated), tempRoot);
  assert.match(path.basename(allocated), /^artifex-negative-/);
  assert.equal(fs.existsSync(allocated), false, 'the failed control must release its own source copy');
  assert.deepEqual(fs.readdirSync(tempRoot), ['artifex-negative-unrelated']);
  assert.equal(fs.readFileSync(path.join(unrelated, 'keep.txt'), 'utf8'), 'unrelated work');
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
  const missing = await runSuite(path.join(dir, 'missing-directory'), undefined, 3000);
  assert.equal(missing.error.code, 'ENOENT');
  assert.notEqual(missing.status, 0, 'preserve the actual asynchronous launch status');
  assert.equal(missing.timedOut, false);
  const flooded = await runSuite(dir, undefined, 5000);
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
  assert.ok(Date.now() - started < 12000, 'deadline and owned teardown must be bounded');
  assert.throws(() => process.kill(result.pid, 0), { code: 'ESRCH' });
});

test('timed-out control stops its actual process tree and preserves unrelated temporary work', (t) => {
  const dir = fixture(t, '');
  const pidsFile = path.join(dir, 'owned-pids.json');
  fs.writeFileSync(path.join(dir, 'tests', 'fixture.test.js'), `const {spawn}=require('node:child_process');
    const child=spawn(process.execPath,['-e','setInterval(() => {}, 1000)'],{stdio:'ignore',windowsHide:true});
    require('node:fs').writeFileSync(${JSON.stringify(pidsFile)},JSON.stringify([process.ppid,process.pid,child.pid]));
    setInterval(() => {}, 1000);`);
  const runner = path.join(dir, 'tests', 'negative.js');
  fs.copyFileSync(path.join(__dirname, 'negative.js'), runner);
  const tempRoot = path.join(dir, 'temp-area');
  const unrelated = path.join(tempRoot, 'artifex-negative-unrelated');
  fs.mkdirSync(unrelated, { recursive: true });
  fs.writeFileSync(path.join(unrelated, 'keep.txt'), 'unrelated work');
  const observer = path.join(dir, 'observe.cjs');
  const allocatedFile = path.join(dir, 'allocated.json');
  fs.writeFileSync(observer, `const fs=require('node:fs'), allocate=fs.mkdtempSync;
    fs.mkdtempSync=(...args)=>{const owned=allocate(...args);
      fs.writeFileSync(${JSON.stringify(allocatedFile)},JSON.stringify(owned));return owned;};`);
  const env = { ...process.env, TEMP: tempRoot, TMP: tempRoot, TMPDIR: tempRoot, ARTIFEX_NEGATIVE_TIMEOUT_MS: '1500' };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--require', observer, runner], {
    cwd: dir, encoding: 'utf8', env, windowsHide: true, timeout: 20000,
  });
  const ownedPids = fs.existsSync(pidsFile) ? JSON.parse(fs.readFileSync(pidsFile, 'utf8')) : [];
  t.after(() => {
    // Failure-only cleanup is limited to the PIDs created by this fixture.
    for (const pid of ownedPids) {
      try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  });
  assert.equal(result.error, undefined, 'the outer guard must not kill the CLI');
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /CONTROL INFRASTRUCTURE FAILURE/);
  assert.match(result.stderr, /ETIMEDOUT.*1500ms/);
  assert.equal(ownedPids.length, 3, 'the real test worker and its descendant must have started');
  for (const pid of ownedPids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  const allocated = JSON.parse(fs.readFileSync(allocatedFile, 'utf8'));
  assert.equal(path.dirname(allocated), tempRoot);
  assert.equal(fs.existsSync(allocated), false);
  assert.deepEqual(fs.readdirSync(tempRoot), ['artifex-negative-unrelated']);
  assert.equal(fs.readFileSync(path.join(unrelated, 'keep.txt'), 'utf8'), 'unrelated work');
});
