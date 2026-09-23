// The gallery's demo subject: a small songbird, so every style can be
// compared on one drawing. Swap these outlines for any other subject.
// Unit coordinates, facing right, y down; the bird is about 2.1 units long.

'use strict';

const { chaikin } = require('../../../core/geom.js');
const { place } = require('./kit.js');

const BODY = [[0.70, -0.42], [0.60, -0.60], [0.42, -0.68], [0.22, -0.60], [0.10, -0.42],
  [-0.18, -0.30], [-0.48, -0.14], [-0.64, 0.02], [-0.58, 0.16], [-0.38, 0.34],
  [-0.04, 0.46], [0.34, 0.38], [0.60, 0.12], [0.72, -0.16], [0.76, -0.32]];
const WING = [[0.28, -0.16], [0.08, -0.30], [-0.26, -0.26], [-0.66, -0.26],
  [-0.40, -0.06], [-0.02, 0.10], [0.24, 0.04]];
const TAIL = [[-0.54, -0.06], [-0.98, -0.44], [-1.08, -0.30], [-1.06, -0.16], [-0.58, 0.10]];
const BEAK = [[0.70, -0.44], [1.00, -0.34], [0.72, -0.25]];
const LEGS = [[[0.02, 0.44], [-0.02, 0.68]], [[0.20, 0.42], [0.20, 0.68]]];

// Every part, placed at (x, y) with scale s. Smoothing happens in unit
// space so each style gets the same silhouette.
function bird(x, y, s, rot = 0, flip = false) {
  const at = (pts) => place(pts, x, y, s, rot, flip);
  return {
    body: at(chaikin(BODY, 3, true)),
    wing: at(chaikin(WING, 2, true)),
    tail: at(chaikin(TAIL, 1, true)),
    beak: at(BEAK),
    eye: at([[0.50, -0.46]])[0],
    cheek: at([[0.50, -0.27]])[0],
    legs: LEGS.map(at),
    at,
    s,
  };
}

module.exports = { bird };
