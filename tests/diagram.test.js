// core/diagram.js: layouts as geometry, checked by what must hold of any diagram.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { radar, timeline, layered, sankey } = require('../core/diagram.js');

const measure = (label) => [label.length * 8, 14];
const near = (a, b, why) => assert.ok(Math.abs(a - b) < 1e-9, `${why}: ${a} against ${b}`);

test('diagram radar: spokes from the top, clockwise, each value at its share of the radius', () => {
  const r = radar([{ name: 'a', value: 4 }, { name: 'b', value: 2 }, { name: 'c', value: 0 }, { name: 'd', value: 4 }], { centre: [100, 100], radius: 50 });
  assert.deepEqual(r.spokes.map((s) => s.tip.map((v) => +v.toFixed(6))), [[100, 50], [150, 100], [100, 150], [50, 100]]);
  assert.deepEqual(r.shape.map((p) => p.map((v) => +v.toFixed(6))), [[100, 50], [125, 100], [100, 100], [50, 100]]);
  near(r.spokes[1].label[0], 155, 'the label sits a tenth of the radius past the tip');
  assert.deepEqual(r.ring(0.5).map((p) => p.map((v) => +v.toFixed(6))), [[100, 75], [125, 100], [100, 125], [75, 100]]);
  near(radar([1, 2, 3], { centre: [0, 0], radius: 10, max: 6 }).shape[2][0], -Math.cos(Math.PI / 6) * 5, 'a given max sets the scale');
  assert.throws(() => radar([1, 2], { centre: [0, 0], radius: 10 }), /^RangeError: diagram radar: values takes three or more/);
});

test('diagram timeline: events at their times, and no two labels of one lane overlap', () => {
  const events = [0, 1, 1.2, 1.4, 5, 9, 9.1].map((t, i) => ({ t, label: 'event ' + i }));
  const tl = timeline(events, { from: [50, 300], to: [850, 300], measure });
  near(tl.events[0].at[0], 50, 'the first time at the start');
  near(tl.events[6].at[0], 850, 'the last at the end');
  near(tl.tick(4.55)[0], 450, 'any time has its point');
  const lanes = new Map();
  for (const e of tl.events) {
    const key = e.side + ' ' + e.lane, last = lanes.get(key);
    if (last !== undefined) assert.ok(e.anchor[0] >= last + 8 - 1e-9, `${e.label} starts clear of the label before it in lane ${key}`);
    lanes.set(key, e.anchor[0] + e.size[0]);
  }
  assert.ok(lanes.size >= 3, 'three labels within a few units need three lanes');
  assert.deepEqual(tl.events.slice(1, 4).map((e) => [e.side, e.lane]), [[1, 0], [-1, 0], [1, 1]], 'the second lane is the other side of the line, the third further out on the first');
  // A slanted line: labels step off along its normal.
  const slant = timeline([{ t: 0, label: 'a' }, { t: 1, label: 'b' }], { from: [0, 0], to: [100, 100], measure });
  near(slant.events[1].at[1], 100, 'on the line');
  assert.throws(() => timeline(events, { from: [0, 0], to: [0, 0], measure }), /two different \[x, y\] points/);
});

test('diagram layered: edges run one way, boxes fit their labels and never overlap, a cycle runs back round the side', () => {
  const nodes = ['start', 'read the brief', 'draw', 'look', 'done'].map((label) => ({ id: label, label }));
  const edges = [['start', 'read the brief'], ['read the brief', 'draw'], ['draw', 'look'], ['look', 'draw', 'again'], ['look', 'done'], ['start', 'done']].map(([from, to, label]) => ({ from, to, label }));
  const g = layered(nodes, edges, { measure });
  const at = (id) => g.nodes.find((n) => n.id === id);
  assert.deepEqual(g.nodes.map((n) => n.rank), [0, 1, 2, 3, 4]);
  assert.deepEqual([at('draw').w, at('draw').h], [4 * 8 + 24, 14 + 24], 'a box is its label and the pad');
  for (const e of g.edges.filter((x) => !x.back)) assert.ok(at(e.from).y + at(e.from).h <= at(e.to).y, `${e.from} sits above ${e.to}`);
  const back = g.edges.find((e) => e.label === 'again');
  assert.equal(back.back, true);
  assert.ok(back.path.slice(1, 3).every((p) => p[0] > Math.max(...g.nodes.map((n) => n.x + n.w))), 'the way back runs past every box');
  assert.ok(g.size[0] >= back.path[1][0], 'the size takes the way back in');
  g.nodes.forEach((p, i) => g.nodes.slice(i + 1).forEach((q) => assert.ok(p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y, `${p.id} and ${q.id} overlap`)));
  for (const e of g.edges) for (let i = 1; i < e.path.length; i++) assert.ok(e.path[i][0] === e.path[i - 1][0] || e.path[i][1] === e.path[i - 1][1], 'paths run level or plumb');

  // Two branches: the ranks order to cut the crossing, and 'right' turns the layout a quarter.
  const fork = layered(['a', 'b', 'c', 'd', 'e'].map((id) => ({ id })), [['a', 'b'], ['a', 'c'], ['c', 'd'], ['b', 'e']].map(([from, to]) => ({ from, to })), { measure });
  const x = (id) => fork.nodes.find((n) => n.id === id).x;
  assert.equal(x('b') < x('c'), x('e') < x('d'), 'children keep their parents\' order');
  const turned = layered(nodes, edges, { measure, direction: 'right' });
  assert.ok(turned.nodes.every((n, i) => i === 0 || n.x > turned.nodes[i - 1].x), 'ranks run left to right');
  const loop = layered([{ id: 's' }], [{ from: 's', to: 's' }], { measure }).edges[0];
  assert.ok(loop.back && loop.path.length === 4);
  assert.throws(() => layered(nodes, [{ from: 'draw', to: 'paint' }], { measure }), /^RangeError: diagram layered: edge 0 names a node that is not in nodes: paint$/);
  assert.throws(() => layered([{ id: 'a' }, { id: 'a' }], [], { measure }), /each node takes its own id/);
});

test('diagram sankey: a node is as tall as what passes through it, ribbons keep their width and fill the node\'s side', () => {
  const nodes = ['in', 'kept', 'spent', 'rent', 'food'].map((id) => ({ id }));
  const flows = [['in', 'kept', 30], ['in', 'spent', 70], ['spent', 'rent', 45], ['spent', 'food', 25]].map(([from, to, value]) => ({ from, to, value }));
  const s = sankey(nodes, flows, { box: [100, 50, 600, 300], gap: 10 });
  const at = (id) => s.nodes.find((n) => n.id === id);
  assert.deepEqual(s.nodes.map((n) => n.column), [0, 1, 1, 2, 2]);
  near(at('in').h, 100 * s.scale, 'the source carries all of it');
  near(at('spent').h, 70 * s.scale, 'in equals out');
  near(at('in').x, 100, 'the first column at the box\'s left');
  near(at('rent').x + at('rent').w, 700, 'the last at its right');
  for (const n of s.nodes) assert.ok(n.y >= 50 - 1e-9 && n.y + n.h <= 350 + 1e-9, `${n.id} is inside the box`);
  for (const r of s.ribbons) {
    near(r.width, r.value * s.scale, 'a ribbon is as wide as its value');
    const first = r.outline[0], last = r.outline[r.outline.length - 1];
    near(last[1] - first[1], r.width, 'the same width where it leaves');
    near(first[0], at(r.from).x + at(r.from).w, 'from the source\'s right edge');
  }
  // Leaving 'in': the two ribbons stack without a gap or an overlap, in the order of their targets.
  const [kept, spent] = [s.ribbons[0], s.ribbons[1]].sort((p, q) => p.outline[0][1] - q.outline[0][1]);
  near(kept.outline[0][1], at('in').y, 'the upper ribbon starts at the node\'s top');
  near(spent.outline[0][1], kept.outline[0][1] + kept.width, 'the next starts where it ends');
  assert.throws(() => sankey(nodes, [...flows, { from: 'rent', to: 'in', value: 1 }], { box: [0, 0, 100, 100] }), /^RangeError: diagram sankey: flow 4 closes a cycle, and a sankey runs one way$/);
  assert.throws(() => sankey(nodes, [{ from: 'in', to: 'kept', value: 0 }], { box: [0, 0, 100, 100] }), /flow 0 takes a value above 0/);
});
