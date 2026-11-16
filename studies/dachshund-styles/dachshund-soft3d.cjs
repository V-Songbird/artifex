// dachshund-soft3d: the same rig, raymarched as a soft-lit clay toy.
// TREATMENT. The same 6 s as dachshund-line, from the same motion tracks and
// the same camera (rig.cjs): the dog looks up, then turns its head to look at
// the camera. Style: 3D render (skills/artifex/styles/render-3d) leads. Every
// part of the rig becomes a signed-distance primitive, both sides of the head
// included, so it holds from any angle. Head parts and ears blend with smooth
// unions; the eyes, nose, collar and tag stay crisp. Additions to the style's
// marks, written here: a wrap term for light that reads as clay letting light
// in near the terminator, a fine grain in the albedo, marks painted on the
// surface (smile, dots, the tag's letter), and a background rendered small and
// blurred so it reads as out of focus behind a sharp subject.
'use strict';
const { rng, noise2 } = require('artifex/core/rand.js');
const { catmullRom } = require('artifex/core/geom.js');
const S3 = require('artifex/styles/render-3d.js');
const rig = require('./rig.cjs');

const { lin, ellipsoid, sphere, capsule, roundCylinder, smin, span, march, normal, softShadow, occlusion, ray, lit, encode, pixelSize, raster, STUDIO } = S3;
const { W, H, HZ, DUR, MODEL: M, LETTER, HILLS, NEAR_HILLS, BUSHES } = rig;

const RIG = { ...STUDIO, key: S3.unit(-0.5, 0.75, 0.6), keyColour: [1.3, 1.2, 1.1], sky: [0.62, 0.5, 0.6], bounce: [0.42, 0.36, 0.3], ambient: 0.85, rimColour: [0.9, 0.75, 0.85], rimAmount: 0.45 };
// A colour that encode() turns back into itself: for what is shown unlit.
const shown = (hex) => lin(hex).map((v) => -Math.log(1 - Math.min(0.985, v)) / 1.05);
const C = {
  fur: lin('#a5582a'), muzzle: lin('#d39858'), ear: lin('#7a3b1c'), smile: lin('#3b1a0d'), dot: lin('#f4e9da'),
  nose: lin('#141012'), white: lin('#f6f0e8'), pupil: lin('#120c0a'), collar: lin('#1e1c20'), tag: lin('#dcdc3c'), letter: lin('#2f8a2c'),
  skyTop: shown('#e88cc2'), skyLow: shown('#f0a6cf'), hill: lin('#8fb85a'), hillNear: lin('#80ad4e'), bush: lin('#f095c4'),
};
// Materials: 1 fur, 2 ear, 3 nose, 4 eye, 5 lid, 6 collar, 7 tag.
const MAT = {
  1: { spec: 0.08, shine: 12 }, 2: { spec: 0.08, shine: 12 }, 3: { spec: 0.7, shine: 80, fresnel: true },
  4: { spec: 0.6, shine: 120, fresnel: true }, 5: { spec: 0.08, shine: 12 }, 6: { spec: 0.45, shine: 50 }, 7: { spec: 0.35, shine: 40 },
};
const SMILE = catmullRom(M.smile, 8);
const IDS = [1, 2, 3, 4, 5, 6, 7];

// iq's round cone: spheres ra at a and rb at b, and the cone between them.
function coneOf(a, b, ra, rb) {
  const ba = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l2 = ba[0] * ba[0] + ba[1] * ba[1] + ba[2] * ba[2];
  const rr = ra - rb;
  return { a, ba, l2, rr, a2: l2 - rr * rr, il2: 1 / l2, ra, rb };
}
function roundCone(x, y, z, c) {
  const px = x - c.a[0], py = y - c.a[1], pz = z - c.a[2];
  const yy = px * c.ba[0] + py * c.ba[1] + pz * c.ba[2];
  const zz = yy - c.l2;
  const qx = px * c.l2 - c.ba[0] * yy, qy = py * c.l2 - c.ba[1] * yy, qz = pz * c.l2 - c.ba[2] * yy;
  const x2 = qx * qx + qy * qy + qz * qz;
  const y2 = yy * yy * c.l2, z2 = zz * zz * c.l2;
  const k = Math.sign(c.rr) * c.rr * c.rr * x2;
  if (Math.sign(zz) * c.a2 * z2 > k) return Math.sqrt(x2 + z2) * c.il2 - c.rb;
  if (Math.sign(yy) * c.a2 * y2 < k) return Math.sqrt(x2 + y2) * c.il2 - c.ra;
  return (Math.sqrt(x2 * c.a2 * c.il2) + yy * c.rr) * c.il2 - c.ra;
}

// Distance from (x, y) to a polyline.
function toLine(x, y, pts) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const h = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(x - a[0] - dx * h, y - a[1] - dy * h));
  }
  return best;
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const blend = (a, b, k) => (k > 0 ? a.map((c, i) => c + (b[i] - c) * k) : a);

// The scene for one pose: distance functions for the dog and the background.
function sceneOf(P) {
  const neck = coneOf(P.chest, P.pivot, M.neck.ra, M.neck.rb);
  const snout = coneOf(M.snout.a, M.snout.b, M.snout.ra, M.snout.rb);
  const m = P.rot;
  const ears = [1, -1].map((side) => { const E = rig.earFrame(P, side); return { ...E, c0: Math.cos(-E.angle), s0: Math.sin(-E.angle) }; });
  const eyes = [1, -1].map((side) => rig.eyeFrame(P, side));
  const jc = Math.cos(-M.jaw.angle), js = Math.sin(-M.jaw.angle);
  const CF = rig.collarFrame(P);
  const T = rig.tagFrame(P);
  const tc = Math.cos(-P.tag), ts = Math.sin(-P.tag);
  const lidH = M.eye.r * (1.12 - 2.25 * P.lid);
  const headBound = [0.5, 0.2, 0, 1.08];   // head frame, generous
  const ex = M.eye.c[0], ey = M.eye.c[1], ez = M.eye.c[2], er = M.eye.r;
  const bx0 = M.brow.c[0], by0 = M.brow.c[1], bz0 = M.brow.c[2];

  // Each part's distance at a world point; with `out`, per material too.
  function parts(x, y, z, out) {
    const body = smin(ellipsoid(x - M.chest.c[0], y - M.chest.c[1], z - M.chest.c[2], ...M.chest.axes), roundCone(x, y, z, neck), 0.3);
    // Into the head frame: the transpose of the head's rotation.
    const dx = x - P.pivot[0], dy = y - P.pivot[1], dz = z - P.pivot[2];
    const hx = m[0][0] * dx + m[1][0] * dy + m[2][0] * dz;
    const hy = m[0][1] * dx + m[1][1] * dy + m[2][1] * dz;
    const hz = m[0][2] * dx + m[1][2] * dy + m[2][2] * dz;
    const bx = hx - headBound[0], by = hy - headBound[1];
    const hb = Math.sqrt(bx * bx + by * by + hz * hz) - headBound[3];
    let fur = body, ear = Infinity, nose = Infinity, eye = Infinity, lid = Infinity;
    if (hb < 0.3) {
      const az = Math.abs(hz);   // paired parts: the near side of either
      let h = ellipsoid(hx - M.skull.c[0], hy - M.skull.c[1], hz, ...M.skull.axes);
      h = smin(h, roundCone(hx, hy, hz, snout), 0.16);
      const jx = hx - M.jaw.c[0], jy = hy - M.jaw.c[1];
      h = smin(h, ellipsoid(jc * jx - js * jy, js * jx + jc * jy, hz, ...M.jaw.axes), 0.12);
      h = smin(h, ellipsoid(hx - bx0, hy - by0, az - bz0, ...M.brow.axes), 0.07);
      fur = smin(fur, h, 0.28);
      nose = sphere(hx - M.nose.c[0], hy - M.nose.c[1], hz - M.nose.c[2], M.nose.r);
      eye = sphere(hx - ex, hy - ey, az - ez, er);
      lid = Math.max(sphere(hx - ex, hy - ey, az - ez, er + 0.014), lidH - (hy - ey));
      for (const E of ears) {
        const ax = hx - E.c[0], ay = hy - E.c[1];
        ear = Math.min(ear, ellipsoid(E.c0 * ax - E.s0 * ay, E.s0 * ax + E.c0 * ay, hz - E.c[2], ...M.ear.axes));
      }
    } else fur = Math.min(fur, hb);
    // Collar: a rounded band round the neck's axis.
    const qx = x - CF.c[0], qy = y - CF.c[1];
    const along = qx * CF.d[0] + qy * CF.d[1];
    const radial = Math.sqrt(Math.max(0, qx * qx + qy * qy + z * z - along * along));
    const ux = Math.abs(radial - M.collar.R) - M.collar.tube, uy = Math.abs(along) - M.collar.half;
    const collar = Math.hypot(Math.max(ux, 0), Math.max(uy, 0)) + Math.min(Math.max(ux, uy), 0) - 0.012;
    // Tag: a disc facing the camera, turned with its swing, and its link.
    const kx = x - T.c[0], ky = y - T.c[1];
    const tx = tc * kx - ts * ky, ty = ts * kx + tc * ky;
    const tag = Math.min(roundCylinder(tx, z - T.c[2], ty, M.tag.r, M.tag.half, 0.015),
      capsule(x, y, z, T.hook[0], T.hook[1], T.hook[2], T.c[0] + (T.hook[0] - T.c[0]) * 0.4, T.c[1] + (T.hook[1] - T.c[1]) * 0.4, T.c[2], 0.016));
    if (out) { out[1] = fur; out[2] = ear; out[3] = nose; out[4] = eye; out[5] = lid; out[6] = collar; out[7] = tag; out.hx = hx; out.hy = hy; out.hz = hz; out.tx = tx; out.ty = ty; }
    // The ears join the head with a small fillet.
    return Math.min(smin(fur, ear, 0.05), nose, eye, lid, collar, tag);
  }
  const sdf = (x, y, z) => parts(x, y, z, null);

  function bg(x, y, z) {
    let d = Infinity, id = 0;
    for (const h of HILLS) { const v = ellipsoid(x - h.c[0], y - h.c[1], z - h.c[2], ...h.axes); if (v < d) { d = v; id = 1; } }
    for (const h of NEAR_HILLS) { const v = ellipsoid(x - h.c[0], y - h.c[1], z - h.c[2], ...h.axes); if (v < d) { d = v; id = 2; } }
    let b = Infinity;
    for (const s of BUSHES) b = smin(b, sphere(x - s.c[0], y - s.c[1], z - s.c[2], s.r), 0.12);
    if (b < d) { d = b; id = 3; }
    bg.id = id;
    return d;
  }
  return { sdf, parts, bg, eyes, T, bound: [-0.1, -0.15, 0, 1.9] };
}

// The background at w x h pixels, rendered at a sixth and blurred: out of focus.
function background(P, scene, w, h) {
  const bw = Math.ceil(w / 6) + 2, bh = Math.ceil(h / 6) + 2;
  let buf = new Float32Array(bw * bh * 3);
  const { ro } = P.cam;
  for (let j = 0; j < bh; j++) {
    for (let i = 0; i < bw; i++) {
      const px = (i - 1 + 0.5) * 6, py = (j - 1 + 0.5) * 6;
      const d = ray(P.cam, (px / w) * 2 - 1, -(py - h / 2) / (w / 2));
      const sky = S3.backdrop(C.skyTop, C.skyLow, py / h, 0.9);
      let col = sky;
      const t = march(scene.bg, ro[0], ro[1], ro[2], d[0], d[1], d[2], 4, 30, { steps: 90, relax: 0.85, eps: 0.002 });
      if (t < Infinity) {
        const x = ro[0] + d[0] * t, y = ro[1] + d[1] * t, z = ro[2] + d[2] * t;
        scene.bg(x, y, z);
        const id = scene.bg.id;
        const n = normal(scene.bg, x, y, z, 0.004);
        const alb = id === 3 ? C.bush : id === 2 ? C.hillNear : C.hill;
        col = lit(n, [-d[0], -d[1], -d[2]], alb, { spec: 0.05, shine: 8 }, 1, 1, RIG);
        col = S3.fog(col, sky, t, { start: 10, density: 0.025 });
      }
      buf.set(col, (j * bw + i) * 3);
    }
  }
  // Two passes of a 5-wide box blur, across and down.
  for (let pass = 0; pass < 2; pass++) {
    for (const across of [true, false]) {
      const out = new Float32Array(buf.length);
      for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let k = -2; k <= 2; k++) {
          const ii = across ? Math.min(bw - 1, Math.max(0, i + k)) : i, jj = across ? j : Math.min(bh - 1, Math.max(0, j + k));
          sum += buf[(jj * bw + ii) * 3 + c];
        }
        out[(j * bw + i) * 3 + c] = sum / 5;
      }
      buf = out;
    }
  }
  return (px, py) => {
    const fx = px / 6 + 0.5, fy = py / 6 + 0.5;
    const i = Math.min(bw - 2, Math.max(0, Math.floor(fx))), j = Math.min(bh - 2, Math.max(0, Math.floor(fy)));
    const u = clamp01(fx - i), v = clamp01(fy - j);
    const at = (ii, jj, c) => buf[(jj * bw + ii) * 3 + c];
    return [0, 1, 2].map((c) => (at(i, j, c) * (1 - u) + at(i + 1, j, c) * u) * (1 - v) + (at(i, j + 1, c) * (1 - u) + at(i + 1, j + 1, c) * u) * v);
  };
}

// The albedo at a hit of material `id`, with the marks painted on the surface.
function albedo(id, o, z, scene) {
  if (id === 1) {
    const { hx, hy, hz } = o;
    const k = hx > 0.2 ? clamp01(((0.15 - 0.1 * (hx - 0.3)) - hy) / 0.12 + 0.5) * Math.min(1, (hx - 0.2) / 0.2) : 0;
    let a = blend(C.fur, C.muzzle, k);
    if (Math.abs(hz) > 0.04 && hx > 0.3) {
      a = blend(a, C.smile, clamp01((0.016 - toLine(hx, hy, SMILE)) / 0.006));
      for (const [dx, dy] of M.dots) a = blend(a, C.dot, clamp01((0.02 - Math.hypot(hx - dx, hy - dy)) / 0.006));
    }
    return a;
  }
  if (id === 2) return C.ear;
  if (id === 3) return C.nose;
  if (id === 5) return C.fur;
  if (id === 6) return C.collar;
  if (id === 7) {
    // The letter on the disc's front face, in units of its radius.
    if (z <= scene.T.c[2]) return C.tag;
    const lx = o.tx / M.tag.r, ly = o.ty / M.tag.r;
    let d = Infinity;
    for (const s of LETTER.strokes) d = Math.min(d, toLine(lx, ly, s));
    return blend(C.tag, C.letter, clamp01((LETTER.width / 2 - d) / 0.04));
  }
  // An eye: white, with a pupil where the eye's surface meets its look.
  const side = o.hz >= 0 ? 0 : 1;
  const E = scene.eyes[side];
  const vx = (o.hx - E.c[0]) / M.eye.r, vy = (o.hy - E.c[1]) / M.eye.r, vz = (o.hz - E.c[2]) / M.eye.r;
  const dot = vx * E.pupil[0] + vy * E.pupil[1] + vz * E.pupil[2];
  return blend(C.white, C.pupil, clamp01((dot - 0.8) / 0.025));
}

function draw(g, s, t, clock) {
  const P = rig.pose(clock.seconds);
  const R = rng(s.seed);
  const scene = sceneOf(P);
  const [w, h] = pixelSize(g, W, H);
  const backAt = background(P, scene, w, h);
  const { ro } = P.cam;
  const out = {};

  raster(g, w, h, (px, py, info) => {
    const d = ray(P.cam, (px / w) * 2 - 1, -(py - h / 2) / (w / 2));
    const hit = span(ro[0], ro[1], ro[2], d[0], d[1], d[2], scene.bound);
    let t = Infinity;
    if (hit) t = march(scene.sdf, ro[0], ro[1], ro[2], d[0], d[1], d[2], Math.max(0, hit[0]), hit[1], { steps: 140, relax: 0.9, eps: 0.0005 });
    if (t === Infinity) { info.id = 0; return backAt(px, py).map((c) => encode(c, 1.05)); }
    const x = ro[0] + d[0] * t, y = ro[1] + d[1] * t, z = ro[2] + d[2] * t;
    scene.parts(x, y, z, out);
    let id = 1, best = out[1];
    for (const k of IDS) if (out[k] < best) { best = out[k]; id = k; }
    info.id = id;
    const n = normal(scene.sdf, x, y, z);
    let alb = albedo(id, out, z, scene);
    const clay = id === 1 || id === 2 || id === 5;
    if (clay) {
      // A fine grain, as on a moulded clay surface.
      const gr = 1 + 0.07 * (noise2(R, x * 38 + z * 13, y * 38 - z * 7, 'grain') - 0.5);
      alb = alb.map((c) => c * gr);
    }
    const L = RIG.key;
    const facing = n[0] * L[0] + n[1] * L[1] + n[2] * L[2];
    const sh = facing > 0 ? softShadow(scene.sdf, x + n[0] * 0.004, y + n[1] * 0.004, z + n[2] * 0.004, L, scene.bound, { k: 7, steps: 48 }) : 0;
    const ao = occlusion(scene.sdf, x, y, z, n[0], n[1], n[2], { strength: 1.3, floor: 0.35 });
    let col = lit(n, [-d[0], -d[1], -d[2]], alb, MAT[id], sh, ao, RIG);
    if (clay) {
      // Light that soaks in past the terminator, warm.
      const wrap = Math.max(0, (facing + 0.45) / 1.45) - Math.max(0, facing) * sh;
      col = col.map((c, i) => c + alb[i] * [1.0, 0.45, 0.3][i] * wrap * 0.35 * ao);
    }
    return col.map((c) => encode(c, 1.05));
  });
}

module.exports = {
  name: 'dachshund-soft3d',
  size: { w: W, h: H },
  time: { duration: DUR, hz: HZ },
  seed: 1,
  draw,
};
