// readout -- data-driven and abstract. A timeline, vector-bound, no type, no
// organic curvature, no field.
//
// IN THE SET BECAUSE IT BREAKS THE OTHERS' ASSUMPTIONS. Its structure does not
// come from the seed. The seed decides how the piece LOOKS; a fixed dataset
// decides what it SAYS, and no re-roll may change that. Every other example in
// this set would happily let the seed move everything, and a library that
// assumes the seed is the only input cannot make this picture.
//
// The dataset is the first 96 digits of pi -- chosen because anyone can check
// it, it belongs to nobody, and it is not a plausible subject for the library.
//
// The testable form: solve at two different seeds and the digits are identical
// while the presentation is not. That check can fail, which is the point.

'use strict';

const { rng } = require('../core/rand.js');
const { clamp, pick } = require('../core/num.js');
const { mix } = require('../core/colour.js');
const { stroke } = require('../core/path.js');

const DIGITS = (
  '1415926535' + '8979323846' + '2643383279' + '5028841971' + '6939937510'
  + '5820974944' + '5923078164' + '0628620899' + '8628034825' + '342117'
);

const W = 960;
const H = 640;
const M = 64;
const COLS = 24;
const ROWS = 4;
const SLOTS = 9;

const PAPER = '#f6f4ef';
const INK = '#1c1c20';
const MUTE = '#c9c4b8';
const ACCENTS = ['#cc4125', '#2f6f9f', '#3f7d55', '#8c5bb0'];

const GRID_W = W - 2 * M;
const TAPE_H = 110;
const GRID_H = H - 2 * M - TAPE_H - 34;
const CELL_W = GRID_W / COLS;
const CELL_H = GRID_H / ROWS;

module.exports = {
  name: 'readout',
  size: { w: W, h: H },
  outputs: ['raster', 'vector'],
  time: { duration: 6, hz: 24 },
  seed: 31,
  params: {
    lead: { min: 0.5, max: 6, value: 2.2,
      meaning: 'how many cells ahead of the fill the scan line runs' },
  },

  state: () => ({ cells: [], accent: ACCENTS[0] }),

  build: [
    ['read the data', (s) => {
      // NOTHING SEEDED HAPPENS IN THIS STAGE. The separation is the example.
      s.cells = [];
      for (let k = 0; k < DIGITS.length; k++) {
        s.cells.push({
          k,
          digit: Number(DIGITS[k]),
          col: k % COLS,
          row: Math.floor(k / COLS),
        });
      }
    }],

    ['choose the presentation', (s) => {
      const R = rng(s.seed);
      s.accent = pick(ACCENTS, R('sheet', 'accent'));
      for (const c of s.cells) {
        // Material irregularity, addressed per cell: adding a digit at the end
        // cannot move the jitter of the ones before it.
        c.jx = (R('cell', 'jx', c.k) - 0.5) * 1.6;
        c.jy = (R('cell', 'jy', c.k) - 0.5) * 1.6;
        c.wide = R('cell', 'wide', c.k) < 0.22;
      }
    }],
  ],

  draw(g, s, t) {
    const lead = s.params.lead;
    const scan = t * (s.cells.length + lead);

    g.fillStyle = PAPER;
    g.fillRect(0, 0, W, H);

    // --- the slot grid, always fully drawn ------------------------------
    // The empty slots are the measure. Without them a low digit and a missing
    // cell look the same, which is the difference between a reading and a blot.
    g.strokeStyle = MUTE;
    g.lineWidth = 0.6;
    for (const c of s.cells) {
      const [x, y] = cellOrigin(c);
      for (let i = 0; i < SLOTS; i++) {
        const sy = y + CELL_H - 7 - (i + 1) * slotPitch();
        g.beginPath();
        g.rect(x, sy, c.wide ? 26 : 19, slotPitch() - 2.2);
        g.stroke();
      }
    }

    // --- the filled slots, arriving one at a time -----------------------
    for (const c of s.cells) {
      const arrived = clamp(Math.floor((scan - c.k) * 2.4), 0, c.digit);
      if (arrived <= 0) continue;
      const [x, y] = cellOrigin(c);
      // The value carries the digit a third way, mixed in linear light.
      g.fillStyle = c.digit >= 7 ? s.accent : mix(MUTE, INK, 0.35 + c.digit / 9);
      for (let i = 0; i < arrived; i++) {
        const sy = y + CELL_H - 7 - (i + 1) * slotPitch();
        g.beginPath();
        g.rect(x, sy, c.wide ? 26 : 19, slotPitch() - 2.2);
        g.fill();
      }
    }

    // --- the same data read a second way, as a profile ------------------
    const ty = H - M;
    g.strokeStyle = MUTE;
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(M, ty);
    g.lineTo(W - M, ty);
    g.stroke();

    const done = clamp(Math.floor(scan), 0, s.cells.length);
    if (done >= 2) {
      g.strokeStyle = INK;
      g.lineWidth = 1.6;
      g.lineJoin = 'round';
      stroke(g, s.cells.slice(0, done).map((c, k) => [
        M + (k / (s.cells.length - 1)) * GRID_W,
        ty - (c.digit / 9) * TAPE_H,
      ]));
    }

    // --- the scan -------------------------------------------------------
    // It is a position, not a fade. A line arrives; it does not resolve out of
    // nothing, and the reader can always point at where the piece has got to.
    if (scan > 0 && scan < s.cells.length + lead) {
      const col = Math.min(COLS - 1, Math.floor(scan) % COLS);
      const row = Math.min(ROWS - 1, Math.floor(Math.floor(scan) / COLS));
      const x = M + col * CELL_W;
      g.strokeStyle = s.accent;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x - 4, M);
      g.lineTo(x - 4, M + GRID_H);
      g.stroke();
      g.beginPath();
      g.moveTo(M, M + row * CELL_H - 4);
      g.lineTo(W - M, M + row * CELL_H - 4);
      g.stroke();
    }
  },
};

function slotPitch() { return (CELL_H - 14) / SLOTS; }

function cellOrigin(c) {
  return [M + c.col * CELL_W + c.jx, M + c.row * CELL_H + c.jy];
}

