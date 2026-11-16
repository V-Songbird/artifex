// The pixel-art style's grid marks that have a rule to keep: even line runs,
// a traced curve, a dithered fade and the light grid.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../skills/artifex/styles/pixel-art.js');

// The lengths of the runs of cells that share a row (axis 1) or a column (axis 0).
const runs = (cells, axis = 1) => {
  const out = [1];
  for (let i = 1; i < cells.length; i++) cells[i][axis] === cells[i - 1][axis] ? out[out.length - 1]++ : out.push(1);
  return out;
};

test('pixel-art line: one run length on a clean slope, two neighbouring lengths on any other', () => {
  assert.deepEqual(runs(P.line(0, 0, 11, 3)), [3, 3, 3, 3]);
  assert.deepEqual(runs(P.line(0, 0, 9, 3)), [3, 2, 3, 2]);
  assert.deepEqual(runs(P.line(0, 0, 3, 11), 0), [3, 3, 3, 3], 'a steep line runs down its columns');
  assert.deepEqual(P.line(5, 5, 0, 2), [[5, 5], [4, 5], [3, 4], [2, 3], [1, 3], [0, 2]], 'any direction, end to end');
  assert.deepEqual(P.line(2, 2, 2, 2), [[2, 2]]);
  for (const [x, y] of [[17, 5], [23, 7], [40, 39], [6, 31]]) {
    const lengths = new Set(runs(P.line(0, 0, x, y), x >= y ? 1 : 0));
    assert.ok(lengths.size <= 2 && Math.max(...lengths) - Math.min(...lengths) <= 1, `to ${x}, ${y}: runs of ${[...lengths]}`);
  }
});

test('pixel-art trace: a curve is one cell thick, joined corner to corner, with no elbow', () => {
  const circle = Array.from({ length: 100 }, (_, i) => [20 + 11.4 * Math.cos(i * Math.PI / 50), 20 + 11.4 * Math.sin(i * Math.PI / 50)]);
  const cells = P.trace(circle, true);
  const n = cells.length;
  for (let i = 0; i < n; i++) {
    const [a, b, c] = [cells[i], cells[(i + 1) % n], cells[(i + 2) % n]];
    assert.equal(Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])), 1, `cell ${i} touches the next`);
    assert.ok(!(Math.abs(a[0] - c[0]) === 1 && Math.abs(a[1] - c[1]) === 1) || i + 2 >= n, `no elbow after cell ${i}`);
  }
  assert.equal(new Set(cells.map((c) => c.join())).size, n, 'no cell twice');
});

test('pixel-art trace: runs that go down, up, down in length trade places, and the ends stay', () => {
  // Rows of 4, 1, 2, 1 cells stepping down one row each: the 1 before the 2 is the jagged step.
  const pts = [];
  let x = 0;
  [4, 1, 2, 1].forEach((len, row) => { for (let k = 0; k < len; k++) pts.push([x++ + 0.5, row + 0.5]); });
  const cells = P.trace(pts);
  assert.deepEqual(runs(cells), [4, 2, 1, 1]);
  assert.deepEqual([cells[0], cells[cells.length - 1]], [[0, 0], [7, 3]]);
  assert.equal(cells.length, 8, 'as many cells');
  // A crest is left alone: long, short, long changes direction once.
  const crest = [];
  x = 0;
  [3, 1, 3].forEach((len, row) => { for (let k = 0; k < len; k++) crest.push([x++ + 0.5, row + 0.5]); });
  assert.deepEqual(runs(P.trace(crest)), [3, 1, 3]);
});

test('pixel-art stamp: a fade drops whole cells by the Bayer threshold, from the sprite\'s own corner', () => {
  const rows = Array.from({ length: 4 }, () => new Array(4).fill('a'));
  const kept = (opacity, x = 0, y = 0) => {
    const G = P.grid(8, 8, null);
    P.stamp(G, rows, x, y, opacity);
    return G.px.map((c, i) => (c ? i - (y * 8 + x) : null)).filter((i) => i !== null);
  };
  assert.deepEqual([0, 0.25, 0.5, 0.75, 1].map((o) => kept(o).length), [0, 4, 8, 12, 16]);
  assert.equal(kept(1).length, (() => { const G = P.grid(8, 8, null); P.stamp(G, rows, 0, 0); return G.px.filter(Boolean).length; })(), 'no opacity is the whole sprite');
  assert.deepEqual(kept(0.5, 3, 1), kept(0.5), 'the pattern moves with the sprite');
});

test('pixel-art light: a glow adds light that falls as (1 - d) squared and leaves the colour grid alone', () => {
  const L = P.lights(16, 16);
  P.glow(L, 8, 8, 8, '#ff8000', 0.5);
  const at = (x, y) => Array.from(L.rgb.slice((y * 16 + x) * 3, (y * 16 + x) * 3 + 3));
  const d = Math.hypot(0.5, 0.5) / 8;
  const f = (1 - d) ** 2;
  at(8, 8).forEach((v, k) => assert.ok(Math.abs(v - [255, 128, 0][k] * 0.5 * f) < 1e-3, `channel ${k} at the middle`));
  assert.ok(at(11, 8)[0] > at(13, 8)[0] && at(13, 8)[0] > at(15, 8)[0], 'dimmer outward');
  assert.deepEqual(at(0, 0), [0, 0, 0], 'none past the radius');
  P.glow(L, 8, 8, 8, '#ff8000', 0.5);
  assert.ok(Math.abs(at(8, 8)[0] - 255 * f) < 1e-3, 'two glows add');

  const calls = [];
  const g = {
    save() {}, restore() {},
    set globalCompositeOperation(v) { calls.push(v); },
    set fillStyle(v) { this.style = v; },
    fillRect(x, y, w, h) { calls.push([this.style, x, y, w, h]); },
  };
  const one = P.lights(2, 1);
  one.rgb.set([300, 10.4, 0], 3);
  P.emitLight(g, one, 10);
  assert.deepEqual(calls, ['lighter', ['rgb(255, 10, 0)', 10, 0, 10, 10]], 'added, one flat cell each, dark cells skipped');
});
