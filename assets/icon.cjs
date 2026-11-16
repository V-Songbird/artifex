// The Artifex icon: the site's songbird as one bold mark, made to be read at
// 48 pixels as well as at 1024. assets/icon.png and assets/icon.svg are this
// piece at seed 1; from the repository root, draw them again with
//   npm run still -- assets/icon.cjs --out assets/icon.png
//   npm run still -- assets/icon.cjs --out assets/icon.svg
//
// What an icon needs, and so what this drawing does:
// - one silhouette that fills the tile: the bird is fitted to FILL of the
//   square whatever its tilt, on a disc that gives the square a centre;
// - few flat colours and no outline: body, wing, tail, beak and eye are each
//   one fill, so nothing thinner than a few pixels is left at small sizes;
// - no legs, no text, no scene: they turn to noise below 64 pixels;
// - a full-bleed ground: a host may mask the tile to a circle or a rounded
//   square, and the disc and the bird stay inside both.
//
// Fills only, so the same drawing saves as SVG.

'use strict';

const { bird } = require('../site/demos/subject.js');
const { path, ellipse } = require('artifex/styles/kit.js');
const { intersection } = require('artifex/core/clip.js');

const S = 1024;
const TILT = -0.3;      // the bird looks up, which also fills more of a square than a level bird
const FILL = 0.8;       // the bird's larger side, as a share of the tile
const DISC = 0.415;     // the disc's radius, as a share of the tile

// A cream bird in a night sky, its wing and tail coral: the palette of the site's papercraft bird.
const GROUND = '#161f4a', SKY = '#26357c', BODY = '#f7f0dd', BELLY = '#ffffff';
const WING = '#f0705a', TAIL = '#cf5340', BEAK = '#f5b02e', CHEEK = '#f2a09c';

const boxOf = (rings) => {
  const xs = rings.flatMap((r) => r.map((p) => p[0])), ys = rings.flatMap((r) => r.map((p) => p[1]));
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};

/** Build stage: the bird tilted, scaled to FILL of the tile and centred on it. */
function pose(s) {
  const unit = bird(0, 0, 1, TILT);
  const [x0, y0, x1, y1] = boxOf([unit.body, unit.wing, unit.tail, unit.beak]);
  const k = FILL * S / Math.max(x1 - x0, y1 - y0);
  s.bird = bird(S / 2 - k * (x0 + x1) / 2, S / 2 - k * (y0 + y1) / 2, k, TILT);
  // The belly's lighter tone, cut to the body so it needs no clip.
  s.belly = intersection([s.bird.body], [s.bird.at(ellipse(0.24, 0.2, 0.44, 0.28))]);
}

function draw(g, s) {
  const b = s.bird;
  const fill = (colour, pts) => { g.fillStyle = colour; path(g, pts); g.fill(); };
  g.fillStyle = GROUND;
  g.fillRect(0, 0, S, S);
  fill(SKY, ellipse(S / 2, S / 2, DISC * S, DISC * S, 96));
  fill(TAIL, b.tail);
  fill(BODY, b.body);
  for (const ring of s.belly) fill(BELLY, ring);
  fill(WING, b.wing);
  fill(BEAK, b.beak);
  fill(CHEEK, ellipse(b.cheek[0], b.cheek[1], 0.09 * b.s, 0.06 * b.s, 32, TILT));
  fill(GROUND, ellipse(b.eye[0], b.eye[1], 0.085 * b.s, 0.085 * b.s, 32));
  fill('#ffffff', ellipse(b.eye[0] + 0.03 * b.s, b.eye[1] - 0.03 * b.s, 0.028 * b.s, 0.028 * b.s, 16));
}

module.exports = {
  name: 'artifex-icon',
  size: { w: S, h: S },
  seed: 1,
  outputs: ['raster', 'vector'],
  state: () => ({ bird: null, belly: null }),
  build: [['pose the bird', pose]],
  draw,
};
