'use strict';

// The stage's pure helpers: frames and playheads, recipes, the scale it lowers
// to, the canvas it fits, the flash warning a film export shows, and when a
// soundtrack is heard and from where. Drawing,
// scrolling and the worker need installed Edge: node tools/check-site.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const { shots } = require('../../core/time.js');
const { frameIndex, frameT } = require('../../core/piece.js');
const { playheadAt, frameOf, readRecipe, writeRecipe, boxFor, p95, lower, judgeDraw, fit, filmWarning, onScreen, fold, entry, JUDGED, OVER, PIXEL_CAP, SETTLED_MS, CROSS, LOOP, RING } = require('../stage.js');

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
  assert.deepEqual(r, { shot: 1, t: 0.25, seed: 7, params: { width: 40 }, box: null });
  assert.deepEqual(readRecipe('?shot=nope&seed=-1&t=2&p.width=40&box=10x10', names), { shot: null, t: null, seed: null, params: {}, box: null });
  assert.deepEqual(readRecipe('?seed=4294967296', names).seed, null);
  assert.deepEqual(readRecipe('?shot=rows&p.a=x&p.=3&p.b=', names).params, {});
  assert.equal(writeRecipe({ shot: 'rows', seed: 1, t: null, params: {} }), '?shot=rows&seed=1');
});

test('stage: a recipe carries a box as WxH and reads it back; a box it cannot read is dropped', () => {
  const names = ['rows', 'box'];
  const q = writeRecipe({ shot: 'box', seed: 1, t: 0.5, params: {}, box: { w: 1280, h: 800 } });
  assert.equal(q, '?shot=box&seed=1&t=0.5000&box=1280x800');
  assert.deepEqual(readRecipe(q, names).box, { w: 1280, h: 800 });
  for (const bad of ['1280', '1280x', 'x800', '-5x800', '1.5x800', '999999x2']) assert.equal(readRecipe('?shot=box&box=' + bad, names).box, null, bad);
});

test('stage: a piece with boxes takes the view measured at its design fit, a chosen box instead, held inside its ranges; one without keeps its design box', () => {
  const size = { w: 1200, h: 800 }, boxes = { w: [400, 2400], h: [400, 2800] };
  // The design box keeps its place: one axis is the design's, the other takes the rest of the view.
  assert.deepEqual(boxFor(size, boxes, { w: 1280, h: 800 }, null), { w: 1280, h: 800 });
  assert.deepEqual(boxFor(size, boxes, { w: 1200, h: 800 }, null), { w: 1200, h: 800 });
  assert.deepEqual(boxFor(size, boxes, { w: 390, h: 844 }, null), { w: 1200, h: 2597 });
  assert.deepEqual(boxFor(size, boxes, { w: 1600, h: 700 }, null), { w: 1829, h: 800 });
  // A chosen box stands for the view; either is held inside the ranges.
  assert.deepEqual(boxFor(size, boxes, { w: 1280, h: 800 }, { w: 700, h: 800 }), { w: 700, h: 800 });
  assert.deepEqual(boxFor(size, boxes, { w: 1280, h: 800 }, { w: 100.4, h: 9000 }), { w: 400, h: 2800 });
  assert.deepEqual(boxFor(size, boxes, { w: 5000, h: 800 }, null), { w: 2400, h: 800 });
  assert.equal(boxFor(size, null, { w: 1280, h: 800 }, { w: 700, h: 800 }), null);
  // A dragged box has no height of its own: it takes the window's, and is never wider than the window.
  assert.deepEqual(boxFor(size, boxes, { w: 1280, h: 800 }, { w: 700, h: null }), { w: 700, h: 800 });
  assert.deepEqual(boxFor(size, boxes, { w: 1280, h: 1000 }, { w: 700, h: null }), { w: 700, h: 938 });
  assert.deepEqual(boxFor(size, boxes, { w: 1600, h: 700 }, { w: 1500, h: null }), { w: 1500, h: 800 });
  assert.deepEqual(boxFor(size, boxes, { w: 1280, h: 800 }, { w: 1500, h: null }), { w: 1280, h: 800 });
  // One a recipe names keeps both sides, whatever the window.
  assert.deepEqual(boxFor(size, boxes, { w: 600, h: 1000 }, { w: 700, h: 800 }), { w: 700, h: 800 });
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

test('stage: a film export past three flashes a second says so on the status line, with its file name; one at three says nothing', () => {
  const { flashCounter, flashNote } = require('../../core/flash.js');
  // Two seconds of the whole frame swinging white to black `rate` times a second, at 24 frames a second.
  const counted = (rate) => {
    const counter = flashCounter(32, 24, 24), px = new Uint8ClampedArray(32 * 24 * 4);
    for (let f = 0; f < 48; f++) { px.fill(Math.floor((f * 2 * rate) / 24) % 2 ? 255 : 0); counter.add(px); }
    return counter.result();
  };
  const warned = filmWarning({ name: 'one-1-1920x1080.mp4', flashes: counted(4) }, flashNote);
  assert.match(warned, /^one-1-1920x1080\.mp4: Warning: it flashes 4 times in the second from [\d.]+ s \(brightness, .*more than the three a second WCAG 2\.3\.1 allows/);
  assert.equal(filmWarning({ name: 'one-1.webm', flashes: counted(3) }, flashNote), '');
});

test('stage: a fade is made faster if asked and never slower, and the ambience sounding gives way over CROSS, one already fading over the short ramp', () => {
  const { fadeEnd, giveWay } = require('../stage.js');
  assert.equal(fadeEnd(false, undefined, 10, 1), 11, 'a voice not fading is gone after the fade');
  assert.equal(fadeEnd(true, 12, 10, 1), 11, 'one fading slowly is made faster');
  assert.equal(fadeEnd(true, 10.5, 10, 1), null, 'one gone sooner keeps its end');
  assert.equal(fadeEnd(true, 11, 10, 1), null, 'and one gone just then');
  assert.equal(giveWay(false), CROSS);
  assert.ok(giveWay(true) < CROSS && giveWay(true) > 0, 'a second crossfade is short: ' + giveWay(true));
});

test('stage: a film export whose frames are drawn again says so in the status line, with the reason, and nothing while drawn once', () => {
  const { restartNote } = require('../stage.js');
  assert.equal(restartNote('fold', 12, 300, null), '');
  assert.equal(restartNote('fold', 12, 300, 'drawn again from the first frame: the encoder failed'), 'fold: frame 12 of 300, drawn again from the first frame: the encoder failed');
});

test('stage: scrolled, a shot settles once it has been on screen SETTLED_MS, whatever the scroll did meanwhile', () => {
  let seen = onScreen(null, 3, 1000);
  assert.deepEqual(seen, { i: 3, since: 1000, settled: false });
  // Scrolled fast, back, or not at all: the same shot keeps its time on screen.
  seen = onScreen(seen, 3, 1000 + SETTLED_MS - 1);
  assert.equal(seen.settled, false);
  seen = onScreen(seen, 3, 1000 + SETTLED_MS);
  assert.ok(seen.settled && seen.since === 1000);
  // Another shot starts its own time, and one passed through quickly never settles.
  seen = onScreen(seen, 4, 1500);
  assert.deepEqual(seen, { i: 4, since: 1500, settled: false });
  seen = onScreen(seen, 3, 1600);
  assert.deepEqual(seen, { i: 3, since: 1600, settled: false });
  assert.ok(CROSS >= 0.5 && CROSS <= 2, 'one ambience crossfades into the next over about a second');
});

test('stage: an ambience rendered past its loop folds its ring back onto its start, so it repeats without a seam', () => {
  // A decaying ring that crosses the loop's end: folded, the loop's last sample leads into its first as the ring ran on.
  const n = 100, ring = 60, data = new Float32Array(n + ring);
  for (let i = 0; i < n + ring; i++) data[i] = i >= 80 ? Math.exp(-(i - 80) / 20) : 0;
  data[5] = 0.25;
  const out = fold(data, n);
  assert.equal(out.length, n);
  assert.equal(out[99], data[99]);
  assert.equal(out[0], data[100]);
  assert.equal(out[5], Math.fround(0.25 + data[105]));
  assert.equal(out[59], data[159]);
  assert.equal(out[60], 0);
  // Nothing is lost: the loop holds the whole render.
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum(out) - sum(data)) < 1e-5);
  assert.ok(RING < LOOP, 'the ring folds onto the loop once');
});

test('stage: played as film, each soundtrack starts at its own second of the film, and one reached late starts where the film is', () => {
  const film = shots([['a', 2], ['b', 3]], { hz: 30, frames: 150 });
  // The film plays site frame 45 (a second and a half into a) at audio time 10.
  assert.deepEqual(entry(film[0], 45, 10, 30, 9.9), { when: 10, offset: 1.5 });
  const b = entry(film[1], 45, 10, 30, 9.9);
  assert.ok(Math.abs(b.when - 10.5) < 1e-12 && b.offset === 0);
  // Its soundtrack was rendered only at audio time 11: it starts then, half a second in.
  const late = entry(film[1], 45, 10, 30, 11);
  assert.ok(late.when === 11 && Math.abs(late.offset - 0.5) < 1e-12);
});

test('stage: a still asked for a film is refused in the export\'s own words, under the stage\'s tag and the shot\'s name', () => {
  const { refusal } = require('../stage.js');
  const { stillFilmRefusal } = require('../../core/film.js');
  assert.equal(refusal('intro', stillFilmRefusal({ outputs: ['raster'] })),
    'stage: intro: this piece is a still: it declares no timeline, so it has no film. Export PNG, or give the piece a time field to make it a film.');
  assert.match(refusal('cad', stillFilmRefusal({ outputs: ['raster', 'vector'] })), /^stage: cad: .*Export PNG or SVG, /);
});

test('stage: the sound cache drops the oldest settled render, never one in flight, and forgets a failed one for the next approach', () => {
  const { evict, forget } = require('../stage.js');
  const cache = new Map([['a', { buffer: null }], ['b', { buffer: {} }], ['c', { buffer: null, failed: true }], ['d', { buffer: {} }], ['e', { buffer: null }]]);
  evict(cache, 4);
  assert.deepEqual([...cache.keys()], ['a', 'c', 'd', 'e'], 'the oldest is still rendering, so the oldest rendered goes');
  evict(cache, 2);
  assert.deepEqual([...cache.keys()], ['a', 'e'], 'failed and rendered go, oldest first');
  evict(cache, 1);
  assert.deepEqual([...cache.keys()], ['a', 'e'], 'two in flight stay, over the bound, until one settles');
  const kept = new Map([['a', { buffer: {} }], ['b', { buffer: null, failed: true }], ['c', { buffer: null }]]);
  forget(kept);
  assert.deepEqual([...kept.keys()], ['a', 'c'], 'only the failed render is dropped');
});
