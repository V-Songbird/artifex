// Fields become paths: sample, differentiate, compose, then trace.
'use strict';

const { chain } = require('./geom.js');

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
 * following the field immediately. A zero vector stops the walk.
 */
function streamline(field, start, opt = {}) {
  finiteVector(start);
  const { steps = 100, step = 1, turn = 1, bounds } = opt;
  if (!Number.isSafeInteger(steps) || steps < 0) throw new RangeError('streamline: steps must be a nonnegative safe integer');
  if (!Number.isFinite(step) || step <= 0) throw new RangeError('streamline: step must be positive and finite');
  if (!Number.isFinite(turn) || turn < 0 || turn > 1) throw new RangeError('streamline: turn must be in [0, 1]');
  if (bounds !== undefined) fieldBounds(bounds);
  const outside = (x, y) => bounds !== undefined && (x < bounds[0] || x > bounds[2] || y < bounds[1] || y > bounds[3]);
  const angleAt = (x, y) => {
    const value = field(x, y);
    if (!Array.isArray(value)) return finiteScalar(value);
    const [dx, dy] = finiteVector(value);
    return dx === 0 && dy === 0 ? null : Math.atan2(dy, dx);
  };
  let [x, y] = start;
  if (steps === 0 || outside(x, y)) return [];
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
    heading += d * turn;
    x += Math.cos(heading) * step;
    y += Math.sin(heading) * step;
    finiteScalar(x); finiteScalar(y);
    if (outside(x, y)) break;
  }
  return pts;
}

/** One independent polyline per seed, in seed order, without joining them. */
function streamlines(field, seeds, opt = {}) {
  return seeds.map((start) => streamline(field, start, opt));
}

module.exports = { sampleGrid, gradient, curl, warp, threshold, isolines, streamline, streamlines };
