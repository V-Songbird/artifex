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
