// The showcase site's demo of Light painting: the songbird staged in one
// scene, drawn with the marks of skills/artifex/styles/light-painting.js.
// Site-only, never a starting point for a piece. The bird is traced part by
// part with a hand light, a spiral of song rising from its beak, beside spun
// steel wool and an orb, over wet ground that mirrors every light.

'use strict';

const { rng } = require('../../core/rand.js');
const font = require('../../core/stroke-font.js');
const { mix } = require('../../core/colour.js');
const { bird } = require('./subject.js');
const { wobble, caption } = require('../../skills/artifex/styles/kit.js');
const { lights, trail, hand, spot, spiral, sparks, orb, mirrorY, reflect, ripple, within, night, stars, skyline, fade } = require('../../skills/artifex/styles/light-painting.js');

const W = 1000; const H = 1000;
const GROUND = 720;

function draw(g, s) {
  const R = rng(s.seed);

  night(g, W, H, GROUND);
  stars(g, R, 'star', W, GROUND - 160);
  skyline(g, R, 'trees', W, GROUND);

  // Steel wool in the far corner, and an orb on the right.
  const WOOL = [175, 205, 165];
  const ORB = [838, 574, 96];
  const L = lights(g, W, H);
  sparks(g, R, 'spark', ...WOOL, 380);
  orb(L, R, 'ripple', ...ORB, '#4fd1ff');

  // The subject, traced with a hand light: each part one closed loop.
  const b = bird(548, 420, 258, -0.06);
  const hue = (t) => mix(mix('#ff3d7f', '#ffb13d', Math.min(1, t * 2)), '#ff5ad1', Math.max(0, t * 2 - 1));
  const parts = [
    [hand(R, 'body', b.body), hue],
    [hand(R, 'beak', b.beak), () => '#ffb13d'],
    [hand(R, 'wing', b.wing), (t) => mix('#ffd23d', '#ff8a3d', t)],
    [hand(R, 'tail', b.tail), (t) => mix('#40e0ff', '#6f7bff', t)],
  ];
  for (const [line, colour] of parts) trail(L, line, 5, colour);
  // Where the light was held still it burns into a spot: the eye.
  spot(g, b.eye[0], b.eye[1]);
  // Legs to the ground, where the light touched down.
  const legs = b.legs.map((leg, i) => hand(R, 'leg' + i, [leg[0], [leg[1][0] + 10 * i, GROUND - 4]], { close: false, amp: 1.5, step: 12 }));
  for (const leg of legs) trail(L, leg, 3, () => '#40e0ff', 0.8);
  // Song: a second light from the beak, rising in widening loops.
  const beak = b.at([[1.04, -0.34]])[0];
  const songHue = (t) => mix('#b77dff', '#6effc8', t);
  const songLine = wobble(spiral(beak[0] + 14, beak[1] - 20), R, 'song', 1.6, 8);
  trail(L, songLine, 2.4, songHue, 0.9);

  // The wet ground: everything above, mirrored, dimmer and rippled.
  const rip = (pts) => ripple(R, 'ripple', reflect(pts, GROUND));
  within(L, [0, GROUND, W, H - GROUND], () => {
    for (const [line, colour] of parts) trail(L, rip(line), 5, colour, 0.35);
    for (const leg of legs) trail(L, rip(leg), 3, () => '#40e0ff', 0.3);
    trail(L, rip(songLine), 2.4, songHue, 0.3);
    sparks(g, R, 'spark', ...WOOL, 380, 0.3, mirrorY(GROUND));
    orb(L, R, 'ripple', ...ORB, '#4fd1ff', 0.4, mirrorY(GROUND));
  });
  L.add();
  fade(g, W, 880, 985, H);

  // Centred, clear of the steel wool's reflection in the corner.
  const label = 'LIGHT PAINTING';
  caption(g, label, font, 'rgba(230, 230, 255, 0.7)', (W - font.width(label, 14)) / 2);
}

module.exports = { name: 'light-painting', size: { w: 1000, h: 1000 }, seed: 2026, draw };
