// raking-light -- plotter-native. One pen, no fills: tone is how close the lines lie.
//
// It takes its tone from a light. Every line is a curve on a solid's surface,
// so it turns with the form. Each point on it asks two things: does the eye see
// this, and how much of the light arrives? A ray answers both. Lines are
// numbered so that every eighth is drawn first, then the ones between, and each
// joins in only where the surface is dark enough: spacing halves as the light
// falls, and a lit surface is bare paper.
//
// Run by path, not by name: it is not in examples/index.js.

'use strict';

const { rng } = require('artifex/core/rand.js');
const { stroke, clipPolyline, boxOf } = require('artifex/core/path.js');
const { box, cylinder, loft, place, camera, outlines, bvh } = require('artifex/core/solid.js');

const W = 1200;
const H = 900;
const M = 50;
const PAPER = '#f8f5ec';
const PEN = '#1c2230';

// How dark a surface must be before a line of each rank is drawn.
const RANKS = [0.2, 0.38, 0.56, 0.74];
const CROSS_RANKS = [0.76, 0.91];
const GAP = 0.034;          // model units between the closest lines

const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const sub = (a, b) => add(a, b, -1);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const n = Math.hypot(...a); return [a[0] / n, a[1] / n, a[2] / n]; };
const lerp = (a, b, t) => add(a, sub(b, a), t);
const rank = (i, levels) => { for (let k = 0; k < levels - 1; k++) if (i % 2 ** (levels - 1 - k) === 0) return k; return levels - 1; };

function sphereSolid(at, r, rows = 28, sides = 56) {
  const rings = [];
  for (let j = 1; j < rows; j++) {
    const lat = -Math.PI / 2 + Math.PI * j / rows;
    rings.push(Array.from({ length: sides }, (_, i) => {
      const a = i / sides * Math.PI * 2;
      return [at[0] + r * Math.cos(lat) * Math.cos(a), at[1] + r * Math.cos(lat) * Math.sin(a), at[2] + r * Math.sin(lat)];
    }));
  }
  return loft(rings, { smooth: true });
}

// Rings round `axis`: each is a list of { p, n } on the true sphere.
function sphereLines(at, r, axis, gap) {
  const a = unit(axis), u = unit(cross(Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], a)), v = cross(a, u);
  const count = Math.round(Math.PI * r / gap), lines = [];
  for (let k = 1; k < count; k++) {
    const lat = -Math.PI / 2 + Math.PI * k / count, c = Math.cos(lat), s = Math.sin(lat), steps = Math.max(12, Math.ceil(2 * Math.PI * r * c / 0.035)), line = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps * Math.PI * 2, n = add(add(add([0, 0, 0], a, s), u, c * Math.cos(t)), v, c * Math.sin(t));
      line.push({ p: add(at, n, r), n });
    }
    lines.push(line);
  }
  return lines;
}

// A cone cut short, in rings (`along` false) or in lines up its side (`along` true).
function coneLines(at, r, top, h, along, gap) {
  const slope = (r - top) / h, normal = (a) => unit([Math.cos(a), Math.sin(a), slope]), lines = [];
  const point = (a, z) => { const w = r + (top - r) * z / h; return [at[0] + w * Math.cos(a), at[1] + w * Math.sin(a), at[2] + z]; };
  if (along) {
    const count = Math.round(2 * Math.PI * r / gap);
    for (let k = 0; k < count; k++) {
      const a = k / count * Math.PI * 2, steps = Math.ceil(h / 0.05), line = [];
      for (let i = 0; i <= steps; i++) line.push({ p: point(a, h * i / steps), n: normal(a) });
      lines.push(line);
    }
    return lines;
  }
  const count = Math.round(h / gap);
  for (let k = 1; k < count; k++) {
    const z = h * k / count, steps = Math.ceil(2 * Math.PI * r / 0.04), line = [];
    for (let i = 0; i <= steps; i++) { const a = i / steps * Math.PI * 2; line.push({ p: point(a, z), n: normal(a) }); }
    lines.push(line);
  }
  return lines;
}

// Straight lines across each four-sided face of a solid, one way or the other.
function faceLines(solid, turned, gap) {
  const lines = [];
  for (const face of solid.faces) {
    if (face.ring.length !== 4) continue;
    let [a, b, c, d] = face.ring.map((i) => solid.points[i]);
    const n = unit(cross(sub(b, a), sub(d, a)));
    if (turned) [a, b, c, d] = [b, c, d, a];
    const count = Math.max(2, Math.round(Math.hypot(...sub(d, a)) / gap));
    for (let k = 1; k < count; k++) {
      const t = k / count, from = lerp(a, d, t), to = lerp(b, c, t), steps = Math.ceil(Math.hypot(...sub(to, from)) / 0.05), line = [];
      for (let i = 0; i <= steps; i++) line.push({ p: lerp(from, to, i / steps), n });
      lines.push(line);
    }
  }
  return lines;
}

function groundLines(half, gap, angle) {
  const u = [Math.cos(angle), Math.sin(angle), 0], v = [-u[1], u[0], 0], count = Math.round(2 * half / gap), lines = [], steps = Math.ceil(2 * half / 0.045);
  for (let k = 0; k <= count; k++) {
    const line = [], off = -half + 2 * half * k / count;
    for (let i = 0; i <= steps; i++) line.push({ p: add(add([0, 0, 0], v, off), u, -half + 2 * half * i / steps), n: [0, 0, 1] });
    lines.push(line);
  }
  return lines;
}

module.exports = {
  name: 'raking-light',
  size: { w: W, h: H },
  outputs: ['raster', 'vector'],
  time: null,
  seed: 2026,
  params: {
    bearing: { min: -3.14, max: 3.14, value: -2.25, meaning: 'where the light stands round the group, in radians' },
    height: { min: 0.25, max: 1.3, value: 0.86, meaning: 'how high the light stands above the ground, in radians' },
  },

  state: () => ({ paths: [], edges: [], rays: 0 }),

  build: [
    ['model the forms', (s) => {
      const ball = [-0.35, -0.2, 1.72];
      s.forms = [
        { solid: box([16, 16, 0.2], [-8, -8, -0.2]), ground: true },
        { solid: place(box([3.3, 3.3, 0.47], [-1.65, -1.65, 0]), { turn: 0.5, move: [-0.35, -0.2, 0] }), flat: true },
        { solid: sphereSolid(ball, 1.25), ball, r: 1.25 },
        { solid: cylinder(0.78, 3.7, { at: [2.15, 1.9, 0], top: 0.42, sides: 56 }), cone: { at: [2.15, 1.9, 0], r: 0.78, top: 0.42, h: 3.7 } },
        { solid: place(box([1.15, 1.15, 1.15], [-0.575, -0.575, 0]), { turn: -0.42, move: [-3.2, -0.5, 0] }), flat: true },
      ];
      s.cam = camera({ eye: [6.6, -11, 5.6], target: [0.75, 1.0, 1.2], lens: 46, frame: [0, 0, W, H] });
      s.tree = bvh(s.forms.map((f) => f.solid));
      const { bearing, height } = s.params;
      s.light = [Math.cos(height) * Math.cos(bearing), Math.cos(height) * Math.sin(bearing), Math.sin(height)];
    }],

    ['lay the lines by the light', (s) => {
      const R = rng(s.seed), { tree, cam, light } = s, frame = boxOf({ w: W, h: H }, M), paths = [];
      let id = 0, serial = 0;

      const dark = (p, n, ground) => {
        const facing = dot(n, light);
        const open = tree.ao(p, n, R, id, { samples: 5, radius: 0.9 });
        const lit = facing > 0 ? tree.softShadow(p, n, light, R, id, { samples: 4, spread: 0.035, far: 30 }) : 0;
        id++;
        if (ground) return Math.min(1, (1 - lit) * 0.84 + (1 - open) * 0.42);
        const sky = 0.1 * (n[2] + 1) / 2;
        return 1 - Math.min(1, Math.max(0, facing) * lit * 1.08 + sky + 0.05 * open);
      };

      const lay = (lines, ranks, ground = false) => {
        lines.forEach((line, index) => {
          const need = ranks[rank(index, ranks.length)], who = serial++;
          const drift = (R('hatch', 'level', who) - 0.5) * 0.07, phase = R('hatch', 'phase', who) * 6.28, wave = 1.5 + R('hatch', 'wave', who) * 3;
          const wobX = R('hatch', 'x', who) * 6.28, wobY = R('hatch', 'y', who) * 6.28;
          let run = [];
          const close = () => {
            if (run.length >= 4) for (const piece of clipPolyline(run, frame)) if (piece.length >= 2) paths.push(piece);
            run = [];
          };
          line.forEach(({ p, n }, i) => {
            const toEye = sub(cam.eye, p), far = Math.hypot(...toEye), eye = unit(toEye);
            const seen = dot(n, eye) > 0.015 && !tree.occluded(add(p, n, 2e-3), eye, 1e-6, far);
            const level = need + drift + 0.035 * Math.sin(i / line.length * wave * 6.28 + phase);
            if (!seen || dark(p, n, ground) < level) { close(); return; }
            const [x, y] = cam.project(p);
            run.push([x + 0.45 * Math.sin(i * 0.11 + wobX), y + 0.45 * Math.sin(i * 0.13 + wobY)]);
          });
          close();
        });
      };

      for (const f of s.forms) {
        if (f.ground) {
          lay(groundLines(6.5, GAP * 1.3, 0.2), RANKS, true);
          lay(groundLines(6.5, GAP * 2.2, 1.1), CROSS_RANKS, true);
        } else if (f.ball) {
          lay(sphereLines(f.ball, f.r, [0.1, 0.55, 0.83], GAP), RANKS);
          // Round the light's own axis: the second layer's pole sits on the bare, lit side.
          lay(sphereLines(f.ball, f.r, light, GAP * 1.4), CROSS_RANKS);
        } else if (f.cone) {
          const { at, r, top, h } = f.cone;
          lay(coneLines(at, r, top, h, false, GAP), RANKS);
          lay(coneLines(at, r, top, h, true, GAP * 1.5), CROSS_RANKS);
        } else {
          lay(faceLines(f.solid, false, GAP), RANKS);
          lay(faceLines(f.solid, true, GAP * 1.5), CROSS_RANKS);
        }
      }
      s.paths = paths;
      s.rays = id;
      s.edges = outlines(s.forms.slice(1).map((f) => f.solid), cam, { step: 3 })
        .filter((e) => e.kind !== 'boundary')
        .flatMap((e) => clipPolyline(e.points, frame));
    }],
  ],

  draw(g, s) {
    g.fillStyle = PAPER;
    g.fillRect(0, 0, W, H);
    g.strokeStyle = PEN;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.lineWidth = 0.8;
    for (const pts of s.paths) stroke(g, pts);
    g.lineWidth = 1.1;
    for (const pts of s.edges) stroke(g, pts);
  },
};
