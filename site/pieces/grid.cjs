// Placeholder seam: columns cross the ruled rows, and the cells they make fill.
'use strict';

const L = require('./lattice.js');
const { span } = require('../../core/time.js');

module.exports = {
  name: 'site-grid',
  size: { w: L.W, h: L.H },
  seed: 1,
  time: { duration: 2, hz: 30 },
  build: [['lattice', L.solveLattice]],
  draw(g, s, t) {
    L.ground(g);
    L.fills(g, s, span(0.55, 1, t));
    L.rows(g, s, 1);
    L.cols(g, s, span(0, 0.55, t));
  },
};
