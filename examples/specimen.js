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
const font = require('../core/stroke-font.js');

// The character set in two columns: capitals, figures and marks on the left,
// lower case and the Spanish set on the right.
const ROWS = ['ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ', '0123456789&?!', ".,-:;'()*/"];
const LOWER = ['abcdefghijklm', 'nopqrstuvwxyz', 'ÁÉÍÓÚÜÑ¿¡', 'áéíóúüñ'];

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

  state: () => ({ lines: [], block: [], accent: ACCENTS[0], sample: SAMPLES[0] }),

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

    ['set the sample on the baseline grid', (s) => {
      // The grid is geometry, not decoration: every sample line's baseline sits
      // on a hairline of the 24-unit grid, each step whole rows and at least the
      // font's leading. Wrapped at three sizes; detail and contrast fall away
      // down the block, so the largest line carries the focal weight.
      const GRID = 24;
      const row = (d) => Math.ceil(d / GRID - 1e-9) * GRID;
      s.block = [];
      let base = 548;
      let prev = 0;
      for (const [size, weight] of [[40, 3.2], [22, 1.9], [13, 1.1]]) {
        for (const [i, str] of wrap(s.sample, W - 2 * M, size).entries()) {
          // A new size opens with a gap; within a size, lines step by its leading.
          if (prev) base += row(font.leading * (i ? size : prev) + (i ? 0 : 18));
          s.block.push({ str, size, weight, y: base - size });
          prev = size;
        }
      }
      // A hairline that would run through a sample's capitals is left out, so
      // the grid shows its baselines and its open rows and strikes no letter.
      s.lines = [];
      for (let y = 500; y <= 836; y += GRID) {
        if (!s.block.some((l) => y > l.y && y < l.y + l.size)) s.lines.push(y);
      }
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
    for (const [i, row] of ROWS.entries()) {
      g.strokeStyle = INK;
      g.lineWidth = 2.6;
      font.text(g, row, M, y, 34);
      font.text(g, LOWER[i], W - M - font.width(LOWER[0], 34), y, 34);
      y += 34 * font.leading + 16;
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

    g.strokeStyle = INK;
    for (const l of s.block) {
      g.lineWidth = l.weight;
      font.text(g, l.str, M, l.y, l.size);
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
    // Six facts at the font's leading plus 4 end above the caption at 1148;
    // at 24 apart the last ran into it.
    let py = 1012;
    const facts = [
      `SEED ${s.seed}`,
      `${font.runCount(ROWS.join('') + LOWER.join(''))} RUNS IN THE CHARACTER SET`,
      `${s.sample.length} CHARACTERS IN THE SAMPLE`,
      `REVERSED AT ${s.reversedContrast.toFixed(1)} TO 1, MEASURED`,
      'DECLARED: RASTER, VECTOR',
      'TIME: NONE. A STILL IS A LEGAL PIECE.',
    ];
    for (const f of facts) {
      font.text(g, f, M, py, 13);
      py += 13 * font.leading + 4;
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
