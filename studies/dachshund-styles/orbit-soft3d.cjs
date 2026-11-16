// orbit-soft3d: the soft-3D piece with the pose frozen at 2 s and the camera
// orbiting the dog. A painted 2D picture cannot be seen from another side.
'use strict';
const rig = require('./rig.cjs');
const piece = require('./dachshund-soft3d.cjs');
const pose = rig.pose;
function basis(ro, ta, focal) {
  const d = [ta[0] - ro[0], ta[1] - ro[1], ta[2] - ro[2]]; const n = Math.hypot(...d); const f = d.map((v) => v / n);
  const rl = Math.hypot(f[2], f[0]); const r = [-f[2] / rl, 0, f[0] / rl];
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return { ro, ta, focal, f, r, u };
}
module.exports = {
  name: 'orbit-soft3d', size: piece.size, seed: 1, time: { duration: 4, hz: 24 },
  draw(g, s, t, clock) {
    const yaw = -0.9 + 2.2 * t;              // radians round the vertical axis
    rig.pose = () => {
      const P = pose(2.0);
      const ta = [0.1, 0.1, 0]; const dist = 8; const up = 0.25;
      const ro = [ta[0] + dist * Math.sin(yaw) * Math.cos(up), ta[1] + dist * Math.sin(up), ta[2] + dist * Math.cos(yaw) * Math.cos(up)];
      P.cam = basis(ro, ta, 3.4);
      return P;
    };
    try { piece.draw(g, s, 0, { ...clock, seconds: 2.0 }); } finally { rig.pose = pose; }
  },
};
