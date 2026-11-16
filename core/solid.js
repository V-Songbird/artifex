// Solids modelled once and drawn as lines from any angle: boxes, prisms,
// cylinders and lofts in a space where z is up, a camera that looks at them,
// and the edges a line drawing shows, with what hides behind a face left out;
// and the exact outline of ellipsoids and of the convex hull of several.
// The result is paths in the picture, for any style's marks to draw.
//
// Nothing here knows what kind of art a piece makes.
'use strict';

const { triangulate } = require('./mesh.js');
const { chain } = require('./geom.js');
const { Delaunator } = require('./delaunator.js');

function point3(who, what, p) {
  if (!Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite)) throw new TypeError(`${who}: ${what} must be a finite [x, y, z] point`);
  return p;
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const n = Math.hypot(...a); return [a[0] / n, a[1] / n, a[2] / n]; };

function ring2(who, ring) {
  if (!Array.isArray(ring) || ring.length < 3 || !ring.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) {
    throw new TypeError(`${who}: takes a ring of at least 3 finite [x, y] points, the closing point not repeated`);
  }
}

/**
 * A solid from sections: rings of [x, y, z] points, each with the same number
 * of points, joined in order by side faces, with the first and last ring as
 * its ends. Wind every ring counter-clockwise seen from the last ring's side.
 * `smooth: true` marks the sides as one curved surface, which shows where it
 * turns away from the eye and not along each facet.
 */
function loft(rings, opt = {}) {
  if (!Array.isArray(rings) || rings.length < 2) throw new TypeError('loft: takes two or more rings of [x, y, z] points');
  const n = rings[0].length;
  for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length !== n || n < 3) throw new TypeError('loft: every ring must have the same number of points, 3 or more');
    for (const p of ring) point3('loft', 'a ring point', p);
  }
  const points = rings.flat().map((p) => [...p]), faces = [], soft = opt.smooth === true ? 1 : 0;
  for (let r = 0; r + 1 < rings.length; r++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      faces.push({ ring: [r * n + i, r * n + j, (r + 1) * n + j, (r + 1) * n + i], soft });
    }
  }
  faces.push({ ring: Array.from({ length: n }, (_, i) => n - 1 - i), soft: 0 });
  faces.push({ ring: Array.from({ length: n }, (_, i) => (rings.length - 1) * n + i), soft: 0 });
  return { points, faces };
}

/** A ring of [x, y] points, counter-clockwise, raised from `z0` to `z1` (default 0 to `z0`): a slab, a wall, any outline with a height. */
function prism(ring, z0, z1) {
  ring2('prism', ring);
  if (!Number.isFinite(z0) || (z1 !== undefined && !Number.isFinite(z1))) throw new RangeError('prism: takes a height, or a low and a high z');
  const [low, high] = z1 === undefined ? [0, z0] : [z0, z1];
  if (!(high > low)) throw new RangeError(`prism: the high z must lie above the low one, got ${low} and ${high}`);
  let area = 0;
  for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; area += a[0] * b[1] - b[0] * a[1]; }
  const ccw = area >= 0 ? ring : [...ring].reverse();
  return loft([ccw.map(([x, y]) => [x, y, low]), ccw.map(([x, y]) => [x, y, high])]);
}

/** A box of `size` [w, d, h] whose low corner is `at` (default the origin). */
function box(size, at = [0, 0, 0]) {
  point3('box', 'size', size);
  point3('box', 'at', at);
  if (!size.every((v) => v > 0)) throw new RangeError(`box: every side must be over 0, got ${size}`);
  const [x, y, z] = at, [w, d, h] = size;
  return prism([[x, y], [x + w, y], [x + w, y + d], [x, y + d]], z, z + h);
}

/**
 * A cylinder, or a cone cut short, standing on `at`: radius `r` at the foot,
 * `top` at the head (default `r`), height `h`, drawn as `sides` flat faces
 * (default 24) that count as one curved surface.
 */
function cylinder(r, h, opt = {}) {
  const { at = [0, 0, 0], top = r, sides = 24 } = opt;
  point3('cylinder', 'at', at);
  if (!(r > 0 && h > 0 && top > 0 && Number.isFinite(r + h + top))) throw new RangeError(`cylinder: r, h and top must be over 0, got ${r}, ${h}, ${top}`);
  if (!(Number.isInteger(sides) && sides >= 3 && sides <= 720)) throw new RangeError(`cylinder: sides must be a whole number from 3 to 720, got ${sides}`);
  const ring = (radius, z) => Array.from({ length: sides }, (_, i) => { const a = i / sides * Math.PI * 2; return [at[0] + radius * Math.cos(a), at[1] + radius * Math.sin(a), z]; });
  return loft([ring(r, at[2]), ring(top, at[2] + h)], { smooth: true });
}

/** The solid moved by `move` [x, y, z] after a turn of `turn` radians about the z axis through `about` (default the origin). A new solid. */
function place(solid, opt = {}) {
  const { move = [0, 0, 0], turn = 0, about = [0, 0, 0] } = opt;
  point3('place', 'move', move);
  point3('place', 'about', about);
  if (!Number.isFinite(turn)) throw new RangeError(`place: turn must be a finite angle in radians, got ${turn}`);
  const c = Math.cos(turn), s = Math.sin(turn);
  return {
    points: solid.points.map(([x, y, z]) => { const u = x - about[0], v = y - about[1]; return [about[0] + u * c - v * s + move[0], about[1] + u * s + v * c + move[1], z + move[2]]; }),
    faces: solid.faces,
  };
}

/**
 * A camera at `eye` looking at `target`, z up. `lens` (default 50) is the
 * focal length for a frame 36 wide, so 24 is wide and 100 is long. The
 * picture is laid on `frame`, [x, y, w, h] in design units: the target lands
 * on its middle. Returns `{ eye, project }`, where `project(p)` gives
 * [x, y, depth] and depth is the distance in front of the eye, under 0 behind it.
 */
function camera(opt = {}) {
  const { eye, target, lens = 50, frame } = opt;
  point3('camera', 'eye', eye);
  point3('camera', 'target', target);
  if (!(lens > 0 && Number.isFinite(lens))) throw new RangeError(`camera: lens must be a focal length over 0, got ${lens}`);
  if (!(Array.isArray(frame) && frame.length === 4 && frame.every(Number.isFinite) && frame[2] > 0 && frame[3] > 0)) throw new RangeError('camera: frame must be [x, y, w, h] with a positive size');
  const ahead = sub(target, eye);
  if (Math.hypot(...ahead) === 0) throw new RangeError('camera: eye and target must be two different points');
  const fwd = unit(ahead), flat = cross(fwd, [0, 0, 1]);
  if (Math.hypot(...flat) < 1e-9) throw new RangeError('camera: the camera cannot look straight up or down; move the eye a little to one side');
  const right = unit(flat), up = cross(right, fwd), focal = lens / 36 * frame[2], cx = frame[0] + frame[2] / 2, cy = frame[1] + frame[3] / 2;
  const project = (p) => {
    const v = sub(p, eye), depth = dot(v, fwd);
    return [cx + focal * dot(v, right) / depth, cy - focal * dot(v, up) / depth, depth];
  };
  // The same projection as a 3x4 matrix: [x * depth, y * depth, depth] = matrix * [p, 1].
  const row = (axis, c, sign) => { const r = axis.map((v, i) => sign * focal * v + c * fwd[i]); return [...r, -dot(r, eye)]; };
  return { eye: [...eye], project, matrix: [row(right, cx, 1), row(up, cy, -1), [...fwd, -dot(fwd, eye)]] };
}

/**
 * An ellipsoid: the points `at + A s` with |s| = 1, where A's columns are
 * `axes`, either three lengths [a, b, c] along x, y and z or three [x, y, z]
 * semi-axes, which need not be at right angles. A sphere is [r, r, r].
 * Plain data `{ at, axes }` for `hullOutline`; not a solid for `outlines`.
 */
function ellipsoid(at, axes) {
  point3('ellipsoid', 'at', at);
  const bad = 'ellipsoid: axes must be three lengths over 0, [a, b, c], or three finite [x, y, z] semi-axes';
  if (!Array.isArray(axes) || axes.length !== 3) throw new TypeError(bad);
  let cols;
  if (axes.every((v) => typeof v === 'number')) {
    if (!axes.every((v) => v > 0 && Number.isFinite(v))) throw new RangeError(`${bad}, got ${axes}`);
    cols = axes.map((v, i) => [0, 0, 0].map((_, j) => (i === j ? v : 0)));
  } else {
    if (!axes.every((a) => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite))) throw new TypeError(bad);
    cols = axes.map((a) => [...a]);
    if (!(Math.abs(dot(cols[0], cross(cols[1], cols[2]))) > 1e-12 * Math.hypot(...cols[0]) * Math.hypot(...cols[1]) * Math.hypot(...cols[2]))) {
      throw new RangeError('ellipsoid: the three axes must not lie in one plane');
    }
  }
  return { at: [...at], axes: cols };
}

// The outline of one ellipsoid in the picture: its dual conic, read as a
// centre and a shape, sampled no further apart than `step`. Null when part of
// it lies at or behind the eye's plane, where the outline is no closed curve.
function rim(e, m, step) {
  const b = [...e.axes.map((a) => m.map((r) => dot(r, a))), m.map((r) => dot(r, e.at) + r[3])];
  const w = b[3][2] ** 2 - b[0][2] ** 2 - b[1][2] ** 2 - b[2][2] ** 2;
  if (!(b[3][2] > NEAR && w > NEAR * NEAR)) return null;
  // C* = b0 b0' + b1 b1' + b2 b2' - b3 b3', scaled so its corner is -1.
  const c = (i, j) => (b[0][i] * b[0][j] + b[1][i] * b[1][j] + b[2][i] * b[2][j] - b[3][i] * b[3][j]) / w;
  const x0 = -c(0, 2), y0 = -c(1, 2), sxx = c(0, 0) + x0 * x0, sxy = c(0, 1) + x0 * y0, syy = c(1, 1) + y0 * y0;
  const l00 = Math.sqrt(sxx), l10 = sxy / l00, l11 = Math.sqrt(Math.max(0, syy - l10 * l10));
  const big = Math.sqrt((sxx + syy) / 2 + Math.hypot((sxx - syy) / 2, sxy));
  const n = Math.min(MAX_RIM, Math.max(16, Math.ceil(2 * Math.PI * big / step)));
  return Array.from({ length: n }, (_, k) => { const t = k / n * 2 * Math.PI, u = Math.cos(t), v = Math.sin(t); return [x0 + l00 * u, y0 + l10 * u + l11 * v]; });
}
const MAX_RIM = 4096;

/**
 * The outline in the picture from `cam` of the smallest convex body holding
 * every ellipsoid in `parts`: one ellipsoid's own outline, or for two spheres
 * the outline of both and the surface between them. Exact up to sampling:
 * points no further apart than `opt.step` design units (default 2) round each
 * ellipsoid, at most 4096 for one. Returns a ring of [x, y] points, the
 * closing point not repeated, wound as `union` winds its outer rings, so
 * rings from here unite without leaving holes; null when any part reaches the
 * eye's plane or behind it. Nothing here hides, or is hidden by, other parts.
 */
function hullOutline(parts, cam, opt = {}) {
  if (!Array.isArray(parts) || parts.length === 0) throw new TypeError('hullOutline: takes a list of one or more ellipsoids, such as [ellipsoid([0, 0, 0], [1, 1, 1])]');
  if (!cam || !Array.isArray(cam.matrix)) throw new TypeError('hullOutline: takes a camera made by camera()');
  const { step = 2 } = opt;
  if (!(step > 0 && Number.isFinite(step))) throw new RangeError(`hullOutline: step must be a spacing over 0, got ${step}`);
  const rims = [];
  for (const p of parts) {
    if (!p || typeof p !== 'object') throw new TypeError('hullOutline: each part must come from ellipsoid()');
    const r = rim(ellipsoid(p.at, p.axes), cam.matrix, step);
    if (!r) return null;
    rims.push(r);
  }
  if (rims.length === 1) return rims[0];
  const pts = rims.flat();
  return [...new Delaunator(pts.flat()).hull].reverse().map((i) => pts[i]);
}

// Nearer than this to the eye, in the model's units, nothing is drawn.
const NEAR = 1e-6;

/**
 * The lines a drawing of `solids` shows from `cam`: where a surface turns
 * away from the eye ('silhouette'), where two faces meet at an angle
 * ('crease') and where a surface ends ('boundary'), each cut where a nearer
 * face hides it. Returns paths `{ kind, points, depth, hidden }`: `points`
 * are [x, y] in the picture, joined end to end where lines of one kind meet;
 * `depth` is the path's mean distance from the eye, so nearer lines can be
 * drawn heavier. `opt.crease` (default 20) is the angle in degrees two faces
 * must turn through to show a crease; `opt.step` (default 2) is the spacing
 * in design units at which a line is tested, and so the least a hidden part
 * can be; `opt.hidden: true` also returns the parts behind a face, marked
 * `hidden: true`, for a drawing that dashes them. Where two solids pass
 * through each other, the line they meet along is not found.
 */
function outlines(solids, cam, opt = {}) {
  if (!Array.isArray(solids)) throw new TypeError('outlines: takes a list of solids, such as [box([1, 1, 1])]');
  if (!cam || typeof cam.project !== 'function') throw new TypeError('outlines: takes a camera made by camera()');
  const { crease = 20, step = 2, hidden = false } = opt;
  if (!(crease >= 0 && crease <= 180)) throw new RangeError(`outlines: crease must be an angle from 0 to 180 degrees, got ${crease}`);
  if (!(step > 0 && Number.isFinite(step))) throw new RangeError(`outlines: step must be a spacing over 0, got ${step}`);
  const eye = cam.eye, bend = Math.cos(crease * Math.PI / 180);

  // Every face as triangles that can hide a point, and every edge with the faces on it.
  const tris = [], edges = [];
  solids.forEach((solid, s) => {
    if (!solid || !Array.isArray(solid.points) || !Array.isArray(solid.faces)) throw new TypeError('outlines: each solid must come from box, prism, cylinder, loft or place');
    const byEdge = new Map();
    solid.faces.forEach((face, f) => {
      const pts = face.ring.map((i) => solid.points[i]);
      let normal = [0, 0, 0];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        normal = [normal[0] + (a[1] - b[1]) * (a[2] + b[2]), normal[1] + (a[2] - b[2]) * (a[0] + b[0]), normal[2] + (a[0] - b[0]) * (a[1] + b[1])];
      }
      if (Math.hypot(...normal) === 0) return;
      normal = unit(normal);
      const info = { normal, front: dot(normal, sub(eye, pts[0])) > 0, soft: face.soft, id: `${s}:${f}` };
      // Triangles: a fan for a face of four points or fewer, an ear cut for a larger one, laid flat on its own plane.
      let cut;
      if (pts.length <= 4) cut = pts.slice(2).map((p, i) => [pts[0], pts[i + 1], p]);
      else {
        const u = unit(Math.abs(normal[2]) < 0.9 ? cross(normal, [0, 0, 1]) : cross(normal, [1, 0, 0])), v = cross(normal, u);
        const flat = pts.map((p) => [dot(p, u), dot(p, v)]), index = new Map(flat.map((p, i) => [p, pts[i]]));
        cut = triangulate(flat).map((t) => t.map((p) => index.get(flat.find((q) => q[0] === p[0] && q[1] === p[1]))));
      }
      for (const t of cut) {
        const q = t.map(cam.project);
        if (q.some((p) => p[2] <= NEAR)) continue;
        tris.push({ a: t[0], ab: sub(t[1], t[0]), ac: sub(t[2], t[0]), face: info.id, x0: Math.min(q[0][0], q[1][0], q[2][0]), x1: Math.max(q[0][0], q[1][0], q[2][0]), y0: Math.min(q[0][1], q[1][1], q[2][1]), y1: Math.max(q[0][1], q[1][1], q[2][1]) });
      }
      face.ring.forEach((a, i) => {
        const b = face.ring[(i + 1) % face.ring.length], key = a < b ? `${a},${b}` : `${b},${a}`;
        if (!byEdge.has(key)) byEdge.set(key, { a: solid.points[a], b: solid.points[b], faces: [] });
        byEdge.get(key).faces.push(info);
      });
    });
    for (const e of byEdge.values()) {
      const [p, q] = e.faces;
      let kind = null;
      if (!q) kind = 'boundary';
      else if (p.front !== q.front) kind = 'silhouette';
      else if ((p.front || hidden) && !(p.soft && p.soft === q.soft) && dot(p.normal, q.normal) < bend) kind = 'crease';
      if (kind) edges.push({ a: e.a, b: e.b, kind, own: e.faces.map((f) => f.id) });
    }
  });

  // A point is hidden when a triangle of another face crosses the line from the eye to it.
  const seen = (p, x, y, own) => {
    const ray = sub(p, eye);
    for (const t of tris) {
      if (x < t.x0 || x > t.x1 || y < t.y0 || y > t.y1 || own.includes(t.face)) continue;
      const h = cross(ray, t.ac), det = dot(t.ab, h);
      if (Math.abs(det) < 1e-12) continue;
      const s = sub(eye, t.a), u = dot(s, h) / det;
      if (u < 0 || u > 1) continue;
      const q = cross(s, t.ab), v = dot(ray, q) / det;
      if (v < 0 || u + v > 1) continue;
      const along = dot(t.ac, q) / det;
      if (along > 1e-9 && along < 1 - 1e-6) return false;
    }
    return true;
  };

  const runs = { silhouette: [[], []], crease: [[], []], boundary: [[], []] }, depths = new Map();
  for (const e of edges) {
    const pa = cam.project(e.a), pb = cam.project(e.b);
    if (pa[2] <= NEAR || pb[2] <= NEAR) continue;
    const n = Math.max(1, Math.ceil(Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) / step));
    const at = (k) => { const t = k / n, p = [e.a[0] + (e.b[0] - e.a[0]) * t, e.a[1] + (e.b[1] - e.a[1]) * t, e.a[2] + (e.b[2] - e.a[2]) * t]; return { q: k === 0 ? pa : k === n ? pb : cam.project(p), p }; };
    // The middle of each piece decides whether the piece shows.
    let from = at(0), open = null, state = null;
    const close = (end) => { if (open) { const seg = [[open.q[0], open.q[1]], [end.q[0], end.q[1]]]; depths.set(seg, (open.q[2] + end.q[2]) / 2); runs[e.kind][state ? 0 : 1].push(seg); } };
    for (let k = 1; k <= n; k++) {
      const to = at(k), mid = at(k - 0.5), show = seen(mid.p, mid.q[0], mid.q[1], e.own);
      if (show !== state) { close(from); open = from; state = show; }
      from = to;
    }
    close(from);
  }

  const out = [];
  for (const kind of ['silhouette', 'boundary', 'crease']) {
    [false, true].forEach((behind, which) => {
      if (behind && !hidden) return;
      const segs = runs[kind][which], depthAt = new Map();
      for (const seg of segs) for (const p of seg) { const key = `${p[0]},${p[1]}`; depthAt.set(key, depths.get(seg)); }
      for (const path of chain(segs)) {
        const near = path.map((p) => depthAt.get(`${p[0]},${p[1]}`)).filter((d) => d !== undefined);
        out.push({ kind, points: path, depth: near.reduce((a, b) => a + b, 0) / (near.length || 1), hidden: behind });
      }
    });
  }
  return out;
}

module.exports = { box, prism, cylinder, loft, place, camera, outlines, ellipsoid, hullOutline };
