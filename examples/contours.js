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
// Field sampling and tracing share core/field.js with drift's flow paths.

'use strict';

const { rng, fbm } = require('../core/rand.js');
const { stroke, clipPolyline, boxOf } = require('../core/path.js');
const { sampleGrid, isolines } = require('../core/field.js');

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
    relief: { min: 0.2, max: 2.5, value: 1.15,
      meaning: 'how hard the field folds -- how far the noise lifts and drops the surface' },
    wells: { min: 1, max: 6, value: 4,
      meaning: 'how many wells push the surface up or down under the noise' },
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

      const f = sampleGrid((u, v) => {
        let h = fbm(R, u * 2.6, v * 2.6, 5, 'relief') * s.params.relief;
        for (const w of s.wells) {
          const d = Math.hypot(u - w.x, (v - w.y) * (H / W));
          h += w.sign * Math.exp(-(d * d) / (2 * w.r * w.r)) * 0.85;
        }
        return h;
      }, COLS, ROWS);
      s.field = f;
      let lo = Infinity;
      let hi = -Infinity;
      for (const v of f) { if (v < lo) lo = v; if (v > hi) hi = v; }
      s.range = [lo, hi];
    }],

    ['trace the isolines', (s) => {
      const [lo, hi] = s.range;
      const levels = [];
      for (let k = 1; k < LEVELS; k++) {
        const level = lo + (hi - lo) * (k / LEVELS);
        levels.push(level);
      }
      const lines = isolines(s.field, COLS, ROWS, levels);
      s.segments = lines.segments.length;
      const traced = lines.paths.map((pts) => pts.map(([gx, gy]) => [
        M + (gx / COLS) * (W - 2 * M),
        M + (gy / ROWS) * (H - 2 * M),
      ]));

      // CLIPPED, not faded. The field used to be forced down at the edges so
      // every contour closed inside the sheet -- which changes the data to fit
      // the frame, and is the mirror image of letting the frame do the
      // composition. A topographic plot clips at the sheet edge; the lines that
      // run off simply run off. A polyline that leaves and comes back returns
      // as two runs, because joining them would draw a stroke across the middle
      // of the picture that the piece never asked for, and a plotter would draw
      // it too.
      const box = boxOf({ w: W, h: H }, M);
      s.paths = traced.flatMap((pts) => clipPolyline(pts, box));
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

    for (const pts of s.paths) stroke(g, pts);
  },
};
