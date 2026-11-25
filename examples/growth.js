// growth -- a two-dimensional cellular automaton, solved whole in the build and
// played as a film.
//
// IN THE SET BECAUSE IT BREAKS THE OTHERS' ASSUMPTIONS. settle also evolves a
// state, but along forces a reader can follow; here every cell reads only its
// eight neighbours and a table of counts, and what the eye sees -- fronts that
// grow, meet, erode and leave rings behind -- is nowhere in the code. It is the
// companion of `automaton`, which prints a one-dimensional rule as a still: a
// piece is a still or a film, never both, so the two are two pieces.
//
// THE WHOLE HISTORY IS SOLVED IN THE BUILD. Every generation is stepped once,
// into a second buffer that is swapped with the first when it is whole, and kept.
// `draw` then looks up the generation its frame shows, so a scrub lands exactly
// where playback does. Stepping inside `draw` would make the frame depend on the
// frame drawn before it.
//
// THE RULE IS A LIFE-LIKE ONE, B/S. A dead cell with a count of live neighbours
// in B is born; a live cell with a count in S survives; every other cell is dead
// in the next generation. `rule` picks one of five from a table, an integer
// knob, because most of the 2^18 B/S pairs die out or fill the frame in a few
// generations. The edge is stated once: 'dead' counts every cell past the frame
// as dead, so the frame crops a world that is empty beyond it.
//
// COLOUR BY BIRTH, NOT BY STATE. A cell keeps the colour of the generation it
// was born in, and the colours step through bands as the film goes on, so a
// front leaves rings behind it the way a growing thing does, and what has
// settled holds still instead of flickering. The seeded patches carry rings
// too: a cell deep in its patch counts as born earlier, before the film. A cell
// that is born swells in over two generations; one that dies leaves a pale
// ghost that fades to a trace the ground keeps. Every cell sits a little off
// the lattice, so a front reads as grown rather than as stair-steps.

'use strict';

const { rng, fbm } = require('../core/rand.js');
const { pick } = require('../core/num.js');
const { mix, mixOklch } = require('../core/colour.js');
const { layer } = require('../core/layer.js');

const W = 1280;
const H = 720;
const C = 8;                         // cell pitch, design units
const COLS = W / C;                  // 160
const ROWS = H / C;                  // 90
const HZ = 24;
const SECONDS = 10;
const GENS = SECONDS * HZ + 1;       // one generation a frame, and one after the last
const EDGE = 'dead';
const GHOST = 16;                    // generations a dead cell's ghost takes to fade
const FLOOR = 0.22;                  // and how much of it stays, a memory in the ground
const BAND = 7;                      // generations per colour band
const PRE = 56;                     // the bands a seeded patch carries from before the film
const PATCH = 64;                    // feature size of the seeded patches, design units

// [name, born with these counts, survives with these counts]
const RULES = [
  ['B35678/S5678', [3, 5, 6, 7, 8], [5, 6, 7, 8]],
  ['B3/S45678', [3], [4, 5, 6, 7, 8]],
  ['B4678/S35678', [4, 6, 7, 8], [3, 5, 6, 7, 8]],
  ['B3/S23', [3], [2, 3]],
  ['B3/S012345678', [3], [0, 1, 2, 3, 4, 5, 6, 7, 8]],
];

// Stated as art direction: a ground, two colours the bands walk between, the
// band's dark and the ghost.
const PLATES = [
  { ground: '#f1ebe0', a: '#d8663a', b: '#2f6f8f', dark: '#23202a', ghost: '#d9cdb8' },
  { ground: '#12151b', a: '#f0c060', b: '#6a9fd0', dark: '#0c0e12', ghost: '#262c36' },
  { ground: '#eef1ec', a: '#c9a23a', b: '#7a3f6e', dark: '#1d2621', ghost: '#cdd6cc' },
];

module.exports = {
  name: 'growth',
  size: { w: W, h: H },
  outputs: ['raster', 'vector'],
  time: { duration: SECONDS, hz: HZ },
  seed: 5,
  params: {
    rule: { min: 0, max: RULES.length - 1, value: 1,
      meaning: 'which birth and survival rule the cells follow, from a table of five: each grows and erodes its own way' },
    cover: { min: 0.05, max: 0.4, value: 0.18,
      meaning: 'the share of the frame the seeded patches of the first generation take' },
  },

  state: () => ({ cols: COLS, rows: ROWS, gens: GENS, edge: EDGE, first: null, cells: null, mark: null }),

  build: [
    ['seed the first generation', (s) => {
      const R = rng(s.seed);
      s.plate = pick(PLATES, R('plate', 'pick'));
      s.first = new Uint8Array(COLS * ROWS);
      // Patches, not a noise field: a broad seeded field decides where the
      // first generation is dense, so fronts leave from islands of all sizes
      // and cross open ground to meet.
      // The threshold is the field's own quantile, so `cover` is the share of
      // the frame the patches take whatever the seed.
      const n = COLS * ROWS;
      const field = new Float64Array(n);
      for (let i = 0; i < n; i++) field[i] = fbm(R, (i % COLS) * C / PATCH, Math.floor(i / COLS) * C / PATCH, 3, 'patches');
      const sorted = Float64Array.from(field).sort();
      const cut = sorted[Math.floor((1 - s.params.cover) * (n - 1))];
      const top = sorted[n - 1];
      // How long a seeded cell has been there before the film: deepest in the
      // heart of its patch, so a patch carries the same rings a front leaves.
      s.pre = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        if (field[i] < cut) continue;
        // Addressed by (generation, cell), so a cell's first state does not
        // move when the patches do.
        if (R('cell', 'generation 0', i) < 0.7) s.first[i] = 1;
        s.pre[i] = Math.min(PRE, Math.floor(PRE * (field[i] - cut) / Math.max(1e-9, top - cut) * 1.6));
      }
      // Each cell sits a little off the lattice and a little larger or
      // smaller, so a front reads as grown rather than as stair-steps.
      s.jx = new Float32Array(n);
      s.jy = new Float32Array(n);
      s.jr = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        s.jx[i] = ((i % COLS) + 0.5 + (R('cell', 'dx', i) - 0.5) * 0.7) * C;
        s.jy[i] = (Math.floor(i / COLS) + 0.5 + (R('cell', 'dy', i) - 0.5) * 0.7) * C;
        s.jr[i] = C * (0.62 + R('cell', 'r', i) * 0.3);
      }
    }],

    ['run the rule', (s) => {
      if (s.edge !== 'wrap' && s.edge !== 'dead') throw new Error(`growth: edge must be 'wrap' or 'dead', got ${s.edge}`);
      const [name, B, S] = RULES[Math.round(s.params.rule)];
      s.rule = name;
      const born = new Uint8Array(9);
      const stays = new Uint8Array(9);
      for (const c of B) born[c] = 1;
      for (const c of S) stays[c] = 1;
      const { cols, rows, gens } = s;
      const wrap = s.edge === 'wrap';
      const n = cols * rows;
      s.cells = new Uint8Array(gens * n);
      let cur = Uint8Array.from(s.first);
      let next = new Uint8Array(n);
      for (let g = 0; g < gens; g++) {
        s.cells.set(cur, g * n);
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            let count = 0;
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                if (!dx && !dy) continue;
                let nx = x + dx;
                let ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
                  if (!wrap) continue;                   // past the edge is dead
                  nx = (nx + cols) % cols;
                  ny = (ny + rows) % rows;
                }
                count += cur[ny * cols + nx];
              }
            }
            const i = y * cols + x;
            next[i] = cur[i] ? stays[count] : born[count];
          }
        }
        const was = cur;     // swap: the generation just written is read next
        cur = next;
        next = was;
      }
    }],

    ['date every cell', (s) => {
      // mark > 0: alive, and mark - 1 is its ink: PRE + the generation it was
      //           born in, less how long a seeded cell was there before.
      // mark < 0: dead since generation -mark - 1, after having lived.
      // mark = 0: never lived.
      const n = s.cols * s.rows;
      const cells = s.cells;
      s.mark = new Int16Array(cells.length);
      for (let g = 0; g < s.gens; g++) {
        for (let i = 0; i < n; i++) {
          const k = g * n + i;
          const before = g ? s.mark[k - n] : 0;
          if (cells[k]) s.mark[k] = before > 0 ? before : PRE + g + 1 - (g ? 0 : s.pre[i]);
          else s.mark[k] = before > 0 ? -(g + 1) : before;
        }
      }
      // One colour per birth: bands that step between the plate's two colours,
      // each band a little darker at its end, so rings read.
      const pl = s.plate;
      const span = PRE + s.gens;
      s.inks = [];
      for (let b = 0; b < span; b++) {
        const walk = mixOklch(pl.a, pl.b, b / (span - 1));
        s.inks.push(mix(walk, pl.dark, 0.06 + 0.32 * ((b % BAND) / (BAND - 1)) ** 1.5));
      }
    }],
  ],

  draw(g, s, t, clock) {
    const pl = s.plate;
    layer(g, s, 'ground', [0, 0, W, H], ground);

    const n = s.cols * s.rows;
    const gen = Math.min(s.gens - 1, clock.frame);   // one generation a frame

    // Ghosts first, grouped by how far they have faded; the last group keeps
    // FLOOR of its ghost, so the ground remembers what lived there.
    g.fillStyle = pl.ghost;
    for (let fade = 0; fade <= GHOST; fade++) {
      let any = false;
      for (let i = 0; i < n; i++) {
        const m = s.mark[gen * n + i];
        if (m >= 0 || Math.min(GHOST, gen + 1 + m) !== fade) continue;
        if (!any) { g.globalAlpha = FLOOR + (1 - FLOOR) * (1 - fade / GHOST); g.beginPath(); any = true; }
        disc(g, s, i, 0.8);
      }
      if (any) g.fill();
    }
    g.globalAlpha = 1;

    for (let i = 0; i < n; i++) {
      const m = s.mark[gen * n + i];
      if (m <= 0) continue;
      // A newborn cell swells over its first two generations.
      const age = gen - (m - 1 - PRE);
      g.fillStyle = s.inks[m - 1];
      g.beginPath();
      disc(g, s, i, age >= 2 ? 1 : age === 1 ? 0.84 : 0.6);
      g.fill();
    }
  },
};

function disc(g, s, i, k) {
  const r = s.jr[i] * k;
  g.moveTo(s.jx[i] + r, s.jy[i]);
  g.arc(s.jx[i], s.jy[i], r, 0, Math.PI * 2);
}

/** The ground: paper under broad, faint blooms of the ghost colour, so the open
 *  frame reads as a surface the fronts will cross rather than as nothing. */
function ground(g, s) {
  const pl = s.plate;
  const R = rng(s.seed);
  g.fillStyle = pl.ground;
  g.fillRect(0, 0, W, H);
  g.fillStyle = pl.ghost;
  for (let i = 0; i < 140; i++) {
    const x = R('ground', 'x', i) * W;
    const y = R('ground', 'y', i) * H;
    g.globalAlpha = 0.05 + 0.07 * fbm(R, x / 300, y / 300, 2, 'ground');
    g.beginPath();
    g.arc(x, y, 30 + R('ground', 'r', i) * 130, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}
