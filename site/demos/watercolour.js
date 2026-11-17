// The showcase site's demo of Watercolour: the songbird staged in one scene,
// drawn with the marks of skills/artifex/styles/watercolour.js. Site-only,
// never a starting point for a piece. The bird sits on a leafy branch under a
// graded sky with a bloom in it, before loose foliage and a ground wash that
// fades out before the edge of the sheet.

'use strict';

const { rng } = require('../../core/rand.js');
const { chaikin } = require('../../core/geom.js');
const font = require('../../core/stroke-font.js');
const { bird } = require('./subject.js');
const { ellipse, caption } = require('../../skills/artifex/styles/kit.js');
const { PIGMENTS: P, wash, confine, lift, bloom, granulate, splatter, pencil, tips, drybrush, flicks, tooth } = require('../../skills/artifex/styles/watercolour.js');

const W = 1000; const H = 1000;

function blob(cx, cy, rx, ry, n = 24, rot = 0) {
  return ellipse(cx, cy, rx, ry, n, rot);
}

function leaf(cx, cy, len, wide, angle) {
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8; pts.push([(t - 0.5) * len, Math.sin(t * Math.PI) * wide * (1 - 0.3 * t)]);
  }
  for (let i = 7; i > 0; i--) pts.push([pts[i][0], -pts[i][1]]);
  const c = Math.cos(angle); const s = Math.sin(angle);
  return pts.map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
}

function draw(g, s) {
  const R = rng(s.seed);

  g.fillStyle = P.paper;
  g.fillRect(0, 0, W, H);

  // Sky: a wash graded down from the top, ultramarine flowing into it.
  const sky = wash(g, R, 'sky', (u) => blob(430 + 60 * u, 90 + 40 * R('sky', 'top', Math.round(u * 99)) + 40 + 110 * u, 380 + 40 * u, 40 + 110 * u, 30), P.cerulean,
    { layers: 30, alpha: 0.022, spread: (s.params && s.params.water) ?? 0.13, second: P.ultramarine, share: 0.25, mottle: 0 });
  granulate(g, R, 'skyg', sky, P.ultramarine, 1600, 1.3);
  bloom(g, R, 'bloom', blob(690, 190, 70, 48, 20), P.ultramarine);

  // Loose foliage behind the branch, wet into wet, darker glazes over it once
  // dry, and a ground wash with grass flicked up from it.
  wash(g, R, 'bush', blob(810, 650, 190, 125, 28, -0.2), P.sap, { layers: 16, alpha: 0.03, spread: 0.14, second: P.ochre, share: 0.4, mottle: 0.8 });
  wash(g, R, 'bushd', blob(880, 700, 105, 80, 22), P.hooker, { layers: 10, alpha: 0.035, spread: 0.14, second: P.ultramarine, share: 0.25, mottle: 0.8, rim: 0.08 });
  wash(g, R, 'bushm', blob(730, 610, 70, 50, 18, 0.4), P.sap, { layers: 8, alpha: 0.035, spread: 0.16, second: P.hooker, share: 0.5, mottle: 0.8, rim: 0.08 });
  wash(g, R, 'ground', (u) => blob(480, 790, 360 - 120 * u, 40 + 30 * u, 30, 0.03), P.sap, { layers: 18, alpha: 0.022, spread: 0.14, second: P.ochre, share: 0.4 });
  flicks(g, R, 'grass', 26, 200, 790, 520, 50, [P.sap, P.hooker]);

  // The branch: dragged with a loaded brush, heavier at the base.
  const smooth = chaikin([[980, 588], [840, 612], [680, 640], [520, 656], [380, 664], [300, 660]], 3);
  const thick = (i) => 3 + 11 * (1 - i / smooth.length) ** 1.3;
  const limb = [...smooth.map(([x, y], i) => [x, y - thick(i)]), ...smooth.map(([x, y], i) => [x, y + thick(i) * 0.8]).reverse()];
  pencil(g, R, 'branchp', smooth);
  wash(g, R, 'limb', limb, P.sienna, { layers: 10, alpha: 0.08, spread: 0.05, rim: 0.12, second: P.umber, share: 0.6, mottle: 0.7 });
  drybrush(g, R, 'dry', smooth, P.umber);
  const leaves = [[890, 560, -0.7, 96], [790, 666, 0.8, 90], [720, 598, -1.0, 78], [610, 686, 0.9, 72], [944, 646, 0.35, 84], [520, 628, -1.2, 60]];
  leaves.forEach(([x, y, a, len], i) => {
    const shape = leaf(x, y, len, len * 0.3, a);
    pencil(g, R, 'leafp' + i, shape, true);
    wash(g, R, 'leaf' + i, shape, P.sap, { layers: 14, alpha: 0.06, spread: 0.08, rim: 0.12, second: i % 2 ? P.ochre : P.hooker, share: 0.5 });
    const half = shape.slice(0, 9);
    wash(g, R, 'leafd' + i, half, P.hooker, { layers: 8, alpha: 0.06, spread: 0.08, rim: 0.1 });
    lift(g, R, 'vein' + i, leaf(x, y, len * 0.8, 2.5, a), 0.55);
  });
  for (let i = 0; i < 5; i++) {
    const x = 660 + i * 56 + R('berry', 'x', i) * 20; const y = 668 + (i % 2) * 20;
    wash(g, R, 'berry' + i, blob(x, y, 9, 9, 10), P.rose, { layers: 10, alpha: 0.14, spread: 0.06, rim: 0.2, mottle: 0 });
    g.fillStyle = P.paper;
    g.fillRect(x - 4, y - 5, 2.5, 2.5);
  }

  // The subject, light to dark: pencil first, then glazes, and the paper
  // kept or lifted back for the lights.
  const b = bird(455, 455, 262, -0.06);
  pencil(g, R, 'bodyp', b.body, true);
  pencil(g, R, 'wingp', b.wing, true);
  pencil(g, R, 'tailp', b.tail, true);
  // The body is one wet shape: a pale wash, then blue dropped in from the top
  // and a warm shadow from below, both stopping at the body's one edge.
  const body = wash(g, R, 'body', b.body, P.peach, { layers: 12, alpha: 0.025, spread: 0.1, rim: 0, second: P.ochre, share: 0.5 });
  const [, top] = b.at([[0, -0.72]])[0]; const [, low] = b.at([[0, 0.5]])[0];
  const [left] = b.at([[-0.7, 0]])[0]; const [right] = b.at([[0.8, 0]])[0];
  confine(g, body, () => {
    wash(g, R, 'back', (u) => [[left - 40, top - 40], [right + 40, top - 40], [right + 40, top + 90 + 90 * u], [(left + right) / 2, top + 120 + 110 * u], [left - 40, top + 150 + 80 * u]],
      P.cerulean, { layers: 26, alpha: 0.04, spread: 0.14, rim: 0, second: P.ultramarine, share: 0.35 });
    wash(g, R, 'shade', (u) => [[left - 40, low + 40], [right + 40, low + 40], [right + 40, low - 20 - 50 * u], [(left + right) / 2, low - 50 - 70 * u], [left - 40, low - 30 - 60 * u]],
      P.sienna, { layers: 16, alpha: 0.03, spread: 0.14, rim: 0, second: P.rose, share: 0.45 });
  });
  wash(g, R, 'bodyrim', b.body, P.cerulean, { layers: 0, rim: 0.07 });
  lift(g, R, 'shine', b.at(chaikin([[0.3, -0.56], [0.46, -0.62], [0.5, -0.56], [0.36, -0.5]], 2, true)), 0.5);
  // The tail: on bare paper one wash with its own rim; inside the body it ran
  // wet into the body, graded past the root with no rim.
  const glaze = { layers: 14, alpha: 0.045, spread: 0.08, second: P.payne, share: 0.2, mottle: 0.7 };
  confine(g, body, () => wash(g, R, 'tail', b.tail, P.ultramarine, { ...glaze, rim: 0.1 }), [W, H]);
  confine(g, body, () => wash(g, R, 'tailroot', (u) => b.at(chaikin([[-0.5 + 0.22 * u, -0.1], [-0.98, -0.44], [-1.08, -0.30], [-1.06, -0.16], [-0.52 + 0.22 * u, 0.13]], 1, true)),
    P.ultramarine, { ...glaze, rim: 0 }));
  wash(g, R, 'wing', b.wing, P.ultramarine, { layers: 14, alpha: 0.045, spread: 0.08, rim: 0.12, second: P.sienna, share: 0.3, mottle: 0.7 });
  granulate(g, R, 'wingg', b.wing, P.ultramarine, 900, 1.6);
  // Feather tips: three strokes of the brush's point.
  const quills = [0, 1, 2].map((k) => b.at([[0.02 - k * 0.1, -0.08 + k * 0.05], [-0.5 + k * 0.06, -0.21 + k * 0.05]]));
  tips(g, R, 'quill', quills, P.ultramarine, { width: (k) => 3 - k * 0.6, alpha: 0.4, amp: 1.4, step: 12 });
  wash(g, R, 'cheek', blob(b.cheek[0], b.cheek[1], 22, 15, 12), P.rose, { layers: 12, alpha: 0.04, spread: 0.25, rim: 0 });
  wash(g, R, 'beak', b.beak, P.ochre, { layers: 12, alpha: 0.12, spread: 0.05, rim: 0.2, mottle: 0.3 });
  wash(g, R, 'beaks', [b.beak[0], b.beak[1], [b.beak[2][0], b.beak[2][1] - 6]], P.sienna, { layers: 8, alpha: 0.1, spread: 0.06, mottle: 0.3 });
  wash(g, R, 'eye', blob(b.eye[0], b.eye[1], 12, 12, 12), P.payne, { layers: 12, alpha: 0.2, spread: 0.05, rim: 0.3, mottle: 0 });
  g.fillStyle = P.paper;
  g.beginPath();
  g.arc(b.eye[0] + 4, b.eye[1] - 4, 3.4, 0, Math.PI * 2);
  g.fill();
  // Legs: two strokes of dark paint gripping the branch.
  tips(g, R, 'leg', b.legs.map((leg) => [leg[0], [leg[1][0] + 4, 652]]), P.umber, { width: 3.6, alpha: 0.7, amp: 1, step: 10 });

  splatter(g, R, 'spl1', 190, 520, 90, P.cerulean, 16);
  splatter(g, R, 'spl2', 860, 820, 80, P.sap, 14);
  splatter(g, R, 'spl3', 760, 250, 50, P.rose, 8);
  tooth(g, R, 'tooth', W, H);

  caption(g, 'WATERCOLOUR', font, 'rgba(80, 76, 72, 0.75)');
}

const params = {
  water: { min: 0.08, max: 0.22, value: 0.13, meaning: 'How far the wet sky wash spreads: tighter layered edges to a soft, feathered wet edge' },
};

module.exports = { name: 'watercolour', size: { w: 1000, h: 1000 }, seed: 2026, params, draw };
