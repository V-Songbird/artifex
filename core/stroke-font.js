// A stroke font: letters that are POLYLINES, so a letter composes with
// everything else that takes a path.
//
// Shared by the specimen, attractor and cover examples and the page bundle.
//
// WHY A STROKE FONT AT ALL. `fillText` cannot become geometry, so a vector
// surface refuses it by name. A piece that wants letters on a plotter, in a
// print or in an SVG has to have coordinates. Two-point straight runs such as
// the crossbar of a T are valid strokes. Every run is emitted and tests count
// them so a resampler cannot silently remove parts of a letter.
//
// Units: x in [0, 4], y in [0, 7] with the cap line at 0 and the baseline at 7.
// Lower case stands on an x-line at 2.6, ascenders reach the cap line, and a
// descender goes no deeper than the comma's tail, so g, p, q and y lift their
// bowls to keep it. Monospaced, because a specimen sheet does not need a
// metrics table to show what the letters look like.
//
// FACES. That face is `mono`, the default; nothing below changes it. The other
// faces are Hershey fonts, proportional and in the same units (3 Hershey units
// to 1, cap line 0, baseline 7, left bearing at x 0), ASCII 32 to 126 only:
// sans from futural.jhf, serif timesr.jhf, italic timesi.jhf, bold
// timesrb.jhf, script scripts.jhf and gothic gothiceng.jhf.
// The data is the .jhf files of https://github.com/kamalmostafa/hershey-fonts
// (from http://emergent.unpythonic.net/software/hershey), each glyph's record
// kept as written there, not in the NTIS format. Their use restriction:
//
//   This distribution of the Hershey Fonts may be used by anyone for
//   any purpose, commercial or otherwise, providing that:
//     1. The following acknowledgements must be distributed with
//        the font data:
//        - The Hershey Fonts were originally created by Dr.
//          A. V. Hershey while working at the U. S.
//          National Bureau of Standards.
//        - The format of the Font data in this distribution
//          was originally created by
//            James Hurt
//            Cognition, Inc.
//            900 Technology Park Drive
//            Billerica, MA 01821
//            (mit-eddie!ci-dandelion!hurt)
//     2. The font data in this distribution may be converted into
//        any other format *EXCEPT* the format distributed by
//        the U.S. NTIS (which organization holds the rights
//        to the distribution and use of the font data in that
//        particular format). Not that anybody would really
//        *want* to use their format... each point is described
//        in eight bytes as "xxx yyy:", where xxx and yyy are
//        the coordinate values as ASCII numbers.

'use strict';

const { noise2 } = require('./rand.js');

const ADVANCE = 5.4;
const FACES = ['mono', 'sans', 'serif', 'italic', 'bold', 'script', 'gothic'];

// Kerning pairs, in cap heights; `kern: true` applies them in every face, as
// far as kerning() allows. Each closes a pair whose shapes leave a hole between
// them: diagonals, an arm over a lower letter, a stop under an overhang.
const KERN = {};
for (const [pairs, by] of [
  ['AV AY VA YA LT LV LY T. T, Y. Y,', -0.14],
  ['AT TA P. P, V. V, L\'', -0.12],
  ['AW WA PA Ta Tc Te To Tr Ts Tu Tw Ty Ya Ye Yo Yu W. W, F. F,', -0.1],
  ['FA Va Ve Vo Av Aw Ay', -0.07],
  ['Wa We Wo Fa Fe Fo Pa Pe Po r. r,', -0.05],
  ['y. y, v. v, w. w,', -0.03],
]) for (const pair of pairs.split(' ')) KERN[pair] = by;

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
  a: '4,2.6 4,7|4,3.7 2.9,2.6 1.1,2.6 0,3.7 0,5.9 1.1,7 2.9,7 4,5.9',
  b: '0,0 0,7|0,3.7 1.1,2.6 2.9,2.6 4,3.7 4,5.9 2.9,7 1.1,7 0,5.9',
  c: '4,3.7 2.9,2.6 1.1,2.6 0,3.7 0,5.9 1.1,7 2.9,7 4,5.9',
  d: '4,0 4,7|4,3.7 2.9,2.6 1.1,2.6 0,3.7 0,5.9 1.1,7 2.9,7 4,5.9',
  e: '0,4.7 4,4.7 4,3.7 2.9,2.6 1.1,2.6 0,3.7 0,5.9 1.1,7 2.9,7 4,6',
  f: '3.6,0.6 3,0 2.2,0 1.4,0.8 1.4,7|0.2,2.6 3.2,2.6',
  g: '4,3.6 2.9,2.6 1.1,2.6 0,3.6 0,4.8 1.1,5.8 2.9,5.8 4,4.8|4,2.6 4,6.8 3,7.8 1,7.8 0.2,7.2',
  h: '0,0 0,7|0,3.7 1.1,2.6 2.9,2.6 4,3.7 4,7',
  i: '1.2,2.6 2,2.6 2,6.2 2.8,7 3.6,7|1.85,0.95 2.15,1.25',
  j: '1.6,2.6 2.6,2.6 2.6,7 1.8,7.8 0.6,7.8|2.45,0.95 2.75,1.25',
  k: '0,0 0,7|3.6,2.6 0.2,5 3.8,7',
  l: '1.2,0 2,0 2,6.2 2.8,7 3.6,7',
  m: '0,2.6 0,7|0,3.4 0.6,2.6 1.4,2.6 2,3.4 2,7|2,3.4 2.6,2.6 3.4,2.6 4,3.4 4,7',
  n: '0,2.6 0,7|0,3.7 1.1,2.6 2.9,2.6 4,3.7 4,7',
  o: '1.1,2.6 2.9,2.6 4,3.7 4,5.9 2.9,7 1.1,7 0,5.9 0,3.7 1.1,2.6',
  p: '0,2.6 0,7.8|0,3.6 1.1,2.6 2.9,2.6 4,3.6 4,4.8 2.9,5.8 1.1,5.8 0,4.8',
  q: '4,2.6 4,7.8|4,3.6 2.9,2.6 1.1,2.6 0,3.6 0,4.8 1.1,5.8 2.9,5.8 4,4.8',
  r: '1,2.6 1,7|1,3.9 2.2,2.6 3.4,2.6 4,3.2',
  s: '4,3.4 2.9,2.6 1.1,2.6 0,3.4 0,4.2 1.1,4.8 2.9,4.8 4,5.4 4,6.2 2.9,7 1.1,7 0,6.2',
  t: '1.6,0.8 1.6,6.2 2.4,7 3.6,7|0.2,2.6 3.4,2.6',
  u: '0,2.6 0,5.9 1.1,7 2.9,7 4,5.9|4,2.6 4,7',
  v: '0,2.6 2,7 4,2.6',
  w: '0,2.6 1,7 2,4 3,7 4,2.6',
  x: '0,2.6 4,7|4,2.6 0,7',
  y: '0,2.6 2,6.1|4,2.6 1,7.8',
  z: '0,2.6 4,2.6 0,7 4,7',
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
  ',': '2.2,6.5 2.2,7.1 1.6,7.8',
  '-': '0.8,3.4 3.2,3.4',
  ':': '1.85,2.35 2.15,2.65|1.85,6.85 2.15,7.15',
  ';': '1.85,2.35 2.15,2.65|2.2,6.5 2.2,7.1 1.6,7.8',
  '/': '4,0 0,7',
  "'": '2,0 2,1.6',
  '!': '2,0 2,4.8|1.85,6.85 2.15,7.15',
  '?': '0,1.2 1.1,0 2.9,0 4,1.2 4,2.4 2,3.8 2,4.8|1.85,6.85 2.15,7.15',
  // Turned ! and ?, hanging to the comma's depth as Spanish sets them.
  '¡': '2,7.8 2,3|1.85,0.65 2.15,0.95',
  '¿': '4,6.6 2.9,7.8 1.1,7.8 0,6.6 0,5.4 2,4 2,3|1.85,0.65 2.15,0.95',
  '(': '3,0 1.6,2 1.6,5 3,7',
  ')': '1,0 2.4,2 2.4,5 1,7',
  '*': '2,0.6 2,3.4|0.8,1.3 3.2,2.7|3.2,1.3 0.8,2.7',
  '&': '4,7 0.9,3.9 0.9,1 1.9,0 2.9,1 2.9,2 0,5 0,6 1.1,7 2.4,7 3.6,5.9',
  ' ': '',
};

// Metrics, in cap heights and measured from the outlines above so a new glyph
// there moves them; the accented letters added below are not counted, and an
// accent over a capital rises above `ascent` into `leading`.
// `ascent` is the highest station above the baseline among those outlines,
// `descent` the deepest below it (the comma's tail, which the descenders
// share). `leading`, baseline to baseline, leaves a
// clear gap twice the descent under the deepest mark, so a mark hanging below
// one line stays plainly with its own letters: tighter, and a comma reads as an
// accent on the letter under it. The comma hangs from the baseline by a short
// upright head for the same reason; a lone slash in the gap is an acute.
// These are the default face's; `metrics(face)` gives any face's.
const ys = Object.keys(GLYPHS).flatMap((c) => glyph(c).flatMap((run) => run.map((p) => p[1])));
const ascent = (7 - Math.min(...ys)) / 7;
const descent = (Math.max(...ys) - 7) / 7;
const leading = ascent + 3 * descent;

// Accented letters, each its base letter plus a mark. Over lower case the mark
// sits high between the x-line and the cap line, at least 1 unit clear of its
// letter. Over a capital it starts 0.65 units clear of its letter, so a pen
// thicker than that (0.09 cap height) joins the two, and rises into the leading
// by at most 1.4 units (0.2 cap height), so an acute slants about 34 degrees
// and reads as an acute, not a macron. That keeps it under the deepest mark on
// the line above, but only 0.2 units under the flat feet of g and ¿: set directly
// over an accented capital, either touches its acute at any pen over 0.03 cap
// height, ¡ over 0.072 and j over 0.088. The comma and the other descenders
// stay clear at every pen up to 0.09. It is not counted in the metrics, so
// setting accented capitals re-spaces no stacked text.
const MARKS = {
  '́': ['1.5,1.5 2.7,0.1', '1.5,-0.65 2.6,-1.4'], // acute
  '̈': ['0.85,1.05 1.15,1.35|2.85,1.05 3.15,1.35', '0.85,-0.7 1.15,-0.4|2.85,-0.7 3.15,-0.4'], // diaeresis
  '̃': ['0.5,1.5 1.4,0.6 2.6,1.4 3.5,0.5','0.6,-0.35 1.4,-0.8 2.6,-0.35 3.4,-0.8'], // tilde
};
for (const ch of 'áéíóúüñÁÉÍÓÚÜÑ') {
  const [base, mark] = ch.normalize('NFD');
  const body = base === 'i' ? GLYPHS.i.split('|')[0] : GLYPHS[base];
  GLYPHS[ch] = body + '|' + MARKS[mark][base === base.toUpperCase() ? 1 : 0];
}

/**
 * The polylines of one character, in font units. Returns [] for a space and for
 * anything the font does not have -- an unknown character is a gap, never a
 * substituted glyph, because a specimen that quietly draws something else is
 * exactly the class of silent wrongness this project refuses.
 * `opts.face` picks a face; a Hershey face has ASCII only, so `é` is a gap there.
 */
function glyph(ch, opts) {
  const face = faceOf(opts);
  if (face !== 'mono') {
    const h = hershey(face, ch);
    return h === undefined ? [] : h.runs.map((run) => run.map((p) => [p[0], p[1]]));
  }
  const src = GLYPHS[ch];
  if (src === undefined || src === '') return [];
  return src.split('|').map((run) => run.split(' ').map((p) => p.split(',').map(Number)));
}

function faceOf(opts) {
  if (opts === undefined || opts.face === undefined) return 'mono';
  if (!FACES.includes(opts.face)) throw new Error(`stroke font: no face '${opts.face}'; the faces are ${FACES.join(', ')}`);
  return opts.face;
}

// One character of a Hershey face, decoded once per face: its runs in font
// units and its advance, the record's right bearing less its left. A record is
// the two bearings, then x,y pairs as letters counted from 'R', " R" lifting
// the pen.
const decoded = {};
function hershey(face, ch) {
  if (decoded[face] === undefined) {
    decoded[face] = new Map(HERSHEY[face].split('\t').map((rec, i) => {
      const left = rec.charCodeAt(0) - 82;
      const runs = rec.slice(2).split(' R').filter((s) => s.length >= 4).map((s) => {
        const run = [];
        for (let j = 0; j < s.length; j += 2) run.push([(s.charCodeAt(j) - 82 - left) / 3, (s.charCodeAt(j + 1) - 82 + 12) / 3]);
        return run;
      });
      return [String.fromCharCode(32 + i), { runs, advance: (rec.charCodeAt(1) - 82 - left) / 3 }];
    }));
  }
  return decoded[face].get(ch);
}

/**
 * The characters of `str` the font has no glyph for, each named once, in the
 * order they first appear; [] when every character draws. `text()` leaves a
 * gap for each of them, so a piece checks the strings it sets and refuses one
 * that would lose a character. A space is a glyph. `opts.face` as for glyph().
 */
function missing(str, opts) {
  return [...new Set(str)].filter((ch) => ch !== ' ' && glyph(ch, opts).length === 0);
}

/** Total run count of a string. What must survive being drawn. */
function runCount(text, opts) {
  let n = 0;
  for (const ch of text) n += glyph(ch, opts).length;
  return n;
}

/**
 * A face's `ascent`, `descent` and `leading` in cap heights; the default face's
 * are the exported ones. A Hershey face is measured over all its glyphs, as
 * the default face is, and its brackets rise and hang furthest (script's
 * swashes hang deeper still). Its `leading` leaves the default face's clear
 * gap, `2 * descent` of mono (0.23 cap heights), between the deepest mark of
 * one line and the highest of the next. Measured on stroke centrelines: lines
 * drawn with a wide pen, or with display()'s outline and shadow, need that
 * pen's width and the shadow's drop added.
 */
const measured = { mono: Object.freeze({ ascent, descent, leading }) };
function metrics(face = 'mono') {
  faceOf({ face });
  if (measured[face] === undefined) {
    const at = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).flatMap((c) => glyph(c, { face }).flat().map((p) => p[1]));
    const up = (7 - Math.min(...at)) / 7, down = (Math.max(...at) - 7) / 7;
    measured[face] = Object.freeze({ ascent: up, descent: down, leading: up + down + 2 * descent });
  }
  return measured[face];
}

// The default face, unkerned and steady, takes the original code paths below,
// so text set before faces existed draws and measures to the same bit, except
// that an empty line now ends at x, where width('') puts it.
const plain = (opts) => opts === undefined || (faceOf(opts) === 'mono' && !opts.kern && !opts.wobble);

// Where each character of `str` starts, from 0 in design units, and where the
// line ends: the last ink box's right edge in mono, the last advance in a
// Hershey face, whose bearings are part of its spacing. A character a face
// lacks takes the space's advance.
function layout(str, size, opts) {
  const face = faceOf(opts);
  const k = size / 7;
  const at = [];
  let pen = 0;
  let prev = '';
  for (const ch of str) {
    if (opts.kern && KERN[prev + ch] !== undefined) pen += kerning(face, prev + ch) * k;
    at.push([ch, pen]);
    pen += advance(face, ch) * k;
    prev = ch;
  }
  return { at, end: at.length === 0 ? 0 : pen - (face === 'mono' ? ADVANCE - 4 : 0) * k };
}

function advance(face, ch) {
  return face === 'mono' ? ADVANCE : (hershey(face, ch) ?? hershey(face, ' ')).advance;
}

// The nearest ink of two letters set side by side, in font units.
function gap(face, a, b) {
  const A = glyph(a, { face });
  const B = glyph(b, { face }).map((run) => run.map((p) => [p[0] + advance(face, a), p[1]]));
  const near = (P, Q) => Math.min(...P.flat().flatMap((p) => Q.flatMap((run) => run.slice(1).map((q, i) => {
    const [ax, ay] = run[i];
    const dx = q[0] - ax, dy = q[1] - ay;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy);
  }))));
  return Math.min(near(A, B), near(B, A));
}

// A pair's kerning in font units, measured once per face: the table's amount,
// but never closing the pair nearer than half the gap between two H's, so a
// face with swashes or wide serifs keeps its letters apart.
const kerned = {};
function kerning(face, pair) {
  const memo = (kerned[face] ??= new Map());
  if (!memo.has(pair)) {
    const [a, b] = [...pair];
    memo.set(pair, Math.min(0, Math.max(KERN[pair] * 7, gap(face, 'H', 'H') / 2 - gap(face, a, b))));
  }
  return memo.get(pair);
}

/**
 * Width of a string at a given cap-height size, in design units: exactly the
 * distance `text()` with the same `opts` returns, so a line can be measured,
 * centred or fitted before it is drawn. Wobble moves ink, never the pen.
 */
function width(text, size, opts) {
  if (!plain(opts)) return layout(text, size, opts).end;
  const n = [...text].length; // per code point, as text() advances
  return n === 0 ? 0 : (n * ADVANCE - (ADVANCE - 4)) * (size / 7);
}

// Put a point every 0.7 units along a run, so the wobble bends a long stroke
// instead of moving only its ends.
function subdivide(run) {
  const out = [run[0]];
  for (let i = 1; i < run.length; i++) {
    const [ax, ay] = run[i - 1];
    const [bx, by] = run[i];
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 0.7);
    for (let j = 1; j <= n; j++) out.push([ax + ((bx - ax) * j) / n, ay + ((by - ay) * j) / n]);
  }
  return out;
}

// Hand-lettered wobble on letter `i`, whose pen starts `u` font units into the
// word: the letter leans and rises a little about its middle, and every
// stroke drifts along a smooth field, so stems bow as a hand's do. Addressed by
// the word (or `name`) and the letter, never by position, so a shadow or an
// outline drawn at an offset wobbles with its fill.
function shake(runs, i, u, opts, word) {
  const { wobble, R } = opts;
  if (typeof R !== 'function') throw new Error("stroke font: wobble needs R, the piece's random source");
  const key = 'stroke-font ' + (opts.name ?? word);
  const lean = (R(key, 'lean', i) - 0.5) * 3 * wobble;
  const rise = (R(key, 'rise', i) - 0.5) * 7 * wobble;
  const drift = 2 * 7 * wobble;
  const xs = runs.flat().map((p) => p[0]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const c = Math.cos(lean), s = Math.sin(lean);
  return runs.map((run) => subdivide(run).map(([px, py]) => {
    const dx = (noise2(R, (u + px) / 3.5, py / 3.5, key + ' x') - 0.5) * drift;
    const dy = (noise2(R, (u + px) / 3.5, py / 3.5, key + ' y') - 0.5) * drift;
    const ox = px - cx, oy = py - 3.5;
    return [cx + ox * c - oy * s + dx, 3.5 + ox * s + oy * c + rise + dy];
  }));
}

/**
 * Stroke `text` with its cap line at `y` and its left edge at `x`.
 * `size` is the cap height in design units.
 *
 * Every run is its own beginPath/stroke. A two-point run is a stroke like any
 * other and is never filtered by length, curvature or station count.
 *
 * `opts`, all optional: `face` (one of `faces`, default 'mono'), `kern: true`
 * for the kerning pairs, and `wobble`, the largest drift of a stroke in cap
 * heights (0.02 a steady hand, 0.07 a quick one), which needs `R`, the
 * piece's random source, and takes `name` to letter one word twice unalike.
 */
function text(g, str, x, y, size, opts) {
  const k = size / 7;
  if (!plain(opts)) {
    const { at, end } = layout(str, size, opts);
    at.forEach(([ch, dx], i) => {
      const runs = opts.wobble ? shake(glyph(ch, opts), i, dx / k, opts, str) : glyph(ch, opts);
      for (const run of runs) {
        g.beginPath();
        g.moveTo(x + dx + run[0][0] * k, y + run[0][1] * k);
        for (let j = 1; j < run.length; j++) g.lineTo(x + dx + run[j][0] * k, y + run[j][1] * k);
        g.stroke();
      }
    });
    return x + end;
  }
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
  return str === '' ? x : pen - (ADVANCE - 4) * k;
}

/**
 * A filled word for a title, a sign or a sound word: `text()` stroked
 * `weight` cap heights wide in `fill` (default the current strokeStyle), over
 * an `outline` colour `line` cap heights wider on each side, over a `shadow`
 * ({ x, y, colour }: an offset in cap heights, default 0.06 each, and the
 * outline's colour) as wide as the outline. Each layer is drawn across the
 * whole word before the next, so one letter's outline never cuts into its
 * neighbour's fill. Strokes only, round-capped, so the vector surface takes
 * it. Takes text()'s `opts` and returns what text() returns.
 */
function display(g, str, x, y, size, opts = {}) {
  const { fill = g.strokeStyle, outline = null, weight = 0.16, line = 0.05, shadow = null } = opts;
  const pass = (colour, w, dx, dy) => {
    g.strokeStyle = colour;
    g.lineWidth = w * size;
    return text(g, str, x + dx * size, y + dy * size, size, opts);
  };
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  if (shadow) pass(shadow.colour ?? outline ?? fill, weight + 2 * line, shadow.x ?? 0.06, shadow.y ?? 0.06);
  if (outline) pass(outline, weight + 2 * line, 0, 0);
  const end = pass(fill, weight, 0, 0);
  g.restore();
  return end;
}

module.exports = { glyph, missing, runCount, width, text, display, metrics, GLYPHS, ascent, descent, leading, faces: FACES, KERN };

// The Hershey faces named in the header: per face, the 95 .jhf records of
// ASCII 32 to 126 in order, each without its glyph number and vertex count,
// joined by tabs.
const HERSHEY = {
  sans: // futural.jhf
    "JZ\tMWRFRT RRYQZR[SZRY\tJZNFNM RVFVM\tH]SBLb RYBRb RLOZO RKUYU\tH\\PBP_ RTBT_ RYIWGTFPFMGKIK"
    + "KLMMNOOUQWRXSYUYXWZT[P[MZKX\tF^[FI[ RNFPHPJOLMMKMIKIIJGLFNFPGSHVHYG[F RWTUUTWTYV[X[ZZ[X[VYTW"
    + "T\tE_\\O\\N[MZMYNXPVUTXRZP[L[JZIYHWHUISJRQNRMSKSIRGPFNGMIMKNNPQUXWZY[[[\\Z\\Y\tMWRHQGRFSGSIR"
    + "KQL\tKYVBTDRGPKOPOTPYR]T`Vb\tKYNBPDRGTKUPUTTYR]P`Nb\tJZRLRX RMOWU RWOMU\tE_RIR[ RIR[R\tNVSWR"
    + "XQWRVSWSYQ[\tE_IR[R\tNVRVQWRXSWRV\tG][BIb\tH\\QFNGLJKOKRLWNZQ[S[VZXWYRYOXJVGSFQF\tH\\NJPISFS"
    + "[\tH\\LKLJMHNGPFTFVGWHXJXLWNUQK[Y[\tH\\MFXFRNUNWOXPYSYUXXVZS[P[MZLYKW\tH\\UFKTZT RUFU[\tH\\W"
    + "FMFLOMNPMSMVNXPYSYUXXVZS[P[MZLYKW\tH\\XIWGTFRFOGMJLOLTMXOZR[S[VZXXYUYTXQVOSNRNOOMQLT\tH\\YFO"
    + "[ RKFYF\tH\\PFMGLILKMMONSOVPXRYTYWXYWZT[P[MZLYKWKTLRNPQOUNWMXKXIWGTFPF\tH\\XMWPURRSQSNRLPKMK"
    + "LLINGQFRFUGWIXMXRWWUZR[P[MZLX\tNVROQPRQSPRO RRVQWRXSWRV\tNVROQPRQSPRO RSWRXQWRVSWSYQ[\tF^ZIJ"
    + "RZ[\tE_IO[O RIU[U\tF^JIZRJ[\tI[LKLJMHNGPFTFVGWHXJXLWNVORQRT RRYQZR[SZRY\tE`WNVLTKQKOLNMMPMSN"
    + "UPVSVUUVS RQKOMNPNSOUPV RWKVSVUXVZV\\T]Q]O\\L[JYHWGTFQFNGLHJJILHOHRIUJWLYNZQ[T[WZYYZX RXKWSW"
    + "UXV\tI[RFJ[ RRFZ[ RMTWT\tG\\KFK[ RKFTFWGXHYJYLXNWOTP RKPTPWQXRYTYWXYWZT[K[\tH]ZKYIWGUFQFOGMI"
    + "LKKNKSLVMXOZQ[U[WZYXZV\tG\\KFK[ RKFRFUGWIXKYNYSXVWXUZR[K[\tH[LFL[ RLFYF RLPTP RL[Y[\tHZLFL[ "
    + "RLFYF RLPTP\tH]ZKYIWGUFQFOGMILKKNKSLVMXOZQ[U[WZYXZVZS RUSZS\tG]KFK[ RYFY[ RKPYP\tNVRFR[\tJZV"
    + "FVVUYTZR[P[NZMYLVLT\tG\\KFK[ RYFKT RPOY[\tHYLFL[ RL[X[\tF^JFJ[ RJFR[ RZFR[ RZFZ[\tG]KFK[ RKF"
    + "Y[ RYFY[\tG]PFNGLIKKJNJSKVLXNZP[T[VZXXYVZSZNYKXIVGTFPF\tG\\KFK[ RKFTFWGXHYJYMXOWPTQKQ\tG]PFN"
    + "GLIKKJNJSKVLXNZP[T[VZXXYVZSZNYKXIVGTFPF RSWY]\tG\\KFK[ RKFTFWGXHYJYLXNWOTPKP RRPY[\tH\\YIWGT"
    + "FPFMGKIKKLMMNOOUQWRXSYUYXWZT[P[MZKX\tJZRFR[ RKFYF\tG]KFKULXNZQ[S[VZXXYUYF\tI[JFR[ RZFR[\tF^H"
    + "FM[ RRFM[ RRFW[ R\\FW[\tH\\KFY[ RYFK[\tI[JFRPR[ RZFRP\tH\\YFK[ RKFYF RK[Y[\tKYOBOb RPBPb ROB"
    + "VB RObVb\tKYKFY^\tKYTBTb RUBUb RNBUB RNbUb\tJZRDJR RRDZR\tI[Ib[b\tNVSKQMQORPSORNQO\tI\\XMX[ "
    + "RXPVNTMQMONMPLSLUMXOZQ[T[VZXX\tH[LFL[ RLPNNPMSMUNWPXSXUWXUZS[P[NZLX\tI[XPVNTMQMONMPLSLUMXOZQ"
    + "[T[VZXX\tI\\XFX[ RXPVNTMQMONMPLSLUMXOZQ[T[VZXX\tI[LSXSXQWOVNTMQMONMPLSLUMXOZQ[T[VZXX\tMYWFUF"
    + "SGRJR[ ROMVM\tI\\XMX]W`VaTbQbOa RXPVNTMQMONMPLSLUMXOZQ[T[VZXX\tI\\MFM[ RMQPNRMUMWNXQX[\tNVQF"
    + "RGSFREQF RRMR[\tMWRFSGTFSERF RSMS^RaPbNb\tIZMFM[ RWMMW RQSX[\tNVRFR[\tCaGMG[ RGQJNLMOMQNRQR["
    + " RRQUNWMZM\\N]Q][\tI\\MMM[ RMQPNRMUMWNXQX[\tI\\QMONMPLSLUMXOZQ[T[VZXXYUYSXPVNTMQM\tH[LMLb RL"
    + "PNNPMSMUNWPXSXUWXUZS[P[NZLX\tI\\XMXb RXPVNTMQMONMPLSLUMXOZQ[T[VZXX\tKXOMO[ ROSPPRNTMWM\tJ[XP"
    + "WNTMQMNNMPNRPSUTWUXWXXWZT[Q[NZMX\tMYRFRWSZU[W[ ROMVM\tI\\MMMWNZP[S[UZXW RXMX[\tJZLMR[ RXMR["
    + "\tG]JMN[ RRMN[ RRMV[ RZMV[\tJ[MMX[ RXMM[\tJZLMR[ RXMR[P_NaLbKb\tJ[XMM[ RMMXM RM[X[\tKYTBRCQD"
    + "PFPHQJRKSMSOQQ RRCQEQGRISJTLTNSPORSTTVTXSZR[Q]Q_Ra RQSSUSWRYQZP\\P^Q`RaTb\tNVRBRb\tKYPBRCSDT"
    + "FTHSJRKQMQOSQ RRCSESGRIQJPLPNQPURQTPVPXQZR[S]S_Ra RSSQUQWRYSZT\\T^S`RaPb\tF^IUISJPLONOPPTSVT"
    + "XTZS[Q RISJQLPNPPQTTVUXUZT[Q[O",
  serif: // timesr.jhf
    "JZ\tMWRFQHRTSHRF RRHRN RRYQZR[SZRY\tI[NFMGMM RNGMM RNFOGMM RWFVGVM RWGVM RWFXGVM\tH]SBLb RYB"
    + "Rb RLOZO RKUYU\tH\\PBP_ RTBT_ RXIWJXKYJYIWGTFPFMGKIKKLMMNOOUQWRYT RKKMMONUPWQXRYTYXWZT[P[MZK"
    + "XKWLVMWLX\tF^[FI[ RNFPHPJOLMMKMIKIIJGLFNFPGSHVHYG[F RWTUUTWTYV[X[ZZ[X[VYTWT\tF_[NZO[P\\O\\N["
    + "MZMYNXPVUTXRZP[M[JZIXIUJSPORMSKSIRGPFNGMIMKNNPQUXWZZ[[[\\Z\\Y RM[KZJXJUKSMQ RMKNMVXXZZ[\tNVR"
    + "FQM RSFQM\tKYVBTDRGPKOPOTPYR]T`Vb RTDRHQKPPPTQYR\\T`\tKYNBPDRGTKUPUTTYR]P`Nb RPDRHSKTPTTSYR"
    + "\\P`\tJZRLRX RMOWU RWOMU\tE_RIR[ RIR[R\tNVSWRXQWRVSWSYQ[\tE_IR[R\tNVRVQWRXSWRV\tG][BIb\tH\\Q"
    + "FNGLJKOKRLWNZQ[S[VZXWYRYOXJVGSFQF RQFOGNHMJLOLRMWNYOZQ[ RS[UZVYWWXRXOWJVHUGSF\tH\\NJPISFS[ R"
    + "RGR[ RN[W[\tH\\LJMKLLKKKJLHMGPFTFWGXHYJYLXNUPPRNSLUKXK[ RTFVGWHXJXLWNTPPR RKYLXNXSZVZXYYX RN"
    + "XS[W[XZYXYV\tH\\LJMKLLKKKJLHMGPFTFWGXIXLWNTOQO RTFVGWIWLVNTO RTOVPXRYTYWXYWZT[P[MZLYKWKVLUMV"
    + "LW RWQXTXWWYVZT[\tH\\THT[ RUFU[ RUFJUZU RQ[X[\tH\\MFKP RKPMNPMSMVNXPYSYUXXVZS[P[MZLYKWKVLUMV"
    + "LW RSMUNWPXSXUWXUZS[ RMFWF RMGRGWF\tH\\WIVJWKXJXIWGUFRFOGMILKKOKULXNZQ[S[VZXXYUYTXQVOSNRNOOM"
    + "QLT RRFPGNIMKLOLUMXOZQ[ RS[UZWXXUXTWQUOSN\tH\\KFKL RKJLHNFPFUIWIXHYF RLHNGPGUI RYFYIXLTQSSRV"
    + "R[ RXLSQRSQVQ[\tH\\PFMGLILLMNPOTOWNXLXIWGTFPF RPFNGMIMLNNPO RTOVNWLWIVGTF RPOMPLQKSKWLYMZP[T"
    + "[WZXYYWYSXQWPTO RPONPMQLSLWMYNZP[ RT[VZWYXWXSWQVPTO\tH\\XMWPURRSQSNRLPKMKLLINGQFSFVGXIYLYRXV"
    + "WXUZR[O[MZLXLWMVNWMX RQSORMPLMLLMIOGQF RSFUGWIXLXRWVVXTZR[\tNVROQPRQSPRO RRVQWRXSWRV\tNVROQP"
    + "RQSPRO RSWRXQWRVSWSYQ[\tF^ZIJRZ[\tE_IO[O RIU[U\tF^JIZRJ[\tI[MJNKMLLKLJMHNGPFSFVGWHXJXLWNVORQ"
    + "RT RSFUGVHWJWLVNTP RRYQZR[SZRY\tE`WNVLTKQKOLNMMPMSNUPVSVUUVS RQKOMNPNSOUPV RWKVSVUXVZV\\T]Q]"
    + "O\\L[JYHWGTFQFNGLHJJILHOHRIUJWLYNZQ[T[WZYYZX RXKWSWUXV\tH\\RFK[ RRFY[ RRIX[ RMUVU RI[O[ RU[["
    + "[\tG]LFL[ RMFM[ RIFUFXGYHZJZLYNXOUP RUFWGXHYJYLXNWOUP RMPUPXQYRZTZWYYXZU[I[ RUPWQXRYTYWXYWZU"
    + "[\tG\\XIYLYFXIVGSFQFNGLIKKJNJSKVLXNZQ[S[VZXXYV RQFOGMILKKNKSLVMXOZQ[\tG]LFL[ RMFM[ RIFSFVGXI"
    + "YKZNZSYVXXVZS[I[ RSFUGWIXKYNYSXVWXUZS[\tG\\LFL[ RMFM[ RSLST RIFYFYLXF RMPSP RI[Y[YUX[\tG[LFL"
    + "[ RMFM[ RSLST RIFYFYLXF RMPSP RI[P[\tG^XIYLYFXIVGSFQFNGLIKKJNJSKVLXNZQ[S[VZXX RQFOGMILKKNKSL"
    + "VMXOZQ[ RXSX[ RYSY[ RUS\\S\tF^KFK[ RLFL[ RXFX[ RYFY[ RHFOF RUF\\F RLPXP RH[O[ RU[\\[\tMXRFR["
    + " RSFS[ ROFVF RO[V[\tKZUFUWTZR[P[NZMXMVNUOVNW RTFTWSZR[ RQFXF\tF\\KFK[ RLFL[ RYFLS RQOY[ RPOX"
    + "[ RHFOF RUF[F RH[O[ RU[[[\tI[NFN[ ROFO[ RKFRF RK[Z[ZUY[\tF_KFK[ RLFRX RKFR[ RYFR[ RYFY[ RZFZ"
    + "[ RHFLF RYF]F RH[N[ RV[][\tG^LFL[ RMFYY RMHY[ RYFY[ RIFMF RVF\\F RI[O[\tG]QFNGLIKKJOJRKVLXNZ"
    + "Q[S[VZXXYVZRZOYKXIVGSFQF RQFOGMILKKOKRLVMXOZQ[ RS[UZWXXVYRYOXKWIUGSF\tG]LFL[ RMFM[ RIFUFXGYH"
    + "ZJZMYOXPUQMQ RUFWGXHYJYMXOWPUQ RI[P[\tG]QFNGLIKKJOJRKVLXNZQ[S[VZXXYVZRZOYKXIVGSFQF RQFOGMILK"
    + "KOKRLVMXOZQ[ RS[UZWXXVYRYOXKWIUGSF RNYNXOVQURUTVUXV_W`Y`Z^Z] RUXV\\W^X_Y_Z^\tG]LFL[ RMFM[ RI"
    + "FUFXGYHZJZLYNXOUPMP RUFWGXHYJYLXNWOUP RI[P[ RRPTQURXYYZZZ[Y RTQUSWZX[Z[[Y[X\tH\\XIYFYLXIVGSF"
    + "PFMGKIKKLMMNOOUQWRYT RKKMMONUPWQXRYTYXWZT[Q[NZLXKUK[LX\tI\\RFR[ RSFS[ RLFKLKFZFZLYF RO[V[\tF"
    + "^KFKULXNZQ[S[VZXXYUYF RLFLUMXOZQ[ RHFOF RVF\\F\tH\\KFR[ RLFRX RYFR[ RIFOF RUF[F\tF^JFN[ RKFN"
    + "V RRFN[ RRFV[ RSFVV RZFV[ RGFNF RWF]F\tH\\KFX[ RLFY[ RYFK[ RIFOF RUF[F RI[O[ RU[[[\tH]KFRQR["
    + " RLFSQS[ RZFSQ RIFOF RVF\\F RO[V[\tH\\XFK[ RYFL[ RLFKLKFYF RK[Y[YUX[\tKYOBOb RPBPb ROBVB ROb"
    + "Vb\tKYKFY^\tKYTBTb RUBUb RNBUB RNbUb\tG]JTROZT RJTRPZT\tH\\Hb\\b\tLXPFUL RPFOGUL\tI]NONPMPMO"
    + "NNPMTMVNWOXQXXYZZ[ RWOWXXZZ[[[ RWQVRPSMTLVLXMZP[S[UZWX RPSNTMVMXNZP[\tG\\LFL[ RMFM[ RMPONQMS"
    + "MVNXPYSYUXXVZS[Q[OZMX RSMUNWPXSXUWXUZS[ RIFMF\tH[WPVQWRXQXPVNTMQMNNLPKSKULXNZQ[S[VZXX RQMONM"
    + "PLSLUMXOZQ[\tH]WFW[ RXFX[ RWPUNSMQMNNLPKSKULXNZQ[S[UZWX RQMONMPLSLUMXOZQ[ RTFXF RW[[[\tH[LSX"
    + "SXQWOVNTMQMNNLPKSKULXNZQ[S[VZXX RWSWPVN RQMONMPLSLUMXOZQ[\tKXUGTHUIVHVGUFSFQGPIP[ RSFRGQIQ[ "
    + "RMMUM RM[T[\tI\\QMONNOMQMSNUOVQWSWUVVUWSWQVOUNSMQM RONNPNTOV RUVVTVPUN RVOWNYMYNWN RNUMVLXLY"
    + "M[P\\U\\X]Y^ RLYMZP[U[X\\Y^Y_XaUbObLaK_K^L\\O[\tG]LFL[ RMFM[ RMPONRMTMWNXPX[ RTMVNWPW[ RIFMF"
    + " RI[P[ RT[[[\tMXRFQGRHSGRF RRMR[ RSMS[ ROMSM RO[V[\tMXSFRGSHTGSF RTMT_SaQbObNaN`O_P`Oa RSMS_"
    + "RaQb RPMTM\tG\\LFL[ RMFM[ RWMMW RRSX[ RQSW[ RIFMF RTMZM RI[P[ RT[Z[\tMXRFR[ RSFS[ ROFSF RO[V"
    + "[\tBcGMG[ RHMH[ RHPJNMMOMRNSPS[ ROMQNRPR[ RSPUNXMZM]N^P^[ RZM\\N]P][ RDMHM RD[K[ RO[V[ RZ[a["
    + "\tG]LML[ RMMM[ RMPONRMTMWNXPX[ RTMVNWPW[ RIMMM RI[P[ RT[[[\tH\\QMNNLPKSKULXNZQ[S[VZXXYUYSXPV"
    + "NSMQM RQMONMPLSLUMXOZQ[ RS[UZWXXUXSWPUNSM\tG\\LMLb RMMMb RMPONQMSMVNXPYSYUXXVZS[Q[OZMX RSMUN"
    + "WPXSXUWXUZS[ RIMMM RIbPb\tH\\WMWb RXMXb RWPUNSMQMNNLPKSKULXNZQ[S[UZWX RQMONMPLSLUMXOZQ[ RTb["
    + "b\tIZNMN[ ROMO[ ROSPPRNTMWMXNXOWPVOWN RKMOM RK[R[\tJ[WOXMXQWOVNTMPMNNMOMQNRPSUUWVXW RMPNQPRU"
    + "TWUXVXYWZU[Q[OZNYMWM[NY\tKZPFPWQZS[U[WZXX RQFQWRZS[ RMMUM\tG]LMLXMZP[R[UZWX RMMMXNZP[ RWMW[ "
    + "RXMX[ RIMMM RTMXM RW[[[\tI[LMR[ RMMRY RXMR[ RJMPM RTMZM\tF^JMN[ RKMNX RRMN[ RRMV[ RSMVX RZMV"
    + "[ RGMNM RWM]M\tH\\LMW[ RMMX[ RXML[ RJMPM RTMZM RJ[P[ RT[Z[\tH[LMR[ RMMRY RXMR[P_NaLbKbJaK`La"
    + " RJMPM RTMZM\tI[WML[ RXMM[ RMMLQLMXM RL[X[XWW[\tKYTBRCQDPFPHQJRKSMSOQQ RRCQEQGRISJTLTNSPORST"
    + "TVTXSZR[Q]Q_Ra RQSSUSWRYQZP\\P^Q`RaTb\tNVRBRb\tKYPBRCSDTFTHSJRKQMQOSQ RRCSESGRIQJPLPNQPURQTP"
    + "VPXQZR[S]S_Ra RSSQUQWRYSZT\\T^S`RaPb\tF^IUISJPLONOPPTSVTXTZS[Q RISJQLPNPPQTTVUXUZT[Q[O",
  italic: // timesi.jhf
    "JZ\tMXUFTGRS RUGRS RUFVGRS RPYOZP[QZPY\tI[PFNM RQFNM RYFWM RZFWM\tH]SBLb RYBRb RLOZO RKUYU\t"
    + "H]TBL_ RYBQ_ RZJYKZL[K[JZHYGVFRFOGMIMKNMONVRXT RMKOMVQWRXTXWWYVZS[O[LZKYJWJVKULVKW\tF^[FI[ R"
    + "NFPHPJOLMMKMIKIIJGLFNFPGSHVHYG[F RWTUUTWTYV[X[ZZ[X[VYTWT\tF_[NZO[P\\O\\N[MZMYNXPVUTXRZP[M[JZ"
    + "IXIUJSPORMSKSIRGPFNGMIMKNNPQUXWZZ[[[\\Z\\Y RM[KZJXJUKSMQ RMKNMVXXZZ[\tNWUFSM RVFSM\tKZZBVESH"
    + "QKOONTNXO]P`Qb RVESIQMPPOUOZP_Qb\tJYSBTDUGVLVPUUSYQ\\N_Jb RSBTEUJUOTTSWQ[N_\tJZRLRX RMOWU RW"
    + "OMU\tE_RIR[ RIR[R\tMXP[OZPYQZQ[P]N_\tE_IR[R\tMXPYOZP[QZPY\tG][BIb\tH]TFQGOIMLLOKSKVLYMZO[Q[T"
    + "ZVXXUYRZNZKYHXGVFTF RTFRGPINLMOLSLVMYO[ RQ[SZUXWUXRYNYKXHVF\tH]TJO[ RVFP[ RVFSIPKNL RUIQKNL"
    + "\tH]OJPKOLNKNJOHPGSFVFYGZIZKYMWOTQPSMUKWI[ RVFXGYIYKXMVOPS RJYKXMXRZUZWYXW RMXR[U[WZXW\tH]OJ"
    + "PKOLNKNJOHPGSFVFYGZIZKYMVOSP RVFXGYIYKXMVO RQPSPVQWRXTXWWYVZS[O[LZKYJWJVKULVKW RSPUQVRWTWWVY"
    + "UZS[\tH]XGR[ RYFS[ RYFJUZU\tH]QFLP RQF[F RQGVG[F RLPMOPNSNVOWPXRXUWXUZR[O[LZKYJWJVKULVKW RSN"
    + "UOVPWRWUVXTZR[\tH]YIXJYKZJZIYGWFTFQGOIMLLOKSKWLYMZO[R[UZWXXVXSWQVPTOQOOPMRLT RTFRGPINLMOLSLX"
    + "MZ RR[TZVXWVWRVP\tH]NFLL R[FZIXLSRQUPWO[ RXLRRPUOWN[ RMIPFRFWI RNHPGRGWIYIZH[F\tH]SFPGOHNJNM"
    + "OOQPTPXOYNZLZIYGVFSF RSFQGPHOJOMPOQP RTPWOXNYLYIXGVF RQPMQKSJUJXKZN[R[VZWYXWXTWRVQTP RQPNQLS"
    + "KUKXLZN[ RR[UZVYWWWSVQ\tH]YMXOVQTRQROQNPMNMKNIPGSFVFXGYHZJZNYRXUVXTZQ[N[LZKXKWLVMWLX ROQNONK"
    + "OIQGSF RXGYIYNXRWUUXSZQ[\tMXSMRNSOTNSM RPYOZP[QZ\tMXSMRNSOTNSM RP[OZPYQZQ[P]N_\tF^ZIJRZ[\tE_"
    + "IO[O RIU[U\tF^JIZRJ[\tH]OJPKOLNKNJOHPGSFWFZG[I[KZMYNSPQQQSRTTT RWFYGZIZKYMXNVO RPYOZP[QZPY\t"
    + "E`WNVLTKQKOLNMMPMSNUPVSVUUVS RQKOMNPNSOUPV RWKVSVUXVZV\\T]Q]O\\L[JYHWGTFQFNGLHJJILHOHRIUJWLY"
    + "NZQ[T[WZYYZX RXKWSWUXV\tH\\UFH[ RUFV[ RTHU[ RLUUU RF[L[ RR[X[\tF^OFI[ RPFJ[ RLFWFZG[I[KZNYOV"
    + "P RWFYGZIZKYNXOVP RMPVPXQYSYUXXVZR[F[ RVPWQXSXUWXUZR[\tH]ZH[H\\F[L[JZHYGWFTFQGOIMLLOKSKVLYMZ"
    + "P[S[UZWXXV RTFRGPINLMOLSLVMYNZP[\tF]OFI[ RPFJ[ RLFUFXGYHZKZOYSWWUYSZO[F[ RUFWGXHYKYOXSVWTYRZ"
    + "O[\tF]OFI[ RPFJ[ RTLRT RLF[FZLZF RMPSP RF[U[WVT[\tF\\OFI[ RPFJ[ RTLRT RLF[FZLZF RMPSP RF[M["
    + "\tH^ZH[H\\F[L[JZHYGWFTFQGOIMLLOKSKVLYMZP[R[UZWXYT RTFRGPINLMOLSLVMYNZP[ RR[TZVXXT RUT\\T\tE_"
    + "NFH[ ROFI[ R[FU[ R\\FV[ RKFRF RXF_F RLPXP RE[L[ RR[Y[\tLYUFO[ RVFP[ RRFYF RL[S[\tI[XFSWRYQZO"
    + "[M[KZJXJVKULVKW RWFRWQYO[ RTF[F\tF]OFI[ RPFJ[ R]FLS RSOW[ RROV[ RLFSF RYF_F RF[M[ RS[Y[\tH\\"
    + "QFK[ RRFL[ RNFUF RH[W[YUV[\tE`NFH[ RNFO[ ROFPY R\\FO[ R\\FV[ R]FW[ RKFOF R\\F`F RE[K[ RS[Z["
    + "\tF_OFI[ ROFVX ROIV[ R\\FV[ RLFOF RYF_F RF[L[\tG]SFPGNILLKOJSJVKYLZN[Q[TZVXXUYRZNZKYHXGVFSF "
    + "RSFQGOIMLLOKSKVLYN[ RQ[SZUXWUXRYNYKXHVF\tF]OFI[ RPFJ[ RLFXF[G\\I\\K[NYPUQMQ RXFZG[I[KZNXPUQ "
    + "RF[M[\tG]SFPGNILLKOJSJVKYLZN[Q[TZVXXUYRZNZKYHXGVFSF RSFQGOIMLLOKSKVLYN[ RQ[SZUXWUXRYNYKXHVF "
    + "RLYLXMVOUPURVSXS_T`V`W^W] RSXT^U_V_W^\tF^OFI[ RPFJ[ RLFWFZG[I[KZNYOVPMP RWFYGZIZKYNXOVP RRPT"
    + "QURVZW[Y[ZYZX RURWYXZYZZY RF[M[\tG^ZH[H\\F[L[JZHYGVFRFOGMIMKNMONVRXT RMKOMVQWRXTXWWYVZS[O[LZ"
    + "KYJWJUI[JYKY\tH]UFO[ RVFP[ ROFLLNF]F\\L\\F RL[S[\tF_NFKQJUJXKZN[R[UZWXXU\\F ROFLQKUKXLZN[ RK"
    + "FRF RYF_F\tH\\NFO[ ROFPY R\\FO[ RLFRF RXF^F\tE_MFK[ RNFLY RUFK[ RUFS[ RVFTY R]FS[ RJFQF RZF`"
    + "F\tG]NFU[ ROFV[ R\\FH[ RLFRF RXF^F RF[L[ RR[X[\tH]NFRPO[ ROFSPP[ R]FSP RLFRF RYF_F RL[S[\tG]"
    + "[FH[ R\\FI[ ROFLLNF\\F RH[V[XUU[\tKYOBOb RPBPb ROBVB RObVb\tKYKFY^\tKYTBTb RUBUb RNBUB RNbUb"
    + "\tG]JTROZT RJTRPZT\tH\\Hb\\b\tLXPFUL RPFOGUL\tH]XMVTUXUZV[Y[[Y\\W RYMWTVXVZW[ RVTVQUNSMQMNNL"
    + "QKTKWLYMZO[Q[SZUWVT RQMONMQLTLXMZ\tH[PFLSLVMYNZ RQFMS RMSNPPNRMTMVNWOXQXTWWUZR[P[NZMWMS RVNW"
    + "PWTVWTZR[ RMFQF\tI[WPWQXQXPWNUMRMONMQLTLWMYNZP[R[UZWW RRMPNNQMTMXNZ\tH]ZFVTUXUZV[Y[[Y\\W R[F"
    + "WTVXVZW[ RVTVQUNSMQMNNLQKTKWLYMZO[Q[SZUWVT RQMONMQLTLXMZ RWF[F\tI[MVQUTTWRXPWNUMRMONMQLTLWMY"
    + "NZP[R[UZWX RRMPNNQMTMXNZ\tKZZGYHZI[H[GZFXFVGUHTJSMP[O_Na RXFVHUJTNRWQ[P^O`NaLbJbIaI`J_K`Ja R"
    + "OMYM\tH\\YMU[T^RaObLbJaI`I_J^K_J` RXMT[S^QaOb RVTVQUNSMQMNNLQKTKWLYMZO[Q[SZUWVT RQMONMQLTLXM"
    + "Z\tH]PFJ[ RQFK[ RMTOPQNSMUMWNXOXQVWVZW[ RUMWOWQUWUZV[Y[[Y\\W RMFQF\tLYUFTGUHVGUF RMQNOPMSMTN"
    + "TQRWRZS[ RRMSNSQQWQZR[U[WYXW\tLYVFUGVHWGVF RNQOOQMTMUNUQR[Q^P`OaMbKbJaJ`K_L`Ka RSMTNTQQ[P^O`"
    + "Mb\tH\\PFJ[ RQFK[ RXNWOXPYOYNXMWMUNQROSMS ROSQTSZT[ ROSPTRZS[U[WZYW RMFQF\tMYUFQTPXPZQ[T[VYW"
    + "W RVFRTQXQZR[ RRFVF\tAbBQCOEMHMINIPHTF[ RGMHNHPGTE[ RHTJPLNNMPMRNSOSQP[ RPMRORQO[ RRTTPVNXMZ"
    + "M\\N]O]Q[W[Z\\[ RZM\\O\\QZWZZ[[^[`YaW\tF]GQHOJMMMNNNPMTK[ RLMMNMPLTJ[ RMTOPQNSMUMWNXOXQVWVZW"
    + "[ RUMWOWQUWUZV[Y[[Y\\W\tI[RMONMQLTLWMYNZP[R[UZWWXTXQWOVNTMRM RRMPNNQMTMXNZ RR[TZVWWTWPVN\tG"
    + "\\HQIOKMNMONOPNTJb RMMNNNPMTIb RNTOQQNSMUMWNXOYQYTXWVZS[Q[OZNWNT RWNXPXTWWUZS[ RFbMb\tH\\XMR"
    + "b RYMSb RVTVQUNSMQMNNLQKTKWLYMZO[Q[SZUWVT RQMONMQLTLXMZ RObVb\tIZJQKOMMPMQNQPPTN[ ROMPNPPOTM"
    + "[ RPTRPTNVMXMYNYOXPWOXN\tJ[XOXPYPYOXNUMRMONNONQORVVWW RNPOQVUWVWYVZS[P[MZLYLXMXMY\tKYTFPTOXO"
    + "ZP[S[UYVW RUFQTPXPZQ[ RNMWM\tF]GQHOJMMMNNNQLWLYN[ RLMMNMQKWKYLZN[P[RZTXVT RXMVTUXUZV[Y[[Y\\W"
    + " RYMWTVXVZW[\tH\\IQJOLMOMPNPQNWNYP[ RNMONOQMWMYNZP[Q[TZVXXUYQYMXMYO\tC`DQEOGMJMKNKQIWIYK[ RI"
    + "MJNJQHWHYIZK[M[OZQXRV RTMRVRYSZU[W[YZ[X\\V]R]M\\M]O RUMSVSYU[\tH\\KQMNOMRMSOSR RQMRORRQVPXNZ"
    + "L[K[JZJYKXLYKZ RQVQYR[U[WZYW RYNXOYPZOZNYMXMVNTPSRRVRYS[\tG\\HQIOKMNMONOQMWMYO[ RMMNNNQLWLYM"
    + "ZO[Q[SZUXWT RZMV[U^SaPbMbKaJ`J_K^L_K` RYMU[T^RaPb\tH\\YMXOVQNWLYK[ RLQMOOMRMVO RMOONRNVOXO R"
    + "LYNYRZUZWY RNYR[U[WYXW\tKYTBRCQDPFPHQJRKSMSOQQ RRCQEQGRISJTLTNSPORSTTVTXSZR[Q]Q_Ra RQSSUSWRY"
    + "QZP\\P^Q`RaTb\tNVRBRb\tKYPBRCSDTFTHSJRKQMQOSQ RRCSESGRIQJPLPNQPURQTPVPXQZR[S]S_Ra RSSQUQWRYS"
    + "ZT\\T^S`RaPb\tF^IUISJPLONOPPTSVTXTZS[Q RISJQLPNPPQTTVUXUZT[Q[O",
  bold: // timesrb.jhf
    "JZ\tMXRFQGQIRQ RRFRTST RRFSFST RSFTGTISQ RRXQYQZR[S[TZTYSXRX RRYRZSZSYRY\tI[NFMGMM RNGMM RNF"
    + "OGMM RWFVGVM RWGVM RWFXGVM\tH]SBLb RYBRb RLOZO RKUYU\tH\\PBP_ RTBT_ RXKXJWJWLYLYJXHWGTFPFMGK"
    + "IKLLNOPURWSXUXXWZ RLLMNOOUQWRXT RMGLILKMMONUPXRYTYWXYWZT[P[MZLYKWKUMUMWLWLV\tF^[FI[ RNFPHPJO"
    + "LMMKMIKIIJGLFNFPGSHVHYG[F RWTUUTWTYV[X[ZZ[X[VYTWT\tE_[O[NZNZP\\P\\N[MZMYNXPVUTXRZP[L[JZIXIUJ"
    + "SPORMSKSIRGPFNGMIMLNOPRTWWZY[[[\\Y\\X RKZJXJUKSLR RRMSI RSKRG RNGMK RNNPQTVWYYZ RN[LZKXKULSP"
    + "O RMINMQQUVXYZZ[Z\\Y\tNWSFRGRM RSGRM RSFTGRM\tKYUBSDQGOKNPNTOYQ]S`Ub RQHPKOOOUPYQ\\ RSDRFQIP"
    + "OPUQ[R^S`\tKYOBQDSGUKVPVTUYS]Q`Ob RSHTKUOUUTYS\\ RQDRFSITOTUS[R^Q`\tJZRFQGSQRR RRFRR RRFSGQQ"
    + "RR RMINIVOWO RMIWO RMIMJWNWO RWIVINOMO RWIMO RWIWJMNMO\tF_RIRZSZ RRISISZ RJQ[Q[R RJQJR[R\tMX"
    + "TZS[R[QZQYRXSXTYT\\S^Q_ RRYRZSZSYRY RS[T\\ RTZS^\tE_IR[R\tMXRXQYQZR[S[TZTYSXRX RRYRZSZSYRY\t"
    + "G^[BIbJb R[B\\BJb\tH\\QFNGLJKOKRLWNZQ[S[VZXWYRYOXJVGSFQF RNHMJLNLSMWNY RVYWWXSXNWJVH RQFOGNI"
    + "MNMSNXOZQ[ RS[UZVXWSWNVIUGSF\tH\\QHQ[ RRHRZ RSFS[ RSFPINJ RM[W[ RQZO[ RQYP[ RSYT[ RSZU[\tH\\"
    + "LJLKMKMJLJ RLIMINJNKMLLLKKKJLHMGPFTFWGXHYJYLXNUPPRNSLUKXK[ RWHXJXLWN RTFVGWJWLVNTPPR RKYLXNX"
    + "SYWYYX RNXSZWZXY RNXS[W[XZYXYV\tH\\LJLKMKMJLJ RLIMINJNKMLLLKKKJLHMGPFTFWGXIXLWNTO RVGWIWLVN "
    + "RSFUGVIVLUNSO RQOTOVPXRYTYWXYWZT[P[MZLYKWKVLUMUNVNWMXLX RWRXTXWWY RSOUPVQWTWWVZT[ RLVLWMWMVL"
    + "V\tH\\SIS[ RTHTZ RUFU[ RUFJUZU RP[X[ RSZQ[ RSYR[ RUYV[ RUZW[\tH\\MFKPMNPMSMVNXPYSYUXXVZS[P[M"
    + "ZLYKWKVLUMUNVNWMXLX RWPXRXVWX RSMUNVOWRWVVYUZS[ RLVLWMWMVLV RMFWF RMGUG RMHQHUGWF\tH\\VIVJWJ"
    + "WIVI RWHVHUIUJVKWKXJXIWGUFRFOGMILKKOKULXNZQ[S[VZXXYUYTXQVOSNQNOONPMR RNIMKLOLUMXNY RWXXVXSWQ"
    + " RRFPGOHNJMNMUNXOZQ[ RS[UZVYWVWSVPUOSN\tH\\KFKL RYFYIXLTQSSRWR[ RSRRTQWQ[ RXLSQQTPWP[R[ RKJL"
    + "HNFPFUIWIXHYF RMHNGPGRH RKJLINHPHUI\tH\\PFMGLILLMNPOTOWNXLXIWGTFPF RNGMIMLNN RVNWLWIVG RPFOG"
    + "NINLONPO RTOUNVLVIUGTF RPOMPLQKSKWLYMZP[T[WZXYYWYSXQWPTO RMQLSLWMY RWYXWXSWQ RPONPMSMWNZP[ R"
    + "T[VZWWWSVPTO\tH\\MWMXNXNWMW RWOVQURSSQSNRLPKMKLLINGQFSFVGXIYLYRXVWXUZR[O[MZLXLWMVNVOWOXNYMY "
    + "RMPLNLKMI RVHWIXLXRWVVX RQSORNQMNMKNHOGQF RSFUGVIWLWSVWUYTZR[\tMXRMQNQORPSPTOTNSMRM RRNROSOS"
    + "NRN RRXQYQZR[S[TZTYSXRX RRYRZSZSYRY\tMXRMQNQORPSPTOTNSMRM RRNROSOSNRN RTZS[R[QZQYRXSXTYT\\S^"
    + "Q_ RRYRZSZSYRY RS[T\\ RTZS^\tF^ZIJRZ[\tF_JM[M[N RJMJN[N RJU[U[V RJUJV[V\tF^JIZRJ[\tI\\MKMJNJ"
    + "NLLLLJMHNGPFTFWGXHYJYLXNWOSQ RWHXIXMWN RTFVGWIWMVOUP RRQRTSTSQRQ RRXQYQZR[S[TZTYSXRX RRYRZSZ"
    + "SYRY\tE`WNVLTKQKOLNMMPMSNUPVSVUUVS RQKOMNPNSOUPV RWKVSVUXVZV\\T]Q]O\\L[JYHWGTFQFNGLHJJILHOHR"
    + "IUJWLYNZQ[T[WZYYZX RXKWSWUXV\tH\\RFKZ RQIW[ RRIX[ RRFY[ RMUVU RI[O[ RT[[[ RKZJ[ RKZM[ RWZU[ "
    + "RWYV[ RXYZ[\tG]LFL[ RMGMZ RNFN[ RIFUFXGYHZJZLYNXOUP RXHYJYLXN RUFWGXIXMWOUP RNPUPXQYRZTZWYYX"
    + "ZU[I[ RXRYTYWXY RUPWQXSXXWZU[ RJFLG RKFLH ROFNH RPFNG RLZJ[ RLYK[ RNYO[ RNZP[\tG\\XIYFYLXIVG"
    + "TFQFNGLIKKJNJSKVLXNZQ[T[VZXXYV RMILKKNKSLVMX RQFOGMJLNLSMWOZQ[\tG]LFL[ RMGMZ RNFN[ RIFSFVGXI"
    + "YKZNZSYVXXVZS[I[ RWIXKYNYSXVWX RSFUGWJXNXSWWUZS[ RJFLG RKFLH ROFNH RPFNG RLZJ[ RLYK[ RNYO[ R"
    + "NZP[\tG\\LFL[ RMGMZ RNFN[ RIFYFYL RNPTP RTLTT RI[Y[YU RJFLG RKFLH ROFNH RPFNG RTFYG RVFYH RW"
    + "FYI RXFYL RTLSPTT RTNRPTR RTOPPTQ RLZJ[ RLYK[ RNYO[ RNZP[ RT[YZ RV[YY RW[YX RX[YU\tG[LFL[ RM"
    + "GMZ RNFN[ RIFYFYL RNPTP RTLTT RI[Q[ RJFLG RKFLH ROFNH RPFNG RTFYG RVFYH RWFYI RXFYL RTLSPTT "
    + "RTNRPTR RTOPPTQ RLZJ[ RLYK[ RNYO[ RNZP[\tG^XIYFYLXIVGTFQFNGLIKKJNJSKVLXNZQ[T[VZXZY[YS RMILKK"
    + "NKSLVMX RQFOGMJLNLSMWOZQ[ RXTXY RWSWYVZ RTS\\S RUSWT RVSWU RZSYU R[SYT\tF^KFK[ RLGLZ RMFM[ R"
    + "WFW[ RXGXZ RYFY[ RHFPF RTF\\F RMPWP RH[P[ RT[\\[ RIFKG RJFKH RNFMH ROFMG RUFWG RVFWH RZFYH R"
    + "[FYG RKZI[ RKYJ[ RMYN[ RMZO[ RWZU[ RWYV[ RYYZ[ RYZ[[\tLXQFQ[ RRGRZ RSFS[ RNFVF RN[V[ ROFQG R"
    + "PFQH RTFSH RUFSG RQZO[ RQYP[ RSYT[ RSZU[\tJZSFSWRZQ[ RTGTWSZ RUFUWTZQ[O[MZLXLVMUNUOVOWNXMX R"
    + "MVMWNWNVMV RPFXF RQFSG RRFSH RVFUH RWFUG\tF\\KFK[ RLGLZ RMFM[ RXGMR RPPW[ RQPX[ RQNY[ RHFPF "
    + "RUF[F RH[P[ RT[[[ RIFKG RJFKH RNFMH ROFMG RWFXG RZFXG RKZI[ RKYJ[ RMYN[ RMZO[ RWYU[ RWYZ[\tI"
    + "[NFN[ ROGOZ RPFP[ RKFSF RK[Z[ZU RLFNG RMFNH RQFPH RRFPG RNZL[ RNYM[ RPYQ[ RPZR[ RU[ZZ RW[ZY "
    + "RX[ZX RY[ZU\tE_JFJZ RJFQ[ RKFQX RLFRX RXFQ[ RXFX[ RYGYZ RZFZ[ RGFLF RXF]F RG[M[ RU[][ RHFJG "
    + "R[FZH R\\FZG RJZH[ RJZL[ RXZV[ RXYW[ RZY[[ RZZ\\[\tF^KFKZ RKFY[ RLFXX RMFYX RYGY[ RHFMF RVF"
    + "\\F RH[N[ RIFKG RWFYG R[FYG RKZI[ RKZM[\tG]QFNGLIKKJOJRKVLXNZQ[S[VZXXYVZRZOYKXIVGSFQF RMILKK"
    + "NKSLVMX RWXXVYSYNXKWI RQFOGMJLNLSMWOZQ[ RS[UZWWXSXNWJUGSF\tG]LFL[ RMGMZ RNFN[ RIFUFXGYHZJZMY"
    + "OXPUQNQ RXHYJYMXO RUFWGXIXNWPUQ RI[Q[ RJFLG RKFLH ROFNH RPFNG RLZJ[ RLYK[ RNYO[ RNZP[\tG]QFN"
    + "GLIKKJOJRKVLXNZQ[S[VZXXYVZRZOYKXIVGSFQF RMILKKNKSLVMX RWXXVYSYNXKWI RQFOGMJLNLSMWOZQ[ RS[UZW"
    + "WXSXNWJUGSF RNXOVQURUTVUXV^W`Y`Z^Z\\ RV\\W^X_Y_ RUXW]X^Y^Z]\tG]LFL[ RMGMZ RNFN[ RIFUFXGYHZJZ"
    + "LYNXOUPNP RXHYJYLXN RUFWGXIXMWOUP RRPTQUSWYX[Z[[Y[W RWWXYYZZZ RTQURXXYYZY[X RI[Q[ RJFLG RKFL"
    + "H ROFNH RPFNG RLZJ[ RLYK[ RNYO[ RNZP[\tH\\XIYFYLXIVGSFPFMGKIKLLNOPURWSXUXXWZ RLLMNOOUQWRXT R"
    + "MGLILKMMONUPXRYTYWXYWZT[Q[NZLXKUK[LX\tH\\JFJL RQFQ[ RRGRZ RSFS[ RZFZL RJFZF RN[V[ RKFJL RLFJ"
    + "I RMFJH ROFJG RUFZG RWFZH RXFZI RYFZL RQZO[ RQYP[ RSYT[ RSZU[\tF^KFKULXNZQ[S[VZXXYUYG RLGLVM"
    + "X RMFMVNYOZQ[ RHFPF RVF\\F RIFKG RJFKH RNFMH ROFMG RWFYG R[FYG\tH\\KFR[ RLFRXR[ RMFSX RYGR[ "
    + "RIFPF RUF[F RJFLH RNFMH ROFMG RWFYG RZFYG\tF^JFN[ RKFNVN[ RLFOV RRFOVN[ RRFV[ RSFVVV[ RTFWV "
    + "RZGWVV[ RGFOF RRFTF RWF]F RHFKG RIFKH RMFLH RNFLG RXFZG R\\FZG\tH\\KFW[ RLFX[ RMFY[ RXGLZ RI"
    + "FPF RUF[F RI[O[ RT[[[ RJFMH RNFMH ROFMG RVFXG RZFXG RLZJ[ RLZN[ RWZU[ RWYV[ RWYZ[\tG]JFQQQ[ "
    + "RKFRQRZ RLFSQS[ RYGSQ RHFOF RVF\\F RN[V[ RIFKG RNFLG RWFYG R[FYG RQZO[ RQYP[ RSYT[ RSZU[\tH"
    + "\\YFKFKL RWFK[ RXFL[ RYFM[ RK[Y[YU RLFKL RMFKI RNFKH RPFKG RT[YZ RV[YY RW[YX RX[YU\tKYOBOb R"
    + "PBPb ROBVB RObVb\tKYKFY^\tKYTBTb RUBUb RNBUB RNbUb\tG]JTROZT RJTRPZT\tH\\Hb\\b\tLXPFUL RPFOG"
    + "UL\tI]NPNOOOOQMQMONNPMTMVNWOXQXXYZZ[ RVOWQWXXZ RTMUNVPVXWZZ[[[ RVRUSPTMULWLXMZP[S[UZVX RNUMW"
    + "MXNZ RUSQTOUNWNXOZP[\tG\\LFL[MZOZ RMGMY RIFNFNZ RNPONQMSMVNXPYSYUXXVZS[Q[OZNX RWPXRXVWX RSMU"
    + "NVOWRWVVYUZS[ RJFLG RKFLH\tH[WQWPVPVRXRXPVNTMQMNNLPKSKULXNZQ[S[VZXX RMPLRLVMX RQMONNOMRMVNYO"
    + "ZQ[\tH]VFV[[[ RWGWZ RSFXFX[ RVPUNSMQMNNLPKSKULXNZQ[S[UZVX RMPLRLVMX RQMONNOMRMVNYOZQ[ RTFVG "
    + "RUFVH RXYY[ RXZZ[\tH[MSXSXQWOVNSMQMNNLPKSKULXNZQ[S[VZXX RWRWQVO RMPLRLVMX RVSVPUNSM RQMONNOM"
    + "RMVNYOZQ[\tKYWHWGVGVIXIXGWFTFRGQHPKP[ RRHQKQZ RTFSGRIR[ RMMVM RM[U[ RPZN[ RPYO[ RRYS[ RRZT["
    + "\tI\\XNYOZNYMXMVNUO RQMONNOMQMSNUOVQWSWUVVUWSWQVOUNSMQM ROONQNSOU RUUVSVQUO RQMPNOPOTPVQW RS"
    + "WTVUTUPTNSM RNUMVLXLYM[N\\Q]U]X^Y_ RN[Q\\U\\X] RLYMZP[U[X\\Y^Y_XaUbObLaK_K^L\\O[ RObMaL_L^M"
    + "\\O[\tG^LFL[ RMGMZ RIFNFN[ RNQOOPNRMUMWNXOYRY[ RWOXRXZ RUMVNWQW[ RI[Q[ RT[\\[ RJFLG RKFLH RL"
    + "ZJ[ RLYK[ RNYO[ RNZP[ RWZU[ RWYV[ RYYZ[ RYZ[[\tLXQFQHSHSFQF RRFRH RQGSG RQMQ[ RRNRZ RNMSMS[ "
    + "RN[V[ ROMQN RPMQO RQZO[ RQYP[ RSYT[ RSZU[\tKXRFRHTHTFRF RSFSH RRGTG RRMR^QaPb RSNS]R` ROMTMT"
    + "]S`RaPbMbLaL_N_NaMaM` RPMRN RQMRO\tG]LFL[ RMGMZ RIFNFN[ RWNNW RRSY[ RRTX[ RQTW[ RTM[M RI[Q[ "
    + "RT[[[ RJFLG RKFLH RUMWN RZMWN RLZJ[ RLYK[ RNYO[ RNZP[ RWYU[ RVYZ[\tLXQFQ[ RRGRZ RNFSFS[ RN[V"
    + "[ ROFQG RPFQH RQZO[ RQYP[ RSYT[ RSZU[\tAcFMF[ RGNGZ RCMHMH[ RHQIOJNLMOMQNROSRS[ RQORRRZ ROMP"
    + "NQQQ[ RSQTOUNWMZM\\N]O^R^[ R\\O]R]Z RZM[N\\Q\\[ RC[K[ RN[V[ RY[a[ RDMFN REMFO RFZD[ RFYE[ RH"
    + "YI[ RHZJ[ RQZO[ RQYP[ RSYT[ RSZU[ R\\ZZ[ R\\Y[[ R^Y_[ R^Z`[\tG^LML[ RMNMZ RIMNMN[ RNQOOPNRMU"
    + "MWNXOYRY[ RWOXRXZ RUMVNWQW[ RI[Q[ RT[\\[ RJMLN RKMLO RLZJ[ RLYK[ RNYO[ RNZP[ RWZU[ RWYV[ RYY"
    + "Z[ RYZ[[\tH\\QMNNLPKSKULXNZQ[S[VZXXYUYSXPVNSMQM RMPLRLVMX RWXXVXRWP RQMONNOMRMVNYOZQ[ RS[UZV"
    + "YWVWRVOUNSM\tG\\LMLb RMNMa RIMNMNb RNPONQMSMVNXPYSYUXXVZS[Q[OZNX RWPXRXVWX RSMUNVOWRWVVYUZS["
    + " RIbQb RJMLN RKMLO RLaJb RL`Kb RN`Ob RNaPb\tH\\VNVb RWOWa RUNWNXMXb RVPUNSMQMNNLPKSKULXNZQ[S"
    + "[UZVX RMPLRLVMX RQMONNOMRMVNYOZQ[ RSb[b RVaTb RV`Ub RX`Yb RXaZb\tIZNMN[ RONOZ RKMPMP[ RWOWNV"
    + "NVPXPXNWMUMSNQPPS RK[S[ RLMNN RMMNO RNZL[ RNYM[ RPYQ[ RPZR[\tJ[WOXMXQWOVNTMPMNNMOMQNSPTUUWVX"
    + "Y RNNMQ RNRPSUTWU RXVWZ RMONQPRUSWTXVXYWZU[Q[OZNYMWM[NY\tKZPHPVQYRZT[V[XZYX RQHQWRY RPHRFRWS"
    + "ZT[ RMMVM\tG^LMLVMYNZP[S[UZVYWW RMNMWNY RIMNMNWOZP[ RWMW[\\[ RXNXZ RTMYMY[ RJMLN RKMLO RYYZ["
    + " RYZ[[\tI[LMR[ RMMRY RNMSY RXNSYR[ RJMQM RTMZM RKMNO RPMNN RVMXN RYMXN\tF^JMN[ RKMNX RLMOX R"
    + "RMOXN[ RRMV[ RSMVX RRMTMWX RZNWXV[ RGMOM RWM]M RHMKN RNMLN RXMZN R\\MZN\tH\\LMV[ RMMW[ RNMX["
    + " RWNMZ RJMQM RTMZM RJ[P[ RS[Z[ RKMMN RPMNN RUMWN RYMWN RMZK[ RMZO[ RVZT[ RWZY[\tH[LMR[ RMMRY"
    + " RNMSY RXNSYP_NaLbJbIaI_K_KaJaJ` RJMQM RTMZM RKMNO RPMNN RVMXN RYMXN\tI[VML[ RWMM[ RXMN[ RXM"
    + "LMLQ RL[X[XW RMMLQ RNMLP ROMLO RQMLN RS[XZ RU[XY RV[XX RW[XW\tKYTBRCQDPFPHQJRKSMSOQQ RRCQEQG"
    + "RISJTLTNSPORSTTVTXSZR[Q]Q_Ra RQSSUSWRYQZP\\P^Q`RaTb\tNVRBRb\tKYPBRCSDTFTHSJRKQMQOSQ RRCSESGR"
    + "IQJPLPNQPURQTPVPXQZR[S]S_Ra RSSQUQWRYSZT\\T^S`RaPb\tF^IUISJPLONOPPTSVTXTZS[Q RISJQLPNPPQTTVU"
    + "XUZT[Q[O",
  script: // scripts.jhf
    "JZ\tMXUFTGRS RUGRS RUFVGRS RPYOZP[QZPY\tI[PFNM RQFNM RYFWM RZFWM\tH]SBLb RYBRb RLOZO RKUYU\t"
    + "H]TBL_ RYBQ_ RZJYKZL[K[JZHYGVFRFOGMIMKNMONVRXT RMKOMVQWRXTXWWYVZS[O[LZKYJWJVKULVKW\tF^[FI[ R"
    + "NFPHPJOLMMKMIKIIJGLFNFPGSHVHYG[F RWTUUTWTYV[X[ZZ[X[VYTWT\tE_\\N[O\\P]O]N\\M[MYNWPRXPZN[K[HZG"
    + "XGVHTISKRPPROTMUKUITGRFPGOIOLPRQUSXUZW[Y[ZYZX RK[IZHXHVITJSPP ROLPQQTSWUYWZYZZY\tMXUHTGUFVGV"
    + "HUJSL\tKZZBVESHQKOONTNXO]P`Qb RVESIQMPPOUOZP_Qb\tJYSBTDUGVLVPUUSYQ\\N_Jb RSBTEUJUOTTSWQ[N_\t"
    + "J[TFTR ROIYO RYIOO\tE_RIR[ RIR[R\tMXP[OZPYQZQ[P]N_\tE_IR[R\tMWRYQZR[SZRY\tG]_BEb\tH]TFQGOIML"
    + "LOKSKVLYMZO[Q[TZVXXUYRZNZKYHXGVFTF RTFRGPINLMOLSLVMYO[ RQ[SZUXWUXRYNYKXHVF\tH]TJO[ RVFP[ RVF"
    + "SIPKNL RUIQKNL\tH]OJPKOLNKNJOHPGSFVFYGZIZKYMWOTQPSMUKWI[ RVFXGYIYKXMVOPS RJYKXMXRZUZWYXW RMX"
    + "R[U[WZXW\tH]OJPKOLNKNJOHPGSFVFYGZIZKYMVOSP RVFXGYIYKXMVO RQPSPVQWRXTXWWYVZS[O[LZKYJWJVKULVKW"
    + " RSPUQVRWTWWVYUZS[\tH]XGR[ RYFS[ RYFJUZU\tH]QFLP RQF[F RQGVG[F RLPMOPNSNVOWPXRXUWXUZR[O[LZKY"
    + "JWJVKULVKW RSNUOVPWRWUVXTZR[\tH]YIXJYKZJZIYGWFTFQGOIMLLOKSKWLYMZO[R[UZWXXVXSWQVPTOQOOPMRLT R"
    + "TFRGPINLMOLSLXMZ RR[TZVXWVWRVP\tH]NFLL R[FZIXLSRQUPWO[ RXLRRPUOWN[ RMIPFRFWI RNHPGRGWIYIZH[F"
    + "\tH]SFPGOHNJNMOOQPTPXOYNZLZIYGVFSF RSFQGPHOJOMPOQP RTPWOXNYLYIXGVF RQPMQKSJUJXKZN[R[VZWYXWXT"
    + "WRVQTP RQPNQLSKUKXLZN[ RR[UZVYWWWSVQ\tH]YMXOVQTRQROQNPMNMKNIPGSFVFXGYHZJZNYRXUVXTZQ[N[LZKXKW"
    + "LVMWLX ROQNONKOIQGSF RXGYIYNXRWUUXSZQ[\tMXSMRNSOTNSM RPYOZP[QZ\tMXSMRNSOTNSM RP[OZPYQZQ[P]N_"
    + "\tF^ZIJRZ[\tE_IO[O RIU[U\tF^JIZRJ[\tH]OJPKOLNKNJOHPGSFWFZG[I[KZMYNSPQQQSRTTT RWFYGZIZKYMXNVO"
    + " RPYOZP[QZPY\tE`WNVLTKQKOLNMMPMSNUPVSVUUVS RQKOMNPNSOUPV RWKVSVUXVZV\\T]Q]O\\L[JYHWGTFQFNGLH"
    + "JJILHOHRIUJWLYNZQ[T[WZYYZX RXKWSWUXV\tG[G[IZLWOSSLVFV[UXSUQSNQLQKRKTLVNXQZT[Y[\tF]SHTITLSPRS"
    + "QUOXMZK[J[IZIWJRKOLMNJPHRGUFXFZG[I[KZMYNWOTP RSPTPWQXRYTYWXYWZU[R[PZOX\tH\\TLTMUNWNYMZKZIYGW"
    + "FTFQGOIMLLNKRKVLYMZO[Q[TZVXWV\tG^TFRGQIPMOSNVMXKZI[G[FZFXGWIWKXMZP[S[VZXXZT[O[KZHYGWFTFRHRJS"
    + "MUPWRZT\\U\tH\\VJVKWLYLZKZIYGVFRFOGNINLONPOSPPPMQLRKTKWLYMZP[S[VZXXYV\tH\\RLPLNKMINGQFTFXG[G"
    + "]F RXGVNTTRXPZN[L[JZIXIVJULUNV RQPZP\tG^G[IZMVPQQNRJRGQFPFOGNINLONQOUOXNYMZKZQYVXXVZS[O[LZJX"
    + "IVIT\tF^MMKLJJJIKGMFNFPGQIQKPONULYJ[H[GZGX RMRVOXN[L]J^H^G]F\\FZHXLVRUWUZV[W[YZZY\\V\tIZWVUT"
    + "SQROQLQIRGSFUFVGWIWLVQTVSXQZO[M[KZJXJVKUMUOV\tJYT^R[PVOPOJPGRFTFUGVJVMURR[PaOdNfLgKfKdLaN^P"
    + "\\SZWX\tF^MMKLJJJIKGMFNFPGQIQKPONULYJ[H[GZGX R^I^G]F\\FZGXIVLTNROPO RROSQSXTZU[V[XZYY[V\tI\\"
    + "MRORSQVOXMYKYHXFVFUGTISNRSQVPXNZL[J[IZIXJWLWNXQZT[V[YZ[X\t@aEMCLBJBICGEFFFHGIIIKHPGTE[ RGTJL"
    + "LHMGOFPFRGSISKRPQTO[ RQTTLVHWGYFZF\\G]I]K\\PZWZZ[[\\[^Z_YaV\tE]JMHLGJGIHGJFKFMGNINKMPLTJ[ RL"
    + "TOLQHRGTFVFXGYIYKXPVWVZW[X[ZZ[Y]V\tH]TFQGOIMLLNKRKVLYMZO[Q[TZVXXUYSZOZKYHXGVFTFRHRKSNUQWSZU"
    + "\\V\tF_SHTITLSPRSQUOXMZK[J[IZIWJRKOLMNJPHRGUFZF\\G]H^J^M]O\\PZQWQUPTO\tH^ULTNSOQPOPNNNLOIQGT"
    + "FWFYGZIZMYPWSSWPYNZK[I[HZHXIWKWMXPZS[V[YZ[X\tF_SHTITLSPRSQUOXMZK[J[IZIWJRKOLMNJPHRGUFYF[G\\H"
    + "]J]M\\O[PYQVQSPTQUSUXVZX[ZZ[Y]V\tH\\H[JZLXOTQQSMTJTGSFRFQGPIPKQMSOVQXSYUYWXYWZT[P[MZKXJVJT\t"
    + "H[RLPLNKMINGQFTFXG[G]F RXGVNTTRXPZN[L[JZIXIVJULUNV\tE]JMHLGJGIHGJFKFMGNINKMOLRKVKXLZN[P[RZSY"
    + "UUXMZF RXMWQVWVZW[X[ZZ[Y]V\tF]KMILHJHIIGKFLFNGOIOKNOMRLVLYM[O[QZTWVTXPYMZIZGYFXFWGVIVKWNYP[Q"
    + "\tC_HMFLEJEIFGHFIFKGLILLK[ RUFK[ RUFS[ RaF_G\\JYNVTS[\tF^NLLLKKKILGNFPFRGSISLQUQXRZT[V[XZYXY"
    + "VXUVU R]I]G\\FZFXGVITLPUNXLZJ[H[GZGX\tF]KMILHJHIIGKFLFNGOIOKNOMRLVLXMZN[P[RZTXVUWSYM R[FYMVW"
    + "T]RbPfNgMfMdNaP^S[VY[V\tH]ULTNSOQPOPNNNLOIQGTFWFYGZIZMYPWTTWPZN[K[JZJXKWNWPXQYR[R^QaPcNfLgKf"
    + "KdLaN^Q[TYZV\tKYOBOb RPBPb ROBVB RObVb\tKYKFY^\tKYTBTb RUBUb RNBUB RNbUb\tJZPLRITL RMORJWO R"
    + "RJR[\tJZJ]Z]\tMXVFTHSJSKTLUKTJ\tL\\UUTSRRPRNSMTLVLXMZO[Q[SZTXVRUWUZV[W[YZZY\\V\tM[MVOSRNSLTI"
    + "TGSFQGPIOMNTNZO[P[RZTXUUURVVWWYW[V\tMXTTTSSRQROSNTMVMXNZP[S[VYXV\tL\\UUTSRRPRNSMTLVLXMZO[Q[S"
    + "ZTXZF RVRUWUZV[W[YZZY\\V\tNXOYQXRWSUSSRRQROSNUNXOZQ[S[UZVYXV\tOWOVSQUNVLWIWGVFTGSIQQNZKaJdJf"
    + "KgMfNcOZP[R[TZUYWV\tL[UUTSRRPRNSMTLVLXMZO[Q[SZTY RVRTYPdOfMgLfLdMaP^S\\U[XY[V\tM\\MVOSRNSLTI"
    + "TGSFQGPIOMNSM[ RM[NXOVQSSRURVSVUUXUZV[W[YZZY\\V\tPWSMSNTNTMSM RPVRRPXPZQ[R[TZUYWV\tPWSMSNTNT"
    + "MSM RPVRRLdKfIgHfHdIaL^O\\Q[TYWV\tM[MVOSRNSLTITGSFQGPIOMNSM[ RM[NXOVQSSRURVSVUTVQV RQVSWTZU["
    + "V[XZYY[V\tOWOVQSTNULVIVGUFSGRIQMPTPZQ[R[TZUYWV\tE^EVGSIRJSJTIXH[ RIXJVLSNRPRQSQTPXO[ RPXQVSS"
    + "URWRXSXUWXWZX[Y[[Z\\Y^V\tJ\\JVLSNROSOTNXM[ RNXOVQSSRURVSVUUXUZV[W[YZZY\\V\tLZRRPRNSMTLVLXMZO"
    + "[Q[SZTYUWUUTSRRQSQURWTXWXYWZV\tKZKVMSNQMUGg RMUNSPRRRTSUUUWTYSZQ[ RMZO[R[UZWYZV\tL[UUTSRRPRN"
    + "SMTLVLXMZO[Q[SZ RVRUUSZPaOdOfPgRfScS\\U[XY[V\tMZMVOSPQPSSSTTTVSYSZT[U[WZXYZV\tNYNVPSQQQSSVTX"
    + "TZR[ RNZP[T[VZWYYV\tOXOVQSSO RVFPXPZQ[S[UZVYXV RPNWN\tL[LVNRLXLZM[O[QZSXUU RVRTXTZU[V[XZYY[V"
    + "\tL[LVNRMWMZN[O[RZTXUUUR RURVVWWYW[V\tI^LRJTIWIYJ[L[NZPX RRRPXPZQ[S[UZWXXUXR RXRYVZW\\W^V\tJ"
    + "ZJVLSNRPRQSQZR[U[XYZV RWSVRTRSSOZN[L[KZ\tL[LVNRLXLZM[O[QZSXUU RVRPdOfMgLfLdMaP^S\\U[XY[V\tLZ"
    + "LVNSPRRRTTTVSXQZN[P\\Q^QaPdOfMgLfLdMaP^S\\WYZV\tKYTBRCQDPFPHQJRKSMSOQQ RRCQEQGRISJTLTNSPORST"
    + "TVTXSZR[Q]Q_Ra RQSSUSWRYQZP\\P^Q`RaTb\tNVRBRb\tKYPBRCSDTFTHSJRKQMQOSQ RRCSESGRIQJPLPNQPURQTP"
    + "VPXQZR[S]S_Ra RSSQUQWRYSZT\\T^S`RaPb\tF^IUISJPLONOPPTSVTXTZS[Q RISJQLPNPPQTTVUXUZT[Q[O",
  gothic: // gothiceng.jhf
    "JZ\tLXRFQGOHQIRT RRISHRGQHRIRT RRFSGUHSIRT RRXPZR[TZRX RRYQZSZRY\tI[NFMGMM RNGMM RNFOGMM RWF"
    + "VGVM RWGVM RWFXGVM\tH]SBLb RYBRb RLOZO RKUYU\tH\\PBP_ RTBT_ RTFVGWIWKYJXHWGTFPFMGKIKLLNOPURW"
    + "SXUXXWZ RXJWH RLLMNOOUQWRXT RMYLW RMGLILKMMONUPXRYTYWXYWZT[P[MZLYKWMVMXNZP[\tF^[FI[ RNFPHPJO"
    + "LMMKMIKIIJGLFNFPGSHVHYG[F RWTUUTWTYV[X[ZZ[X[VYTWT\tE_YNZO[O\\N RXOYP[P RXPYQZQ[P\\N RYNST RR"
    + "UL[HVNP ROOSKOFJLPRTXVZX[Z[[Z\\X RLZIV RRKOG RKLPQTWVYXZ[Z RMZIU RRLNG RKKQQUWVXXY[Y\\X\tNWS"
    + "FRGRM RSGRM RSFTGRM\tKYUBSDQGOKNPNTOYQ]S`Ub RQHPKOOOUPYQ\\ RSDRFQIPOPUQ[R^S`\tKYOBQDSGUKVPVT"
    + "UYS]Q`Ob RSHTKUOUUTYS\\ RQDRFSITOTUS[R^Q`\tJZRFQGSQRR RRFRR RRFSGQQRR RMINIVOWO RMIWO RMIMJW"
    + "NWO RWIVINOMO RWIMO RWIWJMNMO\tF_RIRZSZ RRISISZ RJQ[Q[R RJQJR[R\tLXR^R\\PZRXSZS\\R^P_ RRYQZR"
    + "[RY\tE_IR[R\tLXRXPZR[TZRX RRYQZSZRY\tG^[BIbJb R[B\\BJb\tH\\LHLXJY RMIMXPZ RNHNXPYQZ RLHNHSGU"
    + "F RSGTHVIVY RTGWIWX RUFVGXHZHXIXY RJYLYNZO[QZVYXY\tH\\OHPIQKQXOY RQIPHQGRIRYTZ ROHRFSHSXUYVY"
    + " ROYPYRZS[TZVY\tH\\LHNHPGQFSGVHXH RPHRG RLHNIPIRHSG RVHVP RWIWO RXHXPQPNQLSKVK[ RK[OYSXVXZY "
    + "RNZQYVYYZ RK[PZUZX[ZY\tH\\LHMHOGPFRGVHXH ROHQG RLHNIPIRG RVHVO RWIWN RXHXOVOSPQQ RQPSQVRXRXY"
    + " RWSWX RVRVY RKYMXOXQYRZ ROYQZ RKYMYOZP[RZVYXY\tH\\UFKPKUTU RVUZU[V[TZU RLPLT RMNMU RTGTXRY "
    + "RUJVHUGUYWZ RUFWHVJVXXYYY RRYSYUZV[WZYY\tH\\LFLO RLFXF RMGVG RLHUHWGXF RVLUMSNOOLO RSNTNVOVY"
    + " RUMWNWX RVLWMYNZNXOXY RKYMXOXQYRZ ROYQZ RKYMYOZP[RZVYXY\tH\\LHLXJY RMIMXPZ RNHNXPYQZ RLHNHR"
    + "GTFUGWHXH RSGUH RRGTIVIXH RNPOPSOUNVM RSOTOVPVY RUNWPWX RVMWNYOZOXPXY RJYLYNZO[QZVYXY\tH\\KH"
    + "MFPGUGZF RLGOHTHWG RKHOIRIVHZF RZFYHWKSOQRPUPXQ[ RRQQTQWRZ RUMSPRSRVSYQ[\tH\\LILO RMJMN RNIN"
    + "O RLINISHUGVF RSHTHVIVO RUGWHWN RVFWGYHZHXIXO RLONOVRXR RXOVONRLR RLRLXJY RMSMXPZ RNRNXPYQZ "
    + "RVRVY RWSWX RXRXY RJYLYNZO[QZVYXY\tH\\LHLQJR RMIMROS RNHNQPRQR RLHNHSGUF RSGTHVIVY RTGWIWX R"
    + "UFVGXHZHXIXY RJRKRMSNTOSQRUQVQ RKYMXOXQYRZ ROYQZ RKYMYOZP[RZVYXY\tLXRMPORPTORM RRNQOSORN RRX"
    + "PZR[TZRX RRYQZSZRY\tLXRMPORPTORM RRNQOSORN RR^R\\PZRXSZS\\R^P_ RRYQZR[RY\tF^ZIJRZ[\tF_JM[M[N"
    + " RJMJN[N RJU[U[V RJUJV[V\tF^JIZRJ[\tI[LJMHNGQFSFVGWHXJXLWNUPSQ RMJNH RVHWIWMVN RLJNKNIOGQF R"
    + "SFUGVIVMUOSQ RRQRTSQQQRT RRXPZR[TZRX RRYQZSZRY\tE`WNVLTKQKOLNMMPMSNUPVSVUUVS RQKOMNPNSOUPV R"
    + "WKVSVUXVZV\\T]Q]O\\L[JYHWGTFQFNGLHJJILHOHRIUJWLYNZQ[T[WZYYZX RXKWSWUXV\tG]LINGPFRFSGZW[X]X R"
    + "QGRHYXZZ[YYX RNGPGQHXXYZZ[[[]X RLMMLOKPKQL RPLPM RMLOLPN RG[IYKXNXPY RJYNYOZ RG[JZMZN[PY RRJ"
    + "LX RNSVS\tF^HHJFMFOGQF RKGNG RHHJGLHOHQF RMKLLKNKOIOHPHRIQKQKW RLMLU RIPLP RMKMTLVKW RRIQJPL"
    + "PU RQKQS RRIRRQTPU RRIXFZG[I[KYMUO RXGZIZK RVGXHYIYLWN RWNZP[R[X RYPZRZW RWNXOYQYX RJ[MYPXTX"
    + "WY RLZOYTYVZ RJ[NZSZU[WYYX[X RUOUX RURYR RUUYU\tE]NGLHJJILHOHSIVJXMZP[S[VZXYZW[U RJKINISKWNY"
    + "QZTZWY RNGLIKKJNJRKUNXQYTYWXYW[U RPJPV RQJQT RRIRSQUPV RPJRIUFWGYGZF RTGVHXH RSHUIWIYHZF RWI"
    + "WX\tG^IFWFYGZIZX RKGWGYIYW RIFJGLHWHXIXX ROKNLMNMOKOJPJRKQMQMV RNMNT RKPNP ROKOSNUMV RI[LYOX"
    + "SXVY RKZNYSYUZ RI[MZRZT[VYXXZX RRHRX RRMTNVNXM RRSTRVRXS\tG]IHKFMFOGQF RLGNG RIHKGMHOHQF RNK"
    + "MLLNLOJOIPIRJQLQLW RMMMU RJPMP RNKNTMVLW RQMRJSHTGVFXF[G RTHVGXGZH RRJSIUHWHYI[G RQURRSPTOVO"
    + "XP RTPVPWQ RRRSQUQVRXP RK[NYRXWX[Y RMZPYWYZZ RK[OZVZY[[Y RQMQX\tF]JHLFOFQGSF RMGPG RJHLGNHQH"
    + "SF RPKOLNNNOLOKPKRLQNQNV ROMOT RLPOP RPKPSOUNV RSJSYRZQZMXKXIYG[ RTJTX RTPXP RPZOZMYJY RUIUO"
    + "XO RXQUQUWTYP[N[LZJZG[ RSJUIXFZG\\G]F RWGYH[H RVHXIZI\\H]F RXIXW\tE^NGLHJJILHOHRIUJWLYNZQ[U["
    + "XZZX[V[SZQYPWOUO RJKINISJV RNGLIKKJNJSKVLXNZ RYXZWZSYQ RU[WZXYYWYSXQWPUO RPJPW RQJQU RRIRTQV"
    + "PW RPJRIUFWGYGZF RTGVHXH RSHUIWIYHZF RYHUOU[ RUSYS RUVYV\tF^HHJFMFOGQF RKGNG RHHJGLHOHQF RMK"
    + "LLKNKOIOHPHRIQKQKW RLMLU RIPLP RMKMTLVKW RJ[MYPXSXUY RLZOYRYTZ RJ[NZQZS[UY RRIQJPLPU RQKQS R"
    + "RIRRQTPU RRITGVFXFZG RWGXGYH RTGVGXIZG RUOWNYLZM[P[TZXX[ RXMYNZPZUYX RWNXNYPYUX[ RUOUY RURYR"
    + " RUUYU\tI\\LHNFQFTGVF ROGSG RLHNGQHTHVF RSKRLQNQOOONPNROQQQQV RRMRT ROPRP RSKSSRUQV RYHWJVMV"
    + "XUZSZOXMXKYI[ RWKWW RRZQZOYLY RYHXJXVWXUZS[P[NZKZI[\tH\\LHNFQFTGVF ROGSG RLHNGQHTHVF RSKRLQN"
    + "QOOONPNROQQQQV RRMRT ROPRP RSKSSRUQV RYHWJVMVXUZ RWKWW RYHXJXVWXUZR[O[LZJXJVKULUMVLWKW RJVMV"
    + "\tF^HHJFMFOGQF RKGNG RHHJGLHOHQF RMKLLKNKOIOHPHRIQKQKW RLMLU RIPLP RMKMTLVKW RJ[MYPXSXUY RLZ"
    + "NYRYTZ RJ[NZQZS[UY RRIQJPLPU RQKQS RRIRRQTPU RRITGVFXFZG RWGXGYH RTGVGXIZG RUOXLYM[N RWMYN[N"
    + " R[NYQWSUU RWSYTZX[Z\\Z RYVZZ RWSXTYZZ[[[\\Z RUOUY\tG]IHKFNFPGRF RLGOG RIHKGMHPHRF RNKMLLNLO"
    + "JOIPIRJQLQLW RMMMU RJPMP RNKNTMVLW RK[NYRXWX[Y RMZPYWYZZ RK[OZVZY[[Y RSIRJQLQU RRKRS RSISRRT"
    + "QU RSIUGWFYF[G RXGYGZH RUGWGYI[G RWGWX\tD`LJKKJMJOHOGPGRHQJQJU RKLKS RHPKP RLJLRKTJU RE[GYIX"
    + "KXMYNYOX RHYKYMZ RE[GZJZL[M[NZOX RLJPFTJTWUYVY RPGSJSXRYSZTYSX RPPSP RNHOHRKROOO ROQRQRXQYS["
    + "VYWX RTJXF\\J\\W]Y^Y RXG[J[X]Z RXP[P RVHWHZKZOWO RWQZQZY\\[^Y ROHOX RWHWX\tE^GIIGKFMFOGQJVUX"
    + "XYY RMGOIPKVWYZ RIGKGMHOKTVVYWZY[ RVHXIZI\\H]F RWGYH[H RVHXFZG\\G]F RKOIOHPHRIQKQ RIPKP RG[I"
    + "YKXNXPY RJYMYOZ RG[JZMZN[PY RKGKX RYIY[ RRLSMUNWNYM RKTMSQSST\tE_NFLGJIIKHNHRIUJWLYNZQ[S[VZX"
    + "YZW[U\\R\\N[KZIXGVFUGRIOJ RJJIMISJV RNFLHKJJMJSKVLXNZ RZV[S[MYIXH RVZXXYVZSZMYKWHUG ROJOW RP"
    + "JPU RQJQTPVOW RUGUZ RUMWNXNZM RUSWRXRZS\tH^KFLGMIMOKOJPJRKQMQMYJ[MZMbO` RMHNJN` RKPNP RKFMGN"
    + "HOJO` ROKRIVFZJZX RVGYJYX RTHUHXKXY RRXUXXY RSYUYWZ RRZTZV[XYZX RRIR_ RRMTNVNXM RRSTRVRXS\tE"
    + "_NFLGJIIKHNHRIUJWLYNZP[T[VZXYZW[U\\R\\N[KZIXGVFUGRIOJ RJJIMISJV RNFLHKJJMJSKVLXNZ RZV[S[MYIX"
    + "H RVZXXYVZSZMYKWHUG ROJOW RPJPU RQJQTPVOW RUGUZ RUMWNXNZM RUSWRXRZS RP[QZRZT[X`Za[a RT\\V_Xa"
    + "Ya RRZS[VaXbZb[a\tF^HHJFMFOGQF RKGNG RHHJGLHOHQF RMKLLKNKOIOHPHRIQKQKW RLMLU RIPLP RMKMTLVKW"
    + " RJ[MYPXRXUY RLZNYRYTZ RJ[NZQZS[UY RRIQJPLPU RQKQS RRIRRQTPU RRIUGWFYGZIZLYNXOTQRR RWGXGYIYM"
    + "XN RUGWHXJXMWOTQ RTQVRWSZX[Y\\Y RWTYX[Z RTQVSXYZ[\\Y\tG^UITHRGOF RVHTG RWGSFOFLGKHJJKLLMONWN"
    + "YOZPZRYU RKKLLOMXMZN[O[QZS RKHKJLKOLYL[M\\O\\QYUU[ RIOJPLQUQVRVSUU RJQLRTRUS RIOIPJRLSSSUTUU"
    + " RI[LYPXSXVY RKZNYRYUZ RI[MZRZU[ RWGUISL RRNPQ ROSMUKVJVJUKV\tE]JJILHOHSIVKYMZP[S[VZXYZW[U R"
    + "ISJVLXNYQZTZWY RJJIMIQJTLWNXQYTYWXYW[U RHIIGKFOFUGYG[F RPGTHXH RHIIHKGNGTIWIYH[F RSIRJPKPV R"
    + "QKQT RRJRSQUPV RWIWX\tF^HHJFLFOGQF RKGNG RHHJGMHOHQF RKJJLIOISJVKXMZP[S[VZXYZ[\\Y RJSKVNYQZT"
    + "Z RKJJNJQKTLVNXQYUYXX RUIQJPLPV RQKQT RRJRSQUPV RUIWHYFZG\\HZIZW[Y\\Y RYIZHYGXHYIYX[Z RWHXIX"
    + "X RUIUY RUNXN RURXR\tG^JFKGLILOJOIPIRJQLQLXJY RLHMJMX RJPMP RNYQYSZ RJFLGMHNJNXRXUY RJYMYPZR"
    + "[UYXXZX RRJUIWHYFZG\\HZIZX RYIZHYGXHYIYW RWHXIXX RRJRX RRMTNVNXM RRSTRVRXS\tE`HFIGJIJOHOGPGR"
    + "HQJQJXHY RJHKJKX RHPKP RLYNYPZ RHFJGKHLJLXOXQY RHYKYNZO[QYTXVYW[YY\\X ROHRFTHTXWXYY RRGSHSX "
    + "ROHQHRIRXQY RWYXZ RWHZF\\H\\X RZG[H[X RWHYHZIZXYY ROHOX RWHWX RONRN RORRR RWNZN RWRZR\tG]HIJ"
    + "GLFNFOGWYXZZZ RMGNHVYWZ RJGLGMHUZV[X[ZZ\\X RWFYG[G\\F RWGXHZH RVHWIYI[H\\F RH[IYKXMXNY RJYLY"
    + "MZ RH[IZKZM[ RWFSO RQRM[ RLPPP RSPXP\tG^JFKGLILOJOIPIRJQLQLXJY RLHMJMX RJPMP RNYQYSZ RJFLGMH"
    + "NJNXRXUY RJYMYPZR[UYXX RRJUIWHYFZG\\HZIZ^Y`WbUaQ`L` RYIZHYGXHYIYY RWHXIXXZ[ RXaV`S` RY`V_P_L"
    + "` RRJRX RRMTNVNXM RRSTRVRXS\tH\\XGWIROOSMWJ[ RVKNV RZFWJUNRRMXLZ RJHLFOGUGZF RKGOHSHWG RJHNI"
    + "RIVHXG RLZNYRXVXZY RMZQYUYYZ RJ[OZUZX[ZY RMPQP RTPXP\tKYOBOb RPBPb ROBVB RObVb\tKYKFY^\tKYTB"
    + "Tb RUBUb RNBUB RNbUb\tG]JTROZT RJTRPZT\tG]Gb]b\tLXPFUL RPFOGUL\tJ[PRNTMVMXNZP[RYUX RMVNXOYQZ"
    + " RNTNVOXQYRY RNPPPSOUNVMXOWPWXXYYY RONNOQO RTOWOVNVYWZ RMOOMPNROUPUYW[YY RMORT\tI[LHMJMXKY R"
    + "NJMHNGNXQZ RLHOFOXQYRZ RKYMYOZP[RZUYWY ROPROTNUMVNXOYOWPWY RTNVOVX RROSOUPUY\tJXNONXLYMYOZP["
    + " ROOOYQZ RPOPXRYSYQZP[ RNORNTMUNWOXO RSNTOVO RPORNTPVPXO\tIZRMPNMOMXKY RNONXQZ RRMOOOXQYRZ R"
    + "KYMYOZP[RZUYWY RMHPFQIWOWY RPINHOGPIVOVX RMHUPUY\tJXNONXLYMYOZP[ ROOOYQZ RPOPXRYSYQZP[ RNORN"
    + "TMWQURPU RSNVQ RPORNUR\tJWNHNXLYMYOZP[ ROHOYQZ RPHPXRYSYQZP[ RNHQGSFTGVHWH RRGSHUH RPHQGSIUI"
    + "WH RKMNM RPMTM\tI[MOMXKYLYNZO[PZRYUX RNPNYPZ ROOOXQYRY RMOOORNTMUNWOYOWPW\\V_TaRbQaO`M` RSNV"
    + "PV\\ RSaQ`P` RRNSOUPUZV]V_ RTaS`Q_O_M`\tI[LHMJMXKYLYNZO[ RNJMHNGNYPZ RLHOFOXQYO[ ROPROTNUMVN"
    + "XOYOWPWYU[T] RTNVOVYU[ RROSOUPUYT]T`UbVbT`\tMWRFPHRITHRF RRGQHSHRG RRMQNOOQPQYS[UY RRPSORNQO"
    + "RPRYSZ RRMSNUOSPSXTYUY\tMWRFPHRITHRF RRGQHSHRG RRMQNOOQPQYS[T] RRPSORNQORPRYS[ RRMSNUOSPSYT]"
    + "T`RbPbPaRb\tIZLHMJMXKYLYNZO[ RNJMHNGNYPZ RLHOFOXQYO[ ROPRNTMVPSROU RSNUP RRNTQ RSRTSVXWYXY R"
    + "SSTTUYVZ RRSSTTYV[XY\tMWPHQJQXOYPYRZS[ RRJQHRGRYTZ RPHSFSXUYVYTZS[\tE_GOHOIPIXGYHYJZK[ RINJO"
    + "JYLZ RGOIMKOKXMYK[ RKPNOPNQMSOSXUYS[ RPNRORYTZ RNOOOQPQXPYRZS[ RSPVOXNYMZN\\O]O[P[X\\Y]Y RXN"
    + "ZOZY[Z RVOWOYPYY[[]Y\tI[KOLOMPMXKYLYNZO[ RMNNONYPZ RKOMMOOOXQYO[ ROPROTNUMVNXOYOWPWXXYYY RTN"
    + "VOVYWZ RROSOUPUYW[YY\tI[MOMXKY RNPNXQZ ROOOXQYRZ RKYMYOZP[RZUYWY RMOOORNTMUNWOYOWPWY RSNVPVX"
    + " RRNSOUPUY\tI[LMMOMXKYMYMb RMNNONaO`N^ RNYOYQZ RLMNNOOOXQYRZ ROZP[RZUYWY ROZO^P`Mb ROPROTNUM"
    + "VNXOYOWPWY RTNVOVX RROSOUPUY\tI[MOMXKY RNPNYPZ ROOOXQYRY RKYLYNZO[PZRYUX RMOOORNTMUNWOYOWPWb"
    + " RSNVPVaU`V^ RRNSOUPU^T`Wb\tJXLOMONPNXLYMYOZP[ RMNOOOYQZ RLONMPOPXRYSYQZP[ RPOTMUNWOXO RSNTO"
    + "VO RRNTPVPXO\tJZMOMSOTUTWUWY RNONS RVUVY RPNOOOSQT RSTUUUYTZ RMOPNRMTNVNWM RQNSN RPNROTOVN R"
    + "WYTZR[PZNZL[ RSZQZ RTZRYOYL[ RWMVOTROWL[\tMWPHQJQXOYPYRZS[ RRJQHRGRYTZ RPHSFSXUYVYTZS[ RNMQM"
    + " RSMVM\tI[KOLOMPMXKY RLNNONYPZ RKOMMOOOXQYRY RKYLYNZO[PZRYUX RUMVNXOYOWPWXXYYY RTNVOVYWZ RUM"
    + "SOUPUYW[YY\tI[LMMOMXP[RYUXWX RMNNONXQZ RLMNNOOOWPXRY RUMVNXOYOWPWX RTNVOVW RUMSOUPUX\tE_HMIO"
    + "IXL[NYQX RINJOJXMZ RHMJNKOKWLXNY RQMOOQPQXT[VYYX[X RPNRORXUZ RQMRNTOSPSWTXVY RYMZN\\O]O[P[X "
    + "RXNZOZW RYMWOYPYX\tH[KOLONPOQSYTZV[XY RMNOOTYVZ RKOMMONPOTWUXWYXY RRSUMVNXNYM RUNVOWO RTOVPX"
    + "OYM RQUN[MZKZJ[ RNZMYLY ROYMXKYJ[ RMTPT RSTVT\tI[KOLOMPMXKY RLNNONYPZ RKOMMOOOXQYRY RKYLYNZO"
    + "[PZRYUX RUMVNXOYOWPW\\V_TaRbQaO`M` RTNVOV\\ RSaQ`P` RUMSOUPUZV]V_ RTaS`Q_O_M`\tI[XML[ RLONPQ"
    + "PTOXM RMNOOSO RLONMPNTNXM RL[PYSXVXXY RQYUYWZ RL[PZTZV[XY RNTVT\tKYTBRCQDPFPHQJRKSMSOQQ RRCQ"
    + "EQGRISJTLTNSPORSTTVTXSZR[Q]Q_Ra RQSSUSWRYQZP\\P^Q`RaTb\tNVRBRb\tKYPBRCSDTFTHSJRKQMQOSQ RRCSE"
    + "SGRIQJPLPNQPURQTPVPXQZR[S]S_Ra RSSQUQWRYSZT\\T^S`RaPb\tF^IUISJPLONOPPTSVTXTZS[Q RISJQLPNPPQT"
    + "TVUXUZT[Q[O",
};
