// The showcase site's demo of Voxel: the songbird staged in one scene, drawn
// with the marks of skills/artifex/styles/voxel.js. Site-only, never a
// starting point for a piece. A floating island with a tree in bloom under an
// open sky, flat cloud slabs and far islands in that sky's haze, and the bird
// built from boxes, wings spread. The seed picks the hour, the crown's colour
// and shape, the bird's side and where the clouds drift.

'use strict';

const { rng } = require('../../core/rand.js');
const font = require('../../core/stroke-font.js');
const { caption } = require('../../skills/artifex/styles/kit.js');
const {
  iso, world, drawBoxes, slab, grassTexture, dirtTexture, logTexture, speckle, bands,
} = require('../../skills/artifex/styles/voxel.js');

const W = 1000;
// The seed picks the hour, a sky gradient with the haze far islands fade
// into, and the canopy's colour: blossom, snow-white, autumn, wisteria or leaf.
const SKIES = [
  { stops: ['#6f9fe0', '#b3d1f1', '#e2eefa'], haze: [201, 222, 244] },
  { stops: ['#86b2ea', '#d3e2f2', '#fbe6d2'], haze: [222, 228, 238] },
  { stops: ['#5b6cb6', '#d79ab3', '#fbd3a6'], haze: [222, 186, 196] },
];
const BLOOMS = [
  ['#d8699c', '#e27aa8', '#ec8fb9', '#f3a2c6', '#f8b8d4', '#fbcde1'],
  ['#c9d0d6', '#d8dde1', '#e4e8eb', '#eef1f3', '#f6f8f9', '#ffffff'],
  ['#c4511e', '#d4652a', '#e07a33', '#ea9140', '#f2a94f', '#f7c066'],
  ['#8d6cc4', '#9c7dd0', '#ab8fdb', '#bba2e4', '#cbb6ec', '#dccbf3'],
  ['#3f7a2a', '#4a8a31', '#56993a', '#63a845', '#72b551', '#84c262'],
];

// Untextured cloud slabs, one character per cell; S is the block size.
const CLOUDS = [
  { S: 24, x: 70, y: 140, rows: ['0110', '1111', '0111'] },
  { S: 18, x: 520, y: 40, rows: ['111', '110'] },
  { S: 30, x: 700, y: 390, rows: ['01110', '11111', '01100'] },
  { S: 26, x: 60, y: 690, rows: ['0111', '1110'] },
];
// Far islands: block size, origin, grass footprint, haze toward the sky.
const FAR = [
  { S: 20, x: 120, y: 470, foot: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1]], tree: [1, 0], haze: 0.55 },
  { S: 15, x: 860, y: 640, foot: [[0, 0], [1, 0], [1, 1]], haze: 0.65 },
];

const BIRD = {
  cream: ['#e7ddcb', '#efe6d6', '#f6efe3', '#fbf7ef'],
  coral: ['#c95641', '#dd6a50', '#ec8064', '#f39479'],
  beak: ['#d98424', '#eb9b32', '#f5b04a'],
  eye: '#1d1624',
};

function textures(R, bloom) {
  return {
    grass: grassTexture(R),
    dirt: dirtTexture(R),
    log: logTexture(R),
    bloom: speckle(R, 'bloom', bloom, 2.5),
    cream: speckle(R, 'cream', BIRD.cream, 4),
    coral: bands(R, 'coral', BIRD.coral, 3),
    beak: speckle(R, 'beak', BIRD.beak, 2),
  };
}

// Eye texels painted on the head box's side faces.
function eyes(name, u, v, nu) {
  if ((name === 'right' && v >= 2 && v <= 4 && (u === 1 || u === 2 || u === nu - 3 || u === nu - 2)) ||
    (name === 'left' && v >= 2 && v <= 4 && u >= nu - 4 && u <= nu - 3)) return BIRD.eye;
  return null;
}

// The near island with its tree: every block touches another face to face,
// and a block at z 6 or above stands on the block below it, at every seed.
function island(R) {
  const { boxes, cell, block } = world();
  for (let x = 0; x < 5; x++) {
    for (let y = 0; y < 4; y++) {
      if ((x === 0 && y === 0) || (x === 0 && y === 3) || (x === 4 && y === 3)) continue;
      block(x, y, 0, 'grass');
      block(x, y, -1, 'dirt');
    }
  }
  for (const [x, y] of [[1, 1], [2, 1], [2, 2], [3, 1], [3, 2]]) block(x, y, -2, 'dirt');
  block(2, 1, -3, 'dirt');
  for (let z = 1; z <= 4; z++) block(2, 1, z, 'log');
  block(3, 1, 3, 'log');
  for (let x = 0; x < 5; x++) {
    for (let y = -1; y < 4; y++) {
      const corner = (x === 0 || x === 4) && (y === -1 || y === 3);
      if (!corner && !cell.has(`${x},${y},5`)) block(x, y, 5, 'bloom');
    }
  }
  // The crown's upper blocks and loose clumps grow where the seed says.
  for (let x = 1; x < 4; x++) for (let y = 0; y < 3; y++) if (R('crown', 'top', x * 3 + y) > 0.2) block(x, y, 6, 'bloom');
  const clumps = [[0, 1, 4], [4, 1, 4], [2, -1, 4], [1, 3, 4], [2, 1, 7], [4, 0, 6], [0, 2, 6], [1, 1, 7], [3, 2, 7], [0, 0, 6], [3, -1, 6]];
  // A top clump grows only on a block, never on air.
  clumps.forEach(([x, y, z], k) => { if (R('crown', 'clump', k) < 0.6 && (z < 7 || cell.has(`${x},${y},6`))) block(x, y, z, 'bloom'); });
  return { boxes, cell };
}

function draw(g, s) {
  const R = rng(s.seed);
  const hour = SKIES[Math.floor(R('look', 'sky') * SKIES.length)];
  const bloom = BLOOMS[Math.floor(R('look', 'bloom') * BLOOMS.length)];
  const tex = textures(R, bloom);

  // Background: open daylight, cloud slabs drifting by the seed, far islands lost in haze.
  const sky = g.createLinearGradient(0, 0, 0, W);
  sky.addColorStop(0, hour.stops[0]);
  sky.addColorStop(0.6, hour.stops[1]);
  sky.addColorStop(1, hour.stops[2]);
  g.fillStyle = sky;
  g.fillRect(0, 0, W, W);
  // The bird flies right of the tree or left of it; on the left, the first cloud rises out of its way.
  const right = R('bird', 'side') < 0.5;
  CLOUDS.forEach((cloud, k) => slab(g, { ...cloud, x: cloud.x + (R('cloud', 'x', k) - 0.5) * 120, y: cloud.y - (k === 0 && !right ? 100 : 0) }));

  FAR.forEach((f, k) => {
    const { boxes, cell, block } = world();
    for (const [x, y] of f.foot) { block(x, y, 0, 'grass'); block(x, y, -1, 'dirt'); }
    block(f.foot[0][0], f.foot[0][1], -2, 'dirt');
    if (f.tree) { block(f.tree[0], f.tree[1], 1, 'log'); block(f.tree[0], f.tree[1], 2, 'bloom'); }
    drawBoxes(g, boxes, cell, iso(f.S, f.x, f.y), tex, { haze: f.haze, hazeColour: hour.haze, base: 5000 + k * 100 });
  });

  // The near world.
  const { boxes, cell } = island(R);

  // The bird, flying, built from boxes around (bx, by, bz), on one side of the tree or the other.
  const [bx, by, bz] = right ? [4.6, -2.2, 5.3] : [-2.4, 2.6, 3.9];
  const part = (x, y, z, w, d, h, mat, decal) => boxes.push({ x: bx + x, y: by + y, z: bz + z, w, d, h, mat, decal, free: true });
  part(-0.4, 0.28, 0.42, 0.42, 0.3, 0.08, 'coral');
  part(0, 0, 0, 1.0, 0.85, 0.75, 'cream');
  part(0.18, -0.42, 0.7, 0.58, 0.42, 0.07, 'coral');
  part(0.18, 0.85, 0.7, 0.58, 0.42, 0.07, 'coral');
  part(0.62, 0.12, 0.52, 0.56, 0.62, 0.56, 'cream', eyes);
  part(1.18, 0.33, 0.7, 0.22, 0.2, 0.14, 'beak');
  drawBoxes(g, boxes, cell, iso(75, 500 - 75 * 0.866, 530), tex);

  // A few petals on the wind.
  for (let i = 0; i < 9; i++) {
    const px = 260 + R('petal', 'x', i) * 520; const py = 420 + R('petal', 'y', i) * 360;
    g.fillStyle = bloom[3 + (i % 3)];
    g.fillRect(Math.round(px / 5) * 5, Math.round(py / 5) * 5, 10, 5);
  }

  caption(g, 'VOXEL', font, 'rgba(40, 70, 110, 0.85)');
}

module.exports = { name: 'voxel', size: { w: 1000, h: 1000 }, seed: 2026, draw };
// For the test that checks no block floats; not a key of the piece, which refuses unknown keys.
Object.defineProperty(module.exports, 'island', { value: island });
