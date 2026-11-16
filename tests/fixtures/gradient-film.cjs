// Slow ramps, for measuring banding in a saved film or PNG: three bands, each
// a horizontal linear gradient that climbs few levels across the whole width,
// a dark grey, a dark blue and a light grey, where a conversion that rounds
// every pixel the same way leaves wide flat steps. A small square crosses the
// bottom edge, below the bands' measured rows, so something moves to the end.

'use strict';

const W = 960;
const H = 540;
const BANDS = [
  ['#101010', '#303030'],
  ['rgb(10, 20, 40)', 'rgb(30, 60, 100)'],
  ['#d0d0d0', '#f0f0f0'],
];

module.exports = {
  name: 'gradient-film',
  size: { w: W, h: H },
  seed: 1,
  time: { duration: 1, hz: 24 },
  draw(g, s, t) {
    BANDS.forEach(([from, to], i) => {
      const ramp = g.createLinearGradient(0, 0, W, 0);
      ramp.addColorStop(0, from);
      ramp.addColorStop(1, to);
      g.fillStyle = ramp;
      g.fillRect(0, (i * H) / 3, W, H / 3);
    });
    g.fillStyle = '#808080';
    g.fillRect(t * (W - 20), H - 24, 20, 20);
  },
};
