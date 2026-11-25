// A still for the light-plan sweeps in skills/artifex/reference/materials.md
// (one light plan): a textured sphere lit by one key light, whose direction is
// two parameters. `key` is the angle around the sphere as a fraction of a
// turn, 0 at the camera and 0.5 behind, counterclockwise seen from above, so
// 0.25 lights it from the right of the frame; `lift` is the height, a quarter
// turn below to a quarter turn above. Everything is drawn with opaque
// whole-unit grey fillRect blocks, so tests/contact-sheet.test.js paints the
// same pixels in Node.
// `npm run seeds -- tests/fixtures/key-lift.cjs 9 --param key,lift` draws the grid.

'use strict';

const W = 96;
const H = 96;
const R = 40;
const BLOCK = 2;

const grey = (g, v) => { g.fillStyle = `rgb(${v}, ${v}, ${v})`; };

module.exports = {
  name: 'key-lift',
  size: { w: W, h: H },
  seed: 1,
  params: {
    key: { min: 0, max: 1, value: 0.125, meaning: 'the key light\'s angle around the sphere as a fraction of a turn: 0 at the camera, 0.25 on the right, 0.5 behind' },
    lift: { min: -0.25, max: 0.25, value: 0.0625, meaning: 'the key light\'s height as a fraction of a turn: -0.25 below, 0 level, 0.25 above' },
  },
  draw(g, s) {
    const a = s.params.key * 2 * Math.PI, e = s.params.lift * 2 * Math.PI;
    // Light direction: x right, y up, z towards the camera.
    const L = [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)];
    grey(g, 40);
    g.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += BLOCK) {
      for (let x = 0; x < W; x += BLOCK) {
        const nx = (x + BLOCK / 2 - W / 2) / R, ny = -(y + BLOCK / 2 - H / 2) / R, rr = nx * nx + ny * ny;
        if (rr >= 1) continue;
        const nz = Math.sqrt(1 - rr);
        // A checker of latitude and longitude bands, so the half-light shows texture.
        const band = (Math.floor(Math.atan2(nx, nz) * 8 / Math.PI) + Math.floor(Math.asin(ny) * 6 / Math.PI)) & 1;
        const lit = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
        grey(g, Math.round(255 * Math.min(1, 0.06 + 0.9 * (0.8 + 0.2 * band) * lit)));
        g.fillRect(x, y, BLOCK, BLOCK);
      }
    }
  },
};
