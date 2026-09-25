// Placeholder model shared by the site's placeholder shots: a pen rules rows,
// then columns, then fills some of the cells the two make. Each shot draws one
// part of it, so the frame at every join is the same picture on both sides.
// These shots prove the stage; they are not the site's art.

'use strict';

const { rng } = require('../../core/rand.js');

const W = 1200;
const H = 800;
const ROWS = 7;
const COLS = 10;
const LEFT = 90;
const TOP = 90;
const STEP_X = (W - 2 * LEFT) / COLS;
const STEP_Y = (H - 2 * TOP) / (ROWS - 1);
const GROUND = '#efeae0';
const INK = '#23201c';
const TONES = ['#c9bda6', '#8f7f69', '#3b5b6b'];

/** The ruled lines and the cells to fill, from the seed alone. */
function solveLattice(state) {
  const R = rng(state.seed);
  // Each ruled line leans a little, as a hand-held rule does.
  state.rows = Array.from({ length: ROWS }, (_, i) => {
    const y = TOP + i * STEP_Y;
    return [y + (R('row', 'from', i) - 0.5) * 8, y + (R('row', 'to', i) - 0.5) * 8];
  });
  state.cols = Array.from({ length: COLS + 1 }, (_, j) => {
    const x = LEFT + j * STEP_X;
    return [x + (R('col', 'from', j) - 0.5) * 8, x + (R('col', 'to', j) - 0.5) * 8];
  });
  const cells = [];
  for (let i = 0; i < ROWS - 1; i++) {
    for (let j = 0; j < COLS; j++) {
      if (R('cell', 'filled', i * COLS + j) < 0.3) cells.push({ i, j, tone: TONES[Math.floor(R('cell', 'tone', i * COLS + j) * TONES.length)] });
    }
  }
  // Filled in a seeded order, not reading order.
  state.cells = cells.map((c, k) => ({ ...c, order: R('cell', 'order', k) })).sort((a, b) => a.order - b.order);
}

function ground(g) {
  g.fillStyle = GROUND;
  g.fillRect(0, 0, W, H);
}

function pen(g) {
  g.strokeStyle = INK;
  g.lineWidth = 2.2;
  g.lineCap = 'round';
}

/** Rows ruled left to right, one after another; `u` in [0, 1] is how far the pen has got. */
function rows(g, state, u) {
  pen(g);
  const done = u * ROWS;
  state.rows.forEach(([a, b], i) => {
    const part = Math.min(1, Math.max(0, done - i));
    if (part <= 0) return;
    g.beginPath();
    g.moveTo(LEFT, a);
    g.lineTo(LEFT + (W - 2 * LEFT) * part, a + (b - a) * part);
    g.stroke();
  });
}

/** Columns ruled top to bottom, all at once; `u` in [0, 1]. */
function cols(g, state, u) {
  if (u <= 0) return;
  pen(g);
  state.cols.forEach(([a, b]) => {
    g.beginPath();
    g.moveTo(a, TOP);
    g.lineTo(a + (b - a) * u, TOP + (H - 2 * TOP) * u);
    g.stroke();
  });
}

/** The first `u` of the cells filled, in their seeded order. */
function fills(g, state, u) {
  const n = Math.round(u * state.cells.length);
  for (let k = 0; k < n; k++) {
    const { i, j, tone } = state.cells[k];
    g.fillStyle = tone;
    g.fillRect(LEFT + j * STEP_X + 5, TOP + i * STEP_Y + 5, STEP_X - 10, STEP_Y - 10);
  }
}

module.exports = { W, H, solveLattice, ground, rows, cols, fills };
