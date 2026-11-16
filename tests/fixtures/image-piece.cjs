// A film drawn over and from an image this module makes when it loads, for
// proving that a declared image travels through the page, its PNG and film
// exports and replay. The image is 64 x 36 RGB pixels: red rising from left to
// right, green from top to bottom, blue held at 96. On a raster surface draw
// shows it under the whole frame; then a row of discs, each as large as the
// image is light under it, and a bar that crosses the frame the whole time, so
// something moves to the end. Its SVG holds the discs and the bar alone.

'use strict';

const { show, fit, tone } = require('../../core/image.js');

const W = 320;
const H = 180;
const IW = 64;
const IH = 36;

// The image's bytes, row by row, as base64 text, the form npm run image writes.
let text = '';
for (let y = 0; y < IH; y++) {
  for (let x = 0; x < IW; x++) text += String.fromCharCode(Math.round(255 * x / (IW - 1)), Math.round(255 * y / (IH - 1)), 96);
}

module.exports = {
  name: 'image-piece',
  size: { w: W, h: H },
  seed: 1,
  time: { duration: 2, hz: 12 },
  outputs: ['raster', 'vector'],
  images: {
    ground: { w: IW, h: IH, channels: 3, pixels: btoa(text), source: 'made from code by tests/fixtures/image-piece.cjs', rights: 'part of the Artifex tests, MIT licence' },
  },
  draw(g, s, t) {
    const img = s.images.ground;
    if (g.canvas) show(g, img, ...fit(img, [0, 0, W, H]));
    g.fillStyle = '#101418';
    for (let i = 0; i < 15; i++) {
      const x = 20 + i * 20;
      g.beginPath();
      g.arc(x, 90, 2 + 7 * tone(img, x / W, 0.5), 0, 2 * Math.PI);
      g.fill();
    }
    g.fillStyle = '#f4f1ea';
    g.fillRect(t * (W - 30), H - 40, 30, 12);
  },
};
