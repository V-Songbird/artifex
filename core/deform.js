// A drawn shape bent by a few pins: the shape is meshed once, and each frame
// the mesh moves so that the pins sit where they are put and every small
// piece of the shape keeps its own form as nearly as it can, turning but not
// stretching (Sorkine & Alexa 2007, "As-rigid-as-possible surface modeling",
// in the plane). Frame-pure: the answer depends on the pins alone.
//
// Nothing here knows what kind of art a piece makes.
'use strict';

const { delaunay } = require('./mesh.js');
const { resample } = require('./geom.js');

function ring2(who, ring) {
  if (!Array.isArray(ring) || ring.length < 3 || !ring.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) {
    throw new TypeError(`${who}: takes a closed outline of at least 3 finite [x, y] points, the closing point not repeated`);
  }
}

function within(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/**
 * A mesh for a filled outline: its edge resampled every `spacing` units, and
 * points `spacing` apart inside it, joined into triangles. Returns
 * `{ points, triangles, outline }`: `outline` lists the indices of the edge
 * points in order, so the bent outline is `outline.map((i) => bent[i])`.
 * A smaller `spacing` bends more smoothly and costs more.
 */
function shapeMesh(outline, spacing) {
  ring2('shapeMesh', outline);
  if (!(spacing > 0 && Number.isFinite(spacing))) throw new RangeError(`shapeMesh: spacing must be a distance over 0, got ${spacing}`);
  const edge = resample(outline, spacing, true);
  if (edge.length > 1 && edge[0][0] === edge[edge.length - 1][0] && edge[0][1] === edge[edge.length - 1][1]) edge.pop();
  const xs = edge.map((p) => p[0]), ys = edge.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  if ((x1 - x0) * (y1 - y0) / (spacing * spacing) > 250000) throw new RangeError('shapeMesh: spacing is too small for this outline; it would lay over 250000 points');
  const points = edge.map((p) => [...p]), near = (spacing * 0.6) ** 2, row = spacing * Math.sqrt(3) / 2;
  // A triangular lattice inside the outline, kept clear of the edge points.
  for (let j = 0, y = y0 + row / 2; y < y1; y += row, j++) {
    for (let x = x0 + (j % 2 ? spacing : spacing / 2); x < x1; x += spacing) {
      if (within(edge, x, y) && !edge.some((p) => (p[0] - x) ** 2 + (p[1] - y) ** 2 < near)) points.push([x, y]);
    }
  }
  const triangles = delaunay(points).triangles.filter(([a, b, c]) => within(edge, (points[a][0] + points[b][0] + points[c][0]) / 3, (points[a][1] + points[b][1] + points[c][1]) / 3));
  return { points, triangles, outline: edge.map((_, i) => i) };
}

/**
 * Prepares a mesh for bending and returns `bend(pins, opt)`. `pins` is a list
 * of `[index, [x, y]]`: the mesh point `index` is put at [x, y]. `bend`
 * returns every point's new place, in the mesh's order. It starts from the
 * rest shape each time, so a frame depends on its own pins alone. `opt.rounds`
 * (default 8) is how many times the pieces are turned and the points moved;
 * more follows a large bend further. With no pin the rest shape comes back;
 * with one, it moves whole.
 */
function deformer(mesh) {
  if (!mesh || !Array.isArray(mesh.points) || !Array.isArray(mesh.triangles)) throw new TypeError('deformer: takes a mesh { points, triangles }, such as shapeMesh gives');
  const rest = mesh.points, n = rest.length, links = Array.from({ length: n }, () => new Set());
  for (const t of mesh.triangles) {
    if (!Array.isArray(t) || t.length !== 3 || !t.every((i) => Number.isInteger(i) && i >= 0 && i < n)) throw new TypeError('deformer: each triangle must be three indices into points');
    for (let k = 0; k < 3; k++) { links[t[k]].add(t[(k + 1) % 3]); links[t[(k + 1) % 3]].add(t[k]); }
  }
  const around = links.map((set) => [...set].sort((a, b) => a - b));

  return function bend(pins, opt = {}) {
    const { rounds = 8 } = opt;
    if (!(Number.isInteger(rounds) && rounds >= 1 && rounds <= 200)) throw new RangeError(`deformer: rounds must be a whole number from 1 to 200, got ${rounds}`);
    if (!Array.isArray(pins)) throw new TypeError('deformer: pins must be a list of [index, [x, y]]');
    const held = new Map();
    for (const pin of pins) {
      if (!Array.isArray(pin) || !Number.isInteger(pin[0]) || pin[0] < 0 || pin[0] >= n || !Array.isArray(pin[1]) || pin[1].length !== 2 || !pin[1].every(Number.isFinite)) {
        throw new TypeError('deformer: each pin must be [index, [x, y]] with an index into the mesh points');
      }
      held.set(pin[0], pin[1]);
    }
    const x = new Float64Array(n), y = new Float64Array(n), cos = new Float64Array(n).fill(1), sin = new Float64Array(n);
    // Start from the rest shape, moved whole by the pins' mean shift.
    let sx = 0, sy = 0;
    for (const [i, p] of held) { sx += p[0] - rest[i][0]; sy += p[1] - rest[i][1]; }
    if (held.size) { sx /= held.size; sy /= held.size; }
    for (let i = 0; i < n; i++) { x[i] = rest[i][0] + sx; y[i] = rest[i][1] + sy; }
    for (const [i, p] of held) { x[i] = p[0]; y[i] = p[1]; }
    if (held.size < 2) return Array.from({ length: n }, (_, i) => [x[i], y[i]]);

    for (let round = 0; round < rounds; round++) {
      // Each point's piece turns to fit where its neighbours now lie.
      for (let i = 0; i < n; i++) {
        let a = 0, b = 0;
        for (const j of around[i]) {
          const ex = rest[j][0] - rest[i][0], ey = rest[j][1] - rest[i][1], dx = x[j] - x[i], dy = y[j] - y[i];
          a += ex * dx + ey * dy; b += ex * dy - ey * dx;
        }
        const len = Math.hypot(a, b);
        cos[i] = len > 0 ? a / len : 1; sin[i] = len > 0 ? b / len : 0;
      }
      // Each free point moves to where its neighbours' turned pieces put it.
      for (let sweep = 0; sweep < 40; sweep++) {
        for (let i = 0; i < n; i++) {
          if (held.has(i) || around[i].length === 0) continue;
          let px = 0, py = 0;
          for (const j of around[i]) {
            const ex = rest[i][0] - rest[j][0], ey = rest[i][1] - rest[j][1], c = (cos[i] + cos[j]) / 2, s = (sin[i] + sin[j]) / 2;
            px += x[j] + c * ex - s * ey; py += y[j] + s * ex + c * ey;
          }
          x[i] = px / around[i].length; y[i] = py / around[i].length;
        }
      }
    }
    return Array.from({ length: n }, (_, i) => [x[i], y[i]]);
  };
}

/**
 * Ties places on a mesh's rest shape to the mesh, so marks laid there ride
 * the shape as it bends. `places` is a list of [x, y] on the rest shape.
 * Returns `ride(bent)`: for each place, in order, `{ x, y, turn, scale }`
 * on the bent mesh: where it now lies, how far its piece of the shape has
 * turned, in radians, and how much that piece has grown or shrunk. A place
 * outside every triangle rides the nearest one. A mark placed and turned by
 * these keeps its spot on the thing it paints from frame to frame, so a
 * painted film neither swims nor re-rolls.
 */
function riders(mesh, places) {
  if (!mesh || !Array.isArray(mesh.points) || !Array.isArray(mesh.triangles) || mesh.triangles.length === 0) throw new TypeError('riders: takes a mesh { points, triangles } with at least one triangle');
  if (!Array.isArray(places) || !places.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) throw new TypeError('riders: places must be a list of finite [x, y] points');
  const rest = mesh.points;
  const tied = places.map(([px, py]) => {
    let best = null;
    for (const [a, b, c] of mesh.triangles) {
      const A = rest[a], B = rest[b], C = rest[c], det = (B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1]);
      if (det === 0) continue;
      const v = ((px - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (py - A[1])) / det, w = ((B[0] - A[0]) * (py - A[1]) - (px - A[0]) * (B[1] - A[1])) / det, u = 1 - v - w;
      const out = Math.max(0, -u, -v, -w);
      if (!best || out < best.out) best = { a, b, c, u, v, w, out, det };
      if (out === 0) break;
    }
    if (!best) throw new RangeError('riders: the mesh has no triangle with an area');
    return best;
  });
  return function ride(bent) {
    if (!Array.isArray(bent) || bent.length !== rest.length) throw new TypeError('riders: ride takes the bent points of the same mesh, one for each of its points');
    return tied.map(({ a, b, c, u, v, w, det }) => {
      const A = bent[a], B = bent[b], C = bent[c], now = (B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1]);
      // The piece's turn is the mean turn of its three sides.
      let sin = 0, cos = 0;
      for (const [i, j] of [[a, b], [b, c], [c, a]]) {
        const ex = rest[j][0] - rest[i][0], ey = rest[j][1] - rest[i][1], dx = bent[j][0] - bent[i][0], dy = bent[j][1] - bent[i][1];
        cos += ex * dx + ey * dy; sin += ex * dy - ey * dx;
      }
      return { x: u * A[0] + v * B[0] + w * C[0], y: u * A[1] + v * B[1] + w * C[1], turn: Math.atan2(sin, cos), scale: Math.sqrt(Math.abs(now / det)) };
    });
  };
}

module.exports = { shapeMesh, deformer, riders };
