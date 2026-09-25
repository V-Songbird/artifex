// 3D: a raymarched toy bird on a pedestal. The bird is signed-distance
// geometry, ellipsoids blended smoothly. Every pixel gets a key light with
// soft shadows, sky fill, ambient occlusion, rim light, specular highlights
// and distance fog; pixels on a silhouette are supersampled.

'use strict';

const { rgb, toLinear, toSRGB } = require('../../../core/colour.js');
const font = require('../../../core/stroke-font.js');
const { caption } = require('./kit.js');

const W = 1000; const H = 1000;
const lin = (hex) => rgb(hex).slice(0, 3).map(toLinear);

const ALBEDO = [
  null, lin('#efe3d6'), lin('#8fd0c3'), lin('#f6eddf'), lin('#ef6f55'), lin('#f4a13a'), lin('#17131c'), lin('#ea8a36'),
];
// id: 0 sky, 1 ground, 2 pedestal, 3 body, 4 wing or tail, 5 beak, 6 eye, 7 leg.
const SHINE = [0, 1, 25, 40, 30, 60, 220, 30];
const SPEC = [0, 0, 0.2, 0.35, 0.3, 0.45, 1.3, 0.3];
const CHEEK = lin('#f3a0a0');
const SKY_TOP = lin('#a9d4e8'); const SKY_LOW = lin('#f9e7d7');
const LIFT = 0.12;
const BOUND = [0.02, 0.62, 0, 1.32];

const unit = (x, y, z) => { const d = Math.sqrt(x * x + y * y + z * z) || 1; return [x / d, y / d, z / d]; };
const KEY = unit(-0.45, 0.85, 0.55);
const RIM = unit(-0.55, 0.35, -0.75);

function ellipsoid(x, y, z, a, b, c) {
  const ax = x / a; const by = y / b; const cz = z / c;
  const k0 = Math.sqrt(ax * ax + by * by + cz * cz);
  const k1 = Math.sqrt((ax * ax) / (a * a) + (by * by) / (b * b) + (cz * cz) / (c * c));
  return k1 === 0 ? -Math.min(a, b, c) : (k0 * (k0 - 1)) / k1;
}
const sphere = (x, y, z, r) => Math.sqrt(x * x + y * y + z * z) - r;
function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
function capsule(x, y, z, ax, ay, az, bx, by, bz, r) {
  const px = x - ax; const py = y - ay; const pz = z - az;
  const dx = bx - ax; const dy = by - ay; const dz = bz - az;
  const h = Math.max(0, Math.min(1, (px * dx + py * dy + pz * dz) / (dx * dx + dy * dy + dz * dz)));
  const qx = px - dx * h; const qy = py - dy * h; const qz = pz - dz * h;
  return Math.sqrt(qx * qx + qy * qy + qz * qz) - r;
}
function pedestal(x, y, z) {
  const q0 = Math.sqrt((x - 0.02) * (x - 0.02) + z * z) - 0.89;
  const q1 = Math.abs(y - 0.06) - 0.03;
  return Math.min(Math.max(q0, q1), 0) + Math.sqrt(Math.max(q0, 0) ** 2 + Math.max(q1, 0) ** 2) - 0.03;
}

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

const solid = (x, y, z) => Math.min(bird(x, y - LIFT, z), pedestal(x, y, z));
const scene = (x, y, z) => Math.min(solid(x, y, z), y);

function span(ox, oy, oz, dx, dy, dz) {
  const px = ox - BOUND[0]; const py = oy - BOUND[1]; const pz = oz - BOUND[2];
  const b = px * dx + py * dy + pz * dz;
  const h = b * b - (px * px + py * py + pz * pz - BOUND[3] * BOUND[3]);
  if (h < 0) return null;
  const s = Math.sqrt(h);
  return [-b - s, -b + s];
}

function softShadow(px, py, pz) {
  const hit = span(px, py, pz, KEY[0], KEY[1], KEY[2]);
  if (!hit || hit[1] < 0) return 1;
  let res = 1; let t = Math.max(0.015, hit[0]);
  for (let i = 0; i < 64 && t < hit[1]; i++) {
    const h = solid(px + KEY[0] * t, py + KEY[1] * t, pz + KEY[2] * t);
    if (h < 0.0005) return 0;
    res = Math.min(res, (9 * h) / t);
    t += Math.min(Math.max(h, 0.008), 0.15);
  }
  res = Math.max(0, Math.min(1, res));
  return res * res * (3 - 2 * res);
}

function occlusion(px, py, pz, nx, ny, nz) {
  let occ = 0; let k = 1;
  for (let i = 1; i <= 5; i++) {
    const h = 0.015 + 0.05 * i;
    occ += (h - scene(px + nx * h, py + ny * h, pz + nz * h)) * k;
    k *= 0.75;
  }
  return Math.max(0.3, Math.min(1, 1 - 1.6 * occ));
}

function normal(x, y, z) {
  const e = 0.0015;
  const a = solid(x + e, y - e, z - e); const b = solid(x - e, y - e, z + e);
  const c = solid(x - e, y + e, z - e); const d = solid(x + e, y + e, z + e);
  return unit(a - b - c + d, -a - b + c + d, -a + b - c + d);
}

function background(v) {
  const t = Math.pow(Math.max(0, Math.min(1, v)), 0.8);
  return [0, 1, 2].map((i) => SKY_TOP[i] + (SKY_LOW[i] - SKY_TOP[i]) * t);
}

function makeCamera() {
  const ro = [2.25, 1.55, 3.45]; const ta = [0.05, 0.62, 0];
  const f = unit(ta[0] - ro[0], ta[1] - ro[1], ta[2] - ro[2]);
  const r = unit(-f[2], 0, f[0]);
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return { ro, f, r, u, focal: 3.4 };
}

// One sample: returns [r, g, b] in linear light and the id it saw.
function sample(cam, sx, sy, screenV, out) {
  const [ox, oy, oz] = cam.ro;
  const d = unit(cam.f[0] * cam.focal + cam.r[0] * sx + cam.u[0] * sy,
    cam.f[1] * cam.focal + cam.r[1] * sx + cam.u[1] * sy,
    cam.f[2] * cam.focal + cam.r[2] * sx + cam.u[2] * sy);
  const sky = background(screenV);
  const tGround = d[1] < -1e-6 ? -oy / d[1] : Infinity;
  let t = Infinity; let id = 0;
  const hit = span(ox, oy, oz, d[0], d[1], d[2]);
  if (hit && hit[1] > 0) {
    let s = Math.max(hit[0], 0);
    const end = Math.min(hit[1], tGround);
    for (let i = 0; i < 180 && s < end; i++) {
      const h = solid(ox + d[0] * s, oy + d[1] * s, oz + d[2] * s);
      if (h < 0.0006 * (1 + s)) { t = s; id = -1; break; }
      s += h * 0.9;
    }
  }
  if (id === 0 && tGround < Infinity) { t = tGround; id = 1; }
  if (id === 0) { out.id = 0; return sky; }

  const x = ox + d[0] * t; const y = oy + d[1] * t; const z = oz + d[2] * t;
  let n = [0, 1, 0];
  let albedo = ALBEDO[1];
  if (id === -1) {
    n = normal(x, y, z);
    const part = [0, 0, pedestal(x, y, z), 0, 0, 0, 0, 0];
    bird(x, y - LIFT, z, part);
    id = 2;
    for (let k = 3; k < 8; k++) if (part[k] < part[id]) id = k;
    albedo = ALBEDO[id];
    if (id === 3) {
      const cx = x - 0.63; const cy = y - LIFT - 0.99; const cz = Math.abs(z) - 0.24;
      const w = Math.max(0, Math.min(1, (0.11 - Math.sqrt(cx * cx + cy * cy + cz * cz)) / 0.07));
      albedo = albedo.map((v, i) => v + (CHEEK[i] - v) * w * 0.85);
    }
  }
  out.id = id;
  const v = [-d[0], -d[1], -d[2]];
  const lambert = Math.max(0, n[0] * KEY[0] + n[1] * KEY[1] + n[2] * KEY[2]);
  const shadow = lambert > 0 ? softShadow(x + n[0] * 0.004, y + n[1] * 0.004, z + n[2] * 0.004) : 0;
  const ao = occlusion(x, y, z, n[0], n[1], n[2]);
  const hemi = 0.5 + 0.5 * n[1];
  const hx = KEY[0] + v[0]; const hy = KEY[1] + v[1]; const hz = KEY[2] + v[2];
  const hl = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1;
  const spec = SPEC[id] * Math.pow(Math.max(0, (n[0] * hx + n[1] * hy + n[2] * hz) / hl), SHINE[id]) * shadow;
  const fres = Math.pow(1 - Math.max(0, n[0] * v[0] + n[1] * v[1] + n[2] * v[2]), 5);
  const rim = Math.pow(Math.max(0, n[0] * RIM[0] + n[1] * RIM[1] + n[2] * RIM[2]), 2) * 0.35;
  const keyC = [1.35, 1.27, 1.16]; const skyC = [0.42, 0.55, 0.7]; const bounce = [0.36, 0.3, 0.26]; const rimC = [0.55, 0.65, 0.85];
  const col = [0, 1, 2].map((i) => {
    const amb = bounce[i] + (skyC[i] - bounce[i]) * hemi;
    let c = albedo[i] * (keyC[i] * lambert * shadow + amb * ao * 0.9 + rimC[i] * rim * ao) + keyC[i] * spec;
    if (id > 1) c += skyC[i] * fres * 0.3 * ao;
    return c;
  });
  if (id === 1) {
    const fog = 1 - Math.exp(-Math.max(0, t - 4) * 0.12);
    return col.map((c, i) => c + (sky[i] - c) * fog);
  }
  return col;
}

function encode(c) {
  return Math.round(255 * Math.max(0, Math.min(1, toSRGB(1 - Math.exp(-1.1 * c)))));
}

function draw(g) {
  const m = g.getTransform();
  const width = g.canvas ? g.canvas.width : Math.max(1, Math.round(W * Math.hypot(m.a, m.b)));
  const height = g.canvas ? g.canvas.height : Math.max(1, Math.round(H * Math.hypot(m.c, m.d)));
  const cam = makeCamera();
  const image = g.createImageData(width, height);
  const px = image.data;
  const ids = new Uint8Array(width * height);
  const info = { id: 0 };
  const shoot = (fx, fy) => {
    const sx = (fx / width) * 2 - 1; const sy = 1 - (fy / height) * 2;
    return sample(cam, sx, sy * (height / width), fy / height, info).map(encode);
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = shoot(x + 0.5, y + 0.5);
      const i = (y * width + x) * 4;
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
      ids[y * width + x] = info.id;
    }
  }
  // Silhouettes: four rotated-grid samples wherever a neighbour saw another id.
  const offsets = [[0.375, 0.125], [0.875, 0.375], [0.625, 0.875], [0.125, 0.625]];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const k = y * width + x; const id = ids[k];
      if (id === ids[k + 1] && id === ids[k - 1] && id === ids[k + width] && id === ids[k - width]) continue;
      const sum = [0, 0, 0];
      for (const [ox, oy] of offsets) {
        const c = shoot(x + ox, y + oy);
        sum[0] += c[0]; sum[1] += c[1]; sum[2] += c[2];
      }
      const i = k * 4;
      px[i] = Math.round(sum[0] / 4); px[i + 1] = Math.round(sum[1] / 4); px[i + 2] = Math.round(sum[2] / 4);
    }
  }
  g.putImageData(image, 0, 0);
  caption(g, '3D', font, 'rgba(70, 64, 80, 0.8)');
}

module.exports = { name: 'render-3d', size: { w: 1000, h: 1000 }, seed: 2026, draw };
