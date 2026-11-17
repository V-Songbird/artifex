// The showcase site's demo of Manga: the songbird staged in one scene, drawn
// with the marks of skills/artifex/styles/manga.js. Site-only, never a
// starting point for a piece. A page of two panels: the bird sings out from a
// black branch under focus lines and a gradation sky, its shout breaking the
// border, and an inset cuts close to its eye.

'use strict';

const { rng } = require('../../core/rand.js');
const { ribbon } = require('../../core/geom.js');
const font = require('../../core/stroke-font.js');
const { bird } = require('./subject.js');
const { path, ellipse, star, caption } = require('../../skills/artifex/styles/kit.js');
const { INK, PAPER, PRESS, paper, pen, beta, screentone, focusLines, panel, balloon } = require('../../skills/artifex/styles/manga.js');

const W = 1000; const H = 1000;
// One printer's screen for the page: one pitch at the default angle, coarse
// enough that the dots stay dots on a card a third of the size.
const PITCH = 10;

const params = {
  lines: { min: 30, max: 240, value: 110, meaning: 'How many focus lines rush in at the singing bird: a few strokes at min, a dense wall of ink at max.' },
  tone: { min: 0.05, max: 0.5, value: 0.2, meaning: 'Ink share of the screentone dots in the sky, the shading and the close-up: a pale tint at min, dark grey at max.' },
};

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

function clipped(g, outline, fn) {
  g.save();
  path(g, outline);
  g.clip();
  fn();
  g.restore();
}

// The bird in ink: pen contours heavier on the shadowed underside, solid black
// for the cap, wing and tail with paper streaks, screentone shading graded to
// paper toward the light, a glossy eye, hatched blush and an open, singing beak.
// `w` is the near contour's width; `frame`, the panel a close cut is clipped to.
function inkBird(g, R, name, b, { w, tone, legs = true, frame = null }) {
  const { s, at } = b;
  const nib = (spine, width, opts = {}) => pen(g, R, name + (opts.key || spine.length + ':' + spine[0][0].toFixed(1)), spine, { w: width, smooth: 0, step: 2.5, ...opts });
  if (legs) {
    for (const [i, x] of [0.02, 0.2].entries()) {
      nib(at([[x, 0.4], [x - 0.01, 0.69]]), 0.026 * s, { press: PRESS.in, key: 'leg' + i });
      for (const [k, toe] of [[x + 0.13, 0.7], [x + 0.09, 0.74], [x - 0.08, 0.71]].entries()) nib(at([[x - 0.01, 0.69], toe]), 0.02 * s, { press: PRESS.out, key: 'toe' + i + k });
    }
  }
  beta(g, [b.tail], { halo: w * 0.6 });
  for (const [k, tip] of [[-0.98, -0.34], [-1.02, -0.18]].entries()) nib(at([[-0.6, -0.02 + k * 0.04], tip]), 0.014 * s, { ink: PAPER, press: PRESS.in, key: 'tailcut' + k });
  // Paper over everything behind, with a paper edge round it.
  g.save();
  g.fillStyle = PAPER;
  g.strokeStyle = PAPER;
  g.lineWidth = w * 1.6;
  g.lineJoin = 'round';
  path(g, b.body);
  g.stroke();
  g.fill();
  g.restore();
  // Dots only where the body meets the frame, so a close cut lays no hidden ones.
  clipped(g, b.body, () => screentone(g, frame || b.body, { value: 0, pitch: PITCH, ramp: { from: at([[0.3, -0.3]])[0], to: at([[-0.25, 0.46]])[0], value: Math.min(0.6, tone * 1.6) } }));
  clipped(g, b.body, () => beta(g, [at(ellipse(0.4, -0.72, 0.4, 0.21, 40, -0.12))]));
  nib(at([[0.27, -0.59], [0.38, -0.625], [0.5, -0.615]]), 0.022 * s, { ink: PAPER, press: PRESS.out, key: 'caphi' });
  // The contour in two strokes, overlapping at the head and the tail.
  const n = b.body.length;
  nib(b.body.slice(0, Math.round(n * 0.53)), w * 0.7, { key: 'back' });
  nib([...b.body.slice(Math.round(n * 0.46)), ...b.body.slice(0, 3)], w, { key: 'belly' });
  beta(g, [b.wing], { halo: w * 0.7 });
  nib(at([[0.2, -0.17], [-0.08, -0.21], [-0.44, -0.22]]), 0.024 * s, { ink: PAPER, press: PRESS.out, key: 'winghi' });
  nib(at([[0.1, -0.02], [-0.16, -0.07], [-0.42, -0.14]]), 0.014 * s, { ink: PAPER, press: PRESS.out, key: 'wingcut' });
  // Open beak: the mouth black between two paper mandibles.
  beta(g, [at([[0.69, -0.42], [0.88, -0.33], [0.69, -0.26]])]);
  for (const [k, part] of [[[0.69, -0.45], [1.02, -0.41], [0.73, -0.33]], [[0.72, -0.31], [0.95, -0.2], [0.69, -0.24]]].entries()) {
    const m = at(part);
    g.fillStyle = PAPER;
    path(g, m);
    g.fill();
    nib([m[0], m[1], m[2]], w * 0.55, { press: PRESS.both, key: 'beak' + k + 'a' });
    nib([m[2], m[0]], w * 0.35, { press: PRESS.both, key: 'beak' + k + 'b' });
  }
  // The eye: a paper ring in the black, a black pupil, two highlights.
  const [ex, ey] = b.eye;
  g.fillStyle = PAPER;
  g.beginPath(); g.arc(ex, ey, 0.09 * s, 0, Math.PI * 2); g.fill();
  g.fillStyle = INK;
  g.beginPath(); g.arc(ex, ey, 0.07 * s, 0, Math.PI * 2); g.fill();
  g.fillStyle = PAPER;
  for (const [u, v, r] of [[0.475, -0.485, 0.026], [0.525, -0.435, 0.011]]) {
    const [hx, hy] = at([[u, v]])[0];
    g.beginPath(); g.arc(hx, hy, r * s, 0, Math.PI * 2); g.fill();
  }
  // Blush: short hatched strokes on the cheek.
  for (let k = 0; k < 4; k++) nib(at([[0.36 + k * 0.05, -0.2], [0.41 + k * 0.05, -0.29]]), 0.013 * s, { key: 'blush' + k });
}

function draw(g, s) {
  const R = rng(s.seed);
  const lines = (s.params && s.params.lines) ?? params.lines.value;
  const tone = (s.params && s.params.tone) ?? params.tone.value;
  // The seed picks which way the bird faces, its tilt and its word.
  const flip = R('look', 'flip') < 0.5; const f = flip ? -1 : 1;
  const mx = (x) => (flip ? W - x : x);
  const tilt = (R('look', 'tilt') - 0.5) * 0.18;
  const word = ['CHIRP!', 'TWEET!', 'PIPI!'][Math.floor(R('look', 'word') * 3) % 3];

  paper(g, R, W, H, { specks: 160 });

  const main = rect(40, 40, 960, 925);
  const b = bird(mx(400 + R('look', 'x') * 40), 520, 250, tilt * f, flip);
  const center = b.at([[0.1, -0.15]])[0];
  clipped(g, main, () => {
    // A gradation sky, darkest at the top.
    screentone(g, main, { value: 0, pitch: PITCH, ramp: { from: [500, 600], to: [500, 40], value: tone } });
    // The ground's tone rises again below the branch, graded from the foot.
    const foot = b.at([[0.11, 0.7]])[0];
    screentone(g, rect(40, foot[1] + 40, 960, 925), { value: 0, pitch: PITCH, ramp: { from: [500, foot[1] + 40], to: [500, 925], value: tone * 0.8 } });
    focusLines(g, R, 'focus', center[0], center[1], [40, 40, 960, 925], { r: 320, count: lines, w: 8, jitter: 0.25 });

    // The branch: one black mass entering from the page's edge, its top
    // under the bird's feet, with a paper streak along the light.
    const x0 = mx(-30); const x1 = mx(900);
    const hw = (t) => 26 - 20 * t;
    const spine = Array.from({ length: 25 }, (_, i) => {
      const t = i / 24; const x = x0 + (x1 - x0) * t;
      return [x, foot[1] + 0.03 * f * (x - foot[0]) + 2e-4 * (x - foot[0]) ** 2 + hw(t) - hw((foot[0] - x0) / (x1 - x0))];
    });
    const limb = ribbon(spine, (i, m) => hw(i / (m - 1)));
    beta(g, [limb], { halo: 3 });
    pen(g, R, 'barkhi', spine.slice(1, 12).map(([x, y], i) => [x, y - hw(i / 24) * 0.45]), { w: 4, ink: PAPER, press: PRESS.out });
    // Leaves off the branch, pointed at both ends, up and down by turns.
    for (const [k, [t, a]] of [[0.06, 0.7], [0.13, -0.75], [0.2, 1.25], [0.3, -1.1]].entries()) {
      const [px, py] = spine[Math.round(t * 24)];
      const ang = flip ? Math.PI - a : a; const c = Math.cos(ang); const sn = Math.sin(ang);
      const L = 92; const half = 22;
      const side = (d) => Array.from({ length: 13 }, (_, i) => {
        const u = i / 12; const v = d * half * Math.sin(Math.PI * u) ** 0.8;
        return [px + c * L * u - sn * v, py + sn * L * u + c * v];
      });
      const leaf = [...side(1), ...side(-1).reverse().slice(1, -1)];
      g.fillStyle = PAPER; path(g, leaf); g.fill();
      screentone(g, leaf, { value: 0, pitch: PITCH, ramp: { from: [px, py], to: [px + c * L, py + sn * L], value: Math.min(0.6, tone * 2) } });
      pen(g, R, 'leafa' + k, side(1), { w: 4.5, smooth: 0, press: PRESS.both });
      pen(g, R, 'leafb' + k, side(-1), { w: 3, smooth: 0, press: PRESS.both });
      pen(g, R, 'vein' + k, [[px, py], [px + c * L * 0.8, py + sn * L * 0.8]], { w: 2.5, press: PRESS.out, smooth: 0 });
    }

    inkBird(g, R, 'bird', b, { w: 8, tone });
  });
  panel(g, main, { w: 5, fill: null });

  // The inset: a close cut to the eye, over a white gutter on the big panel.
  const ix0 = flip ? W - 930 : 620; const ix1 = flip ? W - 620 : 930; const iy0 = 610; const iy1 = 895;
  const inset = rect(ix0, iy0, ix1, iy1);
  g.fillStyle = PAPER;
  path(g, rect(ix0 - 16, iy0 - 16, ix1 + 16, iy1 + 16));
  g.fill();
  clipped(g, inset, () => {
    screentone(g, inset, { value: tone * 0.5, pitch: PITCH, ramp: { from: [mx(930), iy0], to: [mx(620), iy1], value: Math.min(0.6, tone * 2.6) } });
    const S = 500;
    const ex = flip ? ix1 - 0.4 * (ix1 - ix0) : ix0 + 0.4 * (ix1 - ix0); const ey = iy0 + 0.5 * (iy1 - iy0);
    inkBird(g, R, 'close', bird(ex - f * 0.5 * S, ey + 0.46 * S, S, 0, flip), { w: 13, tone, legs: false, frame: inset });
    // Sparkles: four-point stars of paper ringed in ink.
    for (const [k, [u, v, r]] of [[0.86, 0.2, 22], [0.74, 0.08, 12], [0.12, 0.16, 15]].entries()) {
      const x = flip ? ix1 - u * (ix1 - ix0) : ix0 + u * (ix1 - ix0); const y = iy0 + v * (iy1 - iy0) + 8;
      const pts = star(x, y, r * (0.9 + 0.2 * R('sparkle', 'r', k)), 4, 0.22, 0);
      g.fillStyle = PAPER; path(g, pts); g.fill();
      pen(g, R, 'sparkle' + k, [...pts, pts[0]], { w: 2.2, smooth: 0, press: PRESS.even });
    }
  });
  panel(g, inset, { w: 5, fill: null });

  // The shout, breaking the top panel's border.
  const bx = mx(770); const by = 180;
  balloon(g, R, 'shout', bx, by, 165, 82, { kind: 'shout', w: 4 });
  const size = 44;
  font.display(g, word, bx - font.width(word, size) / 2, by - size / 2, size, { fill: INK, weight: 0.24 });

  caption(g, 'MANGA', font, INK);
}

module.exports = { name: 'manga', size: { w: 1000, h: 1000 }, seed: 2026, params, draw };
