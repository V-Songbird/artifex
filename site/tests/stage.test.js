'use strict';

// The stage's pure helpers: frames and playheads, recipes, the scale it lowers
// to and the canvas it fits. Drawing, scrolling and the worker need installed
// Edge: node tools/check-site.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const { shots } = require('../../core/time.js');
const { frameIndex, frameT } = require('../../core/piece.js');
const { playheadAt, frameOf, readRecipe, writeRecipe, p95, lower, judgeDraw, fit, JUDGED, OVER, PIXEL_CAP } = require('../stage.js');

test('stage: every site frame of a shot maps to a playhead in [0, 1], ends included, and back', () => {
  const film = shots([['a', 3], ['b', 2], ['c', 2]], { hz: 30, frames: 210 });
  const cut = film[1];
  const time = { duration: 2, hz: 24 };
  assert.equal(playheadAt(cut, cut.start, time), 0);
  assert.equal(playheadAt(cut, cut.end - 1, time), 1);
  for (let f = cut.start; f < cut.end; f++) assert.equal(frameOf(cut, playheadAt(cut, f, time), time), f);
  // A still holds its one frame across the whole shot.
  assert.equal(playheadAt(film[2], film[2].start + 5, null), 0);
  assert.equal(frameOf(film[2], 0.7, null), film[2].start);
  // A loop never shows its repeated endpoint.
  const loop = { duration: 2, hz: 30, loop: true };
  assert.ok(playheadAt(cut, cut.end - 1, loop) < 1);
  assert.equal(frameOf(cut, playheadAt(cut, cut.end - 1, loop), loop), cut.end - 1);
});

test('stage: a recipe written from a drawn frame reopens that piece frame', () => {
  const film = shots([['a', 3], ['b', 2]], { hz: 30, frames: 150 });
  for (const time of [{ duration: 3, hz: 24 }, { duration: 3, hz: 30 }, { duration: 3, hz: 60 }]) {
    const piece = { time };
    for (let f = film[0].start; f < film[0].end; f++) {
      const t = playheadAt(film[0], f, time);
      const r = readRecipe(writeRecipe({ shot: 'a', seed: 9, t: frameT(piece, t), params: {} }), ['a', 'b']);
      assert.equal(frameIndex(piece, playheadAt(film[0], frameOf(film[0], r.t, time), time)), frameIndex(piece, t), 'hz ' + time.hz + ', frame ' + f);
    }
  }
});

test('stage: a recipe keeps shot, seed, playhead and parameters, and drops what it cannot read', () => {
  const names = ['rows', 'grid'];
  const r = readRecipe(writeRecipe({ shot: 'grid', seed: 7, t: 0.25, params: { width: 40 } }), names);
  assert.deepEqual(r, { shot: 1, t: 0.25, seed: 7, params: { width: 40 } });
  assert.deepEqual(readRecipe('?shot=nope&seed=-1&t=2&p.width=40', names), { shot: null, t: null, seed: null, params: {} });
  assert.deepEqual(readRecipe('?seed=4294967296', names).seed, null);
  assert.deepEqual(readRecipe('?shot=rows&p.a=x&p.=3&p.b=', names).params, {});
  assert.equal(writeRecipe({ shot: 'rows', seed: 1, t: null, params: {} }), '?shot=rows&seed=1');
});

test('stage: a shot over budget lowers its scale to one device pixel per CSS pixel, then leaves for the worker', () => {
  const slow = Array(JUDGED).fill(40), fast = Array(JUDGED).fill(5);
  assert.equal(lower(1, 3, fast, 29), 1);
  assert.equal(lower(1, 3, slow.slice(1), 29), 1, 'too few draws to judge');
  // Two slow draws in twenty do not lower the scale; three do.
  assert.equal(OVER, 3);
  assert.equal(lower(1, 3, [...fast.slice(2), 40, 40], 29), 1);
  assert.equal(lower(1, 3, [...fast.slice(3), 40, 40, 40], 29), 0.75);
  assert.equal(lower(1, 3, [40, 40, 40, ...fast.slice(3)].concat(fast), 29), 1, 'only the last twenty count');
  let scale = 1;
  const seen = [];
  while (scale > 0) { seen.push(scale); scale = lower(scale, 3, slow, 29); }
  assert.equal(seen[seen.length - 1], 1 / 3);
  assert.ok(seen.every((s, i) => i === 0 || s < seen[i - 1]));
  assert.equal(lower(1, 1, slow, 29), 0, 'at DPR 1 nothing is left to lower');
  assert.equal(p95([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]), 19);
});

// Draws of one shot in one context, as the stage judges them: [ms, warm].
function judgeAll(s, context, draws, dpr = 3) {
  let scale = s.scale;
  for (const [ms, warm = false] of draws) scale = judgeDraw(s, context, ms, warm, dpr, 29);
  return scale;
}

test('stage: a cold draw is not judged: one cold draw and two spikes in twenty do not lower the scale', () => {
  const s = { scale: 1, times: [], context: null };
  const draws = [[600], ...Array(17).fill([5]), [45], [45], [5]];
  assert.equal(judgeAll(s, 'a', draws), 1);
  assert.equal(s.times.length, 20, 'the first draw in a context is left out');
  assert.ok(!s.times.includes(600));
  // A warm-up draw is not judged either, and takes the cold draw on itself.
  const t = { scale: 1, times: [], context: null };
  judgeAll(t, 'b', [[600, true], [5]]);
  assert.deepEqual(t.times, [5]);
});

test('stage: three over-budget draws in twenty lower the scale', () => {
  const s = { scale: 1, times: [], context: null };
  const next = judgeAll(s, 'a', [[5], ...Array(17).fill([5]), [45], [45], [45]]);
  assert.equal(next, 0.75);
  assert.deepEqual(s.times, [], 'a new scale is judged afresh');
});

test('stage: the draw after a scale change is not judged', () => {
  const s = { scale: 1, times: [], context: null };
  s.scale = judgeAll(s, 'scale 1', [[5], ...Array(17).fill([5]), [45], [45], [45]]);
  assert.equal(s.scale, 0.75);
  // The stage draws the same frame again at the new scale: a new context, a cold draw.
  assert.equal(judgeDraw(s, 'scale 0.75', 900, false, 3, 29), 0.75);
  assert.deepEqual(s.times, []);
  assert.equal(judgeDraw(s, 'scale 0.75', 5, false, 3, 29), 0.75);
  assert.deepEqual(s.times, [5]);
});

test('stage: the canvas fits the design box inside the view, centred by the caller, under the pixel cap', () => {
  assert.deepEqual(fit({ w: 1200, h: 800 }, { w: 1280, h: 800 }, 1, 1, PIXEL_CAP), { css: 1, k: 1, w: 1200, h: 800 });
  const phone = fit({ w: 1200, h: 800 }, { w: 390, h: 844 }, 3, 1, PIXEL_CAP);
  assert.equal(phone.w, 1170);
  assert.equal(fit({ w: 1200, h: 800 }, { w: 390, h: 844 }, 3, 1 / 3, PIXEL_CAP).w, 390);
  const huge = fit({ w: 1000, h: 1000 }, { w: 4000, h: 4000 }, 2, 1, PIXEL_CAP);
  assert.ok(huge.w * huge.h <= PIXEL_CAP + 2 * huge.w);
});
