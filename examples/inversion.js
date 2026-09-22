// inversion -- the circle boundaries of a three-mirror reflection limit set.
// Each reduced word reflects the preceding circle in a different mirror.
// Even-length words are Mobius maps; odd-length words reverse orientation.
// The circles are solved algebraically and emitted as arcs, never sampled.
//
// Three disjoint equal disks make each allowed reflection a contraction:
// outside one disk, inversion maps another disk strictly inside it. Skipping
// the last mirror removes immediate cancellation. A depth-first walk retains
// only its ancestors, not the exponentially growing word frontier.

'use strict';

const { rng } = require('../core/rand.js');

const W = 900;
const H = 900;
const ORBIT = 220;
const MAX_DEPTH = 12;
const MIN_DIAMETER = 1.4; // output units; ordinary SVG export uses identity scale
const PAPER = '#f2ece0';
const INKS = ['#234b5b', '#b45135', '#81703a'];

module.exports = {
  name: 'inversion',
  size: { w: W, h: H },
  outputs: ['raster', 'vector'],
  time: null,
  seed: 19,
  params: {
    gap: { min: 0.02, max: 0.42, value: 0.10,
      meaning: 'how far the three large rings stand apart -- near contact grows longer chains of small rings' },
  },

  state: () => ({ mirrors: [] }),

  build: [['place three disjoint mirrors', (s) => {
    const R = rng(s.seed);
    const angle = -Math.PI / 2 + (R('layout', 'turn') - 0.5) * 0.7;
    const radius = Math.sqrt(3) * ORBIT / (2 + s.params.gap);
    s.mirrors = Array.from({ length: 3 }, (_, i) => ({
      x: W / 2 + ORBIT * Math.cos(angle + i * Math.PI * 2 / 3),
      y: H / 2 + ORBIT * Math.sin(angle + i * Math.PI * 2 / 3),
      r: radius,
    }));
  }]],

  draw(g, s) {
    // Canvas, VectorSurface and the benchmark surface expose the current
    // transform. Surfaces without a reader use one output unit per design unit.
    // No renderer internals or build-state mutation are needed.
    let scale = 1;
    if (typeof g.getTransform === 'function') {
      const m = g.getTransform();
      scale = Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d));
    }
    const cutoff = MIN_DIAMETER / (2 * scale);
    g.fillStyle = PAPER;
    g.fillRect(0, 0, W, H);

    const visit = (circle, last, depth) => {
      if (circle.r < cutoff) return;
      g.strokeStyle = INKS[last];
      g.lineWidth = depth === 0 ? 1.8 : Math.min(0.85, circle.r * 0.22);
      g.beginPath();
      g.arc(circle.x, circle.y, circle.r, 0, Math.PI * 2);
      g.stroke();
      // Hard cap independent of output scale: at most 3*(2^13-1) circles,
      // with only 13 circles live on the recursion stack.
      if (depth === MAX_DEPTH) return;
      for (let next = 0; next < s.mirrors.length; next++) {
        if (next !== last) visit(invertCircle(circle, s.mirrors[next]), next, depth + 1);
      }
    };
    for (let i = 0; i < s.mirrors.length; i++) visit(s.mirrors[i], i, 0);
  },
};

// Inversion about (a,b), radius R, sends (x,y), radius r, to centre
// (a,b) + R^2*((x,y)-(a,b))/(d^2-r^2) and radius R^2*r/|d^2-r^2|.
// Here disjoint mirrors keep d > r, so no circle passes through a pole and no
// line case is possible. This is a construction-specific map, not a core API.
function invertCircle(circle, mirror) {
  const dx = circle.x - mirror.x;
  const dy = circle.y - mirror.y;
  const k = mirror.r * mirror.r / (dx * dx + dy * dy - circle.r * circle.r);
  return { x: mirror.x + k * dx, y: mirror.y + k * dy, r: k * circle.r };
}
