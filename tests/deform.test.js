// A shape bent by a few pins (core/deform.js): the mesh of an outline, and
// the bend that keeps each small piece of the shape as it was.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { shapeMesh, deformer, riders, squashStretch } = require('../core/deform.js');

const bar = [[0, 0], [200, 0], [200, 40], [0, 40]];
const nearest = (mesh, x, y) => mesh.points.reduce((best, p, i) => ((p[0] - x) ** 2 + (p[1] - y) ** 2 < (mesh.points[best][0] - x) ** 2 + (mesh.points[best][1] - y) ** 2 ? i : best), 0);
const edges = (mesh) => { const out = []; for (const [a, b, c] of mesh.triangles) out.push([a, b], [b, c], [c, a]); return out; };
const stretch = (mesh, bent) => {
  let worst = 0;
  for (const [a, b] of edges(mesh)) {
    const rest = Math.hypot(mesh.points[a][0] - mesh.points[b][0], mesh.points[a][1] - mesh.points[b][1]), now = Math.hypot(bent[a][0] - bent[b][0], bent[a][1] - bent[b][1]);
    worst = Math.max(worst, Math.abs(now / rest - 1));
  }
  return worst;
};

test('shapeMesh lays points on the edge and inside it and joins them into triangles within the outline', () => {
  const mesh = shapeMesh(bar, 10);
  assert.ok(mesh.outline.length >= 44 && mesh.points.length > mesh.outline.length + 20, `${mesh.outline.length} edge points of ${mesh.points.length}`);
  for (const i of mesh.outline) { const [x, y] = mesh.points[i]; assert.ok(Math.min(x, 200 - x, y, 40 - y) < 1e-9, `edge point ${x}, ${y} lies on the outline`); }
  let area = 0;
  for (const [a, b, c] of mesh.triangles) {
    const [p, q, r] = [mesh.points[a], mesh.points[b], mesh.points[c]];
    area += Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1])) / 2;
  }
  assert.ok(Math.abs(area - 8000) < 1, `the triangles cover the bar, area ${area}`);
  const ell = shapeMesh([[0, 0], [90, 0], [90, 30], [30, 30], [30, 90], [0, 90]], 10);
  assert.ok(ell.triangles.every(([a, b, c]) => { const x = (ell.points[a][0] + ell.points[b][0] + ell.points[c][0]) / 3, y = (ell.points[a][1] + ell.points[b][1] + ell.points[c][1]) / 3; return !(x > 30 && y > 30); }), 'no triangle lies in the notch');
  assert.deepEqual(shapeMesh(bar, 10), mesh);
  assert.throws(() => shapeMesh([[0, 0], [1, 1]], 1), /shapeMesh: takes a closed outline of at least 3 finite \[x, y\] points/);
  assert.throws(() => shapeMesh(bar, 0), /shapeMesh: spacing must be a distance over 0, got 0/);
  assert.throws(() => shapeMesh(bar, 0.01), /shapeMesh: spacing is too small for this outline/);
});

test('with no pin the shape rests, with one it moves whole, and pins that keep its form turn it whole', () => {
  const mesh = shapeMesh(bar, 10), bend = deformer(mesh), a = nearest(mesh, 0, 20), b = nearest(mesh, 200, 20);
  assert.deepEqual(bend([]), mesh.points);
  const moved = bend([[a, [30, 70]]]);
  for (let i = 0; i < moved.length; i++) { assert.ok(Math.abs(moved[i][0] - mesh.points[i][0] - 30) < 1e-9 && Math.abs(moved[i][1] - mesh.points[i][1] - 50) < 1e-9); }
  // Both ends put where a quarter turn about the first would put them.
  const turned = bend([[a, mesh.points[a]], [b, [mesh.points[a][0], mesh.points[a][1] + 200]]], { rounds: 60 });
  assert.ok(stretch(mesh, turned) < 0.02, `a turn stretches nothing, worst ${stretch(mesh, turned)}`);
  const far = nearest(mesh, 100, 0);
  assert.ok(Math.abs(turned[far][1] - mesh.points[a][1] - 100) < 3, `the middle went round with it, at ${turned[far]}`);
});

test('a pin pulled aside bends the shape, holds every pin exactly and stretches it little', () => {
  const mesh = shapeMesh(bar, 10), bend = deformer(mesh);
  const left = nearest(mesh, 0, 20), mid = nearest(mesh, 100, 20), right = nearest(mesh, 200, 20);
  const pins = [[left, mesh.points[left]], [right, [180, 20]], [mid, [100, 70]]], bent = bend(pins);
  for (const [i, p] of pins) assert.deepEqual(bent[i], p);
  assert.ok(stretch(mesh, bent) < 0.5, `worst edge stretch, beside a pin, ${stretch(mesh, bent)}`);
  const top = nearest(mesh, 100, 0), low = nearest(mesh, 100, 40);
  assert.ok(bent[top][1] > 35 && bent[low][1] > 75, 'the bar carries its width up with the pin');
  assert.ok(Math.abs(Math.hypot(bent[top][0] - bent[low][0], bent[top][1] - bent[low][1]) - 40) < 6, 'and keeps that width');
  assert.deepEqual(bend(pins), bent, 'the same pins give the same shape, whatever was asked before');
  bend([[left, [0, 0]], [right, [500, 300]]]);
  assert.deepEqual(bend(pins), bent);
  assert.ok(bend(pins, { rounds: 30 }).some((p, i) => p[0] !== bent[i][0]), 'more rounds follow the bend further');
});

test('riders keep each place on its piece of the shape: at rest, moved whole, turned, grown and bent', () => {
  const mesh = shapeMesh(bar, 10), places = [[20, 20], [100, 10], [180, 30], [100.5, 39]], ride = riders(mesh, places);
  ride(mesh.points).forEach((r, i) => {
    assert.ok(Math.abs(r.x - places[i][0]) < 1e-9 && Math.abs(r.y - places[i][1]) < 1e-9, 'at rest a place is where it was put');
    assert.ok(Math.abs(r.turn) < 1e-12 && Math.abs(r.scale - 1) < 1e-12);
  });
  // The whole mesh turned a quarter and doubled about the origin.
  const turned = ride(mesh.points.map(([x, y]) => [-2 * y, 2 * x]));
  turned.forEach((r, i) => {
    assert.ok(Math.abs(r.x + 2 * places[i][1]) < 1e-9 && Math.abs(r.y - 2 * places[i][0]) < 1e-9, 'the place went with the shape');
    assert.ok(Math.abs(r.turn - Math.PI / 2) < 1e-9 && Math.abs(r.scale - 2) < 1e-9, `turn ${r.turn}, scale ${r.scale}`);
  });
  const bend = deformer(mesh), left = nearest(mesh, 0, 20), right = nearest(mesh, 200, 20), mid = nearest(mesh, 100, 20);
  const bent = bend([[left, mesh.points[left]], [right, [180, 20]], [mid, [100, 70]]]), rode = ride(bent);
  assert.ok(rode[1].y > 40, `a place at the middle rises with the bend, to ${rode[1].y}`);
  assert.ok(rode[0].turn > 0.1 && rode[2].turn < -0.1, `the two halves turn opposite ways: ${rode[0].turn}, ${rode[2].turn}`);
  assert.deepEqual(ride(bent), rode);
  assert.ok(Number.isFinite(riders(mesh, [[500, 500]])(mesh.points)[0].x), 'a place outside rides the nearest triangle');
  assert.throws(() => riders({ points: [], triangles: [] }, []), /riders: takes a mesh \{ points, triangles \} with at least one triangle/);
  assert.throws(() => riders(mesh, [[1]]), /riders: places must be a list of finite \[x, y\] points/);
  assert.throws(() => ride([[0, 0]]), /riders: ride takes the bent points of the same mesh/);
});

test('deformer refuses a mesh, a pin or a round count it cannot use', () => {
  const mesh = shapeMesh(bar, 20), bend = deformer(mesh);
  assert.throws(() => deformer({}), /deformer: takes a mesh \{ points, triangles \}/);
  assert.throws(() => deformer({ points: [[0, 0]], triangles: [[0, 1, 2]] }), /deformer: each triangle must be three indices into points/);
  assert.throws(() => bend([[9999, [0, 0]]]), /deformer: each pin must be \[index, \[x, y\]\] with an index into the mesh points/);
  assert.throws(() => bend('pin'), /deformer: pins must be a list of \[index, \[x, y\]\]/);
  assert.throws(() => bend([], { rounds: 0 }), /deformer: rounds must be a whole number from 1 to 200, got 0/);
});

test('squashStretch preserves area in 2D and volume in 3D along any axis', () => {
  const sq = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const d2 = squashStretch(sq, { pivot: [0.5, 0.5], axis: [1, 1], stretch: 2.25 });
  const area = Math.abs((d2[1][0] - d2[0][0]) * (d2[3][1] - d2[0][1]) - (d2[1][1] - d2[0][1]) * (d2[3][0] - d2[0][0]));
  assert.ok(Math.abs(area - 1) < 1e-12, `2D area drifted: ${area}`);

  const basis = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const d3 = squashStretch(basis, { pivot: [0, 0, 0], axis: [1, 2, -0.5], stretch: 2.5 });
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const vx = sub(d3[1], d3[0]), vy = sub(d3[2], d3[0]), vz = sub(d3[3], d3[0]);
  const cross = [vy[1] * vz[2] - vy[2] * vz[1], vy[2] * vz[0] - vy[0] * vz[2], vy[0] * vz[1] - vy[1] * vz[0]];
  const vol = Math.abs(vx[0] * cross[0] + vx[1] * cross[1] + vx[2] * cross[2]);
  assert.ok(Math.abs(vol - 1) < 1e-12, `3D volume drifted: ${vol}`);
  assert.throws(() => squashStretch([[0, 0]], { stretch: 0 }), /squashStretch: stretch must be a factor over 0, got 0/);
  assert.throws(() => squashStretch([[0, 0]], { axis: [0, 0] }), /squashStretch: axis must have length above 0/);
  assert.throws(() => squashStretch([[0, 0], [1, 2, 3]]), /squashStretch: every point must be a finite 2D array/);
  const pivotStays = squashStretch([[3, 4]], { pivot: [3, 4], axis: [1, 0], stretch: 3 });
  assert.deepEqual(pivotStays, [[3, 4]]);
});
