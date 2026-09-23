// Pixel: 2D pixel art on a 100-pixel grid, made the way a sprite artist
// works: one small palette, hard edges, ordered dithering in the sky and the
// water, dark outlines and stepped shading. A night lake under the moon, and
// the bird on a blossom branch, singing one note.

'use strict';

const { rng, noise2 } = require('../../../core/rand.js');
const { pointInPoly } = require('../../../core/geom.js');
const font = require('../../../core/stroke-font.js');
const { caption } = require('./kit.js');

const N = 100; const P = 10;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const SKY = ['#1a1433', '#221a44', '#2c2156', '#382868', '#473079', '#5a3a86', '#6f448f', '#875096', '#a25e9a', '#bf6e9b', '#dc849a'];
const C = {
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

const tri = (u) => 1 - 2 * Math.abs(u - Math.floor(u) - 0.5);

// The bird as a sprite: shapes rasterised at pixel centres, then shaded in
// steps from a light at the top left, then outlined where it meets nothing.
function sprite() {
  const w = 30; const h = 22;
  const m = Array.from({ length: h }, () => new Array(w).fill(null));
  const inE = (x, y, cx, cy, rx, ry, rot = 0) => {
    const c = Math.cos(rot); const s = Math.sin(rot); const dx = x - cx; const dy = y - cy;
    const u = (c * dx + s * dy) / rx; const v = (-s * dx + c * dy) / ry;
    return u * u + v * v <= 1;
  };
  const tail = [[8, 10], [1, 3.5], [0, 6], [2.5, 8.5], [7.5, 14]];
  const beak = [[25.2, 6.2], [29.8, 8.2], [25.2, 10.2]];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5; const py = y + 0.5;
      if (pointInPoly([px, py], tail)) m[y][x] = 'tail';
      if (inE(px, py, 14, 13.5, 9.5, 6.8) || inE(px, py, 21, 7.5, 5.5, 5.2)) m[y][x] = 'body';
      if (inE(px, py, 12.5, 12.5, 7.2, 3.6, -0.35)) m[y][x] = 'wing';
      if (pointInPoly([px, py], beak)) m[y][x] = 'beak';
    }
  }
  for (const [x, y] of [[12, 20], [12, 21], [16, 20], [16, 21], [11, 21], [13, 21], [15, 21], [17, 21]]) m[y][x] = 'leg';
  const is = (x, y, k) => y >= 0 && y < h && x >= 0 && x < w && m[y][x] === k;
  const out = Array.from({ length: h }, () => new Array(w).fill(null));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = m[y][x];
      if (!k) {
        const touch = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => (m[y + dy] || [])[x + dx]);
        if (touch) out[y][x] = C.outline;
        continue;
      }
      if (k === 'body') {
        const head = x > 16 && y < 10;
        const cx = head ? 21 : 14; const cy = head ? 7.5 : 11; const rx = head ? 6 : 10; const ry = head ? 6 : 8;
        const t = ((x + 0.5 - cx) / rx) * 0.6 + ((y + 0.5 - cy) / ry) * 0.8;
        out[y][x] = t < -0.55 ? C.bodyLight : t < 0.25 ? C.body : t < 0.65 ? C.bodyShade : C.bodyDeep;
      } else if (k === 'wing') {
        out[y][x] = !is(x, y - 1, 'wing') ? C.wingLight : !is(x, y + 1, 'wing') ? C.wingShade : C.wing;
        if ((x + y) % 5 === 0 && is(x, y - 1, 'wing') && is(x, y + 1, 'wing')) out[y][x] = C.wingShade;
      } else if (k === 'tail') {
        out[y][x] = !is(x, y - 1, 'tail') ? C.wing : C.wingShade;
      } else if (k === 'beak') {
        out[y][x] = is(x, y + 1, 'beak') ? C.beak : C.beakShade;
      } else {
        out[y][x] = C.leg;
      }
    }
  }
  // Eye with its highlight, and a blush under it.
  out[5][22] = C.bodyLight; out[5][23] = C.eye; out[6][22] = C.eye; out[6][23] = C.eye;
  out[9][23] = C.cheek; out[9][24] = C.cheek;
  return out;
}

function draw(g, s) {
  const R = rng(s.seed);
  const px = new Array(N * N).fill(C.ground);
  const put = (x, y, c) => { if (x >= 0 && y >= 0 && x < N && y < N && c) px[y * N + x] = c; };
  const get = (x, y) => (x >= 0 && y >= 0 && x < N && y < N ? px[y * N + x] : null);
  const dither = (x, y, f) => f * 16 > BAYER[(y % 4) * 4 + (x % 4)];

  // Sky and stars.
  for (let y = 0; y < 72; y++) {
    for (let x = 0; x < N; x++) {
      const t = (y / 71) * (SKY.length - 1);
      const i = Math.min(SKY.length - 2, Math.floor(t));
      put(x, y, SKY[dither(x, y, t - i) ? i + 1 : i]);
    }
  }
  for (let i = 0; i < 60; i++) {
    const x = Math.floor(R('star', 'x', i) * N); const y = Math.floor(R('star', 'y', i) * 46);
    put(x, y, R('star', 'b', i) < 0.35 ? C.star : C.starDim);
  }
  for (let i = 0; i < 5; i++) {
    const x = 4 + Math.floor(R('twinkle', 'x', i) * 90); const y = 3 + Math.floor(R('twinkle', 'y', i) * 34);
    put(x, y, C.star);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) put(x + dx, y + dy, C.starDim);
  }

  // Moon with a dithered halo and craters.
  const mx = 74; const my = 17; const mr = 8;
  for (let y = my - 12; y <= my + 12; y++) {
    for (let x = mx - 12; x <= mx + 12; x++) {
      const d = Math.hypot(x + 0.5 - mx, y + 0.5 - my);
      if (d <= mr) {
        const shade = (x + 0.5 - mx + y + 0.5 - my) / mr > 0.55;
        put(x, y, shade ? C.moonShade : C.moon);
      } else if (d <= mr + 3 && dither(x, y, 1 - (d - mr) / 3.2)) {
        const t = (y / 71) * (SKY.length - 1);
        put(x, y, SKY[Math.min(SKY.length - 1, Math.floor(t) + 3)]);
      }
    }
  }
  for (const [cx, cy, r] of [[71.5, 15.5, 1.6], [77, 20, 1.3], [76, 12, 1]]) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) put(x, y, C.crater);
      }
    }
  }

  // Clouds: circles with a flat base, lit on top, shaded underneath.
  const clouds = [
    [[64, 27, 3.5], [69, 25, 4.5], [74, 26, 4], [78, 28, 3]],
    [[13, 17, 3], [18, 15, 4], [23, 17, 3.5]],
    [[37, 35, 2.5], [42, 33, 3.5], [47, 35, 3]],
  ];
  for (const cloud of clouds) {
    const base = Math.max(...cloud.map((c) => c[1])) + 1.5;
    const inside = (x, y) => y + 0.5 <= base && cloud.some(([cx, cy, r]) => Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r);
    for (let y = 8; y < 42; y++) {
      for (let x = 0; x < N; x++) {
        if (!inside(x, y)) continue;
        put(x, y, !inside(x, y - 1) ? C.cloudLight : !inside(x, y + 1) ? C.cloudDark : C.cloud);
      }
    }
  }

  // Far mountains, then hills with pines.
  const ridgeFar = (x) => Math.round(58 - 8 * tri(x / 21 + 0.3) - 4 * tri(x / 9 + 0.7) - 2 * noise2(R, x / 6, 0.5, 'far'));
  const ridgeMid = (x) => Math.round(65 - 3 * noise2(R, x / 13, 2.5, 'mid') - 1.5 * tri(x / 17));
  for (let x = 0; x < N; x++) {
    const top = ridgeFar(x);
    for (let y = top; y < 72; y++) put(x, y, y === top ? C.farRim : y <= top + 1 && top < 50 ? C.snow : C.far);
  }
  for (let x = 0; x < N; x++) {
    const top = ridgeMid(x);
    for (let y = top; y < 72; y++) put(x, y, y === top ? C.hillRim : C.hill);
  }
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
  // Reeds in the near corner frame the lake.
  for (let i = 0; i < 9; i++) {
    const x = 84 + Math.floor(R('reed', 'x', i) * 15); const h = 7 + Math.floor(R('reed', 'h', i) * 11);
    for (let k = 0; k < h; k++) put(x, 99 - k, k === h - 1 ? C.grassLight : C.grass);
    if (i % 3 === 0) for (let k = 0; k < 3; k++) put(x, 99 - h + k, C.branch);
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
  const bird = sprite();
  bird.forEach((row, y) => row.forEach((c, x) => put(26 + x, 40 + y, c)));
  const NOTE = ['...##', '...###', '...#.##', '...#..#', '...#', '.###', '####', '####', '.##'];
  NOTE.forEach((row, y) => [...row].forEach((c, x) => { if (c === '#') put(60 + x, 31 + y, C.note); }));

  // Fireflies.
  for (const [x, y] of [[12, 77], [31, 80], [55, 75], [86, 79], [92, 69], [70, 66]]) {
    put(x, y, C.firefly);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (get(x + dx, y + dy) !== C.glint) put(x + dx, y + dy, C.fireflyDim);
    put(x, y, C.firefly);
  }

  for (let y = 0; y < N; y++) {
    let x = 0;
    while (x < N) {
      const c = px[y * N + x];
      let run = 1;
      while (x + run < N && px[y * N + x + run] === c) run++;
      g.fillStyle = c;
      g.fillRect(x * P, y * P, run * P + 0.6, P + 0.6);
      x += run;
    }
  }
  caption(g, 'PIXEL', font, 'rgba(253, 240, 200, 0.85)', 40, 955);
}

module.exports = { draw };
