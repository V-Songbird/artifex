// A film for replay's lag scan (`npm run replay -- --lag`, tools/replay.js):
// three bars slide along the middle the whole film, a block holds still at
// the lower left, and a square grows in at the upper right over four frames
// from BEAT. The seed picks the variant:
//   seed 1, the base film;
//   seed 2, the square's beat 5 frames later;
//   seed 3, the base timing in other colours, a control.
// Everything is drawn with opaque whole-unit fillRect in rgb(), so
// tests/replay.test.js paints the same pixels in Node.

'use strict';

const W = 480;
const H = 270;
const BEAT = 60;
// The square's region, for --region 320,20,120,120: x, y, w, h.
const REGION = [320, 20, 120, 120];

const rgb = ([r, g, b]) => `rgb(${r}, ${g}, ${b})`;

module.exports = {
  name: 'activity-film',
  size: { w: W, h: H },
  seed: 1,
  time: { duration: 6, hz: 24 },
  build: [['variant', (s) => {
    s.beat = BEAT + (s.seed === 2 ? 5 : 0);
    s.colours = s.seed === 3 ? [[200, 120, 60], [60, 200, 120], [120, 60, 200]] : [[230, 230, 230], [230, 80, 80], [80, 160, 230]];
  }]],
  draw(g, s, t, clock) {
    const f = clock.frame;
    g.fillStyle = rgb([20, 24, 32]);
    g.fillRect(0, 0, W, H);
    // Three bars at 3, 5 and 7 units a frame.
    s.colours.forEach((c, k) => {
      g.fillStyle = rgb(c);
      g.fillRect((40 + 150 * k + (3 + 2 * k) * f) % W, 150 + 12 * k, 30, 10);
    });
    g.fillStyle = rgb([240, 200, 60]);
    g.fillRect(40, 200, 60, 60);
    if (f >= s.beat) {
      const side = Math.min(4, f - s.beat + 1) * 20;
      g.fillStyle = rgb(s.colours[0]);
      g.fillRect(REGION[0] + (120 - side) / 2, REGION[1] + (120 - side) / 2, side, side);
    }
  },
};
