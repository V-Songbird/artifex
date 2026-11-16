// A warm quince rests on a folded blue cloth; its attached branch bends into
// the quiet paper above. The light comes from the upper left.
// Chosen, not given: one quince, a close elevated view, cream and ochre against
// muted blue-green, and a 960 x 720 still on a 320 x 240 design-unit sheet.
// Broad light and shade turn the fruit; the cloth's fold leads into its contact
// shadow. The branch brings the eye back to the stem and open paper.
// Public patterns reused: tidal-painting's build/render/image publication,
// the documented transparent sprite, and polygon operations for deposit masks.
'use strict';

const { medium, pigment } = require('../core/medium.js');
const { show } = require('../core/image.js');
const { rng } = require('../core/rand.js');
const { spline } = require('../core/geom.js');
const { intersection, difference, offset } = require('../core/clip.js');
const { fill, outline } = require('../core/path.js');
const { sprite } = require('../core/layer.js');

const W = 320, H = 240, SCALE = 3;
const PAPER = '#f2ecde';
const LIGHT = { light: [-0.6, -0.6, 0.7], relief: 0.28, gloss: 0.1, shadows: 0.25, sheen: 0.14 };
const blue = pigment('#506f7d', { opacity: 0.22, granulation: 0.72, staining: 0.55 });
const deep = pigment('#263f4c', { opacity: 0.35, granulation: 0.65, staining: 0.7 });
const gold = pigment('#d9b13c', { opacity: 0.55, granulation: 0.45, staining: 0.6 });
const ochre = pigment('#a88039', { opacity: 0.3, granulation: 0.72, staining: 0.4 });
const umber = pigment('#66523b', { opacity: 0.7, granulation: 0.5, staining: 0.8 });
const green = pigment('#617653', { opacity: 0.35, granulation: 0.6, staining: 0.5 });
const cream = pigment('#f4e7b9', { opacity: 0.95, granulation: 0.2 });
const pale = pigment('#f4e7b9', { opacity: 0.16, granulation: 0.22, staining: 0.4 });

function rounded(points) {
  return spline(points, 1.5, { close: true });
}

function publish(s) {
  const frame = s.sheet.render(LIGHT);
  s.image = Object.freeze({ w: frame.width, h: frame.height, channels: 4, data: new Uint8Array(frame.data) });
}

// Every leaf and vein share an attachment and tip on the rotated branch.
function leafShape(base, tip, width) {
  const dx = tip[0] - base[0], dy = tip[1] - base[1], len = Math.hypot(dx, dy);
  const side = (t, sign) => {
    const belly = Math.sin(Math.PI * t) * width * (0.8 + 0.2 * t);
    return [base[0] + dx * t - dy / len * belly * sign,
      base[1] + dy * t + dx / len * belly * sign];
  };
  return [...Array.from({ length: 13 }, (_, i) => side(i / 12, 1)),
    ...Array.from({ length: 11 }, (_, i) => side((11 - i) / 12, -1))];
}

function drawDetails(g, s) {
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  g.fillStyle = '#66523b';
  fill(g, outline(s.branch, u => 1.3 * (1 - u) + 0.22));
  g.fillStyle = '#efe0aa';
  for (const leaf of s.leaves) {
    g.globalAlpha = 0.42;
    fill(g, outline([leaf.base, leaf.tip], [0.38, 0]));
  }
  g.globalAlpha = 0.9;
  g.fillStyle = '#594633';
  fill(g, outline(spline([[188, 102], [194, 105], [201, 103]], 1),
    u => 1.4 * Math.sin(Math.PI * u) + 0.2));
}

module.exports = {
  name: 'quince-and-shadow',
  size: { w: W * SCALE, h: H * SCALE },
  seed: 29,
  time: null,
  outputs: ['raster'],
  params: {
    water: { min: 0.45, max: 1.3, value: 0.75, meaning: 'Water in the cloth, fruit and leaf washes; changes spreading and wet edges' },
    branchAngle: { min: -12, max: 8, value: -8, meaning: 'Degrees rotating the attached branch toward the upper paper' },
    dryLoad: { min: 0.45, max: 1.2, value: 0.8, meaning: 'Strength of dry brush folds and small opaque light accents' },
  },
  state: () => ({}),
  build: [
    ['composition', s => {
      const R = rng(s.seed), angle = s.params.branchAngle * Math.PI / 180;
      const turn = ([x, y]) => [195 + (x - 195) * Math.cos(angle) - (y - 103) * Math.sin(angle),
        103 + (x - 195) * Math.sin(angle) + (y - 103) * Math.cos(angle)];
      s.mask = intersection([[23, 24], [297, 24], [297, 217], [23, 217]],
        [[13, 11], [281, 11], [309, 224], [41, 224]]);
      s.fruit = rounded([[195, 100], [208, 102], [214, 112], [228, 119],
        [239, 135], [243, 154], [236, 172], [222, 184], [204, 189],
        [184, 186], [168, 178], [158, 163], [159, 147], [166, 132],
        [179, 120], [184, 107]].map(([x, y], i) =>
        [x + (R('fruit', 'edge-x', i) - 0.5) * 1.5, y + (R('fruit', 'edge-y', i) - 0.5) * 1.5]));
      s.subjectBox = [155 * SCALE, 98 * SCALE, 91 * SCALE, 94 * SCALE];
      s.branch = spline([[195, 105], [190, 94], [170, 84], [143, 70], [116, 65], [88, 55]].map(turn), 1.5);
      s.leaves = [
        [[178, 88], [175, 55], 7.8],
        [[158, 78], [132, 98], 8.8],
        [[141, 70], [122, 40], 7.1],
        [[115, 65], [88, 82], 6.2],
        [[102, 60], [88, 45], 5.3],
      ].map(([base, tip, width], i) => {
        const b = turn(base), p = turn([tip[0] + (R('leaf', 'tip-x', i) - 0.5) * 4,
          tip[1] + (R('leaf', 'tip-y', i) - 0.5) * 4]);
        return { base: b, tip: p, shape: leafShape(b, p, width), pressure: 0.75 + R('leaf', 'pressure', i) * 0.25 };
      });
      s.sheet = medium({ width: W, height: H, cell: 0.5, seed: s.seed, evaporate: 3,
        paper: { colour: PAPER, grain: 4.5, tooth: 0.28, weave: 0, absorb: 0.5 } });
      publish(s);
    }],
    ['cloth and cast shadow', s => {
      const m = s.sheet, water = s.params.water;
      const reserve = offset(s.fruit, -1, { closed: true, join: 'round' });
      if (reserve.length !== 1) throw new Error('quince-and-shadow: fruit reservation must stay one contour');
      const cloth = rounded([[24, 169], [80, 148], [128, 146], [158, 158],
        [171, 181], [225, 190], [272, 205], [275, 223], [48, 223]]);
      const fold = rounded([[25, 192], [92, 169], [129, 163], [148, 174],
        [162, 195], [221, 206], [247, 222], [40, 222]]);
      // A narrow overlap under the fruit prevents a paper halo at its contact.
      for (const shape of difference(cloth, reserve[0])) m.wash(shape,
        { pigment: blue, water, amount: 1.15, wander: 0.8 });
      for (const shape of difference(fold, reserve[0])) m.wash(shape,
        { pigment: deep, water: water * 0.7, amount: 0.7, wander: 0.7 });
      const foldLight = rounded([[60, 165], [105, 150], [132, 153], [151, 166],
        [128, 161], [104, 159], [78, 174]]);
      for (const shape of intersection(cloth, foldLight)) m.wash(shape,
        { pigment: pale, water: water * 0.4, amount: 0.18, wander: 0.3 });
      const shadow = rounded([[177, 180], [203, 177], [234, 184], [256, 197],
        [235, 203], [207, 199], [184, 192]]);
      for (const shape of difference(shadow, reserve[0])) m.wash(shape,
        { pigment: deep, water: water * 0.4, amount: 0.78, wander: 0.6 });
      m.step(12);
      publish(s);
    }],
    ['fruit and leaves', s => {
      const m = s.sheet, water = s.params.water;
      m.wash(s.fruit, { pigment: gold, water: water * 0.7, amount: 1.55, wander: 0.35 });
      const shade = rounded([[204, 110], [222, 119], [240, 138], [247, 159],
        [235, 181], [208, 194], [182, 184], [187, 173], [209, 163], [218, 146], [216, 127]]);
      for (const shape of intersection(s.fruit, shade)) m.wash(shape,
        { pigment: ochre, water: water * 0.5, amount: 0.85, wander: 0.2 });
      const turningShade = rounded([[228, 134], [244, 150], [238, 174],
        [221, 188], [198, 193], [183, 182], [204, 177], [220, 166], [228, 151]]);
      for (const shape of intersection(s.fruit, turningShade)) m.wash(shape,
        { pigment: umber, water: water * 0.35, amount: 0.2, wander: 0.2 });
      const lightPlane = rounded([[185, 113], [199, 114], [207, 129], [201, 144],
        [185, 159], [171, 158], [170, 141], [176, 125]]);
      for (const shape of intersection(s.fruit, lightPlane)) m.wash(shape,
        { pigment: pale, water: water * 0.45, amount: 0.42, wander: 0.25 });
      m.stroke([[228, 149, 0.4], [229, 163, 0.8], [217, 178, 0.35], [202, 183, 0.1]],
        { pigment: green, width: 7, water: water * 0.5, amount: 0.22, length: 42 });
      for (const leaf of s.leaves) {
        m.wash(leaf.shape, { pigment: green, water: water * 0.6, amount: leaf.pressure, wander: 0.25 });
        m.stroke([leaf.base, leaf.tip], { pigment: blue, width: 3.2, water: water * 0.5,
          amount: 0.3, length: 25 });
      }
      // Twelve cloth ticks plus 24 here: 36 finite ticks on 307,200 cells.
      m.tilt(0.1, 0.16);
      m.step(24);
      m.tilt(0, 0);
      publish(s);
    }],
    ['dry marks and light', s => {
      const m = s.sheet, load = s.params.dryLoad;
      m.stroke([[45, 181, 0.2], [87, 164, 0.7], [121, 158, 0.35], [145, 164, 0.1]],
        { pigment: blue, width: 3.2, water: 0.08, amount: load * 0.42, length: 68 });
      m.stroke([[91, 197, 0.25], [128, 183, 0.8], [153, 188, 0.45], [187, 205, 0.1]],
        { pigment: deep, width: 2.2, water: 0.06, amount: load * 0.3, length: 60 });
      // A compact contact follows the underside where the fruit meets the fold.
      m.stroke([[184, 187, 0.1], [201, 190, 0.7], [221, 185, 0.15]],
        { pigment: umber, width: 2.1, water: 0.07, amount: load * 0.5, length: 30 });
      m.stroke(s.branch, { pigment: umber, width: 2.2, water: 0.08, amount: load, length: 115 });
      m.paint([[177, 131, 0.1], [179, 128, 0.4], [183, 126, 0.05]],
        { colour: cream, width: 1.4, load: load * 0.09, oil: 0.3, pick: 0.05,
          bristles: 8, length: 6, variation: 0.4 });
      m.paint([[80, 158, 0.1], [104, 153, 0.45], [125, 157, 0.1]],
        { colour: cream, width: 1.4, load: load * 0.055, oil: 0.25, pick: 0.15,
          bristles: 8, length: 28, variation: 0.55 });
      m.cure(0.4);
      publish(s);
      s.simulation = { cells: m.cols * m.rows, steps: 36, wetCells: m.wetCells() };
      delete s.sheet;
    }],
  ],
  draw(g, s) {
    g.fillStyle = PAPER;
    g.fillRect(0, 0, W * SCALE, H * SCALE);
    g.save();
    g.scale(SCALE, SCALE);
    g.save();
    g.beginPath();
    for (const ring of s.mask) {
      g.moveTo(ring[0][0], ring[0][1]);
      for (const point of ring.slice(1)) g.lineTo(point[0], point[1]);
      g.closePath();
    }
    g.clip();
    show(g, s.image, 0, 0, W, H);
    sprite(g, s, 'stem-and-veins', [0, 0, W, H], drawDetails);
    g.restore();
    g.restore();
  },
};
