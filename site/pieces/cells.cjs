// Placeholder still: the finished grid, drawn off the main thread where the
// browser allows it.
'use strict';

const L = require('./lattice.js');

module.exports = {
  name: 'site-cells',
  size: { w: L.W, h: L.H },
  seed: 1,
  build: [['lattice', L.solveLattice]],
  draw(g, s) {
    L.ground(g);
    L.fills(g, s, 1);
    L.rows(g, s, 1);
    L.cols(g, s, 1);
  },
};
