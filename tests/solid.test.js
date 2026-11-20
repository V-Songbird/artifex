// Solids drawn as lines from any angle (core/solid.js): the camera, the
// solids, and the edges that show, with what a nearer face hides left out.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { box, prism, cylinder, loft, place, camera, outlines, ellipsoid, hullOutline, bvh } = require('../core/solid.js');
const { rng } = require('../core/rand.js');
const { lengthOf } = require('../core/geom.js');

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);
const frame = [0, 0, 800, 600];
const cam = (eye, target = [0, 0, 0], lens = 50) => camera({ eye, target, lens, frame });
const pieces = (paths, kind, hidden = false) => paths.filter((p) => p.kind === kind && p.hidden === hidden).reduce((n, p) => n + p.points.length - 1, 0);

test('camera puts its target on the middle of the frame, with x to the right, z up and depth ahead', () => {
  const c = cam([0, -10, 0]);
  const [x, y, depth] = c.project([0, 0, 0]);
  near(x, 400); near(y, 300); near(depth, 10);
  assert.ok(c.project([1, 0, 0])[0] > 400, 'a point to the right lands to the right');
  assert.ok(c.project([0, 0, 1])[1] < 300, 'a point above lands higher in the picture');
  near(c.project([1, 0, 0])[0] - 400, 50 / 36 * 800 / 10);
  near(cam([0, -10, 0], [0, 0, 0], 100).project([1, 0, 0])[0] - 400, 2 * (c.project([1, 0, 0])[0] - 400));
  assert.ok(c.project([0, -20, 0])[2] < 0, 'behind the eye the depth is under 0');
  assert.throws(() => camera({ eye: [0, 0, 0], target: [0, 0, 0], frame }), /camera: eye and target must be two different points/);
  assert.throws(() => camera({ eye: [0, 0, 5], target: [0, 0, 0], frame }), /camera: the camera cannot look straight up or down/);
  assert.throws(() => camera({ eye: [0, -1, 0], target: [0, 0, 0], frame: [0, 0, 0, 1] }), /camera: frame must be \[x, y, w, h\] with a positive size/);
  assert.throws(() => camera({ eye: [0, -1], target: [0, 0, 0], frame }), /camera: eye must be a finite \[x, y, z\] point/);
});

test('a box seen from a corner shows six outline edges and three creases, and its far edges only when asked', () => {
  const cube = box([2, 2, 2], [-1, -1, -1]), c = cam([6, -7, 5]);
  const shown = outlines([cube], c, { step: 1e6 });
  assert.equal(pieces(shown, 'silhouette'), 6);
  assert.equal(pieces(shown, 'crease'), 3);
  assert.equal(shown.filter((p) => p.hidden).length, 0);
  const all = outlines([cube], c, { step: 1e6, hidden: true });
  assert.equal(pieces(all, 'crease', true), 3, 'the three edges behind the box');
  assert.equal(pieces(all, 'silhouette', true), 0);
  const outline = shown.filter((p) => p.kind === 'silhouette');
  assert.equal(outline.length, 1, 'the outline is one closed path');
  assert.deepEqual(outline[0].points[0], outline[0].points[outline[0].points.length - 1]);
  for (const p of shown) assert.ok(p.depth > 8 && p.depth < 13, `a path's depth is its distance from the eye, got ${p.depth}`);
  assert.deepEqual(outlines([cube], c, { step: 1e6 }), shown, 'the same solids and camera give the same paths');
});

test('a nearer solid hides what lies behind it and cuts what it half covers', () => {
  const wall = box([4, 0.2, 4], [-2, -1, -2]), c = cam([0, -12, 0]);
  const behind = box([1, 1, 1], [-0.5, 2, -0.5]);
  const both = outlines([wall, behind], c, { step: 2 });
  const [wx0, wy0] = c.project([-2, -1, 2]), [wx1, wy1] = c.project([2, -1, -2]);
  const inside = ([x, y]) => x > wx0 + 0.5 && x < wx1 - 0.5 && y > wy0 + 0.5 && y < wy1 - 0.5;
  const alone = outlines([wall], c, { step: 2 });
  assert.equal(both.length, alone.length, 'a box wholly behind the wall adds no path');
  const half = outlines([wall, box([3, 1, 1], [0.5, 2, -0.5])], c, { step: 1 });
  const extra = half.filter((p) => p.points.some(([x]) => x > wx1 + 1));
  assert.ok(extra.length > 0, 'the part beside the wall shows');
  for (const p of extra) for (const q of p.points) assert.ok(!inside(q), `a point of the far box lies behind the wall at ${q}`);
  const dashed = outlines([wall, box([3, 1, 1], [0.5, 2, -0.5])], c, { step: 1, hidden: true }).filter((p) => p.hidden);
  assert.ok(dashed.some((p) => p.points.every(inside)), 'asked for, the part behind the wall comes back marked hidden');
});

test('a cylinder shows its two sides and its rims, not its facets', () => {
  const c = cam([0, -20, 10]), paths = outlines([cylinder(2, 6, { sides: 48 })], c, { step: 1 });
  assert.equal(paths.filter((p) => p.kind === 'crease').length <= 2, true, 'creases only along the rims');
  const sides = paths.filter((p) => p.kind === 'silhouette');
  const tall = sides.flatMap((p) => p.points).reduce((m, q) => [Math.min(m[0], q[1]), Math.max(m[1], q[1])], [Infinity, -Infinity]);
  assert.ok(tall[1] - tall[0] > 150, 'the outline runs the cylinder\'s height');
  const total = paths.reduce((n, p) => n + lengthOf(p.points), 0);
  const few = outlines([cylinder(2, 6, { sides: 12 })], c, { step: 1 }).reduce((n, p) => n + lengthOf(p.points), 0);
  assert.ok(Math.abs(total - few) / total < 0.05, `more facets add no lines: ${total} against ${few}`);
  assert.throws(() => cylinder(0, 1), /cylinder: r, h and top must be over 0/);
  assert.throws(() => cylinder(1, 1, { sides: 2 }), /cylinder: sides must be a whole number from 3 to 720, got 2/);
});

test('a prism of any outline hides through its body and not through its notch', () => {
  const ell = prism([[-3, 0], [3, 0], [3, 1], [-1, 1], [-1, 4], [-3, 4]], 3), c = cam([0.5, -30, 12], [0.5, 2, 1.5], 80);
  const post = (x, y) => box([0.4, 0.4, 2.6], [x, y, 0]);
  const count = (solids) => outlines(solids, c, { step: 1 }).reduce((n, p) => n + lengthOf(p.points), 0);
  const base = count([ell]);
  assert.ok(count([ell, post(-2.2, 5)]) - base < count([ell, post(1.5, 5)]) - base, 'a post behind the tall arm shows less than one behind the notch');
  assert.throws(() => prism([[0, 0], [1, 0]], 1), /prism: takes a ring of at least 3 finite \[x, y\] points/);
  assert.throws(() => prism([[0, 0], [1, 0], [0, 1]], 2, 1), /prism: the high z must lie above the low one, got 2 and 1/);
  assert.throws(() => box([1, 0, 1]), /box: every side must be over 0/);
});

test('loft joins sections, place turns and moves, and outlines refuses what is not a solid', () => {
  const ring = (r, z) => [[r, r, z], [-r, r, z], [-r, -r, z], [r, -r, z]];
  const spire = loft([ring(2, 0), ring(1, 3), ring(0.2, 5)]);
  assert.equal(spire.points.length, 12);
  assert.equal(spire.faces.length, 10);
  assert.ok(outlines([spire], cam([9, -12, 6], [0, 0, 2.5])).length > 0);
  const turned = place(box([1, 1, 1]), { turn: Math.PI / 2, move: [0, 0, 2] });
  near(turned.points[1][0], 0); near(turned.points[1][1], 1); near(turned.points[1][2], 2);
  assert.throws(() => loft([ring(1, 0)]), /loft: takes two or more rings/);
  assert.throws(() => loft([ring(1, 0), ring(1, 1).slice(1)]), /loft: every ring must have the same number of points, 3 or more/);
  assert.throws(() => outlines([{}], cam([0, -5, 1])), /outlines: each solid must come from box, prism, cylinder, loft or place/);
  assert.throws(() => outlines([box([1, 1, 1])], {}), /outlines: takes a camera made by camera\(\)/);
  assert.throws(() => outlines([box([1, 1, 1])], cam([0, -5, 1]), { step: 0 }), /outlines: step must be a spacing over 0, got 0/);
});

// Smooth parts: the outline of ellipsoids and of the convex hull of several.
const shoelace = (r) => r.reduce((s, a, i) => { const b = r[(i + 1) % r.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;
const support = (pts, t) => pts.reduce((m, [x, y]) => Math.max(m, x * Math.cos(t) + y * Math.sin(t)), -Infinity);
// Points on each ellipsoid's surface, projected: a convex body's outline reaches exactly as far as its surface does.
const cloud = (parts, c) => parts.flatMap((e) => {
  const out = [];
  for (let i = 0; i <= 120; i++) for (let j = 0; j < 240; j++) {
    const th = i / 120 * Math.PI, ph = j / 240 * 2 * Math.PI, s = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
    out.push(c.project([0, 1, 2].map((k) => e.at[k] + e.axes[0][k] * s[0] + e.axes[1][k] * s[1] + e.axes[2][k] * s[2])));
  }
  return out;
});
const sameReach = (ring, pts, tol) => {
  for (let k = 0; k < 90; k++) {
    const t = k / 90 * 2 * Math.PI, a = support(ring, t), b = support(pts, t);
    assert.ok(Math.abs(a - b) <= tol, `along ${t.toFixed(2)} the outline reaches ${a.toFixed(3)}, the surface ${b.toFixed(3)}`);
  }
};

test('camera matrix projects as project does', () => {
  const c = cam([7, -9, 4], [1, 2, 0.5], 35);
  for (const p of [[0, 0, 0], [3, -1, 2], [-4, 5, 1]]) {
    const h = c.matrix.map((r) => r[0] * p[0] + r[1] * p[1] + r[2] * p[2] + r[3]), q = c.project(p);
    near(h[0] / h[2], q[0], 1e-9); near(h[1] / h[2], q[1], 1e-9); near(h[2], q[2], 1e-9);
  }
});

test('a sphere on the axis outlines as a circle of the tangent cone, wider than its middle section', () => {
  const c = cam([0, -10, 0]), focal = 50 / 36 * 800, ring = hullOutline([ellipsoid([0, 0, 0], [3, 3, 3])], c, { step: 1 });
  const radius = focal * 3 / Math.sqrt(91);
  for (const [x, y] of ring) near(Math.hypot(x - 400, y - 300), radius, 1e-6);
  assert.ok(radius - focal * 3 / 10 > 10, 'the tangent cone, not the middle section seen flat');
  assert.ok(shoelace(ring) > 0, 'wound as union winds its outer rings');
  for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; assert.ok(Math.hypot(b[0] - a[0], b[1] - a[1]) <= 1 + 1e-9); }
});

test('an ellipsoid seen along an axis gives the ellipse of the other two, turned or not', () => {
  const c = cam([0, -10, 0]), focal = 50 / 36 * 800, wide = focal * 1 / Math.sqrt(96), tall = focal * 3 / Math.sqrt(96);
  for (const e of [ellipsoid([0, 0, 0], [1, 2, 3]), ellipsoid([0, 0, 0], [[0, 0, 3], [0, -2, 0], [1, 0, 0]])]) {
    const ring = hullOutline([e], c, { step: 0.5 });
    for (const [x, y] of ring) near(((x - 400) / wide) ** 2 + ((y - 300) / tall) ** 2, 1, 1e-9);
    near(Math.max(...ring.map((p) => p[1])) - 300, tall, 0.01);
    assert.ok(shoelace(ring) > 0);
  }
});

test('a skewed ellipsoid off the axis reaches exactly as far as its surface, from an oblique camera', () => {
  const c = cam([9, -11, 6], [0.5, 0.5, 0.5], 40), e = ellipsoid([1.5, -0.5, 1], [[1.2, 0.4, 0.1], [-0.3, 0.9, 0.5], [0.2, -0.4, 1.6]]);
  sameReach(hullOutline([e], c, { step: 0.5 }), cloud([e], c), 0.3);
});

test('the hull of two spheres holds both outlines and reaches as far as the two surfaces, no further', () => {
  const c = cam([6, -12, 5], [1, 0, 1], 50), a = ellipsoid([0, 0, 0], [1, 1, 1]), b = ellipsoid([3, 1, 2], [0.5, 0.5, 0.5]);
  const ring = hullOutline([a, b], c, { step: 0.5 });
  assert.ok(shoelace(ring) > 0);
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length], r = ring[(i + 2) % ring.length];
    assert.ok((q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]) >= -1e-9, 'convex');
  }
  const own = [...hullOutline([a], c, { step: 0.5 }), ...hullOutline([b], c, { step: 0.5 })];
  for (let k = 0; k < 90; k++) { const t = k / 90 * 2 * Math.PI; assert.ok(support(ring, t) >= support(own, t) - 1e-9); }
  sameReach(ring, cloud([a, b], c), 0.3);
  assert.ok(support(ring, 0) > support(hullOutline([a], c), 0) + 10, 'the smaller sphere widens it');
});

test('hullOutline gives null for a part at or behind the eye, and refuses what is not an ellipsoid', () => {
  const c = cam([0, -10, 0]);
  assert.equal(hullOutline([ellipsoid([0, -10, 0], [1, 1, 1])], c), null, 'the eye inside');
  assert.equal(hullOutline([ellipsoid([0, 0, 0], [1, 1, 1]), ellipsoid([0, -9.5, 0], [1, 1, 1])], c), null, 'one part across the eye plane');
  assert.equal(hullOutline([ellipsoid([0, -20, 0], [1, 1, 1])], c), null, 'behind');
  assert.throws(() => ellipsoid([0, 0, 0], [1, 0, 1]), /ellipsoid: axes must be three lengths over 0/);
  assert.throws(() => ellipsoid([0, 0, 0], [[1, 0, 0], [0, 1, 0], [1, 1, 0]]), /ellipsoid: the three axes must not lie in one plane/);
  assert.throws(() => ellipsoid([0, 0], [1, 1, 1]), /ellipsoid: at must be a finite \[x, y, z\] point/);
  assert.throws(() => hullOutline([], c), /hullOutline: takes a list of one or more ellipsoids/);
  assert.throws(() => hullOutline([{ at: [0, 0, 0], axes: [1, 1] }], c), /ellipsoid: axes must be three lengths/);
  assert.throws(() => hullOutline([ellipsoid([0, 0, 0], [1, 1, 1])], { project: c.project }), /hullOutline: takes a camera made by camera\(\)/);
  assert.throws(() => hullOutline([ellipsoid([0, 0, 0], [1, 1, 1])], c, { step: -1 }), /hullOutline: step must be a spacing over 0, got -1/);
});

// A ray against each face's own plane, then even-odd inside its ring: no triangles, no tree.
function bruteHits(solids, o, d, near = 1e-6) {
  const hits = [];
  solids.forEach((solid, s) => solid.faces.forEach((face, f) => {
    const pts = face.ring.map((i) => solid.points[i]);
    const n = [0, 0, 0];
    pts.forEach((a, i) => { const b = pts[(i + 1) % pts.length]; n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1]); });
    const nd = n[0] * d[0] + n[1] * d[1] + n[2] * d[2];
    if (Math.abs(nd) < 1e-12) return;
    const t = (n[0] * (pts[0][0] - o[0]) + n[1] * (pts[0][1] - o[1]) + n[2] * (pts[0][2] - o[2])) / nd;
    if (!(t >= near)) return;
    const p = [0, 1, 2].map((k) => o[k] + d[k] * t), drop = [0, 1, 2].reduce((m, k) => (Math.abs(n[k]) > Math.abs(n[m]) ? k : m), 0);
    const [i, j] = [0, 1, 2].filter((k) => k !== drop);
    let inside = false;
    for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
      const pa = pts[a], pb = pts[b];
      if ((pa[j] > p[j]) !== (pb[j] > p[j]) && p[i] < pa[i] + (pb[i] - pa[i]) * (p[j] - pa[j]) / (pb[j] - pa[j])) inside = !inside;
    }
    if (inside) hits.push({ t, solid: s, face: f });
  }));
  return hits.sort((a, b) => a.t - b.t);
}

const uShape = () => prism([[0, -4], [3, -4], [3, -1], [2, -1], [2, -3], [1, -3], [1, -1], [0, -1]], 0, 2);
const scene = () => [
  box([2, 2, 2], [-3, -3, 0]),
  place(box([1, 2, 1]), { turn: 0.7, move: [2, 1, 0.5] }),
  cylinder(1, 2, { at: [0, 3, 0] }),
  cylinder(1, 2, { at: [-3, 2, 0], top: 0.4, sides: 9 }),
  uShape(),
];

test('bvh finds the same first face as a ray tested against every face, axis-parallel rays, rays from inside and misses included', () => {
  const solids = scene(), tree = bvh(solids), R = rng(11);
  let bad = 0, first = -1, hits = 0, misses = 0, compared = 0;
  for (let i = 0; i < 400; i++) {
    const o = [R('ray', 'x', i) * 12 - 6, R('ray', 'y', i) * 12 - 6, R('ray', 'z', i) * 5 - 1];
    let d;
    if (i % 4 === 0) { d = [0, 0, 0]; d[i % 3] = R('ray', 's', i) < 0.5 ? -1 : 1; } else if (i % 4 !== 3) {
      const aim = [R('aim', 'x', i) * 7 - 3.5, R('aim', 'y', i) * 8 - 4, R('aim', 'z', i) * 2], len = Math.hypot(...aim.map((v, k) => v - o[k]));
      d = aim.map((v, k) => (v - o[k]) / len);
    } else {
      d = [R('ray', 'dx', i) * 2 - 1, R('ray', 'dy', i) * 2 - 1, R('ray', 'dz', i) * 2 - 1];
      const len = Math.hypot(...d); d = d.map((v) => v / len);
    }
    const want = bruteHits(solids, o, d), got = tree.intersect(o, d);
    let ok = (got === null) === (want.length === 0);
    if (ok && got) {
      ok = Math.abs(got.t - want[0].t) < 1e-9;
      const tied = want.some((h) => (h.solid !== want[0].solid || h.face !== want[0].face) && h.t - want[0].t < 1e-7);
      if (ok && !tied) { ok = got.solid === want[0].solid && got.face === want[0].face; compared++; }
    }
    if (ok && tree.occluded(o, d) !== (want.length > 0)) ok = false;
    if (got) hits++; else misses++;
    if (!ok) { bad++; if (first < 0) first = i; }
  }
  assert.equal(bad, 0, `${bad} of 400 rays disagree, the first at ray ${first}`);
  assert.ok(hits > 100 && misses > 50 && compared > 100, `${hits} hits, ${misses} misses, ${compared} faces compared`);
});

test('bvh cuts a concave end face along its own outline, so a ray down the notch of a U misses it', () => {
  const tree = bvh([uShape()]);
  assert.equal(tree.intersect([1.6, -2.2, 5], [0, 0, -1]), null);
  const hit = tree.intersect([0.5, -2, 5], [0, 0, -2]);
  near(hit.t, 3, 1e-12);
  assert.deepEqual(hit.normal, [0, 0, 1]);
  assert.deepEqual(hit.point, [0.5, -2, 2]);
  assert.equal(tree.intersect([0.5, -2, 1], [0, 0, 1]).normal[2], 1, 'from inside, the ray meets the face it leaves by, its normal still outward');
  assert.equal(tree.intersect([0.5, -2, 5], [0, 0, -1], 1e-6, 2.5), null, 'nothing nearer than far');
  assert.deepEqual(tree.bounds, { min: [0, -4, 0], max: [3, -1, 2] });
});

test('bvh ambient occlusion is open over a floor, half open at the foot of a wall, closed inside a box', () => {
  const R = rng(7), floor = box([20, 20, 1], [-10, -10, -1]);
  assert.equal(bvh([floor]).ao([0, 0, 0], [0, 0, 1], R, 0, { samples: 64, radius: 5 }), 1);
  const walled = bvh([floor, box([1, 2000, 2000], [-1, -1000, 0])]);
  let sum = 0;
  for (let id = 0; id < 50; id++) sum += walled.ao([1e-3, 0, 0], [0, 0, 1], R, id, { samples: 64, radius: 1e5 });
  near(sum / 50, 0.5, 0.03);
  assert.equal(bvh([box([2, 2, 2], [-1, -1, -1])]).ao([0, 0, 0], [0, 0, 1], R, 3, { samples: 64, radius: 10 }), 0);
});

test('bvh soft shadows are dark under a roof, lit in the open, partial at the roof edge, and the same for the same R and id', () => {
  const R = rng(3), floor = box([20, 20, 1], [-10, -10, -1]), roofed = bvh([floor, box([4, 4, 0.2], [-2, -2, 2])]);
  assert.equal(roofed.softShadow([0, 0, 0], [0, 0, 1], [0, 0, 1], R, 1), 0);
  assert.equal(bvh([floor]).softShadow([0, 0, 0], [0, 0, 1], [0, 0, 1], R, 1), 1);
  const edge = roofed.softShadow([2, 0, 0], [0, 0, 1], [0, 0, 1], R, 2, { samples: 64, spread: 0.5 });
  assert.ok(edge > 0.1 && edge < 0.9, `the roof edge gives ${edge}`);
  assert.equal(roofed.softShadow([2, 0, 0], [0, 0, 1], [0, 0, 1], R, 2, { samples: 64, spread: 0.5 }), edge);
  assert.equal(bvh([]).intersect([0, 0, 0], [1, 0, 0]), null);
});

test('bvh refuses what it cannot use', () => {
  const tree = bvh([box([1, 1, 1])]), R = rng(1);
  assert.throws(() => bvh('box'), /bvh: takes a list of solids/);
  assert.throws(() => bvh([{}]), /bvh: each solid must come from box, prism, cylinder, loft or place/);
  assert.throws(() => tree.intersect([0, 0, 0], [0, 0, 0]), /intersect: dir must not be \[0, 0, 0\]/);
  assert.throws(() => tree.occluded([0, 0], [1, 0, 0]), /occluded: origin must be a finite \[x, y, z\] point/);
  assert.throws(() => tree.ao([0, 0, 0], [0, 0, 0], R), /ao: normal must not be \[0, 0, 0\]/);
  assert.throws(() => tree.softShadow([0, 0, 0], [0, 0, 1], [0, 0, 0], R), /softShadow: toLight must not be \[0, 0, 0\]/);
  assert.throws(() => tree.ao([0, 0, 0], [0, 0, 1], 7),/ao: R must be the piece's random source/);
  assert.throws(() => tree.ao([0, 0, 0], [0, 0, 1], R, -1), /ao: id must be a whole number from 0 to 2\^25 - 1, got -1/);
  assert.throws(() => tree.softShadow([0, 0, 0], [0, 0, 1], [0, 0, 1], R, 0, { samples: 65 }), /softShadow: samples must be a whole number from 1 to 64, got 65/);
});
