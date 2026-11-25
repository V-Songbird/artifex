// inversion -- the circle boundaries of a three-mirror reflection limit set.
// Each reduced word reflects the preceding circle in a different mirror.
// Even-length words are Mobius maps; odd-length words reverse orientation.
// The circles are solved algebraically and emitted as arcs, never sampled.
//
// Three disjoint disks make each allowed reflection a contraction:
// outside one disk, inversion maps another disk strictly inside it. Skipping
// the last mirror removes immediate cancellation. A radius floor bounded by
// MAX_CIRCLES ends each chain; a depth-first walk then draws the words.
//
// The limit set lies near the triangle of centres, so the large rings would
// stay empty inside. One more circle, round all three mirrors and never a
// mirror itself, fills them: each mirror folds it into its own ring, and its
// images start further words like the mirrors do.

'use strict';

const { rng } = require('../core/rand.js');

const W = 900;
const H = 900;
const ORBIT = 220;
const SKEW = 0.3; // radians each centre may leave its equal spacing
const MARGIN = 36; // design units between the mirrors' bounds and the sheet's edge
const MAX_CIRCLES = 3 * (2 ** 13 - 1); // as many as every word up to length 12
const MIN_DIAMETER = 1.4; // output units; ordinary SVG export uses identity scale
const ENCLOSE = 1.02; // the enclosing circle's radius over the mirrors' farthest reach from the centre
const PAPER = '#f2ece0';
const INKS = ['#234b5b', '#b45135', '#81703a'];

module.exports = {
  name: 'inversion',
  size: { w: W, h: H },
  outputs: ['raster', 'vector'],
  time: null,
  seed: 19,
  params: {
    gap: { min: 0.01, max: 0.42, value: 0.02,
      meaning: 'how far the three large rings stand apart -- near contact grows longer chains of small rings' },
  },

  state: () => ({ mirrors: [] }),

  build: [['place three disjoint mirrors', (s) => {
    const R = rng(s.seed);
    const angle = -Math.PI / 2 + (R('layout', 'turn') - 0.5) * 0.7;
    // The seed also bends the triangle of centres: each centre leaves its
    // equal spacing on the orbit by up to SKEW radians, so the three mirrors
    // take different sizes. Radii are the triangle's tangent lengths, scaled
    // so every pair stands apart by the same fraction gap of their mean radius:
    // r_i + r_j = 2 d_ij / (2 + gap) < d_ij, so the disks are always disjoint.
    const at = [0, 1, 2].map((i) => angle + i * Math.PI * 2 / 3 + (R('layout', 'skew', i) - 0.5) * 2 * SKEW);
    const c = at.map((a) => ({ x: W / 2 + ORBIT * Math.cos(a), y: H / 2 + ORBIT * Math.sin(a) }));
    const D = (i, j) => 2 * Math.hypot(c[i].x - c[j].x, c[i].y - c[j].y) / (2 + s.params.gap);
    const disks = c.map((p, i) => {
      const j = (i + 1) % 3, k = (i + 2) % 3;
      return { x: p.x, y: p.y, r: (D(i, j) + D(i, k) - D(j, k)) / 2 };
    });
    // A bent triangle drifts off centre: centre the three disks' bounds and
    // scale them to the sheet less MARGIN. A similarity keeps them disjoint.
    const x0 = Math.min(...disks.map((d) => d.x - d.r)), x1 = Math.max(...disks.map((d) => d.x + d.r));
    const y0 = Math.min(...disks.map((d) => d.y - d.r)), y1 = Math.max(...disks.map((d) => d.y + d.r));
    const fit = Math.min((W - 2 * MARGIN) / (x1 - x0), (H - 2 * MARGIN) / (y1 - y0));
    s.mirrors = disks.map((d) => ({
      x: W / 2 + (d.x - (x0 + x1) / 2) * fit,
      y: H / 2 + (d.y - (y0 + y1) / 2) * fit,
      r: d.r * fit,
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

    // Roots of the word tree: each mirror, then the enclosing circle's image in
    // each mirror, which stands one reflection deep.
    const far = Math.max(...s.mirrors.map((m) => Math.hypot(m.x - W / 2, m.y - H / 2) + m.r));
    const outer = { x: W / 2, y: H / 2, r: far * ENCLOSE };
    const roots = s.mirrors.map((m, i) => ({ circle: m, last: i, depth: 0 }))
      .concat(s.mirrors.map((m, i) => ({ circle: invertCircle(outer, m), last: i, depth: 1 })));

    // The pixel cutoff alone ends every chain; how deep depends on the gap and
    // the scale (at the default gap about 15 reflections at scale 1 and 22 at
    // scale 8), so no fixed depth suits every case. A radius floor bounds the
    // count instead: the smallest floor at or above the cutoff whose tree fits
    // MAX_CIRCLES. Any circle a lower scale draws is above that floor too, so
    // a higher scale only adds smaller circles, whatever the budget.
    const count = (floor) => {
      let n = 0;
      const walk = (c, last) => {
        if (c.r < floor || n > MAX_CIRCLES) return;
        n++;
        for (let k = 0; k < s.mirrors.length; k++) if (k !== last) walk(invertCircle(c, s.mirrors[k]), k);
      };
      roots.forEach((root) => walk(root.circle, root.last));
      return n;
    };
    let floor = cutoff;
    if (count(floor) > MAX_CIRCLES) {
      let lo = floor, hi = Math.max(...s.mirrors.map((m) => m.r));
      while (hi / lo > 1 + 1e-9) {
        const mid = Math.sqrt(lo * hi);
        if (count(mid) > MAX_CIRCLES) lo = mid; else hi = mid;
      }
      floor = hi;
    }

    const visit = (circle, last, depth) => {
      if (circle.r < floor) return;
      g.strokeStyle = INKS[last];
      g.lineWidth = depth === 0 ? 1.8 : Math.min(0.85, circle.r * 0.22);
      g.beginPath();
      g.arc(circle.x, circle.y, circle.r, 0, Math.PI * 2);
      g.stroke();
      for (let next = 0; next < s.mirrors.length; next++) {
        if (next !== last) visit(invertCircle(circle, s.mirrors[next]), next, depth + 1);
      }
    };
    for (const root of roots) visit(root.circle, root.last, root.depth);
  },
};

// Inversion about (a,b), radius R, sends (x,y), radius r, to centre
// (a,b) + R^2*((x,y)-(a,b))/(d^2-r^2) and radius R^2*r/|d^2-r^2|.
// No circle passes through a pole, so no line case is possible: disjoint
// mirrors keep d > r, and the enclosing circle keeps d < r, which makes k
// negative, hence the absolute radius. A construction-specific map, not a core API.
function invertCircle(circle, mirror) {
  const dx = circle.x - mirror.x;
  const dy = circle.y - mirror.y;
  const k = mirror.r * mirror.r / (dx * dx + dy * dy - circle.r * circle.r);
  return { x: mirror.x + k * dx, y: mirror.y + k * dy, r: Math.abs(k) * circle.r };
}
