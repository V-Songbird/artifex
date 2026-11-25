'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { warmEdge, warmState, main } = require('../tools/warm-edge.js');

// A call the warm Edge must not take goes to withEdge with the same arguments.
test('warmEdge leaves to a cold Edge every call that could change the page, or with no warm Edge', async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-warm-test-'));
  try {
    const state = { pid: process.pid, port: 1, profile, version: {} };
    const work = async () => 'work';
    const cases = [[{}, null], ...['force', 'headed', 'phaseDeadline', 'file', 'spawn', 'edge'].map((key) => [{ [key]: 'x' }, state])];
    for (const [options, given] of cases) {
      const calls = [];
      const cold = async (...args) => { calls.push(args); return 'cold'; };
      assert.equal(await warmEdge('<p>', options, work, { cold, state: given }), 'cold', JSON.stringify(options));
      assert.deepEqual(calls, [['<p>', options, work]]);
    }
    // A tab another live process holds is busy: the call goes cold too.
    fs.writeFileSync(path.join(profile, 'artifex-tab.lock'), String(process.pid));
    let cold = 0;
    assert.equal(await warmEdge('<p>', {}, work, { cold: async () => { cold++; return 'cold'; }, state }), 'cold');
    assert.equal(cold, 1);
  } finally { fs.rmSync(profile, { recursive: true, force: true }); }
});

test('warmState is null for a missing file and for an Edge that no longer runs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-warm-test-'));
  try {
    assert.equal(warmState(path.join(dir, 'none.json')), null);
    const file = path.join(dir, 'state.json');
    fs.writeFileSync(file, JSON.stringify({ pid: 2 ** 22 + 7, port: 1, profile: dir }));
    assert.equal(warmState(file), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('npm run edge refuses anything but start, status or stop', async () => {
  await assert.rejects(main([]), /^Error: edge: name a command\nusage: npm run edge -- start \| status \| stop$/);
  await assert.rejects(main(['launch']), /^Error: edge: unknown command launch\n/);
});
