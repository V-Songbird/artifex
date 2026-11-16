// A hatch-heavy film for measuring the export: an engraved field of hills and
// a lit sphere, shaded only by fine ruled lines in three directions, panning
// slowly, the lines boiling on twos as an engraver's hand would, so every
// frame differs. The line spacing and weight sit near the pixel at 1x, which is
// what a video encoder loses first.

'use strict';

const { rng, noise2 } = require('../../core/rand.js');

const W = 960;
const H = 540;
const STEP = 3;          // design pixels between ruled lines
const SAMPLE = 5;        // design pixels between tone samples along a line
const FAMILIES = [       // angle in degrees, and the tone above which it is ruled
  [35, 0.28], [-35, 0.5], [90, 0.72],
];

module.exports = {
  name: 'hatch-film',
  size: { w: W, h: H },
  seed: 1,
  time: { duration: 4, hz: 24 },
  build: [['field', (s) => { s.R = rng(s.seed); }]],
  draw(g, s, t, clock) {
    const pan = t * 120;
    const boil = Math.floor(clock.frame / 2);
    // Darkness in [0, 1]: rolling hills, and a sphere lit from the upper left.
    const tone = (x, y) => {
      const hill = noise2(s.R, (x + pan) / 180, y / 140, 'hills') * 0.8 + noise2(s.R, (x + pan) / 45, y / 45, 'grit') * 0.25;
      const dx = (x - 620) / 150, dy = (y - 230) / 150, r2 = dx * dx + dy * dy;
      if (r2 < 1) {
        const nz = Math.sqrt(1 - r2);
        return Math.min(1, Math.max(0, 1 - (-0.55 * dx - 0.55 * dy + 0.63 * nz)));
      }
      return Math.min(1, Math.max(0, hill * (0.4 + 0.6 * y / H)));
    };
    g.fillStyle = '#f2ecdf';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#1e1a16';
    g.lineWidth = 0.6;
    g.lineCap = 'butt';
    const reach = Math.hypot(W, H);
    FAMILIES.forEach(([deg, above], family) => {
      const a = (deg * Math.PI) / 180, ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux;
      g.beginPath();
      for (let o = -reach / 2, line = 0; o <= reach / 2; o += STEP, line++) {
        const shift = (s.R('boil', family + ' ' + boil, line) - 0.5) * STEP * 0.4;
        let on = false;
        for (let d = -reach / 2; d <= reach / 2; d += SAMPLE) {
          const x = W / 2 + nx * (o + shift) + ux * d, y = H / 2 + ny * (o + shift) + uy * d;
          const inside = x >= 0 && x <= W && y >= 0 && y <= H && tone(x, y) > above;
          if (inside && !on) g.moveTo(x, y);
          else if (inside) g.lineTo(x, y);
          on = inside;
        }
      }
      g.stroke();
    });
  },
};
