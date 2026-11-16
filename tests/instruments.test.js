// Acoustic voices by name (core/instruments.js): each recipe is a spec the
// sound module accepts, built from the thing's own partials and start.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { recipe, play, INSTRUMENTS } = require('../core/instruments.js');
const { rng } = require('../core/rand.js');
const { fakeAudio } = require('./fake-media.js');

const RATE = 48000;

test('every instrument plays through the sound module, at any velocity, and gives a stereo output', () => {
  assert.deepEqual([...INSTRUMENTS], ['celesta', 'vibraphone', 'marimba', 'strings', 'flute', 'brush', 'cajon', 'cymbal', 'pluck']);
  for (const kind of INSTRUMENTS) {
    for (const velocity of [0.2, 0.8, 1]) {
      const { Context } = fakeAudio(), ctx = new Context(2, RATE * 8, RATE);
      const out = play(ctx, rng(1), `${kind} note`, 0.5, kind, { pitch: 330, length: 1.5, velocity, pan: 0.2 });
      assert.ok(out && typeof out.connect === 'function', `${kind} at velocity ${velocity} returns a node`);
    }
  }
});

test('each recipe carries the partials of what it models, and changes with length and velocity alone as asked', () => {
  const ratios = (kind) => recipe(kind, { pitch: 440 }).partials.map((p) => p[0]);
  assert.deepEqual(ratios('vibraphone'), [1, 4, 10], 'a bar tuned to 1, 4 and 10');
  assert.deepEqual(ratios('marimba'), [1, 4, 9.2]);
  assert.deepEqual(ratios('strings'), [1, 2, 3, 4, 5, 6, 7, 8], 'a string holds whole multiples');
  for (const [n, level] of recipe('strings', { pitch: 220 }).partials) assert.ok(Math.abs(level - 1 / n) < 1e-12, 'each as strong as one over its number');
  assert.ok(recipe('marimba', { pitch: 440 }).decay < recipe('vibraphone', { pitch: 440 }).decay / 3, 'wood dies far sooner than metal');
  // The vibraphone's two partials beat about five times a second at any pitch.
  for (const pitch of [220, 440, 880]) {
    const cents = recipe('vibraphone', { pitch }).detune;
    assert.ok(Math.abs(pitch * (2 ** (cents / 1200) - 1) - 5.2) < 1e-9, `beats at ${pitch} Hz`);
  }
  assert.ok(recipe('strings', { pitch: 220 }).attack > 0.1 && recipe('celesta', { pitch: 880 }).attack < 0.01, 'a bow starts slowly, a hammer at once');
  assert.equal(recipe('strings', { pitch: 220, length: 3 }).hold, 2.5);
  assert.ok(recipe('flute', { pitch: 440 }).tail.level > 0, 'a flute is heard with its breath');
  assert.equal(recipe('cymbal', { length: 2 }).tail.rise, 1.4, 'a cymbal swells before it washes out');
  assert.deepEqual(recipe('pluck', { pitch: 196, length: 2, velocity: 0.5 }), { pitch: 196, decay: 3.2, level: 0.5 });
  const soft = recipe('celesta', { pitch: 880, velocity: 0.3, level: 0.5, pan: -0.4, vary: 0 });
  assert.deepEqual([soft.velocity, soft.level, soft.pan, soft.vary], [0.3, 0.5, -0.4, 0]);
  assert.deepEqual(recipe('cajon'), recipe('cajon'), 'the same call gives the same recipe');
});

test('recipe refuses a name it does not hold and a note it cannot play', () => {
  assert.throws(() => recipe('tuba', { pitch: 100 }), /recipe: kind must be one of celesta, vibraphone, marimba, strings, flute, brush, cajon, cymbal, pluck, got "tuba"/);
  assert.throws(() => recipe('flute'), /recipe: flute needs a pitch in hertz over 0, got undefined/);
  assert.throws(() => recipe('cajon', { length: 0 }), /recipe: length must be seconds over 0, got 0/);
  assert.throws(() => recipe('cajon', { velocity: 2 }), /recipe: velocity must be from 0 to 1, got 2/);
});
