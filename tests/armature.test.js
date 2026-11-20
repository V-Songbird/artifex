'use strict';

// Contracts of the depth armature: foreshortening, section ellipses, the rim
// half nearer the viewer, twist against bend, weak and per-joint perspective
// and the reach.

const test = require('node:test');
const assert = require('node:assert');

const { pose, reach, project, fabrik } = require('../core/armature.js');

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const sub = (p, q) => p.map((v, i) => v - q[i]);
const dist = (p, q) => Math.hypot(...sub(p, q));
const BASE = { forward: [0, 1, 0], side: [1, 0, 0] };
const L = 10;

// One segment from the root down the picture, bent out of the picture by `bend`.
const one = (bend, radius = [3, 2], twist = 0) => pose([5, 7, 20], BASE, [{ length: L, radius, bend, twist }]);

test('foreshortening is 1, cos 45 and 0 as a segment turns 0, 45 and 90 degrees out of the picture', () => {
  for (const [bend, want] of [[0, 1], [Math.PI / 4, Math.SQRT1_2], [Math.PI / 2, 0]]) {
    const [p] = project(one(bend)).segments;
    assert.ok(near(p.foreshortening, want), `bend ${bend}: foreshortening ${p.foreshortening}, want ${want}`);
    assert.ok(near(Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]), L * want), `bend ${bend}: picture length`);
  }
});

test('a section ellipse keeps the radius across and shrinks along by the turn', () => {
  for (const [bend, minor] of [[0, 0], [Math.PI / 4, Math.SQRT1_2], [Math.PI / 2, 1]]) {
    const [p] = project(one(bend)).segments;
    const [s0, s1] = p.sections;
    assert.ok(near(s0.major, 3) && near(s1.major, 2), `bend ${bend}: majors ${s0.major}, ${s1.major}`);
    assert.ok(near(s0.minor, 3 * minor) && near(s1.minor, 2 * minor), `bend ${bend}: minors ${s0.minor}, ${s1.minor}`);
    assert.ok(near(s0.centre[0], p.a[0]) && near(s1.centre[1], p.b[1]), `bend ${bend}: centres sit on the ends`);
    assert.strictEqual(s0.angle, 0, `bend ${bend}: a segment down the picture has its major axis along x`);
  }
  const [edge] = project(one(0)).segments;
  assert.deepStrictEqual(edge.sections[0].near, [0, 0], 'edge-on: no nearer half');
  const [facing] = project(one(Math.PI / 2)).segments;
  assert.deepStrictEqual(facing.sections[0].near, [0, 0], 'facing the viewer: a full circle');
  const [across] = project(one(Math.PI / 2, [3, 2], Math.PI / 2)).segments;
  assert.ok(near(across.sections[0].angle, Math.PI / 2), `a segment along x: angle ${across.sections[0].angle}`);
  // Twisted then bent back up the picture, its x rounds to -1e-16; the angle must still fall in [0, PI).
  const [up] = project(one(Math.PI, [2, 2], Math.PI / 2)).segments;
  assert.ok(up.sections[0].angle >= 0 && up.sections[0].angle < Math.PI, `a segment up the picture: angle ${up.sections[0].angle}`);
});

test('near points to the half of the rim nearer the viewer', () => {
  const toward = project(one(Math.PI / 4)).segments[0].sections[0].near;
  assert.ok(near(toward[0], 0) && near(toward[1], -1), `toward the viewer: near [${toward}]`);
  const away = project(one(-Math.PI / 4)).segments[0].sections[0].near;
  assert.ok(near(away[0], 0) && near(away[1], 1), `away from the viewer: near [${away}]`);

  // Brute force on an oblique segment and view: sample the section circle in 3D
  // and check its least-depth point lies on near's side of the centre.
  const g = pose([1, 2, 3], { forward: [0.3, 1, 0.2], side: [1, 0, 0.4] }, [{ length: 4, radius: [2, 2], bend: 0.7, twist: 0.4 }])[0];
  const view = [0.2, -0.1, 1];
  const up = [0.1, -1, 0];
  const { segments: [p] } = project([g], { view, up });
  const vn = view.map((v) => v / Math.hypot(...view));
  let best = null;
  for (let i = 0; i < 64; i++) {
    const t = (i / 64) * 2 * Math.PI;
    const q = g.start.map((c, j) => c + 2 * (Math.cos(t) * g.side[j] + Math.sin(t) * g.normal[j]));
    if (!best || dot(q, vn) < dot(best, vn)) best = q;
  }
  const rim = project([{ start: best, end: g.end, radius: [0, 0] }], { view, up }).segments[0].a;
  const off = [rim[0] - p.a[0], rim[1] - p.a[1]];
  const n = p.sections[0].near;
  assert.ok(near(Math.hypot(...n), 1), `near is a unit vector, got [${n}]`);
  assert.ok(off[0] * n[0] + off[1] * n[1] > 0, `nearest rim offset [${off}] against near [${n}]`);
});

test('twist turns the plane a bend works in', () => {
  const [bent] = one(Math.PI / 2);
  const d = sub(bent.end, bent.start);
  assert.ok(near(d[0], 0) && near(d[1], 0) && near(d[2], -L), `bend alone ends at [${d}]`);
  const [turned] = one(Math.PI / 2, [3, 2], Math.PI / 2);
  const e = sub(turned.end, turned.start);
  assert.ok(near(e[0], -L) && near(e[1], 0) && near(e[2], 0), `twist then bend ends at [${e}]`);
  assert.ok(near(project([turned]).segments[0].foreshortening, 1), 'twisted bend stays in the picture');

  const chain = pose([0, 0, 0], BASE, [
    { length: 3, radius: [1, 1], bend: 0.4, twist: 0.2 },
    { length: 5, radius: [1, 0.5], bend: -1.1, twist: 2.3 },
    { length: 2, radius: [0.5, 0], bend: 0.9, twist: -0.7 },
  ]);
  for (const [i, s] of chain.entries()) {
    assert.ok(near(dist(s.start, s.end), s.length, 1e-12), `segment ${i} length`);
    if (i) assert.ok(dist(s.start, chain[i - 1].end) === 0, `segment ${i} starts where ${i - 1} ends`);
    const { forward: f, side: si, normal: n } = s;
    for (const [name, v, w, want] of [['f.f', f, f, 1], ['s.s', si, si, 1], ['n.n', n, n, 1], ['f.s', f, si, 0], ['f.n', f, n, 0], ['s.n', si, n, 0]]) {
      assert.ok(near(dot(v, w), want, 1e-12), `segment ${i} ${name} = ${dot(v, w)}`);
    }
  }
});

test('weak perspective scales by focal over focal plus depth and leaves foreshortening alone', () => {
  // Bent 45 degrees toward the viewer from depth 100 + 5 cos 45, so its mean depth is 100.
  const segs = pose([4, -6, 100 + 5 * Math.SQRT1_2], BASE, [{ length: L, radius: [3, 2], bend: Math.PI / 4 }]);
  const ortho = project(segs);
  const persp = project(segs, { focal: 100 });
  assert.strictEqual(ortho.scale, 1);
  assert.ok(near(persp.scale, 0.5), `scale ${persp.scale}`);
  const [o] = ortho.segments, [p] = persp.segments;
  for (const k of [0, 1]) {
    assert.ok(near(p.a[k], o.a[k] / 2) && near(p.b[k], o.b[k] / 2), `end ${k} halved`);
  }
  assert.ok(near(p.foreshortening, o.foreshortening), 'foreshortening unchanged');
  assert.ok(near(p.sections[0].major, 1.5) && near(p.sections[0].minor / p.sections[0].major, o.sections[0].minor / o.sections[0].major),
    'section scaled, its shape unchanged');
  assert.strictEqual(project(segs, { focal: Infinity }).scale, 1);
});

test('project pins absolute picture points and depths', () => {
  const nearAll = (got, want) => got.length === want.length && got.every((v, i) => near(v, want[i]));
  const [flat] = project(one(0)).segments;
  assert.ok(nearAll(flat.a, [5, 7]) && nearAll(flat.b, [5, 17]), `default view: a [${flat.a}], b [${flat.b}]`);
  assert.ok(nearAll(flat.depth, [20, 20]), `default view: depth [${flat.depth}]`);
  const [toward] = project(one(Math.PI / 4)).segments;
  assert.ok(near(toward.depth[0], 20) && near(toward.depth[1], 20 - L * Math.SQRT1_2), `bent toward the viewer: depth [${toward.depth}]`);
  const seg = [{ start: [5, 7, 20], end: [5, 17, 20], radius: [1, 1] }];
  for (const [view, a, depth] of [[[0, 0, -1], [-5, 7], -20], [[1, 0, 0], [-20, 7], 5]]) {
    const [p] = project(seg, { view, up: [0, -1, 0] }).segments;
    assert.ok(nearAll(p.a, a) && near(p.depth[0], depth), `view [${view}]: a [${p.a}], depth ${p.depth[0]}`);
  }
});

test('centre sets where weak perspective scales and where depth starts', () => {
  const seg = [{ start: [400, 300, 100], end: [400, 310, 100], radius: [4, 4] }];
  const out = project(seg, { focal: 100, centre: [400, 300, 0] });
  const [p] = out.segments;
  assert.ok(near(out.scale, 0.5), `scale ${out.scale}`);
  assert.ok(near(p.a[0], 400) && near(p.a[1], 300) && near(p.b[0], 400) && near(p.b[1], 305), `a [${p.a}], b [${p.b}]`);
  assert.ok(near(p.depth[0], 100) && near(p.depth[1], 100), `depth [${p.depth}]`);
  assert.ok(near(p.sections[0].major, 2), `major ${p.sections[0].major}`);
  const [o] = project(seg, { focal: 100 }).segments;
  assert.ok(near(o.a[0], 200) && near(o.a[1], 150), `about the origin the figure slides: a [${o.a}]`);
  const [z] = project(one(0.3), { focal: 50, centre: [0, 0, 0] }).segments;
  const [d] = project(one(0.3), { focal: 50 }).segments;
  assert.ok([0, 1].every((k) => near(z.a[k], d.a[k]) && near(z.b[k], d.b[k])), 'an explicit origin centre matches the default');
});

test('per-joint perspective widens the near end of a part aimed at the lens by the ratio of its depths', () => {
  // Aimed at the lens: the start lies 60 behind the centre, the end 60 before it.
  const seg = [{ start: [0, -20, 60], end: [0, 20, -60], radius: [10, 10] }];
  const ratios = [];
  for (const f of [300, 1200]) {
    const [p] = project(seg, { focal: f, perspective: 'joint' }).segments;
    const ratio = p.sections[1].major / p.sections[0].major;
    ratios.push(ratio);
    assert.ok(ratio > 1 && near(ratio, (f + 60) / (f - 60)), `focal ${f}: near over far major ${ratio}`);
    assert.ok(near(p.scale[0], f / (f + 60)) && near(p.scale[1], f / (f - 60)), `focal ${f}: scale [${p.scale}]`);
    assert.ok(near(p.a[1], -20 * f / (f + 60)) && near(p.b[1], 20 * f / (f - 60)), `focal ${f}: a [${p.a}], b [${p.b}]`);
    assert.ok(near(p.sections[0].minor / p.sections[0].major, p.sections[1].minor / p.sections[1].major), `focal ${f}: one opening`);
    const [w] = project(seg, { focal: f }).segments;
    assert.ok(near(w.sections[0].major, w.sections[1].major) && near(w.scale[0], 1) && near(w.scale[1], 1),
      `focal ${f}: weak keeps one width, scale [${w.scale}]`);
  }
  assert.ok(ratios[0] > ratios[1], `a shorter focal widens more: ${ratios}`);
  const [o] = project([{ start: [100, -20, 60], end: [100, 20, -60], radius: [10, 10] }], { focal: 300, perspective: 'joint' }).segments;
  const d = [o.b[0] - o.a[0], o.b[1] - o.a[1]];
  assert.ok(o.a[0] !== o.b[0], `off centre the picture segment converges: a [${o.a}], b [${o.b}]`);
  assert.ok(near(Math.cos(o.sections[0].angle) * d[0] + Math.sin(o.sections[0].angle) * d[1], 0), 'major lies across the picture segment');
  const [inf] = project(seg, { focal: Infinity, perspective: 'joint' }).segments;
  assert.ok(inf.scale[0] === 1 && inf.scale[1] === 1, `focal Infinity: scale [${inf.scale}]`);
});

test('reach keeps both lengths and bends in the plane of bendDir', () => {
  const root = [0, 0, 0];
  const r = reach(root, [0, 1.6, 0], [1, 1], [0, 0, -1]);
  assert.ok(near(dist(root, r.joint), 1, 1e-12) && near(dist(r.joint, r.end), 1, 1e-12), 'lengths kept');
  assert.strictEqual(r.joint[0], 0, 'no sideways bow');
  assert.ok(r.joint[2] < 0, 'the middle joint comes toward the viewer');
  assert.strictEqual(r.reached, true);

  const bendDir = [0.3, 0.2, -1];
  const s = reach([1, 2, 3], [2, 4, 2.5], [2, 1.5], bendDir);
  const j = sub(s.joint, [1, 2, 3]);
  const u = sub([2, 4, 2.5], [1, 2, 3]);
  const plane = [u[1] * bendDir[2] - u[2] * bendDir[1], u[2] * bendDir[0] - u[0] * bendDir[2], u[0] * bendDir[1] - u[1] * bendDir[0]];
  assert.ok(near(dot(j, plane), 0, 1e-12), `joint off the bend plane by ${dot(j, plane)}`);
  assert.ok(dot(j, bendDir) > 0, 'joint on bendDir\'s side');
  assert.ok(near(dist(s.joint, s.end), 1.5, 1e-12) && dist(s.end, [2, 4, 2.5]) < 1e-12, 'end on target');

  const far = reach(root, [0, 5, 0], [1, 1], [0, 0, -1]);
  assert.ok(near(dist(root, far.end), 2, 1e-12) && far.reached === false, 'beyond reach: clamped to a + b');
  assert.ok(near(dist(root, far.joint), 1, 1e-12) && near(dist(far.joint, far.end), 1, 1e-12), 'beyond reach: lengths kept');
  const close = reach(root, [0, 0.5, 0], [3, 1], [0, 0, -1]);
  assert.ok(near(dist(root, close.end), 2, 1e-12) && close.reached === false, 'too near: clamped to |a - b|');
  assert.ok(near(dist(root, close.joint), 3, 1e-12) && near(dist(close.joint, close.end), 1, 1e-12), 'too near: lengths kept');
});

test('each function refuses bad input by name', async (t) => {
  const seg = { length: 1, radius: [1, 1] };
  const cases = [
    ['pose length 0', () => pose([0, 0, 0], BASE, [{ length: 0, radius: [1, 1] }]), /^pose: segment 0 length must be a finite number above 0, got 0$/],
    ['pose negative radius', () => pose([0, 0, 0], BASE, [seg, { length: 1, radius: [1, -1] }]), /^pose: segment 1 radius/],
    ['pose side parallel', () => pose([0, 0, 0], { forward: [0, 1, 0], side: [0, -2, 0] }, [seg]), /^pose: base side must not be zero or parallel/],
    ['pose bad root', () => pose([0, 0], BASE, [seg]), /^pose: root must be a finite \[x, y, z\], got \[0, 0\]$/],
    ['reach target at root', () => reach([1, 1, 1], [1, 1, 1], [1, 1], [0, 0, -1]), /^reach: target is at the root/],
    ['reach bendDir parallel', () => reach([0, 0, 0], [0, 1, 0], [1, 1], [0, 3, 0]), /^reach: bendDir must not be zero or parallel/],
    ['reach bad lengths', () => reach([0, 0, 0], [0, 1, 0], [1, 0], [0, 0, -1]), /^reach: lengths must be/],
    ['project up parallel', () => project(one(0), { up: [0, 0, -1] }), /^project: up must not be zero or parallel to view$/],
    ['project bad centre', () => project(one(0), { centre: [0, 0] }), /^project: centre must be a finite \[x, y, z\], got \[0, 0\]$/],
    ['project focal 0',() => project(one(0), { focal: 0 }), /^project: focal must be Infinity or a finite number above 0, got 0$/],
    ['project behind the eye', () => project(pose([0, 0, -50], BASE, [seg]), { focal: 5 }), /^project: focal \+ mean depth must be above 0/],
    ['project perspective unknown', () => project(one(0), { perspective: 'vertex' }), /^project: perspective must be 'weak' or 'joint', got "vertex"$/],
    ['project joint behind the eye', () => project([{ start: [0, 0, -60], end: [0, 10, 100], radius: [1, 1] }], { focal: 50, perspective: 'joint' }),
      /^project: focal \+ depth of segment 0 start must be above 0, got 50 \+ -60/],
    ['project zero length',() => project([{ start: [0, 0, 0], end: [0, 0, 0], radius: [1, 1] }]), /^project: segment 0 has zero length/],
  ];
  for (const [name, fn, re] of cases) await t.test(name, () => assert.throws(fn, { message: re }));
});

test('inputs are not changed and outputs share no arrays', () => {
  const root = [0, 0, 0];
  const segs = [{ length: 2, radius: [1, 1], bend: 0.3 }, { length: 2, radius: [1, 1], bend: 0.3 }];
  const out = pose(root, BASE, segs);
  out[0].end[0] = 99;
  assert.strictEqual(out[1].start[0], 0, 'next start is a copy of the previous end');
  assert.deepStrictEqual(root, [0, 0, 0]);
  assert.deepStrictEqual(segs[0].radius, [1, 1]);
  assert.notStrictEqual(out[0].radius, segs[0].radius);
});

test('fabrik solves 2D and 3D chains while preserving exact segment lengths and respecting poles', () => {
  const chain3 = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]];
  const res = fabrik(chain3, [1.5, 1.5, 0.5], { pole: [0, 3, 0], maxBend: Math.PI * 0.75, tolerance: 1e-5, iterations: 64 });
  assert.strictEqual(res.reached, true);
  assert.ok(dist(res.joints[0], chain3[0]) < 1e-12);
  assert.ok(dist(res.joints[3], [1.5, 1.5, 0.5]) < 1e-4);
  for (let i = 0; i < 3; i++) assert.ok(near(dist(res.joints[i], res.joints[i + 1]), 1, 1e-6));

  const far = fabrik(chain3, [10, 0, 0]);
  assert.strictEqual(far.reached, false);
  assert.ok(near(dist(far.joints[0], far.joints[3]), 3, 1e-6));

  const res2 = fabrik([[0, 0], [2, 0], [4, 0]], [2, 2], { pole: [0, 4] });
  assert.strictEqual(res2.reached, true);
  assert.strictEqual(res2.joints[0].length, 2);
});

test('fabrik bends a straight chain, to the pole side it is given', () => {
  const chain = [[0, 0], [1, 0], [2, 0], [3, 0]];
  const onLine = fabrik(chain, [2.5, 0]);
  assert.strictEqual(onLine.reached, true, `a straight chain must bend to reach a nearer point on its line, error ${onLine.error}`);
  for (const sign of [1, -1]) {
    const r = fabrik(chain, [2, 0.5], { pole: [1.5, 5 * sign] });
    assert.strictEqual(r.reached, true);
    for (const j of r.joints.slice(1, 3)) assert.ok(Math.sign(j[1] - 0.25 * j[0]) === sign, `joint ${j} is not on the pole's side`);
    for (let i = 0; i < 3; i++) assert.ok(near(Math.hypot(r.joints[i + 1][0] - r.joints[i][0], r.joints[i + 1][1] - r.joints[i][1]), 1, 1e-9));
  }
  const limited = fabrik(chain, [1, 1], { maxBend: 0.6, iterations: 200 });
  assert.strictEqual(limited.reached, false, 'a target the bend limit rules out is not reached');
  assert.deepStrictEqual(chain, [[0, 0], [1, 0], [2, 0], [3, 0]]);
});

test('fabrik refuses joints, a target or options it cannot use', () => {
  assert.throws(() => fabrik([[0, 0]], [1, 1]), /fabrik: joints must be a list of at least 2 points, got 1/);
  assert.throws(() => fabrik([[0, 0], [0, 0]], [1, 1]), /fabrik: joints 0 and 1 must not coincide/);
  assert.throws(() => fabrik([[0, 0], [1, 0]], [1, 1, 1]), /fabrik: target must be a finite \[x, y\], like the joints/);
  assert.throws(() => fabrik([[0, 0], [1, 0]], [1, 1], { maxBend: 4 }), /fabrik: maxBend must be radians in \(0, PI\], got 4/);
  assert.throws(() => fabrik([[0, 0], [1, 0]], [1, 1], { iterations: 0 }), /fabrik: iterations must be a whole number from 1 to 256, got 0/);
});
