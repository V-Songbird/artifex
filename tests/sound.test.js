'use strict';

// Summing voices two at a time. A browser may add three or more inputs in
// another order on every render, and floats added in another order round
// differently; two add up the same either way round. The tree must still add
// exactly what one input would: every voice once, through gains at unity.

const test = require('node:test');
const assert = require('node:assert');

const { sumInto } = require('../core/sound.js');
const { fakeAudio } = require('./fake-media.js');

test('sumInto reaches one input with every voice once, through unity gains that each take at most two', () => {
  for (const n of [0, 1, 2, 3, 4, 5, 7, 8, 9, 46, 143]) {
    const { Context, record } = fakeAudio();
    const ctx = new Context(2, 48000, 48000);
    const voices = Array.from({ length: n }, () => ctx.createOscillator());
    const into = ctx.destination;
    sumInto(ctx, voices, into);

    const tree = record.nodes.slice(n);
    assert.equal(tree.length, Math.max(0, n - 2), `${n} voices: one gain for each voice past the second`);
    assert.ok(tree.every((g) => g.kind === 'gain' && g.gain.value === 1 && g.gain.events.length === 0),
      `${n} voices: the tree scales what it adds`);

    const arrive = new Map();
    for (const node of record.nodes) for (const t of node.to) arrive.set(t, (arrive.get(t) || 0) + 1);
    for (const [t, k] of arrive) assert.ok(k <= 2, `${n} voices: a ${t.kind} takes ${k} inputs`);
    assert.equal(arrive.get(into) || 0, Math.min(n, 2), `${n} voices: the sum takes two inputs, or every voice when fewer`);

    // One path from each voice, as short as a balanced tree makes it.
    const deepest = Math.max(1, Math.ceil(Math.log2(n)));
    voices.forEach((v, i) => {
      let at = v, steps = 0;
      while (at !== into) {
        assert.equal(at.to.length, 1, `${n} voices: voice ${i} does not reach the sum along one path`);
        at = at.to[0];
        steps++;
      }
      assert.ok(steps <= deepest, `${n} voices: voice ${i} is ${steps} steps from the sum, past ${deepest}`);
    });
  }
});
