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
