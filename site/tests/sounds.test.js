'use strict';

// The early seams' sound, read from the Web Audio graph each builds on a
// stand-in context: no held tone in any soundtrack or ambience, and each
// ambience a scatter of quiet events at many levels and places, never one
// level, within the loop the stage repeats.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadExternal } = require('../../tools/piece-input.js');
const P = require('../../core/piece.js');
const { fakeAudio } = require('../../tests/fake-media.js');
const { LOOP, RING } = require('../stage.js');

// The intro's sound is in its heard piece, which the site loads apart from the first shot.
const EARLY = ['intro-heard', 'bloom', 'ink', 'crack', 'mirror', 'bend', 'portal', 'trace', 'print', 'cad', 'fold', 'paint', 'kandinsky', 'wall', 'close', 'home'];
// The shots after them: their soundtracks play pitched voices, and scrolled each sounds an ambience as the early ones do.
const LATER = ['unstick', 'cues', 'readout', 'settle', 'contain', 'box'];
// A pitched partial that rings longer than this is heard as a tone, a buzz or a whine.
const LONGEST = 0.5;

// The stage builds a soundtrack's graph on the main thread while the film
// plays, and filling noise buffers is most of that cost: at most this many
// samples per soundtrack (about 25 ms a million in Node).
const SAMPLES = 1.5e6;

/** The oscillators `build(ctx)` starts on a stand-in context `seconds` long: the longest one's seconds; how many audible sources it starts, oscillators or buffer sources holding a sample above zero; and the buffer samples it fills. */
async function graph(build, seconds) {
  const { Context, record } = fakeAudio();
  const ctx = new Context(2, Math.round(seconds * 48000), 48000), make = ctx.createBuffer.bind(ctx);
  let samples = 0;
  ctx.createBuffer = (c, n, rate) => { samples += c * n; return make(c, n, rate); };
  await build(ctx);
  const lengths = record.oscillators.map((o) => (o.end === null ? Infinity : o.end - o.at));
  const heard = (b) => b !== null && Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c)).some((d) => d.some((v) => v !== 0));
  const audible = record.nodes.filter((n) => n.at !== null && (n.kind === 'oscillator' || (n.kind === 'bufferSource' && heard(n.buffer)))).length;
  return { audible, longest: Math.max(0, ...lengths), samples };
}

for (const name of [...EARLY, ...LATER]) {
  const early = EARLY.includes(name);
  test(`sounds: ${name}${early ? ' holds no tone, and scrolled,' : ', scrolled,'} sounds an ambience of quiet events at many levels and places`, async () => {
    const piece = loadExternal(path.join(__dirname, '..', 'pieces', name + '.cjs')).piece;
    const { state } = P.solve(piece, 1);
    if (early) {
      const sound = await graph((ctx) => piece.sound(ctx, state, {}), piece.time.duration);
      assert.ok(sound.audible > 0, `${name}: its soundtrack starts no audible source`);
      assert.ok(sound.longest <= LONGEST, `${name}: a pitch rings ${sound.longest.toFixed(2)} s in its soundtrack`);
      assert.ok(sound.samples <= SAMPLES, `${name}: its soundtrack fills ${sound.samples} buffer samples, a long build while the film plays`);
    }

    assert.equal(typeof piece.sound.ambience, 'function', `${name}: its sound carries no ambience`);
    const air = await graph((ctx) => piece.sound.ambience(ctx, state, { loop: LOOP }), LOOP + RING);
    assert.ok(air.longest <= LONGEST, `${name}: a pitch rings ${air.longest.toFixed(2)} s in its ambience`);
    const events = piece.sound.ambience.events(state, LOOP);
    assert.ok(events.length >= 10, `${name}: ${events.length} events in a ${LOOP} s ambience`);
    assert.ok(events.every(([at]) => at >= 0 && at < LOOP), `${name}: an event outside the loop`);
    const db = events.map(([, s]) => 20 * Math.log10((s.level ?? 1) * (s.velocity ?? 1) * 10 ** (-0.75 * (s.distance ?? 0))));
    assert.ok(Math.max(...db) - Math.min(...db) >= 12, `${name}: its events span only ${(Math.max(...db) - Math.min(...db)).toFixed(1)} dB`);
    const pans = events.map(([, s]) => s.pan ?? 0), far = new Set(events.map(([, s]) => s.distance ?? 0));
    assert.ok(Math.min(...pans) < -0.3 && Math.max(...pans) > 0.3, `${name}: its events are not heard on both sides`);
    assert.ok(far.size >= 3, `${name}: its events stand at ${far.size} distances`);

    // What rings past the ring is lost from the loop: every swell and its room die within it, on any seed.
    const { size } = piece.sound.ambience;
    for (let seed = 1; seed <= 200; seed++) {
      for (const [at, s] of piece.sound.ambience.events({ seed }, LOOP)) {
        if (s.swell) assert.ok(at + s.swell.length + size <= LOOP + RING, `${name}: at seed ${seed} a swell at ${at.toFixed(2)} s rings past the ring`);
      }
    }
  });
}
