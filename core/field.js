// Fields become paths: sample, differentiate, compose, then trace.
'use strict';

const { chain, lengthOf } = require('./geom.js');

function gridSize(cols, rows) {
  if (!Number.isInteger(cols) || cols < 1 || !Number.isInteger(rows) || rows < 1
      || !Number.isSafeInteger((cols + 1) * (rows + 1))) {
    throw new RangeError('field: cols and rows must be positive integers with a safe grid size');
  }
}

function finiteScalar(value) {
  if (!Number.isFinite(value)) throw new TypeError('field: expected a finite scalar');
  return value;
}

function finiteVector(value) {
  if (!Array.isArray(value) || value.length !== 2 || !Number.isFinite(value[0]) || !Number.isFinite(value[1])) {
    throw new TypeError('field: expected a finite [x, y] vector');
  }
  return value;
}

function fieldBounds(bounds) {
  if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite)
      || !(bounds[2] > bounds[0]) || !(bounds[3] > bounds[1])
      || !Number.isFinite(bounds[2] - bounds[0]) || !Number.isFinite(bounds[3] - bounds[1])) {
    throw new RangeError('field: bounds must be finite [x0, y0, x1, y1] with positive extents');
  }
}

/**
 * Sample (cols + 1) * (rows + 1) vertices, including the bounds, in row order.
 * Scalar fields produce Float64Array; vector fields produce independent pairs.
 * A field must consistently return finite numbers or finite [x, y] arrays.
 */
function sampleGrid(field, cols, rows, bounds = [0, 0, 1, 1]) {
  gridSize(cols, rows);
  fieldBounds(bounds);
  const [x0, y0, x1, y1] = bounds;
  let values;
  let vector;
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const x = i === cols ? x1 : x0 + (i / cols) * (x1 - x0);
      const y = j === rows ? y1 : y0 + (j / rows) * (y1 - y0);
      const value = field(x, y);
      if (values === undefined) {
        vector = Array.isArray(value);
        values = vector ? new Array((cols + 1) * (rows + 1)) : new Float64Array((cols + 1) * (rows + 1));
      }
      values[j * (cols + 1) + i] = vector ? [...finiteVector(value)] : finiteScalar(value);
    }
  }
  return values;
}

/** Central differences of a scalar field, in the field's coordinate units. */
function gradient(field, epsilon = 1e-4) {
  if (!Number.isFinite(epsilon) || !Number.isFinite(2 * epsilon) || epsilon <= 0) throw new RangeError('gradient: epsilon must be positive and finite');
  return (x, y) => {
    finiteScalar(x); finiteScalar(y);
    if (x + epsilon === x || x - epsilon === x || y + epsilon === y || y - epsilon === y
        || ![x + epsilon, x - epsilon, y + epsilon, y - epsilon].every(Number.isFinite)) {
      throw new RangeError('gradient: epsilon is not representable at these coordinates');
    }
    return finiteVector([
      (finiteScalar(field(x + epsilon, y)) - finiteScalar(field(x - epsilon, y))) / (2 * epsilon),
      (finiteScalar(field(x, y + epsilon)) - finiteScalar(field(x, y - epsilon))) / (2 * epsilon),
    ]);
  };
}

/** A scalar potential becomes the 2D vector field [df/dy, -df/dx]. */
function curl(field, epsilon = 1e-4) {
  const grad = gradient(field, epsilon);
  return (x, y) => {
    const [dx, dy] = grad(x, y);
    return [dy, -dx];
  };
}

/** Displace the domain once, in coordinate units; scalar and vector fields work. */
function warp(field, displacement, amount = 1) {
  finiteScalar(amount);
  return (x, y) => {
    const [dx, dy] = finiteVector(displacement(x, y));
    return field(finiteScalar(x + dx * amount), finiteScalar(y + dy * amount));
  };
}

/** Binary scalar field, including equality on the high side. */
function threshold(field, level = 0.5) {
  finiteScalar(level);
  return (x, y) => finiteScalar(field(x, y)) >= level ? 1 : 0;
}

/**
 * Trace scalar samples at one level or an array of levels. Returns raw segments
 * and chained polylines in GRID coordinates; map to the drawing domain later.
 * Strict > classifies corners; ambiguous cells use their arithmetic centre.
 */
function isolines(values, cols, rows, levels) {
  gridSize(cols, rows);
  if (!values || values.length !== (cols + 1) * (rows + 1)) throw new RangeError('isolines: sample count must match the grid');
  for (const value of values) finiteScalar(value);
  const list = Array.isArray(levels) ? levels : [levels];
  const segments = [];
  for (const level of list) {
    finiteScalar(level);
    marchingSquares(values, cols, rows, level, segments);
  }
  return { segments, paths: chain(segments) };
}

function marchingSquares(f, cols, rows, level, out) {
  const at = (i, j) => f[j * (cols + 1) + i];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const tl = at(i, j);
      const tr = at(i + 1, j);
      const br = at(i + 1, j + 1);
      const bl = at(i, j + 1);
      let c = 0;
      if (tl > level) c |= 8;
      if (tr > level) c |= 4;
      if (br > level) c |= 2;
      if (bl > level) c |= 1;
      if (c === 0 || c === 15) continue;

      const T = [i + (level - tl) / (tr - tl), j];
      const R = [i + 1, j + (level - tr) / (br - tr)];
      const B = [i + (level - bl) / (br - bl), j + 1];
      const L = [i, j + (level - tl) / (bl - tl)];

      switch (c) {
        case 1: case 14: out.push([L, B]); break;
        case 2: case 13: out.push([B, R]); break;
        case 3: case 12: out.push([L, R]); break;
        case 4: case 11: out.push([T, R]); break;
        case 6: case 9: out.push([T, B]); break;
        case 7: case 8: out.push([L, T]); break;
        case 5:
          if ((tl + tr + br + bl) / 4 > level) { out.push([L, T]); out.push([B, R]); }
          else { out.push([T, R]); out.push([L, B]); }
          break;
        case 10:
          if ((tl + tr + br + bl) / 4 > level) { out.push([T, R]); out.push([L, B]); }
          else { out.push([L, T]); out.push([B, R]); }
          break;
        default: break;
      }
    }
  }
}

/**
 * Walk a direction field: a scalar angle in radians or a vector whose magnitude
 * is ignored. Record the current point before each step; never append a point
 * outside bounds. `turn` steers along the shortest angular difference, with 1
 * following the field immediately. A zero vector stops the walk. `axial: true`
 * reads the field as an orientation, where a vector and its opposite mean the
 * same line: the walk keeps the way it is heading and never turns back.
 */
function streamline(field, start, opt = {}) {
  return walk(field, start, opt, null);
}

// `free(x, y)` false refuses a start and ends the walk before that point.
function walk(field, start, opt, free) {
  finiteVector(start);
  const { steps = 100, step = 1, turn = 1, bounds, axial = false } = opt;
  if (!Number.isSafeInteger(steps) || steps < 0) throw new RangeError('streamline: steps must be a nonnegative safe integer');
  if (!Number.isFinite(step) || step <= 0) throw new RangeError('streamline: step must be positive and finite');
  if (!Number.isFinite(turn) || turn < 0 || turn > 1) throw new RangeError('streamline: turn must be in [0, 1]');
  if (typeof axial !== 'boolean') throw new TypeError('streamline: axial must be true or false');
  if (bounds !== undefined) fieldBounds(bounds);
  const outside = (x, y) => bounds !== undefined && (x < bounds[0] || x > bounds[2] || y < bounds[1] || y > bounds[3]);
  const angleAt = (x, y) => {
    const value = field(x, y);
    if (!Array.isArray(value)) return finiteScalar(value);
    const [dx, dy] = finiteVector(value);
    return dx === 0 && dy === 0 ? null : Math.atan2(dy, dx);
  };
  let [x, y] = start;
  if (steps === 0 || outside(x, y) || (free && !free(x, y))) return [];
  let heading = opt.heading === undefined ? angleAt(x, y) : finiteScalar(opt.heading);
  if (heading === null) return [[x, y]];
  const pts = [];
  for (let k = 0; k < steps; k++) {
    pts.push([x, y]);
    const target = angleAt(x, y);
    if (target === null) break;
    let d = (target - heading) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    if (axial) d -= Math.PI * Math.round(d / Math.PI);
    heading += d * turn;
    x += Math.cos(heading) * step;
    y += Math.sin(heading) * step;
    finiteScalar(x); finiteScalar(y);
    if (outside(x, y)) break;
    if (free && !free(x, y)) break;
  }
  return pts;
}

/**
 * One polyline per seed, in seed order, without joining them. With
 * `separation`, a seed starts only farther than it from every earlier kept
 * trace, and a trace ends before a point that would come closer; the points
 * sit in a bucket grid of that cell size. With `minLength`, a trace shorter
 * than it is dropped. A refused or dropped seed stays as an empty entry.
 */
function streamlines(field, seeds, opt = {}) {
  const { separation, minLength = 0 } = opt;
  if (separation === undefined && opt.minLength === undefined) return seeds.map((start) => streamline(field, start, opt));
  if (separation !== undefined && (!Number.isFinite(separation) || separation <= 0)) throw new RangeError('streamlines: separation must be positive and finite');
  if (!Number.isFinite(minLength) || minLength < 0) throw new RangeError('streamlines: minLength must be nonnegative and finite');
  const buckets = new Map();
  const cell = (v) => Math.floor(v / separation);
  const free = separation === undefined ? null : (x, y) => {
    const i = cell(x);
    const j = cell(y);
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        for (const [px, py] of buckets.get(`${i + di},${j + dj}`) || []) {
          if ((px - x) ** 2 + (py - y) ** 2 < separation * separation) return false;
        }
      }
    }
    return true;
  };
  return seeds.map((start) => {
    const pts = walk(field, start, opt, free);
    if (pts.length === 0 || lengthOf(pts) < minLength) return [];
    if (free) {
      for (const p of pts) {
        const key = `${cell(p[0])},${cell(p[1])}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(p);
      }
    }
    return pts;
  });
}

// The most cells of `separation` a call may lay over its bounds.
const MAX_CELLS = 2 ** 22;

/**
 * Lines along a direction field that fill `bounds`, evenly spaced and as long
 * as the space allows (Jobard & Lefer 1997). Each line is walked both ways
 * from its seed. A seed starts only `separation` away from every line laid
 * before it; a line ends only when it comes within `gap` (default half of
 * `separation`) of another line or of its own earlier part; and each line laid
 * offers seeds `separation` to its two sides, tried before any other seed, so
 * neighbours lie side by side. `seeds` are tried in order once no neighbour is
 * left: by default a lattice `separation` apart, nearest the middle first.
 * `step` (default a fifth of `separation`), `steps` each way (default 1000),
 * `axial` and `minLength` read as in `streamlines`. Returns the polylines in
 * the order laid.
 */
function evenStreamlines(field, bounds, opt = {}) {
  fieldBounds(bounds);
  const { separation, gap = separation / 2, step = separation / 5, steps = 1000, minLength = 0, axial = false } = opt;
  if (!Number.isFinite(separation) || separation <= 0) throw new RangeError('evenStreamlines: separation must be positive and finite');
  if (!Number.isFinite(gap) || gap <= 0 || gap > separation) throw new RangeError('evenStreamlines: gap must be positive and at most separation');
  if (!Number.isFinite(step) || step <= 0 || step > gap) throw new RangeError('evenStreamlines: step must be positive and at most gap');
  if (!Number.isFinite(minLength) || minLength < 0) throw new RangeError('evenStreamlines: minLength must be nonnegative and finite');
  const [x0, y0, x1, y1] = bounds;
  const cols = Math.ceil((x1 - x0) / separation), rows = Math.ceil((y1 - y0) / separation);
  if (!(cols * rows <= MAX_CELLS)) throw new RangeError(`evenStreamlines: bounds hold ${cols} x ${rows} cells of separation, over the ${MAX_CELLS} one call may lay; give a larger separation`);
  const first = opt.seeds === undefined ? lattice(bounds, cols, rows) : opt.seeds;
  if (!Array.isArray(first)) throw new TypeError('evenStreamlines: seeds must be a list of [x, y] points');

  // Every point laid, in cells `separation` wide: [x, y, line, index along it].
  const cells = Array.from({ length: cols * rows }, () => []);
  const column = (x) => Math.min(cols - 1, Math.max(0, Math.floor((x - x0) / separation)));
  const row = (y) => Math.min(rows - 1, Math.max(0, Math.floor((y - y0) / separation)));
  const inside = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  // A line's own points this near along it are its neighbours, not a line to keep away from.
  const own = Math.ceil(separation / step) + 2;
  let line = 0, index = 0, sign = 1, begun = false, touched = [];
  const clear = (x, y, reach) => {
    const i = column(x), j = row(y);
    for (let b = Math.max(0, j - 1); b <= Math.min(rows - 1, j + 1); b++) {
      for (let a = Math.max(0, i - 1); a <= Math.min(cols - 1, i + 1); a++) {
        for (const p of cells[b * cols + a]) {
          if (p[2] === line && Math.abs(p[3] - index) < own) continue;
          if ((p[0] - x) ** 2 + (p[1] - y) ** 2 < reach * reach) return false;
        }
      }
    }
    return true;
  };
  const lay = (x, y) => {
    const c = row(y) * cols + column(x);
    cells[c].push([x, y, line, index]);
    touched.push(c);
  };
  // The walk asks this of its start, already laid, then of each new point.
  const free = (x, y) => {
    if (!begun) return begun = true;
    index += sign;
    if (!clear(x, y, gap)) return false;
    lay(x, y);
    return true;
  };
  const back = (x, y) => {
    const value = field(x, y);
    return Array.isArray(value) ? [-finiteVector(value)[0], -value[1]] : finiteScalar(value) + Math.PI;
  };
  const half = (way, start, side) => {
    index = 0; sign = side; begun = false;
    return walk(way, start, { steps, step, bounds, axial }, free);
  };

  const lines = [], near = [];
  for (let n = 0, k = 0; n < near.length || k < first.length;) {
    const [sx, sy] = finiteVector(n < near.length ? near[n++] : first[k++]);
    line = lines.length + 1; index = 0; touched = [];
    if (!inside(sx, sy) || !clear(sx, sy, separation)) continue;
    lay(sx, sy);
    const forward = half(field, [sx, sy], 1), pts = [...half(back, [sx, sy], -1).slice(1).reverse(), ...forward];
    if (pts.length < 2 || lengthOf(pts) < minLength) {
      for (const c of touched) cells[c] = cells[c].filter((p) => p[2] !== line);
      continue;
    }
    lines.push(pts);
    const stride = Math.max(1, Math.round(separation / step / 2));
    for (let p = 0; p < pts.length; p += stride) {
      const a = pts[Math.max(0, p - 1)], b = pts[Math.min(pts.length - 1, p + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
      if (length === 0) continue;
      const ox = -dy / length * separation, oy = dx / length * separation;
      near.push([pts[p][0] + ox, pts[p][1] + oy], [pts[p][0] - ox, pts[p][1] - oy]);
    }
  }
  return lines;
}

/** The middles of a cols x rows lattice over `bounds`, nearest the middle of the bounds first. */
function lattice([x0, y0, x1, y1], cols, rows) {
  const points = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) points.push([x0 + (i + 0.5) * (x1 - x0) / cols, y0 + (j + 0.5) * (y1 - y0) / rows]);
  }
  const far = ([x, y]) => (x - (x0 + x1) / 2) ** 2 + (y - (y0 + y1) / 2) ** 2;
  return points.sort((a, b) => far(a) - far(b));
}

module.exports = { sampleGrid, gradient, curl, warp, threshold, isolines, streamline, streamlines, evenStreamlines };
