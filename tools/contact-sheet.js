#!/usr/bin/env node
'use strict';

// Compare seeds or declared parameter ranges on one self-contained page.
//
// Compare multiple seeds to inspect compositional variation and robustness.
// Automated checks do not establish whether each composition reads clearly.
//
// It renders live on canvases rather than writing SVG, so it works for a piece
// that declares raster only -- which is exactly the piece you cannot otherwise
// look at outside a browser.
//
//   npm run seeds                 every example, nine seeds each
//   npm run seeds drift           one piece
//   npm run seeds drift 16 0.5    sixteen seeds, at a playhead of 0.5
//   npm run seeds -- drift 5 --param reach       five values, fixed seed
//   npm run seeds -- drift 3 --param reach,turn  a three-by-three grid
//   npm run seeds -- drift 9 0.5 --png            also a PNG of the sheet, from installed Edge
//   npm run seeds -- drift 9 0.5 --json           also print window.__sheet as JSON, from installed Edge
//   npm run seeds -- refit 9 1 --box 405x720      at another box the piece declares
//   npm run seeds -- refit --frames 9 --reframe 0:1280x720,1:405x720   along another box timeline
//   npm run seeds -- readout --frames 9           a time strip: nine frames across the timeline
//   npm run seeds -- readout --at 0.5,2,3.25 --loupe   chosen seconds, each with a 100% crop
//   npm run seeds -- readout --at 2,4 --values --grey --colour-vision   under each frame its value, grey and colour-vision views
//   npm run seeds -- specimen --at 0 --gamut FOGRA39L.txt --json   under the still its print-gamut view, and the share of pixels outside an approximate coated-paper gamut, from Fogra's data you download
//   npm run seeds -- readout --frames 9 --seed 7  the same strip at seed 7, as out/readout-frames-seed7.html
//   npm run seeds -- cues --shots                 each shot's first, middle and last frame, from state.cues.shots
//   npm run seeds -- ./my-film.cjs --shots --cuts   also each cut's two frames blended, its focus ringed, and every eye track on one frame
//   npm run seeds -- stride --contacts falls --loupe   two frames before to three after each contact in state.falls, a 100% crop on each
//   npm run seeds -- readout --at 2 --loupe --reference photo.webp@512,300 --reference-scale 0.5   beside a cut of a photo, with each crop's style gap from it
//   npm run seeds -- tests/fixtures/touching-film.cjs --at 0,0.125 --part red=#f00 --json   how much of the red square later marks cover on each frame
//   npm run seeds -- ./my-film.cjs --at 0,1,2 --figure body=#b07a5a+#2a2320 --png   under each frame the flat fill of the figure painted in those colours
//   npm run seeds -- ./my-film.cjs --frames 9 --armature   beside each frame the same frame with its state.cues.armature joints, bone axes and sections drawn over it, and its joint faults printed
//   npm run seeds -- ./my-film.cjs --frames 12 --two-values 0.12,0.88 --json   the share of each frame's pixels between two declared values
//   npm run seeds -- --compare out/drift.png ref.png --threshold 24   a render against a reference of its size, pixel by pixel, in Node
//   npm run seeds -- ./my-film.cjs --plan        the film's view on every frame over the place, its beats ringed
//
// In Node, recordMarks, paintOrder and layerSwaps read a frame's paint order:
// the frames where one named thing is painted in front of another in some
// places and behind it in others, or changes side between frames. A time
// strip's --part reads, on each drawn frame, how much of a named part marks
// drawn after it cover (partCover); its --figure fills the marks painted in a
// figure's colours as one flat silhouette and reports its gaps, holes, widths,
// widest single runs and plumb line over its base (figureFill, silhouette).
// Its --armature reads the posed chains a piece keeps per frame (armatureList)
// and names their joint faults across the film (jointFaults).

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { bundle, checkParses } = require('./build-page.js');
const { captureSheet, writePieces, removeGoneSections, timeoutArg, withEdge, evaluate, evaluateInPieces, waitFor, pageErrors, SHEET_PROGRESS } = require('./check-browser.js');
const EXAMPLES = require('../examples/index.js');
const { validate, atBox, parseReframe, solve } = require('../core/piece.js');
const { playheads, drawFrame } = require('../core/render.js');
const { VectorSurface } = require('../core/surface-vector.js');
const { filmScale } = require('../core/film.js');
const { project } = require('../core/armature.js');
const { callerDirectory, isPiecePath, loadExternal, shown, outputDirectory, hint } = require('./piece-input.js');
const { pieceHint, styleCause } = require('./styles.js');
const { decodePng } = require('./measure-reference.js');

function planSheet(p, count, paramNames = [], seeds = null) {
  if (seeds && paramNames.length !== 1) throw refuse(SEEDS_NEED_ONE_PARAM);
  if (!Number.isSafeInteger(count) || count < (paramNames.length ? 2 : 1)) {
    throw refuse(`count must be an integer >= ${paramNames.length ? 2 : 1}`);
  }
  if (paramNames.length > 2 || new Set(paramNames).size !== paramNames.length) {
    throw refuse('--param needs one or two distinct parameter names');
  }
  for (const key of paramNames) {
    if (!Object.hasOwn(p.params, key)) {
      throw refuse(`unknown parameter "${key}" for ${p.name}. Declared: ${Object.keys(p.params).join(', ') || '(none)'}. --param names one or two of them to sweep from their min to their max`);
    }
  }
  // Every sample whose (max - min) * index stays within 2^53 multiplies before
  // dividing. That makes a sample that falls on a whole value exactly that value
  // when min and max are whole numbers within 2^53 and (max - min) * (count - 1)
  // stays under 2^53: 0..22 at 23 samples gives 15 at index 15, where a lerp
  // gives 14.999999999999998. Only a larger span takes the lerp, which stays
  // finite and promises nothing about whole values.
  const sample = (key, index) => {
    const { min, max } = p.params[key];
    if (index === 0) return min;
    if (index === count - 1) return max;
    const step = (max - min) * index;
    if (Math.abs(step) <= Number.MAX_SAFE_INTEGER) return min + step / (count - 1);
    const u = index / (count - 1);
    return min * (1 - u) + max * u;
  };
  const rows = seeds ? seeds.length : paramNames.length === 2 ? count : 1;
  const cells = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < count; x++) {
      const params = Object.fromEntries(paramNames.map((key, axis) => [key, sample(key, axis ? y : x)]));
      cells.push({ seed: seeds ? seeds[y] : paramNames.length ? p.seed : x + 1, params });
    }
  }
  return cells;
}

// The labels a --param sheet shows for one parameter's sampled values, a sweep
// in `count` steps: each rounded to three digits past the step's leading digit,
// so samples a step apart keep distinct labels, and to as many decimals as
// either end declares, but never past 12 significant digits of the larger end,
// where only the sample's float residue lies; a residue at zero reads 0. The
// values handed to the piece are not changed.
function sweepLabels(values, count) {
  const min = Math.min(...values), max = Math.max(...values);
  const step = (max - min) / Math.max(1, count - 1), big = Math.max(Math.abs(min), Math.abs(max));
  const decimals = (x) => { let d = 0; while (d < 100 && +x.toFixed(d) !== +x.toPrecision(12)) d++; return d; };
  const want = Math.max(step > 0 ? 3 - Math.floor(Math.log10(step)) : 0, decimals(min), decimals(max));
  const d = Math.max(0, Math.min(100, want, big > 0 ? 11 - Math.floor(Math.log10(big)) : 100));
  return values.map((v) => String(+v.toFixed(d) || 0));
}

// Final nontransparent pixels, including painted backgrounds. This is a
// raster bounding box, not foreground segmentation or an aesthetic score.
function pixelBounds({ data, width, height }) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!data[(y * width + x) * 4 + 3]) continue;
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
  }
  const bbox = right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
  return { bbox, coverage: bbox ? bbox.width * bbox.height / (width * height) : 0 };
}

// A strip frame's detail: its luma, over the sheet's white, averaged in square
// blocks about 1/80 of the cell's width, 8 pixels at 640, so the grid and the
// flags' thresholds hold at any --scale, then the mean step between
// neighbouring blocks, from 0 to 255. Averaging first keeps grain and fine
// hatching with no subject from passing for detail. `luma` keeps the same
// luma in squares of one pixel up to about 960 pixels wide and about 1/640 of
// the cell's width above that, with the block's side in them, for judging a
// hold (see stripFlags).
function frameDetail({ data, width, height }) {
  const B = Math.max(1, Math.round(width / 80)), w = Math.max(1, Math.floor(width / B)), h = Math.max(1, Math.floor(height / B));
  const F = Math.max(1, Math.round(width / 640)), lw = Math.floor(width / F), lh = Math.max(1, Math.floor(height / F));
  const sum = new Float64Array(w * h), count = new Float64Array(w * h), fine = new Float64Array(lw * lh);
  for (let y = 0; y < height; y++) {
    const row = Math.min(h - 1, Math.floor(y / B)) * w, fineRow = Math.min(lh - 1, Math.floor(y / F)) * lw;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4, a = data[i + 3] / 255;
      const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      const cell = row + Math.min(w - 1, Math.floor(x / B)), value = 255 - a * (255 - luma);
      sum[cell] += value;
      count[cell]++;
      if (x < lw * F && y < lh * F) fine[fineRow + Math.floor(x / F)] += value / (F * F);
    }
  }
  const grid = Array.from(sum, (v, i) => v / count[i]);
  let steps = 0, total = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = grid[y * w + x];
      if (x + 1 < w) { total += Math.abs(grid[y * w + x + 1] - v); steps++; }
      if (y + 1 < h) { total += Math.abs(grid[(y + 1) * w + x] - v); steps++; }
    }
  }
  return { detail: steps ? total / steps : 0, grid, cols: w, rows: h, side: B, luma: { w: lw, h: lh, data: Uint8ClampedArray.from(fine), block: Math.max(1, Math.round(B / F)) } };
}

// --cuts, in the page: the strongest edge of frameDetail result `d` among the
// blocks whose centre lies within `radius` of `at` and farther than `radius`
// from `away` (null for none), all in cell pixels. A block's step is the
// larger luma step to its right and lower neighbours. Returns { step, x, y },
// the block's centre, or null when no block is in the ring.
function strayEdge(d, at, away, radius) {
  const { grid, cols, rows, side } = d;
  let best = null;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const cx = (x + 0.5) * side, cy = (y + 0.5) * side, v = grid[y * cols + x];
      if (Math.hypot(cx - at[0], cy - at[1]) > radius || (away && Math.hypot(cx - away[0], cy - away[1]) <= radius)) continue;
      const step = Math.max(x + 1 < cols ? Math.abs(grid[y * cols + x + 1] - v) : 0, y + 1 < rows ? Math.abs(grid[(y + 1) * cols + x] - v) : 0);
      if (!best || step > best.step) best = { step, x: cx, y: cy };
    }
  }
  return best;
}

// --cuts, in the page: the share of frameDetail result `d`'s mass in the left
// half of the frame, each block weighted by its luma's distance from the
// median block, the ground; a centre column counts half to each side. Rounded
// to 3 decimals; null on a flat frame.
function massShare(d) {
  const ground = Float64Array.from(d.grid).sort()[d.grid.length >> 1], half = (d.cols - 1) / 2;
  let left = 0, total = 0;
  d.grid.forEach((v, i) => {
    const x = i % d.cols, weight = Math.abs(v - ground);
    total += weight;
    left += x < half ? weight : x === half ? weight / 2 : 0;
  });
  return total ? +(left / total).toFixed(3) : null;
}

// A strip cell's lit area, in the page: the centre { x, y }, in cell pixels,
// of frameDetail result `d`'s luma above the median block, the ground, each
// block weighted by its rise, and `level`, the mean rise over all blocks, 0 to
// 255. A uniform brightening and a whole-frame gain move the ground with the
// frame, so the centre holds still under drift and flicker. It follows a lit
// area smaller than half the frame: above that the median is the lit level.
// Null when no block rises above the ground (a flat or white frame).
function litArea(d) {
  const ground = Float64Array.from(d.grid).sort()[d.grid.length >> 1];
  let x = 0, y = 0, total = 0;
  d.grid.forEach((v, i) => {
    const w = v > ground ? v - ground : 0;
    total += w;
    x += w * (i % d.cols + 0.5);
    y += w * (Math.floor(i / d.cols) + 0.5);
  });
  return total ? { x: x / total * d.side, y: y / total * d.side, level: total / d.grid.length } : null;
}

/**
 * The views --values, --grey, --colour-vision and --gamut add under a cell, from its
 * RGBA image `{ data, width, height }`, each pixel laid over white as the sheet
 * shows it. Each view is an opaque image of the cell's size, or null when
 * `views` did not ask for it.
 *
 * - `grey`: each pixel the grey of its OKLab lightness L, sRGB(L^3), as greyOf
 *   in skills/artifex/reference/stills.md builds it.
 * - `values`: L blurred by three box passes each way of half-width `radius`,
 *   2% of the width (about a Gaussian of that standard deviation), then cut at
 *   L 1/3 and 2/3 into 3 levels painted as the greys of L 1/6, 1/2 and 5/6.
 *   `peak` is the pixel `{ x, y }` with the largest step of blurred L across
 *   `radius` each way, hypot(B(x+r) - B(x-r), B(y+r) - B(y-r)) / 2, the first
 *   in reading order on a tie, with that `contrast`; null on a flat image.
 * - `deuteranopia`, `protanopia`, `tritanopia`: dichromat simulations with the
 *   severity-1.0 matrices of Machado, Oliveira and Fernandes, "A Physiologically-
 *   based Model for Simulation of Color Vision Deficiency", IEEE TVCG 15(6), 2009,
 *   as published at https://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html,
 *   applied to linear RGB.
 * - `gamut`: each pixel outside an approximate print gamut painted #ff00ff, every
 *   other pixel its grey. `views.gamut` holds the patches printData reads from
 *   characterization data such as Fogra's FOGRA39L (offset printing on coated
 *   paper, ISO 12647-2 paper type 1 or 2): the CIELAB (D50) 10, 20, 40, 70 and
 *   100% tints of the six chromatic solids in `faces`, with its paper and its
 *   C, M and K 100% patch as black, taken to XYZ D50, mapped by
 *   black-point compensation linear in XYZ, (XYZ - Yk W) / (Yp - Yk) with W the
 *   D50 white and Yp, Yk the Y of paper and black, so paper becomes white and
 *   black black, then through Lindbloom's Bradford-adapted matrix to linear sRGB
 *   and on to OKLab. With them, the data's two-ink patches between those tints
 *   (`faces`) and the solids with 20 and 40% black (`blacks`) form rings around
 *   grey: one per coverage through the inks, overprints and two-ink patches at
 *   that coverage, then one per black level through the solids. Neighbouring
 *   patches of a ring are mixed in linear light, the halftones of Neugebauer's
 *   model. At each of 720 hues the edge is white, each ring where it reaches that
 *   hue, black. A pixel under the edge at its nearest hue is inside; above it,
 *   its distance to the gamut is the smallest OKLab distance to that edge or to
 *   the edges of nearby hues, and a pixel more than 0.02 away (the just-noticeable
 *   difference CSS Color 4 uses in gamut mapping) is outside. `outside` is
 *   `{ share, excess }`: the share of pixels outside and the largest distance an
 *   outside pixel has to the gamut, 0 when none is; null on an empty image.
 * `lightness` is the mean, min and max of L over the cell, their `range`,
 * max - min, and `p5` and `p95`, the 5th and 95th percentiles of L by nearest
 * rank, read from a 1024-bin histogram as the mean L of the bin that holds the
 * rank, so within 1/1024 of the exact value; each rounded to 4 decimals, as
 * are `contrast`.
 * `chroma` is the mean and max of OKLCh chroma C over the cell, `p50` and `p95`
 * by nearest rank from a 1024-bin histogram over [0, 0.4), so within 0.4/1024
 * (about 0.0004), and `high`, the share of pixels with C over 0.1; each rounded
 * to 4 decimals; and `areas`, the number of areas, grown as `saturated` grows
 * them, whose seed block's mean C, rounded to 4 decimals as a listed area's
 * `chroma` is, is over 0.1, listed or not: when it is larger than the listed
 * areas over 0.1, some such areas are not listed. `samples`, null unless
 * `views.samples` lists pixels [x, y], holds for each the mean OKLab of the
 * pixels within one pixel of it (a 3 x 3 square, clipped to the image), each
 * over white: `{ L, a, b, C, h }`, 4 decimals, and the hue of the mean a and b
 * in degrees, 0 to 360, 1 decimal, null when C rounds to 0. `saturated` lists the most saturated areas, at most 3, found
 * over blocks of B = max(1, round(width / 64)) pixels a side (edge blocks
 * smaller, averaged over their own pixels), most saturated first: each from the
 * unused block of highest mean C, while that is at least 0.03, grown over
 * 8-connected unused blocks of mean C at least 0.03 within 30 degrees of that
 * block's hue, through blocks of at least 0.7 times the C of the block they
 * touch, plus the blocks of that hue that touch the area and fail the 0.7 step.
 * Each area is `{ x, y, w, h, share, chroma, hue }`: the top-left pixel and
 * pixel size of its blocks' bounding box, clipped to the image, so up to one
 * block past the form on a side; its share of the cell's pixels and the mean C
 * of its most saturated block, 4 decimals; and the hue of its mean OKLab a and
 * b, 0 to 360 degrees, 1 decimal. The page converts x, y, w and h to design
 * units. Both are null on an empty image.
 * Only when `views.twoValues` is [dark, light] (OKLCh L) does the result hold
 * `between`: the share of pixels, over white, whose L is more than 0.05 from
 * both, 4 decimals, null on an empty image.
 */
function cellViews({ data, width, height }, views) {
  // Local names for the globals the per-pixel loops read: a global read in a vm context, as the page's tests run
  // this inlined copy, cost 8 to 18 times the work in Node or Edge.
  const { Math, Infinity } = globalThis;
  const n = width * height, L = new Float64Array(n), ab = views.gamut ? new Float64Array(n * 2) : null, lin = views.colourVision ? new Float64Array(n * 3) : null;
  const linear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  // Linear sRGB to OKLab, with Björn Ottosson's matrices, written into `o`.
  const oklab = (r, g, b, o = [0, 0, 0]) => {
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    o[0] = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s; o[1] = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s; o[2] = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
    return o;
  };
  const lab = [0, 0, 0];
  const byte = (c) => Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
  const greyOf = (l) => byte(Math.pow(Math.max(0, Math.min(1, l)), 3));
  const round = (v) => +v.toFixed(4);
  // A histogram of L in 1024 bins, each holding its count and its sum, for percentiles without a sort.
  const bins = 1024, hist = new Uint32Array(bins), histSum = new Float64Array(bins);
  // The same for OKLCh chroma C over [0, 0.4), past sRGB's largest C of about 0.32; and per block of `blk` pixels a
  // side, the pixel count and the sums of C, a and b, for the most saturated areas.
  const cRange = 0.4, cHist = new Uint32Array(bins), cHistSum = new Float64Array(bins);
  const blk = Math.max(1, Math.round(width / 64)), bw = Math.ceil(width / blk), bh = Math.ceil(height / blk);
  const bCount = new Uint32Array(bw * bh), bC = new Float64Array(bw * bh), bA = new Float64Array(bw * bh), bB = new Float64Array(bw * bh);
  let sum = 0, lo = Infinity, hi = -Infinity, sumC = 0, maxC = 0, high = 0;
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3] / 255;
    const r = linear(1 - a * (1 - data[i * 4] / 255)), g = linear(1 - a * (1 - data[i * 4 + 1] / 255)), b = linear(1 - a * (1 - data[i * 4 + 2] / 255));
    if (lin) { lin[i * 3] = r; lin[i * 3 + 1] = g; lin[i * 3 + 2] = b; }
    oklab(r, g, b, lab);
    L[i] = lab[0];
    if (ab) { ab[i * 2] = lab[1]; ab[i * 2 + 1] = lab[2]; }
    sum += L[i]; lo = Math.min(lo, L[i]); hi = Math.max(hi, L[i]);
    const k = Math.max(0, Math.min(bins - 1, Math.floor(L[i] * bins)));
    hist[k]++; histSum[k] += L[i];
    const C = Math.hypot(lab[1], lab[2]), q = Math.min(bins - 1, Math.floor((C / cRange) * bins)), j = Math.floor(i / width / blk) * bw + Math.floor((i % width) / blk);
    cHist[q]++; cHistSum[q] += C; sumC += C; maxC = Math.max(maxC, C);
    if (C > 0.1) high++;
    bCount[j]++; bC[j] += C; bA[j] += lab[1]; bB[j] += lab[2];
  }
  // bC now holds each block's mean C; every block holds a pixel, as bw and bh round up.
  for (let j = 0; j < bC.length; j++) bC[j] /= bCount[j];
  // The p-quantile by nearest rank: the mean value of the bin holding the ceil(p n)-th lowest pixel, of L by default.
  const quantile = (p, h = hist, hs = histSum) => {
    let k = 0, seen = h[0];
    for (const rank = Math.max(1, Math.ceil(p * n)); seen < rank;) seen += h[++k];
    return hs[k] / h[k];
  };
  // The most saturated areas, at most 3, each seeded at the unused block of highest mean C (the first in reading order
  // on a tie) while that is at least 0.03, so they come most saturated first. An area grows over unused blocks touching
  // it on a side or a corner (so a thin diagonal stroke stays whole), of mean C at least 0.03, whose mean a, b lies
  // within 30 degrees of the seed's hue: through a block whose C is at least 0.7 times the C of the area block it
  // touches, so a gradient, taper or soft edge stays one area while a step down to a paler ground stops it; any other
  // such block, a form's partly covered edge, joins without growing further. Past the third area the search goes on
  // only to count the areas whose seed's C, rounded to 4 decimals as a listed area's chroma is, is over 0.1, in `areas`.
  const saturated = [], used = new Uint8Array(bw * bh), edge = [], stack = [];
  const order = Uint32Array.from({ length: bw * bh }, (_, j) => j).sort((a, b) => bC[b] - bC[a] || a - b);
  let areas = 0, p = 0;
  while (n) {
    while (p < order.length && used[order[p]]) p++;
    const seed = p < order.length ? order[p] : -1;
    if (seed < 0 || bC[seed] < 0.03 || (saturated.length === 3 && round(bC[seed]) <= 0.1)) break;
    const sameHue = (j) => bA[j] * bA[seed] + bB[j] * bB[seed] > 0.866 * Math.hypot(bA[j], bB[j]) * Math.hypot(bA[seed], bB[seed]);
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, count = 0, sa = 0, sb = 0;
    const add = (j) => {
      const x = j % bw, y = (j - x) / bw;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      count += bCount[j]; sa += bA[j]; sb += bB[j];
    };
    used[seed] = 1; stack.push(seed); edge.length = 0;
    while (stack.length) {
      const j = stack.pop(), x = j % bw, y = (j - x) / bw;
      add(j);
      for (let ny = Math.max(0, y - 1); ny <= Math.min(bh - 1, y + 1); ny++) for (let nx = Math.max(0, x - 1); nx <= Math.min(bw - 1, x + 1); nx++) {
        const nb = ny * bw + nx;
        if (used[nb] || bC[nb] < 0.03 || !sameHue(nb)) continue;
        if (bC[nb] >= 0.7 * bC[j]) { used[nb] = 1; stack.push(nb); } else edge.push(nb);
      }
    }
    for (const j of edge) if (!used[j]) { used[j] = 1; add(j); }
    if (round(bC[seed]) > 0.1) areas++;
    if (saturated.length === 3) continue;
    const hue = (Math.atan2(sb, sa) * 180) / Math.PI;
    saturated.push({ x: x0 * blk, y: y0 * blk, w: Math.min(width, (x1 + 1) * blk) - x0 * blk, h: Math.min(height, (y1 + 1) * blk) - y0 * blk,
      share: round(count / n), chroma: round(bC[seed]), hue: +(hue < 0 ? hue + 360 : hue).toFixed(1) });
  }
  // Each sample pixel [px, py]: the mean OKLab of the pixels within one pixel of it, clipped to the image, each laid
  // over white as above; `|| 0` keeps a rounded -0 out.
  const samples = views.samples ? views.samples.map(([px, py]) => {
    let sl = 0, sa = 0, sb = 0, count = 0;
    for (let y = Math.max(0, py - 1); y <= Math.min(height - 1, py + 1); y++) for (let x = Math.max(0, px - 1); x <= Math.min(width - 1, px + 1); x++) {
      const o = (y * width + x) * 4, a = data[o + 3] / 255;
      oklab(linear(1 - a * (1 - data[o] / 255)), linear(1 - a * (1 - data[o + 1] / 255)), linear(1 - a * (1 - data[o + 2] / 255)), lab);
      sl += lab[0]; sa += lab[1]; sb += lab[2]; count++;
    }
    const C = round(Math.hypot(sa, sb) / count), hue = (Math.atan2(sb, sa) * 180) / Math.PI;
    return { L: round(sl / count) || 0, a: round(sa / count) || 0, b: round(sb / count) || 0, C, h: C ? +(hue < 0 ? hue + 360 : hue).toFixed(1) : null };
  }) : null;
  const image = (paint) => {
    const out = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) { paint(i, out, i * 4); out[i * 4 + 3] = 255; }
    return { width, height, data: out };
  };
  const result = { values: null, grey: null, deuteranopia: null, protanopia: null, tritanopia: null, gamut: null, outside: null, peak: null, radius: null,
    lightness: n ? { mean: round(sum / n), min: round(lo), max: round(hi), range: round(hi - lo), p5: round(quantile(0.05)), p95: round(quantile(0.95)) } : null,
    chroma: n ? { mean: round(sumC / n), max: round(maxC), p50: round(quantile(0.5, cHist, cHistSum)), p95: round(quantile(0.95, cHist, cHistSum)), high: round(high / n), areas } : null,
    saturated: n ? saturated : null, samples };
  if (views.twoValues) {
    const [dark, light] = views.twoValues;
    let off = 0;
    for (let i = 0; i < n; i++) if (Math.abs(L[i] - dark) > 0.05 && Math.abs(L[i] - light) > 0.05) off++;
    result.between = n ? round(off / n) : null;
  }
  if (views.grey) result.grey = image((i, out, o) => { out[o] = out[o + 1] = out[o + 2] = greyOf(L[i]); });
  if (views.values) {
    const h = Math.max(1, Math.round(0.02 * width)), B = Float64Array.from(L), line = new Float64Array(Math.max(width, height));
    // One box pass along `len` values from `base`, `step` apart, edges replicated.
    const pass = (base, step, len) => {
      for (let k = 0; k < len; k++) line[k] = B[base + k * step];
      let s = 0;
      for (let k = -h; k <= h; k++) s += line[Math.min(len - 1, Math.max(0, k))];
      for (let k = 0; k < len; k++) {
        B[base + k * step] = s / (2 * h + 1);
        s += line[Math.min(len - 1, k + h + 1)] - line[Math.max(0, k - h)];
      }
    };
    for (let p = 0; p < 3; p++) for (let y = 0; y < height; y++) pass(y * width, 1, width);
    for (let p = 0; p < 3; p++) for (let x = 0; x < width; x++) pass(x, width, height);
    const at = (x, y) => B[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))];
    let best = -1, bx = 0, by = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const c = Math.hypot(at(x + h, y) - at(x - h, y), at(x, y + h) - at(x, y - h)) / 2;
        if (c > best) { best = c; bx = x; by = y; }
      }
    }
    const levels = [greyOf(1 / 6), greyOf(1 / 2), greyOf(5 / 6)];
    result.values = image((i, out, o) => { out[o] = out[o + 1] = out[o + 2] = levels[B[i] < 1 / 3 ? 0 : B[i] < 2 / 3 ? 1 : 2]; });
    result.radius = h;
    result.peak = best < 1e-6 ? null : { x: bx, y: by, contrast: round(best) };
  }
  if (views.gamut) {
    // `wrap` takes an angle from -turn to turn into 0 to turn.
    const turn = 2 * Math.PI, wrap = (a) => (a < 0 ? a + turn : a), H = 720, deg = (a) => (a * 360 / turn).toFixed(1);
    // The edges depend on no image, so the first call with a set of patches builds them and keeps them on cellViews,
    // which the page's inlined copy of this function does for itself.
    if (!cellViews.gamutEdges || cellViews.gamutEdges.data !== views.gamut) {
      // CIELAB D50 patches, as printData selects them. faces[f][i][j]: no black, the first ink of face f at coverage
      // LV[i] with the second at LV[j], for C with M, M with Y and Y with C, so faces[f][i][0] are the inks' tints,
      // faces[f][i][i] the overprints' and [0][0] paper. blacks: the solids C, C+M, M, M+Y, Y and C+Y, each with 20
      // and 40% black. blackL: the L of C, M and K 100%, the press's black as black-point compensation takes it.
      // Only the number of coverages is read here; printData takes the faces at these, its PRINT_LEVELS.
      const LV = [0, 10, 20, 40, 70, 100];
      const { faces, blacks, blackL } = views.gamut;
      // The paper patch, C0 M0 Y0 K0, shared by the three faces' first cell.
      const paperL = faces[0][0][0][0];
      const inv = (f) => (f * f * f > 216 / 24389 ? f * f * f : (116 * f - 16) * 27 / 24389);
      // Black-point compensation, linear in XYZ: paper's Y goes to white's, black's to 0.
      const Yp = inv((paperL + 16) / 116), Yk = inv((blackL + 16) / 116);
      const linOf = ([Ls, as, bs]) => {
        const fy = (Ls + 16) / 116, bpc = (v, w) => (v - Yk * w) / (Yp - Yk);
        const X = bpc(0.96422 * inv(fy + as / 500), 0.96422), Y = bpc(inv(fy), 1), Z = bpc(0.82521 * inv(fy - bs / 200), 0.82521);
        return [3.1338561 * X - 1.6168667 * Y - 0.4906146 * Z, -0.9787684 * X + 1.9161415 * Y + 0.0334540 * Z, 0.0719453 * X - 0.2289914 * Y + 1.4052427 * Z];
      };
      // Rings of linear sRGB patches around grey, from light to dark. Ring e of the first five runs around the six
      // inks and overprints at coverage LV[e]: on each face, the first ink at LV[e] with the second rising through the
      // measured coverages, then the second at LV[e] with the first falling. The last two are the solids with 20 and
      // 40% black.
      const rings = [];
      for (let e = 1; e < LV.length; e++) {
        const ring = [];
        for (const face of faces) {
          for (let j = 0; j < e; j++) ring.push(linOf(face[e][j]));
          for (let i = e; i > 0; i--) ring.push(linOf(face[i][e]));
        }
        rings.push(ring);
      }
      for (let k = 0; k < blacks[0].length; k++) rings.push(blacks.map((solid) => linOf(solid[k])));
      const m = rings.length + 2;
      // Between two neighbouring patches of a ring, mixing them in linear light gives the halftones between them under
      // Neugebauer's model. The edge at each of H hues holds m points in `lutL` and `lutC`: white, then per ring the
      // lightness and chroma where that ring reaches the hue, then black.
      const S = 32, lutL = new Float64Array(H * m), lutC = new Float64Array(H * m), mixed = [0, 0, 0];
      for (let i = 0; i < H; i++) lutL[i * m] = 1;
      for (let e = 1; e < m - 1; e++) {
        const pts = rings[e - 1], ring = new Float64Array(pts.length * S * 3);
        for (let q = 0; q < pts.length; q++) {
          const p = pts[q], r = pts[(q + 1) % pts.length];
          for (let j = 0; j < S; j++) {
            const s = j / S, k = (q * S + j) * 3;
            oklab(p[0] + (r[0] - p[0]) * s, p[1] + (r[1] - p[1]) * s, p[2] + (r[2] - p[2]) * s, mixed);
            ring[k] = wrap(Math.atan2(mixed[2], mixed[1])); ring[k + 1] = mixed[0]; ring[k + 2] = Math.hypot(mixed[1], mixed[2]);
          }
        }
        for (let k = 0; k < ring.length; k += 3) {
          const n = (k + 3) % ring.length, h0 = ring[k], d = wrap(ring[n] - h0);
          // Filling the hues from h0 forward assumes the ring rises in hue at every step; a step back would wrap almost a turn.
          if (!(d > 0 && d < turn / 2)) {
            throw new Error(`seeds: print-gamut ring ${e} steps from hue ${deg(h0)} to ${deg(ring[n])} degrees at patch ${Math.floor(k / 3 / S)}; each ring must rise in hue at every step, so the --gamut view has no edge to test against`);
          }
          for (let i = Math.ceil((h0 * H) / turn); (i * turn) / H - h0 < d; i++) {
            const t = ((i * turn) / H - h0) / d, at = (i % H) * m + e;
            lutL[at] = ring[k + 1] + (ring[n + 1] - ring[k + 1]) * t; lutC[at] = ring[k + 2] + (ring[n + 2] - ring[k + 2]) * t;
          }
        }
      }
      // A pixel's walk down an edge assumes each level is darker than the one above it at every hue.
      for (let i = 0; i < H; i++) {
        for (let e = 1; e < m; e++) {
          if (!(lutL[i * m + e] < lutL[i * m + e - 1])) {
            throw new Error(`seeds: print-gamut level ${e} is not darker than level ${e - 1} at hue ${deg((i * turn) / H)} degrees (L ${lutL[i * m + e].toFixed(4)} under ${lutL[i * m + e - 1].toFixed(4)}); each ring must be darker than the one before it at every hue, so the --gamut view has no edge to test against`);
          }
        }
      }
      // The H edges as flat OKLab points, m to an edge.
      const lut = new Float64Array(H * m * 3);
      for (let i = 0; i < H; i++) {
        const cos = Math.cos((i * turn) / H), sin = Math.sin((i * turn) / H);
        for (let e = 0, p = i * m; e < m; e++, p++) { lut[p * 3] = lutL[p]; lut[p * 3 + 1] = lutC[p] * cos; lut[p * 3 + 2] = lutC[p] * sin; }
      }
      // `data` names the patches the edges were built from; `paperL` and `blackL` ride along so a test reads the press's
      // paper and black from here.
      cellViews.gamutEdges = { data: views.gamut, m, lutL, lutC, lut, paperL, blackL };
    }
    const { m, lutL, lutC, lut } = cellViews.gamutEdges;
    // The OKLab distance from (l, A, B) to the nearest point of the polyline of `len` points, flat in `pt` from index `at`.
    const gap = (l, A, B, len, pt, at) => {
      let d = Infinity, p0 = pt[at], p1 = pt[at + 1], p2 = pt[at + 2];
      for (let k = at + 3, end = at + len * 3; k < end; k += 3) {
        const q0 = pt[k], q1 = pt[k + 1], q2 = pt[k + 2], e0 = q0 - p0, e1 = q1 - p1, e2 = q2 - p2, w0 = l - p0, w1 = A - p1, w2 = B - p2;
        const u = Math.max(0, Math.min(1, (w0 * e0 + w1 * e1 + w2 * e2) / (e0 * e0 + e1 * e1 + e2 * e2)));
        d = Math.min(d, (w0 - u * e0) ** 2 + (w1 - u * e1) ** 2 + (w2 - u * e2) ** 2);
        p0 = q0; p1 = q1; p2 = q2;
      }
      return Math.sqrt(d);
    };
    // The step between the edges a pixel's search tries, 3 degrees.
    const STEP = 6;
    // Each searched colour's `over` by its RGBA bytes, for up to 65536 colours. A repeat reuses it unchanged: a search cut
    // short by `excess` left `over` no larger than `excess` was then, which only grows, so the verdict, `count` and
    // `excess` come out as a fresh search would give them.
    const searched = new Map(), MAX_SEARCHED = 65536;
    // `prev` is the last tested pixel's `over`: a pixel with the same RGBA bytes as the one before it repeats its verdict
    // and paint, which on flat art skips most of the per-pixel test.
    let count = 0, excess = 0, prev = 0;
    result.gamut = image((i, out, o) => {
      if (i && data[o] === data[o - 4] && data[o + 1] === data[o - 3] && data[o + 2] === data[o - 2] && data[o + 3] === data[o - 1]) {
        if (prev > 0.02) { count++; out[o] = 255; out[o + 1] = 0; out[o + 2] = 255; }
        else out[o] = out[o + 1] = out[o + 2] = out[o - 4];
        return;
      }
      const A = ab[i * 2], B = ab[i * 2 + 1], C = Math.hypot(A, B), l = L[i];
      // The edge at the nearest of the H hues, `at` in lutL and lutC: the levels on either side of the pixel's lightness.
      const j = Math.round((wrap(Math.atan2(B, A)) * H) / turn) % H, at = j * m;
      let k = at + 1;
      while (lutL[k] > l) k++;
      const pL = lutL[k - 1], pC = lutC[k - 1], qL = lutL[k];
      let over = 0, key = 0;
      if (!(C <= pC + (lutC[k] - pC) * (l - pL) / ((qL - pL) || 1))) {
        key = data[o] | (data[o + 1] << 8) | (data[o + 2] << 16) | (data[o + 3] << 24);
        over = searched.get(key);
      }
      if (over === undefined) {
        over = gap(l, A, B, m, lut, at * 3);
        // The nearest point can lie at another hue. The edges STEP, 2 STEP, ... of the H hues either side are tried while
        // the pixel's distance to their hue's half-plane, C sin(angle), is under `over`. Once `over` is 0.02 or less the
        // pixel is inside; past a reach of 0.02, a nearer edge can no longer change the verdict, only `over`, which
        // matters only while `over` could be the largest so far.
        for (let s = STEP; s < H / 4 && over > 0.02; s += STEP) {
          const reach = C * Math.sin(((s - 0.5) * turn) / H);
          if (reach >= over || (reach > 0.02 && over <= excess)) break;
          over = Math.min(over, gap(l, A, B, m, lut, ((j + s) % H) * m * 3), gap(l, A, B, m, lut, ((j + H - s) % H) * m * 3));
        }
        if (searched.size < MAX_SEARCHED) searched.set(key, over);
      }
      prev = over;
      if (over > 0.02) { count++; excess = Math.max(excess, over); out[o] = 255; out[o + 1] = 0; out[o + 2] = 255; }
      else out[o] = out[o + 1] = out[o + 2] = greyOf(L[i]);
    });
    result.outside = n ? { share: round(count / n), excess: round(excess) } : null;
  }
  if (views.colourVision) {
    const matrices = {
      protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
      deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.011820, 0.042940, 0.968881],
      tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.303900],
    };
    for (const name of Object.keys(matrices)) {
      const M = matrices[name];
      result[name] = image((i, out, o) => {
        const r = lin[i * 3], g = lin[i * 3 + 1], b = lin[i * 3 + 2];
        for (let c = 0; c < 3; c++) out[o + c] = byte(Math.max(0, Math.min(1, M[c * 3] * r + M[c * 3 + 1] * g + M[c * 3 + 2] * b)));
      });
    }
  }
  return result;
}

/**
 * The style statistics of one RGBA image, `{ data, width, height }`, that
 * styleGap compares: measures of the whole image, none of which says where
 * anything is, so a mirrored or shuffled picture of the same marks reads the
 * same. A fully transparent pixel is not counted, such as the blank margin of a
 * photo crop; a partly transparent one is laid over white, as the sheet shows
 * it. Colours are OKLab, with Björn Ottosson's matrices, as in core/colour.js.
 *
 * - `colour`: the share of pixels in each OKLab bin, 10 lightness steps of 0.1
 *   by 11 steps of a and 11 of b, each 0.06 wide; the middle a and b steps are
 *   centred on grey, so neutral pixels never split across a bin edge. Bin i is
 *   lightness Math.floor(i / 121), a Math.floor(i / 11) % 11, b i % 11; a and b
 *   past the outer steps count in them.
 * - `lightness`: the share in each of 20 lightness steps of 0.05.
 * - `chroma`: the mean OKLab chroma.
 * - `bright`: the share with lightness over 0.9, paper and highlights.
 * - Over each pixel whose eight neighbours are counted too: `gradient`, the
 *   mean lightness gradient per pixel, from central differences; `fine`, the
 *   share whose 4-neighbour Laplacian of lightness is over 0.1 in size, a sharp
 *   change such as a one-pixel line 0.05 off its ground or a hard edge of 0.1;
 *   and `textureLight` and `textureDark`, the mean distance of lightness from
 *   its 3 x 3 mean where that mean is 2/3 or more, or 1/3 or less: grain,
 *   fibre or brush texture in the light and in the dark parts.
 * A measure over no pixels is null. `pixels` counts the pixels measured, and
 * `bins` gives the colour bins' geometry to styleGap.
 */
function styleStats({ data, width, height }) {
  const n = width * height, Ls = 10, ab = 11, step = 0.06;
  const L = new Float64Array(n), counted = new Uint8Array(n), colour = new Float64Array(Ls * ab * ab), lightness = new Float64Array(20);
  const linear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const bin = (v, lo, size, count) => Math.max(0, Math.min(count - 1, Math.floor((v - lo) / size)));
  let pixels = 0, chroma = 0, bright = 0;
  for (let i = 0; i < n; i++) {
    const alpha = data[i * 4 + 3] / 255;
    if (!alpha) continue;
    const r = linear(1 - alpha * (1 - data[i * 4] / 255)), g = linear(1 - alpha * (1 - data[i * 4 + 1] / 255)), b = linear(1 - alpha * (1 - data[i * 4 + 2] / 255));
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const lum = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
    const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
    L[i] = lum; counted[i] = 1; pixels++;
    chroma += Math.hypot(A, B);
    if (lum > 0.9) bright++;
    colour[(bin(lum, 0, 1 / Ls, Ls) * ab + bin(A, -step * ab / 2, step, ab)) * ab + bin(B, -step * ab / 2, step, ab)]++;
    lightness[bin(lum, 0, 0.05, 20)]++;
  }
  let inner = 0, gradient = 0, fine = 0, light = 0, lightN = 0, dark = 0, darkN = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      let sum = 0, all = true;
      for (let dy = -1; dy <= 1 && all; dy++) for (let dx = -1; dx <= 1; dx++) { if (!counted[i + dy * width + dx]) { all = false; break; } sum += L[i + dy * width + dx]; }
      if (!all) continue;
      inner++;
      gradient += Math.hypot((L[i + 1] - L[i - 1]) / 2, (L[i + width] - L[i - width]) / 2);
      if (Math.abs(4 * L[i] - L[i - 1] - L[i + 1] - L[i - width] - L[i + width]) > 0.1) fine++;
      const mean = sum / 9, off = Math.abs(L[i] - mean);
      if (mean >= 2 / 3) { light += off; lightN++; } else if (mean <= 1 / 3) { dark += off; darkN++; }
    }
  }
  const share = (h) => Array.from(h, (v) => (pixels ? v / pixels : 0));
  return {
    pixels, colour: share(colour), lightness: share(lightness),
    chroma: pixels ? chroma / pixels : null, bright: pixels ? bright / pixels : null,
    gradient: inner ? gradient / inner : null, fine: inner ? fine / inner : null,
    textureLight: lightN ? light / lightN : null, textureDark: darkN ? dark / darkN : null,
    bins: { lightness: Ls, ab, step },
  };
}

/**
 * How far piece crop `piece`'s style statistics, from styleStats, are from
 * reference crop `reference`'s, part by part, with no weight and no total:
 * `colour` and `lightness`, the total variation between their histograms,
 * from 0 for the same shares to 1 for no pixel in a common bin, with the
 * lightness histograms themselves; for each of `chroma`, `gradient`, `fine`,
 * `bright`, `textureLight` and `textureDark`, the `piece` and `reference`
 * values and their `ratio`, piece over reference, null where the reference's
 * is 0 or either is null; and `bins`, the 5 colour bins whose shares differ
 * most, each with its OKLab centre `L`, `a`, `b` and both shares. Values are
 * rounded to 4 decimals.
 */
function styleGap(reference, piece) {
  const round = (v) => (v === null ? null : +v.toFixed(4));
  const both = reference.pixels > 0 && piece.pixels > 0;
  const tv = (p, q) => { let s = 0; for (let i = 0; i < p.length; i++) s += Math.abs(p[i] - q[i]); return both ? round(s / 2) : null; };
  const part = (k) => ({ piece: round(piece[k]), reference: round(reference[k]), ratio: reference[k] > 0 && piece[k] !== null ? round(piece[k] / reference[k]) : null });
  const { lightness: Ls, ab, step } = reference.bins;
  const bins = !both ? [] : reference.colour.map((r, i) => ({ i, d: Math.abs(piece.colour[i] - r) })).filter((b) => b.d > 0)
    .sort((x, y) => y.d - x.d || x.i - y.i).slice(0, 5).map(({ i }) => ({
      L: round((Math.floor(i / (ab * ab)) + 0.5) / Ls), a: round((Math.floor(i / ab) % ab - (ab - 1) / 2) * step), b: round((i % ab - (ab - 1) / 2) * step),
      piece: round(piece.colour[i]), reference: round(reference.colour[i]),
    }));
  const gap = { pixels: { piece: piece.pixels, reference: reference.pixels }, colour: tv(piece.colour, reference.colour) };
  gap.lightness = { gap: tv(piece.lightness, reference.lightness), piece: piece.lightness.map(round), reference: reference.lightness.map(round) };
  for (const k of ['chroma', 'gradient', 'fine', 'bright', 'textureLight', 'textureDark']) gap[k] = part(k);
  gap.bins = bins;
  return gap;
}

// styleGap's `gap` as one line, the piece's value first, then the photo's.
function styleText(gap) {
  const num = (v) => (v === null ? 'none' : String(+v.toPrecision(3)));
  const pct = (v) => (v === null ? 'none' : (100 * v).toFixed(1) + '%');
  const vs = (name, k, f) => name + ' ' + f(gap[k].piece) + ' vs photo ' + f(gap[k].reference);
  return ['colour ' + num(gap.colour), 'lightness ' + num(gap.lightness.gap), vs('chroma', 'chroma', num), vs('gradient', 'gradient', num),
    vs('fine', 'fine', pct), vs('bright', 'bright', pct), vs('light texture', 'textureLight', num), vs('dark texture', 'textureDark', num)].join(' · ')
    + (gap.bins.length ? ' · colours most apart, OKLab L a b: ' + gap.bins.map((b) => [b.L, b.a, b.b].map(num).join(' ') + ' ' + pct(b.piece) + ' vs photo ' + pct(b.reference)).join(', ') : '');
}

// frameGap's defaults: a pixel is off when a channel differs by more than
// this, and the frame is split into this many regions each way.
const FRAME_THRESHOLD = 32;
const FRAME_GRID = 8;

/**
 * How far `render` is from `reference`, two RGBA images `{ data, width, height }`
 * of one size, compared pixel by pixel at the same place, so a shape drawn in
 * the wrong place counts where styleGap does not. Each pixel is laid over
 * white, as styleStats lays it. `mean` is the mean difference of the red,
 * green and blue channels over the whole frame, from 0 to 255; `off`, the
 * share of pixels whose largest channel difference is over `threshold`;
 * `grid`, that share in each of `cols` x `rows` regions (FRAME_GRID each way,
 * fewer for a frame narrower than that), `off` as rows from the top; and
 * `worst`, the region with the largest share and its pixel bounds, the first
 * in reading order on a tie, or null when no pixel is off. Shares and `mean`
 * are rounded to 4 decimals. Two sizes are refused: nothing is rescaled.
 */
function frameGap(reference, render, threshold = FRAME_THRESHOLD) {
  const { width: W, height: H } = reference;
  if (render.width !== W || render.height !== H) {
    throw new Error(`seeds: the render is ${render.width} x ${render.height} px and the reference ${W} x ${H} px; the comparison is pixel by pixel at the same place and rescales nothing,`
      + ' so draw the render at the reference\'s size, such as with npm run still -- <piece> --scale k, or crop the reference to the render\'s');
  }
  const round = (v) => +v.toFixed(4), cols = Math.min(FRAME_GRID, W), rows = Math.min(FRAME_GRID, H);
  const off = new Float64Array(cols * rows), area = new Float64Array(cols * rows);
  const over = (d, i, c) => 255 - d[i + 3] / 255 * (255 - d[i + c]);
  let sum = 0, offs = 0;
  for (let y = 0; y < H; y++) {
    const row = Math.floor(y * rows / H) * cols;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, cell = row + Math.floor(x * cols / W);
      let most = 0;
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(over(render.data, i, c) - over(reference.data, i, c));
        sum += d; most = Math.max(most, d);
      }
      area[cell]++;
      if (most > threshold) { offs++; off[cell]++; }
    }
  }
  const shares = Array.from(off, (v, i) => v / area[i]);
  const top = shares.reduce((best, v, i) => (v > shares[best] ? i : best), 0);
  const from = (i, n, size) => Math.ceil(i * size / n);
  const col = top % cols, row = Math.floor(top / cols);
  return {
    width: W, height: H, threshold, mean: round(sum / (3 * W * H)), off: round(offs / (W * H)),
    grid: { cols, rows, off: Array.from({ length: rows }, (_, r) => shares.slice(r * cols, (r + 1) * cols).map(round)) },
    worst: offs ? { col, row, x: from(col, cols, W), y: from(row, rows, H), width: from(col + 1, cols, W) - from(col, cols, W), height: from(row + 1, rows, H) - from(row, rows, H), off: round(shares[top]) } : null,
  };
}

// frameGap's `gap` as lines: the numbers, the grid of shares, the worst region.
function frameText(gap) {
  const pct = (v) => (100 * v).toFixed(1) + '%';
  const { cols, rows } = gap.grid, w = gap.worst;
  return [`${gap.width} x ${gap.height} px: mean channel difference ${gap.mean.toFixed(2)} of 255; ${pct(gap.off)} of pixels off by more than ${gap.threshold}`,
    `share off by region, ${cols} x ${rows}, top row first:`,
    ...gap.grid.off.map((r) => r.map((v) => pct(v).padStart(7)).join('')),
    w ? `most off: column ${w.col + 1} of ${cols}, row ${w.row + 1} of ${rows}, pixels ${w.x} to ${w.x + w.width - 1} across and ${w.y} to ${w.y + w.height - 1} down: ${pct(w.off)} off` : 'no pixel is off'];
}

// The mean luma change between two frames' block grids, from 0 to 255.
function gridChange(a, b) {
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
  return total / a.length;
}

// A strip frame is nearly empty under this detail, or under this share of the
// most detailed frame shown on each side of it. Frames none of which changed
// from the first of them by `still` or more (see `change` in stripFlags) are
// held when they span `holdSeconds` or more. Calibrated in installed Edge, at
// --scale 0.5 to 4, so no registered example reports either and
// tests/fixtures/empty-film.cjs reports its blank, its bare hatching and its
// hold. The blurred, shifted, gained region measure was checked on frames
// drawn in installed Edge at 640 pixels: a frozen picture of discs on mid
// grey under finish grain 0.6, weave 1.2, grain 0.35 with weave 1.2, or
// stride's grain, weave, flicker and vignette changes by at most about 1.1
// and is held, a black line drawing on white under weave 1.2 by at most about
// 0.3, and a stick figure frozen on paper under grain 0.35 with weave 1.2, or
// stride's finish with flicker 0.015 or 0.025, by under 0.5, while the same
// figure breathing in its held pose changes by up to about 14 within each
// breath, so it is not held, with no finish or any of those. Frozen grids of
// black lines on white off whole pixels, 3 pixels wide under weave 1.2 and 2
// under weave 0.6, are held too.
// The floor sits under drift's opening frame, whose sparse first marks
// read 0.055 at 640 pixels and 0.008 at 4000; see
// docs/knowledge/command-line-tools.md#time-strips.
// A run of cells holds its light (see `lights` in stripFlags) unless two of its
// lit areas lie `lightMove` of the design width or more apart, its
// lowest level falls to `lightLevel` of its highest, or one region's mean rise
// does; a region counts once its highest mean rise, 0 to 255, reaches
// `lightRise`. tests/fixtures/light-film.cjs shows each case.
// With two declared values, a cell is flagged once more than `between` of its
// pixels lie more than 0.05 in L from both; see
// docs/knowledge/command-line-tools.md#two-values.
const STRIP_RULES = { floor: 0.005, dip: 0.25, still: 2, holdSeconds: 6, lightMove: 0.01, lightLevel: 0.75, lightRise: 8, between: 0.02 };

// Whether strip cell `i` of `cells` (plan cells or the page's results) opens a
// run, so change, light, hold and caption do not compare it with the cell
// before: the first cell, a cell marked 'first', or one whose shot or contact
// differs from the cell before's. A failed cell before also breaks a run; each
// caller checks that with trustedCell.
function opensRun(cells, i) {
  const cell = cells[i], last = cells[i - 1];
  return !last || cell.mark === 'first' || last.shot !== cell.shot || last.contact !== cell.contact;
}

// Whether strip cell `i` of `cells` was drawn and measured: it exists, has no
// error and has its frameDetail luma in `lumas`. stripFlags' holds, lights and
// empty frames, beatSummary's changes and the page's change and light move
// trust only such cells.
function trustedCell(cells, lumas, i) {
  return !!cells[i] && cells[i].error === null && !!lumas[i];
}

/**
 * What a drawn strip reports, never fails, from its cells and their frameDetail
 * lumas: `empty`, each frame whose detail is under `rules.floor` or under
 * `rules.dip` of the most detailed drawn frame on each side, so a blank that
 * lasts several frames shown is still found; `unscaled`, each drawn frame whose
 * draw painted marks after dropping the cell's scale (`unscaled` above 0, see
 * measureFrame), with `marks`, that count; and `holds`, each run of
 * drawn frames none of which changed from its first by `rules.still` or more,
 * as `change` below measures it, and that span `rules.holdSeconds` or more.
 * A dark or sparse frame can be the art, and a hold is judged only on the
 * frames shown, and a run ends before a cell that opensRun says opens one and
 * at a cell trustedCell does not trust: a failed cell or a cell with no luma.
 * Each cell's `hold` is set to that change from the first frame of the run it
 * was judged against, `rules.still` or more where it ended the run, or to null
 * where it was not judged: a cell that opens a run, an untrusted cell and a
 * cell right after an untrusted one.
 * `lights` judges each such run of 2 or more drawn cells by each cell's `light`
 * (litArea in design units, a null light at level 0): `move`, the largest
 * distance between any two of the run's lights, to 2 decimals, so a slow move
 * sampled by many cells adds up and a swing reads its full width whichever
 * cell comes first, or null under two lights, `low` and `high`, its lowest and highest
 * level, and `dim`, the smallest ratio of lowest to highest mean rise over the
 * median block among the square regions about 1/10 of the frame wide whose
 * highest reaches `rules.lightRise`, or null. `held` is true unless the move
 * reaches `rules.lightMove` of the design `width`, or `low` or `dim` falls to
 * `rules.lightLevel` of the highest.
 * `between` lists, with `twoValues`, a declared film's [dark, light], each
 * trusted cell whose `between` share is over `rules.between`, with that
 * `share`; without `twoValues` it is empty.
 */
function stripFlags(cells, lumas, rules, width, twoValues) {
  const trusted = cells.map((_, i) => trustedCell(cells, lumas, i));
  const drawn = (i) => trusted[i];
  // `cell` is the index in `cells`, which tells apart two cells of one frame.
  const pick = (cell, i) => ({ cell: i, frame: cell.frame, seconds: cell.seconds, t: cell.t });
  // The most detail among drawn cells from index `a` up to, not including, `b`.
  const most = (a, b) => { let m = -Infinity; for (let j = a; j < b; j++) if (drawn(j)) m = Math.max(m, cells[j].detail); return m; };
  // Each luma smoothed by four passes of [1 2 1] / 4 each way, a blur about
  // 1.4 of its squares wide, before `change` compares two. The shift there
  // moves `a` by bilinear steps, which redraw an anti-aliased edge that sits
  // off whole pixels unlike the renderer does, so without the blur a frozen
  // grid of 3-pixel lines under weave changes a region by more than `still`.
  // The blur moves little luma between blocks, so a moving figure changes its
  // region nearly as much without it.
  // `spare` is a buffer of one luma's size, shared by every pass of every
  // frame and by `change`, reallocated only when a luma's size differs.
  let spare = null, blocks = null;
  const scratch = (n) => (spare && spare.length === n ? spare : (spare = new Float64Array(n)));
  const soft = lumas.map((l) => {
    if (!l) return l;
    const { w, h } = l;
    // An even count of passes ends in `d`, the frame's own buffer.
    let d = Float64Array.from(l.data), o = scratch(w * h);
    for (let pass = 0; pass < 8; pass++) {
      const across = pass % 2 === 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const p = across ? y * w + Math.max(0, x - 1) : Math.max(0, y - 1) * w + x, q = across ? y * w + Math.min(w - 1, x + 1) : Math.min(h - 1, y + 1) * w + x;
          o[y * w + x] = (d[p] + 2 * d[y * w + x] + d[q]) / 4;
        }
      }
      [d, o] = [o, d];
    }
    return { ...l, data: d };
  });
  // How much frame `b` changed from frame `a`, both smoothed lumas. A film
  // finish's weave moves the whole picture by a fraction of a pixel each
  // frame, which changes every block holding an edge, so `b` is first matched
  // with `a` moved as a whole by up to a quarter of a block each way, the shift
  // found by three Lucas-Kanade steps, and scaled by the gain that matches it
  // best (see `gain`), since a finish's flicker darkens the whole frame. A lone
  // subject on a plain ground that moves as a whole by less than the shift is
  // matched too, as a slow pan is. What still differs is averaged in
  // blocks, so grain averages out, and the blocks' changes in square regions
  // about 1/10 of the frame wide, 8 by 8 blocks at 640 pixels. The change is
  // the largest region's, not the mean over the frame, so a small region that
  // keeps moving, such as a figure breathing in a held pose, breaks a hold.
  const change = (a, b) => {
    const { w, h, block: k } = a, A = a.data, m = k / 4, S = scratch(w * h);
    let dx = 0, dy = 0, g = 1, px = NaN, py = NaN;
    // `a` moved by the shift into `S`: each square (x, y) holds `a` at
    // (x - dx, y - dy), bilinear, held at its edges. Every read below is on
    // whole squares, so one pass per shift serves the gain, the gradient and
    // the blocks. A shift already in `S` is not drawn again and returns
    // false, and no shift is a copy, which the bilinear weights 1 and 0 give
    // to the bit.
    const shift = () => {
      if (dx === px && dy === py) return false;
      px = dx; py = dy;
      if (dx === 0 && dy === 0) { S.set(A); return true; }
      for (let y = 0; y < h; y++) {
        const sy = Math.max(0, Math.min(h - 1, y - dy)), y0 = Math.floor(sy), y1 = Math.min(h - 1, y0 + 1), fy = sy - y0;
        for (let x = 0; x < w; x++) {
          const sx = Math.max(0, Math.min(w - 1, x - dx)), x0 = Math.floor(sx), x1 = Math.min(w - 1, x0 + 1), fx = sx - x0;
          S[y * w + x] = (A[y0 * w + x0] * (1 - fx) + A[y0 * w + x1] * fx) * (1 - fy) + (A[y1 * w + x0] * (1 - fx) + A[y1 * w + x1] * fx) * fy;
        }
      }
      return true;
    };
    // The gain that best matches `a`, moved by the shift, to `b`, kept within
    // 3% of 1: a finish's flicker darkens the whole frame by up to 2.5%
    // (FLICKER in core/finish.js), a change of up to 6 on white.
    const gain = () => {
      let ab = 0, aa = 0;
      for (let i = 0; i < w * h; i++) { const v = S[i]; ab += v * b.data[i]; aa += v * v; }
      return aa > 0 ? Math.max(0.97, Math.min(1.03, ab / aa)) : 1;
    };
    // A step that left the shift where it was would repeat itself, as would
    // every step after it.
    for (let step = 0; step < 3; step++) {
      if (!shift()) break;
      g = gain();
      let xx = 0, xy = 0, yy = 0, xt = 0, yt = 0;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x, gx = g * (S[i + 1] - S[i - 1]) / 2, gy = g * (S[i + w] - S[i - w]) / 2;
          const t = g * S[i] - b.data[i];
          xx += gx * gx; xy += gx * gy; yy += gy * gy; xt += gx * t; yt += gy * t;
        }
      }
      const det = xx * yy - xy * xy;
      if (!(det > 0)) break;
      dx = Math.max(-m, Math.min(m, dx + (yy * xt - xy * yt) / det));
      dy = Math.max(-m, Math.min(m, dy + (xx * yt - xy * xt) / det));
    }
    if (shift()) g = gain();
    const bw = Math.max(1, Math.floor(w / k)), bh = Math.max(1, Math.floor(h / k)), s = Math.max(1, Math.round(bw / 10));
    if (blocks && blocks.length === bw * bh) blocks.fill(0); else blocks = new Float64Array(bw * bh);
    for (let y = 0; y < Math.min(h, bh * k); y++) {
      for (let x = 0; x < Math.min(w, bw * k); x++) blocks[Math.floor(y / k) * bw + Math.floor(x / k)] += (b.data[y * w + x] - g * S[y * w + x]) / (k * k);
    }
    let most = 0;
    for (let ry = 0; ry < bh; ry += s) {
      for (let rx = 0; rx < bw; rx += s) {
        let total = 0, n = 0;
        for (let y = ry; y < Math.min(bh, ry + s); y++) for (let x = rx; x < Math.min(bw, rx + s); x++) { total += Math.abs(blocks[y * bw + x]); n++; }
        most = Math.max(most, total / n);
      }
    }
    return most;
  };
  const empty = [], holds = [], unscaled = [];
  cells.forEach((cell, i) => {
    if (!drawn(i)) return;
    if (cell.unscaled) unscaled.push({ ...pick(cell, i), marks: cell.unscaled });
    const why = cell.detail < rules.floor ? 'floor'
      : cell.detail < rules.dip * Math.min(most(0, i), most(i + 1, cells.length)) ? 'dip' : null;
    if (why) empty.push({ ...pick(cell, i), detail: cell.detail, why });
  });
  cells.forEach((cell) => { if (cell) cell.hold = null; });
  for (let from = 0; from < cells.length;) {
    let to = from;
    while (drawn(from) && drawn(to + 1) && !opensRun(cells, to + 1)) {
      cells[to + 1].hold = change(soft[from], soft[to + 1]);
      if (cells[to + 1].hold >= rules.still) break;
      to++;
    }
    const seconds = cells[to].seconds - cells[from].seconds;
    if (to > from && seconds >= rules.holdSeconds) holds.push({ from: pick(cells[from], from), to: pick(cells[to], to), seconds });
    from = to + 1;
  }
  // A raw luma's mean rise over its median block, as litArea takes the ground,
  // in square regions of blocks as `change` takes them, edge regions clipped.
  const rises = (l) => {
    const { w, h, block: k, data } = l, cols = Math.max(1, Math.floor(w / k)), rows = Math.max(1, Math.floor(h / k)), means = [];
    for (let by = 0; by < rows; by++) {
      const y1 = Math.min(h, by * k + k);
      for (let bx = 0; bx < cols; bx++) {
        const x1 = Math.min(w, bx * k + k);
        let total = 0, n = 0;
        for (let y = by * k; y < y1; y++) for (let x = bx * k; x < x1; x++) { total += data[y * w + x]; n++; }
        means.push(total / n);
      }
    }
    const base = means.slice().sort((a, b) => a - b)[means.length >> 1], side = Math.max(1, Math.round(cols / 10)), out = [];
    for (let ry = 0; ry < rows; ry += side) {
      for (let rx = 0; rx < cols; rx += side) {
        let total = 0, n = 0;
        for (let y = ry; y < Math.min(rows, ry + side); y++) for (let x = rx; x < Math.min(cols, rx + side); x++) { total += Math.max(0, means[y * cols + x] - base); n++; }
        out.push(total / n);
      }
    }
    return out;
  };
  const lights = [];
  for (let from = 0; from < cells.length;) {
    let to = from;
    const joins = (i) => drawn(i) && !opensRun(cells, i);
    if (drawn(from)) while (to + 1 < cells.length && joins(to + 1)) to++;
    if (to > from) {
      let move = null, low = Infinity, high = -Infinity, dim = null;
      const sets = [], points = [];
      for (let i = from; i <= to; i++) {
        const lit = cells[i].light || null, level = lit ? lit.level : 0;
        if (lit) points.push(lit);
        low = Math.min(low, level);
        high = Math.max(high, level);
        sets.push(rises(lumas[i]));
      }
      for (let a = 0; a < points.length; a++) for (let b = a + 1; b < points.length; b++) move = Math.max(move === null ? 0 : move, Math.hypot(points[b].x - points[a].x, points[b].y - points[a].y));
      if (move !== null) move = +move.toFixed(2);
      if (sets.every((r) => r.length === sets[0].length)) {
        sets[0].forEach((_, j) => {
          let top = 0, bottom = Infinity;
          for (const r of sets) { top = Math.max(top, r[j]); bottom = Math.min(bottom, r[j]); }
          if (top >= rules.lightRise) dim = Math.min(dim === null ? 1 : dim, bottom / top);
        });
      }
      if (dim !== null) dim = +dim.toFixed(3);
      const held = !(move !== null && move >= rules.lightMove * width) && !(high > 0 && low <= rules.lightLevel * high) && !(dim !== null && dim <= rules.lightLevel);
      lights.push({ from: pick(cells[from], from), to: pick(cells[to], to), shot: cells[from].shot || null, move, low, high, dim, held });
    }
    from = to + 1;
  }
  const between = [];
  if (twoValues) cells.forEach((cell, i) => { if (drawn(i) && cell.between > rules.between) between.push({ ...pick(cell, i), share: cell.between }); });
  return { empty, holds, lights, unscaled, between };
}

// The context methods that paint a mark, each with the style property it paints
// with, null for an image or putImageData. measureFrame counts them and
// partCover sorts them; a strip page declares it before both.
const PAINT = { fill: 'fillStyle', fillRect: 'fillStyle', fillText: 'fillStyle', stroke: 'strokeStyle', strokeRect: 'strokeStyle', strokeText: 'strokeStyle', drawImage: null, putImageData: null };

// Forward to the real canvas so clipping, curves and compositing keep their
// native behavior. A mark means a paint call, even if it paints no pixels.
// `read`, when given, gets the drawn pixels, so the canvas is read once.
// `scale`, when given and not 1, is the cell's scale: `unscaled` then counts
// the marks, other than images and putImageData, painted while the transform
// is one pixel per design unit after the draw dropped the cell's scale, by
// setTransform, resetTransform or reset(), or by a restore() that pops the save
// drawFrame opens each cell with. A restore() back past the drop clears it, as
// the context restores its transform with it. Marks after drawFrame's closing
// restore(), such as a finish's, are not counted. The transform is read at each
// transform call while the scale is dropped and the count is open, never per
// mark and never once a restore() on no saves has ended the count.
function measureFrame(ctx, draw, read, scale) {
  const methods = new Map(), track = scale !== undefined && scale !== 1, kept = [];
  const MOVES = new Set(['restore', 'reset', 'setTransform', 'resetTransform', 'transform', 'scale', 'translate', 'rotate']);
  // A restore() that empties the saves may be drawFrame's own close, so the
  // marks after it wait in `pending` until a restore() on no saves shows the
  // close came later; after the close, `done` stops the count.
  let markCount = 0, unscaled = 0, reset = false, flat = false, after = false, pending = 0, done = false;
  const surface = new Proxy(ctx, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      if (!methods.has(key)) methods.set(key, (...args) => {
        const result = value.apply(target, args);
        if (track && !done) {
          if (key === 'save') kept.push(reset);
          else if (key === 'restore') {
            if (kept.length) { reset = kept.pop(); if (!kept.length) reset = after = true; }
            else { unscaled += pending; pending = 0; done = true; reset = false; }
          }
          else if (key === 'reset') { kept.length = 0; reset = true; }
          else if (key === 'setTransform' || key === 'resetTransform') reset = true;
          if (reset && MOVES.has(key)) { const m = target.getTransform(); flat = m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1; }
        }
        if (Object.hasOwn(PAINT, key)) {
          markCount++;
          if (!done && reset && flat && PAINT[key] !== null) { if (after) pending++; else unscaled++; }
        }
        return result;
      });
      return methods.get(key);
    },
    set(target, key, value) { return Reflect.set(target, key, value, target); },
  });
  draw(surface);
  const { width, height } = ctx.canvas;
  const image = ctx.getImageData(0, 0, width, height);
  if (read) read(image);
  return { markCount, ...(scale !== undefined && { unscaled }), ...pixelBounds(image) };
}

// A time strip's cells are this many pixels wide unless --scale says otherwise,
// and as many columns as fit this many CSS pixels share a row.
const STRIP_CELL = 640, STRIP_WIDTH = 2048;

// A --sound strip's soundtrack picture: the waveform's height and the
// spectrogram's rows, in canvas pixels.
const SOUND_WAVE = 128, SOUND_ROWS = 192;

/**
 * The running sum of the channels' mean power per sample, `n + 1` long: the mean
 * power over samples a to b is (squares[b] - squares[a]) / (b - a). soundPicture
 * and soundProfile take it as an optional last argument, so a page builds it
 * once for both. Serialized with them.
 */
function soundSquares(channels) {
  const n = channels.length ? channels[0].length : 0, C = channels.length;
  const squares = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (const ch of channels) sum += ch[i] * ch[i];
    squares[i + 1] = squares[i] + sum / C;
  }
  return squares;
}

/**
 * An in-place radix-2 transform of `N` points (a power of two), as a function of
 * the real and imaginary arrays: the bit-reversal swaps are listed once here,
 * not rebuilt per call. Serialized with soundPicture and soundProfile.
 */
function soundFft(N) {
  const swaps = [];
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) swaps.push(i, j);
  }
  return (re, im) => {
    for (let s = 0; s < swaps.length; s += 2) {
      const i = swaps[s], j = swaps[s + 1];
      [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]];
    }
    for (let len = 2; len <= N; len <<= 1) {
      const wr = Math.cos((-2 * Math.PI) / len), wi = Math.sin((-2 * Math.PI) / len);
      for (let i = 0; i < N; i += len) {
        for (let k = 0, cr = 1, ci = 0; k < len / 2; k++) {
          const p = i + k, q = p + len / 2, tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr;
          re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  };
}

/**
 * A soundtrack's picture, `columns` wide across its whole length, from its
 * channels' Float32Arrays at `rate` samples a second. Each column holds the
 * lowest and highest sample of any channel (`low`, `high`); `rms`, the RMS
 * over 50 ms around the column's middle in dBFS, the loudness envelope; and a
 * spectrogram column of `rows` bands spaced evenly in log frequency from
 * `from` to `to` Hz, bottom row first, each band its loudest bin of a
 * 4096-point Hann-windowed transform around the column's middle, in dB where
 * a full-scale sine reads 0. Levels are the channels' mean power, so a sound
 * panned to one side is not halved and one in antiphase does not vanish.
 * Serialized into the strip page, so beyond its arguments it reads only
 * soundSquares and soundFft, so a page puts SOUND_HELPERS before it. `squares` is optional, the prefix soundSquares builds, so
 * a caller that also runs soundProfile builds it once. A
 * soundtrack with no samples has no time axis to draw, so it is refused by name.
 */
function soundPicture(channels, rate, columns, rows, squares) {
  const n = channels.length ? channels[0].length : 0, C = channels.length;
  if (!n) throw new Error('the soundtrack holds no samples, so there is nothing to draw');
  if (!squares) squares = soundSquares(channels);
  const N = 4096, fft = soundFft(N), from = 40, to = Math.min(16000, rate / 2), half = Math.round(rate * 0.025);
  const hann = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  // Each row's bins: those nearest its band's edges, at least one.
  const bins = Array.from({ length: rows }, (_, r) => {
    const k0 = Math.round((from * (to / from) ** (r / rows) * N) / rate);
    return [k0, Math.max(k0, Math.round((from * (to / from) ** ((r + 1) / rows) * N) / rate) - 1)];
  });
  const low = new Float32Array(columns), high = new Float32Array(columns), rms = new Float32Array(columns);
  const spectrum = new Float32Array(columns * rows), re = new Float64Array(N), im = new Float64Array(N), power = new Float64Array(N / 2 + 1);
  for (let c = 0; c < columns; c++) {
    const a = Math.floor((c * n) / columns), b = Math.max(a + 1, Math.floor(((c + 1) * n) / columns)), mid = (a + b) >> 1;
    let lo = Infinity, hi = -Infinity;
    for (const ch of channels) for (let i = a; i < Math.min(b, n); i++) { lo = Math.min(lo, ch[i]); hi = Math.max(hi, ch[i]); }
    low[c] = lo; high[c] = hi;
    const w0 = Math.max(0, mid - half), w1 = Math.min(n, mid + half);
    rms[c] = 10 * Math.log10(Math.max(1e-12, (squares[w1] - squares[w0]) / Math.max(1, w1 - w0)));
    power.fill(0);
    for (const ch of channels) {
      for (let i = 0, s = mid - N / 2; i < N; i++, s++) { re[i] = s >= 0 && s < n ? ch[s] * hann[i] : 0; im[i] = 0; }
      fft(re, im);
      for (let k = 0; k <= N / 2; k++) power[k] += (re[k] * re[k] + im[k] * im[k]) / C;
    }
    // A full-scale sine centred on a bin peaks at N / 4 through the window.
    for (let r = 0; r < rows; r++) {
      let top = 0;
      for (let k = bins[r][0]; k <= bins[r][1]; k++) top = Math.max(top, power[k]);
      spectrum[c * rows + r] = 10 * Math.log10(Math.max(1e-12, (top * 16) / (N * N)));
    }
  }
  return { columns, rows, from, to, seconds: n / rate, low, high, rms, spectrum };
}

// Serialized beside soundPicture: its `pic`'s peak sample in dBFS and the
// lowest and highest of its envelope, { peakDb, rmsDb: { min, max } }.
function soundSummary(pic) {
  let peak = 0, min = Infinity, max = -Infinity;
  for (let c = 0; c < pic.columns; c++) {
    peak = Math.max(peak, -pic.low[c], pic.high[c]);
    min = Math.min(min, pic.rms[c]); max = Math.max(max, pic.rms[c]);
  }
  return { peakDb: 20 * Math.log10(Math.max(1e-12, peak)), rmsDb: { min, max } };
}

/**
 * Each beat of a film's beat sheet, `list` (the built state's `cues.beats`),
 * against a time strip's `cells` ({ frame, change, error }) and their
 * frameDetail `lumas` by index, as stripFlags takes them, in a film of
 * `frames` frames at `hz`. Null unless `list` is a non-empty array of beats,
 * each on a whole frame from 0 to `frames` with a finite `intensity`, in frame
 * order. A beat spans from its frame to the next beat's frame, the last to the
 * film's end, so two beats on one frame leave the first an empty span. `peak`
 * marks the first beat with the highest intensity, as the film scaffold's
 * `s.cues.peak` does. `cells` counts the cells with a `change` that count in
 * the beat, each one trustedCell trusts and right after a cell it trusts or
 * first, as stripFlags judges holds, and `change` is that change's `max` and
 * `median`, null with none.
 * A cell's change is measured from the cell before it, so when the two cells
 * lie in different beats it counts in the more intense of their two beats,
 * the later on a tie: a peak keeps both the change that opens it and the drop
 * after it, and a beat that holds no cell gets no change.
 * With `sound`, { seconds, rms, events, squares } (soundPicture's seconds and
 * 50 ms RMS columns, soundProfile's events, soundSquares' sums), each beat
 * adds its event count, its loudest event's `loudestDb` and `rmsDb`, the max
 * and median of the columns whose middle falls in the span, in dB to 0.1,
 * null where none does. With `squares`, each column's window is cut at the
 * span's edges, so a neighbour beat's sound never counts toward this one.
 * The parameters are positional, `lumas` before `sound`, because every caller
 * is in this repository. A call with the two swapped is not refused: with a
 * valid beat list it throws a TypeError, since the `lumas` array lands in the
 * `sound` slot and `sound.events.filter` is undefined.
 * Serialized into every strip page with a timeline.
 */
function beatSummary(list, frames, hz, cells, lumas, sound) {
  if (!Array.isArray(list) || !list.length || !list.every((b, i) => b && Number.isInteger(b.frame) && b.frame >= 0 && b.frame <= frames
    && Number.isFinite(b.intensity) && (i === 0 || b.frame >= list[i - 1].frame))) return null;
  const median = (v) => { v = v.slice().sort((a, b) => a - b); const m = v.length >> 1; return v.length ? (v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2) : null; };
  const db = (x) => (x === null ? null : +x.toFixed(1));
  let top = 0;
  list.forEach((b, i) => { if (b.intensity > list[top].intensity) top = i; });
  // The beat each cell's change counts in: of the beats holding the cell before
  // it and the cell, the more intense, the cell's own on a tie; -1 outside every beat.
  const beatAt = (f) => { let j = -1; list.forEach((b, i) => { if (b.frame <= f && f < frames) j = i; }); return j; };
  const owner = cells.map((c, k) => {
    const j = beatAt(c.frame), i = beatAt(cells[k ? k - 1 : k].frame);
    return i >= 0 && j >= 0 && list[i].intensity > list[j].intensity ? i : j;
  });
  // Whether each cell's change counts at all, worked out once per cell.
  const trust = cells.map((_, k) => trustedCell(cells, lumas, k));
  const counts = cells.map((c, k) => trust[k] && c.change != null && (!k || trust[k - 1]));
  const n = sound && sound.squares ? sound.squares.length - 1 : 0, rate = n && n / sound.seconds, half = Math.round(rate * 0.025);
  return list.map((b, i) => {
    const end = i + 1 < list.length ? list[i + 1].frame : frames, seconds = b.frame / hz, endSeconds = end / hz;
    const change = cells.filter((c, k) => counts[k] && owner[k] === i).map((c) => c.change);
    const beat = { frame: b.frame, end, seconds, endSeconds, intensity: b.intensity, peak: i === top, cells: change.length,
      change: { max: change.length ? Math.max(...change) : null, median: median(change) } };
    if (sound) {
      const hits = sound.events.filter((e) => e.seconds >= seconds && e.seconds < endSeconds).map((e) => e.peakDb), rms = [];
      const C = sound.rms.length, from = Math.round(seconds * rate), to = Math.round(endSeconds * rate);
      for (let c = 0; c < C; c++) {
        const mid = ((c + 0.5) * sound.seconds) / C;
        if (mid < seconds || mid >= endSeconds) continue;
        if (!n) { rms.push(sound.rms[c]); continue; }
        // Column c's 50 ms window as the sound picture takes it, cut at the beat's edges.
        const a = Math.floor((c * n) / C), m = (a + Math.max(a + 1, Math.floor(((c + 1) * n) / C))) >> 1;
        const w0 = Math.max(0, m - half, from), w1 = Math.max(w0 + 1, Math.min(n, m + half, to));
        rms.push(10 * Math.log10(Math.max(1e-12, (sound.squares[w1] - sound.squares[w0]) / (w1 - w0))));
      }
      beat.events = hits.length;
      beat.loudestDb = hits.length ? Math.max(...hits) : null;
      beat.rmsDb = { max: db(rms.length ? Math.max(...rms) : null), median: db(median(rms)) };
    }
    return beat;
  });
}

/**
 * The film scaffold's sound rows, `rows` (the built state's `cues.sounds`),
 * split into three stems the --sound strip renders apart: `events`, every
 * other voice; `bed`, the voices that swell in, with an attack of 0.5 s or
 * more, as the guide's bed does; and `ambience`, the rows with an `ambience`. Rows marked with a `role`
 * (music, sting) go in no stem. Null unless `rows` is a non-empty list of
 * objects, each with a `voice` or an `ambience` object. Serialized into the
 * --sound strip page, so it reads nothing beyond its argument.
 */
function soundStems(rows) {
  const object = (o) => o !== null && typeof o === 'object';
  if (!Array.isArray(rows) || !rows.length || !rows.every((r) => object(r) && (object(r.voice) || object(r.ambience)))) return null;
  // A voice that takes this long to swell in is a bed; a caused voice, even one
  // held a second, starts faster than that.
  const SWELL = 0.5;
  const stems = { events: [], bed: [], ambience: [] };
  for (const r of rows) {
    if (r.role) continue;
    if (object(r.ambience)) stems.ambience.push(r);
    else stems[(r.voice.attack ?? 0) >= SWELL ? 'bed' : 'events'].push(r);
  }
  return stems;
}

/**
 * Each shot's loudest events, bed and ambience, and how far the bed and the
 * ambience sit under the events, against the guide's minimums. `spans` are
 * { shot, start, end } in frames at `hz`; `stems` is { rate, events, bed,
 * ambience }, each of the three soundSquares' prefix of that stem rendered
 * alone. A stem's level in a span is its loudest 50 ms mean power there (in
 * 10 ms steps, the whole span when shorter), in dB to 0.1, null under -90 dB.
 * `bedGapDb` and `ambienceGapDb` are the events' level minus the bed's and the
 * ambience's, null when either is; `short` names 'bed' under 10 dB and
 * 'ambience' under 20 dB. Serialized into the --sound strip page.
 */
function shotGaps(spans, hz, stems) {
  // The guide's minimums: a bed 10 to 20 dB under the events, an ambience 20 dB or more.
  const BED = 10, AMBIENCE = 20;
  const rate = stems.rate, w = Math.round(0.05 * rate), step = Math.max(1, Math.round(0.01 * rate));
  const db = (x) => (x === null ? null : +x.toFixed(1));
  const loudest = (squares, a, b) => {
    b = Math.min(b, squares.length - 1);
    if (b <= a) return null;
    const n = Math.min(w, b - a);
    let top = 0;
    for (let s = a; ; s = Math.min(s + step, b - n)) {
      top = Math.max(top, (squares[s + n] - squares[s]) / n);
      if (s === b - n) break;
    }
    const level = 10 * Math.log10(Math.max(1e-12, top));
    return level < -90 ? null : db(level);
  };
  return spans.map((s) => {
    const a = Math.round((s.start / hz) * rate), b = Math.round((s.end / hz) * rate);
    const eventsDb = loudest(stems.events, a, b), bedDb = loudest(stems.bed, a, b), ambienceDb = loudest(stems.ambience, a, b);
    const gap = (x) => (eventsDb === null || x === null ? null : db(eventsDb - x));
    const bedGapDb = gap(bedDb), ambienceGapDb = gap(ambienceDb);
    const short = [...(bedGapDb !== null && bedGapDb < BED ? ['bed'] : []), ...(ambienceGapDb !== null && ambienceGapDb < AMBIENCE ? ['ambience'] : [])];
    return { shot: s.shot, start: s.start, end: s.end, eventsDb, bedDb, ambienceDb, bedGapDb, ambienceGapDb, short };
  });
}

/**
 * The silent stretches of a soundtrack: where the channels' mean power over
 * consecutive 50 ms blocks (from 0, the last block cut at the track's end)
 * stays under -60 dBFS, the floor of the strip's RMS line, for 0.5 s or more.
 * `squares` is soundSquares' prefix at `rate` samples a second. Each stretch
 * is { from, to } in seconds to 0.001; a silent track is one stretch from 0 to
 * its length, and a track with no samples has none. Serialized into the
 * --sound strip page.
 */
function silentSpans(squares, rate) {
  const FLOOR = -60, LEAST = 0.5;
  const n = squares.length - 1, w = Math.max(1, Math.round(0.05 * rate)), spans = [];
  let start = null;
  for (let a = 0; a < n; a += w) {
    const b = Math.min(n, a + w), quiet = 10 * Math.log10(Math.max(1e-12, (squares[b] - squares[a]) / (b - a))) < FLOOR;
    if (quiet && start === null) start = a;
    if ((!quiet || b === n) && start !== null) {
      const end = quiet ? b : a;
      if ((end - start) / rate >= LEAST) spans.push({ from: +(start / rate).toFixed(3), to: +(end / rate).toFixed(3) });
      start = null;
    }
  }
  return spans;
}

/**
 * The sound events in `channels` at `rate` Hz and the shape of each, so a
 * soundtrack can be compared with a reference by numbers. The envelope is the
 * channels' mean power over 5 ms around each millisecond, in dB, silence at
 * -120 after the track; 5 ms holds half a period of 100 Hz, and a lower tone
 * ripples in it, by about 15 dB at 20 Hz. An event is an envelope peak within
 * 50 dB of the loudest point, the first point within 1 dB of the highest in
 * 50 ms either side (so a held sound peaks where its rise ends), that highest
 * point at least 12 dB above the lowest point in the track's 50 ms before of
 * the power over 25 ms, half a period of 20 Hz, so a steady low tone's ripple
 * is no event and neither is sound that holds its level from the track's start
 * (a peak found the same way in the track's first difference, 0 at the first
 * sample and tilted 6 dB per octave toward the highs, also counts where the
 * whole signal has none within 50 ms, unless one sample's difference holds
 * over half of its 5 ms window's and the first difference's power over the
 * 5 ms after that sample stays under 12 dB over the 5 ms before it, so a
 * bright hit under a loud low bed's ripple, or over a low sound's decaying
 * tail, is one at any phase of that ripple and of its own onset, while a
 * sound cut, stepped or flipped mid-waveform is none, its
 * seconds, attack, decay and span measured on that envelope and its peakDb
 * on the plain one);
 * one there is an event when the level it falls back to is 12 dB under that
 * point: the lowest 25 ms mean while, in 50 ms steps from the peak, one of
 * every two steps ends lower than any before, however slowly. Each
 * event gives `seconds`, that first point, and `peakDb`, the highest point in
 * the 50 ms from it; `attackMs`, from its onset, the last point before
 * `seconds` within 3 dB of the lowest level in the 50 ms before it, or 20 dB
 * under the peak when that is later; `decayMs`, from `seconds` to the first
 * point 20 dB under the peak before the next event; `octaves`, each octave
 * band's share of the power from 31 Hz to 16 kHz over the event's span, from
 * the onset to where the envelope first comes back to either level, at most
 * 8192 samples, weighted fully from its start so an onset keeps its share and
 * faded over its last quarter; and `centroidHz`, that power's mean frequency.
 * An event at the track's start that counts only because it falls takes that
 * level as the level under it, so a bed under it stays out of its attack, span
 * and octaves, short decay or long, as it does for the same hit later in the
 * track, though its attack can read 1 ms shorter, its rise cut by the track's
 * first sample. `median` is each value's median over the events that have it. Serialized
 * into the --sound strip page and the --sound-reference page, each of which
 * must define SOUND_HELPERS (soundSquares and soundFft) beside it.
 * `squares` is optional, as in soundPicture.
 */
function soundProfile(channels, rate, squares) {
  const C = channels.length, n = C ? channels[0].length : 0;
  const B = Math.max(1, Math.round(rate / 1000)), K = Math.floor(n / B), half = Math.round(2.5 * B);
  if (!squares) squares = soundSquares(channels);
  // `bright` sums the mean square of each channel's first difference, which
  // tilts the spectrum 6 dB per octave toward the highs, so a bright hit
  // rises out of a loud low bed there. The difference is 0 at the first
  // sample, so a track that starts mid-waveform gains no step there.
  const bright = new Float64Array(n + 1);
  for (let i = 1; i < n; i++) {
    let sum = 0;
    for (const ch of channels) { const d = ch[i] - ch[i - 1]; sum += d * d; }
    bright[i + 1] = bright[i] + sum / C;
  }
  // `env` over 5 ms; `mean` over 25 ms, half a period of 20 Hz, where a low tone's ripple in `env` evens out.
  const env = new Float64Array(K), mean = new Float64Array(K), brightEnv = new Float64Array(K), brightMean = new Float64Array(K);
  const level = (sums, mid, h) => 10 * Math.log10(Math.max(1e-12, (sums[Math.min(n, mid + h)] - sums[Math.max(0, mid - h)]) / (2 * h)));
  for (let k = 0; k < K; k++) {
    const mid = k * B + (B >> 1);
    env[k] = level(squares, mid, half); mean[k] = level(squares, mid, 5 * half);
    brightEnv[k] = level(bright, mid, half); brightMean[k] = level(bright, mid, 5 * half);
  }
  let loudest = -Infinity;
  for (let k = 0; k < K; k++) loudest = Math.max(loudest, env[k]);
  // The peaks of envelope `E` with its 25 ms mean `M`, each to be measured on `E`.
  const peaksOf = (E, M) => {
    const found = [];
    for (let k = 0; k < K; k++) {
      if (env[k] < loudest - 50) continue;
      // The first point within 1 dB of the highest in 50 ms either side, so a
      // sound that rises and holds its level peaks where its rise ends, not at
      // whichever ripple of its sustain stands highest.
      let top = -Infinity, low = Infinity;
      for (let j = Math.max(0, k - 50); j <= Math.min(K - 1, k + 50); j++) top = Math.max(top, E[j]);
      let first = E[k] >= top - 1;
      for (let j = Math.max(0, k - 50); first && j < k; j++) first = E[j] < top - 1;
      for (let j = Math.max(0, k - 50); j < k; j++) low = Math.min(low, M[j]);
      // A sound in the track's first 50 ms has no 50 ms before it. Walk its 25 ms
      // mean forward in 50 ms steps for as long as one of every two steps ends
      // lower than any step before, so the walk crosses a quick next hit but not
      // a level that holds: the lowest point on the way, until the walk stops or
      // the track ends, is the level it falls back to. It is an event when that level is 12 dB
      // under its peak, so a hit at the first sample is one, short or long, also
      // when more hits follow; sound that holds its level from the start, a bed
      // or room tone, is no event, nor one that holds and then fades. The walk
      // also stops 23 dB under the peak: from there the event's rest level is
      // 20 dB under its peak however much lower it goes, so a long fade from
      // the first sample costs no more than its first 23 dB.
      let start = false, under = low;
      if (first && k < 50 && low > top - 12) {
        under = Infinity;
        for (let j = k, lowest = top, miss = 0; j < K - 1 && miss < 2 && under > top - 23; ) {
          const to = Math.min(K - 1, j + 50);
          while (j < to) under = Math.min(under, M[++j]);
          if (M[j] < lowest) { lowest = M[j]; miss = 0; } else miss++;
        }
        start = under <= top - 12;
      }
      if (first && (low <= top - 12 || start)) found.push({ k, top, start, under, E });
    }
    return found;
  };
  // A peak of the first difference counts where the whole signal has none
  // within 50 ms: a bright hit that does not rise 12 dB over a loud low bed,
  // also over a low sound's decaying tail. Not where one sample's difference
  // holds over half of the 5 ms window's and nothing new sounds after it: a
  // sound cut, gated, spliced or flipped mid-waveform, to silence or to any
  // level, steps once in its first difference and brings no new sound. A hit
  // that starts abruptly on a sample away from zero steps once too, whatever
  // its phase, and then sounds: the first difference's mean power over the
  // 5 ms after that sample stands 12 dB or more over the 5 ms before it.
  const step = ({ k }) => {
    const mid = k * B + (B >> 1), from = Math.max(1, mid - half), to = Math.min(n, mid + half);
    let most = 0, at = from;
    for (let i = from; i < to; i++) {
      let sum = 0;
      for (const ch of channels) { const d = ch[i] - ch[i - 1]; sum += d * d; }
      if (sum / C > most) { most = sum / C; at = i; }
    }
    if (most <= (bright[to] - bright[from]) / 2) return false;
    // bright[i + 1] - bright[i] is sample i's difference, so both sums leave `at` out.
    const before = bright[at] - bright[Math.max(0, at - 2 * half)], after = bright[Math.min(n, at + 1 + 2 * half)] - bright[at + 1];
    return after < 16 * before;
  };
  const plain = peaksOf(env, mean);
  const peaks = plain.concat(peaksOf(brightEnv, brightMean).filter((p) => plain.every((q) => Math.abs(q.k - p.k) > 50) && !step(p))).sort((a, b) => a.k - b.k);
  const N = 8192, fft = soundFft(N), re = new Float64Array(N), im = new Float64Array(N), power = new Float64Array(N / 2 + 1);
  const keys = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const ms = (blocks) => +((blocks * B * 1000) / rate).toFixed(1);
  const events = peaks.map(({ k, top, start, under, E }, e) => {
    const next = e + 1 < peaks.length ? peaks[e + 1].k : K, floor = top - 20;
    // In dBFS whichever envelope found it: the highest point of the whole
    // signal in the 50 ms from the peak, which is `top` for a peak of `env`.
    let peakDb = -Infinity;
    for (let i = k; i <= Math.min(K - 1, k + 50); i++) peakDb = Math.max(peakDb, env[i]);
    // The level under the event: the lowest point of the 50 ms before its peak,
    // silence, a bed or an earlier sound's tail; for an event at the track's
    // start, the level it falls back to, found by the walk above. The onset is
    // the last point before the peak within 3 dB of it, or 20 dB under the peak
    // when that is later; the span ends where the envelope first comes back to either.
    let low = start ? under : Infinity, j = k - 1, d = k + 1, s = k + 1;
    if (!start) for (let i = Math.max(0, k - 50); i < k; i++) low = Math.min(low, E[i]);
    const rest = Math.max(floor, low + 3);
    while (E[j] > rest) j--;
    while (d < next && E[d] > floor) d++;
    while (s < next && E[s] > rest) s++;
    const end = d < next ? d : null;
    const s0 = (j + 1) * B, s1 = Math.min(n, (s < next ? s : Math.min(next, k + 500)) * B, s0 + N), L = s1 - s0, F = L >> 2;
    power.fill(0);
    for (const ch of channels) {
      // Flat from the attack, so an onset transient keeps its weight, then a half-Hann fall over the last quarter.
      for (let i = 0; i < N; i++) { re[i] = i < L ? ch[s0 + i] * (i < L - F ? 1 : 0.5 + 0.5 * Math.cos((Math.PI * (i - (L - F))) / F)) : 0; im[i] = 0; }
      fft(re, im);
      for (let i = 0; i <= N / 2; i++) power[i] += (re[i] * re[i] + im[i] * im[i]) / C;
    }
    // Octave band b, centred on 1000 * 2^b Hz for b from -5 to 4, holds the bins from its centre / sqrt 2 to under its centre * sqrt 2.
    const bands = new Float64Array(keys.length);
    let total = 0, moment = 0;
    for (let i = 1; i <= N / 2; i++) {
      const f = (i * rate) / N, b = Math.floor(Math.log2(f / 1000) + 0.5);
      if (b < -5 || b > 4) continue;
      bands[b + 5] += power[i]; total += power[i]; moment += f * power[i];
    }
    const octaves = {};
    keys.forEach((key, b) => { octaves[key] = total > 0 ? +(bands[b] / total).toFixed(3) : 0; });
    return { seconds: +((k * B + (B >> 1)) / rate).toFixed(3), peakDb: +peakDb.toFixed(1), attackMs: ms(k - j), decayMs: end === null ? null : ms(end - k), centroidHz: total > 0 ? Math.round(moment / total) : null, octaves };
  });
  const median = (values, digits) => {
    const v = values.filter((x) => x !== null).sort((a, b) => a - b), m = v.length >> 1;
    return v.length ? +(v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2).toFixed(digits) : null;
  };
  let octaves = null;
  if (events.length) {
    octaves = {};
    for (const key of keys) octaves[key] = median(events.map((e) => e.octaves[key]), 3);
  }
  return { events, median: { attackMs: median(events.map((e) => e.attackMs), 1), decayMs: median(events.map((e) => e.decayMs), 1), centroidHz: median(events.map((e) => e.centroidHz), 0), octaves } };
}

// A --motion strip: every frame is drawn MOTION.width pixels wide and compared
// with the frame before. Under `still` (mean luma change, 0 to 255) for
// `stillSeconds` or more the film sits still; a frame over `jump` times the
// median change of its drawings jumps.
const MOTION = { width: 160, height: 72, still: 0.25, stillSeconds: 1, jump: 5 };

/**
 * What a film's motion energy shows, from `changes`: for each frame, the mean
 * absolute luma change (0 to 255) from the frame before, 0 for frame 0.
 * A film on twos or threes repeats each drawing, so its repeats change by 0;
 * `step` is the commonest number of frames from one changed frame to the next
 * (at most 4), and `energy` holds each change over the repeats that follow it,
 * so the trace runs at the drawing rate. `median` is the median change of the
 * changed frames that are not cuts. `still` lists each stretch of
 * `rules.stillSeconds` or more whose energy stays under `rules.still`, as
 * { from, to } in seconds; `jumps` each changed frame, not in `cuts` (the
 * frames a shot or the framing cuts on), whose change is over `rules.jump`
 * times the median, as { frame, seconds, change, times }. Serialized into the
 * --motion strip page.
 */
function motionSummary(changes, hz, cuts, rules) {
  const n = changes.length, moved = [], gaps = new Map(), cut = new Set(cuts);
  let last = null;
  for (let f = 1; f < n; f++) {
    if (!(changes[f] > 0)) continue;
    if (!cut.has(f)) moved.push(changes[f]);
    if (last !== null && f - last <= 4) gaps.set(f - last, (gaps.get(f - last) || 0) + 1);
    last = f;
  }
  const step = [...gaps].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map((g) => g[0])[0] || 1;
  const energy = new Array(n).fill(0);
  for (let f = 1, held = 0; f < n; f++) {
    if (changes[f] > 0) { energy[f] = changes[f]; held = 0; }
    else if (++held < step) energy[f] = energy[f - 1];
  }
  moved.sort((a, b) => a - b);
  const median = moved.length ? (moved[(moved.length - 1) >> 1] + moved[moved.length >> 1]) / 2 : 0;
  const still = [], r3 = (v) => +v.toFixed(3);
  for (let f = 1, from = null; f <= n; f++) {
    const quiet = f < n && energy[f] < rules.still;
    if (quiet && from === null) from = f;
    if (!quiet && from !== null) {
      if (f - from >= rules.stillSeconds * hz) still.push({ from: r3(from / hz), to: r3(f / hz) });
      from = null;
    }
  }
  const jumps = [];
  for (let f = 1; f < n; f++) {
    if (median > 0 && !cut.has(f) && changes[f] > rules.jump * median) jumps.push({ frame: f, seconds: r3(f / hz), change: r3(changes[f]), times: +(changes[f] / median).toFixed(1) });
  }
  return { step, median: r3(median), peak: r3(Math.max(0, ...energy)), energy: energy.map(r3), still, jumps };
}

// Serialized into a --motion strip page: draws motionSummary's `sum` on `g`
// across `layout.width`: the energy as a trace on a square-root scale, so a
// quiet stretch still shows beside a cut, the median as a line, still
// stretches shaded and labelled, jumps as red lines and cuts as grey ones.
function drawMotion(g, sum, layout) {
  const W = layout.width, H = layout.height, top = 4, n = sum.energy.length, hz = layout.hz;
  const x = (frame) => (frame / n) * W, top0 = Math.max(sum.peak, 1e-9);
  const y = (v) => top + (H - top) * (1 - Math.sqrt(Math.min(1, v / top0)));
  g.fillStyle = '#0c0d10'; g.fillRect(0, 0, W, H + 16);
  g.fillStyle = 'rgba(120,190,255,0.18)';
  for (const s of sum.still) g.fillRect(x(s.from * hz), top, Math.max(1, x(s.to * hz) - x(s.from * hz)), H - top);
  g.fillStyle = 'rgba(231,228,220,0.35)';
  for (const c of layout.cuts) g.fillRect(Math.round(x(c)), top, 1, H - top);
  g.strokeStyle = 'rgba(255,255,255,0.3)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, Math.round(y(sum.median)) + 0.5); g.lineTo(W, Math.round(y(sum.median)) + 0.5); g.stroke();
  g.strokeStyle = '#f2c14e'; g.lineWidth = 1.5; g.beginPath();
  for (let f = 0; f < n; f++) g[f ? 'lineTo' : 'moveTo'](x(f + 0.5), y(sum.energy[f]));
  g.stroke();
  g.fillStyle = '#e8705a';
  for (const j of sum.jumps) g.fillRect(Math.round(x(j.frame)) - 1, top, 2, H - top);
  g.fillStyle = '#e7e4dc'; g.font = '11px ui-monospace, Consolas, monospace'; g.textBaseline = 'middle'; g.textAlign = 'left';
  for (const s of sum.still) g.fillText('still ' + (s.to - s.from).toFixed(1) + ' s', x(s.from * hz) + 3, top + 8);
  for (const m of layout.marks) g.fillText(String(m.frame), Math.min(W - 30, m.x + 3), H + 8);
}

// The source a page needs to run soundPicture or soundProfile: their two helpers.
// Every page that serializes either one puts this before it.
const SOUND_HELPERS = `${soundSquares.toString()}\n${soundFft.toString()}\n`;

/**
 * Piece `p`'s shot list where the film scaffold keeps it: the built state's
 * `cues.shots`, the list shots() returned, or null when it keeps none or keeps
 * one that does not fit the piece's frames. A piece that fails to build is
 * refused under `tool`'s name; pass `state`, already built at `seed`, to read
 * from it instead of building again. A list that names two shots alike is
 * refused by index and name, as shots() refuses it.
 */
function shotList(p, tool = 'seeds', seed = p.seed, state = builtState(p, tool, seed)) {
  const n = playheads(p).length;
  const list = state && state.cues && state.cues.shots;
  if (!(Array.isArray(list) && list.length && list.every((s) => s && typeof s.name === 'string' && s.name && Number.isInteger(s.start) && Number.isInteger(s.end) && s.start >= 0 && s.end > s.start && s.end <= n))) return null;
  const twice = list.findIndex((s, i) => list.findIndex((o) => o.name === s.name) < i);
  if (twice >= 0) throw refuse(`state.cues.shots entry [${twice}] is a second shot named ${list[twice].name} in ${p.name}; give each shot its own name, as shots() does`);
  return list;
}

/** Piece `p`'s state built at `seed`; a piece that fails to build is refused under `tool`'s name. */
function builtState(p, tool, seed) {
  const solved = solve(p, seed);
  if (solved.stages.error) throw new Error(`${tool}: ${p.name} fails to build at ${solved.stages.error.stage}: ${solved.stages.error.message}`);
  return solved.state;
}

// A --contacts strip shows these frames around each contact, and at most this
// many contact frames: a simulation's whole log is not a strip anyone looks at.
const CONTACT_WINDOW = [-2, -1, 0, 1, 2, 3], MAX_CONTACTS = 24;

/**
 * The contacts piece `p` keeps at `key`, a dotted path into its state built at
 * `seed` (or `state`, already built there), such as `falls`, `cues.hits` or `run.contacts` (a simulation's log):
 * a list of objects, each on a whole `frame` or at `seconds`, within the
 * piece's frames, and optionally at a design point `x`, `y`. Returns one entry
 * per distinct frame in frame order, { frame, count, point }, `point` the
 * first point among that frame's contacts or null. Anything else at `key`, an
 * entry with no frame, one outside the film or more than MAX_CONTACTS frames
 * is refused by name.
 */
function contactList(p, key, seed = p.seed, state = builtState(p, 'seeds', seed)) {
  const n = playheads(p).length;
  const list = key.split('.').reduce((v, k) => (v !== null && v !== undefined && Object.hasOwn(Object(v), k) ? v[k] : undefined), state);
  if (!Array.isArray(list) || !list.length) {
    throw refuse(`--contacts ${key} names ${list === undefined ? 'nothing' : Array.isArray(list) ? 'an empty list' : 'no list'} in ${p.name}'s built state; name a list of contacts, each on a frame or at seconds`);
  }
  const byFrame = new Map();
  list.forEach((c, i) => {
    const frame = c && Number.isInteger(c.frame) ? c.frame : c && Number.isFinite(c.seconds) ? Math.floor(c.seconds * p.time.hz + 1e-6) : NaN;
    if (!Number.isInteger(frame)) throw refuse(`--contacts ${key}: entry [${i}] has no whole frame or finite seconds`);
    if (frame < 0 || frame >= n) throw refuse(`--contacts ${key}: entry [${i}] is on frame ${frame}, outside ${p.name}'s ${n} frames`);
    const point = Number.isFinite(c.x) && Number.isFinite(c.y) ? { x: c.x, y: c.y } : null;
    const got = byFrame.get(frame);
    if (got) { got.count++; got.point ??= point; } else byFrame.set(frame, { frame, count: 1, point });
  });
  if (byFrame.size > MAX_CONTACTS) {
    throw refuse(`--contacts ${key} lists ${list.length} contacts on ${byFrame.size} frames, and a strip shows up to ${MAX_CONTACTS} contact frames; name a shorter list, such as the planned contacts, or pick frames with --at`);
  }
  return [...byFrame.values()].sort((a, b) => a.frame - b.frame);
}

// --armature's rules. `line`: a front-view bend joint's picture distance from
// the line through its two neighbouring joints, as a share of the distance
// between those neighbours. `stretch`: a segment's 3D length change from the
// frame before, as a share of its length then. `slide`: how far a planted end
// moves from the frame before, in design units. Starting values, not measured on films.
const ARMATURE_RULES = { line: 0.05, stretch: 0.01, slide: 0.5 };
// --armature prints this many frames with faults; --json lists every one.
const MAX_ARMATURE_LINES = 24;

/**
 * The armature piece `p` keeps in `state.cues.armature`: one entry per frame,
 * each a list of chains (null for none), each chain { name, segments, view,
 * front, limits, reasons, planted } with segments as pose returns them. Returns
 * one list per frame, each chain with its optional keys filled in; anything it
 * cannot read is refused by entry, chain and key.
 */
function armatureList(p, state) {
  const n = playheads(p).length, list = state && state.cues ? state.cues.armature : undefined;
  const head = `--armature reads one armature per frame from state.cues.armature, and ${p.name} keeps`;
  if (list == null) throw refuse(`${head} none there`);
  if (!Array.isArray(list) || list.length !== n) throw refuse(`${head} ${Array.isArray(list) ? list.length : 'no list'} for its ${n} frames`);
  const said = (v) => (typeof v === 'string' ? JSON.stringify(v) : String(v));
  return list.map((entry, i) => {
    const at = `--armature: state.cues.armature entry [${i}]`;
    if (entry === null) return [];
    if (!Array.isArray(entry)) throw refuse(`${at} is not a list of chains`);
    const names = new Set();
    return entry.map((chain, c) => {
      const name = chain && chain.name;
      if (typeof name !== 'string' || !name || names.has(name)) throw refuse(`${at} chain [${c}] needs a name of its own`);
      names.add(name);
      const where = `${at} chain ${name}`, { segments, view = {}, front = null, limits = null, reasons = null, planted = null } = chain;
      if (!view || typeof view !== 'object' || Array.isArray(view)) throw refuse(`${where}: view takes the options project takes, { view, up, focal, centre, perspective }, got ${said(view)}`);
      try { project(segments, view); } catch (e) { throw refuse(`${where}: ${e.message}`); }
      for (let j = 1; j < segments.length; j++) {
        const g = segments[j - 1], d = Math.hypot(...segments[j].start.map((v, k) => v - g.end[k]));
        if (d > 1e-6 * Math.max(1, Math.hypot(...g.end.map((v, k) => v - g.start[k])))) {
          throw refuse(`${where}: segment ${j} starts ${+d.toPrecision(3)} from where segment ${j - 1} ends; a chain's segments join end to start, as pose returns them`);
        }
      }
      const bends = segments.length > 2 ? `bends at joints 1 to ${segments.length - 1}` : segments.length === 2 ? 'bends at joint 1' : 'has no bend joint';
      const keyed = (obj, key, holds, need) => {
        if (obj === null) return {};
        if (typeof obj !== 'object' || Array.isArray(obj)) throw refuse(`${where}: ${key} takes an object keyed by bend joint, got ${said(obj)}`);
        for (const [j, v] of Object.entries(obj)) {
          if (!/^[1-9]\d*$/.test(j) || Number(j) >= segments.length) throw refuse(`${where}: ${key} names joint ${j}, and a chain of ${segments.length} segments ${bends}`);
          if (!holds(v)) throw refuse(`${where}: ${key} [${j}] takes ${need}, got ${said(v)}`);
        }
        return obj;
      };
      if (front !== null && typeof front !== 'boolean') throw refuse(`${where}: takes front: true, false or no front, got front: ${said(front)}`);
      if (planted !== null && planted !== 'start' && planted !== 'end') throw refuse(`${where}: takes planted: 'start', 'end' or no planted, got planted: ${said(planted)}`);
      return {
        name, segments, view, front: front === true, planted,
        limits: keyed(limits, 'limits', (v) => Number.isFinite(v) && v > 0 && v <= Math.PI, 'the largest bend in radians, above 0 and at most pi'),
        reasons: keyed(reasons, 'reasons', (v) => typeof v === 'string' && !!v.trim(), 'a pose reason, a non-empty string'),
      };
    });
  });
}

/**
 * Every joint fault of `frames`, the lists armatureList returns, in frame
 * order, each { frame, chain, kind, joint | segment | end, value, rule }:
 * - line: a bend joint of a `front` chain, with no reason for it, lying off the
 *   picture line between its two neighbouring joints by more than rules.line of
 *   their distance;
 * - limit: a joint bending more than its limit, in radians, in 3D;
 * - length: a segment whose 3D length changed by more than rules.stretch of it
 *   since the frame before, for a chain of the same name and segment count there;
 * - slide: a planted end moved more than rules.slide design units since the
 *   frame before, for a chain planted at the same end there.
 * `opens` lists the frames that open a shot, never compared with the frame before.
 */
function jointFaults(frames, opens = [], rules = ARMATURE_RULES) {
  const sub = (p, q) => p.map((v, k) => v - q[k]), len = (v) => Math.hypot(...v);
  const end = (ch) => (ch.planted === 'start' ? ch.segments[0].start : ch.segments[ch.segments.length - 1].end);
  const faults = [];
  frames.forEach((chains, frame) => {
    const before = frame > 0 && !opens.includes(frame) ? frames[frame - 1] : [];
    for (const ch of chains) {
      const g = ch.segments, n = g.length, chain = ch.name;
      if (ch.front) {
        const pic = project(g, ch.view).segments, P = [pic[0].a, ...pic.map((s) => s.b)];
        for (let j = 1; j < n; j++) {
          const [ax, ay] = sub(P[j + 1], P[j - 1]), [bx, by] = sub(P[j], P[j - 1]), span = Math.hypot(ax, ay);
          if (ch.reasons[j] || span < 1e-9) continue;
          const value = Math.abs(ax * by - ay * bx) / (span * span);
          if (value > rules.line) faults.push({ frame, chain, kind: 'line', joint: j, value: +value.toFixed(3), rule: rules.line });
        }
      }
      for (const [j, limit] of Object.entries(ch.limits)) {
        const u = sub(g[j - 1].end, g[j - 1].start), v = sub(g[j].end, g[j].start);
        const angle = Math.acos(Math.min(1, Math.max(-1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (len(u) * len(v)))));
        if (angle > limit) faults.push({ frame, chain, kind: 'limit', joint: Number(j), value: +angle.toFixed(3), rule: limit });
      }
      const was = before.find((o) => o.name === chain);
      if (was && was.segments.length === n) {
        g.forEach((s, segment) => {
          const then = len(sub(was.segments[segment].end, was.segments[segment].start)), change = Math.abs(len(sub(s.end, s.start)) - then) / then;
          if (change > rules.stretch) faults.push({ frame, chain, kind: 'length', segment, value: +change.toFixed(4), rule: rules.stretch });
        });
      }
      if (ch.planted && was && was.planted === ch.planted) {
        const d = len(sub(end(ch), end(was)));
        if (d > rules.slide) faults.push({ frame, chain, kind: 'slide', end: ch.planted, value: +d.toFixed(2), rule: rules.slide });
      }
    }
  });
  return faults;
}

/** The lines seeds prints for `faults` over a film of `frames` frames at `hz` (null for a still). */
function armatureText(faults, frames, hz) {
  const R = ARMATURE_RULES, byFrame = new Map();
  for (const f of faults) byFrame.set(f.frame, [...(byFrame.get(f.frame) || []), f]);
  if (!byFrame.size) return [`armature: no joint faults on ${frames} frames`];
  const says = {
    line: (f) => `${f.chain} joint ${f.joint} leaves the line between its neighbours by ${f.value} of their span in a front view, with no pose reason`,
    limit: (f) => `${f.chain} joint ${f.joint} bends ${f.value} rad, past its limit of ${f.rule}`,
    length: (f) => `${f.chain} segment ${f.segment} changes length by ${f.value} of it since the frame before`,
    slide: (f) => `${f.chain} planted ${f.end} slides ${f.value} design units since the frame before`,
  };
  const lines = [`armature: ${byFrame.size} of ${frames} frames with joint faults (rules: line ${R.line} of the span in a front view, length ${R.stretch}, slide ${R.slide} design units)`];
  for (const [frame, list] of [...byFrame].slice(0, MAX_ARMATURE_LINES)) {
    lines.push(`${hz ? `frame ${frame} (${(frame / hz).toFixed(3)} s)` : 'the still'}: ${list.map((f) => says[f.kind](f)).join('; ')}`);
  }
  if (byFrame.size > MAX_ARMATURE_LINES) lines.push(`... and ${byFrame.size - MAX_ARMATURE_LINES} more frames with joint faults; --json lists every one in strip.armature.faults`);
  return lines;
}

/**
 * The level the film export gives the soundtrack, from film.normalizeLoudness, as
 * the seeds caption and terminal line both say it. Serialized into the page.
 */
function levelText(level) {
  return level.lufs === null ? 'silent, kept as rendered'
    : 'gain ' + level.gain + ' dB' + (level.limited ? ', limited by up to ' + level.limited + ' dB' : '') + ', ' + level.lufs + ' LUFS';
}

const MAX_FAILURE_LINES = 3;
/** The lines seeds prints for a sheet with failures: each distinct error with the cells it hit, the soundtrack's included. */
function failureText(sheet) {
  const byError = new Map(), hz = sheet.strip && sheet.strip.hz;
  const hit = (error, where) => byError.set(error, [...(byError.get(error) || []), where]);
  // A sweep's cells share one seed, so each is told apart by its parameter values, as its label on the sheet is.
  const given = (params) => Object.entries(params || {}).map(([key, value]) => ` ${key}=${value}`).join('');
  for (const c of sheet.cells) if (c.error) hit(c.error, `${c.name} seed ${c.seed}${given(c.params)}${hz ? ` frame ${c.frame} (${c.seconds.toFixed(3)} s)` : ''}`);
  if (sheet.sound && sheet.sound.error) hit(sheet.sound.error, 'the soundtrack');
  const all = [...byError];
  const lines = all.slice(0, MAX_FAILURE_LINES).map(([error, where]) => `failed: ${error} -- ${where.join(', ')}`);
  if (all.length > MAX_FAILURE_LINES) lines.push(`... and ${all.length - MAX_FAILURE_LINES} more distinct errors; --json gives each cell's in cells[].error`);
  return lines;
}

/**
 * One entry of `state.cues.views` as --plan and --cuts read it: null when it is
 * not { x, y, zoom } with finite numbers and a zoom above 0; else the view with
 * its zoom times its `dolly` (1 when missing), the scale of the subject's
 * plane, depth 1, as the film scaffold's FOCUS check scales it. A dolly that is
 * not a finite number above 0 is refused by index, named for `tool`.
 */
function normalView(v, i, tool) {
  if (!(v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.zoom) && v.zoom > 0)) return null;
  if (v.dolly === undefined) return v;
  if (!(Number.isFinite(v.dolly) && v.dolly > 0)) {
    throw refuse(`${tool}: state.cues.views entry [${i}] takes a dolly that is a finite number above 0 or no dolly, got dolly: ${JSON.stringify(v.dolly) ?? String(v.dolly)}`);
  }
  return { ...v, zoom: v.zoom * v.dolly };
}

// A line of attention whose two ends are under this share of the frame's
// width apart on screen is seen head-on, so the next shot may take either side.
// A starting value no film has calibrated.
const HEAD_ON = 1 / 20;

/**
 * Film `p`'s view on every frame over the place, built at `seed`, for --plan:
 * the built state's `cues.views`, one { x, y, zoom } per frame (the design
 * point at the frame's centre and the zoom, `cut: true` on a frame the framing
 * cuts on, `key: true` on a camera key's frame), as the film scaffold keeps
 * it. A view may also carry `dolly` (a finite number above 0, default 1): the
 * view follows the subject's plane, depth 1, which scales by zoom * dolly, so
 * the returned `views` hold that product as `zoom`. A frame's step is how far the
 * view's farthest-moving corner travels from the frame before, in widths of
 * this frame (w / zoom), so a pan and a zoom count alike. A frame marked
 * cut: true steps 0, which ends a move and keeps its jump out of every peak.
 * A piece marks cut: true only where the framing cuts; a cut between shots
 * inside one camera move is in cues.shots, not marked, and its move stays whole.
 * Returns { name, seed, frames, hz, size, box, views, shots, moves, beats, peak }:
 * `box` the union of the design box and every view; `moves` each run of
 * frames whose step is over 1e-9, split on each key frame (or, where no
 * frame is marked key, on each frame where the step falls from the frame
 * before and later rises strictly again, measured past a flat run of equal
 * steps to the next step that differs, so a slowdown into a steady drift is
 * one move), so one move's
 * `to` is the next one's `from`: { from, to, peak }, `peak` its fastest step
 * in frame widths per second; `beats` each of `cues.beats` (when every beat
 * has a whole frame in the film and a finite intensity, in frame order; else
 * none), with the `move` it falls in or null, the view's `speed` there in
 * frame widths per second and its `share` of that move's peak. The step into
 * a beat's frame counts against the move that ends there or runs through it,
 * the step out against the move that starts there or runs through it, and a
 * beat on a key between two moves takes the side with the larger share (at
 * rest, `speed` is the faster step). A beat on the film's last
 * instant is measured on its last frame. `peak` is the first beat at the
 * highest intensity, or null. `blocking` holds each of `cues.blocking`, the
 * film scaffold's BLOCKING rows { shot, marks: { name: [x, y] }, line: [name,
 * name], cross? } (when every row names a shot and its line two different
 * names of its finite marks; else none), in shot order: { shot, frame, line,
 * marks, left, cross, wrong, after, was }, `left` the line's end on the left on
 * screen in the shot's first view or null head-on (ends under HEAD_ON of the
 * frame's width apart), `wrong` true when an earlier shot of the same two ends
 * put the other end, `was`, on the left, in shot `after`, and this row names
 * no crossing with cross: true. A flagged shot leaves the side as it was. The
 * design box takes in every mark of those rows. When a row fails, `blocking`
 * is empty and `blockingLeftOut` names the first bad row; else it is null. A
 * still, a film with no `cues.views`, one with
 * a view per frame missing or one with a view that is not finite numbers and
 * a zoom above 0 is refused by name.
 */
function viewPlan(p, seed = p.seed) {
  if (!p.time) throw refuse(`--plan draws a film's view across its frames, and ${p.name} is a still`);
  const state = builtState(p, 'seeds', seed), n = playheads(p).length, { hz } = p.time, { w, h } = p.size;
  const kept = state && state.cues && state.cues.views;
  if (!Array.isArray(kept)) throw refuse(`--plan reads ${p.name}'s view on every frame from state.cues.views, one { x, y, zoom } per frame, and ${p.name} keeps none there`);
  if (kept.length !== n) throw refuse(`--plan reads one view per frame from state.cues.views, and ${p.name} keeps ${kept.length} for its ${n} frames`);
  const views = kept.map((v, i) => {
    const seen = normalView(v, i, '--plan');
    if (!seen) throw refuse(`--plan: state.cues.views entry [${i}] is not { x, y, zoom } with finite numbers and a zoom above 0`);
    for (const mark of ['cut', 'key']) {
      if (v[mark] !== undefined && v[mark] !== true) throw refuse(`--plan: state.cues.views entry [${i}] takes ${mark}: true or no ${mark}, got ${mark}: ${JSON.stringify(v[mark]) ?? String(v[mark])}`);
    }
    return seen;
  });
  const corners = (v) => [-1, 1].flatMap((sx) => [-1, 1].map((sy) => [v.x + (sx * w) / (2 * v.zoom), v.y + (sy * h) / (2 * v.zoom)]));
  // How far view b's farthest-moving corner lies from view a's, in widths of b.
  const gap = (a, b) => { const p = corners(a), q = corners(b); return Math.max(...p.map(([x, y], k) => Math.hypot(q[k][0] - x, q[k][1] - y))) / (w / b.zoom); };
  const keyed = views.some((v) => v.key), below = (a, b) => a < b - 1e-9;
  // cut: true marks a cut of the framing, and only that: the jump is no step of
  // a move, and the move before it ends there. A cut between shots that leaves
  // the camera path alone is not marked, so its move runs on through it.
  const step = (f) => (views[f].cut ? 0 : gap(views[f - 1], views[f]));
  const steps = views.map((_, f) => (f ? step(f) : 0));
  // A move ends on a frame marked key: true; with no frame so marked, on each
  // frame where the step falls from the frame before and later rises again,
  // measured past a flat run to the next step that differs, past 1e-9 so
  // rounding along an even pan splits nothing.
  const rises = (f) => { for (let g = f + 1; g < n; g++) if (Math.abs(steps[g] - steps[f]) > 1e-9) return below(steps[f], steps[g]); return false; };
  const ends = (f) => (keyed ? views[f].key === true : f > 0 && below(steps[f], steps[f - 1]) && rises(f));
  const moves = [];
  for (let f = 1; f < n; f++) {
    if (!(steps[f] > 1e-9)) continue;
    const last = moves[moves.length - 1];
    if (last && last.to === f - 1 && !ends(f - 1)) { last.to = f; last.peak = Math.max(last.peak, steps[f] * hz); } else moves.push({ from: f - 1, to: f, peak: steps[f] * hz });
  }
  const shots = shotList(p, 'seeds', seed, state), rows = state.cues.blocking;
  const shotOf = (r) => shots && shots.find((s) => s.name === r.shot);
  const mark = (q) => Array.isArray(q) && q.length === 2 && q.every(Number.isFinite);
  const rowFits = (r, i, all) => r && shotOf(r) && all.findIndex((q) => q && q.shot === r.shot) === i && r.marks && typeof r.marks === 'object' && !Array.isArray(r.marks) && Object.values(r.marks).every(mark)
    && Array.isArray(r.line) && r.line.length === 2 && r.line[0] !== r.line[1] && r.line.every((m) => typeof m === 'string' && Object.hasOwn(r.marks, m));
  const usable = Array.isArray(rows) && rows.every(rowFits);
  // One bad row leaves every row out; blockingLeftOut says so, naming the first bad row (counted from 1; a repeated shot is bad).
  const blockingLeftOut = usable || rows === undefined || (Array.isArray(rows) && !rows.length) ? null
    : Array.isArray(rows) ? `row ${rows.findIndex((r, i, all) => !rowFits(r, i, all)) + 1} of ${rows.length}` : 'it is not a list of rows';
  // The marks of the usable rows count toward the box, so none is drawn off the sheet.
  const spots = usable ? rows.flatMap((r) => Object.values(r.marks)).map(([x, y]) => [x, y, x, y]) : [];
  const rects = [[0, 0, w, h], ...spots, ...views.map((v) => [v.x - w / (2 * v.zoom), v.y - h / (2 * v.zoom), v.x + w / (2 * v.zoom), v.y + h / (2 * v.zoom)])];
  const box = { x0: Math.min(...rects.map((r) => r[0])), y0: Math.min(...rects.map((r) => r[1])), x1: Math.max(...rects.map((r) => r[2])), y1: Math.max(...rects.map((r) => r[3])) };
  const list = state.cues.beats;
  const fit = Array.isArray(list) && list.every((b, i) => b && Number.isInteger(b.frame) && b.frame >= 0 && b.frame <= n
    && Number.isFinite(b.intensity) && (i === 0 || b.frame >= list[i - 1].frame));
  const beats = (fit ? list : []).map((b, index) => {
    const frame = Math.min(b.frame, n - 1), out = frame + 1 < n ? steps[frame + 1] : 0;
    // The step into the frame belongs to the move that ends on or runs through it, the step out to the move
    // that starts on or runs through it; a beat on a key between two moves keeps the side with the larger share.
    const side = [[steps[frame], moves.findIndex((m) => m.from < frame && frame <= m.to)], [out, moves.findIndex((m) => m.from <= frame && frame < m.to)]]
      .filter(([, k]) => k >= 0).map(([s, k]) => ({ speed: hz * s, move: k, share: (hz * s) / moves[k].peak }))
      .reduce((a, s) => (a && a.share >= s.share ? a : s), null);
    const { speed, move, share } = side || { speed: hz * Math.max(steps[frame], out), move: null, share: null };
    return { index, frame, seconds: frame / hz, element: b.element, changes: b.changes, intensity: b.intensity, speed, move, share };
  });
  let peak = null;
  beats.forEach((b, i) => { if (peak === null || b.intensity > beats[peak].intensity) peak = i; });
  // The side each line was last seen from, by its two ends sorted: the end on the left, or null head-on.
  const sides = new Map();
  const blocking = (usable ? [...rows].sort((a, b) => shotOf(a).start - shotOf(b).start) : []).map((r) => {
    const frame = shotOf(r).start, [a, b] = [...r.line].sort(), key = `${a}\u0000${b}`, before = sides.get(key);
    const gap = (views[frame].zoom * (r.marks[b][0] - r.marks[a][0])) / w;
    const left = Math.abs(gap) < HEAD_ON ? null : gap > 0 ? a : b;
    const wrong = left !== null && !r.cross && !!before && before.left !== null && before.left !== left;
    // A flagged shot leaves the side the line was set on.
    if (!wrong) sides.set(key, { shot: r.shot, left });
    return { shot: r.shot, frame, line: r.line, marks: r.marks, left, cross: r.cross === true, wrong, after: wrong ? before.shot : null, was: wrong ? before.left : null };
  });
  return { name: p.name, seed, frames: n, hz, size: { w, h }, box, views, shots, moves, beats, peak, blocking, blockingLeftOut };
}

/** viewPlan's `plan` as lines: one per beat, one per move, one per blocking row, and a line when it has no beat or no move. */
function planText(plan) {
  const lines = plan.beats.map((b) => `beat ${b.index + 1} at ${b.seconds.toFixed(2)} s (${b.element}: ${b.changes}): `
    + (b.move === null ? 'at rest' : `${b.speed.toFixed(2)} frame widths/s, ${Math.round(100 * b.share)}% of the peak of move ${b.move + 1}`));
  plan.moves.forEach((m, k) => lines.push(`move ${k + 1}: frames ${m.from} to ${m.to} (${(m.from / plan.hz).toFixed(2)} to ${(m.to / plan.hz).toFixed(2)} s), peak ${m.peak.toFixed(2)} frame widths/s`));
  for (const r of plan.blocking || []) {
    const line = `the line ${r.line[0]} to ${r.line[1]}`;
    lines.push(r.left === null ? `shot ${r.shot}: head-on to ${line}` : `shot ${r.shot}: ${r.left} on the left of ${line}${r.cross ? ', a named crossing' : ''}`
      + (r.wrong ? `, on the wrong side of the line after ${r.after}: name the crossing with cross: true, or put ${r.was} back on the left` : ''));
  }
  if (plan.blockingLeftOut) lines.push(`state.cues.blocking left out (${plan.blockingLeftOut}): every row needs its own shot of the film, marks as { name: [x, y] } with finite numbers, and a line of two different names of its marks`);
  if (!plan.beats.length) lines.push('no beats in state.cues.beats');
  if (!plan.moves.length) lines.push('no move: the view holds');
  return lines;
}

/**
 * viewPlan's `plan` as a self-contained page with no script: one SVG of the
 * place in design units, y down, with the design box, each shot's first view
 * dashed, the frame centres as a path broken at each cut and a dot per frame,
 * a cross at each cut, each beat ringed and its view boxed, the peak's in
 * amber, each blocking row's line of attention between its marks, red on the
 * wrong side, and each distinct mark point once as a square with one label
 * naming every shot's mark there; then planText's lines.
 */
function planPage(plan) {
  const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const { box, views, size: { w, h } } = plan;
  const side = Math.max(box.x1 - box.x0, box.y1 - box.y0), pad = 0.04 * side;
  const vb = [box.x0 - pad, box.y0 - pad, box.x1 - box.x0 + 2 * pad, box.y1 - box.y0 + 2 * pad];
  // Dots small enough that a pan's eased frames stay apart where it is fast.
  const big = Math.max(vb[2], vb[3]), font = 0.018 * big, dot = 0.0015 * big, n = (v) => +v.toFixed(3);
  const rect = (v, attrs) => `<rect x="${n(v.x - w / (2 * v.zoom))}" y="${n(v.y - h / (2 * v.zoom))}" width="${n(w / v.zoom)}" height="${n(h / v.zoom)}" ${attrs} vector-effect="non-scaling-stroke"/>`;
  const label = (x, y, text, fill) => `<text x="${n(x)}" y="${n(y)}" font-size="${n(font)}" fill="${fill}">${esc(text)}</text>`;
  const parts = [`<rect x="0" y="0" width="${w}" height="${h}" fill="none" stroke="#8e8f99" vector-effect="non-scaling-stroke"/>`, label(0, -font * 0.4, `design box ${w} × ${h}`, '#8e8f99')];
  for (const shot of plan.shots || [{ name: '', start: 0 }]) {
    const v = views[shot.start];
    parts.push(rect(v, 'fill="none" stroke="#e7e4dc" stroke-dasharray="6 4"'), label(v.x - w / (2 * v.zoom) + font * 0.3, v.y - h / (2 * v.zoom) + font * 1.1, shot.name, '#e7e4dc'));
  }
  // The path through the frame centres, broken at every cut.
  const runs = [[]];
  views.forEach((v, f) => { if (v.cut) runs.push([]); runs[runs.length - 1].push(`${n(v.x)},${n(v.y)}`); });
  for (const run of runs) if (run.length > 1) parts.push(`<polyline points="${run.join(' ')}" fill="none" stroke="#2e313b" vector-effect="non-scaling-stroke"/>`);
  views.forEach((v) => parts.push(`<circle cx="${n(v.x)}" cy="${n(v.y)}" r="${n(dot)}" fill="#e7e4dc"/>`));
  // Each cut's label alternates below and above its cross, so two cuts near one place stay readable.
  views.flatMap((v, f) => (v.cut ? [[v, f]] : [])).forEach(([v, f], k) => {
    const shot = (plan.shots || []).find((s) => s.start === f), c = 6 * dot;
    parts.push(`<path d="M${n(v.x - c)},${n(v.y - c)}L${n(v.x + c)},${n(v.y + c)}M${n(v.x - c)},${n(v.y + c)}L${n(v.x + c)},${n(v.y - c)}" stroke="#e8705a" stroke-width="2" vector-effect="non-scaling-stroke"/>`,
      label(v.x + c, k % 2 ? v.y - c - font * 0.4 : v.y + c + font, shot ? `cut to ${shot.name}` : 'camera cut', '#e8705a'));
  });
  plan.beats.forEach((b, i) => {
    const v = views[b.frame], colour = i === plan.peak ? '#e8b25a' : '#e8705a', width = i === plan.peak ? 3 : 1.5;
    parts.push(rect(v, `fill="none" stroke="${colour}" stroke-width="1"`),
      `<circle cx="${n(v.x)}" cy="${n(v.y)}" r="${n(8 * dot)}" fill="none" stroke="${colour}" stroke-width="${width}" vector-effect="non-scaling-stroke"/>`,
      label(v.x - 8 * dot - font * 0.7, v.y - 8 * dot, i + 1, colour));
  });
  // Each shot's line of attention, red on the wrong side; then each distinct mark point once, as a square
  // with one label naming every shot's mark there, so marks that keep their place or swap stay readable.
  const points = new Map();
  for (const r of plan.blocking || []) {
    const [a, b] = r.line.map((m) => r.marks[m]);
    parts.push(`<line x1="${n(a[0])}" y1="${n(a[1])}" x2="${n(b[0])}" y2="${n(b[1])}" stroke="${r.wrong ? '#e8705a' : '#7fb2d9'}" stroke-width="${r.wrong ? 2.5 : 1}" vector-effect="non-scaling-stroke"/>`);
    for (const [name, [x, y]] of Object.entries(r.marks)) {
      const key = `${n(x)},${n(y)}`, point = points.get(key) || points.set(key, { x, y, names: [], wrong: false }).get(key);
      point.names.push(`${name} (${r.shot})`);
      point.wrong ||= r.wrong;
    }
  }
  for (const { x, y, names, wrong } of points.values()) {
    const colour = wrong ? '#e8705a' : '#7fb2d9';
    parts.push(`<rect x="${n(x - 2 * dot)}" y="${n(y - 2 * dot)}" width="${n(4 * dot)}" height="${n(4 * dot)}" fill="${colour}"/>`, label(x + 3 * dot, y - 3 * dot, names.join(', '), colour));
  }
  const text = planText(plan).map((line) => `<p>${esc(line)}</p>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Artifex — ${esc(plan.name)} plan</title>
<style>
:root { --bg: #14151a; --fg: #e7e4dc; --dim: #8e8f99; --line: #2e313b; }
body { margin: 0; padding: 24px; background: var(--bg); color: var(--fg); font: 14px/1.5 system-ui, sans-serif; }
svg { display: block; max-width: 100%; height: auto; background: var(--bg); border: 1px solid var(--line); }
p { margin: 4px 0; } .legend { color: var(--dim); max-width: 72ch; margin: 12px 0; }
</style>
</head>
<body>
<h2>${esc(plan.name)}: the view on each of ${plan.frames} frames at seed ${plan.seed}</h2>
<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(`${plan.name}'s view on each frame over the place, with ${plan.beats.length} beats and ${plan.moves.length} moves`)}" viewBox="${vb.map(n).join(' ')}" width="1200" height="${Math.round((1200 * vb[3]) / vb[2])}" font-family="system-ui, sans-serif">
${parts.join('\n')}
</svg>
<p class="legend">One dot per frame at the frame's centre; along a pan, dots spaced wide are fast travel and dots bunched together are an ease or a rest. A zoom stacks its dots on one centre, so read its ease from the listed beat speeds and shares, not the dot spacing. Rings are beats, numbered in order, each with its view boxed; dashed boxes are each shot's first view; red crosses are cuts. Small squares are the shots' subject marks, each labelled with every mark and shot that stands there, joined by each shot's line of attention; a red line is a view on the wrong side of that line, a crossing no row names.</p>
${text}
</body>
</html>
`;
}

// --cuts: `radius`, the ring around each incoming focus, a share of the
// frame's width; `edge`, the step of block luma, 0 to 255, between
// neighbouring blocks of frameDetail's grid (1/80 of the cell wide) that names
// a strong outgoing edge in that ring; `side`, the margin from 0.5 a mass
// share needs to count as one side. Starting values checked on one scratch
// film, not calibrated on the examples.
const CUT_RULES = { radius: 1 / 16, edge: 32, side: 0.05 };

/**
 * Where the eye is across each cut of film `p`, whose shot list is `shots`,
 * for --cuts: the built state's `cues.focus` rows, { shot, in: [x, y],
 * out: [x, y], jolt?, carry?: 'in' | 'out' } in design units, one per shot,
 * as the film scaffold's FOCUS rows, each carried on screen through
 * `cues.views` at depth 1, scaled by zoom * dolly as --plan reads a view (the
 * design box when the piece keeps no valid view per frame); a dolly that is
 * not a finite number above 0 is refused by index. Returns { focus, cuts, tracks }: `focus` false when the piece
 * keeps no `cues.focus`; one cut per shot after the first, { cut, from, to,
 * frame, out, in, jump, jolt, carried }, `out` on the frame before the cut and
 * `in` on its first frame, on screen, `jump` their distance in frame widths,
 * null for a carried cut, which the scaffold leaves unchecked; and one track
 * per shot with a row, { shot, points }, the point between its in and out on
 * each of its frames, on screen; the track of a carry row that leaves out the
 * point it drops holds on the one it keeps, and a row that gives both runs
 * from its in to its out. `state` is the piece's built state, as
 * shotList read `shots` from it; it is built here when left out. A `focus`
 * that is not a list, or a row with no known shot, a second row for one shot,
 * a carry other than 'in' or 'out', carry 'in' with a jolt, carry 'in' on the
 * first shot or 'out' on the last, or without a point it does not carry (both,
 * or the one a carry keeps), is refused by index, as the film scaffold refuses it.
 */
function cutPlan(p, shots, state = builtState(p, 'seeds', p.seed)) {
  const n = playheads(p).length, { w, h } = p.size;
  const focus = state && state.cues && state.cues.focus, views = state && state.cues && state.cues.views;
  const point = (v) => Array.isArray(v) && v.length === 2 && v.every(Number.isFinite);
  if (focus !== undefined && !Array.isArray(focus)) throw refuse(`--cuts: state.cues.focus is not a list of { shot, in, out } rows`);
  const rows = new Map();
  (focus || []).forEach((r, i) => {
    if (!r || !shots.some((s) => s.name === r.shot)) throw refuse(`--cuts: state.cues.focus entry [${i}] names no shot of ${p.name}`);
    if (rows.has(r.shot)) throw refuse(`--cuts: state.cues.focus entry [${i}] is a second row for shot ${r.shot}`);
    // The film scaffold's carry checks, in its words.
    const row = `--cuts: state.cues.focus entry [${i}]: the focus for ${r.shot}`;
    if (r.carry !== undefined && r.carry !== 'in' && r.carry !== 'out') throw refuse(`${row} carries ${typeof r.carry === 'string' ? r.carry : JSON.stringify(r.carry) ?? String(r.carry)}: carry 'in' or 'out'`);
    if (r.carry === 'in' && r.jolt) throw refuse(`${row} is a jolt and carries in: both are about the cut into ${r.shot}, and a carry leaves it unchecked, so keep one of them`);
    if (r.carry === 'in' && shots[0].name === r.shot) throw refuse(`${row} carries in, but ${r.shot} is the first shot and has no cut into it: drop the carry`);
    if (r.carry === 'out' && shots[shots.length - 1].name === r.shot) throw refuse(`${row} carries out, but ${r.shot} is the last shot and has no cut out of it: drop the carry`);
    if (!point(r.in) && !point(r.out)) throw refuse(`--cuts: state.cues.focus entry [${i}] has neither an in nor an out [x, y]`);
    // As the film scaffold: a carry drops the point its cut would use, and a row keeps every other.
    const keeps = r.carry === 'in' ? ['out'] : r.carry === 'out' ? ['in'] : ['in', 'out'], lacks = keeps.find((k) => !point(r[k]));
    if (lacks) throw refuse(`--cuts: state.cues.focus entry [${i}] has no ${lacks} [x, y]; ${r.carry === 'in' || r.carry === 'out' ? `a row that carries ${r.carry} keeps its ${keeps[0]}` : 'a row without a carry needs an in and an out'}`);
    rows.set(r.shot, r);
  });
  const seen = rows.size && Array.isArray(views) && views.length === n ?views.map((v, i) => normalView(v, i, '--cuts')) : null;
  const fits = !!seen && seen.every(Boolean);
  const view = (f) => (fits ? seen[f] : { x: w / 2, y: h / 2, zoom: 1 });
  const r2 = (v) => +v.toFixed(2);
  const onScreen = (f, [x, y]) => [r2(w / 2 + view(f).zoom * (x - view(f).x)), r2(h / 2 + view(f).zoom * (y - view(f).y))];
  const ends = (r) => [point(r.in) ? r.in : r.out, point(r.out) ? r.out : r.in];
  const cuts = shots.slice(1).map((s, k) => {
    const from = rows.get(shots[k].name), to = rows.get(s.name);
    const carried = !!((from && from.carry === 'out') || (to && to.carry === 'in'));
    const out = from && point(from.out) ? onScreen(s.start - 1, from.out) : null, land = to && point(to.in) ? onScreen(s.start, to.in) : null;
    return { cut: k + 1, from: shots[k].name, to: s.name, frame: s.start, out, in: land,
      jump: carried || !out || !land ? null : r2(Math.hypot(land[0] - out[0], land[1] - out[1]) / w), jolt: !!(to && to.jolt), carried };
  });
  const tracks = shots.filter((s) => rows.has(s.name)).map((s) => {
    const [a, b] = ends(rows.get(s.name));
    return { shot: s.name, points: Array.from({ length: s.end - s.start }, (_, i) => {
      const u = i / Math.max(1, s.end - 1 - s.start);
      return onScreen(s.start + i, [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
    }) };
  });
  return { focus: focus !== undefined, cuts, tracks };
}

/**
 * planStrip's --cuts layout as one figure with no script: an SVG of the
 * film's frame, each shot's eye track as a line from a dot at its first frame,
 * and each uncarried cut's jump dashed from the outgoing point to the incoming
 * one, in amber when it is over a third of the frame's width and not a jolt.
 * Empty when the piece keeps no focus rows.
 */
function cutOverlay(layout) {
  const { focus, cuts, tracks, size: { w, h } } = layout.cuts;
  if (!focus) return '';
  const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const pad = 0.05 * w, font = 0.022 * w, dot = 0.006 * w;
  const parts = [`<rect x="0" y="0" width="${w}" height="${h}" fill="none" stroke="#8e8f99" vector-effect="non-scaling-stroke"/>`];
  for (const t of tracks) {
    const [x, y] = t.points[0];
    parts.push(`<polyline points="${t.points.map((q) => q.join(',')).join(' ')}" fill="none" stroke="#e7e4dc" vector-effect="non-scaling-stroke"/>`,
      `<circle cx="${x}" cy="${y}" r="${+dot.toFixed(2)}" fill="#e7e4dc"/>`,
      `<text x="${+(x + 1.5 * dot).toFixed(2)}" y="${+(y - 1.5 * dot).toFixed(2)}" font-size="${+font.toFixed(2)}" fill="#e7e4dc">${esc(t.shot)}</text>`);
  }
  for (const c of cuts) {
    if (c.jump === null) continue;
    const long = c.jump > 1 / 3 && !c.jolt, colour = long ? '#e8b25a' : '#e8705a';
    parts.push(`<line class="jump${long ? ' long' : ''}" x1="${c.out[0]}" y1="${c.out[1]}" x2="${c.in[0]}" y2="${c.in[1]}" stroke="${colour}" stroke-width="2" stroke-dasharray="6 4" vector-effect="non-scaling-stroke"/>`,
      `<text x="${+((c.out[0] + c.in[0]) / 2).toFixed(2)}" y="${+((c.out[1] + c.in[1]) / 2 - dot).toFixed(2)}" font-size="${+font.toFixed(2)}" fill="${colour}">cut ${c.cut}: ${c.jump}${c.jolt ? ' (jolt)' : ''}</text>`);
  }
  return `<figure id="cut-overlay"><svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(`every shot's eye track and every cut's jump on one ${w} × ${h} frame`)}" viewBox="${[-pad, -pad, w + 2 * pad, h + 2 * pad].map((v) => +v.toFixed(2)).join(' ')}" width="960" height="${Math.round((960 * (h + 2 * pad)) / (w + 2 * pad))}" font-family="system-ui, sans-serif" style="background:var(--bg);border:1px solid var(--line);max-width:100%;height:auto">
${parts.join('\n')}
</svg>
<figcaption>Eye tracks: each shot's focus points, from state.cues.focus, carried through its views, from a dot on its first frame. Dashed: each cut's jump, labelled with its length in frame widths; amber over a third and not a jolt. Carried cuts draw no jump.</figcaption></figure>
`;
}

/**
 * The marks `draw` paints on a vector surface of `size`, in paint order, each
 * { index, op, style, width, box, starts, composite }: the paint call, the
 * fill or stroke style the surface held, the line width in surface units (0
 * for a fill), the box the path's points span in surface units, widened by
 * half the stroke, where each of its subpaths starts (each moveTo, in surface
 * units; rect and roundRect begin a subpath, arc and ellipse continue one,
 * and none of them adds a start), which for a
 * plant or a figure drawn from its foot is its root, and the
 * globalCompositeOperation it was painted with. A box is the points' bounds,
 * so a bezier or quadratic curve's control points count, while an arc or an
 * ellipse counts only the points its sweep passes: a coarse test of
 * where two marks can meet, not the painted shape. drawImage, fillText,
 * strokeText and putImageData are recorded with the box of their arguments
 * and not painted; clearRect is accepted and erases nothing, createImageData
 * and getImageData give transparent pixels, globalCompositeOperation, filter
 * and the shadow properties take any value and are kept through save and
 * restore, and createPattern, createConicGradient and measureText give a
 * stand-in style or width, so a raster-only piece's paint order reads too.
 * The surface has no canvas, so a sprite or a static layer paints its marks
 * here directly and they are recorded one by one, never as a drawImage.
 * Nothing is drawn; the surface only follows the transforms.
 */
function recordMarks(size, draw) {
  const g = new VectorSurface(size), marks = [];
  let box = null, starts = [];
  // The raster state VectorSurface refuses, scoped by save and restore as a canvas scopes it.
  let raster = { globalCompositeOperation: 'source-over', filter: 'none', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0 };
  const stack = [];
  const blank = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
  const point = (x, y) => {
    const m = g.getTransform(), px = m.a * x + m.c * y + m.e, py = m.b * x + m.d * y + m.f;
    box = box ? [Math.min(box[0], px), Math.min(box[1], py), Math.max(box[2], px), Math.max(box[3], py)] : [px, py, px, py];
    return [px, py];
  };
  const corners = (x, y, w, h) => { point(x, y); point(x + w, y); point(x, y + h); point(x + w, y + h); };
  // An elliptical arc adds its ends and each point of its sweep where the
  // surface x or y turns, so the box is the swept curve's own under any transform.
  const curve = (cx, cy, rx, ry, rot, a0, a1, ccw) => {
    const m = g.getTransform(), c = Math.cos(rot), s = Math.sin(rot), turn = 2 * Math.PI;
    const at = (t) => { const u = rx * Math.cos(t), v = ry * Math.sin(t); point(cx + c * u - s * v, cy + s * u + c * v); };
    const span = ccw ? a0 - a1 : a1 - a0, sweep = span >= turn ? turn : ((span % turn) + turn) % turn;
    const from = ccw ? a0 - sweep : a0;
    at(from); at(from + sweep);
    for (const [p, q] of [[m.a * c + m.c * s, m.c * c - m.a * s], [m.b * c + m.d * s, m.d * c - m.b * s]]) {
      const t = Math.atan2(q * ry, p * rx);
      for (const k of [t, t + Math.PI]) { const d = (((k - from) % turn) + turn) % turn; if (d <= sweep) at(from + d); }
    }
  };
  const scaleOf = () => { const m = g.getTransform(); return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)); };
  const mark = (op, style, width) => {
    if (box) marks.push({ index: marks.length, op, style, width, box: [box[0] - width / 2, box[1] - width / 2, box[2] + width / 2, box[3] + width / 2], starts: starts.slice(), composite: raster.globalCompositeOperation });
  };
  // A rectangle or raster call keeps the path being built, as a canvas does.
  const whole = (op, style, width, extent) => {
    const kept = [box, starts];
    box = null; starts = [];
    extent(); mark(op, style, width);
    [box, starts] = kept;
  };
  const hooks = {
    beginPath() { box = null; starts = []; },
    moveTo(x, y) { starts.push(point(x, y)); },
    lineTo: point,
    quadraticCurveTo(a, b, c, d) { point(a, b); point(c, d); },
    bezierCurveTo(a, b, c, d, e, f) { point(a, b); point(c, d); point(e, f); },
    arcTo(a, b, c, d) { point(a, b); point(c, d); },
    rect: corners, roundRect: corners,
    arc(cx, cy, r, a0, a1, ccw) { curve(cx, cy, r, r, 0, a0, a1, ccw); },
    ellipse: curve,
    closePath() {},
    fill() { mark('fill', g.fillStyle, 0); },
    stroke() { mark('stroke', g.strokeStyle, g.lineWidth * scaleOf()); },
    fillRect(x, y, w, h) { whole('fillRect', g.fillStyle, 0, () => corners(x, y, w, h)); },
    strokeRect(x, y, w, h) { whole('strokeRect', g.strokeStyle, g.lineWidth * scaleOf(), () => corners(x, y, w, h)); },
    fillText(text, x, y) { whole('fillText', g.fillStyle, 0, () => point(x, y)); },
    strokeText(text, x, y) { whole('strokeText', g.strokeStyle, g.lineWidth * scaleOf(), () => point(x, y)); },
    putImageData(data, x, y) { whole('putImageData', null, 0, () => corners(x, y, data.width, data.height)); },
    clearRect() {},
    createImageData(w, h) { return typeof w === 'object' ? blank(w.width, w.height) : blank(w, h); },
    getImageData(x, y, w, h) { return blank(w, h); },
    createPattern(image, repetition) { return { pattern: true, repetition }; },
    createConicGradient() { return g.createLinearGradient(0, 0, 0, 0); },
    measureText(text) { const px = /(\d*\.?\d+)px/.exec(String(g.font ?? '')); return { width: 0.6 * (px ? Number(px[1]) : 10) * String(text).length }; },
    save() { stack.push(raster); raster = { ...raster }; g.save(); },
    restore() { if (stack.length) raster = stack.pop(); g.restore(); },
    drawImage(image, ...a) {
      const [x, y, w, h] = a.length >= 8 ? a.slice(4, 8) : a.length >= 4 ? a : [a[0], a[1], image.width, image.height];
      whole('drawImage', null, 0, () => corners(x, y, w, h));
    },
  };
  draw(new Proxy(g, {
    get(target, key) {
      if (Object.hasOwn(hooks, key)) return hooks[key];
      if (Object.hasOwn(raster, key)) return raster[key];
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, key, value) {
      if (Object.hasOwn(raster, key)) { raster[key] = value; return true; }
      return Reflect.set(target, key, value, target);
    },
  }));
  return marks;
}

/**
 * Where named things stand in one frame's paint order: `things` maps each
 * name to a test of a mark from recordMarks. For every pair of names, among
 * the first thing's marks whose box meets a mark of the second, `behind`
 * counts those painted before such a mark and `front` those painted after
 * one; a mark that meets no mark of the other thing says nothing, and a mark
 * both tests pick is not compared with itself. A mark painted with
 * `destination-over` goes under everything painted before it, so it counts as
 * behind every source-over mark, and in front of an earlier destination-over
 * one. Both above zero is `mixed`: on this frame the first thing is behind the
 * second in some places and in front of it in others, which is what a part
 * sorted by a test on the frame looks like in paint. Returns
 * { 'a/b': { behind, front, mixed } }.
 */
function paintOrder(marks, things) {
  const names = Object.keys(things), of = names.map((name) => marks.filter((m) => things[name](m)));
  const meet = (a, b) => a.box[0] <= b.box[2] && b.box[0] <= a.box[2] && a.box[1] <= b.box[3] && b.box[1] <= a.box[3];
  const under = (m) => m.composite === 'destination-over';
  // Whether `a` paints over `b`.
  const over = (a, b) => (under(a) !== under(b) ? under(b) : under(a) ? a.index < b.index : a.index > b.index);
  const pairs = {};
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      let behind = 0, front = 0;
      for (const a of of[i]) {
        let before = false, after = false;
        for (const b of of[j]) if (b !== a && meet(a, b)) { if (over(a, b)) after = true; else before = true; }
        if (before) behind++;
        if (after) front++;
      }
      pairs[names[i] + '/' + names[j]] = { behind, front, mixed: behind > 0 && front > 0 };
    }
  }
  return pairs;
}

/**
 * The frames of piece `p`, solved, on which two of `things` (see paintOrder)
 * swap paint order: `mixed` on one frame, or `swapped`, in front on one of
 * `frames` and behind on the next shown where the two meet. Returns
 * [{ frame, pair, behind, front, why }], empty when every pair holds its
 * order over the frames. Each frame is drawn once on a recording surface.
 */
function layerSwaps(p, solved, frames, things) {
  const heads = playheads(p), found = [], last = {};
  for (const frame of frames) {
    const order = paintOrder(recordMarks(p.size, (g) => drawFrame(g, p, solved, heads[frame])), things);
    for (const [pair, o] of Object.entries(order)) {
      if (o.mixed) { found.push({ frame, pair, behind: o.behind, front: o.front, why: 'mixed' }); continue; }
      const side = o.front ? 'front' : o.behind ? 'behind' : null;
      if (!side) continue;
      if (last[pair] && last[pair] !== side) found.push({ frame, pair, behind: o.behind, front: o.front, why: 'swapped' });
      last[pair] = side;
    }
  }
  return found;
}

/**
 * How much of each named part the marks drawn after it cover, on real pixels.
 * `ctx` is a 2D context whose canvas is the cell's size; `draw(surface)` draws
 * the frame; `parts` is [{ name, styles }]. A mark belongs to a part when it is
 * a fill, stroke, rect or text painted with one of its `styles`, compared as
 * the canvas writes colours; an image or putImageData never does. Each part is
 * drawn twice on a surface without a canvas, so the finish is skipped and
 * layers and sprites paint mark by mark: alone, in white, for its area; then
 * in white among every other mark painted black at its own alpha and
 * compositing, in paint order, for what still shows. The part counts as
 * opaque; a gradient, pattern or image counts as opaque black; shadows and
 * filters are ignored. On the second draw every mark, the part's included,
 * keeps an operator in SHOWS, so a destination-over mark goes under what is
 * painted and a destination-out mark erases; a blend mode or lighter counts as
 * source-over. A mark painted before a source-over part lies under it and
 * covers nothing, but the part's own operator can hide it: earlier marks hide a
 * destination-over, destination-atop, source-out or xor part; a source-in or
 * source-atop part does not show over empty canvas; a destination-in or
 * destination-out part never shows; a copy part shows whole. Each pass starts
 * on a reset context.
 * Returns [{ name, share, covered }] in the
 * order given: `share` the part's area over the canvas's, `covered` the share
 * of that area that does not show, whatever hides it, 0 to 1, or null when the
 * part paints nothing. Each pass is read back on its own: on a canvas made
 * with willReadFrequently, as the strip page makes it, copying the passes into
 * one canvas to read back once measured no faster in Edge. Serialized into a
 * --part strip page, so it uses nothing outside itself but PAINT.
 */
function partCover(ctx, draw, parts) {
  const { width, height } = ctx.canvas;
  // A colour as the canvas writes it, or null for one it rejects, which keeps the style set before it and is refused.
  const written = (s) => {
    ctx.save();
    ctx.fillStyle = '#000000'; ctx.fillStyle = s; const a = ctx.fillStyle;
    ctx.fillStyle = '#ffffff'; ctx.fillStyle = s; const b = ctx.fillStyle;
    ctx.restore();
    return a === b ? a : null;
  };
  // A colour's alpha as the canvas writes it: rgba(r, g, b, a), or a CSS Color 4 form such as oklch(l c h / a); 1 without one.
  const alphaOf = (s) => {
    const m = typeof s === 'string' && (/^rgba\(.*,\s*([\d.]+)\)$/.exec(s) || /\/\s*([\d.]+%?|none)\s*\)$/.exec(s));
    return !m ? 1 : m[1] === 'none' ? 0 : parseFloat(m[1]) / (m[1].endsWith('%') ? 100 : 1);
  };
  // These operators decide which pixels show, so a mark keeps them; a blend mode or lighter only changes colour and counts as source-over.
  const SHOWS = new Set(['source-in', 'source-out', 'source-atop', 'destination-over', 'destination-in', 'destination-out', 'destination-atop', 'xor', 'copy']);
  // The size Edge 155 draws a data: SVG at, from its root <svg>'s width, height and viewBox, as measured: both lengths draw at them,
  // one length takes the other from the viewBox's ratio, or else from the canvas, and none draws the viewBox fitted whole inside
  // the canvas, or else the canvas. A percentage or a word counts as no length, and a viewBox with a zero width or height draws
  // nothing. A '%' that starts no escape reads as itself, as Edge reads it. Names are case-sensitive, as in an SVG image, and a
  // viewBox that is not four finite numbers is ignored. Both lengths win over preserveAspectRatio none. Null for what it cannot
  // read, such as another URL, a unit that hangs on a font (ex, ch), a viewBox with a negative width or height, or
  // preserveAspectRatio none with fewer than both lengths.
  const ownSize = (url) => {
    const m = /^data:image\/svg\+xml(;[^,]*)?,([\s\S]*)$/i.exec(url);
    let text;
    try { text = m && (/;base64/i.test(m[1] || '') ? atob(m[2]) : decodeURIComponent(m[2].replace(/%(?![\da-f]{2})/gi, '%25'))); } catch { return null; }
    const tag = text && /<svg\b([^>]*)>/.exec(text.replace(/<!--[\s\S]*?-->/g, ''));
    if (!tag) return null;
    const attr = (name) => { const a = new RegExp('\\s' + name + '\\s*=\\s*(["\'])([\\s\\S]*?)\\1').exec(tag[1]); return a ? a[2].trim() : null; };
    const UNIT = { '': 1, px: 1, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, pt: 4 / 3, pc: 16, em: 16, rem: 16 };
    const length = (s) => {
      const l = s && /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-z]*)$/i.exec(s);
      if (!l) return undefined;
      const unit = UNIT[l[2].toLowerCase()];
      return unit === undefined ? null : Math.max(0, l[1] * unit);
    };
    const w = length(attr('width')), h = length(attr('height')), box = attr('viewBox'), fit = attr('preserveAspectRatio');
    const nums = box && box.split(/[\s,]+/).map(Number);
    // A viewBox that is not four finite numbers is ignored, as Edge ignores it.
    const vb = nums && nums.length === 4 && nums.every(Number.isFinite) ? nums : null;
    if (w === null || h === null || (vb && !(vb[2] >= 0 && vb[3] >= 0))) return null;
    if (w !== undefined && h !== undefined) return vb && !(vb[2] && vb[3]) ? [0, 0] : [w, h];
    if (vb && /^none\b/.test(fit || '')) return null;
    if (vb && !(vb[2] && vb[3])) return [0, 0];
    const r = vb && vb[2] / vb[3];
    if (w !== undefined) return [w, r ? w / r : height];
    if (h !== undefined) return [r ? h * r : width, h];
    return !r ? [width, height] : r > width / height ? [width, width / r] : [height * r, height];
  };
  // The size drawImage(image, x, y) draws at: a VideoFrame's display size, an image's natural size, a video's, else its width and height.
  // An SVG <image> draws at its file's own size, never its width attribute, and Edge draws a file with no size of its own at the
  // canvas's size, so it counts as the canvas: the most of it that can show. An <img> holding such a file reads a natural size of
  // 300 x 150 in Edge yet draws at the canvas's size too, so an SVG <img> of exactly 300 x 150 counts as the canvas as well. One
  // with only a viewBox reads 150 tall at its ratio, such as 150 x 150, and draws fitted whole inside the canvas, so it counts so.
  // A data: SVG on either says its own size, read by ownSize; these bounds are for a source it cannot read.
  const sized = (image, k) => {
    const src = image.currentSrc || image.src || (image.href && image.href.baseVal) || '', own = ownSize(src);
    if (own) return own[k === 'Width' ? 0 : 1];
    const svg = /^data:image\/svg|\.svg([?#]|$)/i.test(src);
    const nw = image.naturalWidth, nh = image.naturalHeight;
    if (svg && nw === 300 && nh === 150) return k === 'Width' ? width : height;
    if (svg && nh === 150 && nw > 0) return (k === 'Width' ? nw : nh) * Math.min(width / nw, height / nh);
    const v = image['display' + k] ?? image['natural' + k] ?? image['video' + k] ?? image[k.toLowerCase()];
    return typeof v === 'number' ? v : k === 'Width' ? width : height;
  };
  const pass = (styles, shown) => {
    // A fresh context each pass, so a transform, clip or save the piece leaves unbalanced never reaches the next pass.
    if (ctx.reset) ctx.reset(); else ctx.canvas.width = width;
    const methods = new Map();
    draw(new Proxy(ctx, {
      get(target, key) {
        if (key === 'canvas') return undefined;
        const value = Reflect.get(target, key, target);
        if (typeof value !== 'function') return value;
        if (!methods.has(key)) methods.set(key, (...args) => {
          if (!Object.hasOwn(PAINT, key)) return value.apply(target, args);
          const prop = PAINT[key], mine = prop !== null && styles.includes(target[prop]);
          if (!mine && !shown) return undefined;
          target.save();
          target.shadowColor = 'rgba(0, 0, 0, 0)';
          target.filter = 'none';
          if (!shown || !SHOWS.has(target.globalCompositeOperation)) target.globalCompositeOperation = 'source-over';
          let result;
          if (mine) { target[prop] = '#ffffff'; target.globalAlpha = 1; result = value.apply(target, args); }
          else if (prop) { target[prop] = 'rgba(0, 0, 0, ' + alphaOf(target[prop]) + ')'; result = value.apply(target, args); }
          else if (key === 'drawImage') {
            const [x, y, w, h] = args.length >= 9 ? args.slice(5, 9) : args.length >= 5 ? args.slice(1, 5) : [args[1], args[2], sized(args[0], 'Width'), sized(args[0], 'Height')];
            target.fillStyle = '#000000';
            target.fillRect(x, y, w, h);
          } else {
            target.setTransform(1, 0, 0, 1, 0, 0);
            target.globalAlpha = 1;
            target.globalCompositeOperation = 'source-over';
            target.fillStyle = '#000000';
            target.fillRect(args[1], args[2], args[0].width, args[0].height);
          }
          target.restore();
          return result;
        });
        return methods.get(key);
      },
      set(target, key, value) { return Reflect.set(target, key, value, target); },
    }));
    return ctx.getImageData(0, 0, width, height).data;
  };
  return parts.map(({ name, styles }) => {
    const own = styles.map(written), rejected = own.indexOf(null);
    // Marked as a refusal, so the strip page carries it for the tool to refuse with.
    if (rejected >= 0) throw Object.assign(new Error('seeds: --part takes colours the canvas reads, such as #f00 or rgba(255, 0, 0, 0.5), got ' + styles[rejected]), { refusal: true });
    const alone = pass(own, false), shown = pass(own, true);
    let area = 0, seen = 0;
    for (let i = 0; i < alone.length; i += 4) {
      area += alone[i + 3] / 255;
      seen += (shown[i] / 255) * (shown[i + 3] / 255);
    }
    return { name, share: +(area / (width * height)).toFixed(4), covered: area ? +Math.min(1, Math.max(0, 1 - seen / area)).toFixed(4) : null };
  });
}

/**
 * One figure's flat fill on real pixels: partCover's first pass alone. `ctx`
 * is a 2D context whose canvas is the cell's size; `draw(surface)` draws the
 * frame; `styles` are the colours of the figure's painted fill and contour
 * strokes. A fill, stroke, rect or text painted with one of them, compared as
 * the canvas writes colours, is painted opaque white, source-over, with no
 * shadow or filter; every other paint call, an image or putImageData among
 * them, is skipped. The frame is drawn on a reset context through a surface
 * without a canvas, so the finish is skipped and layers and sprites paint mark
 * by mark. Returns the canvas's ImageData, or throws a refusal for a colour
 * the canvas rejects. Serialized into a --figure strip page, so it uses
 * nothing outside itself but PAINT.
 */
function figureFill(ctx, draw, styles) {
  const { width, height } = ctx.canvas;
  // A colour as the canvas writes it, or null for one it rejects, which is refused.
  const written = (s) => {
    ctx.save();
    ctx.fillStyle = '#000000'; ctx.fillStyle = s; const a = ctx.fillStyle;
    ctx.fillStyle = '#ffffff'; ctx.fillStyle = s; const b = ctx.fillStyle;
    ctx.restore();
    return a === b ? a : null;
  };
  const own = styles.map(written), rejected = own.indexOf(null);
  // Marked as a refusal, so the strip page carries it for the tool to refuse with.
  if (rejected >= 0) throw Object.assign(new Error('seeds: --figure takes colours the canvas reads, such as #b07a5a or rgba(176, 122, 90, 0.5), got ' + styles[rejected]), { refusal: true });
  if (ctx.reset) ctx.reset(); else ctx.canvas.width = width;
  const methods = new Map();
  draw(new Proxy(ctx, {
    get(target, key) {
      if (key === 'canvas') return undefined;
      const value = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      if (!methods.has(key)) methods.set(key, (...args) => {
        if (!Object.hasOwn(PAINT, key)) return value.apply(target, args);
        const prop = PAINT[key];
        if (prop === null || !own.includes(target[prop])) return undefined;
        target.save();
        target.shadowColor = 'rgba(0, 0, 0, 0)';
        target.filter = 'none';
        target.globalCompositeOperation = 'source-over';
        target.globalAlpha = 1;
        target[prop] = '#ffffff';
        const result = value.apply(target, args);
        target.restore();
        return result;
      });
      return methods.get(key);
    },
    set(target, key, value) { return Reflect.set(target, key, value, target); },
  }));
  return ctx.getImageData(0, 0, width, height);
}

/**
 * What a flat fill shows. `data` is RGBA `width` x `height` pixels, a pixel
 * with alpha 128 or more inside the figure; `k` is cell pixels per design
 * unit and `film` film pixels per design unit. Null when nothing is inside,
 * else, in design units to 2 decimals:
 * - area, and box [x0, y0, x1, y1];
 * - gaps: each 4-connected run of ground with the figure on both sides of it
 *   on its own row, { x, y, w, h, area, widest, closed }, by y then x.
 *   `widest` is its longest ground run on a row, in film pixels to 1 decimal;
 *   `closed` is true when no ground joins it to the cell's border, a hole.
 *   Gaps under 4 cell pixels are left out;
 * - pinholes: the count of closed gaps under 4 cell pixels, seams in a fill;
 * - widths: the span from the first to the last inside pixel on the rows at
 *   0.1 to 0.9 of the box's height, 0 on a row with none;
 * - runs: on those rows, the longest single run of inside pixels, so a part
 *   with ground between it and the rest on that row is left out;
 * - plumb { x, from, to, over }: x the centroid of the inside pixels, from and
 *   to the span of the lowest max(2, 2% of the box height) rows, and over
 *   whether x lies in that span.
 * Serialized into a --figure strip page, so it uses nothing outside itself.
 */
function silhouette(data, width, height, k, film) {
  var n = width * height, inside = new Uint8Array(n), count = 0, sumX = 0, x0 = width, y0 = height, x1 = -1, y1 = -1, x, y, j, top = 0;
  for (y = 0; y < height; y++) {
    for (x = 0; x < width; x++) {
      j = y * width + x;
      if (data[4 * j + 3] < 128) continue;
      inside[j] = 1; count++; sumX += x;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  if (!count) return null;
  var r2 = function (v) { return +v.toFixed(2); };
  // Each row's first and last inside pixel, -1 on a row with none.
  var first = new Int32Array(height).fill(-1), last = new Int32Array(height).fill(-1);
  for (y = y0; y <= y1; y++) {
    for (x = x0; x <= x1; x++) if (inside[y * width + x]) { if (first[y] < 0) first[y] = x; last[y] = x; }
  }
  // An explicit stack: each pixel is pushed at most once, so n slots hold any flood.
  var stack = new Int32Array(n), outer = new Uint8Array(n);
  var ground = function (i) { if (!inside[i] && !outer[i]) { outer[i] = 1; stack[top++] = i; } };
  for (x = 0; x < width; x++) { ground(x); ground(n - width + x); }
  for (y = 0; y < height; y++) { ground(y * width); ground(y * width + width - 1); }
  while (top) {
    j = stack[--top]; x = j % width;
    if (x > 0) ground(j - 1);
    if (x < width - 1) ground(j + 1);
    if (j >= width) ground(j - width);
    if (j < n - width) ground(j + width);
  }
  // Each ground pixel with the figure on both sides on its row holds the length of its run there; 0 elsewhere.
  var run = new Int32Array(n), seen = new Uint8Array(n), e, q;
  for (y = y0; y <= y1; y++) {
    for (x = first[y] + 1; first[y] >= 0 && x < last[y]; x++) {
      if (inside[y * width + x]) continue;
      for (e = x; !inside[y * width + e]; e++);
      for (q = x; q < e; q++) run[y * width + q] = e - x;
      x = e;
    }
  }
  var gaps = [], pinholes = 0;
  var visit = function (i) { if (run[i] && !seen[i]) { seen[i] = 1; stack[top++] = i; } };
  for (y = y0; y <= y1; y++) {
    for (x = x0; x <= x1; x++) {
      var s = y * width + x;
      if (!run[s] || seen[s]) continue;
      var size = 0, gx0 = x, gx1 = x, gy1 = y, widest = 0;
      visit(s);
      while (top) {
        j = stack[--top];
        var jx = j % width, jy = (j - jx) / width;
        size++;
        if (jx < gx0) gx0 = jx;
        if (jx > gx1) gx1 = jx;
        if (jy > gy1) gy1 = jy;
        if (run[j] > widest) widest = run[j];
        if (jx > 0) visit(j - 1);
        if (jx < width - 1) visit(j + 1);
        if (j >= width) visit(j - width);
        if (j < n - width) visit(j + width);
      }
      var closed = !outer[s];
      if (size < 4) { if (closed) pinholes++; continue; }
      gaps.push({ x: r2(gx0 / k), y: r2(y / k), w: r2((gx1 - gx0 + 1) / k), h: r2((gy1 - y + 1) / k), area: r2(size / (k * k)), widest: +((widest * film) / k).toFixed(1), closed: closed });
    }
  }
  gaps.sort(function (a, b) { return a.y - b.y || a.x - b.x; });
  var tall = y1 - y0 + 1, widths = [], runs = [], best, length;
  for (q = 1; q <= 9; q++) {
    y = y0 + Math.min(tall - 1, Math.floor((q / 10) * tall));
    widths.push(first[y] < 0 ? 0 : r2((last[y] - first[y] + 1) / k));
    for (best = 0, length = 0, x = first[y]; first[y] >= 0 && x <= last[y]; x++) {
      length = inside[y * width + x] ? length + 1 : 0;
      if (length > best) best = length;
    }
    runs.push(r2(best / k));
  }
  var from = width, to = -1, cx = (sumX / count + 0.5) / k;
  for (y = Math.max(y0, y1 - Math.max(2, Math.round(0.02 * tall)) + 1); y <= y1; y++) {
    if (first[y] >= 0) { from = Math.min(from, first[y]); to = Math.max(to, last[y]); }
  }
  return {
    area: r2(count / (k * k)), box: [r2(x0 / k), r2(y0 / k), r2((x1 + 1) / k), r2((y1 + 1) / k)], gaps: gaps, pinholes: pinholes, widths: widths, runs: runs,
    plumb: { x: r2(cx), from: r2(from / k), to: r2((to + 1) / k), over: cx >= from / k && cx <= (to + 1) / k },
  };
}

// Serialized into a --sound strip page: draws soundPicture's `pic` on `g`, the
// waveform over the spectrogram, a frame's line and number at each frame the
// strip shows, and each shot cut as a brighter line with the next shot's name.
// `layout.silences`, when given, are silentSpans' stretches, shaded and
// labelled with their length in the waveform's panel.
function drawSound(g, pic, layout) {
  const W = pic.columns, top = 16, wave = layout.wave, gap = 6, spec = top + wave + gap, H = spec + pic.rows + 18;
  g.fillStyle = '#0c0d10'; g.fillRect(0, 0, W, H);
  const silences = (layout.silences || []).map((s) => {
    const x0 = Math.round((s.from / pic.seconds) * W);
    return { x0, x1: Math.max(x0 + 1, Math.round((s.to / pic.seconds) * W)), seconds: s.to - s.from };
  });
  g.fillStyle = 'rgba(120,190,255,0.18)';
  for (const s of silences) g.fillRect(s.x0, top, s.x1 - s.x0, wave);
  const mid = top + wave / 2;
  g.fillStyle = '#6f89b8';
  for (let c = 0; c < W; c++) {
    const y0 = mid - (pic.high[c] * wave) / 2, y1 = mid - (pic.low[c] * wave) / 2;
    g.fillRect(c, y0, 1, Math.max(1, y1 - y0));
  }
  // The envelope on its own scale, -60 dBFS at the bottom to 0 at the top.
  const level = (db) => top + wave * Math.min(1, Math.max(0, -db / 60));
  g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1;
  for (const db of [-12, -24, -36, -48]) { g.beginPath(); g.moveTo(0, level(db) + 0.5); g.lineTo(W, level(db) + 0.5); g.stroke(); }
  g.strokeStyle = '#f2c14e'; g.lineWidth = 1.5; g.beginPath();
  for (let c = 0; c < W; c++) g[c ? 'lineTo' : 'moveTo'](c + 0.5, level(pic.rms[c]));
  g.stroke();
  g.fillStyle = '#e7e4dc'; g.font = '11px ui-monospace, Consolas, monospace'; g.textBaseline = 'middle'; g.textAlign = 'left';
  for (const s of silences) g.fillText('silent ' + s.seconds.toFixed(1) + ' s', s.x0 + 3, top + 10);
  // The spectrogram, -96 dB black to 0 dB pale yellow.
  const image = g.createImageData(W, pic.rows), stops = [[0, 0, 0], [60, 20, 110], [190, 50, 90], [245, 140, 40], [255, 245, 190]];
  for (let c = 0; c < W; c++) {
    for (let r = 0; r < pic.rows; r++) {
      const v = Math.min(1, Math.max(0, 1 + pic.spectrum[c * pic.rows + r] / 96)) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(v)), f = v - i;
      const o = ((pic.rows - 1 - r) * W + c) * 4;
      for (let k = 0; k < 3; k++) image.data[o + k] = stops[i][k] + (stops[i + 1][k] - stops[i][k]) * f;
      image.data[o + 3] = 255;
    }
  }
  g.putImageData(image, 0, spec);
  g.font = '11px ui-monospace, Consolas, monospace'; g.textBaseline = 'middle';
  for (const hz of [100, 1000, 10000]) {
    if (hz < pic.from || hz > pic.to) continue;
    const y = spec + pic.rows * (1 - Math.log(hz / pic.from) / Math.log(pic.to / pic.from));
    g.fillStyle = 'rgba(255,255,255,0.45)'; g.fillRect(0, Math.round(y), 8, 1);
    g.fillStyle = '#e7e4dc'; g.fillText(hz >= 1000 ? hz / 1000 + ' kHz' : hz + ' Hz', 11, y);
  }
  // A frame number too close to the last one drawn is left out; its line stays.
  let labelled = -Infinity;
  for (const m of layout.marks) {
    g.fillStyle = 'rgba(231,228,220,0.55)'; g.fillRect(m.x, top, 1, H - top - 18);
    if (m.x - labelled < 34) continue;
    labelled = m.x;
    g.fillStyle = '#e7e4dc'; g.textAlign = m.x > W - 30 ? 'right' : 'left'; g.fillText(String(m.frame), m.x + (m.x > W - 30 ? -3 : 3), 8);
  }
  for (const cut of layout.cuts) {
    g.fillStyle = '#e8705a'; g.fillRect(cut.x - 1, top, 2, H - top - 16);
    g.textAlign = cut.x > W - 120 ? 'right' : 'left'; g.fillText(cut.shot, cut.x + (cut.x > W - 120 ? -4 : 4), H - 8);
  }
  g.textAlign = 'left';
}

/**
 * A time strip of piece `p` at `strip.seed`, or its own seed when that is
 * undefined or null: `strip.frames` frames spread
 * from the first to the last, or the frames holding `strip.at` seconds. Each
 * cell is drawn at `strip.scale` pixels per design unit, 640 pixels wide by
 * default. `strip.loupe`, true or a design point { x, y }, adds a crop at 100%
 * of the film's default export scale around that point, the centre for true,
 * the size of a cell. A still has one frame, shown by `strip.at` [0], so it
 * takes the scale and loupe too; its hz is null. Each cell carries `shot`,
 * the name of the shot its frame falls in, whenever the piece keeps a valid
 * `state.cues.shots`; with `inPage`, for a page Edge draws, a --frames or
 * --at strip of a film leaves its cells untagged and sets `pageShots`, and
 * the page tags them from its own build. With `strip.armature`, each cell
 * carries its frame's chains from state.cues.armature, projected, with that
 * frame's joint faults, and the layout every fault of the film.
 */
function planStrip(p, strip, inPage = false) {
  if (!p.time && !(strip.at && strip.at.every((s) => s === 0))) {
    throw refuse(`${p.name} is a still; a time strip needs a timeline, and --at 0 shows the still itself`);
  }
  const heads = playheads(p), hz = p.time ? p.time.hz : null, n = heads.length;
  let frames, marks = null;
  if (strip.sound && !p.sound) throw refuse(`--sound draws ${p.name}'s soundtrack, and ${p.name} declares no sound`);
  if (strip.motion && !p.time) throw refuse(`--motion measures the change from frame to frame, and ${p.name} is a still`);
  // The state, built once, so each cell knows its shot. --shots, --sound,
  // --contacts and --armature refuse a piece that fails to build, in a stage or in
  // state(); any other strip builds it quietly, a failed build meaning no shot
  // list, so such a piece still draws its failed cells in the page. A --frames or --at strip Edge draws (`inPage`)
  // skips this build: the page builds the piece before its cells' labels, run
  // breaks (opensRun) and result tags, and tags them from that build: a refit
  // --frames 9 --png run took 4.2 s, not 5.8 s. A strip no page draws keeps it.
  // A shot list shotList refuses fails every cell there, and the tool refuses
  // with the same message once the page is drawn.
  const seed = strip.seed ?? p.seed;
  const pageShots = inPage && !!p.time && !(strip.shots || strip.sound || strip.motion || strip.contacts || strip.armature);
  let state = null;
  if (strip.shots || strip.sound || strip.motion || strip.contacts || strip.armature) state = builtState(p, 'seeds', seed);
  else if (p.time && !pageShots) {
    const s = solve(p, seed);
    state = s.stages.error ? null : s.state;
  }
  const shots = state ? shotList(p, 'seeds', seed, state) : null;
  // --armature: the chains the piece keeps per frame, and their faults across the whole film.
  const rig = strip.armature ? armatureList(p, state) : null;
  const rigFaults = rig ? jointFaults(rig, (shots || []).slice(1).map((s) => s.start)) : null;
  let contacts = null;
  if (strip.contacts) {
    // Each contact frame gives the frames around it that the film holds; each
    // contact starts a row of its own (see `column` below).
    contacts = contactList(p, strip.contacts, seed, state);
    frames = [];
    marks = [];
    contacts.forEach((c, k) => {
      for (const offset of CONTACT_WINDOW) {
        if (c.frame + offset < 0 || c.frame + offset >= n) continue;
        frames.push(c.frame + offset);
        marks.push({ contact: k + 1, offset, ...(c.point && { point: c.point }) });
      }
    });
  } else if (strip.shots) {
    // Each shot gives its first, middle and last frame, one row of three.
    const list = shots;
    if (!list) {
      throw refuse(`--shots reads ${p.name}'s shot list from state.cues.shots, the list shots() returns, and ${p.name} keeps none there`);
    }
    if (strip.cuts && list.length < 2) throw refuse(`--cuts blends the frames either side of each cut, and ${p.name} has one shot`);
    frames = [];
    marks = [];
    for (const s of list) {
      [s.start, Math.floor((s.start + s.end - 1) / 2), s.end - 1].forEach((frame, i) => {
        frames.push(frame);
        marks.push({ shot: s.name, mark: ['first', 'middle', 'last'][i] });
      });
    }
  } else if (strip.at) {
    frames = strip.at.map((s) => {
      // A second belongs to the frame it falls in; the margin keeps 0.29 * 100 in frame 29.
      const frame = Math.floor(s * hz + 1e-6);
      if (!(s >= 0 && frame < n)) throw refuse(`--at ${s} is outside ${p.name}'s ${n / hz} s`);
      return frame;
    });
  } else {
    if (strip.frames > n) throw refuse(`--frames ${strip.frames} asks for more than ${p.name}'s ${n} frames`);
    frames = Array.from({ length: strip.frames }, (_, i) => Math.round((i * (n - 1)) / (strip.frames - 1)));
  }
  const scale = strip.scale || STRIP_CELL / p.size.w;
  const width = Math.max(1, Math.round(p.size.w * scale)), height = Math.max(1, Math.round(p.size.h * scale));
  const columns = Math.max(1, Math.min(contacts ? CONTACT_WINDOW.length : marks ? 3 : frames.length, Math.floor((STRIP_WIDTH - 48 + 14) / (width + 2 + 14))));
  let loupe = null, crop = null;
  if (strip.loupe) {
    const { x, y } = strip.loupe === true ? { x: p.size.w / 2, y: p.size.h / 2 } : strip.loupe;
    if (!(x >= 0 && x <= p.size.w && y >= 0 && y <= p.size.h)) {
      throw refuse(`--loupe ${x},${y} is outside ${p.name}'s ${p.size.w} x ${p.size.h} box`);
    }
    // The film's frame size, rounded to even pixels as the export rounds it.
    const k = filmScale(p), even = (v) => Math.max(2, 2 * Math.round(v / 2));
    const W = even(p.size.w * k), H = even(p.size.h * k), w = Math.min(width, W), h = Math.min(height, H);
    const clamp = (v, hi) => Math.min(Math.max(Math.round(v), 0), hi);
    crop = (cx, cy) => ({ sx: clamp(cx * k - w / 2, W - w), sy: clamp(cy * k - h / 2, H - h) });
    loupe = { x, y, scale: k, W, H, w, h, ...crop(x, y) };
  }
  for (const { x, y } of strip.samples || []) {
    if (!(x >= 0 && x <= p.size.w && y >= 0 && y <= p.size.h)) throw refuse(`--sample ${x},${y} is outside ${p.name}'s ${p.size.w} x ${p.size.h} box`);
  }
  const r2 = (v) => +v.toFixed(2);
  const cells = frames.map((frame, i) => {
    const own = shots && shots.find((s) => frame >= s.start && frame < s.end);
    const cell = { seed, params: {}, frame, t: heads[frame], seconds: hz ? frame / hz : 0, ...(own && { shot: own.name }), ...(marks && marks[i]) };
    // The frame's chains projected to the picture, in design units, for the page to draw over the frame.
    if (rig) {
      cell.armature = {
        chains: rig[frame].map((ch) => ({
          name: ch.name,
          segments: project(ch.segments, ch.view).segments.map((g) => ({
            a: g.a.map(r2), b: g.b.map(r2),
            sections: g.sections.map((s) => ({ centre: s.centre.map(r2), major: r2(s.major), minor: r2(s.minor), angle: +s.angle.toFixed(4) })),
          })),
        })),
        faults: rigFaults.filter((f) => f.frame === frame),
      };
    }
    // A contact at a point gets the crop around that point, kept inside the
    // frame, unless --loupe names a point of its own.
    if (crop && strip.loupe === true && cell.point) cell.loupe = crop(cell.point.x, cell.point.y);
    // A contact's first cell starts a grid row, in the column its offset holds
    // in a whole contact, so a contact cut short by the film's start keeps its
    // contact frame under every other's and the next contact starts a new row.
    if (cell.contact && (i === 0 || marks[i - 1].contact !== cell.contact)) cell.column = ((cell.offset - CONTACT_WINDOW[0]) % columns) + 1;
    return cell;
  });
  const layout = { cells, frames: n, hz, scale, width, height, columns, loupe, seed, ...(contacts && { contacts: contacts.length }), ...(strip.parts && { parts: strip.parts }), ...(strip.figures && { figures: strip.figures, film: filmScale(p) }), ...(strip.samples && { samples: strip.samples }), ...(strip.twoValues && { twoValues: strip.twoValues }), ...(pageShots && { pageShots }), ...(rig && { armature: { rules: ARMATURE_RULES, faults: rigFaults } }) };
  if (strip.at && hz) {
    // Distinct --at seconds that fall in one frame draw the same picture twice.
    const byFrame = new Map();
    strip.at.forEach((s, i) => byFrame.set(frames[i], [...new Set([...(byFrame.get(frames[i]) || []), s])]));
    const repeats = [...byFrame].filter(([, at]) => at.length > 1).map(([frame, at]) => ({ frame, at }));
    if (repeats.length) layout.repeats = repeats;
  }
  if (strip.cuts) layout.cuts = { ...cutPlan(p, shots, state), rules: CUT_RULES, size: p.size };
  if (strip.sound) {
    // One time axis the width of a row of cells, the whole film from its left
    // edge: each frame shown marked where it starts, each cut where the next shot does.
    const across = columns * (width + 2) + (columns - 1) * 14, x = (frame) => Math.min(across - 1, Math.round((frame / n) * across));
    layout.sound = {
      width: across, wave: SOUND_WAVE, rows: SOUND_ROWS,
      marks: [...new Set(frames)].map((frame) => ({ frame, x: x(frame) })),
      cuts: (shots || []).slice(1).map((s) => ({ shot: s.name, frame: s.start, x: x(s.start) })),
      shots: (shots || []).map((s) => ({ shot: s.name, start: s.start, end: s.end })),
    };
  }
  if (strip.motion) {
    // The whole film on one axis the width of a row of cells, every frame
    // drawn small. A cut is a shot's first frame or a framing cut the piece marks.
    const across = columns * (width + 2) + (columns - 1) * 14, small = Math.min(MOTION.width, p.size.w) / p.size.w;
    const views = state && state.cues && Array.isArray(state.cues.views) ? state.cues.views : [];
    const cuts = [...new Set([...(shots || []).slice(1).map((s) => s.start), ...views.map((v, f) => (v && v.cut ? f : -1)).filter((f) => f > 0)])].sort((a, b) => a - b);
    layout.motion = {
      width: across, height: MOTION.height, hz, heads, scale: small, rules: MOTION, cuts,
      w: Math.max(1, Math.round(p.size.w * small)), h: Math.max(1, Math.round(p.size.h * small)),
      marks: [...new Set(frames)].map((frame) => ({ frame, x: Math.min(across - 1, Math.round((frame / n) * across)) })),
    };
  }
  return layout;
}

function pieceOf(name, external = null, box = null) {
  const pieces = external ? Object.fromEntries([[external.piece.name, external.piece]]) : EXAMPLES;
  if (!Object.hasOwn(pieces, name)) {
    throw refuse(`no example called "${name}". Known: ${Object.keys(EXAMPLES).join(', ')}. ${pieceHint(name)}`);
  }
  // A box the piece does not accept is refused here, by name, before a page is written.
  const p = validate(pieces[name]);
  if (!box) return p;
  try { return atBox(p, box); } catch (e) { throw refuse(e.message.replace(/^atBox: /, '')); }
}

function sheetPlans(names, count, paramNames = [], external = null, box = null, strip = null, seeds = null) {
  return names.map((name) => (strip ? planStrip(pieceOf(name, external, box), strip).cells
    : planSheet(pieceOf(name, external, box), count, paramNames, seeds)));
}

/**
 * The part of a `W` x `H` photo that fills a `w` x `h` crop when each photo
 * pixel is shown `scale` pixels wide: `sw` x `sh` photo pixels from (sx, sy),
 * around the point `at` or the centre, kept inside the photo as a loupe is kept
 * inside the frame. The origin and size are whole photo pixels, so no row or
 * column is blended with its neighbour or drawn short; a scale that does not
 * divide the crop leaves its remainder blank. A point outside the photo, which
 * spans 0 to W - 1 and 0 to H - 1, is refused by name.
 */
function photoCrop(W, H, { w, h }, at = null, scale = 1) {
  const { x, y } = at || { x: W / 2, y: H / 2 };
  if (x >= W || y >= H) throw refuse(`--reference point ${x},${y} is outside the photo's ${W} x ${H} pixels`);
  const sw = Math.min(W, Math.floor(w / scale)), sh = Math.min(H, Math.floor(h / scale));
  if (sw < 1 || sh < 1) throw refuse(`--reference-scale ${scale} leaves no whole photo pixel in the ${w} x ${h} crop; the largest scale that fits is ${Math.min(w, h)}`);
  const clamp = (v, max) => Math.floor(Math.max(0, Math.min(max, v)));
  return { x, y, scale, w, h, sx: clamp(x - sw / 2, W - sw), sy: clamp(y - sh / 2, H - sh), sw, sh };
}

// Runs in the browser: the decoded photo's crop, centred and losslessly encoded;
// at scale 1 or more each photo pixel stays a hard square. The data URL is the
// smaller of a PNG and a WebP at quality 1, which Chromium encodes losslessly,
// and the WebP is kept only when it decodes to the canvas's pixels exactly.
async function drawCrop(c) {
  var canvas = document.createElement('canvas');
  canvas.width = c.w; canvas.height = c.h;
  var g = canvas.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = c.scale < 1;
  g.imageSmoothingQuality = 'high';
  var dw = c.sw * c.scale, dh = c.sh * c.scale;
  g.drawImage(globalThis.__photo, c.sx, c.sy, c.sw, c.sh, Math.floor((c.w - dw) / 2), Math.floor((c.h - dh) / 2), dw, dh);
  var png = canvas.toDataURL('image/png'), webp = canvas.toDataURL('image/webp', 1);
  if (webp.indexOf('data:image/webp') !== 0 || webp.length >= png.length) return png;
  var back = document.createElement('canvas');
  back.width = c.w; back.height = c.h;
  var b = back.getContext('2d', { willReadFrequently: true });
  b.drawImage(await createImageBitmap(await (await fetch(webp)).blob()), 0, 0);
  var want = g.getImageData(0, 0, c.w, c.h).data, got = b.getImageData(0, 0, c.w, c.h).data;
  for (var i = 0; i < want.length; i++) if (want[i] !== got[i]) return png;
  return webp;
}

/**
 * The reference photo `file` cut to the loupe's `w` x `h` in installed Edge,
 * around `at` (photo pixels, the centre when null) at `scale`, so the sheet
 * embeds only the crop, never the whole file. `edge` stands in for withEdge in a test.
 */
async function cropReference(file, loupe, { at = null, scale = 1 } = {}, timeoutMs = undefined, edge = withEdge) {
  let bytes;
  try { bytes = fs.readFileSync(file); } catch (e) { throw refuse(`--reference cannot read ${file}: ${e.code || e.message}`); }
  const result = await edge('<!doctype html><title>reference</title>', { file: bytes, timeoutMs, command: 'seeds' }, async (client, context) => {
    context.phase = 'reference photo decoding';
    await waitFor(client, context, "location.protocol === 'http:' && document.readyState === 'complete'");
    const { W, H } = await evaluate(client, "(async () => { var b = globalThis.__photo = await createImageBitmap(await (await fetch('/file')).blob()); return { W: b.width, H: b.height }; })()");
    let crop;
    try { crop = photoCrop(W, H, loupe, at, scale); } catch (refused) { return { refused }; }
    context.phase = 'reference photo crop';
    // A crop at a large --scale can pass the 4 MiB one reply may carry, so it comes back in pieces.
    const src = await evaluateInPieces(client, '(' + drawCrop.toString() + ')(' + JSON.stringify(crop) + ')');
    pageErrors(client, context);
    return { crop, photo: { W, H }, src };
  });
  if (result.refused) throw result.refused;
  return { name: path.basename(file), at, bytes: bytes.length, photo: result.photo, src: result.src, ...result.crop };
}

/**
 * The reference sound `file` decoded in installed Edge at 48 kHz and measured
 * by soundProfile as the strip's soundtrack is. The file's bytes stay in memory
 * and in the loopback reply; only its numbers come back. `edge` stands in for withEdge in a test.
 */
async function measureSound(file, timeoutMs = undefined, edge = withEdge) {
  let bytes;
  try { bytes = fs.readFileSync(file); } catch (e) { throw refuse(`--sound-reference cannot read ${file}: ${e.code || e.message}`); }
  const result = await edge('<!doctype html><title>sound reference</title>', { file: bytes, timeoutMs, command: 'seeds' }, async (client, context) => {
    context.phase = 'sound reference decoding';
    await waitFor(client, context, "location.protocol === 'http:' && document.readyState === 'complete'");
    const measured = await evaluateInPieces(client, "(async function () { var data = await (await fetch('/file')).arrayBuffer(), a; "
      + 'try { a = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(data); } catch (e) { return { error: String((e && e.message) || e) }; } '
      + 'var ch = []; for (var i = 0; i < a.numberOfChannels; i++) ch.push(a.getChannelData(i)); '
      + 'return { seconds: a.duration, rate: a.sampleRate, channels: a.numberOfChannels, profile: (function () { ' + SOUND_HELPERS + ' return (' + soundProfile.toString() + ')(ch, a.sampleRate); })() }; })()');
    pageErrors(client, context);
    return measured;
  });
  if (result.error) throw refuse(`--sound-reference cannot decode ${path.basename(file)}: ${result.error}`);
  if (!(result.seconds > 0)) throw refuse(`--sound-reference ${path.basename(file)} holds no samples`);
  return { file: path.basename(file), bytes: bytes.length, seconds: result.seconds, rate: result.rate, channels: result.channels, profile: result.profile };
}

function page(names, count, t, paramNames = [], external = null, box = null, strip = null, reference = null, seeds = null, views = null, soundReference = null, lightPage = false, planned = null) {
  if (!Number.isFinite(t)) throw refuse('playhead must be a finite number');
  // `planned`, the strip's layout already planned, saves building the piece again.
  const layout = strip && (planned || planStrip(pieceOf(names[0], external, box), strip));
  // A reference photo, cut by cropReference to the size of a 100% crop and shown
  // pixel for pixel as the first cell, so the material is compared at one scale.
  let photo = '';
  if (reference) {
    const { w, h, name, src, at, x, y, scale, sx, sy, sw, sh } = reference;
    const text = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const where = at ? `around (${x}, ${y})` : 'centre', size = +(scale * 100).toFixed(2) + '%';
    // The caption names the photo pixels the crop really shows, which is less
    // than the cell when the photo is smaller or the scale leaves a remainder.
    const area = `${sw} × ${sh} photo px from (${sx}, ${sy})`;
    photo = `<figure id="reference"><div class="photo" style="width:${w}px;height:${h}px"><img id="reference-photo" src="${text(src)}" alt="Reference photo ${text(name)}, ${where}, ${size}, ${area}"></div>`
      + `<figcaption>reference photo ${text(name)} · ${size}, ${where}, ${area}</figcaption></figure>\n`;
  }
  const plans = layout ? [layout.cells] : sheetPlans(names, count, paramNames, external, box, null, seeds);
  const json = (value) => JSON.stringify(value).replace(/</g, '\\u003c');
  const swept = layout ? [] : paramNames;
  const labels = plans.map((cells) => {
    const columns = swept.map((key) => sweepLabels(cells.map((cell) => cell.params[key]), count));
    // With --seeds each cell also names its row's seed.
    return cells.map((cell, i) => (seeds ? ['seed ' + cell.seed] : []).concat(swept.map((key, k) => key + '=' + columns[k][i])).join(' · '));
  });
  // A --sound strip adds its soundtrack under the frames, and window.__sheet
  // appears only once it has drawn or failed; without it the page is unchanged.
  const sound = layout && layout.sound;
  const soundCode = (sound ? `${SOUND_HELPERS}${levelText.toString()}\n${soundPicture.toString()}\n${soundSummary.toString()}\n${soundProfile.toString()}\n${drawSound.toString()}\n${soundStems.toString()}\n${shotGaps.toString()}\n${silentSpans.toString()}\n` : '')
    + (layout && layout.motion ? `${motionSummary.toString()}\n${drawMotion.toString()}\n` : '')
    + (reference ? `${styleStats.toString()}\n${styleGap.toString()}\n${styleText.toString()}\n` : '')
    // A strip reports each cell's lightness with cellViews, with or without views.
    + (views || layout ? `${cellViews.toString()}\n` : '');
  // With a reference photo, each 100% crop's style gap from it: the photo's
  // statistics once it has decoded, then every crop's gap, before window.__sheet.
  const styleDraw = reference ? `  var styleDone = Promise.resolve().then(function () {
    var img = document.getElementById('reference-photo');
    return img.decode().then(function () {
      var c = document.createElement('canvas');
      c.width = REF.w; c.height = REF.h;
      var g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      var photo = styleStats(g.getImageData(0, 0, REF.w, REF.h));
      results.forEach(function (r, i) {
        if (!crops[i]) return;
        r.style = styleGap(photo, crops[i]);
        var line = document.createElement('figcaption');
        line.textContent = 'style gap from the photo: ' + styleText(r.style);
        figures[i].appendChild(line);
      });
    });
  }).catch(function (e) {
    var bad = document.createElement('p');
    bad.className = 'bad';
    bad.textContent = 'style gap \\u2014 ' + e.message;
    out.appendChild(bad);
  });
` : '';
  const soundDraw = sound ? `  var soundDone = (function () {
    // The strip's own build, so a piece whose build is its film is solved once.
    var S = STRIP.sound, p = stripBuild.p, build = stripBuild.build;
    var fig = document.createElement('figure'), c = document.createElement('canvas'), cap = document.createElement('figcaption');
    fig.style.marginTop = '18px';
    c.style.width = 'auto';
    c.setAttribute('role', 'img');
    c.setAttribute('aria-label', NAMES[0] + ' soundtrack: waveform, envelope and spectrogram across the film');
    fig.appendChild(c); fig.appendChild(cap); out.appendChild(fig);
    // measureSound's numbers for a --sound-reference file, never the file itself.
    var result = { error: null${soundReference ? `, reference: ${json(soundReference)}` : ''} };
    return Promise.resolve().then(function () { if (build.error) throw build.error; return render.renderSound(p, build.solved); }).then(function (buffer) {
      // Levelled as the MP4 export levels its AAC soundtrack, so what shows is what the film plays.
      var film = req('core/film.js'), marks = film.soundMarks(build.solved.state, STRIP.hz);
      result.level = film.normalizeLoudness(buffer, 'mp4a', marks);
      var channels = [];
      for (var i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i));
      var squares = soundSquares(channels);
      var pic = soundPicture(channels, buffer.sampleRate, S.width, S.rows, squares);
      result.silences = silentSpans(squares, buffer.sampleRate);
      c.width = S.width; c.height = 16 + S.wave + 6 + S.rows + 18;
      drawSound(c.getContext('2d'), pic, Object.assign({}, S, { silences: result.silences }));
      var sum = soundSummary(pic), quiet = sum.rmsDb.min, loud = sum.rmsDb.max;
      result.seconds = pic.seconds; result.peakDb = sum.peakDb; result.rmsDb = sum.rmsDb;
      result.profile = soundProfile(channels, buffer.sampleRate, squares);
      beatSound = { seconds: pic.seconds, rms: pic.rms, events: result.profile.events, squares: squares };
      var L = result.level;
      cap.textContent = 'Soundtrack, ' + pic.seconds.toFixed(3) + ' s across ' + S.width + ' px, levelled as the film\\u2019s AAC: '
        + levelText(L) + '; peak ' + result.peakDb.toFixed(1) + ' dBFS, envelope '
        + quiet.toFixed(1) + ' to ' + loud.toFixed(1) + ' dBFS. Top: every channel\\u2019s samples (blue) and their RMS over 50 ms (yellow, -60 to 0 dBFS, a line every 12 dB). '
        + 'Below: its spectrogram, ' + pic.from + ' Hz to ' + pic.to / 1000 + ' kHz on a log scale, -96 dB black to 0 dB pale. '
        + 'Grey lines start the frames shown, by number' + (S.cuts.length ? '; red lines are shot cuts, named by the shot that starts.' : '.')
        + (result.silences.length ? ' Shaded spans are silent, under -60 dBFS for 0.5 s or more.' : '');
      // Where the limiter cut, by beat or 400 ms block, and how far each event
      // stands over the bed before it: the planned events, or the ones found.
      var note = function (text, flag) { var line = document.createElement('p'); line.className = flag ? 'note flag' : 'note'; line.textContent = text; fig.appendChild(line); };
      var spans = L.beats || L.blocks;
      if (spans) {
        var cut = spans.filter(function (s) { return s.limited >= 1; });
        note('limiter by ' + (L.beats ? 'beat' : '400 ms block') + ', deepest cut ' + L.limited + ' dB: ' + (cut.length ? cut.map(function (s) { return s.from.toFixed(2) + '\\u2013' + s.to.toFixed(2) + ' s ' + s.limited.toFixed(1) + ' dB'; }).join(', ') : 'no span cut 1 dB or more') + '.');
      }
      var heard = L.events ? L : result.profile.events.length ? film.eventProminence(channels, buffer.sampleRate, result.profile.events.map(function (e) { return e.seconds; })) : null;
      if (heard) {
        result.prominence = heard;
        var low = heard.events.filter(function (e) { return e.prominence !== null && e.prominence < film.LOUDNESS.buried; });
        note(heard.events.length + (L.events ? ' planned' : ' found') + ' events over the median of the 300 ms before each: ' + heard.buried + ' under ' + film.LOUDNESS.buried + ' dB, buried'
          + (low.length ? ' (' + low.map(function (e) { return e.at.toFixed(2) + ' s ' + e.prominence.toFixed(1) + ' dB'; }).join(', ') + ')' : '')
          + '; ' + heard.close + ' closer than 100 ms to the one before.', heard.buried > 0 || heard.close > 0);
      }
      result.silences.forEach(function (s) {
        var line = document.createElement('p');
        line.className = 'note flag';
        line.textContent = 'silent ' + s.from.toFixed(2) + ' to ' + s.to.toFixed(2) + ' s'
          + (s.from === 0 ? ', from the first frame' : s.to >= pic.seconds - 0.001 ? ', to the last frame' : ', between sounds')
          + ': kept when the silence is planned, otherwise a bed or a low event carries it.';
        fig.appendChild(line);
      });
      return gaps(buffer.sampleRate);
    }).catch(function (e) {
      result.error = e.message;
      cap.className = 'bad';
      cap.textContent = 'soundtrack \\u2014 ' + e.message;
    }).then(function () { return result; });
    // A film-scaffold piece's events, bed voices and ambience, each rendered
    // alone and unlevelled, one after another; each shot's gaps under the figure.
    function gaps(rate) {
      var cues = build.solved.state.cues, stems = soundStems(cues && cues.sounds), squares = {};
      if (!stems) return;
      return ['events', 'bed', 'ambience'].reduce(function (chain, name) {
        return chain.then(function () {
          var state = Object.assign({}, build.solved.state, { cues: Object.assign({}, cues, { sounds: stems[name] }) });
          return render.renderSound(p, Object.assign({}, build.solved, { state: state })).then(function (b) {
            var ch = [];
            for (var i = 0; i < b.numberOfChannels; i++) ch.push(b.getChannelData(i));
            squares[name] = soundSquares(ch);
          });
        });
      }, Promise.resolve()).then(function () {
        result.gaps = shotGaps(S.shots.length ? S.shots : [{ shot: null, start: 0, end: STRIP.frames }], STRIP.hz,
          { rate: rate, events: squares.events, bed: squares.bed, ambience: squares.ambience });
        var dbText = function (x, none, tail) { return x === null ? none : x.toFixed(1) + tail; };
        result.gaps.forEach(function (g) {
          var line = document.createElement('p');
          line.className = g.short.length ? 'note flag' : 'note';
          line.textContent = (g.shot === null ? 'the film' : 'shot ' + g.shot) + ': events ' + dbText(g.eventsDb, 'no event voice', ' dBFS')
            + '; bed ' + dbText(g.bedGapDb, g.bedDb === null ? 'no bed' : '-', ' dB under') + ' (guide 10 to 20)'
            + '; ambience ' + dbText(g.ambienceGapDb, g.ambienceDb === null ? 'no ambience' : '-', ' dB under') + ' (guide 20 or more)'
            + (g.short.length ? '; ' + g.short.join(' and ') + ' short of the guide' : '') + '. Stems rendered apart, before levelling.';
          fig.appendChild(line);
        });
      }).catch(function (e) { result.gapsError = e.message; });
    }
  })();
` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Artifex — ${layout ? (layout.hz ? layout.cells.length + ' frames' : 'a still') : paramNames.length ? 'parameter sweep' : count + ' seeds'}</title>
<style>
  :root { --bg:#14151a; --fg:#e7e4dc; --dim:#8e8f99; --line:#2e313b;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  body { margin:0; padding:24px; background:var(--bg); color:var(--fg); font-size:12px; }
  h2 { font-size:12px; letter-spacing:.16em; text-transform:uppercase; margin:32px 0 4px;
       border-top:1px solid var(--line); padding-top:14px; }
  h2:first-of-type { margin-top:0; border-top:0; padding-top:0; }
  .note { color:var(--dim); margin:0 0 14px; }
  .knobs { color:var(--dim); margin:-10px 0 14px; padding-left:16px; line-height:1.7; }
  .knobs b { color:var(--fg); font-weight:normal; }
  .sheet { display:grid; grid-template-columns:repeat(auto-fill, minmax(240px, 1fr)); gap:14px; }
  .sheet.sweep { grid-template-columns:repeat(var(--columns), minmax(220px, 1fr)); }
  /* A strip shows every canvas pixel as one CSS pixel, its 1px border outside it. */
  .sheet.strip { grid-template-columns:repeat(var(--columns), calc(var(--cell) + 2px)); }
  .strip canvas { width:auto; }
  .strip figcaption + canvas { margin-top:10px; }
  .viewport { overflow-x:auto; padding-bottom:10px; scrollbar-color:var(--dim) var(--bg); }
  .viewport:focus-visible { outline:2px solid var(--fg); outline-offset:4px; }
  figure { margin:0; min-width:0; }
  canvas { width:100%; box-sizing:border-box; display:block; background:#fff; border:1px solid var(--line); }
  figcaption { color:var(--dim); margin-top:7px; line-height:1.6; font-variant-numeric:tabular-nums; }
  .values { color:var(--fg); overflow-wrap:anywhere; }
  .legend { color:var(--dim); max-width:75ch; line-height:1.6; }
  .bad { color:#e8705a; white-space:pre-wrap; }
  .flag { color:#e8b25a; }
  .photo { overflow:hidden; border:1px solid var(--line); }
  .photo img { display:block; }
  @media (max-width:600px) { body { padding:16px; } }
${lightPage ? `  /* --light-page: a light surround, to judge darkness as a lit room or a light page shows it. */
  :root { --bg:#f2f1ec; --fg:#1d1e22; --dim:#5b5d66; --line:#c8cad0; }
  .bad { color:#b0321c; } .flag { color:#8a5600; }
` : ''}</style>
</head>
<body>
${photo}<div id="out"></div>
${layout && layout.cuts ? cutOverlay(layout) + `<p class="legend">Under each shot's first frame from the second shot on, the last frame of the shot before it, with this frame over it at 50%.
The ring is the incoming focus, ${+(CUT_RULES.radius * 100).toFixed(2)}% of the frame's width in radius; the square is the outgoing frame's strongest edge in it, outside a ring as wide around the outgoing focus,
in amber at a block luma step of ${CUT_RULES.edge} or more. Mass is the share of the frame's contrast with its ground left of centre, flipped when the two frames sit on opposite sides of 0.5 by ${CUT_RULES.side} or more.
These measures report and never fail. The tracks are the piece's written focus points carried through its views, not tracked subjects.</p>
` : ''}${layout && layout.armature ? `<p class="legend">The armature view draws the piece's state.cues.armature over each frame: bone axes and section ellipses in blue, joints as dots, faulted joints and planted ends ringed in red.
Rules: a front-view bend joint more than ${ARMATURE_RULES.line} of its neighbours' span off the line between them with no pose reason, a joint past its limit, a segment changing length by more than ${ARMATURE_RULES.stretch} of it, a planted end moving more than ${ARMATURE_RULES.slide} design units, each since the frame before.
The view shows what the piece keeps, not what it paints.</p>
` : ''}<p class="legend">Marks count paint calls. Bbox is the bounding-box area of painted pixels,
including backgrounds, as a percentage of the canvas. Build time excludes drawing.
These diagnostics do not measure artistic quality.</p>
${views ? `<p class="legend">The value view is OKLCh lightness blurred about 2% of the cell's width and cut into 3 levels;
its ring marks the peak, the strongest value step at that scale, not a judgement of where the subject is.
Colour-vision views simulate dichromacy with the Machado 2009 matrices.
The print-gamut view paints magenta every pixel more than 0.02 in OKLab from an approximate gamut of offset printing
on coated paper (the tints, two-ink patches and solids with black of the characterization data given to --gamut), every other pixel in its grey; a real printer needs its own profile.</p>
` : ''}<script>
${bundle(external)}
${pixelBounds.toString()}
var PAINT = ${json(PAINT)};
${measureFrame.toString()}
${layout && layout.parts ? partCover.toString() + '\n' : ''}${layout && layout.figures ? figureFill.toString() + '\n' + silhouette.toString() + '\n' : ''}${frameDetail.toString()}
${gridChange.toString()}
${litArea.toString()}
${layout && layout.cuts ? `${strayEdge.toString()}\n${massShare.toString()}\n` : ''}${layout && layout.hz ? beatSummary.toString() + '\n' : ''}${trustedCell.toString()}
${opensRun.toString()}
${stripFlags.toString()}
${soundCode}(function () {
  var req = __require('');
  var piece = req('core/piece.js');
  var render = req('core/render.js');
${layout && layout.pageShots ? `  // shotList as planStrip reads it, for the strip whose shots the page tags.
  var playheads = render.playheads, refuse = function (cause) { return new Error('seeds: ' + cause); };
  ${shotList.toString()}
` : ''}  // Loaded by the first stage, so a piece whose module is slow at load names that stage.
  var EX;
  var NAMES = ${json(names)};
  var PARAMS = ${json(paramNames)};
  var SEEDS = ${json(seeds)};
  var PLANS = ${json(plans)};
  var LABELS = ${json(labels)};
  var COUNT = ${count};
  var T = ${t};
  var BOX = ${json(box)};
  var STRIP = ${json(layout && { ...layout, cells: undefined, pageShots: undefined })};
  var PAGE_SHOTS = ${json(!!(layout && layout.pageShots))};
  var RULES = ${json(STRIP_RULES)};
  var REF = ${json(reference && { w: reference.w, h: reference.h })};
  var VIEWS = ${json(views)};
  var out = document.getElementById('out');
  var results = [];
  // The piece modules' load, each piece's setup, which adds its cells' piece
  // build and frame draw and a strip's flags right after itself, then the
  // sheet's results, each a { stage, run } run in order below.
  var steps = [{ stage: 'piece module load', run: function () { EX = req('examples/index.js'); } }], PROGRESS = ${json(SHEET_PROGRESS)};
  // Where add puts the next step: right after the step running.
  var cursor = 0;
  function add(step) { steps.splice(cursor++, 0, step); }
  // A strip's block grids and lumas, by result, and the captions its flags are written into.
  var grids = [], lumas = [], captions = [], statLines = [], flags = null;
  // With --cuts, each strip cell's canvas and frame detail, by result, for the cut pairs.
  var canvases = [], details = [];
  // A strip's one piece and build, which a --sound strip's soundtrack reuses.
  var stripBuild = null;
  // The first refusal the page meets, or null: a shot list it tags from
  // (PAGE_SHOTS), or a --part or --figure colour the canvas rejects.
  var refusal = null;
  // The --sound strip's levelled rms and events, for the per-beat summary.
  var beatSound = null;
  // With a reference photo: each 100% crop's style statistics and its figure, by
  // result, and the canvas each crop is laid on white in to be measured.
  var crops = [], figures = [], measure = null;
  // The one-pixel memory canvas each timed draw is forced through.
  var pixel = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  // With --part, the memory canvas each cell's parts are measured on.
  var partCanvas = STRIP && STRIP.parts ? document.createElement('canvas') : null;
  // With --figure, the memory canvas each cell's figures are filled on.
  var figureCanvas = STRIP && STRIP.figures ? document.createElement('canvas') : null;

  NAMES.forEach(function (name, nameIndex) { steps.push({ stage: 'piece setup of ' + name, run: function () {
    var p = piece.validate(EX[name]);
    if (BOX) p = piece.atBox(p, BOX);
    var h2 = document.createElement('h2');
    h2.textContent = name;
    var note = document.createElement('p');
    note.className = 'note';
    // Whether any contact cell's crop sits around its own point.
    var pointed = STRIP && PLANS[nameIndex].some(function (cell) { return cell.loupe; });
    note.textContent = p.size.w + ' \u00d7 ' + p.size.h + ' \u00b7 '
      + (STRIP ? (STRIP.hz ? STRIP.frames + ' frames at ' + STRIP.hz + ' fps, ' + PLANS[0].length + ' shown' + (STRIP.contacts ? ' around ' + STRIP.contacts + ' contact frame' + (STRIP.contacts > 1 ? 's' : '') : '') : 'a still, shown') + ' at seed ' + STRIP.seed
        + ', ' + STRIP.width + ' px wide (scale ' + +STRIP.scale.toFixed(4) + ')'
        + (STRIP.loupe ? ', each with a 100% crop of the ' + STRIP.loupe.W + ' \u00d7 ' + STRIP.loupe.H + (STRIP.hz ? ' film' : ' image') + ' around '
          + (pointed ? 'each contact\u2019s point, or ' : '') + '(' + STRIP.loupe.x + ', ' + STRIP.loupe.y + ')' + (pointed ? ' for a contact without one' : '') : '')
        : p.time ? render.playheads(p).length + ' frames, shown at t=' + T : 'a still')
      + ' \u00b7 ' + p.outputs.join(' + ');
    if (PARAMS.length) {
      note.textContent += (SEEDS ? ' \u00b7 seeds ' + SEEDS.join(', ') : ' \u00b7 seed ' + p.seed + ' fixed') + ' \u00b7 '
        + COUNT + ' samples per axis \u00b7 columns: ' + PARAMS[0]
        + (SEEDS ? ', rows: one per seed' : PARAMS.length === 2 ? ', rows: ' + PARAMS[1] : '')
        + ' (min to max). Scroll to compare all values.';
    }
    var sheet = document.createElement('div');
    sheet.className = STRIP ? 'sheet strip' : PARAMS.length ? 'sheet sweep' : 'sheet';
    if (PARAMS.length) sheet.style.setProperty('--columns', COUNT);
    if (STRIP) { sheet.style.setProperty('--columns', STRIP.columns); sheet.style.setProperty('--cell', STRIP.width + 'px'); }
    var photo = document.getElementById('reference');
    if (photo) sheet.appendChild(photo);
    // The film's frame at its export scale, which each loupe is cut from.
    var film = STRIP && STRIP.loupe ? document.createElement('canvas') : null;
    if (film) { film.width = STRIP.loupe.W; film.height = STRIP.loupe.H; }
    // This piece's builds, by seed and params.
    var builds = {};
    out.appendChild(h2); out.appendChild(note);
    // Keep the meanings and held defaults next to the comparison.
    var keys = Object.keys(p.params);
    if (keys.length) {
      var knobs = document.createElement('ul');
      knobs.className = 'knobs';
      keys.forEach(function (k) {
        var d = p.params[k];
        var li = document.createElement('li');
        var nm = document.createElement('b');
        nm.textContent = k + (PARAMS.includes(k) ? ' (swept)' : ' ' + d.value);
        li.appendChild(nm);
        li.appendChild(document.createTextNode(
          ' \u00b7 ' + d.meaning + ' [' + d.min + '..' + d.max + ']'));
        knobs.appendChild(li);
      });
      out.appendChild(knobs);
    }
    var viewport = document.createElement('div');
    viewport.className = 'viewport';
    if (PARAMS.length) {
      viewport.tabIndex = 0;
      viewport.setAttribute('role', 'region');
      viewport.setAttribute('aria-label', name + ' parameter comparison');
    }
    viewport.appendChild(sheet); out.appendChild(viewport);

    // The cells and the strip's flags; with PAGE_SHOTS, after the build below.
    var setupCells = function () {
    PLANS[nameIndex].forEach(function (cell, index) {
      var seed = cell.seed;
      var values = LABELS[nameIndex][index];
      var fig = document.createElement('figure');
      var c = document.createElement('canvas');
      var k = STRIP ? STRIP.scale : 480 / p.size.w;
      var opens = opensRun(PLANS[nameIndex], index);
      // A cell that opens a shot, but not its contact's row, shows no change; its label says why.
      var start = opens && index > 0 && cell.shot && !cell.mark && PLANS[nameIndex][index - 1].contact === cell.contact ? cell.shot + ', shot start · ' : '';
      var when = STRIP && !STRIP.hz ? 'the still' : STRIP ? (cell.mark ? cell.shot + ', ' + cell.mark + ' · '
        : (cell.contact ? 'contact ' + cell.contact + (cell.offset < 0 ? ', ' + -cell.offset + ' before' : cell.offset > 0 ? ', ' + cell.offset + ' after' : '') + ' · ' : '') + start)
        + 'frame ' + cell.frame + ' \u00b7 ' + cell.seconds.toFixed(3) + ' s' : '';
      c.width = STRIP ? STRIP.width : Math.round(p.size.w * k);
      c.height = STRIP ? STRIP.height : Math.round(p.size.h * k);
      c.setAttribute('role', 'img');
      c.setAttribute('aria-label', name + ', ' + (when || 'seed ' + seed) + (values ? ', ' + values : ''));
      var cap = document.createElement('figcaption');
      var label = document.createElement('div');
      label.className = 'values';
      label.textContent = when || values || 'seed ' + seed;
      var stats = document.createElement('div');
      cap.appendChild(label); cap.appendChild(stats);
      fig.appendChild(c); fig.appendChild(cap); sheet.appendChild(fig);
      if (cell.column) fig.style.gridColumnStart = cell.column;
      var at = STRIP ? cell.t : T, image = null;
      var result = { name: name, seed: seed, params: cell.params, t: at, error: null };
      if (STRIP) { result.frame = cell.frame; result.seconds = cell.seconds; }
      if (cell.shot) result.shot = cell.shot;
      if (cell.mark) result.mark = cell.mark;
      if (cell.contact) { result.contact = cell.contact; result.offset = cell.offset; if (cell.point) result.point = cell.point; }
      results.push(result);
      captions.push(cap);
      statLines.push(stats);
      var ri = results.length - 1, solved = null;
      var fail = function (e) {
        result.error = e.message;
        // A failed cell is not judged, as stripFlags leaves its hold null; its lit area stays.
        if (STRIP) result.change = null;
        if (result.light) { result.light.move = null; result.light.step = null; }
        stats.className = 'bad';
        stats.textContent = 'seed ' + seed + ' — ' + e.message;
      };
      var where = name + ' cell ' + (index + 1) + ' of ' + PLANS[nameIndex].length + ' (' + (when || values || 'seed ' + seed) + ')';
      // Cells at one seed and params share one build stage, timed once: a piece
      // whose build solves its whole film would otherwise solve it per cell.
      var key = seed + ' ' + JSON.stringify(cell.params || null), shared = key in builds;
      var build = builds[key] = builds[key] || { solved: null, error: null };
      if (STRIP) stripBuild = { p: p, build: build };
      // The build PAGE_SHOTS runs before the cells is the first cell's own.
      if (build.page) { build.page = false; if ('ms' in build) result.buildMs = build.ms; }
      else if (shared) result.buildMs = null;
      else add({ stage: 'piece build of ' + where, run: function () {
        try {
          var t0 = performance.now();
          build.solved = piece.solve(p, seed, cell.params);
          result.buildMs = performance.now() - t0;
          if (build.solved.stages.error) throw new Error(build.solved.stages.error.stage + ': ' + build.solved.stages.error.message);
        } catch (e) { build.error = e; }
      } });
      add({ stage: 'frame draw of ' + where, run: function () {
      if (build.error) fail(build.error);
      else { solved = build.solved; result.params = solved.state.params; }
      if (result.error !== null) return;
      try {
        if (STRIP) {
          // The median of three draws, each forced by a one-pixel read so it times
          // rasterization, not submission. One draw alone caught a 100 ms pause on
          // the page's first cell that a redraw of the same frame never showed.
          // The read copies a pixel into a memory canvas and reads that: reading
          // the cell itself moves it off the GPU, so it would not show the film's pixels.
          var g = c.getContext('2d'), times = [];
          for (var r = 0; r < 3; r++) {
            g.clearRect(0, 0, c.width, c.height);
            var t1 = performance.now();
            render.drawFrame(g, p, solved, at, { scale: k });
            pixel.drawImage(c, 0, 0, 1, 1, 0, 0, 1, 1);
            pixel.getImageData(0, 0, 1, 1);
            times.push(performance.now() - t1);
          }
          g.clearRect(0, 0, c.width, c.height);
          result.drawMs = times.sort(function (a, b) { return a - b; })[1];
        }
        Object.assign(result, measureFrame(c.getContext('2d'), function (surface) {
          result.t = render.drawFrame(surface, p, solved, at, { scale: k });
        }, function (pixels) { image = pixels; }, STRIP ? k : undefined));
        result.rasterSize = { width: c.width, height: c.height };
        if (STRIP) {
          var d = frameDetail(image), prev = grids[ri - 1], last = results[ri - 1], after = trustedCell(results, lumas, ri - 1);
          result.detail = d.detail;
          // The change since the previous cell, and the lit area in design units
          // with how far it moved and how much its level changed. A cell that
          // opens a run (opensRun) or follows a cell trustedCell does not trust
          // is compared neither by change nor by light: across a cut the move is
          // the cut's, and across contact rows the cells are not neighbours.
          result.change = after && !opens ? gridChange(prev, d.grid) : null;
          var lit = litArea(d), before = after && !opens && last.light;
          result.light = lit && { x: +(lit.x / k).toFixed(2), y: +(lit.y / k).toFixed(2), level: +lit.level.toFixed(2),
            move: before ? +Math.hypot(lit.x / k - before.x, lit.y / k - before.y).toFixed(2) : null,
            step: before ? +(lit.level - before.level).toFixed(2) : null };
          grids[ri] = d.grid;
          lumas[ri] = d.luma;
          canvases[ri] = c; details[ri] = d;
        }
        if (partCanvas) {
          // A piece that cannot draw without a canvas keeps its other cell data.
          // Setting the size every cell resets the context, so a transform, clip
          // or save a piece leaves unbalanced never reaches the next cell's passes.
          partCanvas.width = c.width; partCanvas.height = c.height;
          try {
            result.parts = partCover(partCanvas.getContext('2d', { willReadFrequently: true }), function (surface) {
              render.drawFrame(surface, p, solved, at, { scale: k });
            }, STRIP.parts);
          } catch (e) { result.partsError = e.message; if (e.refusal) refusal = refusal || e.message; }
        }
        if (figureCanvas) {
          // Each figure's flat fill, measured and drawn under the cell; widthStep compares it with the
          // previous cell's under the condition change uses. A piece that cannot draw without a canvas
          // keeps its other cell data.
          figureCanvas.width = c.width; figureCanvas.height = c.height;
          try {
            var fc = figureCanvas.getContext('2d', { willReadFrequently: true }), was = after && !opens ? results[ri - 1].figures : null;
            result.figures = STRIP.figures.map(function (f, j) {
              var flat = figureFill(fc, function (surface) { render.drawFrame(surface, p, solved, at, { scale: k }); }, f.styles);
              var s = silhouette(flat.data, flat.width, flat.height, k, STRIP.film), prev = was && was[j], step = null;
              if (s && prev && prev.widths) {
                step = 0;
                s.widths.forEach(function (w, i) { step = Math.max(step, Math.abs(w - prev.widths[i])); });
                step = +(step / (s.box[3] - s.box[1])).toFixed(2);
              }
              var fv = document.createElement('canvas'), fcap = document.createElement('figcaption');
              fv.width = c.width; fv.height = c.height;
              fv.style.marginTop = '10px';
              fv.setAttribute('role', 'img');
              fv.setAttribute('aria-label', name + ', ' + (when || 'seed ' + seed) + ', flat fill of ' + f.name);
              var fg = fv.getContext('2d'), id = fg.createImageData(flat.width, flat.height);
              for (var q = 0; q < id.data.length; q += 4) {
                id.data[q] = id.data[q + 1] = id.data[q + 2] = flat.data[q + 3] >= 128 ? 0x1a : 0xff;
                id.data[q + 3] = 255;
              }
              fg.putImageData(id, 0, 0);
              if (s) { fg.fillStyle = '#e8705a'; fg.fillRect(Math.floor(s.plumb.x * k), Math.round(s.box[1] * k), 1, Math.round((s.box[3] - s.box[1]) * k)); }
              var shut = s ? s.gaps.filter(function (g) { return g.closed; }).length : 0;
              var widest = s ? Math.max.apply(null, [0].concat(s.gaps.map(function (g) { return g.widest; }))) : 0;
              fcap.textContent = 'flat fill ' + f.name + ': ' + (!s ? 'nothing painted'
                : (s.gaps.length ? s.gaps.length + (s.gaps.length === 1 ? ' gap (' : ' gaps (') + shut + ' closed), widest ' + widest + ' px at film size' : 'no gaps')
                  + ', ' + s.pinholes + (s.pinholes === 1 ? ' pinhole' : ' pinholes') + ', plumb ' + (s.plumb.over ? 'over' : 'off') + ' its base');
              fig.appendChild(fv); fig.appendChild(fcap);
              return Object.assign({ name: f.name, area: 0, box: null, gaps: [], pinholes: 0, widths: null, runs: null, plumb: null }, s, { widthStep: step });
            });
          } catch (e) {
            // Shown under the cell too, so a page or PNG read without the JSON says why the fill is missing.
            result.figuresError = e.message;
            if (e.refusal) refusal = refusal || e.message;
            var ferr = document.createElement('figcaption');
            ferr.className = 'flag';
            ferr.textContent = 'flat fill failed: ' + e.message;
            fig.appendChild(ferr);
          }
        }
        if (cell.armature) {
          // --armature: the painted frame again, the chains the piece keeps drawn over it at the cell's scale,
          // each joint a fault names ringed.
          var AC = cell.armature.chains, AF = cell.armature.faults, av = document.createElement('canvas'), acap = document.createElement('figcaption');
          av.width = c.width; av.height = c.height;
          av.style.marginTop = '10px';
          av.setAttribute('role', 'img');
          av.setAttribute('aria-label', name + ', ' + (when || 'seed ' + seed) + ', armature over the frame');
          var ag = av.getContext('2d');
          ag.drawImage(c, 0, 0);
          var ring = function (pt, r, colour, filled) {
            ag.beginPath(); ag.arc(pt[0] * k, pt[1] * k, r, 0, 2 * Math.PI);
            if (filled) { ag.fillStyle = colour; ag.fill(); } else { ag.strokeStyle = colour; ag.lineWidth = 2; ag.stroke(); }
          };
          AC.forEach(function (ch) {
            ch.segments.forEach(function (sg) {
              ag.strokeStyle = '#1d7fd6'; ag.lineWidth = 1;
              sg.sections.forEach(function (s) { ag.beginPath(); ag.ellipse(s.centre[0] * k, s.centre[1] * k, s.major * k, s.minor * k, s.angle, 0, 2 * Math.PI); ag.stroke(); });
              ag.lineWidth = 2;
              ag.beginPath(); ag.moveTo(sg.a[0] * k, sg.a[1] * k); ag.lineTo(sg.b[0] * k, sg.b[1] * k); ag.stroke();
            });
            ring(ch.segments[0].a, 3, '#1a1a1a', true);
            ch.segments.forEach(function (sg) { ring(sg.b, 3, '#1a1a1a', true); });
          });
          var says = {
            line: function (f) { return f.chain + ' joint ' + f.joint + ' off its line'; },
            limit: function (f) { return f.chain + ' joint ' + f.joint + ' past its limit'; },
            length: function (f) { return f.chain + ' segment ' + f.segment + ' changes length'; },
            slide: function (f) { return f.chain + ' planted ' + f.end + ' slides'; },
          };
          AF.forEach(function (f) {
            var sgs = (AC.find(function (ch) { return ch.name === f.chain; }) || { segments: [] }).segments;
            var pt = f.kind === 'line' || f.kind === 'limit' ? sgs[f.joint - 1].b : f.kind === 'slide' ? (f.end === 'start' ? sgs[0].a : sgs[sgs.length - 1].b) : null;
            if (pt) ring(pt, 6, '#e8705a', false);
          });
          acap.textContent = 'armature: ' + AC.length + (AC.length === 1 ? ' chain' : ' chains')
            + (AF.length ? ' · ' + AF.length + (AF.length === 1 ? ' joint fault: ' : ' joint faults: ') + AF.map(function (f) { return says[f.kind](f); }).join(', ') : ' · no joint faults');
          if (AF.length) acap.className = 'flag';
          fig.appendChild(av); fig.appendChild(acap);
          result.armature = AF;
        }
        // A strip's cells, and any cell with views, carry their OKLCh lightness and chroma, the most saturated areas in
        // design units, and the time cellViews took.
        // With --sample, each design point's cell pixel, kept inside the cell.
        var want = STRIP && STRIP.samples ? STRIP.samples.map(function (s) {
          return [Math.min(image.width - 1, Math.floor(s.x * k)), Math.min(image.height - 1, Math.floor(s.y * k))];
        }) : null;
        // With two declared values, the share of pixels between them.
        var two = STRIP && STRIP.twoValues;
        var t2 = performance.now(), v = VIEWS || STRIP ? cellViews(image, Object.assign({}, VIEWS || {}, want ? { samples: want } : {}, two ? { twoValues: two } : {})) : null;
        result.viewMs = v ? performance.now() - t2 : null;
        if (v) {
          result.lightness = v.lightness;
          result.chroma = v.chroma;
          result.saturated = v.saturated && v.saturated.map(function (a) {
            return { x: +(a.x / k).toFixed(2), y: +(a.y / k).toFixed(2), w: +(a.w / k).toFixed(2), h: +(a.h / k).toFixed(2), share: a.share, chroma: a.chroma, hue: a.hue };
          });
          if (want) result.samples = STRIP.samples.map(function (s, j) { return Object.assign({ x: s.x, y: s.y }, v.samples[j]); });
          if (two) result.between = v.between;
        }
        stats.textContent = result.markCount + ' marks \u00b7 bbox ' + (result.coverage * 100).toFixed(1)
          + '% \u00b7 build ' + (result.buildMs === null ? 'shared' : result.buildMs.toFixed(1) + ' ms')
          + (STRIP ? ' \u00b7 draw ' + result.drawMs.toFixed(1) + ' ms' : '')
          + (v ? ' \u00b7 views ' + result.viewMs.toFixed(1) + ' ms' : '')
          + (STRIP ? ' \u00b7 detail ' + result.detail.toFixed(2) : '')
          + (result.between != null ? ' \u00b7 between values ' + (100 * result.between).toFixed(1) + '%' : '');
        // --cuts: under a shot's first frame, the outgoing shot's last frame with this one over it at half
        // strength, the incoming focus ringed and the outgoing focus dotted. Reported, never failed.
        var cut = STRIP && STRIP.cuts && cell.mark === 'first' && details[ri - 1]
          ? STRIP.cuts.cuts.find(function (x) { return x.frame === cell.frame; }) : null;
        if (cut) {
          var CR = STRIP.cuts.rules, bc = document.createElement('canvas'), bcap = document.createElement('figcaption');
          bc.width = c.width; bc.height = c.height;
          bc.style.marginTop = '10px';
          bc.setAttribute('role', 'img');
          bc.setAttribute('aria-label', name + ', cut ' + cut.cut + ' from ' + cut.from + ', its last frame under this first frame');
          var bg = bc.getContext('2d'), R = CR.radius * c.width;
          bg.drawImage(canvases[ri - 1], 0, 0);
          bg.globalAlpha = 0.5;
          bg.drawImage(c, 0, 0);
          bg.globalAlpha = 1;
          // Not at: that name holds the cell's playhead in this scope.
          var land = cut.in && [cut.in[0] * k, cut.in[1] * k], left = cut.out && [cut.out[0] * k, cut.out[1] * k];
          // A carried cut is the scaffold's unchecked one: the shape carrying the eye is no stray.
          var stray = land && !cut.carried ? strayEdge(details[ri - 1], land, left, R) : null;
          var strong = !!stray && stray.step >= CR.edge;
          bg.lineWidth = 2;
          if (land && left) { bg.strokeStyle = '#e8705a'; bg.beginPath(); bg.moveTo(left[0], left[1]); bg.lineTo(land[0], land[1]); bg.stroke(); }
          if (left) { bg.fillStyle = '#e8705a'; bg.beginPath(); bg.arc(left[0], left[1], 4, 0, 2 * Math.PI); bg.fill(); }
          if (land) { bg.strokeStyle = '#e8705a'; bg.beginPath(); bg.arc(land[0], land[1], R, 0, 2 * Math.PI); bg.stroke(); }
          if (stray) { bg.strokeStyle = strong ? '#e8b25a' : '#8e8f99'; bg.strokeRect(stray.x - 5, stray.y - 5, 10, 10); }
          var mass = { out: massShare(details[ri - 1]), in: massShare(d) };
          var side = function (s) { return s === null ? 0 : s >= 0.5 + CR.side ? -1 : s <= 0.5 - CR.side ? 1 : 0; };
          result.cut = {
            stray: stray && { step: +stray.step.toFixed(2), x: +(stray.x / k).toFixed(2), y: +(stray.y / k).toFixed(2) },
            strong: strong, mass: mass, flipped: side(mass.out) !== 0 && side(mass.out) === -side(mass.in),
          };
          bcap.textContent = 'cut ' + cut.cut + ' from ' + cut.from + ': its last frame under this first frame at 50%'
            + (land ? '; ring: the incoming focus, radius ' + +(CR.radius * p.size.w).toFixed(2) + ' design units; '
              + (cut.carried ? 'carried, so unchecked' : stray ? 'strongest outgoing edge in it ' + result.cut.stray.step + ' at (' + result.cut.stray.x + ', ' + result.cut.stray.y + ')' : 'no outgoing edge in it') : '')
            + '; mass left of centre: out ' + mass.out + ', in ' + mass.in + (result.cut.flipped ? ', flipped' : ', not flipped');
          fig.appendChild(bc); fig.appendChild(bcap);
          if (strong) {
            var sline = document.createElement('figcaption');
            sline.className = 'flag';
            sline.textContent = 'stray: an outgoing edge of ' + result.cut.stray.step + ' lies on the incoming focus';
            fig.appendChild(sline);
          }
        }
        if (VIEWS) {
          // The value, greyscale and colour-vision views, each under the cell at its size.
          if (VIEWS.values) result.peak = v.peak ? { x: +((v.peak.x + 0.5) / k).toFixed(2), y: +((v.peak.y + 0.5) / k).toFixed(2), contrast: v.peak.contrast } : null;
          if (VIEWS.gamut) result.gamut = v.outside;
          [['values', 'value view', 'values: blurred ' + v.radius + ' px, 3 levels \u00b7 ' + (result.peak ? 'peak contrast ' + result.peak.contrast + ' at (' + result.peak.x + ', ' + result.peak.y + ')' : 'flat, no peak')],
            ['grey', 'greyscale view', 'greyscale (OKLCh lightness)'], ['deuteranopia', 'deuteranopia view', 'deuteranopia'],
            ['protanopia', 'protanopia view', 'protanopia'], ['tritanopia', 'tritanopia view', 'tritanopia (simulated, Machado 2009)'],
            ['gamut', 'print-gamut view', 'print gamut (approximate, coated paper): ' + (v.outside ? (100 * v.outside.share).toFixed(1) + '% of pixels outside'
              + (v.outside.excess ? ', up to ' + v.outside.excess + ' from the gamut (OKLab)' : '') : 'no pixels')]].forEach(function (view) {
            var pic = v[view[0]];
            if (!pic) return;
            var vc = document.createElement('canvas'), vcap = document.createElement('figcaption');
            vc.width = c.width; vc.height = c.height;
            vc.style.marginTop = '10px';
            vc.setAttribute('role', 'img');
            vc.setAttribute('aria-label', name + ', ' + (when || values || 'seed ' + seed) + ', ' + view[1]);
            var vg = vc.getContext('2d'), id = vg.createImageData(pic.width, pic.height);
            id.data.set(pic.data);
            vg.putImageData(id, 0, 0);
            if (view[0] === 'values' && v.peak) {
              vg.beginPath();
              vg.arc(v.peak.x + 0.5, v.peak.y + 0.5, v.radius, 0, 2 * Math.PI);
              vg.strokeStyle = '#e8705a'; vg.lineWidth = 2;
              vg.stroke();
            }
            vcap.textContent = view[2];
            fig.appendChild(vc); fig.appendChild(vcap);
          });
        }
        if (film) {
          // A contact cell's crop sits around its contact; the others share the strip's point.
          var L = STRIP.loupe, fg = film.getContext('2d'), sx = cell.loupe ? cell.loupe.sx : L.sx, sy = cell.loupe ? cell.loupe.sy : L.sy;
          fg.clearRect(0, 0, L.W, L.H);
          render.drawFrame(fg, p, solved, at, { scale: L.scale });
          var crop = document.createElement('canvas');
          crop.width = L.w; crop.height = L.h;
          crop.getContext('2d').drawImage(film, sx, sy, L.w, L.h, 0, 0, L.w, L.h);
          crop.setAttribute('role', 'img');
          crop.setAttribute('aria-label', name + ', ' + when + ', 100% crop');
          var note100 = document.createElement('figcaption');
          note100.textContent = '100% of ' + L.W + ' \u00d7 ' + L.H + ', pixels ' + sx + ',' + sy + ' to ' + (sx + L.w) + ',' + (sy + L.h)
            + (cell.loupe ? ', around the contact at (' + +cell.point.x.toFixed(1) + ', ' + +cell.point.y.toFixed(1) + ')' : '');
          fig.appendChild(crop); fig.appendChild(note100);
          result.loupe = { x: sx, y: sy, width: L.w, height: L.h, scale: L.scale };
          if (REF) {
            // Measured over white, as the sheet shows the crop.
            measure = measure || document.createElement('canvas');
            measure.width = L.w; measure.height = L.h;
            var mg = measure.getContext('2d', { willReadFrequently: true });
            mg.fillStyle = '#fff'; mg.fillRect(0, 0, L.w, L.h);
            mg.drawImage(film, sx, sy, L.w, L.h, 0, 0, L.w, L.h);
            crops[ri] = styleStats(mg.getImageData(0, 0, L.w, L.h));
            figures[ri] = fig;
          }
        }
      } catch (e) { fail(e); }
      } });
    });
    if (STRIP) add({ stage: 'strip flags of ' + name, run: function () {
      // Reported, never failed: a dark or sparse frame can be the art.
      flags = stripFlags(results, lumas, RULES, p.size.w, STRIP.twoValues);
      // A cell's change from the frame before it and its hold measure, set by
      // stripFlags, where each was measured; a still has neither.
      if (STRIP.hz) results.forEach(function (r, i) {
        if (r.error !== null) return;
        if (r.change != null) statLines[i].textContent += ' · change ' + r.change.toFixed(2);
        if (r.hold != null) statLines[i].textContent += ' · hold ' + r.hold.toFixed(2);
      });
      flags.empty.forEach(function (e) {
        var line = document.createElement('div');
        line.className = 'flag';
        line.textContent = 'nearly empty: detail under ' + (e.why === 'floor' ? RULES.floor : RULES.dip * 100 + '% of the most detailed frame on each side');
        captions[e.cell].appendChild(line);
      });
      flags.unscaled.forEach(function (u) {
        var line = document.createElement('div');
        line.className = 'flag';
        line.textContent = 'unscaled: ' + u.marks + ' mark' + (u.marks > 1 ? 's' : '') + " painted at 1 pixel per design unit after setTransform, resetTransform, reset() or a restore() past the draw's own saves dropped the cell's scale of "
          + +STRIP.scale.toFixed(4) + ', so this cell may not show the frame';
        captions[u.cell].appendChild(line);
      });
      var heldLights = flags.lights.filter(function (l) { return l.held; });
      heldLights.forEach(function (l) {
        // A plain caption, not a flag: steady light is a shot's normal state.
        var line = document.createElement('div');
        line.className = 'light-held';
        line.textContent = 'light held' + (l.shot ? ' in ' + l.shot : '') + ': no move of ' + +(RULES.lightMove * p.size.w).toFixed(2)
          + ' design units or more, and no level or lit region falling to ' + RULES.lightLevel * 100 + '% of its highest';
        captions[l.to.cell].appendChild(line);
      });
      var runs = flags.lights.length;
      var report = document.createElement('p');
      report.className = flags.empty.length || flags.holds.length ? 'note flag' : 'note';
      report.textContent = !STRIP.hz ? (flags.empty.length ? 'The still is nearly empty' : 'The still is not nearly empty')
          + '. Detail is the mean step between blocks of luma 1/80 of the cell wide, 0 to 255.'
        : (flags.empty.length ? flags.empty.length + ' nearly empty frame' + (flags.empty.length > 1 ? 's' : '') : 'No nearly empty frame')
        + (flags.holds.length ? '; held: ' + flags.holds.map(function (h) {
          return 'frames ' + h.from.frame + ' to ' + h.to.frame + ' (' + h.seconds.toFixed(2) + ' s)';
        }).join(', ') : '; no hold of ' + RULES.holdSeconds + ' s or more')
        + (heldLights.length ? '; light held in ' + heldLights.length + ' of ' + runs + ' run' + (runs > 1 ? 's' : '') + ' of 2 cells or more'
          : runs ? '; the light changes in every run of 2 cells or more' : '')
        + ' among the frames shown. Detail is the mean step between blocks of luma 1/80 of the cell wide, 0 to 255.';
      if (flags.unscaled.length) {
        report.className = 'note flag';
        report.textContent += ' ' + flags.unscaled.length + ' cell' + (flags.unscaled.length > 1 ? 's' : '') + ' painted marks unscaled.';
      }
      if (STRIP.twoValues) {
        // A declared two-value film: a flag under each cell stripFlags lists.
        var dv = STRIP.twoValues[0], lv = STRIP.twoValues[1];
        var drawn = results.filter(function (r, i) { return trustedCell(results, lumas, i) && r.between != null; }).length;
        flags.between.forEach(function (f) {
          var line = document.createElement('div');
          line.className = 'flag';
          line.textContent = 'tone between the two values: ' + (100 * f.share).toFixed(1) + '% of pixels more than 0.05 from both ' + dv + ' and ' + lv
            + ' (over ' + RULES.between * 100 + '%)';
          captions[f.cell].appendChild(line);
        });
        if (flags.between.length) report.className = 'note flag';
        report.textContent += flags.between.length ? ' Tone between the two values in ' + flags.between.length + ' of ' + drawn + ' frame' + (drawn > 1 ? 's' : '') + '.'
          : ' Every frame keeps to the two values.';
      }
      out.appendChild(report);
    } });
    };
    if (!PAGE_SHOTS) return setupCells();
    // A --frames or --at strip planStrip left untagged: its one build, in the
    // stage its first cell's build has, tags each cell with the shot its frame
    // falls in before any cell is labelled, so labels, run breaks and results
    // match a strip planStrip tagged.
    var first = PLANS[nameIndex][0], tagged = { solved: null, error: null, page: true };
    builds[first.seed + ' ' + JSON.stringify(first.params || null)] = tagged;
    add({ stage: 'piece build of ' + name + ' cell 1 of ' + PLANS[nameIndex].length + ' (frame ' + first.frame + ' · ' + first.seconds.toFixed(3) + ' s)', run: function () {
      try {
        var t0 = performance.now();
        tagged.solved = piece.solve(p, first.seed, first.params);
        tagged.ms = performance.now() - t0;
        if (tagged.solved.stages.error) throw new Error(tagged.solved.stages.error.stage + ': ' + tagged.solved.stages.error.message);
      } catch (e) { tagged.error = e; }
      // A shot list shotList refuses, as planStrip would have: every cell fails
      // with the refusal, and the sheet carries it for the tool to refuse with.
      var list = null;
      if (!tagged.error) try { list = shotList(p, 'seeds', first.seed, tagged.solved.state); } catch (e) { tagged.error = e; refusal = refusal || e.message; }
      if (list) PLANS[nameIndex].forEach(function (cell) {
        var own = list.find(function (s) { return cell.frame >= s.start && cell.frame < s.end; });
        if (own) cell.shot = own.name;
      });
    } });
    add({ run: setupCells });
  } }); });
${layout && layout.motion ? `  // --motion: every frame drawn small and compared with the one before, a
  // second of film to a step, then the trace under the frames.
  var motion = null;
  (function () {
    var M = STRIP.motion, n = M.heads.length, changes = new Array(n).fill(0), last = null, c = null, g = null, failed = null;
    var luma = function () {
      var d = g.getImageData(0, 0, M.w, M.h).data, out = new Float32Array(M.w * M.h);
      for (var i = 0; i < out.length; i++) {
        var a = d[4 * i + 3] / 255;
        out[i] = 255 - a * (255 - (0.2126 * d[4 * i] + 0.7152 * d[4 * i + 1] + 0.0722 * d[4 * i + 2]));
      }
      return out;
    };
    var chunk = Math.max(1, Math.round(M.hz));
    for (var from = 0; from < n; from += chunk) (function (from) {
      steps.push({ stage: 'motion frames ' + from + ' to ' + (Math.min(n, from + chunk) - 1), run: function () {
        if (failed) return;
        try {
          var build = stripBuild && stripBuild.build;
          if (!build || build.error || !build.solved) throw build && build.error ? build.error : new Error('the piece was not built');
          if (!c) { c = document.createElement('canvas'); c.width = M.w; c.height = M.h; g = c.getContext('2d', { willReadFrequently: true }); }
          for (var f = from; f < Math.min(n, from + chunk); f++) {
            g.setTransform(1, 0, 0, 1, 0, 0);
            g.clearRect(0, 0, M.w, M.h);
            render.drawFrame(g, stripBuild.p, build.solved, M.heads[f], { scale: M.scale });
            var now = luma();
            if (last) { var sum = 0; for (var i = 0; i < now.length; i++) sum += Math.abs(now[i] - last[i]); changes[f] = sum / now.length; }
            last = now;
          }
        } catch (e) { failed = e; }
      } });
    })(from);
    steps.push({ stage: 'motion strip', run: function () {
      var fig = document.createElement('figure'), cap = document.createElement('figcaption');
      fig.style.marginTop = '18px';
      out.appendChild(fig);
      if (failed) { motion = { error: failed.message }; cap.className = 'bad'; cap.textContent = 'motion \\u2014 ' + failed.message; fig.appendChild(cap); return; }
      motion = motionSummary(changes, M.hz, M.cuts, M.rules);
      motion.error = null;
      var pic = document.createElement('canvas');
      pic.width = M.width; pic.height = M.height + 16;
      pic.style.width = 'auto';
      pic.setAttribute('role', 'img');
      pic.setAttribute('aria-label', NAMES[0] + ' motion energy across the film');
      drawMotion(pic.getContext('2d'), motion, M);
      cap.textContent = 'Motion energy, ' + n + ' frames across ' + M.width + ' px: the mean change in luma (0 to 255) from each drawing to the next, every frame drawn '
        + M.w + ' px wide, on a square-root scale to its peak of ' + motion.peak.toFixed(2) + '; the line is the median, ' + motion.median.toFixed(2)
        + (motion.step > 1 ? '; the film holds each drawing ' + motion.step + ' frames' : '') + '. Grey lines are cuts'
        + (motion.still.length ? '; shaded spans sit still, under ' + M.rules.still + ' for ' + M.rules.stillSeconds + ' s or more' : '')
        + (motion.jumps.length ? '; red lines are frames over ' + M.rules.jump + ' times the median that are not cuts' : '') + '.';
      fig.appendChild(pic); fig.appendChild(cap);
      var note = function (text) { var line = document.createElement('p'); line.className = 'note flag'; line.textContent = text; fig.appendChild(line); };
      motion.still.forEach(function (s) { note('still ' + s.from.toFixed(2) + ' to ' + s.to.toFixed(2) + ' s: kept when the hold is planned, otherwise something small keeps moving through it.'); });
      motion.jumps.forEach(function (j) { note('frame ' + j.frame + ' (' + j.seconds.toFixed(2) + ' s) changes ' + j.times + ' times the median with no cut: several changes starting on one frame, or a term switched on at a threshold.'); });
    } });
  })();
` : ''}  steps.push({ stage: ${sound ? "'soundtrack render'" : "'sheet results'"}, run: function () {
${soundDraw}${styleDraw}
  // The film scaffold's beat sheet, when the strip's build keeps one.
  var beatList = STRIP && STRIP.hz && stripBuild && !stripBuild.build.error && stripBuild.build.solved && stripBuild.build.solved.state.cues
    ? stripBuild.build.solved.state.cues.beats : null;
  window.__sheet = { names: NAMES, count: COUNT, t: STRIP ? null : T, paramNames: PARAMS, cells: results, strip: STRIP,
    flags: flags, failures: function () { return document.querySelectorAll('.bad').length; } };
  if (refusal) window.__sheet.refusal = refusal;
${layout && layout.motion ? '  window.__sheet.motion = motion;\n' : ''}  if (beatList) { var beats = beatSummary(beatList, STRIP.frames, STRIP.hz, results, lumas, null); if (beats) window.__sheet.beats = beats; }
  // --cuts: each cut's focus points and jump with what its pair measured; null measures where a cell failed.
  if (STRIP && STRIP.cuts) window.__sheet.cuts = STRIP.cuts.cuts.map(function (c) {
    var r = results.find(function (x) { return x.mark === 'first' && x.frame === c.frame && x.cut; });
    return Object.assign({}, c, r ? r.cut : { stray: null, strong: null, mass: null, flipped: null });
  });
${sound || reference ? `  var sheet = window.__sheet;
  delete window.__sheet;
  Promise.all([${sound ? 'soundDone' : 'null'}, ${reference ? 'styleDone' : 'null'}]).then(function (done) {
    ${sound ? 'sheet.sound = done[0]; if (beatList && beatSound) { var b = beatSummary(beatList, STRIP.frames, STRIP.hz, results, lumas, beatSound); if (b) sheet.beats = b; } ' : ''}window.__sheet = sheet;
  });
` : ''}  } });
  // In a browser each stage is reported to Node, then run in a task of its own,
  // so the report reaches Node first and a stall names its stage and cell; a
  // page with no MessageChannel, as in a test, runs every step at once.
  var channel = typeof MessageChannel === 'function' ? new MessageChannel() : null;
  (function next(i, reported) {
    for (; i < steps.length; i++, reported = false) {
      if (channel && steps[i].stage && !reported) {
        console.debug(PROGRESS + steps[i].stage);
        channel.port1.onmessage = next.bind(null, i, true);
        channel.port2.postMessage(0);
        return;
      }
      cursor = i + 1;
      steps[i].run();
    }
    if (channel) channel.port1.close();
  })(0, false);
})();
</script>
</body>
</html>
`;
}

const USAGE = 'usage: seeds [piece] [count] [playhead] [--param a[,b] [--seed n | --seeds n,n,...]] [--box WxH | --reframe t:WxH,...] [--values] [--grey] [--colour-vision] [--gamut FOGRA39L.txt] [--light-page] [--png] [--json] [--timeout-ms N]'
  + ' | seeds <piece> (--frames N | --at s,s,... | --shots [--cuts] | --contacts <list>) [--seed n] [--scale k] [--loupe [x,y] [--reference photo[@x,y] [--reference-scale k]]] [--sound [--sound-reference sound-file]] [--motion] [--box WxH | --reframe t:WxH,...] [--values] [--grey] [--colour-vision] [--gamut FOGRA39L.txt] [--light-page] [--part name=colour[+colour...]]... [--figure name=colour[+colour...]]... [--armature] [--sample x,y]... [--two-values dark,light] [--png] [--json] [--timeout-ms N]'
  + ' | seeds --compare <render.png> <reference.png> [--threshold n] [--json]'
  + ' | seeds <piece> --plan [--seed n] [--json]';
/** A refused argument: its cause, then the usage line. */
const refuse = (cause) => new Error('seeds: ' + cause + '\n' + USAGE);
// Said by parseArgs and by planSheet alike, so a caller of either reads the same refusal.
const SEEDS_NEED_ONE_PARAM = '--seeds draws one row per seed of a parameter sweep; give --param one name, such as --param reach --seeds 1,2,3';
// The browser --png or --json starts is stopped after 60 s unless --timeout-ms says otherwise, up to an hour.
const MAX_TIMEOUT_MS = 3600000;
// A parameter sweep draws one row per seed, so its seed list is kept short.
const MAX_SWEEP_SEEDS = 16;

// A plain decimal only: Number() would read '', ' ', 0x20 and 1e1 as numbers.
const plainDecimal = (text) => {
  const value = /^\d+(\.\d+)?$/.test(text ?? '') ? Number(text) : NaN;
  return Number.isFinite(value) ? value : NaN;
};
// What a refusal says it got in place of a value.
const gotText = (text) => (text === undefined ? 'nothing' : text.trim() ? text : JSON.stringify(text));
// Two declared values, dark then light OKLCh lightnesses, hold when both lie in 0 to 1 and the dark lies 0.2 or more under the light.
const twoValuesHold = ([dark, light]) => dark >= 0 && light <= 1 && light - dark >= 0.2 - 1e-9;

/**
 * The two values a film's beat sheet declares, as the comment line
 * `// two values: <dark>, <light>`, `/* two values: <dark>, <light> *\/` or
 * ` * two values: <dark>, <light>` in `text` (plain decimals, LF or CRLF
 * endings): [dark, light], or null when `text` holds no such line. Prose that
 * mentions two values mid-line declares nothing, nor does a line still holding
 * the `<dark L>` placeholder. The first other line counts; one that is not
 * exactly two plain decimals, or whose values do not hold, is refused, naming
 * `file`; until it, a value opening with another `<` declares nothing but is
 * passed to `note`. Each declaring line after it, and each other line holding a digit
 * somewhere after `two values:`, such as one after code, is passed to `note`
 * as a warning naming `file` and its line and quoting it, so it is not dropped
 * silently.
 */
function declaredValues(text, file, note = () => {}) {
  const lines = String(text).split(/\r?\n/);
  const DECLARING = /^\s*(?:\/\/+|\/?\*+)\s*two values:(.*)$/i;
  let line = null, first = 0;
  lines.forEach((l, i) => {
    const m = DECLARING.exec(l);
    if (!m) {
      const near = /two values:(?=.*\d).*/i.exec(l);
      if (near) note(`warning: ${file} line ${i + 1} holds ${near[0].trim()}, but seeds reads two values only from a comment line that opens with them, such as // two values: 0.12, 0.88`);
    } else if (/^\s*<dark L>/.test(m[1])) return; // the placeholder is passed over
    else if (line) note(`warning: ${file} line ${i + 1} holds ${l.trim()}, but seeds reads two values only from the first comment line that declares them, line ${first}`);
    else if (/^\s*</.test(m[1])) note(`warning: ${file} line ${i + 1} holds ${l.trim()}, but seeds reads a value that opens with < as declaring nothing; write two plain decimals, such as // two values: 0.12, 0.88`);
    else [line, first] = [m, i + 1];
  });
  if (!line) return null;
  const rest = line[1].replace(/\s*(\*\/)?\s*$/, '').trim();
  const m = /^(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)$/.exec(rest);
  if (!m) throw refuse(`${file} declares two values: ${rest} in its beat sheet; a declared two-value film's line reads two values: <dark>, <light> in plain decimals, such as two values: 0.12, 0.88`);
  const values = [Number(m[1]), Number(m[2])];
  if (!twoValuesHold(values)) throw refuse(`${file} declares two values: ${m[1]}, ${m[2]} in its beat sheet; a declared two-value film's dark value lies 0.2 or more under its light one, both from 0 to 1`);
  return values;
}

// Where a refusal sends the user for the characterization data that --gamut reads, which Artifex does not ship.
const PRINT_DATA_HINT = 'download FOGRA39L.txt, Fogra\'s data for offset printing on coated paper, from https://registry.color.org/cmyk-registry/fogra39 and pass its path, such as --gamut FOGRA39L.txt';
// The coverages, in percent, of the two-ink faces the print-gamut view reads.
const PRINT_LEVELS = [0, 10, 20, 40, 70, 100];

/**
 * The patches cellViews' print-gamut view needs, from the `text` of
 * characterization data in the CGATS layout of FOGRA39L.txt: the fields named
 * between BEGIN_DATA_FORMAT and END_DATA_FORMAT, among them CMYK_C, CMYK_M,
 * CMYK_Y, CMYK_K, LAB_L, LAB_A and LAB_B, and one patch per line between
 * BEGIN_DATA and END_DATA. A patch's coverages are percent and its LAB CIELAB
 * D50. When two lines hold the same four coverages, the first counts. Returns
 * `{ faces, blacks, blackL }` as cellViews documents them: the patches
 * without black of C with M, M with Y and Y with C, each ink at PRINT_LEVELS;
 * the solids C, C+M, M, M+Y, Y and C+Y with 20 and 40% black; and the L of C, M
 * and K 100%. A missing field, line value or patch is refused, naming `file`.
 */
function printData(text, file) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim());
  const at = (word, from = 0) => lines.indexOf(word, from);
  const f0 = at('BEGIN_DATA_FORMAT'), f1 = at('END_DATA_FORMAT', f0), d0 = at('BEGIN_DATA', f1), d1 = at('END_DATA', d0);
  if (f0 < 0 || f1 < 0 || d0 < 0 || d1 < 0) throw new Error(`seeds: ${file} holds no BEGIN_DATA_FORMAT ... END_DATA_FORMAT and BEGIN_DATA ... END_DATA blocks, so it is not characterization data in the layout of FOGRA39L.txt; ${PRINT_DATA_HINT}`);
  const fields = lines.slice(f0 + 1, f1).join(' ').split(/\s+/).filter(Boolean);
  const need = ['CMYK_C', 'CMYK_M', 'CMYK_Y', 'CMYK_K', 'LAB_L', 'LAB_A', 'LAB_B'], column = need.map((name) => fields.indexOf(name));
  const missing = need.filter((name, i) => column[i] < 0);
  if (missing.length) throw new Error(`seeds: ${file} has no ${missing.join(', ')} field; the print-gamut view reads each patch's CMYK coverage and CIELAB, as FOGRA39L.txt holds them; ${PRINT_DATA_HINT}`);
  const patches = new Map();
  for (let i = d0 + 1; i < d1; i++) {
    if (!lines[i] || lines[i].startsWith('#')) continue;
    const words = lines[i].split(/\s+/), values = column.map((c) => (words[c] === undefined ? NaN : Number(words[c])));
    if (words.length !== fields.length || !values.every(Number.isFinite)) throw new Error(`seeds: ${file} line ${i + 1} holds ${words.length} values where its data format names ${fields.length} fields, or a CMYK or LAB value that is not a number: ${lines[i]}`);
    const key = values.slice(0, 4).join();
    if (!patches.has(key)) patches.set(key, values.slice(4));
  }
  const get = (c, m, y, k) => patches.get([c, m, y, k].join()) || (() => { throw new Error(`seeds: ${file} has no patch C${c} M${m} Y${y} K${k}; the print-gamut view reads the tints of C, M and Y at ${PRINT_LEVELS.slice(1).join(', ')}% with their two-ink patches, the solids with 20 and 40% black, and C, M and K 100%, as FOGRA39L.txt holds them; pass the whole file the registry publishes`); })();
  const patch = (cov, k) => get(...cov, k);
  // C with M, M with Y, Y with C: the first ink at PRINT_LEVELS[i], the second at PRINT_LEVELS[j].
  const faces = [[0, 1], [1, 2], [2, 0]].map(([p, q]) => PRINT_LEVELS.map((u) => PRINT_LEVELS.map((v) => patch([0, 1, 2].map((x) => (x === p ? u : x === q ? v : 0)), 0))));
  const blacks = [[100, 0, 0], [100, 100, 0], [0, 100, 0], [0, 100, 100], [0, 0, 100], [100, 0, 100]].map((solid) => [20, 40].map((k) => patch(solid, k)));
  return { faces, blacks, blackL: get(100, 100, 0, 100)[0] };
}

// --compare's arguments: two PNG files, and only --threshold and --json beside them.
function parseCompare(args) {
  let compare = null, threshold = null, json = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') {
      if (json) throw refuse('use --json only once');
      json = true;
    } else if (arg === '--compare') {
      if (compare) throw refuse('use --compare only once');
      const files = [args[i + 1], args[i + 2]];
      if (!files.every((f) => f && /\.png$/i.test(f))) throw refuse(`--compare needs a render and a reference, two .png files, got ${files.filter(Boolean).join(' ') || 'nothing'}`);
      compare = { render: files[0], reference: files[1] };
      i += 2;
    } else if (arg === '--threshold') {
      if (threshold !== null) throw refuse('use --threshold only once');
      const text = args[++i];
      threshold = plainDecimal(text);
      if (!(threshold >= 0 && threshold < 255)) throw refuse(`--threshold takes a plain decimal channel difference from 0 to under 255, such as 24, got ${gotText(text)}`);
    } else throw refuse(`--compare takes only --threshold and --json beside its two files, got ${arg}`);
  }
  return { compare, threshold: threshold ?? FRAME_THRESHOLD, json };
}

// --plan's arguments: one piece, and only --seed and --json beside it.
function parsePlan(args) {
  const names = [];
  let plan = false, json = false, seed = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--plan' || arg === '--json') {
      if (arg === '--plan' ? plan : json) throw refuse(`use ${arg} only once`);
      if (arg === '--plan') plan = true; else json = true;
    } else if (arg === '--seed') {
      if (seed !== null) throw refuse('use --seed only once');
      const text = String(args[++i] ?? '');
      seed = Number(text);
      if (!/^\d+$/.test(text) || seed > 0xffffffff) throw refuse('--seed takes a whole number from 0 to 4294967295, got ' + (text || 'nothing'));
    } else if (arg.startsWith('--')) throw refuse(`--plan takes one piece, --seed and --json, got ${arg}`);
    else if (names.length) throw refuse(`--plan takes one piece, got "${names[0]}" and "${arg}"`);
    else names.push(arg);
  }
  if (!names.length) throw refuse('name one piece for --plan');
  return { plan: true, names, json, ...(seed !== null && { seed }) };
}

// --style, as `--style <name>` or `--style=<name>`, is refused in argument order
// in every mode: a style draws nothing, so no sheet takes one.
function refuseStyle(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg !== '--style' && !arg.startsWith('--style=')) continue;
    const name = arg === '--style' ? args[i + 1] : arg.slice(8);
    throw refuse(!name || name.startsWith('--') ? '--style needs a style name; npm run styles lists them' : styleCause(name));
  }
}

function parseArgs(args) {
  refuseStyle(args);
  if (args.includes('--compare')) return parseCompare(args);
  if (args.includes('--plan')) return parsePlan(args);
  const positional = [];
  let paramNames = [];
  let seenParam = false, png = false, json = false, box = null;
  // A time strip: --frames or --at, and the --scale and --loupe it takes.
  let frames = null, times = null, scale = null, loupe = null, shots = false, cuts = false, sound = false, motion = false, timeoutMs = null, reference = null, referenceScale = null, seed = null, contacts = null, seeds = null, soundReference = null;
  // The views under each cell, of any sheet or strip.
  let values = false, grey = false, colourVision = false, gamut = false, lightPage = false, armature = false;
  // Each --part, and each --figure: a name and the colours its marks are painted with.
  const parts = [], figures = [];
  const named = (option, text, list, need) => {
    const m = /^([\w-]+)=(.+)$/.exec(text || '');
    if (!m || m[2].split('+').some((s) => !s.trim())) throw refuse(`${option} needs a name and ${need}, several colours joined by +, got ${text || 'nothing'}`);
    if (list.some((p) => p.name === m[1])) throw refuse(`use ${option} ${m[1]} only once`);
    list.push({ name: m[1], styles: m[2].split('+') });
  };
  // Each --sample: a design point whose colour each strip cell reports.
  const samples = [];
  // --two-values: the dark and light lightness a declared two-value film holds to.
  let twoValues = null;
  const once =(value, option) => { if (value !== null) throw refuse(`use ${option} only once`); };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--png' || arg === '--json') {
      if (arg === '--png' ? png : json) throw refuse(`use ${arg} only once`);
      if (arg === '--png') png = true; else json = true;
    }
    else if (arg === '--shots') shots = true;
    else if (arg === '--cuts') cuts = true;
    else if (arg === '--sound') sound = true;
    else if (arg === '--motion') motion = true;
    else if (arg === '--values') values = true;
    else if (arg === '--grey') grey = true;
    else if (arg === '--colour-vision') colourVision = true;
    else if (arg === '--gamut') {
      if (gamut) throw refuse('use --gamut only once');
      // The characterization data file, found from the caller's directory and read by main.
      gamut = args[++i];
      if (!gamut || gamut.startsWith('--')) throw refuse(`--gamut needs the characterization data the print-gamut view reads, which Artifex does not ship, got ${gotText(gamut)}; ${PRINT_DATA_HINT}`);
    }
    else if (arg === '--light-page') lightPage = true;
    else if (arg === '--armature') {
      if (armature) throw refuse('use --armature only once');
      armature = true;
    }
    else if (arg === '--contacts') {
      once(contacts, arg);
      contacts = args[++i];
      if (!contacts || !/^[\w$]+(\.[\w$]+)*$/.test(contacts)) throw refuse('--contacts needs the name of a list in the built state, dotted for a nested one, such as falls or cues.hits');
    }
    else if (arg === '--frames') {
      once(frames, arg);
      frames = Number(args[++i]);
      if (!Number.isSafeInteger(frames) || frames < 2) throw refuse('--frames needs a whole number of frames, 2 or more');
    }
    else if (arg === '--at') {
      once(times, arg);
      times = String(args[++i] || '').split(',').map((v) => (v.trim() ? Number(v) : NaN));
      if (!times.every(Number.isFinite)) throw refuse('--at needs seconds separated by commas, such as 0.5,2,3.25');
    }
    else if (arg === '--seed') {
      once(seed, arg);
      const text = String(args[++i] ?? '');
      seed = Number(text);
      if (!/^\d+$/.test(text) || seed > 0xffffffff) throw refuse('--seed takes a whole number from 0 to 4294967295, got ' + (text || 'nothing'));
    }
    else if (arg === '--seeds') {
      once(seeds, arg);
      const text = String(args[++i] ?? '');
      seeds = text.split(',').map((v) => (/^\d+$/.test(v) ? Number(v) : NaN));
      if (seeds.length > MAX_SWEEP_SEEDS) throw refuse(`--seeds draws one row per seed, up to ${MAX_SWEEP_SEEDS}, got ${seeds.length}`);
      if (!seeds.every((v) => v <= 0xffffffff) || new Set(seeds).size !== seeds.length) throw refuse('--seeds needs distinct whole numbers from 0 to 4294967295 separated by commas, such as 1,2,3, got ' + (text || 'nothing'));
    }
    else if (arg === '--scale') {
      once(scale, arg);
      const text = args[++i];
      scale = plainDecimal(text);
      if (!(scale > 0)) throw refuse(`--scale needs a positive plain decimal number of pixels per design unit, got ${gotText(text)}`);
    }
    else if (arg === '--loupe') {
      once(loupe, arg);
      // An optional design point x,y; the centre without one.
      const m = /^(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/.exec(args[i + 1] || '');
      loupe = m ? { x: Number(m[1]), y: Number(m[2]) } : true;
      if (m) i++;
    }
    else if (arg === '--reference') {
      once(reference, arg);
      // A photo and an optional point in its pixels, the centre without one.
      const m = /^(.+\.(?:webp|png|jpe?g))(?:@(\d+(?:\.\d+)?),(\d+(?:\.\d+)?))?$/i.exec(args[++i] || '');
      if (!m) throw refuse('--reference needs a photo: a .webp, .png or .jpg file, then optionally @x,y, a point in its pixels, such as photo.webp@512,300');
      reference = { file: m[1], at: m[2] === undefined ? null : { x: Number(m[2]), y: Number(m[3]) } };
    }
    else if (arg === '--sound-reference') {
      once(soundReference, arg);
      soundReference = args[++i];
      if (!/\.(wav|mp3|m4a|aac|ogg|opus|flac)$/i.test(soundReference || '')) throw refuse('--sound-reference needs a sound file: .wav, .mp3, .m4a, .aac, .ogg, .opus or .flac, got ' + (soundReference || 'nothing'));
    }
    else if (arg === '--part') named(arg, args[++i], parts, 'the colour its marks are painted with, such as red=#f00');
    else if (arg === '--figure') named(arg, args[++i], figures, 'the colours its painted fill and contour strokes use, such as body=#b07a5a+#2a2320');
    else if (arg === '--sample') {
      const text = args[++i];
      const m = /^(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/.exec(text || '');
      if (!m) throw refuse('--sample needs a design point as x,y, such as 480,300, got ' + gotText(text));
      const point = { x: Number(m[1]), y: Number(m[2]) };
      if (samples.some((s) => s.x === point.x && s.y === point.y)) throw refuse(`use --sample ${point.x},${point.y} only once`);
      samples.push(point);
    }
    else if (arg === '--two-values') {
      once(twoValues, arg);
      const text = args[++i];
      const m = /^(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/.exec(text || '');
      if (!m) throw refuse(`--two-values needs two OKLCh lightnesses, dark then light, from 0 to 1, such as 0.12,0.88, got ${gotText(text)}`);
      twoValues = [Number(m[1]), Number(m[2])];
      if (!twoValuesHold(twoValues)) throw refuse(`--two-values needs the dark value 0.2 or more under the light one, both from 0 to 1, as a declared two-value film holds them, got ${text}`);
    }
    else if (arg === '--reference-scale') {
      once(referenceScale, arg);
      const text = args[++i];
      referenceScale = plainDecimal(text);
      if (!(referenceScale > 0)) throw refuse(`--reference-scale needs a positive plain decimal number of crop pixels per photo pixel, such as 0.5 for a photo with twice the detail, got ${gotText(text)}`);
    }
    else if (arg === '--timeout-ms') {
      once(timeoutMs, arg);
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw refuse('--timeout-ms needs a number of milliseconds');
      timeoutMs = timeoutArg(args[++i], refuse, { max: MAX_TIMEOUT_MS });
    }
    else if (arg === '--box') {
      if (box) throw refuse('use --box or --reframe only once');
      const m = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(args[++i] || '');
      if (!m) throw refuse('--box needs a box as WIDTHxHEIGHT, such as 405x720');
      box = { w: Number(m[1]), h: Number(m[2]) };
    }
    // A box timeline, which pieceOf refuses by name through atBox as it does a box.
    else if (arg === '--reframe') {
      if (box) throw refuse('use --box or --reframe only once');
      const text = args[++i];
      if (!text || text.startsWith('--')) throw refuse('--reframe needs a box timeline as t:WIDTHxHEIGHT,..., such as 0:1280x720,1:405x720');
      try { box = parseReframe(text); } catch (e) { throw refuse('--' + e.message); }
    }
    else if (arg === '--param' || arg.startsWith('--param=')) {
      if (seenParam) throw refuse('use --param only once');
      seenParam = true;
      const value = arg === '--param' ? args[++i] : arg.slice(8);
      if (!value || value.startsWith('--')) throw refuse('--param needs one or two comma-separated names');
      paramNames = value.split(',').map((key) => key.trim());
      if (paramNames.some((key) => !key) || paramNames.length > 2 || new Set(paramNames).size !== paramNames.length) {
        throw refuse('--param needs one or two distinct parameter names');
      }
    } else if (arg === '--threshold') throw refuse('--threshold belongs to --compare; add --compare <render.png> <reference.png>');
    else if (arg === '--out' || arg.startsWith('--out=')) throw refuse('--out belongs to film, still, image, stitch and measure; seeds names its own files, under out/ for a registered piece or beside an external piece, and prints each path; drop --out');
    else if (arg.startsWith('--')) throw new Error(`seeds: unknown option ${arg}\n${USAGE}`);
    else positional.push(arg);
  }
  if (positional.length > 3) throw new Error(`seeds: unexpected argument "${positional[3]}"\n${USAGE}`);
  const [which, n, t] = positional;
  if (timeoutMs !== null && !png && !json) throw refuse('--timeout-ms limits the browser that --png or --json starts; add one');
  const browser = { ...(timeoutMs !== null && { timeoutMs }), ...(lightPage && { lightPage }) };
  const views = values || grey || colourVision || gamut ? { values, grey, colourVision, gamut } : null;
  const strip = frames !== null || times !== null || shots || contacts !== null
    ? { frames, at: times, scale, loupe, shots, sound, ...(motion && { motion }), ...(cuts && { cuts }), ...(contacts !== null && { contacts }), ...(seed !== null && { seed }), ...(parts.length && { parts }), ...(figures.length && { figures }), ...(armature && { armature }), ...(samples.length && { samples }), ...(twoValues && { twoValues }) } : null;
  if (armature && !strip) throw refuse('--armature reads the frames of a time strip; add --frames, --at, --shots or --contacts');
  if (twoValues && !strip) throw refuse('--two-values reads the frames of a time strip; add --frames, --at, --shots or --contacts');
  if (parts.length && !strip) throw refuse('--part reads the frames of a time strip; add --frames, --at, --shots or --contacts');
  if (parts.length && !json) throw refuse('--part reports in the sheet\'s JSON; add --json');
  if (figures.length && !strip) throw refuse('--figure reads the frames of a time strip; add --frames, --at, --shots or --contacts');
  if (samples.length && !strip) throw refuse('--sample reads the frames of a time strip; add --frames, --at, --shots or --contacts');
  if (samples.length && !json) throw refuse('--sample reports in the sheet\'s JSON; add --json');
  if (cuts && !shots) throw refuse('--cuts blends the frames either side of each cut on a shot strip; add --shots');
  if (!strip && (scale !== null || loupe !== null || sound)) throw refuse('--scale, --loupe and --sound belong to a time strip; add --frames, --at, --shots or --contacts');
  if (motion && !strip) throw refuse('--motion belongs to a time strip; add --frames, --at, --shots or --contacts');
  if (soundReference !== null && !(strip && sound)) throw refuse('--sound-reference is measured beside the strip\'s soundtrack; add --sound' + (strip ? '' : ' and --frames, --at, --shots or --contacts'));
  if (soundReference !== null && !json) throw refuse('--sound-reference reports its profile in the sheet\'s JSON; add --json');
  if (seeds && strip) throw refuse('a time strip draws at one seed, set with --seed; drop --seeds');
  if (seeds && paramNames.length !== 1) throw refuse(SEEDS_NEED_ONE_PARAM);
  if (!strip && seed !== null && paramNames.length === 1 && !seeds) seeds = [seed];
  else if (!strip && seed !== null) {
    throw refuse(`--seed picks the seed of a time strip, a still or a one-name parameter sweep; ${seeds ? 'a sweep takes --seed or --seeds, not both' : paramNames.length ? 'a sweep of two names holds the piece\'s own seed' : 'a contact sheet already sweeps seeds 1 to its count'}, so ${seeds ? 'drop --seed or --seeds' : paramNames.length ? 'drop --seed or give --param one name' : 'add --frames, --at, --shots or --contacts, or drop --seed'}`);
  }
  if (referenceScale !== null && reference === null) throw refuse('--reference-scale scales the --reference photo; add --reference');
  if (reference !== null) reference.scale = referenceScale ?? 1;
  if (reference !== null && loupe === null) throw refuse('--reference shows the photo beside the 100% crops; add --loupe' + (strip ? '' : ' and --frames, --at, --shots or --contacts'));
  if (strip) {
    if ((frames !== null) + (times !== null) + shots > 1) throw refuse('a time strip takes one of --frames, --at, --shots or --contacts');
    if (contacts !== null && (frames !== null || times !== null || shots)) throw refuse('--contacts shows the frames around each contact; drop --frames, --at or --shots');
    if (paramNames.length) throw refuse('a time strip holds the seed and parameters; drop --param');
    if (!which) throw refuse('name one piece for a time strip');
    if (n !== undefined) throw refuse('a time strip takes its frames from --frames, --at, --shots or --contacts, not a count or playhead');
    return { names: [which], count: frames || (times ? times.length : 0), at: 1, paramNames, png, json, box, strip, reference, ...(soundReference !== null && { soundReference: { file: soundReference } }), ...(views && { views }), ...browser };
  }
  if (paramNames.length && !which) throw refuse('name one piece when using --param');
  if (box && !which) throw refuse(`name one piece when using ${Array.isArray(box) ? '--reframe' : '--box'}`);
  const names = which ? [which] : Object.keys(EXAMPLES);
  const count = n === undefined ? (paramNames.length ? 3 : 9) : Number(n);
  if (!Number.isSafeInteger(count) || count < (paramNames.length ? 2 : 1)) {
    throw refuse(`count must be an integer >= ${paramNames.length ? 2 : 1}, got ${n}`);
  }
  const at = t === undefined ? 1 : Number(t);
  if (!Number.isFinite(at)) throw refuse(`playhead must be a number, got ${t}`);
  if (at < 0 || at > 1) throw refuse(`playhead must be from 0 (the start) to 1 (the end), got ${t}`);
  return { names, count, at, paramNames, png, json, box, ...(seeds && { seeds }), ...(views && { views }), ...browser };
}

/**
 * The sheet's file, without extension, in the piece's outputDirectory; a
 * fixture's sheet under out/pieces/ never takes a registered example's name.
 */
function sheetStem(names, paramNames, external, box = null, strip = null, seeds = null, views = null) {
  const out = outputDirectory(external);
  // --at has a stem of its own, so a review strip never replaces a --frames strip;
  // so does --loupe, so a strip with crops never replaces the same strip without;
  // so does --seed, so strips at two seeds never replace each other, and
  // --contacts names its list, so strips of two lists never replace each other;
  // a name with a capital also takes a short hash of itself, so Falls and falls
  // keep separate files on a file system that ignores case; so do --param keys
  // with a capital, so a sweep of Reach never replaces a sweep of reach. A "-"
  // inside a key is encoded, so the key a-b never names the sheet of keys a and b.
  const caseSafe = (name, raw) => raw === raw.toLowerCase() ? name : `${name}-${crypto.createHash('sha256').update(raw).digest('hex').slice(0, 6)}`;
  const list = strip && strip.contacts;
  const listName = list && caseSafe(list, list);
  const keys = caseSafe(paramNames.map((key) => encodeURIComponent(key).replace(/\*/g, '%2A').replace(/-/g, '%2D')).join('-'), JSON.stringify(paramNames));
  const suffix = (strip ? (strip.shots ? 'shots' + (strip.cuts ? '-cuts' : '') : list ? `contacts-${listName}` : strip.at ? 'at' : 'frames') + (strip.loupe ? '-loupe' : '') + (strip.seed != null ? `-seed${strip.seed}` : '') + (strip.sound ? '-sound' : '') + (strip.motion ? '-motion' : '') :paramNames.length ? `param-${keys}${seeds ? `-seeds${seeds.join('-')}` : ''}` : 'seeds')
    + (Array.isArray(box) ? '-reframe' : box ? `-${box.w}x${box.h}` : '');
  // Views keep their own file, so a sheet with them never replaces the plain one;
  // they join with "+", which no encoded key or list name holds, so --grey never
  // names the sheet of a parameter called grey.
  const viewSuffix = views ? (views.values ? '+values' : '') + (views.grey ? '+grey' : '') + (views.colourVision ? '+colour-vision' : '') + (views.gamut ? '+gamut' : '') : '';
  // So do the flat fills of --figure.
  const figureSuffix = strip && strip.figures ? '+figure' : '';
  // So does the armature view.
  const armatureSuffix = strip && strip.armature ? '+armature' : '';
  return path.join(out, (names.length === 1 ? `${external ? external.stem : names[0]}-${suffix}` : 'seeds') + viewSuffix + figureSuffix + armatureSuffix);
}

/** CSS pixels a PNG of the sheet is wide: enough for every sweep or strip column, 1280 at least. */
function sheetWidth(count, paramNames, layout = null) {
  // 24 px of body padding each side, 220 px columns and 14 px gaps; a strip's
  // columns are its cells and their borders.
  if (layout) return Math.max(1280, 48 + layout.columns * (layout.width + 2) + (layout.columns - 1) * 14);
  return paramNames.length ? Math.max(1280, 48 + count * 220 + (count - 1) * 14) : 1280;
}

// --compare: decode both PNG files, found from the caller's directory, and print their frameGap.
function compareFiles({ compare, threshold, json }) {
  // `role` names the file in decodePng's advice, which is worded for a reference.
  const read = (file, role) => {
    let bytes, png;
    try { bytes = fs.readFileSync(path.resolve(callerDirectory(), file)); } catch (e) { throw new Error(`seeds: --compare cannot read ${file}: ${e.code || e.message}`); }
    try { png = decodePng(bytes, file); } catch (e) { throw new Error(e.message.replace(/^measure:/, 'seeds:').replace('save the reference as PNG', `save the ${role} as PNG`)); }
    return { data: png.rgba, width: png.w, height: png.h };
  };
  // frameGap is also sent into the replay page as source, so it names no
  // library root; the command a size refusal gives gets its root here.
  let gap;
  try { gap = frameGap(read(compare.reference, 'reference'), read(compare.render, 'render'), threshold); } catch (e) {
    throw new Error(e.message.replace('npm run still -- <piece> --scale k', hint('still', '"<piece>"', '--scale', '"<k>"')));
  }
  const lines = frameText(gap);
  lines[0] = `${compare.render} against ${compare.reference}, ${lines[0]}`;
  console.log(json ? JSON.stringify(gap) : lines.join('\n'));
}

// --plan: write viewPlan's page beside the piece and print its lines; --json prints the plan without its views.
function writePlan(args) {
  const say = args.json ? console.error : console.log;
  const external = isPiecePath(args.names[0]) ? loadExternal(args.names[0]) : null;
  const name = external ? external.names[0] : args.names[0];
  const plan = viewPlan(pieceOf(name, external), args.seed ?? undefined);
  const html = planPage(plan);
  const out = outputDirectory(external);
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, `${external ? external.stem : name}-plan${args.seed != null ? `-seed${args.seed}` : ''}.html`);
  fs.writeFileSync(file, html);
  say(`${shown(file)}  ${(Buffer.byteLength(html) / 1024).toFixed(1)} kB`);
  for (const line of planText(plan)) say(line);
  say('Open it and LOOK -- the checks cannot see this half.');
  if (args.json) console.log(JSON.stringify({ ...plan, views: undefined }));
}

// A page Edge draws (--png, --json) tags a plain strip's shots itself, so planStrip skips its Node build.
const drawsInPage = (args) => !!(args.png || args.json);

// The shot list the page refused, refused as planStrip refuses it in Node.
function refuseSheet(sheet) {
  if (sheet.refusal) throw new Error(sheet.refusal + '\n' + USAGE);
}

// `capture` stands in for captureSheet in a test.
async function main(capture = captureSheet) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) return console.log(USAGE);
  const args = parseArgs(process.argv.slice(2));
  if (args.compare) return compareFiles(args);
  if (args.plan) return writePlan(args);
  const { count, at, paramNames, box, strip = null, seeds = null, views = null } = args;
  // With --json only the sheet's data goes to stdout; the summary goes to stderr.
  const say = args.json ? console.error : console.log;
  // --gamut's characterization data, found from the caller's directory, before anything is written.
  if (views && views.gamut) {
    let text;
    try { text = fs.readFileSync(path.resolve(callerDirectory(), views.gamut), 'utf8'); } catch (e) { throw new Error(`seeds: --gamut cannot read ${views.gamut}: ${e.code || e.message}; nothing was written; ${PRINT_DATA_HINT}`); }
    try { views.gamut = printData(text, views.gamut); } catch (e) { throw new Error(`${e.message}; nothing was written`); }
  }
  const external = args.names.length === 1 && isPiecePath(args.names[0]) ? loadExternal(args.names[0]) : null;
  const names = external ? external.names : args.names;
  // A declared two-value film: --two-values, or else the line in an external piece's beat sheet.
  let valuesFrom = strip && strip.twoValues ? '--two-values' : null;
  if (strip && !valuesFrom && external && external.entry) {
    const declared = declaredValues(fs.readFileSync(external.entry, 'utf8'), shown(external.entry), console.error);
    if (declared) { strip.twoValues = declared; valuesFrom = `the beat sheet in ${shown(external.entry)}`; }
  }
  if (valuesFrom) say(`two values ${strip.twoValues.join(', ')} (OKLCh L), from ${valuesFrom}`);
  // A comparison and a light page keep their own file, so neither replaces the plain strip.
  const stem = sheetStem(names, paramNames, external, box, strip, seeds, views) + (args.lightPage ? '+light-page' : '') + (args.reference ? '-reference' : '');
  fs.mkdirSync(path.dirname(stem), { recursive: true });
  // A --png run replaces the images under its name, so they go before anything
  // after the sheet is named can refuse it: a refused run leaves no earlier
  // image to pass for its own.
  if (args.png) {
    await writePieces(stem + '.png', []);
    if (names.length > 1) await removeGoneSections(stem, []);
  }
  const layout = strip && planStrip(pieceOf(names[0], external, box), strip, drawsInPage(args));
  for (const { frame, at } of (layout && layout.repeats) || []) {
    // Enough decimals that a rounded centre stays within a tenth of a frame of the true one.
    const d = Math.max(3, Math.ceil(Math.log10(layout.hz)) + 1), centre = (f) => +((f + 0.5) / layout.hz).toFixed(d);
    // The film's last frame has no next one, so the example pairs it with the frame before.
    const first = frame + 1 < layout.frames ? frame : frame - 1;
    // A film of one frame has no consecutive frames to suggest.
    console.error(`warning: --at ${at.join(' and ')} fall in frame ${frame}, from ${+(frame / layout.hz).toFixed(d)} to ${+((frame + 1) / layout.hz).toFixed(d)} s at ${layout.hz} fps, so their cells are the same picture`
      + (layout.frames < 2 ? '' : `; for consecutive frames give each frame's centre, (frame + 0.5) / ${layout.hz} s, such as ${centre(first)},${centre(first + 1)}`));
  }
  // The photo is found from the caller's directory, as an external piece is.
  const reference = args.reference
    && await cropReference(path.resolve(callerDirectory(), args.reference.file), layout.loupe, args.reference, args.timeoutMs);
  // A reference sound is found from the caller's directory too, and only its numbers are kept.
  const soundReference = args.soundReference && await measureSound(path.resolve(callerDirectory(), args.soundReference.file), args.timeoutMs);
  if (soundReference) say(`sound reference ${soundReference.file}: ${soundReference.seconds.toFixed(3)} s, ${soundReference.profile.events.length} events`);
  const html = page(names, count, at, paramNames, external, box, strip, reference, seeds, views, soundReference || null, !!args.lightPage, layout);
  checkParses(html);
  const file = stem + '.html';
  fs.writeFileSync(file, html);
  say(`${shown(file)}  ${(Buffer.byteLength(html) / 1024).toFixed(1)} kB`);
  if (reference) {
    say(`reference ${reference.name}: ${reference.photo.W} x ${reference.photo.H} px, ${(reference.bytes / 1024).toFixed(1)} kB;`
      + ` embeds ${reference.sw} x ${reference.sh} photo px from (${reference.sx}, ${reference.sy}) at scale ${reference.scale} in ${reference.w} x ${reference.h} px,`
      + ` a ${(reference.src.length / 1024).toFixed(1)} kB lossless ${/^data:image\/(\w+)/.exec(reference.src)[1].toUpperCase()} data URL`);
  }
  const mode = layout ? (layout.hz ? `${layout.cells.length} of ${layout.frames} frames${strip.shots ? ` (${layout.cells.length / 3} shots${strip.cuts ? ', with each cut\'s frames blended' : ''})` : layout.contacts ? ` (around ${layout.contacts} contact frames)` : ''}` : 'a still')
    + ` at seed ${layout.cells[0].seed}, ${layout.width} px wide${layout.loupe ? (layout.hz ? ', each with a 100% crop' : ', with a 100% crop') : ''}${layout.sound ? ', with its soundtrack' : ''}${layout.motion ? ', with its motion energy' : ''}`
    : (seeds ? `${count} samples per axis at ${seeds.length} seeds (${count * seeds.length} cells), one row per seed ${seeds.join(', ')}` : paramNames.length ? `${count} samples per axis (${count ** paramNames.length} cells), fixed seed` : `${count} seeds`) + ` at t=${at}`;
  const viewNames = views ? [views.values && 'value', views.grey && 'greyscale', views.colourVision && 'colour-vision', views.gamut && 'print-gamut'].filter(Boolean) : [];
  say(`${names.length} piece(s) x ${mode}${viewNames.length ? `, with ${viewNames.join(', ')} views` : ''}. Open it and LOOK -- the checks cannot see this half.`);
  if (layout && layout.armature) for (const line of armatureText(layout.armature.faults, layout.frames, layout.hz)) say(line);
  if (!drawsInPage(args)) return undefined;
  const cells = layout ? layout.cells.length : sheetPlans(names, count, paramNames, external, box, null, seeds).reduce((sum, plan) => sum + plan.length, 0);
  return capture(html, stem, { cells, width: sheetWidth(count, paramNames, layout), images: args.png, timeoutMs: args.timeoutMs }).then(({ shots, failures, sheet }) => {
    refuseSheet(sheet);
    for (const shot of shots) say(`${shown(shot.file)}  ${shot.width} x ${shot.height} px`);
    // Each crop's style gap from the photo; the sheet's JSON holds it as each cell's `style`.
    for (const cell of reference ? sheet.cells : []) {
      if (cell.style) say(`style gap, ${layout.hz ? `frame ${cell.frame} (${cell.seconds.toFixed(3)} s)` : 'the still'}: ${styleText(cell.style)}`);
    }
    say(`${cells} cells, ${failures} failed.` + (args.png ? ` Open ${shots.length > 1 ? 'these images' : 'this image'} and look at every cell.` : ''));
    if (failures > 0) for (const line of failureText(sheet)) say(line);
    if (sheet.motion && !sheet.motion.error) say(`motion: median change ${sheet.motion.median}, ${sheet.motion.still.length} still stretch${sheet.motion.still.length === 1 ? '' : 'es'} of ${MOTION.stillSeconds} s or more, ${sheet.motion.jumps.length} frame${sheet.motion.jumps.length === 1 ? '' : 's'} over ${MOTION.jump} times the median with no cut`);
    if (sheet.sound && sheet.sound.level) say(`soundtrack levelled as the film's AAC: ${levelText(sheet.sound.level)}`);
    if (args.json) console.log(JSON.stringify(sheet));
  });
}

if (require.main === module) {
  Promise.resolve().then(main).catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = {
  page, parseArgs, printData, photoCrop, cropReference, measureSound, soundProfile, soundStems, shotGaps, silentSpans, SOUND_HELPERS, cellViews, styleStats, styleGap, styleText, frameGap, frameText, FRAME_THRESHOLD, FRAME_GRID, planSheet, sweepLabels, planStrip, pixelBounds, measureFrame, frameDetail, gridChange, stripFlags, trustedCell, STRIP_RULES,
  main, sheetPlans, sheetStem, sheetWidth, drawsInPage, refuseSheet, soundPicture, soundSummary, beatSummary, shotList, drawSound, SOUND_WAVE, SOUND_ROWS, USAGE, motionSummary, drawMotion, MOTION,
  contactList, CONTACT_WINDOW, MAX_CONTACTS, recordMarks, paintOrder, layerSwaps, partCover, figureFill, silhouette, PAINT, armatureList, jointFaults, armatureText, ARMATURE_RULES,
  viewPlan, planText, planPage, parsePlan, cutPlan, cutOverlay, strayEdge, massShare, litArea, CUT_RULES, declaredValues, levelText, failureText,
};
