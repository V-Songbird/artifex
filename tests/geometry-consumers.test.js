'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validate, solve } = require('../core/piece.js');
const { closestPointOnSegment } = require('../core/geom.js');
const pattern = require('../examples/pattern.js');
const packing = require('../examples/packing.js');

test('pattern bands keep perpendicular width along the bowed motif', () => {
  const p = validate(pattern);
  const s = solve(p, p.seed).state;
  for (const { solo, band } of s.motif) {
    const start = solo[0]; const end = solo[solo.length - 1];
    const width = 0.038 * Math.hypot(end[0] - start[0], end[1] - start[1]);
    for (const side of band) {
      assert.equal(side.length, solo.length, 'these gentle bows fit the default miter limit');
      for (let i = 1; i < solo.length; i++) {
        const a = solo[i - 1]; const b = solo[i];
        for (const q of [side[i - 1], side[i]]) {
          const d = Math.abs((b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]))
            / Math.hypot(b[0] - a[0], b[1] - a[1]);
          assert.ok(Math.abs(d - width) < 1e-12, 'both ends of each border stay parallel to the spine');
        }
      }
    }
  }
});

test('pattern accents move onto visible crossings near the selected hot nodes', () => {
  const p = validate(pattern);
  const s = solve(p, p.seed).state;
  const size = s.params.cell;
  const hot = s.nodes.filter((n) => n.tier === 2 && n.x > 72 + size * 0.2 && n.x < 960 - 72 - size * 0.2
    && n.y > 72 + size * 0.2 && n.y < 1200 - 72 - size * 0.2)
    .sort((a, b) => b.heat - a.heat || a.j - b.j || a.i - b.i).slice(0, 6);
  assert.equal(s.accentCentres.length, 6);
  let moved = 0;
  s.accentCentres.forEach((point, i) => {
    const distance = Math.hypot(point[0] - hot[i].x, point[1] - hot[i].y);
    assert.ok(distance <= size * 0.2);
    if (distance < 1e-8) return;
    moved++;
    const paths = s.paths.filter((path) => path.tier === 2 && path.pts.some((q, j) => j > 0
      && closestPointOnSegment(point, path.pts[j - 1], q).distance < 1e-8));
    assert.ok(paths.length >= 2, 'a moved bead must sit on at least two visible paths');
  });
  assert.ok(moved > 0, 'the intersection consumer must visibly change the default piece');
});

test('packing dots shrink to boundary clearance and omit sub-pen marks', () => {
  const mark = packing.build.find(([name]) => name === 'mark the quiet ones')[1];
  const s = { forms: [
    { r: 10, centre: [1, 2], pts: [[0, 0], [2, 0], [2, 4], [0, 4]], ink: '#123456' },
    { r: 10, centre: [0.2, 2], pts: [[0, 0], [2, 0], [2, 4], [0, 4]], ink: '#123456' },
  ] };
  mark(s);
  assert.deepEqual(s.dots, [{ at: [1, 2], r: 0.8, ink: '#123456' }]);
});

test('packing dot sizes respond to actual outline clearance in a generated piece', () => {
  const p = validate(packing);
  const s = solve(p, p.seed).state;
  let changed = 0;
  for (const dot of s.dots) {
    const form = s.forms.find((f) => f.centre === dot.at);
    const clearance = Math.min(...form.pts.map((a, i) =>
      closestPointOnSegment(dot.at, a, form.pts[(i + 1) % form.pts.length]).distance));
    assert.ok(dot.r <= clearance * 0.8);
    if (Math.abs(dot.r - Math.max(1.1, form.r * 0.09)) > 1e-9) changed++;
  }
  assert.ok(changed > 0, 'real generated forms must use their interior geometry to set dot size');
});
