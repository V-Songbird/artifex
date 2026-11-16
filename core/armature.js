// Depth armature: jointed segments posed in 3D and projected to the picture.
// Any jointed thing fits, such as a limb, a crane arm, a tail or a branch:
// segments with a length and a radius at each end, joints that bend and twist,
// a two-segment reach with a bend direction, and a projection that returns each
// segment's ends, foreshortening and section ellipses. Pure functions, no canvas.
//
// World points are [x, y, z]. With the default view, picture x is world x,
// picture y is world y (growing down, as on a canvas), and z is depth, growing
// away from the viewer, so -z points toward the viewer.
//
// Nothing here knows what a piece depicts.

'use strict';

// Below this, a projected direction or a depth component counts as zero.
const EPS = 1e-12;

function finite3(name, what, p) {
  if (!Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite)) {
    throw new TypeError(`${name}: ${what} must be a finite [x, y, z], got ${Array.isArray(p) ? `[${p.join(', ')}]` : p}`);
  }
}

function dot(p, q) { return p[0] * q[0] + p[1] * q[1] + p[2] * q[2]; }

function cross(p, q) {
  return [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
}

/** p * kp + q * kq. */
function comb(p, kp, q, kq) { return p.map((v, i) => v * kp + q[i] * kq); }

function unit(name, what, v) {
  const len = Math.hypot(...v);
  if (!(len > 0)) throw new RangeError(`${name}: ${what} must have a length above 0`);
  return v.map((x) => x / len);
}

/** Two numbers, each finite and not below 0. */
function radii(name, what, r) {
  if (!Array.isArray(r) || r.length !== 2 || !r.every((x) => Number.isFinite(x) && x >= 0)) {
    throw new RangeError(`${name}: ${what} radius must be [r0, r1], two finite numbers not below 0, got ${Array.isArray(r) ? `[${r.join(', ')}]` : r}`);
  }
  return [r[0], r[1]];
}

/**
 * Poses a chain of segments from `root`. `base` is the frame before the first
 * joint: `forward` is normalised, `side` made perpendicular to it, and the
 * normal is forward x side. Each joint first twists the parent frame about its
 * forward axis by `twist`, then bends forward toward the normal by `bend`.
 */
function pose(root, base, segments) {
  finite3('pose', 'root', root);
  if (!base || typeof base !== 'object') throw new TypeError(`pose: base must be { forward, side }, got ${base}`);
  finite3('pose', 'base forward', base.forward);
  finite3('pose', 'base side', base.side);
  let f = unit('pose', 'base forward', base.forward);
  const side = comb(base.side, 1, f, -dot(base.side, f));
  if (Math.hypot(...side) <= EPS * Math.hypot(...base.side)) {
    throw new RangeError('pose: base side must not be zero or parallel to forward');
  }
  let s = unit('pose', 'base side', side);
  let n = cross(f, s);
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new TypeError(`pose: segments must be a non-empty array, got ${Array.isArray(segments) ? '[]' : segments}`);
  }
  let start = root.slice();
  return segments.map((g, i) => {
    const at = `segment ${i}`;
    if (!g || typeof g !== 'object') throw new TypeError(`pose: ${at} must be { length, radius, bend, twist }, got ${g}`);
    const { length, bend = 0, twist = 0 } = g;
    if (!Number.isFinite(length) || length <= 0) throw new RangeError(`pose: ${at} length must be a finite number above 0, got ${length}`);
    const radius = radii('pose', at, g.radius);
    if (!Number.isFinite(bend)) throw new RangeError(`pose: ${at} bend must be a finite angle in radians, got ${bend}`);
    if (!Number.isFinite(twist)) throw new RangeError(`pose: ${at} twist must be a finite angle in radians, got ${twist}`);
    const ct = Math.cos(twist), st = Math.sin(twist);
    const s1 = comb(s, ct, n, st);
    const n1 = comb(n, ct, s, -st);
    const cb = Math.cos(bend), sb = Math.sin(bend);
    const f2 = comb(f, cb, n1, sb);
    n = comb(n1, cb, f, -sb);
    f = f2;
    s = s1;
    const end = comb(start, 1, f, length);
    const out = { start, end, forward: f, side: s, normal: n, length, radius };
    start = end.slice();
    return out;
  });
}

/**
 * Two segments of `lengths` [a, b] from `root` toward `target`. The middle
 * joint lies in the plane through the root spanned by the root-target line and
 * `bendDir`, on bendDir's side. A target out of reach is clamped to the nearest
 * reachable distance on the same line, and `reached` is false.
 */
function reach(root, target, lengths, bendDir) {
  finite3('reach', 'root', root);
  finite3('reach', 'target', target);
  finite3('reach', 'bendDir', bendDir);
  if (!Array.isArray(lengths) || lengths.length !== 2 || !lengths.every((x) => Number.isFinite(x) && x > 0)) {
    throw new RangeError(`reach: lengths must be [a, b], two finite numbers above 0, got ${Array.isArray(lengths) ? `[${lengths.join(', ')}]` : lengths}`);
  }
  const [a, b] = lengths;
  const d = comb(target, 1, root, -1);
  const D0 = Math.hypot(...d);
  if (D0 === 0) throw new RangeError('reach: target is at the root; give a target apart from it');
  const u = d.map((x) => x / D0);
  const D = Math.min(a + b, Math.max(Math.abs(a - b), D0));
  const w = comb(bendDir, 1, u, -dot(bendDir, u));
  if (Math.hypot(...w) <= EPS * Math.hypot(...bendDir)) {
    throw new RangeError('reach: bendDir must not be zero or parallel to the line from root to target');
  }
  const x = (a * a - b * b + D * D) / (2 * D);
  const h = Math.sqrt(Math.max(0, a * a - x * x));
  const joint = comb(comb(root, 1, u, x), 1, unit('reach', 'bendDir', w), h);
  return { joint, end: comb(root, 1, u, D), reached: D === D0 };
}

/**
 * Projects segments { start, end, radius: [r0, r1] } to the picture. `view` is
 * the direction the viewer looks; `up` is made perpendicular to it and points
 * up the picture. `focal` Infinity is orthographic; a finite focal scales the
 * whole picture about `centre` (default the world origin) by
 * focal / (focal + mean depth) (weak perspective), with the eye focal before
 * the centre along view. `centre` keeps its own picture point, and depth is
 * measured from it along view.
 *
 * `perspective: 'joint'` instead divides each start and end by its own depth,
 * focal / (focal + depth), so a part aimed at the eye widens at its near end
 * and narrows at its far one; every end must then sit in front of the eye.
 * Each segment's `scale` is its two ends' factors, [k, k] under the default
 * 'weak'; `sections` already carry them in `major`, and the caller multiplies
 * them into any other width drawn at that end. In joint mode a section's angle
 * and near side follow the picture segment, and its opening (minor over major)
 * stays the view's. With focal Infinity both modes are orthographic.
 */
function project(segments, { view = [0, 0, 1], up = [0, -1, 0], focal = Infinity, centre = [0, 0, 0], perspective = 'weak' } = {}) {
  finite3('project', 'view', view);
  finite3('project', 'up', up);
  finite3('project', 'centre', centre);
  const V = unit('project', 'view', view);
  const upIn = comb(up, 1, V, -dot(up, V));
  if (Math.hypot(...upIn) <= EPS * Math.hypot(...up)) throw new RangeError('project: up must not be zero or parallel to view');
  const R = cross(V, unit('project', 'up', upIn));
  const Dn = cross(V, R);
  if (focal !== Infinity && !(Number.isFinite(focal) && focal > 0)) {
    throw new RangeError(`project: focal must be Infinity or a finite number above 0, got ${focal}`);
  }
  if (perspective !== 'weak' && perspective !== 'joint') {
    throw new RangeError(`project: perspective must be 'weak' or 'joint', got ${JSON.stringify(perspective)}`);
  }
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new TypeError(`project: segments must be a non-empty array, got ${Array.isArray(segments) ? '[]' : segments}`);
  }
  const joint = perspective === 'joint' && focal !== Infinity;
  const cz = dot(centre, V), cx = dot(centre, R), cy = dot(centre, Dn);
  let zSum = 0;
  for (const [i, g] of segments.entries()) {
    if (!g || typeof g !== 'object') throw new TypeError(`project: segment ${i} must be { start, end, radius }, got ${g}`);
    finite3('project', `segment ${i} start`, g.start);
    finite3('project', `segment ${i} end`, g.end);
    radii('project', `segment ${i}`, g.radius);
    zSum += dot(g.start, V) + dot(g.end, V);
    for (const [which, p] of [['start', g.start], ['end', g.end]]) {
      const z = dot(p, V) - cz;
      if (joint && !(focal + z > 0)) {
        throw new RangeError(`project: focal + depth of segment ${i} ${which} must be above 0, got ${focal} + ${z}; move the segments in front of the eye`);
      }
    }
  }
  const zRef = zSum / (2 * segments.length) - cz;
  if (focal !== Infinity && !(focal + zRef > 0)) {
    throw new RangeError(`project: focal + mean depth must be above 0, got ${focal} + ${zRef}; move the segments in front of the eye`);
  }
  const k = focal === Infinity ? 1 : focal / (focal + zRef);
  const kAt = (p) => (joint ? focal / (focal + dot(p, V) - cz) : k);
  const picture = (p, kp) => [cx + kp * (dot(p, R) - cx), cy + kp * (dot(p, Dn) - cy)];
  return {
    scale: k,
    segments: segments.map((g, i) => {
      const e = comb(g.end, 1, g.start, -1);
      const len = Math.hypot(...e);
      if (len === 0) throw new RangeError(`project: segment ${i} has zero length; give it an end apart from its start`);
      const f = e.map((x) => x / len);
      const fz = dot(f, V), px = dot(f, R), py = dot(f, Dn);
      const flat = Math.hypot(px, py);
      const ka = kAt(g.start), kb = kAt(g.end);
      const a = picture(g.start, ka), b = picture(g.end, kb);
      // Per-joint division can turn the picture segment away from the projected
      // direction, so in joint mode the section lies across the picture segment.
      const d0 = b[0] - a[0], d1 = b[1] - a[1], dl = Math.hypot(d0, d1);
      const [qx, qy, ql] = joint && dl > 0 ? [d0, d1, dl] : [px, py, flat];
      // The section's major axis lies across the projected segment; atan2 into [0, PI).
      const a0 = Math.atan2(qx, -qy);
      const a1 = a0 < 0 ? a0 + Math.PI : a0;
      const angle = flat <= EPS || a1 >= Math.PI ? 0 : a1 || 0;
      // The rim point nearest the viewer sits along sign(fz) times the projected direction.
      const near = flat <= EPS || Math.abs(fz) <= EPS ? [0, 0] : [Math.sign(fz) * qx / ql, Math.sign(fz) * qy / ql];
      const section = (c, r, kp) => ({ centre: c.slice(), major: r * kp, minor: r * kp * Math.abs(fz), angle, near: near.slice() });
      return {
        a, b,
        depth: [dot(g.start, V) - cz, dot(g.end, V) - cz],
        foreshortening: flat,
        scale: [ka, kb],
        sections: [section(a, g.radius[0], ka), section(b, g.radius[1], kb)],
      };
    }),
  };
}

module.exports = { pose, reach, project };
