// A stroke font: letters that are POLYLINES, so a letter composes with
// everything else that takes a path.
//
// WHY THIS IS NOT IN core/. It is reached by exactly one example. N4 says a
// module reached by one kind of art is a preset wearing a core module's clothes,
// so it lives next to the piece that needs it until a second one does.
//
// WHY A STROKE FONT AT ALL. `fillText` cannot become geometry, so a vector
// surface refuses it by name. A piece that wants letters on a plotter, in a
// print or in an SVG has to have coordinates. It also puts the library's worst
// documented failure back within reach on purpose: a two-point straight run --
// the crossbar of a T, the bars of an E -- is what a curvature-based resampler
// drops, and when it was dropped the page read as a broken font rather than as
// an error. Every run here is emitted, and the test counts them.
//
// Units: x in [0, 4], y in [0, 7] with the cap line at 0 and the baseline at 7.
// Monospaced, because a specimen sheet does not need a metrics table to show
// what the letters look like.

'use strict';

const ADVANCE = 5.4;

// Polylines separated by "|", points by " ", coordinates by ",".
const GLYPHS = {
  A: '0,7 2,0 4,7|0.75,4.6 3.25,4.6',
  B: '0,0 0,7|0,0 3,0 4,1 4,2.4 3,3.4 0,3.4|0,3.4 3.2,3.4 4,4.5 4,6 3,7 0,7',
  C: '4,1.5 2.8,0 1.2,0 0,1.5 0,5.5 1.2,7 2.8,7 4,5.5',
  D: '0,0 0,7|0,0 2.4,0 4,2 4,5 2.4,7 0,7',
  E: '4,0 0,0 0,7 4,7|0,3.4 3,3.4',
  F: '4,0 0,0 0,7|0,3.4 3,3.4',
  G: '4,1.5 2.8,0 1.2,0 0,1.5 0,5.5 1.2,7 2.8,7 4,5.5 4,4 2.2,4',
  H: '0,0 0,7|4,0 4,7|0,3.4 4,3.4',
  I: '2,0 2,7|0.8,0 3.2,0|0.8,7 3.2,7',
  J: '3.2,0 3.2,5.6 2.2,7 1,7 0,5.8',
  K: '0,0 0,7|4,0 0.2,4 4,7',
  L: '0,0 0,7 4,7',
  M: '0,7 0,0 2,3.2 4,0 4,7',
  N: '0,7 0,0 4,7 4,0',
  O: '1.2,0 2.8,0 4,1.5 4,5.5 2.8,7 1.2,7 0,5.5 0,1.5 1.2,0',
  P: '0,7 0,0 3,0 4,1.2 4,3 3,4.2 0,4.2',
  Q: '1.2,0 2.8,0 4,1.5 4,5.5 2.8,7 1.2,7 0,5.5 0,1.5 1.2,0|2.4,5 4.4,7.6',
  R: '0,7 0,0 3,0 4,1.2 4,3 3,4.2 0,4.2|2,4.2 4,7',
  S: '4,1.2 2.9,0 1.1,0 0,1.2 0,2.5 1.1,3.4 2.9,3.4 4,4.4 4,5.8 2.9,7 1.1,7 0,5.8',
  T: '0,0 4,0|2,0 2,7',
  U: '0,0 0,5.5 1.2,7 2.8,7 4,5.5 4,0',
  V: '0,0 2,7 4,0',
  W: '0,0 1,7 2,2.6 3,7 4,0',
  X: '0,0 4,7|4,0 0,7',
  Y: '0,0 2,3.6 4,0|2,3.6 2,7',
  Z: '0,0 4,0 0,7 4,7',
  0: '1.2,0 2.8,0 4,1.5 4,5.5 2.8,7 1.2,7 0,5.5 0,1.5 1.2,0|0.5,5.6 3.5,1.4',
  1: '0.6,1.4 2,0 2,7|0.6,7 3.4,7',
  2: '0,1.4 1.1,0 2.9,0 4,1.4 4,2.6 0,7 4,7',
  3: '0,0.7 1.1,0 2.9,0 4,1.2 4,2.4 2.9,3.4 1.6,3.4|2.9,3.4 4,4.4 4,5.8 2.9,7 1.1,7 0,6.3',
  4: '3,7 3,0 0,4.7 4.2,4.7',
  5: '4,0 0.6,0 0,3 1.1,2.4 2.9,2.4 4,3.6 4,5.8 2.9,7 1.1,7 0,6.3',
  6: '3.6,0.4 2.4,0 1.1,0 0,1.6 0,5.6 1.1,7 2.9,7 4,5.8 4,4.4 2.9,3.4 1.1,3.4 0,4.4',
  7: '0,0 4,0 1.6,7',
  8: '1.4,3.4 0.2,2.3 0.2,1 1.4,0 2.6,0 3.8,1 3.8,2.3 2.6,3.4 1.4,3.4 0,4.6 0,5.9 1.3,7 2.7,7 4,5.9 4,4.6 2.6,3.4',
  9: '0.4,6.6 1.6,7 2.9,7 4,5.4 4,1.4 2.9,0 1.1,0 0,1.2 0,2.6 1.1,3.6 2.9,3.6 4,2.6',
  '.': '1.85,6.85 2.15,7.15',
  ',': '2.2,6.85 1.5,8.3',
  '-': '0.8,3.4 3.2,3.4',
  ':': '1.85,2.35 2.15,2.65|1.85,6.85 2.15,7.15',
  ';': '1.85,2.35 2.15,2.65|2.2,6.85 1.5,8.3',
  '/': '4,0 0,7',
  "'": '2,0 2,1.6',
  '!': '2,0 2,4.8|1.85,6.85 2.15,7.15',
  '?': '0,1.2 1.1,0 2.9,0 4,1.2 4,2.4 2,3.8 2,4.8|1.85,6.85 2.15,7.15',
  '(': '3,0 1.6,2 1.6,5 3,7',
  ')': '1,0 2.4,2 2.4,5 1,7',
  '*': '2,0.6 2,3.4|0.8,1.3 3.2,2.7|3.2,1.3 0.8,2.7',
  '&': '4,7 0.9,3.9 0.9,1 1.9,0 2.9,1 2.9,2 0,5 0,6 1.1,7 2.4,7 3.6,5.9',
  ' ': '',
};

/**
 * The polylines of one character, in font units. Returns [] for a space and for
 * anything the font does not have -- an unknown character is a gap, never a
 * substituted glyph, because a specimen that quietly draws something else is
 * exactly the class of silent wrongness this project refuses.
 */
function glyph(ch) {
  const src = GLYPHS[ch] !== undefined ? GLYPHS[ch] : GLYPHS[String(ch).toUpperCase()];
  if (src === undefined || src === '') return [];
  return src.split('|').map((run) => run.split(' ').map((p) => p.split(',').map(Number)));
}

/** Total run count of a string. What must survive being drawn. */
function runCount(text) {
  let n = 0;
  for (const ch of text) n += glyph(ch).length;
  return n;
}

/** Width of a string at a given cap-height size, in design units. */
function width(text, size) {
  return text.length === 0 ? 0 : (text.length * ADVANCE - (ADVANCE - 4)) * (size / 7);
}

/**
 * Stroke `text` with its cap line at `y` and its left edge at `x`.
 * `size` is the cap height in design units.
 *
 * Every run is its own beginPath/stroke. A two-point run is a stroke like any
 * other and is never filtered by length, curvature or station count.
 */
function text(g, str, x, y, size) {
  const k = size / 7;
  let pen = x;
  for (const ch of str) {
    for (const run of glyph(ch)) {
      g.beginPath();
      g.moveTo(pen + run[0][0] * k, y + run[0][1] * k);
      for (let i = 1; i < run.length; i++) g.lineTo(pen + run[i][0] * k, y + run[i][1] * k);
      g.stroke();
    }
    pen += ADVANCE * k;
  }
  return pen - (ADVANCE - 4) * k;
}

module.exports = { glyph, runCount, width, text, GLYPHS };
