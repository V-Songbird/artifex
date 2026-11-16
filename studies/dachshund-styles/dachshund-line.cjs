// dachshund-line: the rig drawn as clean line art, white on black.
// TREATMENT. A dachshund looks up at something, blinks, turns its head to look
// at us and settles, 6 s. The motion lives in rig.cjs and is shared with the
// 3D piece.
// LINE: one constant width, round caps and joins, smooth curves only. Every
// outline is the exact outline of the 3D model seen through the rig's camera:
// an ellipsoid's outline in perspective is an ellipse, found from its dual
// quadric; a round cone's is the convex hull of its two spheres' outlines. The
// parts' outlines are united, then closed (grown and shrunk by one radius) so
// joins get fillets the way smooth unions do in 3D. Parts are drawn back to
// front, each filled with the ground colour, so a front part hides the lines
// behind it; a paired part on the far side of the head is drawn before the
// head, or not at all when it faces away. Nothing wobbles, so nothing boils
// from frame to frame.
'use strict';
const { union, offset } = require('artifex/core/clip.js');
const { catmullRom } = require('artifex/core/geom.js');
const rig = require('./rig.cjs');

const { W, H, HZ, DUR, MODEL: M, LETTER, HILLS, NEAR_HILLS, BUSHES } = rig;
const INK = '#f3efe6';
const GROUND = '#0a0a0a';
const LW = 4.2;
const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

const mul3 = (a, b) => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));
const rotZm = (a) => { const c = Math.cos(a), s = Math.sin(a); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; };

// The camera as a 3 x 4 matrix from world points to homogeneous design pixels.
function cameraMatrix(P) {
  const { ro, r, u, f, focal } = P.cam;
  const k = (W / 2) * focal;
  const rows = [r, u, f].map((v) => [v[0], v[1], v[2], -(v[0] * ro[0] + v[1] * ro[1] + v[2] * ro[2])]);
  return [
    rows[0].map((v, j) => k * v + (W / 2) * rows[2][j]),
    rows[1].map((v, j) => -k * v + (H / 2) * rows[2][j]),
    rows[2],
  ];
}

// The outline of the ellipsoid c + rot * diag(axes) * s, |s| = 1, as a ring of
// design pixels: the dual quadric projected to a dual conic, then the ellipse
// read back from it as centre + L [cos, sin].
function ellipsoidRing(P, c, axes, rot = I3, n = 72) {
  const Pm = P.Pm;
  const cols = [0, 1, 2].map((k) => [0, 1, 2].map((i) => (Pm[i][0] * rot[0][k] + Pm[i][1] * rot[1][k] + Pm[i][2] * rot[2][k]) * axes[k]));
  const w = [0, 1, 2].map((i) => Pm[i][0] * c[0] + Pm[i][1] * c[1] + Pm[i][2] * c[2] + Pm[i][3]);
  const Cs = [0, 1, 2].map((i) => [0, 1, 2].map((j) => cols[0][i] * cols[0][j] + cols[1][i] * cols[1][j] + cols[2][i] * cols[2][j] - w[i] * w[j]));
  const s = -Cs[2][2];
  const x0 = [-Cs[0][2] / s, -Cs[1][2] / s];
  const a = Cs[0][0] / s + x0[0] * x0[0], b = Cs[0][1] / s + x0[0] * x0[1], d = Cs[1][1] / s + x0[1] * x0[1];
  const l11 = Math.sqrt(a), l21 = b / l11, l22 = Math.sqrt(Math.max(0, d - l21 * l21));
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n, ct = Math.cos(t), st = Math.sin(t);
    out.push([x0[0] + l11 * ct, x0[1] + l21 * ct + l22 * st]);
  }
  return out;
}
const sphereRing = (P, c, r, n = 48) => ellipsoidRing(P, c, [r, r, r], I3, n);

// The convex hull of a set of points (monotone chain).
function hull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
// A round cone is the convex hull of its two spheres, and so is its outline.
const coneRing = (P, A, ra, B, rb) => hull([...sphereRing(P, A, ra, 64), ...sphereRing(P, B, rb, 64)]);

// Every ring wound one way, so a union adds the parts instead of cutting holes.
function wound(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a < 0 ? ring.slice().reverse() : ring;
}
const merged = (rings) => union(rings.map(wound));
// Merged and closed by `k` pixels: concave joins round off, convex edges stay.
const closed = (rings, k) => offset(offset(merged(rings), k, { join: 'round' }), -k, { join: 'round' });

function trace(g, rings) {
  g.beginPath();
  for (const ring of rings) {
    g.moveTo(ring[0][0], ring[0][1]);
    for (let i = 1; i < ring.length; i++) g.lineTo(ring[i][0], ring[i][1]);
    g.closePath();
  }
}
// A part: filled with the ground so it hides what is behind, then inked.
function part(g, rings) {
  trace(g, rings);
  g.fillStyle = GROUND;
  g.fill('nonzero');
  g.stroke();
}
function line(g, pts) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.stroke();
}

function draw(g, s, t, clock) {
  const P = rig.pose(clock.seconds);
  P.Pm = cameraMatrix(P);
  const head = (p) => rig.headToWorld(P, p);
  const xy = (p) => { const q = rig.project(P, p); return [q[0], q[1]]; };
  const faces = (p, n) => rig.facing(P, head(p), rig.headDir(P, n));

  g.fillStyle = GROUND;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = INK;
  g.lineWidth = LW;
  g.lineJoin = 'round';
  g.lineCap = 'round';

  // Background, far to near.
  part(g, merged(HILLS.map((h) => ellipsoidRing(P, h.c, h.axes, I3, 160))));
  part(g, merged(NEAR_HILLS.map((h) => ellipsoidRing(P, h.c, h.axes, I3, 160))));
  for (const side of [BUSHES.slice(0, 3), BUSHES.slice(3)]) part(g, closed(side.map((b) => sphereRing(P, b.c, b.r)), 6));

  // Paired parts: which side faces the camera.
  const near = [1, -1].map((side) => faces([0, 0, 0], [0, 0, side]) > 0);
  const ear = (side) => {
    const E = rig.earFrame(P, side);
    part(g, [ellipsoidRing(P, head(E.c), M.ear.axes, mul3(P.rot, rotZm(E.angle)), 96)]);
  };
  for (const side of [1, -1]) if (!near[side > 0 ? 0 : 1]) ear(side);

  // Body and head: one silhouette from chest, neck, skull, snout, jaw and brows.
  const body = [
    ellipsoidRing(P, M.chest.c, M.chest.axes),
    coneRing(P, P.chest, M.neck.ra, P.pivot, M.neck.rb),
    ellipsoidRing(P, head(M.skull.c), M.skull.axes, P.rot),
    coneRing(P, head(M.snout.a), M.snout.ra, head(M.snout.b), M.snout.rb),
    ellipsoidRing(P, head(M.jaw.c), M.jaw.axes, mul3(P.rot, rotZm(M.jaw.angle))),
    ...[1, -1].map((side) => ellipsoidRing(P, head(rig.mirror(M.brow.c, side)), M.brow.axes, P.rot, 32)),
  ];
  part(g, closed(body, 30));

  // Collar: the half of a ring round the neck that faces the camera, as a band.
  const C = rig.collarFrame(P);
  const toCam = [P.cam.ro[0] - C.c[0], P.cam.ro[1] - C.c[1], P.cam.ro[2] - C.c[2]];
  const mid = Math.atan2(toCam[2], toCam[0] * C.n[0] + toCam[1] * C.n[1]);
  const ring = (side) => {
    const out = [];
    for (let i = 0; i <= 32; i++) {
      const f = mid - Math.PI / 2 + (Math.PI * i) / 32, R = M.collar.R;
      out.push(xy([C.c[0] + R * Math.cos(f) * C.n[0] + side * M.collar.half * C.d[0],
        C.c[1] + R * Math.cos(f) * C.n[1] + side * M.collar.half * C.d[1], R * Math.sin(f)]));
    }
    return out;
  };
  part(g, [[...ring(1), ...ring(-1).reverse()]]);

  // Tag: a link from the collar and a disc with its letter.
  const T = rig.tagFrame(P);
  const hk = xy(T.hook), tc = rig.project(P, T.c);
  const tr = (M.tag.r * P.cam.focal) / tc[2] * (W / 2);
  const dl = Math.hypot(tc[0] - hk[0], tc[1] - hk[1]) || 1;
  const dx = (tc[0] - hk[0]) / dl, dy = (tc[1] - hk[1]) / dl;
  line(g, [hk, [tc[0] - dx * tr, tc[1] - dy * tr]]);
  part(g, [ellipsoidRing(P, T.c, [M.tag.r, M.tag.r, 0.001], rotZm(P.tag), 48)]);
  g.save();
  g.translate(tc[0], tc[1]); g.rotate(-P.tag); g.scale(tr, -tr);
  g.lineWidth = (LW * 0.7) / tr;
  for (const st of LETTER.strokes) line(g, st);
  g.restore();

  // Nose at the snout's tip.
  part(g, [sphereRing(P, head(M.nose.c), M.nose.r)]);

  // Smile and dots on each side that faces us.
  g.fillStyle = INK;
  for (const side of [1, -1]) {
    if (faces([0.7, 0, 0.2 * side], [0, -0.2, side]) < 0.08) continue;
    line(g, catmullRom(M.smile.map(([x, y]) => xy(head([x, y, 0.21 * side]))), 10));
    for (const [x, y] of M.dots) { const q = xy(head([x, y, 0.19 * side])); g.beginPath(); g.arc(q[0], q[1], LW * 0.75, 0, 2 * Math.PI); g.fill(); }
  }

  // Eyes that face us: an outlined ball, a solid pupil along the eye's look,
  // a lid for blinks, and a brow.
  for (const side of [1, -1]) {
    const E = rig.eyeFrame(P, side);
    if (faces(E.c, E.out) < 0.05) continue;
    const ball = sphereRing(P, head(E.c), M.eye.r, 64);
    const ec = xy(head(E.c));
    const er = Math.max(...ball.map((p) => Math.hypot(p[0] - ec[0], p[1] - ec[1])));
    const pc = xy(head([E.c[0] + E.pupil[0] * M.eye.r, E.c[1] + E.pupil[1] * M.eye.r, E.c[2] + E.pupil[2] * M.eye.r]));
    g.save();
    trace(g, [ball]); g.fillStyle = GROUND; g.fill(); g.clip();
    g.fillStyle = INK;
    g.beginPath(); g.arc(pc[0], pc[1], er * 0.42, 0, 2 * Math.PI); g.fill();
    if (P.lid > 0.001) {
      // The lid comes down across the ball, level with the head.
      const up = xy(head([E.c[0], E.c[1] + 1, E.c[2]]));
      g.translate(ec[0], ec[1]); g.rotate(Math.atan2(up[0] - ec[0], ec[1] - up[1]));
      const y = -er + 2.05 * er * P.lid;
      g.fillStyle = GROUND; g.fillRect(-er * 1.2, -er * 1.2, er * 2.4, y + er * 1.2);
      g.beginPath(); g.moveTo(-er * 1.1, y); g.quadraticCurveTo(0, y + er * 0.25 * P.lid, er * 1.1, y); g.stroke();
    }
    g.restore();
    trace(g, [ball]); g.stroke();
    const brow = [[-0.08, 0.13], [0.0, 0.17], [0.09, 0.15]].map(([x, y]) => xy(head([E.c[0] + x, E.c[1] + y, E.c[2] - 0.02 * side])));
    line(g, catmullRom(brow, 8));
  }

  // The near ear last: it hangs in front of the skull and the neck.
  for (const side of [1, -1]) if (near[side > 0 ? 0 : 1]) ear(side);
}

module.exports = {
  name: 'dachshund-line',
  size: { w: W, h: H },
  time: { duration: DUR, hz: HZ },
  seed: 1,
  draw,
};
