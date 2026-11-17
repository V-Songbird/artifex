'use strict';

// The page's play mode on a stand-in page: ticks paced by real time with a
// catch-up cap, a hidden page that holds its tick, pointer and key input
// normalised and logged by tick, restart, save session, the describe live
// region, exports held back while playing, and a saved session's film taking
// the piece's place.

const test = require('node:test');
const assert = require('node:assert/strict');
const { fakePage } = require('./fake-media.js');

function registry(module) {
  module.exports = {
    game: {
      name: 'game', size: { w: 80, h: 60 }, seed: 3,
      state: () => ({ inputs: [] }),
      play: {
        step(s, inputs, tick) { for (const e of inputs) s.inputs.push({ tick, ...e }); },
        describe: (s) => s.inputs.length + ' inputs so far',
      },
      draw(g, s, t) { g.fillRect(0, 0, 10 + s.inputs.length, 10 + t); },
    },
  };
}

function openGame(modules = { 'examples/index.js': registry }) {
  // The page's clock, which a test moves by hand.
  const clock = { now: 0 };
  const page = fakePage({
    modules,
    // The canvas shows at twice its design box, so a press is halved into design units.
    fields: () => ({ disabled: false, getBoundingClientRect: () => ({ left: 10, top: 20, width: 160, height: 120 }), focus() {} }),
    now: () => clock.now,
  });
  return { ...page, clock, c: page.elements.get('c'), el: (id) => page.document.getElementById(id) };
}

const press = (kind, x, y, more = {}) => ({ clientX: x, clientY: y, isPrimary: true, pointerId: 1, preventDefault() {}, ...more });
const key = (k, more = {}) => ({ key: k, preventDefault() {}, ...more });
// The page runs in its own realm, so what it hands back is compared as plain data.
const plain = (v) => JSON.parse(JSON.stringify(v));

test('a piece with play ticks at its rate, hands each tick the inputs that landed in it, and logs them in design units', () => {
  const { api, c, frame, el, png } = openGame();
  assert.deepEqual(plain(api.read().play), { tick: 0, hz: 60, inputs: 0, describe: '0 inputs so far', cues: 0, heard: 0, sound: null, reducedMotion: false });
  assert.equal(el('playGroup').hidden, false);
  assert.equal(el('describe').textContent, '0 inputs so far');
  // Exports wait for a saved session; restart and save session are on.
  assert.equal(png.disabled, true);
  assert.equal(el('svg').disabled, true);
  assert.equal(el('saveSession').disabled, false);
  assert.equal(c.attributes.role, 'application');
  frame(50);
  assert.equal(api.read().play.tick, 3);
  c.onpointerdown(press('down', 50, 50));
  c.onpointermove(press('move', 60, 60));
  c.onpointermove(press('move', 90, 80));
  // A second finger is not the pointer.
  c.onpointerdown(press('down', 0, 0, { isPrimary: false }));
  frame(70);
  c.onkeydown(key('ArrowLeft'));
  c.onkeydown(key('ArrowLeft', { repeat: true }));
  c.onkeydown(key('s', { ctrlKey: true }));
  c.onkeydown(key('Tab'));
  c.onkeydown(key('Shift'));
  c.onkeyup(key('ArrowLeft'));
  frame(90);
  assert.equal(api.read().play.tick, 5);
  assert.deepEqual(plain(api.saveSession().log), [
    [4, 'down', 20, 15], [4, 'move', 40, 30],
    [5, 'key', 'ArrowLeft', true], [5, 'key', 'ArrowLeft', false],
  ]);
  assert.equal(el('describe').textContent, '4 inputs so far');
  assert.equal(el('tickread').textContent, 'tick 5, 4 inputs');
});

test('a stall plays at most four ticks, and a hidden page advances none', () => {
  const { api, frame, document } = openGame();
  frame(50);
  assert.equal(api.read().play.tick, 3);
  frame(10000);
  assert.equal(api.read().play.tick, 7, 'a ten-second stall replayed as a burst');
  document.hidden = true;
  frame(20000);
  frame(30000);
  assert.equal(api.read().play.tick, 7, 'a hidden page advanced the session');
  document.hidden = false;
  frame(30050);
  assert.equal(api.read().play.tick, 10, 'the time the page was hidden reached the session');
});

test('a page hidden with no animation frames at all holds its tick from the moment it hides until it shows again', () => {
  const { api, frame, document, clock } = openGame();
  frame(50);
  assert.equal(api.read().play.tick, 3);
  // A real browser runs no frame while hidden: only the visibility events mark the gap.
  clock.now = 50;
  document.hidden = true;
  document.onvisibilitychange();
  clock.now = 60000;
  document.hidden = false;
  document.onvisibilitychange();
  frame(60000);
  assert.equal(api.read().play.tick, 3, 'the hidden minute reached the session as a burst on return');
  frame(60050);
  assert.equal(api.read().play.tick, 6);
});

test('a step that throws stops play with the error shown, and save session keeps every tick played before it', () => {
  function throwing(module) {
    module.exports = {
      game: {
        name: 'game', size: { w: 80, h: 60 }, seed: 3, state: () => ({ n: 0 }),
        play: { step(s, inputs, tick) { if (tick === 3) throw new Error('board on fire'); s.n = tick; } },
        draw(g, s) { g.fillRect(0, 0, s.n, 1); },
      },
    };
  }
  const { api, c, frame, el } = openGame({ 'examples/index.js': throwing });
  c.onpointerdown(press('down', 30, 40));
  frame(30);
  assert.equal(api.read().play.tick, 1);
  frame(40);
  assert.equal(api.read().play.tick, 2);
  c.onpointerdown(press('down', 50, 50));
  frame(55);
  assert.equal(api.read().play.tick, 2);
  assert.equal(el('err').textContent, 'Play stopped at tick 2: board on fire. Save session keeps the ticks played so far.');
  const saved = plain(api.saveSession());
  // The press that landed in the failed tick is not in the log, so the file runs again cleanly.
  assert.deepEqual(saved.log, [[1, 'down', 10, 10]]);
  assert.equal(saved.ticks, 2);
  assert.equal(api.play.rerun(api.examples.game, saved).tick, 2);
  frame(500);
  assert.equal(api.read().play.tick, 2, 'play went on after the step threw');
});

test('a describe that throws stops play with its error shown', () => {
  function telling(module) {
    module.exports = {
      game: {
        name: 'game', size: { w: 80, h: 60 }, state: () => ({}),
        play: { step() {}, describe() { throw new Error('no words'); } },
        draw(g) { g.fillRect(0, 0, 1, 1); },
      },
    };
  }
  const { api, el } = openGame({ 'examples/index.js': telling });
  assert.equal(el('err').textContent, 'play.describe threw at tick 0: no words');
  assert.equal(api.read().play.tick, 0);
});

test('the page plays each cue live once, after the first gesture made its context, and plays the session under reduced motion when asked', () => {
  const { fakeAudio } = require('./fake-media.js');
  const { Context, record } = fakeAudio();
  class Live extends Context {
    constructor() { super(2, 0, 48000); Object.assign(this, { state: 'suspended', currentTime: 2, baseLatency: 0.01 }); }
    resume() { this.state = 'running'; }
  }
  const drawn = [];
  function knocking(module) {
    module.exports = {
      game: {
        name: 'game', size: { w: 80, h: 60 }, state: () => ({ cues: { sounds: [] } }),
        play: {
          step(s, inputs, tick) {
            for (const e of inputs) if (e.kind === 'down') s.cues.sounds.push({ tick, name: 'knock ' + tick, impact: { modes: [[500, 0.2, 1]] }, wet: 0.3 });
          },
        },
        draw(g, s, t, clock) { globalThis.drawn.push(clock.reducedMotion); g.fillRect(0, 0, 1, 1); },
      },
    };
  }
  const clock = { now: 0 };
  const page = fakePage({
    modules: { 'examples/index.js': knocking }, now: () => clock.now,
    fields: () => ({ disabled: false, getBoundingClientRect: () => ({ left: 0, top: 0, width: 80, height: 60 }), focus() {} }),
    window: { matchMedia: (q) => ({ matches: q === '(prefers-reduced-motion: reduce)' }) },
    globals: { AudioContext: Live, drawn },
  });
  const { api, frame } = page, c = page.elements.get('c');
  const read = () => plain(api.read().play);
  assert.equal(read().sound, null, 'no context before a gesture');
  assert.equal(read().reducedMotion, true);
  assert.equal(drawn.every((r) => r === true) && drawn.length > 0, true);
  c.onpointerdown(press('down', 10, 10));
  frame(clock.now = 20);
  assert.deepEqual([read().cues, read().heard, read().sound], [1, 1, 'running']);
  const knocks = () => record.nodes.filter((n) => n.kind === 'bufferSource');
  assert.equal(knocks().length, 1);
  assert.ok(Math.abs(knocks()[0].at - 2.01) < 1e-9, 'played at once, after the output latency');
  assert.equal(record.nodes.filter((n) => n.kind === 'convolver').length, 1);
  // Later ticks play nothing again; a second press plays one more, into the same room.
  frame(clock.now = 60);
  assert.equal(knocks().length, 1);
  c.onpointerdown(press('down', 20, 20));
  frame(clock.now = 80);
  assert.equal(knocks().length, 2);
  assert.equal(record.nodes.filter((n) => n.kind === 'convolver').length, 1);
  assert.equal(JSON.parse(JSON.stringify(api.saveSession())).reducedMotion, true);
});

test('the page re-runs its own saved session to the same state, and restart plays again from tick 0', () => {
  const { api, c, frame, el, downloads } = openGame();
  const ticks = [];
  api.onTick((s) => ticks.push(s.tick));
  c.onpointerdown(press('down', 30, 40));
  frame(50);
  c.onkeydown(key('Enter'));
  frame(100);
  assert.deepEqual(ticks, [1, 2, 3, 4, 5, 6]);
  const saved = JSON.parse(JSON.stringify(api.saveSession()));
  assert.equal(saved.ticks, 6);
  assert.equal(saved.seed, 3);
  const again = api.play.rerun(api.examples.game, saved);
  assert.equal(again.tick, 6);
  assert.deepEqual(JSON.parse(JSON.stringify(again.state.inputs)), [
    { tick: 1, kind: 'down', x: 10, y: 10 }, { tick: 4, kind: 'key', key: 'Enter', down: true },
  ]);
  el('saveSession').onclick();
  assert.deepEqual(downloads, ['game-3.session.json']);
  el('restart').onclick();
  assert.deepEqual(plain(api.read().play), { tick: 0, hz: 60, inputs: 0, describe: '0 inputs so far', cues: 0, heard: 0, sound: null, reducedMotion: false });
  api.onTick(null);
  frame(200);
  assert.deepEqual(ticks, [1, 2, 3, 4, 5, 6]);
});

test('a saved session\'s film takes its piece\'s place: one frame a tick, and a manifest naming the session', () => {
  const { api, c, frame, png } = openGame();
  c.onpointerdown(press('down', 30, 40));
  frame(50);
  frame(100);
  const saved = JSON.parse(JSON.stringify(api.saveSession()));
  assert.deepEqual(plain(api.session(saved, 'game-3.session.json')), { piece: 'game', ticks: 6, hz: 60, frames: 7 });
  api.select('game');
  const read = api.read();
  assert.equal(read.play, null);
  assert.equal(read.frames, 7);
  assert.equal(png.disabled, false);
  api.setT(1);
  const m = api.manifest();
  assert.deepEqual(plain(m.session), { hz: 60, ticks: 6, digest: api.play.digest(saved.log), file: 'game-3.session.json' });
  assert.equal(m.t, 1);
  // A second session replaces the first, from the piece's own declaration.
  assert.equal(api.session({ ...saved, ticks: 8 }, 'b.session.json').frames, 9);
  assert.throws(() => api.session({ ...saved, piece: 'other' }), /session: this page has no piece named "other"/);
  assert.throws(() => api.session({ ...saved, hz: 30 }), /session: the session ticks 30 times a second and game ticks 60/);
});
