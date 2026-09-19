// specimen -- hard-edged, typographic, a still, and vector-bound.
//
// IN THE SET BECAUSE IT BREAKS THE OTHERS' ASSUMPTIONS. It has no organic
// curvature, no timeline, no volume for a contour to bound, and no tolerance for
// a mark being nudged: a letter is either right or it is a different letter.
// In the engine this project imports from, the type specimen was worth more than
// the other seven subjects combined, because it was the only one that failed.
//
// It is also the piece that proves letters can leave the screen. `fillText` is
// refused by a vector surface, so every glyph here is geometry.

'use strict';

const { rng } = require('../core/rand.js');
const { pick } = require('../core/num.js');
const { readableOn, contrast } = require('../core/colour.js');
const font = require('./stroke-font.js');

const ROWS = ['ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ', '0123456789&?!', ".,-:;'()*/"];

const SAMPLES = [
  'THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG',
  'PACK MY BOX WITH FIVE DOZEN LIQUOR JUGS',
  'SPHINX OF BLACK QUARTZ, JUDGE MY VOW',
  'HOW VEXINGLY QUICK DAFT ZEBRAS JUMP',
  'WALTZ, NYMPH, FOR QUICK JIGS VEX BUD',
];

const PAPER = '#f4f1e8';
const INK = '#16161a';
// Six accents, stated as a preset rather than a default: the reason for any one
// of them is art direction, not machinery. N2.
const ACCENTS = ['#b4381f', '#1f5fb4', '#2f7d4f', '#8a3fa8', '#b8871f', '#1f7d86'];

const M = 76;          // sheet margin
const W = 900;
const H = 1200;

module.exports = {
  name: 'specimen',
  size: { w: W, h: H },
  outputs: ['raster', 'vector'],
  time: null,          // A SHEET HAS NO TIMELINE. It does not need one to be art.
  seed: 4,
  params: {
    // A DECLARED PARAMETER MUST MOVE THE OUTPUT, and it is checked at three
    // pins rather than two. Declaring one and then never reading it is a
    // declaration that cannot fail, which is the whole disease this project
    // exists to avoid -- and it is what this block did on its first draft.
    sample: { min: 0, max: SAMPLES.length - 1, value: 0,
      meaning: 'which of the built-in text samples is set on the grid' },
  },

  state: () => ({ lines: [], accent: ACCENTS[0], sample: SAMPLES[0] }),

  build: [
    ['choose the specimen text and accent', (s) => {
      const R = rng(s.seed);
      // The caller chooses the text; the seed chooses the ink. Two inputs, two
      // jobs, neither one silently overruling the other.
      s.sample = SAMPLES[Math.min(SAMPLES.length - 1, Math.round(s.params.sample))];
      s.accent = pick(ACCENTS, R('sheet', 'accent'));
      // MEASURED, not assumed. The reversed block used to set paper-coloured
      // type on whichever accent the seed chose, which is a bet that every
      // accent is dark enough. This asks.
      s.reversed = readableOn(s.accent, [PAPER, INK]);
      s.reversedContrast = contrast(s.accent, s.reversed);
    }],

    ['lay the baseline grid', (s) => {
      // The grid is geometry, not decoration: the specimen block sits on it and
      // the hairlines show that it does.
      s.lines = [];
      for (let y = 500; y <= 836; y += 24) s.lines.push(y);
    }],
  ],

  draw(g, s) {
    g.fillStyle = PAPER;
    g.fillRect(0, 0, W, H);

    g.lineCap = 'round';
    g.lineJoin = 'round';

    // --- masthead -------------------------------------------------------
    g.strokeStyle = INK;
    g.lineWidth = 3.5;
    font.text(g, 'ARTIFEX', M, 84, 40);

    g.lineWidth = 1.4;
    font.text(g, 'A STROKE SPECIMEN. EVERY LETTER IS A POLYLINE.', M, 148, 13);

    g.lineWidth = 2.6;
    g.beginPath();
    g.moveTo(M, 180);
    g.lineTo(W - M, 180);
    g.stroke();

    // --- the character set ---------------------------------------------
    let y = 226;
    for (const row of ROWS) {
      g.strokeStyle = INK;
      g.lineWidth = 2.6;
      font.text(g, row, M, y, 34);
      y += 62;
    }

    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(M, 470);
    g.lineTo(W - M, 470);
    g.stroke();

    // --- the sample block, on its grid ----------------------------------
    g.strokeStyle = s.accent;
    g.lineWidth = 0.5;
    for (const ly of s.lines) {
      g.beginPath();
      g.moveTo(M, ly);
      g.lineTo(W - M, ly);
      g.stroke();
    }

    // Wrapped at three sizes. Detail and contrast fall away down the block:
    // the largest line carries the focal weight and the rest recede.
    const block = W - 2 * M;
    let by = 512;
    for (const [size, weight] of [[40, 3.2], [22, 1.9], [13, 1.1]]) {
      g.strokeStyle = INK;
      g.lineWidth = weight;
      for (const line of wrap(s.sample, block, size)) {
        font.text(g, line, M, by, size);
        by += size * 1.55 + 14;
      }
      by += 18;
    }

    // --- a reversed block -----------------------------------------------
    const bx = M;
    const bw = W - 2 * M;
    const bh = 132;
    const by0 = 860;
    g.fillStyle = s.accent;
    g.fillRect(bx, by0, bw, bh);
    g.strokeStyle = s.reversed;
    g.lineWidth = 3.4;
    font.text(g, 'REVERSED', bx + 26, by0 + 30, 40);
    g.lineWidth = 1.3;
    font.text(g, 'A FILL AND A STROKE, BOTH PATHS, BOTH PLOTTABLE.', bx + 26, by0 + 96, 12);

    // --- the measured panel ---------------------------------------------
    g.strokeStyle = INK;
    g.lineWidth = 1.2;
    let py = 1024;
    const facts = [
      `SEED ${s.seed}`,
      `${font.runCount(ROWS.join(''))} RUNS IN THE CHARACTER SET`,
      `${s.sample.length} CHARACTERS IN THE SAMPLE`,
      `REVERSED AT ${s.reversedContrast.toFixed(1)} TO 1, MEASURED`,
      'DECLARED: RASTER, VECTOR',
      'TIME: NONE. A STILL IS A LEGAL PIECE.',
    ];
    for (const f of facts) {
      font.text(g, f, M, py, 13);
      py += 24;
    }

    // --- the two-point runs, called out ---------------------------------
    // T's crossbar and E's bars are straight two-point runs. A resampler that
    // drops short or low-curvature runs eats them, and the page reads as a
    // broken font rather than as an error. They are drawn last and large so a
    // human looking at the sheet sees the failure immediately if it returns.
    g.strokeStyle = s.accent;
    g.lineWidth = 5;
    font.text(g, 'TEH', W - M - font.width('TEH', 64), 1052, 64);
    g.strokeStyle = INK;
    g.lineWidth = 1.1;
    font.text(g, 'THREE GLYPHS, EIGHT RUNS, FOUR OF THEM STRAIGHT.', M, 1148, 12);
  },
};

/** Greedy wrap at a width in design units. */
function wrap(str, maxWidth, size) {
  const out = [];
  let line = '';
  for (const word of str.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && font.width(next, size) > maxWidth) {
      out.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) out.push(line);
  return out;
}
