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

const { voice, room, hertz } = require('../core/sound.js');
const { rng } = require('../core/rand.js');

test('hertz turns a MIDI note into its frequency, A4 at 440 unless told otherwise', () => {
  assert.strictEqual(hertz(69), 440);
  assert.strictEqual(hertz(81), 880, 'an octave up doubles');
  assert.strictEqual(hertz(57), 220, 'an octave down halves');
  assert.ok(Math.abs(hertz(60) - 261.6256) < 1e-3, 'middle C');
  assert.strictEqual(hertz(69.5), 440 * 2 ** (1 / 24), 'a fractional note is cents');
  assert.strictEqual(hertz(69, 442), 442, 'another A4');
  assert.throws(() => hertz(NaN), /hertz: note must be a finite MIDI note number, got NaN/);
  assert.throws(() => hertz('60'), /hertz: note must be a finite MIDI note number, got 60/);
  assert.throws(() => hertz(69, 0), /hertz: a4 must be a frequency in hertz above 0, got 0/);
});

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

test('scoreCurves reads the envelopes voice schedules, frame by frame, with no audio rendered', () => {
  const { scoreCurves } = require('../core/sound.js');
  const { bars } = require('../core/time.js');
  const hz = 24, frames = 96, grid = bars({ bpm: 120 });
  const spec = { pitch: 220, partials: [[1, 1], [2, 0.5], [3.1, 0.2]], attack: 0.004, hold: 0.03, decay: 0.6, damp: 1, level: 0.4, vary: 0.5, distance: 0.2 };
  const notes = [0.5, 1.25, 2].map((at, i) => ({ part: 'a', name: `n${i}`, at, spec: { ...spec, velocity: 0.6 + i * 0.2 } }));
  const curves = scoreCurves(rng(9), notes, { hz, frames, grid });

  // The envelope Web Audio plays from one partial's scheduled events.
  const gainAt = ([, [, peak, up], [, , top], [, quiet, gone], [, , end]], at, t) => (t <= at ? 0
    : t < up ? peak * (t - at) / (up - at) : t <= top ? peak
      : t < gone ? peak * (quiet / peak) ** ((t - top) / (gone - top))
        : t < end ? quiet * (end - t) / (end - gone) : 0);
  const { Context, record } = fakeAudio();
  const ctx = new Context(2, RATE * 4, RATE);
  const R = rng(9);
  const scheduled = notes.flatMap((n) => {
    const before = record.nodes.length;
    voice(ctx, R, n.name, n.at, n.spec);
    return record.nodes.slice(before).filter((g) => g.kind === 'gain' && g.gain.events.length === 5).map((g) => ({ at: n.at, ev: g.gain.events }));
  });
  assert.equal(scheduled.length, 9, 'three partials for each of three notes');
  for (let f = 0; f < frames; f++) {
    // A frame's loudest moment, found the slow way across the frame.
    let most = 0;
    for (let k = 0; k <= 400; k++) {
      const t = (f + k / 400) / hz;
      most = Math.max(most, Math.sqrt(scheduled.reduce((sum, p) => sum + gainAt(p.ev, p.at, t) ** 2, 0)));
    }
    assert.ok(Math.abs(curves.energy.a[f] - most) <= 0.02 * Math.max(most, 0.01), `frame ${f}: curve ${curves.energy.a[f]}, scheduled ${most}`);
  }

  assert.deepEqual(curves.onsets.map((o) => o.frame), [12, 30, 48]);
  for (const o of curves.onsets) assert.ok(curves.energy.a[o.frame] > curves.energy.a[o.frame - 1], `the curve rises on frame ${o.frame}`);
  assert.equal(curves.beats.length, 8);
  assert.deepEqual(curves.beats[5], { bar: 1, beat: 1, seconds: 2.5, frame: 60 });
  assert.deepEqual(scoreCurves(rng(9), notes, { hz, frames }).beats, [], 'no grid, no beats');
  assert.throws(() => scoreCurves(rng(9), [{ part: 'a', name: 'x', at: -1, spec }], { hz, frames }), /scoreCurves note 0: at must be/);
  assert.throws(() => scoreCurves(rng(9), [{ name: 'x', at: 0, spec }], { hz, frames }), /scoreCurves note 0: part must be a name/);
  assert.throws(() => scoreCurves(rng(9), notes, { hz: 0, frames }), /scoreCurves: hz must be/);
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

test('a strike alone over a silent body needs no pitch, and a sounding body still does', () => {
  const { Context, record } = fakeAudio();
  const ctx = new Context(2, RATE * 4, RATE);
  voice(ctx, rng(1), 'tap', 0, { partials: [[1, 0]], strike: { level: 1, colour: 2000 }, vibrato: { depth: 20 } });
  assert.equal(record.nodes.filter((n) => n.kind === 'bufferSource').length, 1);
  assert.equal(record.nodes.filter((n) => n.kind === 'oscillator').length, 0);
  assert.throws(() => voice(ctx, rng(1), 'x', 0, { partials: [[1, 0], [2, 0.5]], strike: { level: 1 } }),
    /^RangeError: voice x: pitch must be a frequency in hertz above 0, got undefined$/);
  assert.throws(() => voice(ctx, rng(1), 'x', 0, { strike: { level: 1 } }), /voice x: pitch must be/);
  assert.throws(() => voice(ctx, rng(1), 'x', 0, { partials: [[1, 0]], pitch: -1 }),
    /^RangeError: voice x: pitch must be a frequency in hertz above 0, got -1$/);
  assert.throws(() => voice(ctx, rng(1), 'x', 0, { partials: [[1, 0]], tail: { level: 1 } }), /voice x: tail.colour must be .*, got undefined/);
});

test('voice refuses a partial that is not a [ratio, level] pair, naming the partial and the value', () => {
  const { Context } = fakeAudio();
  const ctx = new Context(2, RATE * 4, RATE);
  assert.throws(() => voice(ctx, rng(1), 'x', 0, { pitch: 440, partials: [[1, 1], 0.5] }),
    /^RangeError: voice x: partial 1 must be a \[ratio, level\] pair, got 0\.5$/);
  assert.throws(() => voice(ctx, rng(1), 'x', 0, { pitch: 440, partials: [[1, 1], [2, 'loud']] }), /^RangeError: voice x: partial 1 level must be .*, got loud$/);
  assert.throws(() => voice(ctx, rng(1), 'x', 0, { partials: [[0, 0]] }), /^RangeError: voice x: partial 0 ratio must be above 0, got 0$/);
});

test('a partial at level 0 builds no oscillator, envelope or automation, even with a pitch', () => {
  const graph = (spec) => {
    const { Context, record } = fakeAudio();
    voice(new Context(2, RATE * 4, RATE), rng(1), 'v', 0, spec);
    return record.nodes.map((n) => n.kind);
  };
  const strike = { level: 1, colour: 2000 };
  assert.deepEqual(graph({ pitch: 440, partials: [[1, 0.5], [2, 0], [3, 0.2]], detune: 5, vibrato: { depth: 10 } }),
    graph({ pitch: 440, partials: [[1, 0.5], [3, 0.2]], detune: 5, vibrato: { depth: 10 } }));
  assert.deepEqual(graph({ pitch: 440, partials: [[1, 0]], strike, vibrato: { depth: 10 } }), graph({ partials: [[1, 0]], strike }));
});

test('a voice at level 0 or velocity 0 builds no oscillator, envelope or vibrato', () => {
  const graph = (spec) => {
    const { Context, record } = fakeAudio();
    voice(new Context(2, RATE * 4, RATE), rng(1), 'v', 0, spec);
    return record.nodes.map((n) => n.kind);
  };
  const sounding = { pitch: 440, partials: [[1, 0.5], [3, 0.2]], detune: 5, vibrato: { depth: 10 }, strike: { level: 1, colour: 2000 } };
  const silent = graph({ partials: [[1, 0]] });
  assert.deepEqual(graph({ ...sounding, level: 0 }), silent);
  assert.deepEqual(graph({ ...sounding, velocity: 0 }), silent);
});

test('a silent voice needs no pitch, and a sounding one still refuses without it', () => {
  const graph = (spec) => {
    const { Context, record } = fakeAudio();
    voice(new Context(2, RATE * 4, RATE), rng(1), 'v', 0, spec);
    return record.nodes.map((n) => n.kind);
  };
  const silent = graph({ partials: [[1, 0]] });
  assert.deepEqual(graph({ level: 0, partials: [[1, 0.5]] }), silent);
  assert.deepEqual(graph({ velocity: 0, partials: [[1, 0.5]], vibrato: { depth: 10 }, tail: { level: 1 } }), silent);
  assert.throws(() => graph({ level: 0.5, partials: [[1, 0.5]] }),
    /^RangeError: voice v: pitch must be a frequency in hertz above 0, got undefined$/);
  assert.throws(() => graph({ level: 0, pitch: -1 }), /^RangeError: voice v: pitch must be a frequency in hertz above 0, got -1$/);
  assert.throws(() => graph({ velocity: 0, pitch: -1, partials: [[1, 0.5]] }), /^RangeError: voice v: pitch must be a frequency in hertz above 0, got -1$/);
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

test('the film scaffold, empty, draws its ground and builds only its room and its closing fade', async (t) => {
  const piece = scaffold(t, {});
  const solved = solve(piece);
  assert.equal(solved.stages.error, null);
  const calls = [];
  drawFrame(surface(calls), piece, solved, 0.5);
  assert.deepEqual(calls.filter(([k]) => k === 'fillRect'), [['fillRect', 0, 0, 1280, 720]]);
  const { Context, record } = fakeAudio();
  await renderSound(piece, solved, { OfflineAudioContext: Context });
  assert.deepEqual(record.nodes.map((n) => n.kind).sort(), ['convolver', 'gain', 'gain']);
});

test("the film scaffold refuses an ambience past the film's end and fades the film's last 80 ms", async (t) => {
  // The voice at 3.5 s still rings at the end; the fade takes it out.
  const fill = { SOUNDS: "[{ at: 1, cause: 'first', ambience: { length: 3 } }, { at: 3.5, cause: 'first', voice: { pitch: 220, decay: 2 } }]" };
  const piece = scaffold(t, fill);
  const solved = solve(piece);
  assert.equal(solved.stages.error, null, "an ambience may end on the film's last instant");
  const { Context, record } = fakeAudio();
  await renderSound(piece, solved, { OfflineAudioContext: Context });
  const out = record.nodes.find((n) => n.kind === 'gain' && n.to.some((x) => x.kind === 'destination'));
  assert.ok(out, 'one gain feeds the output');
  assert.deepEqual(out.gain.events, [['setValueAtTime', 1, 4 - 0.08], ['linearRampToValueAtTime', 0, 4]], 'the film ends on an 80 ms fade');
  assert.deepEqual(new Set(record.nodes.filter((n) => n.to.includes(out)).map((n) => n.kind)), new Set(['gain', 'convolver']), 'the dry mix and the room pass through it');
  assert.match(solve(scaffold(t, { SOUNDS: "[{ at: 1.5, cause: 'first', ambience: { length: 3 } }]" })).stages.error.message,
    /the ambience at 1.5 s lasts past the film's end at 4 s/);

  // A looping film plays on past its end, so its seam keeps its level.
  const looping = scaffold(t, fill);
  looping.time = { ...looping.time, loop: true };
  const loopSolved = solve(looping);
  assert.equal(loopSolved.stages.error, null);
  const loopAudio = fakeAudio();
  await renderSound(looping, loopSolved, { OfflineAudioContext: loopAudio.Context });
  const loopOut = loopAudio.record.nodes.find((n) => n.kind === 'gain' && n.to.some((x) => x.kind === 'destination'));
  assert.deepEqual(loopOut.gain.events, [], 'a looping film does not fade at its seam');
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
    [{ ELEMENTS: "[{ enter: 0, exit: DUR }]", SOUNDS: "[{ at: 1, voice: { pitch: 330 } }]" }, /^element 0 has no name, got undefined: /],
    [{ ELEMENTS: "[{ name: '', enter: 0, exit: DUR }]", SOUNDS: "[{ at: 1, voice: { pitch: 330 } }]" }, /^element 0 has no name, got "": /],
    [{ ELEMENTS: "[{ name: 'a', enter: 0.5, exit: 9 }]" }, /element a must enter/],
    [{ SOUNDS: "[{ at: 3, cause: 'a', voice: { pitch: 330 } }]" }, /no cause on screen: a/],
  ]) {
    assert.match(solve(scaffold(t, { ...fill, ...bad })).stages.error.message, message);
  }
});

test("the film scaffold ramps a sound row's whole level along its gain keys, and leaves a row without keys as it was", async (t) => {
  const keyed = "{ at: 0, cause: 'first', voice: { pitch: 55, attack: 1, hold: 2, decay: 1 }, gain: [[0.5, 0.2], [2, 1], [3, 0.4]] }";
  const plain = "{ at: 1, cause: 'first', voice: { pitch: 220 } }";
  const piece = scaffold(t, { SOUNDS: `[${keyed}, ${plain}]` });
  const solved = solve(piece);
  assert.equal(solved.stages.error, null);
  assert.deepEqual(solved.state.cues.sounds.map((c) => c.gain), [[[12, 0.2], [48, 1], [72, 0.4]], undefined]);

  const { Context, record } = fakeAudio();
  await renderSound(piece, solved, { OfflineAudioContext: Context });
  for (const [node, k] of arrivals(record)) assert.ok(k <= 2, `a ${node.kind} takes ${k} inputs`);
  const [first, second] = record.nodes.filter((n) => n.kind === 'stereoPanner');
  assert.equal(first.to.length, 1, 'the keyed voice reaches the mix through its gain alone');
  const level = first.to[0];
  assert.equal(level.kind, 'gain');
  assert.equal(level.gain.value, 0.2, 'the row holds its first key before it');
  assert.deepEqual(level.gain.events, [['setValueAtTime', 0.2, 0.5], ['linearRampToValueAtTime', 1, 2], ['linearRampToValueAtTime', 0.4, 3]]);
  const send = level.to.find((n) => n.channelCount === 1);
  assert.ok(send, 'the keyed gain feeds the room send');
  assert.equal(level.to.length, 2, 'the keyed gain feeds the dry sum and the send');
  assert.ok(second.to.some((n) => n.channelCount === 1) && !second.to.some((n) => n.gain?.events.length), 'the voice without keys feeds its send straight');

  const tempo = solve(scaffold(t, { SOUNDS: `[${keyed}]`, TEMPO: '{ first: 0.5 }' }));
  assert.deepEqual(tempo.state.cues.sounds[0].gain.map(([f]) => f), [6, 24, 36], 'THE TEMPO retimes the keys');
  assert.equal(solve(scaffold(t, { SOUNDS: "[{ at: 1, cause: 'first', voice: { pitch: 220 }, gain: null }]" })).state.cues.sounds[0].gain, undefined);

  const row = (gain) => `[{ at: 1, cause: 'first', voice: { pitch: 220 }, gain: ${gain} }]`;
  for (const [gain, message] of [
    ['0.5', /^sound 0 has a gain that is not a list of \[seconds, gain\] keys, got 0\.5: /],
    ['[]', /^sound 0 has a gain that is not a list of \[seconds, gain\] keys, got \[\]: /],
    ['[[1, -1]]', /^sound 0 has gain key 0 that is not a \[seconds, gain\] pair .*, got \[1,-1\]: /],
    ['[[-1, 1]]', /^sound 0 has gain key 0 that is not a \[seconds, gain\] pair /],
    ['[[1, 1], , [2, 1]]', /^sound 0 has gain key 1 that is not a \[seconds, gain\] pair .*, got undefined: /],
    ['[[2, 1], [1, 1]]', /^sound 0 has gain keys 0 and 1 at 2 s and 1 s, which are out of order: list the keys in time order, a frame or more apart$/],
    ['[[1, 1], [1.01, 1]]', /^sound 0 has gain keys 0 and 1 at 1 s and 1\.01 s, which land on one frame: move them a frame or more apart$/],
  ]) assert.match(solve(scaffold(t, { SOUNDS: row(gain) })).stages.error?.message ?? 'no refusal', message, `gain: ${gain}`);
});

test('the film scaffold plays a pluck row on its frame, dry and through the room at SEND or its wet, and refuses a pluck it cannot play', async (t) => {
  const piece = scaffold(t, { SOUNDS: "[{ at: 1, cause: 'first', pluck: { pitch: 196, decay: 2, level: 0.3 } }, { at: 2, cause: 'first', pluck: { pitch: 98 }, wet: 0.6, gain: [[2, 1], [3, 0.5]] }]" });
  const solved = solve(piece);
  assert.equal(solved.stages.error, null);
  const { Context, record } = fakeAudio();
  await renderSound(piece, solved, { OfflineAudioContext: Context });
  for (const [node, k] of arrivals(record)) assert.ok(k <= 2, `a ${node.kind} takes ${k} inputs`);
  const [near, keyed] = record.nodes.filter((n) => n.kind === 'bufferSource');
  assert.deepEqual([near.at, keyed.at], [1, 2], 'each pluck starts on its frame');
  assert.deepEqual([near.buffer.numberOfChannels, near.buffer.length], [1, Math.ceil(2.08 * RATE)], 'the first rings its decay and the 80 ms fade');
  const sendOf = (n) => n.to.find((x) => x.kind === 'gain' && x.to.some((y) => y.kind === 'convolver' || y.to?.some((z) => z.kind === 'convolver')));
  assert.equal(near.to.length, 2, 'a pluck without keys feeds the dry sum and its send straight');
  assert.equal(sendOf(near).gain.value, 0.25, 'a pluck takes SEND of the room');
  const level = keyed.to[0];
  assert.deepEqual(level.gain.events, [['setValueAtTime', 1, 2], ['linearRampToValueAtTime', 0.5, 3]], 'its gain keys ramp it');
  assert.equal(sendOf(level).gain.value, 0.6, 'a pluck takes its wet when given');

  for (const [sounds, message] of [
    ["[{ at: 1, cause: 'first', pluck: 196 }]", /^sound 0 has a pluck that is not an object, got 196: give its keys, such as \{ pitch: 196 \}$/],
    ["[{ at: 1, cause: 'first', pluck: { pitch: 196 }, voice: { pitch: 220 } }]", /^the sound at 1 s \(first\) has both a pluck and a voice: keep one, or split them into two rows$/],
    ["[{ at: 1, cause: 'first', pluck: { pitch: 196 }, ambience: { length: 1 } }]", /^the sound at 1 s \(first\) has both a pluck and an ambience: keep one, or split them into two rows$/],
    ["[{ at: 1, cause: 'gate', offscreen: { side: 'left', distance: 0.5 }, pluck: { pitch: 196 } }]", /^the sound at 1 s must be a voice with an off-screen side/],
  ]) assert.match(solve(scaffold(t, { SOUNDS: sounds })).stages.error?.message ?? 'no refusal', message, sounds);
});

test('the film scaffold refuses a row name that is not a non-blank string or is repeated, and a null row or hole, by index', async (t) => {
  const sounds = "[{ at: 1, voice: { pitch: 330 } }]";
  const row = "{ name: 'b', enter: 0, exit: DUR }";
  for (const [title, elements, message] of [
    ['a name that is an object', "[{ name: {}, enter: 0, exit: DUR }]", /^element 0 has no name, got /],
    ['a name that is true', "[{ name: true, enter: 0, exit: DUR }]", /^element 0 has no name, got true: /],
    ['a blank name', "[{ name: '  ', enter: 0, exit: DUR }]", /^element 0 has no name, got "  ": /],
    ['a repeated name', `[{ name: 'a', enter: 0, exit: DUR }, ${row}, { name: 'a', enter: 0, exit: DUR }]`, /^element 2 repeats the name "a" of element 0: /],
    ['a repeated name whose shots meet', "[{ name: 'a', enter: 0, exit: DUR, shots: ['first'] }, { name: 'a', enter: 0, exit: DUR, shots: ['first'] }]", /^element 1 repeats the name "a" of element 0: /],
    ['a null row', `[${row}, null]`, /^element 1 is not an object, got null: /],
    ['a list row', `[${row}, ['door', 0, DUR]]`, /^element 1 is not an object, got \["door",0,[^\]]*\]: /],
    ['a hole', `[${row}, ,${row.replace("'b'", "'c'")}]`, /^element 1 is not an object, got undefined: /],
  ]) {
    await t.test(title, () => {
      assert.match(solve(scaffold(t, { ELEMENTS: elements, SOUNDS: sounds })).stages.error.message, message);
    });
  }
});

test('the film scaffold lets two rows of one name pass when no frame shows both, and each lookup finds the one on screen', (t) => {
  // A layer change: a ends its row in front of b on frame 48 and enters a
  // second row of its name behind b on that same frame.
  const piece = scaffold(t, {
    ELEMENTS: "[{ name: 'a', enter: 2, exit: DUR, depth: 2 }, { name: 'b', enter: 0, exit: DUR }, { name: 'a', enter: 0, exit: 2, depth: 0 }]",
    PAINT: "{ a: (g, s, e) => g.fillRect('a', e.depth, 0, 0), b: (g) => g.fillRect('b', 0, 0, 0) }",
    CAMERA: '[{ at: 0, x: 900, y: 360 }]',
    SOUNDS: "[{ at: 1, cause: 'a', voice: { pitch: 330 } }, { at: 3, cause: 'a', voice: { pitch: 330 } }]",
    CONTACTS: "[{ at: 1, cause: 'a', x: 640, y: 360 }, { at: 3, cause: 'a', x: 640, y: 360 }]",
    BEATS: "[{ at: 1, intensity: 0.2, element: 'a', changes: 'shown', knows: 'same' }, { at: 3, intensity: 0.5, element: 'a', changes: 'passes behind', knows: 'same' }]",
  });
  const solved = solve(piece);
  assert.equal(solved.stages.error, null);
  assert.deepEqual(solved.state.cues.contacts.map((c) => c.x), [640, 640 - 2 * 260], 'each contact moves at the depth of the row on screen then');
  const painted = (frame) => {
    const calls = [];
    drawFrame(surface(calls), piece, solved, frame / 95);
    return calls.filter(([k, id]) => k === 'fillRect' && id !== 0).map(([, id, depth]) => (id === 'a' ? [id, depth] : [id]));
  };
  assert.deepEqual(painted(24), [['b'], ['a', 0]], 'a is painted in front of b');
  for (const frame of [48, 72]) assert.deepEqual(painted(frame), [['a', 2], ['b']], `a is painted once, behind b, on frame ${frame}`);

  // Spans that meet while no shot shows both rows.
  assert.equal(solve(scaffold(t, { SHOTS: "[['one', 2], ['two', 2]]", ELEMENTS: "[{ name: 'a', enter: 0, exit: DUR, shots: ['one'] }, { name: 'a', enter: 2, exit: DUR }]" })).stages.error, null);
  // Frames 0-49 and 48-96 share frame 48.
  assert.match(solve(scaffold(t, { ELEMENTS: "[{ name: 'a', enter: 0, exit: 2.05 }, { name: 'a', enter: 2, exit: DUR }]" })).stages.error.message,
    /^element 1 repeats the name "a" of element 0: /);
});

test('the film scaffold sizes a standing element from its foot contact below the horizon, and refuses feet on or above it', (t) => {
  const fill = { HORIZON: '300', ELEMENTS: "[{ name: 'near', enter: 0, exit: DUR, foot: 600 }, { name: 'far', enter: 0, exit: DUR, foot: 400, tall: 0.5 }, { name: 'sky', enter: 0, exit: DUR }]" };
  const solved = solve(scaffold(t, fill));
  assert.equal(solved.stages.error, null);
  assert.deepEqual(solved.state.cues.elements.map((e) => [e.name, e.height]), [['near', 300], ['far', 50], ['sky', undefined]]);
  for (const [bad, message] of [
    [{ ELEMENTS: "[{ name: 'a', enter: 0, exit: DUR, foot: 300 }]" }, /element a stands with its feet at 300, on or above the horizon at 300, so it floats/],
    [{ ELEMENTS: "[{ name: 'a', enter: 0, exit: DUR, foot: 200 }]" }, /element a stands with its feet at 200, on or above the horizon/],
    [{ HORIZON: 'null' }, /element near stands at a foot, but HORIZON is not set/],
    [{ ELEMENTS: "[{ name: 'a', enter: 0, exit: DUR, foot: 'low' }]" }, /element a has a foot that is not a finite design y, got "low"/],
    [{ ELEMENTS: "[{ name: 'a', enter: 0, exit: DUR, tall: 2 }]" }, /element a has a foot that is not a finite design y, got undefined/],
    [{ ELEMENTS: "[{ name: 'a', enter: 0, exit: DUR, foot: 600, tall: 0 }]" }, /element a has a tall that is not a positive finite number, got 0/],
  ]) assert.match(solve(scaffold(t, { ...fill, ...bad })).stages.error.message, message);
});

test('the film scaffold refuses a HORIZON that is set but not a finite number whatever the rows', (t) => {
  for (const [horizon, shownAs] of [["'300'", '"300"'], ['NaN', 'NaN'], ['Infinity', 'Infinity'], ['true', 'true']]) {
    for (const elements of ['[]', "[{ name: 'sky', enter: 0, exit: DUR }]", "[{ name: 'near', enter: 0, exit: DUR, foot: 600 }]"]) {
      const error = solve(scaffold(t, { HORIZON: horizon, ELEMENTS: elements })).stages.error;
      assert.equal(error?.message, `HORIZON is not a finite design y, got ${shownAs}: give the horizon's design y as a number, such as 300, or null to leave it out`, `HORIZON = ${horizon} with ELEMENTS = ${elements}`);
    }
  }
  assert.equal(solve(scaffold(t, { HORIZON: '300', ELEMENTS: "[{ name: 'sky', enter: 0, exit: DUR }]" })).stages.error, null);
});

// The scaffold's camera track and element depth, read from the transforms a
// stand-in surface records: for every fillRect, the zoom and the design point
// that lands at the frame's centre (640, 360).
const framed = (piece, solved, frame) => {
  const calls = [];
  drawFrame(surface(calls), piece, solved, frame / 95);
  const stack = [];
  let m = { z: 1, ox: 0, oy: 0 };
  const out = [];
  for (const [k, ...a] of calls) {
    if (k === 'save') stack.push(m);
    else if (k === 'restore') m = stack.pop();
    else if (k === 'translate') m = { ...m, ox: m.ox + m.z * a[0], oy: m.oy + m.z * a[1] };
    else if (k === 'scale') { assert.equal(a[0], a[1], 'the view scales both axes alike'); m = { ...m, z: m.z * a[0] }; }
    else if (k === 'fillRect') out.push([a[0], m.z, (640 - m.ox) / m.z, (360 - m.oy) / m.z]);
  }
  return out;
};
const near = (actual, expected, what) => {
  assert.equal(actual.length, expected.length, what);
  actual.forEach((row, i) => row.forEach((v, j) => assert.ok(
    typeof v === 'string' ? v === expected[i][j] : Math.abs(v - expected[i][j]) < 1e-9, `${what}: got ${JSON.stringify(actual)}`)));
};

test('the film scaffold moves its camera rest to rest between keys, cuts on two keys at one second, and offsets each element by its depth', (t) => {
  const piece = scaffold(t, {
    ELEMENTS: "[{ name: 'sky', enter: 0, exit: DUR, depth: 0 }, { name: 'mid', enter: 0, exit: DUR }, { name: 'near', enter: 0, exit: DUR, depth: 2 }]",
    CAMERA: '[{ at: 1, x: 640, y: 360, zoom: 1 }, { at: 2, x: 840, y: 260, zoom: 4 },'
      + ' { at: 3, x: 1000, y: 300, zoom: 2 }, { at: 3, x: 100, y: 100, zoom: 0.5 }]',
    PAINT: "{ sky: (g) => g.fillRect('sky'), mid: (g) => g.fillRect('mid'), near: (g) => g.fillRect('near') }",
  });
  const solved = solve(piece);
  assert.equal(solved.stages.error, null);
  assert.deepEqual(solved.state.cues.camera.map((k) => k.frame), [24, 48, 72, 72]);
  // The ground is drawn untransformed; each element at the view's zoom, its
  // centre moved from the design box's by the view's travel times its depth.
  const at = (x, y, zoom) => [[0, 1, 640, 360],
    ...[['sky', 0], ['mid', 1], ['near', 2]].map(([name, d]) => [name, zoom, 640 + (x - 640) * d, 360 + (y - 360) * d])];
  near(framed(piece, solved, 0), at(640, 360, 1), 'before the first key the view holds on it');
  near(framed(piece, solved, 24), at(640, 360, 1), 'the first key');
  // Midway the zoom is the geometric mean; a key that pans and zooms moves x and y by the share of
  // the change in 1 / zoom, (1 - 1 / 2) / (1 - 1 / 4) = 2 / 3 of the way.
  near(framed(piece, solved, 36), at(640 + 200 * 2 / 3, 360 - 100 * 2 / 3, 2), 'midway the zoom is the geometric mean and the place 2 / 3 there');
  near(framed(piece, solved, 48), at(840, 260, 4), 'the second key, at rest');
  const landing = framed(piece, solved, 71).find(([name]) => name === 'mid');
  assert.ok(Math.abs(landing[2] - 1000) < 5 && Math.abs(landing[1] - 2) < 0.05, `the frame before the cut nears the first key at 3 s: ${landing}`);
  near(framed(piece, solved, 72), at(100, 100, 0.5), 'the cut lands on the second key at 3 s');
  near(framed(piece, solved, 95), at(100, 100, 0.5), 'after the last key the view holds on it');
});

test('the film scaffold keeps the target of a key that pans and zooms deep in frame, and moves a key that only pans or only zooms evenly', (t) => {
  const { ease, span } = require('../core/time.js');
  const views = (camera) => {
    const solved = solve(scaffold(t, { CAMERA: camera }));
    assert.equal(solved.stages.error, null, camera);
    return solved.state.cues.views;
  };
  // From the design box at scale 1 onto a target at (1100, 150) at scale 200, by zoom or by dolly
  // (the subject's plane scales by zoom * dolly): the target starts on screen, so each frame
  // between shows it, on its straight path to the centre.
  for (const deep of ['zoom', 'dolly']) {
    const target = views(`[{ at: 1, x: 640, y: 360 }, { at: 3, x: 1100, y: 150, ${deep}: 200 }]`).slice(24, 73)
      .map((v) => [640 + v.zoom * v.dolly * (1100 - v.x), 360 + v.zoom * v.dolly * (150 - v.y)]);
    assert.equal(target.filter(([x, y]) => x >= 0 && x <= 1280 && y >= 0 && y <= 720).length, 49, `by ${deep}, the target in frame on each of the 49 frames: ${target.find(([x, y]) => !(x >= 0 && x <= 1280 && y >= 0 && y <= 720))}`);
    assert.equal(target.filter(([x, y], i) => i > 0 && (Math.abs(x - 640) > Math.abs(target[i - 1][0] - 640) + 1e-9
      || Math.abs((y - 360) * 460 + (x - 640) * 210) > 1e-6)).length, 0, `by ${deep}, the target moves on one line, never away from the centre`);
    near([target[0], target[48]], [[1100, 150], [640, 360]], `by ${deep}, it starts where the first key shows it and lands at the centre`);
  }
  // A key that only pans, only zooms or only dollies moves evenly, as before; so does a pan through
  // a dolly-zoom, whose zoom * dolly holds only up to rounding (0.7 * 3 is not 2.1 * 1 in floats).
  const even = (camera, a, b) => views(camera).slice(24, 73).forEach((v, i) => {
    const u = ease.inOut(span(24, 72, 24 + i));
    near([[v.x, v.y, v.zoom, v.dolly]], [[a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.zoom * (b.zoom / a.zoom) ** u, a.dolly * (b.dolly / a.dolly) ** u]], `${camera} at frame ${24 + i}`);
  });
  even('[{ at: 1, x: 640, y: 360, zoom: 2 }, { at: 3, x: 900, y: 200, zoom: 2 }]', { x: 640, y: 360, zoom: 2, dolly: 1 }, { x: 900, y: 200, zoom: 2, dolly: 1 });
  even('[{ at: 1, x: 700, y: 300, zoom: 1 }, { at: 3, x: 700, y: 300, zoom: 200 }]', { x: 700, y: 300, zoom: 1, dolly: 1 }, { x: 700, y: 300, zoom: 200, dolly: 1 });
  even('[{ at: 1, x: 700, y: 300, dolly: 1 }, { at: 3, x: 700, y: 300, dolly: 1.5 }]', { x: 700, y: 300, zoom: 1, dolly: 1 }, { x: 700, y: 300, zoom: 1, dolly: 1.5 });
  even('[{ at: 1, x: 640, y: 360, zoom: 0.7, dolly: 3 }, { at: 3, x: 900, y: 200, zoom: 2.1, dolly: 1 }]', { x: 640, y: 360, zoom: 0.7, dolly: 3 }, { x: 900, y: 200, zoom: 2.1, dolly: 1 });
  even('[{ at: 1, x: 640, y: 360, zoom: 0.1, dolly: 3 }, { at: 3, x: 900, y: 200, zoom: 0.3, dolly: 1 }]', { x: 640, y: 360, zoom: 0.1, dolly: 3 }, { x: 900, y: 200, zoom: 0.3, dolly: 1 });
});

test('the film scaffold dollies by scaling each element by dolly to the power of its depth, so a near element grows more than a far one', (t) => {
  const piece = scaffold(t, {
    ELEMENTS: "[{ name: 'sky', enter: 0, exit: DUR, depth: 0 }, { name: 'mid', enter: 0, exit: DUR }, { name: 'near', enter: 0, exit: DUR, depth: 2 }]",
    CAMERA: '[{ at: 1, x: 640, y: 360, dolly: 1 }, { at: 3, x: 640, y: 360, dolly: 1.5 }]',
    PAINT: "{ sky: (g) => g.fillRect('sky'), mid: (g) => g.fillRect('mid'), near: (g) => g.fillRect('near') }",
    CONTACTS: "[{ at: 3, cause: 'near', x: 740, y: 400 }]",
  });
  const solved = solve(piece);
  assert.equal(solved.stages.error, null);
  const at = (scales) => [[0, 1, 640, 360], ...['sky', 'mid', 'near'].map((name, i) => [name, scales[i], 640, 360])];
  near(framed(piece, solved, 24), at([1, 1, 1]), 'before the push-in nothing grows');
  const end = framed(piece, solved, 72);
  near(end, at([1, 1.5, 2.25]), 'at the last key depth 0 holds, depth 1 grows by the dolly and depth 2 by its square');
  const [, sky, mid, nearer] = end.map((row) => row[1]);
  assert.ok(nearer > mid && mid > sky && sky === 1, `a near element grows more than a far one: ${[sky, mid, nearer]}`);
  const { views, contacts } = solved.state.cues;
  assert.equal(views[48].zoom, 1, 'the dolly leaves the zoom alone');
  near(framed(piece, solved, 48).slice(1).map(([name, scale]) => [name, scale]),
    [['sky', 1], ['mid', views[48].dolly], ['near', views[48].dolly ** 2]], 'mid-move each element is scaled by the view\'s dolly to its depth');
  assert.ok(Math.abs(views[72].dolly - 1.5) < 1e-9, 'cues.views carries the dolly');
  near([[contacts[0].x, contacts[0].y]], [[640 + 2.25 * 100, 360 + 2.25 * 40]], 'a contact lands where its cause is drawn, at its depth');

  for (const dolly of ['0', '-1', 'NaN', 'Infinity', 'null', "'big'"]) {
    const error = solve(scaffold(t, { CAMERA: `[{ at: 1, dolly: ${dolly} }]` })).stages.error;
    assert.match(error?.message ?? '', /^camera key 0 has a dolly that is not a positive finite number, got .*: give the scale of the subject's plane, such as 1\.2$/, dolly);
  }
});

test('the film scaffold keeps the view draw shows on every frame in cues.views, with cut: true on each cut of the framing and key: true on each camera key', (t) => {
  const piece = scaffold(t, {
    SHOTS: "[['one', 2], ['two', 2]]",
    ELEMENTS: "[{ name: 'sky', enter: 0, exit: DUR, depth: 0 }, { name: 'mid', enter: 0, exit: DUR }, { name: 'near', enter: 0, exit: DUR, depth: 2 }]",
    CAMERA: '[{ at: 1, x: 640, y: 360, zoom: 1 }, { at: 2, x: 840, y: 260, zoom: 4 },'
      + ' { at: 3, x: 1000, y: 300, zoom: 2 }, { at: 3, x: 100, y: 100, zoom: 0.5 }]',
    PAINT: "{ sky: (g) => g.fillRect('sky'), mid: (g) => g.fillRect('mid'), near: (g) => g.fillRect('near') }",
  });
  const solved = solve(piece);
  assert.equal(solved.stages.error, null);
  const { views } = solved.state.cues;
  assert.equal(views.length, 96);
  for (const f of [0, 24, 36, 48, 71, 72, 95]) {
    const [, zoom, x, y] = framed(piece, solved, f).find(([name]) => name === 'mid');
    near([[views[f].x, views[f].y, views[f].zoom]], [[x, y, zoom]], `frame ${f}'s view is the one draw shows`);
  }
  near([[views[36].x, views[36].y, views[36].zoom]], [[640 + 200 * 2 / 3, 360 - 100 * 2 / 3, 2]], 'midway between keys');
  assert.equal(views[48].cut, undefined, 'the cut into two leaves the camera path alone: cues.shots holds it');
  assert.equal(views[72].cut, true, 'the camera cut');
  assert.equal(views.filter((v) => 'cut' in v).length, 1, 'no other frame cuts');
  assert.deepEqual(views.flatMap((v, f) => ('key' in v ? [[f, v.key]] : [])), [[24, true], [48, true], [72, true]], 'key: true on each camera key\'s frame and no other');

  const empty = solve(scaffold(t, {})).state.cues.views;
  assert.equal(empty.filter((v) => v.x === 640 && v.y === 360 && v.zoom === 1 && !('cut' in v) && !('key' in v)).length, 96, 'empty, the view holds on the design box');
});

test('the film scaffold refuses camera keys out of order, past the film, without a finite place or a zoom above 0, and a depth that is not finite', (t) => {
  const camera = (keys) => solve(scaffold(t, { CAMERA: keys })).stages.error;
  assert.equal(camera('[{ at: 0, x: 0, y: 0, zoom: 1 }, { at: 4, zoom: 0.1 }]'), null, 'keys from the first frame to the last are taken');
  for (const [keys, i] of [
    ['[{ at: 2 }, { at: 1 }]', 1],
    ['[{ at: 4.1 }]', 0],
    ['[{ at: -0.1 }]', 0],
    ['[{ at: 1, x: Infinity }]', 0],
    ['[{ at: 1, y: NaN }]', 0],
    ['[{ at: 1, zoom: 0 }]', 0],
    ['[{ at: 1, zoom: -2 }]', 0],
  ]) {
    const error = camera(keys);
    assert.ok(error, `${keys} is refused`);
    assert.match(error.message, new RegExp(`^camera key ${i} must come at or after the one before it, by 4 s, with a finite place and a zoom above 0$`), keys);
  }
  for (const depth of ["'far'", 'NaN', 'Infinity']) {
    assert.match(solve(scaffold(t, { ELEMENTS: `[{ name: 'a', enter: 0, exit: 1, depth: ${depth} }]` })).stages.error.message,
      /^element a has a depth that is not a finite number$/, depth);
  }
});

// The beats and the eye across cuts are planning checks: the build refuses a
// plan that breaks them, before anything is drawn.
test('the film scaffold puts each beat on its frame, finds the peak, and refuses a beat out of order, without an intensity or a changed state, or with an unknown knowledge', (t) => {
  const ELEMENTS = "[{ name: 'a', enter: 0, exit: DUR }]";
  const beats = (b, more = {}) => solve(scaffold(t, { ELEMENTS, BEATS: b, ...more })).stages.error;
  const piece = scaffold(t, {
    ELEMENTS,
    BEATS: "[{ at: 0.5, intensity: 0.2, element: 'a', changes: 'whole', knows: 'same' }, { at: 2, intensity: 1, element: 'a', changes: 'broken', knows: 'more' }, { at: 3.5, intensity: 0.4, element: 'a', changes: 'still' }]",
  });
  const solved = solve(piece);
  assert.equal(solved.stages.error, null);
  assert.deepEqual(solved.state.cues.beats.map((b) => b.frame), [12, 48, 84]);
  assert.equal(solved.state.cues.peak, 48, 'the peak is the most intense beat');
  assert.equal(solve(scaffold(t, {})).state.cues.peak, null, 'no beats, no peak');
  assert.equal(beats("[{ at: 0, intensity: 0, element: 'a', changes: 'a' }, { at: 4, intensity: 1, element: 'a', changes: 'b' }]"), null, 'beats on the first and last frames are taken');
  for (const [b, message] of [
    ["[{ at: 2, intensity: 0.5, element: 'a', changes: 'a' }, { at: 1, intensity: 0.5, element: 'a', changes: 'b' }]", /^beat 1 must come at or after the one before it, by 4 s$/],
    ["[{ at: 4.1, intensity: 0.5, changes: 'a' }]", /^beat 0 must come/],
    ["[{ at: 1, changes: 'a' }]", /^beat 0 at 1 s needs an intensity from 0 to 1$/],
    ["[{ at: 1, intensity: 1.2, changes: 'a' }]", /needs an intensity/],
    ["[{ at: 1, intensity: NaN, changes: 'a' }]", /needs an intensity/],
    ["[{ at: 1, intensity: 0.5 }]", /^beat 0 at 1 s changes no state/],
    ["[{ at: 1, intensity: 0.5, changes: '  ' }]", /changes no state/],
    ["[{ at: 1, intensity: 0.5, element: 'a', changes: 'a', knows: 'all' }]", /the viewer knows 'less', 'same' or 'more'/],
  ]) {
    const error = beats(b);
    assert.ok(error, `${b} is refused`);
    assert.match(error.message, message, b);
  }
});

test('the film scaffold answers every question a beat asks except the one left open, and refuses what rises without rising', (t) => {
  const beats = (b, open = 'null') => solve(scaffold(t, { ELEMENTS: "[{ name: 'a', enter: 0, exit: DUR }]", BEATS: b, LEFT_OPEN: open })).stages.error;
  const q = (at, extra) => `{ at: ${at}, intensity: 0.5, element: 'a', changes: 'x', ${extra} }`;
  assert.equal(beats(`[${q(1, "asks: 'who?'")}, ${q(2, "answers: 'who?'")}]`), null);
  assert.equal(beats(`[${q(1, "asks: ['who?', 'why?']")}, ${q(2, "answers: 'who?'")}]`, "'why?'"), null, 'the question left open stays open');
  assert.equal(beats(`[${q(1, 'rise: 1')}, ${q(2, '')}, ${q(3, 'rise: 4')}]`), null, 'a beat may give no rise');
  for (const [b, open, message] of [
    [`[${q(1, "asks: 'who?'")}]`, 'null', /^no beats? answers: who\?$/],
    [`[${q(1, "asks: 'who?'")}, ${q(2, "answers: 'why?'")}]`, 'null', /^beat 1 at 2 s answers a question no earlier beat asks: why\?$/],
    [`[${q(1, "answers: 'who?'")}, ${q(2, "asks: 'who?'")}]`, 'null', /^beat 0 at 1 s answers a question no earlier beat asks: who\?$/],
    [`[${q(1, "asks: 'who?'")}]`, "'why?'", /^no beat asks the question left open: why\?$/],
    [`[${q(1, "asks: 'who?'")}, ${q(2, "answers: 'who?'")}]`, "'who?'", /^beat 1 at 2 s answers the question left open: who\?$/],
    [`[${q(1, 'rise: 3')}, ${q(2, 'rise: 3')}]`, 'null', /^beat 1 at 2 s does not raise what rises: 3 after 3$/],
    [`[${q(1, 'rise: 3')}, ${q(2, 'rise: 1')}]`, 'null', /does not raise what rises: 1 after 3/],
    [`[${q(1, 'rise: NaN')}]`, 'null', /^beat 0 at 1 s does not raise what rises: NaN after -Infinity$/],
  ]) {
    const error = beats(b, open);
    assert.ok(error, `${b} with ${open} left open is refused`);
    assert.match(error.message, message, b);
  }
});

// A cue table of poses lets the thing a beat turns on vanish from a shot, or
// change off screen, with every entry and exit check passing: each beat names
// the row whose state it changes, and that row is seen in the shot playing then.
test('the film scaffold refuses a beat that names no row of the cue table, or changes one off screen, and shows a row only in the shots it lists', async (t) => {
  const SHOTS = "[['wide', 2], ['close', 1], ['last', 1]]";
  const POSES = "{ name: 'sit', enter: 0, exit: 2 }, { name: 'reach', enter: 2, exit: DUR }";
  const beat = "[{ at: 3.5, intensity: 1, element: 'thing', changes: 'moved to the other side' }]";
  const error = (fill) => solve(scaffold(t, { SHOTS, BEATS: beat, ...fill })).stages.error;
  const refused = async (name, elements, message, more = {}) => t.test(name, () => {
    const e = error({ ELEMENTS: `[${elements}]`, ...more });
    assert.ok(e, `${elements} is refused`);
    assert.match(e.message, message);
  });
  await refused('a beat on a thing the table has no row for', POSES,
    /^beat 0 at 3\.5 s names no element of the cue table whose state it changes: thing$/);
  await refused('a beat that names no element at all', POSES,
    /^beat 0 at 1 s names no element of the cue table whose state it changes: undefined$/, { BEATS: "[{ at: 1, intensity: 1, changes: 'x' }]" });
  await refused('a change after its row has exited', `${POSES}, { name: 'thing', enter: 0, exit: 3 }`,
    /^beat 0 at 3\.5 s changes thing off screen: it is not seen in last, the shot playing then$/);
  await refused('a change in a shot its row does not list', `${POSES}, { name: 'thing', enter: 0, exit: DUR, shots: ['wide', 'close'] }`,
    /changes thing off screen: it is not seen in last/);
  await refused('a row that lists a shot playing outside its entry and exit', `{ name: 'thing', enter: 0, exit: 2, shots: ['wide', 'last'] }`,
    /^element thing lists a shot that does not play between its entry and exit: last$/, { BEATS: '[]' });
  await refused('a row that lists a shot the film does not have', `{ name: 'thing', enter: 0, exit: DUR, shots: ['wide', 'middle'] }`,
    /^element thing lists a shot that does not play between its entry and exit: middle$/, { BEATS: '[]' });
  await refused('a row whose shots list is empty', `{ name: 'thing', enter: 0, exit: DUR, shots: [] }`,
    /^element thing lists no shots, so it is never drawn: name its shots, or leave the list out to show it in every shot$/, { BEATS: '[]' });
  for (const [given, got] of [["'wide'", '"wide"'], ["''", '""'], ['2', '2'], ["{ name: 'wide' }", '{"name":"wide"}'], ['null', 'null']]) {
    await refused(`a row whose shots is ${given}, not a list`, `{ name: 'thing', enter: 0, exit: DUR, shots: ${given} }`,
      new RegExp(`^element thing's shots is not a list of shot names, got ${got.replace(/[{}]/g, '\\$&')}: put its shot names in a list, such as \\['first'\\], or leave the list out to show it in every shot$`), { BEATS: '[]' });
  }
  for (const [given, got] of [["'wide'", '"wide"'], ["''", '""'], ['0', '0'], ['2', '2'], ["{ name: 'wide' }", '{"name":"wide"}'], ['null', 'null']]) {
    await refused(`a state whose shots is ${given}, not a list`, `{ name: 'thing', enter: 0, exit: DUR, states: [{ shots: ['wide'] }, { shots: ${given} }] }`,
      new RegExp(`^element thing's state 1 shots is not a list of shot names, got ${got.replace(/[{}]/g, '\\$&')}: put the state's shot names in a list, such as \\['first'\\]$`), { BEATS: '[]' });
  }
  const literal = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const [given, got] of [["'wide'", '"wide"'], ['0', '0'], ["{ shots: ['wide'] }", '{"shots":["wide"]}'], ['null', 'null']]) {
    await refused(`a row whose states is ${given}, not a list`, `{ name: 'thing', enter: 0, exit: DUR, states: ${given} }`,
      new RegExp(`^element thing's states is not a list of states, got ${literal(got)}: ${literal("put its states in a list, such as [{ shots: ['first'] }], or leave the list out")}$`), { BEATS: '[]' });
  }
  for (const [given, got] of [['null', 'null'], ["'wide'", '"wide"'], ["['wide']", '["wide"]']]) {
    await refused(`a state that is ${given}, not an object`, `{ name: 'thing', enter: 0, exit: DUR, states: [{ shots: ['wide'] }, ${given}] }`,
      new RegExp(`^element thing's state 1 is not an object, got ${literal(got)}: ${literal("write each state as an object, such as { shots: ['first'], signs: ['whole'] }")}$`), { BEATS: '[]' });
  }
  await refused('a state whose shots list is empty', `{ name: 'thing', enter: 0, exit: DUR, states: [{ shots: ['wide'] }, { shots: [] }] }`,
    /^element thing's state 1 lists no shots, so it is never shown: name the shots that show it$/, { BEATS: '[]' });
  await refused('a state with no shots key', `{ name: 'thing', enter: 0, exit: DUR, states: [{ shots: ['wide'] }, { signs: ['whole'] }] }`,
    /^element thing's state 1 has no shots, so it is never shown: name the shots that show it$/, { BEATS: '[]' });
  await refused('a hole in the states list', `{ name: 'thing', enter: 0, exit: DUR, states: [{ shots: ['wide'] }, , { shots: ['close'] }] }`,
    /^element thing's state 1 is not an object, got undefined: /, { BEATS: '[]' });
  await refused('a symbol named as a row shot', `{ name: 'thing', enter: 0, exit: DUR, shots: [Symbol('x')] }`,
    /^element thing lists a shot that does not play between its entry and exit: Symbol\(x\)$/, { BEATS: '[]' });
  await refused('a symbol named as a state shot', `{ name: 'thing', enter: 0, exit: DUR, states: [{ shots: [Symbol('x')] }] }`,
    /^element thing's state 0 names a shot the film does not have: Symbol\(x\)$/, { BEATS: '[]' });
  await refused('a hole in a row\'s shots list', `{ name: 'thing', enter: 0, exit: DUR, shots: ['wide', , 'close'] }`,
    /^element thing's shots list has a hole at 1, which names no shot: /, { BEATS: '[]' });
  await refused('a symbol as a row\'s name, with no exit', `{ name: Symbol('x'), enter: 0 }`,
    /^element Symbol\(x\) has no exit$/, { BEATS: '[]' });
  await refused('a symbol as a row\'s name, with an empty shots list', `{ name: Symbol('x'), enter: 0, exit: DUR, shots: [] }`,
    /^element Symbol\(x\) lists no shots, /, { BEATS: '[]' });
  await refused('a symbol as a state\'s row name', `{ name: Symbol('x'), enter: 0, exit: DUR, states: [{}] }`,
    /^element Symbol\(x\)'s state 0 has no shots, /, { BEATS: '[]' });
  await refused('a symbol as the shot of a focus row', `{ name: 'thing', enter: 0, exit: DUR }`,
    /^the focus for Symbol\(x\) names no shot$/, { BEATS: '[]', FOCUS: "[{ shot: Symbol('x'), in: [0, 0], out: [0, 0] }]" });
  await refused('two camera keys at one second on frame 0', `{ name: 'thing', enter: 0, exit: DUR }`,
    /^camera keys 0 and 1 land on one frame, got 0 s and 0 s on frame 0: no cut is counted on frame 0, so only one of them shows; /, { BEATS: '[]', CAMERA: '[{ at: 0, x: 100 }, { at: 0, x: 200 }]' });
  await refused('a symbol as the element a beat names', `{ name: 'thing', enter: 0, exit: DUR }`,
    /^beat 0 at 1 s names no element of the cue table whose state it changes: Symbol\(x\)$/, { BEATS: "[{ at: 1, intensity: 0.5, changes: 'x', element: Symbol('x') }]" });
  await refused('a symbol as the element a beat changes off screen', `{ name: Symbol.iterator, enter: 0, exit: 1 }`,
    /^beat 0 at 3 s changes Symbol\(Symbol\.iterator\) off screen: /, { BEATS: "[{ at: 3, intensity: 0.5, changes: 'x', element: Symbol.iterator }]" });
  await refused('a hole in a state\'s shots list', `{ name: 'thing', enter: 0, exit: DUR, states: [{ shots: ['wide', , 'close'] }] }`,
    /^element thing's state 0 shots list has a hole at 1, which names no shot: /, { BEATS: '[]' });
  const sym = `{ name: 'thing', enter: 0, exit: DUR }`;
  const voice = '{ pitch: 220 }';
  await refused('a symbol as the cause of a sound with no voice or ambience', sym,
    /^the sound at 1 s \(Symbol\(x\)\) has neither a voice nor an ambience$/, { BEATS: '[]', SOUNDS: "[{ at: 1, cause: Symbol('x') }]" });
  await refused('a symbol as the role of a sound', sym,
    /^the sound at 1 s takes a role of 'music' or 'sting', or none, got Symbol\(r\)$/, { BEATS: '[]', SOUNDS: `[{ at: 1, cause: 'thing', voice: ${voice}, role: Symbol('r') }]` });
  await refused('a symbol as the second of a sound with no voice or ambience', sym,
    /^sound 0 has an at that is not a finite number of seconds, got Symbol\(t\): /, { BEATS: '[]', SOUNDS: "[{ at: Symbol('t'), cause: 'thing' }]" });
  await refused('NaN as the second of a sound, printed as written and not as null', sym,
    /^sound 0 has an at that is not a finite number of seconds, got NaN: /, { BEATS: '[]', SOUNDS: "[{ at: NaN, cause: 'thing' }]" });
  await refused('a symbol as the second of a sound with a bad role', sym,
    /^sound 0 has an at that is not a finite number of seconds, got Symbol\(t\): /, { BEATS: '[]', SOUNDS: `[{ at: Symbol('t'), cause: 'thing', voice: ${voice}, role: 'score' }]` });
  await refused('a symbol as the rise of a beat', sym,
    /^beat 0 at 1 s does not raise what rises: Symbol\(r\) after -Infinity$/, { BEATS: "[{ at: 1, intensity: 0.5, element: 'thing', changes: 'x', rise: Symbol('r') }]" });
  await refused('a symbol as the cause of a sound declared off screen while it is on screen', `{ name: Symbol.iterator, enter: 0, exit: DUR }`,
    /^the sound at 1 s declares its cause off screen, but Symbol\(Symbol\.iterator\) is on screen then$/,
    { BEATS: '[]', SOUNDS: `[{ at: 1, cause: Symbol.iterator, voice: ${voice}, offscreen: { side: 'left', distance: 0.5 } }]` });
  await refused('a symbol as the cause of a sound that is not on screen', sym,
    /^the sound at 1 s has no cause on screen: Symbol\(x\)$/, { BEATS: '[]', SOUNDS: `[{ at: 1, cause: Symbol('x'), voice: ${voice} }]` });
  await refused('a symbol as the cause of a contact that is not on screen', sym,
    /^the contact at 1 s has no cause on screen: Symbol\(x\)$/, { BEATS: '[]', CONTACTS: "[{ at: 1, cause: Symbol('x'), x: 10, y: 10 }]" });
  await refused('a symbol as the question a beat answers that no beat asks', sym,
    /^beat 0 at 1 s answers a question no earlier beat asks: Symbol\(q\)$/, { BEATS: "[{ at: 1, intensity: 0.5, element: 'thing', changes: 'x', answers: Symbol('q') }]" });
  await refused('a symbol as the question a beat answers that is left open', sym,
    /^beat 1 at 1\.5 s answers the question left open: Symbol\(q\)$/, { BEATS: "[{ at: 1, intensity: 0.5, element: 'thing', changes: 'x', asks: Symbol.for('q') }, { at: 2, intensity: 0.5, element: 'thing', changes: 'x', answers: Symbol.for('q') }]".replace('at: 2', 'at: 1.5'), LEFT_OPEN: "Symbol.for('q')" });
  await refused('a symbol as the question left open that no beat asks', sym,
    /^no beat asks the question left open: Symbol\(q\)$/, { BEATS: '[]', LEFT_OPEN: "Symbol('q')" });
  await refused('a symbol as a question no beat answers', sym,
    /^no beat answers: Symbol\(q\)$/, { BEATS: "[{ at: 1, intensity: 0.5, element: 'thing', changes: 'x', asks: Symbol('q') }]" });
  await t.test('a symbol as the cause of music and of a sound it is not quieter than', (s) => {
    const warn = s.mock.method(console, 'warn', () => {});
    const e = error({ ELEMENTS: `[{ name: Symbol.iterator, enter: 0, exit: DUR }]`, BEATS: '[]',
      SOUNDS: `[{ at: 1, cause: Symbol.iterator, voice: { pitch: 220, level: 1 }, role: 'music' }, { at: 1, cause: Symbol.iterator, voice: { pitch: 330, level: 0.1 } }]` });
    assert.equal(e, null);
    assert.deepEqual(warn.mock.calls.map((c) => c.arguments[0]),
      ['warning: the music at 1 s (Symbol(Symbol.iterator)) is not quieter than the sound at 1 s (Symbol(Symbol.iterator)) it plays with: lower the music, or bring it forward only on a beat marked forward and drop it back after']);
  });
  // The given value is printed whatever it is: a function, a BigInt, a symbol or a cyclic object.
  const cyclic = '(() => { const o = {}; o.o = o; return o; })()';
  for (const [where, given, got] of [
    ['shots', '() => 1', 'a function'], ['shots', '1n', '1n'], ['states', "Symbol('x')", 'Symbol(x)'], ['states', cyclic, 'an object that cannot be printed'],
    ['state 0 shots', '1n', '1n'],
  ]) {
    const row = where === 'state 0 shots' ? `states: [{ shots: ${given} }]` : `${where}: ${given}`;
    await refused(`a row whose ${where} is ${given}, printed without throwing`, `{ name: 'thing', enter: 0, exit: DUR, ${row} }`,
      new RegExp(`^element thing's ${where} is not a list of (shot names|states), got ${literal(got)}: `), { BEATS: '[]' });
  }
  await refused('a state that names a shot the film does not have', `{ name: 'thing', enter: 0, exit: DUR, states: [{ shots: ['wide'] }, { shots: ['close', 'lats'] }] }`,
    /^element thing's state 1 names a shot the film does not have: lats$/, { BEATS: '[]' });
  await refused('a state that names a shot playing outside its row\'s entry and exit', `{ name: 'thing', enter: 0, exit: 3, states: [{ shots: ['wide'] }, { shots: ['last'] }] }`,
    /^element thing's state 1 names a shot that does not play between its entry and exit: last$/, { BEATS: '[]' });
  await refused('a state that names a shot inside its row\'s entry and exit that the row\'s shots list leaves out', `{ name: 'thing', enter: 0, exit: DUR, shots: ['wide', 'last'], states: [{ shots: ['wide'] }, { shots: ['close'] }] }`,
    /^element thing's state 1 names a shot that the row's shots list leaves out: close$/, { BEATS: '[]' });
  await refused('a sound whose cause is not seen in the shot playing then', `{ name: 'thing', enter: 0, exit: DUR, shots: ['wide', 'last'] }`,
    /^the sound at 2\.5 s has no cause on screen: thing$/, { BEATS: '[]', SOUNDS: "[{ at: 2.5, cause: 'thing', voice: { pitch: 220 } }]" });

  await t.test('a change seen in the shot playing then, and a row painted only in its shots', () => {
    const piece = scaffold(t, {
      SHOTS,
      BEATS: beat,
      ELEMENTS: "[{ name: 'thing', enter: 0, exit: DUR, shots: ['wide', 'last'], states: [{ shots: ['wide'] }, { shots: ['last'] }] }]",
      PAINT: "{ thing: (g) => g.fillRect('thing') }",
    });
    const solved = solve(piece);
    assert.equal(solved.stages.error, null);
    const painted = (frame) => {
      const calls = [];
      drawFrame(surface(calls), piece, solved, frame / 95);
      return calls.filter(([k, id]) => k === 'fillRect' && id === 'thing').length;
    };
    assert.deepEqual([47, 48, 71, 72, 95].map(painted), [1, 0, 0, 1, 1], 'thing is painted in wide and last, not in close');
  });
});

test('the film scaffold keeps the eye within a third of the frame across a cut unless the later shot is a jolt', (t) => {
  const focus = (rows) => solve(scaffold(t, { SHOTS: "[['one', 2], ['two', 1], ['three', 1]]", FOCUS: rows })).stages.error;
  const row = (shot, inX, outX, extra = '') => `{ shot: '${shot}', in: [${inX}, 360], out: [${outX}, 360]${extra} }`;
  assert.equal(focus(`[${row('one', 300, 600)}, ${row('two', 1026, 900)}]`), null, 'a jump of a third of the width, 426.67, less a little, is taken');
  assert.equal(focus(`[${row('one', 300, 600)}, ${row('three', 1200, 900)}]`), null, 'a cut with a shot that has no row is not checked');
  assert.equal(focus(`[${row('one', 300, 600)}, ${row('two', 1100, 900, ', jolt: true')}]`), null, 'a jolt may jump');
  assert.equal(focus(`[${row('one', 300, 600)}, { shot: 'two', out: [900, 360], carry: 'in' }, ${row('three', 800, 900)}]`), null, 'a cut a row carries in is not checked');
  assert.equal(focus(`[{ shot: 'one', in: [300, 360], carry: 'out' }, ${row('two', 1100, 900)}, ${row('three', 800, 900)}]`), null, 'a cut a row carries out is not checked');
  assert.equal(focus(`[${row('one', 300, 600)}, { shot: 'two', in: [1100, 360], carry: 'out', jolt: true }, ${row('three', 800, 900)}]`), null, 'a jolt may carry the motion out of its shot');
  for (const [rows, message] of [
    [`[${row('one', 300, 600)}, { shot: 'two', out: [200, 360], carry: 'in' }, ${row('three', 800, 900)}]`, /^the eye jumps more than a third of the frame from two to three/],
    [`[${row('one', 300, 600)}, { shot: 'two', in: [1100, 360], carry: 'out' }, ${row('three', 800, 900)}]`, /^the eye jumps more than a third of the frame from one to two/],
    [`[${row('two', 300, 600, ", carry: 'in'")}]`, /^the focus for two carries in, which drops its in, and gives one: take the in out of the row, or drop the carry$/],
    [`[${row('two', 300, 600, ", carry: 'out'")}]`, /^the focus for two carries out, which drops its out, and gives one: take the out out of the row, or drop the carry$/],
    [`[${row('one', 300, 600, ", carry: 'both'")}]`, /^the focus for one carries both: carry 'in' or 'out'$/],
    ["[{ shot: 'two', in: [300, 360], carry: 'in' }]", /^the focus for two carries in and needs its out, \[x, y\]$/],
    ["[{ shot: 'two', out: [300, 360], carry: 'out' }]", /^the focus for two carries out and needs its in, \[x, y\]$/],
    ["[{ shot: 'two', out: [600, 360], carry: 'in', jolt: true }]", /^the focus for two is a jolt and carries in: both are about the cut into two/],
    [`[${row('two', 300, 600)}, ${row('two', 300, 600)}]`, /^the focus has two rows for two: keep one$/],
    [`[${row('one', 300, 600, ", carry: 'in'")}]`, /^the focus for one carries in, but one is the first shot and has no cut into it: drop the carry$/],
    [`[${row('three', 300, 600, ", carry: 'out'")}]`, /^the focus for three carries out, but three is the last shot and has no cut out of it: drop the carry$/],
    [`[${row('one', 300, 600)}, ${row('two', 1100, 900)}]`, /^the eye jumps more than a third of the frame from one to two: move the focus, mark two as a jolt for a heavy beat, or give its row carry: 'in' where motion carries the eye across$/],
    [`[${row('two', 300, 200)}, ${row('three', 700, 900)}]`, /from two to three/],
    [`[${row('four', 300, 600)}]`, /^the focus for four names no shot$/],
    ["[{ shot: 'one', in: [300, 360] }]", /^the focus for one needs an in and an out, each \[x, y\]$/],
    ["[{ shot: 'one', in: [300, NaN], out: [0, 0] }]", /needs an in and an out/],
  ]) {
    const error = focus(rows);
    assert.ok(error, `${rows} is refused`);
    assert.match(error.message, message, rows);
  }
});

test('the film scaffold carries each shot\'s BLOCKING marks and line of attention in s.cues.blocking, and refuses a row that names no shot, repeats a shot, or gives a bad mark, line or cross', (t) => {
  const block = (rows) => solve(scaffold(t, { SHOTS: "[['first', 2], ['second', 2]]", BLOCKING: rows }));
  assert.deepEqual(block('[]').state.cues.blocking, []);
  const row = "{ shot: 'second', marks: { a: [420, 520], b: [860, 500] }, line: ['b', 'a'], cross: true }";
  assert.deepEqual(block(`[${row}]`).state.cues.blocking, [{ shot: 'second', marks: { a: [420, 520], b: [860, 500] }, line: ['b', 'a'], cross: true }]);
  const ok = "marks: { a: [1, 2], b: [3, 4] }, line: ['a', 'b']";
  for (const [rows, message] of [
    ["{ shot: 'first' }", /^the BLOCKING table is not a list of rows, got /],
    ['[null]', /^blocking row 0 is not an object, got null: /],
    [`[{ shot: 'third', ${ok} }]`, /^the blocking row 0 names no shot of the film, got "third": name one of first, second$/],
    [`[{ shot: 'first', ${ok} }, { shot: 'first', ${ok} }]`, /^the blocking has two rows for first: keep one$/],
    ["[{ shot: 'first', marks: [1, 2], line: ['a', 'b'] }]", /^the blocking for first has marks that are not named design points, got /],
    ["[{ shot: 'first', marks: { a: [1] }, line: ['a', 'b'] }]", /^the blocking for first has a mark a that is not a design point \[x, y\], got /],
    ["[{ shot: 'first', marks: { a: [1, 2] }, line: ['a', 'a'] }]", /^the blocking for first has a line that is not two different names of its marks, got /],
    [`[{ shot: 'first', marks: { a: [1, 2] }, line: ['a', 'z'] }]`, /has a line that is not two different names of its marks/],
    [`[{ shot: 'first', ${ok}, cross: 1 }]`, /^the blocking for first takes cross: true or no cross, got 1$/],
  ]) {
    const error = block(rows).stages.error;
    assert.ok(error, `${rows} is refused`);
    assert.match(error.message, message, rows);
  }
});

// Under a moving camera a FOCUS point's place in the frame is not its design
// point: the jump is measured where the eye sees it, the out point through the
// view on the last frame before the cut and the in point through the view on
// the first frame after it.
test('the film scaffold measures the eye\'s jump across a cut on screen, through the camera on the frames either side of it', (t) => {
  const focus = (outX, inX, camera) => solve(scaffold(t, {
    SHOTS: "[['one', 2], ['two', 2]]",
    FOCUS: `[{ shot: 'one', in: [640, 360], out: [${outX}, 360] }, { shot: 'two', in: [${inX}, 360], out: [640, 360] }]`,
    CAMERA: camera,
  })).stages.error;
  // The framing pans 460 across the cut at 2 s: design 640 shows at 640 before it and at 180 after.
  const pan = '[{ at: 2, x: 640 }, { at: 2, x: 1100 }]';
  const jump = /^the eye jumps more than a third of the frame from one to two: move the focus, mark two as a jolt for a heavy beat, or give its row carry: 'in' where motion carries the eye across$/;
  const refused = (error, what) => {
    assert.ok(error, `${what} is refused`);
    assert.match(error.message, jump, what);
  };
  refused(focus(640, 640, pan), 'one design point, 460 apart on screen across a panned cut');
  assert.equal(focus(400, 1100, pan), null, '700 apart in design, 240 on screen, where the pan follows the eye');
  refused(focus(500, 800, '[{ at: 0, zoom: 2 }]'), '300 apart in design, 600 on screen at zoom 2');
  assert.equal(focus(340, 940, '[{ at: 0, zoom: 0.5 }]'), null, '600 apart in design, 300 on screen at zoom 0.5');
});

// seeds --cuts reads the eye's points from state.cues.focus, so the scaffold's
// FOCUS rows must reach it, carried on screen through the camera.
test('the film scaffold carries its FOCUS rows in cues.focus, so cutPlan reports each cut\'s eye jump', (t) => {
  const { cutPlan, shotList } = require('../tools/contact-sheet.js');
  const plan = (fill) => {
    const piece = scaffold(t, { SHOTS: "[['one', 2], ['two', 2]]", ...fill });
    const { state } = solve(piece);
    return { state, plan: cutPlan(piece, shotList(piece, 'seeds', piece.seed, state), state) };
  };
  // The framing pans 460 across the cut: design 640 shows at 640 before it and at 180 after.
  const { state, plan: got } = plan({
    FOCUS: "[{ shot: 'one', in: [640, 360], out: [400, 360] }, { shot: 'two', in: [640, 360], out: [640, 360], jolt: true }]",
    CAMERA: '[{ at: 2, x: 640 }, { at: 2, x: 1100 }]',
  });
  assert.deepEqual(state.cues.focus, [{ shot: 'one', in: [640, 360], out: [400, 360] }, { shot: 'two', in: [640, 360], out: [640, 360], jolt: true }]);
  assert.equal(got.focus, true);
  const [cut] = got.cuts;
  assert.deepEqual([cut.out, cut.in, cut.jump, cut.jolt], [[400, 360], [180, 360], 0.17, true]);
  // A carry row keeps only its live side.
  const carried = plan({ FOCUS: "[{ shot: 'two', carry: 'in', out: [640, 360] }]" }).state.cues.focus;
  assert.deepEqual(carried, [{ shot: 'two', out: [640, 360], carry: 'in' }]);
  // A film without FOCUS keeps no focus key.
  const none = plan({});
  assert.equal('focus' in none.state.cues, false);
  assert.equal(none.plan.focus, false);
});

// Two CAMERA keys at one second inside a shot cut the framing on screen, so the
// eye jumps there too: the shot's point between its in and out at the cut,
// through the view on the frames either side of it.
test('the film scaffold measures the eye\'s jump at a camera cut inside a shot', (t) => {
  const reframe = (x, extra = '', key = '', fill = {}) => solve(scaffold(t, {
    SHOTS: "[['one', 4]]",
    FOCUS: `[{ shot: 'one', in: [440, 360], out: [840, 360]${extra} }]`,
    CAMERA: `[{ at: 2, x: 640 }, { at: 2, x: ${x}${key} }]`,
    ...fill,
  })).stages.error;
  // Near 2 s of 4 the point is near 640: a pan of 460 moves it 460 on screen.
  const jump = /^the eye jumps more than a third of the frame at the camera cut at 2 s in one: move the camera keys or the focus, or give camera key 1 jump: true$/;
  const error = reframe(1100);
  assert.ok(error, 'a framing cut of 460 inside one shot is refused');
  assert.match(error.message, jump);
  assert.equal(reframe(1000), null, 'a framing cut of 360 is taken');
  assert.equal(reframe(1100, '', ', jump: true'), null, 'a framing cut whose second key is marked jump may jump');
  assert.match(reframe(1100, ', jolt: true')?.message ?? '', jump, 'a jolt covers only the cut into its shot, not a framing cut inside it');
  // The skip paths: a camera cut on a shot's first frame is that shot's cut, a
  // shot with no FOCUS row is not checked, and a cut on the film's last frame
  // shows no frame after it.
  assert.equal(reframe(1100, '', '', { SHOTS: "[['zero', 2], ['one', 2]]" }), null, 'a camera cut on a shot\'s first frame');
  assert.equal(reframe(1100, '', '', { FOCUS: '[]' }), null, 'a shot with no FOCUS row');
  assert.equal(reframe(0, '', '', { CAMERA: '[{ at: 4, x: 640 }, { at: 4, x: 1100 }]' }), null, 'a camera cut on the film\'s last frame');
  for (const [camera, message] of [
    ['[{ at: 2, x: 640, jump: true }, { at: 2, x: 1100 }]', /^camera key 0 at 2 s allows a jump but cuts no framing: give jump: true only to a key on the same frame as the key before it$/],
    ['[{ at: 1, x: 640 }, { at: 2, x: 1100, jump: true }]', /^camera key 1 at 2 s allows a jump but cuts no framing:/],
    ['[{ at: 2, x: 640 }, { at: 2, x: 1100, jump: 1 }]', /^camera key 1 at 2 s cuts the framing, so jump must be true or left out, got 1: give jump: true to let the eye jump there$/],
    ['[{ at: 2, x: 640 }, { at: 2, x: 1100, jump: false }]', /^camera key 1 at 2 s cuts the framing, so jump must be true or left out, got false:/],
    ['[{ at: 1, x: 640 }, { at: 2, x: 1100, jump: false }]', /^camera key 1 at 2 s allows a jump but cuts no framing:/],
  ]) assert.match(reframe(0, '', '', { CAMERA: camera })?.message ?? '', message, camera);
  // The check is the key's frame against the key before it, so the third of three
  // keys at one second may carry the jump too.
  assert.equal(reframe(0, '', '', { CAMERA: '[{ at: 2, x: 640 }, { at: 2, x: 700, jump: true }, { at: 2, x: 1100, jump: true }]' }), null, 'the third of three keys at one second may jump');
  // The out point is reached on the shot's last frame, frame 95 of 96: a zoom
  // from 1 to 2 there moves the out point, 430 from the centre, by 430.
  const last = solve(scaffold(t, {
    SHOTS: "[['one', 4]]",
    FOCUS: "[{ shot: 'one', in: [640, 360], out: [1070, 360] }]",
    CAMERA: '[{ at: 95 / 24, zoom: 1 }, { at: 95 / 24, zoom: 2 }]',
  })).stages.error;
  assert.match(last?.message ?? '', /^the eye jumps more than a third of the frame at the camera cut at 3\.958\d* s in one:/, 'the out point on the shot\'s last frame');
  // A zoom from 1 to 2 about the centre moves a point by its distance from the
  // centre, so only the point at 2 s of 4, halfway from in to out, decides.
  const zoom = (from, to) => solve(scaffold(t, {
    SHOTS: "[['one', 4]]",
    FOCUS: `[{ shot: 'one', in: [${from}, 360], out: [${to}, 360] }]`,
    CAMERA: '[{ at: 2, zoom: 1 }, { at: 2, zoom: 2 }]',
  })).stages.error;
  assert.equal(zoom(100, 1180), null, 'the point halfway between in and out sits still under the zoom');
  assert.match(zoom(640, 1520)?.message ?? '', /^the eye jumps more than a third of the frame at the camera cut at 2 s in one:/, 'the point halfway from 640 to 1520 sits 440 from the centre, so the zoom moves it 440');
});

// Three or more CAMERA keys at one second make one cut, from the view before it
// to the last key's view, which a jump on any key after the first exempts.
test('the film scaffold makes one camera cut of several keys on one frame', async (t) => {
  const three = (camera) => solve(scaffold(t, {
    SHOTS: "[['one', 4]]",
    FOCUS: "[{ shot: 'one', in: [440, 360], out: [840, 360] }]",
    CAMERA: camera,
  })).stages.error;
  await t.test('a jump on the last of three keys exempts the cut', () => {
    assert.equal(three('[{ at: 2, x: 640 }, { at: 2, x: 700 }, { at: 2, x: 1100, jump: true }]'), null);
  });
  await t.test('a jump on the middle of three keys exempts the cut', () => {
    assert.equal(three('[{ at: 2, x: 640 }, { at: 2, x: 700, jump: true }, { at: 2, x: 1100 }]'), null);
  });
  await t.test('the refusal names the cut\'s last key', () => {
    assert.match(three('[{ at: 2, x: 640 }, { at: 2, x: 700 }, { at: 2, x: 1100 }]')?.message ?? '',
      /^the eye jumps more than a third of the frame at the camera cut at 2 s in one: move the camera keys or the focus, or give camera key 2 jump: true$/);
  });
});

// The eye spends the first frames after a cut finding the new shot: a beat
// there is lost, and a jolt there jumps an eye that has not landed yet.
test('the film scaffold refuses a beat or a jolt in the first 6 frames at 24 fps after a cut, scaled by the rate', async (t) => {
  const SHOTS = "[['one', 2], ['two', 1], ['three', 1]]";
  const beat = (at, hz = '24') => solve(scaffold(t, {
    HZ: hz, SHOTS, ELEMENTS: "[{ name: 'a', enter: 0, exit: DUR }]", BEATS: `[{ at: ${at}, intensity: 1, element: 'a', changes: 'x' }]`,
  })).stages.error;
  await t.test('beats the eye can see', () => {
    for (const at of [0, 1.9, 2.25, 2.24, 3.5, 4]) assert.equal(beat(at), null, `a beat at ${at} s is taken`);
  });
  for (const [at, hz, message] of [
    [2, '24', /^beat 0 at 2 s falls 0 frames after the cut to two, before the eye has found the shot: move it 6 frames or more after the cut$/],
    [2.2, '24', /^beat 0 at 2\.2 s falls 5 frames after the cut to two/],
    [3.05, '24', /falls 1 frames after the cut to three/],
    [2.24, '60', /^beat 0 at 2\.24 s falls 14 frames after the cut to two, .*: move it 15 frames or more after the cut$/],
  ]) {
    await t.test(`a beat at ${at} s at ${hz} fps`, () => {
      const error = beat(at, hz);
      assert.ok(error, `a beat at ${at} s at ${hz} fps is refused`);
      assert.match(error.message, message);
    });
  }
  // Two CAMERA keys at one second cut the framing, and the refusal names the
  // latest cut before the beat, so its advice clears every cut it falls after.
  const framing = (fill, at) => solve(scaffold(t, {
    ELEMENTS: "[{ name: 'a', enter: 0, exit: DUR }]", BEATS: `[{ at: ${at}, intensity: 1, element: 'a', changes: 'x' }]`, ...fill,
  })).stages.error;
  const cut = "[{ at: 2, x: 640 }, { at: 2, x: 900 }]";
  await t.test('beats off a camera cut', () => {
    assert.equal(framing({ CAMERA: cut }, 2.25), null, '6 frames after the camera cut');
    assert.equal(framing({ CAMERA: cut }, 1.95), null, 'before the camera cut');
    assert.match(framing({ CAMERA: "[{ at: 0, x: 640 }, { at: 0, x: 900 }]" }, 0.05).message, /^camera keys 0 and 1 land on one frame/, 'two keys on the first frame are refused, not counted as a cut');
    assert.equal(framing({ CAMERA: "[{ at: 1, x: 640 }, { at: 2, x: 900 }]" }, 2.05), null, 'a move that lands is not a cut');
  });
  for (const [fill, at, message] of [
    [{ CAMERA: cut }, 2.05, /^beat 0 at 2\.05 s falls 1 frames after the camera cut at 2 s, before the eye has found the shot: move it 6 frames or more after the cut$/],
    [{ SHOTS: "[['one', 2], ['two', 0.125], ['three', 1.875]]" }, 2.2, /^beat 0 at 2\.2 s falls 2 frames after the cut to three,/],
    [{ SHOTS: "[['one', 2], ['two', 2]]", CAMERA: "[{ at: 2.1, x: 640 }, { at: 2.1, x: 900 }]" }, 2.2, /^beat 0 at 2\.2 s falls 3 frames after the camera cut at 2\.1 s,/],
  ]) {
    await t.test(`a beat at ${at} s after ${JSON.stringify(fill)}`, () => {
      const error = framing(fill, at);
      assert.ok(error, 'refused');
      assert.match(error.message, message);
    });
  }
  const jolt = (two) => solve(scaffold(t, {
    SHOTS: `[['one', 2], ['two', ${two}], ['three', ${2 - two}]]`,
    FOCUS: "[{ shot: 'one', in: [600, 360], out: [600, 360] }, { shot: 'two', in: [600, 360], out: [100, 360] }, { shot: 'three', in: [1200, 360], out: [1200, 360], jolt: true }]",
  })).stages.error;
  await t.test('a jolt after a shot the eye has found', () => {
    assert.equal(jolt(0.25), null, 'two holds 6 frames');
    assert.equal(solve(scaffold(t, {
      SHOTS: "[['one', 0.125], ['two', 3.875]]",
      FOCUS: "[{ shot: 'one', in: [100, 360], out: [100, 360] }, { shot: 'two', in: [1200, 360], out: [1200, 360], jolt: true }]",
    })).stages.error, null, 'the film\'s first frame is not a cut');
  });
  await t.test('a jolt 3 frames after a cut', () => {
    const error = jolt(0.125);
    assert.ok(error, 'refused');
    assert.match(error.message, /^the jolt to three comes 3 frames after the cut to two, before the eye has found that shot: hold two 6 frames or more$/);
  });
  // A camera cut of the framing is a cut too: a jolt shot that starts within
  // its settle frames jumps an eye still finding the reframed shot.
  const reframed = (at) => solve(scaffold(t, {
    SHOTS: "[['one', 2], ['two', 2]]", CAMERA: `[{ at: ${at}, x: 640 }, { at: ${at}, x: 900 }]`,
    FOCUS: "[{ shot: 'one', in: [600, 360], out: [600, 360] }, { shot: 'two', in: [1200, 360], out: [1200, 360], jolt: true }]",
  })).stages.error;
  await t.test('a jolt after a camera cut', () => {
    assert.equal(reframed(1.75), null, 'the camera cut comes 6 frames before the jolt');
    const error = reframed(1.875);
    assert.ok(error, 'refused');
    assert.match(error.message, /^the jolt to two comes 3 frames after the camera cut at 1\.875 s, before the eye has found that shot: start two 6 frames or more after it$/);
  });
  // The mirror: a camera cut inside the jolt shot's own settle frames reframes
  // the eye while the jolt still lands.
  await t.test('a camera cut after a jolt', () => {
    assert.equal(reframed(2.25), null, 'the camera cut comes 6 frames after the jolt');
    const error = reframed(2.125);
    assert.ok(error, 'refused');
    assert.match(error.message, /^the camera cut at 2\.125 s comes 3 frames after the jolt to two, before the eye has found that shot: move the camera cut 6 frames or more after the jolt$/);
  });
  // A jolt shot shorter than its settle frames cuts away before the jolt lands.
  const brief = (two) => solve(scaffold(t, {
    SHOTS: `[['one', 2], ['two', ${two}], ['three', ${2 - two}]]`,
    FOCUS: "[{ shot: 'one', in: [100, 360], out: [100, 360] }, { shot: 'two', in: [1200, 360], out: [1200, 360], jolt: true }]",
  })).stages.error;
  await t.test('a cut after a brief jolt shot', () => {
    assert.equal(brief(0.25), null, 'the jolt shot holds 6 frames');
    const error = brief(0.1);
    assert.ok(error, 'refused');
    assert.match(error.message, /^the cut to three comes 2 frames after the jolt to two, before the eye has found that shot: hold two 6 frames or more$/);
  });
});

// A figure whose parts all key on the same frames moves as one stiff piece, and
// two parts with the same keys move as twins: the build warns of both.
test('the film scaffold warns when every keys track of an element shares its frames, or two tracks carry the same keys', async (t) => {
  const warned = (tracks) => {
    const warn = t.mock.method(console, 'warn', () => {});
    const { error } = solve(scaffold(t, { ELEMENTS: `[{ name: 'f', enter: 0, exit: DUR, keys: ${tracks} }]` })).stages;
    const said = warn.mock.calls.map((c) => c.arguments[0]);
    warn.mock.restore();
    return { error, said };
  };
  await t.test('parts on their own frames, and a part that never moves', () => {
    assert.deepEqual(warned('{ a: [[0, 0], [10, 1]], b: [[4, 0], [12, 1]], c: [[0, 1]] }'), { error: null, said: [] });
  });
  await t.test('every part on the same frames', () => {
    assert.deepEqual(warned('{ a: [[0, 0], [10, 1]], b: [[0, 0.5], [10, 0.2]] }').said,
      ['warning: every keys track of f keys on frames 0, 10, so its parts move as one stiff piece: offset some of them']);
  });
  await t.test('two parts with the same keys', () => {
    const twins = ['warning: the keys tracks a and c of f carry the same keys, so they move as twins: vary one in its frames, values or the rates of its moves'];
    assert.deepEqual(warned('{ a: [[0, 0], [10, 1]], b: [[3, 0], [12, 1]], c: [[0, 0], [10, 1, ease.linear]] }').said, twins);
    // The last key's rate, and that of a key cut on its frame, shape no move, so they leave twins twins.
    assert.deepEqual(warned('{ a: [[0, 0], [10, 1]], b: [[3, 0], [12, 1]], c: [[0, 0], [10, 1, ease.out]] }').said, twins, 'a rate on the last key');
    assert.deepEqual(warned('{ a: [[0, 0], [5, 1], [5, 0], [10, 1]], b: [[3, 0], [12, 1]], c: [[0, 0], [5, 1, ease.out], [5, 0], [10, 1]] }').said
      .filter((s) => s.includes('twins')), twins, 'a rate on a key cut on its frame');
  });
  await t.test('two parts that differ only in the rate of a key that starts a hold', () => {
    // lerp(v, v, rate(u)) is v, so a rate on a key followed by its own value shapes nothing.
    assert.deepEqual(warned('{ a: [[0, 1], [10, 1], [20, 0]], b: [[3, 0], [12, 1]], c: [[0, 1, ease.out], [10, 1], [20, 0]] }').said,
      ['warning: the keys tracks a and c of f carry the same keys, so they move as twins: vary one in its frames, values or the rates of its moves']);
  });
  await t.test('two parts that differ only in the rate of a move', () => {
    assert.deepEqual(warned('{ a: [[0, 0], [10, 1]], b: [[3, 0], [12, 1]], c: [[0, 0, ease.out], [10, 1]] }'), { error: null, said: [] });
  });
  for (const [tracks, message] of [
    ["{ a: [[5, 0], [1, 1]] }", /^element f's keys track a: keys: entry 1 at 1 comes before entry 0 at 5/],
    ["{ a: 'up' }", /^element f's keys track a: keys: needs a non-empty list/],
  ]) {
    await t.test(`a track that is not keys: ${tracks}`, () => {
      const { error } = warned(tracks);
      assert.ok(error, 'refused');
      assert.match(error.message, message);
    });
  }
});

// THE TEMPO retimes keys as it retimes beats and sounds, and all three round to
// whole frames: a switch written on the beat's frame shows on the beat's frame.
// Under b: 0.7, table frame 60 (2.5 s) retimes to 56.4; unrounded, keys() would
// show the switch from frame 57, one after its beat and sound on frame 56.
test('the film scaffold rounds retimed keys to a whole frame as it rounds beats and sounds, and refuses two keys that round to one frame', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const piece = scaffold(t, {
    SHOTS: "[['a', 2], ['b', 2]]",
    TEMPO: '{ b: 0.7 }',
    ELEMENTS: "[{ name: 'lamp', enter: 0, exit: DUR, keys: { level: [[0, 0.2], [60, 0.2], [60, 1], [80, 0.9]] } }]",
    BEATS: "[{ at: 2.5, intensity: 1, element: 'lamp', changes: 'lit' }]",
    SOUNDS: "[{ at: 2.5, cause: 'lamp', voice: { pitch: 220 } }]",
    PAINT: '{ lamp: (g, s, e, life, clock) => g.fillRect(-1, keys(e.keys.level)(clock.frame), 0, 0) }',
  });
  const solved = solve(piece);
  const said = warn.mock.calls.map((c) => c.arguments[0]);
  warn.mock.restore();
  assert.equal(solved.stages.error, null);
  const { cues } = solved.state;
  assert.deepEqual(cues.elements[0].keys.level.map(([f]) => f), [0, 56, 56, 70]);
  assert.deepEqual([cues.beats[0].frame, cues.sounds[0].frame], [56, 56]);
  assert.deepEqual(said, []);
  const frames = Math.round(piece.time.duration * piece.time.hz);
  const level = (f) => {
    const calls = [];
    drawFrame(surface(calls), piece, solved, f / (frames - 1));
    return calls.filter(([k, x]) => k === 'fillRect' && x === -1).map(([, , y]) => y);
  };
  assert.deepEqual([level(55), level(56)], [[0.2], [1]], 'the switch shows on its beat frame');
  const refused = (tempo, track) => solve(scaffold(t, { SHOTS: "[['a', 2], ['b', 2]]", TEMPO: tempo, ELEMENTS: `[{ name: 'lamp', enter: 0, exit: DUR, keys: { level: ${track} } }]` })).stages.error?.message;
  assert.equal(refused('{ b: 0.3 }', '[[60, 0], [61, 1]]'),
    "element lamp's keys track level has keys 0 and 1 on frames 60 and 61, which land on one frame, 52: that cuts the track; move them a frame or more apart on the retimed film, or give both one frame to cut on purpose");
  assert.equal(refused('{}', '[[50.2, 0], [50.4, 1]]'),
    "element lamp's keys track level has keys 0 and 1 on frames 50.2 and 50.4, which land on one frame, 50: that cuts the track; move them a frame or more apart, or give both one frame to cut on purpose");
});

// A switch is two keys on one frame; the viewer should see and hear it change,
// so a cut with neither a beat on its row nor a sound its row causes is warned of.
test('the film scaffold warns when a cut in a row\'s keys has neither a beat on the row nor a sound the row causes on its frame', async (t) => {
  const warned = (fill) => {
    const warn = t.mock.method(console, 'warn', () => {});
    const { error } = solve(scaffold(t, { BEATS: '[]', SOUNDS: '[]', ...fill,
      ELEMENTS: fill.ELEMENTS ?? "[{ name: 'lamp', enter: 0, exit: DUR, keys: { level: [[0, 0.2], [60, 0.2], [60, 1], [90, 0.9]] } }, { name: 'other', enter: 0, exit: DUR }]" })).stages;
    const said = warn.mock.calls.map((c) => c.arguments[0]);
    warn.mock.restore();
    assert.equal(error, null);
    return said;
  };
  const warning = ['warning: the keys track level of lamp cuts on frame 60 with neither a beat on lamp nor a sound it causes on that frame: put the switch\'s beat or sound on frame 60, or move the cut'];
  assert.deepEqual(warned({}), warning, 'no beat or sound');
  assert.deepEqual(warned({ SOUNDS: "[{ at: 2.5, cause: 'lamp', voice: { pitch: 220 } }]" }), [], 'the row\'s sound on the frame');
  assert.deepEqual(warned({ BEATS: "[{ at: 2.5, intensity: 1, element: 'lamp', changes: 'lit' }]" }), [], 'a beat on the row on the frame');
  assert.deepEqual(warned({ SOUNDS: "[{ at: 2.5, cause: 'other', voice: { pitch: 220 } }]" }), warning, 'a sound another row causes');
  assert.deepEqual(warned({ SOUNDS: "[{ at: 2.55, cause: 'lamp', voice: { pitch: 220 } }]" }), warning, 'the row\'s sound a frame late');
});

// The keys warnings read the keys as they play: rounded to whole frames, a cut
// counted only where the value before it was seen, and once for each frame.
test('the film scaffold warns of keys as they play: rounded frames, a cut whose earlier value was seen, once a frame', async (t) => {
  const run = (fill) => {
    const warn = t.mock.method(console, 'warn', () => {});
    const { error } = solve(scaffold(t, { BEATS: '[]', SOUNDS: '[]', ...fill })).stages;
    const said = warn.mock.calls.map((c) => c.arguments[0]);
    warn.mock.restore();
    return { error: error?.message ?? null, said };
  };
  const lamp = (keys, more = '') => ({ ELEMENTS: `[{ name: 'lamp', enter: 0, exit: DUR${more}, keys: ${keys} }]` });
  assert.deepEqual(run(lamp('{ a: [[10, 0], [40, 1]], b: [[10.2, 0], [40.3, 1]], c: [[3, 0], [20, 1]] }')),
    { error: null, said: ['warning: the keys tracks a and b of lamp carry the same keys, so they move as twins: vary one in its frames, values or the rates of its moves'] }, 'twins once rounded');
  assert.deepEqual(run(lamp('{ a: [[10, 0], [40, 1]], b: [[10.2, 0.5], [40.3, 0.2]] }')),
    { error: null, said: ['warning: every keys track of lamp keys on frames 10, 40, so its parts move as one stiff piece: offset some of them'] }, 'one stiff piece once rounded');
  assert.deepEqual(run(lamp('{ level: [[0, 0.2], [60, 0.2], [60, 1], [60, 0.5], [90, 0.9]] }')),
    { error: null, said: ['warning: the keys track level of lamp cuts on frame 60 with neither a beat on lamp nor a sound it causes on that frame: put the switch\'s beat or sound on frame 60, or move the cut'] }, 'three keys on one frame');
  assert.deepEqual(run(lamp('{ level: [[0.2, 0], [0.4, 1]] }')),
    { error: "element lamp's keys track level has keys 0 and 1 on frames 0.2 and 0.4, which land on one frame, 0: that cuts the track; move them a frame or more apart, or give both one frame to cut on purpose", said: [] }, 'two keys rounding to frame 0');
  // Written on one frame before the film: the first never plays.
  for (const [track, from] of [['[[-2.4, 0], [-2.2, 1], [30, 0.5]]', '-2.4 and -2.2'], ['[[-2, 0], [-2, 1], [30, 0.5]]', '-2 and -2']]) {
    assert.deepEqual(run(lamp(`{ level: ${track} }`)),
      { error: `element lamp's keys track level has keys 0 and 1 on frames ${from}, which land on one frame, -2: that frame comes before the film starts, so the first of them never plays; move them a frame or more apart`, said: [] }, `two keys on frames ${from}`);
  }
});

// A cut on the first frame a row is seen on is never seen as a switch: one rule
// on frame 0, the row's enter frame and its shot's first frame. A row returning
// in a later shot with a changed value is a shot change, so it is not warned of.
test('the film scaffold warns of a cut on the first frame a row is seen on, frame 0 included, and not on a row returning in a later shot', async (t) => {
  const run = (fill) => {
    const warn = t.mock.method(console, 'warn', () => {});
    const { error } = solve(scaffold(t, { BEATS: '[]', SOUNDS: '[]', ...fill })).stages;
    const said = warn.mock.calls.map((c) => c.arguments[0]);
    warn.mock.restore();
    return { error: error?.message ?? null, said };
  };
  const unseen = (f) => ({ error: null, said: [`warning: the keys track level of lamp cuts on frame ${f}, the first frame it is seen on, so the switch is never seen: move the cut to a frame after one it is seen on, or drop the key the cut leaves`] });
  assert.deepEqual(run({ ELEMENTS: "[{ name: 'lamp', enter: 0, exit: DUR, keys: { level: [[0, 0.2], [0, 1], [90, 0.9]] } }]" }), unseen(0), 'a cut on frame 0');
  assert.deepEqual(run({ ELEMENTS: "[{ name: 'lamp', enter: 2.5, exit: DUR, keys: { level: [[60, 0], [60, 1], [90, 0.9]] } }]" }), unseen(60), 'a cut on the row\'s enter frame');
  assert.deepEqual(run({ SHOTS: "[['a', 2], ['b', 2]]", ELEMENTS: "[{ name: 'lamp', enter: 0, exit: DUR, shots: ['b'], keys: { level: [[48, 0], [48, 1], [80, 0.9]] } }]" }),
    unseen(48), 'a cut on the first frame of the row\'s shot');
  assert.deepEqual(run({ ELEMENTS: "[{ name: 'lamp', enter: 2.5, exit: DUR, keys: { level: [[0, 0.2], [0, 1], [90, 0.9]] } }]" }),
    { error: null, said: [] }, 'a cut on frame 0 of a row not yet seen');
  assert.deepEqual(run({ DUR: '6', SHOTS: "[['a', 2], ['b', 2], ['c', 2]]", ELEMENTS: "[{ name: 'lamp', enter: 0, exit: DUR, shots: ['a', 'c'], keys: { level: [[0, 0.2], [96, 0.2], [96, 1], [130, 0.9]] } }]" }),
    { error: null, said: [] }, 'a cut on the first frame of a later shot of a row seen in an earlier one');
});

// Two rows of one name that follow each other within a shot (a layer change)
// are one thing on screen: the warnings judge the name, not the row.
test('the film scaffold judges a keys cut across a layer change by name, not by row', async (t) => {
  const run = (rows, fill = {}) => {
    const warn = t.mock.method(console, 'warn', () => {});
    const { error } = solve(scaffold(t, { BEATS: '[]', SOUNDS: '[]', ELEMENTS: `[${rows}]`, ...fill })).stages;
    const said = warn.mock.calls.map((c) => c.arguments[0]);
    warn.mock.restore();
    return { error: error?.message ?? null, said };
  };
  const cut = { error: null, said: ['warning: the keys track level of lamp cuts on frame 48 with neither a beat on lamp nor a sound it causes on that frame: put the switch\'s beat or sound on frame 48, or move the cut'] };
  const front = (level) => `{ name: 'lamp', enter: 0, exit: 2, keys: { level: [[0, 0.2], [40, ${level}]] } }`;
  await t.test('a cut on the frame the second row takes over is a seen switch', () => {
    assert.deepEqual(run(`${front(0.5)}, { name: 'lamp', enter: 2, exit: DUR, keys: { level: [[48, 0.5], [48, 1], [80, 0.9]] } }`), cut);
  });
  await t.test('a cut on the frame the second row takes over that shows the carried value draws no warning', () => {
    assert.deepEqual(run(`${front(0.5)}, { name: 'lamp', enter: 2, exit: DUR, keys: { level: [[48, 0.9], [48, 0.5], [80, 0.9]] } }`), { error: null, said: [] });
  });
  await t.test('a value that jumps between the rows on that frame is a cut', () => {
    assert.deepEqual(run(`${front(0.5)}, { name: 'lamp', enter: 2, exit: DUR, keys: { level: [[60, 1], [80, 0.9]] } }`), cut);
    assert.deepEqual(run(`${front(0.5)}, { name: 'lamp', enter: 2, exit: DUR, keys: { level: [[60, 1], [80, 0.9]] } }`, { SOUNDS: "[{ at: 2, cause: 'lamp', voice: { pitch: 220 } }]" }),
      { error: null, said: [] }, 'with the name\'s sound on the frame');
  });
  await t.test('a value that carries over draws no warning', () => {
    assert.deepEqual(run(`${front(0.5)}, { name: 'lamp', enter: 2, exit: DUR, keys: { level: [[48, 0.5], [80, 0.9]] } }`), { error: null, said: [] });
    const ramp = "keys: { level: [[0, 0], [96, 1]] }";
    assert.deepEqual(run(`{ name: 'lamp', enter: 0, exit: 2, ${ramp} }, { name: 'lamp', enter: 2, exit: DUR, ${ramp} }`), { error: null, said: [] },
      'a ramp both rows carry across the takeover');
  });
  await t.test('a hand-over value equal but for float rounding draws no warning', () => {
    const early = "{ name: 'lamp', enter: 0, exit: 2, keys: { level: [[0, 0], [72, 0.3]] } }";
    assert.deepEqual(run(`${early}, { name: 'lamp', enter: 2, exit: DUR, keys: { level: [[48, 0.2], [80, 0.9]] } }`), { error: null, said: [] },
      'a ramp split at the takeover with the hand-over value written');
    assert.deepEqual(run(`${early}, { name: 'lamp', enter: 2, exit: DUR, keys: { level: [[24, 0.1], [96, 0.4]] } }`), { error: null, said: [] },
      'a ramp moving on across the takeover');
  });
  await t.test('an earlier row\'s cut on its exit frame is never seen, so the takeover compares the value before it', () => {
    const early = "{ name: 'lamp', enter: 0, exit: 2, keys: { level: [[0, 0.2], [48, 0.5], [48, 1]] } }";
    assert.deepEqual(run(`${early}, { name: 'lamp', enter: 2, exit: DUR, keys: { level: [[48, 1], [80, 0.9]] } }`), cut, 'the next row shows the value after the cut');
    assert.deepEqual(run(`${early}, { name: 'lamp', enter: 2, exit: DUR, keys: { level: [[48, 0.5], [80, 0.9]] } }`), { error: null, said: [] },
      'the next row carries the value before the cut');
  });
  await t.test('every cut is judged by the values shown before and after it', () => {
    assert.deepEqual(run("{ name: 'lamp', enter: 0, exit: 2 }, { name: 'lamp', enter: 2, exit: DUR, keys: { level: [[48, 0], [48, 1], [80, 0.9]] } }"), { error: null, said: [] },
      'the earlier row keys no level, so no value is seen to switch on the takeover');
    assert.deepEqual(run("{ name: 'lamp', enter: 0, exit: DUR, keys: { level: [[0, 0.2], [48, 0.5], [48, 0.5], [80, 0.9]] } }"), { error: null, said: [] },
      'two keys on one frame with one value cut nothing');
    assert.deepEqual(run("{ name: 'lamp', enter: 0, exit: DUR, keys: { level: [[0, 0.2], [48, 0.5], [48, 1], [48, 0.5], [80, 0.9]] } }"), { error: null, said: [] },
      'three keys on one frame that leave on the value they arrived on cut nothing');
    // A ramp of 0.3 over 72 frames, split a third of a frame's step off its line: the motion going on.
    const early = "{ name: 'lamp', enter: 0, exit: 2, keys: { level: [[0, 0], [72, 0.3]] } }";
    assert.deepEqual(run(`${early}, { name: 'lamp', enter: 2, exit: DUR, keys: { level: [[48, 0.2015], [80, 0.9]] } }`), { error: null, said: [] });
    assert.deepEqual(run(`${early}, { name: 'lamp', enter: 2, exit: DUR, keys: { level: [[48, 0.21], [80, 0.9]] } }`), cut, 'two frames\' worth off the line is a switch');
  });
  await t.test('a cut on a shot\'s first frame after a row of its name is a shot change', () => {
    const shots = { DUR: '6', SHOTS: "[['a', 2], ['b', 2], ['c', 2]]" };
    assert.deepEqual(run("{ name: 'lamp', enter: 0, exit: DUR, shots: ['a', 'c'], keys: { level: [[0, 0.2], [96, 0.2], [96, 1], [130, 0.9]] } }, { name: 'lamp', enter: 0, exit: DUR, shots: ['b'] }", shots),
      { error: null, said: [] }, 'the row returns after another of its name');
    assert.deepEqual(run("{ name: 'lamp', enter: 0, exit: 2 }, { name: 'lamp', enter: 2, exit: DUR, keys: { level: [[48, 0], [48, 1], [80, 0.9]] } }", shots),
      { error: null, said: [] }, 'a takeover with a cut on the shot\'s first frame');
  });
  await t.test('a row entering after its name has left the screen cuts on a frame never seen', () => {
    assert.deepEqual(run("{ name: 'lamp', enter: 0, exit: 1 }, { name: 'lamp', enter: 2.5, exit: DUR, keys: { level: [[60, 0], [60, 1], [90, 0.9]] } }"),
      { error: null, said: ['warning: the keys track level of lamp cuts on frame 60, the first frame it is seen on, so the switch is never seen: move the cut to a frame after one it is seen on, or drop the key the cut leaves'] });
  });
});

// Music sits under the caused sounds and comes forward only on a beat marked
// forward; a beat takes one sting at most. The build warns of both.
test('the film scaffold warns when music is not quieter than a caused voice it plays with, or a beat carries more than one sting', async (t) => {
  const warned = (sounds, beats = '[]') => {
    const warn = t.mock.method(console, 'warn', () => {});
    const { error } = solve(scaffold(t, { ELEMENTS: "[{ name: 'door', enter: 0, exit: DUR }]", BEATS: beats, SOUNDS: sounds })).stages;
    const said = warn.mock.calls.map((c) => c.arguments[0]);
    warn.mock.restore();
    return { error, said };
  };
  const door = "{ at: 1, cause: 'door', voice: { pitch: 220, strike: { level: 0.5 }, level: 0.6 } }";
  const beat = (more = '') => `[{ at: 1, intensity: 0.9, element: 'door', changes: 'opens'${more} }]`;
  await t.test('music held under the door, and a music row on a beat marked forward', () => {
    assert.deepEqual(warned(`[{ at: 0, cause: 'first', role: 'music', voice: { pitch: 110, hold: 3, level: 0.3 } }, ${door}]`), { error: null, said: [] });
    assert.deepEqual(warned(`[{ at: 1, cause: 'first', role: 'music', voice: { pitch: 110, level: 0.9 } }, ${door}]`, beat(', forward: true')), { error: null, said: [] });
  });
  await t.test('music as loud as the door', () => {
    assert.deepEqual(warned(`[{ at: 0, cause: 'first', role: 'music', voice: { pitch: 110, hold: 3, level: 0.6 } }, ${door}]`).said,
      ['warning: the music at 0 s (first) is not quieter than the sound at 1 s (door) it plays with: lower the music, or bring it forward only on a beat marked forward and drop it back after']);
  });
  await t.test('music as loud as the door, keyed down by its gain before the door', () => {
    assert.deepEqual(warned(`[{ at: 0, cause: 'first', role: 'music', voice: { pitch: 110, hold: 3, level: 0.6 }, gain: [[0.5, 1], [0.9, 0.2], [2, 0.2]] }, ${door}]`).said, []);
  });
  await t.test('a door its gain keys silence, under quiet music', () => {
    assert.deepEqual(warned(`[{ at: 0, cause: 'first', role: 'music', voice: { pitch: 110, hold: 3, level: 0.3 } }, { at: 1, cause: 'door', voice: { pitch: 220, level: 0.6 }, gain: [[0, 0]] }]`).said, []);
  });
  await t.test('music held loud past a beat marked forward over a later voice', () => {
    const later = "{ at: 3.5, cause: 'door', voice: { pitch: 220, level: 0.3 } }";
    assert.deepEqual(warned(`[{ at: 1, cause: 'first', role: 'music', voice: { pitch: 110, hold: 3, level: 0.9 } }, ${door}, ${later}]`, beat(', forward: true')).said,
      ['warning: the music at 1 s (first) is not quieter than the sound at 3.5 s (door) it plays with: lower the music, or bring it forward only on a beat marked forward and drop it back after']);
  });
  await t.test('off-screen music and an off-screen voice with no cause', () => {
    const away = (at, level, role = '') => `{ at: ${at},${role} voice: { pitch: 110, hold: 3, level: ${level} }, offscreen: { side: 'left', distance: 0 } }`;
    assert.deepEqual(warned(`[${away(0, 0.6, " role: 'music',")}, ${door}]`).said,
      ['warning: the music at 0 s (no cause) is not quieter than the sound at 1 s (door) it plays with: lower the music, or bring it forward only on a beat marked forward and drop it back after']);
    assert.deepEqual(warned(`[{ at: 0, cause: 'first', role: 'music', voice: { pitch: 110, hold: 3, level: 0.6 } }, ${away(1, 0.3)}]`).said,
      ['warning: the music at 0 s (first) is not quieter than the sound at 1 s (no cause) it plays with: lower the music, or bring it forward only on a beat marked forward and drop it back after']);
  });
  await t.test('music forward on a beat not marked forward', () => {
    assert.equal(warned(`[{ at: 1, cause: 'first', role: 'music', voice: { pitch: 110, level: 0.9 } }, ${door}]`, beat()).said.length, 1);
  });
  await t.test('music that has died away before the door', () => {
    assert.deepEqual(warned(`[{ at: 0, cause: 'first', role: 'music', voice: { pitch: 110, decay: 0.5, level: 0.9 } }, ${door}]`).said, []);
  });
  await t.test('music judged as loud as it still is when the voice starts', () => {
    // A 2 s decay is 30 dB down at 1 s: 0.019, above -60 dB, far under the door
    // but over a voice at 0.01.
    const music = "{ at: 0, cause: 'first', role: 'music', voice: { pitch: 110, decay: 2, level: 0.6 } }";
    assert.deepEqual(warned(`[${music}, ${door}]`).said, []);
    assert.deepEqual(warned(`[${music}, { at: 1, cause: 'door', voice: { pitch: 220, level: 0.01 } }]`).said,
      ['warning: the music at 0 s (first) is not quieter than the sound at 1 s (door) it plays with: lower the music, or bring it forward only on a beat marked forward and drop it back after']);
  });
  await t.test('a caused voice started at velocity 0, which is silent', () => {
    assert.deepEqual(warned(`[{ at: 0, cause: 'first', role: 'music', voice: { pitch: 110, hold: 3, level: 0.3 } }, { at: 1, cause: 'door', voice: { pitch: 220, velocity: 0 } }]`).said, []);
  });
  await t.test("an ambience bed read by its stereo power, as a voice's level is, at the top of its wander", () => {
    // Its own noise at RMS 0.21 on each side has the power of a centred sine of
    // peak 0.42, louder than a voice at 0.4; at 0.19, of 0.38. At the default
    // drift of 0.5 each side wanders up to 10 ** 0.15 louder: 0.15 reaches 0.424
    // and 0.14 0.396.
    const bed = (level, drift) => `[{ at: 0, cause: 'first', role: 'music', ambience: { length: 3, level: ${level}${drift} } }, { at: 1, cause: 'door', voice: { pitch: 220, level: 0.4 } }]`;
    assert.equal(warned(bed(0.21, ', drift: 0')).said.length, 1);
    assert.deepEqual(warned(bed(0.19, ', drift: 0')).said, []);
    assert.equal(warned(bed(0.15, '')).said.length, 1);
    assert.deepEqual(warned(bed(0.14, '')).said, []);
  });
  await t.test('an ambience read through the fade at each end, at the level it still has', () => {
    // A bed of peak 0.2 is 17 dB down, 0.029, a quarter of the way through its
    // 1 s fades, under a voice at 0.1, and at full level between them.
    const bed = (at, voice = 0.1, fade = '') => `[{ at: 0, cause: 'first', role: 'music', ambience: { length: 3, level: 0.1, drift: 0${fade} } }, { at: ${at}, cause: 'door', voice: { pitch: 220, level: ${voice} } }]`;
    assert.deepEqual(warned(bed(0.25)).said, []);
    assert.deepEqual(warned(bed(2.75)).said, []);
    assert.equal(warned(bed(1)).said.length, 1);
    // Over a 0.1 s fade the bed is at its full 0.2 by 0.25 s, over a voice at 0.1.
    assert.equal(warned(bed(0.25, 0.1, ', fade: 0.1')).said.length, 1);
    // The raised cosine's 0.029 sits under a voice at 0.04, where a linear
    // ramp's 0.05 would not.
    assert.deepEqual(warned(bed(0.25, 0.04)).said, []);
  });
  await t.test('an ambience rising over a voice still held, judged on each frame of its attack and hold', () => {
    // A voice at 0.15 held 2 s from 0.125 s is under the bed once it passes 0.15
    // at 0.67 s; held 0.25 s it ends at 0.375 s, where the bed is 0.062.
    const held = (hold) => `[{ at: 0, cause: 'first', role: 'music', ambience: { length: 3, level: 0.1, drift: 0 } }, { at: 0.125, cause: 'door', voice: { pitch: 220, level: 0.15, hold: ${hold} } }]`;
    assert.equal(warned(held(2)).said.length, 1);
    assert.deepEqual(warned(held(0.25)).said, []);
  });
  await t.test("a music voice's tail falls from the voice's start, not after its attack", () => {
    // A 1.5 s tail at 0.5 is 0.2 at 0.2 s and 0.0008 at 1.4 s, around a voice at 0.05.
    const music = "{ at: 0, cause: 'first', role: 'music', voice: { pitch: 110, attack: 1, decay: 0.01, partials: [[1, 0.0001]], tail: { level: 0.5, length: 1.5 } } }";
    const voice = (at) => `[${music}, { at: ${at}, cause: 'door', voice: { pitch: 220, level: 0.05 } }]`;
    assert.equal(warned(voice(0.25)).said.length, 1);
    assert.deepEqual(warned(voice(1.375)).said, []);
  });
  await t.test("an ambience's grains heard at their documented peak, under grains.level, against a voice", () => {
    // grains.level 0.05 against a voice at 0.03: a 200 ms grain peaks near its
    // level; a 3 ms one 16 dB under it; and a 20 ms one at 60 Hz, whose quarter
    // cycle outlasts the envelope's peak, 9 dB under it.
    const grains = (length, more = '') => `[{ at: 0, cause: 'first', role: 'music', ambience: { length: 3, level: 0, ${more}grains: { rate: 50, length: ${length}, level: 0.05 } } }, { at: 1, cause: 'door', voice: { pitch: 220, level: 0.03 } }]`;
    assert.equal(warned(grains(0.2)).said.length, 1);
    assert.deepEqual(warned(grains(0.003)).said, []);
    assert.equal(warned(grains(0.02)).said.length, 1);
    assert.deepEqual(warned(grains(0.02, 'colour: 60, band: 0.1, drift: 0, ')).said, []);
  });
  await t.test("an ambience's loudest grain found across its band and at a negative crest", () => {
    // 20 ms grains at 0.05: from 125 to 500 Hz, the 250 Hz crest meets the
    // envelope's peak at 1 ms, 0.035, though the top pitch reaches 0.030; at
    // 500 Hz alone the crest at 1.5 ms is negative, 0.030, its positive ones 0.023.
    const grains = (more, voice) => `[{ at: 0, cause: 'first', role: 'music', ambience: { length: 3, level: 0, drift: 0, ${more}, grains: { rate: 50, level: 0.05, spread: 0 } } }, { at: 1, cause: 'door', voice: { pitch: 220, level: ${voice} } }]`;
    assert.equal(warned(grains('colour: 250, band: 2', 0.032)).said.length, 1);
    assert.equal(warned(grains('colour: 500, band: 0.01', 0.026)).said.length, 1);
    assert.deepEqual(warned(grains('colour: 500, band: 0.01', 0.031)).said, []);
  });
  await t.test('noise grains heard by their power, which their rise and fall alone shape at any pitch', () => {
    // At 0.05, a 1 ms grain peaks at 0.0027 as noise, 19 dB over the 0.0003 a
    // sine from 0 reaches at 80 Hz; a 20 ms one at 60 Hz at 0.035, where the
    // sine reaches 0.018.
    const grains = (colour, length, noise, voice) => `[{ at: 0, cause: 'first', role: 'music', ambience: { length: 3, level: 0, drift: 0, band: 0.01, colour: ${colour}, grains: { rate: 50, length: ${length}, level: 0.05, spread: 0${noise} } } }, { at: 1, cause: 'door', voice: { pitch: 220, level: ${voice} } }]`;
    assert.equal(warned(grains(80, 0.001, ', noise: true', 0.002)).said.length, 1);
    assert.deepEqual(warned(grains(80, 0.001, '', 0.002)).said, []);
    assert.deepEqual(warned(grains(80, 0.001, ', noise: true', 0.003)).said, []);
    assert.equal(warned(grains(60, 0.02, ', noise: true', 0.03)).said.length, 1);
    assert.deepEqual(warned(grains(60, 0.02, ', noise: false', 0.03)).said, []);
  });
  await t.test('two stings on one beat', () => {
    const sting = (at) => `{ at: ${at}, cause: 'first', role: 'sting', voice: { pitch: 880, decay: 0.3, level: 0.2 } }`;
    assert.deepEqual(warned(`[${door}, ${sting(1)}]`, beat()).said, []);
    assert.deepEqual(warned(`[${door}, ${sting(1)}, ${sting(1.125)}]`, beat()).said, ['warning: beat 0 at 1 s carries 2 stings, at 1 s, 1.125 s: keep one']);
  });
  await t.test('a sting louder than the hit it answers, and one under it', () => {
    const sting = (level) => `{ at: 1, cause: 'first', role: 'sting', voice: { pitch: 880, decay: 0.3, level: ${level} } }`;
    assert.deepEqual(warned(`[${door}, ${sting(0.9)}]`, beat()).said,
      ['warning: the sting at 1 s (first) is not quieter than the sound at 1 s (door) it plays with: lower the sting, or bring it forward only on a beat marked forward and drop it back after']);
    assert.deepEqual(warned(`[${door}, ${sting(0.2)}]`, beat()).said, []);
  });
  await t.test('a loud sting that starts after the hit\'s attack and hold', () => {
    const sting = (at) => `{ at: ${at}, cause: 'first', role: 'sting', voice: { pitch: 880, decay: 0.3, level: 0.7 } }`;
    assert.deepEqual(warned(`[${door}, ${sting(1.2)}]`).said, []);
    assert.deepEqual(warned(`[${door}, ${sting(1.5)}]`).said, []);
  });
  await t.test('a role that is not music or sting', () => {
    const { error } = warned("[{ at: 1, cause: 'first', role: 'score', voice: { pitch: 110 } }]");
    assert.ok(error, 'refused');
    assert.match(error.message, /^the sound at 1 s takes a role of 'music' or 'sting', or none, got score$/);
  });
  await t.test('a role of null, which is none', () => {
    assert.deepEqual(warned("[{ at: 1, cause: 'first', role: null, voice: { pitch: 110 } }]"), { error: null, said: [] });
  });
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

test('voice without pan points, tail.rise, fm or highpass renders the bytes it did', () => {
  const hash = require('node:crypto').createHash('sha256');
  const spec = { ...layered, sweep: [[0, 300], [0.4, 5000]], distance: 0.3, vary: 0.5 };
  const { record } = built(spec);
  hash.update(JSON.stringify(graph(record)));
  for (const n of record.nodes) if (n.buffer) hash.update(n.buffer.getChannelData(0));
  // Computed before pan points, tail.rise, fm and highpass existed: a default voice must not change by a bit.
  // Recomputed once when the low-pass Q became -3.01 dB (Butterworth); only that Q changed.
  assert.equal(hash.digest('hex'), '9dd8857801df580aef6102a7c1a3d3c990d00ea30833119478abb4084037d465');
  assert.deepEqual(graph(built({ ...spec, fm: undefined, highpass: undefined }).record), graph(record), 'fm and highpass left out add nothing');
  assert.deepEqual(graph(built({ ...spec, fm: { index: 0, ratio: 3 } }).record), graph(record), 'fm at index 0 adds nothing');
});

test('voice pan points move it across the field, and tail.rise swells the tail before it falls', () => {
  const { record, out } = built({ ...layered, pan: [[0, -0.8], [1.5, 0.6], [3, 0.2]] });
  assert.equal(out.pan.value, -0.8, 'the voice starts at its first point');
  assert.deepEqual(out.pan.events, [['setValueAtTime', -0.8, 0.5], ['linearRampToValueAtTime', -0.8, 0.5],
    ['linearRampToValueAtTime', 0.6, 2], ['linearRampToValueAtTime', 0.2, 3.5]], 'the pan glides from point to point after the voice starts');
  for (const [t, k] of arrivals(record)) assert.ok(k <= 2, `a ${t.kind} takes ${k} inputs`);
  assert.deepEqual(built({ ...layered, pan: 0.4 }).out.pan.events, [], 'a single pan schedules nothing');

  const tailOf = (tail) => built({ ...layered, tail }).record.nodes.filter((n) => n.kind === 'bufferSource')[1].buffer.getChannelData(0);
  const swell = tailOf({ level: 0.1, length: 1, rise: 2 });
  assert.equal(swell.length, Math.ceil((2 + 1 + 0.08) * RATE), 'the fall follows the rise');
  const rms = (from, to) => Math.sqrt(swell.slice(from * RATE, to * RATE).reduce((s, v) => s + v * v, 0) / ((to - from) * RATE));
  assert.ok(rms(0, 0.5) < rms(1.5, 2) / 2, 'the tail swells over its rise');
  assert.ok(rms(2.8, 3) < rms(1.8, 2) / 30, 'the tail falls to -60 dB over its length after the rise');
  assert.equal(swell[0], 0, 'the swell rises from silence');
  assert.ok(Math.abs(swell[swell.length - 1]) < 1e-6, 'the swell fades to nothing');

  const { Context } = fakeAudio();
  const ctx = new Context(2, RATE, RATE);
  for (const [spec, message] of [
    [{ pan: [] }, /voice x: pan must be a list/],
    [{ pan: [[0, 1.5]] }, /voice x: pan value/],
    [{ pan: [[1, 0], [0.5, 0]] }, /voice x: pan time/],
    [{ tail: { level: 1, rise: 0 } }, /voice x: tail.rise/],
  ]) assert.throws(() => voice(ctx, rng(1), 'x', 0, { pitch: 440, ...spec }), message);
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
  // Web Audio reads a low-pass Q in dB: -3.01 dB is Butterworth, flat to the corner with no bump under it.
  for (const f of lows) assert.ok(Math.abs(f.Q.value - 20 * Math.log10(Math.SQRT1_2)) < 1e-9, `a low-pass Q of ${f.Q.value} is not Butterworth in dB`);
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

// The recorded graph cannot be heard, so `hear` plays the node kinds a voice
// builds as Web Audio defines them, mono, one sample at a time: an
// oscillator's frequency is (value + inputs) x 2^((detune + inputs) / 1200),
// integrated into its phase from its start; a biquad is the Audio EQ cookbook,
// reading a low- or high-pass Q in dB and a band-pass Q as a ratio; a panner
// passes its input. `tone` is the windowed amplitude at one frequency.
const hear = (record, out, seconds) => {
  const n = Math.round(seconds * RATE);
  const from = new Map();
  for (const m of record.nodes) for (const t of m.to) from.set(t, [...(from.get(t) || []), m]);
  const heard = new Map();
  const value = (p, t) => {
    let v = p.value, t0 = 0;
    for (const [kind, x, when] of p.events) {
      if (when > t) {
        if (kind === 'linearRampToValueAtTime') return v + ((x - v) * (t - t0)) / (when - t0);
        if (kind === 'exponentialRampToValueAtTime') return v * (x / v) ** ((t - t0) / (when - t0));
        return v;
      }
      [v, t0] = [x, when];
    }
    return v;
  };
  const sum = (target) => {
    const parts = (from.get(target) || []).map(play);
    return Float64Array.from({ length: n }, (_, i) => parts.reduce((s, x) => s + x[i], 0));
  };
  const param = (p) => { const extra = sum(p); return (i) => value(p, i / RATE) + extra[i]; };
  const play = (node) => {
    if (heard.has(node)) return heard.get(node);
    const y = new Float64Array(n);
    if (node.kind === 'oscillator') {
      const [f, d] = [param(node.frequency), param(node.detune)];
      let phase = 0;
      for (let i = Math.ceil(node.at * RATE); i < n && (node.end === null || i < node.end * RATE); i++) {
        y[i] = Math.sin(phase);
        phase += (2 * Math.PI * f(i) * 2 ** (d(i) / 1200)) / RATE;
      }
    } else if (node.kind === 'bufferSource') {
      const data = node.buffer.getChannelData(0);
      for (let i = Math.ceil(node.at * RATE), j = 0; i < n && j < data.length; i++, j++) y[i] = data[j];
    } else if (node.kind === 'gain') {
      const [x, g] = [sum(node), param(node.gain)];
      for (let i = 0; i < n; i++) y[i] = x[i] * g(i);
    } else if (node.kind === 'biquadFilter') {
      const [x, f, q] = [sum(node), param(node.frequency), param(node.Q)];
      let [x1, x2, y1, y2] = [0, 0, 0, 0];
      for (let i = 0; i < n; i++) {
        const w = (2 * Math.PI * f(i)) / RATE, c = Math.cos(w);
        const alpha = Math.sin(w) / (2 * (node.type === 'bandpass' ? q(i) : 10 ** (q(i) / 20)));
        const b = { lowpass: [(1 - c) / 2, 1 - c, (1 - c) / 2], highpass: [(1 + c) / 2, -(1 + c), (1 + c) / 2], bandpass: [alpha, 0, -alpha] }[node.type];
        y[i] = (b[0] * x[i] + b[1] * x1 + b[2] * x2 + 2 * c * y1 - (1 - alpha) * y2) / (1 + alpha);
        [x2, x1, y2, y1] = [x1, x[i], y1, y[i]];
      }
    } else if (node.kind === 'stereoPanner') y.set(sum(node));
    else throw new Error(`hear cannot play a ${node.kind}`);
    heard.set(node, y);
    return y;
  };
  return play(out);
};
const tone = (y, hz, from, to) => {
  let [re, im, weight] = [0, 0, 0];
  for (let i = Math.round(from * RATE), a = i, b = Math.round(to * RATE); i < b; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i - a)) / (b - a));
    re += w * y[i] * Math.cos((2 * Math.PI * hz * i) / RATE);
    im += w * y[i] * Math.sin((2 * Math.PI * hz * i) / RATE);
    weight += w;
  }
  return (2 * Math.hypot(re, im)) / weight;
};
const dB = (x) => 20 * Math.log10(x);

test('voice fm grows sidebands a modulator apart at the strengths frequency modulation gives, and darkens as the partial dies', () => {
  // The k-th sideband of a sine modulated at index I has amplitude |J_k(I)|.
  const bessel = (k, x) => {
    let s = 0, term = (x / 2) ** k / Array.from({ length: k }, (_, j) => j + 1).reduce((a, v) => a * v, 1);
    for (let m = 0; m < 30; m++) { s += term; term *= -((x / 2) ** 2) / ((m + 1) * (m + 1 + k)); }
    return s;
  };
  const spec = { pitch: 1000, attack: 0.005, hold: 1, decay: 1, fm: { ratio: 0.29, index: 1.5 } };
  const { record, out } = built(spec, 'a', 0);
  for (const [t, k] of arrivals(record)) assert.ok(k <= 2, `a ${t.kind} takes ${k} inputs`);
  const y = hear(record, out, 2.2);
  for (let k = -3; k <= 3; k++) {
    const heardDb = dB(tone(y, 1000 + 290 * k, 0.2, 0.8));
    const wantDb = dB(Math.abs(bessel(Math.abs(k), 1.5)));
    assert.ok(Math.abs(heardDb - wantDb) < (Math.abs(k) < 3 ? 1 : 2), `sideband ${k}: ${heardDb.toFixed(2)} dB, not ${wantDb.toFixed(2)}`);
  }
  assert.ok(tone(y, 1000 + 290 * 1.5, 0.2, 0.8) < 1e-3, 'nothing between the sidebands');
  // Late in the decay the swing has fallen with the partial: the carrier holds most of what is left.
  const share = (from, to) => tone(y, 1290, from, to) / tone(y, 1000, from, to);
  assert.ok(share(1.6, 1.9) < share(0.2, 0.8) / 4, 'the sidebands fall faster than the carrier');

  // The modulator follows a bend and a vibrato with its carrier, and stops when it does.
  const moved = built({ ...spec, detune: 6, bend: [[0, -100], [0.2, 0]], vibrato: { depth: 10 } }).record;
  const [lfo, a, b, mod] = moved.nodes.filter((m) => m.kind === 'oscillator');
  assert.equal(mod.frequency.value, 290);
  assert.deepEqual(mod.detune.events, [['setValueAtTime', -100, 0.5], ['linearRampToValueAtTime', -100, 0.5], ['linearRampToValueAtTime', 0, 0.7]]);
  assert.deepEqual(lfo.to[0].to.map((p) => p.owner), [a, b, mod], 'one swing moves the carrier and its modulator');
  assert.deepEqual(mod.to[0].to.map((p) => [p.owner, p === p.owner.frequency]), [[a, true], [b, true]], 'one modulator swings both copies');
  assert.equal(mod.end, a.end);
  for (const [t, k] of arrivals(moved)) assert.ok(k <= 2, `a ${t.kind} takes ${k} inputs`);
});

test('voice highpass corner follows the envelope: high through the attack and hold, back to its rest as the voice dies', () => {
  const spec = { pitch: 200, attack: 0.01, hold: 0.5, decay: 2, damp: 0 };
  const plain = built(spec, 'a', 0);
  const { record, out } = built({ ...spec, highpass: { peak: 4000 } }, 'a', 0);
  const [f] = record.nodes.filter((m) => m.type === 'highpass');
  assert.deepEqual(f.frequency.events, [['setValueAtTime', 20, 0], ['exponentialRampToValueAtTime', 4000, 0.01],
    ['setValueAtTime', 4000, 0.51], ['exponentialRampToValueAtTime', 20, 2.51]]);
  assert.deepEqual(f.to, [out], 'the high-pass feeds the panner');
  const [x, y] = [hear(plain.record, plain.out, 2.6), hear(record, out, 2.6)];
  // The corner of a Butterworth high-pass at this moment, and its gain at 200 Hz.
  const corner = (t) => 4000 * (20 / 4000) ** ((t - 0.51) / 2);
  const gain = (t) => { const r = (200 / corner(t)) ** 2; return r / Math.sqrt(1 + r * r); };
  const cut = (from, to) => dB(tone(y, 200, from, to) / tone(x, 200, from, to));
  assert.ok(cut(0.1, 0.45) < -45, `the held corner passes ${cut(0.1, 0.45).toFixed(1)} dB of the note`);
  for (const [from, to] of [[1.3, 1.6], [1.9, 2.3]]) {
    const want = dB(gain((from + to) / 2));
    assert.ok(Math.abs(cut(from, to) - want) < 1.5, `${from}-${to} s: ${cut(from, to).toFixed(2)} dB, not ${want.toFixed(2)}`);
  }
  assert.ok(cut(1.3, 1.6) < cut(1.9, 2.3) - 1, 'the lows bloom as the corner falls');

  const { Context } = fakeAudio();
  const ctx = new Context(2, RATE, RATE);
  for (const [extra, message] of [
    [{ fm: null }, /voice x: fm must be an object of its keys, got null/],
    [{ fm: {} }, /voice x: fm.index must be from 0 to 20, got undefined/],
    [{ fm: { index: 21 } }, /voice x: fm.index/],
    [{ fm: { index: 1, ratio: 0 } }, /voice x: fm.ratio must be above 0, at most 16, got 0/],
    [{ highpass: [] }, /voice x: highpass must be an object of its keys, got a list/],
    [{ highpass: {} }, /voice x: highpass.peak/],
    [{ highpass: { peak: 30000 } }, /voice x: highpass.peak/],
    [{ highpass: { peak: 100, rest: 200 } }, /voice x: highpass.rest must be a frequency in hertz above 0, at most highpass.peak, got 200/],
  ]) assert.throws(() => voice(ctx, rng(1), 'x', 0, { pitch: 440, ...extra }), message);
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

test('the film scaffold lets a sound lead or trail its cause by the seconds it declares, and places a declared off-screen cause', async (t) => {
  const fill = {
    SHOTS: "[['one', 2], ['two', 2]]",
    ELEMENTS: "[{ name: 'a', enter: 1, exit: 2 }, { name: 'shore', enter: 2, exit: DUR }]",
    SOUNDS: "[{ at: 0.5, cause: 'a', lead: 0.5, voice: { pitch: 330 } },"
      + " { at: 2.5, cause: 'a', trail: 0.5, voice: { pitch: 330 } },"
      + " { at: 1, cause: 'shore', lead: 1, ambience: { length: 3, fade: 0.5 } },"
      + " { at: 3, cause: 'gate', offscreen: { side: 'left', distance: 0.6 }, voice: { pitch: 180, pan: 0.5 } },"
      + " { at: 3, cause: 'gate', offscreen: { side: 'right', distance: 0 }, voice: { pitch: 180 } }]",
  };
  const solved = solve(scaffold(t, fill));
  assert.equal(solved.stages.error, null);
  assert.deepEqual(solved.state.cues.sounds.map((c) => [c.frame, c.name]),
    [[12, 'a 12 1'], [60, 'a 60 1'], [24, 'shore 24 1'], [72, 'gate 72 1'], [72, 'gate 72 2']], 'each is still named by its cause and frame');
  const { Context, record } = fakeAudio();
  await renderSound(scaffold(t, fill), solved, { OfflineAudioContext: Context });
  const placed = record.nodes.filter((n) => n.kind === 'stereoPanner').map((p) => [p.pan.value, p.to[0].gain.value]);
  // Each send also makes up what the fold to one channel loses at pan 0.8.
  const fold = Math.sin((2.8 * Math.PI) / 4);
  assert.deepEqual(placed.slice(2), [[-0.8, (0.25 + 0.75 * 0.6) / fold], [0.8, 0.25 / fold]], 'the declared side and distance place the voice');

  for (const [row, message] of [
    ["{ at: 0.5, cause: 'a', lead: 0.4, voice: { pitch: 330 } }", /the sound at 0.5 s has no cause on screen: a/],
    ["{ at: 2.5, cause: 'a', trail: 0.4, voice: { pitch: 330 } }", /the sound at 2.5 s has no cause on screen: a/],
    ["{ at: 2, cause: 'a', voice: { pitch: 330 } }", /the sound at 2 s has no cause on screen: a/],
    ["{ at: 2, voice: { pitch: 330 } }", /^the sound at 2 s has no cause key: add cause: 'name' of the element on screen that makes it, or offscreen: \{ side, distance \} for one never shown$/],
    ["{ at: 2, cause: null, voice: { pitch: 330 } }", /^the sound at 2 s has no cause key: add cause: /],
    ["{ at: 0.5, cause: 'a', lead: -1, voice: { pitch: 330 } }", /the sound at 0.5 s must lead or trail by seconds/],
    ["{ at: 1.5, cause: 'a', offscreen: { side: 'left', distance: 0.5 }, voice: { pitch: 330 } }", /declares its cause off screen, but a is on screen then/],
    ["{ at: 3, cause: 'gate', offscreen: { side: 'up', distance: 0.5 }, voice: { pitch: 330 } }", /off-screen side of 'left' or 'right'/],
    ["{ at: 3, cause: 'gate', offscreen: { side: 'left', distance: 2 }, voice: { pitch: 330 } }", /a distance from 0 to 1/],
    ["{ at: 3, cause: 'gate', offscreen: { side: 'left', distance: 0.5 }, ambience: { length: 1 } }", /must be a voice with an off-screen side/],
    ["{ at: 3, cause: 'gate', offscreen: { side: 'left', distance: 0.5 }, voice: null, ambience: { length: 1 } }", /must be a voice with an off-screen side/],
    ["{ at: 3, cause: 'gate', offscreen: { side: 'left', distance: 0.5 }, voice: 'loud' }", /^sound 0 has a voice that is not an object, got "loud"/],
    ["{ at: 3, cause: 'gate', lead: 1, offscreen: { side: 'left', distance: 0.5 }, voice: { pitch: 330 } }", /and no lead or trail/],
    ["{ at: 3, cause: 'gate', offscreen: 0, voice: { pitch: 330 } }", /^sound 0 has an offscreen that is not an object, got 0: give its keys, such as \{ side: 'left', distance: 0.5 \}$/],
    ["{ at: 3, cause: 'gate', offscreen: '', voice: { pitch: 330 } }", /^sound 0 has an offscreen that is not an object, got ""/],
    ["{ at: 3, cause: 'gate', offscreen: 'left', voice: { pitch: 330 } }", /^sound 0 has an offscreen that is not an object, got "left"/],
    ["{ at: 3, cause: 'gate', offscreen: false, voice: { pitch: 330 } }", /^sound 0 has an offscreen that is not an object, got false/],
    ["{ at: 3, cause: 'gate', offscreen: [{ side: 'left', distance: 0.5 }], voice: { pitch: 330 } }", /^sound 0 has an offscreen that is not an object, got /],
  ]) assert.match(solve(scaffold(t, { ...fill, SOUNDS: `[${row}]` })).stages.error.message, message);
  // An offscreen left as null counts as left out: the row keeps its on-screen cause.
  assert.equal(solve(scaffold(t, { ...fill, SOUNDS: "[{ at: 1.5, cause: 'a', offscreen: null, voice: { pitch: 330 } }]" })).stages.error, null);
  for (const row of ['{ at: 1, x: 10, y: 10 }', '{ at: 1, cause: null, x: 10, y: 10 }']) {
    assert.match(solve(scaffold(t, { ...fill, CONTACTS: `[${row}]` })).stages.error.message,
      /^the contact at 1 s has no cause key: add cause: 'name' of the element on screen that touches$/);
  }
});

test('the film scaffold pans an off-screen voice to its side and keeps it within 2 dB of the centre when folded to mono', async (t) => {
  const piece = scaffold(t, {
    SOUNDS: "[{ at: 1, cause: 'gate', offscreen: { side: 'left', distance: 0.5 }, voice: { pitch: 180 } },"
      + " { at: 1, cause: 'gate', offscreen: { side: 'right', distance: 0.5 }, voice: { pitch: 180 } }]",
  });
  const solved = solve(piece);
  assert.equal(solved.stages.error, null);
  const { Context, record } = fakeAudio();
  await renderSound(piece, solved, { OfflineAudioContext: Context });
  // A stereo panner takes a mono voice to cos and sin of (pan + 1) pi / 4 (Web
  // Audio's equal-power law); a phone folds the two to (L + R) / 2. Installed
  // Edge 154 rendered a voice through core/sound.js to the same figures: 1.84 dB
  // under the centre at pan 0.8, and 3.01 dB at pan 1.
  const sides = (pan) => [Math.cos(((pan + 1) * Math.PI) / 4), Math.sin(((pan + 1) * Math.PI) / 4)];
  const fold = (pan) => (sides(pan)[0] + sides(pan)[1]) / 2;
  const mono = (pan) => 20 * Math.log10(fold(pan) / fold(0));
  const pans = record.nodes.filter((n) => n.kind === 'stereoPanner').map((p) => p.pan.value);
  assert.deepEqual(pans.map(Math.sign), [-1, 1], 'each leans to its declared side');
  for (const pan of pans) {
    const [l, r] = sides(Math.abs(pan));
    assert.ok(20 * Math.log10(r / l) >= 15, `pan ${pan} leans only ${20 * Math.log10(r / l)} dB to its side`);
    assert.ok(mono(pan) > -2, `pan ${pan} loses ${-mono(pan)} dB in mono`);
  }
  assert.ok(mono(1) < -3, 'a hard pan would lose 3 dB in mono, so the bound tells the two apart');
});

test("the film scaffold's room reaches both sides of a panned voice, as loud as a centred voice's", async (t) => {
  const piece = scaffold(t, {
    SOUNDS: "[{ at: 1, cause: 'first', voice: { pitch: 220 } }, { at: 1, cause: 'first', voice: { pitch: 220, pan: 1 } },"
      + " { at: 1, cause: 'first', voice: { pitch: 220, pan: -0.8, distance: 0.5 } }]",
  });
  const solved = solve(piece);
  assert.equal(solved.stages.error, null);
  const { Context, record } = fakeAudio();
  await renderSound(piece, solved, { OfflineAudioContext: Context });
  // What each side of the room takes of a voice, followed from its panner: the
  // equal-power law on a mono voice, a gain held to one channel folding the two
  // to (L + R) / 2, each gain's level, and a convolver fed one channel feeding
  // both sides of its impulse.
  const sides = (pan) => [Math.cos(((pan + 1) * Math.PI) / 4), Math.sin(((pan + 1) * Math.PI) / 4)];
  const reaches = (p) => {
    let at = p.to[0], ch = sides(p.pan.value);
    for (; at.kind !== 'convolver'; at = at.to[0]) {
      if (at.channelCountMode === 'explicit' && at.channelCount === 1) ch = [(ch[0] + ch[1]) / 2];
      ch = ch.map((v) => v * at.gain.value);
    }
    return ch.length === 1 ? [ch[0], ch[0]] : ch;
  };
  const dB = (v) => 20 * Math.log10(v);
  const [centre, hard, far] = record.nodes.filter((n) => n.kind === 'stereoPanner').map(reaches);
  const SEND = 0.25;
  for (const [name, [l, r], send] of [['centred', centre, SEND], ['hard right', hard, SEND], ['far left', far, SEND + 0.75 * 0.5]]) {
    for (const [side, v] of [['left', l], ['right', r]]) {
      assert.ok(Math.abs(dB(v / (send * Math.SQRT1_2))) < 0.01, `the ${name} voice reaches the room's ${side} at ${dB(v).toFixed(2)} dB, not ${dB(send * Math.SQRT1_2).toFixed(2)} dB`);
    }
  }
});

test("the film scaffold's room follows a voice along its pan points, and a centred or fixed pan keeps its send", async (t) => {
  const piece = scaffold(t, {
    SOUNDS: "[{ at: 1, cause: 'first', voice: { pitch: 220, pan: [[0, -0.8], [1.5, 0.6], [2, 1]] } },"
      + " { at: 1, cause: 'first', voice: { pitch: 220 } }, { at: 1, cause: 'first', voice: { pitch: 220, pan: 1 } }]",
  });
  const solved = solve(piece);
  assert.equal(solved.stages.error, null);
  const { Context, record } = fakeAudio();
  await renderSound(piece, solved, { OfflineAudioContext: Context });
  const undo = (pan) => 0.25 / Math.sin(((pan + 2) * Math.PI) / 4);
  const [moving, centred, hard] = record.nodes.filter((n) => n.kind === 'stereoPanner').map((p) => p.to.find((n) => n.channelCount === 1).gain);
  assert.ok(Number.isFinite(moving.value), `the moving voice's send is ${moving.value}`);
  assert.equal(moving.value, undo(-0.8));
  assert.deepEqual(moving.events, [['setValueAtTime', undo(-0.8), 1], ['linearRampToValueAtTime', undo(-0.8), 1],
    ['linearRampToValueAtTime', undo(0.6), 2.5], ['linearRampToValueAtTime', undo(1), 3]], 'the send ramps along the pan points');
  assert.deepEqual([centred.value, centred.events, hard.value, hard.events], [0.25, [], undo(1), []]);
});

test("the film scaffold judges music over a swelling tail through its tail.rise", (t) => {
  const warned = (level) => {
    const warn = t.mock.method(console, 'warn', () => {});
    const { error } = solve(scaffold(t, { ELEMENTS: "[{ name: 'gust', enter: 0, exit: DUR }]", SOUNDS: "[{ at: 1, cause: 'gust', voice: { pitch: 220, partials: [[1, 0]], tail: { level: 0.5, rise: 1, length: 1, colour: 800 } } },"
      + ` { at: 1.75, cause: 'first', role: 'music', voice: { pitch: 110, hold: 1, level: ${level} } }]` })).stages;
    const said = warn.mock.calls.map((c) => c.arguments[0]);
    warn.mock.restore();
    return { error, said };
  };
  assert.deepEqual(warned(0.6), { error: null, said: ['warning: the music at 1.75 s (first) is not quieter than the sound at 1 s (gust) it plays with: lower the music, or bring it forward only on a beat marked forward and drop it back after'] },
    'music entering at the swell, before its peak, is judged against it');
  assert.equal(warned(0.45).said.length, 1, 'three quarters through its rise the swell is at three quarters of its level, not yet full');
  assert.deepEqual(warned(0.3), { error: null, said: [] });
});

test('the film scaffold judges a swelling tail from its peak under music already playing', (t) => {
  const warned = (level) => {
    const warn = t.mock.method(console, 'warn', () => {});
    const { error } = solve(scaffold(t, { ELEMENTS: "[{ name: 'gust', enter: 0, exit: DUR }]", SOUNDS: `[{ at: 0.2, cause: 'first', role: 'music', voice: { pitch: 110, hold: 3, level: ${level} } },`
      + " { at: 1, cause: 'gust', voice: { pitch: 220, partials: [[1, 0]], tail: { level: 0.5, rise: 1, length: 1, colour: 800 } } }]" })).stages;
    const said = warn.mock.calls.map((c) => c.arguments[0]);
    warn.mock.restore();
    return { error, said };
  };
  assert.deepEqual(warned(0.05), { error: null, said: [] }, 'a swell rising out of a quiet bed is not covered by it');
  assert.deepEqual(warned(0.45), { error: null, said: [] }, 'the swell peaks over the bed');
  assert.deepEqual(warned(0.6), { error: null, said: ['warning: the music at 0.2 s (first) is not quieter than the sound at 1 s (gust) it plays with: lower the music, or bring it forward only on a beat marked forward and drop it back after'] },
    'a swell that never rises over the bed is covered by it');
  const warn = t.mock.method(console, 'warn', () => {});
  const { error } = solve(scaffold(t, { ELEMENTS: "[{ name: 'gust', enter: 0, exit: DUR }]", SOUNDS: "[{ at: 0.2, cause: 'first', role: 'music', voice: { pitch: 110, hold: 3, level: 0.6 }, gain: [[0.2, 1], [1.5, 1], [1.55, 0.1]] },"
    + " { at: 1, cause: 'gust', voice: { pitch: 220, partials: [[1, 0]], tail: { level: 0.5, rise: 1, length: 1, colour: 800 } }, gain: [[1, 0], [1.5, 0], [1.55, 1]] }]" })).stages;
  const said = warn.mock.calls.map((c) => c.arguments[0]);
  warn.mock.restore();
  assert.deepEqual({ error, said }, { error: null, said: [] }, 'a rise frame its gain keys silence is not read at the peak');
});

test('the film scaffold plays each sound in the room of its place, and in ROOM outside every place', async (t) => {
  const fill = {
    SHOTS: "[['one', 2], ['two', 2]]",
    ELEMENTS: "[{ name: 'hall', enter: 0, exit: 1.5 }, { name: 'yard', enter: 2, exit: DUR }, { name: 'a', enter: 0.5, exit: 1 },"
      + " { name: 'porch', enter: 1.25, exit: 1.5 }]",
    ROOMS: "{ hall: { size: 2.4 }, yard: { size: 0.4 }, porch: { size: 0.8 } }",
    SOUNDS: "[{ at: 0.5, cause: 'a', voice: { pitch: 330 } },"
      + " { at: 1.75, cause: 'one', voice: { pitch: 330 } },"
      + " { at: 1.5, cause: 'yard', lead: 0.5, voice: { pitch: 110 } },"
      + " { at: 3, cause: 'two', voice: { pitch: 330 } },"
      + " { at: 1, cause: 'gate', offscreen: { side: 'left', distance: 1 }, voice: { pitch: 180 } },"
      + " { at: 1.25, cause: 'one', voice: { pitch: 330 } }]",
  };
  const piece = scaffold(t, fill);
  const solved = solve(piece);
  assert.equal(solved.stages.error, null);
  assert.deepEqual(solved.state.cues.sounds.map((c) => c.room), ['hall', null, 'yard', 'yard', 'hall', 'porch'],
    'a place of its own, else the latest place on screen to enter, else ROOM; a lead into a place plays in that place');
  const { Context, record } = fakeAudio();
  await renderSound(piece, solved, { OfflineAudioContext: Context });
  for (const [node, k] of arrivals(record)) assert.ok(k <= 2, `a ${node.kind} takes ${k} inputs`);
  const rooms = record.nodes.filter((n) => n.kind === 'convolver');
  const seeded = (name, opts) => room(new Context(2, RATE, RATE), rng(1), name, opts).buffer.getChannelData(0);
  assert.deepEqual(rooms.map((c) => c.buffer.getChannelData(0)),
    [seeded('room', { size: 1.6 }), seeded('room hall', { size: 2.4 }), seeded('room yard', { size: 0.4 }), seeded('room porch', { size: 0.8 })],
    "ROOM keeps its name, and each place's room is named by its place");
  const reach = (n) => (n.kind === 'convolver' ? n : reach(n.to[0]));
  assert.deepEqual(record.nodes.filter((n) => n.kind === 'stereoPanner').map((p) => rooms.indexOf(reach(p.to[0]))), [1, 0, 2, 2, 1, 3],
    "each voice's send reaches its place's room");
  assert.match(solve(scaffold(t, { ...fill, ROOMS: '{ cellar: {} }' })).stages.error.message, /the room for cellar has no element of that name/);
});

test('the film scaffold takes a sound\'s room and a contact\'s depth only from rows seen in the shot playing', (t) => {
  // Intercut places: both rows span the film, but each is seen only in its shots.
  const cues = solve(scaffold(t, {
    SHOTS: "[['one', 2], ['two', 1], ['three', 1]]",
    ELEMENTS: "[{ name: 'hall', enter: 0, exit: DUR, shots: ['one', 'three'] }, { name: 'yard', enter: 0, exit: DUR, shots: ['two'] },"
      + " { name: 'thing', enter: 0, exit: DUR, depth: 0, shots: ['one', 'three'] }, { name: 'thing', enter: 0, exit: DUR, depth: 2, shots: ['two'] }]",
    ROOMS: '{ hall: {}, yard: {} }',
    SOUNDS: "[{ at: 0.5, cause: 'thing', voice: { pitch: 330 } }, { at: 2.5, cause: 'thing', voice: { pitch: 330 } }, { at: 3.5, cause: 'thing', voice: { pitch: 330 } }]",
    CAMERA: '[{ at: 0, x: 900, y: 360 }]',
    CONTACTS: "[{ at: 0.5, cause: 'thing', x: 640, y: 360 }, { at: 2.5, cause: 'thing', x: 640, y: 360 }]",
  })).state.cues;
  assert.deepEqual(cues.sounds.map((c) => c.room), ['hall', 'yard', 'hall']);
  assert.deepEqual(cues.contacts.map((c) => c.x), [640, 640 - 2 * 260], 'the contact in two moves at the depth of the row seen there');
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
  assert.ok(spread(bed(1, 'wind', { drift: 1.5, pace: 1 })[0]) > 2, 'a drifting bed wanders');

  const { Context } = fakeAudio();
  const ctx = new Context(2, RATE, RATE);
  for (const [spec, message] of [
    [{}, /ambience x: length/],
    [{ length: 1, fade: 0.6 }, /ambience x: length/],
    [{ length: 1, fade: 0.05 }, /ambience x: fade/],
    [{ length: 2, colour: 30000 }, /ambience x: colour/],
    [{ length: 2, band: 0 }, /ambience x: band/],
    [{ length: 2, drift: 3 }, /ambience x: drift/],
    [{ length: 2, pace: 0 }, /ambience x: pace/],
    [{ length: 2, level: -1 }, /ambience x: level/],
  ]) assert.throws(() => ambience(ctx, rng(1), 'x', 0, spec), message);
  assert.throws(() => ambience(ctx, rng(1), 'x', -1, { length: 2 }), /ambience x: at/);
});

test('an ambience bed tinted pink falls 3 dB an octave from white and brown 6 dB, and white is the bed it always was', () => {
  const bed = (tint, rate = RATE, spec = { colour: 1600, band: 8, drift: 0 }) => {
    const { Context } = fakeAudio();
    const src = ambience(new Context(2, rate * 4, rate), rng(tint ? 1 : 3), tint ? 'air' : 'wind', 0, { length: 3, fade: 0.5, ...spec, ...(tint ? { tint } : {}) });
    return [src.buffer.getChannelData(0), src.buffer.getChannelData(1)];
  };
  // The default bed's bytes on main before tints existed, and 'white' given is that bed.
  const digest = (sides) => {
    const h = require('node:crypto').createHash('sha256');
    for (const a of sides) h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
    return h.digest('hex');
  };
  const wander = { band: 3, drift: 1, pace: 2 };
  assert.equal(digest(bed(undefined, 8000, wander)), 'eae03aead1ccff9d62975154ddc19c0cba87b8e75f9ddf741248420f4f9e3cc3', 'the default bed changed');
  const { Context } = fakeAudio();
  const white = ambience(new Context(2, 8000 * 4, 8000), rng(3), 'wind', 0, { length: 3, fade: 0.5, ...wander, tint: 'white' });
  assert.equal(digest([0, 1].map((c) => white.buffer.getChannelData(c))), 'eae03aead1ccff9d62975154ddc19c0cba87b8e75f9ddf741248420f4f9e3cc3', "tint 'white' is the default bed");

  // Each tint's power over white's, in octave bands of the same seeded noise
  // through the same eight-octave band, so the band-passes cancel out.
  const power = (a, hz) => {
    let p = 0;
    for (let s = RATE / 2; s + 4096 < 2.5 * RATE; s += 4096) {
      let re = 0, im = 0;
      for (let i = 0; i < 4096; i++) {
        const w = (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / 4096)) * a[s + i];
        re += w * Math.cos((2 * Math.PI * hz * i) / RATE);
        im += w * Math.sin((2 * Math.PI * hz * i) / RATE);
      }
      p += re * re + im * im;
    }
    return p;
  };
  const octave = (a, centre) => {
    let p = 0;
    for (let k = -3; k <= 3; k++) p += power(a, centre * 2 ** (k / 14));
    return 10 * Math.log10(p);
  };
  const [plain] = bed('white');
  for (const [tint, fall, centres] of [['pink', -3, [100, 200, 400, 800, 1600, 3200, 6400, 12800]], ['brown', -6, [200, 400, 800, 1600, 3200, 6400]]]) {
    const [a] = bed(tint);
    const over = centres.map((c) => octave(a, c) - octave(plain, c));
    const steps = over.slice(1).map((v, i) => v - over[i]);
    const off = steps.filter((s) => Math.abs(s - fall) > 1.25).length;
    assert.equal(off, 0, `${tint} falls ${steps.map((s) => s.toFixed(1)).join(', ')} dB an octave, not about ${fall}`);
    const [steady] = bed(tint, RATE, { colour: 1600, band: 2, drift: 0, level: 0.05 });
    let sum = 0;
    for (let i = RATE; i < 2 * RATE; i++) sum += steady[i] * steady[i];
    const rms = Math.sqrt(sum / RATE);
    assert.ok(rms > 0.05 * 0.9 && rms < 0.05 * 1.25, `a still ${tint} bed holds its level: ${rms}`);
  }
  // A wandering tinted bed is as loud with its band an octave up or down: its
  // level in dB, less the side's own wandering gain, does not follow the colour.
  const { noise2 } = require('../core/rand.js');
  for (const tint of ['pink', 'brown']) {
    const R = rng(5);
    const { Context: C } = fakeAudio();
    const a = ambience(new C(2, RATE * 9, RATE), R, 'air', 0, { length: 8, fade: 0.5, colour: 1600, band: 2, drift: 1, pace: 1, tint }).buffer.getChannelData(0);
    const wander = (row, i) => 2 * noise2(R, i / RATE, row, 'air drift') - 1;
    const xs = [], ys = [];
    for (let s = RATE; s + 2048 <= 7 * RATE; s += 2048) {
      let p = 0, o = 0;
      for (let i = s; i < s + 2048; i++) {
        const b = i - (i % 32);
        p += (a[i] / 10 ** (0.3 * wander(1, b))) ** 2;
        if (i % 32 === 0) o += wander(0, i) / 64;
      }
      xs.push(o);
      ys.push(10 * Math.log10(p));
    }
    const mx = xs.reduce((u, v) => u + v) / xs.length, my = ys.reduce((u, v) => u + v) / ys.length;
    const slope = xs.reduce((u, x, i) => u + (x - mx) * (ys[i] - my), 0) / xs.reduce((u, x) => u + (x - mx) ** 2, 0);
    assert.ok(Math.abs(slope) < 1, `a wandering ${tint} bed moves ${slope.toFixed(2)} dB an octave of its colour, not about 0`);
  }
  assert.throws(() => ambience(new Context(2, RATE, RATE), rng(1), 'x', 0, { length: 2, tint: 'grey' }), /ambience x: tint must be 'white', 'pink' or 'brown', got grey/);
});

test('the film scaffold plays an ambience row as a bed, out of the room unless its wet is given', async (t) => {
  const piece = scaffold(t, {
    SOUNDS: "[{ at: 0.5, cause: 'first', ambience: { length: 3, fade: 1 } }, { at: 1, cause: 'first', voice: { pitch: 220 } },"
      + " { at: 0.5, cause: 'first', wet: 0.4, ambience: { length: 3, fade: 1 } }]",
  });
  const solved = solve(piece);
  assert.equal(solved.stages.error, null);
  const { Context, record } = fakeAudio();
  await renderSound(piece, solved, { OfflineAudioContext: Context });
  for (const [node, k] of arrivals(record)) assert.ok(k <= 2, `a ${node.kind} takes ${k} inputs`);
  const [bed, wet] = record.nodes.filter((n) => n.kind === 'bufferSource');
  assert.equal(bed.at, 0.5);
  assert.equal(bed.buffer.length, 3 * RATE);
  assert.equal(bed.to[0].gain.value, 0, 'the bed is already the place, so it stays out of the room');
  assert.equal(wet.to[0].gain.value, 0.4, 'a bed given wet takes that much room');
});

test("the film scaffold's room takes noise grains on both sides as it takes a voice, and leaves other ambiences' sends as they were", async (t) => {
  const piece = scaffold(t, {
    SOUNDS: "[{ at: 0.5, cause: 'first', wet: 0.25, ambience: { length: 3, level: 0, grains: { rate: 50, level: 0.05, noise: true } } },"
      + " { at: 0.5, cause: 'first', ambience: { length: 3, grains: { rate: 50, level: 0.05, noise: true } } },"
      + " { at: 0.5, cause: 'first', wet: 0.25, ambience: { length: 3, grains: { rate: 50, level: 0.05 } } },"
      + " { at: 0.5, cause: 'first', wet: 0.25, ambience: { length: 3, grains: { rate: 50, level: 0.05, noise: false } } }]",
  });
  const solved = solve(piece);
  assert.equal(solved.stages.error, null);
  const { Context, record } = fakeAudio();
  await renderSound(piece, solved, { OfflineAudioContext: Context });
  const [noisy, dry, sine, off] = record.nodes.filter((n) => n.kind === 'bufferSource').map((b) => b.to[0]);
  // core places each grain at a seeded G from 0 to 1 at cos and sin of G pi / 2;
  // a send held to one channel folds the two to (L + R) / 2, which a convolver
  // fed one channel feeds to both sides. A centred voice reaches each side at
  // its send / sqrt 2.
  const places = Array.from({ length: 1000 }, (_, i) => ((i + 0.5) / 1000) * (Math.PI / 2));
  const reach = (theta) => ((Math.cos(theta) + Math.sin(theta)) / 2) * noisy.gain.value;
  const dB = (v) => 20 * Math.log10(v / (0.25 * Math.SQRT1_2));
  assert.deepEqual([noisy.channelCount, noisy.channelCountMode], [1, 'explicit'], 'the noise grains fold to one channel');
  const mean = Math.sqrt(places.reduce((a, th) => a + reach(th) ** 2, 0) / places.length);
  assert.ok(Math.abs(dB(mean)) < 0.01, `a grain reaches each side of the room at ${dB(mean).toFixed(3)} dB of a centred voice, on average`);
  assert.ok(Math.abs(dB(reach(Math.PI / 4)) - 0.87) < 0.01 && Math.abs(dB(reach(0)) + 2.14) < 0.01,
    `a centred grain reaches it at ${dB(reach(Math.PI / 4)).toFixed(2)} dB, a hard-panned one at ${dB(reach(0)).toFixed(2)} dB`);
  assert.equal(dry.gain.value, 0, 'noise grains given no wet stay out of the room');
  for (const send of [sine, off]) {
    assert.deepEqual([send.gain.value, send.channelCount === 1], [0.25, false], 'sine grains keep their stereo send at their wet');
  }
});

test('ambience grains are seeded events in the band that rise as they close, fall to -60 dB and fade out over 5 ms', () => {
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
  const lastN = ringN + Math.ceil(0.005 * RATE);
  assert.ok(both.subarray(start + lastN).every((v) => v === 0), 'the event is over 5 ms after -60 dB');
  assert.ok(both[start + ringN] <= 0.1 * 1e-3 * 1.01, 'the event falls to -60 dB of its level over its length');
  // The last 48 of its 240 fading samples hold at most 48 / 240 of -60 dB.
  assert.ok(Math.max(...both.subarray(start + lastN - 48)) <= 0.1 * 1e-3 * (48 / 240) * 1.01, 'the event fades out rather than stops');
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
    [{ rate: 10, length: 1.998, level: 0.1 }, /ambience x: grains.length/],
    [{ rate: 10, chirp: 5, level: 0.1 }, /ambience x: grains.chirp/],
    [{ rate: 10 }, /ambience x: grains.level/],
    [{ rate: 10, level: 0.1, spread: 70 }, /ambience x: grains.spread/],
  ]) assert.throws(() => ambience(ctx, rng(1), 'x', 0, { length: 2, grains }), message);
  // 0.1949999 s plus 5 ms is under 0.2 s, but 9360 plus 240 samples fill all 9600.
  assert.throws(() => ambience(ctx, rng(1), 'x', 0, { length: 0.2, fade: 0.08, grains: { rate: 10, length: 0.1949999, level: 0.1 } }), /ambience x: grains.length/);
});

test('an ambience grain peaks under its level as its 1 ms rise meets its fall, by what the API documents', () => {
  // ln(1000) ms: from this length up the envelope peaks at the rise's end, by
  // e^(-T / length); below it the fall wins first, at length / (e T).
  const T = Math.log(1000) * 0.001;
  const peakDb = (length, colour) => {
    const { Context } = fakeAudio();
    const src = ambience(new Context(2, RATE * 4, RATE), rng(1), 'drip', 0,
      { length: 2, fade: 0.2, level: 0, drift: 0, colour, band: 0.01, grains: { rate: 0.5, length, level: 0.1, spread: 0 } });
    const [l, r] = [src.buffer.getChannelData(0), src.buffer.getChannelData(1)];
    let peak = 0;
    for (let i = 0; i < l.length; i++) peak = Math.max(peak, Math.hypot(l[i], r[i]));
    return 20 * Math.log10(peak / 0.1);
  };
  const factor = (length) => 20 * Math.log10(length >= T ? Math.exp(-T / length) : length / (Math.E * T));
  for (const length of [0.001, 0.0025, 0.003, 0.005, 0.02]) {
    const [got, want] = [peakDb(length, 4000), factor(length)];
    assert.ok(got <= want + 0.05 && got >= want - 0.5, `a ${length * 1000} ms grain peaks ${got.toFixed(2)} dB from its level, not ${want.toFixed(2)}`);
  }
  // A pitch whose quarter cycle outlasts the envelope's peak peaks lower still, at any length.
  for (const [length, colour] of [[0.02, 100], [0.003, 300]]) {
    const [got, want] = [peakDb(length, colour), factor(length)];
    assert.ok(got < want - 1, `a ${colour} Hz grain of ${length * 1000} ms peaks ${got.toFixed(2)} dB from its level, not under ${want.toFixed(2)}`);
  }
});

test('noise grains are seeded band-passed noise at a sine grain\'s times, power and envelope, and sine grains render the bytes they did', () => {
  const texture = (seed, grains, spec = {}, seconds = 2) => {
    const { Context } = fakeAudio();
    const src = ambience(new Context(2, RATE * seconds, RATE), rng(seed), 'grit', 0, { length: seconds, fade: 0.2, level: 0, drift: 0, ...spec, grains });
    return [src.buffer.getChannelData(0), src.buffer.getChannelData(1)];
  };
  // Computed before noise grains existed: a sine grain must not change by a bit.
  const pinned = { rate: [[0, 50], [2, 300]], length: 0.01, chirp: 0.5, level: 0.05, spread: 20 };
  for (const grains of [pinned, { ...pinned, noise: false }]) {
    const hash = require('node:crypto').createHash('sha256');
    for (const c of texture(1, grains, { level: 0.01, drift: 0.5 })) hash.update(Buffer.from(c.buffer));
    assert.equal(hash.digest('hex'), '37233a4ac3d47833f84e9f41525375f2fb569fb2a8bb729664754391e64af01f');
  }

  const shower = { rate: 200, length: 0.05, level: 0.1, spread: 0 };
  const [left, right] = texture(1, { ...shower, noise: true }, { colour: 1000, band: 0.01 }, 4);
  assert.deepEqual(texture(1, { ...shower, noise: true }, { colour: 1000, band: 0.01 }, 4)[0], left, 'one seed and name make one texture');
  assert.notDeepEqual(texture(2, { ...shower, noise: true }, { colour: 1000, band: 0.01 }, 4)[0], left, 'another seed makes another texture');
  // One event: the same seeded time as a sine grain's, over 5 ms after its -60 dB.
  const one = { rate: 0.5, length: 0.05, level: 0.1, spread: 0 };
  const onset = (a) => a.findIndex((v) => v !== 0);
  const [dry] = texture(1, { ...one, noise: true });
  const start = onset(dry);
  assert.equal(start, onset(texture(1, one)[0]), 'a noise grain starts when the sine grain would');
  const lastN = Math.ceil(0.05 * RATE) + Math.ceil(0.005 * RATE);
  assert.ok(dry.subarray(start + lastN).every((v) => v === 0), 'the event is over 5 ms after -60 dB');
  assert.ok(Math.max(...dry.subarray(start + lastN - 48).map(Math.abs)) < 0.1 * 1e-3, 'the event fades out rather than stops');

  // The power of a sine grain at the same level, to half a dB (800 grains of noise measure it to about 0.2 dB).
  const power = ([l, r]) => l.reduce((s, v, i) => s + v * v + r[i] * r[i], 0);
  for (const colour of [300, 1000, 12000]) {
    const db = 10 * Math.log10(power(texture(1, { ...shower, noise: true }, { colour, band: 0.01 }, 4)) / power(texture(1, shower, { colour, band: 0.01 }, 4)));
    assert.ok(Math.abs(db) < 0.5, `${colour} Hz noise grains sit ${db.toFixed(2)} dB from sine grains`);
  }
  // Its band is full from its first sample: a 3 ms noise grain at 100 Hz, where a sine barely
  // rises, carries the power of a 4 kHz sine grain at the same seeded times, levels and envelopes.
  const short = { ...shower, length: 0.003 };
  const filled = 10 * Math.log10(power(texture(1, { ...short, noise: true }, { colour: 100, band: 0.01 }, 4)) / power(texture(1, short, { colour: 4000, band: 0.01 }, 4)));
  assert.ok(Math.abs(filled) < 1, `3 ms noise grains at 100 Hz sit ${filled.toFixed(2)} dB from 4 kHz sine grains`);
  // Its power fills an octave around its pitch, as a sine's does not, and stays out of the bands two octaves away.
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
  const [sine] = texture(1, shower, { colour: 1000, band: 0.01 }, 4);
  assert.ok(at(left, 1300) - at(left, 1000) > -6, 'noise grains spread across their octave');
  assert.ok(at(sine, 1300) - at(sine, 1000) < -15, 'sine grains hold their pitch');
  for (const hz of [250, 4000]) assert.ok(at(left, hz) - at(left, 1000) < -12, `noise grains spill to ${hz} Hz`);
  // Its band glides with the chirp: halfway through a 2-octave chirp from 1 kHz it sits at 2 kHz,
  // so the octave around 4 kHz outweighs the one around 500 Hz, as it does not for a held band.
  const tilt = (chirp) => {
    const [a] = texture(1, { rate: 0.5, length: 0.4, chirp, level: 0.1, spread: 0, noise: true }, { colour: 1000, band: 0.01 });
    const s = onset(a) + 0.2 * RATE - 2048;
    const octave = (hz) => {
      let p = 0, k = 0;
      for (let f = hz / Math.SQRT2; f < hz * Math.SQRT2; f += RATE / 4096, k++) {
        let re = 0, im = 0;
        for (let i = 0; i < 4096; i++) {
          const w = (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / 4096)) * a[s + i];
          re += w * Math.cos((2 * Math.PI * f * i) / RATE);
          im += w * Math.sin((2 * Math.PI * f * i) / RATE);
        }
        p += re * re + im * im;
      }
      return 10 * Math.log10(p / k);
    };
    return octave(4000) - octave(500);
  };
  const [held, glided] = [tilt(0), tilt(2)];
  assert.ok(held < -3, `a held noise grain sits ${held.toFixed(2)} dB higher at 4 kHz than at 500 Hz`);
  assert.ok(glided > 3, `a noise grain chirping 2 octaves sits ${glided.toFixed(2)} dB higher at 4 kHz than at 500 Hz halfway`);

  const { Context } = fakeAudio();
  for (const bad of [1, 'yes', null]) {
    assert.throws(() => ambience(new Context(2, RATE, RATE), rng(1), 'x', 0, { length: 2, grains: { rate: 10, level: 0.1, noise: bad } }),
      new RegExp(`^RangeError: ambience x: grains.noise must be true or false, got ${String(bad)}$`));
  }
});

test('ambience grains follow a rate curve where one is given, and a plain rate keeps its seeded times', () => {
  // The sample after each event's start: its sine starts at 0 on silence.
  const onsets = (rate, length = 2) => {
    const { Context } = fakeAudio();
    const src = ambience(new Context(2, RATE * length, RATE), rng(1), 'rain', 0,
      { length, fade: 0.2, level: 0, drift: 0, grains: { rate, length: 0.002, level: 0.1, spread: 0 } });
    const [l, r] = [src.buffer.getChannelData(0), src.buffer.getChannelData(1)];
    const out = [];
    for (let i = 1; i < l.length; i++) if ((l[i] || r[i]) && !l[i - 1] && !r[i - 1]) out.push(i);
    return out;
  };
  assert.deepEqual(onsets(5), [31621, 35728, 36741, 51347, 54776, 56859, 59403, 76886, 80148, 94042],
    'a plain rate gives the times it gave before rates could be curves');
  const flat = onsets([[0, 5]]);
  assert.equal(flat.length, 10);
  flat.forEach((at, i) => assert.ok(Math.abs(at - onsets(5)[i]) <= 1, `a flat curve places event ${i} as the plain rate does: ${at}`));

  // Over 20 seconds, so events rarely overlap. Rising from 0 to 10 a second: a
  // quarter of its 100 events in the first half, where a plain rate puts half.
  const rising = onsets([[0, 0], [20, 10]], 20);
  const early = rising.filter((at) => at < 10 * RATE).length;
  assert.ok(rising.length >= 94 && rising.length <= 100, `the curve makes its 100 events: ${rising.length}`);
  assert.ok(early >= 12 && early <= 38, `the rising curve is sparse early: ${early} of ${rising.length}`);
  // Held at 10, then dropping to 0 at ten seconds: nothing after the drop.
  const stopped = onsets([[0, 10], [10, 10], [10, 0]], 20);
  assert.ok(stopped.length >= 94 && stopped.every((at) => at <= 10 * RATE + 1), `the rain stops at ten seconds: ${stopped.slice(-3)}`);
  assert.deepEqual(onsets([[0, 0]]), [], 'a curve at 0 makes no events');

  const { Context } = fakeAudio();
  const ctx = new Context(2, RATE, RATE);
  for (const [rate, message] of [
    [[], /ambience x: grains.rate must be a list/],
    [[[0, -1]], /ambience x: grains.rate value/],
    [[[0, 3000]], /ambience x: grains.rate value/],
    [[[1, 5], [0, 5]], /ambience x: grains.rate time/],
  ]) assert.throws(() => ambience(ctx, rng(1), 'x', 0, { length: 2, grains: { rate, level: 0.1 } }), message);
});

test('a sound given no spec object, or a scaffold row with no sound, is refused by name', async (t) => {
  const { Context } = fakeAudio();
  const ctx = new Context(2, RATE, RATE);
  for (const bad of [null, 3, 'loud', [1]]) {
    assert.throws(() => voice(ctx, rng(1), 'x', 0, bad), /^RangeError: voice x: spec must be an object/);
    assert.throws(() => ambience(ctx, rng(1), 'x', 0, bad), /^RangeError: ambience x: spec must be an object/);
    assert.throws(() => room(ctx, rng(1), 'r', bad), /^RangeError: room r: opts must be an object/);
  }
  assert.throws(() => voice(ctx, rng(1), 'x', 0, { pitch: 440, tail: Symbol('breath') }), /^RangeError: voice x: tail must be an object of its keys, got Symbol\(breath\)$/);
  assert.throws(() => voice(ctx, rng(1), 'x', 0, { pitch: Symbol('a') }), /^RangeError: voice x: pitch must be .*, got Symbol\(a\)$/);
  for (const row of ["{ at: 1, cause: 'first' }", "{ at: 1, cause: 'first', voice: null }"]) {
    assert.match(solve(scaffold(t, { SOUNDS: `[${row}]` })).stages.error.message, /the sound at 1 s \(first\) has neither a voice nor an ambience/);
  }
  // A row with no cause says so, never "undefined".
  assert.match(solve(scaffold(t, { SOUNDS: '[{ at: 1 }]' })).stages.error.message, /^the sound at 1 s \(no cause\) has neither a voice nor an ambience$/);
  // A row with both would play only its ambience, so it is refused, on screen and off.
  for (const row of ["{ at: 1, cause: 'first', voice: { pitch: 220 }, ambience: { length: 1 } }",
    "{ at: 1, cause: 'first', offscreen: { side: 'left', distance: 0.5 }, voice: { pitch: 220 }, ambience: { length: 1 } }"]) {
    assert.match(solve(scaffold(t, { SOUNDS: `[${row}]` })).stages.error.message,
      /^the sound at 1 s \(first\) has both a voice and an ambience: keep one, or split them into two rows$/);
  }
});

test('voice and ambience refuse a group of keys that is not an object, naming the sound and the key', () => {
  const { Context } = fakeAudio();
  const ctx = new Context(2, RATE, RATE);
  for (const key of ['strike', 'tail', 'vibrato']) {
    for (const bad of [null, 3, 'soft', [1]]) {
      assert.throws(() => voice(ctx, rng(1), 'x', 0, { pitch: 440, [key]: bad }), new RegExp(`^RangeError: voice x: ${key} must be an object`));
    }
  }
  for (const bad of [null, 3, [1]]) {
    assert.throws(() => ambience(ctx, rng(1), 'x', 0, { length: 2, grains: bad }), /^RangeError: ambience x: grains must be an object/);
  }
});

// A second that is not a number reaches the retime in every timed table: each
// refuses it by its row before the tempo reads it, and a refusal prints a NaN
// or Infinity nested in a list or object as written.
test('the film scaffold refuses an at that is not a finite number in every timed table, and prints a nested NaN as written', async (t) => {
  const error = (fill) => solve(scaffold(t, { ELEMENTS: "[{ name: 'thing', enter: 0, exit: DUR }]", BEATS: '[]', ...fill })).stages.error;
  const refuse = (what, table, row) => t.test(`a Symbol as the at of ${what}`, () => {
    const e = error({ [table]: `[${row.replace('AT', "Symbol('t')")}]` });
    assert.ok(e, `${row} is refused`);
    assert.equal(e.message, `${what} has an at that is not a finite number of seconds, got Symbol(t): give the second it comes at, such as 1.5`);
  });
  await refuse('sound 0', 'SOUNDS', "{ at: AT, cause: 'thing', voice: { pitch: 220 } }");
  await refuse('contact 0', 'CONTACTS', "{ at: AT, cause: 'thing', x: 10, y: 10 }");
  await refuse('beat 0', 'BEATS', "{ at: AT, intensity: 0.5, element: 'thing', changes: 'x' }");
  await refuse('camera key 0', 'CAMERA', '{ at: AT, x: 100 }');
  await t.test('a string and Infinity as the at of a sound', () => {
    for (const [at, got] of [["'1'", '"1"'], ['Infinity', 'Infinity']]) {
      assert.equal(error({ SOUNDS: `[{ at: ${at}, cause: 'thing', voice: { pitch: 220 } }]` }).message,
        `sound 0 has an at that is not a finite number of seconds, got ${got}: give the second it comes at, such as 1.5`);
    }
  });
  await t.test('a NaN or Infinity nested in a list or object is printed as written, not as null', () => {
    assert.equal(error({ ELEMENTS: "[{ name: 'thing', enter: 0, exit: DUR, shots: { a: [NaN, -Infinity, Infinity, 1] } }]" }).message.split(': put')[0],
      "element thing's shots is not a list of shot names, got {\"a\":[NaN,-Infinity,Infinity,1]}");
  });
});

// An enter, a lead and a trail go through the tempo like an at does, and a sound
// with no at has nothing to retime: each is refused by its row, not read as text,
// coerced or left to a raw TypeError.
test('the film scaffold refuses an enter, a lead or a trail that is not a finite number, and a sound with no at, by its row', async (t) => {
  const error = (fill) => solve(scaffold(t, { ELEMENTS: "[{ name: 'thing', enter: 0, exit: DUR }]", BEATS: '[]', ...fill })).stages.error;
  const enter = (value, got) => t.test(`an enter of ${value}`, () => {
    assert.equal(error({ ELEMENTS: `[{ name: 'thing', enter: ${value}, exit: DUR }]` })?.message,
      `element thing has an enter that is not a finite number of seconds, got ${got}: give the second it comes on, such as 0`);
  });
  await enter("Symbol('t')", 'Symbol(t)');
  await enter("'0.5'", '"0.5"');
  await enter('NaN', 'NaN');
  const side = (key, value, got) => t.test(`a ${key} of ${value}`, () => {
    assert.equal(error({ SOUNDS: `[{ at: 1, cause: 'thing', ${key}: ${value}, voice: { pitch: 220 } }]` })?.message,
      `sound 0 has a ${key} that is not a finite number of seconds, got ${got}: give the seconds it ${key}s by, such as 0.5`);
  });
  await side('lead', "'1'", '"1"');
  await side('lead', 'Infinity', 'Infinity');
  await side('trail', "Symbol('t')", 'Symbol(t)');
  await side('trail', 'NaN', 'NaN');
  await t.test('a sound with no at', () => {
    assert.equal(error({ SOUNDS: "[{ cause: 'thing', voice: { pitch: 220 } }]" })?.message,
      'sound 0 has no at: give the second it comes at, such as 1.5');
  });
});

// One seconds check serves every timed value, null counts as left out, and the
// at check runs before the voice and role checks.
test('the film scaffold refuses an exit, an ambience length or fade that is not a finite number, reads null as left out, and checks the at first', async (t) => {
  const error = (fill) => solve(scaffold(t, { ELEMENTS: "[{ name: 'thing', enter: 0, exit: DUR }]", BEATS: '[]', ...fill })).stages.error;
  const exit = (value, got) => t.test(`an exit of ${value}`, () => {
    assert.equal(error({ ELEMENTS: `[{ name: 'thing', enter: 0, exit: ${value} }]` })?.message,
      `element thing has an exit that is not a finite number of seconds, got ${got}: give the second it goes off, such as 3.2`);
  });
  await exit('NaN', 'NaN');
  await exit('Infinity', 'Infinity');
  await exit("'3'", '"3"');
  const ambience = (key, value, got, fix) => t.test(`an ambience ${key} of ${value}`, () => {
    assert.equal(error({ SOUNDS: `[{ at: 1, cause: 'thing', ambience: { length: 2, ${key}: ${value} } }]` })?.message,
      `sound 0 has an ambience ${key} that is not a finite number of seconds, got ${got}: ${fix}`);
  });
  await ambience('length', 'NaN', 'NaN', 'give the seconds it lasts, such as 3');
  await ambience('fade', "Symbol('t')", 'Symbol(t)', 'give the seconds it fades by, such as 0.5');
  await t.test('an enter of null reads as left out', () => {
    assert.match(error({ ELEMENTS: "[{ name: 'thing', enter: null, exit: DUR }]" })?.message, /^element thing must enter at 0 or later/);
  });
  await t.test('an ambience fade of null reads as left out and takes its default', () => {
    assert.equal(error({ SOUNDS: "[{ at: 1, cause: 'thing', ambience: { length: 2, fade: null } }]" }), null);
  });
  await t.test('an off-screen voice with a lead and trail of null reads them as left out', () => {
    assert.equal(error({ ELEMENTS: "[{ name: 'thing', enter: 0, exit: 0.5 }]",
      SOUNDS: "[{ at: 1, cause: 'thing', voice: { pitch: 220 }, lead: null, trail: null, offscreen: { side: 'left', distance: 0.5 } }]" }), null);
  });
  await t.test('a sound with no at and no voice is refused by its row', () => {
    assert.equal(error({ SOUNDS: "[{ cause: 'thing' }]" })?.message, 'sound 0 has no at: give the second it comes at, such as 1.5');
  });
  await t.test('a sound with a null at and a bad role is refused by its row', () => {
    assert.equal(error({ SOUNDS: "[{ at: null, cause: 'thing', role: 'x', voice: { pitch: 220 } }]" })?.message, 'sound 0 has no at: give the second it comes at, such as 1.5');
  });
  await t.test('a sound with a Symbol at and no voice is refused by its row', () => {
    assert.equal(error({ SOUNDS: "[{ at: Symbol('t'), cause: 'thing' }]" })?.message,
      'sound 0 has an at that is not a finite number of seconds, got Symbol(t): give the second it comes at, such as 1.5');
  });
});

// Every timed table refuses a row with no at by its row, and an ambience must be an object.
test('the film scaffold refuses a beat, contact or camera key with no at by its row, and an ambience that is not an object', async (t) => {
  const error = (fill) => solve(scaffold(t, { ELEMENTS: "[{ name: 'thing', enter: 0, exit: DUR }]", BEATS: '[]', ...fill })).stages.error;
  const none = (what, table, row) => t.test(`${what} with no at, and with a null at`, () => {
    for (const at of ['', 'at: null, ']) {
      assert.equal(error({ [table]: `[${row(at)}]` })?.message, `${what} 0 has no at: give the second it comes at, such as 1.5`);
    }
  });
  await none('beat', 'BEATS', (at) => `{ ${at}intensity: 0.5, element: 'thing', changes: 'x' }`);
  await none('contact', 'CONTACTS', (at) => `{ ${at}cause: 'thing', x: 10, y: 10 }`);
  await none('camera key', 'CAMERA', (at) => `{ ${at}x: 100 }`);
  for (const [what, table, good] of [['sound', 'SOUNDS', "{ at: 1, cause: 'thing', voice: { pitch: 220 } }"], ['contact', 'CONTACTS', "{ at: 1, cause: 'thing', x: 10, y: 10 }"]]) {
    await t.test(`a null, hole or list ${what} row is refused as not an object by its index`, () => {
      for (const [row, got] of [['null', 'null'], ['', 'undefined'], ["['a', 1]", '["a",1]']]) {
        assert.equal(error({ [table]: `[${good}, ${row}, ${good}]` })?.message,
          `${what} 1 is not an object, got ${got}: give each row an object such as { at: 1.5 }`);
      }
    });
  }
  for (const [table, row] of [['ELEMENTS', "{ name: 'door', enter: 0, exit: DUR }"], ['SOUNDS', "{ at: 1.5, cause: 'door', voice: { pitch: 220 } }"], ['CONTACTS', "{ at: 1.5, cause: 'door', x: 100, y: 100 }"],
    ['BEATS', "{ at: 1.5, intensity: 0.5, element: 'door', changes: 'open' }"], ['CAMERA', '{ at: 0, x: 640, y: 360, zoom: 1 }']]) {
    await t.test(`a ${table} table that is not a list is refused by its name`, () => {
      for (const [value, got] of [['{}', '{}'], ["'ab'", '"ab"'], ['0', '0']]) {
        assert.equal(error({ [table]: value })?.message, `the ${table} table is not a list of rows, got ${got}: write it as a list, such as [${row}]`);
      }
    });
  }
  await t.test('a SHOTS that is not a list is refused by its name when the film loads', () => {
    for (const [value, got] of [['{}', '{}'], ["'ab'", '"ab"'], ['0', '0']]) {
      assert.throws(() => scaffold(t, { SHOTS: value }), (e) => e.message.endsWith(`: the SHOTS table is not a list of rows, got ${got}: write it as a list, such as [['first', 4]]`));
    }
  });
  await t.test('a SHOTS row that is not a pair, or whose seconds are not a positive finite number, is refused by its index when the film loads', () => {
    for (const [row, got] of [['null', 'null'], ['', 'undefined'], ['{}', '{}'], ["['b']", '["b"]'], ["['b', 1, 2]", '["b",1,2]']]) {
      assert.throws(() => scaffold(t, { SHOTS: `[['a', 2], ${row}, ['c', 1]]` }), (e) => e.message.endsWith(`: shot 1 is not a [name, seconds] pair, got ${got}: write each row as a pair, such as ['first', 4]`));
    }
    for (const [seconds, got] of [["'4'", '"4"'], ['0', '0'], ['-2', '-2'], ['NaN', 'NaN'], ['Infinity', 'Infinity'], ['null', 'null'], ['undefined', 'undefined']]) {
      assert.throws(() => scaffold(t, { SHOTS: `[['a', 2], ['b', ${seconds}], ['c', 1]]` }), (e) => e.message.endsWith(`: shot 1 has seconds that are not a positive finite number, got ${got}: give its length in seconds, such as 4`));
    }
  });
  await t.test('an empty SHOTS is refused by its name when the film loads', () => {
    assert.throws(() => scaffold(t, { SHOTS: '[]' }), (e) => e.message.endsWith(`: the SHOTS table has no rows: add at least one shot, such as ['first', 4]`));
  });
  await t.test('a SHOTS name that is not a non-blank string is refused by its index when the film loads', () => {
    for (const [name, got] of [['5', '5'], ["''", '""'], ['null', 'null'], ['undefined', 'undefined'], ['[]', '[]']]) {
      assert.throws(() => scaffold(t, { SHOTS: `[['a', 2], [${name}, 4]]` }), (e) => e.message.endsWith(`: shot 1 has a name that is not a non-blank string, got ${got}: name it with text, such as 'first'`));
    }
  });
  await t.test('a whitespace-only SHOTS name is refused like a blank ELEMENTS name', () => {
    for (const [name, got] of [["' '", '" "'], ["'\\t\\n'", '"\\t\\n"']]) {
      assert.throws(() => scaffold(t, { SHOTS: `[['a', 2], [${name}, 4]]` }), (e) => e.message.endsWith(`: shot 1 has a name that is not a non-blank string, got ${got}: name it with text, such as 'first'`));
    }
  });
  await t.test('a SHOTS name that repeats an earlier one is refused by its index when the film loads', () => {
    assert.throws(() => scaffold(t, { SHOTS: "[['a', 2], ['b', 1], ['a', 1]]" }), (e) => e.message.endsWith(`: shot 2 repeats the name "a" of shot 0: give each shot its own name`));
  });
  for (const [what, table, good] of [['beat', 'BEATS',"{ at: 1, intensity: 0.5, element: 'thing', changes: 'x' }"], ['camera key', 'CAMERA', '{ at: 1, x: 100 }']]) {
    await t.test(`a null, hole or list ${what} row is refused as not an object by its index`, () => {
      for (const [row, got] of [['null', 'null'], ['', 'undefined'], ["['a', 1]", '["a",1]']]) {
        assert.equal(error({ [table]: `[${good}, ${row}, ${good}]` })?.message,
          `${what} 1 is not an object, got ${got}: give each row an object such as { at: 1.5 }`);
      }
    });
  }
  await t.test('a string ambience is refused by its row', () => {
    assert.equal(error({ SOUNDS: "[{ at: 1, cause: 'thing', ambience: 'rain' }]" })?.message,
      'sound 0 has an ambience that is not an object, got "rain": give its keys, such as { length: 3 }');
  });
  await t.test('a list ambience is refused by its row', () => {
    assert.equal(error({ SOUNDS: "[{ at: 1, cause: 'thing', ambience: [3] }]" })?.message,
      'sound 0 has an ambience that is not an object, got [3]: give its keys, such as { length: 3 }');
  });
  await t.test('a falsy non-object ambience is refused by its row, even beside a voice', () => {
    assert.equal(error({ SOUNDS: "[{ at: 1, cause: 'thing', voice: { pitch: 220 }, ambience: 0 }]" })?.message,
      'sound 0 has an ambience that is not an object, got 0: give its keys, such as { length: 3 }');
  });
  await t.test('a string voice is refused by its row', () => {
    assert.equal(error({ SOUNDS: "[{ at: 1, cause: 'thing', voice: 'bell' }]" })?.message,
      'sound 0 has a voice that is not an object, got "bell": give its keys, such as { pitch: 220 }');
  });
  await t.test('a list voice is refused by its row', () => {
    assert.equal(error({ SOUNDS: "[{ at: 1, cause: 'thing', voice: [220] }]" })?.message,
      'sound 0 has a voice that is not an object, got [220]: give its keys, such as { pitch: 220 }');
  });
  await t.test('a falsy non-object voice is refused by its row, even beside an ambience', () => {
    assert.equal(error({ SOUNDS: "[{ at: 1, cause: 'thing', voice: 0, ambience: { length: 1 } }]" })?.message,
      'sound 0 has a voice that is not an object, got 0: give its keys, such as { pitch: 220 }');
  });
});

// A plucked string rendered offline: one period of seeded noise through a loop
// that averages as it goes. Its pitch is the loop's length and its fall the loss each pass.
const { pluck } = require('../core/sound.js');

const plucked = (spec, seed = 1, name = 'p', at = 0) => {
  const { Context } = fakeAudio();
  return pluck(new Context(1, RATE, RATE), rng(seed), name, at, spec);
};
// The fundamental by autocorrelation over `len` samples from `from`, between
// 0.8 and 1.25 of `guess`, refined by a parabola through the best lag and its neighbours.
const fundamental = (x, from, len, guess) => {
  const r = (lag) => { let s = 0; for (let i = from; i < from + len; i++) s += x[i] * x[i + lag]; return s; };
  let best = 0, top = -Infinity;
  for (let lag = Math.floor((RATE / guess) * 0.8); lag <= Math.ceil((RATE / guess) * 1.25); lag++) {
    const v = r(lag);
    if (v > top) [best, top] = [lag, v];
  }
  const [a, c] = [r(best - 1), r(best + 1)];
  return RATE / (best + (0.5 * (a - c)) / (a - 2 * top + c));
};
const rmsAt = (x, seconds) => {
  const from = Math.floor(seconds * RATE);
  let s = 0;
  for (let i = from; i < from + 0.05 * RATE; i++) s += x[i] * x[i];
  return Math.sqrt(s / (0.05 * RATE));
};

test('pluck rings at its pitch within a cent, low notes and high', () => {
  for (const pitch of [55, 110, 220, 440, 880, 1320, 2000, 4000]) {
    const x = plucked({ pitch, decay: 1 }).buffer.getChannelData(0);
    const cents = 1200 * Math.log2(fundamental(x, 0.1 * RATE, 4096, pitch) / pitch);
    assert.ok(Math.abs(cents) < 1, `${pitch} Hz rings ${cents.toFixed(2)} cents off`);
  }
});

test('pluck falls 15 dB each quarter of its decay late in the note, high notes as long as low', () => {
  for (const [pitch, decay] of [[110, 2], [440, 1], [880, 1], [2000, 1], [4000, 0.5]]) {
    const x = plucked({ pitch, decay }).buffer.getChannelData(0);
    const quarter = 20 * Math.log10(rmsAt(x, 0.75 * decay - 0.05) / rmsAt(x, 0.5 * decay - 0.05));
    assert.ok(Math.abs(quarter + 15) < 1.5, `${pitch} Hz over ${decay} s falls ${quarter.toFixed(2)} dB a quarter`);
  }
});

test('pluck comes from the seed and the name, starts at its time, peaks at its level and fades to nothing', () => {
  const digest = (src) => require('node:crypto').createHash('sha256').update(src.buffer.getChannelData(0)).digest('hex');
  const src = plucked({ pitch: 330, decay: 0.5, level: 0.4 }, 3, 'a', 1.25);
  const x = src.buffer.getChannelData(0);
  assert.equal(src.at, 1.25);
  assert.equal(src.buffer.numberOfChannels, 1);
  assert.equal(x.length, Math.ceil(0.58 * RATE));
  assert.equal(digest(src), digest(plucked({ pitch: 330, decay: 0.5, level: 0.4 }, 3, 'a', 1.25)));
  assert.notEqual(digest(src), digest(plucked({ pitch: 330, decay: 0.5, level: 0.4 }, 4, 'a')));
  assert.notEqual(digest(src), digest(plucked({ pitch: 330, decay: 0.5, level: 0.4 }, 3, 'b')));
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  assert.ok(Math.abs(peak - 0.4) < 1e-6, `peak ${peak}`);
  assert.equal(x[x.length - 1], 0);
  assert.ok(x.every(Number.isFinite));
});

test('pluck refuses bad values by name', () => {
  for (const [spec, message] of [
    [null, /^RangeError: pluck x: spec must be an object of its keys, got null$/],
    [{}, /^RangeError: pluck x: pitch must be a frequency in hertz from 20 to an eighth of the sample rate, got undefined$/],
    [{ pitch: 19 }, /pluck x: pitch must be/],
    [{ pitch: 6001 }, /pluck x: pitch must be/],
    [{ pitch: 220, decay: 0 }, /^RangeError: pluck x: decay must be seconds above 0, at most 30, got 0$/],
    [{ pitch: 220, decay: 31 }, /pluck x: decay must be/],
    [{ pitch: 220, level: -1 }, /^RangeError: pluck x: level must be a linear level, 0 or more, got -1$/],
  ]) assert.throws(() => plucked(spec, 1, 'x'), message);
  assert.throws(() => plucked({ pitch: 220 }, 1, 'x', -1), /^RangeError: pluck x: at must be a time in seconds, 0 or later, got -1$/);
});

// The sound of contacts: one hit on a thing that rings, and many small things striking.

test('impact rings each mode at its frequency for its own time, duller for a soft or slow hit, and shaker scatters seeded collisions by its rate and energy', () => {
  const { impact, shaker } = require('../core/sound.js');
  const made = (fn, seed, name, spec, at = 0.25) => {
    const { Context, record } = fakeAudio();
    const src = fn(new Context(2, RATE * 4, RATE), rng(seed), name, at, spec);
    assert.equal(src.kind, 'bufferSource');
    assert.equal(src.at, at);
    assert.equal(record.nodes.length, 1, 'rendered offline: one source, no graph');
    return src.buffer.getChannelData(0);
  };
  const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const rms = (a, from, to) => Math.sqrt(a.subarray(Math.round(from * RATE), Math.round(to * RATE)).reduce((s, v) => s + v * v, 0) / ((to - from) * RATE));
  // The strength of one frequency in a stretch, by correlation.
  const tone = (a, hz, from, to) => {
    let re = 0, im = 0;
    for (let i = Math.round(from * RATE); i < Math.round(to * RATE); i++) { re += a[i] * Math.cos((2 * Math.PI * hz * i) / RATE); im += a[i] * Math.sin((2 * Math.PI * hz * i) / RATE); }
    return Math.hypot(re, im) / ((to - from) * RATE);
  };

  const bar = { modes: [[400, 0.8, 1], [1104, 0.4, 0.6], [2160, 0.2, 0.4]], level: 0.5 };
  const hit = made(impact, 1, 'a', bar);
  assert.equal(hit.length, Math.round(0.002 * RATE) + Math.ceil((0.8 + 0.08) * RATE), 'the push, the longest mode and the fade');
  assert.ok(Math.abs(peak(hit) - 0.5) < 1e-6, `it peaks at its level, got ${peak(hit)}`);
  assert.equal(hit[hit.length - 1], 0, 'it ends on silence');
  assert.deepEqual(made(impact, 1, 'a', bar), hit, 'one seed and name make one hit');
  assert.notDeepEqual(made(impact, 2, 'a', bar), hit);
  assert.ok(tone(hit, 400, 0.05, 0.15) > 10 * tone(hit, 700, 0.05, 0.15), 'it rings at a mode, not between modes');
  // Each mode dies over its own time: 400 Hz falls 60 dB in 0.8 s, so 30 dB between 0.1 and 0.5 s.
  const fell = (hz, from, to) => 20 * Math.log10(tone(hit, hz, from, from + 0.05) / tone(hit, hz, to, to + 0.05));
  assert.ok(Math.abs(fell(400, 0.1, 0.5) - 30) < 1.5, `400 Hz fell ${fell(400, 0.1, 0.5)} dB in 0.4 s`);
  // Alone, so no other mode leaks into the measure: 60 dB in 0.4 s, 30 dB in 0.2 s.
  const lone = made(impact, 1, 'a', { modes: [[1104, 0.4, 1]] });
  const loneFell = 20 * Math.log10(tone(lone, 1104, 0.05, 0.1) / tone(lone, 1104, 0.25, 0.3));
  assert.ok(Math.abs(loneFell - 30) < 1.5, `1104 Hz fell ${loneFell} dB in 0.2 s`);
  // A long contact leaves the high mode almost unrung; a soft hit is quieter and duller.
  const bright = (a) => tone(a, 2160, 0.02, 0.06) / tone(a, 400, 0.02, 0.06);
  const soft = made(impact, 1, 'a', { ...bar, contact: 0.004, rough: 0 }), hard = made(impact, 1, 'a', { ...bar, contact: 0.0005, rough: 0 });
  assert.ok(bright(hard) > 5 * bright(soft), `a short contact is brighter: ${bright(hard)} against ${bright(soft)}`);
  const gentle = made(impact, 1, 'a', { ...bar, contact: 0.0004, rough: 0, velocity: 0.3 }), full = made(impact, 1, 'a', { ...bar, contact: 0.0004, rough: 0 });
  assert.ok(Math.abs(peak(gentle) - 0.15) < 1e-6, 'velocity scales the level');
  assert.ok(bright(gentle) < bright(full), 'and a gentler hit is duller');
  assert.equal(peak(made(impact, 1, 'a', { ...bar, velocity: 0 })), 0, 'no hit, no sound');

  const rain = { length: 2, rate: 400, ring: 0.004, modes: [[5000, 0.003, 1]], level: 0.3 };
  const fall = made(shaker, 1, 'r', rain);
  assert.equal(fall.length, 2 * RATE);
  assert.ok(Math.abs(peak(fall) - 0.3) < 1e-6);
  assert.equal(fall[fall.length - 1], 0);
  assert.deepEqual(made(shaker, 1, 'r', rain), fall);
  assert.notDeepEqual(made(shaker, 2, 'r', rain), fall);
  // More collisions hold more sound; energy and rate curves shape it in time.
  const even = (spec) => { const a = made(shaker, 1, 'r', { ...rain, ...spec }); return rms(a, 0.1, 1.9) / peak(a); };
  assert.ok(even({ rate: 4000 }) > 1.5 * even({ rate: 100 }), 'a dense fall is fuller than a sparse one');
  const build = made(shaker, 1, 'r', { ...rain, energy: [[0, 0], [2, 1]] });
  assert.ok(rms(build, 1.4, 1.9) > 3 * rms(build, 0.1, 0.6), 'energy that builds is heard building');
  const thin = made(shaker, 1, 'r', { ...rain, rate: [[0, 2000], [1, 0]] });
  assert.equal(rms(thin, 1.2, 1.9), 0, 'no collisions, no sound');
  assert.ok(rms(thin, 0, 0.3) > 0);
  // Its colour is what is struck.
  const low = made(shaker, 1, 'r', { ...rain, modes: [[600, 0.01, 1]] });
  assert.ok(tone(low, 600, 0.5, 1.5) / tone(low, 5000, 0.5, 1.5) > 20 * (tone(fall, 600, 0.5, 1.5) / tone(fall, 5000, 0.5, 1.5)));

  for (const [fn, spec, message] of [
    [impact, null, /^RangeError: impact x: spec must be an object of its keys, got null$/],
    [impact, {}, /^RangeError: impact x: modes must be a list of \[hertz, seconds, level\] triples$/],
    [impact, { modes: [[30000, 1, 1]] }, /^RangeError: impact x: modes 0 frequency must be hertz under half the sample rate, got 30000$/],
    [impact, { modes: [[400, 0, 1]] }, /^RangeError: impact x: modes 0 decay must be seconds above 0, at most 30, got 0$/],
    [impact, { modes: [[400, 1, -1]] }, /^RangeError: impact x: modes 0 level must be a linear level, 0 or more, got -1$/],
    [impact, { ...bar, contact: 1 }, /^RangeError: impact x: contact must be seconds from 0\.0002 to 0\.05, got 1$/],
    [impact, { ...bar, velocity: 2 }, /^RangeError: impact x: velocity must be from 0 to 1, got 2$/],
    [impact, { ...bar, rough: -1 }, /^RangeError: impact x: rough must be from 0 to 1, got -1$/],
    [shaker, { rate: 10 }, /^RangeError: shaker x: length must be seconds from 0\.08 to 600, got undefined$/],
    [shaker, { length: 1 }, /^RangeError: shaker x: rate must be collisions a second from 0 to 20000, got undefined$/],
    [shaker, { length: 1, rate: 10, energy: 2 }, /^RangeError: shaker x: energy must be from 0 to 1, got 2$/],
    [shaker, { length: 1, rate: 10, ring: 0 }, /^RangeError: shaker x: ring must be seconds above 0, at most 2, got 0$/],
    [shaker, { length: 1, rate: [[1, 5], [0, 5]] }, /^RangeError: shaker x: rate time must be seconds, 0 or more and in order, got 0$/],
  ]) assert.throws(() => made(fn, 1, 'x', spec), message);
});

// Music under the caused sounds: the dip is worked out from the score, so it is
// pinned here at fixed times, with no signal to listen to.

const { ducking, duck } = require('../core/sound.js');

test('ducking dips before a caused sound lands, holds through it and lets go slowly, by what its level passes the threshold', () => {
  const at = (pts, t) => {
    const k = pts.findIndex(([s]) => s > t + 1e-9);
    if (k < 0) return pts[pts.length - 1][1];
    if (k === 0) return pts[0][1];
    const [[t0, g0], [t1, g1]] = [pts[k - 1], pts[k]];
    return g0 + ((g1 - g0) * (t - t0)) / (t1 - t0);
  };
  const dB = (g) => -20 * Math.log10(g);
  const near = (got, want, what) => assert.ok(Math.abs(got - want) < 0.005, `${what}: ${got.toFixed(4)} dB, not ${want}`);
  // One event with no level asks for the whole depth: 6 dB from 0.91 s to 1.5 s.
  const one = ducking([{ at: 1, length: 0.5 }], { length: 6 });
  assert.deepEqual(one[0], [0, 1]);
  assert.ok(one.every(([t], i) => i === 0 || t > one[i - 1][0]), 'the points run in time order');
  assert.ok(one.every(([, g]) => g <= 1 && g > 0.5));
  near(dB(at(one, 0.9)), 0, 'at rest before the lead');
  near(dB(at(one, 0.94)), 6 * (1 - Math.exp(-4 / 3)), 'four points into the attack');
  near(dB(at(one, 1)), 6 * (1 - Math.exp(-10 / 3)), 'as the sound lands, three attacks in');
  near(dB(at(one, 1.5)), 6 * (1 - Math.exp(-60 / 3)), 'held to the end of the sound');
  near(dB(at(one, 1.85)), 6 * (1 - Math.exp(-60 / 3)) * Math.exp(-35 / 35), 'one release after it');
  near(dB(at(one, 5.9)), 0, 'at rest again');
  assert.equal(one[one.length - 1][1], 1, 'the music ends where it started');
  assert.ok(one.length < 400, `the resting stretches hold no points, got ${one.length} of 601`);

  // A level asks as a side chain would: half the dB it passes the threshold by, at most the depth.
  const deepest = (events, opts) => Math.max(...ducking(events, { length: 4, ...opts }).map(([, g]) => dB(g)));
  near(deepest([{ at: 1, length: 1, level: 0.1 }]), 20 * Math.log10(2) / 2, 'twice the threshold');
  near(deepest([{ at: 1, length: 1, level: 0.9 }]), 6, 'a loud hit stops at the depth');
  near(deepest([{ at: 1, length: 1, level: 0.2 }], { depth: 12, ratio: 4 }), 20 * Math.log10(4) * 0.75, 'a deeper duck at a higher ratio');
  assert.deepEqual(ducking([{ at: 1, level: 0.05 }, { at: 2, level: 0.01 }, { at: 3, level: 0 }], { length: 4 }), [[0, 1]], 'a sound at or under the threshold moves nothing');
  assert.deepEqual(ducking([], { length: 4 }), [[0, 1]]);
  // Two sounds close together hold one dip, the deeper of the two.
  const pair = ducking([{ at: 1, length: 0.3, level: 0.1 }, { at: 1.2, length: 0.3, level: 0.9 }], { length: 4 });
  near(dB(at(pair, 1.1)), 3.01, 'the first sound alone');
  near(dB(at(pair, 1.5)), 6, 'the louder one over it');
  // An event at the start, and one that runs past the end.
  assert.ok(dB(at(ducking([{ at: 0, length: 0.5 }], { length: 2 }), 0.2)) > 5.9);
  assert.equal(ducking([{ at: 1.9, length: 5 }], { length: 2 }).at(-1)[0], 2);

  for (const [events, opts, message] of [
    [null, { length: 1 }, /^RangeError: ducking: events must be a list of \{ at, length, level \}, got null$/],
    [[], {}, /^RangeError: ducking: length must be seconds above 0, got undefined$/],
    [[], { length: 1, depth: -1 }, /^RangeError: ducking: depth must be dB from 0 to 60, got -1$/],
    [[], { length: 1, threshold: 0 }, /^RangeError: ducking: threshold must be a linear level above 0, got 0$/],
    [[], { length: 1, ratio: 0.5 }, /^RangeError: ducking: ratio must be 1 or more, got 0\.5$/],
    [[], { length: 1, attack: 0 }, /^RangeError: ducking: attack must be seconds above 0, got 0$/],
    [[], { length: 1, release: 0 }, /^RangeError: ducking: release must be seconds above 0, got 0$/],
    [[], { length: 1, lead: -1 }, /^RangeError: ducking: lead must be seconds, 0 or more, got -1$/],
    [[], { length: 1, rate: 5 }, /^RangeError: ducking: rate must be points a second from 10 to 1000, got 5$/],
    [[{ at: -1 }], { length: 1 }, /^RangeError: ducking: event 0 at must be a time in seconds, 0 or later, got -1$/],
    [[{ at: 0, level: -1 }], { length: 1 }, /^RangeError: ducking: event 0 level must be a linear level, 0 or more, got -1$/],
    [[3], { length: 1 }, /^RangeError: ducking: event 0 must be an object of its keys, got 3$/],
  ]) assert.throws(() => ducking(events, opts), message);
});

test('duck is one gain that follows the dip on the clock, and the film scaffold passes its music and stings through it, dry and in the room', async (t) => {
  const { Context, record } = fakeAudio();
  const ctx = new Context(2, RATE * 4, RATE);
  const g = duck(ctx, [{ at: 1, length: 0.5 }], { length: 4 });
  assert.equal(g.kind, 'gain');
  assert.deepEqual(g.gain.events[0], ['setValueAtTime', 1, 0]);
  assert.deepEqual(g.gain.events.slice(1).map(([m]) => m), Array(g.gain.events.length - 1).fill('linearRampToValueAtTime'));
  assert.deepEqual(g.gain.events.map(([, v, s]) => [s, v]), ducking([{ at: 1, length: 0.5 }], { length: 4 }));
  assert.equal(record.nodes.length, 1);

  const music = "{ at: 0, cause: 'first', role: 'music', voice: { pitch: 110, hold: 3, level: 0.05 } }";
  const sting = "{ at: 2, cause: 'first', role: 'sting', voice: { pitch: 880, decay: 0.4, level: 0.05 } }";
  const hit = "{ at: 1, cause: 'first', voice: { pitch: 220, attack: 0.01, hold: 0.2, level: 0.4 } }";
  const quiet = "{ at: 3, cause: 'first', voice: { pitch: 330, level: 0.02 } }";
  const built = async (fill) => {
    const piece = scaffold(t, fill);
    const solved = solve(piece);
    assert.equal(solved.stages.error, null);
    const audio = fakeAudio();
    await renderSound(piece, solved, { OfflineAudioContext: audio.Context });
    return { cues: solved.state.cues, nodes: audio.record.nodes, record: audio.record };
  };
  const ducked = await built({ SOUNDS: `[${music}, ${hit}, ${sting}, ${quiet}]` });
  assert.deepEqual(ducked.cues.ducks, [{ at: 1, length: 0.01 + 0.2, level: 0.4 }, { at: 3, length: 0.1, level: 0.02 }], JSON.stringify(ducked.cues.ducks));
  for (const [node, k] of arrivals(ducked.record)) assert.ok(k <= 2, `a ${node.kind} takes ${k} inputs`);
  const dipsOf = (nodes) => nodes.filter((n) => n.kind === 'gain' && n.gain.events.length > 2 && n.gain.events[1][0] === 'linearRampToValueAtTime' && n.gain.events[0][1] === 1 && n.gain.events[0][2] === 0);
  const dips = dipsOf(ducked.nodes);
  assert.equal(dips.length, 2, 'one dip over the dry music and one over its room sends');
  const want = ducking(ducked.cues.ducks, { depth: 6, threshold: 0.05, attack: 0.03, release: 0.35, length: 4 });
  for (const d of dips) assert.deepEqual(d.gain.events.map(([, v, s]) => [s, v]), want);
  const late = want.filter(([s]) => s > 1.3);
  assert.ok(Math.min(...want.map(([, g]) => g)) < 0.51 && late.every(([, g], i) => i === 0 || g >= late[i - 1][1]), 'the hit dips the music 6 dB and the quiet sound moves nothing');
  // The music and the sting reach the mix only through a dip; the caused sounds never do.
  const through = (node, seen = new Set()) => { for (const n of node.to) if (!seen.has(n)) { seen.add(n); through(n, seen); } return seen; };
  const [m, h, s2, q] = ducked.nodes.filter((n) => n.kind === 'stereoPanner');
  for (const v of [m, s2]) assert.ok(v.to.every((n) => dips.some((d) => n === d || through(n).has(d))), 'a music row has a path past the dips');
  for (const v of [h, q]) assert.ok(!dips.some((d) => through(v).has(d)), 'a caused sound passes a dip');
  // Every row still reaches the output dry and through the room, ducked or not.
  const heardBy = (run) => {
    const out = run.nodes.find((n) => n.kind === 'gain' && n.to.some((x) => x.kind === 'destination'));
    for (const v of run.nodes.filter((n) => n.kind === 'stereoPanner')) {
      assert.equal(v.to.length, 2, 'a row feeds its dry path and its send');
      const hall = v.to.filter((n) => through(n).has(run.nodes.find((x) => x.kind === 'convolver')));
      assert.equal(hall.length, 1, 'one of the two reaches the room');
      for (const n of v.to) assert.ok(through(n).has(out), 'both reach the output');
    }
  };
  heardBy(ducked);
  for (const d of dips) assert.ok(through(d).has(ducked.nodes.find((n) => n.kind === 'gain' && n.to.some((x) => x.kind === 'destination'))), 'each dip reaches the output');
  // A caused sound its gain keys silence dips nothing.
  const muted = await built({ SOUNDS: `[${music}, { at: 1, cause: 'first', voice: { pitch: 220, level: 0.4 }, gain: [[0, 0]] }]` });
  assert.deepEqual(muted.cues.ducks, []);

  // A sound that starts with music on a beat marked forward dips nothing; DUCK null leaves the music level.
  const lead = "{ at: 1, cause: 'first', role: 'music', voice: { pitch: 110, level: 0.9 } }";
  const forward = await built({ ELEMENTS: "[{ name: 'door', enter: 0, exit: DUR }]", SOUNDS: `[${lead}, ${hit}]`, BEATS: "[{ at: 1, intensity: 0.9, element: 'door', changes: 'opens', forward: true }]" });
  assert.deepEqual(forward.cues.ducks, []);
  const off = await built({ SOUNDS: `[${music}, ${hit}]`, DUCK: 'null' });
  assert.deepEqual(off.cues.ducks, []);
  for (const run of [forward, off]) { assert.equal(dipsOf(run.nodes).length, 0, 'no dip is built'); heardBy(run); }
  // An event shorter than a step still asks, and no point lands past the length.
  assert.ok(ducking([{ at: 1.005, length: 0 }], { length: 2, lead: 0 }).length > 1);
  assert.ok(ducking([{ at: 0.05 }], { length: 0.07 }).at(-1)[0] <= 0.07 + 1e-9);
  // No music: the caused sounds sum as they always did.
  const plain = await built({ SOUNDS: `[${hit}, ${quiet}]` });
  assert.equal(dipsOf(plain.nodes).length, 0);
});
