// The showcase site's demo of Impasto: the songbird staged in one scene,
// drawn with the marks of skills/artifex/styles/impasto.js. Site-only, never
// a starting point for a piece. Orange and white swirls behind, like fire and
// cloud; inside the bird the dabs wrap its own form.

'use strict';

const { rng, fbm } = require('../../core/rand.js');
const { pointInPoly, resample } = require('../../core/geom.js');
const font = require('../../core/stroke-font.js');
const { bird } = require('./subject.js');
const { grain, caption, path } = require('../../skills/artifex/styles/kit.js');
const { FIRE, dab, flow, scatter, ramp, shade, across, pick, model, contour } = require('../../skills/artifex/styles/impasto.js');

const W = 1000; const H = 1000;
const VORTEX = [[240, 300, 1], [800, 230, -1], [190, 810, -1], [830, 790, 1]];

function draw(g, s) {
  const R = rng(s.seed);
  g.fillStyle = '#f3ead8';
  g.fillRect(0, 0, W, H);

  const b = bird(505, 540, 290, -0.1);
  const centre = b.at([[0.05, 0.02]])[0];
  // Near the subject the ground is pulled toward a value that parts from the
  // nearest part: pale cloud beside the red tail and wing, deep orange beside
  // the pale body, mid orange where they meet.
  const red = [...resample(b.tail, 6, true), ...resample(b.wing, 6, true).filter((p) => !pointInPoly(p, b.body))];
  const pale = resample(b.body, 6, true).filter((p) => !pointInPoly(p, b.wing) && !pointInPoly(p, b.tail));
  const dist = (pts, x, y) => pts.reduce((m, p) => Math.min(m, Math.hypot(p[0] - x, p[1] - y)), Infinity);

  // Background swirls: a shuffled, jittered grid of dabs.
  const stroke = (s.params && s.params.stroke) ?? 17;
  for (const [x, y, i] of scatter(R, 'bg', -20, -20, 1044, 1044, 19, 18)) {
    const warp = (fbm(R, x / 420, y / 420, 2, 'warp') - 0.5) * 1.6;
    const dp = dist(pale, x, y); const dr = dist(red, x, y); const d = Math.min(dp, dr);
    const f = fbm(R, x / 230 + warp, y / 230, 4, 'fire');
    let v = f + Math.exp(-(d * d) / (2 * 160 * 160)) * (0.38 + (0.34 * dp) / (dp + dr) - f) + (R('bg', 'j', i) - 0.5) * 0.06;
    // A pale swirl always lies under the caption, so it reads at every seed.
    const cx = (x - 85) / 130; const cy = (y - 943) / 70;
    v += 0.5 * Math.exp(-(cx * cx + cy * cy));
    v = Math.min(v, 0.999);
    let colour = ramp(FIRE, v);
    if (R('bg', 'gold', i) < 0.015) colour = '#e9b949';
    dab(g, x, y, flow(R, 'flow', x, y, VORTEX), stroke + R('bg', 'l', i) * 10, 6 + R('bg', 'w', i) * 3, colour);
  }

  // The bird: dabs sampled inside each part, turned to follow its form.
  const head = b.at([[0.42, -0.42]])[0];
  const axis = (a, c) => { const [p, q] = b.at([a, c]); return Math.atan2(q[1] - p[1], q[0] - p[0]); };
  const wingAxis = axis([0.2, -0.08], [-0.6, -0.24]);
  const tailAxis = axis([-0.55, -0.02], [-1.05, -0.3]);
  const beakAxis = axis([0.7, -0.35], [1.0, -0.34]);
  const cream = ['#8e98bf', '#c9b8b9', '#e6d3c1', '#f6ebd9', '#fffaf1'];
  // The hot parts' two shade steps are cooled toward blue, so their shadow turns in hue, not only in value.
  const wing = ['#a03b75', '#c64166', '#ea6a45', '#f39a6b'];
  const tail = ['#a03b75', '#c64166', '#e0573a', '#f08a3c'];
  const beak = ['#d99a2b', '#e9b949', '#f2c94c'];
  const all = [...b.body, ...b.wing, ...b.tail, ...b.beak];
  const [x0, x1] = [Math.min(...all.map((p) => p[0])), Math.max(...all.map((p) => p[0]))];
  const [y0, y1] = [Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[1]))];
  // Two balls, the head and the body: strokes run along each one's cross-contours and each shades from its own centre.
  const inHead = (x, y) => Math.hypot(x - head[0], y - head[1]) < 0.3 * b.s;
  const headTurn = across(head, 0.34 * b.s); const bodyTurn = across(centre, 0.66 * b.s);
  const around = (x, y) => (inHead(x, y) ? headTurn(x, y) : bodyTurn(x, y));
  const round = (x, y) => (inHead(x, y) ? shade(x, y, head, 0.24 * b.s, undefined, { form: 'round' }) : shade(x, y, centre, 0.36 * b.s, undefined, { form: 'round' }));
  // The block-in: each mass once at its value group's colour, so no ground shows between its strokes.
  for (const [shape, colour] of [[b.tail, '#c64166'], [b.body, '#e6d3c1'], [b.wing, '#c64166'], [b.beak, '#e9b949']]) {
    g.fillStyle = colour;
    path(g, shape);
    g.fill();
  }
  model(g, R, 'bird', scatter(R, 'bird', x0 - 9, y0 - 9, x1 + 9, y1 + 9, 9, 8), [
    { shape: b.beak, angle: () => beakAxis, scale: 0.8, colour: (x, y) => pick(beak, shade(x, y, b.at([[0.85, -0.34]])[0], 40)) },
    { shape: b.wing, angle: () => wingAxis, colour: (x, y) => pick(wing, shade(x, y, b.at([[-0.2, -0.1]])[0], 0.09 * b.s, undefined, { form: 'long', axis: wingAxis })) },
    { shape: b.body, angle: around, colour: (x, y) => pick(cream, round(x, y)) },
    { shape: b.tail, angle: () => tailAxis, colour: (x, y) => pick(tail, shade(x, y, b.at([[-0.8, -0.2]])[0], 0.07 * b.s, undefined, { form: 'long', axis: tailAxis })) },
  ], { focus: b.eye });

  // Accents: navy along the underside, gold on the wing edge, eye and blush.
  contour(g, b.body, '#27365e', { keep: (p) => p[1] >= centre[1] + 0.12 * b.s });
  contour(g, b.wing, '#f2c94c', { every: 4, len: 9, wide: 3 });
  for (const [dx, dy, a] of [[-4, 0, 0.4], [4, 2, -0.3], [0, -4, 1.2]]) dab(g, b.eye[0] + dx, b.eye[1] + dy, a, 8, 5, '#1f2a4a');
  dab(g, b.eye[0] + 3, b.eye[1] - 4, 0.6, 4, 2.2, '#fffaf1');
  for (const [dx, dy] of [[-6, 2], [6, 0], [0, 6]]) dab(g, b.cheek[0] + dx, b.cheek[1] + dy, 0.2, 7, 3.5, '#f29a9a');

  grain(g, R, 'grain', W, H, 4000, 'rgba(255,255,255,0.10)', 'rgba(70,40,20,0.06)');
  caption(g, 'IMPASTO', font, 'rgba(90, 50, 30, 0.8)');
}

const params = {
  stroke: { min: 10, max: 24, value: 17, meaning: 'Length of the background strokes: short choppy dabs to long strokes that sweep the swirls' },
};

module.exports = { name: 'impasto', size: { w: 1000, h: 1000 }, seed: 2026, params, draw };
