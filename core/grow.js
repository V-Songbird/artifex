// Two ways a picture grows from a rule: tone turned into dots that crowd
// where it is dark, and lines that branch towards what attracts them.
//
// Nothing here knows what kind of art a piece makes.
'use strict';

const { Delaunay } = require('./d3-delaunay.js');

function box(who, bounds) {
  if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite) || !(bounds[2] > bounds[0]) || !(bounds[3] > bounds[1])) {
    throw new RangeError(`${who}: bounds must be finite [x0, y0, x1, y1] with x1 > x0 and y1 > y0`);
  }
  return bounds;
}

/**
 * Tone as dots (Secord 2002, weighted Voronoi stippling): `n` points over
 * `bounds`, crowded where `tone(x, y)` is high and sparse where it is low,
 * evenly spaced among their neighbours. `tone` returns 0 to 1, how much ink
 * a place takes. The points start where `R` and the tone put them, then each
 * moves `rounds` times (default 30) to the weighted middle of the region
 * nearer to it than to any other. `opt.grid` (default 512) is how many
 * samples of the tone the longer side takes. Returns [[x, y], ...]: the same
 * dots for a canvas and an SVG.
 */
function stipple(R, tone, bounds, n, opt = {}) {
  const [x0, y0, x1, y1] = box('stipple', bounds), { rounds = 30, grid = 512, name = 'stipple' } = opt;
  if (typeof tone !== 'function') throw new TypeError('stipple: tone must be a function (x, y) returning 0 to 1');
  if (!Number.isInteger(n) || n < 1 || n > 200000) throw new RangeError(`stipple: n must be a whole number of dots from 1 to 200000, got ${n}`);
  if (!Number.isInteger(rounds) || rounds < 0 || rounds > 500) throw new RangeError(`stipple: rounds must be a whole number from 0 to 500, got ${rounds}`);
  if (!Number.isInteger(grid) || grid < 8 || grid > 2048) throw new RangeError(`stipple: grid must be a whole number of samples from 8 to 2048, got ${grid}`);
  const k = grid / Math.max(x1 - x0, y1 - y0), cols = Math.max(1, Math.round((x1 - x0) * k)), rows = Math.max(1, Math.round((y1 - y0) * k));
  const weight = new Float64Array(cols * rows);
  let most = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const w = tone(x0 + (i + 0.5) * (x1 - x0) / cols, y0 + (j + 0.5) * (y1 - y0) / rows);
      if (!Number.isFinite(w)) throw new TypeError('stipple: tone must return a finite number');
      weight[j * cols + i] = Math.max(0, w);
      most = Math.max(most, weight[j * cols + i]);
    }
  }
  if (most === 0) return [];
  // Start: tries by index, each kept with a chance of its place's tone.
  const points = [];
  for (let t = 0; points.length < n && t < n * 400; t++) {
    const u = R(name, 'x', t), v = R(name, 'y', t), w = weight[Math.min(rows - 1, Math.floor(v * rows)) * cols + Math.min(cols - 1, Math.floor(u * cols))];
    if (R(name, 'keep', t) * most < w) points.push([x0 + u * (x1 - x0), y0 + v * (y1 - y0)]);
  }
  if (points.length < 3) return points;
  const sx = new Float64Array(points.length), sy = new Float64Array(points.length), sw = new Float64Array(points.length);
  for (let round = 0; round < rounds; round++) {
    const near = Delaunay.from(points);
    sx.fill(0); sy.fill(0); sw.fill(0);
    let at = 0;
    for (let j = 0; j < rows; j++) {
      const y = y0 + (j + 0.5) * (y1 - y0) / rows;
      for (let i = 0; i < cols; i++) {
        const w = weight[j * cols + i];
        if (w === 0) continue;
        const x = x0 + (i + 0.5) * (x1 - x0) / cols;
        at = near.find(x, y, at);
        sx[at] += x * w; sy[at] += y * w; sw[at] += w;
      }
    }
    for (let p = 0; p < points.length; p++) if (sw[p] > 0) points[p] = [sx[p] / sw[p], sy[p] / sw[p]];
  }
  return points;
}

/**
 * Lines that branch towards what attracts them (Runions and others 2007,
 * space colonisation). `attractors` are [x, y] points the growth reaches
 * for; `roots` are the [x, y] points it starts from. Each round, every
 * attractor within `reach` of the growth pulls on its nearest tip; a pulled
 * tip grows a new point `step` away, towards the mean of its pulls; an
 * attractor nearer than `kill` to the growth is used up. It ends when no
 * attractor pulls, or after `rounds` (default 400). Returns
 * `{ points, parent, width }`: every point grown, the index of the one it
 * grew from (-1 for a root), and its width, which adds up from the tips
 * down as `(sum of children's width ** power) ** (1 / power)` from `tip`
 * (default 1) with `power` (default 2.2), so a stem is as thick as what it
 * carries. Where the attractors are decides the form: a cloud of them fills
 * as a crown, a line of them is followed.
 */
function colonise(attractors, roots, opt = {}) {
  const { step, reach = step * 6, kill = step * 2, rounds = 400, tip = 1, power = 2.2 } = opt;
  const list = (who, what, v) => { if (!Array.isArray(v) || !v.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) throw new TypeError(`colonise: ${what} must be a list of finite [x, y] points`); return v; };
  list('colonise', 'attractors', attractors);
  if (list('colonise', 'roots', roots).length === 0) throw new RangeError('colonise: needs at least one root');
  if (!(step > 0 && Number.isFinite(step))) throw new RangeError(`colonise: step must be a distance over 0, got ${step}`);
  if (!(reach > 0 && kill > 0 && Number.isFinite(reach + kill))) throw new RangeError('colonise: reach and kill must be distances over 0');
  if (!Number.isInteger(rounds) || rounds < 0 || rounds > 100000) throw new RangeError(`colonise: rounds must be a whole number from 0 to 100000, got ${rounds}`);
  if (!(tip > 0 && power > 0)) throw new RangeError('colonise: tip and power must be over 0');
  const points = roots.map((p) => [...p]), parent = roots.map(() => -1), alive = attractors.map(() => true);
  // The growth's points in cells `reach` wide, so an attractor looks only nearby.
  const cells = new Map(), key = (x, y) => `${Math.floor(x / reach)},${Math.floor(y / reach)}`;
  const put = (i) => { const k = key(points[i][0], points[i][1]); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(i); };
  points.forEach((_, i) => put(i));
  for (let round = 0; round < rounds; round++) {
    const pull = new Map();
    let any = false;
    attractors.forEach(([ax, ay], a) => {
      if (!alive[a]) return;
      let best = -1, far = reach * reach;
      const ci = Math.floor(ax / reach), cj = Math.floor(ay / reach);
      for (let j = cj - 1; j <= cj + 1; j++) {
        for (let i = ci - 1; i <= ci + 1; i++) {
          for (const p of cells.get(`${i},${j}`) || []) {
            const d = (points[p][0] - ax) ** 2 + (points[p][1] - ay) ** 2;
            if (d < far || (d === far && p < best)) { far = d; best = p; }
          }
        }
      }
      if (best < 0) return;
      if (far < kill * kill) { alive[a] = false; return; }
      const d = Math.sqrt(far), sum = pull.get(best) || [0, 0];
      sum[0] += (ax - points[best][0]) / d; sum[1] += (ay - points[best][1]) / d;
      pull.set(best, sum);
      any = true;
    });
    if (!any) break;
    let grew = false;
    for (const p of [...pull.keys()].sort((a, b) => a - b)) {
      const [dx, dy] = pull.get(p), len = Math.hypot(dx, dy);
      if (len < 1e-9) continue;
      const next = [points[p][0] + dx / len * step, points[p][1] + dy / len * step];
      // A point already grown from here the same way would only repeat it.
      if ((cells.get(key(next[0], next[1])) || []).some((q) => (points[q][0] - next[0]) ** 2 + (points[q][1] - next[1]) ** 2 < (step * 0.25) ** 2)) continue;
      points.push(next); parent.push(p); put(points.length - 1);
      grew = true;
    }
    if (!grew) break;
  }
  const carried = new Float64Array(points.length);
  for (let i = points.length - 1; i >= 0; i--) {
    if (carried[i] === 0) carried[i] = tip ** power;
    if (parent[i] >= 0) carried[parent[i]] += carried[i];
  }
  return { points, parent, width: Array.from(carried, (c) => c ** (1 / power)) };
}

module.exports = { stipple, colonise };
