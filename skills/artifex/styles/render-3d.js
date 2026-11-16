// 3D render: smooth signed-distance geometry raymarched per pixel. Every
// pixel gets a key light with soft shadows, sky fill, ambient occlusion, rim
// light, specular highlights and distance fog, tone mapped from linear light;
// pixels on a silhouette are supersampled.
//
// A parts bin: functions that draw the style's marks on any path, outline or
// area you give them. Nothing here picks a subject, a scene or a layout.
// Geometry is a signed-distance function you write from the primitives below:
// sdf(x, y, z) returns the distance to the nearest surface, y up.

'use strict';

const { rgb, toLinear, toSRGB } = require('../../../core/colour.js');

// A hex colour as linear-light [r, g, b], for albedos and sky colours.
const lin = (hex) => rgb(hex).slice(0, 3).map(toLinear);

// The unit vector along (x, y, z).
const unit = (x, y, z) => { const d = Math.sqrt(x * x + y * y + z * z) || 1; return [x / d, y / d, z / d]; };

// A sphere of radius r at the origin.
const sphere = (x, y, z, r) => Math.sqrt(x * x + y * y + z * z) - r;

// An ellipsoid with semi-axes a, b, c at the origin. A bound, not an exact
// distance: march it at 0.9 of the distance.
function ellipsoid(x, y, z, a, b, c) {
  const ax = x / a; const by = y / b; const cz = z / c;
  const k0 = Math.sqrt(ax * ax + by * by + cz * cz);
  const k1 = Math.sqrt((ax * ax) / (a * a) + (by * by) / (b * b) + (cz * cz) / (c * c));
  return k1 === 0 ? -Math.min(a, b, c) : (k0 * (k0 - 1)) / k1;
}

// A capsule of radius r from (ax, ay, az) to (bx, by, bz): limbs, stems, rods.
function capsule(x, y, z, ax, ay, az, bx, by, bz, r) {
  const px = x - ax; const py = y - ay; const pz = z - az;
  const dx = bx - ax; const dy = by - ay; const dz = bz - az;
  const h = Math.max(0, Math.min(1, (px * dx + py * dy + pz * dz) / (dx * dx + dy * dy + dz * dz)));
  const qx = px - dx * h; const qy = py - dy * h; const qz = pz - dz * h;
  return Math.sqrt(qx * qx + qy * qy + qz * qz) - r;
}

// An upright cylinder of radius r and half-height h at the origin, its edges
// rounded by k: plinths, discs, coins, buttons.
function roundCylinder(x, y, z, r, h, k) {
  const q0 = Math.sqrt(x * x + z * z) - r;
  const q1 = Math.abs(y) - h;
  return Math.min(Math.max(q0, q1), 0) + Math.sqrt(Math.max(q0, 0) ** 2 + Math.max(q1, 0) ** 2) - k;
}

// Polynomial smooth union of two distances; k is the blend's width. About
// 0.2 merges soft masses, 0.03 to 0.08 joins a part with a small fillet;
// plain Math.min keeps a crisp seam.
function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

// Where a ray (o, d) crosses the bounding sphere bound = [cx, cy, cz, r]:
// [near, far], or null when it misses. March only inside it.
function span(ox, oy, oz, dx, dy, dz, bound) {
  const px = ox - bound[0]; const py = oy - bound[1]; const pz = oz - bound[2];
  const b = px * dx + py * dy + pz * dz;
  const h = b * b - (px * px + py * py + pz * pz - bound[3] * bound[3]);
  if (h < 0) return null;
  const s = Math.sqrt(h);
  return [-b - s, -b + s];
}

// Sphere tracing from `near` to `far`: steps of relax x distance, a hit when
// the distance falls under eps x (1 + t). Returns t, or Infinity on a miss.
function march(sdf, ox, oy, oz, dx, dy, dz, near, far, { steps = 180, relax = 0.9, eps = 0.0006 } = {}) {
  let s = near;
  for (let i = 0; i < steps && s < far; i++) {
    const h = sdf(ox + dx * s, oy + dy * s, oz + dz * s);
    if (h < eps * (1 + s)) return s;
    s += h * relax;
  }
  return Infinity;
}

// The surface normal by the tetrahedron technique, four samples e apart.
function normal(sdf, x, y, z, e = 0.0015) {
  const a = sdf(x + e, y - e, z - e); const b = sdf(x - e, y - e, z + e);
  const c = sdf(x - e, y + e, z - e); const d = sdf(x + e, y + e, z + e);
  return unit(a - b - c + d, -a - b + c + d, -a + b - c + d);
}

// A soft shadow toward the light direction l, from a point nudged off the
// surface: 0 in shadow, 1 lit. k sets the penumbra (higher is harder); the
// step is clamped to [min, max]. With `bound`, marches only inside it.
function softShadow(sdf, px, py, pz, l, bound = null, { k = 9, steps = 64, start = 0.015, min = 0.008, max = 0.15, far = 20 } = {}) {
  const hit = bound ? span(px, py, pz, l[0], l[1], l[2], bound) : [0, far];
  if (!hit || hit[1] < 0) return 1;
  let res = 1; let t = Math.max(start, hit[0]);
  for (let i = 0; i < steps && t < hit[1]; i++) {
    const h = sdf(px + l[0] * t, py + l[1] * t, pz + l[2] * t);
    if (h < 0.0005) return 0;
    res = Math.min(res, (k * h) / t);
    t += Math.min(Math.max(h, min), max);
  }
  res = Math.max(0, Math.min(1, res));
  return res * res * (3 - 2 * res);
}

// Ambient occlusion: five samples along the normal n at 0.015 + 0.05 i, each
// weighted 0.75 of the last; 1 - strength x occlusion, never under `floor`.
// Pass the sdf that includes the ground, so contacts darken.
function occlusion(sdf, px, py, pz, nx, ny, nz, { strength = 1.6, floor = 0.3 } = {}) {
  let occ = 0; let k = 1;
  for (let i = 1; i <= 5; i++) {
    const h = 0.015 + 0.05 * i;
    occ += (h - sdf(px + nx * h, py + ny * h, pz + nz * h)) * k;
    k *= 0.75;
  }
  return Math.max(floor, Math.min(1, 1 - strength * occ));
}

// A pinhole camera at `ro` looking at `ta`, y up; focal 3.4 is a long lens
// with gentle perspective.
function camera(ro, ta, focal = 3.4) {
  const f = unit(ta[0] - ro[0], ta[1] - ro[1], ta[2] - ro[2]);
  const r = unit(-f[2], 0, f[0]);
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return { ro, f, r, u, focal };
}

// The ray direction through screen point (sx, sy), both -1..1 across the width.
function ray(cam, sx, sy) {
  return unit(cam.f[0] * cam.focal + cam.r[0] * sx + cam.u[0] * sy,
    cam.f[1] * cam.focal + cam.r[1] * sx + cam.u[1] * sy,
    cam.f[2] * cam.focal + cam.r[2] * sx + cam.u[2] * sy);
}

// A soft studio rig in linear light: a warm key from the upper left front, a
// cool sky fill over a warm ground bounce, and a cool rim from behind.
const STUDIO = {
  key: unit(-0.45, 0.85, 0.55), keyColour: [1.35, 1.27, 1.16],
  sky: [0.42, 0.55, 0.7], bounce: [0.36, 0.3, 0.26], ambient: 0.9,
  rim: unit(-0.55, 0.35, -0.75), rimColour: [0.55, 0.65, 0.85], rimAmount: 0.35,
  fresnel: 0.3,
};

// A surface's colour in linear light: Lambert key times its soft shadow,
// hemisphere ambient and squared rim times occlusion, Blinn-Phong specular
// (mat.spec strength, mat.shine exponent) and, when mat.fresnel, a fifth-power
// Fresnel sheen of the sky. v points from the surface to the eye.
function lit(n, v, albedo, mat, shadow, ao, rig = STUDIO) {
  const L = rig.key;
  const lambert = Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]);
  const hemi = 0.5 + 0.5 * n[1];
  const hx = L[0] + v[0]; const hy = L[1] + v[1]; const hz = L[2] + v[2];
  const hl = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1;
  const spec = mat.spec * Math.pow(Math.max(0, (n[0] * hx + n[1] * hy + n[2] * hz) / hl), mat.shine) * shadow;
  const fres = Math.pow(1 - Math.max(0, n[0] * v[0] + n[1] * v[1] + n[2] * v[2]), 5);
  const rim = Math.pow(Math.max(0, n[0] * rig.rim[0] + n[1] * rig.rim[1] + n[2] * rig.rim[2]), 2) * rig.rimAmount;
  const keyC = rig.keyColour; const skyC = rig.sky; const bounce = rig.bounce; const rimC = rig.rimColour;
  return [0, 1, 2].map((i) => {
    const amb = bounce[i] + (skyC[i] - bounce[i]) * hemi;
    let c = albedo[i] * (keyC[i] * lambert * shadow + amb * ao * rig.ambient + rimC[i] * rim * ao) + keyC[i] * spec;
    if (mat.fresnel) c += skyC[i] * fres * rig.fresnel * ao;
    return c;
  });
}

// Distance fog: mixes `col` toward `sky` by 1 - exp(-density x (t - start)).
function fog(col, sky, t, { start = 4, density = 0.12 } = {}) {
  const f = 1 - Math.exp(-Math.max(0, t - start) * density);
  return col.map((c, i) => c + (sky[i] - c) * f);
}

// A backdrop gradient from `top` to `low` (linear [r, g, b]) at screen
// height v, 0 at the top; power under 1 keeps more of the low colour.
function backdrop(top, low, v, power = 0.8) {
  const t = Math.pow(Math.max(0, Math.min(1, v)), power);
  return [0, 1, 2].map((i) => top[i] + (low[i] - top[i]) * t);
}

// Linear light to an sRGB byte, through the tone curve 1 - exp(-exposure x c).
function encode(c, exposure = 1.1) {
  return Math.round(255 * Math.max(0, Math.min(1, toSRGB(1 - Math.exp(-exposure * c)))));
}

// The canvas's pixel size for a design of w x h: putImageData ignores the
// transform, so render at the size the canvas really has.
function pixelSize(g, w, h) {
  const m = g.getTransform();
  return [g.canvas ? g.canvas.width : Math.max(1, Math.round(w * Math.hypot(m.a, m.b))),
    g.canvas ? g.canvas.height : Math.max(1, Math.round(h * Math.hypot(m.c, m.d)))];
}

// Renders width x height pixels and writes them with putImageData.
// shoot(px, py, out) returns sRGB bytes [r, g, b] for the pixel point (px, py)
// and sets out.id to the material it saw. Pixels whose id differs from a
// four-neighbour are shot again at four rotated-grid points and averaged.
function raster(g, width, height, shoot) {
  const image = g.createImageData(width, height);
  const px = image.data;
  const ids = new Uint8Array(width * height);
  const info = { id: 0 };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = shoot(x + 0.5, y + 0.5, info);
      const i = (y * width + x) * 4;
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
      ids[y * width + x] = info.id;
    }
  }
  const offsets = [[0.375, 0.125], [0.875, 0.375], [0.625, 0.875], [0.125, 0.625]];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const k = y * width + x; const id = ids[k];
      if (id === ids[k + 1] && id === ids[k - 1] && id === ids[k + width] && id === ids[k - width]) continue;
      const sum = [0, 0, 0];
      for (const [ox, oy] of offsets) {
        const c = shoot(x + ox, y + oy, info);
        sum[0] += c[0]; sum[1] += c[1]; sum[2] += c[2];
      }
      const i = k * 4;
      px[i] = Math.round(sum[0] / 4); px[i + 1] = Math.round(sum[1] / 4); px[i + 2] = Math.round(sum[2] / 4);
    }
  }
  g.putImageData(image, 0, 0);
}

module.exports = {
  lin, unit, sphere, ellipsoid, capsule, roundCylinder, smin, span, march, normal, softShadow, occlusion,
  camera, ray, STUDIO, lit, fog, backdrop, encode, pixelSize, raster,
};
