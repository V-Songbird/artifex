// automaton -- one row of cells and a rule of eight bits, printed as its whole
// history. A still.
//
// IN THE SET BECAUSE IT BREAKS THE OTHERS' ASSUMPTIONS. Every other piece here
// decides a mark from a position, a field or a force. Here no mark is decided at
// all: a cell's state is a lookup in a table of eight bits, indexed by the three
// cells above it, and the picture is the stack of every generation. The rule is
// the one number that matters, and it is a declared integer knob, so a sheet
// swept across it shows the family Wolfram sorted into four classes: uniform,
// repeating, random and complex.
//
// THE THREE TRAPS, EACH HANDLED IN ONE PLACE.
//
//   1. Bit order. A neighbourhood (left, self, right) is the three-bit number
//      4*left + 2*self + right, and its outcome is that bit of the rule, counted
//      from the least significant. Rule 30 is 00011110: 100, 011, 010 and 001
//      give a live cell. Reading the neighbourhood the other way round draws the
//      mirror rule, which for a symmetric rule such as 90 looks exactly right,
//      so the tests check an asymmetric one by hand.
//   2. Writing into the row being read. A cell's next state needs its left
//      neighbour's OLD state, so the next row is written into a second buffer
//      and the two are swapped once the row is whole.
//   3. The edge. `edge` is stated once and read by the step: 'wrap' makes the
//      row a ring, so the first cell's left neighbour is the last cell; 'dead'
//      counts every cell past the end as dead. This piece declares 'wrap'.
//
// COLOUR BY BIRTH AND DEATH, NOT BY STATE. A live cell drawn black and a dead
// one white is a grid of squares. Here each column is a thread: a run of live
// cells is one strand, round where it is born, and it leaves a tapering trace
// where it dies. Its colour says when it was born, drifting down the sheet, and
// how long it lived: a strand that dies at once stays light and warm, one that
// lasts goes deep. What the eye reads is the history the stacked generations
// are there to show, not a checkerboard.
//
// The first row is seeded, addressed by (generation, cell): a few islands of
// live cells on an empty row, so growth fronts leave from several places and
// meet, rather than one noise row filling the sheet from the first line.

'use strict';

const { rng } = require('../core/rand.js');
const { pick, clamp01 } = require('../core/num.js');
const { mix, mixOklch } = require('../core/colour.js');
const font = require('../core/stroke-font.js');

const W = 900;
const H = 1200;
const M = 60;                        // side and top margin
const FOOT = 150;                    // the legend sits in a deeper foot
const P = 5;                         // cell pitch, design units
const N = (W - 2 * M) / P;           // 156 cells in a row
const G = Math.floor((H - M - FOOT) / P);   // 198 generations
const EDGE = 'wrap';
const LONG = 9;                      // a strand this long has gone fully deep
const TRACE = 7;                     // generations a dead strand's trace reaches down

// Stated as art direction: a paper, the colour a strand is born in at the top
// and at the foot of the sheet, the colour a long life goes to, the trace, and
// the ink of the legend.
const PLATES = [
  { paper: '#f2ece0', early: '#e0803a', late: '#b8406a', deep: '#1f2440', trace: '#c9b89c', ink: '#2a2620' },
  { paper: '#eef0ea', early: '#e3b23c', late: '#5c9a7c', deep: '#16302c', trace: '#b5c2b8', ink: '#1d2724' },
  { paper: '#15171d', early: '#f2c46b', late: '#d8664f', deep: '#5e9cc9', trace: '#343a46', ink: '#d9dde2' },
];

module.exports = {
  name: 'automaton',
  size: { w: W, h: H },
  outputs: ['raster', 'vector'],
  time: null,
  seed: 30,
  params: {
    rule: { min: 0, max: 255, value: 30,
      meaning: 'the Wolfram rule number, 0 to 255: which of the eight neighbourhoods give a live cell' },
    islands: { min: 1, max: 7, value: 3,
      meaning: 'how many seeded patches of live cells the first row starts from' },
  },

  state: () => ({ gens: G, edge: EDGE, first: null, rows: null, strands: null }),

  build: [
    ['seed the first row', (s) => {
      const R = rng(s.seed);
      s.plate = pick(PLATES, R('plate', 'pick'));
      s.first = new Uint8Array(N);
      const n = Math.round(s.params.islands);
      for (let k = 0; k < n; k++) {
        const at = Math.floor(R('island', 'at', k) * N);
        const half = 1 + Math.floor(R('island', 'half', k) * 7);
        for (let d = -half; d <= half; d++) {
          const i = ((at + d) % N + N) % N;
          // Addressed by (generation, cell): the same cell of the same seed is
          // the same state however many islands are asked for.
          if (R('cell', 'generation 0', i) < 0.55) s.first[i] = 1;
        }
      }
    }],

    ['run the rule', (s) => {
      if (s.edge !== 'wrap' && s.edge !== 'dead') throw new Error(`automaton: edge must be 'wrap' or 'dead', got ${s.edge}`);
      const rule = Math.round(s.params.rule);
      const wrap = s.edge === 'wrap';
      const n = s.first.length;
      const gens = s.gens;
      s.rule = rule;
      s.rows = new Uint8Array(gens * n);
      let cur = Uint8Array.from(s.first);
      let next = new Uint8Array(n);
      for (let g = 0; g < gens; g++) {
        s.rows.set(cur, g * n);
        for (let i = 0; i < n; i++) {
          const l = i > 0 ? cur[i - 1] : wrap ? cur[n - 1] : 0;
          const r = i < n - 1 ? cur[i + 1] : wrap ? cur[0] : 0;
          next[i] = (rule >> (4 * l + 2 * cur[i] + r)) & 1;
        }
        const was = cur;     // swap: the row just written is read next, never
        cur = next;          // the row being written
        next = was;
      }
    }],

    ['find every strand', (s) => {
      // One strand per vertical run of live cells: column, first and last
      // generation, and whether it was born and died on the sheet.
      const n = s.first.length;
      const rows = s.rows;
      const gens = rows.length / n;
      const out = [];
      for (let i = 0; i < n; i++) {
        let g = 0;
        while (g < gens) {
          if (!rows[g * n + i]) { g++; continue; }
          let end = g;
          while (end + 1 < gens && rows[(end + 1) * n + i]) end++;
          out.push(i, g, end, (g > 0 ? 1 : 0) | (end + 1 < gens ? 2 : 0));
          g = end + 1;
        }
      }
      s.strands = Int32Array.from(out);
    }],
  ],

  draw(g, s) {
    const pl = s.plate;
    g.fillStyle = pl.paper;
    g.fillRect(0, 0, W, H);

    const gens = s.rows.length / s.first.length;
    const st = s.strands;
    const w = P * 0.72;
    const inset = (P - w) / 2;

    // The traces first, so a strand born where another died lies over it.
    g.fillStyle = pl.trace;
    for (let k = 0; k < st.length; k += 4) {
      if (!(st[k + 3] & 2)) continue;
      const x = M + st[k] * P + P / 2;
      const y = M + (st[k + 2] + 1) * P - w / 2;
      const reach = Math.min(TRACE, gens - st[k + 2] - 1) * P;
      g.beginPath();
      g.moveTo(x - w * 0.32, y);
      g.lineTo(x + w * 0.32, y);
      g.lineTo(x, y + reach);
      g.closePath();
      g.fill();
    }

    for (let k = 0; k < st.length; k += 4) {
      const x = M + st[k] * P + inset;
      const y = M + st[k + 1] * P;
      const len = st[k + 2] - st[k + 1] + 1;
      const born = st[k + 3] & 1;
      const dies = st[k + 3] & 2;
      const when = mixOklch(pl.early, pl.late, st[k + 1] / Math.max(1, gens - 1));
      g.fillStyle = mix(when, pl.deep, Math.pow(clamp01((len - 1) / LONG), 0.8));
      const top = born ? w / 2 : 0;
      const foot = dies ? w / 2 : 0;
      g.beginPath();
      g.roundRect(x, y, w, len * P, [top, top, foot, foot]);
      g.fill();
    }

    legend(g, s);
  },
};

/** The foot: the rule's number, and its eight neighbourhoods with what each
 *  gives, in the order the bits are counted -- 111 on the left, 000 on the right. */
function legend(g, s) {
  const pl = s.plate;
  const base = H - FOOT + 44;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = mix(pl.paper, pl.ink, 0.25);
  g.lineWidth = 0.7;
  g.beginPath();
  g.moveTo(M, base - 18);
  g.lineTo(W - M, base - 18);
  g.stroke();

  g.strokeStyle = mix(pl.paper, pl.ink, 0.75);
  g.lineWidth = 1.2;
  font.text(g, `RULE ${s.rule}`, M, base, 14);
  g.lineWidth = 0.9;
  font.text(g, `${s.rule.toString(2).padStart(8, '0')} . EDGE ${s.edge.toUpperCase()}`, M, base + 14 * font.leading + 7, 9);

  const c = 9;                                   // one legend cell
  const gap = 12;
  const step = 3 * c + gap;
  let x = W - M - 8 * step + gap;
  for (let v = 7; v >= 0; v--) {
    for (let b = 0; b < 3; b++) cellMark(g, x + b * c, base, c, (v >> (2 - b)) & 1 ? pl.deep : null, pl);
    cellMark(g, x + c, base + c + 4, c, (s.rule >> v) & 1 ? pl.early : null, pl);
    x += step;
  }
}

function cellMark(g, x, y, c, fill, pl) {
  g.beginPath();
  g.roundRect(x + 1, y + 1, c - 2, c - 2, 1.5);
  if (fill) {
    g.fillStyle = fill;
    g.fill();
  } else {
    g.strokeStyle = mix(pl.paper, pl.ink, 0.35);
    g.lineWidth = 0.6;
    g.stroke();
  }
}
