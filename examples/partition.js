// partition -- recursive subdivision. A still, hard-edged, vector-bound, and
// made entirely of AREA rather than of marks.
//
// IN THE SET BECAUSE IT BREAKS THE OTHERS' ASSUMPTIONS. Nothing here is a
// stroke, nothing has a direction, nothing arrives over time and there is no
// figure on a ground -- the ground IS the figure. A library whose vocabulary is
// secretly about mark-making fails here first.
//
// It also carries the one piece of art direction no number catches: detail and
// contrast fall away from the focal relationship. Depth is driven by distance
// from a seeded focus, so the eye is told where to go. Uniform subdivision --
// every cell receiving the same algorithmic attention -- is the most common
// generative tell there is, and this example exists partly to not be it.

'use strict';

const { rng, noise2 } = require('../core/rand.js');

const W = 900;
const H = 900;
const M = 48;

// Stated as art direction, not as machinery: a quiet ground, a near-black, and
// one warm and one cool that are far enough apart to carry a focal read. N2.
const PALETTE = ['#efe9dd', '#e3dccb', '#22242b', '#c2502c', '#3a6ea5', '#d9a441'];

module.exports = {
  name: 'partition',
  size: { w: W, h: H },
  outputs: ['raster', 'vector'],
  time: null,
  seed: 11,
  params: {
    focus: { min: 2, max: 9, value: 6.2 },   // how sharply detail falls away
    depth: { min: 3, max: 8, value: 7 },
  },

  state: () => ({ cells: [], focus: [0.5, 0.5] }),

  build: [
    ['place the focus', (s) => {
      const R = rng(s.seed);
      // Kept off centre and off the edges: a focus in the middle of a square is
      // the same non-decision as no focus at all.
      s.focus = [0.28 + R('focus', 'x') * 0.44, 0.24 + R('focus', 'y') * 0.5];
    }],

    ['subdivide', (s) => {
      const R = rng(s.seed);
      const maxDepth = Math.round(s.params.depth);
      const falloff = s.params.focus;
      s.cells = [];
      const fx = M + s.focus[0] * (W - 2 * M);
      const fy = M + s.focus[1] * (H - 2 * M);

      const split = (x, y, w, h, d, addr) => {
        const cx = x + w / 2;
        const cy = y + h / 2;
        // Two separate causes, kept separate on purpose: WHERE detail belongs
        // (compositional -- distance from the focus) and HOW the field happens
        // to fall (morphological -- a noise field). One source doing both is
        // what makes a picture look like one algorithm.
        const dist = Math.hypot(cx - fx, cy - fy) / (W * 0.62);
        const want = Math.max(0, 1 - dist * (falloff / 6.2));
        const grain = noise2(R, cx / 170, cy / 170, 'grain');
        const keep = d < maxDepth && w > 15 && h > 15 && (want * 0.95 + grain * 0.32) > 0.44;

        if (!keep) {
          s.cells.push({ x, y, w, h, d, addr, want });
          return;
        }
        // Split the long way, at a ratio that is never 1/2 -- a run of exact
        // halves reads as a grid, and a grid is a different picture.
        const r = 0.34 + R('cut', addr, d) * 0.32;
        if (w >= h) {
          const cut = Math.round(w * r);
          split(x, y, cut, h, d + 1, `${addr}L`);
          split(x + cut, y, w - cut, h, d + 1, `${addr}R`);
        } else {
          const cut = Math.round(h * r);
          split(x, y, w, cut, d + 1, `${addr}T`);
          split(x, y + cut, w, h - cut, d + 1, `${addr}B`);
        }
      };

      split(M, M, W - 2 * M, H - 2 * M, 0, 'r');
    }],

    ['ink the cells', (s) => {
      const R = rng(s.seed);
      for (const c of s.cells) {
        // Five excellent marks beat fifty equivalent ones: only cells close to
        // the focus are allowed a saturated colour, and only a few of those.
        const heat = Math.max(0, Math.min(1, c.want * 1.25));
        const roll = R('cell', c.addr);
        if (roll < heat * 0.42) {
          c.fill = PALETTE[2 + Math.floor(R('cell', `${c.addr}/hue`) * 4)];
        } else {
          c.fill = roll < 0.55 ? PALETTE[0] : PALETTE[1];
        }
      }
    }],
  ],

  draw(g, s) {
    g.fillStyle = PALETTE[0];
    g.fillRect(0, 0, W, H);

    for (const c of s.cells) {
      g.fillStyle = c.fill;
      g.beginPath();
      g.rect(c.x, c.y, c.w, c.h);
      g.fill();
    }

    // One hairline per cell, on top, so the subdivision is legible as structure
    // rather than as flat colour. A plotter draws exactly these.
    g.strokeStyle = PALETTE[2];
    g.lineWidth = 0.6;
    for (const c of s.cells) {
      g.beginPath();
      g.rect(c.x + 0.3, c.y + 0.3, c.w - 0.6, c.h - 0.6);
      g.stroke();
    }

    g.strokeStyle = PALETTE[2];
    g.lineWidth = 2;
    g.beginPath();
    g.rect(M, M, W - 2 * M, H - 2 * M);
    g.stroke();
  },
};
