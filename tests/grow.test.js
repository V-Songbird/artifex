// Growth by rule (core/grow.js): tone as dots, and lines that branch
// towards what attracts them.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { stipple, colonise } = require('../core/grow.js');
const { rng } = require('../core/rand.js');

test('stipple crowds its dots where the tone is high, keeps them apart, and stays in bounds', () => {
  const tone = (x) => (x < 100 ? 0.9 : 0.1), bounds = [0, 0, 200, 100];
  const dots = stipple(rng(3), tone, bounds, 600);
  assert.equal(dots.length, 600);
  const left = dots.filter(([x]) => x < 100).length;
  assert.ok(left > 480 && left < 580, `${left} of 600 dots on the side that takes nine times the ink`);
  assert.ok(dots.every(([x, y]) => x >= 0 && x <= 200 && y >= 0 && y <= 100));
  // Relaxed dots sit apart: the nearest neighbour on the dark side is never very close.
  const dark = dots.filter(([x]) => x < 90);
  let closest = Infinity;
  for (let i = 0; i < dark.length; i++) for (let j = i + 1; j < dark.length; j++) closest = Math.min(closest, Math.hypot(dark[i][0] - dark[j][0], dark[i][1] - dark[j][1]));
  const raw = stipple(rng(3), tone, bounds, 600, { rounds: 0 }).filter(([x]) => x < 90);
  let rawClosest = Infinity;
  for (let i = 0; i < raw.length; i++) for (let j = i + 1; j < raw.length; j++) rawClosest = Math.min(rawClosest, Math.hypot(raw[i][0] - raw[j][0], raw[i][1] - raw[j][1]));
  assert.ok(closest > 2 && closest > rawClosest * 3, `relaxing spreads the dots: nearest ${closest} against ${rawClosest}`);
  assert.deepEqual(stipple(rng(3), tone, bounds, 600), dots, 'the same seed gives the same dots');
  assert.notDeepEqual(stipple(rng(4), tone, bounds, 600), dots);
  assert.deepEqual(stipple(rng(1), () => 0, bounds, 10), [], 'no tone, no dots');
  assert.throws(() => stipple(rng(1), tone, [0, 0, 0, 1], 5), /stipple: bounds must be finite \[x0, y0, x1, y1\] with x1 > x0 and y1 > y0/);
  assert.throws(() => stipple(rng(1), tone, bounds, 0), /stipple: n must be a whole number of dots from 1 to 200000, got 0/);
  assert.throws(() => stipple(rng(1), 0.5, bounds, 5), /stipple: tone must be a function/);
});

test('colonise grows from its roots towards the attractors, one step at a time, thicker where it carries more', () => {
  const R = rng(2), attractors = Array.from({ length: 400 }, (_, i) => [R('a', 'x', i) * 200 - 100, -40 - R('a', 'y', i) * 160]);
  const grown = colonise(attractors, [[0, 0]], { step: 4, reach: 60 });
  const { points, parent, width } = grown;
  assert.ok(points.length > 150, `${points.length} points grown`);
  assert.equal(parent[0], -1);
  for (let i = 1; i < points.length; i++) {
    assert.ok(parent[i] >= 0 && parent[i] < i, 'every point grows from an earlier one');
    assert.ok(Math.abs(Math.hypot(points[i][0] - points[parent[i]][0], points[i][1] - points[parent[i]][1]) - 4) < 1e-9, 'one step long');
    assert.ok(width[parent[i]] >= width[i] - 1e-12, 'a stem is at least as thick as each branch it carries');
  }
  const children = points.map(() => 0);
  parent.forEach((p) => { if (p >= 0) children[p]++; });
  assert.ok(children.filter((c) => c > 1).length > 10, 'it branches');
  assert.ok(children.every((c, i) => c > 0 || width[i] === 1), 'a tip has the tip width');
  assert.equal(Math.max(...width), width[0], 'the root is the thickest');
  assert.ok(Math.min(...points.map((p) => p[1])) < -150 && points.every((p) => p[1] <= 4), 'it climbed into the cloud and not away from it');
  assert.deepEqual(colonise(attractors, [[0, 0]], { step: 4, reach: 60 }), grown);
  assert.deepEqual(colonise([], [[0, 0]], { step: 4 }).points, [[0, 0]], 'nothing to reach for, nothing grown');
  assert.equal(colonise([[1000, 0]], [[0, 0]], { step: 4 }).points.length, 1, 'an attractor out of reach pulls nothing');
  // A row of attractors is followed.
  const row = colonise(Array.from({ length: 30 }, (_, i) => [10 + i * 6, 0]), [[0, 0]], { step: 3 });
  assert.ok(Math.max(...row.points.map((p) => p[0])) > 160 && row.points.every((p) => Math.abs(p[1]) < 1e-9));
  assert.throws(() => colonise(attractors, [], { step: 4 }), /colonise: needs at least one root/);
  assert.throws(() => colonise(attractors, [[0, 0]], {}), /colonise: step must be a distance over 0, got undefined/);
  assert.throws(() => colonise([[0]], [[0, 0]], { step: 1 }), /colonise: attractors must be a list of finite \[x, y\] points/);
});
