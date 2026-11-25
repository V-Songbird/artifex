// Beat sheet
// two values: 0.19, 0.92
// A film held to two values, for the time strip's two-value check
// (`flags.between` in tools/contact-sheet.js): three 2-second shots of light
// anti-aliased discs and a slanted band on a dark ground, rgb(230, 230, 230) on
// rgb(20, 20, 20). The middle shot adds a mid-grey bar over a tenth of the
// frame, so only its cells are flagged. `npm run seeds --
// tests/fixtures/two-value-film.cjs --shots --json` shows each cell's share.

'use strict';

const W = 640;
const H = 360;
const SHOTS = [['open', 0], ['bar', 24], ['close', 48]];

module.exports = {
  name: 'two-value-film',
  size: { w: W, h: H },
  seed: 1,
  time: { duration: 6, hz: 12 },
  build: [['shots', (s) => {
    s.cues = { shots: SHOTS.map(([name, start]) => ({ name, start, end: start + 24 })) };
  }]],
  draw(g, s, t, clock) {
    const shot = Math.floor(clock.frame / 24);
    g.fillStyle = 'rgb(20, 20, 20)';
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgb(230, 230, 230)';
    for (let k = 0; k < 5; k++) {
      g.beginPath();
      g.arc(80 + k * 120 + 10 * Math.sin(t * 6 + k), 120 + 30 * Math.cos(t * 4 + k), 28 + 6 * k, 0, Math.PI * 2);
      g.fill();
    }
    const lift = 20 * Math.sin(t * 3);
    g.beginPath();
    g.moveTo(0, 300); g.lineTo(W, 240 + lift); g.lineTo(W, 262 + lift); g.lineTo(0, 322);
    g.closePath();
    g.fill();
    if (shot === 1) {
      g.fillStyle = 'rgb(128, 128, 128)';
      g.fillRect(0, 0, 64, H);
    }
  },
};
