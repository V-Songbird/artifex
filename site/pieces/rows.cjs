// Placeholder shot: a pen rules rows across the page, one after another.
'use strict';

const L = require('./lattice.js');

module.exports = {
  name: 'site-rows',
  size: { w: L.W, h: L.H },
  seed: 1,
  time: { duration: 3, hz: 30 },
  build: [['lattice', L.solveLattice]],
  draw(g, s, t) {
    L.ground(g);
    L.rows(g, s, t);
  },
};
