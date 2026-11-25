'use strict';

// The gallery fixture's demo: the site's bird drawn as rows of dots, with the
// marks of the fixture pack dots.

const { bird } = require('artifex/site/subject.js');
const { rng } = require('artifex/core/rand.js');
const { dotted, dot } = require('./dots/marks.cjs');

const W = 1000; const H = 1000;

function draw(g, state) {
  const R = rng(state.seed);
  const size = state.params.size;
  g.fillStyle = '#f4efe4';
  g.fillRect(0, 0, W, H);
  const b = bird(500, 520, 300);
  for (const part of [b.body, b.wing, b.tail, b.beak, ...b.legs]) dotted(g, part, size, size * 2.2, '#1d2a44');
  dot(g, b.eye[0], b.eye[1], size * 1.6, '#1d2a44');
  for (let i = 0; i < 24; i++) dot(g, 60 + R('spot', 'x', i) * 880, 60 + R('spot', 'y', i) * 120, 2 + R('spot', 'r', i) * 3, '#c84a3a');
}

const params = {
  size: { min: 3, max: 9, value: 5, meaning: 'radius of each dot' },
};

module.exports = { name: 'dots', size: { w: W, h: H }, seed: 1, params, draw };
