// A deep tidal pool meets a broken ochre bank; a few raised cream marks catch
// the light above translucent blue water.
// Chosen, not given: an abstract coast, a quiet upper margin, a blue/ochre
// palette and 240 x 180 design units sampled on 480 x 360 cells, displayed at 720 x 540.
// Leave out literal boats, contour outlines, decorative dots and repeated
// marks of equal weight: the broad pool and one diagonal bank carry the image.
'use strict';

const { medium, pigment } = require('../core/medium.js');
const { show } = require('../core/image.js');
const { rng } = require('../core/rand.js');
const { intersection, offset } = require('../core/clip.js');
const { chaikin } = require('../core/geom.js');

const W = 720, H = 540;
const SHEET_W = 240, SHEET_H = 180;
const LIGHT = { relief: 0.35, gloss: 0.32, shadows: 0.5, sheen: 0.35 };
const sea = pigment('#527f87', { opacity: 0.12, granulation: 0.65, staining: 0.3 });
const deep = pigment('#1d425c', { opacity: 0.17, granulation: 0.5, staining: 0.7 });
const sand = pigment('#c9a56b', { opacity: 0.13, granulation: 0.75, staining: 0.4 });
const ochre = pigment('#bd863f', { opacity: 0.88, granulation: 0.4 });
const cream = pigment('#f0e6cc', { opacity: 0.95, granulation: 0.2 });
const slate = pigment('#26454c', { opacity: 0.85, granulation: 0.3 });

// Each control point has its own stable address. Adding a different gesture
// cannot move these points. Endpoints stay authored to preserve the composition.
function gesture(seed, name, points, spread = 2) {
  const R = rng(seed);
  return points.map(([x, y, pressure = 1], i) => {
    const d = i === 0 || i === points.length - 1 ? 0 : spread;
    return [x + (R(name, 'x', i) - 0.5) * d,
      y + (R(name, 'y', i) - 0.5) * d, pressure];
  });
}

function snapshot(s) {
  const frame = s.medium.render(LIGHT);
  // image.show expects ordinary Uint8Array pixels and w/h/channels. Copy the
  // medium's Uint8ClampedArray: this published buffer is never painted into.
  s.image = Object.freeze({
    w: frame.width, h: frame.height, channels: 4,
    data: new Uint8Array(frame.data),
  });
}

module.exports = {
  name: 'tidal-painting',
  size: { w: W, h: H },
  seed: 14,
  outputs: ['raster'],
  params: {
    // These are medium amounts, not percentages or a physical water volume.
    water: { min: 0.35, max: 1.8, value: 1.1, meaning: 'Water carried by the washes and watercolor strokes' },
    load: { min: 0.2, max: 1.8, value: 1, meaning: 'Body-paint coverage and raised ridges, plus the lower dry-brush accent' },
    tooth: { min: 0.1, max: 0.9, value: 0.25, meaning: 'Paper relief; changes granulation and brush contact, with fixed absorption' },
  },
  state: () => ({}),
  build: [
    ['paper', (s) => {
      s.medium = medium({
        width: SHEET_W, height: SHEET_H, cell: 0.5, seed: s.seed, evaporate: 3,
        paper: { colour: '#f1eadc', grain: 5, tooth: s.params.tooth, weave: 0.05, absorb: 0.45 },
      });
      snapshot(s);
    }],
    ['wash', (s) => {
      const m = s.medium, water = s.params.water;
      const seaShape = chaikin(gesture(s.seed, 'sea mass', [
        [14, 25], [102, 30], [160, 64], [224, 68], [224, 139],
        [161, 126], [110, 94], [54, 88], [14, 65],
      ], 5).map(([x, y]) => [x, y]), 2, true);
      // A narrow clean-water margin gives the deposited edge room to spread.
      // offset returns rings; this authored support must remain one contour.
      const support = offset(seaShape, 4, { closed: true, join: 'round' });
      if (support.length !== 1) throw new Error('tidal-painting: prewet support must stay one contour');
      m.wash(support[0], { water: water * 0.4, wander: 0 });
      m.wash(seaShape, { pigment: sea, water, amount: 0.55, wander: 2.5 });
      m.wash(chaikin(gesture(s.seed, 'deep pool', [
        [30, 34], [95, 36], [126, 54], [114, 72], [63, 69], [20, 53],
      ], 4).map(([x, y]) => [x, y]), 2, true),
      { pigment: deep, water: water * 0.65, amount: 0.6, wander: 2 });
      const sandShelf = gesture(s.seed, 'sand shelf', [
        [66, 105], [124, 103], [175, 131], [222, 143], [222, 165], [121, 160],
      ], 4).map(([x, y]) => [x, y]); // Polygon operations take coordinates without pressure.
      // Reserve a dry paper margin below the shore by clipping the deposited
      // wash. Later water remains free to move across this initial boundary.
      const shoreMask = [[0, 0], [240, 0], [240, 150], [155, 144], [80, 145], [0, 120]];
      for (const shape of intersection(sandShelf, shoreMask)) {
        m.wash(shape, { pigment: sand, water: water * 0.6, amount: 0.4, wander: 2.5 });
      }

      // Exactly 32 water steps on 172,800 cells: eight to join the broad washes,
      // then 24 to carry the darker strokes. This is a chosen wet moment, not
      // an instruction to run until dry. Drawing never advances this clock.
      m.step(8);
      m.stroke(gesture(s.seed, 'pool depth', [
        [28, 48, 0.4], [61, 56, 1], [95, 58, 0.9], [125, 70, 0.15],
      ]), { pigment: deep, width: 13, water: water * 0.7, amount: 0.65, length: 105 });
      m.stroke(gesture(s.seed, 'tidal channel', [
        [103, 75, 0.2], [131, 86, 0.75], [158, 100, 1], [194, 108, 0.2],
      ]), { pigment: sea, width: 10, water, amount: 0.5, length: 100 });
      m.tilt(0.2, 0.35);
      m.step(24);
      m.tilt(0, 0);
      snapshot(s);
    }],
    ['body paint', (s) => {
      const m = s.medium, load = s.params.load;
      m.paint(gesture(s.seed, 'ochre bank', [
        [36, 99, 0.25], [65, 92, 0.95], [87, 97, 0.5], [110, 102, 1],
        [137, 115, 0.55], [164, 131, 0.85], [202, 142, 0.15],
      ], 3), { colour: ochre, width: 10, load, oil: 0.2, pick: 0.18, bristles: 28, length: 110, variation: 0.35 });
      m.paint(gesture(s.seed, 'bank light', [
        [85, 95, 0.2], [116, 101, 0.8], [146, 117, 0.6], [178, 125, 0.1],
      ]), { colour: cream, width: 6, load: load * 0.55, oil: 0.3, pick: 0.35, bristles: 20, length: 85, dirty: true });
      m.paint(gesture(s.seed, 'dark seam', [
        [54, 88, 0.15], [78, 87, 0.8], [106, 97, 0.2],
      ]), { colour: slate, width: 3.5, load: load * 0.45, oil: 0.25, pick: 0.2, bristles: 12, length: 45 });
      m.stroke(gesture(s.seed, 'lower glint', [
        [164, 141, 0.1], [180, 146, 0.75], [193, 150, 0.1],
      ]), { pigment: cream, width: 4, amount: load * 0.32, water: 0.08, length: 35 });
      m.knife(gesture(s.seed, 'scraped bank', [
        [98, 104], [121, 110], [147, 122],
      ], 1), { width: 3.8, level: 0.035 });
      snapshot(s);
    }],
    ['finish', (s) => {
      s.medium.cure(0.28);
      snapshot(s);
      // The finished piece needs only pixels. Earlier stages remain inspectable
      // through solve(..., { until: 'wash' }) without retaining a solver here.
      delete s.medium;
    }],
  ],
  draw(g, s) {
    show(g, s.image, 0, 0, W, H);
  },
};
