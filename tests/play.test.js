'use strict';

// Interactive pieces: the play field's validation, a session as a pure
// function of seed, parameters and an input log, the log's shape, a saved
// session run again, and the film a session makes.

const test = require('node:test');
const assert = require('node:assert/strict');
const { validate, solve, PieceError, VERSION } = require('../core/piece.js');
const { drawFrame, playheads } = require('../core/render.js');
const play = require('../core/play.js');
const FIXTURE = require('../tools/fixtures/play-piece.cjs');

/** A surface that writes down every call and assignment, so two drawings compare as text. */
function recorder() {
  const calls = [];
  const surface = new Proxy({}, {
    get: (_, key) => (key === 'canvas' ? undefined : (...args) => { calls.push([key, ...args]); }),
    set: (_, key, value) => { calls.push(['=' + String(key), value]); return true; },
  });
  return { surface, text: () => JSON.stringify(calls) };
}

/** The marks of `piece` drawn from `solved` at `t`. */
function marks(piece, solved, t) {
  const r = recorder();
  drawFrame(r.surface, piece, solved, t);
  return r.text();
}

// The same small game every test plays: two presses, a drag, arrow keys and Enter.
const INPUTS = {
  3: [{ kind: 'down', x: 30, y: 40 }],
  4: [{ kind: 'move', x: 31, y: 41 }, { kind: 'move', x: 50, y: 60 }, { kind: 'up', x: 50, y: 60 }],
  9: [{ kind: 'key', key: 'ArrowRight', down: true }, { kind: 'key', key: 'ArrowRight', down: false }],
  10: [{ kind: 'key', key: 'Enter', down: true }],
  14: [{ kind: 'down', x: 120, y: 90 }],
};

function playGame(piece = FIXTURE, seed = 5, params = {}, ticks = 20) {
  const s = play.session(piece, seed, params);
  const frames = [marks(s.piece, s.solved, 0)];
  for (let k = 1; k <= ticks; k++) {
    s.advance(INPUTS[k] || []);
    frames.push(marks(s.piece, s.solved, s.tick / s.piece.play.hz));
  }
  return { s, frames };
}

test('play is validated: 60 ticks a second and both inputs by default, each key checked by name', () => {
  const p = validate(FIXTURE);
  assert.equal(p.play.hz, 60);
  assert.deepEqual(p.play.inputs, ['pointer', 'key']);
  assert.equal(typeof p.play.step, 'function');
  // Validating twice changes nothing.
  assert.deepEqual(Object.keys(validate(p).play), Object.keys(p.play));
  assert.equal(validate(p).play.hz, 60);
  const bad = (play, pattern) => assert.throws(() => validate({ ...FIXTURE, play }), (e) => e instanceof PieceError && pattern.test(e.message));
  bad({ step() {}, hz: 0 }, /^play: play\.hz must be a whole number of ticks a second from 1 to 240/);
  bad({ step() {}, hz: 30.5 }, /play\.hz must be a whole number/);
  bad({ step() {}, inputs: ['pointer', 'gamepad'] }, /play\.inputs must list one or both of pointer, key, each once/);
  bad({ step() {}, inputs: [] }, /play\.inputs must list/);
  bad({}, /play\.step must be a function \(state, inputs, tick, R\)/);
  bad({ step() {}, describe: 'hello' }, /play\.describe must be a function/);
  bad({ step() {}, speed: 2 }, /unknown key\(s\) in play: speed/);
  assert.equal(validate({ ...FIXTURE, play: null }).play, null);
});

test('a piece with play takes no timeline, soundtrack or GPU preview, refused by name', () => {
  assert.throws(() => validate({ ...FIXTURE, time: { duration: 1, hz: 10 } }), /^PieceError: play: an interactive piece runs as long as its session, so it takes no time/);
  assert.throws(() => validate({ ...FIXTURE, sound() {} }), /^PieceError: sound: a piece with play has no fixed length for a soundtrack/);
  const preview = { kind: 'webgpu-pixels', wgsl: 'fn main() {}', uniforms: () => [] };
  assert.throws(() => validate({ ...FIXTURE, preview }), /^PieceError: preview: a piece with play draws live and in its exports with one draw/);
  assert.throws(() => validate({ ...FIXTURE, boxes: { w: [80, 160], h: [60, 120] } }), /^PieceError: boxes: a piece with play draws at its own size, so every session replays at the box it was played at; drop boxes$/);
});

test('a session is a pure function of seed, parameters and input log: the same game draws the same frames', () => {
  const a = playGame(), b = playGame();
  assert.equal(a.frames.length, 21);
  const differ = a.frames.findIndex((f, i) => f !== b.frames[i]);
  assert.equal(differ, -1, 'frame ' + differ + ' differs between two runs of one game');
  assert.deepEqual(a.s.state.marks, b.s.state.marks);
  assert.equal(a.s.state.marks.length, 3);
  assert.deepEqual(a.s.state.cursor, { x: 4, y: 2 });
  // The seed reaches step through R: another seed colours the same marks differently.
  const c = playGame(FIXTURE, 6);
  assert.notDeepEqual(c.s.state.marks.map((m) => m.hue), a.s.state.marks.map((m) => m.hue));
  assert.deepEqual(c.s.state.marks.map((m) => [m.x, m.y]), a.s.state.marks.map((m) => [m.x, m.y]));
  // A parameter reaches draw.
  const d = playGame(FIXTURE, 5, { reach: 18 });
  assert.notEqual(d.frames[20], a.frames[20]);
});

test('draw sees the session time: tick / hz, plus the part of a tick already passed', () => {
  const s = play.session(FIXTURE, 1);
  s.advance([]);
  const p = s.piece;
  assert.notEqual(marks(p, s.solved, 1 / 60), marks(p, s.solved, 1.5 / 60), 'idle motion between ticks is lost');
  const seen = [];
  const piece = { ...FIXTURE, draw: (g, st, t, clock) => seen.push([t, clock.tick, clock.hz]) };
  const q = play.session(piece, 1);
  drawFrame(recorder().surface, q.piece, q.solved, 2.5 / 60);
  assert.deepEqual(seen, [[2.5 / 60, 2, 60]]);
});

test('advance records each input in the log by tick, moves within a tick folded to the last, and refuses an input by shape', () => {
  const { s } = playGame();
  assert.deepEqual(s.log, [
    [3, 'down', 30, 40],
    [4, 'move', 50, 60], [4, 'up', 50, 60],
    [9, 'key', 'ArrowRight', true], [9, 'key', 'ArrowRight', false],
    [10, 'key', 'Enter', true],
    [14, 'down', 120, 90],
  ]);
  const fresh = () => play.session(FIXTURE, 1);
  assert.throws(() => fresh().advance([{ kind: 'tap', x: 1, y: 1 }]), /^PieceError: play: input 0 has kind "tap"; an input is down, move or up with x and y, or key with key and down/);
  assert.throws(() => fresh().advance([{ kind: 'down', x: Infinity, y: 1 }]), /play: input 0, a down, needs finite x and y in design units/);
  assert.throws(() => fresh().advance([{ kind: 'key', key: '', down: true }]), /play: input 0, a key, needs the key's name, 1 to 32 characters, and down true or false/);
  assert.throws(() => fresh().advance({}), /play: advance takes a list of inputs/);
  const keysOnly = play.session({ ...FIXTURE, play: { ...FIXTURE.play, inputs: ['key'] } }, 1);
  assert.throws(() => keysOnly.advance([{ kind: 'down', x: 1, y: 1 }]), /play: input 0 is a pointer input and play-piece listens only to key/);
  // A step that throws leaves the tick unplayed and its inputs out of the log.
  const failing = play.session({ ...FIXTURE, play: { ...FIXTURE.play, step() { throw new Error('no'); } } }, 1);
  assert.throws(() => failing.advance([{ kind: 'down', x: 1, y: 1 }]), /^Error: no$/);
  assert.deepEqual([failing.tick, failing.log], [0, []]);
  // step gets copies: changing them changes nothing in the log.
  const piece = { ...FIXTURE, play: { ...FIXTURE.play, step(st, inputs) { inputs[0].x = 999; } } };
  const t = play.session(piece, 1);
  t.advance([{ kind: 'down', x: 2, y: 3 }]);
  assert.deepEqual(t.log, [[1, 'down', 2, 3]]);
});

test('a saved session carries the manifest fields with hz, ticks and log, and runs again to the same state and frames', () => {
  const { s, frames } = playGame();
  const saved = JSON.parse(JSON.stringify(s.save()));
  assert.deepEqual(Object.keys(saved), ['artifex', 'piece', 'seed', 'size', 'outputs', 'params', 'hz', 'ticks', 'log']);
  assert.equal(saved.artifex, VERSION);
  assert.equal(saved.ticks, 20);
  assert.deepEqual(saved.params, { reach: 10 });
  const again = [];
  const r = play.rerun(FIXTURE, saved, (q) => again.push(marks(q.piece, q.solved, q.tick / 60)));
  assert.equal(r.tick, 20);
  assert.equal(again.length, 21);
  const differ = again.findIndex((f, i) => f !== frames[i]);
  assert.equal(differ, -1, 'frame ' + differ + ' differs on the re-run');
  assert.deepEqual(r.log, saved.log);
  assert.deepEqual(r.state.marks, s.state.marks);
});

test('a session file is checked by shape before anything runs, and never executed', () => {
  const saved = JSON.parse(JSON.stringify(playGame().s.save()));
  const bad = (change, pattern) => assert.throws(() => play.rerun(FIXTURE, { ...saved, ...change }), (e) => e instanceof PieceError && pattern.test(e.message), JSON.stringify(change));
  bad({ piece: 'other' }, /^session: the session is of piece "other", not play-piece/);
  bad({ artifex: '0.0.1' }, /session: the session was made by artifex "0.0.1" and this is 0\.1\.0/);
  bad({ hz: 30 }, /session: the session ticks 30 times a second and play-piece ticks 60/);
  bad({ size: { w: 1, h: 1 } }, /session: the session was played at \{"w":1,"h":1\} and play-piece draws at \{"w":160,"h":120\}/);
  bad({ seed: -1 }, /session: seed must be an integer in \[0, 2\^32-1\]/);
  bad({ params: { reach: 99 } }, /session: params\.reach must be a finite number in \[4, 20\], got 99/);
  bad({ params: { width: 1 } }, /session: unknown param: width/);
  bad({ ticks: 2.5 }, /session: ticks must be a whole number from 0 to 216000/);
  bad({ ticks: 13 }, /session: log row 6 is at tick 14, after the session's 13 ticks/);
  bad({ log: 'down' }, /session: log must be a list of \[tick, kind, \.\.\.values\] rows/);
  bad({ log: [[0, 'down', 1, 1]] }, /session: log row 0 is at tick 0; ticks start at 1/);
  bad({ log: [[5, 'down', 1, 1], [4, 'up', 1, 1]] }, /session: log row 1 is at tick 4, before row 0's tick 5; rows are in tick order/);
  bad({ log: [[1, 'down', 1]] }, /session: log row 0: a down row is \[tick, 'down', x, y\]/);
  bad({ log: [[1, 'key', 'a']] }, /session: log row 0: a key row is \[tick, 'key', key, down\]/);
  bad({ log: [[1, 'eval', 'alert(1)']] }, /session: log row 0 has kind "eval"/);
  bad({ log: Array.from({ length: play.MAX_EVENTS + 1 }, () => [1, 'up', 0, 0]) }, /session: log holds 50001 rows, more than the 50000 a session may/);
  assert.throws(() => play.rerun(FIXTURE, null), /^PieceError: session: a session is a JSON object/);
  assert.throws(() => play.session({ ...FIXTURE, play: null }), /^PieceError: play: play-piece declares no play, so it has no session/);
});

test('a session whose build fails is refused with the stage that threw', () => {
  const piece = { ...FIXTURE, build: [['lay', () => { throw new Error('no table'); }]] };
  assert.throws(() => play.session(piece, 1), /^PieceError: play: build stage "lay" \(1 of 1\) threw: no table/);
});

test('the log digest names the log: any change to it changes the digest', () => {
  const log = playGame().s.save().log;
  assert.match(play.digest(log), /^fnv1a32:[0-9a-f]{8}$/);
  assert.equal(play.digest(log), play.digest(JSON.parse(JSON.stringify(log))));
  const moved = log.map((r) => r.slice());
  moved[0][2] = 31;
  assert.notEqual(play.digest(moved), play.digest(log));
});

test('a session keeps a copy of each sound cue its steps push, in order, and refuses a cue by shape', () => {
  const { s } = playGame();
  assert.deepEqual(s.sounds.map((c) => [c.tick, c.name]), [[3, 'mark 1'], [10, 'mark 2'], [14, 'mark 3']]);
  // A copy: the state's own row may change afterwards without changing what is heard.
  s.state.cues.sounds[0].impact.velocity = 0.1;
  assert.equal(s.sounds[0].impact.velocity, 0.8);
  const pushing = (row, build) => play.session({ ...FIXTURE, state: () => ({ cues: { sounds: build ? [row] : [] } }), play: { step: (st) => { if (!build) st.cues.sounds.push(row); } } }, 1);
  const bad = (row, pattern, build = false) => assert.throws(() => pushing(row, build).advance([]), (e) => e instanceof PieceError && pattern.test(e.message), JSON.stringify(row));
  const knock = { modes: [[440, 0.2, 1]] };
  bad({ tick: 0, name: 'a', impact: knock }, /^play: sound cue 0, pushed at tick 1: its tick must be a whole number from the tick it was pushed in, 1, to 216000, got 0$/);
  bad({ tick: 1, impact: knock }, /sound cue 0, pushed at tick 1: its name must be 1 to 64 characters/);
  bad({ tick: 1, name: 'a' }, /it must hold exactly one of voice, pluck, impact, shaker, ambience, got none/);
  bad({ tick: 1, name: 'a', impact: knock, pluck: { pitch: 220 } }, /got pluck and impact/);
  bad({ tick: 1, name: 'a', impact: 'thud' }, /its impact must be the object impact\(\) takes/);
  bad({ tick: 1, name: 'a', impact: knock, wet: 2 }, /its wet must be from 0 to 1, got 2/);
  assert.throws(() => pushing({ tick: 0, name: 'a', impact: 'x' }, true), /^PieceError: play: sound cue 0, pushed at tick 0: its impact must be/);
  // A cue the build pushes at tick 0 is heard, and one for a later tick may wait for it.
  assert.equal(pushing({ tick: 0, name: 'bed', impact: knock }, true).sounds.length, 1);
  assert.equal(pushing({ tick: 9, name: 'later', impact: knock }).advance([]).sounds[0].tick, 9);
  const shrinking = play.session({ ...FIXTURE, state: () => ({ cues: { sounds: [{ tick: 0, name: 'a', impact: knock }] } }), play: { step: (st) => { st.cues.sounds.pop(); } } }, 1);
  assert.throws(() => shrinking.advance([]), /^PieceError: play: state\.cues\.sounds only grows, and tick 1 left 0 of its 1 cues$/);
  const notList = play.session({ ...FIXTURE, state: () => ({ cues: {} }), play: { step: (st) => { st.cues.sounds = 'knock'; } } }, 1);
  assert.throws(() => notList.advance([]), /play: state\.cues\.sounds must be a list of sound cues/);
});

test('a session film renders its cues offline, each at its tick, dry and through one room; a silent session makes a silent film', () => {
  const { fakeAudio } = require('./fake-media.js');
  const saved = JSON.parse(JSON.stringify(playGame().s.save()));
  const f = play.film(FIXTURE, saved);
  assert.equal(typeof f.sound, 'function');
  const { Context, record } = fakeAudio();
  const ctx = new Context(2, 48000, 48000);
  f.sound(ctx, solve(f).state, f.time);
  const knocks = record.nodes.filter((n) => n.kind === 'bufferSource');
  assert.deepEqual(knocks.map((n) => n.at), [3 / 60, 10 / 60, 14 / 60]);
  assert.equal(record.nodes.filter((n) => n.kind === 'convolver').length, 1, 'one room for every wet cue');
  // Every input takes at most two, so the render is the same every time.
  const inputs = new Map();
  for (const n of record.nodes) for (const t of n.to) inputs.set(t, (inputs.get(t) || 0) + 1);
  assert.equal(Math.max(...inputs.values()), 2);
  assert.equal(inputs.get(ctx.destination), 2);
  // The same cues render the same graph again.
  const again = fakeAudio();
  f.sound(new again.Context(2, 48000, 48000), solve(f).state, f.time);
  assert.equal(JSON.stringify(again.record.nodes.map((n) => [n.kind, n.at])), JSON.stringify(record.nodes.map((n) => [n.kind, n.at])));
  const quiet = play.session(FIXTURE, 1);
  quiet.advance([]);
  assert.equal(play.film(FIXTURE, JSON.parse(JSON.stringify(quiet.save()))).sound, null);
});

test('reduced motion is the player\'s: draw sees it in the clock, the saved session keeps it, and its film draws with it', () => {
  const seen = [];
  const piece = { ...FIXTURE, draw: (g, st, t, clock) => seen.push(clock.reducedMotion) };
  const s = play.session(piece, 1, {}, { reducedMotion: true });
  s.advance([]);
  drawFrame(recorder().surface, s.piece, s.solved, 1 / 60, { reducedMotion: s.reducedMotion });
  drawFrame(recorder().surface, s.piece, s.solved, 1 / 60);
  assert.deepEqual(seen, [true, false]);
  const saved = JSON.parse(JSON.stringify(s.save()));
  assert.equal(saved.reducedMotion, true);
  assert.equal('reducedMotion' in play.session(FIXTURE, 1).save(), false, 'a session played with full motion saves no flag');
  assert.equal(play.rerun(piece, saved).reducedMotion, true);
  const f = play.film(piece, saved);
  const solved = solve(f);
  assert.equal(solved.manifest.session.reducedMotion, true);
  seen.length = 0;
  drawFrame(recorder().surface, f, solved, 0);
  assert.deepEqual(seen, [true]);
  // The fixture's hand holds still: two ticks draw alike under reduced motion and differ without it.
  const still = play.session(FIXTURE, 1, {}, { reducedMotion: true });
  const at = (q, k) => { const r = recorder(); drawFrame(r.surface, q.piece, q.solved, k / 60, { reducedMotion: q.reducedMotion }); return r.text(); };
  assert.equal(at(still, 0), at(still, 1.5));
  const moving = play.session(FIXTURE, 1);
  assert.notEqual(at(moving, 0), at(moving, 1.5));
  assert.throws(() => play.rerun(FIXTURE, { ...saved, piece: 'play-piece', reducedMotion: false }), /^PieceError: session: reducedMotion is true when the session was played with reduced motion, and absent otherwise$/);
});

test('a session makes a film: one frame per tick, each the frame the game drew, in any order, with the log in its manifest', () => {
  const { s, frames } = playGame();
  const saved = JSON.parse(JSON.stringify(s.save()));
  const f = play.film(FIXTURE, saved, 'game.session.json');
  assert.equal(f.name, 'play-piece');
  assert.equal(f.play, null);
  assert.deepEqual(f.time, { duration: 21 / 60, hz: 60 });
  const heads = playheads(f);
  assert.equal(heads.length, 21);
  const solved = solve(f, saved.seed, saved.params);
  assert.deepEqual(solved.manifest.session, { hz: 60, ticks: 20, digest: play.digest(saved.log), file: 'game.session.json' });
  assert.equal(solved.manifest.seed, 5);
  assert.deepEqual(solved.manifest.params, { reach: 10 });
  // Forward, then backward, then a jump: each frame is the game's at that tick.
  for (const i of [...heads.keys(), 20, 3, 0, 17, 17]) {
    assert.equal(marks(f, solved, heads[i]), frames[i], 'film frame ' + i);
  }
  // The film's own seed and parameters are the session's, so a caller that passes none still draws the game.
  assert.equal(marks(f, solve(f), heads[20]), frames[20]);
  // A film without a file name records none.
  assert.equal('file' in solve(play.film(FIXTURE, saved)).manifest.session, false);
  // A film of a piece without play, or of another piece's session, is refused.
  assert.throws(() => play.film({ ...FIXTURE, play: null }, saved), /play-piece declares no play/);
});
