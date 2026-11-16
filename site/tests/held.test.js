'use strict';

// The kept copies' release rule in site/pieces/held.js, on stand-in canvases
// that record their size. What the copies cost a GPU canvas needs installed
// Edge: node tools/check-site.js reports them per walk.

const test = require('node:test');
const assert = require('node:assert/strict');

const HELD = require.resolve('../pieces/held.js');

/** A fresh held.js, with its own copies and tally. */
function fresh() {
  delete require.cache[HELD];
  return { ...require(HELD), tally: globalThis.__held };
}

/** A stand-in stage canvas of w x h whose copies are made through its document. */
function stage(w, h) {
  const doc = { createElement: () => canvas(doc, 0, 0) };
  return canvas(doc, w, h).getContext('2d');
}

function canvas(doc, width, height) {
  const c = { width, height, ownerDocument: doc };
  const g = {
    canvas: c, m: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    setTransform(a, b, cc, d, e, f) { this.m = { a, b, c: cc, d, e, f }; },
    getTransform() { return this.m; },
    drawImage() {}, save() {}, restore() {},
  };
  c.getContext = () => g;
  return c;
}

test('held: copies are kept for the three solves last drawn, and a fourth empties the oldest', () => {
  const { hold, tally } = fresh();
  const g = stage(400, 300), solves = [{}, {}, {}, {}];
  const made = new Map(), copies = new Map();
  const paint = (cg, s) => { made.set(s, (made.get(s) || 0) + 1); copies.set(s, cg.canvas); };
  for (const s of solves.slice(0, 3)) hold(g, s, 'sheet', paint);
  assert.deepEqual([tally.copies, tally.pixels], [3, 3 * 400 * 300]);
  hold(g, solves[3], 'sheet', paint);
  assert.equal(copies.get(solves[0]).width, 0, 'the oldest solve is emptied at once');
  assert.equal(copies.get(solves[0]).height, 0);
  for (const s of solves.slice(1)) assert.equal(copies.get(s).width, 400);
  assert.deepEqual([tally.copies, tally.pixels], [3, 3 * 400 * 300]);
  // Drawing a kept solve again makes it the last used, and paints nothing.
  hold(g, solves[1], 'sheet', paint);
  assert.equal(made.get(solves[1]), 1);
  // The emptied one is made again when drawn again, and the oldest, now solve 2, goes.
  hold(g, solves[0], 'sheet', paint);
  assert.equal(made.get(solves[0]), 2);
  assert.equal(copies.get(solves[0]).width, 400);
  assert.equal(copies.get(solves[2]).width, 0);
  assert.equal(copies.get(solves[1]).width, 400, 'solve 1 was used after solve 2');
  assert.equal(tally.copies, 3);
});

test('held: past the ceiling the third solve goes, but never the two last drawn', () => {
  const { keep, tally } = fresh();
  // 2000 x 2000 is 4 megapixels a copy; five keys make 20 a solve.
  const g = stage(2000, 2000), a = {}, b = {}, c = {};
  const lay = (s) => { for (const key of ['k1', 'k2', 'k3', 'k4', 'k5']) keep(g, s, key, () => {}); };
  lay(a);
  lay(b);
  assert.equal(tally.pixels, 40e6, 'two solves are kept whatever they hold');
  lay(c);
  // Over the ceiling, a went when c was first drawn: two solves' copies remain.
  assert.deepEqual([tally.copies, tally.pixels], [10, 40e6]);
  assert.equal(tally.peak, 40e6);
  // Under it, three solves are kept.
  const { keep: small, tally: t2 } = fresh();
  const h = stage(1000, 1000);
  for (const s of [{}, {}, {}]) for (const key of ['k1', 'k2']) small(h, s, key, () => {});
  assert.deepEqual([t2.copies, t2.pixels], [6, 6e6]);
});

test('held: a solve given up empties its counted copies and their spares too', () => {
  const { upTo, hold, tally } = fresh();
  const g = stage(300, 200), s = {};
  const made = [];
  const doc = g.canvas.ownerDocument, create = doc.createElement;
  doc.createElement = () => { const c = create(); made.push(c); return c; };
  // Nine items, a copy every fourth and two between: the base, spares for them, and the counts passed.
  upTo(g, s, 'marks', 6, () => {}, () => {}, null, 9);
  const kept = tally.copies;
  assert.ok(kept >= 4, kept + ' copies');
  for (const other of [{}, {}, {}]) hold(g, other, 'sheet', () => {});
  assert.equal(tally.copies, 3, 'only the three other solves remain');
  assert.equal(tally.pixels, 3 * 300 * 200);
  assert.equal(made.slice(0, kept).filter((c) => c.width).length, 0, 'every canvas of the given-up solve is empty');
  // Its counts are made again from the base when it is drawn again.
  let items = 0;
  upTo(g, s, 'marks', 6, () => {}, () => { items++; }, null, 9);
  assert.equal(items, 6);
});

test('held: a lowered scale replaces a copy with a shrunk one and empties the larger', () => {
  const { hold, tally } = fresh();
  const g = stage(800, 600), s = {};
  const copies = [];
  hold(g, s, 'sheet', (cg) => copies.push(cg.canvas));
  g.canvas.width = 600; g.canvas.height = 450;
  g.setTransform(0.75, 0, 0, 0.75, 0, 0);
  hold(g, s, 'sheet', () => { throw new Error('a shrunk copy paints nothing'); });
  assert.equal(copies[0].width, 0);
  assert.deepEqual([tally.copies, tally.pixels], [1, 600 * 450]);
});

test('held: counted copies at a new size that cannot be shrunk to are remade, and the old ones emptied', () => {
  const { upTo, tally } = fresh();
  const g = stage(600, 450), s = {};
  const made = [];
  const doc = g.canvas.ownerDocument, create = doc.createElement;
  doc.createElement = () => { const c = create(); made.push(c); return c; };
  upTo(g, s, 'marks', 5, () => {}, () => {}, null, 8);
  const before = made.length;
  // A larger canvas: nothing kept can stand in for it.
  g.canvas.width = 800; g.canvas.height = 600;
  upTo(g, s, 'marks', 5, () => {}, () => {}, null, 8);
  assert.equal(made.slice(0, before).filter((c) => c.width).length, 0);
  assert.equal(tally.pixels, tally.copies * 800 * 600);
});
