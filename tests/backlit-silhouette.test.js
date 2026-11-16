// The backlit-silhouette style: the lit screen, gels that multiply, cards that hide.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { rng } = require('../core/rand.js');
const B = require('../skills/artifex/styles/backlit-silhouette.js');

// A context that logs what it is told, with no canvas behind it.
function surface(scale = 1) {
  const log = [];
  const g = { log, state: {} };
  for (const k of ['save', 'restore', 'beginPath', 'closePath', 'rect', 'clip', 'moveTo', 'lineTo', 'fill', 'fillRect']) g[k] = (...a) => log.push([k, ...a]);
  g.getTransform = () => ({ a: scale, b: 0, c: 0, d: scale, e: 0, f: 0 });
  g.createRadialGradient = (...at) => ({ at, stops: [], addColorStop(t, c) { this.stops.push([t, c]); } });
  for (const k of ['fillStyle', 'globalCompositeOperation', 'globalAlpha']) {
    Object.defineProperty(g, k, { set(v) { g.state[k] = v; log.push(['set', k, v]); }, get() { return g.state[k]; } });
  }
  return g;
}

const SQUARE = [[0, 0], [10, 0], [10, 10], [0, 10]];
const HOLE = [[4, 4], [6, 4], [6, 6], [4, 6]];
const steps = (g) => g.log.filter((e) => e[0] === 'fill' || e[0] === 'moveTo' || e[0] === 'rect' || (e[0] === 'set' && e[1] !== 'fillStyle')).map((e) => e.join(' '));

test('backlit-silhouette screen: hottest at the lamp, the light at mid distance, fallen at the reach, then fibre', () => {
  const g = surface();
  B.screen(g, rng(3), 400, 300, { light: '#c8a064', lamp: [100, 300], fall: 0.5, fibre: 1000 });
  const glow = g.log.find((e) => e[0] === 'set' && e[1] === 'fillStyle')[2];
  // The far corner from (100, 300) is (400, 0).
  assert.deepEqual(glow.at, [100, 300, 0, 100, 300, Math.hypot(300, 300)]);
  assert.deepEqual(glow.stops, [[0, 'rgb(233, 217, 193)'], [0.45, 'rgb(200, 160, 100)'], [1, 'rgb(100, 80, 50)']]);
  const rects = g.log.filter((e) => e[0] === 'fillRect');
  assert.deepEqual(rects[0], ['fillRect', 0, 0, 400, 300]);
  assert.equal(rects.length, 1 + 120, 'a thousand specks per million square units');
  const again = surface();
  B.screen(again, rng(3), 400, 300, { light: '#c8a064', lamp: [100, 300], fall: 0.5, fibre: 1000 });
  assert.deepEqual(again.log.filter((e) => e[0] === 'fillRect'), rects, 'the same screen at the same seed');
});

test('backlit-silhouette gel: multiplied at its density, openings even-odd, and the surface left as it was', () => {
  const g = surface();
  B.gel(g, [SQUARE, HOLE], '#4f9fd0', { density: 0.6 });
  assert.deepEqual(steps(g), ['set globalCompositeOperation multiply', 'set globalAlpha 0.6', 'moveTo 0 0', 'moveTo 4 4', 'fill evenodd']);
  assert.deepEqual([g.log[0][0], g.log.at(-1)[0]], ['save', 'restore']);
  const one = surface();
  B.gel(one, SQUARE, '#4f9fd0');
  assert.deepEqual(steps(one), ['set globalCompositeOperation multiply', 'set globalAlpha 0.85', 'moveTo 0 0', 'fill evenodd'], 'one outline, the default density');
});

test('backlit-silhouette card: painted over what is behind, near-black by default', () => {
  const g = surface();
  B.card(g, [SQUARE, HOLE]);
  assert.deepEqual(steps(g), ['moveTo 0 0', 'moveTo 4 4', 'fill evenodd'], 'no blending, no alpha');
  assert.equal(g.state.fillStyle, '#14100c');
  B.card(g, SQUARE, { colour: '#201008' });
  assert.equal(g.state.fillStyle, '#201008');
});

test('backlit-silhouette lift: a lifted sheet is softened inside its box grown by the lift; under 1.5 pixels it stays sharp', () => {
  // With no canvas to buffer on, kit soft paints sharp inside the box it was given.
  const lifted = surface();
  B.gel(lifted, SQUARE, '#e0605c', { lift: 4 });
  assert.deepEqual(steps(lifted), ['set globalCompositeOperation multiply', 'set globalAlpha 0.85', 'rect -4 -4 18 18', 'moveTo 0 0', 'fill evenodd']);
  const near = surface();
  B.card(near, SQUARE, { lift: 1 });
  assert.ok(!near.log.some((e) => e[0] === 'rect'), 'a lift of one pixel softens nothing');
  const large = surface(2);
  B.card(large, SQUARE, { lift: 1 });
  assert.ok(large.log.some((e) => e[0] === 'rect'), 'the same lift is two pixels at scale 2');
});
