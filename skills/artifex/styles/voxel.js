// Voxel: 3D built from cubes, the way Minecraft draws a world. Each block is
// an isometric box whose faces carry 16 x 16 texel textures, shaded top,
// left and right; hidden faces are culled and blocks drawn back to front.
// A floating island with a blossom tree in open daylight, flat cloud slabs
// and far islands in haze, and the bird built from boxes, wings spread.

'use strict';

const { rng, noise2 } = require('../../../core/rand.js');
const font = require('../../../core/stroke-font.js');
const { caption } = require('./kit.js');

const W = 1000;
const SHADE = { top: 1, left: 0.8, right: 0.63 };
const HAZE = [201, 222, 244];

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

const PAL = {
  grass: ['#4f8a2e', '#5c9a36', '#69a83e', '#77b548', '#86c154'],
  dirt: ['#5b3a21', '#6a4527', '#79502e', '#885c36', '#96683f'],
  stone: ['#7d7d7d', '#939393'],
  bark: ['#43301c', '#523a22', '#61452a', '#704f31'],
  ring: ['#8a6a40', '#a07d4f', '#b38f5d'],
  bloom: ['#d8699c', '#e27aa8', '#ec8fb9', '#f3a2c6', '#f8b8d4', '#fbcde1'],
  cream: ['#e7ddcb', '#efe6d6', '#f6efe3', '#fbf7ef'],
  coral: ['#c95641', '#dd6a50', '#ec8064', '#f39479'],
  beak: ['#d98424', '#eb9b32', '#f5b04a'],
  eye: '#1d1624',
};

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const shadeCache = new Map();
function shaded(hex, k) {
  const key = hex + k;
  let v = shadeCache.get(key);
  if (!v) {
    v = '#' + hexRgb(hex).map((c) => Math.round(c * k).toString(16).padStart(2, '0')).join('');
    shadeCache.set(key, v);
  }
  return v;
}

const hazeCache = new Map();
function hazed(hex, k) {
  const key = hex + k;
  let v = hazeCache.get(key);
  if (!v) {
    v = '#' + hexRgb(hex).map((c, i) => Math.round(c + (HAZE[i] - c) * k).toString(16).padStart(2, '0')).join('');
    hazeCache.set(key, v);
  }
  return v;
}

// A flat cloud: faces filled as plain polygons, lit like the blocks.
function slab(g, { S, x, y, rows }) {
  const A = S * 0.866; const B = S * 0.5; const H = S * 0.35;
  const at = (i, j, z) => [x + (i - j) * A, y + (i + j) * B - z * H];
  const on = (i, j) => (rows[j] || '')[i] === '1';
  const cells = [];
  rows.forEach((row, j) => [...row].forEach((c, i) => { if (c === '1') cells.push([i, j]); }));
  cells.sort((p, q) => p[0] + p[1] - q[0] - q[1]);
  const quad = (pts, fill) => { g.fillStyle = fill; g.beginPath(); pts.forEach(([px, py], k) => (k ? g.lineTo(px, py) : g.moveTo(px, py))); g.closePath(); g.fill(); };
  for (const [i, j] of cells) {
    if (!on(i, j + 1)) quad([at(i, j + 1, 1), at(i + 1, j + 1, 1), at(i + 1, j + 1, 0), at(i, j + 1, 0)], '#e3ecf7');
    if (!on(i + 1, j)) quad([at(i + 1, j, 1), at(i + 1, j + 1, 1), at(i + 1, j + 1, 0), at(i + 1, j, 0)], '#cfdcee');
    quad([at(i, j, 1), at(i + 1, j, 1), at(i + 1, j + 1, 1), at(i, j + 1, 1)], '#ffffff');
  }
}

// Texture lookups: face is top, left or right; (u, v) are texel indices.
function textures(R) {
  const pick = (pal, n) => pal[Math.max(0, Math.min(pal.length - 1, Math.floor(n * pal.length)))];
  const grain = (name, id, u, v, scale = 3) =>
    0.65 * noise2(R, (u + id * 23) / scale, (v + id * 7) / scale, name) + 0.35 * R(name, 'texel', id * 4096 + v * 64 + u);
  return {
    grass(face, u, v, id) {
      if (face === 'top') return pick(PAL.grass, grain('grass', id, u, v));
      const lip = 3 + (R('lip', 'depth', id * 64 + u) < 0.45 ? 1 : 0) + (u % 5 === 2 ? 1 : 0);
      if (v < lip) return pick(PAL.grass, grain('grassSide', id, u, v, 2) * 0.8);
      return R('pebble', 'p', id * 4096 + v * 64 + u) < 0.035 ? pick(PAL.stone, R('pebble', 't', u + v)) : pick(PAL.dirt, grain('dirt', id, u, v));
    },
    dirt(face, u, v, id) {
      return R('pebble', 'p', id * 4096 + v * 64 + u + 999) < 0.04 ? pick(PAL.stone, R('pebble', 't', u * v)) : pick(PAL.dirt, grain('dirt', id, u, v));
    },
    log(face, u, v, id) {
      if (face === 'top') {
        const d = Math.max(Math.abs(u - 7.5), Math.abs(v - 7.5));
        return d > 6.5 ? PAL.bark[1] : PAL.ring[Math.floor(d / 2) % 2 ? 0 : 2];
      }
      const stripe = (u * 7 + (id % 3)) % 4;
      return PAL.bark[(stripe + Math.floor(grain('bark', id, u, v, 2) * 2)) % 4];
    },
    bloom(face, u, v, id) {
      return pick(PAL.bloom, grain('bloom', id, u, v, 2.5));
    },
    cream(face, u, v, id) { return pick(PAL.cream, grain('cream', id, u, v, 4)); },
    coral(face, u, v, id) { return pick(PAL.coral, grain('coral', id, u, v, 3) * 0.7 + (u % 4 === 0 ? 0 : 0.3)); },
    beak(face, u, v, id) { return pick(PAL.beak, grain('beak', id, u, v, 2)); },
  };
}

function draw(g, s) {
  const R = rng(s.seed);
  const tex = textures(R);

  // Background: open daylight, cloud slabs, far islands lost in haze.
  const sky = g.createLinearGradient(0, 0, 0, W);
  sky.addColorStop(0, '#6f9fe0');
  sky.addColorStop(0.6, '#b3d1f1');
  sky.addColorStop(1, '#e2eefa');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, W);
  for (const cloud of CLOUDS) slab(g, cloud);

  // Boxes: { x, y, z, w, d, h, mat }. Faces touching a filled cell are culled.
  const project = (S, ox, oy) => (x, y, z) => [ox + (x - y) * S * 0.866, oy + (x + y) * S * 0.5 - z * S];
  const depth = (b) => b.x + b.w / 2 + b.y + b.d / 2 + (b.z + b.h / 2) * 0.9;
  const face = (b, name, o, pu, pv, nu, nv, id, haze) => {
    g.save();
    g.transform((pu[0] - o[0]) / nu, (pu[1] - o[1]) / nu, (pv[0] - o[0]) / nv, (pv[1] - o[1]) / nv, o[0], o[1]);
    for (let v = 0; v < nv; v++) {
      for (let u = 0; u < nu; u++) {
        let c = tex[b.mat](name, u, v, id);
        if (b.marks === 'eyes' && ((name === 'right' && v >= 2 && v <= 4 && (u === 1 || u === 2 || u === nu - 3 || u === nu - 2)) ||
          (name === 'left' && v >= 2 && v <= 4 && u >= nu - 4 && u <= nu - 3))) c = PAL.eye;
        c = shaded(c, SHADE[name]);
        g.fillStyle = haze ? hazed(c, haze) : c;
        g.fillRect(u, v, 1.06, 1.06);
      }
    }
    g.restore();
  };
  const drawBoxes = (boxes, cell, at, haze = 0, base = 0) => {
    boxes.sort((p, q) => depth(p) - depth(q));
    boxes.forEach((b, k) => {
      const { x, y, z, w, d, h } = b;
      const id = base + k;
      const n = (q) => Math.max(1, Math.round(16 * q));
      const open = (dx, dy, dz) => b.free || !cell.has(`${x + dx},${y + dy},${z + dz}`);
      if (open(0, 0, 1)) face(b, 'top', at(x, y, z + h), at(x + w, y, z + h), at(x, y + d, z + h), n(w), n(d), id, haze);
      if (open(0, 1, 0)) face(b, 'left', at(x, y + d, z + h), at(x + w, y + d, z + h), at(x, y + d, z), n(w), n(h), id, haze);
      if (open(1, 0, 0)) face(b, 'right', at(x + w, y + d, z + h), at(x + w, y, z + h), at(x + w, y + d, z), n(d), n(h), id, haze);
    });
  };
  const world = () => {
    const boxes = [];
    const cell = new Set();
    return { boxes, cell, block: (x, y, z, mat) => { boxes.push({ x, y, z, w: 1, d: 1, h: 1, mat }); cell.add(`${x},${y},${z}`); } };
  };

  FAR.forEach((f, k) => {
    const { boxes, cell, block } = world();
    for (const [x, y] of f.foot) { block(x, y, 0, 'grass'); block(x, y, -1, 'dirt'); }
    block(f.foot[0][0], f.foot[0][1], -2, 'dirt');
    if (f.tree) { block(f.tree[0], f.tree[1], 1, 'log'); block(f.tree[0], f.tree[1], 2, 'bloom'); }
    drawBoxes(boxes, cell, project(f.S, f.x, f.y), f.haze, 5000 + k * 100);
  });

  // The near world.
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
  for (let x = 1; x < 4; x++) for (let y = 0; y < 3; y++) block(x, y, 6, 'bloom');
  for (const [x, y, z] of [[0, 1, 4], [4, 1, 4], [2, -1, 4], [1, 3, 4], [2, 1, 7], [4, 0, 6], [0, 2, 6]]) block(x, y, z, 'bloom');

  // The bird, flying, built from boxes around (bx, by, bz).
  const [bx, by, bz] = [4.6, -2.2, 5.3];
  const part = (x, y, z, w, d, h, mat, marks) => boxes.push({ x: bx + x, y: by + y, z: bz + z, w, d, h, mat, marks, free: true });
  part(-0.4, 0.28, 0.42, 0.42, 0.3, 0.08, 'coral');
  part(0, 0, 0, 1.0, 0.85, 0.75, 'cream');
  part(0.18, -0.42, 0.7, 0.58, 0.42, 0.07, 'coral');
  part(0.18, 0.85, 0.7, 0.58, 0.42, 0.07, 'coral');
  part(0.62, 0.12, 0.52, 0.56, 0.62, 0.56, 'cream', 'eyes');
  part(1.18, 0.33, 0.7, 0.22, 0.2, 0.14, 'beak');
  drawBoxes(boxes, cell, project(75, 500 - 75 * 0.866, 530));

  // A few petals on the wind.
  for (let i = 0; i < 9; i++) {
    const px = 260 + R('petal', 'x', i) * 520; const py = 420 + R('petal', 'y', i) * 360;
    g.fillStyle = PAL.bloom[3 + (i % 3)];
    g.fillRect(Math.round(px / 5) * 5, Math.round(py / 5) * 5, 10, 5);
  }

  caption(g, 'VOXEL', font, 'rgba(40, 70, 110, 0.85)');
}

module.exports = { name: 'voxel', size: { w: 1000, h: 1000 }, seed: 2026, draw };
