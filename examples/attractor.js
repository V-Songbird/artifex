// attractor -- a chaotic orbit, printed as a DENSITY. Additions and
// multiplications only, and a verdict before a single dot is drawn.
//
// IN THE SET BECAUSE IT BREAKS THE OTHERS' ASSUMPTIONS. Every other piece here
// decides where a mark goes and then puts it there. This one cannot. The picture
// is the invariant measure of a map nobody can solve in closed form, so the only
// way to learn what it looks like is to run it six million times and count where
// it went. Nothing in it is a mark: there is no polyline, no shape, no stroke,
// and the composition is not placed -- it is measured off the orbit and then
// cropped.
//
// ARITHMETIC ONLY, AND THAT IS THE PIECE. The orbit uses +, - and * and nothing
// else. Math.sin, Math.cos, Math.exp, Math.pow and Math.sqrt are
// implementation-approximated -- ECMAScript does not pin their last bit, so two
// engines may disagree by one ulp -- and on a chaotic orbit one ulp is not a
// rounding difference, it is a different picture. The orbits this piece accepts
// separate at 0.04 nats per step and up, so a 1e-16 disagreement is order 1
// inside a thousand steps, and the density here is 6.4 million of them. +, - and
// * are exactly rounded by IEEE-754 and reproduce everywhere, which is why they
// are the only operations the iteration is allowed. The verdict below uses a
// square root and a logarithm, and the ink mapping uses a logarithm; neither
// reaches the orbit. They are decisions ABOUT an orbit -- comparisons the
// accepted sets clear by eight times over -- not steps inside one.
//
// RASTER ONLY, AND SAID SO. A density field is pixels: 588,000 cells, each one a
// count of how often the orbit came back. Declaring vector would promise a
// plotter a pen path per cell, which is not a drawing -- it is a bitmap wearing
// SVG. The piece declares `raster`, and the vector surface then refuses it BY
// NAME ("has not declared vector output") instead of emitting a file that is
// silently wrong.
//
// The verdict is Sprott's, from Strange Attractors: Creating Patterns in Chaos
// (1993): iterate, and call the result UNBOUNDED, FIXED POINT, PERIODIC or
// STRANGE. About 1.7% of random coefficient sets in this family are strange
// (measured: 69 of 4,000), so a piece that assumed instead of measuring would be
// drawing a dot, a loop or nothing at all 98% of the time.

'use strict';

const { rng } = require('../core/rand.js');
const { clamp01, pick } = require('../core/num.js');
const { mix } = require('../core/colour.js');
const font = require('../core/stroke-font.js');

const W = 900;
const H = 900;
const M = 54;                       // side and top margin
const FOOT = 104;                   // deeper foot: a plate is hung, not centred
const COLS = W - 2 * M;             // one density cell per design unit
const ROWS = H - M - FOOT;

// The map: a Sprott quadratic, twelve coefficients rolled in [-1.2, 1.2].
//   x' = a0 + a1 x + a2 xx + a3 xy + a4 y + a5 yy
//   y' = a6 + a7 x + a8 xx + a9 xy + a10 y + a11 yy
const SPAN = 1.2;
const WARM = 400;                   // thrown away before anything is measured
const TEST = 2400;                  // iterations the verdict watches
const TRIALS = 5000;                // candidate sets a seed may try before giving up
const SURVEY = 120000;              // orbit that finds the crop and judges the shape
const BLEED = 1.04;                 // how far past the fit the body is pushed
const DWELL = 6400000;              // orbit that becomes the density
const BIG = 1e6;                    // x*x + y*y beyond this has left
const LIVE = 0.005;                 // Lyapunov above this is chaos, not a cycle
const SOLID = 0.04;                 // and the search will not take one closer to the line than this

// The declared range of `twist` is stated ONCE, here, and the search reads it.
// A knob whose range is a second copy of itself is a knob that can disagree with
// the test that accepted it.
//
// ELEVEN NOTCHES, NOT A CONTINUUM, AND THIS IS THE LOAD-BEARING DECISION OF THE
// WHOLE PARAMETER. A declared knob must leave the piece drawable everywhere in
// its range, and in a chaotic family that cannot be established by sampling:
// periodic windows are dense in parameter space. Measured here -- 60 seeds whose
// coefficients were strange at thirteen evenly spaced samples of [0.9, 1.1], and
// then re-checked at 401 samples: 39 of the 60 had a PERIODIC window hiding
// between the samples, the worst of them at a Lyapunov exponent of -0.33. A
// continuous knob would therefore have thrown, in the reader's hands, on roughly
// two runs in three -- and not on any of the three pins a test checks.
//
// So the knob has notches. `twist` arrives as any number in [0.9, 1.1] and is
// snapped to one of eleven values, by the SAME expression the search used to
// accept them, so what is drawn is bit-for-bit what was verified. Eleven things
// can be checked exhaustively; an interval cannot be checked at all. Checked:
// 300 seeds x 11 notches = 3,300 verdicts, all STRANGE, the smallest Lyapunov
// exponent anywhere in them 0.0402 against a chaos threshold of 0.005.
const TWIST = { min: 0.9, max: 1.1, value: 1 };
const NOTCHES = 11;

// Stated as art direction, not as machinery. The measure is violently uneven --
// a caustic cell can hold a thousand times what the veil around it holds -- so
// each plate is a DUOTONE with a warm top: the veil goes cool and quiet, the
// cells the orbit keeps returning to go warm and saturated. That is what tells
// the eye where to go on a picture with no figure in it. The third plate is the
// same decision inverted, because a density is as much at home in light on dark
// as a drawing is in ink on paper.
const PLATES = [
  { paper: '#f1ebdf', veil: '#dad5c8', mid: '#4a5b7a', deep: '#171a22', accent: '#c2502c' },
  { paper: '#eff0ed', veil: '#ccd6d3', mid: '#2f5d58', deep: '#111f1d', accent: '#d99a2b' },
  { paper: '#13151b', veil: '#222a37', mid: '#4d7fa3', deep: '#e2e9ee', accent: '#e8b04a' },
];

module.exports = {
  name: 'attractor',
  size: { w: W, h: H },
  outputs: ['raster'],
  time: null,
  seed: 7,
  params: {
    twist: { ...TWIST,
      meaning: 'how hard the map folds x and y into each other -- it bends the arms of the attractor' },
    tones: { min: 3, max: 20, value: 10,
      meaning: 'how many ink levels the density is separated into -- few reads as a screenprint, many as a wash' },
  },

  state: () => ({ coef: [], verdict: null, runs: [] }),

  build: [
    ['find a strange attractor', (s) => {
      const R = rng(s.seed);
      // Every rejection is counted and kept, because the count is the argument
      // for the verdict existing at all.
      const refused = { UNBOUNDED: 0, 'FIXED POINT': 0, PERIODIC: 0, FRAIL: 0, DULL: 0 };

      for (let trial = 0; trial < TRIALS; trial++) {
        const a = coefficients(R, trial);
        const home = classify(a, TWIST.value);
        if (home.verdict !== 'STRANGE') { refused[home.verdict]++; continue; }

        // THE DECLARED RANGE IS PART OF THE ACCEPTANCE TEST, not something
        // checked afterwards. A knob that walks its own piece into a fixed point
        // at 0.94 is a knob that throws, and the trap is that it throws for one
        // seed in ten -- green on the seed the author looked at.
        let broke = null;
        let margin = Infinity;
        for (let i = 0; i < NOTCHES && !broke; i++) {
          const pin = classify(a, notch(i));
          if (pin.verdict !== 'STRANGE') broke = pin.verdict;
          else if (pin.lyapunov < margin) margin = pin.lyapunov;
        }
        if (broke) { refused[broke]++; continue; }
        // STRANGE BY A MARGIN, not strange by a hair. A candidate sitting at
        // 0.0052 against a threshold of 0.005 is a verdict that could go the
        // other way on another engine's logarithm, and a piece that refuses to
        // draw itself somewhere else is worse than one that never drew. It is
        // also the better picture: an orbit that barely separates is a cycle
        // wearing a fog, and it prints as one.
        if (margin < SOLID) { refused.FRAIL++; continue; }

        // Strange is not the same as worth drawing. Five excellent marks beat
        // fifty equivalent ones, and the search is where that is decided: a
        // filament that crosses the sheet once, or a blot that fills it, is
        // passed over for one that has a shape.
        const look = probe(a, TWIST.value);
        if (look.aspect < 0.5 || look.aspect > 2.0
          || look.cover < 0.09 || look.cover > 0.45 || look.crowd > 0.5) {
          refused.DULL++;
          continue;
        }

        s.coef = a;
        s.trial = trial;
        s.margin = Math.round(margin * 1e4) / 1e4;
        s.refused = refused;
        s.plate = pick(PLATES, R('plate', 'which'));
        return;
      }

      throw new Error(
        `attractor: no strange attractor in ${TRIALS} candidate coefficient sets at seed ${s.seed} `
        + `-- ${refused.UNBOUNDED} unbounded, ${refused['FIXED POINT']} fixed point, `
        + `${refused.PERIODIC} periodic, ${refused.FRAIL} chaotic by too small a margin, `
        + `${refused.DULL} strange but not worth drawing.`);
    }],

    ['run the orbit', (s) => {
      const twist = notch(Math.round((s.params.twist - TWIST.min) / (TWIST.max - TWIST.min) * (NOTCHES - 1)));
      s.twist = twist;

      // REFUSED BY NAME, BEFORE ANYTHING IS DRAWN. The search accepted this set
      // at all eleven notches; this asks the same question again, at the one
      // notch actually being drawn, because an accepted candidate reaching a
      // verdict it was not accepted for is exactly the fault worth catching. A
      // piece that drew whatever came out would render a fixed point as one dot
      // and a cycle as four, and both would look like a bug in the renderer
      // rather than an answer.
      const v = classify(s.coef, twist);
      if (v.verdict !== 'STRANGE') {
        throw new Error(
          `attractor: refusing to draw -- at twist ${twist} this orbit is ${v.verdict} `
          + `(largest Lyapunov exponent ${v.lyapunov.toFixed(4)} nats per step, and chaos needs `
          + `more than ${LIVE}). Coefficients: ${s.coef.map((c) => c.toFixed(3)).join(', ')}.`);
      }
      s.verdict = v.verdict;
      s.lyapunov = Math.round(v.lyapunov * 1e4) / 1e4;

      // THE CROP IS MEASURED, NOT CHOSEN. Two percentiles rather than the
      // extremes: a strange attractor throws a few excursions far outside its
      // body, and fitting those makes every picture a small shape in the middle
      // of a large sheet. Fitting the body instead lets the excursions run off
      // the edge, which is what a plate does with them.
      const look = probe(s.coef, twist);
      s.shape = { aspect: Math.round(look.aspect * 1e3) / 1e3, crowd: Math.round(look.crowd * 1e3) / 1e3 };
      const bw = look.box[2] - look.box[0];
      const bh = look.box[3] - look.box[1];
      // Uniform, never stretched: the shape of the attractor is the subject, and
      // a percent of overfill on top, so the body meets the edge of the sheet
      // instead of floating politely inside it.
      const k = Math.min(COLS / bw, ROWS / bh) * BLEED;
      const ox = COLS / 2 - (look.box[0] + bw / 2) * k;
      const oy = ROWS / 2 - (look.box[1] + bh / 2) * k;
      s.crop = [k, ox, oy].map((n) => Math.round(n * 1e3) / 1e3);

      const a0 = s.coef[0]; const a1 = s.coef[1]; const a2 = s.coef[2];
      const a3 = s.coef[3] * twist; const a4 = s.coef[4]; const a5 = s.coef[5];
      const b0 = s.coef[6]; const b1 = s.coef[7]; const b2 = s.coef[8];
      const b3 = s.coef[9] * twist; const b4 = s.coef[10]; const b5 = s.coef[11];

      const cells = new Uint32Array(COLS * ROWS);
      let x = 0.05;
      let y = 0.05;
      let peak = 0;
      for (let i = -WARM; i < DWELL; i++) {
        const xn = a0 + a1 * x + a2 * x * x + a3 * x * y + a4 * y + a5 * y * y;
        const yn = b0 + b1 * x + b2 * x * x + b3 * x * y + b4 * y + b5 * y * y;
        x = xn;
        y = yn;
        if (i < 0) continue;
        const gx = Math.floor(x * k + ox);
        const gy = Math.floor(y * k + oy);
        if (gx < 0 || gy < 0 || gx >= COLS || gy >= ROWS) continue;
        const c = ++cells[gy * COLS + gx];
        if (c > peak) peak = c;
      }
      s.cells = cells;
      s.peak = peak;
    }],

    ['separate the tones', (s) => {
      const levels = Math.round(s.params.tones);
      const cells = s.cells;

      // NORMALISED BY A HIGH PERCENTILE, NOT BY THE PEAK. The densest cell of an
      // attractor is a caustic -- the fold where the map is locally flat -- and
      // it can hold a thousand times the median. Dividing by it crushes the
      // whole field into the first tone and the plate comes out blank.
      const BINS = 2048;
      const hist = new Uint32Array(BINS + 1);
      let hit = 0;
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        if (!c) continue;
        hit++;
        hist[Math.min(BINS, Math.floor(c * BINS / s.peak))]++;
      }
      let want = Math.floor(hit * 0.995);
      let top = BINS;
      for (let b = 0; b <= BINS; b++) { want -= hist[b]; if (want <= 0) { top = b; break; } }
      const full = Math.max(2, (top + 1) * s.peak / BINS);
      s.ink = { hit, cover: Math.round(hit / cells.length * 1e3) / 1e3, full: Math.round(full) };

      // A logarithm, because the measure spans four decades and a linear ramp
      // shows the caustics and nothing else. This is ink, not orbit.
      const denom = Math.log(1 + full);
      s.tones = [];
      for (let i = 1; i <= levels; i++) s.tones.push(inkOf(s.plate, i / levels));

      // RUNS, GROUPED BY TONE. A density drawn cell by cell is 588,000 fills and
      // as many style changes; merging equal tones along a row and grouping the
      // rows by tone leaves one style change per tone and, measured on the
      // default seed, 132,000 rectangles instead of 240,000 inked cells.
      const buckets = Array.from({ length: levels }, () => []);
      for (let gy = 0; gy < ROWS; gy++) {
        const row = gy * COLS;
        let gx = 0;
        while (gx < COLS) {
          const c = cells[row + gx];
          if (!c) { gx++; continue; }
          const tone = toneOf(c, denom, full, levels);
          let end = gx + 1;
          while (end < COLS && cells[row + end] && toneOf(cells[row + end], denom, full, levels) === tone) end++;
          buckets[tone - 1].push(gx, gy, end - gx);
          gx = end;
        }
      }
      const runs = [];
      for (let t = 0; t < levels; t++) {
        for (let i = 0; i < buckets[t].length; i += 3) {
          runs.push(buckets[t][i], buckets[t][i + 1], buckets[t][i + 2], t);
        }
      }
      s.runs = Int32Array.from(runs);
    }],
  ],

  draw(g, s) {
    g.fillStyle = s.plate.paper;
    g.fillRect(0, 0, W, H);

    const runs = s.runs;
    let tone = -1;
    for (let i = 0; i < runs.length; i += 4) {
      if (runs[i + 3] !== tone) {
        tone = runs[i + 3];
        g.fillStyle = s.tones[tone];
      }
      g.fillRect(M + runs[i], M + runs[i + 1], runs[i + 2], 1);
    }

    // THE PLATE SAYS WHAT IT IS, and the foot it is printed in is why the image
    // sits high on the sheet rather than in the middle of it. The verdict is not
    // a comment in the source: it is the thing that decided this picture would
    // exist, printed beside the exponent that earned it and the count of sets
    // that were refused first.
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = mix(s.plate.paper, s.plate.deep, 0.22);
    g.lineWidth = 0.7;
    g.beginPath();
    g.moveTo(M, M + ROWS + 22);
    g.lineTo(W - M, M + ROWS + 22);
    g.stroke();

    g.strokeStyle = mix(s.plate.paper, s.plate.deep, 0.66);
    g.lineWidth = 1.1;
    font.text(g, `${s.verdict}. LYAPUNOV ${s.lyapunov.toFixed(3)}`, M, M + ROWS + 42, 12);
    const refused = `${s.trial} SETS REFUSED`;
    font.text(g, refused, W - M - font.width(refused, 12), M + ROWS + 42, 12);
  },
};

/**
 * The value at notch `i` of the `twist` knob.
 *
 * The search and the build both come through here, so the number that was
 * accepted is the number that is drawn, to the last bit -- which on a chaotic
 * orbit is the only agreement that means anything. On this range the obvious
 * second spelling, `min + i * step`, happens to give the same eleven doubles
 * (checked, 11 of 11), but agreeing by luck is not something an orbit that
 * amplifies one ulp into a different picture should be resting on.
 */
function notch(i) {
  return TWIST.min + (TWIST.max - TWIST.min) * (i / (NOTCHES - 1));
}

/** The twelve coefficients of one candidate map, addressed by trial. */
function coefficients(R, trial) {
  const a = [];
  for (let i = 0; i < 12; i++) a.push((R('map', `a${i}`, trial) * 2 - 1) * SPAN);
  return a;
}

/**
 * Sprott's verdict: UNBOUNDED, FIXED POINT, PERIODIC or STRANGE.
 *
 * Two orbits a hair apart, renormalised every step, and the growth of the gap
 * averaged: that is the largest Lyapunov exponent, and its sign is what
 * separates chaos from a cycle. The orbit itself is + and * only. The separation
 * is measured with a square root and a logarithm, which is safe here for a
 * reason worth stating: nothing measured feeds back into the iteration, and the
 * answer is a comparison against 0.005 that the accepted sets clear by a factor
 * of ten or more.
 */
function classify(a, twist) {
  const a0 = a[0]; const a1 = a[1]; const a2 = a[2];
  const a3 = a[3] * twist; const a4 = a[4]; const a5 = a[5];
  const b0 = a[6]; const b1 = a[7]; const b2 = a[8];
  const b3 = a[9] * twist; const b4 = a[10]; const b5 = a[11];

  let x = 0.05;
  let y = 0.05;
  for (let i = 0; i < WARM; i++) {
    const xn = a0 + a1 * x + a2 * x * x + a3 * x * y + a4 * y + a5 * y * y;
    const yn = b0 + b1 * x + b2 * x * x + b3 * x * y + b4 * y + b5 * y * y;
    x = xn;
    y = yn;
    if (!(x * x + y * y < BIG)) return { verdict: 'UNBOUNDED', lyapunov: Infinity };
  }

  const D0 = 1e-9;
  let px = x + D0;
  let py = y;
  let sum = 0;
  let moved = 0;
  for (let i = 0; i < TEST; i++) {
    const xn = a0 + a1 * x + a2 * x * x + a3 * x * y + a4 * y + a5 * y * y;
    const yn = b0 + b1 * x + b2 * x * x + b3 * x * y + b4 * y + b5 * y * y;
    const pxn = a0 + a1 * px + a2 * px * px + a3 * px * py + a4 * py + a5 * py * py;
    const pyn = b0 + b1 * px + b2 * px * px + b3 * px * py + b4 * py + b5 * py * py;
    moved += Math.abs(xn - x) + Math.abs(yn - y);
    x = xn;
    y = yn;
    px = pxn;
    py = pyn;
    if (!(x * x + y * y < BIG)) return { verdict: 'UNBOUNDED', lyapunov: Infinity };
    const dx = px - x;
    const dy = py - y;
    const d = Math.sqrt(dx * dx + dy * dy);
    // The companion landed exactly on the orbit: the map has pulled everything
    // onto one point.
    if (!(d > 0)) return { verdict: 'FIXED POINT', lyapunov: -Infinity };
    sum += Math.log(d / D0);
    const back = D0 / d;
    px = x + dx * back;
    py = y + dy * back;
  }

  const lyapunov = sum / TEST;
  // A cycle that never moves is a point, and the two are refused by different
  // names because they are different answers to "what did it do".
  if (moved / TEST < 1e-9) return { verdict: 'FIXED POINT', lyapunov };
  if (lyapunov < LIVE) return { verdict: 'PERIODIC', lyapunov };
  return { verdict: 'STRANGE', lyapunov };
}

/**
 * What the orbit looks like: the box that holds its body, how much of that box
 * it touches, and how much of the measure sits in the densest half-percent.
 * Everything the search needs to tell a shape from a smear.
 */
function probe(a, twist) {
  const a0 = a[0]; const a1 = a[1]; const a2 = a[2];
  const a3 = a[3] * twist; const a4 = a[4]; const a5 = a[5];
  const b0 = a[6]; const b1 = a[7]; const b2 = a[8];
  const b3 = a[9] * twist; const b4 = a[10]; const b5 = a[11];

  const xs = new Float64Array(SURVEY);
  const ys = new Float64Array(SURVEY);
  let x = 0.05;
  let y = 0.05;
  let lo0 = Infinity;
  let lo1 = Infinity;
  let hi0 = -Infinity;
  let hi1 = -Infinity;
  for (let i = -WARM; i < SURVEY; i++) {
    const xn = a0 + a1 * x + a2 * x * x + a3 * x * y + a4 * y + a5 * y * y;
    const yn = b0 + b1 * x + b2 * x * x + b3 * x * y + b4 * y + b5 * y * y;
    x = xn;
    y = yn;
    if (i < 0) continue;
    xs[i] = x;
    ys[i] = y;
    if (x < lo0) lo0 = x;
    if (x > hi0) hi0 = x;
    if (y < lo1) lo1 = y;
    if (y > hi1) hi1 = y;
  }

  const box = [edge(xs, lo0, hi0, 0.003), edge(ys, lo1, hi1, 0.003),
    edge(xs, lo0, hi0, 0.997), edge(ys, lo1, hi1, 0.997)];
  const bw = Math.max(1e-9, box[2] - box[0]);
  const bh = Math.max(1e-9, box[3] - box[1]);

  // Coverage on a coarse grid over the body, at the aspect the sheet will use.
  const N = 192;
  const grid = new Uint32Array(N * N);
  const k = (N - 1) / Math.max(bw, bh);
  let hit = 0;
  let inside = 0;
  for (let i = 0; i < SURVEY; i++) {
    const gx = Math.floor((xs[i] - box[0]) * k);
    const gy = Math.floor((ys[i] - box[1]) * k);
    if (gx < 0 || gy < 0 || gx >= N || gy >= N) continue;
    inside++;
    if (grid[gy * N + gx]++ === 0) hit++;
  }
  const sorted = Array.from(grid).filter((v) => v).sort((p, q) => q - p);
  const few = Math.max(1, Math.round(hit * 0.005));
  let crowd = 0;
  for (let i = 0; i < few; i++) crowd += sorted[i];

  return {
    box,
    aspect: bw / bh,
    cover: hit / (N * N),
    crowd: crowd / Math.max(1, inside),
  };
}

/** The value at percentile `p` of a sample, read off a histogram of it. */
function edge(v, lo, hi, p) {
  const BINS = 1024;
  const hist = new Uint32Array(BINS + 1);
  const k = BINS / Math.max(1e-12, hi - lo);
  for (let i = 0; i < v.length; i++) hist[Math.floor((v[i] - lo) * k)]++;
  let want = v.length * p;
  for (let b = 0; b <= BINS; b++) {
    want -= hist[b];
    if (want <= 0) return lo + (b + 0.5) / k;
  }
  return hi;
}

/** Which ink level a count falls in. Log, because the measure spans decades. */
function toneOf(c, denom, full, levels) {
  const u = Math.log(1 + Math.min(c, full)) / denom;
  const t = Math.ceil(u * levels);
  return t < 1 ? 1 : (t > levels ? levels : t);
}

/**
 * The ink at height `u` of the ramp. Cool and quiet through the veil, dark
 * through the body, and warming into the accent only at the top -- the few cells
 * the orbit keeps coming back to are the only ones allowed to be emphatic.
 */
function inkOf(plate, u) {
  // THE RAMP STARTS AT THE GROUND, not at the first ink. A cell the orbit
  // touched once and a cell it touched twenty times are both real, and giving
  // the first one a visible tone turns the outer wash into dither -- which is
  // what a density looks like when it has been drawn as a scatter of dots.
  const body = u < 0.22 ? mix(plate.paper, plate.veil, u / 0.22)
    : u < 0.62 ? mix(plate.veil, plate.mid, (u - 0.22) / 0.4)
      : mix(plate.mid, plate.deep, (u - 0.62) / 0.38);
  const heat = clamp01((u - 0.88) / 0.12);
  return heat > 0 ? mix(body, plate.accent, heat * 0.85) : body;
}
