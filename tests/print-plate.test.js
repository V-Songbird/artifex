// The print-plate style: a plate per ink, knockouts, dot screens and the print.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { rng } = require('../core/rand.js');
const P = require('../skills/artifex/styles/print-plate.js');

// A context that logs what it is told, under a 2x transform as an export at scale 2 has.
function surface(canvas) {
  const log = [];
  const g = { canvas, log, state: {} };
  for (const k of ['save', 'restore', 'beginPath', 'rect', 'clip', 'arc', 'moveTo', 'fill', 'stroke', 'fillRect', 'translate', 'setTransform', 'drawImage']) g[k] = (...a) => log.push([k, ...a]);
  g.getTransform = () => ({ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 });
  for (const k of ['fillStyle', 'strokeStyle', 'globalCompositeOperation', 'globalAlpha', 'lineWidth', 'lineJoin']) {
    Object.defineProperty(g, k, { set(v) { g.state[k] = v; log.push(['set', k, v]); }, get() { return g.state[k]; } });
  }
  return g;
}

function canvas() {
  const made = [];
  const doc = { createElement: () => { const c = { getContext: () => (c.g = surface(null)) }; made.push(c); return c; } };
  return { width: 200, height: 100, ownerDocument: doc, made };
}

const INKS = [{ name: 'light', colour: '#ffd23c', offset: [1, 0] }, { name: 'dark', colour: '#2f6fd0', offset: [0, -3], density: 0.8 }];

test('print-plate job: a padded plate per ink under the canvas transform, in the ink\'s colour', () => {
  const c = canvas();
  const J = P.job(surface(c), 100, 50, INKS);
  assert.equal(c.made.length, 2);
  // The furthest offset is 3 design units, 6 pixels at scale 2, and 2 more.
  assert.deepEqual(c.made.map((m) => [m.width, m.height]), [[216, 116], [216, 116]]);
  assert.deepEqual(c.made[0].g.log[0], ['setTransform', 2, 0, 0, 2, 8, 8]);
  assert.deepEqual([c.made[0].g.state.fillStyle, c.made[1].g.state.strokeStyle], ['#ffd23c', '#2f6fd0']);
  assert.equal(J.reach, 3);
  assert.throws(() => P.job(surface(c), 100, 50, [{ name: 'a', colour: '#000' }, { name: 'a', colour: '#fff' }]), /each ink takes its own name/);
  assert.throws(() => P.plate(J, 'green', () => {}), /no ink named green; this job prints light, dark/);
});

test('print-plate print: paper, then each plate multiplied in order at its offset and density', () => {
  const c = canvas();
  const g = surface(c);
  const J = P.job(g, 100, 50, INKS);
  P.plate(J, 'dark', (p) => p.fillRect(0, 0, 10, 10));
  assert.ok(c.made[1].g.log.some((e) => e[0] === 'fillRect'), 'the drawing lands on its own plate');
  assert.ok(!c.made[0].g.log.some((e) => e[0] === 'fillRect'), 'and on no other');
  P.print(J, '#f3ecdc');
  const laid = g.log.filter((e) => e[0] === 'drawImage' || e[0] === 'fillRect' || (e[0] === 'set' && /Composite|Alpha/.test(e[1])));
  assert.deepEqual(laid, [
    ['fillRect', 0, 0, 100, 50],
    ['set', 'globalCompositeOperation', 'multiply'], ['set', 'globalAlpha', 0.92], ['drawImage', c.made[0], 2 - 8, 0 - 8],
    ['set', 'globalCompositeOperation', 'multiply'], ['set', 'globalAlpha', 0.8], ['drawImage', c.made[1], 0 - 8, -6 - 8],
  ]);
});

test('print-plate knockout: erased from every plate, grown past the furthest offset', () => {
  const c = canvas();
  const J = P.job(surface(c), 100, 50, INKS);
  P.knockout(J, (p) => { p.beginPath(); p.rect(10, 10, 20, 5); });
  for (const m of c.made) {
    const names = m.g.log.slice(1).map((e) => (e[0] === 'set' ? e.slice(1).join(' ') : e[0]));
    assert.ok(names.includes('globalCompositeOperation destination-out'), 'erases');
    assert.ok(names.includes('lineWidth 7.5'), 'grown by 1.25 times the reach each side: ' + names);
    assert.ok(names.indexOf('fill') > names.indexOf('rect') && names.includes('stroke'));
  }
});

test('print-plate on a surface with no canvas: plates print straight on it, knockouts as paper on top', () => {
  const g = surface(null);
  const J = P.job(g, 100, 50, INKS);
  P.plate(J, 'light', (p) => p.fillRect(1, 2, 3, 4));
  assert.equal(g.log.length, 0, 'nothing is drawn before the print');
  P.knockout(J, (p) => { p.beginPath(); p.rect(10, 10, 20, 5); });
  P.print(J, '#f3ecdc');
  const steps = g.log.filter((e) => ['translate', 'fillRect', 'rect', 'fill'].includes(e[0]) || (e[0] === 'set' && e[1] === 'fillStyle')).map((e) => e.join(' '));
  assert.deepEqual(steps, ['set fillStyle #f3ecdc', 'fillRect 0 0 100 50', 'translate 1 0', 'set fillStyle #ffd23c', 'fillRect 1 2 3 4', 'translate 0 -3', 'set fillStyle #2f6fd0', 'set fillStyle #f3ecdc', 'rect 10 10 20 5', 'fill']);
});

test('print-plate screen: a dot covers its tone\'s share of a cell, on a turned lattice, with seeded voids of its own', () => {
  const dots = (name, tone, angle, voids = 0) => {
    const p = surface(null);
    P.screen(p, rng(4), name, tone, [0, 0, 100, 100], { pitch: 10, angle, voids });
    return p.log.filter((e) => e[0] === 'arc');
  };
  const flat = dots('a', () => 0.5, 0);
  assert.ok(flat.length >= 100 && flat.length <= 169, flat.length + ' dots over ten cells each way');
  for (const [, , , r] of flat) assert.ok(Math.abs(Math.PI * r * r - 50) < 1e-9, 'half of a 100-unit cell');
  assert.equal(dots('a', () => 0, 0).length, 0, 'no tone, no dot');
  assert.ok(dots('a', () => 1, 0)[0][3] >= 10 * Math.SQRT1_2, 'full tone reaches the cell\'s corner');
  // Turned 45 degrees, neighbours sit a pitch apart along the diagonal.
  const turned = dots('a', () => 0.5, 45);
  const near = turned.slice(1).map(([, x, y]) => Math.hypot(x - turned[0][1], y - turned[0][2])).sort((a, b) => a - b)[0];
  assert.ok(Math.abs(near - 10) < 1e-9, 'pitch kept: ' + near);
  const lost = (name) => { const kept = new Set(dots(name, () => 0.5, 0, 0.2).map(([, x, y]) => x + ',' + y)); return flat.filter(([, x, y]) => !kept.has(x + ',' + y)).map(([, x, y]) => x + ',' + y); };
  assert.ok(lost('a').length > 5 && lost('a').length < 60, lost('a').length + ' of ' + flat.length + ' dots fail at 0.2');
  assert.deepEqual(lost('a'), lost('a'), 'the same voids again');
  assert.notDeepEqual(lost('a'), lost('b'), 'another ink, other voids');
  assert.throws(() => P.screen(surface(null), rng(1), 'a', () => 1, [0, 0, 10, 10], {}), /pitch takes a number above 0/);
});

test('print-plate register: a seeded offset within reach, its own for each ink', () => {
  const R = rng(9);
  const offs = [0, 1, 2].map((i) => P.register(R, 'job', i, 4));
  for (const [dx, dy] of offs) assert.ok(Math.hypot(dx, dy) <= 4 && Math.hypot(dx, dy) >= 1.6);
  assert.deepEqual(P.register(R, 'job', 1, 4), offs[1]);
  assert.notDeepEqual(offs[0], offs[1]);
});
