// rig: the dachshund animated ONCE. One 3D model (parts, joints, camera) and
// one set of motion tracks over the playhead. It draws nothing: each style
// piece reads pose(seconds) and renders the same model its own way.
//
// World units, y up, x right, z toward the camera. The dog faces +x and shows
// its left side (+z in the head frame). Head parts are written in the head
// frame: relative to the neck pivot, before the head pitches and turns.
// Paired parts (eyes, ears, brows, smile) are written once for the left side
// and mirrored across z for the right.
'use strict';
const { flow, follow, ease } = require('artifex/core/time.js');

const W = 1280, H = 720, HZ = 24, DUR = 6;

// ---- motion tracks, in seconds -------------------------------------------
// Pose to pose with moving holds. The head looks up, then turns to look at
// the camera and stays there; the eyes lead the head by a few frames and the
// ears and tag trail it on springs.
const pitchTrack = flow([[0, 0.0], [1.0, 0.02], [1.8, 0.3], [2.8, 0.34], [3.6, -0.04], [4.5, -0.07], [5.2, 0.05], [6, 0.07]]);
const turnTrack = flow([[0, 0.0], [2.85, 0.0], [3.8, 1.02], [4.6, 1.06], [5.4, 0.88], [6, 0.86]]);
const leanTrack = flow([[0, 0.0], [1.0, 0.0], [1.9, 0.05], [2.8, 0.06], [3.7, -0.035], [4.5, -0.04], [5.2, 0.02], [6, 0.02]]);
// The gaze moves along targets in the world: ahead, up at the sky, then the camera.
const gazeTrack = flow([[0, 0], [0.85, 0], [1.15, 1], [2.65, 1], [2.95, 2], [6, 2]]);
const BLINKS = [2.25, 5.25];
// The ears' angle in the world hangs behind the head's on an under-damped spring.
const earWorld = follow((s) => 0.55 * (pitchTrack(s) + leanTrack(s)), { stiffness: 70, damping: 0.22 });
const tagWorld = follow((s) => 0.8 * leanTrack(s) + 0.25 * pitchTrack(s), { stiffness: 110, damping: 0.18 });

function blinkAt(s) {
  let lid = 0;
  for (const b of BLINKS) {
    const u = s - b;
    if (u < 0 || u > 0.24) continue;
    lid = Math.max(lid, u < 0.08 ? ease.inOut(u / 0.08) : 1 - ease.inOut((u - 0.08) / 0.16));
  }
  return lid;
}

// ---- the model -------------------------------------------------------------
const CHEST = [-0.45, -1.42, 0];
const NECK_TOP = [-0.12, 0.3, 0];           // the head pivot at rest
const MODEL = {
  chest: { c: [-0.55, -1.75, 0], axes: [1.0, 0.62, 0.6] },
  neck: { ra: 0.62, rb: 0.42 },              // round cone, chest end to pivot end
  skull: { c: [0.06, 0.3, 0], axes: [0.5, 0.42, 0.42] },
  brow: { c: [0.24, 0.53, 0.25], axes: [0.15, 0.06, 0.09] },       // left; mirrored
  snout: { a: [0.3, 0.17, 0], ra: 0.31, b: [1.0, 0.06, 0], rb: 0.18 },
  jaw: { c: [0.55, -0.04, 0], axes: [0.36, 0.15, 0.2], angle: -0.06 },
  nose: { c: [1.1, 0.08, 0], r: 0.17 },
  eye: { c: [0.25, 0.37, 0.31], r: 0.13 },                         // left; mirrored
  ear: { root: [-0.04, 0.5, 0.3], hang: [-0.06, -0.48, 0.1], axes: [0.27, 0.56, 0.1], rest: -0.12 },  // left; mirrored
  smile: [[0.95, -0.03], [0.8, -0.1], [0.62, -0.1], [0.48, -0.04], [0.42, 0.04], [0.43, 0.08]],     // on each side
  dots: [[0.93, 0.07], [0.86, 0.04]],
  collar: { at: 0.42, R: 0.5, half: 0.075, tube: 0.05 },
  tag: { r: 0.13, half: 0.022, drop: 0.2 },
};
// The tag's letter as strokes on the disc, in units of the disc's radius.
const LETTER = (() => {
  // y grows up; the bowl sits in the top half, round the right.
  const s = 0.48;
  const bowl = [];
  for (let i = 1; i <= 12; i++) { const a = Math.PI / 2 - (Math.PI * i) / 12; bowl.push([s * 0.1 + s * 0.5 * Math.cos(a), s * 0.5 + s * 0.5 * Math.sin(a)]); }
  return {
    width: 0.2,
    strokes: [
      [[-s * 0.55, -s], [-s * 0.55, s], [s * 0.1, s], ...bowl, [-s * 0.55, 0]],
      [[0, 0], [s * 0.6, -s]],
    ],
  };
})();

// The background, in world units, far behind the dog.
const HILLS = [
  { c: [-3.6, -2.7, -6], axes: [3.4, 2.5, 1.2] },
  { c: [3.2, -3.0, -6], axes: [4.2, 2.4, 1.2] },
  { c: [0.3, -2.75, -6.5], axes: [2.6, 2.05, 1.0] },
];
const NEAR_HILLS = [
  { c: [-2.0, -3.25, -3], axes: [4.0, 2.0, 1.0] },
  { c: [3.6, -3.1, -3], axes: [3.0, 1.95, 1.0] },
];
const BUSHES = [
  { c: [-2.3, -1.42, -1.6], r: 0.36 }, { c: [-1.88, -1.5, -1.5], r: 0.3 }, { c: [-2.7, -1.5, -1.7], r: 0.28 },
  { c: [2.6, -1.3, -2.0], r: 0.32 }, { c: [2.98, -1.38, -2.0], r: 0.26 },
];

// ---- helpers ---------------------------------------------------------------
const rotZ = (p, a, o) => {
  const c = Math.cos(a), s = Math.sin(a);
  const x = p[0] - o[0], y = p[1] - o[1];
  return [o[0] + c * x - s * y, o[1] + s * x + c * y, p[2]];
};
const mirror = (p, side) => [p[0], p[1], p[2] * side];
const norm = (v) => { const n = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / n, v[1] / n, v[2] / n]; };

function basis(cam) {
  const d = [cam.ta[0] - cam.ro[0], cam.ta[1] - cam.ro[1], cam.ta[2] - cam.ro[2]];
  const f = norm(d);
  const rl = Math.hypot(f[2], f[0]);
  const r = [-f[2] / rl, 0, f[0] / rl];
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return { ...cam, f, r, u };
}

/** Everything a style needs at `s` seconds: camera, joints and motion values. */
function pose(s) {
  const drift = 0.1 * ease.inOut(s / DUR);   // a slow dolly, for parallax
  const cam = basis({ ro: [0.2 + drift, 0, 8], ta: [0.2 + drift * 0.5, 0, 0], focal: 3.4 });
  const lean = leanTrack(s);
  const breath = 0.012 * Math.sin((2 * Math.PI * s) / 2.0);
  const pivot = rotZ([NECK_TOP[0], NECK_TOP[1] + breath, 0], lean, CHEST);
  const pitch = pitchTrack(s) + lean;
  const turn = turnTrack(s);
  const g = gazeTrack(s);
  const targets = [[6, 0.5, 0.4], [2.6, 5, 1.2], cam.ro];
  const i = Math.min(1, Math.floor(g)), u = g - i;
  const gaze = [0, 1, 2].map((k) => targets[i][k] + (targets[i + 1][k] - targets[i][k]) * u);
  const P = {
    s, cam, W, H,
    chest: CHEST, pivot, lean, pitch, turn,
    ear: MODEL.ear.rest + earWorld(s) - pitch,
    tag: tagWorld(s) - lean,
    gaze,
    lid: blinkAt(s),
  };
  // The head's rotation, head frame to world: pitch about z, then turn about y.
  const cp = Math.cos(pitch), sp = Math.sin(pitch), ct = Math.cos(turn), st = Math.sin(turn);
  P.rot = [[ct * cp, -ct * sp, -st], [sp, cp, 0], [st * cp, -st * sp, ct]];
  return P;
}

/** A head-frame point [x, y, z] in world space for pose P. */
function headToWorld(P, p) {
  const m = P.rot;
  return [P.pivot[0] + m[0][0] * p[0] + m[0][1] * p[1] + m[0][2] * p[2],
    P.pivot[1] + m[1][0] * p[0] + m[1][1] * p[1] + m[1][2] * p[2],
    P.pivot[2] + m[2][0] * p[0] + m[2][1] * p[1] + m[2][2] * p[2]];
}
/** A head-frame direction in world space. */
function headDir(P, v) {
  const m = P.rot;
  return [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2], m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2], m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]];
}
/** A world point in the head frame for pose P (the inverse of headToWorld). */
function worldToHead(P, x, y, z) {
  const m = P.rot;
  const dx = x - P.pivot[0], dy = y - P.pivot[1], dz = z - P.pivot[2];
  return [m[0][0] * dx + m[1][0] * dy + m[2][0] * dz, m[0][1] * dx + m[1][1] * dy + m[2][1] * dz, m[0][2] * dx + m[1][2] * dy + m[2][2] * dz];
}

/** One ear in the head frame (side 1 left, -1 right): root, centre and the angle it hangs at. */
function earFrame(P, side = 1) {
  const e = MODEL.ear;
  const c = rotZ([e.root[0] + e.hang[0], e.root[1] + e.hang[1], (e.root[2] + e.hang[2]) * side], P.ear, e.root);
  return { root: mirror(e.root, side), c, angle: P.ear };
}

/** One eye in the head frame: its centre, and the unit direction its pupil looks along. */
function eyeFrame(P, side = 1) {
  const c = mirror(MODEL.eye.c, side);
  const out = norm([c[0] - MODEL.skull.c[0], c[1] - MODEL.skull.c[1], c[2] - MODEL.skull.c[2]]);
  const t = worldToHead(P, ...P.gaze);
  const g = norm([t[0] - c[0], t[1] - c[1], t[2] - c[2]]);
  return { c, out, pupil: norm([out[0] + 1.4 * g[0], out[1] + 1.4 * g[1], out[2] + 1.4 * g[2]]) };
}

/** The collar ring: centre, the neck's unit axis (chest to pivot) and its perpendicular, in world space. */
function collarFrame(P) {
  const a = P.chest, b = P.pivot;
  const ax = [b[0] - a[0], b[1] - a[1]];
  const L = Math.hypot(ax[0], ax[1]);
  const d = [ax[0] / L, ax[1] / L];
  const t = 1 - MODEL.collar.at;
  const c = [a[0] + ax[0] * t, a[1] + ax[1] * t, 0];
  return { c, d, n: [d[1], -d[0]] };   // n points to the throat side (+x)
}

/** The tag: its centre (world), hanging from the collar's front, swinging by P.tag. */
function tagFrame(P) {
  const C = collarFrame(P);
  const R = MODEL.collar.R;
  const hook = [C.c[0] + C.n[0] * R * 0.45 - C.d[0] * MODEL.collar.half, C.c[1] + C.n[1] * R * 0.45 - C.d[1] * MODEL.collar.half, R * 0.88];
  const down = MODEL.tag.drop;
  const c = [hook[0] + Math.sin(P.tag) * down, hook[1] - Math.cos(P.tag) * down, hook[2] + 0.04];
  return { hook, c };
}

/** Screen position (design pixels) and the depth along the view of a world point. */
function project(P, p) {
  const { ro, f, r, u, focal } = P.cam;
  const d = [p[0] - ro[0], p[1] - ro[1], p[2] - ro[2]];
  const z = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
  const sx = (focal * (d[0] * r[0] + d[1] * r[1] + d[2] * r[2])) / z;
  const sy = (focal * (d[0] * u[0] + d[1] * u[1] + d[2] * u[2])) / z;
  return [W / 2 + (sx * W) / 2, H / 2 - (sy * W) / 2, z];
}

/** How much a surface with world normal n faces the camera from world point p: above 0 faces it. */
function facing(P, p, n) {
  const v = norm([P.cam.ro[0] - p[0], P.cam.ro[1] - p[1], P.cam.ro[2] - p[2]]);
  return v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
}

module.exports = {
  W, H, HZ, DUR, MODEL, LETTER, HILLS, NEAR_HILLS, BUSHES,
  pose, headToWorld, headDir, worldToHead, earFrame, eyeFrame, collarFrame, tagFrame, project, facing, rotZ, mirror,
};
