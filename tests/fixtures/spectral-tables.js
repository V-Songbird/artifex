// Derives the two tables core/colour.js's mixSpectral reads, from published
// methods only, so the numbers in core have a source a test can rerun:
//
//  - the CIE 1931 observer as the multi-lobe Gaussian fit of Wyman, Sloan and
//    Shirley, "Simple Analytic Approximations to the CIE XYZ Color Matching
//    Functions" (JCGT 2013);
//  - the CIE D65 illuminant, tabulated every 10 nm;
//  - XYZ to linear sRGB, the matrix of IEC 61966-2-1;
//  - reflectance curves by least slope squared (Scott Burns, "Generating
//    Reflectance Curves from sRGB Triplets", 2015), solved here for the three
//    sRGB primaries together, bounded to [0,1] and summing to 1 at every
//    wavelength, so every sRGB colour has a curve in [0,1] and comes back exact.
//
// `node tests/fixtures/spectral-tables.js` prints both tables as the source
// text core/colour.js holds.

'use strict';

const LAMBDA = [];
for (let l = 380; l <= 730; l += 10) LAMBDA.push(l);
const N = LAMBDA.length;

const D65 = [49.98, 54.65, 82.75, 91.49, 93.43, 86.68, 104.86, 117.01, 117.81, 114.86, 115.92, 108.81, 109.35, 107.80,
  104.79, 107.69, 104.41, 104.05, 100.00, 96.33, 95.79, 88.69, 90.01, 89.60, 87.70, 83.29, 83.70, 80.03, 80.21, 82.28,
  78.28, 69.72, 71.61, 74.35, 61.60, 69.89];

const lobe = (l, mu, s1, s2) => Math.exp(-0.5 * ((l - mu) / (l < mu ? s1 : s2)) ** 2);
const BAR = [
  (l) => 1.056 * lobe(l, 599.8, 37.9, 31.0) + 0.362 * lobe(l, 442.0, 16.0, 26.7) - 0.065 * lobe(l, 501.1, 20.4, 26.2),
  (l) => 0.821 * lobe(l, 568.8, 46.9, 40.5) + 0.286 * lobe(l, 530.9, 16.3, 31.1),
  (l) => 1.217 * lobe(l, 437.0, 11.8, 36.0) + 0.681 * lobe(l, 459.0, 26.0, 13.8),
];

const XYZ_TO_RGB = [
  [3.2404542, -1.5371385, -0.4985314],
  [-0.9692660, 1.8760108, 0.0415560],
  [0.0556434, -0.2040259, 1.0572252],
];

const sum = (row) => row.reduce((a, b) => a + b, 0);

/**
 * `observer[c][i]`: linear sRGB channel c of a surface reflecting only
 * wavelength i, under D65. `white` is the XYZ of a surface reflecting
 * everything, and `sums` each row's total before it is scaled to exactly 1.
 */
function observer() {
  const yn = sum(LAMBDA.map((l, i) => BAR[1](l) * D65[i]));
  const xyz = BAR.map((bar) => LAMBDA.map((l, i) => bar(l) * D65[i] / yn));
  const raw = XYZ_TO_RGB.map((m) => LAMBDA.map((_, i) => m[0] * xyz[0][i] + m[1] * xyz[1][i] + m[2] * xyz[2][i]));
  const sums = raw.map(sum);
  return { observer: raw.map((row, c) => row.map((v) => v / sums[c])), white: xyz.map(sum), sums };
}

/** Gaussian elimination with partial pivoting. */
function solve(A, b) {
  const n = b.length;
  const a = A.map((row, i) => row.concat(b[i]));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-13) throw new Error(`spectral-tables: singular system at column ${c}`);
    [a[c], a[p]] = [a[p], a[c]];
    for (let r = c + 1; r < n; r++) {
      const f = a[r][c] / a[c][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k++) a[r][k] -= f * a[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = a[r][n];
    for (let k = r + 1; k < n; k++) s -= a[r][k] * x[k];
    x[r] = s / a[r][r];
  }
  return x;
}

/**
 * The primaries' curves, `[red, green, blue]`. The unknowns are red and green;
 * blue is what they leave. Least slope squared over the three curves, with each
 * primary held to itself through `T`, and a sample that leaves [0,1] pinned to
 * the bound it crossed until none does.
 */
function primaries(T) {
  const n = 2 * N;
  const H = Array.from({ length: n }, () => new Array(n).fill(0));
  const slope = (ro, co, w) => {
    for (let i = 0; i + 1 < N; i++) {
      H[ro + i][co + i] += w; H[ro + i + 1][co + i + 1] += w;
      H[ro + i][co + i + 1] -= w; H[ro + i + 1][co + i] -= w;
    }
  };
  slope(0, 0, 2); slope(N, N, 2); slope(0, N, 1); slope(N, 0, 1);
  const rows = [];
  const rhs = [];
  for (let c = 0; c < 3; c++) {
    for (const [offset, primary] of [[0, 0], [N, 1]]) {
      const row = new Array(n).fill(0);
      for (let i = 0; i < N; i++) row[offset + i] = T[c][i];
      rows.push(row); rhs.push(c === primary ? 1 : 0);
    }
  }
  const pinned = new Set();
  for (let pass = 0; pass < 200; pass++) {
    const m = rows.length;
    const K = Array.from({ length: n + m }, () => new Array(n + m).fill(0));
    const b = new Array(n + m).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) K[i][j] = 2 * H[i][j];
    for (let k = 0; k < m; k++) {
      for (let j = 0; j < n; j++) { K[n + k][j] = rows[k][j]; K[j][n + k] = rows[k][j]; }
      b[n + k] = rhs[k];
    }
    const v = solve(K, b);
    let added = 0;
    const pin = (key, cells, value) => {
      if (pinned.has(key)) return;
      const row = new Array(n).fill(0);
      for (const j of cells) row[j] = 1;
      pinned.add(key); rows.push(row); rhs.push(value); added++;
    };
    for (let i = 0; i < N; i++) {
      if (v[i] < -1e-10) pin(`r${i}`, [i], 0);
      if (v[N + i] < -1e-10) pin(`g${i}`, [N + i], 0);
      if (v[i] + v[N + i] > 1 + 1e-10) pin(`b${i}`, [i, N + i], 1);
    }
    if (!added) {
      const red = v.slice(0, N).map((x) => Math.max(0, x));
      const green = v.slice(N, n).map((x) => Math.max(0, x));
      return [red, green, red.map((x, i) => Math.max(0, 1 - x - green[i]))];
    }
  }
  throw new Error('spectral-tables: the bounds did not settle in 200 passes');
}

function derive() {
  const o = observer();
  return { lambda: LAMBDA, observer: o.observer, primaries: primaries(o.observer), white: o.white, sums: o.sums };
}

/** The two tables as the source text core/colour.js holds, six decimals a value. */
function source(d = derive()) {
  const table = (name, rowsOf) => {
    const body = rowsOf.map((r) => {
      const cells = r.map((v) => String(Math.round(v * 1e6) / 1e6));
      const lines = [];
      for (let i = 0; i < cells.length; i += 12) lines.push(`    ${cells.slice(i, i + 12).join(', ')},`);
      return `  [\n${lines.join('\n')}\n  ],`;
    });
    return `const ${name} = [\n${body.join('\n')}\n];`;
  };
  return [table('OBSERVER', d.observer), table('PRIMARY', d.primaries.slice(0, 2))];
}

module.exports = { derive, source };

if (require.main === module) console.log(source().join('\n'));
