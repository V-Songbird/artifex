// A painting medium: a simulated sheet that water and paint act on over time.
//
// A wash, a glaze, a stroke of oil are not shapes. Each lands on a sheet that
// already holds something -- water standing on it or soaked into its fibres,
// pigment floating in that water or settled into the hollows, wet paint with a
// height and a mix of colours -- and each leaves the sheet changed for the
// next. `medium` keeps that sheet as a grid of cells and lets a piece act on it
// in order: wet it, wash it, stroke it, tilt it, let it dry, paint into it.
// The picture is what the sheet holds when the piece asks for it.
//
// TWO LAYERS SHARE ONE SHEET.
//
//   water  Shallow water inside a wet area, after Curtis, Anderson, Seims,
//          Fleischer and Salesin, "Computer-Generated Watercolor" (SIGGRAPH
//          1997): the water moves under its own pressure, the paper's slope
//          and the tilt; it leaves faster near the edge of the wet area, so it
//          carries pigment there and a dried wash keeps a darker rim; pigment
//          floats in it, settles into the paper's hollows (granulation) and
//          lifts again unless it stains; water soaked into the paper creeps
//          outward and widens a drying area, which is a bloom; what still
//          floats when a cell dries settles where it is.
//   paint  Body paint as a height and pigment volumes per cell, after Baxter,
//          Wendt and Lin, "IMPaSTo" (NPAR 2004): a wet top layer over a dry one,
//          so a stroke over dry paint lies on it and a stroke through wet paint
//          drags it along. A brush is a row of bristles, each holding its own
//          paint: each lays some down and picks some up, so its colour changes
//          as it goes and its grooves follow it.
//
// COLOUR IS PIGMENT. Each pigment has Kubelka-Munk absorption and scattering
// per linear RGB channel, made from the colour it shows at full strength and
// how opaque it is. Pigments in one cell mix by summing those coefficients, so
// yellow and blue make green and a thin layer filters what lies under it.
//
// Nothing here knows what a piece depicts. Paper, pigments and light are
// inputs. The sheet is raster by nature: `draw` puts its pixels on a raster
// surface, and a vector surface refuses it by name.
//
// EVERYTHING IS A FUNCTION OF THE SEED AND THE CALLS. No clock, no unseeded
// random. The same calls in the same order give the same sheet.
//
// SCALE. Water behaviour is set per cell: a bloom creeps a number of cells, so
// `cell` changes how far it reaches in design units. The grid does not follow
// the output scale; a frame drawn at any scale shows the same sheet.

'use strict';

const { rng } = require('./rand.js');
const { rgb, toLinear, toSRGB } = require('./colour.js');
const { sibling } = require('./layer.js');
const { closestPointOnSegment } = require('./geom.js');

// Water. Per step, in cells: DT time step, MU viscosity, DRAG velocity kept,
// ETA water lost at the wet edge per step, SLOPE how hard the paper's slope
// pushes, RELAX divergence passes.
const DT = 0.5, MU = 0.1, DRAG = 0.97, ETA = 0.006, SLOPE = 0.15, RELAX = 8;
// A wet brush into standing water floods out to this many times its radius.
const BLEED = 1.8;
// Under a tilt a bead lets a drop go where its water stands deeper than DRIP
// and deepest for BEAD cells either side.
// A lane that let a drop go waits REFILL steps, and so do BEAD lanes either side.
// A running drop spends RUN of its water and TRAIL of its pigment per cell.
const DRIP = 1.2, BEAD = 60, REFILL = 400, RUN = 0.3, TRAIL = 0.5;
// Capillary water: ALPHA taken from standing water per step, SOAK the least a
// cell must hold to pass water on, BLOOM the soak at which a dry cell joins the
// wet area, DAMP the soak below which paper counts as dry. The default
// evaporation of standing and soaked water per step.
const ALPHA = 0.006, SOAK = 0.25, BLOOM = 0.5, DAMP = 0.01, EVAPORATE = [0.0016, 0.0006];
// Pigment spreads through standing water at this rate, scaled by the water.
// While wet it also drifts down a potential: RIM towards the edge of the wet
// area, where evaporation draws the water and leaves a dark line, and GRAIN
// into the paper's hollows, scaled by the pigment's granulation.
const SPREAD = 1.9, RIM = 1.3, GRAIN = 0.8;
// A step visits square tiles of TILE cells that hold water and the tiles
// round them. EDGE is the radius of the blur the outward flow reads.
const TILE = 16, EDGE = 5;
// Paint and water pigments each have this many slots per sheet.
const SLOTS = 8;
// Wet paint under standing water moves at this share of the water's speed.
const THIN = 0.15;
// A dirty brush keeps this share of what each bristle held after its last stroke.
const DIRT = 0.25;
// The most cells one sheet may hold: 2^22, about 4 M, 4 x 1080p's quarter.
const MAX_CELLS = 2 ** 22;
// Bound temporary path samples and the work one simulation call requests.
const MAX_SAMPLES = 65536, MAX_STEPS = 20000;
// Operating ceiling for amplitudes stored in Float32 fields; defaults are near 1.
const MAX_CONTROL = 1e6;

function need(name, v, ok, what) {
  if (!(typeof v === 'number' && !Number.isNaN(v) && ok(v))) throw new RangeError(`medium: ${name} must be ${what}, got ${String(v)}`);
}
const finite = (v) => Number.isFinite(v);
const positive = (v) => Number.isFinite(v) && v > 0;
const unit = (v) => v >= 0 && v <= 1;
const amplitude = (v) => finite(v) && v >= 0 && v <= MAX_CONTROL;

/**
 * A pigment: the colour it shows at full strength over white, how opaque it
 * is (0 mostly filters, 1 scatters more; coverage also depends on thickness),
 * how much it settles into the paper's hollows (granulation, 0-1),
 * how strongly it resists remobilization and lifting (staining, 0-1),
 * and how fast it falls out of the water (density, 0-1).
 */
function pigment(colour, opt = {}) {
  const { opacity = 0.15, granulation = 0.3, staining = 0.5, density = 0.4 } = opt;
  need('opacity', opacity, unit, 'from 0 to 1');
  need('granulation', granulation, unit, 'from 0 to 1');
  need('staining', staining, unit, 'from 0 to 1');
  need('density', density, unit, 'from 0 to 1');
  const c = rgb(colour);
  const K = [], S = [];
  for (let i = 0; i < 3; i++) {
    const R = Math.min(0.985, Math.max(0.004, toLinear(c[i])));
    // Absorption that leaves R after light crosses one layer twice.
    const k = -Math.log(R) / 2;
    // The scattering at which an opaque layer reflects R by itself.
    K.push(k);
    S.push(opacity * k * 2 * R / ((1 - R) * (1 - R)) + 0.002);
  }
  return Object.freeze({ colour, K, S, granulation, staining, density });
}

/** Reflectance and transmittance of one layer of thickness x (Kubelka-Munk). */
function layerKM(K, S, x) {
  if (x <= 0 || K + S <= 0) return [0, 1];
  const bS = Math.sqrt(K * K + 2 * K * S);
  const q = bS * x;
  if (q > 30) return [S / (S + K + bS), 0];
  const sh = Math.sinh(q), ch = Math.cosh(q);
  const c = (S + K) * sh + bS * ch;
  return [S * sh / c, bS / c];
}

/**
 * A sheet `width` by `height` design units, `cell` design units to a cell.
 * `paper`: colour, grain (the size of its tooth in design units), tooth (how
 * deep it is, 0-1), weave (0-1, a canvas weave over the tooth), absorb (how
 * much water the fibres take, 0-1).
 */
function medium(opt = {}) {
  const { width, height, cell = 1, seed = 0, paper = {}, evaporate = 1, log = false } = opt;
  need('width', width, positive, 'a positive number');
  need('height', height, positive, 'a positive number');
  need('cell', cell, positive, 'a positive number');
  need('evaporate', evaporate, (v) => v >= 0 && finite(v), 'zero or more');
  const cols = Math.max(3, Math.ceil(width / cell)), rows = Math.max(3, Math.ceil(height / cell));
  const n = cols * rows;
  if (n > MAX_CELLS) throw new RangeError(`medium: ${cols} x ${rows} cells is more than ${MAX_CELLS}; use a larger cell`);
  const R = rng(seed);
  const P = { colour: '#f4efe4', grain: 6, tooth: 0.5, weave: 0, absorb: 0.5, ...paper };
  need('paper.grain', P.grain, positive, 'a positive number');
  const grainCells = P.grain / cell;
  if (!positive(grainCells) || !finite(2 * Math.max(cols, rows) / grainCells)) throw new RangeError('medium: paper.grain must leave finite paper coordinates in cells');
  need('paper.tooth', P.tooth, unit, 'from 0 to 1');
  need('paper.weave', P.weave, unit, 'from 0 to 1');
  need('paper.absorb', P.absorb, unit, 'from 0 to 1');

  const F = () => new Float32Array(n);
  const h = F(), cap = F();
  const M = new Uint8Array(n), u = F(), v = F(), p = F(), sat = F();
  const tu = F(), tv = F(), edge = F(), blur = F(), tmp = F(), fx = F(), fy = F();
  const tcols = Math.ceil(cols / TILE), trows = Math.ceil(rows / TILE);
  const marks = new Uint8Array(tcols * trows);
  let live = 0;                                 // tiles marked as holding water
  const water = [], g = [], d = [], held = [];  // water pigment slots; held: tiles where each floats
  const paints = [], wet = [], dry = [];        // paint pigment slots
  const Hw = F(), Hd = F();
  let tilt = [0, 0];
  const drops = [];                             // running drops under a tilt
  let dropCount = 0, steps = 0;
  const lanes = new Float64Array(Math.max(cols, rows)).fill(-Infinity); // step each lane last let a drop go
  const evap = [EVAPORATE[0] * evaporate, EVAPORATE[1] * evaporate];

  const LAT = 256, lat = new Float32Array(LAT * LAT);
  buildPaper();

  // ---- paper -------------------------------------------------------------

  // A lattice of seeded values, read smoothly: fast enough for millions of cells.
  function smooth(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), fx0 = x - xi, fy0 = y - yi;
    const a = (xi & 255) + (yi & 255) * LAT, b = ((xi + 1) & 255) + (yi & 255) * LAT;
    const c = (xi & 255) + ((yi + 1) & 255) * LAT, e = ((xi + 1) & 255) + ((yi + 1) & 255) * LAT;
    const s = fx0 * fx0 * (3 - 2 * fx0), t = fy0 * fy0 * (3 - 2 * fy0);
    return lat[a] + (lat[b] - lat[a]) * s + (lat[c] - lat[a]) * t + (lat[a] - lat[b] - lat[c] + lat[e]) * s * t;
  }

  function buildPaper() {
    const L = LAT, pts = new Float32Array(L * L * 2);
    for (let i = 0; i < L * L; i++) {
      lat[i] = R('medium', 'paper', i);
      pts[2 * i] = R('medium', 'felt-x', i);
      pts[2 * i + 1] = R('medium', 'felt-y', i);
    }
    // Rounded nodules of pressed felt: distance to the nearest seeded point.
    const felt = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      let best = 9;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const k = ((xi + i) & 255) + ((yi + j) & 255) * L;
        const dx = xi + i + pts[2 * k] - x, dy = yi + j + pts[2 * k + 1] - y;
        best = Math.min(best, dx * dx + dy * dy);
      }
      return Math.max(0, 1 - Math.sqrt(best) * 1.2);
    };
    const gr = grainCells;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const X = x / gr, Y = y / gr;
      const nod = felt(X, Y);
      const low = smooth(X * 0.31 + 50, Y * 0.31 + 50) * 0.6 + smooth(X * 0.73 + 90, Y * 0.73) * 0.4;
      const fine = smooth(x * 0.9 + 7, y * 0.9 + 3);
      let t = 0.3 * nod * nod * (3 - 2 * nod) + 0.4 * low + 0.3 * fine;
      if (P.weave > 0) {
        // Threads crossing over and under, two cells of tooth to a thread.
        const tx = x / (gr * 0.5), ty = y / (gr * 0.5);
        const over = ((Math.floor(tx) + Math.floor(ty)) & 1) === 0;
        const w = over ? 0.5 - 0.5 * Math.cos(2 * Math.PI * (ty - Math.floor(ty))) : 0.5 - 0.5 * Math.cos(2 * Math.PI * (tx - Math.floor(tx)));
        t = t * (1 - P.weave) + P.weave * (0.75 * w + 0.25 * fine);
      }
      const i = y * cols + x;
      h[i] = 0.5 + (t - 0.5) * (0.4 + 1.2 * P.tooth);
      cap[i] = (0.25 + 0.5 * h[i]) * (0.5 + P.absorb);
    }
  }

  // ---- geometry helpers --------------------------------------------------

  const toCell = (x) => x / cell - 0.5;
  const brushSize = (x) => positive(x) && x / cell > 0 && x / cell <= MAX_SAMPLES;

  function grow(x0, y0, x1, y1) {
    x0 = Math.max(1, Math.floor(x0)); y0 = Math.max(1, Math.floor(y0));
    x1 = Math.min(cols - 2, Math.ceil(x1)); y1 = Math.min(rows - 2, Math.ceil(y1));
    if (x0 > x1 || y0 > y1) return;
    for (let ty = Math.floor(y0 / TILE); ty <= Math.floor(y1 / TILE); ty++) {
      for (let tx = Math.floor(x0 / TILE); tx <= Math.floor(x1 / TILE); tx++) {
        if (!marks[ty * tcols + tx]) { marks[ty * tcols + tx] = 1; live++; }
      }
    }
  }

  function points(path, name) {
    if (!Array.isArray(path) || path.length < 1) throw new TypeError(`medium: ${name} must be an array of [x, y] or [x, y, pressure] points`);
    if (path.length > MAX_SAMPLES) throw new RangeError(`medium: ${name} must contain at most ${MAX_SAMPLES} points`);
    return Array.from(path, (q, k) => {
      if (!Array.isArray(q) || !finite(q[0]) || !finite(q[1])) throw new TypeError(`medium: ${name}[${k}] must be [x, y] or [x, y, pressure] with finite numbers`);
      const pr = q.length > 2 ? q[2] : 1;
      need(`${name}[${k}] pressure`, pr, unit, 'from 0 to 1');
      const x = toCell(q[0]), y = toCell(q[1]);
      if (!finite(x) || !finite(y)) throw new RangeError(`medium: ${name}[${k}] coordinates must remain finite in cells`);
      return [x, y, pr];
    });
  }

  // Positions every half cell along a path, each with its pressure and the
  // share of the path's length walked so far.
  function walk(raw) {
    const pts = raw.length > 2 ? curve(raw) : raw;
    const out = [];
    let total = 0;
    for (let k = 1; k < pts.length; k++) total += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
    if (!finite(total) || Math.ceil(total * 2) + 1 > MAX_SAMPLES) throw new RangeError(`medium: path needs more than ${MAX_SAMPLES} samples; split it into shorter paths`);
    if (pts.length === 1 || total === 0) return [[pts[0][0], pts[0][1], pts[0][2], 0, 1, 0.5]];
    // `next` carries over from one piece of the path to the next, so the
    // stamps stay half a cell apart through every joint.
    let run = 0, next = 0;
    for (let k = 1; k < pts.length; k++) {
      const [ax, ay, ap] = pts[k - 1], [bx, by, bp] = pts[k];
      const L = Math.hypot(bx - ax, by - ay);
      if (L === 0) continue;
      const dx = (bx - ax) / L, dy = (by - ay) / L;
      for (; next < run + L; next += 0.5) {
        const s = next - run, f = s / L;
        out.push([ax + dx * s, ay + dy * s, ap + (bp - ap) * f, dx, dy, next / total]);
      }
      run += L;
    }
    const [lx, ly, lp] = pts[pts.length - 1];
    const [, , , dx, dy] = out[out.length - 1];
    out.push([lx, ly, lp, dx, dy, 1]);
    return out;
  }

  // A Catmull-Rom curve through the points, so a brush turns instead of
  // jumping at a corner; pressure follows the same curve. A piece every cell
  // or so, since each joint turns every bristle at once and leaves a seam.
  function curve(pts) {
    const out = [];
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[Math.max(0, k - 1)], b = pts[k], c = pts[k + 1], e = pts[Math.min(pts.length - 1, k + 2)];
      const N = Math.max(8, Math.ceil(Math.hypot(c[0] - b[0], c[1] - b[1])));
      if (out.length + N + 1 > MAX_SAMPLES) throw new RangeError(`medium: path needs more than ${MAX_SAMPLES} curve samples; split it into shorter paths`);
      for (let s = 0; s < N; s++) {
        const t = s / N, t2 = t * t, t3 = t2 * t;
        out.push([0, 1, 2].map((q) => 0.5 * (2 * b[q] + (c[q] - a[q]) * t + (2 * a[q] - 5 * b[q] + 4 * c[q] - e[q]) * t2 + (3 * b[q] - a[q] - 3 * c[q] + e[q]) * t3)));
      }
    }
    out.push(pts[pts.length - 1]);
    return out.map(([x, y, q]) => [x, y, Math.min(1, Math.max(0, q))]);
  }

  function inside(poly, x, y) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }

  function slotsOf(list, gs, ds, pigments) {
    for (const pg of pigments) if (!pg || !Array.isArray(pg.K) || !Array.isArray(pg.S)) throw new TypeError('medium: a pigment must come from pigment(colour, options)');
    const added = [...new Set(pigments)].filter(pg => !list.includes(pg));
    if (list.length + added.length > SLOTS) throw new RangeError(`medium: one sheet holds at most ${SLOTS} pigments of a kind; reuse a pigment object or mix colours before`);
    for (const pg of added) {
      list.push(pg); gs.push(F()); ds.push(F());
      if (list === water) held.push(new Uint8Array(tcols * trows));
    }
    return pigments.map(pg => list.indexOf(pg));
  }

  // ---- water: what a piece calls -----------------------------------------

  /**
   * Clean water, or a pigment and water, inside a polygon. Its edge wanders
   * by up to `wander` design units. `feather` fades the initial deposit inward
   * from that edge; it does not constrain later water movement.
   */
  function wash(shape, o = {}) {
    const { water: w = 1, pigment: pg = null, amount = 1, wander = P.grain, feather = 0 } = o;
    need('wander', wander, (x) => x >= 0 && finite(x) && x / cell <= MAX_SAMPLES, `zero or more, spanning at most ${MAX_SAMPLES} cells`);
    need('feather', feather, (x) => finite(x) && x >= 0 && x / cell <= MAX_SAMPLES && (x === 0 || x / cell > 0), `zero or a positive width spanning at most ${MAX_SAMPLES} cells`);
    const jit = wander / cell, sc = 1 / Math.max(2, jit * 2);
    need('water', w, amplitude, `from 0 to ${MAX_CONTROL}`);
    need('amount', amount, amplitude, `from 0 to ${MAX_CONTROL}`);
    const poly = points(shape, 'shape');
    if (poly.length < 3) throw new TypeError('medium: shape must have at least 3 points');
    const fade = feather / cell, edges = fade > 0 ? poly.map(([x, y]) => [x, y]) : null;
    // Validate segment arithmetic before registering pigments or depositing water.
    if (edges) {
      try { for (let i = 0, j = edges.length - 1; i < edges.length; j = i++) closestPointOnSegment(edges[i], edges[i], edges[j]); }
      catch { throw new RangeError('medium: shape edges must have finite lengths in cells for feather'); }
    }
    const k = pg ? slotsOf(water, g, d, [pg])[0] : -1;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of poly) { x0 = Math.min(x0, x - jit); y0 = Math.min(y0, y - jit); x1 = Math.max(x1, x + jit); y1 = Math.max(y1, y + jit); }
    for (let y = Math.max(1, Math.floor(y0)); y <= Math.min(rows - 2, Math.ceil(y1)); y++) {
      for (let x = Math.max(1, Math.floor(x0)); x <= Math.min(cols - 2, Math.ceil(x1)); x++) {
        const wx = (smooth(x * sc + 31, y * sc + 17) - 0.5) * 2 * jit, wy = (smooth(x * sc + 113, y * sc + 71) - 0.5) * 2 * jit;
        if (!inside(poly, x + wx, y + wy)) continue;
        let coverage = 1;
        if (edges) {
          const at = [x + wx, y + wy];
          let distance = fade;
          for (let a = 0, b = edges.length - 1; a < edges.length; b = a++) {
            const p0 = edges[a], p1 = edges[b];
            if (at[0] < Math.min(p0[0], p1[0]) - distance || at[0] > Math.max(p0[0], p1[0]) + distance || at[1] < Math.min(p0[1], p1[1]) - distance || at[1] > Math.max(p0[1], p1[1]) + distance) continue;
            distance = Math.min(distance, closestPointOnSegment(at, p0, p1).distance);
          }
          const t = distance / fade;
          coverage = t * t * (3 - 2 * t);
          if (coverage === 0) continue;
        }
        const i = y * cols + x;
        if (w > 0) { M[i] = 1; p[i] += w * 0.5 * coverage; }
        if (k >= 0) { (w > 0 ? g[k] : d[k])[i] += amount * 0.3 * coverage; if (w > 0) hold(k, i); }
      }
    }
    grow(x0, y0, x1, y1);
  }

  /**
   * A round brush along a path: `width` in design units, `water` it carries
   * (below 0.3 it skips over the paper's hollows, a dry brush), `pigment` and
   * `amount` scales the local deposit; `length` is the distance in design
   * units at which the distance-based deposition multiplier halves. A third
   * number on a point is its pressure, which sets the width.
   */
  function stroke(path, o = {}) {
    const { width = 10, water: w = 1, pigment: pg = null, amount = 1, length = Infinity } = o;
    need('width', width, brushSize, `a positive number spanning at most ${MAX_SAMPLES} cells`);
    need('water', w, amplitude, `from 0 to ${MAX_CONTROL}`);
    need('amount', amount, amplitude, `from 0 to ${MAX_CONTROL}`);
    need('length', length, (x) => x > 0, 'a positive number or Infinity');
    const pts = walk(points(path, 'path'));
    if (log) note('stroke', path, width, { water: w, amount, brushLength: length });
    const half = length / cell;
    if (!(half > 0)) throw new RangeError('medium: length must remain positive in cells');
    const k = pg ? slotsOf(water, g, d, [pg])[0] : -1;
    const r0 = width / cell / 2;
    const wetBrush = w >= 0.3;
    // Which cells held water before this stroke, over the stroke's reach.
    let bx0 = cols, by0 = rows, bx1 = 0, by1 = 0;
    for (const [x, y] of pts) { bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); }
    const reach = r0 * BLEED + 1;
    bx0 = Math.max(0, Math.floor(bx0 - reach)); by0 = Math.max(0, Math.floor(by0 - reach));
    bx1 = Math.min(cols - 1, Math.ceil(bx1 + reach)); by1 = Math.min(rows - 1, Math.ceil(by1 + reach));
    const bw = bx1 - bx0 + 1, was = wetBrush && bx0 <= bx1 && by0 <= by1 ? new Uint8Array(bw * (by1 - by0 + 1)) : null;
    if (was) for (let y = by0; y <= by1; y++) was.set(M.subarray(y * cols + bx0, y * cols + bx1 + 1), (y - by0) * bw);
    let walked = 0;
    for (let s = 0; s < pts.length; s++) {
      const [cx, cy, pr] = pts[s];
      if (s) walked += Math.hypot(cx - pts[s - 1][0], cy - pts[s - 1][1]);
      const load = half === Infinity ? 1 : Math.pow(0.5, walked / half);
      const r = Math.max(0.6, r0 * (0.35 + 0.65 * pr)), rb = wetBrush ? r * BLEED : r;
      const each = 0.5 / Math.max(1, r);          // a stamp per half cell: share the load across the overlap
      for (let y = Math.max(1, Math.floor(cy - rb)); y <= Math.min(rows - 2, Math.ceil(cy + rb)); y++) {
        for (let x = Math.max(1, Math.floor(cx - rb)); x <= Math.min(cols - 2, Math.ceil(cx + rb)); x++) {
          const dd = Math.hypot(x - cx, y - cy);
          if (dd > rb) continue;
          const i = y * cols + x;
          if (dd > r) {
            // Into water already standing, the brush's flood runs on past
            // the bristles in the moment it lands, thinning as it goes.
            if (!was[(y - by0) * bw + x - bx0] || !(p[i] > 0)) continue;
            const t = 1 - (dd - r) / (rb - r);
            p[i] += w * 0.25 * each * t;
            if (k >= 0) { g[k][i] += amount * 0.6 * each * load * 0.5 * t * t; hold(k, i); }
            continue;
          }
          const fall = 1 - dd / r;
          if (w >= 0.3) {
            // Water on dried paper takes back some of what settled there,
            // less of a staining pigment; the rim drift then makes a bloom.
            if (!M[i]) {
              for (let q = 0; q < water.length; q++) {
                const loose = d[q][i] * 0.4 * (1 - water[q].staining) * Math.min(1, w);
                if (loose > 0) { d[q][i] -= loose; g[q][i] += loose; hold(q, i); }
              }
            }
            M[i] = 1;
            // A loaded brush adds water: into a wet area it raises the pressure,
            // and the water it brings carries its pigment outward.
            const add = w * 0.5 * (0.6 + 0.4 * fall);
            p[i] = M[i] && p[i] > 0 ? Math.max(p[i], add) + add * each : add;
            if (k >= 0) { g[k][i] += amount * 0.3 * each * (0.8 + 0.2 * fall) * load * 2; hold(k, i); }
          } else if (k >= 0) {
            // A dry brush touches only the tops of the tooth.
            const reach = 1 - w / 0.3;
            if (h[i] > 0.35 + 0.4 * reach * (1 - load)) d[k][i] += amount * 0.3 * each * load * 2;
          }
        }
      }
    }
    if (pts.length) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      if (wetBrush) grow(x0 - r0 * BLEED, y0 - r0 * BLEED, x1 + r0 * BLEED, y1 + r0 * BLEED);
    }
  }

  /** A clean damp brush that loosens settled pigment and soaks some of it up. */
  function lift(path, o = {}) {
    const { width = 10, strength = 0.6 } = o;
    need('width', width, brushSize, `a positive number spanning at most ${MAX_SAMPLES} cells`);
    need('strength', strength, unit, 'from 0 to 1');
    const pts = walk(points(path, 'path'));
    const r = width / cell / 2;
    const seen = new Uint8Array(n);
    for (const [cx, cy] of pts) {
      for (let y = Math.max(1, Math.floor(cy - r)); y <= Math.min(rows - 2, Math.ceil(cy + r)); y++) {
        for (let x = Math.max(1, Math.floor(cx - r)); x <= Math.min(cols - 2, Math.ceil(cx + r)); x++) {
          const i = y * cols + x;
          if (seen[i] || Math.hypot(x - cx, y - cy) > r) continue;
          seen[i] = 1;
          for (let k = 0; k < water.length; k++) {
            const loose = d[k][i] * strength * (1 - water[k].staining * 0.9);
            d[k][i] -= loose;
            g[k][i] += loose * 0.15;              // what the brush does not take floats
            if (loose > 0) hold(k, i);
          }
          M[i] = 1; p[i] = Math.max(p[i], 0.15);
        }
      }
      grow(cx - r, cy - r, cx + r, cy + r);
    }
    stroke(path, { width, water: 0.3 });
  }

  /** Tilt the sheet: water and what floats in it run toward [x, y]. */
  function tiltTo(x, y) {
    need('tilt x', x, (v) => finite(v) && Math.abs(v) <= MAX_CONTROL, `from -${MAX_CONTROL} to ${MAX_CONTROL}`);
    need('tilt y', y, (v) => finite(v) && Math.abs(v) <= MAX_CONTROL, `from -${MAX_CONTROL} to ${MAX_CONTROL}`);
    tilt = [x * 0.01, y * 0.01];
  }

  /** A breath of air at [x, y] toward [dx, dy], `radius` in design units. */
  function blow(at, dir, o = {}) {
    const { radius = 30, strength = 1 } = o;
    for (const [name, value] of [['at', at], ['dir', dir]]) {
      if (!(Array.isArray(value) || ArrayBuffer.isView(value)) || value.length !== 2 || !finite(value[0]) || !finite(value[1])) throw new TypeError(`medium: ${name} must contain two finite numbers`);
    }
    need('radius', radius, positive, 'a positive number');
    need('strength', strength, amplitude, `from 0 to ${MAX_CONTROL}`);
    const [cx, cy] = [toCell(at[0]), toCell(at[1])], r = radius / cell;
    const L = Math.hypot(dir[0], dir[1]) || 1;
    if (!(r > 0 && r <= MAX_SAMPLES) || ![cx, cy, r, L].every(finite)) throw new RangeError(`medium: blow coordinates and direction magnitude must remain finite in cells, with a positive radius of at most ${MAX_SAMPLES} cells`);
    for (let y = Math.max(1, Math.floor(cy - r)); y <= Math.min(rows - 2, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(1, Math.floor(cx - r)); x <= Math.min(cols - 2, Math.ceil(cx + r)); x++) {
        const i = y * cols + x, f = 1 - Math.hypot(x - cx, y - cy) / r;
        if (f <= 0 || !M[i]) continue;
        u[i] += dir[0] / L * strength * f; v[i] += dir[1] / L * strength * f;
      }
    }
  }

  // ---- water: the solver -------------------------------------------------

  function step(times = 1) {
    need('times', times, (x) => Number.isInteger(x) && x >= 0 && x <= MAX_STEPS, `an integer from 0 to ${MAX_STEPS}`);
    for (let s = 0; s < times; s++) {
      if (live || drops.length) waterStep(1);
      cureStep();
    }
  }

  // The rectangles a step visits: every tile holding water, standing or
  // soaked, and the tiles round it, joined into runs along each row of tiles.
  function regions(marks) {
    const out = [];
    for (let ty = 0; ty < trows; ty++) {
      let start = -1;
      for (let tx = 0; tx <= tcols; tx++) {
        let on = false;
        if (tx < tcols) {
          for (let j = -1; j <= 1 && !on; j++) for (let i = -1; i <= 1 && !on; i++) {
            const a = tx + i, b = ty + j;
            if (a >= 0 && b >= 0 && a < tcols && b < trows && marks[b * tcols + a]) on = true;
          }
        }
        if (on && start < 0) start = tx;
        if (!on && start >= 0) {
          out.push([Math.max(1, start * TILE), Math.max(1, ty * TILE), Math.min(cols - 2, tx * TILE - 1), Math.min(rows - 2, ty * TILE + TILE - 1)]);
          start = -1;
        }
      }
    }
    return out;
  }

  function waterStep(fast) {
    const C = cols, rects = regions(marks);
    const pigRects = held.map((m) => regions(m));
    // 1. Velocity: the water's own pressure, the paper's slope and the tilt.
    for (const [x0, y0, x1, y1] of rects) {
      for (let y = y0; y <= y1; y++) for (let x = x0, i = y * C + x0; x <= x1; x++, i++) {
        if (!M[i]) { tu[i] = tv[i] = 0; continue; }
        const px = (p[i + 1] - p[i - 1]) * 0.5, py = (p[i + C] - p[i - C]) * 0.5;
        const hx = (h[i + 1] - h[i - 1]) * 0.5, hy = (h[i + C] - h[i - C]) * 0.5;
        const lu = u[i + 1] + u[i - 1] + u[i + C] + u[i - C] - 4 * u[i];
        const lv = v[i + 1] + v[i - 1] + v[i + C] + v[i - C] - 4 * v[i];
        tu[i] = (u[i] + DT * (-px - SLOPE * hx + tilt[0] + MU * lu)) * DRAG;
        tv[i] = (v[i] + DT * (-py - SLOPE * hy + tilt[1] + MU * lv)) * DRAG;
      }
    }
    for (const [x0, y0, x1, y1] of rects) {
      for (let y = y0; y <= y1; y++) for (let x = x0, i = y * C + x0; x <= x1; x++, i++) { u[i] = tu[i]; v[i] = tv[i]; }
    }
    // 2. Relax the divergence inside the wet area.
    for (let it = 0; it < RELAX; it++) {
      for (const [x0, y0, x1, y1] of rects) {
        for (let y = y0; y <= y1; y++) for (let x = x0, i = y * C + x0; x <= x1; x++, i++) {
          if (!M[i]) continue;
          const q = 0.05 * (u[i + 1] - u[i - 1] + v[i + C] - v[i - C]);
          if (M[i + 1]) u[i + 1] -= q;
          if (M[i - 1]) u[i - 1] += q;
          if (M[i + C]) v[i + C] -= q;
          if (M[i - C]) v[i - C] += q;
        }
      }
    }
    // 3. Water leaves faster near the edge of the wet area.
    for (const [x0, y0, x1, y1] of rects) {
      for (let y = y0; y <= y1; y++) for (let x = x0, i = y * C + x0; x <= x1; x++, i++) {
        const m = Math.hypot(u[i], v[i]) * DT;
        if (m > 0.5) { u[i] *= 0.5 / m; v[i] *= 0.5 / m; }
      }
      edgeBlur(x0, y0, x1, y1);
      for (let y = y0; y <= y1; y++) for (let x = x0, i = y * C + x0; x <= x1; x++, i++) {
        if (M[i]) p[i] = Math.max(0, p[i] - ETA * (1 - edge[i]));
      }
    }
    // 4. Pigment rides the water, spreads through it and drifts to the edge
    // and into the hollows.
    for (let k = 0; k < water.length; k++) {
      carry(g[k], pigRects[k]);
      spread(g[k], pigRects[k]); spread(g[k], pigRects[k]);
      drift(g[k], pigRects[k], water[k].granulation);
    }
    carry(p, rects);
    // Wet paint under standing water thins and runs with it, slowly; dry
    // paint stays where it is.
    if (paints.length) {
      carry(Hw, rects, THIN);
      for (let k = 0; k < paints.length; k++) carry(wet[k], rects, THIN);
    }
    // 5. Pigment settles into the hollows and lifts off the peaks.
    for (let k = 0; k < water.length; k++) {
      const pg = water[k], G = g[k], D = d[k];
      const rho = 0.003 + 0.02 * pg.density, gamma = 0.35 * pg.granulation, omega = 0.4 + 4 * pg.staining;
      // Water can remobilize settled pigment even when none is floating yet.
      for (const [x0, y0, x1, y1] of rects) {
        for (let y = y0; y <= y1; y++) for (let x = x0, i = y * C + x0; x <= x1; x++, i++) {
          if (!M[i]) continue;
          const hh = h[i];
          const t = G[i] * (1 - hh * gamma) * rho - D[i] * (1 + (hh - 1) * gamma) * rho / omega;
          let gi = G[i] - t, di = D[i] + t;
          if (gi < 0) { di += gi; gi = 0; }
          if (di < 0) { gi += di; di = 0; }
          G[i] = gi; D[i] = di;
        }
      }
    }
    // 6. The paper soaks water up and passes it on; a soaked dry cell joins in.
    for (const [x0, y0, x1, y1] of rects) {
      for (let y = y0; y <= y1; y++) for (let x = x0, i = y * C + x0; x <= x1; x++, i++) {
        if (M[i] && p[i] > 0) { const a = Math.min(ALPHA, p[i], Math.max(0, cap[i] - sat[i])); sat[i] += a; p[i] -= a; }
        tmp[i] = sat[i];
      }
    }
    for (const [x0, y0, x1, y1] of rects) {
      for (let y = y0; y <= y1; y++) for (let x = x0, i = y * C + x0; x <= x1; x++, i++) {
        const s0 = sat[i];
        if (s0 < SOAK) continue;
        soak(i, i + 1, s0); soak(i, i - 1, s0); soak(i, i + C, s0); soak(i, i - C, s0);
      }
    }
    // 7. Evaporation, the edge spilling downhill under a tilt, and drying.
    marks.fill(0);
    live = 0;
    for (const m of held) m.fill(0);
    const run = tilt[0] !== 0 || tilt[1] !== 0;
    steps++;
    const across = Math.abs(tilt[0]) > Math.abs(tilt[1]);
    const down = across ? Math.sign(tilt[0]) : Math.sign(tilt[1]) * C, side = across ? C : 1;
    const ep = evap[0] * fast, es = evap[1] * fast;
    for (const [x0, y0, x1, y1] of rects) {
      for (let y = y0; y <= y1; y++) for (let x = x0, i = y * C + x0; x <= x1; x++, i++) {
        const soaked = tmp[i] - es;
        // Keep small absorption increments while standing water feeds them.
        sat[i] = soaked > 0 && (M[i] || soaked > DAMP) ? soaked : 0;
        if (!M[i] && sat[i] > BLOOM) {
          // Soaked damp paper floods: it holds water again and loosens what
          // had settled there, which the water pushes to its front, a bloom.
          M[i] = 1;
          const back = (sat[i] - BLOOM) * 0.5;
          p[i] += back; sat[i] -= back;
          for (let k = 0; k < water.length; k++) {
            const loose = d[k][i] * 0.5 * (1 - water[k].staining);
            d[k][i] -= loose; g[k][i] += loose;
            if (loose > 0) hold(k, i);
          }
        }
        // Under a tilt the water gathers into a bead along the low edge.
        // Where the bead is deepest for BEAD cells either side, it gathers
        // what the bead holds round it into one drop and lets it go; the
        // bead there is spent until the water refills it.
        if (run && M[i] && p[i] > DRIP + 0.3 * h[i] && !M[i + down]) {
          const lane = across ? Math.floor(i / C) : i % C;
          let top = true;
          for (let o = Math.max(0, lane - BEAD); o <= Math.min(lanes.length - 1, lane + BEAD) && top; o++) if (steps - lanes[o] < REFILL) top = false;
          for (let o = 1; o <= BEAD && top; o++) {
            const a = i - o * side, b = i + o * side;
            if ((a >= 0 && p[a] >= p[i]) || (b < n && p[b] > p[i])) top = false;
          }
          if (top) {
            const pig = new Float32Array(SLOTS);
            let vol = 0;
            for (let o = -BEAD; o <= BEAD; o++) {
              const j = i + o * side;
              if (j < 0 || j >= n || !M[j] || !(p[j] > 0.4)) continue;
              const t = (p[j] - 0.4) * 0.7 * (1 - Math.abs(o) / (BEAD + 1));
              for (let k = 0; k < water.length; k++) { const q = g[k][j] * t / p[j]; pig[k] += q; g[k][j] -= q; }
              p[j] -= t; vol += t;
            }
            lanes[lane] = steps;
            drops.push({ x: i % C, y: Math.floor(i / C), vol, pig, wander: 0, id: dropCount++, walked: 0, n: 0 });
          }
        }
        if (M[i]) {
          p[i] = Math.max(0, p[i] - ep);
          if (p[i] <= 1e-4) {
            M[i] = 0; u[i] = v[i] = 0;
            for (let k = 0; k < water.length; k++) { d[k][i] += g[k][i]; g[k][i] = 0; }
          }
        }
        if (M[i] || sat[i] > 0) mark(i);
        if (M[i]) for (let k = 0; k < water.length; k++) if (g[k][i] > 0) hold(k, i);
      }
    }
    if (drops.length) runDrops(run);
  }

  // Each drop runs downhill a cell or two per step, wandering a little,
  // wetting a trail as wide as it is full and leaving its pigment along it;
  // spent, or once the sheet lies flat, it settles as a bead where it stops.
  function runDrops(run) {
    const tl = Math.hypot(tilt[0], tilt[1]), tx = run ? tilt[0] / tl : 0, ty = run ? tilt[1] / tl : 0;
    for (let q = drops.length - 1; q >= 0; q--) {
      const dr = drops[q];
      const speed = run ? Math.min(2, (0.4 + dr.vol * 3) * Math.min(1, tl * 30)) : 0;
      for (dr.walked += speed; dr.walked >= 1 && dr.vol > 1; dr.walked--) {
        dr.wander = dr.wander * 0.8 + (R('medium', 'drop', dr.id * 4096 + (dr.n++ & 4095)) - 0.5) * 0.5;
        dr.x += tx - ty * dr.wander; dr.y += ty + tx * dr.wander;
        if (dr.x < 2 || dr.y < 2 || dr.x > cols - 3 || dr.y > rows - 3) { dr.vol = 0; break; }
        wetDisc(dr, 0.7 + Math.min(0.5, dr.vol * 0.1), TRAIL * RUN / dr.vol);
        dr.vol -= RUN;
      }
      if (!run || dr.vol <= 1) {
        if (dr.x >= 2 && dr.y >= 2 && dr.x <= cols - 3 && dr.y <= rows - 3) wetDisc(dr, 1.2 + Math.min(1, dr.vol), 1);
        drops.splice(q, 1);
      }
    }
  }

  function wetDisc(dr, r, share) {
    const cx = Math.round(dr.x), cy = Math.round(dr.y), ri = Math.ceil(r);
    let cells = 0;
    for (let y = -ri; y <= ri; y++) for (let x = -ri; x <= ri; x++) if (x * x + y * y <= r * r) cells++;
    for (let y = -ri; y <= ri; y++) for (let x = -ri; x <= ri; x++) {
      if (x * x + y * y > r * r) continue;
      if (cy + y < 1 || cy + y > rows - 2 || cx + x < 1 || cx + x > cols - 2) continue;
      const i = (cy + y) * cols + cx + x;
      M[i] = 1; p[i] = Math.max(p[i], 0.15 + Math.min(0.15, dr.vol * 0.05)); mark(i);
      for (let k = 0; k < water.length; k++) {
        const put = dr.pig[k] * share / cells;
        if (put > 0) { g[k][i] += put; hold(k, i); }
      }
    }
    for (let k = 0; k < water.length; k++) dr.pig[k] *= 1 - share;
  }

  function hold(k, i) { held[k][Math.floor((i % cols) / TILE) + Math.floor(Math.floor(i / cols) / TILE) * tcols] = 1; }

  function soak(i, j, s0) {
    const sj = sat[j];
    if (s0 <= sj) return;
    const f = Math.max(0, Math.min(s0 - sj, cap[j] - sj)) * 0.24;
    tmp[i] -= f; tmp[j] += f;
  }

  function mark(i) {
    const t = Math.floor((i % cols) / TILE) + Math.floor(Math.floor(i / cols) / TILE) * tcols;
    if (!marks[t]) { marks[t] = 1; live++; }
  }

  // Upwind fluxes across cell faces, only between wet cells, so what the water
  // carries piles up where it stops at the edge. Every face first, then every
  // cell, so the order of the rectangles changes nothing.
  function carry(q, rects, rate = 1) {
    const C = cols;
    for (const [x0, y0, x1, y1] of rects) {
      for (let y = y0; y <= y1; y++) for (let x = x0 - 1, i = y * C + x0 - 1; x <= x1; x++, i++) {
        const j = i + 1;
        if (!M[i] || !M[j]) { fx[i] = 0; continue; }
        const f = (u[i] + u[j]) * 0.5 * DT * rate;
        fx[i] = f > 0 ? f * q[i] : f * q[j];
      }
      for (let y = y0 - 1; y <= y1; y++) for (let x = x0, i = y * C + x0; x <= x1; x++, i++) {
        const j = i + C;
        if (!M[i] || !M[j]) { fy[i] = 0; continue; }
        const f = (v[i] + v[j]) * 0.5 * DT * rate;
        fy[i] = f > 0 ? f * q[i] : f * q[j];
      }
    }
    for (const [x0, y0, x1, y1] of rects) {
      for (let y = y0; y <= y1; y++) for (let x = x0, i = y * C + x0; x <= x1; x++, i++) {
        const next = q[i] + fx[i - 1] - fx[i] + fy[i - C] - fy[i];
        q[i] = next > 0 ? next : 0;
      }
    }
  }

  function spread(q, rects) {
    const C = cols, k = SPREAD * 0.125;
    for (const [x0, y0, x1, y1] of rects) {
      for (let y = y0; y <= y1; y++) for (let x = x0, i = y * C + x0; x <= x1; x++, i++) tmp[i] = q[i];
    }
    for (const [x0, y0, x1, y1] of rects) {
      for (let y = y0; y <= y1; y++) for (let x = x0, i = y * C + x0; x <= x1; x++, i++) {
        if (!M[i]) continue;
        let j = i + 1;
        if (M[j]) { const f = k * (q[i] - q[j]) * Math.min(1, (p[i] + p[j]) * 2); tmp[i] -= f; tmp[j] += f; }
        j = i + C;
        if (M[j]) { const f = k * (q[i] - q[j]) * Math.min(1, (p[i] + p[j]) * 2); tmp[i] -= f; tmp[j] += f; }
      }
    }
    for (const [x0, y0, x1, y1] of rects) {
      for (let y = y0; y <= y1; y++) for (let x = x0, i = y * C + x0; x <= x1; x++, i++) q[i] = tmp[i];
    }
  }

  // Moves pigment across each face between wet cells from the higher to the
  // lower of RIM * edge + GRAIN * granulation * h, in proportion to the
  // difference, the pigment and the water there.
  function drift(q, rects, gran) {
    const C = cols, gw = GRAIN * gran;
    for (const [x0, y0, x1, y1] of rects) {
      for (let y = y0; y <= y1; y++) for (let x = x0, i = y * C + x0; x <= x1; x++, i++) tmp[i] = q[i];
    }
    for (const [x0, y0, x1, y1] of rects) {
      for (let y = y0; y <= y1; y++) for (let x = x0, i = y * C + x0; x <= x1; x++, i++) {
        if (!M[i]) continue;
        const a = RIM * edge[i] + gw * h[i];
        let j = i + 1;
        for (let s = 0; s < 2; s++, j = i + C) {
          if (!M[j]) continue;
          const e = a - RIM * edge[j] - gw * h[j];
          const from = e > 0 ? i : j, to = e > 0 ? j : i;
          const f = Math.min(0.2, Math.abs(e)) * q[from] * Math.min(1, p[from] * 4);
          tmp[from] -= f; tmp[to] += f;
        }
      }
    }
    for (const [x0, y0, x1, y1] of rects) {
      for (let y = y0; y <= y1; y++) for (let x = x0, i = y * C + x0; x <= x1; x++, i++) q[i] = tmp[i];
    }
  }

  // A box blur of the wet mask, across then down, into `edge`.
  function edgeBlur(x0, y0, x1, y1) {
    const C = cols, r = EDGE, w = 2 * r + 1;
    const at = (x, y) => M[Math.min(rows - 1, Math.max(0, y)) * C + Math.min(cols - 1, Math.max(0, x))];
    for (let y = y0 - r; y <= y1 + r; y++) {
      if (y < 0 || y >= rows) continue;
      let s = 0;
      for (let x = x0 - r; x <= x0 + r; x++) s += at(x, y);
      for (let x = x0; x <= x1; x++) { blur[y * C + x] = s / w; s += at(x + r + 1, y) - at(x - r, y); }
    }
    const tat = (x, y) => blur[Math.min(rows - 1, Math.max(0, y)) * C + x];
    for (let x = x0; x <= x1; x++) {
      let s = 0;
      for (let y = y0 - r; y <= y0 + r; y++) s += tat(x, y);
      for (let y = y0; y <= y1; y++) { edge[y * C + x] = s / w; s += tat(x, y + r + 1) - tat(x, y - r); }
    }
  }

  /**
   * Let the water go: steps at `speed` times the evaporation until nothing
   * stands or soaks, then settles what still floats.
   */
  function dryAll(speed = 4) {
    need('speed', speed, (x) => x >= 1 && finite(x), '1 or more');
    for (let s = 0; s < MAX_STEPS && live; s++) waterStep(speed);
    // Finish pending beads before clearing the water they deposit.
    if (drops.length) runDrops(false);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < water.length; k++) { d[k][i] += g[k][i]; g[k][i] = 0; }
      M[i] = 0; p[i] = sat[i] = u[i] = v[i] = 0;
    }
    marks.fill(0);
    for (const m of held) m.fill(0);
    live = 0;
  }

  // ---- paint -------------------------------------------------------------

  let cureRate = 0;
  let leftOn = null;                           // what the last brush still held, bristle by bristle

  /**
   * Body paint along a path. `colour` is a pigment or [[pigment, share], ...];
   * `width` in design units; `load` how much paint the brush holds; `oil`
   * how fluid it is (0 stiff and short, 1 flowing and smudgy); `pick` how much
   * wet paint the bristles take up from the sheet; `bristles` their number;
   * `length` in design units after which a bristle has laid about half its
   * paint (by default the oil sets it); `multicolour` loads each pigment of
   * the mix on its own band of bristles, side by side across the brush, so
   * the stroke starts in streaks that blend as the bristles pick paint up;
   * `dirty` keeps what the last brush still held on its bristles under the
   * new load; `carve` the share of bristles (0-1) that push wet paint aside
   * into ridges instead of laying it; `variation` (0-1) how much groups of
   * neighbouring bristles differ in how hard they press.
   * A third number on a point is the pressure: it sets the width and how much
   * is laid down.
   */
  function paint(path, o = {}) {
    const { colour, width = 20, load = 1, oil = 0.5, pick = 0.5, bristles = 0, length = 0, multicolour = false, dirty = false, carve = 0, variation = 0 } = o;
    need('width', width, brushSize, `a positive number spanning at most ${MAX_SAMPLES} cells`);
    need('load', load, amplitude, `from 0 to ${MAX_CONTROL}`);
    need('oil', oil, unit, 'from 0 to 1');
    need('pick', pick, unit, 'from 0 to 1');
    need('length', length, (x) => x >= 0, 'zero (the oil sets it), a positive number or Infinity');
    const lay = length > 0 ? Math.LN2 / (length / cell) / (Math.PI * 2 / 3) : 0.002 * (0.5 + oil), take = 0.06 * pick;
    need('paint release rate', lay, (x) => x >= 0 && finite(x), 'a finite nonnegative number; increase length');
    need('carve', carve, unit, 'from 0 to 1');
    need('variation', variation, unit, 'from 0 to 1');
    need('bristles', bristles, (x) => Number.isInteger(x) && x >= 0 && x <= 96, 'an integer from 0 to 96 (0 selects automatically)');
    const mix = Array.isArray(colour) ? colour : [[colour, 1]];
    if (!mix.length || mix.some(row => !Array.isArray(row) || row.length !== 2)) throw new TypeError('medium: colour must be a pigment or [[pigment, share], ...]');
    const shares = mix.map(([, s], k) => { need(`colour[${k}] share`, s, (x) => x >= 0 && finite(x), 'zero or more'); return s; });
    const sum = shares.reduce((a, b) => a + b, 0);
    need('colour share total', sum, positive, 'a finite positive number');
    const pts = walk(points(path, 'path'));
    if (log) note('paint', path, width, { load, oil, pick, carve, variation, brushLength: length });
    const ks = slotsOf(paints, wet, dry, mix.map(([pg]) => pg));
    const W = width / cell;
    const B = bristles > 0 ? Math.round(bristles) : Math.max(8, Math.min(96, Math.round(W * 1.6)));
    const NP = SLOTS;
    // Each bristle: its offset across the brush, its radius and its paint.
    const hair = [];
    for (let b = 0; b < B; b++) {
      const off = (B === 1 ? 0 : b / (B - 1) - 0.5) + (R('medium', 'bristle-off', b) - 0.5) * 0.6 / B;
      const vol = new Float32Array(NP);
      const amt = load * W * 11 * (0.55 + 0.9 * R('medium', 'bristle-load', b)) / B;
      if (multicolour) {
        // The band this bristle sits in, by its place across the brush; a
        // bristle near a band's edge already holds some of the next colour.
        let at = (b + 0.5) / B * sum, m = 0;
        while (m < ks.length - 1 && at > shares[m]) at -= shares[m++];
        const near = Math.min(at, shares[m] - at) / sum * B;        // bristles to the band's edge
        const side = at < shares[m] / 2 ? m - 1 : m + 1;
        const blend = side >= 0 && side < ks.length ? 0.5 * Math.max(0, 1 - near / 2) : 0;
        vol[ks[m]] += amt * (1 - blend);
        if (blend) vol[ks[side]] += amt * blend;
      } else ks.forEach((k, m) => { vol[k] += amt * (shares[m] / sum); });
      // A dirty brush still holds some of what the bristle at its place held last time.
      if (dirty && leftOn) { const was = leftOn[Math.min(leftOn.length - 1, Math.floor((b + 0.5) / B * leftOn.length))]; for (let k = 0; k < NP; k++) vol[k] += was[k] * DIRT; }
      // Groups of neighbouring bristles press alike: a smooth seeded value along the brush.
      const press = Math.max(0.1, 1 + variation * 3 * (smooth(b * 6 / B + 3.5, 211.5) - 0.5));
      hair.push({
        carves: R('medium', 'bristle-carve', b) < carve, press,
        off, r: Math.max(0.55, W / B * 1.25 * (0.75 + 0.5 * R('medium', 'bristle-r', b))), vol, full: amt,
        from: R('medium', 'bristle-down', b) * 0.06, to: 1 - R('medium', 'bristle-up', b) * 0.14,
      });
    }
    // A stamp lays about lay * pi/3 of what a bristle holds, two stamps a cell.
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [px, py, pr, dx, dy, along] of pts) {
      const nx = -dy, ny = dx, span = W * (0.45 + 0.55 * pr);
      for (const br of hair) {
        if (along < br.from || along > br.to) continue;
        const cx = px + nx * br.off * span, cy = py + ny * br.off * span, r = br.r * (0.6 + 0.4 * pr);
        if (br.carves) push(br, cx, cy, r, nx, ny, pr);
        let held = 0;
        for (let k = 0; k < NP; k++) held += br.vol[k];
        for (let y = Math.max(1, Math.floor(cy - r)); y <= Math.min(rows - 2, Math.ceil(cy + r)); y++) {
          for (let x = Math.max(1, Math.floor(cx - r)); x <= Math.min(cols - 2, Math.ceil(cx + r)); x++) {
            const dd = Math.hypot(x - cx, y - cy);
            if (dd > r) continue;
            const i = y * cols + x, f = Math.min(1, (1 - dd / r) * (0.4 + 0.6 * pr) * br.press);
            // Pick up: wet paint under the bristle comes onto it.
            if (Hw[i] > 1e-6) {
              const up = Hw[i] * take * f;
              for (let k = 0; k < paints.length; k++) { const q = wet[k][i] / Hw[i] * up; wet[k][i] -= q; br.vol[k] += q; }
              Hw[i] -= up; held += up;
            }
            // Lay down: a share of what the bristle holds; a nearly empty one
            // touches only the tops of the canvas and the paint under it.
            if (held > 1e-6) {
              const top = h[i] + (Hw[i] + Hd[i]) * 2;
              const reach = Math.min(1, held / (br.full * 0.25 + 1e-9));
              if (top < 0.75 - 0.6 * reach) continue;
              const t = held * Math.min(1, lay * f / (r * r) * (br.carves ? 0.3 : 1));
              for (let k = 0; k < paints.length; k++) { const q = br.vol[k] / held * t; br.vol[k] -= q; wet[k][i] += q; }
              Hw[i] += t; held -= t;
            }
          }
        }
        const e = br.carves ? r + 2 : r;
        x0 = Math.min(x0, cx - e); y0 = Math.min(y0, cy - e); x1 = Math.max(x1, cx + e); y1 = Math.max(y1, cy + e);
      }
    }
    leftOn = hair.map((br) => br.vol);
    if (x0 <= x1) level(Math.floor(x0) - 1, Math.floor(y0) - 1, Math.ceil(x1) + 1, Math.ceil(y1) + 1, oil);
  }

  // A carving bristle lays little: it pushes the wet paint under it out to
  // the side it is on, past its own edge, leaving a valley and a ridge.
  function push(br, cx, cy, r, nx, ny, pr) {
    for (let y = Math.max(1, Math.floor(cy - r)); y <= Math.min(rows - 2, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(1, Math.floor(cx - r)); x <= Math.min(cols - 2, Math.ceil(cx + r)); x++) {
        const dd = Math.hypot(x - cx, y - cy), i = y * cols + x;
        if (dd > r || !(Hw[i] > 1e-6)) continue;
        const across = (x - cx) * nx + (y - cy) * ny, sd = across >= 0 ? 1 : -1;
        const tx = Math.round(x + nx * sd * (r - Math.abs(across) + 1)), ty = Math.round(y + ny * sd * (r - Math.abs(across) + 1));
        if (tx < 1 || ty < 1 || tx > cols - 2 || ty > rows - 2) continue;
        const j = ty * cols + tx, out = Hw[i] * 0.35 * (1 - dd / r) * (0.4 + 0.6 * pr) * Math.min(1, br.press);
        for (let k = 0; k < paints.length; k++) { const q = wet[k][i] / Hw[i] * out; wet[k][i] -= q; wet[k][j] += q; }
        Hw[i] -= out; Hw[j] += out;
      }
    }
  }

  // Wet paint settles a little under its own weight, more when it is oily;
  // height and every pigment move together, so each cell keeps its mix.
  function level(x0, y0, x1, y1, oil) {
    x0 = Math.max(1, x0); y0 = Math.max(1, y0); x1 = Math.min(cols - 2, x1); y1 = Math.min(rows - 2, y1);
    const w = 0.04 + 0.12 * oil, C = cols;
    for (const A of [Hw, ...wet.slice(0, paints.length)]) {
      // The stencil reads one neighbor beyond the updated rectangle. Copy
      // that halo too: tmp may still hold another pigment or height field.
      for (let y = y0 - 1; y <= y1 + 1; y++) for (let x = x0 - 1, i = y * C + x0 - 1; x <= x1 + 1; x++, i++) tmp[i] = A[i];
      for (let y = y0; y <= y1; y++) for (let x = x0, i = y * C + x0; x <= x1; x++, i++) {
        A[i] = tmp[i] + w * (tmp[i + 1] + tmp[i - 1] + tmp[i + C] + tmp[i - C] - 4 * tmp[i]) * Math.min(1, Hw[i] * 20 + 0.2);
      }
    }
  }

  /** A palette knife: scrapes wet paint down to `level` and leaves ridges at its sides. */
  function knife(path, o = {}) {
    const { width = 20, level: floor = 0.05 } = o;
    need('width', width, positive, 'a positive number');
    need('level', floor, (x) => x >= 0 && finite(x), 'zero or more');
    const pts = walk(points(path, 'path'));
    const W = width / cell;
    if (pts.length * (Math.floor(W * 2) + 1) > MAX_SAMPLES) throw new RangeError(`medium: knife needs more than ${MAX_SAMPLES} samples; use a shorter path or narrower blade`);
    for (const [px, py, , dx, dy] of pts) {
      const nx = -dy, ny = dx;
      for (let o2 = -W / 2; o2 <= W / 2; o2 += 0.5) {
        const x = Math.round(px + nx * o2), y = Math.round(py + ny * o2);
        if (x < 2 || y < 2 || x > cols - 3 || y > rows - 3) continue;
        const i = y * cols + x, ex = Hw[i] - floor;
        if (ex <= 0) continue;
        const side = o2 >= 0 ? 1 : -1;
        const sx = Math.round(px + nx * (W / 2 + 1) * side), sy = Math.round(py + ny * (W / 2 + 1) * side);
        if (sx < 1 || sy < 1 || sx > cols - 2 || sy > rows - 2) continue;
        const j = sy * cols + sx;
        for (let k = 0; k < paints.length; k++) { const q = wet[k][i] / Hw[i] * ex; wet[k][i] -= q; wet[k][j] += q; }
        Hw[i] = floor; Hw[j] += ex;
      }
    }
  }

  /** Dry a share of the wet paint now; `rate` per step dries it as steps run. */
  function cure(share = 1, rate) {
    need('share', share, unit, 'from 0 to 1');
    if (rate !== undefined) { need('rate', rate, unit, 'from 0 to 1'); cureRate = rate; }
    if (share > 0) dryPaint(share);
  }

  function cureStep() { if (cureRate > 0) dryPaint(cureRate); }

  function dryPaint(share) {
    for (let i = 0; i < n; i++) {
      if (Hw[i] <= 0) continue;
      const t = Hw[i] * share;
      for (let k = 0; k < paints.length; k++) { const q = wet[k][i] * share; wet[k][i] -= q; dry[k][i] += q; }
      Hw[i] -= t; Hd[i] += t;
    }
  }

  // ---- picture -----------------------------------------------------------

  /**
   * The sheet as RGBA pixels, one per cell. `light` is the direction light
   * comes from, `relief` scales how tall paint looks, `gloss` its shine (0-1),
   * `shadows` how dark the shade strokes cast (0-1), `sheen` how much standing
   * water darkens and shines.
   */
  function render(o = {}) {
    const { light = [-0.5, -0.6, 0.62], relief = 1, gloss = 0.5, shadows = 0.7, sheen = 1, backdrop = null } = o;
    need('relief', relief, amplitude, `from 0 to ${MAX_CONTROL}`);
    need('gloss', gloss, unit, 'from 0 to 1');
    need('shadows', shadows, unit, 'from 0 to 1');
    need('sheen', sheen, unit, 'from 0 to 1');
    const direction = (Array.isArray(light) || ArrayBuffer.isView(light)) && light.length === 3
      ? [light[0], light[1], light[2]] : [];
    if (direction.length !== 3 || !direction.every(finite)) throw new TypeError('medium: light must contain three finite numbers [x, y, z]');
    const ll = Math.hypot(...direction);
    if (!(ll > 0) || !finite(ll)) throw new RangeError('medium: light must have a finite non-zero magnitude');
    let back = null;
    if (backdrop !== null) {
      if (!backdrop || typeof backdrop !== 'object') throw new TypeError('medium: backdrop must be an opaque RGBA image');
      if (backdrop.width !== cols || backdrop.height !== rows) throw new RangeError(`medium: backdrop dimensions must be ${cols} x ${rows} cells`);
      const data = backdrop.data;
      if (!(data instanceof Uint8Array || data instanceof Uint8ClampedArray)) throw new TypeError('medium: backdrop data must be Uint8Array or Uint8ClampedArray');
      if (data.length !== n * 4) throw new RangeError(`medium: backdrop data length must be ${n * 4}`);
      if (typeof SharedArrayBuffer !== 'undefined' && data.buffer instanceof SharedArrayBuffer) throw new TypeError('medium: backdrop data must use unshared memory');
      for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) throw new RangeError('medium: backdrop must be opaque (alpha 255)');
      back = data;
    }
    const L = [direction[0] / ll, direction[1] / ll, Math.max(0.05, direction[2] / ll)];
    const paperC = rgb(P.colour).slice(0, 3).map(toLinear);
    const out = new Uint8ClampedArray(n * 4);
    const z = F();
    const paintScale = 40 * relief, toothScale = 0.6 * (0.3 + P.tooth);
    for (let i = 0; i < n; i++) {
      const body = Hw[i] + Hd[i];
      z[i] = body * paintScale + (back ? 0 : h[i] * toothScale * Math.max(0, 1 - body * 12));
    }
    const flat = 0.35 + 0.75 * L[2];
    const Hx = L[0], Hy = L[1], Hz = L[2] + 1, Hl = Math.hypot(Hx, Hy, Hz);
    const lx = -L[0], ly = -L[1], rise = L[2] / Math.hypot(L[0], L[1]) || 1e9;
    const Kw = [0, 0, 0], Sw = [0, 0, 0];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const body = Hw[i] + Hd[i];
      const wetNow = M[i] ? Math.min(1, p[i] * 3) * sheen : 0;
      if (back) {
        let active = body > 1e-6 || wetNow !== 0;
        for (let k = 0; !active && k < water.length; k++) active = d[k][i] + g[k][i] > 0;
        if (!active) {
          for (let c = 0; c < 4; c++) out[i * 4 + c] = back[i * 4 + c];
          continue;
        }
      }
      const xm = x > 0 ? i - 1 : i, xp = x < cols - 1 ? i + 1 : i, ym = y > 0 ? i - cols : i, yp = y < rows - 1 ? i + cols : i;
      let nx = -(z[xp] - z[xm]) * 0.5, ny = -(z[yp] - z[ym]) * 0.5, nz = 1;
      const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
      const lam = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
      // Shade: march toward the light over the paint's height.
      let lit = 1;
      if (shadows > 0 && body > 0.002) {
        for (let s = 1; s <= 16; s++) {
          const qx = Math.round(x - lx * s * 1.5), qy = Math.round(y - ly * s * 1.5);
          if (qx < 0 || qy < 0 || qx >= cols || qy >= rows) break;
          const over = z[qy * cols + qx] - (z[i] + s * 1.5 * rise);
          if (over > 0) lit = Math.min(lit, 1 - Math.min(1, over * 0.6));
        }
        lit = 1 - shadows * (1 - lit);
      }
      const spec = body > 0.002 ? gloss * 0.6 * Math.pow(Math.max(0, (nx * Hx + ny * Hy + nz * Hz) / Hl), 8 + 72 * gloss) : 0;
      const shade = back && body <= 1e-6 ? 1 : (0.35 + 0.75 * lam * lit) / flat;
      for (let c = 0; c < 3; c++) {
        // A backdrop already contains its support and lighting. Compose the
        // upper pigments optically without painting a second paper over it.
        let Rr = back ? toLinear(back[i * 4 + c] / 255) : paperC[c] * (0.94 + 0.06 * h[i]);
        Kw[c] = 0; Sw[c] = 0;
        for (let k = 0; k < water.length; k++) {
          const a = d[k][i] + g[k][i];
          if (a > 0) { Kw[c] += a * water[k].K[c]; Sw[c] += a * water[k].S[c]; }
        }
        if (Kw[c] + Sw[c] > 0) {
          const [r, t] = layerKM(Kw[c] * 2.5, Sw[c] * 2.5, 1);
          Rr = r + t * t * Rr / (1 - r * Rr);
        }
        for (const [A, Hs] of [[dry, Hd], [wet, Hw]]) {
          if (Hs[i] <= 1e-6) continue;
          let K = 0, S = 0;
          for (let k = 0; k < paints.length; k++) { const a = A[k][i] / Hs[i]; K += a * paints[k].K[c]; S += a * paints[k].S[c]; }
          const [r, t] = layerKM(K, S, Hs[i] * 60);
          Rr = r + t * t * Rr / (1 - r * Rr);
        }
        Rr *= 1 - 0.12 * wetNow;
        const v = Rr * shade * (back || body > 0.002 ? 1 : 0.92 + 0.08 * shade) + spec * lit + wetNow * 0.03;
        out[i * 4 + c] = Math.round(toSRGB(Math.min(1, Math.max(0, v))) * 255);
      }
      out[i * 4 + 3] = 255;
    }
    return { width: cols, height: rows, data: out };
  }

  /**
   * Put the sheet on a raster surface at [x, y, w, h] in its current units,
   * the whole sheet by default. A vector surface refuses it by name.
   */
  function draw(g2, x = 0, y = 0, w = width, h2 = height, o = {}) {
    if (!g2.canvas || typeof g2.drawImage !== 'function') {
      if (g2.kind === 'vector') throw new Error('medium: a vector surface has no pixels, so it cannot show a sheet. Declare outputs: ["raster"], or draw the sheet under if (g.canvas)');
      return;
    }
    const img = render(o);
    const c = sibling(g2.canvas, img.width, img.height);
    if (!c) throw new Error('medium: this surface\'s canvas has no document and there is no OffscreenCanvas, so the sheet has no canvas to go on');
    const cg = c.getContext('2d');
    const data = cg.createImageData(img.width, img.height);
    data.data.set(img.data);
    cg.putImageData(data, 0, 0);
    g2.save();
    try {
      g2.imageSmoothingEnabled = true;
      g2.imageSmoothingQuality = 'high';
      g2.drawImage(c, x, y, w, h2);
    } finally {
      g2.restore();
    }
  }

  /** How many cells hold standing water now. */
  function wetCells() {
    let c = 0;
    for (let i = 0; i < n; i++) c += M[i];
    return c;
  }

  /**
   * How much of a pigment the sheet holds: floating, settled and in running
   * drops as watercolour, wet and dry as paint. 0 for a pigment never used.
   */
  function total(pg) {
    let t = 0;
    const k = water.indexOf(pg), j = paints.indexOf(pg);
    if (k >= 0) {
      for (let i = 0; i < n; i++) t += g[k][i] + d[k][i];
      for (const dr of drops) t += dr.pig[k];
    }
    if (j >= 0) for (let i = 0; i < n; i++) t += wet[j][i] + dry[j][i];
    return t;
  }

  // ---- stroke log --------------------------------------------------------

  // With `log`, each stroke and paint call is kept as numbers: its path's
  // length, direction and pressure, its width and its brush settings. Keeping
  // it never changes the sheet.
  const calls = [];
  function note(kind, path, w, settings) {
    let len = 0, lo = 1, hi = 0, sum = 0;
    for (let k = 0; k < path.length; k++) {
      const pr = path[k].length > 2 ? path[k][2] : 1;
      lo = Math.min(lo, pr); hi = Math.max(hi, pr); sum += pr;
      if (k) len += Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]);
    }
    const a = path[0], b = path[path.length - 1];
    const angle = len > 0 ? ((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI) % 180 + 180) % 180 : null;
    calls.push({ kind, length: len, angle, width: w, pressure: sum / path.length, pressureRange: hi - lo, ...settings });
  }

  /** The logged calls, oldest first: copies, so changing them changes nothing. */
  function strokes() { return calls.map(c => ({ ...c })); }

  // Bins that keep a jittered repeat of one mark in one or two bins: half
  // octaves for sizes and amounts, 15 degrees for direction, eighths for shares.
  const octave = (x) => x > 0 && finite(x) ? Math.floor(2 * Math.log2(x / cell)) : String(x);
  const eighth = (x) => Math.min(7, Math.floor(x * 8));
  const BINS = {
    length: octave, angle: (x) => Math.floor(x / 15), width: octave, pressure: eighth, pressureRange: eighth,
    water: octave, amount: octave, load: octave, brushLength: octave,
    oil: eighth, pick: eighth, carve: eighth, variation: eighth,
  };

  /**
   * How narrow each logged feature is: 0 when its values spread evenly over
   * as many bins as the calls allow (at most 12), 1 when every call shares
   * one bin, null with fewer than two calls carrying it. `short` is the share
   * of calls whose path is shorter than 1.5 of its width. Numbers only.
   */
  function monotony() {
    const narrowness = {};
    for (const [f, bin] of Object.entries(BINS)) {
      const vals = calls.map(c => c[f]).filter(v => v !== null && v !== undefined);
      if (vals.length < 2) { narrowness[f] = null; continue; }
      const count = new Map();
      for (const v of vals) { const k = bin(v); count.set(k, (count.get(k) || 0) + 1); }
      let H = 0;
      for (const c of count.values()) H -= (c / vals.length) * Math.log(c / vals.length);
      narrowness[f] = Math.round((1 - H / Math.log(Math.min(vals.length, 12))) * 100) / 100;
    }
    const known = Object.values(narrowness).filter(v => v !== null);
    return {
      calls: calls.length,
      stroke: calls.filter(c => c.kind === 'stroke').length,
      paint: calls.filter(c => c.kind === 'paint').length,
      narrowness,
      mean: known.length ? Math.round(known.reduce((s, v) => s + v, 0) / known.length * 100) / 100 : null,
      short: calls.length ? Math.round(calls.filter(c => c.length < 1.5 * c.width).length / calls.length * 100) / 100 : null,
    };
  }

  return Object.freeze({
    cols, rows, wash, stroke, lift, tilt: tiltTo, blow, step, dry: dryAll,
    paint, knife, cure, render, draw, wetCells, total, strokes, monotony,
  });
}

module.exports = { medium, pigment };
