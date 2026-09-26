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
  // Past the early reflections the two sides are independent noise, so they barely correlate.
  let lr = 0, ll = 0, rr = 0;
  for (let i = Math.round(0.09 * RATE); i < left.length; i++) { lr += left[i] * right[i]; ll += left[i] ** 2; rr += right[i] ** 2; }
  assert.ok(Math.abs(lr / Math.sqrt(ll * rr)) < 0.2, 'the two sides are independent');
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

// A note can move while it sounds: its pitch bends and swings, a filter opens
// and closes over it, and distance takes its level and its highs. Each is off
// unless given, so a voice without them builds the graph it always did.

const graph = (record) => record.nodes.map((n) => [n.kind, n.at, n.end,
  Object.entries(n).filter(([, p]) => p && p.kind === 'param').map(([k, p]) => [k, p.value, p.events]),
  n.to.map((t) => (t.kind === 'param' ? `param of ${record.nodes.indexOf(t.owner)}` : record.nodes.indexOf(t)))]);
const built = (spec, name = 'a', at = 0.5) => {
  const { Context, record } = fakeAudio();
  const out = voice(new Context(2, RATE * 4, RATE), rng(1), name, at, spec);
  return { record, out };
};

test('voice without bend, vibrato, sweep or distance builds the graph it did', () => {
  const plain = graph(built(layered).record);
  assert.deepEqual(graph(built({ ...layered, distance: 0 }).record), plain, 'distance 0 adds nothing');
  assert.equal(plain.filter(([kind]) => kind === 'biquadFilter').length, 2, 'only the strike and tail bands');
  assert.equal(plain.filter(([kind]) => kind === 'oscillator').length, 6, 'only the partials');
  const oscs = built(layered).record.nodes.filter((n) => n.kind === 'oscillator');
  assert.ok(oscs.every((o) => o.detune.events.length === 0), 'a still pitch schedules nothing');
});

test('voice bend glides the body through its points and vibrato swings it from its delay', () => {
  const { record, out } = built({ ...layered, bend: [[0.02, -200], [0.3, 0], [1, -30]],
    vibrato: { depth: 20, rate: 6, delay: 0.4, rise: 0.5 } });
  for (const [t, k] of arrivals(record)) assert.ok(k <= 2, `a ${t.kind} takes ${k} inputs`);
  const [lfo, ...oscs] = record.nodes.filter((n) => n.kind === 'oscillator');
  assert.equal(oscs.length, 6);
  for (const o of oscs) {
    const base = o.detune.value + 200;
    assert.deepEqual(o.detune.events, [['setValueAtTime', base - 200, 0.5], ['linearRampToValueAtTime', base - 200, 0.52],
      ['linearRampToValueAtTime', base, 0.8], ['linearRampToValueAtTime', base - 30, 1.5]], 'the pitch glides in cents from the note\'s start');
    assert.ok(Math.abs(Math.abs(base) - 3.5) < 1e-9, 'each copy keeps its detune under the bend');
  }

  assert.equal(lfo.frequency.value, 6);
  assert.equal(lfo.at, 0.9, 'the swing starts at its delay');
  assert.equal(lfo.end, Math.max(...oscs.map((o) => o.end)), 'the swing stops with the last partial');
  const [swing] = lfo.to;
  assert.equal(swing.gain.value, 0);
  assert.deepEqual(swing.gain.events, [['setValueAtTime', 0, 0.9], ['linearRampToValueAtTime', 20, 1.4]], 'the swing grows over its rise');
  assert.deepEqual(swing.to.map((p) => p.owner), oscs, 'one swing moves every partial together');
  assert.equal(out.kind, 'stereoPanner');

  const rates = ['a', 'b'].map((name) => built({ ...layered, vary: 1, vibrato: { depth: 20 } }, name).record.nodes
    .find((n) => n.kind === 'oscillator').frequency.value);
  assert.notEqual(rates[0], rates[1], 'vary gives each voice its own vibrato rate');
  for (const r of rates) assert.ok(r >= 4.5 - 1e-9 && r <= 5.5 + 1e-9, `vibrato rate ${r} varies past 10%`);
});

test('voice sweep and distance filter the whole voice, and distance takes up to 15 dB', () => {
  const peaks = (record) => record.nodes.filter((n) => n.kind === 'gain' && n.gain.events.length > 2).map((g) => g.gain.events[1][1]);
  const near = built(layered).record;
  const { record, out } = built({ ...layered, sweep: [[0, 300], [0.4, 5000], [2, 800]], distance: 1 });
  for (const [t, k] of arrivals(record)) assert.ok(k <= 2, `a ${t.kind} takes ${k} inputs`);
  const lows = record.nodes.filter((n) => n.kind === 'biquadFilter' && n.type === 'lowpass');
  assert.equal(lows.length, 2, 'a sweep and the air');
  const [sweep, air] = lows;
  assert.deepEqual(sweep.frequency.events, [['setValueAtTime', 300, 0.5], ['exponentialRampToValueAtTime', 300, 0.5],
    ['exponentialRampToValueAtTime', 5000, 0.9], ['exponentialRampToValueAtTime', 800, 2.5]]);
  assert.deepEqual(sweep.to, [air], 'the sweep feeds the air');
  assert.deepEqual(air.to, [out], 'the air feeds the panner');
  assert.ok(Math.abs(air.frequency.value - 2000) < 1e-9, 'far air is a 2 kHz low-pass');
  // Everything the voice makes passes through the sweep.
  for (const n of record.nodes) {
    if (lows.includes(n) || n === out) continue;
    let at = n;
    while (at !== sweep) { assert.ok(at !== out, `a ${n.kind} skips the sweep`); at = at.to[0]; }
  }
  peaks(record).forEach((p, i) => assert.ok(Math.abs(p / peaks(near)[i] - 10 ** -0.75) < 1e-9, `far partial ${i} is not 15 dB down`));

  const half = built({ ...layered, distance: 0.5 }).record.nodes.filter((n) => n.type === 'lowpass');
  assert.equal(half.length, 1);
  assert.ok(Math.abs(half[0].frequency.value - 16000 / Math.sqrt(8)) < 1e-6, 'the air darkens with distance');

  const { Context } = fakeAudio();
  const ctx = new Context(2, RATE, RATE);
  for (const [spec, message] of [
    [{ distance: 1.5 }, /voice x: distance/],
    [{ bend: [] }, /voice x: bend must be a list/],
    [{ bend: [[0.5, 0], [0.2, 100]] }, /voice x: bend time/],
    [{ bend: [[0, 'up']] }, /voice x: bend value/],
    [{ sweep: [[0, 30000]] }, /voice x: sweep value/],
    [{ sweep: [[-1, 300]] }, /voice x: sweep time/],
    [{ vibrato: {} }, /voice x: vibrato.depth/],
    [{ vibrato: { depth: 10, rate: 0 } }, /voice x: vibrato.rate/],
    [{ vibrato: { depth: 10, rise: 0 } }, /voice x: vibrato.rise/],
  ]) assert.throws(() => voice(ctx, rng(1), 'x', 0, { pitch: 440, ...spec }), message);
});

test('the film scaffold sends a far sound more to the room unless its wet is given', async (t) => {
  const piece = scaffold(t, {
    SOUNDS: "[{ at: 1, cause: 'first', voice: { pitch: 220 } }, { at: 1, cause: 'first', voice: { pitch: 220, distance: 1 } },"
      + " { at: 1, cause: 'first', voice: { pitch: 220, distance: 0.5 } }, { at: 1, cause: 'first', wet: 0.1, voice: { pitch: 220, distance: 1 } }]",
  });
  const solved = solve(piece);
  assert.equal(solved.stages.error, null);
  const { Context, record } = fakeAudio();
  await renderSound(piece, solved, { OfflineAudioContext: Context });
  const sends = record.nodes.filter((n) => n.kind === 'stereoPanner').map((p) => p.to[0].gain.value);
  assert.deepEqual(sends, [0.25, 1, 0.625, 0.1]);
});

// An ambience is the sound of a place: a wide bed of seeded noise in a band
// whose colour and level wander, rising from silence and falling back to it.

const { ambience } = require('../core/sound.js');

test('ambience is a seeded bed, its own noise each side, at its level and colour, rising from and falling to silence', () => {
  const bed = (seed, name, spec) => {
    const { Context } = fakeAudio();
    const src = ambience(new Context(2, RATE * 8, RATE), rng(seed), name, 1.5, { length: 4, fade: 0.5, ...spec });
    assert.equal(src.kind, 'bufferSource');
    assert.equal(src.at, 1.5, 'the bed starts at its time');
    return [src.buffer.getChannelData(0), src.buffer.getChannelData(1)];
  };
  const [left, right] = bed(1, 'wind', { level: 0.05 });
  assert.equal(left.length, 4 * RATE);
  assert.deepEqual(bed(1, 'wind', { level: 0.05 })[0], left, 'one seed and name make one bed');
  assert.notDeepEqual(bed(2, 'wind', { level: 0.05 })[0], left, 'another seed makes another bed');
  assert.notDeepEqual(bed(1, 'rain', { level: 0.05 })[0], left, 'another name makes another bed');

  const rms = (a, from = 0, to = a.length) => Math.sqrt(a.subarray(from, to).reduce((s, v) => s + v * v, 0) / (to - from));
  let lr = 0;
  for (let i = 0; i < left.length; i++) lr += left[i] * right[i];
  assert.ok(Math.abs(lr / left.length / (rms(left) * rms(right))) < 0.1, 'the two sides are independent');
  const [steady] = bed(1, 'wind', { level: 0.05, drift: 0 });
  const body = rms(steady, RATE, 3 * RATE);
  assert.ok(body > 0.05 * 0.9 && body < 0.05 * 1.25, `a still bed holds its level: ${body}`);
  for (const a of [left, steady]) {
    assert.equal(a[0], 0, 'the bed rises from silence');
    assert.equal(a[a.length - 1], 0, 'the bed falls to silence');
    assert.ok(rms(a, 0, RATE / 100) < rms(a, RATE, 3 * RATE) / 20, 'the bed does not start on a cut');
    assert.ok(rms(a, a.length - RATE / 100) < rms(a, RATE, 3 * RATE) / 20, 'the bed does not stop on a cut');
  }

  // Its power sits in its band: about 3 dB down at the band's edges (each measure
  // of noise is good to a dB or two), and far under it two octaves out.
  const at = (a, hz) => {
    let p = 0;
    for (let s = RATE; s + 4096 < 3 * RATE; s += 4096) {
      let re = 0, im = 0;
      for (let i = 0; i < 4096; i++) {
        const w = (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / 4096)) * a[s + i];
        re += w * Math.cos((2 * Math.PI * hz * i) / RATE);
        im += w * Math.sin((2 * Math.PI * hz * i) / RATE);
      }
      p += re * re + im * im;
    }
    return 10 * Math.log10(p);
  };
  for (const colour of [300, 3000]) {
    const [a] = bed(1, 'wind', { colour, band: 1, drift: 0 });
    const centre = at(a, colour);
    for (const m of [Math.SQRT1_2, Math.SQRT2]) assert.ok(at(a, colour * m) - centre > -6, `a ${colour} Hz bed is not an octave wide`);
    for (const m of [0.25, 4]) assert.ok(at(a, colour * m) - centre < -15, `a ${colour} Hz bed spills ${m} times its colour`);
  }

  // Drift moves its level; a still bed barely moves.
  const spread = (a) => {
    const quarters = [0, 1, 2, 3].map((q) => rms(a, RATE * (0.75 + q * 0.625), RATE * (1.375 + q * 0.625)));
    return 20 * Math.log10(Math.max(...quarters) / Math.min(...quarters));
  };
  assert.ok(spread(steady) < 1, `a still bed wanders ${spread(steady)} dB`);
  assert.ok(spread(bed(1, 'wind', { drift: 1.5, rate: 1 })[0]) > 2, 'a drifting bed wanders');

  const { Context } = fakeAudio();
  const ctx = new Context(2, RATE, RATE);
  for (const [spec, message] of [
    [{}, /ambience x: length/],
    [{ length: 1, fade: 0.6 }, /ambience x: length/],
    [{ length: 1, fade: 0.05 }, /ambience x: fade/],
    [{ length: 2, colour: 30000 }, /ambience x: colour/],
    [{ length: 2, band: 0 }, /ambience x: band/],
    [{ length: 2, drift: 3 }, /ambience x: drift/],
    [{ length: 2, rate: 0 }, /ambience x: rate/],
    [{ length: 2, level: -1 }, /ambience x: level/],
  ]) assert.throws(() => ambience(ctx, rng(1), 'x', 0, spec), message);
  assert.throws(() => ambience(ctx, rng(1), 'x', -1, { length: 2 }), /ambience x: at/);
});

test('the film scaffold plays an ambience row as a bed through the room', async (t) => {
  const piece = scaffold(t, {
    SOUNDS: "[{ at: 0.5, cause: 'first', ambience: { length: 3, fade: 1 } }, { at: 1, cause: 'first', voice: { pitch: 220 } }]",
  });
  const solved = solve(piece);
  assert.equal(solved.stages.error, null);
  const { Context, record } = fakeAudio();
  await renderSound(piece, solved, { OfflineAudioContext: Context });
  for (const [node, k] of arrivals(record)) assert.ok(k <= 2, `a ${node.kind} takes ${k} inputs`);
  const [bed] = record.nodes.filter((n) => n.kind === 'bufferSource');
  assert.equal(bed.at, 0.5);
  assert.equal(bed.buffer.length, 3 * RATE);
  assert.equal(bed.to[0].gain.value, 0.25, 'the bed is sent to the room at SEND');
});

test('ambience grains are seeded events in the band that rise as they close, fall to -60 dB and fade out over 80 ms', () => {
  const texture = (seed, name, grains, spec = {}) => {
    const { Context } = fakeAudio();
    const src = ambience(new Context(2, RATE * 4, RATE), rng(seed), name, 0, { length: 2, fade: 0.2, level: 0, drift: 0, ...spec, grains });
    return [src.buffer.getChannelData(0), src.buffer.getChannelData(1)];
  };
  // One event: at 0.5 per second over 2 seconds.
  const one = { rate: 0.5, length: 0.05, chirp: 1, level: 0.1, spread: 0 };
  const [left, right] = texture(1, 'drip', one, { colour: 1000, band: 0.01 });
  const both = left.map((v, i) => Math.hypot(v, right[i]));
  const start = both.findIndex((v) => v > 0);
  assert.ok(start >= 0, 'the event sounds');
  const peak = Math.max(...both);
  assert.ok(peak <= 0.1 + 1e-9 && peak > 0.08, `the event peaks at its level, not ${peak}`);
  const ringN = Math.ceil(0.05 * RATE);
  const lastN = ringN + Math.ceil(0.08 * RATE);
  assert.ok(both.subarray(start + lastN).every((v) => v === 0), 'the event is over 80 ms after -60 dB');
  assert.ok(both[start + ringN] <= 0.1 * 1e-3 * 1.01, 'the event falls to -60 dB of its level over its length');
  // The last 48 of its 3840 fading samples hold at most 48 / 3840 of -60 dB.
  assert.ok(Math.max(...both.subarray(start + lastN - 48)) <= 0.1 * 1e-3 * (48 / 3840) * 1.01, 'the event fades out rather than stops');
  // Its pitch rises an octave: count its crossings early and late in its ring.
  const crossings = (from, to) => { let k = 0; for (let i = from + 1; i < to; i++) if ((left[i] < 0) !== (left[i - 1] < 0)) k++; return k; };
  const early = crossings(start, start + ringN / 5);
  const late = crossings(start + (4 * ringN) / 5, start + ringN);
  assert.ok(Math.abs(early / (2 * 1000 * 0.01) - 1) < 0.2, `the event starts at its colour: ${early} crossings`);
  assert.ok(Math.abs(late / early - 2 ** 0.9) < 0.25, `the event rises an octave as it closes: ${early} then ${late}`);

  const rain = { rate: 200, length: 0.01, chirp: 0.5, level: 0.05, spread: 20 };
  const [a, b] = texture(1, 'rain', rain);
  assert.deepEqual(texture(1, 'rain', rain)[0], a, 'one seed and name make one texture');
  assert.notDeepEqual(texture(2, 'rain', rain)[0], a, 'another seed makes another texture');
  assert.notDeepEqual(b, a, 'events land across the two sides');
  for (const d of [a, b]) {
    assert.equal(d[0], 0, 'the texture rises from silence');
    assert.equal(d[d.length - 1], 0, 'the texture falls to silence');
  }

  const { Context } = fakeAudio();
  const ctx = new Context(2, RATE, RATE);
  for (const [grains, message] of [
    [{ rate: 0, level: 0.1 }, /ambience x: grains.rate/],
    [{ rate: 10, length: 0, level: 0.1 }, /ambience x: grains.length/],
    [{ rate: 10, length: 1.95, level: 0.1 }, /ambience x: grains.length/],
    [{ rate: 10, chirp: 5, level: 0.1 }, /ambience x: grains.chirp/],
    [{ rate: 10 }, /ambience x: grains.level/],
    [{ rate: 10, level: 0.1, spread: 70 }, /ambience x: grains.spread/],
  ]) assert.throws(() => ambience(ctx, rng(1), 'x', 0, { length: 2, grains }), message);
  // 0.1199999 s plus 80 ms is under 0.2 s, but 5760 plus 3840 samples fill all 9600.
  assert.throws(() => ambience(ctx, rng(1), 'x', 0, { length: 0.2, fade: 0.08, grains: { rate: 10, length: 0.1199999, level: 0.1 } }), /ambience x: grains.length/);
});
