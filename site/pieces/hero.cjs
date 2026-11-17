// The product page's hero: the intro's plotter writing the name on its paper,
// with two declared parameters the visitor moves with the pointer, how wide
// the pen's line is and how far the paper soaks the ink in. Each move is a new
// solve; the paper, which only the seed decides, is kept once per seed.

'use strict';

const { hold } = require('./held.js');
const P = require('./paper.js');
const M = require('./wordmark.js');

// The first solve of each seed, whose paper every later solve of that seed puts back.
const papers = new Map();

module.exports = {
  name: 'site-hero',
  size: { w: P.W, h: P.H },
  seed: 1,
  time: { duration: M.DURATION, hz: 30 },
  params: {
    weight: { min: 0.5, max: 2.4, value: 1, meaning: "how wide the pen's line is" },
    soak: { min: 0, max: 2.5, value: 1, meaning: 'how far the paper soaks the ink in around each line' },
  },
  build: [
    ['lay the paper', P.lay],
    ['plot the wordmark', M.plot],
  ],
  draw(g, s, t, clock) {
    if (!papers.has(s.seed)) papers.set(s.seed, s);
    hold(g, papers.get(s.seed), 'paper', P.ground);
    M.drawWord(g, s, clock.seconds);
  },
};
