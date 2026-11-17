// The showcase site's demo of Mid-century gouache: the songbird staged in one
// scene, drawn with the marks of skills/artifex/styles/gouache.js. Site-only,
// never a starting point for a piece. The bird stands in a lit meadow, the
// opening, between rows of tall stylised trees under a glowing sky, framed by
// near-black foliage and ground in front. The seed picks the scene's colour
// key, the trees' places and the bird's pose.

'use strict';

const { rng } = require('../../core/rand.js');
const { chaikin } = require('../../core/geom.js');
const font = require('../../core/stroke-font.js');
const { bird } = require('./subject.js');
const { path, ellipse, grain, caption } = require('../../skills/artifex/styles/kit.js');
const { PAINT: P, mix, tone, flat, drybrush, sky, spatter } = require('../../skills/artifex/styles/gouache.js');

const W = 1000; const H = 1000;

// Colour keys, each a dominant hue with its supports and one warm or cool
// accent, the bird, from the complement.
const KEYS = [
  { sky: [mix(P.turquoise, P.sun, 0.25), mix(P.sand, P.sun, 0.55)], far: P.turquoise, mid: P.teal, ground: P.chartreuse, front: P.teal, bird: P.coral, wing: P.vermilion },
  { sky: [mix(P.violet, P.pink, 0.35), P.pink, mix(P.mustard, P.sun, 0.5)], far: P.pink, mid: P.violet, ground: P.mustard, front: P.ultramarine, bird: P.turquoise, wing: P.teal },
  { sky: [mix(P.pink, P.coral, 0.3), mix(P.sand, P.sun, 0.5)], far: P.pink, mid: P.umber, ground: P.sand, front: P.umber, bird: P.turquoise, wing: P.ultramarine },
];

// A tall stylised tree: a rounded lozenge standing on `base`.
function cone(cx, base, w, h, lean = 0) {
  const top = cx + lean * h;
  return chaikin([[cx - w / 2, base + 40], [cx - w / 2, base], [cx - w * 0.44 + lean * h * 0.35, base - h * 0.38], [top, base - h],
    [cx + w * 0.44 + lean * h * 0.35, base - h * 0.38], [cx + w / 2, base], [cx + w / 2, base + 40]], 2, true);
}

// A band from the left edge to the right whose top follows `top(x)`.
function band(top, bottom) {
  const pts = [];
  for (let x = -40; x <= W + 40; x += 40) pts.push([x, top(x)]);
  return [...pts, [W + 40, bottom], [-40, bottom]];
}

// A lens-shaped leaf from (x, y) at `angle`, `len` long.
function leaf(x, y, len, wide, angle) {
  const c = Math.cos(angle); const s = Math.sin(angle);
  const pts = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push([t * len, Math.sin(Math.PI * t) * wide * (1 - 0.35 * t)]); }
  for (let i = 9; i > 0; i--) pts.push([pts[i][0], -pts[i][1] * 0.8]);
  return pts.map(([u, v]) => [x + u * c - v * s, y + u * s + v * c]);
}

function draw(g, s) {
  const R = rng(s.seed);
  const dry = (s.params && s.params.dry) ?? 0.45;
  const bands = Math.round((s.params && s.params.bands) ?? 0);
  const K = KEYS[Math.floor(R('look', 'key', 0) * KEYS.length)];
  const horizon = 600;

  g.fillStyle = P.board;
  g.fillRect(0, 0, W, H);

  // Sky, the only gradient, lightest at the horizon behind the opening.
  sky(g, R, 'sky', 0, 0, W, horizon + 40, K.sky, { bands, dry: 0.4 + 0.4 * dry, streak: 0 });

  // Far hills, small and hazy, close to the opening in value.
  const far = tone(K.far, 0.9, { fog: 0.5 });
  flat(g, R, 'hills', band((x) => horizon - 34 - 26 * Math.sin(x / 150 + 1.3) - 14 * Math.sin(x / 61), horizon + 60), far, { dry: dry * 0.3, streak: 0, step: 8 });

  // Two rows of tall trees left and right of the opening: a paler back row,
  // then a darker middle row, each at its own seeded places and heights.
  // Their edges stay nearly crisp; the ragged edges are the front planes'.
  const rows = [
    { depth: 0.86, n: 4, base: horizon + 6, h: [150, 240], w: [46, 70] },
    { depth: 0.58, n: 3, base: horizon + 30, h: [260, 400], w: [74, 104] },
  ];
  rows.forEach((row, r) => {
    const colour = tone(K.mid, row.depth, { fog: 0.55, light: 0.35 });
    const lit = mix(colour, P.sun, 0.35);
    for (let i = 0; i < row.n * 2; i++) {
      const left = i < row.n;
      const k = left ? i : i - row.n;
      // Left trees fill 40-360, right ones 640-960, leaving the bird's opening.
      const j = r * 20 + i;
      const x = (left ? 40 : 640) + ((k + 0.25 + 0.5 * R('place', 'x', j)) / row.n) * 320;
      const h = row.h[0] + (row.h[1] - row.h[0]) * R('place', 'h', j);
      const w = row.w[0] + (row.w[1] - row.w[0]) * R('place', 'w', j);
      const lean = (R('place', 'lean', j) - 0.5) * 0.08;
      const shape = cone(x, row.base, w, h, lean);
      flat(g, R, 'tree' + r + '-' + i, shape, colour, { dry: dry * (r ? 0.45 : 0.3), streak: r ? 0.07 : 0, angle: Math.PI / 2 + lean, step: 6 });
      // A dry drag down the lit side of two of the middle row's trees.
      if (r === 1 && (k === 1 || i === row.n * 2 - 2)) {
        const tip = [x + lean * h, row.base - h * 0.84];
        drybrush(g, R, 'lit' + i, [[tip[0] - w * 0.08, tip[1]], [x - w * 0.3, row.base - h * 0.45], [x - w * 0.36, row.base - 20]], lit,
          { width: w * 0.22, bristles: 12, dry: 0.3 + 0.6 * dry, alpha: 0.9 });
      }
    }
  });

  // The lit opening: the meadow, the brightest plane, with a little spatter.
  const meadowTop = (x) => horizon + 40 + 10 * Math.sin(x / 130) + 6 * Math.sin(x / 47 + 2);
  const meadow = band(meadowTop, 840);
  const lawn = tone(K.ground, 0.5, { light: 0.35 });
  flat(g, R, 'meadow', meadow, lawn, { dry: dry * 0.6, streak: 0, step: 8 });
  // A broad dry scumble of light across it, then a little spatter.
  drybrush(g, R, 'sunlit', [[-20, 690], [300, 680], [640, 694], [1020, 676]], mix(lawn, P.sun, 0.5),
    { width: 44, bristles: 14, dry: 0.15 + 0.75 * dry, alpha: 0.95 });
  spatter(g, R, 'seed', [[60, 650], [940, 650], [940, 800], [60, 800]], mix(lawn, K.mid, 0.25), { density: 0.006, size: 1.6, angle: -0.2 });

  // A nearer band of the same ground, a value step darker.
  const near = tone(K.ground, 0.36, { light: 0.35 });
  flat(g, R, 'near', band((x) => 800 + 18 * Math.sin(x / 170 + 0.5), 940), near, { dry: dry * 0.8, streak: 0, step: 8 });

  // The bird in the opening, the scene's accent: flat colours, light as a
  // paler flat on the breast, shadow as a darker flat wing, crisp small shapes.
  const flip = R('pose', 'flip', 0) < 0.35;
  const b = bird(flip ? 530 : 470, 560 + 20 * R('pose', 'y', 0), 230, (R('pose', 'turn', 0) - 0.5) * 0.24, flip);
  const crisp = Math.min(0.2, dry * 0.35);
  const body = mix(K.bird, P.sun, 0.12);
  const feet = b.at([[0.02, 0.7], [0.2, 0.7]]);
  // Its shadow on the meadow: a flat of a darker colour, no gradient.
  flat(g, R, 'shadow', ellipse((feet[0][0] + feet[1][0]) / 2, (feet[0][1] + feet[1][1]) / 2 + 4, 90, 12, 32), mix(lawn, K.mid, 0.35), { dry: 0, edge: 3, streak: 0 });
  b.legs.forEach((leg, i) => drybrush(g, R, 'leg' + i, [leg[0], feet[i]], tone(K.mid, 0.2), { width: 5, dry: 0.15 }));
  flat(g, R, 'tail', b.tail, mix(K.wing, P.night, 0.15), { dry: crisp, edge: 5, streak: 0.06, angle: 0.5 });
  const shape = flat(g, R, 'body', b.body, body, { dry: crisp, edge: 6, streak: 0.06, angle: -0.2 });
  g.save();
  path(g, shape);
  g.clip();
  flat(g, R, 'breast', b.at(ellipse(0.32, 0.12, 0.5, 0.36, 40, -0.5)), mix(body, P.sun, 0.55), { dry: 0, edge: 4, streak: 0.05 });
  flat(g, R, 'back', b.at(ellipse(-0.2, 0.42, 0.7, 0.2, 40, -0.15)), mix(body, K.wing, 0.35), { dry: 0, edge: 4, streak: 0 });
  // A dry highlight dragged along the crown and back.
  drybrush(g, R, 'crown', b.at([[0.58, -0.62], [0.32, -0.66], [0.06, -0.48], [-0.3, -0.32]]), mix(body, P.sun, 0.6),
    { width: 16, bristles: 12, dry: 0.3 + 0.5 * dry, alpha: 0.9 });
  g.restore();
  flat(g, R, 'wing', b.wing, K.wing, { dry: crisp, edge: 5, streak: 0.08, angle: 0.15 });
  drybrush(g, R, 'quill', b.at([[0.14, -0.14], [-0.2, -0.2], [-0.56, -0.22]]), mix(K.wing, P.sun, 0.35), { width: 10, dry: 0.4 + 0.4 * dry, alpha: 0.85 });
  flat(g, R, 'beak', b.beak, P.mustard, { dry: 0, edge: 3, amp: 0.6, streak: 0 });
  flat(g, R, 'eye', ellipse(b.eye[0], b.eye[1], 11, 12, 20), P.night, { dry: 0, edge: 3, amp: 0.4, streak: 0 });
  g.fillStyle = P.board;
  path(g, ellipse(b.eye[0] + (flip ? -3.5 : 3.5), b.eye[1] - 4, 3, 3, 10));
  g.fill();

  // The dark front planes framing the opening: a trunk and its crown on the
  // left, leaves hanging from the top right, and the ground along the bottom.
  const dark = tone(K.front, 0.04);
  const darker = tone(K.front, 0);
  flat(g, R, 'trunk', [[44, H + 20], [58, 300], [84, 120], [118, 300], [126, H + 20]], darker, { dry: dry * 0.7, streak: 0, step: 8 });
  const crown = chaikin([[84, -90], [150, 110], [228, 330], [196, 490], [116, 580], [52, 580], [-28, 490], [-60, 330], [14, 110]], 2, true);
  const ragged = Math.min(1, dry * 1.8);
  flat(g, R, 'crown', crown, dark, { dry: ragged, streak: 0, step: 8 });
  [[1030, -30, 330, 70, 2.35], [1010, 60, 260, 56, 2.65], [1040, 170, 230, 48, 2.95], [940, -40, 220, 50, 2.0]].forEach(([x, y, len, wide, a], i) => {
    const lean = (R('place', 'leaf', i) - 0.5) * 0.25;
    flat(g, R, 'leaf' + i, leaf(x, y, len, wide, a + lean), i % 2 ? darker : dark, { dry: ragged, streak: 0 });
  });
  const groundTop = (x) => 900 - 60 * Math.max(0, 1 - x / 420) + 10 * Math.sin(x / 90);
  flat(g, R, 'ground', band(groundTop, H + 10), darker, { dry: ragged, streak: 0, step: 8 });
  // Tufts of grass in front, three blades each, fanned.
  for (let i = 0; i < 4; i++) {
    const x = 250 + i * 210 + 60 * R('place', 'tuft', i);
    for (let k = 0; k < 3; k++) {
      const a = -Math.PI / 2 + (k - 1) * 0.42 + (R('place', 'blade', i * 3 + k) - 0.5) * 0.2;
      flat(g, R, 'blade' + i + '-' + k, leaf(x, groundTop(x) + 24, (k === 1 ? 120 : 80) * (0.8 + 0.4 * R('place', 'bladeh', i * 3 + k)), 12, a), dark, { dry: 0, edge: 3, streak: 0 });
    }
  }

  // A light grain over the board.
  g.save();
  g.globalAlpha = 0.06;
  grain(g, R, 'grain', W, H, 4000, '#ffffff', P.night);
  g.restore();

  caption(g, 'GOUACHE', font, 'rgba(239, 230, 210, 0.85)');
}

const params = {
  dry: { min: 0, max: 1, value: 0.45, meaning: 'How far the big flats\' edges and dry-brush drags break into bristle streaks: 0 crisp cut, 1 ragged' },
  bands: { min: 0, max: 5, value: 0, meaning: 'The sky: 0 a smooth gradient, 1 one flat colour, 2 to 5 that many flat bands meeting along dry-brushed seams' },
};

module.exports = { name: 'gouache', size: { w: 1000, h: 1000 }, seed: 2026, params, draw };
