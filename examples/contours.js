// contours -- plotter-native. One pen, one weight, no fills, no alpha, a still.
//
// IN THE SET BECAUSE IT BREAKS THE OTHERS' ASSUMPTIONS. Everything a screen
// gives away free is gone: there is no opacity to hide a seam behind, no fill to
// carry an area, no second weight to build hierarchy. The only variables left
// are where the line goes and how much of it there is. A library that is
// secretly about compositing fails here.
//
// It is also the piece that proves the fourth output is real work rather than a
// file extension. A pen plotter lifts between paths, and lifting is the slow,
// ugly part -- so the segments marching squares produces are CHAINED into long
// polylines before anything is drawn, and the piece publishes both counts so the
// ratio can be checked rather than assumed.
//
// Marching squares lives here, not in core/, for the same reason the stroke font
// does: one example reaches it. N4.

'use strict';

const { rng, fbm } = require('../core/rand.js');

const W = 1000;
const H = 700;
const M = 60;
const COLS = 150;          // field resolution, independent of the design box
const ROWS = 105;
const LEVELS = 22;

const PAPER = '#fbfaf6';
const PEN = '#1a3350';

module.exports = {
  name: 'contours',
  size: { w: W, h: H },
  outputs: ['raster', 'vector'],
  time: null,
  seed: 2026,
  params: {
    relief: { min: 0.2, max: 2.5, value: 1.15 },   // how hard the field folds
    wells: { min: 1, max: 6, value: 4 },
  },

  state: () => ({ paths: [], segments: 0 }),

  build: [
    ['sample the field', (s) => {
      const R = rng(s.seed);
      const wells = Math.round(s.params.wells);
      // Each well is its own address, so adding a fifth does not move the first
      // four. That is the whole argument for addressed randomness, and on this
      // piece you can see it: re-render with wells 3 and 4 and the shared ones
      // sit exactly where they were.
      s.wells = Array.from({ length: wells }, (_, i) => ({
        x: 0.12 + R('well', 'x', i) * 0.76,
        y: 0.14 + R('well', 'y', i) * 0.72,
        r: 0.10 + R('well', 'r', i) * 0.22,
        sign: R('well', 'sign', i) < 0.5 ? -1 : 1,
      }));

      const f = new Float64Array((COLS + 1) * (ROWS + 1));
      for (let j = 0; j <= ROWS; j++) {
        for (let i = 0; i <= COLS; i++) {
          const u = i / COLS;
          const v = j / ROWS;
          let h = fbm(R, u * 2.6, v * 2.6, 5, 'relief') * s.params.relief;
          for (const w of s.wells) {
            const d = Math.hypot(u - w.x, (v - w.y) * (H / W));
            h += w.sign * Math.exp(-(d * d) / (2 * w.r * w.r)) * 0.85;
          }
          // Fall away at the edges so contours close inside the sheet instead of
          // running off it. An open contour on a plotter is a line to nowhere.
          h -= Math.pow(Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2, 6) * 0.6;
          f[j * (COLS + 1) + i] = h;
        }
      }
      s.field = f;
      let lo = Infinity;
      let hi = -Infinity;
      for (const v of f) { if (v < lo) lo = v; if (v > hi) hi = v; }
      s.range = [lo, hi];
    }],

    ['trace the isolines', (s) => {
      const [lo, hi] = s.range;
      const segs = [];
      for (let k = 1; k < LEVELS; k++) {
        const level = lo + (hi - lo) * (k / LEVELS);
        marchingSquares(s.field, COLS, ROWS, level, segs);
      }
      s.segments = segs.length;
      s.paths = chain(segs).map((pts) => pts.map(([gx, gy]) => [
        M + (gx / COLS) * (W - 2 * M),
        M + (gy / ROWS) * (H - 2 * M),
      ]));
      s.penLifts = s.paths.length;
    }],
  ],

  draw(g, s) {
    g.fillStyle = PAPER;
    g.fillRect(0, 0, W, H);

    g.strokeStyle = PEN;
    g.lineWidth = 0.9;
    g.lineJoin = 'round';
    g.lineCap = 'round';

    for (const pts of s.paths) {
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.stroke();
    }
  },
};

/**
 * Marching squares. Appends segments in GRID coordinates to `out`.
 * Corner bits: tl=8, tr=4, br=2, bl=1. The two ambiguous cases are resolved by
 * the cell centre, not by a fixed choice -- a fixed choice puts a visible
 * diagonal bias across the whole sheet.
 */
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
  return out;
}

// `|| 0` collapses -0 onto 0. Without it, two identical points computed by
// different arithmetic -- one landing on -1e-17, the other on +1e-17 -- key as
// "-0.000000" and "0.000000" and stop matching. String(-0) is already "0", so
// an earlier guard elsewhere in this project was dead code and was deleted;
// toFixed is NOT the same and the lesson does not carry over. On a tessellation
// this exact hole cut sixteen strands dead in the middle of the sheet with
// nothing thrown. Here the grid never goes negative, so it has never fired --
// which is precisely why it needs a test rather than an argument.
const key = (p) => `${q6(p[0])},${q6(p[1])}`;

const q6 = (v) => (Math.round(v * 1e6) / 1e6 || 0).toFixed(6);

/**
 * Join segments end to end into polylines. Endpoints on a shared cell edge are
 * computed from the same two corner values by the same expression, so they are
 * bit-identical and can be matched exactly rather than within a tolerance.
 *
 * The fix is never a tolerance -- it is a key chosen by the data's own
 * structure.
 */
function chain(segs) {
  const ends = new Map();
  const used = new Array(segs.length).fill(false);
  for (let i = 0; i < segs.length; i++) {
    for (const p of segs[i]) {
      const k = key(p);
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push(i);
    }
  }

  const step = (k) => {
    for (const i of ends.get(k) || []) {
      if (used[i]) continue;
      const [a, b] = segs[i];
      if (key(a) === k) { used[i] = true; return b; }
      if (key(b) === k) { used[i] = true; return a; }
    }
    return null;
  };

  const paths = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const pts = [segs[i][0], segs[i][1]];
    for (let p = step(key(pts[pts.length - 1])); p; p = step(key(pts[pts.length - 1]))) {
      pts.push(p);
      if (key(p) === key(pts[0])) break;          // closed
    }
    for (let p = step(key(pts[0])); p; p = step(key(pts[0]))) {
      pts.unshift(p);
      if (key(p) === key(pts[pts.length - 1])) break;
    }
    paths.push(pts);
  }
  return paths;
}

