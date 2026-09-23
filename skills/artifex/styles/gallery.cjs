// The style gallery: one still per named style, chosen by `style`, all
// drawing the same demo subject so the styles compare side by side. Each
// style's guide sits next to its module; catalog.md lists them.

'use strict';

const STYLES = [
  require('./papercraft.js'),
  require('./render-3d.js'),
  require('./cad.js'),
  require('./pixel-art.js'),
  require('./embroidery.js'),
  require('./sticker.js'),
  require('./voxel.js'),
  require('./doodle.js'),
  require('./kandinsky.js'),
  require('./impasto.js'),
];

module.exports = {
  name: 'style-gallery',
  size: { w: 1000, h: 1000 },
  seed: 2026,
  params: {
    style: { min: 0, max: 9, value: 0,
      meaning: '0 papercraft, 1 3D render, 2 CAD, 3 pixel art, 4 embroidery, 5 sticker, 6 voxel, 7 doodle, 8 Kandinsky, 9 impasto' },
  },
  draw(g, s) {
    STYLES[Math.max(0, Math.min(STYLES.length - 1, Math.round(s.params.style)))].draw(g, s);
  },
};
