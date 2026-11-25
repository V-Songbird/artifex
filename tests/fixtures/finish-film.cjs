// A small grey-blue frame under grain, a print grade, the deepest flicker and a
// vignette, so tests/film-fixtures.test.js has a piece that declares a finish
// and can check drawFrame applied each part. The ground is a mid tone because
// soft-light grain and colour toning leave white unchanged. It is tiny and one
// second long: only its pixels matter.

'use strict';

module.exports = {
  name: 'finish-film',
  size: { w: 32, h: 18 },
  seed: 1,
  time: { duration: 1, hz: 24 },
  finish: {
    grain: 0.5,
    grade: { black: '#101820', white: '#f0e8d8', tone: '#c08040', toning: 0.3 },
    flicker: 0.025,
    vignette: 0.6,
  },
  draw(g) {
    g.fillStyle = '#8090a0';
    g.fillRect(0, 0, 32, 18);
  },
};
