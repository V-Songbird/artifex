'use strict';

// The site check's pure helpers. The walk itself needs installed Edge:
// node tools/check-site.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const { countDraws } = require('../../tools/check-site.js');

const at = (shot, frame, scale = 1) => ({ shot, frame, seed: 1, scale });

test('site check: a redraw of a frame after a scale change is counted apart, once per change', () => {
  assert.deepEqual(countDraws([at(0, 0), at(0, 1), at(1, 0)]), { distinct: 3, redraws: 0, extra: 0 });
  // Lowered on frame 1: the same frame again at the new scale is the one redraw it allows.
  assert.deepEqual(countDraws([at(0, 0), at(0, 1), at(0, 1, 0.75), at(0, 2, 0.75)]), { distinct: 3, redraws: 1, extra: 0 });
  // A second draw of it at that scale is a duplicate.
  assert.deepEqual(countDraws([at(0, 1), at(0, 1, 0.75), at(0, 1, 0.75)]), { distinct: 1, redraws: 1, extra: 1 });
  // So is a draw of a frame already drawn, at the same scale, or after other frames.
  assert.deepEqual(countDraws([at(0, 1), at(0, 1)]), { distinct: 1, redraws: 0, extra: 1 });
  assert.deepEqual(countDraws([at(0, 1), at(0, 2), at(0, 1, 0.75)]), { distinct: 2, redraws: 0, extra: 1 });
  // Two lowerings on one frame allow two redraws.
  assert.deepEqual(countDraws([at(0, 4), at(0, 4, 0.75), at(0, 4, 0.563)]), { distinct: 1, redraws: 2, extra: 0 });
});

test('site check: the measuring sink must show a heavy frame\'s rasterization, or the check fails', () => {
  const { sinkWaits } = require('../../tools/check-site.js');
  const times = (none, forced, copied) => ({ none: [none, none + 1, none - 0.1], forced: [forced, forced + 1, forced - 0.1], copied: [copied, copied + 1, copied - 0.1] });
  // A sink that waits: forced near the whole-frame copy, far over the calls alone.
  assert.equal(sinkWaits(times(0.4, 43.5, 49.6)).failure, undefined);
  assert.deepEqual(sinkWaits(times(0.4, 43.5, 49.6)), { noneMs: 0.4, forcedMs: 43.5, copiedMs: 49.6 });
  // One that stopped waiting measures the calls alone.
  assert.match(sinkWaits(times(0.4, 0.6, 49.6)).failure, /does not wait for rasterization/);
  // Under half the copy fails, even when well over the calls.
  assert.match(sinkWaits(times(0.4, 20, 49.6)).failure, /does not wait/);
  // A frame too light to tell (forced under three times the calls) fails rather than passing.
  assert.match(sinkWaits(times(2, 5, 6)).failure, /does not wait/);
});
