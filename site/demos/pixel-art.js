// The showcase site's demo of Pixel art: the songbird staged in one scene,
// drawn with the marks of skills/artifex/styles/pixel-art.js. Site-only, never
// a starting point for a piece. A night lake under the moon on a 100-pixel
// grid, and the bird on a blossom branch, singing one note.

'use strict';

const { rng, noise2 } = require('../../core/rand.js');
const { pointInPoly } = require('../../core/geom.js');
const font = require('../../core/stroke-font.js');
const { caption } = require('../../skills/artifex/styles/kit.js');
const {
  dither, tri, grid, ramp, disc, ball, halo, twinkle, lump, ridge, inEllipse, mask, light, step, rim, sprite, stamp, mirror, emit,
} = require('../../skills/artifex/styles/pixel-art.js');

const N = 100; const P = 10;
const NIGHT_SKY = ['#1a1433', '#221a44', '#2c2156', '#382868', '#473079', '#5a3a86', '#6f448f', '#875096', '#a25e9a', '#bf6e9b', '#dc849a'];
const NIGHT = {
  star: '#fdf0c8', starDim: '#a99ad8', moon: '#fbeecb', moonShade: '#e5cf97', crater: '#dcc186',
  cloud: '#4d3d7d', cloudLight: '#6a58a0', cloudDark: '#3a2e63',
  far: '#3b2f6b', farRim: '#54448f', snow: '#8f80c6', hill: '#2a2350', hillRim: '#3b3272',
  pine: '#1c1838', pineLight: '#2b2654', water: '#1f1942', waterLine: '#332a66', glint: '#f4dca0', glintDim: '#b89a74',
  ground: '#15112b', grass: '#27384a', grassLight: '#35505c', flowerA: '#f2a0b4', flowerB: '#fdf0c8',
  branch: '#3b2336', branchLight: '#5c3a4d', branchDark: '#23141f',
  leaf: '#2b5747', leafLight: '#3f7a5c', leafDark: '#1c3a31', blossom: '#f1a3b8', blossomLight: '#fbd0dc',
  outline: '#1b1026', body: '#fbf4e6', bodyLight: '#ffffff', bodyShade: '#e2d0bf', bodyDeep: '#c4ad9c',
  wing: '#ee7a63', wingLight: '#ff9d85', wingShade: '#c65a4f', beak: '#f6a63b', beakShade: '#d27f27',
  eye: '#1b1026', cheek: '#f59aa0', leg: '#d27f27', note: '#fdf0c8', firefly: '#fff3a0', fireflyDim: '#8f8450',
};
// The seed picks an hour, each a sky ramp and the colours that change with it,
// and a plumage for the wing and tail.
const HOURS = [
  {},
  {
    sky: ['#2a1b3d', '#3b2350', '#552c5e', '#73366a', '#944273', '#b44f73', '#d0606f', '#e5776a', '#f09366', '#f6ad66', '#fbc874'],
    cloud: '#7a3f6e', cloudLight: '#b45f7c', cloudDark: '#55305c', far: '#4a2c5c', farRim: '#6b3f74', snow: '#b07fa0',
    hill: '#2e1f45', hillRim: '#4a2f5f', pine: '#1d1530', pineLight: '#2e2147', water: '#2a1d45', waterLine: '#4f3468',
    glint: '#fbc874', glintDim: '#c0806a', ground: '#170f26', moon: '#fde6b0', moonShade: '#f2c27e', crater: '#e8b072',
  },
  {
    sky: ['#0b1630', '#0f1d3d', '#14264c', '#1a305b', '#213b69', '#2a4877', '#345683', '#40648e', '#4e7398', '#5e82a0', '#7092a8'],
    cloud: '#2c4366', cloudLight: '#45608a', cloudDark: '#1f3150', far: '#24365c', farRim: '#3a5480', snow: '#a9bedc',
    hill: '#18243f', hillRim: '#26375a', pine: '#0f172b', pineLight: '#1b2742', water: '#122040', waterLine: '#25395f',
    glint: '#eef2ff', glintDim: '#8fa3c8', ground: '#0b1222', moon: '#f3f5ff', moonShade: '#c9d2ec', crater: '#b3bedc', starDim: '#8ea4d8',
  },
];
const PLUMES = [
  {},
  { wing: '#4fb3a6', wingLight: '#86dccb', wingShade: '#2f8a83' },
  { wing: '#5b86e0', wingLight: '#8fb1ff', wingShade: '#3a5eb0' },
  { wing: '#e8b23c', wingLight: '#ffd87a', wingShade: '#b8802a' },
];

// The bird as a sprite: shapes rasterised at pixel centres, then shaded in
// steps from a light at the top left, then outlined where it meets nothing.
function birdSprite(C) {
  const tail = [[8, 10], [1, 3.5], [0, 6], [2.5, 8.5], [7.5, 14]];
  const beak = [[25.2, 6.2], [29.8, 8.2], [25.2, 10.2]];
  const m = mask(30, 22, (px, py) => {
    let k = null;
    if (pointInPoly([px, py], tail)) k = 'tail';
    if (inEllipse(px, py, 14, 13.5, 9.5, 6.8) || inEllipse(px, py, 21, 7.5, 5.5, 5.2)) k = 'body';
    if (inEllipse(px, py, 12.5, 12.5, 7.2, 3.6, -0.35)) k = 'wing';
    if (pointInPoly([px, py], beak)) k = 'beak';
    return k;
  });
  for (const [x, y] of [[12, 20], [12, 21], [16, 20], [16, 21], [11, 21], [13, 21], [15, 21], [17, 21]]) m[y][x] = 'leg';
  const is = (x, y, k) => y >= 0 && y < m.length && m[y][x] === k;
  const out = sprite(m, (k, x, y) => {
    if (k === 'body') {
      const head = x > 16 && y < 10;
      const t = head ? light(x, y, 21, 7.5, 6, 6) : light(x, y, 14, 11, 10, 8);
      return step(t, [C.bodyLight, C.body, C.bodyShade, C.bodyDeep]);
    }
    if (k === 'wing') {
      if ((x + y) % 5 === 0 && is(x, y - 1, 'wing') && is(x, y + 1, 'wing')) return C.wingShade;
      return rim(m, x, y, C.wingLight, C.wing, C.wingShade);
    }
    if (k === 'tail') return rim(m, x, y, C.wing, C.wingShade, C.wingShade);
    if (k === 'beak') return is(x, y + 1, 'beak') ? C.beak : C.beakShade;
    return C.leg;
  }, C.outline);
  // Eye with its highlight, and a blush under it.
  out[5][22] = C.bodyLight; out[5][23] = C.eye; out[6][22] = C.eye; out[6][23] = C.eye;
  out[9][23] = C.cheek; out[9][24] = C.cheek;
  return out;
}

function draw(g, s) {
  const R = rng(s.seed);
  const glow = (s.params && s.params.halo) ?? 3;
  // The seed picks the hour, the plumage, where the moon stands and which
  // way the scene faces.
  const hour = HOURS[Math.floor(R('look', 'hour') * HOURS.length)];
  const C = { ...NIGHT, ...hour, ...PLUMES[Math.floor(R('look', 'plume') * PLUMES.length)] };
  const SKY = hour.sky || NIGHT_SKY;
  const G = grid(N, N, C.ground);
  const { put, get } = G;

  // Sky and stars.
  ramp(G, 0, 0, N, 72, SKY);
  for (let i = 0; i < (hour.sky === undefined ? 60 : 30); i++) {
    const x = Math.floor(R('star', 'x', i) * N); const y = Math.floor(R('star', 'y', i) * 46);
    put(x, y, R('star', 'b', i) < 0.35 ? C.star : C.starDim);
  }
  for (let i = 0; i < 5; i++) {
    twinkle(G, 4 + Math.floor(R('twinkle', 'x', i) * 90), 3 + Math.floor(R('twinkle', 'y', i) * 34), C.star, C.starDim);
  }

  // Moon with a dithered halo and craters.
  const mx = 66 + Math.floor(R('moon', 'x') * 21); const my = 12 + Math.floor(R('moon', 'y') * 7); const mr = 8;
  ball(G, mx, my, mr, C.moon, C.moonShade);
  halo(G, mx, my, mr, glow, (x, y) => SKY[Math.min(SKY.length - 1, Math.floor((y / 71) * (SKY.length - 1)) + 3)]);
  for (const [cx, cy, r] of [[mx - 2.5, my - 1.5, 1.6], [mx + 3, my + 3, 1.3], [mx + 2, my - 5, 1]]) disc(G, cx, cy, r, C.crater);

  // Clouds: circles with a flat base, lit on top, shaded underneath.
  for (const cloud of [
    [[64, 27, 3.5], [69, 25, 4.5], [74, 26, 4], [78, 28, 3]],
    [[13, 17, 3], [18, 15, 4], [23, 17, 3.5]],
    [[37, 35, 2.5], [42, 33, 3.5], [47, 35, 3]],
  ]) lump(G, cloud, C.cloudLight, C.cloud, C.cloudDark);

  // Far mountains, then hills with pines.
  const ridgeFar = (x) => Math.round(58 - 8 * tri(x / 21 + 0.3) - 4 * tri(x / 9 + 0.7) - 2 * noise2(R, x / 6, 0.5, 'far'));
  const ridgeMid = (x) => Math.round(65 - 3 * noise2(R, x / 13, 2.5, 'mid') - 1.5 * tri(x / 17));
  ridge(G, 0, N, ridgeFar, 72, C.far, C.farRim, { cap: C.snow, capLine: 50 });
  ridge(G, 0, N, ridgeMid, 72, C.hill, C.hillRim);
  for (const [x0, h] of [[6, 7], [11, 10], [19, 6], [33, 8], [52, 9], [60, 6], [88, 10], [94, 7]]) {
    const base = ridgeMid(x0);
    for (let r = 0; r < h; r++) {
      const half = Math.floor((r + 1) / 2);
      for (let dx = -half; dx <= half; dx++) put(x0 + dx, base - h + r, dx > 0 ? C.pineLight : C.pine);
    }
    put(x0, base, C.pine);
  }

  // Lake: reflected ridge near the shore, drifting lines, the moon's glint.
  for (let y = 72; y < 89; y++) {
    for (let x = 0; x < N; x++) put(x, y, y < 74 && dither(x, y, 0.5) ? C.hill : C.water);
    for (let k = 0; k < 3; k++) {
      const x0 = Math.floor(R('ripple', 'x', y * 7 + k) * 92); const len = 3 + Math.floor(R('ripple', 'l', y * 7 + k) * 6);
      for (let x = x0; x < x0 + len; x++) put(x, y, C.waterLine);
    }
    if (y % 2 === 0) {
      const half = Math.max(1, 5 - Math.floor((y - 72) / 3));
      for (let dx = -half; dx <= half; dx++) put(mx + dx, y, Math.abs(dx) === half ? C.glintDim : C.glint);
    }
  }

  // Shore, grass, flowers.
  for (let x = 0; x < N; x++) {
    const tall = 1 + Math.floor(R('grass', 'h', x) * 3);
    for (let k = 0; k < tall; k++) put(x, 89 - k, (x + k) % 3 === 0 ? C.grassLight : C.grass);
  }
  for (let i = 0; i < 9; i++) {
    const x = 3 + Math.floor(R('flower', 'x', i) * 94);
    put(x, 86, i % 2 ? C.flowerA : C.flowerB);
    put(x, 87, C.grassLight);
  }
  // The branch, its leaves and blossom.
  const branchY = (x) => Math.round(70 - 13 * Math.pow(x / 64, 1.2));
  for (let x = 0; x <= 64; x++) {
    const y = branchY(x); const thick = x < 30 ? 3 : 2;
    for (let k = 0; k < thick; k++) put(x, y + k, k === 0 ? C.branchLight : k === thick - 1 ? C.branchDark : C.branch);
  }
  for (let k = 0; k < 8; k++) put(48 + k, 60 - k, C.branch);
  for (const [cx, cy] of [[8, 66], [20, 64], [44, 58], [57, 52], [63, 56]]) {
    for (let y = cy - 3; y <= cy + 3; y++) {
      for (let x = cx - 3; x <= cx + 3; x++) {
        const dx = x + 0.5 - cx; const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy * 1.4 > 8.5) continue;
        put(x, y, dx + dy < -2 ? C.leafLight : dx + dy > 2 ? C.leafDark : C.leaf);
      }
    }
    put(cx + 1, cy - 1, C.blossom); put(cx + 2, cy - 1, C.blossom); put(cx + 1, cy - 2, C.blossomLight);
  }

  // The bird, and the note it sings.
  stamp(G, birdSprite(C), 26, 40);

  // Fireflies.
  for (const [x, y] of [[12, 77], [31, 80], [55, 75], [86, 79], [92, 69], [70, 66]]) {
    put(x, y, C.firefly);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (get(x + dx, y + dy) !== C.glint) put(x + dx, y + dy, C.fireflyDim);
    put(x, y, C.firefly);
  }

  // Half the seeds face the other way. The note is drawn after, so it reads,
  // and the reeds, so they frame the near corner away from the caption.
  const flip = R('look', 'face') >= 0.5;
  if (flip) mirror(G);
  for (let i = 0; i < 9; i++) {
    const x = 84 + Math.floor(R('reed', 'x', i) * 15); const h = 7 + Math.floor(R('reed', 'h', i) * 11);
    for (let k = 0; k < h; k++) put(x, 99 - k, k === h - 1 ? C.grassLight : C.grass);
    if (i % 3 === 0) for (let k = 0; k < 3; k++) put(x, 99 - h + k, C.branch);
  }
  const NOTE = ['...##', '...###', '...#.##', '...#..#', '...#', '.###', '####', '####', '.##'];
  NOTE.forEach((row, y) => [...row].forEach((c, x) => { if (c === '#') put((flip ? N - 67 : 60) + x, 31 + y, C.note); }));

  emit(g, G, P);
  caption(g, 'PIXEL', font, 'rgba(253, 240, 200, 0.85)', 40, 955);
}

module.exports = {
  name: 'pixel-art', size: { w: 1000, h: 1000 }, seed: 2026,
  params: { halo: { min: 1, max: 8, value: 3, meaning: 'Width in cells of the moon\'s dithered halo: low rings the moon with a thin glow, high spreads a wide Bayer haze' } },
  draw,
};
