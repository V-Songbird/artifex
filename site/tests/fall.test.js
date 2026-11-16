'use strict';

// The fall in site/pieces/fall.js is solved once per seed and kept, so the
// contain seam goes on from where the settle shot's fall stopped instead of
// solving it again, and the settle shot, reached after contain, reads its
// fall from contain's. Scrolling either way and opening a recipe URL cold
// must give the same fall: the same track and the same strikes.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadExternal } = require('../../tools/piece-input.js');
const P = require('../../core/piece.js');

const ROOT = path.join(__dirname, '..', '..');
const SETTLE = path.join(ROOT, 'site', 'pieces', 'settle.cjs');
const CONTAIN = path.join(ROOT, 'site', 'pieces', 'contain.cjs');
const fall = (piece, seed) => P.solve(P.validate(piece), seed, {}).state.fall;
const same = (a, b, what) => {
  assert.equal(a.frames, b.frames, what + ' frames');
  assert.deepEqual(Array.from(a.track), Array.from(b.track), what + ' track');
  assert.deepEqual(a.hits, b.hits, what + ' strikes');
};

test('score: the crowd around each strike, counted in one pass, is the count of strikes within 0.04 s of it', () => {
  const { crowds } = require('../pieces/score.js');
  const { WALL_SECONDS } = require('../pieces/hang.js');
  const [settle, wall] = loadExternal([SETTLE, path.join(ROOT, 'site', 'pieces', 'wall.cjs')], ROOT).pieces.map((p) => p.piece);
  assert.equal(wall.time.duration, WALL_SECONDS, 'the wall shot lasts the length the hang and the score read');
  for (const seed of [1, 2]) {
    const hits = fall(settle, seed).hits, fast = crowds(hits);
    assert.ok(hits.length > 50, hits.length + ' strikes at seed ' + seed);
    const wrong = hits.findIndex((h, i) => fast[i] !== hits.filter((o) => Math.abs(o.at - h.at) < 0.04).length);
    assert.equal(wrong, -1, 'first strike counted differently at seed ' + seed);
    assert.ok(Math.max(...fast) > 1, 'some strikes share their moment');
  }
});

test('fall: a fall kept by one piece gives the next the fall it solves alone, either way, and never serves another seed', () => {
  const down = loadExternal([SETTLE, CONTAIN], ROOT).pieces.map((p) => p.piece);
  const up = loadExternal([CONTAIN, SETTLE], ROOT).pieces.map((p) => p.piece);
  const settle = fall(down[0], 1), contain = fall(up[0], 1);
  same(fall(down[1], 1), contain, 'contain after settle');
  same(fall(up[1], 1), settle, 'settle after contain');
  same(fall(down[1], 2), fall(up[0], 2), 'contain at seed 2 after seed 1');
});
