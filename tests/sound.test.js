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

// A voice and a room must hold to the same two-input rule inside, take their
// noise from the seed, and end every layer on a fade rather than a cut.

const { voice, room } = require('../core/sound.js');
const { rng } = require('../core/rand.js');

const RATE = 48000;
const arrivals = (record) => {
  const arrive = new Map();
  for (const node of record.nodes) for (const t of node.to) arrive.set(t, (arrive.get(t) || 0) + 1);
  return arrive;
};
const layered = { pitch: 220, partials: [[1, 1], [2.76, 0.5], [5.4, 0.25]], detune: 7, attack: 0.01, hold: 0.2, decay: 1.2,
  strike: { level: 0.4, length: 0.02, colour: 4000 }, tail: { level: 0.1, length: 1 }, level: 0.5, pan: -0.3 };

test('voice builds a transient, a body of detuned partials and a tail, every input taking at most two', () => {
  const { Context, record } = fakeAudio();
  const ctx = new Context(2, RATE * 4, RATE);
  const out = voice(ctx, rng(1), 'a', 0.5, layered);
  assert.equal(out.kind, 'stereoPanner');
  assert.equal(out.pan.value, -0.3);
  for (const [t, k] of arrivals(record)) assert.ok(k <= 2, `a ${t.kind} takes ${k} inputs`);

  const oscs = record.nodes.filter((n) => n.kind === 'oscillator');
  assert.deepEqual(oscs.map((o) => [o.frequency.value, o.detune.value]),
    [[220, -3.5], [220, 3.5], [220 * 2.76, -3.5], [220 * 2.76, 3.5], [220 * 5.4, -3.5], [220 * 5.4, 3.5]]);
  const noises = record.nodes.filter((n) => n.kind === 'bufferSource');
  assert.equal(noises.length, 2, 'a strike and a tail');
  for (const s of [...oscs, ...noises]) assert.equal(s.at, 0.5, `a ${s.kind} starts at ${s.at}, not with the voice`);

  // Every node reaches the panner along one path.
  for (const n of record.nodes) {
    if (n === out) continue;
    let at = n;
    while (at !== out) { assert.equal(at.to.length, 1, `a ${at.kind} leads nowhere or twice`); at = at.to[0]; }
  }
});

test('voice partials fall to -60 dB, higher ones sooner, then fade out over 80 ms and stop', () => {
  for (const damp of [0, 0.5, 1]) {
    const { Context, record } = fakeAudio();
    const ctx = new Context(2, RATE * 4, RATE);
    voice(ctx, rng(1), 'a', 0.5, { ...layered, detune: 0, damp });
    const envs = record.nodes.filter((n) => n.kind === 'gain' && n.gain.events.length);
    const ends = envs.map((g) => {
      const ev = g.gain.events;
      const [kind, value, time] = ev[ev.length - 1];
      assert.equal(kind, 'linearRampToValueAtTime');
      assert.equal(value, 0, 'a partial ends at silence');
      const [k2, quiet, when] = ev[ev.length - 2];
      assert.equal(k2, 'exponentialRampToValueAtTime');
      assert.ok(quiet <= ev[1][1] * 1e-3 + 1e-9, 'the decay reaches -60 dB before the fade');
      assert.ok(Math.abs(time - when - 0.08) < 1e-9, 'the fade lasts 80 ms');
      return time;
    });
    const stops = record.nodes.filter((n) => n.kind === 'oscillator').map((o) => o.end);
    assert.deepEqual(stops, ends, 'each oscillator stops when its partial has faded');
    if (damp === 0) assert.ok(ends.every((e) => Math.abs(e - ends[0]) < 1e-9), 'damp 0 ends every partial together');
    else assert.ok(ends[0] > ends[1] && ends[1] > ends[2], `damp ${damp}: higher partials must end sooner`);
  }
});

test('voice noise comes from the seed and the name, and fades to nothing', () => {
  const noise = (seed, name) => {
    const { Context, record } = fakeAudio();
    voice(new Context(2, RATE * 4, RATE), rng(seed), name, 0, layered);
    return record.nodes.filter((n) => n.kind === 'bufferSource').map((s) => s.buffer.getChannelData(0));
  };
  const [strike, tail] = noise(1, 'a');
  assert.deepEqual(noise(1, 'a'), [strike, tail], 'one seed and name make one noise');
  assert.notDeepEqual(noise(2, 'a')[0], strike, 'another seed makes another noise');
  assert.notDeepEqual(noise(1, 'b')[0], strike, 'another voice makes another noise');
  assert.equal(strike.length, Math.ceil((0.02 + 0.08) * RATE));
  assert.equal(tail.length, Math.ceil((1 + 0.08) * RATE));
  for (const data of [strike, tail]) {
    const peak = Math.max(...data.map(Math.abs));
    assert.ok(peak > 0.01, 'the layer sounds');
    assert.ok(Math.abs(data[data.length - 1]) < peak * 1e-4, 'the layer fades to nothing, not a cut');
    assert.equal(data[0], 0, 'the layer rises from silence');
  }
});

test('voice leaves out a transient or a tail at level 0, and refuses bad values by name', () => {
  const { Context, record } = fakeAudio();
  const ctx = new Context(2, RATE * 4, RATE);
  voice(ctx, rng(1), 'plain', 0, { pitch: 440 });
  assert.equal(record.nodes.filter((n) => n.kind === 'bufferSource').length, 0);
  assert.equal(record.nodes.filter((n) => n.kind === 'oscillator').length, 1);
  assert.throws(() => voice(ctx, rng(1), 'x', 0, { pitch: 0 }), /voice x: pitch must be/);
  assert.throws(() => voice(ctx, rng(1), 'x', -1, { pitch: 440 }), /voice x: at must be/);
  assert.throws(() => voice(ctx, rng(1), 'x', 0, { pitch: 440, partials: [] }), /voice x: partials/);
  assert.throws(() => voice(ctx, rng(1), 'x', 0, { pitch: 440, pan: 2 }), /voice x: pan/);
  assert.throws(() => voice(ctx, rng(1), 'x', 0, { pitch: 440, tail: { level: 1, colour: 30000 } }), /voice x: tail.colour/);
});

test('room is a seeded convolver that falls to -60 dB and darkens as it falls', () => {
  const impulse = (seed, opts) => {
    const { Context } = fakeAudio();
    const conv = room(new Context(2, RATE * 4, RATE), rng(seed), 'hall', opts);
    assert.equal(conv.kind, 'convolver');
    return conv.buffer;
  };
  const b = impulse(1, { size: 1.5, predelay: 0.02 });
  assert.equal(b.numberOfChannels, 2);
  assert.equal(b.length, Math.round(0.02 * RATE) + Math.ceil(1.5 * RATE));
  const [left, right] = [b.getChannelData(0), b.getChannelData(1)];
  assert.ok(left.subarray(0, Math.round(0.02 * RATE)).every((v) => v === 0), 'nothing before the predelay');
  assert.notDeepEqual(left, right, 'the two sides are independent');
  assert.deepEqual(impulse(1, { size: 1.5, predelay: 0.02 }).getChannelData(0), left, 'one seed makes one room');
  assert.notDeepEqual(impulse(2, { size: 1.5, predelay: 0.02 }).getChannelData(0), left, 'another seed makes another room');

  const tenth = Math.floor(left.length / 10);
  const power = (a, from) => a.subarray(from, from + tenth).reduce((s, v) => s + v * v, 0) / tenth;
  const crossings = (a, from) => { let k = 0; for (let i = from + 1; i < from + tenth; i++) if ((a[i] < 0) !== (a[i - 1] < 0)) k++; return k; };
  const first = Math.round(0.02 * RATE) + Math.round(0.07 * RATE);
  const last = left.length - tenth;
  assert.ok(10 * Math.log10(power(left, last) / power(left, first)) < -40, 'the room falls away');
  assert.ok(crossings(left, last) < crossings(left, first) / 2, 'the room darkens as it falls');

  const { Context } = fakeAudio();
  const ctx = new Context(2, RATE, RATE);
  assert.throws(() => room(ctx, rng(1), 'r', { size: 0 }), /room r: size/);
  assert.throws(() => room(ctx, rng(1), 'r', { bright: 500, dark: 900 }), /room r: dark/);
  assert.throws(() => room(ctx, rng(1), 'r', { early: 1.5 }), /room r: early/);
});

// The film scaffold in the skill is structure only: filled, its cue table puts
// every entry and exit on a whole frame, refuses an element with no exit and a
// sound with no cause on screen, paints each element only while it is on, and
// plays every voice through the room, still two inputs at a time.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadExternal } = require('../tools/piece-input.js');
const { solve } = require('../core/piece.js');
const { drawFrame, renderSound } = require('../core/render.js');

const SCAFFOLD = path.join(__dirname, '..', 'skills', 'artifex', 'film-scaffold.cjs');
const scaffold = (t, fill) => {
  let src = fs.readFileSync(SCAFFOLD, 'utf8');
  for (const [line, value] of Object.entries(fill)) {
    const re = new RegExp(`^const ${line} = .*;$`, 'm');
    assert.match(src, re, `the scaffold lost its ${line} slot`);
    src = src.replace(re, `const ${line} = ${value};`);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifex-scaffold-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'film.cjs'), src);
  return loadExternal('./film.cjs', dir).piece;
};
const surface = (calls) => new Proxy({}, { get: (_o, k) => (k === 'canvas' ? undefined : (...a) => calls.push([k, ...a])) });

test('the film scaffold, empty, draws its ground and builds only its room', async (t) => {
  const piece = scaffold(t, {});
  const solved = solve(piece);
  assert.equal(solved.stages.error, null);
  const calls = [];
  drawFrame(surface(calls), piece, solved, 0.5);
  assert.deepEqual(calls.filter(([k]) => k === 'fillRect'), [['fillRect', 0, 0, 1280, 720]]);
  const { Context, record } = fakeAudio();
  await renderSound(piece, solved, { OfflineAudioContext: Context });
  assert.deepEqual(record.nodes.map((n) => n.kind).sort(), ['convolver', 'gain']);
});

test('the film scaffold puts entries, exits and sounds on whole frames and refuses what has no exit or cause', async (t) => {
  const fill = {
    SHOTS: "[['one', 2], ['two', 2]]",
    ELEMENTS: "[{ name: 'a', enter: 0.5, exit: 1.5 }, { name: 'b', enter: 1, exit: DUR }]",
    SOUNDS: "[{ at: 0.52, cause: 'a', voice: { pitch: 330, strike: { level: 0.3 } } },"
      + " { at: 2, cause: 'two', voice: { pitch: 55, attack: 1, decay: 1, detune: 8 } },"
      + " { at: 2, cause: 'two', voice: { pitch: 82.5, attack: 1, decay: 1 } }]",
    PAINT: '{ a: (g, s, e, life) => g.fillRect(1, life.u, life.since, 0), b: (g, s, e, life) => g.fillRect(2, life.u, life.since, 0) }',
  };
  const piece = scaffold(t, fill);
  const solved = solve(piece);
  assert.equal(solved.stages.error, null);
  const { elements, sounds } = solved.state.cues;
  assert.deepEqual(elements.map((e) => [e.name, e.enter, e.exit]), [['a', 12, 36], ['b', 24, 96]]);
  assert.deepEqual(sounds.map((c) => [c.frame, c.name]), [[12, 'a 12 1'], [48, 'two 48 1'], [48, 'two 48 2']]);

  const painted = (frame) => {
    const calls = [];
    drawFrame(surface(calls), piece, solved, frame / 95);
    return calls.filter(([k, id]) => k === 'fillRect' && id !== 0).map(([, id, u, since]) => [id, u, since]);
  };
  assert.deepEqual(painted(11), []);
  assert.deepEqual(painted(12), [[1, 0, 0]]);
  assert.deepEqual(painted(35), [[1, 1, 23 / 24], [2, 11 / 71, 11 / 24]]);
  assert.deepEqual(painted(36), [[2, 12 / 71, 0.5]], 'a has exited');

  const { Context, record } = fakeAudio();
  await renderSound(piece, solved, { OfflineAudioContext: Context });
  for (const [node, k] of arrivals(record)) assert.ok(k <= 2, `a ${node.kind} takes ${k} inputs`);
  const starts = record.nodes.filter((n) => n.kind === 'oscillator').map((o) => o.at);
  assert.deepEqual(starts, [0.5, 2, 2, 2]);

  for (const [bad, message] of [
    [{ ELEMENTS: "[{ name: 'a', enter: 0.5 }]" }, /element a has no exit/],
    [{ ELEMENTS: "[{ name: 'a', enter: 0.5, exit: 9 }]" }, /element a must enter/],
    [{ SOUNDS: "[{ at: 3, cause: 'a', voice: { pitch: 330 } }]" }, /no cause on screen: a/],
  ]) {
    assert.match(solve(scaffold(t, { ...fill, ...bad })).stages.error.message, message);
  }
});

test('voice velocity softens and darkens a sound, and vary makes each voice its own', () => {
  const build = (name, extra) => {
    const { Context, record } = fakeAudio();
    voice(new Context(2, RATE * 4, RATE), rng(1), name, 0, { ...layered, detune: 0, ...extra });
    const peaks = record.nodes.filter((n) => n.kind === 'gain' && n.gain.events.length).map((g) => g.gain.events[1][1]);
    const [strike] = record.nodes.filter((n) => n.kind === 'bufferSource');
    const band = strike.to[0];
    const oscs = record.nodes.filter((n) => n.kind === 'oscillator');
    return { peaks, strike: Math.max(...strike.buffer.getChannelData(0).map(Math.abs)), colour: band.frequency.value,
      detune: oscs.map((o) => o.detune.value), ends: oscs.map((o) => o.end) };
  };
  const hard = build('a', {});
  const soft = build('a', { velocity: 0.5 });
  soft.peaks.forEach((p, i) => assert.ok(p < hard.peaks[i] * 0.5 + 1e-12, `partial ${i} is not softer`));
  assert.ok(soft.peaks[2] / soft.peaks[0] < hard.peaks[2] / hard.peaks[0], 'a softer start is darker');
  assert.ok(Math.abs(soft.strike / hard.strike - 0.25) < 1e-6, 'the transient falls with velocity squared');
  assert.equal(soft.colour, 4000 * 0.75);

  assert.deepEqual(build('a', { vary: 0.8 }), build('a', { vary: 0.8 }), 'one name varies one way');
  const [x, y] = [build('a', { vary: 0.8 }), build('b', { vary: 0.8 })];
  assert.notDeepEqual(x.detune, y.detune, 'two names vary apart');
  for (const v of [x, y]) {
    assert.ok(v.detune.every((c) => Math.abs(c) <= 0.8 * 12 + 1e-9), 'pitch varies by at most vary x 12 cents');
    v.peaks.forEach((p, i) => { const r = p / hard.peaks[i]; assert.ok(r > 10 ** (-0.25 * 0.8) - 1e-9 && r < 10 ** (0.25 * 0.8) + 1e-9, `partial ${i} varies too far`); });
  }
  const { Context } = fakeAudio();
  assert.throws(() => voice(new Context(2, RATE, RATE), rng(1), 'x', 0, { pitch: 440, velocity: 1.5 }), /voice x: velocity/);
  assert.throws(() => voice(new Context(2, RATE, RATE), rng(1), 'x', 0, { pitch: 440, vary: -0.1 }), /voice x: vary/);
});
