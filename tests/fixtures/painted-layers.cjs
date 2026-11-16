'use strict';

// Optical layering and a subsequent upper-sheet edit. Each card is a retained
// snapshot; the lower sheet supplies color, not water or pigment state.
const { medium, pigment } = require('../../core/medium.js');
const { show } = require('../../core/image.js');
const { sprite } = require('../../core/layer.js');
const blue = pigment('#345e9c', { opacity: 0.25 });
const ochre = pigment('#bd803c', { opacity: 0.3 });
const yellow = pigment('#e2bd45', { opacity: 0.12 });
const cream = pigment('#eee6cb', { opacity: 0.95 });
const image = frame => ({ w: frame.width, h: frame.height, channels: 4, data: new Uint8Array(frame.data) });
function cutout(g, s) {
  show(g, s.cards[3].image, 0, 0, 128, 96);
  if (g.canvas) g.clearRect(46, 30, 36, 36);
}

module.exports = {
  name: 'painted-layers', size: { w: 688, h: 1136 }, seed: 17,
  outputs: ['raster'], state: () => ({ cards: [] }),
  build: [
    ['paint separate sheets', s => {
      const lower = medium({ width: 128, height: 96, seed: s.seed, paper: { tooth: 0.25 } });
      lower.wash([[10, 12], [65, 12], [65, 84], [10, 84]], { pigment: blue, water: 0, amount: 0.8, wander: 0 });
      lower.wash([[65, 12], [118, 12], [118, 84], [65, 84]], { pigment: ochre, water: 0, amount: 0.8, wander: 0 });
      s.lower = lower.render();
      s.upper = medium({ width: 128, height: 96, seed: s.seed, paper: { tooth: 0.25 } });
      s.upper.wash([[25, 23], [104, 23], [104, 73], [25, 73]], { pigment: yellow, water: 0, amount: 0.45, wander: 0 });
      s.upper.paint([[29, 64, 0.2], [63, 53, 1], [99, 38, 0.2]],
        { colour: cream, width: 8, load: 0.6, oil: 0.3, bristles: 24, variation: 0.6 });
      s.cards.push({ label: 'Lower sheet', image: image(s.lower) },
        { label: 'Upper sheet on its own', image: image(s.upper.render()) },
        { label: 'Upper rendered over lower', image: image(s.upper.render({ backdrop: s.lower })) });
    }],
    ['edit only the upper sheet', s => {
      s.upper.stroke([[32, 32, 0.2], [60, 39, 0.8], [97, 58, 0.2]],
        { pigment: blue, width: 6, amount: 0.65, water: 0.08, length: 90 });
      s.cards.push({ label: 'After editing the upper sheet', image: image(s.upper.render({ backdrop: s.lower })) });
      for (const [label, mode] of [['Selection over lower sheet', 'select-over'], ['Cutout over lower sheet', 'cutout-over'],
        ['Selection on transparency', 'select-alpha'], ['Cutout on transparency', 'cutout-alpha']]) {
        s.cards.push({ label, mode, image: s.cards[3].image });
      }
      delete s.upper;
      delete s.lower;
    }],
  ],
  draw(g, s) {
    g.fillStyle = '#e8e3d9'; g.fillRect(0, 0, 688, 1136);
    g.font = '16px sans-serif'; g.textBaseline = 'top';
    s.cards.forEach((card, i) => {
      const x = 16 + i % 2 * 336, y = 16 + Math.floor(i / 2) * 280;
      g.fillStyle = '#222';
      // Labels, like the images, are raster presentation; the null surface skips them.
      if (g.canvas) g.fillText(card.label, x, y);
      g.save();
      try {
        g.translate(x, y + 24); g.scale(2.5, 2.5);
        if (card.mode?.endsWith('alpha')) { if (g.canvas) g.clearRect(0, 0, 128, 96); }
        else if (card.mode) show(g, s.cards[0].image, 0, 0, 128, 96);
        if (card.mode?.startsWith('select')) {
          g.beginPath(); g.arc(64, 48, 32, 0, Math.PI * 2); g.clip();
          show(g, card.image, 0, 0, 128, 96);
        } else if (card.mode?.startsWith('cutout')) sprite(g, s, 'painted-cutout', [0, 0, 128, 96], cutout);
        else show(g, card.image, 0, 0, 128, 96);
      } finally { g.restore(); }
    });
  },
};
