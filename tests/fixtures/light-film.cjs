// A dark film in seven 3-second shots, for the time strip's light flag
// (`flags.lights` in tools/contact-sheet.js): a lamp, a stepped pool of light
// on a dark ground, sweeps across the frame; holds while the ground brightens;
// holds while its level rises from a third to full; switches off and back on;
// holds while the camera pans; small, switches off beside a brighter static
// lit area; and drifts slowly, each strip step under 1% of the width but the
// whole shot over it. Only the second shot holds its light. Everything is drawn
// with opaque whole-pixel grey fillRect, so tests/contact-sheet.test.js paints
// the same pixels in Node. `npm run seeds -- tests/fixtures/light-film.cjs
// --shots --json` shows each shot's flag.

'use strict';

const W = 640;
const H = 360;
const GROUND = 10;
const SHOTS = [['sweep', 0], ['drift', 36], ['rise', 72], ['switch', 108], ['pan', 144], ['dilute', 180], ['creep', 216]];

// The stepped pool centred on (x, y): squares 96, 64 and 32 wide, rising
// `scale` times 12, 24 and 40 over `ground`.
const lamp = (g, x, y, ground, scale = 1) => {
  [[96, 12], [64, 24], [32, 40]].forEach(([side, rise]) => {
    const v = ground + Math.round(rise * scale);
    g.fillStyle = `rgb(${v}, ${v}, ${v})`;
    g.fillRect(x - side / 2, y - side / 2, side, side);
  });
};

const ground = (g, v) => {
  g.fillStyle = `rgb(${v}, ${v}, ${v})`;
  g.fillRect(0, 0, W, H);
};

module.exports = {
  name: 'light-film',
  size: { w: W, h: H },
  seed: 1,
  time: { duration: 21, hz: 12 },
  build: [['shots', (s) => {
    s.cues = { shots: SHOTS.map(([name, start]) => ({ name, start, end: start + 36 })) };
  }]],
  draw(g, s, t, clock) {
    const frame = clock.frame, shot = Math.min(6, Math.floor(frame / 36)), f = frame - shot * 36;
    if (shot === 0) {
      ground(g, GROUND);
      lamp(g, Math.round(120 + 400 * f / 35), 180, GROUND);
    } else if (shot === 1) {
      ground(g, GROUND + f);
      lamp(g, 320, 180, GROUND + f);
    } else if (shot === 2) {
      ground(g, GROUND);
      lamp(g, 320, 180, GROUND, 1 / 3 + 2 / 3 * f / 35);
    } else if (shot === 3) {
      ground(g, GROUND);
      if (f < 12 || f >= 24) lamp(g, 320, 180, GROUND);
    } else if (shot === 4) {
      // The camera pans 8 units a frame: the lamp and the furniture, darker
      // than the ground, move together.
      const dx = -8 * f;
      ground(g, GROUND);
      g.fillStyle = 'rgb(4, 4, 4)';
      g.fillRect(520 + dx, 240, 120, 80);
      g.fillRect(300 + dx, 40, 40, 200);
      lamp(g, 460 + dx, 180, GROUND);
    } else if (shot === 5) {
      // A static area at a rise of 200 beside a small lamp at 40, which goes
      // off at the shot's middle frame.
      ground(g, GROUND);
      g.fillStyle = 'rgb(210, 210, 210)';
      g.fillRect(0, 0, 128, 80);
      if (f < 17) {
        g.fillStyle = 'rgb(50, 50, 50)';
        g.fillRect(136, 16, 48, 48);
      }
    } else {
      // A quarter unit a frame: 280, 284 and 289 on a --shots strip, each step
      // under 1% of the width, first to last over it.
      ground(g, GROUND);
      lamp(g, Math.round(280 + f / 4), 180, GROUND);
    }
  },
};
