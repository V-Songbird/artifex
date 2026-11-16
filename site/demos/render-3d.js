// The showcase site's demo of 3D render: the songbird staged in one scene,
// drawn with the marks of skills/artifex/styles/render-3d.js. Site-only, never
// a starting point for a piece. A raymarched toy bird on a pedestal: the bird
// is ellipsoids blended smoothly. The seed picks the toy's colours with its
// pedestal and sky, and turns it on the pedestal.

'use strict';

const { rng } = require('../../core/rand.js');
const font = require('../../core/stroke-font.js');
const { caption } = require('../../skills/artifex/styles/kit.js');
const {
  lin, sphere, ellipsoid, capsule, roundCylinder, smin, span, march, normal, softShadow, occlusion,
  camera, ray, STUDIO, lit, fog, backdrop, encode, pixelSize, raster,
} = require('../../skills/artifex/styles/render-3d.js');

const W = 1000; const H = 1000;

// The seed picks a toy, its pedestal and sky: [pedestal, body, wing and tail,
// beak, sky top, sky low], and turns the bird on its pedestal.
const TOYS = [
  ['#8fd0c3', '#f6eddf', '#ef6f55', '#f4a13a', '#a9d4e8', '#f9e7d7'],
  ['#c7b6ea', '#f6d65a', '#f08a2c', '#ef6a3a', '#d8cbef', '#fbeedd'],
  ['#f4c3a6', '#86b6e6', '#3e6fc2', '#f4a13a', '#f3cdbd', '#fdf1e6'],
  ['#f2b3b8', '#f3ece0', '#5f9a5c', '#e8873a', '#bfe0d2', '#f8efe0'],
];
// The scene a draw renders: ALBEDO by id, the sky and the bird's turn.
// id: 0 sky, 1 ground, 2 pedestal, 3 body, 4 wing or tail, 5 beak, 6 eye, 7 leg.
let ALBEDO = [];
let SKY_TOP = null; let SKY_LOW = null;
let TURN = [1, 0];
function stage(toy, yaw) {
  ALBEDO = [null, lin('#efe3d6'), lin(toy[0]), lin(toy[1]), lin(toy[2]), lin(toy[3]), lin('#17131c'), lin('#ea8a36')];
  SKY_TOP = lin(toy[4]); SKY_LOW = lin(toy[5]);
  TURN = [Math.cos(yaw), Math.sin(yaw)];
}
const SHINE = [0, 1, 25, 40, 30, 60, 220, 30];
const SPEC = [0, 0, 0.2, 0.35, 0.3, 0.45, 1.3, 0.3];
const CHEEK = lin('#f3a0a0');
const LIFT = 0.12;
const BOUND = [0.02, 0.62, 0, 1.32];
const KEY = STUDIO.key;

const pedestal = (x, y, z) => roundCylinder(x - 0.02, y - 0.06, z, 0.89, 0.03, 0.03);

// Bird parts in bird space, feet at y = 0. Fills `out` when asked.
function bird(x, y, z, out) {
  const az = Math.abs(z);
  const body = smin(ellipsoid(x, y - 0.55, z, 0.6, 0.47, 0.46), sphere(x - 0.48, y - 1.0, z, 0.33), 0.2);
  const tx = x + 0.68; const ty = y - 0.78;
  const tail = ellipsoid(0.8525 * tx - 0.5227 * ty, 0.5227 * tx + 0.8525 * ty, z, 0.34, 0.07, 0.2);
  const wx = x + 0.1; const wy = y - 0.62;
  const wing = ellipsoid(0.9553 * wx - 0.2955 * wy, 0.2955 * wx + 0.9553 * wy, az - 0.43, 0.46, 0.24, 0.085);
  const bx = x - 0.86; const by = y - 0.96;
  const beak = ellipsoid(0.9888 * bx - 0.1494 * by, 0.1494 * bx + 0.9888 * by, z, 0.2, 0.075, 0.085);
  const eye = sphere(x - 0.68, y - 1.08, az - 0.2, 0.07);
  const leg = Math.min(capsule(x, y, az, 0.02, 0.22, 0.13, 0.05, 0.03, 0.13, 0.035),
    ellipsoid(x - 0.1, y - 0.02, az - 0.13, 0.11, 0.022, 0.05));
  if (out) { out[3] = body; out[4] = Math.min(tail, wing); out[5] = beak; out[6] = eye; out[7] = leg; }
  return Math.min(smin(smin(body, tail, 0.08), wing, 0.03), beak, eye, leg);
}

// Bird space is world space turned by TURN about the pedestal's axis.
const turnX = (x, z) => 0.02 + (x - 0.02) * TURN[0] + z * TURN[1];
const turnZ = (x, z) => z * TURN[0] - (x - 0.02) * TURN[1];
const solid = (x, y, z) => Math.min(bird(turnX(x, z), y - LIFT, turnZ(x, z)), pedestal(x, y, z));
const scene = (x, y, z) => Math.min(solid(x, y, z), y);

// One sample: returns [r, g, b] in linear light and the id it saw.
function sample(cam, sx, sy, screenV, out) {
  const [ox, oy, oz] = cam.ro;
  const d = ray(cam, sx, sy);
  const sky = backdrop(SKY_TOP, SKY_LOW, screenV);
  const tGround = d[1] < -1e-6 ? -oy / d[1] : Infinity;
  let t = Infinity; let id = 0;
  const hit = span(ox, oy, oz, d[0], d[1], d[2], BOUND);
  if (hit && hit[1] > 0) {
    t = march(solid, ox, oy, oz, d[0], d[1], d[2], Math.max(hit[0], 0), Math.min(hit[1], tGround));
    if (t < Infinity) id = -1;
  }
  if (id === 0 && tGround < Infinity) { t = tGround; id = 1; }
  if (id === 0) { out.id = 0; return sky; }

  const x = ox + d[0] * t; const y = oy + d[1] * t; const z = oz + d[2] * t;
  let n = [0, 1, 0];
  let albedo = ALBEDO[1];
  if (id === -1) {
    n = normal(solid, x, y, z);
    const part = [0, 0, pedestal(x, y, z), 0, 0, 0, 0, 0];
    const bx = turnX(x, z); const bz = turnZ(x, z);
    bird(bx, y - LIFT, bz, part);
    id = 2;
    for (let k = 3; k < 8; k++) if (part[k] < part[id]) id = k;
    albedo = ALBEDO[id];
    if (id === 3) {
      const cx = bx - 0.63; const cy = y - LIFT - 0.99; const cz = Math.abs(bz) - 0.24;
      const w = Math.max(0, Math.min(1, (0.11 - Math.sqrt(cx * cx + cy * cy + cz * cz)) / 0.07));
      albedo = albedo.map((v, i) => v + (CHEEK[i] - v) * w * 0.85);
    }
  }
  out.id = id;
  const v = [-d[0], -d[1], -d[2]];
  const lambert = Math.max(0, n[0] * KEY[0] + n[1] * KEY[1] + n[2] * KEY[2]);
  const shadow = lambert > 0 ? softShadow(solid, x + n[0] * 0.004, y + n[1] * 0.004, z + n[2] * 0.004, KEY, BOUND) : 0;
  const ao = occlusion(scene, x, y, z, n[0], n[1], n[2]);
  const col = lit(n, v, albedo, { spec: SPEC[id], shine: SHINE[id], fresnel: id > 1 }, shadow, ao);
  return id === 1 ? fog(col, sky, t) : col;
}

function draw(g, s) {
  const R = rng(s.seed);
  stage(TOYS[Math.floor(R('look', 'toy') * TOYS.length)], -0.45 + R('pose', 'yaw') * 1.25);
  const [width, height] = pixelSize(g, W, H);
  const cam = camera([2.25, 1.55, 3.45], [0.05, 0.62, 0], 3.4);
  raster(g, width, height, (fx, fy, info) => {
    const sx = (fx / width) * 2 - 1; const sy = 1 - (fy / height) * 2;
    return sample(cam, sx, sy * (height / width), fy / height, info).map((c) => encode(c));
  });
  caption(g, '3D', font, 'rgba(70, 64, 80, 0.8)');
}

module.exports = { name: 'render-3d', size: { w: 1000, h: 1000 }, seed: 2026, draw };
